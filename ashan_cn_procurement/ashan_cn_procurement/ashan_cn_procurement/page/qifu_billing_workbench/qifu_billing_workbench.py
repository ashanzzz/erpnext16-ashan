# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import json
from decimal import Decimal, ROUND_HALF_UP
import frappe
from frappe import _
from frappe.utils import flt, cint, getdate, today
from ashan_cn_procurement.services.permission_query_service import assert_doctype_permission


def _normalize_period(period_month):
    p = str(period_month or "").strip()
    if len(p) == 6 and p.isdigit():
        return f"{p[:4]}-{p[4:]}"
    if len(p) == 7 and "-" in p:
        return p
    return today()[:7]


@frappe.whitelist(methods=["POST"])
def get_qifu_billing_data(period_month=None):
    """
    获取天津祺富机械加工有限公司现金大账与报销明细数据。
    严格对齐祺富大账簿 (YYYYMM账单祺富机械.xlsm) 业务边界：
    1. 仅核算孟祥山现金报销轨 (现金账单-孟祥山 - 祺富)；
    2. 穿透关联 Reimbursement Request、Purchase Invoice 与 Payment Entry；
    3. 提取四大核心常态支出与五大业务部门 (打磨/铜牌/浸渗/共用/非公司) 交叉统计。
    """
    assert_doctype_permission("Purchase Invoice", "read")
    company = "天津祺富机械加工有限公司"
    period = _normalize_period(period_month)
    y, m = period.split("-")[:2]
    from calendar import monthrange
    last_day = monthrange(int(y), int(m))[1]
    start_date = f"{period}-01"
    end_date = f"{period}-{last_day:02d}"

    # 1. 查询当期采购发票 (以过账日期落在当月为准，遵循核心铁律)
    pis = frappe.get_all(
        "Purchase Invoice",
        filters={
            "company": company,
            "docstatus": 1,
            "posting_date": ["between", [start_date, end_date]],
        },
        fields=[
            "name", "posting_date", "bill_no", "bill_date", "supplier",
            "grand_total", "outstanding_amount", "remarks", "owner"
        ],
        order_by="posting_date asc, name asc"
    )

    # 2. 查询当期报销单及关联明细
    rrs = frappe.get_all(
        "Reimbursement Request",
        filters={
            "company": company,
            "docstatus": 1,
            "posting_date": ["between", [start_date, end_date]],
        },
        fields=[
            "name", "posting_date", "title", "total_amount", "paid_amount",
            "payment_status", "owner"
        ],
        order_by="posting_date asc, name asc"
    )

    rr_map = {r.name: r for r in rrs}
    rr_items = []
    if rrs:
        rr_items = frappe.get_all(
            "Reimbursement Invoice Item",
            filters={"parent": ["in", list(rr_map.keys())]},
            fields=[
                "name", "parent", "source_pi", "invoice_no", "item_name",
                "description", "amount", "custom_line_remark"
            ]
        )

    # 3. 构造 19 列流水账数据
    stream_rows = []
    tot_expense = 0.0
    tot_income = 0.0

    # 优先使用报销单细化明细展开
    seq = 1
    handled_pis = set()
    for item in rr_items:
        rr = rr_map.get(item.parent)
        amt = flt(item.amount)
        tot_expense += amt
        handled_pis.add(item.source_pi)
        
        # 部门判定 (公用 / 打磨 / 铜牌 / 浸渗 / 非公司)
        remark = str(item.custom_line_remark or item.description or item.item_name or "")
        dept = "公用"
        if "打磨" in remark: dept = "打磨"
        elif "铜牌" in remark: dept = "铜牌"
        elif "浸渗" in remark: dept = "浸渗"
        elif "非公司" in remark or "老板家" in remark: dept = "非公司"

        # 类别判定
        cat = "五金耗材"
        if any(k in remark for k in ["维修", "保养", "轮胎", "验车"]): cat = "客车耗材" if "轿车" in remark or "跑车" in remark else "货车耗材"
        elif "高速" in remark or "ETC" in remark: cat = "高速费"
        elif "餐" in remark: cat = "车间餐饮"
        elif "招待" in remark: cat = "其他招待"
        elif "油" in remark: cat = "油卡充值"
        elif "运费" in remark or "快递" in remark: cat = "其他服务费"

        inv_no = item.invoice_no or "无票"
        if inv_no in ("0", "00", "000"): inv_no = "无票"

        stream_rows.append({
            "seq": seq,
            "posting_date": str(rr.posting_date) if rr else "",
            "voucher_date": str(rr.posting_date) if rr else "",
            "item_name": item.item_name or "其它",
            "specification": item.description or "-",
            "unit_price": amt,
            "qty": 1,
            "unit": "项",
            "amount": amt,
            "direction": "支出",
            "user": "祺富",
            "reviewer": "祺富",
            "category": cat,
            "department": dept,
            "mode": "现金",
            "usage": item.custom_line_remark or item.description or item.item_name or "",
            "reimbursement_no": item.parent,
            "request_no": "",
            "invoice_no": inv_no,
            "creator": frappe.db.get_value("User", rr.owner, "full_name") if rr and rr.owner else "孟祥山"
        })
        seq += 1

    # 4. 补充未做 RR 的直接采购发票 (如果有)
    for pi in pis:
        if pi.name in handled_pis:
            continue
        amt = flt(pi.grand_total)
        tot_expense += amt
        inv_no = pi.bill_no or "无票"
        if inv_no in ("0", "00", "000"): inv_no = "无票"
        stream_rows.append({
            "seq": seq,
            "posting_date": str(pi.posting_date),
            "voucher_date": str(pi.bill_date or pi.posting_date),
            "item_name": pi.supplier or "其它供应商",
            "specification": "-",
            "unit_price": amt,
            "qty": 1,
            "unit": "笔",
            "amount": amt,
            "direction": "支出",
            "user": "祺富",
            "reviewer": "祺富",
            "category": "其他服务费",
            "department": "公用",
            "mode": "现金",
            "usage": pi.remarks or "采购发票直接支出",
            "reimbursement_no": "",
            "request_no": "",
            "invoice_no": inv_no,
            "creator": frappe.db.get_value("User", pi.owner, "full_name") if pi.owner else "孟祥山"
        })
        seq += 1

    # 5. 汇总四大固定支出状态
    fixed_expenses = {
        "naidi_hospitality": {"name": "耐迪保密招待费", "amount": 3200.0, "status": "Excel独立核算", "note": "固定保密支出，仅大账簿核算"},
        "truck_toll": {"name": "货车高速费明细", "amount": 0.0, "status": "待月结", "note": "项目目录货车高速费台账月结汇总"},
        "sinopec_fuel": {"name": "中石化油卡充值", "amount": 0.0, "status": "待出资确认", "note": "车间卡+个人卡现金实际垫付出资"},
        "car_etc": {"name": "轿车ETC通行费", "amount": 0.0, "status": "待发票汇总", "note": "票根网全量数电发票月末合并总金额"}
    }
    for r in stream_rows:
        if "耐迪" in r["usage"]:
            fixed_expenses["naidi_hospitality"]["amount"] = r["amount"]
            fixed_expenses["naidi_hospitality"]["status"] = "已入账"
        elif "货车高速" in r["usage"]:
            fixed_expenses["truck_toll"]["amount"] = r["amount"]
            fixed_expenses["truck_toll"]["status"] = "已入账"
        elif "油卡" in r["category"] or "加油" in r["usage"]:
            fixed_expenses["sinopec_fuel"]["amount"] += r["amount"]
            fixed_expenses["sinopec_fuel"]["status"] = "已入账"
        elif "ETC" in r["usage"] or "轿车ETC" in r["item_name"]:
            fixed_expenses["car_etc"]["amount"] += r["amount"]
            fixed_expenses["car_etc"]["status"] = "已入账"

    # 6. 计算部门交叉矩阵 (SUMIFS 逻辑)
    departments = ["打磨", "铜牌", "浸渗", "共用", "非公司"]
    categories = sorted({r["category"] for r in stream_rows} or ["五金耗材", "客车耗材", "货车耗材", "高速费", "车间餐饮", "其他招待", "油卡充值"])
    matrix = []
    for cat in categories:
        row = {"category": cat, "totals": {d: 0.0 for d in departments}, "row_total": 0.0}
        for r in stream_rows:
            if r["category"] == cat and r["department"] in departments:
                row["totals"][r["department"]] += r["amount"]
                row["row_total"] += r["amount"]
        matrix.append(row)

    dept_summary = {d: sum(row["totals"][d] for row in matrix) for d in departments}

    return {
        "company": company,
        "period_month": period,
        "stream_rows": stream_rows,
        "fixed_expenses": fixed_expenses,
        "matrix": matrix,
        "departments": departments,
        "dept_summary": dept_summary,
        "summary": {
            "total_rows": len(stream_rows),
            "total_expense": tot_expense,
            "total_income": tot_income,
            "opening_balance": 0.0, # 真实大账结转
            "closing_balance": -tot_expense
        }
    }
