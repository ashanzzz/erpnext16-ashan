// Copyright (c) 2026, Ashan CN Procurement and contributors
// For license information, please see license.txt

frappe.pages["wire-transfer-picker"].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __("自办电汇"),
        single_column: true,
    });

    $(page.wrapper).find(".page-head").hide();
    wrapper.wire_transfer_picker = new WireTransferPicker(page);
};

frappe.pages["wire-transfer-picker"].on_page_show = function (wrapper) {
    if (wrapper.wire_transfer_picker && typeof wrapper.wire_transfer_picker.refresh_all === "function") {
        wrapper.wire_transfer_picker.refresh_all();
    }
};

class WireTransferPicker {
    constructor(page) {
        this.page = page;
        this.companies = [];
        this.active_company = window.AshanWorkContext?.getCompany?.() || "All";
        this.locked_company = null;
        this.view_mode = "doc"; // Default to "doc" view for clean overview
        this.filters = {
            match_status: "",
            lifecycle_status: "all",
            supplier: "",
            bill_no: "",
            item_code: "",
            owner: "",
        };

        this.kpis = {};
        this.table_data = [];
        this.selected_map = new Map();

        this.init();
    }

    async init() {
        this.setup_ui_skeleton();
        await this.load_companies();
        this.bind_global_events();
        this.refresh_all();
    }

    setup_ui_skeleton() {
        const html = `
            <div class="picker-page-container">
                <!-- Top Header & Company Dropdown -->
                <div class="picker-top-bar">
                    <div class="picker-title-group">
                        <h2>自办电汇</h2>
                        <div class="picker-subtitle">付款导向 · 资金出账、实物入库与税局发票全生命周期闭环</div>
                    </div>
                    <div class="picker-company-group">
                        <label class="picker-company-label" for="wire-company-select">所属公司:</label>
                        <select class="picker-company-select" id="wire-company-select">
                            <option value="All">全部公司</option>
                        </select>
                    </div>
                </div>

                <!-- 4-Card Risk & Lifecycle KPI Cards Grid -->
                <div class="picker-kpi-grid" id="wire-kpi-grid"></div>

                <!-- Section Context Banner -->
                <div class="picker-section-banner" id="wire-section-banner">
                    <div class="picker-section-main">
                        <div class="picker-section-heading">
                            <div class="picker-section-title">
                                <span>自办电汇工作台</span>
                            </div>
                            <div class="picker-section-desc">以银行电汇付款为核心导向，严密监控【在途待入库】与【暂估待到票】风险，支持一键确认入库与补录税局发票。</div>
                        </div>
                    </div>
                    <div class="picker-section-badge" id="wire-section-count-badge">
                        统计: 0 笔
                    </div>
                </div>

                <!-- Dynamic Filter Bar & Lifecycle Segmented Control -->
                <div class="picker-filter-bar" id="wire-filter-bar">
                    <div class="picker-filter-group">
                        <label>单据状态:</label>
                        <div class="ashan-segmented-control picker-lifecycle-segment-group" data-filter="lifecycle_status">
                            <button type="button" class="ashan-segment-btn picker-lifecycle-seg-btn active" data-value="all">全部</button>
                            <button type="button" class="ashan-segment-btn picker-lifecycle-seg-btn" data-value="paid_pending_receipt">款付货未到</button>
                            <button type="button" class="ashan-segment-btn picker-lifecycle-seg-btn" data-value="received_pending_invoice">货到票未到</button>
                            <button type="button" class="ashan-segment-btn picker-lifecycle-seg-btn" data-value="completed_closed">🟢 全部完成</button>
                            <button type="button" class="ashan-segment-btn picker-lifecycle-seg-btn" data-value="pending_payment">🟠 待电汇付款</button>
                        </div>
                    </div>
                    <div class="picker-filter-group">
                        <label>供应商:</label>
                        <input type="text" class="picker-input" data-filter="supplier" placeholder="搜索供应商..." />
                    </div>
                    <div class="picker-filter-group">
                        <label>发票/暂估号码:</label>
                        <input type="text" class="picker-input" data-filter="bill_no" placeholder="发票号码..." />
                    </div>
                    <div class="picker-filter-group">
                        <label>物料名称:</label>
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
                            <button type="button" class="picker-view-btn" data-mode="detail">明细视图</button>
                            <button type="button" class="picker-view-btn active" data-mode="doc">单号视图</button>
                        </div>
                        <span>已选 <strong class="picker-summary-highlight" id="wire-selected-count">0</strong> 项</span>
                        <span>本次总计: <strong class="picker-summary-highlight" id="wire-selected-amount">¥ 0.00</strong></span>
                    </div>
                    <div class="picker-btn-group">
                        <button type="button" class="picker-btn-sub" id="wire-select-all-btn">全选本页</button>
                        <button type="button" class="picker-btn-sub" id="wire-clear-sel-btn">清空选择</button>
                        <button type="button" class="picker-btn-sub" id="wire-batch-issue-btn" title="为所选发票生成并提交领料出库单及整算单">批量生成领料出库及整算单</button>
                        <button type="button" class="picker-btn-create-wire" id="wire-open-create-modal-btn">新建自办电汇</button>
                    </div>
                </div>

                <!-- Big Wide Data Table Container -->
                <div class="picker-table-wrapper">
                    <!-- Top Sync Scrollbar -->
                    <div class="picker-top-scrollbar-wrap" id="wire-top-scrollbar">
                        <div class="picker-top-scrollbar-inner" id="wire-top-scrollbar-inner"></div>
                    </div>

                    <!-- Main Table Scroll Area -->
                    <div class="picker-main-table-scroll" id="wire-main-table-scroll">
                        <table class="picker-data-table" id="wire-data-table">
                            <thead id="wire-table-thead"></thead>
                            <tbody id="wire-table-tbody"></tbody>
                            <tfoot id="wire-table-tfoot"></tfoot>
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
                const $select = $("#wire-company-select");
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
            console.error("Failed to load companies for wire transfer picker:", e);
        }
    }

    bind_global_events() {
        const self = this;

        document.addEventListener("ashan-work-context-changed", (event) => {
            const selectedCompany = event.detail?.company || "All";
            if (selectedCompany === self.active_company) return;
            if (selectedCompany !== "All" && !self.companies.some((company) => company.name === selectedCompany)) return;
            self.active_company = selectedCompany;
            self.locked_company = null;
            self.selected_map.clear();
            self.refresh_all();
        });

        // Company Change
        $(this.page.body).on("change", "#wire-company-select", function () {
            self.active_company = $(this).val();
            self.locked_company = null;
            self.selected_map.clear();
            self.refresh_all();
        });

        // Filter inputs are debounced
        $(this.page.body).on("input change", ".picker-input", function () {
            const field = $(this).attr("data-filter");
            const val = $(this).val().trim();
            if (field) {
                self.filters[field] = val;
                clearTimeout(self._filter_timer);
                self._filter_timer = setTimeout(() => {
                    self.selected_map.clear();
                    self.load_table_data();
                }, 300);
            }
        });

        // Lifecycle Segment Filter Buttons
        $(this.page.body).on("click", ".picker-lifecycle-seg-btn", function () {
            const val = $(this).attr("data-value");
            $(this).siblings().removeClass("active");
            $(this).addClass("active");
            self.filters.lifecycle_status = val;
            self.selected_map.clear();
            self.load_table_data();
        });

        // KPI Card Clicks (Sync with Lifecycle Filter)
        $(this.page.body).on("click", ".picker-kpi-card", function () {
            const card_id = $(this).attr("data-card");
            if (!card_id) return;
            let filter_val = "all";
            if (card_id === "paid_pending_receipt") filter_val = "paid_pending_receipt";
            else if (card_id === "received_pending_invoice") filter_val = "received_pending_invoice";
            else if (card_id === "completed_closed") filter_val = "completed_closed";
            else if (card_id === "pending_payment") filter_val = "pending_payment";

            self.filters.lifecycle_status = filter_val;
            $(self.page.body).find(".picker-lifecycle-seg-btn").removeClass("active");
            $(self.page.body).find(`.picker-lifecycle-seg-btn[data-value="${filter_val}"]`).addClass("active");
            self.selected_map.clear();
            self.load_table_data();
        });

        // View Mode Switcher
        $(this.page.body).on("click", ".picker-view-btn", function () {
            const mode = $(this).attr("data-mode");
            if (mode && self.view_mode !== mode) {
                self.view_mode = mode;
                $(self.page.body).find(".picker-view-btn").removeClass("active");
                $(this).addClass("active");
                self.selected_map.clear();
                self.load_table_data();
            }
        });

        // Open Create Modal Button
        $(this.page.body).on("click", "#wire-open-create-modal-btn", function () {
            self.open_create_wire_transfer_modal();
        });

        // Batch Issue Button ("全部出库")
        $(this.page.body).on("click", "#wire-batch-issue-btn", function () {
            self.batch_issue_selected_stock();
        });

        // Row Action: One-Click Stock Receive (【📦 确认入库】)
        $(this.page.body).on("click", ".wire-action-receive-btn", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const pi_name = $(this).attr("data-pi");
            const supplier = $(this).attr("data-supplier");
            self.open_receive_stock_modal(pi_name, supplier);
        });

        // Row Action: One-Click Complete Tax Invoice (【🧾 补录发票】)
        $(this.page.body).on("click", ".wire-action-complete-inv-btn", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const pi_name = $(this).attr("data-pi");
            const supplier = $(this).attr("data-supplier");
            const bill_no = $(this).attr("data-bill-no");
            self.open_complete_invoice_modal(pi_name, supplier, bill_no);
        });

        // 1-Click Create PR Button (【➕ 补建入库单】)
        $(this.page.body).on("click", ".wire-quick-create-pr", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const pi_name = $(this).attr("data-pi");
            const supplier = $(this).attr("data-supplier");
            if (pi_name) {
                self.open_receive_stock_modal(pi_name, supplier);
            }
        });

        // 1-Click Create SE Button (【➕ 补建出库单】)
        $(this.page.body).on("click", ".wire-quick-create-se", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const pi_name = $(this).attr("data-pi");
            if (!pi_name) return;

            frappe.confirm(
                __("确定要为发票【{0}】立即生成【领料出库单】吗？", [pi_name]),
                async function () {
                    try {
                        frappe.dom.freeze(__("正在生成领料出库单..."));
                        const r = await frappe.call({
                            method: "ashan_cn_procurement.services.wire_transfer_service.create_wire_transfer_stock_entry",
                            args: { pi_name: pi_name },
                        });
                        frappe.dom.unfreeze();
                        if (r.message && r.message.success) {
                            frappe.show_alert({
                                message: r.message.message || __("领料出库单生成成功！"),
                                indicator: "green",
                            }, 5);
                            self.refresh_all();
                        }
                    } catch (err) {
                        frappe.dom.unfreeze();
                        console.error("Failed to create stock entry:", err);
                    }
                }
            );
        });

        // 1-Click Create RR Button (【➕ 补建整算单】)
        $(this.page.body).on("click", ".wire-quick-create-rr", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const pi_name = $(this).attr("data-pi");
            if (!pi_name) return;

            frappe.confirm(
                __("确定要为发票【{0}】立即生成【自办电汇整算单】吗？", [pi_name]),
                async function () {
                    try {
                        frappe.dom.freeze(__("正在生成电汇整算单..."));
                        const r = await frappe.call({
                            method: "ashan_cn_procurement.services.wire_transfer_service.create_wire_transfer_reimbursement_request",
                            args: { pi_name: pi_name },
                        });
                        frappe.dom.unfreeze();
                        if (r.message && r.message.success) {
                            frappe.show_alert({
                                message: r.message.message || __("电汇整算单生成成功！"),
                                indicator: "green",
                            }, 5);
                            self.refresh_all();
                        }
                    } catch (err) {
                        frappe.dom.unfreeze();
                        console.error("Failed to create reimbursement request:", err);
                    }
                }
            );
        });

        // 1-Click Create Payment Entry Button (【➕ 新建付款】)
        $(this.page.body).on("click", ".wire-quick-create-pe", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const pi_name = $(this).attr("data-pi");
            const supplier = $(this).attr("data-supplier");
            const amt = $(this).attr("data-amt");
            const total = $(this).attr("data-total");
            if (pi_name) {
                self.open_create_payment_modal(pi_name, supplier, amt, total);
            }
        });

        // Dual Scrollbar Sync
        const $top_scroll = $("#wire-top-scrollbar");
        const $table_scroll = $("#wire-main-table-scroll");
        let is_syncing_top = false;
        let is_syncing_main = false;

        $top_scroll.on("scroll", function () {
            if (!is_syncing_top) {
                is_syncing_main = true;
                $table_scroll.scrollLeft($(this).scrollLeft());
            }
            is_syncing_top = false;
        });

        $table_scroll.on("scroll", function () {
            if (!is_syncing_main) {
                is_syncing_top = true;
                $top_scroll.scrollLeft($(this).scrollLeft());
            }
            is_syncing_main = false;
        });

        // Mousewheel-to-Horizontal Scroll
        const handle_wheel_to_horizontal = function (e) {
            const raw_e = e.originalEvent || e;
            const delta_y = raw_e.deltaY;
            const delta_x = raw_e.deltaX;
            if (Math.abs(delta_y) > Math.abs(delta_x) && delta_y !== 0) {
                const el = $table_scroll[0];
                if (el && el.scrollWidth > el.clientWidth) {
                    el.scrollLeft += delta_y;
                    e.preventDefault();
                }
            }
        };

        $(this.page.body).on("wheel", "#wire-table-thead, #wire-top-scrollbar", handle_wheel_to_horizontal);

        // Row Checkbox Click
        $(this.page.body).on("change", ".picker-row-checkbox", function () {
            const key = $(this).attr("data-key");
            const is_checked = $(this).is(":checked");
            const row = self.table_data.find((r) => self.get_row_key(r) === key);
            if (!row) return;

            if (is_checked) {
                if (self.active_company === "All" && !self.locked_company) {
                    self.locked_company = row.company;
                }
                if (self.locked_company && row.company !== self.locked_company) {
                    $(this).prop("checked", false);
                    return;
                }
                self.selected_map.set(key, row);
                $(this).closest("tr").addClass("row-selected");
            } else {
                self.selected_map.delete(key);
                $(this).closest("tr").removeClass("row-selected");
                if (self.selected_map.size === 0) {
                    self.locked_company = null;
                }
            }
            self.update_action_summary();
        });

        // Select All / Clear Selection
        $(this.page.body).on("change", "#wire-select-all-header", function () {
            if ($(this).is(":checked")) {
                self.select_all_visible();
            } else {
                self.clear_selection();
            }
        });
        $(this.page.body).on("click", "#wire-select-all-btn", () => this.select_all_visible());
        $(this.page.body).on("click", "#wire-clear-sel-btn", () => this.clear_selection());

        // Click on doc link to open Detail Modal
        $(this.page.body).on("click", ".picker-doc-clickable-link", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const dt = $(this).attr("data-doctype");
            const nm = $(this).attr("data-name");
            if (dt && nm) {
                self.show_doc_detail_modal(dt, nm);
            }
        });

        $(this.page.body).on("click", "#wire-table-tbody tr[data-doctype][data-name]", function (e) {
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

            if ($(e.target).closest("input, button, a, .picker-doc-clickable-link, .wire-action-receive-btn, .wire-action-complete-inv-btn, .wire-quick-create-btn").length) {
                return;
            }
            const dt = $(this).attr("data-doctype") || "Purchase Invoice";
            const nm = $(this).attr("data-name");
            if (dt && nm) {
                self.show_doc_detail_modal(dt, nm);
            }
        });
    }

    async refresh_all() {
        await Promise.all([this.load_kpis(), this.load_table_data()]);
        this.render_kpis();
    }

    async load_kpis() {
        try {
            const r = await frappe.call({
                method: "ashan_cn_procurement.services.wire_transfer_service.get_wire_transfer_overview_kpis",
                args: { company: this.active_company },
            });
            if (r.message && r.message.kpis) {
                this.kpis = r.message.kpis;
            }
        } catch (e) {
            console.error("Failed to load wire transfer KPIs:", e);
        }
    }

    render_kpis() {
        const $container = $("#wire-kpi-grid");
        $container.empty();

        const cards = [
            {
                id: "total",
                name: "全部自办电汇",
                count: this.kpis.total?.count || 0,
                sub: `总额 ${this.fmt_money(this.kpis.total?.amount || 0)}`,
                badge: "总业务量",
                badge_cls: "ashan-status-blue",
            },
            {
                id: "paid_pending_receipt",
                name: "款付货未到",
                count: this.kpis.paid_pending_receipt?.count || 0,
                sub: `在途 ${this.fmt_money(this.kpis.paid_pending_receipt?.amount || 0)}`,
                badge: "待入库",
                badge_cls: "ashan-status-blue",
            },
            {
                id: "received_pending_invoice",
                name: "货到票未到",
                count: this.kpis.received_pending_invoice?.count || 0,
                sub: `暂估 ${this.fmt_money(this.kpis.received_pending_invoice?.amount || 0)}`,
                badge: "待补票",
                badge_cls: "ashan-status-yellow",
            },
            {
                id: "completed_closed",
                name: "🟢 全部完成",
                count: this.kpis.completed_closed?.count || 0,
                sub: `结案 ${this.fmt_money(this.kpis.completed_closed?.amount || 0)}`,
                badge: "已完成",
                badge_cls: "ashan-status-green",
            },
        ];

        cards.forEach((c) => {
            const html = `
                <div class="picker-kpi-card" data-card="${c.id}" title="点击快速筛选此类单据">
                    <div class="picker-kpi-header">
                        <div class="picker-kpi-title">${c.name}</div>
                        <span class="ashan-status-badge ${c.badge_cls}">${c.badge}</span>
                    </div>
                    <div class="picker-kpi-body">
                        <div class="picker-kpi-number">${c.count}</div>
                        <div class="picker-kpi-sub">${c.sub}</div>
                    </div>
                </div>
            `;
            $container.append(html);
        });
    }

    async load_table_data() {
        const request_id = (this._table_request_id || 0) + 1;
        this._table_request_id = request_id;
        const method = this.view_mode === "doc"
            ? "ashan_cn_procurement.services.wire_transfer_service.get_wire_transfer_doc_summary_rows"
            : "ashan_cn_procurement.services.wire_transfer_service.get_wire_transfer_picker_rows";

        try {
            const r = await frappe.call({
                method: method,
                args: {
                    company: this.active_company,
                    filters: this.filters,
                },
            });
            if (request_id !== this._table_request_id) return;
            this.table_data = (r.message && r.message.rows) ? r.message.rows : [];
            $("#wire-section-count-badge").text(`统计: ${this.table_data.length} 笔`);
            this.render_table();
        } catch (e) {
            console.error("Failed to load wire transfer table data:", e);
        }
    }

    get_row_key(r) {
        return this.view_mode === "doc" ? r.pi_name : (r.pii_name || `${r.pi_name}_${r.item_code}`);
    }

    render_table() {
        this.render_table_header();
        this.render_table_rows();
        this.render_table_footer();
        this.update_action_summary();
        this.sync_top_scrollbar_width();
    }

    render_table_header() {
        const is_all = this.active_company === "All";
        let ths = `
            <th class="picker-col-sticky-1">#</th>
            <th class="picker-col-sticky-2">
                <input type="checkbox" id="wire-select-all-header" title="全选/取消全选" />
            </th>
        `;
        if (is_all) {
            ths += `<th class="picker-col-sticky-3">所属公司</th>`;
        }

        if (this.view_mode === "doc") {
            ths += `
                <th>单据状态</th>
                <th>采购发票号</th>
                <th>供应商</th>
                <th>发票/暂估号码</th>
                <th>票据类型</th>
                <th>单据明细</th>
                <th>开票日期</th>
                <th>录单人</th>
                <th>发票总额</th>
                <th>待付款余额</th>
                <th>关联入库单</th>
                <th>关联出库单</th>
                <th>关联整算单</th>
                <th>关联付款单</th>
                <th>快捷操作</th>
            `;
        } else {
            ths += `
                <th>单据状态</th>
                <th>采购发票号</th>
                <th>供应商</th>
                <th>发票/暂估号码</th>
                <th>物料名称</th>
                <th>规格</th>
                <th>单位</th>
                <th>数量</th>
                <th>单价</th>
                <th>明细金额</th>
                <th>税率</th>
                <th>税额</th>
                <th>价税合计</th>
                <th>开票日期</th>
                <th>待付款余额</th>
                <th>关联入库单</th>
                <th>关联出库单</th>
                <th>关联整算单</th>
                <th>关联付款单</th>
                <th>快捷操作</th>
            `;
        }

        $("#wire-table-thead").html(`<tr>${ths}</tr>`);
    }

    render_table_rows() {
        const $tbody = $("#wire-table-tbody");
        $tbody.empty();

        if (!this.table_data || this.table_data.length === 0) {
            const is_all = this.active_company === "All";
            const col_span = this.view_mode === "doc" ? (is_all ? 17 : 16) : (is_all ? 21 : 20);
            $tbody.html(`
                <tr>
                    <td colspan="${col_span}">
                        <div class="picker-empty-state">
                            <div class="picker-empty-text">当前暂无符合条件的自办电汇记录，点击上方“➕ 新建自办电汇”即可开始录入。</div>
                        </div>
                    </td>
                </tr>
            `);
            return;
        }

        const is_all = this.active_company === "All";

        this.table_data.forEach((r, idx) => {
            const key = this.get_row_key(r);
            const is_selected = this.selected_map.has(key);

            let tr_html = `
                <tr data-key="${key}" data-doctype="Purchase Invoice" data-name="${frappe.utils.escape_html(r.pi_name)}" class="ashan-row-clickable ${is_selected ? 'row-selected' : ''}">
                    <td class="picker-col-sticky-1">${idx + 1}</td>
                    <td class="picker-col-sticky-2">
                        <input type="checkbox" class="picker-row-checkbox" data-key="${key}" ${is_selected ? 'checked' : ''} />
                    </td>
            `;

            if (is_all) {
                const comp_short = (r.company || "").includes("祺富") ? "祺富" : ((r.company || "").includes("吉众") ? "吉众" : (r.company || ""));
                const comp_cls = (r.company || "").includes("祺富") ? "picker-company-badge-qifu" : "picker-company-badge-jizhong";
                tr_html += `<td class="picker-col-sticky-3"><span class="picker-company-badge ${comp_cls}">${frappe.utils.escape_html(comp_short)}</span></td>`;
            }

            const lifecycle_badge = `
                <span class="picker-lifecycle-badge ${r.wire_lifecycle_badge || 'badge-lifecycle-closed'}" title="${frappe.utils.escape_html(r.wire_lifecycle_desc || '')}">
                    ${frappe.utils.escape_html(r.wire_lifecycle_label || '全部完成')}
                </span>
            `;

            let action_btns = `<div class="wire-table-actions">`;
            if (r.wire_lifecycle_status === "paid_pending_receipt") {
                action_btns += `<button type="button" class="btn btn-xs btn-primary wire-action-receive-btn" data-pi="${r.pi_name}" data-supplier="${frappe.utils.escape_html(r.supplier)}" title="物料送达，一键生成采购入库单与领料出库">📦 确认入库</button>`;
            } else if (r.wire_lifecycle_status === "received_pending_invoice") {
                action_btns += `<button type="button" class="btn btn-xs btn-warning wire-action-complete-inv-btn" data-pi="${r.pi_name}" data-bill-no="${frappe.utils.escape_html(r.bill_no)}" data-supplier="${frappe.utils.escape_html(r.supplier)}" title="发票寄达，一键补录税局正式发票号码">🧾 补录发票</button>`;
            }
            action_btns += `<button type="button" class="btn btn-xs btn-default picker-doc-clickable-link" data-doctype="Purchase Invoice" data-name="${r.pi_name}">👁 详情</button></div>`;

            if (this.view_mode === "doc") {
                const inv_type_badge = r.is_temporary_estimate
                    ? `<span class="ashan-status-badge ashan-status-yellow">暂估发票</span>`
                    : (r.invoice_type === "专用发票"
                        ? `<span class="ashan-status-badge ashan-status-purple">专用发票</span>`
                        : `<span class="ashan-status-badge ashan-status-blue">普通发票</span>`);

                const bill_badge_cls = r.is_temporary_estimate ? "ashan-tag-badge ashan-tag-amber" : "ashan-tag-badge ashan-tag-blue";

                tr_html += `
                    <td>${lifecycle_badge}</td>
                    <td><span class="picker-source-docname picker-doc-clickable-link" data-doctype="Purchase Invoice" data-name="${r.pi_name}">${frappe.utils.escape_html(r.pi_name)}</span></td>
                    <td>${frappe.utils.escape_html(r.supplier || "-")}</td>
                    <td><span class="${bill_badge_cls}">${frappe.utils.escape_html(r.bill_no || "暂估待补票")}</span></td>
                    <td>${inv_type_badge}</td>
                    <td>${this.render_doc_badges(r.custom_doc_details)}</td>
                    <td>${r.bill_date || r.posting_date || "-"}</td>
                    <td>${frappe.utils.escape_html(r.owner || "-")}</td>
                    <td class="picker-money-cell">${this.fmt_money(r.grand_total)}</td>
                    <td class="picker-money-cell cell-row-amt"><strong>${this.fmt_money(r.net_available_amount)}</strong></td>
                    <td>${this.render_linked_badges(r.linked_pr_names, "purchase-receipt", r.pi_name, r.supplier, null, r.has_stock_items)}</td>
                    <td>${this.render_linked_badges(r.linked_se_names, "stock-entry", r.pi_name, r.supplier, null, r.has_stock_items)}</td>
                    <td>${this.render_linked_badges(r.linked_rr_names, "reimbursement-request", r.pi_name, r.supplier, null, r.has_stock_items)}</td>
                    <td>${this.render_linked_badges(r.linked_pe_names, "payment-entry", r.pi_name, r.supplier, r.net_available_amount || r.outstanding_amount, r.has_stock_items, r.grand_total || r.total_amount)}</td>
                    <td>${action_btns}</td>
                `;
            } else {
                const bill_badge_cls = r.is_temporary_estimate ? "ashan-tag-badge ashan-tag-amber" : "ashan-tag-badge ashan-tag-blue";
                tr_html += `
                    <td>${lifecycle_badge}</td>
                    <td><span class="picker-source-docname picker-doc-clickable-link" data-doctype="Purchase Invoice" data-name="${r.pi_name}">${frappe.utils.escape_html(r.pi_name)}</span></td>
                    <td>${frappe.utils.escape_html(r.supplier || "-")}</td>
                    <td><span class="${bill_badge_cls}">${frappe.utils.escape_html(r.bill_no || "暂估待补票")}</span></td>
                    <td><span class="font-medium text-slate-800">${frappe.utils.escape_html(r.item_name || r.item_code || "-")}</span></td>
                    <td><span class="text-slate-600 text-xs">${frappe.utils.escape_html(r.spec || "-")}</span></td>
                    <td>${frappe.utils.escape_html(r.uom || "")}</td>
                    <td class="picker-qty-cell">${r.qty}</td>
                    <td class="picker-money-cell">${this.fmt_money(r.rate)}</td>
                    <td class="picker-money-cell">${this.fmt_money(r.amount)}</td>
                    <td>${flt(r.tax_rate)}%</td>
                    <td class="picker-money-cell">${this.fmt_money(r.tax_amount)}</td>
                    <td class="picker-money-cell">${this.fmt_money(r.total_amount)}</td>
                    <td>${r.bill_date || r.posting_date || "-"}</td>
                    <td class="picker-money-cell cell-row-amt"><strong>${this.fmt_money(r.net_available_amount)}</strong></td>
                    <td>${this.render_linked_badges(r.linked_pr_names, "purchase-receipt", r.pi_name, r.supplier, null, r.has_stock_items)}</td>
                    <td>${this.render_linked_badges(r.linked_se_names, "stock-entry", r.pi_name, r.supplier, null, r.has_stock_items)}</td>
                    <td>${this.render_linked_badges(r.linked_rr_names, "reimbursement-request", r.pi_name, r.supplier, null, r.has_stock_items)}</td>
                    <td>${this.render_linked_badges(r.linked_pe_names, "payment-entry", r.pi_name, r.supplier, r.net_available_amount || r.outstanding_amount, r.has_stock_items, r.grand_total || r.total_amount)}</td>
                    <td>${action_btns}</td>
                `;
            }

            tr_html += `</tr>`;
            $tbody.append(tr_html);
        });
    }

    render_table_footer() {
        const is_all = this.active_company === "All";
        let total_qty = 0;
        let total_amt = 0;
        let total_tax = 0;
        let total_grand = 0;
        let total_outstanding = 0;

        this.table_data.forEach((r) => {
            total_qty += flt(r.qty || r.total_qty || 0);
            total_amt += flt(r.amount || r.grand_total || 0);
            total_tax += flt(r.tax_amount || 0);
            total_grand += flt(r.total_amount || r.grand_total || 0);
            total_outstanding += flt(r.net_available_amount !== undefined ? r.net_available_amount : (r.outstanding_amount || 0));
        });

        const prefix_cols = is_all ? 3 : 2;
        let foot_html = `
            <tr>
                <td colspan="${prefix_cols}" class="picker-col-sticky-foot">合计 (共 ${this.table_data.length} 笔)</td>
        `;

        if (this.view_mode === "doc") {
            foot_html += `
                <td colspan="8"></td>
                <td class="picker-money-cell"><strong>${this.fmt_money(total_amt)}</strong></td>
                <td class="picker-money-cell"><strong>${this.fmt_money(total_outstanding)}</strong></td>
                <td colspan="5"></td>
            `;
        } else {
            foot_html += `
                <td colspan="7"></td>
                <td class="picker-qty-cell"><strong>${total_qty.toFixed(2)}</strong></td>
                <td></td>
                <td class="picker-money-cell"><strong>${this.fmt_money(total_amt)}</strong></td>
                <td></td>
                <td class="picker-money-cell"><strong>${this.fmt_money(total_tax)}</strong></td>
                <td class="picker-money-cell"><strong>${this.fmt_money(total_grand)}</strong></td>
                <td></td>
                <td class="picker-money-cell"><strong>${this.fmt_money(total_outstanding)}</strong></td>
                <td colspan="5"></td>
            `;
        }

        foot_html += `</tr>`;
        $("#wire-table-tfoot").html(foot_html);
    }

    update_action_summary() {
        const count = this.selected_map.size;
        let total_amt = 0;
        this.selected_map.forEach((r) => {
            total_amt += flt(r.net_available_amount || r.total_amount || r.grand_total || 0);
        });

        $("#wire-selected-count").text(count);
        $("#wire-selected-amount").text(this.fmt_money(total_amt));
    }

    select_all_visible() {
        this.selected_map.clear();
        this.table_data.forEach((r) => {
            const key = this.get_row_key(r);
            this.selected_map.set(key, r);
        });
        $(".picker-row-checkbox").prop("checked", true);
        $("#wire-table-tbody tr").addClass("row-selected");
        this.update_action_summary();
    }

    clear_selection() {
        this.selected_map.clear();
        this.locked_company = null;
        $(".picker-row-checkbox").prop("checked", false);
        $("#wire-table-tbody tr").removeClass("row-selected");
        $("#wire-select-all-header").prop("checked", false);
        this.update_action_summary();
    }

    sync_top_scrollbar_width() {
        const table_width = $("#wire-data-table").outerWidth() || 1200;
        $("#wire-top-scrollbar-inner").css("width", `${table_width}px`);
    }

    fmt_money(val) {
        return (window.AshanUI && AshanUI.formatMoney) ? AshanUI.formatMoney(val) : `¥ ${flt(val).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    render_doc_badges(doc_details_str) {
        if (!doc_details_str) return "-";
        const items = doc_details_str.split("、").map((s) => s.trim()).filter(Boolean);
        if (!items.length) return "-";
        return items.map((it) => {
            const match = it.match(/^(.+?)\s*\((.+?)\)$/);
            if (match) {
                return `<span class="ashan-doc-detail-badge"><span class="badge-item-name">${frappe.utils.escape_html(match[1])}</span><span class="badge-item-qty">${frappe.utils.escape_html(match[2])}</span></span>`;
            }
            return `<span class="ashan-doc-detail-badge">${frappe.utils.escape_html(it)}</span>`;
        }).join(" ");
    }

    render_linked_badges(linked_str, doctype_class, pi_name, supplier, amount, has_stock_items = true, grand_total = 0) {
        if ((doctype_class === "purchase-receipt" || doctype_class === "stock-entry") && has_stock_items === false) {
            return `<span class="picker-not-required-badge" title="纯非库存/服务类物料，无需实物出入库">/</span>`;
        }

        const names = linked_str ? linked_str.split("、").map((s) => s.trim()).filter(Boolean) : [];
        if (names.length) {
            return `<div class="picker-linked-wrap">${names.map((nm) => `<span class="picker-linked-badge badge-${doctype_class} picker-doc-clickable-link" data-doctype="${this.get_doctype_by_class(doctype_class)}" data-name="${nm}">${frappe.utils.escape_html(nm)}</span>`).join("")}</div>`;
        }

        const pi_attr = pi_name ? `data-pi="${frappe.utils.escape_html(pi_name)}"` : "";
        const sup_attr = supplier ? `data-supplier="${frappe.utils.escape_html(supplier)}"` : "";
        const amt_attr = amount !== undefined ? `data-amt="${amount}"` : "";
        const total_attr = grand_total ? `data-total="${grand_total}"` : "";

        if (doctype_class === "purchase-receipt") {
            return `<button type="button" class="wire-quick-create-btn wire-quick-create-pr" ${pi_attr} ${sup_attr} title="为此发票一键补建采购入库单">➕ 补建入库单</button>`;
        }
        if (doctype_class === "stock-entry") {
            return `<button type="button" class="wire-quick-create-btn wire-quick-create-se" ${pi_attr} ${sup_attr} title="为此发票一键补建领料出库单">➕ 补建出库单</button>`;
        }
        if (doctype_class === "reimbursement-request") {
            return `<button type="button" class="wire-quick-create-btn wire-quick-create-rr" ${pi_attr} ${sup_attr} title="为此发票一键补建电汇整算单">➕ 补建整算单</button>`;
        }
        if (doctype_class === "payment-entry") {
            return `<button type="button" class="wire-quick-create-btn wire-quick-create-pe" ${pi_attr} ${sup_attr} ${amt_attr} ${total_attr} title="为此发票一键新建电汇付款单">➕ 新建付款</button>`;
        }

        return `<span class="picker-linked-none">-</span>`;
    }

    get_doctype_by_class(cls) {
        if (cls === "purchase-receipt") return "Purchase Receipt";
        if (cls === "stock-entry") return "Stock Entry";
        if (cls === "purchase-invoice") return "Purchase Invoice";
        if (cls === "reimbursement-request") return "Reimbursement Request";
        if (cls === "payment-entry") return "Payment Entry";
        return "";
    }

    // =========================================================================
    // Batch creation of stock issues and reimbursement requests.
    // =========================================================================

    async batch_issue_selected_stock() {
        const self = this;
        const pi_names = [];
        this.selected_map.forEach((row) => {
            if (row.pi_name && !pi_names.includes(row.pi_name)) {
                pi_names.push(row.pi_name);
            }
        });

        if (pi_names.length === 0) {
            frappe.msgprint(__("请先勾选需要出库的自办电汇发票记录！"));
            return;
        }

        frappe.confirm(
            __(
                "将为已选的 {0} 笔自办发票生成并提交领料出库单及整算单。该操作会影响库存和结算状态，确认继续？",
                [pi_names.length]
            ),
            async function () {
                try {
                    frappe.dom.freeze(__("正在批量生成出库单与关联整算单..."));
                    const r = await frappe.call({
                        method: "ashan_cn_procurement.services.wire_transfer_service.issue_all_wire_transfer_stock",
                        args: { pi_names },
                    });
                    frappe.dom.unfreeze();

                    if (r.message && r.message.success) {
                        frappe.show_alert({
                            message: r.message.message || __("领料出库单及整算单已生成并提交。"),
                            indicator: "green",
                        }, 5);
                        self.clear_selection();
                        self.refresh_all();
                    }
                } catch (e) {
                    frappe.dom.unfreeze();
                    console.error("Failed to issue stock:", e);
                }
            }
        );
    }

    // =========================================================================
    // One-Click Action: 确认入库弹窗
    // =========================================================================

    open_receive_stock_modal(pi_name, supplier) {
        const self = this;
        const d = new frappe.ui.Dialog({
            title: __("确认到货入库 · {0}", [pi_name]),
            size: "small",
            static: true,
            fields: [
                {
                    fieldtype: "HTML",
                    fieldname: "receive_html",
                },
            ],
            primary_action_label: __("确认入库"),
            primary_action: async function () {
                const auto_issue = d.$wrapper.find("#modal-recv-auto-issue").is(":checked") ? 1 : 0;
                try {
                    frappe.dom.freeze(__("正在生成入库与出库单据..."));
                    const r = await frappe.call({
                        method: "ashan_cn_procurement.services.wire_transfer_service.receive_wire_transfer_stock",
                        args: {
                            pi_names: [pi_name],
                            auto_issue: auto_issue,
                        },
                    });
                    frappe.dom.unfreeze();
                    if (r.message && r.message.success) {
                        frappe.show_alert({
                            message: r.message.message || __("到货入库成功！"),
                            indicator: "green",
                        }, 5);
                        d.hide();
                        self.refresh_all();
                    }
                } catch (e) {
                    frappe.dom.unfreeze();
                    console.error("Failed to receive stock:", e);
                }
            },
            secondary_action_label: __("取消"),
            secondary_action: function () {
                d.hide();
            },
        });

        d.$wrapper.find(".modal-dialog").addClass("ashan-smart-modal");

        const html = `
            <div class="ashan-smart-modal-body">
                <div class="ashan-smart-section">
                    <p class="text-slate-700 font-medium">确认供应商 <strong>${frappe.utils.escape_html(supplier || "-")}</strong> 的物料已送达厂区？</p>
                    <div class="ashan-smart-toggle-box ashan-smart-toggle-first">
                        <input type="checkbox" id="modal-recv-auto-issue" checked />
                        <span>同步生成领料出库单（直接消耗并闭环）</span>
                    </div>
                </div>
            </div>
        `;

        d.fields_dict.receive_html.$wrapper.html(html);
        d.show();
    }

    // =========================================================================
    // One-Click Action: 补录税局正式发票弹窗
    // =========================================================================

    open_complete_invoice_modal(pi_name, supplier, current_bill_no) {
        const self = this;
        const d = new frappe.ui.Dialog({
            title: __("补录税局正式发票 · {0}", [pi_name]),
            size: "small",
            static: true,
            fields: [
                {
                    fieldtype: "HTML",
                    fieldname: "inv_html",
                },
            ],
            primary_action_label: __("确认补录发票"),
            primary_action: async function () {
                const bill_no = d.$wrapper.find("#modal-comp-bill-no").val().trim();
                const bill_date = d.$wrapper.find("#modal-comp-bill-date").val();
                const invoice_type = d.$wrapper.find("#modal-comp-inv-type").val();

                if (!bill_no) {
                    frappe.msgprint(__("请输入有效的正式发票号码！"));
                    return;
                }

                try {
                    frappe.dom.freeze(__("正在登记正式发票..."));
                    const r = await frappe.call({
                        method: "ashan_cn_procurement.services.wire_transfer_service.complete_wire_transfer_invoice",
                        args: {
                            pi_name: pi_name,
                            bill_no: bill_no,
                            bill_date: bill_date,
                            invoice_type: invoice_type,
                        },
                    });
                    frappe.dom.unfreeze();
                    if (r.message && r.message.success) {
                        frappe.show_alert({
                            message: r.message.message || __("正式发票登记成功！"),
                            indicator: "green",
                        }, 5);
                        d.hide();
                        self.refresh_all();
                    }
                } catch (e) {
                    frappe.dom.unfreeze();
                    console.error("Failed to complete invoice:", e);
                }
            },
            secondary_action_label: __("取消"),
            secondary_action: function () {
                d.hide();
            },
        });

        d.$wrapper.find(".modal-dialog").addClass("ashan-smart-modal");

        const html = `
            <div class="ashan-smart-modal-body">
                <div class="ashan-smart-section">
                    <p class="text-slate-600 text-xs mb-2">当前单据为暂估入库（原暂估号: <code>${frappe.utils.escape_html(current_bill_no || "-")}</code>），录入收到税局发票：</p>
                    <div class="ashan-smart-grid-2">
                        <div class="ashan-smart-field">
                            <label class="ashan-smart-field-label">正式发票号码 <span class="req">*</span></label>
                            <input type="text" class="ashan-smart-control" id="modal-comp-bill-no" placeholder="如 24122000000123456789..." />
                        </div>
                        <div class="ashan-smart-field">
                            <label class="ashan-smart-field-label">开票日期</label>
                            <input type="date" class="ashan-smart-control" id="modal-comp-bill-date" value="${frappe.datetime.nowdate()}" />
                        </div>
                        <div class="ashan-smart-field wire-detail-grid-span2">
                            <label class="ashan-smart-field-label">发票类型</label>
                            <div class="ashan-segmented-control">
                                <button type="button" class="ashan-segment-btn modal-comp-type-btn active" data-type="专用发票">增值税专用发票</button>
                                <button type="button" class="ashan-segment-btn modal-comp-type-btn" data-type="普通发票">普通发票</button>
                            </div>
                            <input type="hidden" id="modal-comp-inv-type" value="专用发票" />
                        </div>
                    </div>
                </div>
            </div>
        `;

        d.fields_dict.inv_html.$wrapper.html(html);

        d.$wrapper.on("click", ".modal-comp-type-btn", function () {
            const tp = $(this).attr("data-type");
            d.$wrapper.find(".modal-comp-type-btn").removeClass("active");
            $(this).addClass("active");
            d.$wrapper.find("#modal-comp-inv-type").val(tp);
        });

        d.show();
    }

    // =========================================================================
    // Create Self-Service Wire Transfer Modal
    // =========================================================================

    open_create_wire_transfer_modal() {
        const self = this;
        const contextCompany = window.AshanWorkContext?.getCompany?.();
        let default_company = (contextCompany && contextCompany !== "All")
            ? contextCompany
            : (this.active_company !== "All" ? this.active_company : (this.companies[0]?.name || ""));

        const d = new frappe.ui.Dialog({
            title: __("新建自办电汇"),
            size: "extra-large",
            static: true,
            fields: [
                {
                    fieldtype: "HTML",
                    fieldname: "form_html",
                },
            ],
            primary_action_label: __("生成自办电汇单据"),
            primary_action: async function () {
                await self.submit_create_wire_transfer(d);
            },
            secondary_action_label: __("关闭"),
            secondary_action: function () {
                d.hide();
            },
        });

        d.$wrapper.find(".modal-dialog").addClass("ashan-smart-modal");

        let company_options = this.companies.map((c) => `<option value="${c.name}" ${c.name === default_company ? 'selected' : ''}>${frappe.utils.escape_html(c.company_name || c.name)}</option>`).join("");

        const form_html = `
            <div class="ashan-smart-modal-body">
                <!-- Section 1: Basic Info & Invoice Arrival Mode -->
                <div class="ashan-smart-section">
                    <div class="ashan-smart-section-header">
                        <div class="ashan-smart-section-title">
                            <span>电汇业务与票物状态</span>
                        </div>
                    </div>
                    <div class="ashan-smart-grid-4">
                        <div class="ashan-smart-field">
                            <label class="ashan-smart-field-label">所属公司 <span class="req">*</span></label>
                            <select id="modal-wire-company" class="ashan-smart-control">
                                ${company_options}
                            </select>
                        </div>
                        <div class="ashan-smart-field">
                            <label class="ashan-smart-field-label">供应商名称 <span class="req">*</span></label>
                            <input type="text" class="ashan-smart-control" id="modal-wire-supplier" placeholder="输入或搜索供应商..." />
                        </div>
                        <div class="ashan-smart-field">
                            <label class="ashan-smart-field-label">发票到票情况</label>
                            <div class="ashan-segmented-control" id="modal-wire-invoice-arrival-control">
                                <button type="button" class="ashan-segment-btn wire-inv-arrival-btn active" data-arrival="real">🟢 正式发票已到</button>
                                <button type="button" class="ashan-segment-btn wire-inv-arrival-btn" data-arrival="estimate">🟡 暂估入库(票未到)</button>
                            </div>
                            <input type="hidden" id="modal-wire-is-estimate" value="0" />
                        </div>
                        <div class="ashan-smart-field" id="modal-wire-bill-no-container">
                            <label class="ashan-smart-field-label">发票号码 <span class="req">*</span></label>
                            <input type="text" class="ashan-smart-control" id="modal-wire-bill-no" placeholder="输入税局发票号..." />
                        </div>
                        <div class="ashan-smart-field">
                            <label class="ashan-smart-field-label">业务/发票日期</label>
                            <input type="date" class="ashan-smart-control" id="modal-wire-bill-date" value="${frappe.datetime.nowdate()}" />
                        </div>
                        <div class="ashan-smart-field">
                            <label class="ashan-smart-field-label">发票类型</label>
                            <div class="ashan-segmented-control" aria-label="发票类型">
                                <button type="button" class="ashan-segment-btn wire-invoice-type-btn active" data-invoice-type="专用发票">专用发票</button>
                                <button type="button" class="ashan-segment-btn wire-invoice-type-btn" data-invoice-type="普通发票">普通发票</button>
                            </div>
                            <input type="hidden" id="modal-wire-inv-type" value="专用发票" />
                        </div>
                        <div class="ashan-smart-field">
                            <label class="ashan-smart-field-label">默认目标仓库</label>
                            <input type="text" class="ashan-smart-control" id="modal-wire-warehouse" placeholder="默认 Goods In Transit..." />
                        </div>
                    </div>
                    <div class="ashan-smart-toggle-box ashan-smart-toggle-first">
                        <input type="checkbox" id="modal-wire-auto-receive" checked />
                        <span><strong>实物到厂入库</strong>：货物已送达，自动生成采购入库单并完成过账（取消勾选则标记为【款付货未到】在途跟踪）</span>
                    </div>
                    <div class="ashan-smart-toggle-box ashan-smart-toggle-item">
                        <input type="checkbox" id="modal-wire-auto-issue" checked />
                        <span><strong>即入即出</strong>：库存物料自动生成领料出库单并完成全部出库</span>
                    </div>
                    <div class="ashan-smart-toggle-box ashan-smart-toggle-item">
                        <input type="checkbox" id="modal-wire-auto-reim" checked />
                        <span><strong>整算闭环</strong>：自动生成电汇付款整算单并建立闭环关联</span>
                    </div>
                </div>

                <!-- Section 2: Items Details Table -->
                <div class="ashan-smart-section">
                    <div class="ashan-smart-section-header">
                        <div class="ashan-smart-section-title">
                            <span>物料明细</span>
                        </div>
                        <div class="ashan-smart-section-tools">
                            <button type="button" class="btn btn-default btn-xs" id="modal-wire-add-row-btn">添加物料行</button>
                        </div>
                    </div>

                    <div class="wire-modal-item-table-wrap">
                        <table class="wire-modal-item-table" id="modal-wire-items-table">
                            <thead>
                                <tr>
                                    <th class="wire-col-idx">#</th>
                                    <th class="wire-col-item-code">物料代码 <span class="req">*</span></th>
                                    <th class="wire-col-item-name">物料名称</th>
                                    <th class="wire-col-spec">规格</th>
                                    <th class="wire-col-uom">单位</th>
                                    <th class="wire-col-qty">数量 <span class="req">*</span></th>
                                    <th class="wire-col-rate">单价 <span class="req">*</span></th>
                                    <th class="wire-col-tax-rate">税率</th>
                                    <th class="wire-col-amt">不含税金额</th>
                                    <th class="wire-col-tax-amt">税额</th>
                                    <th class="wire-col-total">价税合计</th>
                                    <th class="wire-col-remarks">备注</th>
                                    <th class="wire-col-op">操作</th>
                                </tr>
                            </thead>
                            <tbody id="modal-wire-items-tbody"></tbody>
                        </table>
                    </div>
                </div>

                <!-- Section 3: Live Financial Summary & Discipline Bar -->
                <div class="ashan-smart-summary-bar">
                    <div class="ashan-smart-tip-box">
                        <span class="ashan-smart-tip-badge">财务纪律</span>
                        <span>单价与金额严禁为 0。系统支持在途待入库、暂估待到票与全部完成灵活流转。</span>
                    </div>
                    <div class="ashan-smart-kpi-group">
                        <div class="ashan-smart-kpi-item">
                            <span class="ashan-smart-kpi-label">订购总数</span>
                            <span class="ashan-smart-kpi-value" id="modal-wire-sum-qty">0.00</span>
                        </div>
                        <div class="ashan-smart-kpi-item">
                            <span class="ashan-smart-kpi-label">不含税金额</span>
                            <span class="ashan-smart-kpi-value" id="modal-wire-sum-amt">¥ 0.00</span>
                        </div>
                        <div class="ashan-smart-kpi-item">
                            <span class="ashan-smart-kpi-label">预估税额</span>
                            <span class="ashan-smart-kpi-value" id="modal-wire-sum-tax">¥ 0.00</span>
                        </div>
                        <div class="ashan-smart-kpi-item">
                            <span class="ashan-smart-kpi-label">电汇总额 (价税合计)</span>
                            <span class="ashan-smart-kpi-value grand-total text-primary" id="modal-wire-sum-total">¥ 0.00</span>
                        </div>
                    </div>
                </div>
            </div>
        `;

        d.fields_dict.form_html.$wrapper.html(form_html);

        // Toggle Invoice Arrival Mode (正式发票 vs 暂估入库)
        d.$wrapper.on("click", ".wire-inv-arrival-btn", function () {
            const arrival = $(this).attr("data-arrival");
            d.$wrapper.find(".wire-inv-arrival-btn").removeClass("active");
            $(this).addClass("active");

            if (arrival === "estimate") {
                d.$wrapper.find("#modal-wire-is-estimate").val("1");
                d.$wrapper.find("#modal-wire-bill-no").val("暂估-系统自动生成").prop("disabled", true);
            } else {
                d.$wrapper.find("#modal-wire-is-estimate").val("0");
                if (d.$wrapper.find("#modal-wire-bill-no").val().includes("暂估")) {
                    d.$wrapper.find("#modal-wire-bill-no").val("");
                }
                d.$wrapper.find("#modal-wire-bill-no").prop("disabled", false);
            }
        });

        d.$wrapper.on("click", ".wire-invoice-type-btn", function () {
            const invoice_type = $(this).attr("data-invoice-type");
            d.$wrapper.find(".wire-invoice-type-btn").removeClass("active");
            $(this).addClass("active");
            d.$wrapper.find("#modal-wire-inv-type").val(invoice_type);
        });

        // Bind Add Row
        d.$wrapper.on("click", "#modal-wire-add-row-btn", () => this.add_wire_modal_row(d));

        // Bind Row Delete
        d.$wrapper.on("click", ".wire-row-delete-btn", function () {
            $(this).closest("tr").remove();
            self.recalc_wire_modal_totals(d);
        });

        // Bind Calculations
        d.$wrapper.on("input change", ".wire-item-qty, .wire-item-rate, .wire-item-tax-rate", function () {
            const $tr = $(this).closest("tr");
            self.recalc_wire_modal_row($tr);
            self.recalc_wire_modal_totals(d);
        });

        // Autocomplete Item Code
        d.$wrapper.on("change", ".wire-item-code", async function () {
            const $tr = $(this).closest("tr");
            const code = $(this).val().trim();
            if (!code) return;

            try {
                const item_info = await frappe.db.get_value("Item", code, ["item_name", "stock_uom", "standard_rate", "description"]);
                if (item_info && item_info.message) {
                    const msg = item_info.message;
                    $tr.find(".wire-item-name").val(msg.item_name || code);
                    $tr.find(".wire-item-uom").val(msg.stock_uom || "Nos");
                    const $spec = $tr.find(".wire-item-spec");
                    if (!$spec.val().trim()) {
                        $spec.val(msg.description || "");
                    }
                    if (flt(msg.standard_rate) > 0 && flt($tr.find(".wire-item-rate").val()) === 0) {
                        $tr.find(".wire-item-rate").val(flt(msg.standard_rate).toFixed(2));
                    }
                    self.recalc_wire_modal_row($tr);
                    self.recalc_wire_modal_totals(d);
                }
            } catch (e) {
                console.log("Item lookup error:", e);
            }
        });

        d.show();

        // Add 2 initial rows after show
        this.add_wire_modal_row(d);
    }

    add_wire_modal_row(dialog) {
        const $tbody = (dialog && dialog.$wrapper) ? dialog.$wrapper.find("#modal-wire-items-tbody") : $("#modal-wire-items-tbody");
        const row_idx = $tbody.find("tr").length + 1;
        const tr_html = `
            <tr>
                <td class="wire-col-idx wire-col-idx-val">${row_idx}</td>
                <td class="wire-col-item-code"><input type="text" class="wire-table-input wire-item-code" placeholder="输入物料代码..." /></td>
                <td class="wire-col-item-name"><input type="text" class="wire-table-input wire-item-name" placeholder="物料名称" /></td>
                <td class="wire-col-spec"><input type="text" class="wire-table-input wire-item-spec" placeholder="规格" /></td>
                <td class="wire-col-uom"><input type="text" class="wire-table-input wire-item-uom text-center" value="Nos" /></td>
                <td class="wire-col-qty"><input type="number" class="wire-table-input wire-item-qty text-right font-bold" value="1" min="0.001" step="any" /></td>
                <td class="wire-col-rate"><input type="number" class="wire-table-input wire-item-rate text-right font-bold" value="0.00" min="0.01" step="any" /></td>
                <td class="wire-col-tax-rate"><input type="number" class="wire-table-input wire-item-tax-rate text-center" value="13" min="0" max="100" /></td>
                <td class="wire-col-amt"><input type="number" class="wire-table-input wire-item-amt text-right font-bold" value="0.00" readonly /></td>
                <td class="wire-col-tax-amt"><input type="number" class="wire-table-input wire-item-tax-amt text-right" value="0.00" readonly /></td>
                <td class="wire-col-total"><input type="number" class="wire-table-input wire-item-total text-right font-bold text-primary" value="0.00" readonly /></td>
                <td class="wire-col-remarks"><input type="text" class="wire-table-input wire-item-remarks" placeholder="备注" /></td>
                <td class="wire-col-op text-center">
                    <button type="button" class="btn btn-xs btn-default wire-row-delete-btn ashan-smart-btn-del" title="删除此行">✕</button>
                </td>
            </tr>
        `;
        $tbody.append(tr_html);
    }

    recalc_wire_modal_row($tr) {
        const qty = flt($tr.find(".wire-item-qty").val());
        const rate = flt($tr.find(".wire-item-rate").val());
        const tax_rate = flt($tr.find(".wire-item-tax-rate").val());

        const amt = flt(qty * rate, 2);
        const tax_amt = flt(amt * (tax_rate / 100.0), 2);
        const total = flt(amt + tax_amt, 2);

        $tr.find(".wire-item-amt").val(amt.toFixed(2));
        $tr.find(".wire-item-tax-amt").val(tax_amt.toFixed(2));
        $tr.find(".wire-item-total").val(total.toFixed(2));
    }

    recalc_wire_modal_totals(dialog) {
        const $wrapper = dialog.$wrapper;
        let sum_qty = 0;
        let sum_amt = 0;
        let sum_tax = 0;
        let sum_total = 0;

        $wrapper.find("#modal-wire-items-tbody tr").each(function () {
            const qty = flt($(this).find(".wire-item-qty").val());
            const amt = flt($(this).find(".wire-item-amt").val());
            const tax = flt($(this).find(".wire-item-tax-amt").val());
            const total = flt($(this).find(".wire-item-total").val());

            sum_qty += qty;
            sum_amt += amt;
            sum_tax += tax;
            sum_total += total;
        });

        $wrapper.find("#modal-wire-sum-qty").text(sum_qty.toFixed(2));
        $wrapper.find("#modal-wire-sum-amt").text(this.fmt_money(sum_amt));
        $wrapper.find("#modal-wire-sum-tax").text(this.fmt_money(sum_tax));
        $wrapper.find("#modal-wire-sum-total").text(this.fmt_money(sum_total));
    }

    async submit_create_wire_transfer(dialog) {
        const $wrapper = dialog.$wrapper;
        const company = $wrapper.find("#modal-wire-company").val();
        const supplier = $wrapper.find("#modal-wire-supplier").val().trim();
        const is_estimate = $wrapper.find("#modal-wire-is-estimate").val() === "1";
        let bill_no = $wrapper.find("#modal-wire-bill-no").val().trim();
        const bill_date = $wrapper.find("#modal-wire-bill-date").val();
        const invoice_type = $wrapper.find("#modal-wire-inv-type").val();
        const warehouse = $wrapper.find("#modal-wire-warehouse").val().trim();
        const auto_receive = $wrapper.find("#modal-wire-auto-receive").is(":checked") ? 1 : 0;
        const auto_issue = $wrapper.find("#modal-wire-auto-issue").is(":checked") ? 1 : 0;
        const auto_reim = $wrapper.find("#modal-wire-auto-reim").is(":checked") ? 1 : 0;

        if (!company) {
            frappe.msgprint(__("请选择所属公司！"));
            return;
        }

        if (!supplier) {
            frappe.msgprint(__("请输入供应商名称！"));
            return;
        }

        if (!is_estimate && !bill_no) {
            frappe.msgprint(__("正式发票号码不能为空！"));
            return;
        }

        const items = [];
        let has_zero_val = false;

        $wrapper.find("#modal-wire-items-tbody tr").each(function () {
            const item_code = $(this).find(".wire-item-code").val().trim();
            const item_name = $(this).find(".wire-item-name").val().trim();
            const spec = $(this).find(".wire-item-spec").val().trim();
            const uom = $(this).find(".wire-item-uom").val().trim() || "Nos";
            const qty = flt($(this).find(".wire-item-qty").val());
            const rate = flt($(this).find(".wire-item-rate").val());
            const tax_rate = flt($(this).find(".wire-item-tax-rate").val());
            const amt = flt($(this).find(".wire-item-amt").val());
            const tax_amt = flt($(this).find(".wire-item-tax-amt").val());
            const total = flt($(this).find(".wire-item-total").val());
            const remarks = $(this).find(".wire-item-remarks").val().trim();

            if (item_code) {
                if (qty <= 0 || rate <= 0) {
                    has_zero_val = true;
                }
                items.push({
                    item_code,
                    item_name: item_name || item_code,
                    spec,
                    uom,
                    qty,
                    rate,
                    tax_rate,
                    amount: amt,
                    tax_amount: tax_amt,
                    total_amount: total,
                    remarks,
                });
            }
        });

        if (items.length === 0) {
            frappe.msgprint(__("请录入至少一行物料明细！"));
            return;
        }

        if (has_zero_val) {
            frappe.msgprint(__("财务纪律：物料数量与单价严禁为 0，请修正！"));
            return;
        }

        try {
            frappe.dom.freeze(__("正在生成自办电汇单据链..."));
            const r = await frappe.call({
                method: "ashan_cn_procurement.services.wire_transfer_service.create_self_service_wire_transfer_bundle",
                args: {
                    company,
                    supplier,
                    bill_no: is_estimate ? "" : bill_no,
                    bill_date,
                    invoice_type,
                    warehouse,
                    is_temporary_estimate: is_estimate ? 1 : 0,
                    auto_receive_stock: auto_receive,
                    auto_issue_stock: auto_issue,
                    create_reimbursement_request: auto_reim,
                    items,
                },
            });
            frappe.dom.unfreeze();

            if (r.message && r.message.success) {
                frappe.show_alert({
                    message: r.message.message || __("成功生成自办电汇单据！"),
                    indicator: "green",
                }, 5);
                dialog.hide();
                this.refresh_all();

            }
        } catch (e) {
            frappe.dom.unfreeze();
            console.error("Failed to create wire transfer bundle:", e);
        }
    }

    // =========================================================================
    // Document Detail Modal
    // =========================================================================

    // =========================================================================
    // One-Click Action: 新建付款单弹窗
    // =========================================================================

    open_create_payment_modal(pi_name, supplier, default_amt, grand_total = 0) {
        const self = this;
        const outstandingAmt = flt(default_amt) > 0 ? flt(default_amt) : 0;
        const totalOrderAmt = flt(grand_total) > 0 ? flt(grand_total) : (outstandingAmt > 0 ? outstandingAmt : 0);
        const alreadyPaidAmt = Math.max(0, flt(totalOrderAmt - outstandingAmt, 2));

        const d = new frappe.ui.Dialog({
            title: __("自办电汇 · 智能分期付款"),
            size: "medium",
            static: true,
            fields: [
                {
                    fieldtype: "HTML",
                    fieldname: "pay_info_html",
                },
                {
                    fieldname: "paid_amount",
                    label: __("本次实付金额 (¥)"),
                    fieldtype: "Currency",
                    default: outstandingAmt,
                    reqd: 1,
                },
                {
                    fieldname: "mode_of_payment",
                    label: __("付款方式"),
                    fieldtype: "Select",
                    options: ["电汇", "银行转账", "现金", "支票", "Wire Transfer"],
                    default: "电汇",
                    reqd: 1,
                },
                {
                    fieldname: "posting_date",
                    label: __("付款/出账日期"),
                    fieldtype: "Date",
                    default: frappe.datetime.get_today(),
                    reqd: 1,
                },
                {
                    fieldname: "reference_no",
                    label: __("银行交易流水号 / 电汇参考号"),
                    fieldtype: "Data",
                    placeholder: "选填，例如：WT-BANK-20260826-001 或 银行回单号",
                },
                {
                    fieldname: "remarks",
                    label: __("付款备注"),
                    fieldtype: "Small Text",
                    default: `自办电汇款项出账 · 发票: ${pi_name} · 供应商: ${supplier || '-'}`,
                },
            ],
            primary_action_label: __("确认执行付款"),
            secondary_action_label: __("取消"),
            secondary_action: function () {
                d.hide();
            },
            primary_action: async function (values) {
                const payAmt = flt(values.paid_amount);
                if (!payAmt || payAmt <= 0) {
                    frappe.msgprint(__("付款金额必须大于 0！"));
                    return;
                }
                if (payAmt > outstandingAmt + 0.01) {
                    frappe.msgprint(__("本次付款金额 (¥ {0}) 不能大于待付余额 (¥ {1})！", [payAmt.toFixed(2), outstandingAmt.toFixed(2)]));
                    return;
                }
                try {
                    frappe.dom.freeze(__("正在生成并提交付款单..."));
                    const r = await frappe.call({
                        method: "ashan_cn_procurement.services.wire_transfer_service.create_wire_transfer_payment_entry",
                        args: {
                            pi_name: pi_name,
                            paid_amount: values.paid_amount,
                            mode_of_payment: values.mode_of_payment,
                            posting_date: values.posting_date,
                            reference_no: values.reference_no,
                            remarks: values.remarks,
                        },
                    });
                    frappe.dom.unfreeze();
                    d.hide();
                    if (r.message && r.message.success) {
                        frappe.show_alert({
                            message: r.message.message || __("电汇付款单生成成功！"),
                            indicator: "green",
                        }, 5);
                        self.refresh_all();
                    }
                } catch (err) {
                    frappe.dom.unfreeze();
                    console.error("Failed to create payment entry:", err);
                }
            },
        });

        d.$wrapper.find(".modal-dialog").addClass("ashan-smart-modal");

        const update_calculations = (payAmt) => {
            const currentPay = Math.max(0, flt(payAmt, 2));
            const remainAfter = Math.max(0, flt(outstandingAmt - currentPay, 2));
            const totalPaidAfter = flt(alreadyPaidAmt + currentPay, 2);
            
            const totalBase = totalOrderAmt > 0 ? totalOrderAmt : outstandingAmt;
            const paidPct = totalBase > 0 ? (alreadyPaidAmt / totalBase * 100).toFixed(1) : "0.0";
            const currentPct = totalBase > 0 ? (currentPay / totalBase * 100).toFixed(1) : "0.0";
            const remainPct = totalBase > 0 ? (remainAfter / totalBase * 100).toFixed(1) : "0.0";

            d.$wrapper.find("#smart-pay-current-amt").text(self.fmt_money(currentPay));
            d.$wrapper.find("#smart-pay-current-pct").text(`${currentPct}%`);
            d.$wrapper.find("#smart-pay-remain-amt").text(self.fmt_money(remainAfter));
            d.$wrapper.find("#smart-pay-remain-pct").text(`${remainPct}%`);

            d.$wrapper.find("#smart-bar-paid").css("width", `${Math.min(100, flt(paidPct))}%`);
            d.$wrapper.find("#smart-bar-current").css("width", `${Math.min(100, flt(currentPct))}%`);

            if (currentPay > outstandingAmt + 0.01) {
                d.$wrapper.find("#smart-pay-remain-badge").addClass("warning").html(`⚠️ 超出待付欠款 ¥ ${self.fmt_money(currentPay - outstandingAmt)}`);
            } else {
                d.$wrapper.find("#smart-pay-remain-badge").removeClass("warning").html(`付款后剩余待付: <strong>${self.fmt_money(remainAfter)}</strong> (${remainPct}%)`);
            }
        };

        const pay_info_html = `
            <div class="ashan-payment-calc-card">
                <div class="ashan-smart-grid-3">
                    <div><span class="text-xs text-muted">采购发票:</span> <span class="font-mono text-primary font-bold">${frappe.utils.escape_html(pi_name)}</span></div>
                    <div><span class="text-xs text-muted">收款商户:</span> <span class="font-bold text-slate-800">${frappe.utils.escape_html(supplier || '-')}</span></div>
                    <div><span class="text-xs text-muted">单据总额:</span> <span class="font-mono text-slate-700 font-bold">${self.fmt_money(totalOrderAmt)}</span></div>
                </div>

                <div class="ashan-payment-divider">
                    <div class="ashan-payment-preset-header">
                        <span class="text-xs font-bold text-slate-700">🎯 快捷比例分期付款:</span>
                        <span class="ashan-remain-badge" id="smart-pay-remain-badge">付款后剩余待付: <strong>${self.fmt_money(0)}</strong></span>
                    </div>
                    <div class="ashan-percent-pill-group">
                        <button type="button" class="ashan-percent-pill" data-pct="20">20% 预付/定金</button>
                        <button type="button" class="ashan-percent-pill" data-pct="30">30% 进度款</button>
                        <button type="button" class="ashan-percent-pill" data-pct="50">50% 中期款</button>
                        <button type="button" class="ashan-percent-pill" data-pct="80">80% 验收款</button>
                        <button type="button" class="ashan-percent-pill active" data-pct="100">100% 全额付清</button>
                    </div>
                </div>

                <div class="ashan-payment-progress-wrap">
                    <div class="ashan-payment-progress-labels">
                        <span>已付累计: ${self.fmt_money(alreadyPaidAmt)}</span>
                        <span>本次实付: <strong class="text-blue-600 font-mono" id="smart-pay-current-amt">${self.fmt_money(outstandingAmt)}</strong> (<span id="smart-pay-current-pct">100%</span>)</span>
                    </div>
                    <div class="ashan-payment-progress-bar">
                        <div class="ashan-progress-paid ashan-progress-init-0" id="smart-bar-paid"></div>
                        <div class="ashan-progress-current ashan-progress-init-100" id="smart-bar-current"></div>
                        <div class="ashan-progress-remain"></div>
                    </div>
                </div>
            </div>
        `;
        d.set_value("pay_info_html", pay_info_html);
        d.show();

        // 绑定比例点击事件
        d.$wrapper.on("click", ".ashan-percent-pill", function () {
            d.$wrapper.find(".ashan-percent-pill").removeClass("active");
            $(this).addClass("active");
            const pct = flt($(this).data("pct"));
            let targetAmt = 0;
            if (pct === 100) {
                targetAmt = outstandingAmt;
            } else {
                const base = totalOrderAmt > 0 ? totalOrderAmt : outstandingAmt;
                targetAmt = flt(base * (pct / 100), 2);
                if (targetAmt > outstandingAmt) targetAmt = outstandingAmt;
            }
            d.set_value("paid_amount", targetAmt);
            update_calculations(targetAmt);
        });

        // 监听金额输入变动
        d.$wrapper.find('input[data-fieldname="paid_amount"]').on("input change", function () {
            d.$wrapper.find(".ashan-percent-pill").removeClass("active");
            const val = flt($(this).val());
            update_calculations(val);
        });

        update_calculations(outstandingAmt);
    }

    async show_doc_detail_modal(doctype, name) {
        try {
            frappe.dom.freeze(__("加载单据详情中..."));
            const doc = await frappe.db.get_doc(doctype, name);
            frappe.dom.unfreeze();

            if (!doc) return;

            let items_html = "";
            (doc.items || []).forEach((it, idx) => {
                items_html += `
                    <tr>
                        <td class="text-center">${idx + 1}</td>
                        <td><strong>${frappe.utils.escape_html(it.item_code || "-")}</strong></td>
                        <td>${frappe.utils.escape_html(it.item_name || "-")}</td>
                        <td>${frappe.utils.escape_html(it.description || it.custom_spec_model || "-")}</td>
                        <td class="text-center">${frappe.utils.escape_html(it.uom || it.stock_uom || "")}</td>
                        <td class="text-right">${it.qty || 0}</td>
                        <td class="text-right">${this.fmt_money(it.rate)}</td>
                        <td class="text-right">${this.fmt_money(it.amount)}</td>
                        <td class="text-center">${flt(it.custom_tax_rate || 13)}%</td>
                        <td class="text-right font-bold text-primary">${this.fmt_money(it.custom_total_amount || it.amount)}</td>
                    </tr>
                `;
            });

            const html = `
                <div class="ashan-doc-detail-modal">
                    <div class="ashan-smart-grid-4 ashan-doc-detail-grid">
                        <div><strong>单据编号:</strong> ${frappe.utils.escape_html(name)}</div>
                        <div><strong>所属公司:</strong> ${frappe.utils.escape_html(doc.company || "-")}</div>
                        <div><strong>供应商:</strong> ${frappe.utils.escape_html(doc.supplier || "-")}</div>
                        <div><strong>业务日期:</strong> ${doc.posting_date || doc.transaction_date || "-"}</div>
                        <div><strong>发票/暂估号:</strong> ${frappe.utils.escape_html(doc.bill_no || "-")}</div>
                        <div><strong>总金额:</strong> <span class="text-primary font-bold">${this.fmt_money(doc.grand_total || doc.total)}</span></div>
                        <div><strong>待付余额:</strong> <span class="text-danger font-bold">${this.fmt_money(doc.outstanding_amount)}</span></div>
                        <div><strong>录单人:</strong> ${frappe.utils.escape_html(doc.owner || "-")}</div>
                    </div>
                    <div class="ashan-smart-table-wrap">
                        <table class="ashan-smart-table">
                            <thead>
                                <tr>
                                    <th class="ashan-col-w40">#</th>
                                    <th>物料代码</th>
                                    <th>物料名称</th>
                                    <th>规格</th>
                                    <th>单位</th>
                                    <th>数量</th>
                                    <th>单价</th>
                                    <th>不含税金额</th>
                                    <th>税率</th>
                                    <th>价税合计</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${items_html || '<tr><td colspan="10" class="text-center text-muted">暂无明细</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;

            const d = new frappe.ui.Dialog({
                title: `${doctype}: ${name}`,
                size: "large",
                fields: [{ fieldtype: "HTML", fieldname: "detail_html" }],
                secondary_action_label: __("关闭"),
                secondary_action: () => d.hide(),
            });

            d.fields_dict.detail_html.$wrapper.html(html);
            d.show();
        } catch (e) {
            frappe.dom.unfreeze();
            console.error("Failed to show doc detail modal:", e);
        }
    }
}
