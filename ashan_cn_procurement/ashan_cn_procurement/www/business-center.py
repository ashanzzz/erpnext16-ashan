from __future__ import annotations

import frappe

no_cache = 1


def get_context(context):
    if frappe.session.user == "Guest":
        frappe.throw("请先登录 ERPNext 后再打开业务中心 API 调试页。", frappe.PermissionError)
    context.title = "ERPNext 业务中心 API"
    context.no_cache = 1
    return context
