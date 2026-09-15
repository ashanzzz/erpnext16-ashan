# Copyright (c) 2026, Ashan and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import flt




def _split_aliases(value):
	import re
	result = []
	seen = set()
	for raw in re.split(r"[,，;；/、\n\r]+", str(value or "")):
		alias = str(raw or "").strip()
		key = alias.lower().replace(" ", "")
		if alias and key not in seen:
			seen.add(key)
			result.append(alias)
	return result


def _sync_employee_name_aliases(doc):
	"""Keep the structured alias child table authoritative while mirroring legacy text.

	Existing V3/V4/V5 records may only have ``external_name_aliases``. The first save
	migrates those values into the child table. Once child rows have existed, clearing
	them is treated as an intentional removal and the legacy mirror is cleared too.
	"""
	current_rows = list(doc.get("name_aliases") or [])
	previous_child_count = 0
	if not doc.is_new() and doc.name:
		try:
			previous_child_count = frappe.db.count("Ashan Employee Name Alias", {"parent": doc.name})
		except Exception:
			previous_child_count = 0

	aliases = []
	notes = {}
	if current_rows:
		for row in current_rows:
			name = str(row.get("alias_name") or "").strip()
			if name:
				aliases.append(name)
				notes[name.lower().replace(" ", "")] = str(row.get("alias_note") or "").strip()
	elif previous_child_count <= 0:
		aliases = _split_aliases(doc.get("external_name_aliases"))

	primary_key = str(doc.employee_name or "").strip().lower().replace(" ", "")
	cleaned = []
	seen = set()
	for alias in aliases:
		key = alias.lower().replace(" ", "")
		if not key or key == primary_key or key in seen:
			continue
		seen.add(key)
		cleaned.append(alias)

	doc.set("name_aliases", [])
	for alias in cleaned:
		doc.append("name_aliases", {
			"alias_name": alias,
			"alias_note": notes.get(alias.lower().replace(" ", ""), ""),
		})
	doc.external_name_aliases = "\n".join(cleaned)


def _validate_alias_uniqueness(doc):
	"""Reject aliases that would make an external-payroll match ambiguous inside a company."""
	if not doc.company:
		return
	for row in list(doc.get("name_aliases") or []):
		alias = str(row.get("alias_name") or "").strip()
		if not alias:
			continue
		primary_matches = frappe.get_all(
			"Ashan Employee Salary Profile",
			filters={"company": doc.company, "employee_name": alias},
			fields=["name", "employee_no", "employee_name"],
			limit=2,
		)
		for match in primary_matches:
			if match.name != doc.name:
				frappe.throw(f"姓名别名【{alias}】与员工 {match.employee_no} {match.employee_name} 的正式姓名重复，请改用更明确的外部称谓。")
		try:
			alias_matches = frappe.db.sql(
				"""
				SELECT p.name, p.employee_no, p.employee_name
				  FROM `tabAshan Employee Name Alias` a
				  JOIN `tabAshan Employee Salary Profile` p ON p.name=a.parent
				 WHERE p.company=%s AND a.alias_name=%s AND p.name<>%s
				 LIMIT 2
				""",
				(doc.company, alias, doc.name or ""),
				as_dict=True,
			)
		except Exception:
			alias_matches = []
		if alias_matches:
			match = alias_matches[0]
			frappe.throw(f"姓名别名【{alias}】已由员工 {match.employee_no} {match.employee_name} 使用。别名在同一公司内必须唯一。")


class AshanEmployeeSalaryProfile(Document):
	"""Employee payroll master with one authoritative identity/retirement rule path.

	The workbench APIs, direct DocType edits, imports and future AI-assisted writes all
	pass through the same validation.  This prevents the UI from becoming the only
	place where ID-card derivation and retirement policy are enforced.
	"""

	def validate(self):
		_sync_employee_name_aliases(self)
		if not getattr(self.flags, "skip_alias_uniqueness", False):
			_validate_alias_uniqueness(self)
		# 返聘工（退休返聘/其他-返聘工）社保与公积金基数强制锁定为0
		emp_type = (self.employee_type or "").strip()
		if emp_type in {"返聘工", "退休返聘", "其他-返聘工"}:
			self.social_security_base_mode = "自定义"
			self.custom_social_security_base = 0.0
			self.social_security_base = 0.0
			self.housing_fund_base = 0.0
			self.housing_fund_policy = "固定停缴"
			self.is_insured = 0
		else:
			base_mode = (self.social_security_base_mode or "最低缴费基数").strip()
			if base_mode not in {"最低缴费基数", "自定义"}:
				frappe.throw("社保缴费基数方式只能选择“最低缴费基数”或“自定义”。")
			self.social_security_base_mode = base_mode
			if base_mode == "自定义":
				self.custom_social_security_base = round(flt(self.custom_social_security_base), 2)
				if self.custom_social_security_base < 0:
					frappe.throw("自定义社保缴费基数不能为负数。")
				self.social_security_base = self.custom_social_security_base
		from ashan_cn_procurement.services.retirement_policy_service import (
			calculate_retirement_details,
			validate_chinese_id_number,
		)

		if (self.housing_fund_policy or "").strip() not in {"跟随公司规则", "固定缴纳", "固定停缴"}:
			self.housing_fund_policy = "跟随公司规则"

		certificate_type = (self.certificate_type or "中国居民身份证").strip()
		certificate_number = (self.id_card or "").strip().upper()
		self.certificate_type = certificate_type
		self.id_card = certificate_number

		if certificate_type == "中国居民身份证" and certificate_number:
			identity = validate_chinese_id_number(certificate_number)
			if not identity.get("is_valid"):
				frappe.throw(f"身份证号码校验失败：{identity.get('message') or '格式或校验码错误'}")
			self.birth_date = identity.get("birth_date")
			self.gender = identity.get("gender")
		elif certificate_type != "中国居民身份证" and certificate_number:
			missing = []
			if not self.birth_date:
				missing.append("出生日期")
			if not self.gender:
				missing.append("性别")
			if missing and not frappe.flags.in_migrate and not getattr(self.flags, "skip_birth_validation", False):
				frappe.throw(f"{certificate_type}无法自动识别{'、'.join(missing)}，请人工填写后再保存。")

		calculated = calculate_retirement_details(
			certificate_type=certificate_type,
			certificate_number=certificate_number,
			birth_date=self.birth_date,
			gender=self.gender,
			retirement_category=self.retirement_category,
			original_retirement_age=self.original_retirement_age,
			delayed_retirement_age=self.delayed_retirement_age,
			job_title=self.job_title,
		)

		self.current_age = calculated.get("current_age") or 0
		self.retirement_policy_version = calculated.get("policy_version") or ""

		# Female 50/55 classification is a personnel-policy attribute. A legacy
		# job-title guess may be shown by the UI, but is never persisted as truth.
		if not calculated.get("needs_retirement_category_confirmation"):
			self.retirement_category = calculated.get("retirement_category") or self.retirement_category
			self.original_retirement_age = calculated.get("original_retirement_age") or 0
			self.delayed_retirement_age = calculated.get("delayed_retirement_age") or 0
			self.original_retirement_period = calculated.get("original_retire_period") or ""
			self.delayed_retirement_period = calculated.get("delayed_retire_period") or ""

			# Keep the legacy fields synchronized for older pages/reports while new
			# code uses the explicit original/delayed fields above.
			self.retirement_age = self.delayed_retirement_age
			self.retirement_date = calculated.get("delayed_retire_date") or None
