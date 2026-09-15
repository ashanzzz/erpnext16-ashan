// ASHAN-UNIFIED-V2: completed-module refactor
frappe.pages['qifu-hr-salary-workbench'].on_page_load = function(wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: '人事薪酬工作台',
        single_column: true
    });

    let COMPANY = "天津祺富机械加工有限公司";
    const initial_today = (frappe.datetime && frappe.datetime.get_today) ? frappe.datetime.get_today() : new Date().toISOString().slice(0, 10);
    // 薪资工作台核定账期默认取【上一个自然月】：8月打开应默认处理7月账单
    // 当月账期尚未到期，不应作为默认核定月份
    const _today_d = new Date(initial_today);
    const _prev = new Date(_today_d.getFullYear(), _today_d.getMonth() - 1, 1);
    let current_month = `${_prev.getFullYear()}-${String(_prev.getMonth() + 1).padStart(2, '0')}`;
    let current_tab = "employees"; // 默认第 1 个 Tab: 员工薪酬档案 (权威母表底册)
    let current_history_mode = "all";
    let current_history_employee = "";
    let current_history_period = "";
    let history_full_cache = null;
    let recalculation_poll_timer = null;
    let last_recalc_status = null;
    let current_tax_view_mode = "full_68"; // 默认直接进入 68 列全量法定申报大宽表
    let cached_insurance_setting = null;
    let employee_master_rows = [];

    const html = `
    <div class="qifu-wb-wrapper">
        <!-- 顶部 Header -->
        <div class="qifu-header">
            <div>
                <div class="qifu-title">
                    <span id="qifu-company-title">人事薪酬综合中枢</span>
                </div>
                <div class="qifu-subtitle">
                    权威员工档案库 · 外部实发表智能解析与发放 · 社保/公积金独立台账 · 个人所得税依法预扣 · 综合税后倒推税前一体化
                </div>
            </div>
            <div class="qifu-header-controls">
                <label>核算公司：</label>
                <select id="qifu-company-select" class="form-control qifu-month-input"></select>
                <label>核算月份：</label>
                <input type="month" id="qifu-month-select" class="form-control qifu-month-input" value="${current_month}">
                <button class="btn btn-sm qifu-btn-refresh-header" id="btn-qifu-refresh-all">刷新数据</button>
            </div>
        </div>

        <!-- 月度人事薪酬核定全流程任务中枢与核验看板 (多维精细化卡片体系) -->
        <div class="qifu-workflow-hub" style="background:#fff; border:1px solid #e2e8f0; border-radius:10px; padding:12px 16px; margin-bottom:14px; box-shadow:0 1px 3px rgba(0,0,0,0.03);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-bottom:1px solid #f1f5f9; padding-bottom:8px;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="font-size:13px; font-weight:800; color:#0f172a;">月度人事薪酬核定全流程任务中枢</span>
                    <span class="badge" id="workflow-overall-badge" style="background:#eff6ff; color:#1d4ed8; font-weight:600; font-size:11px; padding:2px 8px; border-radius:10px; border:1px solid #bfdbfe;">
                        核定账期: <span id="workflow-period-text">${current_month}</span> ｜ 社保账期: <span id="workflow-ss-period-text">2026-08 (2026年08月)</span>
                    </span>
                </div>
                <div id="workflow-lock-status-badge" style="font-size:11.5px; font-weight:700;">
                    <span style="color:#059669; background:#dcfce7; border:1px solid #bbf7d0; padding:2px 8px; border-radius:10px;">📝 草稿状态 (待核定)</span>
                </div>
            </div>

            <!-- 5 大核心任务统一规范卡片栅格 (高信息密度与科学排版) -->
            <div class="qifu-workflow-steps" style="display:grid; grid-template-columns: repeat(5, 1fr); gap:10px;">

                <!-- 卡片 1: 权威母表底册 -->
                <div class="workflow-step-card" id="wf-step-1" style="background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; padding:10px 12px; display:flex; flex-direction:column; justify-content:space-between; min-height:130px; box-shadow:0 1px 2px rgba(0,0,0,0.02); transition:all 0.15s ease;">
                    <div>
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                            <span style="font-size:11px; font-weight:700; color:#64748b;">第 1 步 · 员工底册</span>
                            <span id="wf-step1-tag" style="font-size:10px; font-weight:600; color:#059669; background:#dcfce7; border:1px solid #bbf7d0; padding:0 5px; border-radius:8px;">权威底册</span>
                        </div>
                        <div style="font-size:12.5px; font-weight:700; color:#0f172a; display:flex; align-items:center; gap:5px;">
                            <span id="wf-step1-icon">🟡</span> 母表档案核实
                        </div>
                        <div style="font-size:12px; font-weight:700; color:#1e293b; margin-top:3px;" id="wf-step1-main">
                            数据加载中...
                        </div>
                        <div style="font-size:10.5px; color:#64748b; margin-top:2px; line-height:1.3;" id="wf-step1-sub">
                            正在读取在册档案底册
                        </div>
                    </div>
                    <div style="margin-top:8px;">
                        <button class="btn btn-default btn-xs wf-goto-tab" data-tab="employees" style="width:100%; font-size:11px; font-weight:600; padding:3px 6px; color:#1e293b; background:#f8fafc; border-color:#cbd5e1;">查看档案底册</button>
                    </div>
                </div>

                <!-- 卡片 2: 车间实发工资导入 -->
                <div class="workflow-step-card" id="wf-step-2" title="支持 .xlsx / .xlsm 车间实发表，系统自动提取考勤工时、加班达标率，并执行税后实发倒推税前应发与代扣个税" style="background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; padding:10px 12px; display:flex; flex-direction:column; justify-content:space-between; min-height:130px; box-shadow:0 1px 2px rgba(0,0,0,0.02); transition:all 0.15s ease;">
                    <div>
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                            <span style="font-size:11px; font-weight:700; color:#64748b;">第 2 步 · 车间实发</span>
                            <span id="wf-step2-file-badge" class="wf-file-pill btn-wf-download-file ashan-file-badge" data-type="excel" title="点击下载上传的车间原始外部工资表原件 (.xlsx/.xlsm)">凭证文件</span>
                        </div>
                        <div style="font-size:12.5px; font-weight:700; color:#0f172a; display:flex; align-items:center; gap:5px;">
                            <span id="wf-step2-icon">🟡</span> 外部实发导入
                        </div>
                        <div style="font-size:12px; font-weight:700; color:#1e293b; margin-top:3px;" id="wf-step2-main">
                            数据加载中...
                        </div>
                        <div style="font-size:10.5px; color:#64748b; margin-top:2px; line-height:1.3;" id="wf-step2-sub">
                            正在检查车间实操台账
                        </div>
                    </div>
                    <div style="margin-top:8px;">
                        <button class="btn btn-default btn-xs" id="btn-wf-upload-salary" style="width:100%; font-size:11px; font-weight:700; padding:3px 6px; background:#eff6ff; color:#1d4ed8; border-color:#bfdbfe;">上传车间实发表</button>
                        <div style="font-size:9.5px; color:#94a3b8; text-align:center; margin-top:3px;">支持 .xlsx / .xlsm 格式</div>
                    </div>
                </div>

                <!-- 卡片 3: 🛡️ 社保缴费申报表 PDF -->
                <div class="workflow-step-card" id="wf-step-3" title="支持电子税务局社保缴费申报表 PDF 或 ZIP，系统自动解析金额并比对公司与个人承担" style="background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; padding:10px 12px; display:flex; flex-direction:column; justify-content:space-between; min-height:130px; box-shadow:0 1px 2px rgba(0,0,0,0.02); transition:all 0.15s ease;">
                    <div>
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                            <span style="font-size:11px; font-weight:700; color:#64748b;">第 3 步 · 社保申报</span>
                            <span id="wf-step3-file-badge" class="wf-file-pill btn-wf-download-file ashan-file-badge" data-type="ss" title="点击下载已归档的税务局社保申报表原件 (PDF)">凭证文件</span>
                        </div>
                        <div style="font-size:12.5px; font-weight:700; color:#0f172a; display:flex; align-items:center; gap:5px;">
                            <span id="wf-step3-icon">🟡</span> 社保申报核验
                        </div>
                        <div style="font-size:12px; font-weight:700; color:#1e293b; margin-top:3px;" id="wf-step3-main">
                            数据加载中...
                        </div>
                        <div style="font-size:10.5px; color:#64748b; margin-top:2px; line-height:1.3;" id="wf-step3-sub">
                            正在同步社保申报状态
                        </div>
                    </div>
                    <div style="margin-top:8px;">
                        <button class="btn btn-default btn-xs" id="btn-wf-upload-ss" style="width:100%; font-size:11px; font-weight:700; padding:3px 6px; background:#eff6ff; color:#1d4ed8; border-color:#bfdbfe;">上传社保凭证</button>
                        <div style="font-size:9.5px; color:#94a3b8; text-align:center; margin-top:3px;">支持 .pdf / .zip 格式</div>
                    </div>
                </div>

                <!-- 卡片 4: 公积金缴存凭证 ZIP/PDF -->
                <div class="workflow-step-card" id="wf-step-4" title="支持公积金中心 ZIP 压缩包或 PDF 凭证，ZIP 后台自动解压仅保留归档 PDF 原件并比对金额" style="background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; padding:10px 12px; display:flex; flex-direction:column; justify-content:space-between; min-height:130px; box-shadow:0 1px 2px rgba(0,0,0,0.02); transition:all 0.15s ease;">
                    <div>
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                            <span style="font-size:11px; font-weight:700; color:#64748b;">第 4 步 · 公积金凭证</span>
                            <span id="wf-step4-file-badge" class="wf-file-pill btn-wf-download-file ashan-file-badge" data-type="hf" title="点击下载已归档的公积金缴存凭证原件 (PDF)">凭证文件</span>
                        </div>
                        <div style="font-size:12.5px; font-weight:700; color:#0f172a; display:flex; align-items:center; gap:5px;">
                            <span id="wf-step4-icon">🟡</span> 公积金凭证核验
                        </div>
                        <div style="font-size:12px; font-weight:700; color:#1e293b; margin-top:3px;" id="wf-step4-main">
                            数据加载中...
                        </div>
                        <div style="font-size:10.5px; color:#64748b; margin-top:2px; line-height:1.3;" id="wf-step4-sub">
                            正在同步公积金凭证状态
                        </div>
                    </div>
                    <div style="margin-top:8px;">
                        <button class="btn btn-default btn-xs" id="btn-wf-upload-hf" style="width:100%; font-size:11px; font-weight:700; padding:3px 6px; background:#eff6ff; color:#1d4ed8; border-color:#bfdbfe;">上传公积金凭证</button>
                        <div style="font-size:9.5px; color:#94a3b8; text-align:center; margin-top:3px;">支持 .pdf / .zip 格式</div>
                    </div>
                </div>

                <!-- 卡片 5: 薪酬综合核定与封账 -->
                <div class="workflow-step-card" id="wf-step-5" style="background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; padding:10px 12px; display:flex; flex-direction:column; justify-content:space-between; min-height:130px; box-shadow:0 1px 2px rgba(0,0,0,0.02); transition:all 0.15s ease;">
                    <div>
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                            <span style="font-size:11px; font-weight:700; color:#64748b;">第 5 步 · 综合核定</span>
                            <span id="wf-step5-lock-badge" style="font-size:10.5px; font-weight:600; color:#64748b; background:#f1f5f9; border:1px solid #e2e8f0; padding:1px 6px; border-radius:10px;">加载中</span>
                        </div>
                        <div style="font-size:12.5px; font-weight:700; color:#0f172a; display:flex; align-items:center; gap:5px;">
                            <span id="wf-step5-icon">🟡</span> 薪酬核定与封账
                        </div>
                        <div style="font-size:11.5px; font-weight:700; color:#1e293b; margin-top:3px;" id="wf-step5-main">
                            数据加载中...
                        </div>
                        <div style="font-size:10.5px; color:#64748b; font-weight:600; margin-top:2px; line-height:1.3;" id="wf-step5-sub">
                            正在汇总企业综合用工成本
                        </div>
                    </div>
                    <div style="margin-top:8px;">
                        <button class="btn btn-default btn-xs" id="btn-wf-lock-action" style="width:100%; font-size:11px; font-weight:700; padding:3px 6px; background:#f8fafc; color:#64748b; border-color:#cbd5e1;">执行最终核定封账</button>
                    </div>
                </div>

            </div>
        </div>

        <!-- 统一服务器计算中心：位于任务中枢下方、业务Tab上方，全局实时监控 -->
        <div class="qifu-calc-center" id="qifu-calc-center">
            <div class="qifu-calc-center-main">
                <div class="qifu-calc-title">服务器计算中心 <span style="font-size:10px;font-weight:600;color:#64748b;margin-left:5px;">输入保存→自动排队→VBA同口径计算→结果留痕</span></div>
                <div class="qifu-calc-stat"><span class="qifu-calc-dot ok"></span>已同步 <strong id="calc-stat-synced">0</strong></div>
                <div class="qifu-calc-stat"><span class="qifu-calc-dot pending"></span>待处理 <strong id="calc-stat-pending">0</strong></div>
                <div class="qifu-calc-stat"><span class="qifu-calc-dot running"></span>计算中 <strong id="calc-stat-running">0</strong></div>
                <div class="qifu-calc-stat"><span class="qifu-calc-dot failed"></span>失败 <strong id="calc-stat-failed">0</strong></div>
                <div class="qifu-calc-meta" id="calc-last-time">最近计算：-</div>
                <div class="qifu-calc-meta" id="calc-engine-version">引擎：-</div>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
                <button class="btn btn-default btn-sm" id="btn-calc-task-log" style="font-weight:600;">任务记录</button>
                <button class="btn btn-primary btn-sm" id="btn-server-recalc" style="font-weight:700; background:#2563eb; border-color:#2563eb;">服务器重新计算</button>
            </div>
        </div>

        <!-- 全新 7 大薪酬业务 Tab 体系 -->
        <div class="qifu-nav-tabs">
            <button class="qifu-tab-btn active" data-tab="employees">1. 员工薪酬档案 (母表底册)<span class="qifu-tab-role input">输入</span></button>
            <button class="qifu-tab-btn" data-tab="import">2. 外部实发与发放表 (24列)<span class="qifu-tab-role input">输入</span></button>
            <button class="qifu-tab-btn" data-tab="social_insurance">3. 社会保险台账与配置<span class="qifu-tab-role input">输入</span></button>
            <button class="qifu-tab-btn" data-tab="housing_fund">4. 住房公积金台账与配置<span class="qifu-tab-role input">输入</span></button>
            <button class="qifu-tab-btn" data-tab="tax">5. 个人所得税申报台账<span class="qifu-tab-role result">结果</span></button>
            <button class="qifu-tab-btn" data-tab="settlement">6. 月度薪酬综合结算<span class="qifu-tab-role result">结果</span></button>
            <button class="qifu-tab-btn" data-tab="history">7. 历史数据<span class="qifu-tab-role audit">审计/更正</span></button>
        </div>

        <!-- ========================================== -->
        <!-- Tab 1: 员工薪酬档案 · 权威母表底册 -->
        <div id="qifu-tab-employees" class="qifu-tab-content">
            <div class="qifu-master-summary-grid">
                <div class="qifu-master-summary-card" style="border-left:4px solid #2563eb;"><div class="label">在册全员</div><div class="value" id="tab1-active-total">—</div><div class="sub" id="tab1-active-sub">当前在职 — 人 ｜ 离职 — 人</div></div>
                <div class="qifu-master-summary-card" style="border-left:4px solid #059669;"><div class="label">正式与返聘员工</div><div class="value" id="tab1-regular-rehire-total">—</div><div class="sub" id="tab1-regular-rehire-sub">正式 — 人 ｜ 返聘 — 人</div></div>
                <div class="qifu-master-summary-card" style="border-left:4px solid #7c3aed;"><div class="label">其他类型员工</div><div class="value" id="tab1-other-total">—</div><div class="sub" id="tab1-other-sub">外籍 — 人 ｜ 其他 — 人</div></div>
                <div class="qifu-master-summary-card" style="border-left:4px solid #f59e0b;"><div class="label">临时工/零工</div><div class="value" id="tab1-temp-total">—</div><div class="sub" id="tab1-temp-sub">免申报 ｜ 独立免税</div></div>
                <div class="qifu-master-summary-card" style="border-left:4px solid #dc2626;"><div class="label">本月离职员工</div><div class="value" id="tab1-resigned-total">—</div><div class="sub" id="tab1-resigned-sub">当月发薪 ｜ 次月减员</div></div>
            </div>
            <div class="qifu-master-meta">
                <div class="qifu-master-meta-group"><span style="font-weight:700;color:#334155;">用工结构</span><span class="qifu-master-chip">正式工 <strong id="tab1-type-regular">0</strong></span><span class="qifu-master-chip">返聘工 <strong id="tab1-type-rehire">0</strong></span><span class="qifu-master-chip">其他-返聘工 <strong id="tab1-type-other-rehire">0</strong></span><span class="qifu-master-chip">其他-外籍工 <strong id="tab1-type-foreign">0</strong></span><span class="qifu-master-chip" style="background:#fffbeb;border-color:#fde68a;color:#b45309;">临时/零工 <strong id="tab1-type-temp">0</strong></span><span class="qifu-master-chip" style="background:#fef2f2;border-color:#fecaca;color:#991b1b;">本月离职 <strong id="tab1-type-resigned">0</strong></span></div>
                <div class="qifu-master-meta-group"><span style="font-weight:700;color:#334155;">退休预警</span><span class="qifu-master-chip" style="background:#fff7ed;border-color:#fed7aa;color:#c2410c;">3个月内临退 <strong id="tab1-ret-3m-warning">0</strong></span><span class="qifu-master-chip" style="background:#f1f5f9;border-color:#cbd5e1;color:#475569;">已达龄/返聘 <strong id="tab1-ret-already-retired">0</strong></span><span class="qifu-master-chip" style="background:#f0fdf4;border-color:#bbf7d0;color:#15803d;">正常 (未到龄) <strong id="tab1-ret-normal">0</strong></span></div>
            </div>
            <div class="qifu-toolbar" style="align-items:center;">
                <div class="qifu-toolbar-left qifu-master-filters" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <input type="text" class="form-control" id="qifu-emp-search" placeholder="搜索工号、姓名、证件、岗位" style="width:220px;height:34px;">
                    <select class="form-control" id="qifu-emp-type-filter" style="width:145px;height:34px;"><option value="all">全部用工类型</option><option value="正式工">正式工</option><option value="返聘工">返聘工</option><option value="其他-返聘工">其他-返聘工</option><option value="其他-外籍工">其他-外籍工</option><option value="临时工">临时工/零工</option></select>
                    <select class="form-control" id="qifu-emp-status-filter" style="width:115px;height:34px;"><option value="all">全部状态</option><option value="active">在职</option><option value="resigned">本月离职</option></select>
                    <select class="form-control" id="qifu-emp-ret-filter" style="width:150px;height:34px;"><option value="all">全部退休状态</option><option value="warning">3个月内临退</option><option value="retired">已达龄/返聘</option><option value="normal">正常 (未到龄)</option></select>
                    <select class="form-control" id="qifu-emp-profile-filter" style="width:130px;height:34px;"><option value="all">全部档案</option><option value="complete">资料完整</option><option value="incomplete">待完善</option></select>
                    <button class="btn btn-default btn-sm" id="btn-qifu-emp-reset-filter" style="height:34px;font-weight:600;">重置</button>
                </div>
                <div class="qifu-toolbar-right" style="display:flex;gap:7px;"><button class="btn btn-default btn-sm" id="btn-batch-resign" style="height:34px;color:#b91c1c;border-color:#fecaca;font-weight:600;">批量办理离职</button><button class="btn btn-primary btn-sm" id="btn-qifu-new-emp" style="height:34px;background:#2563eb;border-color:#2563eb;font-weight:600;">新增员工档案</button></div>
            </div>
            <div class="qifu-table-box">
                <table class="qifu-table" id="table-qifu-emp" style="min-width:1600px;">
                    <thead><tr>
                        <th style="width:36px;min-width:36px;text-align:center;"><input type="checkbox" id="check-all-tab1-employees" title="全选当前筛选结果"></th><th style="width:44px;min-width:44px;text-align:center;">序号</th><th style="width:75px;min-width:75px;text-align:center;">工号</th><th style="width:140px;min-width:140px;text-align:left;">姓名</th>
                        <th style="min-width:200px;text-align:left;"><div class="qifu-history-group-label">身份底册</div><div class="qifu-history-main-label">身份资料 (证件号/年龄/性别)</div></th><th style="min-width:130px;text-align:left;"><div class="qifu-history-group-label">组织属性</div><div class="qifu-history-main-label">用工性质</div></th><th style="min-width:150px;text-align:left;"><div class="qifu-history-group-label">长期参数</div><div class="qifu-history-main-label">计薪 / 固定项</div></th><th style="min-width:115px;text-align:right;"><div class="qifu-history-group-label">长期参数</div><div class="qifu-history-main-label">社保基数</div></th><th style="min-width:145px;text-align:right;"><div class="qifu-history-group-label">长期参数</div><div class="qifu-history-main-label">公积金基数</div></th><th style="min-width:110px;text-align:right;"><div class="qifu-history-group-label">个税参数</div><div class="qifu-history-main-label">专项附加扣除</div></th><th style="min-width:200px;text-align:left;"><div class="qifu-history-group-label">政策引擎</div><div class="qifu-history-main-label">退休信息 (原方式/预警)</div></th><th style="min-width:105px;text-align:center;">档案状态</th><th style="width:130px;min-width:130px;text-align:center;">操作</th>
                    </tr></thead><tbody id="tbody-qifu-emp"></tbody>
                </table>
            </div>
        </div>

        <!-- Tab 2: 2. 外部实发与发放表 (车间实发表·24列) -->
        <!-- 序号 工号 姓名 作业天数 作业小时 天工资 小时工资 全勤费 加班小时 加班费 国勤天数 国勤工资 达标率 达标工资 扣除 考勤绩效工资合计 职位补贴 房/车补 补贴工资合计 应发工资合计 工资调整 实发工资合计 签字 备考 -->
        <!-- ========================================== -->
        <div id="qifu-tab-import" class="qifu-tab-content" style="display:none;">
            <!-- 顶栏操作区 -->
            <div class="qifu-toolbar" style="margin-bottom:12px; padding:12px 18px; background:#fff; border-radius:10px; border:1px solid #e2e8f0;">
                <div class="qifu-toolbar-left" style="display:flex; align-items:center; gap:10px;">
                    <span style="font-size:14px; font-weight:700; color:#1e3a8a;">车间外部实发表与 24 列发放台账</span>
                    <span style="font-size:12px; color:#64748b;" id="tab2-import-summary-text">原汁原味承载车间出勤工时、绩效奖惩与实发工资记录（源文件请在顶部任务中枢第 2 步统一管理）</span>
                </div>
                <div class="qifu-toolbar-right" style="display:flex; gap:8px;">
                    <button class="btn btn-primary btn-sm" id="btn-tab2-export-dist" style="background:#059669; border-color:#059669; font-weight:600;">
                        导出薪资发放表 Excel
                    </button>
                    <button class="btn btn-default btn-sm" id="btn-tab2-print-dist" style="font-weight:600;">
                        打印 / 导出 PDF
                    </button>
                </div>
            </div>

            <!-- 24 列标准薪资发放台账表格 -->
            <div class="qifu-table-box">
                <table class="qifu-table table-bordered" id="table-tab2-dist-sheet" style="font-size:11.5px; margin-bottom:0; min-width:1800px;">
                    <thead style="position:sticky; top:0; background:#f8fafc; z-index:1;">
                        <tr>
                            <th class="qifu-col-sticky-1">序号</th>
                            <th class="qifu-col-sticky-2">工号</th>
                            <th class="qifu-col-sticky-3">姓名</th>
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
                            <th>考勤绩效工资合计</th>
                            <th>职位补贴</th>
                            <th>房/车补</th>
                            <th>补贴工资合计</th>
                            <th>应发工资合计</th>
                            <th>工资调整</th>
                            <th>实发工资合计</th>
                            <th>签字</th>
                            <th>备考</th>
                        </tr>
                    </thead>
                    <tbody id="tbody-tab2-dist-sheet">
                        <tr><td colspan="24" style="text-align:center; padding:30px; color:#94a3b8;">暂无当月实发表数据，请点击上方区域上传车间实发 Excel</td></tr>
                    </tbody>
                    <tfoot id="tfoot-tab2-dist-sheet" style="background:#f8fafc; font-weight:700;"></tfoot>
                </table>
            </div>
        </div>

        <!-- ========================================== -->
        <!-- Tab 3: 社会保险台账与配置 -->
        <!-- ========================================== -->
        <div id="qifu-tab-social_insurance" class="qifu-tab-content" style="display:none;">
            <!-- 比例卡片 -->
            <div class="qifu-kpi-grid">
                <div class="qifu-kpi-card" style="border-left: 4px solid #2563eb;">
                    <div style="font-size:13px; font-weight:700; color:#1e40af;">单位社保合计比例</div>
                    <div style="font-size:22px; font-weight:800; color:#2563eb; margin-top:4px;" id="ins-tab3-ss-comp">27.55 %</div>
                    <div style="font-size:12px; color:#64748b;">养老16% + 失业0.5% + 医疗10% + 其他0.5% + 工伤0.55%</div>
                </div>
                <div class="qifu-kpi-card" style="border-left: 4px solid #10b981;">
                    <div style="font-size:13px; font-weight:700; color:#065f46;">个人社保扣缴比例</div>
                    <div style="font-size:22px; font-weight:800; color:#059669; margin-top:4px;" id="ins-tab3-ss-pers">10.50 %</div>
                    <div style="font-size:12px; color:#64748b;">养老8% + 失业0.5% + 医疗2% (+大额救助22元/21元)</div>
                </div>
                <div class="qifu-kpi-card" style="border-left: 4px solid #f59e0b;">
                    <div style="font-size:13px; font-weight:700; color:#92400e;">参保总盘与基数下限</div>
                    <div style="font-size:22px; font-weight:800; color:#d97706; margin-top:4px;" id="ins-tab3-ss-base">5,013.00 元</div>
                    <div style="font-size:12px; color:#64748b;">在保员工最低基数标准</div>
                </div>
                <div class="qifu-kpi-card" style="border-left: 4px solid #7c3aed;">
                    <div style="font-size:13px; font-weight:700; color:#5b21b6;">实际缴费月社保核定总额</div>
                    <div style="font-size:22px; font-weight:800; color:#7c3aed; margin-top:4px;" id="ins-tab3-ss-grand">¥ 0.00</div>
                    <div style="font-size:12px; color:#64748b;" id="ins-tab3-ss-sub">单位: ¥ 0.00 | 个人: ¥ 0.00</div>
                </div>
            </div>

            <!-- 工具栏 -->
            <div class="qifu-toolbar">
                <div class="qifu-toolbar-left">
                    <button class="btn btn-default btn-sm" id="btn-qifu-edit-ss-setting" style="color:#1e40af; border-color:#93c5fd; font-weight:600;">
                        修改社保费率与基数配置
                    </button>
                    <button class="btn btn-default btn-sm" id="btn-qifu-ss-batch-min" style="color:#059669; border-color:#a7f3d0; font-weight:600;">
                        全员绑定最低缴费基数
                    </button>
                    <button class="btn btn-default btn-sm" id="btn-tab3-add-ss-adj" style="color:#b45309; border-color:#fde68a; background:#fef3c7; font-weight:600;">
                        登记特殊多月补缴 / 滞纳金
                    </button>
                </div>
                <div class="qifu-toolbar-right">
                    <button class="btn btn-primary btn-sm" id="btn-tab3-export-ss" style="background:#059669; border-color:#059669; font-weight:600;">
                        导出社保明细 Excel
                    </button>
                    <button class="btn btn-default btn-sm" id="btn-tab3-print-ss" style="font-weight:600;">
                        打印 / 导出 PDF
                    </button>
                </div>
            </div>

            <!-- 19 列社保明细大表 -->
            <div class="qifu-table-box">
                <table class="qifu-table table-bordered" id="table-tab3-ss-sheet" style="font-size:11.5px; margin-bottom:0;">
                    <thead>
                        <tr style="background:#f8fafc; text-align:center; font-size:11px;">
                            <th class="qifu-col-sticky-1" style="vertical-align:middle; font-weight:700;">序号</th>
                            <th class="qifu-col-sticky-2" style="vertical-align:middle; font-weight:700;">工号</th>
                            <th class="qifu-col-sticky-3" style="vertical-align:middle; font-weight:700;">姓名</th>
                            <th style="background:#f5f3ff;"><div style="font-size:9.5px; color:#4338ca; font-weight:600;">在册属性</div><div>证件号码</div></th>
                            <th style="background:#f5f3ff;"><div style="font-size:9.5px; color:#4338ca; font-weight:600;">缴费时点</div><div>实际缴费所属期</div></th>
                            <th style="background:#f5f3ff;"><div style="font-size:9.5px; color:#4338ca; font-weight:600;">在册属性</div><div>员工类型</div></th>
                            <th style="background:#f5f3ff;"><div style="font-size:9.5px; color:#4338ca; font-weight:600;">在册属性</div><div>社保基数</div></th>
                            <th style="background:#eff6ff;"><div style="font-size:9.5px; color:#1e40af; font-weight:600;">单位(27.55%)</div><div>单位养老</div></th>
                            <th style="background:#eff6ff;"><div style="font-size:9.5px; color:#1e40af; font-weight:600;">单位(27.55%)</div><div>单位失业</div></th>
                            <th style="background:#eff6ff;"><div style="font-size:9.5px; color:#1e40af; font-weight:600;">单位(27.55%)</div><div>单位医疗</div></th>
                            <th style="background:#eff6ff;"><div style="font-size:9.5px; color:#1e40af; font-weight:600;">单位(27.55%)</div><div>单位其他医疗</div></th>
                            <th style="background:#eff6ff;"><div style="font-size:9.5px; color:#1e40af; font-weight:600;">单位(27.55%)</div><div>单位工伤</div></th>
                            <th style="background:#dbeafe;"><div style="font-size:9.5px; color:#1e40af; font-weight:700;">单位缴纳</div><div style="color:#1e40af; font-weight:700;">单位合计</div></th>
                            <th style="background:#f0fdf4;"><div style="font-size:9.5px; color:#166534; font-weight:600;">个人(10.50%)</div><div>个人养老</div></th>
                            <th style="background:#f0fdf4;"><div style="font-size:9.5px; color:#166534; font-weight:600;">个人(10.50%)</div><div>个人失业</div></th>
                            <th style="background:#f0fdf4;"><div style="font-size:9.5px; color:#166534; font-weight:600;">个人(10.50%)</div><div>个人医疗</div></th>
                            <th style="background:#f0fdf4;"><div style="font-size:9.5px; color:#166534; font-weight:600;">个人(固定金额)</div><div>个人大额医疗</div></th>
                            <th style="background:#dcfce7;"><div style="font-size:9.5px; color:#166534; font-weight:700;">个人缴纳</div><div style="color:#166534; font-weight:700;">个人合计</div></th>
                            <th style="background:#ffedd5;"><div style="font-size:9.5px; color:#9a3412; font-weight:800;">月度统筹</div><div style="color:#c2410c; font-weight:800;">总合计</div></th>
                        </tr>
                    </thead>
                    <tbody id="tbody-tab3-ss-sheet"></tbody>
                    <tfoot id="tfoot-tab3-ss-sheet" style="background:#f8fafc; font-weight:700;"></tfoot>
                </table>
            </div>
        </div>

        <!-- ========================================== -->
        <!-- Tab 4: 住房公积金台账与自动规则 -->
        <!-- ========================================== -->
        <div id="qifu-tab-housing_fund" class="qifu-tab-content" style="display:none;">
            <div class="qifu-kpi-grid">
                <div class="qifu-kpi-card" style="border-left:4px solid #0f766e;">
                    <div style="font-size:13px;font-weight:700;color:#0f766e;">实际缴费月自动规则</div>
                    <div style="font-size:19px;font-weight:800;color:#0f766e;margin-top:4px;" id="ins-tab4-rule-status">读取中</div>
                    <div style="font-size:12px;color:#64748b;" id="ins-tab4-rule-sub">缴纳月 1 / 4 / 7 / 10</div>
                </div>
                <div class="qifu-kpi-card" style="border-left:4px solid #10b981;">
                    <div style="font-size:13px;font-weight:700;color:#065f46;">实际缴费月参缴人员</div>
                    <div style="font-size:22px;font-weight:800;color:#059669;margin-top:4px;" id="ins-tab4-contrib-count">0 人</div>
                    <div style="font-size:12px;color:#64748b;" id="ins-tab4-contrib-sub">公司规则 0 人 · 常年固定 0 人 · 单月例外 0 人</div>
                </div>
                <div class="qifu-kpi-card" style="border-left:4px solid #f59e0b;">
                    <div style="font-size:13px;font-weight:700;color:#92400e;">比例与长期基数</div>
                    <div style="font-size:19px;font-weight:800;color:#d97706;margin-top:4px;" id="ins-tab4-rate-pair">5% / 5%</div>
                    <div style="font-size:12px;color:#64748b;" id="ins-tab4-hf-base">最低基数 ¥2,320.00</div>
                </div>
                <div class="qifu-kpi-card" style="border-left:4px solid #7c3aed;">
                    <div style="font-size:13px;font-weight:700;color:#5b21b6;">当期公积金月缴存总额</div>
                    <div style="font-size:22px;font-weight:800;color:#7c3aed;margin-top:4px;" id="ins-tab4-hf-grand">¥ 0.00</div>
                    <div style="font-size:12px;color:#64748b;" id="ins-tab4-hf-sub">单位: ¥ 0.00 | 个人: ¥ 0.00</div>
                </div>
            </div>

            <div style="margin:10px 0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:9px 12px;font-size:12px;line-height:1.65;color:#475569;display:flex;justify-content:space-between;gap:14px;align-items:center;flex-wrap:wrap;">
                <div><strong style="color:#0f172a;">计算原则</strong>：自动规则按实际公积金缴费月判断；工资核算月仅用于本月例外和账期归档，实际缴费与凭证所属月固定顺延 1 个月。母表保存长期基数，系统按“本月例外 ＞ 员工长期策略 ＞ 公司自动月份规则”计算。</div>
                <div id="ins-tab4-policy-tip" style="white-space:nowrap;color:#0f766e;font-weight:700;">自动规则启用</div>
            </div>

            <div class="qifu-toolbar">
                <div class="qifu-toolbar-left">
                    <button class="btn btn-default btn-sm" id="btn-qifu-edit-hf-setting" style="color:#0f766e;border-color:#99f6e4;font-weight:600;">比例与基数</button>
                    <button class="btn btn-default btn-sm" id="btn-tab4-hf-auto-rule" style="color:#2563eb;border-color:#93c5fd;font-weight:600;">自动缴纳规则</button>
                    <button class="btn btn-default btn-sm" id="btn-tab4-hf-long-policy" style="color:#7c3aed;border-color:#c4b5fd;font-weight:600;">员工长期策略</button>
                    <button class="btn btn-default btn-sm" id="btn-tab4-hf-monthly-override" style="color:#d97706;border-color:#fcd34d;font-weight:600;">本月例外</button>
                </div>
                <div class="qifu-toolbar-right">
                    <button class="btn btn-primary btn-sm" id="btn-tab4-export-hf" style="background:#059669;border-color:#059669;font-weight:600;">导出参缴明细 Excel</button>
                    <button class="btn btn-default btn-sm" id="btn-tab4-print-hf" style="font-weight:600;">打印 / 导出 PDF</button>
                </div>
            </div>

            <div class="qifu-hf-roster-exports">
                <div class="qifu-hf-roster-summary" id="qifu-hf-roster-change-summary">正在识别本账期人员变动…</div>
                <div class="qifu-hf-roster-actions">
                    <button class="btn btn-default btn-sm qifu-hf-roster-btn qifu-hf-roster-btn-increase" id="btn-tab4-export-hf-increase">导出增加清册 <span id="qifu-hf-increase-count"></span></button>
                    <button class="btn btn-default btn-sm qifu-hf-roster-btn qifu-hf-roster-btn-seal" id="btn-tab4-export-hf-seal">导出封存清册 <span id="qifu-hf-seal-count"></span></button>
                </div>
            </div>

            <div class="qifu-table-box" id="tab4-table-box">
                <table class="qifu-table table-bordered" id="table-tab4-hf-sheet" style="font-size:11.5px;margin-bottom:0;min-width:1580px;">
                    <thead>
                        <tr style="background:#f8fafc;text-align:center;font-size:11px;">
                            <th class="qifu-col-sticky-1">序号</th>
                            <th class="qifu-col-sticky-2">工号</th>
                            <th class="qifu-col-sticky-3">姓名</th>
                            <th>用工性质</th>
                            <th style="background:#f5f3ff;"><div style="font-size:9.5px;color:#4338ca;font-weight:600;">员工母表</div><div>长期基数</div></th>
                            <th style="background:#f5f3ff;"><div style="font-size:9.5px;color:#4338ca;font-weight:600;">员工母表</div><div>长期策略</div></th>
                            <th style="background:#eff6ff;"><div style="font-size:9.5px;color:#1d4ed8;font-weight:600;">规则结果</div><div>本月状态</div></th>
                            <th style="background:#eff6ff;"><div style="font-size:9.5px;color:#1d4ed8;font-weight:600;">规则结果</div><div>有效基数</div></th>
                            <th style="background:#e0f2fe;">单位比例</th>
                            <th style="background:#e0f2fe;color:#0369a1;">单位金额</th>
                            <th style="background:#dcfce7;">个人比例</th>
                            <th style="background:#dcfce7;color:#15803d;">个人金额</th>
                            <th style="background:#ffedd5;color:#c2410c;font-weight:800;">月缴存总额</th>
                            <th style="width:86px;">操作</th>
                        </tr>
                    </thead>
                    <tbody id="tbody-tab4-hf-sheet"></tbody>
                    <tfoot id="tfoot-tab4-hf-sheet" style="background:#f8fafc;font-weight:700;"></tfoot>
                </table>
            </div>
        </div>

        <!-- ========================================== -->
        <!-- Tab 5: ⚖️ 5. 个人所得税依法预扣与申报台账 -->
        <!-- ========================================== -->
        <div id="qifu-tab-tax" class="qifu-tab-content" style="display:none;">
            <!-- 个税 KPI 指标看板 -->
            <div class="qifu-kpi-grid">
                <div class="qifu-kpi-card" style="border-left: 4px solid #dc2626;">
                    <div style="font-size:13px; font-weight:700; color:#991b1b;">本月个税代扣总额</div>
                    <div style="font-size:22px; font-weight:800; color:#dc2626; margin-top:4px;" id="tax-kpi-total">¥ 0.00</div>
                    <div style="font-size:12px; color:#64748b;">全员当期个人所得税合计</div>
                </div>
                <div class="qifu-kpi-card" style="border-left: 4px solid #2563eb;">
                    <div style="font-size:13px; font-weight:700; color:#1e40af;">税前应发总额 (倒推总盘)</div>
                    <div style="font-size:22px; font-weight:800; color:#2563eb; margin-top:4px;" id="tax-kpi-gross">¥ 0.00</div>
                    <div style="font-size:12px; color:#64748b;">应发计税收入总额</div>
                </div>
                <div class="qifu-kpi-card" style="border-left: 4px solid #f59e0b;">
                    <div style="font-size:13px; font-weight:700; color:#92400e;">扣除与减除费用总盘</div>
                    <div style="font-size:22px; font-weight:800; color:#d97706; margin-top:4px;" id="tax-kpi-ded">¥ 0.00</div>
                    <div style="font-size:12px; color:#64748b;">基本减除费用 + 险金 + 专项附加扣除</div>
                </div>
                <div class="qifu-kpi-card" style="border-left: 4px solid #059669;">
                    <div style="font-size:13px; font-weight:700; color:#065f46;">纳税人数与申报期</div>
                    <div style="font-size:22px; font-weight:800; color:#059669; margin-top:4px;" id="tax-kpi-count">—</div>
                    <div style="font-size:12px; color:#64748b;" id="tax-kpi-period">所属发薪账期: ${current_month}</div>
                </div>
            </div>

            <!-- 工具栏 -->
            <div class="qifu-toolbar">
                <div class="qifu-toolbar-left">
                    <div class="btn-group btn-group-sm" role="group" style="margin-right:6px;">
                        <button type="button" class="btn btn-default btn-tax-view-mode active" data-mode="full_68" style="font-weight:700; font-size:12px; background:#2563eb; color:#fff; border-color:#2563eb;">
                            VBA 68列完整核算台账
                        </button>
                        <button type="button" class="btn btn-default btn-tax-view-mode" data-mode="simple" style="font-weight:700; font-size:12px; background:#fff; color:#334155; border-color:#cbd5e1;">
                            财税精简版 (17列)
                        </button>
                    </div>
                    <button class="btn btn-default btn-sm" id="btn-qifu-edit-tax-setting" style="color:#b45309; border-color:#fde68a; background:#fef3c7; font-weight:600;">
                        个税参数设置
                    </button>
                </div>
                <div class="qifu-toolbar-right">
                    <button class="btn btn-primary btn-sm" id="btn-tab5-export-tax" title="默认导出 VBA 同口径 68 列完整个税申报台账" style="background:#059669; border-color:#059669; font-weight:600;">
                        导出个税申报明细 Excel
                    </button>
                    <button class="btn btn-default btn-sm" id="btn-tab5-print-tax" style="font-weight:600;">
                        🖨️ 打印 / 导出 PDF
                    </button>
                </div>
            </div>

            <!-- 个税明细：顶部同步横向滚动条 + 自适应冻结视口 -->
            <div id="tab5-top-scrollbar" class="qifu-top-scrollbar-wrapper" style="overflow-x:auto; overflow-y:hidden; height:14px; margin-bottom:4px;">
                <div class="qifu-top-scrollbar-dummy" style="height:1px; width:1600px;"></div>
            </div>
            <div class="qifu-table-box" id="tab5-table-box">
                <table class="qifu-table table-bordered" id="table-tab5-tax-sheet" style="font-size:11.5px; margin-bottom:0; min-width:6200px;">
                    <thead>
                        <tr style="background:#f8fafc;">
                            <th class="qifu-col-sticky-1">序号</th>
                            <th class="qifu-col-sticky-2">工号</th>
                            <th class="qifu-col-sticky-3">姓名</th>
                            <th>证件号码</th>
                            <th>用工性质</th>
                            <th>发薪月份</th>
                            <th style="background:#eff6ff;">本期税前收入</th>
                            <th>基本减除费用</th>
                            <th>社保个人扣缴</th>
                            <th>公积金个人扣缴</th>
                            <th>专项附加扣除</th>
                            <th style="background:#fef3c7; color:#92400e;">应纳税所得额</th>
                            <th style="text-align:center;">适用税率</th>
                            <th>速算扣除数</th>
                            <th style="background:#fee2e2; color:#b91c1c; font-weight:800;">本月应预扣税额</th>
                        </tr>
                    </thead>
                    <tbody id="tbody-tab5-tax-sheet"></tbody>
                    <tfoot id="tfoot-tab5-tax-sheet" style="background:#f8fafc; font-weight:700;"></tfoot>
                </table>
            </div>
        </div>

        <!-- ========================================== -->
        <!-- Tab 6: 📊 6. 月度薪酬综合核定与结算 (母表与老板娘混合总盘) -->
        <!-- ========================================== -->
        <div id="qifu-tab-settlement" class="qifu-tab-content" style="display:none;">
            <!-- 4 大黄金统筹 KPI 看板 -->
            <div class="qifu-kpi-grid">
                <!-- 卡片 1: 在册用工结构 -->
                <div class="qifu-kpi-card" style="border-left: 4px solid #3b82f6;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <span style="font-size:13px; font-weight:700; color:#1e40af;">在册用工结构</span>
                        <span class="qifu-status-badge qifu-status-locked" style="font-size:10.5px;">底册档案</span>
                    </div>
                    <div style="font-size:22px; font-weight:800; color:#0f172a; margin-bottom:8px;">
                        <span id="kpi-emp-total">—</span> <span style="font-size:12px; font-weight:500; color:#64748b;">人 在册总数</span>
                    </div>
                    <div style="font-size:12px; line-height:1.7; color:#475569;">
                        <div style="display:flex; justify-content:space-between;"><span>正式工:</span><strong style="color:#2563eb;" id="kpi-emp-insured">—</strong></div>
                        <div style="display:flex; justify-content:space-between;"><span>退休返聘人员:</span><strong style="color:#d97706;" id="kpi-emp-rehire">—</strong></div>
                        <div style="display:flex; justify-content:space-between;"><span>临时工:</span><strong style="color:#059669;" id="kpi-emp-temp">—</strong></div>
                        <div style="display:flex; justify-content:space-between;"><span>其他类型员工:</span><strong style="color:#64748b;" id="kpi-emp-other">—</strong></div>
                        <div style="display:flex; justify-content:space-between;"><span>本月离职人员:</span><strong style="color:#dc2626;" id="kpi-emp-resigned">—</strong></div>
                    </div>
                </div>

                <!-- 卡片 2: 社会保险统筹 -->
                <div class="qifu-kpi-card" style="border-left: 4px solid #1e40af;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <span style="font-size:13px; font-weight:700; color:#1e3a8a;">社会保险统筹</span>
                        <span class="qifu-status-badge qifu-status-locked" style="font-size:10.5px;" id="kpi-ss-badge">缴纳 8月 · 所属 202608</span>
                    </div>
                    <div style="font-size:20px; font-weight:800; color:#1e40af; margin-bottom:8px;" id="kpi-ss-grand">
                        ¥ 0.00
                    </div>
                    <div style="font-size:12px; line-height:1.7; color:#475569;">
                        <div style="display:flex; justify-content:space-between;"><span>公司承担社保:</span><strong style="color:#1e3a8a;" id="kpi-ss-comp">¥ 0.00</strong></div>
                        <div style="display:flex; justify-content:space-between;"><span>员工个人代扣:</span><strong style="color:#15803d;" id="kpi-ss-pers">¥ 0.00</strong></div>
                        <div style="display:flex; justify-content:space-between;"><span>参保人数 / 基数总盘:</span><span style="color:#64748b;"><strong id="kpi-ss-count">—</strong>人 | <span id="kpi-ss-base">¥ 0.00</span></span></div>
                    </div>
                </div>

                <!-- 卡片 3: 住房公积金统筹 -->
                <div class="qifu-kpi-card" style="border-left: 4px solid #0f766e;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <span style="font-size:13px; font-weight:700; color:#0f766e;">住房公积金统筹</span>
                        <span class="qifu-status-badge qifu-status-locked" style="font-size:10.5px;" id="kpi-hf-badge">缴纳 8月 · 所属 202608</span>
                    </div>
                    <div style="font-size:20px; font-weight:800; color:#0f766e; margin-bottom:8px;" id="kpi-hf-grand">
                        ¥ 0.00
                    </div>
                    <div style="font-size:12px; line-height:1.7; color:#475569;">
                        <div style="display:flex; justify-content:space-between;"><span>公司缴存公积金 (5%):</span><strong style="color:#0369a1;" id="kpi-hf-comp">¥ 0.00</strong></div>
                        <div style="display:flex; justify-content:space-between;"><span>员工个人代扣 (5%):</span><strong style="color:#15803d;" id="kpi-hf-pers">¥ 0.00</strong></div>
                        <div style="display:flex; justify-content:space-between;"><span>参保人数 / 基数总盘:</span><span style="color:#64748b;"><strong id="kpi-hf-count">—</strong>人 | <span id="kpi-hf-base">¥ 0.00</span></span></div>
                    </div>
                </div>

                <!-- 卡片 4: 薪资发薪总盘与个税 -->
                <div class="qifu-kpi-card" style="border-left: 4px solid #16a34a;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <span style="font-size:13px; font-weight:700; color:#15803d;">薪酬发薪总盘与个税</span>
                        <span class="qifu-status-badge qifu-status-locked" style="font-size:10.5px;" id="kpi-payroll-badge">等待加载账期数据</span>
                    </div>
                    <div style="font-size:20px; font-weight:800; color:#16a34a; margin-bottom:8px;" id="kpi-total-net">
                        ¥ 0.00
                    </div>
                    <div style="font-size:12px; line-height:1.7; color:#475569;">
                        <div style="display:flex; justify-content:space-between;"><span>倒推税前应发总额:</span><strong style="color:#2563eb;" id="kpi-total-gross">¥ 0.00</strong></div>
                        <div style="display:flex; justify-content:space-between;"><span>本月个税代扣合计:</span><strong style="color:#dc2626;" id="kpi-total-tax">¥ 0.00</strong></div>
                        <div style="display:flex; justify-content:space-between;"><span>个人代扣总额 (险金+个税):</span><strong style="color:#d97706;" id="kpi-total-person-ded">¥ 0.00</strong></div>
                    </div>
                </div>
            </div>

            <!-- 工具栏 -->
            <div class="qifu-toolbar">
                <div class="qifu-toolbar-left">
                    <span class="ashan-inline-notice">
                        输入变更后由上方“服务器计算中心”自动异步重算
                    </span>
                    <button class="btn btn-default btn-sm" id="btn-view-salary-dist" style="color:#1e3a8a; border-color:#93c5fd; font-weight:600;">
                        查看薪资发放表 (24列)
                    </button>
                    <button class="btn btn-default btn-sm" id="btn-view-acc-sheet" style="color:#15803d; border-color:#86efac; font-weight:600;">
                        查看记账工资表 (11列)
                    </button>
                    <button class="btn btn-default btn-sm" id="btn-view-ins-sheet-modal" style="color:#6d28d9; border-color:#c4b5fd; font-weight:600;">
                        查看社会保险 (19列弹窗)
                    </button>
                    <button class="btn btn-default btn-sm" id="btn-view-hf-sheet-modal" style="color:#0f766e; border-color:#99f6e4; font-weight:600;">
                        查看住房公积金 (12列弹窗)
                    </button>
                    <button class="btn btn-default btn-sm" id="btn-view-tax-sheet-modal" style="color:#b45309; border-color:#fde68a; font-weight:600;">
                        查看个人所得税 (15列弹窗)
                    </button>
                </div>
                <div class="qifu-toolbar-right" style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
                    <button class="btn btn-default btn-sm" id="btn-export-accounting-xlsm" title="按参考 XLSM 的 11 列结构导出；外籍人员自动放入独立工作表" style="color:#15803d; border-color:#86efac; font-weight:700;">
                        导出记账工资表
                    </button>
                    <button class="btn btn-primary btn-sm" id="btn-export-excel-both" title="导出 7 张业务工作表；100/50/10/5/1 元配钞列仅在导出时按最终实发工资自动生成" style="background:#2563eb; border-color:#2563eb; font-weight:600;">
                        导出全量 Excel（7 Sheet · 含配钞）
                    </button>
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
                            <th>出勤天/工时</th>
                            <th>车间实发 (税后)</th>
                            <th>职位补贴</th>
                            <th>租房/车补</th>
                            <th>当月总实发 (税后)</th>
                            <th>税前应发工资 (倒推)</th>
                            <th>社保个人代扣</th>
                            <th>公积金个人代扣</th>
                            <th>个税代扣</th>
                            <th>社保单位统筹</th>
                            <th>公积金单位缴纳</th>
                            <th>核算说明</th>
                        </tr>
                    </thead>
                    <tbody id="tbody-qifu-payroll">
                        <tr><td colspan="16" style="text-align:center; padding:30px; color:#94a3b8;">暂无当月核算数据，请点击上方【2. 外部实发导入与智能解析】上传车间实发表</td></tr>
                    </tbody>
                </table>
            </div>
        </div>

        <!-- ========================================== -->
        <!-- Tab 7: 🗂️ 历史数据 · 个税申报周期累计总览 / 单人月度穿透 -->
        <!-- ========================================== -->
        <div id="qifu-tab-history" class="qifu-tab-content" style="display:none;">
            <div class="qifu-kpi-grid" style="grid-template-columns:repeat(4, minmax(180px, 1fr));">
                <div class="qifu-kpi-card"><div class="qifu-kpi-title">申报周期</div><div class="qifu-kpi-val" id="history-kpi-cycle" style="font-size:18px;">-</div><div class="qifu-kpi-sub">按个税累计预扣周期归集</div></div>
                <div class="qifu-kpi-card"><div class="qifu-kpi-title">纳税台账人数</div><div class="qifu-kpi-val" id="history-kpi-count">0 人</div><div class="qifu-kpi-sub">临时工/零工不进入；返聘类进入</div></div>
                <div class="qifu-kpi-card"><div class="qifu-kpi-title">累计税前收入</div><div class="qifu-kpi-val" id="history-kpi-gross" style="font-size:20px;">¥ 0.00</div><div class="qifu-kpi-sub">截至当前所选发薪账期</div></div>
                <div class="qifu-kpi-card"><div class="qifu-kpi-title">累计已扣个税</div><div class="qifu-kpi-val" id="history-kpi-tax" style="font-size:20px; color:#b91c1c;">¥ 0.00</div><div class="qifu-kpi-sub">历史月度记录累计</div></div>
            </div>
            <div class="qifu-toolbar" style="flex-wrap:wrap; gap:10px;">
                <div class="qifu-toolbar-left" style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <div class="qifu-history-mode-group">
                        <button class="btn btn-sm active" id="btn-history-all" style="font-weight:700;">周期累计 (15列)</button>
                        <button class="btn btn-sm" id="btn-history-full" style="font-weight:700;">完整核算 (68列+审计)</button>
                    </div>
                    <select class="form-control input-sm" id="history-emp-select" style="width:160px; height:30px; font-size:12px; font-weight:700;">
                        <option value="">全部在册人员</option>
                    </select>
                    <select class="form-control input-sm" id="history-period-select" style="display:none; width:180px; height:30px; font-size:12px; font-weight:700;"></select>
                    <button class="btn btn-default btn-sm" id="btn-history-back" style="display:none; font-weight:600;">← 返回全员总览</button>
                    <span id="history-current-person" style="font-size:12px; color:#475569; font-weight:600;"></span>
                </div>
                <div class="qifu-toolbar-right" style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <!-- 分页组件 (用于 68 列多记录翻页) -->
                    <div id="history-pagination-box" style="display:none; align-items:center; gap:5px; font-size:12px; color:#475569;">
                        <button class="btn btn-default btn-xs" id="btn-history-prev" style="font-weight:700; padding:2px 8px;">◀ 上一页</button>
                        <span>第 <strong id="history-page-cur" style="color:#2563eb;">1</strong> / <strong id="history-page-total">1</strong> 页 (共 <strong id="history-total-count">0</strong> 条)</span>
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
                </div>
            </div>
            <div class="ashan-callout ashan-callout--md ashan-mb-3">
                历史数据以 <strong>Ashan Monthly Payroll Settlement / Item</strong> 月度快照为财务真值。支持查看周期累计或 <strong>VBA 68列 + ERP审计字段</strong>。支持全员/单人筛选与申报周期全月份流水翻页。
            </div>
            <div id="history-top-scrollbar" class="qifu-top-scrollbar-wrapper" style="overflow-x:auto; overflow-y:hidden; height:14px; margin-bottom:4px;">
                <div class="qifu-top-scrollbar-dummy" style="height:1px; width:1780px;"></div>
            </div>
            <div class="qifu-table-box" id="history-table-box">
                <table class="qifu-table" id="table-history">
                    <thead id="thead-history"></thead>
                    <tbody id="tbody-history"><tr><td style="padding:30px; text-align:center; color:#94a3b8;">加载历史数据...</td></tr></tbody>
                    <tfoot id="tfoot-history"></tfoot>
                </table>
            </div>
        </div>
    </div>
    `;

    var $container = $(html).appendTo(page.main);

    // ==========================================
    // 基础格式化方法
    // ==========================================
    // ASHAN-UNIFIED-V2: one display formatter for every payroll/tax tab.
    function fmtMoney(val) {
        return window.AshanUI?.formatMoney
            ? window.AshanUI.formatMoney(val)
            : frappe.format(Number(val || 0), { fieldtype: 'Currency' });
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

    function load_calculation_center() {
        if (!COMPANY) return;
        const cur_m = $("#qifu-month-select").val() || current_month;
        frappe.call({
            method: 'ashan_cn_procurement.services.payroll_recalculation_service.get_payroll_recalculation_status',
            args: { company: COMPANY, period_month: cur_m },
            callback: function(r) {
                if (!r.message) return;
                last_recalc_status = r.message;
                const s = r.message.summary || {};
                const tasks = r.message.tasks || [];
                const taskPending = tasks.filter(t => ['待计算','已入队'].includes(t.status)).length;
                const taskRunning = tasks.filter(t => t.status === '计算中').length;
                const taskFailed = tasks.filter(t => ['失败','部分完成'].includes(t.status)).length;
                $("#calc-stat-synced").text(s.synced || 0);
                // 月度子表状态用于显示“多少人”，任务状态用于补足新增员工/尚未建月度行等场景。
                $("#calc-stat-pending").text(Math.max((s.pending || 0) + (s.queued || 0), taskPending));
                $("#calc-stat-running").text(Math.max(s.running || 0, taskRunning));
                $("#calc-stat-failed").text(Math.max(s.failed || 0, taskFailed));
                $("#calc-last-time").text(`最近计算：${fmtDateTime(s.last_completed_at)}`);
                $("#calc-engine-version").text(`引擎：${r.message.engine_version || '-'}`);
                const busy = (s.pending || 0) + (s.queued || 0) + (s.running || 0) + taskPending + taskRunning > 0;
                $("#btn-server-recalc").toggleClass('btn-primary', !r.message.locked).toggleClass('btn-default', !!r.message.locked)
                    .prop('disabled', !!r.message.locked)
                    .text(r.message.locked ? '🔒 本月已冻结' : (busy ? '🔄 查看 / 追加计算' : '🔄 服务器重新计算'));
            }
        });
    }

    function render_calculation_task_log() {
        const data = last_recalc_status || {};
        const tasks = data.tasks || [];
        let html = `<div style="font-size:12px; color:#64748b; margin-bottom:10px;">账期 <strong>${data.period_month || current_month}</strong> · 后台任务按公司顺序处理，避免并发覆盖同一月度结算单。</div>`;
        if (!tasks.length) {
            html += '<div style="padding:24px; text-align:center; color:#94a3b8;">当前账期暂无计算任务记录。</div>';
        } else {
            html += `<div style="max-height:420px; overflow:auto;"><table class="table table-bordered" style="font-size:11.5px; margin:0;"><thead><tr><th>任务</th><th>员工</th><th>影响月份</th><th>来源</th><th>状态</th><th>请求</th><th>完成</th><th>操作</th></tr></thead><tbody>`;
            tasks.forEach(t => {
                const retry = ['失败','部分完成','已跳过','已取消'].includes(t.status)
                    ? `<button class="btn btn-xs btn-default btn-retry-recalc" data-task="${t.name}">重试</button>` : '';
                html += `<tr><td style="font-weight:700;">${t.name}</td><td>${t.employee_no ? `${t.employee_no} ${t.employee_name || ''}` : '整月'}</td><td>${t.start_period} → ${t.end_period}</td><td>${t.trigger_source || '-'}</td><td>${calcStatusBadge(t.status)}</td><td>${fmtDateTime(t.requested_at)}</td><td>${fmtDateTime(t.completed_at)}</td><td>${retry}</td></tr>`;
            });
            html += '</tbody></table></div>';
        }
        const d = new frappe.ui.Dialog({
            title: '🧮 服务器计算任务记录', size: 'extra-large',
            fields: [{fieldtype:'HTML', fieldname:'task_log'}],
            primary_action_label: '关闭', primary_action() { d.hide(); }
        });
        d.show();
        d.fields_dict.task_log.$wrapper.html(html);
    }

    function open_server_recalculation_dialog() {
        const cur_m = $("#qifu-month-select").val() || current_month;
        const d = new frappe.ui.Dialog({
            title: `🔄 服务器重新计算 · ${cur_m}`,
            fields: [
                { fieldtype:'HTML', fieldname:'help', options:`<div class="ashan-callout ashan-callout--sm">平时无需手动计算：员工档案、外部实发、社保、公积金或历史输入保存后会自动标记并进入后台队列。这里用于人工复核、失败重试或强制整月复算。</div>` },
                { fieldtype:'Select', fieldname:'scope', label:'计算范围', reqd:1, options:['待处理变更','指定员工','当前月份全部员工','强制重新计算当前月份'], default:'待处理变更' },
                { fieldtype:'Data', fieldname:'employee_no', label:'员工工号', depends_on:"eval:doc.scope=='指定员工'", description:'仅在“指定员工”时填写，例如 A0001。' },
                { fieldtype:'Check', fieldname:'confirm_force', label:'我确认强制计算会忽略输入哈希缓存', depends_on:"eval:doc.scope=='强制重新计算当前月份'" }
            ],
            primary_action_label:'提交后台任务',
            primary_action(values) {
                let scope = 'dirty', force = 0;
                if (values.scope === '指定员工') scope = 'employee';
                if (values.scope === '当前月份全部员工') scope = 'month';
                if (values.scope === '强制重新计算当前月份') {
                    if (!values.confirm_force) { frappe.msgprint('请先确认强制重新计算。'); return; }
                    scope = 'force_month'; force = 1;
                }
                if (scope === 'employee' && !String(values.employee_no || '').trim()) {
                    frappe.msgprint('请输入员工工号。'); return;
                }
                frappe.call({
                    method:'ashan_cn_procurement.services.payroll_recalculation_service.request_payroll_recalculation',
                    type:'POST',
                    args:{ company:COMPANY, period_month:cur_m, employee_no:values.employee_no || '', scope:scope, force_recompute:force },
                    freeze:true, freeze_message:'正在提交服务器计算任务...',
                    callback:function(r) {
                        if (r.message && r.message.success) {
                            frappe.show_alert({message:r.message.message || '计算任务已提交', indicator:'green'});
                            d.hide(); load_calculation_center();
                        }
                    }
                });
            }
        });
        d.show();
    }

    function refresh_after_recalculation() {
        load_calculation_center();
        load_monthly_workflow_hub();
        if (current_tab === 'tax') load_tax_settlement_tab();
        if (current_tab === 'settlement') load_payroll_settlement();
        if (current_tab === 'history') load_history_tab();
        if (current_tab === 'social_insurance') load_social_insurance_tab();
        if (current_tab === 'housing_fund') load_housing_fund_tab();
    }

    // ==========================================
    // 业务加载函数
    // ==========================================

    // 1. 加载 Tab 1: 员工档案母表 (精简11列标准结构)
    function load_qifu_employees() {
        if (!COMPANY) return;
        frappe.call({
            method: 'ashan_cn_procurement.services.employee_salary_service.get_qifu_employees',
            args: { company: COMPANY, period_month: current_month },
            callback: function(r) {
                if (r.message && Array.isArray(r.message)) {
                    employee_master_rows = r.message.slice();
                    render_employees_view(employee_master_rows);
                }
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

    function render_employees_view(list) {
        const all = Array.isArray(list) ? list : [];
        const isResigned = (e) => !!(e.is_resigned_this_month || e.employment_status === '离职');
        const activeList = all.filter(e => !isResigned(e));
        const resignedList = all.filter(isResigned);
        const regularList = activeList.filter(e => (e.employee_type || '正式工') === '正式工');
        const rehireList = activeList.filter(e => ['退休返聘', '返聘工'].includes(e.employee_type || ''));
        const otherRehireList = activeList.filter(e => e.employee_type === '其他-返聘工');
        const foreignList = activeList.filter(e => ['外籍工', '其他-外籍工'].includes(e.employee_type || ''));
        const taxOtherList = activeList.filter(e => ['外籍工', '其他-外籍工', '其他-返聘工', '其他-管理', '其他-正式工'].includes(e.employee_type || ''));
        const tempList = activeList.filter(e => ['临时工', '零工'].includes(e.employee_type || ''));
        
        const retWarningList = activeList.filter(is_employee_retirement_warning);
        const alreadyRetiredList = activeList.filter(e => !is_employee_retirement_warning(e) && is_employee_already_retired(e));
        const normalRetList = activeList.filter(e => !is_employee_retirement_warning(e) && !is_employee_already_retired(e));

        const readyCount = activeList.filter(e => employee_profile_health(e).complete).length;

        // 顶部 5 大核心 KPI 卡片 (临时工、离职员工完全独立，不合并混同)
        $('#tab1-active-total').text(`${all.length} 人`);
        $('#tab1-active-sub').text(`在职 ${activeList.length} 人 ｜ 离职 ${resignedList.length} 人`);
        
        $('#tab1-regular-rehire-total').text(`${regularList.length + rehireList.length} 人`);
        $('#tab1-regular-rehire-sub').text(`🛡️ 正式工 ${regularList.length} 人 ｜ 👴 返聘工 ${rehireList.length} 人`);
        
        $('#tab1-other-total').text(`${taxOtherList.length} 人`);
        $('#tab1-other-sub').text(`🌏 外籍工 ${foreignList.length} 人 ｜ 🏷️ 其他-返聘 ${otherRehireList.length} 人`);
        
        $('#tab1-temp-total').text(`${tempList.length} 人`);
        $('#tab1-temp-sub').text(`⏱️ 免申报 ｜ 独立免税不入账`);

        $('#tab1-resigned-total').text(`${resignedList.length} 人`);
        $('#tab1-resigned-sub').text(`🚪 当月发薪 ｜ 次月按规减员`);

        // 子类别芯片明细
        $('#tab1-type-regular').text(regularList.length);
        $('#tab1-type-rehire').text(rehireList.length);
        $('#tab1-type-other-rehire').text(otherRehireList.length);
        $('#tab1-type-foreign').text(foreignList.length);
        $('#tab1-type-temp').text(tempList.length);
        
        $('#tab1-ret-3m-warning').text(retWarningList.length);
        $('#tab1-ret-already-retired').text(alreadyRetiredList.length);
        $('#tab1-ret-normal').text(normalRetList.length);

        const query = String($('#qifu-emp-search').val() || '').trim().toLowerCase();
        const typeFilter = $('#qifu-emp-type-filter').val() || 'all';
        const statusFilter = $('#qifu-emp-status-filter').val() || 'all';
        const retFilter = $('#qifu-emp-ret-filter').val() || 'all';
        const profileFilter = $('#qifu-emp-profile-filter').val() || 'all';

        const getEmpTypeRank = (t) => {
            const str = String(t || '').trim();
            if (str === '正式工') return 1;
            if (['返聘工', '退休返聘', '其他-返聘工'].includes(str)) return 2;
            if (['临时工', '零工'].includes(str)) return 4;
            return 3;
        };
        const visibleList = all.filter(emp => {
            const resigned = isResigned(emp);
            const profile = employee_profile_health(emp);
            const empType = String(emp.employee_type || '正式工').trim();
            const isWarn = is_employee_retirement_warning(emp);
            const isRet = is_employee_already_retired(emp);

            const haystack = [emp.employee_no, emp.employee_name, emp.id_card, emp.job_title, emp.department, emp.employee_type, emp.external_name_aliases].join(' ').toLowerCase();
            if (query && !haystack.includes(query)) return false;

            // 状态过滤
            if (statusFilter === 'active' && resigned) return false;
            if (statusFilter === 'resigned' && !resigned) return false;

            // 用工性质过滤
            if (typeFilter === '正式工' && empType !== '正式工') return false;
            if (typeFilter === '返聘工' && !['退休返聘', '返聘工'].includes(empType)) return false;
            if (typeFilter === '其他-返聘工' && empType !== '其他-返聘工') return false;
            if (typeFilter === '其他-外籍工' && !['外籍工', '其他-外籍工'].includes(empType)) return false;
            if (typeFilter === '临时工' && !['临时工', '零工'].includes(empType)) return false;

            // 退休状态过滤
            if (retFilter === 'warning' && !isWarn) return false;
            if (retFilter === 'retired' && (!isRet || isWarn)) return false;
            if (retFilter === 'normal' && (isWarn || isRet)) return false;

            // 档案资料过滤
            if (profileFilter === 'complete' && !profile.complete) return false;
            if (profileFilter === 'incomplete' && profile.complete) return false;

            return true;
        });

        const retirementStatusBadge = (emp) => {
            const defaultAgeStr = emp.gender === '女' ? '50岁' : '60岁';
            const ageDisplay = emp.original_retirement_age_str || (emp.original_retirement_age ? `${emp.original_retirement_age}岁` : defaultAgeStr);
            if (is_employee_retirement_warning(emp)) {
                return '<span class="qifu-status-badge" style="background:#fef2f2;color:#991b1b;border:1px solid #fecaca;font-weight:700;">⚠️ 3个月内临退</span>';
            }
            if (is_employee_already_retired(emp)) {
                return '<span class="qifu-status-badge" style="background:#f1f5f9;color:#475569;border:1px solid #cbd5e1;font-weight:600;">👴 已达龄/返聘</span>';
            }
            return `<span class="qifu-status-badge" style="background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;font-weight:600;">✅ 正常 (原 ${ageDisplay})</span>`;
        };

        // 严格按用工类型排序：正式工 -> 返聘工 -> 其他类型 -> 临时工，相同类型按工号升序
        visibleList.sort((a, b) => {
            const rankA = getEmpTypeRank(a.employee_type);
            const rankB = getEmpTypeRank(b.employee_type);
            if (rankA !== rankB) return rankA - rankB;
            return String(a.employee_no || '').localeCompare(String(b.employee_no || ''));
        });

        $('#check-all-tab1-employees').prop('checked', false);
        let html = '';
        if (!visibleList.length) {
            html = '<tr><td colspan="13" style="text-align:center;padding:30px;color:#94a3b8;">当前筛选条件下没有员工档案</td></tr>';
        } else {
            visibleList.forEach((emp, idx) => {
                const resigned = isResigned(emp);
                const profile = employee_profile_health(emp);
                const totalAllowance = Number(emp.total_allowance || 0);
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
                let retCellHtml = '';
                if (isRehire) {
                    retCellHtml = `<td><div style="display:flex;align-items:center;justify-content:space-between;gap:4px;"><span class="qifu-status-badge" style="background:#f1f5f9;color:#475569;border:1px solid #cbd5e1;font-weight:600;">👴 已达龄/返聘</span><span style="font-size:10.5px;color:#64748b;">已退休</span></div><div class="qifu-emp-cell-sub">已到龄退休 ｜ ${origRetPeriod ? `退休年月 ${escHtml(origRetPeriod)}` : '未知退休年龄'}</div></td>`;
                } else if (is_employee_retirement_warning(emp)) {
                    retCellHtml = `<td><div style="display:flex;align-items:center;justify-content:space-between;gap:4px;"><span class="qifu-status-badge" style="background:#fef2f2;color:#991b1b;border:1px solid #fecaca;font-weight:700;">⚠️ 3个月内临退</span><span style="font-size:10.5px;color:#64748b;">原 ${escHtml(origAge)}</span></div><div class="qifu-emp-cell-sub">原到龄 ${escHtml(origRetPeriod || '未知')} ｜ 延迟 ${escHtml(delayAge)} (${escHtml(delayedRetPeriod)})</div></td>`;
                } else if (is_employee_already_retired(emp)) {
                    retCellHtml = `<td><div style="display:flex;align-items:center;justify-content:space-between;gap:4px;"><span class="qifu-status-badge" style="background:#f1f5f9;color:#475569;border:1px solid #cbd5e1;font-weight:600;">👴 已达龄/返聘</span><span style="font-size:10.5px;color:#64748b;">已到龄</span></div><div class="qifu-emp-cell-sub">已到龄退休 ｜ ${origRetPeriod ? `退休年月 ${escHtml(origRetPeriod)}` : '未知退休年龄'}</div></td>`;
                } else {
                    retCellHtml = `<td><div style="display:flex;align-items:center;justify-content:space-between;gap:4px;">${retirementStatusBadge(emp)}<span style="font-size:10.5px;color:#64748b;">原 ${escHtml(origAge)}</span></div><div class="qifu-emp-cell-sub">原到龄 ${escHtml(origRetPeriod || '未知')} ｜ 延迟 ${escHtml(delayAge)} (${escHtml(delayedRetPeriod)})</div></td>`;
                }

                html += `
                <tr style="${resigned ? 'background:#fff7f7;' : ''}">
                    <td style="text-align:center;"><input type="checkbox" class="tab1-emp-check" data-emp-no="${escHtml(emp.employee_no || '')}" data-emp-name="${escHtml(emp.employee_name || '')}"></td>
                    <td style="text-align:center;color:#94a3b8;">${idx + 1}</td>
                    <td style="text-align:center;"><strong>${escHtml(emp.employee_no || '-')}</strong></td>
                    <td><strong style="color:${resigned ? '#991b1b' : '#1e3a8a'};">${escHtml(emp.employee_name || '-')}</strong>${(emp.name_aliases || []).length ? `<div class="qifu-emp-cell-sub" title="外部工资表姓名别名">别名 ${(emp.name_aliases || []).map(x => escHtml(x.alias_name || '')).filter(Boolean).join(' / ')}</div>` : ''}</td>
                    <td><div class="qifu-emp-cell-main" style="font-family:monospace;font-size:12.5px;font-weight:600;color:#1e293b;">${escHtml(mask_employee_certificate(emp.id_card))}</div><div class="qifu-emp-cell-sub">${escHtml(emp.current_age_detail || (emp.current_age != null ? `${emp.current_age}岁` : '-'))} · ${escHtml(emp.gender || '-')} · ${escHtml(emp.certificate_type || '中国居民身份证')}</div></td>
                    <td><div class="qifu-emp-cell-main"><span class="qifu-status-badge ${resigned ? 'qifu-status-draft' : (emp.employee_type === '正式工' ? 'qifu-status-locked' : 'qifu-status-draft')}">${resigned ? '本月离职' : escHtml(emp.employee_type || '正式工')}</span></div>${emp.department ? `<div class="qifu-emp-cell-sub">${escHtml(emp.department)}</div>` : ''}</td>
                    <td><div class="qifu-emp-cell-main">${escHtml(emp.salary_mode || '未设置')} · ${fmtMoney(emp.fixed_salary)}</div><div class="qifu-emp-cell-sub">长期津贴 ${fmtMoney(totalAllowance)}</div></td>
                    <td class="qifu-money-cell" style="font-weight:700;${isRehire ? "color:#94a3b8;" : (isRegular && Number(emp.social_security_base || 0) <= 0 ? "background:#fee2e2;color:#dc2626;border:1px solid #f87171;" : "color:#1e40af;")}">${isRehire ? "-" : (isRegular && Number(emp.social_security_base || 0) <= 0 ? "<span style=\"color:#dc2626;font-weight:800;\">0.00 (未设基数)</span>" : fmtMoney(emp.social_security_base))}<div class="qifu-emp-cell-sub">${isRehire ? "免缴锁定" : (emp.social_security_base_mode === "自定义" ? "自定义基数" : "最低缴费基数")}</div></td>
                    <td class="qifu-money-cell" style="${isRehire ? "color:#94a3b8;" : (isRegular && Number(emp.housing_fund_base || 0) <= 0 ? "background:#fee2e2;border:1px solid #f87171;" : "")}"><div class="qifu-emp-cell-main" style="font-weight:700;color:${isRehire ? "#94a3b8" : (isRegular && Number(emp.housing_fund_base || 0) <= 0 ? "#dc2626" : "#0f766e")};">${isRehire ? "-" : (isRegular && Number(emp.housing_fund_base || 0) <= 0 ? "<span style=\"color:#dc2626;font-weight:800;\">0.00 (未设基数)</span>" : fmtMoney(emp.housing_fund_base))}</div><div class="qifu-emp-cell-sub" style="font-size:11px;color:${isRegular && Number(emp.housing_fund_base || 0) <= 0 ? "#b91c1c" : "#64748b"};">${isRehire ? "免缴锁定" : escHtml(emp.housing_fund_policy || "跟随公司规则")}</div></td>
                    <td class="qifu-money-cell"><strong>${fmtMoney(emp.total_deduction || emp.special_deductions_total)}</strong></td>
                    ${retCellHtml}
                    <td style="text-align:center;"><span class="qifu-status-badge ${profile.complete ? 'qifu-profile-ok' : 'qifu-profile-warn'}" title="${escHtml(profileTitle)}">${profile.complete ? '资料完整' : `待完善 ${profile.missing.length}项`}</span></td>
                    <td style="text-align:center;white-space:nowrap;"><button class="btn btn-default btn-xs btn-edit-emp" data-id="${escHtml(emp.name || '')}" data-emp-no="${escHtml(emp.employee_no || '')}" style="color:#2563eb;margin-right:4px;">修改</button>${resigned ? `<button class="btn btn-default btn-xs btn-unresign-emp" data-emp-no="${escHtml(emp.employee_no || '')}" data-emp-name="${escHtml(emp.employee_name || '')}" style="color:#059669;border-color:#86efac;">恢复</button>` : `<button class="btn btn-default btn-xs btn-resign-emp" data-emp-no="${escHtml(emp.employee_no || '')}" data-emp-name="${escHtml(emp.employee_name || '')}" style="color:#dc2626;border-color:#fca5a5;">离职</button>`}</td>
                </tr>`;
            });
        }
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

                let trs = '';
                rows.forEach(r => {
                    trs += `
                    <tr>
                        <td class="qifu-col-sticky-1" style="text-align:center; color:#94a3b8;">${r.seq}</td>
                        <td class="qifu-col-sticky-2" style="text-align:center;"><strong>${r.employee_no}</strong></td>
                        <td class="qifu-col-sticky-3"><strong style="color:#1e3a8a;">${r.employee_name}</strong></td>
                        <td class="qifu-money-cell">${r.work_days || 0}</td>
                        <td class="qifu-money-cell">${r.work_hours || 0}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.day_salary)}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.hour_salary)}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.full_attendance)}</td>
                        <td class="qifu-money-cell">${r.overtime_hours || 0}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.overtime_salary)}</td>
                        <td class="qifu-money-cell">${r.national_days || 0}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.national_salary)}</td>
                        <td style="text-align:center;">${r.target_rate || '-'}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.target_salary)}</td>
                        <td class="qifu-money-cell" style="color:#dc2626;">${fmtMoney(r.deduction)}</td>
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
                    <td class="qifu-money-cell" style="color:#dc2626;">${fmtMoney(tot.deduction)}</td>
                    <td class="qifu-money-cell">${fmtMoney(tot.workshop_net)}</td>
                    <td class="qifu-money-cell" style="color:#b45309;">${fmtMoney(tot.post_allowance)}</td>
                    <td class="qifu-money-cell" style="color:#b45309;">${fmtMoney(tot.house_rent_allowance)}</td>
                    <td class="qifu-money-cell" style="color:#b45309;">${fmtMoney(tot.subsidies_total)}</td>
                    <td class="qifu-money-cell" style="color:#2563eb;">${fmtMoney(tot.payable_total)}</td>
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
    function load_social_insurance_tab() {
        frappe.call({
            method: 'ashan_cn_procurement.services.payroll_settlement_service.get_social_insurance_sheet',
            args: { company: COMPANY, period_month: current_month },
            callback: function(r) {
                if (!r.message) return;
                const ins = r.message;
                const rows = ins.rows || [];
                const tot = ins.totals || {};

                $("#ins-tab3-ss-grand").text(fmtMoney(tot.grand_total));
                $("#ins-tab3-ss-sub").text(`单位: ${fmtMoney(tot.comp_total)} | 个人: ${fmtMoney(tot.pers_total)}`);
                if (rows.length > 0) {
                    $("#ins-tab3-ss-base").text(fmtMoney(rows[0].ss_base));
                }

                let trs = '';
                rows.forEach(r => {
                    const isAdj = !!r.adj_id;
                    const isAutoBase = !isAdj && (r.social_security_base_mode !== '自定义');
                    trs += `
                    <tr style="${isAdj ? 'background:#fffbeb;' : ''}">
                        <td class="qifu-col-sticky-1" style="text-align:center; color:#94a3b8;">${r.seq}</td>
                        <td class="qifu-col-sticky-2" style="text-align:center;"><strong>${r.employee_no}</strong></td>
                        <td class="qifu-col-sticky-3">
                            <strong style="color:#2563eb;">${r.employee_name}</strong>
                            ${isAdj ? `<span class="qifu-status-badge qifu-status-draft" style="font-size:10px; margin-left:4px;">${r.biz_type}</span> <a href="javascript:void(0)" class="btn-del-ss-adj" data-id="${r.adj_id}" style="color:#dc2626; font-size:11px; margin-left:4px;" title="删除此补缴/调整项">🗑️</a>` : ''}
                        </td>
                        <td style="text-align:center; font-family:monospace;">${r.id_card || '-'}</td>
                        <td style="text-align:center; font-weight:${isAdj ? '700; color:#b45309;' : 'normal;'}">${r.period_month_str}</td>
                        <td style="text-align:center;">${r.employee_type}</td>
                        <td class="qifu-money-cell ${isAutoBase ? 'qifu-cell-auto-derived' : ''}" style="font-weight:600; white-space:nowrap;" title="${isAutoBase ? '已绑定最低基数（自动获取）' : (isAdj ? '历史补缴' : '自定义基数')}">${fmtMoney(r.ss_base)}${!isAdj ? ` <button class="btn btn-xs btn-default btn-edit-contribution-base" data-kind="social_security" data-emp="${r.employee_no}" data-name="${frappe.utils.escape_html(r.employee_name || '')}" data-value="${Number(r.ss_base || 0)}" data-base-mode="${frappe.utils.escape_html(r.social_security_base_mode || '最低缴费基数')}" title="调整社保基数方式并自动重算" style="padding:1px 5px; margin-left:4px; color:#2563eb;">✎</button>` : ''}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.comp_pension)}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.comp_unemp)}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.comp_med)}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.comp_other_med)}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.comp_injury)}</td>
                        <td class="qifu-money-cell" style="color:#1e40af; font-weight:700;">${fmtMoney(r.comp_total)}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.pers_pension)}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.pers_unemp)}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.pers_med)}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.pers_large_med)}</td>
                        <td class="qifu-money-cell" style="color:#166534; font-weight:700;">${fmtMoney(r.pers_total)}</td>
                        <td class="qifu-money-cell" style="color:#c2410c; font-weight:800; font-size:13px;">
                            ${fmtMoney(r.grand_total)}
                            ${r.late_fee > 0 ? `<div style="font-size:10px; color:#dc2626; font-weight:normal;">(含滞纳金 ${fmtMoney(r.late_fee)})</div>` : ''}
                        </td>
                    </tr>
                    `;
                });
                $("#tbody-tab3-ss-sheet").html(trs);
                setTimeout(adjust_active_table_height, 50);
                setTimeout(function() {
                    sync_dual_scrollbars($("#tab3-top-scrollbar"), $("#tab3-table-box"));
                }, 100);

                let tfoot_html = `
                <tr>
                    <td colspan="3" class="qifu-col-sticky-foot">合计 (${rows.length}人)</td>
                    <td colspan="2" style="background:#f8fafc;"></td>
                    <td style="text-align:center; font-weight:700; color:#1e40af;">${rows.length}人参保</td>
                    <td class="qifu-money-cell">${fmtMoney(tot.ss_base)}</td>
                    <td class="qifu-money-cell">${fmtMoney(tot.comp_pension)}</td>
                    <td class="qifu-money-cell">${fmtMoney(tot.comp_unemp)}</td>
                    <td class="qifu-money-cell">${fmtMoney(tot.comp_med)}</td>
                    <td class="qifu-money-cell">${fmtMoney(tot.comp_other_med)}</td>
                    <td class="qifu-money-cell">${fmtMoney(tot.comp_injury)}</td>
                    <td class="qifu-money-cell" style="color:#1e40af; font-weight:700;">${fmtMoney(tot.comp_total)}</td>
                    <td class="qifu-money-cell">${fmtMoney(tot.pers_pension)}</td>
                    <td class="qifu-money-cell">${fmtMoney(tot.pers_unemp)}</td>
                    <td class="qifu-money-cell">${fmtMoney(tot.pers_med)}</td>
                    <td class="qifu-money-cell">${fmtMoney(tot.pers_large_med)}</td>
                    <td class="qifu-money-cell" style="color:#166534; font-weight:700;">${fmtMoney(tot.pers_total)}</td>
                    <td class="qifu-money-cell" style="color:#c2410c; font-size:13px; font-weight:800;">${fmtMoney(tot.grand_total)}</td>
                </tr>
                `;
                $("#tfoot-tab3-ss-sheet").html(tfoot_html);
            }
        });
    }

    // 4. 加载 Tab 4: 公积金台账、季度自动规则与例外
    function load_housing_fund_tab() {
        load_housing_fund_roster_change_preview();
        frappe.call({
            method: 'ashan_cn_procurement.services.payroll_settlement_service.get_housing_fund_sheet',
            args: { company: COMPANY, period_month: current_month, include_non_contributors: 0 },
            callback: function(r) {
                if (!r.message) return;
                const hf = r.message;
                const rows = hf.rows || [];
                const tot = hf.totals || {};
                const rule = hf.policy_rule || {};
                const rate = hf.rate_setting || {};
                const scheduled = !!rule.is_scheduled_month;
                const payrollPeriod = rule.payroll_period_month || hf.period_month || current_month;
                const paymentPeriod = rule.payment_period_month || hf.payment_period_month || current_month;
                const schedulePeriod = rule.schedule_period_month || rule.rule_period_month || paymentPeriod;
                const paymentMonthNum = parseInt((paymentPeriod.split('-')[1] || '0'), 10);
                const scheduleMonthNum = parseInt((schedulePeriod.split('-')[1] || '0'), 10);
                const ruleMonths = (rule.months || [1,4,7,10]).join(' / ');

                $('#ins-tab4-rule-status').text(rule.enabled === false ? `缴费 ${paymentMonthNum}月 · 自动规则已关闭` : (scheduled ? `缴费 ${paymentMonthNum}月 · 按公积金 ${scheduleMonthNum}月规则自动缴纳` : `缴费 ${paymentMonthNum}月 · 按公积金 ${scheduleMonthNum}月规则自动停缴`));
                $('#ins-tab4-rule-sub').text(`公积金缴费月 ${ruleMonths} · 当前按实际缴费 ${scheduleMonthNum}月判断 · 其他缴费月${rule.off_action || '停缴'}`);
                $('#ins-tab4-policy-tip').text(`工资核算 ${payrollPeriod} → 实际缴费/凭证 ${paymentPeriod}${rule.enabled === false ? ' · 按长期基数执行' : (scheduled ? ' · 当前命中公积金自动缴纳' : ' · 当前未命中公积金自动缴纳')}`);
                $('#ins-tab4-contrib-count').text(`${tot.contributor_count || 0} 人`);
                $('#ins-tab4-contrib-sub').text(`公司规则 ${tot.company_rule_contributor_count || 0} 人 · 常年固定 ${tot.fixed_on_contributor_count || 0} 人 · 单月例外 ${tot.override_on_contributor_count || 0} 人 · 未参缴 ${tot.stopped_count || 0} 人`);
                $('#ins-tab4-rate-pair').text(`${Number(rate.company_rate || 0).toFixed(2)}% / ${Number(rate.person_rate || 0).toFixed(2)}%`);
                $('#ins-tab4-hf-base').text(`最低基数 ${fmtMoney(rate.minimum_base || 0)}`);
                $('#ins-tab4-hf-grand').text(fmtMoney(tot.total_amount));
                $('#ins-tab4-hf-sub').text(`单位: ${fmtMoney(tot.comp_amount)} | 个人: ${fmtMoney(tot.pers_amount)}`);

                const statusBadge = (row) => {
                    if (row.is_contributing) {
                        const bg = row.monthly_override ? '#fff7ed' : (row.housing_fund_policy === '固定缴纳' ? '#f5f3ff' : '#ecfdf5');
                        const color = row.monthly_override ? '#c2410c' : (row.housing_fund_policy === '固定缴纳' ? '#6d28d9' : '#047857');
                        return `<span class="qifu-status-badge" style="background:${bg};color:${color};border:1px solid #d1fae5;" title="${escHtml(row.policy_reason || '')}">${escHtml(row.policy_label || '缴纳')}</span>`;
                    }
                    return `<span class="qifu-status-badge" style="background:#f8fafc;color:#64748b;border:1px solid #e2e8f0;" title="${escHtml(row.policy_reason || '')}">${escHtml(row.policy_label || '停缴')}</span>`;
                };

                let trs = '';
                rows.forEach(row => {
                    const muted = row.is_contributing ? '' : 'background:#fbfdff;color:#64748b;';
                    const policyText = row.housing_fund_policy || '跟随公司规则';
                    const overrideTip = row.monthly_override ? `<div style="font-size:10px;color:#d97706;margin-top:2px;">${escHtml(row.monthly_override)}</div>` : '';
                    trs += `
                    <tr style="${muted}">
                        <td class="qifu-col-sticky-1" style="text-align:center;color:#94a3b8;">${row.seq}</td>
                        <td class="qifu-col-sticky-2" style="text-align:center;"><strong>${escHtml(row.employee_no || '-')}</strong></td>
                        <td class="qifu-col-sticky-3"><strong style="color:#2563eb;">${escHtml(row.employee_name || '-')}</strong></td>
                        <td style="text-align:center;">${escHtml(row.employee_type || '-')}</td>
                        <td class="qifu-money-cell" style="font-weight:600;">${fmtMoney(row.master_hf_base || 0)}</td>
                        <td style="text-align:center;"><div>${escHtml(policyText)}</div>${overrideTip}</td>
                        <td style="text-align:center;">${statusBadge(row)}<div style="font-size:10px;color:#94a3b8;margin-top:2px;">${escHtml(row.policy_source || '')}</div></td>
                        <td class="qifu-money-cell" style="font-weight:700;color:${row.is_contributing ? '#1d4ed8' : '#94a3b8'};">${fmtMoney(row.hf_base || 0)}</td>
                        <td style="text-align:center;">${Number(row.comp_rate || 0).toFixed(2)}%</td>
                        <td class="qifu-money-cell" style="color:#0369a1;font-weight:600;">${fmtMoney(row.comp_amount || 0)}</td>
                        <td style="text-align:center;">${Number(row.pers_rate || 0).toFixed(2)}%</td>
                        <td class="qifu-money-cell" style="color:#15803d;font-weight:600;">${fmtMoney(row.pers_amount || 0)}</td>
                        <td class="qifu-money-cell" style="color:#c2410c;font-weight:800;font-size:13px;">${fmtMoney(row.total_amount || 0)}</td>
                        <td style="text-align:center;white-space:nowrap;"><button class="btn btn-default btn-xs btn-hf-row-override" data-emp="${escHtml(row.employee_no || '')}" data-name="${escHtml(row.employee_name || '')}" data-mode="${escHtml(row.monthly_override || '')}" title="设置仅当前账期生效的例外">例外</button></td>
                    </tr>`;
                });
                if (!rows.length) {
                    trs = `<tr><td colspan="14" style="text-align:center;padding:30px;color:#94a3b8;">当前账期暂无可展示员工。</td></tr>`;
                }
                $('#tbody-tab4-hf-sheet').html(trs);

                const tfootHtml = `
                <tr>
                    <td colspan="3" class="qifu-col-sticky-foot">合计 · 本表 ${tot.display_row_count ?? rows.length} 人</td>
                    <td colspan="3" style="text-align:center;color:#64748b;">参缴 ${tot.contributor_count || 0} 人 · 停缴 ${tot.stopped_count || 0} 人</td>
                    <td style="text-align:center;color:#1e40af;font-weight:700;">本月结果</td>
                    <td class="qifu-money-cell">${fmtMoney(tot.hf_base)}</td>
                    <td style="text-align:center;">${Number(rate.company_rate || 0).toFixed(2)}%</td>
                    <td class="qifu-money-cell" style="color:#0369a1;font-weight:700;">${fmtMoney(tot.comp_amount)}</td>
                    <td style="text-align:center;">${Number(rate.person_rate || 0).toFixed(2)}%</td>
                    <td class="qifu-money-cell" style="color:#15803d;font-weight:700;">${fmtMoney(tot.pers_amount)}</td>
                    <td class="qifu-money-cell" style="color:#c2410c;font-size:13px;font-weight:800;">${fmtMoney(tot.total_amount)}</td>
                    <td></td>
                </tr>`;
                $('#tfoot-tab4-hf-sheet').html(tfootHtml);
                setTimeout(adjust_active_table_height, 50);
            }
        });
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

    // 5. 加载 Tab 5: 个人所得税核定与申报台账 · 支持【✨ 财税精简版 (17列)】与【📑 VBA 68列完整核算台账】
    function render_tax_simple_table(data, cur_m) {
        $("#table-tab5-tax-sheet").addClass("qifu-tax-simple-table").css("min-width", "1760px");
        const rows = data.rows || [];
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
                    <td class="qifu-col-sticky-1" style="text-align:center; color:#94a3b8;">${r.seq}</td>
                    <td class="qifu-col-sticky-2" style="text-align:center;"><strong>${r.employee_no}</strong></td>
                    <td class="qifu-col-sticky-3">
                        <a href="javascript:void(0);" class="btn-drill-emp-history" data-emp="${r.employee_no}" style="color:#2563eb; font-weight:700; text-decoration:underline;" title="点击穿透查看 ${r.employee_name} 整个申报周期的月度发薪与个税轨迹">
                            ${r.employee_name} 🔍
                        </a>
                    </td>
                    <td style="text-align:center; font-family:monospace;">${r.id_card || '-'}</td>
                    <td style="text-align:center;"><span class="qifu-status-badge qifu-status-locked" style="background:#e0e7ff; color:#3730a3;">${r.employee_type || '正式工'}</span></td>
                    <td style="text-align:center;">${cur_m}</td>
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
            <td style="text-align:center;">-</td>
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
        $("#table-tab5-tax-sheet").removeClass("qifu-tax-simple-table").css("min-width", "6200px");
        const rows = data.rows || [];
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
            {k:'salary_mode', l:'工资类型', g:'员工基本信息', t:'text'},
            // 工资扣除本月 5
            {k:'gross_salary', l:'税前工资', g:'工资扣除(本月)', t:'money'},
            {k:'thresh_cur', l:'起征点扣除', g:'工资扣除(本月)', t:'money'},
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
        const head = `<tr>${cols.map((c,i) => `<th class="${stickyClass(i)}" style="background:${groupStyle[c.g] || '#f8fafc'}; text-align:center; vertical-align:middle; min-width:${i===2?110:(i===3?150:92)}px;">
            <div style="font-size:9px; color:#64748b; font-weight:600; white-space:nowrap;">${c.g}</div><div style="font-weight:700; white-space:nowrap;">${c.l}</div>
        </th>`).join('')}</tr>`;

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
                    $("#tax-kpi-total").text(fmtMoney(tot.tax_amount || tot.current_tax || 0));
                    $("#tax-kpi-gross").text(fmtMoney(tot.gross_salary));
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
                    $("#tax-kpi-total").text(fmtMoney(tot.tax_current));
                    $("#tax-kpi-gross").text(fmtMoney(tot.gross_salary));
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

    function render_payroll_view(data) {
        const kpi = data.kpi_summary || {};

        // 卡片 1: 人员结构
        const formatEmpCountWithZero = (cnt, zeroCnt, color) => {
            let str = `<strong style="color:${color};">${cnt || 0} 人</strong>`;
            if (zeroCnt && zeroCnt > 0) {
                str += ` <span style="font-size:11px; color:#ef4444; font-weight:600; margin-left:4px;">(其中 ${zeroCnt}人 0工资)</span>`;
            }
            return str;
        };

        $("#kpi-emp-total").text(kpi.total_profile_count || data.total_employees || 0);
        $("#kpi-emp-insured").html(formatEmpCountWithZero(kpi.regular_count || kpi.insured_count, kpi.regular_zero_count || kpi.insured_zero_count, '#2563eb'));
        $("#kpi-emp-rehire").html(formatEmpCountWithZero(kpi.rehire_count, kpi.rehire_zero_count, '#d97706'));
        $("#kpi-emp-temp").html(formatEmpCountWithZero(kpi.temp_count, kpi.temp_zero_count, '#059669'));
        $("#kpi-emp-other").html(formatEmpCountWithZero(kpi.other_count, kpi.other_zero_count, '#64748b'));
        $("#kpi-emp-resigned").text((kpi.resigned_count || 0) + ' 人');

        // 卡片 2: 社保统筹
        $("#kpi-ss-badge").text(`实际缴费月: ${kpi.ss_payment_month_name || ''} · 所属期: ${kpi.ss_period_month_str || ''}`);
        $("#kpi-ss-grand").text(fmtMoney(kpi.ss_grand_total));
        $("#kpi-ss-comp").text(fmtMoney(kpi.ss_comp_total));
        $("#kpi-ss-pers").text(fmtMoney(kpi.ss_pers_total));
        $("#kpi-ss-count").text(kpi.ss_count || 0);
        $("#kpi-ss-base").text(fmtMoney(kpi.ss_base_total));

        // 卡片 3: 公积金统筹
        $("#kpi-hf-badge").text(`实际缴费月: ${kpi.hf_payment_month_name || ''} · 所属期: ${kpi.hf_period_month_str || ''}`);
        $("#kpi-hf-grand").text(fmtMoney(kpi.hf_grand_total));
        $("#kpi-hf-comp").text(fmtMoney(kpi.hf_comp_total));
        $("#kpi-hf-pers").text(fmtMoney(kpi.hf_pers_total));
        $("#kpi-hf-count").text(kpi.hf_count || 0);
        $("#kpi-hf-base").text(fmtMoney(kpi.hf_base_total));

        // 卡片 4: 发薪总盘与个税
        $("#kpi-payroll-badge").text(`发薪: ${kpi.payroll_period_month || current_month} (在册 ${kpi.payroll_emp_count || 0}人)`);
        $("#kpi-total-net").text(fmtMoney(data.total_net_salary));
        $("#kpi-total-gross").text(fmtMoney(data.total_gross_salary));
        $("#kpi-total-tax").text(fmtMoney(data.total_tax));
        $("#kpi-total-person-ded").text(fmtMoney(kpi.total_person_deductions));

        const items = data.items || [];
        if (items.length === 0) {
            $("#tbody-qifu-payroll").html('<tr><td colspan="16" style="text-align:center; padding:30px; color:#94a3b8;">暂无当月核算数据，请点击上方【2. 外部实发导入与薪资发放表】上传车间实发表</td></tr>');
            return;
        }

        let html = '';
        items.forEach((it, idx) => {
            const jobTitle = it.job_title || '操作工';
            const empType = it.employee_type || '正式工';
            const attDays = it.attendance_days || 0;
            const workHours = it.work_hours || 0;
            const attStr = `${attDays}天 / ${workHours}h`;
            const workshopNet = (it.net_salary || 0) - (it.post_allowance || 0) - (it.house_rent_allowance || 0);

            html += `
            <tr>
                <td class="qifu-col-sticky-1" style="color:#94a3b8; text-align:center;">${idx + 1}</td>
                <td class="qifu-col-sticky-2" style="text-align:center;"><strong>${it.employee_no || '-'}</strong></td>
                <td class="qifu-col-sticky-3"><strong style="color:#1e3a8a;">${it.employee_name}</strong></td>
                <td><span class="qifu-status-badge ${empType === '正式工' ? 'qifu-status-locked' : 'qifu-status-draft'}">${empType}</span></td>
                <td>${attStr}</td>
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
    }

    // ==========================================
    // 模态框与高级功能
    // ==========================================

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
                title: `🗓️ 公积金自动缴纳规则 · 实际缴费月`,
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
                body += `<tr><td>${escHtml(row.employee_no || '')}</td><td><strong>${escHtml(row.employee_name || '')}</strong></td><td style="text-align:right;">${fmtMoney(row.housing_fund_base || 0)}</td><td><select class="form-control input-xs hf-long-policy-select" data-emp="${escHtml(row.employee_no || '')}" style="height:28px;padding:2px 6px;">${opts}</select></td><td><span style="color:${row.is_contributing ? '#059669' : '#64748b'};font-weight:700;">${escHtml(row.decision_label || '')}</span></td></tr>`;
            });
            body += `</tbody></table></div>`;
            const d = new frappe.ui.Dialog({
                title:'👥 员工公积金长期策略', size:'large',
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
                title:`✳️ ${current_month} 公积金本月例外`,
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
                const d = new frappe.ui.Dialog({
                    title:`⚙️ ${year} 年公积金比例与基数`,
                    fields:[
                        {fieldtype:'HTML',fieldname:'help',options:`<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:9px 11px;font-size:12px;color:#475569;line-height:1.6;">这里只维护年度公积金比例和默认最低基数。缴纳月份请使用“自动缴纳规则”，特殊人员请使用“员工长期策略”。</div>`},
                        {fieldtype:'Percent',fieldname:'hf_company_rate',label:'单位缴存比例 (%)',default:ins.hf_company_rate || 5,reqd:1},
                        {fieldtype:'Percent',fieldname:'hf_person_rate',label:'个人缴存比例 (%)',default:ins.hf_person_rate || 5,reqd:1},
                        {fieldtype:'Currency',fieldname:'hf_min_base',label:'公积金最低基数',default:ins.hf_min_base || 2320,reqd:1}
                    ],
                    primary_action_label:'保存比例与基数',
                    primary_action(values) {
                        frappe.call({
                            method:'ashan_cn_procurement.services.employee_salary_service.save_insurance_setting',type:'POST',
                            args:{company:COMPANY,year:year,data:JSON.stringify(values),period_month:current_month},
                            callback:function(res){if(res.message&&res.message.success){frappe.show_alert({message:'公积金比例与基数已保存',indicator:'green'});d.hide();load_housing_fund_tab();load_tax_settlement_tab();load_payroll_settlement();}}
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
                    title: `⚙️ 修改【${COMPANY}】${year} 年度社保公积金配置`,
                    size: 'large',
                    fields: [
                        { fieldtype: 'Section Break', label: '🏢 单位社保缴费比例 (%)' },
                        { fieldname: 'ss_company_pension', fieldtype: 'Percent', label: '单位基本养老 (%)', default: ins.ss_company_pension || 16.0, reqd: 1 },
                        { fieldname: 'ss_company_unemployment', fieldtype: 'Percent', label: '单位失业保险 (%)', default: ins.ss_company_unemployment || 0.5, reqd: 1 },
                        { fieldname: 'ss_company_medical', fieldtype: 'Percent', label: '单位基本医疗 (%)', default: ins.ss_company_medical || 10.0, reqd: 1 },
                        { fieldname: 'ss_company_other_medical', fieldtype: 'Percent', label: '单位其他医疗 (%)', default: ins.ss_company_other_medical || 0.5, reqd: 1 },
                        { fieldname: 'ss_company_injury', fieldtype: 'Percent', label: '单位工伤保险 (%)', default: ins.ss_company_injury || 0.55, reqd: 1 },

                        { fieldtype: 'Section Break', label: '👤 个人社保扣缴比例与救助金' },
                        { fieldname: 'ss_person_pension', fieldtype: 'Percent', label: '个人基本养老 (%)', default: ins.ss_person_pension || 8.0, reqd: 1 },
                        { fieldname: 'ss_person_unemployment', fieldtype: 'Percent', label: '个人失业保险 (%)', default: ins.ss_person_unemployment || 0.5, reqd: 1 },
                        { fieldname: 'ss_person_medical', fieldtype: 'Percent', label: '个人基本医疗 (%)', default: ins.ss_person_medical || 2.0, reqd: 1 },
                        { fieldname: 'big_medical_amount_default', fieldtype: 'Currency', label: '大额医疗基准金额 (元/月)', default: ins.big_medical_amount_default || 22.0, reqd: 1 },
                        { fieldname: 'big_medical_amount_special', fieldtype: 'Currency', label: '大额医疗特殊月份金额 (元/月)', default: ins.big_medical_amount_special || 21.0, reqd: 1 },
                        { fieldname: 'big_medical_special_months', fieldtype: 'Data', label: '特殊金额生效月份 (如: 3,12)', default: ins.big_medical_special_months || '3,12', reqd: 1 },

                        { fieldtype: 'Section Break', label: '🧷 社保最低缴费基数' },
                        { fieldtype: 'HTML', fieldname: 'ss_minimum_help', options: '<div class="ashan-callout ashan-callout--sm">员工默认绑定“最低缴费基数”。保存新的最低基数后，所有绑定员工会自动联动；只有选择“自定义”的员工保持个人基数。</div>' },
                        { fieldname: 'ss_min_base', fieldtype: 'Currency', label: '社保最低缴费基数 (元)', default: ins.ss_min_base || 5013.0, reqd: 1 },

                        { fieldtype: 'Section Break', label: '🏠 住房公积金缴费比例与最低基数' },
                        { fieldname: 'hf_company_rate', fieldtype: 'Percent', label: '单位公积金比例 (%)', default: ins.hf_company_rate || 5.0, reqd: 1 },
                        { fieldname: 'hf_person_rate', fieldtype: 'Percent', label: '个人公积金比例 (%)', default: ins.hf_person_rate || 5.0, reqd: 1 },
                        { fieldname: 'hf_min_base', fieldtype: 'Currency', label: '公积金最低缴费基数 (元)', default: ins.hf_min_base || 2320.0, reqd: 1 }
                    ],
                    primary_action_label: '💾 保存社保公积金配置',
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
                        <td style="text-align:center;">${b.level}</td>
                        <td>${rangeText}</td>
                        <td style="text-align:center; font-weight:700;">${b.rate}%</td>
                        <td class="qifu-money-cell">${fmtMoney(b.quick_deduction)}</td>
                    </tr>`;
                }).join('');

                const d = new frappe.ui.Dialog({
                    title: `⚙️ 个税参数设置 · ${year} 年`,
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
                    primary_action_label: '💾 保存个税参数',
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
                    <tr style="${isAdj ? 'background:#fffbeb;' : ''}">
                        <td style="text-align:center; color:#94a3b8;">${r.seq}</td>
                        <td style="text-align:center;"><strong>${r.employee_no}</strong></td>
                        <td>
                            <strong style="color:#2563eb;">${r.employee_name}</strong>
                            ${isAdj ? `<span class="qifu-status-badge qifu-status-draft" style="font-size:10px; margin-left:4px;">${r.biz_type}</span> <a href="javascript:void(0)" class="btn-del-ss-adj" data-id="${r.adj_id}" style="color:#dc2626; font-size:11px; margin-left:4px;" title="删除此补缴/调整项">🗑️</a>` : ''}
                        </td>
                        <td style="text-align:center; font-family:monospace;">${r.id_card || '-'}</td>
                        <td style="text-align:center; font-weight:${isAdj ? '700; color:#b45309;' : 'normal;'}">${r.period_month_str}</td>
                        <td style="text-align:center;">${r.employee_type}</td>
                        <td class="qifu-money-cell ${isAutoBase ? 'qifu-cell-auto-derived' : ''}" style="font-weight:600; white-space:nowrap;" title="${isAutoBase ? '已绑定最低基数（自动获取）' : (isAdj ? '历史补缴' : '自定义基数')}">${fmtMoney(r.ss_base)}${!isAdj ? ` <button class="btn btn-xs btn-default btn-edit-contribution-base" data-kind="social_security" data-emp="${r.employee_no}" data-name="${frappe.utils.escape_html(r.employee_name || '')}" data-value="${Number(r.ss_base || 0)}" data-base-mode="${frappe.utils.escape_html(r.social_security_base_mode || '最低缴费基数')}" title="调整社保基数方式并自动重算" style="padding:1px 5px; margin-left:4px; color:#2563eb;">✎</button>` : ''}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.comp_pension)}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.comp_unemp)}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.comp_med)}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.comp_other_med)}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.comp_injury)}</td>
                        <td class="qifu-money-cell" style="color:#1e40af; font-weight:700;">${fmtMoney(r.comp_total)}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.pers_pension)}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.pers_unemp)}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.pers_med)}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.pers_large_med)}</td>
                        <td class="qifu-money-cell" style="color:#166534; font-weight:700;">${fmtMoney(r.pers_total)}</td>
                        <td class="qifu-money-cell" style="color:#c2410c; font-weight:800; font-size:13px;">
                            ${fmtMoney(r.grand_total)}
                            ${r.late_fee > 0 ? `<div style="font-size:10px; color:#dc2626; font-weight:normal;">(含滞纳金 ${fmtMoney(r.late_fee)})</div>` : ''}
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
                        <button class="btn btn-default btn-xs" id="btn-modal-add-ss-adj" style="color:#b45309; border-color:#fde68a; background:#fef3c7; font-weight:600;">➕ 登记特殊补缴/滞纳金</button>
                        <button class="btn btn-primary btn-xs" id="btn-modal-export-ins" style="background:#059669; border-color:#059669; font-weight:600;">📥 导出此表为 Excel</button>
                        <button class="btn btn-default btn-xs" id="btn-modal-print-ins" style="font-weight:600;">🖨️ 打印/导出 PDF</button>
                    </div>
                </div>
                <div class="qifu-modal-table-scroll">
                    <table class="qifu-table table-bordered" id="table-modal-ins-sheet" style="font-size:11.5px; margin-bottom:0; min-width:1600px;">
                        <thead style="position:sticky; top:0; background:#f8fafc; z-index:1;">
                            <tr style="background:#f1f5f9; text-align:center; font-weight:700;">
                                <th colspan="7" style="background:#e0e7ff; color:#3730a3;">员工基本信息</th>
                                <th colspan="6" style="background:#dbeafe; color:#1e40af;">单位缴纳</th>
                                <th colspan="5" style="background:#dcfce7; color:#166534;">个人缴纳</th>
                                <th style="background:#ffedd5; color:#9a3412;">总合计</th>
                            </tr>
                            <tr>
                                <th style="width:36px;">序号</th>
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
                                <td style="text-align:center;">0</td>
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
                        <td style="text-align:center;"><strong>${r.employee_no}</strong></td>
                        <td><strong style="color:#2563eb;">${r.employee_name}</strong></td>
                        <td style="text-align:center; font-family:monospace;">${r.id_card || '-'}</td>
                        <td style="text-align:center;">${r.period_month_str}</td>
                        <td style="text-align:center;">${r.employee_type}</td>
                        <td class="qifu-money-cell" style="font-weight:600; white-space:nowrap;">${fmtMoney(r.hf_base)} <button class="btn btn-xs btn-default btn-edit-contribution-base" data-kind="housing_fund" data-emp="${r.employee_no}" data-name="${frappe.utils.escape_html(r.employee_name || '')}" data-value="${Number(r.hf_base || 0)}" title="单人调整公积金基数并自动重算" style="padding:1px 5px; margin-left:4px; color:#0f766e;">✎</button></td>
                        <td style="text-align:center;">${r.comp_rate}%</td>
                        <td class="qifu-money-cell" style="color:#0369a1; font-weight:600;">${fmtMoney(r.comp_amount)}</td>
                        <td style="text-align:center;">${r.pers_rate}%</td>
                        <td class="qifu-money-cell" style="color:#15803d; font-weight:600;">${fmtMoney(r.pers_amount)}</td>
                        <td class="qifu-money-cell" style="color:#c2410c; font-weight:800; font-size:13px;">${fmtMoney(r.total_amount)}</td>
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
                        <button class="btn btn-primary btn-xs" id="btn-modal-export-hf" style="background:#059669; border-color:#059669; font-weight:600;">📥 导出此表为 Excel</button>
                        <button class="btn btn-default btn-xs" id="btn-modal-print-hf" style="font-weight:600;">🖨️ 打印/导出 PDF</button>
                    </div>
                </div>
                <div class="qifu-modal-table-scroll">
                    <table class="qifu-table table-bordered" id="table-modal-hf-sheet" style="font-size:11.5px; margin-bottom:0;">
                        <thead style="position:sticky; top:0; background:#f8fafc; z-index:1;">
                            <tr style="background:#f1f5f9; text-align:center; font-weight:700;">
                                <th colspan="6" style="background:#ccfbf1; color:#0f766e;">员工基本信息</th>
                                <th colspan="3" style="background:#e0f2fe; color:#0369a1;">单位缴存 (5%)</th>
                                <th colspan="2" style="background:#dcfce7; color:#15803d;">个人缴存 (5%)</th>
                                <th style="background:#ffedd5; color:#9a3412;">月缴存总额</th>
                            </tr>
                            <tr>
                                <th style="width:36px;">序号</th>
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
                                <td style="text-align:center;">0</td>
                                <td class="qifu-money-cell">${fmtMoney(tot.hf_base)}</td>
                                <td style="text-align:center;">5%</td>
                                <td class="qifu-money-cell" style="color:#0369a1;">${fmtMoney(tot.comp_amount)}</td>
                                <td style="text-align:center;">5%</td>
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
                        <td style="text-align:center;"><strong>${r.employee_no}</strong></td>
                        <td><strong style="color:#1e3a8a;">${r.employee_name}</strong></td>
                        <td style="text-align:center; font-family:monospace;">${r.id_card || '-'}</td>
                        <td style="text-align:center;">${r.employee_type}</td>
                        <td style="text-align:center;">${r.period_month_str}</td>
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
                        <button class="btn btn-primary btn-xs" id="btn-modal-export-tax" style="background:#059669; border-color:#059669; font-weight:600;">📥 导出此表为 Excel</button>
                        <button class="btn btn-default btn-xs" id="btn-modal-print-tax" style="font-weight:600;">🖨️ 打印/导出 PDF</button>
                    </div>
                </div>
                <div class="qifu-modal-table-scroll">
                    <table class="qifu-table table-bordered" id="table-modal-tax-sheet" style="font-size:11.5px; margin-bottom:0; min-width:1600px;">
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
                                <th style="text-align:center;">适用税率</th>
                                <th>速算扣除数</th>
                                <th style="background:#fee2e2; color:#b91c1c; font-weight:800;">本月应预扣税额</th>
                            </tr>
                        </thead>
                        <tbody>${trs}</tbody>
                        <tfoot style="background:#f8fafc; font-weight:700;">
                            <tr>
                                <td colspan="6" style="text-align:center; color:#334155;">合计</td>
                                <td class="qifu-money-cell" style="color:#2563eb;">${fmtMoney(tot.gross_salary)}</td>
                                <td class="qifu-money-cell">${fmtMoney(tot.tax_threshold)}</td>
                                <td class="qifu-money-cell" style="color:#d97706;">${fmtMoney(tot.ss_person_total)}</td>
                                <td class="qifu-money-cell" style="color:#d97706;">${fmtMoney(tot.hf_person_total)}</td>
                                <td class="qifu-money-cell">${fmtMoney(tot.special_deductions_total)}</td>
                                <td class="qifu-money-cell" style="color:#b45309;">${fmtMoney(tot.taxable_income)}</td>
                                <td style="text-align:center;">-</td>
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

    // 新增/编辑员工档案弹窗
    function open_emp_dialog(emp_data) {
        const isEdit = !!emp_data;
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
                        ? (x.is_valid_id ? '<span style="color:#059669;">身份证校验通过，出生日期和性别由证件自动识别</span>' : `<span style="color:#dc2626;">${x.identity_validation_message || '请输入有效18位身份证号码'}</span>`)
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
                                <span class="qifu-status-badge" style="background:#f1f5f9;color:#475569;border:1px solid #cbd5e1;font-weight:700;">👴 已达龄/返聘</span>
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
                { fieldtype: 'Data', fieldname: 'employee_no', label: '工号', reqd: 1, default: emp_data ? emp_data.employee_no : '' },
                { fieldtype: 'Data', fieldname: 'employee_name', label: '员工姓名', reqd: 1, default: emp_data ? emp_data.employee_name : '' },
                { fieldtype: 'Select', fieldname: 'certificate_type', label: '证件类型', options: ['中国居民身份证','护照','港澳台证件','其他证件'], default: emp_data ? (emp_data.certificate_type || '中国居民身份证') : '中国居民身份证', onchange: retirementOnChange },
                { fieldtype: 'Data', fieldname: 'id_card', label: '证件号码', default: emp_data ? emp_data.id_card : '', onchange: retirementOnChange },
                { fieldtype: 'Column Break' },
                { fieldtype: 'Date', fieldname: 'birth_date', label: '出生日期', default: emp_data ? emp_data.birth_date : '', onchange: retirementOnChange },
                { fieldtype: 'Int', fieldname: 'current_age', label: '年龄（自动）', read_only: 1, default: emp_data ? emp_data.current_age : 0, description: '身份证自动识别；护照/其他证件根据手填出生日期计算。' },
                { fieldtype: 'Select', fieldname: 'gender', label: '性别', options: ['','男','女'], default: emp_data ? emp_data.gender : '', onchange: retirementOnChange },

                { fieldtype: 'Section Break', label: '人事与用工' },
                { fieldtype: 'Data', fieldname: 'department', label: '部门', default: emp_data ? emp_data.department : '生产部' },
                { fieldtype: 'Select', fieldname: 'employee_type', label: '用工性质', options: ['正式工','返聘工','退休返聘','其他-返聘工','外籍工','临时工','实习生','劳务派遣','本月离职'], default: emp_data ? emp_data.employee_type : '正式工', onchange: retirementOnChange },
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
                { fieldtype: 'Select', fieldname: 'salary_mode', label: '计薪方式', options: ['税后','税前','税前动态工资','税后管理工资'], default: emp_data ? emp_data.salary_mode : '税后' },
                { fieldtype: 'Currency', fieldname: 'fixed_salary', label: '固定/车间薪资基准', default: emp_data ? emp_data.fixed_salary : 0 },
                { fieldtype: 'Currency', fieldname: 'post_allowance', label: '职位补贴', default: emp_data ? emp_data.post_allowance : 0 },
                { fieldtype: 'Column Break' },
                { fieldtype: 'Currency', fieldname: 'house_rent_allowance', label: '房/车补', default: emp_data ? emp_data.house_rent_allowance : 0 },

                { fieldtype: 'Section Break', label: '社保与公积金基数' },
                { fieldtype: 'Select', fieldname: 'social_security_base_mode', label: '社保缴费基数方式', options: ['最低缴费基数','自定义'], default: emp_data ? (emp_data.social_security_base_mode || '最低缴费基数') : '最低缴费基数', description: '默认绑定年度最低缴费基数；修改年度最低基数后会自动联动。' },
                { fieldtype: 'Currency', fieldname: 'custom_social_security_base', label: '自定义社保缴费基数', default: emp_data ? Number(emp_data.custom_social_security_base || emp_data.social_security_base || 0) : 0, depends_on: 'eval:doc.social_security_base_mode=="自定义"', description: '只给特殊人员设置；不会随年度最低基数变动。' },
                { fieldtype: 'HTML', fieldname: 'social_security_base_hint', options: '<div class="ashan-callout ashan-callout--xs">选择“最低缴费基数”时，系统每次计算都会读取年度配置；不再把最低数值复制到每位员工档案。</div>' },
                { fieldtype: 'Column Break' },
                { fieldtype: 'Currency', fieldname: 'housing_fund_base', label: '公积金长期基数', default: emp_data ? emp_data.housing_fund_base : 2320, description: '长期参数。非缴纳月份不会把这里改成 0。' },
                { fieldtype: 'Select', fieldname: 'housing_fund_policy', label: '公积金长期策略', options: ['跟随公司规则','固定缴纳','固定停缴'], default: emp_data ? (emp_data.housing_fund_policy || '跟随公司规则') : '跟随公司规则', description: '固定缴纳可用于孟祥山等不受季度月份限制的长期特殊人员。' },

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
                frappe.call({
                    method: isEdit ? 'ashan_cn_procurement.services.employee_salary_service.update_employee_salary_profile' : 'ashan_cn_procurement.services.employee_salary_service.create_employee_salary_profile',
                    type: 'POST',
                    args: vals,
                    callback: function(r) {
                        if (r.message && r.message.success) {
                            frappe.show_alert({ message: r.message.message, indicator: 'green' });
                            d.hide();
                            load_qifu_employees();
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
        setTimeout(refreshRetirementPreview, 80);
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
            title: `🚪 办理员工离职 · ${emp_name}`,
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
                        💡 <strong>财务减员联动规则</strong>：<br>
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
    function open_batch_resign_dialog(selected_emps) {
        if (!selected_emps || selected_emps.length === 0) {
            frappe.msgprint({ title: '提示', indicator: 'orange', message: '请先在员工列表中勾选需要办理离职的人员！' });
            return;
        }
        const default_date = get_last_day_of_month(current_month);
        const emp_names_str = selected_emps.map(e => `${e.name} (${e.no})`).join('、');
        const emp_nos = selected_emps.map(e => e.no);

        const d = new frappe.ui.Dialog({
            title: `🚪 批量办理员工离职 (共 ${selected_emps.length} 人)`,
            size: 'small',
            fields: [
                {
                    fieldtype: 'HTML',
                    fieldname: 'selected_list',
                    options: `
                    <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:8px 10px; font-size:12px; line-height:1.6; max-height:120px; overflow-y:auto; margin-bottom:10px;">
                        <strong>已选员工 (${selected_emps.length} 人)</strong>：<br>
                        <span style="color:#2563eb;">${emp_names_str}</span>
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
                        💡 <strong>财务减员联动规则</strong>：<br>
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
                            frappe.msgprint({ title: '✅ 批量离职成功', indicator: 'green', message: r.message.message });
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
                        <td style="text-align:center;"><strong>${r.employee_no}</strong></td>
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
                        <td style="text-align:center;">${r.target_rate || '-'}</td>
                        <td class="qifu-money-cell">${fmtMoney(r.target_salary)}</td>
                        <td class="qifu-money-cell" style="color:#dc2626;">${fmtMoney(r.deduction)}</td>
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
                        <button class="btn btn-primary btn-xs" id="btn-modal-export-dist" style="background:#059669; border-color:#059669; font-weight:600;">📥 导出此表为 Excel</button>
                        <button class="btn btn-default btn-xs" id="btn-modal-print-dist" style="font-weight:600;">🖨️ 打印/导出 PDF</button>
                    </div>
                </div>
                <div class="qifu-modal-table-scroll">
                    <table class="qifu-table table-bordered" id="table-modal-dist-sheet" style="font-size:11.5px; margin-bottom:0; min-width:1800px;">
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
                                <td colspan="3" style="text-align:center;">合计</td>
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
                                <td class="qifu-money-cell" style="color:#dc2626;">${fmtMoney(tot.deduction)}</td>
                                <td class="qifu-money-cell">${fmtMoney(tot.workshop_net)}</td>
                                <td class="qifu-money-cell" style="color:#b45309;">${fmtMoney(tot.post_allowance)}</td>
                                <td class="qifu-money-cell" style="color:#b45309;">${fmtMoney(tot.house_rent_allowance)}</td>
                                <td class="qifu-money-cell" style="color:#b45309;">${fmtMoney(tot.subsidies_total)}</td>
                                <td class="qifu-money-cell" style="color:#2563eb;">${fmtMoney(tot.payable_total)}</td>
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
                        <td style="text-align:center;"><strong>${r.employee_no}</strong></td>
                        <td><strong style="color:#1e3a8a;">${r.employee_name}</strong></td>
                        <td class="qifu-money-cell">${fmtMoney(r.base_performance_salary)}</td>
                        <td class="qifu-money-cell" style="color:#b45309;">${fmtMoney(r.post_allowance)}</td>
                        <td class="qifu-money-cell" style="color:#b45309;">${fmtMoney(r.house_rent_allowance)}</td>
                        <td class="qifu-money-cell" style="color:#2563eb; font-weight:700;">${fmtMoney(r.gross_salary)}</td>
                        <td class="qifu-money-cell" style="color:#d97706;">${fmtMoney(r.hf_person_total)}</td>
                        <td class="qifu-money-cell" style="color:#d97706;">${fmtMoney(r.ss_person_total)}</td>
                        <td class="qifu-money-cell" style="color:#dc2626;">${fmtMoney(r.tax_amount)}</td>
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
                        <button class="btn btn-primary btn-xs" id="btn-modal-export-acc" style="background:#059669; border-color:#059669; font-weight:600;">📥 导出此表为 Excel</button>
                        <button class="btn btn-default btn-xs" id="btn-modal-print-acc" style="font-weight:600;">🖨️ 打印/导出 PDF</button>
                    </div>
                </div>
                <div class="qifu-modal-table-scroll">
                    <table class="qifu-table table-bordered" id="table-modal-acc-sheet" style="font-size:12px; margin-bottom:0; min-width:1200px;">
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
                                <td colspan="3" style="text-align:center;">合计</td>
                                <td class="qifu-money-cell">${fmtMoney(tot.base_performance_salary)}</td>
                                <td class="qifu-money-cell" style="color:#b45309;">${fmtMoney(tot.post_allowance)}</td>
                                <td class="qifu-money-cell" style="color:#b45309;">${fmtMoney(tot.house_rent_allowance)}</td>
                                <td class="qifu-money-cell" style="color:#2563eb;">${fmtMoney(tot.gross_salary)}</td>
                                <td class="qifu-money-cell" style="color:#d97706;">${fmtMoney(tot.hf_person_total)}</td>
                                <td class="qifu-money-cell" style="color:#d97706;">${fmtMoney(tot.ss_person_total)}</td>
                                <td class="qifu-money-cell" style="color:#dc2626;">${fmtMoney(tot.tax_amount)}</td>
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
                    title: '➕ 登记社保特殊补缴 / 滞纳金 / 调基差额',
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
            title:`✎ 单人调整${label} · ${employee_name || employee_no}`,
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
            let opts = `<option value="">👥 全部在册人员</option>`;
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
            if(c[2]==='name') return `<a href="javascript:void(0);" class="btn-drill-emp-history" data-emp="${frappe.utils.escape_html(r.employee_no || '')}" style="color:#2563eb; font-weight:700; text-decoration:underline;">${frappe.utils.escape_html(v||'-')} 🔍</a>`;
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
            return `<a href="javascript:void(0);" class="btn-drill-emp-history" data-emp="${frappe.utils.escape_html(row.employee_no || '')}" style="color:#2563eb; font-weight:700; text-decoration:underline;">${frappe.utils.escape_html(value || '-')} 🔍</a>`;
        }
        return frappe.utils.escape_html(value === null || value === undefined || value === '' ? '-' : String(value));
    }

    function render_history_full(data) {
        history_full_cache = data || {};
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
        let periodOpts = `<option value="all" ${current_history_period==='all'?'selected':''}>📅 申报周期全轨迹 (${months[0] || ''} ~ ${months[months.length-1] || ''})</option>`;
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

        $("#history-edit-hint").text(data.locked ? '🔒 已冻结月份为财务快照，只读；需更正请先反审核。' : '🟢 未冻结月份可更正受控输入；保存后自动级联后台重算。');
        $("#table-history").css('min-width', Math.max(6800, cols.length * 118) + 'px');

        const stickyClass = i => i===0?'qifu-col-sticky-1':(i===1?'qifu-col-sticky-2':(i===2?'qifu-col-sticky-3':''));
        let heads = cols.map((c,i)=>`<th class="${stickyClass(i)}"><span class="qifu-history-group-label">${frappe.utils.escape_html(c.group || '')}</span><span class="qifu-history-main-label">${frappe.utils.escape_html(c.label || c.key)}</span></th>`).join('');
        heads += '<th><span class="qifu-history-group-label">操作</span><span class="qifu-history-main-label">历史更正</span></th>';
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
                ? '<span style="color:#94a3b8; white-space:nowrap;">🔒 冻结只读</span>'
                : `<button class="btn btn-xs btn-default btn-history-correct" data-emp="${frappe.utils.escape_html(row.employee_no || '')}" data-period="${frappe.utils.escape_html(rowPeriod || '')}" style="white-space:nowrap; color:#b45309; border-color:#fde68a;">✎ 更正输入</button>`;
            return `<tr>${tds}<td style="text-align:center;">${action}</td></tr>`;
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
        const isNetMode = ['税后','税后倒推'].includes(String(row.salary_mode || '').trim());
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
            title:`✎ 历史输入更正 · ${row.employee_name || employee_no}`,
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
            <td class="qifu-col-sticky-1" style="text-align:center;">${r.seq}</td><td class="qifu-col-sticky-2" style="font-weight:700;">${r.period_month}</td>
            <td class="qifu-col-sticky-3"><span class="qifu-status-badge ${r.status==='已核定锁定'?'qifu-status-locked':'qifu-status-draft'}">${r.status||'-'}</span></td>
            <td class="qifu-money-cell">${fmtMoney(r.gross_salary)}</td><td class="qifu-money-cell">${fmtMoney(r.ss_person_total)}</td><td class="qifu-money-cell">${fmtMoney(r.hf_person_total)}</td>
            <td class="qifu-money-cell">${fmtMoney(r.insurance_total)}</td><td class="qifu-money-cell">${fmtMoney(r.special_deductions_total)}</td><td class="qifu-money-cell">${fmtMoney(r.threshold_accumulated)}</td>
            <td class="qifu-money-cell" style="font-weight:700; color:#9a3412;">${fmtMoney(r.taxable_accumulated)}</td><td style="text-align:center;">${Number(r.tax_rate||0).toFixed(2).replace(/\.00$/,'')}%</td>
            <td class="qifu-money-cell">${fmtMoney(r.quick_deduction)}</td><td class="qifu-money-cell">${fmtMoney(r.tax_paid_prior)}</td><td class="qifu-money-cell" style="font-weight:800; color:${Number(r.tax_current||0)>0?'#dc2626':'#166534'};">${fmtMoney(r.tax_current)}</td>
            <td class="qifu-money-cell" style="font-weight:700; color:#166534;">${fmtMoney(r.net_salary)}</td></tr>`).join(''));
        $("#tfoot-history").html(`<tr><td colspan="3" style="font-weight:700; background:#f8fafc;">周期累计</td><td class="qifu-money-cell" style="font-weight:700;">${fmtMoney(sum.cum_gross_salary||0)}</td><td class="qifu-money-cell">${fmtMoney(sum.cum_ss_person||0)}</td><td class="qifu-money-cell">${fmtMoney(sum.cum_hf_person||0)}</td><td></td><td class="qifu-money-cell">${fmtMoney(sum.cum_special_deductions||0)}</td><td class="qifu-money-cell">${fmtMoney(sum.cum_tax_threshold||0)}</td><td colspan="4"></td><td class="qifu-money-cell" style="font-weight:800; color:#dc2626;">${fmtMoney(sum.cum_tax_paid||0)}</td><td class="qifu-money-cell" style="font-weight:800; color:#166534;">${fmtMoney(sum.cum_net_salary||0)}</td></tr>`);
        adjust_active_table_height();
        sync_dual_scrollbars($("#history-top-scrollbar"), $("#history-table-box"));
    }

    // Excel 导出 (支持 all / distribution / accounting / insurance / housing_fund / tax / history)
    function export_excel_action(sheet_type, extra_args) {
        frappe.show_alert({ message: '⏳ 正在生成 Excel 报表，请稍候...', indicator: 'blue' });
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
                    frappe.show_alert({ message: `📥 成功导出: ${fname}`, indicator: 'green' });
                }
            }
        });
    }

    function export_housing_fund_roster_change(changeType) {
        const label = changeType === 'seal' ? '封存清册' : '增加清册';
        frappe.show_alert({ message: `⏳ 正在生成${label}，请稍候...`, indicator: 'blue' });
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
                frappe.show_alert({ message: `📥 ${payload.message}`, indicator: 'green' });
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

    function load_monthly_workflow_hub() {
        if (!COMPANY) return;
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
                if (!r.message) return;
                const wf = r.message;
                cached_workflow_status = wf;

                // 1. 顶部封账状态 Badge 与 Card 5
                if (wf.is_locked) {
                    $("#workflow-lock-status-badge").html(
                        `<span style="color:#b45309; background:#fef3c7; border:1px solid #fde68a; padding:2px 8px; border-radius:10px;">🔒 已核定封账 (纯只读保护)</span>`
                    );
                    $("#btn-wf-lock-action").text("🔒 已封账 (点击反审核解锁)").removeClass("btn-primary").addClass("btn-default").css({"background":"#f8fafc","color":"#475569","border-color":"#cbd5e1"});
                    $("#wf-step5-icon").text("🔒");
                    $("#wf-step5-main").text("月度账期已封账锁定");
                    $("#wf-step5-sub").text("明细纯只读保护 · 下月已开启").css("color", "#b45309");
                    $("#wf-step5-lock-badge").text("已锁定").css({"color":"#b45309","background":"#fef3c7","border-color":"#fde68a"});
                    $("#wf-step-5").css({"background":"#fefce8","border-color":"#fef08a"});
                } else {
                    $("#workflow-lock-status-badge").html(
                        `<span style="color:#059669; background:#dcfce7; border:1px solid #bbf7d0; padding:2px 8px; border-radius:10px;">📝 草稿状态 (待核定)</span>`
                    );
                    const gross_val = wf.task5_settlement ? Number(wf.task5_settlement.total_gross || 0).toLocaleString('zh-CN', {minimumFractionDigits:2}) : '0.00';
                    const net_val = wf.task5_settlement ? Number(wf.task5_settlement.total_net || 0).toLocaleString('zh-CN', {minimumFractionDigits:2}) : '0.00';
                    const cost_val = wf.task5_settlement ? Number(wf.task5_settlement.total_company_cost || 0).toLocaleString('zh-CN', {minimumFractionDigits:2}) : '0.00';

                    if (wf.can_lock) {
                        $("#btn-wf-lock-action").text("🔒 立即执行最终核定").addClass("btn-primary").removeClass("btn-default").css({"background":"#059669","color":"#fff","border-color":"#059669"});
                        $("#wf-step5-icon").text("🟢");
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
                            $("#btn-wf-lock-action").text(calcFailed > 0 ? "⛔ 计算未完成 · 禁止封账" : "⏳ 服务器计算中 · 暂不可封账")
                                .addClass("btn-default").removeClass("btn-primary")
                                .css({"background":calcFailed > 0 ? "#fee2e2" : "#eff6ff","color":calcFailed > 0 ? "#b91c1c" : "#1d4ed8","border-color":calcFailed > 0 ? "#ef4444" : "#bfdbfe","font-weight":"800"});
                            $("#wf-step5-icon").text(calcFailed > 0 ? "⛔" : "⏳");
                            $("#wf-step5-main").text(calcFailed > 0 ? "服务器计算存在失败/未计算记录" : "服务器正在异步重算薪酬与累计个税");
                            $("#wf-step5-sub").text(`待处理 ${calcPending} ｜ 失败/未计算 ${calcFailed} ｜ 活动任务 ${Number(calc.active_tasks || 0)}`).css("color", calcFailed > 0 ? "#b91c1c" : "#1d4ed8");
                            $("#wf-step5-lock-badge").text("计算未就绪").css({"color":calcFailed > 0 ? "#b91c1c" : "#1d4ed8","background":calcFailed > 0 ? "#fee2e2" : "#eff6ff","border-color":calcFailed > 0 ? "#fecaca" : "#bfdbfe"});
                            $("#wf-step-5").css({"background":calcFailed > 0 ? "#fff1f2" : "#eff6ff","border-color":calcFailed > 0 ? "#ef4444" : "#bfdbfe"});
                        } else if (has_proof_mismatch) {
                            $("#btn-wf-lock-action").text("⛔ 凭证金额不一致 · 禁止封账").addClass("btn-default").removeClass("btn-primary").css({"background":"#fee2e2","color":"#b91c1c","border-color":"#ef4444","font-weight":"800"});
                            $("#wf-step5-icon").text("⛔");
                            $("#wf-step5-main").text("社保/公积金凭证日期或金额未通过");
                            $("#wf-step5-sub").text("所属期与金额必须全部一致后才允许最终核定封账").css("color", "#b91c1c");
                            $("#wf-step5-lock-badge").text("禁止核定").css({"color":"#b91c1c","background":"#fee2e2","border-color":"#fecaca"});
                            $("#wf-step-5").css({"background":"#fff1f2","border-color":"#ef4444"});
                        } else {
                            $("#btn-wf-lock-action").text("🔒 执行最终核定封账").addClass("btn-default").removeClass("btn-primary").css({"background":"#f8fafc","color":"#64748b","border-color":"#cbd5e1"});
                            $("#wf-step5-icon").text("⚪");
                            $("#wf-step5-main").text(`税前: ¥${gross_val} ｜ 实发: ¥${net_val}`);
                            $("#wf-step5-sub").text("待前置实发与凭证全部核验").css("color", "#64748b");
                            $("#wf-step5-lock-badge").text("待核定").css({"color":"#64748b","background":"#f1f5f9","border-color":"#e2e8f0"});
                            $("#wf-step-5").css({"background":"#ffffff","border-color":"#e2e8f0"});
                        }
                    }
                }

                // 2. Step 1: 档案母表与计薪来源分类 (系统计薪 vs 外部计薪)
                if (wf.task1_profile.status === 'done') {
                    $("#wf-step1-icon").text("🟢");
                    $("#wf-step1-main").text(`在册 ${wf.task1_profile.active_count} 人 · ${wf.task1_profile.change_text || '人员及配置无异动'}`);
                    $("#wf-step1-sub").text(wf.task1_profile.sub_badge || `系统计薪 ${Number(wf.task1_profile.sys_calc_count || 0)}人 ｜ 外部计薪 ${Number(wf.task1_profile.ext_calc_count || 0)}人`);
                    $("#wf-step-1").css({"background":"#f0fdf4","border-color":"#bbf7d0"});
                } else {
                    $("#wf-step1-icon").text("⚪");
                    $("#wf-step1-main").text("在册人员档案为空");
                    $("#wf-step1-sub").text("请先在档案库录入员工信息");
                    $("#wf-step-1").css({"background":"#ffffff","border-color":"#e2e8f0"});
                }

                // 3. Step 2: 外部实发导入（人数完全按当月数据动态计算）
                const is_task2_done = (wf.task2_import.status === 'done' || !!wf.task2_import.file_url);
                if (is_task2_done) {
                    $("#wf-step2-icon").text("🟢");
                    $("#wf-step2-main").text(`已导入 ${wf.task2_import.employee_count} 人 · ¥ ${Number(wf.task2_import.total_net).toLocaleString('zh-CN', {minimumFractionDigits:2})}`);
                    $("#wf-step2-sub").text(wf.task2_import.sub_badge || `车间实发 ${wf.task2_import.employee_count}人 ｜ 非车间(母表) ${wf.task2_import.non_workshop_count || 0}人`);
                    $("#wf-step-2").css({"background":"#f0fdf4","border-color":"#bbf7d0"});
                    $("#btn-wf-upload-salary").html("🗑️ 删除已上传实发表")
                        .attr("data-state", "uploaded")
                        .css({"background":"#fef2f2", "color":"#dc2626", "border-color":"#fecaca", "font-weight":"700"});
                } else {
                    $("#wf-step2-icon").text("⚪");
                    $("#wf-step2-main").text("待上传车间实发表");
                    $("#wf-step2-sub").text(`外部计薪 ${Number(wf.task1_profile.ext_calc_count || 0)}人 · 待导入实发表`);
                    $("#wf-step-2").css({"background":"#ffffff","border-color":"#e2e8f0"});
                    $("#btn-wf-upload-salary").html("📤 上传车间实发表")
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
                    $("#wf-step3-icon").text("🟢");
                    $("#wf-step3-main").text(`${ss_insured_cnt} 人参保 · ${wf.task3_ss.file_count || 1}份凭证合计 ¥ ${ss_tot_str}`);
                    $("#wf-step3-sub").text(`所属期 ${wf.task3_ss.expected_period || '—'} 已通过 ｜ 公司 ¥${ss_comp_str} ｜ 个人 ¥${ss_pers_str}`).css("color", "#15803d");
                    $("#wf-step-3").css({"background":"#f0fdf4","border-color":"#bbf7d0"});
                } else if (wf.task3_ss.status === 'mismatch') {
                    const ss_diff_str = Number(wf.task3_ss.difference_amount != null ? wf.task3_ss.difference_amount : Math.abs(wf.task3_ss.parsed_amount - wf.task3_ss.sys_amount)).toLocaleString('zh-CN', {minimumFractionDigits:2});
                    $("#wf-step3-icon").text("⛔");
                    if (wf.task3_ss.period_valid === false && wf.task3_ss.file_url) {
                        $("#wf-step3-main").text(`社保凭证所属期错误 · 应为 ${wf.task3_ss.expected_period || '—'}`);
                        $("#wf-step3-sub").text(`检测到 ${(wf.task3_ss.detected_periods || []).join('、') || '无法识别'} ｜ 禁止最终核定封账`).css("color", "#b91c1c");
                    } else {
                        $("#wf-step3-main").text(`${ss_insured_cnt} 人参保 · 日期通过但金额不符 · 差额 ¥${ss_diff_str}`);
                        $("#wf-step3-sub").text(`所属期 ${wf.task3_ss.expected_period || '—'} ｜ 凭证 ¥${ss_tot_str} ｜ 系统 ¥${Number(wf.task3_ss.sys_amount).toLocaleString('zh-CN', {minimumFractionDigits:2})}`).css("color", "#b91c1c");
                    }
                    $("#wf-step-3").css({"background":"#fff1f2","border-color":"#ef4444","box-shadow":"0 0 0 1px rgba(239,68,68,0.08)"});
                } else {
                    $("#wf-step3-icon").text("🟡");
                    $("#wf-step3-main").text(`${ss_insured_cnt} 人参保 · 待上传申报表 (应缴 ¥${Number(wf.task3_ss.sys_amount).toLocaleString('zh-CN', {minimumFractionDigits:2})})`);
                    $("#wf-step3-sub").text(`公司 ¥${ss_comp_str} ｜ 个人 ¥${ss_pers_str}`);
                    $("#wf-step-3").css({"background":"#ffffff","border-color":"#e2e8f0"});
                }

                if (is_task3_uploaded) {
                    $("#btn-wf-upload-ss").html("🗑️ 删除已上传社保凭证")
                        .attr("data-state", "uploaded")
                        .css({"background":"#fef2f2", "color":"#dc2626", "border-color":"#fecaca", "font-weight":"700"});
                } else {
                    $("#btn-wf-upload-ss").html("📤 上传社保凭证")
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
                    $("#wf-step4-icon").text("🟢");
                    $("#wf-step4-main").text(`${hf_insured_cnt} 人参缴 · ${wf.task4_hf.file_count || 1}份凭证合计 ¥ ${hf_tot_str}`);
                    $("#wf-step4-sub").text(`所属期 ${wf.task4_hf.expected_period || '—'} 已通过 ｜ 公司 ¥${hf_comp_str} ｜ 个人 ¥${hf_pers_str}`).css("color", "#15803d");
                    $("#wf-step-4").css({"background":"#f0fdf4","border-color":"#bbf7d0"});
                } else if (wf.task4_hf.status === 'mismatch') {
                    const hf_diff_str = Number(wf.task4_hf.difference_amount != null ? wf.task4_hf.difference_amount : Math.abs(wf.task4_hf.parsed_amount - wf.task4_hf.sys_amount)).toLocaleString('zh-CN', {minimumFractionDigits:2});
                    $("#wf-step4-icon").text("⛔");
                    if (wf.task4_hf.period_valid === false && wf.task4_hf.file_url) {
                        $("#wf-step4-main").text(`公积金凭证所属期错误 · 应为 ${wf.task4_hf.expected_period || '—'}`);
                        $("#wf-step4-sub").text(`检测到 ${(wf.task4_hf.detected_periods || []).join('、') || '无法识别'} ｜ 禁止最终核定封账`).css("color", "#b91c1c");
                    } else {
                        $("#wf-step4-main").text(`${hf_insured_cnt} 人参缴 · 日期通过但金额不符 · 差额 ¥${hf_diff_str}`);
                        $("#wf-step4-sub").text(`所属期 ${wf.task4_hf.expected_period || '—'} ｜ 凭证 ¥${hf_tot_str} ｜ 系统 ¥${Number(wf.task4_hf.sys_amount).toLocaleString('zh-CN', {minimumFractionDigits:2})}`).css("color", "#b91c1c");
                    }
                    $("#wf-step-4").css({"background":"#fff1f2","border-color":"#ef4444","box-shadow":"0 0 0 1px rgba(239,68,68,0.08)"});
                } else {
                    $("#wf-step4-icon").text("🟡");
                    $("#wf-step4-main").text(`${hf_insured_cnt} 人参缴 · 待上传凭证 (应缴 ¥${Number(wf.task4_hf.sys_amount).toLocaleString('zh-CN', {minimumFractionDigits:2})})`);
                    $("#wf-step4-sub").text(`公司 ¥${hf_comp_str} ｜ 个人 ¥${hf_pers_str}`);
                    $("#wf-step-4").css({"background":"#ffffff","border-color":"#e2e8f0"});
                }

                if (is_task4_uploaded) {
                    $("#btn-wf-upload-hf").html("🗑️ 删除已上传公积金凭证")
                        .attr("data-state", "uploaded")
                        .css({"background":"#fef2f2", "color":"#dc2626", "border-color":"#fecaca", "font-weight":"700"});
                } else {
                    $("#btn-wf-upload-hf").html("📤 上传公积金凭证")
                        .attr("data-state", "empty")
                        .css({"background":"#eff6ff", "color":"#1d4ed8", "border-color":"#bfdbfe", "font-weight":"700"});
                }

                if (wf.task4_hf.file_url) {
                    $("#wf-step4-file-badge").show().attr("data-url", wf.task4_hf.file_url);
                } else {
                    $("#wf-step4-file-badge").hide().removeAttr("data-url");
                }

                adjust_active_table_height();
            }
        });
    }

    // 弹窗：上传车间外部实发工资表 Excel (第 2 步)
    function open_upload_workshop_salary_dialog() {
        const cur_m = $("#qifu-month-select").val() || current_month;
        const d = new frappe.ui.Dialog({
            title: `📤 上传【${cur_m}】车间外部实发工资表 (Excel)`,
            fields: [
                {
                    fieldtype: 'HTML',
                    fieldname: 'salary_help',
                    options: `
                        <div class="ashan-callout ashan-callout--dialog ashan-mb-3">
                            <strong>💡 智能解析与核算说明：</strong><br>
                            • 支持直接上传车间/老板娘本地 <strong>.xlsx / .xlsm</strong> 实发工资表；<br>
                            • 系统将自动提取作业工时、加班考勤、达标率与车间实发金额，并生成 24 列标准薪资发放台账；<br>
                            • 后台自动执行<strong>【税后实发倒推税前应发与个人所得税】</strong>，并永久归档 Excel 原件供随时下载。
                        </div>
                    `
                },
                {
                    fieldtype: 'Attach',
                    fieldname: 'salary_file',
                    label: '选择车间实发工资表 Excel 文件 (.xlsx, .xlsm)',
                    reqd: 1
                }
            ],
            primary_action_label: '🚀 立即导入并解析核算',
            primary_action: function(vals) {
                if (!vals || !vals.salary_file) {
                    frappe.msgprint("请先选择车间实发工资表 Excel 文件！");
                    return;
                }
                const file_url = vals.salary_file;
                frappe.show_alert({ message: '🔍 正在智能解析外部实发工资表并倒推税前应发...', indicator: 'blue' });

                frappe.call({
                    method: 'ashan_cn_procurement.services.payroll_settlement_service.upload_and_import_qifu_salary',
                    type: 'POST',
                    args: {
                        file_url: file_url,
                        period_month: cur_m
                    },
                    callback: function(r) {
                        if (r.message && r.message.success) {
                            d.hide();
                            frappe.msgprint({
                                title: '🎉 车间实发表导入成功',
                                indicator: 'green',
                                message: `
                                    <div style="font-size:13px; line-height:1.6;">
                                        ${r.message.message}<br><br>
                                        <strong>导入实发人数：</strong> ${r.message.total_imported || r.message.count || '—'} 人<br>
                                        <strong>实发总额（导入值）：</strong> ¥ ${Number(r.message.total_net_salary || r.message.total_net || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})}<br>
                                        <strong>服务器状态：</strong> 已提交后台统一复核，可在“服务器计算中心”查看完成时间与失败重试。<br>
                                        <strong>归档原件路径：</strong> <a href="${file_url}" target="_blank" style="color:#2563eb; font-weight:700;">📥 在线下载原始 Excel</a>
                                    </div>
                                `
                            });
                            load_monthly_workflow_hub();
                            if (current_tab === 'import') load_salary_distribution_tab();
                            if (current_tab === 'tax') load_tax_settlement_tab();
                            if (current_tab === 'settlement') load_payroll_settlement();
        if (current_tab === 'history') load_history_tab();
                        }
                    }
                });
            }
        });
        d.show();
    }


    // ==========================================
    // 弹窗：上传社保申报表 PDF / ZIP
    // ==========================================
    function open_upload_social_security_dialog() {
        const cur_m = $("#qifu-month-select").val() || current_month;
        const d = new frappe.ui.Dialog({
            title: `🛡️ 上传【${cur_m}】社会保险费缴费申报表 (PDF / ZIP)`,
            fields: [
                {
                    fieldtype: 'HTML',
                    fieldname: 'ss_help',
                    options: `
                        <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:6px; padding:10px 12px; margin-bottom:12px; font-size:12px; color:#166534; line-height:1.5;">
                            <strong>💡 智能核验说明：</strong><br>
                            • 支持直接上传税务局/社保局下载的 <strong>.pdf</strong> 缴费申报表，或包含 PDF 的 <strong>.zip</strong> 压缩包；<br>
                            • 系统将自动解析 PDF 内纳税人识别号、所属期与缴费总额，并与系统核算总额实时比对；<br>
                            • 上传成功后将自动规范命名归档，并可随时点击【📥 凭证】下载原件。
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
            primary_action_label: '🚀 提交并智能解析核验',
            primary_action: function(vals) {
                if (!vals || !vals.ss_file) {
                    frappe.msgprint("请先选择社保 PDF 或 ZIP 文件！");
                    return;
                }
                const file_url = vals.ss_file;
                frappe.show_alert({ message: '🔍 正在智能解析社保凭证并比对金额...', indicator: 'blue' });

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
                                title: '✅ 社保凭证解析完成',
                                indicator: r.message.is_matched ? 'green' : 'orange',
                                message: `
                                    <div style="font-size:13px; line-height:1.6;">
                                        ${r.message.message}<br><br>
                                        <strong>PDF 提取总额：</strong> ¥ ${Number(r.message.parsed_amount).toLocaleString('zh-CN', {minimumFractionDigits:2})}<br>
                                        <strong>系统核算总额：</strong> ¥ ${Number(r.message.sys_amount).toLocaleString('zh-CN', {minimumFractionDigits:2})}<br>
                                        <strong>归档文件路径：</strong> <a href="${r.message.file_url}" target="_blank" style="color:#2563eb; font-weight:700;">📥 在线查看 / 下载 PDF 原件</a>
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
            title: `🏛️ 上传【${cur_m}】住房公积金缴存凭证 (ZIP / PDF)`,
            fields: [
                {
                    fieldtype: 'HTML',
                    fieldname: 'hf_help',
                    options: `
                        <div class="ashan-callout ashan-callout--dialog ashan-mb-3">
                            <strong>💡 智能解压与核验说明：</strong><br>
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
            primary_action_label: '🚀 提交后台解压与智能核验',
            primary_action: function(vals) {
                if (!vals || !vals.hf_file) {
                    frappe.msgprint("请先选择公积金 ZIP 或 PDF 文件！");
                    return;
                }
                const file_url = vals.hf_file;
                frappe.show_alert({ message: '🔍 正在后台解压公积金凭证并比对金额...', indicator: 'blue' });

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
                                title: '✅ 公积金凭证解析完成',
                                indicator: r.message.is_matched ? 'green' : 'orange',
                                message: `
                                    <div style="font-size:13px; line-height:1.6;">
                                        ${r.message.message}<br><br>
                                        <strong>PDF 提取总额：</strong> ¥ ${Number(r.message.parsed_amount).toLocaleString('zh-CN', {minimumFractionDigits:2})}<br>
                                        <strong>系统核算总额：</strong> ¥ ${Number(r.message.sys_amount).toLocaleString('zh-CN', {minimumFractionDigits:2})}<br>
                                        <strong>归档文件路径：</strong> <a href="${r.message.file_url}" target="_blank" style="color:#2563eb; font-weight:700;">📥 在线查看 / 下载 PDF 原件</a>
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
                        load_qifu_payroll_data();
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

    // ⭐️ 核心统一：车间实发 Excel 上传与解析核算统一执行引擎 (Single Unified Salary Upload Engine)
    function execute_qifu_salary_upload(base64_str, filename, cur_m, on_complete) {
        if (!base64_str) {
            frappe.msgprint({
                title: '❌ 未选择文件',
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
            freeze_message: `🔍 正在智能解析【${filename}】并执行税后实发倒推税前与个税核算...`,
            args: {
                file_data: base64_str,
                filename: filename,
                period_month: target_month
            },
            callback: function(r) {
                if (r.message && r.message.success) {
                    frappe.msgprint({
                        title: '🎉 车间实发表导入成功',
                        indicator: 'green',
                        message: `
                            <div style="font-size:13px; line-height:1.6;">
                                ${r.message.message}<br><br>
                                <strong>导入实发人数：</strong> ${r.message.total_imported || '—'} 人<br>
                                <strong>实发总额（导入值）：</strong> ¥ ${Number(r.message.total_net_salary || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})}<br>
                                <strong>服务器状态：</strong> 已进入后台统一复核，最终税前/个税以“服务器计算中心”完成后的结果为准。<br>
                                <strong>归档原件：</strong> <span style="color:#2563eb; font-weight:700;">${filename}</span>
                            </div>
                        `
                    });
                    load_monthly_workflow_hub();
                    load_salary_distribution_tab();
                    if (typeof load_qifu_payroll_data === 'function') load_qifu_payroll_data();
                    if (current_tab === 'tax') load_tax_settlement_tab();
                    if (current_tab === 'settlement') load_payroll_settlement();
        if (current_tab === 'history') load_history_tab();
                    if (on_complete) on_complete(true);
                } else {
                    const msg = (r.message && r.message.message) || '处理 Excel 文件时发生错误，请检查文件格式！';
                    frappe.msgprint({
                        title: '❌ 导入失败',
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
                    title: '❌ 上传与解析失败',
                    indicator: 'red',
                    message: `<div style="line-height:1.6; font-size:13px;">${error_msg}</div>`
                });
                if (on_complete) on_complete(false);
            }
        });
    }

    // 🚀 零中转极速上传引擎：基于 FileReader 直接转换 Base64 并提交后端解析核算
    function direct_file_upload(accept_exts, on_file_read) {
        const file_input = document.createElement('input');
        file_input.type = 'file';
        file_input.accept = accept_exts;
        file_input.style.display = 'none';
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
                    title: '❌ 读取文件失败',
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
        file_input.style.display = 'none';
        document.body.appendChild(file_input);
        file_input.onchange = async function(e) {
            const files = Array.from(e.target.files || []);
            document.body.removeChild(file_input);
            if (!files.length) return;
            if (files.length > 20) {
                frappe.msgprint({title:'⛔ 文件过多', indicator:'red', message:'单次最多选择 20 个 PDF/ZIP 凭证文件。'});
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
                frappe.msgprint({title:'❌ 读取文件失败', indicator:'red', message: err.message || String(err)});
            }
        };
        file_input.click();
    }

    $container.on("click", "#btn-wf-upload-salary", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const state = $(this).attr("data-state");
        const cur_m = $("#qifu-month-select").val() || current_month;
        if (state === "uploaded") {
            frappe.confirm(
                `⚠️ 确定要删除【${cur_m}】已上传的车间外部实发工资表吗？<br><br><span style="color:#dc2626; font-size:12px;">只会清除外部工资来源。员工母表中的固定工资人员会保留，并立即重新计算个税与综合结算；车间外部实发仍需重新上传 Excel。</span>`,
                function() {
                    execute_delete_proof('salary', '车间实发工资表');
                }
            );
        } else {
            direct_file_upload('.xlsx,.xlsm', function(base64_str, filename) {
                execute_qifu_salary_upload(base64_str, filename, cur_m);
            });
        }
    });

    $container.on("click", "#btn-wf-upload-ss", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const state = $(this).attr("data-state");
        const cur_m = $("#qifu-month-select").val() || current_month;
        if (state === "uploaded") {
            frappe.confirm(`⚠️ 确定要删除【${cur_m}】已上传的全部社保缴费申报表凭证吗？`, function() { execute_delete_proof('social_security', '社保申报表凭证'); });
            return;
        }
        direct_multi_file_upload('.pdf,.zip', function(file_payload, raw_files) {
            const names = raw_files.map(f => f.name).join('、');
            frappe.call({
                method: 'ashan_cn_procurement.services.payroll_settlement_service.upload_and_verify_social_security_file',
                type: 'POST', freeze: true,
                freeze_message: `🔍 正在解析 ${raw_files.length} 个社保文件：先校验所属期，再汇总金额...`,
                args: {company: COMPANY, period_month: cur_m, files_json: JSON.stringify(file_payload)},
                callback: function(r) {
                    if (r.message && r.message.success) {
                        const diff = Number(r.message.difference_amount || 0);
                        frappe.msgprint({title: r.message.is_matched ? '✅ 社保日期与金额均核验一致' : '⛔ 社保日期正确但金额不一致', indicator: r.message.is_matched ? 'green' : 'red', message: `<div style="font-size:13px;line-height:1.7;">${r.message.message}<br><br><strong>核定期：</strong>${cur_m}<br><strong>凭证应属实际缴费期：</strong>${r.message.expected_period || '—'}<br><strong>本批 PDF：</strong>${r.message.proof_count || 0} 份<br><strong>凭证合计：</strong>¥ ${Number(r.message.parsed_amount || 0).toLocaleString('zh-CN',{minimumFractionDigits:2})}<br><strong>系统核算：</strong>¥ ${Number(r.message.sys_amount || 0).toLocaleString('zh-CN',{minimumFractionDigits:2})}<br><strong>差额：</strong>¥ ${diff.toLocaleString('zh-CN',{minimumFractionDigits:2})}<br><strong>选择文件：</strong>${names}${r.message.is_matched ? '' : '<div style="margin-top:9px;padding:8px;border:1px solid #ef4444;background:#fff1f2;color:#b91c1c;border-radius:6px;font-weight:700;">⛔ 金额未通过，凭证已归档但禁止最终核定封账。</div>'}</div>`});
                        load_monthly_workflow_hub();
                        if (typeof load_social_insurance_tab === 'function') load_social_insurance_tab();
                    } else {
                        frappe.msgprint({title: (r.message && r.message.validation_type === 'period_mismatch') ? '⛔ 社保凭证所属期错误 · 已拒绝上传' : '❌ 社保凭证核验失败', indicator: 'red', message: (r.message && r.message.message) || '社保凭证处理失败。'});
                    }
                },
                error: function(r) { let msg='服务器处理社保凭证时发生错误！'; if (r && r._server_messages) { try { msg=JSON.parse(r._server_messages).map(m=>{try{return JSON.parse(m).message}catch(e){return m}}).join('<br>'); } catch(e){} } frappe.msgprint({title:'❌ 请求异常',indicator:'red',message:msg}); }
            });
        });
    });

    $container.on("click", "#btn-wf-upload-hf", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const state = $(this).attr("data-state");
        const cur_m = $("#qifu-month-select").val() || current_month;
        if (state === "uploaded") {
            frappe.confirm(`⚠️ 确定要删除【${cur_m}】已上传的全部住房公积金缴存凭证吗？`, function() { execute_delete_proof('housing_fund', '公积金缴存凭证'); });
            return;
        }
        direct_multi_file_upload('.pdf,.zip', function(file_payload, raw_files) {
            const names = raw_files.map(f => f.name).join('、');
            frappe.call({
                method: 'ashan_cn_procurement.services.payroll_settlement_service.upload_and_verify_housing_fund_file',
                type: 'POST', freeze: true,
                freeze_message: `🔍 正在解析 ${raw_files.length} 个公积金文件：先校验缴存年月，再汇总金额...`,
                args: {company: COMPANY, period_month: cur_m, files_json: JSON.stringify(file_payload)},
                callback: function(r) {
                    if (r.message && r.message.success) {
                        const diff = Number(r.message.difference_amount || 0);
                        frappe.msgprint({title: r.message.is_matched ? '✅ 公积金日期与金额均核验一致' : '⛔ 公积金日期正确但金额不一致', indicator: r.message.is_matched ? 'green' : 'red', message: `<div style="font-size:13px;line-height:1.7;">${r.message.message}<br><br><strong>核定期：</strong>${cur_m}<br><strong>凭证应属实际缴费期：</strong>${r.message.expected_period || '—'}<br><strong>本批 PDF：</strong>${r.message.proof_count || 0} 份<br><strong>凭证合计：</strong>¥ ${Number(r.message.parsed_amount || 0).toLocaleString('zh-CN',{minimumFractionDigits:2})}<br><strong>系统核算：</strong>¥ ${Number(r.message.sys_amount || 0).toLocaleString('zh-CN',{minimumFractionDigits:2})}<br><strong>差额：</strong>¥ ${diff.toLocaleString('zh-CN',{minimumFractionDigits:2})}<br><strong>选择文件：</strong>${names}${r.message.is_matched ? '' : '<div style="margin-top:9px;padding:8px;border:1px solid #ef4444;background:#fff1f2;color:#b91c1c;border-radius:6px;font-weight:700;">⛔ 金额未通过，凭证已归档但禁止最终核定封账。</div>'}</div>`});
                        load_monthly_workflow_hub();
                        if (typeof load_housing_fund_tab === 'function') load_housing_fund_tab();
                    } else {
                        frappe.msgprint({title: (r.message && r.message.validation_type === 'period_mismatch') ? '⛔ 公积金凭证所属期错误 · 已拒绝上传' : '❌ 公积金凭证核验失败', indicator: 'red', message: (r.message && r.message.message) || '公积金凭证处理失败。'});
                    }
                },
                error: function(r) { let msg='服务器处理公积金凭证时发生错误！'; if (r && r._server_messages) { try { msg=JSON.parse(r._server_messages).map(m=>{try{return JSON.parse(m).message}catch(e){return m}}).join('<br>'); } catch(e){} } frappe.msgprint({title:'❌ 请求异常',indicator:'red',message:msg}); }
            });
        });
    });

    // 右上角胶囊文件【🔒 权限受控安全下载】
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

    // 阶段 5 综合核定与封账操作 (100% 强拦截保障与实时状态校验)
    $container.on("click", "#btn-wf-lock-action", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const cur_m = $("#qifu-month-select").val() || current_month;

        frappe.show_alert({ message: '🔍 正在实时校验月度核算任务状态...', indicator: 'blue' });

        frappe.call({
            method: 'ashan_cn_procurement.services.payroll_settlement_service.get_monthly_workflow_status',
            args: { company: COMPANY, period_month: cur_m },
            callback: function(r) {
                if (!r.message) {
                    frappe.msgprint("获取月度核定状态失败，请刷新页面重试！");
                    return;
                }
                const wf = r.message;
                cached_workflow_status = wf;

                // 1. 如果当前账期已经封账 -> 弹出反审核解锁登记
                if (wf.is_locked) {
                    frappe.confirm(
                        `<strong>【🔒 当前发薪账期已封账锁定】</strong><br><br>
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
                                                frappe.msgprint({ title: '🔓 账期已反审核解锁', indicator: 'green', message: res.message.message });
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
                        title: '⚠️ 无法执行最终核定：前置任务尚未全部完成',
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
                                    💡 提示：您可以直接点击上方对应的 <strong>[📤 上传]</strong> 按钮快速完成各步骤。
                                </div>
                            </div>
                        `
                    });
                    return;
                }

                // 3. 前置任务全部就绪，弹出最终综合核定封账确认大弹窗
                frappe.confirm(
                    `<strong>【🎉 前置任务全部就绪 · 执行最终薪酬核定并封账】</strong><br><br>
                    核算公司：<strong>${COMPANY}</strong><br>
                    核算月份：<span style="color:#2563eb; font-weight:800;">${cur_m}</span><br>
                    核定在册：<span style="color:#059669; font-weight:700;">${Number(wf.task1_profile.active_count || 0)} 人</span><br><br>
                    <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:8px 10px; font-size:12px; line-height:1.6;">
                        • 车间实发总盘：<strong>¥ ${Number(wf.task2_import.total_net || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})}</strong><br>
                        • 社保申报总额：<strong>¥ ${Number(wf.task3_ss.parsed_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})}</strong><br>
                        • 公积金缴存总额：<strong>¥ ${Number(wf.task4_hf.parsed_amount || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})}</strong>
                    </div><br>
                    <span style="color:#15803d; font-weight:600;">🛡️ 封账后效应：</span><br>
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
                                        title: '🎉 最终核定封账成功',
                                        indicator: 'green',
                                        message: `
                                            <div style="font-size:13px; line-height:1.6;">
                                                ${lock_res.message.message}<br><br>
                                                <button class="btn btn-primary btn-sm" onclick="$('#qifu-month-select').val('${lock_res.message.next_period_month}').trigger('change'); cur_dialog.hide();">
                                                    ⏩ 立即前往下月【${lock_res.message.next_period_month}】建账与录入
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
    });

    // 1. 7 大 Tab 切换监听
    $container.on("click", ".qifu-tab-btn", function() {
        $(".qifu-tab-btn").removeClass("active");
        $(this).addClass("active");
        const tab = $(this).attr("data-tab");
        $(".qifu-tab-content").hide();
        $(`#qifu-tab-${tab}`).show();
        current_tab = tab;
        setTimeout(adjust_active_table_height, 50);

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
        load_calculation_center();
        load_monthly_workflow_hub();
        if (current_tab === 'employees') load_qifu_employees();
        if (current_tab === 'import') load_salary_distribution_tab();
        if (current_tab === 'social_insurance') load_social_insurance_tab();
        if (current_tab === 'housing_fund') load_housing_fund_tab();
        if (current_tab === 'tax') load_tax_settlement_tab();
        if (current_tab === 'settlement') load_payroll_settlement();
        if (current_tab === 'history') load_history_tab();
    });

    $container.on("change", "#qifu-company-select", function() {
        COMPANY = $(this).val() || "";
        if (!COMPANY) return;
        $("#qifu-company-title").text(`${COMPANY} · 人事薪酬综合中枢`);
        init_workbench_with_billing_period();
        if (current_tab === 'import') load_salary_distribution_tab();
        if (current_tab === 'social_insurance') load_social_insurance_tab();
        if (current_tab === 'housing_fund') load_housing_fund_tab();
        if (current_tab === 'tax') load_tax_settlement_tab();
        if (current_tab === 'settlement') load_payroll_settlement();
        if (current_tab === 'history') load_history_tab();
    });

    // 3. 刷新按钮
    $container.on("click", "#btn-qifu-refresh-all", function() {
        load_calculation_center();
        load_monthly_workflow_hub();
        if (current_tab === 'employees') load_qifu_employees();
        if (current_tab === 'import') load_salary_distribution_tab();
        if (current_tab === 'social_insurance') load_social_insurance_tab();
        if (current_tab === 'housing_fund') load_housing_fund_tab();
        if (current_tab === 'tax') load_tax_settlement_tab();
        if (current_tab === 'settlement') load_payroll_settlement();
        if (current_tab === 'history') load_history_tab();
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
    $container.on("click", "#btn-qifu-new-emp", function() {
        open_emp_dialog(null);
    });
    $container.on("click", ".btn-edit-emp", function() {
        const emp_id = $(this).attr("data-id");
        const emp_no = $(this).attr("data-emp-no");
        const cached = (employee_master_rows || []).find(x => (emp_id && x.name === emp_id) || (emp_no && x.employee_no === emp_no));
        if (cached) {
            open_emp_dialog(cached);
        } else {
            frappe.call({
                method: 'frappe.client.get',
                args: { doctype: 'Ashan Employee Salary Profile', name: emp_id },
                callback: function(r) {
                    if (r.message) open_emp_dialog(r.message);
                }
            });
        }
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
            `<strong>【🔄 恢复员工在职状态】</strong><br><br>
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

    $container.on("input change", "#qifu-emp-search, #qifu-emp-type-filter, #qifu-emp-status-filter, #qifu-emp-ret-filter, #qifu-emp-profile-filter", function() {
        render_employees_view(employee_master_rows);
    });

    $container.on("click", "#btn-qifu-emp-reset-filter", function() {
        $('#qifu-emp-search').val('');
        $('#qifu-emp-type-filter, #qifu-emp-status-filter, #qifu-emp-ret-filter, #qifu-emp-profile-filter').val('all');
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
                    `<strong>【⚡ 全员绑定社保最低缴费基数】</strong><br><br>
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
                                    frappe.msgprint({ title: '✅ 已完成绑定', indicator: 'green', message: r.message.message });
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
        $("#qifu-filename-display-tab2").text(`📄 已选择: ${file.name}`);

        const reader = new FileReader();
        reader.onload = function(evt) {
            const raw_b64 = evt.target.result;
            current_selected_file_b64 = raw_b64;
            $("#qifu-import-preview-tab2").show();
            $("#btn-import-confirm-tab2").prop('disabled', true);
            $("#qifu-import-badge-tab2").html(
                `<div style="display:flex; align-items:center; justify-content:space-between;">
                    <span>🔍 正在智能预检【<strong>${file.name}</strong>】...</span>
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
                            `<div><strong>${canImport ? '✅ 预检通过' : '⚠️ 预检完成，暂不可导入'}</strong> · 账期 <strong>${m.detected_period_month || '-'}</strong> · 模板 <strong>${m.schema_version || 'generic-compatible'}</strong> · 兼容度 <strong>${compatibility}%</strong></div>
                             <div style="margin-top:4px;">源表人员 <strong>${m.employee_count}</strong> 人 · 母表匹配 <strong>${m.matched_count || 0}</strong> 人${fuzzy ? `（其中智能别名/一字差异 ${fuzzy} 人）` : ''} · 实发总盘 <strong>¥ ${Number(m.net_salary_total || 0).toLocaleString('zh-CN', {minimumFractionDigits:2})}</strong></div>${periodTip}${unmatchedTip}${diag}`
                        );
                        $("#btn-import-confirm-tab2").prop('disabled', !canImport);
                    } else {
                        const err = (res.message && res.message.message) || '预检 Excel 文件失败，请检查文件格式！';
                        $("#qifu-import-badge-tab2").html(
                            `<span style="color:#dc2626; font-weight:700;">❌ 预检失败：${err}</span>`
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
                        `<span style="color:#dc2626; font-weight:700;">❌ 预检失败：${error_msg}</span>`
                    );
                }
            });
        };
        reader.onerror = function() {
            frappe.msgprint({
                title: '❌ 读取文件失败',
                indicator: 'red',
                message: `无法读取本地文件【${file.name}】，请检查文件是否被占用或损坏！`
            });
        };
        reader.readAsDataURL(file);
    });

    $container.on("click", "#btn-import-confirm-tab2", function() {
        if (!current_selected_file_b64) {
            frappe.msgprint({
                title: '❌ 未选择文件',
                indicator: 'orange',
                message: '文件尚未读取完成或未选择有效文件，请点击上方区域重新选择！'
            });
            return;
        }

        const $btn = $(this);
        $btn.prop('disabled', true).text('⏳ 正在导入并核算...');
        const cur_m = $("#qifu-month-select").val() || current_month;

        execute_qifu_salary_upload(current_selected_file_b64, current_selected_file_name, cur_m, function(success) {
            $btn.prop('disabled', false).text('⚡ 立即导入并融合核算 (生成24列薪资发放表)');
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
    $container.on("click", "#btn-qifu-edit-ss-setting", function() { open_insurance_edit_dialog(); });
    $container.on("click", "#btn-qifu-edit-hf-setting", function() { open_hf_rate_base_dialog(); });
    $container.on("click", "#btn-qifu-edit-tax-setting", function() {
        open_tax_setting_dialog();
    });
    $container.on("click", "#btn-tab3-export-ss", function() { export_excel_action("insurance"); });
    $container.on("click", "#btn-tab3-print-ss", function() {
        print_modal_report(`【${COMPANY}】社会保险缴费明细表`, `核定发薪账期: ${current_month}`, "table-tab3-ss-sheet");
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
    function adjust_active_table_height() {
        $(".qifu-tab-content:visible").each(function() {
            const $box = $(this).find(".qifu-table-box");
            if (!$box.length || !$box.is(':visible')) return;
            const topOffset = $box[0].getBoundingClientRect().top;
            const winH = window.innerHeight;
            const bottomMargin = 16;
            const availableH = winH - topOffset - bottomMargin;
            const finalH = Math.max(300, Math.floor(availableH));

            $box.css({
                "height": finalH + "px",
                "max-height": finalH + "px",
                "overflow-y": "auto",
                "overflow-x": "auto",
                "margin-bottom": "0px"
            });
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
        adjust_active_table_height();
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
                if (current_month && current_month.includes("-")) {
                    const parts = current_month.split("-");
                    let y = parseInt(parts[0], 10);
                    let m = parseInt(parts[1], 10);
                    if (m === 12) { y += 1; m = 1; } else { m += 1; }
                    const m_str = m < 10 ? "0" + m : "" + m;
                    $("#workflow-ss-period-text").text(`${y}-${m_str} (${y}年${m_str}月)`);
                }

                // 在月份选择器旁显示锁定状态提示
                let lock_tip = "";
                if (latest_closed) {
                    lock_tip = `<span id="qifu-period-lock-tip" style="font-size:11px; color:#7c3aed; background:#f5f3ff; border:1px solid #ddd6fe; border-radius:8px; padding:2px 8px; margin-left:6px;">🔒 ${latest_closed} 已封账 · 当前可操作: ${allowed_max}</span>`;
                } else {
                    lock_tip = `<span id="qifu-period-lock-tip" style="font-size:11px; color:#92400e; background:#fef3c7; border:1px solid #fde68a; border-radius:8px; padding:2px 8px; margin-left:6px;">⚠️ 尚无已封账月份 · 当前可操作: ${allowed_max}</span>`;
                }
                // 移除旧提示后插入
                $("#qifu-period-lock-tip").remove();
                $picker.after(lock_tip);

                // 月份选择器变更时强制校验不超过 max
                $picker.off("input.lock_check").on("input.lock_check", function() {
                    const sel = $(this).val();
                    if (sel && sel > allowed_max) {
                        frappe.msgprint({
                            title: "⛔ 账期未解锁",
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
                load_qifu_employees();
                load_monthly_workflow_hub();
                load_calculation_center();
            },
            error: function() {
                // 降级：如果 API 失败，保持原来的默认上月逻辑继续加载
                console.warn("get_allowed_billing_period failed, falling back to default prev month");
                current_history_period = current_month;
                load_qifu_employees();
                load_monthly_workflow_hub();
                load_calculation_center();
            }
        });
    }

    function init_company_context() {
        frappe.call({
            method: "ashan_cn_procurement.services.authorization_service.get_module_company_options",
            args: { module: "payroll" },
            callback: function(r) {
                let companies = r.message || [];
                // 铁律：祺富工作台严格物理隔离，仅承载祺富主体，绝对杜绝混入吉众
                const qifu_companies = companies.filter(c => c.includes("祺富"));
                if (qifu_companies.length) {
                    companies = qifu_companies;
                }
                if (!companies.length) {
                    frappe.msgprint("当前账号未获授祺富公司权限，无法加载薪酬数据。");
                    return;
                }
                const $companySelect = $("#qifu-company-select");
                $companySelect.empty();
                companies.forEach(function(company) {
                    $companySelect.append(
                        `<option value="${frappe.utils.escape_html(company)}">${frappe.utils.escape_html(company)}</option>`
                    );
                });
                COMPANY = companies.includes("天津祺富机械加工有限公司") ? "天津祺富机械加工有限公司" : (companies[0] || "天津祺富机械加工有限公司");
                $companySelect.val(COMPANY);
                $("#qifu-company-title").text(`${COMPANY} · 人事薪酬综合中枢`);
                init_workbench_with_billing_period();
            },
            error: function() {
                frappe.msgprint("无法读取当前账号的公司权限范围，请刷新后重试。");
            }
        });
    }

    init_company_context();

    // 后台计算完成后仅刷新当前可见业务区，避免整页刷新打断操作。
    if (frappe.realtime && frappe.realtime.on) {
        frappe.realtime.on('ashan_payroll_recalc_update', function(payload) {
            if (!payload || payload.company !== COMPANY) return;
            if (payload.period_month && payload.period_month !== current_month) return;
            refresh_after_recalculation();
        });
    }
    recalculation_poll_timer = setInterval(function() {
        if (COMPANY && document.visibilityState === 'visible') load_calculation_center();
    }, 10000);

    wrapper.refresh_workbench = function() {
        if (!COMPANY) return;
        load_qifu_employees();
        load_monthly_workflow_hub();
        load_calculation_center();
    };
};

frappe.pages['qifu-hr-salary-workbench'].on_page_show = function(wrapper) {
    if (wrapper && typeof wrapper.refresh_workbench === 'function') {
        wrapper.refresh_workbench();
    }
};
