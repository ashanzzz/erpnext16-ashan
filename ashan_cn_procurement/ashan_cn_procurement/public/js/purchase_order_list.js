/* ==========================================================================
   采购订单列表页定制 (Purchase Order List View)
   ========================================================================== */

frappe.listview_settings['Purchase Order'] = {
    add_fields: ["custom_doc_details", "supplier_name", "transaction_date", "grand_total", "status"],

    onload: function(listview) {
        listview.page.add_inner_button(__("收货入库"), function() {
            frappe.set_route("material-receipt-workbench", "po_to_pr");
        });
    },

    formatters: {
        custom_doc_details: function(value, df, doc) {
            if (typeof ashan !== 'undefined' && ashan.doc_details && ashan.doc_details.render_badges) {
                return ashan.doc_details.render_badges(value);
            }
            return value || "";
        }
    }
};
