# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import flt


class PropertyChargeRate(Document):
	def validate(self):
		self.calculate_all_rates()

	def calculate_all_rates(self):
		"""
		依据租赁物业的面积及用户选定的计价方式，自动双向互算房租与物业费的日/月/年单价与总金额
		"""
		area = 0.0
		if self.property_lease:
			area = flt(frappe.db.get_value("Property Lease", self.property_lease, "area"))

		# 1. 房租互算
		mode = self.rent_pricing_mode or "按年总金额 (元/年)"
		if area > 0:
			if mode == "按日单价 (元/㎡·天)":
				d_rate = flt(self.rent_daily_rate)
				self.rent_annual_rate = round(d_rate * 365.0, 6)
				self.rent_monthly_rate = round(d_rate * 365.0 / 12.0, 6)
				self.rent_annual_amount = round(area * d_rate * 365.0, 2)
				self.rent_monthly_amount = round(self.rent_annual_amount / 12.0, 2)
			elif mode == "按月单价 (元/㎡·月)":
				m_rate = flt(self.rent_monthly_rate)
				self.rent_annual_rate = round(m_rate * 12.0, 6)
				self.rent_daily_rate = round(m_rate * 12.0 / 365.0, 6)
				self.rent_monthly_amount = round(area * m_rate, 2)
				self.rent_annual_amount = round(self.rent_monthly_amount * 12.0, 2)
			elif mode == "按年单价 (元/㎡·年)":
				y_rate = flt(self.rent_annual_rate)
				self.rent_monthly_rate = round(y_rate / 12.0, 6)
				self.rent_daily_rate = round(y_rate / 365.0, 6)
				self.rent_annual_amount = round(area * y_rate, 2)
				self.rent_monthly_amount = round(self.rent_annual_amount / 12.0, 2)
			elif mode == "按月总金额 (元/月)":
				m_amt = flt(self.rent_monthly_amount)
				self.rent_annual_amount = round(m_amt * 12.0, 2)
				self.rent_monthly_rate = round(m_amt / area, 6)
				self.rent_annual_rate = round(self.rent_monthly_rate * 12.0, 6)
				self.rent_daily_rate = round(self.rent_annual_amount / area / 365.0, 6)
			else: # 按年总金额 (元/年)
				y_amt = flt(self.rent_annual_amount)
				self.rent_monthly_amount = round(y_amt / 12.0, 2)
				self.rent_annual_rate = round(y_amt / area, 6)
				self.rent_monthly_rate = round(self.rent_annual_rate / 12.0, 6)
				self.rent_daily_rate = round(y_amt / area / 365.0, 6)

		# 2. 物业费互算 (若单独计收物业费)
		prop_mode = self.property_fee_mode or "房租含物业"
		if prop_mode == "单独计收物业费" and area > 0:
			p_pricing = self.property_fee_pricing_mode or "按月单价 (元/㎡·月)"
			if p_pricing == "按日单价 (元/㎡·天)":
				p_d_rate = flt(self.property_fee_daily_rate)
				self.property_fee_annual_rate = round(p_d_rate * 365.0, 6)
				self.property_fee_monthly_rate = round(p_d_rate * 365.0 / 12.0, 6)
				self.property_fee_annual_amount = round(area * p_d_rate * 365.0, 2)
			elif p_pricing == "按月单价 (元/㎡·月)":
				p_m_rate = flt(self.property_fee_monthly_rate)
				self.property_fee_annual_rate = round(p_m_rate * 12.0, 6)
				self.property_fee_daily_rate = round(p_m_rate * 12.0 / 365.0, 6)
				self.property_fee_annual_amount = round(area * p_m_rate * 12.0, 2)
			elif p_pricing == "按年单价 (元/㎡·年)":
				p_y_rate = flt(self.property_fee_annual_rate)
				self.property_fee_monthly_rate = round(p_y_rate / 12.0, 6)
				self.property_fee_daily_rate = round(p_y_rate / 365.0, 6)
				self.property_fee_annual_amount = round(area * p_y_rate, 2)
			else: # 按年总金额
				p_y_amt = flt(self.property_fee_annual_amount)
				self.property_fee_annual_rate = round(p_y_amt / area, 6)
				self.property_fee_monthly_rate = round(self.property_fee_annual_rate / 12.0, 6)
				self.property_fee_daily_rate = round(p_y_amt / area / 365.0, 6)
		else:
			self.property_fee_daily_rate = 0.0
			self.property_fee_monthly_rate = 0.0
			self.property_fee_annual_rate = 0.0
			self.property_fee_annual_amount = 0.0

		# 3. 汇总
		self.total_annual_amount = round(flt(self.rent_annual_amount) + flt(self.property_fee_annual_amount), 2)
		self.total_monthly_amount = round(self.total_annual_amount / 12.0, 2)
