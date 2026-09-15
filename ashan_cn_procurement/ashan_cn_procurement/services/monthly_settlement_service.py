# ASHAN-COMPLETE: monthly settlement uses native PO/PR/Supplier permission boundaries
# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

from __future__ import annotations

import json
from collections import defaultdict
from typing import Any

import frappe
from frappe import _
from frappe.utils import flt, nowdate

from ashan_cn_procurement.services.authorization_service import assert_company_access
from ashan_cn_procurement.services.procurement_picker_service import (
    get_user_procurement_companies,
)
from ashan_cn_procurement.services.permission_query_service import (
    assert_doctype_permission,
    assert_standard_lifecycle_permissions,
    filter_rows_by_doctype_permission,
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
# 1. KPI Aggregation for 月结补录
# =========================================================================

@frappe.whitelist()
def get_monthly_settlement_overview_kpis(company: str | None = None) -> dict:
    """Return aggregated KPI counts for 月结补录 workflow."""
    assert_doctype_permission("Purchase Receipt", "read")
    companies = _resolve_companies(company)

    # 1. 月结待开票 (Purchase Receipt Item with custom_biz_mode = '月结补录' and billed_amt < amount)
    pr_stats = frappe.db.sql("""
        SELECT
            COUNT(DISTINCT pr.name),
            COUNT(pri.name),
            COALESCE(SUM(pri.amount - COALESCE(pri.billed_amt, 0)), 0),
            COALESCE(SUM(pri.amount), 0)
        FROM `tabPurchase Receipt Item` pri
        INNER JOIN `tabPurchase Receipt` pr ON pr.name = pri.parent
        WHERE pr.docstatus = 1
          AND pr.company IN %s
          AND pr.custom_biz_mode = '月结补录'
          AND (pri.amount - COALESCE(pri.billed_amt, 0)) > 0.0001
    """, (companies,))[0]

    pending_doc_count = pr_stats[0] or 0
    pending_item_count = pr_stats[1] or 0
    pending_unbilled_amount = flt(pr_stats[2] or 0)
    total_receipt_amount = flt(pr_stats[3] or 0)

    # 2. 关联采购订单数 (Purchase Order with custom_biz_mode = '月结补录')
    po_count = frappe.db.sql("""
        SELECT COUNT(name)
        FROM `tabPurchase Order`
        WHERE docstatus = 1
          AND company IN %s
          AND custom_biz_mode = '月结补录'
    """, (companies,))[0][0] or 0

    # 3. 月结入库单总数 (Purchase Receipt with custom_biz_mode = '月结补录')
    pr_total_count = frappe.db.sql("""
        SELECT COUNT(name)
        FROM `tabPurchase Receipt`
        WHERE docstatus = 1
          AND company IN %s
          AND custom_biz_mode = '月结补录'
    """, (companies,))[0][0] or 0

    return {
        "pending_item_count": pending_item_count,
        "pending_doc_count": pending_doc_count,
        "pending_unbilled_amount": pending_unbilled_amount,
        "po_count": po_count,
        "pr_total_count": pr_total_count,
        "total_receipt_amount": total_receipt_amount,
    }


# =========================================================================
# 2. Query Detail & Doc Summary Rows for 月结补录
# =========================================================================

@frappe.whitelist()
def get_monthly_settlement_picker_rows(
    company: str | None = None,
    filters: dict | str | None = None,
) -> dict:
    """Query item detail rows for 月结补录."""
    assert_doctype_permission("Purchase Receipt", "read")
    companies = _resolve_companies(company)
    if isinstance(filters, str):
        filters = frappe.parse_json(filters) or {}
    filters = dict(filters or {})

    match_status = filters.get("match_status") or "pending"

    conditions = [
        "pr.docstatus = 1",
        "pr.company IN %(companies)s",
        "pr.custom_biz_mode = '月结补录'",
    ]
    params: dict[str, Any] = {"companies": companies}

    if match_status == "pending":
        conditions.append("(pri.amount - COALESCE(pri.billed_amt, 0)) > 0.0001")
    elif match_status == "completed":
        conditions.append("(pri.amount - COALESCE(pri.billed_amt, 0)) <= 0.0001")

    if filters.get("supplier"):
        conditions.append("pr.supplier LIKE %(supplier)s")
        params["supplier"] = f"%{filters['supplier']}%"

    if filters.get("pr_name"):
        conditions.append("pr.name LIKE %(pr_name)s")
        params["pr_name"] = f"%{filters['pr_name']}%"

    if filters.get("item_code"):
        conditions.append("(pri.item_code LIKE %(item_code)s OR pri.item_name LIKE %(item_code)s)")
        params["item_code"] = f"%{filters['item_code']}%"

    if filters.get("owner"):
        conditions.append("pr.owner LIKE %(owner)s")
        params["owner"] = f"%{filters['owner']}%"

    where_clause = " AND ".join(conditions)

    has_spec = _meta_has("Purchase Receipt Item", "custom_spec_model")
    spec_col = "COALESCE(pri.custom_spec_model, '')" if has_spec else "''"
    has_remark = _meta_has("Purchase Receipt Item", "custom_line_remark")
    remark_col = "COALESCE(pri.custom_line_remark, '')" if has_remark else "''"
    has_tax_rate = _meta_has("Purchase Receipt Item", "custom_tax_rate")
    tax_rate_col = "COALESCE(pri.custom_tax_rate, 13.0)" if has_tax_rate else "13.0"
    has_tax_amount = _meta_has("Purchase Receipt Item", "custom_tax_amount")
    tax_amount_col = "COALESCE(pri.custom_tax_amount, 0)" if has_tax_amount else "0"
    has_total_amount = _meta_has("Purchase Receipt Item", "custom_total_amount")
    total_amount_col = "COALESCE(pri.custom_total_amount, pri.amount, 0)" if has_total_amount else "COALESCE(pri.amount, 0)"

    sql = f"""
        SELECT
            pri.name AS pri_name,
            pr.name AS pr_name,
            pr.company,
            pr.supplier,
            pr.status AS pr_status,
            pr.posting_date,
            pr.owner,
            pr.grand_total,
            pri.item_code,
            pri.item_name,
            pri.description,
            {spec_col} AS spec,
            {remark_col} AS remarks,
            COALESCE(pri.uom, pri.stock_uom, '') AS uom,
            COALESCE(pri.qty, 1) AS qty,
            COALESCE(pri.rate, 0) AS rate,
            COALESCE(pri.amount, 0) AS amount,
            {tax_rate_col} AS tax_rate,
            {tax_amount_col} AS tax_amount,
            {total_amount_col} AS total_amount,
            COALESCE(pri.billed_amt, 0) AS billed_amt,
            (COALESCE(pri.amount, 0) - COALESCE(pri.billed_amt, 0)) AS unbilled_amount,
            COALESCE(pri.warehouse, '') AS warehouse,
            COALESCE(pri.purchase_order, '') AS purchase_order,
            (
                SELECT GROUP_CONCAT(DISTINCT pii.parent ORDER BY pii.parent DESC SEPARATOR '、')
                FROM `tabPurchase Invoice Item` pii
                INNER JOIN `tabPurchase Invoice` pi_inner ON pi_inner.name = pii.parent
                WHERE pii.purchase_receipt = pr.name AND pi_inner.docstatus < 2
            ) AS linked_pi_names
        FROM `tabPurchase Receipt Item` pri
        INNER JOIN `tabPurchase Receipt` pr ON pr.name = pri.parent
        WHERE {where_clause}
        ORDER BY pr.posting_date DESC, pr.name DESC, pri.idx ASC
        LIMIT 1000
    """

    raw_items = frappe.db.sql(sql, params, as_dict=True)
    raw_items = filter_rows_by_doctype_permission(raw_items, "Purchase Receipt", "pr_name")

    rows = []
    for idx, it in enumerate(raw_items, 1):
        unbilled = max(0.0, flt(it.unbilled_amount))
        status_label = "待开票" if unbilled > 0.0001 else "已开票"

        rows.append({
            "idx": idx,
            "pri_name": it.pri_name,
            "pr_name": it.pr_name,
            "company": it.company,
            "supplier": it.supplier,
            "status_label": status_label,
            "posting_date": str(it.posting_date or ""),
            "owner": it.owner,
            "item_code": it.item_code,
            "item_name": it.item_name or it.item_code,
            "spec": it.spec or "",
            "remarks": it.remarks or "",
            "uom": it.uom,
            "qty": flt(it.qty, 4),
            "rate": flt(it.rate, 2),
            "amount": flt(it.amount, 2),
            "tax_rate": flt(it.tax_rate, 2),
            "tax_amount": flt(it.tax_amount, 2),
            "total_amount": flt(it.total_amount, 2),
            "billed_amt": flt(it.billed_amt, 2),
            "unbilled_amount": unbilled,
            "warehouse": it.warehouse or "",
            "purchase_order": it.purchase_order or "",
            "linked_pi_names": it.linked_pi_names or "-",
        })

    return {
        "rows": rows,
        "total_count": len(rows),
        "total_qty": sum(r["qty"] for r in rows),
        "total_amount": sum(r["amount"] for r in rows),
        "total_tax": sum(r["tax_amount"] for r in rows),
        "total_unbilled": sum(r["unbilled_amount"] for r in rows),
    }


@frappe.whitelist()
def get_monthly_settlement_doc_summary_rows(
    company: str | None = None,
    filters: dict | str | None = None,
) -> dict:
    """Query document level summary rows for 月结补录."""
    assert_doctype_permission("Purchase Receipt", "read")
    companies = _resolve_companies(company)
    if isinstance(filters, str):
        filters = frappe.parse_json(filters) or {}
    filters = dict(filters or {})

    match_status = filters.get("match_status") or "pending"

    conditions = [
        "pr.docstatus = 1",
        "pr.company IN %(companies)s",
        "pr.custom_biz_mode = '月结补录'",
    ]
    params: dict[str, Any] = {"companies": companies}

    if match_status == "pending":
        conditions.append("""
            EXISTS (
                SELECT 1 FROM `tabPurchase Receipt Item` pri_sub
                WHERE pri_sub.parent = pr.name
                  AND (pri_sub.amount - COALESCE(pri_sub.billed_amt, 0)) > 0.0001
            )
        """)
    elif match_status == "completed":
        conditions.append("""
            NOT EXISTS (
                SELECT 1 FROM `tabPurchase Receipt Item` pri_sub
                WHERE pri_sub.parent = pr.name
                  AND (pri_sub.amount - COALESCE(pri_sub.billed_amt, 0)) > 0.0001
            )
        """)

    if filters.get("supplier"):
        conditions.append("pr.supplier LIKE %(supplier)s")
        params["supplier"] = f"%{filters['supplier']}%"

    if filters.get("pr_name"):
        conditions.append("pr.name LIKE %(pr_name)s")
        params["pr_name"] = f"%{filters['pr_name']}%"

    if filters.get("owner"):
        conditions.append("pr.owner LIKE %(owner)s")
        params["owner"] = f"%{filters['owner']}%"

    where_clause = " AND ".join(conditions)

    sql = f"""
        SELECT
            pr.name AS pr_name,
            pr.company,
            pr.supplier,
            pr.status,
            pr.posting_date,
            pr.owner,
            pr.grand_total,
            COALESCE(pr.custom_doc_details, '') AS doc_details,
            (
                SELECT COUNT(pri.name)
                FROM `tabPurchase Receipt Item` pri
                WHERE pri.parent = pr.name
            ) AS item_count,
            (
                SELECT COALESCE(SUM(pri.qty), 0)
                FROM `tabPurchase Receipt Item` pri
                WHERE pri.parent = pr.name
            ) AS total_qty,
            (
                SELECT COALESCE(SUM(pri.amount), 0)
                FROM `tabPurchase Receipt Item` pri
                WHERE pri.parent = pr.name
            ) AS total_amount,
            (
                SELECT COALESCE(SUM(pri.amount - COALESCE(pri.billed_amt, 0)), 0)
                FROM `tabPurchase Receipt Item` pri
                WHERE pri.parent = pr.name
            ) AS unbilled_amount,
            (
                SELECT GROUP_CONCAT(DISTINCT pri.purchase_order ORDER BY pri.purchase_order DESC SEPARATOR '、')
                FROM `tabPurchase Receipt Item` pri
                WHERE pri.parent = pr.name AND pri.purchase_order IS NOT NULL AND pri.purchase_order != ''
            ) AS linked_pos,
            (
                SELECT GROUP_CONCAT(DISTINCT pii.parent ORDER BY pii.parent DESC SEPARATOR '、')
                FROM `tabPurchase Invoice Item` pii
                INNER JOIN `tabPurchase Invoice` pi_inner ON pi_inner.name = pii.parent
                WHERE pii.purchase_receipt = pr.name AND pi_inner.docstatus < 2
            ) AS linked_pis
        FROM `tabPurchase Receipt` pr
        WHERE {where_clause}
        ORDER BY pr.posting_date DESC, pr.name DESC
        LIMIT 500
    """

    raw_docs = frappe.db.sql(sql, params, as_dict=True)
    raw_docs = filter_rows_by_doctype_permission(raw_docs, "Purchase Receipt", "pr_name")

    rows = []
    for idx, d in enumerate(raw_docs, 1):
        unbilled = max(0.0, flt(d.unbilled_amount))
        status_label = "待开票" if unbilled > 0.0001 else "已开票"

        rows.append({
            "idx": idx,
            "pr_name": d.pr_name,
            "company": d.company,
            "supplier": d.supplier,
            "status_label": status_label,
            "posting_date": str(d.posting_date or ""),
            "owner": d.owner,
            "item_count": int(d.item_count or 0),
            "total_qty": flt(d.total_qty, 2),
            "total_amount": flt(d.total_amount, 2),
            "unbilled_amount": unbilled,
            "grand_total": flt(d.grand_total, 2),
            "doc_details": d.doc_details or "-",
            "linked_pos": d.linked_pos or "-",
            "linked_pis": d.linked_pis or "-",
        })

    return {
        "rows": rows,
        "total_count": len(rows),
        "total_qty": sum(r["total_qty"] for r in rows),
        "total_amount": sum(r["total_amount"] for r in rows),
        "total_unbilled": sum(r["unbilled_amount"] for r in rows),
    }


# =========================================================================
# 3. Monthly Settlement Fast Receipt Creation Engine (PO + PR Auto Bundle)
# =========================================================================

def _ensure_supplier(supplier_name: str) -> str:
    """Ensure supplier exists in ERPNext Supplier DocType, create if missing."""
    supplier_name = (supplier_name or "").strip()
    if not supplier_name:
        return "其它供应商"
    if not frappe.db.exists("Supplier", supplier_name):
        assert_doctype_permission("Supplier", "create")
        supp_doc = frappe.new_doc("Supplier")
        supp_doc.supplier_name = supplier_name
        supp_doc.supplier_group = "All Supplier Groups"
        supp_doc.insert()
        return supp_doc.name
    return supplier_name


@frappe.whitelist(methods=["POST"])
def create_monthly_settlement_receipt_bundle(
    company: str,
    supplier: str,
    posting_date: str | None = None,
    warehouse: str | None = None,
    items: list[dict] | str | None = None,
) -> dict:
    """Receipt-driven fast creation of PO + PR (submitted) with custom_biz_mode='月结补录'."""
    assert_standard_lifecycle_permissions("Purchase Order", create=True, submit=True)
    assert_standard_lifecycle_permissions("Purchase Receipt", create=True, submit=True)
    assert_doctype_permission("Item", "read")
    assert_company_access(company)

    if isinstance(items, str):
        items = json.loads(items) or []
    if not items:
        frappe.throw(_("请录入至少一行有效的入库物料明细。"))

    posting_date_str = get_effective_work_date(posting_date)
    supplier_val = _ensure_supplier(supplier)

    # Resolve Default Warehouse
    if not warehouse:
        if frappe.db.exists("Warehouse", f"Goods In Transit - {company}"):
            warehouse = f"Goods In Transit - {company}"
        elif frappe.db.exists("Warehouse", f"Stores - {company}"):
            warehouse = f"Stores - {company}"
        else:
            wh_list = frappe.get_all("Warehouse", filters={"company": company, "is_group": 0}, limit=1)
            warehouse = wh_list[0].name if wh_list else ""

    # Validate items
    validated_items = []
    for idx, row in enumerate(items, 1):
        item_code = (row.get("item_code") or "").strip()
        if not item_code:
            frappe.throw(_("第 {0} 行物料编码不能为空。").format(idx))

        item_meta = frappe.db.get_value(
            "Item",
            item_code,
            ["item_name", "stock_uom", "is_stock_item", "item_group", "description"],
            as_dict=True,
        )
        if not item_meta:
            frappe.throw(_("第 {0} 行物料 [{1}] 在系统中不存在。").format(idx, item_code))

        qty = flt(row.get("qty") or 0.0)
        rate = flt(row.get("rate") or 0.0)
        amount = flt(row.get("amount") or (qty * rate))

        if qty <= 0 or rate <= 0 or amount <= 0:
            frappe.throw(
                _("第 {0} 行物料 [{1}] 的数量({2})、单价(¥{3:.2f})或金额(¥{4:.2f})必须大于0！根据财务纪律，单价与金额严禁为0。").format(
                    idx, item_code, qty, rate, amount
                )
            )

        tax_rate = flt(row.get("tax_rate") or 13.0)
        tax_amount = flt(row.get("tax_amount") or (amount * (tax_rate / 100.0)))
        total_amount = flt(row.get("total_amount") or (amount + tax_amount))

        item_wh = (row.get("warehouse") or "").strip() or warehouse

        validated_items.append({
            "idx": idx,
            "item_code": item_code,
            "item_name": (row.get("item_name") or "").strip() or item_meta.item_name,
            "spec": (row.get("spec") or "").strip(),
            "uom": (row.get("uom") or "").strip() or item_meta.stock_uom or "Nos",
            "qty": qty,
            "rate": rate,
            "amount": amount,
            "tax_rate": tax_rate,
            "tax_amount": tax_amount,
            "total_amount": total_amount,
            "warehouse": item_wh,
            "remarks": (row.get("remarks") or "").strip(),
            "is_stock_item": item_meta.is_stock_item,
        })

    # 1. Create Purchase Order (Submitted)
    po = frappe.new_doc("Purchase Order")
    po.company = company
    po.supplier = supplier_val
    po.transaction_date = posting_date_str
    po.schedule_date = posting_date_str
    po.custom_biz_mode = "月结补录"

    for it in validated_items:
        po_row = po.append("items", {
            "item_code": it["item_code"],
            "item_name": it["item_name"],
            "uom": it["uom"],
            "stock_uom": it["uom"],
            "qty": it["qty"],
            "rate": it["rate"],
            "amount": it["amount"],
            "schedule_date": posting_date_str,
            "warehouse": it["warehouse"],
            "description": it["remarks"] or it["item_name"],
        })
        if _meta_has("Purchase Order Item", "custom_spec_model"):
            po_row.custom_spec_model = it["spec"]
        if _meta_has("Purchase Order Item", "custom_line_remark"):
            po_row.custom_line_remark = it["remarks"]
        if _meta_has("Purchase Order Item", "custom_tax_rate"):
            po_row.custom_tax_rate = it["tax_rate"]
        if _meta_has("Purchase Order Item", "custom_tax_amount"):
            po_row.custom_tax_amount = it["tax_amount"]
        if _meta_has("Purchase Order Item", "custom_total_amount"):
            po_row.custom_total_amount = it["total_amount"]

    po.insert()
    po.submit()

    # 2. Create Purchase Receipt (Submitted)
    pr = frappe.new_doc("Purchase Receipt")
    pr.company = company
    pr.supplier = supplier_val
    pr.posting_date = posting_date_str
    pr.custom_biz_mode = "月结补录"

    for idx, it in enumerate(validated_items):
        po_item_row = po.items[idx]
        pr_row = pr.append("items", {
            "item_code": it["item_code"],
            "item_name": it["item_name"],
            "uom": it["uom"],
            "stock_uom": it["uom"],
            "qty": it["qty"],
            "rate": it["rate"],
            "amount": it["amount"],
            "warehouse": it["warehouse"],
            "purchase_order": po.name,
            "purchase_order_item": po_item_row.name,
            "description": it["remarks"] or it["item_name"],
        })
        if _meta_has("Purchase Receipt Item", "custom_spec_model"):
            pr_row.custom_spec_model = it["spec"]
        if _meta_has("Purchase Receipt Item", "custom_line_remark"):
            pr_row.custom_line_remark = it["remarks"]
        if _meta_has("Purchase Receipt Item", "custom_tax_rate"):
            pr_row.custom_tax_rate = it["tax_rate"]
        if _meta_has("Purchase Receipt Item", "custom_tax_amount"):
            pr_row.custom_tax_amount = it["tax_amount"]
        if _meta_has("Purchase Receipt Item", "custom_total_amount"):
            pr_row.custom_total_amount = it["total_amount"]

    pr.insert()
    pr.submit()

    # Refresh custom_doc_details
    try:
        from ashan_cn_procurement.overrides.document_details import update_doc_details
        update_doc_details(po)
        if po.get("custom_doc_details"):
            frappe.db.set_value("Purchase Order", po.name, "custom_doc_details", po.custom_doc_details, update_modified=False)
        update_doc_details(pr)
        if pr.get("custom_doc_details"):
            frappe.db.set_value("Purchase Receipt", pr.name, "custom_doc_details", pr.custom_doc_details, update_modified=False)
    except Exception:
        pass

    return {
        "success": True,
        "po_name": po.name,
        "pr_name": pr.name,
        "company": company,
        "supplier": supplier,
        "grand_total": flt(pr.grand_total, 2),
    }
