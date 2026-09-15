# ASHAN-UNIFIED-V2: permission-aware SQL read models
"""Procurement order picker and downstream document generation domain services.

Provides permission-aware candidate pooling and transactional draft document
generation across the full 5-step procurement business lifecycle in both
Detail View (明细视图) and Doc View (单号视图):
1. Material Request (采购申请 / 物料申请)
2. Material Request -> Purchase Order (采购订货)
3. Purchase Order -> Purchase Receipt (采购入库)
4. Purchase Receipt -> Purchase Invoice (采购开票)
5. Purchase Invoice -> Reimbursement Request (报销付款)
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from typing import Any

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate, nowdate

from ashan_cn_procurement.reimbursement.service import (
    _create_reservation,
    get_purchase_invoice_item_candidates,
    normalize_names,
)
from ashan_cn_procurement.services.authorization_service import (
    assert_company_access,
    get_allowed_companies,
)
from ashan_cn_procurement.services.permission_query_service import (
    assert_doctype_permission,
    filter_rows_by_doctype_permission,
)
from ashan_cn_procurement.services.work_context_service import get_effective_work_date


PROCUREMENT_STAGE_DOCUMENTS = {
    "item_to_mr": ("Material Request", "Material Request"),
    "mr_to_po": ("Material Request", "Purchase Order"),
    "po_to_pr": ("Purchase Order", "Purchase Receipt"),
    "pr_to_pi": ("Purchase Receipt", "Purchase Invoice"),
    "pi_to_rr": ("Purchase Invoice", "Reimbursement Request"),
    "pi_to_pay": ("Purchase Invoice", "Payment Entry"),
}

PROCUREMENT_WORKBENCH_STAGES = {
    "request": ("item_to_mr",),
    "execution": ("mr_to_po", "pr_to_pi", "pi_to_rr", "pi_to_pay"),
    "receipt": ("po_to_pr",),
    "overview": ("item_to_mr", "mr_to_po", "po_to_pr", "pr_to_pi", "pi_to_rr", "pi_to_pay"),
}

PROCUREMENT_MANAGER_ROLES = {
    "System Manager",
    "Purchase Manager",
    "Stock Manager",
    "Accounts Manager",
}


def _is_procurement_manager() -> bool:
    """Return whether the current user may perform procurement management actions."""
    if frappe.session.user == "Administrator":
        return True
    return bool(set(frappe.get_roles(frappe.session.user)) & PROCUREMENT_MANAGER_ROLES)


def _get_stage_capability(stage: str) -> dict:
    """Return current-user permissions for one procurement lifecycle stage."""
    if stage not in PROCUREMENT_STAGE_DOCUMENTS:
        frappe.throw(_("不支持的采购流程阶段：{0}").format(stage))

    source_doctype, target_doctype = PROCUREMENT_STAGE_DOCUMENTS[stage]
    is_manager = _is_procurement_manager()
    can_read = bool(frappe.has_permission(source_doctype, "read"))
    can_create = can_read and bool(frappe.has_permission(target_doctype, "create"))
    can_cancel = bool(frappe.has_permission(source_doctype, "cancel"))
    can_delete = bool(frappe.has_permission(source_doctype, "delete"))
    return {
        "can_read": can_read,
        "can_create": can_create,
        "can_write": bool(frappe.has_permission(source_doctype, "write")),
        "can_cancel": can_cancel,
        "can_delete": can_delete,
    }


def _assert_stage_access(stage: str, action: str = "read") -> None:
    """Enforce stage permissions independently of Page visibility."""
    capability = _get_stage_capability(stage)
    capability_key = {
        "read": "can_read",
        "create": "can_create",
        "write": "can_write",
        "cancel": "can_cancel",
        "delete": "can_delete",
    }.get(action)
    if not capability_key:
        frappe.throw(_("不支持的采购权限动作：{0}").format(action))
    if not capability.get(capability_key):
        frappe.throw(_("当前账号没有执行此采购阶段的权限。"), frappe.PermissionError)


@frappe.whitelist()
def get_procurement_workbench_context(workbench: str) -> dict:
    """Return server-authoritative stages and actions for one role workbench."""
    workbench_key = (workbench or "").strip().lower()
    requested_stages = PROCUREMENT_WORKBENCH_STAGES.get(workbench_key)
    if not requested_stages:
        frappe.throw(_("不支持的采购工作台。"))

    is_manager = _is_procurement_manager()
    if workbench_key == "overview" and not is_manager:
        frappe.throw(_("采购总览仅向管理人员开放。"), frappe.PermissionError)

    capabilities = {stage: _get_stage_capability(stage) for stage in requested_stages}
    allowed_stages = [stage for stage in requested_stages if capabilities[stage]["can_read"]]
    if not allowed_stages:
        frappe.throw(_("当前账号没有此工作台的业务权限。"), frappe.PermissionError)

    return {
        "workbench": workbench_key,
        "allowed_stages": allowed_stages,
        "capabilities": capabilities,
        "is_manager": is_manager,
    }


@frappe.whitelist()
def get_user_procurement_companies() -> dict:
    """Return the list of companies the current user is authorized to access."""
    user = frappe.session.user
    allowed = get_allowed_companies(user)
    if allowed is None:
        all_companies = frappe.get_all("Company", fields=["name"], order_by="name asc")
        company_names = [c.name for c in all_companies]
    else:
        company_names = sorted(list(allowed))

    default_company = frappe.defaults.get_user_default("Company")
    if not default_company and company_names:
        default_company = company_names[0]

    return {
        "companies": company_names,
        "default_company": default_company,
        "is_all_allowed": allowed is None or len(company_names) > 1,
    }


def _resolve_companies(company: str | list[str] | None) -> list[str]:
    """Resolve active company scope list with server-side permission checks."""
    user_comps = get_user_procurement_companies()["companies"]
    if not user_comps:
        frappe.throw(_("当前账号未获得任何公司的访问权限。"))

    if not company or company == "All" or company == "全部公司":
        return user_comps

    if isinstance(company, str):
        target_comps = [c.strip() for c in company.split(",") if c.strip()]
    elif isinstance(company, list):
        target_comps = [str(c).strip() for c in company if str(c).strip()]
    else:
        target_comps = []

    if not target_comps or "All" in target_comps:
        return user_comps

    for comp in target_comps:
        assert_company_access(comp)

    return target_comps


def _meta_has(doctype: str, fieldname: str) -> bool:
    try:
        return bool(frappe.get_meta(doctype).has_field(fieldname))
    except Exception:
        return False


def _lock_source_rows(child_doctype: str, names: list[str]) -> None:
    """Serialize downstream generation for selected source rows."""
    table_map = {
        "Material Request Item": "tabMaterial Request Item",
        "Purchase Order Item": "tabPurchase Order Item",
        "Purchase Receipt Item": "tabPurchase Receipt Item",
    }
    table = table_map.get(child_doctype)
    normalized = list(dict.fromkeys(str(name).strip() for name in (names or []) if str(name or "").strip()))
    if not table or not normalized:
        return
    frappe.db.sql(f"SELECT name FROM `{table}` WHERE name IN %s FOR UPDATE", (normalized,))


# =========================================================================
# Item Search & Quick Creation Helpers
# =========================================================================

@frappe.whitelist()
def search_picker_items(
    query: str | None = None,
    company: str | None = None,
) -> dict:
    """Search items for the quick Material Request modal with rates, UOM, and tax details."""
    _assert_stage_access("item_to_mr", "read")
    assert_doctype_permission("Item", "read")
    companies = _resolve_companies(company)
    target_comp = companies[0] if companies else ""
    query_str = (query or "").strip()

    conditions = ["item.disabled = 0"]
    params: dict[str, Any] = {"comp": target_comp}

    if query_str:
        conditions.append("(item.name LIKE %(q)s OR item.item_name LIKE %(q)s OR item.description LIKE %(q)s)")
        params["q"] = f"%{query_str}%"

    where_clause = " AND ".join(conditions)

    sql = f"""
        SELECT
            item.name AS item_code,
            item.item_name,
            item.item_group,
            item.stock_uom,
            item.description,
            COALESCE(item.standard_rate, 0) AS standard_rate,
            COALESCE(item_def.default_supplier, item_sup.supplier, '') AS default_supplier,
            COALESCE(item_def.default_warehouse, '') AS default_warehouse
        FROM `tabItem` item
        LEFT JOIN `tabItem Default` item_def ON (item_def.parent = item.name AND item_def.company = %(comp)s)
        LEFT JOIN `tabItem Supplier` item_sup ON item_sup.parent = item.name
        WHERE {where_clause}
        GROUP BY item.name
        ORDER BY item.item_name ASC, item.name ASC
        LIMIT 30
    """
    raw_items = frappe.db.sql(sql, params, as_dict=True)

    items = []
    for r in raw_items:
        items.append({
            "item_code": r.item_code,
            "item_name": r.item_name or r.item_code,
            "item_group": r.item_group or "",
            "uom": r.stock_uom or "Nos",
            "stock_uom": r.stock_uom or "Nos",
            "description": r.description or r.item_name or "",
            "standard_rate": flt(r.standard_rate, 2),
            "rate": flt(r.standard_rate, 2),
            "tax_rate": 13.0,
            "default_supplier": r.default_supplier or "",
            "default_warehouse": r.default_warehouse or "",
        })

    return {"items": items}


# =========================================================================
# Step 1: Material Request (采购申请 / 物料申请)
# =========================================================================

@frappe.whitelist()
def get_material_request_picker_rows(
    company: str | None = None,
    filters: dict | str | None = None,
) -> dict:
    """Query Material Request Items for Step 1 Detail View (Read-Only Detail)."""
    _assert_stage_access("item_to_mr", "read")
    companies = _resolve_companies(company)
    if isinstance(filters, str):
        filters = frappe.parse_json(filters) or {}
    filters = dict(filters or {})

    has_mr_dept = _meta_has("Material Request", "department")
    dept_col = "COALESCE(mr.department, '')" if has_mr_dept else "''"

    status_filter = filters.get("match_status") or filters.get("purchase_status") or "all"

    conditions = [
        "mr.material_request_type = 'Purchase'",
        "mr.docstatus < 2",
        "mr.company IN %(companies)s",
    ]
    params: dict[str, Any] = {"companies": companies}

    if status_filter == "draft":
        conditions.append("mr.docstatus = 0")
    elif status_filter in ("submitted", "formal"):
        conditions.append("mr.docstatus = 1")
    elif status_filter == "pending":
        conditions.append("mr.docstatus = 0")

    if filters.get("mr_name"):
        conditions.append("mr.name LIKE %(mr_name)s")
        params["mr_name"] = f"%{filters['mr_name']}%"

    if filters.get("item_code"):
        conditions.append("(mri.item_code LIKE %(item_code)s OR mri.item_name LIKE %(item_code)s)")
        params["item_code"] = f"%{filters['item_code']}%"

    if filters.get("item_group"):
        conditions.append("mri.item_group = %(item_group)s")
        params["item_group"] = filters["item_group"]

    if filters.get("department") and has_mr_dept:
        conditions.append("mr.department = %(department)s")
        params["department"] = filters["department"]

    where_clause = " AND ".join(conditions)

    sql = f"""
        SELECT
            mri.name AS mri_name,
            mr.name AS mr_name,
            mr.company,
            mr.transaction_date,
            COALESCE(mri.schedule_date, mr.schedule_date) AS schedule_date,
            {dept_col} AS department,
            mr.docstatus,
            mr.status,
            mri.item_code,
            mri.item_name,
            mri.description,
            mri.item_group,
            COALESCE(mri.uom, mri.stock_uom, '') AS uom,
            COALESCE(mri.qty, 0) AS qty,
            COALESCE(mri.ordered_qty, 0) AS ordered_qty,
            COALESCE(mri.rate, item.standard_rate, 0) AS rate,
            COALESCE(item_def.default_supplier, item_sup.supplier, '') AS default_supplier,
            COALESCE(mri.warehouse, item_def.default_warehouse, '') AS warehouse
        FROM `tabMaterial Request Item` mri
        INNER JOIN `tabMaterial Request` mr ON mr.name = mri.parent
        LEFT JOIN `tabItem` item ON item.name = mri.item_code
        LEFT JOIN `tabItem Default` item_def ON (item_def.parent = mri.item_code AND item_def.company = mr.company)
        LEFT JOIN `tabItem Supplier` item_sup ON item_sup.parent = mri.item_code
        WHERE {where_clause}
        ORDER BY mr.transaction_date DESC, mr.name DESC, mri.idx ASC
        LIMIT 1000
    """

    raw_rows = frappe.db.sql(sql, params, as_dict=True)
    raw_rows = filter_rows_by_doctype_permission(raw_rows, "Material Request", "mr_name")

    rows = []
    for r in raw_rows:
        spec, remarks = extract_spec_and_remarks(r)
        qty = flt(r.qty, 2)
        rate = flt(r.rate, 2)
        rows.append({
            "mri_name": r.mri_name,
            "mr_name": r.mr_name,
            "company": r.company,
            "transaction_date": str(r.transaction_date or ""),
            "schedule_date": str(r.schedule_date or ""),
            "department": r.department or "",
            "item_code": r.item_code,
            "item_name": r.item_name or r.item_code,
            "description": r.description or "",
            "item_group": r.item_group or "",
            "uom": r.uom or "",
            "qty": qty,
            "ordered_qty": flt(r.ordered_qty, 2),
            "pending_qty": max(flt(r.qty) - flt(r.ordered_qty), 0.0),
            "rate": rate,
            "amount": flt(qty * rate, 2),
            "spec": spec,
            "remarks": remarks,
            "supplier": r.default_supplier or "",
            "warehouse": r.warehouse or "",
            "docstatus": r.docstatus,
            "status": r.status or "Draft",
        })

    return {
        "companies": companies,
        "count": len(rows),
        "rows": rows,
    }


@frappe.whitelist()
def get_material_request_doc_rows(
    company: str | None = None,
    filters: dict | str | None = None,
) -> dict:
    """Query Material Request Documents for Step 1 Header/Doc View."""
    _assert_stage_access("item_to_mr", "read")
    companies = _resolve_companies(company)
    if isinstance(filters, str):
        filters = frappe.parse_json(filters) or {}
    filters = dict(filters or {})

    has_mr_dept = _meta_has("Material Request", "department")
    dept_col = "COALESCE(mr.department, '')" if has_mr_dept else "''"
    has_custom_doc_details = _meta_has("Material Request", "custom_doc_details")
    doc_details_col = "COALESCE(mr.custom_doc_details, '')" if has_custom_doc_details else "''"

    status_filter = filters.get("match_status") or filters.get("purchase_status") or "all"

    conditions = [
        "mr.material_request_type = 'Purchase'",
        "mr.docstatus < 2",
        "mr.company IN %(companies)s",
    ]
    params: dict[str, Any] = {"companies": companies}

    if status_filter == "draft":
        conditions.append("mr.docstatus = 0")
    elif status_filter in ("submitted", "formal"):
        conditions.append("mr.docstatus = 1")
    elif status_filter == "pending":
        conditions.append("mr.docstatus = 0")

    if filters.get("mr_name"):
        conditions.append("mr.name LIKE %(mr_name)s")
        params["mr_name"] = f"%{filters['mr_name']}%"

    if filters.get("department") and has_mr_dept:
        conditions.append("mr.department = %(department)s")
        params["department"] = filters["department"]

    where_clause = " AND ".join(conditions)

    having_clause = ""

    sql = f"""
        SELECT
            mr.name AS mr_name,
            mr.company,
            mr.transaction_date,
            mr.schedule_date,
            {dept_col} AS department,
            {doc_details_col} AS custom_doc_details,
            mr.docstatus,
            mr.status,
            mr.owner,
            COUNT(mri.name) AS item_count,
            COALESCE(SUM(mri.qty), 0) AS total_qty,
            COALESCE(SUM(mri.ordered_qty), 0) AS total_ordered_qty,
            GROUP_CONCAT(DISTINCT CONCAT(mri.item_name, ' (', ROUND(mri.qty, 2), ' ', COALESCE(mri.uom, mri.stock_uom, ''), ')') SEPARATOR '、') AS synthesized_details
        FROM `tabMaterial Request` mr
        LEFT JOIN `tabMaterial Request Item` mri ON mri.parent = mr.name
        WHERE {where_clause}
        GROUP BY mr.name
        {having_clause}
        ORDER BY mr.transaction_date DESC, mr.name DESC
        LIMIT 1000
    """

    docs = frappe.db.sql(sql, params, as_dict=True)
    docs = filter_rows_by_doctype_permission(docs, "Material Request", "mr_name")
    for d in docs:
        if not d.get("custom_doc_details"):
            d["custom_doc_details"] = d.get("synthesized_details") or ""
        d["total_qty"] = flt(d.get("total_qty"), 2)

    return {
        "companies": companies,
        "count": len(docs),
        "rows": docs,
    }


@frappe.whitelist(methods=["POST"])
def quick_create_material_request(
    company: str,
    items: list[dict] | str,
    department: str | None = None,
    schedule_date: str | None = None,
    purpose: str | None = None,
) -> dict:
    """Quickly create a new Material Request (Purchase) from the lightweight modal with rates and taxes."""
    _assert_stage_access("item_to_mr", "create")
    if isinstance(items, str):
        items = frappe.parse_json(items) or []

    if not company:
        frappe.throw(_("请指定所属公司。"))

    assert_company_access(company)

    if not items:
        frappe.throw(_("请至少添加一行物料申请明细。"))

    default_company_wh = (
        frappe.db.get_value("Warehouse", {"company": company, "is_group": 0}, "name")
        or ""
    )

    mr = frappe.new_doc("Material Request")
    mr.material_request_type = "Purchase"
    mr.company = company
    mr.transaction_date = get_effective_work_date()
    mr.schedule_date = schedule_date or frappe.utils.add_months(nowdate(), 1)
    if default_company_wh and _meta_has("Material Request", "set_warehouse"):
        mr.set_warehouse = default_company_wh
    if department and _meta_has("Material Request", "department"):
        mr.department = department

    total_amount = 0.0
    for it in items:
        item_code = (it.get("item_code") or "").strip()
        item_name = (it.get("item_name") or "").strip() or item_code

        if not frappe.db.exists("Item", item_code):
            if not frappe.has_permission("Item", "create"):
                frappe.throw(
                    _("物料 {0} 不存在，且当前账号没有新建物料的权限。请先由物料管理员建立档案。").format(item_code),
                    frappe.PermissionError,
                )
            new_it = frappe.new_doc("Item")
            new_it.item_code = item_code
            new_it.item_name = item_name
            new_it.item_group = frappe.db.get_value("Item Group", {"is_group": 0}, "name") or "All Item Groups"
            new_it.stock_uom = it.get("uom") or "Nos"
            new_it.is_stock_item = 1
            new_it.insert()
            item_doc = new_it
        else:
            item_doc = frappe.get_cached_doc("Item", item_code)

        qty = flt(it.get("qty") or 1.0, 4)
        if qty <= 0:
            qty = 1.0

        rate = flt(it.get("rate") or getattr(item_doc, "standard_rate", 0.0) or 0.0, 2)
        amount = flt(it.get("amount") or (qty * rate), 2)
        tax_rate = flt(it.get("tax_rate") or 13.0, 2)
        tax_amount = flt(it.get("tax_amount") or (amount * (tax_rate / 100.0)), 2)
        total_price = flt(it.get("total_amount") or (amount + tax_amount), 2)
        total_amount += total_price

        uom = it.get("uom") or getattr(item_doc, "stock_uom", "Nos") or "Nos"
        item_wh = (
            it.get("warehouse")
            or frappe.db.get_value("Item Default", {"parent": item_code, "company": company}, "default_warehouse")
            or default_company_wh
        )

        item_name = (it.get("item_name") or "").strip() or item_doc.item_name
        item_spec = (it.get("spec") or it.get("custom_spec_model") or "").strip()
        item_remarks = (it.get("remarks") or it.get("custom_line_remark") or it.get("description") or "").strip()

        row_dict = {
            "item_code": item_code,
            "item_name": item_name,
            "description": item_remarks or item_doc.description or item_name,
            "item_group": item_doc.item_group,
            "uom": uom,
            "stock_uom": item_doc.stock_uom or uom,
            "qty": qty,
            "rate": rate,
            "amount": amount,
            "schedule_date": schedule_date or str(getdate(nowdate())),
            "warehouse": item_wh,
        }
        if _meta_has("Material Request Item", "custom_spec_model"):
            row_dict["custom_spec_model"] = item_spec
        if _meta_has("Material Request Item", "custom_line_remark"):
            row_dict["custom_line_remark"] = item_remarks
        if _meta_has("Material Request Item", "custom_tax_rate"):
            row_dict["custom_tax_rate"] = tax_rate
        if _meta_has("Material Request Item", "custom_tax_amount"):
            row_dict["custom_tax_amount"] = tax_amount
        if _meta_has("Material Request Item", "custom_total_amount"):
            row_dict["custom_total_amount"] = total_price

        mr.append("items", row_dict)

    if not mr.items:
        frappe.throw(_("未能录入有效的物料明细。"))

    mr.flags.ignore_permissions = False
    mr.insert()
    mr.submit()

    return {
        "success": True,
        "name": mr.name,
        "company": mr.company,
        "item_count": len(mr.items),
        "total_amount": total_amount,
        "message": _("成功创建并正式提交采购申请单：{0}").format(mr.name),
    }


@frappe.whitelist(methods=["POST"])
def update_quick_material_request(
    name: str,
    items: list[dict] | str,
    company: str | None = None,
    schedule_date: str | None = None,
    department: str | None = None,
) -> dict:
    """Update an existing Material Request before any Purchase Order is generated."""
    _assert_stage_access("item_to_mr", "write")
    if not name:
        frappe.throw(_("缺少申请单号。"))

    if isinstance(items, str):
        items = frappe.parse_json(items) or []

    if not items:
        frappe.throw(_("请至少保留一行物料申请明细。"))

    mr = frappe.get_doc("Material Request", name)
    assert_company_access(mr.company)
    if mr.docstatus != 0:
        frappe.throw(_("已提交采购申请单仅可查看；如需更正，请按作废或重开流程处理。"))
    if not frappe.has_permission("Material Request", "write", mr):
        frappe.throw(_("您没有编辑该采购申请单的权限。"), frappe.PermissionError)

    # 1. Check if any downstream Purchase Order exists
    linked_po_items = frappe.db.sql("""
        SELECT poi.parent, poi.item_code
        FROM `tabPurchase Order Item` poi
        INNER JOIN `tabPurchase Order` po ON po.name = poi.parent
        WHERE poi.material_request = %s
          AND po.docstatus < 2
    """, (name,), as_dict=True)

    if linked_po_items:
        po_names = list({r.parent for r in linked_po_items})
        frappe.throw(_("该采购申请单已生成下游采购订单（{0}），禁止直接修改。若需修改请先删除或撤销关联的采购订单。").format(", ".join(po_names)))

    if company:
        mr.company = company
    if schedule_date:
        mr.schedule_date = schedule_date
    if department and _meta_has("Material Request", "department"):
        mr.department = department

    default_company_wh = (
        frappe.db.get_value("Warehouse", {"company": mr.company, "is_group": 0}, "name")
        or ""
    )

    # Clear old items and append updated items
    mr.set("items", [])
    total_amount = 0.0

    for it in items:
        item_code = (it.get("item_code") or "").strip()
        if not item_code:
            continue

        item_name = (it.get("item_name") or "").strip() or item_code

        if not frappe.db.exists("Item", item_code):
            new_it = frappe.new_doc("Item")
            new_it.item_code = item_code
            new_it.item_name = item_name
            new_it.item_group = frappe.db.get_value("Item Group", {"is_group": 0}, "name") or "All Item Groups"
            new_it.stock_uom = it.get("uom") or "Nos"
            new_it.is_stock_item = 1
            new_it.flags.ignore_permissions = True
            new_it.insert()
            item_doc = new_it
        else:
            item_doc = frappe.get_cached_doc("Item", item_code)

        qty = flt(it.get("qty") or 1.0, 4)
        if qty <= 0:
            qty = 1.0

        rate = flt(it.get("rate") or getattr(item_doc, "standard_rate", 0.0) or 0.0, 2)
        amount = flt(it.get("amount") or (qty * rate), 2)
        tax_rate = flt(it.get("tax_rate") or 13.0, 2)
        tax_amount = flt(it.get("tax_amount") or (amount * (tax_rate / 100.0)), 2)
        total_price = flt(it.get("total_amount") or (amount + tax_amount), 2)
        total_amount += total_price

        uom = it.get("uom") or item_doc.stock_uom or "Nos"
        item_wh = (
            it.get("warehouse")
            or frappe.db.get_value("Item Default", {"parent": item_code, "company": mr.company}, "default_warehouse")
            or default_company_wh
        )

        item_name = (it.get("item_name") or "").strip() or item_doc.item_name
        item_spec = (it.get("spec") or it.get("custom_spec_model") or "").strip()
        item_remarks = (it.get("remarks") or it.get("custom_line_remark") or it.get("description") or "").strip()

        row_dict = {
            "item_code": item_code,
            "item_name": item_name,
            "description": item_remarks or item_doc.description or item_name,
            "item_group": item_doc.item_group,
            "uom": uom,
            "stock_uom": item_doc.stock_uom or uom,
            "qty": qty,
            "rate": rate,
            "amount": amount,
            "schedule_date": schedule_date or str(mr.schedule_date or getdate(nowdate())),
            "warehouse": item_wh,
        }
        if _meta_has("Material Request Item", "custom_spec_model"):
            row_dict["custom_spec_model"] = item_spec
        if _meta_has("Material Request Item", "custom_line_remark"):
            row_dict["custom_line_remark"] = item_remarks
        if _meta_has("Material Request Item", "custom_tax_rate"):
            row_dict["custom_tax_rate"] = tax_rate
        if _meta_has("Material Request Item", "custom_tax_amount"):
            row_dict["custom_tax_amount"] = tax_amount
        if _meta_has("Material Request Item", "custom_total_amount"):
            row_dict["custom_total_amount"] = total_price

        mr.append("items", row_dict)

    if not mr.items:
        frappe.throw(_("未能录入有效的物料明细。"))

    mr.save()

    return {
        "success": True,
        "name": mr.name,
        "company": mr.company,
        "item_count": len(mr.items),
        "total_amount": total_amount,
        "message": _("成功保存采购申请单草稿：{0}").format(mr.name),
    }


def _get_mr_downstream_links(mr_name: str, include_all: bool = False) -> list[str]:
    """Check whether a Material Request has any downstream linked documents."""
    links = []

    # 1. Purchase Order
    docstatus_cond_po = "" if include_all else "AND po.docstatus < 2"
    pos = frappe.db.sql(f"""
        SELECT DISTINCT poi.parent, po.name, po.status, po.docstatus
        FROM `tabPurchase Order Item` poi
        INNER JOIN `tabPurchase Order` po ON po.name = poi.parent
        WHERE poi.material_request = %s {docstatus_cond_po}
    """, (mr_name,), as_dict=True)
    if pos:
        po_labels = [f"{p.name} ({_('草稿') if p.docstatus == 0 else (_('已作废') if p.docstatus == 2 else _('已提交'))})" for p in pos]
        links.append(f"采购订单: {', '.join(po_labels)}")

    # 2. Request for Quotation
    docstatus_cond_rfq = "" if include_all else "AND rfq.docstatus < 2"
    rfqs = frappe.db.sql(f"""
        SELECT DISTINCT rfqi.parent, rfq.name, rfq.status, rfq.docstatus
        FROM `tabRequest for Quotation Item` rfqi
        INNER JOIN `tabRequest for Quotation` rfq ON rfq.name = rfqi.parent
        WHERE rfqi.material_request = %s {docstatus_cond_rfq}
    """, (mr_name,), as_dict=True)
    if rfqs:
        rfq_labels = [f"{r.name} ({_('草稿') if r.docstatus == 0 else (_('已作废') if r.docstatus == 2 else _('已提交'))})" for r in rfqs]
        links.append(f"询价单: {', '.join(rfq_labels)}")

    # 3. Supplier Quotation
    docstatus_cond_sq = "" if include_all else "AND sq.docstatus < 2"
    sqs = frappe.db.sql(f"""
        SELECT DISTINCT sqi.parent, sq.name, sq.status, sq.docstatus
        FROM `tabSupplier Quotation Item` sqi
        INNER JOIN `tabSupplier Quotation` sq ON sq.name = sqi.parent
        WHERE sqi.material_request = %s {docstatus_cond_sq}
    """, (mr_name,), as_dict=True)
    if sqs:
        sq_labels = [f"{s.name} ({_('草稿') if s.docstatus == 0 else (_('已作废') if s.docstatus == 2 else _('已提交'))})" for s in sqs]
        links.append(f"供应商报价单: {', '.join(sq_labels)}")

    # 4. Stock Entry
    docstatus_cond_se = "" if include_all else "AND se.docstatus < 2"
    ses = frappe.db.sql(f"""
        SELECT DISTINCT sed.parent, se.name, se.docstatus
        FROM `tabStock Entry Detail` sed
        INNER JOIN `tabStock Entry` se ON se.name = sed.parent
        WHERE sed.material_request = %s {docstatus_cond_se}
    """, (mr_name,), as_dict=True)
    if ses:
        se_labels = [f"{s.name} ({_('草稿') if s.docstatus == 0 else (_('已作废') if s.docstatus == 2 else _('已提交'))})" for s in ses]
        links.append(f"库存出入库单: {', '.join(se_labels)}")

    return links


@frappe.whitelist(methods=["POST"])
def batch_cancel_material_requests(names: list[str] | str) -> dict:
    """Safely cancel selected Material Requests (docstatus=1 -> 2), ensuring no downstream links exist."""
    _assert_stage_access("item_to_mr", "cancel")
    if isinstance(names, str):
        names = frappe.parse_json(names) or []

    if not names:
        frappe.throw(_("请指定需要撤单的采购申请单。"))

    unique_names = list(dict.fromkeys(names))
    cancelled = []

    for name in unique_names:
        if not frappe.db.exists("Material Request", name):
            frappe.throw(_("采购申请单【{0}】不存在。").format(name))

        mr = frappe.get_doc("Material Request", name)
        assert_company_access(mr.company)

        if mr.docstatus == 0:
            frappe.throw(_("采购申请单【{0}】为草稿状态，尚未正式提交，无需撤单；如不再需要请直接执行【删除单据】。").format(name))
        elif mr.docstatus == 2:
            frappe.throw(_("采购申请单【{0}】已经处于撤单/作废状态，无需重复撤单。").format(name))

        # Check downstream links (active ones block cancellation)
        linked_info = _get_mr_downstream_links(name, include_all=False)
        if linked_info:
            frappe.throw(
                _("采购申请单【{0}】无法撤单：已生成关联下游单据（{1}）。必须先取消或删除关联单据后方可撤单。").format(
                    name, "；".join(linked_info)
                )
            )

        if not frappe.has_permission("Material Request", "cancel", mr):
            frappe.throw(_("您没有撤销采购申请单【{0}】的权限。").format(name), frappe.PermissionError)

        mr.cancel()
        cancelled.append(name)

    return {
        "success": True,
        "count": len(cancelled),
        "names": cancelled,
        "message": _("成功撤单 {0} 张采购申请单：{1}").format(len(cancelled), "、".join(cancelled)),
    }


@frappe.whitelist(methods=["POST"])
def batch_delete_material_requests(names: list[str] | str) -> dict:
    """Safely delete selected Material Requests. Strictly enforce: 仅限没有关联单据情况允许删除."""
    _assert_stage_access("item_to_mr", "delete")
    if isinstance(names, str):
        names = frappe.parse_json(names) or []

    if not names:
        frappe.throw(_("请指定需要删除的采购申请单。"))

    unique_names = list(dict.fromkeys(names))
    deleted = []

    for name in unique_names:
        if not frappe.db.exists("Material Request", name):
            continue

        mr = frappe.get_doc("Material Request", name)
        assert_company_access(mr.company)

        # Strictly enforce: 仅限没有关联单据情况允许删除 (check ALL links including drafts/cancelled)
        linked_info = _get_mr_downstream_links(name, include_all=True)
        if linked_info:
            frappe.throw(
                _("采购申请单【{0}】存在关联单据（{1}），根据管理规范【仅限没有关联单据情况允许删除】！无法执行删除。").format(
                    name, "；".join(linked_info)
                )
            )

        if not frappe.has_permission("Material Request", "delete", mr):
            frappe.throw(_("您没有删除采购申请单【{0}】的权限。").format(name), frappe.PermissionError)

        # In ERPNext, if submitted, it must be cancelled first before deletion
        if mr.docstatus == 1:
            if not frappe.has_permission("Material Request", "cancel", mr):
                frappe.throw(_("采购申请单【{0}】处于已提交状态，删除前需先撤单，但您缺少撤单权限。").format(name), frappe.PermissionError)
            mr.cancel()

        mr.delete()
        deleted.append(name)

    return {
        "success": True,
        "count": len(deleted),
        "names": deleted,
        "message": _("成功删除 {0} 张采购申请单：{1}").format(len(deleted), "、".join(deleted)),
    }


def extract_spec_and_remarks(item_row: dict | Any) -> tuple[str, str]:
    """Extract pure spec and pure remarks from item row with backward compatibility."""
    if isinstance(item_row, dict):
        spec = (item_row.get("custom_spec_model") or item_row.get("custom_item_spec") or item_row.get("spec") or "").strip()
        remarks = (item_row.get("custom_line_remark") or item_row.get("remarks") or "").strip()
        raw_desc = (item_row.get("description") or "").strip()
        item_name = (item_row.get("item_name") or "").strip()
        item_code = (item_row.get("item_code") or "").strip()
    else:
        spec = (getattr(item_row, "custom_spec_model", None) or getattr(item_row, "custom_item_spec", None) or getattr(item_row, "spec", None) or "").strip()
        remarks = (getattr(item_row, "custom_line_remark", None) or getattr(item_row, "remarks", None) or "").strip()
        raw_desc = (getattr(item_row, "description", None) or "").strip()
        item_name = (getattr(item_row, "item_name", None) or "").strip()
        item_code = (getattr(item_row, "item_code", None) or "").strip()

    # If pure remarks is empty, sanitize from raw_desc
    if not remarks and raw_desc:
        if " | " in raw_desc:
            parts = [p.strip() for p in raw_desc.split(" | ") if p.strip()]
            clean_parts = []
            for p in parts:
                if p.startswith("规格:"):
                    if not spec:
                        spec = p[3:].strip()
                elif item_name and p == item_name:
                    continue
                elif item_code and p == item_code:
                    continue
                else:
                    clean_parts.append(p)
            remarks = " | ".join(clean_parts)
        elif raw_desc.startswith("规格:"):
            if not spec:
                spec = raw_desc[3:].strip()
        elif raw_desc != item_name and raw_desc != item_code:
            remarks = raw_desc

    return spec, remarks


def parse_description_parts(desc: str | None, item_name: str | None = None) -> tuple[str, str]:
    """Backward-compatible alias for extract_spec_and_remarks."""
    return extract_spec_and_remarks({"description": desc, "item_name": item_name})


# =========================================================================
# Step 2: Material Request (Item/Doc) -> Purchase Order (采购订货)
# =========================================================================

@frappe.whitelist()
def get_pending_material_request_items(
    company: str | None = None,
    filters: dict | str | None = None,
) -> dict:
    """Query Material Request Items for Step 2 Detail View with match_status and linked POs."""
    _assert_stage_access("mr_to_po", "read")
    companies = _resolve_companies(company)
    if isinstance(filters, str):
        filters = frappe.parse_json(filters) or {}
    filters = dict(filters or {})

    match_status = filters.get("match_status") or "pending"
    if match_status == "all":
        return get_all_purchase_order_items(company, filters)

    conditions = [
        "mr.docstatus = 1",
        "mr.material_request_type = 'Purchase'",
        "mr.company IN %(companies)s",
        "mr.status NOT IN ('Stopped', 'Cancelled', 'Transfer')",
    ]
    params: dict[str, Any] = {"companies": companies}

    if match_status == "pending":
        conditions.append("(mri.qty - COALESCE(mri.ordered_qty, 0)) > 0.0001")
    elif match_status == "linked":
        conditions.append("COALESCE(mri.ordered_qty, 0) > 0.0001")

    has_mr_dept = _meta_has("Material Request", "department")
    has_mri_dept = _meta_has("Material Request Item", "department")

    if filters.get("department"):
        if has_mr_dept:
            conditions.append("mr.department = %(department)s")
            params["department"] = filters["department"]
        elif has_mri_dept:
            conditions.append("mri.department = %(department)s")
            params["department"] = filters["department"]

    if filters.get("owner"):
        conditions.append("mr.owner LIKE %(owner)s")
        params["owner"] = f"%{filters['owner']}%"

    if filters.get("item_code"):
        conditions.append("(mri.item_code LIKE %(item_code)s OR mri.item_name LIKE %(item_code)s)")
        params["item_code"] = f"%{filters['item_code']}%"

    if filters.get("supplier"):
        conditions.append("(COALESCE(item_def.default_supplier, '') = %(supplier)s OR COALESCE(item_sup.supplier, '') = %(supplier)s)")
        params["supplier"] = filters["supplier"]

    if filters.get("from_date"):
        conditions.append("mr.transaction_date >= %(from_date)s")
        params["from_date"] = filters["from_date"]

    if filters.get("to_date"):
        conditions.append("mr.transaction_date <= %(to_date)s")
        params["to_date"] = filters["to_date"]

    if filters.get("linked_doc"):
        conditions.append("EXISTS (SELECT 1 FROM `tabPurchase Order Item` poi_flt WHERE poi_flt.material_request_item = mri.name AND poi_flt.parent LIKE %(linked_doc)s)")
        params["linked_doc"] = f"%{filters['linked_doc']}%"

    where_clause = " AND ".join(conditions)

    dept_col = "COALESCE(mr.department, '')" if has_mr_dept else "''"

    sql = f"""
        SELECT
            mri.name AS mri_name,
            mr.name AS mr_name,
            mr.company,
            mr.transaction_date,
            COALESCE(mri.schedule_date, mr.schedule_date) AS schedule_date,
            {dept_col} AS department,
            mr.owner AS requested_by,
            mri.item_code,
            mri.item_name,
            mri.description,
            COALESCE(mri.custom_spec_model, '') AS custom_spec_model,
            COALESCE(mri.custom_line_remark, '') AS custom_line_remark,
            mri.item_group,
            COALESCE(mri.uom, mri.stock_uom, '') AS uom,
            COALESCE(mri.qty, 0) AS qty,
            COALESCE(mri.ordered_qty, 0) AS ordered_qty,
            GREATEST(COALESCE(mri.qty, 0) - COALESCE(mri.ordered_qty, 0), 0) AS pending_qty,
            COALESCE(mri.rate, item.standard_rate, 0) AS rate,
            (GREATEST(COALESCE(mri.qty, 0) - COALESCE(mri.ordered_qty, 0), 0) * COALESCE(mri.rate, item.standard_rate, 0)) AS estimated_amount,
            COALESCE(item_def.default_supplier, item_sup.supplier, '') AS default_supplier,
            COALESCE(mri.warehouse, item_def.default_warehouse, '') AS warehouse,
            (
                SELECT GROUP_CONCAT(DISTINCT poi.parent ORDER BY poi.parent DESC SEPARATOR '、')
                FROM `tabPurchase Order Item` poi
                INNER JOIN `tabPurchase Order` po_inner ON po_inner.name = poi.parent
                WHERE poi.material_request_item = mri.name AND po_inner.docstatus < 2
            ) AS linked_po_names
        FROM `tabMaterial Request Item` mri
        INNER JOIN `tabMaterial Request` mr ON mr.name = mri.parent
        LEFT JOIN `tabItem` item ON item.name = mri.item_code
        LEFT JOIN `tabItem Default` item_def ON (item_def.parent = mri.item_code AND item_def.company = mr.company)
        LEFT JOIN `tabItem Supplier` item_sup ON item_sup.parent = mri.item_code
        WHERE {where_clause}
        ORDER BY mr.transaction_date DESC, mr.name DESC, mri.idx ASC
        LIMIT 1000
    """

    raw_items = frappe.db.sql(sql, params, as_dict=True)
    raw_items = filter_rows_by_doctype_permission(raw_items, "Material Request", "mr_name")
    today = str(getdate(nowdate()))

    rows = []
    for r in raw_items:
        sched = str(r.schedule_date or "")
        is_overdue = bool(sched and sched < today)
        is_urgent = bool(sched and sched <= today)

        rate = flt(r.rate, 2)
        pending_qty = flt(r.pending_qty, 2)
        amount = flt(pending_qty * rate, 2)
        tax_rate = 13.0
        tax_amount = flt(amount * (tax_rate / 100.0), 2)
        total_amount = flt(amount + tax_amount, 2)

        spec, remarks = extract_spec_and_remarks(r)

        rows.append({
            "mri_name": r.mri_name,
            "mr_name": r.mr_name,
            "company": r.company,
            "transaction_date": str(r.transaction_date or ""),
            "schedule_date": sched,
            "is_overdue": is_overdue,
            "is_urgent": is_urgent,
            "department": r.department or "",
            "requested_by": r.requested_by or "",
            "item_code": r.item_code,
            "item_name": r.item_name or r.item_code,
            "spec": spec,
            "remarks": remarks,
            "description": remarks,
            "item_group": r.item_group or "",
            "uom": r.uom or "",
            "qty": flt(r.qty, 2),
            "ordered_qty": flt(r.ordered_qty, 2),
            "pending_qty": pending_qty,
            "this_qty": pending_qty,
            "rate": rate,
            "amount": amount,
            "tax_rate": tax_rate,
            "tax_amount": tax_amount,
            "total_amount": total_amount,
            "estimated_amount": amount,
            "supplier": r.default_supplier or "",
            "warehouse": r.warehouse or "",
            "linked_po_names": r.linked_po_names or "",
        })

    return {
        "companies": companies,
        "count": len(rows),
        "rows": rows,
    }


@frappe.whitelist()
def get_pending_material_request_docs(
    company: str | None = None,
    filters: dict | str | None = None,
) -> dict:
    """Query Material Request Documents for Step 2 Doc View with match_status and linked POs."""
    _assert_stage_access("mr_to_po", "read")
    companies = _resolve_companies(company)
    if isinstance(filters, str):
        filters = frappe.parse_json(filters) or {}
    filters = dict(filters or {})

    match_status = filters.get("match_status") or "pending"
    if match_status == "all":
        return get_all_purchase_order_docs(company, filters)

    has_mr_dept = _meta_has("Material Request", "department")
    dept_col = "COALESCE(mr.department, '')" if has_mr_dept else "''"
    has_custom_doc_details = _meta_has("Material Request", "custom_doc_details")
    doc_details_col = "COALESCE(mr.custom_doc_details, '')" if has_custom_doc_details else "''"

    conditions = [
        "mr.docstatus = 1",
        "mr.material_request_type = 'Purchase'",
        "mr.company IN %(companies)s",
        "mr.status NOT IN ('Stopped', 'Cancelled', 'Transfer')",
    ]
    params: dict[str, Any] = {"companies": companies}

    if match_status == "pending":
        conditions.append("EXISTS (SELECT 1 FROM `tabMaterial Request Item` mri_chk WHERE mri_chk.parent = mr.name AND (mri_chk.qty - COALESCE(mri_chk.ordered_qty, 0)) > 0.0001)")
    elif match_status == "linked":
        conditions.append("EXISTS (SELECT 1 FROM `tabPurchase Order Item` poi_chk INNER JOIN `tabPurchase Order` po_chk ON po_chk.name = poi_chk.parent WHERE poi_chk.material_request = mr.name AND po_chk.docstatus < 2)")

    if filters.get("mr_name"):
        conditions.append("mr.name LIKE %(mr_name)s")
        params["mr_name"] = f"%{filters['mr_name']}%"

    if filters.get("department") and has_mr_dept:
        conditions.append("mr.department = %(department)s")
        params["department"] = filters["department"]

    if filters.get("from_date"):
        conditions.append("mr.transaction_date >= %(from_date)s")
        params["from_date"] = filters["from_date"]

    if filters.get("to_date"):
        conditions.append("mr.transaction_date <= %(to_date)s")
        params["to_date"] = filters["to_date"]

    if filters.get("linked_doc"):
        conditions.append("EXISTS (SELECT 1 FROM `tabPurchase Order Item` poi_flt WHERE poi_flt.material_request = mr.name AND poi_flt.parent LIKE %(linked_doc)s)")
        params["linked_doc"] = f"%{filters['linked_doc']}%"

    where_clause = " AND ".join(conditions)

    sql = f"""
        SELECT
            mr.name AS mr_name,
            mr.company,
            mr.transaction_date,
            mr.schedule_date,
            {dept_col} AS department,
            {doc_details_col} AS custom_doc_details,
            mr.docstatus,
            mr.status,
            mr.owner,
            COUNT(DISTINCT mri.name) AS pending_item_count,
            COALESCE(SUM(GREATEST(mri.qty - COALESCE(mri.ordered_qty, 0), 0)), 0) AS pending_qty,
            COALESCE(SUM(GREATEST(mri.qty - COALESCE(mri.ordered_qty, 0), 0) * COALESCE(mri.rate, item.standard_rate, 0)), 0) AS estimated_amount,
            GROUP_CONCAT(DISTINCT COALESCE(item_def.default_supplier, item_sup.supplier, '') SEPARATOR '、') AS suppliers,
            GROUP_CONCAT(DISTINCT CONCAT(mri.item_name, ' (', ROUND(GREATEST(mri.qty - COALESCE(mri.ordered_qty, 0), 0), 2), ' ', COALESCE(mri.uom, mri.stock_uom, ''), ')') SEPARATOR '、') AS synthesized_details,
            (
                SELECT GROUP_CONCAT(DISTINCT poi.parent ORDER BY poi.parent DESC SEPARATOR '、')
                FROM `tabPurchase Order Item` poi
                INNER JOIN `tabPurchase Order` po_inner ON po_inner.name = poi.parent
                WHERE poi.material_request = mr.name AND po_inner.docstatus < 2
            ) AS linked_po_names
        FROM `tabMaterial Request` mr
        INNER JOIN `tabMaterial Request Item` mri ON mri.parent = mr.name
        LEFT JOIN `tabItem` item ON item.name = mri.item_code
        LEFT JOIN `tabItem Default` item_def ON (item_def.parent = mri.item_code AND item_def.company = mr.company)
        LEFT JOIN `tabItem Supplier` item_sup ON item_sup.parent = mri.item_code
        WHERE {where_clause}
        GROUP BY mr.name
        ORDER BY mr.transaction_date DESC, mr.name DESC
        LIMIT 500
    """

    docs = frappe.db.sql(sql, params, as_dict=True)
    docs = filter_rows_by_doctype_permission(docs, "Material Request", "mr_name")
    for d in docs:
        if not d.get("custom_doc_details"):
            d["custom_doc_details"] = d.get("synthesized_details") or ""
        d["pending_qty"] = flt(d.get("pending_qty"), 2)
        d["estimated_amount"] = flt(d.get("estimated_amount"), 2)
        d["supplier"] = (d.get("suppliers") or "").strip("、")
        d["linked_po_names"] = d.get("linked_po_names") or ""

    return {
        "companies": companies,
        "count": len(docs),
        "rows": docs,
    }


@frappe.whitelist(methods=["POST"])
def make_purchase_orders_from_mr_items(
    company: str | None,
    selected_items: list[dict] | str,
    supplier_override: str | None = None,
    schedule_date: str | None = None,
    submit_doc: int | bool = 1,
) -> dict:
    """Generate Draft or Submitted Purchase Order(s) grouped by Supplier from selected MR items or MR docs."""
    _assert_stage_access("mr_to_po", "create")
    if isinstance(selected_items, str):
        selected_items = frappe.parse_json(selected_items) or []

    if not selected_items:
        frappe.throw(_("请至少选择一项采购需求明细或单据。"))

    # If docs were passed (e.g. objects with mr_name only), expand to pending items
    expanded_items = []
    for it in selected_items:
        if it.get("mri_name"):
            expanded_items.append(it)
        elif it.get("mr_name"):
            doc_items = frappe.db.sql("""
                SELECT mri.name AS mri_name, (mri.qty - COALESCE(mri.ordered_qty, 0)) AS this_qty, mri.rate, mri.parent AS mr_name
                FROM `tabMaterial Request Item` mri
                WHERE mri.parent = %s AND (mri.qty - COALESCE(mri.ordered_qty, 0)) > 0.0001
            """, (it["mr_name"],), as_dict=True)
            expanded_items.extend(doc_items)

    if not expanded_items:
        frappe.throw(_("所选单据中没有待采购的物料明细。"))

    mri_names = [it["mri_name"] for it in expanded_items if it.get("mri_name")]
    if not mri_names:
        frappe.throw(_("未提供有效的需求明细行。"))

    _lock_source_rows("Material Request Item", mri_names)
    db_items = frappe.db.sql("""
        SELECT
            mri.name,
            mri.parent AS mr_name,
            mri.item_code,
            mri.item_name,
            mri.description,
            COALESCE(mri.custom_spec_model, '') AS custom_spec_model,
            COALESCE(mri.custom_line_remark, '') AS custom_line_remark,
            mri.item_group,
            mri.uom,
            mri.stock_uom,
            mri.qty,
            COALESCE(mri.ordered_qty, 0) AS ordered_qty,
            (mri.qty - COALESCE(mri.ordered_qty, 0)) AS pending_qty,
            COALESCE(mri.rate, item.standard_rate, 0) AS rate,
            COALESCE(mri.warehouse, item_def.default_warehouse, '') AS warehouse,
            COALESCE(item_def.default_supplier, item_sup.supplier, '') AS default_supplier,
            mr.company,
            mr.schedule_date
        FROM `tabMaterial Request Item` mri
        INNER JOIN `tabMaterial Request` mr ON mr.name = mri.parent
        LEFT JOIN `tabItem` item ON item.name = mri.item_code
        LEFT JOIN `tabItem Default` item_def ON (item_def.parent = mri.item_code AND item_def.company = mr.company)
        LEFT JOIN `tabItem Supplier` item_sup ON item_sup.parent = mri.item_code
        WHERE mri.name IN %s
    """, (mri_names,), as_dict=True)

    db_map = {r.name: r for r in db_items}

    # Group by (company, supplier)
    supplier_groups = defaultdict(list)
    for user_row in expanded_items:
        mri_name = user_row.get("mri_name")
        db_row = db_map.get(mri_name)
        if not db_row:
            continue

        row_company = db_row.company
        assert_company_access(row_company)

        target_supplier = (supplier_override or "").strip() or db_row.default_supplier or user_row.get("supplier")
        if not target_supplier:
            target_supplier = frappe.db.get_value("Supplier", {}, "name")
            if not target_supplier:
                frappe.throw(_("物料 {0} 未设置默认供应商，且系统中暂无供应商主数据，请先创建供应商。").format(db_row.item_code))

        this_qty = flt(user_row.get("this_qty") if user_row.get("this_qty") is not None else user_row.get("qty"))
        if this_qty <= 0:
            continue
        if this_qty > flt(db_row.pending_qty) + 0.0001:
            frappe.throw(_("物料 [{0}] 本次订购数量 ({1}) 超过了申请未订数量 ({2})！").format(
                db_row.item_code, this_qty, flt(db_row.pending_qty)
            ))

        user_rate = flt(user_row.get("rate")) if user_row.get("rate") is not None else flt(db_row.rate)
        if user_rate <= 0:
            frappe.throw(_("物料 [{0}] 的单价为 0，金额不能为 0！请输入有效单价。").format(db_row.item_code))

        amount = flt(user_row.get("amount")) or flt(this_qty * user_rate, 2)
        if amount <= 0:
            frappe.throw(_("物料 [{0}] 的金额不能为 0！").format(db_row.item_code))

        tax_rate = flt(user_row.get("tax_rate") or 13.0, 2)
        tax_amount = flt(user_row.get("tax_amount") or (amount * (tax_rate / 100.0)), 2)
        total_amount = flt(user_row.get("total_amount") or (amount + tax_amount), 2)

        supplier_groups[(row_company, target_supplier)].append({
            "db_row": db_row,
            "this_qty": this_qty,
            "rate": user_rate,
            "amount": amount,
            "tax_rate": tax_rate,
            "tax_amount": tax_amount,
            "total_amount": total_amount,
            "spec": user_row.get("spec") or db_row.custom_spec_model or "",
            "description": user_row.get("remarks") or user_row.get("description") or db_row.custom_line_remark or "",
        })

    created_orders = []
    is_submitted = cint(submit_doc) != 0
    for (comp, sup), items_to_order in supplier_groups.items():
        po = frappe.new_doc("Purchase Order")
        po.company = comp
        po.supplier = sup
        po.transaction_date = get_effective_work_date()
        po.schedule_date = schedule_date or nowdate()

        for item_data in items_to_order:
            db_row = item_data["db_row"]
            this_qty = item_data["this_qty"]
            rate = item_data["rate"]
            amount = item_data["amount"]
            tax_rate = item_data["tax_rate"]
            tax_amount = item_data["tax_amount"]
            total_amount = item_data["total_amount"]
            item_spec = (item_data["spec"] or "").strip()
            item_remarks = (item_data["description"] or "").strip()

            row_dict = {
                "item_code": db_row.item_code,
                "item_name": db_row.item_name,
                "description": item_remarks or db_row.description or db_row.item_name,
                "item_group": db_row.item_group,
                "uom": db_row.uom or db_row.stock_uom,
                "stock_uom": db_row.stock_uom,
                "qty": this_qty,
                "rate": rate,
                "amount": amount,
                "schedule_date": po.schedule_date,
                "warehouse": db_row.warehouse or frappe.db.get_value("Warehouse", {"company": comp, "is_group": 0}, "name"),
                "material_request": db_row.mr_name,
                "material_request_item": db_row.name,
            }

            if _meta_has("Purchase Order Item", "custom_spec_model"):
                row_dict["custom_spec_model"] = item_spec
            if _meta_has("Purchase Order Item", "custom_line_remark"):
                row_dict["custom_line_remark"] = item_remarks
            if _meta_has("Purchase Order Item", "custom_tax_rate"):
                row_dict["custom_tax_rate"] = tax_rate
            if _meta_has("Purchase Order Item", "custom_tax_amount"):
                row_dict["custom_tax_amount"] = tax_amount
            if _meta_has("Purchase Order Item", "custom_total_amount"):
                row_dict["custom_total_amount"] = total_amount

            po.append("items", row_dict)

        po.flags.ignore_permissions = True
        po.insert()
        if is_submitted:
            po.submit()

        created_orders.append({
            "name": po.name,
            "company": po.company,
            "supplier": po.supplier,
            "docstatus": po.docstatus,
            "status": "Submitted" if po.docstatus == 1 else "Draft",
            "total_qty": sum(item_data["this_qty"] for item_data in items_to_order),
            "grand_total": flt(po.grand_total or po.total),
            "item_count": len(items_to_order),
        })

    msg = _("成功生成并正式提交 {0} 张采购订单。").format(len(created_orders)) if is_submitted else _("成功生成并保存 {0} 张采购订单草稿。").format(len(created_orders))

    return {
        "success": True,
        "created_count": len(created_orders),
        "orders": created_orders,
        "purchase_orders": created_orders,
        "is_submitted": is_submitted,
        "message": msg,
    }


@frappe.whitelist(methods=["POST"])
def update_quick_purchase_order(
    name: str,
    schedule_date: str | None = None,
    supplier: str | None = None,
    items: list[dict] | str | None = None,
) -> dict:
    """Quick edit and update Purchase Order with 12-column live calculation fields."""
    _assert_stage_access("mr_to_po", "write")
    if not frappe.db.exists("Purchase Order", name):
        frappe.throw(_("采购订单 {0} 不存在").format(name))

    po = frappe.get_doc("Purchase Order", name)
    assert_company_access(po.company)
    if po.docstatus != 0:
        frappe.throw(_("已提交采购订单仅可查看；如需更正，请按作废或重开流程处理。"))
    if not frappe.has_permission("Purchase Order", "write", po):
        frappe.throw(_("您没有编辑该采购订单的权限。"), frappe.PermissionError)

    # 检查下游是否已有已提交的入库单或发票
    has_downstream = (
        frappe.db.exists("Purchase Receipt Item", {"purchase_order": name, "docstatus": 1})
        or frappe.db.exists("Purchase Invoice Item", {"purchase_order": name, "docstatus": 1})
    )
    if has_downstream:
        frappe.throw(_("采购订单 {0} 已有关联的已提交入库单或发票，无法直接就地修改。").format(name))

    if isinstance(items, str):
        items = frappe.parse_json(items) or []

    if supplier:
        po.supplier = supplier
    if schedule_date:
        po.schedule_date = schedule_date

    default_company_wh = (
        frappe.db.get_value("Warehouse", {"company": po.company, "is_group": 0}, "name")
        or ""
    )

    if items:
        old_items_map = {it.item_code: it for it in (po.get("items") or [])}
        po.set("items", [])
        total_amount = 0.0

        for it in items:
            item_code = (it.get("item_code") or "").strip()
            if not item_code:
                continue

            item_name = (it.get("item_name") or "").strip() or item_code

            if not frappe.db.exists("Item", item_code):
                new_it = frappe.new_doc("Item")
                new_it.item_code = item_code
                new_it.item_name = item_name
                new_it.item_group = frappe.db.get_value("Item Group", {"is_group": 0}, "name") or "All Item Groups"
                new_it.stock_uom = it.get("uom") or "Nos"
                new_it.is_stock_item = 1
                new_it.flags.ignore_permissions = True
                new_it.insert()
                item_doc = new_it
            else:
                item_doc = frappe.get_cached_doc("Item", item_code)

            qty = flt(it.get("qty") or 1.0, 4)
            if qty <= 0:
                qty = 1.0

            rate = flt(it.get("rate") or getattr(item_doc, "standard_rate", 0.0) or 0.0, 2)
            amount = flt(it.get("amount") or (qty * rate), 2)
            tax_rate = flt(it.get("tax_rate") or 13.0, 2)
            tax_amount = flt(it.get("tax_amount") or (amount * (tax_rate / 100.0)), 2)
            total_price = flt(it.get("total_amount") or (amount + tax_amount), 2)
            total_amount += total_price

            old_it = old_items_map.get(item_code)

            item_spec = (it.get("spec") or it.get("custom_spec_model") or "").strip()
            item_remarks = (it.get("remarks") or it.get("custom_line_remark") or it.get("description") or "").strip()

            row_dict = {
                "item_code": item_code,
                "item_name": item_name,
                "description": item_remarks or getattr(item_doc, "description", None) or item_name,
                "qty": qty,
                "rate": rate,
                "amount": amount,
                "uom": it.get("uom") or getattr(item_doc, "stock_uom", "Nos") or "Nos",
                "stock_uom": getattr(item_doc, "stock_uom", "Nos") or "Nos",
                "warehouse": it.get("warehouse") or getattr(old_it, "warehouse", None) or default_company_wh,
                "schedule_date": po.schedule_date,
                "material_request": getattr(old_it, "material_request", None),
                "material_request_item": getattr(old_it, "material_request_item", None),
            }

            if _meta_has("Purchase Order Item", "custom_spec_model"):
                row_dict["custom_spec_model"] = item_spec
            if _meta_has("Purchase Order Item", "custom_line_remark"):
                row_dict["custom_line_remark"] = item_remarks
            if _meta_has("Purchase Order Item", "custom_tax_rate"):
                row_dict["custom_tax_rate"] = tax_rate
            if _meta_has("Purchase Order Item", "custom_tax_amount"):
                row_dict["custom_tax_amount"] = tax_amount
            if _meta_has("Purchase Order Item", "custom_total_amount"):
                row_dict["custom_total_amount"] = total_price

            po.append("items", row_dict)

    po.save()

    return {
        "success": True,
        "name": po.name,
        "company": po.company,
        "item_count": len(po.items),
        "grand_total": flt(po.grand_total or po.total),
        "message": _("成功保存采购订单草稿：{0}").format(po.name),
    }


# =========================================================================
# Step 3: Purchase Order -> Purchase Receipt (采购入库)
# =========================================================================

@frappe.whitelist()
def get_pending_purchase_order_items(
    company: str | None = None,
    filters: dict | str | None = None,
) -> dict:
    """Query Purchase Order Items for Step 3 Detail View with match_status and linked PRs."""
    _assert_stage_access("po_to_pr", "read")
    companies = _resolve_companies(company)
    if isinstance(filters, str):
        filters = frappe.parse_json(filters) or {}
    filters = dict(filters or {})

    match_status = filters.get("match_status") or "pending"
    if match_status == "all":
        return get_all_purchase_receipt_items(company, filters)

    conditions = [
        "po.docstatus = 1",
        "po.company IN %(companies)s",
        "po.status NOT IN ('Closed', 'Cancelled', 'Delivered')",
    ]
    params: dict[str, Any] = {"companies": companies}

    if match_status == "pending":
        conditions.append("(poi.qty - COALESCE(poi.received_qty, 0)) > 0.0001")
    elif match_status == "linked":
        conditions.append("COALESCE(poi.received_qty, 0) > 0.0001")

    if filters.get("supplier"):
        conditions.append("po.supplier LIKE %(supplier)s")
        params["supplier"] = f"%{filters['supplier']}%"

    if filters.get("po_name"):
        conditions.append("po.name LIKE %(po_name)s")
        params["po_name"] = f"%{filters['po_name']}%"

    if filters.get("item_code"):
        conditions.append("(poi.item_code LIKE %(item_code)s OR poi.item_name LIKE %(item_code)s)")
        params["item_code"] = f"%{filters['item_code']}%"

    if filters.get("warehouse"):
        conditions.append("poi.warehouse LIKE %(warehouse)s")
        params["warehouse"] = f"%{filters['warehouse']}%"

    if filters.get("linked_doc"):
        conditions.append("EXISTS (SELECT 1 FROM `tabPurchase Receipt Item` pri_flt WHERE pri_flt.purchase_order_item = poi.name AND pri_flt.parent LIKE %(linked_doc)s)")
        params["linked_doc"] = f"%{filters['linked_doc']}%"

    where_clause = " AND ".join(conditions)

    sql = f"""
        SELECT
            poi.name AS poi_name,
            po.name AS po_name,
            po.company,
            po.supplier,
            po.transaction_date AS po_date,
            poi.schedule_date,
            poi.item_code,
            poi.item_name,
            poi.description,
            COALESCE(poi.custom_spec_model, '') AS custom_spec_model,
            COALESCE(poi.custom_line_remark, '') AS custom_line_remark,
            poi.item_group,
            COALESCE(poi.uom, poi.stock_uom, '') AS uom,
            poi.stock_uom,
            COALESCE(poi.qty, 0) AS qty,
            COALESCE(poi.received_qty, 0) AS received_qty,
            GREATEST(COALESCE(poi.qty, 0) - COALESCE(poi.received_qty, 0), 0) AS pending_qty,
            COALESCE(poi.rate, 0) AS rate,
            (GREATEST(COALESCE(poi.qty, 0) - COALESCE(poi.received_qty, 0), 0) * COALESCE(poi.rate, 0)) AS pending_amount,
            COALESCE(poi.warehouse, '') AS warehouse,
            (
                SELECT GROUP_CONCAT(DISTINCT pri.parent ORDER BY pri.parent DESC SEPARATOR '、')
                FROM `tabPurchase Receipt Item` pri
                INNER JOIN `tabPurchase Receipt` pr_inner ON pr_inner.name = pri.parent
                WHERE pri.purchase_order_item = poi.name AND pr_inner.docstatus < 2
            ) AS linked_pr_names
        FROM `tabPurchase Order Item` poi
        INNER JOIN `tabPurchase Order` po ON po.name = poi.parent
        WHERE {where_clause}
        ORDER BY po.transaction_date DESC, po.name DESC, poi.idx ASC
        LIMIT 1000
    """

    raw_items = frappe.db.sql(sql, params, as_dict=True)
    raw_items = filter_rows_by_doctype_permission(raw_items, "Purchase Order", "po_name")

    rows = []
    for r in raw_items:
        spec, remarks = extract_spec_and_remarks(r)
        rows.append({
            "poi_name": r.poi_name,
            "po_name": r.po_name,
            "company": r.company,
            "supplier": r.supplier,
            "po_date": str(r.po_date or ""),
            "schedule_date": str(r.schedule_date or ""),
            "item_code": r.item_code,
            "item_name": r.item_name or r.item_code,
            "spec": spec,
            "remarks": remarks,
            "description": remarks,
            "item_group": r.item_group or "",
            "uom": r.uom or "",
            "qty": flt(r.qty, 2),
            "received_qty": flt(r.received_qty, 2),
            "pending_qty": flt(r.pending_qty, 2),
            "this_qty": flt(r.pending_qty, 2),
            "rate": flt(r.rate, 2),
            "pending_amount": flt(r.pending_amount, 2),
            "warehouse": r.warehouse or "",
            "linked_pr_names": r.linked_pr_names or "",
        })

    return {
        "companies": companies,
        "count": len(rows),
        "rows": rows,
    }


@frappe.whitelist()
def get_pending_purchase_order_docs(
    company: str | None = None,
    filters: dict | str | None = None,
) -> dict:
    """Query Purchase Order Documents for Step 3 Doc View with match_status and linked PRs."""
    _assert_stage_access("po_to_pr", "read")
    companies = _resolve_companies(company)
    if isinstance(filters, str):
        filters = frappe.parse_json(filters) or {}
    filters = dict(filters or {})

    match_status = filters.get("match_status") or "pending"
    if match_status == "all":
        return get_all_purchase_receipt_docs(company, filters)

    has_custom_doc_details = _meta_has("Purchase Order", "custom_doc_details")
    doc_details_col = "COALESCE(po.custom_doc_details, '')" if has_custom_doc_details else "''"

    conditions = [
        "po.docstatus = 1",
        "po.company IN %(companies)s",
        "po.status NOT IN ('Closed', 'Cancelled', 'Delivered')",
    ]
    params: dict[str, Any] = {"companies": companies}

    if match_status == "pending":
        conditions.append("EXISTS (SELECT 1 FROM `tabPurchase Order Item` poi_chk WHERE poi_chk.parent = po.name AND (poi_chk.qty - COALESCE(poi_chk.received_qty, 0)) > 0.0001)")
    elif match_status == "linked":
        conditions.append("EXISTS (SELECT 1 FROM `tabPurchase Receipt Item` pri_chk INNER JOIN `tabPurchase Receipt` pr_chk ON pr_chk.name = pri_chk.parent WHERE pri_chk.purchase_order = po.name AND pr_chk.docstatus < 2)")

    if filters.get("supplier"):
        conditions.append("po.supplier LIKE %(supplier)s")
        params["supplier"] = f"%{filters['supplier']}%"

    if filters.get("po_name"):
        conditions.append("po.name LIKE %(po_name)s")
        params["po_name"] = f"%{filters['po_name']}%"

    if filters.get("linked_doc"):
        conditions.append("EXISTS (SELECT 1 FROM `tabPurchase Receipt Item` pri_flt WHERE pri_flt.purchase_order = po.name AND pri_flt.parent LIKE %(linked_doc)s)")
        params["linked_doc"] = f"%{filters['linked_doc']}%"

    where_clause = " AND ".join(conditions)

    sql = f"""
        SELECT
            po.name AS po_name,
            po.company,
            po.supplier,
            po.transaction_date AS po_date,
            po.schedule_date,
            {doc_details_col} AS custom_doc_details,
            po.status,
            po.currency,
            po.grand_total,
            COUNT(DISTINCT poi.name) AS pending_item_count,
            COALESCE(SUM(GREATEST(poi.qty - COALESCE(poi.received_qty, 0), 0)), 0) AS pending_qty,
            COALESCE(SUM(GREATEST(poi.qty - COALESCE(poi.received_qty, 0), 0) * poi.rate), 0) AS pending_amount,
            GROUP_CONCAT(DISTINCT COALESCE(poi.warehouse, '') SEPARATOR '、') AS warehouses,
            GROUP_CONCAT(DISTINCT CONCAT(poi.item_name, ' (', ROUND(GREATEST(poi.qty - COALESCE(poi.received_qty, 0), 0), 2), ' ', COALESCE(poi.uom, poi.stock_uom, ''), ')') SEPARATOR '、') AS synthesized_details,
            (
                SELECT GROUP_CONCAT(DISTINCT pri.parent ORDER BY pri.parent DESC SEPARATOR '、')
                FROM `tabPurchase Receipt Item` pri
                INNER JOIN `tabPurchase Receipt` pr_inner ON pr_inner.name = pri.parent
                WHERE pri.purchase_order = po.name AND pr_inner.docstatus < 2
            ) AS linked_pr_names
        FROM `tabPurchase Order` po
        INNER JOIN `tabPurchase Order Item` poi ON poi.parent = po.name
        WHERE {where_clause}
        GROUP BY po.name
        ORDER BY po.transaction_date DESC, po.name DESC
        LIMIT 500
    """

    docs = frappe.db.sql(sql, params, as_dict=True)
    docs = filter_rows_by_doctype_permission(docs, "Purchase Order", "po_name")
    for d in docs:
        if not d.get("custom_doc_details"):
            d["custom_doc_details"] = d.get("synthesized_details") or ""
        d["pending_qty"] = flt(d.get("pending_qty"), 2)
        d["pending_amount"] = flt(d.get("pending_amount"), 2)
        d["grand_total"] = flt(d.get("grand_total"), 2)
        d["warehouse"] = (d.get("warehouses") or "").strip("、")
        d["linked_pr_names"] = d.get("linked_pr_names") or ""

    return {
        "companies": companies,
        "count": len(docs),
        "rows": docs,
    }


@frappe.whitelist(methods=["POST"])
def make_purchase_receipts_from_po_items(
    company: str | None,
    selected_items: list[dict] | str,
    warehouse_override: str | None = None,
    posting_date: str | None = None,
) -> dict:
    """Generate Draft Purchase Receipt(s) grouped by Supplier from PO items or PO docs."""
    _assert_stage_access("po_to_pr", "create")
    if isinstance(selected_items, str):
        selected_items = frappe.parse_json(selected_items) or []

    if not selected_items:
        frappe.throw(_("请至少选择一项订单明细或单据。"))

    expanded_items = []
    for it in selected_items:
        if it.get("poi_name"):
            expanded_items.append(it)
        elif it.get("po_name"):
            doc_items = frappe.db.sql("""
                SELECT poi.name AS poi_name, (poi.qty - COALESCE(poi.received_qty, 0)) AS this_qty, poi.warehouse, poi.parent AS po_name
                FROM `tabPurchase Order Item` poi
                WHERE poi.parent = %s AND (poi.qty - COALESCE(poi.received_qty, 0)) > 0.0001
            """, (it["po_name"],), as_dict=True)
            expanded_items.extend(doc_items)

    if not expanded_items:
        frappe.throw(_("所选订单中没有待收货的明细行。"))

    poi_names = [it["poi_name"] for it in expanded_items if it.get("poi_name")]
    if not poi_names:
        frappe.throw(_("未提供有效的订单明细行。"))

    _lock_source_rows("Purchase Order Item", poi_names)
    db_items = frappe.db.sql("""
        SELECT
            poi.name,
            poi.parent AS po_name,
            poi.item_code,
            poi.item_name,
            poi.description,
            COALESCE(poi.custom_spec_model, '') AS custom_spec_model,
            COALESCE(poi.custom_line_remark, '') AS custom_line_remark,
            poi.item_group,
            poi.uom,
            poi.stock_uom,
            poi.qty,
            COALESCE(poi.received_qty, 0) AS received_qty,
            (poi.qty - COALESCE(poi.received_qty, 0)) AS pending_qty,
            COALESCE(poi.rate, 0) AS rate,
            COALESCE(poi.warehouse, '') AS warehouse,
            po.company,
            po.supplier
        FROM `tabPurchase Order Item` poi
        INNER JOIN `tabPurchase Order` po ON po.name = poi.parent
        WHERE poi.name IN %s
    """, (poi_names,), as_dict=True)

    db_map = {r.name: r for r in db_items}

    # Group by (company, supplier)
    supplier_groups = defaultdict(list)
    for user_row in expanded_items:
        poi_name = user_row.get("poi_name")
        db_row = db_map.get(poi_name)
        if not db_row:
            continue

        row_company = db_row.company
        assert_company_access(row_company)

        this_qty = flt(user_row.get("this_qty"))
        if this_qty <= 0:
            continue
        if this_qty > flt(db_row.pending_qty) + 0.0001:
            frappe.throw(_("物料 [{0}] 本次实收数量 ({1}) 超过了订单未收数量 ({2})！").format(
                db_row.item_code, this_qty, flt(db_row.pending_qty)
            ))

        if flt(db_row.rate) <= 0:
            frappe.throw(_("物料 [{0}] 的采购单价为 0，金额不能为 0！请先核对采购订单单价后再办理入库。").format(
                db_row.item_code
            ))

        target_wh = (warehouse_override or "").strip() or user_row.get("warehouse") or db_row.warehouse
        if target_wh and not frappe.db.exists("Warehouse", target_wh):
            matched_wh = frappe.db.get_value("Warehouse", {"company": row_company, "is_group": 0, "warehouse_name": ["like", f"%{target_wh}%"]}, "name")
            if not matched_wh:
                matched_wh = frappe.db.get_value("Warehouse", {"company": row_company, "is_group": 0, "name": ["like", f"%{target_wh}%"]}, "name")
            target_wh = matched_wh
        if not target_wh or not frappe.db.exists("Warehouse", target_wh):
            target_wh = frappe.db.get_value("Warehouse", {"company": row_company, "is_group": 0}, "name")

        supplier_groups[(row_company, db_row.supplier)].append({
            "db_row": db_row,
            "this_qty": this_qty,
            "warehouse": target_wh,
        })

    created_receipts = []
    for (comp, sup), items_to_receive in supplier_groups.items():
        pr = frappe.new_doc("Purchase Receipt")
        pr.company = comp
        pr.supplier = sup
        pr.posting_date = get_effective_work_date(posting_date)

        for item_data in items_to_receive:
            db_row = item_data["db_row"]
            this_qty = item_data["this_qty"]
            wh = item_data["warehouse"]

            pr_item_dict = {
                "item_code": db_row.item_code,
                "item_name": db_row.item_name,
                "description": db_row.custom_line_remark or db_row.description or db_row.item_name,
                "item_group": db_row.item_group,
                "uom": db_row.uom or db_row.stock_uom,
                "stock_uom": db_row.stock_uom,
                "qty": this_qty,
                "rate": db_row.rate,
                "amount": flt(this_qty * db_row.rate, 2),
                "warehouse": wh,
                "purchase_order": db_row.po_name,
                "purchase_order_item": db_row.name,
            }
            if _meta_has("Purchase Receipt Item", "custom_spec_model"):
                pr_item_dict["custom_spec_model"] = db_row.custom_spec_model
            if _meta_has("Purchase Receipt Item", "custom_line_remark"):
                pr_item_dict["custom_line_remark"] = db_row.custom_line_remark

            pr.append("items", pr_item_dict)

        pr.flags.ignore_permissions = False
        pr.insert()
        pr.submit()

        created_receipts.append({
            "name": pr.name,
            "company": pr.company,
            "supplier": pr.supplier,
            "total_qty": sum(item_data["this_qty"] for item_data in items_to_receive),
            "grand_total": flt(pr.grand_total or pr.total),
            "item_count": len(items_to_receive),
        })

    return {
        "success": True,
        "created_count": len(created_receipts),
        "receipts": created_receipts,
        "message": _("成功生成 {0} 张采购入库单草稿。").format(len(created_receipts)),
    }


# =========================================================================
# Step 4: Purchase Receipt -> Purchase Invoice (采购开票)
# =========================================================================

@frappe.whitelist()
def get_pending_purchase_receipt_items(
    company: str | None = None,
    filters: dict | str | None = None,
) -> dict:
    """Query Purchase Receipt Items for Step 4 Detail View with match_status and linked PIs."""
    _assert_stage_access("pr_to_pi", "read")
    companies = _resolve_companies(company)
    if isinstance(filters, str):
        filters = frappe.parse_json(filters) or {}
    filters = dict(filters or {})

    match_status = filters.get("match_status") or "pending"
    if match_status == "all":
        return get_all_purchase_invoice_items(company, filters)

    conditions = [
        "pr.docstatus = 1",
        "pr.company IN %(companies)s",
        "pr.status NOT IN ('Closed', 'Cancelled', 'Return Issued')",
    ]
    params: dict[str, Any] = {"companies": companies}

    if match_status == "pending":
        conditions.append("(pri.amount - COALESCE(pri.billed_amt, 0)) > 0.01")
    elif match_status == "linked":
        conditions.append("COALESCE(pri.billed_amt, 0) > 0.01")

    if filters.get("supplier"):
        conditions.append("pr.supplier LIKE %(supplier)s")
        params["supplier"] = f"%{filters['supplier']}%"

    if filters.get("pr_name"):
        conditions.append("pr.name LIKE %(pr_name)s")
        params["pr_name"] = f"%{filters['pr_name']}%"

    if filters.get("item_code"):
        conditions.append("(pri.item_code LIKE %(item_code)s OR pri.item_name LIKE %(item_code)s)")
        params["item_code"] = f"%{filters['item_code']}%"

    if filters.get("linked_doc"):
        conditions.append("EXISTS (SELECT 1 FROM `tabPurchase Invoice Item` pii_flt WHERE pii_flt.pr_detail = pri.name AND pii_flt.parent LIKE %(linked_doc)s)")
        params["linked_doc"] = f"%{filters['linked_doc']}%"

    where_clause = " AND ".join(conditions)

    sql = f"""
        SELECT
            pri.name AS pri_name,
            pr.name AS pr_name,
            pr.company,
            pr.supplier,
            pr.posting_date AS pr_date,
            pri.item_code,
            pri.item_name,
            pri.description,
            COALESCE(pri.custom_spec_model, '') AS custom_spec_model,
            COALESCE(pri.custom_line_remark, '') AS custom_line_remark,
            pri.item_group,
            COALESCE(pri.uom, pri.stock_uom, '') AS uom,
            pri.stock_uom,
            COALESCE(pri.qty, 0) AS qty,
            COALESCE(pri.amount, 0) AS amount,
            COALESCE(pri.billed_amt, 0) AS billed_amt,
            GREATEST(COALESCE(pri.amount, 0) - COALESCE(pri.billed_amt, 0), 0) AS pending_amount,
            COALESCE(pri.rate, 0) AS rate,
            COALESCE(pri.warehouse, '') AS warehouse,
            COALESCE(pri.purchase_order, '') AS purchase_order,
            COALESCE(pri.purchase_order_item, '') AS purchase_order_item,
            (
                SELECT GROUP_CONCAT(DISTINCT pii.parent ORDER BY pii.parent DESC SEPARATOR '、')
                FROM `tabPurchase Invoice Item` pii
                INNER JOIN `tabPurchase Invoice` pi_inner ON pi_inner.name = pii.parent
                WHERE pii.pr_detail = pri.name AND pi_inner.docstatus < 2
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
    for r in raw_items:
        unit_rate = flt(r.rate) or 1.0
        pending_qty = flt(r.pending_amount) / unit_rate if unit_rate else flt(r.qty)
        billed_qty = max(0.0, flt(r.qty) - pending_qty)
        spec, remarks = extract_spec_and_remarks(r)

        rows.append({
            "pri_name": r.pri_name,
            "pr_name": r.pr_name,
            "company": r.company,
            "supplier": r.supplier,
            "pr_date": str(r.pr_date or ""),
            "item_code": r.item_code,
            "item_name": r.item_name or r.item_code,
            "spec": spec,
            "remarks": remarks,
            "description": remarks,
            "item_group": r.item_group or "",
            "uom": r.uom or "",
            "qty": flt(r.qty, 2),
            "billed_qty": flt(billed_qty, 2),
            "pending_qty": flt(pending_qty, 2),
            "this_qty": flt(pending_qty, 2),
            "rate": flt(r.rate, 2),
            "pending_amount": flt(r.pending_amount, 2),
            "purchase_order": r.purchase_order or "",
            "linked_pi_names": r.linked_pi_names or "",
        })

    return {
        "companies": companies,
        "count": len(rows),
        "rows": rows,
    }


@frappe.whitelist()
def get_pending_purchase_receipt_docs(
    company: str | None = None,
    filters: dict | str | None = None,
) -> dict:
    """Query Purchase Receipt Documents for Step 4 Doc View with match_status and linked PIs."""
    _assert_stage_access("pr_to_pi", "read")
    companies = _resolve_companies(company)
    if isinstance(filters, str):
        filters = frappe.parse_json(filters) or {}
    filters = dict(filters or {})

    match_status = filters.get("match_status") or "pending"
    if match_status == "all":
        return get_all_purchase_invoice_docs(company, filters)

    has_custom_doc_details = _meta_has("Purchase Receipt", "custom_doc_details")
    doc_details_col = "COALESCE(pr.custom_doc_details, '')" if has_custom_doc_details else "''"

    conditions = [
        "pr.docstatus = 1",
        "pr.company IN %(companies)s",
        "pr.status NOT IN ('Closed', 'Cancelled', 'Return Issued')",
    ]
    params: dict[str, Any] = {"companies": companies}

    if match_status == "pending":
        conditions.append("EXISTS (SELECT 1 FROM `tabPurchase Receipt Item` pri_chk WHERE pri_chk.parent = pr.name AND (pri_chk.amount - COALESCE(pri_chk.billed_amt, 0)) > 0.01)")
    elif match_status == "linked":
        conditions.append("EXISTS (SELECT 1 FROM `tabPurchase Invoice Item` pii_chk INNER JOIN `tabPurchase Invoice` pi_chk ON pi_chk.name = pii_chk.parent WHERE pii_chk.purchase_receipt = pr.name AND pi_chk.docstatus < 2)")

    if filters.get("supplier"):
        conditions.append("pr.supplier LIKE %(supplier)s")
        params["supplier"] = f"%{filters['supplier']}%"

    if filters.get("pr_name"):
        conditions.append("pr.name LIKE %(pr_name)s")
        params["pr_name"] = f"%{filters['pr_name']}%"

    if filters.get("linked_doc"):
        conditions.append("EXISTS (SELECT 1 FROM `tabPurchase Invoice Item` pii_flt WHERE pii_flt.purchase_receipt = pr.name AND pii_flt.parent LIKE %(linked_doc)s)")
        params["linked_doc"] = f"%{filters['linked_doc']}%"

    where_clause = " AND ".join(conditions)

    sql = f"""
        SELECT
            pr.name AS pr_name,
            pr.company,
            pr.supplier,
            pr.posting_date AS pr_date,
            {doc_details_col} AS custom_doc_details,
            pr.status,
            pr.currency,
            pr.grand_total,
            COUNT(DISTINCT pri.name) AS unbilled_item_count,
            COALESCE(SUM(pri.qty * (1.0 - COALESCE(pri.billed_amt, 0) / NULLIF(pri.amount, 0))), 0) AS pending_qty,
            COALESCE(SUM(GREATEST(pri.amount - COALESCE(pri.billed_amt, 0), 0)), 0) AS pending_amount,
            GROUP_CONCAT(DISTINCT COALESCE(pri.purchase_order, '') SEPARATOR '、') AS purchase_orders,
            GROUP_CONCAT(DISTINCT CONCAT(pri.item_name, ' (', ROUND(pri.qty, 2), ' ', COALESCE(pri.uom, pri.stock_uom, ''), ')') SEPARATOR '、') AS synthesized_details,
            (
                SELECT GROUP_CONCAT(DISTINCT pii.parent ORDER BY pii.parent DESC SEPARATOR '、')
                FROM `tabPurchase Invoice Item` pii
                INNER JOIN `tabPurchase Invoice` pi_inner ON pi_inner.name = pii.parent
                WHERE pii.purchase_receipt = pr.name AND pi_inner.docstatus < 2
            ) AS linked_pi_names
        FROM `tabPurchase Receipt` pr
        INNER JOIN `tabPurchase Receipt Item` pri ON pri.parent = pr.name
        WHERE {where_clause}
        GROUP BY pr.name
        ORDER BY pr.posting_date DESC, pr.name DESC
        LIMIT 500
    """

    docs = frappe.db.sql(sql, params, as_dict=True)
    docs = filter_rows_by_doctype_permission(docs, "Purchase Receipt", "pr_name")
    for d in docs:
        if not d.get("custom_doc_details"):
            d["custom_doc_details"] = d.get("synthesized_details") or ""
        d["pending_qty"] = flt(d.get("pending_qty"), 2)
        d["pending_amount"] = flt(d.get("pending_amount"), 2)
        d["grand_total"] = flt(d.get("grand_total"), 2)
        d["purchase_order"] = (d.get("purchase_orders") or "").strip("、")
        d["linked_pi_names"] = d.get("linked_pi_names") or ""

    return {
        "companies": companies,
        "count": len(docs),
        "rows": docs,
    }


@frappe.whitelist(methods=["POST"])
def make_purchase_invoices_from_pr_items(
    company: str | None,
    selected_items: list[dict] | str,
    bill_no: str | None = None,
    bill_date: str | None = None,
    invoice_type: str | None = "专用发票",
) -> dict:
    """Generate Draft Purchase Invoice(s) grouped by Supplier from PR items or PR docs."""
    _assert_stage_access("pr_to_pi", "create")
    if isinstance(selected_items, str):
        selected_items = frappe.parse_json(selected_items) or []

    if not selected_items:
        frappe.throw(_("请至少选择一项入库明细或单据。"))

    expanded_items = []
    for it in selected_items:
        if it.get("pri_name"):
            expanded_items.append(it)
        elif it.get("pr_name"):
            doc_items = frappe.db.sql("""
                SELECT pri.name AS pri_name, (pri.qty - COALESCE(pri.billed_amt, 0) / NULLIF(pri.rate, 0)) AS this_qty, pri.parent AS pr_name
                FROM `tabPurchase Receipt Item` pri
                WHERE pri.parent = %s AND (pri.amount - COALESCE(pri.billed_amt, 0)) > 0.01
            """, (it["pr_name"],), as_dict=True)
            expanded_items.extend(doc_items)

    if not expanded_items:
        frappe.throw(_("所选入库单中没有待开票的明细行。"))

    pri_names = [it["pri_name"] for it in expanded_items if it.get("pri_name")]
    if not pri_names:
        frappe.throw(_("未提供有效的入库明细行。"))

    _lock_source_rows("Purchase Receipt Item", pri_names)
    db_items = frappe.db.sql("""
        SELECT
            pri.name,
            pri.parent AS pr_name,
            pri.item_code,
            pri.item_name,
            pri.description,
            COALESCE(pri.custom_spec_model, '') AS custom_spec_model,
            COALESCE(pri.custom_line_remark, '') AS custom_line_remark,
            pri.item_group,
            pri.uom,
            pri.stock_uom,
            pri.qty,
            pri.amount,
            COALESCE(pri.billed_amt, 0) AS billed_amt,
            (pri.amount - COALESCE(pri.billed_amt, 0)) AS pending_amount,
            COALESCE(pri.rate, 0) AS rate,
            COALESCE(pri.warehouse, '') AS warehouse,
            COALESCE(pri.purchase_order, '') AS purchase_order,
            COALESCE(pri.purchase_order_item, '') AS purchase_order_item,
            pr.company,
            pr.supplier
        FROM `tabPurchase Receipt Item` pri
        INNER JOIN `tabPurchase Receipt` pr ON pr.name = pri.parent
        WHERE pri.name IN %s
    """, (pri_names,), as_dict=True)

    db_map = {r.name: r for r in db_items}

    # Group by (company, supplier)
    supplier_groups = defaultdict(list)
    for user_row in expanded_items:
        pri_name = user_row.get("pri_name")
        db_row = db_map.get(pri_name)
        if not db_row:
            continue

        row_company = db_row.company
        assert_company_access(row_company)

        this_qty = flt(user_row.get("this_qty") or user_row.get("qty"))
        if this_qty <= 0:
            continue

        unit_rate = flt(db_row.rate) or 1.0
        pending_qty = flt(db_row.pending_amount) / unit_rate if unit_rate else flt(db_row.qty)

        if this_qty > flt(pending_qty) + 0.0001:
            frappe.throw(_("物料 [{0}] 本次开票数量 ({1}) 超过了入库待开票数量 ({2})！").format(
                db_row.item_code, this_qty, flt(pending_qty, 2)
            ))

        user_rate = flt(user_row.get("rate")) if user_row.get("rate") is not None else flt(db_row.rate)
        if user_rate <= 0:
            frappe.throw(_("物料 [{0}] 的单价为 0，金额不能为 0！请输入有效单价。").format(db_row.item_code))

        amount = flt(user_row.get("amount")) or flt(this_qty * user_rate, 2)
        if amount <= 0:
            frappe.throw(_("物料 [{0}] 的开票金额不能为 0！").format(db_row.item_code))

        if amount > flt(db_row.pending_amount) + 0.01:
            frappe.throw(_("物料 [{0}] 本次开票金额 (¥ {1}) 超过了入库待开票金额上限 (¥ {2})！").format(
                db_row.item_code, amount, flt(db_row.pending_amount, 2)
            ))

        # 比例防透支约束：如果本次数量尚未全部开完，禁止一次性透支全部金额
        if this_qty < flt(pending_qty) - 0.0001:
            max_allowed_amt = flt(user_rate * this_qty * 1.0005 + 0.05, 2)
            if amount > max_allowed_amt:
                frappe.throw(_("物料 [{0}] 在开票数量 ({1}) 尚未全部开完剩余数量 ({2}) 的情况下，不允许提前透支全部待开金额！本次最大允许开票金额为 ¥ {3}").format(
                    db_row.item_code, this_qty, flt(pending_qty, 2), max_allowed_amt
                ))

        tax_rate = flt(user_row.get("tax_rate") or 13.0, 2)
        tax_amount = flt(user_row.get("tax_amount") or (amount * (tax_rate / 100.0)), 2)
        total_amount = flt(user_row.get("total_amount") or (amount + tax_amount), 2)

        supplier_groups[(row_company, db_row.supplier)].append({
            "db_row": db_row,
            "this_qty": this_qty,
            "rate": user_rate,
            "amount": amount,
            "tax_rate": tax_rate,
            "tax_amount": tax_amount,
            "total_amount": total_amount,
            "spec": user_row.get("spec") or db_row.custom_spec_model or "",
            "remarks": user_row.get("remarks") or user_row.get("description") or db_row.custom_line_remark or "",
            "warehouse": user_row.get("warehouse") or db_row.warehouse,
        })

    created_invoices = []
    for (comp, sup), items_to_invoice in supplier_groups.items():
        pi = frappe.new_doc("Purchase Invoice")
        pi.company = comp
        pi.supplier = sup
        pi.posting_date = get_effective_work_date()
        if bill_no:
            pi.bill_no = bill_no
        if bill_date:
            pi.bill_date = bill_date

        if _meta_has("Purchase Invoice", "custom_invoice_type"):
            pi.custom_invoice_type = invoice_type or "专用发票"

        for item_data in items_to_invoice:
            db_row = item_data["db_row"]
            this_qty = item_data["this_qty"]
            user_rate = item_data["rate"]
            user_amount = item_data["amount"]
            user_spec = (item_data["spec"] or "").strip()
            user_remarks = (item_data["remarks"] or "").strip()

            row_dict = {
                "item_code": db_row.item_code,
                "item_name": db_row.item_name,
                "description": user_remarks or db_row.custom_line_remark or db_row.description or db_row.item_name,
                "item_group": db_row.item_group,
                "uom": db_row.uom or db_row.stock_uom,
                "stock_uom": db_row.stock_uom,
                "qty": this_qty,
                "rate": user_rate,
                "amount": user_amount,
                "warehouse": db_row.warehouse,
                "purchase_receipt": db_row.pr_name,
                "pr_detail": db_row.name,
                "purchase_order": db_row.purchase_order,
                "po_detail": db_row.purchase_order_item,
            }

            if _meta_has("Purchase Invoice Item", "custom_spec_model"):
                row_dict["custom_spec_model"] = user_spec
            if _meta_has("Purchase Invoice Item", "custom_line_remark"):
                row_dict["custom_line_remark"] = user_remarks
            if _meta_has("Purchase Invoice Item", "custom_tax_rate"):
                row_dict["custom_tax_rate"] = item_data["tax_rate"]
            if _meta_has("Purchase Invoice Item", "custom_tax_amount"):
                row_dict["custom_tax_amount"] = item_data["tax_amount"]
            if _meta_has("Purchase Invoice Item", "custom_total_amount"):
                row_dict["custom_total_amount"] = item_data["total_amount"]

            pi.append("items", row_dict)

        pi.flags.ignore_permissions = True
        pi.insert()
        pi.submit()

        created_invoices.append({
            "name": pi.name,
            "company": pi.company,
            "supplier": pi.supplier,
            "total_qty": sum(item_data["this_qty"] for item_data in items_to_invoice),
            "grand_total": flt(pi.grand_total or pi.total),
            "item_count": len(items_to_invoice),
        })

    return {
        "success": True,
        "created_count": len(created_invoices),
        "invoices": created_invoices,
        "message": _("成功生成 {0} 张采购发票草稿。").format(len(created_invoices)),
    }


# =========================================================================
# Step 5: Purchase Invoice -> Reimbursement Request (报销付款)
# =========================================================================

@frappe.whitelist()
def get_pending_reimbursement_invoice_items(
    company: str | None = None,
    filters: dict | str | None = None,
) -> dict:
    """Query Purchase Invoice Line Items for Step 5 Detail View with match_status and linked RRs."""
    _assert_stage_access("pi_to_rr", "read")
    companies = _resolve_companies(company)
    if isinstance(filters, str):
        filters = frappe.parse_json(filters) or {}
    filters = dict(filters or {})

    match_status = filters.get("match_status") or "pending"
    if match_status == "all":
        return get_all_reimbursement_request_items(company, filters)

    conditions = [
        "pi.docstatus = 1",
        "pi.company IN %(companies)s",
    ]
    params: dict[str, Any] = {"companies": companies}

    if match_status == "pending":
        conditions.append("pi.outstanding_amount > 0")

    if filters.get("supplier"):
        conditions.append("pi.supplier LIKE %(supplier)s")
        params["supplier"] = f"%{filters['supplier']}%"

    if filters.get("bill_no"):
        conditions.append("pi.bill_no LIKE %(bill_no)s")
        params["bill_no"] = f"%{filters['bill_no']}%"

    if filters.get("owner"):
        conditions.append("pi.owner LIKE %(owner)s")
        params["owner"] = f"%{filters['owner']}%"

    if filters.get("linked_doc"):
        conditions.append("EXISTS (SELECT 1 FROM `tabReimbursement Invoice Item` rii_flt WHERE rii_flt.source_pi = pi.name AND rii_flt.parent LIKE %(linked_doc)s)")
        params["linked_doc"] = f"%{filters['linked_doc']}%"

    where_clause = " AND ".join(conditions)

    sql = f"""
        SELECT
            pii.name AS pii_name,
            pi.name AS pi_name,
            pi.company,
            pi.supplier,
            COALESCE(pi.bill_no, '') AS bill_no,
            pi.bill_date,
            pi.posting_date,
            pi.owner,
            pi.outstanding_amount,
            pii.item_code,
            pii.item_name,
            pii.description,
            COALESCE(pii.custom_spec_model, '') AS custom_spec_model,
            COALESCE(pii.custom_line_remark, '') AS custom_line_remark,
            COALESCE(pii.uom, pii.stock_uom, '') AS uom,
            COALESCE(pii.qty, 1) AS qty,
            COALESCE(pii.rate, 0) AS rate,
            COALESCE(pii.amount, 0) AS amount,
            COALESCE(pii.net_amount, pii.amount, 0) AS net_amount,
            (
                SELECT GROUP_CONCAT(DISTINCT rii.parent ORDER BY rii.parent DESC SEPARATOR '、')
                FROM `tabReimbursement Invoice Item` rii
                INNER JOIN `tabReimbursement Request` rr_inner ON rr_inner.name = rii.parent
                WHERE rii.source_pi = pi.name AND rr_inner.docstatus < 2
            ) AS linked_rr_names
        FROM `tabPurchase Invoice Item` pii
        INNER JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent
        WHERE {where_clause}
        ORDER BY pi.posting_date DESC, pi.name DESC, pii.idx ASC
        LIMIT 1000
    """

    raw_items = frappe.db.sql(sql, params, as_dict=True)
    raw_items = filter_rows_by_doctype_permission(raw_items, "Purchase Invoice", "pi_name")

    active_res = []
    if frappe.db.exists("DocType", "Reimbursement Source Reservation"):
        active_res = frappe.get_all(
            "Reimbursement Source Reservation",
            filters={"status": ["in", ["Draft", "Submitted"]]},
            fields=["source_purchase_invoice", "source_purchase_invoice_item", "reserved_amount"],
        )
    reserved_by_pi = defaultdict(float)
    for res in active_res:
        reserved_by_pi[res.source_purchase_invoice] += flt(res.reserved_amount)

    rows = []
    for it in raw_items:
        reserved = reserved_by_pi.get(it.pi_name, 0.0)
        net_outstanding = max(0.0, flt(it.outstanding_amount) - reserved)
        has_link = bool(it.linked_rr_names)

        if match_status == "pending" and net_outstanding <= 0.0001:
            continue
        if match_status == "linked" and not has_link and net_outstanding > 0.0001:
            continue

        spec, remarks = extract_spec_and_remarks(it)

        rows.append({
            "pii_name": it.pii_name,
            "pi_name": it.pi_name,
            "company": it.company,
            "supplier": it.supplier,
            "bill_no": it.bill_no,
            "bill_date": str(it.bill_date) if it.bill_date else "",
            "posting_date": str(it.posting_date) if it.posting_date else "",
            "item_code": it.item_code,
            "item_name": it.item_name or it.item_code,
            "spec": spec,
            "remarks": remarks,
            "description": remarks,
            "uom": it.uom,
            "qty": flt(it.qty, 2),
            "rate": flt(it.rate, 2),
            "amount": flt(it.amount, 2),
            "net_available_amount": flt(net_outstanding, 2),
            "owner": it.owner or "",
            "linked_rr_names": it.linked_rr_names or "",
        })

    return {
        "companies": companies,
        "count": len(rows),
        "rows": rows,
    }


@frappe.whitelist()
def get_pending_reimbursement_invoices(
    company: str | None = None,
    filters: dict | str | None = None,
) -> dict:
    """Query Purchase Invoices for Step 5 Doc View with match_status and linked RRs."""
    _assert_stage_access("pi_to_rr", "read")
    companies = _resolve_companies(company)
    if isinstance(filters, str):
        filters = frappe.parse_json(filters) or {}
    filters = dict(filters or {})

    match_status = filters.get("match_status") or "pending"
    if match_status == "all":
        return get_all_reimbursement_request_docs(company, filters)

    has_custom_doc_details = _meta_has("Purchase Invoice", "custom_doc_details")
    doc_details_col = "COALESCE(pi.custom_doc_details, '')" if has_custom_doc_details else "''"
    has_invoice_type = _meta_has("Purchase Invoice", "custom_invoice_type")
    type_col = "COALESCE(pi.custom_invoice_type, '普通发票')" if has_invoice_type else "'普通发票'"

    conditions = [
        "pi.company IN %(companies)s",
        "pi.docstatus = 1",
    ]
    params: dict[str, Any] = {"companies": companies}

    if match_status == "pending":
        conditions.append("pi.outstanding_amount > 0")

    if filters.get("supplier"):
        conditions.append("pi.supplier LIKE %(supplier)s")
        params["supplier"] = f"%{filters['supplier']}%"

    if filters.get("bill_no"):
        conditions.append("pi.bill_no LIKE %(bill_no)s")
        params["bill_no"] = f"%{filters['bill_no']}%"

    if filters.get("owner"):
        conditions.append("pi.owner LIKE %(owner)s")
        params["owner"] = f"%{filters['owner']}%"

    if filters.get("linked_doc"):
        conditions.append("EXISTS (SELECT 1 FROM `tabReimbursement Invoice Item` rii_flt WHERE rii_flt.source_pi = pi.name AND rii_flt.parent LIKE %(linked_doc)s)")
        params["linked_doc"] = f"%{filters['linked_doc']}%"

    where_clause = " AND ".join(conditions)

    sql = f"""
        SELECT
            pi.name AS pi_name,
            pi.company,
            pi.supplier,
            COALESCE(pi.bill_no, '') AS bill_no,
            pi.bill_date,
            pi.posting_date,
            pi.grand_total,
            pi.outstanding_amount,
            pi.owner,
            pi.currency,
            {doc_details_col} AS custom_doc_details,
            {type_col} AS invoice_type,
            GROUP_CONCAT(DISTINCT CONCAT(pii.item_name, ' (', ROUND(pii.qty, 2), ' ', COALESCE(pii.uom, pii.stock_uom, ''), ')') SEPARATOR '、') AS synthesized_details,
            (
                SELECT GROUP_CONCAT(DISTINCT rii.parent ORDER BY rii.parent DESC SEPARATOR '、')
                FROM `tabReimbursement Invoice Item` rii
                INNER JOIN `tabReimbursement Request` rr_inner ON rr_inner.name = rii.parent
                WHERE rii.source_pi = pi.name AND rr_inner.docstatus < 2
            ) AS linked_rr_names
        FROM `tabPurchase Invoice` pi
        LEFT JOIN `tabPurchase Invoice Item` pii ON pii.parent = pi.name
        WHERE {where_clause}
        GROUP BY pi.name
        ORDER BY pi.posting_date DESC, pi.name DESC
        LIMIT 1000
    """

    invoices = frappe.db.sql(sql, params, as_dict=True)
    invoices = filter_rows_by_doctype_permission(invoices, "Purchase Invoice", "pi_name")

    active_res = []
    if frappe.db.exists("DocType", "Reimbursement Source Reservation"):
        active_res = frappe.get_all(
            "Reimbursement Source Reservation",
            filters={"status": ["in", ["Draft", "Submitted"]]},
            fields=["source_purchase_invoice", "source_purchase_invoice_item", "reserved_amount"],
        )
    reserved_by_pi = defaultdict(float)
    for res in active_res:
        reserved_by_pi[res.source_purchase_invoice] += flt(res.reserved_amount)

    rows = []
    total_outstanding = 0.0

    for inv in invoices:
        reserved = reserved_by_pi.get(inv.pi_name, 0.0)
        net_outstanding = max(0.0, flt(inv.outstanding_amount) - reserved)
        has_link = bool(inv.linked_rr_names)

        if match_status == "pending" and net_outstanding <= 0.0001:
            continue
        if match_status == "linked" and not has_link and net_outstanding > 0.0001:
            continue

        rows.append({
            "pi_name": inv.pi_name,
            "company": inv.company,
            "supplier": inv.supplier,
            "bill_no": inv.bill_no or "",
            "bill_date": str(inv.bill_date) if inv.bill_date else "",
            "posting_date": str(inv.posting_date) if inv.posting_date else "",
            "grand_total": flt(inv.grand_total, 2),
            "outstanding_amount": flt(inv.outstanding_amount, 2),
            "net_available_amount": flt(net_outstanding, 2),
            "this_amount": flt(net_outstanding, 2),
            "owner": inv.owner or "",
            "invoice_type": inv.invoice_type or "普通发票",
            "currency": inv.currency or "CNY",
            "custom_doc_details": inv.custom_doc_details or inv.synthesized_details or "",
            "linked_rr_names": inv.linked_rr_names or "",
        })
        total_outstanding += net_outstanding

    return {
        "companies": companies,
        "count": len(rows),
        "total_outstanding": total_outstanding,
        "rows": rows,
    }


@frappe.whitelist(methods=["POST"])
def make_reimbursement_from_invoices(
    company: str | None,
    selected_invoices: list[str] | str,
    applicant: str | None = None,
    purpose: str | None = None,
) -> dict:
    """Generate Draft Reimbursement Request from selected unpaid Purchase Invoices or items."""
    _assert_stage_access("pi_to_rr", "create")
    invoice_names = normalize_names(selected_invoices)
    if not invoice_names:
        frappe.throw(_("请选择至少一张采购发票。"))

    invoices = frappe.get_all("Purchase Invoice", filters={"name": ["in", invoice_names]}, fields=["name", "company"])
    if not invoices:
        frappe.throw(_("未找到所选采购发票。"))

    distinct_companies = list({inv.company for inv in invoices})
    if len(distinct_companies) > 1:
        frappe.throw(_("单次报销申请仅支持同一公司的采购发票。所选发票跨越了多个公司：{0}").format(", ".join(distinct_companies)))

    target_company = distinct_companies[0]
    assert_company_access(target_company)

    rr = frappe.new_doc("Reimbursement Request")
    rr.company = target_company
    rr.posting_date = get_effective_work_date()
    rr.title = (purpose or "").strip() or f"采购发票报销_{nowdate()}"

    if applicant:
        if _meta_has("Reimbursement Request", "applicant"):
            rr.applicant = applicant
        elif _meta_has("Reimbursement Request", "employee"):
            rr.employee = applicant
    else:
        current_emp = frappe.db.get_value("Employee", {"user_id": frappe.session.user}, "name")
        if _meta_has("Reimbursement Request", "applicant"):
            rr.applicant = current_emp or frappe.session.user
        elif _meta_has("Reimbursement Request", "employee"):
            rr.employee = current_emp

    candidates = get_purchase_invoice_item_candidates(company=target_company, purchase_invoice_names=invoice_names)
    if not candidates:
        frappe.throw(_("所选采购发票无可用的报销明细行（可能已被全部预占）。"))

    for c in candidates:
        rr.append("invoice_items", c["row"])

    rr.flags.ignore_permissions = False
    rr.insert()
    rr.submit()

    return {
        "success": True,
        "reimbursement_name": rr.name,
        "company": target_company,
        "total_amount": flt(rr.get("total_amount") or sum(flt(c["row"]["amount"]) for c in candidates)),
        "message": _("成功生成并正式发布报销申请单：{0}").format(rr.name),
    }


# =========================================================================
# Stage 4: 付款单 (对公电汇 / Payment Entry & 下级账单穿透) APIs
# =========================================================================

@frappe.whitelist()
def get_pending_payment_invoices(
    company: str | None = None,
    filters: dict | str | None = None,
) -> dict:
    """Query Purchase Invoices for Stage 4 (付款单) Detail View with payment status and supplier bank info."""
    _assert_stage_access("pi_to_pay", "read")
    companies = _resolve_companies(company)
    if isinstance(filters, str):
        filters = frappe.parse_json(filters) or {}
    filters = dict(filters or {})

    match_status = filters.get("match_status") or "pending"
    if match_status == "all":
        return get_all_payment_entry_references(company, filters)

    conditions = [
        "pi.company IN %(companies)s",
        "pi.docstatus = 1",
    ]
    params: dict[str, Any] = {"companies": companies}

    if match_status == "pending":
        conditions.append("pi.outstanding_amount > 0.0001")
    elif match_status == "completed" or match_status == "linked":
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

    sql = f"""
        SELECT
            pi.name AS pi_name,
            pi.company,
            pi.supplier,
            COALESCE(pi.bill_no, '') AS bill_no,
            pi.bill_date,
            pi.posting_date,
            pi.due_date,
            pi.grand_total,
            pi.outstanding_amount,
            (pi.grand_total - pi.outstanding_amount) AS paid_amount,
            pi.owner,
            pi.currency,
            (
                SELECT GROUP_CONCAT(DISTINCT per.parent ORDER BY per.parent DESC SEPARATOR '、')
                FROM `tabPayment Entry Reference` per
                INNER JOIN `tabPayment Entry` pe_inner ON pe_inner.name = per.parent
                WHERE per.reference_name = pi.name AND pe_inner.docstatus = 1
            ) AS paid_via_pe_names
        FROM `tabPurchase Invoice` pi
        WHERE {where_clause}
        ORDER BY pi.posting_date DESC, pi.name DESC
        LIMIT 1000
    """

    invoices = frappe.db.sql(sql, params, as_dict=True)
    invoices = filter_rows_by_doctype_permission(invoices, "Purchase Invoice", "pi_name")

    rows = []
    total_outstanding = 0.0
    for inv in invoices:
        out_amt = flt(inv.outstanding_amount, 2)
        grand = flt(inv.grand_total, 2)
        paid = flt(inv.paid_amount, 2)
        pay_status = "未付款" if paid <= 0.0001 else ("已付款" if out_amt <= 0.0001 else "部分付款")

        # Bank info for supplier
        bank_acc = frappe.db.get_value(
            "Bank Account",
            {"party_type": "Supplier", "party": inv.supplier, "is_default": 1},
            ["bank", "bank_account_no"],
            as_dict=True,
        ) or frappe.db.get_value(
            "Bank Account",
            {"party_type": "Supplier", "party": inv.supplier},
            ["bank", "bank_account_no"],
            as_dict=True,
        ) or {}

        rows.append({
            "pi_name": inv.pi_name,
            "company": inv.company,
            "supplier": inv.supplier,
            "bill_no": inv.bill_no or "",
            "bill_date": str(inv.bill_date) if inv.bill_date else "",
            "posting_date": str(inv.posting_date) if inv.posting_date else "",
            "due_date": str(inv.due_date) if inv.due_date else "",
            "grand_total": grand,
            "paid_amount": paid,
            "outstanding_amount": out_amt,
            "this_amount": out_amt,
            "owner": inv.owner or "",
            "currency": inv.currency or "CNY",
            "payment_status": pay_status,
            "bank_name": bank_acc.get("bank") or "",
            "bank_account_no": bank_acc.get("bank_account_no") or "",
            "paid_via_pe_names": inv.paid_via_pe_names or "",
        })
        total_outstanding += out_amt

    return {
        "companies": companies,
        "count": len(rows),
        "total_outstanding": total_outstanding,
        "rows": rows,
    }


@frappe.whitelist()
def get_pending_payment_docs(
    company: str | None = None,
    filters: dict | str | None = None,
) -> dict:
    """Query Payment Entries or Invoices for Stage 4 Doc View (with sub-bills / allocated invoices)."""
    _assert_stage_access("pi_to_pay", "read")
    companies = _resolve_companies(company)
    if isinstance(filters, str):
        filters = frappe.parse_json(filters) or {}
    filters = dict(filters or {})

    match_status = filters.get("match_status") or "pending"

    # If pending: show unpaid invoices
    if match_status == "pending":
        return get_pending_payment_invoices(company, filters)

    # If completed or all: return Payment Entry docs with sub-bills!
    conditions = [
        "pe.company IN %(companies)s",
        "pe.docstatus = 1",
        "pe.payment_type = 'Pay'",
    ]
    params: dict[str, Any] = {"companies": companies}

    if filters.get("supplier"):
        conditions.append("pe.party LIKE %(supplier)s")
        params["supplier"] = f"%{filters['supplier']}%"

    if filters.get("owner"):
        conditions.append("pe.owner LIKE %(owner)s")
        params["owner"] = f"%{filters['owner']}%"

    where_clause = " AND ".join(conditions)

    sql = f"""
        SELECT
            pe.name AS pe_name,
            pe.company,
            pe.party AS supplier,
            pe.party_type,
            pe.posting_date,
            pe.paid_amount,
            pe.received_amount,
            pe.paid_from,
            pe.paid_to,
            pe.mode_of_payment,
            pe.reference_no,
            pe.remarks,
            pe.owner
        FROM `tabPayment Entry` pe
        WHERE {where_clause}
        ORDER BY pe.posting_date DESC, pe.name DESC
        LIMIT 500
    """

    pes = frappe.db.sql(sql, params, as_dict=True)
    pes = filter_rows_by_doctype_permission(pes, "Payment Entry", "pe_name")
    if not pes:
        return {"companies": companies, "count": 0, "rows": []}

    pe_names = [p.pe_name for p in pes]

    # Fetch all allocated references for these Payment Entries
    ref_sql = """
        SELECT
            per.parent AS pe_name,
            per.reference_doctype,
            per.reference_name,
            per.total_amount,
            per.outstanding_amount,
            per.allocated_amount,
            pi.bill_no,
            pi.bill_date,
            pi.posting_date AS invoice_date,
            pi.supplier
        FROM `tabPayment Entry Reference` per
        LEFT JOIN `tabPurchase Invoice` pi ON pi.name = per.reference_name
        WHERE per.parent IN %s
        ORDER BY per.idx ASC
    """
    refs = frappe.db.sql(ref_sql, (pe_names,), as_dict=True)
    refs_by_pe = defaultdict(list)
    for r in refs:
        refs_by_pe[r.pe_name].append({
            "doctype": r.reference_doctype,
            "name": r.reference_name,
            "bill_no": r.bill_no or "",
            "bill_date": str(r.bill_date or ""),
            "invoice_date": str(r.invoice_date or ""),
            "supplier": r.supplier or "",
            "grand_total": flt(r.total_amount, 2),
            "allocated_amount": flt(r.allocated_amount, 2),
            "outstanding_amount": flt(r.outstanding_amount, 2),
        })

    rows = []
    total_paid = 0.0
    for p in pes:
        sub_invoices = refs_by_pe.get(p.pe_name, [])
        p_amt = flt(p.paid_amount, 2)
        total_paid += p_amt

        rows.append({
            "pe_name": p.pe_name,
            "company": p.company,
            "supplier": p.supplier,
            "posting_date": str(p.posting_date) if p.posting_date else "",
            "paid_amount": p_amt,
            "paid_from": p.paid_from or "",
            "paid_to": p.paid_to or "",
            "mode_of_payment": p.mode_of_payment or "电汇",
            "reference_no": p.reference_no or "",
            "remarks": p.remarks or "",
            "owner": p.owner or "",
            "sub_invoices": sub_invoices,
            "sub_invoices_count": len(sub_invoices),
            "payment_status": "已付款",
        })

    return {
        "companies": companies,
        "count": len(rows),
        "total_paid": total_paid,
        "rows": rows,
    }


@frappe.whitelist()
def get_company_payment_accounts(company: str) -> list[dict]:
    """Return available bank and cash payment accounts for the specified company."""
    assert_company_access(company)
    accounts = frappe.get_list(
        "Account",
        filters={
            "company": company,
            "account_type": ["in", ["Bank", "Cash"]],
            "is_group": 0,
        },
        fields=["name", "account_name", "account_type", "account_currency"],
        order_by="account_type ASC, name ASC",
    )
    return accounts


@frappe.whitelist()
def get_supplier_bank_details(supplier: str, company: str | None = None) -> dict:
    """Return bank account details for the specified supplier."""
    _assert_stage_access("pi_to_pay", "read")
    if company:
        assert_company_access(company)
    assert_doctype_permission("Supplier", "read")
    assert_doctype_permission("Bank Account", "read")
    if not supplier:
        return {}
    bank_acc = frappe.db.get_value(
        "Bank Account",
        {"party_type": "Supplier", "party": supplier, "is_default": 1},
        ["name", "bank", "bank_account_no", "branch_code"],
        as_dict=True,
    )
    if not bank_acc:
        bank_acc = frappe.db.get_value(
            "Bank Account",
            {"party_type": "Supplier", "party": supplier},
            ["name", "bank", "bank_account_no", "branch_code"],
            as_dict=True,
        )
    return bank_acc or {}


@frappe.whitelist(methods=["POST"])
def make_wire_transfer_payment_from_invoices(
    company: str,
    selected_invoices: list[str] | str,
    paid_from_account: str,
    posting_date: str | None = None,
    remarks: str | None = None,
    invoices_payload: dict | str | None = None,
) -> dict:
    """Create and submit Payment Entry to pay selected Purchase Invoices via Wire Transfer / Bank Transfer."""
    _assert_stage_access("pi_to_pay", "create")
    assert_company_access(company)

    invoice_names = normalize_names(selected_invoices)
    if not invoice_names:
        frappe.throw(_("请选择至少一张待付款发票。"))

    if isinstance(invoices_payload, str):
        invoices_payload = frappe.parse_json(invoices_payload) or {}
    invoices_payload = dict(invoices_payload or {})

    invoices = frappe.get_all(
        "Purchase Invoice",
        filters={"name": ["in", invoice_names], "docstatus": 1, "company": company},
        fields=["name", "company", "supplier", "grand_total", "outstanding_amount", "credit_to", "bill_no"],
    )
    if not invoices:
        frappe.throw(_("未找到符合条件的已过账采购发票。"))

    distinct_suppliers = list({inv.supplier for inv in invoices})
    if len(distinct_suppliers) > 1:
        frappe.throw(_("对公电汇付款单仅支持同一供应商的发票合并结算。所选发票跨越了多个供应商：{0}").format(", ".join(distinct_suppliers)))

    target_supplier = distinct_suppliers[0]

    # Resolve payable account
    payable_account = invoices[0].credit_to
    if not payable_account:
        from erpnext.accounts.party import get_party_account
        payable_account = get_party_account("Supplier", target_supplier, company)

    if not payable_account:
        frappe.throw(_("无法确定供应商 {0} 在公司 {1} 的应付账款科目。").format(target_supplier, company))

    # Calculate payment allocations
    total_payment = 0.0
    allocated_refs = []
    for inv in invoices:
        avail_outstanding = flt(inv.outstanding_amount)
        if avail_outstanding <= 0.0001:
            continue
        req_amt = flt(invoices_payload.get(inv.name)) if inv.name in invoices_payload else avail_outstanding
        amt_to_pay = min(req_amt, avail_outstanding)
        if amt_to_pay > 0.0001:
            total_payment += amt_to_pay
            allocated_refs.append({
                "reference_doctype": "Purchase Invoice",
                "reference_name": inv.name,
                "total_amount": flt(inv.grand_total),
                "outstanding_amount": avail_outstanding,
                "allocated_amount": flt(amt_to_pay, 2),
            })

    if not allocated_refs or total_payment <= 0.0001:
        frappe.throw(_("所选采购发票无可付款金额（可能已全部结清）。"))

    pe = frappe.new_doc("Payment Entry")
    pe.payment_type = "Pay"
    pe.party_type = "Supplier"
    pe.party = target_supplier
    pe.company = company
    pe.posting_date = get_effective_work_date(posting_date)
    pe.paid_from = paid_from_account
    pe.paid_to = payable_account
    pe.paid_amount = flt(total_payment, 2)
    pe.received_amount = flt(total_payment, 2)
    pe.reference_no = (remarks or "").strip() or f"对公电汇_{nowdate()}"
    pe.reference_date = get_effective_work_date(posting_date)
    pe.remarks = (remarks or "").strip() or f"采购发票对公电汇结算 ({len(allocated_refs)}张发票)"
    pe.mode_of_payment = "电汇" if frappe.db.exists("Mode of Payment", "电汇") else ("Bank" if frappe.db.exists("Mode of Payment", "Bank") else None)

    for ref in allocated_refs:
        pe.append("references", ref)

    pe.flags.ignore_permissions = False
    pe.insert()
    pe.submit()

    return {
        "success": True,
        "payment_entry_name": pe.name,
        "company": company,
        "supplier": target_supplier,
        "total_amount": flt(pe.paid_amount, 2),
        "invoices_count": len(allocated_refs),
        "message": _("成功生成并提交对公电汇付款单：{0}，核销金额：¥ {1:,.2f}").format(pe.name, pe.paid_amount),
    }


@frappe.whitelist()
def get_payment_entry_sub_invoices(payment_entry_name: str) -> dict:
    """Return the list of underlying purchase invoices allocated by the specified Payment Entry."""
    if not payment_entry_name or not frappe.db.exists("Payment Entry", payment_entry_name):
        frappe.throw(_("付款单不存在：{0}").format(payment_entry_name))

    pe = frappe.get_doc("Payment Entry", payment_entry_name)
    assert_company_access(pe.company)

    ref_sql = """
        SELECT
            per.reference_doctype,
            per.reference_name,
            per.total_amount,
            per.outstanding_amount,
            per.allocated_amount,
            pi.bill_no,
            pi.bill_date,
            pi.posting_date AS invoice_date,
            pi.supplier,
            pi.grand_total
        FROM `tabPayment Entry Reference` per
        LEFT JOIN `tabPurchase Invoice` pi ON pi.name = per.reference_name
        WHERE per.parent = %s
        ORDER BY per.idx ASC
    """
    refs = frappe.db.sql(ref_sql, (payment_entry_name,), as_dict=True)
    invoices = []
    for r in refs:
        invoices.append({
            "doctype": r.reference_doctype or "Purchase Invoice",
            "name": r.reference_name,
            "bill_no": r.bill_no or "",
            "bill_date": str(r.bill_date or ""),
            "invoice_date": str(r.invoice_date or ""),
            "supplier": r.supplier or "",
            "grand_total": flt(r.grand_total or r.total_amount, 2),
            "allocated_amount": flt(r.allocated_amount, 2),
            "outstanding_amount": flt(r.outstanding_amount, 2),
        })

    return {
        "payment_entry_name": payment_entry_name,
        "company": pe.company,
        "party": pe.party,
        "paid_amount": flt(pe.paid_amount, 2),
        "posting_date": str(pe.posting_date),
        "invoices": invoices,
        "count": len(invoices),
    }


# =========================================================================
# Overall Summary KPI Endpoint (5-Step Flow)
# =========================================================================

@frappe.whitelist()
def get_procurement_picker_overview_kpis(
    company: str | None = None,
    workbench: str = "overview",
) -> dict:
    """Return only the KPI counts needed by the current role workbench."""
    context = get_procurement_workbench_context(workbench)
    allowed_stages = set(context["allowed_stages"])
    companies = _resolve_companies(company)
    kpis: dict[str, dict] = {}

    if "item_to_mr" in allowed_stages:
        count = frappe.db.sql("""
            SELECT COUNT(DISTINCT mr.name)
            FROM `tabMaterial Request` mr
            WHERE mr.docstatus = 0
              AND mr.material_request_type = 'Purchase'
              AND mr.company IN %s
        """, (companies,))[0][0] or 0
        kpis["item_to_mr"] = {"count": count, "label": "草稿"}

    if "mr_to_po" in allowed_stages:
        count = frappe.db.sql("""
            SELECT COUNT(DISTINCT mr.name)
            FROM `tabMaterial Request Item` mri
            INNER JOIN `tabMaterial Request` mr ON mr.name = mri.parent
            WHERE mr.docstatus = 1
              AND mr.material_request_type = 'Purchase'
              AND mr.company IN %s
              AND mr.status NOT IN ('Stopped', 'Cancelled', 'Transfer')
              AND (mri.qty - COALESCE(mri.ordered_qty, 0)) > 0.0001
        """, (companies,))[0][0] or 0
        kpis["mr_to_po"] = {"count": count, "label": "待采购"}

    if "po_to_pr" in allowed_stages:
        count = frappe.db.sql("""
            SELECT COUNT(DISTINCT po.name)
            FROM `tabPurchase Order Item` poi
            INNER JOIN `tabPurchase Order` po ON po.name = poi.parent
            WHERE po.docstatus = 1
              AND po.company IN %s
              AND po.status NOT IN ('Closed', 'Cancelled', 'Delivered')
              AND (poi.qty - COALESCE(poi.received_qty, 0)) > 0.0001
        """, (companies,))[0][0] or 0
        kpis["po_to_pr"] = {"count": count, "label": "待入库"}

    if "pr_to_pi" in allowed_stages:
        count = frappe.db.sql("""
            SELECT COUNT(DISTINCT pr.name)
            FROM `tabPurchase Receipt Item` pri
            INNER JOIN `tabPurchase Receipt` pr ON pr.name = pri.parent
            WHERE pr.docstatus = 1
              AND pr.company IN %s
              AND pr.status NOT IN ('Closed', 'Cancelled', 'Return Issued')
              AND (pri.amount - COALESCE(pri.billed_amt, 0)) > 0.01
        """, (companies,))[0][0] or 0
        kpis["pr_to_pi"] = {"count": count, "label": "待开票"}

    if "pi_to_rr" in allowed_stages:
        reserved_by_pi = defaultdict(float)
        if frappe.db.exists("DocType", "Reimbursement Source Reservation"):
            active_reservations = frappe.get_all(
                "Reimbursement Source Reservation",
                filters={"status": ["in", ["Draft", "Submitted"]]},
                fields=["source_purchase_invoice", "reserved_amount"],
            )
            for reservation in active_reservations:
                reserved_by_pi[reservation.source_purchase_invoice] += flt(reservation.reserved_amount)

        raw_invoices = frappe.db.sql("""
            SELECT name, outstanding_amount
            FROM `tabPurchase Invoice`
            WHERE docstatus = 1
              AND company IN %s
              AND outstanding_amount > 0.0001
        """, (companies,), as_dict=True)
        count = 0
        amount = 0.0
        for invoice in raw_invoices:
            available = max(
                0.0,
                flt(invoice.outstanding_amount) - reserved_by_pi.get(invoice.name, 0.0),
            )
            if available > 0.0001:
                count += 1
                amount += available
        kpis["pi_to_rr"] = {"count": count, "amount": amount, "label": "待整算"}

    if "pi_to_pay" in allowed_stages:
        raw_invoices = frappe.db.sql("""
            SELECT COUNT(name) AS cnt, COALESCE(SUM(outstanding_amount), 0.0) AS amt
            FROM `tabPurchase Invoice`
            WHERE docstatus = 1
              AND company IN %s
              AND outstanding_amount > 0.0001
        """, (companies,), as_dict=True)
        count = raw_invoices[0].cnt if raw_invoices else 0
        amount = flt(raw_invoices[0].amt if raw_invoices else 0.0)
        kpis["pi_to_pay"] = {"count": count, "amount": amount, "label": "待付款"}

    return {"companies": companies, "kpis": kpis}


@frappe.whitelist()
def get_sidebar_notification_kpis(company: str | None = None) -> dict:
    """Return dynamic pending task counts for left sidebar navigation items.

    Keys map directly to sidebar route / item identifiers:
    - material-receipt-workbench (收货入库): 已执行采购等待实际入库的采购订单数 (po_to_pr)
    - procurement-execution-workbench (采购执行): 待订货的采购申请单据数 (mr_to_po)
    - material-request-workbench (物料申请): 待提交/待处理物料申请草稿单据数 (item_to_mr)
    """
    companies = _resolve_companies(company)

    # 1. 收货入库 (material-receipt-workbench · po_to_pr):
    # 已审核生效采购订单中，尚有未全部入库的采购订单单据数 (与首页待物资入库口径保持100%一致)
    po_to_pr_count = frappe.db.sql("""
        SELECT COUNT(DISTINCT po.name)
        FROM `tabPurchase Order Item` poi
        INNER JOIN `tabPurchase Order` po ON po.name = poi.parent
        WHERE po.docstatus = 1
          AND po.company IN %s
          AND po.status NOT IN ('Closed', 'Cancelled', 'Delivered', 'Completed')
          AND (poi.qty - COALESCE(poi.received_qty, 0)) > 0.0001
    """, (companies,))[0][0] or 0

    # 2. 采购执行 (procurement-execution-workbench · mr_to_po):
    # 待采购订货的申请单据数 (与首页待采购下单口径一致)
    mr_to_po_count = frappe.db.sql("""
        SELECT COUNT(DISTINCT mr.name)
        FROM `tabMaterial Request Item` mri
        INNER JOIN `tabMaterial Request` mr ON mr.name = mri.parent
        WHERE mr.docstatus = 1
          AND mr.material_request_type = 'Purchase'
          AND mr.company IN %s
          AND mr.status NOT IN ('Stopped', 'Cancelled', 'Transfer', 'Completed')
          AND (mri.qty - COALESCE(mri.ordered_qty, 0)) > 0.0001
    """, (companies,))[0][0] or 0

    # 3. 物料申请 (material-request-workbench · item_to_mr):
    # 草稿采购申请单据数
    item_to_mr_count = frappe.db.sql("""
        SELECT COUNT(DISTINCT mr.name)
        FROM `tabMaterial Request` mr
        WHERE mr.docstatus = 0
          AND mr.material_request_type = 'Purchase'
          AND mr.company IN %s
    """, (companies,))[0][0] or 0

    # 4. 材料出库 (stock-issue-workbench):
    # 待提交出库单草稿数
    stock_issue_draft_count = frappe.db.sql("""
        SELECT COUNT(DISTINCT se.name)
        FROM `tabStock Entry` se
        WHERE se.docstatus = 0
          AND se.purpose IN ('Material Issue', 'Manufacture', 'Material Transfer')
          AND se.company IN %s
    """, (companies,))[0][0] or 0

    return {
        "material-receipt-workbench": int(po_to_pr_count),
        "procurement-execution-workbench": int(mr_to_po_count),
        "material-request-workbench": int(item_to_mr_count),
        "stock-issue-workbench": int(stock_issue_draft_count),
    }


# =========================================================================
# Target Documents Query Helpers (for "全部 [目标单据]" Status Views)
# =========================================================================

@frappe.whitelist()
def get_all_purchase_order_items(
    company: str | None = None,
    filters: dict | str | None = None,
) -> dict:
    """Query all Purchase Order Line Items for '全部采购单' detail view."""
    _assert_stage_access("mr_to_po", "read")
    companies = _resolve_companies(company)
    if isinstance(filters, str):
        filters = frappe.parse_json(filters) or {}
    filters = dict(filters or {})

    conditions = [
        "po.company IN %(companies)s",
        "po.docstatus < 2",
    ]
    params: dict[str, Any] = {"companies": companies}

    if filters.get("supplier"):
        conditions.append("po.supplier LIKE %(supplier)s")
        params["supplier"] = f"%{filters['supplier']}%"
    if filters.get("po_name"):
        conditions.append("po.name LIKE %(po_name)s")
        params["po_name"] = f"%{filters['po_name']}%"
    if filters.get("item_code"):
        conditions.append("(poi.item_code LIKE %(item_code)s OR poi.item_name LIKE %(item_code)s)")
        params["item_code"] = f"%{filters['item_code']}%"
    if filters.get("from_date"):
        conditions.append("po.transaction_date >= %(from_date)s")
        params["from_date"] = filters["from_date"]
    if filters.get("to_date"):
        conditions.append("po.transaction_date <= %(to_date)s")
        params["to_date"] = filters["to_date"]

    where_clause = " AND ".join(conditions)
    sql = f"""
        SELECT
            poi.name AS poi_name,
            po.name AS po_name,
            po.company,
            po.supplier,
            po.transaction_date,
            poi.item_code,
            poi.item_name,
            COALESCE(poi.custom_spec_model, '') AS spec,
            COALESCE(poi.custom_line_remark, '') AS remarks,
            COALESCE(poi.uom, poi.stock_uom, '') AS uom,
            COALESCE(poi.qty, 0) AS qty,
            COALESCE(poi.received_qty, 0) AS received_qty,
            COALESCE(poi.billed_amt, 0) AS billed_amt,
            COALESCE(poi.rate, 0) AS rate,
            COALESCE(poi.amount, 0) AS amount,
            COALESCE(poi.warehouse, '') AS warehouse,
            po.status,
            po.docstatus,
            (
                SELECT GROUP_CONCAT(DISTINCT pri.parent ORDER BY pri.parent DESC SEPARATOR '、')
                FROM `tabPurchase Receipt Item` pri
                INNER JOIN `tabPurchase Receipt` pr ON pr.name = pri.parent
                WHERE pri.purchase_order_item = poi.name AND pr.docstatus < 2
            ) AS linked_pr_names
        FROM `tabPurchase Order Item` poi
        INNER JOIN `tabPurchase Order` po ON po.name = poi.parent
        WHERE {where_clause}
        ORDER BY (
            CASE 
                WHEN po.docstatus = 0 THEN 0
                WHEN po.status IN ('Completed', 'Closed', 'Cancelled') THEN 2
                ELSE 1
            END
        ) ASC, po.transaction_date DESC, po.name DESC, poi.idx ASC
        LIMIT 1000
    """
    items = frappe.db.sql(sql, params, as_dict=True)
    items = filter_rows_by_doctype_permission(items, "Purchase Order", "po_name")
    return {"companies": companies, "count": len(items), "rows": items}


@frappe.whitelist()
def get_all_purchase_order_docs(
    company: str | None = None,
    filters: dict | str | None = None,
) -> dict:
    """Query all Purchase Order Documents for '全部采购单' doc view."""
    _assert_stage_access("mr_to_po", "read")
    companies = _resolve_companies(company)
    if isinstance(filters, str):
        filters = frappe.parse_json(filters) or {}
    filters = dict(filters or {})

    has_custom_doc_details = _meta_has("Purchase Order", "custom_doc_details")
    doc_details_col = "COALESCE(po.custom_doc_details, '')" if has_custom_doc_details else "''"

    conditions = [
        "po.company IN %(companies)s",
        "po.docstatus < 2",
    ]
    params: dict[str, Any] = {"companies": companies}

    if filters.get("supplier"):
        conditions.append("po.supplier LIKE %(supplier)s")
        params["supplier"] = f"%{filters['supplier']}%"
    if filters.get("po_name"):
        conditions.append("po.name LIKE %(po_name)s")
        params["po_name"] = f"%{filters['po_name']}%"
    if filters.get("owner"):
        conditions.append("po.owner LIKE %(owner)s")
        params["owner"] = f"%{filters['owner']}%"
    if filters.get("from_date"):
        conditions.append("po.transaction_date >= %(from_date)s")
        params["from_date"] = filters["from_date"]
    if filters.get("to_date"):
        conditions.append("po.transaction_date <= %(to_date)s")
        params["to_date"] = filters["to_date"]

    where_clause = " AND ".join(conditions)
    sql = f"""
        SELECT
            po.name AS po_name,
            po.company,
            po.supplier,
            po.transaction_date,
            po.schedule_date,
            {doc_details_col} AS custom_doc_details,
            po.grand_total,
            po.status,
            po.docstatus,
            po.owner,
            COUNT(DISTINCT poi.name) AS items_count,
            COALESCE(SUM(poi.qty), 0) AS total_qty,
            (
                SELECT GROUP_CONCAT(DISTINCT pri.parent ORDER BY pri.parent DESC SEPARATOR '、')
                FROM `tabPurchase Receipt Item` pri
                INNER JOIN `tabPurchase Receipt` pr ON pr.name = pri.parent
                WHERE pri.purchase_order = po.name AND pr.docstatus < 2
            ) AS linked_pr_names
        FROM `tabPurchase Order` po
        LEFT JOIN `tabPurchase Order Item` poi ON poi.parent = po.name
        WHERE {where_clause}
        GROUP BY po.name
        ORDER BY (
            CASE 
                WHEN po.docstatus = 0 THEN 0
                WHEN po.status IN ('Completed', 'Closed', 'Cancelled') THEN 2
                ELSE 1
            END
        ) ASC, po.transaction_date DESC, po.name DESC
        LIMIT 500
    """
    docs = frappe.db.sql(sql, params, as_dict=True)
    docs = filter_rows_by_doctype_permission(docs, "Purchase Order", "po_name")
    return {"companies": companies, "count": len(docs), "rows": docs}


@frappe.whitelist()
def get_all_purchase_receipt_items(
    company: str | None = None,
    filters: dict | str | None = None,
) -> dict:
    """Query all Purchase Receipt Line Items for '全部入库单' detail view."""
    _assert_stage_access("po_to_pr", "read")
    companies = _resolve_companies(company)
    if isinstance(filters, str):
        filters = frappe.parse_json(filters) or {}
    filters = dict(filters or {})

    conditions = [
        "pr.company IN %(companies)s",
        "pr.docstatus < 2",
    ]
    params: dict[str, Any] = {"companies": companies}

    if filters.get("supplier"):
        conditions.append("pr.supplier LIKE %(supplier)s")
        params["supplier"] = f"%{filters['supplier']}%"
    if filters.get("pr_name"):
        conditions.append("pr.name LIKE %(pr_name)s")
        params["pr_name"] = f"%{filters['pr_name']}%"
    if filters.get("item_code"):
        conditions.append("(pri.item_code LIKE %(item_code)s OR pri.item_name LIKE %(item_code)s)")
        params["item_code"] = f"%{filters['item_code']}%"

    where_clause = " AND ".join(conditions)
    sql = f"""
        SELECT
            pri.name AS pri_name,
            pr.name AS pr_name,
            pr.company,
            pr.supplier,
            pr.posting_date,
            pri.item_code,
            pri.item_name,
            COALESCE(pri.custom_spec_model, '') AS spec,
            COALESCE(pri.custom_line_remark, '') AS remarks,
            COALESCE(pri.uom, pri.stock_uom, '') AS uom,
            COALESCE(pri.qty, 0) AS qty,
            COALESCE(pri.billed_amt, 0) AS billed_amt,
            COALESCE(pri.rate, 0) AS rate,
            COALESCE(pri.amount, 0) AS amount,
            COALESCE(pri.warehouse, '') AS warehouse,
            COALESCE(pri.purchase_order, '') AS purchase_order,
            pr.status,
            pr.docstatus,
            (
                SELECT GROUP_CONCAT(DISTINCT pii.parent ORDER BY pii.parent DESC SEPARATOR '、')
                FROM `tabPurchase Invoice Item` pii
                INNER JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent
                WHERE pii.pr_detail = pri.name AND pi.docstatus < 2
            ) AS linked_pi_names
        FROM `tabPurchase Receipt Item` pri
        INNER JOIN `tabPurchase Receipt` pr ON pr.name = pri.parent
        WHERE {where_clause}
        ORDER BY (
            CASE 
                WHEN pr.docstatus = 0 THEN 0
                WHEN pr.status IN ('Completed', 'Closed', 'Cancelled') THEN 2
                ELSE 1
            END
        ) ASC, pr.posting_date DESC, pr.name DESC, pri.idx ASC
        LIMIT 1000
    """
    items = frappe.db.sql(sql, params, as_dict=True)
    items = filter_rows_by_doctype_permission(items, "Purchase Receipt", "pr_name")
    return {"companies": companies, "count": len(items), "rows": items}


@frappe.whitelist()
def get_all_purchase_receipt_docs(
    company: str | None = None,
    filters: dict | str | None = None,
) -> dict:
    """Query all Purchase Receipt Documents for '全部入库单' doc view."""
    _assert_stage_access("po_to_pr", "read")
    companies = _resolve_companies(company)
    if isinstance(filters, str):
        filters = frappe.parse_json(filters) or {}
    filters = dict(filters or {})

    has_custom_doc_details = _meta_has("Purchase Receipt", "custom_doc_details")
    doc_details_col = "COALESCE(pr.custom_doc_details, '')" if has_custom_doc_details else "''"

    conditions = [
        "pr.company IN %(companies)s",
        "pr.docstatus < 2",
    ]
    params: dict[str, Any] = {"companies": companies}

    if filters.get("supplier"):
        conditions.append("pr.supplier LIKE %(supplier)s")
        params["supplier"] = f"%{filters['supplier']}%"
    if filters.get("pr_name"):
        conditions.append("pr.name LIKE %(pr_name)s")
        params["pr_name"] = f"%{filters['pr_name']}%"
    if filters.get("owner"):
        conditions.append("pr.owner LIKE %(owner)s")
        params["owner"] = f"%{filters['owner']}%"
    if filters.get("from_date"):
        conditions.append("pr.posting_date >= %(from_date)s")
        params["from_date"] = filters["from_date"]
    if filters.get("to_date"):
        conditions.append("pr.posting_date <= %(to_date)s")
        params["to_date"] = filters["to_date"]

    where_clause = " AND ".join(conditions)
    sql = f"""
        SELECT
            pr.name AS pr_name,
            pr.company,
            pr.supplier,
            pr.posting_date,
            COALESCE(pr.set_warehouse, '') AS warehouse,
            {doc_details_col} AS custom_doc_details,
            pr.grand_total,
            pr.status,
            pr.docstatus,
            pr.owner,
            COUNT(DISTINCT pri.name) AS items_count,
            COALESCE(SUM(pri.qty), 0) AS total_qty,
            GROUP_CONCAT(DISTINCT pri.purchase_order SEPARATOR '、') AS purchase_order,
            (
                SELECT GROUP_CONCAT(DISTINCT pii.parent ORDER BY pii.parent DESC SEPARATOR '、')
                FROM `tabPurchase Invoice Item` pii
                INNER JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent
                WHERE pii.purchase_receipt = pr.name AND pi.docstatus < 2
            ) AS linked_pi_names
        FROM `tabPurchase Receipt` pr
        LEFT JOIN `tabPurchase Receipt Item` pri ON pri.parent = pr.name
        WHERE {where_clause}
        GROUP BY pr.name
        ORDER BY (
            CASE 
                WHEN pr.docstatus = 0 THEN 0
                WHEN pr.status IN ('Completed', 'Closed', 'Cancelled') THEN 2
                ELSE 1
            END
        ) ASC, pr.posting_date DESC, pr.name DESC
        LIMIT 500
    """
    docs = frappe.db.sql(sql, params, as_dict=True)
    docs = filter_rows_by_doctype_permission(docs, "Purchase Receipt", "pr_name")
    return {"companies": companies, "count": len(docs), "rows": docs}


@frappe.whitelist()
def get_all_purchase_invoice_items(
    company: str | None = None,
    filters: dict | str | None = None,
) -> dict:
    """Query all Purchase Invoice Line Items for '全部发票' detail view."""
    _assert_stage_access("pr_to_pi", "read")
    companies = _resolve_companies(company)
    if isinstance(filters, str):
        filters = frappe.parse_json(filters) or {}
    filters = dict(filters or {})

    conditions = [
        "pi.company IN %(companies)s",
        "pi.docstatus < 2",
    ]
    params: dict[str, Any] = {"companies": companies}

    if filters.get("supplier"):
        conditions.append("pi.supplier LIKE %(supplier)s")
        params["supplier"] = f"%{filters['supplier']}%"
    if filters.get("bill_no"):
        conditions.append("pi.bill_no LIKE %(bill_no)s")
        params["bill_no"] = f"%{filters['bill_no']}%"
    if filters.get("item_code"):
        conditions.append("(pii.item_code LIKE %(item_code)s OR pii.item_name LIKE %(item_code)s)")
        params["item_code"] = f"%{filters['item_code']}%"

    where_clause = " AND ".join(conditions)
    sql = f"""
        SELECT
            pii.name AS pii_name,
            pi.name AS pi_name,
            pi.company,
            pi.supplier,
            COALESCE(pi.bill_no, '') AS bill_no,
            pi.bill_date,
            pi.posting_date,
            pii.item_code,
            pii.item_name,
            COALESCE(pii.custom_spec_model, '') AS spec,
            COALESCE(pii.custom_line_remark, '') AS remarks,
            COALESCE(pii.uom, pii.stock_uom, '') AS uom,
            COALESCE(pii.qty, 0) AS qty,
            COALESCE(pii.rate, 0) AS rate,
            COALESCE(pii.amount, 0) AS amount,
            COALESCE(pii.net_amount, pii.amount, 0) AS net_amount,
            COALESCE(pii.purchase_receipt, '') AS purchase_receipt,
            pi.grand_total,
            pi.outstanding_amount,
            pi.status,
            pi.docstatus
        FROM `tabPurchase Invoice Item` pii
        INNER JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent
        WHERE {where_clause}
        ORDER BY (
            CASE 
                WHEN pi.docstatus = 0 THEN 0
                WHEN pi.status IN ('Paid', 'Cancelled') OR (pi.outstanding_amount <= 0.0001 AND pi.docstatus = 1) THEN 2
                ELSE 1
            END
        ) ASC, pi.posting_date DESC, pi.name DESC, pii.idx ASC
        LIMIT 1000
    """
    items = frappe.db.sql(sql, params, as_dict=True)
    items = filter_rows_by_doctype_permission(items, "Purchase Invoice", "pi_name")
    return {"companies": companies, "count": len(items), "rows": items}


@frappe.whitelist()
def get_all_purchase_invoice_docs(
    company: str | None = None,
    filters: dict | str | None = None,
) -> dict:
    """Query all Purchase Invoice Documents for '全部发票' doc view."""
    _assert_stage_access("pr_to_pi", "read")
    companies = _resolve_companies(company)
    if isinstance(filters, str):
        filters = frappe.parse_json(filters) or {}
    filters = dict(filters or {})

    has_custom_doc_details = _meta_has("Purchase Invoice", "custom_doc_details")
    doc_details_col = "COALESCE(pi.custom_doc_details, '')" if has_custom_doc_details else "''"
    has_invoice_type = _meta_has("Purchase Invoice", "custom_invoice_type")
    type_col = "COALESCE(pi.custom_invoice_type, '普通发票')" if has_invoice_type else "'普通发票'"

    conditions = [
        "pi.company IN %(companies)s",
        "pi.docstatus < 2",
    ]
    params: dict[str, Any] = {"companies": companies}

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
    sql = f"""
        SELECT
            pi.name AS pi_name,
            pi.company,
            pi.supplier,
            COALESCE(pi.bill_no, '') AS bill_no,
            pi.bill_date,
            pi.posting_date,
            {doc_details_col} AS custom_doc_details,
            {type_col} AS invoice_type,
            pi.grand_total,
            pi.outstanding_amount,
            (pi.grand_total - pi.outstanding_amount) AS paid_amount,
            pi.status,
            pi.docstatus,
            pi.owner,
            (
                SELECT GROUP_CONCAT(DISTINCT pii.purchase_receipt SEPARATOR '、')
                FROM `tabPurchase Invoice Item` pii
                WHERE pii.parent = pi.name AND pii.purchase_receipt IS NOT NULL AND pii.purchase_receipt != ''
            ) AS linked_pr_names,
            (
                SELECT GROUP_CONCAT(DISTINCT per.parent ORDER BY per.parent DESC SEPARATOR '、')
                FROM `tabPayment Entry Reference` per
                INNER JOIN `tabPayment Entry` pe ON pe.name = per.parent
                WHERE per.reference_name = pi.name AND pe.docstatus < 2
            ) AS paid_via_pe_names,
            (
                SELECT GROUP_CONCAT(DISTINCT rii.parent ORDER BY rii.parent DESC SEPARATOR '、')
                FROM `tabReimbursement Invoice Item` rii
                INNER JOIN `tabReimbursement Request` rr ON rr.name = rii.parent
                WHERE rii.source_pi = pi.name AND rr.docstatus < 2
            ) AS linked_rr_names
        FROM `tabPurchase Invoice` pi
        WHERE {where_clause}
        ORDER BY (
            CASE 
                WHEN pi.docstatus = 0 THEN 0
                WHEN pi.status IN ('Paid', 'Cancelled') OR (pi.outstanding_amount <= 0.0001 AND pi.docstatus = 1) THEN 2
                ELSE 1
            END
        ) ASC, pi.posting_date DESC, pi.name DESC
        LIMIT 500
    """
    docs = frappe.db.sql(sql, params, as_dict=True)
    docs = filter_rows_by_doctype_permission(docs, "Purchase Invoice", "pi_name")
    return {"companies": companies, "count": len(docs), "rows": docs}


@frappe.whitelist()
def get_all_reimbursement_request_items(
    company: str | None = None,
    filters: dict | str | None = None,
) -> dict:
    """Query all Reimbursement Request Items for '全部整算单' detail view."""
    _assert_stage_access("pi_to_rr", "read")
    companies = _resolve_companies(company)
    if isinstance(filters, str):
        filters = frappe.parse_json(filters) or {}
    filters = dict(filters or {})

    conditions = [
        "rr.company IN %(companies)s",
        "rr.docstatus < 2",
    ]
    params: dict[str, Any] = {"companies": companies}

    if filters.get("supplier"):
        conditions.append("rii.supplier LIKE %(supplier)s")
        params["supplier"] = f"%{filters['supplier']}%"
    if filters.get("bill_no"):
        conditions.append("rii.invoice_no LIKE %(bill_no)s")
        params["bill_no"] = f"%{filters['bill_no']}%"

    where_clause = " AND ".join(conditions)
    sql = f"""
        SELECT
            rii.name AS rii_name,
            rr.name AS rr_name,
            rr.company,
            COALESCE(rr.employee_name, rr.employee, rr.owner) AS applicant,
            rr.posting_date,
            rii.source_pi,
            COALESCE(rii.invoice_no, '') AS bill_no,
            COALESCE(rii.supplier, '') AS supplier,
            COALESCE(pi.bill_date, pi.posting_date, rr.posting_date) AS bill_date,
            COALESCE(rii.amount, 0) AS invoice_amount,
            COALESCE(rii.amount, 0) AS claim_amount,
            COALESCE(rr.payment_status, 'Submitted') AS status,
            rr.docstatus
        FROM `tabReimbursement Invoice Item` rii
        INNER JOIN `tabReimbursement Request` rr ON rr.name = rii.parent
        LEFT JOIN `tabPurchase Invoice` pi ON pi.name = rii.source_pi
        WHERE {where_clause}
        ORDER BY (
            CASE 
                WHEN rr.docstatus = 0 THEN 0
                WHEN rr.status IN ('Paid', '已付款', '已结清', 'Cancelled') OR rr.payment_status IN ('Paid', '已付款', '已结清') THEN 2
                ELSE 1
            END
        ) ASC, rr.posting_date DESC, rr.name DESC, rii.idx ASC
        LIMIT 1000
    """
    items = frappe.db.sql(sql, params, as_dict=True)
    items = filter_rows_by_doctype_permission(items, "Reimbursement Request", "rr_name")
    return {"companies": companies, "count": len(items), "rows": items}


@frappe.whitelist()
def get_all_reimbursement_request_docs(
    company: str | None = None,
    filters: dict | str | None = None,
) -> dict:
    """Query all Reimbursement Request Documents for '全部整算单' doc view."""
    _assert_stage_access("pi_to_rr", "read")
    companies = _resolve_companies(company)
    if isinstance(filters, str):
        filters = frappe.parse_json(filters) or {}
    filters = dict(filters or {})

    conditions = [
        "rr.company IN %(companies)s",
        "rr.docstatus < 2",
    ]
    params: dict[str, Any] = {"companies": companies}

    if filters.get("supplier"):
        conditions.append("EXISTS (SELECT 1 FROM `tabReimbursement Invoice Item` rii WHERE rii.parent = rr.name AND rii.supplier LIKE %(supplier)s)")
        params["supplier"] = f"%{filters['supplier']}%"
    if filters.get("bill_no"):
        conditions.append("EXISTS (SELECT 1 FROM `tabReimbursement Invoice Item` rii WHERE rii.parent = rr.name AND rii.invoice_no LIKE %(bill_no)s)")
        params["bill_no"] = f"%{filters['bill_no']}%"
    if filters.get("owner"):
        conditions.append("rr.owner LIKE %(owner)s")
        params["owner"] = f"%{filters['owner']}%"

    where_clause = " AND ".join(conditions)
    sql = f"""
        SELECT
            rr.name AS rr_name,
            rr.company,
            COALESCE(rr.employee_name, rr.employee, rr.owner) AS applicant,
            rr.posting_date,
            COALESCE(rr.title, '') AS purpose,
            COALESCE(rr.total_amount, 0) AS total_claim_amount,
            COALESCE(rr.payment_status, 'Submitted') AS status,
            rr.docstatus,
            rr.owner,
            (
                SELECT COUNT(DISTINCT rii.name)
                FROM `tabReimbursement Invoice Item` rii
                WHERE rii.parent = rr.name
            ) AS invoices_count,
            (
                SELECT GROUP_CONCAT(DISTINCT rii.source_pi SEPARATOR '、')
                FROM `tabReimbursement Invoice Item` rii
                WHERE rii.parent = rr.name
            ) AS source_pi_names
        FROM `tabReimbursement Request` rr
        WHERE {where_clause}
        ORDER BY (
            CASE 
                WHEN rr.docstatus = 0 THEN 0
                WHEN rr.status IN ('Paid', '已付款', '已结清', 'Cancelled') OR rr.payment_status IN ('Paid', '已付款', '已结清') THEN 2
                ELSE 1
            END
        ) ASC, rr.posting_date DESC, rr.name DESC
        LIMIT 500
    """
    docs = frappe.db.sql(sql, params, as_dict=True)
    docs = filter_rows_by_doctype_permission(docs, "Reimbursement Request", "rr_name")
    return {"companies": companies, "count": len(docs), "rows": docs}


@frappe.whitelist()
def get_all_payment_entry_references(
    company: str | None = None,
    filters: dict | str | None = None,
) -> dict:
    """Query all Payment Entry References for '全部付款单' detail view."""
    _assert_stage_access("pi_to_pay", "read")
    companies = _resolve_companies(company)
    if isinstance(filters, str):
        filters = frappe.parse_json(filters) or {}
    filters = dict(filters or {})

    conditions = [
        "pe.company IN %(companies)s",
        "pe.docstatus = 1",
        "pe.payment_type = 'Pay'",
    ]
    params: dict[str, Any] = {"companies": companies}

    if filters.get("supplier"):
        conditions.append("pe.party LIKE %(supplier)s")
        params["supplier"] = f"%{filters['supplier']}%"
    if filters.get("owner"):
        conditions.append("pe.owner LIKE %(owner)s")
        params["owner"] = f"%{filters['owner']}%"

    where_clause = " AND ".join(conditions)
    sql = f"""
        SELECT
            per.name AS per_name,
            pe.name AS pe_name,
            pe.company,
            pe.party AS supplier,
            pe.posting_date,
            pe.paid_from,
            per.reference_name,
            COALESCE(pi.bill_no, '') AS bill_no,
            COALESCE(per.total_amount, 0) AS total_amount,
            COALESCE(per.allocated_amount, 0) AS allocated_amount,
            COALESCE(per.outstanding_amount, 0) AS outstanding_amount,
            pe.status,
            pe.docstatus,
            pe.owner
        FROM `tabPayment Entry Reference` per
        INNER JOIN `tabPayment Entry` pe ON pe.name = per.parent
        LEFT JOIN `tabPurchase Invoice` pi ON pi.name = per.reference_name
        WHERE {where_clause}
        ORDER BY (
            CASE 
                WHEN pe.docstatus = 0 THEN 0
                WHEN pe.status IN ('Cancelled') THEN 2
                ELSE 1
            END
        ) ASC, pe.posting_date DESC, pe.name DESC, per.idx ASC
        LIMIT 1000
    """
    items = frappe.db.sql(sql, params, as_dict=True)
    return {"companies": companies, "count": len(items), "rows": items}


# =========================================================================
# Document Details, Preview Cascade Deletion & Safe Deletion APIs
# =========================================================================

ALLOWED_PROCUREMENT_DOCTYPES = [
    "Material Request",
    "Purchase Order",
    "Purchase Receipt",
    "Purchase Invoice",
    "Reimbursement Request",
    "Payment Entry",
]


@frappe.whitelist()
def get_document_details(doctype: str, name: str) -> dict:
    """Retrieve full structured document metadata, line items, and upstream/downstream flow for quick view dialog."""
    if doctype not in ALLOWED_PROCUREMENT_DOCTYPES:
        frappe.throw(_("不支持的单据类型：{0}").format(doctype))

    if not frappe.db.exists(doctype, name):
        frappe.throw(_("单据不存在：{0} {1}").format(doctype, name))

    doc = frappe.get_doc(doctype, name)
    assert_company_access(doc.company)
    if not frappe.has_permission(doctype, "read", doc):
        frappe.throw(_("您没有查看该单据的权限。"), frappe.PermissionError)

    status_str = doc.get("status") or ("Draft" if doc.docstatus == 0 else ("Submitted" if doc.docstatus == 1 else "Cancelled"))
    date_str = str(doc.get("transaction_date") or doc.get("posting_date") or doc.get("bill_date") or doc.creation)[:10]

    # Extract items
    items = []
    total_qty = 0.0
    total_amount = 0.0

    child_field = "items" if hasattr(doc, "items") else ("invoice_items" if hasattr(doc, "invoice_items") else "")
    raw_children = getattr(doc, child_field, []) if child_field else []

    for idx, it in enumerate(raw_children, 1):
        q = flt(it.get("qty") or 1.0, 4)
        r = flt(it.get("rate") or 0.0, 2)
        amt = flt(it.get("amount") or (q * r), 2)
        tax_rate = flt(it.get("custom_tax_rate") or it.get("tax_rate") or 0.0, 2)
        tax_amt = flt(it.get("custom_tax_amount") or it.get("tax_amount") or 0.0, 2)
        tot = flt(it.get("custom_total_amount") or it.get("total_amount") or (amt + tax_amt), 2)

        total_qty += q
        total_amount += (tot if tot > 0 else amt)

        custom_spec, remarks = extract_spec_and_remarks(it)

        items.append({
            "idx": idx,
            "item_code": it.get("item_code") or "",
            "item_name": it.get("item_name") or it.get("item_code") or "",
            "spec": custom_spec,
            "description": remarks,
            "item_group": it.get("item_group") or "",
            "uom": it.get("uom") or it.get("stock_uom") or "",
            "qty": q,
            "rate": r,
            "amount": amt,
            "tax_rate": tax_rate,
            "tax_amount": tax_amt,
            "total_amount": tot,
            "warehouse": it.get("warehouse") or "",
            "schedule_date": str(it.get("schedule_date") or "") if it.get("schedule_date") else "",
        })

    # Flow traceability links
    linked_upstream = []
    linked_downstream = []

    if doctype == "Material Request":
        # Downstream POs
        pos = frappe.db.sql("""
            SELECT DISTINCT poi.parent AS name, po.status, po.docstatus, po.grand_total, po.transaction_date
            FROM `tabPurchase Order Item` poi
            INNER JOIN `tabPurchase Order` po ON po.name = poi.parent
            WHERE poi.material_request = %s AND po.docstatus < 2
            ORDER BY po.transaction_date DESC
        """, (name,), as_dict=True)
        for po in pos:
            linked_downstream.append({
                "doctype": "Purchase Order",
                "doctype_label": "采购订单",
                "name": po.name,
                "status": po.status or ("Draft" if po.docstatus == 0 else "Submitted"),
                "docstatus": po.docstatus,
                "grand_total": flt(po.grand_total, 2),
                "date": str(po.transaction_date or ""),
            })

    elif doctype == "Purchase Order":
        # Upstream MRs
        mr_names = list({it.get("material_request") for it in raw_children if it.get("material_request")})
        for mr_n in mr_names:
            mr_row = frappe.db.get_value("Material Request", mr_n, ["name", "status", "docstatus", "transaction_date"], as_dict=True)
            if mr_row:
                linked_upstream.append({
                    "doctype": "Material Request",
                    "doctype_label": "采购申请单",
                    "name": mr_row.name,
                    "status": mr_row.status or ("Draft" if mr_row.docstatus == 0 else "Submitted"),
                    "docstatus": mr_row.docstatus,
                    "date": str(mr_row.transaction_date or ""),
                })
        # Downstream PRs
        prs = frappe.db.sql("""
            SELECT DISTINCT pri.parent AS name, pr.status, pr.docstatus, pr.grand_total, pr.posting_date
            FROM `tabPurchase Receipt Item` pri
            INNER JOIN `tabPurchase Receipt` pr ON pr.name = pri.parent
            WHERE pri.purchase_order = %s AND pr.docstatus < 2
            ORDER BY pr.posting_date DESC
        """, (name,), as_dict=True)
        for pr in prs:
            linked_downstream.append({
                "doctype": "Purchase Receipt",
                "doctype_label": "采购入库单",
                "name": pr.name,
                "status": pr.status or ("Draft" if pr.docstatus == 0 else "Submitted"),
                "docstatus": pr.docstatus,
                "grand_total": flt(pr.grand_total, 2),
                "date": str(pr.posting_date or ""),
            })

    elif doctype == "Purchase Receipt":
        # Upstream POs
        po_names = list({it.get("purchase_order") for it in raw_children if it.get("purchase_order")})
        for po_n in po_names:
            po_row = frappe.db.get_value("Purchase Order", po_n, ["name", "status", "docstatus", "grand_total", "transaction_date"], as_dict=True)
            if po_row:
                linked_upstream.append({
                    "doctype": "Purchase Order",
                    "doctype_label": "采购订单",
                    "name": po_row.name,
                    "status": po_row.status or ("Draft" if po_row.docstatus == 0 else "Submitted"),
                    "docstatus": po_row.docstatus,
                    "grand_total": flt(po_row.grand_total, 2),
                    "date": str(po_row.transaction_date or ""),
                })
        # Downstream PIs
        pis = frappe.db.sql("""
            SELECT DISTINCT pii.parent AS name, pi.status, pi.docstatus, pi.grand_total, pi.posting_date
            FROM `tabPurchase Invoice Item` pii
            INNER JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent
            WHERE pii.purchase_receipt = %s AND pi.docstatus < 2
            ORDER BY pi.posting_date DESC
        """, (name,), as_dict=True)
        for pi in pis:
            linked_downstream.append({
                "doctype": "Purchase Invoice",
                "doctype_label": "采购发票",
                "name": pi.name,
                "status": pi.status or ("Draft" if pi.docstatus == 0 else "Submitted"),
                "docstatus": pi.docstatus,
                "grand_total": flt(pi.grand_total, 2),
                "date": str(pi.posting_date or ""),
            })

    elif doctype == "Purchase Invoice":
        # Upstream PRs
        pr_names = list({it.get("purchase_receipt") for it in raw_children if it.get("purchase_receipt")})
        for pr_n in pr_names:
            pr_row = frappe.db.get_value("Purchase Receipt", pr_n, ["name", "status", "docstatus", "grand_total", "posting_date"], as_dict=True)
            if pr_row:
                linked_upstream.append({
                    "doctype": "Purchase Receipt",
                    "doctype_label": "采购入库单",
                    "name": pr_row.name,
                    "status": pr_row.status or ("Draft" if pr_row.docstatus == 0 else "Submitted"),
                    "docstatus": pr_row.docstatus,
                    "grand_total": flt(pr_row.grand_total, 2),
                    "date": str(pr_row.posting_date or ""),
                })
        # Downstream RRs
        rrs = frappe.db.sql("""
            SELECT DISTINCT rii.parent AS name, rr.docstatus, rr.total_amount, rr.posting_date
            FROM `tabReimbursement Invoice Item` rii
            INNER JOIN `tabReimbursement Request` rr ON rr.name = rii.parent
            WHERE rii.source_pi = %s AND rr.docstatus < 2
            ORDER BY rr.posting_date DESC
        """, (name,), as_dict=True)
        for rr in rrs:
            linked_downstream.append({
                "doctype": "Reimbursement Request",
                "doctype_label": "报销申请单",
                "name": rr.name,
                "status": "Draft" if rr.docstatus == 0 else "Submitted",
                "docstatus": rr.docstatus,
                "grand_total": flt(rr.total_amount, 2),
                "date": str(rr.posting_date or ""),
            })

    elif doctype == "Reimbursement Request":
        # Upstream PIs
        pi_names = list({it.get("source_pi") for it in raw_children if it.get("source_pi")})
        for pi_n in pi_names:
            pi_row = frappe.db.get_value("Purchase Invoice", pi_n, ["name", "status", "docstatus", "grand_total", "posting_date"], as_dict=True)
            if pi_row:
                linked_upstream.append({
                    "doctype": "Purchase Invoice",
                    "doctype_label": "采购发票",
                    "name": pi_row.name,
                    "status": pi_row.status or ("Draft" if pi_row.docstatus == 0 else "Submitted"),
                    "docstatus": pi_row.docstatus,
                    "grand_total": flt(pi_row.grand_total, 2),
                    "date": str(pi_row.posting_date or ""),
                })

    is_draft = cint(doc.docstatus) == 0
    can_write = frappe.has_permission(doctype, "write", doc)
    # Submitted procurement documents are financial / inventory evidence.
    # They must remain read-only in the picker and cannot be deleted in place.
    can_delete = is_draft and _is_procurement_manager() and frappe.has_permission(doctype, "delete", doc)
    can_cancel = frappe.has_permission(doctype, "cancel", doc) if doc.docstatus == 1 else True
    can_quick_edit = False
    if is_draft and doctype in ("Material Request", "Purchase Order") and not linked_downstream and can_write:
        can_quick_edit = True

    return {
        "doctype": doctype,
        "name": name,
        "company": doc.company,
        "docstatus": doc.docstatus,
        "status": status_str,
        "date": date_str,
        "schedule_date": str(doc.get("schedule_date") or ""),
        "owner": doc.owner,
        "supplier": doc.get("supplier") or "",
        "department": doc.get("department") or "",
        "bill_no": doc.get("bill_no") or "",
        "grand_total": flt(doc.get("grand_total") or total_amount, 2),
        "total_qty": flt(total_qty, 2),
        "currency": doc.get("currency") or "CNY",
        "custom_doc_details": doc.get("custom_doc_details") or "",
        "items": items,
        "linked_upstream": linked_upstream,
        "linked_downstream": linked_downstream,
        "can_write": can_write,
        "can_delete": can_delete,
        "can_cancel": can_cancel,
        "can_quick_edit": can_quick_edit,
    }


@frappe.whitelist()
def preview_document_cascade_deletion(doctype: str, name: str) -> dict:
    """Analyze full downstream dependency tree for cascading deletion and verify user permissions."""
    if not _is_procurement_manager():
        frappe.throw(_("只有采购管理人员可以删除采购流程单据。"), frappe.PermissionError)

    if doctype not in ALLOWED_PROCUREMENT_DOCTYPES:
        frappe.throw(_("不支持的单据类型：{0}").format(doctype))

    if not frappe.db.exists(doctype, name):
        frappe.throw(_("单据不存在：{0} {1}").format(doctype, name))

    root_doc = frappe.get_doc(doctype, name)
    assert_company_access(root_doc.company)

    # Collect all downstream documents
    tree_docs: list[tuple[str, str]] = []  # List of (doctype, name) in forward order
    visited = set()

    def trace_downstream(cur_dt: str, cur_nm: str):
        key = (cur_dt, cur_nm)
        if key in visited:
            return
        visited.add(key)
        tree_docs.append(key)

        if cur_dt == "Material Request":
            pos = frappe.db.sql_list("""
                SELECT DISTINCT poi.parent
                FROM `tabPurchase Order Item` poi
                INNER JOIN `tabPurchase Order` po ON po.name = poi.parent
                WHERE poi.material_request = %s AND po.docstatus < 2
            """, (cur_nm,))
            for po_n in pos:
                trace_downstream("Purchase Order", po_n)

        elif cur_dt == "Purchase Order":
            prs = frappe.db.sql_list("""
                SELECT DISTINCT pri.parent
                FROM `tabPurchase Receipt Item` pri
                INNER JOIN `tabPurchase Receipt` pr ON pr.name = pri.parent
                WHERE pri.purchase_order = %s AND pr.docstatus < 2
            """, (cur_nm,))
            for pr_n in prs:
                trace_downstream("Purchase Receipt", pr_n)

            pis = frappe.db.sql_list("""
                SELECT DISTINCT pii.parent
                FROM `tabPurchase Invoice Item` pii
                INNER JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent
                WHERE pii.purchase_order = %s AND pi.docstatus < 2
            """, (cur_nm,))
            for pi_n in pis:
                trace_downstream("Purchase Invoice", pi_n)

        elif cur_dt == "Purchase Receipt":
            pis = frappe.db.sql_list("""
                SELECT DISTINCT pii.parent
                FROM `tabPurchase Invoice Item` pii
                INNER JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent
                WHERE pii.purchase_receipt = %s AND pi.docstatus < 2
            """, (cur_nm,))
            for pi_n in pis:
                trace_downstream("Purchase Invoice", pi_n)

        elif cur_dt == "Purchase Invoice":
            # 1. Reimbursement Request
            rrs = frappe.db.sql_list("""
                SELECT DISTINCT rii.parent
                FROM `tabReimbursement Invoice Item` rii
                INNER JOIN `tabReimbursement Request` rr ON rr.name = rii.parent
                WHERE rii.source_pi = %s AND rr.docstatus < 2
            """, (cur_nm,))
            for rr_n in rrs:
                trace_downstream("Reimbursement Request", rr_n)

            # 2. Payment Entry
            pes = frappe.db.sql_list("""
                SELECT DISTINCT per.parent
                FROM `tabPayment Entry Reference` per
                INNER JOIN `tabPayment Entry` pe ON pe.name = per.parent
                WHERE per.reference_doctype = 'Purchase Invoice'
                  AND per.reference_name = %s
                  AND pe.docstatus < 2
            """, (cur_nm,))
            for pe_n in pes:
                trace_downstream("Payment Entry", pe_n)

        elif cur_dt == "Reimbursement Request":
            pes = frappe.db.sql_list("""
                SELECT DISTINCT per.parent
                FROM `tabPayment Entry Reference` per
                INNER JOIN `tabPayment Entry` pe ON pe.name = per.parent
                WHERE per.reference_doctype = 'Reimbursement Request'
                  AND per.reference_name = %s
                  AND pe.docstatus < 2
            """, (cur_nm,))
            for pe_n in pes:
                trace_downstream("Payment Entry", pe_n)

    trace_downstream(doctype, name)

    # Reverse order for safe deletion: PE -> RR -> PI -> PR -> PO -> MR
    reverse_order_keys = list(reversed(tree_docs))

    doctype_labels = {
        "Material Request": "采购申请单",
        "Purchase Order": "采购订单",
        "Purchase Receipt": "采购入库单",
        "Purchase Invoice": "采购发票",
        "Reimbursement Request": "报销申请单",
        "Payment Entry": "付款凭单",
    }

    cascade_list = []
    missing_permissions = []

    for dt, nm in reverse_order_keys:
        d = frappe.get_doc(dt, nm)
        has_del = frappe.has_permission(dt, "delete", d)
        has_cancel = frappe.has_permission(dt, "cancel", d) if d.docstatus == 1 else True

        dt_label = doctype_labels.get(dt, dt)
        status_text = "草稿 (待删除)" if d.docstatus == 0 else ("已提交 (需先撤单后删除)" if d.docstatus == 1 else "已取消 (待删除)")

        if not has_del:
            missing_permissions.append(f"【{dt_label}】{nm} (缺少删除权限)")
        if not has_cancel:
            missing_permissions.append(f"【{dt_label}】{nm} (缺少撤单权限)")

        cascade_list.append({
            "doctype": dt,
            "doctype_label": dt_label,
            "name": nm,
            "company": d.company,
            "docstatus": d.docstatus,
            "status_text": status_text,
            "grand_total": flt(d.get("grand_total") or d.get("total_amount") or d.get("total") or 0.0, 2),
            "supplier": d.get("supplier") or d.get("department") or "",
            "has_permission": bool(has_del and has_cancel),
        })

    has_downstream = len(cascade_list) > 1

    return {
        "target_doc": {
            "doctype": doctype,
            "doctype_label": doctype_labels.get(doctype, doctype),
            "name": name,
            "docstatus": root_doc.docstatus,
        },
        "has_downstream": has_downstream,
        "cascade_count": len(cascade_list),
        "cascade_list": cascade_list,
        "can_delete": len(missing_permissions) == 0,
        "missing_permissions": missing_permissions,
    }


@frappe.whitelist(methods=["POST"])
def delete_procurement_document(doctype: str, name: str, cascade: bool | int | str = False) -> dict:
    """Execute safe deletion of a single procurement document or full reverse cascade deletion."""
    cascade = frappe.utils.cint(cascade) == 1

    preview = preview_document_cascade_deletion(doctype, name)
    if not preview["can_delete"]:
        frappe.throw(
            _("权限不足，无法执行删除操作。缺少以下单据的删除/撤单权限：<br>{0}").format("<br>".join(preview["missing_permissions"]))
        )

    if preview["has_downstream"] and not cascade:
        frappe.throw(_("该单据已生成下游关联单据，无法直接单独删除。请选择【连带级联删除】。"))

    # Execute reverse deletion inside a transaction
    deleted_docs = []
    for item in preview["cascade_list"]:
        item_dt = item["doctype"]
        item_nm = item["name"]

        if not frappe.db.exists(item_dt, item_nm):
            continue

        doc_to_del = frappe.get_doc(item_dt, item_nm)

        # 1. Release reimbursement reservation if any
        if item_dt == "Purchase Invoice" and frappe.db.exists("DocType", "Reimbursement Source Reservation"):
            frappe.db.delete("Reimbursement Source Reservation", {"source_purchase_invoice": item_nm})
        elif item_dt == "Reimbursement Request" and frappe.db.exists("DocType", "Reimbursement Source Reservation"):
            frappe.db.delete("Reimbursement Source Reservation", {"voucher_no": item_nm})

        # 2. Cancel if submitted
        if doc_to_del.docstatus == 1:
            doc_to_del.flags.ignore_permissions = False
            doc_to_del.cancel()

        # 3. Delete doc
        frappe.delete_doc(item_dt, item_nm, force=1, ignore_permissions=False)
        deleted_docs.append(f"{item['doctype_label']} {item_nm}")

    frappe.db.commit()

    return {
        "success": True,
        "deleted_count": len(deleted_docs),
        "deleted_docs": deleted_docs,
        "message": _("成功删除 {0} 张单据：<br>{1}").format(len(deleted_docs), "<br>".join(deleted_docs)),
    }


@frappe.whitelist(methods=["POST"])
def batch_delete_procurement_documents(doctype: str, names: list[str] | str, cascade: bool | int | str = True) -> dict:
    """Safely delete multiple procurement documents in a single transaction, returning a structured summary."""
    if not _is_procurement_manager():
        frappe.throw(_("只有采购管理人员可以批量删除采购流程单据。"), frappe.PermissionError)

    if isinstance(names, str):
        names = frappe.parse_json(names) or []

    if not names:
        frappe.throw(_("请指定需要删除的单据列表。"))

    cascade = frappe.utils.cint(cascade) == 1
    docnames = list(dict.fromkeys(names))
    success_docs = []
    fail_docs = []

    for nm in docnames:
        if not frappe.db.exists(doctype, nm):
            continue
        try:
            res = delete_procurement_document(doctype, nm, cascade=cascade)
            success_docs.append(nm)
        except Exception as e:
            frappe.db.rollback()
            # Capture specific exception message
            err_msg = str(getattr(e, "message", "") or e)
            fail_docs.append({"name": nm, "error": err_msg})

    return {
        "success": len(fail_docs) == 0,
        "total_count": len(docnames),
        "success_count": len(success_docs),
        "success_names": success_docs,
        "fail_count": len(fail_docs),
        "failures": fail_docs,
    }
