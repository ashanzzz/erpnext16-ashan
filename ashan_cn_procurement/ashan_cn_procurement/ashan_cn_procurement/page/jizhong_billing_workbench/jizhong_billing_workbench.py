# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import calendar
from decimal import Decimal, ROUND_HALF_UP
import frappe
from frappe import _
from frappe.utils import flt, cint, getdate, today
from ashan_cn_procurement.services.permission_query_service import assert_doctype_permission
from ashan_cn_procurement.services.billing_recurring_service import get_recurring_configs


def _normalize_period(period_month):
    p = str(period_month or "").strip()
    if len(p) == 6 and p.isdigit():
        return f"{p[:4]}-{p[4:]}"
    if len(p) == 7 and "-" in p:
        return p
    return today()[:7]


def _get_gl_opening_balance(company, account_types=("Bank",), start_date="2026-01-01"):
    """穿透查询 ERPNext GL Entry 对应科目的累计借贷差额（权威期初结存）"""
    accounts = frappe.get_all(
        "Account",
        filters={"company": company, "account_type": ["in", list(account_types)]},
        pluck="name"
    )
    if not accounts:
        return 0.0

    res = frappe.db.sql(
        """
        SELECT COALESCE(SUM(debit - credit), 0.0) as bal
        FROM `tabGL Entry`
        WHERE company = %s
          AND account IN %s
          AND posting_date < %s
          AND is_cancelled = 0
          AND docstatus = 1
        """,
        (company, tuple(accounts), start_date),
        as_dict=True
    )
    return flt(res[0].bal) if res else 0.0


VOUCHER_TYPE_LABELS = {
    "Reimbursement Request": "报销单",
    "Purchase Invoice": "采购发票",
    "Payment Entry": "收付款单",
    "Journal Entry": "日记账凭证",
    "Sales Invoice": "销售发票",
    "Hardware Summary": "五金汇总",
}


def _voucher_type_label(voucher_type):
    vt = str(voucher_type or "").strip()
    return VOUCHER_TYPE_LABELS.get(vt, vt or "-")


def _get_user_fullname_map(owners):
    """批量将用户账号映射为真实中文全名"""
    clean_owners = sorted({str(o).strip() for o in (owners or []) if o})
    if not clean_owners:
        return {}
    rows = frappe.get_all(
        "User",
        filters={"name": ["in", clean_owners]},
        fields=["name", "full_name"],
    )
    out = {}
    for row in rows:
        name = row.get("name")
        full_name = (row.get("full_name") or "").strip()
        if name == "Administrator" or not full_name:
            out[name] = "系统管理员" if name == "Administrator" else str(name).split("@")[0]
        elif "@" in full_name and "." in full_name:
            out[name] = full_name.split("@")[0]
        else:
            out[name] = full_name
    return out


def _get_pi_spec_map(pi_names):
    """批量提取采购发票明细物料/规格摘要"""
    if not pi_names:
        return {}
    items = frappe.get_all(
        "Purchase Invoice Item",
        filters={"parent": ["in", list(pi_names)]},
        fields=["parent", "item_name", "description"],
        order_by="parent asc, idx asc",
    )
    grouped = {}
    for it in items:
        parent = it.get("parent")
        if not parent:
            continue
        desc = (it.get("description") or "").strip()
        if desc and "<" in desc and ">" in desc:
            desc = frappe.utils.strip_html(desc).strip()
        item_name = (it.get("item_name") or "").strip()
        if desc and item_name and desc != item_name:
            label = f"{item_name} ({desc})"
        else:
            label = desc or item_name
        if label:
            grouped.setdefault(parent, []).append(label)
    spec_map = {}
    for parent, labels in grouped.items():
        spec_map[parent] = labels[0] if len(labels) == 1 else f"{labels[0]} 等{len(labels)}项"
    return spec_map


def _get_gl_inflows(company, account_types=("Bank",), start_date="2026-01-01", end_date="2026-01-31"):
    """查询当月 GL Entry 借方流入凭证 (客户回款、投资转入、现金回款)"""
    accounts = frappe.get_all(
        "Account",
        filters={"company": company, "account_type": ["in", list(account_types)]},
        pluck="name"
    )
    if not accounts:
        return []

    entries = frappe.db.sql(
        """
        SELECT name, posting_date, debit, voucher_type, voucher_no, against, remarks, owner
        FROM `tabGL Entry`
        WHERE company = %s
          AND account IN %s
          AND posting_date BETWEEN %s AND %s
          AND debit > 0
          AND is_cancelled = 0
          AND docstatus = 1
        ORDER BY posting_date asc, name asc
        """,
        (company, tuple(accounts), start_date, end_date),
        as_dict=True
    )
    return entries


@frappe.whitelist(methods=["POST"])
def get_jizhong_billing_data(period_month=None):
    """
    获取天津吉众科技有限公司账单明细数据。
    严格对齐吉众 4 个 ERPNext 真实总账科目与对应明细：
    1. 银行-农行：对公银行账户 (大宗原料、厂房租金物业、税费、社保、客户回款)；
    2. 现金-孟祥山：日常现金报销备用金账户；
    3. 现金-无票：未附发票日常支出科目 (固定会计工资、零工等)；
    4. 现金-其他：未附发票零星与其他支出科目；
    辅助功能：五金明细 (原金普金零配件库，作为辅助核算，现金账保留月度汇总)。
    """
    assert_doctype_permission("Purchase Invoice", "read")
    company = "天津吉众科技有限公司"
    period = _normalize_period(period_month)
    y, m = period.split("-")[:2]
    last_day = calendar.monthrange(int(y), int(m))[1]
    start_date = f"{period}-01"
    end_date = f"{period}-{last_day:02d}"

    # 1. 穿透 GL Entry 计算银行与现金期初结存
    bank_opening = _get_gl_opening_balance(company, ("Bank",), start_date)
    cash_opening = _get_gl_opening_balance(company, ("Cash",), start_date)

    # 2. 抓取该月全量采购发票
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

    # 3. 抓取该月报销单
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

    # 4. 四账户分流与五金辅助库
    bank_rows = []
    cash_rows = []
    no_inv_rows = []
    no_inv_other_rows = []
    hardware_rows = []

    # 注入银行/现金流入凭证
    gl_bank_inflows = _get_gl_inflows(company, ("Bank",), start_date, end_date)
    gl_cash_inflows = _get_gl_inflows(company, ("Cash",), start_date, end_date)
    all_owners = (
        [gi.get("owner") for gi in gl_bank_inflows]
        + [gi.get("owner") for gi in gl_cash_inflows]
        + [r.get("owner") for r in rrs]
        + [p.get("owner") for p in pis]
    )
    user_map = _get_user_fullname_map(all_owners)
    pi_spec_map = _get_pi_spec_map([p.name for p in pis])

    for gi in gl_bank_inflows:
        amt = flt(gi.get("debit"))
        vtype = gi.get("voucher_type") or "GL Entry"
        vno = gi.get("voucher_no") or gi.get("name")
        clean_remark = (gi.get("remarks") or "").strip()
        p_date = str(gi.get("posting_date") or "")
        against_name = gi.get("against") or "银行资金流入"
        bank_rows.append({
            "date": p_date,
            "posting_date": p_date,
            "summary": against_name,
            "item_name": against_name,
            "specification": "-",
            "debit": amt,
            "credit": None,
            "income": amt,
            "expense": None,
            "balance": 0.0,
            "remark": clean_remark or "-",
            "note": f"{clean_remark or '银行收款'} (凭证:{vno})",
            "voucher_type": vtype,
            "voucher_type_label": _voucher_type_label(vtype),
            "voucher_no": vno,
            "invoice_no": "-",
            "creator": user_map.get(gi.get("owner"), "-")
        })

    for gi in gl_cash_inflows:
        amt = flt(gi.get("debit"))
        vtype = gi.get("voucher_type") or "GL Entry"
        vno = gi.get("voucher_no") or gi.get("name")
        clean_remark = (gi.get("remarks") or "").strip()
        p_date = str(gi.get("posting_date") or "")
        against_name = gi.get("against") or "现金提存/资金注入"
        cash_rows.append({
            "date": p_date,
            "posting_date": p_date,
            "summary": against_name,
            "item_name": against_name,
            "specification": "-",
            "debit": amt,
            "credit": None,
            "income": amt,
            "expense": None,
            "balance": 0.0,
            "remark": clean_remark or "-",
            "note": f"{clean_remark or '备用金提现/注入'} (凭证:{vno})",
            "voucher_type": vtype,
            "voucher_type_label": _voucher_type_label(vtype),
            "voucher_no": vno,
            "invoice_no": "-",
            "creator": user_map.get(gi.get("owner"), "-")
        })

    # 现金-孟祥山、现金-无票、现金-其他分流
    for item in rr_items:
        rr = rr_map.get(item.parent)
        amt = flt(item.amount)
        title = rr.title if rr else ""
        raw_inv = (item.invoice_no or "").strip()
        inv_no = "无票" if raw_inv in ("0", "00", "000", "", "无票") else raw_inv
        spec_text = (item.description or "").strip() or "-"
        clean_remark = (item.custom_line_remark or "").strip()
        remark = clean_remark or item.description or item.item_name or ""
        p_date = str(rr.posting_date) if rr else start_date
        creator_name = user_map.get(rr.owner, "-") if rr else "-"

        # 五金明细辅助库判定 (原金普金，取消死板门槛，真实五金采购全量纳入)
        if "金普金" in title or "五金" in title or "金普金" in remark or "五金" in remark:
            hw_name = item.item_name or "车间五金零配件"
            hardware_rows.append({
                "name": hw_name,
                "unit": "个",
                "qty": 1,
                "unit_price": amt,
                "total_amount": amt,
                "note": f"{p_date} {remark} (单据:{item.parent})",
                "date": p_date,
                "posting_date": p_date,
                "item_name": hw_name,
                "specification": spec_text,
                "income": None,
                "expense": amt,
                "balance": None,
                "remark": clean_remark or "-",
                "voucher_type": "Reimbursement Request",
                "voucher_type_label": _voucher_type_label("Reimbursement Request"),
                "voucher_no": item.parent,
                "invoice_no": inv_no,
                "creator": creator_name,
            })
            continue

        # 显式科目归集判定：
        # 1. 优先根据备注/标题中的显式科目声明 [现金-其他]、[现金-无票]、[现金-孟祥山]
        # 2. 若未显式声明，根据发票状态判断：未附发票归入【现金-无票】，附正规发票归入【现金-孟祥山】
        if "现金-其他" in remark or "现金-其他" in title:
            item_title = item.item_name or "未附发票支出"
            no_inv_other_rows.append({
                "date": p_date,
                "posting_date": p_date,
                "item": item_title,
                "item_name": item_title,
                "specification": spec_text,
                "income": None,
                "expense": amt,
                "balance": 0.0,
                "remark": clean_remark or "-",
                "note": f"{remark} (单据:{item.parent})",
                "voucher_type": "Reimbursement Request",
                "voucher_type_label": _voucher_type_label("Reimbursement Request"),
                "voucher_no": item.parent,
                "invoice_no": inv_no,
                "creator": creator_name
            })
        elif "现金-无票" in remark or "现金-无票" in title or inv_no == "无票" or "无发票" in title or "无票" in title:
            item_title = item.item_name or "未附发票支出"
            no_inv_rows.append({
                "date": p_date,
                "posting_date": p_date,
                "item": item_title,
                "item_name": item_title,
                "specification": spec_text,
                "income": None,
                "expense": amt,
                "balance": 0.0,
                "remark": clean_remark or "-",
                "note": f"{remark} (单据:{item.parent})",
                "voucher_type": "Reimbursement Request",
                "voucher_type_label": _voucher_type_label("Reimbursement Request"),
                "voucher_no": item.parent,
                "invoice_no": inv_no,
                "creator": creator_name
            })
        else:
            item_title = item.item_name or "现金支出"
            cash_rows.append({
                "date": p_date,
                "posting_date": p_date,
                "summary": item_title,
                "item_name": item_title,
                "specification": spec_text,
                "debit": None,
                "credit": amt,
                "income": None,
                "expense": amt,
                "balance": 0.0,
                "remark": clean_remark or "-",
                "note": f"{remark} (发票:{inv_no}, 单号:{item.parent})",
                "voucher_type": "Reimbursement Request",
                "voucher_type_label": _voucher_type_label("Reimbursement Request"),
                "voucher_no": item.parent,
                "invoice_no": inv_no,
                "creator": creator_name
            })

    # 银行账户大单路由 (直接采购发票、大宗原料、水电气、税费)
    for pi in pis:
        amt = flt(pi.grand_total)
        raw_bill = (pi.bill_no or "").strip()
        inv_no = "无票" if raw_bill in ("0", "00", "000", "", "无票") else raw_bill
        sup = pi.supplier or "供应商"
        voucher_str = f", 凭证:{pi.custom_accounting_voucher_no}" if pi.custom_accounting_voucher_no else ""
        pi_remark = (pi.remarks or "").strip()
        p_date = str(pi.posting_date)

        bank_rows.append({
            "date": p_date,
            "posting_date": p_date,
            "summary": sup,
            "item_name": sup,
            "specification": pi_spec_map.get(pi.name, "-"),
            "debit": None,
            "credit": amt,
            "income": None,
            "expense": amt,
            "balance": 0.0,
            "remark": pi_remark or "-",
            "note": f"{pi_remark or '货款结算'} (发票:{inv_no}{voucher_str}, 单号:{pi.name})",
            "voucher_type": "Purchase Invoice",
            "voucher_type_label": _voucher_type_label("Purchase Invoice"),
            "voucher_no": pi.name,
            "invoice_no": inv_no,
            "creator": user_map.get(pi.owner, "-")
        })

    # 辅助五金若有明细，在现金表自动写入一条五金月度汇总行
    if hardware_rows:
        tot_hw = sum(r["total_amount"] for r in hardware_rows)
        cash_rows.append({
            "date": end_date,
            "posting_date": end_date,
            "summary": "五金一批",
            "item_name": "五金一批",
            "specification": f"共 {len(hardware_rows)} 项五金汇总",
            "debit": None,
            "credit": tot_hw,
            "income": None,
            "expense": tot_hw,
            "balance": 0.0,
            "remark": f"{period}车间五金汇总，详见五金明细库",
            "note": f"{period}车间五金汇总，详见五金明细库 (共 {len(hardware_rows)} 项)",
            "voucher_type": "Hardware Summary",
            "voucher_type_label": _voucher_type_label("Hardware Summary"),
            "voucher_no": "-",
            "invoice_no": "-",
            "creator": "系统汇总",
            "is_highlight": True
        })

    # 排序各表并计算逐行动态结余 (Running Balance) 与序号
    bank_rows.sort(key=lambda r: (str(r.get("posting_date") or ""), 0 if r.get("income") else 1))
    curr_bank = bank_opening
    for idx, r in enumerate(bank_rows, 1):
        r["seq"] = idx
        curr_bank += flt(r.get("debit") or 0.0) - flt(r.get("credit") or 0.0)
        r["balance"] = curr_bank

    cash_rows.sort(key=lambda r: (str(r.get("posting_date") or ""), 0 if r.get("income") else 1))
    curr_cash = cash_opening
    for idx, r in enumerate(cash_rows, 1):
        r["seq"] = idx
        curr_cash += flt(r.get("debit") or 0.0) - flt(r.get("credit") or 0.0)
        r["balance"] = curr_cash

    no_inv_rows.sort(key=lambda r: (str(r.get("posting_date") or ""), 0 if r.get("income") else 1))
    curr_no_inv = 0.0
    for idx, r in enumerate(no_inv_rows, 1):
        r["seq"] = idx
        curr_no_inv += flt(r.get("income") or 0.0) - flt(r.get("expense") or 0.0)
        r["balance"] = curr_no_inv

    no_inv_other_rows.sort(key=lambda r: (str(r.get("posting_date") or ""), 0 if r.get("income") else 1))
    curr_other = 0.0
    for idx, r in enumerate(no_inv_other_rows, 1):
        r["seq"] = idx
        curr_other += flt(r.get("income") or 0.0) - flt(r.get("expense") or 0.0)
        r["balance"] = curr_other

    hardware_rows.sort(key=lambda r: str(r.get("posting_date") or ""))
    for idx, r in enumerate(hardware_rows, 1):
        r["seq"] = idx

    # 检查月度核定锁定状态
    is_locked = 0
    closing_name = f"INV-CLOSE-{company}-{period}"
    if frappe.db.exists("Monthly Invoice Closing", closing_name):
        st = frappe.db.get_value("Monthly Invoice Closing", closing_name, "status")
        if st == "已核定":
            is_locked = 1

    account_names = {
        "bank": "银行-农行",
        "cash": "现金-孟祥山",
        "no_inv": "现金-无票",
        "no_inv_other": "现金-其他"
    }

    return {
        "company": company,
        "period_month": period,
        "is_locked": is_locked,
        "account_names": account_names,
        "bank_opening": bank_opening,
        "cash_opening": cash_opening,
        "no_inv_opening": 0.0,
        "no_inv_other_opening": 0.0,
        "bank_rows": bank_rows,
        "cash_rows": cash_rows,
        "no_inv_rows": no_inv_rows,
        "no_inv_other_rows": no_inv_other_rows,
        "hardware_rows": hardware_rows,
        "summary": {
            "bank_count": len(bank_rows),
            "bank_total": sum(flt(r["credit"]) for r in bank_rows if r["credit"]),
            "bank_inflow": sum(flt(r["debit"]) for r in bank_rows if r["debit"]),
            "bank_closing": curr_bank,
            "cash_count": len(cash_rows),
            "cash_total": sum(flt(r["credit"]) for r in cash_rows if r["credit"]),
            "cash_inflow": sum(flt(r["debit"]) for r in cash_rows if r["debit"]),
            "cash_closing": curr_cash,
            "no_inv_count": len(no_inv_rows),
            "no_inv_inflow": sum(flt(r["income"]) for r in no_inv_rows if r.get("income")),
            "no_inv_total": sum(flt(r["expense"]) for r in no_inv_rows if r["expense"]),
            "no_inv_closing": curr_no_inv,
            "no_inv_other_count": len(no_inv_other_rows),
            "no_inv_other_inflow": sum(flt(r["income"]) for r in no_inv_other_rows if r.get("income")),
            "no_inv_other_total": sum(flt(r["expense"]) for r in no_inv_other_rows if r["expense"]),
            "no_inv_other_closing": curr_other,
            "hardware_count": len(hardware_rows),
            "hardware_total": sum(flt(r["total_amount"]) for r in hardware_rows)
        }
    }


@frappe.whitelist(methods=["POST"])
def create_quick_jizhong_expense(posting_date, item_name, amount, account_category="现金-无票", invoice_no=None, remarks=None, specification=None):
    """吉众就地快捷记账通道：自动生成已过账生效的报销单 (Reimbursement Request)"""
    assert_doctype_permission("Purchase Invoice", "write")
    amt = flt(amount)
    if amt <= 0:
        frappe.throw(_("支出金额必须大于 0！"))

    p_date = str(posting_date or today())
    company = "天津吉众科技有限公司"
    spec_val = (specification or "").strip()
    remark_val = (remarks or "").strip()

    rr = frappe.new_doc("Reimbursement Request")
    rr.company = company
    rr.posting_date = p_date
    rr.title = f"【吉众记账】{p_date} {item_name} [{account_category}] ¥{amt:,.2f}"
    rr.total_amount = amt
    rr.paid_amount = amt
    rr.outstanding_amount = 0.0
    rr.payment_status = "已付款"

    inv = invoice_no or ("无票" if "无票" in str(account_category) else "0")
    rr.append("invoice_items", {
        "item_name": item_name,
        "description": spec_val,
        "qty": 1,
        "rate": amt,
        "amount": amt,
        "invoice_no": inv,
        "custom_line_remark": remark_val or f"{item_name} [{account_category}]",
    })
    rr.insert()
    rr.submit()

    return {
        "status": "ok",
        "doc_name": rr.name,
        "amount": amt,
        "message": f"成功录单并过账已生效：{rr.name}"
    }


@frappe.whitelist(methods=["POST"])
def toggle_jizhong_billing_lock(period_month, lock=1):
    """月度账单核定锁定与反审核解锁状态机"""
    assert_doctype_permission("Purchase Invoice", "write")
    company = "天津吉众科技有限公司"
    period = _normalize_period(period_month)
    closing_name = f"INV-CLOSE-{company}-{period}"
    is_lock = 1 if cint(lock) else 0

    if frappe.db.exists("Monthly Invoice Closing", closing_name):
        doc = frappe.get_doc("Monthly Invoice Closing", closing_name)
    else:
        doc = frappe.new_doc("Monthly Invoice Closing")
        doc.company = company
        doc.period = period

    doc.status = "已核定" if is_lock else "已解锁"
    doc.set("is_locked", is_lock)
    doc.save()

    return {
        "status": "ok",
        "is_locked": is_lock,
        "message": f"吉众账期【{period}】已成功{'核定封账 🔒' if is_lock else '反审核解锁 🟡'}"
    }
