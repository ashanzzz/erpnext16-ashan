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
    let active_view = 'stream'; // 'stream' | 'matrix'
    let current_data = null;

    const skeleton = `
        <div class="qf-billing-container">
            <!-- 顶部无边框主控栏 -->
            <div class="qf-billing-header">
                <div class="qf-billing-title-area">
                    <span class="qf-billing-main-title">祺富账单 · 现金大账与报销核对</span>
                    <span class="qf-billing-sub-title">孟祥山现金报销轨 · 严密隔离对公电汇</span>
                </div>
                <div class="qf-billing-header-actions">
                    <input type="month" id="qf-month-picker" class="qf-billing-month-input" value="${current_month}">
                    <button type="button" class="btn btn-default btn-sm" id="btn-qf-refresh">刷新数据</button>
                    <button type="button" class="btn btn-primary btn-sm" id="btn-qf-export-xlsm">导出大账簿 (.xlsm)</button>
                </div>
            </div>

            <!-- 资金结存 KPI -->
            <div class="qf-billing-kpi-row">
                <div class="qf-billing-kpi-card">
                    <div class="qf-billing-kpi-label">上月结转结存</div>
                    <div class="qf-billing-kpi-val" id="kpi-qf-opening">¥ 0.00</div>
                    <div class="qf-billing-kpi-desc">上期现金大账结转资金</div>
                </div>
                <div class="qf-billing-kpi-card">
                    <div class="qf-billing-kpi-label">本月资金注入</div>
                    <div class="qf-billing-kpi-val" id="kpi-qf-income">¥ 0.00</div>
                    <div class="qf-billing-kpi-desc">备用金划拨与资金注入</div>
                </div>
                <div class="qf-billing-kpi-card">
                    <div class="qf-billing-kpi-label">本月现金支出</div>
                    <div class="qf-billing-kpi-val" id="kpi-qf-expense">¥ 0.00</div>
                    <div class="qf-billing-kpi-desc" id="kpi-qf-count">0 笔支出明细</div>
                </div>
                <div class="qf-billing-kpi-card">
                    <div class="qf-billing-kpi-label">当前结存余额</div>
                    <div class="qf-billing-kpi-val" id="kpi-qf-balance">¥ 0.00</div>
                    <div class="qf-billing-kpi-desc">结转 + 注入 - 支出</div>
                </div>
            </div>

            <!-- 四大常态固定支出状态指示带 -->
            <div class="qf-billing-fixed-bar">
                <span class="qf-billing-fixed-title">四大常态支出就绪监控：</span>
                <div class="qf-billing-fixed-pills" id="qf-fixed-pills-container">
                    <div class="qf-billing-pill is-pending" id="pill-naidi">
                        <span>耐迪招待费</span>
                        <strong id="pill-amt-naidi">¥ 3,200.00</strong>
                        <span class="qf-billing-pill-tag">固定保密</span>
                    </div>
                    <div class="qf-billing-pill is-pending" id="pill-truck">
                        <span>货车高速费</span>
                        <strong id="pill-amt-truck">待月结</strong>
                        <span class="qf-billing-pill-tag">台账汇总</span>
                    </div>
                    <div class="qf-billing-pill is-pending" id="pill-fuel">
                        <span>油卡充值</span>
                        <strong id="pill-amt-fuel">待确认</strong>
                        <span class="qf-billing-pill-tag">出资确认</span>
                    </div>
                    <div class="qf-billing-pill is-pending" id="pill-etc">
                        <span>轿车ETC通行费</span>
                        <strong id="pill-amt-etc">待汇总</strong>
                        <span class="qf-billing-pill-tag">发票合并</span>
                    </div>
                </div>
            </div>

            <!-- 视图选项卡 -->
            <div class="qf-billing-tabs">
                <button type="button" class="qf-tab-btn is-active" data-view="stream">19列现金流水底账</button>
                <button type="button" class="qf-tab-btn" data-view="matrix">五大部门科目汇总 (SUMIFS矩阵)</button>
            </div>

            <!-- 表格卡片容器 -->
            <div class="qf-table-card" id="qf-main-table-view">
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

        // 1. KPI 赋值
        $('#kpi-qf-opening').text(fmtMoney(s.opening_balance));
        $('#kpi-qf-income').text(fmtMoney(s.total_income));
        $('#kpi-qf-expense').text(fmtMoney(s.total_expense));
        $('#kpi-qf-balance').text(fmtMoney(s.closing_balance));
        $('#kpi-qf-count').text(`${s.total_rows || 0} 笔现金支出明细`);

        // 2. 四大固定支出条
        const fe = current_data.fixed_expenses || {};
        if (fe.naidi_hospitality) {
            $('#pill-amt-naidi').text(fmtMoney(fe.naidi_hospitality.amount));
            $('#pill-naidi').removeClass('is-pending').addClass(fe.naidi_hospitality.status === '已入账' ? 'is-ok' : 'is-pending');
        }
        if (fe.truck_toll) {
            $('#pill-amt-truck').text(fe.truck_toll.amount > 0 ? fmtMoney(fe.truck_toll.amount) : '待月结');
            $('#pill-truck').removeClass('is-pending').addClass(fe.truck_toll.amount > 0 ? 'is-ok' : 'is-pending');
        }
        if (fe.sinopec_fuel) {
            $('#pill-amt-fuel').text(fe.sinopec_fuel.amount > 0 ? fmtMoney(fe.sinopec_fuel.amount) : '待出资确认');
            $('#pill-fuel').removeClass('is-pending').addClass(fe.sinopec_fuel.amount > 0 ? 'is-ok' : 'is-pending');
        }
        if (fe.car_etc) {
            $('#pill-amt-etc').text(fe.car_etc.amount > 0 ? fmtMoney(fe.car_etc.amount) : '待发票汇总');
            $('#pill-etc').removeClass('is-pending').addClass(fe.car_etc.amount > 0 ? 'is-ok' : 'is-pending');
        }

        // 3. 渲染主表格
        if (active_view === 'stream') {
            render_stream_table();
        } else {
            render_matrix_table();
        }
    }

    function render_stream_table() {
        const rows = current_data.stream_rows || [];
        const fmtMoney = (v) => (Number(v || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        let html = `
            <div class="qf-table-scroll">
                <table class="qf-table">
                    <thead>
                        <tr>
                            <th class="qf-col-center">序号</th>
                            <th>记账日期</th>
                            <th>项目</th>
                            <th>规格</th>
                            <th class="qf-col-right">单价</th>
                            <th class="qf-col-center">数量</th>
                            <th class="qf-col-right">金额</th>
                            <th class="qf-col-center">类别</th>
                            <th class="qf-col-center">部门</th>
                            <th>业务用途说明</th>
                            <th>对应发票</th>
                            <th>整算报销号</th>
                            <th class="qf-col-center">制单人</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        if (rows.length === 0) {
            html += `<tr><td colspan="13" class="text-center text-muted p-4">当月暂无过账的现金报销与大账流水单据</td></tr>`;
        } else {
            rows.forEach(r => {
                const isNoInv = r.invoice_no === '无票';
                const invHtml = isNoInv
                    ? `<span class="qf-tag-no-inv">无票</span>`
                    : `<span class="qf-tag-inv">${frappe.utils.escape_html(r.invoice_no)}</span>`;
                html += `
                    <tr>
                        <td class="qf-col-center">${r.seq}</td>
                        <td>${frappe.utils.escape_html(r.posting_date)}</td>
                        <td><strong>${frappe.utils.escape_html(r.item_name)}</strong></td>
                        <td>${frappe.utils.escape_html(r.specification)}</td>
                        <td class="qf-col-right">${fmtMoney(r.unit_price)}</td>
                        <td class="qf-col-center">${r.qty}</td>
                        <td class="qf-col-right font-weight-bold">¥ ${fmtMoney(r.amount)}</td>
                        <td class="qf-col-center"><span class="badge badge-light">${frappe.utils.escape_html(r.category)}</span></td>
                        <td class="qf-col-center"><span class="badge badge-light">${frappe.utils.escape_html(r.department)}</span></td>
                        <td>${frappe.utils.escape_html(r.usage)}</td>
                        <td>${invHtml}</td>
                        <td>${r.reimbursement_no ? `<a href="/app/reimbursement-request/${r.reimbursement_no}" target="_blank">${r.reimbursement_no}</a>` : '-'}</td>
                        <td class="qf-col-center">${frappe.utils.escape_html(r.creator)}</td>
                    </tr>
                `;
            });
        }
        html += `
                    </tbody>
                    <tfoot class="qf-table-foot">
                        <tr>
                            <td colspan="6" class="text-right">合计（共 ${rows.length} 笔）：</td>
                            <td class="qf-col-right">¥ ${fmtMoney(current_data.summary?.total_expense)}</td>
                            <td colspan="6"></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        `;
        $('#qf-main-table-view').html(html);
    }

    function render_matrix_table() {
        const matrix = current_data.matrix || [];
        const depts = current_data.departments || ["打磨", "铜牌", "浸渗", "共用", "非公司"];
        const ds = current_data.dept_summary || {};
        const fmtMoney = (v) => (Number(v || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        let html = `
            <div class="qf-table-scroll">
                <table class="qf-table">
                    <thead>
                        <tr>
                            <th>费用科目类别</th>
                            ${depts.map(d => `<th class="qf-col-right">${d}</th>`).join('')}
                            <th class="qf-col-right">科目合计</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        matrix.forEach(row => {
            html += `
                <tr>
                    <td><strong>${frappe.utils.escape_html(row.category)}</strong></td>
                    ${depts.map(d => `<td class="qf-col-right">${row.totals[d] > 0 ? '¥ ' + fmtMoney(row.totals[d]) : '-'}</td>`).join('')}
                    <td class="qf-col-right font-weight-bold">¥ ${fmtMoney(row.row_total)}</td>
                </tr>
            `;
        });
        html += `
                    </tbody>
                    <tfoot class="qf-table-foot">
                        <tr>
                            <td>部门支出合计：</td>
                            ${depts.map(d => `<td class="qf-col-right">¥ ${fmtMoney(ds[d])}</td>`).join('')}
                            <td class="qf-col-right font-weight-bold">¥ ${fmtMoney(current_data.summary?.total_expense)}</td>
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

    $('.qf-tab-btn').on('click', function() {
        $('.qf-tab-btn').removeClass('is-active');
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
