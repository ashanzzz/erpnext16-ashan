# Copyright (c) 2026, Ashan CN Procurement

import frappe
from frappe.model.document import Document


class AshanHousingFundMonthlyOverride(Document):
    def validate(self):
        from ashan_cn_procurement.services.housing_fund_policy_service import (
            VALID_OVERRIDES,
            normalize_period_month,
            _assert_period_open,
        )

        self.period_month = normalize_period_month(self.period_month)[0]
        self.employee_no = str(self.employee_no or "").strip()
        self.override_mode = str(self.override_mode or "").strip()
        self.reason = str(self.reason or "").strip()
        _assert_period_open(self.company, self.period_month)

        if self.override_mode not in VALID_OVERRIDES:
            frappe.throw("本月公积金例外只能选择“强制缴纳”或“强制停缴”。")

        employee = frappe.db.get_value(
            "Ashan Employee Salary Profile",
            {"company": self.company, "employee_no": self.employee_no},
            ["employee_name", "name"],
            as_dict=True,
        )
        if not employee:
            frappe.throw(f"未找到公司 {self.company} 下工号为 {self.employee_no} 的员工档案。")
        self.employee_name = employee.employee_name
