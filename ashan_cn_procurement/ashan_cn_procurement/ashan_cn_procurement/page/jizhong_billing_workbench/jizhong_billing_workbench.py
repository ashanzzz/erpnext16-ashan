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
def get_jizhong_billing_data(period_month=None):
    """
    获取天津吉众科技有限公司账单明细数据。
    严格对齐吉众 4 个账户与对应账单：
    1. 银行：对公银行账户 (大宗原料、厂房租金物业、税费、社保、客户回款)；
    2. 现金：车间日常现金报销小票账户；
    3. 无票：普通采购无发票支出账户 (固定会计工资 ¥2,400、零工等)；
    4. 无票其他：零散与其它无发票支出账户；
    辅助功能：五金明细 (原金普金零配件库，作为辅助核算，现金账保留月度汇总)。
    """
    assert_doctype_permission("Purchase Invoice", "read")
    company = "天津吉众科技有限公司"
    period = _normalize_period(period_month)
    y, m = period.split("-")[:2]
    from calendar import monthrange
    last_day = monthrange(int(y), int(m))[1]
    start_date = f"{period}-01"
    end_date = f"{period}-{last_day:02d}"

    # 1. 抓取该月全量采购发票
    pis = frappe.get_all(
        "Purchase Invoice",
        filters={
            "company": company,
            "docstatus": 1,
            "posting_date": ["between", [start_date, end_date]],
        },
        fields=[
            "name", "posting_date", "bill_no", "bill_date", "supplier",
            "grand_total", "outstanding_amount", "remarks", "owner",
            "custom_accounting_voucher_no"
        ],
        order_by="posting_date asc, name asc"
    )

    # 2. 抓取该月报销单
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

    # 3. 四账户分流与五金辅助库
    bank_rows = []
    cash_rows = []
    no_inv_rows = []
    no_inv_other_rows = []
    hardware_rows = []

    # 现金轨、无票、无票其他分流
    for item in rr_items:
        rr = rr_map.get(item.parent)
        amt = flt(item.amount)
        title = rr.title if rr else ""
        inv_no = item.invoice_no or ""
        remark = item.custom_line_remark or item.description or item.item_name or ""
        p_date = str(rr.posting_date) if rr else start_date

        # 五金明细辅助库判定 (原金普金)
        if ("金普金" in title or "五金" in title) and amt > 300:
            hardware_rows.append({
                "name": item.item_name or "车间五金零配件",
                "unit": "个",
                "qty": 1,
                "unit_price": amt,
                "total_amount": amt,
                "note": f"{p_date} {remark} (单据:{item.parent})"
            })
            continue

        # 无发票判定
        is_no_inv = inv_no in ("0", "00", "000", "", "无票") or "无发票" in title or "无票" in title
        if is_no_inv:
            # 区分“无票”与“无票其他”
            if any(k in remark for k in ["其他", "杂项", "临时", "外借", "零星备用"]):
                no_inv_other_rows.append({
                    "date": p_date,
                    "item": item.item_name or "其他无票支出",
                    "income": None,
                    "expense": amt,
                    "balance": 0.0,
                    "note": f"{remark} (报销单:{item.parent})"
                })
            else:
                no_inv_rows.append({
                    "date": p_date,
                    "item": item.item_name or "普通采购支出",
                    "income": None,
                    "expense": amt,
                    "balance": 0.0,
                    "note": f"{remark} (报销单:{item.parent})"
                })
        else:
            cash_rows.append({
                "date": p_date,
                "summary": item.item_name or "零星费用",
                "debit": None,
                "credit": amt,
                "balance": 0.0,
                "note": f"{remark} (发票:{inv_no}, 报销单:{item.parent})"
            })

    # 银行对公账户大单路由 (直接采购发票、大宗原料、水电气、税费)
    for pi in pis:
        amt = flt(pi.grand_total)
        inv_no = pi.bill_no or "无票"
        sup = pi.supplier or "公对公供应商"
        voucher_str = f", 凭证:{pi.custom_accounting_voucher_no}" if pi.custom_accounting_voucher_no else ""
        
        bank_rows.append({
            "date": str(pi.posting_date),
            "summary": sup,
            "debit": None,
            "credit": amt,
            "balance": 0.0,
            "note": f"{pi.remarks or '货款结算'} (发票:{inv_no}{voucher_str}, 单号:{pi.name})"
        })

    # 辅助五金若有明细，在现金表自动写入一条五金月度汇总行
    if hardware_rows:
        tot_hw = sum(r["total_amount"] for r in hardware_rows)
        cash_rows.append({
            "date": end_date,
            "summary": "五金一批",
            "debit": None,
            "credit": tot_hw,
            "balance": 0.0,
            "note": f"{period}车间五金汇总，详见五金明细库 (共 {len(hardware_rows)} 项)"
        })

    # 检查无票表是否有固定会计工资行 (每月15日)
    has_accountant = any("会计工资" in r["note"] or "会计" in r["item"] for r in no_inv_rows)
    if not has_accountant:
        no_inv_rows.insert(0, {
            "date": f"{period}-15",
            "item": "员工-会计工资",
            "income": None,
            "expense": 2400.0,
            "balance": 0.0,
            "note": f"{period}会计工资 (固定无发票支出)"
        })

    # 排序各表
    cash_rows.sort(key=lambda r: r["date"])
    no_inv_rows.sort(key=lambda r: r["date"])
    no_inv_other_rows.sort(key=lambda r: r["date"])
    bank_rows.sort(key=lambda r: r["date"])

    return {
        "company": company,
        "period_month": period,
        "bank_rows": bank_rows,
        "cash_rows": cash_rows,
        "no_inv_rows": no_inv_rows,
        "no_inv_other_rows": no_inv_other_rows,
        "hardware_rows": hardware_rows,
        "summary": {
            "bank_count": len(bank_rows),
            "bank_total": sum(flt(r["credit"]) for r in bank_rows if r["credit"]),
            "cash_count": len(cash_rows),
            "cash_total": sum(flt(r["credit"]) for r in cash_rows if r["credit"]),
            "no_inv_count": len(no_inv_rows),
            "no_inv_total": sum(flt(r["expense"]) for r in no_inv_rows if r["expense"]),
            "no_inv_other_count": len(no_inv_other_rows),
            "no_inv_other_total": sum(flt(r["expense"]) for r in no_inv_other_rows if r["expense"]),
            "hardware_count": len(hardware_rows),
            "hardware_total": sum(flt(r["total_amount"]) for r in hardware_rows)
        }
    }
