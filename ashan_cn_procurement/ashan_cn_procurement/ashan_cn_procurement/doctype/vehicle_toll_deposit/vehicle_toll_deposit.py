# -*- coding: utf-8 -*-
from frappe.model.document import Document

class VehicleTollDeposit(Document):
    def before_insert(self):
        import frappe
        from frappe.utils import getdate
        d = getdate(self.deposit_date)
        self.fiscal_year = d.year
        self.fiscal_month = d.month
