// -*- coding: utf-8 -*-
frappe.pages['vehicle-toll-ledger'].on_page_load = function(wrapper) {
    // ❶ 立即设置背景色，防止白色闪屏（在任何 API 调用之前）
    $(wrapper).find('.layout-main-section').css({
        'background-color': '#f8f9fa',
        'min-height': 'calc(100vh - 60px)'
    });
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __('高速费月度台账'),
        single_column: true
    });
    wrapper.vehicle_toll_ledger = new VehicleTollLedger(wrapper, page);
};

frappe.pages['vehicle-toll-ledger'].on_page_show = function(wrapper) {
    // ❷ 每次显示此页面时也确保背景色（SPA 导航时也生效）
    $(wrapper).find('.layout-main-section').css({
        'background-color': '#f8f9fa',
        'min-height': 'calc(100vh - 60px)'
    });
    if (wrapper.vehicle_toll_ledger) {
        wrapper.vehicle_toll_ledger.refresh();
    }
};


/* ============================================================
   VehicleTollLedger — 离开单元格自动保存 · 6趟计费 · 车辆人员配置
   ============================================================ */
class VehicleTollLedger {
    constructor(wrapper, page) {
        this.wrapper = wrapper;
        this.page = page;
        this.$container = $(wrapper).find('.layout-main-section');

        const now = new Date();
        this.currentYear = now.getFullYear();
        this.currentMonth = now.getMonth() + 1;

        this.vehicles = [];
        this.activeVehicle = null;
        this.sheetData = null;
        this.isManager = false;
        this._autoSaveTimer = null;
        this._isDirty = false;
        this._saving = false;

        this.init_dom();
        this.bind_global_events();
        this.load_vehicles();
    }

    // ─── 固定6趟计费列定义 ───────────────────────────────────
    get_toll_routes() {
        return [
            {id: 'c1', name: '趟次 1'},
            {id: 'c2', name: '趟次 2'},
            {id: 'c3', name: '趟次 3'},
            {id: 'c4', name: '趟次 4'},
            {id: 'c5', name: '趟次 5'},
            {id: 'c6', name: '趟次 6'},
        ];
    }

    // ─── DOM 骨架 (上面看情况，操作放在下面，详情在最下方) ─────
    init_dom() {
        this.$container.html(`
        <div class="toll-ledger-wrapper">

            <!-- ❶ 顶部标题与状态（看情况） -->
            <div class="toll-header-bar">
                <div class="toll-title-box">
                    <h3 class="toll-page-title">🛣️ 高速费月度台账</h3>
                    <span id="toll-status-badge" class="toll-status-badge status-open">🟢 正常录入中</span>
                </div>
            </div>

            <!-- ❷ 4个 KPI 概览指标卡（看情况：期初、通行费、预支、期末） -->
            <div class="toll-kpi-grid" id="kpi-grid" style="display:none;">
                <div class="toll-kpi-card kpi-opening">
                    <div class="toll-kpi-title">期初结转余额</div>
                    <div class="toll-kpi-value" id="kpi-opening">¥ 0.00</div>
                </div>
                <div class="toll-kpi-card kpi-expense">
                    <div class="toll-kpi-title">本期通行费合计</div>
                    <div class="toll-kpi-value" id="kpi-expense">¥ 0.00</div>
                </div>
                <div class="toll-kpi-card kpi-deposit">
                    <div class="toll-kpi-title">本期公司预支/注入</div>
                    <div class="toll-kpi-value" id="kpi-deposit">¥ 0.00</div>
                </div>
                <div class="toll-kpi-card kpi-closing">
                    <div class="toll-kpi-title">期末结余</div>
                    <div class="toll-kpi-value" id="kpi-closing">¥ 0.00</div>
                </div>
            </div>

            <!-- ❸ 操作控制栏（日期选择、本月核定、车辆入池、自动保存状态，放在 KPI 下方、详情上方） -->
            <div class="toll-control-bar" id="toll-control-bar">
                <div class="toll-control-left">
                    <div class="toll-period-selector">
                        <button class="toll-btn-nav" id="btn-prev-month">◀</button>
                        <select id="sel-year" class="toll-select-period"></select>
                        <select id="sel-month" class="toll-select-period"></select>
                        <button class="toll-btn-nav" id="btn-next-month">▶</button>
                        <button class="toll-btn-nav" id="btn-cur-month">本月</button>
                    </div>
                    <div class="toll-actions">
                        <button class="toll-btn toll-btn-lock" id="btn-toggle-lock" style="display:none;">🔒 本月核定</button>
                        <button class="toll-btn toll-btn-secondary" id="btn-manage-vehicles">⚙️ 管理入池车辆</button>
                    </div>
                </div>
                <div class="toll-control-right">
                    <div class="toll-autosave-bar" id="toll-autosave-bar">
                        <div class="autosave-left">
                            <span id="autosave-status">数据已同步</span>
                        </div>
                        <div class="autosave-right">
                            <span class="autosave-tip">💡 按 Enter 换行首格 · 离开单元格自动同步</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- ❹ 车辆选项卡栏 -->
            <div class="toll-tabs-wrapper" id="toll-tabs-wrapper" style="display:none;">
                <div class="toll-tabs" id="toll-tabs-bar"></div>
            </div>

            <!-- ❺ 详情台账区域 -->
            <div class="toll-sheet-container" id="toll-sheet-container" style="display:none;">

                <!-- 车辆人员信息栏 -->
                <div class="toll-vehicle-info-bar" id="toll-vehicle-info-bar"></div>

                <div class="toll-table-wrapper">
                    <table class="toll-excel-table" id="toll-matrix-table">
                        <thead id="toll-thead"></thead>
                        <tbody id="toll-tbody"></tbody>
                        <tfoot id="toll-tfoot"></tfoot>
                    </table>
                </div>

                <!-- 公司预支流水面板 -->
                <div class="toll-deposit-panel" id="toll-deposit-panel">
                    <div class="toll-deposit-header">
                        <strong>💰 本月公司预支/注入流水</strong>
                        <button class="toll-btn toll-btn-deposit" id="btn-add-deposit">＋ 新增预支充值</button>
                    </div>
                    <div id="deposit-list-container"></div>
                </div>

                <div class="toll-footer-bar">
                    <div class="toll-shortcuts">
                        <span><kbd>Enter</kbd> 换行跳转至首格</span>
                        <span><kbd>Tab</kbd> 向右换格</span>
                        <span>离开单元格自动同步保存</span>
                    </div>
                </div>
            </div>

            <!-- 空态 -->
            <div class="toll-empty-state" id="toll-empty-state" style="display:none;">
                <div class="toll-empty-icon">🚗</div>

                <div class="toll-empty-title">暂无入池车辆</div>
                <div class="toll-empty-desc">点击上方「⚙️ 管理入池车辆」添加需要纳入高速费管理的车辆</div>
            </div>
        </div>`);

        // 年月下拉框填充
        const $yearSel = this.$container.find('#sel-year');
        const nowYear = new Date().getFullYear();
        for (let y = nowYear - 3; y <= nowYear + 2; y++) {
            $yearSel.append(`<option value="${y}">${y}年</option>`);
        }
        $yearSel.val(this.currentYear);

        const $monthSel = this.$container.find('#sel-month');
        for (let m = 1; m <= 12; m++) {
            $monthSel.append(`<option value="${m}">${m}月</option>`);
        }
        $monthSel.val(this.currentMonth);
    }

    // ─── 全局事件 ─────────────────────────────────────────────
    bind_global_events() {
        const self = this;
        const $c = this.$container;

        $c.find('#sel-year, #sel-month').on('change', () => {
            self.currentYear = parseInt($c.find('#sel-year').val());
            self.currentMonth = parseInt($c.find('#sel-month').val());
            if (self.activeVehicle) self.load_sheet();
        });
        $c.find('#btn-prev-month').on('click', () => self.shift_month(-1));
        $c.find('#btn-next-month').on('click', () => self.shift_month(1));
        $c.find('#btn-cur-month').on('click', () => {
            const now = new Date();
            self.currentYear = now.getFullYear();
            self.currentMonth = now.getMonth() + 1;
            self.update_period_ui();
            if (self.activeVehicle) self.load_sheet();
        });
        $c.find('#btn-toggle-lock').on('click', () => {
            if (!self.sheetData) return;
            self.sheetData.is_locked ? self.reopen_sheet() : self.close_sheet();
        });
        $c.find('#btn-manage-vehicles').on('click', () => self.open_manage_vehicles_dialog());
        $c.find('#btn-add-deposit').on('click', () => self.open_add_deposit_dialog());
    }

    shift_month(delta) {
        let m = this.currentMonth + delta;
        let y = this.currentYear;
        if (m > 12) { m = 1; y++; }
        if (m < 1) { m = 12; y--; }
        this.currentMonth = m;
        this.currentYear = y;
        this.update_period_ui();
        if (this.activeVehicle) this.load_sheet();
    }

    update_period_ui() {
        this.$container.find('#sel-year').val(this.currentYear);
        this.$container.find('#sel-month').val(this.currentMonth);
    }

    refresh() { this.load_vehicles(); }

    // ─── 加载入池车辆 ────────────────────────────────────────
    load_vehicles() {
        const self = this;
        self.set_save_status && self.set_save_status('loading');
        this.$container.find('#autosave-status').html('<span class="save-pending">⏳ 正在加载车辆列表...</span>');
        frappe.call({
            method: 'ashan_cn_procurement.ashan_cn_procurement.page.vehicle_toll_ledger.vehicle_toll_ledger.get_enrolled_vehicles',
            callback(r) {
                if (!r.message) return;
                self.vehicles = r.message.vehicles || [];
                self.isManager = r.message.is_manager;
                self.render_tabs();
            }
        });
    }

    // ─── 渲染车辆选项卡 ──────────────────────────────────────
    render_tabs() {
        const self = this;
        const $tabsBar = this.$container.find('#toll-tabs-bar');
        $tabsBar.empty();

        if (!this.vehicles.length) {
            this.$container.find('#toll-tabs-wrapper').hide();
            this.$container.find('#toll-sheet-container').hide();
            this.$container.find('#kpi-grid').hide();
            this.$container.find('#toll-empty-state').show();
            return;
        }

        this.$container.find('#toll-empty-state').hide();
        this.$container.find('#toll-tabs-wrapper').show();
        this.$container.find('#kpi-grid').show();

        this.vehicles.forEach(v => {
            const isActive = v.config_name === self.activeVehicle;
            const $tab = $(`
                <div class="toll-tab-item ${isActive ? 'active' : ''}" data-config="${v.config_name}">
                    <span class="toll-tab-icon">🚗</span>
                    <span class="toll-tab-label">${frappe.utils.escape_html(v.display_name)}</span>
                </div>
            `);
            $tab.on('click', () => {
                self.activeVehicle = v.config_name;
                self.$container.find('.toll-tab-item').removeClass('active');
                $tab.addClass('active');
                self.load_sheet();
            });
            $tabsBar.append($tab);
        });


        if (!this.activeVehicle || !this.vehicles.find(v => v.config_name === this.activeVehicle)) {
            this.activeVehicle = this.vehicles[0].config_name;
            $tabsBar.find('.toll-tab-item').first().addClass('active');
        }

        this.load_sheet();
    }

    // ─── 加载当前车辆当月台账 ───────────────────────────────
    load_sheet() {
        const self = this;
        if (!this.activeVehicle) return;

        this.$container.find('#autosave-status').html('<span class="save-pending">⏳ 正在加载台账数据...</span>');
        frappe.call({
            method: 'ashan_cn_procurement.ashan_cn_procurement.page.vehicle_toll_ledger.vehicle_toll_ledger.get_vehicle_monthly_sheet',
            args: {
                vehicle_config: self.activeVehicle,
                year: self.currentYear,
                month: self.currentMonth
            },
            callback(r) {
                if (r.message) {
                    self.sheetData = r.message;
                    self.render_sheet();
                }
            }
        });
    }

    // ─── 渲染台账表格 ─────────────────────────────────────────
    render_sheet() {
        const d = this.sheetData;
        const self = this;
        const $c = this.$container;
        const routes = this.get_toll_routes();

        $c.find('#toll-sheet-container').show();

        // 状态badge + 核定按钮
        const $badge = $c.find('#toll-status-badge');
        const $lockBtn = $c.find('#btn-toggle-lock');

        if (d.is_locked) {
            $badge.removeClass('status-open').addClass('status-locked')
                .html(`🔒 ${d.year}年${d.month}月已核定锁定`);
            $c.find('#toll-sheet-container').addClass('toll-sheet-locked');
            if (d.is_manager) {
                $lockBtn.show().removeClass('toll-btn-lock').addClass('toll-btn-unlock').html('🔓 取消核定');
            } else {
                $lockBtn.hide();
            }
        } else {
            $badge.removeClass('status-locked').addClass('status-open').html('🟢 正常录入中');
            $c.find('#toll-sheet-container').removeClass('toll-sheet-locked');
            if (d.is_manager) {
                $lockBtn.show().removeClass('toll-btn-unlock').addClass('toll-btn-lock').html('🔒 本月核定');
            } else {
                $lockBtn.hide();
            }
        }

        // 车辆人员信息栏（展示主要驾驶员，统一由车辆管理维护）
        const driverName = d.primary_user || d.vehicle_manager || '';
        const driverDisplay = driverName
            ? `<span class="info-chip driver-chip">👤 主要驾驶员: <b>${frappe.utils.escape_html(driverName)}</b></span>`
            : '';
        $c.find('#toll-vehicle-info-bar').html(`
            <div class="vehicle-info-left">
                <span class="info-veh-name">🚗 ${frappe.utils.escape_html(d.display_name)}</span>
                ${driverDisplay}
            </div>
            <div class="vehicle-info-right"></div>
        `);



        // 表头
        let thHtml = `<tr>
            <th style="width:110px;">日期</th>`;
        routes.forEach(r => {
            thHtml += `<th style="min-width:75px;">${r.name}</th>`;
        });
        thHtml += `
            <th style="min-width:80px;background:#fef2f2;color:#991b1b;">日合计</th>
            <th style="min-width:95px;background:#f0fdf4;color:#166534;">预支注入</th>
            <th style="min-width:95px;background:#f5f3ff;color:#5b21b6;">实时结余</th>
            <th style="min-width:110px;">备注</th>
        </tr>`;
        $c.find('#toll-thead').html(thHtml);

        // 表体：期初行
        let tbHtml = `<tr class="row-opening">
            <td class="cell-date">🔁 结转期初</td>`;
        routes.forEach(() => { tbHtml += `<td></td>`; });
        tbHtml += `
            <td></td><td></td>
            <td class="cell-readonly cell-balance" id="opening-bal-cell">
                ${d.is_locked
                    ? `<span class="cell-readonly">${fmt_cur(d.opening_balance)}</span>`
                    : `<input type="number" step="0.01" class="cell-input" id="input-opening" value="${d.opening_balance || 0}">`
                }
            </td>
            <td style="font-size:11px;color:#15803d;">上月期末结转</td>
        </tr>`;

        // 每日行
        (d.daily_records || []).forEach(r => {
            const weekendCls = r.is_weekend ? 'row-weekend' : '';
            tbHtml += `<tr class="${weekendCls}" data-day="${r.day}">
                <td class="cell-date">${r.date_display || r.date}</td>`;

            routes.forEach(route => {
                const val = (r.routes && r.routes[route.id]) ? r.routes[route.id] : '';
                tbHtml += `<td>
                    <input type="number" step="0.01" min="0" class="cell-input cell-route-input"
                           data-day="${r.day}" data-rid="${route.id}"
                           value="${val}" placeholder=""
                           ${d.is_locked ? 'disabled' : ''}>
                </td>`;
            });

            tbHtml += `
                <td class="cell-readonly cell-expense" id="exp-${r.day}">${r.expense > 0 ? fmt_cur(r.expense) : '—'}</td>
                <td class="cell-readonly cell-deposit" id="dep-${r.day}">${r.deposit > 0 ? `+${fmt_cur(r.deposit)}` : '—'}</td>
                <td class="cell-readonly cell-balance ${r.balance < 0 ? 'negative' : ''}" id="bal-${r.day}">${fmt_cur(r.balance)}</td>
                <td><input type="text" class="cell-input cell-remark-input" data-day="${r.day}"
                           value="${frappe.utils.escape_html(r.remark || '')}" placeholder="备注"
                           ${d.is_locked ? 'disabled' : ''}></td>
            </tr>`;
        });
        $c.find('#toll-tbody').html(tbHtml);

        // 表尾
        let tfHtml = `<tr class="row-summary">
            <td style="text-align:center;">📊 月度合计</td>`;
        routes.forEach(route => {
            tfHtml += `<td class="cell-readonly" id="sum-route-${route.id}">—</td>`;
        });
        tfHtml += `
            <td class="cell-readonly cell-expense" id="sum-expense">—</td>
            <td class="cell-readonly cell-deposit" id="sum-deposit">—</td>
            <td class="cell-readonly cell-balance" id="sum-balance">—</td>
            <td></td>
        </tr>`;
        $c.find('#toll-tfoot').html(tfHtml);

        this.bind_cell_events();
        this.recalculate();
        this.render_deposit_panel(d.deposit_records || []);

        this.set_save_status('idle');
    }

    // ─── 绑定单元格事件：离开单元格保存 + Enter/Tab 换格 ────────
    bind_cell_events() {
        const self = this;
        const $t = this.$container.find('#toll-matrix-table');

        // 输入时：标记脏数据，并触发界面实时计算
        $t.find('.cell-route-input, #input-opening').on('input', function() {
            self._isDirty = true;
            $(this).addClass('changed');
            self.recalculate();
            self.set_save_status('pending');

            // 1.5 秒空闲防抖辅助（用户停下不离开时也自动保底）
            clearTimeout(self._autoSaveTimer);
            self._autoSaveTimer = setTimeout(() => {
                if (self._isDirty) self.auto_save();
            }, 1500);
        });

        // 核心机制：离开单元格（blur / change）立即触发保存！
        $t.find('.cell-route-input, #input-opening').on('blur change', function() {
            clearTimeout(self._autoSaveTimer);
            if (self._isDirty || $(this).hasClass('changed')) {
                self.auto_save();
            }
        });

        // 备注输入框离开时保存
        $t.find('.cell-remark-input').on('change blur', function() {
            self.auto_save();
        });

        // 键盘导航：Enter 换行直接跳转到下一行的第一个单元格（趟次1）
        $t.find('.cell-input, .cell-remark-input').on('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                const $tr = $(this).closest('tr');
                const $nextRow = $tr.next('tr:not(.row-summary)');
                if ($nextRow.length) {
                    const $firstInp = $nextRow.find('.cell-input').first();
                    if ($firstInp.length) {
                        $firstInp.focus().select();
                    }
                }
            }
        });
    }


    // ─── 自动保存状态指示 ────────────────────────────────────
    set_save_status(state) {
        const $s = this.$container.find('#autosave-status');
        if (state === 'idle') {
            $s.html('<span class="save-idle">✅ 数据已同步</span>');
        } else if (state === 'pending') {
            $s.html('<span class="save-pending">⏳ 待保存...</span>');
        } else if (state === 'saving') {
            $s.html('<span class="save-saving">💾 正在保存中...</span>');
        } else if (state === 'ok') {
            const time = new Date().toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit', second: '2-digit'});
            $s.html(`<span class="save-ok">✅ 已自动保存 (${time})</span>`);
        } else if (state === 'err') {
            $s.html('<span class="save-err">❌ 自动保存失败，请检查网络</span>');
        }
    }

    // ─── 全表级联重算 ─────────────────────────────────────────
    recalculate() {
        const d = this.sheetData;
        if (!d) return;
        const routes = this.get_toll_routes();

        let opening = d.is_locked
            ? flt(d.opening_balance)
            : flt(this.$container.find('#input-opening').val());

        let curBal = opening;
        let totExp = 0, totDep = 0;
        const routeTotals = {};
        routes.forEach(r => routeTotals[r.id] = 0);

        this.$container.find('#toll-tbody tr[data-day]').each(function() {
            const $row = $(this);
            const dayNum = parseInt($row.attr('data-day'));

            let dayExp = 0;
            routes.forEach(route => {
                const v = flt($row.find(`.cell-route-input[data-rid="${route.id}"]`).val());
                dayExp += v;
                routeTotals[route.id] += v;
            });

            const dayRec = (d.daily_records || []).find(r => r.day === dayNum);
            const dayDep = dayRec ? flt(dayRec.deposit) : 0;

            curBal = curBal - dayExp + dayDep;
            totExp += dayExp;
            totDep += dayDep;

            $(`#exp-${dayNum}`).text(dayExp > 0 ? fmt_cur(dayExp) : '—');
            const $balCell = $(`#bal-${dayNum}`);
            $balCell.text(fmt_cur(curBal));
            $balCell.toggleClass('negative', curBal < 0);
        });

        routes.forEach(r => {
            $(`#sum-route-${r.id}`).text(routeTotals[r.id] > 0 ? fmt_cur(routeTotals[r.id]) : '—');
        });
        this.$container.find('#sum-expense').text(fmt_cur(totExp));
        this.$container.find('#sum-deposit').text(totDep > 0 ? `+${fmt_cur(totDep)}` : '—');
        const $sb = this.$container.find('#sum-balance');
        $sb.text(fmt_cur(curBal)).toggleClass('negative', curBal < 0);

        // KPI
        this.$container.find('#kpi-opening').text(`¥ ${fmt_cur(opening)}`);
        this.$container.find('#kpi-expense').text(`¥ ${fmt_cur(totExp)}`);
        this.$container.find('#kpi-deposit').text(`¥ ${fmt_cur(totDep)}`);
        this.$container.find('#kpi-closing').text(`¥ ${fmt_cur(curBal)}`);
    }

    // ─── 收集表格数据 ─────────────────────────────────────────
    collect_data() {
        const d = this.sheetData;
        const routes = this.get_toll_routes();
        const daily_records = [];

        this.$container.find('#toll-tbody tr[data-day]').each(function() {
            const $row = $(this);
            const dayNum = parseInt($row.attr('data-day'));
            const dateStr = `${d.year}/${String(d.month).padStart(2,'0')}/${String(dayNum).padStart(2,'0')}`;
            const routesData = {};
            routes.forEach(route => {
                const v = flt($row.find(`.cell-route-input[data-rid="${route.id}"]`).val());
                if (v > 0) routesData[route.id] = v;
            });
            const remark = $row.find('.cell-remark-input').val() || '';
            daily_records.push({ day: dayNum, date: dateStr, routes: routesData, remark });
        });

        return { daily_records };
    }

    // ─── 自动保存 ─────────────────────────────────────────────
    auto_save() {
        const self = this;
        if (this._saving || !this.activeVehicle || !this.sheetData) return;
        if (this.sheetData.is_locked) return;

        this._saving = true;
        this.set_save_status('saving');

        const payload = this.collect_data();
        frappe.call({
            method: 'ashan_cn_procurement.ashan_cn_procurement.page.vehicle_toll_ledger.vehicle_toll_ledger.save_vehicle_toll_sheet',
            args: {
                vehicle_config: self.activeVehicle,
                year: self.currentYear,
                month: self.currentMonth,
                daily_records: payload.daily_records,
                remark: ''
            },
            callback(r) {
                self._saving = false;
                if (r.message && r.message.success) {
                    self._isDirty = false;
                    self.$container.find('.cell-input').removeClass('changed');
                    self.set_save_status('ok');
                } else {
                    self.set_save_status('err');
                }
            },
            error() {
                self._saving = false;
                self.set_save_status('err');
            }
        });
    }

    // ─── 月度核定 / 解锁 ─────────────────────────────────────
    close_sheet() {
        const self = this;
        frappe.confirm(
            `确定核定锁定 <b>${self.currentYear}年${self.currentMonth}月</b>（${self.sheetData?.display_name}）吗？<br>核定后期末结存自动结转至下月期初。`,
            () => {
                // 先同步保存一次
                const payload = self.collect_data();
                frappe.call({
                    method: 'ashan_cn_procurement.ashan_cn_procurement.page.vehicle_toll_ledger.vehicle_toll_ledger.save_vehicle_toll_sheet',
                    args: {
                        vehicle_config: self.activeVehicle,
                        year: self.currentYear,
                        month: self.currentMonth,
                        daily_records: payload.daily_records,
                        remark: ''
                    },
                    callback() {
                        frappe.call({
                            method: 'ashan_cn_procurement.ashan_cn_procurement.page.vehicle_toll_ledger.vehicle_toll_ledger.close_vehicle_toll_sheet',
                            args: { vehicle_config: self.activeVehicle, year: self.currentYear, month: self.currentMonth },
                            freeze: true,
                            freeze_message: '正在执行月度核定...',
                            callback(r) {
                                if (r.message?.success) {
                                    frappe.msgprint({ title: '核定成功', indicator: 'green', message: r.message.message });
                                    self.load_sheet();
                                }
                            }
                        });
                    }
                });
            }
        );
    }

    reopen_sheet() {
        const self = this;
        frappe.confirm(`确定取消 <b>${self.currentYear}年${self.currentMonth}月</b>（${self.sheetData?.display_name}）的核定锁定吗？`, () => {
            frappe.call({
                method: 'ashan_cn_procurement.ashan_cn_procurement.page.vehicle_toll_ledger.vehicle_toll_ledger.reopen_vehicle_toll_sheet',
                args: { vehicle_config: self.activeVehicle, year: self.currentYear, month: self.currentMonth },
                freeze: true,
                callback(r) {
                    if (r.message?.success) {
                        frappe.show_alert({ message: r.message.message, indicator: 'blue' }, 4);
                        self.load_sheet();
                    }
                }
            });
        });
    }

    // ─── 预支流水面板 ─────────────────────────────────────────
    render_deposit_panel(deposits) {
        const self = this;
        const $list = this.$container.find('#deposit-list-container');
        $list.empty();

        if (!deposits.length) {
            $list.html(`<div class="deposit-empty">本月暂无预支/注入记录，点击右侧按钮新增</div>`);
            return;
        }

        let html = `<table class="deposit-table">
            <thead><tr>
                <th>预支日期</th><th>金额</th><th>预支方式</th><th>凭证号</th><th>备注</th>
                ${self.sheetData?.is_locked ? '' : '<th>操作</th>'}
            </tr></thead><tbody>`;

        deposits.forEach(dep => {
            html += `<tr>
                <td>${dep.deposit_date || ''}</td>
                <td class="dep-amount">+¥ ${fmt_cur(flt(dep.amount))}</td>
                <td>${dep.deposit_type || ''}</td>
                <td>${dep.reference_no || '—'}</td>
                <td>${dep.remark || '—'}</td>
                ${self.sheetData?.is_locked ? '' : `<td><button class="toll-btn-del-dep" data-name="${dep.name}">🗑</button></td>`}
            </tr>`;
        });
        html += `</tbody></table>`;
        $list.html(html);

        $list.find('.toll-btn-del-dep').on('click', function() {
            const depName = $(this).attr('data-name');
            frappe.confirm('确定删除此预支记录吗？', () => {
                frappe.call({
                    method: 'ashan_cn_procurement.ashan_cn_procurement.page.vehicle_toll_ledger.vehicle_toll_ledger.delete_toll_deposit',
                    args: { deposit_name: depName },
                    callback(r) {
                        if (r.message?.success) {
                            frappe.show_alert({ message: '预支记录已删除', indicator: 'orange' }, 3);
                            self.load_sheet();
                        }
                    }
                });
            });
        });
    }

    // ─── 新增预支 Dialog ──────────────────────────────────────
    open_add_deposit_dialog() {
        const self = this;
        const d = new frappe.ui.Dialog({
            title: `💰 新增公司预支/充值 — ${self.sheetData?.display_name || ''}`,
            fields: [
                { fieldname: 'deposit_date', fieldtype: 'Date', label: '预支/充值日期', reqd: 1, default: frappe.datetime.get_today() },
                { fieldname: 'amount', fieldtype: 'Currency', label: '预支金额 (元)', reqd: 1 },
                { fieldname: 'deposit_type', fieldtype: 'Select', label: '预支方式',
                  options: '现金预支\n公户转账\nETC自动充值\n其他', default: '现金预支' },
                { fieldname: 'reference_no', fieldtype: 'Data', label: '凭证号/流水号' },
                { fieldname: 'remark', fieldtype: 'Small Text', label: '备注' }
            ],
            primary_action_label: '确认保存',
            primary_action(values) {
                frappe.call({
                    method: 'ashan_cn_procurement.ashan_cn_procurement.page.vehicle_toll_ledger.vehicle_toll_ledger.add_toll_deposit',
                    args: {
                        vehicle_config: self.activeVehicle,
                        deposit_date: values.deposit_date,
                        amount: values.amount,
                        deposit_type: values.deposit_type,
                        reference_no: values.reference_no || '',
                        remark: values.remark || ''
                    },
                    freeze: true,
                    freeze_message: '正在保存预支记录...',
                    callback(r) {
                        if (r.message?.success) {
                            frappe.show_alert({ message: r.message.message, indicator: 'green' }, 4);
                            d.hide();
                            self.load_sheet();
                        }
                    }
                });
            }
        });
        d.show();
    }

    // ─── 修改主要驾驶员 Dialog（纯文本直接填写） ────────────────
    open_personnel_dialog() {
        const self = this;
        const d = self.sheetData;
        if (!d) return;

        const currentDriver = d.primary_user || d.vehicle_manager || '';
        const dlg = new frappe.ui.Dialog({
            title: `👤 主要驾驶员配置 — ${d.display_name}`,
            fields: [
                {
                    fieldname: 'driver_name',
                    fieldtype: 'Data',
                    label: '主要驾驶员姓名',
                    default: currentDriver,
                    description: '直接输入主要驾驶员名字（如“张三”、“张师傅”）'
                }
            ],
            primary_action_label: '保存驾驶员信息',
            primary_action(values) {
                frappe.call({
                    method: 'ashan_cn_procurement.ashan_cn_procurement.page.vehicle_toll_ledger.vehicle_toll_ledger.update_vehicle_personnel',
                    args: {
                        vehicle_config: self.activeVehicle,
                        primary_user: values.driver_name || '',
                        vehicle_manager: values.driver_name || ''
                    },
                    callback(r) {
                        if (r.message?.success) {
                            frappe.show_alert({ message: '主要驾驶员信息已更新！', indicator: 'green' }, 3);
                            dlg.hide();
                            self.load_sheet();
                        }
                    }
                });
            }
        });
        dlg.show();
    }

    // ─── 管理入池车辆 Dialog ──────────────────────────────────
    open_manage_vehicles_dialog() {
        const self = this;
        const d = new frappe.ui.Dialog({
            title: '⚙️ 管理高速费入池车辆',
            size: 'large',
            fields: [
                { fieldname: 'info_html', fieldtype: 'HTML',
                  options: `<div style="font-size:12px;color:#6b7280;margin-bottom:12px;">在此管理纳入高速费台账的车辆。只有在此加入的车辆才会出现在顶部选项卡中。</div>` },
                { fieldname: 'section_add', fieldtype: 'Section Break', label: '添加新车辆' },
                { fieldname: 'new_vehicle', fieldtype: 'Link', label: '选择车辆', options: 'Vehicle',
                  description: '从系统车辆档案中选择' },
                { fieldname: 'new_display_name', fieldtype: 'Data', label: '选项卡显示名称',
                  description: '如"津AF9527 (应急车)"，留空则使用车牌号' },
                { fieldname: 'col_break', fieldtype: 'Column Break' },
                { fieldname: 'new_primary_user', fieldtype: 'Data', label: '主要驾驶员姓名',
                  description: '直接填写主要驾驶员姓名（如“张师傅”）' },
                { fieldname: 'new_opening_balance', fieldtype: 'Currency', label: '初始期初余额 (启动资金)', default: 0 },
                { fieldname: 'section_cur', fieldtype: 'Section Break', label: '当前已入池车辆' },
                { fieldname: 'current_vehicles_html', fieldtype: 'HTML',
                  options: self._render_current_vehicles_html() }
            ],
            primary_action_label: '添加到入池',
            primary_action(values) {
                if (!values.new_vehicle) { frappe.msgprint('请先选择要添加的车辆！'); return; }
                frappe.call({
                    method: 'ashan_cn_procurement.ashan_cn_procurement.page.vehicle_toll_ledger.vehicle_toll_ledger.add_vehicle_to_toll',
                    args: {
                        vehicle: values.new_vehicle,
                        display_name: values.new_display_name || values.new_vehicle,
                        opening_balance: values.new_opening_balance || 0,
                        primary_user: values.new_primary_user || '',
                        vehicle_manager: values.new_primary_user || ''
                    },
                    freeze: true,
                    callback(r) {
                        if (r.message?.success) {
                            frappe.show_alert({ message: `车辆 ${values.new_vehicle} 已成功加入高速费管理！`, indicator: 'green' }, 4);
                            d.hide();
                            self.load_vehicles();
                        }
                    }
                });
            }
        });

        // 仅筛选“正常在用”车辆，封存停用车辆不予入池
        d.fields_dict.new_vehicle.get_query = function() {

            return {
                filters: [
                    ["Vehicle", "custom_vehicle_status", "!=", "封存停用"]
                ]
            };
        };

        // 选车后自动带出车辆档案中维护的主要驾驶员与备注用途
        d.fields_dict.new_vehicle.$input.on('change', function() {
            const veh = d.get_value('new_vehicle');
            if (veh) {
                frappe.db.get_value('Vehicle', veh, ['custom_primary_driver', 'custom_vehicle_remark', 'model'], (r) => {
                    if (r) {
                        if (r.custom_primary_driver && !d.get_value('new_primary_user')) {
                            d.set_value('new_primary_user', r.custom_primary_driver);
                        }
                        const tag = r.custom_vehicle_remark || r.model || '';
                        if (tag && !d.get_value('new_display_name')) {
                            d.set_value('new_display_name', `${veh} (${tag})`);
                        }
                    }
                });
            }
        });


        d.show();


        d.$wrapper.on('click', '.btn-deactivate-vehicle', function() {
            const configName = $(this).attr('data-config');
            const label = $(this).attr('data-label');
            frappe.confirm(`确定将 <b>${label}</b> 移出高速费管理吗？历史台账数据将保留。`, () => {
                frappe.call({
                    method: 'ashan_cn_procurement.ashan_cn_procurement.page.vehicle_toll_ledger.vehicle_toll_ledger.remove_vehicle_from_toll',
                    args: { vehicle_config: configName },
                    callback(r) {
                        if (r.message?.success) {
                            frappe.show_alert({ message: `已将 ${label} 移出高速费管理`, indicator: 'orange' }, 3);
                            d.hide();
                            if (self.activeVehicle === configName) self.activeVehicle = null;
                            self.load_vehicles();
                        }
                    }
                });
            });
        });
    }

    _render_current_vehicles_html() {
        if (!this.vehicles.length) return `<div style="color:#9ca3af;padding:8px;">暂无入池车辆</div>`;
        let html = `<table style="width:100%;font-size:13px;border-collapse:collapse;">
            <thead><tr style="background:#f8fafc;font-weight:600;">
                <th style="padding:6px 10px;border:1px solid #e2e8f0;">车辆</th>
                <th style="padding:6px 10px;border:1px solid #e2e8f0;">显示名称</th>
                <th style="padding:6px 10px;border:1px solid #e2e8f0;">主要驾驶员</th>
                <th style="padding:6px 10px;border:1px solid #e2e8f0;">操作</th>
            </tr></thead><tbody>`;
        this.vehicles.forEach(v => {
            const driver = v.primary_user || v.vehicle_manager || '—';
            html += `<tr>
                <td style="padding:6px 10px;border:1px solid #e2e8f0;">${frappe.utils.escape_html(v.vehicle || v.config_name)}</td>
                <td style="padding:6px 10px;border:1px solid #e2e8f0;">${frappe.utils.escape_html(v.display_name)}</td>
                <td style="padding:6px 10px;border:1px solid #e2e8f0;">${frappe.utils.escape_html(driver)}</td>
                <td style="padding:6px 10px;border:1px solid #e2e8f0;">
                    <button class="btn-deactivate-vehicle" data-config="${v.config_name}" data-label="${frappe.utils.escape_html(v.display_name)}"
                        style="background:#fef2f2;color:#dc2626;border:1px solid #fecaca;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:12px;">
                        移出
                    </button>
                </td>
            </tr>`;
        });
        html += `</tbody></table>`;
        return html;
    }

}

function fmt_cur(val) {
    return flt(val).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
