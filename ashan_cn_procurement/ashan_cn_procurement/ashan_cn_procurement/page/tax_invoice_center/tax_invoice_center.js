// Copyright (c) 2026, Ashan CN Procurement and contributors
// Tax Invoice Center - Single-Page Dashboard

frappe.pages['tax-invoice-center'].on_page_load = function(wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __('税局发票'),
        single_column: true
    });
    wrapper.tax_invoice_center = new TaxInvoiceCenter(page);
};

frappe.pages['tax-invoice-center'].on_page_show = function(wrapper) {
    if (wrapper.tax_invoice_center && typeof wrapper.tax_invoice_center.load_data === 'function') {
        wrapper.tax_invoice_center.load_data();
    }
};

class TaxInvoiceCenter {
    constructor(page) {
        this.page = page;
        this.filters = {
            business_status: '',
            parse_status: '',
            company: '',
            from_date: '',
            to_date: '',
            search_text: '',
            pending_mode: '',
            review_category: '',
            workflow_only: ''
        };
        this.current_kpis = {};
        this.permissions = {};
        this.expanded_invoices = new Set();
        this.init_dom();
        this.bind_events();
        this.load_data();
    }

    init_dom() {
        this.page.main.empty();
        this.$wrapper = $(`
            <div class="tax-inv-wrapper">
                <!-- 顶部栏 -->
                <div class="tax-inv-top-bar">
                    <div class="tax-inv-title-wrap">
                        <h2>🏛️ 税局发票资料库</h2>
                        <div class="sub-title">税务系统下载发票的独立归档、结构化解析与 ERP 采购发票录入自动检查</div>
                    </div>
                    <div class="tax-inv-actions">
                        <button class="tax-btn tax-btn-secondary" id="btn-import-history">📜 导入记录</button>
                        <button class="tax-btn tax-btn-secondary" id="btn-settings">⚙️ 设置</button>
                        <button class="tax-btn tax-btn-primary" id="btn-upload">📤 上传发票 (PDF/ZIP)</button>
                    </div>
                </div>

                <!-- 业务状态与复核原因卡片 -->
                <div class="tax-kpi-grid">
                    <div class="tax-kpi-card card-pending" data-filter-kind="normal_pending" title="仅显示可直接进入 ERP 录入流程的发票">
                        <div class="kpi-left">
                            <div class="kpi-label">待录入（可直接处理）</div>
                            <div class="kpi-val" id="kpi-pending-val">-</div>
                        </div>
                        <div class="kpi-icon">⏳</div>
                    </div>
                    <div class="tax-kpi-card card-entered" data-status="已录入" data-workflow-only="1">
                        <div class="kpi-left">
                            <div class="kpi-label">已录入 ERP</div>
                            <div class="kpi-val" id="kpi-entered-val">-</div>
                        </div>
                        <div class="kpi-icon">✅</div>
                    </div>
                    <div class="tax-kpi-card card-offset" data-status="已对冲" data-workflow-only="1">
                        <div class="kpi-left">
                            <div class="kpi-label">已红冲对冲 (无需录入)</div>
                            <div class="kpi-val" id="kpi-offset-val">-</div>
                        </div>
                        <div class="kpi-icon">🔄</div>
                    </div>
                    <div class="tax-kpi-card card-abandoned" data-status="已废弃" data-workflow-only="1">
                        <div class="kpi-left">
                            <div class="kpi-label">已废弃</div>
                            <div class="kpi-val" id="kpi-abandoned-val">-</div>
                        </div>
                        <div class="kpi-icon">🗑️</div>
                    </div>
                    <div class="tax-kpi-card card-buyer-error" data-filter-kind="buyer_error" title="购买方不是天津祺富机械加工有限公司或天津吉众科技有限公司；管理员可删除">
                        <div class="kpi-left">
                            <div class="kpi-label">购买方错误（可删除）</div>
                            <div class="kpi-val" id="kpi-buyer-error-val">-</div>
                        </div>
                        <div class="kpi-icon">⛔</div>
                    </div>
                    <div class="tax-kpi-card card-review" data-filter-kind="data_review" title="原始凭证、逐行明细或解析结果需要人工核对">
                        <div class="kpi-left">
                            <div class="kpi-label">资料/解析待复核</div>
                            <div class="kpi-val" id="kpi-data-review-val">-</div>
                        </div>
                        <div class="kpi-icon">⚠️</div>
                    </div>
                </div>

                <!-- 筛选工具栏 -->
                <div class="tax-filter-bar">
                    <div class="filter-group">
                        <label>所属公司:</label>
                        <select class="tax-input" id="filter-company" style="min-width: 140px;">
                            <option value="">全部公司</option>
                        </select>
                    </div>
                    <div class="filter-group">
                        <label>开票日期:</label>
                        <input type="date" class="tax-input" id="filter-from-date" />
                        <span>至</span>
                        <input type="date" class="tax-input" id="filter-to-date" />
                    </div>
                    <div class="filter-group">
                        <label>业务状态:</label>
                        <select class="tax-input" id="filter-status">
                            <option value="">全部状态</option>
                            <option value="待录入">待录入</option>
                            <option value="已录入">已录入</option>
                            <option value="已对冲">已红冲对冲 (无需录入)</option>
                            <option value="已废弃">已废弃</option>
                        </select>
                    </div>
                    <div class="filter-group" style="flex: 1; min-width: 200px;">
                        <input type="text" class="tax-input" id="filter-search" placeholder="🔍 搜索发票号码、销售方、购买方、备注内容..." style="width: 100%;" />
                    </div>
                    <button class="tax-btn tax-btn-secondary" id="btn-refresh">🔄 刷新</button>
                </div>

                <!-- 主列表表格 -->
                <div class="tax-table-container">
                    <table class="tax-table" id="table-tax-invoices">
                        <thead>
                            <tr>
                                <th style="width: 85px;">状态</th>
                                <th style="width: 95px;">开票日期</th>
                                <th style="width: 165px;">发票号码</th>
                                <th style="width: 175px;">销售方</th>
                                <th style="width: 175px;">购买方</th>
                                <th style="width: 100px;">发票类型</th>
                                <th style="min-width: 140px;">内容摘要</th>
                                <th style="width: 95px; text-align: right;">不含税金额</th>
                                <th style="width: 85px; text-align: right;">税额</th>
                                <th style="width: 110px; text-align: right; font-weight: 700;">应付合计</th>
                                <th style="width: 125px;">ERP采购发票</th>
                                <th style="width: 70px; text-align: center;">PDF</th>
                                <th style="width: 60px; text-align: center;">操作</th>
                            </tr>
                        </thead>
                        <tbody id="tbody-tax-invoices">
                            <tr><td colspan="13" style="text-align: center; padding: 40px; color: #94a3b8;">正在加载税局发票数据...</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `);
        this.page.main.append(this.$wrapper);

        // 加载公司下拉选项
        frappe.call({
            method: 'frappe.client.get_list',
            args: { doctype: 'Company', fields: ['name', 'company_name'] },
            callback: (r) => {
                const $c = this.$wrapper.find('#filter-company');
                (r.message || []).forEach(comp => {
                    $c.append(`<option value="${frappe.utils.escape_html(comp.name)}">${frappe.utils.escape_html(comp.company_name || comp.name)}</option>`);
                });
            }
        });
    }

    bind_events() {
        const self = this;

        // KPI 卡片点击快速过滤
        this.$wrapper.find('.tax-kpi-card').on('click', function() {
            const status = $(this).attr('data-status');
            const filterKind = $(this).attr('data-filter-kind');
            const workflowOnly = $(this).attr('data-workflow-only') === '1';
            const isActive = $(this).hasClass('active');
            self.$wrapper.find('.tax-kpi-card').removeClass('active');

            if (isActive) {
                self.filters.business_status = '';
                self.filters.parse_status = '';
                self.filters.pending_mode = '';
                self.filters.review_category = '';
                self.filters.workflow_only = '';
                self.$wrapper.find('#filter-status').val('');
            } else {
                $(this).addClass('active');
                self.filters.pending_mode = '';
                self.filters.review_category = '';
                self.filters.workflow_only = '';
                if (filterKind === 'normal_pending') {
                    self.filters.business_status = '待录入';
                    self.filters.parse_status = '';
                    self.filters.pending_mode = 'normal';
                    self.$wrapper.find('#filter-status').val('待录入');
                } else if (filterKind === 'buyer_error') {
                    self.filters.business_status = '';
                    self.filters.parse_status = '需复核';
                    self.filters.review_category = 'buyer_error';
                    self.$wrapper.find('#filter-status').val('');
                } else if (filterKind === 'data_review') {
                    self.filters.business_status = '';
                    self.filters.parse_status = '需复核';
                    self.filters.review_category = 'data_issue';
                    self.$wrapper.find('#filter-status').val('');
                } else {
                    self.filters.business_status = status;
                    self.filters.parse_status = '';
                    self.filters.workflow_only = workflowOnly ? '1' : '';
                    self.$wrapper.find('#filter-status').val(status);
                }
            }
            self.load_data();
        });

        // 筛选栏事件
        this.$wrapper.find('#filter-company').on('change', function() {
            self.filters.company = $(this).val();
            self.load_data();
        });
        this.$wrapper.find('#filter-from-date').on('change', function() {
            self.filters.from_date = $(this).val();
            self.load_data();
        });
        this.$wrapper.find('#filter-to-date').on('change', function() {
            self.filters.to_date = $(this).val();
            self.load_data();
        });
        this.$wrapper.find('#filter-status').on('change', function() {
            self.filters.business_status = $(this).val();
            self.filters.parse_status = '';
            self.filters.pending_mode = '';
            self.filters.review_category = '';
            self.filters.workflow_only = '';
            self.$wrapper.find('.tax-kpi-card').removeClass('active');
            if (self.filters.business_status) {
                self.$wrapper.find(`.tax-kpi-card[data-status="${self.filters.business_status}"]`).addClass('active');
            }
            self.load_data();
        });

        // 搜索框防抖
        let searchTimeout = null;
        this.$wrapper.find('#filter-search').on('input', function() {
            clearTimeout(searchTimeout);
            const val = $(this).val();
            searchTimeout = setTimeout(() => {
                self.filters.search_text = val;
                self.load_data();
            }, 300);
        });

        this.$wrapper.find('#btn-refresh').on('click', () => { self.load_data(); });
        this.$wrapper.find('#btn-upload').on('click', () => { self.open_upload_dialog(); });
        this.$wrapper.find('#btn-settings').on('click', () => { self.open_settings_dialog(); });
        this.$wrapper.find('#btn-import-history').on('click', () => { self.open_batch_history_dialog(); });
    }

    load_data() {
        const self = this;
        frappe.call({
            method: 'ashan_cn_procurement.ashan_cn_procurement.page.tax_invoice_center.tax_invoice_center.get_tax_invoices',
            args: { filters: self.filters, start: 0, page_length: 100 },
            callback: (r) => {
                if (r.message) {
                    self.render_kpis(r.message.kpis || {});
                    self.permissions = r.message.permissions || {};
                    self.render_table(r.message.invoices || []);
                }
            }
        });
    }

    render_kpis(kpis) {
        this.$wrapper.find('#kpi-pending-val').text(kpis.pending_count || 0);
        this.$wrapper.find('#kpi-entered-val').text(kpis.entered_count || 0);
        this.$wrapper.find('#kpi-offset-val').text(kpis.offset_count || 0);
        this.$wrapper.find('#kpi-abandoned-val').text(kpis.abandoned_count || 0);
        this.$wrapper.find('#kpi-buyer-error-val').text(kpis.buyer_error_count || 0);
        this.$wrapper.find('#kpi-data-review-val').text(kpis.data_review_count || 0);
    }

    render_table(invoices) {
        const self = this;
        const $tbody = this.$wrapper.find('#tbody-tax-invoices');
        $tbody.empty();

        if (!invoices.length) {
            $tbody.html('<tr><td colspan="13" style="text-align: center; padding: 40px; color: #94a3b8;">暂无符合条件的税局发票记录</td></tr>');
            return;
        }

        invoices.forEach(inv => {
            const isExpanded = self.expanded_invoices.has(inv.invoice_no);
            let badgeClass = 'badge-pending', badgeText = '待录入';
            if ((inv.parse_warning || '').includes('【购买方错误】')) {
                badgeClass = 'badge-red';
                badgeText = '⛔ 购买方错误';
            } else if (inv.business_status === '已对冲') {
                badgeClass = 'badge-offset';
                badgeText = '🔄 已对冲';
            } else if (inv.match_status === '金额不符') {
                badgeClass = 'badge-mismatch';
                badgeText = '⚠️ 金额不符';
            } else if (inv.is_red_invoice) {
                badgeClass = 'badge-red';
                badgeText = '🔴 红字发票';
            } else if (inv.match_status === '废弃冲突') {
                badgeClass = 'badge-conflict';
                badgeText = '⚠️ 废弃冲突';
            } else if (inv.business_status === '已录入') {
                badgeClass = 'badge-entered';
                badgeText = '已录入';
            } else if (inv.business_status === '已废弃') {
                badgeClass = 'badge-abandoned';
                badgeText = '已废弃';
            }

            let piLink = '<span style="color: #94a3b8;">未匹配</span>';
            if (inv.business_status === '已对冲' && inv.offset_invoice) {
                piLink = `<span style="color: #7c3aed; font-weight: 600; font-size: 11.5px;" title="${frappe.utils.escape_html(inv.offset_note || '')}">🔄 冲销 ${frappe.utils.escape_html(inv.offset_invoice)}</span>`;
            } else if (inv.match_status === '金额不符' && inv.matched_purchase_invoice) {
                const statusPill = inv.purchase_invoice_docstatus === '已提交' ? '🟢' : '🟡';
                piLink = `<a href="/desk/purchase-invoice/${encodeURIComponent(inv.matched_purchase_invoice)}" target="_blank" style="color: #ea580c; font-weight: 600;" title="发票号码匹配，但采购发票金额与税局发票金额不一致，请核对！">${statusPill} ${frappe.utils.escape_html(inv.matched_purchase_invoice)} <span style="font-size: 11px; color: #dc2626;">(金额不符)</span></a>`;
            } else if (inv.matched_purchase_invoice) {
                const statusPill = inv.purchase_invoice_docstatus === '已提交' ? '🟢' : '🟡';
                piLink = `<a href="/desk/purchase-invoice/${encodeURIComponent(inv.matched_purchase_invoice)}" target="_blank" style="color: #2563eb; font-weight: 600;">${statusPill} ${frappe.utils.escape_html(inv.matched_purchase_invoice)}</a>`;
            }

            let pdfHtml = '<span style="color: #cbd5e1;">无</span>';
            if (inv.pdf_removed) {
                pdfHtml = '<span style="color: #94a3b8; font-size: 11px;">已清理</span>';
            } else if (inv.invoice_pdf) {
                pdfHtml = `<a href="${inv.invoice_pdf}" target="_blank" class="tax-pdf-view" title="查看 PDF">查看</a>`;
            }

            const $tr = $(`
                <tr class="data-row ${isExpanded ? 'expanded' : ''}" data-inv="${inv.invoice_no}">
                    <td><span class="tax-badge ${badgeClass}">${badgeText}</span></td>
                    <td>${inv.issue_date || '—'}</td>
                    <td>
                        <button class="tax-invoice-number-copy" title="点击复制发票号码">${inv.invoice_no}</button>
                    </td>
                    <td title="${frappe.utils.escape_html(inv.seller_name || '')}">
                        <div style="max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${frappe.utils.escape_html(inv.seller_name || '—')}
                        </div>
                    </td>
                    <td title="${frappe.utils.escape_html(inv.buyer_name || inv.company || '')}">
                        <div class="tax-buyer-name">
                            ${frappe.utils.escape_html(inv.buyer_name || '—')}
                        </div>
                    </td>
                    <td><span style="font-size: 12px; color: #475569;">${inv.invoice_type || '电子发票'}</span></td>
                    <td title="${frappe.utils.escape_html(inv.display_summary || '')}">
                        <div style="max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${frappe.utils.escape_html(inv.display_summary || '—')}
                        </div>
                    </td>
                    <td style="text-align: right;">¥ ${format_currency(inv.amount_without_tax)}</td>
                    <td style="text-align: right; color: #c2410c;">¥ ${format_currency(inv.tax_amount)}</td>
                    <td style="text-align: right; font-weight: 700; color: #0f172a;">¥ ${format_currency(inv.payable_total)}</td>
                    <td>${piLink}</td>
                    <td style="text-align: center;">${pdfHtml}</td>
                    <td style="text-align: center;" class="cell-action">
                        <div class="dropdown">
                            <button class="btn-action-trigger" style="background:transparent; border:none; cursor:pointer; font-size: 14px; padding: 2px 6px;">⋮</button>
                        </div>
                    </td>
                </tr>
            `);

            // 点击发票号码直接复制，不再额外显示复制图标。
            $tr.find('.tax-invoice-number-copy').on('click', function(e) {
                e.stopPropagation();
                frappe.utils.copy_to_clipboard(inv.invoice_no);
                frappe.show_alert({ message: __('已复制发票号码: ') + inv.invoice_no, indicator: 'green' });
            });

            // 行点击展开/折叠
            $tr.on('click', function(e) {
                if ($(e.target).closest('a, button, .dropdown').length) return;
                self.toggle_row_expansion(inv.invoice_no, $tr);
            });

            // 操作菜单
            $tr.find('.btn-action-trigger').on('click', function(e) {
                e.stopPropagation();
                self.open_row_actions_menu($(this), inv);
            });

            $tbody.append($tr);

            if (isExpanded) {
                self.render_expansion_drawer(inv.invoice_no, $tr);
            }
        });
    }

    toggle_row_expansion(invoice_no, $tr) {
        if (this.expanded_invoices.has(invoice_no)) {
            this.expanded_invoices.delete(invoice_no);
            $tr.removeClass('expanded');
            $tr.next('.tax-expand-row').remove();
        } else {
            this.expanded_invoices.add(invoice_no);
            $tr.addClass('expanded');
            this.render_expansion_drawer(invoice_no, $tr);
        }
    }

    render_expansion_drawer(invoice_no, $tr) {
        const self = this;
        const $expandTr = $(`<tr class="tax-expand-row"><td colspan="13"><div class="drawer-loading" style="padding: 16px; text-align: center; color: #64748b;">正在加载发票明细与对账校验...</div></td></tr>`);
        $tr.after($expandTr);

        frappe.call({
            method: 'ashan_cn_procurement.ashan_cn_procurement.page.tax_invoice_center.tax_invoice_center.get_tax_invoice_detail',
            args: { invoice_no: invoice_no },
            callback: (r) => {
                if (!r.message) return;
                const d = r.message;
                let itemsHtml = '';
                (d.items || []).forEach((it, idx) => {
                    const isVv = it.line_type === '车船税';
                    const isToll = (it.line_type === '通行费');
                    const rowClass = isVv ? 'row-vv-tax' : (isToll ? 'row-toll' : '');

                    let tollExtra = '';
                    if (isToll && it.plate_number) {
                        tollExtra = ` <span style="font-size: 11px; background: #dcfce7; color: #166534; padding: 1px 4px; border-radius: 3px;">车牌: ${it.plate_number} ${it.vehicle_type || ''}</span>`;
                    }

                    itemsHtml += `
                        <tr class="${rowClass}">
                            <td style="text-align: center;">${idx + 1}</td>
                            <td><span class="tax-badge ${isVv ? 'badge-pending' : 'badge-abandoned'}" style="font-size: 11px;">${it.line_type || '普通'}</span></td>
                            <td><strong>${frappe.utils.escape_html(it.item_name || '')}</strong>${tollExtra}</td>
                            <td>${frappe.utils.escape_html(it.spec_model || '—')}</td>
                            <td>${frappe.utils.escape_html(it.unit || '—')}</td>
                            <td style="text-align: right;">${it.quantity != null ? it.quantity : '—'}</td>
                            <td style="text-align: right;">${it.unit_price != null ? '¥ ' + format_currency(it.unit_price) : '—'}</td>
                            <td style="text-align: right;">¥ ${format_currency(it.amount)}</td>
                            <td style="text-align: center;">${it.tax_rate_text || '—'}</td>
                            <td style="text-align: right; color: #c2410c;">¥ ${format_currency(it.tax_amount)}</td>
                            <td style="text-align: right; font-weight: 700;">¥ ${format_currency(it.line_total)}</td>
                        </tr>
                    `;
                });

                $expandTr.find('td').html(`
                    <div class="expand-drawer-wrap">
                        <div class="expand-drawer-grid">
                            <!-- 购销方与解析溯源 -->
                            <div class="expand-card">
                                <div class="expand-card-title">🏢 交易双方与解析信息</div>
                                <div class="info-pair-grid">
                                    <span class="k">销售方名称:</span><span class="v"><strong>${frappe.utils.escape_html(d.seller_name || '—')}</strong></span>
                                    <span class="k">销售方税号:</span><span class="v" style="font-family: monospace;">${d.seller_tax_id || '—'}</span>
                                    <span class="k">购买方名称:</span><span class="v">${frappe.utils.escape_html(d.buyer_name || '—')}</span>
                                    <span class="k">购买方税号:</span><span class="v" style="font-family: monospace;">${d.buyer_tax_id || '—'}</span>
                                    <span class="k">开票人:</span><span class="v">${d.drawer || '—'}</span>
                                    <span class="k">解析来源:</span><span class="v"><span class="tax-badge ${d.parser_source === 'XML' ? 'badge-entered' : 'badge-pending'}">${d.parser_source || 'PDF'} 结构化提取</span> (置信度: ${d.parse_confidence || '高'})</span>
                                    ${d.parse_warning ? `<span class="k" style="color:#d97706;">解析警告:</span><span class="v" style="color:#d97706; font-weight:600;">${frappe.utils.escape_html(d.parse_warning)}</span>` : ''}
                                    ${d.remark ? `<span class="k">发票备注:</span><span class="v" style="background:#f1f5f9; padding:4px 6px; border-radius:4px; font-family: monospace;">${frappe.utils.escape_html(d.remark)}</span>` : ''}
                                </div>
                            </div>

                            <!-- 金额自校验与应付构成 -->
                            <div class="expand-card">
                                <div class="expand-card-title">💰 金额自校验与税务构成</div>
                                <div class="info-pair-grid">
                                    <span class="k">票面不含税:</span><span class="v">¥ ${format_currency(d.amount_without_tax)}</span>
                                    <span class="k">票面增值税:</span><span class="v" style="color:#c2410c;">+ ¥ ${format_currency(d.tax_amount)}</span>
                                    <span class="k">票面价税合计:</span><span class="v"><strong>= ¥ ${format_currency(d.invoice_grand_total)}</strong></span>
                                    ${flt(d.remark_total) > 0 ? `<span class="k">备注明确合计:</span><span class="v" style="color:#2563eb; font-weight:600;">¥ ${format_currency(d.remark_total)}</span>` : ''}
                                    <span class="k" style="font-weight:700; font-size:13px;">实际应付合计:</span><span class="v" style="font-weight:700; font-size:14px; color:#0f172a;">¥ ${format_currency(d.payable_total)}</span>
                                    <span class="k">ERP 录入状态:</span><span class="v">${d.matched_purchase_invoice ? `<span class="tax-badge badge-entered">已录入 (${d.matched_purchase_invoice})</span>` : `<span class="tax-badge badge-pending">待录入</span>`}</span>
                                </div>
                            </div>
                        </div>

                        <!-- 明细表格 -->
                        <div style="font-weight: 700; font-size: 13px; margin: 10px 0 4px; color: #1e293b;">📋 发票项目逐行明细 (${(d.items || []).length} 项)</div>
                        <table class="drawer-items-table">
                            <thead>
                                <tr>
                                    <th style="width: 40px; text-align: center;">#</th>
                                    <th style="width: 75px;">类型</th>
                                    <th>项目名称</th>
                                    <th style="width: 120px;">规格型号</th>
                                    <th style="width: 50px;">单位</th>
                                    <th style="width: 75px; text-align: right;">数量</th>
                                    <th style="width: 90px; text-align: right;">单价</th>
                                    <th style="width: 95px; text-align: right;">不含税金额</th>
                                    <th style="width: 70px; text-align: center;">税率</th>
                                    <th style="width: 85px; text-align: right;">税额</th>
                                    <th style="width: 95px; text-align: right;">本行合计</th>
                                </tr>
                            </thead>
                            <tbody>${itemsHtml || '<tr><td colspan="11" style="text-align:center; color:#94a3b8;">暂无明细</td></tr>'}</tbody>
                        </table>
                    </div>
                `);
            }
        });
    }

    open_row_actions_menu($btn, inv) {
        const self = this;
        const menu = [
            {
                label: '查看发票详情',
                action: () => { frappe.set_route('Form', 'Tax Invoice', inv.invoice_no); }
            },
            {
                label: '重新匹配采购发票',
                action: () => {
                    frappe.call({
                        method: 'ashan_cn_procurement.ashan_cn_procurement.page.tax_invoice_center.tax_invoice_center.rematch_tax_invoice',
                        args: { invoice_no: inv.invoice_no },
                        callback: (r) => {
                            frappe.show_alert({ message: __('匹配已更新'), indicator: 'blue' });
                            self.load_data();
                        }
                    });
                }
            }
        ];

        if (inv.business_status === '已对冲') {
            menu.push({
                label: '解除红冲对冲关联（恢复待录入）',
                action: () => {
                    frappe.confirm(__('确定解除此发票的红冲对冲关联？解除后双方发票将恢复为【待录入】。'), () => {
                        frappe.call({
                            method: 'ashan_cn_procurement.ashan_cn_procurement.page.tax_invoice_center.tax_invoice_center.unlink_tax_invoice_offset',
                            args: { invoice_no: inv.invoice_no },
                            callback: (r) => {
                                frappe.show_alert({ message: __('已解除对冲关联'), indicator: 'blue' });
                                self.load_data();
                            }
                        });
                    });
                }
            });
        } else if (inv.is_red_invoice || flt(inv.payable_total) < 0) {
            menu.push({
                label: '检测并执行红冲自动对冲',
                action: () => {
                    frappe.call({
                        method: 'ashan_cn_procurement.ashan_cn_procurement.page.tax_invoice_center.tax_invoice_center.trigger_red_invoice_reconciliation',
                        callback: (r) => {
                            frappe.show_alert({ message: __('红冲对冲检测完成'), indicator: 'green' });
                            self.load_data();
                        }
                    });
                }
            });
        }

        if (inv.business_status !== '已废弃' && inv.business_status !== '已对冲') {
            menu.push({
                label: '标记已废弃（无需录入）',
                action: () => { self.open_abandon_dialog(inv.invoice_no); }
            });
        } else if (inv.business_status === '已废弃') {
            menu.push({
                label: '恢复为待录入',
                action: () => {
                    frappe.confirm(__('确定将此发票恢复为待录入？系统将自动重新检测采购发票匹配状态。'), () => {
                        frappe.call({
                            method: 'ashan_cn_procurement.ashan_cn_procurement.page.tax_invoice_center.tax_invoice_center.restore_tax_invoice',
                            args: { invoice_no: inv.invoice_no },
                            callback: (r) => {
                                frappe.show_alert({ message: __('已恢复为待录入'), indicator: 'green' });
                                self.load_data();
                            }
                        });
                    });
                }
            });
        }

        if (self.can_delete_invalid_buyer_invoice(inv)) {
            menu.push({
                label: '归档购买方错误发票',
                action: () => { self.open_delete_invalid_buyer_invoice_dialog(inv); }
            });
        }

        const d = new frappe.ui.Dialog({ title: __('发票操作: ') + inv.invoice_no });
        let html = '<div class="list-group" style="margin: 0 -15px;">';
        menu.forEach(m => {
            html += `<a href="#" class="list-group-item list-group-item-action action-item" style="padding: 10px 18px; border-radius: 0;">${m.label}</a>`;
        });
        html += '</div>';
        d.$wrapper.find('.modal-body').html(html);
        d.$wrapper.find('.action-item').each((idx, el) => {
            $(el).on('click', (e) => {
                e.preventDefault();
                d.hide();
                menu[idx].action();
            });
        });
        d.show();
    }

    can_delete_invalid_buyer_invoice(inv) {
        return Boolean(
            this.permissions.can_delete_invalid_buyer
            && (inv.parse_warning || '').includes('【购买方错误】')
        );
    }

    open_delete_invalid_buyer_invoice_dialog(inv) {
        const self = this;
        frappe.prompt([
            {
                label: __('确认发票号码'),
                fieldname: 'confirmed_invoice_no',
                fieldtype: 'Data',
                reqd: 1,
                description: __('请完整输入 ') + inv.invoice_no
            },
            {
                label: __('删除原因'),
                fieldname: 'deletion_reason',
                fieldtype: 'Small Text',
                reqd: 1,
                default: __('购买方不属于本公司，删除错误导入记录')
            }
        ], (values) => {
            if ((values.confirmed_invoice_no || '').trim() !== inv.invoice_no) {
                frappe.msgprint({
                    title: __('未删除'),
                    indicator: 'red',
                    message: __('确认发票号码不一致。')
                });
                return;
            }
            frappe.confirm(
                __('将归档此购买方错误发票并保留原始附件；如存在红冲对冲关联，系统会先解除关联。原因和操作人会写入审计记录。确认继续？'),
                () => {
                    frappe.call({
                        method: 'ashan_cn_procurement.ashan_cn_procurement.page.tax_invoice_center.tax_invoice_center.delete_invalid_buyer_tax_invoice',
                        args: {
                            invoice_no: inv.invoice_no,
                            confirmed_invoice_no: values.confirmed_invoice_no,
                            deletion_reason: values.deletion_reason
                        },
                        callback: (r) => {
                            if (r.message && r.message.ok) {
                                frappe.show_alert({
                                    message: __('购买方错误发票已归档，原始附件已保留'),
                                    indicator: 'green'
                                });
                                self.expanded_invoices.delete(inv.invoice_no);
                                self.load_data();
                            }
                        }
                    });
                }
            );
        }, __('归档购买方错误发票'), __('确认归档'));
    }

    open_abandon_dialog(invoice_no) {
        const self = this;
        frappe.prompt([
            {
                label: __('废弃原因'),
                fieldname: 'reason',
                fieldtype: 'Select',
                options: '开错发票\n不属于本公司\n重复发票\n已红冲/无需录入\n其他',
                reqd: 1,
                default: '开错发票'
            },
            {
                label: __('废弃补充说明'),
                fieldname: 'note',
                fieldtype: 'Small Text'
            }
        ], (values) => {
            frappe.call({
                method: 'ashan_cn_procurement.ashan_cn_procurement.page.tax_invoice_center.tax_invoice_center.abandon_tax_invoice',
                args: { invoice_no: invoice_no, reason: values.reason, note: values.note },
                callback: (r) => {
                    if (r.message && r.message.ok) {
                        frappe.show_alert({ message: __('发票已标记为废弃'), indicator: 'orange' });
                        self.load_data();
                    }
                }
            });
        }, __('标记发票已废弃 (无需录入)'), __('确认废弃'));
    }

    open_upload_dialog() {
        const self = this;
        let selectedFiles = [];

        const dlg = new frappe.ui.Dialog({
            title: __('📤 上传税局发票 (PDF / ZIP / XML / OFD)'),
            fields: [
                {
                    fieldtype: 'HTML',
                    fieldname: 'drop_html',
                    options: `
                        <div class="tax-dropzone-container" style="position: relative;">
                            <label for="inp-tax-file" class="tax-dropzone" id="upload-dropzone" style="cursor: pointer; display: block; border: 2px dashed #38bdf8; background: #f0f9ff; border-radius: 8px; padding: 24px 16px; text-align: center; transition: all 0.2s ease;">
                                <div class="drop-icon" style="font-size: 36px; margin-bottom: 8px;">📁</div>
                                <div class="drop-title" id="drop-main-title" style="font-size: 14px; font-weight: 700; color: #0369a1; margin-bottom: 4px;">
                                    点击选择发票文件，或将文件拖拽至此处
                                </div>
                                <div class="drop-sub" id="drop-sub-title" style="font-size: 12px; color: #64748b; margin-bottom: 12px;">
                                    支持单个/批量 PDF、XML、OFD 或税务系统导出的 ZIP 压缩包 (支持多选)
                                </div>
                                <button type="button" class="btn btn-sm btn-primary" id="btn-browse-file" style="pointer-events: none; padding: 4px 16px; font-size: 12px; font-weight: 600;">
                                    📂 浏览电脑文件...
                                </button>
                                <div style="font-size: 11px; color: #94a3b8; margin-top: 12px; line-height: 1.4;">
                                    💡 若 ZIP 内包含 XML 与 PDF，系统将自动使用 XML 高精度解析明细，并长期保留 PDF 原始单据。
                                </div>
                                <input type="file" id="inp-tax-file" accept=".pdf,.zip,.xml,.ofd" multiple style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer;" />
                            </label>
                        </div>
                        <div id="selected-files-summary" style="margin-top: 10px; display: none; padding: 8px 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 12px; color: #334155;">
                            <!-- 已选文件摘要 -->
                        </div>
                        <div class="tax-progress-wrap" id="upload-progress-wrap" style="display: none; margin-top: 12px;">
                            <div class="tax-progress-bar" id="upload-bar" style="height: 6px; background: #0284c7; border-radius: 3px; width: 0%; transition: width 0.3s ease;"></div>
                        </div>
                        <div class="tax-progress-msg" id="upload-msg" style="display: none; margin-top: 6px; font-size: 12px; color: #0284c7; display: flex; justify-content: space-between;">
                            <span id="upload-step-text">正在上传文件...</span>
                            <span id="upload-pct-text">0%</span>
                        </div>
                    `
                }
            ],
            primary_action_label: __('🚀 开始解析并导入'),
            primary_action: () => {
                if (!selectedFiles.length) {
                    frappe.msgprint(__('请先选择要上传的 PDF、ZIP 或 XML 发票文件'));
                    return;
                }
                self.execute_batch_upload(selectedFiles, dlg);
            }
        });

        // 监听文件选择变更
        dlg.$wrapper.find('#inp-tax-file').on('change', function() {
            if (this.files && this.files.length) {
                selectedFiles = Array.from(this.files);
                self.update_selected_files_ui(selectedFiles, dlg);
            }
        });

        // 拖拽高亮效果
        const $dropzone = dlg.$wrapper.find('#upload-dropzone');
        $dropzone.on('dragover dragenter', function(e) {
            e.preventDefault();
            e.stopPropagation();
            $(this).css({ 'background': '#e0f2fe', 'border-color': '#0284c7' });
        });
        $dropzone.on('dragleave dragend drop', function(e) {
            e.preventDefault();
            e.stopPropagation();
            $(this).css({ 'background': '#f0f9ff', 'border-color': '#38bdf8' });
        });
        $dropzone.on('drop', function(e) {
            const dt = e.originalEvent.dataTransfer;
            if (dt && dt.files && dt.files.length) {
                selectedFiles = Array.from(dt.files);
                self.update_selected_files_ui(selectedFiles, dlg);
            }
        });

        dlg.show();
    }

    update_selected_files_ui(files, dlg) {
        const totalSize = files.reduce((acc, f) => acc + f.size, 0);
        const totalSizeKb = (totalSize / 1024).toFixed(1);
        const fileNames = files.map(f => f.name).slice(0, 3).join(', ') + (files.length > 3 ? ` 等共 ${files.length} 个文件` : '');

        dlg.$wrapper.find('#drop-main-title').text(`✅ 已选中 ${files.length} 个发票文件 (${totalSizeKb} KB)`);
        dlg.$wrapper.find('#drop-sub-title').text(fileNames);
        dlg.$wrapper.find('#selected-files-summary').show().html(`
            <strong>📄 准备导入清单:</strong>
            <ul style="margin: 4px 0 0 16px; padding: 0; max-height: 80px; overflow-y: auto;">
                ${files.map(f => `<li>${frappe.utils.escape_html(f.name)} <span style="color: #94a3b8;">(${(f.size/1024).toFixed(1)} KB)</span></li>`).join('')}
            </ul>
        `);
    }

    async execute_batch_upload(files, dlg) {
        const self = this;
        const $pWrap = dlg.$wrapper.find('#upload-progress-wrap');
        const $pMsg = dlg.$wrapper.find('#upload-msg');
        const $bar = dlg.$wrapper.find('#upload-bar');
        const $step = dlg.$wrapper.find('#upload-step-text');
        const $pct = dlg.$wrapper.find('#upload-pct-text');

        $pWrap.show();
        $pMsg.show();

        let successCount = 0;
        let duplicateCount = 0;
        let reviewCount = 0;
        let failCount = 0;
        const resultSummaries = [];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const currentPct = Math.round(((i + 1) / files.length) * 100);
            $step.text(`正在解析并导入 (${i + 1}/${files.length}): ${file.name}...`);
            $bar.css('width', `${currentPct}%`);
            $pct.text(`${currentPct}%`);

            const formData = new FormData();
            formData.append('file', file, file.name);

            try {
                const res = await new Promise((resolve, reject) => {
                    $.ajax({
                        url: '/api/method/ashan_cn_procurement.ashan_cn_procurement.page.tax_invoice_center.tax_invoice_center.upload_tax_invoice_file',
                        type: 'POST',
                        data: formData,
                        processData: false,
                        contentType: false,
                        headers: { 'X-Frappe-CSRF-Token': frappe.csrf_token },
                        success: resolve,
                        error: (xhr) => {
                            let msg = '网络或服务器错误';
                            try {
                                const j = JSON.parse(xhr.responseText);
                                if (j.exception) msg = j.exception;
                            } catch(e){}
                            reject(new Error(msg));
                        }
                    });
                });

                const msgData = res.message || {};
                if (msgData.ok) {
                    const c = msgData.created_count || 0;
                    const d = msgData.duplicate_count || 0;
                    const r = msgData.review_count || 0;
                    successCount += c;
                    duplicateCount += d;
                    reviewCount += r;
                    resultSummaries.push({
                        file: file.name,
                        ok: true,
                        msg: `成功导入: 新增 ${c} 份, 略过重复 ${d} 份, 需复核 ${r} 份`
                    });
                } else {
                    failCount += 1;
                    const errMsg = msgData.current_message || msgData.error || '未识别到有效发票';
                    resultSummaries.push({
                        file: file.name,
                        ok: false,
                        msg: errMsg,
                        error_log: msgData.error_log
                    });
                }
            } catch (err) {
                failCount += 1;
                resultSummaries.push({
                    file: file.name,
                    ok: false,
                    msg: err.message || '上传异常'
                });
            }
        }

        $step.text(`处理结束: 成功新增 ${successCount} 张，略过重复 ${duplicateCount} 张${failCount > 0 ? `，失败 ${failCount} 个文件` : ''}`);

        // 弹出详细结果与异常对话框
        dlg.hide();
        self.load_data();

        let detailsHtml = '<div style="max-height: 260px; overflow-y: auto; font-size: 12.5px; line-height: 1.6;">';
        resultSummaries.forEach(s => {
            if (s.ok) {
                detailsHtml += `
                    <div style="padding: 6px 10px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; margin-bottom: 6px;">
                        <strong style="color: #15803d;">📄 ${frappe.utils.escape_html(s.file)}</strong><br>
                        <span style="color: #166534;">${frappe.utils.escape_html(s.msg)}</span>
                    </div>
                `;
            } else {
                detailsHtml += `
                    <div style="padding: 8px 10px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; margin-bottom: 6px;">
                        <strong style="color: #b91c1c;">❌ ${frappe.utils.escape_html(s.file)}</strong><br>
                        <span style="color: #991b1b; font-weight: 600;">原因: ${frappe.utils.escape_html(s.msg)}</span>
                        ${s.error_log ? `<pre style="background:#fff; border:1px solid #fca5a5; padding:6px; margin-top:4px; font-size:11px; max-height:80px; overflow:auto; color:#b91c1c;">${frappe.utils.escape_html(s.error_log)}</pre>` : ''}
                    </div>
                `;
            }
        });
        detailsHtml += '</div>';

        if (failCount > 0 && successCount === 0 && duplicateCount === 0) {
            frappe.msgprint({
                title: __('⚠️ 税局发票导入失败'),
                indicator: 'red',
                message: `
                    <div style="margin-bottom: 10px;">
                        未能成功解析出任何有效发票，请确认上传的是从数电平台导出的包含 <b>XML</b> 或 <b>PDF</b> 的发票压缩包/文件。
                    </div>
                    ${detailsHtml}
                `
            });
        } else {
            frappe.msgprint({
                title: failCount > 0 ? __('⚠️ 税局发票部分导入完成') : __('🎉 税局发票导入成功'),
                indicator: failCount > 0 ? 'orange' : 'green',
                message: `
                    <div style="margin-bottom: 10px;">
                        共处理 <b>${files.length}</b> 个文件，新增入库 <b>${successCount}</b> 张发票，略过重复 <b>${duplicateCount}</b> 张，需复核 <b>${reviewCount}</b> 张。
                    </div>
                    ${detailsHtml}
                `
            });
        }
    }

    poll_batch_progress(batchName, dlg) {
        const self = this;
        const $bar = dlg.$wrapper.find('#upload-bar');
        const $step = dlg.$wrapper.find('#upload-step-text');
        const $pct = dlg.$wrapper.find('#upload-pct-text');

        const interval = setInterval(() => {
            frappe.call({
                method: 'ashan_cn_procurement.ashan_cn_procurement.page.tax_invoice_center.tax_invoice_center.get_import_batch_status',
                args: { batch_name: batchName },
                callback: (r) => {
                    if (!r.message) return;
                    const b = r.message;
                    const pct = b.progress_percent || 0;
                    $bar.css('width', `${pct}%`);
                    $pct.text(`${pct}%`);
                    $step.text(b.current_message || '正在后台解析...');

                    if (b.status === '已完成' || b.status === '部分失败' || b.status === '失败') {
                        clearInterval(interval);
                        dlg.hide();
                        frappe.msgprint({
                            title: b.status === '已完成' ? __('导入完成') : __('导入结束'),
                            indicator: b.status === '已完成' ? 'green' : 'orange',
                            message: `
                                <div><strong>批次编号:</strong> ${b.batch_name}</div>
                                <div><strong>识别发票:</strong> ${b.candidate_count} 份</div>
                                <div><strong>新增入库:</strong> ${b.created_count} 份</div>
                                <div><strong>重复略过:</strong> ${b.duplicate_count} 份</div>
                                <div><strong>需复核:</strong> ${b.review_count} 份</div>
                                <div><strong>失败:</strong> ${b.failed_count} 份</div>
                                ${b.error_log ? `<pre style="max-height:120px; overflow:auto; margin-top:8px; font-size:11px;">${frappe.utils.escape_html(b.error_log)}</pre>` : ''}
                            `
                        });
                        self.load_data();
                    }
                }
            });
        }, 1200);
    }

    open_settings_dialog() {
        const self = this;
        frappe.call({
            method: 'ashan_cn_procurement.ashan_cn_procurement.page.tax_invoice_center.tax_invoice_center.get_settings',
            callback: (r) => {
                const s = r.message || {};
                const dlg = new frappe.ui.Dialog({
                    title: __('税局发票设置'),
                    fields: [
                        {
                            label: __('启用原始 PDF 留存审计提示（不删除原件）'),
                            fieldname: 'auto_cleanup_enabled',
                            fieldtype: 'Check',
                            default: s.auto_cleanup_enabled
                        },
                        {
                            label: __('原始 PDF 法定留存天数（仅记录策略）'),
                            fieldname: 'pdf_retention_days',
                            fieldtype: 'Int',
                            default: s.pdf_retention_days || 730
                        },
                        {
                            label: __('留存基准日期'),
                            fieldname: 'cleanup_reference',
                            fieldtype: 'Select',
                            options: '发票日期\n创建日期',
                            default: s.cleanup_reference || '发票日期'
                        },
                        {
                            fieldtype: 'Section Break',
                            label: __('留存策略状态')
                        },
                        {
                            fieldtype: 'HTML',
                            fieldname: 'cleanup_action_html',
                            options: `
                                <span class="tax-source-retention-note">原始 PDF 凭证受留存保护，系统不会通过此页面删除原件。</span>
                            `
                        }
                    ],
                    primary_action_label: __('保存设置'),
                    primary_action: (values) => {
                        frappe.call({
                            method: 'ashan_cn_procurement.ashan_cn_procurement.page.tax_invoice_center.tax_invoice_center.save_settings',
                            args: { settings_data: values },
                            callback: () => {
                                frappe.show_alert({ message: __('发票设置已保存'), indicator: 'green' });
                                dlg.hide();
                            }
                        });
                    }
                });

                dlg.show();
            }
        });
    }

    get_batch_failure_reason(batch) {
        const errorLog = batch.error_log || '';
        if (!batch.failed_count) return '—';
        if (/\[Tax Invoice,[^\]]+\]:\s*issue_date/.test(errorLog)) {
            return `缺少开票日期（${batch.failed_count} 张）`;
        }
        const firstError = errorLog.split('\n').find(line => line.includes('解析失败') || line.includes('处理异常'));
        return firstError ? firstError.replace(/^发票\s+/, '') : '请查看该批次错误日志';
    }

    open_batch_history_dialog() {
        frappe.call({
            method: 'ashan_cn_procurement.ashan_cn_procurement.page.tax_invoice_center.tax_invoice_center.get_recent_batches',
            callback: (r) => {
                const batches = r.message || [];
                const dlg = new frappe.ui.Dialog({
                    title: __('📜 最近导入批次记录'),
                    size: 'large'
                });
                let html = `
                    <div style="max-height: 420px; overflow-y: auto;">
                        <table class="tax-table">
                            <thead>
                                <tr>
                                    <th>批次编号</th>
                                    <th>文件名</th>
                                    <th>上传人</th>
                                    <th>状态</th>
                                    <th style="text-align: right;">新增</th>
                                    <th style="text-align: right;">略过</th>
                                    <th style="text-align: right;">复核</th>
                                    <th style="text-align: right;">失败</th>
                                    <th>失败原因</th>
                                    <th>处理信息</th>
                                </tr>
                            </thead>
                            <tbody>
                `;
                if (!batches.length) {
                    html += '<tr><td colspan="10" style="text-align:center; padding: 20px; color:#94a3b8;">暂无批次记录</td></tr>';
                } else {
                    batches.forEach(b => {
                        const failureReason = this.get_batch_failure_reason(b);
                        html += `
                            <tr>
                                <td><strong>${b.name}</strong></td>
                                <td title="${frappe.utils.escape_html(b.source_filename || '')}">${frappe.utils.escape_html(b.source_filename || '—')}</td>
                                <td>${b.uploaded_by || '—'}</td>
                                <td><span class="tax-badge ${b.batch_status === '已完成' ? 'badge-entered' : (b.batch_status === '失败' ? 'badge-red' : 'badge-pending')}">${b.batch_status}</span></td>
                                <td style="text-align: right; color: #15803d; font-weight: 600;">${b.created_count}</td>
                                <td style="text-align: right; color: #64748b;">${b.duplicate_count}</td>
                                <td style="text-align: right; color: #b45309;">${b.review_count}</td>
                                <td style="text-align: right; color: #b91c1c;">${b.failed_count}</td>
                                <td><span class="tax-import-failure-reason">${frappe.utils.escape_html(failureReason)}</span></td>
                                <td style="font-size: 11px; color: #64748b;">${frappe.utils.escape_html(b.current_message || '—')}</td>
                            </tr>
                        `;
                    });
                }
                html += `</tbody></table></div>`;
                dlg.$wrapper.find('.modal-body').html(html);
                dlg.show();
            }
        });
    }
}

function format_currency(v) {
    if (v === undefined || v === null || isNaN(v)) return '0.00';
    return Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
