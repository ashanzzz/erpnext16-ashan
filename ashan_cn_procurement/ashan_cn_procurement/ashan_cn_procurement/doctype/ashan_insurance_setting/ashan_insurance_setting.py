# Copyright (c) 2026, Ashan CN Procurement
import frappe
from frappe.model.document import Document
from frappe.utils import flt

from ashan_cn_procurement.services.authorization_service import assert_module_access


JIZHONG_COMPANY = "天津吉众科技有限公司"


class AshanInsuranceSetting(Document):
    def autoname(self):
        if getattr(self, "period_month", None) and str(self.period_month).strip():
            self.name = f"{self.company}-{str(self.period_month).strip()}"
        elif getattr(self, "effective_year", None):
            self.name = f"{self.company}-{self.effective_year}"
        else:
            self.name = f"{self.company}-default"

    def before_insert(self):
        if getattr(self, "period_month", None) and str(self.period_month).strip():
            self.name = f"{self.company}-{str(self.period_month).strip()}"

    def validate(self):
        self._assert_jizhong_period_editable()
        self._assert_jizhong_configuration_access("configure")
        if getattr(self, "period_month", None) and str(self.period_month).strip():
            pm = str(self.period_month).strip()
            if "-" in pm:
                try:
                    self.effective_year = int(pm.split("-")[0])
                except Exception:
                    pass

        from ashan_cn_procurement.services.housing_fund_policy_service import parse_contribution_months

        months = parse_contribution_months(self.hf_contribution_months or "1,4,7,10")
        self.hf_contribution_months = ",".join(str(x) for x in months)
        if (self.hf_off_month_action or "停缴") not in {"停缴", "继续缴纳"}:
            frappe.throw("公积金非计划月份处理只能选择“停缴”或“继续缴纳”。")
        self.hf_off_month_action = self.hf_off_month_action or "停缴"
        if self._is_jizhong_monthly_setting():
            if flt(self.ss_min_base) <= 0:
                frappe.throw("社保最低缴费基数必须大于 0 元。")
            if flt(self.hf_min_base) <= 0:
                frappe.throw("公积金最低缴费基数必须大于 0 元。")

    def on_trash(self):
        """Keep confirmed Jizhong monthly rates immutable from the native form."""
        self._assert_jizhong_period_editable()
        self._assert_jizhong_configuration_access("delete")

    def _is_jizhong_monthly_setting(self):
        return (
            str(self.company or "").strip() == JIZHONG_COMPANY
            and bool(str(self.period_month or "").strip())
        )

    def _assert_jizhong_configuration_access(self, action):
        """Keep Jizhong rate configuration inside the payroll manager boundary."""
        if self._is_jizhong_monthly_setting():
            assert_module_access("payroll", action, company=self.company)

    def _assert_jizhong_period_editable(self):
        """Apply the Jizhong workbench confirmation lock to monthly rate records."""
        company = str(self.company or "").strip()
        period_month = str(self.period_month or "").strip()
        if company != JIZHONG_COMPANY or not period_month:
            return

        from ashan_cn_procurement.services.jizhong_payroll_service import (
            assert_jizhong_workflow_step_editable,
        )

        assert_jizhong_workflow_step_editable(company, period_month, "insurance")
