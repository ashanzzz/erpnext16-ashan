// -*- coding: utf-8 -*-
frappe.ui.form.on('Vehicle Toll Monthly Sheet', {
    refresh(frm) {
        frm.add_custom_button(__('打开高速费月度大屏'), () => {
            frappe.set_route('vehicle-toll-ledger');
        });
    }
});
