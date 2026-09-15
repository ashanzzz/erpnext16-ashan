// ASHAN-COMPLETE: dynamic calendar-year selector and unified property UX
// Copyright (c) 2026, Ashan CN Procurement and contributors
// For license information, please see license.txt

frappe.pages['lease-settlement-workbench'].on_page_load = function(wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: '房租与物业费年度结算',
        single_column: true
    });
    wrapper.lease_settlement_workbench = new AnnualLeaseSettlementWorkbench(wrapper, page);
};

frappe.pages['lease-settlement-workbench'].on_page_show = function(wrapper) {
    if (wrapper.lease_settlement_workbench) {
        wrapper.lease_settlement_workbench.refresh();
    }
};

class AnnualLeaseSettlementWorkbench {
    constructor(wrapper, page) {
        this.wrapper = wrapper;
        this.page = page;
        this.$container = $(wrapper).find('.layout-main-section');

        this.currentYear = Number((frappe.datetime?.get_today?.() || new Date().toISOString().slice(0, 10)).slice(0, 4));
        this.currentDimension = 'annual'; // 'annual' (基准), 'monthly', 'daily'
        this.data = null;

        this.init_dom();
        this.bind_global_events();
        this.load_annual_settlement();
    }

    init_dom() {
        this.$container.empty();
        const html = `
        <div class="prop-settle-wrapper">
            <!-- ❶ 顶部控制栏 -->
            <div class="prop-header-bar">
                <div class="prop-title-box">
                    <h1 class="prop-page-title">🏢 房租与物业费年度结算与发票管理</h1>
                    <span class="prop-status-badge status-locked" id="settle-status-badge">✅ 按年缴费 · 专票对账</span>
                </div>
                <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                    <div class="prop-period-controls">
                        <label style="font-size:12px; font-weight:bold; color:#475569; margin-right:4px;">结算年度:</label>
                        <select class="prop-select-period" id="sel-year" style="font-weight:700; color:#1e293b;">
                            ${[this.currentYear - 1, this.currentYear, this.currentYear + 1]
                            .map(y => `<option value="${y}" ${y === this.currentYear ? "selected" : ""}>${y} 年度 (${y}.09-${y + 1}.09)</option>`)
                            .join("")}
                        </select>
                        <button class="prop-btn-nav" id="btn-refresh-data" title="刷新数据" style="margin-left: 4px;">🔄 刷新</button>
                    </div>
                </div>
            </div>

            <!-- 动作按钮栏 -->
            <div class="prop-actions-bar">
                <button class="prop-btn prop-btn-secondary" id="btn-preview-bills">
                    🖨️ 年度对账单预览/打印
                </button>
                <button class="prop-btn prop-btn-primary" id="btn-export-excel">
                    📥 导出年度台账 Excel
                </button>

                <div style="flex: 1;"></div>

                <a class="prop-btn prop-btn-outline" href="/desk/property-lease" target="_blank">
                    📁 租赁档案维护
                </a>
            </div>

            <!-- ❷ 计税与进项模型参数卡片 -->
            <div class="prop-rate-inspector-card">
                <div class="rate-inspector-header">
                    <span class="rate-inspector-title">💡 房租与物业费独立计税（房租 5% 专票 ｜ 物业服务 6% 专票）</span>
                    <span class="rate-inspector-sub">按年度合同一次性开具数电专票 ｜ 押金独立核算 ｜ 支持全生命周期开票核销</span>
                </div>
                <div class="rate-inspector-grid">
                    <div class="rate-card rate-card-lease">
                        <div class="rate-card-header">
                            <div class="rate-card-title">🏢 不动产房租 (5% 专票)</div>
                            <span class="rate-tag">简易征收专票</span>
                        </div>
                        <div class="rate-card-body">
                            <div class="rate-metric">
                                <span class="metric-lbl">计税标准:</span>
                                <span class="metric-val" style="color:#059669;">含税年金额 ÷ 1.05 × 5%</span>
                            </div>
                            <div class="rate-metric">
                                <span class="metric-lbl">发票品目:</span>
                                <span class="metric-val">*经营租赁*房租 (304050202)</span>
                            </div>
                        </div>
                    </div>

                    <div class="rate-card rate-card-lease">
                        <div class="rate-card-header">
                            <div class="rate-card-title">🛠️ 企业管理物业服务 (6% 专票)</div>
                            <span class="rate-tag">现代服务业专票</span>
                        </div>
                        <div class="rate-card-body">
                            <div class="rate-metric">
                                <span class="metric-lbl">计税标准:</span>
                                <span class="metric-val" style="color:#0284c7;">含税年金额 ÷ 1.06 × 6%</span>
                            </div>
                            <div class="rate-metric">
                                <span class="metric-lbl">发票品目:</span>
                                <span class="metric-val">*企业管理服务*管理费 (304080199)</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- ❸ 本年度公司房租物业总成本看板 -->
            <div class="prop-card-section">
                <div class="prop-section-header">
                    <span class="sec-title">📊 公司年度房租与物业总成本看板</span>
                    <span class="sec-tip">💡 按年度核算：总租金、单独物业费、押金、5%/6%进项税额与发票对账状态</span>
                </div>
                <div class="prop-table-responsive">
                    <table class="prop-excel-table" id="table-comp-summary">
                        <thead>
                            <tr>
                                <th style="width: 190px;">公司名称</th>
                                <th style="width: 90px; text-align: right;">承租总面积</th>
                                <th style="width: 110px; text-align: right;">年度房租(5%专票)</th>
                                <th style="width: 110px; text-align: right;">年度物业费(6%专票)</th>
                                <th style="width: 95px; text-align: right; color:#b45309;">押金/保证金</th>
                                <th style="width: 90px; text-align: right;">本年减免</th>
                                <th style="text-align: right; background: #ecfdf5; color: #065f46; width: 130px;">年度场地总成本(含税)</th>
                                <th style="text-align: right; background: #fff7ed; color: #c2410c; width: 105px;">增值税进项</th>
                                <th style="text-align: right; background: #f8fafc; color: #334155; width: 110px;">不含税成本</th>
                                <th style="text-align: center; width: 110px;">发票对账状态</th>
                                <th style="text-align: center; width: 90px;">操作</th>
                            </tr>
                        </thead>
                        <tbody id="tbody-comp-summary"></tbody>
                    </table>
                </div>
            </div>

            <!-- ❹ 场地租赁年度计费与发票关联对账明细 -->
            <div class="prop-card-section">
                <div class="prop-section-header">
                    <div class="sec-title-with-rate">
                        <span class="sec-title">🏢 场地租赁年度计费与发票关联对账明细</span>
                        <span class="tax-pill">发票 1:1 精准核销</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 12px; color: #64748b; font-weight: 600;">成本折算口径:</span>
                        <div class="prop-dim-switch-group" id="dim-switch-group">
                            <button class="dim-btn active" data-dim="annual">🏢 按年展示 (基准)</button>
                            <button class="dim-btn" data-dim="monthly">📆 折合每月</button>
                            <button class="dim-btn" data-dim="daily">📅 折合每日/㎡</button>
                        </div>
                    </div>
                </div>
                <div class="prop-table-responsive">
                    <table class="prop-excel-table" id="table-leases">
                        <thead>
                            <tr>
                                <th style="width: 125px;">所属公司</th>
                                <th style="width: 135px;">场地名称</th>
                                <th style="width: 75px; text-align: right;">面积(㎡)</th>
                                <th style="width: 80px; text-align: right; color: #b45309;">押金(元)</th>
                                <th style="width: 140px; text-align: center;">租赁起止周期</th>
                                <th style="min-width: 140px;">房租年度标准 (5%专票)</th>
                                <th style="min-width: 130px;">物业费 (6%专票/免收)</th>
                                <th style="width: 110px; text-align: right; background: #ecfdf5; color: #065f46;">年度应付总额</th>
                                <th style="min-width: 170px;">已关联发票 (对账)</th>
                                <th style="width: 90px; text-align: right; color: #c2410c;">税额</th>
                                <th style="width: 95px; text-align: right; color: #475569;">不含税成本</th>
                                <th style="width: 90px; text-align: center;">对账状态</th>
                                <th style="width: 85px; text-align: center;">操作</th>
                            </tr>
                        </thead>
                        <tbody id="tbody-leases"></tbody>
                    </table>
                </div>
            </div>
        </div>
        `;
        this.$container.html(html);
    }

    bind_global_events() {
        const self = this;

        // 年份选择
        this.$container.find('#sel-year').on('change', function() {
            self.currentYear = parseInt($(this).val());
            self.load_annual_settlement();
        });

        this.$container.find('#btn-refresh-data').on('click', () => {
            self.load_annual_settlement();
            frappe.show_alert({ message: '🔄 台账数据已刷新', indicator: 'green' });
        });

        // 折算口径切换 (年 / 月 / 日)
        this.$container.on('click', '#dim-switch-group .dim-btn', function() {
            self.$container.find('#dim-switch-group .dim-btn').removeClass('active');
            $(this).addClass('active');
            self.currentDimension = $(this).attr('data-dim');
            self.render_leases_table();
        });

        // 预览全部单证
        this.$container.find('#btn-preview-bills').on('click', () => {
            self.open_bills_preview_dialog();
        });

        // 导出 Excel
        this.$container.find('#btn-export-excel').on('click', () => {
            frappe.msgprint('已准备好导出本年度房租与物业费全套台账 Excel！');
        });
    }

    refresh() {
        this.load_annual_settlement();
    }

    load_annual_settlement() {
        const self = this;
        frappe.call({
            method: 'ashan_cn_procurement.ashan_cn_procurement.page.lease_settlement_workbench.lease_settlement_workbench.get_annual_settlement',
            args: { year: self.currentYear },
            callback(r) {
                if (r.message) {
                    self.data = r.message;
                    self.render_all();
                }
            }
        });
    }

    render_all() {
        if (!this.data) return;
        this.render_comp_summary_table();
        this.render_leases_table();
    }

    render_comp_summary_table() {
        const self = this;
        const summaries = this.data?.company_summaries || [];
        const $tbody = this.$container.find('#tbody-comp-summary');
        $tbody.empty();

        if (!summaries.length) {
            $tbody.html('<tr><td colspan="11" class="text-center text-muted" style="padding:16px;">暂无公司租赁数据</td></tr>');
            return;
        }

        let totArea = 0, totRent = 0, totProp = 0, totDep = 0, totDisc = 0, totGrand = 0, totTax = 0, totExcl = 0;

        summaries.forEach(s => {
            const compArea = flt(s.total_area);
            const rentAmt = flt(s.rent_amount);
            const propAmt = flt(s.property_fee_amount);
            const depAmt = flt(s.deposit_amount);
            const discAmt = flt(s.discount_amount);
            const compTot = flt(s.total_amount);
            const compTax = flt(s.tax_amount);
            const compExcl = flt(s.amount_tax_excl);

            totArea += compArea;
            totRent += rentAmt;
            totProp += propAmt;
            totDep += depAmt;
            totDisc += discAmt;
            totGrand += compTot;
            totTax += compTax;
            totExcl += compExcl;

            const isAllInvoiced = s.unbilled_amount <= 0;
            const statusTag = isAllInvoiced
                ? `<span class="prop-tag" style="background:#f0fdf4; color:#16a34a; border:1px solid #bbf7d0;">✅ 100% 已对账</span>`
                : `<span class="prop-tag" style="background:#fef2f2; color:#dc2626; border:1px solid #fca5a5;">待对账 ¥${format_currency(s.unbilled_amount)}</span>`;

            const row = `
                <tr>
                    <td><b>🏢 ${frappe.utils.escape_html(s.company)}</b></td>
                    <td style="text-align: right;">${format_number(compArea)} ㎡</td>
                    <td style="text-align: right;">¥ ${format_currency(rentAmt)}</td>
                    <td style="text-align: right; color: ${propAmt > 0 ? '#b45309' : '#94a3b8'};">
                        ${propAmt > 0 ? '¥ ' + format_currency(propAmt) : '—'}
                    </td>
                    <td style="text-align: right; color: ${depAmt > 0 ? '#b45309' : '#94a3b8'}; font-weight:${depAmt > 0 ? '700' : 'normal'};">
                        ${depAmt > 0 ? '¥ ' + format_currency(depAmt) : '—'}
                    </td>
                    <td style="text-align: right; color: ${discAmt > 0 ? '#16a34a' : '#94a3b8'};">
                        ${discAmt > 0 ? '-¥ ' + format_currency(discAmt) : '—'}
                    </td>
                    <td style="text-align: right; font-weight: 700; background: #ecfdf5; color: #065f46; font-size: 13.5px;">
                        ¥ ${format_currency(compTot)}
                    </td>
                    <td style="text-align: right; font-weight: 600; background: #fff7ed; color: #c2410c;">
                        ¥ ${format_currency(compTax)}
                    </td>
                    <td style="text-align: right; background: #f8fafc; color: #334155;">
                        ¥ ${format_currency(compExcl)}
                    </td>
                    <td style="text-align: center;">${statusTag}</td>
                    <td style="text-align: center;">
                        <button class="prop-btn-link btn-print-company" data-company="${frappe.utils.escape_html(s.company)}">
                            🖨️ 对账单
                        </button>
                    </td>
                </tr>
            `;
            const $r = $(row);
            $r.find('.btn-print-company').on('click', function(e) {
                e.stopPropagation();
                const comp = $(this).attr('data-company');
                self.open_single_bill_dialog(comp);
            });
            $tbody.append($r);
        });

        // 合计行
        const $rTot = $(`
            <tr class="prop-row-total">
                <td><b>全公司合计</b></td>
                <td style="text-align: right;">${format_number(totArea)} ㎡</td>
                <td style="text-align: right;">¥ ${format_currency(totRent)}</td>
                <td style="text-align: right;">¥ ${format_currency(totProp)}</td>
                <td style="text-align: right; color: #b45309; font-weight: 700;">¥ ${format_currency(totDep)}</td>
                <td style="text-align: right;">${totDisc > 0 ? '-¥ ' + format_currency(totDisc) : '—'}</td>
                <td style="text-align: right; font-weight: 800; font-size: 14.5px; color: #065f46; background: #ecfdf5;">¥ ${format_currency(totGrand)}</td>
                <td style="text-align: right; font-weight: 700; color: #c2410c; background: #fff7ed;">¥ ${format_currency(totTax)}</td>
                <td style="text-align: right; font-weight: 600; color: #334155; background: #f8fafc;">¥ ${format_currency(totExcl)}</td>
                <td style="text-align: center;"><span class="prop-tag" style="background:#ecfdf5; color:#059669;">全盘汇总</span></td>
                <td style="text-align: center;">
                    <button class="prop-btn-link" id="btn-print-total">
                        🖨️ 合计对账
                    </button>
                </td>
            </tr>
        `);
        $rTot.find('#btn-print-total').on('click', () => {
            self.open_single_bill_dialog('total');
        });
        $tbody.append($rTot);
    }

    render_leases_table() {
        const self = this;
        const leases = this.data?.leases || [];
        const $tbody = this.$container.find('#tbody-leases');
        $tbody.empty();

        if (!leases.length) {
            $tbody.html('<tr><td colspan="13" class="text-center text-muted" style="padding:16px;">暂无租赁物业档案配置</td></tr>');
            return;
        }

        const dim = this.currentDimension || 'annual';

        leases.forEach(l => {
            const area = flt(l.area) || 1.0;
            const deposit = flt(l.deposit_amount);

            // 1. 房租展示
            const rAnnAmt = flt(l.rent_annual_amount);
            const rAnnRate = flt(l.rent_annual_rate) || (rAnnAmt > 0 ? (rAnnAmt / area) : 0);
            const rMonAmt = flt(l.rent_monthly_amount) || (rAnnAmt / 12.0);
            const rMonRate = flt(l.rent_monthly_rate) || (rAnnRate / 12.0);
            const rDailyRate = flt(l.rent_daily_rate) || (rAnnAmt / (area * 365.0));

            let rentDisplay = '';
            if (dim === 'annual') {
                rentDisplay = `<b>¥ ${format_currency(rAnnAmt)}/年</b> <span style="font-size:11px; color:#64748b;">(${rAnnRate.toFixed(2)}元/㎡·年)</span>`;
            } else if (dim === 'monthly') {
                rentDisplay = `<b>¥ ${format_currency(rMonAmt)}/月</b> <span style="font-size:11px; color:#64748b;">(${rMonRate.toFixed(2)}元/㎡·月)</span>`;
            } else {
                rentDisplay = `<b>¥ ${rDailyRate.toFixed(4)}/㎡·天</b>`;
            }

            // 2. 物业费展示
            const isPropSep = (l.property_fee_mode === '单独计物业费');
            const pAnnAmt = flt(l.property_fee_annual_amount);
            const pAnnRate = flt(l.property_fee_annual_rate) || (pAnnAmt > 0 ? (pAnnAmt / area) : 0);
            const pMonAmt = flt(l.property_fee_monthly_amount) || (pAnnAmt / 12.0);
            const pMonRate = flt(l.property_fee_monthly_rate) || (pAnnRate / 12.0);
            const pDailyRate = flt(l.property_fee_daily_rate) || (pAnnAmt / (area * 365.0));

            let propDisplay = '';
            if (isPropSep && (pAnnAmt > 0 || pAnnRate > 0 || pDailyRate > 0)) {
                if (dim === 'annual') {
                    propDisplay = `<span style="color:#d97706; font-weight:700;">¥ ${pAnnRate.toFixed(2)}/㎡·年</span> <span style="font-size:11px; color:#64748b;">(年: ¥${format_currency(pAnnAmt)})</span>`;
                } else if (dim === 'monthly') {
                    propDisplay = `<span style="color:#d97706; font-weight:700;">¥ ${pMonRate.toFixed(2)}/㎡·月</span> <span style="font-size:11px; color:#64748b;">(月: ¥${format_currency(pMonAmt)})</span>`;
                } else {
                    propDisplay = `<span style="color:#d97706; font-weight:700;">¥ ${pDailyRate.toFixed(4)}/㎡·天</span>`;
                }
            } else {
                propDisplay = `<span class="prop-tag tag-prop-free" style="background:#f0fdf4; color:#16a34a; border:1px solid #bbf7d0;">免物业费 (0元)</span>`;
            }

            // 3. 已关联发票展示
            let invDisplay = '';
            const rInvNo = l.rent_invoice_no;
            const pInvNo = l.property_fee_invoice_no;
            if (rInvNo || pInvNo) {
                invDisplay = `
                    <div style="font-size:11px; line-height:1.4;">
                        ${rInvNo ? `<div>🏢 房租: <b>${frappe.utils.escape_html(rInvNo)}</b> (¥${format_currency(l.rent_invoice_amount)})</div>` : ''}
                        ${pInvNo ? `<div>🛠️ 物业: <b>${frappe.utils.escape_html(pInvNo)}</b> (¥${format_currency(l.property_fee_invoice_amount)})</div>` : ''}
                    </div>
                `;
            } else {
                invDisplay = `<span style="color:#94a3b8; font-size:11.5px;">尚未录入发票</span>`;
            }

            // 4. 对账状态
            const isAllInvoiced = (l.invoice_status === '全额已开票');
            const statusBadge = isAllInvoiced
                ? `<span class="prop-tag" style="background:#f0fdf4; color:#16a34a; border:1px solid #bbf7d0;">✅ 已对账</span>`
                : (l.invoice_status === '部分开票'
                    ? `<span class="prop-tag" style="background:#fff7ed; color:#c2410c; border:1px solid #fdba74;">🟡 部分开票</span>`
                    : `<span class="prop-tag" style="background:#fef2f2; color:#dc2626; border:1px solid #fca5a5;">🔴 未开票</span>`);

            const dateRange = (l.start_date && l.end_date)
                ? `${l.start_date} 至 ${l.end_date}`
                : '按年长租';

            const totTax = flt(l.rent_annual_tax_amount) + flt(l.property_fee_annual_tax_amount);
            const totExcl = flt(l.rent_annual_tax_excl) + flt(l.property_fee_annual_tax_excl) - flt(l.annual_discount_amount);

            const row = `
                <tr>
                    <td><b>${frappe.utils.escape_html(l.company)}</b></td>
                    <td><a href="/desk/property-lease/${encodeURIComponent(l.name)}" target="_blank" style="font-weight:600; color:#2563eb;">${frappe.utils.escape_html(l.property_name)}</a></td>
                    <td style="text-align: right;">${format_number(l.area)} ㎡</td>
                    <td style="text-align: right; color: ${deposit > 0 ? '#b45309' : '#94a3b8'}; font-weight: ${deposit > 0 ? '700' : 'normal'};">
                        ${deposit > 0 ? '¥ ' + format_currency(deposit) : '—'}
                    </td>
                    <td style="text-align: center; font-size:11.5px; color:#475569;">${dateRange}</td>
                    <td>${rentDisplay}</td>
                    <td>${propDisplay}</td>
                    <td style="text-align: right; font-weight: 700; background: #ecfdf5; color: #065f46; font-size:13px;">¥ ${format_currency(l.total_annual_amount)}</td>
                    <td>${invDisplay}</td>
                    <td style="text-align: right; color:#c2410c;">¥ ${format_currency(totTax)}</td>
                    <td style="text-align: right; color:#475569;">¥ ${format_currency(totExcl)}</td>
                    <td style="text-align: center;">${statusBadge}</td>
                    <td style="text-align: center;">
                        <button class="prop-btn-link btn-link-invoice" data-name="${frappe.utils.escape_html(l.name)}">
                            🔗 对账
                        </button>
                    </td>
                </tr>
            `;
            const $r = $(row);
            $r.find('.btn-link-invoice').on('click', function() {
                const name = $(this).attr('data-name');
                self.open_invoice_linking_dialog(name);
            });
            $tbody.append($r);
        });
    }

    open_invoice_linking_dialog(leaseName) {
        const self = this;
        const l = (this.data?.leases || []).find(it => it.name === leaseName);
        if (!l) return;

        const d = new frappe.ui.Dialog({
            title: `🧾 房租与物业费发票关联对账 · ${l.property_name}`,
            fields: [
                {
                    fieldtype: 'HTML',
                    fieldname: 'info_html',
                    options: `
                        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:10px 14px; margin-bottom:14px; font-size:12.5px;">
                            <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                                <span>承租公司: <b>${l.company}</b></span>
                                <span>租赁面积: <b>${l.area} ㎡</b></span>
                            </div>
                            <div style="display:flex; justify-content:space-between;">
                                <span>年度房租 (5%专票): <b>¥ ${format_currency(l.rent_annual_amount)}</b></span>
                                <span>年度物业费 (6%专票): <b>${flt(l.property_fee_annual_amount) > 0 ? '¥ ' + format_currency(l.property_fee_annual_amount) : '免物业费'}</b></span>
                            </div>
                        </div>
                    `
                },
                {
                    fieldtype: 'Section Break',
                    label: '🏢 房租发票信息 (5% 增值税专票)'
                },
                {
                    label: '房租数电专票号码',
                    fieldname: 'rent_invoice_no',
                    fieldtype: 'Data',
                    default: l.rent_invoice_no || ''
                },
                {
                    label: '房租开票日期',
                    fieldname: 'rent_invoice_date',
                    fieldtype: 'Date',
                    default: l.rent_invoice_date || ''
                },
                {
                    fieldtype: 'Column Break'
                },
                {
                    label: '房租开票金额 (价税合计)',
                    fieldname: 'rent_invoice_amount',
                    fieldtype: 'Currency',
                    default: l.rent_invoice_amount || l.rent_annual_amount || 0.0
                },
                {
                    label: '房租发票税额 (5%)',
                    fieldname: 'rent_invoice_tax',
                    fieldtype: 'Currency',
                    default: l.rent_invoice_tax || l.rent_annual_tax_amount || 0.0
                },
                {
                    fieldtype: 'Section Break',
                    label: '🛠️ 物业费发票信息 (6% 增值税专票)'
                },
                {
                    label: '物业费数电专票号码',
                    fieldname: 'property_fee_invoice_no',
                    fieldtype: 'Data',
                    default: l.property_fee_invoice_no || ''
                },
                {
                    label: '物业费开票日期',
                    fieldname: 'property_fee_invoice_date',
                    fieldtype: 'Date',
                    default: l.property_fee_invoice_date || ''
                },
                {
                    fieldtype: 'Column Break'
                },
                {
                    label: '物业费开票金额 (价税合计)',
                    fieldname: 'property_fee_invoice_amount',
                    fieldtype: 'Currency',
                    default: l.property_fee_invoice_amount || l.property_fee_annual_amount || 0.0
                },
                {
                    label: '物业费发票税额 (6%)',
                    fieldname: 'property_fee_invoice_tax',
                    fieldtype: 'Currency',
                    default: l.property_fee_invoice_tax || l.property_fee_annual_tax_amount || 0.0
                },
                {
                    fieldtype: 'Section Break',
                    label: '💰 本年租金优惠与减免 (平时填 0)'
                },
                {
                    label: '本年租金减免/优惠金额 (元)',
                    fieldname: 'annual_discount_amount',
                    fieldtype: 'Currency',
                    default: l.annual_discount_amount || 0.0
                }
            ],
            primary_action_label: '确认并保存对账',
            primary_action(vals) {
                frappe.call({
                    method: 'ashan_cn_procurement.ashan_cn_procurement.page.lease_settlement_workbench.lease_settlement_workbench.update_invoice_link',
                    args: {
                        lease_name: leaseName,
                        rent_invoice_no: vals.rent_invoice_no,
                        rent_invoice_date: vals.rent_invoice_date,
                        rent_invoice_amount: vals.rent_invoice_amount,
                        rent_invoice_tax: vals.rent_invoice_tax,
                        property_fee_invoice_no: vals.property_fee_invoice_no,
                        property_fee_invoice_date: vals.property_fee_invoice_date,
                        property_fee_invoice_amount: vals.property_fee_invoice_amount,
                        property_fee_invoice_tax: vals.property_fee_invoice_tax,
                        annual_discount_amount: vals.annual_discount_amount
                    },
                    freeze: true,
                    freeze_message: '正在保存发票对账记录...',
                    callback(r) {
                        if (r.message && r.message.status === 'success') {
                            d.hide();
                            frappe.show_alert({ message: '✅ 发票对账记录已成功保存！', indicator: 'green' });
                            self.load_annual_settlement();
                        } else {
                            frappe.msgprint({ title: '保存失败', message: r.message?.message || '未知错误', indicator: 'red' });
                        }
                    }
                });
            }
        });
        d.show();
    }

    open_bills_preview_dialog() {
        const summaries = this.data?.company_summaries || [];
        if (summaries.length > 0) {
            this.open_single_bill_dialog(summaries[0].company);
        } else {
            this.open_single_bill_dialog('total');
        }
    }

    open_single_bill_dialog(targetComp) {
        const self = this;
        const isTotal = (targetComp === 'total' || targetComp === '全公司合计');
        const leases = (this.data?.leases || []).filter(l => isTotal || l.company === targetComp);
        const summaries = this.data?.company_summaries || [];
        const yearStr = `${this.currentYear} 年度`;

        let tabHtml = `<div class="btn-group" style="margin-bottom: 16px;">`;
        summaries.forEach(s => {
            const active = (!isTotal && targetComp === s.company) ? 'btn-primary' : 'btn-default';
            tabHtml += `<button type="button" class="btn btn-xs ${active} tab-switch-comp" data-comp="${frappe.utils.escape_html(s.company)}">${frappe.utils.escape_html(s.company)}</button>`;
        });
        const totActive = isTotal ? 'btn-primary' : 'btn-default';
        tabHtml += `<button type="button" class="btn btn-xs ${totActive} tab-switch-comp" data-comp="total">🏢 全公司合计对账</button></div>`;

        let grandTot = 0, totRent = 0, totProp = 0, totDep = 0, totTax = 0, totExcl = 0;
        leases.forEach(l => {
            grandTot += flt(l.total_annual_amount);
            totRent += flt(l.rent_annual_amount);
            totProp += flt(l.property_fee_annual_amount);
            totDep += flt(l.deposit_amount);
            totTax += (flt(l.rent_annual_tax_amount) + flt(l.property_fee_annual_tax_amount));
            totExcl += (flt(l.rent_annual_tax_excl) + flt(l.property_fee_annual_tax_excl));
        });

        const compName = isTotal ? '全公司合计' : targetComp;
        const propertyManagementCompany = this.data?.property_management_company || '未配置物业结算主体';

        const dlg = new frappe.ui.Dialog({
            title: `🖨️ ${compName} - 房租与物业费年度对账单 (${yearStr})`,
            size: 'extra-large',
            fields: [
                {
                    fieldtype: 'HTML',
                    fieldname: 'bill_html',
                    options: `
                        ${tabHtml}
                        <div id="printable-company-bill" style="background:#fff; padding:20px; border:1px solid #e5e7eb; border-radius:6px; font-family:'等线','Microsoft YaHei',sans-serif; color:#000;">
                            <div class="bill-header" style="text-align:center; margin-bottom:16px;">
                                <div style="display:flex; justify-content:space-between; align-items:center;">
                                    <div style="font-size:12px; color:#6b7280;">表单编号: ANNUAL-LEASE-BILL</div>
                                    <div style="font-size:12px; color:#6b7280;">结算年度: ${yearStr}</div>
                                </div>
                                <h2 class="bill-title" style="margin:8px 0 2px; text-align:center; font-size:19px; font-weight:bold;">${frappe.utils.escape_html(propertyManagementCompany)}</h2>
                                <h3 class="bill-subtitle" style="margin:0 0 12px; text-align:center; font-size:15px;">${frappe.utils.escape_html(compName)} 房租与物业费年度对账单</h3>

                                <div class="bill-meta-row" style="display:flex; justify-content:space-between; border-top:1px solid #000; border-bottom:1px solid #000; padding:6px 4px; font-size:12px; margin-bottom:12px;">
                                    <div>承租单位: <b>${frappe.utils.escape_html(compName)}</b></div>
                                    <div>计费周期: <b>整年合同周期 (按年缴费)</b></div>
                                    <div>开票对账: <b>专票价税分离</b></div>
                                </div>
                            </div>

                            <div class="bill-sec-title" style="background:#f3f4f6; font-weight:bold; padding:4px 8px; font-size:12px; border:1px solid #000; border-bottom:none;">
                                🏢 场地租赁与物业服务年度合同明细（独立税率 · 专票对账）
                            </div>
                            <table class="bill-table-1to1" style="width:100%; border-collapse:collapse; font-size:11.5px; border:1px solid #000; text-align:center; margin-bottom:14px;">
                                <thead>
                                    <tr style="background:#f9fafb;">
                                        <th style="border:1px solid #000; padding:4px;">场地名称</th>
                                        <th style="border:1px solid #000; padding:4px;">面积(㎡)</th>
                                        <th style="border:1px solid #000; padding:4px;">押金(元)</th>
                                        <th style="border:1px solid #000; padding:4px;">房租年金额 (5%专票)</th>
                                        <th style="border:1px solid #000; padding:4px;">物业费年金额 (6%专票)</th>
                                        <th style="border:1px solid #000; padding:4px;">年度含税总额</th>
                                        <th style="border:1px solid #000; padding:4px;">已开房租发票号</th>
                                        <th style="border:1px solid #000; padding:4px;">已开物业发票号</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${leases.map(l => `
                                        <tr>
                                            <td style="border:1px solid #000; padding:4px;">${frappe.utils.escape_html(l.property_name)}</td>
                                            <td style="border:1px solid #000; padding:4px; text-align:right;">${format_number(l.area)} ㎡</td>
                                            <td style="border:1px solid #000; padding:4px; text-align:right;">${flt(l.deposit_amount) > 0 ? '¥ ' + format_currency(l.deposit_amount) : '—'}</td>
                                            <td style="border:1px solid #000; padding:4px; text-align:right;">¥ ${format_currency(l.rent_annual_amount)}</td>
                                            <td style="border:1px solid #000; padding:4px; text-align:right;">${flt(l.property_fee_annual_amount) > 0 ? '¥ ' + format_currency(l.property_fee_annual_amount) : '免收'}</td>
                                            <td style="border:1px solid #000; padding:4px; text-align:right; font-weight:bold;">¥ ${format_currency(l.total_annual_amount)}</td>
                                            <td style="border:1px solid #000; padding:4px;">${frappe.utils.escape_html(l.rent_invoice_no || '—')}</td>
                                            <td style="border:1px solid #000; padding:4px;">${frappe.utils.escape_html(l.property_fee_invoice_no || '—')}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>

                            <div class="bill-sec-title" style="background:#f3f4f6; font-weight:bold; padding:4px 8px; font-size:12px; border:1px solid #000; border-bottom:none;">
                                📊 年度应付款项与增值税分项汇总
                            </div>
                            <table class="bill-table-1to1" style="width:100%; border-collapse:collapse; font-size:11.5px; border:1px solid #000; text-align:center;">
                                <thead>
                                    <tr style="background:#f9fafb;">
                                        <th style="border:1px solid #000; padding:4px;">费用项目</th>
                                        <th style="border:1px solid #000; padding:4px;">不含税金额</th>
                                        <th style="border:1px solid #000; padding:4px;">适用税率</th>
                                        <th style="border:1px solid #000; padding:4px;">增值税额</th>
                                        <th style="border:1px solid #000; padding:4px;">价税合计</th>
                                        <th style="border:1px solid #000; padding:4px;">年度总开支</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td style="border:1px solid #000; padding:4px;">不动产经营租赁 (房租)</td>
                                        <td style="border:1px solid #000; padding:4px; text-align:right;">¥ ${format_currency(totRent / 1.05)}</td>
                                        <td style="border:1px solid #000; padding:4px;">5% 专票</td>
                                        <td style="border:1px solid #000; padding:4px; text-align:right;">¥ ${format_currency(totRent - (totRent / 1.05))}</td>
                                        <td style="border:1px solid #000; padding:4px; text-align:right; font-weight:bold;">¥ ${format_currency(totRent)}</td>
                                        <td rowspan="2" style="border:1px solid #000; padding:4px; vertical-align:middle; font-size:15px; font-weight:bold; color:#065f46;">
                                            ¥ ${format_currency(grandTot)}
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="border:1px solid #000; padding:4px;">企业管理物业服务</td>
                                        <td style="border:1px solid #000; padding:4px; text-align:right;">¥ ${format_currency(totProp > 0 ? (totProp / 1.06) : 0)}</td>
                                        <td style="border:1px solid #000; padding:4px;">${totProp > 0 ? '6% 专票' : '免收 (0%)'}</td>
                                        <td style="border:1px solid #000; padding:4px; text-align:right;">¥ ${format_currency(totProp > 0 ? (totProp - (totProp / 1.06)) : 0)}</td>
                                        <td style="border:1px solid #000; padding:4px; text-align:right; font-weight:bold;">¥ ${format_currency(totProp)}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    `
                }
            ],
            primary_action_label: '🖨️ 打印当前单证',
            primary_action() {
                const printContents = document.getElementById('printable-company-bill').innerHTML;
                const win = window.open('', '', 'height=750,width=950');
                win.document.write(`
                    <html>
                    <head>
                        <title>${compName} - ${yearStr} 房租物业费年度对账单</title>
                        <style>
                            body { font-family: "等线", "Microsoft YaHei", sans-serif; padding: 24px; color: #000; }
                            .bill-header { text-align: center; margin-bottom: 16px; }
                            .bill-title { margin: 0 0 4px 0; font-size: 20px; font-weight: bold; }
                            .bill-subtitle { font-size: 13px; margin-bottom: 6px; }
                            .bill-meta-row { display: flex; justify-content: space-between; border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 4px 0; font-size: 11.5px; }
                            .bill-sec-title { text-align: center; font-size: 12px; font-weight: bold; padding: 4px; border: 1px solid #000; margin-top: 10px; }
                            .bill-table-1to1 { width: 100%; border-collapse: collapse; font-size: 11.5px; margin-bottom: 6px; }
                            .bill-table-1to1 th { border: 1px solid #000; padding: 4px 6px; text-align: center; font-weight: bold; }
                            .bill-table-1to1 td { border: 1px solid #000; padding: 4px 6px; text-align: center; height: 26px; }
                        </style>
                    </head>
                    <body>
                        ${printContents}
                    </body>
                    </html>
                `);
                win.document.close();
                win.focus();
                setTimeout(() => { win.print(); }, 500);
            }
        });

        dlg.$wrapper.find('.tab-switch-comp').on('click', function() {
            const comp = $(this).attr('data-comp');
            dlg.hide();
            self.open_single_bill_dialog(comp);
        });

        dlg.show();
    }
}

function format_currency(v) {
    if (v === undefined || v === null || isNaN(v)) return '0.00';
    return Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function format_number(v, decimals) {
    if (v === undefined || v === null || isNaN(v)) return '0';
    if (decimals !== undefined) {
        return Number(v).toLocaleString('zh-CN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    }
    return Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
