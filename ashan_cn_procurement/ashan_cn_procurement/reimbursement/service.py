"""Server-side reimbursement domain services."""

from __future__ import annotations

from collections.abc import Iterable

import frappe
from frappe import _
from frappe.utils import flt


ACTIVE_RESERVATION_STATUSES = ("Draft", "Submitted")


def normalize_names(values: str | Iterable[str] | None) -> list[str]:
    """Return safe, de-duplicated document names from RPC input."""
    if isinstance(values, str):
        values = frappe.parse_json(values)
    if not isinstance(values, Iterable):
        return []
    return list(dict.fromkeys(str(value).strip() for value in values if str(value).strip()))


def import_purchase_invoice_items(
    reimbursement_request_name: str,
    purchase_invoice_names: str | Iterable[str] | None = None,
    purchase_invoice_item_names: str | Iterable[str] | None = None,
) -> dict:
    """Import permitted, unpaid Purchase Invoice lines into a saved draft.

    The browser only supplies source names.  Amounts, source snapshots, and
    reservations are recalculated on the server immediately before writing.
    """
    request = frappe.get_doc("Reimbursement Request", reimbursement_request_name)
    request.check_permission("write")
    if not request.company:
        frappe.throw(_("请先填写公司并保存报销申请草稿。"))

    candidates = get_purchase_invoice_item_candidates(
        request.company,
        purchase_invoice_names,
        purchase_invoice_item_names,
        {row.source_pi_item for row in request.get("invoice_items") if row.source_pi_item},
    )
    _assert_sources_available(candidates, request.name)
    _assert_request_amounts_within_invoice_outstanding(request, candidates)
    for candidate in candidates:
        request.append("invoice_items", candidate["row"])
        _create_reservation(request.name, candidate)

    request.save()
    return {
        "imported_count": len(candidates),
        "imported_amount": sum(flt(candidate["row"]["amount"]) for candidate in candidates),
        "imported_source_items": [candidate["source_pi_item"] for candidate in candidates],
    }


def get_purchase_invoice_item_candidates(
    company: str,
    purchase_invoice_names: str | Iterable[str] | None = None,
    purchase_invoice_item_names: str | Iterable[str] | None = None,
    existing_sources: set[str] | None = None,
) -> list[dict]:
    """Return server-verified source snapshots without writing a reimbursement draft."""
    if not company:
        frappe.throw(_("请先填写公司。"))

    invoice_names = normalize_names(purchase_invoice_names)
    requested_item_names = set(normalize_names(purchase_invoice_item_names))
    if not invoice_names and requested_item_names:
        # Purchase Invoice Item has no independent Desk permission.  Its
        # parent invoices are permission-scoped immediately below.
        invoice_names = frappe.get_all(
            "Purchase Invoice Item",
            filters={"name": ["in", requested_item_names]},
            pluck="parent",
        )
    # Multiple selected child rows can belong to one Purchase Invoice.  The
    # invoice must be evaluated exactly once, otherwise its requested rows
    # would be appended once per matching child row.
    invoice_names = list(dict.fromkeys(invoice_names))
    if not invoice_names:
        frappe.throw(_("请选择至少一张采购发票。"))

    permitted_invoices = frappe.get_list(
        "Purchase Invoice",
        filters={
            "name": ["in", invoice_names],
            "company": company,
            "docstatus": 1,
            "outstanding_amount": [">", 0],
        },
        fields=["name"],
        order_by="posting_date desc, name desc",
        page_length=len(invoice_names),
    )
    permitted_names = {row.name for row in permitted_invoices}
    unavailable = [name for name in invoice_names if name not in permitted_names]
    if unavailable:
        frappe.throw(_("所选采购发票不可导入、已付清、公司不一致或没有读取权限：{0}").format(", ".join(unavailable)))

    candidates = []
    for invoice_name in invoice_names:
        invoice = frappe.get_doc("Purchase Invoice", invoice_name)
        invoice.check_permission("read")
        selected_items = [
            item for item in invoice.items
            if not requested_item_names or item.name in requested_item_names
        ]
        if requested_item_names and not selected_items:
            continue
        candidates.extend(_make_candidates(invoice, selected_items, existing_sources or set()))

    if not candidates:
        frappe.throw(_("没有可新增的采购发票明细。可能已导入当前单据，或没有选择有效明细。"))

    return candidates


def get_unpaid_purchase_invoice_picker_rows(
    company: str,
    filters: dict | str | None = None,
    mode: str = "invoice",
    reimbursement_request_name: str | None = None,
    excluded_purchase_invoice_item_names: str | Iterable[str] | None = None,
) -> list[dict]:
    """Return invoice or source-item rows for the single-screen picker.

    A source row is the unit of selection in both modes.  Invoice mode simply
    groups the still-available source rows by their Purchase Invoice.
    """
    if mode not in {"invoice", "item"}:
        frappe.throw(_("不支持的选单模式。"))

    filters = _normalize_filters(filters)
    filters["company"] = company
    invoice_rows, _ = _find_unpaid_purchase_invoices(filters)
    excluded_sources = set(normalize_names(excluded_purchase_invoice_item_names))
    excluded_sources.update(_get_request_source_items(reimbursement_request_name, company))
    excluded_sources.update(_get_other_request_reserved_source_items(reimbursement_request_name))

    picker_rows: list[dict] = []
    item_name_filter = (filters.get("item_name") or "").strip().lower()
    for invoice_row in invoice_rows:
        invoice = frappe.get_doc("Purchase Invoice", invoice_row.name)
        invoice.check_permission("read")
        allocations = _allocate_invoice_outstanding(invoice)
        available_items = [
            item for item in invoice.items
            if item.name in allocations and item.name not in excluded_sources
        ]
        if not available_items:
            continue

        if mode == "item":
            for item in available_items:
                label = item.item_name or item.item_code or item.description or ""
                if item_name_filter and item_name_filter not in label.lower():
                    continue
                picker_rows.append(
                    _make_picker_item_row(invoice, item, allocations[item.name])
                )
            continue

        source_item_amounts = {
            item.name: flt(allocations[item.name]) for item in available_items
        }
        item_summary = [
            item.item_name or item.item_code or item.description
            for item in available_items
            if item.item_name or item.item_code or item.description
        ]
        picker_rows.append(
            {
                "name": invoice.name,
                "posting_date": invoice.posting_date,
                "bill_no": invoice.bill_no,
                "bill_date": invoice.bill_date,
                "custom_invoice_type": invoice.custom_invoice_type,
                "supplier": invoice.supplier,
                "outstanding_amount": flt(invoice.outstanding_amount),
                "available_amount": sum(source_item_amounts.values()),
                "source_item_names": list(source_item_amounts),
                "source_item_amounts": source_item_amounts,
                "item_summary": "、".join(item_summary[:4]),
            }
        )
    return picker_rows


def search_unpaid_purchase_invoices(
    txt: str = "",
    start: int | str = 0,
    page_len: int | str = 20,
    filters: dict | str | None = None,
) -> list[tuple]:
    """Backward-compatible Frappe link search for the former native picker."""
    filters = _normalize_filters(filters)
    invoices, _ = _find_unpaid_purchase_invoices(filters, txt)
    start, page_len = max(int(start or 0), 0), min(max(int(page_len or 20), 1), 100)
    return [
        (
            row.name,
            row.bill_no or "",
            row.supplier or "",
            row.custom_invoice_type or "",
            row.bill_date or "",
            flt(row.outstanding_amount),
        )
        for row in invoices[start : start + page_len]
    ]


def _find_unpaid_purchase_invoices(filters: dict, txt: str = "") -> tuple[list, list]:
    """Find permission-scoped parent invoices and their display-only item rows."""
    company = filters.get("company")
    if not company:
        return [], []

    invoice_filters: list[list] = [
        ["company", "=", company],
        ["docstatus", "=", 1],
        ["outstanding_amount", ">", 0],
    ]
    _add_like_filter(invoice_filters, "bill_no", filters.get("bill_no"))
    _add_exact_filter(invoice_filters, "custom_invoice_type", filters.get("custom_invoice_type"))
    _add_like_filter(invoice_filters, "supplier", filters.get("supplier"))
    _add_range_filter(invoice_filters, "bill_date", filters.get("bill_date_from"), filters.get("bill_date_to"))
    _add_range_filter(
        invoice_filters,
        "outstanding_amount",
        filters.get("min_outstanding_amount"),
        filters.get("max_outstanding_amount"),
        minimum_operator=">",
    )
    or_filters = []
    if txt := txt.strip():
        search_text = f"%{txt}%"
        or_filters = [["name", "like", search_text], ["bill_no", "like", search_text], ["supplier", "like", search_text]]

    invoices = frappe.get_list(
        "Purchase Invoice",
        filters=invoice_filters,
        or_filters=or_filters,
        fields=["name", "bill_no", "bill_date", "custom_invoice_type", "supplier", "outstanding_amount"],
        order_by="bill_date desc, posting_date desc, name desc",
        page_length=100,
    )
    if not invoices:
        return [], []

    allowed_names = [row.name for row in invoices]
    item_filters: dict = {"parent": ["in", allowed_names], "parenttype": "Purchase Invoice"}
    if item_name := (filters.get("item_name") or "").strip():
        item_filters["item_name"] = ["like", f"%{item_name}%"]

    # Child rows do not have independent Desk permissions.  Parent invoices
    # above are already permission-scoped; this query only adds display text.
    item_rows = frappe.get_all(
        "Purchase Invoice Item",
        filters=item_filters,
        fields=["parent", "item_name", "item_code", "description"],
        order_by="idx asc",
        page_length=1000,
    )
    if filters.get("item_name"):
        matched_names = {row.parent for row in item_rows}
        invoices = [row for row in invoices if row.name in matched_names]
    return invoices, item_rows


def _get_request_source_items(request_name: str | None, company: str) -> set[str]:
    """Return sources already present on the current saved reimbursement draft."""
    if not request_name:
        return set()

    request = frappe.get_doc("Reimbursement Request", request_name)
    request.check_permission("read")
    if request.company != company:
        frappe.throw(_("报销申请的公司与当前筛选公司不一致。"))
    return {row.source_pi_item for row in request.get("invoice_items") if row.source_pi_item}


def _get_other_request_reserved_source_items(current_request: str | None) -> set[str]:
    """Hide sources claimed by another active reimbursement draft."""
    reservations = frappe.get_all(
        "Reimbursement Source Reservation",
        filters={"status": ["in", ACTIVE_RESERVATION_STATUSES]},
        fields=["source_purchase_invoice_item", "reimbursement_request"],
        page_length=5000,
    )
    return {
        row.source_purchase_invoice_item
        for row in reservations
        if row.reimbursement_request != current_request and row.source_purchase_invoice_item
    }


def _make_picker_item_row(invoice, item, amount: float) -> dict:
    """Build the detailed-mode row with a server-calculated source snapshot."""
    return {
        "name": item.name,
        "source_pi": invoice.name,
        "source_pi_item": item.name,
        "posting_date": invoice.posting_date,
        "bill_no": invoice.bill_no,
        "bill_date": invoice.bill_date,
        "custom_invoice_type": invoice.custom_invoice_type,
        "supplier": invoice.supplier,
        "item_code": item.item_code,
        "item_name": item.item_name,
        "description": item.description,
        "qty": flt(item.qty),
        "uom": item.uom,
        "available_amount": flt(amount),
    }


def _normalize_filters(filters: dict | str | None) -> dict:
    if isinstance(filters, str):
        filters = frappe.parse_json(filters)
    return filters if isinstance(filters, dict) else {}


def _add_like_filter(target: list[list], fieldname: str, value: str | None) -> None:
    if value := (value or "").strip():
        target.append([fieldname, "like", f"%{value}%"])


def _add_exact_filter(target: list[list], fieldname: str, value: str | None) -> None:
    if value := (value or "").strip():
        target.append([fieldname, "=", value])


def _add_range_filter(
    target: list[list],
    fieldname: str,
    minimum: str | float | None,
    maximum: str | float | None,
    minimum_operator: str = ">=",
) -> None:
    if minimum not in (None, "") and maximum not in (None, ""):
        target.append([fieldname, "between", [minimum, maximum]])
    elif minimum not in (None, ""):
        target.append([fieldname, minimum_operator, minimum])
    elif maximum not in (None, ""):
        target.append([fieldname, "<=", maximum])


def reserve_request_sources(request) -> None:
    """Create durable claims when a browser-only selection is first saved."""
    rows = [row for row in request.get("invoice_items") if row.source_pi_item]
    if not rows:
        return
    active_sources = set(
        frappe.get_all(
            "Reimbursement Source Reservation",
            filters={"reimbursement_request": request.name, "status": ["in", ACTIVE_RESERVATION_STATUSES]},
            pluck="source_purchase_invoice_item",
        )
    )
    candidates = [
        {"source_pi": row.source_pi, "source_pi_item": row.source_pi_item, "row": {"amount": row.amount}}
        for row in rows
        if row.source_pi_item not in active_sources
    ]
    _assert_sources_available(candidates, request.name)
    for candidate in candidates:
        _create_reservation(request.name, candidate)


def _create_reservation(request_name: str, candidate: dict) -> None:
    reservation = frappe.get_doc(
        {
            "doctype": "Reimbursement Source Reservation",
            "reimbursement_request": request_name,
            "source_purchase_invoice": candidate["source_pi"],
            "source_purchase_invoice_item": candidate["source_pi_item"],
            "reserved_amount": candidate["row"]["amount"],
            "status": "Draft",
        }
    )
    reservation.insert()


def release_removed_reservations(request) -> None:
    """Release draft claims that no longer have a corresponding child row."""
    source_items = {row.source_pi_item for row in request.get("invoice_items") if row.source_pi_item}
    reservations = frappe.get_all(
        "Reimbursement Source Reservation",
        filters={
            "reimbursement_request": request.name,
            "status": ["in", ACTIVE_RESERVATION_STATUSES],
        },
        pluck="name",
    )
    for name in reservations:
        reservation = frappe.get_doc("Reimbursement Source Reservation", name)
        if reservation.source_purchase_invoice_item not in source_items:
            reservation.status = "Released"
            reservation.save()


def release_all_reservations(request) -> None:
    """Release all claims when a draft reimbursement request is deleted."""
    for name in frappe.get_all(
        "Reimbursement Source Reservation",
        filters={
            "reimbursement_request": request.name,
            "status": ["in", ACTIVE_RESERVATION_STATUSES],
        },
        pluck="name",
    ):
        reservation = frappe.get_doc("Reimbursement Source Reservation", name)
        reservation.status = "Released"
        reservation.save()


def _make_candidates(invoice, items, existing_sources: set[str]) -> list[dict]:
    """Return snapshots using the invoice-wide allocation, never a subset reallocation."""
    allocations = _allocate_invoice_outstanding(invoice)
    items = [
        item for item in items
        if item.name not in existing_sources and flt(allocations.get(item.name))
    ]
    if not items:
        return []

    candidates = []
    for item in items:
        amount = flt(allocations[item.name])
        candidates.append(
            {
                "source_pi": invoice.name,
                "source_pi_item": item.name,
                "row": {
                    "item_name": item.item_name,
                    "description": item.description,
                    "qty": item.qty,
                    "uom": item.uom,
                    "rate": flt(amount / item.qty, 2) if flt(item.qty) else amount,
                    "amount": amount,
                    "invoice_no": invoice.bill_no,
                    "supplier": invoice.supplier,
                    "source_pi": invoice.name,
                    "source_pi_item": item.name,
                },
            }
        )
    return candidates


def _allocate_invoice_outstanding(invoice) -> dict[str, float]:
    """Allocate an invoice's current outstanding amount across every source row.

    The allocation always considers the complete invoice before a client asks
    for a subset.  That preserves line amounts across repeated imports and
    across the invoice/detail picker modes.
    """
    source_items = [item for item in invoice.items if flt(_gross_amount(item)) > 0]
    total_source_amount = sum(_gross_amount(item) for item in source_items)
    if not source_items or not total_source_amount:
        return {}

    outstanding = flt(invoice.outstanding_amount)
    remaining = outstanding
    allocations: dict[str, float] = {}
    for index, item in enumerate(source_items):
        amount = (
            remaining
            if index == len(source_items) - 1
            else flt(_gross_amount(item) / total_source_amount * outstanding, 2)
        )
        allocations[item.name] = amount
        remaining = flt(remaining - amount, 2)
    return allocations


def _gross_amount(item) -> float:
    return flt(getattr(item, "custom_gross_amount", 0) or item.amount)


def _assert_request_amounts_within_invoice_outstanding(request, candidates: list[dict]) -> None:
    """Prevent repeated batches from exceeding an invoice's latest unpaid amount."""
    amounts_by_invoice: dict[str, float] = {}
    for row in request.get("invoice_items"):
        if row.source_pi:
            amounts_by_invoice[row.source_pi] = flt(amounts_by_invoice.get(row.source_pi)) + flt(row.amount)
    for candidate in candidates:
        source_pi = candidate["source_pi"]
        amounts_by_invoice[source_pi] = flt(amounts_by_invoice.get(source_pi)) + flt(candidate["row"]["amount"])

    for source_pi, selected_amount in amounts_by_invoice.items():
        invoice = frappe.get_doc("Purchase Invoice", source_pi)
        invoice.check_permission("read")
        if selected_amount > flt(invoice.outstanding_amount) + 0.01:
            invoice_label = invoice.bill_no or invoice.name
            frappe.throw(
                _("采购发票 {0} 的已选报销金额超过当前待付金额，请刷新后重新选择。").format(invoice_label)
            )


def _assert_sources_available(candidates: list[dict], current_request: str) -> None:
    keys = [candidate["source_pi_item"] for candidate in candidates]
    if not keys:
        return
    conflicts = frappe.get_all(
        "Reimbursement Source Reservation",
        filters={"active_source_key": ["in", keys]},
        fields=["name", "source_purchase_invoice_item", "reimbursement_request"],
    )
    stale_reservations = []
    other_requests = set()
    for row in conflicts:
        if row.reimbursement_request and row.reimbursement_request != current_request:
            rr_status = frappe.db.get_value("Reimbursement Request", row.reimbursement_request, "docstatus")
            if rr_status is None or rr_status == 2:
                stale_reservations.append(row.name)
            else:
                other_requests.add(row.reimbursement_request)

    if stale_reservations:
        frappe.db.sql("DELETE FROM `tabReimbursement Source Reservation` WHERE name IN %s", (tuple(stale_reservations),))

    if other_requests:
        frappe.throw(_("以下来源明细已被其他报销单占用：{0}").format(", ".join(sorted(other_requests))))

