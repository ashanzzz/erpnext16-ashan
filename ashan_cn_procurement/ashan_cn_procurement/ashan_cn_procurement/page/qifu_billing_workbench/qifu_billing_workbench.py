# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import calendar
from decimal import Decimal, ROUND_HALF_UP
import frappe
from frappe import _
from frappe.utils import flt, cint, getdate, today
from ashan_cn_procurement.services.permission_query_service import assert_doctype_permission
from ashan_cn_procurement.services.billing_recurring_service import (
    build_tax_invoice_seller_lookup,
    get_recurring_configs,
    get_registered_supplier_set,
    resolve_counterparty_info,
    resolve_pi_item_and_spec_map,
    resolve_tax_invoice_seller,
    sanitize_spec_text,
)


def _normalize_period(period_month):
    p = str(period_month or "").strip()
    if len(p) == 6 and p.isdigit():
        return f"{p[:4]}-{p[4:]}"
    if len(p) == 7 and "-" in p:
        return p
    return today()[:7]


def _get_gl_opening_balance(company, account_types=("Cash", "Bank"), start_date="2026-01-01"):
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


def _get_gl_inflows(company, account_types=("Cash", "Bank"), start_date="2026-01-01", end_date="2026-01-31"):
    """查询当月 GL Entry 借方流入凭证 (资金注入、客户回款、报销退款)"""
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
def get_qifu_billing_data(period_month=None):
    """
    获取天津祺富机械加工有限公司现金大账与报销明细数据。
    严格对齐祺富大账簿业务边界：
    1. 仅核算孟祥山现金报销轨 (现金账单-孟祥山 - 祺富)；
    2. 穿透关联 Reimbursement Request、Purchase Invoice 与 Payment Entry；
    3. 穿透 GL Entry 汇算期初结存，保障四柱闭式平账与逐行动态余额；
    4. 提取四大核心常态支出看板 (动态对接固定支出配置，彻底根除硬编码)。
    """
    assert_doctype_permission("Purchase Invoice", "read")
    company = "天津祺富机械加工有限公司"
    period = _normalize_period(period_month)
    y, m = period.split("-")[:2]
    last_day = calendar.monthrange(int(y), int(m))[1]
    start_date = f"{period}-01"
    end_date = f"{period}-{last_day:02d}"

    # 1. 穿透 GL Entry 计算期初结存
    opening_balance = _get_gl_opening_balance(company, ("Cash", "Bank"), start_date)

    # 2. 查询当期采购发票 (以过账日期落在当月为准)
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

    # 3. 查询当期报销单及关联明细
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
                "name", "parent", "source_pi", "source_tax_invoice", "supplier",
                "invoice_no", "item_name", "description", "amount", "custom_line_remark"
            ],
            order_by="parent asc, idx asc",
        )

    # 4. 构造现金流水账数据
    stream_rows = []
    tot_expense = 0.0
    tot_income = 0.0
    handled_pis = set()

    # 注入 GL Entry 借方资金流入，并批量提取供应商/税控发票与物料规格档案
    gl_inflows = _get_gl_inflows(company, ("Cash", "Bank"), start_date, end_date)
    all_owners = (
        [gi.get("owner") for gi in gl_inflows]
        + [r.get("owner") for r in rrs]
        + [p.get("owner") for p in pis]
    )
    user_map = _get_user_fullname_map(all_owners)

    pi_info_map = {p.name: p for p in pis}
    extra_rr_pis = sorted({it.source_pi for it in rr_items if it.source_pi and it.source_pi not in pi_info_map})
    if extra_rr_pis:
        for p in frappe.get_all(
            "Purchase Invoice",
            filters={"name": ["in", extra_rr_pis]},
            fields=["name", "supplier", "bill_no"],
            order_by="name asc",
        ):
            pi_info_map[p.name] = p

    all_pi_names = sorted(pi_info_map.keys())
    pi_item_spec_map = resolve_pi_item_and_spec_map(all_pi_names)
    ti_names = [it.source_tax_invoice for it in rr_items if it.source_tax_invoice]
    all_inv_nos = [it.invoice_no for it in rr_items if it.invoice_no] + [p.get("bill_no") for p in pi_info_map.values() if p.get("bill_no")]
    tax_lookup = build_tax_invoice_seller_lookup(ti_names=ti_names, pi_names=all_pi_names, invoice_nos=all_inv_nos)
    registered_suppliers = get_registered_supplier_set()

    for gi in gl_inflows:
        amt = flt(gi.get("debit"))
        tot_income += amt
        vtype = gi.get("voucher_type") or "GL Entry"
        vno = gi.get("voucher_no") or gi.get("name")
        remark_text = (gi.get("remarks") or "").strip()
        item_label = gi.get("against") or remark_text or "资金注入/往来回款"
        stream_rows.append({
            "posting_date": str(gi.get("posting_date") or ""),
            "voucher_date": str(gi.get("posting_date") or ""),
            "item_name": item_label,
            "item_name_full": item_label,
            "specification": "-",
            "specification_full": "-",
            "unit_price": amt,
            "qty": 1,
            "unit": "笔",
            "amount": amt,
            "income": amt,
            "expense": None,
            "direction": "收入",
            "user": "财务部",
            "reviewer": "祺富",
            "category": "资金流入",
            "mode": "现金/银行",
            "remark": remark_text or "-",
            "usage": remark_text or f"凭证 {vno}",
            "voucher_type": vtype,
            "voucher_type_label": _voucher_type_label(vtype),
            "voucher_no": vno,
            "reimbursement_no": vno,
            "request_no": "",
            "counterparty": "-",
            "is_registered_supplier": True,
            "invoice_no": "-",
            "creator": user_map.get(gi.get("owner"), "-")
        })

    # 处理报销支出流水
    for item in rr_items:
        rr = rr_map.get(item.parent)
        amt = flt(item.amount)
        tot_expense += amt
        if item.source_pi:
            handled_pis.add(item.source_pi)

        pi_info = pi_info_map.get(item.source_pi, {})
        pi_meta = pi_item_spec_map.get(item.source_pi, {})
        raw_inv = (item.invoice_no or "").strip() or (pi_info.get("bill_no") or "").strip()
        inv_no = "无票" if raw_inv in ("0", "00", "000", "", "无票") else raw_inv

        tax_seller = resolve_tax_invoice_seller(
            tax_lookup,
            ti_name=item.source_tax_invoice,
            pi_names=[item.source_pi] if item.source_pi else None,
            invoice_no=inv_no,
        )
        fallback_supplier = (item.supplier or "").strip() or (pi_info.get("supplier") or "").strip()
        counterparty, is_reg = resolve_counterparty_info(tax_seller, fallback_supplier, registered_suppliers)

        raw_item_name = (item.item_name or "").strip()
        if (not raw_item_name or raw_item_name in ("其它", fallback_supplier, tax_seller)) and pi_meta.get("item_name"):
            item_title = pi_meta["item_name"]
            item_full = pi_meta.get("item_name_full") or item_title
        else:
            item_title = raw_item_name or "其它"
            item_full = pi_meta.get("item_name_full") or item_title

        spec_text = sanitize_spec_text(item.description, item_title)
        spec_full = spec_text
        if spec_text == "-" and pi_meta.get("specification") and pi_meta["specification"] != "-":
            spec_text = pi_meta["specification"]
            spec_full = pi_meta.get("specification_full") or spec_text

        clean_remark = (item.custom_line_remark or "").strip()
        remark = str(clean_remark or item.description or item_title or "")
        match_text = f"{remark} {rr.title if rr else ''}"

        # 类别判定
        cat = "五金耗材"
        if any(k in match_text for k in ["维修", "保养", "轮胎", "验车", "货车耗材", "客车耗材"]):
            cat = "客车耗材" if ("轿车" in match_text or "跑车" in match_text or "客车耗材" in match_text) else "货车耗材"
        elif "高速" in match_text or "ETC" in match_text:
            cat = "高速费"
        elif "餐" in match_text:
            cat = "车间餐饮"
        elif "招待" in match_text:
            cat = "其他招待"
        elif "油" in match_text:
            cat = "油卡充值"
        elif "运费" in match_text or "快递" in match_text or "其他服务费" in match_text:
            cat = "其他服务费"

        creator_name = user_map.get(rr.owner, "-") if rr else "-"

        stream_rows.append({
            "posting_date": str(rr.posting_date) if rr else "",
            "voucher_date": str(rr.posting_date) if rr else "",
            "item_name": item_title,
            "item_name_full": item_full,
            "specification": spec_text,
            "specification_full": spec_full,
            "unit_price": amt,
            "qty": 1,
            "unit": "项",
            "amount": amt,
            "income": None,
            "expense": amt,
            "direction": "支出",
            "user": "祺富",
            "reviewer": "祺富",
            "category": cat,
            "mode": "现金",
            "remark": clean_remark or "-",
            "usage": remark,
            "voucher_type": "Reimbursement Request",
            "voucher_type_label": _voucher_type_label("Reimbursement Request"),
            "voucher_no": item.parent,
            "reimbursement_no": item.parent,
            "request_no": "",
            "counterparty": counterparty,
            "is_registered_supplier": is_reg,
            "invoice_no": inv_no,
            "creator": creator_name
        })

    # 补充未做 RR 的直接采购发票 (如果有)
    for pi in pis:
        if pi.name in handled_pis:
            continue
        amt = flt(pi.grand_total)
        tot_expense += amt
        raw_bill = (pi.bill_no or "").strip()
        inv_no = "无票" if raw_bill in ("0", "00", "000", "", "无票") else raw_bill
        pi_remark = (pi.remarks or "").strip()
        pi_meta = pi_item_spec_map.get(pi.name, {})
        item_title = pi_meta.get("item_name") or pi_remark or "采购支出"
        item_full = pi_meta.get("item_name_full") or item_title
        spec_text = pi_meta.get("specification") or "-"
        spec_full = pi_meta.get("specification_full") or spec_text
        tax_seller = resolve_tax_invoice_seller(tax_lookup, pi_names=[pi.name], invoice_no=inv_no)
        counterparty, is_reg = resolve_counterparty_info(tax_seller, pi.supplier, registered_suppliers)

        stream_rows.append({
            "posting_date": str(pi.posting_date),
            "voucher_date": str(pi.bill_date or pi.posting_date),
            "item_name": item_title,
            "item_name_full": item_full,
            "specification": spec_text,
            "specification_full": spec_full,
            "unit_price": amt,
            "qty": 1,
            "unit": "笔",
            "amount": amt,
            "income": None,
            "expense": amt,
            "direction": "支出",
            "user": "祺富",
            "reviewer": "祺富",
            "category": "其他服务费",
            "mode": "现金",
            "remark": pi_remark or "-",
            "usage": pi_remark or "采购发票直接支出",
            "voucher_type": "Purchase Invoice",
            "voucher_type_label": _voucher_type_label("Purchase Invoice"),
            "voucher_no": pi.name,
            "reimbursement_no": pi.name,
            "request_no": "",
            "counterparty": counterparty,
            "is_registered_supplier": is_reg,
            "invoice_no": inv_no,
            "creator": user_map.get(pi.owner, "-")
        })

    # 时序排序并计算逐行动态结余 (Running Balance)
    stream_rows.sort(key=lambda r: (str(r.get("posting_date") or ""), r.get("direction") == "支出"))
    curr_balance = opening_balance
    for idx, r in enumerate(stream_rows, 1):
        r["seq"] = idx
        if r.get("direction") == "收入":
            curr_balance += r.get("amount", 0.0)
        else:
            curr_balance -= r.get("amount", 0.0)
        r["balance"] = curr_balance

    closing_balance = curr_balance

    # 5. 动态核验四大固定支出状态 (彻底解耦硬编码，基于常态支出配置底册)
    recurring_cfgs = {c.get("expense_name"): c for c in get_recurring_configs(company=company)}
    naidi_cfg = recurring_cfgs.get("耐迪保密招待费", {})
    naidi_default = flt(naidi_cfg.get("default_amount") or 3200.0)

    fixed_expenses = {
        "naidi_hospitality": {
            "name": "耐迪保密招待费",
            "amount": 0.0,
            "default_amount": naidi_default,
            "status": "待录入/待生成",
            "note": "固定保密支出，仅大账簿核算"
        },
        "truck_toll": {
            "name": "货车高速费明细",
            "amount": 0.0,
            "default_amount": 0.0,
            "status": "待月结",
            "note": "货车高速费台账月结汇总"
        },
        "sinopec_fuel": {
            "name": "中石化油卡充值",
            "amount": 0.0,
            "default_amount": 0.0,
            "status": "待出资确认",
            "note": "车间卡+个人卡现金实际垫付出资"
        },
        "car_etc": {
            "name": "轿车ETC通行费",
            "amount": 0.0,
            "default_amount": 0.0,
            "status": "待发票汇总",
            "note": "票根网数电发票月末合并总金额"
        }
    }

    for r in stream_rows:
        usage_str = str(r.get("usage") or "")
        item_str = str(r.get("item_name") or "")
        cat_str = str(r.get("category") or "")
        if "耐迪" in usage_str or "耐迪" in item_str:
            fixed_expenses["naidi_hospitality"]["amount"] = r["amount"]
            fixed_expenses["naidi_hospitality"]["status"] = "已入账"
        elif "货车高速" in usage_str:
            fixed_expenses["truck_toll"]["amount"] += r["amount"]
            fixed_expenses["truck_toll"]["status"] = "已入账"
        elif "油卡" in cat_str or "加油" in usage_str:
            fixed_expenses["sinopec_fuel"]["amount"] += r["amount"]
            fixed_expenses["sinopec_fuel"]["status"] = "已入账"
        elif "ETC" in usage_str or "轿车ETC" in item_str:
            fixed_expenses["car_etc"]["amount"] += r["amount"]
            fixed_expenses["car_etc"]["status"] = "已入账"

    # 6. 按科目汇总分类统计
    cat_map = {}
    for r in stream_rows:
        if r.get("direction") == "收入":
            continue
        c = r["category"]
        if c not in cat_map:
            cat_map[c] = {"category": c, "count": 0, "amount": 0.0}
        cat_map[c]["count"] += 1
        cat_map[c]["amount"] += r["amount"]

    category_summary = sorted(cat_map.values(), key=lambda x: x["amount"], reverse=True)

    # 7. 检查月度核定锁定状态
    is_locked = 0
    closing_name = f"INV-CLOSE-{company}-{period}"
    if frappe.db.exists("Monthly Invoice Closing", closing_name):
        st = frappe.db.get_value("Monthly Invoice Closing", closing_name, "status")
        if st == "已核定":
            is_locked = 1

    return {
        "company": company,
        "period_month": period,
        "is_locked": is_locked,
        "stream_rows": stream_rows,
        "fixed_expenses": fixed_expenses,
        "category_summary": category_summary,
        "summary": {
            "total_rows": len(stream_rows),
            "total_expense": tot_expense,
            "total_income": tot_income,
            "opening_balance": opening_balance,
            "closing_balance": closing_balance
        }
    }


@frappe.whitelist(methods=["POST"])
def create_quick_billing_expense(company, posting_date, item_name, amount, category="日常费用支出", invoice_no=None, remarks=None, account_category=None, specification=None):
    """就地快捷记账通道：自动生成已过账生效的报销单 (Reimbursement Request)"""
    assert_doctype_permission("Purchase Invoice", "write")
    amt = flt(amount)
    if amt <= 0:
        frappe.throw(_("支出金额必须大于 0！"))

    p_date = str(posting_date or today())
    company_name = company or "天津祺富机械加工有限公司"
    spec_val = (specification or "").strip()
    remark_val = (remarks or "").strip()

    rr = frappe.new_doc("Reimbursement Request")
    rr.company = company_name
    rr.posting_date = p_date
    rr.title = f"【就地记账】{p_date} {item_name} [{category or '现金支出'}] ¥{amt:,.2f}"
    rr.total_amount = amt
    rr.paid_amount = amt
    rr.outstanding_amount = 0.0
    rr.payment_status = "已付款"

    inv = invoice_no or "无票"
    rr.append("invoice_items", {
        "item_name": item_name,
        "description": spec_val,
        "qty": 1,
        "rate": amt,
        "amount": amt,
        "invoice_no": inv,
        "custom_line_remark": remark_val or f"{item_name} [{category or '现金支出'}]",
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
def toggle_monthly_billing_lock(company, period_month, lock=1):
    """月度账单核定锁定与反审核解锁状态机"""
    assert_doctype_permission("Purchase Invoice", "write")
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
        "message": f"账期【{period}】已成功{'核定封账 🔒' if is_lock else '反审核解锁 🟡'}"
    }
