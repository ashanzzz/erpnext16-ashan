# Copyright (c) 2026, Ashan and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import flt

from ashan_cn_procurement.services.authorization_service import assert_module_access


BASE_MODE_MINIMUM = "最低缴费基数"
BASE_MODE_CUSTOM = "自定义"
VALID_BASE_MODES = {BASE_MODE_MINIMUM, BASE_MODE_CUSTOM}
JIZHONG_COMPANY = "天津吉众科技有限公司"


class JizhongEmployeeSalaryProfile(Document):
	def validate(self):
		self.validate_company()
		self.assert_profile_editable()
		self.parse_id_card_info()
		self.validate_insurance_bases()
		self.calculate_special_additional_deductions()

	def on_trash(self):
		"""Apply company, role, and confirmation checks to native-form deletes."""
		self.validate_company()
		assert_module_access("payroll", "delete", company=self.company)
		self.assert_profile_editable()

	def validate_company(self):
		if not self.company:
			self.company = JIZHONG_COMPANY
		if self.company != JIZHONG_COMPANY:
			frappe.throw("吉众员工薪资档案只能归属天津吉众科技有限公司。")

	def assert_profile_editable(self):
		"""Keep confirmed, open Jizhong payroll periods immutable from every write path."""
		assert_module_access("payroll", "write", company=self.company)
		from ashan_cn_procurement.services.jizhong_payroll_service import (
			assert_jizhong_workflow_step_editable,
		)

		open_settlements = frappe.get_list(
			"Ashan Monthly Payroll Settlement",
			filters={"company": self.company, "locked": 0},
			fields=["period_month"],
			order_by="period_month asc",
		)
		for settlement in open_settlements:
			assert_jizhong_workflow_step_editable(
				self.company,
				settlement.period_month,
				"employees",
			)

	def parse_id_card_info(self):
		cert_type = (self.certificate_type or "居民身份证").strip()
		if cert_type == "居民身份证" and self.id_card:
			id_clean = str(self.id_card).strip().upper()
			if len(id_clean) == 18 and id_clean[:17].isdigit():
				year = id_clean[6:10]
				month = id_clean[10:12]
				day = id_clean[12:14]
				if not self.birth_date:
					self.birth_date = f"{year}-{month}-{day}"
				if not self.gender:
					gender_code = int(id_clean[16])
					self.gender = "男" if gender_code % 2 == 1 else "女"

	def validate_insurance_bases(self):
		"""Preserve legacy bases until a user explicitly selects a current mode."""
		ss_mode = self._validate_base_mode(
			"social_security_base_mode", "社险申报基数"
		)
		hf_mode = self._validate_base_mode(
			"housing_fund_base_mode", "公积金申报基数"
		)

		if ss_mode == BASE_MODE_CUSTOM:
			self.custom_social_security_base = round(flt(self.custom_social_security_base), 2)
			if self.custom_social_security_base < 0:
				frappe.throw("自定义社险缴费基数不能为负数。")
			self.social_security_base = self.custom_social_security_base
		elif ss_mode == BASE_MODE_MINIMUM:
			self.custom_social_security_base = 0
			self.social_security_base = 0

		if hf_mode == BASE_MODE_CUSTOM:
			self.custom_housing_fund_base = round(flt(self.custom_housing_fund_base), 2)
			if self.custom_housing_fund_base < 0:
				frappe.throw("自定义公积金缴费基数不能为负数。")
			self.housing_fund_base = self.custom_housing_fund_base
		elif hf_mode == BASE_MODE_MINIMUM:
			self.custom_housing_fund_base = 0
			self.housing_fund_base = 0

	def _validate_base_mode(self, fieldname, label):
		"""Validate an explicit mode without rewriting a legacy blank value."""
		mode = str(getattr(self, fieldname, "") or "").strip()
		if not mode:
			if self.is_new():
				frappe.throw(f"新建档案必须选择{label}方式。")
			return None
		if mode not in VALID_BASE_MODES:
			frappe.throw(f"{label}方式只能选择最低缴费基数或自定义。")
		setattr(self, fieldname, mode)
		return mode

	def calculate_special_additional_deductions(self):
		self.special_additional_deductions_total = (
			flt(self.deduction_child_education)
			+ flt(self.deduction_continuing_education)
			+ flt(self.deduction_serious_illness)
			+ flt(self.deduction_housing_loan)
			+ flt(self.deduction_housing_rent)
			+ flt(self.deduction_elderly_care)
			+ flt(self.deduction_infant_care)
		)
