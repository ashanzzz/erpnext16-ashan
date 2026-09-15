/* ==========================================================================
   ERPNext 16 采购发票 - 极简中文化布局、发票类型/防重联动、0闪烁纯数字金额与全双向智能倒算引擎
   1. 彻底根治表头与单元格 (CNY) 闪烁（源头拦截法）：
      - 拦截 frappe.ui.form.Form.prototype.set_currency_labels，在采购发票 items 子表头生成前直接阻止拼接 (CNY)，从源头实现 0 毫秒无闪烁！
      - 全局拦截 frappe.form.formatters.Currency，采购发票明细表格中仅返回格式化的纯财务数字 (如 100.00, 200.00)，彻底去除多余的 (CNY) 后缀
   2. 仅展示核心字段与清晰分类：
      - 【基本信息】：单据编号 (naming_series)、记账日期 (posting_date)、记账时间 (posting_time)、修改单据日期 (set_posting_time)、业务模式 (custom_biz_mode)、受限单据 (custom_is_restricted_doc)、受限组 (custom_restriction_group)
      - 【供应商与发票信息】：供应商 (supplier)、发票类型 (custom_invoice_type)、发票号 (bill_no)、发票日期 (bill_date)
      - 【开票明细与金额】：物料明细 (items) + 清爽中文财务汇总卡片
   3. 严格发票业务规则联动：
      - 【无发票】：禁止输入发票号，自动清空并锁定为只读；
      - 【专用发票 / 普通发票】：强制必填发票号与发票日期，且失焦实时+保存时后端全局防重校验！
   4. 核心计算：录入含税单价/价税合计/未税单价/税率/数量均实现 0 毫秒双向智能倒算
   ========================================================================== */

frappe.provide("ashan.tax");

ashan.tax._is_calculating = false;

// 格式化纯金额数字（如 200.00 或 1,234.56，去重货币符号）
ashan.tax.format_money = function(val) {
    return (flt(val, 2)).toLocaleString('zh-CN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
};

// -------------------------------------------------------------
// 1. 【源头级 0 毫秒拦截】彻底防止表头与单元格 CNY 闪烁
// -------------------------------------------------------------

// (1) 拦截表单表头 Currency 标签拼接，阻止 ERPNext 向 items 字段追加 (CNY)
if (frappe.ui && frappe.ui.form && frappe.ui.form.Form && !frappe.ui.form.Form.prototype._ashan_currency_intercepted) {
    const orig_set_currency_labels = frappe.ui.form.Form.prototype.set_currency_labels;
    frappe.ui.form.Form.prototype.set_currency_labels = function(fields_list, currency, parentfield) {
        if (this.doc && this.doc.doctype === "Purchase Invoice" && parentfield === "items") {
            // 采购发票明细表格保持纯净标签，直接返回，绝不拼接 (CNY)
            return;
        }
        return orig_set_currency_labels.apply(this, arguments);
    };
    frappe.ui.form.Form.prototype._ashan_currency_intercepted = true;
}

// (2) 拦截 Currency 单元格格式化器，在采购发票明细中仅输出纯数字
if (frappe.form && frappe.form.formatters && !frappe.form.formatters._ashan_currency_patched) {
    const orig_currency_formatter = frappe.form.formatters.Currency;
    frappe.form.formatters.Currency = function(value, df, options, doc) {
        if (df && (df.parent === "Purchase Invoice Item" || (doc && doc.doctype === "Purchase Invoice Item"))) {
            if (value === undefined || value === null || value === "") return "";
            return ashan.tax.format_money(value);
        }
        return orig_currency_formatter(value, df, options, doc);
    };
    frappe.form.formatters._ashan_currency_patched = true;
}

// 获取公司进项税科目
ashan.tax.get_vat_account = function(frm, callback) {
    if (frm._vat_account) {
        callback && callback(frm._vat_account);
        return;
    }
    frappe.db.get_list("Account", {
        filters: { account_type: "Tax", company: frm.doc.company },
        fields: ["name"],
        limit: 1
    }).then(res => {
        if (res && res.length) {
            frm._vat_account = res[0].name;
            callback && callback(frm._vat_account);
        } else {
            callback && callback("");
        }
    });
};

// 子表格表头标签深度净化
ashan.tax.clean_grid_headers = function(frm) {
    const label_map = {
        "item_code": "物料",
        "description": "规格",
        "qty": "数量",
        "custom_gross_rate": "含税单价",
        "custom_tax_rate": "税率 (%)",
        "rate": "不含税单价",
        "amount": "金额",
        "custom_tax_amount": "税额",
        "custom_gross_amount": "价税合计"
    };

    $('[data-fieldname="items"] .grid-heading-row .grid-static-col').each(function() {
        const fn = $(this).attr("data-fieldname");
        if (label_map[fn]) {
            $(this).attr("title", label_map[fn]);
            $(this).find(".static-area").text(label_map[fn]);
        }
    });
};

// 发票类型与发票号联动控制
ashan.tax.handle_invoice_type = function(frm) {
    if (!frm || !frm.fields_dict) return;
    const inv_type = (frm.doc.custom_invoice_type || "").trim();

    if (inv_type === "无发票") {
        if (frm.doc.bill_no) {
            frm.set_value("bill_no", "");
        }
        frm.set_df_property("bill_no", "read_only", 1);
        frm.set_df_property("bill_no", "reqd", 0);
        frm.set_df_property("bill_date", "reqd", 0);
        frm.set_df_property("bill_no", "description", "<span style='color:#64748b; font-size:12px;'>发票类型为【无发票】，无需填写发票号</span>");
    } else if (inv_type === "专用发票" || inv_type === "普通发票") {
        frm.set_df_property("bill_no", "read_only", 0);
        frm.set_df_property("bill_no", "reqd", 1);
        frm.set_df_property("bill_date", "reqd", 1);
        frm.set_df_property("bill_no", "description", "<span style='color:#2563eb; font-size:12px;'>* 必须填写发票号（系统自动防重校验）</span>");
    } else {
        frm.set_df_property("bill_no", "read_only", 0);
        frm.set_df_property("bill_no", "reqd", 0);
        frm.set_df_property("bill_date", "reqd", 0);
        frm.set_df_property("bill_no", "description", "");
    }
};

// 实时发票号防重校验
ashan.tax.check_bill_no_duplicate = function(frm) {
    const bill_no = (frm.doc.bill_no || "").trim();
    const inv_type = (frm.doc.custom_invoice_type || "").trim();
    if (!bill_no || inv_type === "无发票") return;

    frappe.call({
        method: "ashan_cn_procurement.overrides.purchase_invoice_tax.check_bill_no_duplicate",
        args: {
            bill_no: bill_no,
            docname: frm.doc.name
        },
        callback: function(r) {
            if (r.message && r.message.is_duplicate) {
                frappe.msgprint({
                    title: __("发票号重复警告"),
                    indicator: "red",
                    message: r.message.message
                });
                frm.set_df_property("bill_no", "description", `<span style='color:#dc2626; font-weight:600;'>⚠️ 该发票号已被单据 ${r.message.duplicate_name} 占用！</span>`);
            } else {
                frm.set_df_property("bill_no", "description", "<span style='color:#16a34a; font-size:12px;'>✓ 发票号可用，无重复</span>");
            }
        }
    });
};

// 精简与中文化重构采购发票表单界面
ashan.tax.simplify_invoice_form = function(frm) {
    if (!frm || !frm.fields_dict) return;

    // 1. 隐藏非必要的冗余字段与 Sections (含表单内的摘要字段)
    const FIELDS_TO_HIDE = [
        "due_date", "is_paid", "is_return", "custom_items_summary",
        "return_against", "update_outstanding_for_self", "update_billed_amount_in_purchase_order",
        "update_billed_amount_in_purchase_receipt", "apply_tds", "amended_from",
        "supplier_name", "tax_id", "company", "column_break1",
        "custom_restriction_root_doctype", "custom_restriction_root_name", "custom_restriction_note",
        "cost_center", "project", "currency", "conversion_rate", "use_transaction_date_exchange_rate",
        "buying_price_list", "price_list_currency", "plc_conversion_rate", "ignore_pricing_rule",
        "update_stock", "is_subcontracted", "scan_barcode",
        "total_qty", "total", "base_total", "net_total", "base_net_total",
        "taxes_and_charges", "shipping_rule", "tax_category", "taxes",
        "total_taxes_and_charges", "base_total_taxes_and_charges",
        "grand_total", "base_grand_total", "rounding_adjustment", "base_rounding_adjustment",
        "rounded_total", "base_rounded_total", "outstanding_amount", "disable_rounded_total",
        "in_words", "base_in_words", "total_advance", "write_off_amount", "base_write_off_amount",
        "additional_discount_percentage", "discount_amount", "base_discount_amount",
        "section_break_26", "accounting_dimensions_section", "currency_and_price_list", "sec_warehouse",
        "taxes_section", "totals", "totals_section", "base_totals_section",
        "section_break_ttrv", "section_tax_withholding_entry", "section_break_44",
        "sec_tax_breakup", "pricing_rule_details", "raw_materials_supplied",
        "payments_section", "advances_section", "write_off", "section_addresses",
        "company_shipping_address_section", "company_billing_address_section",
        "payment_schedule_section", "terms_section_break", "status_section",
        "accounting_details_section", "subscription_section", "automation_section",
        "printing_settings", "sb_14", "additional_info_section",
        "payments_tab", "address_and_contact_tab", "terms_tab", "more_info_tab", "connections_tab"
    ];

    FIELDS_TO_HIDE.forEach(f => {
        if (frm.fields_dict[f]) {
            frm.toggle_display(f, false);
            frm.set_df_property(f, "hidden", 1);
        }
    });

    // 2. 显式释放并展示受限单据、受限组、修改单据日期等核心字段
    const FIELDS_TO_SHOW = [
        "posting_date", "posting_time", "set_posting_time",
        "custom_biz_mode", "custom_invoice_type",
        "custom_is_restricted_doc", "custom_restriction_group",
        "supplier", "bill_no", "bill_date", "items"
    ];
    if (frm.is_new()) {
        FIELDS_TO_SHOW.push("naming_series");
    }
    FIELDS_TO_SHOW.forEach(f => {
        if (frm.fields_dict[f]) {
            frm.toggle_display(f, true);
            frm.set_df_property(f, "hidden", 0);
        }
    });

    if (frm.is_new() && frm.fields_dict["naming_series"]) {
        frm.set_df_property("naming_series", "label", "单据编号 (Series)");
    }

    // 3. 优化标签名与分类标题
    frm.set_df_property("naming_series", "label", "单据编号 (Series)");
    frm.set_df_property("posting_date", "label", "记账日期");
    frm.set_df_property("posting_time", "label", "记账时间");
    frm.set_df_property("set_posting_time", "label", "修改单据日期");
    frm.set_df_property("custom_biz_mode", "label", "业务模式");
    frm.set_df_property("custom_invoice_type", "label", "发票类型");
    frm.set_df_property("custom_is_restricted_doc", "label", "受限单据");
    frm.set_df_property("custom_restriction_group", "label", "受限组");
    frm.set_df_property("supplier", "label", "供应商");
    frm.set_df_property("bill_no", "label", "发票号 (供应商发票号)");
    frm.set_df_property("bill_date", "label", "发票日期");
    
    frm.set_df_property("supplier_invoice_details", "label", "供应商与发票信息");
    frm.toggle_display("supplier_invoice_details", true);
    frm.toggle_display("items_section", true);

    // 4. 刷新 items 表头；字段可见性由服务端集中配置，不在 JS 中隐藏。
    ashan.tax.clean_grid_headers(frm);

    // 5. 联动发票类型规则
    ashan.tax.handle_invoice_type(frm);

    // 6. 注入优化样式
    ashan.tax.inject_form_css();
};

// 注入极简表单 CSS
ashan.tax.inject_form_css = function() {
    if ($("#ashan-simplified-invoice-style").length) return;
    const css = `
    <style id="ashan-simplified-invoice-style">
        /* 全局默认容器宽度提升为 1200px 并保持完美居中 */
        :root, [data-theme="light"], [data-theme="dark"], body {
            --page-max-width: 1200px !important;
        }
        body:not(.full-width) .std-form-layout .section-head,
        body:not(.full-width) .std-form-layout .section-body,
        body:not(.full-width) .form-section-description {
            max-width: var(--page-max-width) !important;
            margin-left: auto !important;
            margin-right: auto !important;
        }
        body:not(.full-width) [data-page-route="Workspaces"] .layout-main {
            max-width: var(--page-max-width) !important;
            margin: auto !important;
        }

        /* 针对采购发票页面隐藏头部 tabs、due_date、总数行 */
        [data-page-route*="Purchase Invoice"] .header-items .nav-tabs,
        [data-page-route*="Purchase Invoice"] .nav-tabs,
        [data-page-route*="Purchase Invoice"] .form-tabs,
        [data-page-route*="Purchase Invoice"] .form-tabs-list,
        [data-page-route*="Purchase Invoice"] .form-tab,
        [data-page-route*="Purchase Invoice"] [data-fieldname="due_date"],
        [data-page-route*="Purchase Invoice"] [data-fieldname="total_qty"],
        [data-page-route*="Purchase Invoice"] [data-fieldname="total"],
        [data-page-route*="Purchase Invoice"] [data-fieldname="section_break_26"],
        .page-container[data-page-route*="Purchase Invoice"] [data-fieldname="due_date"] {
            display: none !important;
        }
        /* 供应商与发票信息分区标题美化 */
        [data-page-route*="Purchase Invoice"] .section-head {
            font-size: 14.5px !important;
            font-weight: 700 !important;
            color: #1e293b !important;
            padding-bottom: 8px !important;
            margin-top: 16px !important;
            border-bottom: 1.5px solid #e2e8f0 !important;
        }

        /* 子表行编辑抽屉美化 */
        .grid-row-open .form-in-grid {
            background-color: #fafbfc;
            border-radius: 8px;
            padding: 16px !important;
            border: 1px solid #e2e8f0;
        }
        .grid-row-open .section-head {
            font-size: 13.5px !important;
            font-weight: 700 !important;
            color: #1e293b !important;
            padding-bottom: 6px !important;
            margin-top: 10px !important;
            border-bottom: 1px solid #e2e8f0 !important;
        }
    </style>
    `;
    $("head").append(css);
};

// 汇总整单税费并渲染清爽汇总卡片
ashan.tax.sync_taxes_and_totals = function(frm) {
    if (!frm || !frm.doc || !frm.doc.items) return;

    let total_tax = 0;
    let net_total = 0;
    let grand_total = 0;
    let rate_breakdown = {};

    frm.doc.items.forEach(row => {
        const row_net = flt(row.amount, 2);
        const row_tax = flt(row.custom_tax_amount, 2);
        const row_gross = flt(row.custom_gross_amount || (row_net + row_tax), 2);
        const rate_key = (row.custom_tax_rate !== undefined && row.custom_tax_rate !== null ? row.custom_tax_rate : 13) + "%";

        net_total += row_net;
        total_tax += row_tax;
        grand_total += row_gross;

        if (!rate_breakdown[rate_key]) {
            rate_breakdown[rate_key] = { net: 0, tax: 0, gross: 0 };
        }
        rate_breakdown[rate_key].net += row_net;
        rate_breakdown[rate_key].tax += row_tax;
        rate_breakdown[rate_key].gross += row_gross;
    });

    total_tax = flt(total_tax, 2);
    net_total = flt(net_total, 2);
    grand_total = flt(grand_total, 2);

    ashan.tax.get_vat_account(frm, function(vat_acc) {
        if (vat_acc) {
            if (!frm.doc.taxes || frm.doc.taxes.length === 0) {
                const tax_row = frm.add_child("taxes");
                tax_row.charge_type = "Actual";
                tax_row.account_head = vat_acc;
                tax_row.tax_amount = total_tax;
                tax_row.description = "进项税额 (增值税)";
                tax_row.category = "Total";
                tax_row.add_deduct_tax = "Add";
            } else {
                const tax_row = frm.doc.taxes[0];
                tax_row.charge_type = "Actual";
                tax_row.account_head = vat_acc;
                tax_row.tax_amount = total_tax;
                tax_row.description = "进项税额 (增值税)";
            }
            frm.refresh_field("taxes");
        }

        ashan.tax.render_tax_breakdown(frm, net_total, total_tax, grand_total, rate_breakdown);
    });
};

// 渲染清爽简明的财务汇总卡片
ashan.tax.render_tax_breakdown = function(frm, net, tax, grand, breakdown) {
    let $wrapper = frm.get_field("items")?.$wrapper;
    if (!$wrapper || !$wrapper.length) return;

    $wrapper.find("#ashan-tax-breakdown-card").remove();

    let breakdown_chips = Object.keys(breakdown).map(k => {
        return `<span style="background: rgba(0,0,0,0.05); padding: 3px 8px; border-radius: 4px; font-size: 12px; margin-right: 6px; font-weight: 500;">
            税率 <b>${k}</b> (未税: ${ashan.tax.format_money(breakdown[k].net)}元, 税额: ${ashan.tax.format_money(breakdown[k].tax)}元)
        </span>`;
    }).join("");

    let html = `
    <div id="ashan-tax-breakdown-card" style="margin-top: 14px; padding: 16px 20px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px;">
            <div style="display: flex; gap: 32px; align-items: baseline; flex-wrap: wrap;">
                <div>
                    <span style="font-size: 13px; color: #64748b;">未税金额：</span>
                    <span style="font-size: 16px; font-weight: 700; color: #1e293b;">${ashan.tax.format_money(net)} 元</span>
                </div>
                <div>
                    <span style="font-size: 13px; color: #64748b;">税额：</span>
                    <span style="font-size: 16px; font-weight: 700; color: #d97706;">${ashan.tax.format_money(tax)} 元</span>
                </div>
                <div>
                    <span style="font-size: 13px; color: #64748b;">当前单据合计金额：</span>
                    <span style="font-size: 20px; font-weight: 800; color: #2563eb;">${ashan.tax.format_money(grand)} 元</span>
                </div>
            </div>
            <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 6px;">
                ${breakdown_chips}
            </div>
        </div>
    </div>
    `;

    $wrapper.find(".grid-footer").after(html);
};

// -------------------------------------------------------------
// 核心计算函数集
// -------------------------------------------------------------

// 1. 根据【含税单价 gross_rate】倒算
ashan.tax.calc_by_gross_rate = function(frm, cdt, cdn) {
    if (ashan.tax._is_calculating) return;
    ashan.tax._is_calculating = true;
    try {
        const row = locals[cdt][cdn];
        const qty = flt(row.qty) || 1.0;
        const gross_rate = flt(row.custom_gross_rate);
        const tax_rate = flt(row.custom_tax_rate !== undefined && row.custom_tax_rate !== null ? row.custom_tax_rate : 13);

        const gross_amount = flt(qty * gross_rate, 2);
        const net_amount = tax_rate >= 0 ? flt(gross_amount / (1.0 + tax_rate / 100.0), 2) : gross_amount;
        const net_rate = qty ? flt(net_amount / qty, 4) : 0;
        const tax_amount = flt(gross_amount - net_amount, 2);

        frappe.model.set_value(cdt, cdn, {
            rate: net_rate,
            amount: net_amount,
            custom_gross_amount: gross_amount,
            custom_tax_amount: tax_amount
        });
    } finally {
        ashan.tax._is_calculating = false;
    }
    ashan.tax.sync_taxes_and_totals(frm);
    ashan.tax.clean_grid_headers(frm);
};

// 2. 根据【价税合计 gross_amount】倒算 (用户修改总价格)
ashan.tax.calc_by_gross_amount = function(frm, cdt, cdn) {
    if (ashan.tax._is_calculating) return;
    ashan.tax._is_calculating = true;
    try {
        const row = locals[cdt][cdn];
        const qty = flt(row.qty) || 1.0;
        const gross_amount = flt(row.custom_gross_amount);
        const tax_rate = flt(row.custom_tax_rate !== undefined && row.custom_tax_rate !== null ? row.custom_tax_rate : 13);

        const gross_rate = qty ? flt(gross_amount / qty, 4) : 0;
        const net_amount = tax_rate >= 0 ? flt(gross_amount / (1.0 + tax_rate / 100.0), 2) : gross_amount;
        const net_rate = qty ? flt(net_amount / qty, 4) : 0;
        const tax_amount = flt(gross_amount - net_amount, 2);

        frappe.model.set_value(cdt, cdn, {
            custom_gross_rate: gross_rate,
            rate: net_rate,
            amount: net_amount,
            custom_tax_amount: tax_amount
        });
    } finally {
        ashan.tax._is_calculating = false;
    }
    ashan.tax.sync_taxes_and_totals(frm);
    ashan.tax.clean_grid_headers(frm);
};

// 3. 根据【不含税单价 rate】正算
ashan.tax.calc_by_net_rate = function(frm, cdt, cdn) {
    if (ashan.tax._is_calculating) return;
    ashan.tax._is_calculating = true;
    try {
        const row = locals[cdt][cdn];
        const qty = flt(row.qty) || 1.0;
        const net_rate = flt(row.rate);
        const tax_rate = flt(row.custom_tax_rate !== undefined && row.custom_tax_rate !== null ? row.custom_tax_rate : 13);

        const net_amount = flt(qty * net_rate, 2);
        const tax_amount = flt(net_amount * (tax_rate / 100.0), 2);
        const gross_amount = flt(net_amount + tax_amount, 2);
        const gross_rate = qty ? flt(gross_amount / qty, 4) : 0;

        frappe.model.set_value(cdt, cdn, {
            amount: net_amount,
            custom_gross_rate: gross_rate,
            custom_gross_amount: gross_amount,
            custom_tax_amount: tax_amount
        });
    } finally {
        ashan.tax._is_calculating = false;
    }
    ashan.tax.sync_taxes_and_totals(frm);
    ashan.tax.clean_grid_headers(frm);
};

// 4. 税额微调 (支持发票尾差)
ashan.tax.calc_by_tax_amount = function(frm, cdt, cdn) {
    if (ashan.tax._is_calculating) return;
    ashan.tax._is_calculating = true;
    try {
        const row = locals[cdt][cdn];
        const qty = flt(row.qty) || 1.0;
        const net_amount = flt(row.amount);
        const tax_amount = flt(row.custom_tax_amount);
        const gross_amount = flt(net_amount + tax_amount, 2);
        const gross_rate = qty ? flt(gross_amount / qty, 4) : 0;

        frappe.model.set_value(cdt, cdn, {
            custom_gross_amount: gross_amount,
            custom_gross_rate: gross_rate
        });
    } finally {
        ashan.tax._is_calculating = false;
    }
    ashan.tax.sync_taxes_and_totals(frm);
    ashan.tax.clean_grid_headers(frm);
};

// -------------------------------------------------------------
// 事件监听注册
// -------------------------------------------------------------

frappe.ui.form.on("Purchase Invoice", {
    onload: function(frm) {
        ashan.tax.simplify_invoice_form(frm);
    },
    refresh: function(frm) {
        ashan.tax.simplify_invoice_form(frm);
        ashan.tax.sync_taxes_and_totals(frm);
    },
    custom_invoice_type: function(frm) {
        ashan.tax.handle_invoice_type(frm);
    },
    bill_no: function(frm) {
        ashan.tax.check_bill_no_duplicate(frm);
    },
    validate: function(frm) {
        ashan.tax.sync_taxes_and_totals(frm);
    }
});

frappe.ui.form.on("Purchase Invoice Item", {
    form_render: function(frm, cdt, cdn) {
    },
    item_code: function(frm, cdt, cdn) {
        const row = locals[cdt][cdn];
        let updates = {};
        if (row.custom_tax_rate === undefined || row.custom_tax_rate === null || row.custom_tax_rate === "") {
            updates.custom_tax_rate = 13;
        }
        if (!flt(row.qty)) {
            updates.qty = 1;
        }
        if (Object.keys(updates).length) {
            frappe.model.set_value(cdt, cdn, updates);
        }
        ashan.tax.clean_grid_headers(frm);
    },

    // 1. 录入含税单价 -> 自动计算价税合计、不含税单价、不含税金额、税额
    custom_gross_rate: function(frm, cdt, cdn) {
        ashan.tax.calc_by_gross_rate(frm, cdt, cdn);
    },

    // 2. 录入价税合计 -> 自动修改含税单价、不含税单价、不含税金额、税额
    custom_gross_amount: function(frm, cdt, cdn) {
        ashan.tax.calc_by_gross_amount(frm, cdt, cdn);
    },

    // 3. 数量变动
    qty: function(frm, cdt, cdn) {
        const row = locals[cdt][cdn];
        if (flt(row.custom_gross_rate) > 0) {
            ashan.tax.calc_by_gross_rate(frm, cdt, cdn);
        } else if (flt(row.custom_gross_amount) > 0) {
            ashan.tax.calc_by_gross_amount(frm, cdt, cdn);
        } else if (flt(row.rate) > 0) {
            ashan.tax.calc_by_net_rate(frm, cdt, cdn);
        }
    },

    // 4. 税率变动 (13%, 9%, 6%, 0% 等)
    custom_tax_rate: function(frm, cdt, cdn) {
        const row = locals[cdt][cdn];
        if (flt(row.custom_gross_rate) > 0) {
            ashan.tax.calc_by_gross_rate(frm, cdt, cdn);
        } else if (flt(row.custom_gross_amount) > 0) {
            ashan.tax.calc_by_gross_amount(frm, cdt, cdn);
        } else if (flt(row.rate) > 0) {
            ashan.tax.calc_by_net_rate(frm, cdt, cdn);
        }
    },

    // 5. 录入不含税单价 -> 自动正算出税额与价税合计
    rate: function(frm, cdt, cdn) {
        ashan.tax.calc_by_net_rate(frm, cdt, cdn);
    },

    // 6. 税额微调 (解决发票尾差)
    custom_tax_amount: function(frm, cdt, cdn) {
        ashan.tax.calc_by_tax_amount(frm, cdt, cdn);
    },

    items_remove: function(frm) {
        ashan.tax.sync_taxes_and_totals(frm);
        ashan.tax.clean_grid_headers(frm);
    },

    items_add: function(frm, cdt, cdn) {
        frappe.model.set_value(cdt, cdn, {
            custom_tax_rate: 13,
            qty: 1
        });
        ashan.tax.clean_grid_headers(frm);
    }
});
