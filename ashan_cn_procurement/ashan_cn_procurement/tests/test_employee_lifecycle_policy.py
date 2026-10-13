# Copyright (c) 2026, Ashan CN Procurement
# For license information, please see license.txt

import unittest
from pathlib import Path
import json


class TestEmployeeLifecyclePolicy(unittest.TestCase):
	def setUp(self):
		self.jz_profile_path = (
			Path(__file__).resolve().parents[1]
			/ "ashan_cn_procurement"
			/ "doctype"
			/ "jizhong_employee_salary_profile"
			/ "jizhong_employee_salary_profile.json"
		)
		self.sidebar_path = (
			Path(__file__).resolve().parents[1]
			/ "ashan_cn_procurement"
			/ "workspace_sidebar"
			/ "home.json"
		)

	def test_jizhong_profile_pure_types_and_lifecycle_status(self):
		self.assertTrue(self.jz_profile_path.is_file())
		with open(self.jz_profile_path, "r", encoding="utf-8") as f:
			data = json.load(f)

		fields = {f["fieldname"]: f for f in data.get("fields", []) if "fieldname" in f}
		emp_types = [x.strip() for x in fields["employee_type"]["options"].splitlines() if x.strip()]
		emp_statuses = [x.strip() for x in fields["employment_status"]["options"].splitlines() if x.strip()]

		# "本月离职" must be in employment_status, NOT in employee_type
		self.assertIn("本月离职", emp_types)
		self.assertNotIn("本月离职人员", emp_types)
		self.assertIn("本月离职", emp_statuses)
		self.assertIn("在职", emp_statuses)
		self.assertIn("离职", emp_statuses)

	def test_sidebar_includes_separate_policy_links(self):
		self.assertTrue(self.sidebar_path.is_file())
		with open(self.sidebar_path, "r", encoding="utf-8") as f:
			data = json.load(f)

		items = data.get("items", [])
		labels = {it.get("label"): it for it in items}

		self.assertIn("吉众人员类型计算规则", labels)
		self.assertEqual(labels["吉众人员类型计算规则"].get("link_to"), "Jizhong Employee Type Policy")
		self.assertEqual(labels["吉众人员类型计算规则"].get("link_type"), "DocType")

		self.assertIn("祺富人员类型计算规则", labels)
		self.assertEqual(labels["祺富人员类型计算规则"].get("link_to"), "Qifu Employee Type Policy")
		self.assertEqual(labels["祺富人员类型计算规则"].get("link_type"), "DocType")


if __name__ == "__main__":
	unittest.main()
