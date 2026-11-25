// Copyright (c) 2026, Ashan CN Procurement and contributors
// For license information, please see license.txt

frappe.pages["monthly-settlement-picker"].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __("月结补录"),
        single_column: true,
    });

    $(page.wrapper).find(".page-head").hide();
    wrapper.monthly_picker = new MonthlySettlementPicker(page);
};

frappe.pages["monthly-settlement-picker"].on_page_show = function (wrapper) {
    if (wrapper.monthly_picker) {
        if (typeof wrapper.monthly_picker.show === "function") {
            wrapper.monthly_picker.show();
        } else if (typeof wrapper.monthly_picker.refresh_all === "function") {
            wrapper.monthly_picker.refresh_all();
        }
    }
};

class MonthlySettlementPicker {
    constructor(page) {
        this.page = page;
        this.active_company = window.AshanWorkContext?.getCompany?.() || "All";
        this.companies = [];
        this.view_mode = "doc"; // doc | detail
        this.match_status = "pending"; // pending | completed | all
        this._user_selected_match_status = false;
        this.selected_items = new Set();
        this.cached_rows = [];
        this.kpis = {};

        this.init();
    }

    show() {
        this.adjust_table_height();
        const globalComp = window.AshanWorkContext?.getCompany?.() || "";
        if (globalComp && (this.companies.some((c) => c.name === globalComp) || globalComp === "All") && this.active_company !== globalComp) {
            this.active_company = globalComp;
            this._user_selected_match_status = false;
            $("#monthly-company-select").val(globalComp);
        }
        this.refresh_all();
    }

    async init() {
        this.render_layout();
        await this.load_companies();
        this.bind_global_events();
        this.refresh_all();
    }

    render_layout() {
        const html = `
            <div class="picker-page-container">
                <!-- Top Header (Unified Unboxed Standard) -->
                <div class="picker-top-bar ashan-clean-title-bar">
                    <div class="picker-title-group">
                        <h2>月结补录</h2>
                    </div>
                </div>

                <!-- Filter Controls Bar -->
                <div class="picker-filter-bar" id="monthly-filter-bar">
                    <div class="picker-filter-group" id="monthly-invoicing-filter-group">
                        <label>开票状态:</label>
                        <div class="picker-status-btn-group" id="monthly-status-btn-group">
                            <button type="button" class="picker-status-btn active" data-status="pending">待开票入库</button>
                            <button type="button" class="picker-status-btn" data-status="completed">已开票入库</button>
                            <button type="button" class="picker-status-btn" data-status="all">全部入库单据</button>
                        </div>
                    </div>
                    <div class="picker-filter-group">
                        <label>供应商:</label>
                        <input type="text" class="picker-filter-input" data-filter="supplier" placeholder="搜索月结供应商..." />
                    </div>
                    <div class="picker-filter-group">
                        <label>入库单号:</label>
                        <input type="text" class="picker-filter-input" data-filter="pr_name" placeholder="入库单号..." />
                    </div>
                    <div class="picker-filter-group">
                        <label>物料编码/名称:</label>
                        <input type="text" class="picker-filter-input" data-filter="item_code" placeholder="搜索物料..." />
                    </div>
                    <div class="picker-filter-group">
                        <label>经手人:</label>
                        <input type="text" class="picker-filter-input" data-filter="owner" placeholder="录单人..." />
                    </div>
                </div>

                <!-- Action Bar (View Switcher + Selection Summary + Primary Actions) -->
                <div class="picker-action-bar">
                    <div class="picker-summary-text">
       <div class="picker-view-switch-group">
                            <button type="button" class="picker-view-btn active" data-mode="doc">单号视图</button>
                            <button type="button" class="picker-view-btn" data-mode="detail">明细视图</button>
                        </div>
                        <span>已选 <strong class="picker-summary-highlight" id="monthly-selected-count">0</strong> 项</span>
                        <span>本次总计: <strong class="picker-summary-highlight" id="monthly-selected-amount">¥ 0.00</strong></span>
                    </div>
                    <div class="picker-btn-group">
                        <button type="button" class="picker-btn-secondary" id="monthly-select-all-btn">全选本页</button>
                        <button type="button" class="picker-btn-secondary" id="monthly-clear-sel-btn">清空选择</button>
                        <button type="button" class="picker-btn-primary" id="monthly-open-create-modal-btn">新建月结入库补录</button>
                    </div>
                </div>

                <!-- Big Wide Data Table Container (Canonical ashan-table-card Architecture) -->
                <div class="ashan-table-card picker-table-wrapper si-table-card">
                    <!-- Main Table Scroll Area -->
                    <div class="ashan-table-wrapper picker-main-table-scroll si-table-wrapper" id="monthly-main-table-scroll">
                        <table class="picker-data-table ashan-data-table" id="monthly-data-table">
                            <thead id="monthly-table-thead"></thead>
                            <tbody id="monthly-table-tbody">
                                <tr>
                                    <td colspan="15" class="picker-empty-box ashan-empty-cell">
                                        <div class="ashan-empty-state-inner">
                                            <div class="si-empty-desc">正在加载月结单据...</div>
                                        </div>
                                    </td>
                                </tr>
                            </tbody>
                            <tfoot id="monthly-table-tfoot"></tfoot>
                        </table>
                    </div>
                </div>
            </div>
        `;
        $(this.page.body).html(html);
        if (this.view_mode === "detail") {
            this.render_detail_view();
        } else {
            this.render_doc_view();
        }
    }

    async load_companies() {
        try {
            const r = await frappe.call({
                method: "ashan_cn_procurement.services.procurement_picker_service.get_user_procurement_companies",
            });
            if (r.message && r.message.companies) {
                const comp_names = r.message.companies;
                this.companies = comp_names.map((name) => ({ name, company_name: name }));
                const $select = $("#monthly-company-select");
                $select.empty();
                if (this.companies.length > 1) {
                    $select.append(`<option value="All">全部公司</option>`);
                }
                this.companies.forEach((c) => {
                    $select.append(`<option value="${c.name}">${frappe.utils.escape_html(c.company_name || c.name)}</option>`);
                });
                if (!this.companies.some((company) => company.name === this.active_company)) {
                    this.active_company = this.companies.length === 1 ? this.companies[0].name : "All";
                }
                $select.val(this.active_company);
            }
        } catch (e) {
            console.error("Failed to load companies for monthly settlement picker:", e);
        }
    }

    bind_global_events() {
        const self = this;

        this.get_table_runtime().bindCompanySync({
            namespace: "monthly",
            selectEl: "#monthly-company-select",
            onSelectCompany: (val) => {
                self.active_company = val;
                self._user_selected_match_status = false;
                self.selected_items.clear();
                self.refresh_all();
            },
            onContextChange: (selectedCompany) => {
                if (selectedCompany === self.active_company) return;
                if (selectedCompany !== "All" && !self.companies.some((company) => company.name === selectedCompany)) return;
                self.active_company = selectedCompany;
                self._user_selected_match_status = false;
                self.selected_items.clear();
                self.refresh_all();
            },
        });
        this.get_table_runtime().bindResize();

        // Filter button group
        $("#monthly-status-btn-group").on("click", ".picker-status-btn", function () {
            $(this).siblings().removeClass("active");
            $(this).addClass("active");
            self.match_status = $(this).data("status");
            self._user_selected_match_status = true;
            self.selected_items.clear();
            self.load_table_data();
        });

        // Search inputs with debounce
        let search_timer = null;
        $("#monthly-filter-bar").on("input change", "input[data-filter]", function () {
            clearTimeout(search_timer);
            search_timer = setTimeout(() => {
                self.selected_items.clear();
                self.load_table_data();
            }, 300);
        });

        // View mode switch
        $(this.page.body).find(".picker-view-switch-group").on("click", ".picker-view-btn", function () {
            $(this).siblings().removeClass("active");
            $(this).addClass("active");
            self.view_mode = $(this).data("mode");
            self.selected_items.clear();
            self.load_table_data();
        });

        // Select All / Clear Select
        $("#monthly-select-all-btn").on("click", function () {
            self.cached_rows.forEach((r) => {
                const key = self.view_mode === "detail" ? r.pri_name : r.pr_name;
                self.selected_items.add(key);
            });
            self.update_selection_summary();
            self.sync_checkbox_states();
        });

        $("#monthly-clear-sel-btn").on("click", function () {
            self.selected_items.clear();
            self.update_selection_summary();
            self.sync_checkbox_states();
        });

        // Checkbox change in table
        $("#monthly-table-tbody").on("change", ".picker-row-checkbox", function () {
            const key = $(this).data("key");
            if ($(this).is(":checked")) {
                self.selected_items.add(key);
            } else {
                self.selected_items.delete(key);
            }
            self.update_selection_summary();
        });

        // Open create modal
        $("#monthly-open-create-modal-btn").on("click", function () {
            self.open_create_monthly_receipt_modal();
        });

        // Table drill-down
        $("#monthly-table-tbody").on("click", ".picker-clickable-doc, .picker-doc-clickable-link", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const dt = $(this).data("doctype");
            const dn = $(this).data("name");
            if (dt && dn) {
                self.show_doc_detail_modal(dt, dn);
            }
        });

        $("#monthly-table-tbody").on("click", "tr[data-doctype][data-name]", function (e) {
            const $chkCell = $(e.target).closest("td.picker-col-sticky-2, td.picker-col-checkbox, td:has(input.picker-row-checkbox)");
            if ($chkCell.length) {
                if (!$(e.target).is("input[type='checkbox']")) {
                    const $cb = $chkCell.find("input.picker-row-checkbox");
                    if ($cb.length) {
                        $cb.prop("checked", !$cb.prop("checked")).trigger("change");
                    }
                }
                return;
            }

            if ($(e.target).closest("input, button, a, .picker-clickable-doc, .ashan-tag-badge").length) {
                return;
            }
            const dt = $(this).attr("data-doctype");
            const dn = $(this).attr("data-name");
            if (dt && dn) {
                self.show_doc_detail_modal(dt, dn);
            }
        });

        // Mousewheel-to-Horizontal Scroll
        this.bind_wheel_horizontal_scroll();
    }

    bind_wheel_horizontal_scroll() {
        this.get_table_runtime().bindWheel();
    }

    sync_top_scrollbar_width() {
        // 顶部辅助滚动条已废弃，统一使用 ashan-table-wrapper 底端滚动结构
    }

    get_current_filters() {
        const filters = {
            match_status: this.match_status,
        };
        $("#monthly-filter-bar input[data-filter]").each(function () {
            const k = $(this).data("filter");
            const v = $(this).val().trim();
            if (v) filters[k] = v;
        });
        return filters;
    }

    sync_status_btn_ui() {
        const $group = $("#monthly-status-btn-group");
        $group.find(".picker-status-btn").removeClass("active");
        $group.find(`.picker-status-btn[data-status="${this.match_status}"]`).addClass("active");
    }

    auto_adapt_default_match_status() {
        if (this._user_selected_match_status) return;
        const pendingCount = Number(this.kpis?.pending_item_count || 0);
        this.match_status = pendingCount > 0 ? "pending" : "all";
        this.sync_status_btn_ui();
    }

    async refresh_all() {
        await this.load_kpis();
        this.auto_adapt_default_match_status();
        await this.load_table_data();
    }

    async load_kpis() {
        try {
            const r = await frappe.call({
                method: "ashan_cn_procurement.services.monthly_settlement_service.get_monthly_settlement_overview_kpis",
                args: { company: this.active_company },
            });
            if (r.message) {
                this.kpis = r.message;
                const pending = this.kpis.pending_item_count || 0;
                const unbilled = this.fmt_money(this.kpis.pending_unbilled_amount || 0);
                $("#monthly-total-summary-badge").text(`待开票: ${pending} 笔 | 金额: ${unbilled}`);
            }
        } catch (e) {
            console.error("Failed to load KPIs:", e);
        }
    }

    async load_table_data() {
        const request_id = (this._table_request_id || 0) + 1;
        this._table_request_id = request_id;
        const method = this.view_mode === "detail"
            ? "ashan_cn_procurement.services.monthly_settlement_service.get_monthly_settlement_picker_rows"
            : "ashan_cn_procurement.services.monthly_settlement_service.get_monthly_settlement_doc_summary_rows";

        try {
            const r = await frappe.call({
                method: method,
                args: {
                    company: this.active_company,
                    filters: this.get_current_filters(),
                },
            });
            if (request_id !== this._table_request_id) return;
            if (r.message) {
                this.cached_rows = r.message.rows || [];
                // monthly badge removed
                if (this.view_mode === "detail") {
                    this.render_detail_view();
                } else {
                    this.render_doc_view();
                }
                this.sync_top_scrollbar_width();
                this.update_selection_summary();
            }
        } catch (e) {
            if (request_id !== this._table_request_id) return;
            console.error("Failed to load table data:", e);
        }
    }

    can_manage_invoicing() {
        if (frappe.model && typeof frappe.model.can_create === "function") {
            return frappe.model.can_create("Purchase Invoice");
        }
        if (frappe.boot && frappe.boot.user && Array.isArray(frappe.boot.user.can_create)) {
            return frappe.boot.user.can_create.includes("Purchase Invoice");
        }
        return false;
    }

    can_auto_issue_stock() {
        if (this.kpis && typeof this.kpis.can_auto_issue_stock === "boolean") {
            return this.kpis.can_auto_issue_stock;
        }
        const canCreate = (frappe.model && typeof frappe.model.can_create === "function")
            ? frappe.model.can_create("Stock Entry")
            : Boolean(frappe.boot?.user?.can_create?.includes("Stock Entry"));
        const canSubmit = (frappe.model && typeof frappe.model.can_submit === "function")
            ? frappe.model.can_submit("Stock Entry")
            : Boolean(frappe.boot?.user?.can_submit?.includes("Stock Entry"));
        return Boolean(canCreate && canSubmit);
    }

    get_table_runtime() {
        if (this._tableRuntime) return this._tableRuntime;
        const self = this;
        this._tableRuntime = AshanUI.createTableProfileRuntime({
            name: "monthly_settlement_picker",
            bottomMargin: 24,
            minHeight: 360,
            getSelectors: () => ({
                scrollEl: $(self.page.body).find("#monthly-main-table-scroll")[0],
                thead: "#monthly-table-thead",
                tbody: "#monthly-table-tbody",
                tfoot: "#monthly-table-tfoot",
            }),
            getRowKey: (r) => (self.view_mode === "detail" ? r.pri_name : r.pr_name),
            getHeaderSpec: () => {
                const is_all = self.active_company === "All";
                const can_invoice = self.can_manage_invoicing();
                return {
                    key: `${self.view_mode}|${is_all ? "ALL" : "SINGLE"}|${can_invoice ? 1 : 0}`,
                    html: self.build_header_html(),
                };
            },
            buildRowHtml: (r, idx) => (self.view_mode === "detail" ? self.build_detail_row_html(r, idx) : self.build_doc_row_html(r, idx)),
            getEmptySpec: () => {
                const is_all = self.active_company === "All";
                const can_invoice = self.can_manage_invoicing();
                const total_cols = self.view_mode === "detail"
                    ? ((is_all ? 3 : 2) + 13 + (can_invoice ? 3 : 0))
                    : ((is_all ? 3 : 2) + 7 + (can_invoice ? 3 : 0));
                const msg = self.view_mode === "detail"
                    ? "当前暂无月结入库补录记录，点击上方“新建月结入库补录”即可录入。"
                    : "当前暂无月结补录单据记录";
                return {
                    key: `${self.view_mode}|${total_cols}`,
                    html: `
                        <tr>
                            <td colspan="${total_cols}" class="picker-empty-state">
                                <div class="picker-empty-text">${msg}</div>
                            </td>
                        </tr>
                    `,
                };
            },
            getFooterSpec: (rows) => self.build_footer_spec(rows),
            onAfterRender: () => {
                self.sync_top_scrollbar_width();
                self.update_selection_summary();
            },
        });
        return this._tableRuntime;
    }

    adjust_table_height() {
        this.get_table_runtime().adjustHeight();
    }

    render_table() {
        this.get_table_runtime().render(this.cached_rows || []);
    }

    build_header_html() {
        const is_all = this.active_company === "All";
        const can_invoice = this.can_manage_invoicing();
        let ths = `
            <th class="picker-col-sticky-1">#</th>
            <th class="picker-col-sticky-2 picker-col-checkbox-th col-w-check">
                <input type="checkbox" id="monthly-select-all-header" class="picker-header-checkbox" title="全选/取消全选" />
            </th>
        `;
        if (is_all) {
            ths += `<th class="picker-col-company col-w-company-badge">所属公司</th>`;
        }
        ths += `<th class="picker-col-docname col-w-docname">单据编号</th>`;
        ths += `<th class="picker-col-date col-w-date">单据日期</th>`;
        if (can_invoice) {
            ths += `<th class="picker-col-status col-w-status">开票状态</th>`;
        }
        if (this.view_mode === "detail") {
            ths += `
                <th class="picker-col-supplier col-w-supplier">供应商</th>
                <th class="picker-col-item-code col-w-item-code">物料代码</th>
                <th class="picker-col-name col-w-fluid">物料名称</th>
                <th class="picker-col-spec">规格型号</th>
                <th class="picker-col-qty-val col-w-qty">数量</th>
                <th class="picker-col-uom col-w-uom">单位</th>
                <th class="picker-col-rate col-w-rate">单价</th>
                <th class="picker-col-money col-w-money">金额</th>
            `;
            if (can_invoice) {
                ths += `<th class="picker-col-money col-w-money">待付金额</th>`;
            }
            ths += `
                <th class="picker-col-warehouse">收货仓库</th>
                <th class="picker-col-linked-doc col-w-linked-doc">关联采购订单</th>
            `;
        } else {
            ths += `
                <th class="picker-col-supplier col-w-supplier">供应商</th>
                <th class="picker-col-doc-details col-w-fluid">单据明细</th>
                <th class="picker-col-item-count col-w-item-count">物料项数</th>
                <th class="picker-col-money col-w-money">单据总额</th>
            `;
            if (can_invoice) {
                ths += `<th class="picker-col-money col-w-money">待付金额</th>`;
            }
            ths += `<th class="picker-col-linked-doc col-w-linked-doc">关联采购订单</th>`;
        }
        if (can_invoice) {
            ths += `<th class="picker-col-linked-doc col-w-linked-doc">关联采购发票</th>`;
        }
        ths += `<th class="picker-col-user col-w-user text-center">制单人</th>`;
        return `<tr>${ths}</tr>`;
    }

    render_detail_view() {
        this.render_table();
    }

    build_detail_row_html(r, idx) {
        const is_all = this.active_company === "All";
        const can_invoice = this.can_manage_invoicing();
        const is_checked = this.selected_items.has(r.pri_name) ? "checked" : "";
        const comp_short = (r.company || "").includes("祺富") ? "祺富" : ((r.company || "").includes("吉众") ? "吉众" : (r.company || ""));
        const comp_cls = (r.company || "").includes("祺富") ? "picker-company-badge-qifu" : "picker-company-badge-jizhong";

        return `
            <tr class="ashan-row-clickable ${is_checked ? "row-selected" : ""}" data-doctype="Purchase Receipt" data-name="${frappe.utils.escape_html(r.pr_name)}">
                <td class="picker-col-sticky-1">${idx + 1}</td>
                <td class="picker-col-sticky-2">
                    <input type="checkbox" class="picker-row-checkbox" data-key="${r.pri_name}" ${is_checked} />
                </td>
                ${is_all ? `
                    <td class="picker-col-company">
                        <span class="picker-company-badge ${comp_cls}">${frappe.utils.escape_html(comp_short)}</span>
                    </td>
                ` : ""}
                <td class="picker-col-docname">
                    <span class="picker-linked-badge picker-doc-clickable-link" data-doctype="Purchase Receipt" data-name="${r.pr_name}">
                        ${frappe.utils.escape_html(r.pr_name)}
                    </span>
                </td>
                <td class="picker-col-date">${r.posting_date || "-"}</td>
                ${can_invoice ? `
                    <td class="picker-col-status">
                        <span class="ashan-status-badge ${r.status_label === "待开票" ? "ashan-status-amber" : "ashan-status-green"}">
                            ${frappe.utils.escape_html(r.status_label || "待开票")}
                        </span>
                    </td>
                ` : ""}
                <td class="picker-col-supplier">${frappe.utils.escape_html(r.supplier || "-")}</td>
                <td class="picker-col-item-code"><strong>${frappe.utils.escape_html(r.item_code)}</strong></td>
                <td class="picker-col-name">${frappe.utils.escape_html(r.item_name || r.item_code)}</td>
                <td class="picker-col-spec">${frappe.utils.escape_html(r.spec || "-")}</td>
                <td class="picker-col-qty-val picker-qty-cell"><strong>${flt(r.qty).toFixed(2)}</strong></td>
                <td class="picker-col-uom ashan-cell-center">${frappe.utils.escape_html(r.uom || "")}</td>
                <td class="picker-col-rate picker-money-cell">${this.fmt_money(r.rate)}</td>
                <td class="picker-col-money picker-money-cell">${this.fmt_money(r.amount)}</td>
                ${can_invoice ? `
                    <td class="picker-col-money picker-money-cell"><strong>${this.fmt_money(r.unbilled_amount)}</strong></td>
                ` : ""}
                <td class="picker-col-warehouse">${frappe.utils.escape_html(r.warehouse || "-")}</td>
                <td class="picker-col-linked-doc">${r.purchase_order ? `<span class="picker-linked-badge picker-doc-clickable-link" data-doctype="Purchase Order" data-name="${frappe.utils.escape_html(r.purchase_order)}">${frappe.utils.escape_html(r.purchase_order)}</span>` : "-"}</td>
                ${can_invoice ? (() => {
                    const piSum = window.AshanUI && AshanUI.formatCompactSummary ? AshanUI.formatCompactSummary(r.linked_pi_names, { label: "关联采购发票", unit: "张", mono: true }) : null;
                    return `<td class="picker-col-linked-doc" ${piSum ? piSum.attrs : ""}>${piSum ? piSum.html : frappe.utils.escape_html(r.linked_pi_names || "-")}</td>`;
                })() : ""}
                <td class="picker-col-user text-center text-xs">${window.AshanUI ? window.AshanUI.formatUser(r.owner) : (r.owner || "-")}</td>
            </tr>
        `;
    }

    render_doc_view() {
        this.render_table();
    }

    build_doc_row_html(r, idx) {
        const is_all = this.active_company === "All";
        const can_invoice = this.can_manage_invoicing();
        const is_checked = this.selected_items.has(r.pr_name) ? "checked" : "";
        const comp_short = (r.company || "").includes("祺富") ? "祺富" : ((r.company || "").includes("吉众") ? "吉众" : (r.company || ""));
        const comp_cls = (r.company || "").includes("祺富") ? "picker-company-badge-qifu" : "picker-company-badge-jizhong";

        return `
            <tr class="ashan-row-clickable ${is_checked ? "row-selected" : ""}" data-doctype="Purchase Receipt" data-name="${frappe.utils.escape_html(r.pr_name)}">
                <td class="picker-col-sticky-1">${idx + 1}</td>
                <td class="picker-col-sticky-2">
                    <input type="checkbox" class="picker-row-checkbox" data-key="${r.pr_name}" ${is_checked} />
                </td>
                ${is_all ? `
                    <td class="picker-col-company">
                        <span class="picker-company-badge ${comp_cls}">${frappe.utils.escape_html(comp_short)}</span>
                    </td>
                ` : ""}
                <td class="picker-col-docname">
                    <span class="picker-linked-badge picker-doc-clickable-link" data-doctype="Purchase Receipt" data-name="${r.pr_name}">
                        ${frappe.utils.escape_html(r.pr_name)}
                    </span>
                </td>
                <td class="picker-col-date">${r.posting_date || "-"}</td>
                ${can_invoice ? `
                    <td class="picker-col-status">
                        <span class="ashan-status-badge ${r.status_label === "待开票" ? "ashan-status-amber" : "ashan-status-green"}">
                            ${frappe.utils.escape_html(r.status_label || "待开票")}
                        </span>
                    </td>
                ` : ""}
                <td class="picker-col-supplier">${frappe.utils.escape_html(r.supplier || "-")}</td>
                ${(() => {
                    const detailCell = (window.AshanUI && AshanUI.formatDocDetailsCell)
                        ? AshanUI.formatDocDetailsCell(r.doc_details || r.items_preview, r.doc_details_full, r.item_count || r.doc_details_count, "单据明细")
                        : { attrs: "", html: frappe.utils.escape_html(r.doc_details || r.items_preview || "-") };
                    return `<td class="picker-col-doc-details col-w-fluid"${detailCell.attrs}>${detailCell.html}</td>`;
                })()}
                <td class="picker-col-item-count picker-qty-cell">${r.item_count || 1}</td>
                <td class="picker-col-money picker-money-cell"><strong>${this.fmt_money(r.total_amount)}</strong></td>
                ${can_invoice ? `
                    <td class="picker-col-money picker-money-cell"><strong>${this.fmt_money(r.unbilled_amount)}</strong></td>
                ` : ""}
                <td class="picker-col-linked-doc">${r.purchase_order ? `<span class="picker-linked-badge picker-doc-clickable-link" data-doctype="Purchase Order" data-name="${frappe.utils.escape_html(r.purchase_order)}">${frappe.utils.escape_html(r.purchase_order)}</span>` : "-"}</td>
                ${can_invoice ? (() => {
                    const piSum = window.AshanUI && AshanUI.formatCompactSummary ? AshanUI.formatCompactSummary(r.linked_pi_names, { label: "关联采购发票", unit: "张", mono: true }) : null;
                    return `<td class="picker-col-linked-doc" ${piSum ? piSum.attrs : ""}>${piSum ? piSum.html : frappe.utils.escape_html(r.linked_pi_names || "-")}</td>`;
                })() : ""}
                <td class="picker-col-user text-center text-xs">${window.AshanUI ? window.AshanUI.formatUser(r.owner) : (r.owner || "-")}</td>
            </tr>
        `;
    }

    build_footer_spec(rows) {
        const list = rows || [];
        if (!list.length) return { key: "__EMPTY__", html: "" };
        const is_all = this.active_company === "All";
        const can_invoice = this.can_manage_invoicing();
        const prefix_cols = is_all ? 3 : 2;

        if (this.view_mode === "detail") {
            let sum_qty = 0;
            let sum_amt = 0;
            let sum_unbilled = 0;
            list.forEach((r) => {
                sum_qty += flt(r.qty);
                sum_amt += flt(r.amount);
                sum_unbilled += flt(r.unbilled_amount);
            });
            const middle_empty = can_invoice ? 7 : 6;
            return {
                key: `detail|${is_all ? "ALL" : "SINGLE"}|${can_invoice ? 1 : 0}|${list.length}|${sum_qty.toFixed(2)}|${sum_amt.toFixed(2)}|${sum_unbilled.toFixed(2)}`,
                html: `
                    <tr>
                        <td colspan="${prefix_cols}" class="picker-col-sticky-foot">合计 (共 ${list.length} 笔)</td>
                        <td colspan="${middle_empty}"></td>
                        <td class="picker-qty-cell">${sum_qty.toFixed(2)}</td>
                        <td></td>
                        <td></td>
                        <td class="picker-money-cell">${this.fmt_money(sum_amt)}</td>
                        ${can_invoice ? `<td class="picker-money-cell">${this.fmt_money(sum_unbilled)}</td>` : ""}
                        <td colspan="2"></td>
                        ${can_invoice ? "<td></td>" : ""}
                        <td></td>
                    </tr>
                `,
            };
        }

        let sum_total = 0;
        let sum_unbilled = 0;
        let sum_items = 0;
        list.forEach((r) => {
            sum_total += flt(r.total_amount);
            sum_unbilled += flt(r.unbilled_amount);
            sum_items += (r.item_count || 1);
        });
        const middle_empty = can_invoice ? 4 : 3;
        return {
            key: `doc|${is_all ? "ALL" : "SINGLE"}|${can_invoice ? 1 : 0}|${list.length}|${sum_items}|${sum_total.toFixed(2)}|${sum_unbilled.toFixed(2)}`,
            html: `
                <tr>
                    <td colspan="${prefix_cols}" class="picker-col-sticky-foot">合计 (共 ${list.length} 笔)</td>
                    <td colspan="${middle_empty}"></td>
                    <td class="picker-qty-cell">${sum_items}</td>
                    <td class="picker-money-cell">${this.fmt_money(sum_total)}</td>
                    ${can_invoice ? `<td class="picker-money-cell">${this.fmt_money(sum_unbilled)}</td>` : ""}
                    <td></td>
                    ${can_invoice ? "<td></td>" : ""}
                    <td></td>
                </tr>
            `,
        };
    }
    update_selection_summary() {
        const count = this.selected_items.size;
        let amount = 0.0;

        if (this.view_mode === "detail") {
            this.cached_rows.forEach((r) => {
                if (this.selected_items.has(r.pri_name)) {
                    amount += flt(r.unbilled_amount > 0 ? r.unbilled_amount : r.amount);
                }
            });
        } else {
            this.cached_rows.forEach((r) => {
                if (this.selected_items.has(r.pr_name)) {
                    amount += flt(r.unbilled_amount > 0 ? r.unbilled_amount : r.total_amount);
                }
            });
        }

        $("#monthly-selected-count").text(count);
        $("#monthly-selected-amount").text(this.fmt_money(amount));
    }

    sync_checkbox_states() {
        const self = this;
        $("#monthly-table-tbody .picker-row-checkbox").each(function () {
            const key = $(this).data("key");
            $(this).prop("checked", self.selected_items.has(key));
        });
    }

    fmt_money(val) {
        return "¥ " + flt(val || 0, 2).toLocaleString("zh-CN", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    }

    // =========================================================================
    // Fast Monthly Settlement Creation Modal (Receipt-driven PO+PR Auto Bundle)
    // =========================================================================

    open_create_monthly_receipt_modal() {
        const self = this;

        const d = AshanUI.workspaceDrawer.createDialogAdapter({
            title: __("新建月结入库补录"),
            size: "extra-large",
            static: true,
            fields: [
                {
                    fieldtype: "HTML",
                    fieldname: "form_html",
                },
            ],
            primary_action_label: __("生成并过账"),
            primary_action: async function () {
                await self.submit_create_monthly_receipt(d);
            },
            secondary_action_label: __("关闭"),
            secondary_action: function () {
                d.hide();
            },
        });

        const contextCompany = window.AshanWorkContext?.getCompany?.();
        const defaultCompany = window.AshanWorkContext
            ? contextCompany
            : (self.active_company === "All" ? self.companies[0]?.name : self.active_company);
        const comp_options = `${defaultCompany ? "" : '<option value="" selected>请选择公司</option>'}${this.companies.map((c) =>
            `<option value="${c.name}" ${c.name === defaultCompany ? "selected" : ""}>${frappe.utils.escape_html(c.company_name || c.name)}</option>`
        ).join("")}`;

        const form_html = `
            <div class="ashan-smart-modal-body">
                <!-- Section 1: Basic Info -->
                <div class="ashan-smart-section">
                    <div class="ashan-smart-section-header">
                        <div class="ashan-smart-section-title">
                            <span>月结业务信息</span>
                        </div>
                    </div>
                    <div class="ashan-smart-grid-4">
                        <div class="ashan-smart-field">
                            <label class="ashan-smart-field-label">所属公司 <span class="req">*</span></label>
                            <select class="ashan-smart-control" id="modal-monthly-company">
                                ${comp_options}
                            </select>
                        </div>
                        <div class="ashan-smart-field">
                            <label class="ashan-smart-field-label">月结供应商 <span class="req">*</span></label>
                            <input type="text" class="ashan-smart-control" id="modal-monthly-supplier" placeholder="搜索或输入供应商名称..." />
                        </div>
                        <div class="ashan-smart-field">
                            <label class="ashan-smart-field-label">入库日期</label>
                            <input type="date" class="ashan-smart-control" id="modal-monthly-date" value="${window.AshanWorkContext?.getWorkDate?.() || frappe.datetime.nowdate()}" />
                        </div>
                        <div class="ashan-smart-field">
                            <label class="ashan-smart-field-label">收货目标仓库</label>
                            <input type="text" class="ashan-smart-control" id="modal-monthly-warehouse" placeholder="默认 Goods In Transit / Stores..." />
                        </div>
                    </div>
                    ${self.can_auto_issue_stock() ? `
                    <label class="ashan-smart-toggle-box" id="modal-monthly-auto-issue-wrap">
                        <input type="checkbox" id="modal-monthly-auto-issue" />
                        <span><strong>即入即出（自动全部出库）</strong>：月结入库过账后，库存物料同步生成材料出库单并完成全部出库</span>
                    </label>
                    ` : ""}
                </div>

                <!-- Section 2: Items Details Table (The Integrated Sheet & Ledger) -->
                <div class="ashan-po-table-section">
                    <div class="ashan-po-table-wrap">
                        <table class="ashan-po-item-table" id="modal-monthly-items-table">
                            <colgroup>
                                <col class="col-w-seq">
                                <col class="col-w-code">
                                <col class="col-w-name">
                                <col class="col-w-spec">
                                <col class="col-w-uom">
                                <col class="col-w-qty">
                                <col class="col-w-rate">
                                <col class="col-w-tax-rate">
                                <col class="col-w-amount">
                                <col class="col-w-tax-amount">
                                <col class="col-w-total">
                                <col class="col-w-remarks">
                                <col class="col-w-action">
                            </colgroup>
                            <thead>
                                <tr>
                                    <th class="ashan-cell-center">#</th>
                                    <th><strong>物料代码</strong> <span class="ashan-req">*</span></th>
                                    <th>物料名称</th>
                                    <th>规格</th>
                                    <th class="ashan-cell-center">单位</th>
                                    <th class="ashan-cell-right col-required"><strong>入库数量</strong> <span class="ashan-req">*</span></th>
                                    <th class="ashan-cell-right col-required"><strong>价格</strong> <span class="ashan-req">*</span></th>
                                    <th class="ashan-cell-center">税率 %</th>
                                    <th class="ashan-cell-right">不含税金额</th>
                                    <th class="ashan-cell-right">税额</th>
                                    <th class="ashan-cell-right">总金额</th>
                                    <th>备注</th>
                                    <th class="ashan-cell-center">操作</th>
                                </tr>
                            </thead>
                            <tbody id="modal-monthly-items-tbody"></tbody>
                            <tfoot>
                                <tr>
                                    <td colspan="5" class="ashan-cell-center">合计汇总</td>
                                    <td class="ashan-cell-right"><span class="ashan-foot-qty-val" id="modal-monthly-sum-qty">0.00</span></td>
                                    <td></td>
                                    <td></td>
                                    <td class="ashan-cell-right"><span class="ashan-foot-total-val" id="modal-monthly-sum-amt">¥ 0.00</span></td>
                                    <td class="ashan-cell-right"><span class="ashan-foot-total-val" id="modal-monthly-sum-tax">¥ 0.00</span></td>
                                    <td class="ashan-cell-right"><span class="ashan-foot-total-val" id="modal-monthly-sum-total">¥ 0.00</span></td>
                                    <td class="ashan-cell-center">
                                        <button type="button" class="ashan-btn-add-row" id="modal-monthly-add-row-btn">+ 添加物料行</button>
                                    </td>
                                    <td></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            </div>
            </div>
        `;

        const $formWrap = d.fields_dict.form_html.$wrapper;
        $formWrap.html(form_html);

        // Bind Add Row
        $formWrap.on("click", "#modal-monthly-add-row-btn", () => this.add_monthly_modal_row(d));

        // Bind Row Delete
        $formWrap.on("click", ".monthly-row-delete-btn", function () {
            $(this).closest("tr").remove();
            self.recalc_monthly_modal_totals(d);
        });

        // Bind Calculations
        $formWrap.on("input change", ".monthly-item-qty, .monthly-item-rate, .monthly-item-tax-rate", function () {
            const $tr = $(this).closest("tr");
            self.recalc_monthly_modal_row($tr);
            self.recalc_monthly_modal_totals(d);
        });

        // Autocomplete Item Code
        $formWrap.on("change", ".monthly-item-code", async function () {
            const $tr = $(this).closest("tr");
            const code = $(this).val().trim();
            if (!code) return;

            try {
                const item_info = await frappe.db.get_value("Item", code, ["item_name", "stock_uom", "standard_rate", "description"]);
                if (item_info && item_info.message) {
                    const msg = item_info.message;
                    $tr.find(".monthly-item-name").val(msg.item_name || code);
                    $tr.find(".monthly-item-uom").val(msg.stock_uom || "Nos");
                    const $spec = $tr.find(".monthly-item-spec");
                    if (!$spec.val().trim()) {
                        $spec.val(msg.description || "");
                    }
                    if (flt(msg.standard_rate) > 0 && flt($tr.find(".monthly-item-rate").val()) === 0) {
                        $tr.find(".monthly-item-rate").val(flt(msg.standard_rate).toFixed(2));
                    }
                    self.recalc_monthly_modal_row($tr);
                    self.recalc_monthly_modal_totals(d);
                }
            } catch (e) {
                console.log("Item lookup error:", e);
            }
        });

        d.show();

        // Add 2 initial rows
        this.add_monthly_modal_row(d);
        this.add_monthly_modal_row(d);
    }

    add_monthly_modal_row(dialog) {
        const $tbody = (dialog && dialog.$wrapper) ? dialog.$wrapper.find("#modal-monthly-items-tbody") : $("#modal-monthly-items-tbody");
        const row_idx = $tbody.find("tr").length + 1;
        const tr_html = `
            <tr>
                <td class="ashan-smart-cell-idx">${row_idx}</td>
                <td><input type="text" class="ashan-smart-cell-input monthly-item-code" placeholder="输入物料代码..." /></td>
                <td><input type="text" class="ashan-smart-cell-input monthly-item-name" placeholder="物料名称" /></td>
                <td><input type="text" class="ashan-smart-cell-input monthly-item-spec" placeholder="规格" /></td>
                <td><input type="text" class="ashan-smart-cell-input monthly-item-uom text-center" value="Nos" /></td>
                <td><input type="number" class="ashan-smart-cell-input monthly-item-qty text-right font-bold" value="1" min="0.001" step="any" /></td>
                <td><input type="number" class="ashan-smart-cell-input monthly-item-rate text-right font-bold" value="0.00" min="0.01" step="any" /></td>
                <td><input type="number" class="ashan-smart-cell-input monthly-item-tax-rate text-center" value="13" min="0" max="100" /></td>
                <td><input type="number" class="ashan-smart-cell-input monthly-item-amt text-right font-bold" value="0.00" readonly /></td>
                <td><input type="number" class="ashan-smart-cell-input monthly-item-tax-amt text-right" value="0.00" readonly /></td>
                <td><input type="number" class="ashan-smart-cell-input monthly-item-total text-right font-bold text-success" value="0.00" readonly /></td>
                <td><input type="text" class="ashan-smart-cell-input monthly-item-remarks" placeholder="备注" /></td>
                <td class="text-center">
                    <button type="button" class="ashan-btn-row-del monthly-row-delete-btn" title="移除此行">移除</button>
                </td>
            </tr>
        `;
        $tbody.append(tr_html);
    }

    recalc_monthly_modal_row($tr) {
        const qty = flt($tr.find(".monthly-item-qty").val());
        const rate = flt($tr.find(".monthly-item-rate").val());
        const tax_rate = flt($tr.find(".monthly-item-tax-rate").val());

        const amt = flt(qty * rate, 2);
        const tax_amt = flt(amt * (tax_rate / 100.0), 2);
        const total = flt(amt + tax_amt, 2);

        $tr.find(".monthly-item-amt").val(amt.toFixed(2));
        $tr.find(".monthly-item-tax-amt").val(tax_amt.toFixed(2));
        $tr.find(".monthly-item-total").val(total.toFixed(2));
    }

    recalc_monthly_modal_totals(dialog) {
        const $wrap = (dialog && dialog.$wrapper) ? dialog.$wrapper : $(document);
        let sum_qty = 0;
        let sum_amt = 0;
        let sum_tax = 0;
        let sum_total = 0;

        $wrap.find("#modal-monthly-items-tbody tr").each(function () {
            sum_qty += flt($(this).find(".monthly-item-qty").val());
            sum_amt += flt($(this).find(".monthly-item-amt").val());
            sum_tax += flt($(this).find(".monthly-item-tax-amt").val());
            sum_total += flt($(this).find(".monthly-item-total").val());
        });

        $wrap.find("#modal-monthly-sum-qty").text(sum_qty.toFixed(2));
        $wrap.find("#modal-monthly-sum-amt").text(this.fmt_money(sum_amt));
        $wrap.find("#modal-monthly-sum-tax").text(this.fmt_money(sum_tax));
        $wrap.find("#modal-monthly-sum-total").text(this.fmt_money(sum_total));
    }

    async submit_create_monthly_receipt(dialog) {
        const $wrap = dialog.$wrapper;
        const company = $wrap.find("#modal-monthly-company").val();
        const supplier = $wrap.find("#modal-monthly-supplier").val().trim();
        const posting_date = $wrap.find("#modal-monthly-date").val();
        const warehouse = $wrap.find("#modal-monthly-warehouse").val().trim();
        const auto_issue_stock = (this.can_auto_issue_stock() && $wrap.find("#modal-monthly-auto-issue").is(":checked")) ? 1 : 0;

        if (!company) {
            frappe.msgprint(__("请选择所属公司！"));
            return;
        }
        if (!supplier) {
            frappe.msgprint(__("请填写月结供应商名称！"));
            return;
        }

        const items = [];
        let has_zero_error = false;

        $wrap.find("#modal-monthly-items-tbody tr").each(function (idx) {
            const item_code = $(this).find(".monthly-item-code").val().trim();
            const item_name = $(this).find(".monthly-item-name").val().trim();
            const spec = $(this).find(".monthly-item-spec").val().trim();
            const uom = $(this).find(".monthly-item-uom").val().trim();
            const qty = flt($(this).find(".monthly-item-qty").val());
            const rate = flt($(this).find(".monthly-item-rate").val());
            const tax_rate = flt($(this).find(".monthly-item-tax-rate").val());
            const amount = flt($(this).find(".monthly-item-amt").val());
            const tax_amount = flt($(this).find(".monthly-item-tax-amt").val());
            const total_amount = flt($(this).find(".monthly-item-total").val());
            const remarks = $(this).find(".monthly-item-remarks").val().trim();

            if (!item_code) return;

            if (qty <= 0 || rate <= 0 || amount <= 0) {
                frappe.msgprint(`第 ${idx + 1} 行物料 [${item_code}] 的单价或金额为 0！根据财务纪律，单价与金额严禁为 0。`);
                has_zero_error = true;
                return false;
            }

            items.push({
                item_code,
                item_name,
                spec,
                uom,
                qty,
                rate,
                tax_rate,
                amount,
                tax_amount,
                total_amount,
                remarks,
            });
        });

        if (has_zero_error) return;

        if (items.length === 0) {
            frappe.msgprint(__("请至少添加一行有效的物料明细！"));
            return;
        }

        const $btn = dialog.get_primary_btn ? dialog.get_primary_btn() : $();
        $btn.prop("disabled", true);
        try {
            const r = await frappe.call({
                method: "ashan_cn_procurement.services.monthly_settlement_service.create_monthly_settlement_receipt_bundle",
                args: {
                    company,
                    supplier,
                    posting_date,
                    warehouse,
                    items,
                    auto_issue_stock,
                },
            });

            if (r.message && r.message.success) {
                const seSuffix = r.message.se_name ? `，并已全部出库（${r.message.se_name}）` : "";
                frappe.show_alert({
                    message: `成功生成月结入库单！入库单：${r.message.pr_name}${seSuffix}`,
                    indicator: "green",
                }, 5);

                this.refresh_all();
                if (r.message.pr_name) {
                    this.show_doc_detail_modal("Purchase Receipt", r.message.pr_name);
                } else {
                    dialog.hide();
                }
            }
        } catch (e) {
            console.error("Failed to create monthly receipt bundle:", e);
            frappe.msgprint(e.message || __("生成月结入库单失败"));
        } finally {
            $btn.prop("disabled", false);
        }
    }

    // =========================================================================
    // Document Detail Modal (Full Upstream/Downstream Inspection)
    // =========================================================================

    async show_doc_detail_modal(doctype, name, nav_stack = []) {
        if (!doctype || !name) return;
        const self = this;
        return AshanUI.openDocumentWorkspaceDrawer({
            doctype,
            name,
            navStack: nav_stack,
            formatMoney: (val) => self.fmt_money(val),
            onPrint: (doc) => {
                window.open(`/printview?doctype=${encodeURIComponent(doc.doctype)}&name=${encodeURIComponent(doc.name)}&trigger_print=1`, "_blank");
            },
        });
    }
}
