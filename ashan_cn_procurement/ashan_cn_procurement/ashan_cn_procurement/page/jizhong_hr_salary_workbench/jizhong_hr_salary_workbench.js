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
    let payroll_col_view = "detail"; // summary (20列精简财务) | detail (32列全要素工时分项)
    let can_configure_insurance = false;
    let jz_insurance_sheets_cache = null;
    let cached_employee_type_policies = null;

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
            <button class="jz-tab-btn" data-tab="social_insurance"><span class="tab-status-dot status-warn"></span>社会保险</button>
            <button class="jz-tab-btn" data-tab="housing_fund"><span class="tab-status-dot status-warn"></span>住房公积金</button>
            <button class="jz-tab-btn" data-tab="attendance"><span class="tab-status-dot status-warn"></span>考勤与工时</button>
            <button class="jz-tab-btn" data-tab="payroll"><span class="tab-status-dot status-warn"></span>工资核定</button>
            <button class="jz-tab-btn" data-tab="tax"><span class="tab-status-dot status-warn"></span>个人所得税</button>
            <button class="jz-tab-btn" data-tab="cash_bills"><span class="tab-status-dot status-warn"></span>现金发放</button>
            <button class="jz-tab-btn" data-tab="history">历史数据</button>
        </div>

        <!-- Tab 1: 员工薪资信息表 (对应 Excel [人员薪资信息] sheets) -->
        <div id="jz-tab-employees" class="jz-tab-content">
            <div class="jz-kpi-grid">
                <div class="jz-kpi-card">
                    <div class="jz-kpi-title">在册员工总数</div>
                    <div class="jz-kpi-val" id="jz-emp-kpi-count">0 人</div>
                    <div class="jz-kpi-sub" id="jz-emp-kpi-hire-sub">本月入职：0人 ｜ 本月离职：0人</div>
                </div>
                <div class="jz-kpi-card">
                    <div class="jz-kpi-title">基本工资总基数</div>
                    <div class="jz-kpi-val jz-text-info" id="jz-emp-kpi-base">¥ 0.00</div>
                    <div class="jz-kpi-sub" id="jz-emp-kpi-type-sub">本月正式工：0人 ｜ 返聘工：0人 ｜ 其他：0人</div>
                </div>
                <div class="jz-kpi-card">
                    <div class="jz-kpi-title">社保公积金</div>
                    <div class="jz-kpi-val jz-text-primary" id="jz-emp-kpi-allowance"><span id="jz-emp-kpi-ins-main">在保 0 人</span></div>
                    <div class="jz-kpi-sub" id="jz-emp-kpi-ins-sub">社会保险：0人 ｜ 公积金：0人</div>
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
                    <button class="btn btn-default btn-sm" id="btn-jz-adjust-param" title="调整已选员工薪酬参数（可单选或多选批量调整）">
                        调整薪酬参数 <span class="jz-selected-count-badge" id="jz-selected-count">0</span>
                    </button>
                    <button class="btn btn-default btn-sm" id="btn-jz-employee-type-rules">用工性质规则设置</button>
                    <button class="btn btn-default btn-sm" id="btn-jz-export-employees">导出薪资信息表</button>
                    <button class="btn btn-default btn-sm jz-btn-stage-confirmation" data-step="employees" id="btn-jz-confirm-employees">确认本表</button>
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
                    <span class="jz-toolbar-count-badge" id="jz-emp-sheet-meta">共 0 人</span>
                    <span id="jz-emp-sheet-title" class="jz-hidden" aria-hidden="true"></span>
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
                        <col class="jz-emp-col-type">
                        <col class="jz-emp-col-salary-mode">
                        <col class="jz-emp-col-net-salary">
                        <col class="jz-emp-col-base-salary">
                        <col class="jz-emp-col-base-subsidy">
                        <col class="jz-emp-col-performance">
                        <col class="jz-emp-col-post">
                        <col class="jz-emp-col-meal">
                        <col class="jz-emp-col-adj">
                        <col class="jz-emp-col-ss-mode">
                        <col class="jz-emp-col-social-security">
                        <col class="jz-emp-col-hf-mode">
                        <col class="jz-emp-col-housing-fund">
                        <col class="jz-emp-col-deduction">
                        <col class="jz-emp-col-ret-age">
                        <col class="jz-emp-col-ret-orig-period">
                        <col class="jz-emp-col-ret-delay-age">
                        <col class="jz-emp-col-ret-delay-period">
                        <col class="jz-emp-col-ret-status">
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
                            <th>用工性质</th>
                            <th>计薪方式</th>
                            <th class="jz-text-right">固定工资</th>
                            <th class="jz-text-right">基本工资</th>
                            <th class="jz-text-right">基本补贴</th>
                            <th class="jz-text-right">绩效奖金</th>
                            <th class="jz-text-right">职位津贴</th>
                            <th class="jz-text-right">餐补单价</th>
                            <th class="jz-text-right">工资调整</th>
                            <th class="jz-emp-col-ss-mode jz-text-left">社保方式</th>
                            <th class="jz-text-right">社保基数</th>
                            <th class="jz-emp-col-hf-mode jz-text-left">公积金方式</th>
                            <th class="jz-text-right">公积金基数</th>
                            <th class="jz-emp-col-hf-cycle jz-text-center">公积金周期</th>
                            <th class="jz-text-right">专项附加扣除</th>
                            <th class="jz-text-center">原退休年龄</th>
                            <th class="jz-text-center">原退休年月</th>
                            <th class="jz-text-center">延迟退休年龄</th>
                            <th class="jz-text-center">延迟退休年月</th>
                            <th class="jz-text-center">退休状态</th>
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
                    <button class="btn btn-default btn-sm jz-btn-stage-confirmation" data-step="attendance" id="btn-jz-confirm-attendance" disabled>确认本表</button>
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
                    <span class="jz-toolbar-count-badge" id="jz-att-sheet-meta">考勤 0 人</span>
                    <span id="jz-att-sheet-title" class="jz-hidden" aria-hidden="true"></span>
                </div>
            </div>

            <!-- 病假人工确认与核定条 (单独一行) -->
            <div class="jz-sick-leave-confirm-box" id="jz-sick-leave-confirm-box"></div>

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
                <div class="jz-insurance-sheet-copy">
                    <span class="jz-toolbar-count-badge jz-insurance-action" data-insurance-section="social_insurance" id="jz-social-sheet-meta">参保 0 人</span>
                    <span class="jz-toolbar-count-badge jz-insurance-action jz-hidden" data-insurance-section="housing_fund" id="jz-housing-sheet-meta">参缴 0 人</span>
                    <span id="jz-ins-sheet-title" class="jz-hidden" aria-hidden="true"></span>
                </div>
                <div class="jz-insurance-sheet-toolbar-actions">
                    <input type="file" id="jz-ins-proof-file-input" class="jz-hidden" accept=".pdf,.zip" multiple aria-label="上传缴费凭证">
                    <div class="jz-proof-workflow-group">
                        <button type="button" class="btn btn-primary btn-sm jz-btn-blue" id="btn-jz-upload-proof">上传缴费凭证</button>
                        <button type="button" class="btn btn-default btn-sm jz-hidden" id="btn-jz-view-proof">查看凭证</button>
                        <div class="jz-proof-verify-pill jz-insurance-action" data-insurance-section="social_insurance" id="jz-ss-proof-badge">
                            <div class="jz-proof-pill-row"><span class="jz-proof-pill-text">待上传社保缴费凭证</span><span class="jz-proof-pill-tag is-pending">待核验</span></div>
                            <div class="jz-proof-pill-row"><span class="jz-proof-pill-text">系统计划核验中</span><span class="jz-proof-pill-tag is-pending">待上传</span></div>
                        </div>
                        <div class="jz-proof-verify-pill jz-insurance-action jz-hidden" data-insurance-section="housing_fund" id="jz-hf-proof-badge">
                            <div class="jz-proof-pill-row"><span class="jz-proof-pill-text">待上传公积金缴费凭证</span><span class="jz-proof-pill-tag is-pending">待核验</span></div>
                            <div class="jz-proof-pill-row"><span class="jz-proof-pill-text">系统计划核验中</span><span class="jz-proof-pill-tag is-pending">待上传</span></div>
                        </div>
                        <button class="btn btn-success btn-sm jz-btn-green jz-btn-stage-confirmation jz-insurance-action" data-insurance-section="social_insurance" data-step="social_insurance" id="btn-jz-confirm-social-insurance" disabled>确认本表</button>
                        <button class="btn btn-success btn-sm jz-btn-green jz-btn-stage-confirmation jz-insurance-action jz-hidden" data-insurance-section="housing_fund" data-step="housing_fund" id="btn-jz-confirm-housing-fund" disabled>确认本表</button>
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
                    <div class="jz-kpi-title">合计税前工资</div>
                    <div class="jz-kpi-val jz-text-bold" id="jz-kpi-gross">¥ 0.00</div>
                    <div class="jz-kpi-sub" id="jz-kpi-gross-sub">计薪人员: <strong id="jz-kpi-count">0</strong> 人 ｜ <span id="jz-kpi-status"><span class="jz-status-badge jz-status-draft">草稿 / 可测算</span></span></div>
                </div>
                <div class="jz-kpi-card">
                    <div class="jz-kpi-title">合计税后工资</div>
                    <div class="jz-kpi-val jz-text-primary" id="jz-kpi-net">¥ 0.00</div>
                    <div class="jz-kpi-sub" id="jz-kpi-net-sub" title="现金实发 = 正式人员实发 + 其他人员实发">现金实发: <span id="jz-kpi-cash">¥ 0.00</span><span class="jz-kpi-split" id="jz-kpi-cash-split">（正式: <span id="jz-kpi-cash-regular">¥ 0.00</span> ｜ 其他: <span id="jz-kpi-cash-other">¥ 0.00</span>）</span></div>
                </div>
                <div class="jz-kpi-card">
                    <div class="jz-kpi-title">合计社保</div>
                    <div class="jz-kpi-val jz-text-warn" id="jz-kpi-ss-pers">¥ 0.00</div>
                    <div class="jz-kpi-sub" id="jz-kpi-ss-sub">单位统筹: <span id="jz-kpi-ss-comp">¥ 0.00</span> ｜ 社保总额: <span id="jz-kpi-ss-total">¥ 0.00</span></div>
                </div>
                <div class="jz-kpi-card">
                    <div class="jz-kpi-title">合计公积金</div>
                    <div class="jz-kpi-val jz-text-warn" id="jz-kpi-hf-pers">¥ 0.00</div>
                    <div class="jz-kpi-sub" id="jz-kpi-hf-sub">单位缴存: <span id="jz-kpi-hf-comp">¥ 0.00</span> ｜ 公积金总额: <span id="jz-kpi-hf-total">¥ 0.00</span></div>
                </div>
                <div class="jz-kpi-card">
                    <div class="jz-kpi-title">合计个税</div>
                    <div class="jz-kpi-val jz-text-danger" id="jz-kpi-tax">¥ 0.00</div>
                    <div class="jz-kpi-sub" id="jz-kpi-tax-sub">7级累计预扣 ｜ 基本减除: ¥ 5,000.00/月</div>
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
                            <button type="button" class="jz-segment-btn active" data-view="detail" aria-pressed="true">完整核定大宽表 (对齐Excel)</button>
                            <button type="button" class="jz-segment-btn" data-view="summary" aria-pressed="false">精简财务视图</button>
                        </div>
                    </div>


                </div>
                <div class="jz-toolbar-right">
                    <button class="btn btn-default btn-sm" id="btn-jz-export-payroll">导出工资核定表</button>
                    <span class="jz-toolbar-count-badge" id="jz-payroll-sheet-meta">发薪 0 人</span>
                    <span id="jz-payroll-sheet-title" class="jz-hidden" aria-hidden="true"></span>
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
            <div class="jz-toolbar">
                <div class="jz-toolbar-left">
                    <button class="btn btn-default btn-sm" id="btn-jz-export-tax">导出个税申报明细 Excel</button>
                    <span class="jz-toolbar-count-badge" id="jz-tax-sheet-meta">计税 0 人</span>
                    <span id="jz-tax-sheet-title" class="jz-hidden" aria-hidden="true"></span>
                </div>
                <div class="jz-toolbar-right">
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
                <div class="jz-cash-stat-left">
                    <div class="jz-cash-stat-item"><span class="jz-cash-denom-label">现金总盘：</span> <span class="jz-cash-denom-count" id="stat-cash-total">¥ 0.00</span></div>
                    <div class="jz-cash-stat-item"><span class="jz-cash-denom-label">现金实发：</span> <span class="jz-cash-denom-count" id="stat-cash-emp-count">0 人</span></div>
                    <div class="jz-cash-stat-item"><span class="jz-cash-denom-label">配钞总张数：</span> <span class="jz-cash-denom-count" id="stat-cash-total-bills">0 张</span></div>
                    <div class="jz-cash-stat-item"><span class="jz-cash-denom-label">100元券:</span> <span class="jz-cash-denom-count" id="stat-b100">0 张</span></div>
                    <div class="jz-cash-stat-item"><span class="jz-cash-denom-label">50元券:</span> <span class="jz-cash-denom-count" id="stat-b50">0 张</span></div>
                    <div class="jz-cash-stat-item"><span class="jz-cash-denom-label">10元券:</span> <span class="jz-cash-denom-count" id="stat-b10">0 张</span></div>
                    <div class="jz-cash-stat-item"><span class="jz-cash-denom-label">5元券:</span> <span class="jz-cash-denom-count" id="stat-b5">0 张</span></div>
                    <div class="jz-cash-stat-item"><span class="jz-cash-denom-label">1元券:</span> <span class="jz-cash-denom-count" id="stat-b1">0 张</span></div>
                </div>
                <div class="jz-cash-stat-actions">
                    <button class="btn btn-default btn-sm" id="btn-jz-print-a4-slips">打印 A4 签收工资条</button>
                    <button class="btn btn-default btn-sm" id="btn-jz-export-cash">导出工资发放表</button>
                    <span id="jz-cash-sheet-meta" class="jz-hidden" aria-hidden="true"></span>
                    <span id="jz-cash-sheet-title" class="jz-hidden" aria-hidden="true"></span>
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

    let is_calculating_payroll = false;

    function set_calculation_in_progress(isCalculating) {
        is_calculating_payroll = Boolean(isCalculating);
        const payMonthTitle = format_payment_month_title(current_month);

        const $btnPayroll = $(`.jz-tab-btn[data-tab="payroll"]`);
        const $btnTax = $(`.jz-tab-btn[data-tab="tax"]`);
        const $btnCash = $(`.jz-tab-btn[data-tab="cash_bills"]`);

        if (isCalculating) {
            // 1. Tab 栏标题动态切换：不显示正规标题，显示【计算中...】与呼吸指示灯
            $btnPayroll.html(`<span class="tab-status-dot status-calc"></span>计算中...`);
            $btnTax.html(`<span class="tab-status-dot status-calc"></span>计算中...`);
            $btnCash.html(`<span class="tab-status-dot status-calc"></span>计算中...`);

            // 2. 表格标题动态切换：不显示这几个标题，显示【计算中...】
            $("#jz-payroll-sheet-title").html(`<span class="jz-calc-banner"><span class="jz-calc-spinner"></span>薪资与个税计算中...</span>`);
            $("#jz-tax-sheet-title").html(`<span class="jz-calc-banner"><span class="jz-calc-spinner"></span>个税台账计算中...</span>`);
            $("#jz-cash-sheet-title").html(`<span class="jz-calc-banner"><span class="jz-calc-spinner"></span>现金配钞计算中...</span>`);

            $("#jz-payroll-sheet-meta").text("测算中...");
            $("#jz-tax-sheet-meta").text("测算中...");
            $("#jz-cash-sheet-meta").text("测算中...");

            // 3. 表格内容区展示动态计算卡片
            const overlayPayroll = `<tr><td colspan="32" class="jz-empty-cell"><div class="jz-calculating-overlay"><div class="jz-calc-card-spinner"></div><div class="jz-calc-card-title">全员薪资与个税正在计算中...</div><div class="jz-calc-card-desc">四大前置步骤已全部核定，系统正在自动计算工资核定、68列个税台账与现金发放表...</div></div></td></tr>`;
            const overlayTax = `<tr><td colspan="68" class="jz-empty-cell"><div class="jz-calculating-overlay"><div class="jz-calc-card-spinner"></div><div class="jz-calc-card-title">个人所得税 68 列台账正在计算中...</div><div class="jz-calc-card-desc">系统正在根据历史累计、起征点、五险一金及专项附加扣除反推税前工资并计算个税...</div></div></td></tr>`;
            const overlayCash = `<tr><td colspan="12" class="jz-empty-cell"><div class="jz-calculating-overlay"><div class="jz-calc-card-spinner"></div><div class="jz-calc-card-title">现金发放与配钞明细正在计算中...</div><div class="jz-calc-card-desc">系统正在根据税后实发工资生成 100/50/10/5/1 元钞票张数与现金发放总盘...</div></div></td></tr>`;

            $("#tbody-jz-payroll").html(overlayPayroll);
            $("#tbody-jz-tax").html(overlayTax);
            $("#tbody-jz-cash").html(overlayCash);
        } else {
            // 计算完成，页面自动恢复正规标题与 Tab 文字
            const dotPayroll = `<span class="tab-status-dot ` + (workflow_state.is_locked ? "status-ok" : (payroll_cache.length > 0 ? "status-ok" : "status-warn")) + `"></span>`;
            const dotTax = `<span class="tab-status-dot ` + (get_workflow_step("tax")?.is_confirmed ? "status-ok" : (payroll_cache.length > 0 ? "status-ok" : "status-warn")) + `"></span>`;
            const dotCash = `<span class="tab-status-dot ` + (get_workflow_step("cash_bills")?.is_confirmed ? "status-ok" : (payroll_cache.length > 0 ? "status-ok" : "status-warn")) + `"></span>`;

            $btnPayroll.html(`${dotPayroll}工资核定`);
            $btnTax.html(`${dotTax}个人所得税`);
            $btnCash.html(`${dotCash}现金发放`);

            $("#jz-payroll-sheet-title").text(`${payMonthTitle}工资核定明细单`);
            $("#jz-tax-sheet-title").text(`${payMonthTitle}个人所得税明细单`);
            $("#jz-cash-sheet-title").text(`${payMonthTitle}现金发放与配钞明细单`);
        }
    }

    function update_calculated_sheet_titles(isCalculating) {
        set_calculation_in_progress(isCalculating);
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
            { tab: 'social_insurance', key: 'social_insurance' },
            { tab: 'housing_fund', key: 'housing_fund' },
            { tab: 'attendance', key: 'attendance' },
            { tab: 'payroll', key: 'payroll' },
            { tab: 'tax', key: 'tax' },
            { tab: 'cash_bills', key: 'cash_bills' }
        ];
        stepStatusKeys.forEach(({ tab, key }) => {
            if (is_calculating_payroll && ['payroll', 'tax', 'cash_bills'].includes(tab)) {
                return;
            }
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
                .text('已核定 (申请解锁)')
                .removeClass('btn-primary btn-success')
                .addClass('btn-default')
                .prop('disabled', false)
                .attr('title', '已核定封账（只读受控），点击可申请反审核解锁');
            $('#btn-jz-reset-month')
                .prop('disabled', true)
                .attr('title', '当前账期已核定封账，禁止重置');
        } else if (workflow?.can_lock) {
            $('#btn-jz-header-lock')
                .text('立即核定本月数据')
                .removeClass('btn-default')
                .addClass('btn-primary btn-success')
                .prop('disabled', false)
                .attr('title', '前置步骤全部完成，点击执行最终核定封账');
            $('#btn-jz-reset-month')
                .prop('disabled', false)
                .attr('title', '重置本月：清空本月考勤、已上传文件及测算数据，并重置确认进度');
        } else {
            $('#btn-jz-header-lock')
                .text('核定本月数据')
                .removeClass('btn-success')
                .addClass('btn-primary')
                .prop('disabled', true)
                .attr('title', '需先完成所有前置页签的确认 (全部标绿)');
            $('#btn-jz-reset-month')
                .prop('disabled', false)
                .attr('title', '重置本月：清空本月考勤、已上传文件及测算数据，并重置确认进度');
        }

        workflow_state = workflow || { steps: [] };

        const attDetail = (workflow?.steps || []).find(item => item.tab === 'attendance');
        const isAttConfirmed = Boolean(attDetail && attDetail.is_confirmed);
        const isSettlementLocked = Boolean(workflow?.is_locked || (current_payroll_settlement && current_payroll_settlement.locked));

        if (isAttConfirmed || isSettlementLocked) {
            $('#btn-jz-clear-attendance')
                .prop('disabled', true)
                .addClass('disabled')
                .attr('title', '当前考勤与工时已核定确认，严禁清空！如需清空请先取消【考勤与工时】确认。');
            $('#btn-jz-upload-attendance')
                .prop('disabled', true)
                .addClass('disabled')
                .attr('title', '当前考勤与工时已核定确认，严禁重新上传！如需重新上传请先取消【考勤与工时】确认。');
        } else {
            const hasAttRecords = Boolean(attendance_cache && attendance_cache.length > 0);
            $('#btn-jz-clear-attendance')
                .prop('disabled', !hasAttRecords)
                .toggleClass('disabled', !hasAttRecords)
                .attr('title', hasAttRecords ? '一键清空本月考勤工时记录' : '当前月份暂无考勤记录');
            $('#btn-jz-upload-attendance')
                .prop('disabled', false)
                .removeClass('disabled')
                .attr('title', '上传考勤 Excel 文件');
        }

        $('.jz-btn-stage-confirmation').each(function() {
            const $button = $(this);
            const step = String($button.data('step') || '');
            const detail = get_workflow_step(step);
            if (!detail) {
                $button.text('确认本表');
                set_workflow_button_state($button, true, '正在读取步骤状态');
                return;
            }
            if (detail.is_confirmed) {
                $button.text('取消本表')
                    .addClass('jz-btn-stage-cancel')
                    .removeClass('btn-success jz-btn-green');
                set_workflow_button_state(
                    $button,
                    !detail.can_unconfirm,
                    '点击取消本表确认及强锁定的关联步骤'
                );
                return;
            }
            $button.text('确认本表').removeClass('jz-btn-stage-cancel');
            if ($button.hasClass('jz-insurance-action')) {
                $button.addClass('btn-success jz-btn-green');
            }
            if (step === 'employees') {
                set_workflow_button_state(
                    $button,
                    false,
                    detail.is_ready ? '点击确认本表并锁定' : '点击核验员工档案数据并指出未完善项'
                );
                return;
            }
            set_workflow_button_state(
                $button,
                !detail.can_confirm,
                detail.can_confirm ? '点击确认本表并锁定' : (detail.cannot_confirm_reason || detail.main || '请先完成数据核验及前置确认')
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

    function is_jizhong_other_type(etype) {
        if (!etype) return false;
        const policies = cached_employee_type_policies || [];
        const p = policies.find(x => x.employee_type === etype);
        if (p && typeof p.is_other !== 'undefined') {
            return Boolean(Number(p.is_other));
        }
        return ['其他-返聘工', '其他-正式工', '其他类型员工', '其他'].includes(etype) || etype.includes('其他');
    }

    function employee_category(employee_type, employment_status) {
        const value = String(employee_type || '正式工').trim();
        const status = String(employment_status || '').trim();
        if (value === '本月离职' || value === '本月离职人员' || status === '本月离职') return '本月离职人员';
        if (is_jizhong_other_type(value)) return '其他类型员工';
        if (['返聘工', '退休返聘', '退休返聘人员'].includes(value)) return '退休返聘人员';
        if (['临时工', '零工'].includes(value)) return '临时工';
        return '正式工';
    }

    function format_jizhong_employee_type(etype) {
        const s = String(etype || '正式工').trim();
        if (s === '退休返聘人员' || s === '退休返聘') return '其他-返聘工';
        return s || '正式工';
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

        const payPeriod = secData.expected_period || (jz_insurance_sheets_cache && jz_insurance_sheets_cache.payment_period_month) || next_period(current_month);
        const duePeriodLabel = format_payment_month_title(payPeriod) || `${payPeriod}月`;
        const proofPeriod = secData.proof_period || payPeriod;
        const proofPeriodLabel = format_payment_month_title(proofPeriod) || duePeriodLabel;

        const parsedAmtStr = (Number(parsedAmt || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const sysTotalStr = (Number(sysTotal || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        if (hasProof) {
            const isMatch = verifyStatus === '核验一致' || Math.abs(parsedAmt - sysTotal) < 0.01;
            if (isMatch) {
                $badge
                    .addClass('is-ok')
                    .html(`
                        <div class="jz-proof-pill-row">
                            <span class="jz-proof-pill-text">凭证日期=${proofPeriodLabel}，应缴日期=${duePeriodLabel}</span>
                            <span class="jz-proof-pill-tag is-pass">通过</span>
                        </div>
                        <div class="jz-proof-pill-row">
                            <span class="jz-proof-pill-text">凭证金额${parsedAmtStr} 应缴金额${sysTotalStr}</span>
                            <span class="jz-proof-pill-tag is-pass">通过</span>
                        </div>
                    `);
            } else {
                const diff = Math.abs(parsedAmt - sysTotal);
                const diffStr = (Number(diff || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                const isPeriodMatch = proofPeriod === payPeriod;
                $badge
                    .addClass('is-err')
                    .html(`
                        <div class="jz-proof-pill-row">
                            <span class="jz-proof-pill-text">凭证日期=${proofPeriodLabel}，应缴日期=${duePeriodLabel}</span>
                            <span class="jz-proof-pill-tag ${isPeriodMatch ? 'is-pass' : 'is-fail'}">${isPeriodMatch ? '通过' : '不符'}</span>
                        </div>
                        <div class="jz-proof-pill-row">
                            <span class="jz-proof-pill-text">凭证金额${parsedAmtStr} vs 应缴金额${sysTotalStr} (差额 ${diffStr})</span>
                            <span class="jz-proof-pill-tag is-fail">不符</span>
                        </div>
                    `);
            }
        } else {
            $badge
                .addClass('is-pending')
                .html(`
                    <div class="jz-proof-pill-row">
                        <span class="jz-proof-pill-text">待上传缴费凭证 · 应缴日期 ${duePeriodLabel}</span>
                        <span class="jz-proof-pill-tag is-pending">待核对</span>
                    </div>
                    <div class="jz-proof-pill-row">
                        <span class="jz-proof-pill-text">系统应缴金额 ${sysTotalStr}</span>
                        <span class="jz-proof-pill-tag is-pending">待上传</span>
                    </div>
                `);
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
        const empStep = get_workflow_step('employees');
        if (!empStep || !empStep.is_confirmed) {
            frappe.msgprint({
                title: '前置步骤未完成',
                indicator: 'orange',
                message: '请先完成并确认【员工档案】，方可上传核验社保/公积金凭证！'
            });
            return;
        }
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
                        const period = (res.files && res.files[0] && res.files[0].period_month) || res.period_label || res.expected_period || '';
                        let period_label = period;
                        if (period && period.includes('-')) {
                            const [py, pm] = period.split('-');
                            period_label = `${py}年${pm}月`;
                        } else if (res.period_label) {
                            period_label = res.period_label;
                        }
                        const amt_str = res.parsed_amount_formatted || (window.AshanUI?.formatMoney
                            ? window.AshanUI.formatMoney(res.parsed_amount)
                            : `¥ ${Number(res.parsed_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
                        const payPeriod = res.expected_period || next_period(current_month);
                        const duePeriodLabel = format_payment_month_title(payPeriod) || `${payPeriod}月`;
                        const proofPeriodLabel = period_label || duePeriodLabel;
                        const alert_msg = `验证一致！<br>凭证日期=${proofPeriodLabel}，应缴日期=${duePeriodLabel} 通过<br>凭证金额 ${amt_str}，应缴金额 ${amt_str} 通过`;
                        if (res.is_matched) {
                            frappe.show_alert({ message: alert_msg, indicator: 'green' }, 8);
                        } else {
                            frappe.show_alert({ message: `附件所属期：${period_label}，金额：${amt_str}`, indicator: 'orange' }, 8);
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

    function get_tab_label(tab) {
        const map = {
            employees: '员工档案',
            attendance: '考勤与工时',
            social_insurance: '社会保险',
            housing_fund: '住房公积金',
            payroll: '工资核定',
            tax: '个人所得税',
            cash_bills: '现金发放',
            history: '历史数据',
        };
        return map[tab] || tab;
    }

    function get_unconfirmed_prerequisites() {
        const unconfirmed = [];
        const empStep = get_workflow_step('employees');
        if (!empStep || !empStep.is_confirmed) {
            unconfirmed.push('员工档案');
        }
        const ssStep = get_workflow_step('social_insurance');
        if (!ssStep || !ssStep.is_confirmed) {
            unconfirmed.push('社会保险');
        }
        const hfStep = get_workflow_step('housing_fund');
        if (!hfStep || !hfStep.is_confirmed) {
            unconfirmed.push('住房公积金');
        }

        // 考勤工时：若所有员工均为固定工资（固定工资无视工时），可免考勤；否则需核定
        let attendanceRequired = false;
        const currentItems = payroll_cache || [];
        if (currentItems.length > 0) {
            for (const it of currentItems) {
                const sm = String(it.salary_mode || '').trim();
                const ml = jizhong_salary_mode_label(sm);
                if (ml !== '税后固定工资' && sm !== '固定工资' && sm !== '税前固定工资') {
                    attendanceRequired = true;
                    break;
                }
            }
        } else if (employees_cache && employees_cache.length > 0) {
            for (const ep of employees_cache) {
                const sm = String(ep.salary_mode || '').trim();
                const ml = jizhong_salary_mode_label(sm);
                if (ml !== '税后固定工资' && sm !== '固定工资' && sm !== '税前固定工资') {
                    attendanceRequired = true;
                    break;
                }
            }
        } else {
            attendanceRequired = true;
        }

        if (attendanceRequired) {
            const attStep = get_workflow_step('attendance');
            if (!attStep || !attStep.is_confirmed) {
                unconfirmed.push('考勤与工时');
            }
        }
        return unconfirmed;
    }

    // Tab 切换逻辑
    $('.jz-tab-btn').on('click', function() {
        const tab = $(this).data('tab');
        if (!allowed_tabs.has(tab)) return;

        const isSettlementLocked = Boolean(workflow_state.is_locked || (current_payroll_settlement && current_payroll_settlement.locked));

        // 一级门禁：进行【社会保险】、【住房公积金】、【考勤与工时】前，必须先确认完【员工档案】
        const empDependentTabs = ['social_insurance', 'housing_fund', 'attendance'];
        if (empDependentTabs.includes(tab) && !isSettlementLocked) {
            const empStep = get_workflow_step('employees');
            if (!empStep || !empStep.is_confirmed) {
                frappe.msgprint({
                    title: '前置步骤未完成',
                    indicator: 'orange',
                    message: `进行【${get_tab_label(tab)}】前，必须先完成并确认前置步骤：<br><br><strong>员工档案</strong><br><br><span class="text-muted">（注：确认完员工信息后，方可进行社会保险、住房公积金、考勤与工时）。</span>`
                });
                return;
            }
        }

        // 二级门禁：进行【月度工资核定】、【个人所得税】、【现金发放】前，必须先确认完【社会保险】、【住房公积金】、【考勤与工时】等全部前置步骤
        const gatedTabs = ['payroll', 'tax', 'cash_bills'];
        if (gatedTabs.includes(tab) && !isSettlementLocked) {
            const unconfirmed = get_unconfirmed_prerequisites();
            if (unconfirmed.length > 0) {
                frappe.msgprint({
                    title: '前置核定未就绪',
                    indicator: 'orange',
                    message: `进入【${get_tab_label(tab)}】前，须先完成并核定以下前置步骤：<br><br><strong>${unconfirmed.join('、')}</strong><br><br><span class="text-muted">（注：社会保险、住房公积金、考勤与工时确认完后，方可进行剩下的工资核定、个税与现金发放）。</span>`
                });
                return;
            }
        }

        $('.jz-tab-btn').removeClass('active');
        $(this).addClass('active');
        $('.jz-tab-content').addClass('jz-hidden');
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
                `确认【${current_month}】本表数据吗？确认后本表将在工作台内只读保护。`,
                function() {
                    const currentUnconfirmed = get_unconfirmed_prerequisites();
                    const willTriggerAutoCalc = (
                        currentUnconfirmed.length === 1 &&
                        currentUnconfirmed.includes(label)
                    );
                    if (willTriggerAutoCalc) {
                        set_calculation_in_progress(true);
                    }

                    run_write_action($button, {
                        method: 'ashan_cn_procurement.services.jizhong_payroll_service.lock_jizhong_monthly_payroll',
                        args: { company: COMPANY, period_month: current_month, step },
                        busyText: '正在确认…',
                        success: function(result) {
                            employee_validation_errors = {};
                            employee_validation_active = false;
                            frappe.show_alert({ message: result.message, indicator: 'green' }, 6);
                            if (result.auto_calculated) {
                                set_calculation_in_progress(true);
                                setTimeout(function() {
                                    set_calculation_in_progress(false);
                                    refresh_current_view();
                                    frappe.show_alert({
                                        message: '四大前置步骤已全部核定，工资核定、个人所得税与现金发放已自动计算就绪！',
                                        indicator: 'green'
                                    }, 6);
                                }, 600);
                            } else {
                                if (willTriggerAutoCalc) {
                                    set_calculation_in_progress(false);
                                }
                                refresh_current_view();
                            }
                        },
                        error: function(message) {
                            set_calculation_in_progress(false);
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
            title: `取消本表（${current_month}）`,
            fields: [{
                fieldname: 'reason',
                fieldtype: 'Small Text',
                label: '取消本表原因',
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
                    busyText: '正在取消本表…',
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
        frappe.call({
            method: 'frappe.client.get_list',
            args: {
                doctype: 'Jizhong Employee Type Policy',
                filters: { company: '天津吉众科技有限公司', is_active: 1 },
                fields: ['name', 'employee_type', 'is_other', 'participate_social_security', 'participate_housing_fund', 'participate_tax', 'participate_payroll', 'participate_cash_bills', 'participate_attendance'],
                order_by: 'creation asc',
                limit_page_length: 50
            },
            callback: function(r) {
                if (r && r.message && r.message.length) {
                    cached_employee_type_policies = r.message;
                }
            }
        });
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

    function get_payroll_formula_details(it, field) {
        const round2 = value => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
        const money = value => window.AshanUI.formatMoney(round2(value));
        const number = (value, unit = '') => `${round2(value).toFixed(2)}${unit}`;
        const base = round2(it.base_salary);
        const dynDays = round2(it.formula_dynamic_workdays || 21);
        const dynHours = round2(it.formula_dynamic_work_hours || dynDays * 8);
        const fixHours = round2(it.formula_fixed_monthly_hours || 172);
        const workHours = round2(it.work_hours);
        const sickDays = round2(it.sick_days);
        const leaveHours = round2(it.leave_compensatory_hours);
        const isFixed = String(it.salary_mode || '').includes('固定');
        const isFullMonthSick = workHours === 0 && sickDays >= dynDays && dynDays > 0;
        const make = (title, rule, calc, result) => ({ title, rule, calc, result: money(result) });

        if (field === 'base_salary') {
            const salaryMode = jizhong_salary_mode_label(it.salary_mode);
            if (salaryMode === '税前固定工资') {
                return make('基本工资', '基本工资标准 = 税前固定工资金额（固定工资人员可省略档案基本工资）', `${money(it.fixed_salary)} = ${money(base)}`, base);
            }
            if (salaryMode === '税后固定工资') {
                return make('基本工资', '基本工资标准 = 税后固定工资反推的税前工资金额', `税后目标 ${money(it.fixed_salary)} → 税前 ${money(base)}`, base);
            }
            return make('基本工资', '基本工资标准 = 员工档案中的基本工资', `${money(base)} = ${money(base)}`, base);
        }
        if (field === 'base_subsidy_standard') return make('基本补贴', '基本补贴标准 = 员工档案中的基本补贴', `${money(it.house_rent_allowance)} = ${money(it.house_rent_allowance)}`, it.house_rent_allowance);
        if (field === 'performance_standard') return make('绩效奖金标准', '绩效奖金标准 = 员工档案中的绩效奖金', `${money(it.performance_salary)} = ${money(it.performance_salary)}`, it.performance_salary);
        if (field === 'post_allowance_standard') return make('职位津贴标准', '职位津贴标准 = 员工档案中的职位津贴', `${money(it.post_allowance)} = ${money(it.post_allowance)}`, it.post_allowance);
        if (field === 'meal_unit_price') return make('餐补单价', '餐补单价 = 员工档案中的餐补标准', `${money(it.meal_unit_price || 15)} = ${money(it.meal_unit_price || 15)}`, it.meal_unit_price || 15);
        if (field === 'hf_company') return make('住房公积金c', '住房公积金c = 公积金基数 × 单位缴存比例', `${money(it.hf_base)} × 5.00%`, it.hf_company_total);
        if (field === 'hf_person') return make('住房公积金p', '住房公积金p = 公积金基数 × 个人缴存比例', `${money(it.hf_base)} × 5.00%`, it.hf_person_total);
        if (field === 'ss_company') return make('社保合计c', '社保合计c = 单位各险种缴费合计', `单位各险种合计 = ${money(it.ss_company_total)}`, it.ss_company_total);
        if (field === 'ss_person') return make('社保合计p', '社保合计p = 个人各险种缴费合计', `个人各险种合计 = ${money(it.ss_person_total)}`, it.ss_person_total);

        if (field === 'salary_overtime_1_5') {
            if (isFixed) return make('1.5倍工资', '1.5倍工资 = 固定工资模式不单独计算加班工资', `固定工资模式 = ${money(it.salary_overtime_1_5)}`, it.salary_overtime_1_5);
            return make('1.5倍工资', '1.5倍工资 = 基本工资 ÷ 固定月计薪工时 × 1.50 × 1.5倍工时', `${money(base)} ÷ ${number(fixHours, '小时')} × 1.50 × ${number(it.overtime_regular_1_5, '小时')}`, it.salary_overtime_1_5);
        }
        if (field === 'salary_overtime_2_0') {
            if (isFixed) return make('2倍工资', '2倍工资 = 固定工资模式不单独计算加班工资', `固定工资模式 = ${money(it.salary_overtime_2_0)}`, it.salary_overtime_2_0);
            return make('2倍工资', '2倍工资 = 基本工资 ÷ 固定月计薪工时 × 2.00 × 2倍工时', `${money(base)} ÷ ${number(fixHours, '小时')} × 2.00 × ${number(it.overtime_weekend_2_0, '小时')}`, it.salary_overtime_2_0);
        }
        if (field === 'salary_overtime_3_0') {
            if (isFixed) return make('3倍工资', '3倍工资 = 固定工资模式不单独计算加班工资', `固定工资模式 = ${money(it.salary_overtime_3_0)}`, it.salary_overtime_3_0);
            return make('3倍工资', '3倍工资 = 基本工资 ÷ 固定月计薪工时 × 3.00 × 3倍工时', `${money(base)} ÷ ${number(fixHours, '小时')} × 3.00 × ${number(it.overtime_holiday_3_0, '小时')}`, it.salary_overtime_3_0);
        }
        if (field === 'salary_sick_leave') {
            return isFullMonthSick
                ? make('病假工资', '病假工资 = 基本工资 × 80.00%', `${money(base)} × 80.00%`, it.salary_sick_leave)
                : make('病假工资', '病假工资 = 基本工资 ÷ 动态法定工作日 × 80.00% × 病假天数', `${money(base)} ÷ ${number(dynDays, '天')} × 80.00% × ${number(sickDays, '天')}`, it.salary_sick_leave);
        }
        if (field === 'salary_basic_hours') {
            return make('基本工时工资', '基本工时工资 = 基本工资 ÷ 动态法定工时 × 基本工时', `${money(base)} ÷ ${number(dynHours, '小时')} × ${number(it.basic_hours || workHours, '小时')}`, it.salary_basic_hours);
        }
        if (field === 'salary_basic_subsidy') {
            return make('基本补贴工资', '基本补贴工资 = 基本补贴标准 - 基本补贴标准 ÷ 动态法定工时 × 缺勤工时', `${money(it.house_rent_allowance)} - ${money(it.house_rent_allowance)} ÷ ${number(dynHours, '小时')} × ${number(Math.max(0, dynHours - workHours), '小时')}`, it.salary_basic_subsidy);
        }
        if (field === 'salary_performance') {
            return make('绩效奖金工资', '绩效奖金工资 = 绩效奖金标准 - 绩效奖金标准 ÷ 固定月计薪工时 × 缺勤工时', `${money(it.performance_salary)} - ${money(it.performance_salary)} ÷ ${number(fixHours, '小时')} × ${number(Math.max(0, dynHours - workHours), '小时')}`, it.salary_performance);
        }
        if (field === 'salary_post_allowance') {
            return make('职位津贴工资', '职位津贴工资 = 职位津贴标准 - 职位津贴标准 ÷ 动态法定工时 × 缺勤工时', `${money(it.post_allowance)} - ${money(it.post_allowance)} ÷ ${number(dynHours, '小时')} × ${number(Math.max(0, dynHours - workHours), '小时')}`, it.salary_post_allowance);
        }
        if (field === 'salary_meal_subsidy') {
            return make('餐补工资', '餐补工资 = 餐补单价 × 餐补次数', `${money(it.meal_unit_price || 15)} × ${number(it.meal_count, '次')}`, it.salary_meal_subsidy);
        }
        if (field === 'salary_adjustment') {
            return make('工资调整', '工资调整 = 员工档案中本月工资调整金额', `${money(it.salary_adjustment)}`, it.salary_adjustment);
        }
        if (field === 'gross_salary') {
            const allowances = round2(Number(it.salary_basic_subsidy || 0) + Number(it.salary_performance || 0) + Number(it.salary_post_allowance || 0));
            const overtime = round2(Number(it.salary_overtime_1_5 || 0) + Number(it.salary_overtime_2_0 || 0) + Number(it.salary_overtime_3_0 || 0));
            return make('应发薪资', '应发薪资 = 基本工时工资 + 病假工资 + 加班工资 + 津贴绩效 + 餐补工资 + 工资调整', `${money(it.salary_basic_hours)} + ${money(it.salary_sick_leave)} + ${money(overtime)} + ${money(allowances)} + ${money(it.salary_meal_subsidy)} + ${money(it.salary_adjustment)}`, it.gross_salary);
        }
        if (field === 'tax_amount') {
            return make('代扣个人所得税', '代扣个税 = 7级累计预扣算法计算的当月应纳税额', `应纳税所得额 ${money(it.taxable_income)} × 累计预扣税率 - 以前已缴税额`, it.tax_amount);
        }
        if (field === 'net_salary') {
            return make('实发薪资', '实发薪资 = 应发薪资 - 个人社保公积金 - 代缴个税', `${money(it.gross_salary)} - ${money(round2(Number(it.ss_person_total) + Number(it.hf_person_total)))} - ${money(it.tax_amount)}`, it.net_salary);
        }
        if (field === 'cash_pay') {
            return make('现金发放工资', '现金发放工资 = 实发薪资向上取整至元', `向上取整(${money(it.net_salary)})`, it.cash_pay);
        }
        if (field === 'attendance_days') return make('整天', '整天 = 正常工作日中作业时间 ≥ 8.00小时的天数', `满足条件的正常工作日 = ${number(it.attendance_days, '天')}`, it.attendance_days);
        if (field === 'half_days') return make('半天', '半天 = 正常工作日中 0.00 < 作业时间 < 8.00小时的天数', `满足条件的正常工作日 = ${number(it.half_days, '天')}`, it.half_days);
        if (field === 'absent_days') return make('缺勤', '缺勤 = 正常工作日中作业时间 = 0.00小时的天数', `满足条件的正常工作日 = ${number(it.absent_days, '天')}`, it.absent_days);
        if (field === 'sick_days') return make('病假天数', '病假天数 = 考勤备注为“病/病假”的正常工作日天数', `病假正常工作日 = ${number(sickDays, '天')}`, sickDays);
        if (field === 'basic_hours') return make('基本工时', '基本工时 = 正班工时 + 实际倒休工时', `${number(Math.max(0, workHours - leaveHours), '小时')} + ${number(leaveHours, '小时')}`, it.basic_hours || workHours);
        if (field === 'overtime_regular_1_5') return make('1.5倍工时', '1.5倍工时 = 平日超过正常工时的加班工时', `平日加班工时 = ${number(it.overtime_regular_1_5, '小时')}`, it.overtime_regular_1_5);
        if (field === 'overtime_weekend_2_0') return make('2倍工时', '2倍工时 = 周末休息日加班工时', `周末加班工时 = ${number(it.overtime_weekend_2_0, '小时')}`, it.overtime_weekend_2_0);
        if (field === 'overtime_holiday_3_0') return make('3倍工时', '3倍工时 = 法定节假日加班工时', `法定节假日加班工时 = ${number(it.overtime_holiday_3_0, '小时')}`, it.overtime_holiday_3_0);
        if (field === 'leave_compensatory_hours') return make('倒休工时', '倒休工时 = 周末加班工时抵扣正常工作日缺口的实际时数', `实际倒休工时 = ${number(leaveHours, '小时')}`, leaveHours);
        if (field === 'meal_count') return make('餐补次数', '餐补次数 = 考勤表中有效订餐次数合计', `有效订餐次数 = ${number(it.meal_count, '次')}`, it.meal_count);
        return null;
    }

    function show_payroll_formula_popover(targetEl, formula) {
        let popover = pageQuery('#jz-payroll-formula-popover');
        if (popover.length === 0) {
            popover = pageQuery('<div id="jz-payroll-formula-popover" class="jz-formula-popover" role="tooltip"></div>');
            pageQuery('body').append(popover);
        }
        const method = String(formula.rule || '').replace(/^公式[:：]\s*/, '');
        popover.html(`
            <div class="jz-formula-popover-line">${esc(method)}</div>
            <div class="jz-formula-popover-line">${esc(`${formula.calc} = ${formula.result}`)}</div>
        `);
        const target = pageQuery(targetEl);
        const rect = target[0].getBoundingClientRect();
        const width = popover.outerWidth() || 480;
        const height = popover.outerHeight() || 80;
        const top = rect.bottom + height + 6 <= window.innerHeight ? rect.bottom + 6 : Math.max(8, rect.top - height - 6);
        const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left - 40));
        popover.css({ top: `${top}px`, left: `${left}px` }).addClass('visible');
    }

    function hide_payroll_formula_popover() {
        pageQuery('#jz-payroll-formula-popover').removeClass('visible');
    }
    function update_payroll_kpi_and_table() {
        const set = current_payroll_settlement || {};
        const items = payroll_cache || [];
        const taxStep = get_workflow_step('tax');
        const isTaxConfirmed = Boolean(set.locked || (taxStep && taxStep.is_confirmed));
        const pendingBadge = '<span class="jz-status-badge jz-status-tax-pending">还未生成个税</span>';

        if (set.locked) {
            $('#jz-kpi-status').html('<span class="jz-status-badge jz-status-locked">已核定锁定</span>');
        } else {
            $('#jz-kpi-status').html('<span class="jz-status-badge jz-status-draft">草稿 / 可测算</span>');
        }

        const hasData = items.length > 0 && flt(set.total_gross_salary) > 0;
        $('#jz-kpi-count').text(items.length);
        if (hasData) {
            let statusNote = '';
            if (set.locked) {
                statusNote = ' ｜ <span class="jz-text-success"><strong>已核定封账</strong>（只读受控，已归档至历史数据）</span>';
            } else if (get_workflow_step('tax')?.is_confirmed && get_workflow_step('cash_bills')?.is_confirmed) {
                statusNote = ' ｜ <span class="jz-text-success"><strong>个税与现金已核对确认</strong>（点击【核定锁定】即可完成全月封账归档）</span>';
            } else {
                statusNote = ' ｜ <span class="text-muted">（已完成测算，请前往【个人所得税】与【现金发放】核对确认后执行封账）</span>';
            }
            $('#jz-payroll-sheet-meta').text(`发薪 ${items.length} 人`);
            $('#jz-kpi-net').text(window.AshanUI.formatMoney(set.total_net_salary || 0));
            $('#jz-kpi-gross').text(window.AshanUI.formatMoney(set.total_gross_salary || 0));
            $('#jz-kpi-person-ded').text(window.AshanUI.formatMoney((flt(set.total_social_security_person) + flt(set.total_housing_fund_person) + flt(set.total_tax))));
            $('#jz-kpi-tax').text(window.AshanUI.formatMoney(set.total_tax || 0));
        } else {
            $('#jz-payroll-sheet-meta').text(`待核定`);
            $('#jz-kpi-net').text("¥ 0.00");
            $('#jz-kpi-gross').text("¥ 0.00");
            $('#jz-kpi-person-ded').text("¥ 0.00");
            $('#jz-kpi-tax').text("¥ 0.00");
        }
        update_calculated_sheet_titles(false);

        const ssP = flt(set.total_social_security_person || 0);
        const ssC = flt(set.total_social_security_company || 0);
        const hfP = flt(set.total_housing_fund_person || 0);
        const hfC = flt(set.total_housing_fund_company || 0);
        let cashTotal = 0;
        let cashRegular = 0;
        let cashOther = 0;
        items.forEach(it => {
            const t = String(it.employee_type || '').trim();
            const c = flt(it.cash_pay || Math.ceil(flt(it.net_salary || 0)));
            cashTotal += c;
            if (is_jizhong_other_type(t)) {
                cashOther += c;
            } else {
                cashRegular += c;
            }
        });
        if (cashTotal === 0 && set.total_cash) {
            cashTotal = flt(set.total_cash);
        }

        $("#jz-kpi-cash").text(window.AshanUI.formatMoney(cashTotal));
        $("#jz-kpi-cash-regular").text(window.AshanUI.formatMoney(cashRegular));
        $("#jz-kpi-cash-other").text(window.AshanUI.formatMoney(cashOther));
        $("#jz-kpi-ss-pers").text(window.AshanUI.formatMoney(ssP));
        $("#jz-kpi-ss-comp").text(window.AshanUI.formatMoney(ssC));
        $("#jz-kpi-ss-total").text(window.AshanUI.formatMoney(ssP + ssC));
        $("#jz-kpi-hf-pers").text(window.AshanUI.formatMoney(hfP));
        $("#jz-kpi-hf-comp").text(window.AshanUI.formatMoney(hfC));
        $("#jz-kpi-hf-total").text(window.AshanUI.formatMoney(hfP + hfC));

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
                load_workflow_status();
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
                    <th class="jz-col-seq jz-col-sticky-1">序号</th>
                    <th class="jz-col-no jz-col-sticky-2">工号</th>
                    <th class="jz-col-name jz-col-sticky-3">姓名</th>
                    <th>用工性质</th>
                    <th>计薪方式</th>
                    <th class="jz-text-right">基本工资</th>
                    <th class="jz-text-right">基本补贴</th>
                    <th class="jz-text-right">绩效奖金</th>
                    <th class="jz-text-right">职位津贴</th>
                    <th class="jz-text-right">餐补单价</th>
                    <th class="jz-text-right">整天</th>
                    <th class="jz-text-right">半天</th>
                    <th class="jz-text-right">缺勤</th>
                    <th class="jz-text-right">病假天数</th>
                    <th class="jz-text-right">基本工时</th>
                    <th class="jz-text-right">1.5倍工时</th>
                    <th class="jz-text-right">2倍工时</th>
                    <th class="jz-text-right">3倍工时</th>
                    <th class="jz-text-right">倒休工时</th>
                    <th class="jz-text-right">餐补次数</th>
                    <th class="jz-text-right">基本工时工资</th>
                    <th class="jz-text-right">病假工资</th>
                    <th class="jz-text-right">1.5倍工资</th>
                    <th class="jz-text-right">2倍工资</th>
                    <th class="jz-text-right">3倍工资</th>
                    <th class="jz-text-right">基本补贴工资</th>
                    <th class="jz-text-right">绩效奖金工资</th>
                    <th class="jz-text-right">职位津贴工资</th>
                    <th class="jz-text-right">餐补工资</th>
                    <th class="jz-text-right">工资调整</th>
                    <th class="jz-text-right">应发薪资</th>
                    <th class="jz-text-right">住房公积金c</th>
                    <th class="jz-text-right">社保合计c</th>
                    <th class="jz-text-right">公司成本合计</th>
                    <th class="jz-text-right">住房公积金p</th>
                    <th class="jz-text-right">社保合计p</th>
                    <th class="jz-text-right">代缴个税</th>
                    <th class="jz-text-right">个人成本合计</th>
                    <th class="jz-text-right">实发薪资</th>
                    <th class="jz-text-right">现金发放工资</th>
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
                    <th class="jz-text-right">病假天数</th>
                    <th class="jz-text-right">病假工资</th>
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
                return !is_jizhong_other_type(type);
            } else if (payroll_filter_mode === 'other') {
                return is_jizhong_other_type(type);
            }
            return true;
        });

        const colSpanTotal = isDetail ? 40 : 22;
        if (filtered.length === 0) {
            tbody.html(`<tr><td colspan="${colSpanTotal}" class="jz-empty-cell">该期间暂无薪酬结算记录，请点击上方“执行月度薪酬核算”。</td></tr>`);
            return;
        }

        let tot_basic_hrs = 0, tot_sick_days = 0, tot_sal_sick = 0, tot_ot_hrs = 0, tot_ot_pay = 0, tot_allow_perf = 0;
        let tot_sal_meal = 0, tot_sal_adj = 0, tot_gross = 0;
        let tot_ss_pers = 0, tot_hf_pers = 0, tot_tax = 0, tot_pers_ded = 0, tot_net = 0, tot_cash = 0;
        let tot_comp_ins = 0, tot_comp_cost = 0;

        let tot_ot15_hrs = 0, tot_ot20_hrs = 0, tot_ot30_hrs = 0, tot_comp_hrs = 0, tot_meals = 0;
        let tot_sal_basic = 0, tot_sal_ot15 = 0, tot_sal_ot20 = 0, tot_sal_ot30 = 0;
        let tot_sal_sub = 0, tot_sal_perf = 0, tot_sal_post = 0, tot_ss_comp = 0, tot_hf_comp = 0;

        filtered.forEach((it, idx) => {
            const formulaTd = (className, formulaKey, content) => `<td class="${className} jz-formula-cell" data-formula-field="${formulaKey}" data-employee-no="${esc(it.employee_no)}" tabindex="0">${content}</td>`;
            const bHrs = flt(it.work_hours);
            const ot15 = flt(it.overtime_regular_1_5);
            const ot20 = flt(it.overtime_weekend_2_0);
            const ot30 = flt(it.overtime_holiday_3_0);
            const cLeave = flt(it.leave_compensatory_hours);
            const mCount = cint(it.meal_count);

            const sBasic = flt(it.salary_basic_hours);
            const sSickDays = flt(it.sick_days || 0);
            const sSalSick = flt(it.salary_sick_leave || 0);
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

            // 工资核定、个税与现金发放三者同源同时生成，数据相互影响并完整呈现
            const isTaxSettled = get_workflow_step('tax')?.is_confirmed || (current_payroll_settlement && flt(current_payroll_settlement.total_gross_salary) > 0);
            const salMode = String(it.salary_mode || '').trim();
            const isFixedNetMode = salMode.includes('税后固定') || salMode.includes('固定税后');
            const isDynamicMode = !salMode.includes('固定');

            let cellGross, cellTax, cellPCost, cellNet, cellCash, cellSBasic;
            if (isTaxSettled) {
                cellGross = window.AshanUI.formatMoney(gross);
                cellTax = window.AshanUI.formatMoney(tax);
                cellPCost = window.AshanUI.formatMoney(pCost);
                cellNet = window.AshanUI.formatMoney(net);
                cellCash = window.AshanUI.formatMoney(cash);
                cellSBasic = window.AshanUI.formatMoney(sBasic);
            } else {
                if (isFixedNetMode) {
                    // 税后固定工资：不显示税前工资与个税等，显示固定税后工资，其余黄色标注“还未生成个税”
                    cellGross = pendingBadge;
                    cellTax = pendingBadge;
                    cellPCost = pendingBadge;
                    cellNet = window.AshanUI.formatMoney(it.fixed_salary || net || 0);
                    cellCash = pendingBadge;
                    cellSBasic = pendingBadge;
                } else if (salMode.includes('税后动态') || isDynamicMode) {
                    // 税后动态工资等等动态的：不显示税后工资，黄色标注“还未生成个税”
                    cellGross = (gross > 0) ? window.AshanUI.formatMoney(gross) : pendingBadge;
                    cellTax = pendingBadge;
                    cellPCost = pendingBadge;
                    cellNet = pendingBadge;
                    cellCash = pendingBadge;
                    cellSBasic = (sBasic > 0) ? window.AshanUI.formatMoney(sBasic) : pendingBadge;
                } else {
                    cellGross = (gross > 0) ? window.AshanUI.formatMoney(gross) : pendingBadge;
                    cellTax = pendingBadge;
                    cellPCost = pendingBadge;
                    cellNet = pendingBadge;
                    cellCash = pendingBadge;
                    cellSBasic = (sBasic > 0) ? window.AshanUI.formatMoney(sBasic) : pendingBadge;
                }
            }

            // 汇总累加
            tot_basic_hrs += bHrs;
            tot_sick_days += sSickDays;
            tot_sal_sick += sSalSick;
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
                tot_sal_post += flt(it.salary_post_allowance);
                tot_ss_comp += ssC;
                tot_hf_comp += hfC;

                tbody.append(`
                    <tr>
                        <td class="jz-col-seq">${idx + 1}</td>
                        <td class="jz-col-no"><strong>${esc(it.employee_no)}</strong></td>
                        <td class="jz-col-name"><strong>${esc(it.employee_name)}</strong></td>
                        <td>${esc(format_jizhong_employee_type(it.employee_type))}</td>
                        <td>${esc(jizhong_salary_mode_label(it.salary_mode))}</td>
                        ${formulaTd("jz-money-cell", "base_salary", window.AshanUI.formatMoney(it.base_salary))}
                        ${formulaTd("jz-money-cell", "base_subsidy_standard", window.AshanUI.formatMoney(it.house_rent_allowance))}
                        ${formulaTd("jz-money-cell", "performance_standard", window.AshanUI.formatMoney(it.performance_salary))}
                        ${formulaTd("jz-money-cell", "post_allowance_standard", window.AshanUI.formatMoney(it.post_allowance))}
                        ${formulaTd("jz-money-cell", "meal_unit_price", window.AshanUI.formatMoney(it.meal_unit_price || 15))}
                        ${formulaTd("jz-num-cell", "attendance_days", flt(it.attendance_days || 0).toFixed(2))}
                        ${formulaTd("jz-num-cell", "half_days", flt(it.half_days || 0).toFixed(2))}
                        ${formulaTd("jz-num-cell", "absent_days", flt(it.absent_days || 0).toFixed(2))}
                        ${formulaTd("jz-num-cell", "sick_days", sSickDays > 0 ? (sSickDays.toFixed(2) + ' 天') : '0.00 天')}
                        ${formulaTd("jz-num-cell", "basic_hours", fmtHours(bHrs))}
                        ${formulaTd("jz-num-cell", "overtime_regular_1_5", fmtHours(ot15))}
                        ${formulaTd("jz-num-cell", "overtime_weekend_2_0", fmtHours(ot20))}
                        ${formulaTd("jz-num-cell", "overtime_holiday_3_0", fmtHours(ot30))}
                        ${formulaTd("jz-num-cell", "leave_compensatory_hours", fmtHours(cLeave))}
                        ${formulaTd("jz-num-cell", "meal_count", `${mCount.toFixed(2)} 次`)}
                        ${formulaTd("jz-money-cell", "salary_basic_hours", cellSBasic)}
                        ${formulaTd("jz-money-cell", "salary_sick_leave", window.AshanUI.formatMoney(sSalSick))}
                        ${formulaTd("jz-money-cell", "salary_overtime_1_5", window.AshanUI.formatMoney(sOt15))}
                        ${formulaTd("jz-money-cell", "salary_overtime_2_0", window.AshanUI.formatMoney(sOt20))}
                        ${formulaTd("jz-money-cell", "salary_overtime_3_0", window.AshanUI.formatMoney(sOt30))}
                        ${formulaTd("jz-money-cell", "salary_basic_subsidy", window.AshanUI.formatMoney(sSub))}
                        ${formulaTd("jz-money-cell", "salary_performance", window.AshanUI.formatMoney(sPerf))}
                        ${formulaTd("jz-money-cell", "salary_post_allowance", window.AshanUI.formatMoney(flt(it.salary_post_allowance)))}
                        ${formulaTd("jz-money-cell", "salary_meal_subsidy", window.AshanUI.formatMoney(sMeal))}
                        ${formulaTd("jz-money-cell", "salary_adjustment", window.AshanUI.formatMoney(sAdj))}
                        ${formulaTd("jz-money-cell jz-money-bold", "gross_salary", cellGross)}
                        ${formulaTd("jz-money-cell", "hf_company", window.AshanUI.formatMoney(hfC))}
                        ${formulaTd("jz-money-cell", "ss_company", window.AshanUI.formatMoney(ssC))}
                        ${formulaTd("jz-money-cell jz-money-cost", "company_cost", window.AshanUI.formatMoney(cCost))}
                        ${formulaTd("jz-money-cell", "hf_person", window.AshanUI.formatMoney(hfP))}
                        ${formulaTd("jz-money-cell", "ss_person", window.AshanUI.formatMoney(ssP))}
                        ${formulaTd("jz-money-cell", "tax_amount", cellTax)}
                        ${formulaTd("jz-money-cell", "person_cost", cellPCost)}
                        ${formulaTd("jz-money-cell jz-money-primary", "net_salary", cellNet)}
                        ${formulaTd("jz-money-cell jz-money-cash", "cash_pay", cellCash)}
                    </tr>
                `);
            } else {
                tbody.append(`
                    <tr>
                        <td class="jz-col-seq">${idx + 1}</td>
                        <td class="jz-col-no"><strong>${esc(it.employee_no)}</strong></td>
                        <td class="jz-col-name"><strong>${esc(it.employee_name)}</strong></td>
                        <td>${esc(format_jizhong_employee_type(it.employee_type))}</td>
                        <td>${esc(jizhong_salary_mode_label(it.salary_mode))}</td>
                        ${formulaTd("jz-money-cell", "base_salary", window.AshanUI.formatMoney(it.base_salary))}
                        ${formulaTd("jz-num-cell", "basic_hours", fmtHours(bHrs))}
                        ${formulaTd("jz-num-cell", "sick_days", sSickDays > 0 ? (sSickDays.toFixed(2) + ' 天') : '0.00 天')}
                        ${formulaTd("jz-money-cell", "salary_sick_leave", sSalSick > 0 ? window.AshanUI.formatMoney(sSalSick) : window.AshanUI.formatMoney(0))}
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(otPay)}</td>
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(allowPerf)}</td>
                        ${formulaTd("jz-money-cell", "salary_meal_subsidy", window.AshanUI.formatMoney(sMeal))}
                        ${formulaTd("jz-money-cell", "salary_adjustment", window.AshanUI.formatMoney(sAdj))}
                        ${formulaTd("jz-money-cell jz-money-bold", "gross_salary", cellGross)}
                        ${formulaTd("jz-money-cell", "ss_person", window.AshanUI.formatMoney(ssP))}
                        ${formulaTd("jz-money-cell", "hf_person", window.AshanUI.formatMoney(hfP))}
                        <td class="jz-money-cell">${cellTax}</td>
                        ${formulaTd("jz-money-cell", "person_cost", cellPCost)}
                        ${formulaTd("jz-money-cell jz-money-primary", "net_salary", cellNet)}
                        ${formulaTd("jz-money-cell jz-money-cash", "cash_pay", cellCash)}
                        <td class="jz-money-cell">${window.AshanUI.formatMoney(ssC + hfC)}</td>
                        ${formulaTd("jz-money-cell jz-money-cost", "company_cost", window.AshanUI.formatMoney(cCost))}
                    </tr>
                `);
            }
        });

        // 底部合计行：展示全部人员完整薪酬、扣税与实发总额
        let footGross = window.AshanUI.formatMoney(tot_gross);
        let footTax = window.AshanUI.formatMoney(tot_tax);
        let footPCost = window.AshanUI.formatMoney(tot_pers_ded);
        let footNet = window.AshanUI.formatMoney(tot_net);
        let footCash = window.AshanUI.formatMoney(tot_cash);

        if (isDetail) {
            tfoot.html(`
                <tr>
                    <td colspan="3" class="jz-col-foot-label">合计 · 本表 ${filtered.length} 人</td>
                    <td>-</td>
                    <td>-</td>
                    <td class="jz-money-cell">-</td>
                    <td class="jz-money-cell">-</td>
                    <td class="jz-money-cell">-</td>
                    <td class="jz-money-cell">-</td>
                    <td class="jz-money-cell">-</td>
                    <td class="jz-num-cell">-</td>
                    <td class="jz-num-cell">-</td>
                    <td class="jz-num-cell">-</td>
                    <td class="jz-num-cell">${tot_sick_days > 0 ? (tot_sick_days.toFixed(1) + ' 天') : '-'}</td>
                    <td class="jz-num-cell">${fmtHours(tot_basic_hrs)}</td>
                    <td class="jz-num-cell">${fmtHours(tot_ot15_hrs)}</td>
                    <td class="jz-num-cell">${fmtHours(tot_ot20_hrs)}</td>
                    <td class="jz-num-cell">${fmtHours(tot_ot30_hrs)}</td>
                    <td class="jz-num-cell">${fmtHours(tot_comp_hrs)}</td>
                    <td class="jz-num-cell">${tot_meals} 次</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_sal_basic)}</td>
                    <td class="jz-money-cell">${tot_sal_sick > 0 ? window.AshanUI.formatMoney(tot_sal_sick) : '-'}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_sal_ot15)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_sal_ot20)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_sal_ot30)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_sal_sub)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_sal_perf)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_sal_post)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_sal_meal)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_sal_adj)}</td>
                    <td class="jz-money-cell jz-money-bold">${footGross}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_hf_comp)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_ss_comp)}</td>
                    <td class="jz-money-cell jz-money-cost">${window.AshanUI.formatMoney(tot_comp_cost)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_hf_pers)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(tot_ss_pers)}</td>
                    <td class="jz-money-cell">${footTax}</td>
                    <td class="jz-money-cell">${footPCost}</td>
                    <td class="jz-money-cell jz-money-primary">${footNet}</td>
                    <td class="jz-money-cell jz-money-cash">${footCash}</td>
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
                    <td class="jz-num-cell">${tot_sick_days > 0 ? (tot_sick_days.toFixed(1) + ' 天') : '-'}</td>
                    <td class="jz-money-cell">${tot_sal_sick > 0 ? window.AshanUI.formatMoney(tot_sal_sick) : '-'}</td>
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

    function export_jizhong_excel_action(sheet_type) {
        frappe.show_alert({ message: '正在生成 Excel 报表，请稍候...', indicator: 'blue' });
        frappe.call({
            method: 'ashan_cn_procurement.services.payroll_settlement_service.export_qifu_payroll_excel',
            args: {
                company: COMPANY,
                period_month: current_month,
                sheet_type: sheet_type
            },
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
                    link.href = URL.createObjectURL(blob);
                    link.download = fname;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    frappe.show_alert({ message: `Excel 导出成功: ${fname}`, indicator: 'green' });
                } else {
                    frappe.msgprint((r.message && r.message.message) || '导出 Excel 失败，请检查数据。');
                }
            }
        });
    }

    $('#btn-jz-export-payroll').on('click', function() {
        if (!payroll_cache.length) {
            frappe.msgprint('本月尚未生成工资表，请先完成薪酬测算。');
            return;
        }
        export_jizhong_excel_action('jizhong_payroll');
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

    // 顶部月度核定封账与反审核解锁
    $(wrapper).on('click', '#btn-jz-header-lock', function() {
        if (workflow_state.is_locked) {
            handle_monthly_unlock();
        } else if (workflow_state.can_lock) {
            handle_monthly_lock();
        } else {
            frappe.msgprint({
                title: '前置步骤尚未全部确认',
                indicator: 'orange',
                message: '请先完成上方显示为黄色的前置步骤确认（员工档案、考勤、社保、公积金全部标绿），系统自动核定工资与个税后即可封账。'
            });
        }
    });

    function handle_monthly_lock() {
        const $button = $('#btn-jz-header-lock');
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
    }

    function handle_monthly_unlock() {
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
            }
        });
        configure_jizhong_dialog_close_actions(dlg).show();
    }

    // 2. 加载考勤工时管理
    let attendance_cache = [];
    let attendance_calendar_days = [];

    function get_attendance_daily_records(employee) {
        if (Array.isArray(employee && employee.daily_records)) {
            return employee.daily_records;
        }
        if (!employee || !employee.daily_records_json) return [];
        try {
            const parsed = typeof employee.daily_records_json === 'string'
                ? JSON.parse(employee.daily_records_json)
                : employee.daily_records_json;
            if (Array.isArray(parsed)) return parsed;
            if (parsed && Array.isArray(parsed.days)) return parsed.days;
            return [];
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
                let coverageText = `已匹配 ${matchedCount} / ${expectedCount} 人`;
                if (excludedCount > 0) {
                    coverageText += ` ｜ 免考勤 ${excludedCount} 人 (固定薪资)`;
                }
                $('#jz-att-coverage').text(coverageText);
                $('#jz-att-sheet-title').text(`${format_payment_month_title(current_month)}考勤与工时明细`);
                $('#jz-att-sheet-meta').text(`考勤 ${matchedCount} 人`);

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

                const attStep = get_workflow_step('attendance');
                const isAttConfirmed = Boolean(attStep && attStep.is_confirmed);
                const isSettlementLocked = Boolean(workflow_state?.is_locked || (current_payroll_settlement && current_payroll_settlement.locked));
                if (records.length === 0 || isAttConfirmed || isSettlementLocked) {
                    $('#btn-jz-clear-attendance').prop('disabled', true).addClass('disabled');
                    if (isAttConfirmed) {
                        $('#btn-jz-clear-attendance').attr('title', '当前考勤与工时已核定确认，严禁清空！如需清空请先取消【考勤与工时】确认。');
                    }
                } else {
                    $('#btn-jz-clear-attendance').prop('disabled', false).removeClass('disabled').attr('title', '一键清空本月考勤工时记录');
                }

                render_raw_attendance_table();
                render_attendance_table();
                render_sick_leave_confirm_box();
            },
            '正在读取本月考勤底册…'
        );
    }


    // 渲染病假确认与人工核定行
    // 渲染病假确认与人工核定行 (支持在确认本表前随时多次修改认定天数)
    function render_sick_leave_confirm_box() {
        const $box = $('#jz-sick-leave-confirm-box');
        $box.empty();

        if (!attendance_cache || attendance_cache.length === 0) {
            $box.hide();
            return;
        }

        const sickItems = attendance_cache.filter(it => flt(it.sick_leave_days) > 0);
        if (sickItems.length === 0) {
            $box.hide();
            return;
        }

        $box.show();
        const attStep = get_workflow_step('attendance');
        const isAttConfirmed = Boolean(attStep && attStep.is_confirmed);
        const isSettlementLocked = Boolean(workflow_state?.is_locked || (current_payroll_settlement && current_payroll_settlement.locked));
        const isDisabled = isAttConfirmed || isSettlementLocked;
        const disabledAttr = isDisabled ? 'disabled' : '';
        const disabledTitle = isAttConfirmed ? 'title="考勤与工时已确认锁定，如需调整病假请先取消考勤确认"' : (isSettlementLocked ? 'title="当月已核定封账，只读保护"' : '');

        let pendingCount = 0;
        let confirmedCount = 0;
        let rejectedCount = 0;

        sickItems.forEach(it => {
            const st = it.sick_leave_status || '待确认';
            if (st === '已认定') confirmedCount++;
            else if (st === '不认定') rejectedCount++;
            else pendingCount++;
        });

        const statusSummary = pendingCount > 0
            ? `<span class="jz-sick-badge jz-sick-badge-pending">${pendingCount} 人需人工核定</span>`
            : `<span class="jz-sick-badge jz-sick-badge-confirmed">全部已核定 (${confirmedCount}人认定 / ${rejectedCount}人不认定)</span>`;

        let html = `
            <div class="jz-sick-panel">
                <div class="jz-sick-panel-header">
                    <div class="jz-sick-panel-title-wrap">
                        <span class="jz-sick-panel-title">病假确认</span>
                        <span class="jz-sick-panel-hint">考勤打卡识别到 ${sickItems.length} 人有病假记录；默认不计发病假工资（按个人事假处理），确认本表前可随时核定与修改认定天数</span>
                    </div>
                    <div class="jz-sick-panel-summary">
                        ${statusSummary}
                    </div>
                </div>
                <div class="jz-sick-list">
        `;

        sickItems.forEach(it => {
            const st = it.sick_leave_status || '待确认';
            const actualDays = flt(it.sick_leave_days);
            const confDays = flt(it.confirmed_sick_leave_days || 0);
            const remark = esc(it.sick_leave_remark || '');

            let badgeHtml = '';
            let descHtml = '';
            let confirmBtnLabel = '认定病假';
            let confirmBtnTitle = 'title="点击核定认定病假天数"';
            let rejectBtnDisabled = disabledAttr;
            let rejectBtnTitle = disabledTitle;

            if (st === '已认定') {
                confirmBtnLabel = '修改认定天数';
                confirmBtnTitle = isDisabled ? disabledTitle : 'title="尚未确认本表，可随时修改病假认定天数"';
                badgeHtml = `<span class="jz-sick-badge jz-sick-badge-confirmed">已认定</span>`;
                descHtml = `<span class="jz-sick-status-desc jz-text-success"><strong>${esc(it.employee_name)}</strong> 考勤病假 ${actualDays} 天，已认定 <strong>${confDays}</strong> 天（享受80%病假工资；未确认本表前可随时修改天数）${remark ? `<span class="jz-sick-remark-tag">${remark}</span>` : ''}</span>`;
            } else if (st === '不认定') {
                confirmBtnLabel = '重新认定病假';
                confirmBtnTitle = isDisabled ? disabledTitle : 'title="重新审核并认定病假天数"';
                rejectBtnDisabled = 'disabled';
                rejectBtnTitle = 'title="当前已标记为不认定病假"';
                badgeHtml = `<span class="jz-sick-badge jz-sick-badge-rejected">不认定</span>`;
                descHtml = `<span class="jz-sick-status-desc jz-text-muted"><strong>${esc(it.employee_name)}</strong> 考勤病假 ${actualDays} 天，不认定病假（按个人请假事假处理；未确认本表前可随时重新认定）${remark ? `<span class="jz-sick-remark-tag">${remark}</span>` : ''}</span>`;
            } else {
                confirmBtnLabel = '认定病假';
                confirmBtnTitle = isDisabled ? disabledTitle : 'title="人工审核认定病假天数"';
                badgeHtml = `<span class="jz-sick-badge jz-sick-badge-pending">待确认</span>`;
                descHtml = `<span class="jz-sick-status-desc jz-text-warning"><strong>${esc(it.employee_name)}</strong> 病假 ${actualDays} 天需确认（默认按个人请假处理，不计算病假工资）</span>`;
            }

            html += `
                <div class="jz-sick-item" data-emp-no="${esc(it.employee_no)}">
                    <div class="jz-sick-item-left">
                        <span class="jz-sick-emp-info"><strong>${esc(it.employee_name)}</strong> <span class="jz-text-muted">(${esc(it.employee_no)})</span></span>
                        ${badgeHtml}
                        ${descHtml}
                    </div>
                    <div class="jz-sick-item-right">
                        <button class="btn btn-xs btn-primary jz-btn-blue jz-btn-sick-confirm" 
                                data-emp-no="${esc(it.employee_no)}" 
                                data-emp-name="${esc(it.employee_name)}" 
                                data-actual-days="${actualDays}" 
                                data-conf-days="${confDays || actualDays}" 
                                data-status="${st}"
                                data-remark="${remark}"
                                ${disabledAttr} ${confirmBtnTitle}>${confirmBtnLabel}</button>
                        <button class="btn btn-xs btn-default jz-btn-danger-outline jz-btn-sick-reject" 
                                data-emp-no="${esc(it.employee_no)}" 
                                data-emp-name="${esc(it.employee_name)}" 
                                data-actual-days="${actualDays}"
                                data-status="${st}"
                                ${rejectBtnDisabled} ${rejectBtnTitle}>不认定病假</button>
                    </div>
                </div>
            `;
        });

        html += `
                </div>
            </div>
        `;

        $box.html(html);
    }

    // 绑定认定病假与修改认定天数交互 (支持随时反复修改)
    $(document).off('click', '.jz-btn-sick-confirm').on('click', '.jz-btn-sick-confirm', function(e) {
        e.preventDefault();
        const empNo = String($(this).attr('data-emp-no') || $(this).data('emp-no'));
        const it = (attendance_cache || []).find(x => x.employee_no === empNo);
        const empName = it ? it.employee_name : String($(this).attr('data-emp-name') || $(this).data('emp-name'));
        const actualDays = it ? flt(it.sick_leave_days) : flt($(this).attr('data-actual-days'));
        const currentConf = it ? (flt(it.confirmed_sick_leave_days) > 0 ? flt(it.confirmed_sick_leave_days) : actualDays) : actualDays;
        const currentRemark = it ? (it.sick_leave_remark || '') : (String($(this).attr('data-remark') || ''));
        const currentStatus = it ? (it.sick_leave_status || '待确认') : '待确认';
        const isModify = currentStatus === '已认定';

        const dialogTitle = isModify ? `修改病假认定天数 - ${empName} (${empNo})` : `病假认定 - ${empName} (${empNo})`;
        const actionLabel = isModify ? '保存修改' : '确认认定';
        const tipText = isModify
            ? `当前已认定 <strong>${currentConf} 天</strong> ｜ 考勤打卡上限 <strong>${actualDays} 天</strong>。<br>尚未确认【考勤与工时】本表，您可以随时修改认定天数（1 ~ ${actualDays} 天）。保存后立即生效并联动薪酬。`
            : `说明：认定病假后，认定天数按 (基本工资 ÷ 当月法定工作日) × 80% 计发病假工资。未认定部分按个人事假处理。尚未确认本表前，认定后仍可随时修改天数。`;

        const d = window.AshanUI.createDialog({
            title: dialogTitle,
            fields: [
                {
                    fieldname: 'info_section',
                    fieldtype: 'HTML',
                    options: `
                        <div class="jz-modal-info-box">
                            <div><strong>员工姓名：</strong>${esc(empName)} ｜ <strong>工号：</strong>${esc(empNo)}</div>
                            <div class="mt-1"><strong>考勤实际打卡病假：</strong><span class="jz-text-warning font-weight-bold">${actualDays} 天</span></div>
                            <div class="jz-modal-tip mt-2">${tipText}</div>
                        </div>
                    `
                },
                {
                    label: isModify ? '修改认定病假天数' : '认定病假天数',
                    fieldname: 'confirmed_days',
                    fieldtype: 'Float',
                    default: currentConf,
                    reqd: 1,
                    description: `请输入认定天数（不可大于考勤实际打卡天数 ${actualDays} 天，且必须大于 0）`
                },
                {
                    label: '认定说明 / 核验凭据（选填）',
                    fieldname: 'remark',
                    fieldtype: 'Data',
                    default: currentRemark,
                    placeholder: '例如：病假条及医院诊断证明已核验通过'
                }
            ],
            primary_action_label: actionLabel,
            primary_action: function(vals) {
                const days = flt(vals.confirmed_days);
                if (isNaN(days) || days <= 0) {
                    frappe.msgprint({
                        title: '输入有误',
                        indicator: 'orange',
                        message: '认定病假天数必须大于 0！如无需认定病假，请直接点击“不认定病假”按钮。'
                    });
                    return;
                }
                if (days > actualDays) {
                    frappe.msgprint({
                        title: '超出实际上限',
                        indicator: 'orange',
                        message: `认定病假天数（${days} 天）不能大于考勤实际打卡天数（${actualDays} 天）！`
                    });
                    return;
                }

                const payload = {
                    action: 'confirm_sick_leave',
                    company: COMPANY,
                    period_month: current_month,
                    employee_no: empNo,
                    status: '已认定',
                    confirmed_days: days,
                    remark: vals.remark || ''
                };

                frappe.call({
                    method: 'ashan_cn_procurement.services.jizhong_payroll_service.save_jizhong_employee_profile',
                    args: { data: payload },
                    freeze: true,
                    freeze_message: isModify ? '正在保存修改…' : '正在保存病假认定…',
                    callback: function(r) {
                        if (r.exc || r.exception) return;
                        d.hide();
                        frappe.show_alert({
                            message: isModify ? `已成功将【${empName}】认定病假天数修改为 ${days} 天` : `已成功认定【${empName}】病假 ${days} 天`,
                            indicator: 'green'
                        });
                        const targetItem = (attendance_cache || []).find(x => x.employee_no === empNo);
                        if (targetItem) {
                            targetItem.confirmed_sick_leave_days = days;
                            targetItem.sick_leave_status = '已认定';
                            targetItem.sick_leave_remark = vals.remark || '';
                        }
                        render_sick_leave_confirm_box();
                        render_attendance_table();
                        if ($('.jz-tab-btn[data-tab="payroll"]').hasClass('active') || (payroll_cache && payroll_cache.length > 0)) {
                            load_payroll_data();
                        }
                    }
                });
            }
        });
        d.show();
    });

    $(document).off('click', '.jz-btn-sick-reject').on('click', '.jz-btn-sick-reject', function(e) {
        e.preventDefault();
        const empNo = String($(this).attr('data-emp-no') || $(this).data('emp-no'));
        const it = (attendance_cache || []).find(x => x.employee_no === empNo);
        const empName = it ? it.employee_name : String($(this).attr('data-emp-name') || $(this).data('emp-name'));
        const actualDays = it ? flt(it.sick_leave_days) : flt($(this).attr('data-actual-days'));

        frappe.confirm(
            `确认对【${esc(empName)}】考勤打卡中的 <strong>${actualDays} 天</strong>病假不予认定？<br><br><span class="text-danger">注意：不认定后，在工资核算中不计算病假工资，全部按照个人请假（事假缺勤）扣除工资。</span>`,
            function() {
                const payload = {
                    action: 'confirm_sick_leave',
                    company: COMPANY,
                    period_month: current_month,
                    employee_no: empNo,
                    status: '不认定',
                    confirmed_days: 0.0,
                    remark: '人工审核不予认定，按个人事假处理'
                };

                frappe.call({
                    method: 'ashan_cn_procurement.services.jizhong_payroll_service.save_jizhong_employee_profile',
                    args: { data: payload },
                    freeze: true,
                    freeze_message: '正在更新病假状态…',
                    callback: function(r) {
                        if (r.exc || r.exception) return;
                        frappe.show_alert({
                            message: `已标记【${empName}】病假为不予认定（按个人事假处理）`,
                            indicator: 'orange'
                        });
                        const targetItem = (attendance_cache || []).find(x => x.employee_no === empNo);
                        if (targetItem) {
                            targetItem.confirmed_sick_leave_days = 0.0;
                            targetItem.sick_leave_status = '不认定';
                            targetItem.sick_leave_remark = '人工审核不予认定，按个人事假处理';
                        }
                        render_sick_leave_confirm_box();
                        render_attendance_table();
                        if ($('.jz-tab-btn[data-tab="payroll"]').hasClass('active') || (payroll_cache && payroll_cache.length > 0)) {
                            load_payroll_data();
                        }
                    }
                });
            }
        );
    });

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
            if (it.sick_leave_days && flt(it.sick_leave_days) > 0) {
                const actualSick = flt(it.sick_leave_days);
                const confSick = flt(it.confirmed_sick_leave_days || 0);
                const sickSt = it.sick_leave_status || '待确认';
                let sickLabel = `病假 ${actualSick}天`;
                if (sickSt === '已认定') {
                    sickLabel += ` (已认定${confSick}天)`;
                } else if (sickSt === '不认定') {
                    sickLabel += ` (不认定/事假)`;
                } else {
                    sickLabel += ` (待确认/暂按事假)`;
                }
                remark_counts['病'] = sickLabel;
            }
            let rText = [];
            if (rest_days > 0) rText.push(`公休 ${rest_days}天`);
            for (const [rm, count] of Object.entries(remark_counts)) {
                if (rm === '病') {
                    rText.push(count);
                } else {
                    let label = rm;
                    if (rm === '事') label = '事假';
                    rText.push(`${label} ${count}天`);
                }
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
        const empStep = get_workflow_step('employees');
        if (!empStep || !empStep.is_confirmed) {
            frappe.msgprint({
                title: '前置步骤未完成',
                indicator: 'orange',
                message: '请先完成并确认【员工档案】，方可上传考勤与工时数据！'
            });
            return;
        }
        const attStep = get_workflow_step('attendance');
        const isAttConfirmed = Boolean(attStep && attStep.is_confirmed);
        const isSettlementLocked = Boolean(workflow_state?.is_locked || (current_payroll_settlement && current_payroll_settlement.locked));
        if (isAttConfirmed || isSettlementLocked) {
            frappe.msgprint({
                title: '操作被拦截',
                indicator: 'orange',
                message: '当前考勤与工时已核定确认，严禁重新上传！如需重新上传请先取消【考勤与工时】的确认。'
            });
            return;
        }
        let selected_file = null;

        const d = window.AshanUI.createDialog({
            title: '上传吉众月度考勤表',
            fields: [
                {
                    label: '考勤所属月份',
                    fieldname: 'period_month',
                    fieldtype: 'Data',
                    default: current_month,
                    read_only: 1,
                    reqd: 1,
                    description: '格式如 2026-07 或 2026-06（根据本月核定账期自动锁定，防误操作）'
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
                    const filePeriodText = res.file_period_text || `${targetPeriod.replace('-', '年')}月`;
                    const curPeriodText = res.current_period_text || `${targetPeriod.replace('-', '年')}月`;
                    const verifyStatus = res.verification_status || '通过';

                    frappe.msgprint({
                        title: '考勤解析成功',
                        indicator: 'green',
                        message: `
                            <div class="jz-verify-msg-box">
                                <div class="jz-verify-header"><strong>文件考勤日期：</strong>${filePeriodText}，<strong>当前核定月：</strong>${curPeriodText}，<span class="text-success font-weight-bold">${verifyStatus}</span></div>
                                <div class="jz-verify-body">
                                    <div>共识别入库 <strong>${res.employee_count}</strong> 人，基本出勤工时 <strong>${res.total_work_hours || res.total_regular_hours || 0}h</strong>，加班 <strong>${flt(res.total_ot_1_5) + flt(res.total_ot_2_0) + flt(res.total_ot_3_0)}h</strong>，餐补 <strong>${res.total_meals} 次</strong>。</div>
                                    ${flt(res.total_sick_days) > 0 ? `<div class="text-warning mt-1">识别到病假打卡记录：共 ${flt(res.total_sick_days)} 天（默认按个人事假处理，请在考勤表上方完成人工核定）。</div>` : ''}
                                </div>
                            </div>
                        `
                    });
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

            // 考勤所属月份严格锁定为当前工作台核定月份
            d.set_value('period_month', current_month);

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

                const refreshRetirementPreview = () => {
            const vals = {
                company: COMPANY,
                id_card: String(d.get_value('id_card') || '').trim(),
                birth_date: d.get_value('birth_date') || '',
                gender: d.get_value('gender') || '',
                retirement_category: d.get_value('retirement_category') || '',
                original_retirement_age: d.get_value('original_retirement_age') || 0,
                delayed_retirement_age: d.get_value('delayed_retirement_age') || 0,
                period_month: current_month
            };
            frappe.call({
                method: 'ashan_cn_procurement.services.employee_salary_service.calculate_employee_age_and_retirement',
                args: vals,
                callback: function(r) {
                    const x = r.message || {};
                    if (x.birth_date && d.get_value('certificate_type') === '居民身份证') d.set_value('birth_date', x.birth_date);
                    if (x.gender && d.get_value('certificate_type') === '居民身份证') d.set_value('gender', x.gender);
                    if (x.current_age !== undefined) d.set_value('current_age', x.current_age || 0);
                    if (x.retirement_category) d.set_value('retirement_category', x.retirement_category);
                    if (x.original_retirement_age !== undefined) d.set_value('original_retirement_age', x.original_retirement_age || 0);
                    if (x.delayed_retirement_age !== undefined) d.set_value('delayed_retirement_age', x.delayed_retirement_age || 0);
                    if (x.original_retirement_period) d.set_value('original_retirement_period', x.original_retirement_period);
                    if (x.delayed_retirement_period) d.set_value('delayed_retirement_period', x.delayed_retirement_period);

                    const original = x.original_retirement_age_str || (x.original_retirement_age ? `${x.original_retirement_age}岁` : '待确认');
                    const delayed = x.delayed_retirement_age_str || (x.delayed_retirement_age ? `${x.delayed_retirement_age}岁` : '待确认');
                    const warn = x.primary_retirement_warning || '正常';
                    const isRehireEmp = ['退休返聘', '返聘工', '其他-返聘工', '退休返聘人员'].includes(d.get_value('employee_type') || '');

                    let previewContent = '';
                    if (isRehireEmp) {
                        previewContent = `
                        <div class="jz-retire-preview-box">
                            <div class="jz-retire-preview-row">
                                <span class="jz-status-badge jz-retire-badge-retired">已达龄/返聘</span>
                                <strong>已退休人员</strong>
                                <span>退休年月：<strong>${esc(x.original_retire_period || '未知')}</strong></span>
                            </div>
                            <div class="jz-retire-preview-note">该员工用工性质为返聘类员工，已按法定年龄完成退休，无需再行推导延迟退休政策。</div>
                        </div>`;
                    } else {
                        previewContent = `
                        <div class="jz-retire-preview-box">
                            <div class="jz-retire-preview-grid">
                                <div><span class="jz-text-muted">退休年龄(原)</span><br><strong>${original}</strong><br><span class="jz-text-muted">${esc(x.original_retire_period || '-')}</span></div>
                                <div><span class="jz-text-muted">退休年龄(延)</span><br><strong>${delayed}</strong><br><span class="jz-text-muted">${esc(x.delayed_retire_period || '-')}</span></div>
                                <div><span class="jz-text-muted">最早弹性退休</span><br><strong>${esc(x.earliest_flexible_retire_period || '-')}</strong><br><span class="jz-text-muted">最迟延后至 ${esc(x.latest_flexible_retire_period || '-')}</span></div>
                                <div><span class="jz-text-muted">当前状态</span><br><strong>${esc(warn)}</strong><br><span class="jz-text-muted">按 ${current_month} 账期</span></div>
                            </div>
                            <div class="jz-retire-preview-note">政策引擎 ${esc(x.policy_version || 'CN-RETIRE-2025-V1')}。原退休年龄和延迟法定退休年龄分别计算，距到龄3个月内预警。</div>
                        </div>`;
                    }
                    if (d.fields_dict.retirement_preview) {
                        d.fields_dict.retirement_preview.$wrapper.html(previewContent);
                    }
                }
            });
        };

        configure_jizhong_dialog_close_actions(d).show();
        if (read_only) {
            d.get_primary_btn().hide();
            d.$wrapper.find('.modal-title').text(`查看员工薪资档案 · ${emp_data.employee_name || ''} (${emp_data.employee_no || ''}) [已确认只读]`);
            Object.values(d.fields_dict || {}).forEach(f => {
                if (f && f.df) f.df.read_only = 1;
                if (f && f.$input) f.$input.prop('disabled', true);
            });
        }
        setTimeout(refreshRetirementPreview, 100);
        d.fields_dict.btn_parse_id_card?.$input.on('click', refreshRetirementPreview);
        d.fields_dict.id_card?.$input.on('change', refreshRetirementPreview);
        d.fields_dict.birth_date?.$input.on('change', refreshRetirementPreview);
        d.fields_dict.gender?.$input.on('change', refreshRetirementPreview);
        d.fields_dict.employee_type?.$input.on('change', refreshRetirementPreview);
        d.fields_dict.retirement_category?.$input.on('change', refreshRetirementPreview);
    });

    $('#btn-jz-download-attendance-file').on('click', function() {
        const url = $(this).attr('data-url');
        if (url) window.open(url);
    });

    // 一键清空当月考勤记录
    $('#btn-jz-clear-attendance').on('click', function() {
        const empStep = get_workflow_step('employees');
        if (!empStep || !empStep.is_confirmed) {
            frappe.msgprint({
                title: '前置步骤未完成',
                indicator: 'orange',
                message: '请先完成并确认【员工档案】，方可清空考勤与工时数据！'
            });
            return;
        }
        const attStep = get_workflow_step('attendance');
        const isAttConfirmed = Boolean(attStep && attStep.is_confirmed);
        const isSettlementLocked = Boolean(workflow_state?.is_locked || (current_payroll_settlement && current_payroll_settlement.locked));
        if (isAttConfirmed || isSettlementLocked) {
            frappe.msgprint({
                title: '操作被拦截',
                indicator: 'orange',
                message: '当前考勤与工时已核定确认，严禁清空！如需重新清空请先取消【考勤与工时】的确认。'
            });
            return;
        }
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
                    days = get_attendance_daily_records(attendance_cache[i]);
                    if (days && days.length > 0) break;
                } catch(e) {}
            }
        }
        let csv = '\uFEFF序号,工号,姓名,打卡项目,' + days.map(d => `${d.day}日(${d.nature || ''})`).join(',') + ',正班工时,平日加班,周末加班,节日加班,倒休工时,餐补次数\n';
        attendance_cache.forEach((emp, idx) => {
            let empDays = get_attendance_daily_records(emp);
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
                const isCashLocked = Boolean(current_payroll_settlement && current_payroll_settlement.locked);
                const isCashConfirmed = Boolean(get_workflow_step('cash_bills')?.is_confirmed);
                let cashStatusTag = '';
                if (isCashLocked) {
                    cashStatusTag = ' ｜ <span class="jz-text-success"><strong>已核定封账</strong></span>';
                } else if (isCashConfirmed) {
                    cashStatusTag = ' ｜ <span class="jz-text-success"><strong>现金发放已核对确认</strong></span>';
                } else {
                    cashStatusTag = ' ｜ <span class="text-muted">（数据与工资核定同步生成，核对现金总盘与配钞无误后点击右侧【确认现金发放】）</span>';
                }
                let cashReg = 0, cashOth = 0;
                items.forEach(it => {
                    const t = String(it.employee_type || '').trim();
                    const c = flt(it.cash_pay || Math.ceil(flt(it.net_salary || 0)));
                    if (t.includes('其他')) cashOth += c;
                    else cashReg += c;
                });
                $('#stat-cash-emp-count').text(`${items.length} 人`);
                $('#stat-cash-total-bills').text(`${totalBills} 张`);
                $('#jz-cash-sheet-meta').text(`实发 ${items.length} 人 ｜ 配钞 ${totalBills} 张`);
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
        export_jizhong_excel_action('jizhong_cash_distribution');
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
            if (c.k === "target_salary") {
                const isPost = Boolean(r.is_post_tax || (r.salary_mode && String(r.salary_mode).includes('税后')));
                const tag = isPost ? '<span class="jz-tag-post-tax">税后</span>' : '<span class="jz-tag-pre-tax">税前</span>';
                const val = isPost ? (r.target_salary || r.net_salary || 0) : (r.target_salary || r.gross_salary || 0);
                return `${window.AshanUI.formatMoney(val)} ${tag}`;
            }
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
            const isLocked = Boolean(current_payroll_settlement && current_payroll_settlement.locked);
            const isConfirmed = Boolean(get_workflow_step('tax')?.is_confirmed);
            let taxStatusTag = '';
            if (isLocked) {
                taxStatusTag = ' ｜ <span class="jz-text-success"><strong>已核定封账</strong></span>';
            } else if (isConfirmed) {
                taxStatusTag = ' ｜ <span class="jz-text-success"><strong>个税台账已核对确认</strong></span>';
            } else {
                taxStatusTag = ' ｜ <span class="text-muted">（数据与工资核定同步生成，核对68列无误后点击右侧【确认个人所得税台账】）</span>';
            }
            $('#jz-tax-sheet-meta').text(`计税 ${rows.length} 人`);
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

        const validPolicies = (cached_employee_type_policies && cached_employee_type_policies.length)
            ? cached_employee_type_policies.map(p => p.employee_type)
            : ['正式工', '返聘工', '临时工', '其他-返聘工', '其他-正式工'];

        (employees || []).forEach(it => {
            const empNo = it.employee_no || "";
            const empName = it.employee_name || "未命名";
            const empErrors = {};
            const etype = (it.employee_type || "").trim();

            if (!etype || !validPolicies.includes(etype)) {
                empErrors.employee_type = `用工性质【${etype || '未选择'}】已在规则表中被删除或停用`;
                issueList.push(`工号 ${empNo} (${empName}): 用工性质【${etype || '未选择'}】已在规则表中删除，请先修改！`);
            }
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

    const EMPLOYEE_TABLE_COLSPAN = 31;

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
        { field: 'salary_adjustment', label: '工资调整', type: 'Currency', unit: '元 / 月', description: '正数为增加工资，负数为扣除工资。税前工资算入税前，税后工资算入税后。' },
        { field: 'fixed_salary', label: '固定工资', type: 'Currency', unit: '元 / 月' },

        // 2. 计薪方式与用工性质
        { field: 'salary_mode', label: '计薪方式', type: 'Select', options: ['税前动态工资', '税前固定工资', '税后动态工资', '税后固定工资'], description: '计薪方式直接影响算薪引擎的倒推逻辑（动态计时 vs 1:1 VBA 净薪倒推）。' },
        { field: 'employee_type', label: '用工性质', type: 'Select', options: ['正式工', '返聘工', '其他-返聘工', '其他-正式工', '临时工', '本月离职'], description: '用工性质用于法定分类汇总与社保公积金统筹参与判定。' },
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
            $btnAdjust.removeClass('jz-hidden')
                .prop('disabled', false)
                .removeClass('disabled btn-primary jz-btn-active-selection')
                .addClass('btn-default')
                .attr('title', '调整已选员工薪酬参数（请先在表格左侧勾选人员）');

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
            frappe.msgprint('请先在表格左侧勾选需要调整薪酬参数的人员（可勾选单人或多人批量调整）。');
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
                    reqd: 1,
                    onchange() {
                        sync_dialog_parameter_field();
                    }
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
                    if (newVal < 0 && paramField !== 'salary_adjustment') {
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

        function render_employee_retirement_badge(emp) {
        const warn = emp.primary_retirement_warning || '正常';
        if (['已到法定退休年龄', '已到龄', '已达原龄'].includes(warn)) {
            return `<span class="jz-status-badge jz-retire-badge-retired">${esc(warn)}</span>`;
        }
        if (warn.includes('预警') || warn.includes('临退')) {
            return `<span class="jz-status-badge jz-retire-badge-warn">${esc(warn)}</span>`;
        }
        return `<span class="jz-status-badge jz-retire-badge-normal">正常</span>`;
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
        const otherEmps = employees_cache.filter(e => e.employment_status !== '离职' && is_jizhong_other_type(e.employee_type)).length;
        const rehireEmps = employees_cache.filter(e => e.employment_status !== '离职' && !is_jizhong_other_type(e.employee_type) && ['返聘工', '退休返聘', '退休返聘人员'].includes(e.employee_type || '')).length;
        const regEmps = employees_cache.filter(e => e.employment_status !== '离职' && !is_jizhong_other_type(e.employee_type) && (e.employee_type || '正式工') === '正式工').length;
        $('#jz-emp-sheet-title').text(`${format_payment_month_title(current_month)}员工档案底册`);

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
            if (typeFilter === 'regular') return !is_jizhong_other_type(it.employee_type) && employee_category(it.employee_type, it.employment_status) === '正式工';
            if (typeFilter === 'other') return is_jizhong_other_type(it.employee_type);
            return true;
        });

        const empBadgeText = filtered.length === totalEmps ? `共 ${totalEmps} 人` : `筛选 ${filtered.length} / ${totalEmps} 人`;
        $('#jz-emp-sheet-meta').text(empBadgeText);

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

        let tot_base = 0, tot_sub = 0, tot_perf = 0, tot_post = 0, tot_adj = 0, tot_ss = 0, tot_hf = 0, tot_ded = 0;
        let count_new_hires = 0, count_resigned = 0, count_regular = 0, count_rehire = 0, count_other = 0;
        let count_ss = 0, count_hf = 0;

        filtered.forEach((it, idx) => {
            const bSal = flt(it.base_salary);
            const bSub = flt(it.house_rent_allowance) || flt(it.other_allowance) || 0;
            const perf = flt(it.performance_base);
            const post = flt(it.post_allowance);
            const meal = flt(it.meal_allowance);
            const sAdj = flt(it.salary_adjustment);
            tot_adj += sAdj;
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

            const employmentStatus = String(it.employment_status || '在职').trim();
            const rawType = String(it.employee_type || '正式工').trim();
            const joinDate = String(it.date_of_joining || '').trim();
            const relDate = String(it.relieving_date || '').trim();
            if (joinDate && joinDate.startsWith(current_month)) count_new_hires++;
            if (employmentStatus === '本月离职' || rawType === '本月离职' || (relDate && relDate.startsWith(current_month))) count_resigned++;

            if (is_jizhong_other_type(rawType)) {
                count_other++;
            } else if (['返聘工', '退休返聘人员', '退休返聘'].includes(rawType)) {
                count_rehire++;
            } else if (rawType === '正式工') {
                count_regular++;
            } else {
                count_other++;
            }

            if (format_social_insurance_mode_label(it) !== '不参保' && ssBase > 0) count_ss++;
            if (format_housing_fund_base_mode_label(it) !== '不缴纳' && hfBase > 0) count_hf++;

            const isFixedNet = is_jizhong_fixed_net_mode(it.salary_mode) || String(it.salary_mode || '').includes('固定') || flt(it.fixed_salary) > 0;
            const category = employee_category(it.employee_type, it.employment_status);
            const netAgreed = isFixedNet ? window.AshanUI.formatMoney(it.fixed_salary) : '-';
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
                    <td class="jz-employee-type-cell">${esc(format_jizhong_employee_type(rawType))}</td>
                    <td>${esc(jizhong_salary_mode_label(it.salary_mode))}</td>
                    <td class="jz-money-cell ${isFixedNet ? 'jz-money-bold jz-text-primary' : ''}${errFixedSal ? ' jz-cell-invalid' : ''}" title="${esc(errFixedSal || '')}">${netAgreed}</td>
                    <td class="jz-money-cell jz-text-info${errBaseSal ? ' jz-cell-invalid' : ''}" title="${esc(errBaseSal || '')}">${window.AshanUI.formatMoney(bSal)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(bSub)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(perf)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(post)}</td>
                                        <td class="jz-money-cell">${meal > 0 ? window.AshanUI.formatMoney(meal) + ' / 份' : '-'}</td>
                    <td class="jz-money-cell ${sAdj > 0 ? 'jz-text-success' : (sAdj < 0 ? 'jz-text-danger' : '')}">${sAdj !== 0 ? (sAdj > 0 ? '+' : '') + window.AshanUI.formatMoney(sAdj) : '-'}</td>
                    <td class="jz-emp-col-ss-mode${errSsMode ? ' jz-cell-invalid' : ''}" title="${esc(errSsMode || format_social_insurance_mode_label(it))}"><span class="jz-ins-mode-tag jz-ins-mode-${get_insurance_mode_color_suffix(format_social_insurance_mode_label(it))}">${esc(format_social_insurance_mode_label(it))}</span></td>
                    ${render_employee_money_cell(format_social_insurance_mode_label(it) === '不参保' ? '-' : ssBase, `jz-ins-val-${get_insurance_mode_color_suffix(format_social_insurance_mode_label(it))}${errSsBase ? ' jz-cell-invalid' : ''}`, errSsBase || `社保基数：${format_social_insurance_mode_label(it)}`)}
                    <td class="jz-emp-col-hf-mode${errHfMode ? ' jz-cell-invalid' : ''}" title="${esc(errHfMode || format_housing_fund_base_mode_label(it))}"><span class="jz-ins-mode-tag jz-ins-mode-${get_insurance_mode_color_suffix(format_housing_fund_base_mode_label(it))}">${esc(format_housing_fund_base_mode_label(it))}</span></td>
                    ${render_employee_money_cell(format_housing_fund_base_mode_label(it) === '不缴纳' ? '-' : hfBase, `jz-ins-val-${get_insurance_mode_color_suffix(format_housing_fund_base_mode_label(it))}${errHfBase ? ' jz-cell-invalid' : ''}`, errHfBase || `公积金基数：${format_housing_fund_base_mode_label(it)}`)}
                    <td class="jz-emp-col-hf-cycle jz-text-center" title="公积金周期：${esc(format_housing_fund_cycle_label(it))}"><span class="ashan-cycle-tag ashan-cycle-${get_housing_fund_cycle_class(format_housing_fund_cycle_label(it))}">${esc(format_housing_fund_cycle_label(it))}</span></td>
                    <td class="jz-money-cell jz-text-warn">${dedTotal > 0 ? window.AshanUI.formatMoney(dedTotal) : '-'}</td>
                    <td class="jz-text-center">${esc(it.original_retirement_age_str || (it.original_retirement_age ? it.original_retirement_age + '岁' : '-'))}</td>
                    <td class="jz-text-center">${esc(it.original_retirement_period || '-')}</td>
                    <td class="jz-text-center">${esc(it.delayed_retirement_age_str || (it.delayed_retirement_age ? it.delayed_retirement_age + '岁' : '-'))}</td>
                    <td class="jz-text-center">${esc(it.delayed_retirement_period || '-')}</td>
                    <td class="jz-text-center">${render_employee_retirement_badge(it)}</td>
                    <td class="jz-text-center"><span class="jz-status-badge ${statusClass}">${esc(employmentStatus)}</span></td>
                    <td class="jz-col-action">${employeesConfirmed ? `<button type="button" class="ashan-table-action-btn ashan-action-view jz-btn-view-emp" data-empno="${esc(it.employee_no)}" title="查看员工档案">查看</button>` : `<button type="button" class="ashan-table-action-btn ashan-action-edit jz-btn-edit-emp" data-empno="${esc(it.employee_no)}" title="修改员工档案">修改</button>`}</td>
                </tr>
            `);
        });

        // 前提 1：只要没确认当前员工信息，则员工信息均可修改。修改有两种方式：1. 点击员工行 2. 点击最右侧操作
        // 方式 2：点击最右侧操作列按钮
        tbody.find('.jz-btn-view-emp').on('click', function(e) {
            e.stopPropagation();
            const empNo = $(this).data('empno');
            const emp = employees_cache.find(it => it.employee_no === empNo);
            if (emp) open_jizhong_employee_edit_dialog(emp, false, true);
        });

        tbody.find('.jz-btn-edit-emp').on('click', function(e) {
            e.stopPropagation();
            if (employeesConfirmed) {
                const empNo = $(this).data('empno');
                const emp = employees_cache.find(it => it.employee_no === empNo);
                if (emp) open_jizhong_employee_edit_dialog(emp, false, true);
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

            // 未处于多选状态的普通模式下：点击整行弹出界面
            if (employeesConfirmed) {
                // 已确认锁定状态：点击整行等效于“查看”，调起只读视图
                const emp = employees_cache.find(it => it.employee_no === empNo);
                if (emp) open_jizhong_employee_edit_dialog(emp, false, true);
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
        $('#jz-emp-kpi-hire-sub').text(`本月入职：${count_new_hires}人 ｜ 本月离职：${count_resigned}人`);
        $('#jz-emp-kpi-base').text(window.AshanUI.formatMoney(tot_base));
        $('#jz-emp-kpi-type-sub').text(`本月正式工：${count_regular}人 ｜ 返聘工：${count_rehire}人 ｜ 其他：${count_other}人`);
        $('#jz-emp-kpi-allowance').html(`<span id="jz-emp-kpi-ins-main">在保 ${count_ss} 人</span>`);
        $('#jz-emp-kpi-ins-sub').text(`社会保险：${count_ss}人 ｜ 公积金：${count_hf}人`);
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
                <td class="jz-money-cell ${tot_adj > 0 ? 'jz-text-success' : (tot_adj < 0 ? 'jz-text-danger' : '')}">${tot_adj !== 0 ? (tot_adj > 0 ? '+' : '') + window.AshanUI.formatMoney(tot_adj) : '-'}</td>
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
    function get_suggested_next_jz_emp_no(list) {
        let maxSeq = 0;
        const re = /^JZ(\d+)$/i;
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
        return `JZ${String(maxSeq + 1).padStart(4, '0')}`;
    }

    function open_jizhong_employee_edit_dialog(emp_data, is_new, read_only = false) {
        if (!is_new && !read_only && get_workflow_step('employees')?.is_confirmed) {
            frappe.msgprint('本账期员工薪资档案已确认并处于只读保护，请先取消确认后再修改。');
            return;
        }
        emp_data = emp_data || {};
        const isEdit = !is_new && emp_data.employee_no;

        const activeEmpTypes = (cached_employee_type_policies && cached_employee_type_policies.length)
            ? cached_employee_type_policies.map(p => p.employee_type).filter(Boolean)
            : ['正式工', '返聘工', '临时工', '其他-返聘工', '其他-正式工', '其他-管理'];
        if (emp_data && emp_data.employee_type && !activeEmpTypes.includes(emp_data.employee_type)) {
            activeEmpTypes.push(emp_data.employee_type);
        }

        const d = window.AshanUI.createDialog({
            title: isEdit ? `修改员工薪资档案 · ${emp_data.employee_name} (${emp_data.employee_no})` : `新增吉众员工薪酬档案`,
            size: 'large',
            fields: [
                { fieldtype: 'Section Break', label: '基本身份与用工' },
                { fieldtype: 'Data', fieldname: 'employee_no', label: '工号', reqd: 1, default: emp_data.employee_no || get_suggested_next_jz_emp_no(employees_cache), read_only: isEdit ? 1 : 0, description: isEdit ? '工号为终身唯一标识，已锁定只读' : '系统自动分配（JZ0000规范），支持特殊情况手动修改' },
                { fieldtype: 'Data', fieldname: 'employee_name', label: '员工姓名', reqd: 1, default: emp_data.employee_name || '' },
                { fieldtype: 'Select', fieldname: 'certificate_type', label: '证件类型', options: ['居民身份证','护照','港澳台居民居住证/通行证','外国人永久居留身份证','其他'], default: emp_data.certificate_type || '居民身份证' },
                { fieldtype: 'Data', fieldname: 'id_card', label: '证件号码', default: emp_data.id_card || '' },
                { fieldtype: 'Button', fieldname: 'btn_parse_id_card', label: '自动识别身份证性别出生日期' },
                { fieldtype: 'Column Break' },
                { fieldtype: 'Select', fieldname: 'gender', label: '性别', options: ['','男','女'], default: emp_data.gender || '' },
                { fieldtype: 'Date', fieldname: 'birth_date', label: '出生日期', default: emp_data.birth_date || '' },
                { fieldtype: 'Data', fieldname: 'mobile', label: '手机号', default: emp_data.mobile || '' },
                { fieldtype: 'Select', fieldname: 'employee_type', label: '用工性质', options: activeEmpTypes, default: emp_data.employee_type || '正式工' },
                { fieldtype: 'Select', fieldname: 'employment_status', label: '在职状态', options: ['在职','本月离职','离职'], default: emp_data.employment_status || '在职' },

                { fieldtype: 'Section Break', label: '退休政策 (政策公式全自动推导)' },
                { fieldtype: 'Select', fieldname: 'retirement_category', label: '退休类别', options: ['','男职工（原60岁）','女职工（原55岁）','女职工（原50岁）','特殊政策/人工确认'], default: emp_data.retirement_category || '', description: '根据身份证出生日期、性别及岗位自动匹配。' },
                { fieldtype: 'Float', fieldname: 'original_retirement_age', label: '退休年龄(原)', read_only: 1, default: emp_data.original_retirement_age || 0, description: '根据法定退休类别自动推导。' },
                { fieldtype: 'Data', fieldname: 'original_retirement_period', label: '原到龄年月 (YYYY-MM)', read_only: 1, default: emp_data.original_retirement_period || '', description: '根据出生日期与原退休年龄全自动推导。' },
                { fieldtype: 'Column Break' },
                { fieldtype: 'Float', fieldname: 'delayed_retirement_age', label: '退休年龄(延)', read_only: 1, default: emp_data.delayed_retirement_age || 0, description: '根据国家延迟法定退休年龄政策引擎自动推导。' },
                { fieldtype: 'Data', fieldname: 'delayed_retirement_period', label: '延迟到龄年月 (YYYY-MM)', read_only: 1, default: emp_data.delayed_retirement_period || '', description: '根据国家延迟法定退休年龄政策引擎自动推导。' },
                { fieldtype: 'HTML', fieldname: 'retirement_preview' },

                { fieldtype: 'Section Break', label: '薪酬长期要素' },
                { fieldtype: 'Select', fieldname: 'salary_mode', label: '计薪方式', options: ['税前动态工资', '税前固定工资', '税后动态工资', '税后固定工资'], default: jizhong_salary_mode_label(emp_data.salary_mode) || '税前动态工资' },
                { fieldtype: 'Currency', fieldname: 'fixed_salary', label: '固定工资', default: emp_data.fixed_salary || 0, description: '固定工资金额（根据计薪方式可为税前固定工资或税后固定工资；固定工资人员可以没有考勤）' },
                { fieldtype: 'Currency', fieldname: 'base_salary', label: '基本工资 (元)', default: emp_data.base_salary || 0, description: '已经有固定工资，可以不填写基本工资，基本工资写工资表的时候自动反推。' },
                { fieldtype: 'Column Break' },
                { fieldtype: 'Currency', fieldname: 'house_rent_allowance', label: '基本补贴 (元)', default: emp_data.house_rent_allowance || 0 },
                { fieldtype: 'Currency', fieldname: 'performance_base', label: '绩效奖金 (元)', default: emp_data.performance_base || 0 },
                { fieldtype: 'Currency', fieldname: 'post_allowance', label: '职位津贴 (元)', default: emp_data.post_allowance || 0 },
                { fieldtype: 'Currency', fieldname: 'meal_allowance', label: '餐补单价 (元/餐)', default: emp_data.meal_allowance || 15.0 },
                { fieldtype: 'Currency', fieldname: 'salary_adjustment', label: '工资调整 (元)', default: emp_data.salary_adjustment || 0, description: '正数为增加工资，负数为扣除工资。税前工资算入税前，税后工资算入税后。' },

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
                vals.retirement_category = vals.retirement_category || d.get_value('retirement_category');
                vals.original_retirement_age = vals.original_retirement_age || d.get_value('original_retirement_age');
                vals.delayed_retirement_age = vals.delayed_retirement_age || d.get_value('delayed_retirement_age');
                vals.original_retirement_period = vals.original_retirement_period || d.get_value('original_retirement_period');
                vals.delayed_retirement_period = vals.delayed_retirement_period || d.get_value('delayed_retirement_period');
                vals.salary_adjustment = flt(vals.salary_adjustment);
                const salaryMode = jizhong_salary_mode_label(vals.salary_mode);
                const fixedSalaryMode = salaryMode === '税前固定工资' || salaryMode === '税后固定工资';
                if (fixedSalaryMode && flt(vals.fixed_salary) <= 0) {
                    frappe.msgprint('固定工资计薪方式必须填写大于 0 的固定工资金额。');
                    return;
                }
                if (!fixedSalaryMode && flt(vals.base_salary) <= 0) {
                    frappe.msgprint('动态工资计薪方式必须填写大于 0 的基本工资；固定工资人员可以留空。');
                    return;
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

        const refreshRetirementPreview = () => {
            const vals = {
                company: COMPANY,
                id_card: String(d.get_value('id_card') || '').trim(),
                birth_date: d.get_value('birth_date') || '',
                gender: d.get_value('gender') || '',
                retirement_category: d.get_value('retirement_category') || '',
                original_retirement_age: d.get_value('original_retirement_age') || 0,
                delayed_retirement_age: d.get_value('delayed_retirement_age') || 0,
                period_month: current_month
            };
            frappe.call({
                method: 'ashan_cn_procurement.services.employee_salary_service.calculate_employee_age_and_retirement',
                args: vals,
                callback: function(r) {
                    const x = r.message || {};
                    if (x.birth_date && d.get_value('certificate_type') === '居民身份证') d.set_value('birth_date', x.birth_date);
                    if (x.gender && d.get_value('certificate_type') === '居民身份证') d.set_value('gender', x.gender);
                    if (x.current_age !== undefined) d.set_value('current_age', x.current_age || 0);
                    if (x.retirement_category) d.set_value('retirement_category', x.retirement_category);
                    if (x.original_retirement_age !== undefined) d.set_value('original_retirement_age', x.original_retirement_age || 0);
                    if (x.delayed_retirement_age !== undefined) d.set_value('delayed_retirement_age', x.delayed_retirement_age || 0);
                    if (x.original_retirement_period) d.set_value('original_retirement_period', x.original_retirement_period);
                    if (x.delayed_retirement_period) d.set_value('delayed_retirement_period', x.delayed_retirement_period);

                    const original = x.original_retirement_age_str || (x.original_retirement_age ? `${x.original_retirement_age}岁` : '待确认');
                    const delayed = x.delayed_retirement_age_str || (x.delayed_retirement_age ? `${x.delayed_retirement_age}岁` : '待确认');
                    const warn = x.primary_retirement_warning || '正常';
                    const isRehireEmp = ['退休返聘', '返聘工', '其他-返聘工', '退休返聘人员'].includes(d.get_value('employee_type') || '');

                    let previewContent = '';
                    if (isRehireEmp) {
                        previewContent = `
                        <div class="jz-retire-preview-box">
                            <div class="jz-retire-preview-row">
                                <span class="jz-status-badge jz-retire-badge-retired">已达龄/返聘</span>
                                <strong>已退休人员</strong>
                                <span>退休年月：<strong>${esc(x.original_retire_period || '未知')}</strong></span>
                            </div>
                            <div class="jz-retire-preview-note">该员工用工性质为返聘类员工，已按法定年龄完成退休，无需再行推导延迟退休政策。</div>
                        </div>`;
                    } else {
                        previewContent = `
                        <div class="jz-retire-preview-box">
                            <div class="jz-retire-preview-grid">
                                <div><span class="jz-text-muted">退休年龄(原)</span><br><strong>${original}</strong><br><span class="jz-text-muted">${esc(x.original_retire_period || '-')}</span></div>
                                <div><span class="jz-text-muted">退休年龄(延)</span><br><strong>${delayed}</strong><br><span class="jz-text-muted">${esc(x.delayed_retire_period || '-')}</span></div>
                                <div><span class="jz-text-muted">最早弹性退休</span><br><strong>${esc(x.earliest_flexible_retire_period || '-')}</strong><br><span class="jz-text-muted">最迟延后至 ${esc(x.latest_flexible_retire_period || '-')}</span></div>
                                <div><span class="jz-text-muted">当前状态</span><br><strong>${esc(warn)}</strong><br><span class="jz-text-muted">按 ${current_month} 账期</span></div>
                            </div>
                            <div class="jz-retire-preview-note">政策引擎 ${esc(x.policy_version || 'CN-RETIRE-2025-V1')}。原退休年龄和延迟法定退休年龄分别计算，距到龄3个月内预警。</div>
                        </div>`;
                    }
                    if (d.fields_dict.retirement_preview && d.fields_dict.retirement_preview.$wrapper) {
                        d.fields_dict.retirement_preview.$wrapper.html(previewContent);
                    }
                }
            });
        };

        configure_jizhong_dialog_close_actions(d).show();
        setTimeout(refreshRetirementPreview, 100);

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

    // 调整薪酬参数按钮点击（支持直接点击与委托点击）
    $(pageRoot).on('click', '#btn-jz-adjust-param', function() {
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
        let csv = '\uFEFF序号,工号,姓名,身份证号,用工性质,计薪方式,固定工资,基本工资,基本补贴,绩效奖金,职位津贴,餐补单价,工资调整,社险基数,公积金基数,专项附加扣除,在职状态\n';
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

            csv += `${idx + 1},${it.employee_no},"${it.employee_name}","${it.id_card || ''}",${it.employee_type || '正式工'},${jizhong_salary_mode_label(it.salary_mode)},${netAgreed},${bSal.toFixed(2)},${bSub.toFixed(2)},${perf.toFixed(2)},${post.toFixed(2)},${meal > 0 ? meal.toFixed(2) : '-'},${flt(it.salary_adjustment).toFixed(2)},${ssBase.toFixed(2)},${hfBase.toFixed(2)},${dedTotal.toFixed(2)},${it.employment_status || '在职'}\n`;
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
        $(pageRoot).on('click', '#btn-jz-employee-type-rules', function() {
            open_jizhong_employee_type_policy_dialog();
        });
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
        const isAll = (current_history_month === 'ALL');
        const targetMonth = (current_history_month === 'CURRENT')
            ? current_month
            : current_history_month;
        const requestPeriod = isAll ? 'ALL' : targetMonth;

        read_call(
            'ashan_cn_procurement.services.payroll_settlement_service.get_tax_settlement_full_sheet',
            { company: COMPANY, period_month: requestPeriod },
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
                render_jizhong_tax_68_table(filteredData, '#thead-jz-hist-tax', '#tbody-jz-hist-tax', '#tfoot-jz-hist-tax', isAll ? '全部历史账期 (含历史与本月)' : targetMonth);
                window.AshanUI.enableMousewheelHorizontalScroll($('#table-jz-hist-tax')[0], $('#box-jz-history')[0]);
            },
            isAll ? '正在生成【全部历史账期】个人所得税 68 列全要素台账…' : `正在生成【${targetMonth}】个人所得税 68 列全要素台账…`
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
                    <td>${esc(format_jizhong_employee_type(it.employee_type))}</td>
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
                    <tr class="jz-tax-group-row">
                        <th colspan="4" class="jz-col-sticky-group">员工与账期信息</th>
                        <th colspan="6" class="jz-tax-group-th">人事档案</th>
                        <th colspan="7" class="jz-tax-group-th jz-grp-amber">考勤与工时明细</th>
                        <th colspan="11" class="jz-tax-group-th jz-grp-green">工资薪酬收入明细</th>
                        <th colspan="9" class="jz-tax-group-th jz-grp-blue">个人五险一金扣除</th>
                        <th colspan="8" class="jz-tax-group-th jz-grp-purple">专项附加扣除(7项)</th>
                        <th colspan="7" class="jz-tax-group-th jz-grp-orange">个人所得税核算</th>
                        <th colspan="7" class="jz-tax-group-th jz-grp-red">实发薪资与现金配钞</th>
                        <th colspan="8" class="jz-tax-group-th">单位统筹与综合成本</th>
                    </tr>
                    <tr>
                        <!-- 员工与账期信息 (冻结列) -->
                        <th class="jz-col-seq">序号</th>
                        <th class="jz-col-no jz-text-center">账期</th>
                        <th class="jz-col-no jz-text-center">工号</th>
                        <th class="jz-col-name">姓名</th>
                        <!-- 人事档案 -->
                        <th class="jz-text-center">证件号码</th>
                        <th class="jz-text-center">联系电话</th>
                        <th>用工性质</th>
                        <th>计薪方式</th>
                        <!-- 考勤与工时 -->
                        <th class="jz-text-right">出勤天数</th>
                        <th class="jz-text-right">工作工时</th>
                        <th class="jz-text-right">平时加班(1.5x)</th>
                        <th class="jz-text-right">周末加班(2.0x)</th>
                        <th class="jz-text-right">节日加班(3.0x)</th>
                        <th class="jz-text-right">倒休工时</th>
                        <th class="jz-text-right">餐补天数</th>
                        <!-- 工资薪酬明细 -->
                        <th class="jz-text-right">基本工时工资</th>
                        <th class="jz-text-right">平时加班费</th>
                        <th class="jz-text-right">周末加班费</th>
                        <th class="jz-text-right">节日加班费</th>
                        <th class="jz-text-right">加班费合计</th>
                        <th class="jz-text-right">基本补贴</th>
                        <th class="jz-text-right">岗位津贴</th>
                        <th class="jz-text-right">绩效工资</th>
                        <th class="jz-text-right">餐补金额</th>
                        <th class="jz-text-right">工资调整</th>
                        <th class="jz-text-right jz-money-bold">税前应发工资</th>
                        <!-- 个人五险一金扣除 -->
                        <th class="jz-text-right">社保基数</th>
                        <th class="jz-text-right">养老个人(8%)</th>
                        <th class="jz-text-right">医疗个人(2%)</th>
                        <th class="jz-text-right">大额医疗(个人)</th>
                        <th class="jz-text-right">失业个人(0.5%)</th>
                        <th class="jz-text-right">社保个人合计</th>
                        <th class="jz-text-right">公积金基数</th>
                        <th class="jz-text-right">个人公积金</th>
                        <th class="jz-text-right">五险一金个人扣除</th>
                        <!-- 专项附加扣除 (7项) -->
                        <th class="jz-text-right">子女教育</th>
                        <th class="jz-text-right">继续教育</th>
                        <th class="jz-text-right">大病医疗</th>
                        <th class="jz-text-right">住房贷款利息</th>
                        <th class="jz-text-right">住房租金</th>
                        <th class="jz-text-right">赡养老人</th>
                        <th class="jz-text-right">3岁以下婴幼</th>
                        <th class="jz-text-right">专项附加合计</th>
                        <!-- 个人所得税核算 -->
                        <th class="jz-text-right">起征点扣除</th>
                        <th class="jz-text-right">应纳税所得额</th>
                        <th class="jz-text-right">适用税率</th>
                        <th class="jz-text-right">速算扣除数</th>
                        <th class="jz-text-right">累计应纳税额</th>
                        <th class="jz-text-right">往期已纳税</th>
                        <th class="jz-text-right jz-text-warn">当月代扣个税</th>
                        <!-- 实发薪资与现金配钞 -->
                        <th class="jz-text-right jz-money-primary">税后实发工资</th>
                        <th class="jz-text-right jz-money-cash">现金发放</th>
                        <th class="jz-text-right">100元(张)</th>
                        <th class="jz-text-right">50元(张)</th>
                        <th class="jz-text-right">10元(张)</th>
                        <th class="jz-text-right">5元(张)</th>
                        <th class="jz-text-right">1元(张)</th>
                        <!-- 单位统筹与综合成本 -->
                        <th class="jz-text-right">养老单位(16%)</th>
                        <th class="jz-text-right">医疗单位(8%)</th>
                        <th class="jz-text-right">失业单位(0.5%)</th>
                        <th class="jz-text-right">工伤单位(0.16%)</th>
                        <th class="jz-text-right">单位社保统筹</th>
                        <th class="jz-text-right">单位公积金</th>
                        <th class="jz-text-right">单位统筹合计</th>
                        <th class="jz-text-right jz-money-cost">企业综合总成本</th>
                    </tr>
                </thead>
                <tbody id="tbody-jz-hist-comp"></tbody>
                <tfoot id="tfoot-jz-hist-comp"></tfoot>
            </table>
        `;
        $('#box-jz-history').html(tableHtml);

        const tbody = $('#tbody-jz-hist-comp');
        if (!items.length) {
            tbody.html('<tr><td colspan="67" class="jz-empty-cell">当前筛选条件下暂无综合工资记录。</td></tr>');
            $('#tfoot-jz-hist-comp').empty();
            return;
        }

        // 汇总累加器
        let totDays = 0, totWorkHrs = 0, totOt15 = 0, totOt20 = 0, totOt30 = 0, totLeaveComp = 0, totMealCnt = 0;
        let totSalBasic = 0, totSalOt15 = 0, totSalOt20 = 0, totSalOt30 = 0, totSalOtTot = 0;
        let totSalSub = 0, totPost = 0, totPerf = 0, totMealSal = 0, totAdj = 0, totGross = 0;
        let totSsBase = 0, totPensionP = 0, totMedP = 0, totLargeMedP = 0, totUnempP = 0, totSsPTot = 0;
        let totHfBase = 0, totHfP = 0, totPersSpecialDed = 0;
        let totChild = 0, totEdu = 0, totMedAdd = 0, totLoan = 0, totRent = 0, totElder = 0, totBaby = 0, totAddDed = 0;
        let totThresh = 0, totTaxable = 0, totCumTax = 0, totPriorTax = 0, totTax = 0;
        let totNet = 0, totCash = 0, totB100 = 0, totB50 = 0, totB10 = 0, totB5 = 0, totB1 = 0;
        let totPensionC = 0, totMedC = 0, totUnempC = 0, totInjuryC = 0, totSsCTot = 0, totHfC = 0, totCompIns = 0, totCompCost = 0;

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
            const salOt15 = flt(it.salary_overtime_1_5);
            const salOt20 = flt(it.salary_overtime_2_0);
            const salOt30 = flt(it.salary_overtime_3_0);
            const salOt = flt(it.salary_overtime_total || (salOt15 + salOt20 + salOt30));
            const salSub = flt(it.salary_basic_subsidy || it.house_rent_allowance);
            const post = flt(it.salary_post_allowance || it.post_allowance);
            const perf = flt(it.salary_performance || it.performance_salary);
            const mealSal = flt(it.salary_meal_subsidy || (flt(it.meal_unit_price || 15) * mCnt));
            const adj = flt(it.salary_adjustment);
            const gross = flt(it.gross_salary);

            const ssBase = flt(it.ss_base);
            const pensionP = flt(it.pension_person || (ssBase * 0.08));
            const medP = flt(it.medical_person || (ssBase * 0.02));
            const largeMedP = flt(it.large_medical_person);
            const unempP = flt(it.unemployment_person || (ssBase * 0.005));
            const ssPTot = flt(it.ss_person_total || (pensionP + medP + largeMedP + unempP));
            const hfBase = flt(it.hf_base);
            const hfP = flt(it.housing_fund_person || it.hf_person_total);
            const persSpecialDed = flt(it.person_special_ded || (ssPTot + hfP));

            const child = flt(it.deduction_child_education);
            const edu = flt(it.deduction_continuing_education);
            const medAdd = flt(it.deduction_serious_illness);
            const loan = flt(it.deduction_housing_loan);
            const rent = flt(it.deduction_housing_rent);
            const elder = flt(it.deduction_elderly_care);
            const baby = flt(it.deduction_infant_care);
            const addDed = flt(it.special_deductions_total || (child + edu + medAdd + loan + rent + elder + baby));

            const thresh = flt(it.tax_threshold || 5000.0);
            const taxable = flt(it.taxable_income);
            const taxRate = flt(it.tax_rate || 3.0);
            const quickDed = flt(it.quick_deduction || 0.0);
            const cumTax = flt(it.cum_tax_amount || it.tax_amount);
            const priorTax = flt(it.paid_tax_prior || 0.0);
            const tax = flt(it.tax_amount);

            const net = flt(it.net_salary);
            const cash = flt(it.cash_pay || Math.ceil(net));
            const b100 = cint(it.bills_100);
            const b50 = cint(it.bills_50);
            const b10 = cint(it.bills_10);
            const b5 = cint(it.bills_5);
            const b1 = cint(it.bills_1);

            const pensionC = flt(it.pension_company || (ssBase * 0.16));
            const medC = flt(it.medical_company || (ssBase * 0.08));
            const unempC = flt(it.unemployment_company || (ssBase * 0.005));
            const injuryC = flt(it.work_injury_company || (ssBase * 0.0016));
            const ssCTot = flt(it.ss_company_total || (pensionC + medC + unempC + injuryC));
            const hfC = flt(it.hf_company_total || (hfBase * 0.05));
            const compIns = flt(ssCTot + hfC);
            const compCost = flt(it.company_cost_total || (gross + compIns));

            // 累加
            totDays += days; totWorkHrs += wHrs; totOt15 += ot15; totOt20 += ot20; totOt30 += ot30; totLeaveComp += lComp; totMealCnt += mCnt;
            totSalBasic += salBasic; totSalOt15 += salOt15; totSalOt20 += salOt20; totSalOt30 += salOt30; totSalOtTot += salOt;
            totSalSub += salSub; totPost += post; totPerf += perf; totMealSal += mealSal; totAdj += adj; totGross += gross;
            totSsBase += ssBase; totPensionP += pensionP; totMedP += medP; totLargeMedP += largeMedP; totUnempP += unempP; totSsPTot += ssPTot;
            totHfBase += hfBase; totHfP += hfP; totPersSpecialDed += persSpecialDed;
            totChild += child; totEdu += edu; totMedAdd += medAdd; totLoan += loan; totRent += rent; totElder += elder; totBaby += baby; totAddDed += addDed;
            totThresh += thresh; totTaxable += taxable; totCumTax += cumTax; totPriorTax += priorTax; totTax += tax;
            totNet += net; totCash += cash; totB100 += b100; totB50 += b50; totB10 += b10; totB5 += b5; totB1 += b1;
            totPensionC += pensionC; totMedC += medC; totUnempC += unempC; totInjuryC += injuryC; totSsCTot += ssCTot; totHfC += hfC;
            totCompIns += compIns; totCompCost += compCost;

            const isCurrent = (pMonth === current_month);
            const periodTag = isCurrent ? `<strong>${esc(pMonth)} (本月)</strong>` : esc(pMonth);
            const isPostTax = Boolean(String(it.salary_mode || '').includes('税后'));
            const modeTag = isPostTax
                ? `<span class="jz-tag-post-tax">税后</span>`
                : `<span class="jz-tag-pre-tax">税前</span>`;

            return `
                <tr>
                    <td class="jz-col-seq">${idx + 1}</td>
                    <td class="jz-col-no jz-text-center">${periodTag}</td>
                    <td class="jz-col-no jz-text-center"><strong>${esc(it.employee_no)}</strong></td>
                    <td class="jz-col-name"><strong>${esc(it.employee_name)}</strong></td>
                    <td class="jz-text-center">${esc(it.id_card || '-')}</td>
                    <td class="jz-text-center">${esc(it.mobile || '-')}</td>
                    <td>${esc(format_jizhong_employee_type(it.employee_type))}</td>
                    <td>${esc(jizhong_salary_mode_label(it.salary_mode))} ${modeTag}</td>
                    <!-- 考勤与工时 -->
                    <td class="jz-num-cell">${days.toFixed(1)}</td>
                    <td class="jz-num-cell">${wHrs.toFixed(1)}</td>
                    <td class="jz-num-cell">${ot15.toFixed(1)}</td>
                    <td class="jz-num-cell">${ot20.toFixed(1)}</td>
                    <td class="jz-num-cell">${ot30.toFixed(1)}</td>
                    <td class="jz-num-cell">${lComp.toFixed(1)}</td>
                    <td class="jz-num-cell">${mCnt} 次</td>
                    <!-- 工资薪酬明细 -->
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(salBasic)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(salOt15)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(salOt20)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(salOt30)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(salOt)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(salSub)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(post)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(perf)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(mealSal)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(adj)}</td>
                    <td class="jz-money-cell jz-money-bold">${window.AshanUI.formatMoney(gross)}</td>
                    <!-- 个人五险一金 -->
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(ssBase)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(pensionP)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(medP)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(largeMedP)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(unempP)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(ssPTot)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(hfBase)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(hfP)}</td>
                    <td class="jz-money-cell jz-money-bold">${window.AshanUI.formatMoney(persSpecialDed)}</td>
                    <!-- 专项附加扣除 (7项) -->
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(child)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(edu)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(medAdd)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(loan)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(rent)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(elder)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(baby)}</td>
                    <td class="jz-money-cell jz-money-bold">${window.AshanUI.formatMoney(addDed)}</td>
                    <!-- 个人所得税 -->
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(thresh)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(taxable)}</td>
                    <td class="jz-num-cell">${taxRate.toFixed(2)}%</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(quickDed)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(cumTax)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(priorTax)}</td>
                    <td class="jz-money-cell jz-text-warn jz-money-bold">${window.AshanUI.formatMoney(tax)}</td>
                    <!-- 实发与配钞 -->
                    <td class="jz-money-cell jz-money-primary jz-money-bold">${window.AshanUI.formatMoney(net)}</td>
                    <td class="jz-money-cell jz-money-cash">${window.AshanUI.formatMoney(cash)}</td>
                    <td class="jz-num-cell">${b100}</td>
                    <td class="jz-num-cell">${b50}</td>
                    <td class="jz-num-cell">${b10}</td>
                    <td class="jz-num-cell">${b5}</td>
                    <td class="jz-num-cell">${b1}</td>
                    <!-- 单位统筹与综合成本 -->
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(pensionC)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(medC)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(unempC)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(injuryC)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(ssCTot)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(hfC)}</td>
                    <td class="jz-money-cell">${window.AshanUI.formatMoney(compIns)}</td>
                    <td class="jz-money-cell jz-money-cost jz-money-bold">${window.AshanUI.formatMoney(compCost)}</td>
                </tr>
            `;
        }).join('');
        tbody.html(bodyHtml);

        const footHtml = `
            <tr>
                <td colspan="4" class="jz-col-foot-label">全表合计 (${items.length} 条记录)</td>
                <td>-</td>
                <td>-</td>
                <td>-</td>
                <td>-</td>
                <td>-</td>
                <td>-</td>
                <!-- 考勤与工时 -->
                <td class="jz-num-cell">${totDays.toFixed(1)}</td>
                <td class="jz-num-cell">${totWorkHrs.toFixed(1)}</td>
                <td class="jz-num-cell">${totOt15.toFixed(1)}</td>
                <td class="jz-num-cell">${totOt20.toFixed(1)}</td>
                <td class="jz-num-cell">${totOt30.toFixed(1)}</td>
                <td class="jz-num-cell">${totLeaveComp.toFixed(1)}</td>
                <td class="jz-num-cell">${totMealCnt} 次</td>
                <!-- 工资薪酬明细 -->
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totSalBasic)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totSalOt15)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totSalOt20)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totSalOt30)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totSalOtTot)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totSalSub)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totPost)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totPerf)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totMealSal)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totAdj)}</td>
                <td class="jz-money-cell jz-money-bold">${window.AshanUI.formatMoney(totGross)}</td>
                <!-- 个人五险一金 -->
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totSsBase)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totPensionP)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totMedP)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totLargeMedP)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totUnempP)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totSsPTot)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totHfBase)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totHfP)}</td>
                <td class="jz-money-cell jz-money-bold">${window.AshanUI.formatMoney(totPersSpecialDed)}</td>
                <!-- 专项附加扣除 -->
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totChild)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totEdu)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totMedAdd)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totLoan)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totRent)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totElder)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totBaby)}</td>
                <td class="jz-money-cell jz-money-bold">${window.AshanUI.formatMoney(totAddDed)}</td>
                <!-- 个人所得税 -->
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totThresh)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totTaxable)}</td>
                <td>-</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totCumTax)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totPriorTax)}</td>
                <td>-</td>
                <td class="jz-money-cell jz-text-warn jz-money-bold">${window.AshanUI.formatMoney(totTax)}</td>
                <!-- 实发与配钞 -->
                <td class="jz-money-cell jz-money-primary jz-money-bold">${window.AshanUI.formatMoney(totNet)}</td>
                <td class="jz-money-cell jz-money-cash">${window.AshanUI.formatMoney(totCash)}</td>
                <td class="jz-num-cell">${totB100}</td>
                <td class="jz-num-cell">${totB50}</td>
                <td class="jz-num-cell">${totB10}</td>
                <td class="jz-num-cell">${totB5}</td>
                <td class="jz-num-cell">${totB1}</td>
                <!-- 单位统筹与综合成本 -->
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totPensionC)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totMedC)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totUnempC)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totInjuryC)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totSsCTot)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totHfC)}</td>
                <td class="jz-money-cell">${window.AshanUI.formatMoney(totCompIns)}</td>
                <td class="jz-money-cell jz-money-cost jz-money-bold">${window.AshanUI.formatMoney(totCompCost)}</td>
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
            if (is_jizhong_other_type(et)) unSOther++;
            else if (['返聘工', '退休返聘', '退休返聘人员'].includes(et)) unSRehire++;
            else if (et === '正式工') unSReg++;
            else unSOther++;
        });
        const socialSummaryText = `参保 ${socialTotals.contributor_count || 0} 人 ｜ 未参保 ${unSocialRows.length} 人`;
        $('#jz-social-sheet-meta').text(socialSummaryText);

        // 统计公积金未参保（停缴）人员细分：正式工、其他员工、返聘工
        const unHfRows = housingRows.filter(r => r.status === '停缴' || r.status === '未缴纳' || r.status === '不缴纳' || !r.effective_base || Number(r.effective_base) <= 0);
        let unHReg = 0, unHOther = 0, unHRehire = 0;
        unHfRows.forEach(r => {
            const et = String(r.employee_type || '').trim();
            if (is_jizhong_other_type(et)) unHOther++;
            else if (['返聘工', '退休返聘', '退休返聘人员'].includes(et)) unHRehire++;
            else if (et === '正式工') unHReg++;
            else unHOther++;
        });
        const housingSummaryText = `参缴 ${housingTotals.contributor_count || 0} 人 ｜ 停缴 ${unHfRows.length} 人`;
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
        const empStep = get_workflow_step('employees');
        if (!empStep || !empStep.is_confirmed) {
            frappe.msgprint({
                title: '前置步骤未完成',
                indicator: 'orange',
                message: '请先完成并确认【员工档案】，方可修改社会保险与公积金配置！'
            });
            return;
        }
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

    let _jz_policy_dialog_in_flight = false;
    function open_jizhong_employee_type_policy_dialog() {
        if (_jz_policy_dialog_in_flight) return;
        _jz_policy_dialog_in_flight = true;
        setTimeout(() => { _jz_policy_dialog_in_flight = false; }, 800);
        let currentDialog = null;

        const fetchAndRender = function() {
            frappe.call({
                method: "frappe.client.get_list",
                args: {
                    doctype: "Jizhong Employee Type Policy",
                    filters: { company: COMPANY, is_active: 1 },
                    fields: ["name", "employee_type", "is_other", "participate_social_security", "participate_housing_fund", "participate_tax", "participate_attendance", "participate_payroll", "participate_cash_bills"],
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
                    <tr data-docname="${esc(docname)}" data-type="${esc(t)}">
                        <td><strong>${esc(t)}</strong></td>
                        <td class="jz-text-center"><input type="checkbox" class="jz-chk-policy" data-name="${esc(docname)}" data-type="${esc(t)}" data-field="is_other" ${p.is_other ? "checked" : ""}></td>
                        <td><input type="checkbox" class="jz-chk-policy" data-name="${esc(docname)}" data-type="${esc(t)}" data-field="participate_social_security" ${p.participate_social_security ? "checked" : ""}></td>
                        <td><input type="checkbox" class="jz-chk-policy" data-name="${esc(docname)}" data-type="${esc(t)}" data-field="participate_housing_fund" ${p.participate_housing_fund ? "checked" : ""}></td>
                        <td><input type="checkbox" class="jz-chk-policy" data-name="${esc(docname)}" data-type="${esc(t)}" data-field="participate_tax" ${p.participate_tax ? "checked" : ""}></td>
                        <td><input type="checkbox" class="jz-chk-policy" data-name="${esc(docname)}" data-type="${esc(t)}" data-field="participate_attendance" ${p.participate_attendance ? "checked" : ""}></td>
                        <td><input type="checkbox" class="jz-chk-policy" data-name="${esc(docname)}" data-type="${esc(t)}" data-field="participate_payroll" ${p.participate_payroll ? "checked" : ""}></td>
                        <td><input type="checkbox" class="jz-chk-policy" data-name="${esc(docname)}" data-type="${esc(t)}" data-field="participate_cash_bills" ${p.participate_cash_bills ? "checked" : ""}></td>
                        <td class="jz-text-center">
                            <div class="ashan-policy-row-actions">
                                <button type="button" class="btn btn-default btn-xs btn-dialog-edit-row" data-name="${esc(docname)}" data-type="${esc(t)}">编辑</button>
                                <button type="button" class="btn btn-default btn-xs btn-dialog-delete-row" data-name="${esc(docname)}" data-type="${esc(t)}" >删除</button>
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
                    <span class="qifu-policy-dialog-company">公司主体：<strong>${esc(COMPANY)}</strong></span>
                </div>
                <div class="qifu-policy-matrix-table-wrap">
                <table class="jz-table jz-policy-matrix-table">
                    <colgroup>
                        <col class="col-w-jz-policy-name">
                        <col class="col-w-jz-policy-chk">
                        <col class="col-w-jz-policy-chk">
                        <col class="col-w-jz-policy-chk">
                        <col class="col-w-jz-policy-chk">
                        <col class="col-w-jz-policy-chk">
                        <col class="col-w-jz-policy-chk">
                        <col class="col-w-jz-policy-chk">
                        <col class="col-w-jz-policy-act">
                    </colgroup>
                    <thead>
                        <tr>
                            <th class="jz-text-left">用工性质</th>
                            <th class="jz-text-center">是否算作其它</th>
                            <th>社会保险</th>
                            <th>住房公积金</th>
                            <th>个人所得税</th>
                            <th>考勤打卡</th>
                            <th>工资核定表</th>
                            <th>现金发放表</th>
                            <th class="jz-text-center col-w-action">操作</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml || "<tr><td colspan=\"9\" class=\"jz-text-center\" >暂无用工性质规则，请点击上方按钮添加</td></tr>"}</tbody>
                </table>
                </div>
                <div class="jz-policy-matrix-sub">
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

                    const promises = (policies || []).map(p => {
                        const t = p.employee_type;
                        const values = {
                            category_group: t
                        };
                        ["is_other", "participate_social_security", "participate_housing_fund", "participate_tax", "participate_attendance", "participate_payroll", "participate_cash_bills"].forEach(fld => {
                            values[fld] = currentDialog.$wrapper.find(`.jz-chk-policy[data-type="${t}"][data-field="${fld}"]`).prop("checked") ? 1 : 0;
                        });
                        return frappe.xcall("frappe.client.set_value", {
                            doctype: "Jizhong Employee Type Policy",
                            name: p.name,
                            fieldname: values
                        });
                    });

                    Promise.all(promises).then(() => {
                        primaryBtn.prop("disabled", false);
                        currentDialog.hide();
                        frappe.show_alert({ message: __("用工性质规则已成功保存并实时生效！"), indicator: "green" });
                        load_employees_data();
                    }).catch(err => {
                        primaryBtn.prop("disabled", false);
                        frappe.msgprint({
                            title: __("保存失败"),
                            message: String(err && err.message ? err.message : err),
                            indicator: "red"
                        });
                    });
                }
            });

            currentDialog.$wrapper.on("click", ".btn-dialog-add-policy", function(e) {
                e.preventDefault();
                if (currentDialog) currentDialog.hide();
                open_quick_policy_dialog_direct("Jizhong Employee Type Policy", COMPANY, null, function() {
                    fetchAndRender();
                    load_employees_data();
                }, function onCancel() {
                    if (currentDialog) currentDialog.show();
                });
            });

            currentDialog.$wrapper.on("click", ".btn-dialog-open-list", function(e) {
                e.preventDefault();
                frappe.route_options = { company: COMPANY };
                frappe.set_route("List", "Jizhong Employee Type Policy");
            });

            currentDialog.$wrapper.on("click", ".btn-dialog-edit-row", function(e) {
                e.preventDefault();
                const docname = $(this).attr("data-name");
                if (currentDialog) currentDialog.hide();
                open_quick_policy_dialog_direct("Jizhong Employee Type Policy", COMPANY, docname, function() {
                    fetchAndRender();
                    load_employees_data();
                }, function onCancel() {
                    if (currentDialog) currentDialog.show();
                });
            });

            currentDialog.$wrapper.on("click", ".btn-dialog-delete-row", function(e) {
                e.preventDefault();
                const docname = $(this).attr("data-name");
                const empType = $(this).attr("data-type");
                frappe.confirm(`确定要彻底删除用工性质【${empType}】吗？此操作不可撤销。`, function() {
                    frappe.delete_doc("Jizhong Employee Type Policy", docname, function() {
                        frappe.show_alert({ message: `已成功删除用工性质【${empType}】`, indicator: "green" });
                        fetchAndRender();
                        load_employees_data();
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
                    participate_attendance: 1,
                    participate_payroll: 1,
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
                    { fieldtype: "Check", fieldname: "participate_attendance", label: __("参与打卡考勤"), default: doc.participate_attendance ?? 1 },
                    { fieldtype: "Check", fieldname: "participate_payroll", label: __("计入工资核定表"), default: doc.participate_payroll ?? 1 },
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
                                        participate_attendance: values.participate_attendance ? 1 : 0,
                                        participate_payroll: values.participate_payroll ? 1 : 0,
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

function open_employee_sick_leave_dialog(item) {
        const isLocked = Boolean(workflow_state?.is_locked || (current_payroll_settlement && current_payroll_settlement.locked));
        if (isLocked) {
            frappe.msgprint('当前账期已核定封账（只读受控），禁止修改病假。');
            return;
        }
        const empName = item.employee_name || '';
        const empNo = item.employee_no || '';
        const currentSick = flt(item.sick_days || 0);

        const d = window.AshanUI.createDialog({
            title: `员工病假与考勤调整 · ${empName} (${empNo})`,
            fields: [
                {
                    label: '员工姓名',
                    fieldname: 'employee_info',
                    fieldtype: 'Data',
                    default: `${empName} (${empNo}) · ${item.salary_mode || '税前动态工资'}`,
                    read_only: 1
                },
                {
                    label: '病假天数 (天)',
                    fieldname: 'sick_days',
                    fieldtype: 'Float',
                    default: currentSick,
                    description: '病假期间按基准月薪的 80% 单独计发病假工资。若为全月病假请输入当月法定工作日总天数（例如21天），出勤补贴与餐补将自动置零。'
                }
            ],
            primary_action_label: '保存病假并重新算薪',
            primary_action: function(values) {
                const sDays = flt(values.sick_days || 0);
                d.hide();
                frappe.db.get_value('Jizhong Monthly Attendance', { company: COMPANY, period_month: current_month, employee_no: empNo }, 'name').then(r => {
                    const docName = r && r.message && r.message.name;
                    if (!docName) {
                        frappe.msgprint(`未找到工号 ${empNo} 的考勤记录，请先导入考勤。`);
                        return;
                    }
                    frappe.call({
                        method: 'frappe.client.set_value',
                        args: {
                            doctype: 'Jizhong Monthly Attendance',
                            name: docName,
                            fieldname: 'sick_leave_days',
                            value: sDays
                        },
                        callback: function() {
                            frappe.show_alert({ message: `已成功更新工号 ${empNo} 的病假天数为 ${sDays} 天`, indicator: 'green' });
                            frappe.call({
                                method: 'ashan_cn_procurement.services.jizhong_payroll_service.calculate_jizhong_monthly_payroll',
                                type: 'POST',
                                args: { company: COMPANY, period_month: current_month },
                                callback: function() {
                                    frappe.show_alert({ message: '薪酬与个税已重新计算完成！', indicator: 'green' });
                                    refresh_current_view();
                                }
                            });
                        }
                    });
                });
            }
        });
        configure_jizhong_dialog_close_actions(d).show();
    }

    let formulaHoverTimer = null;
    pageQuery(document).on('mouseover', '.jz-formula-cell', function() {
        const cell = pageQuery(this);
        const empNo = cell.attr('data-employee-no') || cell.closest('tr').find('.jz-col-no strong').text().trim();
        const field = cell.attr('data-formula-field');
        const item = (payroll_cache || []).find(x => x.employee_no === empNo);
        if (!item || !field) return;
        const fInfo = get_payroll_formula_details(item, field);
        if (!fInfo) return;
        clearTimeout(formulaHoverTimer);
        formulaHoverTimer = setTimeout(() => {
            show_payroll_formula_popover(cell, fInfo);
        }, 80);
    }).on('mouseout', '.jz-formula-cell', function(e) {
        if (pageQuery(e.relatedTarget).closest('#jz-payroll-formula-popover').length) return;
        clearTimeout(formulaHoverTimer);
        hide_payroll_formula_popover();
    });

    $(pageRoot).on('click', '#tbody-jz-payroll tr', function(e) {
        if ($(e.target).closest('a, button, input').length) return;
        const eno = $(this).find('.jz-col-no strong').text().trim();
        const item = (payroll_cache || []).find(x => x.employee_no === eno);
        if (item) open_employee_sick_leave_dialog(item);
    });

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
