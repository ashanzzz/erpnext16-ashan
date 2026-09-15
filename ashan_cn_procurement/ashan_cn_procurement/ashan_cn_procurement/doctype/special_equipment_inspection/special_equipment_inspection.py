# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import re
import frappe
from frappe.model.document import Document
from frappe import _


class SpecialEquipmentInspection(Document):
	def validate(self):
		self.validate_and_set_company()
		self.validate_dates_and_precision()

	def validate_and_set_company(self):
		if self.special_equipment and not self.company:
			self.company = frappe.db.get_value("Special Equipment", self.special_equipment, "company")

	def validate_dates_and_precision(self):
		if not self.due_date_precision:
			self.due_date_precision = "精确日期"

		if self.due_date_precision == "精确日期":
			if not self.valid_until:
				frappe.throw(_("当到期设定精度为【精确日期】时，【法定有效截止日】为必填项！"))
			self.reminder_due_date = None
		elif self.due_date_precision == "仅到月份":
			if not self.valid_until_month:
				frappe.throw(_("当到期设定精度为【仅到月份】时，【法定有效截止月份】为必填项！"))
			# 规范化年月格式，如 "2027年3月" -> "2027-03", "2027-3" -> "2027-03"
			m_str = self.valid_until_month.strip()
			match = re.search(r"(\d{4})[^\d]?(\d{1,2})", m_str)
			if match:
				year = int(match.group(1))
				month = int(match.group(2))
				if 1 <= month <= 12:
					self.valid_until_month = f"{year:04d}-{month:02d}"
					self.reminder_due_date = f"{year:04d}-{month:02d}-01"
				else:
					frappe.throw(_("有效月份输入不合法（月份应为 1-12）！"))
			else:
				frappe.throw(_("有效月份格式无法识别，请使用如 '2027-03' 或 '2027年3月' 格式！"))

	def on_update(self):
		from ashan_cn_procurement.services.special_equipment import sync_inspection_snapshot
		if self.special_equipment:
			sync_inspection_snapshot(self.special_equipment)

	def on_trash(self):
		from ashan_cn_procurement.services.special_equipment import sync_inspection_snapshot
		if self.special_equipment:
			# 在删除后重新查询最新记录进行回退同步
			frappe.db.after_commit.add(lambda: sync_inspection_snapshot(self.special_equipment))
