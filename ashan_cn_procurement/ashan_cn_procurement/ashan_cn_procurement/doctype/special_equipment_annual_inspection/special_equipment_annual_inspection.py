# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import getdate, add_to_date
from frappe import _


class SpecialEquipmentAnnualInspection(Document):
	def validate(self):
		self.validate_and_set_company()
		self.validate_dates()

	def validate_and_set_company(self):
		if self.special_equipment and not self.company:
			self.company = frappe.db.get_value("Special Equipment", self.special_equipment, "company")

	def validate_dates(self):
		if self.check_date:
			c_date = getdate(self.check_date)
			if not self.inspection_year:
				self.inspection_year = c_date.year

			if not self.next_check_date:
				# 默认自动计算 check_date + 12个月
				self.next_check_date = add_to_date(c_date, months=12)

	def on_update(self):
		from ashan_cn_procurement.services.special_equipment import sync_annual_check_snapshot
		if self.special_equipment:
			sync_annual_check_snapshot(self.special_equipment)

	def on_trash(self):
		from ashan_cn_procurement.services.special_equipment import sync_annual_check_snapshot
		if self.special_equipment:
			frappe.db.after_commit.add(lambda: sync_annual_check_snapshot(self.special_equipment))
