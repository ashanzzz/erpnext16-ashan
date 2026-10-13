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
from unittest.mock import patch
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

import ashan_cn_procurement.services.jizhong_payroll_service as payroll_service

from ashan_cn_procurement.services.jizhong_payroll_service import (
    JIZHONG_SALARY_MODE_FIXED_NET,
    JIZHONG_SALARY_MODE_DYNAMIC_GROSS,
    JIZHONG_SALARY_MODE_FIXED_GROSS,
    JIZHONG_SALARY_MODE_DYNAMIC_NET,
    normalize_jizhong_salary_mode,
    is_jizhong_fixed_net_salary_mode,
    is_jizhong_post_tax_salary_mode,
    is_jizhong_dynamic_salary_mode,
    get_jizhong_salary_mode_label,
    derive_jizhong_gross_from_net,
    _jizhong_statutory_exclusion_reason,
)
from ashan_cn_procurement.services.jizhong_attendance_service import (
    _is_jizhong_attendance_required,
)


class TestJizhongSalaryMode(unittest.TestCase):
    """测试吉众税后固定工资语义、别名兼容、考勤免除与实发净额不变式。"""

    def test_canonical_normalization(self):
        """测试规范化映射：标准模式保留，旧版别名无损兼容。"""
        self.assertEqual(normalize_jizhong_salary_mode("税后固定工资"), JIZHONG_SALARY_MODE_FIXED_NET)
        self.assertEqual(normalize_jizhong_salary_mode("税后管理工资"), JIZHONG_SALARY_MODE_FIXED_NET)
        self.assertEqual(normalize_jizhong_salary_mode("税前动态工资"), JIZHONG_SALARY_MODE_DYNAMIC_GROSS)
        self.assertEqual(normalize_jizhong_salary_mode(""), JIZHONG_SALARY_MODE_DYNAMIC_GROSS)
        self.assertEqual(normalize_jizhong_salary_mode(None), JIZHONG_SALARY_MODE_DYNAMIC_GROSS)

    def test_fixed_net_predicate(self):
        """测试税后固定薪资谓词判断：标准与历史别名均返回 True。"""
        self.assertTrue(is_jizhong_fixed_net_salary_mode("税后固定工资"))
        self.assertTrue(is_jizhong_fixed_net_salary_mode("税后管理工资"))
        self.assertFalse(is_jizhong_fixed_net_salary_mode("税前动态工资"))
        self.assertFalse(is_jizhong_fixed_net_salary_mode("计件工资"))
        self.assertFalse(is_jizhong_fixed_net_salary_mode(None))

    def test_user_facing_label_helper(self):
        """测试前端展示文案助手：历史记录在 UI 上统一呈现为‘税后固定工资’。"""
        self.assertEqual(get_jizhong_salary_mode_label("税后固定工资"), "税后固定工资")
        self.assertEqual(get_jizhong_salary_mode_label("税后管理工资"), "税后固定工资")
        self.assertEqual(get_jizhong_salary_mode_label("税前动态工资"), "税前动态工资")
        self.assertEqual(get_jizhong_salary_mode_label(""), "税前动态工资")
        self.assertEqual(get_jizhong_salary_mode_label(None), "税前动态工资")

    def test_attendance_exemption_for_canonical_and_legacy(self):
        """测试考勤免除判定：标准税后固定工资与历史税后管理工资均享受免打卡豁免。"""
        canonical_profile = {
            "employee_no": "JZ-TEST-001",
            "employee_name": "测试人员甲",
            "employee_type": "其他",
            "salary_mode": "税后固定工资",
            "base_salary": 0.0,
            "fixed_salary": 8000.0,
        }
        legacy_profile = {
            "employee_no": "JZ-TEST-002",
            "employee_name": "测试人员乙",
            "employee_type": "其他",
            "salary_mode": "税后管理工资",
            "base_salary": 0.0,
            "fixed_salary": 8000.0,
        }
        standard_dynamic_profile = {
            "employee_no": "JZ-TEST-003",
            "employee_name": "测试人员丙",
            "employee_type": "正式工",
            "salary_mode": "税前动态工资",
            "base_salary": 3500.0,
            "fixed_salary": 0.0,
        }

        # 固定税后免考勤：_is_jizhong_attendance_required 应返回 False
        self.assertFalse(_is_jizhong_attendance_required(canonical_profile))
        self.assertFalse(_is_jizhong_attendance_required(legacy_profile))

        # 普通车间动态工时：必须打卡上传考勤
        self.assertTrue(_is_jizhong_attendance_required(standard_dynamic_profile))

    def test_final_net_equality_invariant(self):
        """测试闭式反推不变式：最终实发净薪分毫不差严格等于目标设定金额（精确到分）。"""
        test_amounts = [
            3000.00,
            5000.00,
            6000.00,
            7500.50,
            8888.88,
            10000.00,
            12345.67,
            15000.00,
            20000.00,
            35000.00,
        ]

        for target_net in test_amounts:
            for special_ded in [0.0, 500.0, 1024.50]:
                for add_ded in [0.0, 1000.0, 2000.0]:
                    res = derive_jizhong_gross_from_net(
                        target_net=target_net,
                        special_deductions_cur=special_ded,
                        tax_threshold=5000.0,
                        cur_additional_ded=add_ded,
                    )
                    gross = res["gross_salary"]
                    tax = res["tax_amount"]
                    final_net = round(gross - special_ded - tax, 2)

                    # 核心不变式校验：推导出的最终净薪必须 100% 精确等于设定的固定净薪
                    self.assertEqual(
                        final_net,
                        round(target_net, 2),
                        f"净薪不变式违背：target={target_net}, gross={gross}, tax={tax}, net={final_net}"
                    )
                    self.assertEqual(res["net_salary"], round(target_net, 2))

    def test_social_security_and_housing_fund_eligibility_are_independent(self):
        """One statutory contribution must not implicitly control the other."""

        class Policy(dict):
            __getattr__ = dict.get

        social_only = Policy(
            participate_social_security=1,
            participate_housing_fund=0,
            is_active=1,
            insurance_rule_description="",
        )
        with patch.object(
            payroll_service.frappe.db, "exists", return_value=True, create=True
        ), patch.object(
            payroll_service.frappe.db,
            "get_value",
            return_value=social_only,
            create=True,
        ):
            self.assertEqual(
                _jizhong_statutory_exclusion_reason("正式工", "social_security"),
                "",
            )
            self.assertEqual(
                _jizhong_statutory_exclusion_reason("正式工", "housing_fund"),
                "正式工不参加住房公积金",
            )

        housing_only = Policy(
            participate_social_security=0,
            participate_housing_fund=1,
            is_active=1,
            insurance_rule_description="",
        )
        with patch.object(
            payroll_service.frappe.db, "exists", return_value=True, create=True
        ), patch.object(
            payroll_service.frappe.db,
            "get_value",
            return_value=housing_only,
            create=True,
        ):
            self.assertEqual(
                _jizhong_statutory_exclusion_reason("正式工", "social_security"),
                "正式工不参加社会保险",
            )
            self.assertEqual(
                _jizhong_statutory_exclusion_reason("正式工", "housing_fund"),
                "",
            )


if __name__ == "__main__":
    unittest.main()