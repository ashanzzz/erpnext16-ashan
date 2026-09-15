// Copyright (c) 2026, Ashan CN Procurement and contributors
// For license information, please see license.txt

frappe.pages["monthly-settlement-picker"].on_page_load = function (wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __("月结补录"),
        single_column: true,
    });

    $(page.wrapper).find(".page-head").hide();
    wrapper.monthly_picker = new MonthlySettlementPicker(page);
};

frappe.pages["monthly-settlement-picker"].on_page_show = function (wrapper) {
    if (wrapper.monthly_picker && typeof wrapper.monthly_picker.refresh_all === "function") {
        wrapper.monthly_picker.refresh_all();
    }
};

class MonthlySettlementPicker {
    constructor(page) {
        this.page = page;
        this.active_company = window.AshanWorkContext?.getCompany?.() || "All";
        this.companies = [];
        this.view_mode = "detail"; // detail | doc
        this.match_status = "pending"; // pending | completed | all
        this.selected_items = new Set();
        this.cached_rows = [];
        this.kpis = {};

        this.init();
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
                <!-- Top Header & Company Selector -->
                <div class="picker-top-bar">
                    <div class="picker-title-group">
                        <h2>📅 月结补录</h2>
                        <div class="picker-subtitle">月结采购入库录入与待开票跟踪</div>
                    </div>
                    <div class="picker-company-group">
                        <label class="picker-company-label" for="monthly-company-select">所属公司:</label>
                        <select id="monthly-company-select" class="picker-company-select">
                            <option value="All">全部公司</option>
                        </select>
                    </div>
                </div>

                <!-- 4 KPI Cards Pipeline Bar -->
                <div class="picker-kpi-grid" id="monthly-kpi-grid">
                    <div class="picker-kpi-card active" data-step="pr_pending">
                        <div class="picker-kpi-header">
                            <span class="picker-kpi-title">月结待开票</span>
                        </div>
                        <div class="picker-kpi-body">
                            <div class="picker-kpi-number" id="monthly-kpi-pending-items">0</div>
                            <div class="picker-kpi-sub" id="monthly-kpi-pending-sub">待开票入库明细</div>
                        </div>
                    </div>
                    <div class="picker-kpi-card" data-step="po">
                        <div class="picker-kpi-header">
                            <span class="picker-kpi-title">采购订单</span>
                        </div>
                        <div class="picker-kpi-body">
                            <div class="picker-kpi-number" id="monthly-kpi-po-count">0</div>
                            <div class="picker-kpi-sub">关联月结订单</div>
                        </div>
                    </div>
                    <div class="picker-kpi-card" data-step="pr_total">
                        <div class="picker-kpi-header">
                            <span class="picker-kpi-title">月结入库</span>
                        </div>
                        <div class="picker-kpi-body">
                            <div class="picker-kpi-number" id="monthly-kpi-pr-count">0</div>
                            <div class="picker-kpi-sub">已过账入库单</div>
                        </div>
                    </div>
                    <div class="picker-kpi-card" data-step="unbilled_amt">
                        <div class="picker-kpi-header">
                            <span class="picker-kpi-title">待开票金额</span>
                        </div>
                        <div class="picker-kpi-body">
                            <div class="picker-kpi-number" id="monthly-kpi-unbilled-amt">¥ 0.00</div>
                            <div class="picker-kpi-sub">待开票总额</div>
                        </div>
                    </div>
                </div>

                <!-- Section Context Banner -->
                <div class="picker-section-banner" id="monthly-section-banner">
                    <div class="picker-section-main">
                        <div class="picker-section-heading">
                            <div class="picker-section-title">
                                <span>月结入库补录</span>
                            </div>
                            <div class="picker-section-desc">录入月结入库明细后，系统生成采购订单和采购入库单；发票后续按月集中开具。</div>
                        </div>
                    </div>
                    <div class="picker-section-badge" id="monthly-total-summary-badge">
                        统计: 0 笔
                    </div>
                </div>

                <!-- Filter Controls Bar -->
                <div class="picker-filter-bar" id="monthly-filter-bar">
                    <div class="picker-filter-group">
                        <label>开票状态:</label>
                        <div class="picker-status-btn-group" id="monthly-status-btn-group">
                            <button type="button" class="picker-status-btn active" data-status="pending">待开票入库</button>
                            <button type="button" class="picker-status-btn" data-status="completed">已开票入库</button>
                            <button type="button" class="picker-status-btn" data-status="all">全部入库单据</button>
                        </div>
                    </div>
                    <div class="picker-filter-group">
                        <label>供应商:</label>
                        <input type="text" class="picker-input" data-filter="supplier" placeholder="搜索月结供应商..." />
                    </div>
                    <div class="picker-filter-group">
                        <label>入库单号:</label>
                        <input type="text" class="picker-input" data-filter="pr_name" placeholder="入库单号..." />
                    </div>
                    <div class="picker-filter-group">
                        <label>物料编码/名称:</label>
                        <input type="text" class="picker-input" data-filter="item_code" placeholder="搜索物料..." />
                    </div>
                    <div class="picker-filter-group">
                        <label>经手人:</label>
                        <input type="text" class="picker-input" data-filter="owner" placeholder="录单人..." />
                    </div>
                </div>

                <!-- Action Bar (View Switcher + Selection Summary + Primary Actions) -->
                <div class="picker-action-bar">
                    <div class="picker-summary-text">
                        <div class="picker-view-switch-group">
                            <button type="button" class="picker-view-btn active" data-mode="detail">明细视图</button>
                            <button type="button" class="picker-view-btn" data-mode="doc">单号视图</button>
                        </div>
                        <span>已选 <strong class="picker-summary-highlight" id="monthly-selected-count">0</strong> 项</span>
                        <span>本次总计: <strong class="picker-summary-highlight" id="monthly-selected-amount">¥ 0.00</strong></span>
                    </div>
                    <div class="picker-btn-group">
                        <button type="button" class="picker-btn-sub" id="monthly-select-all-btn">全选本页</button>
                        <button type="button" class="picker-btn-sub" id="monthly-clear-sel-btn">清空选择</button>
                        <button type="button" class="monthly-btn-create-pr" id="monthly-open-create-modal-btn">新建月结入库补录</button>
                    </div>
                </div>

                <!-- Big Wide Data Table Container -->
                <div class="picker-table-wrapper">
                    <!-- Top Sync Scrollbar -->
                    <div class="picker-top-scrollbar-wrap" id="monthly-top-scrollbar">
                        <div class="picker-top-scrollbar-inner" id="monthly-top-scrollbar-inner"></div>
                    </div>

                    <!-- Main Table Scroll Area -->
                    <div class="picker-main-table-scroll" id="monthly-main-table-scroll">
                        <table class="picker-data-table" id="monthly-data-table">
                            <thead id="monthly-table-thead"></thead>
                            <tbody id="monthly-table-tbody"></tbody>
                            <tfoot id="monthly-table-tfoot"></tfoot>
                        </table>
                    </div>
                </div>
            </div>
        `;
        $(this.page.body).html(html);
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

        document.addEventListener("ashan-work-context-changed", (event) => {
            const selectedCompany = event.detail?.company || "All";
            if (selectedCompany === self.active_company) return;
            if (selectedCompany !== "All" && !self.companies.some((company) => company.name === selectedCompany)) return;
            self.active_company = selectedCompany;
            self.selected_items.clear();
            self.refresh_all();
        });

        // Company change
        $("#monthly-company-select").on("change", function () {
            self.active_company = $(this).val();
            self.selected_items.clear();
            self.refresh_all();
        });

        // Filter button group
        $("#monthly-status-btn-group").on("click", ".picker-status-btn", function () {
            $(this).siblings().removeClass("active");
            $(this).addClass("active");
            self.match_status = $(this).data("status");
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
        $("#monthly-table-tbody").on("click", ".picker-clickable-doc", function (e) {
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
        const table_container = document.getElementById("monthly-main-table-scroll");
        const top_scrollbar = document.getElementById("monthly-top-scrollbar");
        const thead = document.getElementById("monthly-table-thead");

        if (!table_container || !top_scrollbar) return;

        // Dual scrollbar synchronization
        let is_syncing_main = false;
        let is_syncing_top = false;

        table_container.addEventListener("scroll", () => {
            if (!is_syncing_main) {
                is_syncing_top = true;
                top_scrollbar.scrollLeft = table_container.scrollLeft;
                is_syncing_top = false;
            }
        });

        top_scrollbar.addEventListener("scroll", () => {
            if (!is_syncing_top) {
                is_syncing_main = true;
                table_container.scrollLeft = top_scrollbar.scrollLeft;
                is_syncing_main = false;
            }
        });

        // Convert mousewheel vertical scroll to horizontal scroll
        const handle_wheel = (e) => {
            if (table_container.scrollWidth > table_container.clientWidth) {
                if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                    e.preventDefault();
                    table_container.scrollLeft += e.deltaY;
                }
            }
        };

        if (thead) thead.addEventListener("wheel", handle_wheel, { passive: false });
        if (top_scrollbar) top_scrollbar.addEventListener("wheel", handle_wheel, { passive: false });
    }

    sync_top_scrollbar_width() {
        const table = document.getElementById("monthly-data-table");
        const inner = document.getElementById("monthly-top-scrollbar-inner");
        if (table && inner) {
            inner.style.width = `${table.scrollWidth}px`;
        }
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

    async refresh_all() {
        await Promise.all([this.load_kpis(), this.load_table_data()]);
    }

    async load_kpis() {
        try {
            const r = await frappe.call({
                method: "ashan_cn_procurement.services.monthly_settlement_service.get_monthly_settlement_overview_kpis",
                args: { company: this.active_company },
            });
            if (r.message) {
                this.kpis = r.message;
                $("#monthly-kpi-pending-items").text(this.kpis.pending_item_count || 0);
                $("#monthly-kpi-po-count").text(this.kpis.po_count || 0);
                $("#monthly-kpi-pr-count").text(this.kpis.pr_total_count || 0);
                $("#monthly-kpi-unbilled-amt").text(this.fmt_money(this.kpis.pending_unbilled_amount || 0));
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
                $("#monthly-total-summary-badge").text(`统计: ${this.cached_rows.length} 笔`);
                this.render_table();
            }
        } catch (e) {
            if (request_id !== this._table_request_id) return;
            console.error("Failed to load table data:", e);
        }
    }

    render_table() {
        if (this.view_mode === "detail") {
            this.render_detail_view();
        } else {
            this.render_doc_view();
        }
        this.sync_top_scrollbar_width();
        this.update_selection_summary();
    }

    render_detail_view() {
        const thead_html = `
            <tr>
                <th class="picker-col-sticky-1">
                    <span class="picker-th-badge">定位</span>
                    <span class="picker-th-title">#</span>
                </th>
                <th class="picker-col-sticky-2 picker-col-chk">
                    <span class="picker-th-badge">选择</span>
                    <span class="picker-th-title">选择</span>
                </th>
                <th class="picker-col-sticky-3 picker-col-company">
                    <span class="picker-th-badge">公司</span>
                    <span class="picker-th-title">所属公司</span>
                </th>
                <th>
                    <span class="picker-th-badge">单据</span>
                    <span class="picker-th-title">入库单号</span>
                </th>
                <th>
                    <span class="picker-th-badge">供应商</span>
                    <span class="picker-th-title">供应商</span>
                </th>
                <th>
                    <span class="picker-th-badge">状态</span>
                    <span class="picker-th-title">开票状态</span>
                </th>
                <th>
                    <span class="picker-th-badge">物料</span>
                    <span class="picker-th-title">物料</span>
                </th>
                <th>
                    <span class="picker-th-badge">规格</span>
                    <span class="picker-th-title">规格</span>
                </th>
                <th>
                    <span class="picker-th-badge">单位</span>
                    <span class="picker-th-title">单位</span>
                </th>
                <th class="text-right">
                    <span class="picker-th-badge">数量</span>
                    <span class="picker-th-title">入库数量</span>
                </th>
                <th class="text-right">
                    <span class="picker-th-badge">单价</span>
                    <span class="picker-th-title">单价</span>
                </th>
                <th class="text-right">
                    <span class="picker-th-badge">金额</span>
                    <span class="picker-th-title">金额</span>
                </th>
                <th class="text-right">
                    <span class="picker-th-badge">未开票</span>
                    <span class="picker-th-title">待开票金额</span>
                </th>
                <th>
                    <span class="picker-th-badge">仓库</span>
                    <span class="picker-th-title">入库仓库</span>
                </th>
                <th>
                    <span class="picker-th-badge">订单</span>
                    <span class="picker-th-title">关联订单</span>
                </th>
                <th>
                    <span class="picker-th-badge">发票</span>
                    <span class="picker-th-title">关联发票</span>
                </th>
                <th>
                    <span class="picker-th-badge">日期</span>
                    <span class="picker-th-title">入库日期</span>
                </th>
            </tr>
        `;
        $("#monthly-table-thead").html(thead_html);

        if (this.cached_rows.length === 0) {
            $("#monthly-table-tbody").html(`
                <tr>
                    <td colspan="17" class="picker-empty-state">
                        <div class="picker-empty-text">当前暂无月结入库补录记录，点击上方“新建月结入库补录”即可录入。</div>
                    </td>
                </tr>
            `);
            $("#monthly-table-tfoot").empty();
            return;
        }

        let sum_qty = 0;
        let sum_amt = 0;
        let sum_unbilled = 0;

        let tbody_html = "";
        this.cached_rows.forEach((r, idx) => {
            sum_qty += flt(r.qty);
            sum_amt += flt(r.amount);
            sum_unbilled += flt(r.unbilled_amount);

            const is_checked = this.selected_items.has(r.pri_name) ? "checked" : "";

            tbody_html += `
                <tr class="ashan-row-clickable" data-doctype="Purchase Receipt" data-name="${frappe.utils.escape_html(r.pr_name)}">
                    <td class="picker-col-sticky-1 picker-col-idx">${idx + 1}</td>
                    <td class="picker-col-sticky-2 picker-col-chk">
                        <input type="checkbox" class="picker-row-checkbox" data-key="${r.pri_name}" ${is_checked} />
                    </td>
                    <td class="picker-col-sticky-3 picker-col-company">
                        <span class="picker-company-badge ${(r.company || '').includes('祺富') ? 'picker-company-badge-qifu' : 'picker-company-badge-jizhong'}">${frappe.utils.escape_html((r.company || '').includes('祺富') ? '祺富' : ((r.company || '').includes('吉众') ? '吉众' : (r.company || '')))}</span>
                    </td>
                    <td>
                        <span class="picker-clickable-doc" data-doctype="Purchase Receipt" data-name="${r.pr_name}">
                            ${frappe.utils.escape_html(r.pr_name)}
                        </span>
                    </td>
                    <td>${frappe.utils.escape_html(r.supplier)}</td>
                    <td><span class="picker-status-tag">${r.status_label}</span></td>
                    <td><strong>${frappe.utils.escape_html(r.item_code)}</strong> ${frappe.utils.escape_html(r.item_name)}</td>
                    <td>${frappe.utils.escape_html(r.spec || "-")}</td>
                    <td>${frappe.utils.escape_html(r.uom)}</td>
                    <td class="text-right">${flt(r.qty).toFixed(2)}</td>
                    <td class="text-right qifu-money-cell">${this.fmt_money(r.rate)}</td>
                    <td class="text-right qifu-money-cell">${this.fmt_money(r.amount)}</td>
                    <td class="text-right qifu-money-cell ${r.unbilled_amount > 0 ? 'text-danger font-bold' : ''}">
                        ${this.fmt_money(r.unbilled_amount)}
                    </td>
                    <td>${frappe.utils.escape_html(r.warehouse || "-")}</td>
                    <td>
                        ${r.purchase_order ? `<span class="picker-clickable-doc" data-doctype="Purchase Order" data-name="${r.purchase_order}">${r.purchase_order}</span>` : "-"}
                    </td>
                    <td>${frappe.utils.escape_html(r.linked_pi_names || "-")}</td>
                    <td>${r.posting_date}</td>
                </tr>
            `;
        });
        $("#monthly-table-tbody").html(tbody_html);

        const tfoot_html = `
            <tr>
                <td colspan="9" class="text-left font-bold">合计 (共 ${this.cached_rows.length} 笔)</td>
                <td class="text-right font-bold">${sum_qty.toFixed(2)}</td>
                <td></td>
                <td class="text-right qifu-money-cell font-bold">${this.fmt_money(sum_amt)}</td>
                <td class="text-right qifu-money-cell font-bold">${this.fmt_money(sum_unbilled)}</td>
                <td colspan="4"></td>
            </tr>
        `;
        $("#monthly-table-tfoot").html(tfoot_html);
    }

    render_doc_view() {
        const thead_html = `
            <tr>
                <th class="picker-col-sticky-1">
                    <span class="picker-th-badge">定位</span>
                    <span class="picker-th-title">#</span>
                </th>
                <th class="picker-col-sticky-2 picker-col-chk">
                    <span class="picker-th-badge">选择</span>
                    <span class="picker-th-title">选择</span>
                </th>
                <th class="picker-col-sticky-3 picker-col-company">
                    <span class="picker-th-badge">公司</span>
                    <span class="picker-th-title">所属公司</span>
                </th>
                <th>
                    <span class="picker-th-badge">单据</span>
                    <span class="picker-th-title">入库单号</span>
                </th>
                <th>
                    <span class="picker-th-badge">供应商</span>
                    <span class="picker-th-title">供应商</span>
                </th>
                <th>
                    <span class="picker-th-badge">状态</span>
                    <span class="picker-th-title">状态</span>
                </th>
                <th>
                    <span class="picker-th-badge">概览</span>
                    <span class="picker-th-title">单据明细</span>
                </th>
                <th>
                    <span class="picker-th-badge">日期</span>
                    <span class="picker-th-title">入库日期</span>
                </th>
                <th>
                    <span class="picker-th-badge">经手人</span>
                    <span class="picker-th-title">录单人</span>
                </th>
                <th class="text-right">
                    <span class="picker-th-badge">明细</span>
                    <span class="picker-th-title">行数</span>
                </th>
                <th class="text-right">
                    <span class="picker-th-badge">金额</span>
                    <span class="picker-th-title">入库总额</span>
                </th>
                <th class="text-right">
                    <span class="picker-th-badge">未开票</span>
                    <span class="picker-th-title">待开票金额</span>
                </th>
                <th>
                    <span class="picker-th-badge">关联订单</span>
                    <span class="picker-th-title">关联订单</span>
                </th>
                <th>
                    <span class="picker-th-badge">关联发票</span>
                    <span class="picker-th-title">关联发票</span>
                </th>
            </tr>
        `;
        $("#monthly-table-thead").html(thead_html);

        if (this.cached_rows.length === 0) {
            $("#monthly-table-tbody").html(`
                <tr>
                    <td colspan="14" class="picker-empty-state">
                        <div class="picker-empty-text">当前暂无月结补录单据记录</div>
                    </td>
                </tr>
            `);
            $("#monthly-table-tfoot").empty();
            return;
        }

        let sum_total = 0;
        let sum_unbilled = 0;

        let tbody_html = "";
        this.cached_rows.forEach((r, idx) => {
            sum_total += flt(r.total_amount);
            sum_unbilled += flt(r.unbilled_amount);

            const is_checked = this.selected_items.has(r.pr_name) ? "checked" : "";

            tbody_html += `
                <tr class="ashan-row-clickable" data-doctype="Purchase Receipt" data-name="${frappe.utils.escape_html(r.pr_name)}">
                    <td class="picker-col-sticky-1 picker-col-idx">${idx + 1}</td>
                    <td class="picker-col-sticky-2 picker-col-chk">
                        <input type="checkbox" class="picker-row-checkbox" data-key="${r.pr_name}" ${is_checked} />
                    </td>
                    <td class="picker-col-sticky-3 picker-col-company">
                        <span class="picker-company-badge ${(r.company || '').includes('祺富') ? 'picker-company-badge-qifu' : 'picker-company-badge-jizhong'}">${frappe.utils.escape_html((r.company || '').includes('祺富') ? '祺富' : ((r.company || '').includes('吉众') ? '吉众' : (r.company || '')))}</span>
                    </td>
                    <td>
                        <span class="picker-clickable-doc" data-doctype="Purchase Receipt" data-name="${r.pr_name}">
                            ${frappe.utils.escape_html(r.pr_name)}
                        </span>
                    </td>
                    <td>${frappe.utils.escape_html(r.supplier)}</td>
                    <td><span class="picker-status-tag">${r.status_label}</span></td>
                    <td>${frappe.utils.escape_html(r.doc_details)}</td>
                    <td>${r.posting_date}</td>
                    <td>${frappe.utils.escape_html(r.owner)}</td>
                    <td class="text-right">${r.item_count}</td>
                    <td class="text-right qifu-money-cell font-bold">${this.fmt_money(r.total_amount)}</td>
                    <td class="text-right qifu-money-cell ${r.unbilled_amount > 0 ? 'text-danger font-bold' : ''}">
                        ${this.fmt_money(r.unbilled_amount)}
                    </td>
                    <td>${frappe.utils.escape_html(r.linked_pos || "-")}</td>
                    <td>${frappe.utils.escape_html(r.linked_pis || "-")}</td>
                </tr>
            `;
        });
        $("#monthly-table-tbody").html(tbody_html);

        const tfoot_html = `
            <tr>
                <td colspan="10" class="text-left font-bold">合计 (共 ${this.cached_rows.length} 笔)</td>
                <td class="text-right qifu-money-cell font-bold">${this.fmt_money(sum_total)}</td>
                <td class="text-right qifu-money-cell font-bold">${this.fmt_money(sum_unbilled)}</td>
                <td colspan="2"></td>
            </tr>
        `;
        $("#monthly-table-tfoot").html(tfoot_html);
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

        const d = new frappe.ui.Dialog({
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

        d.$wrapper.find(".modal-dialog").addClass("ashan-smart-modal");

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
                </div>

                <!-- Section 2: Items Details Table -->
                <div class="ashan-smart-section">
                    <div class="ashan-smart-section-header">
                        <div class="ashan-smart-section-title">
                            <span>物料明细</span>
                        </div>
                        <div class="ashan-smart-section-tools">
                            <button type="button" class="btn btn-default btn-xs" id="modal-monthly-add-row-btn">添加物料行</button>
                        </div>
                    </div>

                    <div class="ashan-smart-table-wrap">
                        <table class="ashan-smart-table" id="modal-monthly-items-table">
                            <thead>
                                <tr>
                                    <th class="ashan-col-w40">#</th>
                                    <th class="ashan-col-code">物料代码 <span class="req">*</span></th>
                                    <th class="ashan-col-name">物料名称</th>
                                    <th class="ashan-col-spec">规格</th>
                                    <th class="ashan-col-w70">单位</th>
                                    <th class="ashan-col-quantity">数量 <span class="req">*</span></th>
                                    <th class="ashan-col-money">单价 <span class="req">*</span></th>
                                    <th class="ashan-col-rate">税率</th>
                                    <th class="ashan-col-money">不含税金额</th>
                                    <th class="ashan-col-money">税额</th>
                                    <th class="ashan-col-money">价税合计</th>
                                    <th class="ashan-col-remarks">备注</th>
                                    <th class="ashan-col-action">操作</th>
                                </tr>
                            </thead>
                            <tbody id="modal-monthly-items-tbody"></tbody>
                        </table>
                    </div>
                </div>

                <!-- Section 3: Live Financial Summary & Discipline Bar -->
                <div class="ashan-smart-summary-bar">
                    <div class="ashan-smart-tip-box">
                        <span class="ashan-smart-tip-badge">财务纪律</span>
                        <span>单价与金额不得为 0。系统将自动生成并过账关联采购订单与入库单。</span>
                    </div>
                    <div class="ashan-smart-kpi-group">
                        <div class="ashan-smart-kpi-item">
                            <span class="ashan-smart-kpi-label">入库总数</span>
                            <span class="ashan-smart-kpi-value" id="modal-monthly-sum-qty">0.00</span>
                        </div>
                        <div class="ashan-smart-kpi-item">
                            <span class="ashan-smart-kpi-label">不含税金额</span>
                            <span class="ashan-smart-kpi-value" id="modal-monthly-sum-amt">¥ 0.00</span>
                        </div>
                        <div class="ashan-smart-kpi-item">
                            <span class="ashan-smart-kpi-label">预估税额</span>
                            <span class="ashan-smart-kpi-value" id="modal-monthly-sum-tax">¥ 0.00</span>
                        </div>
                        <div class="ashan-smart-kpi-item">
                            <span class="ashan-smart-kpi-label">本次核算总额</span>
                            <span class="ashan-smart-kpi-value grand-total text-success" id="modal-monthly-sum-total">¥ 0.00</span>
                        </div>
                    </div>
                </div>
            </div>
        `;

        d.fields_dict.form_html.$wrapper.html(form_html);

        // Bind Add Row
        d.$wrapper.on("click", "#modal-monthly-add-row-btn", () => this.add_monthly_modal_row(d));

        // Bind Row Delete
        d.$wrapper.on("click", ".monthly-row-delete-btn", function () {
            $(this).closest("tr").remove();
            self.recalc_monthly_modal_totals(d);
        });

        // Bind Calculations
        d.$wrapper.on("input change", ".monthly-item-qty, .monthly-item-rate, .monthly-item-tax-rate", function () {
            const $tr = $(this).closest("tr");
            self.recalc_monthly_modal_row($tr);
            self.recalc_monthly_modal_totals(d);
        });

        // Autocomplete Item Code
        d.$wrapper.on("change", ".monthly-item-code", async function () {
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
                    <button type="button" class="btn btn-xs btn-default monthly-row-delete-btn ashan-smart-btn-del" title="删除此行">✕</button>
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

        try {
            frappe.dom.freeze(__("正在全自动生成采购订单并完成入库单过账..."));
            const r = await frappe.call({
                method: "ashan_cn_procurement.services.monthly_settlement_service.create_monthly_settlement_receipt_bundle",
                args: {
                    company,
                    supplier,
                    posting_date,
                    warehouse,
                    items,
                },
            });
            frappe.dom.unfreeze();

            if (r.message && r.message.success) {
                dialog.hide();
                frappe.show_alert({
                    message: `成功生成月结入库单！入库单：${r.message.pr_name}`,
                    indicator: "green",
                }, 5);

                this.refresh_all();
                this.show_doc_detail_modal("Purchase Receipt", r.message.pr_name);
            }
        } catch (e) {
            frappe.dom.unfreeze();
            console.error("Failed to create monthly receipt bundle:", e);
        }
    }

    // =========================================================================
    // Document Detail Modal (Full Upstream/Downstream Inspection)
    // =========================================================================

    async show_doc_detail_modal(doctype, name) {
        try {
            frappe.dom.freeze(__("正在拉取单据详情..."));
            const r = await frappe.call({
                method: "ashan_cn_procurement.services.procurement_picker_service.get_document_details",
                args: { doctype, name },
            });
            frappe.dom.unfreeze();

            if (!r.message) return;
            const doc = r.message;

            const items_tbody = (doc.items || []).map((it) => `
                <tr>
                    <td class="text-center font-bold">${it.idx}</td>
                    <td><strong>${frappe.utils.escape_html(it.item_code)}</strong></td>
                    <td>${frappe.utils.escape_html(it.item_name)}</td>
                    <td>${frappe.utils.escape_html(it.spec || "-")}</td>
                    <td>${frappe.utils.escape_html(it.uom)}</td>
                    <td class="text-right">${flt(it.qty).toFixed(2)}</td>
                    <td class="text-right qifu-money-cell">${this.fmt_money(it.rate)}</td>
                    <td class="text-right qifu-money-cell">${this.fmt_money(it.amount)}</td>
                    <td class="text-right">${it.tax_rate}%</td>
                    <td class="text-right qifu-money-cell">${this.fmt_money(it.tax_amount)}</td>
                    <td class="text-right qifu-money-cell font-bold text-primary">${this.fmt_money(it.total_amount)}</td>
                    <td>${frappe.utils.escape_html(it.description || "-")}</td>
                </tr>
            `).join("");

            const html = `
                <div class="picker-detail-modal-root">
                    <div class="picker-detail-hdr-grid">
                        <div class="picker-detail-hdr-card">
                            <span class="picker-detail-hdr-label">所属公司</span>
                            <span class="picker-detail-hdr-val">${frappe.utils.escape_html(doc.company)}</span>
                        </div>
                        <div class="picker-detail-hdr-card">
                            <span class="picker-detail-hdr-label">供应商</span>
                            <span class="picker-detail-hdr-val">${frappe.utils.escape_html(doc.supplier || "-")}</span>
                        </div>
                        <div class="picker-detail-hdr-card">
                            <span class="picker-detail-hdr-label">经手人</span>
                            <span class="picker-detail-hdr-val">${frappe.utils.escape_html(doc.owner)}</span>
                        </div>
                        <div class="picker-detail-hdr-card">
                            <span class="picker-detail-hdr-label">单据总额</span>
                            <span class="picker-detail-hdr-val text-primary font-bold">${this.fmt_money(doc.total_amount || doc.grand_total)}</span>
                        </div>
                    </div>

                    <div class="picker-detail-table-wrap">
                        <table class="picker-data-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>物料代码</th>
                                    <th>物料名称</th>
                                    <th>规格</th>
                                    <th>单位</th>
                                    <th class="text-right">数量</th>
                                    <th class="text-right">单价</th>
                                    <th class="text-right">金额</th>
                                    <th class="text-right">税率</th>
                                    <th class="text-right">税额</th>
                                    <th class="text-right">价税合计</th>
                                    <th>备注</th>
                                </tr>
                            </thead>
                            <tbody>${items_tbody}</tbody>
                            <tfoot>
                                <tr>
                                    <td colspan="5" class="text-right font-bold">合计:</td>
                                    <td class="text-right font-bold">${flt(doc.total_qty).toFixed(2)}</td>
                                    <td></td>
                                    <td class="text-right qifu-money-cell font-bold">${this.fmt_money(doc.total_amount || doc.grand_total)}</td>
                                    <td></td>
                                    <td></td>
                                    <td class="text-right qifu-money-cell font-bold text-primary">${this.fmt_money(doc.total_amount || doc.grand_total)}</td>
                                    <td></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            `;

            const d = new frappe.ui.Dialog({
                title: `${doc.doctype_label || doctype}: ${frappe.utils.escape_html(name)}`,
                size: "large",
                static: Number(doc.docstatus) === 0,
                fields: [{ fieldtype: "HTML", fieldname: "detail_html" }],
                primary_action_label: __("打印单据"),
                primary_action: function () {
                    window.open(`/printview?doctype=${encodeURIComponent(doctype)}&name=${encodeURIComponent(name)}&trigger_print=1`, "_blank");
                },
                secondary_action_label: __("关闭"),
                secondary_action: function () {
                    d.hide();
                },
            });

            d.fields_dict.detail_html.$wrapper.html(html);
            d.show();

            const is_draft = Number(doc.docstatus) === 0;
            if (is_draft) {
                d.$wrapper.attr("data-backdrop", "static").attr("data-keyboard", "false");
            }
            if (is_draft && doc.can_write) {
                d.add_custom_action(__("编辑草稿"), () => {
                    d.hide();
                    frappe.set_route("Form", doc.doctype, doc.name);
                });
            }
        } catch (e) {
            frappe.dom.unfreeze();
            console.error("Failed to load document details:", e);
        }
    }
}
