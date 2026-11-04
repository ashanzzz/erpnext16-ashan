# -*- coding: utf-8 -*-
"""
ERPNext 16 Official Document Lifecycle Guard
Enforces audit conservation: prevents physical deletion of submitted (1) or cancelled (2) documents.
Aligns with official ERPNext policy: audit trail must be preserved; corrections must be made via Amend.
"""

import frappe
from frappe import _

def prevent_submitted_or_cancelled_doc_deletion(doc, method=None):
    """
    Blocks physical deletion of submitted or cancelled business documents.
    Only draft (docstatus=0) documents are permitted to be deleted.
    """
    if doc.docstatus in (1, 2):
        status_name = _("已提交") if doc.docstatus == 1 else _("已作废")
        frappe.throw(
            _(
                "【安全审计拦截】禁止删除{0}单据【{1}】！"
                "ERPNext 官方规范要求保留完整的业务与财务审计底稿。"
                "如单据内容有误，请在已作废单据右上角点击【修订 (Amend)】重新生成修订单。"
            ).format(status_name, doc.name),
            title=_("禁止物理删除")
        )
