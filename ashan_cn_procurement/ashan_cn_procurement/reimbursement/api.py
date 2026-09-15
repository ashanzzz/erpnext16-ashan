"""Whitelisted reimbursement endpoints."""

from collections.abc import Iterable
import frappe

from ashan_cn_procurement.reimbursement.service import (
    get_purchase_invoice_item_candidates,
    get_unpaid_purchase_invoice_picker_rows as get_unpaid_purchase_invoice_picker_row_data,
    import_purchase_invoice_items,
    normalize_names,
    search_unpaid_purchase_invoices as search_unpaid_purchase_invoice_rows,
)


@frappe.whitelist()
def preview_unpaid_purchase_invoice_items(
    company: str,
    purchase_invoice_names: str | Iterable[str] | None = None,
    purchase_invoice_item_names: str | Iterable[str] | None = None,
    excluded_purchase_invoice_item_names: str | Iterable[str] | None = None,
) -> dict:
    """Read-only preview used before a new reimbursement request is saved."""
    candidates = get_purchase_invoice_item_candidates(
        company,
        purchase_invoice_names,
        purchase_invoice_item_names,
        existing_sources=set(normalize_names(excluded_purchase_invoice_item_names)),
    )
    return {
        "items": [candidate["row"] for candidate in candidates],
        "imported_count": len(candidates),
        "imported_amount": sum(frappe.utils.flt(candidate["row"]["amount"]) for candidate in candidates),
        "imported_source_items": [candidate["source_pi_item"] for candidate in candidates],
    }


@frappe.whitelist(methods=["POST"])
def import_unpaid_purchase_invoices(
    reimbursement_request_name: str,
    purchase_invoice_names: str | Iterable[str] | None = None,
    purchase_invoice_item_names: str | Iterable[str] | None = None,
) -> dict:
    """Server-authoritative import for the Reimbursement Request form."""
    return import_purchase_invoice_items(
        reimbursement_request_name,
        purchase_invoice_names,
        purchase_invoice_item_names,
    )


@frappe.whitelist()
def get_unpaid_purchase_invoice_filter_options(company: str) -> dict:
    """Return the invoice-type options applicable to the current company."""
    if not company:
        frappe.throw(frappe._("请先填写公司。"))

    rows = frappe.get_list(
        "Purchase Invoice",
        filters={"company": company, "docstatus": 1, "outstanding_amount": [">", 0]},
        fields=["custom_invoice_type"],
        order_by="custom_invoice_type asc",
        page_length=500,
    )
    return {
        "invoice_types": sorted(
            {row.custom_invoice_type for row in rows if row.custom_invoice_type}
        )
    }


@frappe.whitelist()
def get_unpaid_purchase_invoice_picker_rows(
    company: str,
    filters: dict | str | None = None,
    mode: str = "invoice",
    reimbursement_request_name: str | None = None,
    excluded_purchase_invoice_item_names: str | Iterable[str] | None = None,
) -> dict:
    """Load the rows displayed below the filters in the single picker dialog."""
    if not company:
        frappe.throw(frappe._("请先填写公司。"))
    return {
        "rows": get_unpaid_purchase_invoice_picker_row_data(
            company=company,
            filters=filters,
            mode=mode,
            reimbursement_request_name=reimbursement_request_name,
            excluded_purchase_invoice_item_names=excluded_purchase_invoice_item_names,
        ),
    }


@frappe.whitelist()
def search_unpaid_purchase_invoices(
    doctype: str,
    txt: str,
    searchfield: str,
    start: int,
    page_len: int,
    filters: dict | str | None = None,
) -> list[tuple]:
    """Permission-aware custom search used by the invoice selection dialog."""
    if doctype != "Purchase Invoice":
        return []
    return search_unpaid_purchase_invoice_rows(
        txt=txt,
        start=start,
        page_len=page_len,
        filters=filters,
    )
