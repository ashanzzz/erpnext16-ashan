frappe.ui.form.on('Vehicle Toll Deposit', {
    deposit_date(frm) {
        if (frm.doc.deposit_date) {
            const d = frappe.datetime.str_to_obj(frm.doc.deposit_date);
            frm.set_value('fiscal_year', d.getFullYear());
            frm.set_value('fiscal_month', d.getMonth() + 1);
        }
    }
});
