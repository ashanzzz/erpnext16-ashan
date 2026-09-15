# Copyright (c) 2026, Ashan CN Procurement
"""Tax-invoice source-file retention policy.

The original PDF is an accounting source document. This module deliberately
keeps historic public function names for compatibility, but never deletes a
source file or clears the invoice attachment field.
"""

import frappe


def delete_single_tax_invoice_pdf(invoice_no, user=None, reason="手动清理"):
	"""Refuse removal of an archived original PDF and leave all records intact."""
	if not frappe.db.exists("Tax Invoice", invoice_no):
		return {"ok": False, "error": f"发票 {invoice_no} 不存在"}

	frappe.log_error(
		title=f"Tax Invoice Source Retention: {invoice_no}",
		message=(
			f"用户 {user or frappe.session.user} 请求清理原始 PDF，系统已按凭证留存规则拒绝。"
			f"原因：{reason or '未说明'}"
		),
	)
	return {
		"ok": False,
		"invoice_no": invoice_no,
		"message": "原始 PDF 凭证受留存保护，不能通过业务接口删除。",
	}


def cleanup_expired_tax_invoice_pdfs():
	"""Keep the scheduled job safe: record retention instead of deleting evidence."""
	return {
		"ok": True,
		"cleaned_count": 0,
		"message": "原始 PDF 凭证受留存保护，未执行物理删除。",
	}


def run_cleanup_now(user=None):
	"""Expose the immutable-source policy to the authorized settings action."""
	return cleanup_expired_tax_invoice_pdfs()
