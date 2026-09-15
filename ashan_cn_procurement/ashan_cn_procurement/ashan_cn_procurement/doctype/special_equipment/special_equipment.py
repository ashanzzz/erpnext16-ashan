# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe import _


class SpecialEquipment(Document):
	def validate(self):
		self.check_duplicate_identifiers()
		self.set_title_and_defaults()

	def set_title_and_defaults(self):
		if not self.equipment_status:
			self.equipment_status = "在用"
		if not self.inspection_status:
			self.inspection_status = "待录入"
		if not self.annual_check_status:
			self.annual_check_status = "待检查"

	def check_duplicate_identifiers(self):
		"""
		重复编号检测与风险提示（警告提示，不直接硬拦截，便于历史数据补录）
		"""
		company = self.company
		if not company:
			return

		# 1. 注册代码
		if self.registration_code:
			existing = frappe.db.get_value(
				"Special Equipment",
				{"company": company, "registration_code": self.registration_code.strip(), "name": ["!=", self.name]},
				"name"
			)
			if existing:
				frappe.msgprint(
					_("⚠️ 警告：当前公司已存在相同注册代码【{0}】的特种设备（主档编号：{1}），请核对是否录入重复。").format(
						self.registration_code, existing
					),
					indicator="orange",
					title=_("编号重复提示")
				)

		# 2. 设备代码
		if self.equipment_code:
			existing = frappe.db.get_value(
				"Special Equipment",
				{"company": company, "equipment_code": self.equipment_code.strip(), "name": ["!=", self.name]},
				"name"
			)
			if existing:
				frappe.msgprint(
					_("⚠️ 警告：当前公司已存在相同设备代码【{0}】的特种设备（主档编号：{1}），请核对。").format(
						self.equipment_code, existing
					),
					indicator="orange",
					title=_("编号重复提示")
				)

		# 3. 车牌编号
		if self.plate_number:
			existing = frappe.db.get_value(
				"Special Equipment",
				{"plate_number": self.plate_number.strip(), "equipment_status": "在用", "name": ["!=", self.name]},
				"name"
			)
			if existing:
				frappe.msgprint(
					_("⚠️ 警告：在用设备中已存在相同车牌编号【{0}】的设备（主档编号：{1}），请确认。").format(
						self.plate_number, existing
					),
					indicator="orange",
					title=_("车牌重复提示")
				)

		# 4. 单位内编号
		if self.internal_number:
			existing = frappe.db.get_value(
				"Special Equipment",
				{"company": company, "internal_number": self.internal_number.strip(), "name": ["!=", self.name]},
				"name"
			)
			if existing:
				frappe.msgprint(
					_("⚠️ 警告：当前公司已存在相同单位内编号【{0}】的设备（主档编号：{1}），请确认。").format(
						self.internal_number, existing
					),
					indicator="orange",
					title=_("内部编号重复提示")
				)
