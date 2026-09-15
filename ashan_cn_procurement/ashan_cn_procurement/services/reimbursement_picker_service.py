# ASHAN-UNIFIED-V2: standard lifecycle and permission boundaries
# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

from __future__ import annotations

import json
from datetime import date
import frappe
from frappe import _
from frappe.utils import flt, nowdate
from ashan_cn_procurement.services.authorization_service import (
    assert_company_access,
    get_allowed_companies,
)
from ashan_cn_procurement.services.permission_query_service import (
    assert_doctype_permission,
    assert_standard_lifecycle_permissions,
    filter_rows_by_doctype_permission,
)
from ashan_cn_procurement.services.work_context_service import get_effective_work_date


def _meta_has(doctype: str, fieldname: str) -> bool:
    """Safely check whether a DocType has a specific fieldname in schema."""
    try:
        meta = frappe.get_meta(doctype)
        return meta.has_field(fieldname)
    except Exception:
        return False


def _get_item_spec_column() -> str:
    """Return correct Item spec column based on schema."""
    return "custom_spec_model" if _meta_has("Item", "custom_spec_model") else "description"


def _get_target_companies(company: str | None = None) -> list[str]:
    """Get filtered companies according to user permissions and selection."""
    all_companies = [c.name for c in frappe.get_all("Company", fields=["name"], order_by="name ASC")]
    allowed = get_allowed_companies()
    accessible = all_companies if allowed is None else [c for c in all_companies if c in allowed]

    if company and company != "All":
        assert_company_access(company)
        return [company]
    return accessible


# =========================================================================
# 1. Overview KPIs
# =========================================================================

@frappe.whitelist()
def get_reimbursement_picker_overview_kpis(company: str | None = None) -> dict:
    """Get top 4 KPI cards data for Reimbursement Picker."""
    assert_doctype_permission("Reimbursement Request", "read")
    target_companies = _get_target_companies(company)
    if not target_companies:
        return {
            "pending_rr_count": 0,
            "pi_count": 0,
            "pr_count": 0,
            "rr_outstanding": 0.0,
        }

    comp_list = target_companies

    # 1. 待结款报销单数量 (包含已提交待结款与草稿)
    pending_rr_res = frappe.db.sql(
        """
        SELECT COUNT(name) AS cnt
        FROM `tabReimbursement Request`
        WHERE company IN %(comps)s
          AND (docstatus = 0 OR (docstatus = 1 AND outstanding_amount > 0))
        """,
        {"comps": comp_list},
        as_dict=True,
    )
    pending_rr_count = pending_rr_res[0].cnt if pending_rr_res else 0

    # 2. 关联采购发票数量 (现金报销业务)
    pi_count = frappe.db.count(
        "Purchase Invoice",
        filters={
            "company": ["in", comp_list],
            "docstatus": 1,
            "custom_biz_mode": "现金报销",
        },
    )

    # 3. 关联入库单数量 (现金报销业务)
    pr_count = frappe.db.count(
        "Purchase Receipt",
        filters={
            "company": ["in", comp_list],
            "docstatus": 1,
            "custom_biz_mode": "现金报销",
        },
    )

    # 4. 待付款结清总额
    outstanding_res = frappe.db.sql(
        """
        SELECT COALESCE(SUM(outstanding_amount), 0.0) AS total_out
        FROM `tabReimbursement Request`
        WHERE company IN %(comps)s
          AND docstatus IN (0, 1)
          AND outstanding_amount > 0
        """,
        {"comps": comp_list},
        as_dict=True,
    )
    rr_outstanding = flt(outstanding_res[0].total_out if outstanding_res else 0.0, 2)

    return {
        "pending_rr_count": pending_rr_count,
        "pi_count": pi_count,
        "pr_count": pr_count,
        "rr_outstanding": rr_outstanding,
    }


# =========================================================================
# 2. Doc Summary Rows (Drafts on TOP + Amber Alert Badge)
# =========================================================================

def _format_compact_preview(items: list[str], max_items: int = 2) -> str:
    """Format compact string with ellipsis."""
    if not items:
        return "-"
    if len(items) <= max_items:
        return "、".join(items)
    return "、".join(items[:max_items]) + f" 等{len(items)}项"


@frappe.whitelist()
def get_reimbursement_picker_doc_summary_rows(
    company: str | None = None,
    filters: dict | str | None = None,
) -> dict:
    """Query doc-level summary rows for 报销申请 with Drafts pinned on TOP."""
    assert_doctype_permission("Reimbursement Request", "read")
    target_companies = _get_target_companies(company)
    if not target_companies:
        return {"rows": [], "total_count": 0, "total_amount": 0, "total_outstanding": 0}

    if isinstance(filters, str):
        try:
            filters = json.loads(filters)
        except Exception:
            filters = {}
    filters = filters or {}

    where_clauses = ["rr.company IN %(comps)s", "rr.docstatus IN (0, 1)"]
    params = {"comps": target_companies}

    match_status = filters.get("match_status", "pending")
    if match_status == "pending":
        where_clauses.append("(rr.outstanding_amount > 0 OR rr.docstatus = 0)")
    elif match_status == "completed":
        where_clauses.append("rr.outstanding_amount <= 0.0001 AND rr.docstatus = 1")
    elif match_status == "draft":
        where_clauses.append("rr.docstatus = 0")

    if filters.get("supplier"):
        where_clauses.append("""
            EXISTS (
                SELECT 1 FROM `tabReimbursement Invoice Item` rii
                WHERE rii.parent = rr.name AND rii.supplier LIKE %(supp)s
            )
        """)
        params["supp"] = f"%{filters['supplier'].strip()}%"

    if filters.get("invoice_no"):
        where_clauses.append("""
            EXISTS (
                SELECT 1 FROM `tabReimbursement Invoice Item` rii
                WHERE rii.parent = rr.name AND rii.invoice_no LIKE %(inv)s
            )
        """)
        params["inv"] = f"%{filters['invoice_no'].strip()}%"

    if filters.get("item_code"):
        where_clauses.append("""
            EXISTS (
                SELECT 1 FROM `tabReimbursement Invoice Item` rii
                WHERE rii.parent = rr.name AND (rii.item_name LIKE %(item)s OR rii.description LIKE %(item)s)
            )
        """)
        params["item"] = f"%{filters['item_code'].strip()}%"

    if filters.get("owner"):
        where_clauses.append("rr.owner LIKE %(owner)s")
        params["owner"] = f"%{filters['owner'].strip()}%"

    where_clause = " AND ".join(where_clauses)

    # 核心：ORDER BY docstatus ASC 将草稿 (0) 永远置顶在最顶部！
    sql = f"""
        SELECT
            rr.name AS rr_name,
            rr.company,
            rr.docstatus,
            rr.posting_date,
            rr.owner,
            rr.total_amount,
            rr.outstanding_amount,
            COALESCE(rr.title, '') AS title,
            COALESCE(rr.custom_doc_details, '') AS doc_details,
            (
                SELECT COUNT(rii.name)
                FROM `tabReimbursement Invoice Item` rii
                WHERE rii.parent = rr.name
            ) AS item_count,
            (
                SELECT GROUP_CONCAT(DISTINCT rii.supplier ORDER BY rii.supplier DESC SEPARATOR '||')
                FROM `tabReimbursement Invoice Item` rii
                WHERE rii.parent = rr.name AND rii.supplier IS NOT NULL AND rii.supplier != ''
            ) AS raw_suppliers,
            (
                SELECT GROUP_CONCAT(DISTINCT rii.invoice_no ORDER BY rii.invoice_no DESC SEPARATOR '||')
                FROM `tabReimbursement Invoice Item` rii
                WHERE rii.parent = rr.name AND rii.invoice_no IS NOT NULL AND rii.invoice_no != ''
            ) AS raw_invoice_nos,
            (
                SELECT GROUP_CONCAT(DISTINCT rii.source_pi ORDER BY rii.source_pi DESC SEPARATOR '、')
                FROM `tabReimbursement Invoice Item` rii
                WHERE rii.parent = rr.name AND rii.source_pi IS NOT NULL AND rii.source_pi != ''
            ) AS linked_pis,
            (
                SELECT GROUP_CONCAT(
                    CONCAT(
                        rii.item_name,
                        ' (',
                        IF(rii.qty = ROUND(rii.qty, 0), CAST(ROUND(rii.qty, 0) AS CHAR), CAST(ROUND(rii.qty, 2) AS CHAR)),
                        COALESCE(rii.uom, '个'),
                        ')'
                    )
                    SEPARATOR '、'
                )
                FROM `tabReimbursement Invoice Item` rii
                WHERE rii.parent = rr.name AND rii.item_name IS NOT NULL AND rii.item_name != ''
            ) AS auto_items_summary
        FROM `tabReimbursement Request` rr
        WHERE {where_clause}
        ORDER BY (CASE WHEN rr.docstatus = 0 THEN 0 ELSE 1 END) ASC, rr.posting_date DESC, rr.name DESC
        LIMIT 500
    """

    raw_docs = frappe.db.sql(sql, params, as_dict=True)
    raw_docs = filter_rows_by_doctype_permission(raw_docs, "Reimbursement Request", "rr_name")

    rows = []
    can_write = frappe.has_permission("Reimbursement Request", "write")
    can_delete_perm = frappe.has_permission("Reimbursement Request", "delete")
    can_cancel_perm = frappe.has_permission("Reimbursement Request", "cancel")
    for idx, d in enumerate(raw_docs, 1):
        outstanding = flt(d.outstanding_amount)
        is_draft = False
        if d.docstatus == 0:
            status_label = "待提交草稿"
            doc_status = "Draft"
            is_draft = True
        elif outstanding > 0.0001:
            status_label = "待结款"
            doc_status = "Submitted"
        else:
            status_label = "已结清"
            doc_status = "Completed"

        paid_amount = max(0.0, flt(d.total_amount) - outstanding)
        # Check delete permission: draft requires delete; submitted requires no payment + both delete and cancel
        if is_draft:
            row_can_delete = can_delete_perm
        elif d.docstatus == 1:
            row_can_delete = bool(can_delete_perm and can_cancel_perm and paid_amount <= 0.0001)
        elif d.docstatus == 2:
            row_can_delete = can_delete_perm
        else:
            row_can_delete = False

        suppliers_list = [s for s in (d.raw_suppliers or "").split("||") if s.strip()]
        invoices_list = [i for i in (d.raw_invoice_nos or "").split("||") if i.strip()]

        supp_count = len(suppliers_list)
        inv_count = len(invoices_list)

        masked_invoices = [f"…{x[-8:]}" if len(x) > 8 else x for x in invoices_list]
        details_text = d.doc_details or d.auto_items_summary or "-"

        rows.append({
            "idx": idx,
            "rr_name": d.rr_name,
            "company": d.company,
            "docstatus": d.docstatus,
            "doc_status": doc_status,
            "is_draft": is_draft,
            "title": d.title or "-",
            "supplier_count": supp_count,
            "invoice_count": inv_count,
            "supplier_preview": _format_compact_preview(suppliers_list, 2),
            "invoice_preview": _format_compact_preview(masked_invoices, 2),
            "suppliers": "、".join(suppliers_list) if suppliers_list else "-",
            "invoice_nos": "、".join(invoices_list) if invoices_list else "-",
            "status_label": status_label,
            "posting_date": str(d.posting_date or ""),
            "owner": d.owner,
            "item_count": int(d.item_count or 0),
            "total_amount": flt(d.total_amount, 2),
            "outstanding_amount": outstanding,
            "paid_amount": paid_amount,
            "doc_details": details_text,
            "linked_pis": d.linked_pis or "-",
            "can_write": can_write,
            "can_delete": row_can_delete,
        })

    return {
        "rows": rows,
        "total_count": len(rows),
        "total_amount": sum(r["total_amount"] for r in rows),
        "total_outstanding": sum(r["outstanding_amount"] for r in rows),
    }


# =========================================================================
# 3. Item Detail Rows Query (Drafts on TOP)
# =========================================================================

@frappe.whitelist()
def get_reimbursement_picker_rows(
    company: str | None = None,
    filters: dict | str | None = None,
) -> dict:
    """Query item detail rows for 报销申请 with Drafts pinned on TOP."""
    assert_doctype_permission("Reimbursement Request", "read")
    target_companies = _get_target_companies(company)
    if not target_companies:
        return {"rows": [], "total_count": 0, "total_amount": 0, "total_outstanding": 0}

    if isinstance(filters, str):
        try:
            filters = json.loads(filters)
        except Exception:
            filters = {}
    filters = filters or {}

    where_clauses = ["rr.company IN %(comps)s", "rr.docstatus IN (0, 1)"]
    params = {"comps": target_companies}

    match_status = filters.get("match_status", "pending")
    if match_status == "pending":
        where_clauses.append("rr.outstanding_amount > 0")
    elif match_status == "completed":
        where_clauses.append("rr.outstanding_amount <= 0.0001 AND rr.docstatus = 1")
    elif match_status == "draft":
        where_clauses.append("rr.docstatus = 0")

    if filters.get("supplier"):
        where_clauses.append("rii.supplier LIKE %(supp)s")
        params["supp"] = f"%{filters['supplier'].strip()}%"

    if filters.get("invoice_no"):
        where_clauses.append("rii.invoice_no LIKE %(inv)s")
        params["inv"] = f"%{filters['invoice_no'].strip()}%"

    if filters.get("item_code"):
        where_clauses.append("(rii.item_name LIKE %(item)s OR rii.description LIKE %(item)s)")
        params["item"] = f"%{filters['item_code'].strip()}%"

    if filters.get("owner"):
        where_clauses.append("rr.owner LIKE %(owner)s")
        params["owner"] = f"%{filters['owner'].strip()}%"

    where_clause = " AND ".join(where_clauses)
    inv_type_col = "rii.invoice_type" if _meta_has("Reimbursement Invoice Item", "invoice_type") else "'专用发票'"
    inv_date_col = "rii.invoice_date" if _meta_has("Reimbursement Invoice Item", "invoice_date") else "rr.posting_date"

    sql = f"""
        SELECT
            rii.name AS item_row_name,
            rr.name AS rr_name,
            rr.company,
            rr.docstatus,
            rr.posting_date,
            rr.owner,
            rr.total_amount,
            rr.outstanding_amount,
            rii.item_name,
            rii.description AS spec,
            rii.qty,
            rii.rate,
            rii.amount,
            rii.invoice_no,
            rii.supplier,
            rii.source_pi,
            {inv_type_col} AS invoice_type,
            {inv_date_col} AS invoice_date
        FROM `tabReimbursement Invoice Item` rii
        INNER JOIN `tabReimbursement Request` rr ON rii.parent = rr.name
        WHERE {where_clause}
        ORDER BY (CASE WHEN rr.docstatus = 0 THEN 0 ELSE 1 END) ASC, rr.posting_date DESC, rr.name DESC, rii.idx ASC
        LIMIT 500
    """

    raw_items = frappe.db.sql(sql, params, as_dict=True)
    raw_items = filter_rows_by_doctype_permission(raw_items, "Reimbursement Request", "rr_name")

    rows = []
    can_write = frappe.has_permission("Reimbursement Request", "write")
    can_delete_perm = frappe.has_permission("Reimbursement Request", "delete")
    can_cancel_perm = frappe.has_permission("Reimbursement Request", "cancel")
    for idx, it in enumerate(raw_items, 1):
        outstanding = flt(it.outstanding_amount)
        paid_amount = max(0.0, flt(it.total_amount) - outstanding)
        if it.docstatus == 0:
            status_label = "待提交草稿"
            row_can_delete = can_delete_perm
        elif outstanding > 0.0001:
            status_label = "待结款"
            row_can_delete = bool(can_delete_perm and can_cancel_perm and paid_amount <= 0.0001)
        else:
            status_label = "已结清"
            row_can_delete = False

        rows.append({
            "idx": idx,
            "item_row_name": it.item_row_name,
            "rr_name": it.rr_name,
            "company": it.company,
            "docstatus": it.docstatus,
            "posting_date": str(it.posting_date or ""),
            "owner": it.owner,
            "item_name": it.item_name or "-",
            "spec": it.spec or "-",
            "qty": flt(it.qty, 2),
            "rate": flt(it.rate, 2),
            "amount": flt(it.amount, 2),
            "invoice_no": it.invoice_no or "-",
            "supplier": it.supplier or "-",
            "source_pi": it.source_pi or "-",
            "invoice_type": it.invoice_type or "专用发票",
            "invoice_date": str(it.invoice_date or ""),
            "status_label": status_label,
            "can_write": can_write,
            "can_delete": row_can_delete,
        })

    return {
        "rows": rows,
        "total_count": len(rows),
        "total_amount": sum(r["amount"] for r in rows),
        "total_outstanding": sum(flt(r["amount"]) for r in rows if r["status_label"] != "已结清"),
    }


# =========================================================================
# 4. Search Master Data & Autocomplete APIs
# =========================================================================

@frappe.whitelist()
def search_items_for_reimbursement(txt: str = "", limit: int = 20) -> list[dict]:
    """Search items for reimbursement modal autocomplete."""
    assert_doctype_permission("Item", "read")
    txt = (txt or "").strip()
    spec_col = _get_item_spec_column()
    has_spec = _meta_has("Item", "custom_spec_model")

    filters = [["disabled", "=", 0]]
    or_filters = [
        ["name", "like", f"%{txt}%"],
        ["item_name", "like", f"%{txt}%"],
    ]
    if has_spec:
        or_filters.append(["custom_spec_model", "like", f"%{txt}%"])
    else:
        or_filters.append(["description", "like", f"%{txt}%"])

    items = frappe.get_list(
        "Item",
        filters=filters,
        or_filters=or_filters if txt else None,
        fields=["name AS item_code", "item_name", f"{spec_col} AS spec", "stock_uom AS uom", "is_stock_item"],
        limit=int(limit or 20),
        order_by="name ASC",
    )
    return items


@frappe.whitelist()
def get_suppliers_for_reimbursement(txt: str = "", limit: int = 20) -> list[dict]:
    """Search suppliers for reimbursement dropdown."""
    assert_doctype_permission("Supplier", "read")
    txt = (txt or "").strip()
    filters = [["disabled", "=", 0]]
    or_filters = [
        ["name", "like", f"%{txt}%"],
        ["supplier_name", "like", f"%{txt}%"],
    ]
    suppliers = frappe.get_list(
        "Supplier",
        filters=filters,
        or_filters=or_filters if txt else None,
        fields=["name AS supplier", "supplier_name"],
        limit=int(limit or 20),
        order_by="name ASC",
    )
    return suppliers


@frappe.whitelist(methods=["POST"])
def quick_create_reimbursement_item(
    item_code: str,
    item_name: str | None = None,
    stock_uom: str = "个",
    spec: str = "",
    is_stock_item: int | bool = 0,
) -> dict:
    """Quickly create a new Item in ERPNext for picker autocomplete."""
    assert_doctype_permission("Item", "create")
    item_code = (item_code or "").strip()
    if not item_code:
        frappe.throw(_("物料代码不能为空。"))
    item_name = (item_name or item_code).strip()
    stock_uom = _ensure_uom(stock_uom)

    if frappe.db.exists("Item", item_code):
        frappe.throw(_("物料代码 {0} 已存在，请直接选择。").format(item_code))

    doc = frappe.new_doc("Item")
    doc.item_code = item_code
    doc.item_name = item_name
    doc.item_group = "All Item Groups"
    doc.stock_uom = stock_uom
    doc.is_stock_item = 1 if int(is_stock_item) else 0
    if spec and _meta_has("Item", "custom_spec_model"):
        doc.custom_spec_model = spec
    elif spec:
        doc.description = spec

    doc.insert()

    return {
        "success": True,
        "item_code": doc.name,
        "item_name": doc.item_name,
        "spec": spec,
        "uom": doc.stock_uom,
        "is_stock_item": bool(doc.is_stock_item),
    }


@frappe.whitelist(methods=["POST"])
def quick_create_reimbursement_supplier(supplier_name: str) -> dict:
    """Quickly create a new Supplier in ERPNext for picker autocomplete."""
    assert_doctype_permission("Supplier", "create")
    supplier_name = (supplier_name or "").strip()
    if not supplier_name:
        frappe.throw(_("供应商名称不能为空。"))
    supp_code = _ensure_supplier(supplier_name)
    return {
        "success": True,
        "supplier": supp_code,
        "supplier_name": supplier_name,
    }


# =========================================================================
# 5. Pure 3-Doc Multi-Invoice Reimbursement Engine (NO Purchase Order)
# =========================================================================

VALID_INVOICE_TYPES = ("专用发票", "普通发票", "无发票")


def _ensure_supplier(supplier_name: str) -> str:
    """Ensure supplier exists in ERPNext Supplier DocType, create if missing."""
    supplier_name = (supplier_name or "").strip()
    if not supplier_name:
        return "零星报销供应商"
    if not frappe.db.exists("Supplier", supplier_name):
        assert_doctype_permission("Supplier", "create")
        supp_doc = frappe.new_doc("Supplier")
        supp_doc.supplier_name = supplier_name
        supp_doc.supplier_group = "All Supplier Groups"
        supp_doc.insert()
        return supp_doc.name
    return supplier_name


def _ensure_uom(uom_name: str) -> str:
    """Ensure UOM exists in ERPNext UOM table."""
    uom_name = (uom_name or "个").strip()
    if not frappe.db.exists("UOM", uom_name):
        try:
            assert_doctype_permission("UOM", "create")
            uom_doc = frappe.new_doc("UOM")
            uom_doc.uom_name = uom_name
            uom_doc.insert()
            return uom_doc.name
        except Exception:
            if frappe.db.exists("UOM", "Nos"):
                return "Nos"
            if frappe.db.exists("UOM", "Unit"):
                return "Unit"
    return uom_name


def _ensure_item(item_name: str, uom: str = "个", spec: str = "") -> str:
    """Ensure item exists in ERPNext Item table; if missing create as expense item."""
    item_name = (item_name or "").strip()
    if not item_name:
        return "通用零星报销费用"
    if frappe.db.exists("Item", item_name):
        return item_name

    existing_name = frappe.db.get_value("Item", {"item_name": item_name}, "name")
    if existing_name:
        return existing_name

    assert_doctype_permission("Item", "create")
    uom_val = _ensure_uom(uom)
    item_doc = frappe.new_doc("Item")
    item_doc.item_code = item_name
    item_doc.item_name = item_name
    item_doc.item_group = "All Item Groups"
    item_doc.stock_uom = uom_val
    item_doc.is_stock_item = 0
    if spec and _meta_has("Item", "custom_spec_model"):
        item_doc.custom_spec_model = spec
    elif spec:
        item_doc.description = spec

    item_doc.insert()
    return item_doc.name


def _create_manual_multi_invoice_reimbursement_inner(
    company: str,
    posting_date: str | None = None,
    title: str | None = None,
    auto_receive_stock: int | bool = 1,
    is_draft: int | bool = 0,
    invoices: str | list | None = None,
) -> dict:
    """Create Reimbursement Request and linked Purchase Invoices & Receipts (NO PO)."""
    assert_company_access(company)

    if isinstance(invoices, str):
        try:
            invoices = json.loads(invoices)
        except Exception as e:
            frappe.throw(_("发票数据格式错误：{0}").format(str(e)))

    if not is_draft and (not invoices or not isinstance(invoices, list)):
        frappe.throw(_("请至少录入一张有效的发票信息。"))

    if not invoices or not isinstance(invoices, list):
        invoices = []

    posting_date_str = get_effective_work_date(posting_date)
    auto_receive_stock = bool(int(auto_receive_stock))
    is_draft = bool(int(is_draft))

    assert_standard_lifecycle_permissions(
        "Reimbursement Request", create=True, submit=not is_draft
    )
    assert_standard_lifecycle_permissions(
        "Purchase Invoice", create=True, submit=not is_draft
    )
    if auto_receive_stock:
        assert_standard_lifecycle_permissions(
            "Purchase Receipt", create=True, submit=not is_draft
        )

    default_warehouse = frappe.db.get_value("Stock Settings", None, "default_warehouse")
    if not default_warehouse:
        default_warehouse = frappe.db.get_value("Warehouse", {"company": company, "is_group": 0}, "name")

    created_pi_names = []
    created_pr_names = []
    all_rr_item_rows = []

    for inv_idx, inv in enumerate(invoices, 1):
        inv_type = inv.get("invoice_type") or "专用发票"
        if inv_type not in VALID_INVOICE_TYPES:
            inv_type = "专用发票"

        supplier_raw = (inv.get("supplier") or "").strip()
        supplier_val = _ensure_supplier(supplier_raw)

        bill_date_str = str(inv.get("invoice_date") or posting_date_str)
        bill_no_raw = (inv.get("invoice_no") or "").strip()

        # 校验：专用发票与普通发票的发票号码必填 (在正式提交时强校验)
        if not is_draft:
            if inv_type in ("专用发票", "普通发票") and not bill_no_raw:
                frappe.throw(_("发票 #{0} ({1}) 必须填写发票号码！").format(inv_idx, inv_type))

        if inv_type == "无发票" or not bill_no_raw:
            if is_draft and inv_type != "无发票":
                # 草稿阶段未填发票号：使用含时间戳的唯一占位号，杜绝重复触发采购发票唯一性校验
                import time as _time
                bill_no_raw = f"REIM-DRAFT-{posting_date_str.replace('-', '')}-{int(_time.time() * 1000) % 1000000:06d}-{inv_idx:02d}"
            else:
                bill_no_raw = f"REIM-NOINV-{posting_date_str.replace('-', '')}-{inv_idx:02d}"

        items = inv.get("items") or []
        if not items and not is_draft:
            frappe.throw(_("发票 #{0} 没有任何物料明细。").format(inv_idx))

        validated_items = []
        has_stock_items = False

        for row_idx, row in enumerate(items, 1):
            item_name_raw = (row.get("item_name") or row.get("item_code") or "").strip()
            qty = flt(row.get("qty") or 0.0)
            rate = flt(row.get("rate") or 0.0)

            # 智能忽略空行：若没有填写物料名称且单价为 0，直接跳过忽略
            if not item_name_raw and rate <= 0.0:
                continue

            if not item_name_raw:
                frappe.throw(_("发票 #{0} 第 {1} 行物料名称不能为空。").format(inv_idx, row_idx))

            uom_raw = (row.get("uom") or "个").strip()
            spec_raw = (row.get("spec") or "").strip()
            item_code_val = _ensure_item(item_name_raw, uom_raw, spec_raw)

            tax_rate = flt(row.get("tax_rate") or 0.0)
            if inv_type == "无发票":
                tax_rate = 0.0

            if not is_draft and (qty <= 0.0 or rate <= 0.0):
                frappe.throw(_("发票 #{0} 第 {1} 行【{2}】数量与单价必须大于 0！").format(inv_idx, row_idx, item_name_raw))

            amount = flt(row.get("amount") or (qty * rate), 2)
            tax_amount = flt(row.get("tax_amount") or (amount * tax_rate / 100.0), 2)
            line_total = flt(amount + tax_amount, 2)

            is_stock = bool(frappe.db.get_value("Item", item_code_val, "is_stock_item"))
            if is_stock:
                has_stock_items = True

            validated_items.append({
                "item_code": item_code_val,
                "item_name": item_name_raw,
                "uom": _ensure_uom(uom_raw),
                "spec": spec_raw,
                "qty": qty,
                "rate": rate,
                "amount": amount,
                "tax_rate": tax_rate,
                "tax_amount": tax_amount,
                "line_total": line_total,
                "remarks": (row.get("remarks") or "").strip(),
                "is_stock_item": is_stock,
                "warehouse": default_warehouse if is_stock else None,
            })

        # 正式提交时不允许空明细；草稿则直接跳过该发票卡片（不生成 PI）
        if not validated_items:
            if not is_draft:
                frappe.throw(_("发票 #{0} 没有任何有效的物料明细。").format(inv_idx))
            else:
                continue  # 草稿空发票卡片：直接跳过，不创建 PI

        # --- 生成发票对应的 PR (若包含库存品，直接建单，不依赖 PO) ---
        pr_name = None
        pr_item_map = {}
        if auto_receive_stock and has_stock_items:
            pr = frappe.new_doc("Purchase Receipt")
            pr.company = company
            pr.supplier = supplier_val
            pr.posting_date = posting_date_str
            pr.custom_biz_mode = "现金报销"

            for it in validated_items:
                if not it["is_stock_item"]:
                    continue
                pr_row = pr.append("items", {
                    "item_code": it["item_code"],
                    "item_name": it["item_name"],
                    "uom": it["uom"],
                    "stock_uom": it["uom"],
                    "qty": it["qty"],
                    "rate": it["rate"],
                    "amount": it["amount"],
                    "warehouse": it["warehouse"],
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
                    pr_row.custom_total_amount = it["line_total"]

            if pr.items:
                pr.flags.ignore_permissions = False
                pr.insert()
                if not is_draft:
                    pr.submit()
                pr_name = pr.name
                created_pr_names.append(pr.name)
                for p_item in pr.items:
                    pr_item_map[p_item.item_code] = p_item.name

        # --- 生成发票对应的 PI (直接建单，不依赖 PO) ---
        pi = frappe.new_doc("Purchase Invoice")
        pi.company = company
        pi.supplier = supplier_val
        pi.bill_no = bill_no_raw
        pi.bill_date = bill_date_str
        pi.posting_date = posting_date_str
        pi.custom_biz_mode = "现金报销"
        if _meta_has("Purchase Invoice", "custom_invoice_type"):
            pi.custom_invoice_type = inv_type

        for it in validated_items:
            pi_row = pi.append("items", {
                "item_code": it["item_code"],
                "item_name": it["item_name"],
                "uom": it["uom"],
                "stock_uom": it["uom"],
                "qty": it["qty"],
                "rate": it["rate"],
                "amount": it["amount"],
                "purchase_receipt": pr_name if (it["is_stock_item"] and pr_name) else None,
                "pr_detail": pr_item_map.get(it["item_code"]) if (it["is_stock_item"] and pr_name) else None,
                "description": it["remarks"] or it["item_name"],
            })
            if _meta_has("Purchase Invoice Item", "custom_spec_model"):
                pi_row.custom_spec_model = it["spec"]
            if _meta_has("Purchase Invoice Item", "custom_line_remark"):
                pi_row.custom_line_remark = it["remarks"]
            if _meta_has("Purchase Invoice Item", "custom_tax_rate"):
                pi_row.custom_tax_rate = it["tax_rate"]
            if _meta_has("Purchase Invoice Item", "custom_tax_amount"):
                pi_row.custom_tax_amount = it["tax_amount"]
            if _meta_has("Purchase Invoice Item", "custom_total_amount"):
                pi_row.custom_total_amount = it["line_total"]

        pi.flags.ignore_permissions = False
        pi.insert()
        if not is_draft:
            pi.submit()
        created_pi_names.append(pi.name)

        # 收集明细行进入 RR
        for idx, it in enumerate(validated_items):
            pi_item_row = pi.items[idx]
            all_rr_item_rows.append({
                "item_name": it["item_name"],
                "description": it["spec"],
                "qty": it["qty"],
                "rate": it["rate"],
                "amount": it["line_total"],
                "invoice_no": bill_no_raw,
                "supplier": supplier_val,
                "source_pi": pi.name,
                "source_pi_item": pi_item_row.name,
                "custom_line_remark": it["remarks"],
                "invoice_type": inv_type,
                "invoice_date": bill_date_str,
                "tax_rate": it["tax_rate"],
                "tax_amount": it["tax_amount"],
            })

    # 2. 创建 Reimbursement Request
    rr = frappe.new_doc("Reimbursement Request")
    rr.company = company
    rr.title = title or f"报销单-{posting_date_str} ({len(invoices)}张发票)"
    rr.posting_date = posting_date_str
    rr.custom_biz_mode = "现金报销"

    for r_it in all_rr_item_rows:
        row_dict = {
            "item_name": r_it["item_name"],
            "description": r_it["description"],
            "qty": r_it["qty"],
            "rate": r_it["rate"],
            "amount": r_it["amount"],
            "invoice_no": r_it["invoice_no"],
            "supplier": r_it["supplier"],
            "source_pi": r_it["source_pi"],
            "source_pi_item": r_it["source_pi_item"],
        }
        if _meta_has("Reimbursement Invoice Item", "custom_line_remark"):
            row_dict["custom_line_remark"] = r_it["custom_line_remark"]
        if _meta_has("Reimbursement Invoice Item", "invoice_type"):
            row_dict["invoice_type"] = r_it["invoice_type"]
        if _meta_has("Reimbursement Invoice Item", "invoice_date"):
            row_dict["invoice_date"] = r_it["invoice_date"]
        if _meta_has("Reimbursement Invoice Item", "tax_rate"):
            row_dict["tax_rate"] = r_it["tax_rate"]
        if _meta_has("Reimbursement Invoice Item", "tax_amount"):
            row_dict["tax_amount"] = r_it["tax_amount"]

        rr.append("invoice_items", row_dict)

    rr.flags.ignore_permissions = False
    if is_draft:
        rr.flags.ignore_mandatory = True
    rr.insert()
    if not is_draft:
        rr.submit()

    # 3. 刷新 custom_doc_details
    try:
        from ashan_cn_procurement.overrides.document_details import update_doc_details
        update_doc_details(rr)
        if rr.get("custom_doc_details"):
            frappe.db.set_value("Reimbursement Request", rr.name, "custom_doc_details", rr.custom_doc_details, update_modified=False)
    except Exception:
        pass

    return {
        "success": True,
        "rr_name": rr.name,
        "docstatus": rr.docstatus,
        "invoice_count": len(invoices),
        "grand_total": flt(rr.total_amount, 2),
        "created_pr_names": created_pr_names,
        "created_pi_names": created_pi_names,
    }


@frappe.whitelist(methods=["POST"])
def create_manual_multi_invoice_reimbursement(
    company: str,
    posting_date: str | None = None,
    title: str | None = None,
    auto_receive_stock: int | bool = 1,
    is_draft: int | bool = 0,
    invoices: str | list | None = None,
) -> dict:
    """Whitelisted wrapper for multi-invoice reimbursement with deadlock resilience."""
    import time
    for attempt in range(3):
        try:
            return _create_manual_multi_invoice_reimbursement_inner(
                company=company,
                posting_date=posting_date,
                title=title,
                auto_receive_stock=auto_receive_stock,
                is_draft=is_draft,
                invoices=invoices,
            )
        except frappe.QueryDeadlockError:
            if attempt < 2:
                time.sleep(0.3)
                continue
            raise


# =========================================================================
# 6. Reimbursement Request Detail & Update / Delete Engine (Pure 3 Docs)
# =========================================================================

@frappe.whitelist()
def get_reimbursement_detail_for_edit(rr_name: str) -> dict:
    """Fetch complete hierarchical invoice structure for Reimbursement Modal Edit."""
    if not frappe.db.exists("Reimbursement Request", rr_name):
        frappe.throw(_("报销单 {0} 不存在。").format(rr_name))

    rr = frappe.get_doc("Reimbursement Request", rr_name)
    assert_company_access(rr.company)
    if not frappe.has_permission("Reimbursement Request", "read", rr):
        frappe.throw(_("您没有查看该报销单的权限。"), frappe.PermissionError)

    invoices_map = {}
    for item in rr.invoice_items:
        inv_key = f"{item.invoice_no or 'NOINV'}___{item.supplier or 'NOSUPP'}"
        if inv_key not in invoices_map:
            invoices_map[inv_key] = {
                "invoice_type": getattr(item, "invoice_type", None) or "专用发票",
                "supplier": item.supplier or "",
                "invoice_no": item.invoice_no or "",
                "invoice_date": str(getattr(item, "invoice_date", None) or rr.posting_date),
                "items": [],
            }

        tax_rate = flt(getattr(item, "tax_rate", 0))
        tax_amount = flt(getattr(item, "tax_amount", 0))
        amount = flt(item.amount)
        if tax_amount > 0 and amount >= tax_amount:
            net_amount = flt(amount - tax_amount, 2)
        else:
            net_amount = amount

        invoices_map[inv_key]["items"].append({
            "item_name": item.item_name,
            "spec": item.description or "",
            "uom": "个",
            "qty": flt(item.qty, 2),
            "rate": flt(item.rate, 2),
            "tax_rate": tax_rate,
            "amount": net_amount,
            "tax_amount": tax_amount,
            "line_total": amount,
            "remarks": getattr(item, "custom_line_remark", None) or "",
        })

    paid_amount = max(0.0, flt(rr.total_amount) - flt(rr.outstanding_amount))
    can_delete_perm = frappe.has_permission("Reimbursement Request", "delete", rr)
    can_cancel_perm = frappe.has_permission("Reimbursement Request", "cancel", rr)
    can_del = (rr.docstatus == 0 and can_delete_perm) or (
        rr.docstatus == 1 and paid_amount <= 0.0001 and can_delete_perm and can_cancel_perm
    ) or (rr.docstatus == 2 and can_delete_perm)

    return {
        "rr_name": rr.name,
        "company": rr.company,
        "docstatus": rr.docstatus,
        "posting_date": str(rr.posting_date),
        "title": rr.title or "",
        "total_amount": flt(rr.total_amount, 2),
        "outstanding_amount": flt(rr.outstanding_amount, 2),
        "paid_amount": paid_amount,
        "invoices": list(invoices_map.values()),
        "can_write": frappe.has_permission("Reimbursement Request", "write", rr),
        "can_delete": can_del,
    }


@frappe.whitelist(methods=["POST"])
def delete_reimbursement_bundle(rr_name: str) -> dict:
    """Safely delete a reimbursement request (draft, or un-paid submitted document) and its linked chain."""
    if not rr_name or not rr_name.strip():
        frappe.throw(_("请指定需要删除的报销单号。"))

    if not frappe.db.exists("Reimbursement Request", rr_name):
        return {"success": True, "deleted_rr": rr_name}

    rr = frappe.get_doc("Reimbursement Request", rr_name)
    assert_company_access(rr.company)

    if not frappe.has_permission("Reimbursement Request", "delete", rr):
        frappe.throw(_("您没有删除报销单【{0}】的权限。").format(rr_name), frappe.PermissionError)

    # 1. 查找关联采购发票
    pi_names = list(set([item.source_pi for item in rr.invoice_items if item.source_pi]))

    # 2. 已提交单据处理逻辑 (docstatus == 1)
    if rr.docstatus == 1:
        if not frappe.has_permission("Reimbursement Request", "cancel", rr):
            frappe.throw(_("报销单【{0}】已提交，删除前需先作废，但您缺少作废权限。").format(rr_name), frappe.PermissionError)

        paid = max(0.0, flt(rr.total_amount) - flt(rr.outstanding_amount))
        if flt(rr.paid_amount) > 0.0001 or paid > 0.0001:
            frappe.throw(
                _("报销单【{0}】已发生付款（已付 ¥{1}），严禁直接删除！如需处理，请先在系统中作废关联付款单。").format(
                    rr_name, flt(paid or rr.paid_amount, 2)
                )
            )

        # 检查采购发票是否存在生效的付款记录
        if pi_names:
            linked_pes = frappe.get_all(
                "Payment Entry Reference",
                filters={
                    "reference_doctype": "Purchase Invoice",
                    "reference_name": ["in", pi_names],
                    "docstatus": 1,
                },
                fields=["parent"],
            )
            if linked_pes:
                pe_list = "、".join(list(set(p.parent for p in linked_pes)))
                frappe.throw(
                    _("报销单【{0}】关联采购发票存在生效的付款单（{1}），无法删除！请先作废付款单。").format(rr_name, pe_list)
                )

        # 按 ERPNext 标准生命周期依次作废
        rr.flags.ignore_permissions = True
        rr.cancel()

        for pi_name in pi_names:
            if frappe.db.exists("Purchase Invoice", pi_name):
                pi = frappe.get_doc("Purchase Invoice", pi_name)
                if pi.docstatus == 1:
                    if not frappe.has_permission("Purchase Invoice", "cancel", pi):
                        frappe.throw(_("缺少作废关联采购发票【{0}】的权限。").format(pi_name), frappe.PermissionError)
                    pi.flags.ignore_permissions = True
                    pi.cancel()

                for pr_name in {p_it.purchase_receipt for p_it in pi.items if p_it.purchase_receipt}:
                    if frappe.db.exists("Purchase Receipt", pr_name):
                        pr = frappe.get_doc("Purchase Receipt", pr_name)
                        if pr.docstatus == 1:
                            if not frappe.has_permission("Purchase Receipt", "cancel", pr):
                                frappe.throw(_("缺少作废关联采购入库单【{0}】的权限。").format(pr_name), frappe.PermissionError)
                            pr.flags.ignore_permissions = True
                            pr.cancel()

    elif rr.docstatus == 0:
        # 草稿单据预检：确保下游无已提交单据误删
        for pi_name in pi_names:
            if not frappe.db.exists("Purchase Invoice", pi_name):
                continue
            pi = frappe.get_doc("Purchase Invoice", pi_name)
            if pi.docstatus != 0:
                frappe.throw(_("关联采购发票 {0} 已提交，不能直接删除报销草稿。").format(pi_name))
            for pr_name in {p_item.purchase_receipt for p_item in pi.items if p_item.purchase_receipt}:
                if not frappe.db.exists("Purchase Receipt", pr_name):
                    continue
                if frappe.get_doc("Purchase Receipt", pr_name).docstatus != 0:
                    frappe.throw(_("关联采购入库单 {0} 已提交，不能直接删除报销草稿。").format(pr_name))

    # 3. 清理可能存在的预留/占用记录
    try:
        if frappe.db.table_exists("Reimbursement Source Reservation"):
            frappe.db.sql("""
                DELETE FROM `tabReimbursement Source Reservation`
                WHERE reimbursement_request = %s
            """, (rr_name,))
            if pi_names:
                frappe.db.sql("""
                    DELETE FROM `tabReimbursement Source Reservation`
                    WHERE source_purchase_invoice IN %s
                """, (tuple(pi_names),))
    except Exception:
        pass

    # 4. 彻底删除报销单及关联采购发票与采购入库单
    frappe.delete_doc("Reimbursement Request", rr.name, force=True, ignore_permissions=True)

    for pi_name in pi_names:
        if frappe.db.exists("Purchase Invoice", pi_name):
            try:
                pi = frappe.get_doc("Purchase Invoice", pi_name)
                pr_names = list(set([p_it.purchase_receipt for p_it in pi.items if p_it.purchase_receipt]))

                frappe.delete_doc("Purchase Invoice", pi.name, force=True, ignore_permissions=True)

                for pr_name in pr_names:
                    if frappe.db.exists("Purchase Receipt", pr_name):
                        frappe.delete_doc("Purchase Receipt", pr_name, force=True, ignore_permissions=True)
            except Exception as e:
                frappe.log_error(f"Error cascading delete PI {pi_name}: {e}")

    return {"success": True, "deleted_rr": rr_name}


@frappe.whitelist(methods=["POST"])
def batch_delete_reimbursements(rr_names: list[str] | str) -> dict:
    """Safely batch delete selected reimbursement requests (drafts or unpaid submitted documents)."""
    if isinstance(rr_names, str):
        rr_names = frappe.parse_json(rr_names) or []

    if not rr_names:
        frappe.throw(_("请指定需要删除的报销单。"))

    unique_names = list(dict.fromkeys([str(n).strip() for n in rr_names if n and str(n).strip()]))
    if not unique_names:
        frappe.throw(_("请选择有效的报销单。"))

    deleted = []
    for name in unique_names:
        if not frappe.db.exists("Reimbursement Request", name):
            continue
        delete_reimbursement_bundle(name)
        deleted.append(name)

    return {
        "success": True,
        "count": len(deleted),
        "names": deleted,
        "message": _("成功删除 {0} 张报销单及关联单据：{1}").format(len(deleted), "、".join(deleted)),
    }


@frappe.whitelist(methods=["POST"])
def delete_bundle_and_cancel_pi(rr_name: str) -> dict:
    """Compatibility alias for delete_reimbursement_bundle."""
    return delete_reimbursement_bundle(rr_name)


# =========================================================================
# 7. Reimbursement Payment Entry Engine (Smart Partial / Percentage Payment)
# =========================================================================

@frappe.whitelist(methods=["POST"])
def create_reimbursement_payment_entry(
    rr_name: str,
    paid_amount: float | None = None,
    mode_of_payment: str | None = None,
    posting_date: str | None = None,
    reference_no: str | None = None,
    remarks: str | None = None,
) -> dict:
    """Create and submit a Payment Entry (Pay) for a Reimbursement Request."""
    assert_doctype_permission("Reimbursement Request", "read")
    if not rr_name or not rr_name.strip():
        frappe.throw(_("请指定报销单号。"))
    rr = frappe.get_doc("Reimbursement Request", rr_name.strip())
    assert_company_access(rr.company)

    if rr.docstatus != 1:
        frappe.throw(_("只有已提交过账的报销单才能进行付款结算。"))

    outstanding = flt(rr.outstanding_amount)
    if outstanding <= 0.0001:
        frappe.throw(_("报销单【{0}】待结款余额为 0，无需重复生成付款单。").format(rr.name))

    pay_amt = flt(paid_amount) if (paid_amount and flt(paid_amount) > 0) else outstanding
    if pay_amt > outstanding + 0.01:
        frappe.throw(_("本次付款金额 (¥ {0:,.2f}) 不能大于待付欠款余额 (¥ {1:,.2f})。").format(pay_amt, outstanding))

    # 查找关联的采购发票
    pi_names = list(dict.fromkeys([it.source_pi for it in rr.invoice_items if it.source_pi]))
    valid_pis = []
    for pi_n in pi_names:
        if frappe.db.exists("Purchase Invoice", pi_n):
            pi_doc = frappe.get_doc("Purchase Invoice", pi_n)
            if pi_doc.docstatus == 1 and flt(pi_doc.outstanding_amount) > 0.0001:
                valid_pis.append(pi_doc)

    created_pes = []
    rem_to_pay = pay_amt

    if valid_pis:
        from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry

        # 确保结算方式存在
        mop = mode_of_payment
        if not mop or not frappe.db.exists("Mode of Payment", mop):
            for candidate in ["电汇", "银行转账", "Wire Transfer", "Bank Draft", "现金", "Cash"]:
                if frappe.db.exists("Mode of Payment", candidate):
                    mop = candidate
                    break

        for pi_doc in valid_pis:
            if rem_to_pay <= 0.0001:
                break
            pi_out = flt(pi_doc.outstanding_amount)
            curr_pay = min(rem_to_pay, pi_out)

            pe = get_payment_entry(
                "Purchase Invoice",
                pi_doc.name,
                party_amount=curr_pay,
            )
            pe.posting_date = posting_date or rr.posting_date or get_effective_work_date()
            if mop:
                pe.mode_of_payment = mop
            pe.reference_no = reference_no or rr.name
            pe.reference_date = pe.posting_date
            pe.remarks = remarks or f"现金报销付款出账 · 报销单: {rr.name} · 发票: {pi_doc.name} · 供应商: {pi_doc.supplier}"
            if _meta_has("Payment Entry", "custom_biz_mode"):
                pe.custom_biz_mode = "现金报销"

            pe.flags.ignore_permissions = False
            pe.insert()
            pe.submit()
            created_pes.append(pe.name)
            rem_to_pay = flt(rem_to_pay - curr_pay, 2)

    # 重新核算 RR 的 outstanding_amount
    new_outstanding = max(0.0, flt(outstanding - pay_amt, 2))
    frappe.db.set_value("Reimbursement Request", rr.name, "outstanding_amount", new_outstanding, update_modified=True)
    if _meta_has("Reimbursement Request", "custom_paid_amount"):
        new_paid = flt(rr.get("custom_paid_amount", 0)) + pay_amt
        frappe.db.set_value("Reimbursement Request", rr.name, "custom_paid_amount", new_paid, update_modified=False)

    rr.add_comment("Comment", text=f"【现金报销】已完成付款结算：金额 ¥ {pay_amt:,.2f}，付款单：{', '.join(created_pes) or '已核销'}")

    return {
        "success": True,
        "rr_name": rr.name,
        "paid_amount": pay_amt,
        "remaining_outstanding": new_outstanding,
        "pe_names": created_pes,
        "message": _("报销付款单生成成功！本次实付金额：¥ {0:,.2f}，剩余待结款：¥ {1:,.2f}").format(pay_amt, new_outstanding),
    }
