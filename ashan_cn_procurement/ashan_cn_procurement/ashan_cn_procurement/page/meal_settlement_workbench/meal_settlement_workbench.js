// Copyright (c) 2026, Ashan CN Procurement and contributors
// For license information, please see license.txt

frappe.pages['meal-settlement-workbench'].on_page_load = function(wrapper) {
    wrapper.meal_settlement_wb = new MealSettlementWorkbench(wrapper);
};

frappe.pages['meal-settlement-workbench'].on_page_show = function(wrapper) {
    if (wrapper.meal_settlement_wb) {
        wrapper.meal_settlement_wb.load_data(wrapper.meal_settlement_wb.current_month);
    }
};

class MealSettlementWorkbench {
    constructor(wrapper) {
        this.page = frappe.ui.make_app_page({
            parent: wrapper,
            title: __('工作餐费月结工作台'),
            single_column: true
        });

        const now = new Date();
        this.current_year = now.getFullYear();
        this.current_month_num = now.getMonth() + 1;
        this.current_month = `${this.current_year}-${String(this.current_month_num).padStart(2, '0')}`;

        this.workbench_data = null;
        this.save_timeout = null;
        this.is_saving = false;
        this.saveIndicator = null;
        this.periodSelector = null;

        this.init();
    }

    init() {
        this.render_layout();
        this.bind_events();
        this.load_data(this.current_month);
    }

    render_layout() {
        this.$wrapper = $(`
            <div class="meal-workbench-container">
                <!-- ❶ 顶部统一单行控制栏 -->
                <div class="meal-top-bar">
                    <div class="meal-bar-left">
                        <div class="meal-page-title">
                            <strong>吉众 & 祺富 员工工作餐月结</strong>
                        </div>

                        <!-- 稳态零位移自动保存指示器 (AshanUI Kit 挂载点) -->
                        <div id="mount-save-indicator"></div>

                        <!-- 统一年月账期选择器 (AshanUI Kit 挂载点) -->
                        <div id="mount-period-selector"></div>

                        <!-- 基准单价控制区 (带显式保存应用按钮) -->
                        <div class="meal-price-control-box">
                            <span class="meal-price-label">基准单价:</span>
                            <div class="meal-price-input-wrap">
                                <input type="number" step="0.5" id="inp-base-price" class="inp-base-price" value="15.0" />
                                <span class="meal-price-unit">元/份</span>
                            </div>
                            <button class="btn-apply-base-price" id="btn-apply-base-price" title="保存基准单价并同步重新核算全月日明细">
                                保存并应用
                            </button>
                        </div>
                    </div>

                    <div class="meal-bar-right">
                        <button class="btn-meal-outline" id="btn-upload-excel">
                            导入订餐 Excel
                        </button>
                        <button class="btn-meal-outline" id="btn-export-excel">
                            导出 1:1 Excel
                        </button>
                        <button class="btn-meal-outline" id="btn-print-summary">
                            单证预览/打印
                        </button>
                        <button class="btn-meal-danger" id="btn-clear-month" title="清空当月所有用餐明细数据">
                            清空本月
                        </button>
                        <button class="btn-meal-primary" id="btn-save-draft" title="手动保存当前草稿 (快捷键: Ctrl+S)">
                            保存草稿
                        </button>
                        <button class="btn-meal-primary" id="btn-finalize-settlement" style="background: #059669; border-color: #047857;">
                            完成本月核定
                        </button>
                    </div>
                </div>

                <!-- ❷ KPI 统计卡片看板 -->
                <div class="meal-kpi-grid">
                    <div class="meal-kpi-card qifu">
                        <div class="meal-kpi-label">
                            <span>祺富机械用餐</span>
                            <span id="kpi-qifu-price-tag">¥15.00/份</span>
                        </div>
                        <div class="meal-kpi-count" id="kpi-qifu-count">0 份</div>
                        <div class="meal-kpi-amount">餐费合计: <strong id="kpi-qifu-amount" style="color: #1d4ed8;">¥ 0.00</strong></div>
                    </div>
                    <div class="meal-kpi-card jizhong">
                        <div class="meal-kpi-label">
                            <span>吉众机电用餐</span>
                            <span id="kpi-jizhong-price-tag">¥15.00/份</span>
                        </div>
                        <div class="meal-kpi-count" id="kpi-jizhong-count">0 份</div>
                        <div class="meal-kpi-amount">餐费合计: <strong id="kpi-jizhong-amount" style="color: #047857;">¥ 0.00</strong></div>
                    </div>
                    <div class="meal-kpi-card total">
                        <div class="meal-kpi-label">
                            <span>🍱 两公司总用餐</span>
                            <span>全月合计</span>
                        </div>
                        <div class="meal-kpi-count" id="kpi-total-count">0 份</div>
                        <div class="meal-kpi-amount">支出总额: <strong id="kpi-total-amount" style="color: #ea580c;">¥ 0.00</strong></div>
                    </div>
                    <div class="meal-kpi-card avg">
                        <div class="meal-kpi-label">
                            <span>📊 日均餐费支出</span>
                            <span>均摊标准</span>
                        </div>
                        <div class="meal-kpi-count" id="kpi-avg-amount">¥ 0.00</div>
                        <div class="meal-kpi-amount">经办权限: <span style="color: #10b981; font-weight: 600;">吉众/祺富互通</span></div>
                    </div>
                </div>

                <!-- ❸ 每日明细录入表格 -->
                <div class="meal-table-card">
                    <div class="meal-table-wrap">
                        <table class="meal-table" id="table-meal-records">
                            <thead>
                                <tr>
                                    <th style="width: 110px;">日期</th>
                                    <th style="width: 70px;">星期</th>
                                    <th style="width: 95px;">节假日/类型</th>
                                    <th style="width: 105px; background: #eff6ff; color: #1e40af;">祺富数量</th>
                                    <th style="width: 105px; background: #ecfdf5; color: #065f46;">吉众数量</th>
                                    <th style="width: 90px;">餐费单价</th>
                                    <th style="width: 110px; text-align: right;">祺富金额</th>
                                    <th style="width: 110px; text-align: right;">吉众金额</th>
                                    <th style="width: 105px;">用餐数量合计</th>
                                    <th style="width: 120px; text-align: right; font-weight: 700;">金额合计</th>
                                    <th style="min-width: 150px; text-align: left;">备注</th>
                                </tr>
                            </thead>
                            <tbody id="tbody-meal-records">
                                <tr><td colspan="11" style="text-align: center; padding: 40px; color: #94a3b8;">正在加载餐费数据...</td></tr>
                            </tbody>
                            <tfoot id="tfoot-meal-records">
                                <tr>
                                    <td colspan="3" style="text-align: center; font-weight: 700;">全月合计</td>
                                    <td id="foot-qifu-count" style="color: #1d4ed8; font-weight: 700;">0</td>
                                    <td id="foot-jizhong-count" style="color: #047857; font-weight: 700;">0</td>
                                    <td>—</td>
                                    <td id="foot-qifu-amount" style="text-align: right; font-weight: 700; color: #1d4ed8;">¥ 0.00</td>
                                    <td id="foot-jizhong-amount" style="text-align: right; font-weight: 700; color: #047857;">¥ 0.00</td>
                                    <td id="foot-total-count" style="font-weight: 700;">0</td>
                                    <td id="foot-total-amount" style="text-align: right; font-weight: 700; color: #ea580c;">¥ 0.00</td>
                                    <td></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            </div>
        `);
        this.page.main.append(this.$wrapper);

        // 挂载 AshanUI 组件
        if (window.AshanUI) {
            this.saveIndicator = window.AshanUI.createSaveIndicator(
                this.$wrapper.find('#mount-save-indicator'),
                { initialText: '草稿录入中' }
            );

            const self = this;
            this.periodSelector = window.AshanUI.renderPeriodSelector(
                this.$wrapper.find('#mount-period-selector'),
                {
                    currentYear: self.current_year,
                    currentMonth: self.current_month_num,
                    onChange: function(year, month) {
                        self.current_year = year;
                        self.current_month_num = month;
                        self.current_month = `${year}-${String(month).padStart(2, '0')}`;
                        self.load_data(self.current_month);
                    }
                }
            );

            // 注册全局快捷键 (Ctrl+S 保存草稿)
            window.AshanUI.bindGlobalHotkeys({
                onSave: () => {
                    self.save_data_explicit();
                }
            });
        }
    }

    bind_events() {
        const self = this;

        // 基准单价【💾 保存并应用】按钮
        this.$wrapper.find('#btn-apply-base-price').on('click', () => {
            self.apply_base_price_to_all();
        });

        // 基准单价输入框回车直接保存并应用
        this.$wrapper.find('#inp-base-price').on('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                self.apply_base_price_to_all();
            }
        });

        // 清空本月明细按钮
        this.$wrapper.find('#btn-clear-month').on('click', () => {
            self.clear_month_data();
        });

        // 按钮事件
        this.$wrapper.find('#btn-save-draft').on('click', () => {
            self.save_data_explicit();
        });

        this.$wrapper.find('#btn-finalize-settlement').on('click', () => {
            if (self.workbench_data && self.workbench_data.status === '已核定') {
                self.revert_settlement();
            } else {
                self.finalize_settlement();
            }
        });

        this.$wrapper.find('#btn-upload-excel').on('click', () => {
            self.open_upload_dialog();
        });

        this.$wrapper.find('#btn-export-excel').on('click', () => {
            self.export_excel();
        });

        this.$wrapper.find('#btn-print-summary').on('click', () => {
            self.print_summary();
        });
    }

    apply_base_price_to_all() {
        const newPrice = flt(this.$wrapper.find('#inp-base-price').val()) || 15.0;
        if (newPrice <= 0) {
            frappe.msgprint(__('基准单价必须大于 0 元/份！'));
            return;
        }

        if (this.workbench_data && this.workbench_data.status === '已核定') {
            frappe.msgprint(__('当前月份已核定锁定，无法修改基准单价！如需调整请先点击【取消核定】。'));
            return;
        }

        if (this.workbench_data && this.workbench_data.daily_records) {
            this.workbench_data.daily_records.forEach(r => {
                r.meal_price = newPrice;
            });
            this.workbench_data.default_meal_price = newPrice;
            this.recalculate_and_render_all();
            this.execute_save(false);
            frappe.show_alert({
                message: `✅ 基准单价已更新为 ${newPrice.toFixed(2)} 元/份，并已成功同步全月明细！`,
                indicator: 'green'
            }, 4);
        }
    }

    clear_month_data() {
        const self = this;
        if (this.workbench_data && this.workbench_data.status === '已核定') {
            frappe.msgprint(__('当前月份已核定锁定，无法清空数据！'));
            return;
        }

        frappe.confirm(
            `确定要清空 <b>${self.current_month}</b> 的所有用餐明细数据吗？<br><br><span style="color:#dc2626;">清空后用餐数量将全部重置为 0 份，金额清零。您可重新导入 Excel 或手动录入。</span>`,
            () => {
                frappe.call({
                    method: 'ashan_cn_procurement.services.meal_settlement.clear_meal_workbench_data',
                    args: { settlement_month: self.current_month },
                    callback: (r) => {
                        if (r.message) {
                            self.workbench_data = r.message;
                            self.render_data();
                            frappe.show_alert({ message: __('本月明细已清空'), indicator: 'blue' });
                        }
                    }
                });
            }
        );
    }

    load_data(month) {
        const self = this;
        frappe.call({
            method: 'ashan_cn_procurement.services.meal_settlement.get_meal_workbench_data',
            args: { settlement_month: month },
            callback: (r) => {
                if (r.message) {
                    self.workbench_data = r.message;
                    self.render_data();
                }
            }
        });
    }

    render_data() {
        const data = this.workbench_data;
        if (!data) return;

        const defaultPrice = flt(data.default_meal_price || 15.0);
        this.$wrapper.find('#inp-base-price').val(defaultPrice.toFixed(1));
        this.$wrapper.find('#kpi-qifu-price-tag, #kpi-jizhong-price-tag').text(`¥${defaultPrice.toFixed(2)}/份`);

        const isFinalized = data.status === '已核定';

        if (this.saveIndicator) {
            if (isFinalized) {
                this.saveIndicator.setLocked('🔒 已核定锁定');
            } else {
                this.saveIndicator.setSaved();
            }
        }

        if (isFinalized) {
            this.$wrapper.find('#btn-finalize-settlement')
                .text('↩️ 取消核定 (重新录入)')
                .css({ 'background': '#64748b', 'border-color': '#475569' });
            this.$wrapper.find('#inp-base-price, #btn-apply-base-price, #btn-clear-month, #btn-upload-excel, #btn-save-draft')
                .prop('disabled', true).css('opacity', '0.6');
        } else {
            this.$wrapper.find('#btn-finalize-settlement')
                .text('✅ 完成本月核定')
                .css({ 'background': '#059669', 'border-color': '#047857' });
            this.$wrapper.find('#inp-base-price, #btn-apply-base-price, #btn-clear-month, #btn-upload-excel, #btn-save-draft')
                .prop('disabled', false).css('opacity', '1');
        }

        this.render_kpis(data.kpis);
        this.render_table(data.daily_records, isFinalized);
    }

    render_kpis(kpis) {
        kpis = kpis || {};
        const fmt = window.AshanUI ? window.AshanUI.formatMoney : (v) => `¥ ${format_currency(v)}`;

        this.$wrapper.find('#kpi-qifu-count').text(`${kpis.qifu_total_count || 0} 份`);
        this.$wrapper.find('#kpi-qifu-amount').text(fmt(kpis.qifu_total_amount || 0));

        this.$wrapper.find('#kpi-jizhong-count').text(`${kpis.jizhong_total_count || 0} 份`);
        this.$wrapper.find('#kpi-jizhong-amount').text(fmt(kpis.jizhong_total_amount || 0));

        this.$wrapper.find('#kpi-total-count').text(`${kpis.grand_total_count || 0} 份`);
        this.$wrapper.find('#kpi-total-amount').text(fmt(kpis.grand_total_amount || 0));

        this.$wrapper.find('#kpi-avg-amount').text(`${fmt(kpis.average_daily_amount || 0)} / 天`);

        // 表尾汇总
        this.$wrapper.find('#foot-qifu-count').text(kpis.qifu_total_count || 0);
        this.$wrapper.find('#foot-qifu-amount').text(fmt(kpis.qifu_total_amount || 0));
        this.$wrapper.find('#foot-jizhong-count').text(kpis.jizhong_total_count || 0);
        this.$wrapper.find('#foot-jizhong-amount').text(fmt(kpis.jizhong_total_amount || 0));
        this.$wrapper.find('#foot-total-count').text(kpis.grand_total_count || 0);
        this.$wrapper.find('#foot-total-amount').text(fmt(kpis.grand_total_amount || 0));
    }

    render_table(records, isFinalized = false) {
        const self = this;
        const fmt = window.AshanUI ? window.AshanUI.formatMoney : (v) => `¥ ${format_currency(v)}`;
        const $tbody = this.$wrapper.find('#tbody-meal-records');
        $tbody.empty();

        if (!records || !records.length) {
            $tbody.html('<tr><td colspan="11" style="text-align: center; padding: 40px; color: #94a3b8;">本月暂无订餐数据</td></tr>');
            return;
        }

        records.forEach((r, idx) => {
            const isWeekend = r.day_of_week === '周六' || r.day_of_week === '周日';
            const rowClass = r.is_holiday ? 'row-holiday' : (isWeekend ? 'row-weekend' : '');
            let typeBadge = '<span style="color:#64748b; font-size:11px;">工作日</span>';
            if (r.is_holiday) {
                typeBadge = `<span style="background:#fef3c7; color:#b45309; padding:2px 6px; border-radius:4px; font-size:11px; font-weight:600;">${r.holiday_name || '节假日'}</span>`;
            } else if (isWeekend) {
                typeBadge = '<span style="background:#f1f5f9; color:#64748b; padding:2px 6px; border-radius:4px; font-size:11px;">周末</span>';
            }

            const disabledAttr = isFinalized ? 'disabled' : '';

            const $tr = $(`
                <tr class="${rowClass}" data-idx="${idx}">
                    <td><strong>${r.dining_date}</strong></td>
                    <td style="color: ${isWeekend ? '#ef4444' : '#475569'}; font-weight: ${isWeekend ? '600' : 'normal'};">${r.day_of_week}</td>
                    <td>${typeBadge}</td>
                    <td>
                        <input type="number" min="0" class="meal-input-count inp-qifu" data-field="qifu_count" value="${r.qifu_count}" ${disabledAttr} />
                    </td>
                    <td>
                        <input type="number" min="0" class="meal-input-count inp-jizhong" data-field="jizhong_count" value="${r.jizhong_count}" ${disabledAttr} />
                    </td>
                    <td>
                        <input type="number" step="0.5" class="meal-input-count inp-price" data-field="meal_price" value="${r.meal_price}" style="width: 55px; font-size: 12px;" ${disabledAttr} />
                    </td>
                    <td style="text-align: right; color: #1d4ed8; font-weight: 600;" class="cell-qifu-amt">${fmt(r.qifu_amount)}</td>
                    <td style="text-align: right; color: #047857; font-weight: 600;" class="cell-jizhong-amt">${fmt(r.jizhong_amount)}</td>
                    <td style="font-weight: 700;" class="cell-total-cnt">${r.total_count}</td>
                    <td style="text-align: right; font-weight: 700; color: #ea580c;" class="cell-total-amt">${fmt(r.total_amount)}</td>
                    <td>
                        <input type="text" class="meal-input-remark inp-remark" data-field="remark" value="${frappe.utils.escape_html(r.remark || '')}" placeholder="点击添加备注..." ${disabledAttr} />
                    </td>
                </tr>
            `);

            // 输入监听与防抖自动保存
            $tr.find('.meal-input-count, .meal-input-remark').on('input change', function() {
                const field = $(this).attr('data-field');
                const val = $(this).val();
                if (field === 'qifu_count' || field === 'jizhong_count') {
                    r[field] = cint(val || 0);
                } else if (field === 'meal_price') {
                    r[field] = flt(val || 15.0);
                } else {
                    r[field] = val;
                }
                self.recalculate_row(r, $tr);
                self.trigger_auto_save();
            });

            // 回车跳到下一行同列输入框
            $tr.find('.meal-input-count').on('keydown', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const field = $(this).attr('data-field');
                    const nextTr = $tr.next('tr');
                    if (nextTr.length) {
                        nextTr.find(`input[data-field="${field}"]`).focus().select();
                    }
                }
            });

            $tbody.append($tr);
        });
    }

    recalculate_row(r, $tr) {
        const fmt = window.AshanUI ? window.AshanUI.formatMoney : (v) => `¥ ${format_currency(v)}`;
        const price = flt(r.meal_price || 15.0);
        r.qifu_amount = flt(round(flt(r.qifu_count || 0) * price, 2));
        r.jizhong_amount = flt(round(flt(r.jizhong_count || 0) * price, 2));
        r.total_count = cint(r.qifu_count || 0) + cint(r.jizhong_count || 0);
        r.total_amount = flt(round(r.qifu_amount + r.jizhong_amount, 2));

        $tr.find('.cell-qifu-amt').text(fmt(r.qifu_amount));
        $tr.find('.cell-jizhong-amt').text(fmt(r.jizhong_amount));
        $tr.find('.cell-total-cnt').text(r.total_count);
        $tr.find('.cell-total-amt').text(fmt(r.total_amount));

        this.recalculate_totals_only();
    }

    recalculate_and_render_all() {
        this.render_data();
    }

    recalculate_totals_only() {
        const records = this.workbench_data.daily_records || [];
        let q_cnt = 0, q_amt = 0.0, j_cnt = 0, j_amt = 0.0;
        records.forEach(r => {
            q_cnt += cint(r.qifu_count || 0);
            q_amt += flt(r.qifu_amount || 0);
            j_cnt += cint(r.jizhong_count || 0);
            j_amt += flt(r.jizhong_amount || 0);
        });
        const kpis = {
            qifu_total_count: q_cnt,
            qifu_total_amount: flt(round(q_amt, 2)),
            jizhong_total_count: j_cnt,
            jizhong_total_amount: flt(round(j_amt, 2)),
            grand_total_count: q_cnt + j_cnt,
            grand_total_amount: flt(round(q_amt + j_amt, 2)),
            average_daily_amount: flt(round((q_amt + j_amt) / Math.max(1, records.length), 2))
        };
        this.workbench_data.kpis = kpis;
        this.render_kpis(kpis);
    }

    trigger_auto_save() {
        const self = this;
        clearTimeout(this.save_timeout);
        if (this.saveIndicator) {
            this.saveIndicator.setSaving('⏳ 正在自动保存...');
        }

        this.save_timeout = setTimeout(() => {
            self.execute_save(false);
        }, 800);
    }

    save_data_explicit() {
        clearTimeout(this.save_timeout);
        this.execute_save(true);
    }

    execute_save(show_alert = true) {
        const self = this;
        if (!this.workbench_data) return;

        frappe.call({
            method: 'ashan_cn_procurement.services.meal_settlement.save_meal_workbench_data',
            args: {
                settlement_month: self.current_month,
                records: JSON.stringify(self.workbench_data.daily_records || []),
                default_meal_price: flt(self.$wrapper.find('#inp-base-price').val()) || 15.0
            },
            callback: (r) => {
                if (r.message) {
                    self.workbench_data = r.message;
                    if (self.saveIndicator) {
                        self.saveIndicator.setSaved();
                    }
                    if (show_alert) {
                        frappe.show_alert({ message: __('草稿保存成功 (Ctrl+S)'), indicator: 'green' });
                    }
                }
            }
        });
    }

    finalize_settlement() {
        const self = this;
        frappe.confirm(__('确定完成本月餐费核定锁定？<br><br><span style="color:#b45309;">核定后本月用餐数据将进入只读保护状态。</span>'), () => {
            frappe.call({
                method: 'ashan_cn_procurement.services.meal_settlement.finalize_meal_settlement',
                args: { settlement_month: self.current_month },
                callback: (r) => {
                    if (r.message) {
                        self.workbench_data = r.message;
                        self.render_data();
                        frappe.show_alert({ message: __('本月餐费已核定锁定'), indicator: 'green' });
                    }
                }
            });
        });
    }

    revert_settlement() {
        const self = this;
        frappe.confirm(__('确定要取消当月餐费核定，恢复重新编辑吗？'), () => {
            frappe.call({
                method: 'ashan_cn_procurement.services.meal_settlement.revert_finalize_meal_settlement',
                args: { settlement_month: self.current_month },
                callback: (r) => {
                    if (r.message) {
                        self.workbench_data = r.message;
                        self.render_data();
                        frappe.show_alert({ message: __('已取消核定，恢复编辑状态'), indicator: 'blue' });
                    }
                }
            });
        });
    }

    open_upload_dialog() {
        const self = this;
        let selectedFile = null;

        const dlg = new frappe.ui.Dialog({
            title: __('📥 导入员工订餐 Excel 记录'),
            fields: [
                {
                    fieldtype: 'HTML',
                    fieldname: 'drop_html',
                    options: `
                        <div class="tax-dropzone-container" style="position: relative;">
                            <input type="file" id="meal-file-input" accept=".xlsx,.xls" style="position: absolute; top:0; left:0; width:100%; height:100%; opacity:0; cursor:pointer;" />
                            <div style="font-size: 32px; margin-bottom: 8px;">📊</div>
                            <div style="font-size: 14px; font-weight: 600; color: #1e293b;" id="meal-dropzone-text">点击或拖拽《订餐记录.xlsx》到此处</div>
                            <div style="font-size: 12px; color: #64748b; margin-top: 4px;">系统将自动精准识别 <b>${self.current_month}</b> 对应 Sheet 并智能提取祺富/吉众用餐数据</div>
                        </div>
                    `
                }
            ],
            primary_action_label: __('开始智能解析并导入'),
            primary_action: () => {
                if (!selectedFile) {
                    frappe.msgprint(__('请先选择要上传的 Excel 文件！'));
                    return;
                }

                const formData = new FormData();
                formData.append('file', selectedFile);
                formData.append('settlement_month', self.current_month);

                frappe.show_progress(__('正在解析订餐 Excel...'), 50, 100, __('正在读取对应月份工作表'));

                fetch('/api/method/ashan_cn_procurement.services.meal_settlement.upload_and_parse_meal_excel', {
                    method: 'POST',
                    headers: {
                        'X-Frappe-CSRF-Token': frappe.csrf_token
                    },
                    body: formData
                })
                .then(res => res.json())
                .then(r => {
                    frappe.hide_progress();
                    if (r.exc || r._server_messages) {
                        let err = r.exc || '';
                        try {
                            const msgs = JSON.parse(r._server_messages);
                            err = msgs.map(m => JSON.parse(m).message).join('<br>');
                        } catch (e) {}
                        frappe.msgprint({
                            title: __('Excel 解析未匹配'),
                            indicator: 'red',
                            message: err || __('未能从 Excel 中成功识别到当前月份数据，请检查工作表命名！')
                        });
                        return;
                    }

                    if (r.message && r.message.status === 'ok') {
                        dlg.hide();
                        self.workbench_data = r.message.data;
                        self.render_data();
                        frappe.msgprint({
                            title: __('Excel 解析导入成功'),
                            indicator: 'green',
                            message: `
                                <b>工作表：</b> ${r.message.sheet_name}<br>
                                <b>解析天数：</b> ${r.message.imported_days} 天<br>
                                <b>祺富总份数：</b> ${r.message.qifu_count} 份<br>
                                <b>吉众总份数：</b> ${r.message.jizhong_count} 份<br>
                                <b>餐费合计：</b> ¥ ${format_currency(r.message.total_amount)}
                            `
                        });
                    }
                })
                .catch(err => {
                    frappe.hide_progress();
                    frappe.msgprint(__('上传解析失败: ') + err);
                });
            }
        });

        dlg.show();

        dlg.$wrapper.find('#meal-file-input').on('change', function(e) {
            if (this.files && this.files[0]) {
                selectedFile = this.files[0];
                dlg.$wrapper.find('#meal-dropzone-text').html(`已选择: <b>${selectedFile.name}</b> (${(selectedFile.size / 1024).toFixed(1)} KB)`);
            }
        });
    }

    export_excel() {
        window.open(`/api/method/ashan_cn_procurement.services.meal_settlement.export_meal_excel?settlement_month=${this.current_month}`);
    }

    print_summary() {
        const data = this.workbench_data;
        if (!data) return;

        const kpis = data.kpis || {};
        const records = data.daily_records || [];

        let rowsHtml = '';
        records.forEach(r => {
            rowsHtml += `
                <tr>
                    <td style="border:1px solid #cbd5e1; padding:4px 6px; text-align:center;">${r.dining_date}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px 6px; text-align:center;">${r.day_of_week}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px 6px; text-align:center;">${r.is_holiday ? (r.holiday_name || '休') : '班'}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px 6px; text-align:right;">${r.qifu_count}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px 6px; text-align:right;">${r.jizhong_count}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px 6px; text-align:right;">${r.meal_price.toFixed(2)}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px 6px; text-align:right;">¥ ${r.qifu_amount.toFixed(2)}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px 6px; text-align:right;">¥ ${r.jizhong_amount.toFixed(2)}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px 6px; text-align:right; font-weight:bold;">${r.total_count}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px 6px; text-align:right; font-weight:bold;">¥ ${r.total_amount.toFixed(2)}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px 6px;">${r.remark || ''}</td>
                </tr>
            `;
        });

        const printHtml = `
            <html>
            <head>
                <title>员工订餐月度结算单 - ${this.current_month}</title>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "SimSun", sans-serif; padding: 20px; color: #000; }
                    h2 { text-align: center; margin-bottom: 4px; }
                    .sub-header { text-align: center; font-size: 13px; margin-bottom: 16px; color: #475569; }
                    .kpi-box { display: flex; justify-content: space-around; border: 1px solid #cbd5e1; padding: 10px; margin-bottom: 16px; border-radius: 6px; font-size: 13px; }
                    table { width: 100%; border-collapse: collapse; font-size: 12px; }
                    th { border: 1px solid #cbd5e1; background: #f1f5f9; padding: 6px; text-align: center; }
                    .footer-sign { display: flex; justify-content: space-between; margin-top: 24px; font-size: 13px; }
                </style>
            </head>
            <body>
                <h2>吉众机电 & 祺富机械 员工工作餐月度结算单</h2>
                <div class="sub-header">结算月份：<b>${this.current_month}</b> ｜ 基准单价：<b>¥${(data.default_meal_price || 15).toFixed(2)}/份</b> ｜ 打印时间：${frappe.datetime.now_datetime()}</div>
                <div class="kpi-box">
                    <div>祺富总用餐: <b>${kpis.qifu_total_count || 0} 份</b> (¥ ${(kpis.qifu_total_amount || 0).toFixed(2)})</div>
                    <div>吉众总用餐: <b>${kpis.jizhong_total_count || 0} 份</b> (¥ ${(kpis.jizhong_total_amount || 0).toFixed(2)})</div>
                    <div>全月总用餐: <b>${kpis.grand_total_count || 0} 份</b></div>
                    <div>全月餐费总额: <b style="color:#b91c1c;">¥ ${(kpis.grand_total_amount || 0).toFixed(2)}</b></div>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>日期</th>
                            <th>星期</th>
                            <th>属性</th>
                            <th>祺富(份)</th>
                            <th>吉众(份)</th>
                            <th>单价(元)</th>
                            <th>祺富金额</th>
                            <th>吉众金额</th>
                            <th>合计份数</th>
                            <th>合计金额</th>
                            <th>备注</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                    <tfoot>
                        <tr style="font-weight: bold; background: #f8fafc;">
                            <td colspan="3" style="border:1px solid #cbd5e1; text-align:center; padding:6px;">全月合计</td>
                            <td style="border:1px solid #cbd5e1; text-align:right; padding:6px;">${kpis.qifu_total_count || 0}</td>
                            <td style="border:1px solid #cbd5e1; text-align:right; padding:6px;">${kpis.jizhong_total_count || 0}</td>
                            <td style="border:1px solid #cbd5e1; text-align:center; padding:6px;">—</td>
                            <td style="border:1px solid #cbd5e1; text-align:right; padding:6px;">¥ ${(kpis.qifu_total_amount || 0).toFixed(2)}</td>
                            <td style="border:1px solid #cbd5e1; text-align:right; padding:6px;">¥ ${(kpis.jizhong_total_amount || 0).toFixed(2)}</td>
                            <td style="border:1px solid #cbd5e1; text-align:right; padding:6px;">${kpis.grand_total_count || 0}</td>
                            <td style="border:1px solid #cbd5e1; text-align:right; padding:6px; color:#b91c1c;">¥ ${(kpis.grand_total_amount || 0).toFixed(2)}</td>
                            <td style="border:1px solid #cbd5e1; padding:6px;"></td>
                        </tr>
                    </tfoot>
                </table>
                <div class="footer-sign">
                    <div>制表经办人：___________________</div>
                    <div>审核人：___________________</div>
                    <div>审批人：___________________</div>
                </div>
            </body>
            </html>
        `;

        const printWin = window.open('', '_blank');
        printWin.document.write(printHtml);
        printWin.document.close();
        printWin.focus();
        setTimeout(() => {
            printWin.print();
        }, 300);
    }
}
