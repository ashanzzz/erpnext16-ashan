# Copyright (c) 2026, Ashan CN Procurement
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class QifuEmployeeTypePolicy(Document):
	def validate(self):
		self.validate_company()

	def on_trash(self):
		self.validate_deletion_safety()

	def validate_company(self):
		from ashan_cn_procurement.services.authorization_service import (
			assert_payroll_access,
		)
		target_company = self.company or "天津祺富机械加工有限公司"
		assert_payroll_access("write", target_company)
		self.company = target_company

	def validate_deletion_safety(self):
		"""Block deletion if any active employee profile references this employee type."""
		from ashan_cn_procurement.services.authorization_service import (
			assert_payroll_access,
		)
		target_company = self.company or "天津祺富机械加工有限公司"
		assert_payroll_access("write", target_company)
		other_active = frappe.db.count(
			"Qifu Employee Type Policy",
			{
				"company": target_company,
				"employee_type": self.employee_type,
				"name": ["!=", self.name],
				"is_active": 1,
			},
		)
		if other_active > 0:
			return

		linked_emps = frappe.get_list(
			"Ashan Employee Salary Profile",
			filters={"company": target_company, "employee_type": self.employee_type},
			fields=["employee_no", "employee_name"],
			limit_page_length=20,
		)
		if linked_emps:
			emp_list_str = "、".join([f"{e.employee_name}({e.employee_no})" for e in linked_emps[:5]])
			more = f" 等共 {len(linked_emps)} 人" if len(linked_emps) > 5 else ""
			frappe.throw(
				f"【禁止删除用工性质】当前祺富仍有员工绑定了用工性质【{self.employee_type}】：{emp_list_str}{more}。\n"
				f"为防止月度薪酬核定和算薪引擎异常，请先在员工档案中人工指定并修改上述员工的用工性质，方可删除此规则。"
			)
