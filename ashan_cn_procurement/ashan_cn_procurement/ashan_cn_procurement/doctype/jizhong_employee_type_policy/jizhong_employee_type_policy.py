# Copyright (c) 2026, Ashan CN Procurement
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class JizhongEmployeeTypePolicy(Document):
	def validate(self):
		self.validate_company()

	def validate_company(self):
		from ashan_cn_procurement.services.jizhong_payroll_service import (
			_assert_jizhong_company,
		)
		_assert_jizhong_company(self.company or "天津吉众科技有限公司", "write")
		self.company = "天津吉众科技有限公司"
