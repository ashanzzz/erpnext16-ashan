// Copyright (c) 2026, Ashan CN Procurement
// For license information, please see license.txt

frappe.ui.form.on('Qifu Employee Type Policy', {
    refresh: function(frm) {
        frm.set_df_property('company', 'read_only', 1);
        if (!frm.doc.company) {
            frm.set_value('company', '天津祺富机械加工有限公司');
        }
    }
});
