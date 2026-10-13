// ASHAN-UNIFIED-V2: completed-module refactor
// Copyright (c) 2026, Ashan CN Procurement
// 天津吉众科技有限公司 · 人事薪酬综合工作台
// Typography contract: docs/ai/JIZHONG_SALARY_WORKBENCH_UI_CONTRACT.md
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
                    <span>月度薪酬闭环</span>
                    <span class="jz-subtitle-context">
                        核定账期 <strong id="jz-payroll-period-text">${current_month}</strong>
                        <span aria-hidden="true">·</span>
                        社保账期 <strong id="jz-payment-period-text">${next_period(current_month)}</strong>
                    </span>
                </div>
            </div>
            <div class="jz-header-actions">
                <label class="jz-label-month">核定账期</label>
                <input type="month" id="jz-month-select" class="form-control jz-month-input" value="${current_month}">
                <button type="button" class="btn btn-default btn-sm jz-btn-reset-month" id="btn-jz-reset-month" title="重置本月：清空本月考勤、已上传文件及测算数据，并重置确认进度">重置本月</button>
                <button type="button" class="btn btn-primary btn-sm jz-btn-lock-month" id="btn-jz-header-lock">核定本月数据</button>
                <button class="btn btn-default btn-sm" id="btn-jz-refresh-all">刷新数据</button>
            </div>
        </div>

        <!-- 业务页签 (带状态指示灯: 绿=完成, 黄=未完成, 红=错误) -->
        <div class="jz-nav-tabs">
            <button class="jz-tab-btn active" data-tab="employees"><span class="tab-status-dot status-warn"></span>员工档案</button>
            <button class="jz-tab-btn" data-tab="attendance"><span class="tab-status-dot status-warn"></span>考勤与工时</button>
            <button class="jz-tab-btn" data-tab="social_insurance"><span class="tab-status-dot status-warn"></span>社会保险</button>
            <button class="jz-tab-btn" data-tab="housing_fund"><span class="tab-status-dot status-warn"></span>住房公积金</button>
            <button class="jz-tab-btn" data-tab="payroll"><span class="tab-status-dot status-warn"></span>工资核定</button>
            <button class="jz-tab-btn" data-tab="tax"><span class="tab-status-dot status-warn"></span>个人所得税</button>
            <button class="jz-tab-btn" data-tab="cash_bills"><span class="tab-status-dot status-warn"></span>现金发放</button>
            <button class="jz-tab-btn" data-tab="history">历史数据</button>
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
                    <div class="jz-kpi-title">社会保险申报基数总额</div>
                    <div class="jz-kpi-val jz-text-success" id="jz-emp-kpi-ss">¥ 0.00</div>
                    <div class="jz-kpi-sub">独立读取本月社会保险配置</div>
                </div>
                <div class="jz-kpi-card">
                    <div class="jz-kpi-title">住房公积金申报基数总额</div>
                    <div class="jz-kpi-val jz-text-info" id="jz-emp-kpi-hf">¥ 0.00</div>
                    <div class="jz-kpi-sub">独立读取本月住房公积金配置</div>
                </div>
            </div>

            <div class="jz-toolbar jz-employee-toolbar">
                <div class="jz-toolbar-left">
                    <button class="btn btn-primary btn-sm jz-btn-blue" id="btn-jz-add-emp">新建员工档案</button>
                    <button class="btn btn-default btn-sm jz-hidden" id="btn-jz-adjust-param" disabled title="请先在表格左侧勾选人员">
                        调整薪酬参数 <span class="jz-selected-count-badge" id="jz-selected-count">0</span>
                    </button>
                    <button class="btn btn-default btn-sm" id="btn-jz-export-employees">导出薪资信息表</button>
                    <button class="btn btn-default btn-sm jz-btn-stage-confirmation" data-step="employees" id="btn-jz-confirm-employees">确认员工档案</button>
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

            <div class="jz-sheet-header-bar">
                <div class="jz-sheet-header-inline">
                    <h4 class="jz-config-title" id="jz-emp-sheet-title">${format_payment_month_title(current_month)}员工档案底册</h4>
                    <span class="jz-sheet-meta" id="jz-emp-sheet-meta">在册人数：0 在职人数：0（其中：正式工0，其他员工0，返聘工0）</span>
                </div>
            </div>

            <div class="jz-table-box">
                <table class="jz-table jz-employee-table" id="table-jz-employees">
                    <colgroup>
                        <col class="jz-emp-col-check">
                        <col class="jz-emp-col-seq">
                        <col class="jz-emp-col-no">
                        <col class="jz-emp-col-name">
                        <col class="jz-emp-col-id-card">
                        <col class="jz-emp-col-age">
                        <col class="jz-emp-col-gender">
                        <col class="jz-emp-col-certificate-type">
                        <col class="jz-emp-col-birth-date">
                        <col class="jz-emp-col-department">
                        <col class="jz-emp-col-job-title">
                        <col class="jz-emp-col-type">
                        <col class="jz-emp-col-salary-mode">
                        <col class="jz-emp-col-net-salary">
                        <col class="jz-emp-col-base-salary">
                        <col class="jz-emp-col-base-subsidy">
                        <col class="jz-emp-col-performance">
                        <col class="jz-emp-col-post">
                        <col class="jz-emp-col-meal">
                        <col class="jz-emp-col-ss-mode">
                        <col class="jz-emp-col-social-security">
                        <col class="jz-emp-col-hf-mode">
                        <col class="jz-emp-col-housing-fund">
                        <col class="jz-emp-col-deduction">
                        <col class="jz-emp-col-status">
                        <col class="jz-emp-col-action">
                    </colgroup>
                    <thead>
                        <tr>
                            <th class="jz-col-check jz-col-sticky-check" title="全选 / 取消全选">
                                <input type="checkbox" id="jz-emp-check-all" class="jz-checkbox" aria-label="全选当前表格人员">
                            </th>
                            <th class="jz-col-seq jz-col-sticky-1">序号</th>
                            <th class="jz-col-no jz-col-sticky-2">工号</th>
                            <th class="jz-col-name jz-col-sticky-3">姓名</th>
                            <th>证件号码</th>
                            <th class="jz-text-center">年龄</th>
                            <th class="jz-text-center">性别</th>
                            <th class="jz-text-center">证件类型</th>
                            <th class="jz-text-center">出生日期</th>
                            <th>部门</th>
                            <th>岗位</th>
                            <th>用工性质</th>
                            <th>计薪方式</th>
                            <th class="jz-text-right">固定工资</th>
                            <th class="jz-text-right">基本工资</th>
                            <th class="jz-text-right">基本补贴</th>
                            <th class="jz-text-right">绩效奖金</th>
                            <th class="jz-text-right">职位津贴</th>
                            <th class="jz-text-right">餐补单价</th>
                            <th class="jz-emp-col-ss-mode jz-text-left">社保方式</th>
                            <th class="jz-text-right">社保基数</th>
                            <th class="jz-emp-col-hf-mode jz-text-left">公积金方式</th>
                            <th class="jz-text-right">公积金基数</th>
                            <th class="jz-emp-col-hf-cycle jz-text-center">公积金周期</th>
                            <th class="jz-text-right">专项附加扣除</th>
                            <th class="jz-text-center">在职状态</th>
                            <th class="jz-col-action">操作</th>
                        </tr>
                    </thead>
                    <tbody id="tbody-jz-employees">
                        <tr><td colspan="27" class="jz-empty-cell">正在加载员工薪资信息档案...</td></tr>
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
                    <button class="btn btn-primary btn-sm jz-btn-blue" id="btn-jz-upload-attendance">上传月度考勤</button>
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
                    <button class="btn btn-default btn-sm" id="btn-jz-export-raw-attendance">导出打卡底册</button>
                    <button class="btn btn-default btn-sm jz-hidden" id="btn-jz-export-summary-attendance">导出结算汇总</button>
                </div>
            </div>

            <div class="jz-sheet-header-bar">
                <div class="jz-sheet-header-inline">
                    <h4 class="jz-config-title" id="jz-att-sheet-title">${format_payment_month_title(current_month)}考勤与工时明细</h4>
                    <span class="jz-sheet-meta" id="jz-att-sheet-meta">考勤人数：0 免考勤人数：0（固定工资人员）</span>
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

        <!-- 社会保险与住房公积金：极简双区架构（顶部纯净费率基数条 + 下方三步流水线确认表） -->
        <div id="jz-tab-insurance" class="jz-tab-content jz-hidden" data-insurance-view="social_insurance">
            <div class="jz-hidden" aria-hidden="true">
                <button id="btn-jz-edit-social-insurance" class="jz-btn-orange jz-insurance-action" data-insurance-section="social_insurance"></button>
                <button id="btn-jz-edit-housing-fund" class="jz-btn-orange jz-insurance-action" data-insurance-section="housing_fund"></button>
                <button id="btn-jz-open-insurance-form"></button>
                <button id="btn-jz-generate-insurance-sheets"></button>
                <span id="jz-ins-docname-tip"></span>
                <span id="jz-ins-config-title"></span>
                <span id="jz-ins-payment-period"></span>
                <span id="jz-ins-config-source"></span>
                <span id="jz-ins-tax-cycle"></span>
                <span id="jz-ins-tax-threshold"></span>
                <p id="jz-ins-sheet-status"></p>
            </div>

            <div class="jz-config-box jz-policy-panel jz-policy-expanded jz-policy-compact-bar">
                <div class="jz-policy-panel-body" id="jz-policy-panel-body">
                    <div class="jz-policy-compact-row">
                        <div class="jz-config-grid jz-config-grid-compact" id="jz-ins-grid">
                            <section class="jz-policy-group jz-policy-group-leading" data-policy-scope="social_insurance">
                                <h5 class="jz-policy-group-title">社会保险费率</h5>
                                <div class="jz-policy-list">
                                    <div class="jz-policy-row">
                                        <span class="jz-policy-label">工伤保险</span>
                                        <span class="jz-policy-value"><span class="jz-policy-party">单位</span><strong id="jz-ins-injury">0.55%</strong></span>
                                    </div>
                                    <div class="jz-policy-row">
                                        <span class="jz-policy-label">养老保险</span>
                                        <span class="jz-policy-rate-pair">
                                            <span><span class="jz-policy-party">个人</span><strong id="jz-ins-pension-p">8.00%</strong></span>
                                            <span><span class="jz-policy-party">单位</span><strong id="jz-ins-pension-c">16.00%</strong></span>
                                        </span>
                                    </div>
                                    <div class="jz-policy-row">
                                        <span class="jz-policy-label">医疗保险</span>
                                        <span class="jz-policy-rate-pair">
                                            <span><span class="jz-policy-party">个人</span><strong id="jz-ins-medical-p">2.00%</strong></span>
                                            <span><span class="jz-policy-party">单位</span><strong id="jz-ins-medical-c">10.00%</strong></span>
                                        </span>
                                    </div>
                                    <div class="jz-policy-row">
                                        <span class="jz-policy-label">失业保险</span>
                                        <span class="jz-policy-rate-pair">
                                            <span><span class="jz-policy-party">个人</span><strong id="jz-ins-unemp-p">0.50%</strong></span>
                                            <span><span class="jz-policy-party">单位</span><strong id="jz-ins-unemp-c">0.50%</strong></span>
                                        </span>
                                    </div>
                                    <div class="jz-policy-row">
                                        <span class="jz-policy-label">其他医疗</span>
                                        <span class="jz-policy-value"><span class="jz-policy-party">单位</span><strong id="jz-ins-maternity">0.50%</strong></span>
                                    </div>
                                </div>
                            </section>

                            <section class="jz-policy-group" data-policy-scope="social_insurance">
                                <h5 class="jz-policy-group-title">基数与特殊费用</h5>
                                <div class="jz-policy-list">
                                    <div class="jz-policy-row">
                                        <span class="jz-policy-label">社保最低基数</span>
                                        <strong class="jz-policy-value" id="jz-ins-ss-min-base">待配置</strong>
                                    </div>
                                    <div class="jz-policy-row">
                                        <span class="jz-policy-label">大额医疗救助</span>
                                        <strong class="jz-policy-value jz-policy-value-wrap" id="jz-ins-big-medical">按实际缴费所属期计算</strong>
                                    </div>
                                </div>
                            </section>

                            <section class="jz-policy-group jz-policy-group-leading" data-policy-scope="housing_fund">
                                <h5 class="jz-policy-group-title">住房公积金比例</h5>
                                <div class="jz-policy-list">
                                    <div class="jz-policy-row">
                                        <span class="jz-policy-label">缴存比例</span>
                                        <span class="jz-policy-rate-pair">
                                            <span><span class="jz-policy-party">个人</span><strong id="jz-ins-hf-p">5.00%</strong></span>
                                            <span><span class="jz-policy-party">单位</span><strong id="jz-ins-hf-c">5.00%</strong></span>
                                        </span>
                                    </div>
                                </div>
                            </section>

                            <section class="jz-policy-group" data-policy-scope="housing_fund">
                                <h5 class="jz-policy-group-title">基数与缴费规则</h5>
                                <div class="jz-policy-list">
                                    <div class="jz-policy-row">
                                        <span class="jz-policy-label">公积金最低基数</span>
                                        <strong class="jz-policy-value" id="jz-ins-hf-min-base">待配置</strong>
                                    </div>
                                    <div class="jz-policy-row">
                                        <span class="jz-policy-label">自动缴费</span>
                                        <strong class="jz-policy-value jz-policy-value-wrap" id="jz-ins-hf-auto-rule">按配置月份执行</strong>
                                    </div>
                                </div>
                            </section>
                        </div>
                        <div class="jz-policy-compact-action">
                            <button type="button" class="btn btn-primary btn-sm jz-btn-orange" id="btn-jz-edit-policy-setting">设置本月社保参数</button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="jz-insurance-sheet-toolbar">
                <div class="jz-insurance-sheet-copy jz-sheet-header-inline">
                    <h4 class="jz-config-title" id="jz-ins-sheet-title">${format_payment_month_title(next_period(current_month))}社会保险明细</h4>
                    <span class="jz-sheet-meta jz-insurance-action" data-insurance-section="social_insurance" id="jz-social-sheet-meta">参保人数：0 未参保人数：0（其中：正式工0，其他员工0，返聘工0）</span>
                    <span class="jz-sheet-meta jz-insurance-action jz-hidden" data-insurance-section="housing_fund" id="jz-housing-sheet-meta">参保人数：0 未参保人数：0（其中：正式工0，其他员工0，返聘工0）</span>
                </div>
                <div class="jz-insurance-sheet-toolbar-actions">
                    <input type="file" id="jz-ins-proof-file-input" class="jz-hidden" accept=".pdf,.zip" multiple aria-label="上传缴费凭证">
                    <div class="jz-proof-workflow-group">
                        <button type="button" class="btn btn-primary btn-sm jz-btn-blue" id="btn-jz-upload-proof">上传缴费凭证</button>
                        <button type="button" class="btn btn-default btn-sm jz-hidden" id="btn-jz-view-proof">查看凭证</button>
                        <span class="jz-proof-verify-pill jz-insurance-action" data-insurance-section="social_insurance" id="jz-ss-proof-badge">待上传凭证核对</span>
                        <span class="jz-proof-verify-pill jz-insurance-action jz-hidden" data-insurance-section="housing_fund" id="jz-hf-proof-badge">待上传凭证核对</span>
                        <button class="btn btn-success btn-sm jz-btn-green jz-btn-stage-confirmation jz-insurance-action" data-insurance-section="social_insurance" data-step="social_insurance" id="btn-jz-confirm-social-insurance" disabled>确认社会保险</button>
                        <button class="btn btn-success btn-sm jz-btn-green jz-btn-stage-confirmation jz-insurance-action jz-hidden" data-insurance-section="housing_fund" data-step="housing_fund" id="btn-jz-confirm-housing-fund" disabled>确认住房公积金</button>
                        <button class="btn btn-default btn-sm jz-insurance-action" data-insurance-section="social_insurance" id="btn-jz-print-social-insurance" disabled>打印明细</button>
                        <button class="btn btn-default btn-sm jz-insurance-action jz-hidden" data-insurance-section="housing_fund" id="btn-jz-print-housing-fund" disabled>打印明细</button>
                    </div>
                </div>
            </div>
            <section class="jz-insurance-sheet-panel jz-insurance-section-social" aria-labelledby="jz-ins-sheet-title">
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
            <section class="jz-insurance-sheet-panel jz-insurance-section-housing" aria-labelledby="jz-ins-sheet-title">
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
                    <button class="btn btn-default btn-sm" id="btn-jz-export-payroll">导出工资表</button>
                </div>
            </div>

            <div class="jz-sheet-header-bar">
                <div class="jz-sheet-header-inline">
                    <h4 class="jz-config-title" id="jz-payroll-sheet-title">${format_payment_month_title(current_month)}工资核定明细单</h4>
                    <span class="jz-sheet-meta" id="jz-payroll-sheet-meta">核定发薪：0人 ｜ 应发总额：¥ 0.00 ｜ 实发总额：¥ 0.00</span>
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

        <!-- Tab 4: 个人所得税台账 (68 列全量税法复核大宽表 / 对应 Excel [个人所得税] sheets) -->
        <div id="jz-tab-tax" class="jz-tab-content jz-hidden">
            <div class="jz-sheet-header-bar">
                <div class="jz-sheet-header-inline">
                    <h4 class="jz-config-title" id="jz-tax-sheet-title">${format_payment_month_title(current_month)}个人所得税明细单</h4>
                    <span class="jz-sheet-meta" id="jz-tax-sheet-meta">核定计税：0人 ｜ 累计应纳税所得额：¥ 0.00 ｜ 当月代扣个税：¥ 0.00</span>
                </div>
                <div class="jz-sheet-header-actions">
                    <button class="btn btn-default btn-sm" id="btn-jz-export-tax">导出个税申报明细 Excel</button>
                    <div class="jz-tax-threshold-setting-box" id="jz-tax-threshold-setting-box">
                        <span class="jz-tax-threshold-label">计薪周期：</span>
                        <select id="jz-tax-cycle-start-select" class="jz-tax-cycle-select" title="设置几月份的工资作为个税年度累计计算周期的第1个月（默认12月开始，可调整为1月开始）">
                            <option value="12">12月开始 (上年12月~当年11月 · 默认)</option>
                            <option value="1">1月开始 (当年1月~当年12月)</option>
                            <option value="2">2月开始</option>
                            <option value="3">3月开始</option>
                            <option value="4">4月开始</option>
                            <option value="5">5月开始</option>
                            <option value="6">6月开始</option>
                            <option value="7">7月开始</option>
                            <option value="8">8月开始</option>
                            <option value="9">9月开始</option>
                            <option value="10">10月开始</option>
                            <option value="11">11月开始</option>
                        </select>
                        <span class="jz-tax-setting-divider">｜</span>
                        <span class="jz-tax-threshold-label">本月免征额：</span>
                        <div class="jz-tax-threshold-input-wrap">
                            <span class="jz-tax-threshold-prefix">¥</span>
                            <input type="number" id="jz-tax-threshold-input" class="jz-tax-threshold-input" value="5000.00" step="100" min="0" title="设置本月个人所得税免征额度（默认为上月值）">
                        </div>
                        <button type="button" class="jz-tax-threshold-save-btn" id="btn-jz-tax-threshold-save" title="保存个税计薪周期与本月免征额度设置">保存设置</button>
                        <span class="jz-tax-threshold-hint" id="jz-tax-threshold-hint">默认上月: 12月起 · ¥ 5,000.00</span>
                    </div>
                    <button class="btn btn-default btn-sm jz-btn-stage-confirmation" data-step="tax" id="btn-jz-confirm-tax" disabled>确认个人所得税台账</button>
                </div>
            </div>

            <div class="jz-table-box" id="box-jz-tax">
                <table class="jz-table jz-tax-68-table" id="table-jz-tax">
                    <thead id="thead-jz-tax"></thead>
                    <tbody id="tbody-jz-tax">
                        <tr><td colspan="68" class="jz-empty-cell">正在读取吉众个人所得税 68 列核算数据...</td></tr>
                    </tbody>
                    <tfoot id="tfoot-jz-tax"></tfoot>
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

            <div class="jz-sheet-header-bar">
                <div class="jz-sheet-header-inline">
                    <h4 class="jz-config-title" id="jz-cash-sheet-title">${format_payment_month_title(current_month)}现金发放与配钞明细单</h4>
                    <span class="jz-sheet-meta" id="jz-cash-sheet-meta">现金实发：0人 ｜ 现金总盘：¥ 0.00 ｜ 配钞总张数：0张</span>
                </div>
                <div class="jz-sheet-header-actions">
                    <button class="btn btn-default btn-sm" id="btn-jz-print-a4-slips">打印 A4 签收工资条</button>
                    <button class="btn btn-default btn-sm" id="btn-jz-export-cash">导出配钞明细</button>
                    <button class="btn btn-default btn-sm jz-btn-stage-confirmation" data-step="cash_bills" id="btn-jz-confirm-cash_bills" disabled>确认现金发放</button>
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

        <!-- Tab 7: 历史薪资穿透 (421条+本月全员 / 对应 Excel [历史数据] sheets) -->
        <div id="jz-tab-history" class="jz-tab-content jz-hidden">
            <div class="jz-kpi-grid" id="jz-history-kpi-grid">
                <div class="jz-kpi-card">
                    <div class="jz-kpi-title">涵盖记录 / 账期</div>
                    <div class="jz-kpi-val" id="jz-hist-kpi-records">0 条</div>
                    <div class="jz-kpi-sub" id="jz-hist-kpi-period-sub">包含历史归档与本月全员</div>
                </div>
                <div class="jz-kpi-card">
                    <div class="jz-kpi-title">累计税前应发总额</div>
                    <div class="jz-kpi-val jz-text-primary" id="jz-hist-kpi-gross">¥ 0.00</div>
                    <div class="jz-kpi-sub">应发薪资总盘</div>
                </div>
                <div class="jz-kpi-card">
                    <div class="jz-kpi-title">累计五险一金代扣</div>
                    <div class="jz-kpi-val jz-text-warn" id="jz-hist-kpi-insurance">¥ 0.00</div>
                    <div class="jz-kpi-sub">个人社保: <span id="jz-hist-kpi-ss">¥ 0.00</span> ｜ 个人公积金: <span id="jz-hist-kpi-hf">¥ 0.00</span></div>
                </div>
                <div class="jz-kpi-card">
                    <div class="jz-kpi-title">累计个税与实发总额</div>
                    <div class="jz-kpi-val jz-text-success" id="jz-hist-kpi-net">¥ 0.00</div>
                    <div class="jz-kpi-sub">代扣个税: <span id="jz-hist-kpi-tax">¥ 0.00</span> ｜ 单位统筹成本: <span id="jz-hist-kpi-comp">¥ 0.00</span></div>
                </div>
            </div>

            <div class="jz-toolbar">
                <div class="jz-toolbar-left">
                    <div class="jz-filter-group">
                        <span class="jz-filter-label">历史台账视图</span>
                        <div class="jz-segmented-control" id="jz-history-view-mode" role="group" aria-label="历史台账视图">
                            <button type="button" class="jz-segment-btn active" data-view="tax_68" aria-pressed="true">全要素个税台账 (68列)</button>
                            <button type="button" class="jz-segment-btn" data-view="insurance_fund" aria-pressed="false">五险一金详细台账 (22列)</button>
                            <button type="button" class="jz-segment-btn" data-view="comprehensive" aria-pressed="false">综合工资与人员记录 (26列)</button>
                            <button type="button" class="jz-segment-btn" data-view="summary" aria-pressed="false">历史核心简表 (14列)</button>
                        </div>
                    </div>

                    <div class="jz-filter-group">
                        <span class="jz-filter-label">过滤账期</span>
                        <select id="jz-history-month-filter" class="form-control jz-filter-select">
                            <option value="ALL">全部账期 (含历史与本月)</option>
                            <option value="CURRENT">本月当前数据 (含本月全员)</option>
                        </select>
                    </div>

                    <div class="jz-filter-group">
                        <span class="jz-filter-label">人员筛选</span>
                        <select id="jz-history-emp-filter" class="form-control jz-filter-select">
                            <option value="ALL">全部在册人员</option>
                        </select>
                    </div>
                </div>

                <div class="jz-toolbar-right">
                    <button class="btn btn-default btn-sm" id="btn-jz-export-history">导出当前历史视图 Excel</button>
                </div>
            </div>

            <div class="jz-table-box" id="box-jz-history">
                <table class="jz-table" id="table-jz-history">
                    <thead id="thead-jz-history"></thead>
                    <tbody id="tbody-jz-history"></tbody>
                    <tfoot id="tfoot-jz-history"></tfoot>
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
        'employees', 'attendance', 'social_insurance', 'housing_fund', 'tax', 'payroll', 'cash_bills', 'history'
    ]);
    const confirmation_labels = {
        employees: '员工档案',
        attendance: '考勤与工时',
        social_insurance: '社会保险',
        housing_fund: '住房公积金',
        tax: '个人所得税台账',
        cash_bills: '现金发放'
    };
    let workflow_state = { steps: [] };
    let table_height_frame = 0;
    let table_layout_observer = null;
    const TABLE_BOTTOM_GAP = 10;
    const TABLE_MIN_HEIGHT = 160;

    function get_page_root_element() {
        return pageRoot && pageRoot[0] ? pageRoot[0] : pageRoot;
    }

    function get_active_table_box() {
        const root = get_page_root_element();
        if (!root || !root.getClientRects().length) return null;
        const activeTab = root.querySelector('.jz-tab-content:not(.jz-hidden)');
        if (!activeTab) return null;
        return Array.from(activeTab.querySelectorAll('.jz-table-box')).find(box =>
            !box.classList.contains('jz-hidden') && box.getClientRects().length
        ) || null;
    }

    function clear_inactive_table_heights(activeBox) {
        const root = get_page_root_element();
        if (!root) return;
        root.querySelectorAll('.jz-table-box[data-jz-viewport-fit="1"]').forEach(box => {
            if (box === activeBox) return;
            box.removeAttribute('data-jz-viewport-fit');
            box.removeAttribute('data-jz-viewport-height');
            box.style.removeProperty('--jz-active-table-height');
            box.querySelectorAll('.jz-viewport-spacer-row').forEach(row => row.remove());
        });
    }

    function sync_active_table_footer(activeBox) {
        const table = activeBox?.querySelector(':scope > table.jz-table');
        const tbody = table?.tBodies?.[0];
        const tfoot = table?.tFoot;
        if (!table || !tbody || !tfoot || !tfoot.rows.length) return;

        tbody.querySelectorAll('.jz-viewport-spacer-row').forEach(row => row.remove());
        const missingHeight = Math.floor(activeBox.clientHeight - table.getBoundingClientRect().height);
        if (missingHeight <= 1) return;

        const headerRow = table.tHead?.rows?.[table.tHead.rows.length - 1];
        const columnCount = headerRow
            ? Array.from(headerRow.cells).reduce((count, cell) => count + (cell.colSpan || 1), 0)
            : 1;
        const spacerRow = document.createElement('tr');
        const spacerCell = document.createElement('td');
        spacerRow.className = 'jz-viewport-spacer-row';
        spacerRow.setAttribute('aria-hidden', 'true');
        spacerRow.style.setProperty('--jz-viewport-spacer-height', `${missingHeight}px`);
        spacerCell.colSpan = columnCount;
        spacerRow.appendChild(spacerCell);
        tbody.appendChild(spacerRow);
    }

    function adjust_active_table_height() {
        const root = get_page_root_element();
        if (!root || !root.getClientRects().length) return;
        const activeBox = get_active_table_box();
        if (!activeBox) return;

        const viewport = window.visualViewport;
        const viewportBottom = (viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight);
        const tableTop = activeBox.getBoundingClientRect().top;
        const availableHeight = Math.floor(viewportBottom - tableTop - TABLE_BOTTOM_GAP);
        const targetHeight = Math.max(TABLE_MIN_HEIGHT, availableHeight);
        const currentHeight = Number(activeBox.dataset.jzViewportHeight || 0);

        clear_inactive_table_heights(activeBox);
        if (activeBox.dataset.jzViewportFit === '1' && Math.abs(currentHeight - targetHeight) < 2) {
            sync_active_table_footer(activeBox);
            return;
        }

        activeBox.dataset.jzViewportFit = '1';
        activeBox.dataset.jzViewportHeight = String(targetHeight);
        activeBox.style.setProperty('--jz-active-table-height', `${targetHeight}px`);
        window.requestAnimationFrame(() => sync_active_table_footer(activeBox));
    }

    function schedule_active_table_height() {
        if (table_height_frame) {
            window.cancelAnimationFrame(table_height_frame);
        }
        table_height_frame = window.requestAnimationFrame(() => {
            table_height_frame = window.requestAnimationFrame(() => {
                table_height_frame = 0;
                adjust_active_table_height();
            });
        });
    }

    function initialize_table_viewport_controller() {
        const root = get_page_root_element();
        if (!root) return;

        pageQuery(window)
            .off('resize.jizhongTableViewport')
            .on('resize.jizhongTableViewport', schedule_active_table_height);
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', schedule_active_table_height);
        }
        if (window.ResizeObserver) {
            table_layout_observer = new ResizeObserver(schedule_active_table_height);
            root.querySelectorAll([
                '.jz-header',
                '.jz-month-status-strip',
                '.jz-nav-tabs',
                '.jz-kpi-grid',
                '.jz-toolbar',
                '.jz-cash-stat-bar',
                '.jz-policy-panel',
                '.jz-insurance-sheet-toolbar'
            ].join(',')).forEach(element => table_layout_observer.observe(element));
        }
        schedule_active_table_height();
    }

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
                schedule_active_table_height();
            },
            error: function(xhr) {
                set_table_state(target, colspan, call_error_text(xhr, '读取失败，请检查权限或网络后重试。'), true);
            }
        });
    }

    function render_workflow_error(response, fallback) {
        const message = call_error_text(response, fallback);
        $('#jz-month-confirmation-summary').text(message);
        $('#jz-month-overall-status')
            .attr('class', 'jz-status-pending')
            .text('状态读取失败');
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

    function update_calculated_sheet_titles(isCalculating) {
        const payMonthTitle = format_payment_month_title(current_month);
        const suffix = isCalculating ? " (正在后台计算...)" : "";
        $("#jz-tax-sheet-title").text(`${payMonthTitle}个人所得税明细单${suffix}`).toggleClass("jz-calc-pulse", Boolean(isCalculating));
        $("#jz-payroll-sheet-title").text(`${payMonthTitle}工资核定明细单${suffix}`).toggleClass("jz-calc-pulse", Boolean(isCalculating));
        $("#jz-cash-sheet-title").text(`${payMonthTitle}现金发放与配钞明细单${suffix}`).toggleClass("jz-calc-pulse", Boolean(isCalculating));
    }

    function set_workflow_button_state(selector, disabled, title) {
        const $button = selector && selector.jquery ? selector : $(selector);
        if (!$button.length) return;
        $button.prop('disabled', Boolean(disabled)).toggleClass('disabled', Boolean(disabled));
        if (title) $button.attr('title', title);
        else $button.removeAttr('title');
    }

    function update_workflow_action_controls(workflow) {
        // 更新顶栏核定按钮状态与各页签状态指示灯 (绿=完成, 黄=未完成, 红=错误)
        const stepStatusKeys = [
            { tab: 'employees', key: 'employees' },
            { tab: 'attendance', key: 'attendance' },
            { tab: 'social_insurance', key: 'social_insurance' },
            { tab: 'housing_fund', key: 'housing_fund' },
            { tab: 'tax', key: 'tax' },
            { tab: 'payroll', key: 'payroll' },
            { tab: 'cash_bills', key: 'cash_bills' }
        ];
        stepStatusKeys.forEach(({ tab, key }) => {
            const stepDetail = (workflow?.steps || []).find(item => item.tab === key);
            const $btn = $(`.jz-tab-btn[data-tab="${tab}"]`);
            let $dot = $btn.find('.tab-status-dot');
            if (!$dot.length) {
                $dot = $('<span class="tab-status-dot"></span>');
                $btn.prepend($dot);
            }
            $dot.removeClass('status-ok status-warn status-err');
            if (stepDetail && stepDetail.is_confirmed) {
                $dot.addClass('status-ok');
            } else if (stepDetail && (stepDetail.error || stepDetail.has_error)) {
                $dot.addClass('status-err');
            } else {
                $dot.addClass('status-warn');
            }
        });

        if (workflow?.is_locked) {
            $('#btn-jz-header-lock')
                .text(' 已核定锁定 (申请解锁)')
                .removeClass('btn-primary btn-success')
                .addClass('btn-default')
                .prop('disabled', false)
                .attr('title', '点击申请反审核解锁');
        } else if (workflow?.can_lock) {
            $('#btn-jz-header-lock')
                .text(' 立即核定本月数据')
                .removeClass('btn-default')
                .addClass('btn-primary btn-success')
                .prop('disabled', false)
                .attr('title', '前置步骤全部完成，点击执行最终核定封账');
        } else {
            $('#btn-jz-header-lock')
                .text('核定本月数据')
                .removeClass('btn-success')
                .addClass('btn-primary')
                .prop('disabled', true)
                .attr('title', '需先完成所有前置页签的确认 (全部标绿)');
        }

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
                $button.text(`取消确认${label}`)
                    .addClass('jz-btn-stage-cancel')
                    .removeClass('btn-success jz-btn-green');
                set_workflow_button_state(
                    $button,
                    !detail.can_unconfirm,
                    '点击取消确认该步骤及强锁定的关联步骤'
                );
                return;
            }
            $button.text(`确认${label}`).removeClass('jz-btn-stage-cancel');
            if ($button.hasClass('jz-insurance-action')) {
                $button.addClass('btn-success jz-btn-green');
            }
            if (step === 'employees') {
                set_workflow_button_state(
                    $button,
                    false,
                    detail.is_ready ? '点击确认员工薪资档案并锁定' : '点击核验员工档案数据并指出未完善项'
                );
                return;
            }
            set_workflow_button_state(
                $button,
                !detail.can_confirm,
                detail.can_confirm ? '确认后本账期在工作台内将只读' : (detail.cannot_confirm_reason || detail.main || '请先完成数据核验及前置确认')
            );
        });

        const empStep = get_workflow_step('employees');
        const employeesConfirmed = Boolean(empStep?.is_confirmed);
        if (empStep) {
            if (employeesConfirmed) {
                $('#jz-emp-kpi-sub').html('基准底册: <span class="jz-text-success">已确认 (只读受控)</span>');
            } else if (empStep.is_ready) {
                $('#jz-emp-kpi-sub').html('基准底册: <span class="jz-text-primary">档案完整 (可确认)</span>');
            } else {
                $('#jz-emp-kpi-sub').html(`<span class="jz-text-warn" title="${esc(empStep.main || '')}">${esc(empStep.badge || '待完善')}</span>`);
            }
        }
        const attendanceConfirmed = Boolean(get_workflow_step('attendance')?.is_confirmed);
        const socialConfirmed = Boolean(get_workflow_step('social_insurance')?.is_confirmed);
        const housingConfirmed = Boolean(get_workflow_step('housing_fund')?.is_confirmed);
        const insurancePreviewReady = Boolean(workflow_state.insurance_sheets?.preview_ready);
        const socialPrintReady = Boolean(workflow_state.insurance_sheets?.social_insurance?.print_ready);
        const housingPrintReady = Boolean(workflow_state.insurance_sheets?.housing_fund?.print_ready);
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
            '#btn-jz-edit-social-insurance',
            socialConfirmed,
            socialConfirmed ? '社会保险已确认，请先取消确认后修改' : ''
        );
        set_workflow_button_state(
            '#btn-jz-edit-housing-fund',
            housingConfirmed,
            housingConfirmed ? '住房公积金已确认，请先取消确认后修改' : ''
        );
        const curInsConfirmed = current_tab === 'housing_fund' ? housingConfirmed : socialConfirmed;
        set_workflow_button_state(
            '#btn-jz-edit-policy-setting',
            curInsConfirmed,
            curInsConfirmed ? '当前板块已确认，请先取消确认后修改' : ''
        );
        set_workflow_button_state(
            '#btn-jz-open-insurance-form',
            socialConfirmed || housingConfirmed,
            socialConfirmed || housingConfirmed ? '已确认的费率只能在对应页签取消确认后修改' : ''
        );
        set_workflow_button_state(
            '#btn-jz-calc-payroll',
            !workflow_state.can_calculate,
            workflow_state.can_calculate ? '' : '需先确认员工档案、考勤与工时、社会保险和住房公积金'
        );
        set_workflow_button_state(
            '#btn-jz-sync-calc-payroll',
            !workflow_state.can_calculate,
            workflow_state.can_calculate ? '' : '需先确认员工档案、考勤与工时、社会保险和住房公积金'
        );
        set_workflow_button_state(
            '#btn-jz-lock-payroll',
            !workflow_state.can_lock,
            workflow_state.can_lock ? '' : '需确认全部前置资料后才能最终核定'
        );
        $('#btn-jz-calc-payroll')
            .toggleClass('jz-action-primary', Boolean(workflow_state.can_calculate) && !workflow_state.can_lock)
            .toggleClass('jz-action-secondary', Boolean(workflow_state.can_lock));
        $('#btn-jz-lock-payroll')
            .toggleClass('jz-action-primary', Boolean(workflow_state.can_lock))
            .toggleClass('jz-action-secondary', !workflow_state.can_lock);
        set_workflow_button_state(
            '#btn-jz-generate-insurance-sheets',
            !insurancePreviewReady,
            insurancePreviewReady
                ? '重新读取当前页签的确认表'
                : (workflow_state.insurance_sheets?.reason || '请先确认员工档案和本页费率配置')
        );
        set_workflow_button_state(
            '#btn-jz-print-social-insurance',
            !socialPrintReady,
            socialPrintReady ? '打印当前账期社会保险确认表' : '社会保险尚未确认，不能打印'
        );
        set_workflow_button_state(
            '#btn-jz-print-housing-fund',
            !housingPrintReady,
            housingPrintReady ? '打印当前账期住房公积金确认表' : '住房公积金尚未确认，不能打印'
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

    function prev_period(period) {
        const [year, month] = String(period).split('-').map(Number);
        if (!year || !month) return '';
        return month === 1
            ? `${year - 1}-12`
            : `${year}-${String(month - 1).padStart(2, '0')}`;
    }

    function format_payment_month_title(period) {
        const [year, month] = String(period || '').split('-').map(Number);
        return year && month ? `${year}年${month}月` : '';
    }

    function employee_category(employee_type, employment_status) {
        const value = String(employee_type || '正式工').trim();
        const status = String(employment_status || '').trim();
        if (value === '本月离职' || value === '本月离职人员' || status === '本月离职') return '本月离职人员';
        if (['返聘工', '退休返聘', '退休返聘人员', '其他-返聘工'].includes(value)) return '退休返聘人员';
        if (['临时工', '零工'].includes(value)) return '临时工';
        return (value === '正式工' || value === '其他-正式工') ? '正式工' : '其他类型员工';
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
        if (['退休返聘人员', '其他类型员工', '临时工', '其他'].includes(etype)) {
            return '不参保';
        }
        const rawMode = String(it.social_security_base_mode || '').trim();
        if (rawMode.includes('动态') || rawMode.includes('20%')) {
            return '动态基数(税前工资20%)';
        }
        if (rawMode === '固定基数' || rawMode === '自定义') {
            return '固定基数';
        }
        return '最低基数';
    }

    function format_housing_fund_base_mode_label(it) {
        const etype = String(it.employee_type || '').trim();
        const policy = String(it.housing_fund_policy || '').trim();
        if (['退休返聘人员', '其他类型员工', '临时工', '其他'].includes(etype) || policy === '不缴纳' || policy === '固定停缴') {
            return '不缴纳';
        }
        const rawMode = String(it.housing_fund_base_mode || '').trim();
        if (rawMode.includes('动态') || rawMode.includes('5%') || rawMode.includes('20%')) {
            return '动态基数(税前工资5%)';
        }
        if (rawMode === '固定基数' || rawMode === '自定义') {
            return '固定基数';
        }
        if (rawMode.includes('最低')) {
            return '最低基数';
        }
        const hfBase = flt(it.effective_housing_fund_base || it.housing_fund_base || it.custom_housing_fund_base);
        if (hfBase > 3000) {
            return '固定基数';
        }
        return '最低基数';
    }

    function format_housing_fund_cycle_label(it) {
        const etype = String(it.employee_type || '').trim();
        const policy = String(it.housing_fund_policy || '').trim();
        if (['退休返聘人员', '其他类型员工', '临时工', '其他'].includes(etype) || policy === '不缴纳' || policy === '固定停缴') {
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

    function jizhong_housing_fund_policy_label(value) {
        return {
            '跟随公司规则': '季度初规则',
            '固定缴纳': '每月正常缴纳',
            '固定停缴': '不缴纳'
        }[String(value || '').trim()] || String(value || '季度初规则').trim();
    }


    function jizhong_salary_mode_badge(value) {
        const label = jizhong_salary_mode_label(value);
        let cls = 'jz-mode-pre-dynamic';
        if (label === '税前固定工资') {
            cls = 'jz-mode-pre-fixed';
        } else if (label === '税后固定工资') {
            cls = 'jz-mode-post-fixed';
        } else if (label === '税后动态工资') {
            cls = 'jz-mode-post-dynamic';
        }
        return `<span class="jz-mode-badge ${cls}">${esc(label)}</span>`;
    }

    function jizhong_salary_mode_label(value) {
        const s = String(value || '').trim();
        if (s === '税后管理工资' || s === '税后固定工资') {
            return '税后固定工资';
        }
        return s || '税前动态工资';
    }

    function is_jizhong_fixed_net_mode(value) {
        const s = String(value || '').trim();
        return s === '税后管理工资' || s === '税后固定工资';
    }

    function configure_jizhong_dialog_close_actions(dialog) {
        if (!dialog) return dialog;

        const closeLabel = '关闭窗口';
        const closeDialog = () => dialog.hide();

        if (typeof dialog.set_secondary_action === 'function') {
            dialog.set_secondary_action(closeDialog);
            dialog.set_secondary_action_label(closeLabel);
        }

        const $header = dialog.$wrapper?.find('.modal-header');
        const $existingClose = $header?.find('.close, .btn-modal-close').first();
        if ($existingClose?.length) {
            $existingClose
                .addClass('ashan-modal-close-btn jz-dialog-close-btn')
                .removeClass('hide')
                .removeAttr('style')
                .attr('title', closeLabel)
                .attr('aria-label', closeLabel)
                .off('click.jizhongDialogClose')
                .on('click.jizhongDialogClose', closeDialog);
        } else if ($header?.length) {
            $('<button>', {
                type: 'button',
                class: 'ashan-modal-close-btn jz-dialog-close-btn',
                text: '×',
                title: closeLabel,
                'aria-label': closeLabel
            })
                .on('click.jizhongDialogClose', closeDialog)
                .appendTo($header);
        }

        return dialog;
    }

    function open_jizhong_detail_dialog(title, content) {
        const dialog = window.AshanUI.createDialog({
            title,
            fields: [{
                fieldname: 'detail_content',
                fieldtype: 'HTML',
                options: `<div class="jz-work-hours-help">${content}</div>`
            }]
        });
        return configure_jizhong_dialog_close_actions(dialog).show();
    }

    function is_insurance_tab(tab) {
        return tab === 'social_insurance' || tab === 'housing_fund';
    }

    function set_policy_panel_expanded() {
        // 政策参数面板常驻展开，取消收起/展开折叠按钮
        $('#jz-policy-panel-body').removeClass('jz-hidden');
        $('.jz-policy-panel').addClass('jz-policy-expanded');
        schedule_active_table_height();
    }

    function update_jizhong_proof_controls(tab) {
        const activeTab = tab || (current_tab === 'housing_fund' ? 'housing_fund' : 'social_insurance');
        const isSocial = activeTab === 'social_insurance';
        const sheets = jz_insurance_sheets_cache || {};
        const secData = isSocial ? (sheets.social_insurance || {}) : (sheets.housing_fund || {});
        const totals = secData.totals || {};
        const sysTotal = isSocial
            ? flt(totals.grand_total || (flt(totals.person_total) + flt(totals.company_total)))
            : flt(totals.total_amount || (flt(totals.person_amount) + flt(totals.company_amount)));

        const hasProof = Boolean(secData.proof_file);
        const parsedAmt = flt(secData.parsed_amount);
        const verifyStatus = String(secData.verify_status || '待上传');

        $('#btn-jz-upload-proof').text(hasProof ? '重新上传凭证' : '上传缴费凭证');
        $('#btn-jz-view-proof').toggleClass('jz-hidden', !hasProof);

        const $badge = isSocial ? $('#jz-ss-proof-badge') : $('#jz-hf-proof-badge');
        $badge.removeClass('is-ok is-err is-pending');
        if (hasProof) {
            if (verifyStatus === '核验一致' || Math.abs(parsedAmt - sysTotal) < 0.01) {
                $badge
                    .addClass('is-ok')
                    .text(`验证一致：凭证 ${window.AshanUI.formatMoney(parsedAmt)} = 系统 ${window.AshanUI.formatMoney(sysTotal)}`);
            } else {
                const diff = Math.abs(parsedAmt - sysTotal);
                $badge
                    .addClass('is-err')
                    .text(`验证不一致：凭证 ${window.AshanUI.formatMoney(parsedAmt)} vs 系统 ${window.AshanUI.formatMoney(sysTotal)} (差额 ${window.AshanUI.formatMoney(diff)})`);
            }
        } else {
            $badge
                .addClass('is-pending')
                .text(sysTotal > 0 ? `待上传凭证验证 (系统计划 ${window.AshanUI.formatMoney(sysTotal)})` : '待上传凭证验证');
        }
    }

    function set_insurance_view(tab) {
        const isSocial = tab === 'social_insurance';
        const payTitle = format_payment_month_title(next_period(current_month));
        $('#jz-tab-insurance').attr('data-insurance-view', tab);
        set_policy_panel_expanded();
        $('#btn-jz-edit-policy-setting')
            .text(isSocial ? '设置本月社保参数' : '设置本月公积金参数')
            .toggleClass('jz-hidden', !can_configure_insurance);
        $('.jz-insurance-action').each(function() {
            const $action = $(this);
            const needsConfigurePermission = $action.hasClass('jz-btn-orange');
            $action.toggleClass(
                'jz-hidden',
                $action.data('insurance-section') !== tab || (needsConfigurePermission && !can_configure_insurance)
            );
        });
        $('.jz-insurance-section-social').toggleClass('jz-hidden', !isSocial);
        $('.jz-insurance-section-housing').toggleClass('jz-hidden', isSocial);
        $('#jz-ins-config-title').text(
            isSocial
                ? '天津吉众科技有限公司 · 本月社会保险费率'
                : '天津吉众科技有限公司 · 本月住房公积金费率'
        );
        $('#jz-ins-sheet-title').text(isSocial ? `${payTitle}社会保险明细` : `${payTitle}住房公积金明细`);
        update_jizhong_proof_controls(tab);
    }

        $('#btn-jz-upload-proof').on('click', function() {
        const isSocial = current_tab !== 'housing_fund';
        const isConfirmed = Boolean(get_workflow_step(isSocial ? 'social_insurance' : 'housing_fund')?.is_confirmed);
        if (isConfirmed) {
            frappe.msgprint('当前单据已确认锁定，如需重新上传凭证请先取消确认。');
            return;
        }
        $('#jz-ins-proof-file-input').val('').trigger('click');
    });

    $('#jz-ins-proof-file-input').on('change', function() {
        const files = Array.from(this.files || []);
        if (!files.length) return;
        const isSocial = current_tab !== 'housing_fund';
        const $btn = $('#btn-jz-upload-proof');
        const origText = $btn.text();
        $btn.prop('disabled', true).text('正在核对凭证…');

        const readPromises = files.map(file => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const res = String(reader.result || '');
                const b64 = res.includes(',') ? res.split(',')[1] : res;
                resolve({ file_name: file.name, file_base64: b64 });
            };
            reader.onerror = () => reject(new Error('读取文件失败'));
            reader.readAsDataURL(file);
        }));

        Promise.all(readPromises).then(entries => {
            const method = isSocial
                ? 'ashan_cn_procurement.services.payroll_settlement_service.upload_and_verify_social_security_file'
                : 'ashan_cn_procurement.services.payroll_settlement_service.upload_and_verify_housing_fund_file';
            frappe.call({
                method,
                type: 'POST',
                args: {
                    company: COMPANY,
                    period_month: current_month,
                    files_json: JSON.stringify(entries)
                },
                callback: function(r) {
                    const res = r.message || {};
                    if (res.success) {
                        if (res.is_matched) {
                            frappe.show_alert({ message: '验证一致：凭证所属期与总额完全一致！', indicator: 'green' }, 6);
                        } else {
                            frappe.msgprint({ title: '验证发现不一致', indicator: 'orange', message: res.message || '凭证金额与系统计划金额存在差异，请核对。' });
                        }
                        load_insurance_data();
                        load_workflow_status();
                    } else {
                        frappe.msgprint({ title: '凭证核验未通过', indicator: 'red', message: res.message || '请检查上传的 PDF/ZIP 凭证。' });
                    }
                },
                always: function() {
                    $btn.prop('disabled', false).text(origText);
                }
            });
        }).catch(() => {
            $btn.prop('disabled', false).text(origText);
            frappe.show_alert({ message: '读取本地文件失败，请重试。', indicator: 'red' });
        });
    });

    $('#btn-jz-view-proof').on('click', function() {
        const ptype = current_tab === 'housing_fund' ? 'housing_fund' : 'social_security';
        const url = `/api/method/ashan_cn_procurement.services.payroll_settlement_service.download_payroll_proof_file?company=${encodeURIComponent(COMPANY)}&period_month=${encodeURIComponent(current_month)}&proof_type=${encodeURIComponent(ptype)}`;
        window.open(url, '_blank');
    });

    $('#btn-jz-edit-policy-setting').on('click', function() {
        open_insurance_rate_dialog(current_tab === 'housing_fund' ? 'housing_fund' : 'social_insurance');
    });

    $(pageRoot).on('click', '.jz-progress-popover-item', function() {
        const tab = $(this).data('tab');
        if (tab) {
            $(`.jz-tab-btn[data-tab="${tab}"]`).click();
        }
    });

    // Tab 切换逻辑
    $('.jz-tab-btn').on('click', function() {
        const tab = $(this).data('tab');
        $('.jz-tab-btn').removeClass('active');
        $(this).addClass('active');
        $('.jz-tab-content').addClass('jz-hidden');
        if (!allowed_tabs.has(tab)) return;
        const contentTab = is_insurance_tab(tab) ? 'insurance' : tab;
        $('#jz-tab-' + esc(contentTab)).removeClass('jz-hidden');
        if (is_insurance_tab(tab)) set_insurance_view(tab);
        current_tab = tab;

        if (tab === 'payroll') load_payroll_data();
        else if (tab === 'attendance') load_attendance_data();
        else if (tab === 'cash_bills') load_cash_data();
        else if (tab === 'tax') load_tax_data();
        else if (tab === 'employees') load_employees_data();
        else if (is_insurance_tab(tab)) load_insurance_data();
        else if (tab === 'history') load_history_data();
        schedule_active_table_height();
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

    function refresh_current_view() {
        jz_insurance_sheets_cache = null;
        render_insurance_sheets(null);
        load_workflow_status();
        if (current_tab === 'payroll') load_payroll_data();
        else if (current_tab === 'attendance') load_attendance_data();
        else if (current_tab === 'cash_bills') load_cash_data();
        else if (current_tab === 'tax') load_tax_data();
        else if (current_tab === 'employees') load_employees_data();
        else if (is_insurance_tab(current_tab)) load_insurance_data();
        else if (current_tab === 'history') load_history_data();
        schedule_active_table_height();
    }

    $('.jz-btn-stage-confirmation').on('click', function() {
        const $button = $(this);
        const step = String($button.data('step') || '');
        const detail = get_workflow_step(step);
        const label = confirmation_labels[step] || '当前步骤';
        if (!detail) return;

        if (!detail.is_confirmed) {
            if (!detail.can_confirm && step !== 'employees') {
                const reason = detail.cannot_confirm_reason || detail.main || '请先完成数据核验及前置确认';
                frappe.show_alert({
                    message: `<div class="jz-validation-alert-title">暂无法确认【${label}】：</div><div>${esc(reason)}</div>`,
                    indicator: 'orange'
                }, 5);
                return;
            }
            if (step === 'employees') {
                const checkRes = validate_jizhong_employee_profiles(employees_cache);
                employee_validation_errors = checkRes.errors;
                employee_validation_active = checkRes.issueList.length > 0;

                if (checkRes.issueList.length > 0) {
                    if ($('#jz-emp-search').val() || ($('#jz-emp-type-filter .jz-segment-btn.active').data('type') || 'all') !== 'all') {
                        $('#jz-emp-search').val('');
                        $('#jz-emp-type-filter .jz-segment-btn').removeClass('active').attr('aria-pressed', 'false');
                        $('#jz-emp-type-filter .jz-segment-btn[data-type="all"]').addClass('active').attr('aria-pressed', 'true');
                    }
                    render_employees_table();

                    const $firstInvalid = $('#tbody-jz-employees').find('.jz-cell-invalid, .jz-row-invalid').first();
                    if ($firstInvalid.length) {
                        $firstInvalid[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }

                    const shown = checkRes.issueList.slice(0, 4).map(msg => `<div class="jz-alert-issue-item">• ${esc(msg)}</div>`).join('');
                    const more = checkRes.issueList.length > 4 ? `<div class="jz-alert-issue-more">另有 ${checkRes.issueList.length - 4} 处未列出，共 ${checkRes.issueList.length} 处错误</div>` : '';
                    frappe.show_alert({
                        message: `<div class="jz-validation-alert"><div class="jz-validation-alert-title">员工档案核验未通过，无法确认：</div>${shown}${more}<div class="jz-validation-alert-foot">已在表格内部用红色标出错误单元格，请核对修改！</div></div>`,
                        indicator: 'red'
                    }, 8);
                    return;
                }
            }

            frappe.confirm(
                `确认【${current_month}】${label}吗？确认后该步骤将在工作台内只读，须取消确认后才能修改。`,
                function() {
                    run_write_action($button, {
                        method: 'ashan_cn_procurement.services.jizhong_payroll_service.lock_jizhong_monthly_payroll',
                        args: { company: COMPANY, period_month: current_month, step },
                        busyText: '正在确认…',
                        success: function(result) {
                            employee_validation_errors = {};
                            employee_validation_active = false;
                            frappe.show_alert({ message: result.message, indicator: 'green' }, 6);
                            if (result.auto_calculated) {
                                update_calculated_sheet_titles(true);
                                setTimeout(function() {
                                    refresh_current_view();
                                    update_calculated_sheet_titles(false);
                                }, 400);
                            } else {
                                refresh_current_view();
                            }
                        },
                        error: function(message) {
                            frappe.show_alert({ message, indicator: 'red' });
                        }
                    });
                }
            );
            return;
        }

        let cancelHelp = detail.cancel_impact_desc || '取消确认后可恢复修改该步骤。';
        if (!detail.cancel_impact_desc) {
            if (step === 'employees') {
                cancelHelp = '动态计算关联：员工档案与考勤工时相互独立；社保、公积金与员工档案强锁定，取消将联动取消社保、公积金。若已生成工资测算，将一并全部取消。';
            } else if (step === 'attendance') {
                cancelHelp = '动态计算关联：考勤工时与员工档案相互独立，取消考勤不影响员工档案。若已生成工资测算，将一并全部取消。';
            } else if (step === 'social_insurance' || step === 'housing_fund') {
                cancelHelp = '动态计算关联：社保、公积金与员工档案强锁定，要取消一起取消。若已生成工资测算，将一并全部取消。';
            } else if (step === 'tax' || step === 'cash_bills') {
                cancelHelp = '动态计算关联：个人所得税、工资核定、现金发放与所有步骤强行锁定，要取消都全部取消并清除测算结果。';
            }
        }

        const dialog = window.AshanUI.createDialog({
            title: `取消确认${label}（${current_month}）`,
            fields: [{
                fieldname: 'reason',
                fieldtype: 'Small Text',
                label: '取消确认原因',
                reqd: 1,
                description: cancelHelp
            }],
            primary_action_label: '确认取消',
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
        configure_jizhong_dialog_close_actions(dialog).show();
    });

    // 0. 加载月度确认、测算与核定流程状态。
    function load_workflow_status() {
        const requested_month = current_month;
        jz_insurance_sheets_cache = null;
        render_insurance_sheets(null);
        $('#jz-month-confirmation-summary').text('正在读取本月确认状态');
        $('#jz-month-overall-status')
            .attr('class', 'jz-status-pending')
            .text('正在读取账期状态');
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
                const stepLabels = {
                    employees: '员工档案',
                    attendance: '考勤与工时',
                    social_insurance: '社会保险',
                    housing_fund: '住房公积金',
                    tax: '个人所得税台账',
                    cash_bills: '现金发放'
                };
                const stepOrder = ['employees', 'attendance', 'social_insurance', 'housing_fund', 'tax', 'cash_bills'];
                const pendingSteps = [];
                const confirmedSteps = [];
                let popoverItemsHtml = '';

                stepOrder.forEach((tabKey, idx) => {
                    const stepItem = (d.steps || []).find(s => s.tab === tabKey);
                    const label = stepLabels[tabKey] || tabKey;
                    const isConfirmed = Boolean(stepItem && stepItem.is_confirmed);
                    const statusText = isConfirmed ? '已确认' : (stepItem?.badge || '未确认');
                    const dotClass = isConfirmed ? 'jz-dot-confirmed' : 'jz-dot-pending';
                    const itemClass = isConfirmed ? 'jz-popover-item-confirmed' : 'jz-popover-item-pending';

                    if (isConfirmed) {
                        confirmedSteps.push(`${label} (已确认)`);
                    } else {
                        pendingSteps.push(`${label} (${statusText})`);
                    }

                    popoverItemsHtml += `
                        <div class="jz-progress-popover-item ${itemClass}" data-tab="${tabKey}" title="点击前往 ${esc(label)}">
                            <span class="jz-progress-popover-dot ${dotClass}" aria-hidden="true"></span>
                            <span class="jz-progress-popover-item-title">${idx + 1}. ${esc(label)}</span>
                            <span class="jz-progress-popover-item-status">${esc(statusText)}</span>
                        </div>
                    `;
                });

                const confirmedCount = confirmedSteps.length;
                $('#jz-month-confirmation-summary').text(
                    `${d.period_label || current_month} · 前置确认 ${confirmedCount} / 6`
                );
                $('#jz-popover-count').text(`${confirmedCount} / 6`);
                $('#jz-popover-list').html(popoverItemsHtml);

                let hoverTitle = `${d.period_label || current_month} · 前置确认进度 (${confirmedCount} / 6)\n`;
                if (pendingSteps.length > 0) {
                    hoverTitle += `未完成步骤 (${pendingSteps.length} 项)：\n` + pendingSteps.map(s => `• ${s}`).join('\n');
                } else {
                    hoverTitle += `全部前置步骤均已确认完成！`;
                }
                if (confirmedSteps.length > 0 && pendingSteps.length > 0) {
                    hoverTitle += `\n已完成步骤 (${confirmedSteps.length} 项)：\n` + confirmedSteps.map(s => `• ${s}`).join('\n');
                }
                $('#jz-month-confirmation-summary').attr('title', hoverTitle);

                $('#jz-month-overall-status')
                    .attr('class', overallClass)
                    .text(d.overall_status_text || '状态未知');

                if (payroll_cache.length > 0 && current_payroll_settlement) {
                    update_payroll_kpi_and_table();
                }
            }
        });
    }

    // 1. 加载月度薪酬核定表
    let payroll_cache = [];
    let current_payroll_settlement = null;
    function update_payroll_kpi_and_table() {
        const set = current_payroll_settlement || {};
        const items = payroll_cache || [];
        const taxStep = get_workflow_step('tax');
        const isTaxConfirmed = Boolean(set.locked || (taxStep && taxStep.is_confirmed));
        const pendingBadge = '<span class="jz-status-badge jz-status-tax-pending">还未生成个税</span>';

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
        if (isTaxConfirmed) {
            $('#jz-payroll-sheet-meta').text(`核定发薪：${items.length}人 ｜ 应发总额：${window.AshanUI.formatMoney(set.total_gross_salary || 0)} ｜ 实发总额：${window.AshanUI.formatMoney(set.total_net_salary || 0)}`);
            $('#jz-kpi-net').text(window.AshanUI.formatMoney(set.total_net_salary || 0));
            $('#jz-kpi-gross').text(window.AshanUI.formatMoney(set.total_gross_salary || 0));
            $('#jz-kpi-person-ded').text(window.AshanUI.formatMoney((flt(set.total_social_security_person) + flt(set.total_housing_fund_person) + flt(set.total_tax))));
            $('#jz-kpi-tax').text(window.AshanUI.formatMoney(set.total_tax || 0));
        } else {
            $('#jz-payroll-sheet-meta').html(`核定发薪：${items.length}人 ｜ 个人所得税尚未核定（${pendingBadge} · 请前往【个人所得税】核定个税后生成完整税前/税后与实发汇总）`);
            $('#jz-kpi-net').html(pendingBadge);
            $('#jz-kpi-gross').html(pendingBadge);
            $('#jz-kpi-person-ded').html(pendingBadge);
            $('#jz-kpi-tax').html(pendingBadge);
        }
        update_calculated_sheet_titles(false);

        $('#jz-kpi-ss-pers').text(window.AshanUI.formatMoney(set.total_social_security_person || 0));
        $('#jz-kpi-hf-pers').text(window.AshanUI.formatMoney(set.total_housing_fund_person || 0));
        $('#jz-kpi-comp-cost').text(window.AshanUI.formatMoney((flt(set.total_social_security_company) + flt(set.total_housing_fund_company))));
        $('#jz-kpi-ss-comp').text(window.AshanUI.formatMoney(set.total_social_security_company || 0));
        $('#jz-kpi-hf-comp').text(window.AshanUI.formatMoney(set.total_housing_fund_company || 0));

        render_payroll_table();
    }

    function load_payroll_data() {
        read_call(
            'ashan_cn_procurement.services.jizhong_payroll_service.get_jizhong_payroll_overview',
            { company: COMPANY, period_month: current_month },
            '#tbody-jz-payroll',
            20,
            function(message) {
                current_payroll_settlement = message.settlement || {};
                payroll_cache = message.items || [];
                update_payroll_kpi_and_table();
            },
            '正在读取吉众工资核定表…'
        );
    }

    // 渲染 Payroll Table 表头与数据行 (依据计薪方式与个税核定状态动态呈现)
    function render_payroll_table() {
        const thead = $('#thead-jz-payroll');
        const tbody = $('#tbody-jz-payroll');
        const tfoot = $('#tfoot-jz-payroll');
        thead.empty();
        tbody.empty();
        tfoot.empty();

        const isDetail = (payroll_col_view === 'detail');
        const taxStep = get_workflow_step('tax');
        const isTaxConfirmed = Boolean((current_payroll_settlement && current_payroll_settlement.locked) || (taxStep && taxStep.is_confirmed));
        const pendingBadge = '<span class="jz-status-badge jz-status-tax-pending">还未生成个税</span>';

        // 1. 表头
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
            return true;
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

            // 依据计薪方式与个税核定状态动态决定单元格渲染
            const modeLabel = jizhong_salary_mode_label(it.salary_mode);
            const isFixedNet = (modeLabel === '税后固定工资');

            let cellGross = window.AshanUI.formatMoney(gross);
            let cellTax = window.AshanUI.formatMoney(tax);
            let cellPCost = window.AshanUI.formatMoney(pCost);
            let cellNet = window.AshanUI.formatMoney(net);
            let cellCash = window.AshanUI.formatMoney(cash);
            let cellSBasic = window.AshanUI.formatMoney(sBasic);

            if (!isTaxConfirmed) {
                cellTax = pendingBadge;
                cellPCost = pendingBadge;
                if (isFixedNet) {
                    // 税后固定工资：目标已知税后，税前与个税未生成 -> 不显示税前工资和个税，用黄色标注还未生成个税
                    cellGross = pendingBadge;
                    cellSBasic = pendingBadge;
                    cellNet = window.AshanUI.formatMoney(it.fixed_salary || net);
                    cellCash = window.AshanUI.formatMoney(it.cash_pay || cash);
                } else {
                    // 税前动态工资、税前固定工资、税后动态工资等：税前已知或动态计算中，税后工资未生成 -> 不显示税后工资，用黄色标注还未生成个税
                    cellGross = window.AshanUI.formatMoney(gross);
                    cellSBasic = window.AshanUI.formatMoney(sBasic);
                    cellNet = pendingBadge;
                    cellCash = pendingBadge;
                }
            }

            // 汇总累加
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
                        <td>${esc(jizhong_salary_mode_label(it.salary_mode))}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(it.base_salary)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(it.post_allowance)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(it.performance_salary)}</td>
                        <td class="jz-num-cell">${fmtHours(bHrs)}</td>
                        <td class="jz-num-cell">${fmtHours(ot15)}</td>
                        <td class="jz-num-cell">${fmtHours(ot20)}</td>
                        <td class="jz-num-cell">${fmtHours(ot30)}</td>
                        <td class="jz-num-cell">${fmtHours(cLeave)}</td>
                        <td class="jz-num-cell">${mCount} 次</td>
                        <td class="jz-money-cell">${cellSBasic}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(sOt15)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(sOt20)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(sOt30)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(sSub)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(sPerf)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(sMeal)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(sAdj)}</td>
                        <td class="jz-money-cell jz-money-bold">${cellGross}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(ssP)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(hfP)}</td>
                        <td class="jz-money-cell">${cellTax}</td>
                        <td class="jz-money-cell">${cellPCost}</td>
                        <td class="jz-money-cell jz-money-primary">${cellNet}</td>
                        <td class="jz-money-cell jz-money-cash">${cellCash}</td>
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
                        <td>${esc(jizhong_salary_mode_label(it.salary_mode))}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(it.base_salary)}</td>
                        <td class="jz-num-cell">${fmtHours(bHrs)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(otPay)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(allowPerf)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(sMeal)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(sAdj)}</td>
                        <td class="jz-money-cell jz-money-bold">${cellGross}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(ssP)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(hfP)}</td>
                        <td class="jz-money-cell">${cellTax}</td>
                        <td class="jz-money-cell">${cellPCost}</td>
                        <td class="jz-money-cell jz-money-primary">${cellNet}</td>
                        <td class="jz-money-cell jz-money-cash">${cellCash}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(ssC + hfC)}</td>
                        <td class="jz-money-cell jz-money-cost">${window.AshanUI.formatMoney(cCost)}</td>
                    </tr>
                `);
            }
        });

        // 底部合计行
        let footGross = window.AshanUI.formatMoney(tot_gross);
        let footTax = window.AshanUI.formatMoney(tot_tax);
        let footPCost = window.AshanUI.formatMoney(tot_pers_ded);
        let footNet = window.AshanUI.formatMoney(tot_net);
        let footCash = window.AshanUI.formatMoney(tot_cash);

        if (!isTaxConfirmed) {
            footTax = pendingBadge;
            footPCost = pendingBadge;
            footGross = pendingBadge;
            footNet = pendingBadge;
            footCash = pendingBadge;
        }

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
                    <td class="jz-money-cell jz-money-bold">${footGross}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_ss_pers)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_hf_pers)}</td>
                    <td class="jz-money-cell">${footTax}</td>
                    <td class="jz-money-cell">${footPCost}</td>
                    <td class="jz-money-cell jz-money-primary">${footNet}</td>
                    <td class="jz-money-cell jz-money-cash">${footCash}</td>
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
                    <td class="jz-money-cell jz-money-bold">${footGross}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_ss_pers)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_hf_pers)}</td>
                    <td class="jz-money-cell">${footTax}</td>
                    <td class="jz-money-cell">${footPCost}</td>
                    <td class="jz-money-cell jz-money-primary">${footNet}</td>
                    <td class="jz-money-cell jz-money-cash">${footCash}</td>
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
            jizhong_salary_mode_label(it.salary_mode),
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
                it.employee_no, it.employee_name, jizhong_salary_mode_label(it.salary_mode),
                flt(it.gross_salary).toFixed(2), flt(it.tax_threshold).toFixed(2),
                flt(it.ss_person_total).toFixed(2), flt(it.hf_person_total).toFixed(2),
                flt(it.special_deductions_total).toFixed(2), flt(it.tax_amount).toFixed(2),
                flt(it.net_salary).toFixed(2)
            ])
        );
    });

    // 设置个税计薪周期与本月免征额度 (默认为上月值)
    function refresh_tax_threshold_inline_control() {
        const prevMonth = prev_period(current_month);
        read_call(
            'ashan_cn_procurement.services.jizhong_payroll_service.get_jizhong_insurance_setting',
            { company: COMPANY, period_month: prevMonth },
            null,
            0,
            function(prevSetting) {
                const prevVal = flt(prevSetting && prevSetting.tax_threshold) || 5000.0;
                const prevCycle = cint(prevSetting && prevSetting.tax_cycle_start_month) || 12;
                read_call(
                    'ashan_cn_procurement.services.jizhong_payroll_service.get_jizhong_insurance_setting',
                    { company: COMPANY, period_month: current_month },
                    null,
                    0,
                    function(curSetting) {
                        const curVal = flt(curSetting && curSetting.tax_threshold) || prevVal;
                        const curCycle = cint(curSetting && curSetting.tax_cycle_start_month) || prevCycle;
                        const isInherited = Boolean(curSetting && curSetting.is_inherited);
                        const isConfirmed = Boolean(get_workflow_step('tax')?.is_confirmed);

                        $('#jz-tax-threshold-input')
                            .val(curVal.toFixed(2))
                            .prop('disabled', isConfirmed || !can_configure_insurance);

                        $('#jz-tax-cycle-start-select')
                            .val(String(curCycle))
                            .prop('disabled', isConfirmed || !can_configure_insurance);

                        $('#btn-jz-tax-threshold-save')
                            .prop('disabled', isConfirmed || !can_configure_insurance)
                            .toggleClass('disabled', isConfirmed || !can_configure_insurance);

                        $('#jz-tax-threshold-hint').text(
                            isInherited
                                ? `默认上月: ${prevCycle}月起 · ${window.AshanUI.formatMoney(prevVal)} (承袭)`
                                : `上月值: ${prevCycle}月起 · ${window.AshanUI.formatMoney(prevVal)}`
                        );
                    }
                );
            }
        );
    }

    function apply_tax_threshold_setting() {
        if (!can_configure_insurance) {
            frappe.msgprint('社保、公积金和个税基础参数仅 Payroll Manager 可以修改。');
            return;
        }
        if (get_workflow_step('tax')?.is_confirmed) {
            frappe.msgprint(`本账期【${current_month}】个人所得税台账已确认并处于只读保护，请先取消确认后再修改个税参数。`);
            return;
        }
        const newThresh = flt($('#jz-tax-threshold-input').val());
        const newCycle = cint($('#jz-tax-cycle-start-select').val()) || 12;
        if (newThresh <= 0) {
            frappe.msgprint('个税免征额度必须大于 0 元/月。');
            return;
        }
        if (newCycle < 1 || newCycle > 12) {
            frappe.msgprint('计薪周期起始月必须在 1 至 12 月之间。');
            return;
        }
        run_write_action($('#btn-jz-tax-threshold-save'), {
            method: 'ashan_cn_procurement.services.jizhong_payroll_service.update_jizhong_insurance_setting',
            args: {
                company: COMPANY,
                period_month: current_month,
                values: JSON.stringify({ tax_threshold: newThresh, tax_cycle_start_month: newCycle })
            },
            busyText: '保存中…',
            success: function(res) {
                frappe.show_alert({
                    message: `【${current_month}】个税参数已保存：${newCycle}月起 · 免征额 ${window.AshanUI.formatMoney(newThresh)}`,
                    indicator: 'green'
                });
                $('#jz-ins-tax-threshold').text(`${window.AshanUI.formatMoney(newThresh)} / 月`);
                $('#jz-ins-tax-cycle').text(`${newCycle} 月开始`);
                load_tax_data();
                load_insurance_data();
                if (current_tab === 'payroll') load_payroll_data();
            },
            error: function(err) {
                frappe.show_alert({ message: err, indicator: 'red' });
            }
        });
    }

    $('#btn-jz-tax-threshold-save').on('click', apply_tax_threshold_setting);
    $('#jz-tax-cycle-start-select').on('change', apply_tax_threshold_setting);
    $('#jz-tax-threshold-input').on('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            apply_tax_threshold_setting();
        }
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
    $(wrapper).on('click', '#btn-jz-header-lock', function() {
        if (workflow_state.is_locked) {
            $('#btn-jz-unlock-payroll').click();
        } else if (workflow_state.can_lock) {
            $('#btn-jz-lock-payroll').click();
        } else {
            frappe.msgprint({
                title: '前置步骤尚未全部确认',
                indicator: 'orange',
                message: '请先完成上方显示为黄色的前置步骤确认，全部标绿后即可核定本月数据。'
            });
        }
    });

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
        configure_jizhong_dialog_close_actions(dlg).show();
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
                    coverageText += `；另有 ${excludedCount} 人免考勤（固定工资人员）`;
                }
                $('#jz-att-coverage').text(coverageText);
                $('#jz-att-sheet-title').text(`${format_payment_month_title(current_month)}考勤与工时明细`);
                $('#jz-att-sheet-meta').text(`考勤人数：${matchedCount} 免考勤人数：${excludedCount}（固定工资人员）`);

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
            tbody.html('<tr><td colspan="13" class="jz-empty-cell">该月份尚未上传考勤表，请点击“上传月度考勤”按钮。</td></tr>');
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

    // 上传考勤 Excel 弹窗 (点击直接弹出本地文件选择器，杜绝二级弹窗)
    $('#btn-jz-upload-attendance').on('click', function() {
        let selected_file = null;

        const d = window.AshanUI.createDialog({
            title: '上传吉众月度考勤表',
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
                    fieldname: 'file_section',
                    fieldtype: 'HTML',
                    options: `
                        <div class="form-group">
                            <label class="control-label">考勤文件 (员工考勤表-*.xlsx) <span class="text-danger">*</span></label>
                            <div class="jz-att-upload-box">
                                <input type="file" id="jz-att-file-input" accept=".xlsx" class="jz-hidden">
                                <div class="jz-att-upload-card" id="jz-att-upload-card" role="button" tabindex="0" title="点击直接打开本地文件选择窗口">
                                    <div class="jz-att-upload-icon-wrap" id="jz-att-upload-icon">
                                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                            <polyline points="17 8 12 3 7 8"></polyline>
                                            <line x1="12" y1="3" x2="12" y2="15"></line>
                                        </svg>
                                    </div>
                                    <div class="jz-att-upload-info">
                                        <div class="jz-att-upload-title" id="jz-att-upload-title">点击直接选择本地考勤 Excel 文件</div>
                                        <div class="jz-att-upload-desc" id="jz-att-upload-desc">点击直接弹出选择附件，支持《员工考勤表-2026年7月.xlsx》等月度全员5行多日打卡表</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `
                }
            ],
            primary_action_label: '开始解析入库',
            primary_action: function(vals) {
                if (!selected_file) {
                    frappe.show_alert({ message: '请先选择考勤 Excel 文件！', indicator: 'orange' });
                    d.$wrapper.find('#jz-att-file-input').click();
                    return;
                }
                const $btn = d.get_primary_btn();
                $btn.prop('disabled', true).text('正在解析考勤…');

                const targetPeriod = d.get_value('period_month') || vals.period_month || current_month;

                const formData = new FormData();
                formData.append('file', selected_file);
                formData.append('company', COMPANY);
                formData.append('period_month', targetPeriod);
                if (frappe.csrf_token) {
                    formData.append('csrf_token', frappe.csrf_token);
                }

                fetch('/api/method/ashan_cn_procurement.services.jizhong_attendance_service.upload_and_parse_attendance', {
                    method: 'POST',
                    body: formData,
                    headers: {
                        'X-Frappe-CSRF-Token': frappe.csrf_token || (frappe.boot && frappe.boot.csrf_token) || ''
                    }
                })
                .then(response => {
                    $btn.prop('disabled', false).text('开始解析入库');
                    return response.json();
                })
                .then(r => {
                    if (r.exc || r.exception || !r.message) {
                        let errMsg = '考勤解析失败，请检查文件格式。';
                        if (r._server_messages) {
                            try {
                                const msgs = JSON.parse(r._server_messages);
                                errMsg = JSON.parse(msgs[0]).message;
                            } catch(e) {}
                        } else if (r.message) {
                            errMsg = r.message;
                        } else if (r.exception) {
                            errMsg = r.exception;
                        }
                        frappe.msgprint({ title: '考勤解析失败', indicator: 'red', message: errMsg });
                        return;
                    }
                    const res = r.message || {};
                    frappe.msgprint(`考勤解析入库成功！共识别 ${res.employee_count} 人，正班工时 ${res.total_regular_hours}h，加班 ${res.total_ot_1_5 + res.total_ot_2_0 + res.total_ot_3_0}h，餐补 ${res.total_meals} 次。`);
                    d.hide();
                    current_month = targetPeriod;
                    $('#jz-month-select').val(current_month);
                    load_attendance_data();
                    load_workflow_status();
                })
                .catch(err => {
                    $btn.prop('disabled', false).text('开始解析入库');
                    frappe.msgprint({ title: '考勤解析失败', indicator: 'red', message: err.message || '网络或接口异常' });
                });
            }
        });

        // 绑定原位文件选择与拖拽事件
        d.$wrapper.on('click', '#jz-att-upload-card', function(e) {
            e.preventDefault();
            d.$wrapper.find('#jz-att-file-input').click();
        });

        d.$wrapper.on('change', '#jz-att-file-input', function(e) {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            if (!file.name.toLowerCase().endsWith('.xlsx')) {
                frappe.msgprint('仅支持上传 .xlsx 格式的考勤 Excel 文件！');
                return;
            }
            selected_file = file;

            // 智能识别文件名中的月份并自动回填
            const monthMatch = file.name.match(/(\d{4})[年\-_](\d{1,2})月?/) || file.name.match(/(\d{4})(\d{2})/);
            if (monthMatch) {
                const year = monthMatch[1];
                const month = String(monthMatch[2]).padStart(2, '0');
                d.set_value('period_month', `${year}-${month}`);
            }

            const sizeKb = (file.size / 1024).toFixed(1);
            d.$wrapper.find('#jz-att-upload-card').addClass('has-file');
            d.$wrapper.find('#jz-att-upload-title').text(`已选择：${file.name} (${sizeKb} KB)`);
            d.$wrapper.find('#jz-att-upload-desc').text('点击可更换文件；确认月份后点击下方按钮开始解析入库');
        });

        // 支持拖拽文件
        const $card = d.$wrapper.find('#jz-att-upload-card');
        $card.on('dragover dragenter', function(e) {
            e.preventDefault();
            e.stopPropagation();
            $(this).addClass('is-dragover');
        });
        $card.on('dragleave dragend drop', function(e) {
            e.preventDefault();
            e.stopPropagation();
            $(this).removeClass('is-dragover');
        });
        $card.on('drop', function(e) {
            const dt = e.originalEvent.dataTransfer;
            if (dt && dt.files && dt.files.length) {
                const file = dt.files[0];
                if (!file.name.toLowerCase().endsWith('.xlsx')) {
                    frappe.msgprint('仅支持上传 .xlsx 格式的考勤 Excel 文件！');
                    return;
                }
                selected_file = file;
                const monthMatch = file.name.match(/(\d{4})[年\-_](\d{1,2})月?/) || file.name.match(/(\d{4})(\d{2})/);
                if (monthMatch) {
                    const year = monthMatch[1];
                    const month = String(monthMatch[2]).padStart(2, '0');
                    d.set_value('period_month', `${year}-${month}`);
                }
                const sizeKb = (file.size / 1024).toFixed(1);
                $card.addClass('has-file');
                d.$wrapper.find('#jz-att-upload-title').text(`已选择：${file.name} (${sizeKb} KB)`);
                d.$wrapper.find('#jz-att-upload-desc').text('点击可更换文件；确认月份后点击下方按钮开始解析入库');
            }
        });

        configure_jizhong_dialog_close_actions(d).show();
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
        schedule_active_table_height();
    });

    // 原始考勤大宽表专属整人合并单元格分组排序事件 (以员工5行合并区块为不可分割的原子整体)
    $(pageRoot).on('click', '#table-jz-raw-attendance thead th[data-sort-key]', function(e) {
        if ($(e.target).is('input, button, a, select, textarea, label')) return;
        const $th = $(this);
        const sortKey = $th.attr('data-sort-key');
        const colType = $th.attr('data-col-type');
        if (!sortKey || !attendance_cache || !attendance_cache.length) return;

        let newDir = 'asc';
        if (raw_attendance_sort.key === sortKey) {
            newDir = raw_attendance_sort.dir === 'asc' ? 'desc' : 'asc';
        }
        raw_attendance_sort = { key: sortKey, colType: colType, dir: newDir, field: $th.data('field'), day: $th.data('day') };

        // 给每个员工标记原始顺序
        attendance_cache.forEach((emp, i) => {
            if (emp._orig_idx === undefined) emp._orig_idx = i;
        });

        // 核心铁律：以员工（合并单元格整体）为最小单位进行排序，绝不拆散内部小项目！
        attendance_cache.sort((a, b) => {
            let cmp = 0;
            if (colType === 'seq') {
                cmp = (a._orig_idx || 0) - (b._orig_idx || 0);
            } else if (colType === 'field') {
                const f = raw_attendance_sort.field;
                if (f === 'employee_no') {
                    cmp = String(a.employee_no || '').localeCompare(String(b.employee_no || ''), 'zh-CN', { numeric: true });
                } else if (f === 'employee_name') {
                    cmp = String(a.employee_name || '').localeCompare(String(b.employee_name || ''), 'zh-CN');
                } else {
                    cmp = flt(a[f]) - flt(b[f]);
                }
            } else if (colType === 'day') {
                const dayNum = parseInt(raw_attendance_sort.day, 10);
                const dayA = (get_attendance_daily_records(a) || []).find(d => d.day === dayNum) || {};
                const dayB = (get_attendance_daily_records(b) || []).find(d => d.day === dayNum) || {};
                const va = flt(dayA.work_hours || 0) * 100 + flt(dayA.overtime || 0);
                const vb = flt(dayB.work_hours || 0) * 100 + flt(dayB.overtime || 0);
                cmp = va - vb;
            }
            return newDir === 'asc' ? cmp : -cmp;
        });

        render_raw_attendance_table();
    });

    // 原始打卡矩阵维度过滤
    $('#jz-raw-filter-metric .jz-segment-btn').on('click', function() {
        $('#jz-raw-filter-metric .jz-segment-btn').removeClass('active');
        $(this).addClass('active');
        raw_metric_filter = $(this).data('metric');
        render_raw_attendance_table();
    });

    let raw_attendance_sort = { key: 'seq', dir: 'none' };

    function render_raw_attendance_table() {
        const thead = $('#thead-jz-raw-attendance');
        const tbody = $('#tbody-jz-raw-attendance');
        thead.empty();
        tbody.empty();

        if (!attendance_cache || attendance_cache.length === 0) {
            tbody.html('<tr><td colspan="45" class="jz-empty-cell">当前月份尚未上传考勤表，请点击“上传月度考勤”按钮。</td></tr>');
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

        const sortIndicator = (key) => {
            if (raw_attendance_sort.key !== key) return '';
            const dir = raw_attendance_sort.dir;
            return `<span class="ashan-sort-indicator" aria-hidden="true">${dir === 'asc' ? '▲' : '▼'}</span>`;
        };
        const sortThAttrs = (key, colType, extra = '') => {
            const isCurrent = raw_attendance_sort.key === key;
            const dir = isCurrent ? raw_attendance_sort.dir : 'none';
            const sortCls = isCurrent && dir !== 'none' ? ` ashan-sort-${dir}` : '';
            return `data-sort-key="${key}" data-col-type="${colType}" data-sort-dir="${dir}" aria-sort="${dir === 'asc' ? 'ascending' : (dir === 'desc' ? 'descending' : 'none')}" class="${sortCls} ${extra}"`;
        };

        // 1. 构建表头：打卡项目后面严格采用“1日 回车 正常日 回车 1倍”的三行紧凑排版
        let thHtml = `
            <tr>
                <th ${sortThAttrs('seq', 'seq', 'jz-col-seq jz-col-sticky-1')} title="点击按序号整体排序">序号${sortIndicator('seq')}</th>
                <th ${sortThAttrs('employee_no', 'field', 'jz-col-no jz-col-sticky-2')} data-field="employee_no" title="点击按工号整体排序">工号${sortIndicator('employee_no')}</th>
                <th ${sortThAttrs('employee_name', 'field', 'jz-col-name jz-col-sticky-3')} data-field="employee_name" title="点击按姓名整体排序">姓名${sortIndicator('employee_name')}</th>
                <th class="jz-raw-col-metric jz-col-sticky-4">打卡项目</th>
        `;

        days.forEach(d => {
            let cls = 'jz-raw-day-th';
            const multiplier = flt(d.rate_multiplier || d.multiplier || 1);
            let dayText = '正常日';
            if (multiplier === 2) {
                cls += ' jz-th-weekend';
                dayText = '休息日';
            } else if (multiplier >= 3) {
                cls += ' jz-th-holiday';
                dayText = '法定节假日';
            }
            const multText = `${multiplier}倍`;
            const title = `${d.date || ''} · ${dayText} · ${multText} (点击以该日工时整体排序)`;
            const dayKey = `day_${d.day}`;
            thHtml += `
                <th ${sortThAttrs(dayKey, 'day', cls)} data-day="${d.day}" title="${esc(title)}">
                    <div class="jz-th-daynum">${esc(d.day)}日</div>
                    <div class="jz-th-tag">${esc(dayText)}</div>
                    <div class="jz-th-multiplier">${esc(multText)}</div>
                    ${sortIndicator(dayKey)}
                </th>
            `;
        });

        thHtml += `
                <th ${sortThAttrs('work_hours_regular', 'field', 'jz-text-right')} data-field="work_hours_regular" title="点击按正班工时整体排序">正班工时${sortIndicator('work_hours_regular')}</th>
                <th ${sortThAttrs('overtime_regular_1_5', 'field', 'jz-text-right')} data-field="overtime_regular_1_5" title="点击按平日加班整体排序">平日加班${sortIndicator('overtime_regular_1_5')}</th>
                <th ${sortThAttrs('overtime_weekend_2_0', 'field', 'jz-text-right')} data-field="overtime_weekend_2_0" title="点击按周末加班整体排序">周末加班${sortIndicator('overtime_weekend_2_0')}</th>
                <th ${sortThAttrs('overtime_holiday_3_0', 'field', 'jz-text-right')} data-field="overtime_holiday_3_0" title="点击按节日加班整体排序">节日加班${sortIndicator('overtime_holiday_3_0')}</th>
                <th ${sortThAttrs('leave_compensatory_hours', 'field', 'jz-text-right')} data-field="leave_compensatory_hours" title="点击按倒休工时整体排序">倒休工时${sortIndicator('leave_compensatory_hours')}</th>
                <th ${sortThAttrs('meal_count', 'field', 'jz-text-right')} data-field="meal_count" title="点击按餐补次数整体排序">餐补次数${sortIndicator('meal_count')}</th>
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
                        ${esc(m.label)}
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
                const totalBills = (bSum.bills_100 || 0) + (bSum.bills_50 || 0) + (bSum.bills_10 || 0) + (bSum.bills_5 || 0) + (bSum.bills_1 || 0);
                $('#jz-cash-sheet-meta').text(`现金实发：${items.length}人 ｜ 现金总盘：${window.AshanUI.formatMoney(bSum.total_cash || 0)} ｜ 配钞总张数：${totalBills}张`);
                update_calculated_sheet_titles(false);

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
        refresh_tax_threshold_inline_control();
        read_call(
            "ashan_cn_procurement.services.payroll_settlement_service.get_tax_settlement_full_sheet",
            { company: COMPANY, period_month: current_month },
            "#tbody-jz-tax",
            68,
            function(message) {
                render_jizhong_tax_68_table(message || {});
            },
            "正在读取本月个人所得税 68 列台账…"
        );
    }

    function render_jizhong_tax_68_table(data, theadSel, tbodySel, tfootSel, activeMonth) {
        theadSel = theadSel || '#thead-jz-tax';
        tbodySel = tbodySel || '#tbody-jz-tax';
        tfootSel = tfootSel || '#tfoot-jz-tax';
        activeMonth = activeMonth || current_month;
        const rows = data.rows || [];
        const tot = data.totals || {};
        const cols = [
            {k:"seq", l:"序号", g:"员工基本信息", t:"seq"},
            {k:"employee_no", l:"工号", g:"员工基本信息", t:"text"},
            {k:"employee_name", l:"姓名", g:"员工基本信息", t:"name"},
            {k:"id_card", l:"证件号码", g:"员工基本信息", t:"text"},
            {k:"gender", l:"性别", g:"员工基本信息", t:"text"},
            {k:"period_month_str", l:"本期所属期", g:"员工基本信息", t:"text"},
            {k:"employee_type", l:"员工类型", g:"员工基本信息", t:"text"},
            {k:"target_salary", l:"目标工资", g:"员工基本信息", t:"money"},
            {k:"salary_mode", l:"工资类型", g:"员工基本信息", t:"text"},
            {k:"gross_salary", l:"税前工资", g:"员工基本信息", t:"money"},
            {k:"thresh_cur", l:"起征点扣除", g:"员工基本信息", t:"money"},
            {k:"hf_person", l:"公积金", g:"工资扣除(本月)", t:"money"},
            {k:"ss_person", l:"社保", g:"工资扣除(本月)", t:"money"},
            {k:"deduct_cur_tot", l:"工资扣除合计", g:"工资扣除(本月)", t:"money"},
            {k:"ss_pension", l:"基本养老", g:"专项扣除(本月)", t:"money"},
            {k:"ss_med", l:"基本医疗", g:"专项扣除(本月)", t:"money"},
            {k:"ss_large_med", l:"大额医疗", g:"专项扣除(本月)", t:"money"},
            {k:"ss_unemp", l:"失业保险", g:"专项扣除(本月)", t:"money"},
            {k:"hf_spec", l:"住房公积金", g:"专项扣除(本月)", t:"money"},
            {k:"spec_tot_cur", l:"专项扣除合计", g:"专项扣除(本月)", t:"money"},
            {k:"spec_add_child", l:"子女教育", g:"专项附加扣除(本月)", t:"money"},
            {k:"spec_add_edu", l:"继续教育", g:"专项附加扣除(本月)", t:"money"},
            {k:"spec_add_med", l:"大病医疗", g:"专项附加扣除(本月)", t:"money"},
            {k:"spec_add_loan", l:"住房贷款利息", g:"专项附加扣除(本月)", t:"money"},
            {k:"spec_add_rent", l:"住房租金", g:"专项附加扣除(本月)", t:"money"},
            {k:"spec_add_elder", l:"赡养老人", g:"专项附加扣除(本月)", t:"money"},
            {k:"spec_add_baby", l:"3岁以下婴幼儿照护", g:"专项附加扣除(本月)", t:"money"},
            {k:"spec_add_tot_cur", l:"专项附加扣除合计", g:"专项附加扣除(本月)", t:"money"},
            {k:"gross_prior", l:"税前工资", g:"个税_税前工资(往期)", t:"money"},
            {k:"thresh_prior", l:"起征点扣除", g:"个税_起征点扣除(往期)", t:"money"},
            {k:"ss_pension_prior", l:"基本养老", g:"个税_专项扣除(往期)", t:"money"},
            {k:"ss_med_prior", l:"基本医疗", g:"个税_专项扣除(往期)", t:"money"},
            {k:"ss_large_med_prior", l:"大额医疗", g:"个税_专项扣除(往期)", t:"money"},
            {k:"ss_unemp_prior", l:"失业保险", g:"个税_专项扣除(往期)", t:"money"},
            {k:"hf_spec_prior", l:"住房公积金", g:"个税_专项扣除(往期)", t:"money"},
            {k:"spec_tot_prior", l:"专项扣除合计", g:"个税_专项扣除(往期)", t:"money"},
            {k:"spec_add_child_prior", l:"子女教育", g:"个税_专项附加扣除(往期)", t:"money"},
            {k:"spec_add_edu_prior", l:"继续教育", g:"个税_专项附加扣除(往期)", t:"money"},
            {k:"spec_add_med_prior", l:"大病医疗", g:"个税_专项附加扣除(往期)", t:"money"},
            {k:"spec_add_loan_prior", l:"住房贷款利息", g:"个税_专项附加扣除(往期)", t:"money"},
            {k:"spec_add_rent_prior", l:"住房租金", g:"个税_专项附加扣除(往期)", t:"money"},
            {k:"spec_add_elder_prior", l:"赡养老人", g:"个税_专项附加扣除(往期)", t:"money"},
            {k:"spec_add_baby_prior", l:"3岁以下婴幼儿照护", g:"个税_专项附加扣除(往期)", t:"money"},
            {k:"spec_add_tot_prior", l:"专项附加扣除合计", g:"个税_专项附加扣除(往期)", t:"money"},
            {k:"gross_all", l:"个税_税前工资", g:"个税_税前工资(全部)", t:"money"},
            {k:"thresh_all", l:"起征点扣除", g:"个税_起征点扣除(全部)", t:"money"},
            {k:"ss_pension_all", l:"基本养老", g:"个税_专项扣除(全部)", t:"money"},
            {k:"ss_med_all", l:"基本医疗", g:"个税_专项扣除(全部)", t:"money"},
            {k:"ss_large_med_all", l:"大额医疗", g:"个税_专项扣除(全部)", t:"money"},
            {k:"ss_unemp_all", l:"失业保险", g:"个税_专项扣除(全部)", t:"money"},
            {k:"hf_spec_all", l:"住房公积金", g:"个税_专项扣除(全部)", t:"money"},
            {k:"spec_tot_all", l:"专项扣除合计", g:"个税_专项扣除(全部)", t:"money"},
            {k:"spec_add_child_all", l:"子女教育", g:"个税_专项附加扣除(全部)", t:"money"},
            {k:"spec_add_edu_all", l:"继续教育", g:"个税_专项附加扣除(全部)", t:"money"},
            {k:"spec_add_med_all", l:"大病医疗", g:"个税_专项附加扣除(全部)", t:"money"},
            {k:"spec_add_loan_all", l:"住房贷款利息", g:"个税_专项附加扣除(全部)", t:"money"},
            {k:"spec_add_rent_all", l:"住房租金", g:"个税_专项附加扣除(全部)", t:"money"},
            {k:"spec_add_elder_all", l:"赡养老人", g:"个税_专项附加扣除(全部)", t:"money"},
            {k:"spec_add_baby_all", l:"3岁以下婴幼儿照护", g:"个税_专项附加扣除(全部)", t:"money"},
            {k:"spec_add_tot_all", l:"专项附加扣除合计", g:"个税_专项附加扣除(全部)", t:"money"},
            {k:"taxable_all", l:"应纳税所得额", g:"税款计算", t:"money"},
            {k:"tax_rate", l:"税率", g:"税款计算", t:"percent"},
            {k:"quick_deduct", l:"速算扣除数", g:"税款计算", t:"money"},
            {k:"tax_calculated", l:"应纳税额", g:"税款计算", t:"money"},
            {k:"tax_relief", l:"减免税额", g:"税款计算", t:"money"},
            {k:"tax_paid_prior", l:"已缴税额", g:"税款计算", t:"money"},
            {k:"tax_current", l:"应补/退税额", g:"税款计算", t:"money"},
            {k:"net_salary", l:"税后工资", g:"税款计算", t:"money"}
        ];

        const stickyThClass = idx => idx === 0 ? "jz-col-seq" : (idx === 1 ? "jz-col-no" : (idx === 2 ? "jz-col-name" : ""));
        const stickyTdClass = idx => idx === 0 ? "jz-col-seq" : (idx === 1 ? "jz-col-no" : (idx === 2 ? "jz-col-name" : ""));

        const row1 = `<tr class="jz-tax-group-row">
            <th colspan="3" class="jz-col-sticky-group">员工基本信息</th>
            <th colspan="8" class="jz-tax-group-th">员工基本信息与本月基数</th>
            <th colspan="3" class="jz-tax-group-th jz-grp-amber">工资扣除(本月)</th>
            <th colspan="6" class="jz-tax-group-th jz-grp-green">专项扣除(本月)</th>
            <th colspan="8" class="jz-tax-group-th jz-grp-blue">专项附加扣除(本月)</th>
            <th colspan="1" class="jz-tax-group-th jz-grp-purple">个税_税前工资(往期)</th>
            <th colspan="1" class="jz-tax-group-th jz-grp-purple">个税_起征点扣除(往期)</th>
            <th colspan="6" class="jz-tax-group-th jz-grp-purple">个税_专项扣除(往期)</th>
            <th colspan="8" class="jz-tax-group-th jz-grp-purple">个税_专项附加扣除(往期)</th>
            <th colspan="1" class="jz-tax-group-th jz-grp-orange">个税_税前工资(全部)</th>
            <th colspan="1" class="jz-tax-group-th jz-grp-orange">个税_起征点扣除(全部)</th>
            <th colspan="6" class="jz-tax-group-th jz-grp-orange">个税_专项扣除(全部)</th>
            <th colspan="8" class="jz-tax-group-th jz-grp-orange">个税_专项附加扣除(全部)</th>
            <th colspan="8" class="jz-tax-group-th jz-grp-red">税款计算</th>
        </tr>`;

        const row2 = `<tr class="jz-tax-col-row">${cols.map((c, i) => {
            const isMoney = c.t === "money" || c.t === "percent";
            const alignCls = isMoney ? "jz-text-right" : (["seq","gender","period_month_str"].includes(c.k) ? "jz-text-center" : "");
            return `<th class="${stickyThClass(i)} ${alignCls}" title="${esc(c.g)} · ${esc(c.l)}">${esc(c.l)}</th>`;
        }).join("")}</tr>`;

        $(theadSel).html(row1 + row2);

        const renderValue = (c, r) => {
            const v = r[c.k];
            if (c.t === "name") return `<strong>${esc(v || "-")}</strong>`;
            if (c.t === "money") return window.AshanUI.formatMoney(v || 0);
            if (c.t === "percent") return `${Number(v || 0).toFixed(2).replace(/\.00$/, "")}%`;
            return (v === null || v === undefined || v === "") ? "-" : esc(v);
        };

        let bodyHtml = "";
        if (!rows.length) {
            bodyHtml = `<tr><td colspan="68" class="jz-empty-cell">当前账期【${activeMonth}】暂无个税台账数据。</td></tr>`;
        } else {
            bodyHtml = rows.map((r, rowIdx) => {
                return `<tr>${cols.map((c, i) => {
                    const isMoney = c.t === "money" || c.t === "percent";
                    const moneyCls = isMoney ? "jz-money-cell" : "";
                    let extraCls = "";
                    if (c.k === "tax_current" && Number(r.tax_current || 0) > 0) extraCls = " jz-text-danger";
                    if (c.k === "net_salary") extraCls = " jz-text-success";
                    if (c.k === "taxable_all") extraCls = " jz-text-warn";
                    const alignCls = isMoney ? "" : (["seq","gender","period_month_str"].includes(c.k) ? "jz-text-center" : "");
                    const cellVal = c.k === "seq" ? (rowIdx + 1) : renderValue(c, r);
                    return `<td class="${stickyTdClass(i)} ${moneyCls}${extraCls} ${alignCls}">${cellVal}</td>`;
                }).join("")}</tr>`;
            }).join("");
        }
        $(tbodySel).html(bodyHtml);

        const totalValue = c => {
            if (c.k === "seq") return "合计";
            if (c.k === "employee_no") return `共 ${rows.length} 人`;
            if (["employee_name","id_card","gender","period_month_str","employee_type","salary_mode","tax_rate","quick_deduct"].includes(c.k)) return "-";
            if (c.t === "money") return window.AshanUI.formatMoney(tot[c.k] || 0);
            return "-";
        };
        const footHtml = `<tr>${cols.map((c, i) => {
            const isMoney = c.t === "money";
            const alignCls = isMoney ? "jz-money-cell" : (["seq","employee_no","gender","period_month_str"].includes(c.k) ? "jz-text-center" : "");
            return `<td class="${stickyTdClass(i)} ${alignCls}">${totalValue(c)}</td>`;
        }).join("")}</tr>`;
        $(tfootSel).html(footHtml);

        if (tbodySel === '#tbody-jz-tax') {
            const currentThreshold = flt(data.tax_threshold) || flt($('#jz-tax-threshold-input').val()) || 5000.0;
            const cycleStart = data.cycle_start_month || cint($('#jz-tax-cycle-start-select').val()) || 12;
            const cycleName = data.cycle_name || `${cycleStart}月起`;
            $('#jz-tax-threshold-input').val(currentThreshold.toFixed(2));
            $('#jz-tax-cycle-start-select').val(String(cycleStart));
            $('#jz-tax-sheet-meta').text(`核定计税：${rows.length}人 ｜ 计薪周期：${cycleStart}月起 (${cycleName}) ｜ 本月免征额：${window.AshanUI.formatMoney(currentThreshold)} ｜ 累计应纳税所得额：${window.AshanUI.formatMoney(tot.taxable_all || 0)} ｜ 当月代扣个税：${window.AshanUI.formatMoney(tot.tax_current || 0)}`);
            update_calculated_sheet_titles(false);
            schedule_active_table_height();
        }
    }

    // 1. 加载员工薪资信息表 (对应 Excel [人员薪资信息] sheets)
    let employees_cache = [];
    let employee_validation_errors = {};
    let employee_validation_active = false;

    function validate_jizhong_id_card(id_str) {
        if (!id_str) return { valid: false, message: "证件号码未填写" };
        const id_clean = String(id_str).trim().toUpperCase();
        if (id_clean.length === 18) {
            if (!/^\d{17}[\dX]$/.test(id_clean)) {
                return { valid: false, message: "18位身份证前17位必须全为数字" };
            }
            const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
            const checkCodes = "10X98765432";
            let sum = 0;
            for (let i = 0; i < 17; i++) {
                sum += parseInt(id_clean[i], 10) * weights[i];
            }
            const expected = checkCodes[sum % 11];
            if (id_clean[17] !== expected) {
                return { valid: false, message: `身份证校验码错误(末位应为${expected})` };
            }
            const year = parseInt(id_clean.substring(6, 10), 10);
            const month = parseInt(id_clean.substring(10, 12), 10);
            const day = parseInt(id_clean.substring(12, 14), 10);
            if (year < 1920 || year > 2026 || month < 1 || month > 12 || day < 1 || day > 31) {
                return { valid: false, message: "身份证出生日期无效" };
            }
            return {
                valid: true,
                birthDate: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
                gender: parseInt(id_clean[16], 10) % 2 === 1 ? "男" : "女"
            };
        } else if (id_clean.length === 15 && /^\d{15}$/.test(id_clean)) {
            return { valid: true };
        }
        return { valid: false, message: "身份证号码长度必须为18位或15位" };
    }

    function validate_jizhong_employee_profiles(employees) {
        const errors = {};
        const issueList = [];

        (employees || []).forEach(it => {
            const empNo = it.employee_no || "";
            const empName = it.employee_name || "未命名";
            const empErrors = {};
            const etype = it.employee_type || "正式工";
            const smode = it.salary_mode || "税前动态工资";
            const isFixedNet = is_jizhong_fixed_net_mode(smode);
            const certType = (it.certificate_type || "居民身份证").trim();

            if (!empNo) {
                empErrors.employee_no = "工号未填写";
                issueList.push(`员工 ${empName}: 工号未填写`);
            }
            if (!it.employee_name) {
                empErrors.employee_name = "员工姓名未填写";
                issueList.push(`工号 ${empNo}: 员工姓名未填写`);
            }

            if (certType === "居民身份证" || certType === "中国居民身份证") {
                const idCheck = validate_jizhong_id_card(it.id_card);
                if (!idCheck.valid) {
                    empErrors.id_card = idCheck.message;
                    issueList.push(`工号 ${empNo} (${empName}): ${idCheck.message}`);
                } else {
                    if (idCheck.birthDate && it.birth_date && it.birth_date !== idCheck.birthDate) {
                        empErrors.birth_date = `出生日期与身份证(${idCheck.birthDate})不一致`;
                        issueList.push(`工号 ${empNo} (${empName}): 出生日期与身份证不符`);
                    }
                    if (idCheck.gender && it.gender && it.gender !== idCheck.gender) {
                        empErrors.gender = `性别与身份证(${idCheck.gender})不一致`;
                        issueList.push(`工号 ${empNo} (${empName}): 性别与身份证不符`);
                    }
                }
            } else if (!it.id_card) {
                empErrors.id_card = "证件号码未填写";
                issueList.push(`工号 ${empNo} (${empName}): 证件号码未填写`);
            }

            if (!it.birth_date) {
                empErrors.birth_date = empErrors.birth_date || "出生日期未填写";
                issueList.push(`工号 ${empNo} (${empName}): 出生日期未填写`);
            }
            if (!it.gender) {
                empErrors.gender = empErrors.gender || "性别未选择";
                issueList.push(`工号 ${empNo} (${empName}): 性别未选择`);
            }

            if (isFixedNet) {
                if (flt(it.fixed_salary) <= 0) {
                    empErrors.fixed_salary = "固定工资模式未填写固定工资金额(须大于0)";
                    issueList.push(`工号 ${empNo} (${empName}): 固定工资未填写`);
                }
            } else {
                if (flt(it.base_salary) <= 0) {
                    empErrors.base_salary = "动态工资模式未填写基本工资金额(须大于0)";
                    issueList.push(`工号 ${empNo} (${empName}): 基本工资未填写`);
                }
            }

            const isExcluded = ["退休返聘人员", "其他类型员工", "临时工", "其他"].includes(etype);
            if (!isExcluded) {
                const ssMode = it.social_security_base_mode;
                const ssBase = flt(it.effective_social_security_base || it.social_security_base);
                if (ssMode === "自定义" && ssBase <= 0) {
                    empErrors.effective_social_security_base = "已选择自定义社险基数，但基资金额为0或未填写";
                    empErrors.social_security_base_mode = "已选择自定义社险基数，但基资金额为0或未填写";
                    issueList.push(`工号 ${empNo} (${empName}): 自定义社险基数为0或未填`);
                } else if (!ssMode && ssBase <= 0) {
                    empErrors.social_security_base_mode = "未选择社险申报基数方式";
                    issueList.push(`工号 ${empNo} (${empName}): 未选择社险申报基数方式`);
                }

                const hfPolicy = it.housing_fund_policy || "跟随公司规则";
                if (!["不缴纳", "固定停缴"].includes(hfPolicy)) {
                    const hfMode = it.housing_fund_base_mode;
                    const hfBase = flt(it.effective_housing_fund_base || it.housing_fund_base);
                    if (hfMode === "自定义" && hfBase <= 0) {
                        empErrors.effective_housing_fund_base = "已选择自定义公积金基数，但基资金额为0或未填写";
                        empErrors.housing_fund_base_mode = "已选择自定义公积金基数，但基资金额为0或未填写";
                        issueList.push(`工号 ${empNo} (${empName}): 自定义公积金基数为0或未填`);
                    } else if (!hfMode && hfBase <= 0) {
                        empErrors.housing_fund_base_mode = "未选择公积金申报基数方式";
                        issueList.push(`工号 ${empNo} (${empName}): 未选择公积金申报基数方式`);
                    }
                }
            }

            if (Object.keys(empErrors).length > 0) {
                errors[empNo] = empErrors;
            }
        });

        return { errors, issueList };
    }

    const EMPLOYEE_TABLE_COLSPAN = 27;

    function render_employee_money_cell(value, className = '', title = '') {
        const classes = ['jz-money-cell', className].filter(Boolean).join(' ');
        const titleAttr = title ? ` title="${esc(title)}"` : '';
        const text = value === '-' ? '-' : window.AshanUI.formatMoney(value);
        return `<td class="${classes}"${titleAttr}>${text}</td>`;
    }

    function load_employees_data() {
        read_call(
            'ashan_cn_procurement.services.jizhong_payroll_service.get_jizhong_employee_profiles',
            { company: COMPANY, period_month: current_month },
            '#tbody-jz-employees',
            EMPLOYEE_TABLE_COLSPAN,
            function(message) {
                employees_cache = message || [];
                if (employee_validation_active) {
                    const res = validate_jizhong_employee_profiles(employees_cache);
                    employee_validation_errors = res.errors;
                    employee_validation_active = res.issueList.length > 0;
                }
                render_employees_table();
            },
            '正在读取员工薪资档案…'
        );
    }

    let selected_emp_nos = new Set();

    const JZ_ADJUSTABLE_PARAMETERS = [
        // 1. 常用薪酬金额项
        { field: 'base_salary', label: '基本工资', type: 'Currency', unit: '元 / 月' },
        { field: 'performance_base', label: '绩效奖金', type: 'Currency', unit: '元 / 月' },
        { field: 'post_allowance', label: '职位津贴', type: 'Currency', unit: '元 / 月' },
        { field: 'house_rent_allowance', label: '基本补贴', type: 'Currency', unit: '元 / 月' },
        { field: 'meal_allowance', label: '餐补单价', type: 'Currency', unit: '元 / 餐' },
        { field: 'fixed_salary', label: '固定工资', type: 'Currency', unit: '元 / 月' },

        // 2. 计薪方式与用工性质
        { field: 'salary_mode', label: '计薪方式', type: 'Select', options: ['税前动态工资', '税前固定工资', '税后动态工资', '税后固定工资'], description: '计薪方式直接影响算薪引擎的倒推逻辑（动态计时 vs 1:1 VBA 净薪倒推）。' },
        { field: 'employee_type', label: '用工性质', type: 'Select', options: ['正式工', '其他-正式工', '临时工', '退休返聘人员', '其他类型员工'], description: '用工性质用于法定分类汇总与社保公积金统筹参与判定。' },
        { field: 'employment_status', label: '在职状态', type: 'Select', options: ['在职', '本月离职', '离职'], description: '在职状态影响当前账期的计薪和出勤打卡底册匹配。' },

        // 3. 社保与公积金申报基数方式与基数
        { field: 'social_security_base_mode', label: '社险申报基数方式', type: 'Select', options: ['最低缴费基数', '自定义'], description: '最低缴费基数会自动读取当月配置中的社保最低基数；自定义则固定基数金额。' },
        { field: 'custom_social_security_base', label: '自定义社险基数', type: 'Currency', unit: '元 / 月', description: '修改此项将自动将社险申报基数方式设置为“自定义”。' },
        { field: 'housing_fund_base_mode', label: '公积金方式', type: 'Select', options: ['最低基数', '固定基数', '动态基数(税前工资5%)', '不缴纳'], description: '最低基数会自动读取当月配置中的公积金最低基数；固定基数由输入金额决定；动态基数按税前工资5%核定（当前公司公积金缴费比例5%）。' },
        { field: 'custom_housing_fund_base', label: '基数', type: 'Currency', unit: '元 / 月', description: '修改此项将自动将公积金方式设置为“固定基数”。' },
        { field: 'housing_fund_policy', label: '周期', type: 'Select', options: ['季初缴纳', '正常缴纳', '不缴纳'], description: '季初缴纳按实际缴费月 1、4、7、10 月缴纳；正常缴纳每月均缴；不缴纳长期停缴。' }
    ];
    const JZ_PARAM_MAP = new Map(JZ_ADJUSTABLE_PARAMETERS.map(p => [p.field, p]));

    function update_selection_controls() {
        const count = selected_emp_nos.size;
        $('#jz-selected-count').text(count);
        const $btnAdjust = $('#btn-jz-adjust-param');
        const $btnAdd = $('#btn-jz-add-emp');

        if (count > 0) {
            $btnAdjust.removeClass('jz-hidden')
                .prop('disabled', false)
                .removeClass('disabled btn-default')
                .addClass('btn-primary jz-btn-active-selection')
                .attr('title', `点击调整已勾选的 ${count} 位员工薪酬参数`);

            // 检查已勾选员工离职状态
            const selectedEmps = employees_cache.filter(it => selected_emp_nos.has(it.employee_no));
            const allResigned = selectedEmps.length > 0 && selectedEmps.every(it => it.employment_status === '本月离职');

            if (allResigned) {
                $btnAdd
                    .text(`撤销离职标记 (${count})`)
                    .attr('title', `点击将已勾选的 ${count} 位员工恢复为【在职】状态`)
                    .removeClass('btn-primary jz-btn-blue btn-danger jz-btn-mark-resigned')
                    .addClass('btn-warning jz-btn-unmark-resigned')
                    .data('action-mode', 'unmark_resigned');
            } else {
                $btnAdd
                    .text(`标记本月离职 (${count})`)
                    .attr('title', `点击将已勾选的 ${count} 位员工标记为【本月离职】（当月发薪，次月自动减员）`)
                    .removeClass('btn-primary jz-btn-blue btn-warning jz-btn-unmark-resigned')
                    .addClass('btn-danger jz-btn-mark-resigned')
                    .data('action-mode', 'mark_resigned');
            }
        } else {
            $btnAdjust.addClass('jz-hidden')
                .prop('disabled', true)
                .addClass('disabled btn-default')
                .removeClass('btn-primary jz-btn-active-selection')
                .attr('title', '请先在表格序号左侧勾选人员');

            $btnAdd
                .text('新建员工档案')
                .attr('title', '新建吉众员工档案')
                .removeClass('btn-danger jz-btn-mark-resigned btn-warning jz-btn-unmark-resigned')
                .addClass('btn-primary jz-btn-blue')
                .data('action-mode', 'create');
        }

        const totalCheckboxes = $('#tbody-jz-employees .jz-emp-row-check').length;
        const checkedCount = $('#tbody-jz-employees .jz-emp-row-check:checked').length;
        const $checkAll = $('#jz-emp-check-all');
        $checkAll.prop('checked', totalCheckboxes > 0 && checkedCount === totalCheckboxes);
        $checkAll.prop('indeterminate', checkedCount > 0 && checkedCount < totalCheckboxes);
    }

    function open_parameter_adjust_dialog() {
        if (get_workflow_step('employees')?.is_confirmed) {
            frappe.msgprint('本账期员工薪资档案已确认并处于只读保护，请先取消确认后再修改。');
            return;
        }
        const selectedEmps = employees_cache.filter(it => selected_emp_nos.has(it.employee_no));
        if (!selectedEmps.length) {
            frappe.msgprint('请先在表格序号左侧勾选需要调整参数的人员。');
            return;
        }

        const isSingle = selectedEmps.length === 1;
        const singleEmp = isSingle ? selectedEmps[0] : null;
        const defaultParam = JZ_ADJUSTABLE_PARAMETERS[0];

        const summaryHtml = isSingle
            ? `<div class="jz-dialog-person-badge">
                 <strong>${esc(singleEmp.employee_name)}</strong>
                 <span>（工号：${esc(singleEmp.employee_no)} ｜ ${esc(singleEmp.employee_type || '正式工')} ｜ ${esc(jizhong_salary_mode_label(singleEmp.salary_mode))}）</span>
               </div>`
            : `<div class="jz-dialog-person-badge">
                 <strong>已勾选 ${selectedEmps.length} 位员工</strong>
                 <p class="jz-dialog-person-list">${esc(selectedEmps.map(e => `${e.employee_name} (${e.employee_no})`).join('、'))}</p>
                 <small class="text-muted">选择参数后将统一调整这 ${selectedEmps.length} 位员工的该项数值。</small>
               </div>`;

        const dialog = window.AshanUI.createDialog({
            title: isSingle ? `调整员工薪酬参数 · ${singleEmp.employee_name}` : `批量调整薪酬参数（已选 ${selectedEmps.length} 人）`,
            size: 'small',
            fields: [
                {
                    fieldtype: 'HTML',
                    fieldname: 'selected_summary',
                    options: summaryHtml
                },
                { fieldtype: 'Section Break', label: '选择要修改的参数项' },
                {
                    fieldtype: 'Select',
                    fieldname: 'parameter_field',
                    label: '参数项',
                    options: JZ_ADJUSTABLE_PARAMETERS.map(p => ({
                        value: p.field,
                        label: p.type === 'Currency' ? `${p.label} (${p.unit})` : `${p.label} [下拉选项]`
                    })),
                    default: defaultParam.field,
                    reqd: 1
                },
                {
                    fieldtype: 'Currency',
                    fieldname: 'parameter_value_currency',
                    label: `${defaultParam.label} (${defaultParam.unit})`,
                    reqd: 0,
                    description: isSingle ? '输入修改后的金额' : '输入统一更新的金额'
                },
                {
                    fieldtype: 'Select',
                    fieldname: 'parameter_value_select',
                    label: '选择新数值',
                    options: ['税前动态工资', '税前固定工资', '税后动态工资', '税后固定工资'],
                    reqd: 0
                },
                {
                    fieldtype: 'HTML',
                    fieldname: 'parameter_hint',
                    options: '<p class="jz-param-dialog-hint text-muted"></p>'
                }
            ],
            primary_action_label: isSingle ? '保存修改' : '确认批量更新',
            primary_action(vals) {
                const paramField = vals.parameter_field;
                const paramConfig = JZ_PARAM_MAP.get(paramField) || defaultParam;
                let newVal;
                let displayVal;

                if (paramConfig.type === 'Select') {
                    newVal = dialog.get_value('parameter_value_select');
                    if (!newVal) {
                        frappe.throw(`请选择有效的${paramConfig.label}。`);
                    }
                    displayVal = newVal;
                } else {
                    const rawVal = dialog.get_value('parameter_value_currency');
                    if (rawVal === '' || rawVal === null || rawVal === undefined) {
                        frappe.throw('请输入有效的调整金额。');
                    }
                    newVal = flt(rawVal);
                    if (newVal < 0) {
                        frappe.throw('薪酬金额不能为负数。');
                    }
                    displayVal = window.AshanUI.formatMoney(newVal);
                }

                // 准备批量/单人保存
                const $btn = dialog.get_primary_btn();
                $btn.prop('disabled', true).text('正在保存…');

                let promise = Promise.resolve();
                selectedEmps.forEach(emp => {
                    promise = promise.then(() => {
                        const merged = {
                            ...emp,
                            name: emp.name,
                            company: COMPANY,
                            period_month: current_month,
                            [paramField]: newVal
                        };
                        if (paramField === 'custom_social_security_base') {
                            merged.social_security_base_mode = '自定义';
                            merged.social_security_base = newVal;
                        } else if (paramField === 'social_security_base_mode' && newVal === '最低缴费基数') {
                            merged.custom_social_security_base = 0;
                            merged.social_security_base = 0;
                        }
                        if (paramField === 'custom_housing_fund_base') {
                            merged.housing_fund_base_mode = '自定义';
                            merged.housing_fund_base = newVal;
                        } else if (paramField === 'housing_fund_base_mode' && newVal === '最低缴费基数') {
                            merged.custom_housing_fund_base = 0;
                            merged.housing_fund_base = 0;
                        }
                        if (paramField === 'housing_fund_policy') {
                            const canonicalMap = {
                                '季度初规则': '跟随公司规则',
                                '每月正常缴纳': '固定缴纳',
                                '不缴纳': '固定停缴'
                            };
                            merged.housing_fund_policy = canonicalMap[newVal] || newVal;
                        }
                        return frappe.call({
                            method: 'ashan_cn_procurement.services.jizhong_payroll_service.save_jizhong_employee_profile',
                            type: 'POST',
                            args: { data: JSON.stringify(merged) }
                        });
                    });
                });

                promise.then(() => {
                    frappe.show_alert({
                        message: isSingle
                            ? `${singleEmp.employee_name} ${paramConfig.label}已成功修改为 ${displayVal}`
                            : `已成功将 ${selectedEmps.length} 位员工的 ${paramConfig.label} 统一调整为 ${displayVal}`,
                        indicator: 'green'
                    });
                    dialog.hide();
                    load_employees_data();
                    load_workflow_status();
                }).catch(err => {
                    $btn.prop('disabled', false).text(isSingle ? '保存修改' : '确认批量更新');
                    frappe.msgprint(err?.message || '保存失败，请重试。');
                });
            }
        });

        // 切换参数项时联动显示对应输入控件（金额输入框 vs 下拉选择框）并预填当前值
        function sync_dialog_parameter_field() {
            const paramField = dialog.get_value('parameter_field') || defaultParam.field;
            const paramConfig = JZ_PARAM_MAP.get(paramField) || defaultParam;
            const $currencyWrapper = dialog.fields_dict.parameter_value_currency.$wrapper;
            const $selectWrapper = dialog.fields_dict.parameter_value_select.$wrapper;
            const $hint = dialog.$wrapper.find('.jz-param-dialog-hint');

            $hint.text(paramConfig.description || (isSingle ? `调整该员工的 ${paramConfig.label}。` : `批量将已选 ${selectedEmps.length} 人的 ${paramConfig.label} 统一调整为新值。`));

            if (paramConfig.type === 'Select') {
                $currencyWrapper.hide();
                $selectWrapper.show();
                dialog.set_df_property('parameter_value_select', 'label', `选择${paramConfig.label}`);
                dialog.set_df_property('parameter_value_select', 'options', paramConfig.options);

                if (isSingle) {
                    let currentVal = singleEmp[paramField];
                    if (paramField === 'salary_mode') {
                        currentVal = jizhong_salary_mode_label(currentVal);
                    }
                    if (paramField === 'housing_fund_policy') {
                        currentVal = jizhong_housing_fund_policy_label(currentVal);
                    }
                    dialog.set_value('parameter_value_select', currentVal || paramConfig.options[0]);
                } else {
                    dialog.set_value('parameter_value_select', paramConfig.options[0]);
                }
            } else {
                $selectWrapper.hide();
                $currencyWrapper.show();
                dialog.set_df_property('parameter_value_currency', 'label', `${paramConfig.label} (${paramConfig.unit})`);

                if (isSingle) {
                    let currentVal = flt(singleEmp[paramField]);
                    if (paramField === 'custom_social_security_base' && !currentVal) {
                        currentVal = flt(singleEmp.effective_social_security_base || singleEmp.social_security_base);
                    }
                    if (paramField === 'custom_housing_fund_base' && !currentVal) {
                        currentVal = flt(singleEmp.effective_housing_fund_base || singleEmp.housing_fund_base);
                    }
                    dialog.set_value('parameter_value_currency', currentVal);
                } else {
                    dialog.set_value('parameter_value_currency', 0);
                }
            }
        }

        dialog.fields_dict.parameter_field.$input.on('change', sync_dialog_parameter_field);
        configure_jizhong_dialog_close_actions(dialog).show();
        sync_dialog_parameter_field();
    }

    function format_employee_age(birthDate) {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(birthDate || ''));
        if (!match) return '-';
        const [year, month, day] = match.slice(1).map(Number);
        const birth = new Date(year, month - 1, day);
        if (birth.getFullYear() !== year || birth.getMonth() !== month - 1 || birth.getDate() !== day) return '-';
        const [periodYear, periodMonth] = current_month.split('-').map(Number);
        if (!periodYear || periodMonth < 1 || periodMonth > 12) return '-';
        const beforeBirthday = periodMonth < month || (periodMonth === month && day > 1);
        const age = periodYear - year - (beforeBirthday ? 1 : 0);
        return age >= 0 ? `${age}岁` : '-';
    }

    function render_employees_table() {
        const tbody = $('#tbody-jz-employees');
        tbody.empty();
        const empStep = get_workflow_step('employees');
        const employeesConfirmed = Boolean(empStep?.is_confirmed);
        if (empStep) {
            if (employeesConfirmed) {
                $('#jz-emp-kpi-sub').html('基准底册: <span class="jz-text-success">已确认 (只读受控)</span>');
            } else if (empStep.is_ready) {
                $('#jz-emp-kpi-sub').html('基准底册: <span class="jz-text-primary">档案完整 (可确认)</span>');
            } else {
                $('#jz-emp-kpi-sub').html(`<span class="jz-text-warn" title="${esc(empStep.main || '')}">${esc(empStep.badge || '待完善')}</span>`);
            }
        }

        const totalEmps = employees_cache.length;
        const activeEmps = employees_cache.filter(e => e.employment_status !== '离职').length;
        const regEmps = employees_cache.filter(e => (e.employee_type || '').includes('正式工')).length;
        const otherEmps = employees_cache.filter(e => (e.employee_type || '').includes('其他')).length;
        const rehireEmps = employees_cache.filter(e => (e.employee_type || '').includes('返聘')).length;
        $('#jz-emp-sheet-title').text(`${format_payment_month_title(current_month)}员工档案底册`);
        $('#jz-emp-sheet-meta').text(`在册人数：${totalEmps} 在职人数：${activeEmps}（其中：正式工${regEmps}，其他员工${otherEmps}，返聘工${rehireEmps}）`);

        const searchKw = ($('#jz-emp-search').val() || '').trim().toLowerCase();
        const typeFilter = $('#jz-emp-type-filter .jz-segment-btn.active').data('type') || 'all';

        let filtered = employees_cache.filter(it => {
            if (searchKw) {
                const matchKw = (it.employee_no || '').toLowerCase().includes(searchKw) ||
                                (it.employee_name || '').toLowerCase().includes(searchKw) ||
                                (it.id_card || '').toLowerCase().includes(searchKw) ||
                                jizhong_salary_mode_label(it.salary_mode).toLowerCase().includes(searchKw);
                if (!matchKw) return false;
            }
            if (typeFilter === 'regular') return employee_category(it.employee_type, it.employment_status) === '正式工';
            if (typeFilter === 'other') return employee_category(it.employee_type, it.employment_status) !== '正式工';
            return true;
        });

        if (filtered.length === 0) {
            tbody.html(`<tr><td colspan="${EMPLOYEE_TABLE_COLSPAN}" class="jz-empty-cell">暂无符合条件的员工薪资档案</td></tr>`);
            $('#tfoot-jz-employees').empty();
            $('#jz-emp-kpi-count').text('0 人');
            $('#jz-emp-kpi-base').text(window.AshanUI.formatMoney(0));
            $('#jz-emp-kpi-allowance').text(window.AshanUI.formatMoney(0));
            $('#jz-emp-kpi-post').text(window.AshanUI.formatMoney(0));
            $('#jz-emp-kpi-perf').text(window.AshanUI.formatMoney(0));
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
            const socialSecurityMode = it.social_security_base_mode || ssBaseMode;
            const housingFundMode = it.housing_fund_base_mode || hfBaseMode;
            const housingFundPolicy = jizhong_housing_fund_policy_label(it.housing_fund_policy);
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

            const isFixedNet = is_jizhong_fixed_net_mode(it.salary_mode) || String(it.salary_mode || '').includes('固定') || flt(it.fixed_salary) > 0;
            const category = employee_category(it.employee_type, it.employment_status);
            const netAgreed = isFixedNet ? window.AshanUI.formatMoney(it.fixed_salary) : '-';
            const employmentStatus = String(it.employment_status || '在职').trim();
            let statusClass = 'jz-status-active';
            if (employmentStatus === '本月离职') {
                statusClass = 'jz-status-resigned';
            } else if (employmentStatus === '离职') {
                statusClass = 'jz-status-inactive';
            }
            const isChecked = selected_emp_nos.has(it.employee_no);

            const empErrors = (employee_validation_errors && employee_validation_errors[it.employee_no]) || {};
            const isRowInvalid = Object.keys(empErrors).length > 0;
            const errIdCard = empErrors.id_card;
            const errGender = empErrors.gender;
            const errBirth = empErrors.birth_date;
            const errFixedSal = empErrors.fixed_salary;
            const errBaseSal = empErrors.base_salary;
            const errSsBase = empErrors.effective_social_security_base;
            const errSsMode = empErrors.social_security_base_mode;
            const errHfBase = empErrors.effective_housing_fund_base;
            const errHfMode = empErrors.housing_fund_base_mode;

            tbody.append(`
                <tr class="jz-emp-row jz-row-clickable${isChecked ? ' jz-row-selected' : ''}${isRowInvalid ? ' jz-row-invalid' : ''}" data-name="${esc(it.name)}" data-empno="${esc(it.employee_no)}">
                    <td class="jz-col-check jz-col-sticky-check">
                        <input type="checkbox" class="jz-emp-row-check jz-checkbox" data-empno="${esc(it.employee_no)}" aria-label="选择员工 ${esc(it.employee_name)}"${isChecked ? ' checked' : ''}>
                    </td>
                    <td class="jz-col-seq jz-col-sticky-1">${idx + 1}</td>
                    <td class="jz-col-no jz-col-sticky-2${empErrors.employee_no ? ' jz-cell-invalid' : ''}" title="${esc(empErrors.employee_no || it.employee_no)}"><strong>${esc(it.employee_no)}</strong></td>
                    <td class="jz-col-name jz-col-sticky-3${empErrors.employee_name ? ' jz-cell-invalid' : ''}" title="${esc(empErrors.employee_name || it.employee_name)}"><strong>${esc(it.employee_name)}</strong></td>
                    <td class="jz-font-mono jz-employee-id-cell${errIdCard ? ' jz-cell-invalid' : ''}" title="${esc(errIdCard || it.id_card || '-')}">${esc(it.id_card || '-')}</td>
                    <td class="jz-employee-age-cell">${esc(format_employee_age(it.birth_date))}</td>
                    <td class="jz-employee-gender-cell${errGender ? ' jz-cell-invalid' : ''}" title="${esc(errGender || it.gender || '-')}">${esc(it.gender || '-')}</td>
                    <td class="jz-employee-certificate-cell">${esc(it.certificate_type || '居民身份证')}</td>
                    <td class="jz-text-center${errBirth ? ' jz-cell-invalid' : ''}" title="${esc(errBirth || it.birth_date || '-')}">${esc(it.birth_date || '-')}</td>
                    <td class="jz-employee-text" title="${esc(it.department || '')}">${esc(it.department || '-')}</td>
                    <td class="jz-employee-text" title="${esc(it.job_title || '')}">${esc(it.job_title || '-')}</td>
                    <td class="jz-employee-type-cell">${esc(category)}</td>
                    <td>${esc(jizhong_salary_mode_label(it.salary_mode))}</td>
                    <td class="jz-money-cell ${isFixedNet ? 'jz-money-bold jz-text-primary' : ''}${errFixedSal ? ' jz-cell-invalid' : ''}" title="${esc(errFixedSal || '')}">${netAgreed}</td>
                    <td class="jz-money-cell jz-text-info${errBaseSal ? ' jz-cell-invalid' : ''}" title="${esc(errBaseSal || '')}">${window.AshanUI.formatMoney(bSal)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(bSub)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(perf)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(post)}</td>
                    <td class="jz-money-cell">${meal > 0 ? window.AshanUI.formatMoney(meal) + ' / 份' : '-'}</td>
                    <td class="jz-emp-col-ss-mode${errSsMode ? ' jz-cell-invalid' : ''}" title="${esc(errSsMode || format_social_insurance_mode_label(it))}"><span class="jz-ins-mode-tag jz-ins-mode-${get_insurance_mode_color_suffix(format_social_insurance_mode_label(it))}">${esc(format_social_insurance_mode_label(it))}</span></td>
                    ${render_employee_money_cell(format_social_insurance_mode_label(it) === '不参保' ? '-' : ssBase, `jz-ins-val-${get_insurance_mode_color_suffix(format_social_insurance_mode_label(it))}${errSsBase ? ' jz-cell-invalid' : ''}`, errSsBase || `社保基数：${format_social_insurance_mode_label(it)}`)}
                    <td class="jz-emp-col-hf-mode${errHfMode ? ' jz-cell-invalid' : ''}" title="${esc(errHfMode || format_housing_fund_base_mode_label(it))}"><span class="jz-ins-mode-tag jz-ins-mode-${get_insurance_mode_color_suffix(format_housing_fund_base_mode_label(it))}">${esc(format_housing_fund_base_mode_label(it))}</span></td>
                    ${render_employee_money_cell(format_housing_fund_base_mode_label(it) === '不缴纳' ? '-' : hfBase, `jz-ins-val-${get_insurance_mode_color_suffix(format_housing_fund_base_mode_label(it))}${errHfBase ? ' jz-cell-invalid' : ''}`, errHfBase || `公积金基数：${format_housing_fund_base_mode_label(it)}`)}
                    <td class="jz-emp-col-hf-cycle jz-text-center" title="公积金周期：${esc(format_housing_fund_cycle_label(it))}"><span class="ashan-cycle-tag ashan-cycle-${get_housing_fund_cycle_class(format_housing_fund_cycle_label(it))}">${esc(format_housing_fund_cycle_label(it))}</span></td>
                    <td class="jz-money-cell jz-text-warn">${dedTotal > 0 ? window.AshanUI.formatMoney(dedTotal) : '-'}</td>
                    <td class="jz-text-center"><span class="jz-status-badge ${statusClass}">${esc(employmentStatus)}</span></td>
                    <td class="jz-col-action"><button type="button" class="jz-btn-action jz-btn-edit-emp" data-empno="${esc(it.employee_no)}"${employeesConfirmed ? ' disabled title="本账期员工薪资档案已确认，请先取消确认后修改"' : ''}>${employeesConfirmed ? '已确认只读' : '编辑档案'}</button></td>
                </tr>
            `);
        });

        // 前提 1：只要没确认当前员工信息，则员工信息均可修改。修改有两种方式：1. 点击员工行 2. 点击最右侧操作
        // 方式 2：点击最右侧操作列按钮，打开全量编辑修改
        tbody.find('.jz-btn-edit-emp').on('click', function(e) {
            e.stopPropagation();
            if (employeesConfirmed) {
                frappe.msgprint('本账期员工薪资档案已确认并处于只读保护，如需修改请先取消确认。');
                return;
            }
            const empNo = $(this).data('empno');
            const emp = employees_cache.find(it => it.employee_no === empNo);
            if (emp) open_jizhong_employee_edit_dialog(emp, false);
        });

        // 方式 1：点击员工行交互
        // - 多选的时候（selected_emp_nos.size > 0），点击某一行不是编辑，而是选择/取消选择！
        // - 未多选时（selected_emp_nos.size === 0），点击某一行直接弹出修改界面！
        tbody.find('.jz-emp-row').on('click', function(e) {
            // 点击操作列按钮始终由 action 按钮事件处理
            if ($(e.target).closest('.jz-col-action, .jz-btn-edit-emp').length) return;
            // 复选框本身由 change 事件独立处理
            if ($(e.target).is('input[type="checkbox"]')) return;

            const empNo = $(this).data('empno');
            const $chk = $(this).find('.jz-emp-row-check');

            // 如果当前已处于多选模式（已有选定人员），或者点击的是序号左侧勾选列：执行选择/取消选择
            if (selected_emp_nos.size > 0 || $(e.target).closest('.jz-col-check').length) {
                if ($chk.length) {
                    $chk.prop('checked', !$chk.prop('checked')).trigger('change');
                }
                return;
            }

            // 未处于多选状态的普通模式下：点击整行弹出修改界面
            if (employeesConfirmed) {
                frappe.msgprint('本账期员工薪资档案已确认并处于只读保护，如需修改请先取消确认。');
                return;
            }
            const emp = employees_cache.find(it => it.employee_no === empNo);
            if (emp) open_jizhong_employee_edit_dialog(emp, false);
        });

        tbody.find('.jz-emp-row-check').on('change', function(e) {
            e.stopPropagation();
            const empNo = $(this).data('empno');
            const isChecked = $(this).prop('checked');
            if (isChecked) selected_emp_nos.add(empNo);
            else selected_emp_nos.delete(empNo);
            $(this).closest('.jz-emp-row').toggleClass('jz-row-selected', isChecked);
            update_selection_controls();
        });

        // 汇总卡片更新
        $('#jz-emp-kpi-count').text(`${filtered.length} 人`);
        $('#jz-emp-kpi-base').text(window.AshanUI.formatMoney(tot_base));
        $('#jz-emp-kpi-allowance').text(window.AshanUI.formatMoney(tot_sub + tot_perf + tot_post));
        $('#jz-emp-kpi-post').text(window.AshanUI.formatMoney(tot_post));
        $('#jz-emp-kpi-perf').text(window.AshanUI.formatMoney(tot_perf));
        $('#jz-emp-kpi-ss').text(window.AshanUI.formatMoney(tot_ss));
        $('#jz-emp-kpi-hf').text(window.AshanUI.formatMoney(tot_hf));

        // 底部合计行
        $('#tfoot-jz-employees').html(`
            <tr>
                <td colspan="4" class="jz-col-foot-label">合计 (${filtered.length}人)</td>
                <td>-</td>
                <td>-</td>
                <td>-</td>
                <td>-</td>
                <td>-</td>
                <td>-</td>

                <td>-</td>
                <td>-</td>
                <td>-</td>
                <td>-</td>
                <td class="jz-money-cell jz-text-info">${window.AshanUI.formatMoney(tot_base)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_sub)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_perf)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_post)}</td>
                <td>-</td>
                <td class="jz-emp-col-ss-mode">-</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_ss)}</td>
                <td class="jz-emp-col-hf-mode">-</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_hf)}</td>
                <td class="jz-emp-col-hf-cycle jz-text-center">-</td>
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
                { fieldtype: 'Select', fieldname: 'employee_type', label: '用工性质', options: ['正式工','其他-正式工','临时工','退休返聘人员','其他类型员工'], default: emp_data.employee_type || '正式工' },
                { fieldtype: 'Select', fieldname: 'employment_status', label: '在职状态', options: ['在职','本月离职','离职'], default: emp_data.employment_status || '在职' },

                { fieldtype: 'Section Break', label: '薪酬长期要素' },
                { fieldtype: 'Select', fieldname: 'salary_mode', label: '计薪方式', options: ['税前动态工资', '税前固定工资', '税后动态工资', '税后固定工资'], default: jizhong_salary_mode_label(emp_data.salary_mode) || '税前动态工资' },
                { fieldtype: 'Currency', fieldname: 'fixed_salary', label: '固定工资', default: emp_data.fixed_salary || 0, description: '固定工资金额（根据计薪方式可为税前固定工资或税后固定工资；固定工资人员可以没有考勤）' },
                { fieldtype: 'Currency', fieldname: 'base_salary', label: '基本工资 (元)', default: emp_data.base_salary || 0, reqd: 1 },
                { fieldtype: 'Column Break' },
                { fieldtype: 'Currency', fieldname: 'house_rent_allowance', label: '基本补贴 (元)', default: emp_data.house_rent_allowance || 0 },
                { fieldtype: 'Currency', fieldname: 'performance_base', label: '绩效奖金 (元)', default: emp_data.performance_base || 0 },
                { fieldtype: 'Currency', fieldname: 'post_allowance', label: '职位津贴 (元)', default: emp_data.post_allowance || 0 },
                { fieldtype: 'Currency', fieldname: 'meal_allowance', label: '餐补单价 (元/餐)', default: emp_data.meal_allowance || 15.0 },

                { fieldtype: 'Section Break', label: '社会保险方式与基数' },
                { fieldtype: 'Select', fieldname: 'social_security_base_mode', label: '社保方式', options: ['最低基数','固定基数','动态基数(税前工资20%)','不参保'], default: format_social_insurance_mode_label(emp_data), reqd: 1, description: '最低基数联动年度政策；固定基数由输入金额决定；动态基数按税前工资5%核定（当前公司公积金缴费比例5%）。' },
                { fieldtype: 'Currency', fieldname: 'custom_social_security_base', label: '固定社保基数 (元)', default: emp_data.custom_social_security_base || emp_data.social_security_base || 0, depends_on: 'eval:doc.social_security_base_mode=="固定基数"' },

                { fieldtype: 'Section Break', label: '住房公积金方式与基数' },
                { fieldtype: 'Select', fieldname: 'housing_fund_base_mode', label: '公积金方式', options: ['最低基数','固定基数','动态基数(税前工资5%)','不缴纳'], default: format_housing_fund_base_mode_label(emp_data), reqd: 1, description: '最低基数联动年度政策；固定基数由输入的基数决定；动态基数按税前工资5%核定（当前公司公积金缴费比例5%）。' },
                { fieldtype: 'Currency', fieldname: 'custom_housing_fund_base', label: '基数', default: emp_data.custom_housing_fund_base || emp_data.housing_fund_base || 0, depends_on: 'eval:doc.housing_fund_base_mode=="固定基数"', description: '当公积金方式为固定基数时生效。' },
                { fieldtype: 'Select', fieldname: 'housing_fund_policy', label: '周期', options: ['季初缴纳','正常缴纳','不缴纳'], default: format_housing_fund_cycle_label(emp_data), reqd: 1, description: '季初缴纳按实际缴费月 1、4、7、10 月核定；正常缴纳每月均缴；不缴纳停缴。' },

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
                const hfMode = vals.housing_fund_base_mode || format_housing_fund_base_mode_label(emp_data);
                const hfCycle = vals.housing_fund_policy || format_housing_fund_cycle_label(emp_data);
                vals.housing_fund_base_mode = hfMode;
                if (hfMode === '固定基数') {
                    vals.custom_housing_fund_base = flt(vals.custom_housing_fund_base);
                    vals.housing_fund_base = vals.custom_housing_fund_base;
                } else if (hfMode === '不缴纳' || hfCycle === '不缴纳') {
                    vals.housing_fund_base_mode = '不缴纳';
                    vals.housing_fund_policy = '固定停缴';
                    vals.custom_housing_fund_base = 0;
                    vals.housing_fund_base = 0;
                } else {
                    vals.custom_housing_fund_base = 0;
                    vals.housing_fund_base = 0;
                }
                if (vals.housing_fund_base_mode !== '不缴纳') {
                    vals.housing_fund_policy = (hfCycle === '正常缴纳' || hfCycle === '每月正常缴纳' || hfCycle === '固定缴纳') ? '固定缴纳' : '跟随公司规则';
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

        configure_jizhong_dialog_close_actions(d).show();

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

    // 表头全选勾选框事件绑定
    $('#jz-emp-check-all').on('change', function() {
        const isChecked = $(this).prop('checked');
        $('#tbody-jz-employees .jz-emp-row-check').each(function() {
            const empNo = $(this).data('empno');
            $(this).prop('checked', isChecked);
            if (isChecked) selected_emp_nos.add(empNo);
            else selected_emp_nos.delete(empNo);
            $(this).closest('.jz-emp-row').toggleClass('jz-row-selected', isChecked);
        });
        update_selection_controls();
    });

    // 调整薪酬参数按钮点击
    $('#btn-jz-adjust-param').on('click', function() {
        open_parameter_adjust_dialog();
    });

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
        let csv = '\uFEFF序号,工号,姓名,身份证号,用工性质,计薪方式,固定工资,基本工资,基本补贴,绩效奖金,职位津贴,餐补单价,社险基数,公积金基数,专项附加扣除,在职状态\n';
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
            const isFixedNet = is_jizhong_fixed_net_mode(it.salary_mode) || String(it.salary_mode || '').includes('固定') || flt(it.fixed_salary) > 0;
            const netAgreed = isFixedNet ? flt(it.fixed_salary).toFixed(2) : '-';

            csv += `${idx + 1},${it.employee_no},"${it.employee_name}","${it.id_card || ''}",${it.employee_type || '正式工'},${jizhong_salary_mode_label(it.salary_mode)},${netAgreed},${bSal.toFixed(2)},${bSub.toFixed(2)},${perf.toFixed(2)},${post.toFixed(2)},${meal > 0 ? meal.toFixed(2) : '-'},${ssBase.toFixed(2)},${hfBase.toFixed(2)},${dedTotal.toFixed(2)},${it.employment_status || '在职'}\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.setAttribute('download', `吉众员工薪资信息底册_${frappe.datetime.now_date()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });

    // 新建员工薪酬档案 / 动态变身为【标记本月离职】 / 【撤销离职】
    $('#btn-jz-add-emp').on('click', function() {
        const mode = $(this).data('action-mode') || 'create';
        if (mode === 'create') {
            open_jizhong_employee_edit_dialog({}, true);
            return;
        }

        const count = selected_emp_nos.size;
        const empNos = Array.from(selected_emp_nos);
        if (!count || !empNos.length) return;

        if (mode === 'mark_resigned') {
            frappe.confirm(
                `确定要将已勾选的 ${count} 位员工标记为【本月离职】吗？\n当月仍正常计薪，次月重置时将自动转为已离职并停止计薪。`,
                function() {
                    run_write_action($('#btn-jz-add-emp'), {
                        method: 'ashan_cn_procurement.services.jizhong_payroll_service.mark_jizhong_employees_resigned',
                        args: {
                            company: COMPANY,
                            employee_nos: JSON.stringify(empNos),
                            period_month: current_month
                        },
                        busyText: '正在标记…',
                        success: function(r) {
                            frappe.show_alert({ message: r.message || '已成功标记为本月离职', indicator: 'green' });
                            selected_emp_nos.clear();
                            load_employees_data();
                            load_workflow_status();
                        },
                        error: function(err) {
                            frappe.msgprint({ title: '标记离职失败', message: err, indicator: 'red' });
                        }
                    });
                }
            );
        } else if (mode === 'unmark_resigned') {
            frappe.confirm(
                `确定要将已勾选的 ${count} 位员工恢复为【在职】状态吗？`,
                function() {
                    run_write_action($('#btn-jz-add-emp'), {
                        method: 'ashan_cn_procurement.services.jizhong_payroll_service.cancel_jizhong_employee_resignation',
                        args: {
                            company: COMPANY,
                            employee_nos: JSON.stringify(empNos),
                            period_month: current_month
                        },
                        busyText: '正在恢复…',
                        success: function(r) {
                            frappe.show_alert({ message: r.message || '已成功恢复为在职', indicator: 'green' });
                            selected_emp_nos.clear();
                            load_employees_data();
                            load_workflow_status();
                        },
                        error: function(err) {
                            frappe.msgprint({ title: '恢复在职失败', message: err, indicator: 'red' });
                        }
                    });
                }
            );
        }
    });

    // 重置本月按钮
    $('#btn-jz-reset-month').on('click', function() {
        const $btn = $(this);
        if ($btn.prop('disabled')) return;

        frappe.confirm(
            `确定要重置【${current_month}】的数据吗？\n将彻底清空本月已上传的考勤工时与附件，重置测算与前置确认进度（0/6）。如存在上月数据将读取上月基准人员名单，如无上月数据可选择生成空表。`,
            function() {
                do_reset_month(false);
            }
        );

        function do_reset_month(force_empty) {
            run_write_action($btn, {
                method: 'ashan_cn_procurement.services.jizhong_payroll_service.reset_jizhong_month',
                args: {
                    company: COMPANY,
                    period_month: current_month,
                    force_empty: force_empty ? 1 : 0
                },
                busyText: '正在重置…',
                success: function(r) {
                    if (r.has_prev_data === false && !force_empty) {
                        frappe.confirm(
                            r.message || '未检测到上月数据，是否生成空表？',
                            function() {
                                do_reset_month(true);
                            }
                        );
                        return;
                    }
                    frappe.show_alert({ message: r.message || '重置成功', indicator: 'green' });
                    refresh_current_view();
                },
                error: function(err) {
                    frappe.msgprint({ title: '重置失败', message: err, indicator: 'red' });
                }
            });
        }
    });

    // 7. 历史数据台账与穿透中心 (全要素 68 列个税、五险一金、综合工资人员记录与核心简表)
    let history_items_cache = [];
    let history_periods_cache = [];
    let current_history_view = 'tax_68';
    let current_history_month = 'ALL';
    let current_history_emp = 'ALL';

    function load_history_data() {
        fetch_history_dataset();
    }

    function fetch_history_dataset() {
        read_call(
            'ashan_cn_procurement.services.jizhong_payroll_service.get_jizhong_history_records',
            { company: COMPANY, period_month: current_history_month, current_period: current_month },
            '#box-jz-history',
            14,
            function(message) {
                const result = message || {};
                const items = Array.isArray(result) ? result : (result.items || []);
                const periods = result.periods || [...new Set(items.map(it => it.period_month).filter(Boolean))];
                const kpi = result.kpi || {};

                history_items_cache = items;
                history_periods_cache = periods;

                // 更新账期下拉选项 (保持当前选中)
                const $monthSelect = $('#jz-history-month-filter');
                const prevSelectedMonth = current_history_month;
                $monthSelect.empty();
                $monthSelect.append($('<option>', { value: 'ALL', text: '全部账期 (含历史与本月)' }));
                $monthSelect.append($('<option>', { value: 'CURRENT', text: `本月当前数据 (${current_month} · 全部人员)` }));
                periods.forEach(p => {
                    if (p !== current_month) {
                        $monthSelect.append($('<option>', { value: p, text: `${p} 已封账归档` }));
                    }
                });
                if ([...$monthSelect[0].options].some(o => o.value === prevSelectedMonth)) {
                    $monthSelect.val(prevSelectedMonth);
                } else {
                    $monthSelect.val('ALL');
                    current_history_month = 'ALL';
                }

                // 更新人员筛选下拉选项
                const $empSelect = $('#jz-history-emp-filter');
                const prevSelectedEmp = current_history_emp;
                $empSelect.empty();
                $empSelect.append($('<option>', { value: 'ALL', text: '全部在册人员' }));
                const empMap = new Map();
                items.forEach(it => {
                    if (it.employee_no && !empMap.has(it.employee_no)) {
                        empMap.set(it.employee_no, it.employee_name || it.employee_no);
                    }
                });
                [...empMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([eno, ename]) => {
                    $empSelect.append($('<option>', { value: eno, text: `${eno} ${ename}` }));
                });
                if ([...$empSelect[0].options].some(o => o.value === prevSelectedEmp)) {
                    $empSelect.val(prevSelectedEmp);
                } else {
                    $empSelect.val('ALL');
                    current_history_emp = 'ALL';
                }

                // 更新顶部 KPI 卡片
                update_history_kpi_cards(kpi, items);

                // 根据当前视图渲染表格
                render_active_history_view();
            },
            '正在读取历史薪酬与本月台账…'
        );
    }

    function update_history_kpi_cards(kpi, items) {
        const filtered = get_filtered_history_items();
        const recCount = filtered.length;
        const pCount = new Set(filtered.map(it => it.period_month).filter(Boolean)).size;
        const curCount = filtered.filter(it => it.period_month === current_month).length;

        const totGross = filtered.reduce((acc, it) => acc + flt(it.gross_salary), 0);
        const totNet = filtered.reduce((acc, it) => acc + flt(it.net_salary), 0);
        const totTax = filtered.reduce((acc, it) => acc + flt(it.tax_amount), 0);
        const totSsPers = filtered.reduce((acc, it) => acc + flt(it.ss_person_total), 0);
        const totHfPers = filtered.reduce((acc, it) => acc + flt(it.hf_person_total), 0);
        const totComp = filtered.reduce((acc, it) => acc + flt(it.company_cost_total), 0);

        $('#jz-hist-kpi-records').text(`${recCount} 条`);
        $('#jz-hist-kpi-period-sub').text(`涵盖 ${pCount} 个账期 ｜ 本月在册 ${curCount} 人`);
        $('#jz-hist-kpi-gross').text(window.AshanUI.formatMoney(totGross));
        $('#jz-hist-kpi-insurance').text(window.AshanUI.formatMoney(totSsPers + totHfPers));
        $('#jz-hist-kpi-ss').text(window.AshanUI.formatMoney(totSsPers));
        $('#jz-hist-kpi-hf').text(window.AshanUI.formatMoney(totHfPers));
        $('#jz-hist-kpi-net').text(window.AshanUI.formatMoney(totNet));
        $('#jz-hist-kpi-tax').text(window.AshanUI.formatMoney(totTax));
        $('#jz-hist-kpi-comp').text(window.AshanUI.formatMoney(totComp));
    }

    function get_filtered_history_items() {
        let list = history_items_cache;
        if (current_history_emp !== 'ALL') {
            list = list.filter(it => it.employee_no === current_history_emp);
        }
        return list;
    }

    function render_active_history_view() {
        const items = get_filtered_history_items();
        const $box = $('#box-jz-history');
        $box.empty();

        if (current_history_view === 'tax_68') {
            render_history_tax_68_view(items);
        } else if (current_history_view === 'insurance_fund') {
            render_history_insurance_view(items);
        } else if (current_history_view === 'comprehensive') {
            render_history_comprehensive_view(items);
        } else {
            render_history_summary_view(items);
        }
        schedule_active_table_height();
    }

    function render_history_tax_68_view(items) {
        const targetMonth = (current_history_month === 'ALL' || current_history_month === 'CURRENT')
            ? current_month
            : current_history_month;

        read_call(
            'ashan_cn_procurement.services.payroll_settlement_service.get_tax_settlement_full_sheet',
            { company: COMPANY, period_month: targetMonth },
            '#box-jz-history',
            68,
            function(data) {
                let rows = data.rows || [];
                if (current_history_emp !== 'ALL') {
                    rows = rows.filter(r => r.employee_no === current_history_emp);
                }
                const filteredData = Object.assign({}, data, { rows: rows });

                const tableHtml = `
                    <table class="jz-table jz-tax-68-table" id="table-jz-hist-tax">
                        <thead id="thead-jz-hist-tax"></thead>
                        <tbody id="tbody-jz-hist-tax"></tbody>
                        <tfoot id="tfoot-jz-hist-tax"></tfoot>
                    </table>
                `;
                $('#box-jz-history').html(tableHtml);
                render_jizhong_tax_68_table(filteredData, '#thead-jz-hist-tax', '#tbody-jz-hist-tax', '#tfoot-jz-hist-tax', targetMonth);
                window.AshanUI.enableMousewheelHorizontalScroll($('#table-jz-hist-tax')[0], $('#box-jz-history')[0]);
            },
            `正在生成【${targetMonth}】个人所得税 68 列全要素台账…`
        );
    }

    function render_history_insurance_view(items) {
        const tableHtml = `
            <table class="jz-table jz-hist-table-ins" id="table-jz-hist-ins">
                <thead>
                    <tr>
                        <th class="jz-col-seq">序号</th>
                        <th class="jz-col-no jz-text-center">账期</th>
                        <th class="jz-col-no jz-text-center">工号</th>
                        <th class="jz-col-name">姓名</th>
                        <th>用工性质</th>
                        <th>计薪方式</th>
                        <th class="jz-text-right">社保基数</th>
                        <th class="jz-text-right">养老个人(8%)</th>
                        <th class="jz-text-right">医疗个人(2%)</th>
                        <th class="jz-text-right">大额医疗(个人)</th>
                        <th class="jz-text-right">失业个人(0.5%)</th>
                        <th class="jz-text-right">个人社保合计</th>
                        <th class="jz-text-right">养老单位(16%)</th>
                        <th class="jz-text-right">医疗单位(8%)</th>
                        <th class="jz-text-right">失业单位(0.5%)</th>
                        <th class="jz-text-right">工伤单位(0.16%)</th>
                        <th class="jz-text-right">单位社保统筹</th>
                        <th class="jz-text-right">公积金基数</th>
                        <th class="jz-text-right">个人公积金</th>
                        <th class="jz-text-right">单位公积金</th>
                        <th>公积金政策</th>
                        <th class="jz-text-right jz-col-sticky-foot">单位统筹总成本</th>
                    </tr>
                </thead>
                <tbody id="tbody-jz-hist-ins"></tbody>
                <tfoot id="tfoot-jz-hist-ins"></tfoot>
            </table>
        `;
        $('#box-jz-history').html(tableHtml);

        const tbody = $('#tbody-jz-hist-ins');
        if (!items.length) {
            tbody.html('<tr><td colspan="22" class="jz-empty-cell">当前筛选条件下暂无五险一金明细记录。</td></tr>');
            $('#tfoot-jz-hist-ins').empty();
            return;
        }

        let totSsBase = 0, totPensionP = 0, totMedP = 0, totLargeMedP = 0, totUnempP = 0, totSsP = 0;
        let totPensionC = 0, totMedC = 0, totUnempC = 0, totInjuryC = 0, totSsC = 0;
        let totHfBase = 0, totHfP = 0, totHfC = 0, totCompCost = 0;

        const bodyHtml = items.map((it, idx) => {
            const pMonth = it.period_month || (it.parent ? it.parent.replace(`${COMPANY}-`, '') : '');
            const ssBase = flt(it.ss_base);
            const pensionP = flt(it.pension_person);
            const medP = flt(it.medical_person);
            const largeMedP = flt(it.large_medical_person);
            const unempP = flt(it.unemployment_person);
            const ssP = flt(it.ss_person_total);
            const pensionC = flt(it.pension_company);
            const medC = flt(it.medical_company);
            const unempC = flt(it.unemployment_company);
            const injuryC = flt(it.work_injury_company);
            const ssC = flt(it.ss_company_total);
            const hfBase = flt(it.hf_base);
            const hfP = flt(it.hf_person_total);
            const hfC = flt(it.hf_company_total);
            const compCost = flt(it.company_cost_total);

            totSsBase += ssBase; totPensionP += pensionP; totMedP += medP; totLargeMedP += largeMedP; totUnempP += unempP; totSsP += ssP;
            totPensionC += pensionC; totMedC += medC; totUnempC += unempC; totInjuryC += injuryC; totSsC += ssC;
            totHfBase += hfBase; totHfP += hfP; totHfC += hfC; totCompCost += compCost;

            const isCurrent = (pMonth === current_month);
            const periodTag = isCurrent ? `<strong>${esc(pMonth)} (本月)</strong>` : esc(pMonth);

            return `
                <tr>
                    <td class="jz-col-seq">${idx + 1}</td>
                    <td class="jz-col-no jz-text-center">${periodTag}</td>
                    <td class="jz-col-no jz-text-center"><strong>${esc(it.employee_no)}</strong></td>
                    <td class="jz-col-name"><strong>${esc(it.employee_name)}</strong></td>
                    <td>${esc(it.employee_type || '正式工')}</td>
                    <td>${esc(jizhong_salary_mode_label(it.salary_mode))}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(ssBase)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(pensionP)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(medP)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(largeMedP)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(unempP)}</td>
                    <td class="jz-money-cell jz-money-bold">${window.AshanUI.formatMoney(ssP)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(pensionC)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(medC)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(unempC)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(injuryC)}</td>
                    <td class="jz-money-cell jz-money-bold">${window.AshanUI.formatMoney(ssC)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(hfBase)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(hfP)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(hfC)}</td>
                    <td>${esc(it.housing_fund_policy || (hfP > 0 ? '按月正常缴纳' : '免缴/停缴'))}</td>
                    <td class="jz-money-cell jz-money-primary jz-col-sticky-foot">${window.AshanUI.formatMoney(compCost)}</td>
                </tr>
            `;
        }).join('');
        tbody.html(bodyHtml);

        const footHtml = `
            <tr>
                <td colspan="4" class="jz-col-foot-label">合计 (${items.length}条记录)</td>
                <td>-</td>
                <td>-</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totSsBase)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totPensionP)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totMedP)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totLargeMedP)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totUnempP)}</td>
                <td class="jz-money-cell jz-money-bold">${window.AshanUI.formatMoney(totSsP)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totPensionC)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totMedC)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totUnempC)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totInjuryC)}</td>
                <td class="jz-money-cell jz-money-bold">${window.AshanUI.formatMoney(totSsC)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totHfBase)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totHfP)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totHfC)}</td>
                <td>-</td>
                <td class="jz-money-cell jz-money-primary jz-col-sticky-foot">${window.AshanUI.formatMoney(totCompCost)}</td>
            </tr>
        `;
        $('#tfoot-jz-hist-ins').html(footHtml);
        window.AshanUI.enableMousewheelHorizontalScroll($('#table-jz-hist-ins')[0], $('#box-jz-history')[0]);
    }

    function render_history_comprehensive_view(items) {
        const tableHtml = `
            <table class="jz-table jz-hist-table-comp" id="table-jz-hist-comp">
                <thead>
                    <tr>
                        <th class="jz-col-seq">序号</th>
                        <th class="jz-col-no jz-text-center">账期</th>
                        <th class="jz-col-no jz-text-center">工号</th>
                        <th class="jz-col-name">姓名</th>
                        <th>证件号码</th>
                        <th>部门</th>
                        <th>用工性质</th>
                        <th>计薪方式</th>
                        <th class="jz-text-right">出勤天数</th>
                        <th class="jz-text-right">工作工时</th>
                        <th class="jz-text-right">平时加班(1.5x)</th>
                        <th class="jz-text-right">周末加班(2.0x)</th>
                        <th class="jz-text-right">节日加班(3.0x)</th>
                        <th class="jz-text-right">倒休工时</th>
                        <th class="jz-text-right">餐补天数</th>
                        <th class="jz-text-right">工时基本薪资</th>
                        <th class="jz-text-right">加班工资合计</th>
                        <th class="jz-text-right">基本补贴</th>
                        <th class="jz-text-right">岗位津贴</th>
                        <th class="jz-text-right">绩效工资</th>
                        <th class="jz-text-right">餐补金额</th>
                        <th class="jz-text-right">税前应发工资</th>
                        <th class="jz-text-right">个人五险一金</th>
                        <th class="jz-text-right">专项附加扣除</th>
                        <th class="jz-text-right">代扣个税</th>
                        <th class="jz-text-right jz-col-sticky-foot">税后实发工资</th>
                    </tr>
                </thead>
                <tbody id="tbody-jz-hist-comp"></tbody>
                <tfoot id="tfoot-jz-hist-comp"></tfoot>
            </table>
        `;
        $('#box-jz-history').html(tableHtml);

        const tbody = $('#tbody-jz-hist-comp');
        if (!items.length) {
            tbody.html('<tr><td colspan="26" class="jz-empty-cell">当前筛选条件下暂无综合工资记录。</td></tr>');
            $('#tfoot-jz-hist-comp').empty();
            return;
        }

        let totDays = 0, totWorkHrs = 0, totOt15 = 0, totOt20 = 0, totOt30 = 0, totLeaveComp = 0, totMealCnt = 0;
        let totSalBasic = 0, totSalOt = 0, totSalSub = 0, totPost = 0, totPerf = 0, totMealSal = 0;
        let totGross = 0, totSpecialDed = 0, totAddDed = 0, totTax = 0, totNet = 0;

        const bodyHtml = items.map((it, idx) => {
            const pMonth = it.period_month || (it.parent ? it.parent.replace(`${COMPANY}-`, '') : '');
            const days = flt(it.attendance_days);
            const wHrs = flt(it.work_hours || it.basic_hours);
            const ot15 = flt(it.overtime_regular_1_5);
            const ot20 = flt(it.overtime_weekend_2_0);
            const ot30 = flt(it.overtime_holiday_3_0);
            const lComp = flt(it.leave_compensatory_hours);
            const mCnt = cint(it.meal_count);

            const salBasic = flt(it.salary_basic_hours || it.base_salary);
            const salOt = flt(it.salary_overtime_total || (flt(it.salary_overtime_1_5) + flt(it.salary_overtime_2_0) + flt(it.salary_overtime_3_0)));
            const salSub = flt(it.salary_basic_subsidy || it.house_rent_allowance);
            const post = flt(it.salary_post_allowance || it.post_allowance);
            const perf = flt(it.salary_performance || it.performance_salary);
            const mealSal = flt(it.salary_meal_subsidy || (flt(it.meal_unit_price || 15) * mCnt));
            const gross = flt(it.gross_salary);

            const specDed = flt(it.person_special_ded || (flt(it.ss_person_total) + flt(it.hf_person_total)));
            const addDed = flt(it.special_deductions_total);
            const tax = flt(it.tax_amount);
            const net = flt(it.net_salary);

            totDays += days; totWorkHrs += wHrs; totOt15 += ot15; totOt20 += ot20; totOt30 += ot30; totLeaveComp += lComp; totMealCnt += mCnt;
            totSalBasic += salBasic; totSalOt += salOt; totSalSub += salSub; totPost += post; totPerf += perf; totMealSal += mealSal;
            totGross += gross; totSpecialDed += specDed; totAddDed += addDed; totTax += tax; totNet += net;

            const isCurrent = (pMonth === current_month);
            const periodTag = isCurrent ? `<strong>${esc(pMonth)} (本月)</strong>` : esc(pMonth);

            return `
                <tr>
                    <td class="jz-col-seq">${idx + 1}</td>
                    <td class="jz-col-no jz-text-center">${periodTag}</td>
                    <td class="jz-col-no jz-text-center"><strong>${esc(it.employee_no)}</strong></td>
                    <td class="jz-col-name"><strong>${esc(it.employee_name)}</strong></td>
                    <td class="jz-text-center">${esc(it.id_card || '-')}</td>
                    <td>${esc(it.department || '-')}</td>
                    <td>${esc(it.employee_type || '正式工')}</td>
                    <td>${esc(jizhong_salary_mode_label(it.salary_mode))}</td>
                    <td class="jz-num-cell">${days.toFixed(1)}</td>
                    <td class="jz-num-cell">${wHrs.toFixed(1)}</td>
                    <td class="jz-num-cell">${ot15.toFixed(1)}</td>
                    <td class="jz-num-cell">${ot20.toFixed(1)}</td>
                    <td class="jz-num-cell">${ot30.toFixed(1)}</td>
                    <td class="jz-num-cell">${lComp.toFixed(1)}</td>
                    <td class="jz-num-cell">${mCnt}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(salBasic)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(salOt)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(salSub)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(post)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(perf)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(mealSal)}</td>
                    <td class="jz-money-cell jz-money-bold">${window.AshanUI.formatMoney(gross)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(specDed)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(addDed)}</td>
                    <td class="jz-money-cell jz-text-warn">${window.AshanUI.formatMoney(tax)}</td>
                    <td class="jz-money-cell jz-money-primary jz-col-sticky-foot">${window.AshanUI.formatMoney(net)}</td>
                </tr>
            `;
        }).join('');
        tbody.html(bodyHtml);

        const footHtml = `
            <tr>
                <td colspan="4" class="jz-col-foot-label">合计 (${items.length}条记录)</td>
                <td>-</td>
                <td>-</td>
                <td>-</td>
                <td>-</td>
                <td class="jz-num-cell">${totDays.toFixed(1)}</td>
                <td class="jz-num-cell">${totWorkHrs.toFixed(1)}</td>
                <td class="jz-num-cell">${totOt15.toFixed(1)}</td>
                <td class="jz-num-cell">${totOt20.toFixed(1)}</td>
                <td class="jz-num-cell">${totOt30.toFixed(1)}</td>
                <td class="jz-num-cell">${totLeaveComp.toFixed(1)}</td>
                <td class="jz-num-cell">${totMealCnt}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totSalBasic)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totSalOt)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totSalSub)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totPost)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totPerf)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totMealSal)}</td>
                <td class="jz-money-cell jz-money-bold">${window.AshanUI.formatMoney(totGross)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totSpecialDed)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totAddDed)}</td>
                <td class="jz-money-cell jz-text-warn">${window.AshanUI.formatMoney(totTax)}</td>
                <td class="jz-money-cell jz-money-primary jz-col-sticky-foot">${window.AshanUI.formatMoney(totNet)}</td>
            </tr>
        `;
        $('#tfoot-jz-hist-comp').html(footHtml);
        window.AshanUI.enableMousewheelHorizontalScroll($('#table-jz-hist-comp')[0], $('#box-jz-history')[0]);
    }

    function render_history_summary_view(items) {
        const tableHtml = `
            <table class="jz-table" id="table-jz-hist-sum">
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
                <tbody id="tbody-jz-hist-sum"></tbody>
                <tfoot id="tfoot-jz-hist-sum"></tfoot>
            </table>
        `;
        $('#box-jz-history').html(tableHtml);

        const tbody = $('#tbody-jz-hist-sum');
        if (!items.length) {
            tbody.html('<tr><td colspan="14" class="jz-empty-cell">当前筛选条件下暂无核心简表记录。</td></tr>');
            $('#tfoot-jz-hist-sum').empty();
            return;
        }

        let totBase = 0, totPost = 0, totPerf = 0, totGross = 0, totThresh = 0, totSpec = 0, totAdd = 0, totTax = 0, totNet = 0;

        const bodyHtml = items.map((it, idx) => {
            const pMonth = it.period_month || (it.parent ? it.parent.replace(`${COMPANY}-`, '') : '');
            const base = flt(it.base_salary);
            const post = flt(it.post_allowance);
            const perf = flt(it.performance_salary);
            const gross = flt(it.gross_salary);
            const thresh = flt(it.tax_threshold || 5000);
            const spec = flt(it.ss_person_total) + flt(it.hf_person_total);
            const add = flt(it.special_deductions_total);
            const tax = flt(it.tax_amount);
            const net = flt(it.net_salary);

            totBase += base; totPost += post; totPerf += perf; totGross += gross; totThresh += thresh;
            totSpec += spec; totAdd += add; totTax += tax; totNet += net;

            const isCurrent = (pMonth === current_month);
            const periodTag = isCurrent ? `<strong>${esc(pMonth)} (本月)</strong>` : esc(pMonth);

            return `
                <tr>
                    <td class="jz-col-seq">${idx + 1}</td>
                    <td class="jz-col-no jz-text-center">${periodTag}</td>
                    <td class="jz-col-no jz-text-center jz-hist-col-empno"><strong>${esc(it.employee_no)}</strong></td>
                    <td class="jz-col-name jz-hist-col-empname"><strong>${esc(it.employee_name)}</strong></td>
                    <td>${esc(jizhong_salary_mode_label(it.salary_mode))}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(base)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(post)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(perf)}</td>
                    <td class="jz-money-cell jz-money-bold">${window.AshanUI.formatMoney(gross)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(thresh)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(spec)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(add)}</td>
                    <td class="jz-money-cell jz-text-warn">${window.AshanUI.formatMoney(tax)}</td>
                    <td class="jz-money-cell jz-money-primary">${window.AshanUI.formatMoney(net)}</td>
                </tr>
            `;
        }).join('');
        tbody.html(bodyHtml);

        const footHtml = `
            <tr>
                <td colspan="4" class="jz-col-foot-label">合计 (${items.length}条记录)</td>
                <td>-</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totBase)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totPost)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totPerf)}</td>
                <td class="jz-money-cell jz-money-bold">${window.AshanUI.formatMoney(totGross)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totThresh)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totSpec)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totAdd)}</td>
                <td class="jz-money-cell jz-text-warn">${window.AshanUI.formatMoney(totTax)}</td>
                <td class="jz-money-cell jz-money-primary">${window.AshanUI.formatMoney(totNet)}</td>
            </tr>
        `;
        $('#tfoot-jz-hist-sum').html(footHtml);
        window.AshanUI.enableMousewheelHorizontalScroll($('#table-jz-hist-sum')[0], $('#box-jz-history')[0]);
    }

    $('#jz-history-view-mode').on('click', '.jz-segment-btn', function() {
        const $btn = $(this);
        const view = $btn.data('view');
        if (view === current_history_view) return;
        $('#jz-history-view-mode .jz-segment-btn').removeClass('active').attr('aria-pressed', 'false');
        $btn.addClass('active').attr('aria-pressed', 'true');
        current_history_view = view;
        render_active_history_view();
    });

    $('#jz-history-month-filter').on('change', function() {
        current_history_month = $(this).val();
        fetch_history_dataset();
    });

    $('#jz-history-emp-filter').on('change', function() {
        current_history_emp = $(this).val();
        render_active_history_view();
    });

    $('#btn-jz-export-history').on('click', function() {
        const items = get_filtered_history_items();
        if (!items.length && current_history_view !== 'tax_68') {
            frappe.msgprint('当前筛选条件下没有可导出的数据。');
            return;
        }

        const periodLabel = current_history_month === 'ALL' ? '全部历史与本月' : current_history_month;

        if (current_history_view === 'tax_68') {
            const $table = $('#table-jz-hist-tax');
            if (!$table.length) {
                frappe.msgprint('个税台账正在加载中，请稍后重试。');
                return;
            }
            const headers = [];
            $table.find('thead tr.jz-tax-col-row th').each(function() {
                headers.push($(this).text().trim());
            });
            const rows = [];
            $table.find('tbody tr').each(function() {
                const row = [];
                $(this).find('td').each(function() {
                    row.push($(this).text().trim().replace(/¥\s*/g, '').replace(/,/g, ''));
                });
                if (row.length) rows.push(row);
            });
            download_csv(`吉众历史个税68列申报台账_${periodLabel}.csv`, headers, rows);
        } else if (current_history_view === 'insurance_fund') {
            download_csv(
                `吉众历史五险一金台账_${periodLabel}.csv`,
                ['账期', '工号', '姓名', '用工性质', '计薪方式', '社保基数', '养老个人', '医疗个人', '大额医疗', '失业个人', '社保个人合计', '养老单位', '医疗单位', '失业单位', '工伤单位', '单位社保统筹', '公积金基数', '个人公积金', '单位公积金', '公积金政策', '单位统筹总成本'],
                items.map(it => [
                    it.period_month, it.employee_no, it.employee_name, it.employee_type || '正式工', jizhong_salary_mode_label(it.salary_mode),
                    flt(it.ss_base).toFixed(2), flt(it.pension_person).toFixed(2), flt(it.medical_person).toFixed(2), flt(it.large_medical_person).toFixed(2), flt(it.unemployment_person).toFixed(2), flt(it.ss_person_total).toFixed(2),
                    flt(it.pension_company).toFixed(2), flt(it.medical_company).toFixed(2), flt(it.unemployment_company).toFixed(2), flt(it.work_injury_company).toFixed(2), flt(it.ss_company_total).toFixed(2),
                    flt(it.hf_base).toFixed(2), flt(it.hf_person_total).toFixed(2), flt(it.hf_company_total).toFixed(2), it.housing_fund_policy || '', flt(it.company_cost_total).toFixed(2)
                ])
            );
        } else if (current_history_view === 'comprehensive') {
            download_csv(
                `吉众历史综合工资与人员记录_${periodLabel}.csv`,
                ['账期', '工号', '姓名', '证件号码', '部门', '用工性质', '计薪方式', '出勤天数', '工作工时', '平时加班(1.5x)', '周末加班(2.0x)', '节日加班(3.0x)', '倒休工时', '餐补天数', '工时基本薪资', '加班工资合计', '基本补贴', '岗位津贴', '绩效工资', '餐补金额', '税前应发工资', '个人五险一金', '专项附加扣除', '代扣个税', '实发工资'],
                items.map(it => [
                    it.period_month, it.employee_no, it.employee_name, it.id_card || '', it.department || '', it.employee_type || '正式工', jizhong_salary_mode_label(it.salary_mode),
                    flt(it.attendance_days).toFixed(1), flt(it.work_hours || it.basic_hours).toFixed(1), flt(it.overtime_regular_1_5).toFixed(1), flt(it.overtime_weekend_2_0).toFixed(1), flt(it.overtime_holiday_3_0).toFixed(1), flt(it.leave_compensatory_hours).toFixed(1), cint(it.meal_count),
                    flt(it.salary_basic_hours || it.base_salary).toFixed(2), flt(it.salary_overtime_total).toFixed(2), flt(it.salary_basic_subsidy || it.house_rent_allowance).toFixed(2), flt(it.post_allowance).toFixed(2), flt(it.performance_salary).toFixed(2), flt(it.salary_meal_subsidy).toFixed(2), flt(it.gross_salary).toFixed(2),
                    flt(it.person_special_ded || (flt(it.ss_person_total) + flt(it.hf_person_total))).toFixed(2), flt(it.special_deductions_total).toFixed(2), flt(it.tax_amount).toFixed(2), flt(it.net_salary).toFixed(2)
                ])
            );
        } else {
            download_csv(
                `吉众历史核心薪资汇总_${periodLabel}.csv`,
                ['账期', '工号', '姓名', '计薪方式', '基本工资', '岗位津贴', '绩效奖金', '应发薪资', '免征额', '专项扣除', '附加扣除', '代扣个税', '实发薪资'],
                items.map(it => [
                    it.period_month, it.employee_no, it.employee_name, jizhong_salary_mode_label(it.salary_mode),
                    flt(it.base_salary).toFixed(2), flt(it.post_allowance).toFixed(2), flt(it.performance_salary).toFixed(2),
                    flt(it.gross_salary).toFixed(2), flt(it.tax_threshold || 5000).toFixed(2),
                    flt(flt(it.ss_person_total) + flt(it.hf_person_total)).toFixed(2),
                    flt(it.special_deductions_total).toFixed(2), flt(it.tax_amount).toFixed(2), flt(it.net_salary).toFixed(2)
                ])
            );
        }
    });

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

        const payPeriod = sheets.payment_period_month || next_period(current_month);
        const payTitle = format_payment_month_title(payPeriod);
        const isSocialView = current_tab !== 'housing_fund';
        $('#jz-ins-sheet-title').text(isSocialView ? `${payTitle}社会保险明细` : `${payTitle}住房公积金明细`);

        const social = sheets.social_insurance || {};
        const housing = sheets.housing_fund || {};
        const socialRows = social.rows || [];
        const housingRows = housing.rows || [];
        const socialTotals = social.totals || {};
        const housingTotals = housing.totals || {};

        // 统计社保未参保人员细分：正式工、其他员工、返聘工
        const unSocialRows = socialRows.filter(r => r.status === '不参保' || r.status === '未参保' || r.status === '停缴' || !r.base || Number(r.base) <= 0);
        let unSReg = 0, unSOther = 0, unSRehire = 0;
        unSocialRows.forEach(r => {
            const et = String(r.employee_type || '').trim();
            if (et === '正式工') unSReg++;
            else if (['返聘工', '退休返聘', '退休返聘人员', '其他-返聘工'].includes(et)) unSRehire++;
            else unSOther++;
        });
        const socialSummaryText = `参保人数：${socialTotals.contributor_count || 0} 未参保人数：${unSocialRows.length}（其中：正式工${unSReg}，其他员工${unSOther}，返聘工${unSRehire}）`;
        $('#jz-social-sheet-meta').text(socialSummaryText);

        // 统计公积金未参保（停缴）人员细分：正式工、其他员工、返聘工
        const unHfRows = housingRows.filter(r => r.status === '停缴' || r.status === '未缴纳' || r.status === '不缴纳' || !r.effective_base || Number(r.effective_base) <= 0);
        let unHReg = 0, unHOther = 0, unHRehire = 0;
        unHfRows.forEach(r => {
            const et = String(r.employee_type || '').trim();
            if (et === '正式工') unHReg++;
            else if (['返聘工', '退休返聘', '退休返聘人员', '其他-返聘工'].includes(et)) unHRehire++;
            else unHOther++;
        });
        const housingSummaryText = `参保人数：${housingTotals.contributor_count || 0} 未参保人数：${unHfRows.length}（其中：正式工${unHReg}，其他员工${unHOther}，返聘工${unHRehire}）`;
        $('#jz-housing-sheet-meta').text(housingSummaryText);
        update_jizhong_proof_controls(current_tab === 'housing_fund' ? 'housing_fund' : 'social_insurance');

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
                const policyText = `${row.housing_fund_policy || '季度初规则'} · ${row.decision_label || '-'}`;
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

    function open_insurance_rate_dialog(section) {
        if (!can_configure_insurance) {
            frappe.msgprint('本月缴费比例仅 Payroll Manager 可以修改。');
            return;
        }
        if (!jz_insurance_cache) return;

        const d = jz_insurance_cache;
        const isSocial = section === 'social_insurance';
        const fields = isSocial
            ? [
                { fieldname: 'ss_company_injury', fieldtype: 'Percent', label: '单位工伤保险比例 (%)', default: d.ss_company_injury },
                { fieldname: 'ss_company_pension', fieldtype: 'Percent', label: '单位基本养老比例 (%)', default: d.ss_company_pension },
                { fieldname: 'ss_person_pension', fieldtype: 'Percent', label: '个人基本养老比例 (%)', default: d.ss_person_pension },
                { fieldname: 'ss_company_medical', fieldtype: 'Percent', label: '单位基本医疗比例 (%)', default: d.ss_company_medical },
                { fieldname: 'ss_person_medical', fieldtype: 'Percent', label: '个人基本医疗比例 (%)', default: d.ss_person_medical },
                { fieldname: 'ss_company_unemployment', fieldtype: 'Percent', label: '单位失业保险比例 (%)', default: d.ss_company_unemployment },
                { fieldname: 'ss_person_unemployment', fieldtype: 'Percent', label: '个人失业保险比例 (%)', default: d.ss_person_unemployment },
                { fieldname: 'ss_company_other_medical', fieldtype: 'Percent', label: '单位其他医疗比例 (%)', default: d.ss_company_other_medical },
                { fieldname: 'big_medical_amount_default', fieldtype: 'Currency', label: '大额医疗基准金额 (元/月)', default: d.big_medical_amount_default },
                { fieldname: 'big_medical_amount_special', fieldtype: 'Currency', label: '大额医疗特殊金额 (元/月)', default: d.big_medical_amount_special },
                { fieldname: 'big_medical_special_months', fieldtype: 'Data', label: '大额医疗特殊月份', default: d.big_medical_special_months || '1,4,7,10' },
                { fieldname: 'ss_min_base', fieldtype: 'Currency', label: '社保最低缴费基数 (元)', default: d.ss_min_base || 0 },
            ]
            : [
                { fieldname: 'hf_company_rate', fieldtype: 'Percent', label: '单位住房公积金比例 (%)', default: d.hf_company_rate },
                { fieldname: 'hf_person_rate', fieldtype: 'Percent', label: '个人住房公积金比例 (%)', default: d.hf_person_rate },
                { fieldname: 'hf_auto_rule_enabled', fieldtype: 'Check', label: '启用公积金自动月份规则', default: d.hf_auto_rule_enabled },
                { fieldname: 'hf_contribution_months', fieldtype: 'Data', label: '自动缴纳月份', default: d.hf_contribution_months || '1,4,7,10' },
                { fieldname: 'hf_off_month_action', fieldtype: 'Select', label: '非计划月份处理', options: ['停缴', '继续缴纳'], default: d.hf_off_month_action || '停缴' },
                { fieldname: 'hf_min_base', fieldtype: 'Currency', label: '公积金最低缴费基数 (元)', default: d.hf_min_base || 0 },
            ];
        const title = isSocial ? '修改本月社会保险比例' : '修改本月住房公积金比例';
        const dlg = window.AshanUI.createDialog({
            title: title + ' (' + current_month + ')',
            fields,
            primary_action_label: '保存本月费率',
            primary_action: function(values) {
                run_write_action(dlg.get_primary_btn(), {
                    method: 'ashan_cn_procurement.services.jizhong_payroll_service.update_jizhong_insurance_setting',
                    args: { company: COMPANY, period_month: current_month, values: JSON.stringify(values) },
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
        configure_jizhong_dialog_close_actions(dlg).show();
    }

    $('#btn-jz-edit-social-insurance').on('click', function() {
        open_insurance_rate_dialog('social_insurance');
    });
    $('#btn-jz-edit-housing-fund').on('click', function() {
        open_insurance_rate_dialog('housing_fund');
    });

            // 标题行鼠标滚轮转横向滚动支持 (Mousewheel-to-Horizontal Scroll: 表头滚轮左右横向平滑滚动)
        pageRoot.on('wheel', '.jz-table thead, .jz-table-box thead', function(e) {
            const raw = e.originalEvent || e;
            const dy = raw.deltaY;
            const dx = raw.deltaX;
            if (Math.abs(dy) > Math.abs(dx) && dy !== 0) {
                const $box = $(this).closest('.jz-table-box');
                if ($box.length && $box[0].scrollWidth > $box[0].clientWidth) {
                    $box[0].scrollLeft += dy;
                    e.preventDefault();
                }
            }
        });

    initialize_table_viewport_controller();

    wrapper.__jz_salary_workbench = {
        show() {
            refresh_current_view();
            schedule_active_table_height();
        },
        refresh() {
            refresh_current_view();
            schedule_active_table_height();
        },
        adjustTableHeight() {
            schedule_active_table_height();
        }
    };

    // 页面初始化：查询最新已封账账期，自动进入即将开始的活跃月份
    let init_handled = false;
    function handle_workbench_init(r) {
        if (init_handled) return;
        init_handled = true;
        if (!r || r.exc || !r.message) {
            can_configure_insurance = false;
            $('#btn-jz-edit-social-insurance, #btn-jz-edit-housing-fund').addClass('jz-hidden');
            render_workflow_error(r, '吉众工作台初始化失败，请刷新后重试。');
            load_workflow_status();
            load_employees_data();
            return;
        }
        can_configure_insurance = Boolean(r.message.can_configure);
        set_insurance_view(is_insurance_tab(current_tab) ? current_tab : 'social_insurance');
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
