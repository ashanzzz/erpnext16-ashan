// Copyright (c) 2026, Ashan and contributors
// For license information, please see license.txt

frappe.pages["contract-workbench"].on_page_load = function (wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __("采购合同"),
        single_column: true,
    });
    wrapper.contract_workbench = new ProcurementContractWorkbench(page, wrapper);
};

frappe.pages["contract-workbench"].on_page_show = function (wrapper) {
    if (wrapper.contract_workbench) {
        wrapper.contract_workbench.refresh();
    }
};

class ProcurementContractWorkbench {
    constructor(page, wrapper) {
        this.page = page;
        this.wrapper = $(wrapper);
        this.contracts = [];
        this.kpis = {};
        this.current_status = "active";
        this.current_company = "";
        this.search_query = "";
        this.allowed_companies = [];

        this.init();
    }

    async init() {
        this.setup_page_header();
        this.render_layout();
        this.bind_events();
        await this.load_context();
        this.load_contracts();
    }

    setup_page_header() {
        const self = this;
        this.page.set_title(__("采购合同"));
        this.page.clear_actions();

        this.page.set_primary_action(
            __("新建采购合同"),
            function () {
                self.open_contract_form_modal();
            },
            "octicon octicon-plus"
        );
    }

    render_layout() {
        const html = `
            <div class="contract-workbench-container">
                <!-- Header Titles -->
                <div class="contract-header-bar">
                    <div class="contract-header-titles">
                        <h2>采购合同履约工作台</h2>
                        <div class="contract-subtitle">合同分期规划 · 动态比例整算 · 资金出账闭环</div>
                    </div>
                    <div class="contract-header-actions" id="contract-company-selector-wrap">
                        <select class="picker-select" id="contract-company-select">
                            <option value="">全部签约公司</option>
                        </select>
                    </div>
                </div>

                <!-- KPI Summary Cards -->
                <div class="contract-kpi-grid">
                    <div class="contract-kpi-card">
                        <div class="contract-kpi-label">合同总数</div>
                        <div class="contract-kpi-val" id="kpi-contract-total">0 份</div>
                        <div class="contract-kpi-sub">在册采购合同</div>
                    </div>
                    <div class="contract-kpi-card">
                        <div class="contract-kpi-label">履约中合同</div>
                        <div class="contract-kpi-val text-primary" id="kpi-contract-active">0 份</div>
                        <div class="contract-kpi-sub">执行中业务合同</div>
                    </div>
                    <div class="contract-kpi-card">
                        <div class="contract-kpi-label">合同标的总额</div>
                        <div class="contract-kpi-val" id="kpi-contract-total-amt">¥ 0.00</div>
                        <div class="contract-kpi-sub">签约法定总标的</div>
                    </div>
                    <div class="contract-kpi-card">
                        <div class="contract-kpi-label">已整算金额</div>
                        <div class="contract-kpi-val text-primary" id="kpi-contract-settled-amt">¥ 0.00</div>
                        <div class="contract-kpi-sub">已派生电汇整算</div>
                    </div>
                    <div class="contract-kpi-card">
                        <div class="contract-kpi-label">实际已付款</div>
                        <div class="contract-kpi-val text-green" id="kpi-contract-paid-amt">¥ 0.00</div>
                        <div class="contract-kpi-sub">财务出账核销</div>
                    </div>
                    <div class="contract-kpi-card">
                        <div class="contract-kpi-label">履约待付余额</div>
                        <div class="contract-kpi-val text-amber" id="kpi-contract-out-amt">¥ 0.00</div>
                        <div class="contract-kpi-sub">剩余应付守恒平账</div>
                    </div>
                </div>

                <!-- Filter Controls Bar -->
                <div class="picker-filter-bar">
                    <div class="picker-filter-group">
                        <label>履约状态:</label>
                        <div class="picker-status-btn-group" id="contract-status-btn-group">
                            <button type="button" class="picker-status-btn active" data-status="active">履约中</button>
                            <button type="button" class="picker-status-btn" data-status="draft">待生效草稿</button>
                            <button type="button" class="picker-status-btn" data-status="completed">已结清</button>
                            <button type="button" class="picker-status-btn" data-status="all">全部合同</button>
                        </div>
                    </div>
                    <div class="picker-filter-group">
                        <label>搜索合同/供应商:</label>
                        <input type="text" class="picker-input" id="contract-search-input" placeholder="输入合同编号、名称或供应商..." />
                    </div>
                    <div class="picker-filter-group contract-ml-auto">
                        <button type="button" class="btn btn-default btn-xs" id="contract-refresh-btn">🔄 刷新</button>
                    </div>
                </div>

                <!-- Contracts Table View with Clean Single-line Table Header -->
                <div class="picker-table-wrapper contract-table-wrap">
                    <table class="picker-data-table" id="contract-data-table">
                        <thead>
                            <tr>
                                <th class="picker-col-sticky-1 col-w-seq text-center">#</th>
                                <th class="picker-col-sticky-2 col-w-docname">合同编号</th>
                                <th class="picker-col-sticky-3 contract-col-w220">合同名称 / 标的</th>
                                <th class="contract-col-w160">合作供应商</th>
                                <th class="contract-col-w120">合同类别</th>
                                <th class="text-right contract-col-w140">合同标的总额</th>
                                <th class="text-right contract-col-w140">已整算金额</th>
                                <th class="text-right contract-col-w140">实际已付款</th>
                                <th class="text-right contract-col-w140">履约待付余额</th>
                                <th class="contract-col-w360">分期付款里程碑规划与整算派生</th>
                                <th class="contract-col-w100 text-center">生效日期</th>
                                <th class="text-center contract-col-w90">状态</th>
                                <th class="text-center contract-col-w100">操作</th>
                            </tr>
                        </thead>
                        <tbody id="contract-table-body">
                            <tr><td colspan="13" class="contract-loading-cell">正在加载合同数据...</td></tr>
                        </tbody>
                        <tfoot id="contract-table-foot"></tfoot>
                    </table>
                </div>
            </div>
        `;
        this.page.main.html(html);
    }

    bind_events() {
        const self = this;

        // Company filter
        this.page.main.on("change", "#contract-company-select", function () {
            self.current_company = $(this).val();
            self.load_contracts();
        });

        // Status segmented filter
        this.page.main.on("click", "#contract-status-btn-group .picker-status-btn", function () {
            $("#contract-status-btn-group .picker-status-btn").removeClass("active");
            $(this).addClass("active");
            self.current_status = $(this).data("status");
            self.load_contracts();
        });

        // Search input debounce
        let searchTimer = null;
        this.page.main.on("input", "#contract-search-input", function () {
            clearTimeout(searchTimer);
            const val = $(this).val();
            searchTimer = setTimeout(() => {
                self.search_query = val;
                self.load_contracts();
            }, 300);
        });

        // Refresh button
        this.page.main.on("click", "#contract-refresh-btn", function () {
            self.load_contracts();
        });

        // Quick create reimbursement from milestone
        this.page.main.on("click", ".contract-quick-rr-btn", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const contractNo = $(this).data("contract-no");
            const termIdx = $(this).data("term-idx");
            const stageName = $(this).data("stage-name");
            const ratio = $(this).data("ratio");
            const amount = $(this).data("amt");
            const contractTotal = $(this).data("contract-total");
            self.open_milestone_settlement_modal(contractNo, termIdx, stageName, ratio, amount, contractTotal);
        });

        // Open contract detail modal
        this.page.main.on("click", ".contract-view-detail-btn, .contract-clickable-doc", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const contractNo = $(this).data("contract-no");
            self.open_contract_detail_modal(contractNo);
        });

        // Delete draft contract
        this.page.main.on("click", ".contract-delete-btn", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const contractNo = $(this).data("contract-no");
            self.confirm_delete_contract(contractNo);
        });
    }

    async load_context() {
        try {
            const r = await frappe.call({
                method: "ashan_cn_procurement.services.contract_service.get_contract_workbench_context",
            });
            if (r.message && r.message.allowed_companies) {
                this.allowed_companies = r.message.allowed_companies;
                const $sel = $("#contract-company-select");
                $sel.empty().append('<option value="">全部签约公司</option>');
                r.message.allowed_companies.forEach((comp) => {
                    $sel.append(`<option value="${frappe.utils.escape_html(comp)}">${frappe.utils.escape_html(comp)}</option>`);
                });
            }
        } catch (e) {
            console.error("Failed to load contract workbench context:", e);
        }
    }

    async refresh() {
        await this.load_context();
        await this.load_contracts();
    }

    async load_contracts() {
        const self = this;
        try {
            const r = await frappe.call({
                method: "ashan_cn_procurement.services.contract_service.get_contract_list",
                args: {
                    company: self.current_company,
                    status: self.current_status,
                    search: self.search_query,
                },
            });
            if (r.message) {
                self.contracts = r.message.contracts || [];
                self.kpis = r.message.kpis || {};
                self.render_kpis();
                self.render_table();
            }
        } catch (e) {
            console.error("Failed to load contracts:", e);
        }
    }

    render_kpis() {
        const k = this.kpis;
        $("#kpi-contract-total").text(`${k.total_count || 0} 份`);
        $("#kpi-contract-active").text(`${k.active_count || 0} 份`);
        $("#kpi-contract-total-amt").text(format_currency(k.total_contract_amount || 0));
        $("#kpi-contract-settled-amt").text(format_currency(k.total_settled_amount || 0));
        $("#kpi-contract-paid-amt").text(format_currency(k.total_paid_amount || 0));
        $("#kpi-contract-out-amt").text(format_currency(k.outstanding_amount || 0));
    }

    render_table() {
        const self = this;
        if (!this.contracts.length) {
            $("#contract-table-body").html('<tr><td colspan="13" class="contract-empty-cell">暂无匹配的采购合同记录</td></tr>');
            $("#contract-table-foot").empty();
            return;
        }

        const seqDigits = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

        let bodyHtml = "";
        this.contracts.forEach((c, idx) => {
            const isDraft = c.docstatus === 0;
            const statusBadge = isDraft
                ? '<span class="ashan-status-badge ashan-status-amber">草稿</span>'
                : (c.status === "已结清"
                    ? '<span class="ashan-status-badge ashan-status-green">已结清</span>'
                    : '<span class="ashan-status-badge ashan-status-blue">履约中</span>');

            // Render Compact Stepper Stream Flow
            const termsHtml = (c.payment_terms || []).map((t, tIdx) => {
                const isPaid = t.term_status === "已付清";
                const isSettled = Boolean(t.linked_reimbursement);
                const nodeCls = isPaid ? "is-paid" : (isSettled ? "is-settled" : "is-pending");
                const seqChar = seqDigits[tIdx] || `${tIdx + 1}.`;

                let actionLink = "";
                if (!isDraft && !isSettled) {
                    actionLink = `<a href="#" class="step-action-link contract-quick-rr-btn" data-contract-no="${c.contract_no}" data-term-idx="${t.idx}" data-stage-name="${frappe.utils.escape_html(t.stage_name)}" data-ratio="${t.payment_ratio}" data-amt="${t.term_amount}" data-contract-total="${c.total_contract_amount}" title="按此分期动态派生整算单">⚡ 派生整算</a>`;
                } else if (t.linked_reimbursement) {
                    actionLink = `<a href="/desk/reimbursement-picker" class="step-doc-link" title="点击穿透查看关联整算单据">${t.linked_reimbursement}</a>`;
                }

                return `
                    <div class="contract-step-node ${nodeCls}">
                        <span class="step-seq-circle">${seqChar}</span>
                        <span class="step-label-text">${frappe.utils.escape_html(t.stage_name)}</span>
                        <span class="step-ratio-pct">${t.payment_ratio}%</span>
                        <span class="step-amt-val">${format_currency(t.term_amount)}</span>
                        ${actionLink}
                    </div>
                `;
            }).join("");

            bodyHtml += `
                <tr data-contract-no="${c.contract_no}">
                    <td class="picker-col-sticky-1 text-center font-mono text-xs text-muted">${idx + 1}</td>
                    <td class="picker-col-sticky-2"><span class="picker-source-docname contract-clickable-doc" data-contract-no="${c.contract_no}">${c.contract_no}</span></td>
                    <td class="picker-col-sticky-3 font-bold text-slate-800">${frappe.utils.escape_html(c.contract_title)}</td>
                    <td>${frappe.utils.escape_html(c.supplier)}</td>
                    <td><span class="text-xs text-slate-600">${frappe.utils.escape_html(c.contract_type)}</span></td>
                    <td class="text-right font-mono font-bold text-slate-900">${format_currency(c.total_contract_amount)}</td>
                    <td class="text-right font-mono font-bold text-primary">${format_currency(c.total_settled_amount)}</td>
                    <td class="text-right font-mono font-bold text-green-600">${format_currency(c.total_paid_amount)}</td>
                    <td class="text-right font-mono font-bold ${flt(c.outstanding_amount) > 0 ? 'text-amber-600' : 'text-green-600'}">${format_currency(c.outstanding_amount)}</td>
                    <td><div class="contract-stepper-wrap">${termsHtml || '<span class="text-muted text-xs">无分期规划</span>'}</div></td>
                    <td class="font-mono text-xs text-center">${c.effective_date || '-'}</td>
                    <td class="text-center">${statusBadge}</td>
                    <td class="text-center">
                        <button type="button" class="btn btn-default btn-xs contract-view-detail-btn" data-contract-no="${c.contract_no}" title="查看合同履约台账与明细穿透">台账</button>
                        ${c.can_delete ? `<button type="button" class="btn btn-danger btn-xs contract-delete-btn contract-btn-gap" data-contract-no="${c.contract_no}" title="删除草稿合同">删除</button>` : ''}
                    </td>
                </tr>
            `;
        });

        $("#contract-table-body").html(bodyHtml);
    }

    // Modal 1: Create / Edit Procurement Contract
    open_contract_form_modal(contractNo = null) {
        const self = this;
        const draftKey = "ashan.contract-workbench.new-contract-draft";
        const savedDraft = this.load_local_draft(draftKey);
        let terms = savedDraft.terms || [];
        const selectedCompany = savedDraft.company || this.current_company;
        const companyOptions = this.allowed_companies.map((company) => {
            const selected = company === selectedCompany ? " selected" : "";
            return `<option value="${frappe.utils.escape_html(company)}"${selected}>${frappe.utils.escape_html(company)}</option>`;
        }).join("");

        const d = new frappe.ui.Dialog({
            title: __("新建采购合同 · 分期规划"),
            size: "large",
            static: true,
            fields: [
                {
                    fieldtype: "HTML",
                    fieldname: "form_html",
                }
            ],
            primary_action_label: __("保存并生效提交"),
            secondary_action_label: __("取消"),
            secondary_action: function () {
                d.hide();
            },
            primary_action: async function () {
                const company = d.$wrapper.find("#modal-contract-company").val();
                const supplier = d.$wrapper.find("#modal-contract-supplier").val();
                const title = d.$wrapper.find("#modal-contract-title").val();
                const type = d.$wrapper.find("#modal-contract-type").val();
                const totalAmt = flt(d.$wrapper.find("#modal-contract-total-amt").val());
                const effDate = d.$wrapper.find("#modal-contract-eff-date").val();
                const expDate = d.$wrapper.find("#modal-contract-exp-date").val();
                const remarks = d.$wrapper.find("#modal-contract-remarks").val();
                const autoSubmit = d.$wrapper.find("#modal-contract-auto-submit").is(":checked");

                if (!company) {
                    frappe.msgprint(__("请选择签约主体公司！"));
                    return;
                }
                if (!supplier) {
                    frappe.msgprint(__("请填写或选择供应商！"));
                    return;
                }
                if (!title) {
                    frappe.msgprint(__("请填写合同名称/标的！"));
                    return;
                }
                if (!totalAmt || totalAmt <= 0) {
                    frappe.msgprint(__("合同总金额必须大于 0！"));
                    return;
                }

                // Read terms
                const termRows = [];
                let ratioSum = 0;
                d.$wrapper.find(".contract-term-row").each(function (idx) {
                    const stage = $(this).find(".modal-term-stage").val()?.trim() || `第${idx + 1}期`;
                    const ratio = flt($(this).find(".modal-term-ratio").val());
                    const amt = flt($(this).find(".modal-term-amount").val());
                    const pDate = $(this).find(".modal-term-date").val();
                    const rem = $(this).find(".modal-term-remarks").val();

                    ratioSum += ratio;
                    termRows.push({
                        idx: idx + 1,
                        stage_name: stage,
                        payment_ratio: ratio,
                        term_amount: amt,
                        planned_date: pDate,
                        remarks: rem
                    });
                });

                if (!termRows.length) {
                    frappe.msgprint(__("请至少添加一个付款分期。"));
                    return;
                }

                if (Math.abs(ratioSum - 100.0) > 0.05) {
                    frappe.msgprint(__("各分期付款比例合计必须为 100%（当前合计为 {0}%）！", [ratioSum.toFixed(1)]));
                    return;
                }

                try {
                    frappe.dom.freeze(__("正在保存采购合同..."));
                    const r = await frappe.call({
                        method: "ashan_cn_procurement.services.contract_service.save_procurement_contract",
                        args: {
                            contract_data: JSON.stringify({
                                company: company,
                                supplier: supplier,
                                contract_title: title,
                                contract_type: type,
                                total_contract_amount: totalAmt,
                                effective_date: effDate,
                                expiry_date: expDate,
                                remarks: remarks,
                                payment_terms: termRows,
                                auto_submit: autoSubmit
                            })
                        }
                    });
                    frappe.dom.unfreeze();
                    d.hide();
                    d.$wrapper.modal("hide");
                    setTimeout(() => {
                        d.$wrapper.remove();
                        $(".modal-backdrop").remove();
                        $("body").removeClass("modal-open");
                    }, 300);
                    if (r.message && r.message.success) {
                        localStorage.removeItem(draftKey);
                        frappe.show_alert({ message: r.message.message, indicator: "green" }, 5);
                        self.load_contracts();
                    }
                } catch (e) {
                    frappe.dom.unfreeze();
                    console.error("Save contract failed:", e);
                }
            }
        });

        d.$wrapper.find(".modal-dialog").addClass("ashan-smart-modal");

        const update_term_calcs = () => {
            const totalAmt = flt(d.$wrapper.find("#modal-contract-total-amt").val());
            let sumRatio = 0;
            let sumAmt = 0;

            d.$wrapper.find(".contract-term-row").each(function () {
                const ratio = flt($(this).find(".modal-term-ratio").val());
                const calcAmt = flt(totalAmt * (ratio / 100.0), 2);
                $(this).find(".modal-term-amount").val(calcAmt);
                sumRatio += ratio;
                sumAmt += calcAmt;
            });

            d.$wrapper.find("#modal-term-sum-ratio").text(`${sumRatio.toFixed(1)}%`);
            d.$wrapper.find("#modal-term-sum-amt").text(format_currency(sumAmt));

            if (Math.abs(sumRatio - 100.0) > 0.05) {
                d.$wrapper.find("#modal-term-sum-ratio").removeClass("contract-ratio-valid").addClass("contract-ratio-invalid");
            } else {
                d.$wrapper.find("#modal-term-sum-ratio").removeClass("contract-ratio-invalid").addClass("contract-ratio-valid");
            }
        };

        const render_term_rows = () => {
            const rowsHtml = terms.map((t, idx) => `
                <div class="contract-term-row" data-idx="${idx}">
                    <input type="text" class="reim-v2-input-control modal-term-stage" value="${frappe.utils.escape_html(t.stage_name)}" placeholder="阶段说明..." />
                    <input type="number" class="reim-v2-input-control modal-term-ratio font-mono" value="${t.payment_ratio}" placeholder="%" step="5" min="1" max="100" />
                    <input type="number" class="reim-v2-input-control modal-term-amount font-mono" value="${t.term_amount}" readonly placeholder="金额 (¥)" />
                    <input type="date" class="reim-v2-input-control modal-term-date" value="${t.planned_date || ''}" />
                    <input type="text" class="reim-v2-input-control modal-term-remarks" value="${frappe.utils.escape_html(t.remarks || '')}" placeholder="阶段条款/说明..." />
                    <button type="button" class="btn btn-default btn-xs modal-term-del-btn" title="删除该阶段">✕</button>
                </div>
            `).join("");
            d.$wrapper.find("#modal-term-rows-wrap").html(rowsHtml);
            update_term_calcs();
        };

        const form_html = `
            <div class="ashan-smart-modal-body">
                <div class="ashan-smart-section">
                    <div class="ashan-smart-section-header">
                        <div class="ashan-smart-section-title">
                            <span>合同核心标的信息</span>
                        </div>
                    </div>
                    <div class="ashan-smart-grid-3">
                        <div class="reim-v2-field-group">
                            <label>签约主体公司<span class="req">*</span></label>
                            <select class="reim-v2-input-control" id="modal-contract-company">
                                <option value="">请选择签约主体公司</option>
                                ${companyOptions}
                            </select>
                        </div>
                        <div class="reim-v2-field-group">
                            <label>合作供应商 / 乙方<span class="req">*</span></label>
                            <input type="text" class="reim-v2-input-control" id="modal-contract-supplier" value="${frappe.utils.escape_html(savedDraft.supplier || "")}" placeholder="输入供应商名称..." />
                        </div>
                        <div class="reim-v2-field-group">
                            <label>合同类别<span class="req">*</span></label>
                            <select class="reim-v2-input-control" id="modal-contract-type">
                                <option value="专项采购合同">专项采购合同</option>
                                <option value="采购框架协议">采购框架协议</option>
                                <option value="委外加工合同">委外加工合同</option>
                                <option value="设备采购合同">设备采购合同</option>
                                <option value="日常物料供应合同">日常物料供应合同</option>
                            </select>
                        </div>
                    </div>

                    <div class="ashan-smart-grid-3 contract-grid-gap">
                        <div class="reim-v2-field-group contract-col-span-2">
                            <label>合同名称 / 采购标的<span class="req">*</span></label>
                            <input type="text" class="reim-v2-input-control" id="modal-contract-title" value="${frappe.utils.escape_html(savedDraft.title || "")}" placeholder="输入合同名称或采购标的" />
                        </div>
                        <div class="reim-v2-field-group">
                            <label>合同标的总额 (¥)<span class="req">*</span></label>
                            <input type="number" class="reim-v2-input-control font-mono font-bold text-primary" id="modal-contract-total-amt" value="${frappe.utils.escape_html(savedDraft.total_amount || "")}" placeholder="0.00" />
                        </div>
                    </div>

                    <div class="ashan-smart-grid-3 contract-grid-gap">
                        <div class="reim-v2-field-group">
                            <label>生效日期<span class="req">*</span></label>
                            <input type="date" class="reim-v2-input-control" id="modal-contract-eff-date" value="${frappe.datetime.get_today()}" />
                        </div>
                        <div class="reim-v2-field-group">
                            <label>到期日期</label>
                            <input type="date" class="reim-v2-input-control" id="modal-contract-exp-date" />
                        </div>
                        <div class="reim-v2-field-group contract-auto-submit-wrap">
                            <label class="contract-auto-submit-label">
                                <input type="checkbox" id="modal-contract-auto-submit" checked />
                                <span class="font-bold text-slate-800">保存并直接生效提交 (推荐)</span>
                            </label>
                        </div>
                    </div>
                </div>

                <!-- Section: Payment Milestones -->
                <div class="ashan-smart-section contract-section-gap">
                    <div class="ashan-smart-section-header contract-header-space-between">
                        <div class="ashan-smart-section-title">
                            <span>分期付款里程碑规划 (各项比例合计需为 100%)</span>
                        </div>
                        <div class="contract-flex-gap">
                            <button type="button" class="btn btn-primary btn-xs" id="modal-add-term-btn">添加分期</button>
                        </div>
                    </div>

                    <div class="contract-term-header">
                        <div>分期阶段名称</div>
                        <div>付款比例 (%)</div>
                        <div>期款金额 (¥)</div>
                        <div>计划付款日期</div>
                        <div>阶段说明</div>
                        <div></div>
                    </div>

                    <div id="modal-term-rows-wrap"></div>

                    <div class="contract-term-summary-bar">
                        <span>比例与金额守恒核算:</span>
                        <span>比例合计: <strong id="modal-term-sum-ratio" class="font-mono">100.0%</strong> ｜ 金额合计: <strong id="modal-term-sum-amt" class="font-mono text-primary">¥ 0.00</strong></span>
                    </div>
                </div>
            </div>
        `;

        d.set_value("form_html", form_html);
        d.show();
        render_term_rows();

        const saveDraft = () => {
            self.save_local_draft(draftKey, {
                company: d.$wrapper.find("#modal-contract-company").val(),
                supplier: d.$wrapper.find("#modal-contract-supplier").val(),
                title: d.$wrapper.find("#modal-contract-title").val(),
                total_amount: d.$wrapper.find("#modal-contract-total-amt").val(),
                terms: terms,
            });
        };

        // Bind dialog inner events
        d.$wrapper.on("input change", "#modal-contract-total-amt, #modal-contract-company, #modal-contract-supplier, #modal-contract-title, .modal-term-row input", function () {
            d.$wrapper.find(".contract-term-row").each(function () {
                const index = $(this).data("idx");
                terms[index] = {
                    stage_name: $(this).find(".modal-term-stage").val()?.trim() || "",
                    payment_ratio: flt($(this).find(".modal-term-ratio").val()),
                    term_amount: flt($(this).find(".modal-term-amount").val()),
                    planned_date: $(this).find(".modal-term-date").val() || "",
                    remarks: $(this).find(".modal-term-remarks").val() || "",
                };
            });
            update_term_calcs();
            saveDraft();
        });

        d.$wrapper.on("click", "#modal-add-term-btn", function () {
            terms.push({ stage_name: `第${terms.length + 1}期款`, payment_ratio: 0, term_amount: 0, planned_date: "", remarks: "" });
            render_term_rows();
            saveDraft();
        });

        d.$wrapper.on("click", ".modal-term-del-btn", function () {
            const idx = $(this).closest(".contract-term-row").data("idx");
            terms.splice(idx, 1);
            render_term_rows();
            saveDraft();
        });
    }

    load_local_draft(key) {
        try {
            return JSON.parse(localStorage.getItem(key) || "{}") || {};
        } catch (error) {
            console.warn("Ignoring invalid contract draft cache:", error);
            return {};
        }
    }

    save_local_draft(key, draft) {
        localStorage.setItem(key, JSON.stringify(draft));
    }

    // Modal 2: Generate Reimbursement Request from Contract Milestone (Dynamic Custom Ratio Engine)
    open_milestone_settlement_modal(contractNo, termIdx, stageName, plannedRatio, plannedAmount, contractTotal) {
        const self = this;
        const totalContract = flt(contractTotal) || (flt(plannedAmount) / (flt(plannedRatio) / 100.0));
        let currentSettleAmt = flt(plannedAmount);
        let currentSettleRatio = flt(plannedRatio);

        const d = new frappe.ui.Dialog({
            title: __("根据合同分期派生电汇整算单 · 智能比例动态核算"),
            size: "large",
            static: true,
            fields: [
                {
                    fieldtype: "HTML",
                    fieldname: "milestone_info_html",
                },
                {
                    fieldname: "posting_date",
                    label: __("整算日期"),
                    fieldtype: "Date",
                    default: frappe.datetime.get_today(),
                    reqd: 1,
                },
                {
                    fieldname: "invoice_type",
                    label: __("发票类型"),
                    fieldtype: "Select",
                    options: ["专用发票", "普通发票", "无发票"],
                    default: "专用发票",
                    reqd: 1,
                },
                {
                    fieldname: "invoice_no",
                    label: __("发票号码 (选填，留空自动生成)"),
                    fieldtype: "Data",
                    placeholder: "例如：FP-HT-2026-001",
                },
                {
                    fieldname: "remarks",
                    label: __("整算备注说明"),
                    fieldtype: "Small Text",
                    default: `依据采购合同【${contractNo}】第 ${termIdx} 期（${stageName}）派生电汇整算`,
                },
                {
                    fieldname: "auto_submit",
                    label: __("直接过账提交并生效整算单 (推荐)"),
                    fieldtype: "Check",
                    default: 1,
                }
            ],
            primary_action_label: __("确认派生整算单"),
            secondary_action_label: __("取消"),
            secondary_action: function () {
                d.hide();
            },
            primary_action: async function (values) {
                try {
                    const customAmt = flt(d.$wrapper.find("#dynamic-settle-amt-input").val());
                    const customRatio = flt(d.$wrapper.find("#dynamic-settle-ratio-input").val());

                    if (!customAmt || customAmt <= 0) {
                        frappe.msgprint(__("派生整算金额必须大于 0！"));
                        return;
                    }

                    frappe.dom.freeze(__("正在根据合同分期派生整算单..."));
                    const r = await frappe.call({
                        method: "ashan_cn_procurement.services.contract_service.create_settlement_from_milestone",
                        args: {
                            contract_no: contractNo,
                            term_idx: termIdx,
                            posting_date: values.posting_date,
                            invoice_no: values.invoice_no,
                            invoice_type: values.invoice_type,
                            custom_amount: customAmt,
                            custom_ratio: customRatio,
                            remarks: values.remarks,
                            auto_submit: values.auto_submit
                        }
                    });
                    frappe.dom.unfreeze();
                    d.hide();
                    d.$wrapper.modal("hide");
                    setTimeout(() => {
                        d.$wrapper.remove();
                        $(".modal-backdrop").remove();
                        $("body").removeClass("modal-open");
                    }, 300);
                    if (r.message && r.message.success) {
                        frappe.show_alert({
                            message: r.message.message || __("电汇整算单派生成功！"),
                            indicator: "green",
                        }, 6);
                        self.load_contracts();
                    }
                } catch (e) {
                    frappe.dom.unfreeze();
                    console.error("Create settlement from milestone failed:", e);
                }
            }
        });

        d.$wrapper.find(".modal-dialog").addClass("ashan-smart-modal");

        const update_dynamic_calculations = () => {
            const remainInTerm = Math.max(0, flt(plannedAmount) - flt(currentSettleAmt));
            const netAmt = values_invoice_type === "专用发票" ? flt(currentSettleAmt / 1.13, 2) : currentSettleAmt;
            const taxAmt = values_invoice_type === "专用发票" ? flt(currentSettleAmt - netAmt, 2) : 0.0;

            d.$wrapper.find("#calc-term-remain").text(format_currency(remainInTerm));
            d.$wrapper.find("#calc-net-amt").text(format_currency(netAmt));
            d.$wrapper.find("#calc-tax-amt").text(format_currency(taxAmt));
            d.$wrapper.find("#calc-eff-pct").text(`${currentSettleRatio.toFixed(1)}%`);
        };

        let values_invoice_type = "专用发票";

        const info_html = `
            <div class="contract-dynamic-calc-box">
                <div class="ashan-smart-grid-3">
                    <div><span class="text-xs text-muted">采购合同:</span> <span class="font-mono text-primary font-bold">${frappe.utils.escape_html(contractNo)}</span></div>
                    <div><span class="text-xs text-muted">分期阶段:</span> <span class="font-bold text-slate-800">${frappe.utils.escape_html(stageName)} (规划 ${plannedRatio}%)</span></div>
                    <div><span class="text-xs text-muted">本期规划总额:</span> <span class="font-mono text-slate-900 font-bold">${format_currency(plannedAmount)}</span></div>
                </div>

                <!-- Smart Percentage / Custom Amount Selector -->
                <div class="ashan-section-gap">
                    <label class="text-xs font-bold text-slate-700">选择或输入本次整算比例 / 自定义金额 (动态实时双向换算):</label>
                    <div class="ashan-percent-pill-group contract-grid-gap">
                        <button type="button" class="ashan-percent-pill" data-pct="20">20% 预付</button>
                        <button type="button" class="ashan-percent-pill" data-pct="30">30% 进度</button>
                        <button type="button" class="ashan-percent-pill" data-pct="50">50% 中期</button>
                        <button type="button" class="ashan-percent-pill" data-pct="80">80% 阶段</button>
                        <button type="button" class="ashan-percent-pill active" data-pct="${plannedRatio}">本期全额 (${plannedRatio}%)</button>
                        <button type="button" class="ashan-percent-pill" data-pct="custom">自定义输入</button>
                    </div>

                    <div class="contract-calc-row">
                        <div>
                            <label class="text-xs font-bold text-slate-700">本次派生整算金额 (¥)*</label>
                            <input type="number" class="reim-v2-input-control font-mono font-bold text-primary" id="dynamic-settle-amt-input" value="${currentSettleAmt.toFixed(2)}" step="100" />
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-700">占合同总标的比例 (%)*</label>
                            <input type="number" class="reim-v2-input-control font-mono font-bold" id="dynamic-settle-ratio-input" value="${currentSettleRatio.toFixed(1)}" step="1" min="0.1" max="100" />
                        </div>
                    </div>
                </div>

                <!-- Dynamic Real-Time Metric Cards -->
                <div class="ashan-smart-grid-4 contract-grid-gap">
                    <div class="contract-calc-metric">
                        <div class="contract-calc-metric-lbl">不含税金额 (Net)</div>
                        <div class="contract-calc-metric-val" id="calc-net-amt">¥ 0.00</div>
                    </div>
                    <div class="contract-calc-metric">
                        <div class="contract-calc-metric-lbl">增值税额 (Tax)</div>
                        <div class="contract-calc-metric-val text-primary" id="calc-tax-amt">¥ 0.00</div>
                    </div>
                    <div class="contract-calc-metric">
                        <div class="contract-calc-metric-lbl">本期剩余未整算额</div>
                        <div class="contract-calc-metric-val text-amber" id="calc-term-remain">¥ 0.00</div>
                    </div>
                    <div class="contract-calc-metric">
                        <div class="contract-calc-metric-lbl">本次实际整算比例</div>
                        <div class="contract-calc-metric-val text-green" id="calc-eff-pct">${currentSettleRatio.toFixed(1)}%</div>
                    </div>
                </div>
            </div>
        `;

        d.set_value("milestone_info_html", info_html);
        d.show();
        update_dynamic_calculations();

        // Bind interactive bidirectional changes
        d.$wrapper.on("click", ".ashan-percent-pill", function () {
            d.$wrapper.find(".ashan-percent-pill").removeClass("active");
            $(this).addClass("active");
            const pct = $(this).data("pct");
            if (pct !== "custom") {
                currentSettleRatio = flt(pct);
                currentSettleAmt = flt(totalContract * (currentSettleRatio / 100.0), 2);
                d.$wrapper.find("#dynamic-settle-ratio-input").val(currentSettleRatio.toFixed(1));
                d.$wrapper.find("#dynamic-settle-amt-input").val(currentSettleAmt.toFixed(2));
                update_dynamic_calculations();
            }
        });

        // When amount changed, dynamically calculate ratio
        d.$wrapper.on("input change", "#dynamic-settle-amt-input", function () {
            currentSettleAmt = flt($(this).val());
            currentSettleRatio = totalContract > 0 ? flt((currentSettleAmt / totalContract) * 100.0, 2) : 0;
            d.$wrapper.find("#dynamic-settle-ratio-input").val(currentSettleRatio.toFixed(1));
            d.$wrapper.find(".ashan-percent-pill").removeClass("active");
            d.$wrapper.find('.ashan-percent-pill[data-pct="custom"]').addClass("active");
            update_dynamic_calculations();
        });

        // When ratio changed, dynamically calculate amount
        d.$wrapper.on("input change", "#dynamic-settle-ratio-input", function () {
            currentSettleRatio = flt($(this).val());
            currentSettleAmt = flt(totalContract * (currentSettleRatio / 100.0), 2);
            d.$wrapper.find("#dynamic-settle-amt-input").val(currentSettleAmt.toFixed(2));
            d.$wrapper.find(".ashan-percent-pill").removeClass("active");
            d.$wrapper.find('.ashan-percent-pill[data-pct="custom"]').addClass("active");
            update_dynamic_calculations();
        });

        // Track invoice type select change
        d.fields_dict.invoice_type.$input.on("change", function () {
            values_invoice_type = $(this).val();
            update_dynamic_calculations();
        });
    }

    // Modal 3: View Contract Ledger & Full Audit Trail
    async open_contract_detail_modal(contractNo) {
        try {
            frappe.dom.freeze(__("正在加载合同履约台账..."));
            const r = await frappe.call({
                method: "ashan_cn_procurement.services.contract_service.get_contract_detail",
                args: { contract_no: contractNo }
            });
            frappe.dom.unfreeze();

            if (!r.message || !r.message.contract) return;
            const c = r.message.contract;
            const rrs = r.message.linked_reimbursements || [];

            const totalAmt = flt(c.total_contract_amount) || 1.0;
            const paidAmt = flt(c.total_paid_amount);
            const settledAmt = flt(c.total_settled_amount);
            const outAmt = flt(c.outstanding_amount);

            const paidPct = Math.min(100, Math.max(0, (paidAmt / totalAmt) * 100));
            const settledOnlyPct = Math.min(100 - paidPct, Math.max(0, ((settledAmt - paidAmt) / totalAmt) * 100));
            const remainPct = Math.max(0, 100 - paidPct - settledOnlyPct);

            const seqDigits = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

            const termsRows = (c.payment_terms || []).map((t, idx) => {
                const isPaid = t.term_status === "已付清";
                const isSettled = Boolean(t.linked_reimbursement);
                const statusBadge = isPaid
                    ? '<span class="ashan-status-badge ashan-status-green">已付清</span>'
                    : (isSettled ? '<span class="ashan-status-badge ashan-status-blue">整算中</span>' : '<span class="ashan-status-badge ashan-status-amber">待发起</span>');
                const seqChar = seqDigits[idx] || `${idx + 1}.`;

                const linkBadge = t.linked_reimbursement
                    ? `<a href="/desk/reimbursement-picker" class="step-doc-link" title="点击穿透查看关联整算单据">${t.linked_reimbursement}</a>`
                    : '<span class="text-muted text-xs">-</span>';

                return `
                    <tr>
                        <td class="text-center font-mono font-bold text-slate-600">${seqChar}</td>
                        <td class="font-bold text-slate-900">${frappe.utils.escape_html(t.stage_name)}</td>
                        <td class="text-right font-mono font-bold text-slate-700">${t.payment_ratio}%</td>
                        <td class="text-right font-mono font-bold text-slate-900">${format_currency(t.term_amount)}</td>
                        <td class="text-right font-mono text-green-600 font-bold">${format_currency(t.paid_amount)}</td>
                        <td class="text-right font-mono text-amber-600 font-bold">${format_currency(t.outstanding_amount)}</td>
                        <td class="text-center font-mono text-xs text-slate-600">${t.planned_date || '-'}</td>
                        <td class="text-center">${linkBadge}</td>
                        <td class="text-center">${statusBadge}</td>
                    </tr>
                `;
            }).join("");

            let rrContentHtml = "";
            if (rrs && rrs.length > 0) {
                const rrRows = rrs.map((rr, idx) => `
                    <tr>
                        <td class="text-center font-mono text-xs font-bold text-slate-600">${idx + 1}</td>
                        <td class="font-mono font-bold"><a href="/desk/reimbursement-picker" class="step-doc-link">${rr.name}</a></td>
                        <td class="font-bold text-slate-800">${frappe.utils.escape_html(rr.title || '-')}</td>
                        <td class="font-mono text-xs text-slate-600">${rr.posting_date || '-'}</td>
                        <td class="text-right font-mono font-bold text-slate-900">${format_currency(rr.total_amount)}</td>
                        <td class="text-right font-mono font-bold ${flt(rr.outstanding_amount) > 0 ? 'text-amber-600' : 'text-green-600'}">${format_currency(rr.outstanding_amount)}</td>
                        <td class="text-center"><span class="ashan-status-badge ${rr.docstatus === 1 ? 'ashan-status-green' : 'ashan-status-amber'}">${rr.docstatus === 1 ? '已过账' : '草稿'}</span></td>
                    </tr>
                `).join("");

                rrContentHtml = `
                    <div class="ashan-smart-table-wrap">
                        <table class="contract-ledger-table">
                            <thead>
                                <tr>
                                    <th class="col-w-seq text-center">#</th>
                                    <th>整算单号</th>
                                    <th>整算标题 / 说明</th>
                                    <th>业务日期</th>
                                    <th class="text-right">整算金额</th>
                                    <th class="text-right">待结款金额</th>
                                    <th class="text-center">单据状态</th>
                                </tr>
                            </thead>
                            <tbody>${rrRows}</tbody>
                        </table>
                    </div>
                `;
            } else {
                rrContentHtml = `
                    <div class="contract-ledger-empty-box">
                        暂无关联派生的电汇整算单据。当针对上方分期节点发起【⚡ 派生整算】后，对应单据将自动归集于此。
                    </div>
                `;
            }

            const d = new frappe.ui.Dialog({
                title: __("采购合同台账 · {0}", [c.name]),
                size: "large",
                fields: [
                    {
                        fieldtype: "HTML",
                        fieldname: "ledger_html",
                        options: `
                            <div class="ashan-smart-modal-body">
                                <div class="contract-detail-header-card">
                                    <div class="contract-detail-title-row">
                                        <div class="contract-detail-title-text">
                                            <span>${frappe.utils.escape_html(c.contract_title)}</span>
                                            <span class="ashan-status-badge ${c.status === '已结清' ? 'ashan-status-green' : 'ashan-status-blue'}">${c.status}</span>
                                        </div>
                                    </div>
                                    <div class="ashan-smart-grid-3">
                                        <div><span class="text-xs text-muted">签约主体:</span> <strong class="text-slate-800">${frappe.utils.escape_html(c.company)}</strong></div>
                                        <div><span class="text-xs text-muted">合作供应商:</span> <strong class="text-slate-800">${frappe.utils.escape_html(c.supplier)}</strong></div>
                                        <div><span class="text-xs text-muted">合同类别:</span> <strong class="text-slate-800">${frappe.utils.escape_html(c.contract_type || '专项采购合同')}</strong></div>
                                    </div>

                                    <!-- Structured KPI Bar -->
                                    <div class="contract-ledger-kpi-bar">
                                        <div class="contract-ledger-metric-card">
                                            <div class="contract-ledger-metric-title">合同标的总额 (100%)</div>
                                            <div class="contract-ledger-metric-number">${format_currency(c.total_contract_amount)}</div>
                                        </div>
                                        <div class="contract-ledger-metric-card">
                                            <div class="contract-ledger-metric-title">累计已整算 (${((settledAmt/totalAmt)*100).toFixed(1)}%)</div>
                                            <div class="contract-ledger-metric-number text-primary">${format_currency(c.total_settled_amount)}</div>
                                        </div>
                                        <div class="contract-ledger-metric-card">
                                            <div class="contract-ledger-metric-title">实际已出账付款 (${paidPct.toFixed(1)}%)</div>
                                            <div class="contract-ledger-metric-number text-green-600">${format_currency(c.total_paid_amount)}</div>
                                        </div>
                                        <div class="contract-ledger-metric-card">
                                            <div class="contract-ledger-metric-title">履约待付余额 (${((outAmt/totalAmt)*100).toFixed(1)}%)</div>
                                            <div class="contract-ledger-metric-number text-amber-600">${format_currency(c.outstanding_amount)}</div>
                                        </div>
                                    </div>

                                    <!-- Triple-Segment Progress Bar -->
                                    <div class="contract-ledger-progress-wrap">
                                        <div class="contract-progress-segment-paid"></div>
                                        <div class="contract-progress-segment-settled"></div>
                                    </div>
                                    <div class="contract-progress-legend">
                                        <span><span class="contract-legend-dot legend-dot-paid"></span>实际已付款: ${format_currency(paidAmt)} (${paidPct.toFixed(1)}%)</span>
                                        <span><span class="contract-legend-dot legend-dot-settled"></span>整算待付款: ${format_currency(Math.max(0, settledAmt - paidAmt))} (${settledOnlyPct.toFixed(1)}%)</span>
                                        <span><span class="contract-legend-dot legend-dot-remain"></span>未整算额: ${format_currency(Math.max(0, totalAmt - settledAmt))} (${remainPct.toFixed(1)}%)</span>
                                    </div>
                                </div>

                                <div class="ashan-smart-section contract-section-gap">
                                    <div class="ashan-smart-section-header">
                                        <div class="ashan-smart-section-title">
                                            <span>分期付款里程碑执行明细</span>
                                        </div>
                                    </div>
                                    <div class="ashan-smart-table-wrap">
                                        <table class="contract-ledger-table">
                                            <thead>
                                                <tr>
                                                    <th class="col-w-seq text-center">#</th>
                                                    <th>阶段名称</th>
                                                    <th class="text-right">比例</th>
                                                    <th class="text-right">期款应付</th>
                                                    <th class="text-right">已付款</th>
                                                    <th class="text-right">待付款</th>
                                                    <th class="text-center">计划付款日</th>
                                                    <th class="text-center">关联整算单</th>
                                                    <th class="text-center">状态</th>
                                                </tr>
                                            </thead>
                                            <tbody>${termsRows}</tbody>
                                        </table>
                                    </div>
                                </div>

                                <div class="ashan-smart-section contract-section-gap">
                                    <div class="ashan-smart-section-header">
                                        <div class="ashan-smart-section-title">
                                            <span>关联派生的电汇整算单据</span>
                                        </div>
                                    </div>
                                    ${rrContentHtml}
                                </div>
                            </div>
                        `
                    }
                ],
                secondary_action_label: __("关闭"),
                secondary_action: function () {
                    d.hide();
                }
            });

            d.$wrapper.find(".modal-dialog").addClass("ashan-smart-modal");
            d.show();

            // Set progress bar dynamic widths smoothly
            d.$wrapper.find(".contract-progress-segment-paid").css("width", `${paidPct}%`);
            d.$wrapper.find(".contract-progress-segment-settled").css("width", `${settledOnlyPct}%`);
        } catch (e) {
            frappe.dom.unfreeze();
            console.error("Open contract detail modal failed:", e);
        }
    }

    // Delete Draft Contract
    confirm_delete_contract(contractNo) {
        const self = this;
        frappe.confirm(
            __("确定要删除草稿采购合同 <strong>{0}</strong> 吗？", [contractNo]),
            async function () {
                try {
                    frappe.dom.freeze(__("正在删除草稿合同..."));
                    const r = await frappe.call({
                        method: "ashan_cn_procurement.services.contract_service.delete_procurement_contract",
                        args: { contract_no: contractNo }
                    });
                    frappe.dom.unfreeze();
                    if (r.message && r.message.success) {
                        frappe.show_alert({ message: __("草稿合同已成功删除！"), indicator: "green" });
                        self.load_contracts();
                    }
                } catch (e) {
                    frappe.dom.unfreeze();
                    console.error("Delete contract failed:", e);
                }
            }
        );
    }
}
