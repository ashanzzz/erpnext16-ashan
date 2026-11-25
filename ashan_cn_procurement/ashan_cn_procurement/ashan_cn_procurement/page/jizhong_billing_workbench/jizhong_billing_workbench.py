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


def _get_gl_entries(company, account_types=("Bank",), start_date="2026-01-01", end_date="2026-01-31", include_credits=False):
    """查询当月 GL Entry 凭证（银行流水含借贷双向，现金流入取借方）"""
    accounts = frappe.get_all(
        "Account",
        filters={"company": company, "account_type": ["in", list(account_types)]},
        pluck="name"
    )
    if not accounts:
        return []

    dir_cond = "(debit > 0 OR credit > 0)" if include_credits else "debit > 0"
    entries = frappe.db.sql(
        f"""
        SELECT name, posting_date, account, party_type, party, debit, credit, voucher_type, voucher_no, against, remarks, owner
        FROM `tabGL Entry`
        WHERE company = %s
          AND account IN %s
          AND posting_date BETWEEN %s AND %s
          AND {dir_cond}
          AND is_cancelled = 0
          AND docstatus = 1
        ORDER BY posting_date asc, name asc
        """,
        (company, tuple(accounts), start_date, end_date),
        as_dict=True
    )
    return entries


def _is_rr_paid(rr, paid_rr_names, source_pi, paid_cash_pis):
    """判断报销单或明细是否已完成付款"""
    if not rr:
        return False
    if rr.get("payment_status") in ("已付款", "Paid"):
        return True
    total_amt = flt(rr.get("total_amount"))
    paid_amt = flt(rr.get("paid_amount"))
    if total_amt > 0 and paid_amt >= total_amt - 0.01:
        return True
    if rr.get("name") in paid_rr_names:
        return True
    if source_pi and source_pi in paid_cash_pis:
        return True
    return False


def _matches_hardware_supplier(supplier_name, active_rules):
    """判断供应商是否命中已启用的五金辅助核算归集公司规则"""
    sup = str(supplier_name or "").strip()
    if not sup or not active_rules:
        return False
    sup_lower = sup.lower()
    for rule in active_rules:
        target_sup = str(rule.get("supplier") or "").strip()
        keyword = str(rule.get("remarks") or "").strip()
        if not keyword:
            exp_name = str(rule.get("expense_name") or "").strip()
            keyword = exp_name[5:].strip() if exp_name.startswith("五金归集-") else exp_name
        if target_sup and sup == target_sup:
            return True
        if keyword and keyword.lower() in sup_lower:
            return True
    return False


@frappe.whitelist(methods=["POST"])
def get_jizhong_billing_data(period_month=None):
    """
    获取天津吉众科技有限公司账单明细数据。
    严格对齐吉众 4 个 ERPNext 真实总账科目与对应明细：
    1. 银行-农行：按 ERPNext 官方 Bank 科目 GL Entry 借贷双向收付款凭证明细；
    2. 现金-孟祥山：日常现金已付款报销单支出与现金流入，含月末五金汇总行；
    3. 现金-无票：已付款未附发票日常支出；
    4. 现金-其他：已付款其他指定现金支出；
    辅助功能：五金辅助核算库（仅收纳已报销、已付款、附有效发票且命中配置供应商名单的明细）。
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

    # 2. 获取当前配置中的五金归集供应商规则
    all_configs = get_recurring_configs(company=company) or []
    hw_supplier_configs = [c for c in all_configs if c.get("category") == "五金归集供应商"]
    active_hw_rules = [c for c in hw_supplier_configs if cint(c.get("is_active"))]

    # 3. 抓取该月报销单及明细
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
            ]
        )

    # 4. 银行 & 现金 GL Entry 查账（银行严格走官方 GL Entry 借贷双向流水）
    gl_bank_entries = _get_gl_entries(company, ("Bank",), start_date, end_date, include_credits=True)
    gl_cash_inflows = _get_gl_entries(company, ("Cash",), start_date, end_date, include_credits=False)

    # 4.1 银行 Payment Entry / 关联 Purchase Invoice 批量补全
    bank_pe_names = sorted({
        ge.get("voucher_no")
        for ge in gl_bank_entries
        if ge.get("voucher_type") == "Payment Entry" and ge.get("voucher_no")
    })
    pe_map = {}
    pe_pi_refs = {}
    if bank_pe_names:
        for pe in frappe.get_all(
            "Payment Entry",
            filters={"name": ["in", bank_pe_names]},
            fields=["name", "party", "party_name", "reference_no", "remarks", "owner"]
        ):
            pe_map[pe.name] = pe
        for per in frappe.get_all(
            "Payment Entry Reference",
            filters={"parent": ["in", bank_pe_names], "reference_doctype": "Purchase Invoice"},
            fields=["parent", "reference_name"],
            order_by="idx asc"
        ):
            pe_pi_refs.setdefault(per.parent, []).append(per.reference_name)

    # 4.2 批量解析报销单付款凭证与来源发票信息
    cash_accounts = set(frappe.get_all("Account", filters={"company": company, "account_type": "Cash"}, pluck="name"))
    paid_rr_names = set()
    if rr_map:
        for pe in frappe.get_all(
            "Payment Entry",
            filters={
                "company": company,
                "docstatus": 1,
                "payment_type": "Pay",
                "reference_no": ["in", list(rr_map.keys())],
            },
            fields=["reference_no"]
        ):
            if pe.reference_no:
                paid_rr_names.add(pe.reference_no)

    item_source_pis = sorted({it.source_pi for it in rr_items if it.source_pi})
    all_pi_names = sorted(set(item_source_pis) | {pi for pis_list in pe_pi_refs.values() for pi in pis_list})
    pi_info_map = {}
    if all_pi_names:
        for p in frappe.get_all(
            "Purchase Invoice",
            filters={"name": ["in", all_pi_names]},
            fields=["name", "supplier", "bill_no"]
        ):
            pi_info_map[p.name] = p

    paid_cash_pis = set()
    if item_source_pis and cash_accounts:
        pi_pe_refs = frappe.get_all(
            "Payment Entry Reference",
            filters={"reference_doctype": "Purchase Invoice", "reference_name": ["in", item_source_pis]},
            fields=["parent", "reference_name"]
        )
        if pi_pe_refs:
            ref_pe_names = sorted({r.parent for r in pi_pe_refs})
            valid_cash_pes = {
                pe.name
                for pe in frappe.get_all(
                    "Payment Entry",
                    filters={
                        "name": ["in", ref_pe_names],
                        "company": company,
                        "docstatus": 1,
                        "payment_type": "Pay",
                        "paid_from": ["in", list(cash_accounts)],
                    },
                    fields=["name"]
                )
            }
            for r in pi_pe_refs:
                if r.parent in valid_cash_pes:
                    paid_cash_pis.add(r.reference_name)

    tax_inv_names = sorted({it.source_tax_invoice for it in rr_items if it.source_tax_invoice})
    all_inv_nos = (
        [it.invoice_no for it in rr_items if it.invoice_no]
        + [p.get("bill_no") for p in pi_info_map.values() if p.get("bill_no")]
    )
    tax_lookup = build_tax_invoice_seller_lookup(
        ti_names=tax_inv_names,
        pi_names=all_pi_names,
        invoice_nos=all_inv_nos,
    )
    registered_suppliers = get_registered_supplier_set()

    all_owners = (
        [ge.get("owner") for ge in gl_bank_entries]
        + [pe.get("owner") for pe in pe_map.values()]
        + [gi.get("owner") for gi in gl_cash_inflows]
        + [r.get("owner") for r in rrs]
    )
    user_map = _get_user_fullname_map(all_owners)
    pi_item_spec_map = resolve_pi_item_and_spec_map(all_pi_names)

    # 5. 构造四账户分流与五金辅助库
    bank_rows = []
    cash_rows = []
    no_inv_rows = []
    no_inv_other_rows = []
    hardware_rows = []

    for ge in gl_bank_entries:
        debit_amt = flt(ge.get("debit"))
        credit_amt = flt(ge.get("credit"))
        income_val = debit_amt if debit_amt > 0 else None
        expense_val = credit_amt if credit_amt > 0 else None
        if not income_val and not expense_val:
            continue

        vtype = ge.get("voucher_type") or "GL Entry"
        vno = ge.get("voucher_no") or ge.get("name")
        pe = pe_map.get(vno) if vtype == "Payment Entry" else None
        linked_pis = pe_pi_refs.get(vno, []) if pe else []

        clean_remark = ((pe.get("remarks") if pe else None) or ge.get("remarks") or "").strip()
        if clean_remark == "无备注":
            clean_remark = ""

        bill_nos = []
        pi_suppliers = []
        item_parts = []
        spec_parts = []
        for p in linked_pis:
            p_info = pi_info_map.get(p, {})
            bno = (p_info.get("bill_no") or "").strip()
            if bno and bno not in ("0", "00", "000", "无票") and bno not in bill_nos:
                bill_nos.append(bno)
            psup = (p_info.get("supplier") or "").strip()
            if psup and psup not in pi_suppliers:
                pi_suppliers.append(psup)
            p_meta = pi_item_spec_map.get(p, {})
            for part in str(p_meta.get("item_name_full") or p_meta.get("item_name") or "").split("、"):
                clean_part = part.strip()
                if clean_part and clean_part not in item_parts:
                    item_parts.append(clean_part)
            for sp in str(p_meta.get("specification_full") or p_meta.get("specification") or "").split("、"):
                clean_sp = sp.strip()
                if clean_sp and clean_sp != "-" and clean_sp not in spec_parts:
                    spec_parts.append(clean_sp)

        inv_text = ", ".join(bill_nos) if bill_nos else "-"
        pe_party = ((pe.get("party_name") or pe.get("party")) if pe else None) or ""
        gl_party = (ge.get("party") or "").strip() if ge.get("party_type") in ("Supplier", "Customer", "Employee") else ""

        if item_parts:
            item_title = item_parts[0] if len(item_parts) == 1 else f"{item_parts[0]} 等{len(item_parts)}项"
            item_full = "、".join(item_parts)
        else:
            item_title = clean_remark or ge.get("against") or pe_party or ("银行资金流入" if income_val else "银行资金支出")
            item_full = item_title

        if spec_parts:
            spec_text = spec_parts[0] if len(spec_parts) == 1 else f"{spec_parts[0]} 等{len(spec_parts)}项"
            spec_full = "、".join(spec_parts)
        else:
            spec_text = "-"
            spec_full = "-"

        if income_val:
            counterparty = "-"
            is_reg = True
        else:
            tax_seller = resolve_tax_invoice_seller(
                tax_lookup,
                pi_names=linked_pis,
                invoice_no=inv_text,
            )
            fallback_supplier = pe_party or ("、".join(pi_suppliers) if pi_suppliers else "") or gl_party
            counterparty, is_reg = resolve_counterparty_info(tax_seller, fallback_supplier, registered_suppliers)

        p_date = str(ge.get("posting_date") or "")
        creator_owner = (pe.get("owner") if pe else None) or ge.get("owner")

        bank_rows.append({
            "date": p_date,
            "posting_date": p_date,
            "summary": item_title,
            "item_name": item_title,
            "item_name_full": item_full,
            "specification": spec_text,
            "specification_full": spec_full,
            "debit": income_val,
            "credit": expense_val,
            "income": income_val,
            "expense": expense_val,
            "balance": 0.0,
            "remark": clean_remark or "-",
            "note": f"{clean_remark or ('银行收款' if income_val else '银行付款')} (凭证:{vno})",
            "voucher_type": vtype,
            "voucher_type_label": _voucher_type_label(vtype),
            "voucher_no": vno,
            "counterparty": counterparty,
            "is_registered_supplier": is_reg,
            "invoice_no": inv_text,
            "creator": user_map.get(creator_owner, "-")
        })

    for gi in gl_cash_inflows:
        amt = flt(gi.get("debit"))
        vtype = gi.get("voucher_type") or "GL Entry"
        vno = gi.get("voucher_no") or gi.get("name")
        clean_remark = (gi.get("remarks") or "").strip()
        p_date = str(gi.get("posting_date") or "")
        item_label = clean_remark or gi.get("against") or "现金提存/资金注入"
        cash_rows.append({
            "date": p_date,
            "posting_date": p_date,
            "summary": item_label,
            "item_name": item_label,
            "item_name_full": item_label,
            "specification": "-",
            "specification_full": "-",
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
            "counterparty": "-",
            "is_registered_supplier": True,
            "invoice_no": "-",
            "creator": user_map.get(gi.get("owner"), "-")
        })

    # 现金-孟祥山、现金-无票、现金-其他与五金辅助核算库分流（仅统计已付款报销单）
    for item in rr_items:
        rr = rr_map.get(item.parent)
        if not _is_rr_paid(rr, paid_rr_names, item.source_pi, paid_cash_pis):
            continue

        amt = flt(item.amount)
        title = rr.title if rr else ""
        pi_info = pi_info_map.get(item.source_pi, {})
        pi_meta = pi_item_spec_map.get(item.source_pi, {})
        ti_direct = tax_lookup["by_name"].get(item.source_tax_invoice, {}) if item.source_tax_invoice else {}

        raw_inv = (
            (item.invoice_no or "").strip()
            or (pi_info.get("bill_no") or "").strip()
            or (ti_direct.get("invoice_no") or "").strip()
        )
        inv_no = "无票" if raw_inv in ("0", "00", "000", "", "无票") else raw_inv
        has_valid_invoice = inv_no != "无票"

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
            resolved_item = pi_meta["item_name"]
            resolved_item_full = pi_meta.get("item_name_full") or resolved_item
        else:
            resolved_item = raw_item_name
            resolved_item_full = pi_meta.get("item_name_full") or raw_item_name

        spec_text = sanitize_spec_text(item.description, resolved_item or raw_item_name)
        spec_full = spec_text
        if spec_text == "-" and pi_meta.get("specification") and pi_meta["specification"] != "-":
            spec_text = pi_meta["specification"]
            spec_full = pi_meta.get("specification_full") or spec_text

        clean_remark = (item.custom_line_remark or "").strip()
        remark = clean_remark or item.description or resolved_item or ""
        p_date = str(rr.posting_date) if rr else start_date
        creator_name = user_map.get(rr.owner, "-") if rr else "-"

        # 五金辅助核算库准入判定：
        # 1. 已提交且已付款报销单（上方已校验）；
        # 2. 附有效发票（非无票）；
        # 3. 供应商命中已配置的五金归集公司名单（默认含金普金）
        if has_valid_invoice and any(_matches_hardware_supplier(s, active_hw_rules) for s in (tax_seller, fallback_supplier) if s):
            hw_name = resolved_item or "车间五金零配件"
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
                "item_name_full": resolved_item_full or hw_name,
                "specification": spec_text,
                "specification_full": spec_full,
                "income": None,
                "expense": amt,
                "balance": None,
                "remark": clean_remark or "-",
                "supplier": counterparty if counterparty != "-" else fallback_supplier,
                "counterparty": counterparty,
                "is_registered_supplier": is_reg,
                "voucher_type": "Reimbursement Request",
                "voucher_type_label": _voucher_type_label("Reimbursement Request"),
                "voucher_no": item.parent,
                "invoice_no": inv_no,
                "creator": creator_name,
            })
            continue

        # 显式科目归集判定：
        if "现金-其他" in remark or "现金-其他" in title:
            item_title = resolved_item or "未附发票支出"
            no_inv_other_rows.append({
                "date": p_date,
                "posting_date": p_date,
                "item": item_title,
                "item_name": item_title,
                "item_name_full": resolved_item_full or item_title,
                "specification": spec_text,
                "specification_full": spec_full,
                "income": None,
                "expense": amt,
                "balance": 0.0,
                "remark": clean_remark or "-",
                "note": f"{remark} (单据:{item.parent})",
                "voucher_type": "Reimbursement Request",
                "voucher_type_label": _voucher_type_label("Reimbursement Request"),
                "voucher_no": item.parent,
                "counterparty": counterparty,
                "is_registered_supplier": is_reg,
                "invoice_no": inv_no,
                "creator": creator_name
            })
        elif "现金-无票" in remark or "现金-无票" in title or not has_valid_invoice or "无发票" in title or "无票" in title:
            item_title = resolved_item or "未附发票支出"
            no_inv_rows.append({
                "date": p_date,
                "posting_date": p_date,
                "item": item_title,
                "item_name": item_title,
                "item_name_full": resolved_item_full or item_title,
                "specification": spec_text,
                "specification_full": spec_full,
                "income": None,
                "expense": amt,
                "balance": 0.0,
                "remark": clean_remark or "-",
                "note": f"{remark} (单据:{item.parent})",
                "voucher_type": "Reimbursement Request",
                "voucher_type_label": _voucher_type_label("Reimbursement Request"),
                "voucher_no": item.parent,
                "counterparty": counterparty,
                "is_registered_supplier": is_reg,
                "invoice_no": inv_no,
                "creator": creator_name
            })
        else:
            item_title = resolved_item or "现金支出"
            cash_rows.append({
                "date": p_date,
                "posting_date": p_date,
                "summary": item_title,
                "item_name": item_title,
                "item_name_full": resolved_item_full or item_title,
                "specification": spec_text,
                "specification_full": spec_full,
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
                "counterparty": counterparty,
                "is_registered_supplier": is_reg,
                "invoice_no": inv_no,
                "creator": creator_name
            })

    # 辅助五金若有明细，在现金表自动写入一条总结性汇总行
    if hardware_rows:
        tot_hw = sum(r["total_amount"] for r in hardware_rows)
        hw_remark = f"{int(y)}年{int(m)}月五金，详见五金辅助核算"
        cash_rows.append({
            "date": end_date,
            "posting_date": end_date,
            "summary": "五金一批",
            "item_name": "五金一批",
            "item_name_full": "五金一批",
            "specification": "-",
            "specification_full": "-",
            "debit": None,
            "credit": tot_hw,
            "income": None,
            "expense": tot_hw,
            "balance": 0.0,
            "remark": hw_remark,
            "note": hw_remark,
            "voucher_type": "Hardware Summary",
            "voucher_type_label": _voucher_type_label("Hardware Summary"),
            "voucher_no": "-",
            "counterparty": "-",
            "is_registered_supplier": True,
            "invoice_no": "-",
            "creator": "系统汇总",
            "is_highlight": True,
            "is_hardware_summary": True,
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
