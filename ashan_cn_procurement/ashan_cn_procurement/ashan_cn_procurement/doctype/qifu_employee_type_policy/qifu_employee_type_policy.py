# Copyright (c) 2026, Ashan CN Procurement
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class QifuEmployeeTypePolicy(Document):
	def validate(self):
		self.validate_company()
		self.sync_category_group()

	def sync_category_group(self):
		# 2026-10-26 用户强制最高铁律：用工性质与统计归类合二为一，单一真理源，不搞层级嵌套与谁归属谁
		self.category_group = self.employee_type

	def validate_company(self):
		from ashan_cn_procurement.services.authorization_service import (
			assert_company_access,
		)
		target_company = self.company or "天津祺富机械加工有限公司"
		assert_company_access(target_company)
		self.company = target_company
