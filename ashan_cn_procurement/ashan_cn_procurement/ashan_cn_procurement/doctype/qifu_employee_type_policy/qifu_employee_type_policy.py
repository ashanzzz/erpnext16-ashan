# Copyright (c) 2026, Ashan CN Procurement
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class QifuEmployeeTypePolicy(Document):
	def validate(self):
		self.validate_company()

	def validate_company(self):
		from ashan_cn_procurement.services.authorization_service import (
			assert_company_access,
		)
		target_company = self.company or "天津祺富机械加工有限公司"
		assert_company_access("payroll", target_company, "write")
		self.company = target_company
