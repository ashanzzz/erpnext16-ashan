# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import flt, cint

class AshanMonthlyMealSettlement(Document):
	def validate(self):
		self.calculate_totals()

	def calculate_totals(self):
		qifu_cnt = 0
		qifu_amt = 0.0
		jizhong_cnt = 0
		jizhong_amt = 0.0

		for item in (self.daily_items or []):
			price = flt(item.meal_price or self.default_meal_price or 15.0)
			item.meal_price = price
			item.qifu_amount = flt(round(flt(item.qifu_count or 0) * price, 2))
			item.jizhong_amount = flt(round(flt(item.jizhong_count or 0) * price, 2))
			item.total_count = cint(item.qifu_count or 0) + cint(item.jizhong_count or 0)
			item.total_amount = flt(round(item.qifu_amount + item.jizhong_amount, 2))

			qifu_cnt += cint(item.qifu_count or 0)
			qifu_amt += item.qifu_amount
			jizhong_cnt += cint(item.jizhong_count or 0)
			jizhong_amt += item.jizhong_amount

		self.qifu_total_count = qifu_cnt
		self.qifu_total_amount = flt(round(qifu_amt, 2))
		self.jizhong_total_count = jizhong_cnt
		self.jizhong_total_amount = flt(round(jizhong_amt, 2))
		self.grand_total_count = qifu_cnt + jizhong_cnt
		self.grand_total_amount = flt(round(qifu_amt + jizhong_amt, 2))
