// Copyright (c) 2026, Ashan CN Procurement
// For license information, please see license.txt

(function() {
    "use strict";

    const DOCTYPE = "Jizhong Employee Type Policy";
    const CHECK_FIELDS = [
        "is_active",
        "is_other",
        "participate_social_security",
        "participate_housing_fund",
        "participate_tax",
        "participate_attendance",
        "participate_payroll",
        "participate_cash_bills"
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
                .jz-row-actions {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    margin-left: 10px;
                    flex-shrink: 0;
                }
                .jz-row-actions .btn {
                    padding: 2px 8px;
                    font-size: 11.5px;
                    font-weight: 600;
                    line-height: 18px;
                    height: 22px;
                }
                .jz-row-actions .btn-delete-policy {
                    color: #dc2626;
                    border-color: #fecaca;
                    background-color: #fef2f2;
                }
                .jz-row-actions .btn-delete-policy:hover {
                    color: #ffffff;
                    background-color: #dc2626;
                    border-color: #dc2626;
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
        const title = `${label}: ${isChecked ? __("启用") : __("关闭")}`;
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

    function open_quick_policy_dialog(doctype, defaultCompany, listview, docname) {
        const isEdit = Boolean(docname);
        const comp = frappe.route_options?.company || defaultCompany;

        const loadAndShow = function(existingDoc) {
            const doc = existingDoc || {
                company: comp,
                employee_type: "",
                is_active: 1,
                is_other: 0,
                participate_tax: 1,
                participate_social_security: 1,
                participate_housing_fund: 1,
                participate_payroll: 1,
                participate_workshop_roster: 1,
                participate_attendance: 1,
                participate_cash_bills: 1
            };

            const fields = [
                {
                    fieldtype: "Data",
                    fieldname: "company",
                    label: __("公司主体"),
                    default: comp,
                    read_only: 1
                },
                {
                    fieldtype: "Data",
                    fieldname: "employee_type",
                    label: __("用工性质名称"),
                    reqd: 1,
                    default: doc.employee_type || "",
                    read_only: isEdit ? 1 : 0,
                    description: isEdit ? __("用工性质名称不可修改！如需改名请删除后重新创建。") : __("请直接手写输入用工性质名称（如：正式工、返聘工、临时工等），严禁选择。")
                },
                { fieldtype: "Section Break", label: __("算떪与法定规则配置") },
                { fieldtype: "Check", fieldname: "is_active", label: __("启用此用工性质"), default: doc.is_active ?? 1 },
                { fieldtype: "Check", fieldname: "is_other", label: __("是否算作其它"), default: doc.is_other ?? 0 },
                { fieldtype: "Column Break" },
                { fieldtype: "Check", fieldname: "participate_tax", label: __("计入个税计算"), default: doc.participate_tax ?? 1 },
                { fieldtype: "Check", fieldname: "participate_social_security", label: __("缴纳社会保险"), default: doc.participate_social_security ?? 1 },
                { fieldtype: "Check", fieldname: "participate_housing_fund", label: __("缴纳住房公积金"), default: doc.participate_housing_fund ?? 1 },
                { fieldtype: "Column Break" },
                { fieldtype: "Check", fieldname: "participate_attendance", label: __("参与打卡考勤"), default: doc.participate_attendance ?? 1 },
                { fieldtype: "Check", fieldname: "participate_payroll", label: __("计入工资核定表"), default: doc.participate_payroll ?? 1 },
                { fieldtype: "Check", fieldname: "participate_cash_bills", label: __("参与现金发放表"), default: doc.participate_cash_bills ?? 1 }
            ];

            const d = new frappe.ui.Dialog({
                title: isEdit ? __("编辑用工性质 - {0}", [doc.employee_type]) : __("新建用工性质"),
                fields: fields,
                primary_action_label: isEdit ? __("保存修改") : __("立即新建"),
                primary_action: function(values) {
                    const empType = String(values.employee_type || "").trim();
                    if (!empType) {
                        frappe.msgprint(__("请输入用工性质名称！"));
                        return;
                    }
                    d.get_primary_btn().prop("disabled", true);

                    if (isEdit) {
                        frappe.call({
                            method: "frappe.client.set_value",
                            args: {
                                doctype: doctype,
                                name: docname,
                                fieldname: values
                            },
                            callback: function(r) {
                                d.get_primary_btn().prop("disabled", false);
                                if (!r.exc) {
                                    frappe.show_alert({ message: __("用工性质规则州更新"), indicator: "green" });
                                    d.hide();
                                    listview.refresh();
                                }
                            },
                            error: function() {
                                d.get_primary_btn().prop("disabled", false);
                            }
                        });
                    } else {
                        frappe.call({
                            method: "frappe.client.insert",
                            args: {
                                doc: Object.assign({
                                    doctype: doctype,
                                    company: comp,
                                    employee_type: empType,
                                    category_group: empType
                                }, values)
                            },
                            callback: function(r) {
                                d.get_primary_btn().prop("disabled", false);
                                if (!r.exc) {
                                    frappe.show_alert({ message: __("州成功新建用工性质【{0}】", [empType]), indicator: "green" });
                                    d.hide();
                                    listview.refresh();
                                }
                            },
                            error: function() {
                                d.get_primary_btn().prop("disabled", false);
                            }
                        });
                    }
                }
            });
            d.show();
        };

        if (isEdit) {
            frappe.call({
                method: "frappe.client.get",
                args: { doctype: doctype, name: docname },
                callback: function(r) {
                    if (r.message) loadAndShow(r.message);
                }
            });
        } else {
            loadAndShow(null);
        }
    }

    function setup_listview_actions(listview) {
        if (!listview || !listview.page) return;

        const company = frappe.route_options?.company || "天津吉众科技有限公司";

        if (listview.page.custom_actions) {
            listview.page.custom_actions.removeClass("hide hidden-xs hidden-md");
        }
        listview.page.wrapper.find(".custom-actions").removeClass("hide hidden-xs hidden-md");
        listview.page.wrapper.find(".standard-actions").removeClass("hide");

        listview.page.set_primary_action(__("+ 新建用工性质"), function() {
            open_quick_policy_dialog(DOCTYPE, company, listview);
        }, "octicon octicon-plus");

        if (listview.page.inner_toolbar) {
            const hasDelBtn = listview.page.inner_toolbar.find("button.btn-del-policy-action").length > 0;
            if (!hasDelBtn) {
                const $delBtn = listview.page.add_inner_button(__("删除所选"), function() {
                    const checked = listview.get_checked_items();
                    if (!checked.length) {
                        frappe.msgprint(__("请先厂选左侧复选框选择要删除的用工性质。"));
                        return;
                    }
                    const names = checked.map(d => d.name);
                    frappe.confirm(
                        __("确定要彻底删除州厂选的{0}条用工性质吗？此操作不可撒销。", [checked.length]),
                        function() {
                            frappe.call({
                                method: "frappe.desk.reportview.delete_items",
                                args: {
                                    items: names,
                                    doctype: DOCTYPE
                                },
                                callback: function(r) {
                                    if (!r.exc) {
                                        frappe.show_alert({ message: __("州成功删除所选用工性质"), indicator: "green" });
                                        listview.refresh();
                                    }
                                }
                            });
                        }
                    );
                });
                $delBtn.addClass("btn-del-policy-action");
            }
        }
    }

    function inject_row_actions(listview) {
        const $root = listview.$result;
        if (!$root || !$root.length) return;
        const company = frappe.route_options?.company || "天津吉众科技有限公司";

        $root.find(".list-row-container").each(function() {
            const $container = $(this);
            const $row = $container.find(".list-row");
            if (!$row.length || $row.find(".jz-row-actions").length) return;

            const docname = $row.find(".jz-policy-live-checkbox").first().attr("data-docname");
            if (!docname) return;

            const doc = listview.data ? listview.data.find(d => d.name === docname) : null;
            const empType = doc ? (doc.employee_type || docname) : docname;

            const $actions = $(`
                <div class="jz-row-actions">
                    <button type="button" class="btn btn-default btn-xs btn-edit-policy" data-docname="${docname}" title="修改规则">编辑</button>
                    <button type="button" class="btn btn-danger btn-xs btn-delete-policy" data-docname="${docname}" data-type="${empType}" title="彻底删除此用工性质">删除</button>
                </div>
            `);
            const $levelRight = $row.find(".level-right");
            if ($levelRight.length) {
                $levelRight.prepend($actions);
            } else {
                $row.append($actions);
            }
        });

        $root.off("click.jzRowEdit", ".btn-edit-policy");
        $root.on("click.jzRowEdit", ".btn-edit-policy", function(e) {
            e.stopPropagation();
            e.preventDefault();
            const docname = $(this).attr("data-docname");
            if (docname) {
                open_quick_policy_dialog(DOCTYPE, company, listview, docname);
            }
        });

        $root.off("click.jzRowDel", ".btn-delete-policy");
        $root.on("click.jzRowDel", ".btn-delete-policy", function(e) {
            e.stopPropagation();
            e.preventDefault();
            const docname = $(this).attr("data-docname");
            const empType = $(this).attr("data-type") || docname;
            if (!docname) return;

            frappe.confirm(
                __("确定要彻底删除用工性质【{0}】吗？此操作不可撒销。", [empType]),
                function() {
                    frappe.delete_doc(DOCTYPE, docname, function() {
                        frappe.show_alert({ message: __("州成功删除用工性质【{0}】", [empType]), indicator: "green" });
                        listview.refresh();
                    });
                }
            );
        });
    }

    frappe.listview_settings[DOCTYPE] = {
        hide_name_column: true,
        add_fields: [
        "is_active",
        "is_other",
        "participate_social_security",
        "participate_housing_fund",
        "participate_tax",
        "participate_attendance",
        "participate_payroll",
        "participate_cash_bills"
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
            setup_listview_actions(listview);
        },

        refresh: function(listview) {
            inject_styles();
            bind_listview_events(listview);
            setup_listview_actions(listview);
            inject_row_actions(listview);
        }
    };

    function bind_listview_events(listview) {
        const $root = listview.$result;
        if (!$root || !$root.length) return;

        $root.off("change.jzLiveToggle", ".jz-policy-live-checkbox");
        $root.on("change.jzLiveToggle", ".jz-policy-live-checkbox", function(e) {
            e.stopPropagation();
            const $box = $(this);
            const docname = $box.data("docname");
            const fieldname = $box.data("fieldname");
            const checked = $box.is(":checked") ? 1 : 0;

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
                            message: __("修改失败"),
                            indicator: "red"
                        });
                    } else {
                        frappe.show_alert({
                            message: __("配置州更新"),
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
                        message: __("网络异常，配置失败"),
                        indicator: "red"
                    });
                }
            });
        });
    }
})();
