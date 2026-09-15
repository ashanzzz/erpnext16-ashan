// Copyright (c) 2026, Ashan CN Procurement and contributors
// For license information, please see license.txt

(function () {
    "use strict";

    const IMPORT_METHOD = "ashan_cn_procurement.reimbursement.api.import_unpaid_purchase_invoices";
    const PREVIEW_METHOD = "ashan_cn_procurement.reimbursement.api.preview_unpaid_purchase_invoice_items";
    const FILTER_OPTIONS_METHOD = "ashan_cn_procurement.reimbursement.api.get_unpaid_purchase_invoice_filter_options";
    const PICKER_ROWS_METHOD = "ashan_cn_procurement.reimbursement.api.get_unpaid_purchase_invoice_picker_rows";
    const BUTTON_LABEL = __("获取未付款发票");
    const MODE_STORAGE_KEY = "ashan_cn_procurement.reimbursement_picker_mode";

    frappe.ui.form.on("Reimbursement Request", {
        refresh(frm) {
            lock_invoice_item_grid(frm);
            add_unpaid_invoice_action(frm);
        },
    });

    // The app bundle can load after a directly-opened form has refreshed.
    // A form custom button survives form refresh/save; page secondary actions do not.
    frappe.router.on("change", () => {
        window.setTimeout(() => add_unpaid_invoice_action(window.cur_frm), 150);
    });

    function add_unpaid_invoice_action(frm) {
        if (!frm || frm.doctype !== "Reimbursement Request" || !frm.page) return;
        frm.remove_custom_button(BUTTON_LABEL);
        frm.add_custom_button(BUTTON_LABEL, () => open_unpaid_invoice_picker(frm));
    }

    // Frappe v16's Customize Form only persists DocField schema properties.
    // These are native Grid runtime flags, so keep them beside the picker that
    // is the only supported way to create reimbursement detail rows.
    function lock_invoice_item_grid(frm) {
        const field = frm.get_field("invoice_items");
        if (!field || !field.grid) return;
        field.df.cannot_add_rows = 1;
        field.df.cannot_delete_rows = 1;
        field.grid.cannot_add_rows = true;
        field.grid.refresh();
    }

    function open_unpaid_invoice_picker(frm) {
        if (!frm.doc.company) {
            frappe.msgprint(__("请先填写公司。"));
            return;
        }
        frappe.call({
            method: FILTER_OPTIONS_METHOD,
            args: { company: frm.doc.company },
            callback(response) {
                show_unpaid_invoice_picker(frm, (response.message || {}).invoice_types || []);
            },
        });
    }

    function show_unpaid_invoice_picker(frm, invoiceTypes) {
        let mode = load_mode();
        let rows = [];
        let refreshTimer;
        let latestRequest = 0;
        const pendingSources = new Map();
        const confirmedImportedSources = new Set();
        const invoiceTypeOptions = ["<option value=\"\">全部类型</option>"]
            .concat(invoiceTypes.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`))
            .join("");
        const html = `
            <style>
                .rr-picker-modal .modal-dialog { width: 94vw; max-width: 1540px; }
                .rr-picker-modal .modal-body { max-height: calc(100vh - 170px); overflow: hidden; }
                .rr-picker-tabs { display: flex; gap: 6px; margin-bottom: 12px; }
                .rr-picker-mode { min-width: 94px; }
                .rr-picker-mode.active { background: var(--primary); border-color: var(--primary); color: #fff; }
                .rr-picker-help { color: var(--text-muted); font-size: 12px; margin: -4px 0 12px; }
                .rr-picker-filters { display: grid; grid-template-columns: repeat(4, minmax(150px, 1fr)); gap: 10px; align-items: end; }
                .rr-picker-filters label { color: var(--text-muted); font-size: 12px; margin-bottom: 4px; }
                .rr-picker-toolbar { display: flex; align-items: center; gap: 8px; margin: 12px 0 8px; }
                .rr-picker-status { color: var(--text-muted); font-size: 12px; flex: 1; }
                .rr-picker-scroll { max-height: 480px; overflow: auto; border: 1px solid var(--border-color); border-radius: var(--border-radius-md); }
                .rr-picker-table { width: 100%; border-collapse: collapse; font-size: 12px; }
                .rr-picker-table th, .rr-picker-table td { padding: 9px 8px; border-bottom: 1px solid var(--border-color); vertical-align: top; }
                .rr-picker-table th { position: sticky; top: 0; z-index: 1; background: var(--fg-color); color: var(--text-muted); font-weight: 600; white-space: nowrap; }
                .rr-picker-table tr.rr-picker-row { cursor: pointer; }
                .rr-picker-table tr.rr-picker-row:hover { background: var(--subtle-fg); }
                .rr-picker-table tr.rr-picker-row.is-selected { background: color-mix(in srgb, var(--primary) 8%, transparent); }
                .rr-picker-item-summary { color: var(--text-muted); line-height: 1.45; }
                .rr-picker-amount { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
                .rr-picker-summary { margin-top: 10px; padding: 10px 12px; background: var(--subtle-fg); border-radius: var(--border-radius-md); text-align: right; }
                .rr-picker-empty { color: var(--text-muted); padding: 28px; text-align: center; }
                @media (max-width: 900px) { .rr-picker-filters { grid-template-columns: repeat(2, minmax(150px, 1fr)); } }
            </style>
            <div class="rr-picker-tabs">
                <button type="button" class="btn btn-default btn-sm rr-picker-mode" data-mode="invoice">发票选单</button>
                <button type="button" class="btn btn-default btn-sm rr-picker-mode" data-mode="item">明细选单</button>
            </div>
            <div class="rr-picker-help">发票选单按整张发票选择；明细选单按物料行选择。两种模式共享已选内容，已导入来源会自动排除。</div>
            <div class="rr-picker-filters">
                <div><label>发票号</label><input class="form-control rr-picker-filter" data-filter="bill_no" placeholder="包含匹配"></div>
                <div><label>发票日期（起）</label><input type="date" class="form-control rr-picker-filter" data-filter="bill_date_from"></div>
                <div><label>发票日期（止）</label><input type="date" class="form-control rr-picker-filter" data-filter="bill_date_to"></div>
                <div><label>发票类型</label><select class="form-control rr-picker-filter" data-filter="custom_invoice_type">${invoiceTypeOptions}</select></div>
                <div><label>供应商</label><input class="form-control rr-picker-filter" data-filter="supplier" placeholder="包含匹配"></div>
                <div><label>物料名</label><input class="form-control rr-picker-filter" data-filter="item_name" placeholder="包含匹配"></div>
                <div><label>待付金额（最小）</label><input type="number" min="0" step="0.01" class="form-control rr-picker-filter" data-filter="min_outstanding_amount"></div>
                <div><label>待付金额（最大）</label><input type="number" min="0" step="0.01" class="form-control rr-picker-filter" data-filter="max_outstanding_amount"></div>
            </div>
            <div class="rr-picker-toolbar">
                <span class="rr-picker-status">正在加载未付款采购发票…</span>
                <button type="button" class="btn btn-default btn-sm rr-picker-refresh">刷新</button>
                <button type="button" class="btn btn-default btn-sm rr-picker-select-page">全选当前结果</button>
                <button type="button" class="btn btn-default btn-sm rr-picker-clear">清空选择</button>
            </div>
            <div class="rr-picker-scroll"><table class="rr-picker-table"><thead class="rr-picker-head"></thead><tbody class="rr-picker-body"></tbody></table></div>
            <div class="rr-picker-summary">已选 <strong class="rr-picker-count">0</strong> 项，可导入合计 <strong class="rr-picker-total">0.00元</strong></div>
        `;
        const dialog = new frappe.ui.Dialog({
            title: __("选择未付款采购发票"),
            size: "extra-large",
            fields: [{ fieldtype: "HTML", fieldname: "picker", options: html }],
            primary_action_label: __("确认导入"),
            primary_action() {
                import_selected_sources(frm, pendingSources, confirmedImportedSources, dialog);
            },
        });
        dialog.show();
        dialog.$wrapper.addClass("rr-picker-modal");
        const $root = dialog.$wrapper;

        $root.on("input change", ".rr-picker-filter", () => {
            window.clearTimeout(refreshTimer);
            refreshTimer = window.setTimeout(refresh_rows, 250);
        });
        $root.on("click", ".rr-picker-refresh", refresh_rows);
        $root.on("click", ".rr-picker-mode", function () {
            mode = $(this).data("mode");
            save_mode(mode);
            refresh_rows();
        });
        $root.on("click", ".rr-picker-select-page", () => {
            rows.forEach((row) => select_row_sources(row, true));
            render_rows();
        });
        $root.on("click", ".rr-picker-clear", () => {
            pendingSources.clear();
            render_rows();
        });
        $root.on("change", ".rr-picker-select-all", function () {
            rows.forEach((row) => select_row_sources(row, this.checked));
            render_rows();
        });
        $root.on("change", ".rr-picker-row-check", function () {
            const row = rows.find((candidate) => candidate.name === String($(this).data("key")));
            if (row) select_row_sources(row, this.checked);
            render_rows();
        });
        $root.on("click", ".rr-picker-row", function (event) {
            if ($(event.target).closest("input, button, select, a, label").length) return;
            const row = rows.find((candidate) => candidate.name === String($(this).data("key")));
            if (!row) return;
            select_row_sources(row, !is_row_fully_selected(row));
            render_rows();
        });

        function get_filters() {
            const filters = {};
            $root.find(".rr-picker-filter").each(function () {
                filters[$(this).data("filter")] = $(this).val();
            });
            return filters;
        }

        function get_imported_sources() {
            const sources = new Set(confirmedImportedSources);
            (frm.doc.invoice_items || []).forEach((row) => {
                if (row.source_pi_item) sources.add(row.source_pi_item);
            });
            return sources;
        }

        function select_row_sources(row, shouldSelect) {
            source_amounts_for_row(row).forEach(({ name, amount }) => {
                if (shouldSelect) pendingSources.set(name, amount);
                else pendingSources.delete(name);
            });
        }

        function source_amounts_for_row(row) {
            if (mode === "item") {
                return [{ name: row.source_pi_item, amount: Number(row.available_amount) || 0 }];
            }
            return Object.entries(row.source_item_amounts || {}).map(([name, amount]) => ({ name, amount: Number(amount) || 0 }));
        }

        function is_row_fully_selected(row) {
            const sources = source_amounts_for_row(row);
            return sources.length > 0 && sources.every(({ name }) => pendingSources.has(name));
        }

        function refresh_rows() {
            const requestNumber = ++latestRequest;
            $root.find(".rr-picker-status").text(__("正在筛选…"));
            frappe.call({
                method: PICKER_ROWS_METHOD,
                args: {
                    company: frm.doc.company,
                    filters: get_filters(),
                    mode,
                    reimbursement_request_name: frm.is_new() ? null : frm.doc.name,
                    excluded_purchase_invoice_item_names: [...get_imported_sources()],
                },
                callback(response) {
                    if (requestNumber !== latestRequest) return;
                    rows = (response.message || {}).rows || [];
                    $root.find(".rr-picker-status").text(__("共 {0} 条可导入来源", [rows.length]));
                    render_rows();
                },
                error() {
                    if (requestNumber === latestRequest) $root.find(".rr-picker-status").text(__("加载失败，请刷新后重试。"));
                },
            });
        }

        function render_rows() {
            const imported = get_imported_sources();
            imported.forEach((name) => pendingSources.delete(name));
            $root.find(".rr-picker-mode").removeClass("active").filter(`[data-mode="${mode}"]`).addClass("active");
            $root.find(".rr-picker-head").html(render_header());
            const columnCount = mode === "item" ? 10 : 8;
            const content = rows.length ? rows.map((row) => render_row(row)).join("") :
                `<tr><td colspan="${columnCount}" class="rr-picker-empty">没有符合条件的可导入来源。</td></tr>`;
            $root.find(".rr-picker-body").html(content);
            $root.find(".rr-picker-row-check").each(function () {
                if ($(this).data("partial")) $(this).prop("indeterminate", true);
            });
            $root.find(".rr-picker-select-all").prop("checked", rows.length > 0 && rows.every((row) => is_row_fully_selected(row)));
            render_summary();
        }

        function render_header() {
            if (mode === "item") {
                return `<tr><th style="width:42px"><input type="checkbox" class="rr-picker-select-all" title="全选当前结果"></th><th>单据日期</th><th>发票号</th><th>发票日期</th><th>供应商</th><th>物料名称</th><th>规格</th><th class="rr-picker-amount">数量</th><th>单位</th><th class="rr-picker-amount">可导入待付金额</th></tr>`;
            }
            return `<tr><th style="width:42px"><input type="checkbox" class="rr-picker-select-all" title="全选当前结果"></th><th>单据日期</th><th>发票号</th><th>发票日期</th><th>发票类型</th><th>供应商</th><th>可导入物料</th><th class="rr-picker-amount">可导入待付金额</th></tr>`;
        }

        function render_row(row) {
            const sources = source_amounts_for_row(row);
            const selectedCount = sources.filter(({ name }) => pendingSources.has(name)).length;
            const selected = selectedCount > 0;
            const checked = selectedCount === sources.length && sources.length > 0;
            const check = `<input type="checkbox" class="rr-picker-row-check" data-key="${escapeHtml(row.name)}" data-partial="${selected && !checked}" ${checked ? "checked" : ""}>`;
            if (mode === "item") {
                return `<tr class="rr-picker-row ${selected ? "is-selected" : ""}" data-key="${escapeHtml(row.name)}"><td>${check}</td><td>${escapeHtml(row.posting_date || "")}</td><td>${escapeHtml(row.bill_no || row.source_pi)}</td><td>${escapeHtml(row.bill_date || "")}</td><td>${escapeHtml(row.supplier || "")}</td><td>${escapeHtml(row.item_name || "")}</td><td class="rr-picker-item-summary">${escapeHtml(row.description || "")}</td><td class="rr-picker-amount">${format_number(row.qty)}</td><td>${escapeHtml(row.uom || "")}</td><td class="rr-picker-amount">${format_yuan(row.available_amount)}</td></tr>`;
            }
            return `<tr class="rr-picker-row ${selected ? "is-selected" : ""}" data-key="${escapeHtml(row.name)}"><td>${check}</td><td>${escapeHtml(row.posting_date || "")}</td><td>${escapeHtml(row.bill_no || row.name)}</td><td>${escapeHtml(row.bill_date || "")}</td><td>${escapeHtml(row.custom_invoice_type || "")}</td><td>${escapeHtml(row.supplier || "")}</td><td class="rr-picker-item-summary">${escapeHtml(row.item_summary || "—")}</td><td class="rr-picker-amount">${format_yuan(row.available_amount)}</td></tr>`;
        }

        function render_summary() {
            const amount = [...pendingSources.values()].reduce((total, value) => total + value, 0);
            $root.find(".rr-picker-count").text(pendingSources.size);
            $root.find(".rr-picker-total").text(format_yuan(amount));
        }

        refresh_rows();
    }

    function import_selected_sources(frm, pendingSources, confirmedImportedSources, dialog) {
        const sourceItemNames = [...pendingSources.keys()];
        if (!sourceItemNames.length) {
            frappe.show_alert({ message: __("请选择至少一项可导入来源。"), indicator: "orange" }, 4);
            return;
        }
        const isNew = frm.is_new();
        const existingSources = (frm.doc.invoice_items || []).map((row) => row.source_pi_item).filter(Boolean);
        frappe.call({
            method: isNew ? PREVIEW_METHOD : IMPORT_METHOD,
            args: {
                ...(isNew ? {
                    company: frm.doc.company,
                    excluded_purchase_invoice_item_names: existingSources,
                } : { reimbursement_request_name: frm.doc.name }),
                purchase_invoice_item_names: sourceItemNames,
            },
            freeze: true,
            freeze_message: __("正在核验并导入来源明细…"),
            callback(response) {
                const result = response.message || {};
                const importedSources = result.imported_source_items || (result.items || []).map((item) => item.source_pi_item);
                importedSources.forEach((name) => {
                    pendingSources.delete(name);
                    confirmedImportedSources.add(name);
                });
                if (isNew) {
                    const importedItems = result.items || [];
                    if (importedItems.length) remove_empty_invoice_item_rows(frm);
                    importedItems.forEach((item) => frm.add_child("invoice_items", item));
                    frm.refresh_field("invoice_items");
                } else {
                    frm.reload_doc();
                }
                dialog.hide();
                add_unpaid_invoice_action(frm);
                if (!isNew) window.setTimeout(() => add_unpaid_invoice_action(frm), 700);
                frappe.show_alert({
                    message: __("已导入 {0} 行，可报销合计 {1}。", [result.imported_count || 0, format_yuan(result.imported_amount || 0)]),
                    indicator: "green",
                }, 6);
            },
        });
    }

    function remove_empty_invoice_item_rows(frm) {
        const rows = frm.doc.invoice_items || [];
        const keptRows = rows.filter((row) => !is_empty_invoice_item_row(row));
        if (keptRows.length !== rows.length) frm.doc.invoice_items = keptRows;
    }

    function is_empty_invoice_item_row(row) {
        return !row.source_pi_item
            && !row.source_pi
            && !row.item_name
            && !row.description
            && !row.invoice_no
            && !row.supplier
            && !row.custom_line_remark
            && !Number(row.rate)
            && !Number(row.amount);
    }

    function load_mode() {
        try {
            const mode = window.localStorage.getItem(MODE_STORAGE_KEY);
            return mode === "item" ? "item" : "invoice";
        } catch (error) {
            return "invoice";
        }
    }

    function save_mode(mode) {
        try {
            window.localStorage.setItem(MODE_STORAGE_KEY, mode);
        } catch (error) {
            // Mode preference is only an enhancement; private browsing may reject storage.
        }
    }

    function format_yuan(value) {
        return `${format_number(value)}元`;
    }

    function format_number(value) {
        return (Number(value) || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function escapeHtml(value) {
        return $("<div>").text(value == null ? "" : String(value)).html();
    }
})();
