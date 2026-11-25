// Copyright (c) 2026, Ashan CN Procurement and contributors
// 吉众账单 · 银行/现金/无票/无票其他 4 账户明细工作台 (Ashan Office High-Density & Four-Pillar Conservation)

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
    const company = "天津吉众科技有限公司";

    const skeleton = `
        <div class="ashan-billing-container">
            <!-- 顶部主控栏 -->
            <div class="ashan-billing-header">
                <div class="ashan-billing-title-area">
                    <span class="ashan-billing-main-title">吉众账单</span>
                    <span id="jz-lock-status-pill" class="ashan-billing-status-pill">🟡 待对账</span>
                </div>
                <div class="ashan-billing-header-actions">
                    <div id="jz-period-selector-mount" class="ashan-period-mount"></div>
                    <input type="hidden" id="jz-month-picker" value="${current_month}">
                    <button type="button" class="btn btn-default btn-sm" id="btn-jz-refresh">刷新数据</button>
                    <button type="button" class="btn btn-default btn-sm" id="btn-jz-quick-add">+ 记一笔支出</button>
                    <button type="button" class="btn btn-default btn-sm" id="btn-jz-recurring">常态固定支出配置</button>
                    <button type="button" class="btn btn-default btn-sm" id="btn-jz-hw-suppliers">五金归集公司设置</button>
                    <button type="button" class="btn btn-default btn-sm" id="btn-jz-toggle-lock">核定封账 🔒</button>
                    <button type="button" class="btn btn-default btn-sm" id="btn-jz-export-month">导出单月账单 (.xlsx)</button>
                    <button type="button" class="btn btn-default btn-sm" id="btn-jz-export-all">导出全量账单 (.xlsx)</button>
                </div>
            </div>

            <!-- 4 账户资金台账 KPI 看板 -->
            <div class="ashan-billing-kpi-row">
                <div class="ashan-billing-kpi-card">
                    <div class="ashan-billing-kpi-label" id="lbl-jz-card-bank">银行-农行</div>
                    <div class="ashan-billing-kpi-val" id="kpi-jz-bank-amt">¥ 0.00</div>
                    <div class="ashan-billing-kpi-desc" id="kpi-jz-bank-desc">支出 0 笔 | 期末结余 ¥ 0.00</div>
                </div>
                <div class="ashan-billing-kpi-card">
                    <div class="ashan-billing-kpi-label" id="lbl-jz-card-cash">现金-孟祥山</div>
                    <div class="ashan-billing-kpi-val" id="kpi-jz-cash-amt">¥ 0.00</div>
                    <div class="ashan-billing-kpi-desc" id="kpi-jz-cash-desc">支出 0 笔 | 期末结余 ¥ 0.00</div>
                </div>
                <div class="ashan-billing-kpi-card">
                    <div class="ashan-billing-kpi-label" id="lbl-jz-card-no-inv">现金-无票</div>
                    <div class="ashan-billing-kpi-val" id="kpi-jz-no-inv-amt">¥ 0.00</div>
                    <div class="ashan-billing-kpi-desc" id="kpi-jz-no-inv-desc">支出 0 笔 | 期末结余 ¥ 0.00</div>
                </div>
                <div class="ashan-billing-kpi-card">
                    <div class="ashan-billing-kpi-label" id="lbl-jz-card-no-inv-other">现金-其他</div>
                    <div class="ashan-billing-kpi-val" id="kpi-jz-no-inv-other-amt">¥ 0.00</div>
                    <div class="ashan-billing-kpi-desc" id="kpi-jz-no-inv-other-desc">支出 0 笔 | 期末结余 ¥ 0.00</div>
                </div>
            </div>

            <!-- 4 账户账单与五金辅助选项卡 -->
            <div class="ashan-billing-tabs">
                <button type="button" class="ashan-billing-tab-btn is-active" data-tab="bank" id="tab-jz-bank">银行-农行</button>
                <button type="button" class="ashan-billing-tab-btn" data-tab="cash" id="tab-jz-cash">现金-孟祥山</button>
                <button type="button" class="ashan-billing-tab-btn" data-tab="no_inv" id="tab-jz-no-inv">现金-无票</button>
                <button type="button" class="ashan-billing-tab-btn" data-tab="no_inv_other" id="tab-jz-no-inv-other">现金-其他</button>
                <button type="button" class="ashan-billing-tab-btn" data-tab="hardware">五金辅助核算库</button>
            </div>

            <!-- 表格卡片容器 -->
            <div class="ashan-billing-table-card" id="jz-main-table-view">
                <div class="text-center text-muted p-4">正在载入吉众账单数据...</div>
            </div>
        </div>
    `;

    $container.html(skeleton);

    let jz_period_selector = null;
    function setup_jz_period_selector() {
        if (!window.AshanUI || typeof window.AshanUI.renderPeriodSelector !== "function") return;
        const $mount = $('#jz-period-selector-mount');
        if (!$mount.length) return;
        jz_period_selector = window.AshanUI.renderPeriodSelector($mount, {
            period: current_month,
            align: 'right',
            onChange: function(y, m, periodStr) {
                current_month = periodStr;
                $('#jz-month-picker').val(current_month);
                load_data();
            }
        });
    }
    setup_jz_period_selector();

    function load_data() {
        $('#jz-main-table-view').html('<div class="text-center text-muted p-4">正在穿透 ERPNext GL Entry 汇算吉众现场数据...</div>');
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

        // 1. 锁状态指示
        const isLocked = !!current_data.is_locked;
        if (isLocked) {
            $('#jz-lock-status-pill').removeClass('is-pending').addClass('is-locked').text('🔒 已核定封账');
            $('#btn-jz-toggle-lock').text('反审核解锁 🟡');
            $('#btn-jz-quick-add').prop('disabled', true);
        } else {
            $('#jz-lock-status-pill').removeClass('is-locked').addClass('is-pending').text('🟡 待对账');
            $('#btn-jz-toggle-lock').text('核定封账 🔒');
            $('#btn-jz-quick-add').prop('disabled', false);
        }

        // 2. 动态对齐真实科目名称与 KPI 赋值
        const acc = current_data.account_names || {};
        if (acc.bank) {
            $('#lbl-jz-card-bank').text(acc.bank);
            $('#tab-jz-bank').text(acc.bank);
        }
        if (acc.cash) {
            $('#lbl-jz-card-cash').text(acc.cash);
            $('#tab-jz-cash').text(acc.cash);
        }
        if (acc.no_inv) {
            $('#lbl-jz-card-no-inv').text(acc.no_inv);
            $('#tab-jz-no-inv').text(acc.no_inv);
        }
        if (acc.no_inv_other) {
            $('#lbl-jz-card-no-inv-other').text(acc.no_inv_other);
            $('#tab-jz-no-inv-other').text(acc.no_inv_other);
        }

        $('#kpi-jz-bank-amt').text(AshanUI.formatMoney(s.bank_total));
        $('#kpi-jz-bank-desc').text(`支出 ${s.bank_count || 0} 笔 | 期末结余 ${AshanUI.formatMoney(s.bank_closing)}`);

        $('#kpi-jz-cash-amt').text(AshanUI.formatMoney(s.cash_total));
        $('#kpi-jz-cash-desc').text(`支出 ${s.cash_count || 0} 笔 | 期末结余 ${AshanUI.formatMoney(s.cash_closing)}`);

        $('#kpi-jz-no-inv-amt').text(AshanUI.formatMoney(s.no_inv_total));
        $('#kpi-jz-no-inv-desc').text(`支出 ${s.no_inv_count || 0} 笔 | 期末结余 ${AshanUI.formatMoney(s.no_inv_closing)}`);

        $('#kpi-jz-no-inv-other-amt').text(AshanUI.formatMoney(s.no_inv_other_total));
        $('#kpi-jz-no-inv-other-desc').text(`支出 ${s.no_inv_other_count || 0} 笔 | 期末结余 ${AshanUI.formatMoney(s.no_inv_other_closing)}`);

        // 3. 渲染活动选项卡表格
        render_active_table();
    }

    function render_active_table() {
        const s = current_data.summary || {};
        const acc = current_data.account_names || {};
        const accountConfigs = {
            bank: {
                rows: current_data.bank_rows || [],
                openingBalance: Number(current_data.bank_opening || 0),
                openingRemark: 'GL Entry 银行科目期初结转',
                totalIncome: Number(s.bank_inflow || 0),
                totalExpense: Number(s.bank_total || 0),
                closingBalance: Number(s.bank_closing || 0),
                label: acc.bank || '银行-农行'
            },
            cash: {
                rows: current_data.cash_rows || [],
                openingBalance: Number(current_data.cash_opening || 0),
                openingRemark: 'GL Entry 现金科目期初结转',
                totalIncome: Number(s.cash_inflow || 0),
                totalExpense: Number(s.cash_total || 0),
                closingBalance: Number(s.cash_closing || 0),
                label: acc.cash || '现金-孟祥山'
            },
            no_inv: {
                rows: current_data.no_inv_rows || [],
                openingBalance: Number(current_data.no_inv_opening || 0),
                openingRemark: '当期无票现金账户期初结转',
                totalIncome: Number(s.no_inv_inflow || 0),
                totalExpense: Number(s.no_inv_total || 0),
                closingBalance: Number(s.no_inv_closing || 0),
                label: acc.no_inv || '现金-无票'
            },
            no_inv_other: {
                rows: current_data.no_inv_other_rows || [],
                openingBalance: Number(current_data.no_inv_other_opening || 0),
                openingRemark: '当期其他现金账户期初结转',
                totalIncome: Number(s.no_inv_other_inflow || 0),
                totalExpense: Number(s.no_inv_other_total || 0),
                closingBalance: Number(s.no_inv_other_closing || 0),
                label: acc.no_inv_other || '现金-其他'
            }
        };

        if (active_tab === 'hardware') {
            render_hardware_table();
            return;
        }

        const cfg = accountConfigs[active_tab];
        if (!cfg) return;

        AshanUI.renderBillingLedgerTable($('#jz-main-table-view'), {
            rows: cfg.rows,
            periodMonth: current_month,
            openingBalance: cfg.openingBalance,
            openingRemark: cfg.openingRemark,
            totalIncome: cfg.totalIncome,
            totalExpense: cfg.totalExpense,
            closingBalance: cfg.closingBalance,
            emptyText: `当前账期 ${current_month} 在【${cfg.label}】下暂无单据记录`,
            onRowClick: function(row) {
                if (row.is_hardware_summary || row.voucher_type === 'Hardware Summary' || row.item_name === '五金一批') {
                    $('.ashan-billing-tab-btn[data-tab="hardware"]').trigger('click');
                    return;
                }
                AshanUI.showBillingDetailModal(row, { accountLabel: cfg.label });
            }
        });
    }

    function render_hardware_table() {
        const rows = current_data.hardware_rows || [];
        const totHw = Number(current_data.summary?.hardware_total || 0);
        AshanUI.renderBillingLedgerTable($('#jz-main-table-view'), {
            rows: rows,
            periodMonth: current_month,
            showOpeningRow: false,
            showBalance: false,
            totalIncome: 0,
            totalExpense: totHw,
            footerLabel: `五金辅助核算总额（共 ${rows.length} 项）：`,
            emptyText: `当前账期 ${current_month} 暂无五金辅助明细`,
            onRowClick: function(row) {
                AshanUI.showBillingDetailModal(row, { accountLabel: '五金辅助核算库' });
            }
        });
    }

    // 就地记账
    function show_quick_add_modal() {
        const d = new frappe.ui.Dialog({
            title: '吉众就地快捷记账 (生成已过账报销单)',
            static: true,
            secondary_action_label: '取消',
            secondary_action: function() {
                d.hide();
            },
            fields: [
                { label: '记账日期', fieldname: 'posting_date', fieldtype: 'Date', default: frappe.datetime.now_date(), reqd: 1 },
                { label: '归属账户', fieldname: 'account_category', fieldtype: 'Select', options: '现金-无票\n现金-孟祥山\n银行-农行\n现金-其他', default: '现金-无票', reqd: 1 },
                { label: '支出项目', fieldname: 'item_name', fieldtype: 'Data', reqd: 1 },
                { label: '规格', fieldname: 'specification', fieldtype: 'Data' },
                { label: '支出金额 (元)', fieldname: 'amount', fieldtype: 'Currency', reqd: 1 },
                { label: '发票号码', fieldname: 'invoice_no', fieldtype: 'Data', default: '无票' },
                { label: '业务说明与备注', fieldname: 'remarks', fieldtype: 'Small Text' }
            ],
            primary_action_label: '提交并过账生效',
            primary_action: function(values) {
                frappe.call({
                    method: 'ashan_cn_procurement.ashan_cn_procurement.page.jizhong_billing_workbench.jizhong_billing_workbench.create_quick_jizhong_expense',
                    args: {
                        posting_date: values.posting_date,
                        item_name: values.item_name,
                        specification: values.specification,
                        amount: values.amount,
                        account_category: values.account_category,
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
            title: '吉众常态固定支出配置与全自动录单',
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
                const list = (r.message || []).filter(c => c.category !== '五金归集供应商');
                let tbl = `
                    <div class="ashan-billing-config-tip">
                        以下为吉众常态固定支出底册（含每月会计工资等），系统在账期内可一键全自动生成真实报销单。
                    </div>
                    <table class="table table-bordered table-sm ashan-billing-config-table">
                        <thead>
                            <tr>
                                <th>支出项目</th>
                                <th>发生日期</th>
                                <th>默认金额</th>
                                <th>归属账户</th>
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
                            <td>${c.account_category || '-'}</td>
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

    // 五金归集供应商/公司设置弹窗
    function show_hardware_supplier_modal() {
        const esc = frappe.utils.escape_html;
        const d = new frappe.ui.Dialog({
            title: '吉众五金辅助核算归集公司设置',
            size: 'large',
            static: true,
            secondary_action_label: '关闭',
            secondary_action: function() {
                d.hide();
            },
            fields: [
                {
                    fieldtype: 'HTML',
                    fieldname: 'tip_html',
                    options: '<div class="ashan-billing-config-tip">当已提交且已付款的报销单附带有效发票，且供应商名称命中下方已启用规则时，将自动归集至「五金辅助核算库」，并在「现金-孟祥山」合并为一条汇总行。</div>'
                },
                { label: '选择 ERPNext 供应商档案 (可选)', fieldname: 'supplier', fieldtype: 'Link', options: 'Supplier' },
                { label: '公司名称 / 匹配关键词 (如: 金普金)', fieldname: 'keyword', fieldtype: 'Data', description: '留空时默认使用上方所选供应商名称' },
                { fieldtype: 'HTML', fieldname: 'list_html' }
            ],
            primary_action_label: '添加并启用规则',
            primary_action: function(values) {
                const supVal = (values.supplier || '').trim();
                const kwVal = (values.keyword || '').trim() || supVal;
                if (!kwVal) {
                    frappe.msgprint('请选择供应商或输入公司名称关键词');
                    return;
                }
                frappe.call({
                    method: 'ashan_cn_procurement.services.billing_recurring_service.save_recurring_config',
                    args: {
                        data: {
                            company: company,
                            expense_name: `五金归集-${kwVal}`,
                            account_category: '现金-孟祥山',
                            category: '五金归集供应商',
                            default_amount: 0,
                            day_of_month: 1,
                            payee: '',
                            supplier: supVal,
                            auto_generate: 0,
                            is_active: 1,
                            remarks: kwVal
                        }
                    },
                    callback: function(r) {
                        if (r.message && r.message.status === 'ok') {
                            frappe.show_alert({ message: `已添加五金归集公司：${kwVal}`, indicator: 'green' });
                            d.set_value('supplier', '');
                            d.set_value('keyword', '');
                            refresh_supplier_list();
                            load_data();
                        }
                    }
                });
            }
        });

        function refresh_supplier_list() {
            frappe.call({
                method: 'ashan_cn_procurement.services.billing_recurring_service.get_recurring_configs',
                args: { company: company },
                callback: function(r) {
                    const rules = (r.message || []).filter(c => c.category === '五金归集供应商');
                    let tbl = `
                        <table class="table table-bordered table-sm ashan-billing-config-table">
                            <thead>
                                <tr>
                                    <th>匹配关键词</th>
                                    <th>关联供应商档案</th>
                                    <th class="ashan-billing-col-center">状态</th>
                                    <th class="ashan-billing-col-center">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                    `;
                    if (rules.length === 0) {
                        tbl += `<tr><td colspan="4" class="text-center text-muted p-3">暂未配置五金归集公司</td></tr>`;
                    } else {
                        rules.forEach((cfg, idx) => {
                            const kw = cfg.remarks || (cfg.expense_name || '').replace(/^五金归集-/, '');
                            const isActive = Boolean(Number(cfg.is_active));
                            tbl += `
                                <tr>
                                    <td><strong>${esc(kw)}</strong></td>
                                    <td>${esc(cfg.supplier || '-')}</td>
                                    <td class="ashan-billing-col-center">${isActive ? '已启用' : '已停用'}</td>
                                    <td class="ashan-billing-col-center">
                                        <button type="button" class="btn btn-default btn-xs jz-hw-toggle-btn" data-idx="${idx}">
                                            ${isActive ? '停用' : '启用'}
                                        </button>
                                    </td>
                                </tr>
                            `;
                        });
                    }
                    tbl += `</tbody></table>`;
                    const $wrap = d.fields_dict.list_html.$wrapper;
                    $wrap.html(tbl);
                    $wrap.find('.jz-hw-toggle-btn').on('click', function() {
                        const cfg = rules[Number($(this).data('idx'))];
                        if (!cfg) return;
                        const nextActive = Number(cfg.is_active) ? 0 : 1;
                        frappe.call({
                            method: 'ashan_cn_procurement.services.billing_recurring_service.save_recurring_config',
                            args: {
                                data: Object.assign({}, cfg, { is_active: nextActive })
                            },
                            callback: function(res) {
                                if (res.message && res.message.status === 'ok') {
                                    refresh_supplier_list();
                                    load_data();
                                }
                            }
                        });
                    });
                }
            });
        }

        d.show();
        refresh_supplier_list();
    }

    // 事件绑定
    $('#jz-month-picker').on('change', function() {
        current_month = $(this).val();
        if (jz_period_selector) jz_period_selector.setPeriod(current_month);
        load_data();
    });

    $('#btn-jz-refresh').on('click', function() {
        load_data();
    });

    $('#btn-jz-quick-add').on('click', function() {
        show_quick_add_modal();
    });

    $('#btn-jz-recurring').on('click', function() {
        show_recurring_config_modal();
    });

    $('#btn-jz-hw-suppliers').on('click', function() {
        show_hardware_supplier_modal();
    });

    $('#btn-jz-toggle-lock').on('click', function() {
        const nextLock = current_data && current_data.is_locked ? 0 : 1;
        frappe.confirm(`确定要执行【${nextLock ? '核定封账 🔒' : '反审核解锁 🟡'}】操作吗？`, function() {
            frappe.call({
                method: 'ashan_cn_procurement.ashan_cn_procurement.page.jizhong_billing_workbench.jizhong_billing_workbench.toggle_jizhong_billing_lock',
                args: {
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
        active_tab = $(this).data('tab');
        render_active_table();
    });

    $('#btn-jz-export-month').on('click', function() {
        const url = `/api/method/ashan_cn_procurement.services.billing_export_service.export_jizhong_billing_excel?period_month=${encodeURIComponent(current_month)}&mode=single_month`;
        window.open(url);
    });

    $('#btn-jz-export-all').on('click', function() {
        const url = `/api/method/ashan_cn_procurement.services.billing_export_service.export_jizhong_billing_excel?period_month=${encodeURIComponent(current_month)}&mode=all`;
        window.open(url);
    });

    load_data();
};
