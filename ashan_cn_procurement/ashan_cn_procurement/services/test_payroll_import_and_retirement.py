import unittest

from ashan_cn_procurement.services.payroll_excel_import_service import (
    build_main_column_map,
    detect_schema_version,
)
from ashan_cn_procurement.services.retirement_policy_service import (
    CATEGORY_FEMALE_50,
    CATEGORY_FEMALE_55,
    CATEGORY_MALE_60,
    calculate_retirement_details,
    minimum_pension_contribution_months,
)


class TestPayrollImportSchemaCompatibility(unittest.TestCase):
    def test_legacy_headers_do_not_overwrite_work_hours(self):
        headers = [
            "编号", "入职日期", "本月日期", "入职时间", "姓名",
            "作业天数", "作业小时", "天工资", "小时工资", "全勤费",
            "加班", "国勤(天）", "国勤", "抛光", "达标率",
            "达标工资", "加班/抛光", "扣除", "应付工资", "已发工资",
            "实发工资", "签字", "备考", "100", "50", "10", "5", "1",
        ]
        col_map, _, _ = build_main_column_map(headers)
        self.assertEqual(col_map["work_days"], 6)
        self.assertEqual(col_map["work_hours"], 7)
        self.assertEqual(col_map["hour_salary"], 9)
        self.assertEqual(col_map["overtime_hours"], 11)
        self.assertEqual(col_map["national_days"], 12)
        self.assertEqual(col_map["national_salary"], 13)
        self.assertEqual(col_map["overtime_salary"], 17)
        self.assertEqual(detect_schema_version(col_map), "legacy-2023-2024")
        # Cash-note columns are source audit data only. They must not become
        # standardized payroll business fields. Tab 6 generates them from final net pay.
        self.assertNotIn("cash_100", col_map)
        self.assertNotIn("cash_50", col_map)
        self.assertNotIn("cash_10", col_map)
        self.assertNotIn("cash_5", col_map)
        self.assertNotIn("cash_1", col_map)

    def test_modern_headers_keep_hour_salary_and_overtime_separate(self):
        headers = [
            "编号", "姓名", "作业天数", "作业小时", "天工资", "小时工资",
            "全勤费", "加班小时", "加班费", "国勤天数", "国勤工资",
            "达标率", "达标工资", "是否社保", "扣除", "实发工资",
            "签字", "备考", "100", "50", "10", "5", "1",
        ]
        col_map, _, _ = build_main_column_map(headers)
        self.assertEqual(col_map["work_hours"], 4)
        self.assertEqual(col_map["hour_salary"], 6)
        self.assertEqual(col_map["overtime_hours"], 8)
        self.assertEqual(col_map["overtime_salary"], 9)
        self.assertEqual(detect_schema_version(col_map), "modern-2026")


class TestChinaRetirementPolicy(unittest.TestCase):
    def _calc(self, birth_date, gender, category, ref="2025-01"):
        return calculate_retirement_details(
            certificate_type="护照",
            birth_date=birth_date,
            gender=gender,
            retirement_category=category,
            ref_period_month=ref,
        )

    def test_first_reform_cohorts_match_official_tables(self):
        male = self._calc("1965-01-15", "男", CATEGORY_MALE_60)
        female55 = self._calc("1970-01-15", "女", CATEGORY_FEMALE_55)
        female50 = self._calc("1975-01-15", "女", CATEGORY_FEMALE_50)
        self.assertEqual(male["delayed_retire_period"], "2025-02")
        self.assertEqual(female55["delayed_retire_period"], "2025-02")
        self.assertEqual(female50["delayed_retire_period"], "2025-02")

    def test_flexible_early_is_not_always_original_age(self):
        result = self._calc("1985-01-15", "女", CATEGORY_FEMALE_50, "2039-12")
        self.assertEqual(result["delayed_retirement_age_str"], "55岁")
        self.assertEqual(result["earliest_flexible_retire_period"], "2037-01")
        self.assertEqual(result["earliest_flexible_minimum_contribution_str"], "19年")

    def test_minimum_contribution_threshold(self):
        self.assertEqual(minimum_pension_contribution_months("2029-12"), 180)
        self.assertEqual(minimum_pension_contribution_months("2030-01"), 186)
        self.assertEqual(minimum_pension_contribution_months("2039-01"), 240)
        self.assertEqual(minimum_pension_contribution_months("2045-01"), 240)


if __name__ == "__main__":
    unittest.main()
