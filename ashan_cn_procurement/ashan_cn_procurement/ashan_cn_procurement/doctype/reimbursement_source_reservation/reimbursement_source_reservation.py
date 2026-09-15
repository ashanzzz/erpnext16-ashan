"""Auditable draft reservation for one Purchase Invoice item."""

from frappe.model.document import Document


class ReimbursementSourceReservation(Document):
    def validate(self):
        if self.status == "Released":
            self.active_source_key = None
        elif getattr(self, "source_kind", None) == "Tax Invoice" and self.source_tax_invoice:
            self.active_source_key = f"TAXINV::{self.source_tax_invoice}"
        elif self.source_purchase_invoice_item:
            self.active_source_key = self.source_purchase_invoice_item
