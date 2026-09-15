// Copyright (c) 2026, Ashan CN Procurement
frappe.listview_settings['Tax Invoice'] = {
    add_fields: ["business_status", "match_status", "is_red_invoice", "pdf_removed", "parse_status", "parse_warning", "payable_total"],
    get_indicator: function(doc) {
        if ((doc.parse_warning || "").includes("【购买方错误】")) {
            return [__("购买方错误"), "red", "parse_status,=,需复核"];
        }
        if (doc.is_red_invoice) {
            return [__("红字发票"), "red", "is_red_invoice,=,1"];
        }
        if (doc.match_status === "废弃冲突") {
            return [__("废弃冲突"), "red", "match_status,=,废弃冲突"];
        }
        if (doc.business_status === "已录入") {
            return [__("已录入"), "green", "business_status,=,已录入"];
        }
        if (doc.business_status === "待录入") {
            return [__("待录入"), "orange", "business_status,=,待录入"];
        }
        if (doc.business_status === "已废弃") {
            return [__("已废弃"), "gray", "business_status,=,已废弃"];
        }
        if (doc.parse_status === "需复核") {
            return [__("需复核"), "orange", "parse_status,=,需复核"];
        }
        return [__("未知"), "gray", ""];
    },
    primary_action: function() {
        frappe.set_route('tax-invoice-center');
    },
    primary_action_label: __('税局发票中心')
};
