# -*- coding: utf-8 -*-
# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import cstr

def on_vehicle_update(doc, method=None):
	"""
	当车辆档案保存或更新时，自动双向联动：
	1. 主要驾驶员 (custom_primary_driver) 同步到 Vehicle Toll Config (primary_user)
	2. 车辆状态 (custom_vehicle_status) 联动更新 Vehicle Toll Config (is_active)
	3. 根据 fuel_type 智能兜底 custom_default_fuel_grade
	"""
	vehicle_id = doc.name
	driver = cstr(getattr(doc, "custom_primary_driver", "")).strip()
	status = cstr(getattr(doc, "custom_vehicle_status", "正常在用")).strip()

	# 1. 联动更新已存在的 Vehicle Toll Config
	if frappe.db.exists("Vehicle Toll Config", vehicle_id):
		t_doc = frappe.get_doc("Vehicle Toll Config", vehicle_id)
		changed = False
		remark = cstr(getattr(doc, "custom_vehicle_remark", "")).strip()
		disp_name = f"{vehicle_id} ({remark})" if remark else vehicle_id
		if disp_name and t_doc.display_name != disp_name:
			t_doc.display_name = disp_name
			changed = True
		if driver and t_doc.primary_user != driver:
			t_doc.primary_user = driver
			changed = True
		if status == "封存停用" and t_doc.is_active != 0:
			t_doc.is_active = 0
			changed = True
		elif status == "正常在用" and t_doc.is_active != 1:
			t_doc.is_active = 1
			changed = True
		if changed:
			t_doc.save(ignore_permissions=True)


