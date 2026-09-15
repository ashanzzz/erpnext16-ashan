# -*- coding: utf-8 -*-
# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import flt, cint


class PropertyLease(Document):
	def validate(self):
		self.calculate_rent_rates()
		self.calculate_property_fee_rates()
		self.calculate_totals()

	def calculate_rent_rates(self):
		"""
		房租单价与多周期金额自动互算引擎
		基准：1年 = 365天 = 12个月
		税率：以 rent_tax_rate (如 5.0%) 为基准计算价税分离
		"""
		area = flt(self.area)
		if area <= 0:
			area = 1.0

		mode = self.rent_pricing_mode or "按年总金额 (元/年)"
		tax_rate = flt(self.rent_tax_rate if self.rent_tax_rate is not None else 5.0)
		self.rent_tax_rate = tax_rate
		is_incl = bool(cint(self.is_tax_inclusive if self.is_tax_inclusive is not None else 1))

		# 1. 获取用户输入的含税年金额基数 (ann_incl)
		ann_incl = 0.0

		if mode == "按年总金额 (元/年)":
			val = flt(self.rent_annual_amount)
			ann_incl = val if is_incl else (val * (1.0 + tax_rate / 100.0))
		elif mode == "按月总金额 (元/月)":
			val = flt(self.rent_monthly_amount)
			ann_incl = (val * 12.0) if is_incl else (val * 12.0 * (1.0 + tax_rate / 100.0))
		elif mode == "按日单价 (元/㎡·天)":
			val = flt(self.rent_daily_rate)
			ann_incl = (val * area * 365.0) if is_incl else (val * area * 365.0 * (1.0 + tax_rate / 100.0))
		elif mode == "按月单价 (元/㎡·月)":
			val = flt(self.rent_monthly_rate)
			ann_incl = (val * area * 12.0) if is_incl else (val * area * 12.0 * (1.0 + tax_rate / 100.0))
		elif mode == "按年单价 (元/㎡·年)":
			val = flt(self.rent_annual_rate)
			ann_incl = (val * area) if is_incl else (val * area * (1.0 + tax_rate / 100.0))
		else:
			ann_incl = flt(self.rent_annual_amount)

		# 2. 从含税年总额派生所有互算字段
		self.rent_annual_amount = round(ann_incl, 2)
		self.rent_monthly_amount = round(ann_incl / 12.0, 2)
		self.rent_daily_rate = round(ann_incl / (area * 365.0), 6)
		self.rent_monthly_rate = round(ann_incl / (area * 12.0), 6)
		self.rent_annual_rate = round(ann_incl / area, 6)

		# 3. 价税分离计算
		ann_excl = round(ann_incl / (1.0 + tax_rate / 100.0), 2)
		ann_tax = round(ann_incl - ann_excl, 2)
		self.rent_annual_tax_excl = ann_excl
		self.rent_annual_tax_amount = ann_tax

	def calculate_property_fee_rates(self):
		"""
		物业费单价与总额自动互算 (税率与房租独立，默认 6.0%)
		"""
		mode = self.property_fee_mode or "免物业费"
		if mode != "单独计物业费":
			self.property_fee_annual_amount = 0.0
			self.property_fee_monthly_amount = 0.0
			self.property_fee_daily_rate = 0.0
			self.property_fee_monthly_rate = 0.0
			self.property_fee_annual_rate = 0.0
			self.property_fee_annual_tax_excl = 0.0
			self.property_fee_annual_tax_amount = 0.0
			return

		area = flt(self.area)
		if area <= 0:
			area = 1.0

		p_mode = self.property_fee_pricing_mode or "按年单价 (元/㎡·年)"
		p_tax_rate = flt(self.property_fee_tax_rate if self.property_fee_tax_rate is not None else 6.0)
		self.property_fee_tax_rate = p_tax_rate
		p_is_incl = bool(cint(self.property_fee_is_tax_inclusive if self.property_fee_is_tax_inclusive is not None else 1))

		p_ann_incl = 0.0
		if p_mode == "按月单价 (元/㎡·月)":
			val = flt(self.property_fee_monthly_rate)
			p_ann_incl = (val * area * 12.0) if p_is_incl else (val * area * 12.0 * (1.0 + p_tax_rate / 100.0))
		elif p_mode == "按年总金额 (元/年)":
			val = flt(self.property_fee_annual_amount)
			p_ann_incl = val if p_is_incl else (val * (1.0 + p_tax_rate / 100.0))
		elif p_mode == "按日单价 (元/㎡·天)":
			val = flt(self.property_fee_daily_rate)
			p_ann_incl = (val * area * 365.0) if p_is_incl else (val * area * 365.0 * (1.0 + p_tax_rate / 100.0))
		elif p_mode == "按年单价 (元/㎡·年)":
			val = flt(self.property_fee_annual_rate)
			p_ann_incl = (val * area) if p_is_incl else (val * area * (1.0 + p_tax_rate / 100.0))
		elif p_mode == "按月总金额 (元/月)":
			val = flt(self.property_fee_monthly_amount)
			p_ann_incl = (val * 12.0) if p_is_incl else (val * 12.0 * (1.0 + p_tax_rate / 100.0))
		else:
			p_ann_incl = flt(self.property_fee_annual_amount)

		self.property_fee_annual_amount = round(p_ann_incl, 2)
		self.property_fee_monthly_amount = round(p_ann_incl / 12.0, 2)
		self.property_fee_daily_rate = round(p_ann_incl / (area * 365.0), 6)
		self.property_fee_monthly_rate = round(p_ann_incl / (area * 12.0), 6)
		self.property_fee_annual_rate = round(p_ann_incl / area, 6)

		# 价税分离 (6% 专票)
		p_excl = round(p_ann_incl / (1.0 + p_tax_rate / 100.0), 2)
		p_tax = round(p_ann_incl - p_excl, 2)
		self.property_fee_annual_tax_excl = p_excl
		self.property_fee_annual_tax_amount = p_tax

	def calculate_totals(self):
		"""
		综合场地成本透视 (房租 + 物业费) 与 发票对账状态校验
		"""
		r_ann = flt(self.rent_annual_amount)
		p_ann = flt(self.property_fee_annual_amount)
		disc = flt(self.annual_discount_amount)
		area = flt(self.area) or 1.0

		tot_ann = r_ann + p_ann
		self.total_annual_amount = round(tot_ann, 2)
		self.total_monthly_amount = round(tot_ann / 12.0, 2)
		self.total_daily_rate = round(tot_ann / (area * 365.0), 6)
		self.total_annual_rate = round(tot_ann / area, 6)

		# 校验发票对账状态
		tot_payable = max(0.0, tot_ann - disc)
		tot_invoiced = flt(self.rent_invoice_amount) + flt(self.property_fee_invoice_amount)
		if tot_payable <= 0:
			self.invoice_status = "全额已开票" if tot_invoiced > 0 else "未开票"
		elif tot_invoiced >= tot_payable - 0.01:
			self.invoice_status = "全额已开票"
		elif tot_invoiced > 0:
			self.invoice_status = "部分开票"
		else:
			self.invoice_status = "未开票"
