# -*- coding: utf-8 -*-
# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

from __future__ import annotations

import frappe
from frappe.utils import flt, getdate, nowdate
from ashan_cn_procurement.services.authorization_service import (
    assert_company_access,
    get_allowed_companies,
)


VOUCHER_TYPE_LABELS = {
    "Purchase Receipt": "采购入库",
    "Delivery Note": "销售出库",
    "Purchase Invoice": "采购发票入库",
    "Sales Invoice": "销售发票出库",
    "Stock Reconciliation": "盘点调账",
    "Subcontracting Receipt": "委外入库",
}


def has_restricted_access(user: str | None = None) -> bool:
    """判定当前用户是否拥有受限单据与受限物料查看特权（总经理 / 系统管理员 / 特殊保密员）"""
    if not user:
        user = frappe.session.user
    if user in ("Administrator",):
        return True
    roles = set(frappe.get_roles(user))
    return bool(roles & {"System Manager", "Restricted Document Super Viewer"})


def _resolve_restricted_scope(restricted_scope: str | None = None) -> str:
    """获取当前有效的保密核算口径（普通用户强制 public_only，特权用户优先使用用户工作环境偏好）"""
    if not has_restricted_access():
        return "public_only"
    if restricted_scope in ("all", "public_only", "restricted_only"):
        return restricted_scope
    try:
        from ashan_cn_procurement.services.work_context_service import get_work_context
        ctx = get_work_context()
        scope = ctx.get("restricted_doc_scope")
        if scope in ("all", "public_only", "restricted_only"):
            return scope
    except Exception:
        pass
    return "all"


def _get_restriction_sql(restricted_scope: str) -> tuple[str, str, str]:
    """
    根据保密核算范围生成对应的 SQL 连接与过滤条件：
    - joins: 联查 Item、Purchase Receipt、Stock Entry、Delivery Note、Purchase Invoice 的受限标记
    - cond: 过滤条件（public_only: 排除受限；restricted_only: 仅看受限；all: 全部）
    - expr: 判定单行是否受限的 CASE 表达式
    """
    joins = """
        LEFT JOIN `tabItem` item ON sle.item_code = item.name
        LEFT JOIN `tabPurchase Receipt` pr ON sle.voucher_type = 'Purchase Receipt' AND sle.voucher_no = pr.name
        LEFT JOIN `tabStock Entry` se ON sle.voucher_type = 'Stock Entry' AND sle.voucher_no = se.name
        LEFT JOIN `tabDelivery Note` dn ON sle.voucher_type = 'Delivery Note' AND sle.voucher_no = dn.name
        LEFT JOIN `tabPurchase Invoice` pi ON sle.voucher_type = 'Purchase Invoice' AND sle.voucher_no = pi.name
    """
    is_restricted_expr = """(
        COALESCE(item.custom_is_restricted_item, 0) = 1
        OR (sle.voucher_type = 'Purchase Receipt' AND COALESCE(pr.custom_is_restricted_doc, 0) = 1)
        OR (sle.voucher_type = 'Stock Entry' AND COALESCE(se.custom_is_restricted_doc, 0) = 1)
        OR (sle.voucher_type = 'Delivery Note' AND COALESCE(dn.custom_is_restricted_doc, 0) = 1)
        OR (sle.voucher_type = 'Purchase Invoice' AND COALESCE(pi.custom_is_restricted_doc, 0) = 1)
    )"""

    if restricted_scope == "public_only":
        cond = f" AND NOT {is_restricted_expr} "
    elif restricted_scope == "restricted_only":
        cond = f" AND {is_restricted_expr} "
    else:  # "all"
        cond = ""

    return joins, cond, is_restricted_expr


def _get_stock_entry_purpose_map(voucher_nos: list[str]) -> dict[str, str]:
    """批量查询 Stock Entry 的业务目的（Material Receipt/Issue/Transfer）"""
    if not voucher_nos:
        return {}
    entries = frappe.get_all(
        "Stock Entry",
        filters={"name": ["in", voucher_nos]},
        fields=["name", "purpose", "stock_entry_type"],
    )
    res = {}
    purpose_labels = {
        "Material Receipt": "生产/其他入库",
        "Material Issue": "材料出库/领用",
        "Material Transfer": "仓库调拨",
        "Material Transfer for Manufacture": "生产调拨",
        "Manufacture": "生产完工入库",
        "Repack": "组装拆卸",
        "Send to Subcontractor": "委外发料",
    }
    for e in entries:
        label = purpose_labels.get(e.purpose) or e.stock_entry_type or e.purpose or "物料收发"
        res[e.name] = label
    return res


@frappe.whitelist()
def get_meta_filters(company: str | None = None) -> dict:
    """获取库存工作台的基础筛选元数据（公司、仓库、物料分组、受限权限）"""
    allowed_companies = get_allowed_companies()
    all_companies = frappe.get_all("Company", fields=["name"], order_by="name asc")
    if allowed_companies is not None:
        companies = [c["name"] for c in all_companies if c["name"] in allowed_companies]
    else:
        companies = [c["name"] for c in all_companies]

    if not companies:
        return {
            "companies": [],
            "warehouses": [],
            "item_groups": [],
            "selected_company": "",
            "has_restricted_access": False,
        }

    selected_company = company if (company and company in companies) else companies[0]

    warehouses = frappe.get_all(
        "Warehouse",
        filters={"company": selected_company, "disabled": 0, "is_group": 0},
        fields=["name", "warehouse_name"],
        order_by="name asc",
    )

    item_groups_raw = frappe.get_all(
        "Item Group",
        fields=["name", "parent_item_group", "is_group", "lft", "rgt"],
        order_by="lft asc",
    )
    item_groups = [g["name"] for g in item_groups_raw]

    return {
        "companies": companies,
        "selected_company": selected_company,
        "warehouses": warehouses,
        "item_groups": item_groups,
        "item_groups_meta": item_groups_raw,
        "has_restricted_access": has_restricted_access(),
    }


@frappe.whitelist()
def get_stock_summary(
    company: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    warehouse: str | None = None,
    item_group: str | None = None,
    search_text: str | None = None,
    show_zero_stock: int | str = 0,
    restricted_scope: str = "all",
) -> dict:
    """
    收发存汇总台账核算引擎：
    按物料分类（Item Group）层级聚合，精确闭式计算：
      期初结存（上期结转） + 本期入库 - 本期出库 = 期末结存
    严格执行受限单据与受限物料底层物理隔离与权限判定。
    """
    if not company:
        meta = get_meta_filters()
        company = meta.get("selected_company")

    if company:
        assert_company_access(company)

    user_can_restrict = has_restricted_access()
    restricted_scope = _resolve_restricted_scope(restricted_scope)

    if not from_date:
        from_date = frappe.utils.get_first_day(nowdate())
    if not to_date:
        to_date = nowdate()

    from_date_str = str(from_date)
    to_date_str = str(to_date)
    show_zero = int(show_zero_stock or 0)

    # 基础条件构建
    base_conditions = ["sle.company = %(company)s", "sle.is_cancelled = 0"]
    params = {
        "company": company,
        "from_date": from_date_str,
        "to_date": to_date_str,
    }

    if warehouse and warehouse not in ("全部仓库", "All Warehouses", ""):
        base_conditions.append("sle.warehouse = %(warehouse)s")
        params["warehouse"] = warehouse

    # 保密数据过滤 SQL
    joins, rest_cond, is_restricted_expr = _get_restriction_sql(restricted_scope)

    # 1. 计算期初结存 (< from_date)
    # 使用最后一条过账记录的累计值作为精确期初，或累计差额求和
    opening_sql = f"""
        SELECT 
            sle.item_code,
            sle.warehouse,
            SUM(sle.actual_qty) AS opening_qty,
            SUM(sle.stock_value_difference) AS opening_val
        FROM `tabStock Ledger Entry` sle
        {joins}
        WHERE {' AND '.join(base_conditions)}
          AND sle.posting_date < %(from_date)s
          {rest_cond}
        GROUP BY sle.item_code, sle.warehouse
    """
    opening_records = frappe.db.sql(opening_sql, params, as_dict=True)
    opening_map = {(r["item_code"], r["warehouse"]): r for r in opening_records}

    # 2. 计算本期出入库发生额 (from_date <= posting_date <= to_date)
    period_sql = f"""
        SELECT 
            sle.item_code,
            sle.warehouse,
            SUM(CASE WHEN sle.actual_qty > 0 THEN sle.actual_qty ELSE 0 END) AS in_qty,
            SUM(CASE WHEN sle.stock_value_difference > 0 THEN sle.stock_value_difference ELSE 0 END) AS in_val,
            SUM(CASE WHEN sle.actual_qty < 0 THEN ABS(sle.actual_qty) ELSE 0 END) AS out_qty,
            SUM(CASE WHEN sle.stock_value_difference < 0 THEN ABS(sle.stock_value_difference) ELSE 0 END) AS out_val,
            MAX(CASE WHEN {is_restricted_expr} THEN 1 ELSE 0 END) AS has_restricted_trans
        FROM `tabStock Ledger Entry` sle
        {joins}
        WHERE {' AND '.join(base_conditions)}
          AND sle.posting_date >= %(from_date)s
          AND sle.posting_date <= %(to_date)s
          {rest_cond}
        GROUP BY sle.item_code, sle.warehouse
    """
    period_records = frappe.db.sql(period_sql, params, as_dict=True)
    period_map = {(r["item_code"], r["warehouse"]): r for r in period_records}

    # 3. 收集期间涉及的所有 (item_code, warehouse)
    active_keys = set(opening_map.keys()) | set(period_map.keys())

    # 4. 获取物料主数据
    item_filter_conds = []
    item_params = {}
    if item_group and item_group not in ("全部物料类型", "All Item Groups", ""):
        # 支持物料大类层级包含 (使用 lft / rgt 包含子物料组)
        ig_doc = frappe.get_doc("Item Group", item_group)
        if ig_doc.is_group:
            item_filter_conds.append("item.item_group IN (SELECT name FROM `tabItem Group` WHERE lft >= %(ig_lft)s AND rgt <= %(ig_rgt)s)")
            item_params["ig_lft"] = ig_doc.lft
            item_params["ig_rgt"] = ig_doc.rgt
        else:
            item_filter_conds.append("item.item_group = %(item_group)s")
            item_params["item_group"] = item_group

    if search_text and search_text.strip():
        st = f"%{search_text.strip()}%"
        item_filter_conds.append("(item.name LIKE %(st)s OR item.item_name LIKE %(st)s OR item.description LIKE %(st)s)")
        item_params["st"] = st

    # 若仅查看公开数据，排除标记为受限的物料
    if restricted_scope == "public_only":
        item_filter_conds.append("COALESCE(item.custom_is_restricted_item, 0) = 0")
    elif restricted_scope == "restricted_only":
        item_filter_conds.append("COALESCE(item.custom_is_restricted_item, 0) = 1")

    item_where = ("WHERE " + " AND ".join(item_filter_conds)) if item_filter_conds else ""
    items_meta_sql = f"""
        SELECT 
            item.name AS item_code,
            item.item_name,
            item.item_group,
            item.stock_uom,
            item.description AS spec,
            COALESCE(item.custom_is_restricted_item, 0) AS is_restricted_item
        FROM `tabItem` item
        {item_where}
        ORDER BY item.item_group ASC, item.name ASC
    """
    all_items_meta = frappe.db.sql(items_meta_sql, item_params, as_dict=True)
    item_meta_dict = {it["item_code"]: it for it in all_items_meta}

    # 5. 组合收发存明细项
    result_items = []
    tot_open_qty = 0.0
    tot_open_val = 0.0
    tot_in_qty = 0.0
    tot_in_val = 0.0
    tot_out_qty = 0.0
    tot_out_val = 0.0
    tot_close_qty = 0.0
    tot_close_val = 0.0

    # 获取所有相关的仓库
    all_wh_list = [w["name"] for w in frappe.get_all("Warehouse", filters={"company": company, "disabled": 0, "is_group": 0}, fields=["name"])]
    if warehouse and warehouse not in ("全部仓库", "All Warehouses", ""):
        all_wh_list = [warehouse]

    # 如果勾选了“包含零库存”，遍历主数据中的所有物料；否则仅遍历有期初或本期发生的物料
    target_keys = set()
    if show_zero:
        for it_code in item_meta_dict.keys():
            for wh in all_wh_list:
                target_keys.add((it_code, wh))
    else:
        for k in active_keys:
            if k[0] in item_meta_dict:
                target_keys.add(k)

    for it_code, wh in sorted(target_keys, key=lambda x: (item_meta_dict.get(x[0], {}).get("item_group", ""), x[0], x[1])):
        meta = item_meta_dict.get(it_code)
        if not meta:
            continue

        op = opening_map.get((it_code, wh), {})
        pe = period_map.get((it_code, wh), {})

        op_qty = flt(op.get("opening_qty", 0.0), 2)
        op_val = flt(op.get("opening_val", 0.0), 2)
        op_rate = flt(op_val / op_qty, 2) if op_qty > 0 else 0.0

        in_qty = flt(pe.get("in_qty", 0.0), 2)
        in_val = flt(pe.get("in_val", 0.0), 2)
        in_rate = flt(in_val / in_qty, 2) if in_qty > 0 else 0.0

        out_qty = flt(pe.get("out_qty", 0.0), 2)
        out_val = flt(pe.get("out_val", 0.0), 2)
        out_rate = flt(out_val / out_qty, 2) if out_qty > 0 else 0.0

        # 期末结存 = 期初 + 入库 - 出库 (严格守恒)
        cl_qty = flt(op_qty + in_qty - out_qty, 2)
        cl_val = flt(op_val + in_val - out_val, 2)
        cl_rate = flt(cl_val / cl_qty, 2) if cl_qty > 0 else 0.0

        # 如果无变动且期末为 0，且未勾选显示零库存，则跳过
        if not show_zero and abs(op_qty) < 0.0001 and abs(in_qty) < 0.0001 and abs(out_qty) < 0.0001 and abs(cl_qty) < 0.0001:
            continue

        is_restricted = bool(meta.get("is_restricted_item") or pe.get("has_restricted_trans"))

        item_row = {
            "item_code": it_code,
            "item_name": meta.get("item_name") or it_code,
            "item_group": meta.get("item_group") or "未分类",
            "stock_uom": meta.get("stock_uom") or "",
            "spec": meta.get("spec") or "",
            "warehouse": wh,
            "is_restricted": is_restricted,
            "opening_qty": op_qty,
            "opening_rate": op_rate,
            "opening_val": op_val,
            "in_qty": in_qty,
            "in_rate": in_rate,
            "in_val": in_val,
            "out_qty": out_qty,
            "out_rate": out_rate,
            "out_val": out_val,
            "closing_qty": cl_qty,
            "closing_rate": cl_rate,
            "closing_val": cl_val,
        }
        result_items.append(item_row)

        tot_open_qty += op_qty
        tot_open_val += op_val
        tot_in_qty += in_qty
        tot_in_val += in_val
        tot_out_qty += out_qty
        tot_out_val += out_val
        tot_close_qty += cl_qty
        tot_close_val += cl_val

    kpis = {
        "total_opening_qty": round(tot_open_qty, 2),
        "total_opening_val": round(tot_open_val, 2),
        "total_in_qty": round(tot_in_qty, 2),
        "total_in_val": round(tot_in_val, 2),
        "total_out_qty": round(tot_out_qty, 2),
        "total_out_val": round(tot_out_val, 2),
        "total_closing_qty": round(tot_close_qty, 2),
        "total_closing_val": round(tot_close_val, 2),
        "active_sku_count": len(result_items),
        "total_sku_count": len(all_items_meta),
    }

    # 6. 按物料分类（Item Group）组织树状折叠结构并计算分组小计
    all_groups_meta = frappe.db.sql("SELECT name, parent_item_group, is_group, lft, rgt FROM `tabItem Group` ORDER BY lft ASC", as_dict=True)
    group_order = [g["name"] for g in all_groups_meta]
    groups_dict = {}

    for it in result_items:
        grp = it.get("item_group") or "未分类"
        if grp not in groups_dict:
            groups_dict[grp] = {
                "group_name": grp,
                "items": [],
                "subtotals": {
                    "opening_qty": 0.0,
                    "opening_val": 0.0,
                    "in_qty": 0.0,
                    "in_val": 0.0,
                    "out_qty": 0.0,
                    "out_val": 0.0,
                    "closing_qty": 0.0,
                    "closing_val": 0.0,
                    "item_count": 0,
                    "has_restricted": False,
                }
            }
        groups_dict[grp]["items"].append(it)
        sub = groups_dict[grp]["subtotals"]
        sub["opening_qty"] = round(sub["opening_qty"] + it["opening_qty"], 2)
        sub["opening_val"] = round(sub["opening_val"] + it["opening_val"], 2)
        sub["in_qty"] = round(sub["in_qty"] + it["in_qty"], 2)
        sub["in_val"] = round(sub["in_val"] + it["in_val"], 2)
        sub["out_qty"] = round(sub["out_qty"] + it["out_qty"], 2)
        sub["out_val"] = round(sub["out_val"] + it["out_val"], 2)
        sub["closing_qty"] = round(sub["closing_qty"] + it["closing_qty"], 2)
        sub["closing_val"] = round(sub["closing_val"] + it["closing_val"], 2)
        sub["item_count"] += 1
        if it.get("is_restricted"):
            sub["has_restricted"] = True

    # 按照 Item Group 树的 lft 顺序排序分组
    sorted_groups = []
    for gname in group_order:
        if gname in groups_dict:
            sorted_groups.append(groups_dict[gname])
    for gname, gdata in groups_dict.items():
        if gname not in group_order:
            sorted_groups.append(gdata)

    return {
        "items": result_items,
        "groups": sorted_groups,
        "kpis": kpis,
        "count": len(result_items),
        "has_restricted_access": user_can_restrict,
        "restricted_scope": restricted_scope,
    }


@frappe.whitelist()
def get_stock_ledger_entries(
    company: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    item_code: str | None = None,
    warehouse: str | None = None,
    item_group: str | None = None,
    search_text: str | None = None,
    limit: int | str = 200,
    offset: int | str = 0,
    restricted_scope: str = "all",
) -> dict:
    """
    出入库时序流水明细查询接口：
    按过账时间倒序排列，支持根据受限权限与范围隔离，返回单笔变动的业务性质与凭证类型
    """
    if not company:
        meta = get_meta_filters()
        company = meta.get("selected_company")

    if company:
        assert_company_access(company)

    user_can_restrict = has_restricted_access()
    restricted_scope = _resolve_restricted_scope(restricted_scope)

    conditions = ["sle.company = %(company)s", "sle.is_cancelled = 0"]
    params = {"company": company}

    if from_date:
        conditions.append("sle.posting_date >= %(from_date)s")
        params["from_date"] = str(from_date)
    if to_date:
        conditions.append("sle.posting_date <= %(to_date)s")
        params["to_date"] = str(to_date)
    if item_code:
        conditions.append("sle.item_code = %(item_code)s")
        params["item_code"] = item_code
    if warehouse and warehouse not in ("全部仓库", "All Warehouses", ""):
        conditions.append("sle.warehouse = %(warehouse)s")
        params["warehouse"] = warehouse

    if item_group and item_group not in ("全部物料类型", "All Item Groups", ""):
        ig_doc = frappe.get_doc("Item Group", item_group)
        if ig_doc.is_group:
            conditions.append("item.item_group IN (SELECT name FROM `tabItem Group` WHERE lft >= %(ig_lft)s AND rgt <= %(ig_rgt)s)")
            params["ig_lft"] = ig_doc.lft
            params["ig_rgt"] = ig_doc.rgt
        else:
            conditions.append("item.item_group = %(item_group)s")
            params["item_group"] = item_group

    if search_text and search_text.strip():
        st = f"%{search_text.strip()}%"
        conditions.append("(sle.item_code LIKE %(st)s OR item.item_name LIKE %(st)s OR sle.voucher_no LIKE %(st)s)")
        params["st"] = st

    joins, rest_cond, is_restricted_expr = _get_restriction_sql(restricted_scope)
    where_clause = " AND ".join(conditions) + rest_cond

    limit_num = int(limit or 200)
    offset_num = int(offset or 0)
    params["limit"] = limit_num
    params["offset"] = offset_num

    sql = f"""
        SELECT 
            sle.name,
            sle.posting_date,
            sle.posting_time,
            sle.voucher_type,
            sle.voucher_no,
            sle.item_code,
            item.item_name,
            item.description AS spec,
            item.stock_uom,
            sle.warehouse,
            sle.actual_qty,
            sle.qty_after_transaction,
            sle.incoming_rate,
            sle.valuation_rate,
            sle.stock_value,
            sle.stock_value_difference,
            sle.batch_no,
            sle.serial_no,
            CASE WHEN {is_restricted_expr} THEN 1 ELSE 0 END AS is_restricted
        FROM `tabStock Ledger Entry` sle
        {joins}
        WHERE {where_clause}
        ORDER BY sle.posting_date DESC, sle.posting_time DESC, sle.creation DESC
        LIMIT %(limit)s OFFSET %(offset)s
    """
    entries = frappe.db.sql(sql, params, as_dict=True)

    # 查总数
    count_sql = f"""
        SELECT COUNT(*) AS total_count
        FROM `tabStock Ledger Entry` sle
        {joins}
        WHERE {where_clause}
    """
    total_count = frappe.db.sql(count_sql, params)[0][0]

    # 补充 Stock Entry 细分业务类型
    se_vouchers = [e["voucher_no"] for e in entries if e["voucher_type"] == "Stock Entry"]
    se_purposes = _get_stock_entry_purpose_map(se_vouchers)

    formatted_entries = []
    for e in entries:
        v_type = e["voucher_type"]
        v_label = VOUCHER_TYPE_LABELS.get(v_type)
        if v_type == "Stock Entry":
            v_label = se_purposes.get(e["voucher_no"], "物料收发")
        elif not v_label:
            v_label = v_type

        is_in = flt(e["actual_qty"]) > 0
        rate = e["incoming_rate"] if is_in and flt(e["incoming_rate"]) > 0 else e["valuation_rate"]

        formatted_entries.append({
            "name": e["name"],
            "posting_date": str(e["posting_date"]),
            "posting_time": str(e["posting_time"])[:8],
            "voucher_type": v_type,
            "voucher_type_label": v_label,
            "voucher_no": e["voucher_no"],
            "item_code": e["item_code"],
            "item_name": e["item_name"] or e["item_code"],
            "spec": e["spec"] or "",
            "stock_uom": e["stock_uom"] or "",
            "warehouse": e["warehouse"],
            "actual_qty": flt(e["actual_qty"], 2),
            "is_in": is_in,
            "rate": flt(rate, 2),
            "stock_value_difference": flt(e["stock_value_difference"], 2),
            "qty_after_transaction": flt(e["qty_after_transaction"], 2),
            "stock_value": flt(e["stock_value"], 2),
            "batch_no": e["batch_no"] or "",
            "serial_no": e["serial_no"] or "",
            "is_restricted": bool(e.get("is_restricted")),
        })

    return {
        "entries": formatted_entries,
        "total_count": total_count,
        "limit": limit_num,
        "offset": offset_num,
        "has_restricted_access": user_can_restrict,
        "restricted_scope": restricted_scope,
    }


@frappe.whitelist()
def get_item_quick_history(
    company: str | None = None,
    item_code: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    warehouse: str | None = None,
    restricted_scope: str = "all",
) -> dict:
    """
    单物料极速侧边抽屉明细 API：
    返回该物料在指定期间的期初结存、本期流入流出、期末结存及最近的出入库流水明细。
    """
    if not item_code:
        frappe.throw("物料编码不能为空")

    if not company:
        meta = get_meta_filters()
        company = meta.get("selected_company")

    if company:
        assert_company_access(company)

    user_can_restrict = has_restricted_access()
    restricted_scope = _resolve_restricted_scope(restricted_scope)

    if not from_date:
        from_date = frappe.utils.get_first_day(nowdate())
    if not to_date:
        to_date = nowdate()

    item_doc = frappe.get_doc("Item", item_code)
    item_info = {
        "item_code": item_doc.name,
        "item_name": item_doc.item_name,
        "stock_uom": item_doc.stock_uom,
        "spec": item_doc.description or "",
        "item_group": item_doc.item_group,
        "is_restricted_item": bool(getattr(item_doc, "custom_is_restricted_item", 0)),
    }

    base_conds = ["sle.company = %(company)s", "sle.is_cancelled = 0", "sle.item_code = %(item_code)s"]
    params = {
        "company": company,
        "item_code": item_code,
        "from_date": str(from_date),
        "to_date": str(to_date),
    }

    if warehouse and warehouse not in ("全部仓库", "All Warehouses", ""):
        base_conds.append("sle.warehouse = %(warehouse)s")
        params["warehouse"] = warehouse

    joins, rest_cond, is_restricted_expr = _get_restriction_sql(restricted_scope)

    # 1. 计算期初 (< from_date)
    op_sql = f"""
        SELECT 
            SUM(sle.actual_qty) AS op_qty,
            SUM(sle.stock_value_difference) AS op_val
        FROM `tabStock Ledger Entry` sle
        {joins}
        WHERE {' AND '.join(base_conds)}
          AND sle.posting_date < %(from_date)s
          {rest_cond}
    """
    op_res = frappe.db.sql(op_sql, params, as_dict=True)[0]
    op_qty = flt(op_res.get("op_qty", 0.0), 2)
    op_val = flt(op_res.get("op_val", 0.0), 2)
    op_rate = flt(op_val / op_qty, 2) if op_qty > 0 else 0.0

    # 2. 期间流水
    mov_sql = f"""
        SELECT 
            sle.name,
            sle.posting_date,
            sle.posting_time,
            sle.voucher_type,
            sle.voucher_no,
            sle.warehouse,
            sle.actual_qty,
            sle.qty_after_transaction,
            sle.incoming_rate,
            sle.valuation_rate,
            sle.stock_value,
            sle.stock_value_difference,
            CASE WHEN {is_restricted_expr} THEN 1 ELSE 0 END AS is_restricted
        FROM `tabStock Ledger Entry` sle
        {joins}
        WHERE {' AND '.join(base_conds)}
          AND sle.posting_date >= %(from_date)s
          AND sle.posting_date <= %(to_date)s
          {rest_cond}
        ORDER BY sle.posting_date ASC, sle.posting_time ASC, sle.creation ASC
    """
    movements_raw = frappe.db.sql(mov_sql, params, as_dict=True)

    se_vouchers = [m["voucher_no"] for m in movements_raw if m["voucher_type"] == "Stock Entry"]
    se_purposes = _get_stock_entry_purpose_map(se_vouchers)

    in_qty = 0.0
    in_val = 0.0
    out_qty = 0.0
    out_val = 0.0
    movements = []

    for m in movements_raw:
        is_in = flt(m["actual_qty"]) > 0
        diff_val = flt(m["stock_value_difference"], 2)
        qty = flt(m["actual_qty"], 2)

        if is_in:
            in_qty += qty
            in_val += diff_val
        else:
            out_qty += abs(qty)
            out_val += abs(diff_val)

        v_type = m["voucher_type"]
        v_label = VOUCHER_TYPE_LABELS.get(v_type)
        if v_type == "Stock Entry":
            v_label = se_purposes.get(m["voucher_no"], "物料收发")
        elif not v_label:
            v_label = v_type

        rate = m["incoming_rate"] if is_in and flt(m["incoming_rate"]) > 0 else m["valuation_rate"]

        movements.append({
            "name": m["name"],
            "posting_date": str(m["posting_date"]),
            "posting_time": str(m["posting_time"])[:8],
            "voucher_type": v_type,
            "voucher_type_label": v_label,
            "voucher_no": m["voucher_no"],
            "warehouse": m["warehouse"],
            "actual_qty": qty,
            "is_in": is_in,
            "rate": flt(rate, 2),
            "stock_value_difference": diff_val,
            "qty_after_transaction": flt(m["qty_after_transaction"], 2),
            "stock_value": flt(m["stock_value"], 2),
            "is_restricted": bool(m.get("is_restricted")),
        })

    # 期末 = 期初 + 入库 - 出库
    cl_qty = flt(op_qty + in_qty - out_qty, 2)
    cl_val = flt(op_val + in_val - out_val, 2)
    cl_rate = flt(cl_val / cl_qty, 2) if cl_qty > 0 else 0.0

    return {
        "item_info": item_info,
        "opening": {"qty": op_qty, "rate": op_rate, "val": op_val},
        "current_in": {"qty": round(in_qty, 2), "val": round(in_val, 2)},
        "current_out": {"qty": round(out_qty, 2), "val": round(out_val, 2)},
        "closing": {"qty": cl_qty, "rate": cl_rate, "val": cl_val},
        "movements": movements,
        "has_restricted_access": user_can_restrict,
        "restricted_scope": restricted_scope,
    }


@frappe.whitelist(methods=["POST"])
def create_quick_stock_issue(
    company: str,
    item_code: str,
    warehouse: str,
    qty: float | str,
    purpose: str = "Material Issue",
    posting_date: str | None = None,
    remarks: str | None = None,
    submit_doc: int | str = 0,
) -> dict:
    """
    快捷出库单生成引擎：
    根据选定物料、出库仓库与数量快速生成材料出库单（Stock Entry - Material Issue），
    支持一键保存为草稿或直接过账提交，并在流水台账中实时呈现。
    """
    if not company:
        meta = get_meta_filters()
        company = meta.get("selected_company")

    if company:
        assert_company_access(company)

    if not item_code:
        frappe.throw("物料编码不能为空")
    if not warehouse or warehouse in ("全部仓库", "All Warehouses", ""):
        frappe.throw("请选择具体的出库仓库")

    issue_qty = flt(qty)
    if issue_qty <= 0:
        frappe.throw("出库数量必须大于 0")

    doc = frappe.new_doc("Stock Entry")
    doc.company = company
    doc.purpose = purpose or "Material Issue"
    doc.stock_entry_type = "Material Issue"
    if posting_date:
        doc.posting_date = str(posting_date)

    custom_remarks = remarks.strip() if remarks else ""
    doc.remarks = f"库存流水台账快捷出库: {item_code} ({custom_remarks})" if custom_remarks else f"库存流水台账快捷出库: {item_code}"

    item_doc = frappe.get_cached_doc("Item", item_code)
    stock_uom = item_doc.stock_uom or "Nos"

    doc.append("items", {
        "item_code": item_code,
        "item_name": item_doc.item_name,
        "description": item_doc.description or item_doc.item_name,
        "s_warehouse": warehouse,
        "qty": issue_qty,
        "stock_uom": stock_uom,
        "uom": stock_uom,
        "conversion_factor": 1.0,
    })

    doc.set_stock_entry_type()
    doc.insert(ignore_permissions=True)

    is_submitted = False
    if str(submit_doc).strip() in ("1", "true", "True"):
        doc.submit()
        is_submitted = True

    return {
        "name": doc.name,
        "docstatus": doc.docstatus,
        "is_submitted": is_submitted,
        "message": f"出库单 {doc.name} {'已成功过账提交' if is_submitted else '已成功创建为草稿'}！",
    }

@frappe.whitelist()
def get_voucher_quick_detail(voucher_type: str, voucher_no: str) -> dict:
    """
    通用出入库凭证快速穿透预览服务：
    精准识别【入库单 (Inbound)】、【出库单 (Outbound)】、【调拨单 (Transfer)】并组装高可读性结构化数据。
    """
    if not voucher_type or not voucher_no:
        frappe.throw("单据类型与单据编号不能为空")

    if not frappe.db.exists(voucher_type, voucher_no):
        frappe.throw(f"未找到单据: {voucher_type} - {voucher_no}")

    doc = frappe.get_doc(voucher_type, voucher_no)
    if doc.get("company"):
        assert_company_access(doc.company)

    docstatus = doc.get("docstatus", 0)
    status_label = "草稿 (Draft)" if docstatus == 0 else ("已过账/已生效" if docstatus == 1 else "已作废 (Cancelled)")

    # 1. 严格判定单据主类别: inbound (入库) | outbound (出库) | transfer (调拨)
    voucher_category = "inbound"
    voucher_title = "单据明细"
    purpose_label = ""

    if voucher_type == "Purchase Receipt":
        voucher_category = "inbound"
        voucher_title = f"采购入库单明细 · {doc.name}"
        purpose_label = "采购入库"
    elif voucher_type == "Purchase Invoice":
        voucher_category = "inbound"
        voucher_title = f"采购发票入库明细 · {doc.name}"
        purpose_label = "采购发票入库"
    elif voucher_type == "Delivery Note":
        voucher_category = "outbound"
        voucher_title = f"销售出库单明细 · {doc.name}"
        purpose_label = "销售出库"
    elif voucher_type == "Sales Invoice":
        voucher_category = "outbound"
        voucher_title = f"销售发票出库明细 · {doc.name}"
        purpose_label = "销售发票出库"
    elif voucher_type == "Stock Entry":
        se_type = doc.get("stock_entry_type") or doc.get("purpose") or ""
        if se_type in ("Material Issue",):
            voucher_category = "outbound"
            voucher_title = f"材料出库/领用单明细 · {doc.name}"
            purpose_label = "材料出库 / 领料"
        elif se_type in ("Material Transfer", "Send to Subcontractor", "Material Transfer for Manufacture"):
            voucher_category = "transfer"
            voucher_title = f"库存调拨单明细 · {doc.name}"
            purpose_label = f"仓库调拨 ({se_type})"
        elif se_type in ("Material Receipt",):
            voucher_category = "inbound"
            voucher_title = f"其他入库单明细 · {doc.name}"
            purpose_label = "其他入库"
        elif se_type in ("Manufacture",):
            voucher_category = "manufacture"
            voucher_title = f"生产出入库单明细 · {doc.name}"
            purpose_label = "生产加工"
        else:
            voucher_category = "outbound" if "Issue" in se_type else "inbound"
            voucher_title = f"库存单据明细 · {doc.name}"
            purpose_label = se_type or "库存收发"
    elif voucher_type == "Stock Reconciliation":
        voucher_category = "transfer"
        voucher_title = f"库存盘点调账单 · {doc.name}"
        purpose_label = "库存盘点调整"
    elif voucher_type == "Subcontracting Receipt":
        voucher_category = "inbound"
        voucher_title = f"委外加工入库单 · {doc.name}"
        purpose_label = "委外加工入库"

    # 2. 规范化时间格式 (去除微秒 .511560)
    p_date = str(doc.get("posting_date") or doc.get("transaction_date") or "")
    p_time = str(doc.get("posting_time") or "")
    if "." in p_time:
        p_time = p_time.split(".")[0]

    # 3. 提取物料明细行 (严格区分类别仓位)
    items_list = []
    child_table_name = "items"
    if doc.get(child_table_name):
        for idx, row in enumerate(doc.get(child_table_name), start=1):
            qty = flt(row.get("qty") or row.get("stock_qty") or 0)
            uom = row.get("uom") or row.get("stock_uom") or "Nos"
            rate = flt(row.get("rate") or row.get("basic_rate") or row.get("valuation_rate") or 0)
            amount = flt(row.get("amount") or (qty * rate))

            if voucher_category == "inbound":
                source_wh = doc.get("supplier_name") or doc.get("supplier") or "外部供货商"
                target_wh = row.get("warehouse") or doc.get("set_warehouse") or "-"
            elif voucher_category == "outbound":
                source_wh = row.get("s_warehouse") or row.get("warehouse") or doc.get("from_warehouse") or "-"
                target_wh = doc.get("customer_name") or doc.get("customer") or doc.get("remarks") or "车间领用"
            elif voucher_category == "transfer":
                source_wh = row.get("s_warehouse") or row.get("from_warehouse") or "-"
                target_wh = row.get("t_warehouse") or row.get("to_warehouse") or "-"
            else:
                source_wh = row.get("s_warehouse") or row.get("warehouse") or "-"
                target_wh = row.get("t_warehouse") or "-"

            items_list.append({
                "idx": idx,
                "item_code": row.get("item_code") or "-",
                "item_name": row.get("item_name") or row.get("item_code") or "-",
                "description": row.get("description") or "-",
                "qty": qty,
                "uom": uom,
                "source_warehouse": source_wh,
                "target_warehouse": target_wh,
                "rate": rate,
                "amount": amount,
            })

    return {
        "voucher_type": voucher_type,
        "voucher_no": doc.name,
        "voucher_category": voucher_category,
        "voucher_title": voucher_title,
        "purpose_label": purpose_label,
        "docstatus": docstatus,
        "status_label": status_label,
        "company": doc.get("company") or "-",
        "posting_date": p_date,
        "posting_time": p_time,
        "remarks": doc.get("remarks") or doc.get("instructions") or "-",
        "supplier": doc.get("supplier_name") or doc.get("supplier") or "",
        "customer": doc.get("customer_name") or doc.get("customer") or "",
        "items": items_list,
        "total_qty": sum(it["qty"] for it in items_list),
        "total_amount": sum(it["amount"] for it in items_list),
    }
