# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

from __future__ import annotations

import json
from collections import defaultdict
from typing import Any

import frappe
from frappe import _
from frappe.utils import flt, nowdate

from ashan_cn_procurement.services.authorization_service import (
    assert_company_access,
    assert_module_access,
)
from ashan_cn_procurement.services.procurement_picker_service import (
    get_user_procurement_companies,
)
from ashan_cn_procurement.services.work_context_service import get_effective_work_date


def _resolve_companies(company: str | None = None) -> list[str]:
    """Resolve accessible companies list with server-side permission checks."""
    user_comps = get_user_procurement_companies()["companies"]
    if not user_comps:
        frappe.throw(_("当前账号未获得任何公司的访问权限。"))

    if not company or company == "All" or company == "全部公司":
        return user_comps

    assert_company_access(company)
    return [company]


def _meta_has(doctype: str, fieldname: str) -> bool:
    """Safely check if DocType has a field."""
    try:
        return frappe.get_meta(doctype).has_field(fieldname)
    except Exception:
        return False


# =========================================================================
# 0. Lifecycle Computation Engine
# =========================================================================

def compute_wire_lifecycle_info(
    pi_name: str,
    bill_no: str | None,
    invoice_type: str | None,
    outstanding_amount: float,
    linked_pr_names: str | None,
    linked_se_names: str | None,
    linked_rr_names: str | None,
    has_stock_items: bool = True,
) -> dict:
    """
    Compute fine-grained wire transfer lifecycle status:
    1. paid_pending_receipt (🔵 款付货未到): Money paid, goods in transit/pending receipt
    2. received_pending_invoice (🟡 货到票未到): Goods received in warehouse, invoice is temporary estimate/pending
    3. completed_closed (🟢 全部完成): Paid + Received + Official Invoice in place
    4. pending_payment (🟠 待电汇付款): Invoiced + Received, but Payment outstanding
    """
    has_pr = bool(linked_pr_names and str(linked_pr_names).strip() and str(linked_pr_names).strip() != "-")
    has_se = bool(linked_se_names and str(linked_se_names).strip() and str(linked_se_names).strip() != "-")
    bill_no_clean = str(bill_no or "").strip()
    inv_type_clean = str(invoice_type or "").strip()

    is_temp_est = bool(
        not bill_no_clean
        or bill_no_clean.startswith("暂估")
        or bill_no_clean.startswith("ZG-")
        or "暂估" in bill_no_clean
        or "待补票" in bill_no_clean
        or inv_type_clean in ("暂估发票", "暂估待补票", "暂估入库", "暂估")
    )
    is_paid = bool(flt(outstanding_amount) <= 0.0001 or (linked_rr_names and str(linked_rr_names).strip()))

    if has_stock_items and not has_pr:
        status = "paid_pending_receipt"
        label = "🔵 款付货未到"
        badge_class = "badge-lifecycle-pending-receipt"
        desc = "款项已付，货物在途待入库"
    elif is_temp_est:
        status = "received_pending_invoice"
        label = "🟡 货到票未到"
        badge_class = "badge-lifecycle-pending-invoice"
        desc = "货物已入库，发票暂估待补票"
    elif is_paid:
        status = "completed_closed"
        label = "🟢 全部完成"
        badge_class = "badge-lifecycle-closed"
        desc = "款已付、货已入、票已到，全部完成"
    else:
        status = "pending_payment"
        label = "🟠 待电汇付款"
        badge_class = "badge-lifecycle-pending-payment"
        desc = "发票入库就绪，等待付款"

    return {
        "status": status,
        "label": label,
        "badge_class": badge_class,
        "desc": desc,
        "is_temporary_estimate": is_temp_est,
        "is_paid": is_paid,
        "has_pr": has_pr,
        "has_se": has_se,
    }


# =========================================================================
# 1. KPI Aggregation for 自办电汇
# =========================================================================

@frappe.whitelist()
def get_wire_transfer_overview_kpis(company: str | None = None) -> dict:
    """Return aggregated KPI counts for 自办电汇 workflow categorized by lifecycle states."""
    companies = _resolve_companies(company)

    # 1. Query all active wire transfer purchase invoices
    invoices = frappe.db.sql("""
        SELECT
            pi.name AS pi_name,
            COALESCE(pi.bill_no, '') AS bill_no,
            COALESCE(pi.custom_invoice_type, '专用发票') AS invoice_type,
            pi.grand_total,
            pi.outstanding_amount,
            MAX(COALESCE(item.is_stock_item, 0)) AS has_stock_items,
            GROUP_CONCAT(DISTINCT pii.purchase_receipt SEPARATOR '、') AS linked_pr_names,
            (
                SELECT GROUP_CONCAT(DISTINCT rii.parent ORDER BY rii.parent DESC SEPARATOR '、')
                FROM `tabReimbursement Invoice Item` rii
                INNER JOIN `tabReimbursement Request` rr_inner ON rr_inner.name = rii.parent
                WHERE rii.source_pi = pi.name AND rr_inner.docstatus < 2
            ) AS linked_rr_names
        FROM `tabPurchase Invoice` pi
        LEFT JOIN `tabPurchase Invoice Item` pii ON pii.parent = pi.name
        LEFT JOIN `tabItem` item ON item.name = pii.item_code
        WHERE pi.docstatus = 1
          AND pi.company IN %s
          AND (pi.custom_biz_mode = '自办电汇' OR pi.custom_biz_mode = '电汇申请')
        GROUP BY pi.name
    """, (companies,), as_dict=True)

    # 扣除报销预占
    active_res = []
    if frappe.db.exists("DocType", "Reimbursement Source Reservation"):
        active_res = frappe.get_all(
            "Reimbursement Source Reservation",
            filters={"status": ["in", ["Draft", "Submitted"]]},
            fields=["source_purchase_invoice", "reserved_amount"],
        )
    reserved_by_pi = defaultdict(float)
    for res in active_res:
        reserved_by_pi[res.source_purchase_invoice] += flt(res.reserved_amount)

    total_count = len(invoices)
    total_amount = sum(flt(inv.grand_total) for inv in invoices)

    paid_pending_receipt_count = 0
    paid_pending_receipt_amt = 0.0

    received_pending_invoice_count = 0
    received_pending_invoice_amt = 0.0

    completed_closed_count = 0
    completed_closed_amt = 0.0

    pending_payment_count = 0
    pending_payment_amt = 0.0

    for inv in invoices:
        reserved = reserved_by_pi.get(inv.pi_name, 0.0)
        net_outstanding = max(0.0, flt(inv.outstanding_amount) - reserved)
        g_total = flt(inv.grand_total)

        life = compute_wire_lifecycle_info(
            pi_name=inv.pi_name,
            bill_no=inv.bill_no,
            invoice_type=inv.invoice_type,
            outstanding_amount=net_outstanding,
            linked_pr_names=inv.linked_pr_names,
            linked_se_names="",
            linked_rr_names=inv.linked_rr_names,
            has_stock_items=bool(inv.has_stock_items),
        )

        st = life["status"]
        if st == "paid_pending_receipt":
            paid_pending_receipt_count += 1
            paid_pending_receipt_amt += g_total
        elif st == "received_pending_invoice":
            received_pending_invoice_count += 1
            received_pending_invoice_amt += g_total
        elif st == "completed_closed":
            completed_closed_count += 1
            completed_closed_amt += g_total
        elif st == "pending_payment":
            pending_payment_count += 1
            pending_payment_amt += net_outstanding

    return {
        "companies": companies,
        "kpis": {
            "total": {
                "count": total_count,
                "amount": flt(total_amount, 2),
                "label": "全部自办电汇",
                "desc": "自办电汇总业务量",
            },
            "paid_pending_receipt": {
                "count": paid_pending_receipt_count,
                "amount": flt(paid_pending_receipt_amt, 2),
                "label": "款付货未到",
                "desc": "在途待入库",
            },
            "received_pending_invoice": {
                "count": received_pending_invoice_count,
                "amount": flt(received_pending_invoice_amt, 2),
                "label": "货到票未到",
                "desc": "暂估待补票",
            },
            "completed_closed": {
                "count": completed_closed_count,
                "amount": flt(completed_closed_amt, 2),
                "label": "全部完成",
                "desc": "已完成",
            },
            "pending_payment": {
                "count": pending_payment_count,
                "amount": flt(pending_payment_amt, 2),
                "label": "待电汇付款",
                "desc": "挂账待付",
            },
        },
    }


# =========================================================================
# 2. Query Detail & Doc Summary Rows for 自办电汇
# =========================================================================

@frappe.whitelist()
def get_wire_transfer_picker_rows(
    company: str | None = None,
    filters: dict | str | None = None,
) -> dict:
    """Query item detail rows for 自办电汇."""
    companies = _resolve_companies(company)
    if isinstance(filters, str):
        filters = frappe.parse_json(filters) or {}
    filters = dict(filters or {})

    match_status = filters.get("match_status") or ""
    lifecycle_status = filters.get("lifecycle_status") or "all"

    conditions = [
        "pi.docstatus = 1",
        "pi.company IN %(companies)s",
        "(pi.custom_biz_mode = '自办电汇' OR pi.custom_biz_mode = '电汇申请')",
    ]
    params: dict[str, Any] = {"companies": companies}

    if match_status == "pending":
        conditions.append("pi.outstanding_amount > 0")
    elif match_status == "completed":
        conditions.append("pi.outstanding_amount <= 0.0001")

    if filters.get("supplier"):
        conditions.append("pi.supplier LIKE %(supplier)s")
        params["supplier"] = f"%{filters['supplier']}%"

    if filters.get("bill_no"):
        conditions.append("pi.bill_no LIKE %(bill_no)s")
        params["bill_no"] = f"%{filters['bill_no']}%"

    if filters.get("item_code"):
        conditions.append("(pii.item_code LIKE %(item_code)s OR pii.item_name LIKE %(item_code)s)")
        params["item_code"] = f"%{filters['item_code']}%"

    if filters.get("owner"):
        conditions.append("pi.owner LIKE %(owner)s")
        params["owner"] = f"%{filters['owner']}%"

    where_clause = " AND ".join(conditions)

    has_inv_type = _meta_has("Purchase Invoice", "custom_invoice_type")
    type_col = "COALESCE(pi.custom_invoice_type, '专用发票')" if has_inv_type else "'专用发票'"
    has_spec = _meta_has("Purchase Invoice Item", "custom_spec_model")
    spec_col = "COALESCE(pii.custom_spec_model, '')" if has_spec else "''"
    has_remark = _meta_has("Purchase Invoice Item", "custom_line_remark")
    remark_col = "COALESCE(pii.custom_line_remark, '')" if has_remark else "''"
    has_tax_rate = _meta_has("Purchase Invoice Item", "custom_tax_rate")
    tax_rate_col = "COALESCE(pii.custom_tax_rate, 13.0)" if has_tax_rate else "13.0"
    has_tax_amount = _meta_has("Purchase Invoice Item", "custom_tax_amount")
    tax_amount_col = "COALESCE(pii.custom_tax_amount, 0)" if has_tax_amount else "0"
    has_total_amount = _meta_has("Purchase Invoice Item", "custom_total_amount")
    total_amount_col = "COALESCE(pii.custom_total_amount, pii.amount, 0)" if has_total_amount else "COALESCE(pii.amount, 0)"

    sql = f"""
        SELECT
            pii.name AS pii_name,
            pi.name AS pi_name,
            pi.company,
            pi.supplier,
            COALESCE(pi.bill_no, '') AS bill_no,
            {type_col} AS invoice_type,
            pi.bill_date,
            pi.posting_date,
            pi.owner,
            pi.outstanding_amount,
            pi.grand_total,
            pii.item_code,
            pii.item_name,
            pii.description,
            COALESCE(item.is_stock_item, 0) AS is_stock_item,
            {spec_col} AS spec,
            {remark_col} AS remarks,
            COALESCE(pii.uom, pii.stock_uom, '') AS uom,
            COALESCE(pii.qty, 1) AS qty,
            COALESCE(pii.rate, 0) AS rate,
            COALESCE(pii.amount, 0) AS amount,
            {tax_rate_col} AS tax_rate,
            {tax_amount_col} AS tax_amount,
            {total_amount_col} AS total_amount,
            COALESCE(pii.warehouse, '') AS warehouse,
            COALESCE(pii.purchase_order, '') AS purchase_order,
            COALESCE(pii.purchase_receipt, '') AS purchase_receipt,
            (
                SELECT GROUP_CONCAT(DISTINCT rii.parent ORDER BY rii.parent DESC SEPARATOR '、')
                FROM `tabReimbursement Invoice Item` rii
                INNER JOIN `tabReimbursement Request` rr_inner ON rr_inner.name = rii.parent
                WHERE rii.source_pi = pi.name AND rr_inner.docstatus < 2
            ) AS linked_rr_names
        FROM `tabPurchase Invoice Item` pii
        INNER JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent
        LEFT JOIN `tabItem` item ON item.name = pii.item_code
        WHERE {where_clause}
        ORDER BY pi.posting_date DESC, pi.name DESC, pii.idx ASC
        LIMIT 1000
    """

    raw_items = frappe.db.sql(sql, params, as_dict=True)

    active_res = []
    if frappe.db.exists("DocType", "Reimbursement Source Reservation"):
        active_res = frappe.get_all(
            "Reimbursement Source Reservation",
            filters={"status": ["in", ["Draft", "Submitted"]]},
            fields=["source_purchase_invoice", "reserved_amount"],
        )
    reserved_by_pi = defaultdict(float)
    for res in active_res:
        reserved_by_pi[res.source_purchase_invoice] += flt(res.reserved_amount)

    # 预载关联的 Payment Entry (付款单)
    pe_by_pi = defaultdict(list)
    if raw_items:
        pi_names = list(dict.fromkeys([it.pi_name for it in raw_items if it.get("pi_name")]))
        if pi_names:
            pe_records = frappe.db.sql("""
                SELECT per.reference_name, per.parent
                FROM `tabPayment Entry Reference` per
                INNER JOIN `tabPayment Entry` pe ON pe.name = per.parent
                WHERE per.reference_doctype = 'Purchase Invoice'
                  AND per.reference_name IN %s
                  AND pe.docstatus = 1
                ORDER BY pe.posting_date DESC, pe.name DESC
            """, (pi_names,), as_dict=True)
            for pe in pe_records:
                if pe.parent not in pe_by_pi[pe.reference_name]:
                    pe_by_pi[pe.reference_name].append(pe.parent)

    # 预载关联的 Stock Entry (领料出库单)
    se_by_pr = defaultdict(list)
    se_by_pi = defaultdict(list)
    if raw_items:
        se_records = frappe.db.sql("""
            SELECT name, purchase_receipt_no, remarks
            FROM `tabStock Entry`
            WHERE docstatus = 1
              AND company IN %s
              AND purpose = 'Material Issue'
        """, (companies,), as_dict=True)
        for se in se_records:
            if se.purchase_receipt_no:
                se_by_pr[se.purchase_receipt_no].append(se.name)
            if se.remarks:
                for it_row in raw_items:
                    if it_row.pi_name in se.remarks and se.name not in se_by_pi[it_row.pi_name]:
                        se_by_pi[it_row.pi_name].append(se.name)

    rows = []
    for it in raw_items:
        reserved = reserved_by_pi.get(it.pi_name, 0.0)
        net_outstanding = max(0.0, flt(it.outstanding_amount) - reserved)
        if match_status == "pending" and net_outstanding <= 0.0001:
            continue

        linked_ses = list(dict.fromkeys(se_by_pr.get(it.purchase_receipt, []) + se_by_pi.get(it.pi_name, [])))
        linked_se_str = "、".join(linked_ses)

        life = compute_wire_lifecycle_info(
            pi_name=it.pi_name,
            bill_no=it.bill_no,
            invoice_type=it.invoice_type,
            outstanding_amount=net_outstanding,
            linked_pr_names=it.purchase_receipt,
            linked_se_names=linked_se_str,
            linked_rr_names=it.linked_rr_names,
            has_stock_items=bool(it.is_stock_item),
        )

        if lifecycle_status and lifecycle_status != "all" and life["status"] != lifecycle_status:
            continue

        rows.append({
            "pii_name": it.pii_name,
            "pi_name": it.pi_name,
            "company": it.company,
            "supplier": it.supplier,
            "bill_no": it.bill_no,
            "invoice_type": it.invoice_type,
            "bill_date": str(it.bill_date) if it.bill_date else "",
            "posting_date": str(it.posting_date) if it.posting_date else "",
            "item_code": it.item_code,
            "item_name": it.item_name or it.item_code,
            "spec": it.spec or (it.description if it.description and it.description != it.item_name else "") or "",
            "remarks": it.remarks or "",
            "uom": it.uom,
            "qty": flt(it.qty, 2),
            "rate": flt(it.rate, 2),
            "amount": flt(it.amount, 2),
            "tax_rate": flt(it.tax_rate, 2),
            "tax_amount": flt(it.tax_amount, 2),
            "total_amount": flt(it.total_amount, 2),
            "warehouse": it.warehouse,
            "purchase_receipt": it.purchase_receipt,
            "is_stock_item": int(it.is_stock_item or 0),
            "has_stock_items": bool(it.is_stock_item),
            "linked_pr_names": it.purchase_receipt or "",
            "linked_se_names": linked_se_str,
            "linked_rr_names": it.linked_rr_names or "",
            "linked_pe_names": "、".join(pe_by_pi.get(it.pi_name, [])),
            "net_available_amount": flt(net_outstanding, 2),
            "owner": it.owner or "",
            "wire_lifecycle_status": life["status"],
            "wire_lifecycle_label": life["label"],
            "wire_lifecycle_badge": life["badge_class"],
            "wire_lifecycle_desc": life["desc"],
            "is_temporary_estimate": life["is_temporary_estimate"],
        })

    return {
        "companies": companies,
        "count": len(rows),
        "rows": rows,
    }


@frappe.whitelist()
def get_wire_transfer_doc_summary_rows(
    company: str | None = None,
    filters: dict | str | None = None,
) -> dict:
    """Query doc-level summary rows for 自办电汇."""
    companies = _resolve_companies(company)
    if isinstance(filters, str):
        filters = frappe.parse_json(filters) or {}
    filters = dict(filters or {})

    match_status = filters.get("match_status") or ""
    lifecycle_status = filters.get("lifecycle_status") or "all"

    conditions = [
        "pi.company IN %(companies)s",
        "pi.docstatus = 1",
        "(pi.custom_biz_mode = '自办电汇' OR pi.custom_biz_mode = '电汇申请')",
    ]
    params: dict[str, Any] = {"companies": companies}

    if match_status == "pending":
        conditions.append("pi.outstanding_amount > 0")
    elif match_status == "completed":
        conditions.append("pi.outstanding_amount <= 0.0001")

    if filters.get("supplier"):
        conditions.append("pi.supplier LIKE %(supplier)s")
        params["supplier"] = f"%{filters['supplier']}%"

    if filters.get("bill_no"):
        conditions.append("pi.bill_no LIKE %(bill_no)s")
        params["bill_no"] = f"%{filters['bill_no']}%"

    if filters.get("owner"):
        conditions.append("pi.owner LIKE %(owner)s")
        params["owner"] = f"%{filters['owner']}%"

    where_clause = " AND ".join(conditions)

    has_custom_doc_details = _meta_has("Purchase Invoice", "custom_doc_details")
    doc_details_col = "COALESCE(pi.custom_doc_details, '')" if has_custom_doc_details else "''"
    has_invoice_type = _meta_has("Purchase Invoice", "custom_invoice_type")
    type_col = "COALESCE(pi.custom_invoice_type, '专用发票')" if has_invoice_type else "'专用发票'"

    sql = f"""
        SELECT
            pi.name AS pi_name,
            pi.company,
            pi.supplier,
            COALESCE(pi.bill_no, '') AS bill_no,
            {type_col} AS invoice_type,
            pi.bill_date,
            pi.posting_date,
            pi.grand_total,
            pi.outstanding_amount,
            pi.owner,
            {doc_details_col} AS custom_doc_details,
            MAX(COALESCE(item.is_stock_item, 0)) AS has_stock_items,
            GROUP_CONCAT(DISTINCT pii.purchase_receipt SEPARATOR '、') AS linked_pr_names,
            GROUP_CONCAT(DISTINCT CONCAT(pii.item_name, ' (', ROUND(pii.qty, 2), ' ', COALESCE(pii.uom, pii.stock_uom, ''), ')') SEPARATOR '、') AS synthesized_details,
            COUNT(pii.name) AS item_count,
            SUM(pii.qty) AS total_qty,
            (
                SELECT GROUP_CONCAT(DISTINCT rii.parent ORDER BY rii.parent DESC SEPARATOR '、')
                FROM `tabReimbursement Invoice Item` rii
                INNER JOIN `tabReimbursement Request` rr_inner ON rr_inner.name = rii.parent
                WHERE rii.source_pi = pi.name AND rr_inner.docstatus < 2
            ) AS linked_rr_names
        FROM `tabPurchase Invoice` pi
        LEFT JOIN `tabPurchase Invoice Item` pii ON pii.parent = pi.name
        LEFT JOIN `tabItem` item ON item.name = pii.item_code
        WHERE {where_clause}
        GROUP BY pi.name
        ORDER BY (
            CASE 
                WHEN pi.bill_no LIKE '暂估%%' OR pi.bill_no = '' THEN 0
                WHEN pi.outstanding_amount > 0.0001 THEN 1
                ELSE 2
            END
        ) ASC, pi.posting_date DESC, pi.name DESC
        LIMIT 1000
    """

    invoices = frappe.db.sql(sql, params, as_dict=True)

    active_res = []
    if frappe.db.exists("DocType", "Reimbursement Source Reservation"):
        active_res = frappe.get_all(
            "Reimbursement Source Reservation",
            filters={"status": ["in", ["Draft", "Submitted"]]},
            fields=["source_purchase_invoice", "reserved_amount"],
        )
    reserved_by_pi = defaultdict(float)
    for res in active_res:
        reserved_by_pi[res.source_purchase_invoice] += flt(res.reserved_amount)

    # 预载关联的 Payment Entry (付款单)
    pe_by_pi = defaultdict(list)
    if invoices:
        pi_names = [inv.pi_name for inv in invoices]
        if pi_names:
            pe_records = frappe.db.sql("""
                SELECT per.reference_name, per.parent
                FROM `tabPayment Entry Reference` per
                INNER JOIN `tabPayment Entry` pe ON pe.name = per.parent
                WHERE per.reference_doctype = 'Purchase Invoice'
                  AND per.reference_name IN %s
                  AND pe.docstatus = 1
                ORDER BY pe.posting_date DESC, pe.name DESC
            """, (pi_names,), as_dict=True)
            for pe in pe_records:
                if pe.parent not in pe_by_pi[pe.reference_name]:
                    pe_by_pi[pe.reference_name].append(pe.parent)

    # 预载关联的 Stock Entry (领料出库单)
    se_by_pr = defaultdict(list)
    se_by_pi = defaultdict(list)
    if invoices:
        se_records = frappe.db.sql("""
            SELECT name, purchase_receipt_no, remarks
            FROM `tabStock Entry`
            WHERE docstatus = 1
              AND company IN %s
              AND purpose = 'Material Issue'
        """, (companies,), as_dict=True)
        for se in se_records:
            if se.purchase_receipt_no:
                se_by_pr[se.purchase_receipt_no].append(se.name)
            if se.remarks:
                for inv in invoices:
                    if inv.pi_name in se.remarks and se.name not in se_by_pi[inv.pi_name]:
                        se_by_pi[inv.pi_name].append(se.name)

    rows = []
    for inv in invoices:
        reserved = reserved_by_pi.get(inv.pi_name, 0.0)
        net_outstanding = max(0.0, flt(inv.outstanding_amount) - reserved)
        if match_status == "pending" and net_outstanding <= 0.0001:
            continue

        prs = [p.strip() for p in (inv.linked_pr_names or "").split("、") if p.strip()]
        matched_ses = []
        for pr_name in prs:
            matched_ses.extend(se_by_pr.get(pr_name, []))
        matched_ses.extend(se_by_pi.get(inv.pi_name, []))
        linked_se_names = "、".join(list(dict.fromkeys(matched_ses)))

        life = compute_wire_lifecycle_info(
            pi_name=inv.pi_name,
            bill_no=inv.bill_no,
            invoice_type=inv.invoice_type,
            outstanding_amount=net_outstanding,
            linked_pr_names=inv.linked_pr_names,
            linked_se_names=linked_se_names,
            linked_rr_names=inv.linked_rr_names,
            has_stock_items=bool(inv.has_stock_items),
        )

        if lifecycle_status and lifecycle_status != "all" and life["status"] != lifecycle_status:
            continue

        rows.append({
            "pi_name": inv.pi_name,
            "company": inv.company,
            "supplier": inv.supplier,
            "bill_no": inv.bill_no,
            "invoice_type": inv.invoice_type,
            "bill_date": str(inv.bill_date) if inv.bill_date else "",
            "posting_date": str(inv.posting_date) if inv.posting_date else "",
            "grand_total": flt(inv.grand_total, 2),
            "outstanding_amount": flt(inv.outstanding_amount, 2),
            "net_available_amount": flt(net_outstanding, 2),
            "custom_doc_details": inv.custom_doc_details or inv.synthesized_details or "",
            "item_count": inv.item_count or 0,
            "total_qty": flt(inv.total_qty or 0, 2),
            "has_stock_items": bool(inv.has_stock_items),
            "linked_pr_names": inv.linked_pr_names or "",
            "linked_se_names": linked_se_names,
            "linked_rr_names": inv.linked_rr_names or "",
            "linked_pe_names": "、".join(pe_by_pi.get(inv.pi_name, [])),
            "owner": inv.owner or "",
            "wire_lifecycle_status": life["status"],
            "wire_lifecycle_label": life["label"],
            "wire_lifecycle_badge": life["badge_class"],
            "wire_lifecycle_desc": life["desc"],
            "is_temporary_estimate": life["is_temporary_estimate"],
        })

    return {
        "companies": companies,
        "count": len(rows),
        "rows": rows,
    }


# =========================================================================
# 3. Create Self-Service Wire Transfer Bundle (无 PO 架构 · 支持暂估与在途)
# =========================================================================

@frappe.whitelist(methods=["POST"])
def create_self_service_wire_transfer_bundle(
    company: str,
    supplier: str,
    bill_no: str | None = None,
    bill_date: str | None = None,
    invoice_type: str = "专用发票",
    warehouse: str | None = None,
    is_temporary_estimate: int | bool = 0,
    auto_receive_stock: int | bool = 1,
    auto_issue_stock: int | bool = 1,
    create_reimbursement_request: int | bool = 1,
    applicant: str | None = None,
    items: str | list | None = None,
) -> dict:
    """
    One-click generation of 自办电汇 bundle:
    - If is_temporary_estimate: auto generate 暂估-WT-... placeholder
    - If auto_receive_stock: creates and submits PR (for stock items)
    - Creates and submits PI
    - If auto_issue_stock: creates and submits Stock Entry (Material Issue)
    - If create_reimbursement_request: creates and submits Reimbursement Request
    """
    assert_company_access(company)

    if not supplier or not supplier.strip():
        frappe.throw(_("请提供有效的供应商名称。"))
    supplier = supplier.strip()

    # Resolve Supplier or create on the fly
    if not frappe.db.exists("Supplier", supplier):
        sup_by_name = frappe.db.get_value("Supplier", {"supplier_name": supplier}, "name")
        if sup_by_name:
            supplier = sup_by_name
        else:
            new_sup = frappe.new_doc("Supplier")
            new_sup.supplier_name = supplier
            new_sup.supplier_group = "All Supplier Groups"
            new_sup.supplier_type = "Company"
            new_sup.flags.ignore_permissions = True
            new_sup.insert()
            supplier = new_sup.name

    is_temporary_estimate = bool(int(is_temporary_estimate or 0))
    bill_date_str = get_effective_work_date(bill_date)

    if is_temporary_estimate or not bill_no or not bill_no.strip():
        # Auto-generate temporary estimate bill number
        unique_hash = frappe.generate_hash(length=4).upper()
        bill_no = f"暂估-WT-{bill_date_str.replace('-', '')}-{unique_hash}"
        if invoice_type not in ("专用发票", "普通发票", "无发票"): invoice_type = "专用发票"
    else:
        bill_no = bill_no.strip()
        # Check duplicate
        existing_pi = frappe.db.get_value(
            "Purchase Invoice",
            {"supplier": supplier, "bill_no": bill_no, "docstatus": ["!=", 2]},
            ["name", "posting_date"],
            as_dict=True,
        )
        if existing_pi:
            frappe.throw(
                _("发票号【{0}】已在采购发票【{1}】（供应商：{2}，记账日期：{3}）中录入，禁止重复使用！").format(
                    bill_no, existing_pi.name, supplier, existing_pi.posting_date
                )
            )

    if isinstance(items, str):
        items = frappe.parse_json(items) or []
    items = list(items or [])

    if not items:
        frappe.throw(_("请录入至少一行有效的发票物料明细。"))

    auto_receive_stock = bool(int(auto_receive_stock))
    auto_issue_stock = bool(int(auto_issue_stock))
    create_reimbursement_request = bool(int(create_reimbursement_request))

    # Resolve Default Warehouse if not provided
    if not warehouse:
        if frappe.db.exists("Warehouse", f"Goods In Transit - {company}"):
            warehouse = f"Goods In Transit - {company}"
        elif frappe.db.exists("Warehouse", f"Stores - {company}"):
            warehouse = f"Stores - {company}"
        else:
            wh_list = frappe.get_all("Warehouse", filters={"company": company, "is_group": 0}, limit=1)
            warehouse = wh_list[0].name if wh_list else ""

    # Validate items and enrich stock metadata
    validated_items = []
    has_stock_items = False

    for idx, row in enumerate(items, 1):
        item_code = (row.get("item_code") or "").strip()
        if not item_code:
            continue

        item_meta = frappe.db.get_value(
            "Item",
            item_code,
            ["item_name", "stock_uom", "is_stock_item", "item_group", "description"],
            as_dict=True
        )
        uom_str = (row.get("uom") or "Nos").strip()
        if uom_str and not frappe.db.exists("UOM", uom_str):
            try:
                new_uom = frappe.new_doc("UOM")
                new_uom.uom_name = uom_str
                new_uom.flags.ignore_permissions = True
                new_uom.insert()
            except Exception:
                uom_str = "Nos"

        if not item_meta:
            # Auto create Item if not existing with smart service / non-stock detection
            is_service = any(k in item_code or k in (row.get("item_name") or "") or k in uom_str for k in ("服务", "费", "维保", "保养", "运费", "维修", "咨询", "租赁", "检测", "试验", "加工", "次", "项"))
            is_stock_val = 0 if is_service else 1
            new_item = frappe.new_doc("Item")
            new_item.item_code = item_code
            new_item.item_name = (row.get("item_name") or item_code).strip()
            new_item.item_group = "All Item Groups"
            new_item.stock_uom = uom_str
            new_item.is_stock_item = is_stock_val
            new_item.description = (row.get("spec") or row.get("remarks") or item_code).strip()
            new_item.flags.ignore_permissions = True
            new_item.insert()
            item_meta = frappe._dict({
                "item_name": new_item.item_name,
                "stock_uom": new_item.stock_uom,
                "is_stock_item": is_stock_val,
                "item_group": "All Item Groups",
                "description": new_item.description,
            })

        qty = flt(row.get("qty") or 0)
        if qty <= 0:
            frappe.throw(_("第 {0} 行物料 [{1}] 数量必须大于 0。").format(idx, item_code))

        rate = flt(row.get("rate") if row.get("rate") is not None else 0)
        if rate <= 0:
            frappe.throw(_("第 {0} 行物料 [{1}] 单价不能为 0！请输入有效单价。").format(idx, item_code))

        amount = flt(row.get("amount") or (qty * rate), 2)
        if amount <= 0:
            frappe.throw(_("第 {0} 行物料 [{1}] 金额不能为 0！").format(idx, item_code))

        tax_rate = flt(row.get("tax_rate") or (0.0 if is_temporary_estimate else 13.0), 2)
        tax_amount = flt(row.get("tax_amount") or (amount * (tax_rate / 100.0)), 2)
        total_amount = flt(row.get("total_amount") or (amount + tax_amount), 2)

        is_stock = bool(item_meta.is_stock_item)
        if is_stock:
            has_stock_items = True

        row_warehouse = (row.get("warehouse") or warehouse).strip()
        if is_stock and not row_warehouse:
            frappe.throw(_("物料 [{0}] 为库存品，必须指定有效的入库仓库。").format(item_code))

        validated_items.append({
            "item_code": item_code,
            "item_name": (row.get("item_name") or item_meta.item_name or item_code).strip(),
            "uom": (row.get("uom") or item_meta.stock_uom or "Nos").strip(),
            "stock_uom": item_meta.stock_uom or "Nos",
            "is_stock_item": is_stock,
            "item_group": item_meta.item_group,
            "qty": qty,
            "rate": rate,
            "amount": amount,
            "tax_rate": tax_rate,
            "tax_amount": tax_amount,
            "total_amount": total_amount,
            "warehouse": row_warehouse,
            "spec": (row.get("spec") or "").strip(),
            "remarks": (row.get("remarks") or row.get("description") or "").strip(),
        })

    if not validated_items:
        frappe.throw(_("请录入至少一行有效的物料明细。"))

    # 1. 如果包含库存品且勾选了自动入库，直接生成并提交采购入库单 (Purchase Receipt)，无需 PO
    created_pr_name = None
    pr_item_map = {}
    if auto_receive_stock and has_stock_items:
        pr = frappe.new_doc("Purchase Receipt")
        pr.company = company
        pr.supplier = supplier
        pr.posting_date = bill_date_str
        if _meta_has("Purchase Receipt", "custom_biz_mode"):
            pr.custom_biz_mode = "自办电汇"

        for it in validated_items:
            if not it["is_stock_item"]:
                continue
            pr_row = {
                "item_code": it["item_code"],
                "item_name": it["item_name"],
                "description": it["remarks"] or it["spec"] or it["item_name"],
                "item_group": it["item_group"],
                "uom": it["uom"],
                "stock_uom": it["stock_uom"],
                "qty": it["qty"],
                "rate": it["rate"],
                "amount": it["amount"],
                "warehouse": it["warehouse"],
            }
            if _meta_has("Purchase Receipt Item", "custom_spec_model"):
                pr_row["custom_spec_model"] = it["spec"]
            if _meta_has("Purchase Receipt Item", "custom_line_remark"):
                pr_row["custom_line_remark"] = it["remarks"]
            if _meta_has("Purchase Receipt Item", "custom_tax_rate"):
                pr_row["custom_tax_rate"] = it["tax_rate"]
            if _meta_has("Purchase Receipt Item", "custom_tax_amount"):
                pr_row["custom_tax_amount"] = it["tax_amount"]
            if _meta_has("Purchase Receipt Item", "custom_total_amount"):
                pr_row["custom_total_amount"] = it["total_amount"]
            pr.append("items", pr_row)

        if pr.items:
            pr.flags.ignore_permissions = True
            pr.insert()
            pr.submit()
            created_pr_name = pr.name
            pr_item_map = {item.item_code: item.name for item in pr.items}

    # 2. 自动生成并提交采购发票 (Purchase Invoice)
    pi = frappe.new_doc("Purchase Invoice")
    pi.company = company
    pi.supplier = supplier
    pi.bill_no = bill_no
    pi.bill_date = bill_date_str
    pi.posting_date = bill_date_str
    if _meta_has("Purchase Invoice", "custom_biz_mode"):
        pi.custom_biz_mode = "自办电汇"
    if _meta_has("Purchase Invoice", "custom_invoice_type"):
        pi.custom_invoice_type = invoice_type or "专用发票"

    for it in validated_items:
        pi_row = {
            "item_code": it["item_code"],
            "item_name": it["item_name"],
            "description": it["remarks"] or it["spec"] or it["item_name"],
            "item_group": it["item_group"],
            "uom": it["uom"],
            "stock_uom": it["stock_uom"],
            "qty": it["qty"],
            "rate": it["rate"],
            "amount": it["amount"],
            "warehouse": it["warehouse"],
            "purchase_receipt": created_pr_name if (it["is_stock_item"] and created_pr_name) else "",
            "pr_detail": pr_item_map.get(it["item_code"]) if (it["is_stock_item"] and created_pr_name) else "",
        }
        if _meta_has("Purchase Invoice Item", "custom_spec_model"):
            pi_row["custom_spec_model"] = it["spec"]
        if _meta_has("Purchase Invoice Item", "custom_line_remark"):
            pi_row["custom_line_remark"] = it["remarks"]
        if _meta_has("Purchase Invoice Item", "custom_tax_rate"):
            pi_row["custom_tax_rate"] = it["tax_rate"]
        if _meta_has("Purchase Invoice Item", "custom_tax_amount"):
            pi_row["custom_tax_amount"] = it["tax_amount"]
        if _meta_has("Purchase Invoice Item", "custom_total_amount"):
            pi_row["custom_total_amount"] = it["total_amount"]
        pi.append("items", pi_row)

    pi.flags.ignore_permissions = True
    pi.insert()
    pi.submit()

    # 3. 自动生成并提交领料出库单 (Stock Entry - Material Issue)，实现即入即出
    created_se_name = None
    if auto_issue_stock and has_stock_items and created_pr_name:
        se = frappe.new_doc("Stock Entry")
        se.company = company
        se.stock_entry_type = "Material Issue"
        se.purpose = "Material Issue"
        se.posting_date = bill_date_str
        se.from_warehouse = warehouse
        se.purchase_receipt_no = created_pr_name
        se.remarks = f"自办电汇领料出库 · 发票: {pi.name} · 入库单: {created_pr_name}"
        if _meta_has("Stock Entry", "custom_biz_mode"):
            se.custom_biz_mode = "自办电汇"

        for it in validated_items:
            if not it["is_stock_item"]:
                continue
            se.append("items", {
                "item_code": it["item_code"],
                "item_name": it["item_name"],
                "qty": it["qty"],
                "uom": it["uom"],
                "stock_uom": it["stock_uom"],
                "s_warehouse": it["warehouse"],
                "description": it["remarks"] or it["spec"] or it["item_name"],
            })

        if se.items:
            se.flags.ignore_permissions = True
            se.insert()
            se.submit()
            created_se_name = se.name

    # 4. 自动创建报销/电汇整算单 (Reimbursement Request)
    created_rr_name = None
    if create_reimbursement_request and frappe.db.exists("DocType", "Reimbursement Request"):
        rr = frappe.new_doc("Reimbursement Request")
        rr.company = company
        rr.title = f"自办电汇整算_{supplier}_{bill_no}"
        rr.applicant = applicant or frappe.session.user
        rr.posting_date = bill_date_str
        rr.supplier = supplier
        if _meta_has("Reimbursement Request", "custom_biz_mode"):
            rr.custom_biz_mode = "自办电汇"
        if _meta_has("Reimbursement Request", "custom_payment_method"):
            rr.custom_payment_method = "电汇"

        for pii in pi.items:
            rr_row = {
                "source_pi": pi.name,
                "source_pi_item": pii.name,
                "item_name": pii.item_name or pii.item_code,
                "description": pii.description or pii.item_name,
                "qty": pii.qty,
                "rate": pii.rate,
                "amount": flt(pii.amount or (pii.qty * pii.rate), 2),
                "claimed_amount": flt(pii.amount or (pii.qty * pii.rate), 2),
                "supplier": supplier,
                "invoice_no": bill_no,
            }
            if _meta_has("Reimbursement Invoice Item", "custom_line_remark"):
                rr_row["custom_line_remark"] = pii.get("custom_line_remark") or ""
            if _meta_has("Reimbursement Invoice Item", "tax_rate"):
                rr_row["tax_rate"] = pii.get("custom_tax_rate") or pii.get("tax_rate") or (0 if is_temporary_estimate else 13)
            if _meta_has("Reimbursement Invoice Item", "tax_amount"):
                rr_row["tax_amount"] = pii.get("custom_tax_amount") or 0
            rr.append("invoice_items", rr_row)

        rr.flags.ignore_permissions = True
        rr.insert()
        rr.submit()
        created_rr_name = rr.name

    return {
        "success": True,
        "pr_name": created_pr_name,
        "pi_name": pi.name,
        "se_name": created_se_name,
        "rr_name": created_rr_name,
        "grand_total": flt(pi.grand_total or pi.total),
        "is_temporary_estimate": is_temporary_estimate,
        "message": _("自办电汇单据生成成功！发票：{0}，入库单：{1}，出库单：{2}，整算单：{3}").format(
            pi.name,
            created_pr_name or "在途待到货确认",
            created_se_name or "未出库",
            created_rr_name or "未生成整算单",
        ),
    }


# =========================================================================
# 4. One-Click Actions: 确认入库 & 补录发票
# =========================================================================

@frappe.whitelist(methods=["POST"])
def receive_wire_transfer_stock(
    pi_names: list | str,
    warehouse: str | None = None,
    auto_issue: int | bool = 1,
) -> dict:
    """One-click receive stock (PR + optional SE) for in-transit (paid_pending_receipt) wire transfer invoices."""
    if isinstance(pi_names, str):
        pi_names = frappe.parse_json(pi_names) or []
    pi_names = list(dict.fromkeys(pi_names or []))

    if not pi_names:
        frappe.throw(_("请选择需要确认入库的自办电汇发票。"))

    auto_issue = bool(int(auto_issue))
    results = []

    for pi_name in pi_names:
        pi = frappe.get_doc("Purchase Invoice", pi_name)
        assert_company_access(pi.company)

        # Check existing PR
        existing_prs = [item.purchase_receipt for item in pi.items if item.purchase_receipt]
        if existing_prs:
            continue

        # Filter stock items
        stock_items = []
        for pii in pi.items:
            is_stock = frappe.db.get_value("Item", pii.item_code, "is_stock_item")
            if is_stock:
                stock_items.append(pii)

        if not stock_items:
            continue

        target_wh = warehouse or stock_items[0].warehouse or f"Goods In Transit - {pi.company}"

        # 1. Create and submit Purchase Receipt
        pr = frappe.new_doc("Purchase Receipt")
        pr.company = pi.company
        pr.supplier = pi.supplier
        pr.posting_date = nowdate()
        if _meta_has("Purchase Receipt", "custom_biz_mode"):
            pr.custom_biz_mode = "自办电汇"

        for sit in stock_items:
            pr_row = {
                "item_code": sit.item_code,
                "item_name": sit.item_name,
                "description": sit.description or sit.item_name,
                "uom": sit.uom or sit.stock_uom,
                "stock_uom": sit.stock_uom or sit.uom,
                "qty": sit.qty,
                "rate": sit.rate,
                "amount": sit.amount,
                "warehouse": sit.warehouse or target_wh,
            }
            pr.append("items", pr_row)

        pr.flags.ignore_permissions = True
        pr.insert()
        pr.submit()

        # Update PI items with PR reference
        for pii in pi.items:
            if pii.item_code in [s.item_code for s in stock_items]:
                pii.db_set("purchase_receipt", pr.name)

        # 2. Optional Stock Entry (Material Issue)
        se_name = None
        if auto_issue:
            se = frappe.new_doc("Stock Entry")
            se.company = pi.company
            se.stock_entry_type = "Material Issue"
            se.purpose = "Material Issue"
            se.posting_date = nowdate()
            se.from_warehouse = target_wh
            se.purchase_receipt_no = pr.name
            se.remarks = f"自办电汇到货确认出库 · 发票: {pi.name} · 入库单: {pr.name}"
            if _meta_has("Stock Entry", "custom_biz_mode"):
                se.custom_biz_mode = "自办电汇"

            for sit in stock_items:
                se.append("items", {
                    "item_code": sit.item_code,
                    "item_name": sit.item_name,
                    "qty": sit.qty,
                    "uom": sit.uom or sit.stock_uom,
                    "stock_uom": sit.stock_uom or sit.uom,
                    "s_warehouse": sit.warehouse or target_wh,
                    "description": sit.description or sit.item_name,
                })

            if se.items:
                se.flags.ignore_permissions = True
                se.insert()
                se.submit()
                se_name = se.name

        pi.add_comment("Comment", text=f"【自办电汇】到货确认入库完成：入库单 {pr.name}" + (f"，出库单 {se_name}" if se_name else ""))
        results.append({
            "pi_name": pi.name,
            "pr_name": pr.name,
            "se_name": se_name,
        })

    return {
        "success": True,
        "count": len(results),
        "results": results,
        "message": _("到货确认入库完成！共处理 {0} 笔发票的实物入库。").format(len(results)),
    }


@frappe.whitelist(methods=["POST"])
def complete_wire_transfer_invoice(
    pi_name: str,
    bill_no: str,
    bill_date: str | None = None,
    invoice_type: str = "专用发票",
) -> dict:
    """One-click complete official tax invoice for temporary estimate (received_pending_invoice) records."""
    if not pi_name:
        frappe.throw(_("请提供需要补录发票的采购发票编号。"))

    if not bill_no or not bill_no.strip():
        frappe.throw(_("正式发票号码不能为空，请输入有效的税局发票号码。"))

    bill_no = bill_no.strip()
    bill_date_str = get_effective_work_date(bill_date)

    pi = frappe.get_doc("Purchase Invoice", pi_name)
    assert_company_access(pi.company)

    # Check duplicate
    dup = frappe.db.get_value(
        "Purchase Invoice",
        {"supplier": pi.supplier, "bill_no": bill_no, "name": ["!=", pi_name], "docstatus": ["!=", 2]},
        ["name", "posting_date"],
        as_dict=True,
    )
    if dup:
        frappe.throw(
            _("发票号【{0}】已存在于发票【{1}】中，禁止重复登记！").format(bill_no, dup.name)
        )

    # Update Purchase Invoice
    pi.db_set("bill_no", bill_no)
    pi.db_set("bill_date", bill_date_str)
    if _meta_has("Purchase Invoice", "custom_invoice_type"):
        pi.db_set("custom_invoice_type", invoice_type or "专用发票")

    # Update linked Reimbursement Request items
    if frappe.db.exists("DocType", "Reimbursement Invoice Item"):
        frappe.db.sql("""
            UPDATE `tabReimbursement Invoice Item`
            SET invoice_no = %s
            WHERE source_pi = %s
        """, (bill_no, pi_name))

    pi.add_comment("Comment", text=f"【自办电汇】已补录税局正式发票：{bill_no}（开票日期：{bill_date_str}，类型：{invoice_type}）")

    return {
        "success": True,
        "pi_name": pi.name,
        "bill_no": bill_no,
        "message": _("正式发票补录成功！发票号：{0}").format(bill_no),
    }


# =========================================================================
# 5. Batch Issue All Stock ("全部出库") & Link Reimbursement Request
# =========================================================================

@frappe.whitelist(methods=["POST"])
def issue_all_wire_transfer_stock(pi_names: list | str) -> dict:
    """Batch create Stock Entry (Material Issue) for selected wire transfer Purchase Invoices."""
    if isinstance(pi_names, str):
        pi_names = frappe.parse_json(pi_names) or []
    pi_names = list(dict.fromkeys(pi_names or []))

    if not pi_names:
        frappe.throw(_("请选择需要出库的自办电汇发票记录。"))

    created_ses = []
    created_rrs = []

    for pi_name in pi_names:
        pi = frappe.get_doc("Purchase Invoice", pi_name)
        assert_company_access(pi.company)

        # 检查是否已有出库单
        existing_se = frappe.db.sql("""
            SELECT name FROM `tabStock Entry`
            WHERE docstatus = 1
              AND purpose = 'Material Issue'
              AND (
                  remarks LIKE %s
                  OR (purchase_receipt_no IS NOT NULL AND purchase_receipt_no != '' AND purchase_receipt_no IN (
                      SELECT DISTINCT purchase_receipt FROM `tabPurchase Invoice Item`
                      WHERE parent = %s AND purchase_receipt IS NOT NULL AND purchase_receipt != ''
                  ))
              )
            LIMIT 1
        """, (f"%{pi_name}%", pi_name))

        pr_name = None
        for item in pi.items:
            if item.purchase_receipt:
                pr_name = item.purchase_receipt
                break

        if not existing_se:
            # 查找库存品并生成出库单
            stock_items = []
            for item in pi.items:
                is_stock = frappe.db.get_value("Item", item.item_code, "is_stock_item")
                if is_stock:
                    stock_items.append(item)

            if stock_items:
                se = frappe.new_doc("Stock Entry")
                se.company = pi.company
                se.stock_entry_type = "Material Issue"
                se.purpose = "Material Issue"
                se.posting_date = pi.posting_date or get_effective_work_date()
                se.from_warehouse = stock_items[0].warehouse or f"Goods In Transit - {pi.company}"
                if pr_name:
                    se.purchase_receipt_no = pr_name
                se.remarks = f"自办电汇领料出库 · 发票: {pi.name}" + (f" · 入库单: {pr_name}" if pr_name else "")
                if _meta_has("Stock Entry", "custom_biz_mode"):
                    se.custom_biz_mode = "自办电汇"

                for sit in stock_items:
                    se.append("items", {
                        "item_code": sit.item_code,
                        "item_name": sit.item_name,
                        "qty": sit.qty,
                        "uom": sit.uom or sit.stock_uom,
                        "stock_uom": sit.stock_uom or sit.uom,
                        "s_warehouse": sit.warehouse or se.from_warehouse,
                        "description": sit.description or sit.item_name,
                    })

                if se.items:
                    se.flags.ignore_permissions = True
                    se.insert()
                    se.submit()
                    created_ses.append({"pi_name": pi.name, "se_name": se.name})

        # 检查是否已有关联整算单 (Reimbursement Request)
        existing_rr = frappe.db.sql("""
            SELECT parent FROM `tabReimbursement Invoice Item` rii
            INNER JOIN `tabReimbursement Request` rr ON rr.name = rii.parent
            WHERE rii.source_pi = %s AND rr.docstatus < 2
            LIMIT 1
        """, (pi_name,))

        if not existing_rr and frappe.db.exists("DocType", "Reimbursement Request"):
            rr = frappe.new_doc("Reimbursement Request")
            rr.company = pi.company
            rr.title = f"自办电汇整算_{pi.supplier}_{pi.bill_no or pi.name}"
            rr.applicant = pi.owner or frappe.session.user
            rr.posting_date = pi.posting_date or get_effective_work_date()
            rr.supplier = pi.supplier
            if _meta_has("Reimbursement Request", "custom_biz_mode"):
                rr.custom_biz_mode = "自办电汇"
            if _meta_has("Reimbursement Request", "custom_payment_method"):
                rr.custom_payment_method = "电汇"

            for pii in pi.items:
                rr_row = {
                    "source_pi": pi.name,
                    "source_pi_item": pii.name,
                    "item_name": pii.item_name or pii.item_code,
                    "description": pii.description or pii.item_name,
                    "qty": pii.qty,
                    "rate": pii.rate,
                    "amount": flt(pii.amount or (pii.qty * pii.rate), 2),
                    "claimed_amount": flt(pii.amount or (pii.qty * pii.rate), 2),
                    "supplier": pi.supplier,
                    "invoice_no": pi.bill_no or "",
                }
                if _meta_has("Reimbursement Invoice Item", "custom_line_remark"):
                    rr_row["custom_line_remark"] = pii.get("custom_line_remark") or ""
                if _meta_has("Reimbursement Invoice Item", "tax_rate"):
                    rr_row["tax_rate"] = pii.get("custom_tax_rate") or pii.get("tax_rate") or 13
                if _meta_has("Reimbursement Invoice Item", "tax_amount"):
                    rr_row["tax_amount"] = pii.get("custom_tax_amount") or 0
                rr.append("invoice_items", rr_row)

            rr.flags.ignore_permissions = True
            rr.insert()
            rr.submit()
            created_rrs.append({"pi_name": pi.name, "rr_name": rr.name})

    msg = _("全部出库与整算关联处理完成！共生成 {0} 张领料出库单，{1} 张整算单。").format(
        len(created_ses), len(created_rrs)
    )

    return {
        "success": True,
        "issued_count": len(created_ses),
        "created_ses": created_ses,
        "created_rrs": created_rrs,
        "message": msg,
    }


# =========================================================================
# 6. Single Document Quick Creation RPCs (PR, SE, RR)
# =========================================================================

@frappe.whitelist(methods=["POST"])
def create_wire_transfer_stock_entry(pi_name: str, warehouse: str | None = None) -> dict:
    """Create a single Stock Entry (Material Issue) for a wire transfer Purchase Invoice."""
    if not pi_name or not pi_name.strip():
        frappe.throw(_("请指定自办发票号。"))
    pi = frappe.get_doc("Purchase Invoice", pi_name.strip())
    assert_company_access(pi.company)

    # 查找库存品
    stock_items = []
    for item in pi.items:
        is_stock = frappe.db.get_value("Item", item.item_code, "is_stock_item")
        if is_stock:
            stock_items.append(item)

    if not stock_items:
        frappe.throw(_("发票【{0}】中无库存物料，无需生成出库单。").format(pi.name))

    pr_name = None
    for item in pi.items:
        if item.purchase_receipt:
            pr_name = item.purchase_receipt
            break

    target_wh = (warehouse or "").strip()
    if not target_wh:
        for item in stock_items:
            if item.warehouse:
                target_wh = item.warehouse
                break
    if not target_wh and pr_name:
        pr_wh = frappe.db.get_value("Purchase Receipt Item", {"parent": pr_name}, "warehouse")
        if pr_wh:
            target_wh = pr_wh
    if not target_wh:
        target_wh = f"Goods In Transit - {pi.company}"
        if not frappe.db.exists("Warehouse", target_wh):
            target_wh = frappe.db.get_value("Warehouse", {"company": pi.company, "is_group": 0}, "name")

    se = frappe.new_doc("Stock Entry")
    se.company = pi.company
    se.stock_entry_type = "Material Issue"
    se.purpose = "Material Issue"
    se.posting_date = pi.posting_date or get_effective_work_date()
    se.from_warehouse = target_wh
    if pr_name:
        se.purchase_receipt_no = pr_name
    se.remarks = f"自办电汇领料出库 · 发票: {pi.name}" + (f" · 入库单: {pr_name}" if pr_name else "")
    if _meta_has("Stock Entry", "custom_biz_mode"):
        se.custom_biz_mode = "自办电汇"

    for sit in stock_items:
        se.append("items", {
            "item_code": sit.item_code,
            "item_name": sit.item_name,
            "qty": sit.qty,
            "uom": sit.uom or sit.stock_uom,
            "stock_uom": sit.stock_uom or sit.uom,
            "s_warehouse": sit.warehouse or target_wh,
            "description": sit.description or sit.item_name,
        })

    se.flags.ignore_permissions = True
    se.insert()
    se.submit()

    pi.add_comment("Comment", text=f"【自办电汇】已补建领料出库单：{se.name}")

    return {
        "success": True,
        "se_name": se.name,
        "message": _("领料出库单创建成功！单号：{0}").format(se.name),
    }


@frappe.whitelist(methods=["POST"])
def create_wire_transfer_reimbursement_request(pi_name: str) -> dict:
    """Create a Reimbursement Request for a specific wire transfer Purchase Invoice if missing."""
    if not pi_name or not pi_name.strip():
        frappe.throw(_("请指定自办发票号。"))
    pi = frappe.get_doc("Purchase Invoice", pi_name.strip())
    assert_company_access(pi.company)

    # Check if already linked
    existing_rr = frappe.db.sql("""
        SELECT parent FROM `tabReimbursement Invoice Item` rii
        INNER JOIN `tabReimbursement Request` rr ON rr.name = rii.parent
        WHERE rii.source_pi = %s AND rr.docstatus < 2
        LIMIT 1
    """, (pi.name,))

    if existing_rr:
        return {
            "success": True,
            "rr_name": existing_rr[0][0],
            "message": _("该发票已存在关联整算单：{0}").format(existing_rr[0][0]),
        }

    if not frappe.db.exists("DocType", "Reimbursement Request"):
        frappe.throw(_("未安装或未启用整算报销模块 (Reimbursement Request)。"))

    rr = frappe.new_doc("Reimbursement Request")
    rr.company = pi.company
    rr.title = f"自办电汇整算_{pi.supplier}_{pi.bill_no or pi.name}"
    rr.applicant = pi.owner or frappe.session.user
    rr.posting_date = pi.posting_date or get_effective_work_date()
    rr.supplier = pi.supplier
    if _meta_has("Reimbursement Request", "custom_biz_mode"):
        rr.custom_biz_mode = "自办电汇"
    if _meta_has("Reimbursement Request", "custom_payment_method"):
        rr.custom_payment_method = "电汇"

    for pii in pi.items:
        rr_row = {
            "source_pi": pi.name,
            "source_pi_item": pii.name,
            "item_name": pii.item_name or pii.item_code,
            "description": pii.description or pii.item_name,
            "qty": pii.qty,
            "rate": pii.rate,
            "amount": flt(pii.amount or (pii.qty * pii.rate), 2),
            "claimed_amount": flt(pii.amount or (pii.qty * pii.rate), 2),
            "supplier": pi.supplier,
            "invoice_no": pi.bill_no or "",
        }
        if _meta_has("Reimbursement Invoice Item", "custom_line_remark"):
            rr_row["custom_line_remark"] = pii.get("custom_line_remark") or ""
        if _meta_has("Reimbursement Invoice Item", "tax_rate"):
            rr_row["tax_rate"] = pii.get("custom_tax_rate") or pii.get("tax_rate") or 13
        if _meta_has("Reimbursement Invoice Item", "tax_amount"):
            rr_row["tax_amount"] = pii.get("custom_tax_amount") or 0
        rr.append("invoice_items", rr_row)

    rr.flags.ignore_permissions = True
    rr.insert()
    rr.submit()

    pi.add_comment("Comment", text=f"【自办电汇】已补建关联整算单：{rr.name}")

    return {
        "success": True,
        "rr_name": rr.name,
        "message": _("整算单创建成功！单号：{0}").format(rr.name),
    }


@frappe.whitelist(methods=["POST"])
def create_wire_transfer_payment_entry(
    pi_name: str,
    paid_amount: float | None = None,
    mode_of_payment: str | None = None,
    posting_date: str | None = None,
    reference_no: str | None = None,
    remarks: str | None = None,
) -> dict:
    """Create and submit a Payment Entry (Pay) for a wire transfer Purchase Invoice."""
    if not pi_name or not pi_name.strip():
        frappe.throw(_("请指定采购发票号。"))
    pi = frappe.get_doc("Purchase Invoice", pi_name.strip())
    assert_company_access(pi.company)

    if flt(pi.outstanding_amount) <= 0.0001:
        frappe.throw(_("发票【{0}】待付款余额为 0，无需重复生成付款单。").format(pi.name))

    # 确保结算方式存在
    mop = mode_of_payment
    if not mop or not frappe.db.exists("Mode of Payment", mop):
        for candidate in ["电汇", "银行转账", "Wire Transfer", "Bank Draft", "Cash"]:
            if frappe.db.exists("Mode of Payment", candidate):
                mop = candidate
                break
    if not mop or not frappe.db.exists("Mode of Payment", mop):
        new_mop = frappe.new_doc("Mode of Payment")
        new_mop.mode_of_payment = "电汇"
        new_mop.type = "Bank"
        # 绑定公司默认银行账户
        bank_acc = frappe.db.get_value("Company", pi.company, "default_bank_account")
        if bank_acc:
            new_mop.append("accounts", {"company": pi.company, "default_account": bank_acc})
        new_mop.flags.ignore_permissions = True
        new_mop.insert()
        mop = new_mop.name

    from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry

    pay_amt = flt(paid_amount) if (paid_amount and flt(paid_amount) > 0) else flt(pi.outstanding_amount)

    pe = get_payment_entry(
        "Purchase Invoice",
        pi.name,
        party_amount=pay_amt,
    )

    pe.posting_date = posting_date or pi.posting_date or get_effective_work_date()
    pe.mode_of_payment = mop

    if reference_no:
        pe.reference_no = reference_no
    elif not pe.reference_no:
        pe.reference_no = pi.bill_no or pi.name
    pe.reference_date = pe.posting_date

    if remarks:
        pe.remarks = remarks
    else:
        pe.remarks = f"自办电汇付款 · 发票: {pi.name} · 供应商: {pi.supplier}"

    if _meta_has("Payment Entry", "custom_biz_mode"):
        pe.custom_biz_mode = "自办电汇"

    pe.flags.ignore_permissions = True
    pe.insert()
    pe.submit()

    pi.add_comment("Comment", text=f"【自办电汇】已完成电汇付款：付款单 {pe.name}，金额 ¥ {pay_amt:,.2f}")

    return {
        "success": True,
        "pe_name": pe.name,
        "paid_amount": pay_amt,
        "message": _("电汇付款单生成成功！单号：{0}，金额：¥ {1:,.2f}").format(pe.name, pay_amt),
    }
