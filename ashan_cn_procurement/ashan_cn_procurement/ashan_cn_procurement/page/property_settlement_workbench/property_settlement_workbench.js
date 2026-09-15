// Copyright (c) 2026, Ashan CN Procurement and contributors
// For license information, please see license.txt

frappe.pages['property-settlement-workbench'].on_page_load = function(wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: '水电费月结',
        single_column: true
    });
    wrapper.property_settlement_workbench = new PropertySettlementWorkbench(wrapper, page);
};

frappe.pages['property-settlement-workbench'].on_page_show = function(wrapper) {
    if (wrapper.property_settlement_workbench) {
        wrapper.property_settlement_workbench.refresh();
    }
};

class PropertySettlementWorkbench {
    constructor(wrapper, page) {
        this.wrapper = wrapper;
        this.page = page;
        this.$container = $(wrapper).find('.layout-main-section');

        const now = new Date();
        this.currentYear = now.getFullYear();
        this.currentMonth = now.getMonth() + 1;
        this.data = null;

        this.init_dom();
        this.bind_global_events();
        this.load_month_settlement();
    }

    build_year_options() {
        const currentYear = new Date().getFullYear();
        return Array.from({ length: 11 }, (_, index) => currentYear - 5 + index)
            .map((year) => `<option value="${year}"${year === this.currentYear ? " selected" : ""}>${year}年</option>`)
            .join("");
    }

    init_dom() {
        this.$container.empty();
        const html = `
        <div class="prop-settle-wrapper">
            <!-- ❶ 顶部统一单行控制栏 (Integrated Header Bar) -->
            <div class="prop-unified-header-bar">
                <!-- 左侧：标题与状态标签 (带实时保存时间) -->
                <div class="header-left-cluster">
                    <h1 class="prop-page-title">水电费月结</h1>
                    <div class="save-status-capsule status-draft" id="settle-status-badge">
                        <span class="status-dot">🟡</span>
                        <span class="status-text">草稿录入中</span>
                        <span class="status-time" id="save-time-indicator"></span>
                    </div>
                </div>

                <!-- 中间：高效年月快速切换器 + 物业公司微输入 -->
                <div class="header-center-cluster">
                    <div class="period-navigator-capsule">
                        <button class="nav-arrow-btn" id="btn-prev-month" title="上一月">‹</button>
                        <div class="period-picker-box">
                            <select class="period-select" id="sel-year">
                                ${this.build_year_options()}
                            </select>
                            <select class="period-select" id="sel-month">
                                <option value="1">01月</option>
                                <option value="2">02月</option>
                                <option value="3">03月</option>
                                <option value="4">04月</option>
                                <option value="5">05月</option>
                                <option value="6">06月</option>
                                <option value="7">07月</option>
                                <option value="8" selected>08月</option>
                                <option value="9">09月</option>
                                <option value="10">10月</option>
                                <option value="11">11月</option>
                                <option value="12">12月</option>
                            </select>
                        </div>
                        <button class="nav-arrow-btn" id="btn-next-month" title="下一月">›</button>
                        <button class="current-month-btn" id="btn-current-month">本月</button>
                    </div>

                    <div class="prop-mgmt-inline-box">
                        <span class="prop-mgmt-icon">物业主体</span>
                        <input type="text" class="prop-mgmt-inline-input" id="inp-prop-mgmt" placeholder="物业管理公司" title="物业管理公司" />
                    </div>
                </div>

                <!-- 右侧：核心操作按钮矩阵（紧凑单行） -->
                <div class="header-right-cluster">
                    <div class="prop-btn-dropdown-wrap">
                        <button class="prop-btn-compact prop-btn-primary" id="btn-export-dropdown">
                            📥 导出 Excel <span style="font-size: 9px; margin-left: 2px;">▼</span>
                        </button>
                        <div class="prop-dropdown-menu" id="menu-export-excel">
                            <a class="dropdown-item" href="#" id="act-export-full">📑 导出【全套多Sheet】Excel</a>
                            <a class="dropdown-item" href="#" id="act-export-total">🏢 导出【全公司合计】Excel</a>
                            <div class="dropdown-divider"></div>
                            <div id="comp-export-items"></div>
                        </div>
                    </div>

                    <button class="prop-btn-compact prop-btn-secondary" id="btn-preview-bills">
                        🖨️ 单证预览
                    </button>

                    <button class="prop-btn-compact prop-btn-warning" id="btn-add-adj">
                        ➕ 添加调整
                    </button>

                    <button class="prop-btn-compact prop-btn-outline" id="btn-save-draft" title="手动保存草稿">
                        💾 保存草稿
                    </button>

                    <button class="prop-btn-compact prop-btn-success" id="btn-finalize-settle">
                        ✅ 完成结算
                    </button>

                    <button class="prop-btn-compact prop-btn-outline" id="btn-revert-settle" style="display: none; color: #dc2626; border-color: #fca5a5;">
                        🔓 取消结算
                    </button>
                </div>
            </div>

            <!-- ❷ ⚡ 电表抄表与核算明细 (靠上 · 核心录入) -->
            <div class="prop-card-section">
                <div class="prop-section-header">
                    <div class="sec-title-with-rate">
                        <span class="sec-title">⚡ 电表抄表与核算明细</span>
                        <span class="tax-pill">含税单价与当前税率</span>
                    </div>
                    <span class="sec-tip">💡 快捷操作：请在标注【*】的列录入本月读数（输入后按 Enter 自动跳到下一行）</span>
                </div>
                <div class="prop-table-responsive">
                    <table class="prop-excel-table" id="table-elec-meters">
                        <thead>
                            <tr>
                                <th style="width: 140px;">归属公司</th>
                                <th style="width: 70px; text-align: center;">表号</th>
                                <th style="width: 95px; text-align: right;">上期表数</th>
                                <th class="prop-th-required" style="width: 120px; text-align: right; background: #fef08a; color: #854d0e; font-weight: 800; border-bottom: 2px solid #ca8a04;">
                                    <span style="color: #dc2626; font-size: 15px; font-weight: 900; margin-right: 2px;">*</span>本期表数 (必填)
                                </th>
                                <th style="width: 75px; text-align: right;">原始差值</th>
                                <th style="width: 65px; text-align: center;">倍率</th>
                                <th style="width: 100px; text-align: right; background: #eff6ff; color: #1e40af;">核定度数(kWh)</th>
                                <th style="width: 95px; text-align: right;">单价(含税)</th>
                                <th style="width: 105px; text-align: right; background: #fef2f2; color: #991b1b;">含税电费</th>
                                <th style="width: 90px; text-align: right; color: #c2410c;">增值税额</th>
                                <th style="width: 95px; text-align: right; color: #475569;">不含税金额</th>
                                <th style="min-width: 110px;">抄表备注</th>
                            </tr>
                        </thead>
                        <tbody id="tbody-elec-meters"></tbody>
                    </table>
                </div>
            </div>

            <!-- ❸ 💧 水表抄表与核算明细 (靠上 · 核心录入) -->
            <div class="prop-card-section">
                <div class="prop-section-header">
                    <div class="sec-title-with-rate">
                        <span class="sec-title">💧 水表抄表与核算明细</span>
                        <span class="tax-pill">含税单价与当前税率</span>
                    </div>
                    <span class="sec-tip">💡 快捷操作：请在标注【*】的列录入本月读数（输入后按 Enter 自动跳到下一行）</span>
                </div>
                <div class="prop-table-responsive">
                    <table class="prop-excel-table" id="table-water-meters">
                        <thead>
                            <tr>
                                <th style="width: 140px;">归属公司</th>
                                <th style="width: 70px; text-align: center;">表号</th>
                                <th style="width: 95px; text-align: right;">上期表数</th>
                                <th class="prop-th-required" style="width: 120px; text-align: right; background: #fef08a; color: #854d0e; font-weight: 800; border-bottom: 2px solid #ca8a04;">
                                    <span style="color: #dc2626; font-size: 15px; font-weight: 900; margin-right: 2px;">*</span>本期表数 (必填)
                                </th>
                                <th style="width: 75px; text-align: right;">原始差值</th>
                                <th style="width: 65px; text-align: center;">倍率</th>
                                <th style="width: 100px; text-align: right; background: #eff6ff; color: #1e40af;">核定水量(m³)</th>
                                <th style="width: 95px; text-align: right;">单价(含税)</th>
                                <th style="width: 105px; text-align: right; background: #fef2f2; color: #991b1b;">含税水费</th>
                                <th style="width: 90px; text-align: right; color: #c2410c;">增值税额</th>
                                <th style="width: 95px; text-align: right; color: #475569;">不含税金额</th>
                                <th style="min-width: 110px;">抄表备注</th>
                            </tr>
                        </thead>
                        <tbody id="tbody-water-meters"></tbody>
                    </table>
                </div>
            </div>

            <!-- ❹ 💰 费用调整与分摊 (录入区 · 靠上) -->
            <div class="prop-card-section">
                <div class="prop-section-header">
                    <span class="sec-title">💰 本月水电费用调配与特殊调整</span>
                    <span class="sec-tip">适用于公司间水电调配划拨或单公司用量、金额调整</span>
                </div>
                <div class="prop-table-responsive">
                    <table class="prop-excel-table" id="table-adjustments">
                        <thead>
                            <tr>
                                <th style="width: 100px;">调整方式</th>
                                <th style="width: 80px;">费用类型</th>
                                <th style="width: 100px;">调整范围</th>
                                <th style="width: 130px;">转出/扣减方</th>
                                <th style="width: 130px;">转入/归属方</th>
                                <th style="width: 120px; text-align: right;">输入调整值</th>
                                <th style="width: 100px; text-align: right;">等效用量</th>
                                <th style="width: 110px; text-align: right;">调整金额(含税)</th>
                                <th style="width: 90px; text-align: right; color: #c2410c;">增值税额</th>
                                <th style="min-width: 130px;">调整原因说明</th>
                                <th style="width: 70px; text-align: center;">操作</th>
                            </tr>
                        </thead>
                        <tbody id="tbody-adjustments"></tbody>
                    </table>
                </div>
            </div>

            <!-- ❺ 💡 房东单据单价与税率反推参数卡片 (Rate & Tax Inspector) -->
            <div class="prop-rate-inspector-card">
                <div class="rate-inspector-header">
                    <span class="rate-inspector-title">💡 房东单据单价与税率反推参数</span>
                    <span class="rate-inspector-sub">以当期生效费率为基准自动推导税金</span>
                </div>
                <div class="rate-inspector-grid">
                    <!-- 电费反推卡片 -->
                    <div class="rate-card rate-card-elec">
                        <div class="rate-card-header">
                            <div class="rate-card-title">供电核算</div>
                            <div class="rate-input-wrap">
                                <label><span style="color: #dc2626; font-weight: 800;">*</span>房东含税单价:</label>
                                <div class="rate-input-inner">
                                    <input type="number" step="0.0001" id="inp-elec-price" class="rate-input" />
                                    <span class="rate-unit">元/kWh</span>
                                </div>
                            </div>
                        </div>
                        <div class="rate-card-body">
                            <div class="rate-metric">
                                <span class="metric-lbl">反推不含税单价:</span>
                                <span class="metric-val" id="disp-elec-excl">--</span>
                            </div>
                            <div class="rate-metric">
                                <span class="metric-lbl" id="disp-elec-tax-label">每度税额:</span>
                                <span class="metric-val" id="disp-elec-tax" style="color:#d97706;">--</span>
                            </div>
                        </div>
                    </div>

                    <!-- 水费反推卡片 -->
                    <div class="rate-card rate-card-water">
                        <div class="rate-card-header">
                            <div class="rate-card-title">自来水核算</div>
                            <div class="rate-input-wrap">
                                <label><span style="color: #dc2626; font-weight: 800;">*</span>房东含税水价:</label>
                                <div class="rate-input-inner">
                                    <input type="number" step="0.01" id="inp-water-price" class="rate-input" />
                                    <span class="rate-unit">元/m³</span>
                                </div>
                            </div>
                        </div>
                        <div class="rate-card-body">
                            <div class="rate-metric">
                                <span class="metric-lbl">反推不含税水价:</span>
                                <span class="metric-val" id="disp-water-excl">--</span>
                            </div>
                            <div class="rate-metric">
                                <span class="metric-lbl" id="disp-water-tax-label">每吨税额:</span>
                                <span class="metric-val" id="disp-water-tax" style="color:#0284c7;">--</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- ❻ 📊 全公司水电总开支汇总与分公司看板 (靠下方 · 自动核算展示) -->
            <div class="prop-card-section" style="background:transparent; border:none; box-shadow:none; padding:0;">
                <div class="prop-section-header" style="margin-bottom:12px; padding:0 4px;">
                    <span class="sec-title">本月公司水电费财务汇总看板（按公司、费用类型与当期税率分组）</span>
                    <span class="sec-tip">依据当期生效费率、实际读数与调配分摊自动核算含税金额、税额与不含税成本</span>
                </div>
                <div id="comp-summary-groups-container"></div>
            </div>
        </div>
        `;
        this.$container.html(html);
    }

    bind_global_events() {
        const self = this;

        // 年月选择切换
        const $selY = this.$container.find('#sel-year');
        const $selM = this.$container.find('#sel-month');

        $selY.val(self.currentYear);
        $selM.val(self.currentMonth);

        $selY.add($selM).on('change', () => {
            self.currentYear = parseInt($selY.val());
            self.currentMonth = parseInt($selM.val());
            self.load_month_settlement();
        });

        this.$container.find('#btn-prev-month').on('click', () => {
            if (self.currentMonth === 1) {
                self.currentYear--;
                self.currentMonth = 12;
            } else {
                self.currentMonth--;
            }
            $selY.val(self.currentYear);
            $selM.val(self.currentMonth);
            self.load_month_settlement();
        });

        this.$container.find('#btn-next-month').on('click', () => {
            if (self.currentMonth === 12) {
                self.currentYear++;
                self.currentMonth = 1;
            } else {
                self.currentMonth++;
            }
            $selY.val(self.currentYear);
            $selM.val(self.currentMonth);
            self.load_month_settlement();
        });

        this.$container.find('#btn-current-month').on('click', () => {
            const now = new Date();
            self.currentYear = now.getFullYear();
            self.currentMonth = now.getMonth() + 1;
            $selY.val(self.currentYear);
            $selM.val(self.currentMonth);
            self.load_month_settlement();
        });

        // 物业公司修改与单价修改即时触发重算与自动保存
        this.$container.find('#inp-prop-mgmt').on('input change blur', () => {
            self.auto_save_settlement(false);
        });

        this.$container.find('#inp-elec-price, #inp-water-price').on('input change blur', () => {
            self.recalculate();
            self.auto_save_settlement(false);
        });

        // 手动保存草稿
        this.$container.find('#btn-save-draft').on('click', () => {
            self.save_draft();
        });

        // 导出 Excel 菜单与点击控制
        const $btnDropdown = this.$container.find('#btn-export-dropdown');
        const $menuDropdown = this.$container.find('#menu-export-excel');

        $btnDropdown.on('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            $menuDropdown.toggle();
        });

        $(document).on('click.prop_excel_menu', (e) => {
            if (!$(e.target).closest('#btn-export-dropdown, #menu-export-excel').length) {
                $menuDropdown.hide();
            }
        });

        this.$container.find('#act-export-full').on('click', (e) => {
            e.preventDefault();
            $menuDropdown.hide();
            self.download_excel('all');
        });
        this.$container.find('#act-export-total').on('click', (e) => {
            e.preventDefault();
            $menuDropdown.hide();
            self.download_excel('total');
        });

        // 添加调整弹窗
        this.$container.find('#btn-add-adj').on('click', () => {
            self.open_add_adjustment_dialog();
        });

        // 完成本月结算
        this.$container.find('#btn-finalize-settle').on('click', () => {
            self.open_finalize_confirm_dialog();
        });

        // 取消结算
        this.$container.find('#btn-revert-settle').on('click', () => {
            self.revert_settlement();
        });

        // 预览全部结算单
        this.$container.find('#btn-preview-bills').on('click', () => {
            self.open_bills_preview_dialog();
        });
    }

    refresh() {
        this.load_month_settlement();
    }

    load_month_settlement() {
        const self = this;
        frappe.call({
            method: 'ashan_cn_procurement.ashan_cn_procurement.page.property_settlement_workbench.property_settlement_workbench.get_settlement',
            args: {
                year: self.currentYear,
                month: self.currentMonth
            },
            callback(r) {
                if (r.message) {
                    self.data = r.message;
                    self.render_all();
                }
            }
        });
    }

    render_all() {
        const self = this;
        const d = this.data;
        if (!d) return;

        const isLocked = (d.status === '已结算');
        const $badge = this.$container.find('#settle-status-badge');
        const $btnFinalize = this.$container.find('#btn-finalize-settle');
        const $btnRevert = this.$container.find('#btn-revert-settle');
        const $btnSave = this.$container.find('#btn-save-draft');
        const $btnAddAdj = this.$container.find('#btn-add-adj');

        if (isLocked) {
            $badge.removeClass('status-draft status-saved status-saving').addClass('status-locked');
            $badge.find('.status-dot').text('🔒');
            $badge.find('.status-text').text('已核定锁定');
            $badge.find('.status-time').text('');
            $btnFinalize.hide();
            $btnRevert.show();
            $btnSave.hide();
            $btnAddAdj.hide();
            this.$container.find('.prop-excel-table, .rate-input, .prop-mgmt-inline-input').addClass('table-locked');
        } else {
            $badge.removeClass('status-locked status-saving');
            if (self._lastSavedTime) {
                $badge.addClass('status-saved');
                $badge.find('.status-dot').text('🟢');
                $badge.find('.status-text').text('已自动保存');
                $badge.find('.status-time').text(self._lastSavedTime);
            } else {
                $badge.addClass('status-draft');
                $badge.find('.status-dot').text('🟡');
                $badge.find('.status-text').text('草稿录入中');
                $badge.find('.status-time').text('');
            }
            $btnFinalize.show();
            $btnRevert.hide();
            $btnSave.show();
            $btnAddAdj.show();
            this.$container.find('.prop-excel-table, .rate-input, .prop-mgmt-inline-input').removeClass('table-locked');
        }

        // 物业公司
        this.$container.find('#inp-prop-mgmt').val(d.property_management_company || '').prop('disabled', isLocked);

        // 房东含税单价输入与反推卡片更新
        const elecPrice = parseFloat(d.electricity_price);
        const waterPrice = parseFloat(d.water_price);
        this.$container.find('#inp-elec-price').val(elecPrice).prop('disabled', isLocked);
        this.$container.find('#inp-water-price').val(waterPrice).prop('disabled', isLocked);

        this.update_rate_inspector_display(
            elecPrice,
            waterPrice,
            parseFloat(d.electricity_tax_rate),
            parseFloat(d.water_tax_rate)
        );

        // 更新 Excel 导出菜单中的各公司项
        const $compMenu = this.$container.find('#comp-export-items');
        $compMenu.empty();
        (d.company_summaries || []).forEach(s => {
            const shortName = `${s.company}水电费`;
            const $item = $(`<a class="dropdown-item" href="#">📄 导出【${shortName}】Excel</a>`);
            $item.on('click', (e) => {
                e.preventDefault();
                self.$container.find('#menu-export-excel').hide();
                self.download_excel('company', s.company);
            });
            $compMenu.append($item);
        });

        this.render_summary_table();
        this.render_meter_tables();
        this.render_adjustments_table();
    }

    update_rate_inspector_display(elecPrice, waterPrice, elecTaxRate, waterTaxRate) {
        if (!(elecPrice > 0) || !(waterPrice > 0) || isNaN(elecTaxRate) || isNaN(waterTaxRate)) {
            this.$container.find('#disp-elec-excl, #disp-elec-tax, #disp-water-excl, #disp-water-tax').text('--');
            return;
        }
        const elecExcl = elecPrice / (1.0 + (elecTaxRate / 100.0));
        const elecTax = elecPrice - elecExcl;
        const waterExcl = waterPrice / (1.0 + (waterTaxRate / 100.0));
        const waterTax = waterPrice - waterExcl;

        this.$container.find('#disp-elec-tax-label').text(`每度税额 (${format_number(elecTaxRate, 2)}%):`);
        this.$container.find('#disp-water-tax-label').text(`每吨税额 (${format_number(waterTaxRate, 2)}%):`);
        this.$container.find('#disp-elec-excl').text(`¥ ${format_number(elecExcl, 6)}`);
        this.$container.find('#disp-elec-tax').text(`¥ ${format_number(elecTax, 6)}`);
        this.$container.find('#disp-water-excl').text(`¥ ${format_number(waterExcl, 6)}`);
        this.$container.find('#disp-water-tax').text(`¥ ${format_number(waterTax, 6)}`);
    }

    render_summary_table() {
        const self = this;
        const summaries = this.data?.company_summaries || [];
        const $container = this.$container.find('#comp-summary-groups-container');
        $container.empty();

        if (!summaries.length) {
            $container.html('<div class="text-center text-muted" style="padding:20px; background:#fff; border-radius:6px; border:1px solid #e2e8f0;">暂无公司水电结算数据</div>');
            return;
        }

        let totElecU = 0, totElecA = 0, totWaterU = 0, totWaterA = 0, totGrand = 0, totTax = 0, totExcl = 0;

        const elecTaxRate = Math.max(0, flt(self.data?.electricity_tax_rate));
        const waterTaxRate = Math.max(0, flt(self.data?.water_tax_rate));
        const elecTaxDivider = 1 + (elecTaxRate / 100);
        const waterTaxDivider = 1 + (waterTaxRate / 100);

        summaries.forEach(s => {
            const elecU = flt(s.electricity_usage);
            const elecA = flt(s.electricity_amount);
            const waterU = flt(s.water_usage);
            const waterA = flt(s.water_amount);
            const adjA = flt(s.adjustment_amount);

            // 只按当期配置的税率拆分，避免界面虚构未配置的附加收费。
            const elecMainAmt = Math.round(elecA * 100) / 100;
            const elecMainExcl = Math.round((elecMainAmt / elecTaxDivider) * 100) / 100;
            const elecMainTax = Math.round((elecMainAmt - elecMainExcl) * 100) / 100;
            const elecExclTot = elecMainExcl;

            const waterExcl = Math.round((waterA / waterTaxDivider) * 100) / 100;
            const waterTax = Math.round((waterA - waterExcl) * 100) / 100;

            // 公司小计
            const compTot = Math.round((elecA + waterA) * 100) / 100;
            const compTax = Math.round((elecMainTax + waterTax) * 100) / 100;
            const compExcl = Math.round((compTot - compTax) * 100) / 100;

            totElecU += elecU;
            totElecA += elecA;
            totWaterU += waterU;
            totWaterA += waterA;
            totGrand += compTot;
            totTax += compTax;
            totExcl += compExcl;

            const unitElecPrice = elecU > 0 ? (elecA / elecU).toFixed(4) : (self.data.electricity_price || 0);
            const unitWaterPrice = waterU > 0 ? (waterA / waterU).toFixed(4) : (self.data.water_price || 0);

            // 该公司的电费调整与水费调整列表
            const allAdjs = self.data?.adjustments || [];
            const compElecAdjs = [];
            const compWaterAdjs = [];

            allAdjs.forEach(a => {
                const isElecAdj = (a.utility_type === '电费' || a.utility_type === '电');
                const isWaterAdj = (a.utility_type === '水费' || a.utility_type === '水');
                if (!isElecAdj && !isWaterAdj) return;

                const targetList = isElecAdj ? compElecAdjs : compWaterAdjs;

                if (a.adjustment_scope === '单公司' && a.company === s.company) {
                    targetList.push({
                        title: isElecAdj ? '电费调整' : '水费调整',
                        desc: a.reason || '单公司调整',
                        usage: flt(a.usage_adjustment),
                        amount: flt(a.amount_adjustment),
                        tax: flt(a.tax_amount || 0)
                    });
                } else if (a.adjustment_scope === '公司间转移') {
                    if (a.from_company === s.company) {
                        targetList.push({
                            title: isElecAdj ? '公司间电费调出' : '公司间水费调出',
                            desc: `转至 ${a.to_company} (${a.reason || '调配分摊'})`,
                            usage: -flt(a.equivalent_usage || (a.adjustment_type === '按用量' ? a.usage_adjustment : 0)),
                            amount: -flt(a.amount_adjustment),
                            tax: -flt(a.tax_amount || 0)
                        });
                    } else if (a.to_company === s.company) {
                        targetList.push({
                            title: isElecAdj ? '公司间电费调入' : '公司间水费调入',
                            desc: `由 ${a.from_company} 转入 (${a.reason || '调配分摊'})`,
                            usage: flt(a.equivalent_usage || (a.adjustment_type === '按用量' ? a.usage_adjustment : 0)),
                            amount: flt(a.amount_adjustment),
                            tax: flt(a.tax_amount || 0)
                        });
                    }
                }
            });

            // 生成电费调整行 HTML
            let elecAdjRowsHtml = '';
            compElecAdjs.forEach(adj => {
                const adjExcl = Math.round((adj.amount / elecTaxDivider) * 100) / 100;
                const adjTax = Math.round((adj.amount - adjExcl) * 100) / 100;
                elecAdjRowsHtml += `
                    <tr style="background:#fffbeb; font-size:12px; color:#92400e;">
                        <td style="padding-left:24px;"><b>↳ ⚡ ${adj.title}</b></td>
                        <td style="text-align: right;">${adj.usage !== 0 ? (adj.usage > 0 ? '+' : '') + format_number(adj.usage) + ' 度' : '—'}</td>
                        <td style="text-align: right;">¥ ${unitElecPrice}/度</td>
                        <td colspan="2"><span style="color:#b45309;">说明: ${frappe.utils.escape_html(adj.desc)}</span></td>
                        <td style="text-align: right; color:#c2410c;">${adjTax !== 0 ? (adjTax > 0 ? '+' : '') + '¥ ' + format_currency(adjTax) : '—'}</td>
                        <td style="text-align: right; color:#475569;">${adjExcl !== 0 ? (adjExcl > 0 ? '+' : '') + '¥ ' + format_currency(adjExcl) : '—'}</td>
                        <td style="text-align: right; font-weight:700; color:${adj.amount < 0 ? '#dc2626' : '#059669'}; background:#fefce8;">
                            ${adj.amount > 0 ? '+' : ''}¥ ${format_currency(adj.amount)}
                        </td>
                    </tr>
                `;
            });

            // 生成水费调整行 HTML
            let waterAdjRowsHtml = '';
            compWaterAdjs.forEach(adj => {
                const adjExcl = Math.round((adj.amount / waterTaxDivider) * 100) / 100;
                const adjTax = Math.round((adj.amount - adjExcl) * 100) / 100;
                waterAdjRowsHtml += `
                    <tr style="background:#f0fdfa; font-size:12px; color:#0f766e;">
                        <td style="padding-left:24px;"><b>↳ 💧 ${adj.title}</b></td>
                        <td style="text-align: right;">${adj.usage !== 0 ? (adj.usage > 0 ? '+' : '') + format_number(adj.usage) + ' m³' : '—'}</td>
                        <td style="text-align: right;">¥ ${unitWaterPrice}/m³</td>
                        <td colspan="2"><span style="color:#0f766e;">说明: ${frappe.utils.escape_html(adj.desc)}</span></td>
                        <td style="text-align: right; color:#c2410c;">${adjTax !== 0 ? (adjTax > 0 ? '+' : '') + '¥ ' + format_currency(adjTax) : '—'}</td>
                        <td style="text-align: right; color:#475569;">${adjExcl !== 0 ? (adjExcl > 0 ? '+' : '') + '¥ ' + format_currency(adjExcl) : '—'}</td>
                        <td style="text-align: right; font-weight:700; color:${adj.amount < 0 ? '#dc2626' : '#059669'}; background:#f0fdfa;">
                            ${adj.amount > 0 ? '+' : ''}¥ ${format_currency(adj.amount)}
                        </td>
                    </tr>
                `;
            });

            const groupHtml = `
                <div class="comp-group-card" style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; margin-bottom:16px; box-shadow:0 1px 3px rgba(0,0,0,0.05); overflow:hidden;">
                    <div class="comp-group-header" style="background:#f8fafc; border-bottom:1px solid #e2e8f0; padding:10px 16px; display:flex; justify-content:space-between; align-items:center;">
                        <div style="font-size:14px; font-weight:700; color:#1e293b; display:flex; align-items:center; gap:8px;">
                            <span>🏢 ${frappe.utils.escape_html(s.company)}</span>
                            ${adjA !== 0 ? `<span class="prop-tag" style="background:#fef3c7; color:#92400e; font-size:11px;">含调配调整 ¥${format_currency(adjA)}</span>` : ''}
                        </div>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <button class="prop-btn-link btn-print-company" data-company="${frappe.utils.escape_html(s.company)}" style="font-size:12px; padding:3px 8px; border:1px solid #cbd5e1; border-radius:4px;">
                                🖨️ 单证预览
                            </button>
                            <button class="prop-btn-link btn-export-company" data-company="${frappe.utils.escape_html(s.company)}" style="font-size:12px; padding:3px 8px; border:1px solid #cbd5e1; border-radius:4px; color:#0284c7;">
                                📥 导出 Excel
                            </button>
                        </div>
                    </div>
                    <div class="prop-table-responsive" style="margin:0;">
                        <table class="prop-excel-table" style="margin:0; border:none;">
                            <thead>
                                <tr style="background:#fafafa;">
                                    <th style="width: 130px;">费用类别</th>
                                    <th style="width: 110px; text-align: right;">核定用量</th>
                                    <th style="width: 125px; text-align: right;">综合单价</th>
                                    <th style="min-width: 220px;">税率与发票分项（按当期配置）</th>
                                    <th style="min-width: 220px;">附加收费说明</th>
                                    <th style="width: 105px; text-align: right; color:#c2410c;">增值税额</th>
                                    <th style="width: 110px; text-align: right; color:#475569;">不含税金额</th>
                                    <th style="width: 125px; text-align: right; background: #ecfdf5; color: #065f46;">价税合计(含税)</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td><b>⚡ 生产用电</b></td>
                                    <td style="text-align: right; font-weight:600;">${format_number(elecU)} 度</td>
                                    <td style="text-align: right;">¥ ${unitElecPrice}/度</td>
                                    <td>
                                        <div style="font-size:11.5px; line-height:1.4;">
                                            <div><b>*电力*电费:</b> ¥ ${format_currency(elecMainAmt)} <span style="color:#059669;">(${format_number(elecTaxRate, 2)}% 税率)</span></div>
                                            <div style="color:#64748b;">不含税: ¥ ${format_currency(elecMainExcl)} ｜ 税额: ¥ ${format_currency(elecMainTax)}</div>
                                        </div>
                                    </td>
                                    <td>
                                        <span style="color:#94a3b8; font-size:11.5px;">未配置的附加收费不在本台账中推算</span>
                                    </td>
                                    <td style="text-align: right; color: #c2410c; font-weight:600;">¥ ${format_currency(elecMainTax)}</td>
                                    <td style="text-align: right; color: #475569;">¥ ${format_currency(elecExclTot)}</td>
                                    <td style="text-align: right; font-weight: 700; background: #ecfdf5; color: #065f46; font-size:13px;">¥ ${format_currency(elecA)}</td>
                                </tr>
                                ${elecAdjRowsHtml}
                                <tr>
                                    <td><b>💧 自来水费</b></td>
                                    <td style="text-align: right; font-weight:600;">${format_number(waterU)} m³</td>
                                    <td style="text-align: right;">¥ ${unitWaterPrice}/m³</td>
                                    <td>
                                        <div style="font-size:11.5px; line-height:1.4;">
                                            <div><b>*水费*自来水:</b> ¥ ${format_currency(waterA)} <span style="color:#059669;">(${format_number(waterTaxRate, 2)}% 税率)</span></div>
                                            <div style="color:#64748b;">不含税: ¥ ${format_currency(waterExcl)} ｜ 税额: ¥ ${format_currency(waterTax)}</div>
                                        </div>
                                    </td>
                                    <td><span style="color:#94a3b8; font-size:11.5px;">未配置的附加收费不在本台账中推算</span></td>
                                    <td style="text-align: right; color: #c2410c; font-weight:600;">¥ ${format_currency(waterTax)}</td>
                                    <td style="text-align: right; color: #475569;">¥ ${format_currency(waterExcl)}</td>
                                    <td style="text-align: right; font-weight: 700; background: #ecfdf5; color: #065f46; font-size:13px;">¥ ${format_currency(waterA)}</td>
                                </tr>
                                ${waterAdjRowsHtml}
                                <tr style="background:#f8fafc; font-weight:700;">
                                    <td colspan="5" style="text-align:right; color:#334155;"><b>${frappe.utils.escape_html(s.company)} 水电小计:</b></td>
                                    <td style="text-align: right; color: #c2410c; font-weight:700;">¥ ${format_currency(compTax)}</td>
                                    <td style="text-align: right; color: #334155; font-weight:700;">¥ ${format_currency(compExcl)}</td>
                                    <td style="text-align: right; font-weight: 800; background: #ecfdf5; color: #065f46; font-size:14px;">¥ ${format_currency(compTot)}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            `;

            const $g = $(groupHtml);
            $g.find('.btn-print-company').on('click', function(e) {
                e.stopPropagation();
                const comp = $(this).attr('data-company');
                self.open_single_bill_dialog(comp);
            });
            $g.find('.btn-export-company').on('click', function(e) {
                e.stopPropagation();
                const comp = $(this).attr('data-company');
                self.download_excel('company', comp);
            });
            $container.append($g);
        });

        // 全公司总合计卡片
        const totalHtml = `
            <div class="comp-group-card" style="background:#f0fdf4; border:1.5px solid #86efac; border-radius:8px; margin-bottom:16px; box-shadow:0 1px 4px rgba(0,0,0,0.06); overflow:hidden;">
                <div class="comp-group-header" style="background:#dcfce7; border-bottom:1px solid #86efac; padding:10px 16px; display:flex; justify-content:space-between; align-items:center;">
                    <div style="font-size:14.5px; font-weight:800; color:#14532d;">
                        📊 全公司水电总开支汇总
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <button class="prop-btn-link" id="btn-print-total-card" style="font-size:12px; padding:3px 8px; border:1px solid #86efac; border-radius:4px; background:#fff;">
                            🖨️ 合计单证
                        </button>
                        <button class="prop-btn-link" id="btn-export-total-card" style="font-size:12px; padding:3px 8px; border:1px solid #86efac; border-radius:4px; color:#0284c7; background:#fff;">
                            📥 导出合计 Excel
                        </button>
                    </div>
                </div>
                <div style="padding:12px 16px; display:flex; justify-content:space-around; align-items:center; flex-wrap:wrap; gap:16px;">
                    <div>
                        <span style="font-size:12px; color:#166534;">全公司核定用电:</span>
                        <div style="font-size:16px; font-weight:800; color:#14532d;">${format_number(totElecU)} 度 (¥ ${format_currency(totElecA)})</div>
                    </div>
                    <div>
                        <span style="font-size:12px; color:#166534;">全公司核定用水:</span>
                        <div style="font-size:16px; font-weight:800; color:#14532d;">${format_number(totWaterU)} m³ (¥ ${format_currency(totWaterA)})</div>
                    </div>
                    <div>
                        <span style="font-size:12px; color:#c2410c;">增值税进项总额:</span>
                        <div style="font-size:16px; font-weight:800; color:#c2410c;">¥ ${format_currency(totTax)}</div>
                    </div>
                    <div>
                        <span style="font-size:12px; color:#334155;">企业不含税总成本:</span>
                        <div style="font-size:16px; font-weight:800; color:#334155;">¥ ${format_currency(totExcl)}</div>
                    </div>
                    <div style="background:#fff; border:1px solid #86efac; border-radius:6px; padding:6px 14px; text-align:right;">
                        <span style="font-size:12px; color:#166534; font-weight:bold;">本月水电总支出 (含税):</span>
                        <div style="font-size:19px; font-weight:900; color:#059669;">¥ ${format_currency(totGrand)}</div>
                    </div>
                </div>
            </div>
        `;
        const $totG = $(totalHtml);
        $totG.find('#btn-print-total-card').on('click', () => {
            self.open_single_bill_dialog('total');
        });
        $totG.find('#btn-export-total-card').on('click', () => {
            self.download_excel('total');
        });
        $container.append($totG);
    }

    auto_save_settlement() {
        const self = this;
        if (!this.data || this.data.status === '已结算') return;

        if (this._autoSaveTimer) {
            clearTimeout(this._autoSaveTimer);
        }

        this._autoSaveTimer = setTimeout(() => {
            frappe.call({
                method: 'ashan_cn_procurement.ashan_cn_procurement.page.property_settlement_workbench.property_settlement_workbench.save_settlement',
                args: { data: self.data },
                callback(r) {
                    if (r.message && r.message.status === 'success') {
                        const now = new Date();
                        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
                        self.$container.find('#settle-status-badge')
                            .removeClass('status-draft status-locked')
                            .addClass('status-saved')
                            .html(`🟢 已自动保存 (${timeStr})`);
                    }
                }
            });
        }, 300);
    }

    render_meter_tables() {
        const self = this;
        const readings = this.data?.meter_readings || [];
        const isLocked = (this.data?.status === '已结算');

        const $tbodyE = this.$container.find('#tbody-elec-meters');
        const $tbodyW = this.$container.find('#tbody-water-meters');
        $tbodyE.empty();
        $tbodyW.empty();

        readings.forEach((r, idx) => {
            const isElec = (r.utility_type === '电');
            const $tbody = isElec ? $tbodyE : $tbodyW;
            const unitPrice = isElec ? (self.data.electricity_price || 0) : (self.data.water_price || 0);

            const row = `
                <tr data-idx="${idx}">
                    <td>${frappe.utils.escape_html(r.company)}</td>
                    <td style="text-align: center;"><b>${frappe.utils.escape_html(r.meter_no)}</b></td>
                    <td style="text-align: right;" class="cell-prev">${format_number(r.previous_reading)}</td>
                    <td style="text-align: right;">
                        <input type="number" step="any" class="cell-reading-input" data-idx="${idx}" value="${r.current_reading !== undefined ? r.current_reading : ''}" ${isLocked ? 'disabled' : ''} />
                    </td>
                    <td style="text-align: right;" class="cell-raw">${format_number(r.raw_usage)}</td>
                    <td style="text-align: center;"><span class="mult-badge">×${r.multiplier}</span></td>
                    <td style="text-align: right;" class="cell-calc"><b>${format_number(r.calculated_usage)}</b></td>
                    <td style="text-align: right;" class="cell-price">¥ ${format_number(unitPrice, 4)}</td>
                    <td style="text-align: right;" class="cell-amount">¥ ${format_currency(r.amount_tax_incl)}</td>
                    <td style="text-align: right; color:#c2410c;" class="cell-tax">¥ ${format_currency(r.tax_amount)}</td>
                    <td style="text-align: right; color:#475569;" class="cell-excl">¥ ${format_currency(r.amount_tax_excl)}</td>
                    <td>
                        <input type="text" class="cell-remark-input" data-idx="${idx}" value="${frappe.utils.escape_html(r.remark || '')}" placeholder="换表/异常说明" ${isLocked ? 'disabled' : ''} />
                    </td>
                </tr>
            `;
            const $r = $(row);

            $r.find('.cell-reading-input').on('input change', function() {
                const i = parseInt($(this).attr('data-idx'));
                self.data.meter_readings[i].current_reading = parseFloat($(this).val()) || 0;
                self.recalculate();
                self.auto_save_settlement();
            });

            $r.find('.cell-reading-input').on('blur', function() {
                self.auto_save_settlement();
            });

            $r.find('.cell-remark-input').on('change blur', function() {
                const i = parseInt($(this).attr('data-idx'));
                self.data.meter_readings[i].remark = $(this).val();
                self.auto_save_settlement();
            });

            // Enter 快捷换行
            $r.find('.cell-reading-input').on('keydown', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    self.auto_save_settlement();
                    const $nextRow = $r.next('tr');
                    if ($nextRow.length) {
                        $nextRow.find('.cell-reading-input').focus().select();
                    }
                }
            });

            $tbody.append($r);
        });

        if (!$tbodyE.children().length) {
            $tbodyE.html('<tr><td colspan="12" class="text-center text-muted" style="padding:16px;">暂无电表数据</td></tr>');
        }
        if (!$tbodyW.children().length) {
            $tbodyW.html('<tr><td colspan="12" class="text-center text-muted" style="padding:16px;">暂无水表数据</td></tr>');
        }
    }

    render_adjustments_table() {
        const self = this;
        const allAdjs = this.data?.adjustments || [];
        const utilAdjs = allAdjs.filter(a => a.utility_type === '电费' || a.utility_type === '水费' || a.utility_type === '电' || a.utility_type === '水');
        const isLocked = (this.data?.status === '已结算');
        const $tbody = this.$container.find('#tbody-adjustments');
        $tbody.empty();

        if (!utilAdjs.length) {
            $tbody.html('<tr><td colspan="11" class="text-center text-muted" style="padding:16px;">本月暂无水电调整项</td></tr>');
            return;
        }

        utilAdjs.forEach((adj, idx) => {
            const isTransfer = (adj.adjustment_scope === '公司间转移');
            const fromDisplay = isTransfer ? frappe.utils.escape_html(adj.from_company || '—') : '—';
            const toDisplay = isTransfer ? frappe.utils.escape_html(adj.to_company || '—') : frappe.utils.escape_html(adj.company || '—');

            const valDisplay = adj.adjustment_type === '按用量'
                ? `${adj.usage_adjustment} (度/m³)`
                : `¥ ${format_currency(adj.amount_adjustment)}`;

            const row = `
                <tr>
                    <td><span class="prop-tag tag-type">${adj.adjustment_type}</span></td>
                    <td><b>${adj.utility_type}</b></td>
                    <td>${adj.adjustment_scope}</td>
                    <td><span class="company-out">${fromDisplay}</span></td>
                    <td><span class="company-in">${toDisplay}</span></td>
                    <td style="text-align: right;"><b>${valDisplay}</b></td>
                    <td style="text-align: right;">${adj.equivalent_usage ? format_number(adj.equivalent_usage) : '—'}</td>
                    <td style="text-align: right; font-weight: 700; color: #b45309;">¥ ${format_currency(adj.amount_adjustment)}</td>
                    <td style="text-align: right; color: #c2410c;">¥ ${format_currency(adj.tax_amount || 0)}</td>
                    <td>${frappe.utils.escape_html(adj.reason || '—')}</td>
                    <td style="text-align: center;">
                        ${!isLocked ? `<button class="prop-btn-del-adj" data-idx="${idx}" title="删除调整">🗑️</button>` : ''}
                    </td>
                </tr>
            `;
            const $r = $(row);
            $r.find('.prop-btn-del-adj').on('click', function() {
                const i = parseInt($(this).attr('data-idx'));
                self.data.adjustments.splice(i, 1);
                self.recalculate();
            });
            $tbody.append($r);
        });
    }

    recalculate() {
        if (!this.data) return;

        const elecPrice = parseFloat(this.$container.find('#inp-elec-price').val());
        const waterPrice = parseFloat(this.$container.find('#inp-water-price').val());
        if (!(elecPrice > 0) || !(waterPrice > 0)) {
            frappe.msgprint('电费和水费单价必须来自当期生效费率，且均大于零。');
            return;
        }

        this.data.electricity_price = elecPrice;
        this.data.water_price = waterPrice;
        this.data.property_management_company = this.$container.find('#inp-prop-mgmt').val().trim();

        this.update_rate_inspector_display(
            elecPrice,
            waterPrice,
            parseFloat(this.data.electricity_tax_rate),
            parseFloat(this.data.water_tax_rate)
        );

        calculate_local_matrix(this.data);
        this.render_summary_table();
        this.render_meter_tables_dynamic_updates();
        this.render_adjustments_table();
    }

    render_meter_tables_dynamic_updates() {
        const self = this;
        const readings = this.data?.meter_readings || [];
        readings.forEach((r, idx) => {
            const $r = self.$container.find(`tr[data-idx="${idx}"]`);
            if ($r.length) {
                const isElec = (r.utility_type === '电');
                const unitPrice = isElec ? (self.data.electricity_price || 0) : (self.data.water_price || 0);
                $r.find('.cell-price').text(`¥ ${format_number(unitPrice, 4)}`);
                $r.find('.cell-raw').text(format_number(r.raw_usage));
                $r.find('.cell-calc b').text(format_number(r.calculated_usage));
                $r.find('.cell-amount').text(`¥ ${format_currency(r.amount_tax_incl)}`);
                $r.find('.cell-tax').text(`¥ ${format_currency(r.tax_amount)}`);
                $r.find('.cell-excl').text(`¥ ${format_currency(r.amount_tax_excl)}`);
            }
        });
    }

    auto_save_settlement(isManual = false) {
        const self = this;
        if (!this.data || this.data.status === '已结算') return;

        if (this._autoSaveTimer) {
            clearTimeout(this._autoSaveTimer);
        }

        const triggerSave = () => {
            const $badge = self.$container.find('#settle-status-badge');
            $badge.removeClass('status-draft status-saved status-locked').addClass('status-saving');
            $badge.find('.status-dot').text('🔄');
            $badge.find('.status-text').text(isManual ? '正在保存...' : '正在自动保存...');
            $badge.find('.status-time').text('');

            self.data.property_management_company = self.$container.find('#inp-prop-mgmt').val().trim();
            self.data.electricity_price = parseFloat(self.$container.find('#inp-elec-price').val());
            self.data.water_price = parseFloat(self.$container.find('#inp-water-price').val());
            if (!(self.data.electricity_price > 0) || !(self.data.water_price > 0)) {
                frappe.msgprint('电费和水费单价未配置，无法保存月结草稿。');
                return;
            }

            frappe.call({
                method: 'ashan_cn_procurement.ashan_cn_procurement.page.property_settlement_workbench.property_settlement_workbench.save_settlement',
                args: {
                    data: JSON.stringify(self.data)
                },
                callback(r) {
                    if (r.message && (r.message.success || r.message.status === 'success')) {
                        const now = new Date();
                        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
                        self._lastSavedTime = timeStr;
                        $badge.removeClass('status-draft status-saving status-locked').addClass('status-saved');
                        $badge.find('.status-dot').text('🟢');
                        $badge.find('.status-text').text(isManual ? '已手动保存' : '已自动保存');
                        $badge.find('.status-time').text(timeStr);

                        if (isManual) {
                            frappe.show_alert({ message: `水电费草稿已成功保存 (${timeStr})`, indicator: 'green' }, 3);
                        }
                        if (r.message.data) {
                            self.data = r.message.data;
                        }
                    }
                }
            });
        };

        if (isManual) {
            triggerSave();
        } else {
            this._autoSaveTimer = setTimeout(triggerSave, 400);
        }
    }

    save_draft() {
        this.auto_save_settlement(true);
    }

    download_excel(mode, company) {
        const self = this;
        const month = self.data?.settlement_month || `${self.currentYear}-${self.currentMonth < 10 ? '0' + self.currentMonth : self.currentMonth}-01`;
        const propMgmt = self.$container.find('#inp-prop-mgmt').val().trim() || self.data?.property_management_company || '';
        if (!propMgmt) {
            frappe.msgprint('请先在当期费率中配置物业结算主体后再导出。');
            return;
        }

        let url = `/api/method/ashan_cn_procurement.services.property_settlement.export_utility_settlement_excel?settlement_month=${encodeURIComponent(month)}&mode=${encodeURIComponent(mode)}&property_management_company=${encodeURIComponent(propMgmt)}`;
        if (company) {
            url += `&company=${encodeURIComponent(company)}`;
        }

        frappe.show_alert({ message: '正在生成并下载 Excel 文件...', indicator: 'blue' }, 3);
        window.location.href = url;
    }

    open_add_adjustment_dialog() {
        const self = this;
        const companies = (self.data?.company_summaries || []).map(s => s.company);
        const fromDefault = companies[0] || '';
        const toDefault = companies[1] || companies[0] || '';

        let currentAdjType = '按金额';
        let currentUtilType = '电费';
        let currentScope = '公司间转移';
        let currentFromComp = fromDefault;
        let currentToComp = toDefault;
        let currentSingleComp = companies[0] || '';

        const dlg = new frappe.ui.Dialog({
            title: '➕ 添加水电费用调整 (分段选项卡 · 1次点击即生效)',
            fields: [
                {
                    fieldname: 'tabs_html',
                    fieldtype: 'HTML'
                },
                {
                    fieldname: 'usage_adjustment',
                    fieldtype: 'Float',
                    label: '调整用电量 (度/kWh)',
                    hidden: 1
                },
                {
                    fieldname: 'amount_adjustment',
                    fieldtype: 'Currency',
                    label: '调整金额 (元)',
                    default: 8000,
                    reqd: 1
                },
                {
                    fieldname: 'reason',
                    fieldtype: 'Small Text',
                    label: '调整原因说明',
                    default: '公司间用电调配分摊',
                    reqd: 1
                }
            ],
            primary_action_label: '确认添加调整',
            primary_action(vals) {
                if (currentScope === '公司间转移' && currentFromComp === currentToComp) {
                    frappe.msgprint('转出公司与转入公司不能相同！');
                    return;
                }

                self.data.adjustments = self.data.adjustments || [];
                self.data.adjustments.push({
                    adjustment_type: currentAdjType,
                    utility_type: currentUtilType,
                    adjustment_scope: currentScope,
                    company: currentScope === '单公司' ? currentSingleComp : '',
                    from_company: currentScope === '公司间转移' ? currentFromComp : '',
                    to_company: currentScope === '公司间转移' ? currentToComp : '',
                    usage_adjustment: currentAdjType === '按用量' ? parseFloat(vals.usage_adjustment || 0) : 0,
                    amount_adjustment: currentAdjType === '按金额' ? parseFloat(vals.amount_adjustment || 0) : 0,
                    reason: vals.reason || '调配分摊'
                });

                dlg.hide();
                self.recalculate();
                self.auto_save_settlement(false);
            }
        });

        // 渲染分段选项卡 HTML
        const fromChipsHtml = companies.map(c => `
            <div class="prop-chip-item ${c === fromDefault ? 'active' : ''}" data-comp="${frappe.utils.escape_html(c)}">
                🏢 ${frappe.utils.escape_html(c)}
            </div>
        `).join('');

        const toChipsHtml = companies.map(c => `
            <div class="prop-chip-item ${c === toDefault ? 'active' : ''}" data-comp="${frappe.utils.escape_html(c)}">
                🏢 ${frappe.utils.escape_html(c)}
            </div>
        `).join('');

        const singleChipsHtml = companies.map((c, idx) => `
            <div class="prop-chip-item ${idx === 0 ? 'active' : ''}" data-comp="${frappe.utils.escape_html(c)}">
                🏢 ${frappe.utils.escape_html(c)}
            </div>
        `).join('');

        const tabsHtml = `
            <div class="prop-modal-tabs-wrapper" style="padding-bottom: 6px;">
                <!-- 调整方式 -->
                <div class="prop-modal-section-label">⚙️ 调整方式 (1次点击即切换)</div>
                <div class="prop-modal-tab-group" id="grp-adj-type">
                    <div class="prop-tab-item active" data-val="按金额">💰 按金额调整 (元)</div>
                    <div class="prop-tab-item" data-val="按用量">🔢 按用量调整 (度/m³)</div>
                </div>

                <!-- 费用类型 -->
                <div class="prop-modal-section-label">⚡ 费用类型</div>
                <div class="prop-modal-tab-group" id="grp-util-type">
                    <div class="prop-tab-item active" data-val="电费">⚡ 生产电费</div>
                    <div class="prop-tab-item" data-val="水费">💧 自来水费</div>
                </div>

                <!-- 调整范围 -->
                <div class="prop-modal-section-label">🔄 调整范围</div>
                <div class="prop-modal-tab-group" id="grp-adj-scope">
                    <div class="prop-tab-item active" data-val="公司间转移">🔄 公司间转移 (调配分摊)</div>
                    <div class="prop-tab-item" data-val="单公司">🏢 单公司独立调整</div>
                </div>

                <!-- 公司间转移模式下的转出与转入公司 -->
                <div id="box-transfer-comps">
                    <div class="prop-modal-section-label" style="color:#b91c1c;">📤 转出公司 (费用扣减 -)</div>
                    <div class="prop-modal-chip-group" id="grp-from-comp">
                        ${fromChipsHtml}
                    </div>

                    <div class="prop-modal-section-label" style="color:#15803d; margin-top:8px;">📥 转入公司 (费用增加 +)</div>
                    <div class="prop-modal-chip-group" id="grp-to-comp">
                        ${toChipsHtml}
                    </div>
                </div>

                <!-- 单公司模式下的归属公司 -->
                <div id="box-single-comp" style="display:none;">
                    <div class="prop-modal-section-label">🏢 调整归属公司</div>
                    <div class="prop-modal-chip-group" id="grp-single-comp">
                        ${singleChipsHtml}
                    </div>
                </div>
            </div>
        `;

        dlg.fields_dict.tabs_html.$wrapper.html(tabsHtml);

        // 绑定选项卡 1 次点击事件
        const $w = dlg.fields_dict.tabs_html.$wrapper;

        // 1. 调整方式切换
        $w.find('#grp-adj-type .prop-tab-item').on('click', function() {
            $w.find('#grp-adj-type .prop-tab-item').removeClass('active');
            $(this).addClass('active');
            currentAdjType = $(this).attr('data-val');
            const isAmt = (currentAdjType === '按金额');

            dlg.set_df_property('amount_adjustment', 'hidden', !isAmt);
            dlg.set_df_property('usage_adjustment', 'hidden', isAmt);
            dlg.set_df_property('amount_adjustment', 'reqd', isAmt ? 1 : 0);
            dlg.set_df_property('usage_adjustment', 'reqd', isAmt ? 0 : 1);
            if (dlg.fields_dict['amount_adjustment']) dlg.fields_dict['amount_adjustment'].refresh();
            if (dlg.fields_dict['usage_adjustment']) dlg.fields_dict['usage_adjustment'].refresh();
        });

        // 2. 费用类型切换
        $w.find('#grp-util-type .prop-tab-item').on('click', function() {
            $w.find('#grp-util-type .prop-tab-item').removeClass('active');
            $(this).addClass('active');
            currentUtilType = $(this).attr('data-val');

            const label = currentUtilType === '水费' ? '调整用水量 (m³)' : '调整用电量 (度/kWh)';
            dlg.set_df_property('usage_adjustment', 'label', label);
            if (dlg.fields_dict['usage_adjustment']) dlg.fields_dict['usage_adjustment'].refresh();
        });

        // 3. 调整范围切换
        $w.find('#grp-adj-scope .prop-tab-item').on('click', function() {
            $w.find('#grp-adj-scope .prop-tab-item').removeClass('active');
            $(this).addClass('active');
            currentScope = $(this).attr('data-val');

            if (currentScope === '公司间转移') {
                $w.find('#box-transfer-comps').show();
                $w.find('#box-single-comp').hide();
            } else {
                $w.find('#box-transfer-comps').hide();
                $w.find('#box-single-comp').show();
            }
        });

        // 4. 公司芯片点击
        $w.find('#grp-from-comp .prop-chip-item').on('click', function() {
            $w.find('#grp-from-comp .prop-chip-item').removeClass('active');
            $(this).addClass('active');
            currentFromComp = $(this).attr('data-comp');
        });

        $w.find('#grp-to-comp .prop-chip-item').on('click', function() {
            $w.find('#grp-to-comp .prop-chip-item').removeClass('active');
            $(this).addClass('active');
            currentToComp = $(this).attr('data-comp');
        });

        $w.find('#grp-single-comp .prop-chip-item').on('click', function() {
            $w.find('#grp-single-comp .prop-chip-item').removeClass('active');
            $(this).addClass('active');
            currentSingleComp = $(this).attr('data-comp');
        });

        dlg.show();
    }

    open_finalize_confirm_dialog() {
        const self = this;
        frappe.confirm(
            `<b>⚠️ 确定完成并核定锁定【${self.currentYear}年${self.currentMonth}月】水电费结算？</b><br><br>锁定后数据将不能直接修改，可生成正式月结单据与凭证。`,
            () => {
                frappe.call({
                    method: 'ashan_cn_procurement.ashan_cn_procurement.page.property_settlement_workbench.property_settlement_workbench.finalize_settlement',
                    args: {
                        data: JSON.stringify(self.data)
                    },
                    callback(r) {
                        if (r.message?.success) {
                            frappe.show_alert({ message: '水电费已成功核定并锁定！', indicator: 'green' }, 4);
                            self.data = r.message.data;
                            self.render_all();
                        }
                    }
                });
            }
        );
    }

    revert_settlement() {
        const self = this;
        frappe.prompt(
            [{
                label: '解除锁定原因',
                fieldname: 'reason',
                fieldtype: 'Small Text',
                reqd: 1,
            }],
            (values) => {
                frappe.call({
                    method: 'ashan_cn_procurement.ashan_cn_procurement.page.property_settlement_workbench.property_settlement_workbench.revert_settlement',
                    args: {
                        name: self.data.settlement_name || self.data.name,
                        reason: values.reason,
                    },
                    callback(r) {
                        if (r.message?.success) {
                            frappe.show_alert({ message: '已取消锁定并退回草稿状态！', indicator: 'orange' }, 3);
                            self.load_month_settlement();
                        }
                    }
                });
            },
            '解除本月水电费结算锁定',
            '确认解除锁定'
        );
    }

    open_bills_preview_dialog() {
        const companies = (this.data?.company_summaries || []).map(s => s.company);
        if (companies.length) {
            this.open_single_bill_dialog(companies[0]);
        } else {
            this.open_single_bill_dialog('total');
        }
    }

    open_single_bill_dialog(company) {
        const self = this;
        const isTotal = (company === 'total' || company === '全公司合计');
        const settleName = self.data?.settlement_name || self.data?.name;
        if (!settleName) {
            frappe.msgprint('请先保存草稿以生成单证数据！');
            return;
        }

        const method = isTotal
            ? 'ashan_cn_procurement.ashan_cn_procurement.page.property_settlement_workbench.property_settlement_workbench.get_total_bill_data'
            : 'ashan_cn_procurement.ashan_cn_procurement.page.property_settlement_workbench.property_settlement_workbench.get_company_bill_data';
        const args = isTotal ? { settlement_name: settleName } : { settlement_name: settleName, company: company };

        frappe.call({
            method: method,
            args: args,
            callback(r) {
                if (r.message) {
                    self.render_bill_preview_modal(r.message);
                }
            }
        });
    }

    render_bill_preview_modal(bill) {
        const self = this;
        const monthStr = bill.settlement_month ? bill.settlement_month.substring(0, 7) : `${self.currentYear}-${self.currentMonth < 10 ? '0' + self.currentMonth : self.currentMonth}`;
        const allCompanies = (self.data?.company_summaries || []).map(s => s.company);
        const elecTaxRate = Math.max(0, flt(bill.electricity_tax_rate ?? self.data?.electricity_tax_rate));
        const waterTaxRate = Math.max(0, flt(bill.water_tax_rate ?? self.data?.water_tax_rate));
        const elecTaxDivider = 1 + (elecTaxRate / 100);
        const waterTaxDivider = 1 + (waterTaxRate / 100);

        // 电表行
        let sumElecRaw = 0, sumElecCalc = 0, sumElecAmount = 0;
        let elecRows = '';
        (bill.meters || []).filter(m => m.utility_type === '电').forEach(m => {
            sumElecRaw += flt(m.raw_usage);
            sumElecCalc += flt(m.calculated_usage);
            sumElecAmount += flt(m.amount_tax_incl);

            elecRows += `
                <tr>
                    <td>${frappe.utils.escape_html(m.meter_no)}</td>
                    <td>${format_number(m.previous_reading)}</td>
                    <td>${format_number(m.current_reading)}</td>
                    <td>${format_number(m.raw_usage)}</td>
                    <td>${m.multiplier}</td>
                    <td>${format_number(m.calculated_usage)}</td>
                    <td>${format_number(m.unit_price || bill.electricity_price, 4)}</td>
                    <td>${format_currency(m.amount_tax_incl)}</td>
                </tr>
            `;
        });

        // 调整行
        let elecAdjUsage = 0, elecAdjAmt = 0;
        (bill.adjustments || []).forEach(a => {
            if (a.title.includes('电')) {
                elecAdjUsage += flt(a.usage);
                elecAdjAmt += flt(a.amount);
                elecRows += `
                    <tr style="color: #b45309; background: #fffbeb;">
                        <td>${frappe.utils.escape_html(a.title)}</td>
                        <td>—</td>
                        <td>—</td>
                        <td>${a.usage ? format_number(a.usage) : '—'}</td>
                        <td>1</td>
                        <td>${a.usage ? format_number(a.usage) : '—'}</td>
                        <td>—</td>
                        <td>${format_currency(a.amount)}</td>
                    </tr>
                `;
            }
        });

        sumElecCalc += elecAdjUsage;
        sumElecAmount += elecAdjAmt;

        // 水表行
        let sumWaterRaw = 0, sumWaterCalc = 0, sumWaterAmount = 0;
        let waterRows = '';
        (bill.meters || []).filter(m => m.utility_type === '水').forEach(m => {
            sumWaterRaw += flt(m.raw_usage);
            sumWaterCalc += flt(m.calculated_usage);
            sumWaterAmount += flt(m.amount_tax_incl);

            waterRows += `
                <tr>
                    <td>${frappe.utils.escape_html(m.meter_no)}</td>
                    <td>${format_number(m.previous_reading)}</td>
                    <td>${format_number(m.current_reading)}</td>
                    <td>${format_number(m.raw_usage)}</td>
                    <td>${m.multiplier}</td>
                    <td>${format_number(m.calculated_usage)}</td>
                    <td>${format_number(m.unit_price || bill.water_price, 4)}</td>
                    <td>${format_currency(m.amount_tax_incl)}</td>
                </tr>
            `;
        });

        let waterAdjUsage = 0, waterAdjAmt = 0;
        (bill.adjustments || []).forEach(a => {
            if (a.title.includes('水')) {
                waterAdjUsage += flt(a.usage);
                waterAdjAmt += flt(a.amount);
                waterRows += `
                    <tr style="color: #0369a1; background: #f0f9ff;">
                        <td>${frappe.utils.escape_html(a.title)}</td>
                        <td>—</td>
                        <td>—</td>
                        <td>${a.usage ? format_number(a.usage) : '—'}</td>
                        <td>1</td>
                        <td>${a.usage ? format_number(a.usage) : '—'}</td>
                        <td>—</td>
                        <td>${format_currency(a.amount)}</td>
                    </tr>
                `;
            }
        });

        sumWaterCalc += waterAdjUsage;
        sumWaterAmount += waterAdjAmt;

        // 四舍五入取整统计 (与 Excel 一致)
        const elecRoundTot = Math.round(sumElecAmount);
        const waterRoundTot = Math.round(sumWaterAmount);
        const grandRoundTot = elecRoundTot + waterRoundTot;

        const elecTax = Math.round((sumElecAmount - Math.round((sumElecAmount / elecTaxDivider) * 100) / 100) * 100) / 100;
        const elecExcl = Math.round((sumElecAmount - elecTax) * 100) / 100;

        const waterTax = Math.round((sumWaterAmount - Math.round((sumWaterAmount / waterTaxDivider) * 100) / 100) * 100) / 100;
        const waterExcl = Math.round((sumWaterAmount - waterTax) * 100) / 100;

        const elecAvg = sumElecCalc > 0 ? (sumElecAmount / sumElecCalc).toFixed(4) : '0.0000';
        const waterAvg = sumWaterCalc > 0 ? (sumWaterAmount / sumWaterCalc).toFixed(4) : '0.0000';

        const tabsHtml = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid #e2e8f0; padding-bottom:8px;">
                <div class="btn-group" role="group">
                    ${allCompanies.map(c => {
                        const short = c;
                        const active = (c === bill.company) ? 'btn-primary' : 'btn-default';
                        return `<button type="button" class="btn btn-xs ${active} tab-switch-comp" data-comp="${frappe.utils.escape_html(c)}">${short}</button>`;
                    }).join('')}
                    <button type="button" class="btn btn-xs ${bill.is_total ? 'btn-primary' : 'btn-default'} tab-switch-comp" data-comp="total">合计单证</button>
                </div>
                <button class="btn btn-xs btn-default" id="btn-export-current-excel" style="color:#0284c7; font-weight:600;">
                    📥 导出当前单证 Excel
                </button>
            </div>
        `;

        const dlg = new frappe.ui.Dialog({
            title: `${bill.company} — ${monthStr} 水电费明细（单价含税）`,
            size: 'large',
            fields: [
                {
                    fieldname: 'bill_preview_html',
                    fieldtype: 'HTML',
                    options: `
                        ${tabsHtml}
                        <div class="bill-dialog-wrapper" id="printable-company-bill">
                            <div class="bill-header">
                                <h2 class="bill-title">${frappe.utils.escape_html(bill.company)}</h2>
                                <div class="bill-subtitle">水电费明细（单价含税）</div>
                                <div class="bill-meta-row">
                                    <span>所属期: <b>${monthStr}</b></span>
                                    <span>物业公司: <b>${frappe.utils.escape_html(bill.property_management_company)}</b></span>
                                </div>
                            </div>

                            <div class="bill-sec-title">电费</div>
                            <table class="bill-table-1to1">
                                <thead>
                                    <tr>
                                        <th>表号</th>
                                        <th>上期表数</th>
                                        <th>本期表数</th>
                                        <th>本期用电</th>
                                        <th>倍率</th>
                                        <th>核定度数</th>
                                        <th>单价</th>
                                        <th>总价</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${elecRows}
                                    <tr class="total-row">
                                        <td>合计</td>
                                        <td></td>
                                        <td></td>
                                        <td>${format_number(sumElecRaw + elecAdjUsage)}</td>
                                        <td></td>
                                        <td>${format_number(sumElecCalc)}</td>
                                        <td></td>
                                        <td>${format_currency(sumElecAmount)}</td>
                                    </tr>
                                </tbody>
                            </table>

                            <div class="bill-sec-title" style="margin-top:14px;">水费</div>
                            <table class="bill-table-1to1">
                                <thead>
                                    <tr>
                                        <th>表号</th>
                                        <th>上期表数</th>
                                        <th>本期表数</th>
                                        <th>本期用水</th>
                                        <th>倍率</th>
                                        <th>核定m³</th>
                                        <th>单价</th>
                                        <th>总价</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${waterRows}
                                    <tr class="total-row">
                                        <td>合计</td>
                                        <td></td>
                                        <td></td>
                                        <td>${format_number(sumWaterRaw + waterAdjUsage)}</td>
                                        <td></td>
                                        <td>${format_number(sumWaterCalc)}</td>
                                        <td></td>
                                        <td>${format_currency(sumWaterAmount)}</td>
                                    </tr>
                                </tbody>
                            </table>

                            <div class="bill-sec-title" style="margin-top: 14px;">${frappe.utils.escape_html(bill.company)}水电费合计（按当期结算单保存的费率拆解）</div>
                            <table class="bill-table-1to1">
                                <thead>
                                    <tr>
                                        <th style="width:26%;">项目</th>
                                        <th style="width:12%;">不含税金额</th>
                                        <th style="width:9%;">税率</th>
                                        <th style="width:11%;">税额</th>
                                        <th style="width:12%;">含税合计</th>
                                        <th style="width:11%;">数量</th>
                                        <th style="width:9%;">单价</th>
                                        <th style="width:10%;">水电费合计</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td style="text-align:left; padding-left:8px;">*电力*电费（${format_number(elecTaxRate, 2)}% 税率）</td>
                                        <td>¥ ${format_currency(elecExcl)}</td>
                                        <td>${format_number(elecTaxRate, 2)}%</td>
                                        <td>¥ ${format_currency(elecTax)}</td>
                                        <td>¥ ${format_currency(sumElecAmount)}</td>
                                        <td>${format_number(sumElecCalc)} 度</td>
                                        <td>${elecAvg}</td>
                                        <td rowspan="2" class="grand-total-large-cell" style="font-size:20px; font-weight:bold; color:#065f46; vertical-align:middle;">
                                            ¥ ${format_currency(sumElecAmount + sumWaterAmount)}
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="text-align:left; padding-left:8px;">*水费*自来水（${format_number(waterTaxRate, 2)}% 税率）</td>
                                        <td>¥ ${format_currency(waterExcl)}</td>
                                        <td>${format_number(waterTaxRate, 2)}%</td>
                                        <td>¥ ${format_currency(waterTax)}</td>
                                        <td>¥ ${format_currency(sumWaterAmount)}</td>
                                        <td>${format_number(sumWaterCalc)} m³</td>
                                        <td>${waterAvg}</td>
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
                        <title>${bill.company} - ${monthStr} 水电费明细（单价含税）</title>
                        <style>
                            body { font-family: "等线", "Microsoft YaHei", sans-serif; padding: 24px; color: #000; }
                            .bill-header { text-align: center; margin-bottom: 12px; }
                            .bill-title { margin: 0 0 4px 0; font-size: 20px; font-weight: bold; }
                            .bill-subtitle { font-size: 13px; margin-bottom: 6px; }
                            .bill-meta-row { display: flex; justify-content: space-between; border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 4px 0; font-size: 11.5px; }
                            .bill-sec-title { text-align: center; font-size: 12px; font-weight: bold; padding: 4px; border: 1.5px solid #000; border-bottom: 1px solid #000; margin-top: 10px; }
                            .bill-table-1to1 { width: 100%; border-collapse: collapse; font-size: 11.5px; margin-bottom: 6px; }
                            .bill-table-1to1 th { border: 1px solid #000; border-left: 1.5px solid #000; border-right: 1.5px solid #000; padding: 4px 6px; text-align: center; font-weight: bold; }
                            .bill-table-1to1 td { border: 1px solid #000; padding: 4px 6px; text-align: center; height: 26px; }
                            .bill-table-1to1 tr td:first-child { border-left: 1.5px solid #000; }
                            .bill-table-1to1 tr td:last-child { border-right: 1.5px solid #000; }
                            .bill-table-1to1 tr.total-row td { font-weight: bold; border-bottom: 1.5px solid #000; }
                            .grand-total-large-cell { font-size: 22px; font-weight: normal; vertical-align: middle; border: 1.5px solid #000 !important; }
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

        dlg.$wrapper.find('#btn-export-current-excel').on('click', function() {
            if (bill.is_total) {
                self.download_excel('total');
            } else {
                self.download_excel('company', bill.company);
            }
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

function calculate_local_matrix(data) {
    const elec_price = parseFloat(data.electricity_price);
    const elec_tax_rate = parseFloat(data.electricity_tax_rate);
    const water_price = parseFloat(data.water_price);
    const water_tax_rate = parseFloat(data.water_tax_rate);
    if (!(elec_price > 0) || !(water_price > 0)) {
        return;
    }

    // 1. 抄表 (依据房东综合含税单价反推税额与不含税金额)
    (data.meter_readings || []).forEach(r => {
        const prev = parseFloat(r.previous_reading) || 0;
        const curr = parseFloat(r.current_reading) || 0;
        const mult = parseFloat(r.multiplier) || 1.0;
        const raw = Math.max(0, curr - prev);
        const calc_u = Math.round(raw * mult * 100) / 100;
        const isElec = (r.utility_type === '电');
        const price = isElec ? elec_price : water_price;
        const tax_rate = isElec ? (elec_tax_rate / 100.0) : (water_tax_rate / 100.0);
        const amt = Math.round(calc_u * price * 100) / 100;
        const amt_excl = Math.round((amt / (1 + tax_rate)) * 100) / 100;
        const tax_amt = Math.round((amt - amt_excl) * 100) / 100;

        r.raw_usage = raw;
        r.calculated_usage = calc_u;
        r.unit_price = price;
        r.amount_tax_incl = amt;
        r.amount_tax_excl = amt_excl;
        r.tax_amount = tax_amt;
    });

    // 2. 调整
    (data.adjustments || []).forEach(a => {
        const u_type = a.utility_type;
        const isElec = (u_type === '电费' || u_type === '电');
        const isWater = (u_type === '水费' || u_type === '水');
        const price = isElec ? elec_price : (isWater ? water_price : 1.0);
        const tax_rate = isElec ? (elec_tax_rate / 100.0) : (isWater ? (water_tax_rate / 100.0) : 0.0);

        let amt = 0;
        if (a.adjustment_type === '按用量') {
            amt = Math.round((parseFloat(a.usage_adjustment) || 0) * price * 100) / 100;
            a.amount_adjustment = amt;
            a.equivalent_usage = parseFloat(a.usage_adjustment) || 0;
        } else {
            amt = parseFloat(a.amount_adjustment) || 0;
            a.equivalent_usage = price > 0 ? Math.round((amt / price) * 100) / 100 : 0;
        }

        const amt_excl = tax_rate > 0 ? Math.round((amt / (1 + tax_rate)) * 100) / 100 : amt;
        const tax_amt = Math.round((amt - amt_excl) * 100) / 100;
        a.amount_tax_excl = amt_excl;
        a.tax_amount = tax_amt;
    });

    // 3. 公司汇总
    const compMap = {};
    (data.company_summaries || []).forEach(s => {
        compMap[s.company] = {
            company: s.company,
            electricity_usage: 0,
            electricity_amount: 0,
            electricity_tax_amount: 0,
            electricity_amount_tax_excl: 0,
            water_usage: 0,
            water_amount: 0,
            water_tax_amount: 0,
            water_amount_tax_excl: 0,
            adjustment_amount: 0,
            total_amount: 0,
            total_tax_amount: 0,
            total_amount_tax_excl: 0
        };
    });

    (data.meter_readings || []).forEach(m => {
        if (compMap[m.company]) {
            const u = parseFloat(m.calculated_usage) || 0;
            const amt = parseFloat(m.amount_tax_incl) || 0;
            const tax = parseFloat(m.tax_amount) || 0;
            const excl = parseFloat(m.amount_tax_excl) || 0;
            if (m.utility_type === '电') {
                compMap[m.company].electricity_usage += u;
                compMap[m.company].electricity_amount += amt;
                compMap[m.company].electricity_tax_amount += tax;
                compMap[m.company].electricity_amount_tax_excl += excl;
            } else {
                compMap[m.company].water_usage += u;
                compMap[m.company].water_amount += amt;
                compMap[m.company].water_tax_amount += tax;
                compMap[m.company].water_amount_tax_excl += excl;
            }
        }
    });

    (data.adjustments || []).forEach(a => {
        const amt = parseFloat(a.amount_adjustment) || 0;
        const eq_u = parseFloat(a.equivalent_usage) || 0;
        const tax = parseFloat(a.tax_amount) || 0;
        const excl = parseFloat(a.amount_tax_excl) || 0;
        const u_type = a.utility_type;

        if (a.adjustment_scope === '单公司' && compMap[a.company]) {
            compMap[a.company].adjustment_amount += amt;
            if (u_type === '电费' || u_type === '电') {
                compMap[a.company].electricity_usage += eq_u;
                compMap[a.company].electricity_amount += amt;
                compMap[a.company].electricity_tax_amount += tax;
                compMap[a.company].electricity_amount_tax_excl += excl;
            } else if (u_type === '水费' || u_type === '水') {
                compMap[a.company].water_usage += eq_u;
                compMap[a.company].water_amount += amt;
                compMap[a.company].water_tax_amount += tax;
                compMap[a.company].water_amount_tax_excl += excl;
            }
        } else if (a.adjustment_scope === '公司间转移') {
            if (compMap[a.from_company]) {
                compMap[a.from_company].adjustment_amount -= amt;
                if (u_type === '电费' || u_type === '电') {
                    compMap[a.from_company].electricity_usage -= eq_u;
                    compMap[a.from_company].electricity_amount -= amt;
                    compMap[a.from_company].electricity_tax_amount -= tax;
                    compMap[a.from_company].electricity_amount_tax_excl -= excl;
                } else if (u_type === '水费' || u_type === '水') {
                    compMap[a.from_company].water_usage -= eq_u;
                    compMap[a.from_company].water_amount -= amt;
                    compMap[a.from_company].water_tax_amount -= tax;
                    compMap[a.from_company].water_amount_tax_excl -= excl;
                }
            }
            if (compMap[a.to_company]) {
                compMap[a.to_company].adjustment_amount += amt;
                if (u_type === '电费' || u_type === '电') {
                    compMap[a.to_company].electricity_usage += eq_u;
                    compMap[a.to_company].electricity_amount += amt;
                    compMap[a.to_company].electricity_tax_amount += tax;
                    compMap[a.to_company].electricity_amount_tax_excl += excl;
                } else if (u_type === '水费' || u_type === '水') {
                    compMap[a.to_company].water_usage += eq_u;
                    compMap[a.to_company].water_amount += amt;
                    compMap[a.to_company].water_tax_amount += tax;
                    compMap[a.to_company].water_amount_tax_excl += excl;
                }
            }
        }
    });

    let grandTot = 0;
    let grandTax = 0;
    let grandExcl = 0;

    data.company_summaries = Object.values(compMap).map(s => {
        s.electricity_usage = Math.round(s.electricity_usage * 100) / 100;
        s.electricity_amount = Math.round(s.electricity_amount * 100) / 100;
        s.electricity_tax_amount = Math.round(s.electricity_tax_amount * 100) / 100;
        s.electricity_amount_tax_excl = Math.round(s.electricity_amount_tax_excl * 100) / 100;

        s.water_usage = Math.round(s.water_usage * 100) / 100;
        s.water_amount = Math.round(s.water_amount * 100) / 100;
        s.water_tax_amount = Math.round(s.water_tax_amount * 100) / 100;
        s.water_amount_tax_excl = Math.round(s.water_amount_tax_excl * 100) / 100;

        s.adjustment_amount = Math.round(s.adjustment_amount * 100) / 100;

        s.total_amount = Math.round((s.electricity_amount + s.water_amount) * 100) / 100;
        s.total_tax_amount = Math.round((s.electricity_tax_amount + s.water_tax_amount) * 100) / 100;
        s.total_amount_tax_excl = Math.round((s.total_amount - s.total_tax_amount) * 100) / 100;

        grandTot += s.total_amount;
        grandTax += s.total_tax_amount;
        grandExcl += s.total_amount_tax_excl;
        return s;
    });

    data.total_amount = Math.round(grandTot * 100) / 100;
    data.total_tax_amount = Math.round(grandTax * 100) / 100;
    data.total_amount_tax_excl = Math.round(grandExcl * 100) / 100;
}
