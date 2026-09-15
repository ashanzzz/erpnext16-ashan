// ASHAN-UNIFIED-V2: completed-module refactor
// Copyright (c) 2026, Ashan CN Procurement
// 天津吉众科技有限公司 · 人事薪酬综合工作台
// 严格对齐《202606吉众人事综合.xlsm》与《员工考勤表-*.xlsx》规范，单层纯净表头与精确三列冻结体系

frappe.pages['jizhong-hr-salary-workbench'].on_page_load = function(wrapper) {
    if (wrapper.__jz_salary_workbench) {
        wrapper.__jz_salary_workbench.show();
        return;
    }

    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: '吉众人事薪酬工作台',
        single_column: true
    });

    const COMPANY = "天津吉众科技有限公司";
    // ASHAN-UNIFIED-V2: avoid a stale month flash before server init resolves.
    const initial_today = frappe.datetime?.get_today?.() || new Date().toISOString().slice(0, 10);
    const initial_date = new Date(initial_today);
    const previous_month = new Date(initial_date.getFullYear(), initial_date.getMonth() - 1, 1);
    let current_month = `${previous_month.getFullYear()}-${String(previous_month.getMonth() + 1).padStart(2, '0')}`;
    let current_tab = "employees";
    let payroll_filter_mode = "all"; // all | accounting | non_accounting
    let payroll_col_view = "summary"; // summary (20列精简财务) | detail (32列全要素工时分项)
    let can_configure_insurance = false;
    let jz_insurance_sheets_cache = null;

    const html = `
    <div class="jz-wb-wrapper ashan-domain-workbench ashan-jizhong-workbench">
        <!-- 顶部 Header -->
        <div class="jz-header">
            <div>
                <div class="jz-title">
                    <span>吉众人事薪酬工作台</span>
                    <span class="jz-title-badge">月度核定</span>
                </div>
                <div class="jz-subtitle">
                    管理员工档案、考勤、社保公积金、个税和现金发放；
                    核定账期 <strong id="jz-payroll-period-text">${current_month}</strong>，
                    实际缴费所属期 <strong id="jz-payment-period-text">${next_period(current_month)}</strong>
                </div>
            </div>
            <div class="jz-header-actions">
                <label class="jz-label-month">核定账期</label>
                <input type="month" id="jz-month-select" class="form-control jz-month-input" value="${current_month}">
                <button class="btn btn-default btn-sm" id="btn-jz-refresh-all">刷新数据</button>
            </div>
        </div>

        <!-- 月度人事薪酬核定全流程任务中枢 (与祺富工作台任务哲学完全一致) -->
        <div class="jz-workflow-hub">
            <div class="jz-workflow-header">
                <div class="jz-workflow-title-group">
                    <span class="jz-workflow-title">月度人事薪酬核定全流程任务中枢</span>
                    <span class="jz-workflow-period-badge">
                        核定账期 <span id="jz-workflow-period-text">${current_month.slice(0, 4)}年${current_month.slice(5, 7)}月</span>
                    </span>
                    <button class="btn btn-xs btn-default jz-btn-toggle-hub" id="btn-toggle-workflow-hub" title="折叠或展开核定流程">收起流程</button>
                </div>
                <div class="jz-workflow-status-badge" id="jz-workflow-status-container">
                    <span class="jz-status-pending" id="jz-workflow-overall-status">正在加载账期状态</span>
                </div>
            </div>
        <!-- 月度确认与核定步骤卡片 -->
            <div class="jz-workflow-steps" id="jz-workflow-steps-container">
                <!-- 动态由 load_workflow_status() 渲染 -->
            </div>
        </div>

        <!-- 7大业务 Tab 切换 (档案前置 -> 考勤打卡 -> 税费基数 -> 综合核算 -> 现金配钞 -> 历史归档) -->
        <div class="jz-nav-tabs">
            <button class="jz-tab-btn active" data-tab="employees">员工薪资档案</button>
            <button class="jz-tab-btn" data-tab="attendance">考勤与工时</button>
            <button class="jz-tab-btn" data-tab="insurance">社保公积金</button>
            <button class="jz-tab-btn" data-tab="tax">个人所得税</button>
            <button class="jz-tab-btn" data-tab="payroll">工资核定</button>
            <button class="jz-tab-btn" data-tab="cash_bills">现金发放</button>
            <button class="jz-tab-btn" data-tab="history">历史记录</button>
        </div>

        <!-- Tab 1: 员工薪资信息表 (对应 Excel [人员薪资信息] sheets) -->
        <div id="jz-tab-employees" class="jz-tab-content">
            <div class="jz-kpi-grid">
                <div class="jz-kpi-card">
                    <div class="jz-kpi-title">在册员工总数 / 状态</div>
                    <div class="jz-kpi-val" id="jz-emp-kpi-count">0 人</div>
                    <div class="jz-kpi-sub">基准底册: <span class="jz-text-success">已建立</span></div>
                </div>
                <div class="jz-kpi-card">
                    <div class="jz-kpi-title">基本工资总基数</div>
                    <div class="jz-kpi-val jz-text-info" id="jz-emp-kpi-base">¥ 0.00</div>
                    <div class="jz-kpi-sub">动态基本工资底册合计</div>
                </div>
                <div class="jz-kpi-card">
                    <div class="jz-kpi-title">岗位津贴与绩效总盘</div>
                    <div class="jz-kpi-val jz-text-primary" id="jz-emp-kpi-allowance">¥ 0.00</div>
                    <div class="jz-kpi-sub">津贴: <span id="jz-emp-kpi-post">¥ 0.00</span> | 绩效: <span id="jz-emp-kpi-perf">¥ 0.00</span></div>
                </div>
                <div class="jz-kpi-card">
                    <div class="jz-kpi-title">社保与公积金申报基数</div>
                    <div class="jz-kpi-val jz-text-success" id="jz-emp-kpi-ins">¥ 0.00</div>
                    <div class="jz-kpi-sub">社险基数: <span id="jz-emp-kpi-ss">¥ 0.00</span> | 公积金: <span id="jz-emp-kpi-hf">¥ 0.00</span></div>
                </div>
            </div>

            <div class="jz-toolbar jz-employee-toolbar">
                <div class="jz-toolbar-left">
                    <button class="btn btn-primary btn-sm jz-btn-blue" id="btn-jz-add-emp">新建员工薪酬档案</button>
                    <button class="btn btn-default btn-sm" id="btn-jz-export-employees">导出薪资信息表 (CSV)</button>
                    <button class="btn btn-default btn-sm jz-btn-stage-confirmation" data-step="employees" id="btn-jz-confirm-employees" disabled>确认员工薪资档案</button>
                    <div class="jz-filter-group">
                        <span class="jz-filter-label">人员范围</span>
                        <div class="jz-segmented-control" id="jz-emp-type-filter" role="group" aria-label="人员范围">
                            <button type="button" class="jz-segment-btn active" data-type="all" aria-pressed="true">全部人员</button>
                            <button type="button" class="jz-segment-btn" data-type="regular" aria-pressed="false">正式工</button>
                            <button type="button" class="jz-segment-btn" data-type="other" aria-pressed="false">其他</button>
                        </div>
                    </div>
                </div>
                <div class="jz-toolbar-right">
                    <label class="jz-filter-label" for="jz-emp-search">搜索</label>
                    <input type="text" class="form-control input-sm jz-search-input" id="jz-emp-search" aria-label="搜索员工薪资档案" placeholder="工号、姓名、证件号码或计薪方式">
                </div>
            </div>

            <div class="jz-table-box">
                <table class="jz-table jz-employee-table" id="table-jz-employees">
                    <colgroup>
                        <col class="jz-emp-col-seq">
                        <col class="jz-emp-col-no">
                        <col class="jz-emp-col-name">
                        <col class="jz-emp-col-id-card">
                        <col class="jz-emp-col-type">
                        <col class="jz-emp-col-salary-mode">
                        <col class="jz-emp-col-net-salary">
                        <col class="jz-emp-col-base-salary">
                        <col class="jz-emp-col-base-subsidy">
                        <col class="jz-emp-col-performance">
                        <col class="jz-emp-col-post">
                        <col class="jz-emp-col-meal">
                        <col class="jz-emp-col-social-security">
                        <col class="jz-emp-col-housing-fund">
                        <col class="jz-emp-col-deduction">
                        <col class="jz-emp-col-status">
                        <col class="jz-emp-col-action">
                    </colgroup>
                    <thead>
                        <tr>
                            <th class="jz-col-seq jz-col-sticky-1">序号</th>
                            <th class="jz-col-no jz-col-sticky-2">工号</th>
                            <th class="jz-col-name jz-col-sticky-3">姓名</th>
                            <th>证件号码</th>
                            <th>用工性质</th>
                            <th>计薪方式</th>
                            <th class="jz-text-right">实发约定净薪</th>
                            <th class="jz-text-right">基本工资</th>
                            <th class="jz-text-right">基本补贴</th>
                            <th class="jz-text-right">绩效奖金</th>
                            <th class="jz-text-right">职位津贴</th>
                            <th class="jz-text-right">餐补单价</th>
                            <th class="jz-text-right">社险基数</th>
                            <th class="jz-text-right">公积金基数 / 长期策略</th>
                            <th class="jz-text-right">专项附加扣除</th>
                            <th class="jz-text-center">在职状态</th>
                            <th class="jz-col-action">操作</th>
                        </tr>
                    </thead>
                    <tbody id="tbody-jz-employees">
                        <tr><td colspan="17" class="jz-empty-cell">正在加载员工薪资信息档案...</td></tr>
                    </tbody>
                    <tfoot id="tfoot-jz-employees"></tfoot>
                </table>
            </div>
        </div>

        <!-- Tab 2: 考勤工时与打卡底册 (对应 Excel [考勤表] sheets) -->
        <div id="jz-tab-attendance" class="jz-tab-content jz-hidden">
            <div class="jz-kpi-grid">
                <div class="jz-kpi-card">
                    <div class="jz-kpi-title">考勤总人次 / 状态</div>
                    <div class="jz-kpi-val" id="jz-att-kpi-count">0 人</div>
                    <div class="jz-kpi-sub" id="jz-att-coverage">应计薪 0 人，已匹配 0 人</div>
                    <div class="jz-kpi-sub" id="jz-att-file-status">原始凭证：未上传</div>
                </div>
                <div class="jz-kpi-card">
                    <div class="jz-kpi-title">基本正班总工时</div>
                    <div class="jz-kpi-val jz-text-info" id="jz-att-kpi-reg">0.0 h</div>
                    <div class="jz-kpi-sub">倒休抵扣工时: <span id="jz-att-kpi-comp">0.0 h</span></div>
                </div>
                <div class="jz-kpi-card">
                    <div class="jz-kpi-title">各倍率加班总工时</div>
                    <div class="jz-kpi-val jz-text-primary" id="jz-att-kpi-ot">0.0 h</div>
                    <div class="jz-kpi-sub">1.5x平日: <span id="jz-att-kpi-ot15">0.0 h</span> | 2.0x周末: <span id="jz-att-kpi-ot20">0.0 h</span> | 3.0x节假日: <span id="jz-att-kpi-ot30">0.0 h</span></div>
                </div>
                <div class="jz-kpi-card">
                    <div class="jz-kpi-title">订餐补贴总次数</div>
                    <div class="jz-kpi-val jz-text-success" id="jz-att-kpi-meals">0 次</div>
                    <div class="jz-kpi-sub">单价：¥ 15.00 / 份</div>
                </div>
            </div>

            <!-- 考勤工时与底册操作栏 -->
            <div class="jz-toolbar">
                <div class="jz-toolbar-left">
                    <button class="btn btn-primary btn-sm jz-btn-blue" id="btn-jz-upload-attendance">上传月度考勤 (Excel)</button>
                    <button class="btn btn-default btn-sm jz-btn-danger-outline" id="btn-jz-clear-attendance">一键清空本月考勤</button>
                    <button class="btn btn-default btn-sm jz-btn-stage-confirmation" data-step="attendance" id="btn-jz-confirm-attendance" disabled>确认考勤与工时</button>
                    <button class="btn btn-default btn-sm jz-text-primary" id="btn-jz-sync-calc-payroll">按考勤一键核算当月工资</button>
                    <button class="btn btn-default btn-sm jz-hidden" id="btn-jz-download-attendance-file">下载原始考勤凭证</button>
                    <button class="btn btn-default btn-sm" id="btn-jz-work-hours-help" title="查看正班、加班、倒休和计时倍率的计算口径">工时口径说明</button>

                    <!-- 双视角原位分段控件 -->
                    <div class="jz-segmented-control" id="jz-att-view-mode">
                        <button class="jz-segment-btn active" data-mode="raw">原始打卡底册矩阵</button>
                        <button class="jz-segment-btn" data-mode="summary">工时分类结算汇总</button>
                    </div>
                </div>
                <div class="jz-toolbar-right">
                    <!-- 原始矩阵维度的过滤分段控件 -->
                    <div class="jz-segmented-control" id="jz-raw-filter-metric">
                        <button class="jz-segment-btn active" data-metric="all">全部5行维度</button>
                        <button class="jz-segment-btn" data-metric="shifts">仅班次</button>
                        <button class="jz-segment-btn" data-metric="work">仅作业工时</button>
                        <button class="jz-segment-btn" data-metric="ot">仅加班工时</button>
                        <button class="jz-segment-btn" data-metric="meal">仅订餐</button>
                        <button class="jz-segment-btn" data-metric="remark">仅备注</button>
                    </div>
                    <button class="btn btn-default btn-sm" id="btn-jz-export-raw-attendance">导出打卡底册 (CSV)</button>
                    <button class="btn btn-default btn-sm jz-hidden" id="btn-jz-export-summary-attendance">导出结算汇总 (CSV)</button>
                </div>
            </div>

            <!-- 视图 1: 原始打卡底册矩阵大宽表 (以原始数据为准，默认首选) -->
            <div class="jz-table-box jz-raw-table-box" id="box-jz-view-raw">
                <table class="jz-table jz-raw-matrix-table" id="table-jz-raw-attendance">
                    <thead id="thead-jz-raw-attendance"></thead>
                    <tbody id="tbody-jz-raw-attendance">
                        <tr><td class="jz-empty-cell">正在加载吉众原始考勤打卡底册矩阵...</td></tr>
                    </tbody>
                </table>
            </div>

            <!-- 视图 2: 工时分类结算汇总表 (纯净财务核算单行表，彻底消除虚构列) -->
            <div class="jz-table-box jz-hidden" id="box-jz-view-summary">
                <table class="jz-table" id="table-jz-attendance">
                    <thead>
                        <tr>
                            <th class="jz-col-seq">序号</th>
                            <th class="jz-col-no">工号</th>
                            <th class="jz-col-name">姓名</th>
                            <th class="jz-text-center">出勤天数</th>
                            <th class="jz-text-right" title="平日实际作业工时，加上周末加班用于冲抵平日缺勤的倒休工时">出勤正班工时</th>
                            <th class="jz-text-right" title="正常工作日每天先计 8 小时正班；超过 8 小时的部分，以及文件中的平日加班，按 1.5 倍归集">平日加班 (1.5x)</th>
                            <th class="jz-text-right" title="周末或调休放假日发生的作业工时和加班工时，按 2 倍归集；优先用于倒休冲抵">周末加班 (2.0x)</th>
                            <th class="jz-text-right" title="法定节假日发生的作业工时和加班工时，按 3 倍归集，不参与倒休冲抵">节日加班 (3.0x)</th>
                            <th class="jz-text-right">加班工时合计</th>
                            <th class="jz-text-right" title="周末 2 倍工时抵扣平日不足 8 小时的缺口，法定节假日工时不得抵扣">倒休冲抵工时</th>
                            <th class="jz-text-right">实际计薪加班</th>
                            <th class="jz-text-right">订餐补贴次数</th>
                            <th>打卡备注与请假汇总</th>
                        </tr>
                    </thead>
                    <tbody id="tbody-jz-attendance">
                        <tr><td colspan="13" class="jz-empty-cell">正在加载考勤工时结算汇总...</td></tr>
                    </tbody>
                    <tfoot id="tfoot-jz-attendance"></tfoot>
                </table>
            </div>
        </div>

        <!-- Tab 3: 社保公积金配置 (对应 Excel [本月社会保险] / [本月住房公积金] sheets) -->
        <div id="jz-tab-insurance" class="jz-tab-content jz-hidden">
            <div class="jz-toolbar">
                <div class="jz-toolbar-left">
                    <button class="btn btn-primary btn-sm jz-btn-orange jz-hidden" id="btn-jz-edit-insurance">修改吉众社保公积金费率</button>
                    <button class="btn btn-default btn-sm" id="btn-jz-open-insurance-form">在原生表单中查看</button>
                    <button class="btn btn-default btn-sm jz-btn-stage-confirmation" data-step="insurance" id="btn-jz-confirm-insurance" disabled>确认社保公积金</button>
                </div>
                <div class="jz-toolbar-right">
                    <span class="jz-tip-text" id="jz-ins-docname-tip">配置对象：天津吉众科技有限公司-2026</span>
                </div>
            </div>
            <div class="jz-config-box">
                <h4 class="jz-config-title">天津吉众科技有限公司 · 专属社保公积金标准</h4>
                <div class="jz-config-grid" id="jz-ins-grid">
                    <div><strong>工伤保险单位费率:</strong> <span id="jz-ins-injury">0.55%</span></div>
                    <div><strong>养老保险比例:</strong> 个人 <span id="jz-ins-pension-p">8.00%</span> / 单位 <span id="jz-ins-pension-c">16.00%</span></div>
                    <div><strong>医疗保险比例:</strong> 个人 <span id="jz-ins-medical-p">2.00%</span> / 单位 <span id="jz-ins-medical-c">10.00%</span></div>
                    <div><strong>失业保险比例:</strong> 个人 <span id="jz-ins-unemp-p">0.50%</span> / 单位 <span id="jz-ins-unemp-c">0.50%</span></div>
                    <div><strong>单位其他医疗比例:</strong> <span id="jz-ins-maternity">0.50%</span></div>
                    <div><strong>住房公积金比例:</strong> 个人 <span id="jz-ins-hf-p">5.00%</span> / 单位 <span id="jz-ins-hf-c">5.00%</span></div>
                    <div><strong>大额医疗救助</strong> <span id="jz-ins-big-medical">按实际缴费所属期计算</span></div>
                    <div><strong>社保最低基数:</strong> <span id="jz-ins-ss-min-base">待配置</span></div>
                    <div><strong>公积金最低基数:</strong> <span id="jz-ins-hf-min-base">待配置</span></div>
                    <div><strong>公积金自动缴费:</strong> <span id="jz-ins-hf-auto-rule">按配置月份执行</span></div>
                    <div><strong>个税累计周期:</strong> <span id="jz-ins-tax-cycle">起始月 12 月</span></div>
                    <div><strong>个税基本减除费用</strong> <span id="jz-ins-tax-threshold">¥ 5,000.00 / 月</span></div>
                    <div><strong>实际缴费所属期</strong> <span id="jz-ins-payment-period">核定账期次月</span></div>
                    <div><strong>配置来源</strong> <span id="jz-ins-config-source">正在读取</span></div>
                </div>
            </div>
            <div class="jz-insurance-sheet-toolbar">
                <div>
                    <h4 class="jz-config-title">社保、公积金确认表</h4>
                    <p class="jz-tip-text" id="jz-ins-sheet-status">员工档案和社保公积金配置确认后生成，核定账期使用当前月，实际缴费所属期使用次月。</p>
                </div>
                <div class="jz-toolbar-left">
                    <button class="btn btn-default btn-sm" id="btn-jz-generate-insurance-sheets" disabled>生成确认表</button>
                    <button class="btn btn-default btn-sm" id="btn-jz-print-social-insurance" disabled>打印社保确认表</button>
                    <button class="btn btn-default btn-sm" id="btn-jz-print-housing-fund" disabled>打印公积金确认表</button>
                </div>
            </div>
            <section class="jz-insurance-sheet-panel" aria-labelledby="jz-social-sheet-title">
                <div class="jz-sheet-heading">
                    <h5 id="jz-social-sheet-title">社会保险确认表</h5>
                    <span class="jz-sheet-meta" id="jz-social-sheet-meta">等待确认</span>
                </div>
                <div class="jz-table-box jz-insurance-table-box">
                    <table class="jz-table jz-insurance-table" id="table-jz-social-insurance">
                        <thead>
                            <tr>
                                <th class="jz-col-seq">序号</th>
                                <th class="jz-col-no">工号</th>
                                <th class="jz-col-name">姓名</th>
                                <th>用工性质</th>
                                 <th>申报基数方式</th>
                                 <th class="jz-text-right">申报基数</th>
                                <th class="jz-text-right">个人养老</th>
                                <th class="jz-text-right">个人医疗</th>
                                <th class="jz-text-right">个人失业</th>
                                <th class="jz-text-right">大额医疗</th>
                                <th class="jz-text-right">个人合计</th>
                                <th class="jz-text-right">单位合计</th>
                                <th class="jz-text-center">参保状态</th>
                            </tr>
                        </thead>
                        <tbody id="tbody-jz-social-insurance">
                             <tr><td colspan="13" class="jz-empty-cell">确认员工档案和社保公积金配置后生成。</td></tr>
                        </tbody>
                        <tfoot id="tfoot-jz-social-insurance"></tfoot>
                    </table>
                </div>
            </section>
            <section class="jz-insurance-sheet-panel" aria-labelledby="jz-housing-sheet-title">
                <div class="jz-sheet-heading">
                    <h5 id="jz-housing-sheet-title">住房公积金确认表</h5>
                    <span class="jz-sheet-meta" id="jz-housing-sheet-meta">等待确认</span>
                </div>
                <div class="jz-table-box jz-insurance-table-box">
                    <table class="jz-table jz-insurance-table" id="table-jz-housing-fund">
                        <thead>
                            <tr>
                                <th class="jz-col-seq">序号</th>
                                <th class="jz-col-no">工号</th>
                                <th class="jz-col-name">姓名</th>
                                <th>申报基数方式</th>
                                <th class="jz-text-right">有效基数</th>
                                <th class="jz-text-right">个人比例</th>
                                <th class="jz-text-right">个人金额</th>
                                <th class="jz-text-right">单位比例</th>
                                <th class="jz-text-right">单位金额</th>
                                <th>缴费状态</th>
                                <th>长期策略 / 本月规则</th>
                                <th>实际缴费所属期</th>
                            </tr>
                        </thead>
                        <tbody id="tbody-jz-housing-fund">
                            <tr><td colspan="12" class="jz-empty-cell">确认员工档案和社保公积金配置后生成。</td></tr>
                        </tbody>
                        <tfoot id="tfoot-jz-housing-fund"></tfoot>
                    </table>
                </div>
            </section>
        </div>

        <!-- Tab 4: 个人所得税台账 (对应 Excel [本月个人所得税] sheets) -->
        <div id="jz-tab-tax" class="jz-tab-content jz-hidden">
            <div class="jz-toolbar">
                <div class="jz-toolbar-left">
                    <span class="jz-tip-text">累计预扣法，基本减除费用与专项附加扣除按本月配置计算</span>
                    <button class="btn btn-default btn-sm jz-btn-stage-confirmation" data-step="tax" id="btn-jz-confirm-tax" disabled>确认个人所得税台账</button>
                </div>
                <div class="jz-toolbar-right">
                    <button class="btn btn-default btn-sm" id="btn-jz-export-tax">导出个税台账 (CSV)</button>
                </div>
            </div>
            <div class="jz-table-box">
                <table class="jz-table" id="table-jz-tax">
                    <thead>
                        <tr>
                            <th class="jz-col-seq">序号</th>
                            <th class="jz-col-no">工号</th>
                            <th class="jz-col-name">姓名</th>
                            <th>计薪方式</th>
                            <th class="jz-text-right">应发薪资</th>
                            <th class="jz-text-right">免征额</th>
                            <th class="jz-text-right">社保个人合计</th>
                            <th class="jz-text-right">公积金个人</th>
                            <th class="jz-text-right">专项附加扣除</th>
                            <th class="jz-text-right">当月预扣个税</th>
                            <th class="jz-text-right">实发工资</th>
                        </tr>
                    </thead>
                    <tbody id="tbody-jz-tax"></tbody>
                </table>
            </div>
        </div>

        <!-- Tab 5: 月度工资核定表 (最后工资表 / 对应 Excel [本月工资核定表] sheets) -->
        <div id="jz-tab-payroll" class="jz-tab-content jz-hidden">
            <div class="jz-kpi-grid">
                <div class="jz-kpi-card">
                    <div class="jz-kpi-title">核定状态 / 人数</div>
                    <div class="jz-kpi-val" id="jz-kpi-status"><span class="jz-status-badge jz-status-draft">草稿 / 可测算</span></div>
                <div class="jz-kpi-sub">在职计薪人员：<strong id="jz-kpi-count">0</strong> 人</div>
                </div>
                <div class="jz-kpi-card">
                    <div class="jz-kpi-title">实发工资总额</div>
                    <div class="jz-kpi-val jz-text-primary" id="jz-kpi-net">¥ 0.00</div>
                    <div class="jz-kpi-sub">应发总额: <span id="jz-kpi-gross">¥ 0.00</span></div>
                </div>
                <div class="jz-kpi-card">
                    <div class="jz-kpi-title">代扣税费 (个人部分)</div>
                    <div class="jz-kpi-val jz-text-warn" id="jz-kpi-person-ded">¥ 0.00</div>
                    <div class="jz-kpi-sub">社保个人: <span id="jz-kpi-ss-pers">¥ 0.00</span> | 公积金: <span id="jz-kpi-hf-pers">¥ 0.00</span> | 个税: <span id="jz-kpi-tax">¥ 0.00</span></div>
                </div>
                <div class="jz-kpi-card">
                    <div class="jz-kpi-title">单位统筹成本</div>
                    <div class="jz-kpi-val jz-text-success" id="jz-kpi-comp-cost">¥ 0.00</div>
                    <div class="jz-kpi-sub">单位社保: <span id="jz-kpi-ss-comp">¥ 0.00</span> | 单位公积金: <span id="jz-kpi-hf-comp">¥ 0.00</span></div>
                </div>
            </div>

            <div class="jz-toolbar">
                <div class="jz-toolbar-left">
                    <div class="jz-filter-group">
                        <span class="jz-filter-label">人员范围</span>
                        <div class="jz-segmented-control" id="jz-payroll-person-filter" role="group" aria-label="人员范围">
                            <button type="button" class="jz-segment-btn active" data-mode="all" aria-pressed="true">全部人员</button>
                            <button type="button" class="jz-segment-btn" data-mode="regular" aria-pressed="false">正式工</button>
                            <button type="button" class="jz-segment-btn" data-mode="other" aria-pressed="false">其他</button>
                        </div>
                    </div>

                    <div class="jz-filter-group">
                        <span class="jz-filter-label">表格视图</span>
                        <div class="jz-segmented-control" id="jz-payroll-col-toggle" role="group" aria-label="表格视图">
                            <button type="button" class="jz-segment-btn active" data-view="summary" aria-pressed="true">精简财务视图</button>
                            <button type="button" class="jz-segment-btn" data-view="detail" aria-pressed="false">全要素工时分项</button>
                        </div>
                    </div>

                    <button class="btn btn-primary btn-sm jz-btn-orange" id="btn-jz-calc-payroll">一键重新计算全员薪酬</button>
                    <button class="btn btn-success btn-sm jz-btn-green" id="btn-jz-lock-payroll">核定锁定 (只读封账)</button>
                    <button class="btn btn-default btn-sm jz-btn-red jz-hidden" id="btn-jz-unlock-payroll">申请反审核解锁</button>
                </div>
                <div class="jz-toolbar-right">
                    <button class="btn btn-default btn-sm" id="btn-jz-export-payroll">导出最后工资表 (CSV)</button>
                </div>
            </div>

            <div class="jz-table-box">
                <table class="jz-table" id="table-jz-payroll">
                    <thead id="thead-jz-payroll"></thead>
                    <tbody id="tbody-jz-payroll">
                        <tr><td colspan="20" class="jz-empty-cell">正在加载吉众薪酬数据...</td></tr>
                    </tbody>
                    <tfoot id="tfoot-jz-payroll"></tfoot>
                </table>
            </div>
        </div>

        <!-- Tab 6: 现金发放与配钞点钞 (对应 Excel [工资条-A4] / [工资条-信封] sheets) -->
        <div id="jz-tab-cash_bills" class="jz-tab-content jz-hidden">
            <div class="jz-cash-stat-bar" id="jz-cash-summary-bar">
                <div class="jz-cash-stat-item"><span class="jz-cash-denom-label">现金总盘：</span> <span class="jz-cash-denom-count" id="stat-cash-total">¥ 0.00</span></div>
                <div class="jz-cash-stat-item"><span class="jz-cash-denom-label">100元券:</span> <span class="jz-cash-denom-count" id="stat-b100">0 张</span></div>
                <div class="jz-cash-stat-item"><span class="jz-cash-denom-label">50元券:</span> <span class="jz-cash-denom-count" id="stat-b50">0 张</span></div>
                <div class="jz-cash-stat-item"><span class="jz-cash-denom-label">10元券:</span> <span class="jz-cash-denom-count" id="stat-b10">0 张</span></div>
                <div class="jz-cash-stat-item"><span class="jz-cash-denom-label">5元券:</span> <span class="jz-cash-denom-count" id="stat-b5">0 张</span></div>
                <div class="jz-cash-stat-item"><span class="jz-cash-denom-label">1元券:</span> <span class="jz-cash-denom-count" id="stat-b1">0 张</span></div>
            </div>

            <div class="jz-toolbar">
                <div class="jz-toolbar-left">
                    <button class="btn btn-default btn-sm" id="btn-jz-print-a4-slips">打印 A4 签收工资条</button>
                    <button class="btn btn-default btn-sm" id="btn-jz-export-cash">导出配钞明细 (CSV)</button>
                    <button class="btn btn-default btn-sm jz-btn-stage-confirmation" data-step="cash_bills" id="btn-jz-confirm-cash_bills" disabled>确认现金发放</button>
                </div>
                <div class="jz-toolbar-right">
                    <span class="jz-tip-text">现金五档配钞点钞：按实发金额向上取整至元；<span id="jz-cash-rounding-diff">取整差额：¥ 0.00</span></span>
                </div>
            </div>

            <div class="jz-table-box">
                <table class="jz-table" id="table-jz-cash">
                    <thead>
                        <tr>
                            <th class="jz-col-seq">序号</th>
                            <th class="jz-col-no">工号</th>
                            <th class="jz-col-name">姓名</th>
                            <th class="jz-text-right">实发总额</th>
                            <th class="jz-text-right">现金实发</th>
                            <th class="jz-text-center">100元</th>
                            <th class="jz-text-center">50元</th>
                            <th class="jz-text-center">10元</th>
                            <th class="jz-text-center">5元</th>
                            <th class="jz-text-center">1元</th>
                            <th class="jz-text-right">合计金额</th>
                            <th class="jz-text-center">签收</th>
                        </tr>
                    </thead>
                    <tbody id="tbody-jz-cash"></tbody>
                    <tfoot id="tfoot-jz-cash"></tfoot>
                </table>
            </div>
        </div>

        <!-- Tab 7: 历史薪资穿透 (421条 / 对应 Excel [历史数据] sheets) -->
        <div id="jz-tab-history" class="jz-tab-content jz-hidden">
            <div class="jz-toolbar">
                <div class="jz-toolbar-left">
                    <label class="jz-filter-label">过滤历史账期：</label>
                    <select id="jz-history-month-filter" class="form-control jz-filter-select">
                        <option value="ALL">全部历史记录</option>
                    </select>
                </div>
            </div>
            <div class="jz-table-box">
                <table class="jz-table" id="table-jz-history">
                    <thead>
                        <tr>
                            <th class="jz-col-seq">序号</th>
                            <th class="jz-col-no jz-text-center">账期</th>
                            <th class="jz-col-no jz-text-center">工号</th>
                            <th class="jz-col-name">姓名</th>
                            <th>计薪方式</th>
                            <th class="jz-text-right">基本工资</th>
                            <th class="jz-text-right">岗位津贴</th>
                            <th class="jz-text-right">绩效奖金</th>
                            <th class="jz-text-right">应发薪资</th>
                            <th class="jz-text-right">免征额</th>
                            <th class="jz-text-right">专项扣除</th>
                            <th class="jz-text-right">附加扣除</th>
                            <th class="jz-text-right">代扣个税</th>
                            <th class="jz-text-right">实发薪资</th>
                        </tr>
                    </thead>
                    <tbody id="tbody-jz-history"></tbody>
                </table>
            </div>
        </div>
    </div>
    `;

    page.main.html(html);

    // Keep every selector inside this cached Desk page instance.
    const pageRoot = page.main;
    const pageQuery = window.jQuery || window.$;
    const $ = function(selector, context) {
        return pageQuery(selector, context === undefined ? pageRoot : context);
    };
    const esc = value => frappe.utils.escape_html(String(value ?? ''));
    const allowed_tabs = new Set([
        'employees', 'attendance', 'insurance', 'tax', 'payroll', 'cash_bills', 'history'
    ]);
    const confirmation_labels = {
        employees: '员工薪资档案',
        attendance: '考勤与工时',
        insurance: '社保公积金',
        tax: '个人所得税台账',
        cash_bills: '现金发放'
    };
    let workflow_state = { steps: [] };

    function call_error_text(response, fallback) {
        if (response && response.message && typeof response.message === 'string') {
            return response.message;
        }
        if (response && response.exc_type === 'PermissionError') {
            return '当前账号没有执行此操作的权限。';
        }
        return fallback;
    }

    function set_table_state(selector, colspan, message, error = false) {
        const stateClass = error ? 'jz-error-cell' : 'jz-empty-cell';
        $(selector).html(`<tr><td colspan="${colspan}" class="${stateClass}">${esc(message)}</td></tr>`);
    }

    function read_call(method, args, target, colspan, on_success, loading_message) {
        set_table_state(target, colspan, loading_message || '正在读取数据…');
        return frappe.call({
            method,
            type: 'GET',
            args,
            callback: function(response) {
                if (!response || response.exc || response.message === undefined || response.message === null) {
                    set_table_state(target, colspan, call_error_text(response, '读取失败，请刷新后重试。'), true);
                    return;
                }
                on_success(response.message);
            },
            error: function(xhr) {
                set_table_state(target, colspan, call_error_text(xhr, '读取失败，请检查权限或网络后重试。'), true);
            }
        });
    }

    function render_workflow_error(response, fallback) {
        const message = call_error_text(response, fallback);
        $('#jz-workflow-status-container').html(
            `<span class="jz-status-pending">${esc(message)}</span>`
        );
        $('#jz-workflow-steps-container').html(
            `<div class="jz-workflow-error">${esc(message)}</div>`
        );
    }

    function run_write_action($button, options) {
        if (!$button || !$button.length || $button.data('jz-busy')) return;
        const originalText = $button.text();
        $button.data('jz-busy', true).prop('disabled', true).addClass('disabled').text(options.busyText || '处理中…');
        frappe.call({
            method: options.method,
            type: 'POST',
            args: options.args || {},
            callback: function(response) {
                if (response && response.message && response.message.success) {
                    if (options.success) options.success(response.message);
                    return;
                }
                if (options.error) options.error(call_error_text(response, '操作未完成，请检查提示后重试。'));
            },
            error: function(xhr) {
                if (options.error) options.error(call_error_text(xhr, '操作失败，请检查权限或网络后重试。'));
            },
            always: function() {
                $button.data('jz-busy', false).prop('disabled', false).removeClass('disabled').text(originalText);
            }
        });
    }

    function get_workflow_step(step) {
        return (workflow_state.steps || []).find(item => item.tab === step) || null;
    }

    function set_workflow_button_state(selector, disabled, title) {
        const $button = selector && selector.jquery ? selector : $(selector);
        if (!$button.length) return;
        $button.prop('disabled', Boolean(disabled)).toggleClass('disabled', Boolean(disabled));
        if (title) $button.attr('title', title);
        else $button.removeAttr('title');
    }

    function update_workflow_action_controls(workflow) {
        workflow_state = workflow || { steps: [] };
        $('.jz-btn-stage-confirmation').each(function() {
            const $button = $(this);
            const step = String($button.data('step') || '');
            const detail = get_workflow_step(step);
            const label = confirmation_labels[step] || '当前步骤';
            if (!detail) {
                $button.text(`确认${label}`);
                set_workflow_button_state($button, true, '正在读取步骤状态');
                return;
            }
            if (detail.is_confirmed) {
                $button.text(`取消确认${label}`).addClass('jz-btn-stage-cancel');
                set_workflow_button_state(
                    $button,
                    !detail.can_unconfirm,
                    detail.can_unconfirm ? '取消确认后可恢复修改' : '请先取消后续步骤的确认'
                );
                return;
            }
            $button.text(`确认${label}`).removeClass('jz-btn-stage-cancel');
            set_workflow_button_state(
                $button,
                !detail.can_confirm,
                detail.can_confirm ? '确认后本账期在工作台内将只读' : '请先完成数据核验及前置确认'
            );
        });

        const employeesConfirmed = Boolean(get_workflow_step('employees')?.is_confirmed);
        const attendanceConfirmed = Boolean(get_workflow_step('attendance')?.is_confirmed);
        const insuranceConfirmed = Boolean(get_workflow_step('insurance')?.is_confirmed);
        const insurancePreviewReady = Boolean(workflow_state.insurance_sheets?.preview_ready);
        const insurancePrintReady = Boolean(workflow_state.insurance_sheets?.print_ready);
        set_workflow_button_state(
            '#btn-jz-add-emp',
            employeesConfirmed,
            employeesConfirmed ? '员工薪资档案已确认，请先取消确认后修改' : ''
        );
        set_workflow_button_state(
            '#btn-jz-upload-attendance',
            attendanceConfirmed,
            attendanceConfirmed ? '考勤与工时已确认，请先取消确认后修改' : ''
        );
        set_workflow_button_state(
            '#btn-jz-clear-attendance',
            attendanceConfirmed,
            attendanceConfirmed ? '考勤与工时已确认，请先取消确认后修改' : ''
        );
        set_workflow_button_state(
            '#btn-jz-edit-insurance',
            insuranceConfirmed,
            insuranceConfirmed ? '社保公积金已确认，请先取消确认后修改' : ''
        );
        set_workflow_button_state(
            '#btn-jz-open-insurance-form',
            insuranceConfirmed,
            insuranceConfirmed ? '社保公积金已确认，原生表单仅在取消确认后可进入编辑' : ''
        );
        set_workflow_button_state(
            '#btn-jz-calc-payroll',
            !workflow_state.can_calculate,
            workflow_state.can_calculate ? '' : '需先确认员工档案、考勤与工时、社保公积金'
        );
        set_workflow_button_state(
            '#btn-jz-sync-calc-payroll',
            !workflow_state.can_calculate,
            workflow_state.can_calculate ? '' : '需先确认员工档案、考勤与工时、社保公积金'
        );
        set_workflow_button_state(
            '#btn-jz-lock-payroll',
            !workflow_state.can_lock,
            workflow_state.can_lock ? '' : '需确认全部前置资料后才能最终核定'
        );
        set_workflow_button_state(
            '#btn-jz-generate-insurance-sheets',
            !insurancePreviewReady,
            insurancePreviewReady
                ? '重新读取当前账期的社保、公积金确认表'
                : (workflow_state.insurance_sheets?.reason || '请先确认员工档案和社保公积金配置')
        );
        set_workflow_button_state(
            '#btn-jz-print-social-insurance',
            !insurancePrintReady,
            insurancePrintReady ? '打印当前账期社保确认表' : '确认表尚未就绪，不能打印'
        );
        set_workflow_button_state(
            '#btn-jz-print-housing-fund',
            !insurancePrintReady,
            insurancePrintReady ? '打印当前账期公积金确认表' : '确认表尚未就绪，不能打印'
        );
    }

    function csv_value(value) {
        const text = String(value ?? '');
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }

    function download_csv(filename, headers, rows) {
        const csv = '\uFEFF' + [headers, ...rows]
            .map(row => row.map(csv_value).join(','))
            .join('\n') + '\n';
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    }

    function fmtHours(val) {
        let n = flt(val);
        return n.toFixed(1) + ' h';
    }

    function next_period(period) {
        const [year, month] = String(period).split('-').map(Number);
        if (!year || !month) return '';
        return month === 12
            ? `${year + 1}-01`
            : `${year}-${String(month + 1).padStart(2, '0')}`;
    }

    function employee_category(employee_type, employment_status) {
        const value = String(employee_type || '正式工').trim();
        const status = String(employment_status || '').trim();
        if (value === '本月离职' || value === '本月离职人员' || status === '本月离职') return '本月离职人员';
        if (['返聘工', '退休返聘', '退休返聘人员', '其他-返聘工'].includes(value)) return '退休返聘人员';
        if (['临时工', '零工'].includes(value)) return '临时工';
        return value === '正式工' ? '正式工' : '其他类型员工';
    }

    // Tab 切换逻辑
    $('.jz-tab-btn').on('click', function() {
        const tab = $(this).data('tab');
        $('.jz-tab-btn').removeClass('active');
        $(this).addClass('active');
        $('.jz-tab-content').addClass('jz-hidden');
        if (!allowed_tabs.has(tab)) return;
        $(`#jz-tab-${esc(tab)}`).removeClass('jz-hidden');
        $('.jz-step-card').removeClass('active-step');
        $(`.jz-step-card[data-tab="${esc(tab)}"]`).addClass('active-step');
        current_tab = tab;

        if (tab === 'payroll') load_payroll_data();
        else if (tab === 'attendance') load_attendance_data();
        else if (tab === 'cash_bills') load_cash_data();
        else if (tab === 'tax') load_tax_data();
        else if (tab === 'employees') load_employees_data();
        else if (tab === 'insurance') load_insurance_data();
        else if (tab === 'history') load_history_data();
    });

    // 月份变更
    $('#jz-month-select').on('change', function() {
        current_month = $(this).val();
        jz_insurance_sheets_cache = null;
        render_insurance_sheets(null);
        refresh_current_view();
    });

    $('#btn-jz-refresh-all').on('click', function() {
        refresh_current_view();
    });

    // 流程中枢动态折叠/展开逻辑（节省纵向空间，使大宽表最大化自适应浏览器视口）
    function apply_hub_collapsed_state(collapsed) {
        const $hub = $('.jz-workflow-hub');
        const $btn = $('#btn-toggle-workflow-hub');
        if (collapsed) {
            $hub.addClass('jz-hub-collapsed');
            $btn.text('展开流程');
        } else {
            $hub.removeClass('jz-hub-collapsed');
            $btn.text('收起流程');
        }
        try {
            sessionStorage.setItem('jz_workflow_hub_collapsed', collapsed ? '1' : '0');
        } catch (e) {}
    }

    $('#btn-toggle-workflow-hub').on('click', function(e) {
        e.preventDefault();
        const isCollapsed = $('.jz-workflow-hub').hasClass('jz-hub-collapsed');
        apply_hub_collapsed_state(!isCollapsed);
    });

    try {
        if (sessionStorage.getItem('jz_workflow_hub_collapsed') === '1') {
            apply_hub_collapsed_state(true);
        }
    } catch (e) {}

    function apply_short_viewport_hub_state() {
        try {
            if (sessionStorage.getItem('jz_workflow_hub_collapsed') !== null) return;
        } catch (e) {}
        $('.jz-workflow-hub').toggleClass('jz-hub-collapsed', window.innerHeight < 780);
        $('#btn-toggle-workflow-hub').text(window.innerHeight < 780 ? '展开流程' : '收起流程');
    }

    $(window)
        .off('resize.jizhongWorkflowHub')
        .on('resize.jizhongWorkflowHub', apply_short_viewport_hub_state);
    apply_short_viewport_hub_state();

    function refresh_current_view() {
        jz_insurance_sheets_cache = null;
        render_insurance_sheets(null);
        load_workflow_status();
        if (current_tab === 'payroll') load_payroll_data();
        else if (current_tab === 'attendance') load_attendance_data();
        else if (current_tab === 'cash_bills') load_cash_data();
        else if (current_tab === 'tax') load_tax_data();
        else if (current_tab === 'employees') load_employees_data();
        else if (current_tab === 'insurance') load_insurance_data();
        else if (current_tab === 'history') load_history_data();
    }

    $('.jz-btn-stage-confirmation').on('click', function() {
        const $button = $(this);
        const step = String($button.data('step') || '');
        const detail = get_workflow_step(step);
        const label = confirmation_labels[step] || '当前步骤';
        if (!detail) return;

        if (!detail.is_confirmed) {
            frappe.confirm(
                `确认【${current_month}】${label}吗？确认后该步骤将在工作台内只读，须取消确认后才能修改。`,
                function() {
                    run_write_action($button, {
                        method: 'ashan_cn_procurement.services.jizhong_payroll_service.lock_jizhong_monthly_payroll',
                        args: { company: COMPANY, period_month: current_month, step },
                        busyText: '正在确认…',
                        success: function(result) {
                            frappe.show_alert({ message: result.message, indicator: 'green' });
                            refresh_current_view();
                        },
                        error: function(message) {
                            frappe.show_alert({ message, indicator: 'red' });
                        }
                    });
                }
            );
            return;
        }

        const dialog = window.AshanUI.createDialog({
            title: `取消确认${label}（${current_month}）`,
            fields: [{
                fieldname: 'reason',
                fieldtype: 'Small Text',
                label: '取消确认原因',
                reqd: 1,
                description: '取消确认后可修改当前步骤；取消上游确认将同步清除依赖的薪酬测算结果。'
            }],
            primary_action_label: '取消确认',
            primary_action(values) {
                run_write_action(dialog.get_primary_btn(), {
                    method: 'ashan_cn_procurement.services.jizhong_payroll_service.unlock_jizhong_monthly_payroll',
                    args: {
                        company: COMPANY,
                        period_month: current_month,
                        step,
                        reason: values.reason
                    },
                    busyText: '正在取消确认…',
                    success: function(result) {
                        frappe.show_alert({ message: result.message, indicator: 'orange' });
                        dialog.hide();
                        refresh_current_view();
                    },
                    error: function(message) {
                        frappe.show_alert({ message, indicator: 'red' });
                    }
                });
            }
        });
        dialog.show();
    });

    // 0. 加载月度确认、测算与核定流程状态。
    function load_workflow_status() {
        const requested_month = current_month;
        jz_insurance_sheets_cache = null;
        render_insurance_sheets(null);
        $('#jz-workflow-status-container').html(
            '<span class="jz-status-pending">正在读取账期状态</span>'
        );
        $('#jz-workflow-steps-container').html(
            '<div class="jz-workflow-loading">正在读取核定流程…</div>'
        );
        frappe.call({
            method: 'ashan_cn_procurement.services.jizhong_payroll_service.get_jizhong_workflow_status',
            type: 'GET',
            args: { company: COMPANY, period_month: current_month },
            callback: function(r) {
                if (requested_month !== current_month) return;
                if (!r.message || !r.message.success) {
                    render_workflow_error(r, '无法读取账期状态，请刷新后重试。');
                    return;
                }
                const d = r.message;
                jz_insurance_sheets_cache = d.insurance_sheets || null;
                update_workflow_action_controls(d);
                render_insurance_sheets(jz_insurance_sheets_cache);
                const paymentPeriod = next_period(current_month);
                $('#jz-payroll-period-text').text(current_month);
                $('#jz-payment-period-text').text(paymentPeriod || '待确定');
                const overallClass = ['jz-status-locked', 'jz-status-draft', 'jz-status-ready', 'jz-status-pending']
                    .includes(d.overall_status_class) ? d.overall_status_class : 'jz-status-pending';
                $('#jz-workflow-period-text').text(d.period_label || current_month);
                $('#jz-workflow-status-container').html(
                    `<span class="${overallClass}" id="jz-workflow-overall-status">${esc(d.overall_status_text || '状态未知')}</span>`
                );

                const container = $('#jz-workflow-steps-container');
                container.empty();

                (d.steps || []).forEach(st => {
                    let badgeClass = 'jz-badge-pending';
                    if (st.status === 'confirmed') badgeClass = 'jz-badge-confirmed';
                    else if (st.status === 'ready') badgeClass = 'jz-badge-ready';
                    else if (st.status === 'locked') badgeClass = 'jz-badge-locked';

                    const stepTab = allowed_tabs.has(st.tab) ? st.tab : 'employees';
                    container.append(`
                        <button type="button" class="jz-step-card" id="jz-step-card-${cint(st.step)}" data-tab="${esc(stepTab)}" aria-label="查看第 ${cint(st.step)} 步：${esc(st.title)}">
                            <span class="jz-step-card-header">
                                <span class="jz-step-index">第 ${cint(st.step)} 步</span>
                                <span class="jz-step-badge ${badgeClass}">${esc(st.badge)}</span>
                            </span>
                            <span class="jz-step-title">${esc(st.title)}</span>
                            <span class="jz-step-main">${esc(st.main)}</span>
                        </button>
                    `);
                });

                container.find('.jz-step-card').on('click', function() {
                    const targetTab = $(this).data('tab');
                    $(`.jz-tab-btn[data-tab="${targetTab}"]`).click();
                });
            }
        });
    }

    // 1. 加载月度薪酬核定表
    let payroll_cache = [];
    function load_payroll_data() {
        read_call(
            'ashan_cn_procurement.services.jizhong_payroll_service.get_jizhong_payroll_overview',
            { company: COMPANY, period_month: current_month },
            '#tbody-jz-payroll',
            20,
            function(message) {
                const set = message.settlement || {};
                const items = message.items || [];
                payroll_cache = items;

                // KPI 渲染
                if (set.locked) {
                    $('#jz-kpi-status').html('<span class="jz-status-badge jz-status-locked">已核定锁定</span>');
                    $('#btn-jz-lock-payroll').addClass('jz-hidden');
                    $('#btn-jz-unlock-payroll').removeClass('jz-hidden');
                } else {
                    $('#jz-kpi-status').html('<span class="jz-status-badge jz-status-draft">草稿 / 可测算</span>');
                    $('#btn-jz-lock-payroll').removeClass('jz-hidden');
                    $('#btn-jz-unlock-payroll').addClass('jz-hidden');
                }

                $('#jz-kpi-count').text(items.length);
                $('#jz-kpi-net').text(window.AshanUI.formatMoney(set.total_net_salary || 0));
                $('#jz-kpi-gross').text(window.AshanUI.formatMoney(set.total_gross_salary || 0));
                $('#jz-kpi-person-ded').text(window.AshanUI.formatMoney((flt(set.total_social_security_person) + flt(set.total_housing_fund_person) + flt(set.total_tax))));
                $('#jz-kpi-ss-pers').text(window.AshanUI.formatMoney(set.total_social_security_person || 0));
                $('#jz-kpi-hf-pers').text(window.AshanUI.formatMoney(set.total_housing_fund_person || 0));
                $('#jz-kpi-tax').text(window.AshanUI.formatMoney(set.total_tax || 0));
                $('#jz-kpi-comp-cost').text(window.AshanUI.formatMoney((flt(set.total_social_security_company) + flt(set.total_housing_fund_company))));
                $('#jz-kpi-ss-comp').text(window.AshanUI.formatMoney(set.total_social_security_company || 0));
                $('#jz-kpi-hf-comp').text(window.AshanUI.formatMoney(set.total_housing_fund_company || 0));

                render_payroll_table();
            },
            '正在读取吉众工资核定表…'
        );
    }

    // 渲染 Payroll Table 表头与数据行
    function render_payroll_table() {
        const thead = $('#thead-jz-payroll');
        const tbody = $('#tbody-jz-payroll');
        const tfoot = $('#tfoot-jz-payroll');
        thead.empty();
        tbody.empty();
        tfoot.empty();

        const isDetail = (payroll_col_view === 'detail');

        // 1. 单层纯净表头 (严格一行文本，杜绝多层药丸卡片)
        if (isDetail) {
            thead.html(`
                <tr>
                    <th class="jz-col-seq">序号</th>
                    <th class="jz-col-no">工号</th>
                    <th class="jz-col-name">姓名</th>
                    <th>用工性质</th>
                    <th>计薪方式</th>
                    <th class="jz-text-right">基本工资</th>
                    <th class="jz-text-right">岗位津贴</th>
                    <th class="jz-text-right">绩效基数</th>
                    <th class="jz-text-right">出勤工时</th>
                    <th class="jz-text-right">1.5倍工时</th>
                    <th class="jz-text-right">2倍工时</th>
                    <th class="jz-text-right">3倍工时</th>
                    <th class="jz-text-right">倒休工时</th>
                    <th class="jz-text-right">餐补次数</th>
                    <th class="jz-text-right">基本工时工资</th>
                    <th class="jz-text-right">1.5倍工资</th>
                    <th class="jz-text-right">2倍工资</th>
                    <th class="jz-text-right">3倍工资</th>
                    <th class="jz-text-right">基本补贴</th>
                    <th class="jz-text-right">绩效工资</th>
                    <th class="jz-text-right">餐补工资</th>
                    <th class="jz-text-right">工资调整</th>
                    <th class="jz-text-right">应发薪资</th>
                    <th class="jz-text-right">个人社保</th>
                    <th class="jz-text-right">个人公积金</th>
                    <th class="jz-text-right">代扣个税</th>
                    <th class="jz-text-right">个人扣除合计</th>
                    <th class="jz-text-right">实发薪资</th>
                    <th class="jz-text-right">现金发放取整</th>
                    <th class="jz-text-right">单位社保统筹</th>
                    <th class="jz-text-right">单位公积金</th>
                    <th class="jz-text-right">公司成本合计</th>
                </tr>
            `);
        } else {
            // 精简财务视图 (20 列，纯净清爽)
            thead.html(`
                <tr>
                    <th class="jz-col-seq">序号</th>
                    <th class="jz-col-no">工号</th>
                    <th class="jz-col-name">姓名</th>
                    <th>用工性质</th>
                    <th>计薪方式</th>
                    <th class="jz-text-right">基本工资</th>
                    <th class="jz-text-right">出勤工时</th>
                    <th class="jz-text-right">加班费合计</th>
                    <th class="jz-text-right">津贴与绩效</th>
                    <th class="jz-text-right">餐补工资</th>
                    <th class="jz-text-right">工资调整</th>
                    <th class="jz-text-right">应发薪资</th>
                    <th class="jz-text-right">个人社保</th>
                    <th class="jz-text-right">个人公积金</th>
                    <th class="jz-text-right">代扣个税</th>
                    <th class="jz-text-right">个人扣除合计</th>
                    <th class="jz-text-right">实发薪资</th>
                    <th class="jz-text-right">现金发放</th>
                    <th class="jz-text-right">单位统筹</th>
                    <th class="jz-text-right">公司总成本</th>
                </tr>
            `);
        }

        let filtered = payroll_cache.filter(it => {
            const type = String(it.employee_type || '正式工').trim();
            if (payroll_filter_mode === 'regular') {
                return type === '正式工';
            } else if (payroll_filter_mode === 'other') {
                return type !== '正式工';
            }
            return true; // 全部人员
        });

        const colSpanTotal = isDetail ? 32 : 20;

        if (filtered.length === 0) {
            tbody.html(`<tr><td colspan="${colSpanTotal}" class="jz-empty-cell">该期间暂无薪酬结算记录，请点击上方“执行月度薪酬核算”。</td></tr>`);
            return;
        }

        let tot_basic_hrs = 0, tot_ot_hrs = 0, tot_ot_pay = 0, tot_allow_perf = 0;
        let tot_sal_meal = 0, tot_sal_adj = 0, tot_gross = 0;
        let tot_ss_pers = 0, tot_hf_pers = 0, tot_tax = 0, tot_pers_ded = 0, tot_net = 0, tot_cash = 0;
        let tot_comp_ins = 0, tot_comp_cost = 0;

        // 全要素累加变量
        let tot_ot15_hrs = 0, tot_ot20_hrs = 0, tot_ot30_hrs = 0, tot_comp_hrs = 0, tot_meals = 0;
        let tot_sal_basic = 0, tot_sal_ot15 = 0, tot_sal_ot20 = 0, tot_sal_ot30 = 0;
        let tot_sal_sub = 0, tot_sal_perf = 0, tot_ss_comp = 0, tot_hf_comp = 0;

        filtered.forEach((it, idx) => {
            const bHrs = flt(it.work_hours);
            const ot15 = flt(it.overtime_regular_1_5);
            const ot20 = flt(it.overtime_weekend_2_0);
            const ot30 = flt(it.overtime_holiday_3_0);
            const cLeave = flt(it.leave_compensatory_hours);
            const mCount = cint(it.meal_count);

            const sBasic = flt(it.salary_basic_hours);
            const sOt15 = flt(it.salary_overtime_1_5);
            const sOt20 = flt(it.salary_overtime_2_0);
            const sOt30 = flt(it.salary_overtime_3_0);
            const otPay = flt(sOt15 + sOt20 + sOt30, 2);

            const sSub = flt(it.salary_basic_subsidy);
            const sPerf = flt(it.salary_performance);
            const allowPerf = flt(sSub + sPerf, 2);

            const sMeal = flt(it.salary_meal_subsidy);
            const sAdj = flt(it.salary_adjustment);
            const gross = flt(it.gross_salary);

            const ssP = flt(it.ss_person_total);
            const hfP = flt(it.hf_person_total);
            const tax = flt(it.tax_amount);
            const pCost = flt(it.person_cost_total);
            const net = flt(it.net_salary);
            const cash = flt(it.cash_pay);

            const ssC = flt(it.ss_company_total);
            const hfC = flt(it.hf_company_total);
            const cCost = flt(it.company_cost_total);

            // 汇总
            tot_basic_hrs += bHrs;
            tot_ot_hrs += (ot15 + ot20 + ot30);
            tot_ot_pay += otPay;
            tot_allow_perf += allowPerf;
            tot_sal_meal += sMeal;
            tot_sal_adj += sAdj;
            tot_gross += gross;

            tot_ss_pers += ssP;
            tot_hf_pers += hfP;
            tot_tax += tax;
            tot_pers_ded += pCost;
            tot_net += net;
            tot_cash += cash;
            tot_comp_ins += (ssC + hfC);
            tot_comp_cost += cCost;

            if (isDetail) {
                tot_ot15_hrs += ot15;
                tot_ot20_hrs += ot20;
                tot_ot30_hrs += ot30;
                tot_comp_hrs += cLeave;
                tot_meals += mCount;
                tot_sal_basic += sBasic;
                tot_sal_ot15 += sOt15;
                tot_sal_ot20 += sOt20;
                tot_sal_ot30 += sOt30;
                tot_sal_sub += sSub;
                tot_sal_perf += sPerf;
                tot_ss_comp += ssC;
                tot_hf_comp += hfC;

                tbody.append(`
                    <tr>
                        <td class="jz-col-seq">${idx + 1}</td>
                        <td class="jz-col-no"><strong>${esc(it.employee_no)}</strong></td>
                        <td class="jz-col-name"><strong>${esc(it.employee_name)}</strong></td>
                        <td>${esc(it.employee_type || '正式工')}</td>
                        <td>${esc(it.salary_mode)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(it.base_salary)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(it.post_allowance)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(it.performance_salary)}</td>
                        <td class="jz-num-cell">${fmtHours(bHrs)}</td>
                        <td class="jz-num-cell">${fmtHours(ot15)}</td>
                        <td class="jz-num-cell">${fmtHours(ot20)}</td>
                        <td class="jz-num-cell">${fmtHours(ot30)}</td>
                        <td class="jz-num-cell">${fmtHours(cLeave)}</td>
                        <td class="jz-num-cell">${mCount} 次</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(sBasic)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(sOt15)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(sOt20)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(sOt30)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(sSub)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(sPerf)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(sMeal)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(sAdj)}</td>
                        <td class="jz-money-cell jz-money-bold">${window.AshanUI.formatMoney(gross)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(ssP)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(hfP)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(tax)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(pCost)}</td>
                        <td class="jz-money-cell jz-money-primary">${window.AshanUI.formatMoney(net)}</td>
                        <td class="jz-money-cell jz-money-cash">${window.AshanUI.formatMoney(cash)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(ssC)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(hfC)}</td>
                        <td class="jz-money-cell jz-money-cost">${window.AshanUI.formatMoney(cCost)}</td>
                    </tr>
                `);
            } else {
                tbody.append(`
                    <tr>
                        <td class="jz-col-seq">${idx + 1}</td>
                        <td class="jz-col-no"><strong>${esc(it.employee_no)}</strong></td>
                        <td class="jz-col-name"><strong>${esc(it.employee_name)}</strong></td>
                        <td>${esc(it.employee_type || '正式工')}</td>
                        <td>${esc(it.salary_mode)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(it.base_salary)}</td>
                        <td class="jz-num-cell">${fmtHours(bHrs)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(otPay)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(allowPerf)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(sMeal)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(sAdj)}</td>
                        <td class="jz-money-cell jz-money-bold">${window.AshanUI.formatMoney(gross)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(ssP)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(hfP)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(tax)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(pCost)}</td>
                        <td class="jz-money-cell jz-money-primary">${window.AshanUI.formatMoney(net)}</td>
                        <td class="jz-money-cell jz-money-cash">${window.AshanUI.formatMoney(cash)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(ssC + hfC)}</td>
                        <td class="jz-money-cell jz-money-cost">${window.AshanUI.formatMoney(cCost)}</td>
                    </tr>
                `);
            }
        });

        // 底部合计行
        if (isDetail) {
            tfoot.html(`
                <tr>
                    <td colspan="3" class="jz-col-foot-label">合计 · 本表 ${filtered.length} 人</td>
                    <td>-</td>
                    <td>-</td>
                    <td class="jz-money-cell">-</td>
                    <td class="jz-money-cell">-</td>
                    <td class="jz-money-cell">-</td>
                    <td class="jz-num-cell">${fmtHours(tot_basic_hrs)}</td>
                    <td class="jz-num-cell">${fmtHours(tot_ot15_hrs)}</td>
                    <td class="jz-num-cell">${fmtHours(tot_ot20_hrs)}</td>
                    <td class="jz-num-cell">${fmtHours(tot_ot30_hrs)}</td>
                    <td class="jz-num-cell">${fmtHours(tot_comp_hrs)}</td>
                    <td class="jz-num-cell">${tot_meals} 次</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_sal_basic)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_sal_ot15)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_sal_ot20)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_sal_ot30)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_sal_sub)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_sal_perf)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_sal_meal)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_sal_adj)}</td>
                    <td class="jz-money-cell jz-money-bold">${window.AshanUI.formatMoney(tot_gross)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_ss_pers)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_hf_pers)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_tax)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_pers_ded)}</td>
                    <td class="jz-money-cell jz-money-primary">${window.AshanUI.formatMoney(tot_net)}</td>
                    <td class="jz-money-cell jz-money-cash">${window.AshanUI.formatMoney(tot_cash)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_ss_comp)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_hf_comp)}</td>
                    <td class="jz-money-cell jz-money-cost">${window.AshanUI.formatMoney(tot_comp_cost)}</td>
                </tr>
            `);
        } else {
            tfoot.html(`
                <tr>
                    <td colspan="3" class="jz-col-foot-label">合计 · 本表 ${filtered.length} 人</td>
                    <td>-</td>
                    <td>-</td>
                    <td class="jz-money-cell">-</td>
                    <td class="jz-num-cell">${fmtHours(tot_basic_hrs)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_ot_pay)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_allow_perf)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_sal_meal)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_sal_adj)}</td>
                    <td class="jz-money-cell jz-money-bold">${window.AshanUI.formatMoney(tot_gross)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_ss_pers)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_hf_pers)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_tax)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_pers_ded)}</td>
                    <td class="jz-money-cell jz-money-primary">${window.AshanUI.formatMoney(tot_net)}</td>
                    <td class="jz-money-cell jz-money-cash">${window.AshanUI.formatMoney(tot_cash)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_comp_ins)}</td>
                    <td class="jz-money-cell jz-money-cost">${window.AshanUI.formatMoney(tot_comp_cost)}</td>
                </tr>
            `);
        }
    }

    // 分段控件事件绑定
    $('#jz-payroll-person-filter .jz-segment-btn').on('click', function() {
        $('#jz-payroll-person-filter .jz-segment-btn').removeClass('active');
        $(this).addClass('active');
        $('#jz-payroll-person-filter .jz-segment-btn').attr('aria-pressed', 'false');
        $(this).attr('aria-pressed', 'true');
        payroll_filter_mode = $(this).data('mode');
        render_payroll_table();
    });

    $('#jz-payroll-col-toggle .jz-segment-btn').on('click', function() {
        $('#jz-payroll-col-toggle .jz-segment-btn').removeClass('active');
        $(this).addClass('active');
        $('#jz-payroll-col-toggle .jz-segment-btn').attr('aria-pressed', 'false');
        $(this).attr('aria-pressed', 'true');
        payroll_col_view = $(this).data('view');
        render_payroll_table();
    });

    function payroll_export_rows(items) {
        const money = value => flt(value).toFixed(2);
        return items.map(it => [
            it.employee_no,
            it.employee_name,
            it.employee_type,
            it.salary_mode,
            money(it.base_salary),
            flt(it.work_hours).toFixed(1),
            money(flt(it.salary_overtime_1_5) + flt(it.salary_overtime_2_0) + flt(it.salary_overtime_3_0)),
            money(flt(it.salary_basic_subsidy) + flt(it.salary_performance) + flt(it.salary_post_allowance)),
            money(it.salary_meal_subsidy),
            money(it.salary_adjustment),
            money(it.gross_salary),
            money(it.ss_person_total),
            money(it.hf_person_total),
            money(it.tax_amount),
            money(it.person_cost_total),
            money(it.net_salary),
            money(it.cash_pay),
            money(flt(it.ss_company_total) + flt(it.hf_company_total)),
            money(it.company_cost_total),
            it.housing_fund_policy || ''
        ]);
    }

    $('#btn-jz-export-payroll').on('click', function() {
        if (!payroll_cache.length) {
            frappe.msgprint('本月尚未生成工资表，请先完成薪酬测算。');
            return;
        }
        download_csv(
            `吉众月度工资表_${current_month}.csv`,
            ['工号', '姓名', '用工性质', '计薪方式', '基本工资', '出勤工时', '加班费合计', '津贴与绩效', '餐补工资', '工资调整', '应发薪资', '个人社保', '个人公积金', '代扣个税', '个人扣除合计', '实发薪资', '现金发放', '单位统筹', '公司总成本', '公积金长期策略'],
            payroll_export_rows(payroll_cache)
        );
    });

    $('#btn-jz-export-tax').on('click', function() {
        if (!payroll_cache.length) {
            frappe.msgprint('本月尚未生成个税记录，请先完成薪酬测算。');
            return;
        }
        download_csv(
            `吉众个人所得税台账_${current_month}.csv`,
            ['工号', '姓名', '计薪方式', '应发薪资', '基本减除费用', '社保个人合计', '公积金个人', '专项附加扣除', '当月预扣个税', '实发工资'],
            payroll_cache.map(it => [
                it.employee_no, it.employee_name, it.salary_mode,
                flt(it.gross_salary).toFixed(2), flt(it.tax_threshold).toFixed(2),
                flt(it.ss_person_total).toFixed(2), flt(it.hf_person_total).toFixed(2),
                flt(it.special_deductions_total).toFixed(2), flt(it.tax_amount).toFixed(2),
                flt(it.net_salary).toFixed(2)
            ])
        );
    });

    // 一键测算薪酬
    $('#btn-jz-calc-payroll').on('click', function() {
        const $button = $(this);
        frappe.confirm(`确定对吉众公司 ${current_month} 账期执行全员薪酬测算？`, function() {
            run_write_action($button, {
                method: 'ashan_cn_procurement.services.jizhong_payroll_service.calculate_jizhong_monthly_payroll',
                args: { company: COMPANY, period_month: current_month },
                busyText: '正在测算薪酬…',
                success: function(result) {
                    frappe.msgprint(`月度薪资测算完成！共计 ${result.total_employees} 人，实发工资总额 ${window.AshanUI.formatMoney(result.total_net_salary)}。`);
                    load_payroll_data();
                    load_workflow_status();
                },
                error: function(message) {
                    frappe.show_alert({ message, indicator: 'red' });
                }
            });
        });
    });

    // 核定锁定 (只读封账)
    $('#btn-jz-lock-payroll').on('click', function() {
        const $button = $(this);
        frappe.confirm(
            `确定要对【${COMPANY}】${current_month} 月度工资进行最终核定并封账锁定吗？<br><small class="text-muted">锁定后数据将处于只读保护状态，并作为下月算税的历史累计依据。</small>`,
            function() {
                run_write_action($button, {
                    method: 'ashan_cn_procurement.services.jizhong_payroll_service.lock_jizhong_monthly_payroll',
                    args: { company: COMPANY, period_month: current_month },
                    busyText: '正在核定封账…',
                    success: function(result) {
                        frappe.show_alert({ message: result.message, indicator: 'green' });
                        load_payroll_data();
                        load_workflow_status();
                    },
                    error: function(message) {
                        frappe.show_alert({ message, indicator: 'red' });
                    }
                });
            }
        );
    });

    // 申请反审核解锁
    $('#btn-jz-unlock-payroll').on('click', function() {
        const dlg = window.AshanUI.createDialog({
            title: `申请反审核解锁 (${current_month})`,
            fields: [{
                fieldname: 'reason',
                fieldtype: 'Small Text',
                label: '反审核解锁原因（必填）',
                reqd: 1,
                description: '说明需要修改的对象和原因，解锁后账期恢复为可重新测算状态。'
            }],
            primary_action_label: '提交解锁申请',
            primary_action: function(vals) {
                run_write_action(dlg.get_primary_btn(), {
                    method: 'ashan_cn_procurement.services.jizhong_payroll_service.unlock_jizhong_monthly_payroll',
                    args: {
                        company: COMPANY,
                        period_month: current_month,
                        reason: vals.reason
                    },
                    busyText: '正在提交解锁申请…',
                    success: function(result) {
                        frappe.show_alert({ message: result.message, indicator: 'orange' });
                        dlg.hide();
                        load_payroll_data();
                        load_workflow_status();
                    },
                    error: function(message) {
                        frappe.show_alert({ message, indicator: 'red' });
                    }
                });
            },
        });
        dlg.show();
    });

    // 2. 加载考勤工时管理
    let attendance_cache = [];
    let attendance_calendar_days = [];

    function get_attendance_daily_records(employee) {
        if (Array.isArray(employee && employee.daily_records)) {
            return employee.daily_records;
        }
        if (!employee || !employee.daily_records_json) return [];
        try {
            const parsed = JSON.parse(employee.daily_records_json);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            return [];
        }
    }

    $('#btn-jz-work-hours-help').on('click', function() {
        frappe.msgprint({
            title: '吉众工时口径说明',
            indicator: 'blue',
            message: `
                <div class="jz-work-hours-help">
                    <p><strong>日期下的“班 / 休”</strong>表示法定日历状态；“计时倍率”只表示当天所属的工时分类。</p>
                    <ul>
                        <li><strong>倍率 1：</strong>普通工作日或调班工作日。每天先计 8 小时正班，超过 8 小时的部分按平日加班 1.5 倍归集。</li>
                        <li><strong>倍率 2：</strong>周末或调休放假日。当天作业和加班工时进入周末加班池，优先抵扣平日不足 8 小时的缺口。</li>
                        <li><strong>倍率 3：</strong>法定节假日。当天作业和加班工时按节日加班归集，不参与倒休抵扣。</li>
                    </ul>
                    <p><strong>汇总列：</strong>正班工时包含平日正班和实际倒休抵扣；平日、周末、节日加班分别按 1.5、2、3 倍分类；倒休工时表示周末 2 倍工时实际抵扣的平日缺口。</p>
                </div>
            `
        });
    });

    function load_attendance_data() {
        read_call(
            'ashan_cn_procurement.services.jizhong_attendance_service.get_jizhong_attendance_table',
            { company: COMPANY, period_month: current_month },
            '#tbody-jz-raw-attendance',
            45,
            function(message) {
                const summary = message.summary || {};
                const records = message.records || [];
                attendance_cache = records;
                attendance_calendar_days = Array.isArray(message.calendar_days) ? message.calendar_days : [];

                const coverage = summary.coverage || {};
                const expectedCount = cint(coverage.expected_count);
                const matchedCount = cint(coverage.matched_count);
                const excludedCount = cint(coverage.excluded_count);
                let coverageText = `应上传考勤 ${expectedCount} 人，已匹配 ${matchedCount} 人`;
                coverageText += coverage.complete
                    ? '，考勤范围完整'
                    : `，缺失 ${Math.max(0, expectedCount - matchedCount)} 人`;
                if (excludedCount > 0) {
                    coverageText += `；另有 ${excludedCount} 人无需上传考勤（固定税后管理工资）`;
                }
                $('#jz-att-coverage').text(coverageText);

                $('#jz-att-kpi-count').text((summary.employee_count || 0) + ' 人');
                $('#jz-att-kpi-reg').text(fmtHours(summary.total_work_hours || 0));
                $('#jz-att-kpi-comp').text(fmtHours(summary.total_compensatory || 0));
                $('#jz-att-kpi-ot').text(fmtHours((flt(summary.total_ot_1_5) + flt(summary.total_ot_2_0) + flt(summary.total_ot_3_0))));
                $('#jz-att-kpi-ot15').text(fmtHours(summary.total_ot_1_5 || 0));
                $('#jz-att-kpi-ot20').text(fmtHours(summary.total_ot_2_0 || 0));
                $('#jz-att-kpi-ot30').text(fmtHours(summary.total_ot_3_0 || 0));
                $('#jz-att-kpi-meals').text((summary.total_meals || 0) + ' 次');

                if (summary.attendance_file) {
                    const fileUrl = String(summary.attendance_file);
                    const $fileStatus = $('#jz-att-file-status').empty();
                    $fileStatus.append(document.createTextNode('凭证已归档：'));
                    if (/^(\/|https?:\/\/)/i.test(fileUrl)) {
                        $('<a>', {
                            href: fileUrl,
                            target: '_blank',
                            rel: 'noopener noreferrer',
                            class: 'jz-text-info',
                            text: '查看文件'
                        }).appendTo($fileStatus);
                    } else {
                        $fileStatus.append(document.createTextNode('文件地址无效'));
                    }
                    $('#btn-jz-download-attendance-file').removeClass('jz-hidden').attr('data-url', summary.attendance_file);
                } else {
                    $('#jz-att-file-status').text('原始凭证: 未上传');
                    $('#btn-jz-download-attendance-file').addClass('jz-hidden');
                }

                if (records.length === 0) {
                    $('#btn-jz-clear-attendance').prop('disabled', true).addClass('disabled');
                } else {
                    $('#btn-jz-clear-attendance').prop('disabled', false).removeClass('disabled');
                }

                render_raw_attendance_table();
                render_attendance_table();
            },
            '正在读取本月考勤底册…'
        );
    }

    function render_attendance_table() {
        const tbody = $('#tbody-jz-attendance');
        tbody.empty();

        if (attendance_cache.length === 0) {
            tbody.html('<tr><td colspan="13" class="jz-empty-cell">该月份尚未上传考勤表，请点击“上传月度考勤 (Excel)”按钮。</td></tr>');
            $('#tfoot-jz-attendance').empty();
            return;
        }

        let tot_reg = 0, tot_15 = 0, tot_20 = 0, tot_30 = 0, tot_comp = 0, tot_m = 0, tot_ot_all = 0, tot_payable_ot_all = 0;

        attendance_cache.forEach((it, idx) => {
            const wReg = flt(it.work_hours_regular);
            const ot15 = flt(it.overtime_regular_1_5);
            const ot20 = flt(it.overtime_weekend_2_0);
            const ot30 = flt(it.overtime_holiday_3_0);
            const cLeave = flt(it.leave_compensatory_hours);
            const mCount = cint(it.meal_count);

            const tot_ot_emp = ot15 + ot20 + ot30;
            const actual_payable_ot = ot15 + Math.max(0, ot20 - cLeave) + ot30;

            tot_reg += wReg;
            tot_15 += ot15;
            tot_20 += ot20;
            tot_30 += ot30;
            tot_comp += cLeave;
            tot_m += mCount;
            tot_ot_all += tot_ot_emp;
            tot_payable_ot_all += actual_payable_ot;

            // 从原始每日打卡记录中提取真实请假与异常打卡备注汇总
            let remark_counts = {};
            let rest_days = 0;
            if (it.daily_records_json) {
                try {
                    const days = get_attendance_daily_records(it);
                    days.forEach(d => {
                        if (d.remark) {
                            const rm = d.remark.trim();
                            if (rm === '休') {
                                rest_days++;
                            } else if (rm) {
                                remark_counts[rm] = (remark_counts[rm] || 0) + 1;
                            }
                        }
                    });
                } catch(e) {}
            }
            let rText = [];
            if (rest_days > 0) rText.push(`公休 ${rest_days}天`);
            for (const [rm, count] of Object.entries(remark_counts)) {
                let label = rm;
                if (rm === '事') label = '事假';
                else if (rm === '病') label = '病假';
                rText.push(`${label} ${count}天`);
            }
            const final_r = rText.length > 0 ? rText.join(' · ') : '-';

            tbody.append(`
                <tr class="jz-att-row" data-no="${esc(it.employee_no)}">
                    <td class="jz-col-seq">${idx + 1}</td>
                    <td class="jz-col-no"><strong>${esc(it.employee_no)}</strong></td>
                    <td class="jz-col-name"><strong>${esc(it.employee_name)}</strong></td>
                    <td class="jz-text-center">${it.attendance_days || 0} 天</td>
                    <td class="jz-num-cell jz-text-info">${fmtHours(wReg)}</td>
                    <td class="jz-num-cell">${fmtHours(ot15)}</td>
                    <td class="jz-num-cell">${fmtHours(ot20)}</td>
                    <td class="jz-num-cell">${fmtHours(ot30)}</td>
                    <td class="jz-num-cell jz-text-primary">${fmtHours(tot_ot_emp)}</td>
                    <td class="jz-num-cell jz-text-muted">${fmtHours(cLeave)}</td>
                    <td class="jz-num-cell jz-text-primary"><strong>${fmtHours(actual_payable_ot)}</strong></td>
                    <td class="jz-num-cell jz-text-success">${mCount} 次</td>
                    <td class="jz-tip-text">${esc(final_r)}</td>
                </tr>
            `);
        });

        $('#tfoot-jz-attendance').html(`
            <tr>
                <td colspan="3" class="jz-col-foot-label">合计 (${attendance_cache.length}人)</td>
                <td class="jz-text-center">-</td>
                <td class="jz-num-cell jz-text-info">${fmtHours(tot_reg)}</td>
                <td class="jz-num-cell">${fmtHours(tot_15)}</td>
                <td class="jz-num-cell">${fmtHours(tot_20)}</td>
                <td class="jz-num-cell">${fmtHours(tot_30)}</td>
                <td class="jz-num-cell jz-text-primary">${fmtHours(tot_ot_all)}</td>
                <td class="jz-num-cell jz-text-muted">${fmtHours(tot_comp)}</td>
                <td class="jz-num-cell jz-text-primary"><strong>${fmtHours(tot_payable_ot_all)}</strong></td>
                <td class="jz-num-cell jz-text-success">${tot_m} 次</td>
                <td class="jz-text-muted">-</td>
            </tr>
        `);
    }

    // 上传考勤 Excel 弹窗
    $('#btn-jz-upload-attendance').on('click', function() {
        const d = window.AshanUI.createDialog({
            title: '上传吉众月度考勤表 (Excel)',
            fields: [
                {
                    label: '考勤所属月份',
                    fieldname: 'period_month',
                    fieldtype: 'Data',
                    default: current_month,
                    reqd: 1,
                    description: '格式如 2026-07 或 2026-06'
                },
                {
                    label: '考勤文件 (员工考勤表-*.xlsx)',
                    fieldname: 'file',
                    fieldtype: 'Attach',
                    reqd: 1,
                    description: '支持《员工考勤表-2026年7月.xlsx》等月度全员5行多日打卡表'
                }
            ],
            primary_action_label: '开始解析入库',
            primary_action: function(vals) {
                if (!vals.file) {
                    frappe.msgprint('请先上传考勤 Excel 文件！');
                    return;
                }
                run_write_action(d.get_primary_btn(), {
                    method: 'ashan_cn_procurement.services.jizhong_attendance_service.upload_and_parse_attendance',
                    args: {
                        company: COMPANY,
                        period_month: vals.period_month,
                        file_url: vals.file
                    },
                    busyText: '正在解析考勤…',
                    success: function(result) {
                        frappe.msgprint(`考勤解析入库成功！共识别 ${result.employee_count} 人，正班工时 ${result.total_regular_hours}h，加班 ${result.total_ot_1_5 + result.total_ot_2_0 + result.total_ot_3_0}h，餐补 ${result.total_meals} 次。`);
                        d.hide();
                        current_month = vals.period_month;
                        $('#jz-month-select').val(current_month);
                        load_attendance_data();
                        load_workflow_status();
                    },
                    error: function(message) {
                        frappe.show_alert({ message, indicator: 'red' });
                    }
                });
            }
        });
        d.show();
    });

    $('#btn-jz-download-attendance-file').on('click', function() {
        const url = $(this).attr('data-url');
        if (url) window.open(url);
    });

    // 一键清空当月考勤记录
    $('#btn-jz-clear-attendance').on('click', function() {
        if (!current_month) {
            frappe.msgprint('请先选择考勤月份！');
            return;
        }
        if (!attendance_cache || attendance_cache.length === 0) {
            frappe.msgprint(`当前月份（${current_month}）暂无考勤记录，无需清空。`);
            return;
        }

        frappe.confirm(
            `确定要一键清空【${current_month}】的全部考勤工时记录吗？<br><br><span class="text-danger">注意：此操作将清空该月份所有员工（共 ${attendance_cache.length} 人）的正班工时、加班工时、倒休抵扣、餐补及每日打卡明细，清空后可重新上传新的考勤 Excel。</span>`,
            function() {
                run_write_action($('#btn-jz-clear-attendance'), {
                    method: 'ashan_cn_procurement.services.jizhong_attendance_service.clear_jizhong_attendance_month',
                    args: {
                        company: COMPANY,
                        period_month: current_month
                    },
                    busyText: '正在清空考勤…',
                    success: function(result) {
                        frappe.show_alert({
                            message: `已成功清空 ${current_month} 月考勤记录（共删除 ${result.deleted_count} 条）！现在可以重新上传考勤 Excel。`,
                            indicator: 'green'
                        }, 5);
                        load_attendance_data();
                        load_workflow_status();
                    },
                    error: function(message) {
                        frappe.show_alert({ message, indicator: 'red' });
                    }
                });
            }
        );
    });

    // 联动算薪
    $('#btn-jz-sync-calc-payroll').on('click', function() {
        $('.jz-tab-btn[data-tab="payroll"]').click();
        $('#btn-jz-calc-payroll').click();
    });

    // ==========================================
    // 2.1 考勤双视角（原始打卡底册矩阵 vs 分类结算汇总）
    // ==========================================
    let raw_metric_filter = 'all';

    // Tab 2 双视角原位分段切换
    $('#jz-att-view-mode .jz-segment-btn').on('click', function() {
        $('#jz-att-view-mode .jz-segment-btn').removeClass('active');
        $(this).addClass('active');
        const mode = $(this).data('mode');
        if (mode === 'raw') {
            $('#box-jz-view-raw').removeClass('jz-hidden');
            $('#box-jz-view-summary').addClass('jz-hidden');
            $('#jz-raw-filter-metric').removeClass('jz-hidden');
            $('#btn-jz-export-raw-attendance').removeClass('jz-hidden');
            $('#btn-jz-export-summary-attendance').addClass('jz-hidden');
        } else {
            $('#box-jz-view-raw').addClass('jz-hidden');
            $('#box-jz-view-summary').removeClass('jz-hidden');
            $('#jz-raw-filter-metric').addClass('jz-hidden');
            $('#btn-jz-export-raw-attendance').addClass('jz-hidden');
            $('#btn-jz-export-summary-attendance').removeClass('jz-hidden');
        }
    });

    // 原始打卡矩阵维度过滤
    $('#jz-raw-filter-metric .jz-segment-btn').on('click', function() {
        $('#jz-raw-filter-metric .jz-segment-btn').removeClass('active');
        $(this).addClass('active');
        raw_metric_filter = $(this).data('metric');
        render_raw_attendance_table();
    });

    function render_raw_attendance_table() {
        const thead = $('#thead-jz-raw-attendance');
        const tbody = $('#tbody-jz-raw-attendance');
        thead.empty();
        tbody.empty();

        if (!attendance_cache || attendance_cache.length === 0) {
            tbody.html('<tr><td colspan="45" class="jz-empty-cell">当前月份尚未上传考勤表，请点击“上传月度考勤 (Excel)”按钮。</td></tr>');
            return;
        }

        // 日期、班休和计时倍率由服务端法定日历统一提供，旧记录仍可回退到自身明细。
        let days = attendance_calendar_days.slice();
        if (days.length === 0) {
            for (let i = 0; i < attendance_cache.length; i++) {
                const parsed = get_attendance_daily_records(attendance_cache[i]);
                if (parsed.length > 0) {
                    days = parsed;
                    break;
                }
            }
        }

        if (!days || days.length === 0) {
            tbody.html('<tr><td colspan="45" class="jz-empty-cell">该月份无每日结构化打卡明细。</td></tr>');
            return;
        }

        // 1. 构建表头
        let thHtml = `
            <tr>
                <th class="jz-col-seq jz-col-sticky-1">序号</th>
                <th class="jz-col-no jz-col-sticky-2">工号</th>
                <th class="jz-col-name jz-col-sticky-3">姓名</th>
                <th class="jz-raw-col-metric jz-col-sticky-4">打卡项目</th>
        `;

        days.forEach(d => {
            let cls = 'jz-raw-day-th';
            const multiplier = flt(d.rate_multiplier || d.multiplier || 1);
            const tag = d.day_status || (multiplier === 1 ? '班' : '休');
            const dayType = String(d.day_type || d.nature || '');
            if (multiplier === 2) {
                cls += ' jz-th-weekend';
            } else if (multiplier >= 3) {
                cls += ' jz-th-holiday';
            }
            const title = `${d.date || ''} · ${dayType || tag} · 计时倍率 ${multiplier}`;
            thHtml += `
                <th class="${cls}" title="${esc(title)}">
                    <div class="jz-th-daynum">${esc(d.day)}日</div>
                    <div class="jz-th-tag">${esc(tag)}</div>
                    <div class="jz-th-multiplier">计时倍率 ${esc(multiplier)}</div>
                </th>
            `;
        });

        thHtml += `
                <th class="jz-text-right">正班工时</th>
                <th class="jz-text-right">平日加班</th>
                <th class="jz-text-right">周末加班</th>
                <th class="jz-text-right">节日加班</th>
                <th class="jz-text-right">倒休工时</th>
                <th class="jz-text-right">餐补次数</th>
            </tr>
        `;
        thead.html(thHtml);

        // 2. 筛选展示的打卡项目
        const allMetrics = [
            { key: 'shifts', label: '班次', badgeCls: 'jz-mb-shift' },
            { key: 'work', label: '作业工时', badgeCls: 'jz-mb-work' },
            { key: 'ot', label: '加班工时', badgeCls: 'jz-mb-ot' },
            { key: 'meal', label: '订餐', badgeCls: 'jz-mb-meal' },
            { key: 'remark', label: '备注', badgeCls: 'jz-mb-remark' }
        ];

        let activeMetrics = allMetrics;
        if (raw_metric_filter !== 'all') {
            activeMetrics = allMetrics.filter(m => m.key === raw_metric_filter);
        }
        const rSpan = activeMetrics.length;

        // 3. 逐人渲染行
        attendance_cache.forEach((emp, idx) => {
            let empDays = [];
            empDays = get_attendance_daily_records(emp);
            const dayMap = {};
            empDays.forEach(d => { dayMap[d.day] = d; });

            activeMetrics.forEach((m, mIdx) => {
                const isFirst = (mIdx === 0);
                const isLast = (mIdx === rSpan - 1);
                let rowCls = isLast ? 'jz-raw-row-boundary' : '';

                let trHtml = `<tr class="${rowCls}">`;

                if (isFirst) {
                    trHtml += `
                        <td class="jz-col-seq jz-col-sticky-1" rowspan="${rSpan}">${idx + 1}</td>
                        <td class="jz-col-no jz-col-sticky-2" rowspan="${rSpan}"><strong>${esc(emp.employee_no)}</strong></td>
                        <td class="jz-col-name jz-col-sticky-3" rowspan="${rSpan}"><strong>${esc(emp.employee_name)}</strong></td>
                    `;
                }

                trHtml += `
                    <td class="jz-raw-col-metric jz-col-sticky-4">
                        <span class="jz-metric-badge ${m.badgeCls}">${m.label}</span>
                    </td>
                `;

                // 逐日单元格
                days.forEach(d => {
                    const dayRec = dayMap[d.day] || {};
                    let cellVal = '-';
                    let cellCls = '';
                    const multiplier = flt(d.rate_multiplier || d.multiplier || 1);
                    if (multiplier === 2) cellCls += ' jz-cell-weekend';
                    else if (multiplier >= 3) cellCls += ' jz-cell-holiday';

                    if (m.key === 'shifts') {
                        cellVal = dayRec.shift || '-';
                        cellCls += ' jz-raw-val-shift';
                    } else if (m.key === 'work') {
                        const wh = flt(dayRec.work_hours);
                        cellVal = wh > 0 ? wh.toFixed(1) : '-';
                        cellCls += ' jz-raw-val-work';
                    } else if (m.key === 'ot') {
                        const ot = flt(dayRec.overtime);
                        cellVal = ot > 0 ? '+' + ot.toFixed(1) : '-';
                        cellCls += ' jz-raw-val-ot';
                    } else if (m.key === 'meal') {
                        const ml = cint(dayRec.meal);
                        cellVal = ml > 0 ? ml : '-';
                        cellCls += ' jz-raw-val-meal';
                    } else if (m.key === 'remark') {
                        cellVal = dayRec.remark || '-';
                        cellCls += ' jz-raw-val-remark';
                    }

                    trHtml += `<td class="${cellCls}">${esc(cellVal)}</td>`;
                });

                if (isFirst) {
                    trHtml += `
                        <td class="jz-num-cell jz-text-info" rowspan="${rSpan}">${fmtHours(emp.work_hours_regular)}</td>
                        <td class="jz-num-cell" rowspan="${rSpan}">${fmtHours(emp.overtime_regular_1_5)}</td>
                        <td class="jz-num-cell" rowspan="${rSpan}">${fmtHours(emp.overtime_weekend_2_0)}</td>
                        <td class="jz-num-cell" rowspan="${rSpan}">${fmtHours(emp.overtime_holiday_3_0)}</td>
                        <td class="jz-num-cell jz-text-muted" rowspan="${rSpan}">${fmtHours(emp.leave_compensatory_hours)}</td>
                        <td class="jz-num-cell jz-text-success" rowspan="${rSpan}">${emp.meal_count || 0} 次</td>
                    `;
                }

                trHtml += '</tr>';
                tbody.append(trHtml);
            });
        });
    }

    // 导出原始考勤表 (Excel / CSV)
    $('#btn-jz-export-raw-attendance').on('click', function() {
        if (!attendance_cache || attendance_cache.length === 0) {
            frappe.msgprint('当前月份暂无考勤数据可导出');
            return;
        }
        let days = [];
        for (let i = 0; i < attendance_cache.length; i++) {
            if (attendance_cache[i].daily_records_json) {
                try {
                    days = JSON.parse(attendance_cache[i].daily_records_json);
                    if (days && days.length > 0) break;
                } catch(e) {}
            }
        }
        let csv = '\uFEFF序号,工号,姓名,打卡项目,' + days.map(d => `${d.day}日(${d.nature || ''})`).join(',') + ',正班工时,平日加班,周末加班,节日加班,倒休工时,餐补次数\n';
        attendance_cache.forEach((emp, idx) => {
            let empDays = [];
            try {
                if (emp.daily_records_json) empDays = JSON.parse(emp.daily_records_json);
            } catch(e) {}
            const dayMap = {};
            empDays.forEach(d => { dayMap[d.day] = d; });

            const metricDefs = [
                { key: 'shifts', label: '班次' },
                { key: 'work', label: '作业工时' },
                { key: 'ot', label: '加班工时' },
                { key: 'meal', label: '订餐' },
                { key: 'remark', label: '备注' }
            ];

            metricDefs.forEach((m, mIdx) => {
                let row = [
                    mIdx === 0 ? (idx + 1) : '',
                    mIdx === 0 ? emp.employee_no : '',
                    mIdx === 0 ? `"${emp.employee_name}"` : '',
                    m.label
                ];
                days.forEach(d => {
                    const dayRec = dayMap[d.day] || {};
                    let v = '';
                    if (m.key === 'shifts') v = dayRec.shift || '';
                    else if (m.key === 'work') v = dayRec.work_hours > 0 ? flt(dayRec.work_hours).toFixed(1) : '';
                    else if (m.key === 'ot') v = dayRec.overtime > 0 ? flt(dayRec.overtime).toFixed(1) : '';
                    else if (m.key === 'meal') v = dayRec.meal > 0 ? dayRec.meal : '';
                    else if (m.key === 'remark') v = (dayRec.remark || '').replace(/"/g, '""');
                    row.push(`"${v}"`);
                });
                if (mIdx === 0) {
                    row.push(flt(emp.work_hours_regular).toFixed(1));
                    row.push(flt(emp.overtime_regular_1_5).toFixed(1));
                    row.push(flt(emp.overtime_weekend_2_0).toFixed(1));
                    row.push(flt(emp.overtime_holiday_3_0).toFixed(1));
                    row.push(flt(emp.leave_compensatory_hours).toFixed(1));
                    row.push(emp.meal_count || 0);
                } else {
                    row.push('', '', '', '', '', '');
                }
                csv += row.join(',') + '\n';
            });
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.setAttribute('download', `吉众原始打卡考勤表_${current_month}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });

    // 导出结算汇总表 (CSV / Excel)
    $('#btn-jz-export-summary-attendance').on('click', function() {
        if (!attendance_cache || attendance_cache.length === 0) {
            frappe.msgprint('当前月份暂无考勤数据可导出');
            return;
        }
        let csv = '\uFEFF序号,工号,姓名,出勤天数,出勤正班工时,平日加班(1.5x),周末加班(2.0x),节日加班(3.0x),加班工时合计,倒休冲抵工时,实际计薪加班,订餐补贴次数,打卡备注与请假汇总\n';
        attendance_cache.forEach((it, idx) => {
            const wReg = flt(it.work_hours_regular);
            const ot15 = flt(it.overtime_regular_1_5);
            const ot20 = flt(it.overtime_weekend_2_0);
            const ot30 = flt(it.overtime_holiday_3_0);
            const cLeave = flt(it.leave_compensatory_hours);
            const mCount = cint(it.meal_count);

            const tot_ot_emp = ot15 + ot20 + ot30;
            const actual_payable_ot = ot15 + Math.max(0, ot20 - cLeave) + ot30;

            let remark_counts = {};
            let rest_days = 0;
            if (it.daily_records_json) {
                try {
                    const days = JSON.parse(it.daily_records_json);
                    days.forEach(d => {
                        if (d.remark) {
                            const rm = d.remark.trim();
                            if (rm === '休') {
                                rest_days++;
                            } else if (rm) {
                                remark_counts[rm] = (remark_counts[rm] || 0) + 1;
                            }
                        }
                    });
                } catch(e) {}
            }
            let rText = [];
            if (rest_days > 0) rText.push(`公休 ${rest_days}天`);
            for (const [rm, count] of Object.entries(remark_counts)) {
                let label = rm;
                if (rm === '事') label = '事假';
                else if (rm === '病') label = '病假';
                rText.push(`${label} ${count}天`);
            }
            const final_r = rText.length > 0 ? rText.join(' · ') : '-';

            csv += `${idx + 1},${it.employee_no},"${it.employee_name}",${it.attendance_days || 0},${wReg.toFixed(1)},${ot15.toFixed(1)},${ot20.toFixed(1)},${ot30.toFixed(1)},${tot_ot_emp.toFixed(1)},${cLeave.toFixed(1)},${actual_payable_ot.toFixed(1)},${mCount},"${final_r}"\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.setAttribute('download', `吉众月度工时分类结算汇总_${current_month}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });

    // 4. 加载现金发放与配钞点钞表
    let cash_cache = [];
    function load_cash_data() {
        read_call(
            'ashan_cn_procurement.services.jizhong_payroll_service.get_jizhong_payroll_overview',
            { company: COMPANY, period_month: current_month },
            '#tbody-jz-cash',
            12,
            function(message) {
                const items = message.items || [];
                const bSum = message.bill_summary || {};
                cash_cache = items;

                $('#stat-cash-total').text(window.AshanUI.formatMoney(bSum.total_cash || 0));
                $('#stat-b100').text((bSum.bills_100 || 0) + ' 张');
                $('#stat-b50').text((bSum.bills_50 || 0) + ' 张');
                $('#stat-b10').text((bSum.bills_10 || 0) + ' 张');
                $('#stat-b5').text((bSum.bills_5 || 0) + ' 张');
                $('#stat-b1').text((bSum.bills_1 || 0) + ' 张');

                const tbody = $('#tbody-jz-cash');
                tbody.empty();

                let tot_net = 0, tot_cash = 0;
                let t_100 = 0, t_50 = 0, t_10 = 0, t_5 = 0, t_1 = 0;

                items.forEach((it, idx) => {
                    tot_net += flt(it.net_salary);
                    tot_cash += flt(it.cash_pay);
                    t_100 += cint(it.bills_100);
                    t_50 += cint(it.bills_50);
                    t_10 += cint(it.bills_10);
                    t_5 += cint(it.bills_5);
                    t_1 += cint(it.bills_1);

                    tbody.append(`
                        <tr>
                            <td class="jz-col-seq">${idx + 1}</td>
                            <td class="jz-col-no"><strong>${esc(it.employee_no)}</strong></td>
                            <td class="jz-col-name"><strong>${esc(it.employee_name)}</strong></td>
                            <td class="jz-money-cell">${window.AshanUI.formatMoney(it.net_salary)}</td>
                            <td class="jz-money-cell jz-money-cash">${window.AshanUI.formatMoney(it.cash_pay)}</td>
                            <td class="jz-num-cell">${it.bills_100 || 0}</td>
                            <td class="jz-num-cell">${it.bills_50 || 0}</td>
                            <td class="jz-num-cell">${it.bills_10 || 0}</td>
                            <td class="jz-num-cell">${it.bills_5 || 0}</td>
                            <td class="jz-num-cell">${it.bills_1 || 0}</td>
                            <td class="jz-money-cell jz-money-bold">${window.AshanUI.formatMoney(it.cash_pay)}</td>
                            <td class="jz-sign-cell">签字</td>
                        </tr>
                    `);
                });

                $('#jz-cash-rounding-diff').text(
                    `取整差额：${window.AshanUI.formatMoney(tot_cash - tot_net)}`
                );
                if (!items.length) {
                    set_table_state('#tbody-jz-cash', 12, '本月尚未生成工资表，请先完成考勤、配置和薪酬测算。');
                    $('#tfoot-jz-cash').empty();
                    return;
                }

                $('#tfoot-jz-cash').html(`
                    <tr>
                        <td colspan="3" class="jz-col-foot-label">合计 (${items.length}人)</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_net)}</td>
                        <td class="jz-money-cell jz-money-cash">${window.AshanUI.formatMoney(tot_cash)}</td>
                        <td class="jz-num-cell">${t_100}</td>
                        <td class="jz-num-cell">${t_50}</td>
                        <td class="jz-num-cell">${t_10}</td>
                        <td class="jz-num-cell">${t_5}</td>
                        <td class="jz-num-cell">${t_1}</td>
                        <td class="jz-money-cell jz-money-bold">${window.AshanUI.formatMoney(tot_cash)}</td>
                        <td>-</td>
                    </tr>
                `);
            },
            '正在读取现金配钞明细…'
        );
    }

    function print_a4_slips() {
        const items = cash_cache.length ? cash_cache : payroll_cache;
        if (!items.length) {
            frappe.msgprint('本月尚未生成工资条，请先完成薪酬测算。');
            return;
        }
        const printWindow = window.open('', '_blank', 'noopener,noreferrer');
        if (!printWindow) {
            frappe.msgprint('浏览器阻止了打印窗口，请允许弹出窗口后重试。');
            return;
        }
        const money = value => window.AshanUI.formatMoney(value);
        const slips = items.map(it => `
            <section class="jz-print-slip">
                <h1>天津吉众科技有限公司工资签收单</h1>
                <p class="jz-print-period">核定账期：${esc(current_month)}　实际缴费所属期：${esc(next_period(current_month))}</p>
                <div class="jz-print-meta"><span>工号：${esc(it.employee_no)}</span><span>姓名：${esc(it.employee_name)}</span><span>用工性质：${esc(it.employee_type)}</span></div>
                <table><tbody>
                    <tr><th>应发薪资</th><td>${money(it.gross_salary)}</td><th>个人社保</th><td>${money(it.ss_person_total)}</td></tr>
                    <tr><th>个人公积金</th><td>${money(it.hf_person_total)}</td><th>代扣个税</th><td>${money(it.tax_amount)}</td></tr>
                    <tr><th>实发工资</th><td>${money(it.net_salary)}</td><th>现金发放</th><td>${money(it.cash_pay)}</td></tr>
                </tbody></table>
                <p class="jz-print-sign">本人确认以上工资及代扣项目无误。　员工签字：________________　日期：____________</p>
            </section>
        `).join('');
        printWindow.document.open();
        printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>吉众工资签收单 ${esc(current_month)}</title><link rel="stylesheet" href="/assets/ashan_cn_procurement/css/jizhong_hr_salary_workbench.css"></head><body class="jz-print-sheet">${slips}</body></html>`);
        printWindow.document.close();
        printWindow.focus();
        printWindow.setTimeout(() => printWindow.print(), 250);
    }

    $('#btn-jz-print-a4-slips').on('click', print_a4_slips);

    $('#btn-jz-export-cash').on('click', function() {
        if (!cash_cache.length) {
            frappe.msgprint('本月尚未生成配钞明细，请先完成薪酬测算。');
            return;
        }
        download_csv(
            `吉众现金配钞明细_${current_month}.csv`,
            ['工号', '姓名', '实发工资', '现金发放', '100元券', '50元券', '10元券', '5元券', '1元券', '取整差额'],
            cash_cache.map(it => [
                it.employee_no, it.employee_name, flt(it.net_salary).toFixed(2), flt(it.cash_pay).toFixed(2),
                cint(it.bills_100), cint(it.bills_50), cint(it.bills_10), cint(it.bills_5), cint(it.bills_1),
                flt(it.cash_pay - it.net_salary).toFixed(2)
            ])
        );
    });

    // 4. 加载个人所得税台账
    function load_tax_data() {
        read_call(
            'ashan_cn_procurement.services.jizhong_payroll_service.get_jizhong_payroll_overview',
            { company: COMPANY, period_month: current_month },
            '#tbody-jz-tax',
            11,
            function(message) {
                const items = message.items || [];
                payroll_cache = items;
                const tbody = $('#tbody-jz-tax');
                tbody.empty();

                if (!items.length) {
                    set_table_state('#tbody-jz-tax', 11, '本月尚未生成个税记录，请先完成薪酬测算。');
                    return;
                }

                items.forEach((it, idx) => {
                    tbody.append(`
                        <tr>
                            <td class="jz-col-seq">${idx + 1}</td>
                            <td class="jz-col-no"><strong>${esc(it.employee_no)}</strong></td>
                            <td class="jz-col-name"><strong>${esc(it.employee_name)}</strong></td>
                            <td>${esc(it.salary_mode)}</td>
                            <td class="jz-money-cell jz-money-bold">${window.AshanUI.formatMoney(it.gross_salary)}</td>
                            <td class="jz-money-cell">${window.AshanUI.formatMoney(it.tax_threshold || 5000)}</td>
                            <td class="jz-money-cell">${window.AshanUI.formatMoney(it.ss_person_total)}</td>
                            <td class="jz-money-cell">${window.AshanUI.formatMoney(it.hf_person_total)}</td>
                            <td class="jz-money-cell">${window.AshanUI.formatMoney(it.special_deductions_total)}</td>
                            <td class="jz-money-cell jz-text-warn">${window.AshanUI.formatMoney(it.tax_amount)}</td>
                            <td class="jz-money-cell jz-money-primary">${window.AshanUI.formatMoney(it.net_salary)}</td>
                        </tr>
                    `);
                });
            },
            '正在读取本月个税记录…'
        );
    }

    // 1. 加载员工薪资信息表 (对应 Excel [人员薪资信息] sheets)
    let employees_cache = [];

    function load_employees_data() {
        read_call(
            'ashan_cn_procurement.services.jizhong_payroll_service.get_jizhong_employee_profiles',
            { company: COMPANY, period_month: current_month },
            '#tbody-jz-employees',
            17,
            function(message) {
                employees_cache = message || [];
                render_employees_table();
            },
            '正在读取员工薪资档案…'
        );
    }

    function render_employees_table() {
        const tbody = $('#tbody-jz-employees');
        tbody.empty();
        const employeesConfirmed = Boolean(get_workflow_step('employees')?.is_confirmed);

        const searchKw = ($('#jz-emp-search').val() || '').trim().toLowerCase();
        const typeFilter = $('#jz-emp-type-filter .jz-segment-btn.active').data('type') || 'all';

        let filtered = employees_cache.filter(it => {
            if (searchKw) {
                const matchKw = (it.employee_no || '').toLowerCase().includes(searchKw) ||
                                (it.employee_name || '').toLowerCase().includes(searchKw) ||
                                (it.id_card || '').toLowerCase().includes(searchKw) ||
                                (it.salary_mode || '').toLowerCase().includes(searchKw);
                if (!matchKw) return false;
            }
            if (typeFilter === 'regular') return employee_category(it.employee_type, it.employment_status) === '正式工';
            if (typeFilter === 'other') return employee_category(it.employee_type, it.employment_status) !== '正式工';
            return true;
        });

        if (filtered.length === 0) {
            tbody.html('<tr><td colspan="17" class="jz-empty-cell">暂无符合条件的员工薪资档案</td></tr>');
            $('#tfoot-jz-employees').empty();
            $('#jz-emp-kpi-count').text('0 人');
            $('#jz-emp-kpi-base').text(window.AshanUI.formatMoney(0));
            $('#jz-emp-kpi-allowance').text(window.AshanUI.formatMoney(0));
            $('#jz-emp-kpi-post').text(window.AshanUI.formatMoney(0));
            $('#jz-emp-kpi-perf').text(window.AshanUI.formatMoney(0));
            $('#jz-emp-kpi-ins').text(window.AshanUI.formatMoney(0));
            $('#jz-emp-kpi-ss').text(window.AshanUI.formatMoney(0));
            $('#jz-emp-kpi-hf').text(window.AshanUI.formatMoney(0));
            return;
        }

        let tot_base = 0, tot_sub = 0, tot_perf = 0, tot_post = 0, tot_ss = 0, tot_hf = 0, tot_ded = 0;

        filtered.forEach((it, idx) => {
            const bSal = flt(it.base_salary);
            const bSub = flt(it.house_rent_allowance) || flt(it.other_allowance) || 0;
            const perf = flt(it.performance_base);
            const post = flt(it.post_allowance);
            const meal = flt(it.meal_allowance);
            const ssBase = flt(it.effective_social_security_base);
            const hfBase = flt(it.effective_housing_fund_base);
            const ssBaseMode = it.social_security_base_source || '历史基数，待选择';
            const hfBaseMode = it.housing_fund_base_source || '历史基数，待选择';
            const dedTotal = flt(it.deduction_child_education) + flt(it.deduction_continuing_education) +
                             flt(it.deduction_housing_loan) + flt(it.deduction_housing_rent) +
                             flt(it.deduction_elderly_care) + flt(it.deduction_infant_care) + flt(it.deduction_serious_illness);

            tot_base += bSal;
            tot_sub += bSub;
            tot_perf += perf;
            tot_post += post;
            tot_ss += ssBase;
            tot_hf += hfBase;
            tot_ded += dedTotal;

            const isMgmt = it.salary_mode && it.salary_mode.includes('税后管理');
            const category = employee_category(it.employee_type, it.employment_status);
            const netAgreed = isMgmt ? window.AshanUI.formatMoney(it.fixed_salary) : '-';
            const employmentStatus = String(it.employment_status || '在职').trim();
            const statusClass = employmentStatus === '在职' ? 'jz-status-active' : 'jz-status-inactive';

            tbody.append(`
                <tr class="jz-emp-row jz-row-clickable" data-name="${esc(it.name)}" data-empno="${esc(it.employee_no)}">
                    <td class="jz-col-seq jz-col-sticky-1">${idx + 1}</td>
                    <td class="jz-col-no jz-col-sticky-2"><strong>${esc(it.employee_no)}</strong></td>
                    <td class="jz-col-name jz-col-sticky-3" title="${esc(it.employee_name)}"><strong>${esc(it.employee_name)}</strong></td>
                    <td class="jz-font-mono jz-employee-id-cell" title="${esc(it.id_card || '-')}">${esc(it.id_card || '-')}</td>
                    <td class="jz-employee-type-cell">${esc(category)}</td>
                    <td>${esc(it.salary_mode || '税前动态工资')}</td>
                    <td class="jz-money-cell ${isMgmt ? 'jz-money-bold jz-text-primary' : ''}">${netAgreed}</td>
                    <td class="jz-money-cell jz-text-info">${window.AshanUI.formatMoney(bSal)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(bSub)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(perf)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(post)}</td>
                    <td class="jz-money-cell">${meal > 0 ? window.AshanUI.formatMoney(meal) + ' / 份' : '-'}</td>
                    <td class="jz-money-cell" title="${esc(ssBaseMode)}：按 ${esc(current_month)} 社保公积金配置读取">${window.AshanUI.formatMoney(ssBase)}<small class="jz-cell-note">${esc(ssBaseMode)}</small></td>
                    <td class="jz-money-cell" title="${esc(hfBaseMode)}：按 ${esc(current_month)} 社保公积金配置读取；长期策略：${esc(it.housing_fund_policy || '跟随公司规则')}">${window.AshanUI.formatMoney(hfBase)}<small class="jz-cell-note">${esc(hfBaseMode)} · ${esc(it.housing_fund_policy || '跟随公司规则')}</small></td>
                    <td class="jz-money-cell jz-text-warn">${dedTotal > 0 ? window.AshanUI.formatMoney(dedTotal) : '-'}</td>
                    <td class="jz-text-center"><span class="jz-status-badge ${statusClass}">${esc(employmentStatus)}</span></td>
                    <td class="jz-col-action"><button type="button" class="jz-btn-action jz-btn-edit-emp" data-empno="${esc(it.employee_no)}"${employeesConfirmed ? ' disabled title="本账期员工薪资档案已确认，请先取消确认后修改"' : ''}>${employeesConfirmed ? '已确认只读' : '编辑档案'}</button></td>
                </tr>
            `);
        });

        // 绑定行点击与编辑按钮事件
        tbody.find('.jz-btn-edit-emp').on('click', function(e) {
            e.stopPropagation();
            const empNo = $(this).data('empno');
            const emp = employees_cache.find(it => it.employee_no === empNo);
            if (emp) open_jizhong_employee_edit_dialog(emp, false);
        });

        tbody.find('.jz-emp-row').on('click', function() {
            const empNo = $(this).data('empno');
            const emp = employees_cache.find(it => it.employee_no === empNo);
            if (emp) open_jizhong_employee_edit_dialog(emp, false);
        });

        // 汇总卡片更新
        $('#jz-emp-kpi-count').text(`${filtered.length} 人`);
        $('#jz-emp-kpi-base').text(window.AshanUI.formatMoney(tot_base));
        $('#jz-emp-kpi-allowance').text(window.AshanUI.formatMoney(tot_sub + tot_perf + tot_post));
        $('#jz-emp-kpi-post').text(window.AshanUI.formatMoney(tot_post));
        $('#jz-emp-kpi-perf').text(window.AshanUI.formatMoney(tot_perf));
        $('#jz-emp-kpi-ins').text(window.AshanUI.formatMoney(tot_ss + tot_hf));
        $('#jz-emp-kpi-ss').text(window.AshanUI.formatMoney(tot_ss));
        $('#jz-emp-kpi-hf').text(window.AshanUI.formatMoney(tot_hf));

        // 底部合计行
        $('#tfoot-jz-employees').html(`
            <tr>
                <td colspan="3" class="jz-col-foot-label">合计 (${filtered.length}人)</td>
                <td>-</td>
                <td>-</td>
                <td>-</td>
                <td>-</td>
                <td class="jz-money-cell jz-text-info">${window.AshanUI.formatMoney(tot_base)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_sub)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_perf)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_post)}</td>
                <td>-</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_ss)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_hf)}</td>
                <td class="jz-money-cell jz-text-warn">${window.AshanUI.formatMoney(tot_ded)}</td>
                <td class="jz-text-center">-</td>
                <td class="jz-col-action">-</td>
            </tr>
        `);
    }

    // 员工档案编辑与明细修改弹窗 (对标祺富工作台高质量交互)
    function open_jizhong_employee_edit_dialog(emp_data, is_new) {
        if (get_workflow_step('employees')?.is_confirmed) {
            frappe.msgprint('本账期员工薪资档案已确认并处于只读保护，请先取消确认后再修改。');
            return;
        }
        emp_data = emp_data || {};
        const isEdit = !is_new && emp_data.employee_no;

        const d = window.AshanUI.createDialog({
            title: isEdit ? `修改员工薪资档案 · ${emp_data.employee_name} (${emp_data.employee_no})` : `新增吉众员工薪酬档案`,
            size: 'large',
            fields: [
                { fieldtype: 'Section Break', label: '基本身份与用工' },
                { fieldtype: 'Data', fieldname: 'employee_no', label: '工号', reqd: 1, default: emp_data.employee_no || '', read_only: isEdit ? 1 : 0 },
                { fieldtype: 'Data', fieldname: 'employee_name', label: '员工姓名', reqd: 1, default: emp_data.employee_name || '' },
                { fieldtype: 'Select', fieldname: 'certificate_type', label: '证件类型', options: ['居民身份证','护照','港澳台居民居住证/通行证','外国人永久居留身份证','其他'], default: emp_data.certificate_type || '居民身份证' },
                { fieldtype: 'Data', fieldname: 'id_card', label: '证件号码', default: emp_data.id_card || '' },
                { fieldtype: 'Button', fieldname: 'btn_parse_id_card', label: '自动识别身份证性别出生日期' },
                { fieldtype: 'Column Break' },
                { fieldtype: 'Select', fieldname: 'gender', label: '性别', options: ['','男','女'], default: emp_data.gender || '' },
                { fieldtype: 'Date', fieldname: 'birth_date', label: '出生日期', default: emp_data.birth_date || '' },
                { fieldtype: 'Data', fieldname: 'mobile', label: '手机号', default: emp_data.mobile || '' },
                { fieldtype: 'Select', fieldname: 'employee_type', label: '用工性质', options: ['正式工','退休返聘人员','临时工','其他类型员工','本月离职人员'], default: employee_category(emp_data.employee_type, emp_data.employment_status) },
                { fieldtype: 'Select', fieldname: 'employment_status', label: '在职状态', options: ['在职','离职'], default: emp_data.employment_status || '在职' },

                { fieldtype: 'Section Break', label: '薪酬长期要素' },
                { fieldtype: 'Select', fieldname: 'salary_mode', label: '计薪方式', options: ['税前动态工资','税后管理工资'], default: emp_data.salary_mode || '税前动态工资' },
                { fieldtype: 'Currency', fieldname: 'fixed_salary', label: '实发约定净薪 (元)', default: emp_data.fixed_salary || 0, description: '税后管理岗如陈亮、苏锡成约定实发金额' },
                { fieldtype: 'Currency', fieldname: 'base_salary', label: '基本工资 (元)', default: emp_data.base_salary || 0, reqd: 1 },
                { fieldtype: 'Column Break' },
                { fieldtype: 'Currency', fieldname: 'house_rent_allowance', label: '基本补贴 (元)', default: emp_data.house_rent_allowance || 0 },
                { fieldtype: 'Currency', fieldname: 'performance_base', label: '绩效奖金 (元)', default: emp_data.performance_base || 0 },
                { fieldtype: 'Currency', fieldname: 'post_allowance', label: '职位津贴 (元)', default: emp_data.post_allowance || 0 },
                { fieldtype: 'Currency', fieldname: 'meal_allowance', label: '餐补单价 (元/餐)', default: emp_data.meal_allowance || 15.0 },

                { fieldtype: 'Section Break', label: '社保与公积金申报基数' },
                { fieldtype: 'Select', fieldname: 'social_security_base_mode', label: '社险申报基数方式', options: ['','最低缴费基数','自定义'], default: emp_data.social_security_base_mode || '', reqd: 1, description: `最低缴费基数会自动读取 ${current_month} 社保公积金配置；自定义只影响该员工。` },
                { fieldtype: 'Currency', fieldname: 'custom_social_security_base', label: '自定义社险基数 (元)', default: emp_data.custom_social_security_base || 0, depends_on: 'eval:doc.social_security_base_mode=="自定义"' },
                { fieldtype: 'Column Break' },
                { fieldtype: 'Select', fieldname: 'housing_fund_base_mode', label: '公积金申报基数方式', options: ['','最低缴费基数','自定义'], default: emp_data.housing_fund_base_mode || '', reqd: 1, description: `最低缴费基数会自动读取 ${current_month} 社保公积金配置；自定义只影响该员工。` },
                { fieldtype: 'Currency', fieldname: 'custom_housing_fund_base', label: '自定义公积金基数 (元)', default: emp_data.custom_housing_fund_base || 0, depends_on: 'eval:doc.housing_fund_base_mode=="自定义"' },
                { fieldtype: 'Select', fieldname: 'housing_fund_policy', label: '公积金长期缴纳策略', options: ['跟随公司规则','固定缴纳','固定停缴'], default: emp_data.housing_fund_policy || '跟随公司规则', description: '本月实际缴费月份由核定账期次月决定。' },

                { fieldtype: 'Section Break', label: '7项个税专项附加扣除详情 (元/月)' },
                { fieldtype: 'Currency', fieldname: 'deduction_child_education', label: '子女教育', default: emp_data.deduction_child_education || 0 },
                { fieldtype: 'Currency', fieldname: 'deduction_continuing_education', label: '继续教育', default: emp_data.deduction_continuing_education || 0 },
                { fieldtype: 'Currency', fieldname: 'deduction_serious_illness', label: '大病医疗', default: emp_data.deduction_serious_illness || 0 },
                { fieldtype: 'Currency', fieldname: 'deduction_housing_loan', label: '住房贷款利息', default: emp_data.deduction_housing_loan || 0 },
                { fieldtype: 'Column Break' },
                { fieldtype: 'Currency', fieldname: 'deduction_housing_rent', label: '住房租金', default: emp_data.deduction_housing_rent || 0 },
                { fieldtype: 'Currency', fieldname: 'deduction_elderly_care', label: '赡养老人', default: emp_data.deduction_elderly_care || 0 },
                { fieldtype: 'Currency', fieldname: 'deduction_infant_care', label: '3岁以下婴幼儿照护', default: emp_data.deduction_infant_care || 0 },

                { fieldtype: 'Section Break', label: '银行卡与备注' },
                { fieldtype: 'Data', fieldname: 'bank_name', label: '开户银行', default: emp_data.bank_name || '' },
                { fieldtype: 'Data', fieldname: 'bank_account', label: '银行卡号', default: emp_data.bank_account || '' },
                { fieldtype: 'Column Break' },
                { fieldtype: 'Small Text', fieldname: 'notes', label: '备注说明', default: emp_data.notes || '' }
            ],
            primary_action_label: isEdit ? '保存修改' : '立即创建',
            primary_action(vals) {
                vals.company = COMPANY;
                vals.period_month = current_month;
                if (isEdit) {
                    vals.name = emp_data.name;
                }
                run_write_action(d.get_primary_btn(), {
                    method: 'ashan_cn_procurement.services.jizhong_payroll_service.save_jizhong_employee_profile',
                    args: { data: JSON.stringify(vals) },
                    busyText: '正在保存…',
                    success: function(result) {
                        frappe.show_alert({ message: result.message, indicator: 'green' });
                        d.hide();
                        load_employees_data();
                        load_workflow_status();
                    },
                    error: function(message) {
                        frappe.show_alert({ message, indicator: 'red' });
                    }
                });
            }
        });

        // 识别身份证号码获取出生日期和性别
        function parse_and_apply_id_card(silent) {
            const certType = d.get_value('certificate_type') || '居民身份证';
            if (certType !== '居民身份证') {
                if (!silent) {
                    frappe.msgprint('当前证件类型非居民身份证，无法自动识别，请手动选择性别与出生日期。');
                }
                return;
            }
            const idVal = (d.get_value('id_card') || '').trim().toUpperCase();
            if (!idVal) {
                if (!silent) frappe.msgprint('请先输入居民身份证号码。');
                return;
            }
            if (idVal.length === 18 && /^\d{17}[\dXx]$/.test(idVal)) {
                const year = idVal.substring(6, 10);
                const month = idVal.substring(10, 12);
                const day = idVal.substring(12, 14);
                const birthDate = `${year}-${month}-${day}`;
                const genderCode = parseInt(idVal.substring(16, 17), 10);
                const gender = (genderCode % 2 === 1) ? '男' : '女';

                d.set_value('birth_date', birthDate);
                d.set_value('gender', gender);
                if (!silent) {
                    frappe.show_alert({
                        message: `身份证识别成功：${gender}性，出生日期 ${birthDate}`,
                        indicator: 'green'
                    });
                }
            } else if (idVal.length === 15 && /^\d{15}$/.test(idVal)) {
                const year = '19' + idVal.substring(6, 8);
                const month = idVal.substring(8, 10);
                const day = idVal.substring(10, 12);
                const birthDate = `${year}-${month}-${day}`;
                const genderCode = parseInt(idVal.substring(14, 15), 10);
                const gender = (genderCode % 2 === 1) ? '男' : '女';

                d.set_value('birth_date', birthDate);
                d.set_value('gender', gender);
                if (!silent) {
                    frappe.show_alert({
                        message: `身份证识别成功：${gender}性，出生日期 ${birthDate}`,
                        indicator: 'green'
                    });
                }
            } else if (!silent) {
                frappe.msgprint('请输入有效的18位居民身份证号码。');
            }
        }

        d.show();

        // 绑定按钮事件与失去焦点自动识别
        if (d.fields_dict.btn_parse_id_card) {
            const $btn = d.fields_dict.btn_parse_id_card.$input || $(d.fields_dict.btn_parse_id_card.input);
            $btn.on('click', function() {
                parse_and_apply_id_card(false);
            });
        }
        if (d.fields_dict.id_card && d.fields_dict.id_card.$input) {
            d.fields_dict.id_card.$input.on('blur', function() {
                if ((d.get_value('certificate_type') || '居民身份证') === '居民身份证') {
                    const val = (d.get_value('id_card') || '').trim();
                    if (val.length === 18 && (!d.get_value('birth_date') || !d.get_value('gender'))) {
                        parse_and_apply_id_card(true);
                    }
                }
            });
        }
    }

    // 搜索与过滤事件绑定
    $('#jz-emp-search').on('input', function() {
        render_employees_table();
    });

    $('#jz-emp-type-filter .jz-segment-btn').on('click', function() {
        $('#jz-emp-type-filter .jz-segment-btn').removeClass('active');
        $(this).addClass('active');
        $('#jz-emp-type-filter .jz-segment-btn').attr('aria-pressed', 'false');
        $(this).attr('aria-pressed', 'true');
        render_employees_table();
    });

    // 导出员工薪资信息表 (Excel CSV 带 UTF-8 BOM)
    $('#btn-jz-export-employees').on('click', function() {
        if (!employees_cache || employees_cache.length === 0) {
            frappe.msgprint('暂无员工薪资信息可导出');
            return;
        }
        let csv = '\uFEFF序号,工号,姓名,身份证号,用工性质,计薪方式,实发约定净薪,基本工资,基本补贴,绩效奖金,职位津贴,餐补单价,社险基数,公积金基数,专项附加扣除,在职状态\n';
        employees_cache.forEach((it, idx) => {
            const bSal = flt(it.base_salary);
            const bSub = flt(it.house_rent_allowance) || flt(it.other_allowance) || 0;
            const perf = flt(it.performance_base);
            const post = flt(it.post_allowance);
            const meal = flt(it.meal_allowance);
            const ssBase = flt(it.effective_social_security_base);
            const hfBase = flt(it.effective_housing_fund_base);
            const dedTotal = flt(it.deduction_child_education) + flt(it.deduction_continuing_education) +
                             flt(it.deduction_housing_loan) + flt(it.deduction_housing_rent) +
                             flt(it.deduction_elderly_care) + flt(it.deduction_infant_care) + flt(it.deduction_serious_illness);
            const isMgmt = it.salary_mode && it.salary_mode.includes('税后管理');
            const netAgreed = isMgmt ? flt(it.fixed_salary).toFixed(2) : '-';

            csv += `${idx + 1},${it.employee_no},"${it.employee_name}","${it.id_card || ''}",${it.employee_type || '正式工'},${it.salary_mode || '税前动态工资'},${netAgreed},${bSal.toFixed(2)},${bSub.toFixed(2)},${perf.toFixed(2)},${post.toFixed(2)},${meal > 0 ? meal.toFixed(2) : '-'},${ssBase.toFixed(2)},${hfBase.toFixed(2)},${dedTotal.toFixed(2)},${it.employment_status || '在职'}\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.setAttribute('download', `吉众员工薪资信息底册_${frappe.datetime.now_date()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });

    // 新建员工薪酬档案
    $('#btn-jz-add-emp').on('click', function() {
        // Keep Jizhong records inside the dedicated Jizhong salary profile model.
        open_jizhong_employee_edit_dialog({}, true);
    });

    // 7. 加载历史薪资穿透 (421条)
    function load_history_data() {
        fetch_history_items('ALL');
    }

    $('#jz-history-month-filter').on('change', function() {
        fetch_history_items($(this).val());
    });

    function fetch_history_items(selected_month) {
        read_call(
            'ashan_cn_procurement.services.jizhong_payroll_service.get_jizhong_history_records',
            { company: COMPANY, period_month: selected_month },
            '#tbody-jz-history',
            14,
            function(message) {
                const result = message || {};
                const items = Array.isArray(result) ? result : (result.items || []);
                if (selected_month === 'ALL') {
                    const periods = [...new Set(items.map(item => String(item.period_month || '')).filter(Boolean))];
                    const select = $('#jz-history-month-filter');
                    select.empty().append($('<option>', { value: 'ALL', text: '全部历史记录' }));
                    periods.forEach(period => select.append($('<option>', { value: period, text: period })));
                }
                const tbody = $('#tbody-jz-history');
                tbody.empty();

                if (!items.length) {
                    set_table_state('#tbody-jz-history', 14, '当前筛选条件没有已封账的历史薪酬记录。');
                    return;
                }

                items.forEach((it, idx) => {
                    const pMonth = it.period_month || (it.parent ? it.parent.replace(`${COMPANY}-`, '') : '');
                    tbody.append(`
                        <tr>
                            <td class="jz-col-seq">${idx + 1}</td>
                            <td class="jz-col-no jz-text-center">${esc(pMonth)}</td>
                            <td class="jz-col-no jz-text-center jz-hist-col-empno"><strong>${esc(it.employee_no)}</strong></td>
                            <td class="jz-col-name jz-hist-col-empname"><strong>${esc(it.employee_name)}</strong></td>
                            <td>${esc(it.salary_mode)}</td>
                            <td class="jz-money-cell">${window.AshanUI.formatMoney(it.base_salary)}</td>
                            <td class="jz-money-cell">${window.AshanUI.formatMoney(it.post_allowance)}</td>
                            <td class="jz-money-cell">${window.AshanUI.formatMoney(it.performance_salary)}</td>
                            <td class="jz-money-cell jz-money-bold">${window.AshanUI.formatMoney(it.gross_salary)}</td>
                            <td class="jz-money-cell">${window.AshanUI.formatMoney(it.tax_threshold || 5000)}</td>
                            <td class="jz-money-cell">${window.AshanUI.formatMoney(flt(it.ss_person_total) + flt(it.hf_person_total))}</td>
                            <td class="jz-money-cell">${window.AshanUI.formatMoney(it.special_deductions_total)}</td>
                            <td class="jz-money-cell jz-text-warn">${window.AshanUI.formatMoney(it.tax_amount)}</td>
                            <td class="jz-money-cell jz-money-primary">${window.AshanUI.formatMoney(it.net_salary)}</td>
                        </tr>
                    `);
                });
            },
            '正在读取已封账历史薪酬…'
        );
    }

    function jz_sheet_money(value) {
        return window.AshanUI.formatMoney(value || 0);
    }

    function jz_sheet_percent(value) {
        return `${Number(value || 0).toFixed(2)}%`;
    }

    function render_insurance_sheets(sheets) {
        if (!sheets) {
            $('#jz-ins-sheet-status').text('确认员工档案和社保公积金配置后生成。');
            set_table_state('#tbody-jz-social-insurance', 13, '确认员工档案和社保公积金配置后生成。');
            set_table_state('#tbody-jz-housing-fund', 12, '确认员工档案和社保公积金配置后生成。');
            $('#tfoot-jz-social-insurance, #tfoot-jz-housing-fund').empty();
            return;
        }

        const statusText = sheets.preview_ready
            ? `${sheets.edition || '核对版（未确认）'}；核定账期 ${sheets.period_month}，实际缴费所属期 ${sheets.payment_period_month}`
            : `${sheets.reason || '前置确认尚未完成'}。`;
        $('#jz-ins-sheet-status').text(statusText);
        const social = sheets.social_insurance || {};
        const housing = sheets.housing_fund || {};
        const socialRows = social.rows || [];
        const housingRows = housing.rows || [];
        const socialTotals = social.totals || {};
        const housingTotals = housing.totals || {};

        $('#jz-social-sheet-meta').text(
            `${sheets.period_month} 核定账期 · ${sheets.payment_period_month} 实际缴费所属期 · ` +
            `参保 ${socialTotals.contributor_count || 0} 人 / 不参保 ${socialTotals.excluded_count || 0} 人`
        );
        $('#jz-housing-sheet-meta').text(
            `${sheets.period_month} 核定账期 · ${sheets.payment_period_month} 实际缴费所属期 · ` +
            `缴纳 ${housingTotals.contributor_count || 0} 人 / 停缴 ${housingTotals.stopped_count || 0} 人`
        );

        const socialBody = $('#tbody-jz-social-insurance');
        socialBody.empty();
        if (!socialRows.length) {
            set_table_state('#tbody-jz-social-insurance', 13, '当前账期没有可生成的员工社保确认行。');
        } else {
            socialRows.forEach(row => {
                socialBody.append(`
                    <tr>
                        <td class="jz-col-seq">${cint(row.seq)}</td>
                        <td class="jz-col-no"><strong>${esc(row.employee_no)}</strong></td>
                        <td class="jz-col-name"><strong>${esc(row.employee_name)}</strong></td>
                        <td>${esc(row.employee_type)}</td>
                        <td title="${esc(row.base_mode)}">${esc(row.base_mode)}</td>
                        <td class="jz-money-cell" title="${esc(row.base_mode)}">${jz_sheet_money(row.base)}</td>
                        <td class="jz-money-cell">${jz_sheet_money(row.person_pension)}</td>
                        <td class="jz-money-cell">${jz_sheet_money(row.person_medical)}</td>
                        <td class="jz-money-cell">${jz_sheet_money(row.person_unemployment)}</td>
                        <td class="jz-money-cell">${jz_sheet_money(row.person_large_medical)}</td>
                        <td class="jz-money-cell jz-money-bold">${jz_sheet_money(row.person_total)}</td>
                        <td class="jz-money-cell jz-money-cost">${jz_sheet_money(row.company_total)}</td>
                        <td class="jz-text-center" title="${esc(row.status_reason || '')}">${esc(row.status)}</td>
                    </tr>
                `);
            });
        }
        $('#tfoot-jz-social-insurance').html(`
            <tr>
                <td colspan="3" class="jz-col-foot-label">合计（${socialTotals.row_count || 0} 人）</td>
                <td>${socialTotals.contributor_count || 0} 人参保</td>
                <td>-</td>
                <td class="jz-money-cell">${jz_sheet_money(socialTotals.base)}</td>
                <td colspan="5" class="jz-text-right">个人合计 ${jz_sheet_money(socialTotals.person_total)}</td>
                <td class="jz-money-cell jz-money-cost">${jz_sheet_money(socialTotals.company_total)}</td>
                <td class="jz-text-center">${socialTotals.excluded_count || 0} 人不参保</td>
            </tr>
        `);

        const housingBody = $('#tbody-jz-housing-fund');
        housingBody.empty();
        if (!housingRows.length) {
            set_table_state('#tbody-jz-housing-fund', 12, '当前账期没有可生成的员工公积金确认行。');
        } else {
            housingRows.forEach(row => {
                const policyText = `${row.housing_fund_policy || '跟随公司规则'} · ${row.decision_label || '-'}`;
                housingBody.append(`
                    <tr>
                        <td class="jz-col-seq">${cint(row.seq)}</td>
                        <td class="jz-col-no"><strong>${esc(row.employee_no)}</strong></td>
                        <td class="jz-col-name"><strong>${esc(row.employee_name)}</strong></td>
                        <td title="长期策略：${esc(row.housing_fund_policy || '')}">${esc(row.base_mode)}</td>
                        <td class="jz-money-cell">${jz_sheet_money(row.effective_base)}</td>
                        <td class="jz-num-cell">${jz_sheet_percent(row.person_rate)}</td>
                        <td class="jz-money-cell">${jz_sheet_money(row.person_amount)}</td>
                        <td class="jz-num-cell">${jz_sheet_percent(row.company_rate)}</td>
                        <td class="jz-money-cell jz-money-cost">${jz_sheet_money(row.company_amount)}</td>
                        <td title="${esc(row.status_reason || '')}">${esc(row.status)}</td>
                        <td title="${esc(row.status_reason || '')}">${esc(policyText)}</td>
                        <td>${esc(sheets.payment_period_month)}</td>
                    </tr>
                `);
            });
        }
        $('#tfoot-jz-housing-fund').html(`
            <tr>
                <td colspan="3" class="jz-col-foot-label">合计（${housingTotals.row_count || 0} 人）</td>
                <td>-</td>
                <td class="jz-money-cell">${jz_sheet_money(housingTotals.effective_base)}</td>
                <td>-</td>
                <td class="jz-money-cell">${jz_sheet_money(housingTotals.person_amount)}</td>
                <td>-</td>
                <td class="jz-money-cell jz-money-cost">${jz_sheet_money(housingTotals.company_amount)}</td>
                <td>${housingTotals.contributor_count || 0} 人缴纳</td>
                <td>-</td>
                <td>${esc(sheets.payment_period_month || '')}</td>
            </tr>
        `);
    }

    function print_jizhong_insurance_sheet(kind) {
        const sheets = jz_insurance_sheets_cache;
        if (!sheets || sheets.period_month !== current_month || !sheets.print_ready) {
            frappe.msgprint((sheets && sheets.reason) || '请先确认员工薪资档案和社保公积金配置。');
            return;
        }
        const isSocial = kind === 'social_insurance';
        const sheet = sheets[isSocial ? 'social_insurance' : 'housing_fund'] || {};
        const rows = sheet.rows || [];
        if (!rows.length) {
            frappe.msgprint('当前账期没有可打印的确认明细。');
            return;
        }
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            frappe.msgprint('浏览器阻止了打印窗口，请允许弹出窗口后重试。');
            return;
        }
        try { printWindow.opener = null; } catch (error) {}
        const money = jz_sheet_money;
        const title = isSocial ? '社会保险确认表' : '住房公积金确认表';
        const rowsHtml = isSocial
            ? rows.map(row => `
                <tr>
                    <td>${cint(row.seq)}</td><td>${esc(row.employee_no)}</td><td>${esc(row.employee_name)}</td>
                    <td>${esc(row.employee_type)}</td><td>${esc(row.base_mode)}</td><td>${money(row.base)}</td>
                    <td>${money(row.person_pension)}</td><td>${money(row.person_medical)}</td>
                    <td>${money(row.person_unemployment)}</td><td>${money(row.person_large_medical)}</td>
                    <td>${money(row.person_total)}</td><td>${money(row.company_total)}</td>
                    <td>${esc(row.status)}</td><td class="jz-print-note-cell">${esc(row.status_reason || '-')}</td>
                </tr>
            `).join('')
            : rows.map(row => `
                <tr>
                    <td>${cint(row.seq)}</td><td>${esc(row.employee_no)}</td><td>${esc(row.employee_name)}</td>
                    <td>${esc(row.base_mode)}</td><td>${money(row.effective_base)}</td>
                    <td>${jz_sheet_percent(row.person_rate)}</td><td>${money(row.person_amount)}</td>
                    <td>${jz_sheet_percent(row.company_rate)}</td><td>${money(row.company_amount)}</td>
                    <td>${esc(row.status)}</td>
                    <td>${esc(row.housing_fund_policy || '')} · ${esc(row.decision_label || '-')}</td>
                    <td>${esc(sheets.payment_period_month)}</td><td class="jz-print-note-cell">${esc(row.status_reason || '-')}</td>
                </tr>
            `).join('');
        const headers = isSocial
            ? '<th>序号</th><th>工号</th><th>姓名</th><th>用工性质</th><th>申报基数方式</th><th>申报基数</th><th>个人养老</th><th>个人医疗</th><th>个人失业</th><th>大额医疗</th><th>个人合计</th><th>单位合计</th><th>参保状态</th><th>状态说明</th>'
            : '<th>序号</th><th>工号</th><th>姓名</th><th>申报基数方式</th><th>有效基数</th><th>个人比例</th><th>个人金额</th><th>单位比例</th><th>单位金额</th><th>缴费状态</th><th>长期策略 / 本月规则</th><th>实际缴费所属期</th><th>判断说明</th>';
        const totals = sheet.totals || {};
        const totalHtml = isSocial
            ? `<tr class="jz-print-total"><td colspan="4">合计（${totals.row_count || 0} 人，参保 ${totals.contributor_count || 0} 人）</td><td>-</td><td>${money(totals.base)}</td><td colspan="5">个人合计 ${money(totals.person_total)}</td><td>${money(totals.company_total)}</td><td colspan="2">不参保 ${totals.excluded_count || 0} 人</td></tr>`
            : `<tr class="jz-print-total"><td colspan="4">合计（${totals.row_count || 0} 人，缴纳 ${totals.contributor_count || 0} 人）</td><td>${money(totals.effective_base)}</td><td></td><td>${money(totals.person_amount)}</td><td></td><td>${money(totals.company_amount)}</td><td colspan="4">停缴 ${totals.stopped_count || 0} 人</td></tr>`;
        printWindow.document.open();
        printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} ${esc(sheets.period_month)}</title><link id="jz-print-stylesheet" rel="stylesheet" href="/assets/ashan_cn_procurement/css/jizhong_hr_salary_workbench.css"></head><body class="jz-insurance-print-sheet"><main><h1>${esc(COMPANY)} ${esc(title)} · ${esc(sheets.edition || '核对版（未确认）')}</h1><p class="jz-print-period">核定账期：${esc(sheets.period_month)}　实际缴费所属期：${esc(sheets.payment_period_month)}</p><table class="jz-print-wide-table"><thead><tr>${headers}</tr></thead><tbody>${rowsHtml}</tbody><tfoot>${totalHtml}</tfoot></table><p class="jz-print-sign">制表人：________________　确认人：________________　日期：____________</p></main></body></html>`);
        printWindow.document.close();
        let printStarted = false;
        const startPrint = () => {
            if (printStarted || printWindow.closed) return;
            printStarted = true;
            printWindow.focus();
            printWindow.print();
        };
        const readyToPrint = () => {
            const fonts = printWindow.document.fonts;
            if (fonts && fonts.ready) fonts.ready.then(startPrint).catch(startPrint);
            else startPrint();
        };
        const stylesheet = printWindow.document.getElementById('jz-print-stylesheet');
        if (stylesheet) {
            stylesheet.addEventListener('load', readyToPrint, { once: true });
            stylesheet.addEventListener('error', readyToPrint, { once: true });
        }
        printWindow.addEventListener('afterprint', () => printWindow.close(), { once: true });
        printWindow.setTimeout(readyToPrint, 1000);
    }

    function refresh_insurance_sheets() {
        const $button = $('#btn-jz-generate-insurance-sheets');
        const originalText = $button.text();
        const requested_month = current_month;
        $button.prop('disabled', true).addClass('disabled').text('正在生成…');
        frappe.call({
            method: 'ashan_cn_procurement.services.jizhong_payroll_service.get_jizhong_workflow_status',
            type: 'GET',
            args: { company: COMPANY, period_month: current_month },
            callback: function(response) {
                if (requested_month !== current_month) return;
                if (!response || response.exc || !response.message || !response.message.success) {
                    frappe.show_alert({ message: call_error_text(response, '确认表生成失败，请刷新后重试。'), indicator: 'red' });
                    return;
                }
                jz_insurance_sheets_cache = response.message.insurance_sheets || null;
                update_workflow_action_controls(response.message);
                render_insurance_sheets(jz_insurance_sheets_cache);
                frappe.show_alert({
                    message: jz_insurance_sheets_cache?.preview_ready ? '社保、公积金核对表已生成。' : (jz_insurance_sheets_cache?.reason || '前置确认尚未完成。'),
                    indicator: jz_insurance_sheets_cache?.preview_ready ? 'green' : 'orange'
                });
            },
            error: function(xhr) {
                frappe.show_alert({ message: call_error_text(xhr, '确认表生成失败，请检查权限或网络。'), indicator: 'red' });
            },
            always: function() {
                $button.prop('disabled', false).removeClass('disabled').text(originalText);
                update_workflow_action_controls(workflow_state);
            }
        });
    }

    $('#btn-jz-generate-insurance-sheets').on('click', refresh_insurance_sheets);
    $('#btn-jz-print-social-insurance').on('click', function() {
        print_jizhong_insurance_sheet('social_insurance');
    });
    $('#btn-jz-print-housing-fund').on('click', function() {
        print_jizhong_insurance_sheet('housing_fund');
    });

    // 6. 加载吉众专属社保公积金配置 (按月配置与继承机制)
    let jz_insurance_cache = null;
    function load_insurance_data() {
        $('#jz-ins-config-source').text('正在读取本月配置…');
        frappe.call({
            method: 'ashan_cn_procurement.services.jizhong_payroll_service.get_jizhong_insurance_setting',
            type: 'GET',
            args: { company: COMPANY, period_month: current_month },
            callback: function(r) {
                if (!r || r.exc || !r.message) {
                    $('#jz-ins-config-source').text(call_error_text(r, '读取配置失败，请刷新后重试。'));
                    return;
                }
                jz_insurance_cache = r.message;
                const d = r.message;
                let tip = `配置对象：${d.name || COMPANY + '-' + current_month}`;
                if (d.is_inherited) {
                    tip += ` (默认载入上月 ${d.inherited_from} 费率，保存后存为本月)`;
                } else {
                    tip += ` (本月已独立保存)`;
                }
                $('#jz-ins-docname-tip').text(tip);
                $('#jz-ins-injury').text(flt(d.ss_company_injury, 2) + '%');
                $('#jz-ins-pension-p').text(flt(d.ss_person_pension, 2) + '%');
                $('#jz-ins-pension-c').text(flt(d.ss_company_pension, 2) + '%');
                $('#jz-ins-medical-p').text(flt(d.ss_person_medical, 2) + '%');
                $('#jz-ins-medical-c').text(flt(d.ss_company_medical, 2) + '%');
                $('#jz-ins-unemp-p').text(flt(d.ss_person_unemployment, 2) + '%');
                $('#jz-ins-unemp-c').text(flt(d.ss_company_unemployment, 2) + '%');
                $('#jz-ins-maternity').text(flt(d.ss_company_other_medical, 2) + '%');
                $('#jz-ins-hf-p').text(flt(d.hf_person_rate, 2) + '%');
                $('#jz-ins-hf-c').text(flt(d.hf_company_rate, 2) + '%');
                $('#jz-ins-ss-min-base').text(window.AshanUI.formatMoney(d.ss_min_base || 0));
                $('#jz-ins-hf-min-base').text(window.AshanUI.formatMoney(d.hf_min_base || 0));
                const contributionMonths = String(d.hf_contribution_months || '').trim();
                $('#jz-ins-hf-auto-rule').text(
                    d.hf_auto_rule_enabled
                        ? `启用，${contributionMonths || '未配置月份'}${d.hf_off_month_action ? `（非计划月${d.hf_off_month_action}）` : ''}`
                        : '未启用，按员工长期策略'
                );
                $('#jz-ins-tax-cycle').text(`起始月 ${cint(d.tax_cycle_start_month) || 12} 月`);
                const paymentPeriod = next_period(current_month);
                const paymentMonth = Number(paymentPeriod.slice(5, 7));
                const specialMonths = String(d.big_medical_special_months || '1,4,7,10')
                    .split(',').map(Number).filter(Boolean);
                const bigMedical = specialMonths.includes(paymentMonth)
                    ? flt(d.big_medical_amount_special)
                    : flt(d.big_medical_amount_default);
                $('#jz-ins-big-medical').text(
                    `${paymentPeriod}：${window.AshanUI.formatMoney(bigMedical)}（特殊月份 ${specialMonths.join('、')}）`
                );
                $('#jz-ins-tax-threshold').text(
                    `${window.AshanUI.formatMoney(d.tax_threshold)} / 月`
                );
                $('#jz-ins-payment-period').text(paymentPeriod);
                let sourceText = '本月独立配置';
                if (d.is_inherited) {
                    sourceText = `继承自 ${d.inherited_from || '上一期'}，保存后才会写入本月`;
                } else if (d.configuration_source === 'system_default') {
                    sourceText = '系统默认值，仅供参考，不能直接核算';
                } else if (d.configuration_source === 'annual') {
                    sourceText = '年度基准配置，保存后写入本月';
                }
                $('#jz-ins-config-source').text(sourceText);
            },
            error: function(xhr) {
                $('#jz-ins-config-source').text(call_error_text(xhr, '读取配置失败，请检查权限或网络后重试。'));
            }
        });
    }

    $('#btn-jz-open-insurance-form').on('click', function() {
        if (jz_insurance_cache && jz_insurance_cache.name) {
            frappe.set_route('Form', 'Ashan Insurance Setting', jz_insurance_cache.name);
            return;
        }
        frappe.msgprint('本月社保公积金配置尚未读取完成，请先刷新本页后再打开原生表单。');
    });

    $('#btn-jz-edit-insurance').on('click', function() {
        if (!can_configure_insurance) {
            frappe.msgprint('社保、公积金和个税基础参数属于长期配置，仅 Payroll Manager 可以修改。');
            return;
        }
        if (!jz_insurance_cache) return;
        const d = jz_insurance_cache;
        const dlg = window.AshanUI.createDialog({
            title: `修改吉众专属社保公积金费率 (${current_month} 月度)`,
            size: 'large',
            fields: [
                { fieldname: 'ss_company_injury', fieldtype: 'Percent', label: '单位工伤保险比例 (%)', default: d.ss_company_injury },
                { fieldname: 'ss_company_pension', fieldtype: 'Percent', label: '单位基本养老比例 (%)', default: d.ss_company_pension },
                { fieldname: 'ss_company_unemployment', fieldtype: 'Percent', label: '单位失业保险比例 (%)', default: d.ss_company_unemployment },
                { fieldname: 'ss_person_pension', fieldtype: 'Percent', label: '个人基本养老比例 (%)', default: d.ss_person_pension },
                { fieldname: 'ss_company_medical', fieldtype: 'Percent', label: '单位基本医疗比例 (%)', default: d.ss_company_medical },
                { fieldname: 'ss_person_medical', fieldtype: 'Percent', label: '个人基本医疗比例 (%)', default: d.ss_person_medical },
                { fieldname: 'ss_person_unemployment', fieldtype: 'Percent', label: '个人失业保险比例 (%)', default: d.ss_person_unemployment },
                { fieldname: 'ss_company_other_medical', fieldtype: 'Percent', label: '单位其他医疗比例 (%)', default: d.ss_company_other_medical },
                { fieldname: 'big_medical_amount_default', fieldtype: 'Currency', label: '大额医疗基准金额 (元/月)', default: d.big_medical_amount_default },
                { fieldname: 'big_medical_amount_special', fieldtype: 'Currency', label: '大额医疗特殊金额 (元/月)', default: d.big_medical_amount_special },
                { fieldname: 'big_medical_special_months', fieldtype: 'Data', label: '大额医疗特殊月份', default: d.big_medical_special_months || '1,4,7,10', description: '按实际缴费所属期判断，用逗号分隔月份。' },
                { fieldname: 'hf_company_rate', fieldtype: 'Percent', label: '单位公积金比例 (%)', default: d.hf_company_rate },
                { fieldname: 'hf_person_rate', fieldtype: 'Percent', label: '个人公积金比例 (%)', default: d.hf_person_rate },
                { fieldname: 'hf_auto_rule_enabled', fieldtype: 'Check', label: '启用公积金自动月份规则', default: d.hf_auto_rule_enabled },
                { fieldname: 'hf_contribution_months', fieldtype: 'Data', label: '公积金自动缴纳月份', default: d.hf_contribution_months || '1,4,7,10', description: '按实际缴费所属期判断，用逗号分隔月份。' },
                { fieldname: 'hf_off_month_action', fieldtype: 'Select', label: '非计划月份处理', options: ['停缴', '继续缴纳'], default: d.hf_off_month_action || '停缴' },
                { fieldname: 'ss_min_base', fieldtype: 'Currency', label: '社保最低缴费基数 (元)', default: d.ss_min_base || 0 },
                { fieldname: 'hf_min_base', fieldtype: 'Currency', label: '公积金最低缴费基数 (元)', default: d.hf_min_base || 0 },
                { fieldname: 'tax_threshold', fieldtype: 'Currency', label: '个税基本减除费用 (元/月)', default: d.tax_threshold || 5000 },
                { fieldname: 'tax_cycle_start_month', fieldtype: 'Int', label: '个税累计申报周期起始月', default: d.tax_cycle_start_month || 12, description: '填写 1 至 12；历史记录从该月开始累计。' }
            ],
            primary_action_label: `保存为 ${current_month} 费率`,
            primary_action: function(vals) {
                run_write_action(dlg.get_primary_btn(), {
                    method: 'ashan_cn_procurement.services.jizhong_payroll_service.update_jizhong_insurance_setting',
                    args: {
                        company: COMPANY,
                        period_month: current_month,
                        values: JSON.stringify(vals)
                    },
                    busyText: '正在保存配置…',
                    success: function(result) {
                        frappe.show_alert({ message: result.message, indicator: 'green' });
                        dlg.hide();
                        load_insurance_data();
                        load_workflow_status();
                    },
                    error: function(message) {
                        frappe.show_alert({ message, indicator: 'red' });
                    }
                });
            }
        });
        dlg.show();
    });

    wrapper.__jz_salary_workbench = {
        show() {
            refresh_current_view();
        },
        refresh() {
            refresh_current_view();
        }
    };

    // 页面初始化：查询最新已封账账期，自动进入即将开始的活跃月份
    let init_handled = false;
    function handle_workbench_init(r) {
        if (init_handled) return;
        init_handled = true;
        if (!r || r.exc || !r.message) {
            can_configure_insurance = false;
            $('#btn-jz-edit-insurance').addClass('jz-hidden');
            render_workflow_error(r, '吉众工作台初始化失败，请刷新后重试。');
            load_workflow_status();
            load_employees_data();
            return;
        }
        can_configure_insurance = Boolean(r.message.can_configure);
        $('#btn-jz-edit-insurance').toggleClass('jz-hidden', !can_configure_insurance);
        if (r.message.default_period) {
            current_month = r.message.default_period;
            $('#jz-month-select').val(current_month);
        }
        load_workflow_status();
        load_employees_data();
    }

    frappe.call({
        method: 'ashan_cn_procurement.services.jizhong_payroll_service.get_jizhong_workbench_init',
        type: 'GET',
        args: { company: COMPANY },
        callback: handle_workbench_init,
        error: handle_workbench_init
    });
};

frappe.pages['jizhong-hr-salary-workbench'].on_page_show = function(wrapper) {
    const instance = wrapper.__jz_salary_workbench;
    if (instance) instance.show();
};
