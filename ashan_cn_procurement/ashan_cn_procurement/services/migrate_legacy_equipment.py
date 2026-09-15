# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import cstr


def migrate_compliance_equipment_to_special_equipment(dry_run=True):
	"""
	从旧 Compliance Equipment Item 表评估/迁移至 Special Equipment 特种设备主档
	默认 dry_run=True（仅评估与预检，不写入实际数据）
	"""
	legacy_items = frappe.get_all(
		"Compliance Equipment Item",
		fields=[
			"name", "company", "equipment_name", "equipment_no", "equipment_type",
			"responsible_person", "linked_asset", "last_inspection_date", "next_due_date"
		]
	)

	report = {
		"total_legacy_records": len(legacy_items),
		"dry_run": dry_run,
		"migrated": [],
		"skipped_duplicates": [],
		"warnings": []
	}

	for item in legacy_items:
		eq_name = item.equipment_name or item.name
		internal_no = item.equipment_no or ""
		company = item.company

		# 检查是否已存在于 Special Equipment
		exists = frappe.db.exists("Special Equipment", {"company": company, "equipment_name": eq_name})
		if exists:
			report["skipped_duplicates"].append({
				"legacy_id": item.name,
				"equipment_name": eq_name,
				"existing_special_equipment": exists,
				"reason": "已存在同名特种设备"
			})
			continue

		mapped_data = {
			"company": company,
			"equipment_name": eq_name,
			"equipment_category": "场（厂）内专用机动车辆" if "车" in eq_name or "叉车" in cstr(item.equipment_type) else "其他",
			"internal_number": internal_no,
			"responsible_person": item.responsible_person or None,
			"linked_asset": item.linked_asset or None,
			"equipment_status": "在用",
			"remarks": f"由历史普通设备【{item.name}】迁移导入"
		}

		if not dry_run:
			doc = frappe.new_doc("Special Equipment")
			doc.update(mapped_data)
			doc.insert(ignore_permissions=True)
			report["migrated"].append({"legacy_id": item.name, "new_id": doc.name})
		else:
			report["migrated"].append({"legacy_id": item.name, "preview_data": mapped_data})

	if not dry_run:
		frappe.db.commit()

	return report
