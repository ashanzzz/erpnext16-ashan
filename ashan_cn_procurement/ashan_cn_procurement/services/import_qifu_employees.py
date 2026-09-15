# Copyright (c) 2026, Ashan CN Procurement
import os
import json
import frappe
from frappe.utils import flt, cint

def setup_all_company_insurance_settings():
	# 1. 祺富 2026 设置
	qifu_company = "天津祺富机械加工有限公司"
	qifu_year = 2026
	qifu_name = f"{qifu_company}-{qifu_year}"
	
	if frappe.db.exists("Ashan Insurance Setting", qifu_name):
		doc_q = frappe.get_doc("Ashan Insurance Setting", qifu_name)
	else:
		doc_q = frappe.new_doc("Ashan Insurance Setting")
		doc_q.company = qifu_company
		doc_q.effective_year = qifu_year

	doc_q.ss_company_pension = 16.0
	doc_q.ss_company_unemployment = 0.5
	doc_q.ss_company_medical = 10.0
	doc_q.ss_company_other_medical = 0.5
	doc_q.ss_company_injury = 0.55

	doc_q.ss_person_pension = 8.0
	doc_q.ss_person_unemployment = 0.5
	doc_q.ss_person_medical = 2.0
	doc_q.big_medical_amount_default = 22.0
	doc_q.big_medical_amount_special = 21.0
	doc_q.big_medical_special_months = "3,12"

	doc_q.hf_company_rate = 5.0
	doc_q.hf_person_rate = 5.0

	doc_q.ss_min_base = 5013.0
	doc_q.hf_min_base = 2320.0
	doc_q.tax_threshold = 5000.0
	doc_q.save(ignore_permissions=True)

	# 2. 吉众 2026 设置
	jz_company = "天津吉众科技有限公司"
	jz_year = 2026
	jz_name = f"{jz_company}-{jz_year}"
	
	if frappe.db.exists("Ashan Insurance Setting", jz_name):
		doc_j = frappe.get_doc("Ashan Insurance Setting", jz_name)
	else:
		doc_j = frappe.new_doc("Ashan Insurance Setting")
		doc_j.company = jz_company
		doc_j.effective_year = jz_year

	doc_j.ss_company_pension = 16.0
	doc_j.ss_company_unemployment = 0.5
	doc_j.ss_company_medical = 10.0
	doc_j.ss_company_other_medical = 0.5
	doc_j.ss_company_injury = 0.35  # 吉众独立工伤费率

	doc_j.ss_person_pension = 8.0
	doc_j.ss_person_unemployment = 0.5
	doc_j.ss_person_medical = 2.0
	doc_j.big_medical_amount_default = 22.0
	doc_j.big_medical_amount_special = 21.0
	doc_j.big_medical_special_months = "3,12"

	doc_j.hf_company_rate = 5.0
	doc_j.hf_person_rate = 5.0

	doc_j.ss_min_base = 5124.0
	doc_j.hf_min_base = 2320.0
	doc_j.tax_threshold = 5000.0
	doc_j.save(ignore_permissions=True)

	frappe.db.commit()
	print(f"Setup insurance settings for {qifu_name} and {jz_name} successfully!")

def setup_qifu_insurance_settings():
	setup_all_company_insurance_settings()

def import_qifu_employees_from_seed():
	setup_qifu_insurance_settings()
	company = "天津祺富机械加工有限公司"

	# 真实员工数据属于私密数据，不应提交到 Git。优先读取显式环境变量，其次读取站点 private/files。
	json_path = os.environ.get("QIFU_EMPLOYEE_SEED_PATH", "").strip()
	if not json_path:
		try:
			json_path = frappe.get_site_path("private", "files", "qifu_employee_seed.json")
		except Exception:
			json_path = ""
	if not json_path or not os.path.exists(json_path):
		frappe.throw("未找到祺富员工私密种子数据。请将 qifu_employee_seed.json 放入站点 private/files，或设置环境变量 QIFU_EMPLOYEE_SEED_PATH。")

	with open(json_path, "r", encoding="utf-8") as f:
		records = json.load(f)

	imported_count = 0
	for r in records:
		emp_no = str(r.get("employee_no")).strip()
		emp_name = str(r.get("employee_name")).strip()

		doc_name = f"{company}-{emp_no}-{emp_name}"
		if frappe.db.exists("Ashan Employee Salary Profile", doc_name):
			doc = frappe.get_doc("Ashan Employee Salary Profile", doc_name)
		else:
			existing = frappe.db.get_value("Ashan Employee Salary Profile", {"company": company, "employee_no": emp_no}, "name")
			if existing:
				doc = frappe.get_doc("Ashan Employee Salary Profile", existing)
			else:
				doc = frappe.new_doc("Ashan Employee Salary Profile")
				doc.company = company
				doc.employee_no = emp_no

		doc.employee_name = emp_name
		doc.company = company
		doc.id_card = r.get("id_card", "")
		doc.certificate_type = r.get("certificate_type") or ("中国居民身份证" if len(str(doc.id_card or "").strip()) in (15, 18) else ("护照" if doc.id_card else "其他证件"))
		doc.mobile = r.get("mobile", "")
		doc.gender = r.get("gender", "男")
		doc.birth_date = r.get("birth_date")
		doc.current_age = cint(r.get("current_age", 0))
		doc.retirement_age = flt(r.get("retirement_age", 0))
		doc.retirement_date = r.get("retirement_date")
		doc.employee_type = r.get("employee_type", "正式工")
		doc.employment_status = "在职"
		doc.salary_mode = r.get("salary_mode", "税后")
		doc.fixed_salary = flt(r.get("fixed_salary", 0))
		doc.commercial_insurance = flt(r.get("commercial_insurance", 0))
		doc.housing_fund_base = flt(r.get("housing_fund_base", 2320))
		doc.housing_fund_policy = r.get("housing_fund_policy", "跟随公司规则")
		doc.social_security_base = flt(r.get("social_security_base", 5124))

		doc.deduction_child_education = flt(r.get("deduction_child_education", 0))
		doc.deduction_continuing_education = flt(r.get("deduction_continuing_education", 0))
		doc.deduction_serious_illness = flt(r.get("deduction_serious_illness", 0))
		doc.deduction_housing_loan = flt(r.get("deduction_housing_loan", 0))
		doc.deduction_housing_rent = flt(r.get("deduction_housing_rent", 0))
		doc.deduction_elderly_care = flt(r.get("deduction_elderly_care", 0))
		doc.deduction_infant_care = flt(r.get("deduction_infant_care", 0))

		doc.is_insured = cint(r.get("is_insured", 1))
		if r.get("retirement_category"):
			doc.retirement_category = r.get("retirement_category")
		if r.get("name_aliases") is not None:
			doc.set("name_aliases", r.get("name_aliases") or [])

		doc.save(ignore_permissions=True)
		imported_count += 1
		print(f"Imported [{doc.employee_no}] {doc.employee_name} ({doc.employee_type})")

	frappe.db.commit()
	print(f"\n[DONE] Total {imported_count} 祺富 employees imported successfully!")
	return imported_count
