// Copyright (c) 2026, Ashan CN Procurement and contributors
// For license information, please see license.txt

frappe.pages['stock-ledger-workbench'].on_page_load = function (wrapper) {
    frappe.ui.make_app_page({
        parent: wrapper,
        title: __('库存收发流水台账'),
        single_column: true,
    });

    // 动态载入页面私有样式
    frappe.require('/assets/ashan_cn_procurement/css/stock_ledger_workbench.css');

    // 页面实例初始化
    wrapper.stock_ledger_wb = new StockLedgerWorkbench(wrapper);
};

frappe.pages['stock-ledger-workbench'].on_page_show = function (wrapper) {
    if (wrapper.stock_ledger_wb) {
        wrapper.stock_ledger_wb.on_show();
    }
};

class StockLedgerWorkbench {
    constructor(wrapper) {
        this.wrapper = wrapper;
        this.page = wrapper.page;
        this.$body = $(wrapper).find('.layout-main-section');

        // 初始状态：默认纯数量核算（仓储视角）
        this.display_mode = 'qty'; // 'qty' (默认纯实物数量) | 'amount' (含金额)

        this.filters = {
            company: '',
            from_date: '',
            to_date: '',
            warehouse: '全部仓库',
            item_group: '全部物料类型',
            search_text: '',
            show_zero_stock: 0,
        };

        // 弹窗内部专属核算上下文与状态
        this.modal_context = {
            item_code: null,
            item_name: null,
            from_date: '',
            to_date: '',
            warehouse: '全部仓库',
            movements: [],
            item_info: {},
        };

        this.meta = {
            companies: [],
            warehouses: [],
            item_groups: [],
        };

        this.summary_data = { items: [], groups: [], kpis: {}, count: 0 };
        this.collapsed_groups = new Set();
        this.active_preset = 'this_month';

        this.init();
    }

    init() {
        this.init_default_dates();
        this.build_shell();
        this.load_meta_filters().then(() => {
            this.fetch_data();
        });
    }

    on_show() {
        this.adjust_table_height();
    }

    init_default_dates() {
        const today = frappe.datetime.get_today();
        const firstDay = frappe.datetime.month_start();
        this.filters.from_date = firstDay;
        this.filters.to_date = today;
    }

    format_money(val) {
        const num = parseFloat(val) || 0.0;
        return '¥ ' + num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    format_num(val) {
        const num = parseFloat(val) || 0.0;
        return num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    format_num_styled(val) {
        const num = parseFloat(val) || 0.0;
        const str = num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        if (Math.abs(num) < 0.0001) {
            return `<span class="sl-val-zero">${str}</span>`;
        }
        return str;
    }

    build_shell() {
        this.$body.empty();

        const html = `
            <div class="stock-ledger-page-container">
                <!-- 顶部标题栏 (纯净明快) -->
                <div class="sl-header-bar">
                    <div class="sl-title-group">
                        <h1 class="sl-main-title">库存收发流水台账</h1>
                        <p class="sl-sub-title">收发存财务闭式结转 · 分类层级树状小计 · 仓储与财务双核算口径</p>
                    </div>
                </div>

                <!-- 顶部控制与多维筛选卡片 -->
                <div class="sl-filter-card">
                    <div class="sl-filter-grid">
                        <!-- 期间筛选 -->
                        <div class="sl-filter-group sl-filter-col-wide">
                            <div class="sl-filter-label">业务期间 / 时间范围</div>
                            <div class="sl-date-presets">
                                <button type="button" class="sl-preset-pill active" data-preset="this_month">本月</button>
                                <button type="button" class="sl-preset-pill" data-preset="last_month">上月</button>
                                <button type="button" class="sl-preset-pill" data-preset="this_quarter">本季度</button>
                                <button type="button" class="sl-preset-pill" data-preset="this_year">今年</button>
                                <button type="button" class="sl-preset-pill" data-preset="last_30_days">最近30天</button>
                            </div>
                            <div class="sl-date-inputs">
                                <input type="date" class="sl-filter-input sl-input-from-date" value="${this.filters.from_date}">
                                <span class="sl-date-separator">至</span>
                                <input type="date" class="sl-filter-input sl-input-to-date" value="${this.filters.to_date}">
                            </div>
                        </div>

                        <!-- 公司选择 -->
                        <div class="sl-filter-group">
                            <div class="sl-filter-label">所属公司</div>
                            <select class="sl-filter-select sl-select-company"></select>
                        </div>

                        <!-- 仓库选择 -->
                        <div class="sl-filter-group">
                            <div class="sl-filter-label">所属仓库</div>
                            <select class="sl-filter-select sl-select-warehouse">
                                <option value="全部仓库">全部仓库</option>
                            </select>
                        </div>

                        <!-- 物料分类 -->
                        <div class="sl-filter-group">
                            <div class="sl-filter-label">物料类型 / 分类</div>
                            <select class="sl-filter-select sl-select-group">
                                <option value="全部物料类型">全部物料类型</option>
                            </select>
                        </div>

                        <!-- 关键字搜索 -->
                        <div class="sl-filter-group">
                            <div class="sl-filter-label">关键字检索</div>
                            <input type="text" class="sl-filter-input sl-input-search" placeholder="物料编码 / 名称 / 规格 / 单号 (按 Enter 立即搜索)">
                        </div>
                    </div>

                    <div class="sl-filter-actions">
                        <div class="sl-filter-actions-left">
                            <label class="sl-checkbox-label">
                                <input type="checkbox" class="sl-checkbox sl-check-zero-stock">
                                <span>包含零库存与无发生额物料</span>
                            </label>
                        </div>
                        <div class="sl-action-btns">
                            <button type="button" class="sl-btn sl-btn-primary sl-query-btn">
                                <span>立即查询</span>
                            </button>
                        </div>
                    </div>
                </div>

                <!-- 大宽表主体容器 (纯净高性能收发存汇总台账) -->
                <div class="sl-table-wrapper">
                    <!-- 表格主控工具栏 (上方为操作控制，下方为当前模式指示) -->
                    <div class="sl-table-toolbar">
                        <div class="sl-toolbar-top-row">
                            <div class="sl-toolbar-controls-left">
                                <!-- 显示口径分段控件：实物数量核算 vs 含金额 -->
                                <div class="sl-segmented-control sl-mode-segmented" role="tablist">
                                    <button type="button" class="sl-segment-btn active" data-mode="qty" title="默认仅查看实物收发存数量，表格紧凑清晰">
                                        <span>实物数量核算 (默认)</span>
                                    </button>
                                    <button type="button" class="sl-segment-btn" data-mode="amount" title="包含加权均价与资产金额">
                                        <span>含金额</span>
                                    </button>
                                </div>
                            </div>

                            <div class="sl-toolbar-controls-right">
                                <div class="sl-tree-btns">
                                    <button type="button" class="sl-tb-btn sl-expand-all-btn">全部展开</button>
                                    <button type="button" class="sl-tb-btn sl-collapse-all-btn">全部折叠</button>
                                </div>
                                <button type="button" class="sl-btn sl-btn-outline sl-refresh-btn" title="刷新数据">
                                    <span>刷新</span>
                                </button>
                                <button type="button" class="sl-btn sl-btn-primary sl-export-btn" title="导出当前表格至 Excel">
                                    <span>导出 Excel</span>
                                </button>
                            </div>
                        </div>

                        <!-- 下方模式指示器与数据统计 -->
                        <div class="sl-toolbar-bottom-row">
                            <span class="sl-toolbar-mode-indicator">当前模式：实物数量核算 (仅数量)</span>
                            <span class="sl-toolbar-summary-info">收发存汇总 · 共 0 种物料</span>
                        </div>
                    </div>

                    <div class="sl-table-scroll-container">
                        <div class="sl-table-mount-point">
                            <div class="sl-loading-state">
                                <div class="sl-spinner"></div>
                                <div>正在加载库存核算数据...</div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 物料出入库全景穿透模态弹窗 (Fluid High-Performance Modal Dialog) -->
                <div class="sl-modal-backdrop"></div>
                <div class="sl-modal-wrapper">
                    <div class="sl-modal-dialog">
                        <div class="sl-modal-header">
                            <div class="sl-modal-title-group">
                                <div class="sl-modal-header-top">
                                    <span class="sl-modal-tag-badge">物料全景流水穿透</span>
                                    <h3 class="sl-modal-title">物料出入库全景流水</h3>
                                </div>
                                <p class="sl-modal-sub">正在加载物料规格与仓库档案...</p>
                            </div>
                            <button type="button" class="sl-modal-close-btn" title="关闭弹窗 (Esc)">✕</button>
                        </div>

                        <!-- 弹窗内置期间与条件快捷切换栏 (提高性能与交互深度) -->
                        <div class="sl-modal-filter-strip">
                            <div class="sl-modal-filter-left">
                                <span class="sl-modal-filter-lbl">核算期间:</span>
                                <div class="sl-date-presets sl-modal-presets">
                                    <button type="button" class="sl-preset-pill active" data-mpreset="this_month">本月至今</button>
                                    <button type="button" class="sl-preset-pill" data-mpreset="last_3_months">近3月</button>
                                    <button type="button" class="sl-preset-pill" data-mpreset="last_6_months">近半年</button>
                                    <button type="button" class="sl-preset-pill" data-mpreset="this_year">今年</button>
                                </div>
                                <div class="sl-modal-date-inputs">
                                    <input type="date" class="sl-filter-input sl-modal-from-date">
                                    <span class="sl-date-separator">至</span>
                                    <input type="date" class="sl-filter-input sl-modal-to-date">
                                </div>
                            </div>
                            <div class="sl-modal-filter-right">
                                <select class="sl-filter-select sl-modal-warehouse-select">
                                    <option value="全部仓库">全部仓库</option>
                                </select>
                                <button type="button" class="sl-btn sl-btn-primary sl-modal-refresh-btn">
                                    <span>查询</span>
                                </button>
                                <button type="button" class="sl-btn sl-btn-issue-action sl-modal-quick-issue-btn" title="为此物料快速创建出库单 (材料出库/领用)">
                                    <span>快捷出库</span>
                                </button>
                                <button type="button" class="sl-btn sl-btn-outline sl-modal-export-btn" title="导出此物料明细流水 CSV">
                                    <span>导出流水</span>
                                </button>
                            </div>
                        </div>

                        <!-- 4 维微型实物库存结转看板 (纯数量视角 · 随期间动态局部重算) -->
                        <div class="sl-modal-summary-strip">
                            <div class="sl-modal-kpi sl-kpi-opening">
                                <div class="sl-modal-kpi-label">期初结存 (上期结转)</div>
                                <div class="sl-modal-kpi-val sl-md-opening">0.00 件</div>
                                <div class="sl-modal-kpi-sub sl-md-opening-sub">期初实物库存</div>
                            </div>
                            <div class="sl-modal-kpi sl-kpi-in">
                                <div class="sl-modal-kpi-label">本期累计入库</div>
                                <div class="sl-modal-kpi-val sl-md-in">+0.00 件</div>
                                <div class="sl-modal-kpi-sub sl-md-in-sub">本期实物入库</div>
                            </div>
                            <div class="sl-modal-kpi sl-kpi-out">
                                <div class="sl-modal-kpi-label">本期累计出库</div>
                                <div class="sl-modal-kpi-val sl-md-out">-0.00 件</div>
                                <div class="sl-modal-kpi-sub sl-md-out-sub">本期实物出库</div>
                            </div>
                            <div class="sl-modal-kpi sl-kpi-closing">
                                <div class="sl-modal-kpi-label">期末结存 (闭式守恒)</div>
                                <div class="sl-modal-kpi-val sl-md-closing">0.00 件</div>
                                <div class="sl-modal-kpi-sub sl-md-closing-sub">当前实物现存</div>
                            </div>
                        </div>

                        <div class="sl-modal-body">
                            <div class="sl-modal-table-mount"></div>
                        </div>

                        <div class="sl-modal-footer">
                            <div class="sl-modal-footer-info">
                                <span class="sl-modal-record-count">共 0 笔出入库流水明细 · 闭式守恒平账</span>
                            </div>
                            <div class="sl-modal-footer-actions">
                                <button type="button" class="sl-btn sl-btn-issue-action sl-modal-footer-issue-btn" title="为此物料快速发起出库并直接过账提交">
                                    <span>快捷出库</span>
                                </button>
                                <button type="button" class="sl-btn sl-btn-outline sl-modal-close-action-btn">
                                    <span>关闭</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.$body.html(html);
        this.bind_events();
    }

    bind_events() {
        const me = this;

        // 1. 显示口径切换 (实物数量 vs 含金额)
        this.$body.find('.sl-mode-segmented .sl-segment-btn').on('click', function () {
            const mode = $(this).attr('data-mode');
            if (mode === me.display_mode) return;
            me.$body.find('.sl-mode-segmented .sl-segment-btn').removeClass('active');
            $(this).addClass('active');
            me.display_mode = mode;

            me.update_toolbar_state();
            me.render_summary_table(me.summary_data);
        });

        // 2. 主页面期间快捷选项
        this.$body.find('.sl-filter-card .sl-preset-pill').on('click', function () {
            me.$body.find('.sl-filter-card .sl-preset-pill').removeClass('active');
            $(this).addClass('active');
            const preset = $(this).attr('data-preset');
            me.active_preset = preset;
            me.apply_date_preset(preset);
        });

        // 3. 主页面自定义日期输入失焦
        this.$body.find('.sl-input-from-date, .sl-input-to-date').on('change', function () {
            me.$body.find('.sl-filter-card .sl-preset-pill').removeClass('active');
            me.filters.from_date = me.$body.find('.sl-input-from-date').val();
            me.filters.to_date = me.$body.find('.sl-input-to-date').val();
        });

        // 4. 公司切换联动仓库
        this.$body.find('.sl-select-company').on('change', function () {
            me.filters.company = $(this).val();
            me.reload_warehouses_for_company();
        });

        // 5. 仓库切换
        this.$body.find('.sl-select-warehouse').on('change', function () {
            me.filters.warehouse = $(this).val();
        });

        // 6. 物料分类切换
        this.$body.find('.sl-select-group').on('change', function () {
            me.filters.item_group = $(this).val();
        });

        // 7. 搜索输入防抖与 Enter 立即触发
        let searchTimeout = null;
        this.$body.find('.sl-input-search').on('input', function () {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                me.filters.search_text = $(this).val();
                me.fetch_data();
            }, 300);
        });

        this.$body.find('.sl-input-search').on('keydown', function (e) {
            if (e.key === 'Enter') {
                clearTimeout(searchTimeout);
                me.filters.search_text = $(this).val();
                me.fetch_data();
            }
        });

        // 8. 零库存复选框
        this.$body.find('.sl-check-zero-stock').on('change', function () {
            me.filters.show_zero_stock = $(this).is(':checked') ? 1 : 0;
            me.fetch_data();
        });

        // 9. 全部展开 / 全部折叠
        this.$body.find('.sl-expand-all-btn').on('click', function () {
            me.expand_all_groups();
        });

        this.$body.find('.sl-collapse-all-btn').on('click', function () {
            me.collapse_all_groups();
        });

        // 10. 立即查询与刷新按钮
        this.$body.find('.sl-query-btn, .sl-refresh-btn').on('click', function () {
            me.fetch_data();
        });

        // 11. 导出 Excel
        this.$body.find('.sl-export-btn').on('click', function () {
            me.export_table_data();
        });

        // ============================================================
        // 弹窗内部交互事件绑定
        // ============================================================
        // 弹窗内快捷期间点击
        this.$body.find('.sl-modal-presets .sl-preset-pill').on('click', function () {
            me.$body.find('.sl-modal-presets .sl-preset-pill').removeClass('active');
            $(this).addClass('active');
            const mpreset = $(this).attr('data-mpreset');
            me.apply_modal_date_preset(mpreset);
        });

        // 弹窗自定义日期修改
        this.$body.find('.sl-modal-from-date, .sl-modal-to-date').on('change', function () {
            me.$body.find('.sl-modal-presets .sl-preset-pill').removeClass('active');
            me.modal_context.from_date = me.$body.find('.sl-modal-from-date').val();
            me.modal_context.to_date = me.$body.find('.sl-modal-to-date').val();
        });

        // 弹窗仓库切换
        this.$body.find('.sl-modal-warehouse-select').on('change', function () {
            me.modal_context.warehouse = $(this).val();
        });

        // 弹窗内查询按钮
        this.$body.find('.sl-modal-refresh-btn').on('click', function () {
            me.fetch_modal_history();
        });

        // 弹窗内导出流水 CSV
        this.$body.find('.sl-modal-export-btn').on('click', function () {
            me.export_modal_ledger_csv();
        });

        // 弹窗内快捷出库 (顶部工具栏 + 底部Footer快捷按钮)
        this.$body.find('.sl-modal-quick-issue-btn, .sl-modal-footer-issue-btn').on('click', function () {
            const raw = me.modal_context.raw_data || {};
            const cl = raw.closing || {};
            const info = me.modal_context.item_info || {};
            me.open_quick_issue_dialog(me.modal_context.item_code, me.modal_context.item_name, me.modal_context.warehouse, cl.qty || 0, info.stock_uom || '');
        });

        // 弹窗关闭事件与全局 Esc
        this.$body.find('.sl-modal-close-btn, .sl-modal-close-action-btn').on('click', function () {
            me.close_detail_modal();
        });

        // 凭证单号快速预览弹窗 (通用事件委托，支持在模态弹窗及主列表任意位置穿透)
        this.$body.off('click', '.sl-trigger-voucher-preview').on('click', '.sl-trigger-voucher-preview', function (e) {
            e.preventDefault();
            e.stopPropagation();
            const vtype = $(this).attr('data-vtype');
            const vno = $(this).attr('data-vno');
            me.open_voucher_quick_dialog(vtype, vno);
        });

        // 全局通用事件委托：点击物料行任意单元格 (实物模式 / 含金额模式下物料编码、名称、明细流水按钮或行内任意位置) 穿透弹出全景流水明细弹窗
        this.$body.off('click', '.sl-item-row').on('click', '.sl-item-row', function (e) {
            // 若点击的是快捷出库按钮或内部元素，则不触发行点击
            if ($(e.target).closest('.sl-trigger-quick-issue, .sl-btn-issue-action').length) {
                return;
            }
            const code = $(this).attr('data-code') || $(this).find('.sl-trigger-modal').attr('data-code');
            const name = $(this).attr('data-name') || $(this).find('.sl-trigger-modal').attr('data-name');
            if (code) {
                me.open_detail_modal(code, name);
            }
        });

        // 全局通用事件委托：显式点击 .sl-trigger-modal
        this.$body.off('click', '.sl-trigger-modal').on('click', '.sl-trigger-modal', function (e) {
            e.preventDefault();
            e.stopPropagation();
            const code = $(this).attr('data-code') || $(this).closest('[data-code]').attr('data-code');
            const name = $(this).attr('data-name') || $(this).closest('[data-name]').attr('data-name');
            if (code) {
                me.open_detail_modal(code, name);
            }
        });

        // 全局通用事件委托：点击行内快捷出库
        this.$body.off('click', '.sl-trigger-quick-issue').on('click', '.sl-trigger-quick-issue', function (e) {
            e.preventDefault();
            e.stopPropagation();
            const code = $(this).attr('data-code');
            const name = $(this).attr('data-name');
            const wh = $(this).attr('data-wh');
            const stock = parseFloat($(this).attr('data-stock')) || 0;
            const uom = $(this).attr('data-uom') || '';
            me.open_quick_issue_dialog(code, name, wh, stock, uom);
        });

        $(document).off('keydown.stock_ledger').on('keydown.stock_ledger', function (e) {
            if (e.key === 'Escape') {
                me.close_detail_modal();
            }
        });

        // 表头鼠标滚轮转横向漫游
        const scrollContainer = this.$body.find('.sl-table-scroll-container')[0];
        if (scrollContainer) {
            scrollContainer.addEventListener('wheel', function (e) {
                if (e.target.closest('.sl-thead') && Math.abs(e.deltaY) > 0 && !e.shiftKey) {
                    if (scrollContainer.scrollWidth > scrollContainer.clientWidth) {
                        e.preventDefault();
                        scrollContainer.scrollLeft += e.deltaY;
                    }
                }
            }, { passive: false });
        }

        // 视口高度自适应
        $(window).on('resize.stock_ledger', () => {
            this.adjust_table_height();
        });
    }

    update_toolbar_state() {
        const modeLabel = this.display_mode === 'qty' ? '当前模式：实物数量核算 (仅数量)' : '当前模式：含金额核算 (含加权均价与金额)';
        this.$body.find('.sl-toolbar-mode-indicator').text(modeLabel);
        const count = this.summary_data.count || 0;
        const groupsCount = (this.summary_data.groups || []).length;
        this.$body.find('.sl-toolbar-summary-info').text(`收发存汇总 · 共 ${count} 种物料 · ${groupsCount} 个物料分类`);
    }

    apply_date_preset(preset) {
        const today = frappe.datetime.get_today();
        let fromDate = today;
        let toDate = today;

        if (preset === 'this_month') {
            fromDate = frappe.datetime.month_start();
            toDate = today;
        } else if (preset === 'last_month') {
            const lastMonthStart = frappe.datetime.add_months(frappe.datetime.month_start(), -1);
            fromDate = lastMonthStart;
            toDate = frappe.datetime.month_end(lastMonthStart);
        } else if (preset === 'this_quarter') {
            fromDate = frappe.datetime.quarter_start();
            toDate = today;
        } else if (preset === 'this_year') {
            fromDate = frappe.datetime.year_start();
            toDate = today;
        } else if (preset === 'last_30_days') {
            fromDate = frappe.datetime.add_days(today, -30);
            toDate = today;
        }

        this.filters.from_date = fromDate;
        this.filters.to_date = toDate;
        this.$body.find('.sl-input-from-date').val(fromDate);
        this.$body.find('.sl-input-to-date').val(toDate);
        this.fetch_data();
    }

    apply_modal_date_preset(mpreset) {
        const today = frappe.datetime.get_today();
        let fromDate = today;
        let toDate = today;

        if (mpreset === 'this_month') {
            fromDate = frappe.datetime.month_start();
            toDate = today;
        } else if (mpreset === 'last_3_months') {
            fromDate = frappe.datetime.add_months(today, -3);
            toDate = today;
        } else if (mpreset === 'last_6_months') {
            fromDate = frappe.datetime.add_months(today, -6);
            toDate = today;
        } else if (mpreset === 'this_year') {
            fromDate = frappe.datetime.year_start();
            toDate = today;
        }

        this.modal_context.from_date = fromDate;
        this.modal_context.to_date = toDate;
        this.$body.find('.sl-modal-from-date').val(fromDate);
        this.$body.find('.sl-modal-to-date').val(toDate);
        this.fetch_modal_history();
    }

    adjust_table_height() {
        const container = this.$body.find('.sl-table-scroll-container');
        if (!container.length) return;
        const rect = container[0].getBoundingClientRect();
        const availableHeight = window.innerHeight - rect.top - 36;
        if (availableHeight > 250) {
            container.css('max-height', availableHeight + 'px');
        }
    }

    load_meta_filters() {
        const me = this;
        return frappe.call({
            method: 'ashan_cn_procurement.ashan_cn_procurement.page.stock_ledger_workbench.stock_ledger_workbench.get_meta_filters',
            args: { company: me.filters.company },
            callback: function (r) {
                if (!r.message) return;
                const m = r.message;
                me.meta = m;
                me.filters.company = m.selected_company;

                const $compSelect = me.$body.find('.sl-select-company');
                $compSelect.empty();
                (m.companies || []).forEach(c => {
                    $compSelect.append($('<option>').val(c).text(c));
                });
                $compSelect.val(m.selected_company);

                me.render_warehouse_options(m.warehouses || []);

                const $grpSelect = me.$body.find('.sl-select-group');
                $grpSelect.empty();
                $grpSelect.append($('<option>').val('全部物料类型').text('全部物料类型'));
                (m.item_groups || []).forEach(ig => {
                    if (ig !== 'All Item Groups') {
                        $grpSelect.append($('<option>').val(ig).text(ig));
                    }
                });
            }
        });
    }

    reload_warehouses_for_company() {
        const me = this;
        frappe.call({
            method: 'ashan_cn_procurement.ashan_cn_procurement.page.stock_ledger_workbench.stock_ledger_workbench.get_meta_filters',
            args: { company: me.filters.company },
            callback: function (r) {
                if (!r.message) return;
                me.render_warehouse_options(r.message.warehouses || []);
                me.fetch_data();
            }
        });
    }

    render_warehouse_options(warehouses) {
        this.available_warehouses = (warehouses || []).map(w => (typeof w === 'string' ? w : w.name));
        const $whSelect = this.$body.find('.sl-select-warehouse');
        $whSelect.empty();
        $whSelect.append($('<option>').val('全部仓库').text('全部仓库'));
        warehouses.forEach(w => {
            $whSelect.append($('<option>').val(w.name).text(w.warehouse_name || w.name));
        });
        this.filters.warehouse = '全部仓库';

        // 同步至弹窗内部仓库筛选
        const $modalWhSelect = this.$body.find('.sl-modal-warehouse-select');
        $modalWhSelect.empty();
        $modalWhSelect.append($('<option>').val('全部仓库').text('全部仓库'));
        warehouses.forEach(w => {
            $modalWhSelect.append($('<option>').val(w.name).text(w.warehouse_name || w.name));
        });
    }

    fetch_data() {
        const me = this;
        const $mount = this.$body.find('.sl-table-mount-point');
        $mount.html(`
            <div class="sl-loading-state">
                <div class="sl-spinner"></div>
                <div>正在汇总收发存结转数据...</div>
            </div>
        `);

        frappe.call({
            method: 'ashan_cn_procurement.ashan_cn_procurement.page.stock_ledger_workbench.stock_ledger_workbench.get_stock_summary',
            args: {
                company: me.filters.company,
                from_date: me.filters.from_date,
                to_date: me.filters.to_date,
                warehouse: me.filters.warehouse,
                item_group: me.filters.item_group,
                search_text: me.filters.search_text,
                show_zero_stock: me.filters.show_zero_stock,
            },
            callback: function (r) {
                if (r.exc) {
                    $mount.html('<div class="sl-empty-state">数据获取失败，请检查参数或网络连接。</div>');
                    return;
                }
                const data = r.message || { items: [], groups: [], kpis: {}, count: 0 };
                me.summary_data = data;
                me.render_summary_table(data);
                me.update_toolbar_state();
                me.adjust_table_height();
            }
        });
    }

    render_summary_table(data) {
        if (this.display_mode === 'qty') {
            this.render_summary_table_qty(data);
        } else {
            this.render_summary_table_amount(data);
        }
    }

    // ============================================================
    // 纯实物数量模式表格渲染 (单行单杠标准表头 + 分类文字靠左放置)
    // ============================================================
    render_summary_table_qty(data) {
        const me = this;
        const $mount = this.$body.find('.sl-table-mount-point');
        const groups = data.groups || [];
        const items = data.items || [];

        if (!items || items.length === 0) {
            $mount.html(`
                <div class="sl-empty-state">
                    <div class="sl-empty-icon">▤</div>
                    <div>在当前筛选条件下未发现符合条件的物料收发记录。</div>
                </div>
            `);
            return;
        }

        let tot_open_qty = 0;
        let tot_in_qty = 0;
        let tot_out_qty = 0;
        let tot_close_qty = 0;

        let tableBodyHtml = '';
        let globalIdx = 1;

        groups.forEach(grp => {
            const sub = grp.subtotals;
            tot_open_qty += sub.opening_qty;
            tot_in_qty += sub.in_qty;
            tot_out_qty += sub.out_qty;
            tot_close_qty += sub.closing_qty;

            const isGroupCollapsed = me.collapsed_groups.has(grp.group_name);
            const collapsedClass = isGroupCollapsed ? 'collapsed' : '';
            const childRowHiddenClass = isGroupCollapsed ? 'is-collapsed' : '';

            // 分类文字严格靠左放置
            tableBodyHtml += `
                <tr class="sl-group-header-row ${collapsedClass}" data-group-name="${frappe.utils.escape_html(grp.group_name)}" title="点击展开或折叠该分类物料">
                    <td class="sl-group-cell-banner sl-sticky-col-1" colspan="6">
                        <div class="sl-group-banner-inner">
                            <span class="sl-group-toggle-icon">▼</span>
                            <span class="sl-group-name">${frappe.utils.escape_html(grp.group_name)}</span>
                            <span class="sl-group-count-pill">${sub.item_count} 种物料${isGroupCollapsed ? ' (已折叠)' : ''}</span>
                        </div>
                    </td>

                    <!-- 期初小计 -->
                    <td class="sl-group-subtotal-cell sl-col-group-opening">${me.format_num_styled(sub.opening_qty)}</td>

                    <!-- 入库小计 -->
                    <td class="sl-group-subtotal-cell sl-col-group-in sl-val-in">${sub.in_qty > 0 ? '+' + me.format_num(sub.in_qty) : '-'}</td>

                    <!-- 出库小计 -->
                    <td class="sl-group-subtotal-cell sl-col-group-out sl-val-out">${sub.out_qty > 0 ? '-' + me.format_num(sub.out_qty) : '-'}</td>

                    <!-- 期末小计 -->
                    <td class="sl-group-subtotal-cell sl-col-group-closing sl-val-closing">${me.format_num(sub.closing_qty)}</td>

                    <td class="sl-group-subtotal-cell text-center">-</td>
                </tr>
            `;

            grp.items.forEach(item => {
                tableBodyHtml += `
                    <tr class="sl-item-row ${childRowHiddenClass}" data-parent-group="${frappe.utils.escape_html(grp.group_name)}" data-code="${frappe.utils.escape_html(item.item_code)}" data-name="${frappe.utils.escape_html(item.item_name)}">
                        <td class="sl-td sl-sticky-col-1">${globalIdx++}</td>
                        <td class="sl-td sl-sticky-col-2" title="${frappe.utils.escape_html(item.item_code)}">
                            <a href="javascript:void(0)" class="sl-code-link sl-trigger-modal" data-code="${frappe.utils.escape_html(item.item_code)}" data-name="${frappe.utils.escape_html(item.item_name)}">
                                ${frappe.utils.escape_html(item.item_code)}
                            </a>
                        </td>
                        <td class="sl-td sl-sticky-col-3" title="${frappe.utils.escape_html(item.item_name)}">
                            <div class="sl-td-text">
                                <a href="javascript:void(0)" class="sl-code-link sl-trigger-modal" data-code="${frappe.utils.escape_html(item.item_code)}" data-name="${frappe.utils.escape_html(item.item_name)}">
                                    ${frappe.utils.escape_html(item.item_name)}
                                </a>
                            </div>
                        </td>
                        <td class="sl-td" title="${frappe.utils.escape_html(item.spec)}">
                            <div class="sl-td-text">${frappe.utils.escape_html(item.spec || '-')}</div>
                        </td>
                        <td class="sl-td">${frappe.utils.escape_html(item.stock_uom || '-')}</td>
                        <td class="sl-td" title="${frappe.utils.escape_html(item.warehouse)}">${frappe.utils.escape_html(item.warehouse || '-')}</td>

                        <!-- 期初数量 -->
                        <td class="sl-td sl-td-num sl-col-group-opening">${me.format_num_styled(item.opening_qty)}</td>

                        <!-- 本期入库 -->
                        <td class="sl-td sl-td-num sl-col-group-in sl-val-in">${item.in_qty > 0 ? '+' + me.format_num(item.in_qty) : '-'}</td>

                        <!-- 本期出库 -->
                        <td class="sl-td sl-td-num sl-col-group-out sl-val-out">${item.out_qty > 0 ? '-' + me.format_num(item.out_qty) : '-'}</td>

                        <!-- 期末结存 -->
                        <td class="sl-td sl-td-num sl-col-group-closing sl-val-closing">${me.format_num(item.closing_qty)}</td>

                        <!-- 操作列：明细流水 + 快捷出库 -->
                        <td class="sl-td text-center">
                            <div class="sl-row-actions-flex">
                                <button type="button" class="sl-row-action-btn sl-trigger-modal" data-code="${frappe.utils.escape_html(item.item_code)}" data-name="${frappe.utils.escape_html(item.item_name)}" title="查看该物料全景出入库流水明细">
                                    <span>明细流水</span>
                                </button>
                                <button type="button" class="sl-row-action-btn sl-btn-issue-action sl-trigger-quick-issue" data-code="${frappe.utils.escape_html(item.item_code)}" data-name="${frappe.utils.escape_html(item.item_name)}" data-wh="${frappe.utils.escape_html(item.warehouse)}" data-stock="${item.closing_qty}" data-uom="${frappe.utils.escape_html(item.stock_uom)}" title="为此物料快速发起出库单">
                                    <span>快捷出库</span>
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            });
        });

        // 单行单杠标准表头
        const tableHtml = `
            <table class="sl-table sl-table-qty-mode">
                <colgroup>
                    <col class="sl-cg-qty-idx">
                    <col class="sl-cg-qty-code">
                    <col class="sl-cg-qty-name">
                    <col class="sl-cg-qty-spec">
                    <col class="sl-cg-qty-uom">
                    <col class="sl-cg-qty-wh">
                    <col class="sl-cg-qty-open">
                    <col class="sl-cg-qty-in">
                    <col class="sl-cg-qty-out">
                    <col class="sl-cg-qty-close">
                    <col class="sl-cg-qty-action">
                </colgroup>
                <thead class="sl-thead">
                    <tr>
                        <th class="sl-th sl-sticky-col-1">#</th>
                        <th class="sl-th sl-sticky-col-2">物料编码</th>
                        <th class="sl-th sl-sticky-col-3">物料名称</th>
                        <th class="sl-th">规格型号</th>
                        <th class="sl-th">单位</th>
                        <th class="sl-th">所属仓库</th>
                        <th class="sl-th sl-col-group-opening text-right">期初数量</th>
                        <th class="sl-th sl-col-group-in text-right">本期入库</th>
                        <th class="sl-th sl-col-group-out text-right">本期出库</th>
                        <th class="sl-th sl-col-group-closing text-right">期末结存</th>
                        <th class="sl-th text-center">操作</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableBodyHtml}
                </tbody>
                <tfoot class="sl-tfoot">
                    <tr>
                        <td class="sl-tf-td sl-sticky-col-1" colspan="6">
                            <div class="sl-group-banner-inner">
                                <strong>∑ 全库汇总</strong>
                                <span class="sl-group-count-pill">${groups.length} 个分类 · ${items.length} 种物料</span>
                            </div>
                        </td>
                        <td class="sl-tf-td sl-td-num sl-col-group-opening">${me.format_num_styled(tot_open_qty)}</td>
                        <td class="sl-tf-td sl-td-num sl-col-group-in sl-val-in">${me.format_num(tot_in_qty)}</td>
                        <td class="sl-tf-td sl-td-num sl-col-group-out sl-val-out">${me.format_num(tot_out_qty)}</td>
                        <td class="sl-tf-td sl-td-num sl-col-group-closing sl-val-closing">${me.format_num(tot_close_qty)}</td>
                        <td class="sl-tf-td text-center">-</td>
                    </tr>
                </tfoot>
            </table>
        `;

        $mount.html(tableHtml);
        this.bind_table_interactions($mount);
    }

    // ============================================================
    // 含金额核算模式表格渲染 (单行单杠标准表头)
    // ============================================================
    render_summary_table_amount(data) {
        const me = this;
        const $mount = this.$body.find('.sl-table-mount-point');
        const groups = data.groups || [];
        const items = data.items || [];

        if (!items || items.length === 0) {
            $mount.html(`
                <div class="sl-empty-state">
                    <div class="sl-empty-icon">▤</div>
                    <div>在当前筛选条件下未发现符合条件的物料收发记录。</div>
                </div>
            `);
            return;
        }

        let tot_open_qty = 0, tot_open_val = 0;
        let tot_in_qty = 0, tot_in_val = 0;
        let tot_out_qty = 0, tot_out_val = 0;
        let tot_close_qty = 0, tot_close_val = 0;

        let tableBodyHtml = '';
        let globalIdx = 1;

        groups.forEach(grp => {
            const sub = grp.subtotals;
            tot_open_qty += sub.opening_qty;
            tot_open_val += sub.opening_val;
            tot_in_qty += sub.in_qty;
            tot_in_val += sub.in_val;
            tot_out_qty += sub.out_qty;
            tot_out_val += sub.out_val;
            tot_close_qty += sub.closing_qty;
            tot_close_val += sub.closing_val;

            const isGroupCollapsed = me.collapsed_groups.has(grp.group_name);
            const collapsedClass = isGroupCollapsed ? 'collapsed' : '';
            const childRowHiddenClass = isGroupCollapsed ? 'is-collapsed' : '';

            tableBodyHtml += `
                <tr class="sl-group-header-row ${collapsedClass}" data-group-name="${frappe.utils.escape_html(grp.group_name)}" title="点击展开或折叠该分类物料">
                    <td class="sl-group-cell-banner sl-sticky-col-1" colspan="6">
                        <div class="sl-group-banner-inner">
                            <span class="sl-group-toggle-icon">▼</span>
                            <span class="sl-group-name">${frappe.utils.escape_html(grp.group_name)}</span>
                            <span class="sl-group-count-pill">${sub.item_count} 种物料${isGroupCollapsed ? ' (已折叠)' : ''}</span>
                        </div>
                    </td>

                    <!-- 期初 -->
                    <td class="sl-group-subtotal-cell sl-col-group-opening">${me.format_num_styled(sub.opening_qty)}</td>
                    <td class="sl-group-subtotal-cell sl-col-group-opening">-</td>
                    <td class="sl-group-subtotal-cell sl-col-group-opening sl-td-money">${me.format_money(sub.opening_val)}</td>

                    <!-- 入库 -->
                    <td class="sl-group-subtotal-cell sl-col-group-in sl-val-in">${sub.in_qty > 0 ? '+' + me.format_num(sub.in_qty) : '-'}</td>
                    <td class="sl-group-subtotal-cell sl-col-group-in">-</td>
                    <td class="sl-group-subtotal-cell sl-col-group-in sl-td-money sl-val-in">${sub.in_val > 0 ? me.format_money(sub.in_val) : '-'}</td>

                    <!-- 出库 -->
                    <td class="sl-group-subtotal-cell sl-col-group-out sl-val-out">${sub.out_qty > 0 ? '-' + me.format_num(sub.out_qty) : '-'}</td>
                    <td class="sl-group-subtotal-cell sl-col-group-out">-</td>
                    <td class="sl-group-subtotal-cell sl-col-group-out sl-td-money sl-val-out">${sub.out_val > 0 ? me.format_money(sub.out_val) : '-'}</td>

                    <!-- 期末 -->
                    <td class="sl-group-subtotal-cell sl-col-group-closing sl-val-closing">${me.format_num(sub.closing_qty)}</td>
                    <td class="sl-group-subtotal-cell sl-col-group-closing">-</td>
                    <td class="sl-group-subtotal-cell sl-col-group-closing sl-td-money sl-val-closing">${me.format_money(sub.closing_val)}</td>

                    <td class="sl-group-subtotal-cell text-center">-</td>
                </tr>
            `;

            grp.items.forEach(item => {
                tableBodyHtml += `
                    <tr class="sl-item-row ${childRowHiddenClass}" data-parent-group="${frappe.utils.escape_html(grp.group_name)}" data-code="${frappe.utils.escape_html(item.item_code)}" data-name="${frappe.utils.escape_html(item.item_name)}">
                        <td class="sl-td sl-sticky-col-1">${globalIdx++}</td>
                        <td class="sl-td sl-sticky-col-2" title="${frappe.utils.escape_html(item.item_code)}">
                            <a href="javascript:void(0)" class="sl-code-link sl-trigger-modal" data-code="${frappe.utils.escape_html(item.item_code)}" data-name="${frappe.utils.escape_html(item.item_name)}">
                                ${frappe.utils.escape_html(item.item_code)}
                            </a>
                        </td>
                        <td class="sl-td sl-sticky-col-3" title="${frappe.utils.escape_html(item.item_name)}">
                            <div class="sl-td-text">
                                <a href="javascript:void(0)" class="sl-code-link sl-trigger-modal" data-code="${frappe.utils.escape_html(item.item_code)}" data-name="${frappe.utils.escape_html(item.item_name)}">
                                    ${frappe.utils.escape_html(item.item_name)}
                                </a>
                            </div>
                        </td>
                        <td class="sl-td" title="${frappe.utils.escape_html(item.spec)}">
                            <div class="sl-td-text">${frappe.utils.escape_html(item.spec || '-')}</div>
                        </td>
                        <td class="sl-td">${frappe.utils.escape_html(item.stock_uom || '-')}</td>
                        <td class="sl-td" title="${frappe.utils.escape_html(item.warehouse)}">${frappe.utils.escape_html(item.warehouse || '-')}</td>

                        <!-- 期初结存 -->
                        <td class="sl-td sl-td-num sl-col-group-opening">${me.format_num_styled(item.opening_qty)}</td>
                        <td class="sl-td sl-td-num sl-col-group-opening">${item.opening_rate ? me.format_money(item.opening_rate) : '-'}</td>
                        <td class="sl-td sl-td-money sl-col-group-opening">${me.format_money(item.opening_val)}</td>

                        <!-- 本期入库 -->
                        <td class="sl-td sl-td-num sl-col-group-in sl-val-in">${item.in_qty > 0 ? '+' + me.format_num(item.in_qty) : '-'}</td>
                        <td class="sl-td sl-td-num sl-col-group-in">${item.in_rate ? me.format_money(item.in_rate) : '-'}</td>
                        <td class="sl-td sl-td-money sl-col-group-in sl-val-in">${item.in_val > 0 ? me.format_money(item.in_val) : '-'}</td>

                        <!-- 本期出库 -->
                        <td class="sl-td sl-td-num sl-col-group-out sl-val-out">${item.out_qty > 0 ? '-' + me.format_num(item.out_qty) : '-'}</td>
                        <td class="sl-td sl-td-num sl-col-group-out">${item.out_rate ? me.format_money(item.out_rate) : '-'}</td>
                        <td class="sl-td sl-td-money sl-col-group-out sl-val-out">${item.out_val > 0 ? me.format_money(item.out_val) : '-'}</td>

                        <!-- 期末结存 -->
                        <td class="sl-td sl-td-num sl-col-group-closing sl-val-closing">${me.format_num(item.closing_qty)}</td>
                        <td class="sl-td sl-td-num sl-col-group-closing">${item.closing_rate ? me.format_money(item.closing_rate) : '-'}</td>
                        <td class="sl-td sl-td-money sl-col-group-closing sl-val-closing">${me.format_money(item.closing_val)}</td>

                        <!-- 操作列：明细流水 + 快捷出库 -->
                        <td class="sl-td text-center">
                            <div class="sl-row-actions-flex">
                                <button type="button" class="sl-row-action-btn sl-trigger-modal" data-code="${frappe.utils.escape_html(item.item_code)}" data-name="${frappe.utils.escape_html(item.item_name)}" title="查看该物料全景出入库流水明细">
                                    <span>明细流水</span>
                                </button>
                                <button type="button" class="sl-row-action-btn sl-btn-issue-action sl-trigger-quick-issue" data-code="${frappe.utils.escape_html(item.item_code)}" data-name="${frappe.utils.escape_html(item.item_name)}" data-wh="${frappe.utils.escape_html(item.warehouse)}" data-stock="${item.closing_qty}" data-uom="${frappe.utils.escape_html(item.stock_uom)}" title="为此物料快速发起出库单">
                                    <span>快捷出库</span>
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            });
        });

        const tableHtml = `
            <table class="sl-table sl-table-amount-mode">
                <colgroup>
                    <col class="sl-cg-amt-idx">
                    <col class="sl-cg-amt-code">
                    <col class="sl-cg-amt-name">
                    <col class="sl-cg-amt-spec">
                    <col class="sl-cg-amt-uom">
                    <col class="sl-cg-amt-wh">
                    <col class="sl-cg-amt-open-qty">
                    <col class="sl-cg-amt-open-rate">
                    <col class="sl-cg-amt-open-val">
                    <col class="sl-cg-amt-in-qty">
                    <col class="sl-cg-amt-in-rate">
                    <col class="sl-cg-amt-in-val">
                    <col class="sl-cg-amt-out-qty">
                    <col class="sl-cg-amt-out-rate">
                    <col class="sl-cg-amt-out-val">
                    <col class="sl-cg-amt-close-qty">
                    <col class="sl-cg-amt-close-rate">
                    <col class="sl-cg-amt-close-val">
                    <col class="sl-cg-amt-action">
                </colgroup>
                <thead class="sl-thead">
                    <tr>
                        <th class="sl-th sl-sticky-col-1">#</th>
                        <th class="sl-th sl-sticky-col-2">物料编码</th>
                        <th class="sl-th sl-sticky-col-3">物料名称</th>
                        <th class="sl-th">规格型号</th>
                        <th class="sl-th">单位</th>
                        <th class="sl-th">所属仓库</th>

                        <!-- 期初 (上月结转) -->
                        <th class="sl-th sl-col-group-opening text-right">期初数量</th>
                        <th class="sl-th sl-col-group-opening text-right">期初单价</th>
                        <th class="sl-th sl-col-group-opening text-right">期初金额</th>

                        <!-- 本期入库 -->
                        <th class="sl-th sl-col-group-in text-right">本期入库</th>
                        <th class="sl-th sl-col-group-in text-right">入库均价</th>
                        <th class="sl-th sl-col-group-in text-right">入库金额</th>

                        <!-- 本期出库 -->
                        <th class="sl-th sl-col-group-out text-right">本期出库</th>
                        <th class="sl-th sl-col-group-out text-right">出库均价</th>
                        <th class="sl-th sl-col-group-out text-right">出库金额</th>

                        <!-- 期末结存 -->
                        <th class="sl-th sl-col-group-closing text-right">期末结存</th>
                        <th class="sl-th sl-col-group-closing text-right">期末单价</th>
                        <th class="sl-th sl-col-group-closing text-right">期末金额</th>

                        <th class="sl-th text-center">操作</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableBodyHtml}
                </tbody>
                <tfoot class="sl-tfoot">
                    <tr>
                        <td class="sl-tf-td sl-sticky-col-1" colspan="6">
                            <div class="sl-group-banner-inner">
                                <strong>∑ 全库汇总</strong>
                                <span class="sl-group-count-pill">${groups.length} 个分类 · ${items.length} 种物料</span>
                            </div>
                        </td>

                        <!-- 期初合计 -->
                        <td class="sl-tf-td sl-td-num sl-col-group-opening">${me.format_num_styled(tot_open_qty)}</td>
                        <td class="sl-tf-td sl-td-num">-</td>
                        <td class="sl-tf-td sl-td-money sl-col-group-opening">${me.format_money(tot_open_val)}</td>

                        <!-- 入库合计 -->
                        <td class="sl-tf-td sl-td-num sl-col-group-in sl-val-in">${me.format_num(tot_in_qty)}</td>
                        <td class="sl-tf-td sl-td-num">-</td>
                        <td class="sl-tf-td sl-td-money sl-col-group-in sl-val-in">${me.format_money(tot_in_val)}</td>

                        <!-- 出库合计 -->
                        <td class="sl-tf-td sl-td-num sl-col-group-out sl-val-out">${me.format_num(tot_out_qty)}</td>
                        <td class="sl-tf-td sl-td-num">-</td>
                        <td class="sl-tf-td sl-td-money sl-col-group-out sl-val-out">${me.format_money(tot_out_val)}</td>

                        <!-- 期末合计 -->
                        <td class="sl-tf-td sl-td-num sl-col-group-closing sl-val-closing">${me.format_num(tot_close_qty)}</td>
                        <td class="sl-tf-td sl-td-num">-</td>
                        <td class="sl-tf-td sl-td-money sl-col-group-closing sl-val-closing">${me.format_money(tot_close_val)}</td>

                        <td class="sl-tf-td text-center">-</td>
                    </tr>
                </tfoot>
            </table>
        `;

        $mount.html(tableHtml);
        this.bind_table_interactions($mount);
    }

    bind_table_interactions($mount) {
        const me = this;

        // 点击物料组行任意位置快速展开/折叠
        $mount.find('.sl-group-header-row').off('click').on('click', function (e) {
            if ($(e.target).closest('.sl-row-action-btn').length) return;
            const groupName = $(this).attr('data-group-name');
            me.toggle_group_collapse(groupName);
        });
    }

    toggle_group_collapse(groupName) {
        const $groupRow = this.$body.find(`.sl-group-header-row[data-group-name="${groupName}"]`);
        const $childRows = this.$body.find(`.sl-item-row[data-parent-group="${groupName}"]`);
        const $pill = $groupRow.find('.sl-group-count-pill');
        const itemCount = $childRows.length;

        if (this.collapsed_groups.has(groupName)) {
            this.collapsed_groups.delete(groupName);
            $groupRow.removeClass('collapsed');
            $childRows.removeClass('is-collapsed');
            $pill.text(`${itemCount} 种物料`);
        } else {
            this.collapsed_groups.add(groupName);
            $groupRow.addClass('collapsed');
            $childRows.addClass('is-collapsed');
            $pill.text(`${itemCount} 种物料 (已折叠)`);
        }
    }

    expand_all_groups() {
        const me = this;
        this.collapsed_groups.clear();
        this.$body.find('.sl-group-header-row').removeClass('collapsed');
        this.$body.find('.sl-item-row').removeClass('is-collapsed');
        this.$body.find('.sl-group-header-row').each(function () {
            const gname = $(this).attr('data-group-name');
            const cnt = me.$body.find(`.sl-item-row[data-parent-group="${gname}"]`).length;
            $(this).find('.sl-group-count-pill').text(`${cnt} 种物料`);
        });
    }

    collapse_all_groups() {
        const me = this;
        this.$body.find('.sl-group-header-row').each(function () {
            const gname = $(this).attr('data-group-name');
            me.collapsed_groups.add(gname);
            const cnt = me.$body.find(`.sl-item-row[data-parent-group="${gname}"]`).length;
            $(this).find('.sl-group-count-pill').text(`${cnt} 种物料 (已折叠)`);
        });
        this.$body.find('.sl-group-header-row').addClass('collapsed');
        this.$body.find('.sl-item-row').addClass('is-collapsed');
    }

    // ============================================================
    // 物料出入库全景穿透模态弹窗 (Fluid Modal Dialog & Real-Time Filter)
    // ============================================================
    open_detail_modal(item_code, item_name) {
        const me = this;
        const $wrapper = this.$body.find('.sl-modal-wrapper');
        const $backdrop = this.$body.find('.sl-modal-backdrop');

        this.modal_context.item_code = item_code;
        this.modal_context.item_name = item_name || item_code;

        // 默认初始化期间：本月至今
        const today = frappe.datetime.get_today();
        const firstDay = frappe.datetime.month_start();
        this.modal_context.from_date = this.filters.from_date || firstDay;
        this.modal_context.to_date = this.filters.to_date || today;
        this.modal_context.warehouse = this.filters.warehouse || '全部仓库';

        this.$body.find('.sl-modal-from-date').val(this.modal_context.from_date);
        this.$body.find('.sl-modal-to-date').val(this.modal_context.to_date);
        this.$body.find('.sl-modal-warehouse-select').val(this.modal_context.warehouse);

        // 重置快捷期间胶囊
        this.$body.find('.sl-modal-presets .sl-preset-pill').removeClass('active');
        this.$body.find('.sl-modal-presets .sl-preset-pill[data-mpreset="this_month"]').addClass('active');

        // 构建一次性静态表格骨架 (纯数量模式 · 表头常驻 · 零闪烁)
        const $mount = this.$body.find('.sl-modal-table-mount');
        $mount.html(`
            <table class="sl-table sl-modal-table">
                <colgroup>
                    <col class="sl-cg-md-idx">
                    <col class="sl-cg-md-time">
                    <col class="sl-cg-md-type">
                    <col class="sl-cg-md-no">
                    <col class="sl-cg-md-wh">
                    <col class="sl-cg-md-in">
                    <col class="sl-cg-md-out">
                    <col class="sl-cg-md-close">
                </colgroup>
                <thead class="sl-thead">
                    <tr>
                        <th class="sl-th text-center">#</th>
                        <th class="sl-th">记账日期时间</th>
                        <th class="sl-th">业务类型</th>
                        <th class="sl-th">单据编号</th>
                        <th class="sl-th">发生仓库</th>
                        <th class="sl-th sl-col-group-in text-right">入库数量</th>
                        <th class="sl-th sl-col-group-out text-right">出库数量</th>
                        <th class="sl-th sl-col-group-closing text-right">结存数量</th>
                    </tr>
                </thead>
                <tbody class="sl-modal-tbody">
                    <tr><td colspan="8" class="sl-td text-center">正在载入物料流水...</td></tr>
                </tbody>
                <tfoot class="sl-tfoot sl-modal-tfoot"></tfoot>
            </table>
        `);

        $backdrop.addClass('active');
        $wrapper.addClass('active');

        // 使用 requestAnimationFrame 解耦动画帧与数据请求，确保 60fps 丝滑展开
        window.requestAnimationFrame(() => {
            me.fetch_modal_history();
        });
    }

    // ============================================================
    // 弹窗内局部无感微更新引擎 (In-Place Micro-Update, 极度节省资源)
    // ============================================================
    fetch_modal_history() {
        const me = this;
        const $modalBody = this.$body.find('.sl-modal-body');
        const $tbody = this.$body.find('.sl-modal-tbody');
        const $tfoot = this.$body.find('.sl-modal-tfoot');

        // 仅添加半透明微状态与顶部进度条，绝不销毁表格与表头
        $modalBody.addClass('is-fetching');

        frappe.call({
            method: 'ashan_cn_procurement.ashan_cn_procurement.page.stock_ledger_workbench.stock_ledger_workbench.get_item_quick_history',
            args: {
                company: me.filters.company,
                item_code: me.modal_context.item_code,
                from_date: me.modal_context.from_date,
                to_date: me.modal_context.to_date,
                warehouse: me.modal_context.warehouse,
            },
            callback: function (r) {
                $modalBody.removeClass('is-fetching');

                if (!r.message) {
                    $tbody.html('<tr><td colspan="8" class="sl-td text-center">未查询到该物料在选定期间的明细记录。</td></tr>');
                    $tfoot.empty();
                    return;
                }

                const d = r.message;
                me.modal_context.raw_data = d;
                me.modal_context.item_info = d.item_info;
                me.modal_context.movements = d.movements || [];

                const uom = d.item_info.stock_uom || '件';

                // 1. 微更新顶部标题与期间
                me.$body.find('.sl-modal-title').text(`${d.item_info.item_name} (${d.item_info.item_code})`);
                me.$body.find('.sl-modal-sub').text(`分类: ${d.item_info.item_group} · 规格型号: ${d.item_info.spec || '-'} · 计量单位: ${uom} · 期间: ${me.modal_context.from_date} 至 ${me.modal_context.to_date}`);

                // 2. 微更新 4 维纯实物结转看板 (去除任何金额修饰)
                me.$body.find('.sl-md-opening').text(`${me.format_num(d.opening.qty)} ${uom}`);
                me.$body.find('.sl-md-in').text(`+${me.format_num(d.current_in.qty)} ${uom}`);
                me.$body.find('.sl-md-out').text(`-${me.format_num(d.current_out.qty)} ${uom}`);
                me.$body.find('.sl-md-closing').text(`${me.format_num(d.closing.qty)} ${uom}`);

                const movements = d.movements || [];
                me.$body.find('.sl-modal-record-count').text(`共 ${movements.length} 笔出入库流水明细 · 实物守恒平账`);

                // 3. 渲染首行【上期结转 (期初)】
                const op = d.opening || { qty: 0 };
                const cin = d.current_in || { qty: 0 };
                const cout = d.current_out || { qty: 0 };
                const cl = d.closing || { qty: 0 };

                let rowsHtml = `
                    <tr class="sl-row sl-row-opening">
                        <td class="sl-td text-center sl-val-opening">期初</td>
                        <td class="sl-td">${frappe.utils.escape_html(me.modal_context.from_date)}</td>
                        <td class="sl-td">
                            <span class="sl-tag-badge sl-tag-opening">上期结转 (期初)</span>
                        </td>
                        <td class="sl-td text-muted">-</td>
                        <td class="sl-td">${frappe.utils.escape_html(me.modal_context.warehouse || '全部仓库')}</td>
                        <td class="sl-td sl-td-num text-muted sl-col-group-in">-</td>
                        <td class="sl-td sl-td-num text-muted sl-col-group-out">-</td>
                        <td class="sl-td sl-td-num sl-col-group-closing sl-val-opening"><strong>${me.format_num(op.qty)} ${uom}</strong></td>
                    </tr>
                `;

                // 4. 渲染期间流水明细 (入库 / 出库 独立分列 + 结存带单位)
                movements.forEach((m, idx) => {
                    const isPlus = m.is_in;
                    const inQtyHtml = isPlus ? `<span class="sl-val-in"><strong>+${me.format_num(Math.abs(m.actual_qty))}</strong></span>` : `<span class="text-muted">-</span>`;
                    const outQtyHtml = !isPlus ? `<span class="sl-val-out"><strong>-${me.format_num(Math.abs(m.actual_qty))}</strong></span>` : `<span class="text-muted">-</span>`;

                    rowsHtml += `
                        <tr class="sl-row">
                            <td class="sl-td text-center">${idx + 1}</td>
                            <td class="sl-td">${frappe.utils.escape_html(m.posting_date)} ${frappe.utils.escape_html(m.posting_time)}</td>
                            <td class="sl-td">
                                <span class="sl-tag-badge ${isPlus ? 'sl-tag-receipt' : 'sl-tag-issue'}">${frappe.utils.escape_html(m.voucher_type_label)}</span>
                            </td>
                            <td class="sl-td">
                                <a href="javascript:void(0)" class="sl-code-link sl-trigger-voucher-preview" data-vtype="${frappe.utils.escape_html(m.voucher_type)}" data-vno="${frappe.utils.escape_html(m.voucher_no)}" title="点击快速预览该单据明细">
                                    ${frappe.utils.escape_html(m.voucher_no)}
                                </a>
                            </td>
                            <td class="sl-td">${frappe.utils.escape_html(m.warehouse)}</td>
                            <td class="sl-td sl-td-num sl-col-group-in">${inQtyHtml}</td>
                            <td class="sl-td sl-td-num sl-col-group-out">${outQtyHtml}</td>
                            <td class="sl-td sl-td-num sl-col-group-closing"><strong>${me.format_num(m.qty_after_transaction)} ${uom}</strong></td>
                        </tr>
                    `;
                });

                if (!movements.length) {
                    rowsHtml += '<tr><td colspan="8" class="sl-td text-center">在所选核算期间内无新增出入库变动。</td></tr>';
                }

                // 5. 渲染底行【本期发生合计与期末结余】
                const tfootHtml = `
                    <tr class="sl-modal-tfoot-row">
                        <td class="sl-tf-td text-center">结余</td>
                        <td class="sl-tf-td" colspan="4">
                            <strong>本期发生合计与期末结余</strong>
                            <div class="sl-tfoot-badges">
                                <span class="sl-tag-badge sl-tag-receipt">累计入库 +${me.format_num(cin.qty)}</span>
                                <span class="sl-tag-badge sl-tag-issue">累计出库 -${me.format_num(cout.qty)}</span>
                                <span class="sl-tag-badge sl-tag-closing-badge">实物守恒平账</span>
                            </div>
                        </td>
                        <td class="sl-tf-td sl-td-num sl-col-group-in sl-val-in">
                            <strong>${cin.qty > 0 ? '+' + me.format_num(cin.qty) : '0.00'}</strong>
                        </td>
                        <td class="sl-tf-td sl-td-num sl-col-group-out sl-val-out">
                            <strong>${cout.qty > 0 ? '-' + me.format_num(cout.qty) : '0.00'}</strong>
                        </td>
                        <td class="sl-tf-td sl-td-num sl-col-group-closing sl-val-closing">
                            <strong>${me.format_num(cl.qty)} ${uom}</strong>
                        </td>
                    </tr>
                `;

                // 仅局部替换 tbody 与 tfoot，零重排抖动
                $tbody.html(rowsHtml);
                $tfoot.html(tfootHtml);
            },
            error: function () {
                $modalBody.removeClass('is-fetching');
            }
        });
    }

    close_detail_modal() {
        this.$body.find('.sl-modal-wrapper').removeClass('active');
        this.$body.find('.sl-modal-backdrop').removeClass('active');
    }

    export_modal_ledger_csv() {
        const movements = this.modal_context.movements || [];
        if (!movements.length) {
            frappe.msgprint('当前物料在选定期间暂无流水可导出');
            return;
        }

        const info = this.modal_context.item_info || {};
        const uom = info.stock_uom || '件';
        const headers = ['序号', '记账日期', '记账时间', '业务类型', '凭证单号', '发生仓库', '入库数量', '出库数量', `结存数量 (${uom})`];
        const rows = [headers];

        // 第一行：上期结转 (期初)
        const op = this.modal_context.raw_data ? this.modal_context.raw_data.opening : {};
        const cin = this.modal_context.raw_data ? this.modal_context.raw_data.current_in : {};
        const cout = this.modal_context.raw_data ? this.modal_context.raw_data.current_out : {};
        const cl = this.modal_context.raw_data ? this.modal_context.raw_data.closing : {};

        rows.push([
            '期初',
            this.modal_context.from_date,
            '00:00:00',
            '上期结转 (期初)',
            '-',
            this.modal_context.warehouse || '全部仓库',
            '-',
            '-',
            `${op.qty || 0} ${uom}`
        ]);

        movements.forEach((m, idx) => {
            const isPlus = m.is_in;
            rows.push([
                idx + 1,
                m.posting_date,
                m.posting_time,
                m.voucher_type_label,
                m.voucher_no,
                m.warehouse,
                isPlus ? `+${Math.abs(m.actual_qty)}` : '-',
                !isPlus ? `-${Math.abs(m.actual_qty)}` : '-',
                `${m.qty_after_transaction} ${uom}`
            ]);
        });

        // 尾行：本期合计与期末结余
        rows.push([
            '合计',
            this.modal_context.to_date,
            '23:59:59',
            '本期发生额合计',
            '-',
            this.modal_context.warehouse || '全部仓库',
            `+${Math.abs(cin.qty || 0)}`,
            `-${Math.abs(cout.qty || 0)}`,
            '-'
        ]);

        rows.push([
            '结余',
            this.modal_context.to_date,
            '23:59:59',
            '期末结余 (结转下期)',
            '实物守恒平账',
            this.modal_context.warehouse || '全部仓库',
            '-',
            '-',
            `${cl.qty || 0} ${uom}`
        ]);

        const filename = `${this.filters.company}_${info.item_code}_${info.item_name}_实物流水_${this.modal_context.from_date}_至_${this.modal_context.to_date}.csv`;
        this.download_csv(rows, filename);
    }

    export_table_data() {
        const items = this.summary_data.items || [];
        if (!items.length) {
            frappe.msgprint('暂无可导出的收发存汇总数据');
            return;
        }

        const isQty = this.display_mode === 'qty';
        let headers = [];
        let rows = [];

        if (isQty) {
            headers = ['序号', '物料分类', '物料编码', '物料名称', '规格型号', '计量单位', '所属仓库', '期初结存数量', '本期入库数量', '本期出库数量', '期末结存数量'];
            rows.push(headers);
            items.forEach((it, idx) => {
                rows.push([
                    idx + 1,
                    it.item_group || '',
                    it.item_code,
                    it.item_name,
                    it.spec || '',
                    it.stock_uom || '',
                    it.warehouse || '',
                    it.opening_qty,
                    it.in_qty,
                    it.out_qty,
                    it.closing_qty
                ]);
            });
        } else {
            headers = [
                '序号', '物料分类', '物料编码', '物料名称', '规格型号', '计量单位', '所属仓库',
                '期初数量', '期初单价', '期初金额',
                '本期入库数量', '入库均价', '本期入库金额',
                '本期出库数量', '出库均价', '本期出库金额',
                '期末结存数量', '结存单价', '期末结存金额'
            ];
            rows.push(headers);
            items.forEach((it, idx) => {
                rows.push([
                    idx + 1,
                    it.item_group || '',
                    it.item_code,
                    it.item_name,
                    it.spec || '',
                    it.stock_uom || '',
                    it.warehouse || '',
                    it.opening_qty,
                    it.opening_rate,
                    it.opening_val,
                    it.in_qty,
                    it.in_rate,
                    it.in_val,
                    it.out_qty,
                    it.out_rate,
                    it.out_val,
                    it.closing_qty,
                    it.closing_rate,
                    it.closing_val
                ]);
            });
        }

        const filename = `${this.filters.company}_收发存汇总_${isQty ? '实物数量' : '含金额'}_${this.filters.from_date}_至_${this.filters.to_date}.csv`;
        this.download_csv(rows, filename);
    }

    // ============================================================
    // 极速出库引擎 (Direct Submit Quick Stock Issue Engine)
    // ============================================================
    open_quick_issue_dialog(item_code, item_name, default_warehouse, current_stock, uom) {
        const me = this;
        let availableWarehouses = (this.available_warehouses || []).filter(w => w !== '全部仓库' && w !== 'All Warehouses');
        if (!availableWarehouses.length) {
            this.$body.find('.sl-select-warehouse option').each(function () {
                const val = $(this).val();
                if (val && val !== '全部仓库' && val !== 'All Warehouses' && !availableWarehouses.includes(val)) {
                    availableWarehouses.push(val);
                }
            });
        }
        let defaultWh = default_warehouse;
        if (!defaultWh || defaultWh === '全部仓库' || defaultWh === 'All Warehouses') {
            defaultWh = availableWarehouses[0] || '';
        }

        const d = new frappe.ui.Dialog({
            title: `快速出库 · ${frappe.utils.escape_html(item_name || item_code)}`,
            size: 'small',
            static: true,
            fields: [
                {
                    fieldtype: 'HTML',
                    fieldname: 'item_meta_html',
                    options: `
                        <div class="sl-voucher-meta-card">
                            <div class="sl-voucher-meta-row">
                                <div class="sl-voucher-meta-item">
                                    <span class="sl-voucher-meta-lbl">物料名称:</span>
                                    <span class="sl-voucher-meta-val"><strong>${frappe.utils.escape_html(item_name || item_code)}</strong></span>
                                </div>
                                <div class="sl-voucher-meta-item">
                                    <span class="sl-voucher-meta-lbl">物料编码:</span>
                                    <span class="sl-tag-badge sl-tag-receipt">${frappe.utils.escape_html(item_code)}</span>
                                </div>
                            </div>
                            <div class="sl-voucher-meta-row">
                                <div class="sl-voucher-meta-item">
                                    <span class="sl-voucher-meta-lbl">当前结存参考:</span>
                                    <span class="sl-voucher-meta-val text-success"><strong>${me.format_num(current_stock)}</strong> ${uom || ''}</span>
                                </div>
                                <div class="sl-voucher-meta-item">
                                    <span class="sl-voucher-meta-lbl">所属公司:</span>
                                    <span class="sl-voucher-meta-val">${frappe.utils.escape_html(me.filters.company)}</span>
                                </div>
                            </div>
                        </div>
                    `
                },
                {
                    fieldtype: 'Select',
                    fieldname: 'warehouse',
                    label: '出库仓库 (发货仓)',
                    options: availableWarehouses.join('\n'),
                    default: defaultWh,
                    reqd: 1
                },
                {
                    fieldtype: 'Float',
                    fieldname: 'qty',
                    label: `出库数量 (${uom || '单位'})`,
                    default: 1.0,
                    reqd: 1
                },
                {
                    fieldtype: 'Select',
                    fieldname: 'purpose',
                    label: '出库业务性质',
                    options: 'Material Issue\nMaterial Transfer\nManufacture',
                    default: 'Material Issue',
                    reqd: 1
                },
                {
                    fieldtype: 'Date',
                    fieldname: 'posting_date',
                    label: '出库记账日期',
                    default: frappe.datetime.get_today(),
                    reqd: 1
                },
                {
                    fieldtype: 'Small Text',
                    fieldname: 'remarks',
                    label: '领用人 / 领用用途说明 (如: 车间生产领用、维修领料等)'
                },
                {
                    fieldtype: 'Check',
                    fieldname: 'submit_direct',
                    label: '直接过账提交 (勾选后直接生效并更新库存，不勾选则保存为草稿)',
                    default: 1
                }
            ],
            primary_action_label: '确认出库 (直接提交生效)',
            primary_action: function (values) {
                const qtyVal = parseFloat(values.qty);
                if (isNaN(qtyVal) || qtyVal <= 0) {
                    frappe.msgprint('出库数量必须大于 0');
                    return;
                }

                const isDirectSubmit = values.submit_direct ? 1 : 0;

                d.get_primary_btn().prop('disabled', true);
                frappe.call({
                    method: 'ashan_cn_procurement.ashan_cn_procurement.page.stock_ledger_workbench.stock_ledger_workbench.create_quick_stock_issue',
                    args: {
                        company: me.filters.company,
                        item_code: item_code,
                        warehouse: values.warehouse,
                        qty: qtyVal,
                        purpose: 'Material Issue',
                        posting_date: values.posting_date,
                        remarks: values.remarks,
                        submit_doc: isDirectSubmit
                    },
                    callback: function (res) {
                        d.get_primary_btn().prop('disabled', false);
                        if (res && res.message) {
                            d.hide();
                            const docname = res.message.name;
                            const isSubmitted = res.message.is_submitted;
                            frappe.show_alert({
                                message: isSubmitted 
                                    ? `出库单 ${docname} 已成功过账提交生效，出库 ${qtyVal} ${uom || ''}！`
                                    : `出库单草稿 ${docname} 已创建！`,
                                indicator: isSubmitted ? 'green' : 'blue'
                            }, 7);

                            // 实时微更新：主台账与全景弹窗无感同步刷新
                            me.fetch_data();
                            if (me.$body.find('.sl-modal-wrapper').hasClass('active')) {
                                me.fetch_modal_history();
                            }
                        }
                    },
                    error: function () {
                        d.get_primary_btn().prop('disabled', false);
                    }
                });
            },
            secondary_action_label: '✕ 取消',
            secondary_action: function () {
                d.hide();
            }
        });

        d.show();
        d.set_value('submit_direct', 1);

        // 双重安全退出保障：右上角注入常驻醒目的 ✕ 关闭按钮
        const $header = d.$wrapper.find('.modal-header');
        $header.css('position', 'relative');
        if (!$header.find('.sl-dialog-close-btn').length) {
            const $closeBtn = $('<button type="button" class="sl-dialog-close-btn" title="关闭 (Esc)">✕</button>');
            $closeBtn.on('click', () => d.hide());
            $header.append($closeBtn);
        }
    }

    // ============================================================
    // 单据快速穿透弹窗预览引擎 (Voucher Quick Preview Modal)
    // ============================================================
    open_voucher_quick_dialog(voucher_type, voucher_no) {
        const me = this;
        const isOutbound = (voucher_type === 'Stock Entry' || voucher_type === 'Delivery Note');
        const defaultTitle = isOutbound ? `出库单明细 · ${frappe.utils.escape_html(voucher_no)}` : `入库单明细 · ${frappe.utils.escape_html(voucher_no)}`;

        const d = new frappe.ui.Dialog({
            title: defaultTitle,
            size: 'large',
            static: true,
            fields: [
                {
                    fieldtype: 'HTML',
                    fieldname: 'preview_html',
                }
            ],
            primary_action_label: '完整单据详情',
            primary_action: function () {
                window.open(`/app/${frappe.router.slug(voucher_type)}/${encodeURIComponent(voucher_no)}`, '_blank');
            },
            secondary_action_label: '关闭',
            secondary_action: function () {
                d.hide();
            }
        });

        d.fields_dict.preview_html.$wrapper.html(`
            <div class="sl-loading-state">
                <div class="sl-spinner"></div>
                <div>正在加载 ${frappe.utils.escape_html(voucher_no)} 明细内容...</div>
            </div>
        `);

        d.show();

        frappe.call({
            method: 'ashan_cn_procurement.ashan_cn_procurement.page.stock_ledger_workbench.stock_ledger_workbench.get_voucher_quick_detail',
            args: {
                voucher_type: voucher_type,
                voucher_no: voucher_no,
            },
            callback: function (r) {
                if (!r.message) {
                    d.fields_dict.preview_html.$wrapper.html('<div class="sl-empty-state">未能读取该单据明细。</div>');
                    return;
                }
                const v = r.message;
                d.set_title(v.voucher_title || `${v.voucher_type} · ${v.voucher_no}`);

                const isEntryIn = (v.voucher_category === 'inbound');
                const isEntryOut = (v.voucher_category === 'outbound');
                const isEntryTransfer = (v.voucher_category === 'transfer');

                // 区分单据类型徽标
                const badgeClass = isEntryIn ? 'sl-tag-receipt' : (isEntryOut ? 'sl-tag-issue' : 'sl-tag-opening');
                const statusBadge = `<span class="sl-tag-badge ${v.docstatus === 1 ? 'sl-tag-receipt' : 'sl-tag-issue'}">${frappe.utils.escape_html(v.status_label)}</span>`;

                // 供应商 / 客户 / 经办人
                let partyMeta = '';
                if (isEntryIn && v.supplier) {
                    partyMeta = `
                        <div class="sl-voucher-meta-item">
                            <span class="sl-voucher-meta-lbl">供货厂商:</span>
                            <span class="sl-voucher-meta-val">${frappe.utils.escape_html(v.supplier)}</span>
                        </div>
                    `;
                } else if (isEntryOut && v.customer) {
                    partyMeta = `
                        <div class="sl-voucher-meta-item">
                            <span class="sl-voucher-meta-lbl">领料客户:</span>
                            <span class="sl-voucher-meta-val">${frappe.utils.escape_html(v.customer)}</span>
                        </div>
                    `;
                }

                // 表头定制
                let colHeaders = '';
                if (isEntryIn) {
                    colHeaders = `
                        <th class="sl-th text-center">#</th>
                        <th class="sl-th">物料编码</th>
                        <th class="sl-th">物料名称</th>
                        <th class="sl-th">供货源头 / 供应商</th>
                        <th class="sl-th sl-col-group-in">收货目标仓库</th>
                        <th class="sl-th sl-col-group-in text-right">入库数量</th>
                    `;
                } else if (isEntryOut) {
                    colHeaders = `
                        <th class="sl-th text-center">#</th>
                        <th class="sl-th">物料编码</th>
                        <th class="sl-th">物料名称</th>
                        <th class="sl-th sl-col-group-out">出库发货仓库</th>
                        <th class="sl-th">领用用途 / 客户</th>
                        <th class="sl-th sl-col-group-out text-right">出库数量</th>
                    `;
                } else {
                    colHeaders = `
                        <th class="sl-th text-center">#</th>
                        <th class="sl-th">物料编码</th>
                        <th class="sl-th">物料名称</th>
                        <th class="sl-th">源调出仓库</th>
                        <th class="sl-th">目标调入仓库</th>
                        <th class="sl-th text-right">调拨数量</th>
                    `;
                }

                // 行项目生成
                let itemsHtml = '';
                (v.items || []).forEach(it => {
                    const qtyFmt = isEntryIn 
                        ? `<span class="sl-val-in"><strong>+${me.format_num(it.qty)}</strong> ${frappe.utils.escape_html(it.uom)}</span>`
                        : (isEntryOut 
                            ? `<span class="sl-val-out"><strong>-${me.format_num(it.qty)}</strong> ${frappe.utils.escape_html(it.uom)}</span>`
                            : `<strong>${me.format_num(it.qty)}</strong> ${frappe.utils.escape_html(it.uom)}`);

                    itemsHtml += `
                        <tr class="sl-row">
                            <td class="sl-td text-center">${it.idx}</td>
                            <td class="sl-td"><strong>${frappe.utils.escape_html(it.item_code)}</strong></td>
                            <td class="sl-td">${frappe.utils.escape_html(it.item_name)}</td>
                            <td class="sl-td">${frappe.utils.escape_html(it.source_warehouse)}</td>
                            <td class="sl-td">${frappe.utils.escape_html(it.target_warehouse)}</td>
                            <td class="sl-td sl-td-num">${qtyFmt}</td>
                        </tr>
                    `;
                });

                const totalQtyDisplay = isEntryIn
                    ? `<span class="sl-val-in">+${me.format_num(v.total_qty)}</span>`
                    : (isEntryOut ? `<span class="sl-val-out">-${me.format_num(v.total_qty)}</span>` : `${me.format_num(v.total_qty)}`);

                const previewContent = `
                    <div class="sl-voucher-preview-container">
                        <div class="sl-voucher-meta-card">
                            <div class="sl-voucher-meta-row">
                                <div class="sl-voucher-meta-item">
                                    <span class="sl-voucher-meta-lbl">业务性质:</span>
                                    <span class="sl-tag-badge ${badgeClass}">${frappe.utils.escape_html(v.purpose_label)}</span>
                                </div>
                                <div class="sl-voucher-meta-item">
                                    <span class="sl-voucher-meta-lbl">记账时间:</span>
                                    <span class="sl-voucher-meta-val">${frappe.utils.escape_html(v.posting_date)} ${frappe.utils.escape_html(v.posting_time)}</span>
                                </div>
                                <div class="sl-voucher-meta-item">
                                    <span class="sl-voucher-meta-lbl">单据状态:</span>
                                    ${statusBadge}
                                </div>
                            </div>
                            <div class="sl-voucher-meta-row">
                                <div class="sl-voucher-meta-item">
                                    <span class="sl-voucher-meta-lbl">所属公司:</span>
                                    <span class="sl-voucher-meta-val">${frappe.utils.escape_html(v.company)}</span>
                                </div>
                                ${partyMeta}
                                <div class="sl-voucher-meta-item sl-voucher-meta-full">
                                    <span class="sl-voucher-meta-lbl">用途/领用说明:</span>
                                    <span class="sl-voucher-meta-val text-muted">${frappe.utils.escape_html(v.remarks || '-')}</span>
                                </div>
                            </div>
                        </div>

                        <div class="sl-voucher-table-wrapper">
                            <table class="sl-table">
                                <colgroup>
                                    <col class="sl-cg-vp-idx">
                                    <col class="sl-cg-vp-code">
                                    <col class="sl-cg-vp-name">
                                    <col class="sl-cg-vp-swh">
                                    <col class="sl-cg-vp-twh">
                                    <col class="sl-cg-vp-qty">
                                </colgroup>
                                <thead class="sl-thead">
                                    <tr>
                                        ${colHeaders}
                                    </tr>
                                </thead>
                                <tbody>
                                    ${itemsHtml || '<tr><td colspan="6" class="sl-td text-center">无物料行项目</td></tr>'}
                                </tbody>
                                <tfoot class="sl-tfoot">
                                    <tr>
                                        <td class="sl-tf-td text-center">合计</td>
                                        <td class="sl-tf-td" colspan="4">共 ${(v.items || []).length} 项物料</td>
                                        <td class="sl-tf-td sl-td-num"><strong>${totalQtyDisplay}</strong></td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>
                `;
                d.fields_dict.preview_html.$wrapper.html(previewContent);
            }
        });
    }
}
