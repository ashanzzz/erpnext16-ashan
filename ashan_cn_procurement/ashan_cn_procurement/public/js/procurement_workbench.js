// Copyright (c) 2026, Ashan CN Procurement and contributors
// Shared, role-focused procurement workbench runtime.

(() => {
const PROCUREMENT_WORKBENCH_PROFILES = {
    request: {
        key: "request",
        route: "material-request-workbench",
        title: "物料申请",
        subtitle: "登记物料、数量、参考价格与备注，跟踪后续采购进度",
        stages: ["item_to_mr"],
    },
    execution: {
        key: "execution",
        route: "procurement-execution-workbench",
        title: "采购执行",
        subtitle: "集中处理采购订货、发票登记、整算单与对公付款单",
        stages: ["mr_to_po", "pr_to_pi", "pi_to_rr", "pi_to_pay"],
    },
    receipt: {
        key: "receipt",
        route: "material-receipt-workbench",
        title: "收货入库",
        subtitle: "核对订购数量、实收数量、未收数量与入库金额",
        stages: ["po_to_pr"],
    },
};

class ProcurementOrderPickerCenter {
    constructor(page, profile) {
        this.page = page;
        this.$body = $(page.body);
        this.profile = profile;
        this.page_route = profile.route;
        this.allowed_stages = [...profile.stages];
        this.active_stage = this.allowed_stages[0];
        this.capabilities = {};
        this.is_manager = false;
        this.view_modes = {
            item_to_mr: "detail",
            mr_to_po: "detail",
            po_to_pr: "detail",
            pr_to_pi: "detail",
            pi_to_rr: "detail",
            pi_to_pay: "detail",
        };
        this.active_company = window.AshanWorkContext?.getCompany?.() || "All";
        this.companies = [];
        this.locked_company = null; // Dynamically set when first row is checked in "All" mode
        this.kpis = {};
        this.table_data = [];
        this.selected_map = new Map(); // key -> row object
        this.filters = {
            item_to_mr: { match_status: "all", mr_name: "", item_code: "", item_group: "", department: "" },
            mr_to_po: { match_status: "pending", linked_doc: "", supplier: "", department: "", item_code: "", from_date: "", to_date: "" },
            po_to_pr: { match_status: "pending", linked_doc: "", supplier: "", warehouse: "", po_name: "", item_code: "" },
            pr_to_pi: { match_status: "pending", linked_doc: "", supplier: "", pr_name: "", item_code: "" },
            pi_to_rr: { match_status: "pending", linked_doc: "", supplier: "", bill_no: "", owner: "" },
            pi_to_pay: { match_status: "pending", linked_doc: "", supplier: "", bill_no: "", owner: "" },
        };

        this.stages_config = {
            item_to_mr: {
                id: "item_to_mr",
                name: "物料申请",
                banner_title: "当前：物料申请",
                banner_desc: "登记物料申请，核对草稿与正式单据；支持对未关联下游的单据执行撤单或删除。",
                sub_label: "草稿",
                btn_label: "",
            },
            mr_to_po: {
                id: "mr_to_po",
                name: "采购订货",
                banner_title: "当前：采购订货",
                banner_desc: "按供应商整理待采购物料，核对数量、单价、金额和备注后生成采购订单。",
                sub_label: "待采购",
                btn_label: "生成采购订单",
            },
            po_to_pr: {
                id: "po_to_pr",
                name: "收货入库",
                banner_title: "当前：收货入库",
                banner_desc: "核对订购数量、累计已收和本次实收数量，确认后生成采购入库单。",
                sub_label: "待入库",
                btn_label: "生成采购入库单",
            },
            pr_to_pi: {
                id: "pr_to_pi",
                name: "发票登记",
                banner_title: "当前：发票登记",
                banner_desc: "根据已入库数量登记发票号码、日期、金额和税额，生成采购发票。",
                sub_label: "待开票",
                btn_label: "生成采购发票",
            },
            pi_to_rr: {
                id: "pi_to_rr",
                name: "整算单",
                banner_title: "当前：整算单 (多发票汇总对账与结算申请)",
                banner_desc: "对采购发票进行批量归集、集中对账与统算，生成整算单据并锁定发票，支持转入现金报销或批量电汇支付审批。",
                sub_label: "待整算",
                btn_label: "生成发票整算单",
            },
            pi_to_pay: {
                id: "pi_to_pay",
                name: "付款单",
                banner_title: "当前：付款单 (对公电汇与付款核销)",
                banner_desc: "核对待付采购发票，选择公司付款银行账户向供应商电汇付清货款，生成付款凭单并核销应付账款。",
                sub_label: "待付款",
                btn_label: "生成对公电汇付款单",
            },
        };

        this.init();
    }

    show() {
        this.sync_route_params();
        this.render_company_select();
        this.refresh_all();
    }

    async init() {
        try {
            await this.load_workbench_context();
        } catch (error) {
            const message = error && error.message ? error.message : __("当前账号无法打开此工作台。请联系管理员检查岗位权限。");
            this.$body.html(`
                <div class="picker-access-state">
                    <div class="picker-access-title">无法打开工作台</div>
                    <div class="picker-access-message">${frappe.utils.escape_html(message)}</div>
                </div>
            `);
            return;
        }
        this.setup_ui_skeleton();
        await this.load_companies();
        this.bind_global_events();
        this.sync_route_params();
        this.refresh_all();
    }

    async load_workbench_context() {
        const response = await frappe.call({
            method: "ashan_cn_procurement.services.procurement_picker_service.get_procurement_workbench_context",
            args: { workbench: this.profile.key },
        });
        const context = response && response.message ? response.message : {};
        const server_stages = context.allowed_stages || [];
        this.allowed_stages = this.profile.stages.filter((stage) => server_stages.includes(stage));
        if (!this.allowed_stages.length) {
            frappe.throw(__("当前账号没有此工作台的业务权限。"));
        }
        this.active_stage = this.allowed_stages[0];
        this.capabilities = context.capabilities || {};
        this.is_manager = Boolean(context.is_manager);
    }

    setup_ui_skeleton() {
        const tabs_nav_html = this.allowed_stages.length > 1 ? `
                <!-- Single-tier Task Tabs Navigation -->
                <div class="picker-nav-tabs-wrap">
                    <div class="picker-nav-tabs" id="picker-kpi-grid"></div>
                </div>
        ` : "";

        const html = `
            <div class="picker-page-container" data-workbench="${this.profile.key}" data-stage-count="${this.allowed_stages.length}">
                <!-- Top Header & Company Dropdown -->
                <div class="picker-top-bar">
                    <div class="picker-title-group">
                        <h2>${frappe.utils.escape_html(this.profile.title)}</h2>
                        <div class="picker-subtitle">${frappe.utils.escape_html(this.profile.subtitle)}</div>
                    </div>
                    <div class="picker-company-group">
                        <label class="picker-company-label" for="picker-company-select">所属公司:</label>
                        <select class="picker-company-select" id="picker-company-select">
                            <option value="All">全部公司</option>
                        </select>
                    </div>
                </div>

                ${tabs_nav_html}

                <!-- Section Context Banner -->
                <div class="picker-section-banner" id="picker-section-banner"></div>

                <!-- Dynamic Filter Bar -->
                <div class="picker-filter-bar" id="picker-filter-bar"></div>

                <!-- Action Bar -->
                <div class="picker-action-bar" id="picker-action-bar"></div>

                <!-- Table Wrapper with Dual Scrollbars -->
                <div class="picker-table-wrapper">
                    <div class="picker-top-scrollbar-wrap" id="picker-top-scrollbar">
                        <div class="picker-top-scrollbar-inner" id="picker-top-scrollbar-inner"></div>
                    </div>
                    <div class="picker-main-table-scroll" id="picker-main-table-scroll">
                        <table class="picker-data-table" id="picker-data-table">
                            <thead id="picker-table-thead"></thead>
                            <tbody id="picker-table-tbody"></tbody>
                            <tfoot id="picker-table-tfoot"></tfoot>
                        </table>
                    </div>
                </div>
            </div>
        `;
        this.$body.html(html);
        this.update_action_summary();
    }

    async load_companies() {
        try {
            const r = await frappe.call({
                method: "ashan_cn_procurement.services.procurement_picker_service.get_user_procurement_companies",
            });
            if (r && r.message) {
                this.companies = r.message.companies || [];
                this.render_company_select();
            }
        } catch (e) {
            console.error("Failed to load user companies", e);
        }
    }

    render_company_select() {
        const $select = this.$body.find("#picker-company-select");
        $select.empty();

        $select.append(`<option value="All" ${this.active_company === 'All' ? 'selected' : ''}>全部公司</option>`);

        this.companies.forEach((comp) => {
            const is_selected = this.active_company === comp;
            $select.append(`<option value="${frappe.utils.escape_html(comp)}" ${is_selected ? 'selected' : ''}>${frappe.utils.escape_html(comp)}</option>`);
        });
    }

    bind_global_events() {
        const self = this;

        document.addEventListener("ashan-work-context-changed", (event) => {
            const selectedCompany = event.detail?.company || "All";
            if (selectedCompany === self.active_company) return;
            if (selectedCompany !== "All" && !self.companies.includes(selectedCompany)) return;
            self.active_company = selectedCompany;
            self.locked_company = null;
            self.selected_map.clear();
            self.refresh_all();
        });

        // Company Select Change
        this.$body.on("change", "#picker-company-select", function () {
            const comp = $(this).val();
            if (self.active_company === comp) return;
            self.active_company = comp;
            self.locked_company = null;
            self.selected_map.clear();
            self.refresh_all();
        });

        // Unlock Button Click
        this.$body.on("click", "#picker-unlock-btn", function () {
            self.locked_company = null;
            self.selected_map.clear();
            self.update_company_lock_ui();
            self.render_table_rows();
            self.update_action_summary();
        });

        // KPI Card Click (Master Flow Navigation)
        this.$body.on("click", ".picker-kpi-card", function () {
            const stage = $(this).attr("data-stage");
            if (stage && self.active_stage !== stage) {
                self.switch_stage(stage);
            }
        });

        // View Mode Switcher (明细视图 vs 单号视图 for all stages)
        this.$body.on("click", ".picker-view-btn", function () {
            const mode = $(this).attr("data-mode");
            const stage = self.active_stage;
            if (mode && self.view_modes[stage] !== mode) {
                self.view_modes[stage] = mode;
                self.$body.find(".picker-view-btn").removeClass("active");
                $(this).addClass("active");
                self.selected_map.clear();
                self.locked_company = null;
                self.load_table_data();
            }
        });

        // Quick Create Material Request Button
        this.$body.on("click", "#picker-create-mr-btn", function () {
            self.open_create_mr_dialog();
        });

        // Toggle Sub-Bills (已付款下级核销账单展开/收起)
        this.$body.on("click", ".picker-btn-sub-invoices", function (e) {
            e.stopPropagation();
            const pe = $(this).attr("data-pe");
            const $subRow = self.$body.find(`#sub-row-${pe}`);
            if ($subRow.is(":visible")) {
                $subRow.hide();
                $(this).text($(this).text().replace("▴", "▾"));
            } else {
                $subRow.show();
                $(this).text($(this).text().replace("▾", "▴"));
            }
        });

        // Dual Scrollbar Sync
        const $top_scroll = this.$body.find("#picker-top-scrollbar");
        const $table_scroll = this.$body.find("#picker-main-table-scroll");
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

        // Mousewheel-to-Horizontal Scroll: 仅在表头 (thead) 与顶部辅助滚动条区域时将滚轮转换为横向滚动；内容行/明细行保持默认垂直上下移动
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

        this.$body.on("wheel", "#picker-table-thead, #picker-top-scrollbar", handle_wheel_to_horizontal);

        // 弹窗内的物料明细大宽表：仅在 thead 表头挂载滑轮横向滚动，表格内容区保持默认垂直上下移动
        $(document).on("wheel", ".picker-modal-item-table thead", function (e) {
            const raw_e = e.originalEvent || e;
            const delta_y = raw_e.deltaY;
            const delta_x = raw_e.deltaX;
            if (Math.abs(delta_y) > Math.abs(delta_x) && delta_y !== 0) {
                const $wrap = $(this).closest(".picker-modal-item-table-wrap");
                const el = $wrap[0];
                if (el && el.scrollWidth > el.clientWidth) {
                    el.scrollLeft += delta_y;
                    e.preventDefault();
                }
            }
        });

        // Row Checkbox Click
        this.$body.on("change", ".picker-row-checkbox", function () {
            const key = $(this).attr("data-key");
            const is_checked = $(this).is(":checked");
            const row = self.table_data.find((r) => self.get_row_key(r) === key);
            if (!row) return;

            if (is_checked) {
                // If in "All" mode and not locked yet, lock to this company
                if (self.active_company === "All" && !self.locked_company) {
                    self.locked_company = row.company;
                    self.update_company_lock_ui(true);
                }

                // If locked and row is from another company, ignore
                if (self.locked_company && row.company !== self.locked_company) {
                    $(this).prop("checked", false);
                    return;
                }

                const $tr = $(this).closest("tr");
                const input_qty = flt($tr.find(".picker-input-qty").val()) || row.pending_qty || row.qty || 1;
                row.this_qty = input_qty;
                self.selected_map.set(key, row);
                $tr.addClass("row-selected");
            } else {
                self.selected_map.delete(key);
                $(this).closest("tr").removeClass("row-selected");

                // If no rows selected, release lock
                if (self.selected_map.size === 0) {
                    self.locked_company = null;
                    self.update_company_lock_ui(false);
                }
            }

            self.update_table_visibility_by_lock();
            self.update_action_summary();
        });

        // Row Qty Input Change (Only in detail views for stages 2..4)
        this.$body.on("input change", ".picker-input-qty", function () {
            const $tr = $(this).closest("tr");
            const key = $tr.attr("data-key");
            const val = flt($(this).val());
            const row = self.table_data.find((r) => self.get_row_key(r) === key);
            if (row) {
                row.this_qty = val;
                if (self.selected_map.has(key)) {
                    self.selected_map.get(key).this_qty = val;
                }
            }
            self.update_row_amount_display($tr, row);
            self.update_action_summary();
        });

        // Select All / Clear Selection / Fill Max
        this.$body.on("change", "#picker-select-all-header", function () {
            const is_checked = $(this).prop("checked");
            if (is_checked) {
                self.select_all_visible();
            } else {
                self.clear_selection();
            }
        });
        this.$body.on("click", "#picker-select-all-btn", () => this.select_all_visible());
        this.$body.on("click", "#picker-clear-sel-btn", () => this.clear_selection());
        this.$body.on("click", "#picker-fill-max-btn", () => this.fill_max_quantities());
        this.$body.on("click", "#picker-batch-delete-btn", () => this.batch_delete_selected());
        this.$body.on("click", "#picker-cancel-mr-btn", () => this.batch_cancel_material_requests());
        this.$body.on("click", "#picker-delete-mr-btn", () => this.batch_delete_material_requests());

        // Primary Action Submit
        this.$body.on("click", "#picker-submit-btn", () => this.execute_primary_action());

        // Click on document link / badge to open Doc Detail Modal
        this.$body.on("click", ".picker-doc-clickable-link", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const dt = $(this).attr("data-doctype");
            const nm = $(this).attr("data-name");
            if (dt && nm) {
                self.show_doc_detail_modal(dt, nm);
            }
        });

        // A table row is the primary inspection target. Explicit controls keep
        // their own behavior, so selection and document links never open twice.
        this.$body.on("click", "#picker-table-tbody tr[data-doctype][data-name]", function (e) {
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

            if ($(e.target).closest("input, button, a, .picker-doc-clickable-link, .ashan-tag-badge").length) {
                return;
            }
            const dt = $(this).attr("data-doctype");
            const nm = $(this).attr("data-name");
            const key = $(this).attr("data-key");
            const stage = self.active_stage;
            const ms = (self.filters[stage] && self.filters[stage].match_status) || "pending";

            // 在待采购（mr_to_po 待办）视图中，点击行直接进入采购订单创建/订货弹窗，就地直接订货或保存草稿
            if (stage === "mr_to_po" && ms !== "all") {
                const row_data = self.table_data.find((item) => self.get_row_key(item) === key);
                if (row_data) {
                    const target_comp = self.locked_company || (self.active_company !== "All" ? self.active_company : row_data.company);
                    self.open_create_po_from_mr_dialog([row_data], target_comp);
                    return;
                }
            }

            if (dt && nm) {
                self.show_doc_detail_modal(dt, nm);
            }
        });
    }

    sync_route_params() {
        const route = frappe.get_route();
        if (route && route.length > 1) {
            const param = route[1];
            if (this.stages_config[param] && this.allowed_stages.includes(param)) {
                this.active_stage = param;
            }
        }
    }

    auto_adapt_default_match_status(target_stage) {
        const stages_to_check = target_stage ? [target_stage] : this.allowed_stages;
        stages_to_check.forEach((st) => {
            if (!this.filters[st]) return;
            if (st === "item_to_mr") {
                if (!this.filters[st]._user_selected_match_status) {
                    this.filters[st].match_status = "all";
                }
                return;
            }
            // 仅在用户未在当前会话中主动点击切换状态筛选时，根据待办数量自适应默认视图
            if (!this.filters[st]._user_selected_match_status) {
                const kpi = this.kpis[st];
                const count = (kpi && typeof kpi.count === "number") ? kpi.count : 0;
                this.filters[st].match_status = count > 0 ? "pending" : "all";
            }
        });
    }

    switch_stage(stage) {
        if (!this.allowed_stages.includes(stage)) {
            return;
        }
        this.active_stage = stage;
        this.locked_company = null;
        this.selected_map.clear();
        this.update_company_lock_ui();
        this.auto_adapt_default_match_status(stage);
        frappe.set_route(this.page_route, stage);
        this.render_kpis();
        this.render_section_banner();
        this.render_filter_bar();
        this.update_action_summary();
        this.load_table_data();
    }

    async refresh_all() {
        await this.load_kpis();
        this.render_kpis();
        this.render_section_banner();
        this.render_filter_bar();
        this.update_action_summary();
        await this.load_table_data();
    }

    async load_kpis() {
        try {
            const r = await frappe.call({
                method: "ashan_cn_procurement.services.procurement_picker_service.get_procurement_picker_overview_kpis",
                args: { company: this.active_company, workbench: this.profile.key },
            });
            if (r && r.message) {
                this.kpis = r.message.kpis || {};
                this.auto_adapt_default_match_status();
                if (window.AshanUI && window.AshanUI.refreshSidebarBadges) {
                    window.AshanUI.refreshSidebarBadges();
                }
            }
        } catch (e) {
            console.error("Failed to load KPIs", e);
        }
    }

    render_kpis() {
        const $container = this.$body.find("#picker-kpi-grid");
        $container.empty();

        const stage_keys = this.allowed_stages;
        stage_keys.forEach((key) => {
            const cfg = this.stages_config[key];
            const data = this.kpis[key] || { count: 0 };
            const is_active = this.active_stage === key;

            const num_text = data.count || 0;
            const sub_text = cfg.sub_label || "";
            const has_pending = num_text > 0;
            const badge_class = has_pending ? "has-pending" : "all-done";
            const badge_text = has_pending ? `${sub_text} ${num_text}` : "已清空";

            const html = `
                <div class="picker-tab-item picker-kpi-card ${is_active ? 'active' : ''}" data-stage="${key}">
                    <div class="picker-tab-left">
                        <span class="picker-tab-item-title picker-kpi-title">${cfg.name}</span>
                    </div>
                    <span class="picker-tab-badge ${badge_class}">${badge_text}</span>
                </div>
            `;
            $container.append(html);
        });
    }

    render_section_banner() {
        const $container = this.$body.find("#picker-section-banner");
        const cfg = this.stages_config[this.active_stage];
        const data = this.kpis[this.active_stage] || { count: 0 };
        const badge_prefix = this.active_stage === "item_to_mr" ? "草稿" : "待办";

        const html = `
            <div class="picker-section-main">
                <div class="picker-section-heading">
                    <div class="picker-section-title">
                        <span>${cfg.banner_title}</span>
                    </div>
                    <div class="picker-section-desc">${cfg.banner_desc}</div>
                </div>
            </div>
            <div class="picker-section-badge">
                ${badge_prefix}: ${data.count || 0} 笔
            </div>
        `;
        $container.html(html);
    }

    render_filter_bar() {
        const $bar = this.$body.find("#picker-filter-bar");
        $bar.empty();
        const stage = this.active_stage;

        let filters_html = "";
        if (stage === "item_to_mr") {
            const ms = this.filters[stage].match_status || "all";
            filters_html = `
                <div class="picker-filter-group">
                    <label>单据状态:</label>
                    <div class="picker-status-btn-group" data-filter="match_status">
                        <button type="button" class="picker-status-btn ${ms === 'all' ? 'active' : ''}" data-value="all">全部</button>
                        <button type="button" class="picker-status-btn ${ms === 'draft' ? 'active' : ''}" data-value="draft">草稿</button>
                        <button type="button" class="picker-status-btn ${ms === 'submitted' ? 'active' : ''}" data-value="submitted">正式</button>
                    </div>
                </div>
                <div class="picker-filter-group">
                    <label>申请单号:</label>
                    <input type="text" class="picker-filter-input" data-filter="mr_name" placeholder="搜索单号..." value="${this.filters[stage].mr_name || ''}">
                </div>
                <div class="picker-filter-group">
                    <label>物料搜索:</label>
                    <input type="text" class="picker-filter-input" data-filter="item_code" placeholder="输入编码或名称..." value="${this.filters[stage].item_code || ''}">
                </div>
            `;
        } else if (stage === "mr_to_po") {
            const ms = this.filters[stage].match_status || "pending";
            filters_html = `
                <div class="picker-filter-group">
                    <label>订购状态:</label>
                    <div class="picker-status-btn-group" data-filter="match_status">
                        <button type="button" class="picker-status-btn ${ms === 'pending' ? 'active' : ''}" data-value="pending">待采购</button>
                        <button type="button" class="picker-status-btn ${ms === 'all' ? 'active' : ''}" data-value="all">全部采购单</button>
                    </div>
                </div>
                <div class="picker-filter-group">
                    <label>关联订单号:</label>
                    <input type="text" class="picker-filter-input" data-filter="linked_doc" placeholder="搜索关联PO单号..." value="${this.filters[stage].linked_doc || ''}">
                </div>
                <div class="picker-filter-group">
                    <label>物料搜索:</label>
                    <input type="text" class="picker-filter-input" data-filter="item_code" placeholder="输入编码或名称..." value="${this.filters[stage].item_code || ''}">
                </div>
                <div class="picker-filter-group">
                    <label>建议供应商:</label>
                    <input type="text" class="picker-filter-input" data-filter="supplier" placeholder="供应商名称..." value="${this.filters[stage].supplier || ''}">
                </div>
                <div class="picker-filter-group">
                    <label>申请日期:</label>
                    <input type="date" class="picker-filter-input" data-filter="from_date" value="${this.filters[stage].from_date || ''}">
                    <span>至</span>
                    <input type="date" class="picker-filter-input" data-filter="to_date" value="${this.filters[stage].to_date || ''}">
                </div>
            `;
        } else if (stage === "po_to_pr") {
            const ms = this.filters[stage].match_status || "pending";
            filters_html = `
                <div class="picker-filter-group">
                    <label>入库状态:</label>
                    <div class="picker-status-btn-group" data-filter="match_status">
                        <button type="button" class="picker-status-btn ${ms === 'pending' ? 'active' : ''}" data-value="pending">待入库</button>
                        <button type="button" class="picker-status-btn ${ms === 'all' ? 'active' : ''}" data-value="all">全部入库单</button>
                    </div>
                </div>
                <div class="picker-filter-group">
                    <label>关联入库单:</label>
                    <input type="text" class="picker-filter-input" data-filter="linked_doc" placeholder="搜索关联PR单号..." value="${this.filters[stage].linked_doc || ''}">
                </div>
                <div class="picker-filter-group">
                    <label>供应商:</label>
                    <input type="text" class="picker-filter-input" data-filter="supplier" placeholder="搜索供应商..." value="${this.filters[stage].supplier || ''}">
                </div>
                <div class="picker-filter-group">
                    <label>采购订单号:</label>
                    <input type="text" class="picker-filter-input" data-filter="po_name" placeholder="PO-..." value="${this.filters[stage].po_name || ''}">
                </div>
                <div class="picker-filter-group">
                    <label>物料搜索:</label>
                    <input type="text" class="picker-filter-input" data-filter="item_code" placeholder="输入编码或名称..." value="${this.filters[stage].item_code || ''}">
                </div>
            `;
        } else if (stage === "pr_to_pi") {
            const ms = this.filters[stage].match_status || "pending";
            filters_html = `
                <div class="picker-filter-group">
                    <label>开票状态:</label>
                    <div class="picker-status-btn-group" data-filter="match_status">
                        <button type="button" class="picker-status-btn ${ms === 'pending' ? 'active' : ''}" data-value="pending">待开票</button>
                        <button type="button" class="picker-status-btn ${ms === 'all' ? 'active' : ''}" data-value="all">全部发票</button>
                    </div>
                </div>
                <div class="picker-filter-group">
                    <label>关联发票号:</label>
                    <input type="text" class="picker-filter-input" data-filter="linked_doc" placeholder="搜索关联PI发票号..." value="${this.filters[stage].linked_doc || ''}">
                </div>
                <div class="picker-filter-group">
                    <label>供应商:</label>
                    <input type="text" class="picker-filter-input" data-filter="supplier" placeholder="搜索供应商..." value="${this.filters[stage].supplier || ''}">
                </div>
                <div class="picker-filter-group">
                    <label>采购入库单号:</label>
                    <input type="text" class="picker-filter-input" data-filter="pr_name" placeholder="PR-..." value="${this.filters[stage].pr_name || ''}">
                </div>
                <div class="picker-filter-group">
                    <label>物料搜索:</label>
                    <input type="text" class="picker-filter-input" data-filter="item_code" placeholder="输入编码或名称..." value="${this.filters[stage].item_code || ''}">
                </div>
            `;
        } else if (stage === "pi_to_rr") {
            const ms = this.filters[stage].match_status || "pending";
            filters_html = `
                <div class="picker-filter-group">
                    <label>整算状态:</label>
                    <div class="picker-status-btn-group" data-filter="match_status">
                        <button type="button" class="picker-status-btn ${ms === 'pending' ? 'active' : ''}" data-value="pending">待整算</button>
                        <button type="button" class="picker-status-btn ${ms === 'all' ? 'active' : ''}" data-value="all">全部整算单</button>
                    </div>
                </div>
                <div class="picker-filter-group">
                    <label>关联整算单:</label>
                    <input type="text" class="picker-filter-input" data-filter="linked_doc" placeholder="搜索关联整算单号..." value="${this.filters[stage].linked_doc || ''}">
                </div>
                <div class="picker-filter-group">
                    <label>供应商:</label>
                    <input type="text" class="picker-filter-input" data-filter="supplier" placeholder="搜索供应商..." value="${this.filters[stage].supplier || ''}">
                </div>
                <div class="picker-filter-group">
                    <label>发票号码:</label>
                    <input type="text" class="picker-filter-input" data-filter="bill_no" placeholder="发票号码..." value="${this.filters[stage].bill_no || ''}">
                </div>
                <div class="picker-filter-group">
                    <label>经手人:</label>
                    <input type="text" class="picker-filter-input" data-filter="owner" placeholder="搜索经手人..." value="${this.filters[stage].owner || ''}">
                </div>
            `;
        } else if (stage === "pi_to_pay") {
            const ms = this.filters[stage].match_status || "pending";
            filters_html = `
                <div class="picker-filter-group">
                    <label>付款状态:</label>
                    <div class="picker-status-btn-group" data-filter="match_status">
                        <button type="button" class="picker-status-btn ${ms === 'pending' ? 'active' : ''}" data-value="pending">待付款</button>
                        <button type="button" class="picker-status-btn ${ms === 'all' ? 'active' : ''}" data-value="all">全部付款单</button>
                    </div>
                </div>
                <div class="picker-filter-group">
                    <label>供应商:</label>
                    <input type="text" class="picker-filter-input" data-filter="supplier" placeholder="搜索供应商..." value="${this.filters[stage].supplier || ''}">
                </div>
                <div class="picker-filter-group">
                    <label>发票号码:</label>
                    <input type="text" class="picker-filter-input" data-filter="bill_no" placeholder="发票号码..." value="${this.filters[stage].bill_no || ''}">
                </div>
                <div class="picker-filter-group">
                    <label>经手人:</label>
                    <input type="text" class="picker-filter-input" data-filter="owner" placeholder="搜索经手人..." value="${this.filters[stage].owner || ''}">
                </div>
            `;
        }

        $bar.html(filters_html);

        const self = this;
        $bar.find(".picker-filter-input").on("change input", function () {
            const key = $(this).attr("data-filter");
            self.filters[stage][key] = $(this).val();
            self.debounce_reload();
        });

        $bar.find(".picker-status-btn").on("click", function (e) {
            e.preventDefault();
            const $group = $(this).closest(".picker-status-btn-group");
            const key = $group.attr("data-filter") || "match_status";
            const val = $(this).attr("data-value");
            $group.find(".picker-status-btn").removeClass("active");
            $(this).addClass("active");
            self.filters[stage][key] = val;
            if (key === "match_status") {
                self.filters[stage]._user_selected_match_status = true;
            }
            self.debounce_reload();
        });
    }

    debounce_reload() {
        clearTimeout(this._debounce_timer);
        this._debounce_timer = setTimeout(() => {
            this.load_table_data();
        }, 300);
    }

    async load_table_data() {
        const stage = this.active_stage;
        const mode = this.view_modes[stage] || "detail";
        const request_id = (this._table_request_id || 0) + 1;
        this._table_request_id = request_id;
        let method = "";

        if (stage === "item_to_mr") {
            method = mode === "doc"
                ? "ashan_cn_procurement.services.procurement_picker_service.get_material_request_doc_rows"
                : "ashan_cn_procurement.services.procurement_picker_service.get_material_request_picker_rows";
        } else if (stage === "mr_to_po") {
            method = mode === "doc"
                ? "ashan_cn_procurement.services.procurement_picker_service.get_pending_material_request_docs"
                : "ashan_cn_procurement.services.procurement_picker_service.get_pending_material_request_items";
        } else if (stage === "po_to_pr") {
            method = mode === "doc"
                ? "ashan_cn_procurement.services.procurement_picker_service.get_pending_purchase_order_docs"
                : "ashan_cn_procurement.services.procurement_picker_service.get_pending_purchase_order_items";
        } else if (stage === "pr_to_pi") {
            method = mode === "doc"
                ? "ashan_cn_procurement.services.procurement_picker_service.get_pending_purchase_receipt_docs"
                : "ashan_cn_procurement.services.procurement_picker_service.get_pending_purchase_receipt_items";
        } else if (stage === "pi_to_rr") {
            method = mode === "detail"
                ? "ashan_cn_procurement.services.procurement_picker_service.get_pending_reimbursement_invoice_items"
                : "ashan_cn_procurement.services.procurement_picker_service.get_pending_reimbursement_invoices";
        } else if (stage === "pi_to_pay") {
            method = mode === "doc"
                ? "ashan_cn_procurement.services.procurement_picker_service.get_pending_payment_docs"
                : "ashan_cn_procurement.services.procurement_picker_service.get_pending_payment_invoices";
        }

        try {
            const r = await frappe.call({
                method: method,
                args: {
                    company: this.active_company,
                    filters: this.filters[stage],
                },
            });
            if (request_id !== this._table_request_id) return;
            if (r && r.message) {
                this.table_data = r.message.rows || [];
                this.selected_map.clear();
                this.locked_company = null;
                this.update_company_lock_ui();
                this.render_table();
                this.update_action_summary();
            }
        } catch (e) {
            console.error("Failed to load picker rows", e);
        }
    }

    get_row_key(row) {
        const stage = this.active_stage;
        const mode = this.view_modes[stage] || "detail";
        const ms = (this.filters[stage] && this.filters[stage].match_status) || "pending";

        if (stage === "item_to_mr") {
            return mode === "doc" ? (row.mr_name || row.name) : (row.mri_name || row.name);
        }
        if (stage === "mr_to_po") {
            if (ms === "all") return mode === "doc" ? (row.po_name || row.name) : (row.poi_name || row.name);
            return mode === "doc" ? (row.mr_name || row.name) : (row.mri_name || row.name);
        }
        if (stage === "po_to_pr") {
            if (ms === "all") return mode === "doc" ? (row.pr_name || row.name) : (row.pri_name || row.name);
            return mode === "doc" ? (row.po_name || row.name) : (row.poi_name || row.name);
        }
        if (stage === "pr_to_pi") {
            if (ms === "all") return mode === "doc" ? (row.pi_name || row.name) : (row.pii_name || row.name);
            return mode === "doc" ? (row.pr_name || row.name) : (row.pri_name || row.name);
        }
        if (stage === "pi_to_rr") {
            if (ms === "all") return mode === "doc" ? (row.rr_name || row.name) : (row.rii_name || row.name);
            return mode === "detail" ? (row.pii_name || row.name) : (row.pi_name || row.name);
        }
        if (stage === "pi_to_pay") {
            if (ms === "all" || ms === "completed") return mode === "doc" ? (row.pe_name || row.name) : (row.per_name || row.name);
            return (mode === "doc" && row.pe_name) ? row.pe_name : (row.pi_name || row.name);
        }
        return row.name || String(Math.random());
    }

    render_table() {
        this.render_table_header();
        this.render_table_rows();
        this.render_table_footer();
        this.sync_scroll_widths();
    }

    render_table_header() {
        const stage = this.active_stage;
        const mode = this.view_modes[stage] || "detail";
        const can_process = this.can_process_active_stage();
        const ms = (this.filters[stage] && this.filters[stage].match_status) || "pending";

        let ths = `
            <th class="picker-col-sticky-1">#</th>
            <th class="picker-col-sticky-2 picker-col-checkbox-th">
                <input type="checkbox" id="picker-select-all-header" class="picker-header-checkbox" title="全选或取消全选当前页" ${can_process ? "" : "disabled"}>
            </th>
        `;

        if (this.active_company === "All") {
            ths += `<th class="picker-col-sticky-3">所属公司</th>`;
        }

        if (stage === "item_to_mr") {
            if (mode === "doc") {
                ths += `
                    <th class="picker-col-docname">申请单号</th>
                    <th class="picker-col-date">申请日期</th>
                    <th class="picker-col-dept">需求部门</th>
                    <th class="picker-col-doc-details">单据明细</th>
                    <th class="picker-col-item-count">物料项数</th>
                    <th class="picker-col-qty-val">申请总数</th>
                    <th class="picker-col-status">单据状态</th>
                    <th class="picker-col-user">制单人</th>
                `;
            } else {
                ths += `
                    <th class="picker-col-docname">申请单号</th>
                    <th class="picker-col-item-code">物料编码</th>
                    <th class="picker-col-name">物料名称</th>
                    <th class="picker-col-spec">规格</th>
                    <th class="picker-col-uom">单位</th>
                    <th class="picker-col-qty-val">申请数量</th>
                    <th class="picker-col-rate">参考单价</th>
                    <th class="picker-col-money">预估金额</th>
                    <th class="picker-col-remarks">备注</th>
                `;
            }
        } else if (stage === "mr_to_po") {
            if (ms === "all") {
                if (mode === "doc") {
                    ths += `
                        <th class="picker-col-docname">采购订单号</th>
                        <th class="picker-col-supplier">供应商</th>
                        <th class="picker-col-date">订单日期</th>
                        <th class="picker-col-date">期望到货日</th>
                        <th class="picker-col-doc-details">单据明细</th>
                        <th class="picker-col-item-count">采购项数</th>
                        <th class="picker-col-qty-val">采购总数</th>
                        <th class="picker-col-money">订单总额</th>
                        <th class="picker-col-status">单据状态</th>
                        <th class="picker-col-linked-doc">关联入库单</th>
                        <th class="picker-col-user">制单人</th>
                    `;
                } else {
                    ths += `
                        <th class="picker-col-docname">采购订单号</th>
                        <th class="picker-col-supplier">供应商</th>
                        <th class="picker-col-date">订单日期</th>
                        <th class="picker-col-item-code">物料代码</th>
                        <th class="picker-col-name">物料名称</th>
                        <th class="picker-col-spec">规格</th>
                        <th class="picker-col-uom">单位</th>
                        <th class="picker-col-qty-val">订购数量</th>
                        <th class="picker-col-qty-val">已收数量</th>
                        <th class="picker-col-rate">单价</th>
                        <th class="picker-col-money">金额</th>
                        <th class="picker-col-warehouse">收货仓库</th>
                        <th class="picker-col-remarks">备注</th>
                        <th class="picker-col-status">单据状态</th>
                        <th class="picker-col-linked-doc">关联入库单</th>
                    `;
                }
            } else {
                if (mode === "doc") {
                    ths += `
                        <th class="picker-col-docname">采购申请单号</th>
                        <th class="picker-col-date">采购申请日期</th>
                        <th class="picker-col-doc-details">单据明细</th>
                        <th class="picker-col-dept">所属部门</th>
                        <th class="picker-col-item-count">待订项数</th>
                        <th class="picker-col-qty-val">待订总数</th>
                        <th class="picker-col-money">预估金额</th>
                        <th class="picker-col-supplier">建议供应商</th>
                        <th class="picker-col-linked-doc">关联采购订单</th>
                        <th class="picker-col-user">制单人</th>
                    `;
                } else {
                    ths += `
                        <th class="picker-col-docname">采购申请单号</th>
                        <th class="picker-col-date">采购申请日期</th>
                        <th class="picker-col-item-code">物料代码</th>
                        <th class="picker-col-name">物料名称</th>
                        <th class="picker-col-spec">规格</th>
                        <th class="picker-col-uom">单位</th>
                        <th class="picker-col-qty-val">申请总数</th>
                        <th class="picker-col-qty-val">已订数</th>
                        <th class="picker-col-qty-val">未订数量</th>
                        <th class="picker-col-rate">参考单价</th>
                        <th class="picker-col-money">金额</th>
                        <th class="picker-col-money">税额</th>
                        <th class="picker-col-money">含税总价</th>
                        <th class="picker-col-remarks">备注</th>
                        <th class="picker-col-supplier">建议供应商</th>
                        <th class="picker-col-linked-doc">关联采购订单</th>
                    `;
                }
            }
        } else if (stage === "po_to_pr") {
            if (ms === "all") {
                if (mode === "doc") {
                    ths += `
                        <th class="picker-col-docname">采购入库单号</th>
                        <th class="picker-col-supplier">供应商</th>
                        <th class="picker-col-date">过账日期</th>
                        <th class="picker-col-warehouse">收货仓库</th>
                        <th class="picker-col-doc-details">单据明细</th>
                        <th class="picker-col-item-count">入库项数</th>
                        <th class="picker-col-qty-val">实收总数</th>
                        <th class="picker-col-money">入库总额</th>
                        <th class="picker-col-status">单据状态</th>
                        <th class="picker-col-linked-doc">关联采购订单</th>
                        <th class="picker-col-linked-doc">关联发票</th>
                        <th class="picker-col-user">制单人</th>
                    `;
                } else {
                    ths += `
                        <th class="picker-col-docname">采购入库单号</th>
                        <th class="picker-col-supplier">供应商</th>
                        <th class="picker-col-date">过账日期</th>
                        <th class="picker-col-item-code">物料代码</th>
                        <th class="picker-col-name">物料名称</th>
                        <th class="picker-col-spec">规格</th>
                        <th class="picker-col-uom">单位</th>
                        <th class="picker-col-qty-val">实收数量</th>
                        <th class="picker-col-qty-val">已开票数</th>
                        <th class="picker-col-rate">单价</th>
                        <th class="picker-col-money">金额</th>
                        <th class="picker-col-warehouse">收货仓库</th>
                        <th class="picker-col-linked-doc">关联采购订单</th>
                        <th class="picker-col-remarks">备注</th>
                        <th class="picker-col-status">单据状态</th>
                        <th class="picker-col-linked-doc">关联发票</th>
                    `;
                }
            } else {
                if (mode === "doc") {
                    ths += `
                        <th class="picker-col-supplier">供应商</th>
                        <th class="picker-col-docname">采购订单号</th>
                        <th class="picker-col-date">订单日期</th>
                        <th class="picker-col-warehouse">收货仓库</th>
                        <th class="picker-col-doc-details">单据明细</th>
                        <th class="picker-col-item-count">待收项数</th>
                        <th class="picker-col-qty-val">待收总数</th>
                        <th class="picker-col-money">待收金额</th>
                        <th class="picker-col-money">订单总额</th>
                        <th class="picker-col-linked-doc">关联入库单</th>
                    `;
                } else {
                    ths += `
                        <th class="picker-col-supplier">供应商</th>
                        <th class="picker-col-docname">采购订单号</th>
                        <th class="picker-col-date">订单日期</th>
                        <th class="picker-col-name">物料名称</th>
                        <th class="picker-col-spec">规格</th>
                        <th class="picker-col-warehouse">收货仓库</th>
                        <th class="picker-col-qty-val">订购总数</th>
                        <th class="picker-col-qty-val">已收数</th>
                        <th class="picker-col-qty-val">未收数量</th>
                        <th class="picker-col-rate">采购单价</th>
                        <th class="picker-col-money">待收金额</th>
                        <th class="picker-col-remarks">备注</th>
                        <th class="picker-col-linked-doc">关联入库单</th>
                    `;
                }
            }
        } else if (stage === "pr_to_pi") {
            if (ms === "all") {
                if (mode === "doc") {
                    ths += `
                        <th class="picker-col-docname">采购发票号</th>
                        <th class="picker-col-docname">发票号码</th>
                        <th class="picker-col-status">票据类型</th>
                        <th class="picker-col-supplier">供应商</th>
                        <th class="picker-col-date">开票/过账日期</th>
                        <th class="picker-col-doc-details">单据明细</th>
                        <th class="picker-col-money">发票总额</th>
                        <th class="picker-col-money">已付金额</th>
                        <th class="picker-col-money">待付余额</th>
                        <th class="picker-col-status">付款状态</th>
                        <th class="picker-col-status">单据状态</th>
                        <th class="picker-col-linked-doc">关联入库单</th>
                        <th class="picker-col-linked-doc">关联付款单</th>
                        <th class="picker-col-user">经手人</th>
                    `;
                } else {
                    ths += `
                        <th class="picker-col-docname">采购发票号</th>
                        <th class="picker-col-docname">发票号码</th>
                        <th class="picker-col-supplier">供应商</th>
                        <th class="picker-col-date">开票/过账日期</th>
                        <th class="picker-col-item-code">物料代码</th>
                        <th class="picker-col-name">物料名称</th>
                        <th class="picker-col-spec">规格</th>
                        <th class="picker-col-uom">单位</th>
                        <th class="picker-col-qty-val">开票数量</th>
                        <th class="picker-col-rate">单价</th>
                        <th class="picker-col-money">金额</th>
                        <th class="picker-col-money">税额</th>
                        <th class="picker-col-money">价税合计</th>
                        <th class="picker-col-money">待付余额</th>
                        <th class="picker-col-status">付款状态</th>
                        <th class="picker-col-linked-doc">关联入库单</th>
                    `;
                }
            } else {
                if (mode === "doc") {
                    ths += `
                        <th class="picker-col-supplier">供应商</th>
                        <th class="picker-col-docname">采购入库单号</th>
                        <th class="picker-col-date">过账日期</th>
                        <th class="picker-col-doc-details">单据明细</th>
                        <th class="picker-col-item-count">未结项数</th>
                        <th class="picker-col-qty-val">待开票总数</th>
                        <th class="picker-col-money">待开票金额</th>
                        <th class="picker-col-money">入库单总额</th>
                        <th class="picker-col-linked-doc">关联订单</th>
                        <th class="picker-col-linked-doc">关联采购发票</th>
                    `;
                } else {
                    ths += `
                        <th class="picker-col-supplier">供应商</th>
                        <th class="picker-col-docname">采购入库单号</th>
                        <th class="picker-col-date">过账日期</th>
                        <th class="picker-col-name">物料名称</th>
                        <th class="picker-col-spec">规格</th>
                        <th class="picker-col-uom">单位</th>
                        <th class="picker-col-qty-val">实收总数</th>
                        <th class="picker-col-qty-val">已开票数</th>
                        <th class="picker-col-qty-val">未结数量</th>
                        <th class="picker-col-rate">入库单价</th>
                        <th class="picker-col-money">待开票金额</th>
                        <th class="picker-col-remarks">备注</th>
                        <th class="picker-col-linked-doc">关联订单</th>
                        <th class="picker-col-linked-doc">关联采购发票</th>
                    `;
                }
            }
        } else if (stage === "pi_to_rr") {
            if (ms === "all") {
                if (mode === "doc") {
                    ths += `
                        <th class="picker-col-docname">整算单号</th>
                        <th class="picker-col-date">申请日期</th>
                        <th class="picker-col-user">经手/申请人</th>
                        <th class="picker-col-remarks">结算事由</th>
                        <th class="picker-col-item-count">发票张数</th>
                        <th class="picker-col-money">整算总额</th>
                        <th class="picker-col-status">单据状态</th>
                        <th class="picker-col-user">制单人</th>
                    `;
                } else {
                    ths += `
                        <th class="picker-col-docname">整算单号</th>
                        <th class="picker-col-user">经手/申请人</th>
                        <th class="picker-col-date">申请日期</th>
                        <th class="picker-col-docname">关联采购发票号</th>
                        <th class="picker-col-docname">发票号码</th>
                        <th class="picker-col-supplier">供应商</th>
                        <th class="picker-col-date">开票日期</th>
                        <th class="picker-col-money">发票总额</th>
                        <th class="picker-col-money">本次整算金额</th>
                        <th class="picker-col-status">单据状态</th>
                    `;
                }
            } else {
                if (mode === "doc") {
                    ths += `
                        <th class="picker-col-docname">采购发票号</th>
                        <th class="picker-col-supplier">供应商</th>
                        <th class="picker-col-docname">发票号码</th>
                        <th class="picker-col-status">票据类型</th>
                        <th class="picker-col-doc-details">单据明细</th>
                        <th class="picker-col-date">开票日期</th>
                        <th class="picker-col-user">录单人</th>
                        <th class="picker-col-money">发票总额</th>
                        <th class="picker-col-money">已付金额</th>
                        <th class="picker-col-money">待整算余额</th>
                        <th class="picker-col-linked-doc">关联整算单</th>
                    `;
                } else {
                    ths += `
                        <th class="picker-col-docname">采购发票号</th>
                        <th class="picker-col-supplier">供应商</th>
                        <th class="picker-col-docname">发票号码</th>
                        <th class="picker-col-name">物料名称</th>
                        <th class="picker-col-spec">规格</th>
                        <th class="picker-col-uom">单位</th>
                        <th class="picker-col-qty-val">开票数量</th>
                        <th class="picker-col-rate">单价</th>
                        <th class="picker-col-money">明细金额</th>
                        <th class="picker-col-date">开票日期</th>
                        <th class="picker-col-money">待整算余额</th>
                        <th class="picker-col-remarks">备注</th>
                        <th class="picker-col-linked-doc">关联整算单</th>
                    `;
                }
            }
        } else if (stage === "pi_to_pay") {
            if (ms === "all" || ms === "completed") {
                if (mode === "doc") {
                    ths += `
                        <th class="picker-col-docname">付款单号</th>
                        <th class="picker-col-supplier">收款供应商</th>
                        <th class="picker-col-date">付款日期</th>
                        <th class="picker-col-money">实付金额</th>
                        <th class="picker-col-warehouse">付款银行账户</th>
                        <th class="picker-col-status">结算方式</th>
                        <th class="picker-col-doc-details">下级核销账单 (发票明细)</th>
                        <th class="picker-col-user">经手人</th>
                    `;
                } else {
                    ths += `
                        <th class="picker-col-docname">付款单号</th>
                        <th class="picker-col-supplier">收款供应商</th>
                        <th class="picker-col-date">付款日期</th>
                        <th class="picker-col-warehouse">付款银行账户</th>
                        <th class="picker-col-docname">核销采购发票号</th>
                        <th class="picker-col-money">发票总额</th>
                        <th class="picker-col-money">本次核销金额</th>
                        <th class="picker-col-money">未付余额</th>
                        <th class="picker-col-status">单据状态</th>
                    `;
                }
            } else {
                if (mode === "doc") {
                    ths += `
                        <th class="picker-col-docname">采购发票号</th>
                        <th class="picker-col-docname">发票号码</th>
                        <th class="picker-col-date">开票日期</th>
                        <th class="picker-col-supplier">供应商</th>
                        <th class="picker-col-money">发票总额</th>
                        <th class="picker-col-money">已付金额</th>
                        <th class="picker-col-money">待付余额</th>
                        <th class="picker-col-money">本次付款金额</th>
                        <th class="picker-col-status">付款状态</th>
                        <th class="picker-col-linked-doc">关联付款单</th>
                    `;
                } else {
                    ths += `
                        <th class="picker-col-docname">采购发票号</th>
                        <th class="picker-col-docname">发票号码</th>
                        <th class="picker-col-date">开票日期</th>
                        <th class="picker-col-supplier">供应商</th>
                        <th class="picker-col-warehouse">开户行及账号</th>
                        <th class="picker-col-money">发票总额</th>
                        <th class="picker-col-money">已付金额</th>
                        <th class="picker-col-money">本次付款金额</th>
                        <th class="picker-col-money">待付余额</th>
                        <th class="picker-col-status">付款状态</th>
                        <th class="picker-col-linked-doc">关联付款单</th>
                        <th class="picker-col-user">经手人</th>
                    `;
                }
            }
        }

        this.$body.find("#picker-table-thead").html(`<tr>${ths}</tr>`);
    }

    render_table_rows() {
        const $tbody = this.$body.find("#picker-table-tbody");
        $tbody.empty();

        if (!this.table_data || this.table_data.length === 0) {
            const col_span = this.$body.find("#picker-table-thead th").length || 1;
            $tbody.html(`
                <tr>
                    <td colspan="${col_span}">
                        <div class="picker-empty-state">
                            <div class="picker-empty-icon">无记录</div>
                            <div>当前没有符合条件的记录</div>
                        </div>
                    </td>
                </tr>
            `);
            return;
        }

        const stage = this.active_stage;
        const mode = this.view_modes[stage] || "detail";
        const is_all_company = this.active_company === "All";
        const can_process = this.can_process_active_stage();
        const ms = (this.filters[stage] && this.filters[stage].match_status) || "pending";

        const slug_map = {
            "material-request": "Material Request",
            "purchase-order": "Purchase Order",
            "purchase-receipt": "Purchase Receipt",
            "purchase-invoice": "Purchase Invoice",
            "reimbursement-request": "Reimbursement Request",
            "payment-entry": "Payment Entry",
        };

        const render_linked_badges = (names_str, slug) => {
            if (!names_str || !names_str.trim()) {
                return `<span class="picker-no-link">-</span>`;
            }
            const dt = slug_map[slug] || "Purchase Order";
            const names = names_str.split(/[、,]/).map(s => s.trim()).filter(Boolean);
            if (!names.length) return `<span class="picker-no-link">-</span>`;
            return names.map(n => `<span class="picker-linked-badge picker-doc-clickable-link" data-doctype="${dt}" data-name="${frappe.utils.escape_html(n)}" title="点击弹窗查看单据详情与操作">${frappe.utils.escape_html(n)}</span>`).join(" ");
        };

        this.table_data.forEach((r, idx) => {
            const key = this.get_row_key(r);
            const is_selected = this.selected_map.has(key);
            const is_hidden_by_lock = this.locked_company && r.company !== this.locked_company;

            let is_completed = false;
            if (stage === "mr_to_po" || stage === "po_to_pr" || stage === "pr_to_pi") {
                is_completed = flt(r.pending_qty) <= 0.0001;
            } else if (stage === "pi_to_rr") {
                is_completed = flt(r.net_available_amount) <= 0.0001;
            } else if (stage === "pi_to_pay") {
                is_completed = flt(r.outstanding_amount) <= 0.0001;
            }

            const checkbox_attr = is_completed || !can_process
                ? `disabled title="该单据及明细已全部处理完成"`
                : `${is_selected ? 'checked' : ''}`;

            const primary_doc = {
                item_to_mr: { doctype: "Material Request", name: r.mr_name },
                mr_to_po: { doctype: "Material Request", name: r.mr_name },
                po_to_pr: { doctype: "Purchase Order", name: r.po_name },
                pr_to_pi: { doctype: "Purchase Receipt", name: r.pr_name },
                pi_to_rr: { doctype: "Purchase Invoice", name: r.pi_name },
                pi_to_pay: { doctype: (mode === "doc" && r.pe_name) ? "Payment Entry" : "Purchase Invoice", name: r.pe_name || r.pi_name },
            }[stage] || {};
            const primary_doc_attrs = primary_doc.name
                ? `data-doctype="${primary_doc.doctype}" data-name="${frappe.utils.escape_html(primary_doc.name)}"`
                : "";
            
            const is_draft_row = r.docstatus === 0 || r.status === "Draft";

            let tr_html = `
                <tr class="ashan-row-clickable ${is_selected ? 'row-selected' : ''} ${is_completed ? 'picker-row-completed' : ''} ${is_draft_row ? 'ashan-row-draft' : ''} ${is_hidden_by_lock ? 'picker-row-company-hidden' : ''}" data-key="${key}" data-company="${frappe.utils.escape_html(r.company || '')}" ${primary_doc_attrs}>
                    <td class="picker-col-sticky-1">${idx + 1}</td>
                    <td class="picker-col-sticky-2">
                        <input type="checkbox" class="picker-row-checkbox" data-key="${key}" ${checkbox_attr}>
                    </td>
            `;

            if (is_all_company) {
                const comp_short = (r.company || "").includes("祺富") ? "祺富" : ((r.company || "").includes("吉众") ? "吉众" : (r.company || ""));
                const comp_cls = (r.company || "").includes("祺富") ? "picker-company-badge-qifu" : "picker-company-badge-jizhong";
                tr_html += `
                    <td class="picker-col-sticky-3">
                        <span class="picker-company-badge ${comp_cls}">${frappe.utils.escape_html(comp_short)}</span>
                    </td>
                `;
            }

            const doc_badges = (val) => {
                if (window.ashan && window.ashan.doc_details && typeof window.ashan.doc_details.render_badges === "function") {
                    return window.ashan.doc_details.render_badges(val || "");
                }
                return frappe.utils.escape_html(val || "-");
            };

            if (stage === "item_to_mr") {
                if (mode === "doc") {
                    tr_html += `
                        <td class="picker-col-docname"><span class="picker-linked-badge picker-doc-clickable-link" data-doctype="Material Request" data-name="${r.mr_name}" title="点击弹窗查看单据详情与操作">${frappe.utils.escape_html(r.mr_name)}</span></td>
                        <td class="picker-col-date">${r.transaction_date || "-"}</td>
                        <td class="picker-col-dept">${frappe.utils.escape_html(r.department || "-")}</td>
                        <td class="picker-col-doc-details">${doc_badges(r.custom_doc_details)}</td>
                        <td class="picker-col-item-count picker-qty-cell">${r.item_count || 0}</td>
                        <td class="picker-col-qty-val picker-qty-cell"><strong>${flt(r.total_qty).toFixed(2)}</strong></td>
                        <td class="picker-col-status">${this.format_doc_status("Material Request", r.status, r.docstatus, r)}</td>
                        <td class="picker-col-user">${frappe.utils.escape_html(r.owner || "-")}</td>
                    `;
                } else {
                    const status_badge = (r.docstatus === 0 || r.status === "Draft")
                        ? `<span class="ashan-status-badge ashan-status-amber" style="margin-left:6px; font-size:11px; padding:1px 6px;">草稿</span>`
                        : `<span class="ashan-status-badge ashan-status-green" style="margin-left:6px; font-size:11px; padding:1px 6px;">正式</span>`;
                    tr_html += `
                        <td class="picker-col-docname">
                            <span class="picker-linked-badge picker-doc-clickable-link" data-doctype="Material Request" data-name="${r.mr_name}" title="点击弹窗查看单据详情与操作">${frappe.utils.escape_html(r.mr_name)}</span>
                            ${status_badge}
                        </td>
                        <td class="picker-col-item-code"><strong>${frappe.utils.escape_html(r.item_code)}</strong></td>
                        <td class="picker-col-name">${frappe.utils.escape_html(r.item_name || r.item_code)}</td>
                        <td class="picker-col-spec">${frappe.utils.escape_html(r.spec || "")}</td>
                        <td class="picker-col-uom">${frappe.utils.escape_html(r.uom || "")}</td>
                        <td class="picker-col-qty-val picker-qty-cell"><strong>${r.qty}</strong></td>
                        <td class="picker-col-rate picker-money-cell">${this.fmt_money(r.rate)}</td>
                        <td class="picker-col-money picker-money-cell">${this.fmt_money(r.amount)}</td>
                        <td class="picker-col-remarks">${frappe.utils.escape_html(r.remarks || "")}</td>
                    `;
                }
            } else if (stage === "mr_to_po") {
                if (ms === "all") {
                    if (mode === "doc") {
                        const status_badge = this.format_doc_status("Purchase Order", r.status, r.docstatus, r);
                        tr_html += `
                            <td class="picker-col-docname"><span class="picker-source-docname picker-doc-clickable-link" data-doctype="Purchase Order" data-name="${r.po_name}" title="点击查看采购订单详情">${frappe.utils.escape_html(r.po_name)}</span></td>
                            <td class="picker-col-supplier"><strong>${frappe.utils.escape_html(r.supplier || "-")}</strong></td>
                            <td class="picker-col-date">${r.transaction_date || "-"}</td>
                            <td class="picker-col-date">${r.schedule_date || "-"}</td>
                            <td class="picker-col-doc-details">${doc_badges(r.custom_doc_details)}</td>
                            <td class="picker-col-item-count picker-qty-cell">${r.items_count || 0}</td>
                            <td class="picker-col-qty-val picker-qty-cell"><strong>${flt(r.total_qty).toFixed(2)}</strong></td>
                            <td class="picker-col-money picker-money-cell cell-row-amt"><strong>${this.fmt_money(r.grand_total)}</strong></td>
                            <td class="picker-col-status">${status_badge}</td>
                            <td class="picker-col-linked-doc">${render_linked_badges(r.linked_pr_names, "purchase-receipt")}</td>
                            <td class="picker-col-user">${frappe.utils.escape_html(r.owner || "-")}</td>
                        `;
                    } else {
                        const status_badge = this.format_doc_status("Purchase Order", r.status, r.docstatus, r);
                        tr_html += `
                            <td class="picker-col-docname"><span class="picker-source-docname picker-doc-clickable-link" data-doctype="Purchase Order" data-name="${r.po_name}" title="点击查看采购订单详情">${frappe.utils.escape_html(r.po_name)}</span></td>
                            <td class="picker-col-supplier"><strong>${frappe.utils.escape_html(r.supplier || "-")}</strong></td>
                            <td class="picker-col-date">${r.transaction_date || "-"}</td>
                            <td class="picker-col-item-code"><strong>${frappe.utils.escape_html(r.item_code)}</strong></td>
                            <td class="picker-col-name">${frappe.utils.escape_html(r.item_name || "")}</td>
                            <td class="picker-col-spec">${frappe.utils.escape_html(r.spec || "")}</td>
                            <td class="picker-col-uom">${frappe.utils.escape_html(r.uom || "")}</td>
                            <td class="picker-col-qty-val picker-qty-cell"><strong>${r.qty}</strong></td>
                            <td class="picker-col-qty-val picker-qty-cell">${r.received_qty}</td>
                            <td class="picker-col-rate picker-money-cell">${this.fmt_money(r.rate)}</td>
                            <td class="picker-col-money picker-money-cell cell-row-amt"><strong>${this.fmt_money(r.amount)}</strong></td>
                            <td class="picker-col-warehouse">${frappe.utils.escape_html(r.warehouse || "-")}</td>
                            <td class="picker-col-remarks">${frappe.utils.escape_html(r.remarks || "")}</td>
                            <td class="picker-col-status">${status_badge}</td>
                            <td class="picker-col-linked-doc">${render_linked_badges(r.linked_pr_names, "purchase-receipt")}</td>
                        `;
                    }
                } else {
                    if (mode === "doc") {
                        tr_html += `
                            <td class="picker-col-docname"><span class="picker-source-docname picker-doc-clickable-link" data-doctype="Material Request" data-name="${r.mr_name}" title="点击查看详情与操作">${frappe.utils.escape_html(r.mr_name)}</span></td>
                            <td class="picker-col-date">${r.transaction_date || "-"}</td>
                            <td class="picker-col-doc-details">${doc_badges(r.custom_doc_details)}</td>
                            <td class="picker-col-dept">${frappe.utils.escape_html(r.department || "-")}</td>
                            <td class="picker-col-item-count picker-qty-cell">${r.pending_item_count || r.item_count || 0}</td>
                            <td class="picker-col-qty-val picker-qty-cell"><strong>${flt(r.pending_qty || r.total_qty).toFixed(2)}</strong></td>
                            <td class="picker-col-money picker-money-cell cell-row-amt"><strong>${this.fmt_money(r.estimated_amount)}</strong></td>
                            <td class="picker-col-supplier">${frappe.utils.escape_html(r.supplier || "-")}</td>
                            <td class="picker-col-linked-doc">${render_linked_badges(r.linked_po_names, "purchase-order")}</td>
                            <td class="picker-col-user">${frappe.utils.escape_html(r.owner || "-")}</td>
                        `;
                    } else {
                        tr_html += `
                            <td class="picker-col-docname"><span class="picker-source-docname picker-doc-clickable-link" data-doctype="Material Request" data-name="${r.mr_name}" title="点击查看详情与操作">${frappe.utils.escape_html(r.mr_name)}</span></td>
                            <td class="picker-col-date">${r.transaction_date || "-"}</td>
                            <td class="picker-col-item-code"><strong>${frappe.utils.escape_html(r.item_code)}</strong></td>
                            <td class="picker-col-name">${frappe.utils.escape_html(r.item_name || "")}</td>
                            <td class="picker-col-spec">${frappe.utils.escape_html(r.spec || "")}</td>
                            <td class="picker-col-uom">${frappe.utils.escape_html(r.uom || "")}</td>
                            <td class="picker-col-qty-val picker-qty-cell">${flt(r.qty).toFixed(2)}</td>
                            <td class="picker-col-qty-val picker-qty-cell">${flt(r.ordered_qty).toFixed(2)}</td>
                            <td class="picker-col-qty-val picker-qty-cell"><strong class="picker-pending-qty">${flt(r.pending_qty).toFixed(2)}</strong></td>
                            <td class="picker-col-rate picker-money-cell">${this.fmt_money(r.rate)}</td>
                            <td class="picker-col-money picker-money-cell"><strong>${this.fmt_money(r.amount)}</strong></td>
                            <td class="picker-col-money picker-money-cell">${this.fmt_money(r.tax_amount)}</td>
                            <td class="picker-col-money picker-money-cell cell-row-amt"><strong>${this.fmt_money(r.total_amount)}</strong></td>
                            <td class="picker-col-remarks">${frappe.utils.escape_html(r.remarks || "")}</td>
                            <td class="picker-col-supplier">${frappe.utils.escape_html(r.supplier || "-")}</td>
                            <td class="picker-col-linked-doc">${render_linked_badges(r.linked_po_names, "purchase-order")}</td>
                        `;
                    }
                }
            } else if (stage === "po_to_pr") {
                if (ms === "all") {
                    if (mode === "doc") {
                        const status_badge = this.format_doc_status("Purchase Receipt", r.status, r.docstatus, r);
                        tr_html += `
                            <td class="picker-col-docname"><span class="picker-source-docname picker-doc-clickable-link" data-doctype="Purchase Receipt" data-name="${r.pr_name}" title="点击查看入库单详情">${frappe.utils.escape_html(r.pr_name)}</span></td>
                            <td class="picker-col-supplier"><strong>${frappe.utils.escape_html(r.supplier || "-")}</strong></td>
                            <td class="picker-col-date">${r.posting_date || "-"}</td>
                            <td class="picker-col-warehouse">${frappe.utils.escape_html(r.warehouse || "-")}</td>
                            <td class="picker-col-doc-details">${doc_badges(r.custom_doc_details)}</td>
                            <td class="picker-col-item-count picker-qty-cell">${r.items_count || 0}</td>
                            <td class="picker-col-qty-val picker-qty-cell"><strong>${flt(r.total_qty).toFixed(2)}</strong></td>
                            <td class="picker-col-money picker-money-cell cell-row-amt"><strong>${this.fmt_money(r.grand_total)}</strong></td>
                            <td class="picker-col-status">${status_badge}</td>
                            <td class="picker-col-linked-doc">${frappe.utils.escape_html(r.purchase_order || "-")}</td>
                            <td class="picker-col-linked-doc">${render_linked_badges(r.linked_pi_names, "purchase-invoice")}</td>
                            <td class="picker-col-user">${frappe.utils.escape_html(r.owner || "-")}</td>
                        `;
                    } else {
                        const status_badge = this.format_doc_status("Purchase Receipt", r.status, r.docstatus, r);
                        tr_html += `
                            <td class="picker-col-docname"><span class="picker-source-docname picker-doc-clickable-link" data-doctype="Purchase Receipt" data-name="${r.pr_name}" title="点击查看入库单详情">${frappe.utils.escape_html(r.pr_name)}</span></td>
                            <td class="picker-col-supplier"><strong>${frappe.utils.escape_html(r.supplier || "-")}</strong></td>
                            <td class="picker-col-date">${r.posting_date || "-"}</td>
                            <td class="picker-col-item-code"><strong>${frappe.utils.escape_html(r.item_code)}</strong></td>
                            <td class="picker-col-name">${frappe.utils.escape_html(r.item_name || "")}</td>
                            <td class="picker-col-spec">${frappe.utils.escape_html(r.spec || "")}</td>
                            <td class="picker-col-uom">${frappe.utils.escape_html(r.uom || "")}</td>
                            <td class="picker-col-qty-val picker-qty-cell"><strong>${r.qty}</strong></td>
                            <td class="picker-col-qty-val picker-qty-cell">${r.billed_amt}</td>
                            <td class="picker-col-rate picker-money-cell">${this.fmt_money(r.rate)}</td>
                            <td class="picker-col-money picker-money-cell cell-row-amt"><strong>${this.fmt_money(r.amount)}</strong></td>
                            <td class="picker-col-warehouse">${frappe.utils.escape_html(r.warehouse || "-")}</td>
                            <td class="picker-col-linked-doc">${frappe.utils.escape_html(r.purchase_order || "-")}</td>
                            <td class="picker-col-remarks">${frappe.utils.escape_html(r.remarks || "")}</td>
                            <td class="picker-col-status">${status_badge}</td>
                            <td class="picker-col-linked-doc">${render_linked_badges(r.linked_pi_names, "purchase-invoice")}</td>
                        `;
                    }
                } else {
                    if (mode === "doc") {
                        tr_html += `
                            <td class="picker-col-supplier">${frappe.utils.escape_html(r.supplier || "-")}</td>
                            <td class="picker-col-docname"><span class="picker-source-docname picker-doc-clickable-link" data-doctype="Purchase Order" data-name="${r.po_name}" title="点击查看详情与操作">${frappe.utils.escape_html(r.po_name)}</span></td>
                            <td class="picker-col-date">${r.po_date || "-"}</td>
                            <td class="picker-col-warehouse">${frappe.utils.escape_html(r.warehouse || "-")}</td>
                            <td class="picker-col-doc-details">${doc_badges(r.custom_doc_details)}</td>
                            <td class="picker-col-item-count picker-qty-cell">${r.pending_item_count || 0}</td>
                            <td class="picker-col-qty-val picker-qty-cell"><strong>${flt(r.pending_qty).toFixed(2)}</strong></td>
                            <td class="picker-col-money picker-money-cell cell-row-amt">${this.fmt_money(r.pending_amount)}</td>
                            <td class="picker-col-money picker-money-cell">${this.fmt_money(r.grand_total)}</td>
                            <td class="picker-col-linked-doc">${render_linked_badges(r.linked_pr_names, "purchase-receipt")}</td>
                        `;
                    } else {
                        tr_html += `
                            <td class="picker-col-supplier">${frappe.utils.escape_html(r.supplier || "-")}</td>
                            <td class="picker-col-docname"><span class="picker-source-docname picker-doc-clickable-link" data-doctype="Purchase Order" data-name="${r.po_name}" title="点击查看详情与操作">${frappe.utils.escape_html(r.po_name)}</span></td>
                            <td class="picker-col-date">${r.po_date || "-"}</td>
                            <td class="picker-col-name"><span class="ashan-tag-badge">${frappe.utils.escape_html(r.item_code)}</span> ${frappe.utils.escape_html(r.item_name || "")}</td>
                            <td class="picker-col-spec">${frappe.utils.escape_html(r.spec || "")}</td>
                            <td class="picker-col-warehouse">${frappe.utils.escape_html(r.warehouse || "-")}</td>
                            <td class="picker-col-qty-val picker-qty-cell">${r.qty}</td>
                            <td class="picker-col-qty-val picker-qty-cell">${r.received_qty}</td>
                            <td class="picker-col-qty-val picker-qty-cell"><strong>${r.pending_qty}</strong></td>
                            <td class="picker-col-rate picker-money-cell">${this.fmt_money(r.rate)}</td>
                            <td class="picker-col-money picker-money-cell cell-row-amt">${this.fmt_money(r.pending_amount)}</td>
                            <td class="picker-col-remarks">${frappe.utils.escape_html(r.remarks || "")}</td>
                            <td class="picker-col-linked-doc">${render_linked_badges(r.linked_pr_names, "purchase-receipt")}</td>
                        `;
                    }
                }
            } else if (stage === "pr_to_pi") {
                if (ms === "all") {
                    if (mode === "doc") {
                        const inv_type_badge = r.invoice_type === "专用发票"
                            ? `<span class="ashan-status-badge ashan-status-purple">专用发票</span>`
                            : `<span class="ashan-status-badge ashan-status-blue">普通发票</span>`;
                        const status_badge = this.format_payment_status(r);
                        tr_html += `
                            <td class="picker-col-docname"><span class="picker-source-docname picker-doc-clickable-link" data-doctype="Purchase Invoice" data-name="${r.pi_name}" title="点击查看发票详情">${frappe.utils.escape_html(r.pi_name)}</span></td>
                            <td class="picker-col-docname"><span class="ashan-tag-badge ashan-tag-blue">${frappe.utils.escape_html(r.bill_no || "未填")}</span></td>
                            <td class="picker-col-status">${inv_type_badge}</td>
                            <td class="picker-col-supplier"><strong>${frappe.utils.escape_html(r.supplier || "-")}</strong></td>
                            <td class="picker-col-date">${r.bill_date || r.posting_date || "-"}</td>
                            <td class="picker-col-doc-details">${doc_badges(r.custom_doc_details)}</td>
                            <td class="picker-col-money picker-money-cell">${this.fmt_money(r.grand_total)}</td>
                            <td class="picker-col-money picker-money-cell">${this.fmt_money(r.paid_amount)}</td>
                            <td class="picker-col-money picker-money-cell cell-row-amt"><strong>${this.fmt_money(r.outstanding_amount)}</strong></td>
                            <td class="picker-col-status">${status_badge}</td>
                            <td class="picker-col-status">${this.format_doc_status("Purchase Invoice", r.status, r.docstatus, r)}</td>
                            <td class="picker-col-linked-doc">${frappe.utils.escape_html(r.linked_pr_names || "-")}</td>
                            <td class="picker-col-linked-doc">${render_linked_badges(r.paid_via_pe_names || r.linked_rr_names, "payment-entry")}</td>
                            <td class="picker-col-user">${frappe.utils.escape_html(r.owner || "-")}</td>
                        `;
                    } else {
                        const status_badge = this.format_payment_status(r);
                        tr_html += `
                            <td class="picker-col-docname"><span class="picker-source-docname picker-doc-clickable-link" data-doctype="Purchase Invoice" data-name="${r.pi_name}" title="点击查看发票详情">${frappe.utils.escape_html(r.pi_name)}</span></td>
                            <td class="picker-col-docname"><span class="ashan-tag-badge ashan-tag-blue">${frappe.utils.escape_html(r.bill_no || "未填")}</span></td>
                            <td class="picker-col-supplier"><strong>${frappe.utils.escape_html(r.supplier || "-")}</strong></td>
                            <td class="picker-col-date">${r.bill_date || r.posting_date || "-"}</td>
                            <td class="picker-col-item-code"><span class="ashan-tag-badge">${frappe.utils.escape_html(r.item_code)}</span></td>
                            <td class="picker-col-name">${frappe.utils.escape_html(r.item_name || "")}</td>
                            <td class="picker-col-spec">${frappe.utils.escape_html(r.spec || "")}</td>
                            <td class="picker-col-uom">${frappe.utils.escape_html(r.uom || "")}</td>
                            <td class="picker-col-qty-val picker-qty-cell"><strong>${r.qty}</strong></td>
                            <td class="picker-col-rate picker-money-cell">${this.fmt_money(r.rate)}</td>
                            <td class="picker-col-money picker-money-cell">${this.fmt_money(r.amount)}</td>
                            <td class="picker-col-money picker-money-cell">${this.fmt_money(r.tax_amount)}</td>
                            <td class="picker-col-money picker-money-cell cell-row-amt"><strong>${this.fmt_money(r.grand_total || r.amount)}</strong></td>
                            <td class="picker-col-money picker-money-cell">${this.fmt_money(r.outstanding_amount)}</td>
                            <td class="picker-col-status">${status_badge}</td>
                            <td class="picker-col-linked-doc">${frappe.utils.escape_html(r.purchase_receipt || "-")}</td>
                        `;
                    }
                } else {
                    if (mode === "doc") {
                        tr_html += `
                            <td class="picker-col-supplier">${frappe.utils.escape_html(r.supplier || "-")}</td>
                            <td class="picker-col-docname"><span class="picker-source-docname picker-doc-clickable-link" data-doctype="Purchase Receipt" data-name="${r.pr_name}" title="点击查看详情与操作">${frappe.utils.escape_html(r.pr_name)}</span></td>
                            <td class="picker-col-date">${r.pr_date || "-"}</td>
                            <td class="picker-col-doc-details">${doc_badges(r.custom_doc_details)}</td>
                            <td class="picker-col-item-count picker-qty-cell">${r.unbilled_item_count || 0}</td>
                            <td class="picker-col-qty-val picker-qty-cell"><strong>${flt(r.pending_qty).toFixed(2)}</strong></td>
                            <td class="picker-col-money picker-money-cell cell-row-amt">${this.fmt_money(r.pending_amount)}</td>
                            <td class="picker-col-money picker-money-cell">${this.fmt_money(r.grand_total)}</td>
                            <td class="picker-col-linked-doc">${frappe.utils.escape_html(r.purchase_order || "-")}</td>
                            <td class="picker-col-linked-doc">${render_linked_badges(r.linked_pi_names, "purchase-invoice")}</td>
                        `;
                    } else {
                        tr_html += `
                            <td class="picker-col-supplier">${frappe.utils.escape_html(r.supplier || "-")}</td>
                            <td class="picker-col-docname"><span class="picker-source-docname picker-doc-clickable-link" data-doctype="Purchase Receipt" data-name="${r.pr_name}" title="点击查看详情与操作">${frappe.utils.escape_html(r.pr_name)}</span></td>
                            <td class="picker-col-date">${r.pr_date || "-"}</td>
                            <td class="picker-col-name"><span class="ashan-tag-badge">${frappe.utils.escape_html(r.item_code)}</span> ${frappe.utils.escape_html(r.item_name || "")}</td>
                            <td class="picker-col-spec">${frappe.utils.escape_html(r.spec || "")}</td>
                            <td class="picker-col-uom">${frappe.utils.escape_html(r.uom || "")}</td>
                            <td class="picker-col-qty-val picker-qty-cell">${r.qty}</td>
                            <td class="picker-col-qty-val picker-qty-cell">${r.billed_qty}</td>
                            <td class="picker-col-qty-val picker-qty-cell"><strong>${r.pending_qty}</strong></td>
                            <td class="picker-col-rate picker-money-cell">${this.fmt_money(r.rate)}</td>
                            <td class="picker-col-money picker-money-cell cell-row-amt">${this.fmt_money(r.pending_amount)}</td>
                            <td class="picker-col-remarks">${frappe.utils.escape_html(r.remarks || "")}</td>
                            <td class="picker-col-linked-doc">${frappe.utils.escape_html(r.purchase_order || "-")}</td>
                            <td class="picker-col-linked-doc">${render_linked_badges(r.linked_pi_names, "purchase-invoice")}</td>
                        `;
                    }
                }
            } else if (stage === "pi_to_rr") {
                if (ms === "all") {
                    if (mode === "doc") {
                        const status_badge = this.format_doc_status("Reimbursement Request", r.status, r.docstatus, r);
                        tr_html += `
                            <td class="picker-col-docname"><span class="picker-source-docname picker-doc-clickable-link" data-doctype="Reimbursement Request" data-name="${r.rr_name}" title="点击查看整算单详情">${frappe.utils.escape_html(r.rr_name)}</span></td>
                            <td class="picker-col-date">${r.posting_date || "-"}</td>
                            <td class="picker-col-user"><strong>${frappe.utils.escape_html(r.applicant || "-")}</strong></td>
                            <td class="picker-col-remarks">${frappe.utils.escape_html(r.purpose || "-")}</td>
                            <td class="picker-col-item-count picker-qty-cell">${r.invoices_count || 0}</td>
                            <td class="picker-col-money picker-money-cell cell-row-amt"><strong>${this.fmt_money(r.total_claim_amount)}</strong></td>
                            <td class="picker-col-status">${status_badge}</td>
                            <td class="picker-col-user">${frappe.utils.escape_html(r.owner || "-")}</td>
                        `;
                    } else {
                        const status_badge = this.format_doc_status("Reimbursement Request", r.status, r.docstatus, r);
                        tr_html += `
                            <td class="picker-col-docname"><span class="picker-source-docname picker-doc-clickable-link" data-doctype="Reimbursement Request" data-name="${r.rr_name}" title="点击查看整算单详情">${frappe.utils.escape_html(r.rr_name)}</span></td>
                            <td class="picker-col-user"><strong>${frappe.utils.escape_html(r.applicant || "-")}</strong></td>
                            <td class="picker-col-date">${r.posting_date || "-"}</td>
                            <td class="picker-col-docname"><span class="picker-source-docname picker-doc-clickable-link" data-doctype="Purchase Invoice" data-name="${r.source_pi}">${frappe.utils.escape_html(r.source_pi)}</span></td>
                            <td class="picker-col-docname"><span class="ashan-tag-badge ashan-tag-blue">${frappe.utils.escape_html(r.bill_no || "未填")}</span></td>
                            <td class="picker-col-supplier"><strong>${frappe.utils.escape_html(r.supplier || "-")}</strong></td>
                            <td class="picker-col-date">${r.bill_date || "-"}</td>
                            <td class="picker-col-money picker-money-cell">${this.fmt_money(r.invoice_amount)}</td>
                            <td class="picker-col-money picker-money-cell cell-row-amt"><strong>${this.fmt_money(r.claim_amount)}</strong></td>
                            <td class="picker-col-status">${status_badge}</td>
                        `;
                    }
                } else {
                    if (mode === "doc") {
                        const inv_type_badge = r.invoice_type === "专用发票"
                            ? `<span class="ashan-status-badge ashan-status-purple">专用发票</span>`
                            : `<span class="ashan-status-badge ashan-status-blue">普通发票</span>`;
                        tr_html += `
                            <td class="picker-col-docname"><span class="picker-source-docname picker-doc-clickable-link" data-doctype="Purchase Invoice" data-name="${r.pi_name}" title="点击查看详情与操作">${frappe.utils.escape_html(r.pi_name)}</span></td>
                            <td class="picker-col-supplier">${frappe.utils.escape_html(r.supplier || "-")}</td>
                            <td class="picker-col-docname"><span class="ashan-tag-badge ashan-tag-blue">${frappe.utils.escape_html(r.bill_no || "未填")}</span></td>
                            <td class="picker-col-status">${inv_type_badge}</td>
                            <td class="picker-col-doc-details">${doc_badges(r.custom_doc_details)}</td>
                            <td class="picker-col-date">${r.bill_date || r.posting_date || "-"}</td>
                            <td class="picker-col-user">${frappe.utils.escape_html(r.owner || "-")}</td>
                            <td class="picker-col-money picker-money-cell">${this.fmt_money(r.grand_total)}</td>
                            <td class="picker-col-money picker-money-cell">${this.fmt_money(r.grand_total - r.outstanding_amount)}</td>
                            <td class="picker-col-money picker-money-cell cell-row-amt"><strong>${this.fmt_money(r.net_available_amount)}</strong></td>
                            <td class="picker-col-linked-doc">${render_linked_badges(r.linked_rr_names, "reimbursement-request")}</td>
                        `;
                    } else {
                        tr_html += `
                            <td class="picker-col-docname"><span class="picker-source-docname picker-doc-clickable-link" data-doctype="Purchase Invoice" data-name="${r.pi_name}" title="点击查看详情与操作">${frappe.utils.escape_html(r.pi_name)}</span></td>
                            <td class="picker-col-supplier">${frappe.utils.escape_html(r.supplier || "-")}</td>
                            <td class="picker-col-docname"><span class="ashan-tag-badge ashan-tag-blue">${frappe.utils.escape_html(r.bill_no || "未填")}</span></td>
                            <td class="picker-col-name"><span class="ashan-tag-badge">${frappe.utils.escape_html(r.item_code)}</span> ${frappe.utils.escape_html(r.item_name || "")}</td>
                            <td class="picker-col-spec">${frappe.utils.escape_html(r.spec || "")}</td>
                            <td class="picker-col-uom">${frappe.utils.escape_html(r.uom || "")}</td>
                            <td class="picker-col-qty-val picker-qty-cell">${r.qty}</td>
                            <td class="picker-col-rate picker-money-cell">${this.fmt_money(r.rate)}</td>
                            <td class="picker-col-money picker-money-cell">${this.fmt_money(r.amount)}</td>
                            <td class="picker-col-date">${r.bill_date || r.posting_date || "-"}</td>
                            <td class="picker-col-money picker-money-cell cell-row-amt"><strong>${this.fmt_money(r.net_available_amount)}</strong></td>
                            <td class="picker-col-remarks">${frappe.utils.escape_html(r.remarks || "")}</td>
                            <td class="picker-col-linked-doc">${render_linked_badges(r.linked_rr_names, "reimbursement-request")}</td>
                        `;
                    }
                }
            } else if (stage === "pi_to_pay") {
                if (ms === "all" || ms === "completed") {
                    if (mode === "doc" && r.pe_name) {
                        const sub_count = r.sub_invoices_count || (r.sub_invoices ? r.sub_invoices.length : 0);
                        const sub_btn = sub_count > 0
                            ? `<button type="button" class="btn btn-xs btn-default picker-btn-sub-invoices" data-pe="${frappe.utils.escape_html(r.pe_name)}">查看核销账单 (${sub_count}张) ▾</button>`
                            : `<span class="picker-no-link">无关联账单</span>`;

                        tr_html += `
                            <td class="picker-col-docname"><span class="picker-source-docname picker-doc-clickable-link" data-doctype="Payment Entry" data-name="${r.pe_name}" title="点击查看付款单详情">${frappe.utils.escape_html(r.pe_name)}</span></td>
                            <td class="picker-col-supplier"><strong>${frappe.utils.escape_html(r.supplier || "-")}</strong></td>
                            <td class="picker-col-date">${r.posting_date || "-"}</td>
                            <td class="picker-col-money picker-money-cell cell-row-amt"><strong>${this.fmt_money(r.paid_amount)}</strong></td>
                            <td class="picker-col-warehouse">${frappe.utils.escape_html(r.paid_from || "-")}</td>
                            <td class="picker-col-status"><span class="ashan-status-badge ashan-status-blue">${frappe.utils.escape_html(r.mode_of_payment || "电汇")}</span></td>
                            <td class="picker-col-doc-details">${sub_btn}</td>
                            <td class="picker-col-user">${frappe.utils.escape_html(r.owner || "-")}</td>
                        `;
                    } else {
                        tr_html += `
                            <td class="picker-col-docname"><span class="picker-source-docname picker-doc-clickable-link" data-doctype="Payment Entry" data-name="${r.pe_name}" title="点击查看付款单详情">${frappe.utils.escape_html(r.pe_name)}</span></td>
                            <td class="picker-col-supplier"><strong>${frappe.utils.escape_html(r.supplier || "-")}</strong></td>
                            <td class="picker-col-date">${r.posting_date || "-"}</td>
                            <td class="picker-col-warehouse">${frappe.utils.escape_html(r.paid_from || "-")}</td>
                            <td class="picker-col-docname"><span class="picker-source-docname picker-doc-clickable-link" data-doctype="Purchase Invoice" data-name="${r.reference_name}">${frappe.utils.escape_html(r.reference_name)}</span> ${r.bill_no ? `<span class="ashan-tag-badge ashan-tag-blue">${frappe.utils.escape_html(r.bill_no)}</span>` : ''}</td>
                            <td class="picker-col-money picker-money-cell">${this.fmt_money(r.total_amount)}</td>
                            <td class="picker-col-money picker-money-cell cell-row-amt" style="color:#059669; font-weight:700;"><strong>${this.fmt_money(r.allocated_amount)}</strong></td>
                            <td class="picker-col-money picker-money-cell">${this.fmt_money(r.outstanding_amount)}</td>
                            <td class="picker-col-status">${this.format_doc_status("Payment Entry", r.status, r.docstatus, r)}</td>
                        `;
                    }
                } else {
                    if (mode === "doc") {
                        const status_badge = this.format_payment_status(r);
                        tr_html += `
                            <td class="picker-col-docname"><span class="picker-source-docname picker-doc-clickable-link" data-doctype="Purchase Invoice" data-name="${r.pi_name}" title="点击查看发票详情">${frappe.utils.escape_html(r.pi_name)}</span></td>
                            <td class="picker-col-docname"><span class="ashan-tag-badge ashan-tag-blue">${frappe.utils.escape_html(r.bill_no || "未填")}</span></td>
                            <td class="picker-col-date">${r.bill_date || r.posting_date || "-"}</td>
                            <td class="picker-col-supplier"><strong>${frappe.utils.escape_html(r.supplier || "-")}</strong></td>
                            <td class="picker-col-money picker-money-cell">${this.fmt_money(r.grand_total)}</td>
                            <td class="picker-col-money picker-money-cell">${this.fmt_money(r.paid_amount)}</td>
                            <td class="picker-col-money picker-money-cell">${this.fmt_money(r.outstanding_amount)}</td>
                            <td class="picker-col-money picker-money-cell cell-row-amt">
                                <input type="number" class="picker-input-qty picker-cell-input" value="${r.this_amount !== undefined ? r.this_amount : r.outstanding_amount}" min="0.01" max="${r.outstanding_amount}" step="0.01" style="width:90px; text-align:right;">
                            </td>
                            <td class="picker-col-status">${status_badge}</td>
                            <td class="picker-col-linked-doc">${render_linked_badges(r.paid_via_pe_names, "payment-entry")}</td>
                        `;
                    } else {
                        const status_badge = this.format_payment_status(r);
                        const bank_info = r.bank_name || r.bank_account_no
                            ? `<span class="ashan-tag-badge ashan-tag-gray" title="${frappe.utils.escape_html(r.bank_name || '')} ${frappe.utils.escape_html(r.bank_account_no || '')}">${frappe.utils.escape_html(r.bank_name || '')} ${frappe.utils.escape_html(r.bank_account_no || '')}</span>`
                            : `<span class="picker-no-link">-</span>`;

                        tr_html += `
                            <td class="picker-col-docname"><span class="picker-source-docname picker-doc-clickable-link" data-doctype="Purchase Invoice" data-name="${r.pi_name}" title="点击查看发票详情">${frappe.utils.escape_html(r.pi_name)}</span></td>
                            <td class="picker-col-docname"><span class="ashan-tag-badge ashan-tag-blue">${frappe.utils.escape_html(r.bill_no || "未填")}</span></td>
                            <td class="picker-col-date">${r.bill_date || r.posting_date || "-"}</td>
                            <td class="picker-col-supplier"><strong>${frappe.utils.escape_html(r.supplier || "-")}</strong></td>
                            <td class="picker-col-warehouse">${bank_info}</td>
                            <td class="picker-col-money picker-money-cell">${this.fmt_money(r.grand_total)}</td>
                            <td class="picker-col-money picker-money-cell">${this.fmt_money(r.paid_amount)}</td>
                            <td class="picker-col-money picker-money-cell cell-row-amt">
                                <input type="number" class="picker-input-qty picker-cell-input" value="${r.this_amount !== undefined ? r.this_amount : r.outstanding_amount}" min="0.01" max="${r.outstanding_amount}" step="0.01" style="width:90px; text-align:right;">
                            </td>
                            <td class="picker-col-money picker-money-cell"><strong>${this.fmt_money(r.outstanding_amount)}</strong></td>
                            <td class="picker-col-status">${status_badge}</td>
                            <td class="picker-col-linked-doc">${render_linked_badges(r.paid_via_pe_names, "payment-entry")}</td>
                            <td class="picker-col-user">${frappe.utils.escape_html(r.owner || "-")}</td>
                        `;
                    }
                }
            }

            tr_html += `</tr>`;

            if (stage === "pi_to_pay" && mode === "doc" && r.pe_name && r.sub_invoices && r.sub_invoices.length > 0) {
                const sub_rows_html = r.sub_invoices.map((si, sidx) => `
                    <tr>
                        <td class="picker-modal-cell-center">${sidx + 1}</td>
                        <td><span class="picker-source-docname picker-doc-clickable-link" data-doctype="Purchase Invoice" data-name="${si.name}">${frappe.utils.escape_html(si.name)}</span></td>
                        <td><span class="ashan-tag-badge ashan-tag-blue">${frappe.utils.escape_html(si.bill_no || '-')}</span></td>
                        <td>${frappe.utils.escape_html(si.supplier || r.supplier || '-')}</td>
                        <td>${si.bill_date || si.invoice_date || '-'}</td>
                        <td class="picker-money-cell">${this.fmt_money(si.grand_total)}</td>
                        <td class="picker-money-cell" style="color:#059669; font-weight:700;">${this.fmt_money(si.allocated_amount)}</td>
                        <td class="picker-money-cell">${this.fmt_money(si.outstanding_amount)}</td>
                        <td><span class="ashan-status-badge ashan-status-green">已核销</span></td>
                    </tr>
                `).join("");

                const sub_table_html = `
                    <div class="picker-sub-invoices-wrap" style="padding:12px 16px; background:#f8fafc; border-radius:6px; margin:6px 0; border:1px solid #e2e8f0;">
                        <div style="font-size:12px; font-weight:700; color:#1e293b; margin-bottom:8px;">
                            付款单 <strong>${frappe.utils.escape_html(r.pe_name)}</strong> 下级核销账单明细 (${r.sub_invoices.length} 张发票):
                        </div>
                        <table class="picker-modal-item-table" style="background:#fff;">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>采购发票号</th>
                                    <th>发票号码</th>
                                    <th>供应商</th>
                                    <th>开票日期</th>
                                    <th>发票总额</th>
                                    <th>本次核销金额</th>
                                    <th>当前未付余额</th>
                                    <th>核销状态</th>
                                </tr>
                            </thead>
                            <tbody>${sub_rows_html}</tbody>
                        </table>
                    </div>
                `;

                const total_cols = this.$body.find("#picker-table-thead th").length || 10;
                tr_html += `<tr class="picker-sub-invoices-row" id="sub-row-${r.pe_name}" style="display:none;"><td colspan="${total_cols}">${sub_table_html}</td></tr>`;
            }

            $tbody.append(tr_html);
        });
    }

    render_table_footer() {
        const stage = this.active_stage;
        const mode = this.view_modes[stage] || "detail";
        const is_all_company = this.active_company === "All";
        const ms = (this.filters[stage] && this.filters[stage].match_status) || "pending";
        let total_qty = 0;
        let total_amt = 0;
        let total_tax = 0;
        let total_grand = 0;
        let total_paid = 0;

        this.table_data.forEach((r) => {
            if (this.locked_company && r.company !== this.locked_company) return;
            total_qty += flt(r.pending_qty || r.total_qty || r.qty || 0);
            total_amt += flt(r.amount || r.estimated_amount || r.pending_amount || r.net_available_amount || r.total_claim_amount || r.paid_amount || r.allocated_amount || 0);
            total_tax += flt(r.tax_amount || 0);
            total_grand += flt(r.grand_total || r.total_amount || 0);
            total_paid += flt(r.paid_amount || (r.grand_total ? (r.grand_total - (r.outstanding_amount || 0)) : 0));
        });

        let prefix_cols = is_all_company ? 3 : 2;
        let foot_html = `
            <tr>
                <td colspan="${prefix_cols}" class="picker-col-sticky-foot">
                    合计 (共 ${this.table_data.length} 笔)
                </td>
        `;

        if (stage === "item_to_mr") {
            if (mode === "doc") {
                foot_html += `
                    <td colspan="5"></td>
                    <td class="picker-qty-cell">${total_qty.toFixed(2)}</td>
                    <td colspan="2"></td>
                `;
            } else {
                foot_html += `
                    <td colspan="5"></td>
                    <td class="picker-qty-cell">${total_qty.toFixed(2)}</td>
                    <td></td>
                    <td class="picker-money-cell">${this.fmt_money(total_amt)}</td>
                    <td></td>
                `;
            }
        } else if (stage === "mr_to_po") {
            if (ms === "all") {
                if (mode === "doc") {
                    foot_html += `
                        <td colspan="5"></td>
                        <td class="picker-qty-cell">${total_qty.toFixed(2)}</td>
                        <td class="picker-money-cell">${this.fmt_money(total_grand)}</td>
                        <td colspan="3"></td>
                    `;
                } else {
                    foot_html += `
                        <td colspan="6"></td>
                        <td class="picker-qty-cell">${total_qty.toFixed(2)}</td>
                        <td></td>
                        <td></td>
                        <td class="picker-money-cell">${this.fmt_money(total_amt)}</td>
                        <td colspan="4"></td>
                    `;
                }
            } else {
                if (mode === "doc") {
                    foot_html += `
                        <td colspan="4"></td>
                        <td></td>
                        <td class="picker-qty-cell">${total_qty.toFixed(2)}</td>
                        <td class="picker-money-cell">${this.fmt_money(total_amt)}</td>
                        <td colspan="3"></td>
                    `;
                } else {
                    foot_html += `
                        <td colspan="6"></td>
                        <td colspan="2"></td>
                        <td class="picker-qty-cell">${total_qty.toFixed(2)}</td>
                        <td></td>
                        <td class="picker-money-cell">${this.fmt_money(total_amt)}</td>
                        <td class="picker-money-cell">${this.fmt_money(total_amt * 0.13)}</td>
                        <td class="picker-money-cell">${this.fmt_money(total_amt * 1.13)}</td>
                        <td colspan="3"></td>
                    `;
                }
            }
        } else if (stage === "po_to_pr") {
            if (ms === "all") {
                if (mode === "doc") {
                    foot_html += `
                        <td colspan="5"></td>
                        <td class="picker-qty-cell">${total_qty.toFixed(2)}</td>
                        <td class="picker-money-cell">${this.fmt_money(total_grand)}</td>
                        <td colspan="4"></td>
                    `;
                } else {
                    foot_html += `
                        <td colspan="6"></td>
                        <td class="picker-qty-cell">${total_qty.toFixed(2)}</td>
                        <td></td>
                        <td></td>
                        <td class="picker-money-cell">${this.fmt_money(total_amt)}</td>
                        <td colspan="5"></td>
                    `;
                }
            } else {
                if (mode === "doc") {
                    foot_html += `
                        <td colspan="5"></td>
                        <td></td>
                        <td class="picker-qty-cell">${total_qty.toFixed(2)}</td>
                        <td class="picker-money-cell">${this.fmt_money(total_amt)}</td>
                        <td class="picker-money-cell">${this.fmt_money(total_grand)}</td>
                        <td></td>
                    `;
                } else {
                    foot_html += `
                        <td colspan="6"></td>
                        <td colspan="2"></td>
                        <td class="picker-qty-cell">${total_qty.toFixed(2)}</td>
                        <td></td>
                        <td class="picker-money-cell">${this.fmt_money(total_amt)}</td>
                        <td colspan="2"></td>
                    `;
                }
            }
        } else if (stage === "pr_to_pi") {
            if (ms === "all") {
                if (mode === "doc") {
                    foot_html += `
                        <td colspan="5"></td>
                        <td class="picker-money-cell">${this.fmt_money(total_grand)}</td>
                        <td class="picker-money-cell">${this.fmt_money(total_paid)}</td>
                        <td class="picker-money-cell">${this.fmt_money(total_grand - total_paid)}</td>
                        <td colspan="5"></td>
                    `;
                } else {
                    foot_html += `
                        <td colspan="7"></td>
                        <td class="picker-qty-cell">${total_qty.toFixed(2)}</td>
                        <td></td>
                        <td class="picker-money-cell">${this.fmt_money(total_amt)}</td>
                        <td class="picker-money-cell">${this.fmt_money(total_tax)}</td>
                        <td class="picker-money-cell">${this.fmt_money(total_grand)}</td>
                        <td class="picker-money-cell">${this.fmt_money(total_grand - total_paid)}</td>
                        <td colspan="2"></td>
                    `;
                }
            } else {
                if (mode === "doc") {
                    foot_html += `
                        <td colspan="4"></td>
                        <td></td>
                        <td class="picker-qty-cell">${total_qty.toFixed(2)}</td>
                        <td class="picker-money-cell">${this.fmt_money(total_amt)}</td>
                        <td class="picker-money-cell">${this.fmt_money(total_grand)}</td>
                        <td colspan="2"></td>
                    `;
                } else {
                    foot_html += `
                        <td colspan="6"></td>
                        <td colspan="2"></td>
                        <td class="picker-qty-cell">${total_qty.toFixed(2)}</td>
                        <td></td>
                        <td class="picker-money-cell">${this.fmt_money(total_amt)}</td>
                        <td colspan="3"></td>
                    `;
                }
            }
        } else if (stage === "pi_to_rr") {
            if (ms === "all") {
                if (mode === "doc") {
                    foot_html += `
                        <td colspan="4"></td>
                        <td class="picker-money-cell">${this.fmt_money(total_amt)}</td>
                        <td colspan="2"></td>
                    `;
                } else {
                    foot_html += `
                        <td colspan="6"></td>
                        <td class="picker-money-cell">${this.fmt_money(total_grand)}</td>
                        <td class="picker-money-cell">${this.fmt_money(total_amt)}</td>
                        <td></td>
                    `;
                }
            } else {
                if (mode === "doc") {
                    foot_html += `
                        <td colspan="6"></td>
                        <td class="picker-money-cell">${this.fmt_money(total_grand)}</td>
                        <td class="picker-money-cell">${this.fmt_money(total_paid)}</td>
                        <td class="picker-money-cell">${this.fmt_money(total_amt)}</td>
                        <td></td>
                    `;
                } else {
                    foot_html += `
                        <td colspan="5"></td>
                        <td class="picker-qty-cell">${total_qty.toFixed(2)}</td>
                        <td></td>
                        <td class="picker-money-cell">${this.fmt_money(total_amt)}</td>
                        <td></td>
                        <td class="picker-money-cell">${this.fmt_money(total_amt)}</td>
                        <td colspan="2"></td>
                    `;
                }
            }
        } else if (stage === "pi_to_pay") {
            if (ms === "all" || ms === "completed") {
                if (mode === "doc") {
                    foot_html += `
                        <td colspan="3"></td>
                        <td class="picker-money-cell">${this.fmt_money(total_amt)}</td>
                        <td colspan="4"></td>
                    `;
                } else {
                    foot_html += `
                        <td colspan="5"></td>
                        <td class="picker-money-cell">${this.fmt_money(total_grand)}</td>
                        <td class="picker-money-cell">${this.fmt_money(total_amt)}</td>
                        <td class="picker-money-cell">${this.fmt_money(total_grand - total_amt)}</td>
                        <td></td>
                    `;
                }
            } else {
                if (mode === "doc") {
                    foot_html += `
                        <td colspan="4"></td>
                        <td class="picker-money-cell">${this.fmt_money(total_grand)}</td>
                        <td class="picker-money-cell">${this.fmt_money(total_paid)}</td>
                        <td class="picker-money-cell">${this.fmt_money(total_amt)}</td>
                        <td class="picker-money-cell">${this.fmt_money(total_amt)}</td>
                        <td colspan="2"></td>
                    `;
                } else {
                    foot_html += `
                        <td colspan="5"></td>
                        <td class="picker-money-cell">${this.fmt_money(total_grand)}</td>
                        <td class="picker-money-cell">${this.fmt_money(total_paid)}</td>
                        <td class="picker-money-cell">${this.fmt_money(total_amt)}</td>
                        <td class="picker-money-cell">${this.fmt_money(total_amt)}</td>
                        <td colspan="3"></td>
                    `;
                }
            }
        }

        foot_html += `</tr>`;
        this.$body.find("#picker-table-tfoot").html(foot_html);
    }

    update_company_lock_ui(is_locking = false) {
        if (is_locking && this.locked_company && this.active_company === "All") {
            frappe.show_alert({
                message: __("已按【{0}】锁定选单生单范围（已自动隐藏其他公司明细，取消勾选后恢复全量视图）", [frappe.utils.escape_html(this.locked_company)]),
                indicator: "orange"
            }, 5);
        }
    }

    update_table_visibility_by_lock() {
        const self = this;
        this.$body.find("#picker-table-tbody tr").each(function () {
            const comp = $(this).attr("data-company");
            if (self.locked_company && comp !== self.locked_company) {
                $(this).addClass("picker-row-company-hidden");
            } else {
                $(this).removeClass("picker-row-company-hidden");
            }
        });
        this.render_table_footer();
    }

    update_row_amount_display($tr, row) {
        if (!row) return;
        const rate = flt(row.rate);
        const this_qty = flt(row.this_qty);
        const new_amt = flt(rate * this_qty, 2);
        if (row.estimated_amount !== undefined) row.estimated_amount = new_amt;
        if (row.pending_amount !== undefined) row.pending_amount = new_amt;
        $tr.find(".cell-row-amt").text(this.fmt_money(new_amt));
    }

    can_process_active_stage() {
        const capability = this.capabilities[this.active_stage] || {};
        return Boolean(capability.can_create);
    }

    update_action_summary() {
        const $bar = this.$body.find("#picker-action-bar");
        const stage = this.active_stage;
        const mode = this.view_modes[stage] || "detail";
        const cfg = this.stages_config[stage];
        const sel_count = this.selected_map.size;
        const can_process = this.can_process_active_stage();

        let total_sel_amt = 0;
        this.selected_map.forEach((item) => {
            const rate = flt(item.rate);
            const qty = flt(item.this_qty || item.pending_qty || 1);
            if (item.net_available_amount !== undefined) {
                total_sel_amt += flt(item.net_available_amount);
            } else if (item.estimated_amount !== undefined && mode === "doc") {
                total_sel_amt += flt(item.estimated_amount);
            } else if (item.pending_amount !== undefined && mode === "doc") {
                total_sel_amt += flt(item.pending_amount);
            } else {
                total_sel_amt += flt(rate * qty, 2);
            }
        });

        let target_comp_suffix = "";
        if (this.locked_company) {
            target_comp_suffix = `【${this.locked_company}】`;
        } else if (this.active_company !== "All") {
            target_comp_suffix = `【${this.active_company}】`;
        }

        const view_switch_html = `
            <div class="picker-view-switch-group">
                <button class="picker-view-btn ${mode === 'detail' ? 'active' : ''}" data-mode="detail">明细视图</button>
                <button class="picker-view-btn ${mode === 'doc' ? 'active' : ''}" data-mode="doc">单号视图</button>
            </div>
        `;

        if (!can_process) {
            $bar.html(`
                <div class="picker-summary-text">
                    ${view_switch_html}
                    <span class="ashan-status-badge ashan-status-gray">只读查看</span>
                </div>
                <div class="picker-readonly-note">当前账号可查看单据，但不能执行本阶段业务操作。</div>
            `);
            return;
        }

        if (stage === "item_to_mr") {
            const count_unit = mode === "doc" ? "单" : "项";
            const html = `
                <div class="picker-summary-text">
                    ${view_switch_html}
                    <span>已选 <strong class="picker-summary-highlight">${sel_count}</strong> ${count_unit}</span>
                </div>
                <div class="picker-btn-group">
                    <button class="picker-btn-secondary" id="picker-select-all-btn">全选本页</button>
                    <button class="picker-btn-secondary" id="picker-clear-sel-btn">清空选择</button>
                    <button class="picker-btn-secondary picker-btn-cancel-action" id="picker-cancel-mr-btn" ${sel_count === 0 ? 'disabled' : ''} title="撤销已提交且未生成下游单据的采购申请单">撤单</button>
                    <button class="picker-btn-secondary picker-btn-delete-action" id="picker-delete-mr-btn" ${sel_count === 0 ? 'disabled' : ''} title="彻底删除申请单（仅限没有关联单据情况允许删除）">删除单据</button>
                    <button class="picker-btn-create-mr" id="picker-create-mr-btn">
                        <span>新建物料申请单</span>
                    </button>
                </div>
            `;
            $bar.html(html);
            this.update_header_checkbox_state();
            return;
        }

        const count_unit = mode === "doc" ? "单" : "行";
        const delete_btn_text = (stage === "item_to_mr") ? "删除单据" : (this.filters[stage]?.match_status === "all" ? "删除单据" : "删除单据/草稿");
        const delete_button = this.is_manager
            ? `<button class="picker-btn-secondary picker-btn-delete-action" id="picker-batch-delete-btn" ${sel_count === 0 ? 'disabled' : ''} title="删除所选单据（包含下级关联的连带逆序级联删除）">${delete_btn_text}</button>`
            : "";

        const html = `
            <div class="picker-summary-text">
                ${view_switch_html}
                <span>已选 <strong class="picker-summary-highlight">${sel_count}</strong> ${count_unit}</span>
                <span>本次总计: <strong class="picker-summary-highlight">${this.fmt_money(total_sel_amt)}</strong></span>
            </div>
            <div class="picker-btn-group">
                <button class="picker-btn-secondary" id="picker-select-all-btn">全选本页</button>
                <button class="picker-btn-secondary" id="picker-clear-sel-btn">清空选择</button>
                ${delete_button}
                <button class="picker-btn-primary" id="picker-submit-btn" ${sel_count === 0 ? 'disabled' : ''}>
                    ${cfg.btn_label}${target_comp_suffix}
                </button>
            </div>
        `;
        $bar.html(html);
        this.update_header_checkbox_state();
    }

    update_header_checkbox_state() {
        const $hdr_cb = this.$body.find("#picker-select-all-header");
        if (!$hdr_cb.length) return;
        const visible_rows = (this.table_data || []).filter(r => !this.locked_company || r.company === this.locked_company);
        const total_visible = visible_rows.length;
        const sel_count = this.selected_map.size;
        const el = $hdr_cb[0];

        if (total_visible > 0 && sel_count >= total_visible) {
            el.checked = true;
            el.indeterminate = false;
        } else if (sel_count > 0) {
            el.checked = false;
            el.indeterminate = true;
        } else {
            el.checked = false;
            el.indeterminate = false;
        }
    }

    select_all_visible() {
        const self = this;

        if (this.active_company === "All" && !this.locked_company) {
            const first_visible = this.table_data.find((r) => !self.locked_company || r.company === self.locked_company);
            if (first_visible) {
                this.locked_company = first_visible.company;
                this.update_company_lock_ui(true);
            }
        }

        this.table_data.forEach((r) => {
            if (self.locked_company && r.company !== self.locked_company) return;
            const key = self.get_row_key(r);
            self.selected_map.set(key, r);
        });

        this.render_table_rows();
        this.update_table_visibility_by_lock();
        this.update_action_summary();
    }

    clear_selection() {
        this.selected_map.clear();
        this.locked_company = null;
        this.update_company_lock_ui();
        this.render_table_rows();
        this.update_table_visibility_by_lock();
        this.update_action_summary();
    }

    fill_max_quantities() {
        const self = this;
        this.table_data.forEach((r) => {
            if (self.locked_company && r.company !== self.locked_company) return;
            const max_qty = flt(r.pending_qty || r.qty);
            r.this_qty = max_qty;
            const key = self.get_row_key(r);
            if (self.selected_map.has(key)) {
                self.selected_map.get(key).this_qty = max_qty;
            }
        });
        this.render_table_rows();
        this.update_action_summary();
    }

    sync_scroll_widths() {
        const table_width = this.$body.find("#picker-data-table").outerWidth() || 1200;
        this.$body.find("#picker-top-scrollbar-inner").width(table_width);
    }

    fmt_money(val) {
        return `¥ ${flt(val || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    open_create_mr_dialog() {
        const default_company = window.AshanWorkContext
            ? window.AshanWorkContext.getCompany()
            : (this.active_company !== "All" ? this.active_company : (this.companies[0] || ""));
        const default_schedule_date = (typeof frappe !== "undefined" && frappe.datetime && frappe.datetime.add_months)
            ? frappe.datetime.add_months(frappe.datetime.nowdate(), 1)
            : "";
        let rows_data = [
            { item_code: "", item_name: "", spec: "", qty: 1.0, rate: 0.0, amount: 0.0, tax_rate: 13.0, tax_amount: 0.0, total_amount: 0.0, description: "" }
        ];

        const recalculate_row_state = (r) => {
            const qty = flt(r.qty) || 0.0;
            const rate = flt(r.rate) || 0.0;
            r.amount = Math.round(qty * rate * 100) / 100;
            const tax_pct = flt(r.tax_rate) || 0.0;
            r.tax_amount = Math.round(r.amount * (tax_pct / 100.0) * 100) / 100;
            r.total_amount = Math.round((r.amount + r.tax_amount) * 100) / 100;
        };

        const update_bottom_summary = ($wrapper) => {
            let sum_qty = 0;
            let sum_amount = 0;
            let sum_tax = 0;
            let sum_total = 0;
            rows_data.forEach((r) => {
                sum_qty += flt(r.qty);
                sum_amount += flt(r.amount);
                sum_tax += flt(r.tax_amount);
                sum_total += flt(r.total_amount);
            });
            $wrapper.find("#modal-sum-qty").text(sum_qty.toFixed(2));
            $wrapper.find("#modal-sum-amt").text(this.fmt_money(sum_amount));
            $wrapper.find("#modal-sum-tax").text(this.fmt_money(sum_tax));
            $wrapper.find("#modal-sum-total").text(this.fmt_money(sum_total));
        };

        const recalculate_and_sync_row = ($tr, field_changed, $wrap) => {
            const idx = parseInt($tr.attr("data-idx"));
            const r = rows_data[idx];
            if (!r) return;

            let qty = flt($tr.find(".modal-input-qty").val());
            if (isNaN(qty) || qty < 0) qty = 0;

            let rate = flt($tr.find(".modal-input-rate").val());
            if (isNaN(rate) || rate < 0) rate = 0;

            let amount = flt($tr.find(".modal-input-amount").val());
            if (isNaN(amount) || amount < 0) amount = 0;

            let tax_rate = flt($tr.find(".modal-input-tax-rate").val());
            if (isNaN(tax_rate) || tax_rate < 0) tax_rate = 0;

            let tax_amount = flt($tr.find(".modal-input-tax-amount").val());
            if (isNaN(tax_amount) || tax_amount < 0) tax_amount = 0;

            let total_amount = flt($tr.find(".modal-input-total-amount").val());
            if (isNaN(total_amount) || total_amount < 0) total_amount = 0;

            if (field_changed === "qty" || field_changed === "rate") {
                amount = Math.round(qty * rate * 100) / 100;
                tax_amount = Math.round(amount * (tax_rate / 100.0) * 100) / 100;
                total_amount = Math.round((amount + tax_amount) * 100) / 100;
                $tr.find(".modal-input-amount").val(amount.toFixed(2));
                $tr.find(".modal-input-tax-amount").val(tax_amount.toFixed(2));
                $tr.find(".modal-input-total-amount").val(total_amount.toFixed(2));
            } else if (field_changed === "tax_rate") {
                tax_amount = Math.round(amount * (tax_rate / 100.0) * 100) / 100;
                total_amount = Math.round((amount + tax_amount) * 100) / 100;
                $tr.find(".modal-input-tax-amount").val(tax_amount.toFixed(2));
                $tr.find(".modal-input-total-amount").val(total_amount.toFixed(2));
            } else if (field_changed === "amount") {
                if (qty > 0) {
                    rate = Math.round((amount / qty) * 10000) / 10000;
                    $tr.find(".modal-input-rate").val(rate);
                }
                tax_amount = Math.round(amount * (tax_rate / 100.0) * 100) / 100;
                total_amount = Math.round((amount + tax_amount) * 100) / 100;
                $tr.find(".modal-input-tax-amount").val(tax_amount.toFixed(2));
                $tr.find(".modal-input-total-amount").val(total_amount.toFixed(2));
            } else if (field_changed === "tax_amount") {
                total_amount = Math.round((amount + tax_amount) * 100) / 100;
                if (amount > 0) {
                    tax_rate = Math.round((tax_amount / amount) * 10000) / 100;
                    $tr.find(".modal-input-tax-rate").val(tax_rate);
                }
                $tr.find(".modal-input-total-amount").val(total_amount.toFixed(2));
            } else if (field_changed === "total_amount") {
                amount = Math.round((total_amount / (1 + tax_rate / 100.0)) * 100) / 100;
                tax_amount = Math.round((total_amount - amount) * 100) / 100;
                if (qty > 0) {
                    rate = Math.round((amount / qty) * 10000) / 10000;
                    $tr.find(".modal-input-rate").val(rate);
                }
                $tr.find(".modal-input-amount").val(amount.toFixed(2));
                $tr.find(".modal-input-tax-amount").val(tax_amount.toFixed(2));
            }

            r.qty = qty;
            r.rate = rate;
            r.amount = amount;
            r.tax_rate = tax_rate;
            r.tax_amount = tax_amount;
            r.total_amount = total_amount;

            update_bottom_summary($wrap);
        };

        const render_rows = (dialog) => {
            const $wrapper = dialog.get_field("items_html").$wrapper;
            const $tbody = $wrapper.find("#picker-modal-item-tbody");
            $tbody.empty();

            rows_data.forEach((row, idx) => {
                recalculate_row_state(row);

                const tr = $(`
                    <tr data-idx="${idx}">
                        <td class="picker-modal-cell-center">${idx + 1}</td>
                        <td>
                            <div class="picker-suggest-wrapper">
                                <input type="text" class="modal-input-code" placeholder="输入物料代码..." value="${frappe.utils.escape_html(row.item_code || '')}">
                                <div class="picker-suggest-dropdown" id="suggest-dd-${idx}"></div>
                            </div>
                        </td>
                        <td>
                            <input type="text" class="modal-input-name modal-input-readonly" readonly tabindex="-1" placeholder="自动带出物料名称..." value="${frappe.utils.escape_html(row.item_name || '')}">
                        </td>
                        <td>
                            <input type="text" class="modal-input-spec modal-input-readonly" readonly tabindex="-1" placeholder="自动带出规格..." value="${frappe.utils.escape_html(row.spec || '')}">
                        </td>
                        <td>
                            <input type="number" step="any" min="0" class="modal-input-qty" value="${row.qty}">
                        </td>
                        <td>
                            <input type="number" step="any" min="0" class="modal-input-rate" value="${row.rate}">
                        </td>
                        <td>
                            <input type="number" step="any" min="0" class="modal-input-amount" value="${flt(row.amount).toFixed(2)}">
                        </td>
                        <td>
                            <input type="number" step="any" min="0" max="100" class="modal-input-tax-rate" value="${row.tax_rate}">
                        </td>
                        <td>
                            <input type="number" step="any" min="0" class="modal-input-tax-amount" value="${flt(row.tax_amount).toFixed(2)}">
                        </td>
                        <td>
                            <input type="number" step="any" min="0" class="modal-input-total-amount" value="${flt(row.total_amount).toFixed(2)}">
                        </td>
                        <td>
                            <input type="text" class="modal-input-remarks" placeholder="备注说明..." value="${frappe.utils.escape_html(row.remarks || row.description || '')}">
                        </td>
                        <td class="picker-modal-cell-center">
                            <button class="picker-modal-del-btn" data-idx="${idx}">删除</button>
                        </td>
                    </tr>
                `);
                $tbody.append(tr);
            });

            update_bottom_summary($wrapper);
        };

        const d = new frappe.ui.Dialog({
            title: __("新建物料申请"),
            fields: [
                {
                    fieldtype: "Select",
                    fieldname: "company",
                    label: __("所属公司"),
                    options: ["", ...this.companies].join("\n"),
                    default: default_company,
                    reqd: 1,
                },
                {
                    fieldtype: "Date",
                    fieldname: "schedule_date",
                    label: __("期望到货日期"),
                    default: default_schedule_date,
                    reqd: 1,
                },
                {
                    fieldtype: "Section Break",
                    label: __("申请物料明细与税额核算"),
                },
                {
                    fieldtype: "HTML",
                    fieldname: "items_html",
                    options: `
                        <div>
                            <div class="picker-modal-item-table-wrap">
                                <table class="picker-modal-item-table picker-table-12cols">
                                    <thead>
                                        <tr>
                                            <th>#</th>
                                            <th>物料代码</th>
                                            <th>物料名称</th>
                                            <th>规格</th>
                                            <th>数量</th>
                                            <th>参考单价</th>
                                            <th>不含税金额</th>
                                            <th>税率 %</th>
                                            <th>税额</th>
                                            <th>含税总价</th>
                                            <th>备注</th>
                                            <th>操作</th>
                                        </tr>
                                    </thead>
                                    <tbody id="picker-modal-item-tbody"></tbody>
                                </table>
                            </div>
                            <button class="picker-modal-add-btn" id="picker-modal-add-row-btn">添加物料</button>

                            <div class="picker-modal-summary-bar">
                                <span>合计汇总:</span>
                                <div class="picker-modal-summary-items">
                                    <span>申请总数: <strong id="modal-sum-qty" class="picker-summary-highlight">0</strong></span>
                                    <span>不含税金额: <strong id="modal-sum-amt" class="picker-summary-highlight">¥ 0.00</strong></span>
                                    <span>税额: <strong id="modal-sum-tax" class="picker-summary-highlight">¥ 0.00</strong></span>
                                    <span>含税总额: <strong id="modal-sum-total" class="picker-summary-highlight">¥ 0.00</strong></span>
                                </div>
                            </div>
                        </div>
                    `,
                },
            ],
            primary_action_label: __("正式提交物料申请单"),
            primary_action: async () => {
                const vals = this.validate_and_get_dialog_values(d, [
                    { fieldname: "company", label: "所属公司" },
                    { fieldname: "schedule_date", label: "期望到货日期" },
                ]);
                if (!vals) return;

                const valid_items = rows_data.filter((r) => (r.item_code || "").trim().length > 0);
                if (!valid_items.length) {
                    frappe.msgprint(__("请至少填写一行有效的物料代码。"));
                    return;
                }

                try {
                    frappe.dom.freeze(__("正在创建并正式提交采购申请单..."));
                    const res = await frappe.call({
                        method: "ashan_cn_procurement.services.procurement_picker_service.quick_create_material_request",
                        args: {
                            company: vals.company,
                            schedule_date: vals.schedule_date,
                            items: valid_items,
                        },
                    });
                    frappe.dom.unfreeze();
                    if (res && res.message && res.message.success) {
                        d.hide();
                        const mr_name = res.message.name;
                        frappe.show_alert({
                            message: __("成功创建并正式发布采购申请单：<b>{0}</b>", [mr_name]),
                            indicator: "green",
                        }, 6);
                        this.refresh_all();
                        if (mr_name) {
                            this.show_doc_detail_modal("Material Request", mr_name);
                        }
                    }
                } catch (e) {
                    frappe.dom.unfreeze();
                    frappe.msgprint(e.message || __("创建采购申请单失败"));
                }
            },
        });

        d.set_secondary_action_label(__("✕ 关闭"));
        d.set_secondary_action(() => {
            d.hide();
        });

        d.$wrapper.addClass("picker-create-mr-modal");
        d.show();

        d.$wrapper.attr("data-backdrop", "static").attr("data-keyboard", "false");
        d.$wrapper.on("click", function (e) {
            if ($(e.target).hasClass("modal") || $(e.target).hasClass("modal-backdrop")) {
                e.preventDefault();
                e.stopPropagation();
            }
        });
        render_rows(d);

        const $wrap = d.get_field("items_html").$wrapper;

        $wrap.on("click", "#picker-modal-add-row-btn", () => {
            rows_data.push({ item_code: "", item_name: "", spec: "", qty: 1.0, rate: 0.0, amount: 0.0, tax_rate: 13.0, tax_amount: 0.0, total_amount: 0.0, description: "" });
            render_rows(d);
        });

        $wrap.on("click", ".picker-modal-del-btn", function () {
            const idx = parseInt($(this).attr("data-idx"));
            rows_data.splice(idx, 1);
            if (!rows_data.length) rows_data.push({ item_code: "", item_name: "", spec: "", qty: 1.0, rate: 0.0, amount: 0.0, tax_rate: 13.0, tax_amount: 0.0, total_amount: 0.0, description: "" });
            render_rows(d);
        });

        // Autocomplete Search on item input
        let search_timeout = null;
        $wrap.on("input focus", ".modal-input-code", function () {
            const $input = $(this);
            const idx = parseInt($input.closest("tr").attr("data-idx"));
            const $dd = $wrap.find(`#suggest-dd-${idx}`);
            const query = $input.val();

            clearTimeout(search_timeout);
            search_timeout = setTimeout(async () => {
                const comp = d.get_value("company") || default_company;
                try {
                    const r = await frappe.call({
                        method: "ashan_cn_procurement.services.procurement_picker_service.search_picker_items",
                        args: { query: query, company: comp },
                    });
                    const items = (r && r.message && r.message.items) || [];
                    let dd_html = "";
                    items.forEach((it) => {
                        dd_html += `
                            <div class="picker-suggest-item" data-code="${frappe.utils.escape_html(it.item_code)}" data-name="${frappe.utils.escape_html(it.item_name)}" data-rate="${it.rate}" data-uom="${it.uom}" data-tax="${it.tax_rate}">
                                <div class="picker-suggest-main">
                                    <span class="picker-suggest-code">${frappe.utils.escape_html(it.item_code)}</span>
                                    <span class="picker-suggest-name">${frappe.utils.escape_html(it.item_name)} (${it.uom})</span>
                                </div>
                                <div class="picker-suggest-price">¥ ${flt(it.rate).toFixed(2)}</div>
                            </div>
                        `;
                    });

                    dd_html += `
                        <div class="picker-suggest-create-btn" id="modal-create-new-item-btn">
                            <span>新建物料 (Create Item)</span>
                        </div>
                    `;

                    $dd.html(dd_html).addClass("is-open");

                    // Direct Fixed positioning on top of the viewport
                    const input_el = $input[0];
                    if (input_el) {
                        const rect = input_el.getBoundingClientRect();
                        $dd.css({
                            top: (rect.bottom + 2) + "px",
                            left: rect.left + "px",
                            width: Math.max(rect.width, 380) + "px",
                        });
                    }
                } catch (err) {
                    console.error("Autocomplete search error", err);
                }
            }, 250);
        });

        // Close dropdown when scrolling modal body
        $wrap.closest(".modal-body").off("scroll.picker_suggest").on("scroll.picker_suggest", () => {
            $wrap.find(".picker-suggest-dropdown.is-open").removeClass("is-open");
        });

        // Select an item from dropdown
        $wrap.on("click", ".picker-suggest-item", function () {
            const $tr = $(this).closest("tr");
            const idx = parseInt($tr.attr("data-idx"));
            const code = $(this).attr("data-code");
            const name = $(this).attr("data-name");
            const uom = $(this).attr("data-uom");
            const rate = flt($(this).attr("data-rate"));
            const tax = flt($(this).attr("data-tax")) || 13.0;

            rows_data[idx].item_code = code;
            rows_data[idx].item_name = name;
            rows_data[idx].spec = uom || "";
            rows_data[idx].rate = rate;
            rows_data[idx].tax_rate = tax;

            $wrap.find(".picker-suggest-dropdown").removeClass("is-open");
            render_rows(d);
        });

        // Quick create item click
        $wrap.on("click", "#modal-create-new-item-btn", function () {
            $wrap.find(".picker-suggest-dropdown").removeClass("is-open");
            frappe.new_doc("Item");
        });

        // Close dropdown when clicking outside
        $(document).off("click.picker_suggest").on("click.picker_suggest", (e) => {
            if (!$(e.target).closest(".picker-suggest-wrapper").length && !$(e.target).closest(".picker-suggest-dropdown").length) {
                $wrap.find(".picker-suggest-dropdown").removeClass("is-open");
            }
        });

        // Live text and calculation event bindings
        $wrap.on("input change", ".modal-input-code", function () {
            const idx = parseInt($(this).closest("tr").attr("data-idx"));
            if (rows_data[idx]) {
                rows_data[idx].item_code = $(this).val().trim();
            }
        });

        $wrap.on("input change", ".modal-input-name", function () {
            const idx = parseInt($(this).closest("tr").attr("data-idx"));
            rows_data[idx].item_name = $(this).val();
        });

        $wrap.on("input change", ".modal-input-spec", function () {
            const idx = parseInt($(this).closest("tr").attr("data-idx"));
            rows_data[idx].spec = $(this).val();
        });

        $wrap.on("input change", ".modal-input-remarks", function () {
            const idx = parseInt($(this).closest("tr").attr("data-idx"));
            const val = $(this).val();
            rows_data[idx].description = val;
            rows_data[idx].remarks = val;
            rows_data[idx].custom_line_remark = val;
        });

        $wrap.on("input change", ".modal-input-qty", function () {
            recalculate_and_sync_row($(this).closest("tr"), "qty", $wrap);
        });

        $wrap.on("input change", ".modal-input-rate", function () {
            recalculate_and_sync_row($(this).closest("tr"), "rate", $wrap);
        });

        $wrap.on("input change", ".modal-input-amount", function () {
            recalculate_and_sync_row($(this).closest("tr"), "amount", $wrap);
        });

        $wrap.on("input change", ".modal-input-tax-rate", function () {
            recalculate_and_sync_row($(this).closest("tr"), "tax_rate", $wrap);
        });

        $wrap.on("input change", ".modal-input-tax-amount", function () {
            recalculate_and_sync_row($(this).closest("tr"), "tax_amount", $wrap);
        });

        $wrap.on("input change", ".modal-input-total-amount", function () {
            recalculate_and_sync_row($(this).closest("tr"), "total_amount", $wrap);
        });
    }

    validate_and_get_dialog_values(dialog, required_fields) {
        const vals = dialog.get_values(true) || {};
        const missing = [];

        (required_fields || []).forEach((f) => {
            const fieldname = typeof f === "string" ? f : f.fieldname;
            const label = typeof f === "string" ? (dialog.get_field(fieldname)?.df?.label || fieldname) : f.label;
            const val = vals[fieldname];
            if (val === undefined || val === null || (typeof val === "string" && !val.trim())) {
                missing.push({ fieldname, label });
            }
        });

        if (missing.length) {
            missing.forEach((m) => {
                const fld = dialog.get_field(m.fieldname);
                if (fld && fld.$wrapper) {
                    fld.$wrapper.addClass("ashan-field-flash-error");
                    setTimeout(() => {
                        fld.$wrapper.removeClass("ashan-field-flash-error");
                    }, 2600);
                }
            });

            const first_field = dialog.get_field(missing[0].fieldname);
            if (first_field) {
                if (first_field.$input) {
                    first_field.$input.focus();
                    if (first_field.awesomplete && typeof first_field.awesomplete.close === "function") {
                        first_field.awesomplete.close();
                    }
                    setTimeout(() => {
                        if (first_field.awesomplete && typeof first_field.awesomplete.close === "function") {
                            first_field.awesomplete.close();
                        }
                    }, 80);
                } else if (first_field.$wrapper) {
                    first_field.$wrapper.find("input, select, textarea").focus();
                }
            }

            frappe.msgprint({
                title: __("请填写必填项"),
                message: __("以下必填项尚未填写，请补充完整：<br><br>• <strong style='color:#dc2626; font-size:13px;'>{0}</strong>", [
                    missing.map((m) => m.label).join("、")
                ]),
                indicator: "orange"
            });
            return null;
        }

        return vals;
    }

    format_doc_status(doctype, status, docstatus, r) {
        status = (status || "").trim();
        if (docstatus === 0 || status === "Draft") {
            return `<span class="ashan-status-badge ashan-status-amber">待提交草稿</span>`;
        }
        if (docstatus === 2 || status === "Cancelled") {
            return `<span class="ashan-status-badge ashan-status-gray">已作废</span>`;
        }

        const STATUS_MAP = {
            // Purchase Order & Receipt Statuses
            "To Receive and Bill": { label: "待收货待开票", cls: "ashan-status-blue" },
            "To Receive": { label: "待收货入库", cls: "ashan-status-blue" },
            "To Bill": { label: "待开票结算", cls: "ashan-status-purple" },
            "Completed": { label: "已完成", cls: "ashan-status-green" },
            "Submitted": { label: "已生效", cls: "ashan-status-green" },
            "Closed": { label: "已关闭", cls: "ashan-status-gray" },
            "Stopped": { label: "已停止", cls: "ashan-status-red" },
            "On Hold": { label: "挂起中", cls: "ashan-status-amber" },
            "Delivered": { label: "已交付", cls: "ashan-status-green" },

            // Workflow Statuses
            "Draft": { label: "待提交草稿", cls: "ashan-status-amber" },
            "Pending": { label: "待处理", cls: "ashan-status-amber" },
            "Ordered": { label: "已订购", cls: "ashan-status-green" },
            "Issued": { label: "已发料", cls: "ashan-status-green" },
            "Transferred": { label: "已调拨", cls: "ashan-status-blue" },
            "Approved": { label: "已核准", cls: "ashan-status-green" },
            "Rejected": { label: "已驳回", cls: "ashan-status-red" },

            // Payment / Claim Statuses
            "Paid": { label: "已付款", cls: "ashan-status-green" },
            "Unpaid": { label: "待付款", cls: "ashan-status-red" },
            "未付款": { label: "待付款", cls: "ashan-status-red" },
            "已付款": { label: "已付款", cls: "ashan-status-green" },
            "Partly Paid": { label: "部分付款", cls: "ashan-status-amber" },
            "部分付款": { label: "部分付款", cls: "ashan-status-amber" },
            "Overdue": { label: "已逾期", cls: "ashan-status-red" },
        };

        const conf = STATUS_MAP[status];
        if (conf) {
            return `<span class="ashan-status-badge ${conf.cls}">${conf.label}</span>`;
        }

        return `<span class="ashan-status-badge ashan-status-blue">${frappe.utils.escape_html(status || "已生效")}</span>`;
    }

    format_payment_status(r) {
        if (r && r.docstatus === 0) {
            return `<span class="ashan-status-badge ashan-status-amber">待提交草稿</span>`;
        }
        const outstanding = flt(r?.outstanding_amount);
        const paid = flt(r?.paid_amount);
        if (outstanding <= 0.0001) {
            return `<span class="ashan-status-badge ashan-status-green">已结清</span>`;
        }
        if (paid > 0.0001) {
            return `<span class="ashan-status-badge ashan-status-blue">部分付款</span>`;
        }
        return `<span class="ashan-status-badge ashan-status-amber">待付款</span>`;
    }

    async execute_primary_action() {
        const stage = this.active_stage;
        const mode = this.view_modes[stage] || "detail";
        const selected_items = Array.from(this.selected_map.values());
        if (!selected_items.length) {
            frappe.msgprint(__("请至少选择一项记录。"));
            return;
        }

        const target_comp = this.locked_company || (this.active_company !== "All" ? this.active_company : selected_items[0].company);

        if (stage === "mr_to_po") {
            await this.open_create_po_from_mr_dialog(selected_items, target_comp);
        } else if (stage === "po_to_pr") {
            this.open_create_pr_from_po_dialog(selected_items, target_comp);
        } else if (stage === "pr_to_pi") {
            this.open_create_pi_from_pr_dialog(selected_items, target_comp);
        } else if (stage === "pi_to_rr") {
            this.open_create_rr_from_pi_dialog(selected_items, target_comp);
        } else if (stage === "pi_to_pay") {
            this.open_create_payment_entry_dialog(selected_items, target_comp);
        }
    }

    show_generation_success_dialog(doc_title, docs_created, route_prefix) {
        if (!docs_created || !docs_created.length) return;
        const self = this;

        const dt_map = {
            "purchase-order": "Purchase Order",
            "purchase-receipt": "Purchase Receipt",
            "purchase-invoice": "Purchase Invoice",
            "reimbursement-request": "Reimbursement Request",
        };
        const dt_name = dt_map[route_prefix] || "Purchase Order";

        let items_html = docs_created
            .map(
                (d) => `
            <div class="picker-dialog-doc-item">
                <div class="picker-dialog-doc-main">
                    <span class="picker-source-docname picker-doc-clickable-link" data-doctype="${dt_name}" data-name="${frappe.utils.escape_html(d.name)}" title="点击就地弹窗查看与修改">
                        <strong>${frappe.utils.escape_html(d.name)}</strong>
                    </span>
                    ${d.supplier ? `<span class="picker-summary-highlight">(${frappe.utils.escape_html(d.supplier)})</span>` : ''}
                    ${d.company ? `<span class="picker-company-badge">[${frappe.utils.escape_html(d.company)}]</span>` : ''}
                </div>
                <div class="picker-dialog-doc-stats">
                    <span>数量: <strong>${d.total_qty || d.item_count}</strong></span>
                    ${d.grand_total ? `<span>金额: <strong>${this.fmt_money(d.grand_total)}</strong></span>` : ''}
                </div>
            </div>
        `
            )
            .join("");

        const d = new frappe.ui.Dialog({
            title: __("成功生成 {0} 张{1}", [docs_created.length, doc_title]),
            fields: [
                {
                    fieldtype: "HTML",
                    fieldname: "result_html",
                    options: `
                        <div class="picker-dialog-desc">
                            已成功为您生成以下单据，您可以点击单号就地弹窗查看与修改：
                        </div>
                        <div class="picker-dialog-list">
                            ${items_html}
                        </div>
                    `,
                },
            ],
            primary_action_label: __("查看第一张单据"),
            primary_action: () => {
                d.hide();
                self.show_doc_detail_modal(dt_name, docs_created[0].name);
            },
        });

        d.show();

        d.$wrapper.on("click", ".picker-doc-clickable-link", function (e) {
            e.preventDefault();
            const dt = $(this).attr("data-doctype");
            const nm = $(this).attr("data-name");
            d.hide();
            self.show_doc_detail_modal(dt, nm);
        });
    }

    async show_doc_detail_modal(doctype, name) {
        if (!doctype || !name) return;
        frappe.dom.freeze(__("正在加载单据详情..."));
        try {
            const r = await frappe.call({
                method: "ashan_cn_procurement.services.procurement_picker_service.get_document_details",
                args: { doctype: doctype, name: name },
            });
            frappe.dom.unfreeze();
            if (!r || !r.message) return;
            const doc = r.message;
            this.render_doc_detail_dialog(doc);
        } catch (e) {
            frappe.dom.unfreeze();
            frappe.msgprint(e.message || __("加载单据失败"));
        }
    }

    render_doc_detail_dialog(doc) {
        const self = this;
        const is_draft = Number(doc.docstatus) === 0;
        const can_edit_draft = is_draft && Boolean(doc.can_quick_edit) && Boolean(doc.can_write);
        const can_delete_draft = is_draft && Boolean(doc.can_delete);
        const form_button_label = is_draft && Boolean(doc.can_write) ? "编辑草稿" : "查看完整单据";
        const doctype_labels = {
            "Material Request": "采购申请单",
            "Purchase Order": "采购订单",
            "Purchase Receipt": "采购入库单",
            "Purchase Invoice": "采购发票",
            "Reimbursement Request": "整算单",
            "Payment Entry": "付款凭证",
        };
        const dt_label = doctype_labels[doc.doctype] || doc.doctype;

        // Calculate totals and build item rows
        let sum_qty = 0;
        let sum_amount = 0;
        let sum_tax_amount = 0;
        let sum_total_amount = 0;
        let items_tbody_html = "";

        (doc.items || []).forEach((it) => {
            const q = flt(it.qty);
            const amt = flt(it.amount);
            const t_amt = flt(it.tax_amount);
            const tot = flt(it.total_amount) || (amt + t_amt);

            sum_qty += q;
            sum_amount += amt;
            sum_tax_amount += t_amt;
            sum_total_amount += tot;

            items_tbody_html += `
                <tr>
                    <td class="picker-cell-center">${it.idx}</td>
                    <td><strong>${frappe.utils.escape_html(it.item_code)}</strong></td>
                    <td>${frappe.utils.escape_html(it.item_name)}</td>
                    <td>${frappe.utils.escape_html(it.spec || "-")}</td>
                    <td class="picker-cell-center">${frappe.utils.escape_html(it.uom || "-")}</td>
                    <td class="picker-qty-cell"><strong>${q.toFixed(2)}</strong></td>
                    <td class="picker-money-cell">${self.fmt_money(it.rate)}</td>
                    <td class="picker-money-cell">${self.fmt_money(amt)}</td>
                    <td class="picker-cell-right">${it.tax_rate ? (it.tax_rate + '%') : '-'}</td>
                    <td class="picker-money-cell">${self.fmt_money(t_amt)}</td>
                    <td class="picker-money-cell"><strong>${self.fmt_money(tot)}</strong></td>
                    <td>${frappe.utils.escape_html(it.description || "-")}</td>
                </tr>
            `;
        });

        if (!items_tbody_html) {
            items_tbody_html = `<tr><td colspan="12" class="picker-doc-empty-state">无明细数据</td></tr>`;
        }

        const tfoot_html = (doc.items && doc.items.length) ? `
            <tfoot>
                <tr>
                    <td colspan="5" class="picker-cell-right">合计汇总:</td>
                    <td class="picker-qty-cell">${sum_qty.toFixed(2)}</td>
                    <td></td>
                    <td class="picker-money-cell">${self.fmt_money(sum_amount)}</td>
                    <td></td>
                    <td class="picker-money-cell">${self.fmt_money(sum_tax_amount)}</td>
                    <td class="picker-money-cell picker-total-highlight">${self.fmt_money(sum_total_amount || doc.grand_total)}</td>
                    <td></td>
                </tr>
            </tfoot>
        ` : '';

        // Build upstream flow items
        let upstream_html = "";
        (doc.linked_upstream || []).forEach((u) => {
            const status_badge = self.format_doc_status(u.doctype, u.status, u.docstatus, u);
            upstream_html += `
                <span class="picker-doc-flow-item upstream picker-doc-modal-link" data-doctype="${u.doctype}" data-name="${u.name}" title="点击就地查看详情">
                    <span>${u.doctype_label}:</span>
                    <strong>${frappe.utils.escape_html(u.name)}</strong>
                    ${status_badge}
                </span>
            `;
        });

        // Build downstream flow items
        let downstream_html = "";
        (doc.linked_downstream || []).forEach((d) => {
            const status_badge = self.format_doc_status(d.doctype, d.status, d.docstatus, d);
            downstream_html += `
                <span class="picker-doc-flow-item downstream picker-doc-modal-link" data-doctype="${d.doctype}" data-name="${d.name}" title="点击就地查看详情">
                    <span>${d.doctype_label}:</span>
                    <strong>${frappe.utils.escape_html(d.name)}</strong>
                    ${status_badge}
                </span>
            `;
        });

        const flow_section_html = (upstream_html || downstream_html) ? `
            <div class="picker-doc-flow-card">
                <div class="picker-doc-flow-title">上下游业务全链路追溯（点击可就地平滑穿透查看）</div>
                <div class="picker-doc-flow-list">
                    ${upstream_html}
                    ${downstream_html}
                </div>
            </div>
        ` : `
            <div class="picker-doc-flow-card">
                <div class="picker-doc-flow-title picker-flow-empty-hint">当前单据无关联上下游单据（独立单据）</div>
            </div>
        `;

        const comp_badge_cls = (doc.company || "").includes("祺富") ? "picker-company-badge-qifu" : "picker-company-badge-jizhong";
        const main_status_badge = self.format_doc_status(doc.doctype, doc.status, doc.docstatus, doc);

        const modal_content = `
            <div class="picker-doc-modal-container">
                <!-- Meta Info Card -->
                <div class="picker-doc-meta-card">
                    <div class="picker-doc-meta-header">
                        <div class="picker-doc-title-box">
                            <span class="picker-doc-title-text">${dt_label}: ${frappe.utils.escape_html(doc.name)}</span>
                            <span class="picker-company-badge ${comp_badge_cls}">${frappe.utils.escape_html(doc.company)}</span>
                            ${main_status_badge}
                        </div>
                        <div>
                            <span class="picker-meta-owner-text">录单人: ${frappe.utils.escape_html(doc.owner || "-")}</span>
                        </div>
                    </div>
                    <div class="picker-doc-meta-grid">
                        <div class="picker-doc-meta-item">
                            <span class="picker-doc-meta-label">单据日期</span>
                            <span class="picker-doc-meta-val">${doc.date || "-"}</span>
                        </div>
                        <div class="picker-doc-meta-item">
                            <span class="picker-doc-meta-label">${doc.supplier ? '供应商' : '需求部门'}</span>
                            <span class="picker-doc-meta-val">${frappe.utils.escape_html(doc.supplier || doc.department || "-")}</span>
                        </div>
                        <div class="picker-doc-meta-item">
                            <span class="picker-doc-meta-label">物料总数量</span>
                            <span class="picker-doc-meta-val">${doc.total_qty}</span>
                        </div>
                        <div class="picker-doc-meta-item">
                            <span class="picker-doc-meta-label">单据总金额</span>
                            <span class="picker-doc-meta-val picker-meta-val-highlight">${self.fmt_money(doc.grand_total)}</span>
                        </div>
                    </div>
                </div>

                <!-- Items Table -->
                <div class="picker-doc-table-box">
                    <table class="picker-doc-modal-table">
                        <thead>
                            <tr>
                                <th class="picker-cell-col-idx">#</th>
                                <th>物料代码</th>
                                <th>物料名称</th>
                                <th>规格</th>
                                <th>单位</th>
                                <th class="picker-cell-right">数量</th>
                                <th class="picker-cell-right">单价</th>
                                <th class="picker-cell-right">金额</th>
                                <th class="picker-cell-right">税率</th>
                                <th class="picker-cell-right">税额</th>
                                <th class="picker-cell-right">价税合计</th>
                                <th>备注</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${items_tbody_html}
                        </tbody>
                        ${tfoot_html}
                    </table>
                </div>

                <!-- Flow Traceability -->
                ${flow_section_html}

                <!-- Action Toolbar -->
                <div class="picker-modal-footer-bar">
                    <div>
                        ${can_delete_draft ? `
                            <button class="picker-btn-danger-del" id="picker-modal-del-btn">
                                删除草稿
                            </button>
                        ` : ''}
                    </div>
                    <div class="picker-modal-actions-right">
                        ${can_edit_draft ? `
                            <button class="picker-btn-action-view" id="picker-modal-edit-btn">
                                编辑草稿
                            </button>
                        ` : ''}
                        <button class="picker-btn-action-view" id="picker-modal-print-btn">
                            打印单据
                        </button>
                        <button class="picker-btn-action-view" id="picker-modal-goto-form-btn">
                            ${form_button_label}
                        </button>
                        <button class="picker-btn-action-view" id="picker-modal-close-btn">
                            关闭
                        </button>
                    </div>
                </div>
            </div>
        `;

        const d = new frappe.ui.Dialog({
            title: __("单据详情与操作 · {0} {1}", [dt_label, doc.name]),
            fields: [
                {
                    fieldtype: "HTML",
                    fieldname: "detail_html",
                    options: modal_content,
                }
            ],
            size: "large",
            static: is_draft,
        });

        d.$wrapper.addClass("picker-doc-detail-modal");
        d.show();

        const $w = d.$wrapper;
        if (is_draft) {
            $w.attr("data-backdrop", "static").attr("data-keyboard", "false");
        }

        $w.on("click", "#picker-modal-close-btn", function () {
            d.hide();
        });

        // Goto Form page button
        $w.on("click", "#picker-modal-goto-form-btn", function () {
            d.hide();
            frappe.set_route("Form", doc.doctype, doc.name);
        });

        // Edit button inside modal
        $w.on("click", "#picker-modal-edit-btn", function () {
            if (doc.doctype === "Material Request") {
                self.open_edit_mr_dialog(doc, d);
            } else if (doc.doctype === "Purchase Order") {
                self.open_edit_po_dialog(doc, d);
            }
        });

        // Flow link clicks inside modal
        $w.on("click", ".picker-doc-modal-link", function () {
            const dt = $(this).attr("data-doctype");
            const nm = $(this).attr("data-name");
            d.hide();
            self.show_doc_detail_modal(dt, nm);
        });

        // Print button
        $w.on("click", "#picker-modal-print-btn", function () {
            const print_url = `/printview?doctype=${encodeURIComponent(doc.doctype)}&name=${encodeURIComponent(doc.name)}&format=Standard&trigger_print=1`;
            window.open(print_url, "_blank");
        });

        // Delete button
        $w.on("click", "#picker-modal-del-btn", function () {
            self.handle_document_deletion(doc.doctype, doc.name, d);
        });
    }

    open_edit_mr_dialog(doc, parent_dialog) {
        const default_company = doc.company || this.companies[0] || "";
        const default_schedule_date = doc.schedule_date || frappe.datetime.add_months(frappe.datetime.nowdate(), 1);
        let rows_data = [];

        (doc.items || []).forEach((it) => {
            rows_data.push({
                item_code: it.item_code || "",
                item_name: it.item_name || "",
                spec: it.custom_item_spec || it.spec || "",
                qty: flt(it.qty) || 1.0,
                rate: flt(it.rate) || 0.0,
                amount: flt(it.amount) || 0.0,
                tax_rate: flt(it.custom_tax_rate !== undefined ? it.custom_tax_rate : (it.tax_rate !== undefined ? it.tax_rate : 13.0)),
                tax_amount: flt(it.custom_tax_amount !== undefined ? it.custom_tax_amount : (it.tax_amount || 0.0)),
                total_amount: flt(it.custom_total_amount !== undefined ? it.custom_total_amount : (it.total_amount || 0.0)),
                description: it.description || "",
            });
        });

        if (!rows_data.length) {
            rows_data.push({
                item_code: "",
                item_name: "",
                spec: "",
                qty: 1.0,
                rate: 0.0,
                amount: 0.0,
                tax_rate: 13.0,
                tax_amount: 0.0,
                total_amount: 0.0,
                description: "",
            });
        }

        const recalculate_row_state = (r) => {
            const qty = flt(r.qty) || 0.0;
            const rate = flt(r.rate) || 0.0;
            r.amount = Math.round(qty * rate * 100) / 100;
            const tax_pct = flt(r.tax_rate) || 0.0;
            r.tax_amount = Math.round(r.amount * (tax_pct / 100.0) * 100) / 100;
            r.total_amount = Math.round((r.amount + r.tax_amount) * 100) / 100;
        };

        const update_bottom_summary = ($wrapper) => {
            let sum_qty = 0;
            let sum_amount = 0;
            let sum_tax = 0;
            let sum_total = 0;
            rows_data.forEach((r) => {
                sum_qty += flt(r.qty);
                sum_amount += flt(r.amount);
                sum_tax += flt(r.tax_amount);
                sum_total += flt(r.total_amount);
            });
            $wrapper.find("#modal-sum-qty").text(sum_qty.toFixed(2));
            $wrapper.find("#modal-sum-amt").text(this.fmt_money(sum_amount));
            $wrapper.find("#modal-sum-tax").text(this.fmt_money(sum_tax));
            $wrapper.find("#modal-sum-total").text(this.fmt_money(sum_total));
        };

        const recalculate_and_sync_row = ($tr, field_changed, $wrap) => {
            const idx = parseInt($tr.attr("data-idx"));
            const r = rows_data[idx];
            if (!r) return;

            let qty = flt($tr.find(".modal-input-qty").val());
            if (isNaN(qty) || qty < 0) qty = 0;

            let rate = flt($tr.find(".modal-input-rate").val());
            if (isNaN(rate) || rate < 0) rate = 0;

            let amount = flt($tr.find(".modal-input-amount").val());
            if (isNaN(amount) || amount < 0) amount = 0;

            let tax_rate = flt($tr.find(".modal-input-tax-rate").val());
            if (isNaN(tax_rate) || tax_rate < 0) tax_rate = 0;

            let tax_amount = flt($tr.find(".modal-input-tax-amount").val());
            if (isNaN(tax_amount) || tax_amount < 0) tax_amount = 0;

            let total_amount = flt($tr.find(".modal-input-total-amount").val());
            if (isNaN(total_amount) || total_amount < 0) total_amount = 0;

            if (field_changed === "qty" || field_changed === "rate") {
                amount = Math.round(qty * rate * 100) / 100;
                tax_amount = Math.round(amount * (tax_rate / 100.0) * 100) / 100;
                total_amount = Math.round((amount + tax_amount) * 100) / 100;
                $tr.find(".modal-input-amount").val(amount.toFixed(2));
                $tr.find(".modal-input-tax-amount").val(tax_amount.toFixed(2));
                $tr.find(".modal-input-total-amount").val(total_amount.toFixed(2));
            } else if (field_changed === "tax_rate") {
                tax_amount = Math.round(amount * (tax_rate / 100.0) * 100) / 100;
                total_amount = Math.round((amount + tax_amount) * 100) / 100;
                $tr.find(".modal-input-tax-amount").val(tax_amount.toFixed(2));
                $tr.find(".modal-input-total-amount").val(total_amount.toFixed(2));
            } else if (field_changed === "amount") {
                if (qty > 0) {
                    rate = Math.round((amount / qty) * 10000) / 10000;
                    $tr.find(".modal-input-rate").val(rate);
                }
                tax_amount = Math.round(amount * (tax_rate / 100.0) * 100) / 100;
                total_amount = Math.round((amount + tax_amount) * 100) / 100;
                $tr.find(".modal-input-tax-amount").val(tax_amount.toFixed(2));
                $tr.find(".modal-input-total-amount").val(total_amount.toFixed(2));
            } else if (field_changed === "tax_amount") {
                total_amount = Math.round((amount + tax_amount) * 100) / 100;
                if (amount > 0) {
                    tax_rate = Math.round((tax_amount / amount) * 10000) / 100;
                    $tr.find(".modal-input-tax-rate").val(tax_rate);
                }
                $tr.find(".modal-input-total-amount").val(total_amount.toFixed(2));
            } else if (field_changed === "total_amount") {
                amount = Math.round((total_amount / (1 + tax_rate / 100.0)) * 100) / 100;
                tax_amount = Math.round((total_amount - amount) * 100) / 100;
                if (qty > 0) {
                    rate = Math.round((amount / qty) * 10000) / 10000;
                    $tr.find(".modal-input-rate").val(rate);
                }
                $tr.find(".modal-input-amount").val(amount.toFixed(2));
                $tr.find(".modal-input-tax-amount").val(tax_amount.toFixed(2));
            }

            r.qty = qty;
            r.rate = rate;
            r.amount = amount;
            r.tax_rate = tax_rate;
            r.tax_amount = tax_amount;
            r.total_amount = total_amount;

            update_bottom_summary($wrap);
        };

        const render_rows = (dialog) => {
            const $wrapper = dialog.get_field("items_html").$wrapper;
            const $tbody = $wrapper.find("#picker-modal-item-tbody");
            $tbody.empty();

            rows_data.forEach((r, idx) => {
                recalculate_row_state(r);

                const tr = `
                    <tr data-idx="${idx}">
                        <td class="picker-cell-col-idx">${idx + 1}</td>
                        <td>
                            <div class="picker-suggest-wrapper">
                                <input type="text" class="modal-input-code" placeholder="输入物料代码..." value="${frappe.utils.escape_html(r.item_code || '')}">
                                <div class="picker-suggest-dropdown" id="suggest-dd-${idx}"></div>
                            </div>
                        </td>
                        <td>
                            <input type="text" class="modal-input-name modal-input-readonly" readonly tabindex="-1" placeholder="自动带出物料名称..." value="${frappe.utils.escape_html(r.item_name || '')}">
                        </td>
                        <td>
                            <input type="text" class="modal-input-spec modal-input-readonly" readonly tabindex="-1" placeholder="自动带出规格..." value="${frappe.utils.escape_html(r.spec || '')}">
                        </td>
                        <td>
                            <input type="number" step="any" min="0" class="modal-input-qty" value="${r.qty}">
                        </td>
                        <td>
                            <input type="number" step="any" min="0" class="modal-input-rate" value="${r.rate}">
                        </td>
                        <td>
                            <input type="number" step="any" min="0" class="modal-input-amount" value="${flt(r.amount).toFixed(2)}">
                        </td>
                        <td>
                            <input type="number" step="any" min="0" max="100" class="modal-input-tax-rate" value="${r.tax_rate}">
                        </td>
                        <td>
                            <input type="number" step="any" min="0" class="modal-input-tax-amount" value="${flt(r.tax_amount).toFixed(2)}">
                        </td>
                        <td>
                            <input type="number" step="any" min="0" class="modal-input-total-amount" value="${flt(r.total_amount).toFixed(2)}">
                        </td>
                        <td>
                            <input type="text" class="modal-input-remarks" placeholder="备注说明..." value="${frappe.utils.escape_html(r.remarks || r.description || '')}">
                        </td>
                        <td class="picker-modal-cell-center">
                            <button class="picker-modal-del-btn" data-idx="${idx}">删除</button>
                        </td>
                    </tr>
                `;
                $tbody.append(tr);
            });

            update_bottom_summary($wrapper);
        };

        const d = new frappe.ui.Dialog({
            title: __("修改物料申请单 · {0}", [doc.name]),
            fields: [
                {
                    fieldtype: "Select",
                    fieldname: "company",
                    label: __("所属公司"),
                    options: this.companies.join("\n"),
                    default: default_company,
                    reqd: 1,
                },
                {
                    fieldtype: "Date",
                    fieldname: "schedule_date",
                    label: __("期望到货日期"),
                    default: default_schedule_date,
                    reqd: 1,
                },
                {
                    fieldtype: "Section Break",
                    label: __("申请物料明细与税额核算 (任意修改)"),
                },
                {
                    fieldtype: "HTML",
                    fieldname: "items_html",
                    options: `
                        <div>
                            <div class="picker-modal-item-table-wrap">
                                <table class="picker-modal-item-table picker-table-12cols">
                                    <thead>
                                        <tr>
                                            <th>#</th>
                                            <th>物料代码</th>
                                            <th>物料名称</th>
                                            <th>规格</th>
                                            <th>数量</th>
                                            <th>参考单价</th>
                                            <th>不含税金额</th>
                                            <th>税率 %</th>
                                            <th>税额</th>
                                            <th>含税总价</th>
                                            <th>备注</th>
                                            <th>操作</th>
                                        </tr>
                                    </thead>
                                    <tbody id="picker-modal-item-tbody"></tbody>
                                </table>
                            </div>
                            <button class="picker-modal-add-btn" id="picker-modal-add-row-btn">添加物料</button>

                            <div class="picker-modal-summary-bar">
                                <span>合计汇总:</span>
                                <div class="picker-modal-summary-items">
                                    <span>申请总数: <strong id="modal-sum-qty" class="picker-summary-highlight">0</strong></span>
                                    <span>不含税金额: <strong id="modal-sum-amt" class="picker-summary-highlight">¥ 0.00</strong></span>
                                    <span>税额: <strong id="modal-sum-tax" class="picker-summary-highlight">¥ 0.00</strong></span>
                                    <span>含税总额: <strong id="modal-sum-total" class="picker-summary-highlight">¥ 0.00</strong></span>
                                </div>
                            </div>
                        </div>
                    `,
                },
            ],
            primary_action_label: __("保存修改并正式发布"),
            primary_action: async () => {
                const vals = this.validate_and_get_dialog_values(d, [
                    { fieldname: "company", label: "所属公司" },
                    { fieldname: "schedule_date", label: "期望到货日期" },
                ]);
                if (!vals) return;

                const valid_items = rows_data.filter((r) => (r.item_code || "").trim().length > 0);
                if (!valid_items.length) {
                    frappe.msgprint(__("请至少保留一行有效的物料代码。"));
                    return;
                }

                try {
                    frappe.dom.freeze(__("正在更新采购申请单..."));
                    const res = await frappe.call({
                        method: "ashan_cn_procurement.services.procurement_picker_service.update_quick_material_request",
                        args: {
                            name: doc.name,
                            company: vals.company,
                            schedule_date: vals.schedule_date,
                            items: valid_items,
                        },
                    });
                    frappe.dom.unfreeze();
                    if (res && res.message && res.message.success) {
                        d.hide();
                        if (parent_dialog) parent_dialog.hide();
                        frappe.show_alert({
                            message: __("成功更新并正式发布采购申请单：{0}", [doc.name]),
                            indicator: "green",
                        });
                        this.refresh_all();
                    }
                } catch (e) {
                    frappe.dom.unfreeze();
                    frappe.msgprint(e.message || __("更新采购申请单失败"));
                }
            },
        });

        d.set_secondary_action_label(__("✕ 关闭"));
        d.set_secondary_action(() => {
            d.hide();
        });

        d.$wrapper.addClass("picker-create-mr-modal");
        d.show();

        d.$wrapper.attr("data-backdrop", "static").attr("data-keyboard", "false");
        d.$wrapper.on("click", function (e) {
            if ($(e.target).hasClass("modal") || $(e.target).hasClass("modal-backdrop")) {
                e.preventDefault();
                e.stopPropagation();
            }
        });
        render_rows(d);

        const $wrap = d.get_field("items_html").$wrapper;

        $wrap.on("click", "#picker-modal-add-row-btn", () => {
            rows_data.push({ item_code: "", item_name: "", spec: "", qty: 1.0, rate: 0.0, amount: 0.0, tax_rate: 13.0, tax_amount: 0.0, total_amount: 0.0, description: "" });
            render_rows(d);
        });

        $wrap.on("click", ".picker-modal-del-btn", function () {
            const idx = parseInt($(this).attr("data-idx"));
            rows_data.splice(idx, 1);
            if (!rows_data.length) rows_data.push({ item_code: "", item_name: "", spec: "", qty: 1.0, rate: 0.0, amount: 0.0, tax_rate: 13.0, tax_amount: 0.0, total_amount: 0.0, description: "" });
            render_rows(d);
        });

        // Autocomplete Search on item input
        let search_timeout = null;
        $wrap.on("input focus", ".modal-input-code", function () {
            const $input = $(this);
            const idx = parseInt($input.closest("tr").attr("data-idx"));
            const $dd = $wrap.find(`#suggest-dd-${idx}`);
            const query = $input.val();

            clearTimeout(search_timeout);
            search_timeout = setTimeout(async () => {
                const comp = d.get_value("company") || default_company;
                try {
                    const r = await frappe.call({
                        method: "ashan_cn_procurement.services.procurement_picker_service.search_picker_items",
                        args: { query: query, company: comp },
                    });
                    const items = (r && r.message && r.message.items) || [];
                    let dd_html = "";
                    items.forEach((it) => {
                        dd_html += `
                            <div class="picker-suggest-item" data-code="${frappe.utils.escape_html(it.item_code)}" data-name="${frappe.utils.escape_html(it.item_name)}" data-rate="${it.rate}" data-uom="${it.uom}" data-tax="${it.tax_rate}">
                                <div class="picker-suggest-main">
                                    <span class="picker-suggest-code">${frappe.utils.escape_html(it.item_code)}</span>
                                    <span class="picker-suggest-name">${frappe.utils.escape_html(it.item_name)} (${it.uom})</span>
                                </div>
                                <div class="picker-suggest-price">¥ ${flt(it.rate).toFixed(2)}</div>
                            </div>
                        `;
                    });

                    dd_html += `
                        <div class="picker-suggest-create-btn" id="modal-create-new-item-btn">
                            <span>新建物料 (Create Item)</span>
                        </div>
                    `;

                    $dd.html(dd_html).addClass("is-open");

                    // Direct Fixed positioning on top of the viewport
                    const input_el = $input[0];
                    if (input_el) {
                        const rect = input_el.getBoundingClientRect();
                        $dd.css({
                            top: (rect.bottom + 2) + "px",
                            left: rect.left + "px",
                            width: Math.max(rect.width, 380) + "px",
                        });
                    }
                } catch (err) {
                    console.error("Autocomplete search error", err);
                }
            }, 250);
        });

        // Close dropdown when scrolling modal body
        $wrap.closest(".modal-body").off("scroll.picker_suggest_edit").on("scroll.picker_suggest_edit", () => {
            $wrap.find(".picker-suggest-dropdown.is-open").removeClass("is-open");
        });

        // Select an item from dropdown
        $wrap.on("click", ".picker-suggest-item", function () {
            const $tr = $(this).closest("tr");
            const idx = parseInt($tr.attr("data-idx"));
            const code = $(this).attr("data-code");
            const name = $(this).attr("data-name");
            const uom = $(this).attr("data-uom");
            const rate = flt($(this).attr("data-rate"));
            const tax = flt($(this).attr("data-tax")) || 13.0;

            rows_data[idx].item_code = code;
            rows_data[idx].item_name = name;
            rows_data[idx].spec = uom || "";
            rows_data[idx].rate = rate;
            rows_data[idx].tax_rate = tax;

            $wrap.find(".picker-suggest-dropdown").removeClass("is-open");
            render_rows(d);
        });

        // Quick create item click
        $wrap.on("click", "#modal-create-new-item-btn", function () {
            $wrap.find(".picker-suggest-dropdown").removeClass("is-open");
            frappe.new_doc("Item");
        });

        // Close dropdown when clicking outside
        $(document).off("click.picker_suggest_edit").on("click.picker_suggest_edit", (e) => {
            if (!$(e.target).closest(".picker-suggest-wrapper").length && !$(e.target).closest(".picker-suggest-dropdown").length) {
                $wrap.find(".picker-suggest-dropdown").removeClass("is-open");
            }
        });

        // Live text and calculation event bindings
        $wrap.on("input change", ".modal-input-code", function () {
            const idx = parseInt($(this).closest("tr").attr("data-idx"));
            if (rows_data[idx]) {
                rows_data[idx].item_code = $(this).val().trim();
            }
        });

        $wrap.on("input change", ".modal-input-name", function () {
            const idx = parseInt($(this).closest("tr").attr("data-idx"));
            rows_data[idx].item_name = $(this).val();
        });

        $wrap.on("input change", ".modal-input-spec", function () {
            const idx = parseInt($(this).closest("tr").attr("data-idx"));
            rows_data[idx].spec = $(this).val();
        });

        $wrap.on("input change", ".modal-input-remarks", function () {
            const idx = parseInt($(this).closest("tr").attr("data-idx"));
            const val = $(this).val();
            rows_data[idx].description = val;
            rows_data[idx].remarks = val;
            rows_data[idx].custom_line_remark = val;
        });

        $wrap.on("input change", ".modal-input-qty", function () {
            recalculate_and_sync_row($(this).closest("tr"), "qty", $wrap);
        });

        $wrap.on("input change", ".modal-input-rate", function () {
            recalculate_and_sync_row($(this).closest("tr"), "rate", $wrap);
        });

        $wrap.on("input change", ".modal-input-amount", function () {
            recalculate_and_sync_row($(this).closest("tr"), "amount", $wrap);
        });

        $wrap.on("input change", ".modal-input-tax-rate", function () {
            recalculate_and_sync_row($(this).closest("tr"), "tax_rate", $wrap);
        });

        $wrap.on("input change", ".modal-input-tax-amount", function () {
            recalculate_and_sync_row($(this).closest("tr"), "tax_amount", $wrap);
        });

        $wrap.on("input change", ".modal-input-total-amount", function () {
            recalculate_and_sync_row($(this).closest("tr"), "total_amount", $wrap);
        });
    }

    open_edit_po_dialog(doc, parent_dialog) {
        const default_company = doc.company;
        const default_supplier = doc.supplier || "";
        const default_schedule_date = doc.schedule_date || doc.date || frappe.datetime.get_today();

        let rows_data = (doc.items || []).map((it) => ({
            item_code: it.item_code || "",
            item_name: it.item_name || "",
            spec: it.spec || "",
            qty: flt(it.qty) || 1.0,
            rate: flt(it.rate) || 0.0,
            amount: flt(it.amount) || flt(it.qty * it.rate) || 0.0,
            tax_rate: flt(it.tax_rate) || 13.0,
            tax_amount: flt(it.tax_amount) || 0.0,
            total_amount: flt(it.total_amount) || 0.0,
            description: it.description || "",
        }));

        if (!rows_data.length) {
            rows_data.push({ item_code: "", item_name: "", spec: "", qty: 1.0, rate: 0.0, amount: 0.0, tax_rate: 13.0, tax_amount: 0.0, total_amount: 0.0, description: "" });
        }

        const recalculate_row_state = (r) => {
            const qty = flt(r.qty) || 0.0;
            const rate = flt(r.rate) || 0.0;
            r.amount = Math.round(qty * rate * 100) / 100;
            const tax_pct = flt(r.tax_rate) || 0.0;
            r.tax_amount = Math.round(r.amount * (tax_pct / 100.0) * 100) / 100;
            r.total_amount = Math.round((r.amount + r.tax_amount) * 100) / 100;
        };

        const update_bottom_summary = ($wrapper) => {
            let total_qty = 0;
            let total_amt = 0;
            let total_tax = 0;
            let grand_total = 0;
            $wrapper.find("#picker-modal-item-tbody tr").each(function () {
                const q = flt($(this).find(".modal-input-qty").val()) || 0;
                const a = flt($(this).find(".modal-input-amount").val()) || 0;
                const tx = flt($(this).find(".modal-input-tax-amount").val()) || 0;
                const tot = flt($(this).find(".modal-input-total-amount").val()) || 0;
                total_qty += q;
                total_amt += a;
                total_tax += tx;
                grand_total += tot;
            });
            $wrapper.find("#modal-sum-qty").text(total_qty.toFixed(2));
            $wrapper.find("#modal-sum-amt").text(this.fmt_money(total_amt));
            $wrapper.find("#modal-sum-tax").text(this.fmt_money(total_tax));
            $wrapper.find("#modal-sum-total").text(this.fmt_money(grand_total));
        };

        const recalculate_and_sync_row = ($tr, field_changed, $wrapper) => {
            const idx = parseInt($tr.attr("data-idx"));
            const $qty = $tr.find(".modal-input-qty");
            const $rate = $tr.find(".modal-input-rate");
            const $amount = $tr.find(".modal-input-amount");
            const $tax_rate = $tr.find(".modal-input-tax-rate");
            const $tax_amount = $tr.find(".modal-input-tax-amount");
            const $total_amount = $tr.find(".modal-input-total-amount");

            let qty = flt($qty.val()) || 0.0;
            let rate = flt($rate.val()) || 0.0;
            let amount = flt($amount.val()) || 0.0;
            let tax_rate = flt($tax_rate.val()) || 0.0;
            let tax_amount = flt($tax_amount.val()) || 0.0;
            let total_amount = flt($total_amount.val()) || 0.0;

            if (field_changed === "qty" || field_changed === "rate") {
                amount = Math.round(qty * rate * 100) / 100;
                tax_amount = Math.round(amount * (tax_rate / 100.0) * 100) / 100;
                total_amount = Math.round((amount + tax_amount) * 100) / 100;
                $amount.val(amount.toFixed(2));
                $tax_amount.val(tax_amount.toFixed(2));
                $total_amount.val(total_amount.toFixed(2));
            } else if (field_changed === "tax_rate") {
                tax_amount = Math.round(amount * (tax_rate / 100.0) * 100) / 100;
                total_amount = Math.round((amount + tax_amount) * 100) / 100;
                $tax_amount.val(tax_amount.toFixed(2));
                $total_amount.val(total_amount.toFixed(2));
            } else if (field_changed === "amount") {
                if (qty > 0) {
                    rate = Math.round((amount / qty) * 10000) / 10000;
                    $rate.val(rate);
                }
                tax_amount = Math.round(amount * (tax_rate / 100.0) * 100) / 100;
                total_amount = Math.round((amount + tax_amount) * 100) / 100;
                $tax_amount.val(tax_amount.toFixed(2));
                $total_amount.val(total_amount.toFixed(2));
            } else if (field_changed === "tax_amount") {
                total_amount = Math.round((amount + tax_amount) * 100) / 100;
                $total_amount.val(total_amount.toFixed(2));
                if (amount > 0) {
                    tax_rate = Math.round((tax_amount / amount) * 10000) / 100;
                    $tax_rate.val(tax_rate);
                }
            } else if (field_changed === "total_amount") {
                amount = Math.round((total_amount / (1 + tax_rate / 100.0)) * 100) / 100;
                tax_amount = Math.round((total_amount - amount) * 100) / 100;
                if (qty > 0) {
                    rate = Math.round((amount / qty) * 10000) / 10000;
                    $rate.val(rate);
                }
                $amount.val(amount.toFixed(2));
                $tax_amount.val(tax_amount.toFixed(2));
            }

            if (rows_data[idx]) {
                rows_data[idx].qty = qty;
                rows_data[idx].rate = rate;
                rows_data[idx].amount = amount;
                rows_data[idx].tax_rate = tax_rate;
                rows_data[idx].tax_amount = tax_amount;
                rows_data[idx].total_amount = total_amount;
            }

            update_bottom_summary($wrapper);
        };

        const render_rows = (dialog) => {
            const $wrapper = dialog.get_field("items_html").$wrapper;
            const $tbody = $wrapper.find("#picker-modal-item-tbody");
            $tbody.empty();

            rows_data.forEach((r, idx) => {
                recalculate_row_state(r);
                const tr = `
                    <tr data-idx="${idx}">
                        <td class="picker-modal-cell-center">${idx + 1}</td>
                        <td class="picker-suggest-wrapper">
                            <input type="text" class="modal-input-code" placeholder="物料代码/搜索..." value="${frappe.utils.escape_html(r.item_code || '')}">
                            <div class="picker-suggest-dropdown" id="suggest-dd-po-edit-${idx}"></div>
                        </td>
                        <td>
                            <input type="text" class="modal-input-name" placeholder="物料名称..." value="${frappe.utils.escape_html(r.item_name || '')}">
                        </td>
                        <td>
                            <input type="text" class="modal-input-spec" placeholder="规格..." value="${frappe.utils.escape_html(r.spec || '')}">
                        </td>
                        <td>
                            <input type="number" step="any" min="0.0001" class="modal-input-qty" value="${r.qty}">
                        </td>
                        <td>
                            <input type="number" step="any" min="0" class="modal-input-rate" value="${r.rate}">
                        </td>
                        <td>
                            <input type="number" step="any" min="0" class="modal-input-amount" value="${flt(r.amount).toFixed(2)}">
                        </td>
                        <td>
                            <input type="number" step="any" min="0" max="100" class="modal-input-tax-rate" value="${r.tax_rate}">
                        </td>
                        <td>
                            <input type="number" step="any" min="0" class="modal-input-tax-amount" value="${flt(r.tax_amount).toFixed(2)}">
                        </td>
                        <td>
                            <input type="number" step="any" min="0" class="modal-input-total-amount" value="${flt(r.total_amount).toFixed(2)}">
                        </td>
                        <td>
                            <input type="text" class="modal-input-remarks" placeholder="备注说明..." value="${frappe.utils.escape_html(r.remarks || r.description || '')}">
                        </td>
                        <td class="picker-modal-cell-center">
                            <button class="picker-modal-del-btn" data-idx="${idx}">删除</button>
                        </td>
                    </tr>
                `;
                $tbody.append(tr);
            });

            update_bottom_summary($wrapper);
        };

        const d = new frappe.ui.Dialog({
            title: __("修改采购订单 · {0}", [doc.name]),
            fields: [
                {
                    fieldtype: "Select",
                    fieldname: "company",
                    label: __("所属公司"),
                    options: this.companies.join("\n"),
                    default: default_company,
                    read_only: 1,
                },
                {
                    fieldtype: "Link",
                    options: "Supplier",
                    fieldname: "supplier",
                    label: __("供应商"),
                    default: default_supplier,
                    reqd: 1,
                },
                {
                    fieldtype: "Date",
                    fieldname: "schedule_date",
                    label: __("期望到货日期"),
                    default: default_schedule_date,
                    reqd: 1,
                },
                {
                    fieldtype: "Section Break",
                    label: __("采购订单物料明细与税额核算 (任意修改)"),
                },
                {
                    fieldtype: "HTML",
                    fieldname: "items_html",
                    options: `
                        <div>
                            <table class="picker-modal-item-table">
                                <thead>
                                    <tr>
                                        <th>#</th>
                                        <th>物料代码</th>
                                        <th>物料名称</th>
                                        <th>规格</th>
                                        <th>数量</th>
                                        <th>参考单价</th>
                                        <th>不含税金额</th>
                                        <th>税率 %</th>
                                        <th>税额</th>
                                        <th>含税总价</th>
                                        <th>备注</th>
                                        <th>操作</th>
                                    </tr>
                                </thead>
                                <tbody id="picker-modal-item-tbody"></tbody>
                            </table>
                            <button class="picker-modal-add-btn" id="picker-modal-add-row-btn">添加物料</button>

                            <div class="picker-modal-summary-bar">
                                <span>合计汇总:</span>
                                <div class="picker-modal-summary-items">
                                    <span>采购总数: <strong id="modal-sum-qty" class="picker-summary-highlight">0</strong></span>
                                    <span>不含税金额: <strong id="modal-sum-amt" class="picker-summary-highlight">¥ 0.00</strong></span>
                                    <span>税额: <strong id="modal-sum-tax" class="picker-summary-highlight">¥ 0.00</strong></span>
                                    <span>含税总额: <strong id="modal-sum-total" class="picker-summary-highlight">¥ 0.00</strong></span>
                                </div>
                            </div>
                        </div>
                    `,
                },
            ],
            primary_action_label: __("保存修改并正式发布"),
            primary_action: async () => {
                const vals = this.validate_and_get_dialog_values(d, [
                    { fieldname: "supplier", label: "供应商" },
                    { fieldname: "schedule_date", label: "期望到货日期" },
                ]);
                if (!vals) return;

                const valid_items = rows_data.filter((r) => (r.item_code || "").trim().length > 0);
                if (!valid_items.length) {
                    frappe.msgprint(__("请至少保留一行有效的物料代码。"));
                    return;
                }

                try {
                    frappe.dom.freeze(__("正在更新采购订单..."));
                    const res = await frappe.call({
                        method: "ashan_cn_procurement.services.procurement_picker_service.update_quick_purchase_order",
                        args: {
                            name: doc.name,
                            supplier: vals.supplier,
                            schedule_date: vals.schedule_date,
                            items: valid_items,
                        },
                    });
                    frappe.dom.unfreeze();
                    if (res && res.message && res.message.success) {
                        d.hide();
                        if (parent_dialog) parent_dialog.hide();
                        frappe.show_alert({
                            message: __("成功更新并正式发布采购订单：{0}", [doc.name]),
                            indicator: "green",
                        });
                        this.refresh_all();
                    }
                } catch (e) {
                    frappe.dom.unfreeze();
                    frappe.msgprint(e.message || __("更新采购订单失败"));
                }
            },
        });

        d.set_secondary_action_label(__("✕ 关闭"));
        d.set_secondary_action(() => {
            d.hide();
        });

        d.$wrapper.addClass("picker-create-mr-modal");
        d.show();

        d.$wrapper.attr("data-backdrop", "static").attr("data-keyboard", "false");
        d.$wrapper.on("click", function (e) {
            if ($(e.target).hasClass("modal") || $(e.target).hasClass("modal-backdrop")) {
                e.preventDefault();
                e.stopPropagation();
            }
        });
        render_rows(d);

        const $wrap = d.get_field("items_html").$wrapper;

        $wrap.on("click", "#picker-modal-add-row-btn", () => {
            rows_data.push({ item_code: "", item_name: "", spec: "", qty: 1.0, rate: 0.0, amount: 0.0, tax_rate: 13.0, tax_amount: 0.0, total_amount: 0.0, description: "" });
            render_rows(d);
        });

        $wrap.on("click", ".picker-modal-del-btn", function () {
            const idx = parseInt($(this).attr("data-idx"));
            rows_data.splice(idx, 1);
            if (!rows_data.length) rows_data.push({ item_code: "", item_name: "", spec: "", qty: 1.0, rate: 0.0, amount: 0.0, tax_rate: 13.0, tax_amount: 0.0, total_amount: 0.0, description: "" });
            render_rows(d);
        });

        // Autocomplete Search on item input
        let search_timeout = null;
        $wrap.on("input focus", ".modal-input-code", function () {
            const $input = $(this);
            const idx = parseInt($input.closest("tr").attr("data-idx"));
            const $dd = $wrap.find(`#suggest-dd-po-edit-${idx}`);
            const query = $input.val();

            clearTimeout(search_timeout);
            search_timeout = setTimeout(async () => {
                const comp = d.get_value("company") || default_company;
                try {
                    const r = await frappe.call({
                        method: "ashan_cn_procurement.services.procurement_picker_service.search_picker_items",
                        args: { query: query, company: comp },
                    });
                    const items = (r && r.message && r.message.items) || [];
                    let dd_html = "";
                    items.forEach((it) => {
                        dd_html += `
                            <div class="picker-suggest-item" data-code="${frappe.utils.escape_html(it.item_code)}" data-name="${frappe.utils.escape_html(it.item_name)}" data-rate="${it.rate}" data-uom="${it.uom}" data-tax="${it.tax_rate}">
                                <div class="picker-suggest-main">
                                    <span class="picker-suggest-code">${frappe.utils.escape_html(it.item_code)}</span>
                                    <span class="picker-suggest-name">${frappe.utils.escape_html(it.item_name)} (${it.uom})</span>
                                </div>
                                <div class="picker-suggest-price">¥ ${flt(it.rate).toFixed(2)}</div>
                            </div>
                        `;
                    });

                    dd_html += `
                        <div class="picker-suggest-create-btn" id="modal-create-new-item-po-btn">
                            <span>新建物料 (Create Item)</span>
                        </div>
                    `;

                    $dd.html(dd_html).addClass("is-open");

                    const input_el = $input[0];
                    if (input_el) {
                        const rect = input_el.getBoundingClientRect();
                        $dd.css({
                            top: (rect.bottom + 2) + "px",
                            left: rect.left + "px",
                            width: Math.max(rect.width, 380) + "px",
                        });
                    }
                } catch (err) {
                    console.error("Autocomplete search error", err);
                }
            }, 250);
        });

        // Close dropdown when scrolling modal body
        $wrap.closest(".modal-body").off("scroll.picker_suggest_po_edit").on("scroll.picker_suggest_po_edit", () => {
            $wrap.find(".picker-suggest-dropdown.is-open").removeClass("is-open");
        });

        // Pick item from dropdown
        $wrap.on("click", ".picker-suggest-item", function () {
            const $tr = $(this).closest("tr");
            const idx = parseInt($tr.attr("data-idx"));
            const code = $(this).attr("data-code");
            const name = $(this).attr("data-name");
            const uom = $(this).attr("data-uom");
            const rate = flt($(this).attr("data-rate"));
            const tax = flt($(this).attr("data-tax")) || 13.0;

            rows_data[idx].item_code = code;
            rows_data[idx].item_name = name;
            rows_data[idx].spec = uom || "";
            rows_data[idx].rate = rate;
            rows_data[idx].tax_rate = tax;

            $wrap.find(".picker-suggest-dropdown").removeClass("is-open");
            render_rows(d);
        });

        // Quick create item click
        $wrap.on("click", "#modal-create-new-item-po-btn", function () {
            $wrap.find(".picker-suggest-dropdown").removeClass("is-open");
            frappe.new_doc("Item");
        });

        // Close dropdown when clicking outside
        $(document).off("click.picker_suggest_po_out").on("click.picker_suggest_po_out", (e) => {
            if (!$(e.target).closest(".picker-suggest-wrapper").length && !$(e.target).closest(".picker-suggest-dropdown").length) {
                $wrap.find(".picker-suggest-dropdown").removeClass("is-open");
            }
        });

        // Live text and calculation event bindings
        $wrap.on("input change", ".modal-input-code", function () {
            const idx = parseInt($(this).closest("tr").attr("data-idx"));
            if (rows_data[idx]) {
                rows_data[idx].item_code = $(this).val().trim();
            }
        });

        $wrap.on("input change", ".modal-input-name", function () {
            const idx = parseInt($(this).closest("tr").attr("data-idx"));
            rows_data[idx].item_name = $(this).val();
        });

        $wrap.on("input change", ".modal-input-spec", function () {
            const idx = parseInt($(this).closest("tr").attr("data-idx"));
            rows_data[idx].spec = $(this).val();
        });

        $wrap.on("input change", ".modal-input-remarks", function () {
            const idx = parseInt($(this).closest("tr").attr("data-idx"));
            const val = $(this).val();
            rows_data[idx].description = val;
            rows_data[idx].remarks = val;
            rows_data[idx].custom_line_remark = val;
        });

        $wrap.on("input change", ".modal-input-qty", function () {
            recalculate_and_sync_row($(this).closest("tr"), "qty", $wrap);
        });

        $wrap.on("input change", ".modal-input-rate", function () {
            recalculate_and_sync_row($(this).closest("tr"), "rate", $wrap);
        });

        $wrap.on("input change", ".modal-input-amount", function () {
            recalculate_and_sync_row($(this).closest("tr"), "amount", $wrap);
        });

        $wrap.on("input change", ".modal-input-tax-rate", function () {
            recalculate_and_sync_row($(this).closest("tr"), "tax_rate", $wrap);
        });

        $wrap.on("input change", ".modal-input-tax-amount", function () {
            recalculate_and_sync_row($(this).closest("tr"), "tax_amount", $wrap);
        });

        $wrap.on("input change", ".modal-input-total-amount", function () {
            recalculate_and_sync_row($(this).closest("tr"), "total_amount", $wrap);
        });
    }

    async open_create_po_from_mr_dialog(selected_items, target_comp) {
        const self = this;
        if (!selected_items || !selected_items.length) return;

        // Expand doc-level objects to detail items if needed
        let expanded_items = [];
        for (const it of selected_items) {
            if (it.item_code) {
                expanded_items.push(it);
            } else if (it.mr_name) {
                try {
                    const res = await frappe.call({
                        method: "ashan_cn_procurement.services.procurement_picker_service.get_pending_material_request_items",
                        args: {
                            company: target_comp,
                            filters: { mr_name: it.mr_name, match_status: "pending" }
                        }
                    });
                    const fetched = (res && res.message && (res.message.rows || res.message.items)) || [];
                    if (fetched.length) {
                        expanded_items.push(...fetched);
                    } else {
                        expanded_items.push(it);
                    }
                } catch (e) {
                    expanded_items.push(it);
                }
            } else {
                expanded_items.push(it);
            }
        }

        if (!expanded_items.length) {
            expanded_items = selected_items;
        }

        const sup_override = this.$body.find("#picker-opt-supplier").val() || "";
        const default_supplier = sup_override || expanded_items[0].supplier || "";
        const default_schedule_date = expanded_items[0].schedule_date || frappe.datetime.get_today();

        let rows_data = expanded_items.map((it) => {
            const q = flt(it.this_qty || it.pending_qty || it.qty || 1.0);
            const r = flt(it.rate || 0.0);
            const a = flt(it.amount) || (Math.round(q * r * 100) / 100);
            const tx_pct = flt(it.tax_rate) || 13.0;
            const tx_amt = flt(it.tax_amount) || (Math.round(a * (tx_pct / 100.0) * 100) / 100);
            const tot = flt(it.total_amount) || (Math.round((a + tx_amt) * 100) / 100);
            return {
                mri_name: it.mri_name || it.name,
                mr_name: it.mr_name || it.parent,
                item_code: it.item_code || "",
                item_name: it.item_name || "",
                spec: it.spec || it.custom_spec_model || "",
                qty: q,
                this_qty: q,
                rate: r,
                amount: a,
                tax_rate: tx_pct,
                tax_amount: tx_amt,
                total_amount: tot,
                description: it.description || it.remarks || it.custom_line_remark || "",
                remarks: it.remarks || it.description || it.custom_line_remark || "",
            };
        });

        const recalculate_row_state = (r) => {
            const qty = flt(r.qty) || 0.0;
            const rate = flt(r.rate) || 0.0;
            r.amount = Math.round(qty * rate * 100) / 100;
            const tax_pct = flt(r.tax_rate) || 0.0;
            r.tax_amount = Math.round(r.amount * (tax_pct / 100.0) * 100) / 100;
            r.total_amount = Math.round((r.amount + r.tax_amount) * 100) / 100;
        };

        const update_bottom_summary = ($wrapper) => {
            let total_qty = 0;
            let total_amt = 0;
            let total_tax = 0;
            let grand_total = 0;
            $wrapper.find("#picker-modal-item-tbody tr").each(function () {
                const q = flt($(this).find(".modal-input-qty").val()) || 0;
                const a = flt($(this).find(".modal-input-amount").val()) || 0;
                const tx = flt($(this).find(".modal-input-tax-amount").val()) || 0;
                const tot = flt($(this).find(".modal-input-total-amount").val()) || 0;
                total_qty += q;
                total_amt += a;
                total_tax += tx;
                grand_total += tot;
            });
            $wrapper.find("#modal-sum-qty").text(total_qty.toFixed(2));
            $wrapper.find("#modal-sum-amt").text(this.fmt_money(total_amt));
            $wrapper.find("#modal-sum-tax").text(this.fmt_money(total_tax));
            $wrapper.find("#modal-sum-total").text(this.fmt_money(grand_total));
        };

        const recalculate_and_sync_row = ($tr, field_changed, $wrapper) => {
            const idx = parseInt($tr.attr("data-idx"));
            const $qty = $tr.find(".modal-input-qty");
            const $rate = $tr.find(".modal-input-rate");
            const $amount = $tr.find(".modal-input-amount");
            const $tax_rate = $tr.find(".modal-input-tax-rate");
            const $tax_amount = $tr.find(".modal-input-tax-amount");
            const $total_amount = $tr.find(".modal-input-total-amount");

            let qty = flt($qty.val()) || 0.0;
            let rate = flt($rate.val()) || 0.0;
            let amount = flt($amount.val()) || 0.0;
            let tax_rate = flt($tax_rate.val()) || 0.0;
            let tax_amount = flt($tax_amount.val()) || 0.0;
            let total_amount = flt($total_amount.val()) || 0.0;

            if (field_changed === "qty" || field_changed === "rate") {
                amount = Math.round(qty * rate * 100) / 100;
                tax_amount = Math.round(amount * (tax_rate / 100.0) * 100) / 100;
                total_amount = Math.round((amount + tax_amount) * 100) / 100;
                $amount.val(amount.toFixed(2));
                $tax_amount.val(tax_amount.toFixed(2));
                $total_amount.val(total_amount.toFixed(2));
            } else if (field_changed === "tax_rate") {
                tax_amount = Math.round(amount * (tax_rate / 100.0) * 100) / 100;
                total_amount = Math.round((amount + tax_amount) * 100) / 100;
                $tax_amount.val(tax_amount.toFixed(2));
                $total_amount.val(total_amount.toFixed(2));
            } else if (field_changed === "amount") {
                if (qty > 0) {
                    rate = Math.round((amount / qty) * 10000) / 10000;
                    $rate.val(rate);
                }
                tax_amount = Math.round(amount * (tax_rate / 100.0) * 100) / 100;
                total_amount = Math.round((amount + tax_amount) * 100) / 100;
                $tax_amount.val(tax_amount.toFixed(2));
                $total_amount.val(total_amount.toFixed(2));
            } else if (field_changed === "tax_amount") {
                total_amount = Math.round((amount + tax_amount) * 100) / 100;
                $total_amount.val(total_amount.toFixed(2));
                if (amount > 0) {
                    tax_rate = Math.round((tax_amount / amount) * 10000) / 100;
                    $tax_rate.val(tax_rate);
                }
            } else if (field_changed === "total_amount") {
                amount = Math.round((total_amount / (1 + tax_rate / 100.0)) * 100) / 100;
                tax_amount = Math.round((total_amount - amount) * 100) / 100;
                if (qty > 0) {
                    rate = Math.round((amount / qty) * 10000) / 10000;
                    $rate.val(rate);
                }
                $amount.val(amount.toFixed(2));
                $tax_amount.val(tax_amount.toFixed(2));
            }

            if (rows_data[idx]) {
                rows_data[idx].qty = qty;
                rows_data[idx].rate = rate;
                rows_data[idx].amount = amount;
                rows_data[idx].tax_rate = tax_rate;
                rows_data[idx].tax_amount = tax_amount;
                rows_data[idx].total_amount = total_amount;
            }

            update_bottom_summary($wrapper);
        };

        const render_rows = (dialog) => {
            const $wrapper = dialog.get_field("items_html").$wrapper;
            const $tbody = $wrapper.find("#picker-modal-item-tbody");
            $tbody.empty();

            rows_data.forEach((r, idx) => {
                recalculate_row_state(r);
                const tr = `
                    <tr data-idx="${idx}">
                        <td class="picker-modal-cell-center">${idx + 1}</td>
                        <td>
                            <input type="text" class="modal-input-code modal-input-readonly" readonly tabindex="-1" placeholder="物料代码..." value="${frappe.utils.escape_html(r.item_code || '')}">
                        </td>
                        <td>
                            <input type="text" class="modal-input-name modal-input-readonly" readonly tabindex="-1" placeholder="物料名称..." value="${frappe.utils.escape_html(r.item_name || '')}">
                        </td>
                        <td>
                            <input type="text" class="modal-input-spec modal-input-readonly" readonly tabindex="-1" placeholder="规格..." value="${frappe.utils.escape_html(r.spec || '')}">
                        </td>
                        <td>
                            <input type="number" step="any" min="0.0001" class="modal-input-qty" value="${r.qty}">
                        </td>
                        <td>
                            <input type="number" step="any" min="0" class="modal-input-rate" value="${r.rate}">
                        </td>
                        <td>
                            <input type="number" step="any" min="0" class="modal-input-amount" value="${flt(r.amount).toFixed(2)}">
                        </td>
                        <td>
                            <input type="number" step="any" min="0" max="100" class="modal-input-tax-rate" value="${r.tax_rate}">
                        </td>
                        <td>
                            <input type="number" step="any" min="0" class="modal-input-tax-amount" value="${flt(r.tax_amount).toFixed(2)}">
                        </td>
                        <td>
                            <input type="number" step="any" min="0" class="modal-input-total-amount" value="${flt(r.total_amount).toFixed(2)}">
                        </td>
                        <td>
                            <input type="text" class="modal-input-remarks modal-input-readonly" readonly tabindex="-1" placeholder="备注说明..." value="${frappe.utils.escape_html(r.remarks || r.description || '')}">
                        </td>
                        <td class="picker-modal-cell-center">
                            <button class="picker-modal-del-btn" data-idx="${idx}">删除</button>
                        </td>
                    </tr>
                `;
                $tbody.append(tr);
            });

            update_bottom_summary($wrapper);
        };

        const save_order = async (submit_doc) => {
            const vals = self.validate_and_get_dialog_values(d, [
                { fieldname: "supplier", label: "供应商" },
                { fieldname: "schedule_date", label: "期望到货日期" },
            ]);
            if (!vals) return;

            const valid_items = rows_data.filter((r) => (r.item_code || "").trim().length > 0);
            if (!valid_items.length) {
                frappe.msgprint(__("请至少保留一行有效的物料代码。"));
                return;
            }

            for (let i = 0; i < valid_items.length; i++) {
                const item = valid_items[i];
                const item_qty = flt(item.qty || item.this_qty);
                if (item_qty > 0) {
                    if (flt(item.rate) <= 0 || flt(item.amount) <= 0) {
                        frappe.msgprint(__("第 {0} 行物料 [{1}] 的订购数量大于0时，单价与金额必须大于0，不可为0！", [i + 1, item.item_code]));
                        return;
                    }
                }
            }

            try {
                frappe.dom.freeze(submit_doc ? __("正在生成并提交采购订单...") : __("正在保存采购订单草稿..."));
                const res = await frappe.call({
                    method: "ashan_cn_procurement.services.procurement_picker_service.make_purchase_orders_from_mr_items",
                    args: {
                        company: target_comp,
                        selected_items: valid_items,
                        supplier_override: vals.supplier,
                        schedule_date: vals.schedule_date,
                        submit_doc: submit_doc ? 1 : 0,
                    },
                });
                frappe.dom.unfreeze();
                if (res && res.message && res.message.success) {
                    d.hide();
                    const order_names = (res.message.orders || []).map((o) => o.name).filter(Boolean);
                    const first_po = order_names[0];
                    if (!submit_doc) {
                        self.filters[self.active_stage].match_status = "all";
                        self.render_filter_bar();
                    }
                    self.refresh_all();
                    const alert_msg = submit_doc
                        ? __("成功生成并正式提交采购订单 <b>{0}</b>{1}", [
                            first_po || "",
                            order_names.length > 1 ? ` 等共 ${order_names.length} 张单据` : "",
                        ])
                        : __("成功生成并保存采购订单草稿 <b>{0}</b>{1}，已为您切换并置顶显示于列表首行！", [
                            first_po || "",
                            order_names.length > 1 ? ` 等共 ${order_names.length} 张单据` : "",
                        ]);
                    frappe.show_alert({
                        message: alert_msg,
                        indicator: "green",
                    }, 6);
                    if (first_po) {
                        self.show_doc_detail_modal("Purchase Order", first_po);
                    }
                }
            } catch (e) {
                frappe.dom.unfreeze();
                frappe.msgprint(e.message || (submit_doc ? __("生成采购订单失败") : __("保存采购订单草稿失败")));
            }
        };

        const d = new frappe.ui.Dialog({
            title: __("新建采购订单 · 选单创建与明细核算"),
            size: "large",
            static: true,
            fields: [
                {
                    fieldtype: "Select",
                    fieldname: "company",
                    label: __("所属公司"),
                    options: this.companies.join("\n"),
                    default: target_comp,
                    read_only: 1,
                },
                {
                    fieldtype: "Link",
                    options: "Supplier",
                    fieldname: "supplier",
                    label: __("供应商"),
                    default: default_supplier,
                    reqd: 1,
                },
                {
                    fieldtype: "Date",
                    fieldname: "schedule_date",
                    label: __("期望到货日期"),
                    default: default_schedule_date,
                    reqd: 1,
                },
                {
                    fieldtype: "Section Break",
                    label: __("采购订单物料明细与税额核算 (可任意调整)"),
                },
                {
                    fieldtype: "HTML",
                    fieldname: "items_html",
                    options: `
                        <div>
                            <div class="picker-modal-item-table-wrap">
                                <table class="picker-modal-item-table picker-table-12cols">
                                    <thead>
                                        <tr>
                                            <th>#</th>
                                            <th>物料代码</th>
                                            <th>物料名称</th>
                                            <th>规格</th>
                                            <th>数量</th>
                                            <th>参考单价</th>
                                            <th>不含税金额</th>
                                            <th>税率 %</th>
                                            <th>税额</th>
                                            <th>含税总价</th>
                                            <th>备注</th>
                                            <th>操作</th>
                                        </tr>
                                    </thead>
                                    <tbody id="picker-modal-item-tbody"></tbody>
                                </table>
                            </div>

                            <div class="picker-modal-summary-bar">
                                <span>合计汇总:</span>
                                <div class="picker-modal-summary-items">
                                    <span>采购总数: <strong id="modal-sum-qty" class="picker-summary-highlight">0</strong></span>
                                    <span>不含税金额: <strong id="modal-sum-amt" class="picker-summary-highlight">¥ 0.00</strong></span>
                                    <span>税额: <strong id="modal-sum-tax" class="picker-summary-highlight">¥ 0.00</strong></span>
                                    <span>含税总额: <strong id="modal-sum-total" class="picker-summary-highlight">¥ 0.00</strong></span>
                                </div>
                            </div>
                        </div>
                    `,
                },
            ],
            primary_action_label: __("🚀 提交采购订单"),
            primary_action: () => save_order(1),
        });

        // 显式底部关闭按钮
        d.set_secondary_action_label(__("✕ 关闭"));
        d.set_secondary_action(() => {
            d.hide();
        });

        d.$wrapper.addClass("picker-create-mr-modal");
        d.show();

        // 显式保存草稿按钮（直接注入到 footer 的 primary 按钮前）
        d.$wrapper.find(".picker-modal-draft-btn").remove();
        const $custom_draft_btn = $(`<button type="button" class="btn btn-default btn-sm picker-modal-draft-btn">${__("📝 保存草稿")}</button>`);
        $custom_draft_btn.on("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            save_order(0);
        });
        d.get_primary_btn().before($custom_draft_btn);

        // 覆盖 primary action 默认绑定，避免触发 Frappe 原生英文 Missing Values 弹窗
        d.get_primary_btn().off("click").on("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            save_order(1);
        });

        // 用户输入或选择时自动清除红色闪烁提示
        d.$wrapper.on("input change", "input, select, textarea", function () {
            $(this).closest(".frappe-control, .form-group, div[data-fieldname]").removeClass("ashan-field-flash-error");
        });

        // 没提交状态下禁止点击遮罩外部关闭弹窗
        d.$wrapper.attr("data-backdrop", "static").attr("data-keyboard", "false");
        d.$wrapper.on("click", function (e) {
            if ($(e.target).hasClass("modal") || $(e.target).hasClass("modal-backdrop")) {
                e.preventDefault();
                e.stopPropagation();
            }
        });
        render_rows(d);

        const $wrap = d.get_field("items_html").$wrapper;

        $wrap.on("click", "#picker-modal-add-row-btn", () => {
            rows_data.push({ item_code: "", item_name: "", spec: "", qty: 1.0, rate: 0.0, amount: 0.0, tax_rate: 13.0, tax_amount: 0.0, total_amount: 0.0, description: "" });
            render_rows(d);
        });

        $wrap.on("click", ".picker-modal-del-btn", function () {
            const idx = parseInt($(this).attr("data-idx"));
            rows_data.splice(idx, 1);
            if (!rows_data.length) rows_data.push({ item_code: "", item_name: "", spec: "", qty: 1.0, rate: 0.0, amount: 0.0, tax_rate: 13.0, tax_amount: 0.0, total_amount: 0.0, description: "" });
            render_rows(d);
        });

        // Autocomplete search on item input
        let search_timeout = null;
        $wrap.on("input focus", ".modal-input-code", function () {
            const $input = $(this);
            const idx = parseInt($input.closest("tr").attr("data-idx"));
            const $dd = $wrap.find(`#suggest-dd-po-create-${idx}`);
            const query = $input.val();

            clearTimeout(search_timeout);
            search_timeout = setTimeout(async () => {
                const comp = d.get_value("company") || target_comp;
                try {
                    const r = await frappe.call({
                        method: "ashan_cn_procurement.services.procurement_picker_service.search_picker_items",
                        args: { query: query, company: comp },
                    });
                    const items = (r && r.message && r.message.items) || [];
                    let dd_html = "";
                    items.forEach((it) => {
                        dd_html += `
                            <div class="picker-suggest-item" data-code="${frappe.utils.escape_html(it.item_code)}" data-name="${frappe.utils.escape_html(it.item_name)}" data-rate="${it.rate}" data-uom="${it.uom}" data-tax="${it.tax_rate}">
                                <div class="picker-suggest-main">
                                    <span class="picker-suggest-code">${frappe.utils.escape_html(it.item_code)}</span>
                                    <span class="picker-suggest-name">${frappe.utils.escape_html(it.item_name)} (${it.uom})</span>
                                </div>
                                <div class="picker-suggest-price">¥ ${flt(it.rate).toFixed(2)}</div>
                            </div>
                        `;
                    });

                    dd_html += `
                        <div class="picker-suggest-create-btn" id="modal-create-new-item-po-gen-btn">
                            <span>新建物料 (Create Item)</span>
                        </div>
                    `;

                    $dd.html(dd_html).addClass("is-open");

                    const input_el = $input[0];
                    if (input_el) {
                        const rect = input_el.getBoundingClientRect();
                        $dd.css({
                            top: (rect.bottom + 2) + "px",
                            left: rect.left + "px",
                            width: Math.max(rect.width, 380) + "px",
                        });
                    }
                } catch (err) {
                    console.error("Autocomplete search error", err);
                }
            }, 250);
        });

        // Close dropdown when scrolling modal body
        $wrap.closest(".modal-body").off("scroll.picker_suggest_po_gen").on("scroll.picker_suggest_po_gen", () => {
            $wrap.find(".picker-suggest-dropdown.is-open").removeClass("is-open");
        });

        // Pick item from dropdown
        $wrap.on("click", ".picker-suggest-item", function () {
            const $tr = $(this).closest("tr");
            const idx = parseInt($tr.attr("data-idx"));
            const code = $(this).attr("data-code");
            const name = $(this).attr("data-name");
            const uom = $(this).attr("data-uom");
            const rate = flt($(this).attr("data-rate"));
            const tax = flt($(this).attr("data-tax")) || 13.0;

            rows_data[idx].item_code = code;
            rows_data[idx].item_name = name;
            rows_data[idx].spec = uom || "";
            rows_data[idx].rate = rate;
            rows_data[idx].tax_rate = tax;

            $wrap.find(".picker-suggest-dropdown").removeClass("is-open");
            render_rows(d);
        });

        // Quick create item click
        $wrap.on("click", "#modal-create-new-item-po-gen-btn", function () {
            $wrap.find(".picker-suggest-dropdown").removeClass("is-open");
            frappe.new_doc("Item");
        });

        // Close dropdown when clicking outside
        $(document).off("click.picker_suggest_po_gen_out").on("click.picker_suggest_po_gen_out", (e) => {
            if (!$(e.target).closest(".picker-suggest-wrapper").length && !$(e.target).closest(".picker-suggest-dropdown").length) {
                $wrap.find(".picker-suggest-dropdown").removeClass("is-open");
            }
        });

        // Live text and calculation event bindings
        $wrap.on("input change", ".modal-input-code", function () {
            const idx = parseInt($(this).closest("tr").attr("data-idx"));
            if (rows_data[idx]) {
                rows_data[idx].item_code = $(this).val().trim();
            }
        });

        $wrap.on("input change", ".modal-input-name", function () {
            const idx = parseInt($(this).closest("tr").attr("data-idx"));
            rows_data[idx].item_name = $(this).val();
        });

        $wrap.on("input change", ".modal-input-spec", function () {
            const idx = parseInt($(this).closest("tr").attr("data-idx"));
            rows_data[idx].spec = $(this).val();
        });

        $wrap.on("input change", ".modal-input-remarks", function () {
            const idx = parseInt($(this).closest("tr").attr("data-idx"));
            rows_data[idx].description = $(this).val();
        });

        $wrap.on("input change", ".modal-input-qty", function () {
            recalculate_and_sync_row($(this).closest("tr"), "qty", $wrap);
        });

        $wrap.on("input change", ".modal-input-rate", function () {
            recalculate_and_sync_row($(this).closest("tr"), "rate", $wrap);
        });

        $wrap.on("input change", ".modal-input-amount", function () {
            recalculate_and_sync_row($(this).closest("tr"), "amount", $wrap);
        });

        $wrap.on("input change", ".modal-input-tax-rate", function () {
            recalculate_and_sync_row($(this).closest("tr"), "tax_rate", $wrap);
        });

        $wrap.on("input change", ".modal-input-tax-amount", function () {
            recalculate_and_sync_row($(this).closest("tr"), "tax_amount", $wrap);
        });

        $wrap.on("input change", ".modal-input-total-amount", function () {
            recalculate_and_sync_row($(this).closest("tr"), "total_amount", $wrap);
        });
    }

    open_create_pr_from_po_dialog(selected_items, target_comp) {
        const self = this;
        const wh_override = this.$body.find("#picker-opt-warehouse").val() || "";
        const default_supplier = selected_items[0].supplier || "";
        const default_warehouse = wh_override || selected_items[0].warehouse || "";

        let rows_data = selected_items.map((it) => {
            const q = flt(it.this_qty || it.pending_qty || it.qty || 1.0);
            const r = flt(it.rate || 0.0);
            const a = Math.round(q * r * 100) / 100;
            const tx_pct = flt(it.tax_rate) || 13.0;
            const tx_amt = Math.round(a * (tx_pct / 100.0) * 100) / 100;
            const tot = Math.round((a + tx_amt) * 100) / 100;
            return {
                poi_name: it.poi_name || it.name,
                po_name: it.po_name || it.parent,
                item_code: it.item_code || "",
                item_name: it.item_name || "",
                spec: it.spec || "",
                qty: q,
                rate: r,
                amount: a,
                tax_rate: tx_pct,
                tax_amount: tx_amt,
                total_amount: tot,
                warehouse: it.warehouse || default_warehouse,
                description: it.remarks || it.description || "",
            };
        });

        const recalculate_row_state = (r) => {
            const qty = flt(r.qty) || 0.0;
            const rate = flt(r.rate) || 0.0;
            r.amount = Math.round(qty * rate * 100) / 100;
            const tax_pct = flt(r.tax_rate) || 0.0;
            r.tax_amount = Math.round(r.amount * (tax_pct / 100.0) * 100) / 100;
            r.total_amount = Math.round((r.amount + r.tax_amount) * 100) / 100;
        };

        const update_bottom_summary = ($wrapper) => {
            let total_qty = 0;
            let total_amt = 0;
            let total_tax = 0;
            let grand_total = 0;
            $wrapper.find("#picker-modal-item-tbody tr").each(function () {
                const q = flt($(this).find(".modal-input-qty").val()) || 0;
                const a = flt($(this).find(".modal-input-amount").val()) || 0;
                const tx = flt($(this).find(".modal-input-tax-amount").val()) || 0;
                const tot = flt($(this).find(".modal-input-total-amount").val()) || 0;
                total_qty += q;
                total_amt += a;
                total_tax += tx;
                grand_total += tot;
            });
            $wrapper.find("#modal-sum-qty").text(total_qty.toFixed(2));
            $wrapper.find("#modal-sum-amt").text(this.fmt_money(total_amt));
            $wrapper.find("#modal-sum-tax").text(this.fmt_money(total_tax));
            $wrapper.find("#modal-sum-total").text(this.fmt_money(grand_total));
        };

        const recalculate_and_sync_row = ($tr, field_changed, $wrapper) => {
            const idx = parseInt($tr.attr("data-idx"));
            const $qty = $tr.find(".modal-input-qty");
            const $rate = $tr.find(".modal-input-rate");
            const $amount = $tr.find(".modal-input-amount");
            const $tax_rate = $tr.find(".modal-input-tax-rate");
            const $tax_amount = $tr.find(".modal-input-tax-amount");
            const $total_amount = $tr.find(".modal-input-total-amount");

            let qty = flt($qty.val()) || 0.0;
            let rate = flt($rate.val()) || 0.0;
            let amount = flt($amount.val()) || 0.0;
            let tax_rate = flt($tax_rate.val()) || 0.0;
            let tax_amount = flt($tax_amount.val()) || 0.0;
            let total_amount = flt($total_amount.val()) || 0.0;

            if (field_changed === "qty" || field_changed === "rate") {
                amount = Math.round(qty * rate * 100) / 100;
                tax_amount = Math.round(amount * (tax_rate / 100.0) * 100) / 100;
                total_amount = Math.round((amount + tax_amount) * 100) / 100;
                $amount.val(amount.toFixed(2));
                $tax_amount.val(tax_amount.toFixed(2));
                $total_amount.val(total_amount.toFixed(2));
            } else if (field_changed === "tax_rate") {
                tax_amount = Math.round(amount * (tax_rate / 100.0) * 100) / 100;
                total_amount = Math.round((amount + tax_amount) * 100) / 100;
                $tax_amount.val(tax_amount.toFixed(2));
                $total_amount.val(total_amount.toFixed(2));
            } else if (field_changed === "amount") {
                if (qty > 0) {
                    rate = Math.round((amount / qty) * 10000) / 10000;
                    $rate.val(rate);
                }
                tax_amount = Math.round(amount * (tax_rate / 100.0) * 100) / 100;
                total_amount = Math.round((amount + tax_amount) * 100) / 100;
                $tax_amount.val(tax_amount.toFixed(2));
                $total_amount.val(total_amount.toFixed(2));
            } else if (field_changed === "tax_amount") {
                total_amount = Math.round((amount + tax_amount) * 100) / 100;
                $total_amount.val(total_amount.toFixed(2));
                if (amount > 0) {
                    tax_rate = Math.round((tax_amount / amount) * 10000) / 100;
                    $tax_rate.val(tax_rate);
                }
            } else if (field_changed === "total_amount") {
                amount = Math.round((total_amount / (1 + tax_rate / 100.0)) * 100) / 100;
                tax_amount = Math.round((total_amount - amount) * 100) / 100;
                if (qty > 0) {
                    rate = Math.round((amount / qty) * 10000) / 10000;
                    $rate.val(rate);
                }
                $amount.val(amount.toFixed(2));
                $tax_amount.val(tax_amount.toFixed(2));
            }

            if (rows_data[idx]) {
                rows_data[idx].qty = qty;
                rows_data[idx].rate = rate;
                rows_data[idx].amount = amount;
                rows_data[idx].tax_rate = tax_rate;
                rows_data[idx].tax_amount = tax_amount;
                rows_data[idx].total_amount = total_amount;
            }

            update_bottom_summary($wrapper);
        };

        const render_rows = (dialog) => {
            const $wrapper = dialog.get_field("items_html").$wrapper;
            const $tbody = $wrapper.find("#picker-modal-item-tbody");
            $tbody.empty();

            rows_data.forEach((r, idx) => {
                recalculate_row_state(r);
                const tr = `
                    <tr data-idx="${idx}">
                        <td class="picker-modal-cell-center">${idx + 1}</td>
                        <td>
                            <input type="text" class="modal-input-code modal-input-readonly" readonly tabindex="-1" placeholder="物料代码..." value="${frappe.utils.escape_html(r.item_code || '')}">
                        </td>
                        <td>
                            <input type="text" class="modal-input-name modal-input-readonly" readonly tabindex="-1" placeholder="物料名称..." value="${frappe.utils.escape_html(r.item_name || '')}">
                        </td>
                        <td>
                            <input type="text" class="modal-input-spec modal-input-readonly" readonly tabindex="-1" placeholder="规格..." value="${frappe.utils.escape_html(r.spec || '')}">
                        </td>
                        <td>
                            <input type="number" step="any" min="0.0001" class="modal-input-qty" value="${r.qty}">
                        </td>
                        <td>
                            <input type="number" step="any" min="0" class="modal-input-rate" value="${r.rate}">
                        </td>
                        <td>
                            <input type="number" step="any" min="0" class="modal-input-amount" value="${flt(r.amount).toFixed(2)}">
                        </td>
                        <td>
                            <input type="number" step="any" min="0" max="100" class="modal-input-tax-rate" value="${r.tax_rate}">
                        </td>
                        <td>
                            <input type="number" step="any" min="0" class="modal-input-tax-amount" value="${flt(r.tax_amount).toFixed(2)}">
                        </td>
                        <td>
                            <input type="number" step="any" min="0" class="modal-input-total-amount" value="${flt(r.total_amount).toFixed(2)}">
                        </td>
                        <td>
                            <input type="text" class="modal-input-remarks modal-input-readonly" readonly tabindex="-1" placeholder="备注说明..." value="${frappe.utils.escape_html(r.remarks || r.description || '')}">
                        </td>
                        <td class="picker-modal-cell-center">
                            <button class="picker-modal-del-btn" data-idx="${idx}">删除</button>
                        </td>
                    </tr>
                `;
                $tbody.append(tr);
            });

            update_bottom_summary($wrapper);
        };

        const d = new frappe.ui.Dialog({
            title: __("新建采购入库单 · 选单创建与明细核算"),
            fields: [
                {
                    fieldtype: "Select",
                    fieldname: "company",
                    label: __("所属公司"),
                    options: this.companies.join("\n"),
                    default: target_comp,
                    read_only: 1,
                },
                {
                    fieldtype: "Link",
                    options: "Supplier",
                    fieldname: "supplier",
                    label: __("供应商"),
                    default: default_supplier,
                    read_only: 1,
                },
                {
                    fieldtype: "Link",
                    options: "Warehouse",
                    fieldname: "warehouse",
                    label: __("入库仓库"),
                    default: default_warehouse,
                    reqd: 1,
                },
                {
                    fieldtype: "Date",
                    fieldname: "posting_date",
                    label: __("过账日期"),
                    default: window.AshanWorkContext?.getWorkDate?.() || frappe.datetime.get_today(),
                    reqd: 1,
                },
                {
                    fieldtype: "Section Break",
                    label: __("入库物料明细与核算 (可确认实收数与金额)"),
                },
                {
                    fieldtype: "HTML",
                    fieldname: "items_html",
                    options: `
                        <div>
                            <div class="picker-modal-item-table-wrap">
                                <table class="picker-modal-item-table picker-table-12cols">
                                    <thead>
                                        <tr>
                                            <th>#</th>
                                            <th>物料代码</th>
                                            <th>物料名称</th>
                                            <th>规格</th>
                                            <th>实收数量</th>
                                            <th>参考单价</th>
                                            <th>不含税金额</th>
                                            <th>税率 %</th>
                                            <th>税额</th>
                                            <th>含税总价</th>
                                            <th>备注</th>
                                            <th>操作</th>
                                        </tr>
                                    </thead>
                                    <tbody id="picker-modal-item-tbody"></tbody>
                                </table>
                            </div>

                            <div class="picker-modal-summary-bar">
                                <span>合计汇总:</span>
                                <div class="picker-modal-summary-items">
                                    <span>实收总数: <strong id="modal-sum-qty" class="picker-summary-highlight">0</strong></span>
                                    <span>不含税金额: <strong id="modal-sum-amt" class="picker-summary-highlight">¥ 0.00</strong></span>
                                    <span>税额: <strong id="modal-sum-tax" class="picker-summary-highlight">¥ 0.00</strong></span>
                                    <span>含税总额: <strong id="modal-sum-total" class="picker-summary-highlight">¥ 0.00</strong></span>
                                </div>
                            </div>
                        </div>
                    `,
                },
            ],
            primary_action_label: __("立即生成并正式提交入库单"),
            primary_action: async () => {
                const vals = this.validate_and_get_dialog_values(d, [
                    { fieldname: "warehouse", label: "入库仓库" },
                    { fieldname: "posting_date", label: "过账日期" },
                ]);
                if (!vals) return;

                const valid_items = rows_data.filter((r) => (r.item_code || "").trim().length > 0);
                if (!valid_items.length) {
                    frappe.msgprint(__("请至少保留一行有效的物料代码。"));
                    return;
                }

                for (let i = 0; i < valid_items.length; i++) {
                    const item = valid_items[i];
                    const item_qty = flt(item.qty || item.this_qty);
                    if (item_qty > 0) {
                        if (flt(item.rate) <= 0 || flt(item.amount) <= 0) {
                            frappe.msgprint(__("第 {0} 行物料 [{1}] 的实收数量大于0时，单价与金额必须大于0，不可为0！", [i + 1, item.item_code]));
                            return;
                        }
                    }
                }

                try {
                    frappe.dom.freeze(__("正在生成采购入库单..."));
                    const res = await frappe.call({
                        method: "ashan_cn_procurement.services.procurement_picker_service.make_purchase_receipts_from_po_items",
                        args: {
                            company: target_comp,
                            selected_items: valid_items,
                            warehouse_override: vals.warehouse,
                            posting_date: vals.posting_date,
                        },
                    });
                    frappe.dom.unfreeze();
                    if (res && res.message && res.message.success) {
                        d.hide();
                        const receipt_names = (res.message.receipts || []).map((r) => r.name).filter(Boolean);
                        const first_pr = receipt_names[0];
                        frappe.show_alert({
                            message: __("成功生成并正式提交采购入库单 <b>{0}</b>{1}", [
                                first_pr || "",
                                receipt_names.length > 1 ? ` 等共 ${receipt_names.length} 张单据` : "",
                            ]),
                            indicator: "green",
                        }, 6);
                        self.refresh_all();
                        if (first_pr) {
                            self.show_doc_detail_modal("Purchase Receipt", first_pr);
                        }
                    }
                } catch (e) {
                    frappe.dom.unfreeze();
                    frappe.msgprint(e.message || __("生成采购入库单失败"));
                }
            },
        });

        d.set_secondary_action_label(__("✕ 关闭"));
        d.set_secondary_action(() => {
            d.hide();
        });

        d.$wrapper.addClass("picker-create-mr-modal");
        d.show();

        d.$wrapper.attr("data-backdrop", "static").attr("data-keyboard", "false");
        d.$wrapper.on("click", function (e) {
            if ($(e.target).hasClass("modal") || $(e.target).hasClass("modal-backdrop")) {
                e.preventDefault();
                e.stopPropagation();
            }
        });
        render_rows(d);

        const $wrap = d.get_field("items_html").$wrapper;

        $wrap.on("click", "#picker-modal-add-row-btn", () => {
            rows_data.push({ item_code: "", item_name: "", spec: "", qty: 1.0, rate: 0.0, amount: 0.0, tax_rate: 13.0, tax_amount: 0.0, total_amount: 0.0, description: "" });
            render_rows(d);
        });

        $wrap.on("click", ".picker-modal-del-btn", function () {
            const idx = parseInt($(this).attr("data-idx"));
            rows_data.splice(idx, 1);
            if (!rows_data.length) rows_data.push({ item_code: "", item_name: "", spec: "", qty: 1.0, rate: 0.0, amount: 0.0, tax_rate: 13.0, tax_amount: 0.0, total_amount: 0.0, description: "" });
            render_rows(d);
        });

        $wrap.on("input change", ".modal-input-qty", function () {
            recalculate_and_sync_row($(this).closest("tr"), "qty", $wrap);
        });
        $wrap.on("input change", ".modal-input-rate", function () {
            recalculate_and_sync_row($(this).closest("tr"), "rate", $wrap);
        });
        $wrap.on("input change", ".modal-input-amount", function () {
            recalculate_and_sync_row($(this).closest("tr"), "amount", $wrap);
        });
        $wrap.on("input change", ".modal-input-tax-rate", function () {
            recalculate_and_sync_row($(this).closest("tr"), "tax_rate", $wrap);
        });
        $wrap.on("input change", ".modal-input-tax-amount", function () {
            recalculate_and_sync_row($(this).closest("tr"), "tax_amount", $wrap);
        });
        $wrap.on("input change", ".modal-input-total-amount", function () {
            recalculate_and_sync_row($(this).closest("tr"), "total_amount", $wrap);
        });
    }

    open_create_pi_from_pr_dialog(selected_items, target_comp) {
        const self = this;
        const bill_no_val = this.$body.find("#picker-opt-bill-no").val() || "";
        const default_supplier = selected_items[0].supplier || "";

        let rows_data = selected_items.map((it) => {
            const q = flt(it.this_qty || it.pending_qty || it.qty || 1.0);
            const r = flt(it.rate || 0.0);
            const a = Math.round(q * r * 100) / 100;
            const tx_pct = flt(it.tax_rate) || 13.0;
            const tx_amt = Math.round(a * (tx_pct / 100.0) * 100) / 100;
            const tot = Math.round((a + tx_amt) * 100) / 100;
            return {
                pri_name: it.pri_name || it.name,
                pr_name: it.pr_name || it.parent,
                item_code: it.item_code || "",
                item_name: it.item_name || "",
                spec: it.spec || "",
                qty: q,
                rate: r,
                amount: a,
                tax_rate: tx_pct,
                tax_amount: tx_amt,
                total_amount: tot,
                description: it.remarks || it.description || "",
            };
        });

        const recalculate_row_state = (r) => {
            const qty = flt(r.qty) || 0.0;
            const rate = flt(r.rate) || 0.0;
            r.amount = Math.round(qty * rate * 100) / 100;
            const tax_pct = flt(r.tax_rate) || 0.0;
            r.tax_amount = Math.round(r.amount * (tax_pct / 100.0) * 100) / 100;
            r.total_amount = Math.round((r.amount + r.tax_amount) * 100) / 100;
        };

        const update_bottom_summary = ($wrapper) => {
            let total_qty = 0;
            let total_amt = 0;
            let total_tax = 0;
            let grand_total = 0;
            $wrapper.find("#picker-modal-item-tbody tr").each(function () {
                const q = flt($(this).find(".modal-input-qty").val()) || 0;
                const a = flt($(this).find(".modal-input-amount").val()) || 0;
                const tx = flt($(this).find(".modal-input-tax-amount").val()) || 0;
                const tot = flt($(this).find(".modal-input-total-amount").val()) || 0;
                total_qty += q;
                total_amt += a;
                total_tax += tx;
                grand_total += tot;
            });
            $wrapper.find("#modal-sum-qty").text(total_qty.toFixed(2));
            $wrapper.find("#modal-sum-amt").text(this.fmt_money(total_amt));
            $wrapper.find("#modal-sum-tax").text(this.fmt_money(total_tax));
            $wrapper.find("#modal-sum-total").text(this.fmt_money(grand_total));
        };

        const recalculate_and_sync_row = ($tr, field_changed, $wrapper) => {
            const idx = parseInt($tr.attr("data-idx"));
            const $qty = $tr.find(".modal-input-qty");
            const $rate = $tr.find(".modal-input-rate");
            const $amount = $tr.find(".modal-input-amount");
            const $tax_rate = $tr.find(".modal-input-tax-rate");
            const $tax_amount = $tr.find(".modal-input-tax-amount");
            const $total_amount = $tr.find(".modal-input-total-amount");

            let qty = flt($qty.val()) || 0.0;
            let rate = flt($rate.val()) || 0.0;
            let amount = flt($amount.val()) || 0.0;
            let tax_rate = flt($tax_rate.val()) || 0.0;
            let tax_amount = flt($tax_amount.val()) || 0.0;
            let total_amount = flt($total_amount.val()) || 0.0;

            if (field_changed === "qty" || field_changed === "rate") {
                amount = Math.round(qty * rate * 100) / 100;
                tax_amount = Math.round(amount * (tax_rate / 100.0) * 100) / 100;
                total_amount = Math.round((amount + tax_amount) * 100) / 100;
                $amount.val(amount.toFixed(2));
                $tax_amount.val(tax_amount.toFixed(2));
                $total_amount.val(total_amount.toFixed(2));
            } else if (field_changed === "tax_rate") {
                tax_amount = Math.round(amount * (tax_rate / 100.0) * 100) / 100;
                total_amount = Math.round((amount + tax_amount) * 100) / 100;
                $tax_amount.val(tax_amount.toFixed(2));
                $total_amount.val(total_amount.toFixed(2));
            } else if (field_changed === "amount") {
                if (qty > 0) {
                    rate = Math.round((amount / qty) * 10000) / 10000;
                    $rate.val(rate);
                }
                tax_amount = Math.round(amount * (tax_rate / 100.0) * 100) / 100;
                total_amount = Math.round((amount + tax_amount) * 100) / 100;
                $tax_amount.val(tax_amount.toFixed(2));
                $total_amount.val(total_amount.toFixed(2));
            } else if (field_changed === "tax_amount") {
                total_amount = Math.round((amount + tax_amount) * 100) / 100;
                $total_amount.val(total_amount.toFixed(2));
                if (amount > 0) {
                    tax_rate = Math.round((tax_amount / amount) * 10000) / 100;
                    $tax_rate.val(tax_rate);
                }
            } else if (field_changed === "total_amount") {
                amount = Math.round((total_amount / (1 + tax_rate / 100.0)) * 100) / 100;
                tax_amount = Math.round((total_amount - amount) * 100) / 100;
                if (qty > 0) {
                    rate = Math.round((amount / qty) * 10000) / 10000;
                    $rate.val(rate);
                }
                $amount.val(amount.toFixed(2));
                $tax_amount.val(tax_amount.toFixed(2));
            }

            if (rows_data[idx]) {
                rows_data[idx].qty = qty;
                rows_data[idx].rate = rate;
                rows_data[idx].amount = amount;
                rows_data[idx].tax_rate = tax_rate;
                rows_data[idx].tax_amount = tax_amount;
                rows_data[idx].total_amount = total_amount;
            }

            update_bottom_summary($wrapper);
        };

        const render_rows = (dialog) => {
            const $wrapper = dialog.get_field("items_html").$wrapper;
            const $tbody = $wrapper.find("#picker-modal-item-tbody");
            $tbody.empty();

            rows_data.forEach((r, idx) => {
                recalculate_row_state(r);
                const tr = `
                    <tr data-idx="${idx}">
                        <td class="picker-modal-cell-center">${idx + 1}</td>
                        <td>
                            <input type="text" class="modal-input-code modal-input-readonly" readonly tabindex="-1" placeholder="物料代码..." value="${frappe.utils.escape_html(r.item_code || '')}">
                        </td>
                        <td>
                            <input type="text" class="modal-input-name modal-input-readonly" readonly tabindex="-1" placeholder="物料名称..." value="${frappe.utils.escape_html(r.item_name || '')}">
                        </td>
                        <td>
                            <input type="text" class="modal-input-spec modal-input-readonly" readonly tabindex="-1" placeholder="规格..." value="${frappe.utils.escape_html(r.spec || '')}">
                        </td>
                        <td>
                            <input type="number" step="any" min="0.0001" class="modal-input-qty" value="${r.qty}">
                        </td>
                        <td>
                            <input type="number" step="any" min="0" class="modal-input-rate" value="${r.rate}">
                        </td>
                        <td>
                            <input type="number" step="any" min="0" class="modal-input-amount" value="${flt(r.amount).toFixed(2)}">
                        </td>
                        <td>
                            <input type="number" step="any" min="0" max="100" class="modal-input-tax-rate" value="${r.tax_rate}">
                        </td>
                        <td>
                            <input type="number" step="any" min="0" class="modal-input-tax-amount" value="${flt(r.tax_amount).toFixed(2)}">
                        </td>
                        <td>
                            <input type="number" step="any" min="0" class="modal-input-total-amount" value="${flt(r.total_amount).toFixed(2)}">
                        </td>
                        <td>
                            <input type="text" class="modal-input-remarks modal-input-readonly" readonly tabindex="-1" placeholder="备注说明..." value="${frappe.utils.escape_html(r.remarks || r.description || '')}">
                        </td>
                        <td class="picker-modal-cell-center">
                            <button class="picker-modal-del-btn" data-idx="${idx}">删除</button>
                        </td>
                    </tr>
                `;
                $tbody.append(tr);
            });

            update_bottom_summary($wrapper);
        };

        const d = new frappe.ui.Dialog({
            title: __("新建采购发票 · 选单创建与明细核算"),
            fields: [
                {
                    fieldtype: "Select",
                    fieldname: "company",
                    label: __("所属公司"),
                    options: this.companies.join("\n"),
                    default: target_comp,
                    read_only: 1,
                },
                {
                    fieldtype: "Link",
                    options: "Supplier",
                    fieldname: "supplier",
                    label: __("供应商"),
                    default: default_supplier,
                    read_only: 1,
                },
                {
                    fieldtype: "Select",
                    fieldname: "invoice_type",
                    label: __("发票类型"),
                    options: ["专用发票", "普通发票"].join("\n"),
                    default: "专用发票",
                    reqd: 1,
                },
                {
                    fieldtype: "Data",
                    fieldname: "bill_no",
                    label: __("发票号码 (纸质/金税发票)"),
                    default: bill_no_val,
                },
                {
                    fieldtype: "Date",
                    fieldname: "bill_date",
                    label: __("开票日期"),
                    default: window.AshanWorkContext?.getWorkDate?.() || frappe.datetime.get_today(),
                    reqd: 1,
                },
                {
                    fieldtype: "Section Break",
                    label: __("发票物料明细与税额核算 (可核对开票数量与税额)"),
                },
                {
                    fieldtype: "HTML",
                    fieldname: "items_html",
                    options: `
                        <div>
                            <div class="picker-modal-item-table-wrap">
                                <table class="picker-modal-item-table picker-table-12cols">
                                    <thead>
                                        <tr>
                                            <th>#</th>
                                            <th>物料代码</th>
                                            <th>物料名称</th>
                                            <th>规格</th>
                                            <th>开票数量</th>
                                            <th>单价</th>
                                            <th>不含税金额</th>
                                            <th>税率 %</th>
                                            <th>税额</th>
                                            <th>含税总价</th>
                                            <th>备注</th>
                                            <th>操作</th>
                                        </tr>
                                    </thead>
                                    <tbody id="picker-modal-item-tbody"></tbody>
                                </table>
                            </div>

                            <div class="picker-modal-summary-bar">
                                <span>合计汇总:</span>
                                <div class="picker-modal-summary-items">
                                    <span>开票总数: <strong id="modal-sum-qty" class="picker-summary-highlight">0</strong></span>
                                    <span>不含税金额: <strong id="modal-sum-amt" class="picker-summary-highlight">¥ 0.00</strong></span>
                                    <span>税额: <strong id="modal-sum-tax" class="picker-summary-highlight">¥ 0.00</strong></span>
                                    <span>含税总额: <strong id="modal-sum-total" class="picker-summary-highlight">¥ 0.00</strong></span>
                                </div>
                            </div>
                        </div>
                    `,
                },
            ],
            primary_action_label: __("立即生成并正式提交采购发票"),
            primary_action: async () => {
                const vals = this.validate_and_get_dialog_values(d, [
                    { fieldname: "bill_no", label: "发票号码" },
                    { fieldname: "bill_date", label: "开票日期" },
                ]);
                if (!vals) return;

                const valid_items = rows_data.filter((r) => (r.item_code || "").trim().length > 0);
                if (!valid_items.length) {
                    frappe.msgprint(__("请至少保留一行有效的物料代码。"));
                    return;
                }

                for (let i = 0; i < valid_items.length; i++) {
                    const item = valid_items[i];
                    const item_qty = flt(item.qty || item.this_qty);
                    if (item_qty > 0) {
                        if (flt(item.rate) <= 0 || flt(item.amount) <= 0) {
                            frappe.msgprint(__("第 {0} 行物料 [{1}] 的开票数量大于0时，单价与金额必须大于0，不可为0！", [i + 1, item.item_code]));
                            return;
                        }
                    }
                }

                const items_payload = valid_items.map((r) => ({
                    pri_name: r.pri_name,
                    pr_name: r.pr_name,
                    item_code: r.item_code,
                    item_name: r.item_name,
                    spec: r.spec,
                    qty: r.qty,
                    this_qty: r.qty,
                    rate: r.rate,
                    amount: r.amount,
                    tax_rate: r.tax_rate,
                    tax_amount: r.tax_amount,
                    total_amount: r.total_amount,
                    description: r.description,
                }));

                try {
                    frappe.dom.freeze(__("正在生成采购发票..."));
                    const res = await frappe.call({
                        method: "ashan_cn_procurement.services.procurement_picker_service.make_purchase_invoices_from_pr_items",
                        args: {
                            company: target_comp,
                            selected_items: items_payload,
                            bill_no: vals.bill_no,
                            bill_date: vals.bill_date,
                            invoice_type: vals.invoice_type || "专用发票",
                        },
                    });
                    frappe.dom.unfreeze();
                    if (res && res.message && res.message.success) {
                        d.hide();
                        const invoice_names = (res.message.invoices || []).map((i) => i.name).filter(Boolean);
                        const first_pi = invoice_names[0];
                        frappe.show_alert({
                            message: __("成功生成并正式提交采购发票 <b>{0}</b>{1}", [
                                first_pi || "",
                                invoice_names.length > 1 ? ` 等共 ${invoice_names.length} 张单据` : "",
                            ]),
                            indicator: "green",
                        }, 6);
                        self.refresh_all();
                        if (first_pi) {
                            self.show_doc_detail_modal("Purchase Invoice", first_pi);
                        }
                    }
                } catch (e) {
                    frappe.dom.unfreeze();
                    frappe.msgprint(e.message || __("生成采购发票失败"));
                }
            },
        });

        d.set_secondary_action_label(__("✕ 关闭"));
        d.set_secondary_action(() => {
            d.hide();
        });

        d.$wrapper.addClass("picker-create-mr-modal");
        d.show();

        d.$wrapper.attr("data-backdrop", "static").attr("data-keyboard", "false");
        d.$wrapper.on("click", function (e) {
            if ($(e.target).hasClass("modal") || $(e.target).hasClass("modal-backdrop")) {
                e.preventDefault();
                e.stopPropagation();
            }
        });
        render_rows(d);

        const $wrap = d.get_field("items_html").$wrapper;

        $wrap.on("click", "#picker-modal-add-row-btn", () => {
            rows_data.push({ item_code: "", item_name: "", spec: "", qty: 1.0, rate: 0.0, amount: 0.0, tax_rate: 13.0, tax_amount: 0.0, total_amount: 0.0, description: "" });
            render_rows(d);
        });

        $wrap.on("click", ".picker-modal-del-btn", function () {
            const idx = parseInt($(this).attr("data-idx"));
            rows_data.splice(idx, 1);
            if (!rows_data.length) rows_data.push({ item_code: "", item_name: "", spec: "", qty: 1.0, rate: 0.0, amount: 0.0, tax_rate: 13.0, tax_amount: 0.0, total_amount: 0.0, description: "" });
            render_rows(d);
        });

        $wrap.on("input change", ".modal-input-qty", function () {
            recalculate_and_sync_row($(this).closest("tr"), "qty", $wrap);
        });
        $wrap.on("input change", ".modal-input-rate", function () {
            recalculate_and_sync_row($(this).closest("tr"), "rate", $wrap);
        });
        $wrap.on("input change", ".modal-input-amount", function () {
            recalculate_and_sync_row($(this).closest("tr"), "amount", $wrap);
        });
        $wrap.on("input change", ".modal-input-tax-rate", function () {
            recalculate_and_sync_row($(this).closest("tr"), "tax_rate", $wrap);
        });
        $wrap.on("input change", ".modal-input-tax-amount", function () {
            recalculate_and_sync_row($(this).closest("tr"), "tax_amount", $wrap);
        });
        $wrap.on("input change", ".modal-input-total-amount", function () {
            recalculate_and_sync_row($(this).closest("tr"), "total_amount", $wrap);
        });
    }

    open_create_rr_from_pi_dialog(selected_items, target_comp) {
        const self = this;
        const applicant_val = this.$body.find("#picker-opt-applicant").val() || "";
        const inv_names = Array.from(new Set(selected_items.map((i) => i.pi_name).filter(Boolean)));

        let rows_html = selected_items.map((it, idx) => `
            <tr>
                <td class="picker-modal-cell-center">${idx + 1}</td>
                <td><strong>${frappe.utils.escape_html(it.pi_name)}</strong></td>
                <td>${frappe.utils.escape_html(it.supplier || "-")}</td>
                <td>${it.bill_date || it.posting_date || "-"}</td>
                <td class="picker-money-cell">${this.fmt_money(it.grand_total)}</td>
                <td class="picker-money-cell">${this.fmt_money(it.net_available_amount || it.outstanding_amount)}</td>
                <td class="picker-money-cell cell-row-amt"><strong>${this.fmt_money(it.this_amount || it.net_available_amount || it.outstanding_amount)}</strong></td>
            </tr>
        `).join("");

        const total_claim = selected_items.reduce((s, it) => s + flt(it.this_amount || it.net_available_amount || it.outstanding_amount), 0);

        const d = new frappe.ui.Dialog({
            title: __("新建发票整算单 · 集中统算与对账结算"),
            fields: [
                {
                    fieldtype: "Select",
                    fieldname: "company",
                    label: __("所属公司"),
                    options: this.companies.join("\n"),
                    default: target_comp,
                    read_only: 1,
                },
                {
                    fieldtype: "Link",
                    options: "Employee",
                    fieldname: "applicant",
                    label: __("经手 / 申请人"),
                    default: applicant_val,
                },
                {
                    fieldtype: "Data",
                    fieldname: "purpose",
                    label: __("结算事由"),
                    default: `采购发票集中整算 (${inv_names.length}张发票)`,
                    reqd: 1,
                },
                {
                    fieldtype: "Date",
                    fieldname: "posting_date",
                    label: __("申请日期"),
                    default: window.AshanWorkContext?.getWorkDate?.() || frappe.datetime.get_today(),
                    reqd: 1,
                },
                {
                    fieldtype: "Section Break",
                    label: __("关联采购发票明细清单"),
                },
                {
                    fieldtype: "HTML",
                    fieldname: "invoices_html",
                    options: `
                        <div>
                            <div class="picker-modal-item-table-wrap">
                                <table class="picker-modal-item-table picker-table-invoices">
                                    <thead>
                                        <tr>
                                            <th>#</th>
                                            <th>发票单号</th>
                                            <th>供应商</th>
                                            <th>开票/过账日期</th>
                                            <th>发票总额</th>
                                            <th>未付金额</th>
                                            <th>本次整算金额</th>
                                        </tr>
                                    </thead>
                                    <tbody>${rows_html}</tbody>
                                </table>
                            </div>

                            <div class="picker-modal-summary-bar">
                                <span>合计汇总:</span>
                                <div class="picker-modal-summary-items">
                                    <span>发票总数: <strong class="picker-summary-highlight">${inv_names.length} 张</strong></span>
                                    <span>整算总额: <strong class="picker-summary-highlight">${this.fmt_money(total_claim)}</strong></span>
                                </div>
                            </div>
                        </div>
                    `,
                },
            ],
            primary_action_label: __("立即生成并正式提交发票整算单"),
            primary_action: async () => {
                const vals = this.validate_and_get_dialog_values(d, [
                    { fieldname: "applicant", label: "报销申请人" },
                    { fieldname: "purpose", label: "报销事由" },
                    { fieldname: "posting_date", label: "申请日期" },
                ]);
                if (!vals) return;

                try {
                    frappe.dom.freeze(__("正在生成报销申请..."));
                    const res = await frappe.call({
                        method: "ashan_cn_procurement.services.procurement_picker_service.make_reimbursement_from_invoices",
                        args: {
                            company: target_comp,
                            selected_invoices: inv_names,
                            applicant: vals.applicant,
                            purpose: vals.purpose,
                        },
                    });
                    frappe.dom.unfreeze();
                    if (res && res.message && res.message.success) {
                        d.hide();
                        const rr_name = res.message.reimbursement_name;
                        frappe.show_alert({
                            message: __("成功生成并正式提交报销付款申请 <b>{0}</b>！", [rr_name]),
                            indicator: "green",
                        }, 6);
                        self.refresh_all();
                        if (rr_name) {
                            self.show_doc_detail_modal("Reimbursement Request", rr_name);
                        }
                    }
                } catch (e) {
                    frappe.dom.unfreeze();
                    frappe.msgprint(e.message || __("生成报销申请单失败"));
                }
            },
        });

        d.set_secondary_action_label(__("✕ 关闭"));
        d.set_secondary_action(() => {
            d.hide();
        });

        d.$wrapper.addClass("picker-create-mr-modal");
        d.show();

        d.$wrapper.attr("data-backdrop", "static").attr("data-keyboard", "false");
        d.$wrapper.on("click", function (e) {
            if ($(e.target).hasClass("modal") || $(e.target).hasClass("modal-backdrop")) {
                e.preventDefault();
                e.stopPropagation();
            }
        });
    }


    async open_create_payment_entry_dialog(selected_items, target_comp) {
        const self = this;
        const inv_names = Array.from(new Set(selected_items.map((i) => i.pi_name).filter(Boolean)));
        if (!inv_names.length) return;

        const first_sup = selected_items[0].supplier || "";
        const multi_sups = Array.from(new Set(selected_items.map((i) => i.supplier).filter(Boolean)));
        if (multi_sups.length > 1) {
            frappe.msgprint({
                title: __("供应商不一致"),
                indicator: "orange",
                message: __("单笔对公电汇付款单仅支持同一供应商的发票合并结算。<br><br>您勾选的发票包含以下 {0} 个不同供应商：<br>{1}<br><br>请按同一供应商分别勾选并生成付款单。", [multi_sups.length, multi_sups.map(s => `• <strong>${frappe.utils.escape_html(s)}</strong>`).join("<br>")])
            });
            return;
        }

        frappe.dom.freeze(__("正在加载公司银行与供应商信息..."));
        let payment_accounts = [];
        let supplier_bank = {};

        try {
            const acc_res = await frappe.call({
                method: "ashan_cn_procurement.services.procurement_picker_service.get_company_payment_accounts",
                args: { company: target_comp }
            });
            payment_accounts = (acc_res && acc_res.message) || [];

            const sup_res = await frappe.call({
                method: "ashan_cn_procurement.services.procurement_picker_service.get_supplier_bank_details",
                args: { supplier: first_sup, company: target_comp }
            });
            supplier_bank = (sup_res && sup_res.message) || {};
        } catch (e) {
            console.error(e);
        } finally {
            frappe.dom.unfreeze();
        }

        const account_options = payment_accounts.map(a => ({
            label: `${a.account_name} (${a.name})`,
            value: a.name
        }));

        let total_pay_sum = 0;
        let rows_html = selected_items.map((it, idx) => {
            const out_amt = flt(it.outstanding_amount || it.net_available_amount || it.grand_total);
            const this_pay = flt(it.this_amount !== undefined ? it.this_amount : out_amt);
            total_pay_sum += this_pay;

            return `
                <tr data-name="${frappe.utils.escape_html(it.pi_name)}">
                    <td class="picker-modal-cell-center">${idx + 1}</td>
                    <td><strong>${frappe.utils.escape_html(it.pi_name)}</strong></td>
                    <td><span class="ashan-tag-badge ashan-tag-blue">${frappe.utils.escape_html(it.bill_no || '-')}</span></td>
                    <td>${it.bill_date || it.posting_date || "-"}</td>
                    <td class="picker-money-cell">${this.fmt_money(it.grand_total)}</td>
                    <td class="picker-money-cell">${this.fmt_money(out_amt)}</td>
                    <td class="picker-money-cell">
                        <input type="number" class="modal-input-pay-amt" data-pi="${frappe.utils.escape_html(it.pi_name)}" value="${this_pay.toFixed(2)}" min="0.01" max="${out_amt}" step="0.01" style="width:110px; text-align:right; font-weight:700;">
                    </td>
                </tr>
            `;
        }).join("");

        const bank_info_html = supplier_bank.bank || supplier_bank.bank_account_no
            ? `<div class="ashan-callout-info" style="margin-bottom:12px; padding:8px 12px; background:#eff6ff; border-radius:4px; border:1px solid #bfdbfe; font-size:12px;"><strong>供应商开户行信息:</strong> ${frappe.utils.escape_html(supplier_bank.bank || '')} ｜ <strong>账号:</strong> <code>${frappe.utils.escape_html(supplier_bank.bank_account_no || '')}</code></div>`
            : `<div class="ashan-callout-warning" style="margin-bottom:12px; padding:8px 12px; background:#fffbeb; border-radius:4px; border:1px solid #fef3c7; font-size:12px;">提示：该供应商档案中暂未配置银行开户账号信息，提交后可在付款凭证中核对。</div>`;

        const d = new frappe.ui.Dialog({
            title: __("新建对公电汇付款单 · 银行转账与发票核销"),
            fields: [
                {
                    fieldtype: "Select",
                    fieldname: "company",
                    label: __("所属公司"),
                    options: this.companies.join("\n"),
                    default: target_comp,
                    read_only: 1,
                },
                {
                    fieldtype: "Data",
                    fieldname: "supplier",
                    label: __("收款供应商"),
                    default: first_sup,
                    read_only: 1,
                },
                {
                    fieldtype: "Select",
                    fieldname: "paid_from",
                    label: __("付款银行账户"),
                    options: account_options.length ? account_options.map(o => o.value).join("\n") : "",
                    default: account_options.length ? account_options[0].value : "",
                    reqd: 1,
                },
                {
                    fieldtype: "Date",
                    fieldname: "posting_date",
                    label: __("付款日期"),
                    default: frappe.datetime.get_today(),
                    reqd: 1,
                },
                {
                    fieldtype: "Data",
                    fieldname: "remarks",
                    label: __("电汇附言 / 用途备注"),
                    default: `采购发票对公电汇结算 (${inv_names.length}张发票)`,
                },
                {
                    fieldtype: "Section Break",
                    label: __("关联待付采购发票清单 (下级账单)"),
                },
                {
                    fieldtype: "HTML",
                    fieldname: "invoices_html",
                    options: `
                        <div>
                            ${bank_info_html}
                            <div class="picker-modal-item-table-wrap">
                                <table class="picker-modal-item-table picker-table-pay-invoices">
                                    <thead>
                                        <tr>
                                            <th>#</th>
                                            <th>采购发票号</th>
                                            <th>发票号码</th>
                                            <th>开票日期</th>
                                            <th>发票总额</th>
                                            <th>待付余额</th>
                                            <th>本次电汇金额</th>
                                        </tr>
                                    </thead>
                                    <tbody>${rows_html}</tbody>
                                </table>
                            </div>

                            <div class="picker-modal-summary-bar">
                                <span>合计汇总:</span>
                                <div class="picker-modal-summary-items">
                                    <span>结算发票: <strong class="picker-summary-highlight">${inv_names.length} 张</strong></span>
                                    <span>电汇总额: <strong class="picker-summary-highlight modal-pay-total">${this.fmt_money(total_pay_sum)}</strong></span>
                                </div>
                            </div>
                        </div>
                    `,
                },
            ],
            primary_action_label: __("立即生成并正式提交对公电汇付款单"),
            primary_action: async () => {
                const vals = this.validate_and_get_dialog_values(d, [
                    { fieldname: "paid_from", label: "付款银行账户" },
                    { fieldname: "posting_date", label: "付款日期" },
                ]);
                if (!vals) return;

                const invoices_payload = {};
                let calculated_total = 0;
                d.$wrapper.find(".modal-input-pay-amt").each(function () {
                    const pi = $(this).attr("data-pi");
                    const amt = flt($(this).val());
                    invoices_payload[pi] = amt;
                    calculated_total += amt;
                });

                if (calculated_total <= 0) {
                    frappe.msgprint(__("本次付款总额必须大于 0 元。"));
                    return;
                }

                try {
                    frappe.dom.freeze(__("正在生成对公电汇付款单..."));
                    const res = await frappe.call({
                        method: "ashan_cn_procurement.services.procurement_picker_service.make_wire_transfer_payment_from_invoices",
                        args: {
                            company: target_comp,
                            selected_invoices: inv_names,
                            paid_from_account: vals.paid_from,
                            posting_date: vals.posting_date,
                            remarks: vals.remarks,
                            invoices_payload: invoices_payload,
                        },
                    });
                    frappe.dom.unfreeze();
                    if (res && res.message && res.message.success) {
                        d.hide();
                        const pe_name = res.message.payment_entry_name;
                        frappe.show_alert({
                            message: __("成功生成并提交对公电汇付款单 <b>{0}</b>！", [pe_name]),
                            indicator: "green",
                        }, 6);
                        self.refresh_all();
                        if (pe_name) {
                            self.show_doc_detail_modal("Payment Entry", pe_name);
                        }
                    }
                } catch (e) {
                    frappe.dom.unfreeze();
                    frappe.msgprint(e.message || __("生成电汇付款单失败"));
                }
            },
        });

        d.set_secondary_action_label(__("✕ 关闭"));
        d.set_secondary_action(() => {
            d.hide();
        });

        d.$wrapper.on("input change", ".modal-input-pay-amt", function () {
            let sum = 0;
            d.$wrapper.find(".modal-input-pay-amt").each(function () {
                sum += flt($(this).val());
            });
            d.$wrapper.find(".modal-pay-total").text(self.fmt_money(sum));
        });

        d.$wrapper.addClass("picker-create-mr-modal");
        d.show();

        d.$wrapper.attr("data-backdrop", "static").attr("data-keyboard", "false");
        d.$wrapper.on("click", function (e) {
            if ($(e.target).hasClass("modal") || $(e.target).hasClass("modal-backdrop")) {
                e.preventDefault();
                e.stopPropagation();
            }
        });
    }

    async handle_document_deletion(doctype, name, parent_dialog) {
        frappe.dom.freeze(__("正在分析单据依赖与权限..."));
        try {
            const r = await frappe.call({
                method: "ashan_cn_procurement.services.procurement_picker_service.preview_document_cascade_deletion",
                args: { doctype: doctype, name: name },
            });
            frappe.dom.unfreeze();
            if (!r || !r.message) return;
            const preview = r.message;

            if (!preview.can_delete) {
                frappe.msgprint({
                    title: __("权限不足，无法删除"),
                    indicator: "red",
                    message: __("您缺少以下关联单据的删除或撤单权限：<br><br>") + preview.missing_permissions.map(p => `• <strong>${frappe.utils.escape_html(p)}</strong>`).join("<br>")
                });
                return;
            }

            if (preview.has_downstream) {
                this.show_cascade_delete_dialog(preview, parent_dialog);
            } else {
                frappe.confirm(__("确定要删除单据 <strong>{0}</strong> ({1}) 吗？<br><br><span class='picker-danger-confirm-hint'>警告：删除后数据将无法恢复！</span>", [name, preview.target_doc.doctype_label]), async () => {
                    await this.execute_document_deletion(doctype, name, false, parent_dialog);
                });
            }
        } catch (e) {
            frappe.dom.unfreeze();
            frappe.msgprint(e.message || __("删除预检失败"));
        }
    }

    show_cascade_delete_dialog(preview, parent_dialog) {
        const self = this;
        let tree_items_html = "";
        preview.cascade_list.forEach((item, idx) => {
            const is_root = item.doctype === preview.target_doc.doctype && item.name === preview.target_doc.name;
            tree_items_html += `
                <li class="picker-cascade-tree-item ${is_root ? 'root-item' : ''}">
                    <div>
                        <span>${idx + 1}. </span>
                        <strong>${frappe.utils.escape_html(item.doctype_label)}</strong>:
                        <span class="picker-cascade-item-code">${frappe.utils.escape_html(item.name)}</span>
                        <span class="picker-cascade-item-comp">(${frappe.utils.escape_html(item.company || '')})</span>
                    </div>
                    <div class="picker-cascade-tree-item-actions">
                        <span class="picker-cascade-item-status">${item.status_text}</span>
                        <span class="picker-cascade-perm-badge-ok">权限齐备</span>
                    </div>
                </li>
            `;
        });

        const cascade_dialog = new frappe.ui.Dialog({
            title: __("关联单据级联连带删除确认"),
            fields: [
                {
                    fieldtype: "HTML",
                    fieldname: "cascade_html",
                    options: `
                        <div class="picker-cascade-box">
                            <div class="picker-cascade-warning-alert">
                                <strong>警告：检测到该单据已生成下游关联业务单据！</strong><br>
                                若继续删除，系统将按照业务依赖严格逆序（最下游 ➔ 最上游）依次执行<strong>撤销提交、还原库存/已订数量、彻底删除单据</strong>。
                            </div>
                            <div class="picker-cascade-target-heading">
                                将连带逆序删除以下全部 ${preview.cascade_count} 张单据：
                            </div>
                            <ul class="picker-cascade-tree-list">
                                ${tree_items_html}
                            </ul>
                            <div class="picker-cascade-security-hint">
                                系统已完成全链路权限校验：当前用户对上述全部单据均拥有删除与撤单权限。
                            </div>
                        </div>
                    `,
                }
            ],
            primary_action_label: __("确认连带删除全部 {0} 张单据", [preview.cascade_count]),
            primary_action: async () => {
                cascade_dialog.hide();
                await self.execute_document_deletion(preview.target_doc.doctype, preview.target_doc.name, true, parent_dialog);
            }
        });

        cascade_dialog.show();
    }

    async execute_document_deletion(doctype, name, cascade, parent_dialog) {
        frappe.dom.freeze(__("正在执行安全删除..."));
        try {
            const r = await frappe.call({
                method: "ashan_cn_procurement.services.procurement_picker_service.delete_procurement_document",
                args: {
                    doctype: doctype,
                    name: name,
                    cascade: cascade ? 1 : 0
                }
            });
            frappe.dom.unfreeze();
            if (r && r.message && r.message.success) {
                frappe.show_alert({
                    message: r.message.message || __("删除成功"),
                    indicator: "green"
                }, 5);
                if (parent_dialog) {
                    parent_dialog.hide();
                }
                this.selected_map.clear();
                this.locked_company = null;
                this.update_company_lock_ui();
                await this.refresh_all();
            }
        } catch (e) {
            frappe.dom.unfreeze();
            frappe.msgprint(e.message || __("删除失败"));
        }
    }

    async batch_delete_selected() {
        const selected_items = Array.from(this.selected_map.values());
        if (!selected_items.length) {
            frappe.msgprint(__("请先勾选需要删除的单据/明细。"));
            return;
        }

        const stage = this.active_stage;
        let doctype = "Material Request";
        let docnames = new Set();

        if (stage === "item_to_mr" || stage === "mr_to_po") {
            doctype = "Material Request";
            selected_items.forEach(i => { if (i.mr_name) docnames.add(i.mr_name); });
        } else if (stage === "po_to_pr") {
            doctype = "Purchase Order";
            selected_items.forEach(i => { if (i.po_name) docnames.add(i.po_name); });
        } else if (stage === "pr_to_pi") {
            doctype = "Purchase Receipt";
            selected_items.forEach(i => { if (i.pr_name) docnames.add(i.pr_name); });
        } else if (stage === "pi_to_rr") {
            doctype = "Purchase Invoice";
            selected_items.forEach(i => { if (i.pi_name) docnames.add(i.pi_name); });
        } else if (stage === "pi_to_pay") {
            doctype = (this.view_modes[stage] === "doc" && selected_items[0] && selected_items[0].pe_name) ? "Payment Entry" : "Purchase Invoice";
            selected_items.forEach(i => { if (i.pe_name || i.pi_name) docnames.add(i.pe_name || i.pi_name); });
        }

        const docname_list = Array.from(docnames);
        if (!docname_list.length) {
            frappe.msgprint(__("未找到可删除的单据编号。"));
            return;
        }

        if (docname_list.length === 1) {
            this.handle_document_deletion(doctype, docname_list[0]);
        } else {
            frappe.confirm(__("确定要删除勾选的 <strong>{0}</strong> 张单据吗？<br><br>{1}<br><br><span class='picker-danger-confirm-hint'>提示：若所选单据存在下游业务依赖，系统将按全链路依赖严格逆序自动连带撤单与删除。</span>", [docname_list.length, docname_list.map(n => `• ${frappe.utils.escape_html(n)}`).join("<br>")]), async () => {
                frappe.dom.freeze(__("正在批量分析并安全删除单据..."));
                try {
                    const r = await frappe.call({
                        method: "ashan_cn_procurement.services.procurement_picker_service.batch_delete_procurement_documents",
                        args: { doctype: doctype, names: docname_list, cascade: 1 }
                    });
                    frappe.dom.unfreeze();
                    if (r && r.message) {
                        const res = r.message;
                        if (res.fail_count > 0) {
                            const err_list = (res.failures || []).map(f => `• <strong>${frappe.utils.escape_html(f.name)}</strong>: ${frappe.utils.escape_html(f.error || '删除失败')}`);
                            frappe.msgprint({
                                title: __("批量删除部分完成"),
                                indicator: "orange",
                                message: __("成功删除 {0} 张单据，以下 {1} 张单据未能删除：<br><br>{2}", [res.success_count, res.fail_count, err_list.join("<br>")])
                            });
                        } else {
                            frappe.show_alert({ message: __("成功批量删除全部 {0} 张单据", [res.success_count]), indicator: "green" });
                        }
                        this.selected_map.clear();
                        this.locked_company = null;
                        this.update_company_lock_ui();
                        await this.refresh_all();
                    }
                } catch (e) {
                    frappe.dom.unfreeze();
                    frappe.msgprint({
                        title: __("批量删除失败"),
                        indicator: "red",
                        message: e.message || __("批量删除请求失败，请检查网络或单据权限。")
                    });
                }
            });
        }
    }

    async batch_cancel_material_requests() {
        const selected_items = Array.from(this.selected_map.values());
        if (!selected_items.length) {
            frappe.msgprint(__("请先勾选需要撤单的物料申请。"));
            return;
        }

        const docnames = Array.from(new Set(selected_items.map(i => i.mr_name || i.name).filter(Boolean)));
        if (!docnames.length) {
            frappe.msgprint(__("未找到对应的采购申请单号。"));
            return;
        }

        const draft_docs = [];
        selected_items.forEach(i => {
            const nm = i.mr_name || i.name;
            if ((i.docstatus === 0 || i.status === "Draft") && !draft_docs.includes(nm)) {
                draft_docs.push(nm);
            }
        });

        if (draft_docs.length === docnames.length) {
            frappe.msgprint({
                title: __("无需撤单"),
                indicator: "orange",
                message: __("所选申请单均为【草稿】状态，尚未正式提交，无需撤单。<br><br>如需移除草稿，请直接点击【<strong>删除单据</strong>】。")
            });
            return;
        }

        const submitted_names = docnames.filter(n => !draft_docs.includes(n));
        let confirm_msg = __("确定要对所选的 <strong>{0}</strong> 张采购申请单执行<strong>撤单</strong>吗？<br><br>{1}<br><br><span class='text-muted'>规则提示：仅限尚未生成下游采购订单等关联单据的申请单允许撤单。撤单后单据状态将变更为【已作废】。</span>", [
            submitted_names.length,
            submitted_names.map(n => `• <strong>${frappe.utils.escape_html(n)}</strong>`).join("<br>")
        ]);

        if (draft_docs.length > 0) {
            confirm_msg += `<br><br><span style="color:var(--ashan-color-amber-600, #d97706);">提示：所选单据中包含草稿（${draft_docs.join('、')}），撤单将仅对已提交的正式申请单生效。</span>`;
        }

        frappe.confirm(confirm_msg, async () => {
            frappe.dom.freeze(__("正在执行采购申请撤单..."));
            try {
                const r = await frappe.call({
                    method: "ashan_cn_procurement.services.procurement_picker_service.batch_cancel_material_requests",
                    args: { names: submitted_names },
                });
                frappe.dom.unfreeze();
                if (r && r.message) {
                    frappe.show_alert({
                        message: r.message.message || __("撤单成功"),
                        indicator: "green"
                    }, 5);
                    this.selected_map.clear();
                    this.locked_company = null;
                    this.update_company_lock_ui();
                    await this.refresh_all();
                }
            } catch (e) {
                frappe.dom.unfreeze();
                frappe.msgprint({
                    title: __("撤单失败"),
                    indicator: "red",
                    message: e.message || __("撤单执行失败，请检查单据是否已生成下游关联单据。")
                });
            }
        });
    }

    async batch_delete_material_requests() {
        const selected_items = Array.from(this.selected_map.values());
        if (!selected_items.length) {
            frappe.msgprint(__("请先勾选需要删除的采购申请。"));
            return;
        }

        const docnames = Array.from(new Set(selected_items.map(i => i.mr_name || i.name).filter(Boolean)));
        if (!docnames.length) {
            frappe.msgprint(__("未找到对应的采购申请单号。"));
            return;
        }

        const confirm_msg = __(
            "确定要彻底删除所选的 <strong>{0}</strong> 张采购申请单吗？<br><br>{1}<br><br><span class='picker-danger-confirm-hint'>规则提示：根据管理规范，<strong>仅限没有关联单据情况允许删除</strong>！若单据已关联下游采购订单、询价单等，系统将严格拒绝删除。</span>",
            [docnames.length, docnames.map(n => `• <strong>${frappe.utils.escape_html(n)}</strong>`).join("<br>")]
        );

        frappe.confirm(confirm_msg, async () => {
            frappe.dom.freeze(__("正在校验并执行删除..."));
            try {
                const r = await frappe.call({
                    method: "ashan_cn_procurement.services.procurement_picker_service.batch_delete_material_requests",
                    args: { names: docnames },
                });
                frappe.dom.unfreeze();
                if (r && r.message) {
                    frappe.show_alert({
                        message: r.message.message || __("删除成功"),
                        indicator: "green"
                    }, 5);
                    this.selected_map.clear();
                    this.locked_company = null;
                    this.update_company_lock_ui();
                    await this.refresh_all();
                }
            } catch (e) {
                frappe.dom.unfreeze();
                frappe.msgprint({
                    title: __("无法删除"),
                    indicator: "red",
                    message: e.message || __("删除失败，请检查是否存在关联单据。")
                });
            }
        });
    }
}

window.AshanProcurementWorkbench = Object.freeze({
    mount(wrapper, profile_key) {
        if (wrapper.ashan_procurement_workbench) {
            wrapper.ashan_procurement_workbench.show();
            return wrapper.ashan_procurement_workbench;
        }
        const profile = PROCUREMENT_WORKBENCH_PROFILES[profile_key];
        if (!profile) {
            frappe.throw(__("未知的采购工作台类型。"));
        }
        const page = frappe.ui.make_app_page({
            parent: wrapper,
            title: __(profile.title),
            single_column: true,
        });
        $(page.wrapper).find(".page-head").hide();
        wrapper.ashan_procurement_workbench = new ProcurementOrderPickerCenter(page, profile);
        return wrapper.ashan_procurement_workbench;
    },
});
})();

