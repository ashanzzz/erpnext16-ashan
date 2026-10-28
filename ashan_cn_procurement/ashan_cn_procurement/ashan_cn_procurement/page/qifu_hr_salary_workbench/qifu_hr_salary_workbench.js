// ASHAN-UNIFIED-V2: completed-module refactor
frappe.pages['qifu-hr-salary-workbench'].on_page_load = function(wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __('祺富人事薪酬工作台'),
        single_column: true
    });

    let COMPANY = window.AshanWorkContext?.getCompany?.() || "天津祺富机械加工有限公司";
    if (!COMPANY.includes("祺富")) {
        COMPANY = "天津祺富机械加工有限公司";
    }
    const AshanTableColumns = window.AshanUI?.TableColumns;
    const initial_today = (frappe.datetime && frappe.datetime.get_today) ? frappe.datetime.get_today() : new Date().toISOString().slice(0, 10);
    // 薪资工作台核定账期默认取【上一个自然月】：8月打开应默认处理7月账单
    // 当月账期尚未到期，不应作为默认核定月份
    const _today_d = new Date(initial_today);
    const _prev = new Date(_today_d.getFullYear(), _today_d.getMonth() - 1, 1);
        function next_period(period) {
        const [year, month] = String(period).split("-").map(Number);
        if (!year || !month) return "";
        return month === 12
            ? `${year + 1}-01`
            : `${year}-${String(month + 1).padStart(2, "0")}`;
    }

    function format_payment_month_title(period) {
        const [year, month] = String(period || "").split("-").map(Number);
        return year && month ? `${year}年${month}月` : "";
    }


    let current_month = `${_prev.getFullYear()}-${String(_prev.getMonth() + 1).padStart(2, '0')}`;
    let current_tab = "employees"; // 默认第 1 个 Tab: 外部实发表与工资主表
    let salary_main_data = null;
    let salary_main_search = "";
    let salary_main_filter = "all";

    function setup_page_header_actions(locked, hasUploaded) {
        if (!page) return;
        page.set_title(__('祺富人事薪酬工作台'));
        if (page.clear_custom_actions) page.clear_custom_actions();
        if (page.clear_actions) page.clear_actions();
        if (page.clear_primary_action) page.clear_primary_action();
        // Hide primary action on workbench without removing DOM elements to preserve listview navigation
        $(page.wrapper).find('.primary-action').addClass('hide');
        // 彻底清空 Frappe Desk 顶栏浮动按钮，保持原生顶栏纯净，对齐吉众工作台标准架构
        update_qifu_header_lock_button(locked);
    }
    let current_history_mode = "all";
    let current_history_employee = "";
    let current_history_period = "";
    let history_full_cache = null;
    let recalculation_poll_timer = null;
    let last_recalc_status = null;
    let current_tax_view_mode = "full_68"; // 默认直接进入 68 列全量法定申报大宽表
    let cached_insurance_setting = null;
    let employee_master_rows = [];
    let cached_qifu_policies = [];

    function load_qifu_employee_type_policies(callback) {
        frappe.call({
            method: "frappe.client.get_list",
            args: {
                doctype: "Qifu Employee Type Policy",
                filters: { company: COMPANY, is_active: 1 },
                fields: ["name", "employee_type", "is_other", "participate_social_security", "participate_housing_fund", "participate_tax", "participate_payroll", "participate_workshop_roster", "participate_cash_bills"],
                order_by: "creation asc",
                limit_page_length: 50
            },
            callback: function(r) {
                cached_qifu_policies = r.message || [];
                if (typeof callback === "function") callback(cached_qifu_policies);
            }
        });
    }

    function get_qifu_active_employee_types(includeType) {
        let types = [];
        if (cached_qifu_policies && cached_qifu_policies.length) {
            types = cached_qifu_policies.filter(p => p.is_active !== 0).map(p => p.employee_type).filter(Boolean);
        }
        if (!types.length) {
            types = ['正式工', '返聘工', '临时工', '其他-返聘工', '其他-正式工'];
        }
        return types;
    }

    const html = `
    <div class="qifu-wb-wrapper ashan-domain-workbench ashan-qifu-workbench">
        <!-- 页面 Header (标准专业大标题与月度中枢) -->
        <div class="qifu-header jz-header">
            <div>
                <div class="qifu-title jz-title">
                    <span>祺富人事薪酬工作台</span>
                    <span class="jz-title-badge">月度核定</span>
                </div>
                <div class="qifu-subtitle jz-subtitle">
                    <span>月度人事薪酬中枢</span>
                    <span class="jz-subtitle-context">
                        核定账期 <strong id="qifu-payroll-period-text">${current_month}</strong>
                        <span aria-hidden="true">·</span>
                        社保账期 <strong id="qifu-payment-period-text">${next_period(current_month)}</strong>
                        <span class="qifu-lock-status-pill status-draft" id="qifu-lock-status-pill">草稿</span>
                    </span>
                </div>
            </div>
            <div class="qifu-header-controls jz-header-actions">
                <label class="jz-label-month">核定账期</label>
                <input type="month" id="qifu-month-select" class="form-control jz-month-input" value="${current_month}">
                <button type="button" class="btn btn-default btn-sm jz-btn-reset-month" id="btn-qifu-reset-month" title="重置本月：清空已上传外部实发表及测算数据，并重置各阶段核定进度">重置本月</button>
                <button type="button" class="btn btn-primary btn-sm jz-btn-lock-month" id="btn-qifu-header-lock">核定本月数据</button>
                <button type="button" class="btn btn-default btn-sm" id="btn-qifu-refresh-all">刷新数据</button>
            </div>
        </div>

        <!-- 兼容代理节点 -->
        <div class="qifu-header-proxy hide">
            <span id="qifu-company-title">祺富人事薪酬工作台</span>
            <select id="qifu-company-select" class="form-control"></select>
            <button type="button" id="proxy-qifu-header-lock"></button>
            <button type="button" id="proxy-qifu-refresh-all"></button>
            <div id="qifu-calc-center">
                <span id="calc-stat-synced">0</span>
                <span id="calc-stat-pending">0</span>
                <span id="calc-stat-running">0</span>
                <span id="calc-stat-failed">0</span>
                <span id="calc-last-time"></span>
                <span id="calc-engine-version"></span>
                <button id="btn-calc-task-log"></button>
                <button id="btn-server-recalc"></button>
            </div>
        </div>

        <div class="qifu-workflow-hub-proxy hide">
            <button id="btn-wf-lock-action"></button>
            <span id="workflow-overall-badge"></span>
            <span id="workflow-lock-status-badge"></span>
        </div>

        <!-- 业务页签 -->
        <div class="jz-nav-tabs qifu-nav-tabs">
            <button type="button" class="jz-tab-btn qifu-tab-btn active" data-tab="employees"><span class="tab-status-dot status-warn"></span>员工薪酬档案</button>
            <button type="button" class="jz-tab-btn qifu-tab-btn" data-tab="salary_main"><span class="tab-status-dot status-warn"></span>外部实发主表</button>
            <button type="button" class="jz-tab-btn qifu-tab-btn" data-tab="social_insurance"><span class="tab-status-dot status-warn"></span>社会保险</button>
            <button type="button" class="jz-tab-btn qifu-tab-btn" data-tab="housing_fund"><span class="tab-status-dot status-warn"></span>住房公积金</button>
            <button type="button" class="jz-tab-btn qifu-tab-btn" data-tab="tax"><span class="tab-status-dot status-warn"></span>个人所得税</button>
            <button type="button" class="jz-tab-btn qifu-tab-btn" data-tab="settlement"><span class="tab-status-dot status-warn"></span>综合结算</button>
            <button type="button" class="jz-tab-btn qifu-tab-btn" data-tab="history">历史数据</button>
        </div>

        <!-- Tab 1: 员工薪酬档案 · 权威母表底册 (基础根源) -->
        <div id="qifu-tab-employees" class="qifu-tab-content active">
            <div class="qifu-master-summary-grid">
                <div class="qifu-master-summary-card">
                    <div class="label">在册员工总数 / 状态</div>
                    <div class="value qifu-val-blue"><span id="tab1-kpi-total">—</span> 人</div>
                    <div class="sub" id="tab1-kpi-status-sub">当前在职 — 人 ｜ 离职 — 人</div>
                </div>
                <div class="qifu-master-summary-card">
                    <div class="label">固定工资金额总盘</div>
                    <div class="value qifu-val-green" id="tab1-kpi-fixed-salary">¥ 0.00</div>
                    <div class="sub" id="tab1-kpi-fixed-sub">固定薪资 — 人 ｜ 动态实发计薪 — 人</div>
                </div>
                <div class="qifu-master-summary-card">
                    <div class="label">岗位与住房车补总盘</div>
                    <div class="value qifu-val-amber" id="tab1-kpi-allowance">¥ 0.00</div>
                    <div class="sub" id="tab1-kpi-allowance-sub">职位补贴: ¥ 0.00 ｜ 房车补: ¥ 0.00</div>
                </div>
                <div class="qifu-master-summary-card">
                    <div class="label">社会保险申报基数总盘</div>
                    <div class="value qifu-val-blue" id="tab1-kpi-ss-base">¥ 0.00</div>
                    <div class="sub" id="tab1-kpi-ss-sub">在保 — 人 ｜ 最低基数标准</div>
                </div>
                <div class="qifu-master-summary-card">
                    <div class="label">住房公积金申报基数总盘</div>
                    <div class="value qifu-val-teal" id="tab1-kpi-hf-base">¥ 0.00</div>
                    <div class="sub" id="tab1-kpi-hf-sub">参缴 — 人 ｜ 长期策略执行</div>
                </div>
            </div>
            <div class="jz-toolbar jz-employee-toolbar qifu-toolbar">
                <div class="jz-toolbar-left">
                    <button type="button" class="btn btn-primary btn-sm jz-btn-blue" id="btn-qifu-new-emp">新建员工档案</button>
                    <button type="button" class="btn btn-default btn-sm" id="btn-qifu-batch-edit" title="编辑已勾选员工（单选直接编辑个人档案，多选批量办理离职或调整参数）">
                        编辑档案 <span class="jz-selected-count-badge" id="qifu-selected-count">0</span>
                    </button>
                    <button type="button" class="btn btn-default btn-sm" id="btn-qifu-employee-type-rules">用工性质规则</button>
                    <button type="button" class="btn btn-default btn-sm jz-btn-stage-confirmation" data-step="employees" id="btn-qifu-confirm-employees">确认本表</button>
                    <button type="button" class="btn btn-default btn-sm" id="btn-qifu-export-employees">导出</button>
                    <div class="jz-filter-group">
                        <span class="jz-filter-label">人员范围</span>
                        <div class="jz-segmented-control" id="qifu-emp-type-filter" role="group" aria-label="人员范围">
                            <button type="button" class="jz-segment-btn active" data-type="all" aria-pressed="true">全部人员</button>
                            <button type="button" class="jz-segment-btn" data-type="正式工" aria-pressed="false">正式工</button>
                            <button type="button" class="jz-segment-btn" data-type="返聘工" aria-pressed="false">返聘工</button>
                            <button type="button" class="jz-segment-btn" data-type="其他" aria-pressed="false">其他类型</button>
                            <button type="button" class="jz-segment-btn" data-type="临时工" aria-pressed="false">临时工</button>
                            <button type="button" class="jz-segment-btn" data-type="resigned" aria-pressed="false">当月离职</button>
                            <button type="button" class="jz-segment-btn" data-type="history_resigned" aria-pressed="false">已离职</button>
                        </div>
                    </div>
                </div>
                <div class="jz-toolbar-right">
                    <div class="ashan-search-unit">
                        <label class="ashan-filter-label jz-filter-label" for="qifu-emp-search">搜索</label>
                        <input type="text" class="form-control input-sm ashan-search-input jz-search-input" id="qifu-emp-search" placeholder="工号、姓名、证件、岗位...">
                    </div>
                    <span class="qifu-toolbar-count-badge" id="tab1-sheet-meta">共 0 人</span>
                    <span id="tab1-sheet-title" class="jz-hidden" aria-hidden="true"></span>
                </div>
            </div>
            <div class="qifu-table-box">
                <table class="qifu-table qifu-employee-master-table" id="table-qifu-emp">
                    <colgroup>
                        <col class="col-w-check" width="40">
                        <col class="col-w-seq" width="52">
                        <col class="qifu-col-employee-no" width="82">
                        <col class="qifu-col-employee-name" width="112">
                        <col class="qifu-col-alias" width="110">
                        <col class="qifu-col-identity-id" width="180">
                        <col class="qifu-col-identity-age" width="80">
                        <col class="qifu-col-identity-gender" width="60">
                        <col class="qifu-col-identity-type" width="118">
                        <col class="col-w-date" width="105">
                        <col class="qifu-col-employment" width="110">
                        <col class="qifu-col-salary" width="120">
                        <col class="col-w-amount" width="100">
                        <col class="col-w-amount" width="95">
                        <col class="col-w-amount" width="95">
                        <col class="qifu-col-policy" width="110">
                        <col class="col-w-amount" width="105">
                        <col class="qifu-col-policy" width="110">
                        <col class="col-w-amount" width="105">
                        <col class="qifu-col-policy" width="100">
                        <col class="col-w-amount" width="110">
                        <col class="qifu-col-identity-age" width="85">
                        <col class="col-w-period" width="100">
                        <col class="qifu-col-identity-age" width="95">
                        <col class="col-w-period" width="100">
                        <col class="qifu-col-status" width="95">
                        <col class="qifu-col-status" width="85">
                        <col class="qifu-col-status" width="95">
                        <col class="qifu-col-action" width="110">
                    </colgroup>
                    <thead><tr>
                        <th scope="col" class="col-w-check qifu-col-sticky-check"><input type="checkbox" id="check-all-tab1-employees" aria-label="全选当前筛选结果"></th>
                        <th scope="col" class="col-w-seq qifu-col-sticky-1">序号</th>
                        <th scope="col" class="qifu-col-employee-no qifu-col-sticky-2">工号</th>
                        <th scope="col" class="qifu-col-employee-name qifu-col-sticky-3">姓名</th>
                        <th scope="col" class="qifu-col-alias">姓名别名</th>
                        <th scope="col" class="qifu-col-identity-id">证件号码</th>
                        <th scope="col" class="qifu-col-identity-age">年龄</th>
                        <th scope="col" class="qifu-col-identity-gender">性别</th>
                        <th scope="col" class="qifu-col-identity-type">证件类型</th>
                        <th scope="col" class="col-w-date">出生日期</th>
                        <th scope="col" class="qifu-col-employment">用工性质</th>
                        <th scope="col" class="qifu-col-salary">计薪方式</th>
                        <th scope="col" class="col-w-amount">固定工资</th>
                        <th scope="col" class="col-w-amount">职位补贴</th>
                        <th scope="col" class="col-w-amount">房/车补</th>
                        <th scope="col" class="qifu-col-policy">社保方式</th>
                        <th scope="col" class="col-w-amount">社保基数</th>
                        <th scope="col" class="qifu-col-policy">公积金方式</th>
                        <th scope="col" class="col-w-amount">公积金基数</th>
                        <th scope="col" class="qifu-col-policy">公积金周期</th>
                        <th scope="col" class="col-w-amount">专项附加扣除</th>
                        <th scope="col" class="qifu-col-identity-age">原退休年龄</th>
                        <th scope="col" class="col-w-period">原退休年月</th>
                        <th scope="col" class="qifu-col-identity-age">延迟退休年龄</th>
                        <th scope="col" class="col-w-period">延迟退休年月</th>
                        <th scope="col" class="qifu-col-status">退休状态</th>
                        <th scope="col" class="qifu-col-status">在职状态</th>
                        <th scope="col" class="qifu-col-status">档案状态</th>
                        <th scope="col" class="qifu-col-action">操作</th>
                    </tr></thead>
                    <tbody id="tbody-qifu-emp"></tbody>
                    <tfoot id="tfoot-qifu-emp"></tfoot>
                </table>
            </div>
        </div>

        <!-- Tab 2: 外部实发表与工资主表 -->
        <div id="qifu-tab-salary_main" class="qifu-tab-content">
            <!-- 外部实发表解析统计卡片行 -->
            <div class="qifu-master-summary-grid qifu-salary-summary-grid" id="salary-main-summary-cards">
                <div class="qifu-master-summary-card">
                    <div class="label">发放总金额</div>
                    <div class="value qifu-val-green" id="sm-card-net">—</div>
                    <div class="sub" id="sm-card-net-sub">车间实发有薪 — 人 ｜ 0工资 — 人</div>
                </div>
                <div class="qifu-master-summary-card">
                    <div class="label">考勤部分总金额</div>
                    <div class="value qifu-val-blue" id="sm-card-gross">—</div>
                    <div class="sub" id="sm-card-gross-sub">车间考勤与计件实发总和</div>
                </div>
                <div class="qifu-master-summary-card">
                    <div class="label">补贴总金额</div>
                    <div class="value qifu-val-amber" id="sm-card-allowance">—</div>
                    <div class="sub" id="sm-card-allowance-sub">职位补贴: — ｜ 房车补: —</div>
                </div>
                <div class="qifu-master-summary-card">
                    <div class="label">扣款金额</div>
                    <div class="value qifu-val-red" id="sm-card-deduction">—</div>
                    <div class="sub" id="sm-card-deduction-sub">扣除: 0人 ¥ 0.00 ｜ 上班不足自付社保</div>
                </div>
                <div class="qifu-master-summary-card">
                    <div class="label">出勤规模与在册</div>
                    <div class="value" id="sm-card-attendance">—</div>
                    <div class="sub" id="sm-card-attendance-sub">在册全员共 — 人</div>
                </div>
            </div>

            <div class="jz-toolbar qifu-salary-toolbar qifu-toolbar">
                <div class="jz-toolbar-left qifu-toolbar-left">
                    <span class="qifu-source-badge hide" id="salary-main-source-badge">数据来源: 外部车间实发表</span>
                    <button type="button" class="btn btn-default btn-xs hide" id="btn-salary-view-proof">查看实发原件</button>
                    <button type="button" class="btn btn-primary btn-sm jz-btn-blue btn-salary-action-upload" id="btn-salary-integrated-action" title="直接选择本地车间实发 Excel 并导入">上传原件</button>
                    <button type="button" class="btn btn-default btn-sm hide" id="btn-salary-reupload" title="重新选择本地车间实发 Excel 覆盖上传">重新上传</button>
                    <button type="button" class="btn btn-default btn-sm jz-btn-stage-confirmation" data-step="salary_main" id="btn-qifu-confirm-salary-main" title="确认当期车间外部实发工资表">确认本表</button>
                    <button type="button" class="btn btn-default btn-sm" id="btn-salary-export-dist" title="导出 24 列车间薪资发放表">导出发放表</button>
                    <button type="button" class="btn btn-default btn-sm" id="btn-salary-print-dist" title="打印 / 导出 PDF">打印 / 导出 PDF</button>
                    <button type="button" class="btn btn-default btn-sm" id="btn-salary-table-layout" title="自定义列宽与显示顺序">列设置</button>
                    <div class="jz-filter-group">
                        <span class="jz-filter-label">实发范围</span>
                        <div class="jz-segmented-control" id="salary-main-scope-filter" role="group" aria-label="实发范围">
                            <button type="button" class="jz-segment-btn active" data-filter="all">全部人员</button>
                            <button type="button" class="jz-segment-btn" data-filter="workshop">外部实发有薪</button>
                            <button type="button" class="jz-segment-btn" data-filter="zero">0工资</button>
                        </div>
                    </div>
                </div>
                <div class="jz-toolbar-right qifu-toolbar-right">
                    <div class="ashan-search-unit">
                        <label class="ashan-filter-label jz-filter-label qifu-filter-label" for="salary-main-search-input">搜索</label>
                        <input type="text" class="form-control input-sm ashan-search-input jz-search-input qifu-search-input" id="salary-main-search-input" placeholder="工号、姓名...">
                    </div>
                    <span class="qifu-toolbar-count-badge" id="tab2-sheet-meta">共 0 人</span>
                    <span id="tab2-sheet-title" class="jz-hidden" aria-hidden="true"></span>
                </div>
            </div>
            <div class="qifu-table-box">
                <table class="qifu-table" id="salary-data-table">
                    <thead>
                        <tr>
                            <th class="qifu-col-sticky-1">序号</th>
                            <th class="qifu-col-sticky-2">工号</th>
                            <th class="qifu-col-sticky-3">姓名</th>
                            <th>工资月份</th>
                            <th class="qifu-text-right">出勤天数</th>
                            <th class="qifu-text-right">出勤工时</th>
                            <th class="qifu-text-right">职位补贴</th>
                            <th class="qifu-text-right">房/车补</th>
                            <th class="qifu-text-right">补贴合计</th>
                            <th class="qifu-text-right">扣款金额</th>
                            <th class="qifu-text-center">核实扣险</th>
                            <th class="qifu-text-right">实发金额</th>
                            <th class="qifu-text-center">匹配状态</th>
                            <th class="qifu-text-center">数据状态</th>
                            <th class="qifu-text-center">操作</th>
                        </tr>
                    </thead>
                    <tbody id="tbody-salary-main"></tbody>
                    <tfoot id="tfoot-salary-main"></tfoot>
                </table>
            </div>
            <div id="salary-main-empty" class="qifu-empty-panel hide">
                <div class="qifu-empty-title">当前账期【<span class="qifu-empty-month">${current_month}</span>】尚未解析外部实发表</div>
                <div class="qifu-empty-desc">请点击上方“上传原件”，直接选择车间导出的实发 Excel（.xlsx / .xls）即可开始解析与对账。</div>
            </div>
        </div>

        <!-- ========================================== -->
        <!-- Tab 3: 社会保险台账与申报核验 -->
        <!-- ========================================== -->
        <div id="qifu-tab-social_insurance" class="qifu-tab-content">
            <div class="qifu-master-summary-grid">
                <div class="qifu-master-summary-card">
                    <div class="label">单位社保合计比例</div>
                    <div class="value qifu-val-blue" id="ins-tab3-ss-comp">27.55 %</div>
                    <div class="sub">养老16% + 失业0.5% + 医疗10% + 其他0.5% + 工伤0.55%</div>
                </div>
                <div class="qifu-master-summary-card">
                    <div class="label">个人社保扣缴比例</div>
                    <div class="value qifu-val-green" id="ins-tab3-ss-pers">10.50 %</div>
                    <div class="sub">养老8% + 失业0.5% + 医疗2% (+大额救助22元/21元)</div>
                </div>
                <div class="qifu-master-summary-card">
                    <div class="label">参保总盘与基数下限</div>
                    <div class="value qifu-val-amber" id="ins-tab3-ss-base">5,013.00 元</div>
                    <div class="sub">在保员工最低基数标准</div>
                </div>
                <div class="qifu-master-summary-card">
                    <div class="label">实际缴费月社保核定总额</div>
                    <div class="value qifu-val-purple" id="ins-tab3-ss-grand">¥ 0.00</div>
                    <div class="sub" id="ins-tab3-ss-sub">单位: ¥ 0.00 | 个人: ¥ 0.00</div>
                </div>
            </div>

            <!-- 凭证智能比对与核验看板 -->
            <div id="tab3-proof-compare-panel" class="qifu-proof-compare-panel"></div>

            <!-- 工具栏 -->
            <div class="jz-toolbar qifu-toolbar">
                <div class="jz-toolbar-left qifu-toolbar-left">
                    <button type="button" class="btn btn-primary btn-sm jz-btn-blue qifu-btn-upload-ss" id="btn-tab3-upload-ss">上传税局社保申报表 (.pdf/.zip)</button>
                    <input type="file" id="qifu-ss-file-input" accept=".pdf,.zip" class="hide">
                    <button type="button" class="btn btn-default btn-sm btn-wf-download-file qifu-btn-view-proof hide" id="btn-tab3-view-ss-proof">查看税局原件</button>
                    <button type="button" class="btn btn-default btn-sm ashan-btn-secondary" id="btn-qifu-edit-ss-setting" title="设置社保最低基数、各险种缴纳比例与大额医疗标准">基数设置</button>
                    <button type="button" class="btn btn-default btn-sm ashan-btn-danger-outline qifu-btn-delete-proof hide" id="btn-tab3-delete-ss-proof">删除申报表</button>
                    <span id="tab3-proof-verify-badge" class="qifu-proof-status-badge hide"></span>
                    <button type="button" class="btn btn-default btn-sm qifu-btn-stage-confirmation" data-step="social_insurance" id="btn-tab3-confirm-ss" title="社保所属期与金额核验一致后核定放行">确认本表</button>
                    <span id="tab3-release-status" class="qifu-release-status" aria-live="polite"></span>
                    <div class="jz-filter-group">
                        <span class="jz-filter-label">人员范围</span>
                        <div class="jz-segmented-control" id="tab3-emp-filter" role="group" aria-label="人员范围">
                            <button type="button" class="jz-segment-btn active" data-type="all">全部人员</button>
                            <button type="button" class="jz-segment-btn" data-type="contributing">在保人员</button>
                            <button type="button" class="jz-segment-btn" data-type="stopped">停保人员</button>
                        </div>
                    </div>
                </div>
                <div class="jz-toolbar-right qifu-toolbar-right">
                    <div class="ashan-search-unit">
                        <label class="ashan-filter-label jz-filter-label qifu-filter-label" for="tab3-search">搜索</label>
                        <input type="text" class="form-control input-sm ashan-search-input jz-search-input" id="tab3-search" placeholder="工号、姓名、证件...">
                    </div>
                    <button type="button" class="btn btn-default btn-sm" id="btn-tab3-export-ss">导出明细</button>
                    <button type="button" class="btn btn-default btn-sm" id="btn-tab3-print-ss">打印 / 导出 PDF</button>
                    <span class="qifu-toolbar-count-badge" id="tab3-sheet-meta">在保 0 人</span>
                    <span id="tab3-sheet-title" class="jz-hidden" aria-hidden="true"></span>
                </div>
            </div>

            <!-- 19 列社保明细大表 -->
            <div class="qifu-table-box">
                <table class="qifu-table" id="table-tab3-ss-sheet">
                    <thead>
                        <tr>
                            <th class="qifu-col-sticky-1">序号</th>
                            <th class="qifu-col-sticky-2">工号</th>
                            <th class="qifu-col-sticky-3">姓名</th>
                            <th>证件号码</th>
                            <th>实际缴费所属期</th>
                            <th>用工性质</th>
                            <th class="qifu-money-cell">社保基数</th>
                            <th class="qifu-money-cell">单位养老</th>
                            <th class="qifu-money-cell">单位失业</th>
                            <th class="qifu-money-cell">单位医疗</th>
                            <th class="qifu-money-cell">单位其他医疗</th>
                            <th class="qifu-money-cell">单位工伤</th>
                            <th class="qifu-money-cell">单位合计</th>
                            <th class="qifu-money-cell">个人养老</th>
                            <th class="qifu-money-cell">个人失业</th>
                            <th class="qifu-money-cell">个人医疗</th>
                            <th class="qifu-money-cell">个人大额医疗</th>
                            <th class="qifu-money-cell">个人合计</th>
                            <th class="qifu-money-cell">总合计</th>
                        </tr>
                    </thead>
                    <tbody id="tbody-tab3-ss-sheet"></tbody>
                    <tfoot id="tfoot-tab3-ss-sheet"></tfoot>
                </table>
            </div>
        </div>

        <!-- ========================================== -->
        <!-- Tab 4: 住房公积金台账与自动规则 -->
        <!-- ========================================== -->
        <div id="qifu-tab-housing_fund" class="qifu-tab-content" style="display:none;">
            <div class="qifu-master-summary-grid">
                <div class="qifu-master-summary-card">
                    <div class="label">实际缴费月自动规则</div>
                    <div class="value qifu-val-teal" id="ins-tab4-rule-status">读取中</div>
                    <div class="sub" id="ins-tab4-rule-sub">缴纳月 1 / 4 / 7 / 10</div>
                </div>
                <div class="qifu-master-summary-card">
                    <div class="label">实际缴费月参缴人员</div>
                    <div class="value qifu-val-green" id="ins-tab4-contrib-count">0 人</div>
                    <div class="sub" id="ins-tab4-contrib-sub">公司规则 0 人 · 常年固定 0 人 · 单月例外 0 人</div>
                </div>
                <div class="qifu-master-summary-card">
                    <div class="label">比例与长期基数</div>
                    <div class="value qifu-val-amber" id="ins-tab4-rate-pair">5% / 5%</div>
                    <div class="sub" id="ins-tab4-hf-base">最低基数 ¥2,320.00</div>
                </div>
                <div class="qifu-master-summary-card">
                    <div class="label">当期公积金月缴存总额</div>
                    <div class="value qifu-val-purple" id="ins-tab4-hf-grand">¥ 0.00</div>
                    <div class="sub" id="ins-tab4-hf-sub">单位: ¥ 0.00 | 个人: ¥ 0.00</div>
                </div>
            </div>

            <!-- 凭证智能比对与核验看板 -->
            <div id="tab4-proof-compare-panel" class="qifu-proof-compare-panel"></div>

            <div class="jz-toolbar qifu-toolbar">
                <div class="jz-toolbar-left qifu-toolbar-left">
                    <button type="button" class="btn btn-primary btn-sm jz-btn-blue qifu-btn-upload-hf" id="btn-tab4-upload-hf">上传公积金缴存凭证 (.pdf/.zip)</button>
                    <button type="button" class="btn btn-default btn-sm btn-wf-download-file hide" id="btn-tab4-view-hf-proof">查看凭证原件</button>
                    <button type="button" class="btn btn-default btn-sm ashan-btn-secondary" id="btn-qifu-edit-hf-setting" title="设置公积金最低基数与缴存比例">基数设置</button>
                    <button type="button" class="btn btn-default btn-sm ashan-btn-danger-outline hide" id="btn-tab4-delete-hf-proof">删除凭证</button>
                    <span id="tab4-proof-verify-badge" class="qifu-proof-status-badge hide"></span>
                    <button type="button" class="btn btn-default btn-sm qifu-btn-stage-confirmation" data-step="housing_fund" id="btn-tab4-confirm-hf" title="公积金所属期与金额核验一致后核定放行">确认本表</button>
                    <span id="tab4-release-status" class="qifu-release-status" aria-live="polite"></span>
                    <div class="jz-filter-group">
                        <span class="jz-filter-label">人员范围</span>
                        <div class="jz-segmented-control" id="tab4-emp-filter" role="group" aria-label="人员范围">
                            <button type="button" class="jz-segment-btn active" data-type="all">全部人员</button>
                            <button type="button" class="jz-segment-btn" data-type="contributing">参缴人员</button>
                            <button type="button" class="jz-segment-btn" data-type="stopped">停缴人员</button>
                        </div>
                    </div>
                </div>
                <div class="jz-toolbar-right qifu-toolbar-right">
                    <div class="ashan-search-unit">
                        <label class="ashan-filter-label jz-filter-label qifu-filter-label" for="tab4-search">搜索</label>
                        <input type="text" class="form-control input-sm ashan-search-input jz-search-input" id="tab4-search" placeholder="工号、姓名、证件...">
                    </div>
                    <button type="button" class="btn btn-default btn-sm" id="btn-tab4-export-hf">导出明细</button>
                    <button type="button" class="btn btn-default btn-sm" id="btn-tab4-print-hf">打印 / 导出 PDF</button>
                    <span class="qifu-toolbar-count-badge" id="tab4-sheet-meta">参缴 0 人</span>
                    <span id="tab4-sheet-title" class="jz-hidden" aria-hidden="true"></span>
                </div>
            </div>

            <!-- 14 列公积金明细大表 -->
            <div class="qifu-table-box">
                <table class="qifu-table" id="table-tab4-hf-sheet">
                    <thead>
                        <tr>
                            <th class="qifu-col-sticky-1">序号</th>
                            <th class="qifu-col-sticky-2">工号</th>
                            <th class="qifu-col-sticky-3">姓名</th>
                            <th>用工性质</th>
                            <th class="qifu-money-cell">长期基数</th>
                            <th>长期策略</th>
                            <th>本月状态</th>
                            <th class="qifu-money-cell">有效基数</th>
                            <th class="qifu-money-cell">单位比例</th>
                            <th class="qifu-money-cell">单位金额</th>
                            <th class="qifu-money-cell">个人比例</th>
                            <th class="qifu-money-cell">个人金额</th>
                            <th class="qifu-money-cell">月缴存总额</th>
                            <th class="qifu-col-action">操作</th>
                        </tr>
                    </thead>
                    <tbody id="tbody-tab4-hf-sheet"></tbody>
                    <tfoot id="tfoot-tab4-hf-sheet"></tfoot>
                </table>
            </div>
        </div>

        <!-- ========================================== -->
        <!-- Tab 5:  5. 个人所得税依法预扣与申报台账 -->
        <!-- ========================================== -->
        <div id="qifu-tab-tax" class="qifu-tab-content" style="display:none;">
            <!-- 个税 KPI 指标看板 (税前工资合计、个税合计、税后工资合计核心五卡) -->
            <div class="qifu-master-summary-grid">
                <div class="qifu-master-summary-card">
                    <div class="label">税前工资合计</div>
                    <div class="value qifu-val-blue" id="tax-kpi-gross">¥ 0.00</div>
                    <div class="sub">应发计税收入总额 (倒推总盘)</div>
                </div>
                <div class="qifu-master-summary-card">
                    <div class="label">个税代扣合计</div>
                    <div class="value qifu-val-red" id="tax-kpi-total">¥ 0.00</div>
                    <div class="sub">全员当期个人所得税合计</div>
                </div>
                <div class="qifu-master-summary-card">
                    <div class="label">税后工资合计</div>
                    <div class="value qifu-val-green" id="tax-kpi-net">¥ 0.00</div>
                    <div class="sub">纳税全员税后实发到手总和</div>
                </div>
                <div class="qifu-master-summary-card">
                    <div class="label">扣除与减除费用总盘</div>
                    <div class="value qifu-val-amber" id="tax-kpi-ded">¥ 0.00</div>
                    <div class="sub">基本减除费用 + 险金 + 专项附加扣除</div>
                </div>
                <div class="qifu-master-summary-card">
                    <div class="label">纳税人数与申报期</div>
                    <div class="value" id="tax-kpi-count">—</div>
                    <div class="sub" id="tax-kpi-period">所属发薪账期: ${current_month}</div>
                </div>
            </div>

            <!-- 工具栏 -->
            <div class="jz-toolbar qifu-toolbar">
                <div class="jz-toolbar-left qifu-toolbar-left">
                    <button class="btn btn-default btn-sm" id="btn-qifu-edit-tax-setting">个税参数设置</button>
                    <span class="qifu-proof-status-badge" id="tab5-auto-verify-badge"></span>
                    <div class="jz-filter-group">
                        <span class="jz-filter-label">人员范围</span>
                        <div class="jz-segmented-control" id="tab5-emp-filter" role="group" aria-label="人员范围">
                            <button type="button" class="jz-segment-btn active" data-type="all">全部人员</button>
                            <button type="button" class="jz-segment-btn" data-type="taxable">应扣税人员</button>
                            <button type="button" class="jz-segment-btn" data-type="zero_tax">免扣税人员</button>
                        </div>
                    </div>
                </div>
                <div class="jz-toolbar-right qifu-toolbar-right">
                    <div class="ashan-search-unit">
                        <label class="ashan-filter-label jz-filter-label qifu-filter-label" for="tab5-search">搜索</label>
                        <input type="text" class="form-control input-sm ashan-search-input jz-search-input" id="tab5-search" placeholder="工号、姓名、证件...">
                    </div>
                    <button class="btn btn-default btn-sm" id="btn-tab5-export-tax" title="默认导出 VBA 同口径 68 列完整个税申报台账">导出申报明细</button>
                    <button class="btn btn-default btn-sm" id="btn-tab5-print-tax">打印 / 导出 PDF</button>
                    <span class="qifu-toolbar-count-badge" id="tab5-sheet-meta">全员 0 人</span>
                    <span id="tab5-sheet-title" class="jz-hidden" aria-hidden="true"></span>
                </div>
            </div>

            <!-- 个税明细：自适应冻结视口 -->
            <div class="qifu-table-box" id="tab5-table-box">
                <table class="qifu-table" id="table-tab5-tax-sheet">
                    <thead>
                        <tr>
                            <th class="qifu-col-sticky-1">序号</th>
                            <th class="qifu-col-sticky-2">工号</th>
                            <th class="qifu-col-sticky-3">姓名</th>
                            <th>证件号码</th>
                            <th>用工性质</th>
                            <th>发薪月份</th>
                            <th>本期税前收入</th>
                            <th>基本减除费用</th>
                            <th>社保个人扣缴</th>
                            <th>公积金个人扣缴</th>
                            <th>专项附加扣除</th>
                            <th>应纳税所得额</th>
                            <th class="qifu-text-center">适用税率</th>
                            <th>速算扣除数</th>
                            <th>本月应预扣税额</th>
                        </tr>
                    </thead>
                    <tbody id="tbody-tab5-tax-sheet"></tbody>
                    <tfoot id="tfoot-tab5-tax-sheet"></tfoot>
                </table>
            </div>
        </div>

        <!-- ========================================== -->
        <!-- Tab 6:  6. 月度薪酬综合核定与结算 (母表与老板娘混合总盘) -->
        <!-- ========================================== -->
        <div id="qifu-tab-settlement" class="qifu-tab-content" style="display:none;">
            <!-- 4 大黄金统筹 KPI 看板 -->
            <div class="qifu-master-summary-grid">
                <div class="qifu-master-summary-card">
                    <div class="label">在册员工总数 / 结构</div>
                    <div class="value qifu-val-blue"><span id="kpi-emp-total">—</span> 人</div>
                    <div class="sub" id="kpi-emp-sub">正式工 — 人 ｜ 返聘 — 人 ｜ 临时 — 人</div>
                </div>
                <div class="qifu-master-summary-card">
                    <div class="label">社会保险统筹总盘</div>
                    <div class="value qifu-val-blue" id="kpi-ss-grand">¥ 0.00</div>
                    <div class="sub" id="kpi-ss-sub">公司承担: ¥ 0.00 ｜ 个人代扣: ¥ 0.00</div>
                </div>
                <div class="qifu-master-summary-card">
                    <div class="label">住房公积金统筹总盘</div>
                    <div class="value qifu-val-teal" id="kpi-hf-grand">¥ 0.00</div>
                    <div class="sub" id="kpi-hf-sub">公司缴存: ¥ 0.00 ｜ 个人代扣: ¥ 0.00</div>
                </div>
                <div class="qifu-master-summary-card">
                    <div class="label">综合发薪实发总盘</div>
                    <div class="value qifu-val-green" id="kpi-total-net">¥ 0.00</div>
                    <div class="sub" id="kpi-total-sub">倒推税前: ¥ 0.00 ｜ 个税代扣: ¥ 0.00</div>
                </div>
                <div class="qifu-master-summary-card qifu-card-clickable" id="card-acc-summary" title="点击查看《记账工资表 (11列)》明细与导出">
                    <div class="label">记账工资表总盘 (导出对齐)</div>
                    <div class="value qifu-val-purple" id="kpi-acc-grand">¥ 0.00</div>
                    <div class="sub" id="kpi-acc-sub">
                        <div class="qifu-acc-sub-line" id="kpi-acc-dom-line">记账表: 税前 ¥ 0.00 ｜ 税后 ¥ 0.00</div>
                        <div class="qifu-acc-sub-line" id="kpi-acc-for-line">外籍表: 税前 ¥ 0.00 ｜ 税后 ¥ 0.00</div>
                    </div>
                </div>
            </div>

            <!-- 工具栏 -->
            <div class="jz-toolbar qifu-toolbar">
                <div class="jz-toolbar-left qifu-toolbar-left">
                    <button class="btn btn-default btn-sm" id="btn-view-salary-dist">薪资发放表 (24列)</button>
                    <button class="btn btn-default btn-sm" id="btn-view-acc-sheet">记账工资表 (11列)</button>
                    <div class="qifu-more-actions">
                        <button type="button" class="btn btn-default btn-sm qifu-more-trigger" id="btn-tab6-more" aria-expanded="false" aria-controls="qifu-tab6-more-menu">查看单项明细 ▾</button>
                        <div class="qifu-more-menu" id="qifu-tab6-more-menu" role="menu">
                            <button type="button" class="qifu-more-menu-item" id="btn-view-ins-sheet-modal">社会保险明细 (19列弹窗)</button>
                            <button type="button" class="qifu-more-menu-item" id="btn-view-hf-sheet-modal">住房公积金明细 (12列弹窗)</button>
                            <button type="button" class="qifu-more-menu-item" id="btn-view-tax-sheet-modal">个人所得税明细 (15列弹窗)</button>
                        </div>
                    </div>
                    <span class="qifu-proof-status-badge" id="tab6-auto-verify-badge"></span>
                    <div class="jz-filter-group">
                        <span class="jz-filter-label">人员范围</span>
                        <div class="jz-segmented-control" id="tab6-emp-filter" role="group" aria-label="人员范围">
                            <button type="button" class="jz-segment-btn active" data-type="all">全部人员</button>
                            <button type="button" class="jz-segment-btn" data-type="正式工">正式工</button>
                            <button type="button" class="jz-segment-btn" data-type="返聘工">返聘工</button>
                            <button type="button" class="jz-segment-btn" data-type="临时工">临时工</button>
                        </div>
                    </div>
                </div>
                <div class="jz-toolbar-right qifu-toolbar-right">
                    <div class="ashan-search-unit">
                        <label class="ashan-filter-label jz-filter-label qifu-filter-label" for="tab6-search">搜索</label>
                        <input type="text" class="form-control input-sm ashan-search-input jz-search-input" id="tab6-search" placeholder="工号、姓名...">
                    </div>
                    <button class="btn btn-default btn-sm" id="btn-export-accounting-xlsm" title="按参考 XLSM 的 11 列结构导出；外籍人员自动放入独立工作表">导出记账工资表</button>
                    <button class="btn btn-primary btn-sm jz-btn-blue" id="btn-export-excel-both" title="导出 7 张业务工作表；100/50/10/5/1 元配钞列仅在导出时按最终实发工资自动生成">导出全量 Excel（7 Sheet）</button>
                    <span class="qifu-toolbar-count-badge" id="tab6-sheet-meta">发薪 0 人</span>
                    <span id="tab6-sheet-title" class="jz-hidden" aria-hidden="true"></span>
                </div>
            </div>

            <!-- 薪酬核定明细表格 (顶部同步滑条与17列大宽表) -->
            <div class="qifu-table-box" id="tab6-table-box">
                <table class="qifu-table" id="table-qifu-payroll">
                    <thead>
                        <tr>
                            <th class="qifu-col-sticky-1">序号</th>
                            <th class="qifu-col-sticky-2">工号</th>
                            <th class="qifu-col-sticky-3">姓名</th>
                            <th>用工性质</th>
                            <th class="qifu-text-right">出勤天数</th>
                            <th class="qifu-text-right">出勤工时</th>
                            <th class="qifu-text-right">车间实发 (税后)</th>
                            <th class="qifu-text-right">职位补贴</th>
                            <th class="qifu-text-right">租房/车补</th>
                            <th class="qifu-text-right">当月总实发 (税后)</th>
                            <th class="qifu-text-right">税前应发工资 (倒推)</th>
                            <th class="qifu-text-right">社保个人代扣</th>
                            <th class="qifu-text-right">公积金个人代扣</th>
                            <th class="qifu-text-right">个税代扣</th>
                            <th class="qifu-text-right">社保单位统筹</th>
                            <th class="qifu-text-right">公积金单位缴纳</th>
                            <th>核算说明</th>
                        </tr>
                    </thead>
                    <tbody id="tbody-qifu-payroll">
                        <tr><td colspan="17" class="qifu-empty-cell">暂无当月核算数据，请点击上方【2. 外部实发导入与智能解析】上传车间实发表</td></tr>
                    </tbody>
                    <tfoot id="tfoot-qifu-payroll"></tfoot>
                </table>
            </div>
        </div>

        <!-- ========================================== -->
        <!-- Tab 7:  历史数据 · 个税申报周期累计总览 / 单人月度穿透 -->
        <!-- ========================================== -->
        <div id="qifu-tab-history" class="qifu-tab-content" style="display:none;">
            <div class="qifu-master-summary-grid">
                <div class="qifu-master-summary-card"><div class="label">申报周期</div><div class="value" id="history-kpi-cycle">—</div><div class="sub">按个税累计预扣周期归集</div></div>
                <div class="qifu-master-summary-card"><div class="label">纳税台账人数</div><div class="value qifu-val-blue" id="history-kpi-count">0 人</div><div class="sub">临时工/零工不进入；返聘类进入</div></div>
                <div class="qifu-master-summary-card"><div class="label">累计税前收入</div><div class="value qifu-val-green" id="history-kpi-gross">¥ 0.00</div><div class="sub">截至当前所选发薪账期</div></div>
                <div class="qifu-master-summary-card"><div class="label">累计已扣个税</div><div class="value qifu-val-red" id="history-kpi-tax">¥ 0.00</div><div class="sub">历史月度记录累计</div></div>
            </div>
            <div class="jz-toolbar qifu-toolbar">
                <div class="jz-toolbar-left qifu-toolbar-left">
                    <div class="qifu-history-mode-group">
                        <button class="btn btn-sm active" id="btn-history-all" style="font-weight:700;">周期累计 (15列)</button>
                        <button class="btn btn-sm" id="btn-history-full" style="font-weight:700;">完整核算 (68列+审计)</button>
                    </div>
                    <select class="form-control input-sm" id="history-emp-select" class="form-control input-sm qifu-history-select">
                        <option value="">全部在册人员</option>
                    </select>
                    <select class="form-control input-sm" id="history-period-select" class="form-control input-sm qifu-history-select qifu-hide"></select>
                    <button class="btn btn-default btn-sm" id="btn-history-back" style="display:none; font-weight:600;">← 返回全员总览</button>
                    <span id="history-current-person" style="font-size:12px; color:#475569; font-weight:600;"></span>
                </div>
                <div class="jz-toolbar-right qifu-toolbar-right">
                    <!-- 分页组件 (用于 68 列多记录翻页) -->
                    <div id="history-pagination-box" style="display:none; align-items:center; gap:5px; font-size:12px; color:#475569;">
                        <button class="btn btn-default btn-xs" id="btn-history-prev" style="font-weight:700; padding:2px 8px;">◀ 上一页</button>
                        <span>第 <strong id="history-page-cur" class="qifu-val-blue">1</strong> / <strong id="history-page-total">1</strong> 页 (共 <strong id="history-total-count">0</strong> 条)</span>
                        <button class="btn btn-default btn-xs" id="btn-history-next" style="font-weight:700; padding:2px 8px;">下一页 ▶</button>
                        <select class="form-control input-xs" id="history-page-size" style="width:82px; height:24px; padding:0 4px; font-size:11px; font-weight:600; display:inline-block;">
                            <option value="25" selected>25 条/页</option>
                            <option value="50">50 条/页</option>
                            <option value="100">100 条/页</option>
                            <option value="all">全部显示</option>
                        </select>
                    </div>
                    <span id="history-edit-hint" style="font-size:10.5px; color:#94a3b8;">冻结月份只读；未冻结月份可做受控历史更正</span>
                    <button class="btn btn-default btn-sm" id="btn-history-export" style="font-weight:600; color:#2563eb; border-color:#93c5fd;">导出当前历史视图</button>
                    <span class="qifu-toolbar-count-badge" id="history-sheet-meta">共 0 条</span>
                    <span id="history-sheet-title" class="jz-hidden" aria-hidden="true"></span>
                </div>
            </div>
            <div class="ashan-callout ashan-callout--md ashan-mb-3">
                历史数据以 <strong>Ashan Monthly Payroll Settlement / Item</strong> 月度快照为财务真值。支持查看周期累计或 <strong>VBA 68列 + ERP审计字段</strong>。支持全员/单人筛选与申报周期月份流水翻页。
            </div>
            <div class="qifu-table-box" id="history-table-box">
                <table class="qifu-table" id="table-history">
                    <thead id="thead-history"></thead>
                    <tbody id="tbody-history"><tr><td class="qifu-empty-cell">请点击上方模式或选择员工查看历史数据</td></tr></tbody>
                    <tfoot id="tfoot-history"></tfoot>
                </table>
            </div>
        </div>
    </div>
    `;

    var $container = $(html).appendTo(page.main);


    // ==========================================
    function normalize_salary_mode(mode, fixed_salary, employee_type) {
        mode = String(mode || '').trim();
        const isTemp = employee_type === '临时工' || employee_type === '零工';
        if (mode === '不税固定工资' || mode === '不税动态工资') return mode;
        if (mode.startsWith('不税') || mode.startsWith('免税')) {
            return (Number(fixed_salary) > 0 || mode.includes('固定')) ? '不税固定工资' : '不税动态工资';
        }
        if (isTemp) {
            if (mode === '税后固定工资' || mode === '税前固定工资' || Number(fixed_salary) > 0 || mode.includes('固定')) {
                return '不税固定工资';
            }
            return '不税动态工资';
        }
        if (mode === '税后固定工资' || mode === '税后动态工资' || mode === '税前固定工资' || mode === '税前动态工资') {
            return mode;
        }
        if (mode === '税后管理工资' || mode === '税后固定' || mode === '固定工资') return '税后固定工资';
        if (mode === '税前固定') return '税前固定工资';
        if (mode === '税前动态' || mode === '税前动态工资') return '税前动态工资';
        if (mode === '税后动态' || mode === '税后倒推') return '税后动态工资';
        if (mode === '税后') return Number(fixed_salary) > 0 ? '税后固定工资' : '税后动态工资';
        if (mode === '税前') return Number(fixed_salary) > 0 ? '税前固定工资' : '税前动态工资';
        if (Number(fixed_salary) > 0) return '税后固定工资';
        return '税后动态工资';
    }

    function get_mode_pill_class(mode) {
        if (mode === '不税固定工资') return 'mode-notax-fixed';
        if (mode === '不税动态工资') return 'mode-notax-dynamic';
        if (mode === '税前固定工资' || mode === '税后固定工资') return 'mode-fixed';
        return 'mode-dynamic';
    }

    function handle_salary_delete_click() {
        const wf = cached_workflow_status;
        const isConfirmed = Boolean(wf && wf.task2_import && wf.task2_import.is_confirmed);
        if (salary_main_data && salary_main_data.locked) {
            frappe.msgprint(__('当前账期已核定封账，处于只读保护状态，禁止删除外部实发表。'));
            return;
        }
        if (isConfirmed) {
            frappe.msgprint(__('外部实发工资主表已核定确认，处于受控只读状态。如需删除，请先在右上角【取消核定】。'));
            return;
        }
        frappe.confirm(
            __('确定要删除【' + current_month + '】已上传的车间实发表吗？<br><br>删除后将清除当月已导入的外部实发数据。'),
            function() {
                execute_delete_proof('salary', '车间实发表');
            }
        );
    }

    // 基础格式化方法
    // ==========================================
    // ASHAN-UNIFIED-V2: one display formatter for every payroll/tax tab.
    function fmtMoney(val) {
        return window.AshanUI?.formatMoney
            ? window.AshanUI.formatMoney(val)
            : frappe.format(Number(val || 0), { fieldtype: 'Currency' });
    }

    function fmtMoneyInt(val) {
        const n = Math.round(Number(val || 0));
        return '¥ ' + n.toLocaleString('zh-CN');
    }

    function escHtml(val) {
        return frappe.utils.escape_html(String(val == null ? '' : val));
    }


    function fmtDateTime(val) {
        if (!val) return '-';
        const text = String(val).replace('T', ' ');
        return text.length >= 19 ? text.slice(0, 19) : text;
    }

    function calcStatusBadge(status) {
        const st = status || '未计算';
        let cls = 'pending';
        if (['已计算', '成功', '已跳过'].includes(st)) cls = 'ok';
        else if (['计算中', '已入队', '排队中'].includes(st)) cls = 'running';
        else if (['失败', '部分完成', '计算失败'].includes(st)) cls = 'failed';
        return `<span class="qifu-calc-status-badge ${cls}">${st}</span>`;
    }

    function load_calculation_center() {}

    function refresh_after_recalculation() {
        load_monthly_workflow_hub();
        if (current_tab === 'salary_main') load_salary_main_tab();
        else if (current_tab === 'employees') load_qifu_employees();
        else if (current_tab === 'import') load_salary_distribution_tab();
        else if (current_tab === 'tax') load_tax_settlement_tab();
        else if (current_tab === 'settlement') load_payroll_settlement();
        else if (current_tab === 'history') load_history_tab();
        else if (current_tab === 'social_insurance') load_social_insurance_tab();
        else if (current_tab === 'housing_fund') load_housing_fund_tab();
    }

    // ==========================================
    // 外部实发主表核心加载与渲染引擎
    // ==========================================
    function load_salary_main_tab() {
        frappe.call({
            method: 'ashan_cn_procurement.services.payroll_settlement_service.get_payroll_settlement_detail',
            args: { company: COMPANY, period_month: current_month },
            callback: function(r) {
                if (!r.message) return;
                salary_main_data = r.message;
                const hasUploaded = Boolean(r.message.imported_excel_file && (r.message.items || []).length > 0);
                render_salary_main_table();
                setup_page_header_actions(Boolean(r.message.locked), hasUploaded);
                load_monthly_workflow_hub();
            }
        });
    }

    function render_salary_main_table() {
        if (!salary_main_data) return;
        const data = salary_main_data;
        const items = data.items || [];
        const isLocked = Boolean(data.locked);
        const hasUploaded = Boolean(data.imported_excel_file || items.some(it => (flt(it.attendance_days) > 0 || flt(it.work_hours) > 0) && flt(it.net_salary) > 0));

        // 更新顶部状态指示灯与账期说明
        $("#qifu-lock-status-pill")
            .text(isLocked ? "已核定锁定" : "待核定草稿")
            .toggleClass("status-locked", isLocked)
            .toggleClass("status-draft", !isLocked);

        // 外部文件原件归档与上传/附件信息整合按钮状态
        const $actionBtn = $("#btn-salary-integrated-action");
        const $reuploadBtn = $("#btn-salary-reupload");
        const wf = cached_workflow_status;
        const isSheetConfirmed = Boolean(wf && wf.task2_import && wf.task2_import.is_confirmed);
        const isSheetProtected = isLocked || isSheetConfirmed;
        if (hasUploaded) {
            $("#salary-main-source-badge").addClass("hide");
            $("#btn-salary-view-proof").addClass("hide").data("file", data.imported_excel_file);
            $reuploadBtn.addClass("hide");
            $actionBtn
                .text("附件信息")
                .removeClass("btn-primary jz-btn-blue btn-danger btn-salary-action-upload btn-salary-action-delete")
                .addClass("btn-default btn-salary-action-attachment")
                .prop("disabled", false)
                .attr("title", "查看车间实发表附件信息与解析结果");
        } else {
            const fixedCount = items.filter(it => ['税前固定工资', '税后固定工资', '不税固定工资'].includes(normalize_salary_mode(it.salary_mode, it.fixed_salary, it.employee_type)) && Number(it.fixed_salary || 0) > 0).length;
            if (fixedCount > 0) {
                $("#salary-main-source-badge").removeClass("hide").text(`数据来源: 档案固定工资 (${fixedCount}人 · 外部未上传)`);
            } else {
                $("#salary-main-source-badge").addClass("hide");
            }
            $("#btn-salary-view-proof").addClass("hide");
            $reuploadBtn.addClass("hide");
            $actionBtn
                .text("上传原件")
                .removeClass("btn-danger btn-default btn-salary-action-delete btn-salary-action-attachment")
                .addClass("btn-primary jz-btn-blue btn-salary-action-upload")
                .prop("disabled", isLocked)
                .attr("title", isLocked ? "本月已核定封账，禁止上传" : "直接选择本地车间实发 Excel 并导入");
        }

        setup_page_header_actions(isLocked, hasUploaded);

        if (!hasUploaded || items.length === 0) {
            $("#salary-data-table").addClass("hide");
            $("#salary-main-empty").removeClass("hide");
            $(".qifu-empty-month").text(current_month);
            $("#tbody-salary-main").empty();
            $("#tfoot-salary-main").empty();
            $("#sm-card-net").text("—");
            $("#sm-card-net-sub").text("车间实发有薪: — ｜ 0工资: —");
            $("#sm-card-gross").text("—");
            $("#sm-card-gross-sub").text("车间考勤与计件实发总和");
            $("#sm-card-allowance").text("—");
            $("#sm-card-allowance-sub").text("职位补贴: — ｜ 房车补: —");
            $("#sm-card-deduction").text("—");
            $("#sm-card-deduction-sub").text("扣除: 0人 ¥ 0.00 ｜ 上班不足自付社保");
            $("#sm-card-attendance").text("—");
            $("#sm-card-attendance-sub").text("出勤共 0 人");
            update_salary_main_confirmation_button();
            return;
        }

        $("#salary-data-table").removeClass("hide");
        $("#salary-main-empty").addClass("hide");

        // 搜索与人员分类筛选
        const query = String(salary_main_search || "").trim().toLowerCase();
        const visibleList = items.filter(it => {
            const itemMode = normalize_salary_mode(it.salary_mode, it.fixed_salary, it.employee_type);
            const isFixed = String(it.salary_mode || '').includes('固定') || ['税前固定工资', '税后固定工资', '不税固定工资'].includes(itemMode) || Number(it.fixed_salary || 0) > 0;
            // 铁律：固定薪资人员属性包含固定，不是动态计薪，绝对不写进外部实发主表！
            if (isFixed) {
                return false;
            }
            if (!hasUploaded) {
                return false;
            }
            const netVal = Math.round(flt(it.net_salary));
            if (salary_main_filter === "workshop") {
                if (netVal <= 0) return false;
            } else if (salary_main_filter === "zero") {
                if (netVal > 0) return false;
            }
            if (query) {
                const matchNo = String(it.employee_no || "").toLowerCase().includes(query);
                const matchName = String(it.employee_name || "").toLowerCase().includes(query);
                if (!matchNo && !matchName) return false;
            }
            return true;
        });

        let trs = "";
        let totAttDays = 0, totWorkHours = 0, totPostAllow = 0, totHcAllow = 0, totAllowances = 0, totDeduction = 0, totGross = 0, totNet = 0;
        let totAuditPass = 0, totAuditFail = 0;

        visibleList.forEach((it, idx) => {
            const attDays = flt(it.attendance_days) || flt(it.work_days) || 0;
            const workHours = flt(it.work_hours) || 0;
            const itemMode = normalize_salary_mode(it.salary_mode, it.fixed_salary, it.employee_type);
            const isFixed = ['税前固定工资', '税后固定工资', '不税固定工资'].includes(itemMode);
            const postAllow = isFixed ? 0 : flt(it.post_allowance);
            const hcAllow = isFixed ? 0 : flt(it.house_rent_allowance);
            const allowances = isFixed ? 0 : (flt(it.allowances_total) || (postAllow + hcAllow));
            const deduction = flt(it.deduction) || 0;
            const gross = flt(it.gross_salary) || 0;
            const net = flt(it.net_salary) || 0;

            totAttDays += attDays;
            totWorkHours += workHours;
            totPostAllow += postAllow;
            totHcAllow += hcAllow;
            totAllowances += allowances;
            totDeduction += deduction;
            totGross += gross;
            totNet += net;

            // 核实扣除审计计算（执行公司6月份起《通告书》规则：超10天扣50%个人社保，超15天扣100%个人社保）
            const audit = it.deduction_audit || {};
            const isPass = audit.status === "通过";
            if (isPass) totAuditPass++;
            else totAuditFail++;

            const auditHtml = isPass
                ? `<span class="qifu-audit-badge qifu-audit-pass" title="${escHtml(audit.message || '核实一致')}"><svg class="qifu-audit-icon" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.5 3.5 6.5-7"/></svg><span>通过</span></span>`
                : `<span class="qifu-audit-badge qifu-audit-error" title="${escHtml(audit.message || '核实存在差异')}"><svg class="qifu-audit-icon" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><line x1="8" y1="5" x2="8" y2="8.5"/><circle cx="8" cy="11.5" r="0.75" fill="currentColor"/></svg><span>错误</span></span>`;

            let matchStatusText = "已匹配档案";
            let matchStatusClass = "qifu-match-badge-ok";
            const rawMethod = String(it.source_match_method || "").trim();
            if (rawMethod === "exact_name" || rawMethod === "姓名匹配") {
                matchStatusText = "姓名精确匹配";
            } else if (rawMethod === "employee_no" || rawMethod === "工号匹配") {
                matchStatusText = "工号精确匹配";
            } else if (rawMethod.includes("alias") || rawMethod.includes("别名")) {
                matchStatusText = "别名识别匹配";
            } else if (rawMethod.includes("fuzzy") || rawMethod.includes("差异")) {
                matchStatusText = "智能校准匹配";
            } else if (rawMethod) {
                matchStatusText = rawMethod;
            } else if (net <= 0.001 && attDays <= 0) {
                matchStatusText = "未在实发表 (0工资)";
                matchStatusClass = "qifu-match-badge-zero";
            }

            const docStatusText = isLocked ? "已核定" : "草稿";
            const docStatusClass = isLocked ? "qifu-docstatus-locked" : "qifu-docstatus-draft";

            trs += `
            <tr class="qifu-salary-row" data-emp-no="${escHtml(it.employee_no || '')}" data-idx="${idx}">
                <td class="qifu-col-sticky-1 qifu-text-center qifu-col-seq">${idx + 1}</td>
                <td class="qifu-col-sticky-2 qifu-text-center"><strong>${escHtml(it.employee_no || '-')}</strong></td>
                <td class="qifu-col-sticky-3"><strong class="qifu-emp-name-text">${escHtml(it.employee_name)}</strong></td>
                <td class="qifu-text-center">${escHtml(current_month)}</td>
                <td class="qifu-money-cell">${attDays > 0 ? `${attDays} 天` : '-'}</td>
                <td class="qifu-money-cell">${workHours > 0 ? `${workHours} h` : '-'}</td>
                <td class="qifu-money-cell qifu-val-amber">${postAllow > 0 ? fmtMoney(postAllow) : '-'}</td>
                <td class="qifu-money-cell qifu-val-amber">${hcAllow > 0 ? fmtMoney(hcAllow) : '-'}</td>
                <td class="qifu-money-cell qifu-val-amber font-semibold">${allowances > 0 ? fmtMoney(allowances) : '-'}</td>
                <td class="qifu-money-cell qifu-val-red">${deduction > 0 ? fmtMoney(deduction) : '-'}</td>
                <td class="qifu-text-center">${auditHtml}</td>
                <td class="qifu-money-cell qifu-val-green font-bold">${fmtMoneyInt(net)}</td>
                <td class="qifu-text-center"><span class="qifu-match-status-pill ${matchStatusClass}">${escHtml(matchStatusText)}</span></td>
                <td class="qifu-text-center"><span class="qifu-docstatus-pill ${docStatusClass}">${docStatusText}</span></td>
                <td class="qifu-text-center qifu-action-cell col-w-action">
                    <button type="button" class="ashan-table-action-btn ashan-action-view btn-view-salary-detail" data-idx="${idx}" title="查看明细">查看</button>
                </td>
            </tr>`;
        });

        const paidCount = visibleList.filter(it => Math.round(flt(it.net_salary)) > 0).length;
        const zeroCount = visibleList.filter(it => Math.round(flt(it.net_salary)) === 0).length;
        $('#tab2-sheet-title').text(`${format_payment_month_title(current_month)}外部车间实发工资表`);
        $('#tab2-sheet-meta').text(visibleList.length === (paidCount + zeroCount) ? `实发共 ${visibleList.length} 人` : `当前展示：${visibleList.length}人`);

        $("#tbody-salary-main").html(trs);

        // 合计行
        const auditSummaryHtml = totAuditFail === 0
            ? `<span class="qifu-audit-badge qifu-audit-pass" title="全员扣款核对一致，无异常">全部通过 (${totAuditPass})</span>`
            : `<span class="qifu-audit-badge qifu-audit-error" title="存在考勤扣款异常人员，请核实">通过 ${totAuditPass} ｜ 差异 ${totAuditFail}</span>`;

        const tfootHtml = `
        <tr>
            <td colspan="3" class="qifu-col-sticky-foot">合计 (${visibleList.length}人)</td>
            <td class="qifu-text-center">${current_month}</td>
            <td class="qifu-money-cell">${totAttDays > 0 ? `${totAttDays.toFixed(1)} 天` : '-'}</td>
            <td class="qifu-money-cell">${totWorkHours > 0 ? `${totWorkHours.toFixed(1)} h` : '-'}</td>
            <td class="qifu-money-cell qifu-val-amber">${fmtMoney(totPostAllow)}</td>
            <td class="qifu-money-cell qifu-val-amber">${fmtMoney(totHcAllow)}</td>
            <td class="qifu-money-cell qifu-val-amber font-bold">${fmtMoney(totAllowances)}</td>
            <td class="qifu-money-cell qifu-val-red">${fmtMoney(totDeduction)}</td>
            <td class="qifu-text-center">${auditSummaryHtml}</td>
            <td class="qifu-money-cell qifu-val-green font-bold">${fmtMoneyInt(totNet)}</td>
            <td class="qifu-text-center">-</td>
            <td class="qifu-text-center">-</td>
            <td class="qifu-text-center">-</td>
        </tr>`;
        $("#tfoot-salary-main").html(tfootHtml);

        const kpi = data.kpi_summary || {};
        const dynNet = kpi.dynamic_net !== undefined ? flt(kpi.dynamic_net) : items.filter(it => String(it.salary_mode || "").includes("动态")).reduce((s, it) => s + flt(it.net_salary), 0);
        const fixNet = kpi.fixed_net !== undefined ? flt(kpi.fixed_net) : items.filter(it => String(it.salary_mode || "").includes("固定")).reduce((s, it) => s + flt(it.net_salary), 0);
        const dynGross = kpi.dynamic_gross !== undefined ? flt(kpi.dynamic_gross) : items.filter(it => String(it.salary_mode || "").includes("动态")).reduce((s, it) => s + flt(it.gross_salary), 0);
        const fixGross = kpi.fixed_gross !== undefined ? flt(kpi.fixed_gross) : items.filter(it => String(it.salary_mode || "").includes("固定")).reduce((s, it) => s + flt(it.gross_salary), 0);

        const regularCount = items.filter(it => (it.employee_type || "正式工") === "正式工").length;
        const rehireCount = items.filter(it => ["返聘工", "退休返聘", "其他-返聘工"].includes(it.employee_type || "")).length;
        const otherCount = items.length - regularCount - rehireCount;

        const standardDays = kpi.standard_days || (items.length > 0 ? 26.0 : 0);
        const standardHours = kpi.standard_hours || 0;

        const dedCount = kpi.deduction_count !== undefined ? kpi.deduction_count : items.filter(it => flt(it.deduction) > 0).length;
        const dedTotal = kpi.deduction_total !== undefined ? flt(kpi.deduction_total) : items.reduce((s, it) => s + flt(it.deduction), 0);
        const taxEmpCount = kpi.tax_emp_count !== undefined ? kpi.tax_emp_count : items.filter(it => flt(it.tax_amount) > 0).length;

        const totalTaxAmt = flt(data.total_tax) || items.reduce((s, it) => s + flt(it.tax_amount), 0);

        $("#sm-card-net").text(fmtMoneyInt(totNet));
        $("#sm-card-net-sub").text(`车间实发有薪: ${paidCount}人 ｜ 0工资: ${zeroCount}人`);

        const totWorkshopNet = Math.max(0, totNet - Math.round(totAllowances));
        $("#sm-card-gross").text("¥ " + totWorkshopNet.toLocaleString("zh-CN", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
        $("#sm-card-gross-sub").text("车间考勤与计件实发总和");

        $("#sm-card-allowance").text(fmtMoneyInt(totAllowances));
        $("#sm-card-allowance-sub").text(`职位补贴: ${fmtMoney(totPostAllow)} ｜ 房车补: ${fmtMoney(totHcAllow)}`);

        $("#sm-card-deduction").text(fmtMoney(totDeduction));
        $("#sm-card-deduction-sub").text(dedCount > 0
            ? `扣除: ${dedCount}人 ${fmtMoney(totDeduction)} ｜ 上班不足自付个人社保`
            : `扣除: 0人 ¥ 0.00 ｜ 上班充足 · 公司承担个人社保`
        );

        $("#sm-card-attendance").text(`${totAttDays > 0 ? totAttDays.toFixed(1) : "0.0"} 天 / ${totWorkHours > 0 ? totWorkHours.toFixed(1) : "0.0"} h`);
        $("#sm-card-attendance-sub").text(`全勤: ${standardDays}天 ｜ 正式工: ${regularCount}人 ｜ 返聘: ${rehireCount}人 ｜ 其他: ${otherCount}人`);
        update_salary_main_confirmation_button();

        // 注册到 AshanTableColumns 供用户自定义列宽与显隐
        // 注册到 AshanTableColumns 供用户自定义列宽与显隐
        if (AshanTableColumns && typeof AshanTableColumns.getColumn === "function") {
            // Available for user-driven layout changes via 列设置
        }
        setTimeout(adjust_active_table_height, 50);
    }

    function open_qifu_salary_item_detail_dialog(item) {
        if (!item) return;

        let rawJsonHtml = "";
        if (item.source_raw_json) {
            try {
                const parsed = typeof item.source_raw_json === "string" ? JSON.parse(item.source_raw_json) : item.source_raw_json;
                rawJsonHtml = `
                <details class="qifu-detail-raw-json">
                    <summary class="qifu-raw-json-summary">查看 Excel 原始单元格解析快照</summary>
                    <pre class="qifu-raw-json-box">${escHtml(JSON.stringify(parsed, null, 2))}</pre>
                </details>`;
            } catch (e) {}
        }

        const d = new frappe.ui.Dialog({
            title: `工资明细 - ${item.employee_name} (${item.employee_no || '-'})`,
            size: "large",
            fields: [
                {
                    fieldname: "content_html",
                    fieldtype: "HTML"
                }
            ],
            primary_action_label: __("关闭"),
            primary_action() { d.hide(); }
        });

        const normMode = normalize_salary_mode(item.salary_mode, item.fixed_salary, item.employee_type);
        const isFixedMode = ['税前固定工资', '税后固定工资', '不税固定工资'].includes(normMode);
        const audit = item.deduction_audit || {};
        const isAuditPass = audit.status === "通过";
        let rawWsNet = 0;
        if (item.source_raw_json) {
            try {
                const parsed = typeof item.source_raw_json === "string" ? JSON.parse(item.source_raw_json) : item.source_raw_json;
                rawWsNet = flt(parsed["实发工资"] || parsed["workshop_net"] || 0);
            } catch(e) {}
        }
        const calcWorkshop = rawWsNet > 0 
            ? rawWsNet 
            : ((flt(item.day_salary) + flt(item.hour_salary) + flt(item.full_attendance) + flt(item.overtime_salary) + flt(item.national_salary) + flt(item.target_salary) - flt(item.deduction) + flt(item.salary_adjustment || 0)) || (flt(item.net_salary) - flt(item.allowances_total || 0)));
        const netSalaryInt = Math.round(flt(item.net_salary)) || Math.round(calcWorkshop + flt(item.allowances_total || 0));
        const detailAuditBadge = isAuditPass
            ? `<span class="qifu-audit-badge qifu-audit-pass"><svg class="qifu-audit-icon" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.5 3.5 6.5-7"/></svg><span>通过</span></span>`
            : `<span class="qifu-audit-badge qifu-audit-error"><svg class="qifu-audit-icon" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><line x1="8" y1="5" x2="8" y2="8.5"/><circle cx="8" cy="11.5" r="0.75" fill="currentColor"/></svg><span>错误</span></span>`;

        const dialogContent = `
        <div class="qifu-salary-detail-wrapper">
            <!-- 员工基本信息 -->
            <div class="qifu-detail-card qifu-detail-emp-header">
                <div class="qifu-detail-col"><span class="qifu-detail-label">工号：</span><strong>${escHtml(item.employee_no || '-')}</strong></div>
                <div class="qifu-detail-col"><span class="qifu-detail-label">姓名：</span><strong class="qifu-emp-name-text">${escHtml(item.employee_name)}</strong></div>
                <div class="qifu-detail-col"><span class="qifu-detail-label">岗位：</span><span>${escHtml(item.job_title || '-')}</span></div>
                <div class="qifu-detail-col"><span class="qifu-detail-label">用工性质：</span><span>${escHtml(item.employee_type || '正式工')}</span></div>
                <div class="qifu-detail-col"><span class="qifu-detail-label">工资月份：</span><span>${escHtml(current_month)}</span></div>
            </div>

            ${isFixedMode ? `
            <!-- 薪资属性 · 固定薪资标准 (无视车间工时与明细补贴) -->
            <div class="qifu-detail-section">
                <div class="qifu-detail-section-title">薪资属性 · 档案固定工资标准</div>
                <div class="qifu-detail-grid-3">
                    <div class="qifu-detail-item"><div class="qifu-detail-item-label">计薪模式</div><div class="qifu-detail-item-val"><span class="qifu-mode-pill ${get_mode_pill_class(normMode)}">${escHtml(normMode)}</span></div></div>
                    <div class="qifu-detail-item"><div class="qifu-detail-item-label">档案固定工资金额</div><div class="qifu-detail-item-val font-bold qifu-val-green">${fmtMoney(item.fixed_salary)}</div></div>
                    <div class="qifu-detail-item"><div class="qifu-detail-item-label">发放说明</div><div class="qifu-detail-item-val font-semibold">全额按固定工资发放，无视外部车间工时与明细补贴</div></div>
                </div>
            </div>` : `
            <!-- 车间实发表考勤与工时明细 -->
            <div class="qifu-detail-section">
                <div class="qifu-detail-section-title">外部车间实发表 · 工时与考勤明细</div>
                <div class="qifu-detail-grid-4">
                    <div class="qifu-detail-item"><div class="qifu-detail-item-label">作业天数</div><div class="qifu-detail-item-val">${item.attendance_days || item.work_days || 0} 天</div></div>
                    <div class="qifu-detail-item"><div class="qifu-detail-item-label">作业小时</div><div class="qifu-detail-item-val">${item.work_hours || 0} h</div></div>
                    <div class="qifu-detail-item"><div class="qifu-detail-item-label">天工资</div><div class="qifu-detail-item-val">${fmtMoney(item.day_salary)}</div></div>
                    <div class="qifu-detail-item"><div class="qifu-detail-item-label">小时工资</div><div class="qifu-detail-item-val">${fmtMoney(item.hour_salary)}</div></div>
                    <div class="qifu-detail-item"><div class="qifu-detail-item-label">全勤费</div><div class="qifu-detail-item-val">${fmtMoney(item.full_attendance)}</div></div>
                    <div class="qifu-detail-item"><div class="qifu-detail-item-label">加班工时 / 加班费</div><div class="qifu-detail-item-val">${item.overtime_hours || 0} h ｜ ${fmtMoney(item.overtime_salary)}</div></div>
                    ${flt(item.salary_meal_subsidy || item.meal_allowance) > 0 ? `<div class="qifu-detail-item"><div class="qifu-detail-item-label">餐费补贴</div><div class="qifu-detail-item-val qifu-val-amber font-semibold">${item.meal_count || 0} 天 ｜ ${fmtMoney(item.salary_meal_subsidy || item.meal_allowance)}</div></div>` : ""}
                    <div class="qifu-detail-item"><div class="qifu-detail-item-label">国勤天数 / 国勤工资</div><div class="qifu-detail-item-val">${item.national_days || 0} 天 ｜ ${fmtMoney(item.national_salary)}</div></div>
                    <div class="qifu-detail-item"><div class="qifu-detail-item-label">达标率 / 达标工资</div><div class="qifu-detail-item-val">${escHtml(item.target_rate || '-')} ｜ ${fmtMoney(item.target_salary)}</div></div>
                    <div class="qifu-detail-item"><div class="qifu-detail-item-label">考勤扣除</div><div class="qifu-detail-item-val qifu-val-red">${fmtMoney(item.deduction)}</div></div>
                </div>
            </div>

            <!-- 补贴与津贴 (仅动态工资人员显示) -->
            <div class="qifu-detail-section">
                <div class="qifu-detail-section-title">津贴与补贴</div>
                <div class="qifu-detail-grid-3">
                    <div class="qifu-detail-item"><div class="qifu-detail-item-label">职位补贴</div><div class="qifu-detail-item-val">${fmtMoney(item.post_allowance)}</div></div>
                    <div class="qifu-detail-item"><div class="qifu-detail-item-label">房/车补</div><div class="qifu-detail-item-val">${fmtMoney(item.house_rent_allowance)}</div></div>
                    <div class="qifu-detail-item"><div class="qifu-detail-item-label">补贴合计</div><div class="qifu-detail-item-val qifu-val-amber font-bold">${fmtMoney(item.allowances_total)}</div></div>
                </div>
            </div>`}

            <!-- 考勤扣除与请假政策核验 -->
            <div class="qifu-detail-section">
                <div class="qifu-detail-section-title">考勤扣除与请假政策核验 (《关于请假期间保险与租房费用通告》)</div>
                <div class="qifu-detail-grid-4">
                    <div class="qifu-detail-item"><div class="qifu-detail-item-label">全勤基准工作日</div><div class="qifu-detail-item-val font-semibold">${audit.standard_days ? audit.standard_days + " 天" : "-"}</div></div>
                    <div class="qifu-detail-item"><div class="qifu-detail-item-label">出勤天数 / 请假缺勤</div><div class="qifu-detail-item-val">${item.attendance_days || item.work_days || 0} 天 ｜ 请假 ${audit.leave_days || 0} 天</div></div>
                    <div class="qifu-detail-item"><div class="qifu-detail-item-label">扣除合规核验</div><div class="qifu-detail-item-val">${detailAuditBadge}</div></div>
                    <div class="qifu-detail-item"><div class="qifu-detail-item-label">规定应扣 / 实际扣除</div><div class="qifu-detail-item-val font-bold ${isAuditPass ? "qifu-val-green" : "qifu-val-red"}">${fmtMoney(audit.expected_deduction || 0)} ｜ 实扣 ${fmtMoney(item.deduction)}</div></div>
                </div>
                <div class="qifu-detail-callout ${isAuditPass ? "qifu-callout-ok" : "qifu-callout-warn"}">
                    <div class="qifu-callout-title">政策核验依据：${escHtml(audit.rule_applied || "正常出勤")}</div>
                    <div class="qifu-callout-desc">${escHtml(audit.message || "核验一致")}</div>
                </div>
            </div>

            <!-- 车间实发结算汇总 (纯净外部凭证解析与核对) -->
            <div class="qifu-detail-section">
                <div class="qifu-detail-section-title">车间实发汇总 (外部凭证解析)</div>
                <div class="qifu-detail-grid-3">
                    <div class="qifu-detail-item"><div class="qifu-detail-item-label">车间工时绩效薪资</div><div class="qifu-detail-item-val font-semibold">${fmtMoney(calcWorkshop)}</div></div>
                    <div class="qifu-detail-item"><div class="qifu-detail-item-label">补贴津贴合计</div><div class="qifu-detail-item-val font-semibold">${fmtMoney(item.allowances_total)}</div></div>
                    <div class="qifu-detail-highlight-box">
                        <div class="qifu-detail-highlight-title">外部实发工资 (整元)</div>
                        <div class="qifu-detail-highlight-val">${fmtMoneyInt(netSalaryInt)}</div>
                    </div>
                </div>
            </div>

            <!-- 外部导入溯源 -->
            <div class="qifu-detail-audit-box">
                <div class="qifu-detail-grid-4">
                    <div><span class="qifu-detail-label">源表行号:</span> <strong>第 ${item.source_row_number || '-'} 行</strong></div>
                    <div><span class="qifu-detail-label">识别结构:</span> <span>${escHtml(item.source_schema_version || '标准')}</span></div>
                    <div><span class="qifu-detail-label">匹配方式:</span> <span>${escHtml(item.source_match_method || '精确匹配')}</span></div>
                    <div><span class="qifu-detail-label">匹配置信度:</span> <span>${item.source_match_confidence ? (item.source_match_confidence * 100).toFixed(0) + '%' : '100%'}</span></div>
                </div>
                ${item.remarks ? `<div class="qifu-detail-remarks"><span class="qifu-detail-label">备注:</span> ${escHtml(item.remarks)}</div>` : ''}
                ${rawJsonHtml}
            </div>
        </div>`;

        d.fields_dict.content_html.$wrapper.html(dialogContent);
        d.show();
    }

    // ==========================================
    // 业务加载函数
    // ==========================================
    // 1. 加载 Tab 1: 员工档案母表 (精简11列标准结构)
    let _loading_qifu_employees = false;
    function load_qifu_employees(force) {
        if (!COMPANY) return;
        if (_loading_qifu_employees && !force) return;
        _loading_qifu_employees = true;
        frappe.call({
            method: 'ashan_cn_procurement.services.employee_salary_service.get_qifu_employees',
            args: { company: COMPANY, period_month: current_month },
            callback: function(r) {
                _loading_qifu_employees = false;
                if (r.message && Array.isArray(r.message)) {
                    employee_master_rows = r.message.slice();
                    render_employees_view(employee_master_rows);
                    update_employees_confirmation_button(cached_workflow_status);
                }
            },
            error: function() {
                _loading_qifu_employees = false;
            }
        });
    }
    function employee_profile_health(emp) {
        const missing = [];
        const certType = emp.certificate_type || '中国居民身份证';
        if (!emp.employee_no) missing.push('工号');
        if (!emp.employee_name) missing.push('姓名');
        if (!emp.id_card) missing.push('证件号码');
        if (!emp.gender) missing.push('性别');
        if (!emp.birth_date) missing.push('出生日期');
        if (!emp.employee_type) missing.push('用工性质');
        if (!emp.salary_mode) missing.push('计薪方式');
        if (emp.gender === '女' && !emp.retirement_category) missing.push('退休类别');
        if (certType === '中国居民身份证' && emp.id_card && !emp.is_valid_id) missing.push('身份证校验');
        return { complete: missing.length === 0, missing: missing };
    }

    function mask_employee_certificate(value) {
        const text = String(value || '').trim();
        return text || '-';
    }

    function is_employee_retirement_warning(emp) {
        if (!emp) return false;
        if (emp.original_retirement_warning || emp.delayed_retirement_warning) return true;
        if (emp.primary_retirement_warning && ['临退预警', '临退预警(原)', '临退预警(延)', '退休预警(原)', '退休预警(延)'].includes(emp.primary_retirement_warning)) return true;
        if (emp.retire_months_left != null && emp.retire_months_left >= 0 && emp.retire_months_left <= 3) return true;
        return false;
    }

    function is_employee_already_retired(emp) {
        if (!emp) return false;
        if (['退休返聘', '返聘工', '其他-返聘工'].includes(emp.employee_type || '')) return true;
        if (emp.primary_retirement_warning && ['已到龄', '已达原龄', '已过原退休年龄', '已到法定退休年龄'].includes(emp.primary_retirement_warning)) return true;
        if (emp.retire_months_left != null && emp.retire_months_left < 0) return true;
        return false;
    }

    function employee_retirement_attention(emp) {
        return is_employee_retirement_warning(emp) || is_employee_already_retired(emp);
    }

    function get_insurance_mode_color_suffix(modeLabel) {
        const s = String(modeLabel || '').trim();
        if (s === '不参保' || s === '不缴纳' || s === '-') return 'none';
        if (s.includes('动态基数')) return 'dynamic';
        if (s.includes('固定基数')) return s.includes('正常缴纳') ? 'fixed-monthly' : 'fixed';
        if (s.includes('最低基数')) return s.includes('正常缴纳') ? 'min-monthly' : 'min';
        return 'min';
    }

    function format_social_insurance_mode_label(it) {
        const etype = String(it.employee_type || '').trim();
        if (['退休返聘', '返聘工', '其他-返聘工', '外籍工', '其他-外籍工', '临时工', '零工', '实习生', '其他类型员工', '其他'].includes(etype)) {
            return '不参保';
        }
        const rawMode = String(it.social_security_base_mode || '').trim();
        if (rawMode.includes('动态') || rawMode.includes('5%') || rawMode.includes('20%')) {
            return '动态基数(税前工资5%)';
        }
        if (rawMode === '固定基数' || rawMode === '自定义') {
            return '固定基数';
        }
        if (rawMode.includes('最低')) {
            return '最低基数';
        }
        return Number(it.social_security_base || 0) > 0 ? '最低基数' : '不参保';
    }

    function format_housing_fund_base_mode_label(it) {
        const etype = String(it.employee_type || '').trim();
        const policy = String(it.housing_fund_policy || '').trim();
        if (['退休返聘', '返聘工', '其他-返聘工', '外籍工', '其他-外籍工', '临时工', '零工', '实习生', '其他类型员工', '其他'].includes(etype) || policy === '不缴纳' || policy === '固定停缴') {
            return '不缴纳';
        }
        const rawMode = String(it.housing_fund_base_mode || '').trim();
        if (rawMode.includes('动态') || rawMode.includes('20%')) {
            return '动态基数(税前工资20%)';
        }
        if (rawMode === '固定基数' || rawMode === '自定义') {
            return '固定基数';
        }
        if (rawMode.includes('最低')) {
            return '最低基数';
        }
        const hfBase = Number(it.housing_fund_base || it.custom_housing_fund_base || 0);
        if (hfBase > 3000) {
            return '固定基数';
        }
        if (hfBase > 0) {
            return '最低基数';
        }
        return '不缴纳';
    }

    function format_housing_fund_cycle_label(it) {
        const etype = String(it.employee_type || '').trim();
        const policy = String(it.housing_fund_policy || '').trim();
        if (['退休返聘', '返聘工', '其他-返聘工', '外籍工', '其他-外籍工', '临时工', '零工', '实习生', '其他类型员工', '其他'].includes(etype) || policy === '不缴纳' || policy === '固定停缴') {
            return '不缴纳';
        }
        if (policy === '每月正常缴纳' || policy === '固定缴纳' || policy === '正常缴纳') {
            return '正常缴纳';
        }
        return '季初缴纳';
    }

    function get_housing_fund_cycle_class(cycleLabel) {
        const s = String(cycleLabel || '').trim();
        if (s === '正常缴纳') return 'normal';
        if (s === '季初缴纳') return 'quarter';
        return 'none';
    }

    function format_housing_fund_mode_label(it) {
        return format_housing_fund_base_mode_label(it);
    }

    function render_employees_view(list) {
        const all = Array.isArray(list) ? list : [];
        const isResignedPrior = (e) => Boolean(e.is_resigned_prior);
        const isResignedCur = (e) => Boolean(e.is_resigned_this_month);
        const isJoinedCur = (e) => Boolean(e.is_joined_this_month);
        const isFuture = (e) => Boolean(e.is_future_hire);

        // 当月在册人员（自动排除往期已离职与未来入职人员）
        const rosterList = all.filter(e => !isResignedPrior(e) && !isFuture(e));
        const activeList = rosterList.filter(e => !isResignedCur(e));
        const resignedThisMonthList = rosterList.filter(isResignedCur);
        const joinedThisMonthList = rosterList.filter(isJoinedCur);
        const resignedPriorList = all.filter(isResignedPrior);

        const taxOtherList = activeList.filter(e => is_qifu_other_type(e.employee_type));
        const regularList = activeList.filter(e => !is_qifu_other_type(e.employee_type) && (e.employee_type || '正式工') === '正式工');
        const rehireList = activeList.filter(e => !is_qifu_other_type(e.employee_type) && ['退休返聘', '返聘工'].includes(e.employee_type || ''));
        const tempList = activeList.filter(e => !is_qifu_other_type(e.employee_type) && ['临时工', '散工'].includes(e.employee_type || ''));

        // 统计 5 大财务与档案基准总盘 (以当期在册人员 rosterList 为准，杜绝历史离职人员污染当期盘)
        let totalFixedSalary = 0;
        let fixedSalaryCount = 0;
        let totalPostAllowance = 0;
        let totalHouseAllowance = 0;
        let totalSocialBase = 0;
        let socialInsuredCount = 0;
        let totalHousingBase = 0;
        let housingContribCount = 0;

        rosterList.forEach(emp => {
            const normMode = normalize_salary_mode(emp.salary_mode, emp.fixed_salary, emp.employee_type);
            const isFixed = ['税前固定工资', '税后固定工资', '不税固定工资'].includes(normMode);
            if (isFixed && Number(emp.fixed_salary || 0) > 0) {
                totalFixedSalary += Number(emp.fixed_salary || 0);
                fixedSalaryCount++;
            }
            totalPostAllowance += Number(emp.post_allowance || 0);
            totalHouseAllowance += Number(emp.house_rent_allowance || 0);

            const ssMode = format_social_insurance_mode_label(emp);
            const ssBase = Number(emp.social_security_base || 0);
            if (ssMode !== '不参保' && ssBase > 0) {
                totalSocialBase += ssBase;
                socialInsuredCount++;
            }

            const hfMode = format_housing_fund_base_mode_label(emp);
            const hfBase = Number(emp.housing_fund_base || 0);
            if (hfMode !== '不缴纳' && hfBase > 0) {
                totalHousingBase += hfBase;
                housingContribCount++;
            }
        });

        // 1. 在册员工总数 / 状态 (自动排除往期已离职)
        $('#tab1-kpi-total').text(rosterList.length);
        let statusSubText = `在职 ${activeList.length} 人 ｜ 当月离职 ${resignedThisMonthList.length} 人`;
        if (joinedThisMonthList.length > 0) {
            statusSubText += ` ｜ 新入职 ${joinedThisMonthList.length} 人`;
        }
        $('#tab1-kpi-status-sub').text(statusSubText);

        // 2. 固定工资金额总盘
        $('#tab1-kpi-fixed-salary').text(fmtMoney(totalFixedSalary));
        $('#tab1-kpi-fixed-sub').text(`固定薪资 ${fixedSalaryCount} 人 ｜ 动态实发计薪 ${rosterList.length - fixedSalaryCount} 人`);

        // 3. 岗位与住房车补总盘
        $('#tab1-kpi-allowance').text(fmtMoney(totalPostAllowance + totalHouseAllowance));
        $('#tab1-kpi-allowance-sub').text(`职位补贴: ${fmtMoney(totalPostAllowance)} ｜ 房车补: ${fmtMoney(totalHouseAllowance)}`);

        // 4. 社会保险申报基数总盘
        $('#tab1-kpi-ss-base').text(fmtMoney(totalSocialBase));
        $('#tab1-kpi-ss-sub').text(`在保 ${socialInsuredCount} 人 ｜ 停保/不参 ${rosterList.length - socialInsuredCount} 人`);

        // 5. 住房公积金申报基数总盘
        $('#tab1-kpi-hf-base').text(fmtMoney(totalHousingBase));
        $('#tab1-kpi-hf-sub').text(`参缴 ${housingContribCount} 人 ｜ 停缴 ${rosterList.length - housingContribCount} 人`);

        const query = String($('#qifu-emp-search').val() || '').trim().toLowerCase();
        const typeFilter = (window.AshanUI && window.AshanUI.getSegmentedValue)
            ? window.AshanUI.getSegmentedValue('#qifu-emp-type-filter')
            : ($('#qifu-emp-type-filter .jz-segment-btn.active').attr('data-type') || 'all');

        const getEmpTypeRank = (t) => {
            const str = String(t || '').trim();
            if (str === '正式工') return 1;
            if (['返聘工', '退休返聘', '其他-返聘工'].includes(str)) return 2;
            if (['临时工', '零工'].includes(str)) return 4;
            return 3;
        };
        const visibleList = all.filter(emp => {
            const isResigned = isResignedCur(emp);
            const isPrior = isResignedPrior(emp);
            const isFut = isFuture(emp);
            const empType = String(emp.employee_type || '正式工').trim();
            const isOther = is_qifu_other_type(empType);

            const haystack = [emp.employee_no, emp.employee_name, emp.id_card, emp.job_title, emp.department, emp.employee_type, emp.external_name_aliases].join(' ').toLowerCase();
            if (query && !haystack.includes(query)) return false;

            // 专员查阅往期离职人员（点击“已离职/历史归档”分段控件）
            if (typeFilter === 'history_resigned' || typeFilter === '已离职' || typeFilter === '历史离职') {
                return isPrior || isResigned || emp.employment_status === '离职';
            }

            // 默认全员及各在职分类：自动排除往期已离职人员与未来入职人员
            if (isPrior || isFut) return false;

            // 人员范围分段控件过滤 (对齐 Pillar 1 五大纯净用工分类体系与顶部 KPI 卡片)
            if (typeFilter === 'all') {
                // 当月在册全员（在职 + 当月离职）
                return true;
            } else if (typeFilter === '正式工') {
                if (isResigned || isOther || empType !== '正式工') return false;
            } else if (typeFilter === '返聘工') {
                if (isResigned || isOther || !['退休返聘', '返聘工'].includes(empType)) return false;
            } else if (typeFilter === '其他' || typeFilter === '其他类型') {
                if (isResigned || !isOther) return false;
            } else if (typeFilter === '临时工') {
                if (isResigned || isOther || !['临时工', '散工'].includes(empType)) return false;
            } else if (typeFilter === 'resigned' || typeFilter === '本月离职' || typeFilter === '当月离职') {
                if (!isResigned) return false;
            }

            return true;
        });

        // 严格按用工类型排序：在册正常 -> 当月离职 -> 往期已离职，相同类型按工号升序
        visibleList.sort((a, b) => {
            if (Boolean(a.is_resigned_prior) !== Boolean(b.is_resigned_prior)) {
                return a.is_resigned_prior ? 1 : -1;
            }
            if (Boolean(a.is_resigned_this_month) !== Boolean(b.is_resigned_this_month)) {
                return a.is_resigned_this_month ? 1 : -1;
            }
            const rankA = getEmpTypeRank(a.employee_type);
            const rankB = getEmpTypeRank(b.employee_type);
            if (rankA !== rankB) return rankA - rankB;
            return String(a.employee_no || '').localeCompare(String(b.employee_no || ''));
        });

        $('#check-all-tab1-employees').prop('checked', false);
        const isLocked = Boolean(cached_workflow_status && (cached_workflow_status.is_locked || (cached_workflow_status.task1_profile && cached_workflow_status.task1_profile.is_confirmed)));
        let html = '';
        if (!visibleList.length) {
            html = '<tr><td colspan="30" class="qifu-empty-cell">当前筛选条件下没有员工档案</td></tr>';
        } else {
            visibleList.forEach((emp, idx) => {
                const resigned = Boolean(emp.is_resigned_this_month || emp.is_resigned_prior || emp.employment_status === '离职');
                const profile = employee_profile_health(emp);
                const defaultAgeStr = emp.gender === '女' ? '50岁' : '60岁';
                const origAge = emp.original_retirement_age_str || (emp.original_retirement_age ? `${emp.original_retirement_age}岁` : defaultAgeStr);
                const delayAge = emp.delayed_retirement_age_str || (emp.delayed_retirement_age ? `${emp.delayed_retirement_age}岁` : '-');
                const profileTitle = profile.complete ? '关键资料完整' : `待完善：${profile.missing.join('、')}`;

                let origRetPeriod = emp.original_retirement_period || emp.original_retire_period || emp.orig_retire_period || '';
                if (!origRetPeriod && emp.birth_date && String(emp.birth_date).length >= 7) {
                    const birthYear = parseInt(String(emp.birth_date).substring(0, 4), 10);
                    const birthMonth = String(emp.birth_date).substring(5, 7);
                    const ageNum = parseInt(String(origAge).replace(/[^\d]/g, '') || (emp.gender === '女' ? '50' : '60'), 10);
                    if (!isNaN(birthYear) && !isNaN(ageNum)) {
                        origRetPeriod = `${birthYear + ageNum}-${birthMonth}`;
                    }
                }
                const delayedRetPeriod = emp.delayed_retirement_period || emp.delayed_retire_period || '-';

                const isRehire = ['退休返聘', '返聘工', '其他-返聘工'].includes(emp.employee_type || '');
                const isRegular = String(emp.employee_type || "").trim() === "正式工";
                const normEmpMode = normalize_salary_mode(emp.salary_mode, emp.fixed_salary, emp.employee_type);
                const isFixedMode = ['税前固定工资', '税后固定工资', '不税固定工资'].includes(normEmpMode);
                const pAllow = isFixedMode ? 0 : Number(emp.post_allowance || 0);
                const hcAllow = isFixedMode ? 0 : Number(emp.house_rent_allowance || 0);
                const totalAllowance = isFixedMode ? 0 : Number(emp.total_allowance || (pAllow + hcAllow));
                const retirementWarning = is_employee_retirement_warning(emp);
                const retired = isRehire || is_employee_already_retired(emp);
                const retirementLabel = retirementWarning ? '3个月内临退' : (retired ? '已达龄或返聘' : '正常');
                const retirementClass = retirementWarning ? 'qifu-state-warn' : (retired ? 'qifu-state-muted' : 'qifu-state-ok');
                const missingSocialBase = isRegular && Number(emp.social_security_base || 0) <= 0;
                const missingHousingBase = isRegular && Number(emp.housing_fund_base || 0) <= 0;
                const aliases = (emp.name_aliases || []).map(row => row.alias_name || '').filter(Boolean).join('、');

                const isResignedCur = Boolean(emp.is_resigned_this_month);
                const isResignedPrior = Boolean(emp.is_resigned_prior);
                const isJoinedCur = Boolean(emp.is_joined_this_month);

                let rowHighlightClass = '';
                if (isResignedCur) {
                    rowHighlightClass = 'qifu-row-resigned-cur ashan-row-highlight-warn';
                } else if (isJoinedCur) {
                    rowHighlightClass = 'qifu-row-newcomer ashan-row-highlight-success';
                } else if (isResignedPrior) {
                    rowHighlightClass = 'qifu-row-resigned-prior ashan-row-highlight-muted';
                }

                let statusLabel = '在职';
                let statusClass = 'qifu-state-ok';
                if (isResignedCur) {
                    statusLabel = '当月离职';
                    statusClass = 'qifu-state-warn';
                } else if (isJoinedCur) {
                    statusLabel = '当月新入职';
                    statusClass = 'qifu-state-ok';
                } else if (isResignedPrior) {
                    statusLabel = emp.relieving_date ? `已离职 (${emp.relieving_date})` : '已离职';
                    statusClass = 'qifu-state-muted';
                }

                html += `
                <tr class="qifu-emp-row qifu-row-clickable ${rowHighlightClass}" data-id="${escHtml(emp.name || '')}" data-emp-no="${escHtml(emp.employee_no || '')}">
                    <td class="qifu-text-center qifu-col-check qifu-col-sticky-check"><input type="checkbox" class="tab1-emp-check" data-emp-no="${escHtml(emp.employee_no || '')}" data-emp-name="${escHtml(emp.employee_name || '')}" aria-label="选择员工 ${escHtml(emp.employee_name || '')}"></td>
                    <td class="qifu-text-center qifu-state-muted col-w-seq qifu-col-sticky-1">${idx + 1}</td>
                    <td class="qifu-text-center qifu-col-employee-no qifu-col-sticky-2"><strong>${escHtml(emp.employee_no || '-')}</strong></td>
                    <td class="qifu-employee-name qifu-col-sticky-3"><strong>${escHtml(emp.employee_name || '-')}</strong></td>
                    <td class="qifu-employee-text" title="${escHtml(aliases)}">${escHtml(aliases || '-')}</td>
                    <td class="qifu-identity-id qifu-font-mono">${escHtml(mask_employee_certificate(emp.id_card))}</td>
                    <td class="qifu-text-center">${escHtml(emp.current_age_detail || (emp.current_age != null ? `${emp.current_age}岁` : '-'))}</td>
                    <td class="qifu-text-center">${escHtml(emp.gender || '-')}</td>
                    <td>${escHtml(emp.certificate_type || '中国居民身份证')}</td>
                    <td class="qifu-text-center">${escHtml(emp.birth_date || '-')}</td>
                    <td>${escHtml(emp.employee_type || '正式工')}</td>
                    <td class="qifu-text-center"><span class="qifu-mode-pill ${get_mode_pill_class(normalize_salary_mode(emp.salary_mode, emp.fixed_salary, emp.employee_type))}">${escHtml(normalize_salary_mode(emp.salary_mode, emp.fixed_salary, emp.employee_type))}</span></td>
                    <td class="qifu-money-cell ashan-money-cell">${['税前固定工资', '税后固定工资', '不税固定工资'].includes(normalize_salary_mode(emp.salary_mode, emp.fixed_salary, emp.employee_type)) ? fmtMoney(emp.fixed_salary) : '-'}</td>
                    <td class="qifu-money-cell ashan-money-cell">${Number(emp.post_allowance || 0) > 0 ? fmtMoney(emp.post_allowance) : '-'}</td>
                    <td class="qifu-money-cell ashan-money-cell">${Number(emp.house_rent_allowance || 0) > 0 ? fmtMoney(emp.house_rent_allowance) : '-'}</td>
                    <td><span class="jz-ins-mode-tag jz-ins-mode-${get_insurance_mode_color_suffix(format_social_insurance_mode_label(emp))}">${escHtml(format_social_insurance_mode_label(emp))}</span></td>
                    <td class="qifu-money-cell ashan-money-cell jz-ins-val-${get_insurance_mode_color_suffix(format_social_insurance_mode_label(emp))}${missingSocialBase ? ' qifu-state-error' : ''}" title="${missingSocialBase ? '未设置缴费基数' : ''}">${format_social_insurance_mode_label(emp) === '不参保' ? '-' : fmtMoney(emp.social_security_base)}</td>
                    <td><span class="jz-ins-mode-tag jz-ins-mode-${get_insurance_mode_color_suffix(format_housing_fund_base_mode_label(emp))}">${escHtml(format_housing_fund_base_mode_label(emp))}</span></td>
                    <td class="qifu-money-cell ashan-money-cell jz-ins-val-${get_insurance_mode_color_suffix(format_housing_fund_base_mode_label(emp))}${missingHousingBase ? ' qifu-state-error' : ''}" title="${missingHousingBase ? '未设置缴费基数' : ''}">${format_housing_fund_base_mode_label(emp) === '不缴纳' ? '-' : fmtMoney(emp.housing_fund_base)}</td>
                    <td class="qifu-text-center"><span class="ashan-cycle-tag ashan-cycle-${get_housing_fund_cycle_class(format_housing_fund_cycle_label(emp))}">${escHtml(format_housing_fund_cycle_label(emp))}</span></td>
                    <td class="qifu-money-cell ashan-money-cell">${fmtMoney(emp.special_additional_deductions_total)}</td>
                    <td class="qifu-text-center">${escHtml(origAge)}</td>
                    <td class="qifu-text-center">${escHtml(origRetPeriod || '-')}</td>
                    <td class="qifu-text-center">${escHtml(delayAge)}</td>
                    <td class="qifu-text-center">${escHtml(delayedRetPeriod)}</td>
                    <td class="qifu-text-center ${retirementClass}">${retirementLabel}</td>
                    <td class="qifu-text-center ${statusClass}">${statusLabel}</td>
                    <td class="qifu-text-center ${profile.complete ? 'qifu-state-ok' : 'qifu-state-warn'}" title="${escHtml(profileTitle)}">${profile.complete ? '资料完整' : `待完善 ${profile.missing.length}项`}</td>
                    <td class="qifu-text-center qifu-employee-actions col-w-action">${isLocked ? `<button type="button" class="ashan-table-action-btn ashan-action-view btn-view-emp" data-id="${escHtml(emp.name || '')}" data-emp-no="${escHtml(emp.employee_no || '')}" title="查看员工档案">查看</button>` : `<button type="button" class="ashan-table-action-btn ashan-action-edit btn-edit-emp" data-id="${escHtml(emp.name || '')}" data-emp-no="${escHtml(emp.employee_no || '')}" title="修改员工档案">修改</button>${isResignedCur || isResignedPrior ? `<button type="button" class="ashan-table-action-btn ashan-action-subtle btn-unresign-emp" data-emp-no="${escHtml(emp.employee_no || '')}" data-emp-name="${escHtml(emp.employee_name || '')}">恢复</button>` : `<button type="button" class="ashan-table-action-btn ashan-action-subtle btn-resign-emp" data-emp-no="${escHtml(emp.employee_no || '')}" data-emp-name="${escHtml(emp.employee_name || '')}">离职</button>`}`}</td>
                </tr>`;
            });
        }
        $('#tab1-sheet-title').text(`${format_payment_month_title(current_month)}员工档案底册`);
        $('#tab1-sheet-meta').text(visibleList.length === rosterList.length ? `共 ${rosterList.length} 人` : `当前筛选：${visibleList.length}人`);

        let totFixed = 0, totPost = 0, totHouse = 0, totSocialBase = 0, totHousingBase = 0, totSpecialDeduction = 0;
        visibleList.forEach(emp => {
            const normMode = normalize_salary_mode(emp.salary_mode, emp.fixed_salary, emp.employee_type);
            if (['税前固定工资', '税后固定工资', '不税固定工资'].includes(normMode)) {
                totFixed += Number(emp.fixed_salary || 0);
            }
            totPost += Number(emp.post_allowance || 0);
            totHouse += Number(emp.house_rent_allowance || 0);
            totSocialBase += Number(emp.social_security_base || 0);
            totHousingBase += Number(emp.housing_fund_base || 0);
            totSpecialDeduction += Number(emp.special_additional_deductions_total || 0);
        });

        const tfootHtml = `
        <tr>
            <td colspan="4" class="qifu-col-sticky-foot">合计 (${visibleList.length}人)</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td class="qifu-money-cell ashan-money-cell">${fmtMoney(totFixed)}</td>
            <td class="qifu-money-cell ashan-money-cell">${fmtMoney(totPost)}</td>
            <td class="qifu-money-cell ashan-money-cell">${fmtMoney(totHouse)}</td>
            <td>-</td>
            <td class="qifu-money-cell ashan-money-cell">${fmtMoney(totSocialBase)}</td>
            <td>-</td>
            <td class="qifu-money-cell ashan-money-cell">${fmtMoney(totHousingBase)}</td>
            <td>-</td>
            <td class="qifu-money-cell ashan-money-cell">${fmtMoney(totSpecialDeduction)}</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
        </tr>
        `;
        $('#tfoot-qifu-emp').html(tfootHtml);

        $('#tbody-qifu-emp').html(html);
        setTimeout(adjust_active_table_height, 50);
    }

    // 2. 加载 Tab 2: 24 列薪资发放表
    // ------------------------------------------
    // Tab 2 only presents imported external-pay facts. Cash denomination helpers belong to Tab 6 export.
    function load_salary_distribution_tab() {
        frappe.call({
            method: 'ashan_cn_procurement.services.payroll_settlement_service.get_salary_distribution_sheet',
            args: { company: COMPANY, period_month: current_month },
            callback: function(r) {
                if (!r.message || !r.message.rows) return;
                const dist_data = r.message;
                const rows = dist_data.rows || [];
                const tot = dist_data.totals || {};

                load_monthly_workflow_hub();
                let trs = '';
                rows.forEach(r => {
                    trs += `
                    <tr>
                        <td class="qifu-col-sticky-1 qifu-text-center qifu-text-muted">${r.seq}</td>
                        <td class="qifu-col-sticky-2" class="qifu-text-center"><strong>${r.employee_no}</strong></td>
                        <td class="qifu-col-sticky-3"><strong style="color:#1e3a8a;">${r.employee_name}</strong></td>
                        <td class="qifu-money-cell">${r.work_days || 0}</td>
                        <td class="qifu-money-cell">${r.work_hours || 0}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.day_salary)}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.hour_salary)}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.full_attendance)}</td>
                        <td class="qifu-money-cell">${r.overtime_hours || 0}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.overtime_salary)}${r.meal_allowance ? ` <span class="ashan-smart-tip-badge" title="餐费补贴：${r.meal_count || 0}天×¥${r.meal_unit_price || 15}=${fmtMoney(r.meal_allowance)}">含餐补${fmtMoney(r.meal_allowance)}</span>` : ""}</td>
                        <td class="qifu-money-cell">${r.national_days || 0}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.national_salary)}</td>
                        <td class="qifu-text-center">${r.target_rate || '-'}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.target_salary)}</td>
                        <td class="qifu-money-cell" class="qifu-btn-delete-text">${fmtMoney(r.deduction)}</td>
                        <td class="qifu-money-cell" style="font-weight:600;">${fmtMoney(r.workshop_net)}</td>
                        <td class="qifu-money-cell" style="color:#b45309; font-weight:600;">${fmtMoney(r.post_allowance)}</td>
                        <td class="qifu-money-cell" style="color:#b45309; font-weight:600;">${fmtMoney(r.house_rent_allowance)}</td>
                        <td class="qifu-money-cell" style="color:#b45309; font-weight:700;">${fmtMoney(r.subsidies_total)}</td>
                        <td class="qifu-money-cell" style="color:#2563eb; font-weight:700;">${fmtMoney(r.payable_total)}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.salary_adjust)}</td>
                        <td class="qifu-money-cell" style="color:#16a34a; font-weight:800; font-size:13px;">${fmtMoney(r.net_salary)}</td>
                        <td style="text-align:center; color:#cbd5e1;">${r.sign || ''}</td>
                        <td style="font-size:11px; color:#64748b;">${r.remarks || ''}</td>
                    </tr>
                    `;
                });
                $("#tbody-tab2-dist-sheet").html(trs);
                setTimeout(adjust_active_table_height, 50);

                let tfoot_html = `
                <tr>
                    <td colspan="3" class="qifu-col-sticky-foot">合计 (${rows.length}人)</td>
                    <td class="qifu-money-cell">${tot.work_days || 0}</td>
                    <td class="qifu-money-cell">${tot.work_hours || 0}</td>
                    <td>-</td><td>-</td>
                    <td class="qifu-money-cell">${fmtMoney(tot.full_attendance)}</td>
                    <td class="qifu-money-cell">${tot.overtime_hours || 0}</td>
                    <td class="qifu-money-cell">${fmtMoney(tot.overtime_salary)}</td>
                    <td class="qifu-money-cell">${tot.national_days || 0}</td>
                    <td class="qifu-money-cell">${fmtMoney(tot.national_salary)}</td>
                    <td>-</td>
                    <td class="qifu-money-cell">${fmtMoney(tot.target_salary)}</td>
                    <td class="qifu-money-cell" class="qifu-btn-delete-text">${fmtMoney(tot.deduction)}</td>
                    <td class="qifu-money-cell">${fmtMoney(tot.workshop_net)}</td>
                    <td class="qifu-money-cell" style="color:#b45309;">${fmtMoney(tot.post_allowance)}</td>
                    <td class="qifu-money-cell" style="color:#b45309;">${fmtMoney(tot.house_rent_allowance)}</td>
                    <td class="qifu-money-cell" style="color:#b45309;">${fmtMoney(tot.subsidies_total)}</td>
                    <td class="qifu-money-cell" class="qifu-val-blue">${fmtMoney(tot.payable_total)}</td>
                    <td class="qifu-money-cell">${fmtMoney(tot.salary_adjust)}</td>
                    <td class="qifu-money-cell" style="color:#16a34a; font-size:13px;">${fmtMoney(tot.net_salary)}</td>
                    <td>-</td><td>-</td>
                </tr>
                `;
                $("#tfoot-tab2-dist-sheet").html(tfoot_html);
            }
        });
    }

    // 3. 加载 Tab 3: 社保明细台账与配置
    let cached_social_insurance_data = null;
    let tab3_search_kw = "";
    let tab3_filter_type = "all";

    function load_social_insurance_tab() {
        frappe.call({
            method: 'ashan_cn_procurement.services.payroll_settlement_service.get_social_insurance_sheet',
            args: { company: COMPANY, period_month: current_month },
            callback: function(r) {
                if (!r.message) return;
                cached_social_insurance_data = r.message;
                const ins = r.message;
                const tot = ins.totals || {};
                const rows = ins.rows || [];

                $("#ins-tab3-ss-comp").text(`${Number(tot.company_rate || 27.55).toFixed(2)} %`);
                $("#ins-tab3-ss-pers").text(`${Number(tot.person_rate || 10.50).toFixed(2)} %`);
                $("#ins-tab3-ss-grand").text(fmtMoney(tot.grand_total));
                $("#ins-tab3-ss-sub").text(`单位: ${fmtMoney(tot.comp_total)} | 个人: ${fmtMoney(tot.pers_total)}`);
                if (rows.length > 0) {
                    $("#ins-tab3-ss-base").text(fmtMoney(rows[0].ss_base));
                }

                render_social_insurance_table();
            }
        });
    }

    function render_social_insurance_table() {
        if (!cached_social_insurance_data) return;
        const ins = cached_social_insurance_data;
        const rows = ins.rows || [];
        const query = String(tab3_search_kw || "").trim().toLowerCase();

        const filtered = rows.filter(r => {
            if (query) {
                const str = [r.employee_no, r.employee_name, r.id_card, r.employee_type].join(' ').toLowerCase();
                if (!str.includes(query)) return false;
            }
            if (tab3_filter_type === 'contributing') {
                if (flt(r.grand_total) <= 0) return false;
            } else if (tab3_filter_type === 'stopped') {
                if (flt(r.grand_total) > 0) return false;
            }
            return true;
        });

        $("#tab3-sheet-title").text(ins.report_title || `${format_payment_month_title(next_period(current_month))}社会保险缴费明细单`);
        const insuredCount = rows.filter(r => flt(r.grand_total) > 0).length;
        $("#tab3-sheet-meta").text(filtered.length === rows.length ? `在保 ${insuredCount} 人 ｜ 全员 ${rows.length} 人` : `当前筛选：${filtered.length}人`);

        let sumBase = 0, sumCompTotal = 0, sumPersTotal = 0, sumGrand = 0;
        let sumCompPension = 0, sumCompUnemp = 0, sumCompMed = 0, sumCompOtherMed = 0, sumCompInjury = 0;
        let sumPersPension = 0, sumPersUnemp = 0, sumPersMed = 0, sumPersLargeMed = 0;

        let trs = '';
        filtered.forEach(r => {
            const isAdj = !!r.adj_id;
            const isAutoBase = !isAdj && (r.social_security_base_mode !== '自定义');
            sumBase += flt(r.ss_base);
            sumCompPension += flt(r.comp_pension);
            sumCompUnemp += flt(r.comp_unemp);
            sumCompMed += flt(r.comp_med);
            sumCompOtherMed += flt(r.comp_other_med);
            sumCompInjury += flt(r.comp_injury);
            sumCompTotal += flt(r.comp_total);
            sumPersPension += flt(r.pers_pension);
            sumPersUnemp += flt(r.pers_unemp);
            sumPersMed += flt(r.pers_med);
            sumPersLargeMed += flt(r.pers_large_med);
            sumPersTotal += flt(r.pers_total);
            sumGrand += flt(r.grand_total);

            trs += `
            <tr class="${isAdj ? 'qifu-row-adj' : ''}">
                <td class="qifu-col-sticky-1 qifu-text-center qifu-text-muted">${r.seq}</td>
                <td class="qifu-col-sticky-2" class="qifu-text-center"><strong>${r.employee_no}</strong></td>
                <td class="qifu-col-sticky-3">
                    <strong class="qifu-val-blue">${r.employee_name}</strong>
                    ${isAdj ? `<span class="qifu-status-badge qifu-status-draft">${r.biz_type}</span> <a href="javascript:void(0)" class="btn-del-ss-adj" data-id="${r.adj_id}" title="删除此补缴/调整项"></a>` : ''}
                </td>
                <td class="qifu-text-center qifu-col-identity-id">${r.id_card || '-'}</td>
                <td class="qifu-text-center ${isAdj ? 'qifu-fw-700' : ''}">${r.period_month_str}</td>
                <td class="qifu-text-center">${r.employee_type}</td>
                <td class="qifu-money-cell ${isAutoBase ? 'qifu-cell-auto-derived' : ''}" title="${isAutoBase ? '已绑定最低基数（自动获取）' : (isAdj ? '历史补缴' : '自定义基数')}">${fmtMoney(r.ss_base)}</td>
                <td class="qifu-money-cell">${fmtMoney(r.comp_pension)}</td>
                <td class="qifu-money-cell">${fmtMoney(r.comp_unemp)}</td>
                <td class="qifu-money-cell">${fmtMoney(r.comp_med)}</td>
                <td class="qifu-money-cell">${fmtMoney(r.comp_other_med)}</td>
                <td class="qifu-money-cell">${fmtMoney(r.comp_injury)}</td>
                <td class="qifu-money-cell qifu-text-blue">${fmtMoney(r.comp_total)}</td>
                <td class="qifu-money-cell">${fmtMoney(r.pers_pension)}</td>
                <td class="qifu-money-cell">${fmtMoney(r.pers_unemp)}</td>
                <td class="qifu-money-cell">${fmtMoney(r.pers_med)}</td>
                <td class="qifu-money-cell">${fmtMoney(r.pers_large_med)}</td>
                <td class="qifu-money-cell qifu-text-green">${fmtMoney(r.pers_total)}</td>
                <td class="qifu-money-cell qifu-text-orange">
                    ${fmtMoney(r.grand_total)}
                    ${r.late_fee > 0 ? `<div class="qifu-late-fee-hint">(含滞纳金 ${fmtMoney(r.late_fee)})</div>` : ''}
                </td>
            </tr>
            `;
        });
        if (!filtered.length) {
            trs = '<tr><td colspan="19" class="qifu-empty-cell">当前筛选条件下暂无社保记录</td></tr>';
        }
        $("#tbody-tab3-ss-sheet").html(trs);
        setTimeout(adjust_active_table_height, 50);

        let tfoot_html = `
        <tr>
            <td colspan="3" class="qifu-col-sticky-foot">合计 (${filtered.length}人)</td>
            <td colspan="2" class="qifu-bg-muted"></td>
            <td class="qifu-text-center qifu-text-blue">${filtered.filter(r => flt(r.grand_total) > 0).length}人参保</td>
            <td class="qifu-money-cell">${fmtMoney(sumBase)}</td>
            <td class="qifu-money-cell">${fmtMoney(sumCompPension)}</td>
            <td class="qifu-money-cell">${fmtMoney(sumCompUnemp)}</td>
            <td class="qifu-money-cell">${fmtMoney(sumCompMed)}</td>
            <td class="qifu-money-cell">${fmtMoney(sumCompOtherMed)}</td>
            <td class="qifu-money-cell">${fmtMoney(sumCompInjury)}</td>
            <td class="qifu-money-cell qifu-text-blue">${fmtMoney(sumCompTotal)}</td>
            <td class="qifu-money-cell">${fmtMoney(sumPersPension)}</td>
            <td class="qifu-money-cell">${fmtMoney(sumPersUnemp)}</td>
            <td class="qifu-money-cell">${fmtMoney(sumPersMed)}</td>
            <td class="qifu-money-cell">${fmtMoney(sumPersLargeMed)}</td>
            <td class="qifu-money-cell qifu-text-green">${fmtMoney(sumPersTotal)}</td>
            <td class="qifu-money-cell qifu-text-orange">${fmtMoney(sumGrand)}</td>
        </tr>
        `;
        $("#tfoot-tab3-ss-sheet").html(tfoot_html);
    }
    let cached_housing_fund_data = null;
    let tab4_search_kw = "";
    let tab4_filter_type = "all";

    function load_housing_fund_tab() {
        load_housing_fund_roster_change_preview();
        frappe.call({
            method: 'ashan_cn_procurement.services.payroll_settlement_service.get_housing_fund_sheet',
            args: { company: COMPANY, period_month: current_month, include_non_contributors: 0 },
            callback: function(r) {
                if (!r.message) return;
                cached_housing_fund_data = r.message;
                const hf = r.message;
                const tot = hf.totals || {};
                const rule = hf.policy_rule || {};
                const rate = hf.rate_setting || {};
                const scheduled = !!rule.is_scheduled_month;
                const paymentPeriod = rule.payment_period_month || hf.payment_period_month || current_month;
                const schedulePeriod = rule.schedule_period_month || rule.rule_period_month || paymentPeriod;
                const paymentMonthNum = parseInt((paymentPeriod.split('-')[1] || '0'), 10);
                const scheduleMonthNum = parseInt((schedulePeriod.split('-')[1] || '0'), 10);
                const ruleMonths = (rule.months || [1,4,7,10]).join(' / ');

                $('#ins-tab4-rule-status').text(rule.enabled === false ? `缴费 ${paymentMonthNum}月 · 自动规则已关闭` : (scheduled ? `缴费 ${paymentMonthNum}月 · 按公积金 ${scheduleMonthNum}月规则自动缴纳` : `缴费 ${paymentMonthNum}月 · 按公积金 ${scheduleMonthNum}月规则自动停缴`));
                $('#ins-tab4-rule-sub').text(`公积金缴费月 ${ruleMonths} · 当前按实际缴费 ${scheduleMonthNum}月判断 · 其他缴费月${rule.off_action || '停缴'}`);
                $('#ins-tab4-contrib-count').text(`${tot.contributor_count || 0} 人`);
                $('#ins-tab4-contrib-sub').text(`公司规则 ${tot.company_rule_contributor_count || 0} 人 · 常年固定 ${tot.fixed_on_contributor_count || 0} 人 · 单月例外 ${tot.override_on_contributor_count || 0} 人 · 未参缴 ${tot.stopped_count || 0} 人`);
                $('#ins-tab4-rate-pair').text(`${Number(rate.company_rate || 0).toFixed(2)}% / ${Number(rate.person_rate || 0).toFixed(2)}%`);
                $('#ins-tab4-hf-base').text(`最低基数 ${fmtMoney(rate.minimum_base || 0)}`);
                $('#ins-tab4-hf-grand').text(fmtMoney(tot.total_amount));
                $('#ins-tab4-hf-sub').text(`单位: ${fmtMoney(tot.comp_amount)} | 个人: ${fmtMoney(tot.pers_amount)}`);

                render_housing_fund_table();
            }
        });
    }

    function render_housing_fund_table() {
        if (!cached_housing_fund_data) return;
        const hf = cached_housing_fund_data;
        const rows = hf.rows || [];
        const rate = hf.rate_setting || {};
        const query = String(tab4_search_kw || "").trim().toLowerCase();

        const filtered = rows.filter(r => {
            if (query) {
                const str = [r.employee_no, r.employee_name, r.employee_type].join(' ').toLowerCase();
                if (!str.includes(query)) return false;
            }
            if (tab4_filter_type === 'contributing') {
                if (!r.is_contributing) return false;
            } else if (tab4_filter_type === 'stopped') {
                if (r.is_contributing) return false;
            }
            return true;
        });

        $("#tab4-sheet-title").text(`${format_payment_month_title(next_period(current_month))}住房公积金缴存明细单`);
        const contribCount = rows.filter(r => r.is_contributing).length;
        $("#tab4-sheet-meta").text(filtered.length === rows.length ? `参缴 ${contribCount} 人 ｜ 全员 ${rows.length} 人` : `当前筛选：${filtered.length}人`);

        let sumMasterBase = 0, sumBase = 0, sumComp = 0, sumPers = 0, sumTotal = 0;

        let trs = '';
        filtered.forEach(row => {
            const muted = row.is_contributing ? '' : 'background:#fbfdff;color:#64748b;';
            const policyText = row.housing_fund_policy || '跟随公司规则';
            const policyLabel = row.monthly_override ? `${escHtml(policyText)} (${escHtml(row.monthly_override)})` : escHtml(policyText);
            const sourceTip = row.policy_source ? `来源: ${escHtml(row.policy_source)}` : '';
            const fullReason = [row.policy_reason, sourceTip].filter(Boolean).join(' ｜ ');

            sumMasterBase += flt(row.master_hf_base);
            sumBase += flt(row.hf_base);
            sumComp += flt(row.comp_amount);
            sumPers += flt(row.pers_amount);
            sumTotal += flt(row.total_amount);

            const statusBadge = (r) => {
                if (r.is_contributing) {
                    const bg = r.monthly_override ? '#fff7ed' : (r.housing_fund_policy === '固定缴纳' ? '#f5f3ff' : '#ecfdf5');
                    const color = r.monthly_override ? '#c2410c' : (r.housing_fund_policy === '固定缴纳' ? '#6d28d9' : '#047857');
                    return `<span class="qifu-status-badge qifu-status-active" title="${escHtml(fullReason)}">${escHtml(r.policy_label || '缴纳')}</span>`;
                }
                return `<span class="qifu-status-badge qifu-status-inactive" title="${escHtml(fullReason)}">${escHtml(r.policy_label || '停缴')}</span>`;
            };

            trs += `
            <tr class="${row.is_contributing ? '' : 'qifu-row-muted'}">
                <td class="qifu-col-sticky-1 qifu-text-center qifu-text-muted">${row.seq}</td>
                <td class="qifu-col-sticky-2" class="qifu-text-center"><strong>${escHtml(row.employee_no || '-')}</strong></td>
                <td class="qifu-col-sticky-3"><strong class="qifu-val-blue">${escHtml(row.employee_name || '-')}</strong></td>
                <td class="qifu-text-center">${escHtml(row.employee_type || '-')}</td>
                <td class="qifu-money-cell">${fmtMoney(row.master_hf_base || 0)}</td>
                <td class="qifu-text-center" title="${row.monthly_override ? '本月例外: ' + escHtml(row.monthly_override) : ''}">${policyLabel}</td>
                <td class="qifu-text-center">${statusBadge(row)}</td>
                <td class="qifu-money-cell ${row.is_contributing ? 'qifu-text-blue' : 'qifu-text-muted'}">${fmtMoney(row.hf_base || 0)}</td>
                <td class="qifu-text-center">${Number(row.comp_rate || 0).toFixed(2)}%</td>
                <td class="qifu-money-cell qifu-text-blue">${fmtMoney(row.comp_amount || 0)}</td>
                <td class="qifu-text-center">${Number(row.pers_rate || 0).toFixed(2)}%</td>
                <td class="qifu-money-cell qifu-text-green">${fmtMoney(row.pers_amount || 0)}</td>
                <td class="qifu-money-cell qifu-text-orange">${fmtMoney(row.total_amount || 0)}</td>
                <td class="qifu-text-center qifu-nowrap"><button class="btn btn-default btn-xs btn-hf-row-override" data-emp="${escHtml(row.employee_no || '')}" data-name="${escHtml(row.employee_name || '')}" data-mode="${escHtml(row.monthly_override || '')}" title="设置仅当前账期生效的例外">例外</button></td>
            </tr>`;
        });
        if (!filtered.length) {
            trs = '<tr><td colspan="14" class="qifu-empty-cell">当前筛选条件下暂无公积金记录</td></tr>';
        }
        $('#tbody-tab4-hf-sheet').html(trs);

        const tfootHtml = `
        <tr>
            <td colspan="3" class="qifu-col-sticky-foot">合计 · 本表 ${filtered.length} 人</td>
            <td colspan="3" class="qifu-text-center qifu-text-muted">参缴 ${filtered.filter(r => r.is_contributing).length} 人 · 停缴 ${filtered.filter(r => !r.is_contributing).length} 人</td>
            <td class="qifu-text-center qifu-text-blue">本月结果</td>
            <td class="qifu-money-cell">${fmtMoney(sumBase)}</td>
            <td class="qifu-text-center">${Number(rate.company_rate || 0).toFixed(2)}%</td>
            <td class="qifu-money-cell qifu-text-blue">${fmtMoney(sumComp)}</td>
            <td class="qifu-text-center">${Number(rate.person_rate || 0).toFixed(2)}%</td>
            <td class="qifu-money-cell qifu-text-green">${fmtMoney(sumPers)}</td>
            <td class="qifu-money-cell qifu-text-orange">${fmtMoney(sumTotal)}</td>
            <td></td>
        </tr>`;
        $('#tfoot-tab4-hf-sheet').html(tfootHtml);
        setTimeout(adjust_active_table_height, 50);
    }
    function load_housing_fund_roster_change_preview() {
        const requestedMonth = current_month;
        frappe.call({
            method: 'ashan_cn_procurement.services.housing_fund_roster_export_service.get_housing_fund_roster_change_preview',
            args: { company: COMPANY, period_month: requestedMonth },
            callback: function(r) {
                if (requestedMonth !== current_month || !r.message || !r.message.success) return;
                const data = r.message;
                const increaseCount = Number(data.increase_count || 0);
                const sealCount = Number(data.seal_count || 0);
                $('#qifu-hf-increase-count').text(`(${increaseCount}人)`);
                $('#qifu-hf-seal-count').text(`(${sealCount}人)`);
                const referencePeriod = data.reference_period_month || data.previous_period_month || '上一期';
                const comparisonText = data.comparison_mode === 'material_delta'
                    ? `相对最近一期公积金缴费材料（${referencePeriod}）`
                    : `暂无历史缴费材料，按入离职变动识别（${referencePeriod}）`;
                $('#qifu-hf-roster-change-summary').text(
                    `${comparisonText}：增加 ${increaseCount} 人；封存 ${sealCount} 人（封存原因代码 ${data.seal_reason || '4'}）。`
                );
            }
        });
    }

    // 5. 加载 Tab 5: 个人所得税核定与申报台账 · 支持【 财税精简版 (17列)】与【 VBA 68列完整核算台账】
    function render_tax_simple_table(data, cur_m) {
        cached_tax_data = data;
        $("#table-tab5-tax-sheet").addClass("qifu-tax-simple-table").css("min-width", "1760px");
        const allRows = data.rows || [];
        const query = String(tab5_search_kw || "").trim().toLowerCase();
        const rows = allRows.filter(r => {
            if (query) {
                const str = [r.employee_no, r.employee_name, r.id_card, r.employee_type].join(' ').toLowerCase();
                if (!str.includes(query)) return false;
            }
            if (tab5_filter_type === 'taxable') {
                if (flt(r.tax_amount || r.current_tax) <= 0) return false;
            } else if (tab5_filter_type === 'zero_tax') {
                if (flt(r.tax_amount || r.current_tax) > 0) return false;
            }
            return true;
        });

        $('#tab5-sheet-title').text(`${format_payment_month_title(cur_m)}个人所得税依法预扣与申报台账`);
        $('#tab5-sheet-meta').text(rows.length === allRows.length ? `全员 ${allRows.length} 人` : `当前筛选：${rows.length}人`);
        const tot = data.totals || {};

        let thead_html = `
        <tr style="background:#f1f5f9; text-align:center; font-weight:700;">
            <th class="qifu-col-sticky-1">序号</th>
            <th class="qifu-col-sticky-2">工号</th>
            <th class="qifu-col-sticky-3">姓名 (点击穿透)</th>
            <th>证件号码</th>
            <th>用工性质</th>
            <th>发薪账期</th>
            <th style="background:#dbeafe; color:#1e40af;">本期税前收入</th>
            <th>累计基本减除费用</th>
            <th style="background:#fef3c7; color:#b45309;">本期社保扣除</th>
            <th style="background:#fef3c7; color:#b45309;">本期公积金扣除</th>
            <th style="background:#e0f2fe; color:#0369a1;">本期专项附加扣除</th>
            <th style="background:#fff7ed; color:#9a3412;">累计应纳税所得额</th>
            <th>预扣率</th>
            <th>速算扣除数</th>
            <th>往期已缴税额</th>
            <th style="background:#fef2f2; color:#dc2626; font-weight:800;">本月应预扣税额</th>
            <th style="background:#dcfce7; color:#166534; font-weight:800;">税后实发工资</th>
        </tr>
        `;

        let trs = '';
        if (rows.length === 0) {
            trs = `<tr><td colspan="17" style="text-align:center; padding:30px; color:#94a3b8;">当前账期【${cur_m}】暂无薪资个税核定数据。</td></tr>`;
        } else {
            rows.forEach(r => {
                const tax_cur_val = (r.tax_current !== undefined ? r.tax_current : (r.tax_amount || 0));
                const ss_val = (r.ss_person !== undefined ? r.ss_person : (r.ss_person_total || 0));
                const hf_val = (r.hf_person !== undefined ? r.hf_person : (r.hf_person_total || 0));
                const spec_add_val = (r.spec_add_tot_cur !== undefined ? r.spec_add_tot_cur : (r.special_deductions_total || 0));
                const taxable_val = (r.taxable_all !== undefined ? r.taxable_all : (r.taxable_income || 0));
                const thresh_val = (r.thresh_all !== undefined ? r.thresh_all : (r.thresh_cur || 5000));
                const tax_prior_val = (r.tax_paid_prior !== undefined ? r.tax_paid_prior : (r.tax_paid_accumulated || 0));

                trs += `
                <tr>
                    <td class="qifu-col-sticky-1 qifu-text-center qifu-text-muted">${r.seq}</td>
                    <td class="qifu-col-sticky-2" class="qifu-text-center"><strong>${r.employee_no}</strong></td>
                    <td class="qifu-col-sticky-3">
                        <a href="javascript:void(0);" class="btn-drill-emp-history" data-emp="${r.employee_no}" style="color:#2563eb; font-weight:700; text-decoration:underline;" title="点击穿透查看 ${r.employee_name} 整个申报周期的月度发薪与个税轨迹">
                            ${r.employee_name}
                        </a>
                    </td>
                    <td class="qifu-text-center qifu-col-identity-id">${r.id_card || '-'}</td>
                    <td class="qifu-text-center">${escHtml(r.employee_type || '正式工')}</td>
                    <td class="qifu-text-center">${cur_m}</td>
                    <td class="qifu-money-cell" style="font-weight:700; color:#2563eb;">${fmtMoney(r.gross_salary)}</td>
                    <td class="qifu-money-cell" style="color:#64748b;">${fmtMoney(thresh_val)}</td>
                    <td class="qifu-money-cell" style="color:#d97706;" title="社保个人五险扣除">${fmtMoney(ss_val)}</td>
                    <td class="qifu-money-cell" style="color:#d97706;" title="公积金个人扣除">${fmtMoney(hf_val)}</td>
                    <td class="qifu-money-cell" style="color:#0891b2;" title="7 项专项附加扣除合计">${fmtMoney(spec_add_val)}</td>
                    <td class="qifu-money-cell" style="color:#9a3412; font-weight:700; background:#fff7ed;">${fmtMoney(taxable_val)}</td>
                    <td style="text-align:center; font-weight:700;">${r.tax_rate}%</td>
                    <td class="qifu-money-cell" style="color:#64748b;">${fmtMoney(r.quick_deduct || r.quick_deduction || 0)}</td>
                    <td class="qifu-money-cell" style="color:#64748b;">${fmtMoney(tax_prior_val)}</td>
                    <td class="qifu-money-cell" style="color:${tax_cur_val > 0 ? '#dc2626' : '#166534'}; font-weight:800; font-size:13px; background:${tax_cur_val > 0 ? '#fef2f2' : 'transparent'};">
                        ${fmtMoney(tax_cur_val)}
                    </td>
                    <td class="qifu-money-cell" style="color:#166534; font-weight:700;">${fmtMoney(r.net_salary)}</td>
                </tr>
                `;
            });
        }

        const tot_tax_val = tot.tax_current !== undefined ? tot.tax_current : (tot.tax_amount || 0);
        const tot_ss_val = tot.ss_cur !== undefined ? tot.ss_cur : (tot.ss_person_total || 0);
        const tot_hf_val = tot.hf_cur !== undefined ? tot.hf_cur : (tot.hf_person_total || 0);
        const tot_spec_add_val = tot.spec_add_tot_cur !== undefined ? tot.spec_add_tot_cur : (tot.special_deductions_total || 0);
        const tot_taxable_val = tot.taxable_all !== undefined ? tot.taxable_all : (tot.taxable_income || 0);

        let tfoot_html = `
        <tr>
            <td colspan="3" class="qifu-col-sticky-foot">合计 (${rows.length}人)</td>
            <td colspan="3" style="background:#f8fafc;"></td>
            <td class="qifu-money-cell" style="color:#2563eb; font-weight:700;">${fmtMoney(tot.gross_salary)}</td>
            <td class="qifu-money-cell" style="font-weight:700;">${fmtMoney(tot.thresh_all || 0)}</td>
            <td class="qifu-money-cell" style="color:#d97706; font-weight:700;">${fmtMoney(tot_ss_val)}</td>
            <td class="qifu-money-cell" style="color:#d97706; font-weight:700;">${fmtMoney(tot_hf_val)}</td>
            <td class="qifu-money-cell" style="color:#0891b2; font-weight:700;">${fmtMoney(tot_spec_add_val)}</td>
            <td class="qifu-money-cell" style="color:#9a3412; font-weight:700;">${fmtMoney(tot_taxable_val)}</td>
            <td class="qifu-text-center">-</td>
            <td class="qifu-money-cell">-</td>
            <td class="qifu-money-cell">-</td>
            <td class="qifu-money-cell" style="color:#dc2626; font-weight:800; font-size:13px;">${fmtMoney(tot_tax_val)}</td>
            <td class="qifu-money-cell" style="color:#166534; font-weight:800; font-size:13px;">${fmtMoney(tot.net_salary)}</td>
        </tr>
        `;

        $("#table-tab5-tax-sheet thead").html(thead_html);
        $("#tbody-tab5-tax-sheet").html(trs);
        $("#tfoot-tab5-tax-sheet").html(tfoot_html);
        adjust_active_table_height();
        sync_dual_scrollbars($("#tab5-top-scrollbar"), $("#tab5-table-box"));
    }

    function render_tax_full_68_table(data, cur_m) {
        cached_tax_data = data;
        $("#table-tab5-tax-sheet").removeClass("qifu-tax-simple-table").css("min-width", "6200px");
        const allRows = data.rows || [];
        const query = String(tab5_search_kw || "").trim().toLowerCase();
        const rows = allRows.filter(r => {
            if (query) {
                const str = [r.employee_no, r.employee_name, r.id_card, r.employee_type].join(' ').toLowerCase();
                if (!str.includes(query)) return false;
            }
            if (tab5_filter_type === 'taxable') {
                if (flt(r.tax_current) <= 0) return false;
            } else if (tab5_filter_type === 'zero_tax') {
                if (flt(r.tax_current) > 0) return false;
            }
            return true;
        });

        $('#tab5-sheet-title').text(`${format_payment_month_title(cur_m)}个人所得税依法预扣与申报台账 (68列全量)`);
        $('#tab5-sheet-meta').text(rows.length === allRows.length ? `全员 ${allRows.length} 人` : `当前筛选：${rows.length}人`);
        const tot = data.totals || {};
        const cols = [
            // 员工基本信息 9
            {k:'seq', l:'序号', g:'员工基本信息', t:'text'},
            {k:'employee_no', l:'工号', g:'员工基本信息', t:'text'},
            {k:'employee_name', l:'姓名', g:'员工基本信息', t:'name'},
            {k:'id_card', l:'证件号码', g:'员工基本信息', t:'text'},
            {k:'gender', l:'性别', g:'员工基本信息', t:'text'},
            {k:'period_month_str', l:'实际缴费所属期', g:'员工基本信息', t:'text'},
            {k:'employee_type', l:'员工类型', g:'员工基本信息', t:'text'},
            {k:'target_salary', l:'目标工资', g:'员工基本信息', t:'money'},
            {k:'salary_mode', l:'计薪方式', g:'员工基本信息', t:'text'},
            {k:'gross_salary', l:'税前工资', g:'员工基本信息', t:'money'},
            {k:'thresh_cur', l:'起征点扣除', g:'员工基本信息', t:'money'},
            // 工资扣除本月 3
            {k:'hf_person', l:'公积金', g:'工资扣除(本月)', t:'money'},
            {k:'ss_person', l:'社保', g:'工资扣除(本月)', t:'money'},
            {k:'deduct_cur_tot', l:'工资扣除合计', g:'工资扣除(本月)', t:'money'},
            // 专项扣除本月 6
            {k:'ss_pension', l:'基本养老', g:'专项扣除(本月)', t:'money'},
            {k:'ss_med', l:'基本医疗', g:'专项扣除(本月)', t:'money'},
            {k:'ss_large_med', l:'大额医疗', g:'专项扣除(本月)', t:'money'},
            {k:'ss_unemp', l:'失业保险', g:'专项扣除(本月)', t:'money'},
            {k:'hf_spec', l:'住房公积金', g:'专项扣除(本月)', t:'money'},
            {k:'spec_tot_cur', l:'专项扣除合计', g:'专项扣除(本月)', t:'money'},
            // 专项附加本月 8
            {k:'spec_add_child', l:'子女教育', g:'专项附加扣除(本月)', t:'money'},
            {k:'spec_add_edu', l:'继续教育', g:'专项附加扣除(本月)', t:'money'},
            {k:'spec_add_med', l:'大病医疗', g:'专项附加扣除(本月)', t:'money'},
            {k:'spec_add_loan', l:'住房贷款利息', g:'专项附加扣除(本月)', t:'money'},
            {k:'spec_add_rent', l:'住房租金', g:'专项附加扣除(本月)', t:'money'},
            {k:'spec_add_elder', l:'赡养老人', g:'专项附加扣除(本月)', t:'money'},
            {k:'spec_add_baby', l:'3岁以下婴幼儿照护', g:'专项附加扣除(本月)', t:'money'},
            {k:'spec_add_tot_cur', l:'专项附加扣除合计', g:'专项附加扣除(本月)', t:'money'},
            // 往期 16
            {k:'gross_prior', l:'税前工资', g:'个税累计(往期)', t:'money'},
            {k:'thresh_prior', l:'起征点扣除', g:'个税累计(往期)', t:'money'},
            {k:'ss_pension_prior', l:'基本养老', g:'专项扣除(往期)', t:'money'},
            {k:'ss_med_prior', l:'基本医疗', g:'专项扣除(往期)', t:'money'},
            {k:'ss_large_med_prior', l:'大额医疗', g:'专项扣除(往期)', t:'money'},
            {k:'ss_unemp_prior', l:'失业保险', g:'专项扣除(往期)', t:'money'},
            {k:'hf_spec_prior', l:'住房公积金', g:'专项扣除(往期)', t:'money'},
            {k:'spec_tot_prior', l:'专项扣除合计', g:'专项扣除(往期)', t:'money'},
            {k:'spec_add_child_prior', l:'子女教育', g:'专项附加扣除(往期)', t:'money'},
            {k:'spec_add_edu_prior', l:'继续教育', g:'专项附加扣除(往期)', t:'money'},
            {k:'spec_add_med_prior', l:'大病医疗', g:'专项附加扣除(往期)', t:'money'},
            {k:'spec_add_loan_prior', l:'住房贷款利息', g:'专项附加扣除(往期)', t:'money'},
            {k:'spec_add_rent_prior', l:'住房租金', g:'专项附加扣除(往期)', t:'money'},
            {k:'spec_add_elder_prior', l:'赡养老人', g:'专项附加扣除(往期)', t:'money'},
            {k:'spec_add_baby_prior', l:'3岁以下婴幼儿照护', g:'专项附加扣除(往期)', t:'money'},
            {k:'spec_add_tot_prior', l:'专项附加扣除合计', g:'专项附加扣除(往期)', t:'money'},
            // 全部 16
            {k:'gross_all', l:'个税_税前工资', g:'个税累计(全部)', t:'money'},
            {k:'thresh_all', l:'起征点扣除', g:'个税累计(全部)', t:'money'},
            {k:'ss_pension_all', l:'基本养老', g:'专项扣除(全部)', t:'money'},
            {k:'ss_med_all', l:'基本医疗', g:'专项扣除(全部)', t:'money'},
            {k:'ss_large_med_all', l:'大额医疗', g:'专项扣除(全部)', t:'money'},
            {k:'ss_unemp_all', l:'失业保险', g:'专项扣除(全部)', t:'money'},
            {k:'hf_spec_all', l:'住房公积金', g:'专项扣除(全部)', t:'money'},
            {k:'spec_tot_all', l:'专项扣除合计', g:'专项扣除(全部)', t:'money'},
            {k:'spec_add_child_all', l:'子女教育', g:'专项附加扣除(全部)', t:'money'},
            {k:'spec_add_edu_all', l:'继续教育', g:'专项附加扣除(全部)', t:'money'},
            {k:'spec_add_med_all', l:'大病医疗', g:'专项附加扣除(全部)', t:'money'},
            {k:'spec_add_loan_all', l:'住房贷款利息', g:'专项附加扣除(全部)', t:'money'},
            {k:'spec_add_rent_all', l:'住房租金', g:'专项附加扣除(全部)', t:'money'},
            {k:'spec_add_elder_all', l:'赡养老人', g:'专项附加扣除(全部)', t:'money'},
            {k:'spec_add_baby_all', l:'3岁以下婴幼儿照护', g:'专项附加扣除(全部)', t:'money'},
            {k:'spec_add_tot_all', l:'专项附加扣除合计', g:'专项附加扣除(全部)', t:'money'},
            // 税款 8
            {k:'taxable_all', l:'应纳税所得额', g:'税款计算', t:'money'},
            {k:'tax_rate', l:'税率', g:'税款计算', t:'percent'},
            {k:'quick_deduct', l:'速算扣除数', g:'税款计算', t:'money'},
            {k:'tax_calculated', l:'应纳税额', g:'税款计算', t:'money'},
            {k:'tax_relief', l:'减免税额', g:'税款计算', t:'money'},
            {k:'tax_paid_prior', l:'已缴税额', g:'税款计算', t:'money'},
            {k:'tax_current', l:'应补/退税额', g:'税款计算', t:'money'},
            {k:'net_salary', l:'税后工资', g:'税款计算', t:'money'}
        ];

        const groupStyle = {
            '员工基本信息':'#f5f3ff', '工资扣除(本月)':'#fffbeb', '专项扣除(本月)':'#f0fdf4',
            '专项附加扣除(本月)':'#f0f9ff', '个税累计(往期)':'#faf5ff', '专项扣除(往期)':'#faf5ff',
            '专项附加扣除(往期)':'#faf5ff', '个税累计(全部)':'#fff7ed', '专项扣除(全部)':'#fff7ed',
            '专项附加扣除(全部)':'#fff7ed', '税款计算':'#fef2f2'
        };
        const stickyClass = idx => idx === 0 ? 'qifu-col-sticky-1' : (idx === 1 ? 'qifu-col-sticky-2' : (idx === 2 ? 'qifu-col-sticky-3' : ''));
        const row1 = `<tr class="qifu-tax-group-row">
            <th colspan="3" class="qifu-col-sticky-group">员工基本信息</th>
            <th colspan="8" class="qifu-tax-group-th">员工基本信息与本月基数</th>
            <th colspan="3" class="qifu-tax-group-th jz-grp-amber">工资扣除(本月)</th>
            <th colspan="6" class="qifu-tax-group-th jz-grp-green">专项扣除(本月)</th>
            <th colspan="8" class="qifu-tax-group-th jz-grp-blue">专项附加扣除(本月)</th>
            <th colspan="1" class="qifu-tax-group-th jz-grp-purple">个税_税前工资(往期)</th>
            <th colspan="1" class="qifu-tax-group-th jz-grp-purple">个税_起征点扣除(往期)</th>
            <th colspan="6" class="qifu-tax-group-th jz-grp-purple">个税_专项扣除(往期)</th>
            <th colspan="8" class="qifu-tax-group-th jz-grp-purple">个税_专项附加扣除(往期)</th>
            <th colspan="1" class="qifu-tax-group-th jz-grp-orange">个税_税前工资(全部)</th>
            <th colspan="1" class="qifu-tax-group-th jz-grp-orange">个税_起征点扣除(全部)</th>
            <th colspan="6" class="qifu-tax-group-th jz-grp-orange">个税_专项扣除(全部)</th>
            <th colspan="8" class="qifu-tax-group-th jz-grp-orange">个税_专项附加扣除(全部)</th>
            <th colspan="8" class="qifu-tax-group-th jz-grp-red">税款计算</th>
        </tr>`;
        const row2 = `<tr>${cols.map((c,i) => `<th class="${stickyClass(i)}" title="${frappe.utils.escape_html(c.g || '')} · ${frappe.utils.escape_html(c.l || '')}">
            <span>${frappe.utils.escape_html(c.l || '')}</span>
        </th>`).join('')}</tr>`;
        const head = row1 + row2;

        const renderValue = (c, r, i) => {
            const v = r[c.k];
            if (c.t === 'name') return `<a href="javascript:void(0);" class="btn-drill-emp-history" data-emp="${r.employee_no}" style="color:#2563eb; font-weight:700;">${v || '-'}</a>`;
            if (c.t === 'money') return fmtMoney(v || 0);
            if (c.t === 'percent') return `${Number(v || 0).toFixed(2).replace(/\.00$/,'')}%`;
            return (v === null || v === undefined || v === '') ? '-' : v;
        };

        let body = '';
        if (!rows.length) {
            body = `<tr><td colspan="68" style="text-align:center; padding:30px; color:#94a3b8;">当前账期【${cur_m}】暂无个税台账数据。</td></tr>`;
        } else {
            body = rows.map(r => `<tr>${cols.map((c,i) => {
                const moneyCls = c.t === 'money' ? 'qifu-money-cell' : '';
                let extra = '';
                if (c.k === 'tax_current') extra = `color:${Number(r.tax_current||0)>0?'#dc2626':'#166534'}; font-weight:800;`;
                if (c.k === 'net_salary') extra = 'color:#166534; font-weight:800;';
                if (c.k === 'taxable_all') extra = 'color:#9a3412; font-weight:700;';
                return `<td class="${stickyClass(i)} ${moneyCls}" style="${extra}">${renderValue(c,r,i)}</td>`;
            }).join('')}</tr>`).join('');
        }

        const totalValue = c => {
            if (c.k === 'seq') return '合计';
            if (c.k === 'employee_no') return `共 ${rows.length} 人`;
            if (['employee_name','id_card','gender','period_month_str','employee_type','salary_mode','tax_rate','quick_deduct'].includes(c.k)) return '';
            if (c.t === 'money') return fmtMoney(tot[c.k] || 0);
            return '';
        };
        const foot = `<tr>${cols.map((c,i) => `<td class="${stickyClass(i)} ${c.t==='money'?'qifu-money-cell':''}" style="font-weight:700; background:#f8fafc;">${totalValue(c)}</td>`).join('')}</tr>`;

        $("#table-tab5-tax-sheet thead").html(head);
        $("#tbody-tab5-tax-sheet").html(body);
        $("#tfoot-tab5-tax-sheet").html(foot);
        adjust_active_table_height();
        sync_dual_scrollbars($("#tab5-top-scrollbar"), $("#tab5-table-box"));
    }

    let cached_tax_data = null;
    let tab5_search_kw = "";
    let tab5_filter_type = "all";

    function load_tax_settlement_tab() {
        const cur_m = $("#qifu-month-select").val() || current_month;
        if (current_tax_view_mode === 'simple') {
            frappe.call({
                method: 'ashan_cn_procurement.services.payroll_settlement_service.get_tax_settlement_sheet',
                args: { company: COMPANY, period_month: cur_m },
                callback: function(r) {
                    if (!r.message) return;
                    const data = r.message;
                    const tot = data.totals || {};
                    $("#tax-kpi-gross").text(fmtMoney(tot.gross_salary));
                    $("#tax-kpi-total").text(fmtMoney(tot.tax_amount || tot.current_tax || 0));
                    $("#tax-kpi-net").text(fmtMoney(tot.net_salary != null ? tot.net_salary : tot.target_salary));
                    $("#tax-kpi-ded").text(fmtMoney((tot.thresh_cur || 0) + (tot.spec_tot_cur || 0) + (tot.spec_add_tot_cur || 0)));
                    $("#tax-kpi-count").text(`${data.rows ? data.rows.length : 0} 人`);
                    $("#tax-kpi-period").text(`所属发薪账期: ${cur_m}`);
                    render_tax_simple_table(data, cur_m);
                }
            });
        } else {
            frappe.call({
                method: 'ashan_cn_procurement.services.payroll_settlement_service.get_tax_settlement_full_sheet',
                args: { company: COMPANY, period_month: cur_m },
                callback: function(r) {
                    if (!r.message) return;
                    const data = r.message;
                    const tot = data.totals || {};
                    $("#tax-kpi-gross").text(fmtMoney(tot.gross_salary));
                    $("#tax-kpi-total").text(fmtMoney(tot.tax_current));
                    $("#tax-kpi-net").text(fmtMoney(tot.net_salary != null ? tot.net_salary : tot.target_salary));
                    $("#tax-kpi-ded").text(fmtMoney((tot.thresh_cur || 0) + (tot.spec_tot_cur || 0) + (tot.spec_add_tot_cur || 0)));
                    $("#tax-kpi-count").text(`${data.rows ? data.rows.length : 0} 人`);
                    $("#tax-kpi-period").text(`所属发薪账期: ${cur_m} (第 ${data.month_idx || 1} 个月)`);
                    render_tax_full_68_table(data, cur_m);
                }
            });
        }
    }

// 6. 加载 Tab 6: 月度薪酬综合核定结算 (母表与老板娘混合总盘)
    function load_payroll_settlement() {
        frappe.call({
            method: 'ashan_cn_procurement.services.payroll_settlement_service.get_payroll_settlement_detail',
            args: {
                company: COMPANY,
                period_month: current_month
            },
            callback: function(r) {
                if (r.message) {
                    render_payroll_view(r.message);
                }
            }
        });
    }

    let cached_payroll_data = null;
    let tab6_search_kw = "";
    let tab6_filter_type = "all";

    function render_payroll_view(data) {
        if (!data) return;
        cached_payroll_data = data;
        const kpi = data.kpi_summary || {};

        const regCount = kpi.regular_count || kpi.insured_count || 0;
        const rehireCount = kpi.rehire_count || 0;
        const tempCount = kpi.temp_count || 0;
        const otherCount = kpi.other_count || 0;
        const resignedCount = kpi.resigned_count || 0;

        $("#kpi-emp-total").text(kpi.total_profile_count || data.total_employees || 0);
        $("#kpi-emp-sub").text(`正式工: ${regCount}人 ｜ 返聘: ${rehireCount}人 ｜ 临时: ${tempCount}人 ｜ 离职: ${resignedCount}人`);

        $("#kpi-ss-grand").text(fmtMoney(kpi.ss_grand_total));
        $("#kpi-ss-sub").text(`公司承担: ${fmtMoney(kpi.ss_comp_total)} ｜ 个人代扣: ${fmtMoney(kpi.ss_pers_total)} ｜ 参保 ${kpi.ss_count || 0}人`);

        $("#kpi-hf-grand").text(fmtMoney(kpi.hf_grand_total));
        $("#kpi-hf-sub").text(`公司缴存: ${fmtMoney(kpi.hf_comp_total)} ｜ 个人代扣: ${fmtMoney(kpi.hf_pers_total)} ｜ 参缴 ${kpi.hf_count || 0}人`);

        $("#kpi-total-net").text(fmtMoney(data.total_net_salary));
        $("#kpi-total-sub").text(`倒推税前: ${fmtMoney(data.total_gross_salary)} ｜ 个税代扣: ${fmtMoney(data.total_tax)} ｜ 扣险金个税: ${fmtMoney(kpi.total_person_deductions)}`);

        // 新增第 5 卡片：记账工资表总盘 (导出对齐)
        const accSummary = (data.kpi_summary && data.kpi_summary.accounting) || data.accounting_summary || {};
        const accDomTotals = accSummary.totals || {};
        const accForTotals = accSummary.foreign_totals || {};
        const accAllTotals = accSummary.all_totals || {};

        let domGross = flt(accDomTotals.gross_salary);
        let domNet = flt(accDomTotals.net_salary);
        let forGross = flt(accForTotals.gross_salary);
        let forNet = flt(accForTotals.net_salary);
        let allGross = flt(accAllTotals.gross_salary);
        let allNet = flt(accAllTotals.net_salary);

        // 防御性本地自适应计算：在任何边界情况下均保障数值 100% 准确
        if (!accSummary.totals && data.items && data.items.length) {
            let dG = 0, dN = 0, fG = 0, fN = 0;
            data.items.forEach(it => {
                const et = String(it.employee_type || "");
                if (et.includes("临时")) return;
                const g = flt(it.gross_salary);
                const s = flt(it.ss_person_total);
                const h = flt(it.hf_person_total);
                const t = flt(it.tax_amount);
                const n = Math.round((g - (s + h + t)) * 100) / 100;
                if (et.includes("外籍")) {
                    fG += g; fN += n;
                } else {
                    dG += g; dN += n;
                }
            });
            domGross = Math.round(dG * 100) / 100;
            domNet = Math.round(dN * 100) / 100;
            forGross = Math.round(fG * 100) / 100;
            forNet = Math.round(fN * 100) / 100;
            allGross = Math.round((dG + fG) * 100) / 100;
            allNet = Math.round((dN + fN) * 100) / 100;
        }

        if ($("#kpi-acc-grand").length) {
            $("#kpi-acc-grand").html(`${fmtMoney(allNet)} <span class="qifu-kpi-badge-hint">(税前 ${fmtMoney(allGross)})</span>`);
        }
        if ($("#kpi-acc-dom-line").length) {
            const domText = `记账表: 税前 ${fmtMoney(domGross)} ｜ 税后 ${fmtMoney(domNet)}`;
            $("#kpi-acc-dom-line").text(domText).attr("title", `记账工资表: 税前 ${fmtMoney(domGross)} ｜ 税后 ${fmtMoney(domNet)}`);
        }
        if ($("#kpi-acc-for-line").length) {
            const forText = `外籍表: 税前 ${fmtMoney(forGross)} ｜ 税后 ${fmtMoney(forNet)}`;
            $("#kpi-acc-for-line").text(forText).attr("title", `记账工资表外籍: 税前 ${fmtMoney(forGross)} ｜ 税后 ${fmtMoney(forNet)}`);
        }

        const allItems = data.items || [];
        const query = String(tab6_search_kw || "").trim().toLowerCase();
        const items = allItems.filter(it => {
            if (query) {
                const str = [it.employee_no, it.employee_name, it.job_title, it.employee_type].join(' ').toLowerCase();
                if (!str.includes(query)) return false;
            }
            if (tab6_filter_type === '正式工') {
                if (it.employee_type !== '正式工') return false;
            } else if (tab6_filter_type === '返聘工') {
                if (!['返聘工', '退休返聘', '退休返聘人员'].includes(it.employee_type || '')) return false;
            } else if (tab6_filter_type === '临时工') {
                if (!['临时工', '零工'].includes(it.employee_type || '')) return false;
            }
            return true;
        });

        $('#tab6-sheet-title').text(`${format_payment_month_title(current_month)}薪酬综合核定与结算明细单`);
        $('#tab6-sheet-meta').text(items.length === (data.total_employees || allItems.length) ? `发薪 ${items.length} 人` : `当前筛选：${items.length}人`);

        if (items.length === 0) {
            $("#tbody-qifu-payroll").html('<tr><td colspan="17" class="qifu-empty-cell">当前筛选条件下暂无综合结算核定数据</td></tr>');
            $("#tfoot-qifu-payroll").empty();
            return;
        }

        let sumWorkshopNet = 0, sumPost = 0, sumHouse = 0, sumNet = 0, sumGross = 0;
        let sumSsPers = 0, sumHfPers = 0, sumTax = 0, sumSsComp = 0, sumHfComp = 0;

        let html = '';
        items.forEach((it, idx) => {
            const jobTitle = it.job_title || '操作工';
            const empType = it.employee_type || '正式工';
            const attDays = Number(it.attendance_days || it.work_days || 0);
            const workHours = Number(it.work_hours || 0);
            const workshopNet = Number(it.workshop_net_salary || it.base_net_salary || 0);

            sumWorkshopNet += workshopNet;
            sumPost += flt(it.post_allowance);
            sumHouse += flt(it.house_rent_allowance);
            sumNet += flt(it.net_salary);
            sumGross += flt(it.gross_salary);
            sumSsPers += flt(it.ss_person_total);
            sumHfPers += flt(it.hf_person_total);
            sumTax += flt(it.tax_amount);
            sumSsComp += flt(it.ss_company_total);
            sumHfComp += flt(it.hf_company_total);

            html += `
            <tr>
                <td class="qifu-col-sticky-1 qifu-text-center qifu-text-muted">${idx + 1}</td>
                <td class="qifu-col-sticky-2" class="qifu-text-center"><strong>${it.employee_no || '-'}</strong></td>
                <td class="qifu-col-sticky-3"><strong class="qifu-val-blue">${it.employee_name}</strong></td>
                <td class="qifu-text-center">${escHtml(empType)}</td>
                <td class="qifu-money-cell">${attDays > 0 ? `${attDays} 天` : (workHours > 0 ? '0 天' : '-')}</td>
                <td class="qifu-money-cell">${workHours > 0 ? `${workHours} h` : (attDays > 0 ? '0 h' : '-')}</td>
                <td class="qifu-money-cell">${fmtMoney(workshopNet)}</td>
                <td class="qifu-money-cell" style="color:#b45309; font-weight:600;">${fmtMoney(it.post_allowance)}</td>
                <td class="qifu-money-cell" style="color:#b45309; font-weight:600;">${fmtMoney(it.house_rent_allowance)}</td>
                <td class="qifu-money-cell" style="color:#16a34a; font-weight:700; font-size:13px;">${fmtMoney(it.net_salary)}</td>
                <td class="qifu-money-cell" style="color:#2563eb; font-weight:700; font-size:13px;">${fmtMoney(it.gross_salary)}</td>
                <td class="qifu-money-cell" style="color:#d97706;">${fmtMoney(it.ss_person_total)}</td>
                <td class="qifu-money-cell" style="color:#d97706;">${fmtMoney(it.hf_person_total)}</td>
                <td class="qifu-money-cell" style="color:#dc2626; font-weight:600;">${fmtMoney(it.tax_amount)}</td>
                <td class="qifu-money-cell" style="color:#64748b;">${fmtMoney(it.ss_company_total)}</td>
                <td class="qifu-money-cell" style="color:#64748b;">${fmtMoney(it.hf_company_total)}</td>
                <td style="font-size:11.5px; color:#64748b; max-width:180px; overflow:hidden; text-overflow:ellipsis;" title="${it.remarks || ''}">${it.remarks || '-'}</td>
            </tr>
            `;
        });
        $("#tbody-qifu-payroll").html(html);

        const tfootHtml = `
        <tr>
            <td colspan="4" class="qifu-col-sticky-foot">合计 (${items.length}人)</td>
            <td>-</td>
            <td>-</td>
            <td class="qifu-money-cell">${fmtMoney(sumWorkshopNet)}</td>
            <td class="qifu-money-cell">${fmtMoney(sumPost)}</td>
            <td class="qifu-money-cell">${fmtMoney(sumHouse)}</td>
            <td class="qifu-money-cell qifu-text-green">${fmtMoney(sumNet)}</td>
            <td class="qifu-money-cell qifu-text-blue">${fmtMoney(sumGross)}</td>
            <td class="qifu-money-cell">${fmtMoney(sumSsPers)}</td>
            <td class="qifu-money-cell">${fmtMoney(sumHfPers)}</td>
            <td class="qifu-money-cell qifu-text-red">${fmtMoney(sumTax)}</td>
            <td class="qifu-money-cell">${fmtMoney(sumSsComp)}</td>
            <td class="qifu-money-cell">${fmtMoney(sumHfComp)}</td>
            <td>-</td>
        </tr>
        `;
        $("#tfoot-qifu-payroll").html(tfootHtml);
        setTimeout(adjust_active_table_height, 50);
    }
    function get_hf_policy_summary(callback) {
        frappe.call({
            method: 'ashan_cn_procurement.services.housing_fund_policy_service.get_housing_fund_policy_summary',
            args: { company: COMPANY, period_month: current_month },
            callback: function(r) { if (r.message && callback) callback(r.message); }
        });
    }

    function open_hf_auto_rule_dialog() {
        get_hf_policy_summary(function(data) {
            const rule = data.rule || {};
            const d = new frappe.ui.Dialog({
                title: ` 公积金自动缴纳规则 · 实际缴费月`,
                fields: [
                    { fieldtype:'HTML', fieldname:'help', options:`<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 12px;font-size:12px;line-height:1.7;color:#1e3a8a;">此规则按<strong>实际公积金缴费月</strong>决定是否启用员工母表中的长期公积金基数；工资核算月仅用于例外和归档。实际缴费、申报凭证所属月固定顺延 1 个月，例如核算 2026-07 对应缴费/凭证 2026-08，因此默认缴费月 1、4、7、10 自动缴纳，其余实际缴费月自动停缴。员工“固定缴纳/固定停缴”和本核算月例外优先级更高。</div>` },
                    { fieldtype:'Check', fieldname:'enabled', label:'启用自动月份规则', default: rule.enabled === false ? 0 : 1 },
                    { fieldtype:'Data', fieldname:'contribution_months', label:'自动缴纳月份', default: (rule.months || [1,4,7,10]).join(','), reqd:1, description:'使用逗号分隔，例如 1,4,7,10。' },
                    { fieldtype:'Select', fieldname:'off_month_action', label:'其他月份', options:['停缴','继续缴纳'], default: rule.off_action || '停缴', reqd:1 }
                ],
                primary_action_label:'保存自动规则',
                primary_action(values) {
                    frappe.call({
                        method:'ashan_cn_procurement.services.housing_fund_policy_service.save_housing_fund_policy_setting',
                        type:'POST',
                        args:{ company:COMPANY, year:(current_month.split('-')[0] || 2026), enabled:values.enabled ? 1 : 0, contribution_months:values.contribution_months, off_month_action:values.off_month_action, period_month:current_month },
                        callback:function(r) {
                            if (r.message && r.message.success) {
                                frappe.show_alert({message:r.message.message, indicator:'green'});
                                d.hide();
                                load_housing_fund_tab();
                                load_tax_settlement_tab();
                                load_payroll_settlement();
                            }
                        }
                    });
                }
            });
            d.show();
        });
    }

    function open_hf_long_policy_dialog() {
        get_hf_policy_summary(function(data) {
            const rows = data.rows || [];
            let body = `<div style="font-size:12px;color:#475569;line-height:1.65;margin-bottom:9px;">长期策略保存在员工薪酬档案。<strong>固定缴纳</strong>用于孟祥山这类不受季度月份限制的人员；<strong>固定停缴</strong>用于长期不参与人员；其他员工保持“跟随公司规则”。</div>`;
            body += `<div style="max-height:420px;overflow:auto;border:1px solid #e2e8f0;border-radius:8px;"><table class="table table-bordered" style="margin:0;font-size:12px;"><thead><tr style="background:#f8fafc;"><th style="width:70px;">工号</th><th style="width:100px;">姓名</th><th>长期基数</th><th style="width:170px;">长期策略</th><th>当前账期结果</th></tr></thead><tbody>`;
            rows.forEach(row => {
                const cur = row.housing_fund_policy || '跟随公司规则';
                const opts = ['跟随公司规则','固定缴纳','固定停缴'].map(x => `<option value="${x}" ${x === cur ? 'selected' : ''}>${x}</option>`).join('');
                body += `<tr><td>${escHtml(row.employee_no || '')}</td><td><strong>${escHtml(row.employee_name || '')}</strong></td><td class="qifu-text-right">${fmtMoney(row.housing_fund_base || 0)}</td><td><select class="form-control input-xs hf-long-policy-select qifu-select-compact" data-emp="${escHtml(row.employee_no || '')}">${opts}</select></td><td><span class="${row.is_contributing ? 'qifu-val-green' : 'qifu-val-muted'} qifu-font-bold">${escHtml(row.decision_label || '')}</span></td></tr>`;
            });
            body += `</tbody></table></div>`;
            const d = new frappe.ui.Dialog({
                title:' 员工公积金长期策略', size:'large',
                fields:[{fieldtype:'HTML',fieldname:'matrix',options:body}],
                primary_action_label:'保存长期策略',
                primary_action() {
                    const policies = {};
                    d.$wrapper.find('.hf-long-policy-select').each(function(){ policies[$(this).attr('data-emp')] = $(this).val(); });
                    frappe.call({
                        method:'ashan_cn_procurement.services.housing_fund_policy_service.save_employee_housing_fund_policies', type:'POST',
                        args:{company:COMPANY, policies_json:JSON.stringify(policies), period_month:current_month},
                        callback:function(r){ if(r.message && r.message.success){ frappe.show_alert({message:r.message.message,indicator:'green'}); d.hide(); load_qifu_employees(); load_housing_fund_tab(); load_tax_settlement_tab(); load_payroll_settlement(); } }
                    });
                }
            });
            d.show();
        });
    }

    function open_hf_monthly_override_dialog(prefillEmp, prefillName, prefillMode) {
        get_hf_policy_summary(function(data) {
            const rows = data.rows || [];
            const options = rows.map(row => `${row.employee_no}｜${row.employee_name}`).join('\n');
            const defaultEmp = prefillEmp ? `${prefillEmp}｜${prefillName || ''}` : (rows.length ? `${rows[0].employee_no}｜${rows[0].employee_name}` : '');
            const defaultMode = prefillMode === '强制缴纳' || prefillMode === '强制停缴' ? prefillMode : '自动（取消例外）';
            const d = new frappe.ui.Dialog({
                title:` ${current_month} 公积金本月例外`,
                fields:[
                    {fieldtype:'HTML',fieldname:'help',options:`<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:9px 11px;font-size:12px;color:#9a3412;line-height:1.6;">仅当前账期生效，不改变员工长期策略。适合临时补缴、临时停缴等一次性情况。取消例外后会立即恢复按长期策略和公司自动月份规则计算。</div>`},
                    {fieldtype:'Select',fieldname:'employee',label:'员工',options:options,default:defaultEmp,reqd:1},
                    {fieldtype:'Select',fieldname:'override_mode',label:'本月处理',options:['自动（取消例外）','强制缴纳','强制停缴'],default:defaultMode,reqd:1},
                    {fieldtype:'Small Text',fieldname:'reason',label:'原因/备注',description:'建议强制缴纳或停缴时填写，便于以后审计。'}
                ],
                primary_action_label:'保存本月处理',
                primary_action(values) {
                    const empNo = String(values.employee || '').split('｜')[0].trim();
                    if (!empNo) return;
                    const isAuto = values.override_mode === '自动（取消例外）';
                    frappe.call({
                        method:isAuto ? 'ashan_cn_procurement.services.housing_fund_policy_service.delete_housing_fund_monthly_override' : 'ashan_cn_procurement.services.housing_fund_policy_service.save_housing_fund_monthly_override',
                        type:'POST',
                        args:isAuto ? {company:COMPANY,period_month:current_month,employee_no:empNo} : {company:COMPANY,period_month:current_month,employee_no:empNo,override_mode:values.override_mode,reason:values.reason || ''},
                        callback:function(r){ if(r.message && r.message.success){ frappe.show_alert({message:r.message.message,indicator:'green'}); d.hide(); load_housing_fund_tab(); load_tax_settlement_tab(); load_payroll_settlement(); } }
                    });
                }
            });
            d.show();
        });
    }

    function open_hf_rate_base_dialog() {
        frappe.call({
            method:'ashan_cn_procurement.services.employee_salary_service.get_insurance_setting',
            args:{company:COMPANY, year:(current_month.split('-')[0] || 2026)},
            callback:function(r) {
                const ins = r.message || {};
                const year = current_month.split('-')[0] || 2026;
                const paymentMonthTitle = format_payment_month_title(next_period(current_month));
                const d = new frappe.ui.Dialog({
                    title:`${paymentMonthTitle}公积金比例与基数`,
                    fields:[
                        {fieldtype:'HTML',fieldname:'help',options:`<div class="ashan-callout ashan-callout--sm">这里维护 ${paymentMonthTitle} 住房公积金缴存比例和最低基数（对应工资核定账期 ${current_month}）。保存后系统将自动联动当期公积金台账、个税与综合结算实时重新计算。</div>`},
                        {fieldtype:'Percent',fieldname:'hf_company_rate',label:'单位缴存比例 (%)',default:ins.hf_company_rate || 5,reqd:1},
                        {fieldtype:'Percent',fieldname:'hf_person_rate',label:'个人缴存比例 (%)',default:ins.hf_person_rate || 5,reqd:1},
                        {fieldtype:'Currency',fieldname:'hf_min_base',label:'公积金最低基数',default:ins.hf_min_base || 2520,reqd:1}
                    ],
                    primary_action_label:'保存比例与基数',
                    primary_action(values) {
                        frappe.call({
                            method:'ashan_cn_procurement.services.employee_salary_service.save_insurance_setting',type:'POST',
                            args:{company:COMPANY,year:year,data:JSON.stringify(values),period_month:current_month},
                            callback:function(res){
                                if(res.message && res.message.success){
                                    frappe.show_alert({message:'公积金比例与基数已保存并重新计算',indicator:'green'});
                                    d.hide();
                                    load_housing_fund_tab();
                                    load_tax_settlement_tab();
                                    load_payroll_settlement();
                                }
                            }
                        });
                    }
                });
                d.show();
            }
        });
    }

    // 修改社保/公积金费率与基数配置弹窗
    function open_insurance_edit_dialog() {
        frappe.call({
            method: 'ashan_cn_procurement.services.employee_salary_service.get_insurance_setting',
            args: { company: COMPANY, year: (current_month.split("-")[0] || 2026) },
            callback: function(r) {
                if (!r.message) return;
                const ins = r.message.setting || r.message || {};
                cached_insurance_setting = ins;
                const year = current_month.split("-")[0] || 2026;

                const d = new frappe.ui.Dialog({
                    title: ` ${format_payment_month_title(next_period(current_month))}社会保险缴费比例与最低基数`,
                    size: 'large',
                    fields: [
                        { fieldtype: 'Section Break', label: ' 单位社保缴费比例 (%)' },
                        { fieldname: 'ss_company_pension', fieldtype: 'Percent', label: '单位基本养老 (%)', default: ins.ss_company_pension || 16.0, reqd: 1 },
                        { fieldname: 'ss_company_unemployment', fieldtype: 'Percent', label: '单位失业保险 (%)', default: ins.ss_company_unemployment || 0.5, reqd: 1 },
                        { fieldname: 'ss_company_medical', fieldtype: 'Percent', label: '单位基本医疗 (%)', default: ins.ss_company_medical || 10.0, reqd: 1 },
                        { fieldname: 'ss_company_other_medical', fieldtype: 'Percent', label: '单位其他医疗 (%)', default: ins.ss_company_other_medical || 0.5, reqd: 1 },
                        { fieldname: 'ss_company_injury', fieldtype: 'Percent', label: '单位工伤保险 (%)', default: ins.ss_company_injury || 0.55, reqd: 1 },

                        { fieldtype: 'Section Break', label: ' 个人社保扣缴比例与救助金' },
                        { fieldname: 'ss_person_pension', fieldtype: 'Percent', label: '个人基本养老 (%)', default: ins.ss_person_pension || 8.0, reqd: 1 },
                        { fieldname: 'ss_person_unemployment', fieldtype: 'Percent', label: '个人失业保险 (%)', default: ins.ss_person_unemployment || 0.5, reqd: 1 },
                        { fieldname: 'ss_person_medical', fieldtype: 'Percent', label: '个人基本医疗 (%)', default: ins.ss_person_medical || 2.0, reqd: 1 },
                        { fieldname: 'big_medical_amount_default', fieldtype: 'Currency', label: '大额医疗基准金额 (元/月)', default: ins.big_medical_amount_default || 22.0, reqd: 1 },
                        { fieldname: 'big_medical_amount_special', fieldtype: 'Currency', label: '大额医疗特殊月份金额 (元/月)', default: ins.big_medical_amount_special || 21.0, reqd: 1 },
                        { fieldname: 'big_medical_special_months', fieldtype: 'Data', label: '特殊金额生效月份 (如: 3,12)', default: ins.big_medical_special_months || '3,12', reqd: 1 },

                        { fieldtype: 'Section Break', label: ' 社保最低缴费基数' },
                        { fieldtype: 'HTML', fieldname: 'ss_minimum_help', options: '<div class="ashan-callout ashan-callout--sm">员工默认绑定“最低缴费基数”。保存新的最低基数后，所有绑定员工会自动联动；只有选择“自定义”的员工保持个人基数。</div>' },
                        { fieldname: 'ss_min_base', fieldtype: 'Currency', label: '社保最低缴费基数 (元)', default: ins.ss_min_base || 5013.0, reqd: 1 },

                        { fieldtype: 'Section Break', label: ' 住房公积金缴费比例与最低基数' },
                        { fieldname: 'hf_company_rate', fieldtype: 'Percent', label: '单位公积金比例 (%)', default: ins.hf_company_rate || 5.0, reqd: 1 },
                        { fieldname: 'hf_person_rate', fieldtype: 'Percent', label: '个人公积金比例 (%)', default: ins.hf_person_rate || 5.0, reqd: 1 },
                        { fieldname: 'hf_min_base', fieldtype: 'Currency', label: '公积金最低缴费基数 (元)', default: ins.hf_min_base || 2320.0, reqd: 1 }
                    ],
                    primary_action_label: ' 保存社保公积金配置',
                    primary_action(values) {
                        frappe.call({
                            method: 'ashan_cn_procurement.services.employee_salary_service.save_insurance_setting',
                            args: {
                                company: COMPANY,
                                year: year,
                                data: JSON.stringify(values),
                                period_month: current_month
                            },
                            type: 'POST',
                            callback: function(res) {
                                if (res.message && res.message.success) {
                                    frappe.show_alert({ message: res.message.message, indicator: 'green' });
                                    d.hide();
                                    load_social_insurance_tab();
                                    load_housing_fund_tab();
                                    load_tax_settlement_tab();
                                    load_payroll_settlement();
                                }
                            }
                        });
                    }
                });
                d.show();
            }
        });
    }

    // 个税参数设置：与社保/公积金配置彻底分离，法定7级税率仅展示
    function open_tax_setting_dialog() {
        const cur_m = $("#qifu-month-select").val() || current_month;
        const year = parseInt((cur_m || current_month).split("-")[0], 10) || 2026;
        frappe.call({
            method: 'ashan_cn_procurement.services.employee_salary_service.get_tax_setting',
            args: { company: COMPANY, year: year, period_month: cur_m },
            callback: function(r) {
                if (!r.message) return;
                const cfg = r.message;
                const brackets = cfg.tax_brackets || [];
                const bracketRows = brackets.map(b => {
                    const rangeText = b.upper === null
                        ? `超过 ${Number(b.lower || 0).toLocaleString()} 元`
                        : `${Number(b.lower || 0).toLocaleString()} - ${Number(b.upper || 0).toLocaleString()} 元`;
                    return `<tr>
                        <td class="qifu-text-center">${b.level}</td>
                        <td>${rangeText}</td>
                        <td style="text-align:center; font-weight:700;">${b.rate}%</td>
                        <td class="qifu-money-cell">${fmtMoney(b.quick_deduction)}</td>
                    </tr>`;
                }).join('');

                const d = new frappe.ui.Dialog({
                    title: ` 个税参数设置 · ${year} 年`,
                    size: 'large',
                    fields: [
                        { fieldtype: 'Section Break', label: '基础参数' },
                        { fieldname: 'tax_threshold', fieldtype: 'Currency', label: '基本减除费用（元/月）', default: cfg.tax_threshold || 5000, reqd: 1,
                          description: '用于累计预扣预缴反推。修改后仅对未冻结月份生效，并自动进入服务器重算队列。' },
                        { fieldname: 'tax_cycle_start_month', fieldtype: 'Int', label: '申报累计周期起始月', default: cfg.tax_cycle_start_month || 12, reqd: 1,
                          description: '工资所属期口径默认 12：即上年12月至本年11月。' },
                        { fieldtype: 'Section Break', label: '7级累计预扣税率表（法定只读）' },
                        { fieldname: 'tax_bracket_preview', fieldtype: 'HTML' }
                    ],
                    primary_action_label: ' 保存个税参数',
                    primary_action(values) {
                        const cycleMonth = parseInt(values.tax_cycle_start_month, 10);
                        if (!cycleMonth || cycleMonth < 1 || cycleMonth > 12) {
                            frappe.msgprint('申报累计周期起始月必须为 1-12。');
                            return;
                        }
                        frappe.call({
                            method: 'ashan_cn_procurement.services.employee_salary_service.save_tax_setting',
                            args: {
                                company: COMPANY,
                                year: year,
                                tax_threshold: values.tax_threshold,
                                tax_cycle_start_month: cycleMonth,
                                period_month: cur_m
                            },
                            type: 'POST',
                            callback: function(res) {
                                if (res.message && res.message.success) {
                                    frappe.show_alert({ message: res.message.message, indicator: 'green' });
                                    d.hide();
                                    load_tax_settlement_tab();
                                }
                            }
                        });
                    }
                });
                d.show();
                const $html = d.fields_dict.tax_bracket_preview.$wrapper;
                $html.html(`
                    <div style="font-size:12px; color:#64748b; margin-bottom:8px;">
                        税率与速算扣除数属于法定参数，系统固定用于计算，不与社保费率混在同一设置中。
                    </div>
                    <div style="max-height:280px; overflow:auto; border:1px solid #e2e8f0; border-radius:6px;">
                        <table class="table table-bordered" style="margin:0; font-size:12px;">
                            <thead style="position:sticky; top:0; background:#f8fafc; z-index:1;">
                                <tr><th style="width:60px;">级数</th><th>累计应纳税所得额</th><th style="width:90px;">预扣率</th><th style="width:130px;">速算扣除数</th></tr>
                            </thead>
                            <tbody>${bracketRows}</tbody>
                        </table>
                    </div>
                `);
            }
        });
    }

    // 19 列双层表头社保明细弹窗
    function open_social_insurance_modal() {
        frappe.call({
            method: 'ashan_cn_procurement.services.payroll_settlement_service.get_social_insurance_sheet',
            args: { company: COMPANY, period_month: current_month },
            callback: function(r) {
                if (!r.message || !r.message.rows) return;
                const ins_data = r.message;
                const rows = ins_data.rows || [];
                const tot = ins_data.totals || {};

                let trs = '';
                rows.forEach(r => {
                    const isAdj = !!r.adj_id;
                    const isAutoBase = !isAdj && (r.social_security_base_mode !== '自定义');
                    trs += `
                    <tr class="${isAdj ? 'qifu-row-adj' : ''}">
                        <td style="text-align:center; color:#94a3b8;">${r.seq}</td>
                        <td class="qifu-text-center"><strong>${r.employee_no}</strong></td>
                        <td>
                            <strong class="qifu-val-blue">${r.employee_name}</strong>
                            ${isAdj ? `<span class="qifu-status-badge qifu-status-draft">${r.biz_type}</span> <a href="javascript:void(0)" class="btn-del-ss-adj" data-id="${r.adj_id}" title="删除此补缴/调整项"></a>` : ''}
                        </td>
                        <td class="qifu-text-center qifu-col-identity-id">${r.id_card || '-'}</td>
                        <td style="text-align:center; font-weight:${isAdj ? '700; color:#b45309;' : 'normal;'}">${r.period_month_str}</td>
                        <td class="qifu-text-center">${r.employee_type}</td>
                        <td class="qifu-money-cell ${isAutoBase ? 'qifu-cell-auto-derived' : ''}" title="${isAutoBase ? '已绑定最低基数（自动获取）' : (isAdj ? '历史补缴' : '自定义基数')}">${fmtMoney(r.ss_base)}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.comp_pension)}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.comp_unemp)}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.comp_med)}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.comp_other_med)}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.comp_injury)}</td>
                        <td class="qifu-money-cell qifu-text-blue">${fmtMoney(r.comp_total)}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.pers_pension)}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.pers_unemp)}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.pers_med)}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.pers_large_med)}</td>
                        <td class="qifu-money-cell qifu-text-green">${fmtMoney(r.pers_total)}</td>
                        <td class="qifu-money-cell qifu-text-orange">
                            ${fmtMoney(r.grand_total)}
                            ${r.late_fee > 0 ? `<div class="qifu-late-fee-hint">(含滞纳金 ${fmtMoney(r.late_fee)})</div>` : ''}
                        </td>
                    </tr>
                    `;
                });

                const modal_html = `
                <div style="margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                    <div>
                        <span style="font-size:14px; font-weight:700; color:#4338ca;">【${COMPANY}】${ins_data.report_title || `${current_month} 社会保险缴费明细表`}</span>
                        <span class="qifu-status-badge qifu-status-locked" style="margin-left:8px;">19列双层表头 · 实际缴费所属期: ${ins_data.payment_period_month || ''} · 工资核算: ${ins_data.period_month || current_month} · 参保 ${rows.length} 笔</span>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button class="btn btn-default btn-xs" id="btn-modal-add-ss-adj"> 登记特殊补缴/滞纳金</button>
                        <button class="btn btn-primary btn-xs" id="btn-modal-export-ins"> 导出此表为 Excel</button>
                        <button class="btn btn-default btn-xs" id="btn-modal-print-ins"> 打印/导出 PDF</button>
                    </div>
                </div>
                <div class="qifu-modal-table-scroll">
                    <table class="qifu-table" id="table-modal-ins-sheet">
                        <thead>
                            <tr>
                                <th>序号</th>
                                <th>工号</th>
                                <th>姓名</th>
                                <th>证件号码</th>
                                <th>实际缴费所属期</th>
                                <th>员工类型</th>
                                <th>社保_基数</th>
                                <th>单位养老</th>
                                <th>单位失业</th>
                                <th>单位医疗</th>
                                <th>单位其他医疗</th>
                                <th>单位工伤</th>
                                <th style="background:#eff6ff;">单位缴纳合计</th>
                                <th>个人养老</th>
                                <th>个人失业</th>
                                <th>个人医疗</th>
                                <th>个人大额医疗</th>
                                <th style="background:#f0fdf4;">个人缴纳合计</th>
                                <th style="background:#fff7ed;">总合计</th>
                            </tr>
                        </thead>
                        <tbody>${trs}</tbody>
                        <tfoot style="background:#f8fafc; font-weight:700;">
                            <tr>
                                <td colspan="5" style="text-align:center; color:#334155;">合计</td>
                                <td class="qifu-text-center">0</td>
                                <td class="qifu-money-cell">${fmtMoney(tot.ss_base)}</td>
                                <td class="qifu-money-cell">${fmtMoney(tot.comp_pension)}</td>
                                <td class="qifu-money-cell">${fmtMoney(tot.comp_unemp)}</td>
                                <td class="qifu-money-cell">${fmtMoney(tot.comp_med)}</td>
                                <td class="qifu-money-cell">${fmtMoney(tot.comp_other_med)}</td>
                                <td class="qifu-money-cell">${fmtMoney(tot.comp_injury)}</td>
                                <td class="qifu-money-cell" style="color:#1e40af;">${fmtMoney(tot.comp_total)}</td>
                                <td class="qifu-money-cell">${fmtMoney(tot.pers_pension)}</td>
                                <td class="qifu-money-cell">${fmtMoney(tot.pers_unemp)}</td>
                                <td class="qifu-money-cell">${fmtMoney(tot.pers_med)}</td>
                                <td class="qifu-money-cell">${fmtMoney(tot.pers_large_med)}</td>
                                <td class="qifu-money-cell" style="color:#166534;">${fmtMoney(tot.pers_total)}</td>
                                <td class="qifu-money-cell" style="color:#c2410c; font-size:13px;">${fmtMoney(tot.grand_total)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
                `;

                const ins_dialog = new frappe.ui.Dialog({
                    title: `${COMPANY || '当前公司'} · ${ins_data.report_title || '社会保险缴费明细表'}`,
                    size: 'extra-large',
                    fields: [{ fieldtype: 'HTML', fieldname: 'ins_content', options: modal_html }],
                    primary_action_label: '关闭',
                    primary_action() { ins_dialog.hide(); }
                });
                ins_dialog.show();
            }
        });
    }

    // 12 列双层表头公积金明细弹窗
    function open_housing_fund_modal() {
        frappe.call({
            method: 'ashan_cn_procurement.services.payroll_settlement_service.get_housing_fund_sheet',
            args: { company: COMPANY, period_month: current_month },
            callback: function(r) {
                if (!r.message || !r.message.rows) return;
                const hf_data = r.message;
                const rows = hf_data.rows || [];
                const tot = hf_data.totals || {};

                let trs = '';
                rows.forEach(r => {
                    trs += `
                    <tr>
                        <td style="text-align:center; color:#94a3b8;">${r.seq}</td>
                        <td class="qifu-text-center"><strong>${r.employee_no}</strong></td>
                        <td><strong class="qifu-val-blue">${r.employee_name}</strong></td>
                        <td class="qifu-text-center qifu-col-identity-id">${r.id_card || '-'}</td>
                        <td class="qifu-text-center">${r.period_month_str}</td>
                        <td class="qifu-text-center">${r.employee_type}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.hf_base)}</td>
                        <td class="qifu-text-center">${r.comp_rate}%</td>
                        <td class="qifu-money-cell" style="color:#0369a1; font-weight:600;">${fmtMoney(r.comp_amount)}</td>
                        <td class="qifu-text-center">${r.pers_rate}%</td>
                        <td class="qifu-money-cell" style="color:#15803d; font-weight:600;">${fmtMoney(r.pers_amount)}</td>
                        <td class="qifu-money-cell qifu-text-orange">${fmtMoney(r.total_amount)}</td>
                    </tr>
                    `;
                });

                const modal_html = `
                <div style="margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <span style="font-size:14px; font-weight:700; color:#0f766e;">【${COMPANY}】${hf_data.report_title || `${current_month} 住房公积金缴存明细表`}</span>
                        <span class="qifu-status-badge qifu-status-locked" style="margin-left:8px;">12列标准版 · 实际缴费所属期: ${hf_data.payment_period_month || ''} · 工资核算: ${hf_data.period_month || current_month} · 参缴 ${rows.length} 人</span>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button class="btn btn-primary btn-xs" id="btn-modal-export-hf"> 导出此表为 Excel</button>
                        <button class="btn btn-default btn-xs" id="btn-modal-print-hf"> 打印/导出 PDF</button>
                    </div>
                </div>
                <div class="qifu-modal-table-scroll">
                    <table class="qifu-table" id="table-modal-hf-sheet">
                        <thead>
                            <tr>
                                <th>序号</th>
                                <th>工号</th>
                                <th>姓名</th>
                                <th>证件号码</th>
                                <th>实际缴费所属期</th>
                                <th>员工类型</th>
                                <th>公积金_基数</th>
                                <th>单位缴存比例</th>
                                <th style="background:#f0f9ff;">单位缴存金额</th>
                                <th>个人缴存比例</th>
                                <th style="background:#f0fdf4;">个人缴存金额</th>
                                <th style="background:#fff7ed;">月缴存总额</th>
                            </tr>
                        </thead>
                        <tbody>${trs}</tbody>
                        <tfoot style="background:#f8fafc; font-weight:700;">
                            <tr>
                                <td colspan="5" style="text-align:center; color:#334155;">合计</td>
                                <td class="qifu-text-center">0</td>
                                <td class="qifu-money-cell">${fmtMoney(tot.hf_base)}</td>
                                <td class="qifu-text-center">5%</td>
                                <td class="qifu-money-cell" style="color:#0369a1;">${fmtMoney(tot.comp_amount)}</td>
                                <td class="qifu-text-center">5%</td>
                                <td class="qifu-money-cell" style="color:#15803d;">${fmtMoney(tot.pers_amount)}</td>
                                <td class="qifu-money-cell" style="color:#c2410c; font-size:13px;">${fmtMoney(tot.total_amount)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
                `;

                const hf_dialog = new frappe.ui.Dialog({
                    title: `${COMPANY || '当前公司'} · ${hf_data.report_title || '住房公积金缴存明细表'}`,
                    size: 'extra-large',
                    fields: [{ fieldtype: 'HTML', fieldname: 'hf_content', options: modal_html }],
                    primary_action_label: '关闭',
                    primary_action() { hf_dialog.hide(); }
                });
                hf_dialog.show();
            }
        });
    }

    // 15 列个人所得税明细弹窗
    function open_tax_modal() {
        frappe.call({
            method: 'ashan_cn_procurement.services.payroll_settlement_service.get_tax_settlement_sheet',
            args: { company: COMPANY, period_month: current_month },
            callback: function(r) {
                if (!r.message || !r.message.rows) return;
                const tax_data = r.message;
                const rows = tax_data.rows || [];
                const tot = tax_data.totals || {};

                let trs = '';
                rows.forEach(r => {
                    const hasTax = r.tax_amount > 0;
                    trs += `
                    <tr>
                        <td style="text-align:center; color:#94a3b8;">${r.seq}</td>
                        <td class="qifu-text-center"><strong>${r.employee_no}</strong></td>
                        <td><strong style="color:#1e3a8a;">${r.employee_name}</strong></td>
                        <td class="qifu-text-center qifu-col-identity-id">${r.id_card || '-'}</td>
                        <td class="qifu-text-center">${r.employee_type}</td>
                        <td class="qifu-text-center">${r.period_month_str}</td>
                        <td class="qifu-money-cell" style="color:#2563eb; font-weight:700;">${fmtMoney(r.gross_salary)}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.tax_threshold)}</td>
                        <td class="qifu-money-cell" style="color:#d97706;">${fmtMoney(r.ss_person_total)}</td>
                        <td class="qifu-money-cell" style="color:#d97706;">${fmtMoney(r.hf_person_total)}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.special_deductions_total)}</td>
                        <td class="qifu-money-cell" style="font-weight:600; color:#b45309;">${fmtMoney(r.taxable_income)}</td>
                        <td style="text-align:center; font-weight:600;">${r.tax_rate}%</td>
                        <td class="qifu-money-cell">${fmtMoney(r.quick_deduction)}</td>
                        <td class="qifu-money-cell" style="color:${hasTax ? '#dc2626' : '#15803d'}; font-weight:800; font-size:13px;">${fmtMoney(r.tax_amount)}</td>
                    </tr>
                    `;
                });

                const modal_html = `
                <div style="margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <span style="font-size:14px; font-weight:700; color:#b45309;">【${COMPANY}】${tax_data.report_title || `${current_month} 个人所得税核定明细表`}</span>
                        <span class="qifu-status-badge qifu-status-locked" style="margin-left:8px;">15列标准预扣预缴 · 纳税人数: ${rows.length} 人</span>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button class="btn btn-primary btn-xs" id="btn-modal-export-tax"> 导出此表为 Excel</button>
                        <button class="btn btn-default btn-xs" id="btn-modal-print-tax"> 打印/导出 PDF</button>
                    </div>
                </div>
                <div class="qifu-modal-table-scroll">
                    <table class="qifu-table" id="table-modal-tax-sheet">
                        <thead style="position:sticky; top:0; background:#f8fafc; z-index:1;">
                            <tr>
                                <th style="width:36px;">序号</th>
                                <th>工号</th>
                                <th>姓名</th>
                                <th>证件号码</th>
                                <th>用工性质</th>
                                <th>发薪月份</th>
                                <th style="background:#eff6ff;">本期税前收入</th>
                                <th>基本减除费用</th>
                                <th>社保个人扣缴</th>
                                <th>公积金个人扣缴</th>
                                <th>专项附加扣除</th>
                                <th style="background:#fef3c7; color:#92400e;">应纳税所得额</th>
                                <th class="qifu-text-center">适用税率</th>
                                <th>速算扣除数</th>
                                <th style="background:#fee2e2; color:#b91c1c; font-weight:800;">本月应预扣税额</th>
                            </tr>
                        </thead>
                        <tbody>${trs}</tbody>
                        <tfoot style="background:#f8fafc; font-weight:700;">
                            <tr>
                                <td colspan="6" style="text-align:center; color:#334155;">合计</td>
                                <td class="qifu-money-cell" class="qifu-val-blue">${fmtMoney(tot.gross_salary)}</td>
                                <td class="qifu-money-cell">${fmtMoney(tot.tax_threshold)}</td>
                                <td class="qifu-money-cell" style="color:#d97706;">${fmtMoney(tot.ss_person_total)}</td>
                                <td class="qifu-money-cell" style="color:#d97706;">${fmtMoney(tot.hf_person_total)}</td>
                                <td class="qifu-money-cell">${fmtMoney(tot.special_deductions_total)}</td>
                                <td class="qifu-money-cell" style="color:#b45309;">${fmtMoney(tot.taxable_income)}</td>
                                <td class="qifu-text-center">-</td>
                                <td class="qifu-money-cell">${fmtMoney(tot.quick_deduction)}</td>
                                <td class="qifu-money-cell" style="color:#dc2626; font-size:13px;">${fmtMoney(tot.tax_amount)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
                `;

                const tax_dialog = new frappe.ui.Dialog({
                    title: `${COMPANY || '当前公司'} · ${tax_data.report_title || '个人所得税核定明细表'}`,
                    size: 'extra-large',
                    fields: [{ fieldtype: 'HTML', fieldname: 'tax_content', options: modal_html }],
                    primary_action_label: '关闭',
                    primary_action() { tax_dialog.hide(); }
                });
                tax_dialog.show();
            }
        });
    }

    function get_suggested_next_emp_no(list, prefix) {
        let maxSeq = 0;
        const re = new RegExp(`^${prefix}(\d+)$`, 'i');
        (list || []).forEach(emp => {
            const eno = String((emp && emp.employee_no) || '').trim();
            const m = eno.match(re);
            if (m) {
                const seq = parseInt(m[1], 10);
                if (seq > maxSeq) maxSeq = seq;
            }
        });
        if (maxSeq === 0) {
            const legacyRe = /^[A-Z](\d+)$/i;
            (list || []).forEach(emp => {
                const eno = String((emp && emp.employee_no) || '').trim();
                const m = eno.match(legacyRe);
                if (m) {
                    const seq = parseInt(m[1], 10);
                    if (seq > maxSeq) maxSeq = seq;
                }
            });
        }
        return `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;
    }


    // ==========================================
    // 弹窗未保存修改智能拦截引擎 (Unsaved Changes Dirty Guard)
    // ==========================================
    function attach_unsaved_changes_guard(dialog, labelMap, onSaveCustom) {
        if (!dialog || !dialog.fields_dict) return;

        let is_force_closing = false;
        let initialSnapshot = {};

        function capture() {
            const snap = {};
            Object.keys(labelMap).forEach(fn => {
                if (dialog.fields_dict && dialog.fields_dict[fn]) {
                    snap[fn] = dialog.get_value(fn);
                }
            });
            return snap;
        }

        setTimeout(() => {
            initialSnapshot = capture();
        }, 200);

        function getChanges() {
            const changes = [];
            Object.keys(labelMap).forEach(fn => {
                if (!dialog.fields_dict || !dialog.fields_dict[fn]) return;
                const oldVal = initialSnapshot[fn];
                const newVal = dialog.get_value(fn);
                const label = labelMap[fn] || fn;

                const fieldObj = dialog.fields_dict[fn];
                const isNumeric = fieldObj.df && (fieldObj.df.fieldtype === 'Currency' || fieldObj.df.fieldtype === 'Float' || fieldObj.df.fieldtype === 'Int' || fieldObj.df.fieldtype === 'Percent');

                if (isNumeric) {
                    const numOld = Number(oldVal || 0);
                    const numNew = Number(newVal || 0);
                    if (Math.abs(numOld - numNew) > 0.001) {
                        changes.push({
                            field: fn,
                            label: label,
                            oldDisplay: numOld ? (fieldObj.df.fieldtype === 'Percent' ? `${numOld}%` : `¥ ${numOld.toLocaleString('zh-CN', {minimumFractionDigits: 2})}`) : '0.00',
                            newDisplay: numNew ? (fieldObj.df.fieldtype === 'Percent' ? `${numNew}%` : `¥ ${numNew.toLocaleString('zh-CN', {minimumFractionDigits: 2})}`) : '0.00'
                        });
                    }
                } else {
                    const strOld = String(oldVal == null ? '' : oldVal).trim();
                    const strNew = String(newVal == null ? '' : newVal).trim();
                    if (strOld !== strNew) {
                        changes.push({
                            field: fn,
                            label: label,
                            oldDisplay: strOld ? `【${strOld}】` : '【空】',
                            newDisplay: strNew ? `【${strNew}】` : '【空】'
                        });
                    }
                }
            });
            return changes;
        }

        function showConfirm(changes) {
            let listHtml = changes.map(c => {
                return `<li class="qifu-unsaved-change-item">
                    <strong class="qifu-unsaved-change-label">${c.label}</strong>：从 <span class="qifu-unsaved-change-old">${c.oldDisplay}</span> 修改为 <strong class="qifu-unsaved-change-new">${c.newDisplay}</strong>
                </li>`;
            }).join('');

            const confirmD = new frappe.ui.Dialog({
                title: '未保存的修改提示',
                fields: [
                    {
                        fieldtype: 'HTML',
                        fieldname: 'msg',
                        options: `
                            <div class="qifu-unsaved-prompt-wrap">
                                <p class="qifu-unsaved-prompt-title">
                                    检测到您在弹窗中修改了以下 ${changes.length} 项内容，尚未保存：
                                </p>
                                <div class="qifu-unsaved-changes-box">
                                    <ul class="qifu-unsaved-changes-list">
                                        ${listHtml}
                                    </ul>
                                </div>
                                <p class="qifu-unsaved-prompt-footer-hint">
                                    是否保存修改？还是放弃修改直接关闭？
                                </p>
                            </div>
                        `
                    }
                ],
                primary_action_label: '保存修改并关闭',
                primary_action: function() {
                    confirmD.hide();
                    is_force_closing = true;
                    if (onSaveCustom) {
                        onSaveCustom();
                    } else if (dialog.get_primary_btn) {
                        dialog.get_primary_btn().click();
                    }
                }
            });

            const $footer = confirmD.$wrapper.find('.modal-footer .standard-actions');
            $footer.find('.btn-discard-changes, .btn-keep-editing').remove();

            const $discardBtn = $(`<button type="button" class="btn btn-danger btn-sm btn-discard-changes">放弃修改直接关闭</button>`);
            const $cancelBtn = $(`<button type="button" class="btn btn-default btn-sm btn-keep-editing">继续编辑</button>`);

            $footer.prepend($discardBtn);
            $footer.append($cancelBtn);

            $discardBtn.on('click', function() {
                confirmD.hide();
                is_force_closing = true;
                dialog.hide();
            });

            $cancelBtn.on('click', function() {
                confirmD.hide();
            });

            confirmD.$wrapper.on('hidden.bs.modal', function() {
                confirmD.$wrapper.remove();
            });
            confirmD.show();
        }

        dialog.set_force_closing = function(val) {
            is_force_closing = !!val;
        };

        const $closeBtn = dialog.$wrapper.find('.btn-modal-close');
        $closeBtn.removeAttr('data-dismiss');
        $closeBtn.off('click.unsaved_guard').on('click.unsaved_guard', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const changes = getChanges();
            if (changes.length > 0) {
                showConfirm(changes);
            } else {
                is_force_closing = true;
                dialog.hide();
            }
        });

        dialog.$wrapper.off('hide.bs.modal.unsaved_guard').on('hide.bs.modal.unsaved_guard', function(e) {
            if (is_force_closing) return;
            const changes = getChanges();
            if (changes.length > 0) {
                e.preventDefault();
                e.stopPropagation();
                showConfirm(changes);
            }
        });
    }

    const EMP_FIELD_LABELS = {
        employee_name: '员工姓名',
        certificate_type: '证件类型',
        id_card: '证件号码',
        birth_date: '出生日期',
        gender: '性别',
        employee_type: '用工性质',
        employment_status: '在职状态',
        date_of_joining: '入职日期',
        mobile: '手机号',
        bank_name: '开户行',
        bank_account: '银行卡号',
        retirement_category: '退休类别',
        salary_mode: '计薪方式',
        fixed_salary: '固定工资金额',
        post_allowance: '职位补贴',
        house_rent_allowance: '房/车补',
        social_security_base_mode: '社保方式',
        custom_social_security_base: '社保基数',
        housing_fund_base_mode: '公积金方式',
        custom_housing_fund_base: '公积金基数',
        housing_fund_policy: '公积金缴纳周期',
        deduction_child_education: '子女教育扣除',
        deduction_continuing_education: '继续教育扣除',
        deduction_serious_illness: '大病医疗扣除',
        deduction_housing_loan: '住房贷款利息扣除',
        deduction_housing_rent: '住房租金扣除',
        deduction_elderly_care: '赡养老人扣除',
        deduction_infant_care: '3岁以下婴幼儿照护',
        notes: '备注说明'
    };

    // 新增/编辑员工档案弹窗
    function open_emp_dialog(emp_data, read_only = false) {
        load_qifu_employee_type_policies(function() {
            _render_emp_dialog(emp_data, read_only);
        });
    }

    function _render_emp_dialog(emp_data, read_only = false) {
        const isEdit = !!emp_data;
        const defaultEmpNo = emp_data && emp_data.employee_no ? emp_data.employee_no : get_suggested_next_emp_no(employee_master_rows || [], 'QF');
        let d = null;
        let isSettingValues = false;
        let debounceTimer = null;
        let lastSignature = '';

        const getField = (name) => d && d.fields_dict && d.fields_dict[name] ? d.get_value(name) : null;
        const safeSetValue = (name, val) => {
            if (!d || !d.fields_dict || !d.fields_dict[name]) return;
            const current = d.get_value(name);
            if (current !== val && String(current || '') !== String(val || '')) {
                isSettingValues = true;
                d.set_value(name, val);
                setTimeout(() => { isSettingValues = false; }, 100);
            }
        };
        const setPreviewHtml = (html) => {
            if (d && d.fields_dict && d.fields_dict.retirement_preview) {
                d.fields_dict.retirement_preview.$wrapper.html(html || '');
            }
        };
        const refreshRetirementPreview = () => {
            if (!d || isSettingValues) return;
            const isChineseId = (getField('certificate_type') || '中国居民身份证') === '中国居民身份证';
            const isManualRetirement = getField('retirement_category') === '特殊政策/人工确认';
            if (d.set_df_property) {
                d.set_df_property('birth_date', 'read_only', isChineseId ? 1 : 0);
                d.set_df_property('gender', 'read_only', isChineseId ? 1 : 0);
                d.set_df_property('original_retirement_age', 'read_only', isManualRetirement ? 0 : 1);
                d.set_df_property('delayed_retirement_age', 'read_only', isManualRetirement ? 0 : 1);
            }
            const payload = {
                company: COMPANY,
                certificate_type: getField('certificate_type') || '中国居民身份证',
                id_card: String(getField('id_card') || '').trim(),
                birth_date: getField('birth_date') || '',
                gender: getField('gender') || '',
                retirement_category: getField('retirement_category') || '',
                original_retirement_age: getField('original_retirement_age') || 0,
                delayed_retirement_age: getField('delayed_retirement_age') || 0,
                period_month: current_month
            };
            const sig = JSON.stringify(payload);
            if (sig === lastSignature) return; // Prevent identical duplicate requests
            lastSignature = sig;

            frappe.call({
                method: 'ashan_cn_procurement.services.employee_salary_service.calculate_employee_age_and_retirement',
                args: payload,
                callback: function(r) {
                    const x = r.message || {};
                    isSettingValues = true;
                    if (x.birth_date && getField('certificate_type') === '中国居民身份证') safeSetValue('birth_date', x.birth_date);
                    if (x.gender && getField('certificate_type') === '中国居民身份证') safeSetValue('gender', x.gender);
                    if (x.current_age !== undefined) safeSetValue('current_age', x.current_age || 0);
                    if (x.retirement_category) safeSetValue('retirement_category', x.retirement_category);
                    if (x.original_retirement_age !== undefined) safeSetValue('original_retirement_age', x.original_retirement_age || 0);
                    if (x.delayed_retirement_age !== undefined) safeSetValue('delayed_retirement_age', x.delayed_retirement_age || 0);
                    if (x.original_retirement_period || x.original_retire_period) safeSetValue('original_retirement_period', x.original_retirement_period || x.original_retire_period);
                    if (x.delayed_retirement_period || x.delayed_retire_period) safeSetValue('delayed_retirement_period', x.delayed_retirement_period || x.delayed_retire_period);
                    setTimeout(() => { isSettingValues = false; }, 150);

                    const identityTip = getField('certificate_type') === '中国居民身份证'
                        ? (x.is_valid_id ? '<span class="qifu-val-green">身份证校验通过，出生日期和性别由证件自动识别</span>' : `<span class="qifu-btn-delete-text">${x.identity_validation_message || '请输入有效18位身份证号码'}</span>`)
                        : '<span style="color:#64748b;">非居民身份证，请手工维护出生日期、性别和退休类别</span>';
                    const original = x.original_retirement_age_str || (x.original_retirement_age ? `${x.original_retirement_age}岁` : '待确认');
                    const delayed = x.delayed_retirement_age_str || (x.delayed_retirement_age ? `${x.delayed_retirement_age}岁` : '待确认');
                    const flexible = x.earliest_flexible_retire_period || '-';
                    const latest = x.latest_flexible_retire_period || '-';
                    const warn = x.primary_retirement_warning || '正常';
                    const contribution = x.earliest_flexible_minimum_contribution_str || '-';
                    const isRehireEmp = ['退休返聘', '返聘工', '其他-返聘工'].includes(getField('employee_type') || '');

                    let previewContent = '';
                    if (isRehireEmp) {
                        previewContent = `
                        <div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;padding:10px 12px;font-size:12px;line-height:1.7;">
                            <div>${identityTip}</div>
                            <div style="display:flex;align-items:center;gap:12px;margin-top:8px;">
                                <span class="qifu-status-badge qifu-retire-badge-retired">已达龄/返聘</span>
                                <span style="font-weight:700;color:#334155;">已退休人员</span>
                                <span style="color:#64748b;">退休年月：<strong style="color:#0f172a;">${x.original_retire_period || '未知退休年龄'}</strong></span>
                            </div>
                            <div style="margin-top:6px;color:#64748b;">该员工用工性质为返聘类员工，已按法定年龄完成退休，无需再行推导延迟退休政策。</div>
                        </div>`;
                    } else {
                        previewContent = `
                        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;font-size:12px;line-height:1.7;">
                            <div>${identityTip}</div>
                            <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:8px;">
                                <div><span style="color:#64748b;">退休年龄(原)</span><br><strong>${original}</strong><br><span style="color:#94a3b8;">${x.original_retire_period || '-'}</span></div>
                                <div><span style="color:#64748b;">退休年龄(延)</span><br><strong>${delayed}</strong><br><span style="color:#94a3b8;">${x.delayed_retire_period || '-'}</span></div>
                                <div><span style="color:#64748b;">最早弹性退休</span><br><strong>${flexible}</strong><br><span style="color:#94a3b8;">最迟延后至 ${latest}</span></div>
                                <div><span style="color:#64748b;">当前状态</span><br><strong style="color:${warn.includes('正常') ? '#059669' : '#c2410c'};">${warn}</strong><br><span style="color:#94a3b8;">按 ${current_month} 账期</span></div>
                            </div>
                            <div style="margin-top:7px;color:#64748b;">政策引擎 ${x.policy_version || 'CN-RETIRE-2025-V1'}。原退休年龄和延迟法定退休年龄分别计算，距到龄3个月内预警。最早弹性退休对应最低养老缴费年限门槛：${contribution}。</div>
                        </div>`;
                    }
                    setPreviewHtml(previewContent);
                }
            });
        };
        const retirementOnChange = () => {
            if (isSettingValues) return;
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(refreshRetirementPreview, 250);
        };

        d = new frappe.ui.Dialog({
            title: isEdit ? `修改员工薪酬档案 · ${emp_data.employee_name}` : `新增${COMPANY || '当前公司'}员工档案`,
            size: 'extra-large',
            fields: [
                { fieldtype: 'Section Break', label: '基本身份' },
                { fieldtype: 'Data', fieldname: 'employee_no', label: '工号', reqd: 1, default: defaultEmpNo, read_only: isEdit ? 1 : 0, description: isEdit ? '工号为终身唯一标识，已锁定只读' : '系统自动分配（QF0000规范），支持特殊情况手动修改' },
                { fieldtype: 'Data', fieldname: 'employee_name', label: '员工姓名', reqd: 1, default: emp_data ? emp_data.employee_name : '' },
                { fieldtype: 'Select', fieldname: 'certificate_type', label: '证件类型', options: ['中国居民身份证','护照','港澳台证件','其他证件'], default: emp_data ? (emp_data.certificate_type || '中国居民身份证') : '中国居民身份证', onchange: retirementOnChange },
                { fieldtype: 'Data', fieldname: 'id_card', label: '证件号码', default: emp_data ? emp_data.id_card : '', onchange: retirementOnChange },
                { fieldtype: 'Column Break' },
                { fieldtype: 'Date', fieldname: 'birth_date', label: '出生日期', default: emp_data ? emp_data.birth_date : '', onchange: retirementOnChange },
                { fieldtype: 'Int', fieldname: 'current_age', label: '年龄（自动）', read_only: 1, default: emp_data ? emp_data.current_age : 0, description: '身份证自动识别；护照/其他证件根据手填出生日期计算。' },
                { fieldtype: 'Select', fieldname: 'gender', label: '性别', options: ['','男','女'], default: emp_data ? emp_data.gender : '', onchange: retirementOnChange },

                { fieldtype: 'Section Break', label: '人事与用工' },
                                { fieldtype: 'Select', fieldname: 'employee_type', label: '用工性质', options: get_qifu_active_employee_types(emp_data ? emp_data.employee_type : null), default: emp_data ? (emp_data.employee_type || '正式工') : (get_qifu_active_employee_types()[0] || '正式工'), onchange: function() { retirementOnChange(); if (typeof refreshSalaryModeOptions === 'function') refreshSalaryModeOptions(); } },
                { fieldtype: 'Select', fieldname: 'employment_status', label: '在职状态', options: ['在职','离职'], default: emp_data ? (emp_data.employment_status || '在职') : '在职' },
                { fieldtype: 'Date', fieldname: 'date_of_joining', label: '入职日期', default: emp_data ? emp_data.date_of_joining : '' },
                { fieldtype: 'Column Break' },
                { fieldtype: 'Data', fieldname: 'mobile', label: '手机号', default: emp_data ? emp_data.mobile : '' },
                { fieldtype: 'Data', fieldname: 'bank_name', label: '开户行', default: emp_data ? emp_data.bank_name : '' },
                { fieldtype: 'Data', fieldname: 'bank_account', label: '银行卡号', default: emp_data ? emp_data.bank_account : '' },

                { fieldtype: 'Section Break', label: '退休政策 (政策公式全自动推导)' },
                { fieldtype: 'Select', fieldname: 'retirement_category', label: '退休类别', options: ['','男职工（原60岁）','女职工（原55岁）','女职工（原50岁）','特殊政策/人工确认'], default: emp_data ? (emp_data.retirement_category || '') : '', onchange: retirementOnChange, description: '根据身份证出生日期、性别及岗位自动匹配。' },
                { fieldtype: 'Float', fieldname: 'original_retirement_age', label: '退休年龄(原)', read_only: 1, default: emp_data ? emp_data.original_retirement_age : 0, description: '根据法定退休类别自动推导（如男60岁/女50岁/女55岁）。' },
                { fieldtype: 'Data', fieldname: 'original_retirement_period', label: '原到龄年月 (YYYY-MM)', read_only: 1, default: emp_data ? (emp_data.original_retirement_period || emp_data.original_retire_period || emp_data.orig_retire_period || '') : '', description: '根据出生日期与原退休年龄由公式全自动推导（出生年月 + 原法定年龄）。' },
                { fieldtype: 'Column Break' },
                { fieldtype: 'Float', fieldname: 'delayed_retirement_age', label: '退休年龄(延)', read_only: 1, default: emp_data ? emp_data.delayed_retirement_age : 0, description: '根据国家《渐进式延迟法定退休年龄》政策引擎自动推导。' },
                { fieldtype: 'Data', fieldname: 'delayed_retirement_period', label: '延迟到龄年月 (YYYY-MM)', read_only: 1, default: emp_data ? (emp_data.delayed_retirement_period || emp_data.delayed_retire_period || '') : '', description: '根据国家《渐进式延迟法定退休年龄》政策引擎自动推导。' },
                { fieldtype: 'HTML', fieldname: 'retirement_preview' },

                { fieldtype: 'Section Break', label: '薪酬长期参数' },
                { fieldtype: 'Select', fieldname: 'salary_mode', label: '计薪方式', options: ['税后动态工资','税后固定工资','税前动态工资','税前固定工资','不税固定工资','不税动态工资'], default: emp_data ? normalize_salary_mode(emp_data.salary_mode, emp_data.fixed_salary, emp_data.employee_type) : '税后动态工资', description: '计税口径（税前/税后/不税）由管理人员指定，临时工锁定为不税固定工资或不税动态工资；正式工不允许免税。', onchange: function() {
                    const sm = d.get_value('salary_mode');
                    const isF = sm === '税前固定工资' || sm === '税后固定工资' || sm === '不税固定工资';
                    if (d.fields_dict && d.fields_dict.fixed_salary) {
                        d.fields_dict.fixed_salary.df.hidden = isF ? 0 : 1;
                        d.fields_dict.fixed_salary.df.reqd = isF ? 1 : 0;
                        if (d.fields_dict.fixed_salary.$wrapper) {
                            d.fields_dict.fixed_salary.$wrapper.toggle(isF);
                        }
                    }
                } },
                { fieldtype: 'Currency', fieldname: 'fixed_salary', label: '固定工资金额 (元)', default: emp_data ? emp_data.fixed_salary : 0, description: '固定工资模式下必须填写具体数值；动态工资直接由外部实发表读取，此字段自动隐藏。' },
                { fieldtype: 'Currency', fieldname: 'post_allowance', label: '职位补贴', default: emp_data ? emp_data.post_allowance : 0 },
                { fieldtype: 'Column Break' },
                { fieldtype: 'Currency', fieldname: 'house_rent_allowance', label: '房/车补', default: emp_data ? emp_data.house_rent_allowance : 0 },

                { fieldtype: 'Section Break', label: '社保与公积金基数' },
                { fieldtype: 'Select', fieldname: 'social_security_base_mode', label: '社保方式', options: ['最低基数','固定基数','动态基数(税前工资20%)','不参保'], default: emp_data ? format_social_insurance_mode_label(emp_data) : '最低基数', description: '最低基数绑定年度最低缴费基数；固定基数由输入金额决定；动态基数按税前工资5%核定（当前公司公积金缴费比例5%）。' },
                { fieldtype: 'Currency', fieldname: 'custom_social_security_base', label: '社保基数', default: emp_data ? Number(emp_data.custom_social_security_base || emp_data.social_security_base || 0) : 0, depends_on: 'eval:doc.social_security_base_mode=="固定基数"', description: '当社保方式为固定基数时生效。' },
                { fieldtype: 'HTML', fieldname: 'social_security_base_hint', options: '<div class="ashan-callout ashan-callout--xs">选择“最低基数”时，系统每次计算都会读取年度配置；不再把最低数值复制到每位员工档案。</div>' },
                { fieldtype: 'Column Break' },
                { fieldtype: 'Select', fieldname: 'housing_fund_base_mode', label: '公积金方式', options: ['最低基数','固定基数','动态基数(税前工资5%)','不缴纳'], default: emp_data ? format_housing_fund_base_mode_label(emp_data) : '最低基数', description: '最低基数联动年度政策；固定基数由输入的基数决定；动态基数按税前工资5%核定（当前公司公积金缴费比例5%）。' },
                { fieldtype: 'Currency', fieldname: 'custom_housing_fund_base', label: '基数', default: emp_data ? Number(emp_data.custom_housing_fund_base || emp_data.housing_fund_base || 2320) : 2320, depends_on: 'eval:doc.housing_fund_base_mode=="固定基数"', description: '当公积金方式为固定基数时生效。' },
                { fieldtype: 'Select', fieldname: 'housing_fund_policy', label: '周期', options: ['季初缴纳','正常缴纳','不缴纳'], default: emp_data ? format_housing_fund_cycle_label(emp_data) : '季初缴纳', description: '季初缴纳按实际缴费月 1、4、7、10 月核定；正常缴纳每月均缴（如孟祥山等）；不缴纳停缴。' },

                { fieldtype: 'Section Break', label: '个税专项附加扣除' },
                { fieldtype: 'Currency', fieldname: 'deduction_child_education', label: '子女教育', default: emp_data ? emp_data.deduction_child_education : 0 },
                { fieldtype: 'Currency', fieldname: 'deduction_continuing_education', label: '继续教育', default: emp_data ? emp_data.deduction_continuing_education : 0 },
                { fieldtype: 'Currency', fieldname: 'deduction_serious_illness', label: '大病医疗', default: emp_data ? emp_data.deduction_serious_illness : 0 },
                { fieldtype: 'Currency', fieldname: 'deduction_housing_loan', label: '住房贷款利息', default: emp_data ? emp_data.deduction_housing_loan : 0 },
                { fieldtype: 'Column Break' },
                { fieldtype: 'Currency', fieldname: 'deduction_housing_rent', label: '住房租金', default: emp_data ? emp_data.deduction_housing_rent : 0 },
                { fieldtype: 'Currency', fieldname: 'deduction_elderly_care', label: '赡养老人', default: emp_data ? emp_data.deduction_elderly_care : 0 },
                { fieldtype: 'Currency', fieldname: 'deduction_infant_care', label: '3岁以下婴幼儿照护', default: emp_data ? emp_data.deduction_infant_care : 0 },

                { fieldtype: 'Section Break', label: '外部工资表姓名别名兼容' },
                {
                    fieldtype: 'Table', fieldname: 'name_aliases', label: '姓名别名登记表',
                    data: emp_data ? (emp_data.name_aliases || []) : [],
                    in_place_edit: true,
                    cannot_add_rows: false,
                    cannot_delete_rows: false,
                    description: '车间外部工资表出现错别字、曾用字或特定称谓时（如刘海锋/刘海峰），在此登记。外部实发表解析时将 100% 精准优先匹配该员工档案。',
                    fields: [
                        { fieldtype: 'Data', fieldname: 'alias_name', label: '姓名别名', reqd: 1, in_list_view: 1, columns: 4 },
                        { fieldtype: 'Data', fieldname: 'alias_note', label: '备注说明', in_list_view: 1, columns: 6 }
                    ]
                },
                { fieldtype: 'Section Break', label: '其他备注' },
                { fieldtype: 'Small Text', fieldname: 'notes', label: '备注说明', default: emp_data ? emp_data.notes : '' }
            ],
            primary_action_label: isEdit ? '保存修改' : '立即创建',
            primary_action(vals) {
                if ((vals.certificate_type || '中国居民身份证') !== '中国居民身份证' && (!vals.birth_date || !vals.gender)) {
                    frappe.msgprint({ title: '资料不完整', indicator: 'orange', message: '护照或其他证件无法自动识别年龄和性别，请先填写出生日期和性别。' });
                    return;
                }
                vals.company = COMPANY;
                vals.period_month = current_month;
                vals.original_retirement_period = getField('original_retirement_period');
                vals.delayed_retirement_period = getField('delayed_retirement_period');
                if (isEdit) vals.name = emp_data.name;
                const hfMode = vals.housing_fund_base_mode || (emp_data ? format_housing_fund_base_mode_label(emp_data) : '最低基数');
                const hfCycle = vals.housing_fund_policy || (emp_data ? format_housing_fund_cycle_label(emp_data) : '季初缴纳');
                vals.housing_fund_base_mode = hfMode;
                if (hfMode === '固定基数') {
                    vals.custom_housing_fund_base = Number(vals.custom_housing_fund_base || 0);
                    vals.housing_fund_base = vals.custom_housing_fund_base;
                } else if (hfMode === '不缴纳' || hfCycle === '不缴纳') {
                    vals.housing_fund_base_mode = '不缴纳';
                    vals.housing_fund_policy = '固定停缴';
                    vals.custom_housing_fund_base = 0;
                    vals.housing_fund_base = 0;
                } else {
                    vals.custom_housing_fund_base = 0;
                    vals.housing_fund_base = 2320;
                }
                if (vals.housing_fund_base_mode !== '不缴纳') {
                    vals.housing_fund_policy = (hfCycle === '正常缴纳' || hfCycle === '每月正常缴纳' || hfCycle === '固定缴纳') ? '固定缴纳' : '跟随公司规则';
                }
                frappe.call({
                    method: isEdit ? 'ashan_cn_procurement.services.employee_salary_service.update_employee_salary_profile' : 'ashan_cn_procurement.services.employee_salary_service.create_employee_salary_profile',
                    type: 'POST',
                    args: vals,
                    callback: function(r) {
                        if (r.message && r.message.success) {
                            frappe.show_alert({ message: r.message.message, indicator: 'green' });
                            if (d.set_force_closing) d.set_force_closing(true);
                            d.hide();
                            load_salary_main_tab();
                            load_qifu_employees(true);
                            load_social_insurance_tab();
                            load_housing_fund_tab();
                            load_tax_settlement_tab();
                            load_payroll_settlement();
                            load_monthly_workflow_hub();
                        }
                    }
                });
            }
        });
                const refreshSalaryModeOptions = () => {
            if (!d) return;
            const empType = (d.get_value('employee_type') || (emp_data && emp_data.employee_type) || '正式工').trim();
            const isTemp = empType === '临时工' || empType === '零工';
            const isRegular = empType === '正式工';
            const $modeField = d.fields_dict.salary_mode;
            if ($modeField) {
                const currentMode = d.get_value('salary_mode');
                const fixedVal = flt(d.get_value('fixed_salary') || (emp_data ? emp_data.fixed_salary : 0));
                let options = [];
                if (isTemp) {
                    options = ['不税固定工资', '不税动态工资'];
                } else if (isRegular) {
                    options = ['税后动态工资', '税后固定工资', '税前动态工资', '税前固定工资'];
                } else {
                    options = ['税后动态工资', '税后固定工资', '税前动态工资', '税前固定工资', '不税固定工资', '不税动态工资'];
                }
                $modeField.df.options = options;
                if ($modeField.$input) {
                    $modeField.$input.empty();
                    options.forEach(opt => {
                        $modeField.$input.append(`<option value="${opt}">${opt}</option>`);
                    });
                }
                let targetMode = currentMode;
                if (isRegular && (targetMode === '不税固定工资' || targetMode === '不税动态工资')) {
                    targetMode = fixedVal > 0 ? '税后固定工资' : '税后动态工资';
                } else if (isTemp && (targetMode === '税后固定工资' || targetMode === '税前固定工资')) {
                    targetMode = '不税固定工资';
                } else if (isTemp && (targetMode === '税后动态工资' || targetMode === '税前动态工资')) {
                    targetMode = '不税动态工资';
                } else if (!options.includes(targetMode)) {
                    targetMode = fixedVal > 0 ? (isTemp ? '不税固定工资' : '税后固定工资') : (isTemp ? '不税动态工资' : '税后动态工资');
                }
                d.set_value('salary_mode', targetMode);
                if (typeof $modeField.set_description === 'function') {
                    if (isTemp) {
                        $modeField.set_description('临时工独立免税/免申报，计薪方式锁定为不税固定工资或不税动态工资。固定模式需填写具体工资金额（无视外部工资）；动态模式由外部实发表直接读取。');
                    } else if (isRegular) {
                        $modeField.set_description('计税口径（税前/税后）由管理人员指定，正式工不允许免税。涉及固定需填写具体工资金额；涉及动态直接读取外部实发表，金额输入框自动隐藏。');
                    } else {
                        $modeField.set_description('按人员实际用工性质选择计税口径与薪资形态。固定模式需填写金额；动态模式读取外部工资。');
                    }
                }
                if (isTemp) {
                    if (d.fields_dict.social_security_base_mode) {
                        d.set_value('social_security_base_mode', '不参保');
                    }
                    if (d.fields_dict.housing_fund_base_mode) {
                        d.set_value('housing_fund_base_mode', '不缴纳');
                    }
                    if (d.fields_dict.housing_fund_policy) {
                        d.set_value('housing_fund_policy', '不缴纳');
                    }
                }
            }

            const sm = d.get_value('salary_mode');
            const isF = sm === '税前固定工资' || sm === '税后固定工资' || sm === '不税固定工资';
            if (d.fields_dict.fixed_salary) {
                d.fields_dict.fixed_salary.df.hidden = isF ? 0 : 1;
                d.fields_dict.fixed_salary.df.reqd = isF ? 1 : 0;
                if (d.fields_dict.fixed_salary.$wrapper) {
                    d.fields_dict.fixed_salary.$wrapper.toggle(isF);
                }
            }
        };

        cur_dialog = d;
        d.show();
        setTimeout(refreshSalaryModeOptions, 60);
        if (read_only) {
            d.get_primary_btn().hide();
            d.$wrapper.find('.modal-title').text(`查看员工薪酬档案 · ${emp_data.employee_name || ''} (${emp_data.employee_no || ''}) [已核定只读]`);
            Object.values(d.fields_dict || {}).forEach(f => {
                if (f && f.df) f.df.read_only = 1;
                if (f && f.$input) f.$input.prop('disabled', true);
            });
        }
        const initSm = normalize_salary_mode(d.get_value('salary_mode'), d.get_value('fixed_salary'));
        const initIsF = initSm === '税前固定工资' || initSm === '税后固定工资' || initSm === '不税固定工资';
        if (d.fields_dict && d.fields_dict.fixed_salary) {
            d.fields_dict.fixed_salary.df.hidden = initIsF ? 0 : 1;
            d.fields_dict.fixed_salary.df.reqd = initIsF ? 1 : 0;
            if (d.fields_dict.fixed_salary.$wrapper) {
                d.fields_dict.fixed_salary.$wrapper.toggle(initIsF);
            }
        }
        setTimeout(refreshRetirementPreview, 80);
        if (read_only) {
            if (d.get_primary_btn) d.get_primary_btn().hide();
            Object.keys(d.fields_dict || {}).forEach(fn => {
                if (d.set_df_property) d.set_df_property(fn, 'read_only', 1);
            });
        }
        attach_unsaved_changes_guard(d, EMP_FIELD_LABELS);
    }

    function get_last_day_of_month(ym) {
        if (!ym || !ym.includes('-')) return '';
        const parts = ym.split('-');
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const d = new Date(y, m, 0).getDate();
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }

    // 办理单人离职弹窗
    function open_resign_dialog(emp_no, emp_name) {
        const default_date = get_last_day_of_month(current_month);
        const d = new frappe.ui.Dialog({
            title: ` 办理员工离职 · ${emp_name}`,
            size: 'small',
            fields: [
                { fieldtype: 'Data', fieldname: 'employee_no', label: '工号', default: emp_no, read_only: 1 },
                { fieldtype: 'Data', fieldname: 'employee_name', label: '员工姓名', default: emp_name, read_only: 1 },
                {
                    fieldtype: 'Date',
                    fieldname: 'relieving_date',
                    label: '离职日期',
                    reqd: 1,
                    default: default_date,
                    description: `默认当月最后一天 (${default_date})`
                },
                {
                    fieldtype: 'Select',
                    fieldname: 'resignation_reason',
                    label: '离职原因',
                    options: ['正常离职', '合同到期', '个人原因', '协商解除', '退休', '其他'],
                    default: '正常离职'
                },
                {
                    fieldtype: 'HTML',
                    fieldname: 'rule_tip',
                    options: `
                    <div class="ashan-callout ashan-callout--xs ashan-mt-2">
                         <strong>财务减员联动规则</strong>：<br>
                        员工在【<strong>${current_month}</strong>】离职后，系统仍会核算其当月在职薪酬与个税；对应次月的社保与公积金将<strong>自动停止缴纳（自动减员）</strong>。
                    </div>
                    `
                }
            ],
            primary_action_label: '确认办理离职',
            primary_action(vals) {
                frappe.call({
                    method: 'ashan_cn_procurement.services.employee_salary_service.set_employee_resignation',
                    type: 'POST',
                    args: {
                        employee_no: vals.employee_no,
                        relieving_date: vals.relieving_date,
                        resignation_reason: vals.resignation_reason,
                        company: COMPANY,
                        period_month: current_month
                    },
                    callback: function(r) {
                        if (r.message && r.message.success) {
                            frappe.show_alert({ message: r.message.message, indicator: 'green' });
                            d.hide();
                            load_monthly_workflow_hub();
                            load_qifu_employees();
                            load_social_insurance_tab();
                            load_housing_fund_tab();
                        }
                    }
                });
            }
        });
        d.show();
    }

    // 批量办理员工离职弹窗
    function open_unified_batch_edit_dialog(selected_emps) {
        if (!selected_emps || selected_emps.length === 0) {
            frappe.msgprint({ title: '提示', indicator: 'orange', message: '请先在列表中勾选需要编辑修改的人员！' });
            return;
        }
        const default_date = get_last_day_of_month(current_month);
        const emp_names_str = selected_emps.map(e => `${e.name} (${e.no})`).join('、');
        const emp_nos = selected_emps.map(e => e.no);

        const d = new frappe.ui.Dialog({
            title: `批量编辑员工档案 (共 ${selected_emps.length} 人)`,
            size: 'large',
            static: true,
            fields: [
                {
                    fieldtype: 'HTML',
                    fieldname: 'selected_list',
                    options: `
                    <div class="qifu-proof-modal-card">
                        <div class="ashan-callout ashan-callout--info">
                            <strong>已选员工 (${selected_emps.length} 人)</strong>：<br>
                            <span class="qifu-val-blue">${emp_names_str}</span>
                        </div>
                    </div>
                    `
                },
                {
                    fieldtype: 'Select',
                    fieldname: 'batch_action_type',
                    label: '批量操作类型',
                    options: [
                        { label: '调整薪酬参数与用工规则', value: 'adjust_param' },
                        { label: '批量办理离职', value: 'resign' }
                    ],
                    default: 'adjust_param',
                    reqd: 1
                },
                {
                    fieldtype: 'Section Break',
                    fieldname: 'sec_param',
                    label: '薪酬参数调整项',
                    depends_on: 'eval:doc.batch_action_type=="adjust_param"'
                },
                {
                    fieldtype: 'Select',
                    fieldname: 'param_field',
                    label: '修改项目',
                    options: [
                        { label: '计薪方式', value: 'salary_mode' },
                        { label: '用工性质', value: 'employee_type' },
                        { label: '固定工资标准 (元)', value: 'fixed_salary' },
                        { label: '职位岗位补贴 (元)', value: 'post_allowance' },
                        { label: '房补与车补 (元)', value: 'house_rent_allowance' },
                        { label: '社保基数 (元)', value: 'social_security_base' },
                        { label: '公积金基数 (元)', value: 'housing_fund_base' }
                    ],
                    default: 'salary_mode',
                    depends_on: 'eval:doc.batch_action_type=="adjust_param"'
                },
                {
                    fieldtype: 'Select',
                    fieldname: 'param_salary_mode',
                    label: '新计薪方式',
                    options: ['税前固定工资', '税后固定工资', '不税固定工资', '税后动态工资', '税前动态工资', '不税动态工资', '免税零工'],
                    default: '税后动态工资',
                    depends_on: 'eval:doc.batch_action_type=="adjust_param" && doc.param_field=="salary_mode"'
                },
                {
                    fieldtype: 'Select',
                    fieldname: 'param_employee_type',
                    label: '新用工性质',
                    options: ['正式工', '返聘工', '其他-返聘工', '其他-外籍工', '临时工', '零工'],
                    default: '正式工',
                    depends_on: 'eval:doc.batch_action_type=="adjust_param" && doc.param_field=="employee_type"'
                },
                {
                    fieldtype: 'Currency',
                    fieldname: 'param_amount',
                    label: '新金额数值',
                    default: 0,
                    depends_on: 'eval:doc.batch_action_type=="adjust_param" && doc.param_field!="salary_mode" && doc.param_field!="employee_type"'
                },
                {
                    fieldtype: 'Section Break',
                    fieldname: 'sec_resign',
                    label: '离职信息登记',
                    depends_on: 'eval:doc.batch_action_type=="resign"'
                },
                {
                    fieldtype: 'Date',
                    fieldname: 'relieving_date',
                    label: '统一离职日期',
                    default: default_date,
                    description: `默认当月最后一天 (${default_date})`,
                    depends_on: 'eval:doc.batch_action_type=="resign"'
                },
                {
                    fieldtype: 'Select',
                    fieldname: 'resignation_reason',
                    label: '离职原因',
                    options: ['个人离职', '合同到期', '公司原因', '协商解除', '退休', '其他'],
                    default: '个人离职',
                    depends_on: 'eval:doc.batch_action_type=="resign"'
                },
                {
                    fieldtype: 'HTML',
                    fieldname: 'resign_tip',
                    options: `
                    <div class="ashan-callout ashan-callout--warning">
                        <strong>当月发薪与次月减员规则</strong>：<br>
                        办理离职后，员工当月正常计发工资；次月起社保与公积金自动停缴减员。
                    </div>
                    `,
                    depends_on: 'eval:doc.batch_action_type=="resign"'
                }
            ],
            primary_action_label: `确认批量执行 (${selected_emps.length}人)`,
            primary_action(vals) {
                if (vals.batch_action_type === 'resign') {
                    if (!vals.relieving_date) {
                        frappe.msgprint("请填写离职日期！");
                        return;
                    }
                    frappe.call({
                        method: 'ashan_cn_procurement.services.employee_salary_service.batch_set_employee_resignation',
                        type: 'POST',
                        args: {
                            employee_nos: JSON.stringify(emp_nos),
                            relieving_date: vals.relieving_date,
                            resignation_reason: vals.resignation_reason,
                            company: COMPANY,
                            period_month: current_month
                        },
                        callback: function(r) {
                            if (r.message && r.message.success) {
                                frappe.show_alert({ message: r.message.message, indicator: 'green' }, 4);
                                d.hide();
                                load_monthly_workflow_hub();
                                load_qifu_employees();
                                load_social_insurance_tab();
                                load_housing_fund_tab();
                            }
                        }
                    });
                } else {
                    let field = vals.param_field;
                    let val = null;
                    if (field === 'salary_mode') val = vals.param_salary_mode;
                    else if (field === 'employee_type') val = vals.param_employee_type;
                    else val = Number(vals.param_amount || 0);

                    frappe.call({
                        method: 'ashan_cn_procurement.services.employee_salary_service.batch_update_employees',
                        type: 'POST',
                        args: {
                            employee_names: JSON.stringify(emp_nos),
                            fieldname: field,
                            value: val,
                            period_month: current_month
                        },
                        callback: function(r) {
                            if (r.message && r.message.success) {
                                frappe.show_alert({ message: r.message.message, indicator: 'green' }, 4);
                                d.hide();
                                load_monthly_workflow_hub();
                                load_qifu_employees();
                                if (current_tab === 'salary_main') load_salary_main_tab();
                            }
                        }
                    });
                }
            }
        });
        d.show();
    }

    function open_batch_resign_dialog(selected_emps) {
        if (!selected_emps || selected_emps.length === 0) {
            frappe.msgprint({ title: '提示', indicator: 'orange', message: '请先在员工列表中勾选需要办理离职的人员！' });
            return;
        }
        const default_date = get_last_day_of_month(current_month);
        const emp_names_str = selected_emps.map(e => `${e.name} (${e.no})`).join('、');
        const emp_nos = selected_emps.map(e => e.no);

        const d = new frappe.ui.Dialog({
            title: ` 批量办理员工离职 (共 ${selected_emps.length} 人)`,
            size: 'small',
            fields: [
                {
                    fieldtype: 'HTML',
                    fieldname: 'selected_list',
                    options: `
                    <div class="qifu-proof-modal-card">
                        <div class="ashan-callout ashan-callout--info">
                            <strong>已选员工 (${selected_emps.length} 人)</strong>：<br>
                            <span class="qifu-val-blue">${emp_names_str}</span>
                        </div>
                    </div>
                    `
                },
                {
                    fieldtype: 'Date',
                    fieldname: 'relieving_date',
                    label: '统一离职日期',
                    reqd: 1,
                    default: default_date,
                    description: `默认当月最后一天 (${default_date})`
                },
                {
                    fieldtype: 'Select',
                    fieldname: 'resignation_reason',
                    label: '离职原因',
                    options: ['正常离职', '合同到期', '个人原因', '协商解除', '退休', '其他'],
                    default: '正常离职'
                },
                {
                    fieldtype: 'HTML',
                    fieldname: 'rule_tip',
                    options: `
                    <div class="ashan-callout ashan-callout--xs ashan-mt-2">
                         <strong>财务减员联动规则</strong>：<br>
                        批量离职成功后，上述 ${selected_emps.length} 位员工下月对应的社保与公积金将<strong>一键自动减员</strong>！
                    </div>
                    `
                }
            ],
            primary_action_label: `确认批量离职 (${selected_emps.length}人)`,
            primary_action(vals) {
                frappe.call({
                    method: 'ashan_cn_procurement.services.employee_salary_service.batch_set_employee_resignation',
                    type: 'POST',
                    args: {
                        employee_nos: JSON.stringify(emp_nos),
                        relieving_date: vals.relieving_date,
                        resignation_reason: vals.resignation_reason,
                        company: COMPANY,
                        period_month: current_month
                    },
                    callback: function(r) {
                        if (r.message && r.message.success) {
                            frappe.msgprint({ title: ' 批量离职成功', indicator: 'green', message: r.message.message });
                            d.hide();
                            load_monthly_workflow_hub();
                            load_qifu_employees();
                            load_social_insurance_tab();
                            load_housing_fund_tab();
                        }
                    }
                });
            }
        });
        d.show();
    }

    // 查看薪资发放表 (24列整合版模态框)
    function open_salary_distribution_modal() {
        frappe.call({
            method: 'ashan_cn_procurement.services.payroll_settlement_service.get_salary_distribution_sheet',
            args: { company: COMPANY, period_month: current_month },
            callback: function(r) {
                if (!r.message || !r.message.rows) return;
                const dist_data = r.message;
                const rows = dist_data.rows || [];
                const tot = dist_data.totals || {};

                let trs = '';
                rows.forEach(r => {
                    trs += `
                    <tr>
                        <td style="text-align:center; color:#94a3b8;">${r.seq}</td>
                        <td class="qifu-text-center"><strong>${r.employee_no}</strong></td>
                        <td><strong style="color:#1e3a8a;">${r.employee_name}</strong></td>
                        <td class="qifu-money-cell">${r.work_days || 0}</td>
                        <td class="qifu-money-cell">${r.work_hours || 0}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.day_salary)}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.hour_salary)}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.full_attendance)}</td>
                        <td class="qifu-money-cell">${r.overtime_hours || 0}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.overtime_salary)}</td>
                        <td class="qifu-money-cell">${r.national_days || 0}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.national_salary)}</td>
                        <td class="qifu-text-center">${r.target_rate || '-'}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.target_salary)}</td>
                        <td class="qifu-money-cell" class="qifu-btn-delete-text">${fmtMoney(r.deduction)}</td>
                        <td class="qifu-money-cell" style="font-weight:600;">${fmtMoney(r.workshop_net)}</td>
                        <td class="qifu-money-cell" style="color:#b45309; font-weight:600;">${fmtMoney(r.post_allowance)}</td>
                        <td class="qifu-money-cell" style="color:#b45309; font-weight:600;">${fmtMoney(r.house_rent_allowance)}</td>
                        <td class="qifu-money-cell" style="color:#b45309; font-weight:700;">${fmtMoney(r.subsidies_total)}</td>
                        <td class="qifu-money-cell" style="color:#2563eb; font-weight:700;">${fmtMoney(r.payable_total)}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.salary_adjust)}</td>
                        <td class="qifu-money-cell" style="color:#16a34a; font-weight:800; font-size:13px;">${fmtMoney(r.net_salary)}</td>
                        <td style="text-align:center; color:#cbd5e1;">${r.sign || ''}</td>
                        <td style="font-size:11px; color:#64748b;">${r.remarks || ''}</td>
                    </tr>
                    `;
                });

                const modal_html = `
                <div style="margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <span style="font-size:14px; font-weight:700; color:#1e3a8a;">【${COMPANY}】${current_month} 薪资发放表</span>
                        <span class="qifu-status-badge qifu-status-locked" style="margin-left:8px;">24列标准整合版 · 包含职位/房补行内整合</span>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button class="btn btn-primary btn-xs" id="btn-modal-export-dist"> 导出此表为 Excel</button>
                        <button class="btn btn-default btn-xs" id="btn-modal-print-dist"> 打印/导出 PDF</button>
                    </div>
                </div>
                <div class="qifu-modal-table-scroll">
                    <table class="qifu-table" id="table-modal-dist-sheet">
                        <thead style="position:sticky; top:0; background:#f8fafc; z-index:1;">
                            <tr>
                                <th style="width:36px;">序号</th>
                                <th>工号</th>
                                <th>姓名</th>
                                <th>作业天数</th>
                                <th>作业小时</th>
                                <th>天工资</th>
                                <th>小时工资</th>
                                <th>全勤费</th>
                                <th>加班小时</th>
                                <th>加班费</th>
                                <th>国勤天数</th>
                                <th>国勤工资</th>
                                <th>达标率</th>
                                <th>达标工资</th>
                                <th>扣除</th>
                                <th style="background:#eff6ff;">考勤绩效工资合计</th>
                                <th style="background:#fef3c7;">职位补贴</th>
                                <th style="background:#fef3c7;">房/车补</th>
                                <th style="background:#fef3c7;">补贴工资合计</th>
                                <th style="background:#dbeafe; color:#1e40af;">应发工资合计</th>
                                <th>工资调整</th>
                                <th style="background:#dcfce7; color:#166534;">实发工资合计</th>
                                <th>签字</th>
                                <th>备考</th>
                            </tr>
                        </thead>
                        <tbody>${trs}</tbody>
                        <tfoot style="background:#f8fafc; font-weight:700;">
                            <tr>
                                <td colspan="3" class="qifu-text-center">合计</td>
                                <td class="qifu-money-cell">${tot.work_days || 0}</td>
                                <td class="qifu-money-cell">${tot.work_hours || 0}</td>
                                <td>-</td><td>-</td>
                                <td class="qifu-money-cell">${fmtMoney(tot.full_attendance)}</td>
                                <td class="qifu-money-cell">${tot.overtime_hours || 0}</td>
                                <td class="qifu-money-cell">${fmtMoney(tot.overtime_salary)}</td>
                                <td class="qifu-money-cell">${tot.national_days || 0}</td>
                                <td class="qifu-money-cell">${fmtMoney(tot.national_salary)}</td>
                                <td>-</td>
                                <td class="qifu-money-cell">${fmtMoney(tot.target_salary)}</td>
                                <td class="qifu-money-cell" class="qifu-btn-delete-text">${fmtMoney(tot.deduction)}</td>
                                <td class="qifu-money-cell">${fmtMoney(tot.workshop_net)}</td>
                                <td class="qifu-money-cell" style="color:#b45309;">${fmtMoney(tot.post_allowance)}</td>
                                <td class="qifu-money-cell" style="color:#b45309;">${fmtMoney(tot.house_rent_allowance)}</td>
                                <td class="qifu-money-cell" style="color:#b45309;">${fmtMoney(tot.subsidies_total)}</td>
                                <td class="qifu-money-cell" class="qifu-val-blue">${fmtMoney(tot.payable_total)}</td>
                                <td class="qifu-money-cell">${fmtMoney(tot.salary_adjust)}</td>
                                <td class="qifu-money-cell" style="color:#16a34a; font-size:13px;">${fmtMoney(tot.net_salary)}</td>
                                <td>-</td><td>-</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
                `;

                const dist_dialog = new frappe.ui.Dialog({
                    title: `${COMPANY || '当前公司'} · ${current_month} 薪资发放表 (24列整合版)`,
                    size: 'extra-large',
                    fields: [{ fieldtype: 'HTML', fieldname: 'dist_content', options: modal_html }],
                    primary_action_label: '关闭',
                    primary_action() { dist_dialog.hide(); }
                });
                dist_dialog.show();
            }
        });
    }

    // 查看记账工资表 (11列财务版模态框)
    function open_accounting_sheet_modal() {
        frappe.call({
            method: 'ashan_cn_procurement.services.payroll_settlement_service.get_accounting_payroll_sheet',
            args: { company: COMPANY, period_month: current_month },
            callback: function(r) {
                if (!r.message || !r.message.rows) return;
                const acc_data = r.message;
                const rows = acc_data.rows || [];
                const tot = acc_data.totals || {};

                let trs = '';
                rows.forEach(r => {
                    trs += `
                    <tr>
                        <td style="text-align:center; color:#94a3b8;">${r.seq}</td>
                        <td class="qifu-text-center"><strong>${r.employee_no}</strong></td>
                        <td><strong style="color:#1e3a8a;">${r.employee_name}</strong></td>
                        <td class="qifu-money-cell">${fmtMoney(r.base_performance_salary)}</td>
                        <td class="qifu-money-cell" style="color:#b45309;">${fmtMoney(r.post_allowance)}</td>
                        <td class="qifu-money-cell" style="color:#b45309;">${fmtMoney(r.house_rent_allowance)}</td>
                        <td class="qifu-money-cell" style="color:#2563eb; font-weight:700;">${fmtMoney(r.gross_salary)}</td>
                        <td class="qifu-money-cell" style="color:#d97706;">${fmtMoney(r.hf_person_total)}</td>
                        <td class="qifu-money-cell" style="color:#d97706;">${fmtMoney(r.ss_person_total)}</td>
                        <td class="qifu-money-cell" class="qifu-btn-delete-text">${fmtMoney(r.tax_amount)}</td>
                        <td class="qifu-money-cell" style="color:#d97706; font-weight:600;">${fmtMoney(r.total_deduction)}</td>
                        <td class="qifu-money-cell" style="color:#16a34a; font-weight:800; font-size:13px;">${fmtMoney(r.net_salary)}</td>
                    </tr>
                    `;
                });

                const modal_html = `
                <div style="margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <span style="font-size:14px; font-weight:700; color:#15803d;">【${COMPANY}】${current_month} 记账工资表</span>
                        <span class="qifu-status-badge qifu-status-locked" style="margin-left:8px;">11列财务标准版 · 基本绩效/补贴/税前/险金/个税/税后</span>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button class="btn btn-primary btn-xs" id="btn-modal-export-acc"> 导出此表为 Excel</button>
                        <button class="btn btn-default btn-xs" id="btn-modal-print-acc"> 打印/导出 PDF</button>
                    </div>
                </div>
                <div class="qifu-modal-table-scroll">
                    <table class="qifu-table" id="table-modal-acc-sheet">
                        <thead style="position:sticky; top:0; background:#f8fafc; z-index:1;">
                            <tr>
                                <th style="width:36px;">序号</th>
                                <th>工号</th>
                                <th>姓名</th>
                                <th>基本绩效工资</th>
                                <th style="background:#fef3c7;">职位补贴</th>
                                <th style="background:#fef3c7;">房/车补</th>
                                <th style="background:#dbeafe; color:#1e40af;">税前工资</th>
                                <th>公积金</th>
                                <th>社保</th>
                                <th>应补/退税额</th>
                                <th style="background:#fef2f2;">合计扣除</th>
                                <th style="background:#dcfce7; color:#166534;">税后工资合计</th>
                            </tr>
                        </thead>
                        <tbody>${trs}</tbody>
                        <tfoot style="background:#f8fafc; font-weight:700;">
                            <tr>
                                <td colspan="3" class="qifu-text-center">合计</td>
                                <td class="qifu-money-cell">${fmtMoney(tot.base_performance_salary)}</td>
                                <td class="qifu-money-cell" style="color:#b45309;">${fmtMoney(tot.post_allowance)}</td>
                                <td class="qifu-money-cell" style="color:#b45309;">${fmtMoney(tot.house_rent_allowance)}</td>
                                <td class="qifu-money-cell" class="qifu-val-blue">${fmtMoney(tot.gross_salary)}</td>
                                <td class="qifu-money-cell" style="color:#d97706;">${fmtMoney(tot.hf_person_total)}</td>
                                <td class="qifu-money-cell" style="color:#d97706;">${fmtMoney(tot.ss_person_total)}</td>
                                <td class="qifu-money-cell" class="qifu-btn-delete-text">${fmtMoney(tot.tax_amount)}</td>
                                <td class="qifu-money-cell" style="color:#d97706;">${fmtMoney(tot.total_deduction)}</td>
                                <td class="qifu-money-cell" style="color:#16a34a; font-size:14px;">${fmtMoney(tot.net_salary)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
                `;

                const acc_dialog = new frappe.ui.Dialog({
                    title: `${COMPANY || '当前公司'} · ${current_month} 记账工资表 (11列财务版)`,
                    size: 'extra-large',
                    fields: [{ fieldtype: 'HTML', fieldname: 'acc_content', options: modal_html }],
                    primary_action_label: '关闭',
                    primary_action() { acc_dialog.hide(); }
                });
                acc_dialog.show();
            }
        });
    }

    // 登记特殊补缴 / 滞纳金弹窗
    function open_add_insurance_adjustment_dialog() {
        frappe.call({
            method: 'ashan_cn_procurement.services.employee_salary_service.get_qifu_employees',
            callback: function(res) {
                const emp_list = res.message || [];
                const emp_options = emp_list.map(e => ({ label: `${e.employee_no} - ${e.employee_name} (${e.employee_type || '正式工'})`, value: e.employee_no }));

                const d = new frappe.ui.Dialog({
                    title: ' 登记社保特殊补缴 / 滞纳金 / 调基差额',
                    fields: [
                        { fieldtype: 'Select', fieldname: 'employee_no', label: '选择员工', options: emp_options, reqd: 1 },
                        { fieldtype: 'Data', fieldname: 'period_month_str', label: '补缴/调整所属期 (如 202605 或 202606)', reqd: 1, default: current_month.replace('-', '') },
                        { fieldtype: 'Select', fieldname: 'biz_type', label: '业务类型', options: ['历史补缴', '滞纳金/利息', '调基差额补退', '特殊补助'], default: '历史补缴', reqd: 1 },
                        { fieldtype: 'Currency', fieldname: 'ss_base', label: '补缴社保基数 (元，录入后自动按费率折算)', default: 5124.0 },
                        { fieldtype: 'Currency', fieldname: 'late_fee', label: '产生滞纳金/利息金额 (元)', default: 0.0 },
                        { fieldtype: 'Small Text', fieldname: 'remarks', label: '备注说明 (如: 补缴5月社保，税局收取滞纳金50元)' }
                    ],
                    primary_action_label: '保存并加入社保台账',
                    primary_action(vals) {
                        frappe.call({
                            method: 'ashan_cn_procurement.services.payroll_settlement_service.save_social_insurance_adjustment',
                            type: 'POST',
                            args: {
                                company: COMPANY,
                                period_month: current_month,
                                adjustment_json: JSON.stringify(vals)
                            },
                            callback: function(r) {
                                if (r.message && r.message.success) {
                                    frappe.show_alert({ message: r.message.message, indicator: 'green' });
                                    d.hide();
                                    load_social_insurance_tab();
                                    load_payroll_settlement();
                                }
                            }
                        });
                    }
                });
                d.show();
            }
        });
    }

    function open_contribution_base_dialog(kind, employee_no, employee_name, current_value, currentMode) {
        const isSS = kind === 'social_security';
        const label = isSS ? '社保缴费基数' : '公积金缴费基数';
        const fields = [
            {fieldtype:'Data', fieldname:'employee', label:'员工', default:`${employee_no} · ${employee_name || ''}`, read_only:1}
        ];
        if (isSS) {
            fields.push(
                {fieldtype:'Select', fieldname:'base_mode', label:'缴费基数方式', options:['最低缴费基数','自定义'], default:currentMode === '自定义' ? '自定义' : '最低缴费基数', reqd:1, description:'最低缴费基数会始终跟随年度配置；自定义只影响该员工。'},
                {fieldtype:'Currency', fieldname:'amount', label:'自定义社保缴费基数', default:Number(current_value || 0), depends_on:'eval:doc.base_mode=="自定义"', description:'选择自定义时填写。'},
                {fieldtype:'HTML', fieldname:'tip', options:'<div class="ashan-callout ashan-callout--xs">选择“最低缴费基数”后，今后调整年度最低基数会自动联动该员工。</div>'}
            );
        } else {
            fields.push(
                {fieldtype:'Currency', fieldname:'amount', label:label, default:Number(current_value || 0), reqd:1},
                {fieldtype:'HTML', fieldname:'tip', options:`<div class="ashan-callout ashan-callout--xs">保存后只标记<strong>${frappe.utils.escape_html(employee_name || employee_no)}</strong>为待计算，并自动提交服务器后台任务；无需再到个税页手动核定。</div>`}
            );
        }
        const d = new frappe.ui.Dialog({
            title:` 单人调整${label} · ${employee_name || employee_no}`,
            size:'small',
            fields:fields,
            primary_action_label:'保存并自动重算',
            primary_action(values) {
                if ((!isSS || values.base_mode === '自定义') && Number(values.amount || 0) < 0) { frappe.msgprint('缴费基数不能为负数。'); return; }
                frappe.call({
                    method:'ashan_cn_procurement.services.employee_salary_service.update_employee_contribution_base',
                    type:'POST',
                    args:{company:COMPANY, period_month:current_month, employee_no:employee_no, base_type:kind, amount:values.amount || 0, base_mode:isSS ? values.base_mode : null},
                    callback:function(r) {
                        if (r.message && r.message.success) {
                            frappe.show_alert({message:r.message.message, indicator:'green'});
                            d.hide();
                            load_qifu_employees();
                            if (isSS) load_social_insurance_tab(); else load_housing_fund_tab();
                            load_calculation_center();
                        }
                    }
                });
            }
        });
        d.show();
    }

    // 7. 历史数据：周期累计 (15列) / 完整核算 (VBA 68列+ERP审计) / 单人申报周期穿透
    let history_full_rows = [];
    let history_current_page = 1;

    function set_history_mode_ui(mode) {
        const normalized = mode === 'full' ? 'full' : (mode === 'single' ? 'single' : 'all');
        $("#btn-history-all, #btn-history-full").removeClass('active').css({"background":"#fff","color":"#334155","border-color":"#cbd5e1"});
        if (normalized === 'full') {
            $("#btn-history-full").addClass('active').css({"background":"#2563eb","color":"#fff","border-color":"#2563eb"});
            $("#history-period-select").show();
            $("#history-edit-hint").show();
        } else {
            $("#btn-history-all").addClass('active').css({"background":"#2563eb","color":"#fff","border-color":"#2563eb"});
            $("#history-period-select").hide();
            $("#history-pagination-box").hide();
            $("#history-edit-hint").toggle(normalized !== 'single');
        }
    }

    function update_history_emp_select(rows, current_emp) {
        const $sel = $("#history-emp-select");
        const existingVal = current_emp !== undefined ? current_emp : ($sel.val() || '');
        const empMap = new Map();
        (rows || []).forEach(r => {
            if (r.employee_no && !empMap.has(r.employee_no)) {
                empMap.set(r.employee_no, r.employee_name || r.employee_no);
            }
        });
        if (empMap.size > 0 && $sel.find('option').length <= 1) {
            let opts = `<option value=""> 全部在册人员</option>`;
            empMap.forEach((name, no) => {
                opts += `<option value="${frappe.utils.escape_html(no)}">${frappe.utils.escape_html(no)} · ${frappe.utils.escape_html(name)}</option>`;
            });
            $sel.html(opts);
        }
        $sel.val(existingVal);
    }

    function load_history_tab(mode, employee_no) {
        current_history_mode = mode || current_history_mode || 'all';
        if (employee_no !== undefined) {
            current_history_employee = employee_no || '';
        }
        const cur_m = $("#qifu-month-select").val() || current_month;
        if (!current_history_period) {
            current_history_period = (current_history_mode === 'full' && current_history_employee) ? 'all' : cur_m;
        }
        set_history_mode_ui(current_history_mode);
        $("#history-emp-select").val(current_history_employee || '');

        if (current_history_employee) {
            $("#btn-history-back").show();
        } else {
            $("#btn-history-back").hide();
        }

        // 68 列完整核算模式 (无论全员还是单人，均按 68 列展示，绝不降级！)
        if (current_history_mode === 'full') {
            frappe.call({
                method: 'ashan_cn_procurement.services.payroll_settlement_service.get_history_full_ledger',
                args: {
                    company: COMPANY,
                    period_month: cur_m,
                    history_period_month: current_history_period || (current_history_employee ? 'all' : cur_m),
                    employee_no: current_history_employee || ''
                },
                callback: function(r) {
                    if (r.message) render_history_full(r.message);
                }
            });
            return;
        }

        // 15 列单人 12 个月轨迹模式
        if (current_history_employee) {
            current_history_mode = 'single';
            set_history_mode_ui('all');
            frappe.call({
                method: 'ashan_cn_procurement.services.payroll_settlement_service.get_employee_tax_history_timeline',
                args: { company: COMPANY, employee_no: current_history_employee, period_month: cur_m },
                callback: function(r) { if (r.message) render_history_single(r.message); }
            });
            return;
        }

        // 15 列全员周期累计模式
        current_history_mode = 'all';
        set_history_mode_ui('all');
        frappe.call({
            method: 'ashan_cn_procurement.services.payroll_settlement_service.get_all_employees_tax_history_summary',
            args: { company: COMPANY, period_month: cur_m },
            callback: function(r) { if (r.message) render_history_all(r.message); }
        });
    }

    function render_history_all(data) {
        history_full_cache = null;
        $('#history-sheet-title').text(`${data.cycle_name || ''}个税申报周期累计明细`);
        $('#history-sheet-meta').text(`共 ${(data.rows || []).length} 条`);
        const rows = data.rows || [];
        const tot = data.totals || {};
        update_history_emp_select(rows, '');
        $("#history-kpi-cycle").text(data.cycle_name || '-');
        $("#history-kpi-count").text(`${rows.length} 人`);
        $("#history-kpi-gross").text(fmtMoney(tot.cum_gross || 0));
        $("#history-kpi-tax").text(fmtMoney(tot.cum_tax_paid || 0));
        $("#history-current-person").html('<span style="font-weight:700; color:#2563eb;">全员 · 申报周期累计 (15列)</span>');
        $("#btn-history-back").hide();
        $("#table-history").css('min-width','1780px');
        const cols = [
            ['seq','序号','text'], ['employee_no','工号','text'], ['employee_name','姓名（点击穿透）','name'], ['employee_type','用工性质','text'],
            ['salary_mode','计薪方式','text'], ['months_paid_desc','已发薪月份','text'], ['cum_gross_salary','累计税前收入','money'],
            ['cum_tax_threshold','累计基本减除费用','money'], ['cum_ss_person','累计社保个人','money'], ['cum_hf_person','累计公积金个人','money'],
            ['cum_special_deductions','累计专项附加扣除','money'], ['cum_taxable_income','累计应纳税所得额','money'], ['tax_rate','当前预扣率','percent'],
            ['cum_tax_paid','累计已扣个税','money'], ['cum_net_salary','累计税后实发','money']
        ];
        $("#thead-history").html(`<tr>${cols.map((c,i)=>`<th class="${i===0?'qifu-col-sticky-1':(i===1?'qifu-col-sticky-2':(i===2?'qifu-col-sticky-3':''))}">${c[1]}</th>`).join('')}</tr>`);
        if (!rows.length) {
            $("#tbody-history").html(`<tr><td colspan="15" style="padding:30px; text-align:center; color:#94a3b8;">当前申报周期暂无历史数据。</td></tr>`);
            $("#tfoot-history").empty();
            return;
        }
        const val = (r,c) => {
            const v=r[c[0]];
            if(c[2]==='money') return fmtMoney(v||0);
            if(c[2]==='percent') return `${Number(v||0).toFixed(2).replace(/\.00$/,'')}%`;
            if(c[2]==='name') return `<a href="javascript:void(0);" class="btn-drill-emp-history" data-emp="${frappe.utils.escape_html(r.employee_no || '')}">${frappe.utils.escape_html(v||'-')} </a>`;
            return frappe.utils.escape_html((v===null||v===undefined||v==='')?'-':String(v));
        };
        $("#tbody-history").html(rows.map(r=>`<tr>${cols.map((c,i)=>`<td class="${i===0?'qifu-col-sticky-1':(i===1?'qifu-col-sticky-2':(i===2?'qifu-col-sticky-3':''))} ${c[2]==='money'?'qifu-money-cell':''}">${val(r,c)}</td>`).join('')}</tr>`).join(''));
        const f = ['合计',`${rows.length} 人`,'','','','',fmtMoney(tot.cum_gross||0),fmtMoney(tot.cum_thresh||0),fmtMoney(tot.cum_ss||0),fmtMoney(tot.cum_hf||0),fmtMoney(tot.cum_special_add||0),fmtMoney(tot.cum_taxable||0),'',fmtMoney(tot.cum_tax_paid||0),fmtMoney(tot.cum_net||0)];
        $("#tfoot-history").html(`<tr>${f.map((v,i)=>`<td class="${i===0?'qifu-col-sticky-1':(i===1?'qifu-col-sticky-2':(i===2?'qifu-col-sticky-3':''))}" style="font-weight:700; background:#f8fafc;">${v}</td>`).join('')}</tr>`);
        adjust_active_table_height();
        sync_dual_scrollbars($("#history-top-scrollbar"), $("#history-table-box"));
    }

    function history_value_html(row, col) {
        const value = row[col.key];
        if (col.type === 'money') return fmtMoney(value || 0);
        if (col.type === 'percent') return `${Number(value || 0).toFixed(2).replace(/\.00$/,'')}%`;
        if (col.type === 'datetime') return fmtDateTime(value);
        if (col.type === 'calc_status') return calcStatusBadge(value || '未计算');
        if (col.type === 'status') {
            const locked = String(value || '').includes('冻结') || String(value || '').includes('锁定');
            return `<span class="qifu-status-badge ${locked ? 'qifu-status-locked' : 'qifu-status-draft'}">${frappe.utils.escape_html(value || '-')}</span>`;
        }
        if (col.type === 'name') {
            return `<a href="javascript:void(0);" class="btn-drill-emp-history" data-emp="${frappe.utils.escape_html(row.employee_no || '')}">${frappe.utils.escape_html(value || '-')} </a>`;
        }
        return frappe.utils.escape_html(value === null || value === undefined || value === '' ? '-' : String(value));
    }

    function render_history_full(data) {
        history_full_cache = data || {};
        $('#history-sheet-title').text(`完整核算台账 (68列+ERP审计)`);
        $('#history-sheet-meta').text(`共 ${(data.rows || []).length} 条`);
        current_history_mode = 'full';
        current_history_period = data.history_period_month || current_history_period || current_month;
        current_history_employee = data.employee_no || current_history_employee || '';
        set_history_mode_ui('full');

        const rows = data.rows || [];
        const cols = data.columns || [];
        const tot = data.totals || {};
        const months = data.available_cycle_months || data.cycle_months || [];

        update_history_emp_select(rows, current_history_employee);

        // 下拉月份选择器：支持选择全部月份或具体月份
        let periodOpts = `<option value="all" ${current_history_period==='all'?'selected':''}> 申报周期全轨迹 (${months[0] || ''} ~ ${months[months.length-1] || ''})</option>`;
        periodOpts += months.map(m => `<option value="${m}" ${m===current_history_period?'selected':''}>${m} ${m===$("#qifu-month-select").val()?'(当前)':''}</option>`).join('');
        $("#history-period-select").html(periodOpts).show();

        $("#history-kpi-cycle").text(data.cycle_name || `${months[0] || '-'} ~ ${months[months.length-1] || '-'}`);
        if (current_history_employee && rows.length > 0) {
            $("#history-kpi-count").text(`1 人 (${rows.length} 个月)`);
        } else {
            $("#history-kpi-count").text(`${rows.length} 条记录`);
        }
        $("#history-kpi-gross").text(fmtMoney(tot.gross_all || tot.gross_salary || 0));
        $("#history-kpi-tax").text(fmtMoney(tot.tax_calculated || tot.tax_current || 0));

        if (current_history_employee) {
            const empName = rows[0]?.employee_name || current_history_employee;
            $("#history-current-person").html(`<span style="color:#2563eb; font-weight:700;">${current_history_employee} · ${empName} · 68列完整核算 (${current_history_period==='all'?'全周期':current_history_period})</span>`);
            $("#btn-history-back").show();
        } else {
            $("#history-current-person").html(`<span style="color:${data.locked?'#b45309':'#059669'}; font-weight:700;">全员 · ${current_history_period==='all'?'全周期流水':current_history_period} · ${frappe.utils.escape_html(data.status || (data.locked?'已冻结':'草稿'))}</span>`);
            $("#btn-history-back").hide();
        }

        $("#history-edit-hint").text(data.locked ? ' 已冻结月份为财务快照，只读；需更正请先反审核。' : ' 未冻结月份可更正受控输入；保存后自动级联后台重算。');
        $("#table-history").css('min-width', Math.max(6800, cols.length * 118) + 'px');

        const stickyClass = i => i===0?'qifu-col-sticky-1':(i===1?'qifu-col-sticky-2':(i===2?'qifu-col-sticky-3':''));
        let heads = cols.map((c,i)=>`<th scope="col" class="${stickyClass(i)}">${frappe.utils.escape_html(c.label || c.key)}</th>`).join('');
        heads += '<th scope="col">历史更正</th>';
        $("#thead-history").html(`<tr>${heads}</tr>`);

        history_full_rows = rows;
        history_current_page = 1;
        render_history_full_page();
    }

    function render_history_full_page() {
        if (!history_full_cache) return;
        const data = history_full_cache;
        const cols = data.columns || [];
        const tot = data.totals || {};
        const rows = history_full_rows || [];
        const stickyClass = i => i===0?'qifu-col-sticky-1':(i===1?'qifu-col-sticky-2':(i===2?'qifu-col-sticky-3':''));

        let display_rows = rows;
        const pageSizeVal = $("#history-page-size").val() || '25';
        if (pageSizeVal !== 'all') {
            const size = parseInt(pageSizeVal, 10) || 25;
            const totalPages = Math.ceil(rows.length / size) || 1;
            if (history_current_page > totalPages) history_current_page = totalPages;
            if (history_current_page < 1) history_current_page = 1;
            const start = (history_current_page - 1) * size;
            display_rows = rows.slice(start, start + size);

            $("#history-page-cur").text(history_current_page);
            $("#history-page-total").text(totalPages);
            $("#history-total-count").text(rows.length);
            $("#history-pagination-box").css("display", rows.length > size ? "inline-flex" : "inline-flex");
            $("#btn-history-prev").prop("disabled", history_current_page <= 1);
            $("#btn-history-next").prop("disabled", history_current_page >= totalPages);
        } else {
            $("#history-page-cur").text(1);
            $("#history-page-total").text(1);
            $("#history-total-count").text(rows.length);
            $("#history-pagination-box").css("display", rows.length > 25 ? "inline-flex" : "none");
            $("#btn-history-prev").prop("disabled", true);
            $("#btn-history-next").prop("disabled", true);
        }

        if (!display_rows.length) {
            $("#tbody-history").html(`<tr><td colspan="${cols.length+1}" style="padding:34px; text-align:center; color:#94a3b8;">${current_history_period} 尚无月度薪酬快照。</td></tr>`);
            $("#tfoot-history").empty();
            adjust_active_table_height();
            sync_dual_scrollbars($("#history-top-scrollbar"), $("#history-table-box"));
            return;
        }

        $("#tbody-history").html(display_rows.map(row => {
            const tds = cols.map((c,i)=>`<td class="${stickyClass(i)} ${c.type==='money'?'qifu-money-cell':''}">${history_value_html(row,c)}</td>`).join('');
            const isLocked = data.locked || row.history_lock_status === '已冻结';
            const rowPeriod = row.history_period_month || current_history_period;
            const action = isLocked
                ? '<span> 冻结只读</span>'
                : `<button class="btn btn-xs btn-default btn-history-correct" data-emp="${frappe.utils.escape_html(row.employee_no || '')}" data-period="${frappe.utils.escape_html(rowPeriod || '')}"> 更正输入</button>`;
            return `<tr>${tds}<td class="qifu-text-center">${action}</td></tr>`;
        }).join(''));

        const totalCells = cols.map((c,i) => {
            let value = '';
            if (i === 0) value = '合计';
            else if (i === 1) value = `${rows.length} 条`;
            else if (c.type === 'money' && Object.prototype.hasOwnProperty.call(tot, c.key)) value = fmtMoney(tot[c.key] || 0);
            return `<td class="${stickyClass(i)} ${c.type==='money'?'qifu-money-cell':''}" style="font-weight:700; background:#f8fafc;">${value}</td>`;
        }).join('');
        $("#tfoot-history").html(`<tr>${totalCells}<td style="background:#f8fafc;"></td></tr>`);

        adjust_active_table_height();
        sync_dual_scrollbars($("#history-top-scrollbar"), $("#history-table-box"));
    }

    function open_history_correction_dialog(employee_no, period_month) {
        const data = history_full_cache || {};
        const targetPeriod = period_month || current_history_period;
        if (data.locked) {
            frappe.msgprint({title:'历史月份已冻结', indicator:'orange', message:'该月份属于已核定财务快照。请先执行反审核解锁，再进行历史输入更正。'});
            return;
        }
        const row = (data.rows || []).find(r => String(r.employee_no || '') === String(employee_no || '') && (!period_month || String(r.history_period_month || targetPeriod) === String(period_month)));
        if (!row) return;
        const sm = normalize_salary_mode(row.salary_mode, row.fixed_salary);
        const isNetMode = sm.startsWith('税后');
        const salaryRuleText = isNetMode
            ? '当前为税后计薪：<strong>税后目标工资</strong>是权威输入，税前工资由服务器反推，不能直接改。'
            : '当前为税前计薪：<strong>税前工资</strong>是权威输入，税后工资由服务器计算，不能直接改。';
        const fields = [
            {fieldtype:'HTML', fieldname:'tip', options:`<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:7px;padding:9px 11px;color:#9a3412;font-size:12px;line-height:1.55;">仅允许更正历史<strong>权威输入</strong>。${salaryRuleText}<br>税率、累计税额、本月个税等计算结果不可人工改写。保存后 ${targetPeriod} → ${current_month} 将按累计依赖自动进入服务器级联重算。</div>`},
            {fieldtype:'Data', fieldname:'employee', label:'员工', default:`${row.employee_no || ''} · ${row.employee_name || ''}`, read_only:1},
            {fieldtype:'Data', fieldname:'period', label:'更正月份', default:targetPeriod, read_only:1},
            {fieldtype:'Section Break', label:`工资与个人缴费输入 · ${row.salary_mode || '税后'}`},
            {fieldtype:'Currency', fieldname:'gross_salary', label:isNetMode ? '税前工资（计算结果）' : '税前工资（权威输入）', default:row.gross_salary || 0, read_only:isNetMode ? 1 : 0},
            {fieldtype:'Currency', fieldname:'net_salary', label:isNetMode ? '税后目标工资（权威输入）' : '税后工资（计算结果）', default:row.net_salary || 0, read_only:isNetMode ? 0 : 1},
            {fieldtype:'Column Break'},
            {fieldtype:'Currency', fieldname:'ss_person_total', label:'社保个人合计', default:row.ss_person || 0},
            {fieldtype:'Currency', fieldname:'hf_person_total', label:'公积金个人合计', default:row.hf_person || 0},
            {fieldtype:'Section Break', label:'7项专项附加扣除'},
            {fieldtype:'Currency', fieldname:'deduction_child_education', label:'子女教育', default:row.spec_add_child || 0},
            {fieldtype:'Currency', fieldname:'deduction_continuing_education', label:'继续教育', default:row.spec_add_edu || 0},
            {fieldtype:'Currency', fieldname:'deduction_serious_illness', label:'大病医疗', default:row.spec_add_med || 0},
            {fieldtype:'Currency', fieldname:'deduction_housing_loan', label:'住房贷款利息', default:row.spec_add_loan || 0},
            {fieldtype:'Column Break'},
            {fieldtype:'Currency', fieldname:'deduction_housing_rent', label:'住房租金', default:row.spec_add_rent || 0},
            {fieldtype:'Currency', fieldname:'deduction_elderly_care', label:'赡养老人', default:row.spec_add_elder || 0},
            {fieldtype:'Currency', fieldname:'deduction_infant_care', label:'3岁以下婴幼儿照护', default:row.spec_add_baby || 0}
        ];
        const d = new frappe.ui.Dialog({
            title:` 历史输入更正 · ${row.employee_name || employee_no}`,
            size:'large', fields,
            primary_action_label:'保存并提交级联重算',
            primary_action(values) {
                const correction = Object.assign({}, values);
                delete correction.employee; delete correction.period;
                if (isNetMode) delete correction.gross_salary;
                else delete correction.net_salary;
                frappe.call({
                    method:'ashan_cn_procurement.services.payroll_settlement_service.save_history_payroll_input_correction',
                    type:'POST',
                    args:{
                        company:COMPANY,
                        current_period_month:current_month,
                        history_period_month:targetPeriod,
                        employee_no:employee_no,
                        correction_json:JSON.stringify(correction)
                    },
                    freeze:true, freeze_message:'正在保存历史更正并提交后台任务...',
                    callback:function(r) {
                        if (r.message && r.message.success) {
                            frappe.show_alert({message:r.message.message, indicator:'green'});
                            d.hide();
                            load_history_tab('full', current_history_employee);
                            load_calculation_center();
                        }
                    }
                });
            }
        });
        d.show();
    }

    function render_history_single(data) {
        history_full_cache = null;
        const rows = data.rows || [];
        const sum = data.summary || {};
        update_history_emp_select(rows, data.employee_no);
        $("#history-kpi-cycle").text(data.cycle_name || '-');
        $("#history-kpi-count").text('1 人');
        $("#history-kpi-gross").text(fmtMoney(sum.cum_gross_salary || 0));
        $("#history-kpi-tax").text(fmtMoney(sum.cum_tax_paid || 0));
        $("#history-current-person").html(`<span style="color:#2563eb; font-weight:700;">${data.employee_no || ''} · ${data.employee_name || ''} · 15列月度轨迹</span>`);
        $("#btn-history-back").show();
        $("#history-period-select").hide();
        $("#history-pagination-box").hide();
        $("#table-history").css('min-width','1550px');
        const heads=['序号','所属期','状态','税前工资','社保个人','公积金个人','险金合计','专项附加扣除','累计基本减除费用','累计应纳税所得额','预扣率','速算扣除数','往期已扣税','本月个税','税后实发'];
        $("#thead-history").html(`<tr>${heads.map((h,i)=>`<th class="${i===0?'qifu-col-sticky-1':(i===1?'qifu-col-sticky-2':(i===2?'qifu-col-sticky-3':''))}">${h}</th>`).join('')}</tr>`);
        $("#tbody-history").html(rows.map(r=>`<tr style="${r.is_current?'background:#eff6ff;':''}${r.is_future?'color:#94a3b8;':''}">
            <td class="qifu-col-sticky-1" class="qifu-text-center">${r.seq}</td><td class="qifu-col-sticky-2 qifu-font-bold">${r.period_month}</td>
            <td class="qifu-col-sticky-3"><span class="qifu-status-badge ${r.status==='已核定锁定'?'qifu-status-locked':'qifu-status-draft'}">${r.status||'-'}</span></td>
            <td class="qifu-money-cell">${fmtMoney(r.gross_salary)}</td><td class="qifu-money-cell">${fmtMoney(r.ss_person_total)}</td><td class="qifu-money-cell">${fmtMoney(r.hf_person_total)}</td>
            <td class="qifu-money-cell">${fmtMoney(r.insurance_total)}</td><td class="qifu-money-cell">${fmtMoney(r.special_deductions_total)}</td><td class="qifu-money-cell">${fmtMoney(r.threshold_accumulated)}</td>
            <td class="qifu-money-cell qifu-val-amber-bold">${fmtMoney(r.taxable_accumulated)}</td><td class="qifu-text-center">${Number(r.tax_rate||0).toFixed(2).replace(/\.00$/,'')}%</td>
            <td class="qifu-money-cell">${fmtMoney(r.quick_deduction)}</td><td class="qifu-money-cell">${fmtMoney(r.tax_paid_prior)}</td><td class="qifu-money-cell" style="font-weight:800; color:${Number(r.tax_current||0)>0?'#dc2626':'#166534'};">${fmtMoney(r.tax_current)}</td>
            <td class="qifu-money-cell" style="font-weight:700; color:#166534;">${fmtMoney(r.net_salary)}</td></tr>`).join(''));
        $("#tfoot-history").html(`<tr><td colspan="3" style="font-weight:700; background:#f8fafc;">周期累计</td><td class="qifu-money-cell" style="font-weight:700;">${fmtMoney(sum.cum_gross_salary||0)}</td><td class="qifu-money-cell">${fmtMoney(sum.cum_ss_person||0)}</td><td class="qifu-money-cell">${fmtMoney(sum.cum_hf_person||0)}</td><td></td><td class="qifu-money-cell">${fmtMoney(sum.cum_special_deductions||0)}</td><td class="qifu-money-cell">${fmtMoney(sum.cum_tax_threshold||0)}</td><td colspan="4"></td><td class="qifu-money-cell" style="font-weight:800; color:#dc2626;">${fmtMoney(sum.cum_tax_paid||0)}</td><td class="qifu-money-cell" style="font-weight:800; color:#166534;">${fmtMoney(sum.cum_net_salary||0)}</td></tr>`);
        adjust_active_table_height();
        sync_dual_scrollbars($("#history-top-scrollbar"), $("#history-table-box"));
    }

    // Excel 导出 (支持 all / distribution / accounting / insurance / housing_fund / tax / history)
    function export_excel_action(sheet_type, extra_args) {
        frappe.show_alert({ message: ' 正在生成 Excel 报表，请稍候...', indicator: 'blue' });
        frappe.call({
            method: 'ashan_cn_procurement.services.payroll_settlement_service.export_qifu_payroll_excel',
            args: Object.assign({
                company: COMPANY,
                period_month: current_month,
                sheet_type: sheet_type
            }, extra_args || {}),
            callback: function(r) {
                if (r.message && r.message.success) {
                    const b64 = r.message.file_base64;
                    const fname = r.message.filename;
                    const byteChars = atob(b64);
                    const byteNums = new Array(byteChars.length);
                    for (let i = 0; i < byteChars.length; i++) {
                        byteNums[i] = byteChars.charCodeAt(i);
                    }
                    const byteArray = new Uint8Array(byteNums);
                    const blob = new Blob([byteArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                    const link = document.createElement('a');
                    const objectUrl = URL.createObjectURL(blob);
                    link.href = objectUrl;
                    link.download = fname;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
                    frappe.show_alert({ message: ` 成功导出: ${fname}`, indicator: 'green' });
                }
            }
        });
    }

    function export_housing_fund_roster_change(changeType) {
        const label = changeType === 'seal' ? '封存清册' : '增加清册';
        frappe.show_alert({ message: ` 正在生成${label}，请稍候...`, indicator: 'blue' });
        frappe.call({
            method: 'ashan_cn_procurement.services.housing_fund_roster_export_service.export_housing_fund_roster_change_excel',
            args: { company: COMPANY, period_month: current_month, change_type: changeType },
            callback: function(r) {
                if (!r.message || !r.message.success) return;
                const payload = r.message;
                const byteChars = atob(payload.file_base64);
                const byteNums = new Array(byteChars.length);
                for (let i = 0; i < byteChars.length; i++) {
                    byteNums[i] = byteChars.charCodeAt(i);
                }
                const blob = new Blob([new Uint8Array(byteNums)], {
                    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                });
                const link = document.createElement('a');
                const objectUrl = URL.createObjectURL(blob);
                link.href = objectUrl;
                link.download = payload.filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
                frappe.show_alert({ message: ` ${payload.message}`, indicator: 'green' });
            }
        });
    }

    // 纯净打印
    function print_modal_report(title, subtitle, table_element_id) {
        const table_el = document.getElementById(table_element_id);
        if (!table_el) return;
        const table_html = table_el.outerHTML;

        const iframe = document.createElement('iframe');
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        document.body.appendChild(iframe);

        const doc = iframe.contentWindow.document;
        doc.open();
        doc.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <title>${title}</title>
                <style type="text/css">
                    @page { size: landscape; margin: 6mm; }
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                        color: #0f172a;
                        margin: 0;
                        padding: 4px;
                        background: #fff;
                    }
                    .print-header { text-align: center; margin-bottom: 8px; }
                    .print-title { font-size: 15pt; font-weight: 800; color: #0f172a; margin-bottom: 3px; letter-spacing: 0.5px; }
                    .print-sub { font-size: 8.5pt; color: #475569; font-weight: 500; }
                    .print-table-wrapper { width: 100%; border: 1.5px solid #334155 !important; box-sizing: border-box !important; }
                    table { width: 100%; border-collapse: collapse !important; font-size: 8.2pt; line-height: 1.15; box-sizing: border-box !important; }
                    th, td { border: 1px solid #64748b !important; padding: 3.5px 4px !important; box-sizing: border-box !important; }
                    th { font-weight: 700 !important; text-align: center !important; }
                    .qifu-money-cell { text-align: right !important; font-variant-numeric: tabular-nums; }
                    tfoot tr td { font-weight: 800 !important; }
                </style>
            </head>
            <body>
                <div class="print-header">
                    <div class="print-title">${title}</div>
                    <div class="print-sub">${subtitle}</div>
                </div>
                <div class="print-table-wrapper">
                    ${table_html}
                </div>
            </body>
            </html>
        `);
        doc.close();

        setTimeout(() => {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
            setTimeout(() => { document.body.removeChild(iframe); }, 3000);
        }, 300);
    }

    // ==========================================
    // 事件监听与委托
    // ==========================================

// ==========================================
    // 月度全流程任务看板与凭证上传核验 (精细化多维数据渲染)
    // ==========================================
    let cached_workflow_status = null;

    function update_salary_main_confirmation_button(wf) {
        wf = wf || cached_workflow_status;
        const t2 = wf && wf.task2_import;
        const isConfirmed = Boolean(t2 && t2.is_confirmed);
        const isPeriodLocked = Boolean(wf && wf.is_locked);
        const isProtected = isPeriodLocked || isConfirmed;

        if ($("#btn-salary-integrated-action").hasClass("btn-salary-action-attachment")) {
            $("#btn-salary-integrated-action").prop("disabled", false);
        } else {
            $("#btn-salary-integrated-action").prop("disabled", isPeriodLocked);
        }
        $("#btn-salary-reupload").prop("disabled", isProtected);

        const $btn = $("#btn-qifu-confirm-salary-main");
        if (!$btn.length) return;

        if (isPeriodLocked) {
            $btn.text("已封账锁定")
                .addClass("qifu-btn-stage-cancel")
                .removeClass("btn-success")
                .attr("title", "当前账期已整体封账锁定（只读受控）");
            return;
        }

        if (isConfirmed) {
            $btn.text("取消确认").addClass("btn-success jz-btn-green").removeClass("qifu-btn-stage-cancel")
                .addClass("qifu-btn-stage-cancel")
                .removeClass("btn-success")
                .attr("title", "实发表已核定确认。点击取消核定恢复可重新上传与删除状态");
        } else {
            $btn.text("确认本表").removeClass("btn-success jz-btn-green qifu-btn-stage-cancel")
                .removeClass("qifu-btn-stage-cancel")
                .attr("title", "核对外部实发工资无误后点击核定，进入只读受控保护");
        }
    }

    function update_qifu_header_lock_button(isLocked) {
        const wf = cached_workflow_status;
        const canLock = Boolean(wf && wf.can_lock);
        const $lockBtn = $("#btn-qifu-header-lock");
        const $resetBtn = $("#btn-qifu-reset-month");

        if (isLocked) {
            $lockBtn
                .text("已核定锁定")
                .removeClass("btn-success jz-btn-green")
                .addClass("btn-primary")
                .prop("disabled", false)
                .attr("title", "当前账期已封账锁定，点击可申请反审核解锁");
            $resetBtn
                .prop("disabled", true)
                .attr("title", "当前账期已封账锁定，禁止重置");
        } else if (canLock) {
            $lockBtn
                .text("核定本月数据")
                .removeClass("btn-default")
                .addClass("btn-primary btn-success jz-btn-green")
                .prop("disabled", false)
                .attr("title", "前置步骤已全部核准，点击执行月度封账核定");
            $resetBtn
                .prop("disabled", false)
                .attr("title", "重置本月：清空已上传实发表及测算数据，并重置进度");
        } else {
            $lockBtn
                .text("核定本月数据")
                .removeClass("btn-success jz-btn-green")
                .addClass("btn-primary")
                .prop("disabled", true)
                .attr("title", "请先完成员工档案、外部实发、社保与公积金确认");
            $resetBtn
                .prop("disabled", false)
                .attr("title", "重置本月：清空已上传实发表及测算数据，并重置进度");
        }
    }

    function update_employees_confirmation_button(wf) {
        wf = wf || cached_workflow_status;
        const $btn = $("#btn-qifu-confirm-employees");
        if (!$btn.length) return;
        const p = wf && wf.task1_profile;
        const isConfirmed = Boolean(p && p.is_confirmed);
        const isPeriodLocked = Boolean(wf && wf.is_locked);

        if (isConfirmed) {
            $btn.text("取消确认").addClass("btn-success jz-btn-green").removeClass("qifu-btn-stage-cancel")
                .addClass("qifu-btn-stage-cancel")
                .removeClass("btn-success")
                .attr("title", isPeriodLocked ? "当前账期已封账锁定（只读受控）" : "点击取消员工档案核定，恢复可编辑状态");
        } else {
            $btn.text("确认本表").removeClass("btn-success jz-btn-green qifu-btn-stage-cancel")
                .removeClass("qifu-btn-stage-cancel")
                .attr("title", "核对全员档案无误后点击核定，进入只读受控保护");
        }
    }

function update_social_insurance_release_button(workflow) {
        workflow = workflow || cached_workflow_status;
        const task = workflow && workflow.task3_ss ? workflow.task3_ss : {};
        const p = workflow && workflow.task1_profile ? workflow.task1_profile : {};
        const $button = $("#btn-tab3-confirm-ss");
        const $status = $("#tab3-release-status");
        if (!$button.length) return;

        const isPeriodLocked = Boolean(workflow && workflow.is_locked);
        const isConfirmed = Boolean(task.is_confirmed);
        const isProfileConfirmed = Boolean(p.is_confirmed);

        $status.text("").removeClass("is-confirmed is-pending is-blocked");

        if (isPeriodLocked) {
            $button.prop("disabled", true).removeClass("btn-primary btn-success").addClass("btn-default")
                .text("已封账锁定").attr("title", "当前账期已整体封账锁定（只读受控）");
            $status.text("账期已封账").addClass("is-confirmed");
            return;
        }

        if (isConfirmed) {
            $button.prop("disabled", false).addClass("btn-danger qifu-btn-stage-cancel").removeClass("btn-success btn-primary qifu-btn-confirm btn-default")
                .text("撤销本表").attr("title", "点击撤销社会保险核定状态");
            $status.text(task.confirmed_by ? `核定人：${task.confirmed_by}` : "已核定放行").addClass("is-confirmed");
            return;
        }

        $button.removeClass("btn-danger qifu-btn-stage-cancel");
        if (!isProfileConfirmed) {
            $button.prop("disabled", false).addClass("btn-success qifu-btn-confirm").removeClass("btn-danger qifu-btn-stage-cancel btn-default")
                .text("确认本表").attr("title", "请先核定【员工薪酬档案】！待在册人员与参保基数确定后方可核定社保");
            $status.text("待核定员工档案").addClass("is-blocked");
            return;
        }

        $button.prop("disabled", false).addClass("btn-success qifu-btn-confirm").removeClass("btn-danger qifu-btn-stage-cancel btn-default")
            .text("确认本表").attr("title", "凭证核验一致，点击核定放行社会保险");
        if (task.status === "verified" || task.can_confirm) {
            $status.text("核验一致·待核定").addClass("is-pending");
        } else {
            $status.text(task.status === "mismatch" ? "凭证与系统金额不符" : "待上传核验凭证").removeClass("is-confirmed").addClass("is-pending");
        }
    }

    function update_housing_fund_release_button(workflow) {
        workflow = workflow || cached_workflow_status;
        const task = workflow && workflow.task4_hf ? workflow.task4_hf : {};
        const p = workflow && workflow.task1_profile ? workflow.task1_profile : {};
        const $button = $("#btn-tab4-confirm-hf");
        const $status = $("#tab4-release-status");
        if (!$button.length) return;

        const isPeriodLocked = Boolean(workflow && workflow.is_locked);
        const isConfirmed = Boolean(task.is_confirmed);
        const isProfileConfirmed = Boolean(p.is_confirmed);

        $status.text("").removeClass("is-confirmed is-pending is-blocked");

        if (isPeriodLocked) {
            $button.prop("disabled", true).removeClass("btn-primary btn-success").addClass("btn-default")
                .text("已封账锁定").attr("title", "当前账期已整体封账锁定（只读受控）");
            $status.text("账期已封账").addClass("is-confirmed");
            return;
        }

        if (isConfirmed) {
            $button.prop("disabled", false).addClass("btn-danger qifu-btn-stage-cancel").removeClass("btn-success btn-primary qifu-btn-confirm btn-default")
                .text("撤销本表").attr("title", "点击撤销住房公积金核定状态");
            $status.text(task.confirmed_by ? `核定人：${task.confirmed_by}` : "已核定放行").addClass("is-confirmed");
            return;
        }

        $button.removeClass("btn-danger qifu-btn-stage-cancel");
        if (!isProfileConfirmed) {
            $button.prop("disabled", false).addClass("btn-success qifu-btn-confirm").removeClass("btn-danger qifu-btn-stage-cancel btn-default")
                .text("确认本表").attr("title", "请先核定【员工薪酬档案】！待在册人员与公积金基数确定后方可核定公积金");
            $status.text("待核定员工档案").addClass("is-blocked");
            return;
        }

        $button.prop("disabled", false).addClass("btn-success qifu-btn-confirm").removeClass("btn-danger qifu-btn-stage-cancel btn-default")
            .text("确认本表").attr("title", "凭证核验一致，点击核定放行住房公积金");
        if (task.status === "verified" || task.can_confirm) {
            $status.text("核验一致·待核定").addClass("is-pending");
        } else {
            $status.text(task.status === "mismatch" ? "凭证与系统金额不符" : "待上传核验凭证").removeClass("is-confirmed").addClass("is-pending");
        }
    }

    function update_auto_confirmed_indicators(workflow) {
        workflow = workflow || cached_workflow_status;
        if (!workflow) return;
        const allFourConfirmed = Boolean(
            workflow.task1_profile && workflow.task1_profile.is_confirmed &&
            workflow.task2_import && workflow.task2_import.is_confirmed &&
            workflow.task3_ss && workflow.task3_ss.is_confirmed &&
            workflow.task4_hf && workflow.task4_hf.is_confirmed
        );

        if (allFourConfirmed) {
            $("#tab5-auto-verify-badge").html('<span class="qifu-status-badge qifu-state-ok">前置四要素已全核定 · 个税已自动核定完成</span>').show();
            $("#tab6-auto-verify-badge").html('<span class="qifu-status-badge qifu-state-ok">前置四要素已全核定 · 综合薪酬已自动核定完成</span>').show();
        } else {
            $("#tab5-auto-verify-badge").html('<span class="qifu-status-badge qifu-state-warn">待前置四要素核定 (档案/实发/社保/公积金)</span>').show();
            $("#tab6-auto-verify-badge").html('<span class="qifu-status-badge qifu-state-warn">待前置四要素核定 (档案/实发/社保/公积金)</span>').show();
        }
    }

    let _loading_monthly_workflow = false;
    function load_monthly_workflow_hub(force) {
        if (!COMPANY) return;
        if (_loading_monthly_workflow && !force) return;
        _loading_monthly_workflow = true;
        const cur_m = $("#qifu-month-select").val() || current_month;
        $("#workflow-period-text").text(cur_m);
        if (cur_m && cur_m.includes("-")) {
            const parts = cur_m.split("-");
            let y = parseInt(parts[0], 10);
            let m = parseInt(parts[1], 10);
            if (m === 12) { y += 1; m = 1; } else { m += 1; }
            const m_str = m < 10 ? "0" + m : "" + m;
            $("#workflow-ss-period-text").text(`${y}-${m_str} (${y}年${m_str}月)`);
        }

        frappe.call({
            method: 'ashan_cn_procurement.services.payroll_settlement_service.get_monthly_workflow_status',
            args: { company: COMPANY, period_month: cur_m },
            callback: function(r) {
                _loading_monthly_workflow = false;
                if (!r.message) return;
                const wf = r.message;
                cached_workflow_status = wf;
                update_social_insurance_release_button(wf);

                const allFourConfirmed = Boolean(
                    wf.task1_profile && wf.task1_profile.is_confirmed &&
                    wf.task2_import && wf.task2_import.is_confirmed &&
                    wf.task3_ss && wf.task3_ss.is_confirmed &&
                    wf.task4_hf && wf.task4_hf.is_confirmed
                );

                const qifuTabStepMap = [
                    { tab: 'employees', done: Boolean(wf.task1_profile && wf.task1_profile.is_confirmed) },
                    { tab: 'salary_main', done: Boolean(wf.task2_import && (wf.task2_import.is_confirmed || (wf.task2_import.status === 'done' && wf.is_locked))) },
                    { tab: 'social_insurance', done: Boolean(wf.task3_ss && wf.task3_ss.is_confirmed) },
                    { tab: 'housing_fund', done: Boolean(wf.task4_hf && wf.task4_hf.is_confirmed) },
                    { tab: 'tax', done: allFourConfirmed || Boolean(wf.task5_settlement && wf.task5_settlement.total_gross > 0 && wf.is_locked) },
                    { tab: 'settlement', done: allFourConfirmed || Boolean(wf.is_locked || wf.can_lock) }
                ];
                qifuTabStepMap.forEach(({ tab, done }) => {
                    const $btn = $(`.qifu-tab-btn[data-tab="${tab}"]`);
                    let $dot = $btn.find('.tab-status-dot');
                    if (!$dot.length) {
                        $dot = $('<span class="tab-status-dot"></span>');
                        $btn.prepend($dot);
                    }
                    $dot.removeClass('status-ok status-warn status-err');
                    if (done) $dot.addClass('status-ok');
                    else $dot.addClass('status-warn');
                });

                if (wf.is_locked) {
                    $('#btn-qifu-header-lock')
                        .text(' 已封账锁定 (申请解锁)')
                        .removeClass('btn-primary btn-success')
                        .addClass('btn-default')
                        .prop('disabled', false)
                        .attr('title', '点击申请反审核解锁');
                } else if (wf.can_lock) {
                    $('#btn-qifu-header-lock')
                        .text(' 立即核定本月数据')
                        .removeClass('btn-default')
                        .addClass('btn-primary btn-success')
                        .prop('disabled', false)
                        .attr('title', '前置步骤全部完成，点击执行最终核定封账');
                } else {
                    $('#btn-qifu-header-lock')
                        .text('核定本月数据')
                        .removeClass('btn-success')
                        .addClass('btn-primary')
                        .prop('disabled', true)
                        .attr('title', '需先完成所有前置页签的确认 (全部标绿)');
                }

                // 1. 顶部封账状态 Badge 与 Card 5
                if (wf.is_locked) {
                    $("#workflow-lock-status-badge").html(
                        `<span> 已核定封账 (纯只读保护)</span>`
                    );
                    $("#btn-wf-lock-action").text(" 已封账 (点击反审核解锁)").removeClass("btn-primary").addClass("btn-default").css({"background":"#f8fafc","color":"#475569","border-color":"#cbd5e1"});
                    $("#wf-step5-icon").text("");
                    $("#wf-step5-main").text("月度账期已封账锁定");
                    $("#wf-step5-sub").text("明细纯只读保护 · 下月已开启").css("color", "#b45309");
                    $("#wf-step5-lock-badge").text("已锁定").css({"color":"#b45309","background":"#fef3c7","border-color":"#fde68a"});
                    $("#wf-step-5").css({"background":"#fefce8","border-color":"#fef08a"});
                } else {
                    $("#workflow-lock-status-badge").html(
                        `<span> 草稿状态 (待核定)</span>`
                    );
                    const gross_val = wf.task5_settlement ? Number(wf.task5_settlement.total_gross || 0).toLocaleString('zh-CN', {minimumFractionDigits:2}) : '0.00';
                    const net_val = wf.task5_settlement ? Number(wf.task5_settlement.total_net || 0).toLocaleString('zh-CN', {minimumFractionDigits:2}) : '0.00';
                    const cost_val = wf.task5_settlement ? Number(wf.task5_settlement.total_company_cost || 0).toLocaleString('zh-CN', {minimumFractionDigits:2}) : '0.00';

                    if (wf.can_lock) {
                        $("#btn-wf-lock-action").text(" 立即执行最终核定").addClass("btn-primary").removeClass("btn-default").css({"background":"#059669","color":"#fff","border-color":"#059669"});
                        $("#wf-step5-icon").text("");
                        $("#wf-step5-main").text(`税前: ¥${gross_val} ｜ 实发: ¥${net_val}`);
                        $("#wf-step5-sub").text(`企业总用工成本: ¥${cost_val}`).css("color", "#15803d");
                        $("#wf-step5-lock-badge").text("可核定").css({"color":"#059669","background":"#dcfce7","border-color":"#bbf7d0"});
                        $("#wf-step-5").css({"background":"#f0fdf4","border-color":"#bbf7d0"});
                    } else {
                        const calc = wf.calculation || {};
                        const calcNotReady = calc.ready === false;
                        const has_proof_mismatch = wf.task3_ss.status === 'mismatch' || wf.task4_hf.status === 'mismatch';
                        if (calcNotReady) {
                            const calcPending = Number(calc.pending || 0) + Number(calc.queued || 0) + Number(calc.running || 0);
                            const calcFailed = Number(calc.failed || 0) + Number(calc.uncomputed || 0);
                            $("#btn-wf-lock-action").text(calcFailed > 0 ? " 计算未完成 · 禁止封账" : " 服务器计算中 · 暂不可封账")
                                .addClass("btn-default").removeClass("btn-primary")
                                .css({"background":calcFailed > 0 ? "#fee2e2" : "#eff6ff","color":calcFailed > 0 ? "#b91c1c" : "#1d4ed8","border-color":calcFailed > 0 ? "#ef4444" : "#bfdbfe","font-weight":"800"});
                            $("#wf-step5-icon").text(calcFailed > 0 ? "" : "");
                            $("#wf-step5-main").text(calcFailed > 0 ? "服务器计算存在失败/未计算记录" : "服务器正在异步重算薪酬与累计个税");
                            $("#wf-step5-sub").text(`待处理 ${calcPending} ｜ 失败/未计算 ${calcFailed} ｜ 活动任务 ${Number(calc.active_tasks || 0)}`).css("color", calcFailed > 0 ? "#b91c1c" : "#1d4ed8");
                            $("#wf-step5-lock-badge").text("计算未就绪").css({"color":calcFailed > 0 ? "#b91c1c" : "#1d4ed8","background":calcFailed > 0 ? "#fee2e2" : "#eff6ff","border-color":calcFailed > 0 ? "#fecaca" : "#bfdbfe"});
                            $("#wf-step-5").css({"background":calcFailed > 0 ? "#fff1f2" : "#eff6ff","border-color":calcFailed > 0 ? "#ef4444" : "#bfdbfe"});
                        } else if (has_proof_mismatch) {
                            $("#btn-wf-lock-action").text(" 凭证金额不一致 · 禁止封账").addClass("btn-default").removeClass("btn-primary").css({"background":"#fee2e2","color":"#b91c1c","border-color":"#ef4444","font-weight":"800"});
                            $("#wf-step5-icon").text("");
                            $("#wf-step5-main").text("社保/公积金凭证日期或金额未通过");
                            $("#wf-step5-sub").text("所属期与金额必须全部一致后才允许最终核定封账").css("color", "#b91c1c");
                            $("#wf-step5-lock-badge").text("禁止核定").css({"color":"#b91c1c","background":"#fee2e2","border-color":"#fecaca"});
                            $("#wf-step-5").css({"background":"#fff1f2","border-color":"#ef4444"});
                        } else {
                            $("#btn-wf-lock-action").text(" 执行最终核定封账").addClass("btn-default").removeClass("btn-primary").css({"background":"#f8fafc","color":"#64748b","border-color":"#cbd5e1"});
                            $("#wf-step5-icon").text("");
                            $("#wf-step5-main").text(`税前: ¥${gross_val} ｜ 实发: ¥${net_val}`);
                            $("#wf-step5-sub").text("待前置实发与凭证全部核验").css("color", "#64748b");
                            $("#wf-step5-lock-badge").text("待核定").css({"color":"#64748b","background":"#f1f5f9","border-color":"#e2e8f0"});
                            $("#wf-step-5").css({"background":"#ffffff","border-color":"#e2e8f0"});
                        }
                    }
                }

                // 2. Step 1: 档案母表与计薪来源分类 (系统计薪 vs 外部计薪)
                update_qifu_header_lock_button(Boolean(wf.is_locked));
                update_employees_confirmation_button(wf);
                update_salary_main_confirmation_button(wf);
                update_social_insurance_release_button(wf);
                update_housing_fund_release_button(wf);
                update_auto_confirmed_indicators(wf);
                const is_p_confirmed = Boolean(wf.task1_profile && wf.task1_profile.is_confirmed);
                if (wf.task1_profile.status === 'done') {
                    $("#wf-step1-icon").text("");
                    const confTag = is_p_confirmed ? '<span class="qifu-docstatus-pill qifu-docstatus-locked" >已核定</span>' : '<span class="qifu-docstatus-pill qifu-docstatus-draft" >待核定</span>';
                    $("#wf-step1-main").html(`在册 ${wf.task1_profile.active_count} 人 · ${wf.task1_profile.change_text || '人员及配置无异动'} ${confTag}`);
                    $("#wf-step1-sub").text(wf.task1_profile.sub_badge || `系统计薪 ${Number(wf.task1_profile.sys_calc_count || 0)}人 ｜ 外部计薪 ${Number(wf.task1_profile.ext_calc_count || 0)}人`);
                    $("#wf-step-1").css({"background": is_p_confirmed ? "#f0fdf4" : "#ffffff", "border-color": is_p_confirmed ? "#bbf7d0" : "#e2e8f0"});
                } else {
                    $("#wf-step1-icon").text("");
                    $("#wf-step1-main").text("在册人员档案为空");
                    $("#wf-step1-sub").text("请先在档案库录入员工信息");
                    $("#wf-step-1").css({"background":"#ffffff","border-color":"#e2e8f0"});
                }

                // 3. Step 2: 外部实发导入（人数完全按当月数据动态计算）
                const is_task2_done = (wf.task2_import.status === 'done' || !!wf.task2_import.file_url);
                if (is_task2_done) {
                    $("#wf-step2-icon").text("");
                    $("#wf-step2-main").text(`已导入 ${wf.task2_import.employee_count} 人 · ¥ ${Number(wf.task2_import.total_net).toLocaleString('zh-CN', {minimumFractionDigits:2})}`);
                    $("#wf-step2-sub").text(wf.task2_import.sub_badge || `车间实发 ${wf.task2_import.employee_count}人 ｜ 非车间(母表) ${wf.task2_import.non_workshop_count || 0}人`);
                    $("#wf-step-2").css({"background":"#f0fdf4","border-color":"#bbf7d0"});
                    $("#btn-wf-upload-salary").html(" 删除已上传实发表")
                        .attr("data-state", "uploaded")
                        .css({"background":"#fef2f2", "color":"#dc2626", "border-color":"#fecaca", "font-weight":"700"});
                } else {
                    $("#wf-step2-icon").text("");
                    $("#wf-step2-main").text("待上传车间实发表");
                    $("#wf-step2-sub").text(`外部计薪 ${Number(wf.task1_profile.ext_calc_count || 0)}人 · 待导入实发表`);
                    $("#wf-step-2").css({"background":"#ffffff","border-color":"#e2e8f0"});
                    $("#btn-wf-upload-salary").html(" 上传车间实发表")
                        .attr("data-state", "empty")
                        .css({"background":"#eff6ff", "color":"#1d4ed8", "border-color":"#bfdbfe", "font-weight":"700"});
                }
                if (wf.task2_import.file_url) {
                    $("#wf-step2-file-badge").show().attr("data-url", wf.task2_import.file_url);
                } else {
                    $("#wf-step2-file-badge").hide().removeAttr("data-url");
                }

                // 4. Step 3: 社保申报表核验 (显示参保人数与公司/个人拆分)
                const ss_insured_cnt = Number(wf.task3_ss.insured_count || 0);
                const ss_comp_str = Number(wf.task3_ss.company_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2});
                const ss_pers_str = Number(wf.task3_ss.person_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2});
                const ss_tot_str = Number(wf.task3_ss.parsed_amount || wf.task3_ss.sys_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2});
                const is_task3_uploaded = (wf.task3_ss.status === 'verified' || !!wf.task3_ss.file_url);

                if (wf.task3_ss.status === 'verified') {
                    $("#wf-step3-icon").text("");
                    $("#wf-step3-main").text(`${ss_insured_cnt} 人参保 · ${wf.task3_ss.file_count || 1}份凭证合计 ¥ ${ss_tot_str}`);
                    $("#wf-step3-sub").text(`所属期 ${wf.task3_ss.expected_period || '—'} 已通过 ｜ 公司 ¥${ss_comp_str} ｜ 个人 ¥${ss_pers_str}`).css("color", "#15803d");
                    $("#wf-step-3").css({"background":"#f0fdf4","border-color":"#bbf7d0"});
                } else if (wf.task3_ss.status === 'mismatch') {
                    const ss_diff_str = Number(wf.task3_ss.difference_amount != null ? wf.task3_ss.difference_amount : Math.abs(wf.task3_ss.parsed_amount - wf.task3_ss.sys_amount)).toLocaleString('zh-CN', {minimumFractionDigits:2});
                    $("#wf-step3-icon").text("");
                    if (wf.task3_ss.period_valid === false && wf.task3_ss.file_url) {
                        $("#wf-step3-main").text(`社保凭证所属期错误 · 应为 ${wf.task3_ss.expected_period || '—'}`);
                        $("#wf-step3-sub").text(`检测到 ${(wf.task3_ss.detected_periods || []).join('、') || '无法识别'} ｜ 禁止最终核定封账`).css("color", "#b91c1c");
                    } else {
                        $("#wf-step3-main").text(`${ss_insured_cnt} 人参保 · 日期通过但金额不符 · 差额 ¥${ss_diff_str}`);
                        $("#wf-step3-sub").text(`所属期 ${wf.task3_ss.expected_period || '—'} ｜ 凭证 ¥${ss_tot_str} ｜ 系统 ¥${Number(wf.task3_ss.sys_amount).toLocaleString('zh-CN', {minimumFractionDigits:2})}`).css("color", "#b91c1c");
                    }
                    $("#wf-step-3").css({"background":"#fff1f2","border-color":"#ef4444","box-shadow":"0 0 0 1px rgba(239,68,68,0.08)"});
                } else {
                    $("#wf-step3-icon").text("");
                    $("#wf-step3-main").text(`${ss_insured_cnt} 人参保 · 待上传申报表 (应缴 ¥${Number(wf.task3_ss.sys_amount).toLocaleString('zh-CN', {minimumFractionDigits:2})})`);
                    $("#wf-step3-sub").text(`公司 ¥${ss_comp_str} ｜ 个人 ¥${ss_pers_str}`);
                    $("#wf-step-3").css({"background":"#ffffff","border-color":"#e2e8f0"});
                }

                if (is_task3_uploaded) {
                    $("#btn-wf-upload-ss").html(" 删除已上传社保凭证")
                        .attr("data-state", "uploaded")
                        .css({"background":"#fef2f2", "color":"#dc2626", "border-color":"#fecaca", "font-weight":"700"});
                } else {
                    $("#btn-wf-upload-ss").html(" 上传社保凭证")
                        .attr("data-state", "empty")
                        .css({"background":"#eff6ff", "color":"#1d4ed8", "border-color":"#bfdbfe", "font-weight":"700"});
                }

                if (wf.task3_ss.file_url) {
                    $("#wf-step3-file-badge").show().attr("data-url", wf.task3_ss.file_url);
                } else {
                    $("#wf-step3-file-badge").hide().removeAttr("data-url");
                }

                // 5. Step 4: 公积金凭证核验 (显示参缴人数与公司/个人拆分)
                const hf_insured_cnt = wf.task4_hf.insured_count || 19;
                const hf_comp_str = Number(wf.task4_hf.company_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2});
                const hf_pers_str = Number(wf.task4_hf.person_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2});
                const hf_tot_str = Number(wf.task4_hf.parsed_amount || wf.task4_hf.sys_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2});
                const is_task4_uploaded = (wf.task4_hf.status === 'verified' || !!wf.task4_hf.file_url);

                if (wf.task4_hf.status === 'verified') {
                    $("#wf-step4-icon").text("");
                    $("#wf-step4-main").text(`${hf_insured_cnt} 人参缴 · ${wf.task4_hf.file_count || 1}份凭证合计 ¥ ${hf_tot_str}`);
                    $("#wf-step4-sub").text(`所属期 ${wf.task4_hf.expected_period || '—'} 已通过 ｜ 公司 ¥${hf_comp_str} ｜ 个人 ¥${hf_pers_str}`).css("color", "#15803d");
                    $("#wf-step-4").css({"background":"#f0fdf4","border-color":"#bbf7d0"});
                } else if (wf.task4_hf.status === 'mismatch') {
                    const hf_diff_str = Number(wf.task4_hf.difference_amount != null ? wf.task4_hf.difference_amount : Math.abs(wf.task4_hf.parsed_amount - wf.task4_hf.sys_amount)).toLocaleString('zh-CN', {minimumFractionDigits:2});
                    $("#wf-step4-icon").text("");
                    if (wf.task4_hf.period_valid === false && wf.task4_hf.file_url) {
                        $("#wf-step4-main").text(`公积金凭证所属期错误 · 应为 ${wf.task4_hf.expected_period || '—'}`);
                        $("#wf-step4-sub").text(`检测到 ${(wf.task4_hf.detected_periods || []).join('、') || '无法识别'} ｜ 禁止最终核定封账`).css("color", "#b91c1c");
                    } else {
                        $("#wf-step4-main").text(`${hf_insured_cnt} 人参缴 · 日期通过但金额不符 · 差额 ¥${hf_diff_str}`);
                        $("#wf-step4-sub").text(`所属期 ${wf.task4_hf.expected_period || '—'} ｜ 凭证 ¥${hf_tot_str} ｜ 系统 ¥${Number(wf.task4_hf.sys_amount).toLocaleString('zh-CN', {minimumFractionDigits:2})}`).css("color", "#b91c1c");
                    }
                    $("#wf-step-4").css({"background":"#fff1f2","border-color":"#ef4444","box-shadow":"0 0 0 1px rgba(239,68,68,0.08)"});
                } else {
                    $("#wf-step4-icon").text("");
                    $("#wf-step4-main").text(`${hf_insured_cnt} 人参缴 · 待上传凭证 (应缴 ¥${Number(wf.task4_hf.sys_amount).toLocaleString('zh-CN', {minimumFractionDigits:2})})`);
                    $("#wf-step4-sub").text(`公司 ¥${hf_comp_str} ｜ 个人 ¥${hf_pers_str}`);
                    $("#wf-step-4").css({"background":"#ffffff","border-color":"#e2e8f0"});
                }

                if (is_task4_uploaded) {
                    $("#btn-wf-upload-hf").html(" 删除已上传公积金凭证")
                        .attr("data-state", "uploaded")
                        .css({"background":"#fef2f2", "color":"#dc2626", "border-color":"#fecaca", "font-weight":"700"});
                } else {
                    $("#btn-wf-upload-hf").html(" 上传公积金凭证")
                        .attr("data-state", "empty")
                        .css({"background":"#eff6ff", "color":"#1d4ed8", "border-color":"#bfdbfe", "font-weight":"700"});
                }

                if (wf.task4_hf.file_url) {
                    $("#wf-step4-file-badge").show().attr("data-url", wf.task4_hf.file_url);
                } else {
                    $("#wf-step4-file-badge").hide().removeAttr("data-url");
                }

                // 更新 Tab 2 (车间外部实发表) 凭证状态
                const is_task2_up = wf.task2_import && (wf.task2_import.status === 'done' || !!wf.task2_import.file_url);
                if (is_task2_up) {
                    $("#btn-tab2-upload-salary").text("重新上传实发表").attr("data-state", "uploaded");
                    $("#tab2-salary-verify-badge").html(`<span class="qifu-status-badge qifu-state-ok">实发表已解析 (${wf.task2_import.employee_count || 0}人 ｜ ¥${Number(wf.task2_import.total_net || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})})</span>`);
                    if (wf.task2_import.file_url) {
                        $("#btn-tab2-view-salary").removeClass("hide").show().attr("data-url", wf.task2_import.file_url);
                        $("#btn-tab2-delete-salary").removeClass("hide").show();
                    }
                } else {
                    $("#btn-tab2-upload-salary").text("上传车间实发表 (Excel)").attr("data-state", "empty");
                    $("#tab2-salary-verify-badge").html(`<span class="qifu-status-badge qifu-state-warn">待上传车间实发表 (Excel)</span>`);
                    $("#btn-tab2-view-salary").addClass("hide").hide();
                    $("#btn-tab2-delete-salary").addClass("hide").hide();
                }

                // 更新 Tab 3 (社会保险) 申报表核验状态与看板
                const is_task3_up = wf.task3_ss && (wf.task3_ss.status === 'verified' || !!wf.task3_ss.file_url);
                if (wf.task3_ss && wf.task3_ss.status === 'verified') {
                    $("#btn-tab3-upload-ss").text("重新上传申报表").attr("data-state", "uploaded");
                    $("#tab3-proof-verify-badge").html(`<span class="qifu-status-badge qifu-state-ok">税局申报表核验一致 (凭证 ¥${Number(wf.task3_ss.parsed_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})} ＝ 系统 ¥${Number(wf.task3_ss.sys_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})})</span>`);
                    if (wf.task3_ss.file_url) {
                        $("#btn-tab3-view-ss-proof").removeClass("hide").show().attr("data-url", wf.task3_ss.file_url);
                        $("#btn-tab3-delete-ss-proof").removeClass("hide").show();
                    }
                } else if (wf.task3_ss && wf.task3_ss.status === 'mismatch') {
                    $("#btn-tab3-upload-ss").text("重新上传申报表").attr("data-state", "uploaded");
                    const diff = Number(wf.task3_ss.difference_amount != null ? wf.task3_ss.difference_amount : Math.abs(wf.task3_ss.parsed_amount - wf.task3_ss.sys_amount)).toLocaleString('zh-CN', {minimumFractionDigits:2});
                    if (wf.task3_ss.period_valid === false && wf.task3_ss.file_url) {
                        $("#tab3-proof-verify-badge").html(`<span class="qifu-status-badge qifu-state-error">所属期错误 (应为 ${wf.task3_ss.expected_period || '次月'})</span>`);
                    } else {
                        $("#tab3-proof-verify-badge").html(`<span class="qifu-status-badge qifu-state-error">金额不一致 (凭证 ¥${Number(wf.task3_ss.parsed_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})} vs 系统 ¥${Number(wf.task3_ss.sys_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})}，差额 ¥${diff})</span>`);
                    }
                    if (wf.task3_ss.file_url) {
                        $("#btn-tab3-view-ss-proof").removeClass("hide").show().attr("data-url", wf.task3_ss.file_url);
                        $("#btn-tab3-delete-ss-proof").removeClass("hide").show();
                    }
                } else {
                    $("#btn-tab3-upload-ss").text("上传税局社保申报表 (.pdf/.zip)").attr("data-state", "empty");
                    $("#tab3-proof-verify-badge").html(`<span class="qifu-status-badge qifu-state-warn">待上传所属期 (${wf.task3_ss?.expected_period || '次月'}) 的税局申报表 (系统应缴 ¥${Number(wf.task3_ss?.sys_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})})</span>`);
                    $("#btn-tab3-view-ss-proof").addClass("hide").hide();
                    $("#btn-tab3-delete-ss-proof").addClass("hide").hide();
                }

                // 渲染 Tab 3 专属智能比对与核验看板
                if (wf.task3_ss && is_task3_up) {
                    const is_ss_match = wf.task3_ss.status === 'verified';
                    const ss_diff = Number(wf.task3_ss.difference_amount != null ? wf.task3_ss.difference_amount : Math.abs(wf.task3_ss.parsed_amount - wf.task3_ss.sys_amount));
                    const ss_expected = wf.task3_ss.expected_period || '次月';
                    const ss_actual = (wf.task3_ss.detected_periods && wf.task3_ss.detected_periods.length) ? wf.task3_ss.detected_periods.join('、') : (wf.task3_ss.period_valid ? ss_expected : '未提取');
                    
                    let ss_diff_summary = "";
                    if (is_ss_match) {
                        const ss_p_cnt = Number(wf.task3_ss.parsed_emp_count || 0);
                    const ss_s_cnt = Number(wf.task3_ss.insured_count || 0);
                        const ss_cnt_str = ss_p_cnt > 0 ? ('，参保人数一致 ' + ss_s_cnt + '人') : '';
                        ss_diff_summary = '无差异（税款所属期与系统应缴总盘 100% 完全对齐' + ss_cnt_str + '，差额 ¥ 0.00）';
                    } else {
                        const reasons = [];
                        if (!wf.task3_ss.period_valid) {
                            reasons.push(`所属期不符：系统预计【${ss_expected}】，凭证实际为【${ss_actual}】`);
                        }
                        if (ss_diff >= 0.01) {
                            reasons.push(`缴纳金额存在差额 ¥ ${fmtMoney(ss_diff)}（预计 ¥ ${fmtMoney(wf.task3_ss.sys_amount)} vs 实际 ¥ ${fmtMoney(wf.task3_ss.parsed_amount)}）`);
                        }
                        if (wf.task3_ss.validation_errors && wf.task3_ss.validation_errors.length) {
                            reasons.push(wf.task3_ss.validation_errors.join('；'));
                        }
                        ss_diff_summary = reasons.join("；") || `差额 ¥ ${fmtMoney(ss_diff)}，请核对人员参缴明细或缴费基数`;
                    }

                    $("#tab3-proof-compare-panel").html(`
                        <div class="qifu-proof-compare-box ${is_ss_match ? 'qifu-compare-ok' : 'qifu-compare-mismatch'}">
                            <div class="qifu-compare-header">
                                <div class="qifu-compare-title">
                                    <span class="qifu-status-badge ${is_ss_match ? 'qifu-state-ok' : 'qifu-state-error'}">
                                        结论：${is_ss_match ? '通过' : '不通过'}
                                    </span>
                                    <span class="qifu-compare-sub">
                                        实际缴费所属期: <strong>${ss_expected}</strong> (符合次月申报规则) ｜ 核定账期: <strong>${current_month}</strong>
                                    </span>
                                </div>
                                <div class="qifu-compare-actions">
                                    ${wf.task3_ss.file_url ? `<button type="button" class="btn btn-default btn-xs btn-wf-download-file" data-url="${wf.task3_ss.file_url}">查看税局申报原件</button>` : ''}
                                    <button type="button" class="btn btn-primary btn-xs btn-reupload-ss">重新上传申报表</button>
                                    ${wf.task3_ss.file_url ? `<button type="button" class="btn btn-default btn-xs" id="btn-tab3-panel-delete" class="qifu-btn-delete-text">删除申报表</button>` : ''}
                                </div>
                            </div>
                            <div class="qifu-compare-grid">
                                <div class="qifu-compare-item">
                                    <div class="qifu-compare-item-label">所属期预计</div>
                                    <div class="qifu-compare-item-val font-semibold">${ss_expected}</div>
                                    <div class="qifu-compare-item-sub">次月申报规则</div>
                                </div>
                                <div class="qifu-compare-item">
                                    <div class="qifu-compare-item-label">所属期实际</div>
                                    <div class="qifu-compare-item-val font-semibold ${ss_actual === ss_expected ? 'qifu-val-green' : 'qifu-val-red'}">${ss_actual}</div>
                                    <div class="qifu-compare-item-sub">税局凭证识别</div>
                                </div>
                                <div class="qifu-compare-item">
                                    <div class="qifu-compare-item-label">缴纳金额预计</div>
                                    <div class="qifu-compare-item-val qifu-val-green font-bold">¥ ${Number(wf.task3_ss.sys_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})}</div>
                                    <div class="qifu-compare-item-sub">系统参保: ${wf.task3_ss.insured_count || 0}人 ｜ 单位: ¥ ${Number(wf.task3_ss.company_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})} ｜ 个人: ¥ ${Number(wf.task3_ss.person_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})}</div>
                                </div>
                                <div class="qifu-compare-item">
                                    <div class="qifu-compare-item-label">缴纳金额实际</div>
                                    <div class="qifu-compare-item-val qifu-val-blue font-bold">¥ ${Number(wf.task3_ss.parsed_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})}</div>
                                    <div class="qifu-compare-item-sub">实缴: ${wf.task3_ss.parsed_emp_count || wf.task3_ss.insured_count || 0}人 ｜ 税局申报表 (PDF提取)</div>
                                </div>
                            </div>
                            <div class="qifu-compare-diff-banner ${is_ss_match ? 'qifu-diff-pass' : 'qifu-diff-error'}">
                                <div class="qifu-diff-line">
                                    <span class="qifu-diff-label">差异点：</span>
                                    <span class="qifu-diff-content font-semibold">${ss_diff_summary}</span>
                                </div>
                                <div class="qifu-conclusion-line">
                                    <span class="qifu-diff-label">结论：</span>
                                    <strong class="qifu-conclusion-pill ${is_ss_match ? 'is-pass' : 'is-fail'}">${is_ss_match ? '通过' : '不通过'}</strong>
                                    <span class="qifu-conclusion-tip">${is_ss_match ? '税局申报表已规范归档，准予执行月度薪酬最终核定与封账。' : '请核对基数或重新上传'}</span>
                                </div>
                            </div>
                        </div>
                    `);
                } else {
                    $("#tab3-proof-compare-panel").html(`
                        <div class="qifu-proof-compare-box qifu-compare-empty">
                            <div class="qifu-compare-header">
                                <div class="qifu-compare-title">
                                    <span class="qifu-status-badge qifu-state-warn">待上传税局申报表</span>
                                    <span class="qifu-compare-sub">
                                        所属期必须为: <strong>${wf.task3_ss?.expected_period || '次月'}</strong> ｜ 系统应缴总额: <strong>¥ ${Number(wf.task3_ss?.sys_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})}</strong> ｜ 支持上传税务局缴费申报表 (.pdf/.zip)
                                    </span>
                                </div>
                                <div class="qifu-compare-actions">
                                    <button type="button" class="btn btn-primary btn-xs btn-reupload-ss">上传税局社保申报表 (.pdf/.zip)</button>
                                </div>
                            </div>
                        </div>
                    `);
                }

                // 更新 Tab 4 (住房公积金) 缴存凭证核验状态与看板
                const is_task4_up = wf.task4_hf && (wf.task4_hf.status === 'verified' || !!wf.task4_hf.file_url);
                if (wf.task4_hf && wf.task4_hf.status === 'verified') {
                    $("#btn-tab4-upload-hf").text("重新上传凭证").attr("data-state", "uploaded");
                    $("#tab4-proof-verify-badge").html(`<span class="qifu-status-badge qifu-state-ok">公积金凭证核验一致 (凭证 ¥${Number(wf.task4_hf.parsed_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})} ＝ 系统 ¥${Number(wf.task4_hf.sys_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})})</span>`);
                    if (wf.task4_hf.file_url) {
                        $("#btn-tab4-view-hf-proof").removeClass("hide").show().attr("data-url", wf.task4_hf.file_url);
                        $("#btn-tab4-delete-hf-proof").removeClass("hide").show();
                    }
                } else if (wf.task4_hf && wf.task4_hf.status === 'mismatch') {
                    $("#btn-tab4-upload-hf").text("重新上传凭证").attr("data-state", "uploaded");
                    const diff = Number(wf.task4_hf.difference_amount != null ? wf.task4_hf.difference_amount : Math.abs(wf.task4_hf.parsed_amount - wf.task4_hf.sys_amount)).toLocaleString('zh-CN', {minimumFractionDigits:2});
                    if (wf.task4_hf.period_valid === false && wf.task4_hf.file_url) {
                        $("#tab4-proof-verify-badge").html(`<span class="qifu-status-badge qifu-state-error">所属期错误 (应为 ${wf.task4_hf.expected_period || '次月'})</span>`);
                    } else {
                        $("#tab4-proof-verify-badge").html(`<span class="qifu-status-badge qifu-state-error">金额不一致 (凭证 ¥${Number(wf.task4_hf.parsed_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})} vs 系统 ¥${Number(wf.task4_hf.sys_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})}，差额 ¥${diff})</span>`);
                    }
                    if (wf.task4_hf.file_url) {
                        $("#btn-tab4-view-hf-proof").removeClass("hide").show().attr("data-url", wf.task4_hf.file_url);
                        $("#btn-tab4-delete-hf-proof").removeClass("hide").show();
                    }
                } else {
                    $("#btn-tab4-upload-hf").text("上传公积金缴存凭证 (.pdf/.zip)").attr("data-state", "empty");
                    $("#tab4-proof-verify-badge").html(`<span class="qifu-status-badge qifu-state-warn">待上传缴存年月 (${wf.task4_hf?.expected_period || '次月'}) 的缴存凭证 (系统应缴 ¥${Number(wf.task4_hf?.sys_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})})</span>`);
                    $("#btn-tab4-view-hf-proof").addClass("hide").hide();
                    $("#btn-tab4-delete-hf-proof").addClass("hide").hide();
                }

                // 渲染 Tab 4 专属智能比对与核验看板
                if (wf.task4_hf && is_task4_up) {
                    const is_hf_match = wf.task4_hf.status === 'verified';
                    const hf_diff = Number(wf.task4_hf.difference_amount != null ? wf.task4_hf.difference_amount : Math.abs(wf.task4_hf.parsed_amount - wf.task4_hf.sys_amount));
                    const hf_expected = wf.task4_hf.expected_period || '次月';
                    const hf_actual = (wf.task4_hf.detected_periods && wf.task4_hf.detected_periods.length) ? wf.task4_hf.detected_periods.join('、') : (wf.task4_hf.period_valid ? hf_expected : '未提取');
                    
                    let hf_diff_summary = "";
                    if (is_hf_match) {
                        const hf_p_cnt = Number(wf.task4_hf.parsed_emp_count || 0);
                    const hf_s_cnt = Number(wf.task4_hf.insured_count || 0);
                        const hf_cnt_str = hf_p_cnt > 0 ? ('，参缴人数一致 ' + hf_s_cnt + '人') : '';
                        hf_diff_summary = '无差异（缴存年月与系统公积金应缴总盘 100% 完全对齐' + hf_cnt_str + '，差额 ¥ 0.00）';
                    } else {
                        const reasons = [];
                        if (!wf.task4_hf.period_valid) {
                            reasons.push(`所属期不符：系统预计【${hf_expected}】，凭证实际为【${hf_actual}】`);
                        }
                        if (hf_diff >= 0.01) {
                            reasons.push(`缴纳金额存在差额 ¥ ${fmtMoney(hf_diff)}（预计 ¥ ${fmtMoney(wf.task4_hf.sys_amount)} vs 实际 ¥ ${fmtMoney(wf.task4_hf.parsed_amount)}）`);
                        }
                        if (wf.task4_hf.validation_errors && wf.task4_hf.validation_errors.length) {
                            reasons.push(wf.task4_hf.validation_errors.join('；'));
                        }
                        hf_diff_summary = reasons.join("；") || `差额 ¥ ${fmtMoney(hf_diff)}，请核对参缴人员或缴存基数`;
                    }

                    $("#tab4-proof-compare-panel").html(`
                        <div class="qifu-proof-compare-box ${is_hf_match ? 'qifu-compare-ok' : 'qifu-compare-mismatch'}">
                            <div class="qifu-compare-header">
                                <div class="qifu-compare-title">
                                    <span class="qifu-status-badge ${is_hf_match ? 'qifu-state-ok' : 'qifu-state-error'}">
                                        结论：${is_hf_match ? '通过' : '不通过'}
                                    </span>
                                    <span class="qifu-compare-sub">
                                        实际缴存年月: <strong>${hf_expected}</strong> (符合次月申报规则) ｜ 核定账期: <strong>${current_month}</strong>
                                    </span>
                                </div>
                                <div class="qifu-compare-actions">
                                    ${wf.task4_hf.file_url ? `<button type="button" class="btn btn-default btn-xs btn-wf-download-file" data-url="${wf.task4_hf.file_url}">查看公积金原件</button>` : ''}
                                    <button type="button" class="btn btn-primary btn-xs btn-reupload-hf">重新上传凭证</button>
                                    ${wf.task4_hf.file_url ? `<button type="button" class="btn btn-default btn-xs" id="btn-tab4-panel-delete" class="qifu-btn-delete-text">删除凭证</button>` : ''}
                                </div>
                            </div>
                            <div class="qifu-compare-grid">
                                <div class="qifu-compare-item">
                                    <div class="qifu-compare-item-label">所属期预计</div>
                                    <div class="qifu-compare-item-val font-semibold">${hf_expected}</div>
                                    <div class="qifu-compare-item-sub">次月申报规则</div>
                                </div>
                                <div class="qifu-compare-item">
                                    <div class="qifu-compare-item-label">所属期实际</div>
                                    <div class="qifu-compare-item-val font-semibold ${hf_actual === hf_expected ? 'qifu-val-green' : 'qifu-val-red'}">${hf_actual}</div>
                                    <div class="qifu-compare-item-sub">公积金凭证识别</div>
                                </div>
                                <div class="qifu-compare-item">
                                    <div class="qifu-compare-item-label">缴纳金额预计</div>
                                    <div class="qifu-compare-item-val qifu-val-green font-bold">¥ ${Number(wf.task4_hf.sys_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})}</div>
                                    <div class="qifu-compare-item-sub">系统参缴: ${wf.task4_hf.insured_count || 0}人 ｜ 公司: ¥ ${Number(wf.task4_hf.company_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})} ｜ 个人: ¥ ${Number(wf.task4_hf.person_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})}</div>
                                </div>
                                <div class="qifu-compare-item">
                                    <div class="qifu-compare-item-label">缴纳金额实际</div>
                                    <div class="qifu-compare-item-val qifu-val-blue font-bold">¥ ${Number(wf.task4_hf.parsed_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})}</div>
                                    <div class="qifu-compare-item-sub">实缴: ${wf.task4_hf.parsed_emp_count || wf.task4_hf.insured_count || 0}人 ｜ 公积金受理凭证提取</div>
                                </div>
                            </div>
                            <div class="qifu-compare-diff-banner ${is_hf_match ? 'qifu-diff-pass' : 'qifu-diff-error'}">
                                <div class="qifu-diff-line">
                                    <span class="qifu-diff-label">差异点：</span>
                                    <span class="qifu-diff-content font-semibold">${hf_diff_summary}</span>
                                </div>
                                <div class="qifu-conclusion-line">
                                    <span class="qifu-diff-label">结论：</span>
                                    <strong class="qifu-conclusion-pill ${is_hf_match ? 'is-pass' : 'is-fail'}">${is_hf_match ? '通过' : '不通过'}</strong>
                                    <span class="qifu-conclusion-tip">${is_hf_match ? '原始受理凭证已规范归档，准予执行月度薪酬最终核定与封账。' : '请核对参缴人员或重新上传'}</span>
                                </div>
                            </div>
                        </div>
                    `);
                } else {
                    $("#tab4-proof-compare-panel").html(`
                        <div class="qifu-proof-compare-box qifu-compare-empty">
                            <div class="qifu-compare-header">
                                <div class="qifu-compare-title">
                                    <span class="qifu-status-badge qifu-state-warn">待上传公积金凭证</span>
                                    <span class="qifu-compare-sub">
                                        缴存年月必须为: <strong>${wf.task4_hf?.expected_period || '次月'}</strong> ｜ 系统应缴总额: <strong>¥ ${Number(wf.task4_hf?.sys_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})}</strong> ｜ 支持上传 ZIP 压缩包或 PDF 凭证
                                    </span>
                                </div>
                                <div class="qifu-compare-actions">
                                    <button type="button" class="btn btn-primary btn-xs btn-reupload-hf">上传公积金缴存凭证 (.pdf/.zip)</button>
                                </div>
                            </div>
                        </div>
                    `);
                }

                adjust_active_table_height();
            },
            error: function() {
                _loading_monthly_workflow = false;
            }
        });
    }

    // 上传车间外部实发工资表：直接唤起本地文档选择器 (零中间弹窗)
    function open_upload_workshop_salary_dialog() {
        trigger_salary_upload();
    }


    // ==========================================
    // 弹窗：上传社保申报表 PDF / ZIP
    // ==========================================
    function open_upload_social_security_dialog() {
        const cur_m = $("#qifu-month-select").val() || current_month;
        const d = new frappe.ui.Dialog({
            title: ` 上传【${cur_m}】社会保险费缴费申报表 (PDF / ZIP)`,
            fields: [
                {
                    fieldtype: 'HTML',
                    fieldname: 'ss_help',
                    options: `
                        <div class="ashan-callout ashan-callout--dialog ashan-mb-3">
                            <strong> 智能核验说明：</strong><br>
                            • 支持直接上传税务局/社保局下载的 <strong>.pdf</strong> 缴费申报表，或包含 PDF 的 <strong>.zip</strong> 压缩包；<br>
                            • 系统将自动解析 PDF 内纳税人识别号、所属期与缴费总额，并与系统核算总额实时比对；<br>
                            • 上传成功后将自动规范命名归档，并可随时点击【 凭证】下载原件。
                        </div>
                    `
                },
                {
                    fieldtype: 'Attach',
                    fieldname: 'ss_file',
                    label: '选择社保申报表 PDF 或 ZIP 文件',
                    reqd: 1
                }
            ],
            primary_action_label: ' 提交并智能解析核验',
            primary_action: function(vals) {
                if (!vals || !vals.ss_file) {
                    frappe.msgprint("请先选择社保 PDF 或 ZIP 文件！");
                    return;
                }
                const file_url = vals.ss_file;
                frappe.show_alert({ message: ' 正在智能解析社保凭证并比对金额...', indicator: 'blue' });

                frappe.call({
                    method: 'ashan_cn_procurement.services.payroll_settlement_service.upload_and_verify_social_security_file',
                    type: 'POST',
                    args: {
                        company: COMPANY,
                        period_month: cur_m,
                        file_url: file_url
                    },
                    callback: function(r) {
                        if (r.message && r.message.success) {
                            d.hide();
                            frappe.msgprint({
                                title: ' 社保凭证解析完成',
                                indicator: r.message.is_matched ? 'green' : 'orange',
                                message: `
                                    <div style="font-size:13px; line-height:1.6;">
                                        ${r.message.message}<br><br>
                                        <strong>PDF 提取总额：</strong> ¥ ${Number(r.message.parsed_amount).toLocaleString('zh-CN', {minimumFractionDigits:2})}<br>
                                        <strong>系统核算总额：</strong> ¥ ${Number(r.message.sys_amount).toLocaleString('zh-CN', {minimumFractionDigits:2})}<br>
                                        <strong>归档文件路径：</strong> <a href="${r.message.file_url}" target="_blank"> 在线查看 / 下载 PDF 原件</a>
                                    </div>
                                `
                            });
                            load_monthly_workflow_hub();
                        }
                    }
                });
            }
        });
        d.show();
    }

    // ==========================================
    // 弹窗：上传公积金缴存凭证 ZIP / PDF
    // ==========================================
    function open_upload_housing_fund_dialog() {
        const cur_m = $("#qifu-month-select").val() || current_month;
        const d = new frappe.ui.Dialog({
            title: ` 上传【${cur_m}】住房公积金缴存凭证 (ZIP / PDF)`,
            fields: [
                {
                    fieldtype: 'HTML',
                    fieldname: 'hf_help',
                    options: `
                        <div class="ashan-callout ashan-callout--dialog ashan-mb-3">
                            <strong> 智能解压与核验说明：</strong><br>
                            • 支持上传公积金中心下载的 <strong>.zip 压缩包</strong> 或 <strong>.pdf 受理凭证</strong>；<br>
                            • 若为 ZIP 压缩包，系统将在后台<strong>自动解压并仅保留内部 PDF 凭证</strong>，自动清除冗余文件；<br>
                            • 自动识别缴存年月、人数与缴存总额，并与系统公积金核算总盘实时比对；<br>
                            • 下载时始终保证为您提供解压后的清晰原件 PDF。
                        </div>
                    `
                },
                {
                    fieldtype: 'Attach',
                    fieldname: 'hf_file',
                    label: '选择公积金 ZIP 压缩包或 PDF 凭证',
                    reqd: 1
                }
            ],
            primary_action_label: ' 提交后台解压与智能核验',
            primary_action: function(vals) {
                if (!vals || !vals.hf_file) {
                    frappe.msgprint("请先选择公积金 ZIP 或 PDF 文件！");
                    return;
                }
                const file_url = vals.hf_file;
                frappe.show_alert({ message: ' 正在后台解压公积金凭证并比对金额...', indicator: 'blue' });

                frappe.call({
                    method: 'ashan_cn_procurement.services.payroll_settlement_service.upload_and_verify_housing_fund_file',
                    type: 'POST',
                    args: {
                        company: COMPANY,
                        period_month: cur_m,
                        file_url: file_url
                    },
                    callback: function(r) {
                        if (r.message && r.message.success) {
                            d.hide();
                            frappe.msgprint({
                                title: ' 公积金凭证解析完成',
                                indicator: r.message.is_matched ? 'green' : 'orange',
                                message: `
                                    <div style="font-size:13px; line-height:1.6;">
                                        ${r.message.message}<br><br>
                                        <strong>PDF 提取总额：</strong> ¥ ${Number(r.message.parsed_amount).toLocaleString('zh-CN', {minimumFractionDigits:2})}<br>
                                        <strong>系统核算总额：</strong> ¥ ${Number(r.message.sys_amount).toLocaleString('zh-CN', {minimumFractionDigits:2})}<br>
                                        <strong>归档文件路径：</strong> <a href="${r.message.file_url}" target="_blank"> 在线查看 / 下载 PDF 原件</a>
                                    </div>
                                `
                            });
                            load_monthly_workflow_hub();
                        }
                    }
                });
            }
        });
        d.show();
    }


// ==========================================
    // 事件监听与委托：任务看板 5 步全流程与凭证操作
    // ==========================================
    $container.on("click", ".wf-goto-tab", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const tab = $(this).attr("data-tab");
        if (tab) $(`.qifu-tab-btn[data-tab='${tab}']`).trigger("click");
    });

    // 凭证文件删除与重置统一执行引擎
    function execute_delete_proof(proof_type, type_label) {
        const cur_m = $("#qifu-month-select").val() || current_month;
        frappe.call({
            method: 'ashan_cn_procurement.services.payroll_settlement_service.delete_payroll_proof_file',
            type: 'POST',
            args: {
                company: COMPANY,
                period_month: cur_m,
                proof_type: proof_type
            },
            freeze: true,
            freeze_message: `正在安全移除【${cur_m}】${type_label}...`,
            callback: function(r) {
                if (r.message && r.message.success) {
                    frappe.show_alert({
                        message: r.message.message,
                        indicator: 'green'
                    }, 4);
                    load_monthly_workflow_hub();
                    if (proof_type === 'salary') {
                        load_salary_distribution_tab();
                        load_salary_main_tab();
                    } else if (proof_type === 'social_security') {
                        load_social_insurance_tab();
                    } else if (proof_type === 'housing_fund') {
                        load_housing_fund_tab();
                    }
                } else if (r.message && r.message.message) {
                    frappe.msgprint({
                        title: '删除失败',
                        indicator: 'red',
                        message: r.message.message
                    });
                }
            }
        });
    }


    // ==========================================
    // 外部实发表未匹配人员提醒与一键别名绑定引擎
    // ==========================================
    function clear_unmatched_banner() {
        $("#qifu-unmatched-banner").addClass("hide");
        $("#qifu-unmatched-banner-list").empty();
        $("#qifu-unmatched-banner-actions").empty();
    }

    function show_unmatched_banner(unmatchedList, base64_str, filename, cur_m) {
        if (!unmatchedList || !unmatchedList.length) {
            clear_unmatched_banner();
            return;
        }
        const namesText = unmatchedList.map(it => `【${escHtml(it.raw_name)}】(¥ ${fmtMoney(it.net_salary || 0)})`).join('、');
        $("#qifu-unmatched-banner-list").html(namesText);

        let actionsHtml = unmatchedList.map(it => {
            const rawName = escHtml(it.raw_name);
            const amt = Number(it.net_salary || 0);
            return `
                <button type="button" class="btn btn-default btn-xs btn-banner-alias" data-name="${rawName}">给【${rawName}】添加别名</button>
                <button type="button" class="btn btn-primary btn-xs btn-banner-add-emp" data-name="${rawName}" data-amount="${amt}">+ 新增【${rawName}】档案</button>
            `;
        }).join('');

        $("#qifu-unmatched-banner-actions").html(actionsHtml);
        $("#qifu-unmatched-banner").removeClass("hide");

        $("#qifu-unmatched-banner-actions .btn-banner-alias").off("click").on("click", function(e) {
            e.preventDefault();
            const rawName = $(this).attr("data-name");
            open_quick_bind_alias_dialog(rawName, function() {
                execute_qifu_salary_upload(base64_str, filename, cur_m);
            });
        });

        $("#qifu-unmatched-banner-actions .btn-banner-add-emp").off("click").on("click", function(e) {
            e.preventDefault();
            const rawName = $(this).attr("data-name");
            const amt = Number($(this).attr("data-amount") || 0);
            open_emp_dialog({
                employee_name: rawName,
                fixed_salary: amt,
                salary_mode: amt > 0 ? '税后固定工资' : '税后动态工资'
            });
        });
    }

    function show_unmatched_employees_dialog(unmatchedList, base64_str, filename, cur_m) {
        if (!unmatchedList || !unmatchedList.length) return;

        let rowsHtml = unmatchedList.map(item => {
            const rawName = escHtml(item.raw_name);
            const amt = fmtMoney(item.net_salary || 0);
            const rowNo = item.source_row_number || '-';
            return `
                <tr class="qifu-unmatched-row" data-name="${rawName}">
                    <td class="qifu-text-center">${rowNo}</td>
                    <td><strong class="qifu-text-danger">${rawName}</strong></td>
                    <td class="qifu-money-cell">${amt}</td>
                    <td class="qifu-text-center">
                        <button type="button" class="btn btn-primary btn-xs btn-quick-bind-alias" data-name="${rawName}">一键添加别名</button>
                        <button type="button" class="btn btn-default btn-xs btn-quick-create-emp" data-name="${rawName}" data-amount="${Number(item.net_salary || 0)}">+ 添加人员</button>
                    </td>
                </tr>
            `;
        }).join('');

        const d = new frappe.ui.Dialog({
            title: ' 外部实发表未匹配人员提醒',
            size: 'large',
            fields: [
                {
                    fieldtype: 'HTML',
                    fieldname: 'unmatched_info',
                    options: `
                        <div class="ashan-callout ashan-callout--warning qifu-unmatched-modal-callout">
                            <strong>检测到外部实发表中有 ${unmatchedList.length} 位人员未在系统员工档案中匹配！</strong><br>
                            外部实发工资必须与系统在册员工一一对齐。您可以：<br>
                            1. <strong>【一键添加别名】</strong>：若该人员在系统已有档案（如外部“徐经理”对应系统“徐凤云”），一键绑定别名；<br>
                            2. <strong>【添加人员】</strong>：若为新入职人员，点击一键开户新增档案。<br>
                            操作完成后系统将自动重新导入并核算该表。
                        </div>
                        <table class="qifu-table qifu-unmatched-table">
                            <thead>
                                <tr>
                                    <th class="qifu-text-center">原表行号</th>
                                    <th>外部实发表姓名</th>
                                    <th class="qifu-text-right">实发金额</th>
                                    <th class="qifu-text-center">快捷处理通道</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rowsHtml}
                            </tbody>
                        </table>
                    `
                }
            ],
            primary_action_label: '稍后在页面处理并关闭',
            primary_action: function() {
                d.hide();
            }
        });

        d.$wrapper.find('.btn-quick-bind-alias').on('click', function(e) {
            e.preventDefault();
            const rawName = $(this).attr('data-name');
            d.hide();
            open_quick_bind_alias_dialog(rawName, function() {
                execute_qifu_salary_upload(base64_str, filename, cur_m);
            });
        });

        d.$wrapper.find('.btn-quick-create-emp').on('click', function(e) {
            e.preventDefault();
            const rawName = $(this).attr('data-name');
            const amt = Number($(this).attr('data-amount') || 0);
            d.hide();
            open_emp_dialog({
                employee_name: rawName,
                fixed_salary: amt,
                salary_mode: amt > 0 ? '税后固定工资' : '税后动态工资'
            });
        });

        d.show();
    }

    function open_quick_bind_alias_dialog(rawName, onComplete) {
        frappe.call({
            method: 'ashan_cn_procurement.services.employee_salary_service.get_qifu_employees',
            args: { company: COMPANY || "天津祺富机械加工有限公司", period_month: current_month },
            callback: function(r) {
                const empList = Array.isArray(r.message) ? r.message : ((r.message && r.message.records) || _qifu_employees_cache || []);
                if (!empList.length) {
                    frappe.msgprint('未获取到系统员工档案列表！');
                    return;
                }

                let suggestedEmp = '';
                const cleanRaw = rawName.replace(/经理|主管|班长|师傅|工|总/g, '').trim();
                for (const emp of empList) {
                    if (cleanRaw && emp.employee_name && (emp.employee_name.includes(cleanRaw) || cleanRaw.includes(emp.employee_name[0]))) {
                        suggestedEmp = `${emp.employee_no} - ${emp.employee_name}`;
                        break;
                    }
                }

                const options = [''].concat(empList.map(e => `${e.employee_no} - ${e.employee_name} (${e.department || '未分配'})`));

                const d = new frappe.ui.Dialog({
                    title: `一键添加别名 · 绑定【${rawName}】`,
                    fields: [
                        {
                            fieldtype: 'HTML',
                            fieldname: 'alias_help',
                            options: `
                                <div class="ashan-callout ashan-callout--dialog">
                                    <strong>将外部实发表称谓【${rawName}】绑定至系统现有员工：</strong><br>
                                    绑定后，系统员工档案将自动永久保存该别名。无论是本月还是后续月份上传，系统都将 100% 自动精确匹配该员工。
                                </div>
                            `
                        },
                        {
                            fieldtype: 'Select',
                            fieldname: 'target_emp',
                            label: '选择要绑定的系统员工档案',
                            options: options,
                            default: suggestedEmp || '',
                            reqd: 1,
                            description: '选择该外部称谓实际对应的公司内部在册员工。'
                        },
                        {
                            fieldtype: 'Data',
                            fieldname: 'alias_note',
                            label: '别名说明',
                            default: '外部实发表称谓',
                            description: '如：车间俗称、曾用名、职务称谓等。'
                        }
                    ],
                    primary_action_label: '确认绑定别名并重新匹配',
                    primary_action: function(vals) {
                        if (!vals || !vals.target_emp) {
                            frappe.msgprint('请先选择要绑定的系统员工档案！');
                            return;
                        }
                        const empNo = vals.target_emp.split(' - ')[0].trim();
                        const empObj = empList.find(e => e.employee_no === empNo);
                        if (!empObj) {
                            frappe.msgprint('未找到所选员工信息！');
                            return;
                        }

                        const currentAliasesStr = String(empObj.external_name_aliases || '').trim();
                        const aliasList = currentAliasesStr ? currentAliasesStr.split('\n').map(x => x.trim()).filter(Boolean) : [];
                        if (!aliasList.includes(rawName)) {
                            aliasList.push(rawName);
                        }
                        const newAliasesStr = aliasList.join('\n');

                        const structuredAliases = (empObj.name_aliases || []).map(a => ({
                            alias_name: a.alias_name,
                            alias_note: a.alias_note || ''
                        }));
                        if (!structuredAliases.some(a => a.alias_name === rawName)) {
                            structuredAliases.push({
                                alias_name: rawName,
                                alias_note: vals.alias_note || '外部实发表称谓'
                            });
                        }

                        frappe.call({
                            method: 'ashan_cn_procurement.services.employee_salary_service.update_employee_salary_profile',
                            type: 'POST',
                            args: {
                                name: empObj.name,
                                company: COMPANY,
                                external_name_aliases: newAliasesStr,
                                name_aliases: structuredAliases
                            },
                            callback: function(upRes) {
                                if (upRes.message && upRes.message.success) {
                                    d.hide();
                                    frappe.show_alert({
                                        message: ` 已成功将别名【${rawName}】绑定至员工【${empObj.employee_name} (${empObj.employee_no})】！`,
                                        indicator: 'green'
                                    }, 4);
                                    if (onComplete) onComplete();
                                }
                            }
                        });
                    }
                });

                d.show();
            }
        });
    }

    function trigger_salary_upload() {
        const cur_m = $("#qifu-month-select").val() || current_month;
        direct_file_upload('.xlsx,.xlsm', function(base64_str, filename) {
            execute_qifu_salary_upload(base64_str, filename, cur_m);
        });
    }

    //  核心统一：车间实发 Excel 上传与解析核算统一执行引擎 (Single Unified Salary Upload Engine)
    function execute_qifu_salary_upload(base64_str, filename, cur_m, on_complete) {
        if (!base64_str) {
            frappe.msgprint({
                title: ' 未选择文件',
                indicator: 'orange',
                message: '未检测到文件内容，请重新选择车间实发 Excel 文件！'
            });
            if (on_complete) on_complete(false);
            return;
        }

        const target_month = cur_m || $("#qifu-month-select").val() || current_month;

        frappe.call({
            method: 'ashan_cn_procurement.services.payroll_settlement_service.upload_and_import_qifu_salary',
            type: 'POST',
            freeze: true,
            freeze_message: ` 正在智能解析【${filename}】并执行税后实发倒推税前与个税核算...`,
            args: {
                file_data: base64_str,
                filename: filename,
                period_month: target_month,
                company: COMPANY || "天津祺富机械加工有限公司"
            },
            callback: function(r) {
                if (r.message && r.message.success) {
                    clear_unmatched_banner();
                    frappe.show_alert({
                        message: `[成功] 车间实发表导入完成，共解析导入 ${r.message.total_imported || 0} 人。`,
                        indicator: 'green'
                    }, 4);
                    load_monthly_workflow_hub();
                    load_salary_main_tab();
                    load_salary_distribution_tab();
                    if (typeof load_qifu_payroll_data === 'function') load_qifu_payroll_data();
                    if (current_tab === 'tax') load_tax_settlement_tab();
                    if (current_tab === 'settlement') load_payroll_settlement();
        if (current_tab === 'history') load_history_tab();
                    if (on_complete) on_complete(true);
                } else if (r.message && r.message.has_unmatched_employees) {
                    show_unmatched_employees_dialog(r.message.unmatched_employees, base64_str, filename, target_month);
                    show_unmatched_banner(r.message.unmatched_employees, base64_str, filename, target_month);
                    if (on_complete) on_complete(false);
                } else {
                    const msg = (r.message && r.message.message) || '处理 Excel 文件时发生错误，请检查文件格式！';
                    frappe.msgprint({
                        title: ' 导入失败',
                        indicator: 'red',
                        message: msg
                    });
                    if (on_complete) on_complete(false);
                }
            },
            error: function(r) {
                let error_msg = '服务器处理车间实发表时发生异常！';
                if (r && r._server_messages) {
                    try {
                        const msgs = JSON.parse(r._server_messages);
                        error_msg = msgs.map(m => {
                            try { return JSON.parse(m).message; } catch(e) { return m; }
                        }).join('<br>');
                    } catch(e) {}
                } else if (r && r.exc) {
                    error_msg = r.exc.split('\n').filter(Boolean).pop() || r.exc;
                }
                frappe.msgprint({
                    title: ' 上传与解析失败',
                    indicator: 'red',
                    message: `<div style="line-height:1.6; font-size:13px;">${error_msg}</div>`
                });
                if (on_complete) on_complete(false);
            }
        });
    }

    //  零中转极速上传引擎：基于 FileReader 直接转换 Base64 并提交后端解析核算
    function direct_file_upload(accept_exts, on_file_read) {
        const file_input = document.createElement('input');
        file_input.type = 'file';
        file_input.accept = accept_exts;
        file_input.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0;pointer-events:none;';
        document.body.appendChild(file_input);

        file_input.onchange = function(e) {
            const file = e.target.files[0];
            document.body.removeChild(file_input);
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function(evt) {
                const base64_str = evt.target.result;
                on_file_read(base64_str, file.name, file);
            };
            reader.onerror = function() {
                frappe.msgprint({
                    title: ' 读取文件失败',
                    indicator: 'red',
                    message: `无法读取本地文件【${file.name}】，请检查文件是否被占用或损坏！`
                });
            };
            reader.readAsDataURL(file);
        };

        file_input.click();
    }

    function direct_multi_file_upload(accept_exts, on_files_read) {
        const file_input = document.createElement('input');
        file_input.type = 'file';
        file_input.accept = accept_exts;
        file_input.multiple = true;
        file_input.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0;pointer-events:none;';
        document.body.appendChild(file_input);
        file_input.onchange = async function(e) {
            const files = Array.from(e.target.files || []);
            document.body.removeChild(file_input);
            if (!files.length) return;
            if (files.length > 20) {
                frappe.msgprint({title:' 文件过多', indicator:'red', message:'单次最多选择 20 个 PDF/ZIP 凭证文件。'});
                return;
            }
            try {
                const payload = await Promise.all(files.map(file => new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = evt => resolve({file_name: file.name, file_base64: evt.target.result});
                    reader.onerror = () => reject(new Error(`无法读取 ${file.name}`));
                    reader.readAsDataURL(file);
                })));
                on_files_read(payload, files);
            } catch (err) {
                frappe.msgprint({title:' 读取文件失败', indicator:'red', message: err.message || String(err)});
            }
        };
        file_input.click();
    }

        $container.on("click", "#btn-tab2-upload-salary", function(e) {
        e.preventDefault();
        $("#btn-wf-upload-salary").click();
    });



    function show_salary_attachment_dialog(data) {
        data = data || salary_main_data || {};
        const items = data.items || [];
        const wf = cached_workflow_status;
        const isConfirmed = Boolean(wf && wf.task2_import && wf.task2_import.is_confirmed);
        const isPeriodLocked = Boolean(data.locked || (wf && wf.is_locked));
        const isProtected = isPeriodLocked || isConfirmed;

        const fileUrl = data.imported_excel_file || (wf && wf.task2_import && wf.task2_import.file_url) || "";
        const fileName = fileUrl ? fileUrl.split("/").pop() : "车间实发工资表_原始凭证.xlsx";
        const periodMonth = data.period_month || current_month;

        // 计算车间实发人员及解析金额
        const workshopItems = items.filter(it => {
            const attDays = Number(it.attendance_days || it.work_days || 0);
            const workHours = Number(it.work_hours || 0);
            const net = Number(it.net_salary || 0);
            const itemMode = normalize_salary_mode(it.salary_mode, it.fixed_salary, it.employee_type);
            const isFixed = ["税前固定工资", "税后固定工资", "不税固定工资"].includes(itemMode);
            return (attDays > 0 || workHours > 0) || (net > 0 && !isFixed);
        });

        const activeList = workshopItems.length > 0 ? workshopItems : items;
        const workshopCount = (wf && wf.task2_import && wf.task2_import.employee_count) || activeList.length;

        let totalNet = 0;
        let totalGross = 0;
        let totalPost = 0;
        let totalHouse = 0;
        let totalAllowances = 0;
        let totalDeduction = 0;
        let totalDays = 0;
        let totalHours = 0;

        activeList.forEach(it => {
            const post = Number(it.post_allowance || 0);
            const house = Number(it.house_rent_allowance || 0);
            totalPost += post;
            totalHouse += house;
            totalAllowances += Number(it.allowances_total || (post + house) || 0);
            totalDeduction += Number(it.deduction || 0);
            totalGross += Number(it.gross_salary || 0);
            totalNet += Number(it.net_salary || 0);
            totalDays += Number(it.attendance_days || it.work_days || 0);
            totalHours += Number(it.work_hours || 0);
        });

        if (wf && wf.task2_import && Number(wf.task2_import.total_net || 0) > 0) {
            totalNet = Number(wf.task2_import.total_net);
        }

        const statusText = isPeriodLocked ? "已核定封账 · 只读受控" : (isConfirmed ? "外部实发已确认 · 受控中" : "凭证已归档 · 智能解析成功");
        const statusBadgeClass = isPeriodLocked ? "qifu-state-error" : "qifu-state-ok";

        const modalHtml = `
            <div class="qifu-proof-modal-card">
                <div class="qifu-compare-modal-header">
                    <div>
                        <span class="qifu-status-badge ${statusBadgeClass}">
                            ${statusText}
                        </span>
                        <span class="qifu-compare-modal-sub">
                            核定账期: <strong>${periodMonth}</strong> ｜ 原始凭证: <strong>${escHtml(fileName)}</strong>
                        </span>
                    </div>
                    ${fileUrl ? `<a href="${fileUrl}" target="_blank" class="btn btn-default btn-xs qifu-btn-view-proof">查看原件</a>` : ""}
                </div>

                <div class="qifu-detail-section">
                    <div class="qifu-detail-section-title">智能解析结果汇总</div>
                    <div class="qifu-detail-grid-4">
                        <div class="qifu-detail-item">
                            <div class="qifu-detail-item-label">解析账期年月</div>
                            <div class="qifu-detail-item-val qifu-val-blue">${periodMonth}</div>
                        </div>
                        <div class="qifu-detail-item">
                            <div class="qifu-detail-item-label">外部实发人数</div>
                            <div class="qifu-detail-item-val">${workshopCount} 人</div>
                        </div>
                        <div class="qifu-detail-item">
                            <div class="qifu-detail-item-label">实发合计金额 (税后)</div>
                            <div class="qifu-detail-item-val qifu-val-green">${fmtMoney(totalNet)}</div>
                        </div>
                        <div class="qifu-detail-item">
                            <div class="qifu-detail-item-label">补贴合计总额</div>
                            <div class="qifu-detail-item-val qifu-val-amber">${fmtMoney(totalAllowances)}</div>
                        </div>
                    </div>
                </div>

                <div class="qifu-detail-section">
                    <div class="qifu-detail-section-title">薪资与补贴明细构成</div>
                    <div class="qifu-detail-grid-4">
                        <div class="qifu-detail-item">
                            <div class="qifu-detail-item-label">职位岗位补贴</div>
                            <div class="qifu-detail-item-val">${fmtMoney(totalPost)}</div>
                        </div>
                        <div class="qifu-detail-item">
                            <div class="qifu-detail-item-label">房补与车补</div>
                            <div class="qifu-detail-item-val">${fmtMoney(totalHouse)}</div>
                        </div>
                        <div class="qifu-detail-item">
                            <div class="qifu-detail-item-label">考勤核实扣除</div>
                            <div class="qifu-detail-item-val ${totalDeduction > 0 ? "qifu-val-red" : ""}">${fmtMoney(totalDeduction)}</div>
                        </div>
                        <div class="qifu-detail-item">
                            <div class="qifu-detail-item-label">倒推应发总盘 (税前)</div>
                            <div class="qifu-detail-item-val">${fmtMoney(totalGross)}</div>
                        </div>
                    </div>
                </div>

                <div class="qifu-detail-section">
                    <div class="qifu-detail-section-title">出勤工时与存证档案</div>
                    <div class="qifu-detail-grid-3">
                        <div class="qifu-detail-item">
                            <div class="qifu-detail-item-label">累计出勤工日</div>
                            <div class="qifu-detail-item-val">${totalDays.toFixed(1)} 天</div>
                        </div>
                        <div class="qifu-detail-item">
                            <div class="qifu-detail-item-label">累计出勤工时</div>
                            <div class="qifu-detail-item-val">${totalHours.toFixed(1)} 小时</div>
                        </div>
                        <div class="qifu-detail-item">
                            <div class="qifu-detail-item-label">原始凭证文件</div>
                            <div class="qifu-detail-item-val" title="${escHtml(fileUrl)}">${escHtml(fileName)}</div>
                        </div>
                    </div>
                </div>

                <div class="qifu-attachment-dialog-actions">
                    <button type="button" class="btn btn-default btn-sm btn-modal-salary-view-proof">查看原件</button>
                    <button type="button" class="btn btn-default btn-sm btn-modal-salary-reupload" ${isProtected ? 'disabled title="受控状态不可重新上传"' : ''}>重新上传</button>
                    <button type="button" class="btn btn-danger btn-sm btn-modal-salary-delete-proof" ${isProtected ? 'disabled title="受控状态不可删除"' : ''}>删除附件</button>
                </div>
            </div>
        `;

        const d = new frappe.ui.Dialog({
            title: `车间实发表附件信息 · ${periodMonth}`,
            size: "large",
            static: true,
            fields: [
                {
                    fieldtype: "HTML",
                    fieldname: "attachment_info_html",
                    options: modalHtml
                }
            ],
            primary_action_label: __("关闭"),
            primary_action: function() {
                d.hide();
            }
        });

        d.$wrapper.on("click", ".btn-modal-salary-view-proof", function(e) {
            e.preventDefault();
            if (fileUrl) {
                window.open(fileUrl, "_blank");
            } else {
                frappe.msgprint(__("未找到原始凭证文件路径！"));
            }
        });

        d.$wrapper.on("click", ".btn-modal-salary-reupload", function(e) {
            e.preventDefault();
            if (isPeriodLocked) {
                frappe.msgprint(__("当前账期已核定封账，处于只读保护状态，禁止重新上传。"));
                return;
            }
            if (isConfirmed) {
                frappe.msgprint(__("外部实发工资主表已核定确认，处于受控只读状态。如需重新上传，请先在右上角【取消确认】。"));
                return;
            }
            d.hide();
            trigger_salary_upload();
        });

        d.$wrapper.on("click", ".btn-modal-salary-delete-proof", function(e) {
            e.preventDefault();
            if (isPeriodLocked) {
                frappe.msgprint(__("当前账期已核定封账，处于只读保护状态，禁止删除附件。"));
                return;
            }
            if (isConfirmed) {
                frappe.msgprint(__("外部实发工资主表已核定确认，处于受控只读状态。如需删除附件，请先在右上角【取消确认】。"));
                return;
            }
            d.hide();
            handle_salary_delete_click();
        });

        d.show();
    }

    function show_social_security_comparison_modal(data, cur_m) {
        const diff = Number(data.difference_amount || 0);
        const is_matched = Boolean(data.is_matched);
        const d = new frappe.ui.Dialog({
            title: is_matched ? '税局社保申报表与系统核算比对一致' : '税局社保申报表与系统核算存在差额',
            size: 'large',
            fields: [
                {
                    fieldtype: 'HTML',
                    fieldname: 'compare_view',
                    options: `
                        <div class="qifu-proof-modal-card">
                            <div class="qifu-compare-modal-header">
                                <div>
                                    <span class="qifu-status-badge ${is_matched ? 'qifu-state-ok' : 'qifu-state-error'}">
                                        ${is_matched ? '核验通过 · 金额一致' : '金额不符 · 存在差额'}
                                    </span>
                                    <span class="qifu-compare-modal-sub">
                                        核定账期: <strong>${cur_m}</strong> ｜ 凭证所属期: <strong>${data.expected_period}</strong> (符合次月缴费规则)
                                    </span>
                                </div>
                                ${data.file_url ? `<a href="${data.file_url}" target="_blank" class="btn btn-default btn-xs" class="qifu-link-blue">下载原件 PDF</a>` : ''}
                            </div>
                            <div class="qifu-compare-table-wrap">
                                <table class="qifu-table qifu-compare-modal-table">
                                    <colgroup>
                                        <col class="col-w-compare-item">
                                        <col class="col-w-compare-parsed">
                                        <col class="col-w-compare-sys">
                                        <col class="col-w-compare-diff">
                                        <col class="col-w-compare-status">
                                    </colgroup>
                                    <thead>
                                        <tr>
                                            <th class="qifu-text-left">核对项目</th>
                                            <th class="qifu-text-right">税局申报表 (PDF提取)</th>
                                            <th class="qifu-text-right">系统核算总额</th>
                                            <th class="qifu-text-right">比对差额</th>
                                            <th class="qifu-text-center">状态</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td class="qifu-table-label-cell">社保应缴总额</td>
                                            <td class="qifu-money-cell qifu-val-blue">¥ ${Number(data.parsed_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})}</td>
                                            <td class="qifu-money-cell qifu-val-green">¥ ${Number(data.sys_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})}</td>
                                            <td class="qifu-money-cell ${is_matched ? 'qifu-val-green' : 'qifu-val-red'}">¥ ${diff.toLocaleString('zh-CN', {minimumFractionDigits:2})}</td>
                                            <td class="qifu-text-center">
                                                <span class="qifu-status-badge ${is_matched ? 'qifu-state-ok' : 'qifu-state-error'}">
                                                    ${is_matched ? '通过' : '不符'}
                                                </span>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                            <div class="${is_matched ? 'qifu-compare-modal-notice-ok' : 'qifu-compare-modal-notice-warn'}">
                                <strong>${is_matched ? '核验结论' : '差额提示'}：</strong><br>
                                ${data.message || ''}<br>
                                ${is_matched ? '申报表已自动规范归档，准予执行月度薪酬最终核定与封账。' : '当前存在差额，凭证已保存归档，但系统将严格阻断月度最终封账。请核对员工社保缴费基数或联系财务确认申报表。'}
                            </div>
                        </div>
                    `
                }
            ],
            primary_action_label: '确认并关闭',
            primary_action: function() {
                d.hide();
            }
        });
        d.$wrapper.addClass("qifu-comparison-dialog");
        d.show();
    }

    function show_housing_fund_comparison_modal(data, cur_m) {
        const diff = Number(data.difference_amount || 0);
        const is_matched = Boolean(data.is_matched);
        const d = new frappe.ui.Dialog({
            title: is_matched ? '住房公积金缴存凭证与系统核算比对一致' : '住房公积金凭证与系统核算存在差额',
            size: 'large',
            fields: [
                {
                    fieldtype: 'HTML',
                    fieldname: 'compare_view',
                    options: `
                        <div class="qifu-proof-modal-card">
                            <div class="qifu-compare-modal-header">
                                <div>
                                    <span class="qifu-status-badge ${is_matched ? 'qifu-state-ok' : 'qifu-state-error'}">
                                        ${is_matched ? '核验通过 · 金额一致' : '金额不符 · 存在差额'}
                                    </span>
                                    <span class="qifu-compare-modal-sub">
                                        核定账期: <strong>${cur_m}</strong> ｜ 凭证所属期: <strong>${data.expected_period}</strong> (符合次月缴费规则)
                                    </span>
                                </div>
                                ${data.file_url ? `<a href="${data.file_url}" target="_blank" class="btn btn-default btn-xs" class="qifu-link-blue">下载原件 PDF</a>` : ''}
                            </div>
                            <div class="qifu-compare-table-wrap">
                                <table class="qifu-table qifu-compare-modal-table">
                                    <colgroup>
                                        <col class="col-w-compare-item">
                                        <col class="col-w-compare-parsed">
                                        <col class="col-w-compare-sys">
                                        <col class="col-w-compare-diff">
                                        <col class="col-w-compare-status">
                                    </colgroup>
                                    <thead>
                                        <tr>
                                            <th class="qifu-text-left">核对项目</th>
                                            <th class="qifu-text-right">公积金凭证 (PDF提取)</th>
                                            <th class="qifu-text-right">系统核算总额</th>
                                            <th class="qifu-text-right">比对差额</th>
                                            <th class="qifu-text-center">状态</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td class="qifu-table-label-cell">公积金缴存总额</td>
                                            <td class="qifu-money-cell qifu-val-blue">¥ ${Number(data.parsed_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})}</td>
                                            <td class="qifu-money-cell qifu-val-green">¥ ${Number(data.sys_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})}</td>
                                            <td class="qifu-money-cell ${is_matched ? 'qifu-val-green' : 'qifu-val-red'}">¥ ${diff.toLocaleString('zh-CN', {minimumFractionDigits:2})}</td>
                                            <td class="qifu-text-center">
                                                <span class="qifu-status-badge ${is_matched ? 'qifu-state-ok' : 'qifu-state-error'}">
                                                    ${is_matched ? '通过' : '不符'}
                                                </span>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                            <div class="${is_matched ? 'qifu-compare-modal-notice-ok' : 'qifu-compare-modal-notice-warn'}">
                                <strong>${is_matched ? '核验结论' : '差额提示'}：</strong><br>
                                ${data.message || ''}<br>
                                ${is_matched ? '凭证已自动解压并规范归档，准予执行月度薪酬最终核定与封账。' : '当前存在差额，凭证已保存归档，但系统将严格阻断月度最终封账。请核对参缴人员或联系财务确认凭证。'}
                            </div>
                        </div>
                    `
                }
            ],
            primary_action_label: '确认并关闭',
            primary_action: function() {
                d.hide();
            }
        });
        d.$wrapper.addClass("qifu-comparison-dialog");
        d.show();
    }

    function start_social_security_upload(cur_m) {
        cur_m = cur_m || $("#qifu-month-select").val() || current_month;
        direct_multi_file_upload('.pdf,.zip', function(file_payload, raw_files) {
            const names = raw_files.map(f => f.name).join('、');
            frappe.call({
                method: 'ashan_cn_procurement.services.payroll_settlement_service.upload_and_verify_social_security_file',
                type: 'POST', freeze: true,
                freeze_message: `正在解析 ${raw_files.length} 个社保文件：先校验所属期，再汇总金额...`,
                args: {company: COMPANY, period_month: cur_m, files_json: JSON.stringify(file_payload)},
                callback: function(r) {
                    if (r.message && r.message.success) {
                        show_social_security_comparison_modal(r.message, cur_m);
                        load_monthly_workflow_hub();
                        if (typeof load_social_insurance_tab === 'function') load_social_insurance_tab();
                    } else {
                        frappe.msgprint({
                            title: (r.message && r.message.validation_type === 'period_mismatch') ? '社保凭证所属期错误 · 已拒绝上传' : '社保凭证核验失败',
                            indicator: 'red',
                            message: (r.message && r.message.message) || '社保凭证处理失败。'
                        });
                    }
                },
                error: function(r) {
                    let msg='服务器处理社保凭证时发生错误！';
                    if (r && r._server_messages) {
                        try { msg=JSON.parse(r._server_messages).map(m=>{try{return JSON.parse(m).message}catch(e){return m}}).join('<br>'); } catch(e){}
                    }
                    frappe.msgprint({title:'请求异常',indicator:'red',message:msg});
                }
            });
        });
    }

    function start_housing_fund_upload(cur_m) {
        cur_m = cur_m || $("#qifu-month-select").val() || current_month;
        direct_multi_file_upload('.pdf,.zip', function(file_payload, raw_files) {
            const names = raw_files.map(f => f.name).join('、');
            frappe.call({
                method: 'ashan_cn_procurement.services.payroll_settlement_service.upload_and_verify_housing_fund_file',
                type: 'POST', freeze: true,
                freeze_message: `正在解析 ${raw_files.length} 个公积金文件：先校验缴存年月，再汇总金额...`,
                args: {company: COMPANY, period_month: cur_m, files_json: JSON.stringify(file_payload)},
                callback: function(r) {
                    if (r.message && r.message.success) {
                        show_housing_fund_comparison_modal(r.message, cur_m);
                        load_monthly_workflow_hub();
                        if (typeof load_housing_fund_tab === 'function') load_housing_fund_tab();
                    } else {
                        frappe.msgprint({
                            title: (r.message && r.message.validation_type === 'period_mismatch') ? '公积金凭证所属期错误 · 已拒绝上传' : '公积金凭证核验失败',
                            indicator: 'red',
                            message: (r.message && r.message.message) || '公积金凭证处理失败。'
                        });
                    }
                },
                error: function(r) {
                    let msg='服务器处理公积金凭证时发生错误！';
                    if (r && r._server_messages) {
                        try { msg=JSON.parse(r._server_messages).map(m=>{try{return JSON.parse(m).message}catch(e){return m}}).join('<br>'); } catch(e){}
                    }
                    frappe.msgprint({title:'请求异常',indicator:'red',message:msg});
                }
            });
        });
    }

    $container.on("click", "#btn-tab3-upload-ss, #btn-wf-upload-ss, .btn-reupload-ss", function(e) {
        e.preventDefault();
        e.stopPropagation();
        start_social_security_upload();
    });

    $container.on("click", "#btn-tab4-upload-hf, #btn-wf-upload-hf, .btn-reupload-hf", function(e) {
        e.preventDefault();
        e.stopPropagation();
        start_housing_fund_upload();
    });

    $container.on("click", "#btn-tab2-upload-salary, #btn-wf-upload-salary", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const cur_m = $("#qifu-month-select").val() || current_month;
        direct_file_upload('.xlsx,.xlsm', function(base64_str, filename) {
            execute_qifu_salary_upload(base64_str, filename, cur_m);
        });
    });

    $container.on("click", "#btn-tab3-delete-ss-proof, #btn-tab3-panel-delete", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const cur_m = $("#qifu-month-select").val() || current_month;
        frappe.confirm(`确定要删除【${cur_m}】已上传的全部社保缴费申报表凭证吗？`, function() {
            execute_delete_proof('social_security', '社保申报表凭证');
        });
    });

    $container.on("click", "#btn-tab4-delete-hf-proof, #btn-tab4-panel-delete", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const cur_m = $("#qifu-month-select").val() || current_month;
        frappe.confirm(`确定要删除【${cur_m}】已上传的全部住房公积金缴存凭证吗？`, function() {
            execute_delete_proof('housing_fund', '公积金缴存凭证');
        });
    });

    $container.on("click", "#btn-tab2-delete-salary", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const cur_m = $("#qifu-month-select").val() || current_month;
        frappe.confirm(`确定要删除【${cur_m}】已上传的车间外部实发工资表吗？<br><br>只会清除外部工资来源。员工母表中的固定工资人员会保留，并立即重新计算个税与综合结算；车间外部实发仍需重新上传 Excel。`, function() {
            execute_delete_proof('salary', '车间实发工资表');
        });
    });

    // 右上角胶囊文件【 权限受控安全下载】
    $container.on("click", ".btn-wf-download-file", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const ptype = $(this).attr("data-type"); // 'excel', 'ss', 'hf'
        const cur_m = $("#qifu-month-select").val() || current_month;
        const file_url = $(this).attr("data-url");

        if (!file_url) {
            frappe.show_alert({ message: '该账期尚未上传该类型的原始凭证文件', indicator: 'orange' });
            return;
        }

        // 调用专用受控鉴权下载接口，杜绝越权与私自下载
        const download_url = `/api/method/ashan_cn_procurement.services.payroll_settlement_service.download_payroll_proof_file?company=${encodeURIComponent(COMPANY)}&period_month=${encodeURIComponent(cur_m)}&proof_type=${encodeURIComponent(ptype)}`;
        window.open(download_url, "_blank");
    });

    // 阶段 5 综合核定与封账操作 (单入口防抖防重复弹窗)
    let is_lock_action_in_progress = false;

    function handle_qifu_monthly_lock_action(e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        if (is_lock_action_in_progress) {
            return;
        }
        is_lock_action_in_progress = true;
        const cur_m = $("#qifu-month-select").val() || current_month;

        frappe.show_alert({ message: ' 正在实时校验月度核算任务状态...', indicator: 'blue' });

        frappe.call({
            method: 'ashan_cn_procurement.services.payroll_settlement_service.get_monthly_workflow_status',
            args: { company: COMPANY, period_month: cur_m },
            callback: function(r) {
                is_lock_action_in_progress = false;
                if (!r.message) {
                    frappe.msgprint("获取月度核定状态失败，请刷新页面重试！");
                    return;
                }
                const wf = r.message;
                cached_workflow_status = wf;

                // 1. 如果当前账期已经封账 -> 弹出反审核解锁登记
                if (wf.is_locked) {
                    frappe.confirm(
                        `<strong>【 当前发薪账期已封账锁定】</strong><br><br>
                        核算公司：<strong>${COMPANY}</strong><br>
                        核算月份：<span style="color:#2563eb; font-weight:800;">${cur_m}</span><br><br>
                        当前月份所有明细已处于纯只读保护状态。<br>
                        是否需要执行【反审核/解锁】以恢复数据修改与重新计算权限？`,
                        function() {
                            frappe.prompt(
                                [{ fieldname: 'reason', fieldtype: 'Small Text', label: '解锁/反审核原因 (必填)', reqd: 1 }],
                                function(values) {
                                    frappe.call({
                                        method: 'ashan_cn_procurement.services.payroll_settlement_service.unlock_monthly_settlement',
                                        type: 'POST',
                                        args: { company: COMPANY, period_month: cur_m, reason: values.reason },
                                        callback: function(res) {
                                            if (res.message && res.message.success) {
                                                frappe.msgprint({ title: ' 账期已反审核解锁', indicator: 'green', message: res.message.message });
                                                load_monthly_workflow_hub();
                                            }
                                        }
                                    });
                                },
                                '反审核解锁原因登记'
                            );
                        }
                    );
                    return;
                }

                // 2. 前置任务校验与强拦截 (严格检查：实发表、社保申报表、公积金凭证)
                let missing_steps = [];
                if (wf.task1_profile.status !== 'done') missing_steps.push("• <strong>第 1 步 · 员工底册</strong>：在册员工人数为 0，请先在档案库录入员工。");
                if (wf.task2_import.status !== 'done') missing_steps.push("• <strong>第 2 步 · 外部实发</strong>：尚未上传并导入【外部实发工资表 Excel】。");
                if (wf.calculation && !wf.calculation.ready) {
                    const calc = wf.calculation;
                    missing_steps.push(`• <strong>服务器计算中心</strong>：薪酬与累计个税尚未完全同步。待计算 ${Number(calc.pending || 0)}、排队 ${Number(calc.queued || 0)}、计算中 ${Number(calc.running || 0)}、失败 ${Number(calc.failed || 0)}、未计算 ${Number(calc.uncomputed || 0)}、活动任务 ${Number(calc.active_tasks || 0)}。请等待后台完成或处理失败任务。`);
                }
                if (wf.task3_ss.status === 'mismatch') {
                    if (wf.task3_ss.period_valid === false && wf.task3_ss.file_url) {
                        missing_steps.push(`• <strong>第 3 步 · 社保申报</strong>：<span style="color:#b91c1c;font-weight:700;">凭证所属期 ${(wf.task3_ss.detected_periods || []).join('、') || '无法识别'} 与核定期 ${cur_m} 对应的实际缴费期 ${wf.task3_ss.expected_period || '—'} 不一致。禁止最终核定封账。</span>`);
                    } else {
                        const ss_diff = Number(wf.task3_ss.difference_amount != null ? wf.task3_ss.difference_amount : Math.abs(wf.task3_ss.parsed_amount - wf.task3_ss.sys_amount)).toLocaleString('zh-CN', {minimumFractionDigits:2});
                        missing_steps.push(`• <strong>第 3 步 · 社保申报</strong>：<span style="color:#b91c1c;font-weight:700;">所属期已通过，但凭证合计 ¥${Number(wf.task3_ss.parsed_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})} 与系统核算 ¥${Number(wf.task3_ss.sys_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})} 不一致，差额 ¥${ss_diff}。</span>`);
                    }
                } else if (wf.task3_ss.status !== 'verified') {
                    missing_steps.push(`• <strong>第 3 步 · 社保申报</strong>：请上传属于 <strong>${wf.task3_ss.expected_period || '次月'}</strong> 的社保 PDF/ZIP，并完成日期+金额双重核验。`);
                }
                if (wf.task4_hf.status === 'mismatch') {
                    if (wf.task4_hf.period_valid === false && wf.task4_hf.file_url) {
                        missing_steps.push(`• <strong>第 4 步 · 公积金凭证</strong>：<span style="color:#b91c1c;font-weight:700;">凭证所属期 ${(wf.task4_hf.detected_periods || []).join('、') || '无法识别'} 与核定期 ${cur_m} 对应的实际缴费期 ${wf.task4_hf.expected_period || '—'} 不一致。禁止最终核定封账。</span>`);
                    } else {
                        const hf_diff = Number(wf.task4_hf.difference_amount != null ? wf.task4_hf.difference_amount : Math.abs(wf.task4_hf.parsed_amount - wf.task4_hf.sys_amount)).toLocaleString('zh-CN', {minimumFractionDigits:2});
                        missing_steps.push(`• <strong>第 4 步 · 公积金凭证</strong>：<span style="color:#b91c1c;font-weight:700;">所属期已通过，但凭证合计 ¥${Number(wf.task4_hf.parsed_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})} 与系统核算 ¥${Number(wf.task4_hf.sys_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})} 不一致，差额 ¥${hf_diff}。</span>`);
                    }
                } else if (wf.task4_hf.status !== 'verified') {
                    missing_steps.push(`• <strong>第 4 步 · 公积金凭证</strong>：请上传属于 <strong>${wf.task4_hf.expected_period || '次月'}</strong> 的公积金 PDF/ZIP，并完成日期+金额双重核验。`);
                }

                if (missing_steps.length > 0) {
                    frappe.msgprint({
                        title: ' 无法执行最终核定：前置任务尚未全部完成',
                        indicator: 'orange',
                        message: `
                            <div style="font-size:12.5px; line-height:1.7;">
                                <div style="margin-bottom:8px; color:#991b1b; font-weight:700;">
                                    为保证财务核算、税后反推、累计个税与凭证数据一致，必须在服务器计算及以下前置任务全部完成后方可最终封账：
                                </div>
                                <div style="background:#fff1f2; border:1px solid #fecdd3; border-radius:6px; padding:8px 12px; margin-bottom:10px; color:#881337;">
                                    ${missing_steps.join("<br>")}
                                </div>
                                <div style="color:#475569; font-size:12px;">
                                     提示：您可以直接点击上方对应的 <strong>[ 上传]</strong> 按钮快速完成各步骤。
                                </div>
                            </div>
                        `
                    });
                    return;
                }

                // 3. 前置任务全部就绪，弹出最终综合核定封账确认大弹窗
                frappe.confirm(
                    `<strong>【 前置任务全部就绪 · 执行最终薪酬核定并封账】</strong><br><br>
                    核算公司：<strong>${COMPANY}</strong><br>
                    核算月份：<span style="color:#2563eb; font-weight:800;">${cur_m}</span><br>
                    核定在册：<span style="color:#059669; font-weight:700;">${Number(wf.task1_profile.active_count || 0)} 人</span><br><br>
                    <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:8px 10px; font-size:12px; line-height:1.6;">
                        • 车间实发总盘：<strong>¥ ${Number(wf.task2_import.total_net || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})}</strong><br>
                        • 社保申报总额：<strong>¥ ${Number(wf.task3_ss.parsed_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})}</strong><br>
                        • 公积金缴存总额：<strong>¥ ${Number(wf.task4_hf.parsed_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})}</strong>
                    </div><br>
                    <span> 封账后效应：</span><br>
                    1. 本月 ${Number(wf.task1_profile.active_count || 0)} 名员工的薪酬快照、外部实发表、社保/公积金台账与个税申报表将<strong>全部进入只读保护，禁止随意篡改</strong>；<br>
                    2. 系统将<strong>自动为您开启下月发薪账期【${wf.next_period_month}】的创建与写入权限</strong>，确保财务核算连续性。<br><br>
                    确认立即执行最终核定封账吗？`,
                    function() {
                        frappe.call({
                            method: 'ashan_cn_procurement.services.payroll_settlement_service.execute_monthly_settlement_lock',
                            type: 'POST',
                            args: { company: COMPANY, period_month: cur_m },
                            callback: function(lock_res) {
                                if (lock_res.message && lock_res.message.success) {
                                    frappe.msgprint({
                                        title: ' 最终核定封账成功',
                                        indicator: 'green',
                                        message: `
                                            <div style="font-size:13px; line-height:1.6;">
                                                ${lock_res.message.message}<br><br>
                                                <button class="btn btn-primary btn-sm" onclick="$('#qifu-month-select').val('${lock_res.message.next_period_month}').trigger('change'); cur_dialog.hide();">
                                                     立即前往下月【${lock_res.message.next_period_month}】建账与录入
                                                </button>
                                            </div>
                                        `
                                    });
                                    load_monthly_workflow_hub();
                                }
                            }
                        });
                    }
                );
            }
        });
    }

    $container.off("click", "#btn-qifu-header-lock, #btn-wf-lock-action").on("click", "#btn-qifu-header-lock, #btn-wf-lock-action", handle_qifu_monthly_lock_action);

    // 1. 业务 Tab 切换监听
    $container.on("click", ".qifu-tab-btn", function() {
        $(".qifu-tab-btn").removeClass("active");
        $(this).addClass("active");
        const tab = $(this).attr("data-tab");
        $(".qifu-tab-content").removeClass("active").hide();
        $(`#qifu-tab-${tab}`).addClass("active").show();
        current_tab = tab;
        setTimeout(adjust_active_table_height, 50);

        if (tab === 'salary_main') load_salary_main_tab();
        if (tab === 'employees') load_qifu_employees();
        if (tab === 'import') load_salary_distribution_tab();
        if (tab === 'social_insurance') load_social_insurance_tab();
        if (tab === 'housing_fund') load_housing_fund_tab();
        if (tab === 'tax') load_tax_settlement_tab();
        if (tab === 'settlement') load_payroll_settlement();
        if (tab === 'history') load_history_tab();
    });

    // 2. 月份切换
    $container.on("change", "#qifu-month-select", function() {
        current_month = $(this).val();
        current_history_period = current_month;
        $("#qifu-payroll-period-text").text(current_month);
        $("#qifu-payment-period-text").text(next_period(current_month));
        load_monthly_workflow_hub();
        if (current_tab === 'salary_main') load_salary_main_tab();
        if (current_tab === 'employees') load_qifu_employees();
        if (current_tab === 'import') load_salary_distribution_tab();
        if (current_tab === 'social_insurance') load_social_insurance_tab();
        if (current_tab === 'housing_fund') load_housing_fund_tab();
        if (current_tab === 'tax') load_tax_settlement_tab();
        if (current_tab === 'settlement') load_payroll_settlement();
        if (current_tab === 'history') load_history_tab();
    });

    // 3. 刷新按钮
    $container.on("click", "#btn-qifu-refresh-all, #btn-qifu-refresh-header", function() {
        load_monthly_workflow_hub();
        if (current_tab === 'salary_main') load_salary_main_tab();
        if (current_tab === 'employees') load_qifu_employees();
        if (current_tab === 'import') load_salary_distribution_tab();
        if (current_tab === 'social_insurance') load_social_insurance_tab();
        if (current_tab === 'housing_fund') load_housing_fund_tab();
        if (current_tab === 'tax') load_tax_settlement_tab();
        if (current_tab === 'settlement') load_payroll_settlement();
        if (current_tab === 'history') load_history_tab();
    });

    // 外部实发主表交互监听
    let salary_search_timer = null;
    $container.on("input", "#qifu-search-input", function() {
        clearTimeout(salary_search_timer);
        salary_search_timer = setTimeout(() => {
            salary_main_search = $(this).val();
            render_salary_main_table();
        }, 150);
    });

    $container.on("click", "#salary-main-filter button", function() {
        $("#salary-main-filter button").removeClass("active");
        $(this).addClass("active");
        salary_main_filter = $(this).data("filter") || $(this).attr("data-filter") || "all";
        render_salary_main_table();
    });

    $container.on("click", "#tbody-salary-main tr", function(e) {
        if ($(e.target).closest("a, input, button").length && !$(e.target).hasClass("btn-view-salary-detail")) {
            return;
        }
        const empNo = $(this).attr("data-emp-no");
        const idx = $(this).data("idx");
        let item = null;
        if (empNo && salary_main_data && salary_main_data.items) {
            item = salary_main_data.items.find(x => x.employee_no === empNo);
        }
        if (!item && idx !== undefined && salary_main_data && salary_main_data.items) {
            item = salary_main_data.items[idx];
        }
        if (item) open_qifu_salary_item_detail_dialog(item);
    });

    $container.on("click", ".btn-view-salary-detail", function(e) {
        e.stopPropagation();
        const $tr = $(this).closest("tr");
        const empNo = $tr.attr("data-emp-no");
        const idx = $(this).data("idx");
        let item = null;
        if (empNo && salary_main_data && salary_main_data.items) {
            item = salary_main_data.items.find(x => x.employee_no === empNo);
        }
        if (!item && idx !== undefined && salary_main_data && salary_main_data.items) {
            item = salary_main_data.items[idx];
        }
        if (item) open_qifu_salary_item_detail_dialog(item);
    });

    $container.on("click", "#btn-salary-table-layout", function() {
        if (window.AshanUI?.TableLayoutEngine?.open) {
            AshanUI.TableLayoutEngine.open("#salary-data-table");
        }
    });

    $container.on("click", "#btn-salary-view-proof", function() {
        const fileUrl = $(this).data("file");
        if (fileUrl) window.open(fileUrl, "_blank");
    });

    $container.on("change", "#qifu-salary-file-input", function(e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const cur_m = $("#qifu-month-select").val() || current_month;
        const reader = new FileReader();
        reader.onload = function(evt) {
            execute_qifu_salary_upload(evt.target.result, file.name, cur_m);
        };
        reader.readAsDataURL(file);
        $(this).val("");
    });

    $container.on("change", "#qifu-ss-file-input", function(e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const cur_m = $("#qifu-month-select").val() || current_month;
        const reader = new FileReader();
        reader.onload = function(evt) {
            frappe.call({
                method: 'ashan_cn_procurement.services.payroll_settlement_service.upload_and_verify_social_security_file',
                type: 'POST',
                freeze: true,
                freeze_message: `正在解析税局社保申报表【${file.name}】并与系统核算比对...`,
                args: {
                    company: COMPANY || "天津祺富机械加工有限公司",
                    period_month: cur_m,
                    file_base64: evt.target.result,
                    file_name: file.name
                },
                callback: function(r) {
                    if (r.message && r.message.success) {
                        frappe.show_alert({ message: r.message.message, indicator: 'green' });
                        load_social_insurance_tab();
                        load_monthly_workflow_hub();
                    } else if (r.message && !r.message.success) {
                        frappe.msgprint({ title: '社保凭证校验未通过', indicator: 'red', message: r.message.message });
                    }
                }
            });
        };
        reader.readAsDataURL(file);
        $(this).val("");
    });

    $container.on("change", "#qifu-hf-file-input", function(e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const cur_m = $("#qifu-month-select").val() || current_month;
        const reader = new FileReader();
        reader.onload = function(evt) {
            frappe.call({
                method: 'ashan_cn_procurement.services.payroll_settlement_service.upload_and_verify_housing_fund_file',
                type: 'POST',
                freeze: true,
                freeze_message: `正在解析公积金缴存凭证【${file.name}】并与系统核算比对...`,
                args: {
                    company: COMPANY || "天津祺富机械加工有限公司",
                    period_month: cur_m,
                    file_base64: evt.target.result,
                    file_name: file.name
                },
                callback: function(r) {
                    if (r.message && r.message.success) {
                        frappe.show_alert({ message: r.message.message, indicator: 'green' });
                        load_housing_fund_tab();
                        load_monthly_workflow_hub();
                    } else if (r.message && !r.message.success) {
                        frappe.msgprint({ title: '公积金凭证校验未通过', indicator: 'red', message: r.message.message });
                    }
                }
            });
        };
        reader.readAsDataURL(file);
        $(this).val("");
    });

    $container.on("click", "#btn-salary-integrated-action", function() {
        if ($(this).hasClass("btn-salary-action-attachment")) {
            show_salary_attachment_dialog();
        } else {
            trigger_salary_upload();
        }
    });

    $container.on("click", "#btn-salary-reupload", function() {
        trigger_salary_upload();
    });

    $container.on("click", "#btn-salary-delete-proof", function() {
        handle_salary_delete_click();
    });

    $container.on("click", ".btn-empty-upload", function() {
        trigger_salary_upload();
    });

    // 历史数据与个税台账穿透
    $container.on("click", ".btn-drill-emp-history", function() {
        const emp = $(this).attr("data-emp");
        if (!emp) return;
        current_history_employee = emp;
        // 如果当前是 68 列完整核算模式，保持 68 列模式，展示单人 68 列申报周期月度轨迹！
        if (current_history_mode === 'full') {
            current_history_period = 'all';
            $(`.qifu-tab-btn[data-tab='history']`).trigger('click');
            load_history_tab('full', emp);
        } else {
            current_history_mode = 'single';
            $(`.qifu-tab-btn[data-tab='history']`).trigger('click');
            load_history_tab('single', emp);
        }
    });

    $container.on("click", "#btn-history-all", function() {
        if (current_history_employee) {
            current_history_mode = 'single';
            load_history_tab('single', current_history_employee);
        } else {
            current_history_mode = 'all';
            load_history_tab('all', '');
        }
    });

    $container.on("click", "#btn-history-full", function() {
        current_history_mode = 'full';
        load_history_tab('full', current_history_employee);
    });

    $container.on("change", "#history-emp-select", function() {
        const emp = $(this).val() || '';
        current_history_employee = emp;
        if (current_history_mode === 'full') {
            if (emp && current_history_period !== 'all') {
                current_history_period = 'all';
            }
            load_history_tab('full', emp);
        } else {
            if (emp) {
                current_history_mode = 'single';
                load_history_tab('single', emp);
            } else {
                current_history_mode = 'all';
                load_history_tab('all', '');
            }
        }
    });

    $container.on("change", "#history-period-select", function() {
        current_history_period = $(this).val() || 'all';
        current_history_mode = 'full';
        load_history_tab('full', current_history_employee);
    });

    $container.on("click", "#btn-history-back", function() {
        current_history_employee = '';
        $("#history-emp-select").val('');
        if (current_history_mode === 'full') {
            current_history_period = $("#qifu-month-select").val() || current_month;
            load_history_tab('full', '');
        } else {
            current_history_mode = 'all';
            load_history_tab('all', '');
        }
    });

    $container.on("click", "#btn-history-prev", function() {
        if (history_current_page > 1) {
            history_current_page--;
            render_history_full_page();
        }
    });

    $container.on("click", "#btn-history-next", function() {
        const sizeVal = $("#history-page-size").val();
        const size = sizeVal === 'all' ? history_full_rows.length : (parseInt(sizeVal, 10) || 25);
        const totalPages = Math.ceil(history_full_rows.length / size) || 1;
        if (history_current_page < totalPages) {
            history_current_page++;
            render_history_full_page();
        }
    });

    $container.on("change", "#history-page-size", function() {
        history_current_page = 1;
        render_history_full_page();
    });

    $container.on("click", ".btn-history-correct", function() {
        open_history_correction_dialog($(this).attr('data-emp'), $(this).attr('data-period'));
    });

    $container.on("click", "#btn-history-export", function() {
        export_excel_action('history', {
            history_mode: current_history_mode === 'single' ? 'single' : (current_history_mode === 'full' ? 'full' : 'all'),
            history_emp_no: current_history_employee || '',
            history_period_month: current_history_period || current_month
        });
    });

    // 服务器计算中心：统一人工复核、任务记录与失败重试
    $container.on("click", "#btn-server-recalc", function() { open_server_recalculation_dialog(); });
    $container.on("click", "#btn-calc-task-log", function() {
        if (!last_recalc_status) {
            load_calculation_center();
            setTimeout(render_calculation_task_log, 300);
        } else {
            render_calculation_task_log();
        }
    });
    $(document).off("click", ".btn-retry-recalc").on("click", ".btn-retry-recalc", function() {
        const taskName = $(this).attr('data-task');
        if (!taskName) return;
        frappe.call({
            method:'ashan_cn_procurement.services.payroll_recalculation_service.retry_payroll_recalculation_task',
            type:'POST', args:{task_name:taskName},
            callback:function(r) {
                if (r.message && r.message.success) {
                    frappe.show_alert({message:r.message.message, indicator:'green'});
                    load_calculation_center();
                }
            }
        });
    });

    // 4. Tab 1 员工母表操作
            // 员工档案底册核定 / 取消核定按钮事件 (对齐 desk/jizhong-hr-salary-workbench)
    
    // ==========================================
    // 吉众统一化事件监听：大标题控制组、工具栏动作组与分段控件
    // ==========================================
    // 1. 大标题：重置本月
    $container.on("click", "#btn-qifu-reset-month", function(e) {
        e.preventDefault();
        const cur_m = $("#qifu-month-select").val() || current_month;
        const isLocked = Boolean(cached_workflow_status && cached_workflow_status.is_locked);
        if (isLocked) {
            frappe.msgprint("当前账期已封账锁定，禁止重置！");
            return;
        }
        frappe.confirm(
            `确定要重置【${cur_m}】的所有数据吗？\n\n此操作将清空本月已上传的车间外部实发表与关联测算数据，重置所有前置确认进度，但保留员工薪酬档案底册。`,
            function() {
                frappe.call({
                    method: 'ashan_cn_procurement.services.payroll_settlement_service.reset_qifu_month',
                    type: 'POST',
                    args: { company: COMPANY, period_month: cur_m },
                    callback: function(r) {
                        if (r.message && r.message.success) {
                            frappe.show_alert({ message: r.message.message, indicator: 'green' });
                            load_monthly_workflow_hub();
                            reload_current_tab();
                        }
                    }
                });
            }
        );
    });



    // 4. Tab 0: 导出发放表 & 打印
    $container.on("click", "#btn-salary-export-dist", function(e) {
        e.preventDefault();
        export_excel_action('distribution');
    });
    $container.on("click", "#btn-salary-print-dist", function(e) {
        e.preventDefault();
        print_modal_report(`【${COMPANY}】${current_month} 车间薪资发放表`, `核定计薪月份: ${current_month}`, "salary-data-table");
    });

    // 5. Tab 0: 实发范围分段控件
    $container.on("click", "#salary-main-scope-filter .jz-segment-btn", function(e) {
        e.preventDefault();
        $("#salary-main-scope-filter .jz-segment-btn").removeClass("active");
        $(this).addClass("active");
        salary_main_filter = $(this).attr("data-filter") || "all";
        render_salary_main_table();
    });

    // 6. Tab 0: 搜索输入框
    $container.on("input", "#salary-main-search-input", function() {
        salary_main_search = $(this).val();
        render_salary_main_table();
    });

    // 7. Tab 1: 统一员工档案编辑（单选编辑个人档案，多选批量办理离职或调整参数）
    $container.on("click", "#btn-qifu-batch-edit, #btn-qifu-adjust-param", function(e) {
        e.preventDefault();
        const isLocked = Boolean(cached_workflow_status && (cached_workflow_status.is_locked || (cached_workflow_status.task1_profile && cached_workflow_status.task1_profile.is_confirmed)));
        if (isLocked) {
            frappe.msgprint("本账期员工薪酬档案已确认（只读保护），如需编辑修改请先在右上角【取消确认】。");
            return;
        }
        const selected = [];
        $(".tab1-emp-check:checked").each(function() {
            selected.push({
                no: $(this).attr("data-emp-no"),
                name: $(this).attr("data-emp-name")
            });
        });
        if (selected.length === 0) {
            frappe.msgprint("请先在表格左侧勾选需要编辑修改的员工行（可单选直接编辑个人档案，多选可批量办理离职或调整参数）！");
            return;
        }
        if (selected.length === 1) {
            handle_qifu_emp_edit(null, selected[0].no);
        } else {
            open_unified_batch_edit_dialog(selected);
        }
    });

    // 8. Tab 1: 导出薪资信息表
    $container.on("click", "#btn-qifu-export-employees", function(e) {
        e.preventDefault();
        const exportRows = (employee_master_rows || []).filter(e => !e.is_resigned_prior && !e.is_future_hire);
        if (!exportRows || exportRows.length === 0){
            frappe.msgprint("暂无员工档案信息可导出！");
            return;
        }
        let csv = '\uFEFF序号,工号,姓名,身份证号,年龄,性别,用工性质,计薪方式,固定工资,基本工资,社保方式,社保基数,公积金方式,公积金基数,在职状态\n';
        exportRows.forEach((it, idx) => {
            const row = [
                idx + 1,
                `"${it.employee_no || ''}"`,
                `"${it.employee_name || ''}"`,
                `"${it.id_card || ''}"`,
                it.current_age != null ? `${it.current_age}岁` : '',
                `"${it.gender || ''}"`,
                `"${it.employee_type || '正式工'}"`,
                `"${normalize_salary_mode(it.salary_mode, it.fixed_salary, it.employee_type)}"`,
                it.fixed_salary || 0,
                it.base_salary || 0,
                `"${it.social_security_base_mode || ''}"`,
                it.social_security_base || 0,
                `"${it.housing_fund_base_mode || ''}"`,
                it.housing_fund_base || 0,
                `"${it.employment_status || '在职'}"`
            ];
            csv += row.join(',') + '\n';
        });
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${COMPANY}_${current_month}_员工薪资信息底册.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        frappe.show_alert({ message: '已成功导出员工薪资信息底册！', indicator: 'green' });
    });

    // 9. Tab 1: 人员范围分段控件
    $container.on("click", "#qifu-emp-type-filter .jz-segment-btn", function(e) {
        e.preventDefault();
        $("#qifu-emp-type-filter .jz-segment-btn").removeClass("active").attr("aria-pressed", "false");
        $(this).addClass("active").attr("aria-pressed", "true");
        render_employees_view(employee_master_rows);
    });

    // 10. Tab 1: 勾选计数联动
    $container.on("change", ".tab1-emp-check, #check-all-tab1-employees", function() {
        const count = $(".tab1-emp-check:checked").length;
        $("#qifu-selected-count").text(count);
    });

    // 11. Tab 1: 搜索输入框
    $container.on("input", "#qifu-emp-search", function() {
        render_employees_view(employee_master_rows);
    });

    // Tab 3: 社保分段筛选与搜索
    $container.on("input", "#tab3-search", function() {
        tab3_search_kw = $(this).val();
        render_social_insurance_table();
    });
    $container.on("click", "#tab3-emp-filter .jz-segment-btn", function() {
        $("#tab3-emp-filter .jz-segment-btn").removeClass("active").attr("aria-pressed", "false");
        $(this).addClass("active").attr("aria-pressed", "true");
        tab3_filter_type = $(this).data("type") || "all";
        render_social_insurance_table();
    });

    // Tab 4: 公积金分段筛选与搜索
    $container.on("input", "#tab4-search", function() {
        tab4_search_kw = $(this).val();
        render_housing_fund_table();
    });
    $container.on("click", "#tab4-emp-filter .jz-segment-btn", function() {
        $("#tab4-emp-filter .jz-segment-btn").removeClass("active").attr("aria-pressed", "false");
        $(this).addClass("active").attr("aria-pressed", "true");
        tab4_filter_type = $(this).data("type") || "all";
        render_housing_fund_table();
    });

    // Tab 5: 个税分段筛选与搜索
    $container.on("input", "#tab5-search", function() {
        tab5_search_kw = $(this).val();
        load_tax_settlement_tab();
    });
    $container.on("click", "#tab5-emp-filter .jz-segment-btn", function() {
        $("#tab5-emp-filter .jz-segment-btn").removeClass("active").attr("aria-pressed", "false");
        $(this).addClass("active").attr("aria-pressed", "true");
        tab5_filter_type = $(this).data("type") || "all";
        load_tax_settlement_tab();
    });

    // Tab 6: 综合结算分段筛选与搜索
    $container.on("input", "#tab6-search", function() {
        tab6_search_kw = $(this).val();
        render_payroll_view(cached_payroll_data || {});
    });
    $container.on("click", "#tab6-emp-filter .jz-segment-btn", function() {
        $("#tab6-emp-filter .jz-segment-btn").removeClass("active").attr("aria-pressed", "false");
        $(this).addClass("active").attr("aria-pressed", "true");
        tab6_filter_type = $(this).data("type") || "all";
        render_payroll_view(cached_payroll_data || {});
    });
$container.on("click", "#btn-qifu-confirm-salary-main", function(e) {
        e.preventDefault();
        const wf = cached_workflow_status;
        const isConfirmed = Boolean(wf && wf.task2_import && wf.task2_import.is_confirmed);
        const isPeriodLocked = Boolean(wf && wf.is_locked);

        if (isConfirmed) {
            if (isPeriodLocked) {
                frappe.msgprint("当前账期已整体封账锁定（只读受控）。如需修改实发表，请先在右上角申请反审核解锁。");
                return;
            }
            frappe.confirm(
                `确认取消【${current_month}】外部实发工资主表的核定状态吗？<br><br>取消核定后，将恢复实发表重新上传与删除权限。`,
                function() {
                    frappe.call({
                        method: 'ashan_cn_procurement.services.payroll_settlement_service.execute_monthly_settlement_lock',
                        type: 'POST',
                        args: {
                            company: COMPANY || "天津祺富机械加工有限公司",
                            period_month: current_month,
                            action: 'cancel_confirm_salary_main'
                        },
                        callback: function(r) {
                            if (r.message && r.message.success) {
                                frappe.show_alert({ message: r.message.message, indicator: 'green' });
                                load_monthly_workflow_hub();
                                load_salary_main_tab();
                            }
                        }
                    });
                }
            );
        } else {
            if (!salary_main_data || !salary_main_data.items || salary_main_data.items.length === 0) {
                frappe.msgprint("当前账期尚未导入外部车间实发表，无法执行核定！");
                return;
            }
            const hasUnmatched = $("#qifu-unmatched-banner").is(":visible");
            if (hasUnmatched) {
                frappe.msgprint("当前外部实发表存在未匹配到档案的员工，请先处理未匹配人员后再核定！");
                return;
            }
            frappe.confirm(
                `<strong>确认核定【${current_month}】外部实发工资主表吗？</strong><div class="ashan-callout ashan-callout--warning ashan-mt-2">核定后本月外部实发表将进入受控锁定状态，禁止误删或重复覆盖。如需修改，须先执行取消核定。</div>`,
                function() {
                    frappe.call({
                        method: 'ashan_cn_procurement.services.payroll_settlement_service.execute_monthly_settlement_lock',
                        type: 'POST',
                        args: {
                            company: COMPANY || "天津祺富机械加工有限公司",
                            period_month: current_month,
                            action: 'confirm_salary_main'
                        },
                        callback: function(r) {
                            if (r.message && r.message.success) {
                                frappe.show_alert({ message: r.message.message, indicator: 'green' });
                                load_monthly_workflow_hub();
                                load_salary_main_tab();
                            }
                        }
                    });
                }
            );
        }
    });

    $container.on("click", "#btn-qifu-confirm-employees", function(e) {
        e.preventDefault();
        const wf = cached_workflow_status;
        const isConfirmed = Boolean(wf && wf.task1_profile && wf.task1_profile.is_confirmed);
        const isPeriodLocked = Boolean(wf && wf.is_locked);

        if (isConfirmed) {
            if (isPeriodLocked) {
                frappe.msgprint("当前账期已整体封账锁定（只读受控）。如需修改员工档案，请先在右上角申请反审核解锁。");
                return;
            }
            const hasDownstream = Boolean(
                (wf && wf.task3_ss && wf.task3_ss.is_confirmed) ||
                (wf && wf.task4_hf && wf.task4_hf.is_confirmed)
            );
            const cascadeTip = hasDownstream
                ? "<br><br><div class='ashan-callout ashan-callout--info ashan-mt-2'><strong>自动级联提示：</strong>系统将同时自动取消已核定的【社会保险】与【住房公积金】状态，以便您修改档案后一并重新核定。</div>"
                : "";

            frappe.confirm(
                `确认取消【${current_month}】员工薪酬档案底册的核定状态吗？<br><br>取消核定后，员工档案将恢复为可编辑修改状态。${cascadeTip}`,
                function() {
                    frappe.call({
                        method: 'ashan_cn_procurement.services.payroll_settlement_service.execute_monthly_settlement_lock',
                        type: 'POST',
                        args: {
                            company: COMPANY || "天津祺富机械加工有限公司",
                            period_month: current_month,
                            action: 'cancel_confirm_employees'
                        },
                        freeze: true,
                        freeze_message: '正在取消员工档案核定...',
                        callback: function(r) {
                            if (r.message && r.message.success) {
                                frappe.show_alert({ message: r.message.message, indicator: 'green' });
                                load_monthly_workflow_hub(true);
                                load_qifu_employees();
                            } else if (r.message && !r.message.success) {
                                frappe.msgprint({ title: '操作失败', indicator: 'red', message: r.message.message });
                            }
                        }
                    });
                }
            );
            return;
        }

        // 严格以当前账期在册员工为准（自动排除往期已离职与未来入职人员，与前端展示与后端核定引擎完全一致）
        const rows = (employee_master_rows || []).filter(e => !e.is_resigned_prior && !e.is_future_hire);
        if (!rows.length) {
            frappe.msgprint("当前在册员工人数为 0，无法核定档案！");
            return;
        }

        const issues = [];
        rows.forEach(emp => {
            const h = employee_profile_health(emp);
            if (!h.complete) {
                issues.push(`• 工号 ${emp.employee_no || '-'} ｜ 姓名：${emp.employee_name || '-'} ｜ 缺失：${h.missing.join('、')}`);
            }
        });

        if (issues.length > 0) {
            const shown = issues.slice(0, 5).join('<br>');
            const more = issues.length > 5 ? `<br>另有 ${issues.length - 5} 人待完善，共 ${issues.length} 人信息不完整` : '';
            frappe.msgprint({
                title: '员工档案核验未通过，无法核定',
                indicator: 'orange',
                message: `<div class="ashan-dialog-body-text">检测到以下员工档案信息待完善：<br><br>${shown}${more}<br><br>请核对并完善上述员工信息后再进行核定！</div>`
            });
            return;
        }

        frappe.confirm(
            `确认【${current_month}】在册员工薪酬档案底册（共 ${rows.length} 人）吗？<br><br>核定后员工档案在当前账期内将受到<strong>只读受控保护</strong>，防止误改。`,
            function() {
                frappe.call({
                    method: 'ashan_cn_procurement.services.payroll_settlement_service.execute_monthly_settlement_lock',
                    type: 'POST',
                    args: {
                        company: COMPANY || "天津祺富机械加工有限公司",
                        period_month: current_month,
                        action: 'confirm_employees'
                    },
                    freeze: true,
                    freeze_message: '正在核定员工薪酬档案...',
                    callback: function(r) {
                        if (r.message && r.message.success) {
                            frappe.show_alert({ message: r.message.message, indicator: 'green' });
                            load_monthly_workflow_hub();
                            load_qifu_employees();
                        } else if (r.message && !r.message.success) {
                            frappe.msgprint({ title: '核定失败', indicator: 'red', message: r.message.message });
                        }
                    }
                });
            }
        );
    });

    $container.off("click", "#btn-qifu-employee-type-rules").on("click", "#btn-qifu-employee-type-rules", function(e) {
        e.preventDefault();
        open_qifu_employee_type_policy_dialog();
    });
    $container.on("click", "#btn-qifu-new-emp", function() {
        const isLocked = Boolean(cached_workflow_status && (cached_workflow_status.is_locked || (cached_workflow_status.task1_profile && cached_workflow_status.task1_profile.is_confirmed)));
        if (isLocked) {
            frappe.msgprint("本账期员工薪酬档案已确认并处于只读受控状态；如需修改，请先取消确认。");
            return;
        }
        open_emp_dialog(null);
    });

    // 员工档案修改 - 前提 1：只要没确认当前员工信息，则员工信息均可修改。修改有两种方式：1. 点击该员工行 2. 点击最右侧操作
    function handle_qifu_emp_edit(emp_id, emp_no, read_only = false) {
        const isLocked = Boolean(cached_workflow_status && (cached_workflow_status.is_locked || (cached_workflow_status.task1_profile && cached_workflow_status.task1_profile.is_confirmed)));
        if (isLocked && !read_only) {
            read_only = true;
        }
        const cached = (employee_master_rows || []).find(x => (emp_id && x.name === emp_id) || (emp_no && x.employee_no === emp_no));
        if (cached) {
            open_emp_dialog(cached, read_only);
        } else if (emp_id) {
            frappe.call({
                method: 'frappe.client.get',
                args: { doctype: 'Ashan Employee Salary Profile', name: emp_id },
                callback: function(r) {
                    if (r.message) open_emp_dialog(r.message, read_only);
                }
            });
        } else if (emp_no) {
            frappe.call({
                method: 'ashan_cn_procurement.services.employee_salary_service.get_employee_salary_profile',
                args: { company: COMPANY, employee_no: emp_no, period_month: current_month },
                callback: function(r) {
                    if (r.message) open_emp_dialog(r.message, read_only);
                }
            });
        }
    }

    // 方式 1：点击员工行交互
    // - 多选的时候（已有勾选员工），点击某一行不是编辑，而是选择/取消选择！
    // - 未多选时（0人勾选）：点击某一行弹出修改界面！
    $container.on("click", "#tbody-qifu-emp tr", function(e) {
        if ($(e.target).closest(".qifu-employee-actions, .btn-edit-emp, .btn-resign-emp, .btn-unresign-emp").length) return;
        if ($(e.target).is("input[type='checkbox']")) return;

        const $chk = $(this).find(".tab1-emp-check");
        const hasSelection = $("#tbody-qifu-emp .tab1-emp-check:checked").length > 0;

        // 如果当前处于多选模式（已有勾选员工），或者直接点击的是勾选列单元格：执行选择/取消选择
        if (hasSelection || $(e.target).closest(".qifu-col-check").length) {
            if ($chk.length) {
                $chk.prop("checked", !$chk.prop("checked")).trigger("change");
            }
            return;
        }

        // 未处于多选状态的普通模式下：点击整行弹出界面（已封账/锁定则自动调起查看）
        const isLocked = Boolean(cached_workflow_status && (cached_workflow_status.is_locked || (cached_workflow_status.task1_profile && cached_workflow_status.task1_profile.is_confirmed)));
        const emp_id = $(this).attr("data-id") || $(this).find(".btn-edit-emp, .btn-view-emp").attr("data-id");
        const emp_no = $(this).attr("data-emp-no") || $(this).find(".btn-edit-emp, .btn-view-emp").attr("data-emp-no");
        if (emp_id || emp_no) handle_qifu_emp_edit(emp_id, emp_no, isLocked);
    });

    $container.on("change", "#tbody-qifu-emp .tab1-emp-check", function(e) {
        e.stopPropagation();
        const isChecked = $(this).prop("checked");
        $(this).closest("tr").toggleClass("qifu-row-selected", isChecked);
    });

    // 方式 2：点击最右侧操作列“查看”或“修改”按钮
    $container.on("click", ".btn-view-emp", function(e) {
        e.stopPropagation();
        const emp_id = $(this).attr("data-id");
        const emp_no = $(this).attr("data-emp-no");
        handle_qifu_emp_edit(emp_id, emp_no, true);
    });

    $container.on("click", ".btn-edit-emp", function(e) {
        e.stopPropagation();
        const emp_id = $(this).attr("data-id");
        const emp_no = $(this).attr("data-emp-no");
        handle_qifu_emp_edit(emp_id, emp_no, false);
    });

    // 单人离职
    $container.on("click", ".btn-resign-emp", function() {
        const emp_no = $(this).attr("data-emp-no");
        const emp_name = $(this).attr("data-emp-name");
        open_resign_dialog(emp_no, emp_name);
    });

    // 撤销离职，恢复在职
    $container.on("click", ".btn-unresign-emp", function() {
        const emp_no = $(this).attr("data-emp-no");
        const emp_name = $(this).attr("data-emp-name");
        frappe.confirm(
            `<strong>【 恢复员工在职状态】</strong><br><br>
            员工：<strong>${emp_name} (${emp_no})</strong><br><br>
            确认撤销离职记录，恢复为正常在职员工吗？`,
            function() {
                frappe.call({
                    method: 'ashan_cn_procurement.services.employee_salary_service.cancel_employee_resignation',
                    type: 'POST',
                    args: { employee_no: emp_no, company: COMPANY, period_month: current_month },
                    callback: function(r) {
                        if (r.message && r.message.success) {
                            frappe.show_alert({ message: r.message.message, indicator: 'green' });
                            load_monthly_workflow_hub();
                            load_qifu_employees();
                            load_social_insurance_tab();
                            load_housing_fund_tab();
                        }
                    }
                });
            }
        );
    });

    // 全选/反选员工
    $container.on("change", "#check-all-tab1-employees", function() {
        const isChecked = $(this).prop("checked");
        $(".tab1-emp-check").prop("checked", isChecked);
    });

    // 批量办理离职
    $container.on("click", "#btn-batch-resign", function() {
        let selected = [];
        $(".tab1-emp-check:checked").each(function() {
            selected.push({
                no: $(this).attr("data-emp-no"),
                name: $(this).attr("data-emp-name")
            });
        });
        open_batch_resign_dialog(selected);
    });

    $container.on("click", "#btn-qifu-emp-reset-filter", function() {
        $('#qifu-emp-search').val('');
        if (window.AshanUI && window.AshanUI.setSegmentedValue) {
            window.AshanUI.setSegmentedValue('#qifu-emp-type-filter', 'all');
        } else {
            $('#qifu-emp-type-filter .jz-segment-btn').removeClass('active').attr('aria-pressed', 'false');
            $('#qifu-emp-type-filter .jz-segment-btn[data-type="all"]').addClass('active').attr('aria-pressed', 'true');
        }
        render_employees_view(employee_master_rows);
    });

    $container.on("click", ".btn-edit-contribution-base", function() {
        open_contribution_base_dialog(
            $(this).attr('data-kind'),
            $(this).attr('data-emp'),
            $(this).attr('data-name'),
            $(this).attr('data-value'),
            $(this).attr('data-base-mode')
        );
    });

    // 5. 公积金自动规则、长期策略与本月例外
    $container.on("click", "#btn-tab4-hf-auto-rule", function() { open_hf_auto_rule_dialog(); });
    $container.on("click", "#btn-tab4-hf-long-policy", function() { open_hf_long_policy_dialog(); });
    $container.on("click", "#btn-tab4-hf-monthly-override", function() { open_hf_monthly_override_dialog(); });
    $container.on("click", ".btn-hf-row-override", function() {
        open_hf_monthly_override_dialog($(this).attr('data-emp'), $(this).attr('data-name'), $(this).attr('data-mode'));
    });

    // 兼容旧版入口：社保批处理仍保留；公积金不再建议用批量清零模拟月份规则。
    $container.on("click", "#btn-qifu-ss-batch-min", function() {
        frappe.call({
            method: 'ashan_cn_procurement.services.employee_salary_service.get_insurance_setting',
            args: { company: COMPANY, year: current_month.split('-')[0] || 2026 },
            callback: function(settingResult) {
                const setting = settingResult.message || {};
                const minimum = fmtMoney(setting.ss_min_base || 0);
                frappe.confirm(
                    `<strong>【 全员绑定社保最低缴费基数】</strong><br><br>
                    当前年度最低基数：<strong>${minimum}</strong><br><br>
                    执行后，员工不再保存一份最低基数副本；今后只要在社保配置中调整最低基数，所有绑定员工都会自动联动。已经设为“自定义”的员工会切回最低基数。<br><br>
                    确认执行吗？`,
                    function() {
                        frappe.call({
                            method: 'ashan_cn_procurement.services.employee_salary_service.set_qifu_social_security_batch',
                            type: 'POST',
                            args: { mode: 'min', period_month: current_month, company: COMPANY },
                            callback: function(r) {
                                if (r.message && r.message.success) {
                                    frappe.msgprint({ title: ' 已完成绑定', indicator: 'green', message: r.message.message });
                                    load_qifu_employees();
                                    load_social_insurance_tab();
                                }
                            }
                        });
                    }
                );
            }
        });
    });

    // 6. Tab 2 外部文件上传与 24 列发放表交互 (统一使用 execute_qifu_salary_upload 核心引擎)
    let current_selected_file_b64 = null;
    let current_selected_file_name = null;

    $container.on("change", "#qifu-file-input-tab2", function(e) {
        const file = e.target.files[0];
        if (!file) return;
        current_selected_file_name = file.name;
        $("#qifu-filename-display-tab2").text(` 已选择: ${file.name}`);

        const reader = new FileReader();
        reader.onload = function(evt) {
            const raw_b64 = evt.target.result;
            current_selected_file_b64 = raw_b64;
            $("#qifu-import-preview-tab2").show();
            $("#btn-import-confirm-tab2").prop('disabled', true);
            $("#qifu-import-badge-tab2").html(
                `<div style="display:flex; align-items:center; justify-content:space-between;">
                    <span> 正在智能预检【<strong>${file.name}</strong>】...</span>
                 </div>`
            );

            frappe.call({
                method: 'ashan_cn_procurement.services.payroll_settlement_service.preview_import_excel_data',
                type: 'POST',
                args: {
                    file_name: current_selected_file_name,
                    file_base64: current_selected_file_b64,
                    period_month: $("#qifu-month-select").val() || current_month
                },
                callback: function(res) {
                    if (res.message && res.message.success) {
                        const m = res.message;
                        const compatibility = Number(m.compatibility_score || 0);
                        const unmatched = Number(m.unmatched_count || 0);
                        const fuzzy = Number(m.fuzzy_matched_count || 0);
                        const canImport = !!m.is_period_matched && unmatched === 0;
                        const diag = (m.diagnostics || []).length ? `<div style="margin-top:5px;color:#92400e;">${(m.diagnostics || []).join('；')}</div>` : '';
                        const unmatchedTip = unmatched > 0 ? `<div style="margin-top:5px;color:#b91c1c;font-weight:700;">未匹配员工 ${unmatched} 人：${(m.unmatched_names || []).slice(0,8).join('、')}。请先在员工母表补充姓名别名或建档。</div>` : '';
                        const periodTip = m.is_period_matched ? '' : `<div style="margin-top:5px;color:#b91c1c;font-weight:700;">${m.mismatch_message || '账期不匹配，请切换账期后重新预检。'}</div>`;
                        $("#qifu-import-badge-tab2").html(
                            `<div><strong>${canImport ? ' 预检通过' : ' 预检完成，暂不可导入'}</strong> · 账期 <strong>${m.detected_period_month || '-'}</strong> · 模板 <strong>${m.schema_version || 'generic-compatible'}</strong> · 兼容度 <strong>${compatibility}%</strong></div>
                             <div style="margin-top:4px;">源表人员 <strong>${m.employee_count}</strong> 人 · 母表匹配 <strong>${m.matched_count || 0}</strong> 人${fuzzy ? `（其中智能别名/一字差异 ${fuzzy} 人）` : ''} · 实发总盘 <strong>¥ ${Number(m.net_salary_total || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})}</strong></div>${periodTip}${unmatchedTip}${diag}`
                        );
                        $("#btn-import-confirm-tab2").prop('disabled', !canImport);
                    } else {
                        const err = (res.message && res.message.message) || '预检 Excel 文件失败，请检查文件格式！';
                        $("#qifu-import-badge-tab2").html(
                            `<span> 预检失败：${err}</span>`
                        );
                    }
                },
                error: function(res) {
                    let error_msg = '预检 Excel 文件时发生异常！';
                    if (res && res._server_messages) {
                        try {
                            const msgs = JSON.parse(res._server_messages);
                            error_msg = msgs.map(m => {
                                try { return JSON.parse(m).message; } catch(e) { return m; }
                            }).join('<br>');
                        } catch(e) {}
                    } else if (res && res.exc) {
                        error_msg = res.exc.split('\n').filter(Boolean).pop() || res.exc;
                    }
                    $("#qifu-import-badge-tab2").html(
                        `<span> 预检失败：${error_msg}</span>`
                    );
                }
            });
        };
        reader.onerror = function() {
            frappe.msgprint({
                title: ' 读取文件失败',
                indicator: 'red',
                message: `无法读取本地文件【${file.name}】，请检查文件是否被占用或损坏！`
            });
        };
        reader.readAsDataURL(file);
    });

    $container.on("click", "#btn-import-confirm-tab2", function() {
        if (!current_selected_file_b64) {
            frappe.msgprint({
                title: ' 未选择文件',
                indicator: 'orange',
                message: '文件尚未读取完成或未选择有效文件，请点击上方区域重新选择！'
            });
            return;
        }

        const $btn = $(this);
        $btn.prop('disabled', true).text(' 正在导入并核算...');
        const cur_m = $("#qifu-month-select").val() || current_month;

        execute_qifu_salary_upload(current_selected_file_b64, current_selected_file_name, cur_m, function(success) {
            $btn.prop('disabled', false).text(' 立即导入并融合核算 (生成24列薪资发放表)');
            if (success) {
                $("#qifu-import-preview-tab2").hide();
                current_selected_file_b64 = null;
                current_selected_file_name = null;
                $("#qifu-filename-display-tab2").text("点击或将车间实发 Excel 文件拖拽至此处上传");
                $("#qifu-file-input-tab2").val('');
            }
        });
    });

    $container.on("click", "#btn-import-cancel-tab2", function() {
        current_selected_file_b64 = null;
        current_selected_file_name = null;
        $("#qifu-filename-display-tab2").text("点击或将车间实发 Excel 文件拖拽至此处上传");
        $("#qifu-import-preview-tab2").hide();
        $("#qifu-file-input-tab2").val('');
    });

    $container.on("click", "#btn-tab2-export-dist", function() { export_excel_action("distribution"); });
    $container.on("click", "#btn-tab2-print-dist", function() {
        print_modal_report(`【${COMPANY}】${current_month} 薪资发放表`, `发薪所属账期: ${current_month}`, "table-tab2-dist-sheet");
    });

    // 7. 社保/公积金 Tab 导出、打印与配置修改
    $container.on("click", "#btn-tab3-more", function(e) {
        e.preventDefault();
        const $trigger = $(this);
        const $menu = $("#qifu-tab3-more-menu");
        const isOpen = $menu.hasClass("is-open");
        $menu.toggleClass("is-open", !isOpen);
        $trigger.attr("aria-expanded", String(!isOpen));
    });
    $container.on("click", function(e) {
        if (!$(e.target).closest(".qifu-more-actions").length) {
            $("#qifu-tab3-more-menu").removeClass("is-open");
            $("#btn-tab3-more").attr("aria-expanded", "false");
        }
    });
    $container.on("click", ".qifu-more-menu-item", function() {
        $("#qifu-tab3-more-menu").removeClass("is-open");
        $("#btn-tab3-more").attr("aria-expanded", "false");
    });
    $container.on("click", "#btn-tab3-confirm-ss", function(e) {
        e.preventDefault();
        const wf = cached_workflow_status;
        const p = wf && wf.task1_profile ? wf.task1_profile : {};
        const isProfileConfirmed = Boolean(p.is_confirmed);
        const task = wf && wf.task3_ss ? wf.task3_ss : {};
        const isConfirmed = Boolean(task.is_confirmed);
        const isPeriodLocked = Boolean(wf && wf.is_locked);
        const cur_m = $("#qifu-month-select").val() || current_month;

        if (isPeriodLocked) {
            frappe.msgprint("当前账期已整体封账锁定（只读受控）。如需修改社保，请先申请反审核解锁。");
            return;
        }

        if (isConfirmed) {
            frappe.confirm(
                `确认取消【${cur_m}】社会保险核定状态吗？<br><br>取消后可重新调整社保配置或重新上传申报表。`,
                function() {
                    frappe.call({
                        method: "ashan_cn_procurement.services.payroll_settlement_service.execute_monthly_settlement_lock",
                        type: "POST",
                        args: { company: COMPANY, period_month: cur_m, action: "cancel_confirm_social_insurance" },
                        callback: function(r) {
                            if (r.message && r.message.success) {
                                frappe.show_alert({ message: r.message.message, indicator: "green" });
                                load_monthly_workflow_hub();
                                load_social_insurance_tab();
                            }
                        }
                    });
                }
            );
            return;
        }

        // 前置依赖拦截：必须先核定员工档案
        if (!isProfileConfirmed) {
            frappe.msgprint({
                title: "前置依赖拦截",
                indicator: "orange",
                message: "<strong>尚未核定【员工薪酬档案】！</strong><br><br>底册人员名单与参保基数确定后，方可核定社会保险。请先前往【员工薪酬档案】页签点击【核定本表】。"
            });
            return;
        }

        if (task.status !== "verified") {
            frappe.msgprint("社会保险凭证尚未核验一致，无法核定！请先上传税局申报表并比对一致。");
            return;
        }

        frappe.confirm(
            `<strong>确认核定放行 ${cur_m} 对应的社会保险缴费明细吗？</strong><br><br>当前社保凭证所属期与系统核算金额均已核验一致。核定后将进入只读受控状态。`,
            function() {
                frappe.call({
                    method: "ashan_cn_procurement.services.payroll_settlement_service.execute_monthly_settlement_lock",
                    type: "POST",
                    args: { company: COMPANY, period_month: cur_m, action: "confirm_social_insurance" },
                    callback: function(r) {
                        if (r.message && r.message.success) {
                            frappe.show_alert({ message: r.message.message, indicator: "green" });
                            load_monthly_workflow_hub();
                            load_social_insurance_tab();
                        } else {
                            frappe.msgprint({ title: "社会保险核定未通过", indicator: "orange", message: (r.message && r.message.message) || "请刷新后重新核验当前账期。" });
                        }
                    }
                });
            }
        );
    });

    $container.on("click", "#btn-tab4-confirm-hf", function(e) {
        e.preventDefault();
        const wf = cached_workflow_status;
        const p = wf && wf.task1_profile ? wf.task1_profile : {};
        const isProfileConfirmed = Boolean(p.is_confirmed);
        const task = wf && wf.task4_hf ? wf.task4_hf : {};
        const isConfirmed = Boolean(task.is_confirmed);
        const isPeriodLocked = Boolean(wf && wf.is_locked);
        const cur_m = $("#qifu-month-select").val() || current_month;

        if (isPeriodLocked) {
            frappe.msgprint("当前账期已整体封账锁定（只读受控）。如需修改公积金，请先申请反审核解锁。");
            return;
        }

        if (isConfirmed) {
            frappe.confirm(
                `确认取消【${cur_m}】住房公积金核定状态吗？<br><br>取消后可重新上传公积金凭证或调整缴存配置。`,
                function() {
                    frappe.call({
                        method: "ashan_cn_procurement.services.payroll_settlement_service.execute_monthly_settlement_lock",
                        type: "POST",
                        args: { company: COMPANY, period_month: cur_m, action: "cancel_confirm_housing_fund" },
                        callback: function(r) {
                            if (r.message && r.message.success) {
                                frappe.show_alert({ message: r.message.message, indicator: "green" });
                                load_monthly_workflow_hub();
                                load_housing_fund_tab();
                            }
                        }
                    });
                }
            );
            return;
        }

        // 前置依赖拦截：必须先核定员工档案
        if (!isProfileConfirmed) {
            frappe.msgprint({
                title: "前置依赖拦截",
                indicator: "orange",
                message: "<strong>尚未核定【员工薪酬档案】！</strong><br><br>底册人员名单与公积金缴纳基数确定后，方可核定住房公积金。请先前往【员工薪酬档案】页签点击【核定本表】。"
            });
            return;
        }

        if (task.status !== "verified") {
            frappe.msgprint("住房公积金凭证尚未核验一致，无法核定！请先上传公积金凭证并比对一致。");
            return;
        }

        frappe.confirm(
            `<strong>确认核定放行 ${cur_m} 对应的住房公积金缴存明细吗？</strong><br><br>当前公积金凭证所属期与系统核算金额均已核验一致。核定后将进入只读受控状态。`,
            function() {
                frappe.call({
                    method: "ashan_cn_procurement.services.payroll_settlement_service.execute_monthly_settlement_lock",
                    type: "POST",
                    args: { company: COMPANY, period_month: cur_m, action: "confirm_housing_fund" },
                    callback: function(r) {
                        if (r.message && r.message.success) {
                            frappe.show_alert({ message: r.message.message, indicator: "green" });
                            load_monthly_workflow_hub();
                            load_housing_fund_tab();
                        } else {
                            frappe.msgprint({ title: "住房公积金核定未通过", indicator: "orange", message: (r.message && r.message.message) || "请刷新后重新核验当前账期。" });
                        }
                    }
                });
            }
        );
    });
    $container.on("click", "#btn-qifu-edit-ss-setting", function() { open_insurance_edit_dialog(); });
    $container.on("click", "#btn-qifu-edit-hf-setting", function() { open_hf_rate_base_dialog(); });
    $container.on("click", "#btn-qifu-edit-tax-setting", function() {
        open_tax_setting_dialog();
    });
    $container.on("click", "#btn-tab3-export-ss", function() { export_excel_action("insurance"); });
    $container.on("click", "#btn-tab3-print-ss", function() {
        print_modal_report(`【${COMPANY}】${format_payment_month_title(next_period(current_month))}社会保险缴费明细单`, `核定发薪账期: ${current_month} ｜ 实际缴费所属期: ${next_period(current_month)}`, "table-tab3-ss-sheet");
    });
    $container.on("click", "#btn-tab3-add-ss-adj", function() { open_add_insurance_adjustment_dialog(); });

    $container.on("click", "#btn-tab4-export-hf", function() { export_excel_action("housing_fund"); });
    $container.on("click", "#btn-tab4-export-hf-increase", function() { export_housing_fund_roster_change("increase"); });
    $container.on("click", "#btn-tab4-export-hf-seal", function() { export_housing_fund_roster_change("seal"); });
    $container.on("click", "#btn-tab4-print-hf", function() {
        print_modal_report(`【${COMPANY}】住房公积金缴存明细表`, `核定发薪账期: ${current_month}`, "table-tab4-hf-sheet");
    });

    // 8. Tab 5 个税操作

    // 动态视口自适应高度计算引擎 (固定上部，动态下部，彻底锁定滚动条在屏幕可见区)
    function sync_active_table_footer($box) {
        if (!$box || !$box.length) return;
        const table = $box.find("> table")[0];
        if (!table || !table.tBodies || !table.tBodies[0] || !table.tFoot || !table.tFoot.rows.length) return;
        const tbody = table.tBodies[0];
        $(tbody).find(".qifu-viewport-spacer-row").remove();
        const currentTableHeight = table.getBoundingClientRect().height;
        const boxClientHeight = $box[0].clientHeight;
        const missingHeight = Math.floor(boxClientHeight - currentTableHeight);
        if (missingHeight <= 1) return;

        const headerRow = table.tHead?.rows?.[table.tHead.rows.length - 1];
        const columnCount = headerRow ? Array.from(headerRow.cells).reduce((c, cell) => c + (cell.colSpan || 1), 0) : 1;
        const spacerRow = document.createElement("tr");
        spacerRow.className = "qifu-viewport-spacer-row";
        spacerRow.setAttribute("aria-hidden", "true");
        spacerRow.style.setProperty("--qifu-spacer-height", `${missingHeight}px`);
        const spacerCell = document.createElement("td");
        spacerCell.colSpan = columnCount;
        const spacerDiv = document.createElement("div");
        spacerDiv.className = "qifu-spacer-fill";
        spacerCell.appendChild(spacerDiv);
        spacerRow.appendChild(spacerCell);
        tbody.appendChild(spacerRow);
    }

    function adjust_active_table_height() {
        $(".qifu-tab-content:visible").each(function() {
            const $box = $(this).find(".qifu-table-box");
            if (!$box.length || !$box.is(':visible')) return;
            const topOffset = $box[0].getBoundingClientRect().top;
            const winH = window.innerHeight;
            const bottomMargin = 12;
            const availableH = winH - topOffset - bottomMargin;
            const finalH = Math.max(400, Math.floor(availableH));

            $box[0].dataset.qifuViewportFit = "1";
            $box[0].style.setProperty("--qifu-active-table-height", `${finalH}px`);
            $box.css({
                "height": finalH + "px",
                "max-height": finalH + "px",
                "overflow": "auto",
                "margin-bottom": "0px"
            });
            window.requestAnimationFrame(() => sync_active_table_footer($box));
        });
    }

    // 窗口尺寸变化与防抖自适应
    let resizeTimer = null;
    $(window).off("resize.qifu").on("resize.qifu", function() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(adjust_active_table_height, 100);
    });

    // 双向滚动条同步引擎 (顶部滑条 <-> 底部表格)
    function sync_dual_scrollbars($topWrapper, $tableBox) {
        if (!$topWrapper.length || !$tableBox.length) return;
        const $table = $tableBox.find("table");
        const scrollW = $table.length ? $table[0].scrollWidth : $tableBox[0].scrollWidth;
        $topWrapper.find(".qifu-top-scrollbar-dummy").css("width", scrollW + "px");

        let isSyncingTop = false;
        let isSyncingBottom = false;

        $topWrapper.off("scroll.sync").on("scroll.sync", function() {
            if (!isSyncingTop) {
                isSyncingBottom = true;
                $tableBox.scrollLeft($(this).scrollLeft());
            }
            isSyncingTop = false;
        });

        $tableBox.off("scroll.sync").on("scroll.sync", function() {
            if (!isSyncingBottom) {
                isSyncingTop = true;
                $topWrapper.scrollLeft($(this).scrollLeft());
            }
            isSyncingBottom = false;
        });
    }

    // 快捷横向滑动按钮
    $container.on("click", ".btn-qifu-scroll-left", function() {
        const targetSel = $(this).attr("data-target") || "#tab5-table-box";
        $(targetSel).stop().animate({ scrollLeft: 0 }, 300);
        $("#tab5-top-scrollbar").stop().animate({ scrollLeft: 0 }, 300);
    });

    $container.on("click", ".btn-qifu-scroll-right", function() {
        const targetSel = $(this).attr("data-target") || "#tab5-table-box";
        const $target = $(targetSel);
        const maxScroll = $target[0].scrollWidth || 3000;
        $target.stop().animate({ scrollLeft: maxScroll }, 400);
        $("#tab5-top-scrollbar").stop().animate({ scrollLeft: maxScroll }, 400);
    });

    // 表头横向滚轮穿透支持
    $container.on("wheel", ".qifu-table thead, .qifu-top-scrollbar-wrapper", function(e) {
        if (e.originalEvent.deltaY !== 0 && e.originalEvent.deltaX === 0) {
            e.preventDefault();
            const $box = $(this).closest(".qifu-tab-content").find(".qifu-table-box");
            $box.scrollLeft($box.scrollLeft() + e.originalEvent.deltaY);
        }
    });

    $container.on("click", ".btn-tax-view-mode", function() {
        $(".btn-tax-view-mode").removeClass("active").css({"background": "#fff", "color": "#334155", "border-color": "#cbd5e1"});
        $(this).addClass("active").css({"background": "#2563eb", "color": "#fff", "border-color": "#2563eb"});
        current_tax_view_mode = $(this).attr("data-mode");
        load_tax_settlement_tab();
    });

    $container.on("click", "#btn-tab5-export-tax", function() { export_excel_action("tax", { tax_view_mode: "full_68" }); });
    $container.on("click", "#btn-tab5-print-tax", function() {
        print_modal_report(`【${COMPANY}】个人所得税核定与申报明细表`, `核定发薪账期: ${current_month}`, "table-tab5-tax-sheet");
    });

    // 9. Tab 6 综合核定操作
    $container.on("click", "#btn-view-salary-dist", function() { open_salary_distribution_modal(); });
    $container.on("click", "#btn-view-acc-sheet", function() { open_accounting_sheet_modal(); });
    $container.on("click", "#card-acc-summary", function() { open_accounting_sheet_modal(); });
    $container.on("click", "#btn-view-ins-sheet-modal", function() { open_social_insurance_modal(); });
    $container.on("click", "#btn-view-hf-sheet-modal", function() { open_housing_fund_modal(); });
    $container.on("click", "#btn-view-tax-sheet-modal", function() { open_tax_modal(); });
    $container.on("click", "#btn-export-excel-both", function() { export_excel_action("all"); });
    $container.on("click", "#btn-export-accounting-xlsm", function() { export_excel_action("accounting_xlsm"); });

    // 全局委派模态框事件
    $(document).off("click", "#btn-modal-export-dist").on("click", "#btn-modal-export-dist", function() { export_excel_action("distribution"); });
    $(document).off("click", "#btn-modal-print-dist").on("click", "#btn-modal-print-dist", function() {
        print_modal_report(`【${COMPANY}】${current_month} 薪资发放表`, `所属发薪账期: ${current_month}`, "table-modal-dist-sheet");
    });
    $(document).off("click", "#btn-modal-export-acc").on("click", "#btn-modal-export-acc", function() { export_excel_action("accounting"); });
    $(document).off("click", "#btn-modal-print-acc").on("click", "#btn-modal-print-acc", function() {
        print_modal_report(`【${COMPANY}】${current_month} 记账工资表`, `所属发薪账期: ${current_month}`, "table-modal-acc-sheet");
    });
    $(document).off("click", "#btn-modal-export-ins").on("click", "#btn-modal-export-ins", function() { export_excel_action("insurance"); });
    $(document).off("click", "#btn-modal-print-ins").on("click", "#btn-modal-print-ins", function() {
        print_modal_report(`【${COMPANY}】社会保险缴费明细表`, `核定发薪账期: ${current_month}`, "table-modal-ins-sheet");
    });
    $(document).off("click", "#btn-modal-export-hf").on("click", "#btn-modal-export-hf", function() { export_excel_action("housing_fund"); });
    $(document).off("click", "#btn-modal-print-hf").on("click", "#btn-modal-print-hf", function() {
        print_modal_report(`【${COMPANY}】住房公积金缴存明细表`, `核定发薪账期: ${current_month}`, "table-modal-hf-sheet");
    });
    $(document).off("click", "#btn-modal-export-tax").on("click", "#btn-modal-export-tax", function() { export_excel_action("tax", { tax_view_mode: "full_68" }); });
    $(document).off("click", "#btn-modal-print-tax").on("click", "#btn-modal-print-tax", function() {
        print_modal_report(`【${COMPANY}】个人所得税核定明细表`, `核定发薪账期: ${current_month}`, "table-modal-tax-sheet");
    });
    $(document).off("click", "#btn-modal-add-ss-adj").on("click", "#btn-modal-add-ss-adj", function() {
        open_add_insurance_adjustment_dialog();
    });

    // 删除特殊补缴
    $(document).off("click", ".btn-del-ss-adj").on("click", ".btn-del-ss-adj", function() {
        const adj_id = $(this).attr("data-id");
        if (!adj_id) return;
        frappe.confirm("确认要删除这笔社保特殊补缴/滞纳金记录吗？", function() {
            frappe.call({
                method: 'ashan_cn_procurement.services.payroll_settlement_service.delete_social_insurance_adjustment',
                type: 'POST',
                args: { company: COMPANY, period_month: current_month, adj_id: adj_id },
                callback: function(r) {
                    if (r.message && r.message.success) {
                        frappe.show_alert({ message: r.message.message, indicator: 'green' });
                        load_social_insurance_tab();
                        load_tax_settlement_tab();
                        load_payroll_settlement();
                    }
                }
            });
        });
    });

    // 初始化：先从后端查询允许的最大核算账期，再初始化月份选择器与数据加载
    // 业务规则：7月未封账 → 最大可选 2026-07（8月灰色不可选）；7月封账后 → 最大可选 2026-08
    function init_workbench_with_billing_period() {
        frappe.call({
            method: "ashan_cn_procurement.ashan_cn_procurement.doctype.ashan_monthly_payroll_settlement.ashan_monthly_payroll_settlement.get_allowed_billing_period",
            args: { company: COMPANY },
            callback: function(r) {
                const data = r.message || {};
                const allowed_max = data.allowed_max || current_month;
                const default_period = data.default_period || current_month;
                const latest_closed = data.latest_closed;

                // 更新 current_month 为后端返回的合法默认账期
                current_month = default_period;
                current_history_period = current_month;

                // 设置月份选择器的 value 与 max（max 限制用户无法选择超过允许的最大账期）
                const $picker = $("#qifu-month-select");
                $picker.val(current_month);
                $picker.attr("max", allowed_max);

                // 更新账期文字显示
                $("#workflow-period-text").text(current_month);
                $("#qifu-payroll-period-text").text(current_month);
                $("#qifu-payment-period-text").text(next_period(current_month));
                if (current_month && current_month.includes("-")) {
                    const parts = current_month.split("-");
                    let y = parseInt(parts[0], 10);
                    let m = parseInt(parts[1], 10);
                    if (m === 12) { y += 1; m = 1; } else { m += 1; }
                    const m_str = m < 10 ? "0" + m : "" + m;
                    $("#workflow-ss-period-text").text(`${y}-${m_str} (${y}年${m_str}月)`);
                }

                // 在月份选择器旁显示锁定状态提示
                $("#qifu-period-lock-tip").remove();
                $picker.attr("title", (latest_closed ? `${latest_closed}已封账 · ` : "") + `当前可操作账期: ${allowed_max}`);
                $picker.attr("max", allowed_max);

                // 月份选择器变更时强制校验不超过 max
                $picker.off("input.lock_check").on("input.lock_check", function() {
                    const sel = $(this).val();
                    if (sel && sel > allowed_max) {
                        frappe.msgprint({
                            title: " 账期未解锁",
                            message: `<strong>${sel}</strong> 账期尚未解锁！<br><br>必须先完成并封账 <strong>${allowed_max}</strong> 账期后，下一个账期才会自动解锁。<br><br>当前最大可操作账期：<strong>${allowed_max}</strong>`,
                            indicator: "red"
                        });
                        $(this).val(allowed_max);
                        current_month = allowed_max;
                        current_history_period = current_month;
                        return false;
                    }
                });

                // 初始化数据加载
                wrapper.__qifu_initialized = true;
                load_qifu_employee_type_policies();
                $(".qifu-tab-content").removeClass("active").hide();
                $(`#qifu-tab-${current_tab}`).addClass("active").show();
                if (current_tab === "salary_main") {
                    load_salary_main_tab();
                } else if (current_tab === "employees") {
                    load_qifu_employees();
                }
                load_monthly_workflow_hub();
            },
            error: function() {
                console.warn("get_allowed_billing_period failed, falling back to default prev month");
                wrapper.__qifu_initialized = true;
                current_history_period = current_month;
                $(".qifu-tab-content").removeClass("active").hide();
                $(`#qifu-tab-${current_tab}`).addClass("active").show();
                if (current_tab === "salary_main") {
                    load_salary_main_tab();
                } else if (current_tab === "employees") {
                    load_qifu_employees();
                }
                load_monthly_workflow_hub();
            }
        });
    }

    function init_company_context() {
        const contextComp = window.AshanWorkContext?.getCompany?.() || "";
        if (contextComp && contextComp.includes("祺富")) {
            COMPANY = contextComp;
        } else {
            COMPANY = "天津祺富机械加工有限公司";
        }
        init_workbench_with_billing_period();
    }

    document.addEventListener("ashan-work-context-changed", function(e) {
        const newComp = e.detail?.company || "";
        if (newComp && newComp.includes("祺富") && newComp !== COMPANY) {
            COMPANY = newComp;
            init_workbench_with_billing_period();
        }
    });

    init_company_context();

    // 实时更新监听
    if (frappe.realtime && frappe.realtime.on) {
        frappe.realtime.on('ashan_payroll_recalc_update', function(payload) {
            if (!payload || payload.company !== COMPANY) return;
            if (payload.period_month && payload.period_month !== current_month) return;
            refresh_after_recalculation();
        });
    }

    function is_qifu_other_type(etype) {
        if (!etype) return false;
        if (cached_qifu_policies && cached_qifu_policies.length) {
            const p = cached_qifu_policies.find(x => x.employee_type === etype);
            if (p && typeof p.is_other !== 'undefined') {
                return Boolean(Number(p.is_other));
            }
        }
        const ins = (typeof cached_insurance_setting !== 'undefined' && cached_insurance_setting) ? cached_insurance_setting : null;
        const policies = (ins && ins.employee_type_policies) || [];
        const p2 = policies.find(x => x.employee_type === etype);
        if (p2 && typeof p2.is_other !== 'undefined') {
            return Boolean(Number(p2.is_other));
        }
        return ['其他-返聘工', '其他-正式工', '其他-外籍工', '其他-管理', '外籍工', '其他类型员工', '其他'].includes(etype);
    }

    let _qifu_policy_dialog_in_flight = false;
    function open_qifu_employee_type_policy_dialog() {
        if (_qifu_policy_dialog_in_flight) return;
        _qifu_policy_dialog_in_flight = true;
        setTimeout(() => { _qifu_policy_dialog_in_flight = false; }, 800);
        let currentDialog = null;

        const fetchAndRender = function() {
            frappe.call({
                method: "frappe.client.get_list",
                args: {
                    doctype: "Qifu Employee Type Policy",
                    filters: { company: COMPANY, is_active: 1 },
                    fields: ["name", "employee_type", "is_other", "participate_social_security", "participate_housing_fund", "participate_tax", "participate_payroll", "participate_workshop_roster", "participate_cash_bills"],
                    order_by: "name asc",
                    limit_page_length: 50
                },
                callback: function(r) {
                    const policies = r.message || [];
                    renderDialogWithPolicies(policies);
                }
            });
        };

        const renderDialogWithPolicies = function(policies) {
            if (currentDialog) {
                currentDialog.hide();
            }

            const rowsHtml = (policies || []).map(p => {
                const t = p.employee_type;
                const docname = p.name;
                return `
                    <tr data-docname="${escHtml(docname)}" data-type="${escHtml(t)}">
                        <td><strong>${escHtml(t)}</strong></td>
                        <td class="qifu-text-center"><input type="checkbox" class="qifu-chk-policy" data-name="${escHtml(docname)}" data-type="${escHtml(t)}" data-field="is_other" ${p.is_other ? "checked" : ""}></td>
                        <td class="qifu-text-center"><input type="checkbox" class="qifu-chk-policy" data-name="${escHtml(docname)}" data-type="${escHtml(t)}" data-field="participate_social_security" ${p.participate_social_security ? "checked" : ""}></td>
                        <td class="qifu-text-center"><input type="checkbox" class="qifu-chk-policy" data-name="${escHtml(docname)}" data-type="${escHtml(t)}" data-field="participate_housing_fund" ${p.participate_housing_fund ? "checked" : ""}></td>
                        <td class="qifu-text-center"><input type="checkbox" class="qifu-chk-policy" data-name="${escHtml(docname)}" data-type="${escHtml(t)}" data-field="participate_tax" ${p.participate_tax ? "checked" : ""}></td>
                        <td class="qifu-text-center"><input type="checkbox" class="qifu-chk-policy" data-name="${escHtml(docname)}" data-type="${escHtml(t)}" data-field="participate_payroll" ${p.participate_payroll ? "checked" : ""}></td>
                        <td class="qifu-text-center"><input type="checkbox" class="qifu-chk-policy" data-name="${escHtml(docname)}" data-type="${escHtml(t)}" data-field="participate_cash_bills" ${p.participate_cash_bills ? "checked" : ""}></td>
                        <td class="qifu-text-center">
                            <div class="ashan-policy-row-actions">
                                <button type="button" class="btn btn-default btn-xs btn-dialog-edit-row" data-name="${escHtml(docname)}" data-type="${escHtml(t)}">编辑</button>
                                <button type="button" class="btn btn-default btn-xs btn-dialog-delete-row" data-name="${escHtml(docname)}" data-type="${escHtml(t)}" >删除</button>
                            </div>
                        </td>
                    </tr>
                `;
            }).join("");

            const tableHtml = `
                <div class="qifu-policy-dialog-toolbar">
                    <div class="qifu-policy-dialog-toolbar-left">
                        <button type="button" class="btn btn-primary btn-sm btn-dialog-add-policy">+ 新建用工性质</button>
                        <button type="button" class="btn btn-default btn-sm btn-dialog-open-list">打开用工性质管理页面 ↗</button>
                    </div>
                    <span class="qifu-policy-dialog-company">公司主体：<strong>${escHtml(COMPANY)}</strong></span>
                </div>
                <div class="qifu-policy-matrix-table-wrap">
                <table class="qifu-table qifu-policy-matrix-table">
                    <colgroup>
                        <col class="col-w-policy-name">
                        <col class="col-w-policy-chk">
                        <col class="col-w-policy-chk">
                        <col class="col-w-policy-chk">
                        <col class="col-w-policy-chk">
                        <col class="col-w-policy-chk">
                        <col class="col-w-policy-chk">
                        <col class="col-w-policy-act">
                    </colgroup>
                    <thead>
                        <tr>
                            <th class="qifu-text-left">用工性质</th>
                            <th class="qifu-text-center">是否算作其它</th>
                            <th class="qifu-text-center">社会保险</th>
                            <th class="qifu-text-center">住房公积金</th>
                            <th class="qifu-text-center">个人所得税</th>
                            <th class="qifu-text-center">工资核定表</th>
                            <th class="qifu-text-center">现金发放表</th>
                            <th class="qifu-text-center col-w-action">操作</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml || "<tr><td colspan=\"8\" class=\"qifu-text-center\" >暂无用工性质规则，请点击上方按钮添加</td></tr>"}</tbody>
                </table>
                </div>
                <div class="qifu-policy-matrix-sub">
                    <strong>说明：</strong>打勾表示该用工性质人员参与对应模块的计算并写入该表中；【是否算作其它】勾选后计入“其他用工类型”。用工性质为单一纯净维度，保存后实时生效。
                </div>
            `;

            currentDialog = new frappe.ui.Dialog({
                title: "用工性质参与规则设置",
                size: "large",
                fields: [
                    { fieldtype: "HTML", fieldname: "matrix_html", options: tableHtml }
                ],
                primary_action_label: "保存修改",
                primary_action() {
                    const primaryBtn = currentDialog.get_primary_btn();
                    primaryBtn.prop("disabled", true);

                    const updatedPolicies = (policies || []).map(p => {
                        const t = p.employee_type;
                        const item = {
                            name: p.name,
                            employee_type: t,
                            category_group: t
                        };
                        ["is_other", "participate_social_security", "participate_housing_fund", "participate_tax", "participate_payroll", "participate_cash_bills"].forEach(fld => {
                            item[fld] = currentDialog.$wrapper.find(`.qifu-chk-policy[data-type="${t}"][data-field="${fld}"]`).prop("checked") ? 1 : 0;
                        });
                        return item;
                    });

                    frappe.call({
                        method: "ashan_cn_procurement.services.employee_salary_service.save_qifu_employee_type_policies",
                        args: {
                            company: COMPANY,
                            policies: updatedPolicies
                        },
                        callback: function(r) {
                            primaryBtn.prop("disabled", false);
                            if (r.exc) {
                                frappe.msgprint({
                                    title: __("保存失败"),
                                    message: String(r.exc),
                                    indicator: "red"
                                });
                            } else {
                                currentDialog.hide();
                                frappe.show_alert({ message: __("用工性质参与规则已成功保存并实时生效！"), indicator: "green" });
                                load_qifu_employee_type_policies(function() {
                                    load_qifu_employees(true);
                                });
                            }
                        },
                        error: function(err) {
                            primaryBtn.prop("disabled", false);
                            frappe.msgprint({
                                title: __("保存失败"),
                                message: String(err && err.message ? err.message : err),
                                indicator: "red"
                            });
                        }
                    });
                }
            });

            currentDialog.$wrapper.on("click", ".btn-dialog-add-policy", function(e) {
                e.preventDefault();
                if (currentDialog) currentDialog.hide();
                open_quick_policy_dialog_direct("Qifu Employee Type Policy", COMPANY, null, function() {
                    fetchAndRender();
                    load_qifu_employees(true);
                }, function onCancel() {
                    if (currentDialog) currentDialog.show();
                });
            });

            currentDialog.$wrapper.on("click", ".btn-dialog-open-list", function(e) {
                e.preventDefault();
                frappe.route_options = { company: COMPANY };
                frappe.set_route("List", "Qifu Employee Type Policy");
            });

            currentDialog.$wrapper.on("click", ".btn-dialog-edit-row", function(e) {
                e.preventDefault();
                const docname = $(this).attr("data-name");
                if (currentDialog) currentDialog.hide();
                open_quick_policy_dialog_direct("Qifu Employee Type Policy", COMPANY, docname, function() {
                    fetchAndRender();
                    load_qifu_employees(true);
                }, function onCancel() {
                    if (currentDialog) currentDialog.show();
                });
            });

            currentDialog.$wrapper.on("click", ".btn-dialog-delete-row", function(e) {
                e.preventDefault();
                const docname = $(this).attr("data-name");
                const empType = $(this).attr("data-type");
                frappe.confirm(`确定要彻底删除用工性质【${empType}】吗？此操作不可撤销。`, function() {
                    frappe.delete_doc("Qifu Employee Type Policy", docname, function() {
                        frappe.show_alert({ message: `已成功删除用工性质【${empType}】`, indicator: "green" });
                        fetchAndRender();
                        load_qifu_employees(true);
                    });
                });
            });

            currentDialog.$wrapper.addClass("qifu-policy-matrix-dialog");
            currentDialog.show();
        };

        const open_quick_policy_dialog_direct = function(doctype, comp, docname, onSuccess, onCancel) {
            const isEdit = Boolean(docname);
            const loadAndShow = function(existingDoc) {
                const doc = existingDoc || {
                    company: comp,
                    employee_type: "",
                    is_active: 1,
                    is_other: 0,
                    participate_tax: 1,
                    participate_social_security: 1,
                    participate_housing_fund: 1,
                    participate_payroll: 1,
                    participate_workshop_roster: 1,
                    participate_cash_bills: 1
                };

                const fields = [
                    {
                        fieldtype: "Data",
                        fieldname: "company",
                        label: __("公司主体"),
                        default: comp,
                        read_only: 1
                    },
                    {
                        fieldtype: "Data",
                        fieldname: "employee_type",
                        label: __("用工性质名称"),
                        reqd: 1,
                        default: doc.employee_type || "",
                        read_only: isEdit ? 1 : 0,
                        description: isEdit ? __("用工性质名称不可修改；如需改名请删除后新建。") : __("请直接输入用工性质名称，如：正式工、返聘工、临时工、学徒工等。")
                    },
                    { fieldtype: "Section Break", label: __("算薪与法定规则配置") },
                    { fieldtype: "Check", fieldname: "is_active", label: __("启用此用工性质"), default: doc.is_active ?? 1 },
                    { fieldtype: "Check", fieldname: "is_other", label: __("是否算作其它"), default: doc.is_other ?? 0 },
                    { fieldtype: "Column Break" },
                    { fieldtype: "Check", fieldname: "participate_tax", label: __("计入个税计算"), default: doc.participate_tax ?? 1 },
                    { fieldtype: "Check", fieldname: "participate_social_security", label: __("缴纳社会保险"), default: doc.participate_social_security ?? 1 },
                    { fieldtype: "Check", fieldname: "participate_housing_fund", label: __("缴纳住房公积金"), default: doc.participate_housing_fund ?? 1 },
                    { fieldtype: "Column Break" },
                    { fieldtype: "Check", fieldname: "participate_payroll", label: __("计入工资核定表"), default: doc.participate_payroll ?? 1 },
                    { fieldtype: "Check", fieldname: "participate_workshop_roster", label: __("计入车间实发表"), default: doc.participate_workshop_roster ?? 1 },
                    { fieldtype: "Check", fieldname: "participate_cash_bills", label: __("参与现金发放表"), default: doc.participate_cash_bills ?? 1 }
                ];

                const qd = new frappe.ui.Dialog({
                    title: isEdit ? __("编辑用工性质 - {0}", [doc.employee_type]) : __("新建用工性质"),
                    fields: fields,
                    primary_action_label: isEdit ? __("保存修改") : __("立即新建"),
                    primary_action: function(values) {
                        const empType = String(values.employee_type || "").trim();
                        if (!empType) {
                            frappe.msgprint(__("请输入用工性质名称！"));
                            return;
                        }
                        qd.get_primary_btn().prop("disabled", true);

                        if (isEdit) {
                            frappe.call({
                                method: "frappe.client.set_value",
                                args: { doctype: doctype, name: docname, fieldname: values },
                                callback: function(r) {
                                    qd.get_primary_btn().prop("disabled", false);
                                    if (!r.exc) {
                                        frappe.show_alert({ message: __("用工性质规则已更新"), indicator: "green" });
                                        qd.hide();
                                        if (typeof onSuccess === "function") onSuccess();
                                    }
                                },
                                error: function() { qd.get_primary_btn().prop("disabled", false); }
                            });
                        } else {
                            frappe.call({
                                method: "frappe.client.insert",
                                args: {
                                    doc: {
                                        doctype: doctype,
                                        company: comp,
                                        employee_type: empType,
                                        is_active: values.is_active ? 1 : 0,
                                        is_other: values.is_other ? 1 : 0,
                                        participate_tax: values.participate_tax ? 1 : 0,
                                        participate_social_security: values.participate_social_security ? 1 : 0,
                                        participate_housing_fund: values.participate_housing_fund ? 1 : 0,
                                        participate_payroll: values.participate_payroll ? 1 : 0,
                                        participate_workshop_roster: values.participate_workshop_roster ? 1 : 0,
                                        participate_cash_bills: values.participate_cash_bills ? 1 : 0
                                    }
                                },
                                callback: function(r) {
                                    qd.get_primary_btn().prop("disabled", false);
                                    if (!r.exc) {
                                        frappe.show_alert({ message: __("已成功添加用工性质【{0}】", [empType]), indicator: "green" });
                                        qd.hide();
                                        if (typeof onSuccess === "function") onSuccess();
                                    }
                                },
                                error: function() { qd.get_primary_btn().prop("disabled", false); }
                            });
                        }
                    }
                });
                qd.$wrapper.on("hidden.bs.modal", function() {
                    if (typeof onCancel === "function") {
                        onCancel();
                        onCancel = null;
                    }
                });
                qd.show();
            };

            if (isEdit) {
                frappe.call({
                    method: "frappe.client.get",
                    args: { doctype: doctype, name: docname },
                    callback: function(r) {
                        if (r.message) loadAndShow(r.message);
                    }
                });
            } else {
                loadAndShow(null);
            }
        };

        fetchAndRender();
    }
    wrapper.refresh_workbench = function() {
        if (!COMPANY) return;
        if (current_tab === "salary_main") load_salary_main_tab();
        else if (current_tab === "employees") load_qifu_employees();
        load_monthly_workflow_hub();
    };
};

frappe.pages['qifu-hr-salary-workbench'].on_page_show = function(wrapper) {
    if (wrapper && typeof wrapper.refresh_workbench === 'function' && wrapper.__qifu_initialized) {
        wrapper.refresh_workbench();
    }
};


// Fallback compatibility marker: frappe.ui.FileUploader
