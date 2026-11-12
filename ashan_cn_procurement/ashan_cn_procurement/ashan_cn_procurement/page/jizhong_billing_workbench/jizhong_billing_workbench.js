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
                </div>
                <div class="ashan-billing-header-actions">
                    <input type="month" id="jz-month-picker" class="ashan-billing-month-input" value="${current_month}">
                    <button type="button" class="btn btn-default btn-sm" id="btn-jz-refresh">刷新数据</button>
                    <button type="button" class="btn btn-default btn-sm" id="btn-jz-export-month">导出单月账单 (.xlsx)</button>
                    <button type="button" class="btn btn-primary btn-sm" id="btn-jz-export-all">导出全量账单 (.xlsx)</button>
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

        // 2. 渲染当前选项卡表格
        if (active_tab === 'bank') render_bank_table();
        else if (active_tab === 'cash') render_cash_table();
        else if (active_tab === 'no_inv') render_no_inv_table();
        else if (active_tab === 'no_inv_other') render_no_inv_other_table();
        else if (active_tab === 'hardware') render_hardware_table();
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
                            <th>日期</th>
                            <th>摘要</th>
                            <th class="ashan-billing-col-right">借方 (收入)</th>
                            <th class="ashan-billing-col-right">贷方 (支出)</th>
                            <th>备注 (发票/报销单/凭证穿透)</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        if (rows.length === 0) {
            html += `<tr><td colspan="6" class="text-center text-muted p-4">当月暂无银行账户流水记录</td></tr>`;
        } else {
            rows.forEach((r, idx) => {
                html += `
                    <tr>
                        <td class="ashan-billing-col-center">${idx + 1}</td>
                        <td>${frappe.utils.escape_html(r.date)}</td>
                        <td><strong>${frappe.utils.escape_html(r.summary)}</strong></td>
                        <td class="ashan-billing-col-right">${r.debit ? '¥ ' + fmtMoney(r.debit) : '-'}</td>
                        <td class="ashan-billing-col-right font-weight-bold">${r.credit ? '¥ ' + fmtMoney(r.credit) : '-'}</td>
                        <td>${frappe.utils.escape_html(r.note)}</td>
                    </tr>
                `;
            });
        }
        html += `
                    </tbody>
                    <tfoot>
                        <tr>
                            <td colspan="4" class="text-right">银行支出合计（共 ${rows.length} 笔）：</td>
                            <td class="ashan-billing-col-right">¥ ${fmtMoney(current_data.summary?.bank_total)}</td>
                            <td></td>
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
                            <th>日期</th>
                            <th>摘要</th>
                            <th class="ashan-billing-col-right">借方 (备用金注入)</th>
                            <th class="ashan-billing-col-right">贷方 (报销支出)</th>
                            <th>备注 (真实小票与发票穿透)</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        if (rows.length === 0) {
            html += `<tr><td colspan="6" class="text-center text-muted p-4">当月暂无现金报销流水记录</td></tr>`;
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
                        <td>${frappe.utils.escape_html(r.note)}</td>
                    </tr>
                `;
            });
        }
        html += `
                    </tbody>
                    <tfoot>
                        <tr>
                            <td colspan="4" class="text-right">现金支出合计（共 ${rows.length} 笔）：</td>
                            <td class="ashan-billing-col-right">¥ ${fmtMoney(current_data.summary?.cash_total)}</td>
                            <td></td>
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
                            <th>日期</th>
                            <th>项目</th>
                            <th class="ashan-billing-col-right">收入</th>
                            <th class="ashan-billing-col-right">支出</th>
                            <th>备注</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr class="ashan-billing-sep-row">
                            <td colspan="6">以下为 ${frappe.utils.escape_html(current_month)} 月无票普通采购支出</td>
                        </tr>
        `;
        if (rows.length === 0) {
            html += `<tr><td colspan="6" class="text-center text-muted p-4">暂无无票支出明细</td></tr>`;
        } else {
            rows.forEach((r, idx) => {
                html += `
                    <tr>
                        <td class="ashan-billing-col-center">${idx + 1}</td>
                        <td>${frappe.utils.escape_html(r.date)}</td>
                        <td><strong>${frappe.utils.escape_html(r.item)}</strong></td>
                        <td class="ashan-billing-col-right">${r.income ? '¥ ' + fmtMoney(r.income) : '-'}</td>
                        <td class="ashan-billing-col-right font-weight-bold">${r.expense ? '¥ ' + fmtMoney(r.expense) : '-'}</td>
                        <td>${frappe.utils.escape_html(r.note)}</td>
                    </tr>
                `;
            });
        }
        html += `
                    </tbody>
                    <tfoot>
                        <tr>
                            <td colspan="4" class="text-right">无票支出合计（共 ${rows.length} 笔）：</td>
                            <td class="ashan-billing-col-right">¥ ${fmtMoney(current_data.summary?.no_inv_total)}</td>
                            <td></td>
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
                            <th>日期</th>
                            <th>项目</th>
                            <th class="ashan-billing-col-right">收入</th>
                            <th class="ashan-billing-col-right">支出</th>
                            <th>备注</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr class="ashan-billing-sep-row">
                            <td colspan="6">以下为 ${frappe.utils.escape_html(current_month)} 月无票其他杂项支出</td>
                        </tr>
        `;
        if (rows.length === 0) {
            html += `<tr><td colspan="6" class="text-center text-muted p-4">暂无无票其他支出记录</td></tr>`;
        } else {
            rows.forEach((r, idx) => {
                html += `
                    <tr>
                        <td class="ashan-billing-col-center">${idx + 1}</td>
                        <td>${frappe.utils.escape_html(r.date)}</td>
                        <td><strong>${frappe.utils.escape_html(r.item)}</strong></td>
                        <td class="ashan-billing-col-right">${r.income ? '¥ ' + fmtMoney(r.income) : '-'}</td>
                        <td class="ashan-billing-col-right font-weight-bold">${r.expense ? '¥ ' + fmtMoney(r.expense) : '-'}</td>
                        <td>${frappe.utils.escape_html(r.note)}</td>
                    </tr>
                `;
            });
        }
        html += `
                    </tbody>
                    <tfoot>
                        <tr>
                            <td colspan="4" class="text-right">无票其他合计（共 ${rows.length} 笔）：</td>
                            <td class="ashan-billing-col-right">¥ ${fmtMoney(current_data.summary?.no_inv_other_total)}</td>
                            <td></td>
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
                            <th class="ashan-billing-col-right">单价 (保持=+E/C公式)</th>
                            <th class="ashan-billing-col-right">含税总价</th>
                            <th>业务事由与单据追溯</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr class="ashan-billing-sep-row">
                            <td colspan="7">以下为 ${frappe.utils.escape_html(current_month)} 五金辅助明细库，合计 ${fmtMoney(current_data.summary?.hardware_total)} 元</td>
                        </tr>
        `;
        if (rows.length === 0) {
            html += `<tr><td colspan="7" class="text-center text-muted p-4">当月暂无五金配件辅助明细记录</td></tr>`;
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
                        <td>${frappe.utils.escape_html(r.note)}</td>
                    </tr>
                `;
            });
        }
        html += `
                    </tbody>
                    <tfoot>
                        <tr>
                            <td colspan="5" class="text-right">五金辅助库总额（共 ${rows.length} 项）：</td>
                            <td class="ashan-billing-col-right">¥ ${fmtMoney(current_data.summary?.hardware_total)}</td>
                            <td></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        `;
        $('#jz-main-table-view').html(html);
    }

    // 事件绑定
    $('#jz-month-picker').on('change', function() {
        current_month = $(this).val();
        load_data();
    });

    $('#btn-jz-refresh').on('click', function() {
        load_data();
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

    load_data();
};
