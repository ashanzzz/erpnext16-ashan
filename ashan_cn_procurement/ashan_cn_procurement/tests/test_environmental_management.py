# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import getdate, add_months, nowdate, add_days

from ashan_cn_procurement.services.environmental_management import (
	calc_next_due_date,
	calculate_env_days_remaining,
	calculate_env_status
)
from ashan_cn_procurement.ashan_cn_procurement.page.environmental_management.environmental_management import (
	get_environmental_dashboard_data,
	quick_create_env_item,
	quick_update_env_item,
	record_env_action,
	upload_env_report
)


class TestEnvironmentalManagement(FrappeTestCase):
	def setUp(self):
		frappe.db.delete("Environmental Compliance Item", {"title": ["like", "TEST-%"]})

	def tearDown(self):
		frappe.db.delete("Environmental Compliance Item", {"title": ["like", "TEST-%"]})

	def test_01_month_end_date_calculations(self):
		"""
		测试严格的月末及闰年日期推算逻辑
		"""
		# 2026-01-31 + 1m -> 2026-02-28
		d1 = calc_next_due_date("2026-01-31", 1)
		self.assertEqual(str(d1), "2026-02-28")

		# 2026-08-31 + 6m -> 2027-02-28
		d2 = calc_next_due_date("2026-08-31", 6)
		self.assertEqual(str(d2), "2027-02-28")

		# 2024-02-29 + 12m -> 2025-02-28
		d3 = calc_next_due_date("2024-02-29", 12)
		self.assertEqual(str(d3), "2025-02-28")

		# 2026-03-15 + 3m -> 2026-06-15
		d4 = calc_next_due_date("2026-03-15", 3)
		self.assertEqual(str(d4), "2026-06-15")

	def test_02_status_ladder_and_days_remaining(self):
		"""
		测试到期状态阶梯判定：正常(>60)、注意(31~60)、即将到期(1~30)、今日到期(0)、已逾期(<0)
		"""
		today = getdate(nowdate())

		# 正常 (>60)
		due_normal = add_days(today, 65)
		rem_normal = calculate_env_days_remaining(due_normal)
		self.assertEqual(rem_normal, 65)
		self.assertEqual(calculate_env_status(rem_normal), "正常")

		# 注意 (31~60)
		due_notice = add_days(today, 45)
		rem_notice = calculate_env_days_remaining(due_notice)
		self.assertEqual(rem_notice, 45)
		self.assertEqual(calculate_env_status(rem_notice), "注意")

		# 即将到期 (1~30)
		due_upcoming = add_days(today, 15)
		rem_upcoming = calculate_env_days_remaining(due_upcoming)
		self.assertEqual(rem_upcoming, 15)
		self.assertEqual(calculate_env_status(rem_upcoming), "即将到期")

		# 今日到期 (0)
		due_today = today
		rem_today = calculate_env_days_remaining(due_today)
		self.assertEqual(rem_today, 0)
		self.assertEqual(calculate_env_status(rem_today), "今日到期")

		# 已逾期 (<0)
		due_overdue = add_days(today, -10)
		rem_overdue = calculate_env_days_remaining(due_overdue)
		self.assertEqual(rem_overdue, -10)
		self.assertEqual(calculate_env_status(rem_overdue), "已逾期")

	def test_03_quick_create_and_dashboard_tab_separation(self):
		"""
		测试快速创建项目及危废 vs 定期检测 Tab 业务隔离
		"""
		company = frappe.get_all("Company", limit=1)[0].name

		# 创建检测项目 (废气)
		res_gas = quick_create_env_item(
			title="TEST-有组织废气检测",
			company=company,
			env_type="废气",
			last_done_date="2026-05-10",
			cycle_months=3,
			use_location="1号排气筒",
			responsible_person="李工"
		)
		self.assertTrue(res_gas["success"])

		# 创建危废项目 (危废)
		res_waste = quick_create_env_item(
			title="TEST-危废暂存间废油转移",
			company=company,
			env_type="危废",
			last_done_date="2026-02-01",
			cycle_months=6,
			use_location="危废暂存区",
			responsible_person="王主管"
		)
		self.assertTrue(res_waste["success"])

		# 验证定期检测 Tab：只包含废气，不包含危废
		data_insp = get_environmental_dashboard_data(tab_type="inspection")
		insp_titles = [it.title for it in data_insp["items"]]
		self.assertIn("TEST-有组织废气检测", insp_titles)
		self.assertNotIn("TEST-危废暂存间废油转移", insp_titles)

		# 验证危废管理 Tab：只包含危废，不包含废气
		data_waste = get_environmental_dashboard_data(tab_type="waste")
		waste_titles = [it.title for it in data_waste["items"]]
		self.assertIn("TEST-危废暂存间废油转移", waste_titles)
		self.assertNotIn("TEST-有组织废气检测", waste_titles)

	def test_04_record_action_and_date_progression(self):
		"""
		测试登记本次检测：自动推进上次检测日期与下次到期日
		"""
		company = frappe.get_all("Company", limit=1)[0].name
		res = quick_create_env_item(
			title="TEST-生活废水检测",
			company=company,
			env_type="废水",
			last_done_date="2026-01-01",
			cycle_months=3
		)
		name = res["name"]

		# 登记本次检测为 2026-04-15
		rec_res = record_env_action(
			name=name,
			action_date="2026-04-15",
			cycle_months=3,
			remarks="检测达标"
		)
		self.assertTrue(rec_res["success"])
		self.assertEqual(rec_res["next_due_date"], "2026-07-15")

		doc = frappe.get_doc("Environmental Compliance Item", name)
		self.assertEqual(str(doc.last_done_date), "2026-04-15")
		self.assertEqual(str(doc.next_due_date), "2026-07-15")

	def test_05_report_upload_and_status_check(self):
		"""
		测试报告上传及状态辨别 (待上传 -> 已上传)
		"""
		company = frappe.get_all("Company", limit=1)[0].name
		res = quick_create_env_item(
			title="TEST-厂界噪声检测",
			company=company,
			env_type="噪声",
			last_done_date="2026-03-01",
			cycle_months=6
		)
		name = res["name"]

		doc = frappe.get_doc("Environmental Compliance Item", name)
		self.assertFalse(doc.latest_report)

		# 快速上传报告
		up_res = upload_env_report(name=name, latest_report="/files/noise_test_2026.pdf")
		self.assertTrue(up_res["success"])

		doc.reload()
		self.assertEqual(doc.latest_report, "/files/noise_test_2026.pdf")
