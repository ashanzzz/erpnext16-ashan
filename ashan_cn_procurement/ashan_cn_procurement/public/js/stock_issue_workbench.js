// Copyright (c) 2026, Ashan CN Procurement and contributors
// 材料出库工作台 (Stock Issue Workbench) - 前端交互中枢

frappe.pages['stock-issue-workbench'].on_page_load = function (wrapper) {
    frappe.ui.make_app_page({
        parent: wrapper,
        title: __('材料出库'),
        single_column: true,
    });

    frappe.require([
        '/assets/ashan_cn_procurement/css/ashan_ui_kit.css',
        '/assets/ashan_cn_procurement/css/stock_issue_workbench.css',
        '/assets/ashan_cn_procurement/js/ashan_ui_kit.js',
    ]);

    wrapper.stock_issue_wb = new AshanStockIssueWorkbench(wrapper);
};

frappe.pages['stock-issue-workbench'].on_page_show = function (wrapper) {
    if (wrapper.stock_issue_wb) {
        wrapper.stock_issue_wb.show();
    }
};

class AshanStockIssueWorkbench {
    constructor(wrapper) {
        this.wrapper = wrapper;
        this.page = wrapper.page;
        this.$body = $(wrapper).find('.layout-main-section');
        
        this.company = window.AshanWorkContext ? window.AshanWorkContext.getCompany() : '天津吉众科技有限公司';
        if (this.company === 'All') this.company = '天津吉众科技有限公司';
        
        this.view_mode = 'vouchers'; // 'vouchers' | 'inventory'
        this.status_filter = 'all';
        this.period_filter = 'month';
        this.warehouse_filter = '';
        this.search_text = '';
        this.page_index = 1;
        this.page_size = 50;
        
        this.selected_inventory_items = new Map(); // key: warehouse::item_code -> item_obj
        
        this.meta = {
            companies: [],
            warehouses: [],
            departments: [],
            purposes: []
        };
        
        this.init();
    }

    init() {
        this.render_layout();
        this.load_meta().then(() => {
            this.bind_events();
            this.refresh_all();
        });
    }

    show() {
        const current_ctx_company = window.AshanWorkContext ? window.AshanWorkContext.getCompany() : null;
        if (current_ctx_company && current_ctx_company !== 'All' && current_ctx_company !== this.company) {
            this.company = current_ctx_company;
            if (this.$company_select) this.$company_select.val(this.company);
            this.selected_inventory_items.clear();
            this.render_floating_cart();
            this.load_meta().then(() => this.refresh_all());
        } else {
            this.refresh_all();
        }
    }

    render_layout() {
        const html = `
            <div class="stock-issue-workbench-page">
                <!-- Header Container -->
                <div class="si-header-container">
                    <div class="si-header-left">
                        <div class="si-title-box">
                            <h3>材料出库</h3>
                            <p>登记车间领料、维修改造与部门领用，支持仓库实存感知、库存上限强约束与直接过账</p>
                        </div>
                        <select class="si-company-select"></select>
                    </div>
                    <div class="si-header-right">
                        <div class="si-view-switch-control">
                            <button type="button" class="si-view-switch-btn ${this.view_mode === 'vouchers' ? 'active' : ''}" data-mode="vouchers">📋 出库单据台账</button>
                            <button type="button" class="si-view-switch-btn ${this.view_mode === 'inventory' ? 'active' : ''}" data-mode="inventory">📦 现存库存选料出库</button>
                        </div>
                        <button type="button" class="btn btn-sm btn-default si-refresh-btn">刷新</button>
                        <button type="button" class="btn btn-sm btn-primary si-quick-issue-btn">⚡ 极速出库</button>
                    </div>
                </div>

                <!-- KPI Metric Strip -->
                <div class="si-kpi-grid">
                    <div class="si-kpi-card">
                        <div class="si-kpi-label">今日出库</div>
                        <div class="si-kpi-val si-kpi-today-count">0 笔</div>
                        <div class="si-kpi-sub si-kpi-today-qty">出库总量 0.00 Nos</div>
                    </div>
                    <div class="si-kpi-card">
                        <div class="si-kpi-label">本期累计出库</div>
                        <div class="si-kpi-val si-kpi-period-count">0 笔</div>
                        <div class="si-kpi-sub si-kpi-period-qty">出库总量 0.00 Nos (共 0 种物料)</div>
                    </div>
                    <div class="si-kpi-card si-kpi-card-draft">
                        <div class="si-kpi-label">待提交草稿</div>
                        <div class="si-kpi-val si-kpi-draft-count">0 笔</div>
                        <div class="si-kpi-sub">点击可快速筛选未生效草稿</div>
                    </div>
                    <div class="si-kpi-card">
                        <div class="si-kpi-label">常用操作与规范</div>
                        <div class="si-kpi-val si-kpi-val-text">默认直接过账生效</div>
                        <div class="si-kpi-sub">支持现存库存勾选出库 · 严禁超库存出库</div>
                    </div>
                </div>

                <!-- Control & Filter Strip -->
                <div class="si-control-strip">
                    <div class="si-control-left">
                        <div class="si-vouchers-filters">
                            <div class="ashan-segmented-control si-status-segments">
                                <button type="button" class="ashan-segment-btn active" data-status="all">全部</button>
                                <button type="button" class="ashan-segment-btn" data-status="draft">待提交草稿</button>
                                <button type="button" class="ashan-segment-btn" data-status="submitted">已过账生效</button>
                                <button type="button" class="ashan-segment-btn" data-status="cancelled">已作废</button>
                            </div>
                            <div class="si-period-capsules">
                                <button type="button" class="si-period-btn active" data-period="month">本月</button>
                                <button type="button" class="si-period-btn" data-period="3m">近3月</button>
                                <button type="button" class="si-period-btn" data-period="6m">近半年</button>
                                <button type="button" class="si-period-btn" data-period="year">今年</button>
                            </div>
                        </div>
                        <div class="si-inventory-tip">
                            <span class="si-item-title">📦 现存实物库存清单</span>
                            <span class="si-item-remarks">（勾选想要领用的物料，可一键批量生成出库单）</span>
                        </div>
                    </div>
                    <div class="si-control-right">
                        <select class="si-filter-select si-warehouse-filter">
                            <option value="">全部发货仓库</option>
                        </select>
                        <input type="text" class="si-search-input" placeholder="搜索单号 / 物料 / 备注..." />
                        <button type="button" class="btn btn-xs btn-default si-reset-filter-btn">重置</button>
                    </div>
                </div>

                <!-- Data Table Card -->
                <div class="si-table-card">
                    <div class="si-table-wrapper">
                        <table class="si-data-table">
                            <thead class="si-table-head">
                            </thead>
                            <tbody class="si-table-body">
                                <tr>
                                    <td colspan="9" class="si-empty-box">
                                        <div class="si-empty-title">正在加载数据...</div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Floating Cart Action Bar Mount Point -->
                <div class="si-floating-cart-mount"></div>
            </div>
        `;

        this.$body.empty().html(html);
        this.$company_select = this.$body.find('.si-company-select');
        this.$warehouse_select = this.$body.find('.si-warehouse-filter');
        this.$table_head = this.$body.find('.si-table-head');
        this.$table_body = this.$body.find('.si-table-body');
        this.$search_input = this.$body.find('.si-search-input');
        this.$floating_mount = this.$body.find('.si-floating-cart-mount');
    }

    async load_meta() {
        try {
            const res = await frappe.call({
                method: 'ashan_cn_procurement.ashan_cn_procurement.page.stock_issue_workbench.stock_issue_workbench.get_stock_issue_meta',
                args: { company: this.company }
            });
            if (res && res.message) {
                this.meta = res.message;
                this.company = this.meta.selected_company || this.company;
                this.render_meta_options();
            }
        } catch (e) {
            console.error('Failed to load stock issue meta:', e);
        }
    }

    render_meta_options() {
        let comp_html = '';
        (this.meta.companies || []).forEach(c => {
            comp_html += `<option value="${c}" ${c === this.company ? 'selected' : ''}>${c}</option>`;
        });
        this.$company_select.html(comp_html);

        let wh_html = '<option value="">全部发货仓库</option>';
        (this.meta.warehouses || []).forEach(w => {
            wh_html += `<option value="${w.name}">${w.warehouse_name || w.name}</option>`;
        });
        this.$warehouse_select.html(wh_html);
    }

    bind_events() {
        const self = this;

        this.$company_select.on('change', function () {
            self.company = $(this).val();
            if (window.AshanWorkContext) window.AshanWorkContext.setCompany(self.company);
            self.selected_inventory_items.clear();
            self.render_floating_cart();
            self.load_meta().then(() => self.refresh_all());
        });

        this.$body.find('.si-view-switch-btn').on('click', function () {
            $(this).siblings().removeClass('active');
            $(this).addClass('active');
            self.view_mode = $(this).data('mode');
            self.page_index = 1;
            
            if (self.view_mode === 'vouchers') {
                self.$body.find('.si-vouchers-filters').show();
                self.$body.find('.si-inventory-tip').hide();
                self.$search_input.attr('placeholder', '搜索单号 / 物料 / 备注...');
            } else {
                self.$body.find('.si-vouchers-filters').hide();
                self.$body.find('.si-inventory-tip').show();
                self.$search_input.attr('placeholder', '搜索现存物料编码 / 名称 / 仓库...');
            }
            self.load_data();
            self.render_floating_cart();
        });

        this.$body.find('.si-status-segments .ashan-segment-btn').on('click', function () {
            $(this).siblings().removeClass('active');
            $(this).addClass('active');
            self.status_filter = $(this).data('status');
            self.page_index = 1;
            self.load_data();
        });

        this.$body.find('.si-kpi-card-draft').on('click', function () {
            if (self.view_mode !== 'vouchers') {
                self.$body.find('.si-view-switch-btn[data-mode="vouchers"]').click();
            }
            self.$body.find('.si-status-segments .ashan-segment-btn').removeClass('active');
            self.$body.find('.si-status-segments .ashan-segment-btn[data-status="draft"]').addClass('active');
            self.status_filter = 'draft';
            self.page_index = 1;
            self.load_data();
        });

        this.$body.find('.si-period-capsules .si-period-btn').on('click', function () {
            $(this).siblings().removeClass('active');
            $(this).addClass('active');
            self.period_filter = $(this).data('period');
            self.page_index = 1;
            self.refresh_all();
        });

        this.$warehouse_select.on('change', function () {
            self.warehouse_filter = $(this).val();
            self.page_index = 1;
            self.load_data();
        });

        let search_timer = null;
        this.$search_input.on('input', function () {
            clearTimeout(search_timer);
            search_timer = setTimeout(() => {
                self.search_text = $(this).val();
                self.page_index = 1;
                self.load_data();
            }, 250);
        });

        this.$body.find('.si-reset-filter-btn').on('click', function () {
            self.status_filter = 'all';
            self.period_filter = 'month';
            self.warehouse_filter = '';
            self.search_text = '';
            self.page_index = 1;
            
            self.$body.find('.si-status-segments .ashan-segment-btn').removeClass('active');
            self.$body.find('.si-status-segments .ashan-segment-btn[data-status="all"]').addClass('active');
            self.$body.find('.si-period-capsules .si-period-btn').removeClass('active');
            self.$body.find('.si-period-capsules .si-period-btn[data-period="month"]').addClass('active');
            self.$warehouse_select.val('');
            self.$search_input.val('');
            
            self.refresh_all();
        });

        this.$body.find('.si-refresh-btn').on('click', () => this.refresh_all());
        this.$body.find('.si-quick-issue-btn').on('click', () => this.open_quick_issue_dialog());
    }

    get_date_range() {
        const today = frappe.datetime.get_today();
        let from_date = '';
        let to_date = today;

        if (this.period_filter === 'month') {
            from_date = frappe.datetime.month_start();
        } else if (this.period_filter === '3m') {
            from_date = frappe.datetime.add_months(today, -3);
        } else if (this.period_filter === '6m') {
            from_date = frappe.datetime.add_months(today, -6);
        } else if (this.period_filter === 'year') {
            from_date = frappe.datetime.year_start();
        }
        return { from_date, to_date };
    }

    async refresh_all() {
        await Promise.all([
            this.load_kpis(),
            this.load_data()
        ]);
    }

    async load_kpis() {
        const { from_date, to_date } = this.get_date_range();
        try {
            const res = await frappe.call({
                method: 'ashan_cn_procurement.ashan_cn_procurement.page.stock_issue_workbench.stock_issue_workbench.get_stock_issue_kpis',
                args: {
                    company: this.company,
                    from_date: from_date,
                    to_date: to_date
                }
            });
            if (res && res.message) {
                const k = res.message;
                this.$body.find('.si-kpi-today-count').text(`${k.today_count || 0} 笔`);
                this.$body.find('.si-kpi-today-qty').text(`出库总量 ${(k.today_qty || 0).toFixed(2)} Nos`);
                this.$body.find('.si-kpi-period-count').text(`${k.period_count || 0} 笔`);
                this.$body.find('.si-kpi-period-qty').text(`出库总量 ${(k.period_qty || 0).toFixed(2)} Nos (共 ${k.period_distinct_items || 0} 种物料)`);
                this.$body.find('.si-kpi-draft-count').text(`${k.draft_count || 0} 笔`);
            }
        } catch (e) {
            console.error('Failed to load KPIs:', e);
        }
    }

    async load_data() {
        if (this.view_mode === 'vouchers') {
            await this.load_vouchers_data();
        } else {
            await this.load_inventory_data();
        }
    }

    async load_vouchers_data() {
        const { from_date, to_date } = this.get_date_range();
        
        this.$table_head.html(`
            <tr>
                <th class="si-col-sticky-1">序号</th>
                <th class="si-col-sticky-2">单据编号</th>
                <th>记账日期</th>
                <th>出库发货仓库</th>
                <th>业务性质 / 领料用途</th>
                <th>出库物料摘要</th>
                <th class="si-text-right">出库数量</th>
                <th class="si-text-right">发货仓当前结存</th>
                <th>单据状态</th>
                <th class="si-action-col">操作</th>
            </tr>
        `);

        this.$table_body.html(`
            <tr>
                <td colspan="10" class="si-empty-box">
                    <div class="si-empty-title">正在查询出库单据...</div>
                </td>
            </tr>
        `);

        try {
            const res = await frappe.call({
                method: 'ashan_cn_procurement.ashan_cn_procurement.page.stock_issue_workbench.stock_issue_workbench.get_stock_issue_list',
                args: {
                    company: this.company,
                    status: this.status_filter,
                    warehouse: this.warehouse_filter,
                    from_date: from_date,
                    to_date: to_date,
                    search_text: this.search_text,
                    page_index: this.page_index,
                    page_size: this.page_size
                }
            });

            if (res && res.message) {
                this.render_vouchers_rows(res.message.records || []);
            }
        } catch (e) {
            console.error('Failed to load stock issue list:', e);
            this.$table_body.html(`
                <tr>
                    <td colspan="10" class="si-empty-box">
                        <div class="si-empty-title si-empty-title-danger">加载失败</div>
                        <div class="si-empty-desc">${e.message || '请稍后重试'}</div>
                    </td>
                </tr>
            `);
        }
    }

    render_vouchers_rows(records) {
        if (!records || records.length === 0) {
            this.$table_body.html(`
                <tr>
                    <td colspan="10" class="si-empty-box">
                        <div class="si-empty-title">暂无符合条件的材料出库单据</div>
                        <div class="si-empty-desc">当前筛选期间或仓库下未产生出库业务，您可以发起一笔极速出库</div>
                        <button type="button" class="btn btn-sm btn-primary si-empty-create-btn">⚡ 立即发起出库</button>
                    </td>
                </tr>
            `);
            this.$table_body.find('.si-empty-create-btn').on('click', () => this.open_quick_issue_dialog());
            return;
        }

        let rows_html = '';
        records.forEach((r, idx) => {
            const row_class = r.docstatus === 0 ? 'si-row-draft' : '';
            const status_class = r.docstatus === 0 ? 'si-status-draft' : (r.docstatus === 1 ? 'si-status-submitted' : 'si-status-cancelled');
            
            rows_html += `
                <tr class="${row_class}">
                    <td class="si-col-sticky-1">${idx + 1}</td>
                    <td class="si-col-sticky-2">
                        <a href="javascript:void(0)" class="si-link si-voucher-link" data-name="${r.name}">${r.name}</a>
                    </td>
                    <td>${r.posting_date} ${r.posting_time || ''}</td>
                    <td>${r.s_warehouse || '-'}</td>
                    <td>
                        <span class="si-item-title">${r.purpose_label || r.purpose}</span>
                        ${r.remarks ? `<div class="si-item-remarks">${r.remarks}</div>` : ''}
                    </td>
                    <td>
                        <div class="si-item-summary">${r.items_summary || '-'}</div>
                    </td>
                    <td class="si-qty-out">${r.qty_display || `-${(flt(r.total_qty) || 0).toFixed(2)} ${r.stock_uom || 'Nos'}`}</td>
                    <td class="si-text-right">
                        <span class="si-stock-text" title="${r.current_stock_tooltip || ''}">${r.current_stock_display || '-'}</span>
                    </td>
                    <td>
                        <span class="si-status-badge ${status_class}">${r.status_label}</span>
                    </td>
                    <td class="si-text-center">
                        <button type="button" class="btn btn-xs btn-default si-view-detail-btn" data-name="${r.name}">查看明细</button>
                        ${r.docstatus === 1 ? `<button type="button" class="btn btn-xs btn-default si-cancel-btn si-btn-danger-text" data-name="${r.name}">作废</button>` : ''}
                    </td>
                </tr>
            `;
        });

        this.$table_body.html(rows_html);

        const self = this;
        this.$table_body.find('.si-voucher-link, .si-view-detail-btn').on('click', function () {
            const name = $(this).data('name');
            self.open_voucher_detail(name);
        });

        this.$table_body.find('.si-cancel-btn').on('click', function () {
            const name = $(this).data('name');
            self.cancel_voucher(name);
        });
    }

    async load_inventory_data() {
        this.$table_head.html(`
            <tr>
                <th class="si-checkbox-cell">
                    <input type="checkbox" class="si-checkbox-input si-select-all-inventory" title="全选/取消全选" />
                </th>
                <th class="si-col-sticky-1">序号</th>
                <th class="si-col-sticky-2">物料编码</th>
                <th>物料名称</th>
                <th>规格型号</th>
                <th>物料分类</th>
                <th>存放发货仓</th>
                <th class="si-text-right">当前实物结存</th>
                <th class="si-action-col">操作</th>
            </tr>
        `);

        this.$table_body.html(`
            <tr>
                <td colspan="9" class="si-empty-box">
                    <div class="si-empty-title">正在查询现存实物库存...</div>
                </td>
            </tr>
        `);

        try {
            const res = await frappe.call({
                method: 'ashan_cn_procurement.ashan_cn_procurement.page.stock_issue_workbench.stock_issue_workbench.get_company_stock_inventory',
                args: {
                    company: this.company,
                    warehouse: this.warehouse_filter,
                    search_text: this.search_text,
                    page_index: this.page_index,
                    page_size: this.page_size
                }
            });

            if (res && res.message) {
                this.render_inventory_rows(res.message.records || [], res.message.total_stock_qty || 0);
            }
        } catch (e) {
            console.error('Failed to load stock inventory:', e);
            this.$table_body.html(`
                <tr>
                    <td colspan="9" class="si-empty-box">
                        <div class="si-empty-title si-empty-title-danger">库存查询失败</div>
                        <div class="si-empty-desc">${e.message || '请稍后重试'}</div>
                    </td>
                </tr>
            `);
        }
    }

    render_inventory_rows(records, total_stock_qty) {
        const self = this;
        if (!records || records.length === 0) {
            this.$table_body.html(`
                <tr>
                    <td colspan="9" class="si-empty-box">
                        <div class="si-empty-title">所选仓库当前暂无实物库存 (库存为 0.00)</div>
                        <div class="si-empty-desc">您可以切换仓库或在采购入库/物料调拨中完成入库</div>
                    </td>
                </tr>
            `);
            return;
        }

        let rows_html = '';
        records.forEach((r, idx) => {
            const key = `${r.warehouse}::${r.item_code}`;
            const is_selected = self.selected_inventory_items.has(key);
            const row_class = is_selected ? 'si-row-checked' : '';
            const avail = flt(r.actual_qty) || 0;

            rows_html += `
                <tr class="${row_class}" data-key="${key}" data-code="${r.item_code}" data-name="${r.item_name || ''}" data-desc="${r.description || ''}" data-uom="${r.stock_uom || 'Nos'}" data-wh="${r.warehouse}" data-avail="${avail}">
                    <td class="si-checkbox-cell">
                        <input type="checkbox" class="si-checkbox-input si-row-inventory-check" ${is_selected ? 'checked' : ''} />
                    </td>
                    <td class="si-col-sticky-1">${idx + 1}</td>
                    <td class="si-col-sticky-2">
                        <strong class="si-link si-inventory-item-code">${r.item_code}</strong>
                    </td>
                    <td>
                        <span class="si-item-title">${r.item_name || r.item_code}</span>
                    </td>
                    <td>
                        <span class="si-row-spec-text">${r.description || '-'}</span>
                    </td>
                    <td>${r.item_group || '-'}</td>
                    <td>${r.warehouse_name || r.warehouse}</td>
                    <td class="si-text-right">
                        <span class="si-stock-text ${avail <= 0 ? 'zero' : ''}">${avail.toFixed(2)} ${r.stock_uom || 'Nos'}</span>
                    </td>
                    <td class="si-text-center">
                        <button type="button" class="btn btn-xs btn-default si-single-issue-btn">领料出库</button>
                    </td>
                </tr>
            `;
        });

        this.$table_body.html(rows_html);

        this.$table_head.find('.si-select-all-inventory').on('change', function () {
            const checked = $(this).is(':checked');
            self.$table_body.find('.si-row-inventory-check').prop('checked', checked);
            self.$table_body.find('tr').each(function () {
                const key = $(this).data('key');
                if (key) {
                    if (checked) {
                        $(this).addClass('si-row-checked');
                        self.selected_inventory_items.set(key, {
                            item_code: $(this).data('code'),
                            item_name: $(this).data('name'),
                            description: $(this).data('desc'),
                            stock_uom: $(this).data('uom'),
                            warehouse: $(this).data('wh'),
                            actual_qty: flt($(this).data('avail'))
                        });
                    } else {
                        $(this).removeClass('si-row-checked');
                        self.selected_inventory_items.delete(key);
                    }
                }
            });
            self.render_floating_cart();
        });

        this.$table_body.find('.si-row-inventory-check').on('change', function () {
            const $tr = $(this).closest('tr');
            const key = $tr.data('key');
            const checked = $(this).is(':checked');

            if (checked) {
                $tr.addClass('si-row-checked');
                self.selected_inventory_items.set(key, {
                    item_code: $tr.data('code'),
                    item_name: $tr.data('name'),
                    description: $tr.data('desc'),
                    stock_uom: $tr.data('uom'),
                    warehouse: $tr.data('wh'),
                    actual_qty: flt($tr.data('avail'))
                });
            } else {
                $tr.removeClass('si-row-checked');
                self.selected_inventory_items.delete(key);
            }
            self.render_floating_cart();
        });

        this.$table_body.find('.si-single-issue-btn').on('click', function () {
            const $tr = $(this).closest('tr');
            const item_obj = {
                item_code: $tr.data('code'),
                item_name: $tr.data('name'),
                description: $tr.data('desc'),
                stock_uom: $tr.data('uom'),
                warehouse: $tr.data('wh'),
                actual_qty: flt($tr.data('avail'))
            };
            self.open_quick_issue_dialog([item_obj]);
        });
    }

    render_floating_cart() {
        const count = this.selected_inventory_items.size;
        if (count === 0 || this.view_mode !== 'inventory') {
            this.$floating_mount.empty();
            return;
        }

        const items_array = Array.from(this.selected_inventory_items.values());
        let tags_html = '';
        items_array.slice(0, 3).forEach(it => {
            tags_html += `<span class="si-cart-tag">${it.item_name || it.item_code} (${it.actual_qty} ${it.stock_uom})</span>`;
        });
        if (items_array.length > 3) {
            tags_html += `<span class="si-cart-tag">+${items_array.length - 3}...</span>`;
        }

        const cart_html = `
            <div class="si-floating-cart-bar">
                <div class="si-cart-left">
                    <span class="si-cart-count-badge">${count}</span>
                    <span class="si-cart-title">已选待出库物料</span>
                    <div class="si-cart-preview-tags">${tags_html}</div>
                </div>
                <div class="si-cart-right">
                    <button type="button" class="si-cart-clear-btn">清空已选</button>
                    <button type="button" class="si-cart-submit-btn">🚀 发起出库 (${count} 项)</button>
                </div>
            </div>
        `;

        this.$floating_mount.html(cart_html);

        const self = this;
        this.$floating_mount.find('.si-cart-clear-btn').on('click', function () {
            self.selected_inventory_items.clear();
            self.$table_body.find('.si-row-inventory-check').prop('checked', false);
            self.$table_body.find('.si-select-all-inventory').prop('checked', false);
            self.$table_body.find('tr').removeClass('si-row-checked');
            self.render_floating_cart();
        });

        this.$floating_mount.find('.si-cart-submit-btn').on('click', function () {
            self.open_quick_issue_dialog(items_array);
        });
    }

    async open_quick_issue_dialog(prefill_items = null) {
        const self = this;
        this.company = this.$company_select ? (this.$company_select.val() || this.company) : this.company;
        await this.load_meta();
        
        const draft_key = `ashan_stock_issue_draft_${this.company}`;
        let saved_draft = null;
        if (!prefill_items) {
            try {
                saved_draft = JSON.parse(localStorage.getItem(draft_key));
            } catch (e) {}
        }

        const today = frappe.datetime.get_today();

        let wh_options = '';
        (this.meta.warehouses || []).forEach(w => {
            wh_options += `<option value="${w.name}">${w.warehouse_name || w.name}</option>`;
        });

        const modal_html = `
            <div class="si-modal-backdrop">
                <div class="si-modal-dialog">
                    <div class="si-modal-header">
                        <div class="si-modal-title">
                            <span>新建材料出库单</span>
                            <span class="si-modal-company-tag">· ${this.company}</span>
                        </div>
                        <button type="button" class="si-modal-close-btn">✕</button>
                    </div>
                    <div class="si-modal-body">
                        ${saved_draft ? `<div class="si-draft-banner">
                            <span>已自动恢复您上次未提交的出库草稿</span>
                            <a href="javascript:void(0)" class="si-clear-draft-btn si-draft-clear-link">清空草稿</a>
                        </div>` : ''}
                        
                        <!-- Form Header Info -->
                        <div class="si-form-grid">
                            <div class="si-form-group">
                                <label class="si-form-label">出库发货仓库 <span class="si-required-star">*</span></label>
                                <select class="si-form-control si-dialog-warehouse">${wh_options}</select>
                            </div>
                            <div class="si-form-group">
                                <label class="si-form-label">记账日期 <span class="si-required-star">*</span></label>
                                <input type="date" class="si-form-control si-dialog-posting-date" value="${today}" />
                            </div>
                            <div class="si-form-group">
                                <label class="si-form-label">出库业务性质</label>
                                <select class="si-form-control si-dialog-purpose">
                                    <option value="Material Issue">材料出库 / 车间领料</option>
                                    <option value="Manufacture">生产领料 / 制造消耗</option>
                                    <option value="Material Transfer">仓库调拨出库</option>
                                </select>
                            </div>
                            <div class="si-form-group">
                                <label class="si-form-label">领用人 / 领用部门说明</label>
                                <input type="text" class="si-form-control si-dialog-remarks" placeholder="如：生产一车间孟师傅领用 / 模具维修" />
                            </div>
                        </div>

                        <!-- Items Entry Table -->
                        <div class="si-section-header">
                            <div>
                                <span class="si-section-title">出库物料清单</span>
                            </div>
                            <div>
                                <button type="button" class="btn btn-xs btn-default si-open-picker-btn">📦 仓库现存挑选</button>
                                <button type="button" class="btn btn-xs btn-default si-add-item-btn">➕ 添加物料行</button>
                                <button type="button" class="btn btn-xs btn-default si-clear-items-btn si-btn-danger-text">🗑️ 清空清单</button>
                            </div>
                        </div>
                        <div class="si-items-table-wrapper">
                            <table class="si-items-table">
                                <thead>
                                    <tr>
                                        <th class="si-col-idx">#</th>
                                        <th class="si-col-item">物料编码与名称</th>
                                        <th class="si-col-spec">规格型号</th>
                                        <th class="si-col-stock">发货仓可用库存</th>
                                        <th class="si-col-qty">出库数量</th>
                                        <th class="si-col-op">操作</th>
                                    </tr>
                                </thead>
                                <tbody class="si-dialog-items-body">
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div class="si-modal-footer">
                        <div class="si-dialog-summary-text si-summary-text">
                            共 0 项物料，合计出库 0.00 Nos
                        </div>
                        <div class="si-modal-footer-actions">
                            <label class="si-submit-direct-label">
                                <input type="checkbox" class="si-dialog-submit-direct" checked />
                                直接过账提交 (立即生效并扣减库存)
                            </label>
                            <button type="button" class="btn btn-sm btn-default si-dialog-cancel-btn">✕ 取消</button>
                            <button type="button" class="btn btn-sm btn-primary si-dialog-submit-btn">🚀 立即出库</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const $modal = $(modal_html).appendTo('body');
        const $items_body = $modal.find('.si-dialog-items-body');

        function add_item_row(item_code = '', item_name = '', description = '', stock_uom = 'Nos', available_qty = 0, qty = 1) {
            const row_idx = $items_body.children().length + 1;
            const tr = `
                <tr class="si-item-row">
                    <td class="si-row-idx">${row_idx}</td>
                    <td>
                        <div class="si-relative-box">
                            <input type="text" class="si-form-control si-row-item-input" value="${item_code ? `${item_name || item_code} (${item_code})` : ''}" placeholder="点击挑选实存物料或搜索..." data-code="${item_code}" data-name="${item_name}" data-uom="${stock_uom}" />
                        </div>
                    </td>
                    <td class="si-row-spec si-row-spec-text">${description || '-'}</td>
                    <td class="si-text-right">
                        <span class="si-stock-text ${available_qty <= 0 ? 'si-stock-text-low' : ''} si-row-stock-text si-stock-text-clickable" data-avail="${available_qty}" title="点击可一键自动填入最大可用库存">${(flt(available_qty) || 0).toFixed(2)} ${stock_uom}</span>
                    </td>
                    <td class="si-text-right">
                        <div class="si-relative-box">
                            <input type="number" step="any" min="0.001" class="si-form-control si-row-qty si-qty-input" value="${qty}" />
                            <span class="si-row-uom-label si-row-uom-text">${stock_uom}</span>
                            <div class="si-stock-warning"></div>
                        </div>
                    </td>
                    <td class="si-text-center">
                        <button type="button" class="btn btn-xs btn-default si-row-del-btn si-row-del-button">✕</button>
                    </td>
                </tr>
            `;
            const $tr = $(tr).appendTo($items_body);
            bind_row_events($tr);
            validate_row($tr);
            update_totals();
            save_draft_debounced();
            return $tr;
        }

        function validate_row($tr) {
            const $input = $tr.find('.si-row-item-input');
            const $qty = $tr.find('.si-row-qty');
            const $warning = $tr.find('.si-stock-warning');
            const $badge = $tr.find('.si-row-stock-text');
            
            const code = $input.data('code');
            const val = flt($qty.val()) || 0;
            const avail = flt($badge.data('avail')) || 0;
            const uom = $input.data('uom') || 'Nos';

            if (code && val > avail + 0.0001) {
                $qty.addClass('si-qty-invalid');
                $warning.text(`超出库存(最多${avail.toFixed(2)})`).show();
                return false;
            } else {
                $qty.removeClass('si-qty-invalid');
                $warning.empty().hide();
                return true;
            }
        }

        function update_totals() {
            let total_items = 0;
            let total_qty = 0;
            let uom = 'Nos';
            let has_invalid = false;

            $items_body.find('.si-item-row').each(function () {
                const code = $(this).find('.si-row-item-input').data('code');
                if (code) {
                    total_items++;
                    const row_qty = flt($(this).find('.si-row-qty').val()) || 0;
                    total_qty += row_qty;
                    uom = $(this).find('.si-row-item-input').data('uom') || uom;
                    if (!validate_row($(this))) {
                        has_invalid = true;
                    }
                }
            });

            const $submit_btn = $modal.find('.si-dialog-submit-btn');
            if (has_invalid) {
                $modal.find('.si-dialog-summary-text').html(`<span class="si-btn-danger-text">共 ${total_items} 项物料，合计出库 ${total_qty.toFixed(2)} ${uom} (存在超出库存项，禁止提交)</span>`);
                $submit_btn.prop('disabled', true);
            } else {
                $modal.find('.si-dialog-summary-text').text(`共 ${total_items} 项物料，合计出库 ${total_qty.toFixed(2)} ${uom}`);
                $submit_btn.prop('disabled', false);
            }
        }

        let draft_timer = null;
        function save_draft_debounced() {
            if (prefill_items) return;
            clearTimeout(draft_timer);
            draft_timer = setTimeout(() => {
                const items = [];
                $items_body.find('.si-item-row').each(function () {
                    const $input = $(this).find('.si-row-item-input');
                    const code = $input.data('code');
                    if (code) {
                        items.push({
                            item_code: code,
                            item_name: $input.data('name'),
                            description: $(this).find('.si-row-spec').text(),
                            stock_uom: $input.data('uom'),
                            available_qty: flt($(this).find('.si-row-stock-text').data('avail')),
                            qty: flt($(this).find('.si-row-qty').val()) || 1
                        });
                    }
                });
                const draft_data = {
                    warehouse: $modal.find('.si-dialog-warehouse').val(),
                    posting_date: $modal.find('.si-dialog-posting-date').val(),
                    purpose: $modal.find('.si-dialog-purpose').val(),
                    remarks: $modal.find('.si-dialog-remarks').val(),
                    items: items
                };
                localStorage.setItem(draft_key, JSON.stringify(draft_data));
            }, 200);
        }

        function bind_row_events($tr) {
            const $input = $tr.find('.si-row-item-input');
            const $qty = $tr.find('.si-row-qty');
            const $del = $tr.find('.si-row-del-btn');
            const $badge = $tr.find('.si-row-stock-text');

            $del.on('click', function () {
                $tr.remove();
                $items_body.children().each((i, el) => $(el).find('td:first').text(i + 1));
                update_totals();
                save_draft_debounced();
            });

            $qty.on('input', function () {
                validate_row($tr);
                update_totals();
                save_draft_debounced();
            });

            $qty.on('keydown', function (e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    add_item_row();
                    $items_body.find('.si-item-row:last .si-row-item-input').focus();
                }
            });

            $badge.on('click', function () {
                const avail = flt($(this).data('avail')) || 0;
                if (avail > 0) {
                    $qty.val(avail).trigger('input');
                    frappe.show_alert({ message: `已自动填入最大可用库存 ${avail}`, indicator: 'green' }, 2);
                }
            });

            let suggest_timer = null;

            $input.on('focus click', function () {
                const txt = $(this).val();
                load_and_render_suggest($input, txt);
            });

            $input.on('input', function () {
                const txt = $(this).val();
                clearTimeout(suggest_timer);
                suggest_timer = setTimeout(() => {
                    load_and_render_suggest($input, txt);
                }, 150);
            });
        }

        async function load_and_render_suggest($target_input, search_text) {
            const warehouse = $modal.find('.si-dialog-warehouse').val();
            const target_company = self.$company_select ? (self.$company_select.val() || self.company) : self.company;

            if (!warehouse) return;

            try {
                const res = await frappe.call({
                    method: 'ashan_cn_procurement.ashan_cn_procurement.page.stock_issue_workbench.stock_issue_workbench.get_warehouse_stock_items',
                    args: {
                        company: target_company,
                        warehouse: warehouse,
                        search_text: search_text,
                        only_positive_stock: 1
                    }
                });

                if (res && res.message) {
                    render_suggest_box($target_input, res.message, warehouse);
                }
            } catch (e) {
                console.error('Failed to query warehouse stock items:', e);
            }
        }

        function render_suggest_box($target_input, items, warehouse) {
            $('.si-suggest-box').remove();
            const offset = $target_input.offset();
            const box = $('<div class="si-suggest-box"></div>').appendTo('body');
            box.css({
                top: offset.top + $target_input.outerHeight() + 2,
                left: offset.left,
                width: Math.max($target_input.outerWidth(), 360)
            });

            $(`
                <div class="si-suggest-header">
                    <span>发货仓实存物料 (库存 > 0)</span>
                    <span>共 ${items.length} 种</span>
                </div>
            `).appendTo(box);

            if (!items || items.length === 0) {
                $(`
                    <div class="si-suggest-item">
                        <div class="si-suggest-name">该仓库当前暂无大于 0 的实物库存</div>
                    </div>
                `).appendTo(box);
                return;
            }

            items.forEach(it => {
                const avail = flt(it.actual_qty) || 0;
                const item_el = $(`
                    <div class="si-suggest-item">
                        <div class="si-suggest-item-left">
                            <span class="si-suggest-code">${it.item_code}</span>
                            <span class="si-suggest-name">${it.item_name || ''} ${it.description ? `· ${it.description}` : ''}</span>
                        </div>
                        <span class="si-suggest-stock ${avail <= 0 ? 'zero' : ''}">${avail.toFixed(2)} ${it.stock_uom || 'Nos'}</span>
                    </div>
                `).appendTo(box);

                item_el.on('click', function () {
                    $target_input.val(`${it.item_name || it.item_code} (${it.item_code})`);
                    $target_input.data('code', it.item_code);
                    $target_input.data('name', it.item_name);
                    $target_input.data('uom', it.stock_uom || 'Nos');
                    
                    const $tr = $target_input.closest('.si-item-row');
                    $tr.find('.si-row-spec').text(it.description || '-');
                    $tr.find('.si-row-uom-label').text(it.stock_uom || 'Nos');

                    const $badge = $tr.find('.si-row-stock-text');
                    $badge.text(`${avail.toFixed(2)} ${it.stock_uom || 'Nos'}`);
                    $badge.data('avail', avail);
                    $badge.toggleClass('si-stock-text-low', avail <= 0);

                    const $qty = $tr.find('.si-row-qty');
                    const cur_qty = flt($qty.val()) || 1;
                    if (avail > 0 && cur_qty > avail) {
                        $qty.val(avail);
                    }

                    box.remove();
                    validate_row($tr);
                    update_totals();
                    save_draft_debounced();
                    $tr.find('.si-row-qty').focus().select();
                });
            });

            $(document).on('click.si_suggest_dismiss', function (e) {
                if (!$(e.target).closest('.si-suggest-box, .si-row-item-input').length) {
                    box.remove();
                    $(document).off('click.si_suggest_dismiss');
                }
            });
        }

        function open_warehouse_stock_picker() {
            const warehouse = $modal.find('.si-dialog-warehouse').val();
            const target_company = self.$company_select ? (self.$company_select.val() || self.company) : self.company;

            if (!warehouse) {
                frappe.msgprint('请先选择具体的出库发货仓库！');
                return;
            }

            frappe.call({
                method: 'ashan_cn_procurement.ashan_cn_procurement.page.stock_issue_workbench.stock_issue_workbench.get_warehouse_stock_items',
                args: {
                    company: target_company,
                    warehouse: warehouse,
                    only_positive_stock: 1
                }
            }).then(res => {
                const stock_items = res.message || [];
                render_picker_dialog(stock_items, warehouse, target_company);
            });
        }

        function render_picker_dialog(stock_items, warehouse, company) {
            let rows_html = '';
            stock_items.forEach((it, i) => {
                const avail = flt(it.actual_qty) || 0;
                rows_html += `
                    <tr class="si-picker-row" data-code="${it.item_code}" data-name="${it.item_name || ''}" data-desc="${it.description || ''}">
                        <td class="si-col-idx">${i + 1}</td>
                        <td><strong class="si-link">${it.item_code}</strong></td>
                        <td>${it.item_name || '-'}</td>
                        <td class="si-row-spec-text">${it.description || '-'}</td>
                        <td class="si-text-right">
                            <span class="si-stock-text">${avail.toFixed(2)} ${it.stock_uom || 'Nos'}</span>
                        </td>
                        <td class="si-text-right">
                            <input type="number" step="any" min="0" max="${avail}" class="si-form-control si-picker-qty-input" placeholder="0.00" data-code="${it.item_code}" data-name="${it.item_name || ''}" data-desc="${it.description || ''}" data-uom="${it.stock_uom || 'Nos'}" data-avail="${avail}" />
                        </td>
                        <td class="si-text-center">
                            <button type="button" class="btn btn-xs btn-default si-picker-fill-max-btn" data-max="${avail}">领完</button>
                        </td>
                    </tr>
                `;
            });

            if (stock_items.length === 0) {
                rows_html = `
                    <tr>
                        <td colspan="7" class="si-empty-box">
                            <div class="si-empty-title">当前发货仓暂无可出库的实存物料</div>
                            <div class="si-empty-desc">该仓库所有物料账面库存均为 0.00</div>
                        </td>
                    </tr>
                `;
            }

            const picker_html = `
                <div class="si-modal-backdrop si-picker-backdrop">
                    <div class="si-modal-dialog si-picker-dialog">
                        <div class="si-modal-header">
                            <div class="si-modal-title">
                                <span>📦 仓库现存物料挑选</span>
                                <span class="si-modal-company-tag">· ${warehouse}</span>
                            </div>
                            <button type="button" class="si-modal-close-btn si-picker-close-btn">✕</button>
                        </div>
                        <div class="si-modal-body">
                            <div class="si-items-table-wrapper">
                                <table class="si-items-table si-picker-table">
                                    <thead>
                                        <tr>
                                            <th class="si-col-idx">#</th>
                                            <th>物料编码</th>
                                            <th>物料名称</th>
                                            <th>规格型号</th>
                                            <th class="si-text-right">当前可用库存</th>
                                            <th class="si-text-right">本次出库数量</th>
                                            <th class="si-text-center">快捷</th>
                                        </tr>
                                    </thead>
                                    <tbody class="si-picker-body">
                                        ${rows_html}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <div class="si-modal-footer">
                            <div class="si-picker-summary-text si-summary-text">
                                共 ${stock_items.length} 项实存物料
                            </div>
                            <div>
                                <button type="button" class="btn btn-sm btn-default si-picker-cancel-btn">✕ 取消</button>
                                <button type="button" class="btn btn-sm btn-primary si-picker-confirm-btn">🚀 批量加入出库单</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            const $picker = $(picker_html).appendTo('body');

            $picker.find('.si-picker-fill-max-btn').on('click', function () {
                const max = $(this).data('max');
                $(this).closest('tr').find('.si-picker-qty-input').val(max).focus();
            });

            // 键盘回车与下方向键极速流式录入
            $picker.find('.si-picker-qty-input').on('keydown', function (e) {
                if (e.key === 'Enter' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    const $next_row = $(this).closest('tr').next('.si-picker-row');
                    if ($next_row.length) {
                        $next_row.find('.si-picker-qty-input').focus().select();
                    }
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    const $prev_row = $(this).closest('tr').prev('.si-picker-row');
                    if ($prev_row.length) {
                        $prev_row.find('.si-picker-qty-input').focus().select();
                    }
                }
            });

            $picker.find('.si-picker-close-btn, .si-picker-cancel-btn').on('click', () => $picker.remove());

            $picker.find('.si-picker-confirm-btn').on('click', function () {
                let added_count = 0;
                $picker.find('.si-picker-qty-input').each(function () {
                    const qty = flt($(this).val()) || 0;
                    if (qty > 0) {
                        const code = $(this).data('code');
                        const name = $(this).data('name');
                        const desc = $(this).data('desc');
                        const uom = $(this).data('uom');
                        const avail = flt($(this).data('avail')) || 0;

                        let $target_row = null;
                        $items_body.find('.si-item-row').each(function () {
                            if (!$(this).find('.si-row-item-input').data('code') && !$target_row) {
                                $target_row = $(this);
                            }
                        });

                        if ($target_row) {
                            const $input = $target_row.find('.si-row-item-input');
                            $input.val(`${name || code} (${code})`).data('code', code).data('name', name).data('uom', uom);
                            $target_row.find('.si-row-spec').text(desc || '-');
                            $target_row.find('.si-row-uom-label').text(uom);
                            const $badge = $target_row.find('.si-row-stock-text');
                            $badge.text(`${avail.toFixed(2)} ${uom}`).data('avail', avail);
                            $target_row.find('.si-row-qty').val(qty);
                            validate_row($target_row);
                        } else {
                            add_item_row(code, name, desc, uom, avail, qty);
                        }
                        added_count++;
                    }
                });

                if (added_count > 0) {
                    frappe.show_alert({ message: `已成功加入 ${added_count} 项出库物料`, indicator: 'green' }, 3);
                    update_totals();
                    save_draft_debounced();
                    $picker.remove();
                } else {
                    frappe.msgprint('请在至少一项物料行填写大于 0 的出库数量！');
                }
            });
        }

        const valid_whs = (this.meta.warehouses || []).map(w => w.name);

        if (prefill_items && prefill_items.length > 0) {
            const first_wh = prefill_items[0].warehouse;
            if (first_wh && valid_whs.includes(first_wh)) {
                $modal.find('.si-dialog-warehouse').val(first_wh);
            }
            prefill_items.forEach(it => {
                add_item_row(it.item_code, it.item_name, it.description, it.stock_uom, it.actual_qty, 1.0);
            });
        } else if (saved_draft && saved_draft.items && saved_draft.items.length > 0) {
            if (saved_draft.warehouse && valid_whs.includes(saved_draft.warehouse)) {
                $modal.find('.si-dialog-warehouse').val(saved_draft.warehouse);
            } else if (valid_whs.length > 0) {
                $modal.find('.si-dialog-warehouse').val(valid_whs[0]);
            }
            if (saved_draft.posting_date) $modal.find('.si-dialog-posting-date').val(saved_draft.posting_date);
            if (saved_draft.purpose) $modal.find('.si-dialog-purpose').val(saved_draft.purpose);
            if (saved_draft.remarks) $modal.find('.si-dialog-remarks').val(saved_draft.remarks);

            saved_draft.items.forEach(it => {
                add_item_row(it.item_code, it.item_name, it.description, it.stock_uom, it.available_qty, it.qty);
            });
        } else {
            add_item_row();
        }

        $modal.find('.si-modal-close-btn, .si-dialog-cancel-btn').on('click', function () {
            $('.si-suggest-box').remove();
            $modal.remove();
        });

        $modal.find('.si-clear-draft-btn, .si-clear-items-btn').on('click', function () {
            localStorage.removeItem(draft_key);
            $items_body.empty();
            add_item_row();
            $modal.find('.si-clear-draft-btn').parent().remove();
        });

        $modal.find('.si-add-item-btn').on('click', () => add_item_row());
        $modal.find('.si-open-picker-btn').on('click', () => open_warehouse_stock_picker());

        $modal.find('.si-dialog-warehouse').on('change', async function () {
            const wh = $(this).val();
            $items_body.find('.si-item-row').each(async function () {
                const code = $(this).find('.si-row-item-input').data('code');
                if (code) {
                    try {
                        const bal_res = await frappe.call({
                            method: 'ashan_cn_procurement.ashan_cn_procurement.page.stock_issue_workbench.stock_issue_workbench.get_item_stock_balance',
                            args: {
                                company: self.company,
                                warehouse: wh,
                                item_code: code
                            }
                        });
                        if (bal_res && bal_res.message) {
                            const bal = bal_res.message.actual_qty || 0;
                            const uom = bal_res.message.stock_uom || 'Nos';
                            const $badge = $(this).find('.si-row-stock-text');
                            $badge.text(`${bal.toFixed(2)} ${uom}`).data('avail', bal);
                            $badge.toggleClass('si-stock-text-low', bal <= 0);
                            validate_row($(this));
                            update_totals();
                        }
                    } catch (e) {}
                }
            });
            save_draft_debounced();
        });

        $modal.find('.si-dialog-submit-btn').on('click', async function () {
            const warehouse = $modal.find('.si-dialog-warehouse').val();
            const posting_date = $modal.find('.si-dialog-posting-date').val();
            const purpose = $modal.find('.si-dialog-purpose').val();
            const remarks = $modal.find('.si-dialog-remarks').val();
            const submit_direct = $modal.find('.si-dialog-submit-direct').is(':checked') ? 1 : 0;

            const items = [];
            let has_over_stock = false;

            $items_body.find('.si-item-row').each(function () {
                const $input = $(this).find('.si-row-item-input');
                const code = $input.data('code');
                const qty = flt($(this).find('.si-row-qty').val()) || 0;
                const avail = flt($(this).find('.si-row-stock-text').data('avail')) || 0;

                if (code && qty > 0) {
                    if (qty > avail + 0.0001) {
                        has_over_stock = true;
                        $(this).find('.si-row-qty').addClass('si-qty-invalid');
                    }
                    items.push({
                        item_code: code,
                        stock_uom: $input.data('uom') || 'Nos',
                        qty: qty
                    });
                }
            });

            if (items.length === 0) {
                frappe.msgprint('出库物料清单不能为空，请至少添加一项物料并填写出库数量！');
                return;
            }

            if (has_over_stock) {
                frappe.msgprint('出库清单中存在超出当前仓库可用库存的物料，请调整出库数量后再提交！');
                return;
            }

            const $btn = $(this);
            $btn.prop('disabled', true).text('正在提交出库...');

            const target_company = self.$company_select ? (self.$company_select.val() || self.company) : self.company;

            try {
                const res = await frappe.call({
                    method: 'ashan_cn_procurement.ashan_cn_procurement.page.stock_issue_workbench.stock_issue_workbench.create_stock_issue',
                    args: {
                        company: target_company,
                        warehouse: warehouse,
                        posting_date: posting_date,
                        purpose: purpose,
                        remarks: remarks,
                        items: JSON.stringify(items),
                        submit_direct: submit_direct
                    }
                });

                if (res && res.message) {
                    frappe.show_alert({
                        message: res.message.message || '出库单已成功生成！',
                        indicator: 'green'
                    }, 4);
                    localStorage.removeItem(draft_key);
                    self.selected_inventory_items.clear();
                    self.render_floating_cart();
                    $('.si-suggest-box').remove();
                    $modal.remove();
                    self.refresh_all();
                }
            } catch (e) {
                console.error('Failed to create stock issue:', e);
                frappe.msgprint(e.message || '出库提交失败，请检查网络或发货仓可用库存！');
                $btn.prop('disabled', false).text('🚀 立即出库');
            }
        });
    }

    async open_voucher_detail(voucher_no) {
        if (!voucher_no) return;
        try {
            const res = await frappe.call({
                method: 'ashan_cn_procurement.ashan_cn_procurement.page.stock_issue_workbench.stock_issue_workbench.get_stock_issue_detail',
                args: { voucher_no: voucher_no }
            });
            if (res && res.message) {
                this.render_detail_modal(res.message);
            }
        } catch (e) {
            frappe.msgprint('无法获取出库单详情：' + (e.message || ''));
        }
    }

    render_detail_modal(doc) {
        let items_html = '';
        (doc.items || []).forEach((it, i) => {
            items_html += `
                <tr>
                    <td class="si-row-idx">${i + 1}</td>
                    <td><span class="si-row-item-code">${it.item_code}</span></td>
                    <td>${it.item_name || '-'}</td>
                    <td class="si-row-spec-text">${it.description || '-'}</td>
                    <td>${it.s_warehouse || '-'}</td>
                    <td class="si-qty-out">-${(flt(it.qty) || 0).toFixed(2)} ${it.stock_uom || 'Nos'}</td>
                </tr>
            `;
        });

        const status_badge = doc.docstatus === 0 ? 'si-status-draft' : (doc.docstatus === 1 ? 'si-status-submitted' : 'si-status-cancelled');

        const modal_html = `
            <div class="si-modal-backdrop">
                <div class="si-modal-dialog">
                    <div class="si-modal-header">
                        <div class="si-modal-title">
                            <span>材料出库单明细 · ${doc.name}</span>
                            <span class="si-status-badge ${status_badge} si-status-badge-inline">${doc.status_label}</span>
                        </div>
                        <button type="button" class="si-modal-close-btn">✕</button>
                    </div>
                    <div class="si-modal-body">
                        <div class="si-detail-grid">
                            <div><span class="si-detail-label">所属公司：</span><strong>${doc.company}</strong></div>
                            <div><span class="si-detail-label">记账时间：</span><strong>${doc.posting_date} ${doc.posting_time || ''}</strong></div>
                            <div><span class="si-detail-label">业务性质：</span><strong>${doc.purpose_label || doc.purpose}</strong></div>
                            <div><span class="si-detail-label">领料说明：</span><strong>${doc.remarks || '-'}</strong></div>
                        </div>

                        <div class="si-section-title si-section-header">出库物料清单</div>
                        <div class="si-items-table-wrapper">
                            <table class="si-items-table">
                                <thead>
                                    <tr>
                                        <th class="si-col-idx">#</th>
                                        <th>物料编码</th>
                                        <th>物料名称</th>
                                        <th>规格型号</th>
                                        <th>出库发货仓库</th>
                                        <th class="si-text-right">出库数量</th>
                                    </tr>
                                </thead>
                                <tbody>${items_html}</tbody>
                            </table>
                        </div>
                    </div>
                    <div class="si-modal-footer">
                        <div class="si-summary-text-bold">
                            共 ${doc.items ? doc.items.length : 0} 项物料，合计出库 -${(flt(doc.total_qty) || 0).toFixed(2)} Nos
                        </div>
                        <div>
                            <button type="button" class="btn btn-sm btn-default si-detail-close-btn">✕ 关闭</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const $modal = $(modal_html).appendTo('body');
        $modal.find('.si-modal-close-btn, .si-detail-close-btn').on('click', () => $modal.remove());
    }

    cancel_voucher(voucher_no) {
        const self = this;
        frappe.confirm(`确定要作废出库单 <strong>${voucher_no}</strong> 吗？作废后出库物料将即刻回滚恢复至发货仓账面库存！`, async function () {
            try {
                const res = await frappe.call({
                    method: 'ashan_cn_procurement.ashan_cn_procurement.page.stock_issue_workbench.stock_issue_workbench.cancel_stock_issue',
                    args: { voucher_no: voucher_no }
                });
                if (res && res.message) {
                    frappe.show_alert({ message: res.message.message || '出库单已成功作废！', indicator: 'green' }, 3);
                    self.refresh_all();
                }
            } catch (e) {
                frappe.msgprint('作废失败：' + (e.message || ''));
            }
        });
    }
}
