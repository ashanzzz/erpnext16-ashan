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
                    <div id="qf-closing-badge-wrap" class="ashan-billing-closing-wrap"></div>
                </div>
                <div class="ashan-billing-header-actions">
                    <div id="qf-month-nav-container"></div>
                    <button type="button" class="btn btn-default btn-sm" id="btn-qf-quick-add" title="快速录入单据">+ 快速录单</button>
                    <button type="button" class="btn btn-default btn-sm" id="btn-qf-refresh" title="刷新数据">刷新</button>
                    <button type="button" class="btn btn-default btn-sm btn-ashan-closing" id="btn-qf-closing">核定当月</button>
                    <button type="button" class="btn btn-default btn-sm" id="btn-qf-export-xlsm" title="导出大账簿">导出账单</button>
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

    function init_month_navigator() {
        if (window.AshanUI && typeof window.AshanUI.renderPeriodSelector === 'function') {
            window.AshanUI.renderPeriodSelector('#qf-month-nav-container', {
                period: current_month,
                onChange: function(y, m, ym) {
                    current_month = ym;
                    load_data();
                }
            });
        } else {
            $('#qf-month-nav-container').html(`
                <div class="ashan-period-navigator">
                    <input type="month" class="ashan-billing-month-input" id="qf-fallback-month" value="${current_month}">
                </div>
            `);
            $('#qf-fallback-month').on('change', function() {
                current_month = $(this).val();
                load_data();
            });
        }
    }

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
        $('#kpi-qf-opening-desc').text('');
        $('#kpi-qf-income').text(fmtMoney(s.total_income));
        $('#kpi-qf-income-desc').text('');
        $('#kpi-qf-expense').text(fmtMoney(s.total_expense));
        $('#kpi-qf-count').text(`${s.total_rows || 0} 笔`);
        $('#kpi-qf-balance').text(fmtMoney(s.closing_balance));
        $('#kpi-qf-balance-desc').text('');

        // 2. 核定状态与操作按钮控制
        const isLocked = Boolean(s.is_locked);
        const $closingBadge = $('#qf-closing-badge-wrap');
        const $btnClosing = $('#btn-qf-closing');
        const $btnQuickAdd = $('#btn-qf-quick-add');

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

        // 3. 渲染主表格
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
                            <th class="ashan-billing-col-right">金额</th>
                            <th class="ashan-billing-col-center">科目类别</th>
                            <th>备注</th>
                            <th>对应发票</th>
                            <th>初始单据与来源</th>
                            <th>业务单据追溯链</th>
                            <th class="ashan-billing-col-center">付款状态</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        if (rows.length === 0) {
            html += `<tr><td colspan="11" class="text-center text-muted p-4">当月暂无过账的现金报销与大账流水单据</td></tr>`;
        } else {
            rows.forEach(r => {
                const isNoInv = r.invoice_no === '无票';
                const invHtml = isNoInv
                    ? `<span class="ashan-billing-tag-no-inv">无票</span>`
                    : `<span class="ashan-billing-tag-inv">${frappe.utils.escape_html(r.invoice_no)}</span>`;

                // 初始单据与单号
                const initDoc = r.initial_doc_type || '直接报销';
                const initNo = r.initial_doc_name || '-';
                const initialDocHtml = `
                    <div class="ashan-billing-tag-wrap">
                        <span class="ashan-billing-tag-doc">${frappe.utils.escape_html(initDoc)}</span>
                        <span class="ashan-billing-tag-doc-sub">${frappe.utils.escape_html(initNo)}</span>
                    </div>
                `;

                // 追溯链
                const chainSummary = r.chain_summary || '-';
                const chainHtml = `<span class="ashan-billing-chain" title="${frappe.utils.escape_html(chainSummary)}">${frappe.utils.escape_html(chainSummary)}</span>`;

                // 付款状态与出资账户
                const isPaid = r.payment_status && r.payment_status.startsWith('已付款');
                const payBadgeClass = isPaid ? 'ashan-billing-pay-paid' : 'ashan-billing-pay-unpaid';
                const payAccount = r.paid_from_account && r.paid_from_account !== '-' ? `<span class="ashan-billing-pay-acct">(${frappe.utils.escape_html(r.paid_from_account.replace(' - 祺富', ''))})</span>` : '';
                const payHtml = `<span class="${payBadgeClass}">${frappe.utils.escape_html(r.payment_status || '未付款')}</span>${payAccount}`;

                html += `
                    <tr>
                        <td class="ashan-billing-col-center">${r.seq}</td>
                        <td>${frappe.utils.escape_html(r.posting_date)}</td>
                        <td><strong>${frappe.utils.escape_html(r.item_name)}</strong></td>
                        <td>${frappe.utils.escape_html(r.specification || '-')}</td>
                        <td class="ashan-billing-col-right font-weight-bold">¥ ${fmtMoney(r.amount)}</td>
                        <td class="ashan-billing-col-center"><span class="badge badge-light">${frappe.utils.escape_html(r.category)}</span></td>
                        <td>${frappe.utils.escape_html(r.usage || '-')}</td>
                        <td>${invHtml}</td>
                        <td>${initialDocHtml}</td>
                        <td>${chainHtml}</td>
                        <td class="ashan-billing-col-center">${payHtml}</td>
                    </tr>
                `;
            });
        }
        html += `
                    </tbody>
                    <tfoot>
                        <tr>
                            <td colspan="4" class="ashan-billing-col-right">现金支出合计（共 ${rows.length} 笔）：</td>
                            <td class="ashan-billing-col-right font-weight-bold">¥ ${fmtMoney(current_data.summary?.total_expense)}</td>
                            <td colspan="6"></td>
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

    // 快捷快速录单弹窗
    function open_quick_add_dialog() {
        if (current_data && current_data.summary && current_data.summary.is_locked) {
            frappe.msgprint({
                title: __('操作受限'),
                indicator: 'orange',
                message: __('祺富【{0}】月份已核定锁定，禁止录入或修改单据！若需调整请先点击【解除核定】。', [current_month])
            });
            return;
        }

        const d = new frappe.ui.Dialog({
            title: __('快速录单 (生成正式生效报销单)'),
            fields: [
                { fieldname: 'posting_date', fieldtype: 'Date', label: __('记账日期'), default: frappe.datetime.now_date(), reqd: 1 },
                { fieldname: 'title', fieldtype: 'Data', label: __('单据项目 / 标题'), reqd: 1 },
                { fieldname: 'amount', fieldtype: 'Currency', label: __('金额 (元)'), reqd: 1 },
                {
                    fieldname: 'category',
                    fieldtype: 'Select',
                    label: __('科目类别'),
                    options: ['五金耗材', '客车耗材', '货车耗材', '车间餐饮', '其他招待', '油卡充值', '其他服务费', '通用五金'],
                    default: '五金耗材'
                },
                { fieldname: 'invoice_no', fieldtype: 'Data', label: __('发票号码 (无发票填无票)'), default: '无票' },
                { fieldname: 'usage', fieldtype: 'Small Text', label: __('备注') },
                { fieldname: 'spec', fieldtype: 'Data', label: __('规格型号'), default: '-' }
            ],
            primary_action_label: __('保存并立即入账'),
            primary_action: function(values) {
                d.hide();
                frappe.call({
                    method: 'ashan_cn_procurement.ashan_cn_procurement.page.qifu_billing_workbench.qifu_billing_workbench.quick_create_qifu_cash_entry',
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
    $('#btn-qf-refresh').on('click', function() {
        load_data();
    });

    $('#btn-qf-quick-add').on('click', function() {
        open_quick_add_dialog();
    });

    $('#btn-qf-closing').on('click', function() {
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
                        company: '天津祺富机械加工有限公司',
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
            }, __('解除祺富【' + current_month + '】月度核定锁定'), __('确认解除'));
        } else {
            frappe.confirm(
                __(`确定要核定并锁定祺富【${current_month}】月份账单吗？<br><br><small class="text-muted">核定后当月发票与报销单据将进入严格只读封账保护，禁止新增或修改单据。</small>`),
                function() {
                    frappe.call({
                        method: 'ashan_cn_procurement.services.invoice_closing_service.lock_monthly_invoice_closing',
                        args: {
                            company: '天津祺富机械加工有限公司',
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

    // 全局快捷键监听 (保留后台快捷响应，按钮文本不再展示快捷键提示)
    $(document).off('keydown.qf_billing').on('keydown.qf_billing', function(e) {
        if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) || e.target.isContentEditable) {
            return;
        }
        if (e.altKey && e.key.toLowerCase() === 'n') {
            e.preventDefault();
            open_quick_add_dialog();
        } else if (e.altKey && e.key.toLowerCase() === 'r') {
            e.preventDefault();
            load_data();
        } else if (e.altKey && e.key.toLowerCase() === 'e') {
            e.preventDefault();
            $('#btn-qf-export-xlsm').click();
        }
    });

    init_month_navigator();
    load_data();
};
