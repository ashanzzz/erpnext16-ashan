# -*- coding: utf-8 -*-
import sys, os
from pathlib import Path
app_root = Path(__file__).resolve().parents[2]
inner_pkg = Path(__file__).resolve().parents[1]
if str(app_root) not in sys.path:
    sys.path.insert(0, str(app_root))
import ashan_cn_procurement
if str(inner_pkg) not in ashan_cn_procurement.__path__:
    ashan_cn_procurement.__path__.append(str(inner_pkg))

import unittest
import types
from datetime import date, datetime

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
    utils.today = lambda: date.today().isoformat()
    utils.now_datetime = lambda: datetime.now()
    utils.add_days = lambda dt, days: str(dt)
    utils.date_diff = lambda d1, d2: 0
    def _getdate(value=None):
        if value is None:
            return date.today()
        if isinstance(value, date):
            return value
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    utils.getdate = _getdate
    sys.modules["frappe.utils"] = utils

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
		self.assertIn("participate_payroll", fields)
		self.assertIn("participate_cash_bills", fields)

		emp_type_options = [x.strip() for x in fields["employee_type"]["options"].splitlines() if x.strip()]
		self.assertIn("正式工", emp_type_options)
		self.assertIn("返聘工", emp_type_options)
		self.assertIn("其他-返聘工", emp_type_options)
		self.assertIn("其他-正式工", emp_type_options)
		self.assertIn("临时工", emp_type_options)
		self.assertIn("本月离职", emp_type_options)

	def test_employee_category_mapping_for_other(self):
		from ashan_cn_procurement.services.jizhong_payroll_service import _jizhong_employee_category
		self.assertEqual(_jizhong_employee_category("其他"), "其他类型员工")
		self.assertEqual(_jizhong_employee_category("其他类型员工"), "其他类型员工")
		self.assertEqual(_jizhong_employee_category("正式工"), "正式工")
		self.assertEqual(_jizhong_employee_category("其他-正式工"), "正式工")
		self.assertEqual(_jizhong_employee_category("返聘工"), "退休返聘人员")
		self.assertEqual(_jizhong_employee_category("其他-返聘工"), "退休返聘人员")
		self.assertEqual(_jizhong_employee_category("本月离职"), "本月离职人员")

	def test_statutory_exclusion_for_other_types(self):
		from ashan_cn_procurement.services.jizhong_payroll_service import JIZHONG_NO_INSURANCE_TYPES
		self.assertIn("其他类型员工", JIZHONG_NO_INSURANCE_TYPES)
		self.assertIn("其他", JIZHONG_NO_INSURANCE_TYPES)
		self.assertIn("退休返聘人员", JIZHONG_NO_INSURANCE_TYPES)
		self.assertIn("返聘工", JIZHONG_NO_INSURANCE_TYPES)
		self.assertIn("其他-返聘工", JIZHONG_NO_INSURANCE_TYPES)
		self.assertIn("本月离职", JIZHONG_NO_INSURANCE_TYPES)


if __name__ == "__main__":
	unittest.main()
