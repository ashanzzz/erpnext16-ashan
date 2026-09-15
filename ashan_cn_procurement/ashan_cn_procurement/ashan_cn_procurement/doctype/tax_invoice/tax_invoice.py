# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import flt, now_datetime
from ashan_cn_procurement.services.tax_invoice_validation import (
	append_unique_warning,
	get_buyer_validation_error,
)

class TaxInvoice(Document):
	def validate(self):
		self.normalize_fields()
		self.ensure_item_rows()
		self.validate_buyer_boundary()
		self.compute_totals_and_summary()
		self.check_red_invoice()

	def normalize_fields(self):
		if self.invoice_no:
			self.invoice_no = str(self.invoice_no).strip()
		if self.original_invoice_no:
			self.original_invoice_no = str(self.original_invoice_no).strip()

	def check_red_invoice(self):
		if flt(self.invoice_grand_total) < 0 or flt(self.amount_without_tax) < 0 or self.credit_note_no or self.original_invoice_no:
			self.is_red_invoice = 1

	def ensure_item_rows(self):
		"""Guarantee that every invoice exposes at least one auditable detail row."""
		if self.get("items"):
			return

		self.append("items", {
			"line_type": "普通",
			"item_name": "发票项目明细（待核对）",
			"amount": flt(self.amount_without_tax),
			"tax_amount": flt(self.tax_amount),
			"line_total": flt(self.invoice_grand_total),
			"source_note": "未解析到原始逐行项目，已生成待复核汇总行。",
		})
		self.parse_status = "需复核"
		self.parse_warning = append_unique_warning(
			self.parse_warning, "未解析到原始逐行项目，已生成待复核汇总行"
		)

	def validate_buyer_boundary(self):
		"""Mark invoices outside the two approved buyer entities as invalid."""
		buyer_error = get_buyer_validation_error(self.buyer_name)
		if not buyer_error:
			return

		self.company = None
		self.parse_status = "需复核"
		self.parse_warning = append_unique_warning(self.parse_warning, buyer_error)

	def compute_totals_and_summary(self):
		# 车船税及其滞纳金只从项目明细行计算，绝不使用主表独立金额字段。
		items = self.get("items") or []
		extra_charge_total = sum(
			flt(item.line_total) for item in items if item.line_type == "车船税"
		)
		if flt(self.remark_total) != 0:
			self.payable_total = flt(self.remark_total)
		else:
			self.payable_total = round(flt(self.invoice_grand_total) + extra_charge_total, 2)

		# 自动生成列表展示摘要
		if not self.display_summary and items:
			first_item = items[0].item_name or ""
			if len(items) == 1:
				if items[0].line_type == "通行费" and items[0].plate_number:
					self.display_summary = f"通行费 · {items[0].plate_number}"
				else:
					self.display_summary = first_item
			else:
				has_vv_tax = any(it.line_type == "车船税" for it in items)
				if has_vv_tax:
					self.display_summary = f"{first_item} + 车船税"
				else:
					self.display_summary = f"{first_item}… 等 {len(items)} 项"
