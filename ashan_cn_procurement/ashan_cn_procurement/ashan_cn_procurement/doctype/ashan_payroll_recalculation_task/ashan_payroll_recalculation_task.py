# Copyright (c) 2026, Ashan CN Procurement
import frappe
from frappe.model.document import Document


class AshanPayrollRecalculationTask(Document):
    """Persistent audit record for asynchronous payroll recalculation."""

    def validate(self):
        if self.start_period and self.end_period and self.start_period > self.end_period:
            frappe.throw("重算起始月份不能晚于截止月份。")
