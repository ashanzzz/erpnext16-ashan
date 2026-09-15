# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

from ashan_cn_procurement.reimbursement.service import (
    release_all_reservations,
    release_removed_reservations,
    reserve_request_sources,
)


class ReimbursementRequest(Document):
    def validate(self):
        self._update_totals()
        if self.docstatus == 1 and not self.get("invoice_items"):
            frappe.throw(frappe._("提交报销单时必须包含至少一条有效的报销明细！"))
        if not self.is_new():
            release_removed_reservations(self)

    def on_trash(self):
        release_all_reservations(self)

    def after_insert(self):
        reserve_request_sources(self)

    def on_update(self):
        reserve_request_sources(self)

    def on_submit(self):
        for res in frappe.get_all(
            "Reimbursement Source Reservation",
            filters={"reimbursement_request": self.name, "status": "Draft"},
        ):
            frappe.db.set_value("Reimbursement Source Reservation", res.name, "status", "Submitted")

    def on_cancel(self):
        release_all_reservations(self)

    def _update_totals(self):
        total = sum(frappe.utils.flt(row.amount) for row in (self.get("invoice_items") or []))
        self.total_amount = total
        if not getattr(self, "paid_amount", None):
            self.paid_amount = 0
        self.outstanding_amount = max(0, total - frappe.utils.flt(self.paid_amount))
        if not self.payment_status:
            self.payment_status = "未付款"

