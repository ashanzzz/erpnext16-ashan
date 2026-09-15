try:
    import frappe
except ImportError:
    frappe = None

import math

class AshanPayrollCalculator:
    """
    Ashan 核心薪酬核算与个税累计预扣法引擎
    """

    # 国家法定综合所得个人所得税税率表 (年度累计级距)
    TAX_BRACKETS = [
        {"max": 36000, "rate": 0.03, "quick_deduction": 0},
        {"max": 144000, "rate": 0.10, "quick_deduction": 2520},
        {"max": 300000, "rate": 0.20, "quick_deduction": 16920},
        {"max": 420000, "rate": 0.25, "quick_deduction": 31920},
        {"max": 660000, "rate": 0.30, "quick_deduction": 52920},
        {"max": 960000, "rate": 0.35, "quick_deduction": 85920},
        {"max": float('inf'), "rate": 0.45, "quick_deduction": 181920},
    ]

    @staticmethod
    def calculate_cumulative_tax(taxable_income: float) -> float:
        """
        依据累计应纳税所得额计算累计应纳税额
        """
        if taxable_income <= 0:
            return 0.0
        for b in AshanPayrollCalculator.TAX_BRACKETS:
            if taxable_income <= b["max"]:
                tax = taxable_income * b["rate"] - b["quick_deduction"]
                return round(max(0.0, tax), 2)
        return 0.0

    @staticmethod
    def calculate_social_insurance(base: float, is_insured: bool = True):
        """
        计算五险一金标准 (以天津标准为基准，支持配置)
        个人部分:
          - 养老: 8%
          - 医疗: 2%
          - 失业: 0.5%
          - 大额医疗: 固定 21 元
        企业部分:
          - 养老: 16%
          - 医疗: 10%
          - 生育: 0.5%
          - 失业: 0.5%
          - 工伤: 0.55%
        """
        if not is_insured or base <= 0:
            return {
                "base": 0.0,
                "pension_p": 0.0, "medical_p": 0.0, "unemployment_p": 0.0, "large_medical_p": 0.0, "total_p": 0.0,
                "pension_c": 0.0, "medical_c": 0.0, "maternity_c": 0.0, "unemployment_c": 0.0, "work_injury_c": 0.0, "total_c": 0.0,
                "total_cost": 0.0
            }

        pension_p = round(base * 0.08, 2)
        medical_p = round(base * 0.02, 2)
        unemployment_p = round(base * 0.005, 2)
        large_medical_p = 21.0
        total_p = round(pension_p + medical_p + unemployment_p + large_medical_p, 2)

        pension_c = round(base * 0.16, 2)
        medical_c = round(base * 0.10, 2)
        maternity_c = round(base * 0.005, 2)
        unemployment_c = round(base * 0.005, 2)
        work_injury_c = round(base * 0.0055, 2)
        total_c = round(pension_c + medical_c + maternity_c + unemployment_c + work_injury_c, 2)

        return {
            "base": base,
            "pension_p": pension_p,
            "medical_p": medical_p,
            "unemployment_p": unemployment_p,
            "large_medical_p": large_medical_p,
            "total_p": total_p,
            "pension_c": pension_c,
            "medical_c": medical_c,
            "maternity_c": maternity_c,
            "unemployment_c": unemployment_c,
            "work_injury_c": work_injury_c,
            "total_c": total_c,
            "total_cost": round(total_p + total_c, 2)
        }

    @staticmethod
    def calculate_housing_fund(base: float, rate: float = 0.05, is_insured: bool = True):
        """
        住房公积金 (个人 5% + 企业 5%)
        """
        if not is_insured or base <= 0:
            return {"base": 0.0, "fund_p": 0.0, "fund_c": 0.0, "total": 0.0}

        fund_p = round(base * rate, 2)
        fund_c = round(base * rate, 2)
        return {
            "base": base,
            "fund_p": fund_p,
            "fund_c": fund_c,
            "total": round(fund_p + fund_c, 2)
        }

    @staticmethod
    def break_down_cash_bills(amount: float) -> dict:
        """
        现金发放零钞配钞算法 (拆解 100/50/20/10/5/1 元钞票张数)
        """
        val = int(round(amount))
        b100 = val // 100
        val %= 100
        b50 = val // 50
        val %= 50
        b20 = val // 20
        val %= 20
        b10 = val // 10
        val %= 10
        b5 = val // 5
        val %= 5
        b1 = val

        return {
            "b100": b100,
            "b50": b50,
            "b20": b20,
            "b10": b10,
            "b5": b5,
            "b1": b1
        }

    @classmethod
    def calculate_employee_payroll(
        cls,
        salary_profile: dict,
        attendance: dict,
        full_work_days: float = 21.0,
        full_work_hours: float = 168.0,
        fixed_work_hours: float = 172.0,
        cum_history: dict = None
    ) -> dict:
        """
        单员工月度薪酬核算主函数 (支持正算与税后反推双模式)
        """
        cum_history = cum_history or {
            "cum_gross_prior": 0.0,
            "cum_tax_exemption_prior": 0.0,
            "cum_special_deduction_prior": 0.0,
            "cum_additional_deduction_prior": 0.0,
            "cum_tax_paid_prior": 0.0,
            "month_count_prior": 0
        }

        salary_mode = salary_profile.get("salary_mode", "税前动态工资")
        base_salary = float(salary_profile.get("base_salary", 0.0))
        base_subsidy = float(salary_profile.get("base_subsidy", 0.0))
        perf_bonus_base = float(salary_profile.get("performance_bonus_base", 0.0))
        pos_allowance = float(salary_profile.get("position_allowance", 0.0))
        meal_unit_price = float(salary_profile.get("meal_unit_price", 15.0))
        ss_base = float(salary_profile.get("social_security_base", 5124.0))
        hf_base = float(salary_profile.get("housing_fund_base", 2520.0))
        is_insured = bool(salary_profile.get("is_insured", True))
        add_deduct_monthly = float(salary_profile.get("special_additional_deduction", 0.0))
        tax_exemption_monthly = float(salary_profile.get("tax_exemption_monthly", 5000.0))
        fixed_net_salary = float(salary_profile.get("fixed_net_salary", 0.0))

        # 考勤与津贴参数 (支持吉众与祺富双模)
        att_days = float(attendance.get("attendance_days", full_work_days))
        work_hours = float(attendance.get("work_hours_regular", full_work_hours))
        ot_1_5 = float(attendance.get("overtime_regular_1_5", 0.0))
        ot_2_0 = float(attendance.get("overtime_weekend_2_0", 0.0))
        ot_3_0 = float(attendance.get("overtime_holiday_3_0", 0.0))
        meal_count = int(attendance.get("meal_count", 0))
        sal_adjust = float(attendance.get("salary_adjustment", 0.0))

        # 祺富专属字段
        sal_full_att = float(attendance.get("salary_full_attendance", 0.0))
        sal_target_perf = float(attendance.get("salary_performance_target", 0.0))
        sal_house_car = float(attendance.get("salary_housing_car_subsidy", 0.0))
        sal_piecework = float(attendance.get("salary_piecework_daily", 0.0))

        # 1. 计算五险一金
        ss_info = cls.calculate_social_insurance(ss_base, is_insured)
        hf_info = cls.calculate_housing_fund(hf_base, 0.05, is_insured)
        special_deduct_p = round(ss_info["total_p"] + hf_info["fund_p"], 2)

        # 累计基数 (加上本月)
        cur_tax_exemption = tax_exemption_monthly
        cur_special_deduct = special_deduct_p
        cur_add_deduct = add_deduct_monthly

        total_tax_exemption = cum_history["cum_tax_exemption_prior"] + cur_tax_exemption
        total_special_deduct = cum_history["cum_special_deduction_prior"] + cur_special_deduct
        total_add_deduct = cum_history["cum_additional_deduction_prior"] + cur_add_deduct
        cum_tax_paid_prior = cum_history["cum_tax_paid_prior"]
        cum_gross_prior = cum_history["cum_gross_prior"]

        if salary_mode == "税后管理工资" and fixed_net_salary > 0:
            # ================= 模式 ②: 税后管理工资 (反推 Gross-up) =================
            # 目标: 实发 Net = fixed_net_salary
            # Gross - special_deduct_p - Tax = fixed_net_salary
            # => Gross - Tax = fixed_net_salary + special_deduct_p
            target_after_tax = fixed_net_salary + special_deduct_p

            # 求解 Gross
            gross_pay = 0.0
            tax_due = 0.0
            # 寻找所在税率区间
            # 累计应税所得 Y = cum_gross_prior + Gross - total_tax_exemption - total_special_deduct - total_add_deduct
            # 累计 Tax = Y * r - q
            # 当月 Tax = 累计 Tax - cum_tax_paid_prior
            # Gross - (cum_gross_prior + Gross - E) * r + q + cum_tax_paid_prior = target_after_tax
            # Gross * (1 - r) = target_after_tax + (cum_gross_prior - E)*r - q - cum_tax_paid_prior
            E = total_tax_exemption + total_special_deduct + total_add_deduct

            found = False
            for b in cls.TAX_BRACKETS:
                r = b["rate"]
                q = b["quick_deduction"]

                # 假设在当前级距
                numerator = target_after_tax + (cum_gross_prior - E) * r - q - cum_tax_paid_prior
                denom = (1.0 - r)
                g_candidate = numerator / denom
                y_candidate = cum_gross_prior + g_candidate - E

                if y_candidate <= b["max"] or b["max"] == float('inf'):
                    # 校验是否落在本级距
                    gross_pay = round(g_candidate, 2)
                    cum_gross = cum_gross_prior + gross_pay
                    cum_taxable = max(0.0, cum_gross - E)
                    cum_tax = cls.calculate_cumulative_tax(cum_taxable)
                    tax_due = max(0.0, round(cum_tax - cum_tax_paid_prior, 2))
                    found = True
                    break

            if not found:
                gross_pay = fixed_net_salary + special_deduct_p
                tax_due = 0.0

            # 各分项拆解展示
            sal_regular = base_salary
            sal_ot_1_5 = round((base_salary / fixed_work_hours) * ot_1_5 * 1.5, 2) if ot_1_5 else 0.0
            sal_ot_2_0 = round((base_salary / fixed_work_hours) * ot_2_0 * 2.0, 2) if ot_2_0 else 0.0
            sal_ot_3_0 = round((base_salary / fixed_work_hours) * ot_3_0 * 3.0, 2) if ot_3_0 else 0.0
            sal_subsidy = base_subsidy
            sal_perf = perf_bonus_base
            sal_pos = pos_allowance
            sal_meal = round(meal_unit_price * meal_count, 2)

            net_pay = fixed_net_salary

        else:
            # ================= 模式 ①: 税前动态工资 (正算) =================
            if sal_piecework > 0:
                # 祺富天工资模式
                sal_regular = sal_piecework
            else:
                ratio = work_hours / full_work_hours if full_work_hours > 0 else 1.0
                sal_regular = round(base_salary * ratio, 2)

            sal_subsidy = round(base_subsidy * (work_hours / full_work_hours if full_work_hours > 0 else 1.0), 2)
            sal_pos = round(pos_allowance * (work_hours / full_work_hours if full_work_hours > 0 else 1.0), 2)

            # 加班费
            if ot_1_5 > 0 and fixed_work_hours > 0:
                hourly_base = (base_salary / fixed_work_hours) if base_salary > 0 else 15.0
                sal_ot_1_5 = round(hourly_base * ot_1_5 * 1.5, 2)
            else:
                sal_ot_1_5 = 0.0

            if ot_2_0 > 0 and fixed_work_hours > 0:
                hourly_base = (base_salary / fixed_work_hours) if base_salary > 0 else 15.0
                sal_ot_2_0 = round(hourly_base * ot_2_0 * 2.0, 2)
            else:
                sal_ot_2_0 = 0.0

            if ot_3_0 > 0 and fixed_work_hours > 0:
                hourly_base = (base_salary / fixed_work_hours) if base_salary > 0 else 15.0
                sal_ot_3_0 = round(hourly_base * ot_3_0 * 3.0, 2)
            else:
                sal_ot_3_0 = 0.0

            sal_perf = perf_bonus_base
            sal_meal = round(meal_unit_price * meal_count, 2)

            gross_pay = round(
                sal_regular + sal_ot_1_5 + sal_ot_2_0 + sal_ot_3_0 +
                sal_subsidy + sal_perf + sal_pos + sal_meal +
                sal_full_att + sal_target_perf + sal_house_car + sal_adjust,
                2
            )

            # 累计预扣法个税
            cum_gross = cum_gross_prior + gross_pay
            E = total_tax_exemption + total_special_deduct + total_add_deduct
            cum_taxable = max(0.0, cum_gross - E)
            cum_tax = cls.calculate_cumulative_tax(cum_taxable)
            tax_due = max(0.0, round(cum_tax - cum_tax_paid_prior, 2))

            net_pay = round(gross_pay - special_deduct_p - tax_due, 2)

        # 零钞配钞
        bills = cls.break_down_cash_bills(net_pay)

        return {
            "employee_no": salary_profile.get("employee_no"),
            "employee_name": salary_profile.get("employee_name"),
            "salary_mode": salary_mode,
            "base_salary": base_salary,
            "attendance_days": att_days,
            "work_hours_regular": work_hours,
            "overtime_1_5": ot_1_5,
            "overtime_2_0": ot_2_0,
            "overtime_3_0": ot_3_0,
            "salary_regular_hours": sal_regular,
            "salary_overtime_1_5": sal_ot_1_5,
            "salary_overtime_2_0": sal_ot_2_0,
            "salary_overtime_3_0": sal_ot_3_0,
            "salary_base_subsidy": sal_subsidy,
            "salary_performance": sal_perf,
            "salary_position_allowance": sal_pos,
            "salary_meal_subsidy": sal_meal,
            "salary_full_attendance": sal_full_att,
            "salary_performance_target": sal_target_perf,
            "salary_housing_car_subsidy": sal_house_car,
            "salary_piecework_daily": sal_piecework,
            "salary_adjustment": sal_adjust,
            "gross_pay": gross_pay,

            # 五险一金
            "social_security_base": ss_base,
            "ss_pension_p": ss_info["pension_p"],
            "ss_medical_p": ss_info["medical_p"],
            "ss_unemployment_p": ss_info["unemployment_p"],
            "ss_large_medical_p": ss_info["large_medical_p"],
            "social_security_p": ss_info["total_p"],
            "social_security_c": ss_info["total_c"],

            "housing_fund_base": hf_base,
            "housing_fund_p": hf_info["fund_p"],
            "housing_fund_c": hf_info["fund_c"],
            "special_deduction_total": special_deduct_p,
            "special_additional_deduction": add_deduct_monthly,

            # 个税累计
            "cum_gross_income": round(cum_gross_prior + gross_pay, 2),
            "cum_tax_exemption": round(total_tax_exemption, 2),
            "cum_special_deduction": round(total_special_deduct, 2),
            "cum_additional_deduction": round(total_add_deduct, 2),
            "cum_taxable_income": round(max(0.0, cum_gross_prior + gross_pay - (total_tax_exemption + total_special_deduct + total_add_deduct)), 2),
            "cum_tax_due": round(cls.calculate_cumulative_tax(max(0.0, cum_gross_prior + gross_pay - (total_tax_exemption + total_special_deduct + total_add_deduct))), 2),
            "cum_tax_paid_prior": round(cum_tax_paid_prior, 2),
            "individual_tax": tax_due,

            # 实发与配钞
            "net_pay": net_pay,
            "cash_pay": net_pay,
            "bill_100": bills["b100"],
            "bill_50": bills["b50"],
            "bill_20": bills["b20"],
            "bill_10": bills["b10"],
            "bill_5": bills["b5"],
            "bill_1": bills["b1"],
            "company_cost_total": round(gross_pay + ss_info["total_c"] + hf_info["fund_c"], 2)
        }
