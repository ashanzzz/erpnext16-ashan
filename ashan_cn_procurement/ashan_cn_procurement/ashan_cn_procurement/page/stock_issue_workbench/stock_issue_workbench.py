# ASHAN-COMPLETE: stock read permissions and explicit review-before-post default
# -*- coding: utf-8 -*-
# Copyright (c) 2026, Ashan CN Procurement and contributors
# 材料出库工作台 (Stock Issue Workbench) - 服务端服务层

import json
from datetime import datetime
import frappe
from frappe.utils import flt, nowdate, getdate, formatdate

from ashan_cn_procurement.services.permission_query_service import (
    assert_doctype_permission,
    filter_rows_by_doctype_permission,
)
from ashan_cn_procurement.services.authorization_service import (
    assert_company_access,
    get_allowed_companies,
)


def get_current_user_company() -> str:
    """获取当前用户上下文选定的公司"""
    user_default = frappe.db.get_value("User Permission", {"user": frappe.session.user, "allow": "Company"}, "for_value")
    if user_default:
        return user_default
    sys_default = frappe.db.get_single_value("Global Defaults", "default_company")
    if sys_default:
        return sys_default
    return ""


def _warehouse_lineage(warehouse: str) -> list[str]:
    """Return the warehouse and its parent path without assuming a company field."""
    lineage: list[str] = []
    current = warehouse
    while current and current not in lineage:
        lineage.append(current)
        current = frappe.db.get_value("Warehouse", current, "parent_warehouse") or ""
    return lineage


def _get_warehouse_company(warehouse: str, strict: bool = True) -> str:
    """Resolve a warehouse owner from a stored company or immutable stock history."""
    if not frappe.db.exists("Warehouse", warehouse):
        frappe.throw("发货仓库不存在。", frappe.DoesNotExistError)

    if frappe.db.has_column("Warehouse", "company"):
        company = frappe.db.get_value("Warehouse", warehouse, "company")
        if company:
            return str(company)

    candidates = set()
    lineage = _warehouse_lineage(warehouse)
    if frappe.db.has_column("Company", "default_warehouse"):
        default_companies = frappe.get_all(
            "Company",
            filters={"default_warehouse": ["in", lineage]},
            pluck="name",
            order_by="name asc",
        )
        candidates.update(str(company) for company in default_companies if company)

    if frappe.db.has_column("Stock Ledger Entry", "company"):
        ledger_companies = frappe.db.sql(
            """
            SELECT DISTINCT company
            FROM `tabStock Ledger Entry`
            WHERE warehouse = %s AND IFNULL(company, '') != ''
            ORDER BY company ASC
            LIMIT 2
            """,
            (warehouse,),
            pluck="company",
        )
        candidates.update(str(company) for company in ledger_companies if company)

    if len(candidates) == 1:
        return candidates.pop()
    if strict:
        frappe.throw(
            "无法从仓库主数据或库存流水确定所属公司，已拒绝库存访问。",
            frappe.PermissionError,
        )
    return ""


def _get_company_warehouses(company: str) -> list[dict]:
    """Return only warehouses whose persisted ownership resolves to the requested company."""
    filters = {"is_group": 0, "disabled": 0}
    if frappe.db.has_column("Warehouse", "company"):
        filters["company"] = company
        return frappe.get_all(
            "Warehouse",
            filters=filters,
            fields=["name", "warehouse_name"],
            order_by="name asc",
        )

    warehouses = frappe.get_all(
        "Warehouse",
        filters=filters,
        fields=["name", "warehouse_name"],
        order_by="name asc",
    )
    return [
        warehouse
        for warehouse in warehouses
        if _get_warehouse_company(warehouse.name, strict=False) == company
    ]


def _assert_warehouse_company(company: str, warehouse: str) -> str:
    """Bind a warehouse request to its persisted company before reading stock."""
    warehouse_company = _get_warehouse_company(warehouse)
    if warehouse_company != company:
        frappe.throw("发货仓库不属于所选公司，已拒绝跨公司库存访问。", frappe.PermissionError)
    assert_company_access(warehouse_company)
    return warehouse_company


@frappe.whitelist()
def get_stock_issue_meta(company: str | None = None) -> dict:
    """获取材料出库工作台元数据（公司、发货仓库、领用部门等）"""
    assert_doctype_permission("Stock Entry", "read")
    allowed_companies = get_allowed_companies()
    company_filters = {"name": ["in", sorted(allowed_companies)]} if allowed_companies is not None else {}
    all_companies = [
        c.name for c in frappe.get_all("Company", filters=company_filters, fields=["name"], order_by="name asc")
    ]
    if not all_companies:
        frappe.throw("当前账号未配置可访问的公司范围。", frappe.PermissionError)

    selected_company = company or get_current_user_company()
    if selected_company not in all_companies and all_companies:
        selected_company = all_companies[0]

    assert_company_access(selected_company)

    warehouses = _get_company_warehouses(selected_company)

    departments = frappe.get_all(
        "Department",
        filters={"company": selected_company, "is_group": 0, "disabled": 0},
        fields=["name", "department_name"],
        order_by="name asc",
        limit=50,
    )

    # 常用领料用途
    purposes = [
        {"value": "Material Issue", "label": "材料出库 / 车间领料"},
        {"value": "Manufacture", "label": "生产领料 / 制造消耗"},
        {"value": "Material Transfer", "label": "仓库调拨出库"},
    ]

    return {
        "selected_company": selected_company,
        "companies": all_companies,
        "warehouses": [{"name": w.name, "warehouse_name": w.warehouse_name or w.name} for w in warehouses],
        "departments": [{"name": d.name, "department_name": d.department_name or d.name} for d in departments],
        "purposes": purposes,
    }


@frappe.whitelist()
def get_stock_issue_kpis(company: str | None = None, from_date: str | None = None, to_date: str | None = None) -> dict:
    """计算材料出库决策 KPI 指标卡"""
    assert_doctype_permission("Stock Entry", "read")
    comp = company or get_current_user_company()
    assert_company_access(comp)

    today = nowdate()
    start_date = from_date or frappe.utils.get_first_day(today)
    end_date = to_date or today

    # 1. 今日出库单数与数量 (已过账)
    today_data = frappe.db.sql(
        """
        SELECT 
            COUNT(DISTINCT se.name) AS count,
            COALESCE(SUM(sed.qty), 0) AS total_qty
        FROM `tabStock Entry` se
        JOIN `tabStock Entry Detail` sed ON sed.parent = se.name
        WHERE se.company = %s
          AND se.docstatus = 1
          AND se.posting_date = %s
          AND se.purpose IN ('Material Issue', 'Manufacture', 'Material Transfer')
        """,
        (comp, today),
        as_dict=True,
    )[0]

    # 2. 本期累计出库单数与数量 (已过账)
    period_data = frappe.db.sql(
        """
        SELECT 
            COUNT(DISTINCT se.name) AS count,
            COALESCE(SUM(sed.qty), 0) AS total_qty,
            COUNT(DISTINCT sed.item_code) AS distinct_items
        FROM `tabStock Entry` se
        JOIN `tabStock Entry Detail` sed ON sed.parent = se.name
        WHERE se.company = %s
          AND se.docstatus = 1
          AND se.posting_date BETWEEN %s AND %s
          AND se.purpose IN ('Material Issue', 'Manufacture', 'Material Transfer')
        """,
        (comp, start_date, end_date),
        as_dict=True,
    )[0]

    # 3. 待提交草稿单数 (docstatus = 0)
    draft_data = frappe.db.sql(
        """
        SELECT COUNT(se.name) AS count
        FROM `tabStock Entry` se
        WHERE se.company = %s
          AND se.docstatus = 0
          AND se.purpose IN ('Material Issue', 'Manufacture', 'Material Transfer')
        """,
        (comp,),
        as_dict=True,
    )[0]

    return {
        "today_count": int(today_data.get("count") or 0),
        "today_qty": flt(today_data.get("total_qty") or 0),
        "period_count": int(period_data.get("count") or 0),
        "period_qty": flt(period_data.get("total_qty") or 0),
        "period_distinct_items": int(period_data.get("distinct_items") or 0),
        "draft_count": int(draft_data.get("count") or 0),
    }


@frappe.whitelist()
def get_stock_issue_list(
    company: str | None = None,
    status: str = "all",
    warehouse: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    search_text: str | None = None,
    page_index: int | str = 1,
    page_size: int | str = 50,
) -> dict:
    """
    获取材料出库列表（支持3梯队状态排序、多维筛选与分页）
    """
    assert_doctype_permission("Stock Entry", "read")
    comp = company or get_current_user_company()
    assert_company_access(comp)

    page_idx = max(int(page_index or 1), 1)
    p_size = min(max(int(page_size or 50), 10), 200)
    offset = (page_idx - 1) * p_size

    conditions = ["se.company = %(company)s", "se.purpose IN ('Material Issue', 'Manufacture', 'Material Transfer')"]
    params = {"company": comp}

    # 状态过滤
    if status == "draft":
        conditions.append("se.docstatus = 0")
    elif status == "submitted":
        conditions.append("se.docstatus = 1")
    elif status == "cancelled":
        conditions.append("se.docstatus = 2")

    # 仓库过滤
    if warehouse and warehouse not in ("全部仓库", "All", "All Warehouses", ""):
        _assert_warehouse_company(comp, warehouse)
        conditions.append("EXISTS (SELECT 1 FROM `tabStock Entry Detail` sed_wh WHERE sed_wh.parent = se.name AND sed_wh.s_warehouse = %(warehouse)s)")
        params["warehouse"] = warehouse

    # 日期范围
    if from_date:
        conditions.append("se.posting_date >= %(from_date)s")
        params["from_date"] = from_date
    if to_date:
        conditions.append("se.posting_date <= %(to_date)s")
        params["to_date"] = to_date

    # 搜索文本（单据号、物料编码、物料名称、备注）
    if search_text and search_text.strip():
        st = f"%{search_text.strip()}%"
        conditions.append("""
            (
                se.name LIKE %(st)s
                OR se.remarks LIKE %(st)s
                OR EXISTS (
                    SELECT 1 FROM `tabStock Entry Detail` sed_st 
                    WHERE sed_st.parent = se.name 
                      AND (sed_st.item_code LIKE %(st)s OR sed_st.item_name LIKE %(st)s)
                )
            )
        """)
        params["st"] = st

    where_clause = " AND ".join(conditions)

    # 1. 统计总数
    count_sql = f"""
        SELECT COUNT(se.name) AS total
        FROM `tabStock Entry` se
        WHERE {where_clause}
    """
    total_records = frappe.db.sql(count_sql, params, as_dict=True)[0].get("total", 0)

    # 2. 3梯队全生命周期排序铁律：草稿置顶 -> 已提交倒序 -> 已作废沉底
    query_sql = f"""
        SELECT 
            se.name,
            se.docstatus,
            se.posting_date,
            se.posting_time,
            se.purpose,
            se.remarks,
            se.owner,
            se.creation,
            (
                CASE 
                    WHEN se.docstatus = 0 THEN '待提交草稿'
                    WHEN se.docstatus = 1 THEN '已过账生效'
                    ELSE '已作废'
                END
            ) AS status_label,
            (
                CASE 
                    WHEN se.docstatus = 0 THEN 'draft'
                    WHEN se.docstatus = 1 THEN 'submitted'
                    ELSE 'cancelled'
                END
            ) AS status_class,
            (
                CASE 
                    WHEN se.purpose = 'Manufacture' THEN '生产领料 / 制造'
                    WHEN se.purpose = 'Material Transfer' THEN '仓库调拨出库'
                    ELSE '材料出库 / 领料'
                END
            ) AS purpose_label
        FROM `tabStock Entry` se
        WHERE {where_clause}
        ORDER BY (
            CASE 
                WHEN se.docstatus = 0 THEN 0
                WHEN se.docstatus = 1 THEN 1
                ELSE 2
            END
        ) ASC, se.posting_date DESC, se.creation DESC
        LIMIT {p_size} OFFSET {offset}
    """
    records = frappe.db.sql(query_sql, params, as_dict=True)
    records = filter_rows_by_doctype_permission(records, "Stock Entry", "name")

    # 3. 关联查询各出库单的行项目明细摘要与实时库存
    if records:
        entry_names = [r.name for r in records]
        item_details = frappe.db.sql(
            """
            SELECT 
                parent,
                item_code,
                item_name,
                s_warehouse,
                qty,
                stock_uom
            FROM `tabStock Entry Detail`
            WHERE parent IN %s
            ORDER BY idx ASC
            """,
            (tuple(entry_names),),
            as_dict=True,
        )

        detail_map = {}
        wh_item_pairs = set()
        for d in item_details:
            detail_map.setdefault(d.parent, []).append(d)
            if d.s_warehouse and d.item_code:
                wh_item_pairs.add((d.s_warehouse, d.item_code))

        # 批量获取当前实时库存
        bin_map = {}
        if wh_item_pairs:
            warehouses = list({pair[0] for pair in wh_item_pairs})
            item_codes = list({pair[1] for pair in wh_item_pairs})
            bins = frappe.db.sql(
                """
                SELECT warehouse, item_code, actual_qty, stock_uom
                FROM `tabBin`
                WHERE warehouse IN %s AND item_code IN %s
                """,
                (tuple(warehouses), tuple(item_codes)),
                as_dict=True,
            )
            for b in bins:
                bin_map[(b.warehouse, b.item_code)] = flt(b.actual_qty)

        for r in records:
            items = detail_map.get(r.name, [])
            r["items_count"] = len(items)
            r["s_warehouse"] = items[0].s_warehouse if items else "-"
            
            # 区分单一计量单位 vs 异构多计量单位
            uom_set = {it.stock_uom for it in items if it.stock_uom}
            if len(uom_set) <= 1:
                uom = list(uom_set)[0] if uom_set else "Nos"
                total_qty = sum(flt(it.qty) for it in items)
                r["is_single_uom"] = 1
                r["stock_uom"] = uom
                r["total_qty"] = total_qty
                r["qty_display"] = f"-{total_qty:.2f} {uom}"
                
                if len(items) == 1:
                    it = items[0]
                    cur_bal = bin_map.get((it.s_warehouse, it.item_code), 0.0)
                    r["current_stock_display"] = f"{cur_bal:.2f} {uom}"
                    r["current_stock_tooltip"] = f"{it.item_name or it.item_code} 当前发货仓现存: {cur_bal:.2f} {uom}"
                else:
                    r["current_stock_display"] = f"共 {len(items)} 项库存"
                    r["current_stock_tooltip"] = " | ".join([f"{it.item_name or it.item_code}: {bin_map.get((it.s_warehouse, it.item_code), 0.0):.2f}{it.stock_uom}" for it in items])
            else:
                # 包含多种不同计量单位（如 10 Nos + 50 Kg，严禁直接数学相加！）
                r["is_single_uom"] = 0
                r["stock_uom"] = "多单位"
                r["total_qty"] = sum(flt(it.qty) for it in items)
                qty_parts = [f"{flt(it.qty):.2f}{it.stock_uom}" for it in items[:2]]
                r["qty_display"] = f"共 {len(items)} 种 (" + " / ".join(qty_parts) + (f"...)" if len(items) > 2 else ")")
                
                r["current_stock_display"] = f"共 {len(items)} 种物料现存"
                r["current_stock_tooltip"] = " | ".join([f"{it.item_name or it.item_code}: {bin_map.get((it.s_warehouse, it.item_code), 0.0):.2f}{it.stock_uom}" for it in items])

            # 组装明细摘要
            if items:
                summary_parts = [f"{it.item_name or it.item_code} ({flt(it.qty):.2f}{it.stock_uom})" for it in items[:3]]
                if len(items) > 3:
                    summary_parts.append(f"等共 {len(items)} 项")
                r["items_summary"] = "、".join(summary_parts)
            else:
                r["items_summary"] = "暂无明细"

            # 格式化时间
            p_time = str(r.posting_time or "")
            if "." in p_time:
                r["posting_time"] = p_time.split(".")[0]

    return {
        "records": records,
        "total_records": total_records,
        "page_index": page_idx,
        "page_size": p_size,
        "total_pages": (total_records + p_size - 1) // p_size if total_records > 0 else 1,
    }


@frappe.whitelist()
def get_company_stock_inventory(
    company: str,
    warehouse: str | None = None,
    search_text: str | None = None,
    page_index: int | str = 1,
    page_size: int | str = 50,
) -> dict:
    """
    查询指定公司的全量现存实物库存底册（支持选料出库）：
    默认只返回 actual_qty > 0.0001 的物料，附带物料编码、物料名称、规格型号、所在仓库、主计量单位、实际结存与估值。
    """
    assert_doctype_permission("Item", "read")
    if not company:
        company = get_current_user_company()
    assert_company_access(company)
    if warehouse and warehouse not in ("全部仓库", "All Warehouses", ""):
        _assert_warehouse_company(company, warehouse)

    page_idx = max(int(page_index or 1), 1)
    p_size = max(int(page_size or 50), 1)
    offset = (page_idx - 1) * p_size

    conditions = [
        "w.company = %s",
        "w.is_group = 0",
        "w.disabled = 0",
        "i.disabled = 0",
        "b.actual_qty > 0.0001",
    ]
    params = [company]

    if warehouse and warehouse not in ("全部仓库", "All Warehouses", ""):
        conditions.append("b.warehouse = %s")
        params.append(warehouse)

    txt = (search_text or "").strip()
    if txt:
        conditions.append("(b.item_code LIKE %s OR i.item_name LIKE %s OR i.description LIKE %s OR b.warehouse LIKE %s)")
        like_txt = f"%{txt}%"
        params.extend([like_txt, like_txt, like_txt, like_txt])

    where_clause = " AND ".join(conditions)

    count_sql = f"""
        SELECT 
            COUNT(b.name) AS total_count,
            COALESCE(SUM(b.actual_qty), 0) AS total_qty
        FROM `tabBin` b
        INNER JOIN `tabItem` i ON i.name = b.item_code
        INNER JOIN `tabWarehouse` w ON w.name = b.warehouse
        WHERE {where_clause}
    """
    count_res = frappe.db.sql(count_sql, params, as_dict=True)[0]
    total_records = count_res.total_count or 0
    total_stock_qty = count_res.total_qty or 0.0

    sql = f"""
        SELECT 
            b.name AS bin_name,
            b.item_code,
            i.item_name,
            i.description,
            i.item_group,
            b.warehouse,
            w.warehouse_name,
            COALESCE(b.stock_uom, i.stock_uom, 'Nos') AS stock_uom,
            COALESCE(b.actual_qty, 0) AS actual_qty,
            COALESCE(b.valuation_rate, 0) AS valuation_rate
        FROM `tabBin` b
        INNER JOIN `tabItem` i ON i.name = b.item_code
        INNER JOIN `tabWarehouse` w ON w.name = b.warehouse
        WHERE {where_clause}
        ORDER BY b.actual_qty DESC, b.item_code ASC
        LIMIT %s OFFSET %s
    """
    records_params = list(params)
    records_params.extend([p_size, offset])
    records = frappe.db.sql(sql, records_params, as_dict=True)

    return {
        "records": records,
        "total_records": total_records,
        "total_stock_qty": total_stock_qty,
        "page_index": page_idx,
        "page_size": p_size,
        "total_pages": (total_records + p_size - 1) // p_size if total_records > 0 else 1,
    }


@frappe.whitelist()
def get_warehouse_stock_items(
    company: str,
    warehouse: str,
    search_text: str | None = None,
    only_positive_stock: int | str = 1,
) -> list[dict]:
    """
    查询选定发货仓内的实存物料清单：
    默认只返回 actual_qty > 0 的物料，附带物料编码、物料名称、规格型号、主计量单位及当前实存。
    按库存量倒序及物料编码排序，专供出库极速选单与智能补全。
    """
    assert_doctype_permission("Item", "read")
    if not company or not warehouse:
        return []

    assert_company_access(company)
    _assert_warehouse_company(company, warehouse)

    only_pos = str(only_positive_stock).strip() in ("1", "true", "True")
    txt = (search_text or "").strip()

    conditions = ["b.warehouse = %s", "i.disabled = 0"]
    params = [warehouse]

    if only_pos:
        conditions.append("b.actual_qty > 0.0001")

    if txt:
        conditions.append("(b.item_code LIKE %s OR i.item_name LIKE %s OR i.description LIKE %s)")
        like_txt = f"%{txt}%"
        params.extend([like_txt, like_txt, like_txt])

    where_clause = " AND ".join(conditions)

    sql = f"""
        SELECT 
            b.item_code,
            i.item_name,
            i.description,
            COALESCE(b.stock_uom, i.stock_uom, 'Nos') AS stock_uom,
            COALESCE(b.actual_qty, 0) AS actual_qty
        FROM `tabBin` b
        INNER JOIN `tabItem` i ON i.name = b.item_code
        WHERE {where_clause}
        ORDER BY b.actual_qty DESC, b.item_code ASC
        LIMIT 100
    """

    records = frappe.db.sql(sql, params, as_dict=True)

    # 如果指定关键词搜索且允许0库存但无结果时，回退检索全量物料主数据
    if not records and txt and not only_pos:
        items = frappe.get_all(
            "Item",
            filters=[
                ["disabled", "=", 0],
                ["is_stock_item", "=", 1],
                ["item_code", "like", f"%{txt}%"],
            ],
            fields=["name as item_code", "item_name", "description", "stock_uom"],
            limit=20,
        )
        for it in items:
            it["actual_qty"] = 0.0
            records.append(it)

    return records


@frappe.whitelist()
def get_item_stock_balance(company: str, warehouse: str, item_code: str) -> dict:
    """查询指定物料在发货仓的实时可用账面结存"""
    assert_doctype_permission("Item", "read")
    if not company or not warehouse or not item_code:
        return {"actual_qty": 0.0, "stock_uom": "Nos"}

    assert_company_access(company)
    _assert_warehouse_company(company, warehouse)

    bin_data = frappe.db.get_value(
        "Bin",
        {"warehouse": warehouse, "item_code": item_code},
        ["actual_qty", "stock_uom"],
        as_dict=True,
    )

    if bin_data:
        return {
            "actual_qty": flt(bin_data.actual_qty),
            "stock_uom": bin_data.stock_uom or "Nos",
        }

    # 从 Item 获取 stock_uom
    uom = frappe.db.get_value("Item", item_code, "stock_uom") or "Nos"
    return {"actual_qty": 0.0, "stock_uom": uom}


@frappe.whitelist(methods=["POST"])
def create_stock_issue(
    company: str,
    warehouse: str,
    posting_date: str | None = None,
    purpose: str = "Material Issue",
    department: str | None = None,
    remarks: str | None = None,
    items: str | list | None = None,
    submit_direct: int | str = 0,
) -> dict:
    """
    新建材料出库单服务：
    支持批量多物料录入、发货仓可用库存自动校验、保存为草稿或直接过账提交。
    """
    if not company:
        company = get_current_user_company()
    assert_company_access(company)
    frappe.has_permission("Stock Entry", "create", throw=True)

    if not warehouse or warehouse in ("全部仓库", "All Warehouses", ""):
        frappe.throw("请选择具体的出库发货仓库")
    _assert_warehouse_company(company, warehouse)

    if isinstance(items, str):
        try:
            item_list = json.loads(items)
        except Exception:
            item_list = []
    else:
        item_list = items or []

    if not item_list:
        frappe.throw("出库单物料清单不能为空，请至少添加一项出库物料")

    doc = frappe.new_doc("Stock Entry")
    doc.company = company
    doc.purpose = purpose or "Material Issue"
    doc.stock_entry_type = "Material Issue"
    doc.from_warehouse = warehouse
    doc.posting_date = posting_date or nowdate()
    if department:
        doc.department = department

    custom_remarks = remarks.strip() if remarks else ""
    doc.remarks = custom_remarks or "材料出库工作台快速出库"

    for idx, it in enumerate(item_list, start=1):
        code = (it.get("item_code") or "").strip()
        if not code:
            continue
        qty = flt(it.get("qty") or 0)
        if qty <= 0:
            frappe.throw(f"第 {idx} 行物料 {code} 的出库数量必须大于 0")

        # 严格校验发货仓可用库存，严禁超库存出库
        bin_qty = frappe.db.get_value("Bin", {"warehouse": warehouse, "item_code": code}, "actual_qty") or 0.0
        if flt(qty) > flt(bin_qty) + 0.0001:
            frappe.throw(
                f"第 {idx} 行物料 {code} 在发货仓【{warehouse}】的可用库存为 {flt(bin_qty):.2f}，出库数量 {qty:.2f} 超出可用库存，无法出库！"
            )

        item_doc = frappe.get_cached_doc("Item", code)
        stock_uom = it.get("stock_uom") or item_doc.stock_uom or "Nos"

        doc.append("items", {
            "item_code": code,
            "item_name": item_doc.item_name,
            "description": item_doc.description or item_doc.item_name,
            "s_warehouse": warehouse,
            "qty": qty,
            "stock_uom": stock_uom,
            "uom": stock_uom,
            "conversion_factor": 1.0,
        })

    if not doc.items:
        frappe.throw("出库单物料清单中无有效物料")

    doc.set_stock_entry_type()
    doc.insert()

    is_submitted = False
    if str(submit_direct).strip() in ("1", "true", "True"):
        doc.check_permission("submit")
        doc.submit()
        is_submitted = True

    return {
        "name": doc.name,
        "docstatus": doc.docstatus,
        "is_submitted": is_submitted,
        "message": f"材料出库单 {doc.name} {'已成功直接过账提交生效' if is_submitted else '已成功创建为草稿'}！",
    }


@frappe.whitelist(methods=["POST"])
def cancel_stock_issue(voucher_no: str, reason: str | None = None) -> dict:
    """撤回/作废材料出库单"""
    if not voucher_no:
        frappe.throw("出库单号不能为空")

    doc = frappe.get_doc("Stock Entry", voucher_no)
    assert_company_access(doc.company)

    if doc.docstatus == 2:
        frappe.throw(f"出库单 {voucher_no} 已经是作废状态")
    if doc.docstatus == 0:
        doc.check_permission("delete")
        doc.delete()
        return {"message": f"出库单草稿 {voucher_no} 已成功删除！"}

    # docstatus == 1, 取消过账
    doc.check_permission("cancel")
    doc.cancel()
    if reason:
        doc.add_comment("Comment", text=f"出库工作台作废原因: {reason}")

    return {"message": f"出库单 {voucher_no} 已成功作废撤回！"}


@frappe.whitelist()
def get_stock_issue_detail(voucher_no: str) -> dict:
    """获取出库单完整详情穿透数据"""
    if not voucher_no:
        frappe.throw("单据编号不能为空")

    doc = frappe.get_doc("Stock Entry", voucher_no)
    assert_company_access(doc.company)
    doc.check_permission("read")

    items = []
    for it in doc.items:
        items.append({
            "idx": it.idx,
            "item_code": it.item_code,
            "item_name": it.item_name,
            "description": it.description or it.item_name,
            "s_warehouse": it.s_warehouse,
            "qty": flt(it.qty),
            "stock_uom": it.stock_uom or "Nos",
            "valuation_rate": flt(it.basic_rate),
            "amount": flt(it.amount),
        })

    p_time = str(doc.get("posting_time") or "")
    if "." in p_time:
        p_time = p_time.split(".")[0]

    return {
        "name": doc.name,
        "company": doc.company,
        "docstatus": doc.docstatus,
        "status_label": "待提交草稿" if doc.docstatus == 0 else ("已过账生效" if doc.docstatus == 1 else "已作废"),
        "status_class": "draft" if doc.docstatus == 0 else ("submitted" if doc.docstatus == 1 else "cancelled"),
        "posting_date": str(doc.posting_date),
        "posting_time": p_time,
        "purpose": doc.purpose,
        "purpose_label": "生产领料 / 制造" if doc.purpose == "Manufacture" else "材料出库 / 领料",
        "department": doc.get("department") or "-",
        "remarks": doc.remarks or "-",
        "owner": doc.owner,
        "items": items,
        "total_qty": sum(flt(it["qty"]) for it in items),
        "total_amount": sum(flt(it["amount"]) for it in items),
    }
