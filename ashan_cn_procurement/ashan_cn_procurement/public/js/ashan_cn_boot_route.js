// Copyright (c) 2026, Ashan CN Procurement
// Safe landing and route protection for Workspaces/Home

(function() {
    function patch_router_and_pageview() {
        if (!window.frappe) return;

        // 1. 拦截 show_not_found，杜绝任何 home / my-business 404 弹窗
        if (frappe.show_not_found && !frappe.show_not_found._ashan_patched) {
            var orig_show_not_found = frappe.show_not_found;
            frappe.show_not_found = function(page_name) {
                var p = (page_name || "").toLowerCase();
                if (p === "home" || p === "my-business" || p === "desktop" || p.includes("home") || p.includes("my-business")) {
                    console.log("[Ashan CN Boot] Intercepted 404 for Workspace page:", page_name);
                    frappe.set_route("Workspaces", "Home");
                    return;
                }
                return orig_show_not_found.apply(this, arguments);
            };
            frappe.show_not_found._ashan_patched = true;
        }

        // 2. 拦截 pageview.show 避免误将 Workspace 作为 Page 寻找
        if (frappe.views && frappe.views.pageview && !frappe.views.pageview._ashan_patched) {
            var orig_pageview_show = frappe.views.pageview.show;
            frappe.views.pageview.show = function(name) {
                var p = (name || "").toLowerCase();
                if (p === "home" || p === "my-business" || p === "desktop" || p === "desk/home" || p === "desk/my-business") {
                    frappe.set_route("Workspaces", "Home");
                    return;
                }
                return orig_pageview_show.apply(this, arguments);
            };
            frappe.views.pageview._ashan_patched = true;
        }
    }

    patch_router_and_pageview();

    if (typeof $ !== "undefined") {
        $(document).ready(patch_router_and_pageview);
        $(document).on("app_ready route-change page-change", patch_router_and_pageview);
    }
})();
