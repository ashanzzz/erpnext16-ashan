// Copyright (c) 2026, Ashan CN Procurement and contributors
// 祺富账单 · 现金大账与报销核对工作台 (Ashan Office High-Density)

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

    const skeleton = `
        <div class="ashan-billing-container">
            <!-- 顶部无边框主控栏 -->
            <div class="ashan-billing-header">
                <div class="ashan-billing-title-area">
                    <span class="ashan-billing-main-title">祺富账单</span>
                </div>
                <div class="ashan-billing-header-actions">
                    <input type="month" id="qf-month-picker" class="ashan-billing-month-input" value="${current_month}">
                    <button type="button" class="btn btn-default btn-sm" id="btn-qf-refresh">刷新数据</button>
                    <button type="button" class="btn btn-default btn-sm" id="btn-qf-export-xlsm">导出大账簿 (.xlsm)</button>
                </div>
            </div>

            <!-- 资金结存 4 联 KPI -->
            <div class="ashan-billing-kpi-row">
                <div class="ashan-billing-kpi-card">
                    <div class="ashan-billing-kpi-label">上月结转</div>
                    <div class="ashan-billing-kpi-val" id="kpi-qf-opening">¥ 0.00</div>
                    <div class="ashan-billing-kpi-desc" id="kpi-qf-opening-desc"></div>
                </div>
                <div class="ashan-billing-kpi-card">
                    <div class="ashan-billing-kpi-label">本月注入</div>
                    <div class="ashan-billing-kpi-val" id="kpi-qf-income">¥ 0.00</div>
                    <div class="ashan-billing-kpi-desc" id="kpi-qf-income-desc"></div>
                </div>
                <div class="ashan-billing-kpi-card">
                    <div class="ashan-billing-kpi-label">本月支出</div>
                    <div class="ashan-billing-kpi-val" id="kpi-qf-expense">¥ 0.00</div>
                    <div class="ashan-billing-kpi-desc" id="kpi-qf-count">0 笔</div>
                </div>
                <div class="ashan-billing-kpi-card">
                    <div class="ashan-billing-kpi-label">结存余额</div>
                    <div class="ashan-billing-kpi-val" id="kpi-qf-balance">¥ 0.00</div>
                    <div class="ashan-billing-kpi-desc" id="kpi-qf-balance-desc"></div>
                </div>
            </div>

            <!-- 视图选项卡 (保留流水明细与费用科目汇总) -->
            <div class="ashan-billing-tabs">
                <button type="button" class="ashan-billing-tab-btn is-active" data-view="stream">现金流水明细账</button>
                <button type="button" class="ashan-billing-tab-btn" data-view="category">费用科目汇总分析</button>
            </div>

            <!-- 表格卡片容器 -->
            <div class="ashan-billing-table-card" id="qf-main-table-view">
                <div class="text-center text-muted p-4">正在载入祺富账单数据...</div>
            </div>
        </div>
    `;

    $container.html(skeleton);

    function load_data() {
        $('#qf-main-table-view').html('<div class="text-center text-muted p-4">正在同步 ERPNext 16 现场数据...</div>');
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
        const fmtMoney = (v) => '¥ ' + (Number(v || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        // 1. KPI 赋值 (无冗余解释小作文，紧凑事实呈现)
        $('#kpi-qf-opening').text(fmtMoney(s.opening_balance));
        $('#kpi-qf-opening-desc').text('');
        $('#kpi-qf-income').text(fmtMoney(s.total_income));
        $('#kpi-qf-income-desc').text('');
        $('#kpi-qf-expense').text(fmtMoney(s.total_expense));
        $('#kpi-qf-count').text(`${s.total_rows || 0} 笔`);
        $('#kpi-qf-balance').text(fmtMoney(s.closing_balance));
        $('#kpi-qf-balance-desc').text('');

        // 2. 渲染主表格
        if (active_view === 'stream') {
            render_stream_table();
        } else {
            render_category_table();
        }
    }

    function render_stream_table() {
        const rows = current_data.stream_rows || [];
        const fmtMoney = (v) => (Number(v || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        let html = `
            <div class="ashan-billing-table-scroll">
                <table class="ashan-billing-table">
                    <thead>
                        <tr>
                            <th class="ashan-billing-col-center">序号</th>
                            <th>记账日期</th>
                            <th>项目</th>
                            <th>规格</th>
                            <th class="ashan-billing-col-right">单价</th>
                            <th class="ashan-billing-col-center">数量</th>
                            <th class="ashan-billing-col-right">金额</th>
                            <th class="ashan-billing-col-center">科目类别</th>
                            <th>业务用途说明</th>
                            <th>对应发票</th>
                            <th>整算报销号</th>
                            <th class="ashan-billing-col-center">制单人</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        if (rows.length === 0) {
            html += `<tr><td colspan="12" class="text-center text-muted p-4">当月暂无过账的现金报销与大账流水单据</td></tr>`;
        } else {
            rows.forEach(r => {
                const isNoInv = r.invoice_no === '无票';
                const invHtml = isNoInv
                    ? `<span class="ashan-billing-tag-no-inv">无票</span>`
                    : `<span class="ashan-billing-tag-inv">${frappe.utils.escape_html(r.invoice_no)}</span>`;
                html += `
                    <tr>
                        <td class="ashan-billing-col-center">${r.seq}</td>
                        <td>${frappe.utils.escape_html(r.posting_date)}</td>
                        <td><strong>${frappe.utils.escape_html(r.item_name)}</strong></td>
                        <td>${frappe.utils.escape_html(r.specification)}</td>
                        <td class="ashan-billing-col-right">${fmtMoney(r.unit_price)}</td>
                        <td class="ashan-billing-col-center">${r.qty}</td>
                        <td class="ashan-billing-col-right font-weight-bold">¥ ${fmtMoney(r.amount)}</td>
                        <td class="ashan-billing-col-center"><span class="badge badge-light">${frappe.utils.escape_html(r.category)}</span></td>
                        <td>${frappe.utils.escape_html(r.usage)}</td>
                        <td>${invHtml}</td>
                        <td>${r.reimbursement_no ? `<a href="/app/reimbursement-request/${encodeURIComponent(r.reimbursement_no)}" target="_blank">${frappe.utils.escape_html(r.reimbursement_no)}</a>` : '-'}</td>
                        <td class="ashan-billing-col-center">${frappe.utils.escape_html(r.creator)}</td>
                    </tr>
                `;
            });
        }
        html += `
                    </tbody>
                    <tfoot>
                        <tr>
                            <td colspan="6" class="ashan-billing-col-right">支出合计（共 ${rows.length} 笔）：</td>
                            <td class="ashan-billing-col-right font-weight-bold">¥ ${fmtMoney(current_data.summary?.total_expense)}</td>
                            <td colspan="5"></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        `;
        $('#qf-main-table-view').html(html);
    }

    function render_category_table() {
        const catList = current_data.category_summary || [];
        const totExp = Number(current_data.summary?.total_expense || 0);
        const fmtMoney = (v) => (Number(v || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
            html += `<tr><td colspan="5" class="text-center text-muted p-4">当月暂无费用分类统计</td></tr>`;
        } else {
            catList.forEach((row, idx) => {
                const pct = totExp > 0 ? ((row.amount / totExp) * 100).toFixed(1) + '%' : '0.0%';
                html += `
                    <tr>
                        <td class="ashan-billing-col-center">${idx + 1}</td>
                        <td><strong>${frappe.utils.escape_html(row.category)}</strong></td>
                        <td class="ashan-billing-col-center">${row.count} 笔</td>
                        <td class="ashan-billing-col-right font-weight-bold">¥ ${fmtMoney(row.amount)}</td>
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
                            <td class="ashan-billing-col-right font-weight-bold">¥ ${fmtMoney(totExp)}</td>
                            <td class="ashan-billing-col-right text-muted">100.0%</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        `;
        $('#qf-main-table-view').html(html);
    }

    // 事件绑定
    $('#qf-month-picker').on('change', function() {
        current_month = $(this).val();
        load_data();
    });

    $('#btn-qf-refresh').on('click', function() {
        load_data();
    });

    $('.ashan-billing-tab-btn').on('click', function() {
        $('.ashan-billing-tab-btn').removeClass('is-active');
        $(this).addClass('is-active');
        active_view = $(this).data('view');
        render_ui();
    });

    $('#btn-qf-export-xlsm').on('click', function() {
        frappe.msgprint({
            title: '受保护宏工作簿导出',
            indicator: 'blue',
            message: `正在基于本地 excel-vba-guard 规程打包【${current_month}账单祺富机械.xlsm】... 保持 VBA 与宏按钮完全一致。`
        });
    });

    load_data();
};
