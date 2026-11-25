# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class AshanRecurringExpenseConfig(Document):
    def validate(self):
        if not self.company:
            frappe.throw(frappe._("公司主体为必填项！"))
        if not self.expense_name:
            frappe.throw(frappe._("支出项目名称为必填项！"))
        if frappe.utils.flt(self.default_amount) < 0:
            frappe.throw(frappe._("每月固定金额不能为负数！"))
        if not (1 <= frappe.utils.cint(self.day_of_month) <= 31):
            self.day_of_month = 15
