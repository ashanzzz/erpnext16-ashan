# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import add_months, getdate, nowdate, date_diff, cint


class EnvironmentalComplianceItem(Document):
	def validate(self):
		self.calculate_due_and_status()

	def calculate_due_and_status(self):
		"""
		精准计算下次到期日、剩余天数及预警状态
		"""
		if self.cycle_months and cint(self.cycle_months) > 0 and self.last_done_date:
			# 使用精准的 add_months (正确处理 1/31+1m=2/28, 8/31+6m=2/28 等月末边界)
			self.next_due_date = add_months(getdate(self.last_done_date), cint(self.cycle_months))

		if self.next_due_date:
			today = getdate(nowdate())
			due = getdate(self.next_due_date)
			self.days_remaining = date_diff(due, today)

			if self.days_remaining > 60:
				self.status = "正常"
			elif 31 <= self.days_remaining <= 60:
				self.status = "注意"
			elif 1 <= self.days_remaining <= 30:
				self.status = "即将到期"
			elif self.days_remaining == 0:
				self.status = "今日到期"
			else:
				self.status = "已逾期"
		else:
			self.days_remaining = 0
			self.status = "正常"
