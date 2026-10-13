// ASHAN-COMPLETE: shared formatting and unified operational UI
// Copyright (c) 2026, Ashan CN Procurement and contributors
// For license information, please see license.txt

// Compatibility adapter: shared display formatting lives in AshanUI.
function formatMoney(val) {
	return window.AshanUI?.formatMoney
		? window.AshanUI.formatMoney(val)
		: frappe.format(Number(val || 0), { fieldtype: "Currency" });
}

frappe.pages["oil-card-ledger"].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("油卡综合台账"),
		single_column: true,
	});

	wrapper.oil_card_console = new UnifiedOilCardLedgerConsole(page);
};

frappe.pages["oil-card-ledger"].on_page_show = function (wrapper) {
	if (wrapper.oil_card_console && typeof wrapper.oil_card_console.loadLedger === "function") {
		wrapper.oil_card_console.loadLedger();
	}
};

class UnifiedOilCardLedgerConsole {
	constructor(page) {
		this.page = page;
		this.wrapper = $(page.body);
		this.cards = [];
		this.activeCard = null;
		this.meta = { vehicles: [], modes_of_payment: [] };

		const now = new Date();
		this.selectedYear = now.getFullYear();
		this.selectedMonth = now.getMonth() + 1; // 1 - 12
		this.isManager = false;
		this.isLocked = false;
		this.currentEndingBalance = 0;

		this.initLayout();
		this.bindEvents();
		this.loadMeta();
		this.loadCards();
	}

	initLayout() {
		this.wrapper.html(`
			<div class="oil-console-layout">
				<!-- 左侧油卡选择侧边栏 -->
				<div class="oil-cards-sidebar">
					<div class="sidebar-header">
						<span class="sidebar-title">油卡列表</span>
						<button class="btn-add-card hide" id="btn-create-card">新增</button>
					</div>
					<div class="card-search-box">
						<input type="text" class="card-search-input" id="card-search-input" placeholder="搜索卡号、车牌、保管人...">
					</div>
					<div class="cards-list-container" id="cards-list-container">
						<div class="empty-placeholder">
							<div>加载中...</div>
						</div>
					</div>
				</div>

				<!-- 右侧综合台账控制大屏 -->
				<div class="oil-console-main" id="console-main-pane">
					<div class="empty-placeholder" id="main-empty-placeholder" class="empty-placeholder empty-placeholder-lg">
						<div class="empty-title">请从左侧选择一张油卡查看流水台账</div>
						<div class="empty-hint hide" id="empty-add-card-hint">或点击左侧“新增”录入您的第一张企业油卡</div>
					</div>

					<div id="main-content-pane" class="main-content-flow hide">
						
						<!-- 锁定警示条 (仅在锁定月份展示) -->
						<div class="locked-alert-banner" id="locked-banner" class="hide">
							<span><b>本月度已核定锁定</b>：该月份单据处于保护状态，禁止新增、修改或删除记录。</span>
							<span id="locked-meta-info" class="locked-banner-meta"></span>
						</div>

						<!-- Zone 1: 4 大财务指标看板 (汇总区，无多余说教) -->
						<div class="kpi-cards-grid">
							<!-- 1. 期初结存 -->
							<div class="kpi-card kpi-blue">
								<div class="kpi-card-top">
									<span class="kpi-card-label">期初结存</span>
								</div>
								<div class="kpi-card-value font-mono" id="kpi-opening-bal">¥ 0.00</div>
							</div>

							<!-- 2. 本期充值 -->
							<div class="kpi-card kpi-emerald">
								<div class="kpi-card-top">
									<span class="kpi-card-label">本期充值</span>
								</div>
								<div class="kpi-card-value font-mono text-emerald" id="kpi-recharge-total">¥ 0.00</div>
							</div>

							<!-- 3. 本期加油 -->
							<div class="kpi-card kpi-amber">
								<div class="kpi-card-top">
									<span class="kpi-card-label">本期加油</span>
								</div>
								<div class="kpi-card-value font-mono text-amber" id="kpi-refuel-total">¥ 0.00</div>
							</div>

							<!-- 4. 期末结余 -->
							<div class="kpi-card kpi-purple">
								<div class="kpi-card-top">
									<span class="kpi-card-label">期末结余</span>
								</div>
								<div class="kpi-card-value font-mono font-bold" id="kpi-ending-bal">¥ 0.00</div>
							</div>
						</div>

						<!-- Zone 2: 中间控制中枢工具栏 (左侧分类Tab + 右侧操作按钮) -->
						<div class="middle-command-strip">
							<!-- 左侧：流水分段筛选 Tab -->
							<div class="filter-tabs-cluster">
								<span class="filter-tab is-active" data-filter="all">全部流水 <span class="tab-count" id="tab-count-all">(0)</span></span>
								<span class="filter-tab" data-filter="recharge">充值记录 <span class="tab-count" id="tab-count-recharge">(0)</span></span>
								<span class="filter-tab" data-filter="refuel">加油明细 <span class="tab-count" id="tab-count-refuel">(0)</span></span>
							</div>

							<!-- 右侧：[月度封账] [充值] [加油] -->
							<div class="actions-cluster">
								<div id="lock-action-container" class="lock-action-wrap"></div>
								<button class="btn-cmd-secondary" id="btn-quick-recharge" title="录入充值">充值</button>
								<button class="btn-cmd-primary" id="btn-quick-refuel" title="录入加油">加油</button>
							</div>
						</div>

						<!-- Zone 3: 单一合流流水总账表格 (纯中文8列，带独立升数与油号) -->
						<div class="oil-data-table-wrapper">
							<table class="oil-data-table" id="table-unified-ledger">
								<thead>
									<tr id="thead-row">
										<th class="th-date">发生日期</th>
										<th class="th-type">业务类型</th>
										<th class="th-vehicle">车牌</th>
										<th class="th-amt text-right">充值金额</th>
										<th class="th-amt text-right">加油金额</th>
										<th class="th-liters text-right">加油升数</th>
										<th class="th-grade text-center">加油油号</th>
										<th class="col-balance th-bal text-right">结余金额</th>
									</tr>
								</thead>
								<tbody id="tbody-unified-ledger">
									<!-- 动态渲染首行结转、流水与新增行 -->
								</tbody>
								<tfoot id="tfoot-unified-ledger">
									<!-- 动态列对齐合计行 -->
								</tfoot>
							</table>
						</div>

					</div>
				</div>
			</div>
		`);

		this.setupPeriodSelector();
	}

	setupPeriodSelector() {
		try {
			const self = this;
			if (window.AshanUI && typeof window.AshanUI.renderPeriodSelector === "function") {
				const $actionContainer = $(this.page.page_actions || this.page.main.find(".page-actions"));
				if ($actionContainer.length) {
					$actionContainer.empty();
					this.periodSelector = window.AshanUI.renderPeriodSelector($actionContainer, {
						currentYear: this.selectedYear,
						currentMonth: this.selectedMonth,
						onChange: function (y, m) {
							self.selectedYear = y;
							self.selectedMonth = m;
							self.loadLedgerData();
						},
					});
				}
			}
		} catch (e) {
			console.warn("setupPeriodSelector init fallback:", e);
		}
	}

	loadMeta() {
		const self = this;
		frappe.call({
			method: "ashan_cn_procurement.ashan_cn_procurement.page.oil_card_ledger.oil_card_ledger.get_quick_entry_meta",
			callback: function (r) {
				if (r.message) {
					self.meta = r.message;
					if (r.message.is_manager !== undefined) {
						self.isManager = Boolean(r.message.is_manager);
						if (self.isManager) {
							self.wrapper.find("#btn-create-card").removeClass("hide").show();
							self.wrapper.find("#empty-add-card-hint").removeClass("hide").show();
						} else {
							self.wrapper.find("#btn-create-card").hide();
							self.wrapper.find("#empty-add-card-hint").hide();
						}
						self.renderCardsList();
					}
				}
			},
		});
	}

	initFilterDropdowns() {
		const selYear = this.wrapper.find("#sel-year");
		const selMonth = this.wrapper.find("#sel-month");

		const currentYear = new Date().getFullYear();
		selYear.empty();
		for (let y = currentYear + 1; y >= currentYear - 3; y--) {
			selYear.append(`<option value="${y}" ${y === this.selectedYear ? "selected" : ""}>${y} 年</option>`);
		}

		selMonth.empty();
		for (let m = 1; m <= 12; m++) {
			selMonth.append(`<option value="${m}" ${m === this.selectedMonth ? "selected" : ""}>${m} 月</option>`);
		}
	}

	bindEvents() {
		const self = this;

		// 搜索油卡
		this.wrapper.on("input", "#card-search-input", function () {
			const q = $(this).val().trim().toLowerCase();
			self.filterCardsList(q);
		});

		// 切换油卡
		this.wrapper.on("click", ".oil-card-item", function () {
			const cardName = String($(this).attr("data-name"));
			self.selectCard(cardName);
		});

		// 新建油卡 (单页弹窗，零跳转)
		this.wrapper.on("click", "#btn-create-card", function () {
			self.openCreateOilCardDialog();
		});

		// 删除油卡档案 (单页确认，零跳转)
		this.wrapper.on("click", ".btn-delete-card", function (e) {
			e.stopPropagation();
			const cardId = String($(this).attr("data-name"));
			const cardTitle = String($(this).attr("data-title") || cardId);
			frappe.confirm(
				`确定要彻底删除油卡【<b>${cardTitle}</b>】吗？<br><br><span class="text-danger">警告：该操作将删除该油卡档案，请确认该卡无未结清账目。</span>`,
				function () {
					frappe.call({
						method: "ashan_cn_procurement.ashan_cn_procurement.page.oil_card_ledger.oil_card_ledger.delete_oil_card",
						args: { oil_card: cardId },
						callback: function (r) {
							if (r.message && r.message.status === "ok") {
								frappe.show_alert({ message: r.message.message, indicator: "green" }, 3);
								if (self.activeCard && String(self.activeCard.name) === cardId) {
									self.activeCard = null;
								}
								self.loadCards();
							}
						},
					});
				}
			);
		});

		// 年月变更
		this.wrapper.on("change", "#sel-year", function () {
			self.selectedYear = parseInt($(this).val());
			self.loadLedgerData();
		});

		this.wrapper.on("change", "#sel-month", function () {
			self.selectedMonth = parseInt($(this).val());
			self.loadLedgerData();
		});

		// 快捷时间切换：上一月
		this.wrapper.on("click", "#btn-prev-month", function () {
			if (self.selectedMonth === 1) {
				self.selectedMonth = 12;
				self.selectedYear -= 1;
			} else {
				self.selectedMonth -= 1;
			}
			self.syncDropdowns();
			self.loadLedgerData();
		});

		// 快捷时间切换：下一月
		this.wrapper.on("click", "#btn-next-month", function () {
			if (self.selectedMonth === 12) {
				self.selectedMonth = 1;
				self.selectedYear += 1;
			} else {
				self.selectedMonth += 1;
			}
			self.syncDropdowns();
			self.loadLedgerData();
		});

		// 快捷时间切换：回到当月
		this.wrapper.on("click", "#btn-this-month", function () {
			const now = new Date();
			self.selectedYear = now.getFullYear();
			self.selectedMonth = now.getMonth() + 1;
			self.syncDropdowns();
			self.loadLedgerData();
		});

		// 刷新按钮
		this.wrapper.on("click", "#btn-refresh-data", function () {
			self.loadLedgerData();
			frappe.show_alert({ message: "流水总账已刷新", indicator: "green" }, 2);
		});

		// 触发【行内快速录入加油】
		this.wrapper.on("click", "#btn-quick-refuel, #btn-empty-quick-refuel", function () {
			if (!self.activeCard) return;
			if (self.isLocked) {
				if (self.isManager) {
					frappe.msgprint("<b>当前月份已核定锁定！</b><br><br>您拥有管理员权限，若确需补录加油单据，请先点击右上角的【解除锁定】。");
				} else {
					frappe.msgprint(" <b>当前月份已核定锁定！</b><br><br>单据处于只读保护状态。若需修改或补录，请点击右上角的【申请取消核定】。");
				}
				return;
			}
			self.startInlineEntry("refuel");
		});

		// 触发【行内快速录入充值】
		this.wrapper.on("click", "#btn-quick-recharge, #btn-empty-quick-recharge", function () {
			if (!self.activeCard) return;
			if (self.isLocked) {
				if (self.isManager) {
					frappe.msgprint("<b>当前月份已核定锁定。</b><br><br>如确需补录充值，请先使用右上角的【解除锁定】操作。");
				} else {
					frappe.msgprint("<b>当前月份已核定锁定。</b><br><br>单据处于只读保护状态。如需修改或补录，请使用右上角的【申请取消核定】。");
				}
				return;
			}
			self.startInlineEntry("recharge");
		});

		// 取消行内录入
		this.wrapper.on("click", "#btn-inline-cancel", function () {
			$("#row-inline-entry").remove();
		});

		// 保存行内加油记录
		this.wrapper.on("click", "#btn-inline-save-refuel", function () {
			self.saveInlineRefuel();
		});

		// 保存行内充值记录
		this.wrapper.on("click", "#btn-inline-save-recharge", function () {
			self.saveInlineRecharge();
		});

		// 行内输入计算联动
		this.wrapper.on("input", "#inline-refuel-amount, #inline-refuel-liters, #inline-refuel-odo", function () {
			self.updateInlineRefuelCalculations();
		});

		this.wrapper.on("input", "#inline-recharge-amount, #inline-recharge-bonus", function () {
			self.updateInlineRechargeCalculations();
		});

		// 车辆智能搜索与下拉选项交互
		$(document).off("mousedown.vehDropdown click.vehDropdown focus.vehDropdown input.vehDropdown", "#inline-refuel-vehicle-input")
			.on("mousedown.vehDropdown click.vehDropdown focus.vehDropdown input.vehDropdown", "#inline-refuel-vehicle-input", function (e) {
				e.stopPropagation();
				if (e.type === "focus") {
					$(this).select();
				}
				const q = $(this).val();
				self.renderVehicleDropdown(q);
				$("#grade-autocomplete-dropdown").hide();
			});

		$(document).off("click.vehItem", ".vehicle-dropdown-item")
			.on("click.vehItem", ".vehicle-dropdown-item", function (e) {
				e.stopPropagation();
				const vehName = $(this).data("name");
				const veh = self.meta.vehicles.find((v) => String(v.name) === String(vehName));
				if (veh) {
					self.applyVehicleToInlineEntry(veh);
				}
			});

		$(document).off("click.vehQuickAdd", "#btn-quick-add-vehicle-from-dropdown")
			.on("click.vehQuickAdd", "#btn-quick-add-vehicle-from-dropdown", function (e) {
				e.stopPropagation();
				$("#vehicle-autocomplete-dropdown").hide();
				const currentText = $("#inline-refuel-vehicle-input").val();
				self.openCreateVehicleDialog(currentText);
			});

		// 油标智能搜索与下拉选项交互
		$(document).off("mousedown.gradeDropdown click.gradeDropdown focus.gradeDropdown input.gradeDropdown", "#inline-refuel-grade-input")
			.on("mousedown.gradeDropdown click.gradeDropdown focus.gradeDropdown input.gradeDropdown", "#inline-refuel-grade-input", function (e) {
				e.stopPropagation();
				if (e.type === "focus") {
					$(this).select();
				}
				const q = $(this).val();
				self.renderGradeDropdown(q);
				$("#vehicle-autocomplete-dropdown").hide();
			});

		$(document).off("click.gradeItem", ".grade-dropdown-item")
			.on("click.gradeItem", ".grade-dropdown-item", function (e) {
				e.stopPropagation();
				const val = $(this).data("val");
				const label = $(this).data("label");
				self.applyGradeToInlineEntry({ val, label });
			});

		// 点击其他区域关闭下拉
		$(document).off("click.comboboxDropdown").on("click.comboboxDropdown", function (e) {
			if (!$(e.target).closest(".vehicle-combobox-wrapper, #vehicle-autocomplete-dropdown").length) {
				$("#vehicle-autocomplete-dropdown").hide();
			}
			if (!$(e.target).closest(".grade-combobox-wrapper, #grade-autocomplete-dropdown").length) {
				$("#grade-autocomplete-dropdown").hide();
			}
		});

		// 车辆输入框回车：模糊匹配车牌（如9527自动匹配津AF9527）
		this.wrapper.on("keydown", "#inline-refuel-vehicle-input", function (e) {
			if (e.which === 13) {
				e.preventDefault();
				e.stopPropagation();
				const text = $(this).val().trim();
				const match = self.fuzzyMatchVehicle(text);
				if (match) {
					self.applyVehicleToInlineEntry(match);
				} else if (text) {
					$("#vehicle-autocomplete-dropdown").hide();
					self.openCreateVehicleDialog(text);
				}
			}
		});

		// 油号输入框回车：模糊匹配油号（如92自动匹配92# 汽油）
		this.wrapper.on("keydown", "#inline-refuel-grade-input", function (e) {
			if (e.which === 13) {
				e.preventDefault();
				e.stopPropagation();
				const text = $(this).val().trim();
				const match = self.fuzzyMatchGrade(text);
				if (match) {
					self.applyGradeToInlineEntry(match);
				} else {
					$("#grade-autocomplete-dropdown").hide();
					$("#inline-refuel-odo").focus();
				}
			}
		});

		// 其它行内输入框回车保存，ESC取消
		this.wrapper.on("keydown", ".row-inline-entry input:not(#inline-refuel-vehicle-input):not(#inline-refuel-grade-input)", function (e) {
			if (e.which === 13) {
				const isRefuel = $("#btn-inline-save-refuel").length > 0;
				if (isRefuel) self.saveInlineRefuel();
				else self.saveInlineRecharge();
			} else if (e.which === 27) {
				$("#row-inline-entry").remove();
			}
		});

		// 本月核定锁定 (操作员与管理员均可执行)
		this.wrapper.on("click", "#btn-lock-month-action, #btn-empty-lock-month", function () {
			if (!self.activeCard) return;
			const cardTitle = self.activeCard.card_name || self.activeCard.name;
			const endingBal = formatMoney(self.currentEndingBalance);
			const txnsCount = self.wrapper.find("#tbody-unified-ledger tr:not(.row-opening-balance):not(.row-empty-month):not(.row-inline-entry)").length;

			let confirmMsg = "";
			if (txnsCount === 0) {
				confirmMsg = `
					<div class="unlock-dialog-content">
						确定要对【${cardTitle}】的 <b>${self.selectedYear}年${self.selectedMonth}月</b> 进行<b>【月度核定与锁定】</b>吗？<br><br>
						<div class="unlock-dialog-success">
							 <b>空月结转核定</b>：本月无资金与能耗变动，期末余额将精准核定为 <b>${endingBal}</b> 并自动结转至下月。
						</div>
					</div>
				`;
			} else {
				confirmMsg = `
					<div class="unlock-dialog-content">
						确定要对【${cardTitle}】的 <b>${self.selectedYear}年${self.selectedMonth}月</b> 进行<b>【本月核定与锁定】</b>吗？<br><br>
						<div class="unlock-dialog-warn">
							<b>本月汇总</b>：共 <b>${txnsCount}</b> 笔流水，期末核定余额为 <b>${endingBal}</b>。<br>
							 <b>安全保护</b>：核定后本月所有单据将被锁定为只读状态，防止误改。
						</div>
					</div>
				`;
			}

			frappe.confirm(confirmMsg, function () {
				frappe.call({
					method: "ashan_cn_procurement.ashan_cn_procurement.page.oil_card_ledger.oil_card_ledger.lock_monthly_ledger",
					args: {
						oil_card: self.activeCard.name,
						year: self.selectedYear,
						month: self.selectedMonth,
					},
					callback: function (r) {
						if (r.message && r.message.status === "ok") {
							frappe.show_alert({ message: r.message.message, indicator: "green" }, 4);
							self.loadLedgerData();
						}
					},
				});
			});
		});

		// 操作员申请取消核定
		this.wrapper.on("click", "#btn-request-unlock-action", function () {
			if (!self.activeCard) return;
			const d = new frappe.ui.Dialog({
				title: __(" 申请取消当月核定"),
				fields: [
					{
						label: __("申请原因 / 需修改内容"),
						fieldname: "reason",
						fieldtype: "Small Text",
						reqd: 1,
						placeholder: "请详细说明申请解除锁定的原因（例如：某日加油记录表显里程输入有误，需更正）...",
					},
				],
				primary_action_label: __("提交申请"),
				primary_action(values) {
					frappe.call({
						method: "ashan_cn_procurement.ashan_cn_procurement.page.oil_card_ledger.oil_card_ledger.request_unlock_monthly_ledger",
						args: {
							oil_card: self.activeCard.name,
							year: self.selectedYear,
							month: self.selectedMonth,
							reason: values.reason,
						},
						callback: function (r) {
							if (r.message && r.message.status === "ok") {
								frappe.show_alert({ message: r.message.message, indicator: "orange" }, 4);
								d.hide();
								self.loadLedgerData();
							}
						},
					});
				},
			});
			d.show();
		});

		// 管理员直接解锁
		this.wrapper.on("click", "#btn-unlock-month-action", function () {
			if (!self.activeCard) return;
			frappe.confirm(
				`确定要直接解除【${self.activeCard.card_name}】 <b>${self.selectedYear}年${self.selectedMonth}月</b> 的锁定状态吗？`,
				function () {
					frappe.call({
						method: "ashan_cn_procurement.ashan_cn_procurement.page.oil_card_ledger.oil_card_ledger.unlock_monthly_ledger",
						args: {
							oil_card: self.activeCard.name,
							year: self.selectedYear,
							month: self.selectedMonth,
						},
						callback: function (r) {
							if (r.message && r.message.status === "ok") {
								frappe.show_alert({ message: r.message.message, indicator: "orange" }, 4);
								self.loadLedgerData();
							}
						},
					});
				}
			);
		});

		// 管理员批准解锁申请
		this.wrapper.on("click", "#btn-approve-unlock-action", function () {
			if (!self.activeCard) return;
			frappe.confirm(`确定要【批准】操作员的取消核定申请并解除当月锁定吗？`, function () {
				frappe.call({
					method: "ashan_cn_procurement.ashan_cn_procurement.page.oil_card_ledger.oil_card_ledger.approve_unlock_monthly_ledger",
					args: {
						oil_card: self.activeCard.name,
						year: self.selectedYear,
						month: self.selectedMonth,
						approved: 1,
					},
					callback: function (r) {
						if (r.message && r.message.status === "ok") {
							frappe.show_alert({ message: r.message.message, indicator: "green" }, 4);
							self.loadLedgerData();
						}
					},
				});
			});
		});

		// 管理员驳回解锁申请
		this.wrapper.on("click", "#btn-reject-unlock-action", function () {
			if (!self.activeCard) return;
			frappe.confirm(`确定要【驳回】此项取消核定申请吗？`, function () {
				frappe.call({
					method: "ashan_cn_procurement.ashan_cn_procurement.page.oil_card_ledger.oil_card_ledger.approve_unlock_monthly_ledger",
					args: {
						oil_card: self.activeCard.name,
						year: self.selectedYear,
						month: self.selectedMonth,
						approved: 0,
					},
					callback: function (r) {
						if (r.message && r.message.status === "ok") {
							frappe.show_alert({ message: r.message.message, indicator: "orange" }, 3);
							self.loadLedgerData();
						}
					},
				});
			});
		});

		// 作废单笔记录并保留审计原因。
		this.wrapper.on("click", ".btn-delete-row", function () {
			const docType = $(this).data("doctype");
			const docName = $(this).data("name");

			if (self.isLocked && !self.isManager) {
				frappe.msgprint("当前月份已核定锁定，禁止删除记录！若需修改请先点击【申请取消核定】。");
				return;
			}

			frappe.prompt(
				[
					{
						fieldname: "reason",
						fieldtype: "Small Text",
						label: "作废原因",
						reqd: 1,
					},
				],
				(values) => {
					frappe.confirm("确认作废该笔油卡流水吗？作废后将重新核算余额并保留审计记录。", () => {
						frappe.call({
							method: "ashan_cn_procurement.ashan_cn_procurement.page.oil_card_ledger.oil_card_ledger.delete_ledger_record",
							args: {
								doc_type: docType,
								name: docName,
								oil_card: self.activeCard.name,
								year: self.selectedYear,
								month: self.selectedMonth,
								reason: values.reason,
							},
							callback: function (r) {
								if (r.message && r.message.status === "ok") {
									frappe.show_alert({ message: "记录已作废并重新核算。", indicator: "green" }, 3);
									self.loadLedgerData();
								}
							},
						});
					});
				},
				"作废油卡流水",
				"继续"
			);
		});
	}

	startInlineEntry(type) {
		const existing = $("#row-inline-entry");
		if (existing.length > 0) {
			existing.find("input:first").focus();
			return;
		}

		const tbody = this.wrapper.find("#tbody-unified-ledger");

		const now = new Date();
		let defaultDate = `${this.selectedYear}-${String(this.selectedMonth).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
		if (this.selectedYear !== now.getFullYear() || this.selectedMonth !== now.getMonth() + 1) {
			defaultDate = `${this.selectedYear}-${String(this.selectedMonth).padStart(2, "0")}-01`;
		}

		let html = "";
		if (type === "refuel") {
			html = `
				<tr id="row-inline-entry" class="row-inline-entry">
					<td>
						<input type="date" id="inline-refuel-date" class="inline-input-sm" value="${defaultDate}" required>
					</td>
					<td class="text-amber font-semibold">车辆加油</td>
					<td class="pos-relative">
						<div class="vehicle-combobox-wrapper">
							<input type="text" id="inline-refuel-vehicle-input" class="inline-input-sm" placeholder="输入车牌..." autocomplete="off" class="font-semibold" required>
							<input type="hidden" id="inline-refuel-vehicle-val">
						</div>
					</td>
					<td class="text-right">--</td>
					<td>
						<input type="number" step="0.01" id="inline-refuel-amount" class="inline-input-sm text-right font-mono font-bold text-amber" placeholder="加油金额" required>
					</td>
					<td>
						<input type="number" step="0.01" id="inline-refuel-liters" class="inline-input-sm text-right font-mono" placeholder="升数(L)" required>
					</td>
					<td class="pos-relative">
						<div class="grade-combobox-wrapper">
							<input type="text" id="inline-refuel-grade-input" class="inline-input-sm text-center font-semibold" placeholder="油号" value="92#" autocomplete="off" required>
							<input type="hidden" id="inline-refuel-grade-val" value="92">
						</div>
					</td>
					<td class="text-right" class="btn-inline-cell">
						<b id="inline-preview-balance" class="font-mono font-bold" class="preview-balance-val">${formatMoney(this.currentEndingBalance)}</b>
						<button class="btn-save-inline" id="btn-inline-save-refuel" title="保存">保存</button>
						<button class="btn-cancel-inline" id="btn-inline-cancel" title="取消">取消</button>
					</td>
				</tr>
			`;
		} else {
			html = `
				<tr id="row-inline-entry" class="row-inline-entry">
					<td>
						<input type="date" id="inline-recharge-date" class="inline-input-sm" value="${defaultDate}" required>
					</td>
					<td class="text-emerald font-semibold">集中充值</td>
					<td>--</td>
					<td>
						<input type="number" step="0.01" id="inline-recharge-amount" class="inline-input-sm text-right font-mono font-bold text-emerald" placeholder="充值金额" required>
					</td>
					<td class="text-right">--</td>
					<td class="text-right">--</td>
					<td class="text-center">--</td>
					<td class="text-right" class="btn-inline-cell">
						<b id="inline-preview-balance" class="font-mono font-bold" class="preview-balance-val">${formatMoney(this.currentEndingBalance)}</b>
						<button class="btn-save-inline" id="btn-inline-save-recharge" title="保存">保存</button>
						<button class="btn-cancel-inline" id="btn-inline-cancel" title="取消">取消</button>
					</td>
				</tr>
			`;
		}

		tbody.append(html);
		const targetInput = type === "refuel" ? $("#inline-refuel-vehicle-input") : $("#inline-recharge-amount");
		targetInput.focus();

		const tableWrapper = this.wrapper.find(".oil-data-table-wrapper");
		tableWrapper.scrollTop(tableWrapper[0].scrollHeight);
	}

	ensureFloatingDropdowns() {
		if (!$("#vehicle-autocomplete-dropdown").length) {
			$("body").append('<div id="vehicle-autocomplete-dropdown" class="vehicle-dropdown-popup" class="hide"></div>');
		} else if (!$("#vehicle-autocomplete-dropdown").parent().is("body")) {
			$("body").append($("#vehicle-autocomplete-dropdown"));
		}

		if (!$("#grade-autocomplete-dropdown").length) {
			$("body").append('<div id="grade-autocomplete-dropdown" class="grade-dropdown-popup" class="hide"></div>');
		} else if (!$("#grade-autocomplete-dropdown").parent().is("body")) {
			$("body").append($("#grade-autocomplete-dropdown"));
		}
	}

	positionFloatingDropdown(inputEl, dropdownEl, width = 275) {
		if (!inputEl.length || !dropdownEl.length) return;
		this.ensureFloatingDropdowns();

		const rect = inputEl[0].getBoundingClientRect();
		dropdownEl.css({
			display: "block",
			position: "fixed",
			left: `${rect.left}px`,
			width: `${width}px`,
			zIndex: 2147483647,
		});

		const dropdownHeight = dropdownEl.outerHeight() || 190;
		const spaceBelow = window.innerHeight - rect.bottom;
		const spaceAbove = rect.top;

		let top;
		if (spaceBelow < 210 && spaceAbove > 160) {
			// 底部空间不足时向上弹出 (Dropup)
			top = Math.max(10, rect.top - dropdownHeight - 4);
		} else {
			// 正常向下弹出 (Dropdown)
			top = rect.bottom + 3;
		}

		dropdownEl.css({ top: `${top}px` });
	}

	renderVehicleDropdown(q) {
		this.ensureFloatingDropdowns();
		const dropdown = $("#vehicle-autocomplete-dropdown");
		const inputEl = $("#inline-refuel-vehicle-input");
		const query = (q || "").trim().toLowerCase();
		let matches = this.meta.vehicles || [];
		if (query) {
			matches = matches.filter((v) => {
				const plate = (v.license_plate || v.name || "").toLowerCase();
				const model = (v.model || "").toLowerCase();
				return plate.includes(query) || model.includes(query);
			});
		}

		let itemsHtml = "";
		if (matches.length > 0) {
			matches.forEach((v) => {
				const fuelLabel = v.fuel_type_label || (v.fuel_type === "Diesel" ? "柴油" : "汽油");
				const isDiesel = fuelLabel === "柴油";
				const fuelClass = isDiesel ? "tag-diesel" : (fuelLabel === "天然气" ? "tag-gas" : "tag-petrol");
				const fuelTag = `<span class="veh-fuel-tag ${fuelClass}">${fuelLabel}</span>`;
				const modelTag = v.model ? `<span class="veh-model-tag">${v.model}</span>` : "";
				const odoText = v.last_odometer ? `${v.last_odometer}km` : "0km";

				const dispPlate = v.license_plate || v.name;
				const rmkText = v.custom_vehicle_remark ? ` (${v.custom_vehicle_remark})` : "";
				itemsHtml += `
					<div class="vehicle-dropdown-item" data-name="${v.name}">
						<div class="veh-item-left">
							<span class="veh-plate-text">${dispPlate}${rmkText}</span>
							${modelTag}
							${fuelTag}
						</div>
						<div class="veh-item-right">${odoText}</div>
					</div>
				`;
			});
		} else {
			itemsHtml = `<div class="vehicle-dropdown-empty">未匹配到车辆 "${q}"</div>`;
		}

		const fullHtml = `
			<div class="vehicle-dropdown-items-scroll">${itemsHtml}</div>
			<div class="vehicle-dropdown-footer" id="btn-quick-add-vehicle-from-dropdown">
				<span>快速新建车辆档案...</span>
			</div>
		`;

		dropdown.html(fullHtml);
		this.positionFloatingDropdown(inputEl, dropdown, 220);
	}

	renderGradeDropdown(q) {

		this.ensureFloatingDropdowns();
		const dropdown = $("#grade-autocomplete-dropdown");
		const inputEl = $("#inline-refuel-grade-input");
		const query = (q || "").trim().toLowerCase();
		const grades = [
			{ label: "92# 汽油", val: "92", type: "petrol", badge: "汽油" },
			{ label: "95# 汽油", val: "95", type: "petrol", badge: "汽油" },
			{ label: "98# 汽油", val: "98", type: "petrol", badge: "汽油" },
			{ label: "0# 柴油", val: "0#", type: "diesel", badge: "柴油" },
			{ label: "-10# 柴油", val: "-10#", type: "diesel", badge: "柴油" },
			{ label: "-20# 柴油", val: "-20#", type: "diesel", badge: "柴油" },
			{ label: "-35# 柴油", val: "-35#", type: "diesel", badge: "柴油" },
			{ label: "CNG 天然气", val: "CNG", type: "gas", badge: "天然气" },
			{ label: "LNG 液化气", val: "LNG", type: "gas", badge: "天然气" },
		];

		let matches = grades;
		if (query && !grades.some((g) => g.label.toLowerCase() === query)) {
			matches = grades.filter((g) => {
				return g.label.toLowerCase().includes(query) || g.val.toLowerCase().includes(query) || g.badge.toLowerCase().includes(query);
			});
		}

		let itemsHtml = "";
		if (matches.length > 0) {
			matches.forEach((g) => {
				itemsHtml += `
					<div class="grade-dropdown-item" data-val="${g.val}" data-label="${g.label}">
						<div class="grade-item-left">
							<span class="grade-title-text">${g.label}</span>
						</div>
						<span class="grade-badge-tag tag-${g.type}">${g.badge}</span>
					</div>
				`;
			});
		} else {
			itemsHtml = `<div class="grade-dropdown-empty">直接按回车确认输入 "${q}"</div>`;
		}

		const fullHtml = `<div class="grade-dropdown-items-scroll">${itemsHtml}</div>`;
		dropdown.html(fullHtml);
		this.positionFloatingDropdown(inputEl, dropdown, 200);
	}

	applyGradeToInlineEntry(gradeObj) {
		if (!gradeObj) return;
		$("#inline-refuel-grade-input").val(gradeObj.label);
		$("#inline-refuel-grade-val").val(gradeObj.val);
		$("#grade-autocomplete-dropdown").hide();
		$("#inline-refuel-odo").focus();
	}

	fuzzyMatchGrade(text) {
		if (!text) return null;
		const q = text.trim().toLowerCase();
		const grades = [
			{ label: "92# 汽油", val: "92" },
			{ label: "95# 汽油", val: "95" },
			{ label: "98# 汽油", val: "98" },
			{ label: "0# 柴油", val: "0#" },
			{ label: "-10# 柴油", val: "-10#" },
			{ label: "-20# 柴油", val: "-20#" },
			{ label: "-35# 柴油", val: "-35#" },
			{ label: "CNG 天然气", val: "CNG" },
			{ label: "LNG 液化气", val: "LNG" },
		];

		let match = grades.find((g) => g.label.toLowerCase() === q || g.val.toLowerCase() === q);
		if (match) return match;
		match = grades.find((g) => g.label.toLowerCase().includes(q) || g.val.toLowerCase().includes(q));
		if (match) return match;
		if (q.includes("92")) return grades[0];
		if (q.includes("95")) return grades[1];
		if (q.includes("98")) return grades[2];
		if (q.includes("0") || q.includes("柴")) return grades[3];
		if (q.includes("-10")) return grades[4];
		if (q.includes("气") || q.includes("cng") || q.includes("lng")) return grades[7];
		return { label: text.trim(), val: text.trim() };
	}

	applyVehicleToInlineEntry(v) {
		if (!v) return;
		$("#inline-refuel-vehicle-input").val(v.license_plate || v.name);
		$("#inline-refuel-vehicle-val").val(v.name);
		$("#vehicle-autocomplete-dropdown").hide();

		// 自动联动推荐动力油号 (使用车辆设置的默认油号或动力类型智能判定)
		if (v.custom_default_fuel_grade) {
			const grade = v.custom_default_fuel_grade;
			$("#inline-refuel-grade-input").val(grade);
			const shortVal = grade.split(" ")[0].replace("#", "").trim();
			$("#inline-refuel-grade-val").val(shortVal);
		} else {
			const fuelLabel = v.fuel_type_label || (v.fuel_type === "Diesel" ? "柴油" : "汽油");
			if (fuelLabel === "柴油") {
				$("#inline-refuel-grade-input").val("0# 柴油");
				$("#inline-refuel-grade-val").val("0#");
			} else if (fuelLabel === "天然气") {
				$("#inline-refuel-grade-input").val("CNG 天然气");
				$("#inline-refuel-grade-val").val("CNG");
			} else {
				$("#inline-refuel-grade-input").val("92# 汽油");
				$("#inline-refuel-grade-val").val("92");
			}
		}


		// 提示上期里程
		if (v.last_odometer) {
			$("#inline-refuel-odo").attr("placeholder", `上期:${v.last_odometer}km`);
		}

		this.updateInlineRefuelCalculations();
		$("#inline-refuel-odo").focus();
	}

	fuzzyMatchVehicle(text) {
		if (!text) return null;
		const q = text.trim().toLowerCase();
		let match = this.meta.vehicles.find((v) => (v.license_plate || "").toLowerCase() === q || (v.name || "").toLowerCase() === q);
		if (match) return match;
		match = this.meta.vehicles.find((v) => (v.license_plate || "").toLowerCase().includes(q) || (v.name || "").toLowerCase().includes(q));
		return match || null;
	}

	openCreateVehicleDialog(prefillPlate = "") {
		const self = this;
		const companyDefault = self.meta.default_company || (self.meta.companies && self.meta.companies.length ? self.meta.companies[0].name : "");

		const d = new frappe.ui.Dialog({
			title: __("快速新建车辆档案"),
			fields: [
				{
					label: __("车牌号码"),
					fieldname: "license_plate",
					fieldtype: "Data",
					reqd: 1,
					default: prefillPlate,
					placeholder: "如：津AF9527、粤B·8888",
				},
				{
					fieldtype: "Column Break",
				},
				{
					label: __("车型分类"),
					fieldname: "vehicle_category",
					fieldtype: "Select",
					options: ["货车", "轿车"],
					default: "货车",
					reqd: 1,
				},

				{
					fieldtype: "Section Break",
				},
				{
					label: __("动力类型"),
					fieldname: "fuel_type",
					fieldtype: "Select",
					options: ["柴油", "汽油", "插电混动", "纯电动", "天然气"],
					default: "柴油",
					reqd: 1,
				},
				{
					fieldtype: "Column Break",
				},
				{
					label: __("初始默认油号"),
					fieldname: "default_fuel_grade",
					fieldtype: "Select",
					options: ["0# 柴油", "-10# 柴油", "-20# 柴油", "92# 汽油", "95# 汽油", "98# 汽油", "纯电动", "天然气", "其他"],
					default: "0# 柴油",
					reqd: 1,
					description: "选择动力类型时会自动推荐，也可手动指定",
				},
				{
					fieldtype: "Section Break",
				},
				{
					label: __("主要驾驶员"),
					fieldname: "primary_driver",
					fieldtype: "Data",
					placeholder: "如：张师傅（选填，与高速费台账联动）",
				},
				{
					fieldtype: "Column Break",
				},
				{
					label: __("车辆用途/备注"),
					fieldname: "vehicle_remark",
					fieldtype: "Data",
					placeholder: "如：应急车、专职配送（选填）",
				},
				{
					fieldtype: "Section Break",
				},
				{
					label: __("当前表显里程 (km)"),
					fieldname: "last_odometer",
					fieldtype: "Int",
					default: 0,
					placeholder: "初始里程基准",
				},
				{
					fieldtype: "Section Break",
				},
				{
					fieldname: "fuel_match_alert_html",
					fieldtype: "HTML",
				},
			],
			primary_action_label: __("立即创建车辆"),
			primary_action(values) {
				frappe.call({
					method: "ashan_cn_procurement.ashan_cn_procurement.page.oil_card_ledger.oil_card_ledger.quick_create_vehicle",
					args: {
						license_plate: values.license_plate,
						vehicle_category: values.vehicle_category,
						fuel_type: values.fuel_type,
						default_fuel_grade: values.default_fuel_grade,
						vehicle_remark: values.vehicle_remark || "",
						primary_driver: values.primary_driver || "",
						last_odometer: values.last_odometer || 0,
						company: companyDefault,
					},

					callback: function (r) {
						if (r.message && r.message.status === "ok") {
							frappe.show_alert({ message: r.message.message, indicator: "green" }, 3);
							d.hide();
							const veh = r.message.vehicle;
							self.meta.vehicles.push(veh);
							self.applyVehicleToInlineEntry(veh);
						}
					},
				});
			},
		});

		// 动力类型联动默认油号推荐
		d.fields_dict.fuel_type.$input.on("change", function () {
			const ft = d.get_value("fuel_type") || "";
			if (ft === "柴油") {
				d.set_value("default_fuel_grade", "0# 柴油");
			} else if (ft === "汽油" || ft === "插电混动") {
				d.set_value("default_fuel_grade", "92# 汽油");
			} else if (ft === "纯电动") {
				d.set_value("default_fuel_grade", "纯电动");
			} else if (ft === "天然气") {
				d.set_value("default_fuel_grade", "天然气");
			}
		});


		function updateFuelWarning() {
			const cat = d.get_value("vehicle_category") || "";
			const fuel = d.get_value("fuel_type") || "";
			const wrapper = d.fields_dict.fuel_match_alert_html.$wrapper;

			let html = "";
			if (cat === "货车") {
				if (fuel === "汽油" || fuel === "插电混动" || fuel === "纯电动") {
					html = `<div class="unlock-danger-msg">
						<b>【动力匹配提示】</b>：您选择的车型是【货车】，该车型通常为【柴油】动力。请核实该车辆是否确为【${fuel}】！
					</div>`;
				} else {
					html = `<div class="unlock-success-msg">
						 动力匹配正常：货车已默认配置为【柴油动力（0# 柴油）】。
					</div>`;
				}
			} else if (cat === "轿车") {
				if (fuel === "柴油") {
					html = `<div class="unlock-danger-msg">
						<b>【动力匹配提示】</b>：您选择的车型是【轿车】，轿车通常为【汽油】动力。请核实该车辆是否确为【柴油】动力！
					</div>`;
				} else {
					html = `<div class="unlock-success-msg">
						 动力匹配正常：轿车已配置为【${fuel}（92#/95# 汽油）】。
					</div>`;
				}
			}
			wrapper.html(html);

		}

		// 联动车型与动力
		d.fields_dict.vehicle_category.$input.on("change", function () {
			const cat = $(this).val() || "";
			if (cat === "货车" || cat === "特种作业车") {
				d.set_value("fuel_type", "柴油");
			} else {
				d.set_value("fuel_type", "汽油");
			}
			updateFuelWarning();
		});

		d.fields_dict.fuel_type.$input.on("change", function () {
			updateFuelWarning();
		});

		d.show();
		updateFuelWarning();
	}

	updateInlineRefuelCalculations() {
		const amt = parseFloat($("#inline-refuel-amount").val()) || 0;
		const lit = parseFloat($("#inline-refuel-liters").val()) || 0;
		const odo = parseFloat($("#inline-refuel-odo").val()) || 0;
		const vehName = $("#inline-refuel-vehicle-val").val() || $("#inline-refuel-vehicle-input").val();

		const previewBal = this.currentEndingBalance - amt;
		$("#inline-preview-balance").text(formatMoney(previewBal));

		if (this.isManager && vehName) {
			const veh = this.meta.vehicles.find((v) => String(v.name) === String(vehName) || String(v.license_plate) === String(vehName));
			if (veh && odo > (veh.last_odometer || 0)) {
				const dist = odo - (veh.last_odometer || 0);
				$("#inline-preview-dist").text(`${dist} km`);
				if (dist > 0 && lit > 0) {
					const consum = ((lit / dist) * 100).toFixed(2);
					$("#inline-preview-consum").text(`${consum} L/100km`);
				} else {
					$("#inline-preview-consum").text("--");
				}
			} else {
				$("#inline-preview-dist").text("--");
				$("#inline-preview-consum").text("--");
			}
		}
	}

	updateInlineRechargeCalculations() {
		const amt = parseFloat($("#inline-recharge-amount").val()) || 0;
		const previewBal = this.currentEndingBalance + amt;
		$("#inline-preview-balance").text(formatMoney(previewBal));
	}

	saveInlineRefuel() {
		const self = this;
		const dateVal = $("#inline-refuel-date").val();
		let vehVal = $("#inline-refuel-vehicle-val").val();
		const vehInput = $("#inline-refuel-vehicle-input").val();
		if (!vehVal && vehInput) {
			const match = self.fuzzyMatchVehicle(vehInput);
			if (match) {
				vehVal = match.name;
			} else {
				vehVal = vehInput;
			}
		}

		const odoVal = $("#inline-refuel-odo").val();
		const litVal = $("#inline-refuel-liters").val();
		const amtVal = $("#inline-refuel-amount").val();
		const gradeVal = $("#inline-refuel-grade-val").val() || $("#inline-refuel-grade-input").val();
		const remarkVal = $("#inline-refuel-remark").val();

		// 校验必填项
		let hasErr = false;
		$(".inline-input-sm").removeClass("input-invalid");

		if (!dateVal) { $("#inline-refuel-date").addClass("input-invalid"); hasErr = true; }
		if (!vehVal) { $("#inline-refuel-vehicle-input").addClass("input-invalid"); hasErr = true; }
		if (!odoVal || parseFloat(odoVal) <= 0) { $("#inline-refuel-odo").addClass("input-invalid"); hasErr = true; }
		if (!litVal || parseFloat(litVal) <= 0) { $("#inline-refuel-liters").addClass("input-invalid"); hasErr = true; }
		if (!amtVal || parseFloat(amtVal) <= 0) { $("#inline-refuel-amount").addClass("input-invalid"); hasErr = true; }

		if (hasErr) {
			frappe.show_alert({ message: "请完整填写标红的必填项（日期、车辆、当前里程、加油升数与金额）！", indicator: "red" }, 4);
			return;
		}

		frappe.call({
			method: "ashan_cn_procurement.ashan_cn_procurement.page.oil_card_ledger.oil_card_ledger.quick_add_refuel",
			args: {
				oil_card: self.activeCard.name,
				posting_date: dateVal,
				vehicle: vehVal,
				odometer: odoVal,
				liters: litVal,
				amount: amtVal,
				fuel_grade: gradeVal,
				remark: remarkVal,
			},
			callback: function (r) {
				if (r.message && r.message.status === "ok") {
					frappe.show_alert({ message: r.message.message, indicator: "green" }, 3);
					$("#row-inline-entry").remove();
					self.loadLedgerData();
					self.loadMeta(); // 刷新车辆最新里程
				}
			},
		});
	}

	saveInlineRecharge() {
		const self = this;
		const dateVal = $("#inline-recharge-date").val();
		const modeVal = $("#inline-recharge-mode").val();
		const amtVal = $("#inline-recharge-amount").val();
		const remarkVal = $("#inline-recharge-remark").val();

		let hasErr = false;
		$(".inline-input-sm").removeClass("input-invalid");

		if (!dateVal) { $("#inline-recharge-date").addClass("input-invalid"); hasErr = true; }
		if (!amtVal || parseFloat(amtVal) <= 0) { $("#inline-recharge-amount").addClass("input-invalid"); hasErr = true; }

		if (hasErr) {
			frappe.show_alert({ message: "请完整填写标红的必填项（日期与充值金额）！", indicator: "red" }, 4);
			return;
		}

		frappe.call({
			method: "ashan_cn_procurement.ashan_cn_procurement.page.oil_card_ledger.oil_card_ledger.quick_add_recharge",
			args: {
				oil_card: self.activeCard.name,
				posting_date: dateVal,
				recharge_amount: amtVal,
				mode_of_payment: modeVal,
				bonus_amount: 0,
				remark: remarkVal,
			},
			callback: function (r) {
				if (r.message && r.message.status === "ok") {
					frappe.show_alert({ message: r.message.message, indicator: "green" }, 3);
					$("#row-inline-entry").remove();
					self.loadLedgerData();
				}
			},
		});
	}

	syncDropdowns() {
		this.wrapper.find("#sel-year").val(this.selectedYear);
		this.wrapper.find("#sel-month").val(this.selectedMonth);
	}

	openCreateOilCardDialog() {
		const self = this;
		const companyDefault = self.meta.default_company || (self.meta.companies && self.meta.companies.length ? self.meta.companies[0].name : "");

		const d = new frappe.ui.Dialog({
			title: __("新建企业油卡档案"),
			fields: [
				{
					label: __("油卡名称"),
					fieldname: "card_name",
					fieldtype: "Data",
					reqd: 1,
					placeholder: "如：粤B·8888 专车油卡、应急车队副卡",
				},
				{
					fieldtype: "Column Break",
				},
				{
					label: __("卡类型"),
					fieldname: "card_type",
					fieldtype: "Select",
					options: ["主卡", "副卡", "单卡"],
					default: "主卡",
					reqd: 1,
				},
				{
					fieldtype: "Section Break",
				},
				{
					label: __("实体油卡卡号"),
					fieldname: "card_no",
					fieldtype: "Data",
					reqd: 1,
					placeholder: "如：1000118888888888",
				},
				{
					fieldtype: "Column Break",
				},
				{
					label: __("油企 / 供应商"),
					fieldname: "supplier",
					fieldtype: "Link",
					options: "Supplier",
					default: self.meta.default_supplier || "",
					placeholder: "选择或输入油企",
				},
				{
					fieldtype: "Section Break",
				},
				{
					label: __("所属公司"),
					fieldname: "company",
					fieldtype: "Link",
					options: "Company",
					default: companyDefault,
					reqd: 1,
				},
				{
					fieldtype: "Column Break",
				},
				{
					label: __("期初建账余额 (¥)"),
					fieldname: "opening_balance",
					fieldtype: "Currency",
					default: 0,
					description: "建账时的初始可用余额",
				},
			],
			primary_action_label: __("立即创建"),
			primary_action(values) {
				frappe.call({
					method: "ashan_cn_procurement.ashan_cn_procurement.page.oil_card_ledger.oil_card_ledger.quick_create_oil_card",
					args: {
						card_name: values.card_name,
						card_no: values.card_no,
						card_type: values.card_type,
						company: values.company,
						supplier: values.supplier,
						opening_balance: values.opening_balance,
					},
					callback: function (r) {
						if (r.message && r.message.status === "ok") {
							frappe.show_alert({ message: r.message.message, indicator: "green" }, 3);
							d.hide();
							self.loadCards(r.message.name);
						}
					},
				});
			},
		});
		d.show();
	}

	loadCards(targetCardName) {
		const self = this;
		frappe.call({
			method: "ashan_cn_procurement.ashan_cn_procurement.page.oil_card_ledger.oil_card_ledger.get_all_oil_cards",
			callback: function (r) {
				self.cards = r.message || [];
				self.renderCardsList();

				if (self.cards.length > 0) {
					if (targetCardName && self.cards.some((c) => c.name === targetCardName)) {
						self.selectCard(targetCardName);
					} else if (!self.activeCard || !self.cards.some((c) => c.name === self.activeCard.name)) {
						self.selectCard(self.cards[0].name);
					} else {
						self.selectCard(self.activeCard.name);
					}
				} else {
					self.activeCard = null;
					self.wrapper.find("#main-empty-placeholder").removeClass("hide").show();
					self.wrapper.find("#main-content-pane").addClass("hide").hide();
				}
			},
		});
	}

	renderCardsList() {
		const container = this.wrapper.find("#cards-list-container");
		if (this.cards.length === 0) {
			container.html(`
				<div class="empty-placeholder">
					<div>暂无油卡档案</div>
				</div>
			`);
			return;
		}

		let html = "";
		this.cards.forEach((c) => {
			const strName = String(c.name);
			const isActive = this.activeCard && String(this.activeCard.name) === strName ? "is-active" : "";
			const currentBal = flt(c.current_balance || 0);
			const balNum = currentBal.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
			const cardNo = c.card_no_masked || c.card_code || c.card_name || "";
			const orgText = c.supplier_abbr || c.supplier || c.company_abbr || c.company || "中国石化";
			const custodian = c.custodian || c.driver || "张建国";

			let balClass = "bal-positive";
			if (currentBal < 0) {
				balClass = "bal-negative";
			} else if (currentBal === 0) {
				balClass = "bal-zero";
			}

			const deleteBtnHtml = this.isManager ? `
				<button type="button" class="btn-delete-card" data-name="${strName}" data-title="${c.card_name}" title="删除油卡档案">
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
				</button>
			` : "";

			html += `
				<div class="oil-card-item ${isActive}" data-name="${strName}">
					<!-- 第一行: 油卡号 + 状态标签 -->
					<div class="card-item-row-1">
						<span class="card-no-title font-mono">${cardNo}</span>
						<div class="card-status-group">
							<span class="card-status-badge ${currentBal <= 500 ? 'status-warn' : 'status-ok'}">${currentBal <= 500 ? '低余额' : '正常'}</span>
							${deleteBtnHtml}
						</div>
					</div>
					<!-- 第二行: 仅显示油卡公司 (解耦车牌，一卡多车) -->
					<div class="card-item-row-2">
						<span class="card-company-name">${orgText}</span>
					</div>
					<!-- 第三行: 油卡保管 + 实时余额 -->
					<div class="card-item-row-3">
						<span class="card-custodian-text">油卡保管: ${custodian}</span>
						<span class="card-balance-text ${balClass}">¥ ${balNum}</span>
					</div>
				</div>
			`;
		});

		container.html(html);
	}

	filterCardsList(q) {
		this.wrapper.find(".oil-card-item").each(function () {
			const text = $(this).text().toLowerCase();
			if (!q || text.indexOf(q) !== -1) {
				$(this).show();
			} else {
				$(this).hide();
			}
		});
	}

	selectCard(cardName) {
		const strName = String(cardName);
		this.activeCard = this.cards.find((c) => String(c.name) === strName) || null;
		this.wrapper.find(".oil-card-item").removeClass("is-active");
		this.wrapper.find(`.oil-card-item[data-name="${strName}"]`).addClass("is-active");

		if (this.activeCard) {
			this.wrapper.find("#main-empty-placeholder").addClass("hide").hide();
			this.wrapper.find("#main-content-pane").removeClass("hide").show();
			this.loadLedgerData();
		}
	}

	loadLedgerData() {
		if (!this.activeCard) return;

		const self = this;
		frappe.call({
			method: "ashan_cn_procurement.ashan_cn_procurement.page.oil_card_ledger.oil_card_ledger.get_unified_ledger_data",
			args: {
				oil_card: this.activeCard.name,
				year: this.selectedYear,
				month: this.selectedMonth,
			},
			callback: function (r) {
				const data = r.message || {};
				self.renderDashboard(data);
			},
		});
	}

	renderDashboard(data) {
		const card = data.card_info || {};
		const kpis = data.kpis || {};
		const txns = data.transactions || [];
		this.isManager = Boolean(data.is_manager);
		this.isLocked = Boolean(data.is_locked);
		this.currentEndingBalance = flt(kpis.ending_balance || 0);

		if (this.isManager) {
			this.wrapper.find("#btn-create-card").show();
			this.wrapper.find("#empty-add-card-hint").show();
		} else {
			this.wrapper.find("#btn-create-card").hide();
			this.wrapper.find("#empty-add-card-hint").hide();
		}

		// 4 大财务指标
		this.wrapper.find("#kpi-opening-bal").text(formatMoney(kpis.opening_balance || 0));
		this.wrapper.find("#kpi-recharge-total").text(formatMoney(kpis.period_recharge_total || 0));
		this.wrapper.find("#kpi-refuel-total").text(formatMoney(kpis.period_refuel_total || 0));
		this.wrapper.find("#kpi-ending-bal").text(formatMoney(kpis.ending_balance || 0));

		// 更新筛选 Tab 计数
		const rechargeTxns = txns.filter((t) => t.txn_type !== "加油");
		const refuelTxns = txns.filter((t) => t.txn_type === "加油");
		this.wrapper.find("#tab-count-all").text(`(${txns.length})`);
		this.wrapper.find("#tab-count-recharge").text(`(${rechargeTxns.length})`);
		this.wrapper.find("#tab-count-refuel").text(`(${refuelTxns.length})`);

		// 月度核定状态卡片 & 操作按钮
		const lockBtnContainer = this.wrapper.find("#lock-action-container");
		const lockedBanner = this.wrapper.find("#locked-banner");
		const unlockReq = data.locked_info ? Boolean(data.locked_info.unlock_requested) : false;

		if (this.isLocked) {
			if (this.isManager) {
				if (unlockReq) {
					lockedBanner.html(`
						<div class="unlock-banner-wrap">
							<div>
								<span><b>【申请取消核定】</b>：用户 <b>${data.locked_info.unlock_requested_by}</b> 申请解除【${this.selectedYear}年${this.selectedMonth}月】锁定，理由：“<b>${data.locked_info.unlock_request_reason}</b>”</span>
							</div>
							<div class="unlock-banner-actions">
								<button class="btn-approve-unlock" id="btn-approve-unlock-action" class="btn-approve-unlock">批准解锁</button>
								<button class="btn-reject-unlock" id="btn-reject-unlock-action" class="btn-reject-unlock">驳回申请</button>
							</div>
						</div>
					`).show();
				} else {
					lockedBanner.html(`<span><b>本月流水已核定锁定</b>：当前月份处于保护状态，录入与删除功能已关闭。如需调整请点击【解除锁定】。</span>`).show();
				}
				lockBtnContainer.html(`<button class="btn-cmd-unlock" id="btn-unlock-month-action">解除锁定</button>`);
			} else {
				if (unlockReq) {
					lockedBanner.html(`<span><b>【已提交取消核定申请】</b>：已向管理员申请解除锁定（理由：“${data.locked_info.unlock_request_reason}”），等待审批中...</span>`).show();
					lockBtnContainer.html(`<span class="status-pill-subtle status-pill-amber" class="status-pill-audit-wait">申请反核定待审</span>`);
				} else {
					lockedBanner.html(`<span><b>本月流水已完成核定锁定</b>：单据处于只读保护状态。如需修改请点击【申请取消核定】。</span>`).show();
					lockBtnContainer.html(`<button class="btn-cmd-request-unlock" id="btn-request-unlock-action" class="btn-cmd-request-unlock">申请取消核定</button>`);
				}
			}

			this.wrapper.find("#btn-quick-refuel, #btn-quick-recharge")
				.prop("disabled", true)
				.attr("aria-disabled", "true")
				.addClass("ashan-action-locked")
				.attr("title", "当前月份已核定锁定");
			$("#row-inline-entry").remove();
		} else {
			lockedBanner.addClass("hide").hide();
			lockBtnContainer.html(`<button class="btn-cmd-lock" id="btn-lock-month-action">月度封账</button>`);
			this.wrapper.find("#btn-quick-refuel, #btn-quick-recharge")
				.prop("disabled", false)
				.removeAttr("aria-disabled")
				.removeClass("ashan-action-locked")
				.removeAttr("title");
		}

		// 渲染流水表格
		this.renderUnifiedTable(txns, kpis);
		this.wrapper.find(".oil-data-table-wrapper").scrollLeft(0);
	}

	renderUnifiedTable(txns, kpis) {
		const tbody = this.wrapper.find("#tbody-unified-ledger");
		const tfoot = this.wrapper.find("#tfoot-unified-ledger");
		const isMgr = this.isManager;
		const isLocked = this.isLocked;

		let html = "";

		// ===== 第 1 行：固定置顶上期结转行 =====
		const openingDate = `${kpis.year}-${String(kpis.month).padStart(2, "0")}-01`;
		const openingBalFmt = formatMoney(kpis.opening_balance || 0);

		html += `
			<tr class="row-opening-balance">
				<td>${openingDate}</td>
				<td>上期结转</td>
				<td>--</td>
				<td class="text-right font-mono">--</td>
				<td class="text-right font-mono">--</td>
				<td class="text-right font-mono">--</td>
				<td class="text-center">--</td>
				<td class="text-right font-mono font-bold" class="td-balance-cell">${openingBalFmt}</td>
			</tr>
		`;

		// ===== 后续流水交易行 (纯中文，无 + - 符号，独立升数与油号) =====
		if (txns && txns.length > 0) {
			txns.forEach((t) => {
				const isRefuel = t.txn_type === "加油";
				const typeText = isRefuel ? "车辆加油" : "集中充值";
				const typeClass = isRefuel ? "text-amber" : "text-emerald";

				const rechargeAmt = isRefuel ? "--" : formatMoney(t.change_amount);
				const refuelAmt = isRefuel ? formatMoney(Math.abs(t.change_amount)) : "--";
				const litersFmt = isRefuel && t.liters ? `${t.liters.toFixed(2)} L` : "--";
				const fuelGrade = isRefuel && t.fuel_grade && t.fuel_grade !== "--" ? `<span class="badge-grade">${t.fuel_grade}</span>` : "--";
				const plateFmt = isRefuel ? (t.license_plate || t.target || "--") : "--";
				const runningBalFmt = formatMoney(t.running_balance);

				html += `
					<tr class="ledger-row ${isRefuel ? 'row-refuel' : 'row-recharge'}" data-type="${isRefuel ? 'refuel' : 'recharge'}">
						<td>${t.posting_date}</td>
						<td class="${typeClass} font-semibold">${typeText}</td>
						<td>${plateFmt}</td>
						<td class="text-right font-mono ${!isRefuel ? 'text-emerald font-semibold' : ''}">${rechargeAmt}</td>
						<td class="text-right font-mono ${isRefuel ? 'text-amber font-semibold' : ''}">${refuelAmt}</td>
						<td class="text-right font-mono font-semibold">${litersFmt}</td>
						<td class="text-center">${fuelGrade}</td>
						<td class="text-right font-mono font-bold" class="td-balance-cell">${runningBalFmt}</td>
					</tr>
				`;
			});
		} else {
			html += `
				<tr class="row-empty-month">
					<td colspan="8" class="td-empty-cell">
						<div class="empty-cell-title">本月暂无加油与充值流水变动</div>
						<div class="empty-cell-sub">
							期初结存 <b>${openingBalFmt}</b> ｜ 期末结存 <b>${openingBalFmt}</b>
						</div>
					</td>
				</tr>
			`;
		}

		tbody.html(html);

		// ===== 合计行 (tfoot: 严格列对齐，无 + - 符号) =====
		const totalLitersFmt = `${(kpis.period_liters || 0).toFixed(2)} L`;
		const rechargeTotalFmt = formatMoney(kpis.period_recharge_total || 0);
		const refuelTotalFmt = formatMoney(kpis.period_refuel_total || 0);
		const endingBalFmt = formatMoney(kpis.ending_balance || 0);

		tfoot.html(`
			<tr>
				<td><b>合计</b></td>
				<td>--</td>
				<td>--</td>
				<td class="text-right font-mono font-bold text-emerald"><b>${rechargeTotalFmt}</b></td>
				<td class="text-right font-mono font-bold text-amber"><b>${refuelTotalFmt}</b></td>
				<td class="text-right font-mono font-bold"><b>${totalLitersFmt}</b></td>
				<td class="text-center">--</td>
				<td class="text-right font-mono font-bold" class="td-balance-cell"><b>${endingBalFmt}</b></td>
			</tr>
		`);
	}
}