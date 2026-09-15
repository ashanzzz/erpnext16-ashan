// -*- coding: utf-8 -*-
frappe.pages['environmental-management'].on_page_load = function(wrapper) {
    $(wrapper).find('.layout-main-section').css({
        'background-color': '#f8f9fa',
        'min-height': 'calc(100vh - 60px)'
    });
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __('环保管理'),
        single_column: true
    });
    wrapper.environmental_management = new EnvironmentalManagement(wrapper, page);
};

frappe.pages['environmental-management'].on_page_show = function(wrapper) {
    $(wrapper).find('.layout-main-section').css({
        'background-color': '#f8f9fa',
        'min-height': 'calc(100vh - 60px)'
    });
    if (wrapper.environmental_management) {
        wrapper.environmental_management.refresh();
    }
};


/* ============================================================
   EnvironmentalManagement — 环保管理单页（危废管理 + 定期检测双轨 Tab）
   ============================================================ */
class EnvironmentalManagement {
    constructor(wrapper, page) {
        this.wrapper = wrapper;
        this.page = page;
        this.$container = $(wrapper).find('.layout-main-section');

        this.currentTab = 'inspection'; // 'waste' (危废管理) | 'inspection' (环保定期检测)
        this.selectedStatus = '全部';
        this.selectedCompany = '全部';
        this.searchText = '';
        this.data = null;

        this.init_dom();
        this.bind_events();
        this.load_dashboard();
    }

    // ─── 初始化 DOM 骨架 ──────────────────────────────────────
    init_dom() {
        this.$container.html(`
        <div class="env-mgmt-wrapper">

            <!-- ❶ 顶部业务 Tab 切换栏 -->
            <div class="env-tab-bar">
                <div class="env-tab-btn active" data-tab="inspection">
                    <span class="tab-icon">🧪</span>
                    <span class="tab-text">环保定期检测</span>
                </div>
                <div class="env-tab-btn" data-tab="waste">
                    <span class="tab-icon">🛢️</span>
                    <span class="tab-text">危废管理</span>
                </div>
            </div>

            <!-- ❷ 顶部状态指示条 (Banner) -->
            <div class="env-banner banner-success" id="env-banner">
                <span id="env-banner-text">🟢 正在加载环保合规数据...</span>
            </div>

            <!-- ❸ 核心 KPI 概览指标卡（看情况） -->
            <div class="env-kpi-grid">
                <div class="env-kpi-card kpi-upcoming" data-filter="即将到期">
                    <div class="kpi-icon">⏰</div>
                    <div class="kpi-info">
                        <div class="kpi-title">即将到期 (30天内)</div>
                        <div class="kpi-value" id="kpi-upcoming">0</div>
                    </div>
                </div>
                <div class="env-kpi-card kpi-overdue" data-filter="已逾期">
                    <div class="kpi-icon">⚠️</div>
                    <div class="kpi-info">
                        <div class="kpi-title">已逾期事项</div>
                        <div class="kpi-value" id="kpi-overdue">0</div>
                    </div>
                </div>
                <div class="env-kpi-card kpi-normal" data-filter="正常">
                    <div class="kpi-icon">✅</div>
                    <div class="kpi-info">
                        <div class="kpi-title">正常在期事项</div>
                        <div class="kpi-value" id="kpi-normal">0</div>
                    </div>
                </div>
            </div>

            <!-- ❹ 操作与筛选控制栏（操作放在 KPI 下方、详情上方） -->
            <div class="env-control-bar">
                <div class="env-control-left">
                    <div class="env-filter-group">
                        <span class="filter-label">公司:</span>
                        <select id="sel-env-company" class="env-select">
                            <option value="全部">全部公司</option>
                        </select>
                    </div>
                    <div class="env-filter-group">
                        <span class="filter-label">状态:</span>
                        <select id="sel-env-status" class="env-select">
                            <option value="全部">全部状态</option>
                            <option value="即将到期">即将到期 / 今日到期</option>
                            <option value="已逾期">已逾期</option>
                            <option value="正常">正常 / 注意</option>
                        </select>
                    </div>
                    <div class="env-search-box">
                        <input type="text" id="inp-env-search" class="env-input-search" placeholder="🔍 搜索检测项目、车间、责任人..." />
                    </div>
                </div>
                <div class="env-control-right">
                    <button class="env-btn env-btn-primary" id="btn-add-env-item">
                        <span>➕</span> <span id="btn-add-text">新增检测项目</span>
                    </button>
                    <button class="env-btn env-btn-secondary" id="btn-refresh-env">
                        <span>🔄</span> 刷新
                    </button>
                </div>
            </div>

            <!-- ❺ 业务数据表格区（详情在最下方） -->
            <div class="env-table-container">
                <table class="env-table" id="env-data-table">
                    <thead id="env-thead"></thead>
                    <tbody id="env-tbody"></tbody>
                </table>
                <div class="env-empty-state" id="env-empty" style="display:none;">
                    <div class="empty-icon">🍃</div>
                    <div class="empty-text">当前筛选条件下暂无环保事项记录</div>
                </div>
            </div>

        </div>
        `);
    }

    // ─── 事件绑定 ─────────────────────────────────────────────
    bind_events() {
        const self = this;

        // 1. Tab 切换
        this.$container.find('.env-tab-btn').on('click', function() {
            const tab = $(this).attr('data-tab');
            if (self.currentTab === tab) return;

            self.currentTab = tab;
            self.$container.find('.env-tab-btn').removeClass('active');
            $(this).addClass('active');

            // 切换新建按钮文案
            if (tab === 'waste') {
                self.$container.find('#btn-add-text').text('新增危废事项');
            } else {
                self.$container.find('#btn-add-text').text('新增检测项目');
            }

            self.selectedStatus = '全部';
            self.$container.find('#sel-env-status').val('全部');
            self.load_dashboard();
        });

        // 2. KPI 卡片点击一键筛选
        this.$container.find('.env-kpi-card').on('click', function() {
            const filter = $(this).attr('data-filter');
            if (self.selectedStatus === filter) {
                self.selectedStatus = '全部';
                self.$container.find('#sel-env-status').val('全部');
            } else {
                self.selectedStatus = filter;
                self.$container.find('#sel-env-status').val(filter);
            }
            self.load_dashboard();
        });

        // 3. 公司筛选
        this.$container.find('#sel-env-company').on('change', function() {
            self.selectedCompany = $(this).val();
            self.load_dashboard();
        });

        // 4. 状态筛选
        this.$container.find('#sel-env-status').on('change', function() {
            self.selectedStatus = $(this).val();
            self.load_dashboard();
        });

        // 5. 搜索框
        let searchTimer = null;
        this.$container.find('#inp-env-search').on('input', function() {
            clearTimeout(searchTimer);
            const val = $(this).val();
            searchTimer = setTimeout(() => {
                self.searchText = val;
                self.load_dashboard();
            }, 300);
        });

        // 6. 新建项目按钮
        this.$container.find('#btn-add-env-item').on('click', () => {
            self.open_quick_create_dialog();
        });

        // 7. 刷新按钮
        this.$container.find('#btn-refresh-env').on('click', () => {
            self.load_dashboard();
        });
    }

    // ─── 刷新页面 ─────────────────────────────────────────────
    refresh() {
        this.load_dashboard();
    }

    // ─── 数据加载 ─────────────────────────────────────────────
    load_dashboard() {
        const self = this;
        frappe.call({
            method: 'ashan_cn_procurement.ashan_cn_procurement.page.environmental_management.environmental_management.get_environmental_dashboard_data',
            args: {
                tab_type: self.currentTab,
                company: self.selectedCompany,
                status: self.selectedStatus,
                search_text: self.searchText
            },
            callback(r) {
                if (r.message) {
                    self.data = r.message;
                    self.render_all();
                }
            }
        });
    }

    // ─── 渲染整个工作台 ───────────────────────────────────────
    render_all() {
        this.render_kpi_and_banner();
        this.render_companies_dropdown();
        this.$container.find('#btn-add-env-item').toggle(Boolean(this.data?.can_create));
        this.render_table();
    }

    // ─── 渲染 KPI 与顶部提示条 ────────────────────────────────
    render_kpi_and_banner() {
        const d = this.data;
        if (!d) return;

        // KPI
        this.$container.find('#kpi-upcoming').text(d.kpi.upcoming || 0);
        this.$container.find('#kpi-overdue').text(d.kpi.overdue || 0);
        this.$container.find('#kpi-normal').text(d.kpi.normal || 0);

        // Banner
        const $banner = this.$container.find('#env-banner');
        $banner.removeClass('banner-danger banner-warning banner-success');
        if (d.banner.type === 'danger') {
            $banner.addClass('banner-danger');
        } else if (d.banner.type === 'warning') {
            $banner.addClass('banner-warning');
        } else {
            $banner.addClass('banner-success');
        }
        this.$container.find('#env-banner-text').text(d.banner.message);
    }

    // ─── 渲染公司下拉 ─────────────────────────────────────────
    render_companies_dropdown() {
        const $sel = this.$container.find('#sel-env-company');
        const currentVal = this.selectedCompany;
        const companies = this.data?.companies || [];

        let html = '<option value="全部">全部公司</option>';
        companies.forEach(c => {
            const sel = (c === currentVal) ? 'selected' : '';
            html += `<option value="${frappe.utils.escape_html(c)}" ${sel}>${frappe.utils.escape_html(c)}</option>`;
        });
        $sel.html(html);
    }

    // ─── 渲染业务数据表格 ─────────────────────────────────────
    render_table() {
        const self = this;
        const items = this.data?.items || [];
        const isWaste = (this.currentTab === 'waste');

        const $thead = this.$container.find('#env-thead');
        const $tbody = this.$container.find('#env-tbody');
        const $empty = this.$container.find('#env-empty');

        $thead.empty();
        $tbody.empty();

        if (!items.length) {
            $empty.show();
            return;
        }
        $empty.hide();

        // 1. 表头
        if (isWaste) {
            $thead.html(`
                <tr>
                    <th style="width: 100px; text-align: center;">状态</th>
                    <th style="min-width: 150px;">危废事项 / 种类</th>
                    <th style="min-width: 130px;">所属公司</th>
                    <th style="min-width: 120px;">上次处理日期</th>
                    <th style="min-width: 90px; text-align: center;">周期</th>
                    <th style="min-width: 120px;">下次计划处理</th>
                    <th style="min-width: 110px; text-align: center;">剩余天数</th>
                    <th style="min-width: 110px; text-align: center;">转移凭证</th>
                    <th style="min-width: 110px;">责任人/地点</th>
                    <th style="min-width: 140px; text-align: center;">快捷操作</th>
                </tr>
            `);
        } else {
            $thead.html(`
                <tr>
                    <th style="width: 100px; text-align: center;">状态</th>
                    <th style="min-width: 160px;">检测项目</th>
                    <th style="min-width: 90px; text-align: center;">类型</th>
                    <th style="min-width: 130px;">所属公司</th>
                    <th style="min-width: 120px;">上次检测日期</th>
                    <th style="min-width: 90px; text-align: center;">周期</th>
                    <th style="min-width: 120px;">下次到期日</th>
                    <th style="min-width: 110px; text-align: center;">剩余天数</th>
                    <th style="min-width: 110px; text-align: center;">检测报告</th>
                    <th style="min-width: 110px;">责任人</th>
                    <th style="min-width: 140px; text-align: center;">快捷操作</th>
                </tr>
            `);
        }

        // 2. 表体行
        items.forEach(it => {
            const statusBadge = self.get_status_badge(it.status, it.days_remaining);
            const remainingBadge = self.get_remaining_badge(it.days_remaining);
            const reportCell = self.get_report_cell(it);
            const rowActions = it.can_write ? `
                <div class="row-actions">
                    <button class="btn-act btn-act-primary btn-record-action" data-name="${it.name}" title="登记本次处理">
                        ${isWaste ? '登记处理' : '登记检测'}
                    </button>
                    <button class="btn-act btn-act-secondary btn-edit-item" data-name="${it.name}" title="编辑事项">
                        编辑
                    </button>
                </div>
            ` : '<span class="text-muted">只读</span>';

            let rowHtml = '';
            if (isWaste) {
                rowHtml = `
                <tr class="env-row" data-name="${it.name}">
                    <td style="text-align: center;">${statusBadge}</td>
                    <td>
                        <div class="cell-title">${frappe.utils.escape_html(it.title)}</div>
                        ${it.use_location ? `<div class="cell-sub"><span class="loc-tag">📍 ${frappe.utils.escape_html(it.use_location)}</span></div>` : ''}
                    </td>
                    <td><span class="cell-company">${frappe.utils.escape_html(it.company || '—')}</span></td>
                    <td><span class="cell-date">${it.last_done_date || '—'}</span></td>
                    <td style="text-align: center;"><span class="cycle-tag">${it.cycle_months} 个月</span></td>
                    <td><b class="cell-date cell-due">${it.next_due_date || '—'}</b></td>
                    <td style="text-align: center;">${remainingBadge}</td>
                    <td style="text-align: center;">${reportCell}</td>
                    <td>
                        <div>${it.responsible_person ? `<span class="user-tag">👤 ${frappe.utils.escape_html(it.responsible_person)}</span>` : '<span class="text-muted">—</span>'}</div>
                    </td>
                    <td style="text-align: center;">
                        ${rowActions}
                    </td>
                </tr>
                `;
            } else {
                rowHtml = `
                <tr class="env-row" data-name="${it.name}">
                    <td style="text-align: center;">${statusBadge}</td>
                    <td>
                        <div class="cell-title">${frappe.utils.escape_html(it.title)}</div>
                        ${it.use_location ? `<div class="cell-sub"><span class="loc-tag">📍 ${frappe.utils.escape_html(it.use_location)}</span></div>` : ''}
                    </td>
                    <td style="text-align: center;"><span class="type-tag tag-${self.get_type_class(it.env_type)}">${frappe.utils.escape_html(it.env_type)}</span></td>
                    <td><span class="cell-company">${frappe.utils.escape_html(it.company || '—')}</span></td>
                    <td><span class="cell-date">${it.last_done_date || '—'}</span></td>
                    <td style="text-align: center;"><span class="cycle-tag">${it.cycle_months} 个月</span></td>
                    <td><b class="cell-date cell-due">${it.next_due_date || '—'}</b></td>
                    <td style="text-align: center;">${remainingBadge}</td>
                    <td style="text-align: center;">${reportCell}</td>
                    <td>
                        <div>${it.responsible_person ? `<span class="user-tag">👤 ${frappe.utils.escape_html(it.responsible_person)}</span>` : '<span class="text-muted">—</span>'}</div>
                    </td>
                    <td style="text-align: center;">
                        ${rowActions}
                    </td>
                </tr>
                `;
            }

            const $row = $(rowHtml);

            // 绑定行内按钮事件 (阻止事件冒泡到行点击)
            $row.find('.btn-record-action').on('click', function(e) {
                e.stopPropagation();
                const name = $(this).attr('data-name');
                self.open_record_action_dialog(name);
            });

            $row.find('.btn-edit-item').on('click', function(e) {
                e.stopPropagation();
                const name = $(this).attr('data-name');
                self.open_edit_dialog(name);
            });

            $row.find('.btn-upload-report').on('click', function(e) {
                e.stopPropagation();
                const name = $(this).attr('data-name');
                self.open_upload_report_dialog(name);
            });

            $row.find('.report-link').on('click', function(e) {
                e.stopPropagation();
            });

            // 点击整行查看详情弹窗
            $row.on('click', function() {
                self.open_detail_dialog(it);
            });

            $tbody.append($row);
        });
    }

    // ─── 徽章与标签辅助函数 ───────────────────────────────────
    get_status_badge(status, days) {
        if (status === '已逾期') {
            return `<span class="env-badge badge-overdue">🔴 已逾期</span>`;
        } else if (status === '今日到期') {
            return `<span class="env-badge badge-today">🚨 今日到期</span>`;
        } else if (status === '即将到期') {
            return `<span class="env-badge badge-warning">🟠 即将到期</span>`;
        } else if (status === '注意') {
            return `<span class="env-badge badge-notice">🟡 注意</span>`;
        } else {
            return `<span class="env-badge badge-normal">🟢 正常</span>`;
        }
    }

    get_remaining_badge(days) {
        if (days < 0) {
            return `<span class="rem-badge rem-overdue">逾期 ${Math.abs(days)} 天</span>`;
        } else if (days === 0) {
            return `<span class="rem-badge rem-today">今天到期</span>`;
        } else if (days <= 30) {
            return `<span class="rem-badge rem-warning">剩余 ${days} 天</span>`;
        } else if (days <= 60) {
            return `<span class="rem-badge rem-notice">剩余 ${days} 天</span>`;
        } else {
            return `<span class="rem-badge rem-normal">${days} 天</span>`;
        }
    }

    get_report_cell(it) {
        if (it.latest_report) {
            return `
                <div class="report-box">
                    <a href="${frappe.utils.escape_html(it.latest_report)}" target="_blank" class="report-link" title="点击预览/下载报告">
                        📄 已上传
                    </a>
                </div>
            `;
        } else if (it.can_write) {
            return `
                <button class="btn-report-pending btn-upload-report" data-name="${it.name}" title="点击快速上传报告">
                    ⚠️ 待上传
                </button>
            `;
        }
        return '<span class="text-muted">未上传</span>';
    }

    get_type_class(env_type) {
        if (env_type === '废气') return 'gas';
        if (env_type === '废水') return 'water';
        if (env_type === '噪声') return 'noise';
        if (env_type === '危废') return 'waste';
        return 'other';
    }

    // ─── 弹窗 1: 登记本次检测 / 本次危废处理 ─────────────────
    open_record_action_dialog(name) {
        const self = this;
        const it = (this.data?.items || []).find(x => x.name === name);
        if (!it) return;
        if (!it.can_write) {
            frappe.msgprint('当前账号仅可查看该事项。');
            return;
        }

        const isWaste = (it.env_type === '危废');
        const titleText = isWaste ? `🛢️ 登记本次危废处理 — ${it.title}` : `🧪 登记本次环保检测 — ${it.title}`;
        const dateLabel = isWaste ? '本次处理/转移日期' : '本次检测日期';
        const fileLabel = isWaste ? '危废转移联单/处置凭证' : '检测报告附件 (PDF/图片)';

        const dlg = new frappe.ui.Dialog({
            title: titleText,
            static: true,
            fields: [
                {
                    fieldtype: 'HTML',
                    fieldname: 'info_html',
                    options: `
                        <div class="dlg-info-card">
                            <div class="dlg-row"><span>事项名称:</span> <b>${frappe.utils.escape_html(it.title)}</b></div>
                            <div class="dlg-row"><span>所属公司:</span> <b>${frappe.utils.escape_html(it.company)}</b></div>
                            <div class="dlg-row"><span>上次记录日期:</span> <b>${it.last_done_date || '—'}</b></div>
                            <div class="dlg-row"><span>当前周期:</span> <b>${it.cycle_months} 个月</b></div>
                        </div>
                    `
                },
                {
                    fieldname: 'action_date',
                    fieldtype: 'Date',
                    label: dateLabel,
                    reqd: 1,
                    default: frappe.datetime.get_today()
                },
                {
                    fieldname: 'cycle_months',
                    fieldtype: 'Int',
                    label: '周期（月）',
                    reqd: 1,
                    default: it.cycle_months || 3
                },
                {
                    fieldname: 'latest_report',
                    fieldtype: 'Attach',
                    label: fileLabel
                },
                {
                    fieldname: 'remarks',
                    fieldtype: 'Small Text',
                    label: '本次处理备注'
                }
            ],
            primary_action_label: '确认完成并更新',
            primary_action(values) {
                frappe.call({
                    method: 'ashan_cn_procurement.ashan_cn_procurement.page.environmental_management.environmental_management.record_env_action',
                    args: {
                        name: it.name,
                        action_date: values.action_date,
                        cycle_months: values.cycle_months,
                        latest_report: values.latest_report || '',
                        remarks: values.remarks || ''
                    },
                    callback(r) {
                        if (r.message?.success) {
                            frappe.show_alert({ message: r.message.message, indicator: 'green' }, 4);
                            dlg.hide();
                            self.load_dashboard();
                        }
                    }
                });
            }
        });
        dlg.set_secondary_action_label('关闭');
        dlg.set_secondary_action(() => dlg.hide());
        dlg.show();
        dlg.$wrapper.attr('data-backdrop', 'static').attr('data-keyboard', 'false');
    }

    // ─── 弹窗 2: 上传/补录报告附件 ───────────────────────────
    open_upload_report_dialog(name) {
        const self = this;
        const it = (this.data?.items || []).find(x => x.name === name);
        if (!it) return;
        if (!it.can_write) {
            frappe.msgprint('当前账号仅可查看该事项。');
            return;
        }

        const isWaste = (it.env_type === '危废');
        const fileLabel = isWaste ? '危废转移凭证文件' : '环保检测报告 (PDF/图片)';

        const dlg = new frappe.ui.Dialog({
            title: `📄 上传报告凭证 — ${it.title}`,
            static: true,
            fields: [
                {
                    fieldtype: 'HTML',
                    fieldname: 'info_html',
                    options: `
                        <div class="dlg-info-card">
                            <div><strong>${frappe.utils.escape_html(it.title)}</strong> (${frappe.utils.escape_html(it.company)})</div>
                            <div class="text-muted" style="margin-top:4px; font-size:12px;">上次检测/处理日期: ${it.last_done_date || '—'}</div>
                        </div>
                    `
                },
                {
                    fieldname: 'latest_report',
                    fieldtype: 'Attach',
                    label: fileLabel,
                    reqd: 1
                }
            ],
            primary_action_label: '保存并标记为已上传',
            primary_action(values) {
                if (!values.latest_report) {
                    frappe.msgprint('请先选择文件！');
                    return;
                }
                frappe.call({
                    method: 'ashan_cn_procurement.ashan_cn_procurement.page.environmental_management.environmental_management.upload_env_report',
                    args: {
                        name: it.name,
                        latest_report: values.latest_report
                    },
                    callback(r) {
                        if (r.message?.success) {
                            frappe.show_alert({ message: '报告已成功上传！', indicator: 'green' }, 3);
                            dlg.hide();
                            self.load_dashboard();
                        }
                    }
                });
            }
        });
        dlg.set_secondary_action_label('关闭');
        dlg.set_secondary_action(() => dlg.hide());
        dlg.show();
        dlg.$wrapper.attr('data-backdrop', 'static').attr('data-keyboard', 'false');
    }

    // ─── 弹窗 3: 快捷新建环保/危废事项 ───────────────────────
    open_quick_create_dialog() {
        const self = this;
        if (!this.data?.can_create) {
            frappe.msgprint('当前账号没有新建环保事项的权限。');
            return;
        }
        const isWaste = (this.currentTab === 'waste');

        const defaultType = isWaste ? '危废' : '废气';
        const typeOptions = isWaste ? '危废' : '废气\n废水\n噪声\n其他';
        const defaultCycle = isWaste ? 6 : 3;

        const dlg = new frappe.ui.Dialog({
            title: isWaste ? '➕ 新增危废管理事项' : '➕ 新增环保定期检测项目',
            static: true,
            fields: [
                {
                    fieldname: 'title',
                    fieldtype: 'Data',
                    label: '事项/项目名称',
                    reqd: 1,
                    placeholder: isWaste ? '如：危险废物转移、废机油处置' : '如：有组织废气检测、生活废水检测'
                },
                {
                    fieldname: 'company',
                    fieldtype: 'Link',
                    options: 'Company',
                    label: '所属公司',
                    reqd: 1,
                    default: frappe.defaults.get_default('Company') || (self.data?.companies?.[0] || '')
                },
                {
                    fieldname: 'env_type',
                    fieldtype: 'Select',
                    options: typeOptions,
                    label: '事项类型',
                    reqd: 1,
                    default: defaultType
                },
                {
                    fieldname: 'use_location',
                    fieldtype: 'Data',
                    label: '监测点位 / 产生车间地点',
                    placeholder: '如：1号烟囱排气口、危废暂存间'
                },
                {
                    fieldtype: 'Section Break',
                    label: '周期与日期配置'
                },
                {
                    fieldname: 'last_done_date',
                    fieldtype: 'Date',
                    label: isWaste ? '上次处理日期' : '上次检测日期',
                    reqd: 1,
                    default: frappe.datetime.get_today()
                },
                {
                    fieldname: 'cycle_months',
                    fieldtype: 'Int',
                    label: '周期（月）',
                    reqd: 1,
                    default: defaultCycle,
                    description: '如每年检测 4 次填 3，每年 2 次填 6，每年 1 次填 12'
                },
                {
                    fieldname: 'reminder_days',
                    fieldtype: 'Int',
                    label: '提前提醒天数',
                    default: 30
                },
                {
                    fieldname: 'responsible_person',
                    fieldtype: 'Data',
                    label: '责任人姓名',
                    placeholder: '如：张工'
                },
                {
                    fieldname: 'latest_report',
                    fieldtype: 'Attach',
                    label: '报告附件 / 转移凭证 (选填)'
                },
                {
                    fieldname: 'remarks',
                    fieldtype: 'Small Text',
                    label: '备注说明'
                }
            ],
            primary_action_label: '保存并加入台账',
            primary_action(values) {
                frappe.call({
                    method: 'ashan_cn_procurement.ashan_cn_procurement.page.environmental_management.environmental_management.quick_create_env_item',
                    args: {
                        title: values.title,
                        company: values.company,
                        env_type: values.env_type,
                        last_done_date: values.last_done_date,
                        cycle_months: values.cycle_months,
                        reminder_days: values.reminder_days,
                        responsible_person: values.responsible_person || '',
                        use_location: values.use_location || '',
                        remarks: values.remarks || '',
                        latest_report: values.latest_report || ''
                    },
                    callback(r) {
                        if (r.message?.success) {
                            frappe.show_alert({ message: r.message.message, indicator: 'green' }, 4);
                            dlg.hide();
                            self.load_dashboard();
                        }
                    }
                });
            }
        });
        dlg.set_secondary_action_label('关闭');
        dlg.set_secondary_action(() => dlg.hide());
        dlg.show();
        dlg.$wrapper.attr('data-backdrop', 'static').attr('data-keyboard', 'false');
    }

    // ─── 弹窗 4: 编辑环保/危废事项 ───────────────────────────
    open_edit_dialog(name) {
        const self = this;
        const it = (this.data?.items || []).find(x => x.name === name);
        if (!it) return;
        if (!it.can_write) {
            frappe.msgprint('当前账号仅可查看该事项。');
            return;
        }

        const isWaste = (it.env_type === '危废');
        const typeOptions = '废气\n废水\n噪声\n其他\n危废';

        const dlg = new frappe.ui.Dialog({
            title: `✏️ 编辑环保事项 — ${it.title}`,
            static: true,
            fields: [
                {
                    fieldname: 'title',
                    fieldtype: 'Data',
                    label: '事项名称',
                    reqd: 1,
                    default: it.title
                },
                {
                    fieldname: 'company',
                    fieldtype: 'Link',
                    options: 'Company',
                    label: '所属公司',
                    reqd: 1,
                    default: it.company
                },
                {
                    fieldname: 'env_type',
                    fieldtype: 'Select',
                    options: typeOptions,
                    label: '类型',
                    reqd: 1,
                    default: it.env_type
                },
                {
                    fieldname: 'use_location',
                    fieldtype: 'Data',
                    label: '监测点位/地点',
                    default: it.use_location || ''
                },
                {
                    fieldtype: 'Section Break',
                    label: '周期配置'
                },
                {
                    fieldname: 'last_done_date',
                    fieldtype: 'Date',
                    label: '上次检测/处理日期',
                    reqd: 1,
                    default: it.last_done_date
                },
                {
                    fieldname: 'cycle_months',
                    fieldtype: 'Int',
                    label: '周期（月）',
                    reqd: 1,
                    default: it.cycle_months
                },
                {
                    fieldname: 'reminder_days',
                    fieldtype: 'Int',
                    label: '提前提醒天数',
                    default: it.reminder_days || 30
                },
                {
                    fieldname: 'responsible_person',
                    fieldtype: 'Data',
                    label: '责任人姓名',
                    default: it.responsible_person || ''
                },
                {
                    fieldname: 'remarks',
                    fieldtype: 'Small Text',
                    label: '备注说明',
                    default: it.remarks || ''
                }
            ],
            primary_action_label: '保存修改',
            primary_action(values) {
                frappe.call({
                    method: 'ashan_cn_procurement.ashan_cn_procurement.page.environmental_management.environmental_management.quick_update_env_item',
                    args: {
                        name: it.name,
                        title: values.title,
                        company: values.company,
                        env_type: values.env_type,
                        last_done_date: values.last_done_date,
                        cycle_months: values.cycle_months,
                        reminder_days: values.reminder_days,
                        responsible_person: values.responsible_person || '',
                        use_location: values.use_location || '',
                        remarks: values.remarks || '',
                        is_active: 1
                    },
                    callback(r) {
                        if (r.message?.success) {
                            frappe.show_alert({ message: r.message.message, indicator: 'green' }, 3);
                            dlg.hide();
                            self.load_dashboard();
                        }
                    }
                });
            }
        });
        dlg.set_secondary_action_label('关闭');
        dlg.set_secondary_action(() => dlg.hide());
        dlg.show();
        dlg.$wrapper.attr('data-backdrop', 'static').attr('data-keyboard', 'false');
    }

    // ─── 弹窗 5: 点击整行快速查看与处理 ──────────────────────
    open_detail_dialog(it) {
        const self = this;
        const isWaste = (it.env_type === '危废');
        const actionBtnLabel = isWaste ? '📝 登记本次处理' : '📝 登记本次检测';

        const dlg = new frappe.ui.Dialog({
            title: `📋 事项明细 — ${it.title}`,
            fields: [
                {
                    fieldtype: 'HTML',
                    fieldname: 'detail_html',
                    options: `
                        <div class="dlg-detail-box">
                            <div class="dlg-detail-header">
                                <span class="dlg-detail-title">${frappe.utils.escape_html(it.title)}</span>
                                ${self.get_status_badge(it.status, it.days_remaining)}
                            </div>
                            <div class="dlg-detail-grid">
                                <div class="grid-item"><span class="label">所属公司:</span> <b>${frappe.utils.escape_html(it.company)}</b></div>
                                <div class="grid-item"><span class="label">事项类型:</span> <b>${frappe.utils.escape_html(it.env_type)}</b></div>
                                <div class="grid-item"><span class="label">点位/车间:</span> <b>${frappe.utils.escape_html(it.use_location || '—')}</b></div>
                                <div class="grid-item"><span class="label">检测周期:</span> <b>${it.cycle_months} 个月</b></div>
                                <div class="grid-item"><span class="label">上次日期:</span> <b>${it.last_done_date || '—'}</b></div>
                                <div class="grid-item"><span class="label">下次到期:</span> <b class="cell-due">${it.next_due_date || '—'}</b></div>
                                <div class="grid-item"><span class="label">到期状态:</span> ${self.get_remaining_badge(it.days_remaining)}</div>
                                <div class="grid-item"><span class="label">责任人:</span> <b>${frappe.utils.escape_html(it.responsible_person || '—')}</b></div>
                                <div class="grid-item full-width"><span class="label">最新报告:</span> ${self.get_report_cell(it)}</div>
                                ${it.remarks ? `<div class="grid-item full-width"><span class="label">备注说明:</span> <div class="remarks-text">${frappe.utils.escape_html(it.remarks)}</div></div>` : ''}
                            </div>
                        </div>
                    `
                }
            ],
            primary_action_label: it.can_write ? actionBtnLabel : undefined,
            primary_action() {
                if (it.can_write) {
                    dlg.hide();
                    self.open_record_action_dialog(it.name);
                }
            },
            secondary_action_label: it.can_write ? '编辑配置' : '关闭',
            secondary_action() {
                if (it.can_write) {
                    dlg.hide();
                    self.open_edit_dialog(it.name);
                } else {
                    dlg.hide();
                }
            }
        });
        dlg.show();
    }
}
