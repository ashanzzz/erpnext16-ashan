# -*- coding: utf-8 -*-
"""
祺富 40 维度全量历史数据一键灌入服务模块
"""
import json
import os
import frappe

def execute():
    COMPANY = "天津祺富机械加工有限公司"
    
    # 真实历史工资数据属于私密数据，不应提交到 Git。优先读取环境变量，其次读取站点 private/files。
    json_path = os.environ.get("QIFU_HISTORICAL_DATA_PATH", "").strip()
    if not json_path:
        try:
            json_path = frappe.get_site_path("private", "files", "qifu_full_40_historical_data.json")
        except Exception:
            json_path = ""
    if not json_path or not os.path.exists(json_path):
        frappe.throw("未找到祺富历史工资私密数据。请将 qifu_full_40_historical_data.json 放入站点 private/files，或设置环境变量 QIFU_HISTORICAL_DATA_PATH。")

    with open(json_path, "r", encoding="utf-8") as f:
        batches = json.load(f)

    print("=== 开始全量历史数据灌入 (2025-10 至 2026-06) ===")

    for p_month, items in sorted(batches.items()):
        doc_name = f"{COMPANY}-{p_month}"
        is_historical = (p_month <= "2026-06")
        
        if frappe.db.exists("Ashan Monthly Payroll Settlement", doc_name):
            doc = frappe.get_doc("Ashan Monthly Payroll Settlement", doc_name)
            doc.items = []
        else:
            doc = frappe.new_doc("Ashan Monthly Payroll Settlement")
            doc.company = COMPANY
            doc.period_month = p_month

        doc.status = "已核定锁定" if is_historical else "草稿"
        doc.locked = 1 if is_historical else 0
        if is_historical:
            doc.confirmed_by = "系统初始化"

        tot_gross = 0.0
        tot_net = 0.0
        tot_ss_comp = 0.0
        tot_ss_pers = 0.0
        tot_hf_comp = 0.0
        tot_hf_pers = 0.0
        tot_tax = 0.0

        for idx, it in enumerate(items, 1):
            tot_gross += it.get("gross_salary", 0.0)
            tot_net += it.get("net_salary", 0.0)
            tot_ss_comp += it.get("ss_company_total", 0.0)
            tot_ss_pers += it.get("ss_person_total", 0.0)
            tot_hf_comp += it.get("hf_company_total", 0.0)
            tot_hf_pers += it.get("hf_person_total", 0.0)
            tot_tax += it.get("tax_amount", 0.0)

            row = {
                "employee_no": it.get("employee_no"),
                "employee_name": it.get("employee_name"),
                "id_card": it.get("id_card", ""),
                "mobile": it.get("mobile", ""),
                "birth_date": it.get("birth_date"),
                "gender": it.get("gender", ""),
                "department": "生产部",
                "job_title": "操作工",
                "employee_type": it.get("employee_type", "正式工"),
                "salary_mode": it.get("salary_mode", "税后"),
                "fixed_salary": it.get("fixed_salary", 0.0),
                "commercial_insurance": it.get("commercial_insurance", 0.0),
                "gross_salary": it.get("gross_salary", 0.0),
                "ss_base": it.get("ss_base", 0.0),
                "ss_person_total": it.get("ss_person_total", 0.0),
                "ss_company_total": it.get("ss_company_total", 0.0),
                "hf_base": it.get("hf_base", 0.0),
                "hf_person_total": it.get("hf_person_total", 0.0),
                "hf_company_total": it.get("hf_company_total", 0.0),
                "tax_threshold": it.get("tax_threshold", 5000.0),
                "pension_person": it.get("pension_person", 0.0),
                "medical_person": it.get("medical_person", 0.0),
                "large_medical_person": it.get("large_medical_person", 0.0),
                "unemployment_person": it.get("unemployment_person", 0.0),
                "pension_company": it.get("pension_company", 0.0),
                "medical_company": it.get("medical_company", 0.0),
                "unemployment_company": it.get("unemployment_company", 0.0),
                "other_medical_company": it.get("other_medical_company", 0.0),
                "work_injury_company": it.get("work_injury_company", 0.0),
                "deduction_child_education": it.get("deduction_child_education", 0.0),
                "deduction_continuing_education": it.get("deduction_continuing_education", 0.0),
                "deduction_serious_illness": it.get("deduction_serious_illness", 0.0),
                "deduction_housing_loan": it.get("deduction_housing_loan", 0.0),
                "deduction_housing_rent": it.get("deduction_housing_rent", 0.0),
                "deduction_elderly_care": it.get("deduction_elderly_care", 0.0),
                "deduction_infant_care": it.get("deduction_infant_care", 0.0),
                "special_deductions_total": it.get("special_deductions_total", 0.0),
                "taxable_income": max(0.0, it.get("gross_salary", 0.0) - it.get("ss_person_total", 0.0) - it.get("hf_person_total", 0.0) - it.get("special_deductions_total", 0.0) - it.get("tax_threshold", 5000.0)),
                "tax_amount": it.get("tax_amount", 0.0),
                "net_salary": it.get("net_salary", 0.0),
                "remarks": "历史累计期初快照（非单月工资明细）" if p_month == "2025-10" else ""
            }
            doc.append("items", row)

        doc.total_employees = len(items)
        doc.total_gross_salary = round(tot_gross, 2)
        doc.total_net_salary = round(tot_net, 2)
        doc.total_social_security_company = round(tot_ss_comp, 2)
        doc.total_social_security_person = round(tot_ss_pers, 2)
        doc.total_housing_fund_company = round(tot_hf_comp, 2)
        doc.total_housing_fund_person = round(tot_hf_pers, 2)
        doc.total_tax = round(tot_tax, 2)

        frappe.flags.ignore_lock = True
        doc.save(ignore_permissions=True)
        frappe.db.commit()
        print(f"  ✓ 成功灌入 [{p_month}]: {len(items)} 人, 税前应发总计: ¥{tot_gross:,.2f}, 状态: {doc.status}")

    print("=== 历史数据全量灌入成功！===")
