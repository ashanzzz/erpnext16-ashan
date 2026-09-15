// Copyright (c) 2026, Ashan and contributors
// For license information, please see license.txt

frappe.pages['payroll-settlement-workbench'].on_page_load = function(wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: '',
        single_column: true
    });

    frappe.payroll_workbench = new AshanPayrollWorkbench(wrapper, page);
};

frappe.pages['payroll-settlement-workbench'].on_page_show = function(wrapper) {
    if (frappe.payroll_workbench && typeof frappe.payroll_workbench.load_payroll === 'function') {
        frappe.payroll_workbench.load_payroll();
    }
};

class AshanPayrollWorkbench {
    constructor(wrapper, page) {
        this.wrapper = $(wrapper);
        this.page = page;
        const today = new Date();
        this.currentCompany = '';
        this.currentPeriod = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
        this.taxCycleStartMonth = `${today.getFullYear()}-01`;
        this.companyOptions = [];

        this.currentView = 'summary'; // summary | attendance | insurance | tax | cash
        this.data = null;
        this._autoSaveTimer = null;
        this._lastSavedTime = null;

        this.load_context();
    }

    fmtMoney(value, fractionDigits = 2) {
        const amount = Number(value || 0);
        if (fractionDigits === 2 && window.AshanUI?.formatMoney) {
            return window.AshanUI.formatMoney(amount);
        }
        return `¥ ${amount.toLocaleString('zh-CN', {
            minimumFractionDigits: fractionDigits,
            maximumFractionDigits: fractionDigits,
        })}`;
    }

    escapeHtml(value) {
        return $('<div>').text(String(value || '')).html();
    }

    getYearOptions() {
        const activeYear = Number(this.currentPeriod.split('-')[0]);
        const currentYear = new Date().getFullYear();
        return [...new Set([currentYear - 1, currentYear, currentYear + 1, activeYear])]
            .sort((left, right) => left - right);
    }

    getTaxCycleMonthOptions() {
        const [year] = this.currentPeriod.split('-').map(Number);
        const months = [];
        for (let month = 1; month <= 12; month += 1) {
            months.push(`${year}-${String(month).padStart(2, '0')}`);
        }
        return [`${year - 1}-12`, ...months];
    }

    load_context() {
        frappe.call({
            method: 'ashan_cn_procurement.ashan_cn_procurement.page.payroll_settlement_workbench.payroll_settlement_workbench.get_payroll_workbench_context',
            type: 'GET',
            callback: (response) => {
                const context = response.message;
                if (!context?.default_company) {
                    frappe.msgprint('未取得当前账号的薪酬公司范围。');
                    return;
                }
                this.companyOptions = context.companies || [];
                this.currentCompany = context.default_company;
                this.currentPeriod = context.default_period || this.currentPeriod;
                this.taxCycleStartMonth = context.default_tax_cycle_start_month || this.taxCycleStartMonth;
                this.init_dom();
                this.bind_events();
                this.load_data();
            },
        });
    }

    init_dom() {
        this.page.main.empty();

        const [yStr, mStr] = this.currentPeriod.split('-');

        const domHtml = `
            <div class="payroll-workbench-wrapper">
                <!-- 1. 严格统一单行全能控制栏 -->
                <div class="payroll-unified-header-bar">
                    <div class="payroll-header-left">
                        <div class="payroll-header-title">👥 人事与薪酬月结</div>
                        <div class="payroll-save-status-capsule draft" id="payroll-status-capsule">
                            <span class="status-dot">🟡</span> <span class="status-text">草稿录入中</span>
                        </div>
                    </div>

                    <div class="payroll-header-center">
                        <!-- 年月胶囊 -->
                        <div class="payroll-period-capsule">
                            <button type="button" class="payroll-period-nav-btn" id="btn-prev-month" title="上个月">‹</button>
                            <select class="payroll-period-select" id="sel-year">
                                ${this.getYearOptions().map(year => `
                                    <option value="${year}" ${String(year) === yStr ? 'selected' : ''}>${year}年</option>
                                `).join('')}
                            </select>
                            <select class="payroll-period-select" id="sel-month">
                                ${Array.from({length:12}, (_,i)=>String(i+1).padStart(2,'0')).map(m=>`
                                    <option value="${m}" ${m===mStr?'selected':''}>${m}月</option>
                                `).join('')}
                            </select>
                            <button type="button" class="payroll-period-nav-btn" id="btn-next-month" title="下个月">›</button>
                        </div>

                        <!-- 个税计税起始月份胶囊 (支持手动灵活设定) -->
                        <div class="payroll-period-capsule" style="background:#fef3c7;border-color:#fde68a;" title="可手动设定个税计税累计起始月份">
                            <span style="font-size:11px;font-weight:700;color:#92400e;padding:0 2px;">🏛️ 个税起始:</span>
                            <select class="payroll-period-select" id="sel-tax-start-month" style="color:#92400e;font-weight:700;">
                                ${this.getTaxCycleMonthOptions().map(month => `
                                    <option value="${month}" ${month === this.taxCycleStartMonth ? 'selected' : ''}>${month}</option>
                                `).join('')}
                            </select>
                        </div>

                        <!-- 公司范围由当前账号的授权上下文动态提供。 -->
                        <div class="payroll-company-tabs" id="payroll-comp-tabs">
                            <select class="payroll-period-select" id="sel-payroll-company">
                                ${this.companyOptions.map(company => {
                                    const companyName = this.escapeHtml(company.name);
                                    const companyLabel = this.escapeHtml(company.company_name || company.name);
                                    return `<option value="${companyName}" ${company.name === this.currentCompany ? 'selected' : ''}>${companyLabel}</option>`;
                                }).join('')}
                            </select>
                        </div>
                    </div>

                    <div class="payroll-header-right">
                        <!-- 祺富专属：导入老板娘工资表 -->
                        <button type="button" class="payroll-btn-compact payroll-btn-warning" id="btn-import-boss-sheet" style="display:none;">
                            📥 导入老板娘工资表
                        </button>
                        <button type="button" class="payroll-btn-compact payroll-btn-primary" id="btn-export-excel">
                            📥 导出 1:1 Excel
                        </button>
                        <button type="button" class="payroll-btn-compact payroll-btn-secondary" id="btn-print-a4">
                            🖨️ A4签收单
                        </button>
                        <button type="button" class="payroll-btn-compact payroll-btn-secondary" id="btn-print-envelope">
                            ✉️ 信封工资条
                        </button>
                        <button type="button" class="payroll-btn-compact payroll-btn-secondary" id="btn-manual-save">
                            💾 保存草稿
                        </button>
                        <button type="button" class="payroll-btn-compact payroll-btn-success" id="btn-finalize">
                            ✅ 核定锁定
                        </button>
                    </div>
                </div>

                <!-- 2. KPI 汇总看板 -->
                <div class="payroll-kpi-grid" id="payroll-kpi-container">
                    <!-- 动态渲染 -->
                </div>

                <!-- 3. 分段选项卡 (≤4选项 1次点击即达) -->
                <div class="payroll-view-segmented-tabs" id="payroll-view-tabs">
                    <div class="payroll-view-tab active" data-view="summary">📊 工资核定总表 (全明细)</div>
                    <div class="payroll-view-tab" data-view="attendance">📅 考勤与工时明细</div>
                    <div class="payroll-view-tab" data-view="insurance">🛡️ 五险一金核算</div>
                    <div class="payroll-view-tab" data-view="tax">🏛️ 个人所得税累计</div>
                    <div class="payroll-view-tab" data-view="cash">💵 现金零钞配钞表</div>
                    <div class="payroll-view-tab" data-view="workflow" style="background:#e0f2fe;color:#0369a1;font-weight:700;">🧭 业务操作流程导图</div>
                </div>

                <!-- 4. 数据表格容器 -->
                <div class="payroll-table-container" id="payroll-table-container">
                    <!-- 动态渲染数据表格 -->
                </div>
            </div>
        `;

        this.page.main.html(domHtml);
    }

    bind_events() {
        const self = this;

        // 年月切换
        this.page.main.find('#sel-year, #sel-month').on('change', function() {
            const y = self.page.main.find('#sel-year').val();
            const m = self.page.main.find('#sel-month').val();
            self.currentPeriod = `${y}-${m}`;
            self.load_data();
        });

        // 个税计税起始月份切换
        this.page.main.find('#sel-tax-start-month').on('change', function() {
            self.taxCycleStartMonth = $(this).val();
            self.load_data();
        });

        this.page.main.find('#btn-prev-month').on('click', function() {
            self.shift_month(-1);
        });

        this.page.main.find('#btn-next-month').on('click', function() {
            self.shift_month(1);
        });

        // 公司切换
        this.page.main.find('#sel-payroll-company').on('change', function() {
            self.currentCompany = $(this).val();

            // 切换老板娘工资表导入按钮的可见性
            const $btn = self.page.main.find('#btn-import-boss-sheet');
            if (self.currentCompany.includes('祺富')) {
                $btn.removeClass('hidden').show();
            } else {
                $btn.addClass('hidden').hide();
            }
            self.load_data();
        });

        // 视图分段选项卡切换 (1次点击即达)
        this.page.main.find('#payroll-view-tabs .payroll-view-tab').on('click', function() {
            self.page.main.find('#payroll-view-tabs .payroll-view-tab').removeClass('active');
            $(this).addClass('active');
            self.currentView = $(this).attr('data-view');
            self.render_view_table();
        });

        // 导入老板娘工资表
        this.page.main.find('#btn-import-boss-sheet').on('click', function() {
            self.open_boss_sheet_upload_dialog();
        });

        // 导出 Excel
        this.page.main.find('#btn-export-excel').on('click', function() {
            self.download_excel();
        });

        // 打印 A4
        this.page.main.find('#btn-print-a4').on('click', function() {
            self.open_print_preview_dialog('A4');
        });

        // 打印信封
        this.page.main.find('#btn-print-envelope').on('click', function() {
            self.open_print_preview_dialog('Envelope');
        });

        // 手动保存
        this.page.main.find('#btn-manual-save').on('click', function() {
            self.auto_save_settlement(true);
        });

        // 核定锁定
        this.page.main.find('#btn-finalize').on('click', function() {
            self.open_finalize_confirm();
        });
    }

    shift_month(offset) {
        let [y, m] = this.currentPeriod.split('-').map(Number);
        m += offset;
        if (m < 1) { m = 12; y -= 1; }
        else if (m > 12) { m = 1; y += 1; }
        const mStr = String(m).padStart(2, '0');
        this.currentPeriod = `${y}-${mStr}`;
        this.page.main.find('#sel-year').val(String(y));
        this.page.main.find('#sel-month').val(mStr);
        this.load_data();
    }

    load_data() {
        const self = this;
        frappe.call({
            method: 'ashan_cn_procurement.ashan_cn_procurement.page.payroll_settlement_workbench.payroll_settlement_workbench.get_payroll_workbench_data',
            args: {
                period_month: self.currentPeriod,
                company: self.currentCompany,
                tax_cycle_start_month: self.taxCycleStartMonth
            },
            callback(r) {
                if (r.message) {
                    self.data = r.message;
                    if (r.message.tax_cycle_start_month) {
                        self.taxCycleStartMonth = r.message.tax_cycle_start_month;
                        self.page.main.find('#sel-tax-start-month').val(self.taxCycleStartMonth);
                    }
                    self.render_all();
                }
            }
        });
    }

    render_all() {
        this.render_status_capsule();
        this.render_kpi_cards();
        this.render_view_table();
    }

    render_status_capsule() {
        const $cap = this.page.main.find('#payroll-status-capsule');
        const isLocked = (this.data?.status === '已核定锁定');

        if (isLocked) {
            $cap.attr('class', 'payroll-save-status-capsule locked')
                .html(`<span class="status-dot">🔒</span> <span class="status-text">已核定锁定</span>`);
        } else if (this._lastSavedTime) {
            $cap.attr('class', 'payroll-save-status-capsule saved')
                .html(`<span class="status-dot">🟢</span> <span class="status-text">已自动保存 ${this._lastSavedTime}</span>`);
        } else {
            $cap.attr('class', 'payroll-save-status-capsule draft')
                .html(`<span class="status-dot">🟡</span> <span class="status-text">草稿录入中</span>`);
        }
    }

    render_kpi_cards() {
        const sum = this.data?.summary || {};

        const html = `
            <div class="payroll-kpi-card">
                <div class="payroll-kpi-label">👥 计薪人数</div>
                <div class="payroll-kpi-value">${sum.headcount || 0} <span style="font-size:12px;color:#64748b;font-weight:400;">人</span></div>
            </div>
            <div class="payroll-kpi-card">
                <div class="payroll-kpi-label">💰 应发薪资总额</div>
                <div class="payroll-kpi-value gross">¥ ${(sum.total_gross_pay || 0).toLocaleString('zh-CN', {minimumFractionDigits: 2})}</div>
            </div>
            <div class="payroll-kpi-card">
                <div class="payroll-kpi-label">🛡️ 五险一金个人扣缴</div>
                <div class="payroll-kpi-value">¥ ${((sum.total_social_security_p || 0) + (sum.total_housing_fund_p || 0)).toLocaleString('zh-CN', {minimumFractionDigits: 2})}</div>
            </div>
            <div class="payroll-kpi-card">
                <div class="payroll-kpi-label">🏛️ 代扣个税总额</div>
                <div class="payroll-kpi-value tax">¥ ${(sum.total_individual_tax || 0).toLocaleString('zh-CN', {minimumFractionDigits: 2})}</div>
            </div>
            <div class="payroll-kpi-card">
                <div class="payroll-kpi-label">💵 实发工资总额</div>
                <div class="payroll-kpi-value net">¥ ${(sum.total_net_pay || 0).toLocaleString('zh-CN', {minimumFractionDigits: 2})}</div>
            </div>
            <div class="payroll-kpi-card">
                <div class="payroll-kpi-label">🏢 企业人工总成本</div>
                <div class="payroll-kpi-value cost">¥ ${(sum.total_company_cost || 0).toLocaleString('zh-CN', {minimumFractionDigits: 2})}</div>
            </div>
        `;

        this.page.main.find('#payroll-kpi-container').html(html);
    }

    render_view_table() {
        const items = this.data?.items || [];
        const view = this.currentView;
        let html = '';

        if (view === 'summary') {
            html = this.render_summary_table_html(items);
        } else if (view === 'attendance') {
            html = this.render_attendance_table_html(items);
        } else if (view === 'insurance') {
            html = this.render_insurance_table_html(items);
        } else if (view === 'tax') {
            html = this.render_tax_table_html(items);
        } else if (view === 'cash') {
            html = this.render_cash_table_html(items);
        } else if (view === 'workflow') {
            html = this.render_workflow_map_html();
        }

        this.page.main.find('#payroll-table-container').html(html);
        this.bind_table_inputs();
        this.bind_workflow_clicks();
    }

    render_workflow_map_html() {
        const isQifu = this.currentCompany.includes('祺富');
        return `
            <div class="payroll-flow-container">
                <!-- 阶段 1: 业务模式对比与概览 -->
                <div class="payroll-flow-card" style="border-left: 4px solid #0284c7;">
                    <div class="payroll-flow-title">
                        🏢 ${this.currentCompany} · 薪酬与财税月结端到端业务流水线
                    </div>
                    <div style="font-size:12.5px;color:#475569;margin-bottom:16px;">
                        💡 本系统完整复刻并数字化重构了 Excel 宏业务模型。点击以下任意流水线节点，可直达对应数据台账进行查看与快速调整：
                    </div>

                    ${!isQifu ? `
                        <!-- 吉众流水线 -->
                        <div class="payroll-pipeline-grid">
                            <div class="payroll-step-node" data-target-view="attendance">
                                <div class="payroll-step-badge">1</div>
                                <div class="payroll-step-name">📅 法定日历与工时考勤</div>
                                <div class="payroll-step-desc">
                                    读取 365 天法定日历，自动计算当月满勤天数（如 21天/168h）与制度工时（172h），采集 1.5x/2.0x/3.0x 加班。
                                </div>
                            </div>
                            <div class="payroll-step-node" data-target-view="summary">
                                <div class="payroll-step-badge">2</div>
                                <div class="payroll-step-name">🧮 双模正反薪资核算</div>
                                <div class="payroll-step-desc">
                                    <b>动态正算法</b>：基本工时比例折算+加班+补贴+绩效+餐补。<br>
                                    <b>管理岗倒推法</b>：输入实发净工资，自动反推税前应发与个税。
                                </div>
                            </div>
                            <div class="payroll-step-node" data-target-view="insurance">
                                <div class="payroll-step-badge">3</div>
                                <div class="payroll-step-name">🛡️ 五险一金精确扣缴</div>
                                <div class="payroll-step-desc">
                                    社保个人 8%+2%+0.5%+21大额，企业承担 16%+10%+0.5%+0.5%+0.55%；公积金个人 5% + 企业 5%。
                                </div>
                            </div>
                            <div class="payroll-step-node" data-target-view="tax">
                                <div class="payroll-step-badge">4</div>
                                <div class="payroll-step-name">🏛️ 中国个税累计预扣法</div>
                                <div class="payroll-step-desc">
                                    支持手动指定计税起始月（如 2026-01 或 2025-12），累计 5000xN 免征额与专项扣除，按 7 级累进税率计税。
                                </div>
                            </div>
                            <div class="payroll-step-node" data-target-view="cash">
                                <div class="payroll-step-badge">5</div>
                                <div class="payroll-step-name">💵 现金零钞配钞与提现</div>
                                <div class="payroll-step-desc">
                                    将每位员工实发工资自动拆解为 100/50/20/10/5/1 元钞票张数清单与全公司提现汇总。
                                </div>
                            </div>
                            <div class="payroll-step-node" data-action="print-a4">
                                <div class="payroll-step-badge">6</div>
                                <div class="payroll-step-name">🖨️ 单证打印与 1:1 Excel</div>
                                <div class="payroll-step-desc">
                                    一键生成 A4 员工签收单、DL 信封工资条，并可流式导出完整 1:1 多 Sheet 薪酬台账 Excel。
                                </div>
                            </div>
                        </div>
                    ` : `
                        <!-- 祺富流水线 -->
                        <div class="payroll-pipeline-grid">
                            <div class="payroll-step-node" data-action="import-boss">
                                <div class="payroll-step-badge" style="background:#d97706;">1</div>
                                <div class="payroll-step-name">📥 老板娘工资表智能导入</div>
                                <div class="payroll-step-desc">
                                    一键上传车间发薪 Excel，系统自动识别并提取作业天数、天工资、全勤奖(100元)、加班费、达标工资、职位补贴与房车补。
                                </div>
                            </div>
                            <div class="payroll-step-node" data-target-view="summary">
                                <div class="payroll-step-badge" style="background:#d97706;">2</div>
                                <div class="payroll-step-name">⚖️ 发薪与记账双轨核定</div>
                                <div class="payroll-step-desc">
                                    <b>发薪轨</b>：天工资+全勤+达标+职位房车补-扣款 = 实发。<br>
                                    <b>记账轨</b>：合规申报税前收入，分离社保公积金扣缴。
                                </div>
                            </div>
                            <div class="payroll-step-node" data-target-view="insurance">
                                <div class="payroll-step-badge" style="background:#d97706;">3</div>
                                <div class="payroll-step-name">🛡️ 祺富社保与公积金核定</div>
                                <div class="payroll-step-desc">
                                    社保基数 5124 (个人扣 559.02)，公积金基数 2320 (个人扣 116.00)，企业承担分别入账。
                                </div>
                            </div>
                            <div class="payroll-step-node" data-target-view="tax">
                                <div class="payroll-step-badge" style="background:#d97706;">4</div>
                                <div class="payroll-step-name">🏛️ 自定义起始月个税计算</div>
                                <div class="payroll-step-desc">
                                    支持灵活配置个税起始月（如 2026-01 / 2025-12），年度累计预扣免征额与专项扣除。
                                </div>
                            </div>
                            <div class="payroll-step-node" data-target-view="cash">
                                <div class="payroll-step-badge" style="background:#d97706;">5</div>
                                <div class="payroll-step-name">💵 车间发薪现金配钞清单</div>
                                <div class="payroll-step-desc">
                                    自动拆解每位工人的现金实发金额为 100/50/20/10/5/1 元零钞张数，生成银行提现汇总。
                                </div>
                            </div>
                            <div class="payroll-step-node" data-action="export-excel">
                                <div class="payroll-step-badge" style="background:#d97706;">6</div>
                                <div class="payroll-step-name">📑 导出 1:1 Excel 记账台账</div>
                                <div class="payroll-step-desc">
                                    流式导出包含《工资核定总表》、《现金配钞表》的 1:1 标准 Excel 文件。
                                </div>
                            </div>
                        </div>
                    `}
                </div>
            </div>
        `;
    }

    bind_workflow_clicks() {
        const self = this;
        this.page.main.find('.payroll-step-node').on('click', function() {
            const targetView = $(this).attr('data-target-view');
            const action = $(this).attr('data-action');

            if (targetView) {
                self.page.main.find('#payroll-view-tabs .payroll-view-tab').removeClass('active');
                self.page.main.find(`#payroll-view-tabs .payroll-view-tab[data-view='${targetView}']`).addClass('active');
                self.currentView = targetView;
                self.render_view_table();
            } else if (action === 'print-a4') {
                self.open_print_preview_dialog('A4');
            } else if (action === 'import-boss') {
                self.open_boss_sheet_upload_dialog();
            } else if (action === 'export-excel') {
                self.download_excel();
            }
        });
    }

    render_summary_table_html(items) {
        const sum = this.data?.summary || {};
        const isQifu = this.currentCompany.includes('祺富');

        return `
            <table class="payroll-data-table">
                <thead>
                    <tr>
                        <th>序号</th>
                        <th>工号</th>
                        <th>姓名</th>
                        <th>计薪方式</th>
                        <th>${isQifu ? '天工资/标准' : '薪资标准'}</th>
                        <th>考勤(天)</th>
                        <th>基本工时</th>
                        <th>平日加班1.5x</th>
                        <th>周末加班2.0x</th>
                        <th>节日加班3.0x</th>
                        <th>工时/天工资</th>
                        <th>加班工资</th>
                        <th>${isQifu ? '全勤奖' : '基本补贴'}</th>
                        <th>${isQifu ? '达标工资' : '绩效奖金'}</th>
                        <th>${isQifu ? '职位/房车补' : '职位津贴'}</th>
                        <th>餐补</th>
                        <th>工资调整</th>
                        <th>应发薪资合计</th>
                        <th>社保个人p</th>
                        <th>公积金p</th>
                        <th>代扣个税</th>
                        <th>实发薪资合计</th>
                        <th>现金发放工资</th>
                    </tr>
                </thead>
                <tbody>
                    ${items.map((it, idx) => {
                        const extraAllow = isQifu
                            ? ((it.salary_position_allowance || 0) + (it.salary_housing_car_subsidy || 0))
                            : (it.salary_position_allowance || 0);
                        const mid1 = isQifu ? (it.salary_full_attendance || 0) : (it.salary_base_subsidy || 0);
                        const mid2 = isQifu ? (it.salary_performance_target || 0) : (it.salary_performance || 0);

                        return `
                            <tr>
                                <td class="center-cell">${idx + 1}</td>
                                <td class="center-cell" style="font-weight:700;">${it.employee_no || ''}</td>
                                <td class="center-cell" style="font-weight:700;">${it.employee_name || ''}</td>
                                <td class="center-cell"><span class="badge ${it.salary_mode==='税后管理工资'?'badge-primary':'badge-info'}">${it.salary_mode || '税前动态'}</span></td>
                                <td class="num-cell qifu-money-cell">${this.fmtMoney(it.base_salary || it.salary_piecework_daily || 0)}</td>
                                <td class="center-cell">${it.attendance_days || 0}</td>
                                <td class="center-cell">${it.work_hours_regular || 0}</td>
                                <td class="center-cell">${it.overtime_1_5 || 0}</td>
                                <td class="center-cell">${it.overtime_2_0 || 0}</td>
                                <td class="center-cell">${it.overtime_3_0 || 0}</td>
                                <td class="num-cell qifu-money-cell">${this.fmtMoney(it.salary_regular_hours || it.salary_piecework_daily || 0)}</td>
                                <td class="num-cell qifu-money-cell">${this.fmtMoney((it.salary_overtime_1_5 || 0) + (it.salary_overtime_2_0 || 0) + (it.salary_overtime_3_0 || 0))}</td>
                                <td class="num-cell qifu-money-cell">${this.fmtMoney(mid1)}</td>
                                <td class="num-cell qifu-money-cell">${this.fmtMoney(mid2)}</td>
                                <td class="num-cell qifu-money-cell">${this.fmtMoney(extraAllow)}</td>
                                <td class="num-cell qifu-money-cell">${this.fmtMoney(it.salary_meal_subsidy || 0)}</td>
                                <td class="center-cell">
                                    <input type="number" class="payroll-inline-input payroll-adjust-input" data-emp="${it.employee_no}" value="${it.salary_adjustment || 0}" step="10">
                                </td>
                                <td class="num-cell qifu-money-cell highlight-gross">${this.fmtMoney(it.gross_pay || 0)}</td>
                                <td class="num-cell qifu-money-cell" style="color:#b91c1c;">-${this.fmtMoney(it.social_security_p || 0)}</td>
                                <td class="num-cell qifu-money-cell" style="color:#b91c1c;">-${this.fmtMoney(it.housing_fund_p || 0)}</td>
                                <td class="num-cell qifu-money-cell" style="color:#d97706;">-${this.fmtMoney(it.individual_tax || 0)}</td>
                                <td class="num-cell qifu-money-cell highlight-net">${this.fmtMoney(it.net_pay || 0)}</td>
                                <td class="num-cell qifu-money-cell highlight-net">${this.fmtMoney(it.cash_pay || 0, 0)}</td>
                            </tr>
                        `;
                    }).join('')}
                    <tr style="background:#f1f5f9;font-weight:700;">
                        <td colspan="4" class="center-cell">全公司合计 (${items.length} 人)</td>
                        <td class="num-cell">—</td>
                        <td colspan="5" class="center-cell">—</td>
                        <td colspan="6" class="center-cell">—</td>
                        <td class="center-cell">—</td>
                        <td class="num-cell qifu-money-cell highlight-gross">${this.fmtMoney(sum.total_gross_pay || 0)}</td>
                        <td class="num-cell qifu-money-cell" style="color:#b91c1c;">-${this.fmtMoney(sum.total_social_security_p || 0)}</td>
                        <td class="num-cell qifu-money-cell" style="color:#b91c1c;">-${this.fmtMoney(sum.total_housing_fund_p || 0)}</td>
                        <td class="num-cell qifu-money-cell" style="color:#d97706;">-${this.fmtMoney(sum.total_individual_tax || 0)}</td>
                        <td class="num-cell qifu-money-cell highlight-net">${this.fmtMoney(sum.total_net_pay || 0)}</td>
                        <td class="num-cell qifu-money-cell highlight-net">${this.fmtMoney(sum.total_net_pay || 0, 0)}</td>
                    </tr>
                </tbody>
            </table>
        `;
    }

    render_attendance_table_html(items) {
        return `
            <table class="payroll-data-table">
                <thead>
                    <tr>
                        <th>序号</th>
                        <th>工号</th>
                        <th>姓名</th>
                        <th>出勤天数</th>
                        <th>基本工时 (h)</th>
                        <th>平日加班 1.5x (h)</th>
                        <th>周末加班 2.0x (h)</th>
                        <th>节日加班 3.0x (h)</th>
                        <th>餐补出勤 (次)</th>
                        <th>工时核算说明</th>
                    </tr>
                </thead>
                <tbody>
                    ${items.map((it, idx) => `
                        <tr>
                            <td class="center-cell">${idx + 1}</td>
                            <td class="center-cell" style="font-weight:700;">${it.employee_no}</td>
                            <td class="center-cell" style="font-weight:700;">${it.employee_name}</td>
                            <td class="center-cell">${it.attendance_days || 0} 天</td>
                            <td class="center-cell">${it.work_hours_regular || 0} h</td>
                            <td class="center-cell">${it.overtime_1_5 || 0} h</td>
                            <td class="center-cell">${it.overtime_2_0 || 0} h</td>
                            <td class="center-cell">${it.overtime_3_0 || 0} h</td>
                            <td class="center-cell">${it.attendance_days || 0} 次</td>
                            <td class="subtext">动态满勤基准: ${this.data?.full_work_hours || 168}h ｜ 加班基数: 172h</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    render_insurance_table_html(items) {
        return `
            <table class="payroll-data-table">
                <thead>
                    <tr>
                        <th>序号</th>
                        <th>工号</th>
                        <th>姓名</th>
                        <th>社保基数</th>
                        <th>养老(8%)</th>
                        <th>医疗(2%)</th>
                        <th>失业(0.5%)</th>
                        <th>大额医疗</th>
                        <th>社保个人小计</th>
                        <th>公积金基数</th>
                        <th>公积金个人(5%)</th>
                        <th>五险一金个人扣除</th>
                        <th>社保企业承担(c)</th>
                        <th>公积金企业承担(c)</th>
                        <th>五险一金总成本</th>
                    </tr>
                </thead>
                <tbody>
                    ${items.map((it, idx) => `
                        <tr>
                            <td class="center-cell">${idx + 1}</td>
                            <td class="center-cell" style="font-weight:700;">${it.employee_no}</td>
                            <td class="center-cell" style="font-weight:700;">${it.employee_name}</td>
                            <td class="num-cell qifu-money-cell">${this.fmtMoney(it.social_security_base || 0)}</td>
                            <td class="num-cell qifu-money-cell">${this.fmtMoney(it.ss_pension_p || 0)}</td>
                            <td class="num-cell qifu-money-cell">${this.fmtMoney(it.ss_medical_p || 0)}</td>
                            <td class="num-cell qifu-money-cell">${this.fmtMoney(it.ss_unemployment_p || 0)}</td>
                            <td class="num-cell qifu-money-cell">${this.fmtMoney(it.ss_large_medical_p || 0)}</td>
                            <td class="num-cell qifu-money-cell" style="font-weight:700;color:#b91c1c;">${this.fmtMoney(it.social_security_p || 0)}</td>
                            <td class="num-cell qifu-money-cell">${this.fmtMoney(it.housing_fund_base || 0)}</td>
                            <td class="num-cell qifu-money-cell" style="font-weight:700;color:#b91c1c;">${this.fmtMoney(it.housing_fund_p || 0)}</td>
                            <td class="num-cell qifu-money-cell highlight-gross">${this.fmtMoney(it.special_deduction_total || 0)}</td>
                            <td class="num-cell qifu-money-cell">${this.fmtMoney(it.social_security_c || 0)}</td>
                            <td class="num-cell qifu-money-cell">${this.fmtMoney(it.housing_fund_c || 0)}</td>
                            <td class="num-cell qifu-money-cell" style="font-weight:700;color:#475569;">${this.fmtMoney((it.social_security_p || 0) + (it.housing_fund_p || 0) + (it.social_security_c || 0) + (it.housing_fund_c || 0))}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    render_tax_table_html(items) {
        return `
            <table class="payroll-data-table">
                <thead>
                    <tr>
                        <th>序号</th>
                        <th>工号</th>
                        <th>姓名</th>
                        <th>当月税前收入</th>
                        <th>累计税前收入</th>
                        <th>累计免征额(5000xN)</th>
                        <th>累计五险一金(p)</th>
                        <th>累计专项附加扣除</th>
                        <th>累计应纳税所得额</th>
                        <th>累计应纳所得税</th>
                        <th>以往已缴所得税</th>
                        <th>当月应扣缴个税</th>
                        <th>实发税后工资</th>
                    </tr>
                </thead>
                <tbody>
                    ${items.map((it, idx) => `
                        <tr>
                            <td class="center-cell">${idx + 1}</td>
                            <td class="center-cell" style="font-weight:700;">${it.employee_no}</td>
                            <td class="center-cell" style="font-weight:700;">${it.employee_name}</td>
                            <td class="num-cell qifu-money-cell">${this.fmtMoney(it.gross_pay || 0)}</td>
                            <td class="num-cell qifu-money-cell">${this.fmtMoney(it.cum_gross_income || 0)}</td>
                            <td class="num-cell qifu-money-cell">${this.fmtMoney(it.cum_tax_exemption || 0)}</td>
                            <td class="num-cell qifu-money-cell">${this.fmtMoney(it.cum_special_deduction || 0)}</td>
                            <td class="num-cell qifu-money-cell">${this.fmtMoney(it.cum_additional_deduction || 0)}</td>
                            <td class="num-cell qifu-money-cell" style="font-weight:700;">${this.fmtMoney(it.cum_taxable_income || 0)}</td>
                            <td class="num-cell qifu-money-cell">${this.fmtMoney(it.cum_tax_due || 0)}</td>
                            <td class="num-cell qifu-money-cell">${this.fmtMoney(it.cum_tax_paid_prior || 0)}</td>
                            <td class="num-cell qifu-money-cell highlight-gross" style="color:#d97706;">${this.fmtMoney(it.individual_tax || 0)}</td>
                            <td class="num-cell qifu-money-cell highlight-net">${this.fmtMoney(it.net_pay || 0)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    render_cash_table_html(items) {
        const sum = this.data?.summary || {};
        const bills = sum.bills || {};
        return `
            <table class="payroll-data-table">
                <thead>
                    <tr>
                        <th>序号</th>
                        <th>工号</th>
                        <th>姓名</th>
                        <th>实发薪资</th>
                        <th>100元 (张)</th>
                        <th>50元 (张)</th>
                        <th>20元 (张)</th>
                        <th>10元 (张)</th>
                        <th>5元 (张)</th>
                        <th>1元 (张)</th>
                    </tr>
                </thead>
                <tbody>
                    ${items.map((it, idx) => `
                        <tr>
                            <td class="center-cell">${idx + 1}</td>
                            <td class="center-cell" style="font-weight:700;">${it.employee_no}</td>
                            <td class="center-cell" style="font-weight:700;">${it.employee_name}</td>
                            <td class="num-cell qifu-money-cell highlight-net">${this.fmtMoney(it.net_pay || 0)}</td>
                            <td class="num-cell">${it.bill_100 || 0}</td>
                            <td class="num-cell">${it.bill_50 || 0}</td>
                            <td class="num-cell">${it.bill_20 || 0}</td>
                            <td class="num-cell">${it.bill_10 || 0}</td>
                            <td class="num-cell">${it.bill_5 || 0}</td>
                            <td class="num-cell">${it.bill_1 || 0}</td>
                        </tr>
                    `).join('')}
                    <tr style="background:#f1f5f9;font-weight:700;">
                        <td colspan="3" class="center-cell">全公司提现配钞合计</td>
                        <td class="num-cell qifu-money-cell highlight-net">${this.fmtMoney(sum.total_net_pay || 0)}</td>
                        <td class="num-cell" style="color:#0284c7;">${bills.b100 || 0} 张</td>
                        <td class="num-cell" style="color:#0284c7;">${bills.b50 || 0} 张</td>
                        <td class="num-cell" style="color:#0284c7;">${bills.b20 || 0} 张</td>
                        <td class="num-cell" style="color:#0284c7;">${bills.b10 || 0} 张</td>
                        <td class="num-cell" style="color:#0284c7;">${bills.b5 || 0} 张</td>
                        <td class="num-cell" style="color:#0284c7;">${bills.b1 || 0} 张</td>
                    </tr>
                </tbody>
            </table>
        `;
    }

    bind_table_inputs() {
        const self = this;
        this.page.main.find('.payroll-adjust-input').on('change blur keyup', function(e) {
            if (e.type === 'keyup' && e.keyCode !== 13) return;
            const empNo = $(this).attr('data-emp');
            const val = parseFloat($(this).val() || 0);

            const item = (self.data?.items || []).find(i => i.employee_no === empNo);
            if (item) {
                item.salary_adjustment = val;
                clearTimeout(self._autoSaveTimer);
                self._autoSaveTimer = setTimeout(() => {
                    self.auto_save_settlement(false);
                }, 400);
            }
        });
    }

    auto_save_settlement(isManual = false) {
        const self = this;
        const $cap = this.page.main.find('#payroll-status-capsule');
        $cap.attr('class', 'payroll-save-status-capsule saving')
            .html(`<span class="status-dot">🔄</span> <span class="status-text">${isManual ? '正在保存...' : '正在自动保存...'}</span>`);

        self.data.tax_cycle_start_month = self.taxCycleStartMonth;

        frappe.call({
            method: 'ashan_cn_procurement.ashan_cn_procurement.page.payroll_settlement_workbench.payroll_settlement_workbench.save_payroll_settlement',
            type: 'POST',
            args: {
                data: JSON.stringify(self.data)
            },
            callback(r) {
                if (r.message?.success) {
                    const now = new Date();
                    self._lastSavedTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
                    self.render_status_capsule();
                    if (isManual) {
                        frappe.show_alert({ message: `薪资月结已成功保存 (${self._lastSavedTime})`, indicator: 'green' }, 3);
                    }
                }
            }
        });
    }

    open_boss_sheet_upload_dialog() {
        const self = this;
        const dlg = new frappe.ui.Dialog({
            title: '📥 上传并导入老板娘工资表 (祺富车间发薪)',
            fields: [
                {
                    fieldtype: 'HTML',
                    fieldname: 'help_info',
                    options: `
                        <div style="background:#f0fdf4;border:1px solid #bbf7d0;padding:10px 14px;border-radius:6px;margin-bottom:12px;font-size:12.5px;color:#166534;">
                            💡 <b>智能解析说明</b>：支持上传 <code>.xlsx</code> / <code>.xls</code> / <code>.xlsm</code> 表格。系统将自动智能识别并提取【作业天数、天工资、全勤奖、加班费、达标工资、职位补贴、房车补、扣除】等列，并与员工档案智能关联。
                        </div>
                    `
                },
                {
                    fieldtype: 'Attach',
                    fieldname: 'attach_file',
                    label: '选择老板娘工资表 Excel 文件',
                    reqd: 1
                }
            ],
            primary_action_label: '开始解析并导入',
            primary_action(values) {
                if (!values.attach_file) {
                    frappe.msgprint('请先选择要上传的 Excel 文件');
                    return;
                }

                frappe.show_alert({ message: '正在读取并智能解析老板娘工资表...', indicator: 'blue' }, 4);

                // 读取已上传的文件内容
                fetch(values.attach_file)
                    .then(res => res.blob())
                    .then(blob => {
                        const reader = new FileReader();
                        reader.onload = function(e) {
                            const base64Data = e.target.result;
                            frappe.call({
                                method: 'ashan_cn_procurement.ashan_cn_procurement.page.payroll_settlement_workbench.payroll_settlement_workbench.upload_boss_payroll_file',
                                type: 'POST',
                                args: {
                                    filedata: base64Data,
                                    filename: values.attach_file.split('/').pop(),
                                    period_month: self.currentPeriod,
                                    company: self.currentCompany
                                },
                                callback(r) {
                                    if (r.message?.success) {
                                        frappe.msgprint({
                                            title: '导入成功',
                                            message: r.message.message,
                                            indicator: 'green'
                                        });
                                        dlg.hide();
                                        self.load_data();
                                    }
                                }
                            });
                        };
                        reader.readAsDataURL(blob);
                    });
            }
        });

        dlg.show();
    }

    open_finalize_confirm() {
        const self = this;
        frappe.confirm(
            `<b>⚠️ 确定核定并锁定【${self.currentCompany}】${self.currentPeriod} 薪资？</b><br><br>锁定后将生成正式发放台账，防止被误篡改。`,
            () => {
                self.data.tax_cycle_start_month = self.taxCycleStartMonth;
                frappe.call({
                    method: 'ashan_cn_procurement.ashan_cn_procurement.page.payroll_settlement_workbench.payroll_settlement_workbench.finalize_payroll_settlement',
                    type: 'POST',
                    args: {
                        data: JSON.stringify(self.data)
                    },
                    callback(r) {
                        if (r.message?.success) {
                            frappe.show_alert({ message: '薪资已成功核定并锁定！', indicator: 'green' }, 4);
                            self.load_data();
                        }
                    }
                });
            }
        );
    }

    download_excel() {
        const url = `/api/method/ashan_cn_procurement.ashan_cn_procurement.page.payroll_settlement_workbench.payroll_settlement_workbench.export_payroll_excel?period_month=${encodeURIComponent(this.currentPeriod)}&company=${encodeURIComponent(this.currentCompany)}&tax_cycle_start_month=${encodeURIComponent(this.taxCycleStartMonth)}`;
        frappe.show_alert({ message: '正在生成 1:1 人事薪资台账 Excel...', indicator: 'blue' }, 3);
        window.location.href = url;
    }

    open_print_preview_dialog(mode = 'A4') {
        const self = this;
        frappe.call({
            method: 'ashan_cn_procurement.ashan_cn_procurement.page.payroll_settlement_workbench.payroll_settlement_workbench.get_payslip_print_data',
            args: {
                period_month: self.currentPeriod,
                company: self.currentCompany,
                mode: mode,
                tax_cycle_start_month: self.taxCycleStartMonth
            },
            callback(r) {
                if (r.message) {
                    self.show_print_modal(r.message);
                }
            }
        });
    }

    show_print_modal(printData) {
        const isA4 = (printData.mode === 'A4');
        const items = printData.items || [];

        const printHtml = isA4 ? `
            <div class="payroll-print-sheet" id="payroll-print-content">
                <div style="text-align:center;font-size:16px;font-weight:700;margin-bottom:12px;color:#0f172a;">
                    ${printData.company} ${printData.period_month} 员工工资发放签收单
                </div>
                <table class="payroll-data-table" style="width:100%;border:1px solid #000;">
                    <thead>
                        <tr style="background:#f1f5f9;">
                            <th style="border:1px solid #000;">序号</th>
                            <th style="border:1px solid #000;">工号</th>
                            <th style="border:1px solid #000;">姓名</th>
                            <th style="border:1px solid #000;">薪资标准</th>
                            <th style="border:1px solid #000;">出勤(天)</th>
                            <th style="border:1px solid #000;">加班(h)</th>
                            <th style="border:1px solid #000;">应发薪资</th>
                            <th style="border:1px solid #000;">社保p</th>
                            <th style="border:1px solid #000;">公积金p</th>
                            <th style="border:1px solid #000;">个税</th>
                            <th style="border:1px solid #000;font-weight:700;">实发薪资</th>
                            <th style="border:1px solid #000;width:120px;">收款人签字</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${items.map((it, idx) => `
                            <tr>
                                <td style="border:1px solid #000;text-align:center;">${idx + 1}</td>
                                <td style="border:1px solid #000;text-align:center;">${it.employee_no}</td>
                                <td style="border:1px solid #000;text-align:center;font-weight:700;">${it.employee_name}</td>
                                <td style="border:1px solid #000;text-align:right;">¥ ${(it.base_salary || it.salary_piecework_daily || 0).toFixed(2)}</td>
                                <td style="border:1px solid #000;text-align:center;">${it.attendance_days || 0}</td>
                                <td style="border:1px solid #000;text-align:center;">${((it.overtime_1_5||0)+(it.overtime_2_0||0)+(it.overtime_3_0||0)).toFixed(1)}</td>
                                <td style="border:1px solid #000;text-align:right;font-weight:700;">¥ ${(it.gross_pay || 0).toFixed(2)}</td>
                                <td style="border:1px solid #000;text-align:right;">¥ ${(it.social_security_p || 0).toFixed(2)}</td>
                                <td style="border:1px solid #000;text-align:right;">¥ ${(it.housing_fund_p || 0).toFixed(2)}</td>
                                <td style="border:1px solid #000;text-align:right;">¥ ${(it.individual_tax || 0).toFixed(2)}</td>
                                <td style="border:1px solid #000;text-align:right;font-weight:700;color:#16a34a;">¥ ${(it.net_pay || 0).toFixed(2)}</td>
                                <td style="border:1px solid #000;"></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                <div style="margin-top:16px;display:flex;justify-content:space-between;font-size:12px;color:#475569;">
                    <div>制表人: ______________</div>
                    <div>审核人: ______________</div>
                    <div>出纳发放: ______________</div>
                    <div>日期: 2026年___月___日</div>
                </div>
            </div>
        ` : `
            <div class="payroll-print-sheet" id="payroll-print-content">
                <div style="text-align:center;font-size:16px;font-weight:700;margin-bottom:12px;color:#0f172a;">
                    ${printData.company} ${printData.period_month} 员工信封工资条
                </div>
                ${items.map(it => `
                    <div style="border:1px dashed #cbd5e1;padding:12px;margin-bottom:12px;border-radius:6px;background:#ffffff;">
                        <div style="font-weight:700;font-size:13px;margin-bottom:6px;">【${it.employee_no}】${it.employee_name} - ${printData.period_month} 工资条</div>
                        <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:6px;font-size:12px;">
                            <div>应发薪资: <b>¥ ${(it.gross_pay || 0).toFixed(2)}</b></div>
                            <div>代扣社保: ¥ ${(it.social_security_p || 0).toFixed(2)}</div>
                            <div>代扣公积金: ¥ ${(it.housing_fund_p || 0).toFixed(2)}</div>
                            <div>代扣个税: ¥ ${(it.individual_tax || 0).toFixed(2)}</div>
                            <div style="grid-column:span 4;color:#16a34a;font-weight:700;font-size:13px;margin-top:4px;">实发工资 (现金发放): ¥ ${(it.net_pay || 0).toFixed(2)}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;

        const dlg = new frappe.ui.Dialog({
            title: isA4 ? '🖨️ A4 员工工资发放签收单预览与打印' : '✉️ DL 员工信封工资条预览与打印',
            fields: [
                {
                    fieldname: 'print_html',
                    fieldtype: 'HTML'
                }
            ],
            primary_action_label: '调用浏览器打印',
            primary_action() {
                const content = document.getElementById('payroll-print-content').innerHTML;
                const win = window.open('', '_blank');
                win.document.write(`
                    <html>
                    <head>
                        <title>${printData.company} ${printData.period_month} 工资单据</title>
                        <style>
                            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; padding: 20px; }
                            table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
                            th, td { border: 1px solid #000; padding: 5px 8px; }
                            th { background: #f1f5f9; }
                        </style>
                    </head>
                    <body>
                        ${content}
                    </body>
                    </html>
                `);
                win.document.close();
                win.focus();
                setTimeout(() => {
                    win.print();
                    win.close();
                }, 500);
            }
        });

        dlg.fields_dict.print_html.$wrapper.html(`<div class="payroll-print-modal-body">${printHtml}</div>`);
        dlg.show();
    }
}
