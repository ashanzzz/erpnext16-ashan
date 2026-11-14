# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

from typing import Any
import frappe
from frappe.utils import flt


def trace_transaction_source(
    rr_name: str | None = None,
    pi_name: str | None = None,
    company: str | None = None
) -> dict[str, Any]:
    """
    全链路穿透追溯账目单据来源、初始单据类型、单据编号及付款状态：
    1. 判定初始单据：采购申请 (MR) -> 采购订单 (PO) -> 采购入库 (PR) -> 采购发票 (PI) -> 报销凭证 (RR)
    2. 提取全流程单据编号：mr_name, pr_name, pi_name, rr_name, pe_name
    3. 生成全链路文本追溯：如 采购申请[MR-...] ➔ 采购入库[PR-...] ➔ 采购发票[FP-...] ➔ 报销凭证[BX-...] ➔ 付款凭证[PE-...]
    4. 明确付款状态、支付方式、出资账户与结清日期
    """
    mrs: list[str] = []
    pos: list[str] = []
    prs: list[str] = []
    pis: list[str] = []
    pes: list[str] = []

    rr_doc = None
    if rr_name and frappe.db.exists("Reimbursement Request", rr_name):
        rr_doc = frappe.get_doc("Reimbursement Request", rr_name)
        company = company or rr_doc.company
        for it in rr_doc.invoice_items:
            if it.source_pi and it.source_pi not in pis:
                pis.append(it.source_pi)

    if pi_name and pi_name not in pis and frappe.db.exists("Purchase Invoice", pi_name):
        pis.append(pi_name)

    # 1. 向上追溯 PI -> PR / PO / MR
    for p in list(pis):
        if frappe.db.exists("Purchase Invoice", p):
            pi_doc = frappe.get_doc("Purchase Invoice", p)
            company = company or pi_doc.company
            for it in pi_doc.items:
                if it.purchase_receipt and it.purchase_receipt not in prs:
                    prs.append(it.purchase_receipt)
                if it.purchase_order and it.purchase_order not in pos:
                    pos.append(it.purchase_order)
                if it.material_request and it.material_request not in mrs:
                    mrs.append(it.material_request)

    # 2. 向上追溯 PR -> PO / MR
    for pr in list(prs):
        if frappe.db.exists("Purchase Receipt", pr):
            pr_doc = frappe.get_doc("Purchase Receipt", pr)
            for it in pr_doc.items:
                if it.purchase_order and it.purchase_order not in pos:
                    pos.append(it.purchase_order)
                if it.material_request and it.material_request not in mrs:
                    mrs.append(it.material_request)

    # 3. 向下追溯 Payment Entry
    pe_records = []
    ref_names = list(set(pis + ([rr_name] if rr_name else [])))
    if ref_names:
        placeholders = ", ".join(["%s"] * len(ref_names))
        sql_pe = f"""
            SELECT per.parent as pe_name, pe.posting_date, pe.mode_of_payment, pe.paid_from, per.allocated_amount
            FROM `tabPayment Entry Reference` per
            JOIN `tabPayment Entry` pe ON pe.name = per.parent
            WHERE per.reference_name IN ({placeholders}) AND pe.docstatus = 1
        """
        pe_records = frappe.db.sql(sql_pe, tuple(ref_names), as_dict=True)
        for pe_r in pe_records:
            if pe_r.pe_name not in pes:
                pes.append(pe_r.pe_name)

    # 4. 判定初始单据类型与编号
    initial_type = "直接报销"
    initial_no = rr_name or (pis[0] if pis else "-")
    if mrs:
        initial_type = "采购申请 (Material Request)"
        initial_no = mrs[0]
    elif pos:
        initial_type = "采购订单 (Purchase Order)"
        initial_no = pos[0]
    elif prs:
        initial_type = "采购入库单 (Purchase Receipt)"
        initial_no = prs[0]
    elif pis and not rr_name:
        initial_type = "采购发票 (Purchase Invoice)"
        initial_no = pis[0]
    elif rr_name:
        if pis:
            initial_type = "发票报销 (发票前置)"
            initial_no = pis[0]
        else:
            initial_type = "报销凭证 (直接报销)"
            initial_no = rr_name

    # 5. 判定付款状态与付款信息
    payment_status = "未付款"
    paid_from = "-"
    mode_of_payment = "-"
    paid_date = "-"

    if pes:
        payment_status = "已付款"
        mode_of_payment = pe_records[0].mode_of_payment or "银行转账"
        paid_from = pe_records[0].paid_from or "-"
        paid_date = str(pe_records[0].posting_date or "-")
    elif rr_doc:
        p_stat = getattr(rr_doc, "payment_status", None)
        paid_amt = flt(getattr(rr_doc, "paid_amount", 0))
        tot_amt = flt(getattr(rr_doc, "total_amount", 0))
        if p_stat in ("已付款", "Paid") or (paid_amt and paid_amt >= tot_amt):
            payment_status = "已付款"
            mode_of_payment = "现金"
            paid_from = "现金账单-孟祥山 - 祺富" if (company and "祺富" in company) else "现金-孟祥山 - 吉众"
            paid_date = str(rr_doc.posting_date or "-")
        elif paid_amt and paid_amt > 0:
            payment_status = f"部分付款 (¥{paid_amt:,.2f})"
            mode_of_payment = "现金"
            paid_from = "现金账单-孟祥山 - 祺富" if (company and "祺富" in company) else "现金-孟祥山 - 吉众"
            paid_date = str(rr_doc.posting_date or "-")
    elif pis:
        pi_doc = frappe.get_doc("Purchase Invoice", pis[0])
        out_amt = flt(getattr(pi_doc, "outstanding_amount", 0))
        if out_amt <= 0.0001:
            payment_status = "已付款"
            mode_of_payment = "对公电汇"
            paid_from = "银行存款 - 祺富" if (company and "祺富" in company) else "银行-农行 - 吉众"
            paid_date = str(pi_doc.posting_date or "-")
        else:
            payment_status = f"未结清 (欠¥{out_amt:,.2f})"
            mode_of_payment = "对公电汇"

    # 6. 生成可读业务追溯链
    chain: list[str] = []
    if mrs:
        chain.append(f"采购申请[{','.join(mrs)}]")
    if pos:
        chain.append(f"采购订单[{','.join(pos)}]")
    if prs:
        chain.append(f"采购入库[{','.join(prs)}]")
    if pis:
        chain.append(f"采购发票[{','.join(pis)}]")
    if rr_name:
        chain.append(f"报销凭证[{rr_name}]")
    if pes:
        chain.append(f"付款凭证[{','.join(pes)}]")
    elif payment_status == "已付款":
        chain.append("现金已结" if mode_of_payment == "现金" else "已付款")
    else:
        chain.append("待付款")

    return {
        "initial_doc_type": initial_type,
        "initial_doc_name": initial_no,
        "chain_summary": " ➔ ".join(chain),
        "mr_name": ",".join(mrs) if mrs else "-",
        "pr_name": ",".join(prs) if prs else "-",
        "pi_name": ",".join(pis) if pis else "-",
        "rr_name": rr_name or "-",
        "pe_name": ",".join(pes) if pes else "-",
        "payment_status": payment_status,
        "paid_from_account": paid_from,
        "mode_of_payment": mode_of_payment,
        "paid_date": paid_date,
    }
