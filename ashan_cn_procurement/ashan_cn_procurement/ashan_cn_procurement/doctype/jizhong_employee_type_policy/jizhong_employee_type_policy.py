# Copyright (c) 2026, Ashan CN Procurement
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class JizhongEmployeeTypePolicy(Document):
	def validate(self):
		self.validate_company()
		self.sync_category_group()

	def on_trash(self):
		self.validate_deletion_safety()

	def validate_company(self):
		from ashan_cn_procurement.services.jizhong_payroll_service import (
			_assert_jizhong_access,
		)
		_assert_jizhong_access("write", self.company or "天津吉众科技有限公司")
		self.company = "天津吉众科技有限公司"

	def sync_category_group(self):
		"""Keep the legacy reporting field derived from the single policy type."""
		from ashan_cn_procurement.services.jizhong_payroll_service import (
			_jizhong_employee_category,
		)
		self.category_group = _jizhong_employee_category(self.employee_type)

	def validate_deletion_safety(self):
		"""Block deletion if any active employee profile references this employee type."""
		from ashan_cn_procurement.services.jizhong_payroll_service import (
			_assert_jizhong_access,
		)
		_assert_jizhong_access("write", self.company or "天津吉众科技有限公司")
		linked_emps = frappe.get_list(
			"Jizhong Employee Salary Profile",
			filters={"company": self.company, "employee_type": self.employee_type},
			fields=["employee_no", "employee_name"],
			limit_page_length=20,
		)
		if linked_emps:
			emp_list_str = "、".join([f"{e.employee_name}({e.employee_no})" for e in linked_emps[:5]])
			more = f" 等共 {len(linked_emps)} 人" if len(linked_emps) > 5 else ""
			frappe.throw(
				f"【禁止删除用工性质】当前吉众仍有员工绑定了用工性质【{self.employee_type}】：{emp_list_str}{more}。\n"
				f"为防止月度薪酬核定和算薪引擎异常，请先在员工档案中人工指定并修改上述员工的用工性质，方可删除此规则。"
			)
