# Copyright (c) 2026, Ashan CN Procurement
# For license information, please see license.txt

import unittest
from pathlib import Path
import json


class TestQifuEmployeeTypePolicy(unittest.TestCase):
	def setUp(self):
		self.doctype_path = (
			Path(__file__).resolve().parents[1]
			/ "ashan_cn_procurement"
			/ "doctype"
			/ "qifu_employee_type_policy"
			/ "qifu_employee_type_policy.json"
		)

	def test_doctype_definition_exists_and_valid(self):
		self.assertTrue(self.doctype_path.is_file())
		with open(self.doctype_path, "r", encoding="utf-8") as f:
			data = json.load(f)

		self.assertEqual(data.get("name"), "Qifu Employee Type Policy")
		self.assertEqual(data.get("module"), "Ashan CN Procurement")

		fields = {f["fieldname"]: f for f in data.get("fields", []) if "fieldname" in f}
		self.assertIn("company", fields)
		self.assertIn("employee_type", fields)
		self.assertIn("category_group", fields)
		self.assertIn("participate_tax", fields)
		self.assertIn("participate_social_security", fields)
		self.assertIn("participate_housing_fund", fields)
		self.assertIn("participate_workshop_roster", fields)

		# Employee type must include Qifu specific roles
		emp_type_options = [x.strip() for x in fields["employee_type"]["options"].splitlines() if x.strip()]
		self.assertIn("正式工", emp_type_options)
		self.assertIn("返聘工", emp_type_options)
		self.assertIn("其他-返聘工", emp_type_options)
		self.assertIn("其他-正式工", emp_type_options)
		self.assertIn("临时工", emp_type_options)
		self.assertIn("本月离职", emp_type_options)
		self.assertIn("劳务派遣", emp_type_options)
		self.assertIn("实习生", emp_type_options)
		self.assertIn("其他-外籍工", emp_type_options)

	def test_profile_json_includes_other_foreign_worker(self):
		profile_path = (
			Path(__file__).resolve().parents[1]
			/ "ashan_cn_procurement"
			/ "doctype"
			/ "ashan_employee_salary_profile"
			/ "ashan_employee_salary_profile.json"
		)
		with open(profile_path, "r", encoding="utf-8") as f:
			data = json.load(f)
		fields = {f["fieldname"]: f for f in data.get("fields", []) if "fieldname" in f}
		emp_type_options = [x.strip() for x in fields["employee_type"]["options"].splitlines() if x.strip()]
		self.assertIn("其他-外籍工", emp_type_options)

	def test_social_security_normalization_for_non_insured(self):
		import sys, types
		try:
			import frappe  # noqa: F401
		except ModuleNotFoundError:
			frappe = types.ModuleType("frappe")
			frappe.throw = lambda message: (_ for _ in ()).throw(ValueError(message))
			frappe.db = types.SimpleNamespace()
			frappe.get_all = lambda *args, **kwargs: []
			frappe.get_list = lambda *args, **kwargs: []
			frappe.whitelist = lambda *args, **kwargs: (lambda fn: fn) if not (args and callable(args[0])) else args[0]
			frappe._ = lambda msg: msg
			sys.modules["frappe"] = frappe

			utils = types.ModuleType("frappe.utils")
			utils.cint = lambda value=0: int(float(value or 0))
			utils.flt = lambda value=0: float(value or 0)
			sys.modules["frappe.utils"] = utils

		from ashan_cn_procurement.services.employee_salary_service import (
			normalize_social_security_base_mode,
			_normalize_social_security_base_payload,
		)
		self.assertEqual(normalize_social_security_base_mode("不参保"), "自定义")
		self.assertEqual(normalize_social_security_base_mode("不缴纳"), "自定义")

		# When is_insured is 0 or mode is 不参保
		payload = _normalize_social_security_base_payload({"is_insured": 0, "social_security_base_mode": "不参保"})
		self.assertEqual(payload["social_security_base_mode"], "自定义")
		self.assertEqual(payload["custom_social_security_base"], 0.0)
		self.assertEqual(payload["social_security_base"], 0.0)
		self.assertEqual(payload["is_insured"], 0)


if __name__ == "__main__":
	unittest.main()
