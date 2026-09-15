// Copyright (c) 2026, Ashan CN Procurement
frappe.pages['employee-salary-workbench'].on_page_load = function(wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: '人员薪酬档案管理工作台',
        single_column: true
    });

    frappe.breadcrumbs.add("Ashan CN Procurement");

    // 主体状态
    let current_company = "天津祺富机械加工有限公司";
    let search_text = "";
    let employee_type_filter = "全部";
    let selected_employees = new Set();
    let current_records = [];

    // 渲染骨架
    const $container = $(`
        <div class="emp-workbench-container">
            <!-- 顶部公司切换 Tabs -->
            <div class="emp-company-tabs">
                <div class="emp-company-tab active" data-company="天津祺富机械加工有限公司">
                    <span>天津祺富机械加工有限公司</span>
                </div>
                <div class="emp-company-tab" data-company="天津吉众科技有限公司">
                    <span>天津吉众科技有限公司</span>
                </div>
            </div>

            <!-- KPI 统计卡片条 -->
            <div class="emp-kpi-grid">
                <div class="emp-kpi-card">
                    <div class="kpi-label">在职员工总数</div>
                    <div class="kpi-value" id="kpi-total-count">-</div>
                    <div class="kpi-sub">当前主体全部有效档案</div>
                </div>
                <div class="emp-kpi-card">
                    <div class="kpi-label">正式工人数</div>
                    <div class="kpi-value" id="kpi-regular-count" style="color: #15803d;">-</div>
                    <div class="kpi-sub">缴纳五险一金/标准工时</div>
                </div>
                <div class="emp-kpi-card">
                    <div class="kpi-label">返聘 / 临时 / 外籍</div>
                    <div class="kpi-value" id="kpi-rehire-count" style="color: #b45309;">-</div>
                    <div class="kpi-sub">灵活工时 / 退休返聘</div>
                </div>
                <div class="emp-kpi-card">
                    <div class="kpi-label">月度基础薪酬总盘 (预算)</div>
                    <div class="kpi-value money-cell" id="kpi-total-payroll" style="color: #2563eb;">-</div>
                    <div class="kpi-sub" id="kpi-payroll-desc">固定薪资 / 基础津贴核定</div>
                </div>
            </div>

            <!-- 批量操作工具条 (选中时显示) -->
            <div class="emp-batch-bar" id="emp-batch-bar">
                <div class="emp-batch-info">
                    已选中 <strong id="batch-selected-count">0</strong> 位员工
                </div>
                <div style="display: flex; gap: 8px;">
                    <button class="emp-batch-btn" id="btn-open-batch-modal">批量修改参数</button>
                    <button class="btn btn-default btn-xs" id="btn-clear-selection" style="background:#fff;">取消选择</button>
                </div>
            </div>

            <!-- 工具栏与过滤栏 -->
            <div class="emp-toolbar">
                <div class="emp-toolbar-left">
                    <input type="text" class="emp-search-input" id="emp-search-input" placeholder="快速搜索工号、姓名、手机号、部门..." />
                    <select class="emp-type-filter" id="emp-type-filter">
                        <option value="全部">全部人员类型</option>
                        <option value="正式工">正式工</option>
                        <option value="返聘工">返聘工</option>
                        <option value="临时工">临时工</option>
                        <option value="外籍工">外籍工</option>
                        <option value="实习生">实习生</option>
                    </select>

                    <!-- 祺富专属快捷公积金一键控制组 -->
                    <div id="qifu-quick-actions" style="display: flex; gap: 8px; align-items: center;">
                        <button class="btn btn-default btn-sm" id="btn-qifu-hf-min" style="border-color: #2563eb; color: #2563eb; font-weight: 600;" title="将符合条件的参保员工公积金基数批量设为最低基数">
                            一键全员公积金 (最低基数)
                        </button>
                        <button class="btn btn-default btn-sm" id="btn-qifu-hf-zero" style="border-color: #ef4444; color: #ef4444; font-weight: 600;" title="将符合批量规则的员工公积金基数清零">
                            一键取消公积金 (清零)
                        </button>
                        <span style="font-size: 12px; color: #64748b; background: #f1f5f9; padding: 2px 8px; border-radius: 4px;">批量操作按员工参保状态动态执行</span>
                    </div>
                </div>
                <div class="emp-toolbar-right">
                    <button class="btn btn-default btn-sm" id="btn-refresh-list">刷新数据</button>
                    <button class="btn btn-primary btn-sm" id="btn-new-employee">新增人员档案</button>
                </div>
            </div>

            <!-- 数据表格 -->
            <div class="emp-table-wrapper">
                <table class="emp-data-table" id="emp-data-table">
                    <thead id="emp-table-head">
                        <!-- 动态表头 -->
                    </thead>
                    <tbody id="emp-table-body">
                        <!-- 动态数据行 -->
                    </tbody>
                </table>
            </div>
        </div>
    `).appendTo(page.main);

    // 格式化金额
    function format_currency(val) {
        const num = parseFloat(val || 0);
        return '¥ ' + num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    // 加载数据
    function load_data() {
        selected_employees.clear();
        update_batch_bar();

        $("#emp-table-body").html('<tr><td colspan="15" style="text-align:center; padding:30px; color:#94a3b8;">⏳ 正在加载员工档案数据...</td></tr>');

        frappe.call({
            method: 'ashan_cn_procurement.services.employee_salary_service.get_employee_profiles',
            args: {
                company: current_company,
                search_text: search_text,
                employee_type: employee_type_filter
            },
            callback: function(r) {
                if (r.message) {
                    const data = r.message;
                    current_records = data.records || [];
                    render_kpi(data.kpi);
                    render_table();
                }
            }
        });
    }

    // 渲染 KPI
    function render_kpi(kpi) {
        if (!kpi) return;
        $("#kpi-total-count").text(kpi.total_count + ' 人');
        $("#kpi-regular-count").text(kpi.regular_count + ' 人');
        $("#kpi-rehire-count").text((kpi.rehire_count + kpi.other_type_count) + ' 人');
        $("#kpi-total-payroll").text(format_currency(kpi.total_base_payroll));

        if (current_company.indexOf("祺富") !== -1) {
            $("#kpi-payroll-desc").text("税后一口价/固定薪资总盘");
        } else {
            $("#kpi-payroll-desc").text("基本工资 + 岗位/各项津贴总盘");
        }
    }

    // 渲染表格表头与数据行
    function render_table() {
        const isQifu = current_company.indexOf("祺富") !== -1;
        const $thead = $("#emp-table-head");
        const $tbody = $("#emp-table-body");

        // 表头
        if (isQifu) {
            $thead.html(`
                <tr>
                    <th style="width: 40px;"><input type="checkbox" id="check-all-emp" /></th>
                    <th>工号</th>
                    <th>姓名</th>
                    <th>性别</th>
                    <th>身份证号</th>
                    <th>手机号</th>
                    <th>年龄</th>
                    <th>法定退休日期</th>
                    <th>人员类型</th>
                    <th>计薪方式</th>
                    <th>固定工资</th>
                    <th>社保基数</th>
                    <th>公积金基数</th>
                    <th>7项专项扣除</th>
                    <th style="text-align: center;">操作</th>
                </tr>
            `);
        } else {
            // 吉众重点：基本工资、岗位津贴、绩效基数、各项补贴
            $thead.html(`
                <tr>
                    <th style="width: 40px;"><input type="checkbox" id="check-all-emp" /></th>
                    <th>工号</th>
                    <th>姓名</th>
                    <th>部门</th>
                    <th>岗位职务</th>
                    <th>人员类型</th>
                    <th>计薪方式</th>
                    <th>基本工资</th>
                    <th>岗位津贴</th>
                    <th>绩效基数</th>
                    <th>津贴补贴合计</th>
                    <th>社保基数</th>
                    <th>公积金基数</th>
                    <th style="text-align: center;">操作</th>
                </tr>
            `);
        }

        // 数据行
        if (!current_records || current_records.length === 0) {
            $tbody.html('<tr><td colspan="15" style="text-align:center; padding:30px; color:#94a3b8;">暂无符合条件的员工档案</td></tr>');
            return;
        }

        let rowsHtml = '';
        current_records.forEach(r => {
            const isChecked = selected_employees.has(r.name) ? 'checked' : '';
            const trClass = selected_employees.has(r.name) ? 'selected' : '';
            
            let typeBadge = '<span class="badge-type-regular">正式工</span>';
            if (r.employee_type === '返聘工') {
                typeBadge = '<span class="badge-type-rehire">返聘工</span>';
            } else if (r.employee_type !== '正式工') {
                typeBadge = `<span class="badge-type-other">${r.employee_type || '其他'}</span>`;
            }

            if (isQifu) {
                rowsHtml += `
                    <tr class="${trClass}" data-name="${r.name}">
                        <td><input type="checkbox" class="emp-row-check" data-name="${r.name}" ${isChecked} /></td>
                        <td><strong>${r.employee_no || '—'}</strong></td>
                        <td><strong style="color: #0f172a;">${r.employee_name}</strong></td>
                        <td>${r.gender || '—'}</td>
                        <td style="font-family: monospace;">${r.id_card || '—'}</td>
                        <td>${r.mobile || '—'}</td>
                        <td>${r.current_age ? r.current_age + '岁' : '—'}</td>
                        <td>${r.retirement_date || '—'}</td>
                        <td>${typeBadge}</td>
                        <td><span style="font-weight:600; color:#475569;">${r.salary_mode || '税后'}</span></td>
                        <td class="money-cell" style="color:#2563eb;">${format_currency(r.fixed_salary)}</td>
                        <td class="money-cell">${format_currency(r.social_security_base)}</td>
                        <td class="money-cell">${format_currency(r.housing_fund_base)}</td>
                        <td class="money-cell" style="color:#15803d;">${format_currency(r.total_deduction)}</td>
                        <td style="text-align: center;">
                            <button class="btn-emp-edit" data-name="${r.name}">✏️ 修改参数</button>
                        </td>
                    </tr>
                `;
            } else {
                rowsHtml += `
                    <tr class="${trClass}" data-name="${r.name}">
                        <td><input type="checkbox" class="emp-row-check" data-name="${r.name}" ${isChecked} /></td>
                        <td><strong>${r.employee_no || '—'}</strong></td>
                        <td><strong style="color: #0f172a;">${r.employee_name}</strong></td>
                        <td>${r.department || '—'}</td>
                        <td>${r.job_title || '—'}</td>
                        <td>${typeBadge}</td>
                        <td><span style="font-weight:600; color:#475569;">${r.salary_mode || '税后'}</span></td>
                        <td class="money-cell" style="color:#2563eb;">${format_currency(r.base_salary)}</td>
                        <td class="money-cell">${format_currency(r.post_allowance)}</td>
                        <td class="money-cell">${format_currency(r.performance_base)}</td>
                        <td class="money-cell" style="color:#15803d;">${format_currency(r.total_allowance)}</td>
                        <td class="money-cell">${format_currency(r.social_security_base)}</td>
                        <td class="money-cell">${format_currency(r.housing_fund_base)}</td>
                        <td style="text-align: center;">
                            <button class="btn-emp-edit" data-name="${r.name}">✏️ 修改参数</button>
                        </td>
                    </tr>
                `;
            }
        });

        $tbody.html(rowsHtml);
    }

    // 更新批量操作条显示
    function update_batch_bar() {
        const count = selected_employees.size;
        if (count > 0) {
            $("#emp-batch-bar").css("display", "flex");
            $("#batch-selected-count").text(count);
        } else {
            $("#emp-batch-bar").hide();
        }
    }

    // 单人就地修改参数 Modal
    function open_single_edit_modal(emp_name) {
        const emp = current_records.find(r => r.name === emp_name);
        if (!emp) return;

        const isQifu = current_company.indexOf("祺富") !== -1;

        let fieldsHtml = '';
        if (isQifu) {
            fieldsHtml = `
                <div class="modal-form-group">
                    <label class="modal-form-label">固定工资 (元/月 - 税后)</label>
                    <input type="number" step="0.01" class="modal-form-input" id="m-fixed-salary" value="${emp.fixed_salary || 0}" />
                </div>
                <div class="modal-form-group">
                    <label class="modal-form-label">人员类型</label>
                    <select class="modal-form-input" id="m-employee-type">
                        <option value="正式工" ${emp.employee_type==='正式工'?'selected':''}>正式工</option>
                        <option value="返聘工" ${emp.employee_type==='返聘工'?'selected':''}>返聘工</option>
                        <option value="临时工" ${emp.employee_type==='临时工'?'selected':''}>临时工</option>
                        <option value="外籍工" ${emp.employee_type==='外籍工'?'selected':''}>外籍工</option>
                        <option value="实习生" ${emp.employee_type==='实习生'?'selected':''}>实习生</option>
                    </select>
                </div>
                <div class="modal-form-group">
                    <label class="modal-form-label">社保缴费基数 (元)</label>
                    <input type="number" step="0.01" class="modal-form-input" id="m-ss-base" value="${emp.social_security_base || 5124}" />
                </div>
                <div class="modal-form-group">
                    <label class="modal-form-label">公积金缴费基数 (元)</label>
                    <input type="number" step="0.01" class="modal-form-input" id="m-hf-base" value="${emp.housing_fund_base || 2320}" />
                </div>
                <div class="modal-form-group">
                    <label class="modal-form-label">法定退休年龄</label>
                    <input type="number" step="0.5" class="modal-form-input" id="m-retire-age" value="${emp.retirement_age || 55}" />
                </div>
                <div class="modal-form-group">
                    <label class="modal-form-label">法定退休日期</label>
                    <input type="date" class="modal-form-input" id="m-retire-date" value="${emp.retirement_date || ''}" />
                </div>
                <div class="modal-form-group full-width">
                    <label class="modal-form-label" style="color:#15803d; border-bottom: 1px dashed #cbd5e1; padding-bottom: 4px; margin-top: 6px;">个税专项附加扣除 (元/月)</label>
                </div>
                <div class="modal-form-group">
                    <label class="modal-form-label">子女教育</label>
                    <input type="number" class="modal-form-input" id="m-ded-child" value="${emp.deduction_child_education || 0}" />
                </div>
                <div class="modal-form-group">
                    <label class="modal-form-label">住房贷款利息</label>
                    <input type="number" class="modal-form-input" id="m-ded-loan" value="${emp.deduction_housing_loan || 0}" />
                </div>
                <div class="modal-form-group">
                    <label class="modal-form-label">住房租金</label>
                    <input type="number" class="modal-form-input" id="m-ded-rent" value="${emp.deduction_housing_rent || 0}" />
                </div>
                <div class="modal-form-group">
                    <label class="modal-form-label">赡养老人</label>
                    <input type="number" class="modal-form-input" id="m-ded-elder" value="${emp.deduction_elderly_care || 0}" />
                </div>
                <div class="modal-form-group">
                    <label class="modal-form-label">3岁以下婴幼儿照护</label>
                    <input type="number" class="modal-form-input" id="m-ded-infant" value="${emp.deduction_infant_care || 0}" />
                </div>
                <div class="modal-form-group">
                    <label class="modal-form-label">大病医疗/继续教育</label>
                    <input type="number" class="modal-form-input" id="m-ded-illness" value="${emp.deduction_serious_illness || 0}" />
                </div>
            `;
        } else {
            // 吉众重点：基本工资、津贴、补贴、绩效
            fieldsHtml = `
                <div class="modal-form-group">
                    <label class="modal-form-label">基本工资 (元/月)</label>
                    <input type="number" step="0.01" class="modal-form-input" id="m-base-salary" value="${emp.base_salary || 0}" />
                </div>
                <div class="modal-form-group">
                    <label class="modal-form-label">岗位津贴 / 职务补贴 (元)</label>
                    <input type="number" step="0.01" class="modal-form-input" id="m-post-allowance" value="${emp.post_allowance || 0}" />
                </div>
                <div class="modal-form-group">
                    <label class="modal-form-label">绩效基数 (元)</label>
                    <input type="number" step="0.01" class="modal-form-input" id="m-performance-base" value="${emp.performance_base || 0}" />
                </div>
                <div class="modal-form-group">
                    <label class="modal-form-label">餐费补贴 (元)</label>
                    <input type="number" step="0.01" class="modal-form-input" id="m-meal-allowance" value="${emp.meal_allowance || 0}" />
                </div>
                <div class="modal-form-group">
                    <label class="modal-form-label">交通补贴 / 车补 (元)</label>
                    <input type="number" step="0.01" class="modal-form-input" id="m-traffic-allowance" value="${emp.traffic_allowance || 0}" />
                </div>
                <div class="modal-form-group">
                    <label class="modal-form-label">通讯补贴 (元)</label>
                    <input type="number" step="0.01" class="modal-form-input" id="m-communication-allowance" value="${emp.communication_allowance || 0}" />
                </div>
                <div class="modal-form-group">
                    <label class="modal-form-label">所属部门</label>
                    <input type="text" class="modal-form-input" id="m-department" value="${emp.department || ''}" />
                </div>
                <div class="modal-form-group">
                    <label class="modal-form-label">岗位职务</label>
                    <input type="text" class="modal-form-input" id="m-job-title" value="${emp.job_title || ''}" />
                </div>
                <div class="modal-form-group">
                    <label class="modal-form-label">计薪方式</label>
                    <select class="modal-form-input" id="m-salary-mode">
                        <option value="税后" ${emp.salary_mode==='税后'?'selected':''}>税后</option>
                        <option value="税前" ${emp.salary_mode==='税前'?'selected':''}>税前</option>
                    </select>
                </div>
                <div class="modal-form-group">
                    <label class="modal-form-label">人员类型</label>
                    <select class="modal-form-input" id="m-employee-type">
                        <option value="正式工" ${emp.employee_type==='正式工'?'selected':''}>正式工</option>
                        <option value="返聘工" ${emp.employee_type==='返聘工'?'selected':''}>返聘工</option>
                        <option value="临时工" ${emp.employee_type==='临时工'?'selected':''}>临时工</option>
                        <option value="外籍工" ${emp.employee_type==='外籍工'?'selected':''}>外籍工</option>
                    </select>
                </div>
                <div class="modal-form-group">
                    <label class="modal-form-label">社保缴费基数 (元)</label>
                    <input type="number" step="0.01" class="modal-form-input" id="m-ss-base" value="${emp.social_security_base || 5124}" />
                </div>
                <div class="modal-form-group">
                    <label class="modal-form-label">公积金缴费基数 (元)</label>
                    <input type="number" step="0.01" class="modal-form-input" id="m-hf-base" value="${emp.housing_fund_base || 2320}" />
                </div>
            `;
        }

        const d = new frappe.ui.Dialog({
            title: `✏️ 修改员工参数：${emp.employee_name} (${emp.employee_no})`,
            fields: [
                {
                    fieldtype: 'HTML',
                    fieldname: 'form_html',
                    options: `<div class="modal-form-grid">${fieldsHtml}</div>`
                }
            ],
            primary_action_label: '💾 保存修改',
            primary_action: function() {
                let patch_data = {};
                if (isQifu) {
                    patch_data = {
                        fixed_salary: $("#m-fixed-salary").val(),
                        employee_type: $("#m-employee-type").val(),
                        social_security_base: $("#m-ss-base").val(),
                        housing_fund_base: $("#m-hf-base").val(),
                        retirement_age: $("#m-retire-age").val(),
                        retirement_date: $("#m-retire-date").val(),
                        deduction_child_education: $("#m-ded-child").val(),
                        deduction_housing_loan: $("#m-ded-loan").val(),
                        deduction_housing_rent: $("#m-ded-rent").val(),
                        deduction_elderly_care: $("#m-ded-elder").val(),
                        deduction_infant_care: $("#m-ded-infant").val(),
                        deduction_serious_illness: $("#m-ded-illness").val()
                    };
                } else {
                    patch_data = {
                        base_salary: $("#m-base-salary").val(),
                        post_allowance: $("#m-post-allowance").val(),
                        performance_base: $("#m-performance-base").val(),
                        meal_allowance: $("#m-meal-allowance").val(),
                        traffic_allowance: $("#m-traffic-allowance").val(),
                        communication_allowance: $("#m-communication-allowance").val(),
                        department: $("#m-department").val(),
                        job_title: $("#m-job-title").val(),
                        salary_mode: $("#m-salary-mode").val(),
                        employee_type: $("#m-employee-type").val(),
                        social_security_base: $("#m-ss-base").val(),
                        housing_fund_base: $("#m-hf-base").val()
                    };
                }

                frappe.call({
                    method: 'ashan_cn_procurement.services.employee_salary_service.update_single_employee',
                        type: 'POST',
                    args: {
                        employee_name: emp_name,
                        data: patch_data
                    },
                    callback: function(res) {
                        if (res.message && res.message.success) {
                            frappe.show_alert({ message: res.message.message, indicator: 'green' });
                            d.hide();
                            load_data();
                        }
                    }
                });
            }
        });

        d.show();
    }

    // 批量修改参数 Modal
    function open_batch_edit_modal() {
        const emp_names = Array.from(selected_employees);
        if (emp_names.length === 0) {
            frappe.msgprint("请先勾选需要批量修改的员工！");
            return;
        }

        const isQifu = current_company.indexOf("祺富") !== -1;

        let fieldOptions = [
            { label: "社保缴费基数 (元)", value: "social_security_base" },
            { label: "公积金缴费基数 (元)", value: "housing_fund_base" },
            { label: "人员类型 (正式工/返聘工/临时工/外籍工)", value: "employee_type" },
            { label: "计薪方式 (税后/税前)", value: "salary_mode" },
            { label: "在职状态 (在职/离职)", value: "employment_status" }
        ];

        if (isQifu) {
            fieldOptions.push({ label: "固定工资 (元)", value: "fixed_salary" });
            fieldOptions.push({ label: "法定退休年龄", value: "retirement_age" });
            fieldOptions.push({ label: "个税扣除: 赡养老人", value: "deduction_elderly_care" });
            fieldOptions.push({ label: "个税扣除: 子女教育", value: "deduction_child_education" });
            fieldOptions.push({ label: "个税扣除: 住房贷款", value: "deduction_housing_loan" });
        } else {
            fieldOptions.push({ label: "基本工资 (元)", value: "base_salary" });
            fieldOptions.push({ label: "岗位津贴 (元)", value: "post_allowance" });
            fieldOptions.push({ label: "绩效基数 (元)", value: "performance_base" });
            fieldOptions.push({ label: "餐费补贴 (元)", value: "meal_allowance" });
            fieldOptions.push({ label: "交通补贴 (元)", value: "traffic_allowance" });
            fieldOptions.push({ label: "通讯补贴 (元)", value: "communication_allowance" });
            fieldOptions.push({ label: "所属部门", value: "department" });
        }

        const d = new frappe.ui.Dialog({
            title: `⚙️ 批量修改 ${emp_names.length} 位选中员工的参数`,
            fields: [
                {
                    label: '选择要批量修改的参数项',
                    fieldname: 'target_field',
                    fieldtype: 'Select',
                    options: fieldOptions,
                    reqd: 1
                },
                {
                    label: '设置新的统一值',
                    fieldname: 'target_value',
                    fieldtype: 'Data',
                    reqd: 1,
                    description: '例如：修改基数填写 5124，修改人员类型填写 正式工，修改餐补填写 300'
                }
            ],
            primary_action_label: '🚀 确认批量应用',
            primary_action: function(values) {
                frappe.confirm(`确定要将选中的 ${emp_names.length} 位员工的【${values.target_field}】统一修改为【${values.target_value}】吗？`, function() {
                    frappe.call({
                        method: 'ashan_cn_procurement.services.employee_salary_service.batch_update_employees',
                        type: 'POST',
                        args: {
                            employee_names: emp_names,
                            fieldname: values.target_field,
                            value: values.target_value
                        },
                        callback: function(res) {
                            if (res.message && res.message.success) {
                                frappe.show_alert({ message: res.message.message, indicator: 'green' });
                                d.hide();
                                load_data();
                            }
                        }
                    });
                });
            }
        });

        d.show();
    }

    // 事件绑定
    // 1. 公司切换
    $container.on("click", ".emp-company-tab", function() {
        $(".emp-company-tab").removeClass("active");
        $(this).addClass("active");
        current_company = $(this).attr("data-company");
        
        if (current_company.indexOf("祺富") !== -1) {
            $("#qifu-quick-actions").show();
        } else {
            $("#qifu-quick-actions").hide();
        }
        
        load_data();
    });

    // 祺富一键全员公积金（设为最低基数）
    $container.on("click", "#btn-qifu-hf-min", function() {
        frappe.confirm(
            `<strong>【⚡ 一键全员公积金 (最低基数)】</strong><br><br>
            规则说明：<br>
            1. <strong>资格条件</strong>：仅对【社保基数 > 0】的在保员工生效，一键设为最低基数 (2320 元)；<br>
            2. <strong>未参保跳过</strong>：社保基数为 0 的人员将自动跳过并保持 0 元；<br>
            3. <span style="color: #15803d; font-weight: 600;">系统按当前员工参保状态逐人校验，不使用任何人员姓名硬编码例外。</span><br><br>
            确认执行吗？`,
            function() {
                frappe.call({
                    method: 'ashan_cn_procurement.services.employee_salary_service.set_qifu_housing_fund_batch',
                    type: 'POST',
                    args: { mode: 'min' },
                    callback: function(r) {
                        if (r.message && r.message.success) {
                            frappe.msgprint({
                                title: '✅ 批处理完成',
                                indicator: 'green',
                                message: r.message.message + '<br><br>未参保跳过：' + ((r.message.skipped_no_insurance || []).join(', ') || '无')
                            });
                            load_data();
                        }
                    }
                });
            }
        );
    });

    // 祺富一键取消全员公积金（清零）
    $container.on("click", "#btn-qifu-hf-zero", function() {
        frappe.confirm(
            `<strong>【🚫 一键取消全员公积金 (设为0)】</strong><br><br>将一键把天津祺富机械加工有限公司所有员工公积金基数清零 (0 元)。<br><br><span style="color: #15803d; font-weight: 600;">系统将按当前员工参保状态逐人校验，不使用姓名硬编码例外。</span><br><br>确认执行吗？`,
            function() {
                frappe.call({
                    method: 'ashan_cn_procurement.services.employee_salary_service.set_qifu_housing_fund_batch',
                    type: 'POST',
                    args: { mode: 'zero' },
                    callback: function(r) {
                        if (r.message && r.message.success) {
                            frappe.msgprint({
                                title: '✅ 批处理完成',
                                indicator: 'green',
                                message: r.message.message + '<br><br>未参保跳过：' + ((r.message.skipped_no_insurance || []).join(', ') || '无')
                            });
                            load_data();
                        }
                    }
                });
            }
        );
    });

    // 2. 搜索框
    let searchTimer = null;
    $container.on("input", "#emp-search-input", function() {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            search_text = $(this).val();
            load_data();
        }, 300);
    });

    // 3. 人员类型过滤
    $container.on("change", "#emp-type-filter", function() {
        employee_type_filter = $(this).val();
        load_data();
    });

    // 4. 全选与单选
    $container.on("change", "#check-all-emp", function() {
        const checked = $(this).prop("checked");
        if (checked) {
            current_records.forEach(r => selected_employees.add(r.name));
        } else {
            selected_employees.clear();
        }
        $(".emp-row-check").prop("checked", checked);
        $(".emp-data-table tbody tr").toggleClass("selected", checked);
        update_batch_bar();
    });

    $container.on("change", ".emp-row-check", function() {
        const name = $(this).attr("data-name");
        const checked = $(this).prop("checked");
        if (checked) {
            selected_employees.add(name);
        } else {
            selected_employees.delete(name);
        }
        $(this).closest("tr").toggleClass("selected", checked);
        update_batch_bar();
    });

    // 5. 批量修改与取消
    $container.on("click", "#btn-open-batch-modal", function() {
        open_batch_edit_modal();
    });

    $container.on("click", "#btn-clear-selection", function() {
        selected_employees.clear();
        $("#check-all-emp").prop("checked", false);
        $(".emp-row-check").prop("checked", false);
        $(".emp-data-table tbody tr").removeClass("selected");
        update_batch_bar();
    });

    // 6. 单人修改
    $container.on("click", ".btn-emp-edit", function(e) {
        e.stopPropagation();
        const name = $(this).attr("data-name");
        open_single_edit_modal(name);
    });

    // 7. 新增员工
    $container.on("click", "#btn-new-employee", function() {
        frappe.new_doc('Ashan Employee Salary Profile', { company: current_company });
    });

    // 8. 刷新
    $container.on("click", "#btn-refresh-list", function() {
        load_data();
    });

    // 初始加载
    load_data();

    // 挂载实例至 wrapper 供 SPA 重新切入时唤醒
    wrapper.load_data = load_data;
};

frappe.pages['employee-salary-workbench'].on_page_show = function(wrapper) {
    if (wrapper && typeof wrapper.load_data === "function") {
        wrapper.load_data();
    }
};
