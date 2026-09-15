frappe.ui.form.on('Vehicle Toll Config', {
    refresh(frm) {
        frm.add_custom_button(__('打开高速费台账大屏'), () => {
            frappe.set_route('vehicle-toll-ledger');
        });
    }
});
