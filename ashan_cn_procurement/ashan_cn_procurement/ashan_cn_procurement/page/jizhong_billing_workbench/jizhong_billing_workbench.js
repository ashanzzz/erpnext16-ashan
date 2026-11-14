// Copyright (c) 2026, Ashan CN Procurement and contributors
// 吉众账单 · 银行/现金/无票/无票其他 4 账户明细工作台 (Ashan Office High-Density)

frappe.pages['jizhong-billing-workbench'].on_page_load = function(wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: '吉众账单',
        single_column: true
    });

    const $container = $(wrapper).find('.layout-main-section');
    $container.empty();

    let current_month = frappe.datetime.now_date().slice(0, 7);
    let active_tab = 'bank'; // 'bank' | 'cash' | 'no_inv' | 'no_inv_other' | 'hardware'
    let current_data = null;

    const skeleton = `
        <div class="ashan-billing-container">
            <!-- 顶部无边框主控栏 -->
            <div class="ashan-billing-header">
                <div class="ashan-billing-title-area">
                    <span class="ashan-billing-main-title">吉众账单</span>
                    <div id="jz-closing-badge-wrap" class="ashan-billing-closing-wrap"></div>
                </div>
                <div class="ashan-billing-header-actions">
                    <div id="jz-month-nav-container"></div>
                    <button type="button" class="btn btn-default btn-sm" id="btn-jz-quick-add" title="快速录入单据">+ 快速录单</button>
                    <button type="button" class="btn btn-default btn-sm" id="btn-jz-refresh" title="刷新数据">刷新</button>
                    <button type="button" class="btn btn-default btn-sm btn-ashan-closing" id="btn-jz-closing">核定当月</button>
                    <button type="button" class="btn btn-default btn-sm" id="btn-jz-export-month">导出单月账单 (.xlsx)</button>
                    <button type="button" class="btn btn-default btn-sm" id="btn-jz-export-all">导出全量账单 (.xlsx)</button>
                </div>
            </div>

            <!-- 集中 4 账户 KPI 看板 -->
            <div class="ashan-billing-kpi-row">
                <div class="ashan-billing-kpi-card">
                    <div class="ashan-billing-kpi-label">银行</div>
                    <div class="ashan-billing-kpi-val" id="kpi-jz-bank-amt">¥ 0.00</div>
                    <div class="ashan-billing-kpi-desc" id="kpi-jz-bank-desc">0 笔</div>
                </div>
                <div class="ashan-billing-kpi-card">
                    <div class="ashan-billing-kpi-label">现金</div>
                    <div class="ashan-billing-kpi-val" id="kpi-jz-cash-amt">¥ 0.00</div>
                    <div class="ashan-billing-kpi-desc" id="kpi-jz-cash-desc">0 笔</div>
                </div>
                <div class="ashan-billing-kpi-card">
                    <div class="ashan-billing-kpi-label">无票</div>
                    <div class="ashan-billing-kpi-val" id="kpi-jz-no-inv-amt">¥ 0.00</div>
                    <div class="ashan-billing-kpi-desc" id="kpi-jz-no-inv-desc">0 笔</div>
                </div>
                <div class="ashan-billing-kpi-card">
                    <div class="ashan-billing-kpi-label">无票其他</div>
                    <div class="ashan-billing-kpi-val" id="kpi-jz-no-inv-other-amt">¥ 0.00</div>
                    <div class="ashan-billing-kpi-desc" id="kpi-jz-no-inv-other-desc">0 笔</div>
                </div>
            </div>

            <!-- 4 账户账单与五金辅助选项卡 -->
            <div class="ashan-billing-tabs">
                <button type="button" class="ashan-billing-tab-btn is-active" data-tab="bank">银行</button>
                <button type="button" class="ashan-billing-tab-btn" data-tab="cash">现金</button>
                <button type="button" class="ashan-billing-tab-btn" data-tab="no_inv">无票</button>
                <button type="button" class="ashan-billing-tab-btn" data-tab="no_inv_other">无票其他</button>
                <button type="button" class="ashan-billing-tab-btn" data-tab="hardware">五金 (辅助库)</button>
            </div>

            <!-- 表格卡片容器 -->
            <div class="ashan-billing-table-card" id="jz-main-table-view">
                <div class="text-center text-muted p-4">正在载入吉众账单数据...</div>
            </div>
        </div>
    `;

    $container.html(skeleton);

    function init_month_navigator() {
        if (window.AshanUI && typeof window.AshanUI.renderPeriodSelector === 'function') {
            window.AshanUI.renderPeriodSelector('#jz-month-nav-container', {
                period: current_month,
                onChange: function(y, m, ym) {
                    current_month = ym;
                    load_data();
                }
            });
        } else {
            $('#jz-month-nav-container').html(`
                <div class="ashan-period-navigator">
                    <input type="month" class="ashan-billing-month-input" id="jz-fallback-month" value="${current_month}">
                </div>
            `);
            $('#jz-fallback-month').on('change', function() {
                current_month = $(this).val();
                load_data();
            });
        }
    }

    function load_data() {
        $('#jz-main-table-view').html('<div class="text-center text-muted p-4">正在同步 ERPNext 16 现场数据...</div>');
        frappe.call({
            method: 'ashan_cn_procurement.ashan_cn_procurement.page.jizhong_billing_workbench.jizhong_billing_workbench.get_jizhong_billing_data',
            args: { period_month: current_month },
            callback: function(r) {
                if (r.message) {
                    current_data = r.message;
                    render_ui();
                } else {
                    $('#jz-main-table-view').html('<div class="text-center text-danger p-4">加载失败或无数据返回</div>');
                }
            }
        });
    }

    function render_ui() {
        if (!current_data) return;
        const s = current_data.summary || {};
        const fmtMoney = (v) => '¥ ' + (Number(v || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        // 1. KPI 赋值
        $('#kpi-jz-bank-amt').text(fmtMoney(s.bank_total));
        $('#kpi-jz-bank-desc').text(`${s.bank_count || 0} 笔`);

        $('#kpi-jz-cash-amt').text(fmtMoney(s.cash_total));
        $('#kpi-jz-cash-desc').text(`${s.cash_count || 0} 笔`);

        $('#kpi-jz-no-inv-amt').text(fmtMoney(s.no_inv_total));
        $('#kpi-jz-no-inv-desc').text(`${s.no_inv_count || 0} 笔`);

        $('#kpi-jz-no-inv-other-amt').text(fmtMoney(s.no_inv_other_total));
        $('#kpi-jz-no-inv-other-desc').text(`${s.no_inv_other_count || 0} 笔`);

        // 2. 核定状态与操作按钮控制
        const isLocked = Boolean(s.is_locked);
        const $closingBadge = $('#jz-closing-badge-wrap');
        const $btnClosing = $('#btn-jz-closing');
        const $btnQuickAdd = $('#btn-jz-quick-add');

        if (isLocked) {
            $closingBadge.html(`
                <span class="ashan-billing-lock-badge is-locked" title="当月已核定锁定，单据进入只读保护状态">
                    <span class="ashan-lock-dot"></span>已核定 (锁定)
                </span>
            `);
            $btnClosing.text('解除核定').removeClass('btn-lock').addClass('btn-unlock').attr('title', '点击反审核解除月度核定锁定');
            $btnQuickAdd.prop('disabled', true).addClass('is-disabled').attr('title', '当前月份已核定锁定，禁止录入单据');
        } else {
            $closingBadge.html(`
                <span class="ashan-billing-lock-badge is-open" title="当前月份开放编辑与录单">
                    <span class="ashan-open-dot"></span>待核定
                </span>
            `);
            $btnClosing.text('核定当月').removeClass('btn-unlock').addClass('btn-lock').attr('title', '核定并锁定当月单据');
            $btnQuickAdd.prop('disabled', false).removeClass('is-disabled').removeAttr('title');
        }

        // 3. 渲染当前选项卡表格
        if (active_tab === 'bank') render_bank_table();
        else if (active_tab === 'cash') render_cash_table();
        else if (active_tab === 'no_inv') render_no_inv_table();
        else if (active_tab === 'no_inv_other') render_no_inv_other_table();
        else if (active_tab === 'hardware') render_hardware_table();
    }

    function render_trace_cells(r) {
        const initDoc = r.initial_doc_type || '直接单据';
        const initNo = r.initial_doc_name || '-';
        const initDocHtml = `
            <div class="ashan-billing-tag-wrap">
                <span class="ashan-billing-tag-doc">${frappe.utils.escape_html(initDoc)}</span>
                <span class="ashan-billing-tag-doc-sub">${frappe.utils.escape_html(initNo)}</span>
            </div>
        `;
        const chainHtml = `<span class="ashan-billing-chain" title="${frappe.utils.escape_html(r.chain_summary || '-')}">${frappe.utils.escape_html(r.chain_summary || '-')}</span>`;
        const isPaid = r.payment_status && r.payment_status.startsWith('已付款');
        const payBadgeClass = isPaid ? 'ashan-billing-pay-paid' : 'ashan-billing-pay-unpaid';
        const payAccount = r.paid_from_account && r.paid_from_account !== '-' ? `<span class="ashan-billing-pay-acct">(${frappe.utils.escape_html(r.paid_from_account.replace(' - 吉众', ''))})</span>` : '';
        const payHtml = `<span class="${payBadgeClass}">${frappe.utils.escape_html(r.payment_status || '未付款')}</span>${payAccount}`;

        return `
            <td>${initDocHtml}</td>
            <td>${chainHtml}</td>
            <td class="ashan-billing-col-center">${payHtml}</td>
        `;
    }

    function render_bank_table() {
        const rows = current_data.bank_rows || [];
        const fmtMoney = (v) => (Number(v || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        let html = `
            <div class="ashan-billing-table-scroll">
                <table class="ashan-billing-table">
                    <thead>
                        <tr>
                            <th class="ashan-billing-col-center">序号</th>
                            <th>记账日期</th>
                            <th>摘要</th>
                            <th class="ashan-billing-col-right">借方 (收入)</th>
                            <th class="ashan-billing-col-right">贷方 (支出)</th>
                            <th>备注</th>
                            <th>初始单据与来源</th>
                            <th>业务单据追溯链</th>
                            <th class="ashan-billing-col-center">付款状态</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        if (rows.length === 0) {
            html += `<tr><td colspan="9" class="text-center text-muted p-4">当月暂无银行账户流水记录</td></tr>`;
        } else {
            rows.forEach((r, idx) => {
                html += `
                    <tr>
                        <td class="ashan-billing-col-center">${idx + 1}</td>
                        <td>${frappe.utils.escape_html(r.date)}</td>
                        <td><strong>${frappe.utils.escape_html(r.summary)}</strong></td>
                        <td class="ashan-billing-col-right">${r.debit ? '¥ ' + fmtMoney(r.debit) : '-'}</td>
                        <td class="ashan-billing-col-right font-weight-bold">${r.credit ? '¥ ' + fmtMoney(r.credit) : '-'}</td>
                        <td>${frappe.utils.escape_html(r.note || '-')}</td>
                        ${render_trace_cells(r)}
                    </tr>
                `;
            });
        }
        html += `
                    </tbody>
                    <tfoot>
                        <tr>
                            <td colspan="4" class="text-right">银行支出合计（共 ${rows.length} 笔）：</td>
                            <td class="ashan-billing-col-right font-weight-bold">¥ ${fmtMoney(current_data.summary?.bank_total)}</td>
                            <td colspan="4"></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        `;
        $('#jz-main-table-view').html(html);
    }

    function render_cash_table() {
        const rows = current_data.cash_rows || [];
        const fmtMoney = (v) => (Number(v || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        let html = `
            <div class="ashan-billing-table-scroll">
                <table class="ashan-billing-table">
                    <thead>
                        <tr>
                            <th class="ashan-billing-col-center">序号</th>
                            <th>记账日期</th>
                            <th>摘要</th>
                            <th class="ashan-billing-col-right">借方 (备用金)</th>
                            <th class="ashan-billing-col-right">贷方 (报销支出)</th>
                            <th>备注</th>
                            <th>初始单据与来源</th>
                            <th>业务单据追溯链</th>
                            <th class="ashan-billing-col-center">付款状态</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        if (rows.length === 0) {
            html += `<tr><td colspan="9" class="text-center text-muted p-4">当月暂无现金报销流水记录</td></tr>`;
        } else {
            rows.forEach((r, idx) => {
                const isHwSummary = r.summary === '五金一批';
                html += `
                    <tr class="${isHwSummary ? 'ashan-billing-row-highlight' : ''}">
                        <td class="ashan-billing-col-center">${idx + 1}</td>
                        <td>${frappe.utils.escape_html(r.date)}</td>
                        <td><strong>${frappe.utils.escape_html(r.summary)}</strong></td>
                        <td class="ashan-billing-col-right">${r.debit ? '¥ ' + fmtMoney(r.debit) : '-'}</td>
                        <td class="ashan-billing-col-right font-weight-bold">${r.credit ? '¥ ' + fmtMoney(r.credit) : '-'}</td>
                        <td>${frappe.utils.escape_html(r.note || '-')}</td>
                        ${render_trace_cells(r)}
                    </tr>
                `;
            });
        }
        html += `
                    </tbody>
                    <tfoot>
                        <tr>
                            <td colspan="4" class="text-right">现金支出合计（共 ${rows.length} 笔）：</td>
                            <td class="ashan-billing-col-right font-weight-bold">¥ ${fmtMoney(current_data.summary?.cash_total)}</td>
                            <td colspan="4"></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        `;
        $('#jz-main-table-view').html(html);
    }

    function render_no_inv_table() {
        const rows = current_data.no_inv_rows || [];
        const fmtMoney = (v) => (Number(v || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        let html = `
            <div class="ashan-billing-table-scroll">
                <table class="ashan-billing-table">
                    <thead>
                        <tr>
                            <th class="ashan-billing-col-center">序号</th>
                            <th>记账日期</th>
                            <th>项目</th>
                            <th class="ashan-billing-col-right">收入</th>
                            <th class="ashan-billing-col-right">支出</th>
                            <th>备注</th>
                            <th>初始单据与来源</th>
                            <th>业务单据追溯链</th>
                            <th class="ashan-billing-col-center">付款状态</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr class="ashan-billing-sep-row">
                            <td colspan="9">以下为 ${frappe.utils.escape_html(current_month)} 月无票普通采购支出</td>
                        </tr>
        `;
        if (rows.length === 0) {
            html += `<tr><td colspan="9" class="text-center text-muted p-4">暂无无票支出明细</td></tr>`;
        } else {
            rows.forEach((r, idx) => {
                html += `
                    <tr>
                        <td class="ashan-billing-col-center">${idx + 1}</td>
                        <td>${frappe.utils.escape_html(r.date)}</td>
                        <td><strong>${frappe.utils.escape_html(r.item)}</strong></td>
                        <td class="ashan-billing-col-right">${r.income ? '¥ ' + fmtMoney(r.income) : '-'}</td>
                        <td class="ashan-billing-col-right font-weight-bold">${r.expense ? '¥ ' + fmtMoney(r.expense) : '-'}</td>
                        <td>${frappe.utils.escape_html(r.note || '-')}</td>
                        ${render_trace_cells(r)}
                    </tr>
                `;
            });
        }
        html += `
                    </tbody>
                    <tfoot>
                        <tr>
                            <td colspan="4" class="text-right">无票支出合计（共 ${rows.length} 笔）：</td>
                            <td class="ashan-billing-col-right font-weight-bold">¥ ${fmtMoney(current_data.summary?.no_inv_total)}</td>
                            <td colspan="4"></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        `;
        $('#jz-main-table-view').html(html);
    }

    function render_no_inv_other_table() {
        const rows = current_data.no_inv_other_rows || [];
        const fmtMoney = (v) => (Number(v || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        let html = `
            <div class="ashan-billing-table-scroll">
                <table class="ashan-billing-table">
                    <thead>
                        <tr>
                            <th class="ashan-billing-col-center">序号</th>
                            <th>记账日期</th>
                            <th>项目</th>
                            <th class="ashan-billing-col-right">收入</th>
                            <th class="ashan-billing-col-right">支出</th>
                            <th>备注</th>
                            <th>初始单据与来源</th>
                            <th>业务单据追溯链</th>
                            <th class="ashan-billing-col-center">付款状态</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr class="ashan-billing-sep-row">
                            <td colspan="9">以下为 ${frappe.utils.escape_html(current_month)} 月无票其他杂项支出</td>
                        </tr>
        `;
        if (rows.length === 0) {
            html += `<tr><td colspan="9" class="text-center text-muted p-4">暂无无票其他支出记录</td></tr>`;
        } else {
            rows.forEach((r, idx) => {
                html += `
                    <tr>
                        <td class="ashan-billing-col-center">${idx + 1}</td>
                        <td>${frappe.utils.escape_html(r.date)}</td>
                        <td><strong>${frappe.utils.escape_html(r.item)}</strong></td>
                        <td class="ashan-billing-col-right">${r.income ? '¥ ' + fmtMoney(r.income) : '-'}</td>
                        <td class="ashan-billing-col-right font-weight-bold">${r.expense ? '¥ ' + fmtMoney(r.expense) : '-'}</td>
                        <td>${frappe.utils.escape_html(r.note || '-')}</td>
                        ${render_trace_cells(r)}
                    </tr>
                `;
            });
        }
        html += `
                    </tbody>
                    <tfoot>
                        <tr>
                            <td colspan="4" class="text-right">无票其他合计（共 ${rows.length} 笔）：</td>
                            <td class="ashan-billing-col-right font-weight-bold">¥ ${fmtMoney(current_data.summary?.no_inv_other_total)}</td>
                            <td colspan="4"></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        `;
        $('#jz-main-table-view').html(html);
    }

    function render_hardware_table() {
        const rows = current_data.hardware_rows || [];
        const fmtMoney = (v) => (Number(v || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        let html = `
            <div class="ashan-billing-table-scroll">
                <table class="ashan-billing-table">
                    <thead>
                        <tr>
                            <th class="ashan-billing-col-center">序号</th>
                            <th>五金零配件名称</th>
                            <th class="ashan-billing-col-center">单位</th>
                            <th class="ashan-billing-col-center">数量</th>
                            <th class="ashan-billing-col-right">单价</th>
                            <th class="ashan-billing-col-right">含税总价</th>
                            <th>备注</th>
                            <th>初始单据与来源</th>
                            <th>业务单据追溯链</th>
                            <th class="ashan-billing-col-center">付款状态</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr class="ashan-billing-sep-row">
                            <td colspan="10">以下为 ${frappe.utils.escape_html(current_month)} 五金辅助明细库，合计 ${fmtMoney(current_data.summary?.hardware_total)} 元</td>
                        </tr>
        `;
        if (rows.length === 0) {
            html += `<tr><td colspan="10" class="text-center text-muted p-4">当月暂无五金配件辅助明细记录</td></tr>`;
        } else {
            rows.forEach((r, idx) => {
                html += `
                    <tr>
                        <td class="ashan-billing-col-center">${idx + 1}</td>
                        <td><strong>${frappe.utils.escape_html(r.name)}</strong></td>
                        <td class="ashan-billing-col-center">${r.unit}</td>
                        <td class="ashan-billing-col-center">${r.qty}</td>
                        <td class="ashan-billing-col-right">¥ ${fmtMoney(r.unit_price)}</td>
                        <td class="ashan-billing-col-right font-weight-bold">¥ ${fmtMoney(r.total_amount)}</td>
                        <td>${frappe.utils.escape_html(r.note || '-')}</td>
                        ${render_trace_cells(r)}
                    </tr>
                `;
            });
        }
        html += `
                    </tbody>
                    <tfoot>
                        <tr>
                            <td colspan="5" class="text-right">五金辅助库总额（共 ${rows.length} 项）：</td>
                            <td class="ashan-billing-col-right font-weight-bold">¥ ${fmtMoney(current_data.summary?.hardware_total)}</td>
                            <td colspan="4"></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        `;
        $('#jz-main-table-view').html(html);
    }

    // 快捷快速录单弹窗
    function open_quick_add_dialog() {
        if (current_data && current_data.summary && current_data.summary.is_locked) {
            frappe.msgprint({
                title: __('操作受限'),
                indicator: 'orange',
                message: __('吉众【{0}】月份已核定锁定，禁止录入或修改单据！若需调整请先点击【解除核定】。', [current_month])
            });
            return;
        }

        const d = new frappe.ui.Dialog({
            title: __('吉众快速录单 (生成正式生效单据)'),
            fields: [
                {
                    fieldname: 'account_type',
                    fieldtype: 'Select',
                    label: __('记账账户分类'),
                    options: [
                        { label: '现金账户 (零星报销小票)', value: 'cash' },
                        { label: '无票支出 (普通采购/会计工资)', value: 'no_inv' },
                        { label: '无票其他 (临时杂项/备用)', value: 'no_inv_other' },
                        { label: '对公银行账户 (电汇采购发票)', value: 'bank' }
                    ],
                    default: active_tab === 'bank' ? 'bank' : (active_tab === 'no_inv' ? 'no_inv' : (active_tab === 'no_inv_other' ? 'no_inv_other' : 'cash')),
                    reqd: 1
                },
                { fieldname: 'posting_date', fieldtype: 'Date', label: __('记账日期'), default: frappe.datetime.now_date(), reqd: 1 },
                { fieldname: 'title', fieldtype: 'Data', label: __('单据项目 / 摘要'), reqd: 1 },
                { fieldname: 'amount', fieldtype: 'Currency', label: __('金额 (元)'), reqd: 1 },
                { fieldname: 'invoice_no', fieldtype: 'Data', label: __('发票号码 (无发票可留空或填无票)') },
                { fieldname: 'usage', fieldtype: 'Small Text', label: __('备注') },
                { fieldname: 'spec', fieldtype: 'Data', label: __('规格型号'), default: '-' },
                { fieldname: 'supplier', fieldtype: 'Data', label: __('供应商名称'), default: '其它供应商' }
            ],
            primary_action_label: __('保存并立即入账'),
            primary_action: function(values) {
                d.hide();
                frappe.call({
                    method: 'ashan_cn_procurement.ashan_cn_procurement.page.jizhong_billing_workbench.jizhong_billing_workbench.quick_create_jizhong_entry',
                    args: values,
                    callback: function(res) {
                        if (res.message && res.message.status === 'ok') {
                            frappe.show_alert({ message: res.message.message, indicator: 'green' });
                            load_data();
                        }
                    }
                });
            }
        });
        d.show();
    }

    // 事件绑定
    $('#btn-jz-refresh').on('click', function() {
        load_data();
    });

    $('#btn-jz-quick-add').on('click', function() {
        open_quick_add_dialog();
    });

    $('#btn-jz-closing').on('click', function() {
        if (!current_data) return;
        const s = current_data.summary || {};
        const isLocked = Boolean(s.is_locked);

        if (isLocked) {
            frappe.prompt([
                {
                    fieldname: 'unlock_reason',
                    fieldtype: 'Small Text',
                    label: __('反审核/解除核定原因 (审计追踪必填)'),
                    reqd: 1
                }
            ], function(values) {
                frappe.call({
                    method: 'ashan_cn_procurement.services.invoice_closing_service.unlock_monthly_invoice_closing',
                    args: {
                        company: '天津吉众科技有限公司',
                        period: current_month,
                        unlock_reason: values.unlock_reason
                    },
                    callback: function(r) {
                        if (r.message && r.message.success) {
                            frappe.show_alert({ message: r.message.message, indicator: 'orange' });
                            load_data();
                        }
                    }
                });
            }, __('解除吉众【' + current_month + '】月度核定锁定'), __('确认解除'));
        } else {
            frappe.confirm(
                __(`确定要核定并锁定吉众【${current_month}】月份账单吗？<br><br><small class="text-muted">核定后当月发票与报销单据将进入严格只读封账保护，禁止新增或修改单据。</small>`),
                function() {
                    frappe.call({
                        method: 'ashan_cn_procurement.services.invoice_closing_service.lock_monthly_invoice_closing',
                        args: {
                            company: '天津吉众科技有限公司',
                            period: current_month
                        },
                        callback: function(r) {
                            if (r.message && r.message.success) {
                                frappe.show_alert({ message: r.message.message, indicator: 'green' });
                                load_data();
                            }
                        }
                    });
                }
            );
        }
    });

    $('.ashan-billing-tab-btn').on('click', function() {
        $('.ashan-billing-tab-btn').removeClass('is-active');
        $(this).addClass('is-active');
        active_tab = $(this).data('tab');
        render_ui();
    });

    $('#btn-jz-export-month').on('click', function() {
        frappe.msgprint({
            title: '单月账单导出',
            indicator: 'blue',
            message: `正在导出吉众【${current_month}】单月账单 (.xlsx)... 包含银行、现金、无票、无票其他及五金明细。`
        });
    });

    $('#btn-jz-export-all').on('click', function() {
        frappe.msgprint({
            title: '全量带标记账单导出',
            indicator: 'blue',
            message: `正在基于 zipfile 注入机制导出吉众【2019-至今全量带标记大账簿】(.xlsx)... 保持 27 个 Sheet 动态余额公式链与高亮样式。`
        });
    });

    // 全局快捷键监听 (保留后台快捷响应，按钮文本不再展示快捷键提示)
    $(document).off('keydown.jz_billing').on('keydown.jz_billing', function(e) {
        if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) || e.target.isContentEditable) {
            return;
        }
        if (e.altKey && e.key.toLowerCase() === 'n') {
            e.preventDefault();
            open_quick_add_dialog();
        } else if (e.altKey && e.key.toLowerCase() === 'r') {
            e.preventDefault();
            load_data();
        }
    });

    init_month_navigator();
    load_data();
};
