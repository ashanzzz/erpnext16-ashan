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
		self.assertEqual(data.get("autoname"), "format:QF-ETP-{###}")
		self.assertEqual(data.get("module"), "Ashan CN Procurement")

		fields = {f["fieldname"]: f for f in data.get("fields", []) if "fieldname" in f}
		self.assertIn("company", fields)
		self.assertIn("employee_type", fields)
		self.assertIn("is_other", fields)
		self.assertIn("participate_tax", fields)
		self.assertIn("participate_social_security", fields)
		self.assertIn("participate_housing_fund", fields)
		self.assertIn("participate_workshop_roster", fields)

		# 2026-10-26 铁律：用工性质必须是 Data 纯文本直接录入，严禁做成死板 Select
		self.assertEqual(fields["employee_type"]["fieldtype"], "Data")


if __name__ == "__main__":
	unittest.main()
