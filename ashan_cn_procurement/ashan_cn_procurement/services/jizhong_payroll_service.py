# ASHAN-UNIFIED-V2: canonical payroll authorization and transaction boundaries
# Copyright (c) 2026, Ashan CN Procurement
# 天津吉众科技有限公司 - 专有薪资核算、累计个税反推与五档配钞点钞服务
# 1:1 精确对齐《202606吉众人事综合.xlsm》全套业务公式

import os
import math
import re
import json
import frappe
from frappe.utils import cint, flt, getdate, today
from frappe.utils import now_datetime

from ashan_cn_procurement.services.ashan_holiday_service import get_month_workdays
from ashan_cn_procurement.services.authorization_service import (
	assert_payroll_access,
	can_module_access,
)
from ashan_cn_procurement.services.housing_fund_policy_service import (
	evaluate_housing_fund_policy,
	get_override_map,
)
from ashan_cn_procurement.services.jizhong_attendance_service import (
	_attendance_coverage as _get_jizhong_attendance_coverage,
	_is_jizhong_attendance_required,
)
from ashan_cn_procurement.services.payroll_settlement_service import resolve_big_medical_amount
from ashan_cn_procurement.services.permission_query_service import assert_doctype_permission

# 常量定义
FULL_DAY_HOURS = 8.0
FIXED_MONTHLY_DAYS = 21.5
FIXED_MONTHLY_HOURS = FIXED_MONTHLY_DAYS * FULL_DAY_HOURS # 172.0h
JIZHONG_COMPANY = "天津吉众科技有限公司"
JIZHONG_NO_INSURANCE_TYPES = {
	"返聘工", "退休返聘", "退休返聘人员", "其他-返聘工", "临时工", "零工",
	"外籍工", "实习生",
}
JIZHONG_INSURANCE_DEFAULTS = {
	"ss_company_injury": 0.55, "ss_company_pension": 16.0, "ss_company_medical": 10.0,
	"ss_company_unemployment": 0.5, "ss_company_other_medical": 0.5,
	"ss_person_pension": 8.0, "ss_person_medical": 2.0, "ss_person_unemployment": 0.5,
	"hf_person_rate": 5.0, "hf_company_rate": 5.0,
	"big_medical_amount_default": 22.0, "big_medical_amount_special": 21.0,
	"big_medical_special_months": "1,4,7,10", "hf_auto_rule_enabled": 1,
	"hf_contribution_months": "1,4,7,10", "hf_off_month_action": "停缴",
	"ss_min_base": 0.0, "hf_min_base": 0.0, "tax_threshold": 5000.0,
	"tax_cycle_start_month": 12,
}
INSURANCE_VALUE_FIELDS = {
	"ss_company_pension", "ss_company_unemployment", "ss_company_medical", "ss_company_other_medical",
	"ss_company_injury", "ss_person_pension", "ss_person_unemployment", "ss_person_medical",
	"big_medical_amount_default", "big_medical_amount_special", "big_medical_special_months",
	"hf_company_rate", "hf_person_rate", "hf_auto_rule_enabled", "hf_contribution_months",
	"hf_off_month_action", "ss_min_base", "hf_min_base", "tax_threshold", "tax_cycle_start_month",
}
JIZHONG_CONFIRMATION_PREFIX = "JIZHONG_WORKFLOW_CONFIRMATION:"
JIZHONG_CONFIRMATION_STEPS = (
	"employees",
	"attendance",
	"insurance",
	"tax",
	"cash_bills",
)
JIZHONG_STEP_LABELS = {
	"employees": "员工薪资档案",
	"attendance": "考勤与工时",
	"insurance": "社保公积金",
	"tax": "个人所得税台账",
	"cash_bills": "现金发放",
}


def _assert_jizhong_access(action, company):
	"""Authorize the dedicated Jizhong service for its only owning company."""
	company = str(company or "").strip()
	if company != JIZHONG_COMPANY:
		frappe.throw(
			f"吉众薪酬引擎只允许处理【{JIZHONG_COMPANY}】数据，不能用于其他公司。",
			frappe.PermissionError,
		)
	assert_payroll_access(action, company=company)
	return company


def _normalize_jizhong_period(period_month, required=True):
	"""Validate a payroll month and return the canonical YYYY-MM string."""
	value = str(period_month or "").strip()
	if not value and not required:
		return today()[:7]
	if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", value):
		frappe.throw("账期格式必须为 YYYY-MM，例如 2026-07。")
	return value


def _normalize_jizhong_confirmation_step(step):
	"""Validate a Jizhong monthly workflow confirmation step."""
	value = str(step or "").strip()
	if value not in JIZHONG_CONFIRMATION_STEPS:
		frappe.throw("确认步骤无效，请从员工档案、考勤、社保公积金、个税或现金发放中选择。")
	return value


def _get_jizhong_settlement_doc(company, period_month, create=False):
	"""Return the period settlement document, optionally creating its audit shell."""
	doc_name = f"{company}-{period_month}"
	if frappe.db.exists("Ashan Monthly Payroll Settlement", doc_name):
		return frappe.get_doc("Ashan Monthly Payroll Settlement", doc_name)
	if not create:
		return None

	assert_doctype_permission("Ashan Monthly Payroll Settlement", "create")
	doc = frappe.new_doc("Ashan Monthly Payroll Settlement")
	doc.company = company
	doc.period_month = period_month
	doc.status = "草稿"
	doc.workflow_stage = "草稿"
	doc.insert()
	return doc


def _get_jizhong_confirmation_state(doc):
	"""Read the latest auditable confirmation event for every workflow step."""
	state = {
		step: {
			"confirmed": False,
			"confirmed_by": None,
			"confirmed_at": None,
		}
		for step in JIZHONG_CONFIRMATION_STEPS
	}
	if not doc:
		return state

	comments = frappe.db.get_all(
		"Comment",
		filters={
			"reference_doctype": "Ashan Monthly Payroll Settlement",
			"reference_name": doc.name,
			"comment_type": "Comment",
		},
		fields=["content", "owner", "creation"],
		order_by="creation asc, name asc",
	)
	for comment in comments:
		content = str(comment.get("content") or "")
		if not content.startswith(JIZHONG_CONFIRMATION_PREFIX):
			continue
		try:
			event = json.loads(content[len(JIZHONG_CONFIRMATION_PREFIX):])
		except (TypeError, ValueError, json.JSONDecodeError):
			continue
		step = event.get("step")
		if step not in state:
			continue
		is_confirmed = event.get("action") == "confirm"
		state[step] = {
			"confirmed": is_confirmed,
			"confirmed_by": comment.get("owner") if is_confirmed else None,
			"confirmed_at": comment.get("creation") if is_confirmed else None,
		}
	return state


def _record_jizhong_confirmation_event(doc, step, action, reason=None):
	"""Append one immutable workflow confirmation event to the settlement timeline."""
	event = {"step": step, "action": action}
	if reason:
		event["reason"] = frappe.utils.escape_html(str(reason).strip())
	doc.add_comment(
		"Comment",
		text=f"{JIZHONG_CONFIRMATION_PREFIX}{json.dumps(event, ensure_ascii=False, sort_keys=True)}",
	)


def _clear_jizhong_calculation(doc):
	"""Invalidate derived payroll rows after an upstream source confirmation is revoked."""
	doc.items = []
	doc.status = "草稿"
	doc.workflow_stage = "草稿"
	for fieldname in (
		"total_employees",
		"total_gross_salary",
		"total_net_salary",
		"total_social_security_company",
		"total_social_security_person",
		"total_housing_fund_company",
		"total_housing_fund_person",
		"total_tax",
	):
		setattr(doc, fieldname, 0)
	doc.save()


def assert_jizhong_workflow_step_editable(company, period_month, step):
	"""Reject edits to a confirmed Jizhong monthly source step."""
	period_month = _normalize_jizhong_period(period_month)
	step = _normalize_jizhong_confirmation_step(step)
	company = _assert_jizhong_access("write", company)
	doc = _get_jizhong_settlement_doc(company, period_month)
	if not doc:
		return
	if cint(doc.get("locked")):
		frappe.throw(f"【{period_month}】已核定封账，不能修改{JIZHONG_STEP_LABELS[step]}。")
	if _get_jizhong_confirmation_state(doc)[step]["confirmed"]:
		frappe.throw(
			f"【{period_month}】{JIZHONG_STEP_LABELS[step]}已确认并处于只读保护。"
			"请先取消该步骤的确认后再修改。"
		)


def _jizhong_profile_doctype() -> str:
	"""Return the dedicated Jizhong profile DocType without cross-company fallback."""
	doctype = "Jizhong Employee Salary Profile"
	if not frappe.db.table_exists(doctype):
		frappe.throw("吉众员工薪资档案模块未安装，不能回退到祺富或通用薪酬档案。")
	return doctype


JIZHONG_BASE_MODE_MINIMUM = "最低缴费基数"
JIZHONG_BASE_MODE_CUSTOM = "自定义"
JIZHONG_BASE_MODES = {JIZHONG_BASE_MODE_MINIMUM, JIZHONG_BASE_MODE_CUSTOM}
JIZHONG_BASE_MODE_LEGACY = "历史基数，待选择"
JIZHONG_SS_COMPANY_COMPONENTS = (
	("pension", "ss_company_pension"),
	("medical", "ss_company_medical"),
	("unemployment", "ss_company_unemployment"),
	("other_medical", "ss_company_other_medical"),
	("injury", "ss_company_injury"),
)
JIZHONG_SS_PERSON_COMPONENTS = (
	("pension", "ss_person_pension"),
	("medical", "ss_person_medical"),
	("unemployment", "ss_person_unemployment"),
)


def _normalize_jizhong_base_mode(value, label):
	"""Validate an explicit Jizhong insurance-base mode."""
	mode = str(value or "").strip()
	if mode not in JIZHONG_BASE_MODES:
		frappe.throw(f"{label}方式只能选择最低缴费基数或自定义。")
	return mode


def _resolve_jizhong_base(profile, setting, base_type):
	"""Resolve one base while preserving the persisted legacy profile fields."""
	if base_type == "social_security":
		mode_field = "social_security_base_mode"
		custom_field = "custom_social_security_base"
		legacy_field = "social_security_base"
		minimum_field = "ss_min_base"
		label = "社险申报基数"
	else:
		mode_field = "housing_fund_base_mode"
		custom_field = "custom_housing_fund_base"
		legacy_field = "housing_fund_base"
		minimum_field = "hf_min_base"
		label = "公积金申报基数"

	getter = (
		profile.get
		if hasattr(profile, "get")
		else lambda key, default=None: getattr(profile, key, default)
	)
	raw_mode = str(getter(mode_field) or "").strip()
	if not raw_mode:
		legacy_value = round(flt(getter(legacy_field)), 2)
		if legacy_value < 0:
			frappe.throw(f"{label}不能为负数。")
		return {
			"mode": "",
			"base": legacy_value,
			"source": JIZHONG_BASE_MODE_LEGACY,
			"needs_selection": legacy_value <= 0,
		}

	mode = _normalize_jizhong_base_mode(raw_mode, label)
	if mode == JIZHONG_BASE_MODE_CUSTOM:
		value = getter(custom_field)
		if value in (None, ""):
			value = getter(legacy_field)
		value = flt(value)
		if value < 0:
			frappe.throw(f"{label}不能为负数。")
		value = round(value, 2)
		return {
			"mode": mode,
			"base": value,
			"source": mode,
			"needs_selection": False,
		}

	setting_getter = (
		setting.get
		if hasattr(setting, "get")
		else lambda key, default=None: getattr(setting, key, default)
	)
	value = round(max(0.0, flt(setting_getter(minimum_field))), 2)
	return {
		"mode": mode,
		"base": value,
		"source": mode,
		"needs_selection": False,
	}


def _apply_jizhong_effective_bases(profile, setting):
	"""Attach period-effective bases without replacing the persisted profile values."""
	ss = _resolve_jizhong_base(profile, setting, "social_security")
	hf = _resolve_jizhong_base(profile, setting, "housing_fund")
	profile["effective_social_security_base"] = ss["base"]
	profile["social_security_base_source"] = ss["source"]
	profile["social_security_base_needs_selection"] = ss["needs_selection"]
	profile["effective_housing_fund_base"] = hf["base"]
	profile["housing_fund_base_source"] = hf["source"]
	profile["housing_fund_base_needs_selection"] = hf["needs_selection"]
	return profile


def _jizhong_profiles_missing_base_selection(profiles, period_month, insurance_setting):
	"""List active, insurable profiles that still have an unresolved zero legacy base."""
	issues = []
	for profile in profiles:
		if _jizhong_insurance_exclusion_reason(profile.get("employee_type")):
			continue
		employee = f"{profile.get('employee_name') or ''}（{profile.get('employee_no') or ''}）"
		if not str(profile.get("social_security_base_mode") or "").strip() and flt(
			profile.get("social_security_base")
		) <= 0:
			issues.append(f"{employee}未选择社险申报基数方式")
		if flt(insurance_setting.get("hf_min_base")) <= 0:
			continue
		housing_decision = evaluate_housing_fund_policy(
			profile, period_month, insurance_setting
		)
		if (
			housing_decision.get("is_contributing")
			and not str(profile.get("housing_fund_base_mode") or "").strip()
			and flt(profile.get("housing_fund_base")) <= 0
		):
			issues.append(f"{employee}未选择公积金申报基数方式")
	return issues


def _jizhong_insurance_setting_errors(insurance_setting):
	"""Return configuration blockers before a dynamic minimum base is used."""
	getter = (
		insurance_setting.get
		if hasattr(insurance_setting, "get")
		else lambda key, default=None: getattr(insurance_setting, key, default)
	)
	errors = []
	if not getter("is_configured"):
		errors.append("当前账期社保公积金配置尚未保存")
	if flt(getter("ss_min_base")) <= 0:
		errors.append("社保最低缴费基数未配置")
	if flt(getter("hf_min_base")) <= 0:
		errors.append("公积金最低缴费基数未配置")
	return errors


def _calculate_jizhong_social_insurance_components(base, insurance_setting, big_medical):
	"""Round statutory components once and reuse them in the table and payroll ledger."""
	base = max(0.0, round(flt(base), 2))
	company = {
		component: round(base * flt(insurance_setting.get(fieldname)) / 100.0, 2)
		for component, fieldname in JIZHONG_SS_COMPANY_COMPONENTS
	}
	person = {
		component: round(base * flt(insurance_setting.get(fieldname)) / 100.0, 2)
		for component, fieldname in JIZHONG_SS_PERSON_COMPONENTS
	}
	person["large_medical"] = round(flt(big_medical), 2) if base > 0 else 0.0
	return {
		"company": company,
		"person": person,
		"company_total": round(sum(company.values()), 2),
		"person_total": round(sum(person.values()), 2),
	}


def _jizhong_insurance_exclusion_reason(employee_type):
	"""Return the statutory exclusion reason for a Jizhong employee type."""
	employee_type = str(employee_type or "正式工").strip()
	if employee_type in JIZHONG_NO_INSURANCE_TYPES:
		return f"{employee_type}不纳入吉众社保、公积金统筹"
	if employee_type == "兼职":
		return "兼职人员不纳入吉众社保、公积金统筹"
	return ""


def _build_jizhong_insurance_confirmation_sheets(
	company,
	period_month,
	insurance_setting,
	employees_confirmed=False,
	insurance_confirmed=False,
):
	"""Build the in-memory Jizhong social-insurance and housing-fund sheets."""
	period_month = _normalize_jizhong_period(period_month)
	payment_period = _compute_next_period(period_month)
	configuration_errors = _jizhong_insurance_setting_errors(insurance_setting)
	preview_reasons = []
	if not employees_confirmed:
		preview_reasons.append("请先确认员工薪资档案")
	preview_reasons.extend(configuration_errors)
	if configuration_errors:
		return {
			"ready": False,
			"preview_ready": False,
			"print_ready": False,
			"edition": "未就绪",
			"reason": "；".join(preview_reasons),
			"company": company,
			"period_month": period_month,
			"payment_period_month": payment_period,
			"social_insurance": {"title": "社会保险确认表", "rows": [], "totals": {}},
			"housing_fund": {"title": "住房公积金确认表", "rows": [], "totals": {}},
		}
	profiles = _jizhong_active_profiles(
		company,
		fields=[
			"employee_no", "employee_name", "employee_type", "employment_status",
			"social_security_base", "social_security_base_mode", "custom_social_security_base",
			"housing_fund_base", "housing_fund_base_mode", "custom_housing_fund_base",
			"housing_fund_policy",
		],
	)
	for profile in profiles:
		_apply_jizhong_effective_bases(profile, insurance_setting)

	overrides = get_override_map(company, period_month)
	big_medical = resolve_big_medical_amount(
		insurance_setting,
		payroll_period_month=period_month,
		payment_period_month=payment_period,
	)

	social_rows = []
	housing_rows = []
	for sequence, employee in enumerate(profiles, start=1):
		employee_type = str(employee.get("employee_type") or "正式工").strip()
		eligibility_reason = _jizhong_insurance_exclusion_reason(employee_type)
		ss_base = 0.0 if eligibility_reason else flt(employee.get("effective_social_security_base"))
		base_source = employee.get("social_security_base_source") or JIZHONG_BASE_MODE_LEGACY
		social_status_reason = eligibility_reason
		if ss_base <= 0 and not social_status_reason:
			social_status_reason = "社险申报基数为 0，当前不生成缴费金额"

		contributions = _calculate_jizhong_social_insurance_components(
			ss_base, insurance_setting, big_medical
		)
		company_amounts = contributions["company"]
		person_amounts = contributions["person"]
		company_total = contributions["company_total"]
		person_total = contributions["person_total"]
		social_rows.append({
			"seq": sequence,
			"employee_no": employee.get("employee_no"),
			"employee_name": employee.get("employee_name"),
			"employee_type": employee_type,
			"employee_category": _jizhong_employee_category(
				employee_type, employee.get("employment_status")
			),
			"base_mode": base_source,
			"base": round(ss_base, 2),
			"person_pension": person_amounts["pension"],
			"person_medical": person_amounts["medical"],
			"person_unemployment": person_amounts["unemployment"],
			"person_large_medical": round(person_amounts["large_medical"], 2),
			"person_total": person_total,
			"company_pension": company_amounts["pension"],
			"company_medical": company_amounts["medical"],
			"company_unemployment": company_amounts["unemployment"],
			"company_other_medical": company_amounts["other_medical"],
			"company_injury": company_amounts["injury"],
			"company_total": company_total,
			"grand_total": round(company_total + person_total, 2),
			"status": "不参保" if social_status_reason else "参保",
			"status_reason": social_status_reason,
		})

		hf_override = overrides.get(str(employee.get("employee_no") or ""))
		if eligibility_reason:
			hf_decision = {
				"effective_base": 0.0,
				"is_contributing": False,
				"decision_label": "不参与",
				"decision_source": "用工规则",
				"decision_code": "INELIGIBLE_TYPE",
				"employee_policy": employee.get("housing_fund_policy") or "跟随公司规则",
				"monthly_override": "",
				"reason": eligibility_reason,
			}
		else:
			hf_decision = evaluate_housing_fund_policy(
				employee,
				period_month,
				insurance_setting,
				hf_override.override_mode if hf_override else "",
			)
		hf_base = round(flt(hf_decision.get("effective_base")), 2)
		hf_person_rate = flt(insurance_setting.get("hf_person_rate"))
		hf_company_rate = flt(insurance_setting.get("hf_company_rate"))
		hf_person_amount = round(hf_base * hf_person_rate / 100.0, 2)
		hf_company_amount = round(hf_base * hf_company_rate / 100.0, 2)
		housing_rows.append({
			"seq": sequence,
			"employee_no": employee.get("employee_no"),
			"employee_name": employee.get("employee_name"),
			"employee_type": employee_type,
			"base_mode": employee.get("housing_fund_base_source") or JIZHONG_BASE_MODE_LEGACY,
			"master_base": round(flt(employee.get("effective_housing_fund_base")), 2),
			"effective_base": hf_base,
			"person_rate": hf_person_rate,
			"person_amount": hf_person_amount,
			"company_rate": hf_company_rate,
			"company_amount": hf_company_amount,
			"total_amount": round(hf_person_amount + hf_company_amount, 2),
			"status": "缴纳" if hf_decision.get("is_contributing") else "停缴",
			"decision_label": hf_decision.get("decision_label") or "-",
			"decision_source": hf_decision.get("decision_source") or "-",
			"status_reason": hf_decision.get("reason") or "",
			"housing_fund_policy": hf_decision.get("employee_policy") or "跟随公司规则",
			"monthly_override": hf_decision.get("monthly_override") or "",
		})

	def sum_field(rows, field):
		return round(sum(flt(row.get(field)) for row in rows), 2)

	social_totals = {
		"row_count": len(social_rows),
		"contributor_count": sum(1 for row in social_rows if row["status"] == "参保"),
		"excluded_count": sum(1 for row in social_rows if row["status"] != "参保"),
		"base": sum_field(social_rows, "base"),
		"person_pension": sum_field(social_rows, "person_pension"),
		"person_medical": sum_field(social_rows, "person_medical"),
		"person_unemployment": sum_field(social_rows, "person_unemployment"),
		"person_large_medical": sum_field(social_rows, "person_large_medical"),
		"person_total": sum_field(social_rows, "person_total"),
		"company_pension": sum_field(social_rows, "company_pension"),
		"company_medical": sum_field(social_rows, "company_medical"),
		"company_unemployment": sum_field(social_rows, "company_unemployment"),
		"company_other_medical": sum_field(social_rows, "company_other_medical"),
		"company_injury": sum_field(social_rows, "company_injury"),
		"company_total": sum_field(social_rows, "company_total"),
		"grand_total": sum_field(social_rows, "grand_total"),
	}
	housing_totals = {
		"row_count": len(housing_rows),
		"contributor_count": sum(1 for row in housing_rows if row["status"] == "缴纳"),
		"stopped_count": sum(1 for row in housing_rows if row["status"] != "缴纳"),
		"master_base": sum_field(housing_rows, "master_base"),
		"effective_base": sum_field(housing_rows, "effective_base"),
		"person_amount": sum_field(housing_rows, "person_amount"),
		"company_amount": sum_field(housing_rows, "company_amount"),
		"total_amount": sum_field(housing_rows, "total_amount"),
	}

	reasons = list(preview_reasons)
	if not insurance_confirmed:
		reasons.append("请先确认社保公积金配置")
	preview_ready = not preview_reasons

	return {
		"ready": not reasons,
		"preview_ready": preview_ready,
		"print_ready": preview_ready,
		"edition": "已确认版" if insurance_confirmed else "核对版（未确认）",
		"reason": "；".join(reasons),
		"company": company,
		"period_month": period_month,
		"payment_period_month": payment_period,
		"social_insurance": {
			"title": "社会保险确认表",
			"rows": social_rows,
			"totals": social_totals,
			"big_medical_amount": round(big_medical, 2),
		},
		"housing_fund": {
			"title": "住房公积金确认表",
			"rows": housing_rows,
			"totals": housing_totals,
			"policy_month": payment_period,
		},
	}


def _jizhong_employee_category(employee_type, employment_status=None):
	"""Map legacy Jizhong employee values to the five report categories."""
	status = str(employment_status or "").strip()
	raw_type = str(employee_type or "正式工").strip()
	if raw_type in {"本月离职", "本月离职人员"} or status == "本月离职":
		return "本月离职人员"
	if raw_type in {"返聘工", "退休返聘", "退休返聘人员", "其他-返聘工"}:
		return "退休返聘人员"
	if raw_type in {"临时工", "零工"}:
		return "临时工"
	if raw_type == "正式工":
		return "正式工"
	return "其他类型员工"


def _jizhong_active_profiles(company, fields):
	"""Return only employees eligible for the selected Jizhong payroll month."""
	return frappe.get_list(
		_jizhong_profile_doctype(),
		filters={"company": company},
		or_filters=[
			{"employment_status": "在职"},
			{"employee_type": ["in", ["本月离职", "本月离职人员"]]},
		],
		fields=fields,
		order_by="employee_no asc",
		limit_page_length=0,
	)


# 七级综合累计个税税率表 (速算扣除数按年累计)
TAX_BRACKETS_ANNUAL = [
	(0.0, 36000.0, 0.03, 0.0),
	(36000.0, 144000.0, 0.10, 2520.0),
	(144000.0, 300000.0, 0.20, 16920.0),
	(300000.0, 420000.0, 0.25, 31920.0),
	(420000.0, 660000.0, 0.30, 52920.0),
	(660000.0, 960000.0, 0.35, 85920.0),
	(960000.0, 999999999.0, 0.45, 181920.0),
]


def _get_annual_tax(taxable_income):
	"""根据年累计应纳税所得额计算累计应纳税额"""
	if taxable_income <= 0:
		return 0.0
	for lower, upper, rate, quick_ded in TAX_BRACKETS_ANNUAL:
		if lower <= taxable_income <= upper:
			return round(taxable_income * rate - quick_ded, 2)
	# 超出最高档
	return round(taxable_income * 0.45 - 181920.0, 2)


def derive_jizhong_gross_from_net(
	target_net,
	special_deductions_cur=0.0,
	tax_threshold=5000.0,
	prev_gross=0.0,
	prev_threshold=0.0,
	prev_special_ded=0.0,
	prev_additional_ded=0.0,
	prev_tax_paid=0.0,
	cur_additional_ded=0.0,
):
	"""
	1:1 复刻《个人所得税.bas》个人所得税_辅助函数_反推计算应缴所得税
	根据约定税后净发，闭式反推当月税前薪酬、当月代扣个税与累计税金
	"""
	# VBA 原版闭式公式：
	# 目前应纳税所得税 = Round(((以往税前 + 当月税后 - 以往已纳税 - 以往免征 - 以往专项 - 以往附加 - 当月免征 - 当月附加) * 税率 - 速算扣除数) / (1 - 税率), 2)
	# 当月扣个税 = 目前应纳税所得税 - 以往已纳税
	# 反推税前 = 当月税后 + 当月专项扣除 + 当月扣个税

	target_gross = 0.0
	cur_tax = 0.0
	matched_tax = 0.0

	for lower, upper, rate, quick_ded in TAX_BRACKETS_ANNUAL:
		numerator = (
			(prev_gross + target_net - prev_tax_paid - prev_threshold - prev_special_ded - prev_additional_ded - tax_threshold - cur_additional_ded) * rate
			- quick_ded
		)
		if 1.0 - rate == 0:
			continue
		cum_tax_calc = round(numerator / (1.0 - rate), 2)
		if cum_tax_calc < 0:
			tax_this_month = 0.0
			cum_tax_calc = 0.0
		else:
			tax_this_month = round(cum_tax_calc - prev_tax_paid, 2)

		candidate_gross = round(target_net + special_deductions_cur + tax_this_month, 2)

		# 正推验算
		cum_taxable = (prev_gross + candidate_gross) - (prev_threshold + tax_threshold) - (prev_special_ded + special_deductions_cur) - (prev_additional_ded + cur_additional_ded)
		verify_tax = _get_annual_tax(cum_taxable)

		if abs(verify_tax - cum_tax_calc) <= 0.05:
			target_gross = candidate_gross
			cur_tax = max(0.0, tax_this_month)
			matched_tax = verify_tax
			break

	if target_gross <= 0.0:
		# 极低薪资或无须纳税边界
		target_gross = round(target_net + special_deductions_cur, 2)
		cur_tax = 0.0

	return {
		"gross_salary": target_gross,
		"tax_amount": cur_tax,
		"net_salary": target_net,
	}


def split_cash_bills(cash_amount):
	"""五档人民币面额贪心拆分 (100, 50, 10, 5, 1)"""
	amt = int(cash_amount)
	b100 = amt // 100
	rem = amt % 100
	b50 = rem // 50
	rem = rem % 50
	b10 = rem // 10
	rem = rem % 10
	b5 = rem // 5
	rem = rem % 5
	b1 = rem
	return b100, b50, b10, b5, b1


@frappe.whitelist(methods=["POST"])
def calculate_jizhong_monthly_payroll(company="天津吉众科技有限公司", period_month=None):
	"""
	执行吉众月度薪酬核算全流程：
	1. 归集考勤工时与倒休抵扣
	2. 动态工作日 (168h/184h) vs 固定平均日 (172h) 双基准计算
	3. 税后管理工资闭式反推
	4. 历史个税累计预扣计算
	5. 现金发放 RoundUp 与五档点钞
	6. 生成或更新 Ashan Monthly Payroll Settlement
	"""
	# 参数防御：容错实参与形参顺序颠倒 (例如 (period_month, company) 或仅传 period_month)
	if company and ("-" in str(company) or (len(str(company)) == 7 and str(company)[:4].isdigit())) and ("公司" in str(period_month or "")):
		company, period_month = period_month, company
	elif not period_month and company and ("-" in str(company) or len(str(company)) == 7):
		period_month, company = company, "天津吉众科技有限公司"

	period_month = _normalize_jizhong_period(period_month)
	company = _assert_jizhong_access("write", company)
	assert_doctype_permission("Ashan Monthly Payroll Settlement", "write")
	assert_doctype_permission("Jizhong Employee Salary Profile", "read")
	assert_doctype_permission("Jizhong Monthly Attendance", "read")
	confirmation_doc = _get_jizhong_settlement_doc(company, period_month)
	confirmations = _get_jizhong_confirmation_state(confirmation_doc)
	missing_confirmations = [
		JIZHONG_STEP_LABELS[step]
		for step in ("employees", "attendance", "insurance")
		if not confirmations[step]["confirmed"]
	]
	if missing_confirmations:
		frappe.throw(
			f"【禁止测算】{period_month} 尚未确认前置资料：{'、'.join(missing_confirmations)}。"
		"请在对应页面核验后点击确认。"
		)
	if confirmations["tax"]["confirmed"] or confirmations["cash_bills"]["confirmed"]:
		frappe.throw(
			f"【禁止重算】{period_month} 的个税台账或现金发放已确认。"
			"请按逆序取消确认后再重新测算。"
		)
	# 1. 动态获取当月法定工作日天数
	year = cint(period_month.split("-")[0])
	month = cint(period_month.split("-")[1])
	dynamic_workdays = cint(get_month_workdays(year, month))
	if dynamic_workdays <= 0:
		frappe.throw(f"{period_month} 没有可用的法定工作日配置，无法核算薪酬。")
	dynamic_work_hours = dynamic_workdays * FULL_DAY_HOURS # 如 21天 -> 168.0h, 23天 -> 184.0h

	# 2. 获取社保公积金配置 (按月优先，默认承袭上月，并核定保存为本月)
	ins_setting = get_jizhong_insurance_setting(company=company, period_month=period_month)
	if not ins_setting.get("is_configured"):
		frappe.throw(
			f"【{company}】{period_month} 尚未确认月度社保、公积金和个税配置。"
			"请先在“社保公积金配置”中保存本月费率，再执行薪酬核算。"
		)
	configuration_errors = _jizhong_insurance_setting_errors(ins_setting)
	if configuration_errors:
		frappe.throw(f"【禁止算薪】{'；'.join(configuration_errors)}。")
	hf_person_rate = flt(ins_setting.get("hf_person_rate") or 5.0)
	hf_company_rate = flt(ins_setting.get("hf_company_rate") or 5.0)
	tax_threshold = flt(ins_setting.get("tax_threshold") or 5000.0)
	if tax_threshold <= 0:
		frappe.throw(f"【{company}】{period_month} 个税基本减除费用配置无效，必须大于 0。")

	# 按工资核算月的次月实际缴费所属期解析大额医疗金额。
	big_med = resolve_big_medical_amount(ins_setting, payroll_period_month=period_month)

	employees = _jizhong_active_profiles(
		company,
		fields=[
			"name", "employee_no", "employee_name", "employee_type", "employment_status",
			"salary_mode", "fixed_salary", "base_salary", "house_rent_allowance", "post_allowance", "performance_base",
			"meal_allowance", "social_security_base", "social_security_base_mode", "custom_social_security_base",
			"housing_fund_base", "housing_fund_base_mode", "custom_housing_fund_base", "id_card", "mobile", "department", "job_title",
			"housing_fund_policy",
			"deduction_child_education", "deduction_continuing_education", "deduction_housing_loan",
			"deduction_housing_rent", "deduction_elderly_care", "deduction_infant_care", "deduction_serious_illness"
		],
	)
	for employee in employees:
		_apply_jizhong_effective_bases(employee, ins_setting)
	base_selection_issues = _jizhong_profiles_missing_base_selection(
		employees, period_month, ins_setting
	)
	if base_selection_issues:
		frappe.throw(
			f"【禁止算薪】{'；'.join(base_selection_issues)}。"
			"请在员工薪资档案中明确选择最低缴费基数或自定义。"
		)

	# 4. 获取当月考勤底册
	attendances = {}
	att_records = frappe.get_list(
		"Jizhong Monthly Attendance",
		filters={"company": company, "period_month": period_month},
		fields=["*"],
		order_by="employee_no asc",
		limit_page_length=0,
	)
	for a in att_records:
		attendances[a.employee_no] = a
	coverage = _get_jizhong_attendance_coverage(company, period_month)
	if not coverage["complete"]:
		frappe.throw(
			f"【禁止算薪】{period_month} 考勤未完整覆盖需要考勤的人员："
			f"应计薪 {coverage['expected_count']} 人，已匹配 {coverage['matched_count']} 人；"
			f"无需上传考勤 {coverage.get('excluded_count', 0)} 人；"
			f"缺失工号：{'、'.join(coverage['missing_employee_nos']) or '无'}；"
			f"多余工号：{'、'.join(coverage['extra_employee_nos']) or '无'}；"
			f"姓名不一致：{'、'.join(coverage['name_mismatches']) or '无'}；"
			f"重复记录：{'、'.join(coverage['duplicate_employee_nos']) or '无'}；"
			f"缺少原始文件关联：{'、'.join(coverage['missing_file_employee_nos']) or '无'}。"
		)

	tax_cycle_start = cint(ins_setting.get("tax_cycle_start_month")) or 12
	if tax_cycle_start < 1 or tax_cycle_start > 12:
		frappe.throw("个税累计申报周期起始月必须为 1 至 12 月。")
	tax_history = _get_jizhong_tax_history(company, period_month, tax_cycle_start)
	hf_override_map = get_override_map(company, period_month)

	# 6. 初始化或加载 Settlement 单据
	doc_name = f"{company}-{period_month}"
	if frappe.db.exists("Ashan Monthly Payroll Settlement", doc_name):
		doc = frappe.get_doc("Ashan Monthly Payroll Settlement", doc_name)
		if cint(doc.get("locked")):
			frappe.throw(f"【{company}】{period_month} 已封账。请按解锁流程处理后再重新计算。")
		doc.items = []
	else:
		doc = frappe.new_doc("Ashan Monthly Payroll Settlement")
		doc.company = company
		doc.period_month = period_month

	doc.status = "草稿"
	doc.locked = 0
	doc.workflow_stage = "已计算"

	total_gross = 0.0
	total_net = 0.0
	total_ss_comp = 0.0
	total_ss_pers = 0.0
	total_hf_comp = 0.0
	total_hf_pers = 0.0
	total_tax = 0.0
	total_cash = 0.0

	# 委托不分钞人员工号集合
	NO_CASH_EMPS = {"L0001"}

	for emp in employees:
		emp_no = emp.employee_no
		emp_name = emp.employee_name
		salary_mode = str(emp.salary_mode or "税前动态工资").strip()
		emp_type = str(emp.employee_type or "正式工").strip()
		employee_category = _jizhong_employee_category(emp_type, emp.employment_status)

		att = attendances.get(emp_no)
		if att is None and _is_jizhong_attendance_required(emp):
			# Coverage is checked above; this guard keeps a concurrent roster change
			# from turning into an opaque KeyError during payroll calculation.
			frappe.throw(f"【禁止算薪】员工【{emp_name}（{emp_no}）】缺少当月考勤记录。")
		full_days = flt(att.attendance_days) if att else 0.0
		half_days = flt(att.half_days) if att else 0.0
		absent_days = flt(att.absent_days) if att else 0.0
		work_hrs = round(flt(att.work_hours_regular), 1) if att else 0.0
		ot_1_5 = round(flt(att.overtime_regular_1_5), 1) if att else 0.0
		ot_2_0 = round(flt(att.overtime_weekend_2_0), 1) if att else 0.0
		ot_3_0 = round(flt(att.overtime_holiday_3_0), 1) if att else 0.0
		leave_comp = round(flt(att.leave_compensatory_hours), 1) if att else 0.0
		meal_cnt = cint(att.meal_count) if att else 0

		# 薪资标准项
		base_sal = flt(emp.base_salary)
		base_sub = flt(emp.house_rent_allowance)
		post_allow = flt(emp.post_allowance)
		perf_base = flt(emp.performance_base)
		fixed_sal = flt(emp.fixed_salary)
		meal_unit_price = flt(emp.meal_allowance or 15.0)

		# 社保与公积金基数处理 (返聘/临时等不扣社保)
		no_insurance = emp_type in JIZHONG_NO_INSURANCE_TYPES or emp_type == "兼职"
		ss_base = 0.0 if no_insurance else flt(emp.effective_social_security_base)
		hf_override = hf_override_map.get(emp_no)
		hf_decision = evaluate_housing_fund_policy(
			emp,
			period_month,
			ins_setting,
			hf_override.override_mode if hf_override else "",
		)
		hf_base = 0.0 if no_insurance else flt(hf_decision.get("effective_base"))

		# 专项个人扣除
		ss_components = _calculate_jizhong_social_insurance_components(
			ss_base, ins_setting, big_med
		)
		ss_pers = ss_components["person_total"]
		hf_pers = round(hf_base * (hf_person_rate / 100.0), 2)
		ss_comp = ss_components["company_total"]
		hf_comp = round(hf_base * (hf_company_rate / 100.0), 2)

		company_cost = round(ss_comp + hf_comp, 2)
		person_special_ded = round(ss_pers + hf_pers, 2)

		# 专项附加扣除
		additional_ded = round(
			flt(emp.deduction_child_education) +
			flt(emp.deduction_continuing_education) +
			flt(emp.deduction_housing_loan) +
			flt(emp.deduction_housing_rent) +
			flt(emp.deduction_elderly_care) +
			flt(emp.deduction_infant_care) +
			flt(emp.deduction_serious_illness),
			2
		)

		# 历史个税累计
		hist = tax_history.get(emp_no, {})
		prev_gross = flt(hist.get("prev_gross", 0.0))
		prev_thresh = flt(hist.get("prev_thresh", 0.0))
		prev_special_ded = flt(hist.get("prev_special_ded", 0.0))
		prev_add_ded = flt(hist.get("prev_add_ded", 0.0))
		prev_tax_paid = flt(hist.get("prev_tax_paid", 0.0))

		# 分项测算
		sal_basic_hrs = 0.0
		sal_ot_1_5 = 0.0
		sal_ot_2_0 = 0.0
		sal_ot_3_0 = 0.0
		sal_basic_sub = 0.0
		sal_perf = 0.0
		sal_post = 0.0
		sal_meal = 0.0
		sal_adj = 0.0
		gross_sal = 0.0
		tax_amt = 0.0
		net_sal = 0.0

		if salary_mode == "税后管理工资":
			# 税后管理工资：各项工时工资置 0，直接以目标净发反推
			if fixed_sal <= 0:
				frappe.throw(
					f"员工【{emp_name}（{emp_no}）】的税后管理工资缺少有效的“实发约定净薪”，"
					"请先在薪资档案中填写大于 0 的目标金额。"
				)
			target_net = fixed_sal
			res = derive_jizhong_gross_from_net(
				target_net=target_net,
				special_deductions_cur=person_special_ded,
				tax_threshold=tax_threshold,
				prev_gross=prev_gross,
				prev_threshold=prev_thresh,
				prev_special_ded=prev_special_ded,
				prev_additional_ded=prev_add_ded,
				prev_tax_paid=prev_tax_paid,
				cur_additional_ded=additional_ded,
			)
			gross_sal = res["gross_salary"]
			tax_amt = res["tax_amount"]
			net_sal = target_net
			sal_basic_hrs = gross_sal # 管理岗位全额计入基本工时工资
		else:
			# 税前动态工资正算
			dyn_hourly = round(base_sal / dynamic_work_hours, 6) if dynamic_work_hours > 0 else 0.0
			fix_hourly = round(base_sal / FIXED_MONTHLY_HOURS, 6) # 基本工资 / 172.0
			absence_hrs = round(max(0.0, dynamic_work_hours - work_hrs), 1)

			sal_basic_hrs = round(work_hrs * dyn_hourly, 2)
			sal_ot_1_5 = round(fix_hourly * ot_1_5 * 1.5, 2)
			sal_ot_2_0 = round(fix_hourly * ot_2_0 * 2.0, 2)
			sal_ot_3_0 = round(fix_hourly * ot_3_0 * 3.0, 2)

			sal_basic_sub = round(base_sub - (base_sub / dynamic_work_hours * absence_hrs), 2) if base_sub else 0.0
			sal_perf = round(perf_base - (perf_base / FIXED_MONTHLY_HOURS * absence_hrs), 2) if perf_base else 0.0
			sal_post = round(post_allow - (post_allow / dynamic_work_hours * absence_hrs), 2) if post_allow else 0.0
			sal_meal = round(meal_unit_price * meal_cnt, 2)
			sal_adj = 0.0

			gross_sal = round(sal_basic_hrs + sal_ot_1_5 + sal_ot_2_0 + sal_ot_3_0 + sal_basic_sub + sal_perf + sal_post + sal_meal + sal_adj, 2)

			# 累计预扣个税计算
			cum_taxable = round(
				(prev_gross + gross_sal) - (prev_thresh + tax_threshold) - (prev_special_ded + person_special_ded) - (prev_add_ded + additional_ded),
				2
			)
			cum_tax = _get_annual_tax(cum_taxable)
			tax_amt = max(0.0, round(cum_tax - prev_tax_paid, 2))
			net_sal = round(gross_sal - person_special_ded - tax_amt, 2)

		person_cost = round(person_special_ded + tax_amt, 2)

		# 现金发放与配钞
		if emp_no in NO_CASH_EMPS or emp_type in ("兼职", "委托"):
			cash_wage = 0.0
			b100 = b50 = b10 = b5 = b1 = 0
		else:
			cash_wage = float(math.ceil(net_sal)) if net_sal > 0 else 0.0
			b100, b50, b10, b5, b1 = split_cash_bills(cash_wage)

		# 累加全局统计
		total_gross += gross_sal
		total_net += net_sal
		total_ss_comp += ss_comp
		total_ss_pers += ss_pers
		total_hf_comp += hf_comp
		total_hf_pers += hf_pers
		total_tax += tax_amt
		total_cash += cash_wage

		# 构建 Child Item
		doc.append("items", {
			"employee_no": emp_no,
			"employee_name": emp_name,
			"department": emp.department,
			"job_title": emp.job_title,
			"employee_type": employee_category,
			"salary_mode": salary_mode,
			"id_card": emp.id_card,
			"mobile": emp.mobile,
			"attendance_days": full_days,
			"half_days": half_days,
			"absent_days": absent_days,
			"work_hours": round(work_hrs, 1),
			"basic_hours": round(work_hrs, 1),
			"overtime_regular_1_5": round(ot_1_5, 1),
			"overtime_weekend_2_0": round(ot_2_0, 1),
			"overtime_holiday_3_0": round(ot_3_0, 1),
			"leave_compensatory_hours": round(leave_comp, 1),
			"meal_count": meal_cnt,
			"meal_unit_price": meal_unit_price,
			"base_salary": base_sal,
			"post_allowance": post_allow,
			"performance_salary": perf_base,
			"salary_basic_hours": sal_basic_hrs,
			"salary_overtime_1_5": sal_ot_1_5,
			"salary_overtime_2_0": sal_ot_2_0,
			"salary_overtime_3_0": sal_ot_3_0,
			"salary_basic_subsidy": sal_basic_sub,
			"salary_performance": sal_perf,
			"salary_post_allowance": sal_post,
			"salary_meal_subsidy": sal_meal,
			"salary_adjustment": sal_adj,
			"gross_salary": gross_sal,
			"ss_base": ss_base,
			"ss_person_total": ss_pers,
			"ss_company_total": ss_comp,
			"hf_base": hf_base,
			"hf_person_total": hf_pers,
			"hf_company_total": hf_comp,
			"special_deductions_total": additional_ded,
			"tax_threshold": tax_threshold,
			"taxable_income": max(0.0, round(gross_sal - tax_threshold - person_special_ded - additional_ded, 2)),
			"tax_amount": tax_amt,
			"net_salary": net_sal,
			"company_cost_total": company_cost,
			"person_cost_total": person_cost,
			"cash_pay": cash_wage,
			"bills_100": b100,
			"bills_50": b50,
			"bills_10": b10,
			"bills_5": b5,
			"bills_1": b1,
		})

	# 更新父表总额
	doc.total_employees = len(doc.items)
	doc.total_gross_salary = round(total_gross, 2)
	doc.total_net_salary = round(total_net, 2)
	doc.total_social_security_company = round(total_ss_comp, 2)
	doc.total_social_security_person = round(total_ss_pers, 2)
	doc.total_housing_fund_company = round(total_hf_comp, 2)
	doc.total_housing_fund_person = round(total_hf_pers, 2)
	doc.total_tax = round(total_tax, 2)
	doc.save()
	return {
		"success": True,
		"settlement_name": doc.name,
		"period_month": period_month,
		"total_employees": doc.total_employees,
		"total_gross_salary": doc.total_gross_salary,
		"total_net_salary": doc.total_net_salary,
		"total_tax": doc.total_tax,
		"total_cash": round(total_cash, 2),
	}


def _confirm_jizhong_workflow_step(company, period_month, step):
	"""Confirm one ready monthly source step and preserve an audit event."""
	workflow = get_jizhong_workflow_status(company=company, period_month=period_month)
	workflow_step = next(
		(item for item in workflow["steps"] if item.get("tab") == step),
		None,
	)
	if not workflow_step or not workflow_step.get("can_confirm"):
		frappe.throw(
			f"【{period_month}】{JIZHONG_STEP_LABELS[step]}尚不满足确认条件。"
		"请先完成当前步骤及其前置核验。"
		)

	doc = _get_jizhong_settlement_doc(company, period_month, create=True)
	if cint(doc.get("locked")):
		frappe.throw(f"【{period_month}】已核定封账，不能再确认步骤。")
	_record_jizhong_confirmation_event(doc, step, "confirm")
	return {
		"success": True,
		"step": step,
		"message": f"【{period_month}】{JIZHONG_STEP_LABELS[step]}已确认并进入只读保护。",
	}


def _cancel_jizhong_workflow_confirmation(company, period_month, step, reason):
	"""Cancel one confirmation in reverse order and invalidate derived data if needed."""
	reason = str(reason or "").strip()
	if len(reason) < 4:
		frappe.throw("取消确认必须填写明确原因（至少 4 个字符）。")
	doc = _get_jizhong_settlement_doc(company, period_month)
	if not doc:
		frappe.throw(f"【{period_month}】尚无确认记录，不能取消确认。")
	if cint(doc.get("locked")):
		frappe.throw(f"【{period_month}】已核定封账，请先按反审核解锁流程处理。")

	confirmations = _get_jizhong_confirmation_state(doc)
	if not confirmations[step]["confirmed"]:
		frappe.throw(f"【{period_month}】{JIZHONG_STEP_LABELS[step]}尚未确认，不能取消。")
	step_index = JIZHONG_CONFIRMATION_STEPS.index(step)
	downstream = [
		JIZHONG_STEP_LABELS[item]
		for item in JIZHONG_CONFIRMATION_STEPS[step_index + 1:]
		if confirmations[item]["confirmed"]
	]
	if downstream:
		frappe.throw(
			f"请先取消后续步骤的确认：{'、'.join(downstream)}，再取消"
			f"{JIZHONG_STEP_LABELS[step]}。"
		)

	if step in {"employees", "attendance", "insurance"}:
		_clear_jizhong_calculation(doc)
	_record_jizhong_confirmation_event(doc, step, "cancel", reason=reason)
	return {
		"success": True,
		"step": step,
		"message": (
			f"【{period_month}】{JIZHONG_STEP_LABELS[step]}已取消确认，可恢复修改。"
			+ ("已同步清除依赖的薪酬测算结果。" if step in {"employees", "attendance", "insurance"} else "")
		),
	}


@frappe.whitelist(methods=["POST"])
def lock_jizhong_monthly_payroll(company="天津吉众科技有限公司", period_month=None, step=None):
	"""Lock one Jizhong payroll period through the canonical payroll policy."""
	period_month = _normalize_jizhong_period(period_month)
	if step:
		step = _normalize_jizhong_confirmation_step(step)
		company = _assert_jizhong_access("write", company)
		assert_doctype_permission("Ashan Monthly Payroll Settlement", "write")
		return _confirm_jizhong_workflow_step(company, period_month, step)
	company = _assert_jizhong_access("lock", company)
	assert_doctype_permission("Ashan Monthly Payroll Settlement", "write")
	doc_name = f"{company}-{period_month}"
	if not frappe.db.exists("Ashan Monthly Payroll Settlement", doc_name):
		frappe.throw(f"未找到【{company}】{period_month} 的薪酬核算记录，无法执行封账！")
	doc = frappe.get_doc("Ashan Monthly Payroll Settlement", doc_name)
	if cint(doc.get("locked")):
		return {"success": True, "message": f"【{company}】{period_month} 已处于封账状态。"}
	workflow = get_jizhong_workflow_status(company=company, period_month=period_month)
	if not workflow.get("can_lock"):
		pending = [
			f"第 {step.get('step')} 步 {step.get('title')}（待确认）"
			for step in workflow.get("steps", [])
			if step.get("tab") in JIZHONG_CONFIRMATION_STEPS
			and not step.get("is_confirmed")
		]
		payroll_step = next(
			(step for step in workflow.get("steps", []) if step.get("tab") == "payroll"),
			None,
		)
		if payroll_step and not payroll_step.get("is_ready"):
			pending.append("月度工资核定表（待测算）")
		frappe.throw(
			f"【禁止封账】{period_month} 尚未完成前置任务：{ '、'.join(pending) or '薪酬计算状态' }。"
			"请完成前置任务后重试。"
		)
	doc.locked = 1
	doc.status = "已核定锁定"
	if hasattr(doc, "workflow_stage"):
		doc.workflow_stage = "已封账"
	if hasattr(doc, "confirmed_by"):
		doc.confirmed_by = frappe.session.user
	if hasattr(doc, "confirmed_date"):
		doc.confirmed_date = now_datetime()
	doc.save()
	return {"success": True, "message": f"【{company}】{period_month} 薪酬已成功核定并锁定（只读封账）！"}



@frappe.whitelist(methods=["POST"])
def unlock_jizhong_monthly_payroll(company="天津吉众科技有限公司", period_month=None, reason="", step=None):
	"""Unlock one Jizhong payroll period with a mandatory audit reason."""
	period_month = _normalize_jizhong_period(period_month)
	if step:
		step = _normalize_jizhong_confirmation_step(step)
		company = _assert_jizhong_access("write", company)
		assert_doctype_permission("Ashan Monthly Payroll Settlement", "write")
		return _cancel_jizhong_workflow_confirmation(company, period_month, step, reason)
	company = _assert_jizhong_access("unlock", company)
	assert_doctype_permission("Ashan Monthly Payroll Settlement", "write")
	reason = str(reason or "").strip()
	if len(reason) < 4:
		frappe.throw("解锁必须填写明确原因（至少 4 个字符）。")
	doc_name = f"{company}-{period_month}"
	if not frappe.db.exists("Ashan Monthly Payroll Settlement", doc_name):
		frappe.throw(f"未找到【{company}】{period_month} 的薪酬核算记录！")
	doc = frappe.get_doc("Ashan Monthly Payroll Settlement", doc_name)
	if not cint(doc.get("locked")):
		frappe.throw("当前账期尚未封账，不能执行解锁。")
	doc.locked = 0
	doc.status = "草稿"
	if hasattr(doc, "workflow_stage"):
		doc.workflow_stage = "已解锁"
	if hasattr(doc, "unlocked_by"):
		doc.unlocked_by = frappe.session.user
	if hasattr(doc, "unlock_reason"):
		doc.unlock_reason = reason
	doc.save()
	doc.add_comment("Comment", text=f"薪酬解锁：{reason}")
	return {"success": True, "message": f"【{company}】{period_month} 薪酬已成功解锁，可重新测算！"}


@frappe.whitelist()
def get_jizhong_workflow_status(company="天津吉众科技有限公司", period_month=None):
	"""
	获取吉众月度确认、测算与核定流程状态。
	1. 员工薪资信息表 (权威底册核实)
	2. 考勤工时与打卡底册 (工时、加班、倒休抵扣核实)
	3. 社保公积金配置 (年度费率生效核实)
	4. 个人所得税台账 (累计预扣与专项附加核实)
	5. 月度工资核定表 (全员薪资测算与封账锁定)
	6. 现金发放与配钞 (人工确认后方可最终核定)
	"""
	company = _assert_jizhong_access("read", company)
	assert_doctype_permission("Jizhong Employee Salary Profile", "read")
	assert_doctype_permission("Jizhong Monthly Attendance", "read")
	assert_doctype_permission("Ashan Insurance Setting", "read")
	assert_doctype_permission("Ashan Monthly Payroll Settlement", "read")
	if not period_month:
		period_month = today()[:7]
	period_month = _normalize_jizhong_period(period_month)

	year = cint(period_month.split("-")[0])
	month = cint(period_month.split("-")[1])
	period_label = f"{year}年{month:02d}月"
	settlement_doc = _get_jizhong_settlement_doc(company, period_month)
	confirmations = _get_jizhong_confirmation_state(settlement_doc)
	settlement = settlement_doc.as_dict() if settlement_doc else None
	is_locked = bool(settlement and settlement.get("locked"))

	# 1. 员工薪资信息表
	profile_rows = _jizhong_active_profiles(
		company,
		fields=[
			"employee_no", "employee_name", "employee_type", "employment_status",
			"social_security_base", "social_security_base_mode",
			"housing_fund_base", "housing_fund_base_mode", "housing_fund_policy",
		],
	)
	ins_setting = get_jizhong_insurance_setting(company=company, period_month=period_month)
	base_selection_issues = _jizhong_profiles_missing_base_selection(
		profile_rows, period_month, ins_setting
	)
	total_emps = len(profile_rows)
	category_counts = {}
	for row in profile_rows:
		category = _jizhong_employee_category(row.employee_type, row.employment_status)
		category_counts[category] = category_counts.get(category, 0) + 1
	regular_emps = category_counts.get("正式工", 0)
	rehire_emps = category_counts.get("退休返聘人员", 0)
	temp_emps = category_counts.get("临时工", 0)
	other_emps = category_counts.get("其他类型员工", 0)
	step1_ready = total_emps > 0 and not base_selection_issues
	step1_confirmed = confirmations["employees"]["confirmed"]
	step1 = {
		"step": 1,
		"title": "员工薪资信息表",
		"tag": "权威底册",
		"status": "confirmed" if step1_confirmed else ("ready" if step1_ready else "pending"),
		"badge": "已确认" if step1_confirmed else ("待确认" if step1_ready else "待完善"),
		"main": (
			f"{total_emps} 人在册 · 档案完整"
			if step1_ready
			else ("；".join(base_selection_issues) if base_selection_issues else "暂无员工档案")
		),
		"sub": (
			f"正式工 {regular_emps}人 ｜ 退休返聘 {rehire_emps}人 ｜ "
			f"临时工 {temp_emps}人 ｜ 其他类型 {other_emps}人"
		),
		"tab": "employees",
		"is_ready": step1_ready,
		"is_confirmed": step1_confirmed,
		"confirmed_by": confirmations["employees"]["confirmed_by"],
		"confirmed_at": confirmations["employees"]["confirmed_at"],
	}

	# 2. 考勤工时与打卡底册
	att_records = frappe.db.sql("""
		SELECT COUNT(*) as cnt,
		       SUM(work_hours_regular) as reg_hrs,
		       SUM(overtime_regular_1_5 + overtime_weekend_2_0 + overtime_holiday_3_0) as ot_hrs,
		       MAX(attendance_file) as att_file
		FROM `tabJizhong Monthly Attendance`
		WHERE company = %s AND period_month = %s
	""", (company, period_month), as_dict=True)[0]
	att_cnt = cint(att_records.get("cnt") or 0)
	reg_hrs = flt(att_records.get("reg_hrs") or 0)
	ot_hrs = flt(att_records.get("ot_hrs") or 0)
	coverage = _get_jizhong_attendance_coverage(company, period_month)
	step2_ready = bool(coverage.get("complete"))
	step2_confirmed = confirmations["attendance"]["confirmed"]
	excluded_attendance_note = (
		f"另有 {coverage.get('excluded_count', 0)} 人无需上传考勤（固定税后管理工资）"
		if coverage.get("excluded_count")
		else ""
	)
	step2 = {
		"step": 2,
		"title": "考勤工时与打卡底册",
		"tag": "打卡底册",
		"status": "confirmed" if step2_confirmed else ("ready" if step2_ready else "pending"),
		"badge": "已确认" if step2_confirmed else ("待确认" if step2_ready else "待补齐"),
		"main": (
			f"已匹配 {coverage['matched_count']} / {coverage['expected_count']} 人 · "
			f"{round(reg_hrs + ot_hrs, 1)}h"
			if step2_ready else
			f"应计薪 {coverage['expected_count']} 人，已匹配 {coverage['matched_count']} 人"
		),
		"sub": (
			f"正班 {round(reg_hrs, 1)}h ｜ 加班 {round(ot_hrs, 1)}h"
			+ (f" ｜ {excluded_attendance_note}" if excluded_attendance_note else "")
			if step2_ready else
			f"缺失工号：{'、'.join(coverage['missing_employee_nos']) or '无'}；"
			f"多余/重复/异常需先修正"
			+ (f"；{excluded_attendance_note}" if excluded_attendance_note else "")
		),
		"tab": "attendance",
		"is_ready": step2_ready,
		"is_confirmed": step2_confirmed,
		"confirmed_by": confirmations["attendance"]["confirmed_by"],
		"confirmed_at": confirmations["attendance"]["confirmed_at"],
	}

	# 3. 社保公积金配置 (按月动态核验与继承提示)
	configuration_errors = _jizhong_insurance_setting_errors(ins_setting)
	step3_ready = not configuration_errors
	step3_confirmed = confirmations["insurance"]["confirmed"]
	payment_period = _compute_next_period(period_month)
	current_big_medical = resolve_big_medical_amount(
		ins_setting,
		payment_period_month=payment_period,
	)
	ss_person_rate = (
		flt(ins_setting.get("ss_person_pension"))
		+ flt(ins_setting.get("ss_person_medical"))
		+ flt(ins_setting.get("ss_person_unemployment"))
	)
	if configuration_errors:
		step3_main = f"{period_month} 社保公积金配置待完善"
		step3_sub = "；".join(configuration_errors)
	elif ins_setting.get("is_inherited"):
		step3_main = f"{period_month} 待确认月度费率"
		step3_sub = (
			f"实际缴费期 {payment_period} ｜ 个人社保 {ss_person_rate:.2f}% + "
			f"大额医疗 {current_big_medical:.2f} 元 ｜ 继承自 {ins_setting.get('inherited_from')}"
		)
	elif ins_setting.get("configuration_source") == "system_default":
		step3_main = f"未找到 {period_month} 费率配置"
		step3_sub = "系统默认值仅用于展示，请保存本月实际费率后再核算"
	else:
		step3_main = f"{period_month} 专属费率已保存"
		step3_sub = (
			f"实际缴费期 {payment_period} ｜ 个人社保 {ss_person_rate:.2f}% + "
			f"大额医疗 {current_big_medical:.2f} 元 ｜ 公积金个人 {flt(ins_setting.get('hf_person_rate')):.2f}%"
		)

	step3 = {
		"step": 3,
		"title": "社保公积金配置",
		"tag": "费率基数",
		"status": "confirmed" if step3_confirmed else ("ready" if step3_ready else "pending"),
		"badge": "已确认" if step3_confirmed else ("待确认" if step3_ready else "待配置"),
		"main": step3_main,
		"sub": step3_sub,
		"tab": "insurance",
		"is_ready": step3_ready,
		"is_confirmed": step3_confirmed,
		"confirmed_by": confirmations["insurance"]["confirmed_by"],
		"confirmed_at": confirmations["insurance"]["confirmed_at"],
	}
	insurance_sheets = _build_jizhong_insurance_confirmation_sheets(
		company,
		period_month,
		ins_setting,
		employees_confirmed=step1_confirmed,
		insurance_confirmed=step3_confirmed,
	)

	calculated_stages = {"已计算", "凭证核验通过", "已封账", "已解锁"}
	step4_ready = bool(
		settlement
		and settlement.get("workflow_stage") in calculated_stages
		and cint(settlement.get("total_employees")) == total_emps
	)
	step4_confirmed = confirmations["tax"]["confirmed"]
	step4 = {
		"step": 4,
		"title": "个人所得税台账",
		"tag": "累计预扣",
		"status": "confirmed" if step4_confirmed else ("ready" if step4_ready else "pending"),
		"badge": "已确认" if step4_confirmed else ("待确认" if step4_ready else "待同步"),
		"main": f"本月明细 {cint(settlement.get('total_employees')) if settlement else 0} 人 · 累计预扣已计算" if step4_ready else "本月个税明细尚未完成计算",
		"sub": f"7级累计预扣算法 ｜ 基本减除费用 {flt(ins_setting.get('tax_threshold')):,.2f} 元/月",
		"tab": "tax",
		"is_ready": step4_ready,
		"is_confirmed": step4_confirmed,
		"confirmed_by": confirmations["tax"]["confirmed_by"],
		"confirmed_at": confirmations["tax"]["confirmed_at"],
	}

	# 5. 月度工资核定表
	has_calc = step4_ready
	if is_locked:
		step5_badge = "已封账"
		step5_main = f"已核定封账 · {settlement.get('total_employees')}人"
		step5_sub = f"实发 ¥{flt(settlement.get('total_net_salary')):,.2f} ｜ 只读受控"
		overall_status_text = "已核定锁定 (只读封账)"
		overall_status_class = "jz-status-locked"
	elif has_calc and step4_confirmed and confirmations["cash_bills"]["confirmed"]:
		step5_badge = "可核定"
		step5_main = "已完成测算 · 前置已确认"
		step5_sub = f"应发 ¥{flt(settlement.get('total_gross_salary')):,.2f} ｜ 实发 ¥{flt(settlement.get('total_net_salary')):,.2f}"
		overall_status_text = "待最终核定（前置步骤已全部确认）"
		overall_status_class = "jz-status-ready"
	elif has_calc:
		step5_badge = "待确认"
		step5_main = "已完成测算 · 等待个税与现金确认"
		step5_sub = f"应发 ¥{flt(settlement.get('total_gross_salary')):,.2f} ｜ 实发 ¥{flt(settlement.get('total_net_salary')):,.2f}"
		overall_status_text = "草稿状态（待确认）"
		overall_status_class = "jz-status-draft"
	else:
		step5_badge = "待测算"
		step5_main = "尚未测算薪酬"
		step5_sub = "前置资料确认后可一键重新计算"
		overall_status_text = "草稿状态（待确认）"
		overall_status_class = "jz-status-draft"

	step5 = {
		"step": 5,
		"title": "月度工资核定表",
		"tag": "薪酬终审",
		"status": "locked" if is_locked else ("ready" if has_calc else "pending"),
		"badge": step5_badge,
		"main": step5_main,
		"sub": step5_sub,
		"tab": "payroll",
		"is_ready": has_calc,
		"is_confirmed": is_locked,
		"confirmed_by": settlement.get("confirmed_by") if settlement else None,
		"confirmed_at": settlement.get("confirmed_date") if settlement else None,
	}

	step6_ready = has_calc
	step6_confirmed = confirmations["cash_bills"]["confirmed"]
	step6 = {
		"step": 6,
		"title": "现金发放与配钞",
		"tag": "现金发放",
		"status": "confirmed" if step6_confirmed else ("ready" if step6_ready else "pending"),
		"badge": "已确认" if step6_confirmed else ("待确认" if step6_ready else "待生成"),
		"main": (
			f"现金发放 ¥{flt(settlement.get('total_net_salary')):,.2f} · 配钞明细已生成"
			if step6_ready else "本月现金配钞明细尚未生成"
		),
		"sub": "五档人民币配钞与工资条签收清单",
		"tab": "cash_bills",
		"is_ready": step6_ready,
		"is_confirmed": step6_confirmed,
		"confirmed_by": confirmations["cash_bills"]["confirmed_by"],
		"confirmed_at": confirmations["cash_bills"]["confirmed_at"],
	}

	ordered_steps = [step1, step2, step3, step4, step5, step6]
	confirmed_steps = {
		item["tab"]: item["is_confirmed"]
		for item in ordered_steps
		if item["tab"] in JIZHONG_CONFIRMATION_STEPS
	}
	for item in ordered_steps:
		tab = item["tab"]
		if tab not in JIZHONG_CONFIRMATION_STEPS:
			continue
		step_index = JIZHONG_CONFIRMATION_STEPS.index(tab)
		dependencies = JIZHONG_CONFIRMATION_STEPS[:step_index]
		downstream = JIZHONG_CONFIRMATION_STEPS[step_index + 1:]
		item["can_confirm"] = bool(
			item["is_ready"]
			and not item["is_confirmed"]
			and not is_locked
			and all(confirmed_steps[dependency] for dependency in dependencies)
		)
		item["can_unconfirm"] = bool(
			item["is_confirmed"]
			and not is_locked
			and not any(confirmed_steps[dependent] for dependent in downstream)
		)

	return {
		"success": True,
		"period_month": period_month,
		"period_label": period_label,
		"overall_status_text": overall_status_text,
		"overall_status_class": overall_status_class,
		"is_locked": is_locked,
		"insurance_sheets": insurance_sheets,
		"can_calculate": bool(
			step1_ready and step2_ready and step3_ready
			and step1_confirmed and step2_confirmed and step3_confirmed and not is_locked
			and not step4_confirmed and not step6_confirmed
		),
		"can_lock": bool(
			step1_ready and step2_ready and step3_ready
			and step1_confirmed and step2_confirmed and step3_confirmed
			and step4_confirmed and step6_confirmed and has_calc and not is_locked
		),
		"steps": ordered_steps,
	}


def _get_jizhong_tax_history(company, current_period, tax_cycle_start_month=12):
	"""
	从以往已归档/核定的结算单或历史数据中，提取该税收周期内的累计发生数
	"""
	current_period = _normalize_jizhong_period(current_period)
	curr_year = cint(current_period.split("-")[0])
	curr_month = cint(current_period.split("-")[1])
	tax_cycle_start_month = cint(tax_cycle_start_month) or 12
	if tax_cycle_start_month < 1 or tax_cycle_start_month > 12:
		frappe.throw("个税累计申报周期起始月必须为 1 至 12 月。")

	# 确定周期包含的历史月份列表
	months_in_cycle = []
	if curr_month >= tax_cycle_start_month:
		cycle_year = curr_year
		cycle_months = range(tax_cycle_start_month, curr_month)
		months_in_cycle.extend(
			f"{cycle_year:04d}-{month:02d}" for month in cycle_months
		)
	else:
		previous_year = curr_year - 1
		months_in_cycle.extend(
			f"{previous_year:04d}-{month:02d}"
			for month in range(tax_cycle_start_month, 13)
		)
		months_in_cycle.extend(
			f"{curr_year:04d}-{month:02d}" for month in range(1, curr_month)
		)

	if not months_in_cycle:
		return {}

	# 查询历史月度账单
	items = frappe.db.sql(
		"""
		SELECT
			pi.employee_no,
			SUM(pi.gross_salary) as prev_gross,
			SUM(IFNULL(pi.tax_threshold, 5000)) as prev_thresh,
			SUM(pi.ss_person_total + pi.hf_person_total) as prev_special_ded,
			SUM(pi.special_deductions_total) as prev_add_ded,
			SUM(pi.tax_amount) as prev_tax_paid
		FROM `tabAshan Monthly Payroll Item` pi
		JOIN `tabAshan Monthly Payroll Settlement` ps ON pi.parent = ps.name
		WHERE ps.company = %s
		  AND ps.period_month IN %s
		  AND (
			ps.locked = 1
			OR ps.status IN ('已核定锁定', '已归档发放')
			OR ps.workflow_stage = '已封账'
		  )
		GROUP BY pi.employee_no
		ORDER BY pi.employee_no ASC
		""",
		(company, tuple(months_in_cycle)),
		as_dict=True
	)

	return {it.employee_no: it for it in items}


@frappe.whitelist()
def get_jizhong_payroll_overview(company="天津吉众科技有限公司", period_month=None):
	"""
	获取指定期间吉众薪酬大宽表、现金配钞、个税明细等完整数据
	"""
	company = _assert_jizhong_access("read", company)
	assert_doctype_permission("Ashan Monthly Payroll Settlement", "read")
	if not period_month:
		latest = frappe.db.get_value(
			"Ashan Monthly Payroll Settlement",
			{"company": company},
			"period_month",
			order_by="period_month desc"
		)
		period_month = latest or getdate().strftime("%Y-%m")
	period_month = _normalize_jizhong_period(period_month)

	doc_name = f"{company}-{period_month}"
	if not frappe.db.exists("Ashan Monthly Payroll Settlement", doc_name):
		return {"settlement": None, "items": []}

	doc = frappe.get_doc("Ashan Monthly Payroll Settlement", doc_name)
	items = [it.as_dict() for it in doc.items]

	# 计算配钞汇总
	bill_summary = {
		"total_cash": sum(flt(it.get("cash_pay", 0)) for it in items),
		"bills_100": sum(cint(it.get("bills_100", 0)) for it in items),
		"bills_50": sum(cint(it.get("bills_50", 0)) for it in items),
		"bills_10": sum(cint(it.get("bills_10", 0)) for it in items),
		"bills_5": sum(cint(it.get("bills_5", 0)) for it in items),
		"bills_1": sum(cint(it.get("bills_1", 0)) for it in items),
	}

	return {
		"settlement": doc.as_dict(),
		"items": items,
		"bill_summary": bill_summary,
	}


@frappe.whitelist()
def get_jizhong_history_records(company="天津吉众科技有限公司", period_month=None):
	"""
	获取吉众历史薪酬记录 (支持全部或按账期过滤，穿透 child table)
	"""
	company = _assert_jizhong_access("read", company)
	assert_doctype_permission("Ashan Monthly Payroll Settlement", "read")
	if period_month and period_month != "ALL":
		period_month = _normalize_jizhong_period(period_month)
	cond = "ps.company = %s"
	params = [company]
	if period_month and period_month != "ALL":
		cond += " AND ps.period_month = %s"
		params.append(period_month)

	items = frappe.db.sql(
		f"""
		SELECT
			pi.*,
			ps.period_month
		FROM `tabAshan Monthly Payroll Item` pi
		JOIN `tabAshan Monthly Payroll Settlement` ps ON pi.parent = ps.name
		WHERE {cond}
		  AND (
			ps.locked = 1
			OR ps.status IN ('已核定锁定', '已归档发放')
			OR ps.workflow_stage = '已封账'
		  )
		ORDER BY ps.period_month DESC, pi.employee_no ASC
		LIMIT 1000
		""",
		tuple(params),
		as_dict=True
	)
	return items


def _compute_prev_period(period_month):
	period_month = _normalize_jizhong_period(period_month)
	y, m = [int(x) for x in period_month.split("-")]
	if m == 1:
		return f"{y - 1:04d}-12"
	return f"{y:04d}-{m - 1:02d}"


def _compute_next_period(period_month):
	"""Return the next calendar month for the payment-period boundary."""
	period_month = _normalize_jizhong_period(period_month)
	y, m = [int(x) for x in period_month.split("-")]
	if m == 12:
		return f"{y + 1:04d}-01"
	return f"{y:04d}-{m + 1:02d}"


@frappe.whitelist()
def get_jizhong_workbench_init(company="天津吉众科技有限公司"):
	"""
	获取吉众工作台初始化上下文与默认核算账期。
	业务铁律：若最新月份已核定封账，进入默认显示即将开始的下一个月（如 6 月已封账，默认显示 7 月）。
	"""
	company = _assert_jizhong_access("read", company)
	assert_doctype_permission("Ashan Monthly Payroll Settlement", "read")
	latest_locked = frappe.db.sql("""
		SELECT period_month FROM `tabAshan Monthly Payroll Settlement`
		WHERE company = %s AND (locked = 1 OR status IN ('已核定锁定', '已归档发放'))
		ORDER BY period_month DESC
		LIMIT 1
	""", (company,), as_dict=True)

	if latest_locked and latest_locked[0].get("period_month"):
		last_m = _normalize_jizhong_period(latest_locked[0]["period_month"])
		default_period = _compute_next_period(last_m)
		latest_locked_month = last_m
	else:
		today_str = today()
		y, m = [int(x) for x in today_str[:7].split("-")]
		default_period = _compute_prev_period(f"{y:04d}-{m:02d}")
		latest_locked_month = None

	return {
		"company": company,
		"default_period": default_period,
		"latest_locked": latest_locked_month,
		"can_configure": bool(can_module_access("payroll", "configure")),
	}


@frappe.whitelist()
def get_jizhong_insurance_setting(company="天津吉众科技有限公司", period_month=None, year=None):
	"""
	获取吉众专属社保公积金设置。
	业务铁律：公积金、社保可能每个月比例不同。
	1. 优先获取当前月份 period_month 的配置（如 天津吉众科技有限公司-2026-07）；
	2. 若当前月份未单独配置，则默认载入上个月的配置（如 2026-06），并标记为继承自上月；
	3. 若上月亦不存在，则载入年度基准配置（如 2026）；
	4. 本月核定保存后，存为本月专属记录。
	"""
	company = _assert_jizhong_access("read", company)
	assert_doctype_permission("Ashan Insurance Setting", "read")
	if not period_month and year:
		period_month = f"{cint(year)}-01"
	elif not period_month:
		period_month = today()[:7]
	period_month = _normalize_jizhong_period(period_month)

	exact_doc_name = f"{company}-{period_month}"

	# 1. 优先查本月精确配置
	if frappe.db.exists("Ashan Insurance Setting", exact_doc_name):
		doc = frappe.get_doc("Ashan Insurance Setting", exact_doc_name)
		d = doc.as_dict()
		d["is_inherited"] = False
		d["is_configured"] = True
		d["configuration_source"] = "monthly"
		d["inherited_from"] = None
		d["period_month"] = period_month
		return d

	# 2. 默认载入上个月的配置
	prev_month = _compute_prev_period(period_month)
	source_doc = None
	inherited_from = None

	if prev_month:
		prev_doc_name = f"{company}-{prev_month}"
		if frappe.db.exists("Ashan Insurance Setting", prev_doc_name):
			source_doc = frappe.get_doc("Ashan Insurance Setting", prev_doc_name)
			inherited_from = prev_month

	if not source_doc:
		year_doc_name = f"{company}-{period_month[:4]}"
		if frappe.db.exists("Ashan Insurance Setting", year_doc_name):
			source_doc = frappe.get_doc("Ashan Insurance Setting", year_doc_name)
			inherited_from = f"{period_month[:4]}年度基准"
		else:
			latest = frappe.get_list(
				"Ashan Insurance Setting",
				filters={"company": company},
				fields=["name", "period_month", "effective_year"],
				order_by="creation desc, name desc",
				limit_page_length=1,
			)
			if latest:
				source_doc = frappe.get_doc("Ashan Insurance Setting", latest[0]["name"])
				inherited_from = source_doc.name

	# 如果找到了源配置，克隆其费率作为本月默认待定配置
	if source_doc:
		d = source_doc.as_dict()
		d["name"] = exact_doc_name
		d["period_month"] = period_month
		d["effective_year"] = cint(period_month[:4])
		d["is_inherited"] = True
		d["is_configured"] = False
		d["configuration_source"] = "previous_period" if inherited_from == prev_month else "annual"
		d["inherited_from"] = inherited_from
		return d

	# 4. 全局兜底：GET/read 只返回默认值，不在读取过程中创建数据库记录。
	return frappe._dict({
		"name": exact_doc_name,
		"company": company,
		"period_month": period_month,
		"effective_year": cint(period_month[:4]),
		**JIZHONG_INSURANCE_DEFAULTS,
		"is_inherited": False,
		"is_configured": False,
		"configuration_source": "system_default",
		"inherited_from": None,
	})


@frappe.whitelist(methods=["POST"])
def update_jizhong_insurance_setting(company="天津吉众科技有限公司", period_month=None, values=None, year=None):
	"""
	保存吉众专属社保公积金设置。
	业务铁律：本月核定完保存为本月的配置（如 天津吉众科技有限公司-2026-07）。
	"""
	company = _assert_jizhong_access("write", company)
	if not can_module_access("payroll", "configure"):
		frappe.throw("社保、公积金和个税基础参数仅 Payroll Manager 可以修改。", frappe.PermissionError)
	assert_doctype_permission("Ashan Insurance Setting", "write")
	import json
	if isinstance(values, str):
		try:
			values = json.loads(values)
		except (TypeError, ValueError, json.JSONDecodeError):
			frappe.throw("社保、公积金配置格式无效，请重新提交。")
	if values is not None and not isinstance(values, dict):
		frappe.throw("社保、公积金配置必须是对象。")
	if not period_month and year:
		period_month = f"{cint(year)}-01"
	elif not period_month:
		period_month = today()[:7]
	period_month = _normalize_jizhong_period(period_month)
	assert_jizhong_workflow_step_editable(company, period_month, "insurance")

	doc_name = f"{company}-{period_month}"

	if frappe.db.exists("Ashan Insurance Setting", doc_name):
		doc = frappe.get_doc("Ashan Insurance Setting", doc_name)
	else:
		doc = frappe.new_doc("Ashan Insurance Setting")
		doc.name = doc_name
		doc.company = company
		doc.period_month = period_month
		doc.effective_year = cint(period_month[:4])
		inherited = get_jizhong_insurance_setting(company=company, period_month=period_month)
		for fieldname, default in JIZHONG_INSURANCE_DEFAULTS.items():
			if doc.meta.has_field(fieldname):
				setattr(doc, fieldname, inherited.get(fieldname, default))

	if values:
		unknown_fields = set(values) - INSURANCE_VALUE_FIELDS
		if unknown_fields:
			frappe.throw(f"配置包含不支持的字段：{'、'.join(sorted(unknown_fields))}。")
		for fieldname, value in values.items():
			if fieldname in {"big_medical_special_months", "hf_contribution_months", "hf_off_month_action"}:
				setattr(doc, fieldname, str(value or "").strip())
			else:
				setattr(doc, fieldname, flt(value))

	if flt(doc.tax_threshold) <= 0:
		frappe.throw("个税基本减除费用必须大于 0 元/月。")
	if flt(doc.ss_min_base) <= 0:
		frappe.throw("社保最低缴费基数必须大于 0 元。")
	if flt(doc.hf_min_base) <= 0:
		frappe.throw("公积金最低缴费基数必须大于 0 元。")
	if flt(doc.big_medical_amount_default) < 0 or flt(doc.big_medical_amount_special) < 0:
		frappe.throw("大额医疗金额不能为负数。")
	cycle_start_month = cint(doc.tax_cycle_start_month)
	if cycle_start_month < 1 or cycle_start_month > 12:
		frappe.throw("个税累计申报周期起始月必须为 1 至 12 月。")
	doc.company = company
	doc.period_month = period_month
	doc.effective_year = cint(period_month[:4])

	doc.save()
	setting = doc.as_dict()
	setting.update({"is_configured": True, "configuration_source": "monthly", "is_inherited": False})
	return {"success": True, "message": f"【{company}】{period_month} 社保公积金费率已成功保存并生效！", "setting": setting}


@frappe.whitelist()
def get_jizhong_employee_profiles(company="天津吉众科技有限公司", period_month=None):
	"""获取吉众员工薪酬档案，并返回当前核算月的有效社保公积金基数。"""
	company = _assert_jizhong_access("read", company)
	assert_doctype_permission("Jizhong Employee Salary Profile", "read")
	period_month = _normalize_jizhong_period(period_month, required=False)
	insurance_setting = get_jizhong_insurance_setting(company=company, period_month=period_month)
	fields = [
		"name", "employee_no", "employee_name", "company", "employee_type", "employment_status",
		"certificate_type", "salary_mode", "fixed_salary", "base_salary", "house_rent_allowance", "post_allowance", "performance_base",
		"meal_allowance", "social_security_base", "social_security_base_mode", "custom_social_security_base",
		"housing_fund_base", "housing_fund_base_mode", "custom_housing_fund_base", "housing_fund_policy", "id_card", "mobile", "gender", "birth_date",
		"department", "job_title", "deduction_child_education", "deduction_continuing_education",
		"deduction_serious_illness", "deduction_housing_loan", "deduction_housing_rent",
		"deduction_elderly_care", "deduction_infant_care", "special_additional_deductions_total",
		"bank_name", "bank_account", "notes"
	]
	profile_doctype = _jizhong_profile_doctype()
	rows = frappe.get_list(
		profile_doctype,
		filters={"company": company},
		fields=fields,
		order_by="employee_no asc",
		limit_page_length=0,
	)
	return [_apply_jizhong_effective_bases(row, insurance_setting) for row in rows]


@frappe.whitelist(methods=["POST"])
def save_jizhong_employee_profile(data=None):
	"""保存或更新吉众员工薪酬档案"""
	import json
	if isinstance(data, str):
		try:
			data = json.loads(data)
		except (TypeError, ValueError, json.JSONDecodeError):
			frappe.throw("员工档案格式无效，请重新提交。")
	if not data or not isinstance(data, dict):
		frappe.throw("无效的员工档案数据")

	company = data.get("company") or "天津吉众科技有限公司"
	company = _assert_jizhong_access("write", company)
	assert_doctype_permission("Jizhong Employee Salary Profile", "write")
	period_month = data.get("period_month")
	if period_month:
		assert_jizhong_workflow_step_editable(company, period_month, "employees")

	emp_no = (data.get("employee_no") or "").strip()
	emp_name = (data.get("employee_name") or "").strip()
	if not emp_no or not emp_name:
		frappe.throw("工号和姓名不能为空")

	doc_name = data.get("name")
	is_new_profile = False
	if not doc_name:
		doc_name = f"{company}-{emp_no}-{emp_name}"

	if frappe.db.exists("Jizhong Employee Salary Profile", doc_name):
		doc = frappe.get_doc("Jizhong Employee Salary Profile", doc_name)
		if str(doc.company or "").strip() != company:
			frappe.throw("不能跨公司修改吉众员工薪资档案。", frappe.PermissionError)
	elif frappe.db.exists("Jizhong Employee Salary Profile", {"company": company, "employee_no": emp_no}):
		exist_name = frappe.db.get_value("Jizhong Employee Salary Profile", {"company": company, "employee_no": emp_no}, "name")
		doc = frappe.get_doc("Jizhong Employee Salary Profile", exist_name)
	else:
		doc = frappe.new_doc("Jizhong Employee Salary Profile")
		is_new_profile = True
		doc.company = company
		doc.employee_no = emp_no
		doc.employee_name = emp_name

	# 更新基础字段
	doc.employee_name = emp_name
	doc.certificate_type = (data.get("certificate_type") or "居民身份证").strip()
	doc.id_card = (data.get("id_card") or "").strip()
	doc.mobile = (data.get("mobile") or "").strip()
	doc.gender = data.get("gender") or ""
	doc.birth_date = data.get("birth_date") or None
	doc.department = data.get("department") or "生产车间"
	doc.job_title = data.get("job_title") or "操作工"
	doc.employee_type = data.get("employee_type") or "正式工"
	doc.employment_status = data.get("employment_status") or "在职"
	doc.salary_mode = data.get("salary_mode") or "税前动态工资"

	# 金额与基数
	doc.fixed_salary = flt(data.get("fixed_salary"))
	doc.base_salary = flt(data.get("base_salary"))
	doc.house_rent_allowance = flt(data.get("house_rent_allowance"))
	doc.performance_base = flt(data.get("performance_base"))
	doc.post_allowance = flt(data.get("post_allowance"))
	doc.meal_allowance = flt(data.get("meal_allowance") or 15.0)
	ss_mode = data.get("social_security_base_mode")
	if ss_mode in (None, "") and "social_security_base" in data:
		ss_mode = JIZHONG_BASE_MODE_CUSTOM
	if ss_mode in (None, "") and is_new_profile:
		frappe.throw("新建员工档案必须选择社险申报基数方式。")
	if ss_mode not in (None, ""):
		doc.social_security_base_mode = _normalize_jizhong_base_mode(ss_mode, "社险申报基数")
	if doc.social_security_base_mode == JIZHONG_BASE_MODE_CUSTOM:
		ss_value = data.get("custom_social_security_base")
		if ss_value in (None, "") and "social_security_base" in data:
			ss_value = data.get("social_security_base")
		if ss_value in (None, ""):
			ss_value = getattr(doc, "custom_social_security_base", 0)
		ss_value = flt(ss_value)
		if ss_value < 0:
			frappe.throw("自定义社险缴费基数不能为负数。")
		doc.custom_social_security_base = round(ss_value, 2)
		doc.social_security_base = doc.custom_social_security_base
	elif doc.social_security_base_mode == JIZHONG_BASE_MODE_MINIMUM:
		doc.custom_social_security_base = 0
		doc.social_security_base = 0

	hf_mode = data.get("housing_fund_base_mode")
	if hf_mode in (None, "") and "housing_fund_base" in data:
		hf_mode = JIZHONG_BASE_MODE_CUSTOM
	if hf_mode in (None, "") and is_new_profile:
		frappe.throw("新建员工档案必须选择公积金申报基数方式。")
	if hf_mode not in (None, ""):
		doc.housing_fund_base_mode = _normalize_jizhong_base_mode(hf_mode, "公积金申报基数")
	if doc.housing_fund_base_mode == JIZHONG_BASE_MODE_CUSTOM:
		hf_value = data.get("custom_housing_fund_base")
		if hf_value in (None, "") and "housing_fund_base" in data:
			hf_value = data.get("housing_fund_base")
		if hf_value in (None, ""):
			hf_value = getattr(doc, "custom_housing_fund_base", 0)
		hf_value = flt(hf_value)
		if hf_value < 0:
			frappe.throw("自定义公积金缴费基数不能为负数。")
		doc.custom_housing_fund_base = round(hf_value, 2)
		doc.housing_fund_base = doc.custom_housing_fund_base
	elif doc.housing_fund_base_mode == JIZHONG_BASE_MODE_MINIMUM:
		doc.custom_housing_fund_base = 0
		doc.housing_fund_base = 0
	doc.housing_fund_policy = str(
		data.get("housing_fund_policy") or getattr(doc, "housing_fund_policy", "跟随公司规则")
	).strip()
	if doc.housing_fund_policy not in {"跟随公司规则", "固定缴纳", "固定停缴"}:
		frappe.throw("公积金长期缴纳策略无效，请选择跟随公司规则、固定缴纳或固定停缴。")

	# 7 项专项附加扣除
	doc.deduction_child_education = flt(data.get("deduction_child_education"))
	doc.deduction_continuing_education = flt(data.get("deduction_continuing_education"))
	doc.deduction_serious_illness = flt(data.get("deduction_serious_illness"))
	doc.deduction_housing_loan = flt(data.get("deduction_housing_loan"))
	doc.deduction_housing_rent = flt(data.get("deduction_housing_rent"))
	doc.deduction_elderly_care = flt(data.get("deduction_elderly_care"))
	doc.deduction_infant_care = flt(data.get("deduction_infant_care"))
	doc.special_additional_deductions_total = (
		doc.deduction_child_education + doc.deduction_continuing_education +
		doc.deduction_serious_illness + doc.deduction_housing_loan +
		doc.deduction_housing_rent + doc.deduction_elderly_care + doc.deduction_infant_care
	)

	# 银行卡与备注
	doc.bank_name = data.get("bank_name") or ""
	doc.bank_account = data.get("bank_account") or ""
	doc.notes = data.get("notes") or ""

	doc.save()
	return {"success": True, "message": f"员工 {emp_name} ({emp_no}) 档案已成功保存", "profile": doc.as_dict()}

