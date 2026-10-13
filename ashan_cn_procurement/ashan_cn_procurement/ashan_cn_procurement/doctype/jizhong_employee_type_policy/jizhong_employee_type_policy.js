// Copyright (c) 2026, Ashan CN Procurement
// For license information, please see license.txt

frappe.ui.form.on('Jizhong Employee Type Policy', {
    refresh: function(frm) {
        frm.set_df_property('company', 'read_only', 1);
        if (!frm.doc.company) {
            frm.set_value('company', '天津吉众科技有限公司');
        }
    }
});
