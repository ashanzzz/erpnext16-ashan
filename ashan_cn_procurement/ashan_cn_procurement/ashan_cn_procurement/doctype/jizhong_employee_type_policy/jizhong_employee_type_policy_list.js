// Copyright (c) 2026, Ashan CN Procurement
// For license information, please see license.txt

(function() {
    "use strict";

    const DOCTYPE = "Jizhong Employee Type Policy";
    const CHECK_FIELDS = [
        "is_active",
        "participate_social_security",
        "participate_housing_fund",
        "participate_tax",
        "participate_payroll",
        "participate_cash_bills",
        "participate_attendance"
    ];

    function inject_styles() {
        if ($("#jz-policy-list-styles").length) return;
        $("<style id=\"jz-policy-list-styles\">")
            .prop("type", "text/css")
            .html(`
                .list-row-head .list-row-col {
                    cursor: pointer;
                    user-select: none;
                    transition: background-color 0.15s ease, color 0.15s ease;
                    border-radius: 4px;
                    padding: 4px 6px;
                }
                .list-row-head .list-row-col:hover {
                    background-color: #f1f5f9;
                }
                .list-row-head .list-row-col.jz-sort-active {
                    color: #2563eb;
                    font-weight: 600;
                }
                .jz-sort-icon {
                    display: inline-block;
                    margin-left: 4px;
                    vertical-align: middle;
                    width: 0;
                    height: 0;
                    border-left: 4px solid transparent;
                    border-right: 4px solid transparent;
                }
                .jz-sort-icon.asc {
                    border-bottom: 6px solid #2563eb;
                    border-top: none;
                }
                .jz-sort-icon.desc {
                    border-top: 6px solid #2563eb;
                    border-bottom: none;
                }
                .jz-policy-cell {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    height: 100%;
                    width: 100%;
                }
                .jz-policy-toggle-wrapper {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    margin: 0;
                    padding: 4px 8px;
                    border-radius: 4px;
                    transition: background-color 0.15s ease;
                }
                .jz-policy-toggle-wrapper:hover {
                    background-color: #e2e8f0;
                }
                .jz-policy-live-checkbox {
                    width: 17px;
                    height: 17px;
                    cursor: pointer;
                    accent-color: #2563eb;
                    margin: 0;
                    vertical-align: middle;
                }
            `)
            .appendTo("head");
    }

    function safe_escape(val) {
        if (!val) return "";
        return String(val)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function format_checkbox(fieldname, value, df, doc) {
        const isChecked = Boolean(Number(value || 0));
        const label = df ? (df.label || fieldname) : fieldname;
        const docName = safe_escape(doc.name || "");
        const title = `${label}: ${isChecked ? __("开启") : __("关闭")}`;
        return `
            <div class="jz-policy-cell text-center" title="${title}">
                <label class="jz-policy-toggle-wrapper">
                    <input type="checkbox"
                        class="jz-policy-live-checkbox"
                        data-docname="${docName}"
                        data-fieldname="${fieldname}"
                        aria-label="${label}"
                        ${isChecked ? "checked" : ""} />
                </label>
            </div>
        `;
    }

    frappe.listview_settings[DOCTYPE] = {
        hide_name_column: true,
        add_fields: [
            "employee_type",
            "is_active",
            "participate_social_security",
            "participate_housing_fund",
            "participate_tax",
            "participate_payroll",
            "participate_cash_bills",
            "participate_attendance"
        ],
        formatters: CHECK_FIELDS.reduce((acc, fld) => {
            acc[fld] = function(value, df, doc) {
                return format_checkbox(fld, value, df, doc);
            };
            return acc;
        }, {}),

        onload: function(listview) {
            inject_styles();
            bind_listview_events(listview);
        },

        refresh: function(listview) {
            inject_styles();
            bind_listview_events(listview);
            setTimeout(() => {
                update_sort_indicators(listview);
            }, 60);
        }
    };

    function bind_listview_events(listview) {
        const $root = listview.$result;
        if (!$root || !$root.length) return;

        // 1. Prevent form opening on checkbox click
        $root.off("click.jzPolicy", ".jz-policy-toggle-wrapper");
        $root.on("click.jzPolicy", ".jz-policy-toggle-wrapper", function(e) {
            e.stopPropagation();
        });

        // 2. Handle checkbox toggle directly in the list
        $root.off("change.jzPolicy", ".jz-policy-live-checkbox");
        $root.on("change.jzPolicy", ".jz-policy-live-checkbox", function(e) {
            e.stopPropagation();
            const $box = $(this);
            const docname = $box.attr("data-docname");
            const fieldname = $box.attr("data-fieldname");
            const checked = $box.prop("checked") ? 1 : 0;

            if (!docname || !fieldname) return;

            $box.prop("disabled", true);
            frappe.call({
                method: "frappe.client.set_value",
                args: {
                    doctype: DOCTYPE,
                    name: docname,
                    fieldname: fieldname,
                    value: checked
                },
                callback: function(r) {
                    $box.prop("disabled", false);
                    if (r.exc) {
                        $box.prop("checked", !checked);
                        frappe.show_alert({
                            message: __("更新失败"),
                            indicator: "red"
                        });
                    } else {
                        frappe.show_alert({
                            message: __("规则已更新"),
                            indicator: "green"
                        }, 2);
                        if (listview.data) {
                            const item = listview.data.find(d => d.name === docname);
                            if (item) {
                                item[fieldname] = checked;
                            }
                        }
                    }
                },
                error: function() {
                    $box.prop("disabled", false);
                    $box.prop("checked", !checked);
                    frappe.show_alert({
                        message: __("网络异常，更新失败"),
                        indicator: "red"
                    });
                }
            });
        });

        // 3. Remove duplicate frappe default handler and bind clean unified sort
        $root.off("click", "[data-sort-by]");
        $root.off("click.jzPolicySort", ".list-row-head .list-row-col");
        $root.on("click.jzPolicySort", ".list-row-head .list-row-col", function(e) {
            const $target = $(e.target);
            if ($target.is(".list-check-all") || $target.closest(".select-like").length) {
                return;
            }

            const $col = $(this);
            let fieldname = $col.attr("data-fieldname") || $col.find("[data-sort-by]").attr("data-sort-by");
            if (!fieldname) return;

            e.preventDefault();
            e.stopPropagation();

            let new_order = "asc";
            if (listview.sort_by === fieldname) {
                new_order = String(listview.sort_order || "asc").toLowerCase() === "asc" ? "desc" : "asc";
            } else {
                new_order = CHECK_FIELDS.includes(fieldname) ? "desc" : "asc";
            }

            listview.sort_by = fieldname;
            listview.sort_order = new_order;
            if (listview.sort_selector) {
                listview.sort_selector.set_value(fieldname, new_order);
            }
            if (typeof listview.on_sort_change === "function") {
                listview.on_sort_change(fieldname, new_order);
            } else {
                listview.refresh();
            }
        });
    }

    function update_sort_indicators(listview) {
        const $root = listview.$result;
        if (!$root || !$root.length) return;

        $root.find(".list-row-head .list-row-col").each(function() {
            const $col = $(this);
            const fieldname = $col.attr("data-fieldname") || $col.find("[data-sort-by]").attr("data-sort-by");
            $col.removeClass("jz-sort-active");
            $col.find(".jz-sort-icon").remove();

            if (fieldname && fieldname === listview.sort_by) {
                const order = String(listview.sort_order || "asc").toLowerCase();
                $col.addClass("jz-sort-active");
                const $target = $col.find("[data-sort-by]").length ? $col.find("[data-sort-by]") : $col;
                $target.append(`<span class="jz-sort-icon ${order}"></span>`);
            }
        });
    }
})();
