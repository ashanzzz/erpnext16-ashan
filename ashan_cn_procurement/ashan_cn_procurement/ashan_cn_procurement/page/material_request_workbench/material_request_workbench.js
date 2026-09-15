// Copyright (c) 2026, Ashan CN Procurement and contributors

frappe.pages["material-request-workbench"].on_page_load = function (wrapper) {
    frappe.require([
        "/assets/ashan_cn_procurement/css/procurement_workbench.css",
        "/assets/ashan_cn_procurement/js/procurement_workbench.js",
    ], () => window.AshanProcurementWorkbench.mount(wrapper, "request"));
};

frappe.pages["material-request-workbench"].on_page_show = function (wrapper) {
    if (wrapper.ashan_procurement_workbench) {
        wrapper.ashan_procurement_workbench.show();
    }
};
