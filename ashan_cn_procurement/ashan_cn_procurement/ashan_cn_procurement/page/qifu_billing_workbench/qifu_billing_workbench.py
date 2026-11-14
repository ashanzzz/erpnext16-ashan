# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

from typing import Any
import frappe
from frappe import _
from frappe.utils import flt, today
from ashan_cn_procurement.services.permission_query_service import assert_doctype_permission
from ashan_cn_procurement.services.billing_trace_service import trace_transaction_source


def _normalize_period(period_month: str | None) -> str:
    p = str(period_month or "").strip()
    if len(p) == 6 and p.isdigit():
        return f"{p[:4]}-{p[4:]}"
    if len(p) == 7 and "-" in p:
        return p
    return today()[:7]


@frappe.whitelist(methods=["POST"])
def get_qifu_billing_data(period_month: str | None = None) -> dict[str, Any]:
    """
    获取天津祺富机械加工有限公司现金大账与报销明细数据。
    严格对齐祺富大账簿业务边界：
    1. 仅核算孟祥山现金报销轨 (现金账单-孟祥山 - 祺富)；
    2. 全链路穿透追溯：初始单据类型/单号、业务单据链、付款状态与凭证；
    3. 严禁混入公对公电汇直付大单；
    4. 提取四大核心常态支出与费用科目汇总。
    """
    assert_doctype_permission("Purchase Invoice", "read")
    company = "天津祺富机械加工有限公司"
    period = _normalize_period(period_month)
    y, m = period.split("-")[:2]
    from calendar import monthrange
    last_day = monthrange(int(y), int(m))[1]
    start_date = f"{period}-01"
    end_date = f"{period}-{last_day:02d}"

    # 1. 查询当期现金模式采购发票 (以过账日期落在当月为准，严禁混入公对公电汇)
    pis = frappe.get_all(
        "Purchase Invoice",
        filters={
            "company": company,
            "docstatus": 1,
            "posting_date": ["between", [start_date, end_date]],
            "custom_biz_mode": "现金报销",
        },
        fields=[
            "name", "posting_date", "bill_no", "bill_date", "supplier",
            "grand_total", "outstanding_amount", "remarks", "owner", "custom_biz_mode"
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
            "payment_status", "owner", "custom_biz_mode"
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

    # 3. 构造现金流水账数据并注入全链路追溯
    stream_rows = []
    tot_expense = 0.0
    tot_income = 0.0

    seq = 1
    handled_pis = set()
    for item in rr_items:
        rr = rr_map.get(item.parent)
        amt = flt(item.amount)
        tot_expense += amt
        if item.source_pi:
            handled_pis.add(item.source_pi)

        remark = str(item.custom_line_remark or item.description or item.item_name or "")

        # 类别判定
        cat = "五金耗材"
        if any(k in remark for k in ["维修", "保养", "轮胎", "验车"]):
            cat = "客车耗材" if ("轿车" in remark or "跑车" in remark) else "货车耗材"
        elif "高速" in remark or "ETC" in remark:
            cat = "高速费"
        elif "餐" in remark:
            cat = "车间餐饮"
        elif "招待" in remark:
            cat = "其他招待"
        elif "油" in remark:
            cat = "油卡充值"
        elif "运费" in remark or "快递" in remark:
            cat = "其他服务费"

        inv_no = item.invoice_no or "无票"
        if inv_no in ("0", "00", "000"):
            inv_no = "无票"

        # 全链路单据穿透追溯
        trace = trace_transaction_source(
            rr_name=item.parent,
            pi_name=item.source_pi,
            company=company
        )

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
            "mode": "现金",
            "usage": item.custom_line_remark or item.description or item.item_name or "",
            "reimbursement_no": item.parent,
            "request_no": trace.get("mr_name") or "",
            "receipt_no": trace.get("pr_name") or "",
            "invoice_no": inv_no,
            "creator": frappe.db.get_value("User", rr.owner, "full_name") if rr and rr.owner else "孟祥山",
            # 新增全链路追溯字段
            "initial_doc_type": trace["initial_doc_type"],
            "initial_doc_name": trace["initial_doc_name"],
            "chain_summary": trace["chain_summary"],
            "mr_name": trace["mr_name"],
            "pr_name": trace["pr_name"],
            "pi_name": trace["pi_name"],
            "rr_name": trace["rr_name"],
            "pe_name": trace["pe_name"],
            "payment_status": trace["payment_status"],
            "paid_from_account": trace["paid_from_account"],
            "mode_of_payment": trace["mode_of_payment"],
            "paid_date": trace["paid_date"],
        })
        seq += 1

    # 4. 补充未做 RR 的直接现金采购发票 (仅限现金报销模式，公对公电汇严禁混入)
    for pi in pis:
        if pi.name in handled_pis:
            continue
        amt = flt(pi.grand_total)
        tot_expense += amt
        inv_no = pi.bill_no or "无票"
        if inv_no in ("0", "00", "000"):
            inv_no = "无票"

        trace = trace_transaction_source(pi_name=pi.name, company=company)

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
            "mode": "现金",
            "usage": pi.remarks or "采购发票直接支出",
            "reimbursement_no": "",
            "request_no": trace.get("mr_name") or "",
            "receipt_no": trace.get("pr_name") or "",
            "invoice_no": inv_no,
            "creator": frappe.db.get_value("User", pi.owner, "full_name") if pi.owner else "孟祥山",
            "initial_doc_type": trace["initial_doc_type"],
            "initial_doc_name": trace["initial_doc_name"],
            "chain_summary": trace["chain_summary"],
            "mr_name": trace["mr_name"],
            "pr_name": trace["pr_name"],
            "pi_name": trace["pi_name"],
            "rr_name": trace["rr_name"],
            "pe_name": trace["pe_name"],
            "payment_status": trace["payment_status"],
            "paid_from_account": trace["paid_from_account"],
            "mode_of_payment": trace["mode_of_payment"],
            "paid_date": trace["paid_date"],
        })
        seq += 1

    # 按记账日期与单据排序
    stream_rows.sort(key=lambda x: (x["posting_date"], x["seq"]))

    # 5. 汇总四大固定支出状态
    fixed_expenses = {
        "naidi_hospitality": {"name": "耐迪保密招待费", "amount": 3200.0, "status": "待确认", "note": "固定保密支出，仅大账簿核算"},
        "truck_toll": {"name": "货车高速费明细", "amount": 0.0, "status": "待月结", "note": "货车高速费台账月结汇总"},
        "sinopec_fuel": {"name": "中石化油卡充值", "amount": 0.0, "status": "待出资确认", "note": "车间卡+个人卡现金实际垫付出资"},
        "car_etc": {"name": "轿车ETC通行费", "amount": 0.0, "status": "待发票汇总", "note": "票根网数电发票月末合并总金额"}
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

    # 6. 按科目汇总分类统计
    cat_map: dict[str, dict[str, Any]] = {}
    for r in stream_rows:
        c = r["category"]
        if c not in cat_map:
            cat_map[c] = {"category": c, "count": 0, "amount": 0.0}
        cat_map[c]["count"] += 1
        cat_map[c]["amount"] += r["amount"]

    category_summary = sorted(cat_map.values(), key=lambda x: x["amount"], reverse=True)

    return {
        "company": company,
        "period_month": period,
        "stream_rows": stream_rows,
        "fixed_expenses": fixed_expenses,
        "category_summary": category_summary,
        "summary": {
            "total_rows": len(stream_rows),
            "total_expense": tot_expense,
            "total_income": tot_income,
            "opening_balance": 0.0,
            "closing_balance": -tot_expense,
        }
    }


@frappe.whitelist(methods=["POST"])
def quick_create_qifu_cash_entry(
    posting_date: str,
    title: str,
    amount: float,
    category: str = "五金耗材",
    usage: str = "",
    invoice_no: str = "无票",
    spec: str = "-"
) -> dict[str, Any]:
    """
    在祺富账单工作台中快速录入一笔现金单据（支持快捷键 Alt+N 呼出），
    直接生成正式生效的 Reimbursement Request 报销单。
    """
    assert_doctype_permission("Reimbursement Request", "create")
    company = "天津祺富机械加工有限公司"
    amt = flt(amount)
    if amt <= 0:
        frappe.throw(_("金额必须大于 0！"))

    rr = frappe.new_doc("Reimbursement Request")
    rr.company = company
    rr.posting_date = posting_date or today()
    rr.title = title or "零星现金报销"
    rr.custom_biz_mode = "现金报销"
    rr.total_amount = amt
    rr.paid_amount = amt
    rr.payment_status = "已付款"
    rr.docstatus = 1
    rr.owner = frappe.session.user

    rr.append("invoice_items", {
        "invoice_no": invoice_no or "无票",
        "item_name": title,
        "qty": 1.0,
        "uom": "项",
        "rate": amt,
        "amount": amt,
        "custom_line_remark": usage or title,
        "description": spec or "-",
        "supplier": "其它供应商"
    })
    rr.insert()

    return {
        "status": "ok",
        "name": rr.name,
        "message": f"现金报销单【{rr.name}】（¥{amt:,.2f}）已成功入账！"
    }
