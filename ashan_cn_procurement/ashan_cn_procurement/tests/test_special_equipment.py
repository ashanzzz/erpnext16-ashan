# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import nowdate, add_to_date, add_days, getdate
from frappe.tests.utils import FrappeTestCase
from ashan_cn_procurement.services.special_equipment import (
	sync_inspection_snapshot,
	sync_annual_check_snapshot,
	refresh_all_special_equipment_status,
	calculate_expiry_status,
	calculate_days_remaining
)


class TestSpecialEquipment(FrappeTestCase):
	def setUp(self):
		frappe.db.rollback()
		# 清理测试数据
		test_eqs = frappe.get_all("Special Equipment", filters={"equipment_name": ["like", "TEST-%"]}, pluck="name")
		for eq_name in test_eqs:
			frappe.db.delete("Special Equipment Annual Inspection", {"special_equipment": eq_name})
			frappe.db.delete("Special Equipment Inspection", {"special_equipment": eq_name})
			frappe.db.delete("Special Equipment", {"name": eq_name})


		self.company = frappe.defaults.get_user_default("Company") or frappe.db.get_single_value("Global Defaults", "default_company")
		if not self.company:
			c = frappe.get_all("Company", limit=1)
			self.company = c[0].name if c else "天津祺富机械加工有限公司"

	def test_1_create_special_equipment(self):
		"""Test 1: 新增特种设备保存成功并拥有初始状态"""
		doc = frappe.new_doc("Special Equipment")
		doc.company = self.company
		doc.equipment_name = "TEST-叉车-001"
		doc.equipment_category = "场（厂）内专用机动车辆"
		doc.equipment_variety = "叉车"
		doc.plate_number = "场内津B·08539"
		doc.internal_number = "D002"
		doc.insert(ignore_permissions=True)

		self.assertTrue(doc.name)
		self.assertEqual(doc.equipment_status, "在用")
		self.assertEqual(doc.inspection_status, "待录入")
		self.assertEqual(doc.annual_check_status, "待检查")

	def test_2_inspection_exact_date_sync(self):
		"""Test 2: 新增精确日期法定检验，主档自动同步快照"""
		eq = frappe.new_doc("Special Equipment")
		eq.company = self.company
		eq.equipment_name = "TEST-托盘堆垛车-002"
		eq.plate_number = "场内津B·08539"
		eq.internal_number = "D002"
		eq.insert(ignore_permissions=True)

		# 新增法定检验：2026-03-10，有效期至 2028-03-10
		insp = frappe.new_doc("Special Equipment Inspection")
		insp.special_equipment = eq.name
		insp.company = self.company
		insp.inspection_type = "定期检验"
		insp.inspection_date = "2026-03-10"
		insp.inspection_result = "合格"
		insp.inspection_report_no = "TJ-INSP-2026-001"
		insp.due_date_precision = "精确日期"
		insp.valid_until = "2028-03-10"
		insp.insert(ignore_permissions=True)

		eq.reload()
		self.assertEqual(str(eq.latest_inspection_date), "2026-03-10")
		self.assertEqual(str(eq.inspection_valid_until), "2028-03-10")
		self.assertEqual(eq.latest_inspection_report_no, "TJ-INSP-2026-001")
		self.assertEqual(eq.inspection_status, "正常")
		self.assertTrue(eq.inspection_days_remaining > 60)

	def test_3_inspection_month_only_precision(self):
		"""Test 3: 法定检验仅给出 2028年3月，系统不虚构 2028-03-31，准确记录 2028-03 与基准日 2028-03-01"""
		eq = frappe.new_doc("Special Equipment")
		eq.company = self.company
		eq.equipment_name = "TEST-叉车-003"
		eq.insert(ignore_permissions=True)

		insp = frappe.new_doc("Special Equipment Inspection")
		insp.special_equipment = eq.name
		insp.company = self.company
		insp.inspection_type = "定期检验"
		insp.inspection_date = "2026-03-10"
		insp.due_date_precision = "仅到月份"
		insp.valid_until_month = "2028年3月"
		insp.insert(ignore_permissions=True)

		self.assertEqual(insp.valid_until_month, "2028-03")
		self.assertEqual(str(insp.reminder_due_date), "2028-03-01")

		eq.reload()
		self.assertEqual(eq.inspection_valid_until_month, "2028-03")
		self.assertEqual(str(eq.inspection_reminder_due_date), "2028-03-01")
		self.assertIsNone(eq.inspection_valid_until)

	def test_4_annual_check_auto_12_months(self):
		"""Test 4: 年度检查 check_date = 2026-08-10，下次检查日自动推算为 2027-08-10"""
		eq = frappe.new_doc("Special Equipment")
		eq.company = self.company
		eq.equipment_name = "TEST-叉车-004"
		eq.insert(ignore_permissions=True)

		annual = frappe.new_doc("Special Equipment Annual Inspection")
		annual.special_equipment = eq.name
		annual.company = self.company
		annual.check_date = "2026-08-10"
		annual.check_result = "合格"
		annual.insert(ignore_permissions=True)

		self.assertEqual(annual.inspection_year, 2026)
		self.assertEqual(str(annual.next_check_date), "2027-08-10")

		eq.reload()
		self.assertEqual(str(eq.latest_annual_check_date), "2026-08-10")
		self.assertEqual(str(eq.annual_check_due_date), "2027-08-10")
		self.assertEqual(eq.annual_check_status, "正常")

	def test_5_status_expiring_soon(self):
		"""Test 5: 剩余 20 天时状态自动识别为 即将到期"""
		due_date = add_days(nowdate(), 20)
		days = calculate_days_remaining(due_date)
		status = calculate_expiry_status(days)
		self.assertEqual(days, 20)
		self.assertEqual(status, "即将到期")

	def test_6_status_overdue(self):
		"""Test 6: 超过到期日（如过去 10 天）状态自动识别为 已逾期"""
		due_date = add_days(nowdate(), -10)
		days = calculate_days_remaining(due_date)
		status = calculate_expiry_status(days)
		self.assertEqual(days, -10)
		self.assertEqual(status, "已逾期")

	def test_7_rollback_on_inspection_delete(self):
		"""Test 7: 删除最新法定检验记录后，主档自动平滑回退到上一条记录"""
		eq = frappe.new_doc("Special Equipment")
		eq.company = self.company
		eq.equipment_name = "TEST-叉车-007"
		eq.insert(ignore_permissions=True)

		# 插入 2024 年旧检验
		insp1 = frappe.new_doc("Special Equipment Inspection")
		insp1.special_equipment = eq.name
		insp1.company = self.company
		insp1.inspection_type = "定期检验"
		insp1.inspection_date = "2024-03-01"
		insp1.valid_until = "2026-03-01"
		insp1.inspection_report_no = "OLD-2024"
		insp1.insert(ignore_permissions=True)

		# 插入 2026 年新检验
		insp2 = frappe.new_doc("Special Equipment Inspection")
		insp2.special_equipment = eq.name
		insp2.company = self.company
		insp2.inspection_type = "定期检验"
		insp2.inspection_date = "2026-03-01"
		insp2.valid_until = "2028-03-01"
		insp2.inspection_report_no = "NEW-2026"
		insp2.insert(ignore_permissions=True)

		eq.reload()
		self.assertEqual(eq.latest_inspection_report_no, "NEW-2026")

		# 删除 2026 新检验
		insp2.delete(ignore_permissions=True)
		sync_inspection_snapshot(eq.name)

		eq.reload()
		self.assertEqual(eq.latest_inspection_report_no, "OLD-2024")
		self.assertEqual(str(eq.latest_inspection_date), "2024-03-01")

	def test_8_rollback_on_annual_delete(self):
		"""Test 8: 删除最新年度检查后，主档自动回退到上一条"""
		eq = frappe.new_doc("Special Equipment")
		eq.company = self.company
		eq.equipment_name = "TEST-叉车-008"
		eq.insert(ignore_permissions=True)

		ann1 = frappe.new_doc("Special Equipment Annual Inspection")
		ann1.special_equipment = eq.name
		ann1.company = self.company
		ann1.check_date = "2025-05-01"
		ann1.next_check_date = "2026-05-01"
		ann1.insert(ignore_permissions=True)

		ann2 = frappe.new_doc("Special Equipment Annual Inspection")
		ann2.special_equipment = eq.name
		ann2.company = self.company
		ann2.check_date = "2026-05-01"
		ann2.next_check_date = "2027-05-01"
		ann2.insert(ignore_permissions=True)

		eq.reload()
		self.assertEqual(str(eq.latest_annual_check_date), "2026-05-01")

		ann2.delete(ignore_permissions=True)
		sync_annual_check_snapshot(eq.name)

		eq.reload()
		self.assertEqual(str(eq.latest_annual_check_date), "2025-05-01")

	def test_9_deactivated_equipment_no_reminders(self):
		"""Test 9: 停用/报废设备不进入到期提醒扫描"""
		eq = frappe.new_doc("Special Equipment")
		eq.company = self.company
		eq.equipment_name = "TEST-停用叉车-009"
		eq.equipment_status = "停用"
		eq.insert(ignore_permissions=True)

		# 触发全量扫描
		refresh_all_special_equipment_status()

		todos = frappe.get_all(
			"ToDo",
			filters={"reference_type": "Special Equipment", "reference_name": eq.name}
		)
		self.assertEqual(len(todos), 0)

	def test_10_todo_reminder_idempotency(self):
		"""Test 10: 连续运行两次 Daily Scheduler 不会产生重复 ToDo"""
		eq = frappe.new_doc("Special Equipment")
		eq.company = self.company
		eq.equipment_name = "TEST-临期设备-010"
		eq.equipment_status = "在用"
		eq.insert(ignore_permissions=True)

		# 录入一条 15 天后到期的检验
		insp = frappe.new_doc("Special Equipment Inspection")
		insp.special_equipment = eq.name
		insp.company = self.company
		insp.inspection_type = "定期检验"
		insp.inspection_date = add_days(nowdate(), -350)
		insp.valid_until = add_days(nowdate(), 15)
		insp.insert(ignore_permissions=True)

		# 运行第 1 次
		refresh_all_special_equipment_status()
		count1 = frappe.db.count("ToDo", {"reference_type": "Special Equipment", "reference_name": eq.name})
		self.assertTrue(count1 >= 1)

		# 运行第 2 次
		refresh_all_special_equipment_status()
		count2 = frappe.db.count("ToDo", {"reference_type": "Special Equipment", "reference_name": eq.name})
		self.assertEqual(count1, count2)
