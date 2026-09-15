# -*- coding: utf-8 -*-
# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from ashan_cn_procurement.services.invoice_closing_service import is_invoice_month_locked


DOCTYPE_CN_NAMES = {
    "Material Request": "采购申请",
    "Purchase Order": "采购订单",
    "Purchase Receipt": "采购入库单",
    "Purchase Invoice": "采购发票",
    "Reimbursement Request": "采购报销申请",
    "Payment Entry": "付款凭证",
}


def _extract_doc_periods_and_company(doc):
    """
    提取单据所属法人主体及所属业务月份集合 (YYYY-MM)
    """
    company = getattr(doc, "company", None)
    if not company:
        # Material Request 等单据如果未直接设 company，从首行物料仓库或默认公司获取
        if doc.doctype == "Material Request" and getattr(doc, "items", None):
            for row in doc.items:
                if getattr(row, "warehouse", None):
                    wh_comp = frappe.db.get_value("Warehouse", row.warehouse, "company")
                    if wh_comp:
                        company = wh_comp
                        break
        if not company:
            company = frappe.defaults.get_user_default("company") or frappe.db.get_single_value("Global Defaults", "default_company")

    periods = set()

    # 1. 记账日期 / 过账日期
    if getattr(doc, "posting_date", None):
        periods.add(str(doc.posting_date)[:7])

    # 2. 交易日期 / 单据日期
    if getattr(doc, "transaction_date", None):
        periods.add(str(doc.transaction_date)[:7])

    # 3. 需求日期 / 排程日期
    if getattr(doc, "schedule_date", None):
        periods.add(str(doc.schedule_date)[:7])

    # 4. 发票开票日期
    if getattr(doc, "bill_date", None):
        periods.add(str(doc.bill_date)[:7])

    # 5. 报销单申请日期
    if getattr(doc, "claim_date", None):
        periods.add(str(doc.claim_date)[:7])

    return company, periods


def validate_procurement_period_not_locked(doc, method=None):
    """
    采购与供应链全链条月度封账校验钩子：
    拦截 Material Request, Purchase Order, Purchase Receipt, Purchase Invoice, Reimbursement Request
    在已完成月度核定封账的月份内的新建、保存、修改、提交、作废和删除。
    """
    if not doc:
        return

    company, periods = _extract_doc_periods_and_company(doc)
    if not company or not periods:
        return

    doctype_cn = DOCTYPE_CN_NAMES.get(doc.doctype, doc.doctype)

    for p in periods:
        if is_invoice_month_locked(company, p):
            frappe.throw(
                _(
                    "【采购全链条月度封账锁定】主体【{0}】在账期【{1}】已完成采购与供应链月度综合封账，"
                    "严密禁止新增、修改、提交、作废或删除该月份的【{2}】单据！<br><br>"
                    "如需调整历史月份单据，请联系采购/财务主管在【月度核定全景管理中枢】中发起反审核解锁。"
                ).format(company, p, doctype_cn),
                title=_("采购月度封账保护")
            )
