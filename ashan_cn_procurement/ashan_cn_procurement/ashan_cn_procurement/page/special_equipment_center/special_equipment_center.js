// Copyright (c) 2026, Ashan CN Procurement and contributors
// For license information, please see license.txt

frappe.pages["special-equipment-center"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("特种设备管理"),
		single_column: true,
	});

	new SpecialEquipmentCenter(page);
};

frappe.pages["special-equipment-center"].on_page_show = function (wrapper) {
	if (wrapper.special_equipment_center) {
		wrapper.special_equipment_center.refresh();
	}
};

class SpecialEquipmentCenter {
	constructor(page) {
		this.page = page;
		this.wrapper = $(page.body);
		this.page.wrapper.special_equipment_center = this;

		this.currentFilters = {
			company: "",
			category: "",
			equipment_status: "在用",
			inspection_status: "全部",
			annual_status: "全部",
			search_text: "",
		};

		this.activeKpiCard = null;
		this.init();
	}

	init() {
		this.init_dom();
		this.bind_events();
		this.refresh();
	}

	init_dom() {
		const html = `
		<div class="sec-center-wrapper">
			<!-- 顶部控制栏 -->
			<div class="sec-header-bar">
				<div class="sec-title-box">
					<h2 class="sec-title">🚗 特种设备管理中心</h2>
					<span class="sec-subtitle">法定检验 · 年度检查 · 临期预警台账</span>
				</div>
				<div class="sec-actions">
					<button class="sec-btn" id="btn-refresh-data">🔄 刷新数据</button>
					<button class="sec-btn sec-btn-primary" id="btn-quick-add-equipment">➕ 建立特种设备档案</button>
				</div>
			</div>

			<!-- KPI 概览统计卡 -->
			<div class="sec-kpi-grid">
				<div class="sec-kpi-card sec-kpi-total" data-kpi="all">
					<div class="sec-kpi-label">特种设备总数</div>
					<div class="sec-kpi-num" id="kpi-total">0</div>
					<div class="sec-kpi-sub">在用：<span id="kpi-active">0</span> 台</div>
				</div>
				<div class="sec-kpi-card sec-kpi-insp-warn" data-kpi="insp_expiring_60">
					<div class="sec-kpi-label">🛡️ 法定检验 60天内到期</div>
					<div class="sec-kpi-num" id="kpi-insp-expiring">0</div>
					<div class="sec-kpi-sub">点击快速筛选</div>
				</div>
				<div class="sec-kpi-card sec-kpi-annual-warn" data-kpi="annual_expiring_60">
					<div class="sec-kpi-label">📋 年度检查 60天内到期</div>
					<div class="sec-kpi-num" id="kpi-annual-expiring">0</div>
					<div class="sec-kpi-sub">点击快速筛选</div>
				</div>
				<div class="sec-kpi-card sec-kpi-insp-overdue" data-kpi="insp_overdue">
					<div class="sec-kpi-label">⚠️ 法定检验已逾期</div>
					<div class="sec-kpi-num" id="kpi-insp-overdue">0</div>
					<div class="sec-kpi-sub" style="color:#e53e3e;">需立即处理</div>
				</div>
				<div class="sec-kpi-card sec-kpi-annual-overdue" data-kpi="annual_overdue">
					<div class="sec-kpi-label">⚠️ 年度检查已逾期</div>
					<div class="sec-kpi-num" id="kpi-annual-overdue">0</div>
					<div class="sec-kpi-sub" style="color:#e53e3e;">需立即自查</div>
				</div>
			</div>

			<!-- 综合筛选工具栏 -->
			<div class="sec-filter-bar">
				<div class="sec-filter-item">
					<span class="sec-filter-label">公司:</span>
					<select class="sec-select" id="filter-company">
						<option value="">全部公司</option>
					</select>
				</div>
				<div class="sec-filter-item">
					<span class="sec-filter-label">类别:</span>
					<select class="sec-select" id="filter-category">
						<option value="">全部类别</option>
					</select>
				</div>
				<div class="sec-filter-item">
					<span class="sec-filter-label">设备状态:</span>
					<select class="sec-select" id="filter-status">
						<option value="在用" selected>在用</option>
						<option value="停用">停用</option>
						<option value="报废">报废</option>
						<option value="注销">注销</option>
						<option value="全部">全部状态</option>
					</select>
				</div>
				<div class="sec-filter-item">
					<span class="sec-filter-label">法定检验:</span>
					<select class="sec-select" id="filter-insp-status">
						<option value="全部">全部状态</option>
						<option value="已逾期">已逾期</option>
						<option value="今日到期">今日到期</option>
						<option value="即将到期">即将到期 (30天内)</option>
						<option value="注意">注意 (60天内)</option>
						<option value="正常">正常</option>
						<option value="待录入">待录入</option>
					</select>
				</div>
				<div class="sec-filter-item">
					<span class="sec-filter-label">年度检查:</span>
					<select class="sec-select" id="filter-annual-status">
						<option value="全部">全部状态</option>
						<option value="已逾期">已逾期</option>
						<option value="今日到期">今日到期</option>
						<option value="即将到期">即将到期</option>
						<option value="注意">注意</option>
						<option value="正常">正常</option>
						<option value="待检查">待检查</option>
					</select>
				</div>
				<div class="sec-filter-item" style="flex:1;">
					<input type="text" class="sec-input sec-search-input" id="filter-search" placeholder="搜索车牌、内部号、设备名、注册码..." />
				</div>
				<button class="sec-btn" id="btn-reset-filters">重置筛选</button>
			</div>

			<!-- 特种设备主表格容器 -->
			<div class="sec-table-wrapper" id="equipment-table-container">
				<div style="padding:40px; text-align:center; color:#a0aec0;">正在加载特种设备台账...</div>
			</div>
		</div>
		`;

		this.wrapper.html(html);
	}

	bind_events() {
		const self = this;

		// 刷新按钮
		this.wrapper.find("#btn-refresh-data").on("click", () => {
			self.refresh();
		});

		// 极速新建设备
		this.wrapper.find("#btn-quick-add-equipment").on("click", () => {
			self.open_quick_create_dialog();
		});

		// 筛选器联动
		this.wrapper.find("#filter-company").on("change", function () {
			self.currentFilters.company = $(this).val();
			self.refresh();
		});

		this.wrapper.find("#filter-category").on("change", function () {
			self.currentFilters.category = $(this).val();
			self.refresh();
		});

		this.wrapper.find("#filter-status").on("change", function () {
			self.currentFilters.equipment_status = $(this).val();
			self.refresh();
		});

		this.wrapper.find("#filter-insp-status").on("change", function () {
			self.currentFilters.inspection_status = $(this).val();
			self.clear_kpi_active();
			self.refresh();
		});

		this.wrapper.find("#filter-annual-status").on("change", function () {
			self.currentFilters.annual_status = $(this).val();
			self.clear_kpi_active();
			self.refresh();
		});

		// 搜索防抖
		let searchTimer = null;
		this.wrapper.find("#filter-search").on("input", function () {
			clearTimeout(searchTimer);
			const val = $(this).val();
			searchTimer = setTimeout(() => {
				self.currentFilters.search_text = val;
				self.refresh();
			}, 300);
		});

		// 重置筛选
		this.wrapper.find("#btn-reset-filters").on("click", () => {
			self.reset_filters();
		});

		// KPI 卡片点击一键筛选
		this.wrapper.find(".sec-kpi-card").on("click", function () {
			const kpiType = $(this).attr("data-kpi");
			self.apply_kpi_filter(kpiType, $(this));
		});
	}

	clear_kpi_active() {
		this.wrapper.find(".sec-kpi-card").removeClass("active");
		this.activeKpiCard = null;
	}

	apply_kpi_filter(kpiType, $card) {
		this.wrapper.find(".sec-kpi-card").removeClass("active");
		$card.addClass("active");
		this.activeKpiCard = kpiType;

		// 默认保持在用
		this.wrapper.find("#filter-status").val("在用");
		this.currentFilters.equipment_status = "在用";

		if (kpiType === "all") {
			this.wrapper.find("#filter-insp-status").val("全部");
			this.wrapper.find("#filter-annual-status").val("全部");
			this.currentFilters.inspection_status = "全部";
			this.currentFilters.annual_status = "全部";
		} else if (kpiType === "insp_expiring_60") {
			this.wrapper.find("#filter-insp-status").val("即将到期");
			this.wrapper.find("#filter-annual-status").val("全部");
			this.currentFilters.inspection_status = "即将到期";
			this.currentFilters.annual_status = "全部";
		} else if (kpiType === "annual_expiring_60") {
			this.wrapper.find("#filter-insp-status").val("全部");
			this.wrapper.find("#filter-annual-status").val("即将到期");
			this.currentFilters.inspection_status = "全部";
			this.currentFilters.annual_status = "即将到期";
		} else if (kpiType === "insp_overdue") {
			this.wrapper.find("#filter-insp-status").val("已逾期");
			this.wrapper.find("#filter-annual-status").val("全部");
			this.currentFilters.inspection_status = "已逾期";
			this.currentFilters.annual_status = "全部";
		} else if (kpiType === "annual_overdue") {
			this.wrapper.find("#filter-insp-status").val("全部");
			this.wrapper.find("#filter-annual-status").val("已逾期");
			this.currentFilters.inspection_status = "全部";
			this.currentFilters.annual_status = "已逾期";
		}

		this.refresh();
	}

	reset_filters() {
		this.currentFilters = {
			company: "",
			category: "",
			equipment_status: "在用",
			inspection_status: "全部",
			annual_status: "全部",
			search_text: "",
		};

		this.wrapper.find("#filter-company").val("");
		this.wrapper.find("#filter-category").val("");
		this.wrapper.find("#filter-status").val("在用");
		this.wrapper.find("#filter-insp-status").val("全部");
		this.wrapper.find("#filter-annual-status").val("全部");
		this.wrapper.find("#filter-search").val("");
		this.clear_kpi_active();
		this.refresh();
	}

	refresh() {
		const self = this;
		frappe.call({
			method: "ashan_cn_procurement.ashan_cn_procurement.page.special_equipment_center.special_equipment_center.get_dashboard_data",
			args: self.currentFilters,
			callback: function (r) {
				if (r.message) {
					self.render_dashboard(r.message);
				}
			},
		});
	}

	render_dashboard(data) {
		this.update_kpis(data.kpis);
		this.populate_dropdowns(data.companies, data.categories);
		this.render_table(data.equipments);
	}

	update_kpis(kpis) {
		this.wrapper.find("#kpi-total").text(kpis.total_count || 0);
		this.wrapper.find("#kpi-active").text(kpis.active_count || 0);
		this.wrapper.find("#kpi-insp-expiring").text(kpis.insp_expiring_60 || 0);
		this.wrapper.find("#kpi-annual-expiring").text(kpis.annual_expiring_60 || 0);
		this.wrapper.find("#kpi-insp-overdue").text(kpis.insp_overdue || 0);
		this.wrapper.find("#kpi-annual-overdue").text(kpis.annual_overdue || 0);
	}

	populate_dropdowns(companies, categories) {
		const $companySelect = this.wrapper.find("#filter-company");
		if ($companySelect.children().length <= 1 && companies) {
			companies.forEach((c) => {
				$companySelect.append(`<option value="${c.name}">${c.company_name || c.name}</option>`);
			});
			if (this.currentFilters.company) {
				$companySelect.val(this.currentFilters.company);
			}
		}

		const $catSelect = this.wrapper.find("#filter-category");
		if ($catSelect.children().length <= 1 && categories) {
			categories.forEach((cat) => {
				$catSelect.append(`<option value="${cat}">${cat}</option>`);
			});
			if (this.currentFilters.category) {
				$catSelect.val(this.currentFilters.category);
			}
		}
	}

	get_badge(status) {
		let cls = "badge-gray";
		if (status === "正常") cls = "badge-green";
		else if (status === "注意") cls = "badge-yellow";
		else if (status === "即将到期") cls = "badge-orange";
		else if (status === "今日到期" || status === "已逾期") cls = "badge-red";
		return `<span class="sec-badge ${cls}">${status || "—"}</span>`;
	}

	render_table(equipments) {
		const self = this;
		const $container = this.wrapper.find("#equipment-table-container");


		if (!equipments || equipments.length === 0) {
			$container.html(`
			<div class="sec-empty-state">
				<div class="sec-empty-icon">🚗</div>
				<div class="sec-empty-title">暂无匹配的特种设备档案</div>
				<div class="sec-empty-desc">建立特种设备台账后，系统将自动跟踪法定检验和年度检查到期时间并进行多级预警。</div>
				<button class="sec-btn sec-btn-primary btn-empty-create">➕ 新增特种设备</button>
			</div>
			`);

			$container.find(".btn-empty-create").on("click", () => {
				this.open_quick_create_dialog();
			});
			return;
		}

		let rowsHtml = "";
		equipments.forEach((e) => {
			const plate = e.plate_number ? `<b>${e.plate_number}</b>` : `<span style="color:#a0aec0;">未上牌</span>`;
			const internal = e.internal_number ? `<span style="font-weight:600; color:#2b6cb0;">${e.internal_number}</span>` : "—";
			const eqName = `<div><b>${e.equipment_name || ""}</b></div><div style="font-size:11px; color:#718096;">${e.equipment_category || ""}${e.equipment_variety ? ' / ' + e.equipment_variety : ''}</div>`;
			const regCode = e.registration_code ? `<div style="font-family:monospace; font-size:12px;">${e.registration_code}</div>` : `<div style="color:#a0aec0;">未填</div>`;
			
			// 法定检验列
			const inspDays = e.inspection_days_remaining !== null && e.inspection_days_remaining !== undefined
				? (e.inspection_days_remaining < 0
					? `<span style="color:#e53e3e; font-weight:bold;">已逾期 ${Math.abs(e.inspection_days_remaining)}天</span>`
					: `<span>剩余 <b>${e.inspection_days_remaining}</b>天</span>`)
				: "—";

			const inspCell = `
				<div>${this.get_badge(e.inspection_status)} ${inspDays}</div>
				<div style="font-size:11px; color:#718096; margin-top:2px;">到期: ${e.inspection_display_due}</div>
			`;

			// 年度检查列
			const annualDays = e.annual_days_remaining !== null && e.annual_days_remaining !== undefined
				? (e.annual_days_remaining < 0
					? `<span style="color:#e53e3e; font-weight:bold;">已逾期 ${Math.abs(e.annual_days_remaining)}天</span>`
					: `<span>剩余 <b>${e.annual_days_remaining}</b>天</span>`)
				: "—";

			const annualCell = `
				<div>${this.get_badge(e.annual_check_status)} ${annualDays}</div>
				<div style="font-size:11px; color:#718096; margin-top:2px;">下次: ${e.annual_display_due}</div>
			`;

			// 报告链接
			let reportLink = "";
			if (e.latest_inspection_attachment) {
				reportLink = `<a href="${e.latest_inspection_attachment}" target="_blank" class="sec-btn" style="padding:3px 6px; font-size:11px;" title="查看检验报告">📄 报告</a>`;
			}

			rowsHtml += `
			<tr data-name="${e.name}">
				<td><span class="sec-badge ${e.equipment_status === '在用' ? 'badge-green' : 'badge-gray'}">${e.equipment_status}</span></td>
				<td><a class="sec-link-bold link-equipment-detail" data-name="${e.name}">${plate}</a></td>
				<td>${internal}</td>
				<td>${eqName}</td>
				<td>${regCode}</td>
				<td>${inspCell}</td>
				<td>${annualCell}</td>
				<td><div style="font-size:12px; color:#2d3748;">${e.use_location || "—"}</div></td>
				<td style="white-space:nowrap;">
					<button class="sec-btn btn-table-detail" data-name="${e.name}" style="padding:3px 8px; font-size:11px;">详情</button>
					<button class="sec-btn btn-table-add-insp" data-name="${e.name}" data-label="${e.plate_number || e.internal_number || e.equipment_name}" style="padding:3px 8px; font-size:11px; color:#2b6cb0; font-weight:bold;">➕ 检验</button>
					<button class="sec-btn btn-table-add-annual" data-name="${e.name}" data-label="${e.plate_number || e.internal_number || e.equipment_name}" style="padding:3px 8px; font-size:11px; color:#2c7a7b; font-weight:bold;">➕ 年检</button>
					${reportLink}
				</td>
			</tr>
			`;
		});

		const tableHtml = `
		<table class="sec-table">
			<thead>
				<tr>
					<th>状态</th>
					<th>车牌编号</th>
					<th>单位内编号</th>
					<th>设备名称及类别</th>
					<th>注册代码</th>
					<th>🛡️ 法定检验</th>
					<th>📋 年度检查</th>
					<th>使用地点</th>
					<th>操作</th>
				</tr>
			</thead>
			<tbody>
				${rowsHtml}
			</tbody>
		</table>
		`;

		$container.html(tableHtml);

		// 绑定表格操作按钮
		$container.find(".link-equipment-detail, .btn-table-detail").on("click", function () {
			const name = $(this).attr("data-name");
			frappe.set_route("Form", "Special Equipment", name);
		});

		$container.find(".btn-table-add-insp").on("click", function () {
			const name = $(this).attr("data-name");
			const label = $(this).attr("data-label");
			self.open_add_inspection_dialog(name, label);
		});

		$container.find(".btn-table-add-annual").on("click", function () {
			const name = $(this).attr("data-name");
			const label = $(this).attr("data-label");
			self.open_add_annual_inspection_dialog(name, label);
		});
	}

	open_add_inspection_dialog(equipmentName, equipmentLabel) {
		const self = this;
		const todayStr = frappe.datetime.get_today();
		const defaultDue = frappe.datetime.add_months(todayStr, 24);

		const d = new frappe.ui.Dialog({
			title: __("🛡️ 录入法定检验") + (equipmentLabel ? " · " + equipmentLabel : ""),
			fields: [
				{
					label: __("本次检验日期"),
					fieldname: "inspection_date",
					fieldtype: "Date",
					default: todayStr,
					reqd: 1,
					onchange: function () {
						const v = d.get_value("inspection_date");
						if (v) {
							d.set_value("valid_until", frappe.datetime.add_months(v, 24));
						}
					},
				},
				{
					fieldtype: "Column Break",
				},
				{
					label: __("下次检验到期日 (默认+2年)"),
					fieldname: "valid_until",
					fieldtype: "Date",
					default: defaultDue,
					reqd: 1,
					description: "输入本次检验日期后自动推算2年，也可根据报告手动修改",
				},
				{
					fieldtype: "Section Break",
				},
				{
					label: __("检验报告编号"),
					fieldname: "inspection_report_no",
					fieldtype: "Data",
					placeholder: "如：TJ-2026-XXXXX (选填)",
				},
				{
					fieldtype: "Column Break",
				},
				{
					label: __("检验类别"),
					fieldname: "inspection_type",
					fieldtype: "Select",
					options: ["定期检验", "首次检验", "监督检验", "其他"],
					default: "定期检验",
				},
				{
					fieldtype: "Section Break",
				},
				{
					label: __("检验机构"),
					fieldname: "inspection_agency",
					fieldtype: "Data",
					placeholder: "如：天津市特种设备监督检验技术研究院 (选填)",
				},
				{
					fieldtype: "Column Break",
				},
				{
					label: __("检验报告附件 (PDF/图片)"),
					fieldname: "inspection_report_attachment",
					fieldtype: "Attach",
				},
			],
			primary_action_label: __("💾 保存检验记录"),
			primary_action(values) {
				values.special_equipment = equipmentName;
				frappe.call({
					method: "ashan_cn_procurement.ashan_cn_procurement.page.special_equipment_center.special_equipment_center.quick_add_inspection",
					args: values,
					callback: function (r) {
						if (r.message && r.message.status === "ok") {
							frappe.show_alert({ message: r.message.message, indicator: "green" }, 3);
							d.hide();
							self.refresh();
						}
					},
				});
			},
		});

		d.show();
	}

	open_add_annual_inspection_dialog(equipmentName, equipmentLabel) {
		const self = this;
		const todayStr = frappe.datetime.get_today();
		const defaultDue = frappe.datetime.add_months(todayStr, 12);

		const d = new frappe.ui.Dialog({
			title: __("📋 录入年度检查") + (equipmentLabel ? " · " + equipmentLabel : ""),
			fields: [
				{
					label: __("本次检查日期"),
					fieldname: "check_date",
					fieldtype: "Date",
					default: todayStr,
					reqd: 1,
					onchange: function () {
						const v = d.get_value("check_date");
						if (v) {
							d.set_value("next_check_date", frappe.datetime.add_months(v, 12));
						}
					},
				},
				{
					fieldtype: "Column Break",
				},
				{
					label: __("下次检查日期 (默认+1年)"),
					fieldname: "next_check_date",
					fieldtype: "Date",
					default: defaultDue,
					reqd: 1,
					description: "输入检查日期后自动推算1年，可手动修改",
				},
				{
					fieldtype: "Section Break",
				},
				{
					label: __("检查结论"),
					fieldname: "check_result",
					fieldtype: "Select",
					options: ["合格", "存在问题", "整改中", "整改完成"],
					default: "合格",
				},
				{
					fieldtype: "Column Break",
				},
				{
					label: __("年度检查表附件 (PDF/图片)"),
					fieldname: "annual_check_attachment",
					fieldtype: "Attach",
				},
				{
					fieldtype: "Section Break",
				},
				{
					label: __("发现问题与备注说明"),
					fieldname: "remarks",
					fieldtype: "Small Text",
					placeholder: "如检查中发现的问题或整改情况说明 (选填)",
				},
			],
			primary_action_label: __("💾 保存年检记录"),
			primary_action(values) {
				values.special_equipment = equipmentName;
				frappe.call({
					method: "ashan_cn_procurement.ashan_cn_procurement.page.special_equipment_center.special_equipment_center.quick_add_annual_inspection",
					args: values,
					callback: function (r) {
						if (r.message && r.message.status === "ok") {
							frappe.show_alert({ message: r.message.message, indicator: "green" }, 3);
							d.hide();
							self.refresh();
						}
					},
				});
			},
		});

		d.show();
	}


	open_quick_create_dialog() {
		const self = this;
		const defaultCompany = this.currentFilters.company || frappe.defaults.get_user_default("Company");

		const d = new frappe.ui.Dialog({
			title: __("🚗 建立特种设备档案"),
			fields: [
				{
					label: __("所属公司"),
					fieldname: "company",
					fieldtype: "Link",
					options: "Company",
					default: defaultCompany,
					reqd: 1,
				},
				{
					label: __("设备名称"),
					fieldname: "equipment_name",
					fieldtype: "Data",
					placeholder: "例如：托盘堆垛车、平衡重式叉车",
					reqd: 1,
				},
				{
					fieldtype: "Column Break",
				},
				{
					label: __("设备类别"),
					fieldname: "equipment_category",
					fieldtype: "Select",
					options: [
						"场（厂）内专用机动车辆",
						"起重机械",
						"压力容器",
						"锅炉",
						"压力管道",
						"电梯",
						"其他",
					],
					default: "场（厂）内专用机动车辆",
					reqd: 1,
				},
				{
					label: __("设备品种"),
					fieldname: "equipment_variety",
					fieldtype: "Data",
					placeholder: "例如：叉车",
				},
				{
					fieldtype: "Section Break",
					label: __("身份与车牌编号"),
				},
				{
					label: __("车牌编号"),
					fieldname: "plate_number",
					fieldtype: "Data",
					placeholder: "如：场内津B·08539（场内车辆重点填写）",
				},
				{
					label: __("单位内编号"),
					fieldname: "internal_number",
					fieldtype: "Data",
					placeholder: "如：D002",
				},
				{
					fieldtype: "Column Break",
				},
				{
					label: __("注册代码"),
					fieldname: "registration_code",
					fieldtype: "Data",
					placeholder: "特种设备注册代码",
				},
				{
					label: __("设备代码"),
					fieldname: "equipment_code",
					fieldtype: "Data",
					placeholder: "设备代码编号",
				},
				{
					fieldtype: "Section Break",
					label: __("使用地点"),
				},
				{
					label: __("使用地点"),
					fieldname: "use_location",
					fieldtype: "Data",
					placeholder: "例如：一号车间成品库 (手动输入)",
				},
			],
			primary_action_label: __("💾 立即创建设备"),
			primary_action(values) {
				frappe.call({
					method: "ashan_cn_procurement.ashan_cn_procurement.page.special_equipment_center.special_equipment_center.quick_create_equipment",
					args: values,
					callback: function (r) {
						if (r.message && r.message.status === "ok") {
							frappe.show_alert({ message: r.message.message, indicator: "green" }, 3);
							d.hide();
							self.refresh();
						}
					},
				});
			},
		});

		d.show();
	}
}

