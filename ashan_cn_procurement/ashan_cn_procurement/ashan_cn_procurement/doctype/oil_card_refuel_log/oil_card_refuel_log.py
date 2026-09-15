# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import flt, cstr

class OilCardRefuelLog(Document):
	def after_insert(self):
		self.update_vehicle_last_refuel_info()

	def on_update(self):
		self.update_vehicle_last_refuel_info()

	def update_vehicle_last_refuel_info(self):
		"""
		加油记录保存时，自动将本次加油油号记忆到车辆档案：
		1. 车辆的 custom_default_fuel_grade 自动更新为本次加油油号（下次加油默认带出）
		2. 车辆的 last_odometer 更新为最新里程
		"""
		if not self.vehicle or not frappe.db.exists("Vehicle", self.vehicle):
			return

		update_fields = {}
		grade = cstr(self.fuel_grade).strip()
		if grade and frappe.db.has_column("Vehicle", "custom_default_fuel_grade"):
			update_fields["custom_default_fuel_grade"] = grade

		current_odo = flt(self.current_odometer or 0)
		veh_odo = flt(frappe.db.get_value("Vehicle", self.vehicle, "last_odometer") or 0)
		if current_odo > veh_odo:
			update_fields["last_odometer"] = int(current_odo)

		if update_fields:
			frappe.db.set_value("Vehicle", self.vehicle, update_fields, update_modified=True)
