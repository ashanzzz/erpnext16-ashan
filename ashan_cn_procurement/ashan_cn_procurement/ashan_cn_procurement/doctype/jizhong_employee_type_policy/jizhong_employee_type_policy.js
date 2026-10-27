// Copyright (c) 2026, Ashan CN Procurement
// For license information, please see license.txt

frappe.ui.form.on("Jizhong Employee Type Policy", {
    refresh: function(frm) {
        frm.set_df_property("company", "read_only", 1);
        if (!frm.doc.company) {
            const comp = frappe.route_options?.company || "天津吉众科技有限公司";
            frm.set_value("company", comp);
        }
        if (!frm.is_new()) {
            frm.add_custom_button(__("删除"), function() {
                frappe.confirm(__("确定要彻底删除用工性质【{0}】吗？此操作不可撤销。", [frm.doc.employee_type || frm.doc.name]), function() {
                    frappe.delete_doc(frm.doctype, frm.doc.name, function() {
                        frappe.set_route("List", frm.doctype);
                    });
                });
            }).addClass("btn-danger");
        }
    }
});
