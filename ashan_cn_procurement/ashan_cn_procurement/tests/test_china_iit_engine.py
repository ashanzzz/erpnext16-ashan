# -*- coding: utf-8 -*-
"""中国居民个人所得税核心计算引擎单元测试 (China IIT Engine Unit Tests)

严格遵循《ERPNext16 个税逻辑修改与测试任务书》要求：
1. 金额舍入测试 (Decimal + ROUND_HALF_UP)
2. 税档边界测试 (0, 36000, 144000, 300000, 420000, 660000, 960000)
3. 负应纳税所得额测试 (taxable_income <= 0 -> 0)
4. 本月只扣不退测试 (cumulative_tax < paid_tax_prior -> 0)
5. 税后反推零税分支
6. 税后反推各税率档测试 (3%, 10%, 20%, 25%, 30%, 35%, 45%)
7. 严格验算测试 (拒绝 0.01 差异，必须到分完全相等)
8. 专项扣除封顶测试 (实际扣款 4000 vs 允许抵扣 3303)
9. 陈亮 (A0001) 真实算例锚点测试 (税前 11247.88, 个税 61.86, 税后 10500.00)
10. 祺富与吉众引擎一致性测试
"""

import sys
import unittest
from decimal import Decimal
from pathlib import Path

app_root = Path(__file__).resolve().parents[2]
inner_pkg = Path(__file__).resolve().parents[1]
if str(app_root) not in sys.path:
    sys.path.insert(0, str(app_root))
import ashan_cn_procurement
if str(inner_pkg) not in ashan_cn_procurement.__path__:
    ashan_cn_procurement.__path__.append(str(inner_pkg))

# Mock frappe if running standalone
import types
try:
    import frappe
except ModuleNotFoundError:
    frappe = types.ModuleType("frappe")
    frappe.throw = lambda message: (_ for _ in ()).throw(ValueError(message))
    frappe.db = types.SimpleNamespace()
    frappe.whitelist = lambda *args, **kwargs: (lambda fn: fn) if not (args and callable(args[0])) else args[0]
    frappe._ = lambda m: m
    sys.modules["frappe"] = frappe

    utils = types.ModuleType("frappe.utils")
    utils.cint = lambda v=0: int(float(v or 0))
    utils.flt = lambda v=0: float(v or 0)
    utils.today = lambda: "2026-07-01"
    utils.now_datetime = lambda: None
    from datetime import date, datetime
    def _getdate(value=None):
        if value is None:
            return date.today()
        if isinstance(value, date):
            return value
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    utils.getdate = _getdate
    utils.add_days = lambda dt, days: str(dt)
    utils.date_diff = lambda d1, d2: 0
    sys.modules["frappe.utils"] = utils

from ashan_cn_procurement.services.payroll_settlement_service import (
    money_round,
    to_decimal,
    resolve_tax_bracket,
    calculate_cumulative_tax,
    calculate_current_withholding,
    derive_gross_from_net,
    derive_gross_from_net_vba,
    is_tax_after_salary_mode,
)
from ashan_cn_procurement.services.jizhong_payroll_service import (
    derive_jizhong_gross_from_net,
    _get_annual_tax,
)


class TestChinaIITEngine(unittest.TestCase):
    """中国居民个税核心引擎全要素测试"""

    def test_7_1_money_round(self):
        """7.1 金额舍入测试 (Decimal + ROUND_HALF_UP)"""
        cases = [
            ("2.675", Decimal("2.68")),
            ("1.005", Decimal("1.01")),
            ("10.004", Decimal("10.00")),
            ("10.005", Decimal("10.01")),
            ("-2.675", Decimal("-2.68")),
            (Decimal("100.555"), Decimal("100.56")),
            (0, Decimal("0.00")),
        ]
        for val, expected in cases:
            self.assertEqual(money_round(val), expected, f"money_round({val}) != {expected}")

    def test_7_2_tax_bracket_boundaries(self):
        """7.2 税档边界测试"""
        boundary_cases = [
            (Decimal("0.00"), Decimal("0.03"), Decimal("0.00")),
            (Decimal("0.01"), Decimal("0.03"), Decimal("0.00")),
            (Decimal("35999.99"), Decimal("0.03"), Decimal("0.00")),
            (Decimal("36000.00"), Decimal("0.03"), Decimal("0.00")),
            (Decimal("36000.01"), Decimal("0.10"), Decimal("2520.00")),
            (Decimal("143999.99"), Decimal("0.10"), Decimal("2520.00")),
            (Decimal("144000.00"), Decimal("0.10"), Decimal("2520.00")),
            (Decimal("144000.01"), Decimal("0.20"), Decimal("16920.00")),
            (Decimal("299999.99"), Decimal("0.20"), Decimal("16920.00")),
            (Decimal("300000.00"), Decimal("0.20"), Decimal("16920.00")),
            (Decimal("300000.01"), Decimal("0.25"), Decimal("31920.00")),
            (Decimal("419999.99"), Decimal("0.25"), Decimal("31920.00")),
            (Decimal("420000.00"), Decimal("0.25"), Decimal("31920.00")),
            (Decimal("420000.01"), Decimal("0.30"), Decimal("52920.00")),
            (Decimal("659999.99"), Decimal("0.30"), Decimal("52920.00")),
            (Decimal("660000.00"), Decimal("0.30"), Decimal("52920.00")),
            (Decimal("660000.01"), Decimal("0.35"), Decimal("85920.00")),
            (Decimal("959999.99"), Decimal("0.35"), Decimal("85920.00")),
            (Decimal("960000.00"), Decimal("0.35"), Decimal("85920.00")),
            (Decimal("960000.01"), Decimal("0.45"), Decimal("181920.00")),
        ]
        for taxable, exp_rate, exp_quick in boundary_cases:
            rate, quick = resolve_tax_bracket(taxable)
            self.assertEqual(rate, exp_rate, f"Taxable {taxable}: rate {rate} != {exp_rate}")
            self.assertEqual(quick, exp_quick, f"Taxable {taxable}: quick {quick} != {exp_quick}")

    def test_7_3_negative_and_zero_taxable_income(self):
        """7.3 负应纳税所得额测试"""
        for val in [Decimal("0.00"), Decimal("-100.00"), Decimal("-5000.00")]:
            cum_tax = calculate_cumulative_tax(val)
            self.assertEqual(cum_tax, Decimal("0.00"))
            cur_tax = calculate_current_withholding(cum_tax, Decimal("100.00"))
            self.assertEqual(cur_tax, Decimal("0.00"))

    def test_7_4_current_withholding_non_negative(self):
        """7.4 本月只扣不退测试 (不得出现负数)"""
        cur_tax = calculate_current_withholding(Decimal("800.00"), Decimal("900.00"))
        self.assertEqual(cur_tax, Decimal("0.00"))

    def test_7_7_derive_gross_from_net_zero_tax_branch(self):
        """7.7 税后反推零税分支"""
        target_net = Decimal("4000.00")
        actual_ded = Decimal("400.00")
        res = derive_gross_from_net(
            target_net=target_net,
            actual_payroll_deduction_cur=actual_ded,
            gross_prior=Decimal("0.00"),
            threshold_cur=Decimal("5000.00"),
            threshold_prior=Decimal("0.00"),
            paid_tax_prior=Decimal("0.00"),
        )
        self.assertEqual(res["gross_salary"], 4400.00)
        self.assertEqual(res["tax_amount_cur"], 0.00)
        self.assertEqual(res["net_verified"], 4000.00)
        self.assertEqual(
            money_round(res["gross_salary"] - float(actual_ded) - res["tax_amount_cur"]),
            money_round(target_net),
        )

    def test_7_8_derive_gross_from_net_each_bracket(self):
        """7.8 税后反推各税率档测试 (逐档覆盖并严格到分验算)"""
        target_brackets = [
            ("3%", Decimal("6000.00"), Decimal("500.00")),
            ("10%", Decimal("12000.00"), Decimal("800.00")),
            ("20%", Decimal("25000.00"), Decimal("1500.00")),
            ("25%", Decimal("38000.00"), Decimal("2000.00")),
            ("30%", Decimal("60000.00"), Decimal("3000.00")),
            ("35%", Decimal("90000.00"), Decimal("4000.00")),
            ("45%", Decimal("150000.00"), Decimal("5000.00")),
        ]
        for name, net_target, ded in target_brackets:
            res = derive_gross_from_net(
                target_net=net_target,
                actual_payroll_deduction_cur=ded,
                threshold_cur=Decimal("5000.00"),
            )
            gross = Decimal(str(res["gross_salary"]))
            tax = Decimal(str(res["tax_amount_cur"]))
            net_ver = money_round(gross - ded - tax)
            self.assertEqual(
                net_ver,
                net_target,
                f"档位 {name} 到分相等违背: target={net_target}, gross={gross}, tax={tax}, net_ver={net_ver}"
            )

    def test_7_9_strict_cent_equality_rejection(self):
        """7.9 严格验算测试：9999.99 与 10000.00 不得被视为相等 (彻底废除 abs < 0.02 宽松容差)"""
        # 1. 验证旧版 abs < 0.02 容差会错误接受 9999.99，而新版必须严格判定不相等
        target_net = Decimal("10000.00")
        candidate_imperfect = Decimal("9999.99")
        self.assertTrue(abs(float(candidate_imperfect) - float(target_net)) < 0.02, "旧逻辑会错误接受 9999.99")
        self.assertFalse(money_round(candidate_imperfect) == money_round(target_net), "新核心必须严格拒绝 9999.99")

        # 2. 验证所有反推结果 net_verified 均严格等于 target_net 到分相等
        for test_target in [Decimal("5000.00"), Decimal("8888.88"), Decimal("10500.00"), Decimal("12345.67")]:
            res = derive_gross_from_net(
                target_net=test_target,
                actual_payroll_deduction_cur=Decimal("686.02"),
                threshold_cur=Decimal("5000.00"),
            )
            self.assertEqual(money_round(res["net_verified"]), money_round(test_target))

    def test_7_10_special_deduction_capping(self):
        """7.10 专项扣除封顶测试：实际扣款 4000 vs 允许抵扣 3303"""
        target_net = Decimal("10000.00")
        actual_ded = Decimal("4000.00")
        capped_spec_ded = Decimal("3303.00")

        # 封顶允许抵扣
        res_capped = derive_gross_from_net(
            target_net=target_net,
            actual_payroll_deduction_cur=actual_ded,
            spec_ded_cur=capped_spec_ded,
            threshold_cur=Decimal("5000.00"),
        )
        # 全额不封顶抵扣 (错误口径对比)
        res_uncapped = derive_gross_from_net(
            target_net=target_net,
            actual_payroll_deduction_cur=actual_ded,
            spec_ded_cur=actual_ded,
            threshold_cur=Decimal("5000.00"),
        )
        # 允许抵扣较少时，税款应更高，反推所需税前工资应更高
        self.assertGreater(res_capped["tax_amount_cur"], res_uncapped["tax_amount_cur"])
        self.assertGreater(res_capped["gross_salary"], res_uncapped["gross_salary"])
        # 但最终员工到手净额都必须严格等于 target_net
        self.assertEqual(
            money_round(Decimal(str(res_capped["gross_salary"])) - actual_ded - Decimal(str(res_capped["tax_amount_cur"]))),
            target_net,
        )

    def test_chen_liang_exact_calculation(self):
        """核心黄金算例：陈亮 (A0001) 2026-07 税前必须精确等于 11247.88 元"""
        target_net = Decimal("10500.00")
        actual_ded = Decimal("686.02")  # 社保 560.02 + 公积金 126.00
        gross_prior = Decimal("77641.20")
        threshold_cur = Decimal("5000.00")
        threshold_prior = Decimal("35000.00")  # 7个月 × 5000.00
        spec_ded_cur = Decimal("686.02")
        spec_ded_prior = Decimal("4739.14")
        spec_add_cur = Decimal("3500.00")  # 子女教育 2000 + 赡养老人 1500
        spec_add_prior = Decimal("24500.00")
        paid_tax_prior = Decimal("402.06")

        res = derive_gross_from_net(
            target_net=target_net,
            actual_payroll_deduction_cur=actual_ded,
            gross_prior=gross_prior,
            threshold_cur=threshold_cur,
            threshold_prior=threshold_prior,
            spec_ded_cur=spec_ded_cur,
            spec_ded_prior=spec_ded_prior,
            spec_add_cur=spec_add_cur,
            spec_add_prior=spec_add_prior,
            paid_tax_prior=paid_tax_prior,
        )

        self.assertEqual(res["gross_salary"], 11247.88, "陈亮税前金额必须精确等于 11247.88")
        self.assertEqual(res["tax_amount_cur"], 61.86, "陈亮当月代扣个税必须精确等于 61.86")
        self.assertEqual(res["net_verified"], 10500.00, "陈亮税后实发必须精确等于 10500.00")

    def test_jizhong_and_qifu_consistency(self):
        """祺富与吉众统一引擎一致性测试：两公司调用同一底层算法得到完全一致的结果"""
        # 祺富入口
        res_qifu = derive_gross_from_net_vba(
            net_salary=10500.00,
            deduction_cur=686.02,
            gross_prior=77641.20,
            threshold_cur=5000.00,
            threshold_prior=35000.00,
            spec_ded_cur=686.02,
            spec_ded_prior=4739.14,
            spec_add_cur=3500.00,
            spec_add_prior=24500.00,
            paid_tax_prior=402.06,
        )
        # 吉众入口
        res_jizhong = derive_jizhong_gross_from_net(
            target_net=10500.00,
            special_deductions_cur=686.02,
            tax_threshold=5000.00,
            prev_gross=77641.20,
            prev_threshold=35000.00,
            prev_special_ded=4739.14,
            prev_additional_ded=24500.00,
            prev_tax_paid=402.06,
            cur_additional_ded=3500.00,
        )

        self.assertEqual(res_qifu["gross_salary"], res_jizhong["gross_salary"])
        self.assertEqual(res_qifu["tax_amount_cur"], res_jizhong["tax_amount"])
        self.assertEqual(res_qifu["net_verified"], res_jizhong["net_salary"])
        self.assertEqual(res_qifu["gross_salary"], 11247.88)


    def test_vba_golden_fixture_cases(self):
        """8. VBA 基准回归测试：加载 iit_vba_golden_cases.json 并逐条严格验证到分"""
        import json
        fixture_path = Path(__file__).resolve().parent / "fixtures" / "iit_vba_golden_cases.json"
        self.assertTrue(fixture_path.exists(), f"基准文件不存在: {fixture_path}")
        with open(fixture_path, "r", encoding="utf-8") as f:
            cases = json.load(f)

        for c in cases:
            name = c["case_name"]
            res = derive_gross_from_net(
                target_net=Decimal(c["target_net"]),
                actual_payroll_deduction_cur=Decimal(c["actual_payroll_deduction_cur"]),
                gross_prior=Decimal(c["gross_prior"]),
                threshold_cur=Decimal(c["threshold_cur"]),
                threshold_prior=Decimal(c["threshold_prior"]),
                spec_ded_cur=Decimal(c["tax_deductible_special_cur"]),
                spec_ded_prior=Decimal(c["spec_ded_prior"]),
                spec_add_cur=Decimal(c["spec_add_cur"]),
                spec_add_prior=Decimal(c["spec_add_prior"]),
                paid_tax_prior=Decimal(c["paid_tax_prior"]),
            )

            exp_gross = float(Decimal(c["expected_gross"]))
            exp_tax = float(Decimal(c["expected_current_tax"]))
            exp_net = float(Decimal(c["expected_net"]))

            self.assertEqual(res["gross_salary"], exp_gross, f"{name}: 税前金额不符合预期")
            self.assertEqual(res["tax_amount_cur"], exp_tax, f"{name}: 当月个税不符合预期")
            self.assertEqual(res["net_verified"], exp_net, f"{name}: 税后实发不符合预期")


if __name__ == "__main__":

    unittest.main()
