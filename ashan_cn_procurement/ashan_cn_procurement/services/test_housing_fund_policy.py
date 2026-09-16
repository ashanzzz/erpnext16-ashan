import unittest

import sys
import types
from datetime import date, datetime

try:
    import frappe  # noqa: F401
except ModuleNotFoundError:
    frappe = types.ModuleType("frappe")
    frappe.throw = lambda message: (_ for _ in ()).throw(ValueError(message))
    frappe.db = types.SimpleNamespace()
    frappe.get_all = lambda *args, **kwargs: []
    frappe.whitelist = lambda *args, **kwargs: (lambda fn: fn) if not (args and callable(args[0])) else args[0]
    sys.modules["frappe"] = frappe

    utils = types.ModuleType("frappe.utils")
    utils.cint = lambda value=0: int(float(value or 0))
    utils.flt = lambda value=0: float(value or 0)
    utils.today = lambda: date.today().isoformat()
    def _getdate(value=None):
        if value is None:
            return date.today()
        if isinstance(value, date):
            return value
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    utils.getdate = _getdate
    sys.modules["frappe.utils"] = utils

from ashan_cn_procurement.services.housing_fund_policy_service import (
    OVERRIDE_OFF,
    OVERRIDE_ON,
    POLICY_FIXED_OFF,
    POLICY_FIXED_ON,
    POLICY_FOLLOW,
    JIZHONG_POLICY_MONTHLY,
    JIZHONG_POLICY_NEVER,
    JIZHONG_POLICY_QUARTER_START,
    evaluate_housing_fund_policy,
    get_jizhong_housing_fund_policy_label,
)


class TestHousingFundPolicy(unittest.TestCase):
    def employee(self, policy=POLICY_FOLLOW, base=2320, employee_type="正式工"):
        return {
            "employee_no": "T001",
            "employee_name": "测试员工",
            "employee_type": employee_type,
            "housing_fund_base": base,
            "housing_fund_policy": policy,
        }

    def setting(self, months="1,4,7,10", enabled=1, off="停缴"):
        return {
            "hf_auto_rule_enabled": enabled,
            "hf_contribution_months": months,
            "hf_off_month_action": off,
        }

    def test_quarter_schedule_uses_actual_payment_month(self):
        emp = self.employee()
        payment_pairs = {
            "2025-12": "2026-01", "2026-03": "2026-04",
            "2026-06": "2026-07", "2026-09": "2026-10",
        }
        for payroll_month, payment_month in payment_pairs.items():
            result = evaluate_housing_fund_policy(emp, payroll_month, self.setting())
            self.assertTrue(result["is_contributing"])
            self.assertEqual(result["effective_base"], 2320)
            self.assertEqual(result["payment_period_month"], payment_month)
        for month in (1, 2, 4, 5, 7, 8, 10, 11):
            result = evaluate_housing_fund_policy(emp, f"2026-{month:02d}", self.setting())
            self.assertFalse(result["is_contributing"])
            self.assertEqual(result["effective_base"], 0)

    def test_fixed_on_is_exempt_from_off_month(self):
        result = evaluate_housing_fund_policy(self.employee(POLICY_FIXED_ON), "2026-08", self.setting())
        self.assertTrue(result["is_contributing"])
        self.assertEqual(result["decision_code"], "FIXED_ON")

    def test_fixed_off_stops_even_in_scheduled_month(self):
        result = evaluate_housing_fund_policy(self.employee(POLICY_FIXED_OFF), "2026-06", self.setting())
        self.assertFalse(result["is_contributing"])
        self.assertEqual(result["decision_code"], "FIXED_OFF")

    def test_jizhong_policy_labels_keep_the_existing_calculation_rules(self):
        quarterly = evaluate_housing_fund_policy(
            self.employee(JIZHONG_POLICY_QUARTER_START), "2026-06", self.setting()
        )
        monthly = evaluate_housing_fund_policy(
            self.employee(JIZHONG_POLICY_MONTHLY), "2026-08", self.setting()
        )
        never = evaluate_housing_fund_policy(
            self.employee(JIZHONG_POLICY_NEVER), "2026-06", self.setting()
        )
        self.assertTrue(quarterly["is_contributing"])
        self.assertTrue(monthly["is_contributing"])
        self.assertFalse(never["is_contributing"])
        self.assertEqual(get_jizhong_housing_fund_policy_label(POLICY_FOLLOW), JIZHONG_POLICY_QUARTER_START)
        self.assertEqual(get_jizhong_housing_fund_policy_label(POLICY_FIXED_ON), JIZHONG_POLICY_MONTHLY)
        self.assertEqual(get_jizhong_housing_fund_policy_label(POLICY_FIXED_OFF), JIZHONG_POLICY_NEVER)

    def test_monthly_override_has_highest_policy_priority(self):
        on = evaluate_housing_fund_policy(self.employee(POLICY_FIXED_OFF), "2026-08", self.setting(), OVERRIDE_ON)
        off = evaluate_housing_fund_policy(self.employee(POLICY_FIXED_ON), "2026-07", self.setting(), OVERRIDE_OFF)
        self.assertTrue(on["is_contributing"])
        self.assertFalse(off["is_contributing"])

    def test_master_base_is_never_mutated(self):
        emp = self.employee(POLICY_FOLLOW, 20000)
        result = evaluate_housing_fund_policy(emp, "2026-08", self.setting())
        self.assertEqual(emp["housing_fund_base"], 20000)
        self.assertEqual(result["master_base"], 20000)
        self.assertEqual(result["effective_base"], 0)

    def test_ineligible_type_cannot_be_forced_on(self):
        result = evaluate_housing_fund_policy(self.employee(POLICY_FIXED_ON, employee_type="临时工"), "2026-06", self.setting(), OVERRIDE_ON)
        self.assertFalse(result["is_contributing"])
        self.assertEqual(result["decision_code"], "INELIGIBLE_TYPE")

    def test_minimum_base_reads_the_period_setting(self):
        employee = self.employee(base=2520)
        employee["housing_fund_base_mode"] = "最低缴费基数"
        setting = self.setting()
        setting["hf_min_base"] = 3180
        result = evaluate_housing_fund_policy(employee, "2026-06", setting)
        self.assertEqual(result["master_base"], 3180)
        self.assertEqual(result["effective_base"], 3180)

    def test_custom_base_ignores_period_minimum(self):
        employee = self.employee(base=2520)
        employee["housing_fund_base_mode"] = "自定义"
        employee["custom_housing_fund_base"] = 6800
        setting = self.setting()
        setting["hf_min_base"] = 3180
        result = evaluate_housing_fund_policy(employee, "2026-06", setting)
        self.assertEqual(result["master_base"], 6800)
        self.assertEqual(result["effective_base"], 6800)


if __name__ == "__main__":
    unittest.main()
