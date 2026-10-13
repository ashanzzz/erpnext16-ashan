import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))
# Copyright (c) 2026, Ashan CN Procurement
# For license information, please see license.txt

import unittest
from pathlib import Path
import json


class TestJizhongEmployeeTypePolicy(unittest.TestCase):
	def setUp(self):
		self.doctype_path = (
			Path(__file__).resolve().parents[1]
			/ "ashan_cn_procurement"
			/ "doctype"
			/ "jizhong_employee_type_policy"
			/ "jizhong_employee_type_policy.json"
		)

	def test_doctype_definition_exists_and_valid(self):
		self.assertTrue(self.doctype_path.is_file())
		with open(self.doctype_path, "r", encoding="utf-8") as f:
			data = json.load(f)

		self.assertEqual(data.get("name"), "Jizhong Employee Type Policy")
		self.assertEqual(data.get("module"), "Ashan CN Procurement")

		fields = {f["fieldname"]: f for f in data.get("fields", []) if "fieldname" in f}
		self.assertIn("company", fields)
		self.assertIn("employee_type", fields)
		self.assertIn("category_group", fields)
		self.assertIn("participate_tax", fields)
		self.assertIn("participate_social_security", fields)
		self.assertIn("participate_housing_fund", fields)
		self.assertIn("participate_attendance", fields)
		self.assertIn("participate_cash_bills", fields)

		# Employee type must not include resignation
		emp_type_options = [x.strip() for x in fields["employee_type"]["options"].splitlines() if x.strip()]
		self.assertNotIn("本月离职", emp_type_options)
		self.assertIn("正式工", emp_type_options)
		self.assertIn("其他-正式工", emp_type_options)
		self.assertIn("临时工", emp_type_options)
		self.assertIn("退休返聘人员", emp_type_options)



	def test_employee_category_mapping_for_other(self):
		from ashan_cn_procurement.services.jizhong_payroll_service import _jizhong_employee_category
		self.assertEqual(_jizhong_employee_category("其他"), "其他类型员工")
		self.assertEqual(_jizhong_employee_category("其他类型员工"), "其他类型员工")
		self.assertEqual(_jizhong_employee_category("正式工"), "正式工")
		self.assertEqual(_jizhong_employee_category("其他-正式工"), "正式工")

	def test_statutory_exclusion_for_other_types(self):
		from ashan_cn_procurement.services.jizhong_payroll_service import JIZHONG_NO_INSURANCE_TYPES
		self.assertIn("其他类型员工", JIZHONG_NO_INSURANCE_TYPES)
		self.assertIn("其他", JIZHONG_NO_INSURANCE_TYPES)
		self.assertIn("退休返聘人员", JIZHONG_NO_INSURANCE_TYPES)


if __name__ == "__main__":
	unittest.main()
