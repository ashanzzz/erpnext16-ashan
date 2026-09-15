# -*- coding: utf-8 -*-
# Copyright (c) 2026, Ashan CN Procurement
# 吉众 421 条全量历史薪酬数据 (2024-12 至 2026-06) 一键灌入与四柱归集服务

import json
import os
import frappe
from frappe.utils import flt

def execute():
	COMPANY = "天津吉众科技有限公司"

	json_path = os.environ.get("JIZHONG_HISTORY_RECORDS_PATH", "").strip()
	if not json_path:
		json_path = frappe.get_site_path("private", "files", "jizhong_history_records.json")
	if not os.path.exists(json_path):
		frappe.throw("未找到吉众历史工资私密数据。请将 jizhong_history_records.json 放入站点 private/files，或设置环境变量 JIZHONG_HISTORY_RECORDS_PATH。")

	with open(json_path, "r", encoding="utf-8") as f:
		batches = json.load(f)

	frappe.flags.ignore_lock = True
	print(f"=== 开始吉众历史数据灌入 (共 {len(batches)} 个账期) ===")

	total_settlements = 0
	total_items = 0

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
		doc.workflow_stage = "已封账" if is_historical else "草稿"
		if is_historical:
			doc.confirmed_by = "系统初始化"

		tot_gross = 0.0
		tot_net = 0.0
		tot_ss_pers = 0.0
		tot_hf_pers = 0.0
		tot_tax = 0.0

		for idx, it in enumerate(items, 1):
			g_sal = flt(it.get("gross_salary", 0))
			n_sal = flt(it.get("net_salary", 0))
			t_amt = flt(it.get("tax_amount", 0))
			s_pers = flt(it.get("ss_person_total", 0))
			h_pers = flt(it.get("hf_person_total", 0))

			tot_gross += g_sal
			tot_net += n_sal
			tot_tax += t_amt
			tot_ss_pers += s_pers
			tot_hf_pers += h_pers

			emp_no = it.get("employee_no")
			emp_type = "其他-正式工" if emp_no == "QG0002" else ("其他-返聘工" if emp_no in ["QG0001", "QF0001", "QF0002", "QG0003", "QG0004"] else "正式工")

			doc.append("items", {
				"employee_no": emp_no,
				"employee_name": it.get("employee_name"),
				"employee_type": emp_type,
				"id_card": it.get("id_card"),
				"salary_mode": it.get("salary_mode"),
				"base_salary": flt(it.get("base_salary", 0)),
				"post_allowance": flt(it.get("post_allowance", 0)),
				"performance_salary": flt(it.get("performance_salary", 0)),
				"meal_unit_price": flt(it.get("meal_unit_price", 0)),
				"salary_adjustment": flt(it.get("salary_adjustment", 0)),
				"ss_base": flt(it.get("ss_base", 0)),
				"hf_base": flt(it.get("hf_base", 0)),
				"ss_person_total": s_pers,
				"hf_person_total": h_pers,
				"special_deductions_total": flt(it.get("special_deductions_total", 0)),
				"tax_threshold": flt(it.get("tax_threshold", 5000)),
				"tax_amount": t_amt,
				"net_salary": n_sal,
				"gross_salary": g_sal,
				"cash_pay": n_sal,
			})
			total_items += 1

		doc.total_employees = len(doc.items)
		doc.total_gross_salary = round(tot_gross, 2)
		doc.total_net_salary = round(tot_net, 2)
		doc.total_tax = round(tot_tax, 2)
		doc.total_social_security_person = round(tot_ss_pers, 2)
		doc.total_housing_fund_person = round(tot_hf_pers, 2)

		doc.save(ignore_permissions=True)
		total_settlements += 1
		print(f"  [OK] 结算单已处理: {doc_name} ({len(items)} 人)")

	frappe.db.commit()
	print(f"=== 吉众历史数据灌入完成: 共 {total_settlements} 个月度结算单, {total_items} 条薪资明细 ===")
	return {"total_settlements": total_settlements, "total_items": total_items}
