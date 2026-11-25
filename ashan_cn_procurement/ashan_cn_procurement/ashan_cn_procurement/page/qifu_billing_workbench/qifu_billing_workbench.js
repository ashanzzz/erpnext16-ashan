// Copyright (c) 2026, Ashan CN Procurement and contributors
// 祺富账单 · 现金大账与报销核对工作台 (Ashan Office High-Density & Four-Pillar Conservation)

frappe.pages['qifu-billing-workbench'].on_page_load = function(wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: '祺富账单',
        single_column: true
    });

    const $container = $(wrapper).find('.layout-main-section');
    $container.empty();

    let current_month = frappe.datetime.now_date().slice(0, 7);
    let active_view = 'stream'; // 'stream' | 'category'
    let current_data = null;
    const company = "天津祺富机械加工有限公司";

    const skeleton = `
        <div class="ashan-billing-container">
            <!-- 顶部主控栏 -->
            <div class="ashan-billing-header">
                <div class="ashan-billing-title-area">
                    <span class="ashan-billing-main-title">祺富账单</span>
                    <span id="qf-lock-status-pill" class="ashan-billing-status-pill">🟡 待对账</span>
                </div>
                <div class="ashan-billing-header-actions">
                    <div id="qf-period-selector-mount" class="ashan-period-mount"></div>
                    <input type="hidden" id="qf-month-picker" value="${current_month}">
                    <button type="button" class="btn btn-default btn-sm" id="btn-qf-refresh">刷新数据</button>
                    <button type="button" class="btn btn-default btn-sm" id="btn-qf-quick-add">+ 记一笔支出</button>
                    <button type="button" class="btn btn-default btn-sm" id="btn-qf-recurring">常态固定支出配置</button>
                    <button type="button" class="btn btn-default btn-sm" id="btn-qf-toggle-lock">核定封账 🔒</button>
                    <button type="button" class="btn btn-default btn-sm" id="btn-qf-export-xlsx">导出规范账单 (.xlsx)</button>
                </div>
            </div>

            <!-- 资金台账 KPI -->
            <div class="ashan-billing-kpi-row">
                <div class="ashan-billing-kpi-card">
                    <div class="ashan-billing-kpi-label">上期期初结存</div>
                    <div class="ashan-billing-kpi-val" id="kpi-qf-opening">¥ 0.00</div>
                    <div class="ashan-billing-kpi-desc" id="kpi-qf-opening-desc">上月结转基数</div>
                </div>
                <div class="ashan-billing-kpi-card">
                    <div class="ashan-billing-kpi-label">本月资金注入</div>
                    <div class="ashan-billing-kpi-val" id="kpi-qf-income">¥ 0.00</div>
                    <div class="ashan-billing-kpi-desc" id="kpi-qf-income-desc">借方资金流入</div>
                </div>
                <div class="ashan-billing-kpi-card">
                    <div class="ashan-billing-kpi-label">本月支出合计</div>
                    <div class="ashan-billing-kpi-val" id="kpi-qf-expense">¥ 0.00</div>
                    <div class="ashan-billing-kpi-desc" id="kpi-qf-count">0 笔</div>
                </div>
                <div class="ashan-billing-kpi-card">
                    <div class="ashan-billing-kpi-label">期末账户结存</div>
                    <div class="ashan-billing-kpi-val" id="kpi-qf-balance">¥ 0.00</div>
                    <div class="ashan-billing-kpi-desc" id="kpi-qf-balance-desc">截至当期期末</div>
                </div>
            </div>

            <!-- 视图选项卡 -->
            <div class="ashan-billing-tabs">
                <button type="button" class="ashan-billing-tab-btn is-active" data-view="stream">现金流水明细账 (穿透单据)</button>
                <button type="button" class="ashan-billing-tab-btn" data-view="category">费用科目汇总分析</button>
            </div>

            <!-- 表格卡片容器 -->
            <div class="ashan-billing-table-card" id="qf-main-table-view">
                <div class="text-center text-muted p-4">正在载入祺富账单数据...</div>
            </div>
        </div>
    `;

    $container.html(skeleton);

    let qf_period_selector = null;
    function setup_qf_period_selector() {
        if (!window.AshanUI || typeof window.AshanUI.renderPeriodSelector !== "function") return;
        const $mount = $('#qf-period-selector-mount');
        if (!$mount.length) return;
        qf_period_selector = window.AshanUI.renderPeriodSelector($mount, {
            period: current_month,
            align: 'right',
            onChange: function(y, m, periodStr) {
                current_month = periodStr;
                $('#qf-month-picker').val(current_month);
                load_data();
            }
        });
    }
    setup_qf_period_selector();

    function load_data() {
        $('#qf-main-table-view').html('<div class="text-center text-muted p-4">正在穿透 ERPNext GL Entry 汇算真实数据...</div>');
        frappe.call({
            method: 'ashan_cn_procurement.ashan_cn_procurement.page.qifu_billing_workbench.qifu_billing_workbench.get_qifu_billing_data',
            args: { period_month: current_month },
            callback: function(r) {
                if (r.message) {
                    current_data = r.message;
                    render_ui();
                } else {
                    $('#qf-main-table-view').html('<div class="text-center text-danger p-4">加载失败或无数据返回</div>');
                }
            }
        });
    }

    function render_ui() {
        if (!current_data) return;
        const s = current_data.summary || {};

        // 1. 锁状态指示
        const isLocked = !!current_data.is_locked;
        if (isLocked) {
            $('#qf-lock-status-pill').removeClass('is-pending').addClass('is-locked').text('🔒 已核定封账');
            $('#btn-qf-toggle-lock').text('反审核解锁 🟡');
            $('#btn-qf-quick-add').prop('disabled', true);
        } else {
            $('#qf-lock-status-pill').removeClass('is-locked').addClass('is-pending').text('🟡 待对账');
            $('#btn-qf-toggle-lock').text('核定封账 🔒');
            $('#btn-qf-quick-add').prop('disabled', false);
        }

        // 2. 台账 KPI 赋值与负数红字警示
        const opVal = Number(s.opening_balance || 0);
        const clsVal = Number(s.closing_balance || 0);
        $('#kpi-qf-opening').text(AshanUI.formatMoney(opVal)).toggleClass('text-danger', opVal < 0);
        $('#kpi-qf-income').text(AshanUI.formatMoney(s.total_income));
        $('#kpi-qf-expense').text(AshanUI.formatMoney(s.total_expense));
        $('#kpi-qf-count').text(`${s.total_rows || 0} 笔流水`);
        $('#kpi-qf-balance').text(AshanUI.formatMoney(clsVal)).toggleClass('text-danger', clsVal < 0);

        // 3. 渲染主表格
        if (active_view === 'stream') {
            render_stream_table();
        } else {
            render_category_table();
        }
    }

    function render_stream_table() {
        const rows = current_data.stream_rows || [];
        const s = current_data.summary || {};
        AshanUI.renderBillingLedgerTable($('#qf-main-table-view'), {
            rows: rows,
            periodMonth: current_month,
            openingBalance: Number(s.opening_balance || 0),
            openingRemark: '上月经核定之结存余额',
            totalIncome: Number(s.total_income || 0),
            totalExpense: Number(s.total_expense || 0),
            closingBalance: Number(s.closing_balance || 0),
            emptyText: `当前账期 ${current_month} 在【祺富现金大账】下暂无流水单据`,
            onRowClick: function(row) {
                AshanUI.showBillingDetailModal(row, { accountLabel: '现金大账', showCategory: true });
            }
        });
    }

    function render_category_table() {
        const catList = current_data.category_summary || [];
        const totExp = Number(current_data.summary?.total_expense || 0);
        let html = `
            <div class="ashan-billing-table-scroll">
                <table class="ashan-billing-table">
                    <thead>
                        <tr>
                            <th class="ashan-billing-col-center">序号</th>
                            <th>费用科目类别</th>
                            <th class="ashan-billing-col-center">支出笔数</th>
                            <th class="ashan-billing-col-right">科目支出合计</th>
                            <th class="ashan-billing-col-right">占当月支出比例</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        if (catList.length === 0) {
            html += `<tr><td colspan="5" class="text-center text-muted p-4">当前账期 ${frappe.utils.escape_html(current_month)} 暂无费用分类统计</td></tr>`;
        } else {
            catList.forEach((row, idx) => {
                const pct = totExp > 0 ? ((row.amount / totExp) * 100).toFixed(1) + '%' : '0.0%';
                html += `
                    <tr>
                        <td class="ashan-billing-col-center">${idx + 1}</td>
                        <td><strong>${frappe.utils.escape_html(row.category)}</strong></td>
                        <td class="ashan-billing-col-center">${row.count} 笔</td>
                        <td class="ashan-billing-col-right ashan-money-cell font-weight-bold">${AshanUI.formatMoney(row.amount)}</td>
                        <td class="ashan-billing-col-right text-muted">${pct}</td>
                    </tr>
                `;
            });
        }
        html += `
                    </tbody>
                    <tfoot>
                        <tr>
                            <td colspan="3" class="ashan-billing-col-right">全科目总支出：</td>
                            <td class="ashan-billing-col-right ashan-money-cell font-weight-bold">${AshanUI.formatMoney(totExp)}</td>
                            <td class="ashan-billing-col-right text-muted">100.0%</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        `;
        $('#qf-main-table-view').html(html);
    }

    // 就地记账录单
    function show_quick_add_modal() {
        const d = new frappe.ui.Dialog({
            title: '就地快捷记账 (生成已过账报销单)',
            static: true,
            secondary_action_label: '取消',
            secondary_action: function() {
                d.hide();
            },
            fields: [
                { label: '记账日期', fieldname: 'posting_date', fieldtype: 'Date', default: frappe.datetime.now_date(), reqd: 1 },
                { label: '支出项目', fieldname: 'item_name', fieldtype: 'Data', reqd: 1 },
                { label: '规格', fieldname: 'specification', fieldtype: 'Data' },
                { label: '支出金额 (元)', fieldname: 'amount', fieldtype: 'Currency', reqd: 1 },
                { label: '费用科目分类', fieldname: 'category', fieldtype: 'Select', options: '五金耗材\n客车耗材\n货车耗材\n车间餐饮\n其他招待\n油卡充值\n高速费\n其他服务费', default: '五金耗材', reqd: 1 },
                { label: '发票号码 (无发票填无票)', fieldname: 'invoice_no', fieldtype: 'Data', default: '无票' },
                { label: '业务用途说明与备注', fieldname: 'remarks', fieldtype: 'Small Text' }
            ],
            primary_action_label: '提交并过账生效',
            primary_action: function(values) {
                frappe.call({
                    method: 'ashan_cn_procurement.ashan_cn_procurement.page.qifu_billing_workbench.qifu_billing_workbench.create_quick_billing_expense',
                    args: {
                        company: company,
                        posting_date: values.posting_date,
                        item_name: values.item_name,
                        specification: values.specification,
                        amount: values.amount,
                        category: values.category,
                        invoice_no: values.invoice_no,
                        remarks: values.remarks
                    },
                    callback: function(r) {
                        if (r.message && r.message.status === 'ok') {
                            frappe.show_alert({ message: r.message.message, indicator: 'green' });
                            d.hide();
                            load_data();
                        }
                    }
                });
            }
        });
        d.show();
    }

    // 常态固定支出配置与全自动录单
    function show_recurring_config_modal() {
        const d = new frappe.ui.Dialog({
            title: '祺富常态固定支出配置与全自动录单',
            size: 'large',
            fields: [
                { fieldtype: 'HTML', fieldname: 'config_html' }
            ],
            primary_action_label: '一键全自动录入当月固定支出',
            primary_action: function() {
                frappe.confirm(`确定全自动录入并过账【${current_month}】的所有启用固定支出单据吗？`, function() {
                    frappe.call({
                        method: 'ashan_cn_procurement.services.billing_recurring_service.auto_generate_monthly_recurring_expenses',
                        args: {
                            period_month: current_month,
                            company: company
                        },
                        callback: function(r) {
                            if (r.message) {
                                frappe.msgprint({
                                    title: '自动录单完成',
                                    indicator: 'green',
                                    message: r.message.results.map(x => x.message).join('<br>')
                                });
                                d.hide();
                                load_data();
                            }
                        }
                    });
                });
            }
        });

        frappe.call({
            method: 'ashan_cn_procurement.services.billing_recurring_service.get_recurring_configs',
            args: { company: company },
            callback: function(r) {
                const list = r.message || [];
                let tbl = `
                    <div class="ashan-billing-config-tip">
                        以下为系统常态支出底册，支持动态修改与启用。系统在账期内可一键全自动生成真实报销单。
                    </div>
                    <table class="table table-bordered table-sm ashan-billing-config-table">
                        <thead>
                            <tr>
                                <th>支出项目</th>
                                <th>发生日期</th>
                                <th>默认金额</th>
                                <th>科目分类</th>
                                <th>自动录单</th>
                                <th>说明</th>
                            </tr>
                        </thead>
                        <tbody>
                `;
                list.forEach(c => {
                    tbl += `
                        <tr>
                            <td><strong>${c.expense_name}</strong></td>
                            <td>每月 ${c.day_of_month} 日</td>
                            <td>¥ ${(c.default_amount || 0).toFixed(2)}</td>
                            <td>${c.category || '-'}</td>
                            <td>${c.auto_generate ? '<span class="badge badge-success">是</span>' : '<span class="badge badge-light">否</span>'}</td>
                            <td>${c.remarks || '-'}</td>
                        </tr>
                    `;
                });
                tbl += `</tbody></table>`;
                d.fields_dict.config_html.$wrapper.html(tbl);
                d.show();
            }
        });
    }

    // 事件绑定
    $('#qf-month-picker').on('change', function() {
        current_month = $(this).val();
        if (qf_period_selector) qf_period_selector.setPeriod(current_month);
        load_data();
    });

    $('#btn-qf-refresh').on('click', function() {
        load_data();
    });

    $('#btn-qf-quick-add').on('click', function() {
        show_quick_add_modal();
    });

    $('#btn-qf-recurring').on('click', function() {
        show_recurring_config_modal();
    });

    $('#btn-qf-toggle-lock').on('click', function() {
        const nextLock = current_data && current_data.is_locked ? 0 : 1;
        frappe.confirm(`确定要执行【${nextLock ? '核定封账 🔒' : '反审核解锁 🟡'}】操作吗？`, function() {
            frappe.call({
                method: 'ashan_cn_procurement.ashan_cn_procurement.page.qifu_billing_workbench.qifu_billing_workbench.toggle_monthly_billing_lock',
                args: {
                    company: company,
                    period_month: current_month,
                    lock: nextLock
                },
                callback: function(r) {
                    if (r.message && r.message.status === 'ok') {
                        frappe.show_alert({ message: r.message.message, indicator: 'green' });
                        load_data();
                    }
                }
            });
        });
    });

    $('.ashan-billing-tab-btn').on('click', function() {
        $('.ashan-billing-tab-btn').removeClass('is-active');
        $(this).addClass('is-active');
        active_view = $(this).data('view');
        render_ui();
    });

    $('#btn-qf-export-xlsx').on('click', function() {
        const url = `/api/method/ashan_cn_procurement.services.billing_export_service.export_qifu_billing_excel?period_month=${encodeURIComponent(current_month)}`;
        window.open(url);
    });

    load_data();
};
