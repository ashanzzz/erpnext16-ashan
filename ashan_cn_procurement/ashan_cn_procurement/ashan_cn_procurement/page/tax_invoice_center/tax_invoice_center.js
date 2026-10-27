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
                <!-- 顶部中枢栏 -->
                <div class="tax-inv-top-bar">
                    <div class="tax-inv-title-wrap">
                        <h2>税局发票中心</h2>
                        <div class="sub-title">原始票据归档、合规校验与 ERP 自动钩稽中枢</div>
                    </div>
                    <div class="tax-inv-actions">
                        <button class="tax-btn tax-btn-secondary" id="btn-import-history">导入记录</button>
                        <button class="tax-btn tax-btn-secondary" id="btn-settings">设置</button>
                        <button class="tax-btn tax-btn-primary" id="btn-upload">上传发票 (PDF/ZIP)</button>
                    </div>
                </div>

                <!-- 业务状态与复核原因指标卡片 -->
                <div class="tax-kpi-grid">
                    <div class="tax-kpi-card card-pending" data-filter-kind="normal_pending" title="仅显示可直接进入 ERP 录入流程的发票">
                        <div class="kpi-left">
                            <div class="kpi-label">待录入（可直接处理）</div>
                            <div class="kpi-val" id="kpi-pending-val">-</div>
                        </div>
                        <div class="kpi-indicator-badge">待处理</div>
                    </div>
                    <div class="tax-kpi-card card-entered" data-status="已录入" data-workflow-only="1">
                        <div class="kpi-left">
                            <div class="kpi-label">已录入 ERP</div>
                            <div class="kpi-val" id="kpi-entered-val">-</div>
                        </div>
                        <div class="kpi-indicator-badge">已匹配</div>
                    </div>
                    <div class="tax-kpi-card card-offset" data-status="已对冲" data-workflow-only="1">
                        <div class="kpi-left">
                            <div class="kpi-label">已红冲对冲 (无需录入)</div>
                            <div class="kpi-val" id="kpi-offset-val">-</div>
                        </div>
                        <div class="kpi-indicator-badge">已对冲</div>
                    </div>
                    <div class="tax-kpi-card card-abandoned" data-status="已废弃" data-workflow-only="1">
                        <div class="kpi-left">
                            <div class="kpi-label">已废弃</div>
                            <div class="kpi-val" id="kpi-abandoned-val">-</div>
                        </div>
                        <div class="kpi-indicator-badge">已归档</div>
                    </div>
                    <div class="tax-kpi-card card-buyer-error" data-filter-kind="buyer_error" title="购买方不是天津祺富或天津吉众；管理员可归档">
                        <div class="kpi-left">
                            <div class="kpi-label">购买方错误（可删除）</div>
                            <div class="kpi-val" id="kpi-buyer-error-val">-</div>
                        </div>
                        <div class="kpi-indicator-badge">异常阻断</div>
                    </div>
                    <div class="tax-kpi-card card-review" data-filter-kind="data_review" title="原始凭证、逐行明细或解析结果需要人工核对">
                        <div class="kpi-left">
                            <div class="kpi-label">资料/解析待复核</div>
                            <div class="kpi-val" id="kpi-data-review-val">-</div>
                        </div>
                        <div class="kpi-indicator-badge">待复核</div>
                    </div>
                </div>

                <!-- 筛选工具栏 -->
                <div class="tax-filter-bar">
                    <div class="filter-group">
                        <label>所属公司:</label>
                        <select class="tax-input tax-input-company" id="filter-company">
                            <option value="">全部公司</option>
                        </select>
                    </div>
                    <div class="filter-group">
                        <label>开票日期:</label>
                        <input type="date" class="tax-input" id="filter-from-date" />
                        <span class="filter-group-date-sep">至</span>
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
                    <div class="filter-group filter-group-search">
                        <input type="text" class="tax-input tax-input-search" id="filter-search" placeholder="搜索发票号码、销售方、购买方、备注内容..." />
                    </div>
                    <div class="filter-actions-group">
                        <button class="tax-btn tax-btn-secondary" id="btn-reset">重置</button>
                        <button class="tax-btn tax-btn-secondary" id="btn-refresh">刷新</button>
                    </div>
                </div>

                <!-- 主列表表格 -->
                <div class="tax-table-container">
                    <table class="tax-table" id="table-tax-invoices">
                        <thead>
                            <tr>
                                <th class="col-status">状态</th>
                                <th class="col-date">开票日期</th>
                                <th class="col-inv-no">发票号码</th>
                                <th class="col-seller">销售方</th>
                                <th class="col-buyer">购买方</th>
                                <th class="col-type">发票类型</th>
                                <th class="col-summary">内容摘要</th>
                                <th class="col-amount">不含税金额</th>
                                <th class="col-tax">税额</th>
                                <th class="col-total">应付合计</th>
                                <th class="col-pi">ERP采购发票</th>
                                <th class="col-pdf">PDF</th>
                                <th class="col-action">操作</th>
                            </tr>
                        </thead>
                        <tbody id="tbody-tax-invoices">
                            <tr><td colspan="13" class="tax-table-empty">正在加载税局发票数据...</td></tr>
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

        // 重置按钮
        this.$wrapper.find('#btn-reset').on('click', () => {
            self.filters = {
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
            self.$wrapper.find('#filter-company').val('');
            self.$wrapper.find('#filter-from-date').val('');
            self.$wrapper.find('#filter-to-date').val('');
            self.$wrapper.find('#filter-status').val('');
            self.$wrapper.find('#filter-search').val('');
            self.$wrapper.find('.tax-kpi-card').removeClass('active');
            self.load_data();
        });

        this.$wrapper.find('#btn-refresh').on('click', () => { self.load_data(); });
        this.$wrapper.find('#btn-upload').on('click', () => { self.open_upload_dialog(); });
        this.$wrapper.find('#btn-settings').on('click', () => { self.open_settings_dialog(); });
        this.$wrapper.find('#btn-import-history').on('click', () => { self.open_batch_history_dialog(); });

        // 表头滚轮左右平滑滚动 (Mousewheel-to-Horizontal Scroll)
        const $tableContainer = this.$wrapper.find('.tax-table-container');
        this.$wrapper.find('.tax-table thead').on('wheel', function(e) {
            const originalEvent = e.originalEvent;
            if (originalEvent && originalEvent.deltaY !== 0) {
                $tableContainer.scrollLeft($tableContainer.scrollLeft() + originalEvent.deltaY);
                e.preventDefault();
            }
        });
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
            $tbody.html('<tr><td colspan="13" class="tax-table-empty">暂无符合条件的税局发票记录</td></tr>');
            return;
        }

        invoices.forEach(inv => {
            const isExpanded = self.expanded_invoices.has(inv.invoice_no);
            let badgeClass = 'badge-pending', badgeText = '待录入';
            if ((inv.parse_warning || '').includes('【购买方错误】')) {
                badgeClass = 'badge-red';
                badgeText = '购买方错误';
            } else if (inv.business_status === '已对冲') {
                badgeClass = 'badge-offset';
                badgeText = '已对冲';
            } else if (inv.match_status === '金额不符') {
                badgeClass = 'badge-mismatch';
                badgeText = '金额不符';
            } else if (inv.is_red_invoice) {
                badgeClass = 'badge-red';
                badgeText = '红字发票';
            } else if (inv.match_status === '废弃冲突') {
                badgeClass = 'badge-conflict';
                badgeText = '废弃冲突';
            } else if (inv.business_status === '已录入') {
                badgeClass = 'badge-entered';
                badgeText = '已录入';
            } else if (inv.business_status === '已废弃') {
                badgeClass = 'badge-abandoned';
                badgeText = '已废弃';
            }

            let piLink = '<span class="tax-pi-unmatched">未匹配</span>';
            if (inv.business_status === '已对冲' && inv.offset_invoice) {
                piLink = `<span class="tax-pi-offset" title="${frappe.utils.escape_html(inv.offset_note || '')}">冲销 ${frappe.utils.escape_html(inv.offset_invoice)}</span>`;
            } else if (inv.match_status === '金额不符' && inv.matched_purchase_invoice) {
                const dotClass = inv.purchase_invoice_docstatus === '已提交' ? 'tax-pi-dot-submitted' : 'tax-pi-dot-draft';
                piLink = `<a href="/desk/purchase-invoice/${encodeURIComponent(inv.matched_purchase_invoice)}" target="_blank" class="tax-pi-link tax-pi-link-mismatch" title="发票号码匹配，但采购发票金额与税局发票金额不一致，请核对！"><span class="tax-pi-status-dot ${dotClass}"></span>${frappe.utils.escape_html(inv.matched_purchase_invoice)} (金额不符)</a>`;
            } else if (inv.matched_purchase_invoice) {
                const dotClass = inv.purchase_invoice_docstatus === '已提交' ? 'tax-pi-dot-submitted' : 'tax-pi-dot-draft';
                piLink = `<a href="/desk/purchase-invoice/${encodeURIComponent(inv.matched_purchase_invoice)}" target="_blank" class="tax-pi-link tax-pi-link-valid"><span class="tax-pi-status-dot ${dotClass}"></span>${frappe.utils.escape_html(inv.matched_purchase_invoice)}</a>`;
            }

            let pdfHtml = '<span class="tax-pdf-none">无</span>';
            if (inv.pdf_removed) {
                pdfHtml = '<span class="tax-pdf-cleaned">已清理</span>';
            } else if (inv.invoice_pdf) {
                pdfHtml = `<a href="${inv.invoice_pdf}" target="_blank" class="tax-pdf-view" title="查看 PDF">查看</a>`;
            }

            const $tr = $(`
                <tr class="data-row ${isExpanded ? 'expanded' : ''}" data-inv="${inv.invoice_no}">
                    <td class="col-status"><span class="tax-badge ${badgeClass}">${badgeText}</span></td>
                    <td class="col-date">${inv.issue_date || '—'}</td>
                    <td class="col-inv-no">
                        <span class="tax-expander-icon"></span>
                        <button class="tax-invoice-number-copy" title="点击复制发票号码">${inv.invoice_no}</button>
                    </td>
                    <td class="col-seller" title="${frappe.utils.escape_html(inv.seller_name || '')}">
                        <div class="tax-seller-name">
                            ${frappe.utils.escape_html(inv.seller_name || '—')}
                        </div>
                    </td>
                    <td class="col-buyer" title="${frappe.utils.escape_html(inv.buyer_name || inv.company || '')}">
                        <div class="tax-buyer-name">
                            ${frappe.utils.escape_html(inv.buyer_name || '—')}
                        </div>
                    </td>
                    <td class="col-type"><span class="tax-type-text">${inv.invoice_type || '电子发票'}</span></td>
                    <td class="col-summary" title="${frappe.utils.escape_html(inv.display_summary || '')}">
                        <div class="tax-summary-text">
                            ${frappe.utils.escape_html(inv.display_summary || '—')}
                        </div>
                    </td>
                    <td class="col-amount tax-num-cell">¥ ${format_currency(inv.amount_without_tax)}</td>
                    <td class="col-tax tax-num-cell tax-tax-cell">¥ ${format_currency(inv.tax_amount)}</td>
                    <td class="col-total tax-num-cell tax-total-cell">¥ ${format_currency(inv.payable_total)}</td>
                    <td class="col-pi">${piLink}</td>
                    <td class="col-pdf">${pdfHtml}</td>
                    <td class="col-action cell-action">
                        <button class="btn-action-trigger" title="更多操作">⋮</button>
                    </td>
                </tr>
            `);

            // 点击发票号码直接复制
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

            // 操作按钮触发菜单
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
        const $expandTr = $(`<tr class="tax-expand-row"><td colspan="13"><div class="drawer-loading">正在加载发票明细与对账校验...</div></td></tr>`);
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
                        tollExtra = `<span class="drawer-toll-extra">车牌: ${it.plate_number} ${it.vehicle_type || ''}</span>`;
                    }

                    itemsHtml += `
                        <tr class="${rowClass}">
                            <td class="col-idx">${idx + 1}</td>
                            <td class="col-line-type"><span class="tax-badge ${isVv ? 'badge-pending' : 'badge-abandoned'}">${it.line_type || '普通'}</span></td>
                            <td><strong>${frappe.utils.escape_html(it.item_name || '')}</strong>${tollExtra}</td>
                            <td class="col-spec">${frappe.utils.escape_html(it.spec_model || '—')}</td>
                            <td class="col-unit">${frappe.utils.escape_html(it.unit || '—')}</td>
                            <td class="col-qty tax-num-cell">${it.quantity != null ? it.quantity : '—'}</td>
                            <td class="col-price tax-num-cell">${it.unit_price != null ? '¥ ' + format_currency(it.unit_price) : '—'}</td>
                            <td class="col-amt tax-num-cell">¥ ${format_currency(it.amount)}</td>
                            <td class="col-rate">${it.tax_rate_text || '—'}</td>
                            <td class="col-tax-amt tax-num-cell">¥ ${format_currency(it.tax_amount)}</td>
                            <td class="col-line-tot tax-num-cell">¥ ${format_currency(it.line_total)}</td>
                        </tr>
                    `;
                });

                $expandTr.find('td').html(`
                    <div class="expand-drawer-wrap">
                        <div class="expand-drawer-grid">
                            <!-- 购销方与解析溯源 -->
                            <div class="expand-card">
                                <div class="expand-card-title">交易双方与解析信息</div>
                                <div class="info-pair-grid">
                                    <span class="k">销售方名称:</span><span class="v"><strong>${frappe.utils.escape_html(d.seller_name || '—')}</strong></span>
                                    <span class="k">销售方税号:</span><span class="v info-mono">${d.seller_tax_id || '—'}</span>
                                    <span class="k">购买方名称:</span><span class="v">${frappe.utils.escape_html(d.buyer_name || '—')}</span>
                                    <span class="k">购买方税号:</span><span class="v info-mono">${d.buyer_tax_id || '—'}</span>
                                    <span class="k">开票人:</span><span class="v">${d.drawer || '—'}</span>
                                    <span class="k">解析来源:</span><span class="v"><span class="tax-badge ${d.parser_source === 'XML' ? 'badge-entered' : 'badge-pending'}">${d.parser_source || 'PDF'} 结构化提取</span> (置信度: ${d.parse_confidence || '高'})</span>
                                    ${d.parse_warning ? `<span class="k info-warning">解析警告:</span><span class="v info-warning">${frappe.utils.escape_html(d.parse_warning)}</span>` : ''}
                                    ${d.remark ? `<span class="k">发票备注:</span><span class="v info-remark-box">${frappe.utils.escape_html(d.remark)}</span>` : ''}
                                </div>
                            </div>

                            <!-- 金额自校验与应付构成 -->
                            <div class="expand-card">
                                <div class="expand-card-title">金额自校验与税务构成</div>
                                <div class="info-pair-grid">
                                    <span class="k">票面不含税:</span><span class="v tax-num-cell">¥ ${format_currency(d.amount_without_tax)}</span>
                                    <span class="k">票面增值税:</span><span class="v tax-num-cell info-tax-amount">+ ¥ ${format_currency(d.tax_amount)}</span>
                                    <span class="k">票面价税合计:</span><span class="v tax-num-cell"><strong>= ¥ ${format_currency(d.invoice_grand_total)}</strong></span>
                                    ${flt(d.remark_total) > 0 ? `<span class="k">备注明确合计:</span><span class="v tax-num-cell info-remark-total">¥ ${format_currency(d.remark_total)}</span>` : ''}
                                    <span class="k info-payable-label">实际应付合计:</span><span class="v tax-num-cell info-payable-value">¥ ${format_currency(d.payable_total)}</span>
                                    <span class="k">ERP 录入状态:</span><span class="v">${d.matched_purchase_invoice ? `<span class="tax-badge badge-entered">已录入 (${d.matched_purchase_invoice})</span>` : `<span class="tax-badge badge-pending">待录入</span>`}</span>
                                </div>
                            </div>
                        </div>

                        <!-- 明细表格 -->
                        <div class="drawer-items-title">发票项目逐行明细 (${(d.items || []).length} 项)</div>
                        <table class="drawer-items-table">
                            <thead>
                                <tr>
                                    <th class="col-idx">#</th>
                                    <th class="col-line-type">类型</th>
                                    <th>项目名称</th>
                                    <th class="col-spec">规格型号</th>
                                    <th class="col-unit">单位</th>
                                    <th class="col-qty">数量</th>
                                    <th class="col-price">单价</th>
                                    <th class="col-amt">不含税金额</th>
                                    <th class="col-rate">税率</th>
                                    <th class="col-tax-amt">税额</th>
                                    <th class="col-line-tot">本行合计</th>
                                </tr>
                            </thead>
                            <tbody>${itemsHtml || '<tr><td colspan="11" class="tax-table-empty">暂无明细</td></tr>'}</tbody>
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
                label: '查看发票',
                action: () => { frappe.set_route('Form', 'Tax Invoice', inv.invoice_no); }
            },
            {
                label: '复制发票信息 (发票号/销方/金额)',
                action: () => {
                    const text = `发票号码: ${inv.invoice_no}
开票日期: ${inv.issue_date || '—'}
销售方: ${inv.seller_name || '—'}
应付合计: ¥ ${format_currency(inv.payable_total)}`;
                    frappe.utils.copy_to_clipboard(text);
                    frappe.show_alert({ message: __('已复制发票核心信息到剪贴板'), indicator: 'green' });
                }
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

        const d = new frappe.ui.Dialog({
            title: __('发票操作: ') + inv.invoice_no,
            static: true
        });
        let html = '<div class="list-group">';
        menu.forEach(m => {
            html += `<a href="#" class="list-group-item list-group-item-action tax-action-item">${m.label}</a>`;
        });
        html += '</div>';
        d.$wrapper.find('.modal-body').html(html);
        d.$wrapper.find('.tax-action-item').each((idx, el) => {
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
            title: __('上传税局发票 (PDF / ZIP / XML / OFD)'),
            static: true,
            fields: [
                {
                    fieldtype: 'HTML',
                    fieldname: 'drop_html',
                    options: `
                        <div class="tax-dropzone-container">
                            <label for="inp-tax-file" class="tax-dropzone" id="upload-dropzone">
                                <div class="drop-main-title" id="drop-main-title">
                                    点击选择发票文件，或将文件拖拽至此处
                                </div>
                                <div class="drop-sub-title" id="drop-sub-title">
                                    支持单个/批量 PDF、XML、OFD 或税务系统导出的 ZIP 压缩包 (支持多选)
                                </div>
                                <button type="button" class="btn btn-sm btn-primary tax-drop-btn" id="btn-browse-file">
                                    浏览电脑文件...
                                </button>
                                <div class="tax-drop-tip">
                                    提示：若 ZIP 内包含 XML 与 PDF，系统将自动使用 XML 高精度解析明细，并长期保留 PDF 原始单据。
                                </div>
                                <input type="file" id="inp-tax-file" class="tax-file-input" accept=".pdf,.zip,.xml,.ofd" multiple />
                            </label>
                        </div>
                        <div id="selected-files-summary" class="tax-selected-files-summary tax-hidden">
                            <!-- 已选文件摘要 -->
                        </div>
                        <div class="tax-progress-wrap tax-hidden" id="upload-progress-wrap">
                            <div class="tax-progress-bar" id="upload-bar"></div>
                        </div>
                        <div class="tax-progress-msg tax-hidden" id="upload-msg">
                            <span id="upload-step-text">正在上传文件...</span>
                            <span id="upload-pct-text">0%</span>
                        </div>
                    `
                }
            ],
            primary_action_label: __('开始解析并导入'),
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
            $(this).addClass('dragover');
        });
        $dropzone.on('dragleave dragend drop', function(e) {
            e.preventDefault();
            e.stopPropagation();
            $(this).removeClass('dragover');
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

        dlg.$wrapper.find('#drop-main-title').text(`已选中 ${files.length} 个发票文件 (${totalSizeKb} KB)`);
        dlg.$wrapper.find('#drop-sub-title').text(fileNames);
        dlg.$wrapper.find('#selected-files-summary').removeClass('tax-hidden').show().html(`
            <strong>准备导入清单:</strong>
            <ul class="tax-selected-list">
                ${files.map(f => `<li>${frappe.utils.escape_html(f.name)} <span class="tax-file-size">(${(f.size/1024).toFixed(1)} KB)</span></li>`).join('')}
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

        $pWrap.removeClass('tax-hidden').show();
        $pMsg.removeClass('tax-hidden').show();

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

        dlg.hide();
        self.load_data();

        let detailsHtml = '<div class="tax-result-list">';
        resultSummaries.forEach(s => {
            if (s.ok) {
                detailsHtml += `
                    <div class="tax-result-card-ok">
                        <strong>${frappe.utils.escape_html(s.file)}</strong><br>
                        <span>${frappe.utils.escape_html(s.msg)}</span>
                    </div>
                `;
            } else {
                detailsHtml += `
                    <div class="tax-result-card-err">
                        <strong>${frappe.utils.escape_html(s.file)}</strong><br>
                        <span>原因: ${frappe.utils.escape_html(s.msg)}</span>
                        ${s.error_log ? `<pre class="tax-result-err-log">${frappe.utils.escape_html(s.error_log)}</pre>` : ''}
                    </div>
                `;
            }
        });
        detailsHtml += '</div>';

        if (failCount > 0 && successCount === 0 && duplicateCount === 0) {
            frappe.msgprint({
                title: __('税局发票导入失败'),
                indicator: 'red',
                message: `
                    <div class="tax-msg-intro">
                        未能成功解析出任何有效发票，请确认上传的是从数电平台导出的包含 <b>XML</b> 或 <b>PDF</b> 的发票压缩包/文件。
                    </div>
                    ${detailsHtml}
                `
            });
        } else {
            frappe.msgprint({
                title: failCount > 0 ? __('税局发票部分导入完成') : __('税局发票导入成功'),
                indicator: failCount > 0 ? 'orange' : 'green',
                message: `
                    <div class="tax-msg-intro">
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
                                ${b.error_log ? `<pre class="tax-result-err-log">${frappe.utils.escape_html(b.error_log)}</pre>` : ''}
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
                    static: true,
                    fields: [
                        {
                            label: __('启用原始 PDF 留存审计提示（不删除原件）'),
                            fieldname: 'auto_cleanup_enabled',
                            fieldtype: 'Check',
                            default: s.auto_cleanup_enabled
                        },
                        {
                            label: __('开票超期预警天数（天）'),
                            fieldname: 'overdue_days_threshold',
                            fieldtype: 'Int',
                            default: s.overdue_days_threshold || 180,
                            description: __('开票日期距今超过此天数的待录入发票将触发超期审计预警')
                        },
                        {
                            label: __('买方纳税人识别号白名单（每行一个）'),
                            fieldname: 'buyer_tax_id_whitelist',
                            fieldtype: 'Small Text',
                            default: (s.buyer_tax_id_whitelist || []).join('\n'),
                            description: __('导入发票时若购买方税号不在白名单内将标记为需复核')
                        },
                        {
                            fieldtype: 'HTML',
                            fieldname: 'cleanup_html',
                            options: `
                                <div class="tax-cleanup-panel">
                                    <button type="button" class="tax-btn tax-btn-secondary" id="btn-run-cleanup-now">执行留存审计检查</button>
                                    <div class="tax-cleanup-note">原始 PDF 凭证受留存保护，系统不会通过此页面删除原件。</div>
                                </div>
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

                dlg.$wrapper.find('#btn-run-cleanup-now').on('click', () => {
                    frappe.confirm(__('确定立即执行原始 PDF 留存审计检查？'), () => {
                        frappe.call({
                            method: 'ashan_cn_procurement.ashan_cn_procurement.page.tax_invoice_center.tax_invoice_center.run_cleanup_now',
                            callback: (r) => {
                                const msg = r.message || {};
                                frappe.msgprint({
                                    title: __('审计检查结果'),
                                    indicator: 'blue',
                                    message: msg.message || __('检查完成')
                                });
                                self.load_data();
                            }
                        });
                    });
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
                    title: __('最近导入批次记录'),
                    size: 'large',
                    static: true
                });
                let html = `
                    <div class="tax-batch-history-table-wrap">
                        <table class="tax-table">
                            <thead>
                                <tr>
                                    <th>批次编号</th>
                                    <th>文件名</th>
                                    <th>上传人</th>
                                    <th>状态</th>
                                    <th class="col-amount">新增</th>
                                    <th class="col-amount">略过</th>
                                    <th class="col-amount">复核</th>
                                    <th class="col-amount">失败</th>
                                    <th>失败原因</th>
                                    <th>处理信息</th>
                                </tr>
                            </thead>
                            <tbody>
                `;
                if (!batches.length) {
                    html += '<tr><td colspan="10" class="tax-table-empty">暂无批次记录</td></tr>';
                } else {
                    batches.forEach(b => {
                        const failureReason = this.get_batch_failure_reason(b);
                        html += `
                            <tr>
                                <td><strong>${b.name}</strong></td>
                                <td title="${frappe.utils.escape_html(b.source_filename || '')}">${frappe.utils.escape_html(b.source_filename || '—')}</td>
                                <td>${b.uploaded_by || '—'}</td>
                                <td><span class="tax-badge ${b.batch_status === '已完成' ? 'badge-entered' : (b.batch_status === '失败' ? 'badge-red' : 'badge-pending')}">${b.batch_status}</span></td>
                                <td class="col-amount tax-num-cell tax-count-created">${b.created_count}</td>
                                <td class="col-amount tax-num-cell tax-count-duplicate">${b.duplicate_count}</td>
                                <td class="col-amount tax-num-cell tax-count-review">${b.review_count}</td>
                                <td class="col-amount tax-num-cell tax-count-failed">${b.failed_count}</td>
                                <td><span class="tax-import-failure-reason">${frappe.utils.escape_html(failureReason)}</span></td>
                                <td class="tax-batch-msg">${frappe.utils.escape_html(b.current_message || '—')}</td>
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
