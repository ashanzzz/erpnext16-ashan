# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

from frappe.model.document import Document
import frappe
from ashan_cn_procurement.services.tax_invoice_validation import (
	get_buyer_validation_error,
	normalize_buyer_name,
)

class TaxInvoiceSettings(Document):
	def validate(self):
		"""Allow mappings only for the two approved tax-invoice buyer entities."""
		seen_buyer_names = set()
		for mapping in self.get("company_mappings") or []:
			buyer_name = normalize_buyer_name(mapping.buyer_name)
			buyer_error = get_buyer_validation_error(buyer_name)
			if buyer_error:
				frappe.throw(f"公司识别规则无效：{buyer_error}")
			if buyer_name in seen_buyer_names:
				frappe.throw(f"购买方“{buyer_name}”只能配置一条公司识别规则。")
			seen_buyer_names.add(buyer_name)
			mapping.buyer_name = buyer_name
