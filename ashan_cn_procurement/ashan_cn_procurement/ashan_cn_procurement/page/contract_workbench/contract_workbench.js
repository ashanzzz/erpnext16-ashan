function format_contract_money(val) {
    if (window.AshanUI && typeof window.AshanUI.formatMoney === "function") {
        return window.AshanUI.formatMoney(val);
    }
    const num = Number(val) || 0;
    return '¥ ' + num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function get_default_contract_expiry() {
    if (window.AshanUI && typeof window.AshanUI.getNextMonthSameDay === "function") {
        return window.AshanUI.getNextMonthSameDay();
    }
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}
// Copyright (c) 2026, Ashan and contributors
// For license information, please see license.txt

frappe.pages["contract-workbench"].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __("采购合同"),
        single_column: true,
    });
    $(page.wrapper).find(".page-head").hide();
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
        this.page.set_title(__("采购合同履约工作台"));
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
            <div class="picker-page-container contract-workbench-container">
                <!-- Top Header (Unified Unboxed Standard) -->
                <div class="picker-top-bar ashan-clean-title-bar">
                    <div class="picker-title-group">
                        <h2>采购合同</h2>
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
                        <div class="contract-kpi-label">单据总额</div>
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
                        <div class="contract-kpi-label">待付金额</div>
                        <div class="contract-kpi-val text-amber" id="kpi-contract-out-amt">¥ 0.00</div>
                        <div class="contract-kpi-sub">剩余应付</div>
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
                </div>

                <!-- Action Bar -->
                <div class="picker-action-bar contract-action-bar">
                    <div class="picker-summary-text contract-summary-text">
                        <span class="ashan-sel-pill">
                            <span>合同总数</span>
                            <span class="ashan-sel-count picker-summary-highlight" id="kpi-contract-action-count">0</span>
                            <span>份</span>
                        </span>
                    </div>
                    <div class="picker-btn-group contract-btn-group">
                        <button type="button" class="ashan-btn-secondary" id="contract-refresh-btn">刷新</button>
                        <button type="button" class="ashan-btn-primary" id="contract-create-btn">新建采购合同</button>
                    </div>
                </div>

                <!-- Contracts Table View with Clean Single-line Table Header & Colgroup -->
                <div class="picker-table-wrapper contract-table-wrap">
                    <table class="picker-data-table contract-main-table" id="contract-data-table">
                        <colgroup>
                            <col class="col-w-seq">
                            <col class="col-w-company-badge">
                            <col class="col-w-docname">
                            <col class="col-w-date">
                            <col class="col-w-status">
                            <col class="col-w-supplier">
                            <col class="contract-col-w120">
                            <col class="contract-col-w220 col-w-fluid">
                            <col class="contract-col-w140">
                            <col class="contract-col-w140">
                            <col class="contract-col-w140">
                            <col class="contract-col-w140">
                            <col class="contract-col-w360">
                            <col class="col-w-user">
                            <col class="col-w-action">
                        </colgroup>
                        <thead>
                            <tr>
                                <th class="picker-col-sticky-1 col-w-seq text-center">#</th>
                                <th class="picker-col-company-sticky col-w-company-badge text-center">所属公司</th>
                                <th class="picker-col-sticky-2 col-w-docname">单据编号</th>
                                <th class="col-w-date text-center">单据日期</th>
                                <th class="col-w-status text-center">单据状态</th>
                                <th class="col-w-supplier">供应商</th>
                                <th class="contract-col-w120">合同类别</th>
                                <th class="contract-col-w220 col-w-fluid">单据明细</th>
                                <th class="text-right contract-col-w140">合同总额</th>
                                <th class="text-right contract-col-w140">已整算金额</th>
                                <th class="text-right contract-col-w140">已付金额</th>
                                <th class="text-right contract-col-w140">待付金额</th>
                                <th class="contract-col-w360">分期付款里程碑规划与整算派生</th>
                                <th class="col-w-user text-center">制单人</th>
                                <th class="col-w-action text-center">操作</th>
                            </tr>
                        </thead>
                        <tbody id="contract-table-body">
                            <tr><td colspan="15" class="contract-loading-cell">正在加载合同数据...</td></tr>
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

        // Create contract button
        this.page.main.on("click", "#contract-create-btn", function () {
            self.open_contract_form_modal();
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

        // Edit draft or unsettled contract
        this.page.main.on("click", ".contract-edit-btn", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const contractNo = $(this).data("contract-no");
            self.open_contract_form_modal(contractNo);
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
        $("#kpi-contract-total-amt").text(format_contract_money(k.total_contract_amount || 0));
        $("#kpi-contract-settled-amt").text(format_contract_money(k.total_settled_amount || 0));
        $("#kpi-contract-paid-amt").text(format_contract_money(k.total_paid_amount || 0));
        $("#kpi-contract-out-amt").text(format_contract_money(k.outstanding_amount || 0));
    }

    render_table() {
        const self = this;
        if (!this.contracts.length) {
            $("#contract-table-body").html('<tr><td colspan="15" class="contract-empty-cell">暂无匹配的采购合同记录</td></tr>');
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
                    actionLink = `<a href="#" class="step-action-link contract-quick-rr-btn" data-contract-no="${c.contract_no}" data-term-idx="${t.idx}" data-stage-name="${frappe.utils.escape_html(t.stage_name)}" data-ratio="${t.payment_ratio}" data-amt="${t.term_amount}" data-contract-total="${c.total_contract_amount}" title="按此分期动态派生整算单">派生整算</a>`;
                } else if (t.linked_reimbursement) {
                    actionLink = `<a href="/desk/reimbursement-picker" class="step-doc-link" title="点击穿透查看关联整算单据">${t.linked_reimbursement}</a>`;
                }

                return `
                    <div class="contract-step-node ${nodeCls}">
                        <span class="step-seq-circle">${seqChar}</span>
                        <span class="step-label-text">${frappe.utils.escape_html(t.stage_name)}</span>
                        <span class="step-ratio-pct">${t.payment_ratio}%</span>
                        <span class="step-amt-tag">¥${format_contract_money(t.term_amount)}</span>
                        ${actionLink}
                    </div>
                `;
            }).join("");

            const canEdit = isDraft || (flt(c.total_settled_amount) <= 0.0001 && flt(c.total_paid_amount) <= 0.0001);
            const comp_short = (c.company || "").includes("祺富") ? "祺富" : ((c.company || "").includes("吉众") ? "吉众" : (c.company || ""));
            const comp_cls = (c.company || "").includes("祺富") ? "picker-company-badge-qifu" : "picker-company-badge-jizhong";

            bodyHtml += `
                <tr data-contract-no="${c.contract_no}">
                    <td class="picker-col-sticky-1 text-center font-mono text-xs text-muted">${idx + 1}</td>
                    <td class="picker-col-company-sticky text-center">
                        <span class="picker-company-badge ${comp_cls}">${frappe.utils.escape_html(comp_short)}</span>
                    </td>
                    <td class="picker-col-sticky-2"><span class="picker-source-docname contract-clickable-doc" data-contract-no="${c.contract_no}">${c.contract_no}</span></td>
                    <td class="col-w-date font-mono text-xs text-center">${c.effective_date || '-'}</td>
                    <td class="col-w-status text-center">${statusBadge}</td>
                    <td class="col-w-supplier">${frappe.utils.escape_html(c.supplier)}</td>
                    <td><span class="text-xs text-slate-600">${frappe.utils.escape_html(c.contract_type)}</span></td>
                    <td class="contract-col-w220 col-w-fluid font-bold text-slate-800">${frappe.utils.escape_html(c.contract_title)}</td>
                    <td class="text-right font-mono font-bold text-slate-900">${format_contract_money(c.total_contract_amount)}</td>
                    <td class="text-right font-mono font-bold text-primary">${format_contract_money(c.total_settled_amount)}</td>
                    <td class="text-right font-mono font-bold text-green-600">${format_contract_money(c.total_paid_amount)}</td>
                    <td class="text-right font-mono font-bold ${flt(c.outstanding_amount) > 0 ? 'text-amber-600' : 'text-green-600'}">${format_contract_money(c.outstanding_amount)}</td>
                    <td><div class="contract-stepper-wrap">${termsHtml || '<span class="text-muted text-xs">无分期规划</span>'}</div></td>
                    <td class="col-w-user text-center text-xs text-slate-700">${window.AshanUI ? window.AshanUI.formatUser(c.owner) : (c.owner || '-')}</td>
                    <td class="col-w-action text-center">
                        <button type="button" class="ashan-btn-row-action contract-view-detail-btn" data-contract-no="${c.contract_no}" title="查看合同履约台账与明细穿透">台账</button>
                        ${canEdit ? `<button type="button" class="ashan-btn-row-action contract-edit-btn contract-btn-gap" data-contract-no="${c.contract_no}" title="修改采购合同分期规划">修改</button>` : ''}
                        ${c.can_delete ? `<button type="button" class="ashan-btn-row-del contract-delete-btn contract-btn-gap" data-contract-no="${c.contract_no}" title="删除草稿合同">删除</button>` : ''}
                    </td>
                </tr>
            `;
        });

        $("#contract-table-body").html(bodyHtml);
    }

    // Modal 1: Create / Edit Procurement Contract
    open_contract_form_modal(contractNo = null) {
        const self = this;
        const existingContract = contractNo ? (this.contracts || []).find((x) => x.contract_no === contractNo) : null;
        const isEdit = Boolean(existingContract);
        const draftKey = "ashan.contract-workbench.new-contract-draft";
        const savedDraft = isEdit ? {} : this.load_local_draft(draftKey);
        let terms = isEdit ? (existingContract.payment_terms || []) : (savedDraft.terms || []);
        if (!terms || !terms.length) {
            terms = [
                { stage_name: "首期预付款", payment_ratio: 30, term_amount: 0, planned_date: "", remarks: "合同签订后支付" },
                { stage_name: "到货验收进度款", payment_ratio: 60, term_amount: 0, planned_date: "", remarks: "到货初检合格后支付" },
                { stage_name: "质保尾款 (1年)", payment_ratio: 10, term_amount: 0, planned_date: "", remarks: "质保期满无异议后结清" },
            ];
        }
        const selectedCompany = isEdit ? existingContract.company : (savedDraft.company || this.current_company);
        const selectedSupplier = isEdit ? (existingContract.supplier || "") : (savedDraft.supplier || "");
        const selectedTitle = isEdit ? (existingContract.contract_title || "") : (savedDraft.title || "");
        const selectedType = isEdit ? (existingContract.contract_type || "专项采购合同") : "专项采购合同";
        const selectedTotalAmt = isEdit ? (existingContract.total_contract_amount || "") : (savedDraft.total_amount || "");
        const selectedEffDate = isEdit ? (existingContract.effective_date || frappe.datetime.get_today()) : frappe.datetime.get_today();
        const selectedExpDate = isEdit ? (existingContract.expiry_date || "") : (savedDraft.expiry_date || get_default_contract_expiry());
        const selectedRemarks = isEdit ? (existingContract.remarks || "") : "";

        const companyOptions = this.allowed_companies.map((company) => {
            const selected = company === selectedCompany ? " selected" : "";
            return `<option value="${frappe.utils.escape_html(company)}"${selected}>${frappe.utils.escape_html(company)}</option>`;
        }).join("");

        const d = new frappe.ui.Dialog({
            title: isEdit ? __("修改采购合同 · {0}", [contractNo]) : __("新建采购合同 · 分期规划"),
            size: "large",
            static: true,
            fields: [
                {
                    fieldtype: "HTML",
                    fieldname: "form_html",
                }
            ],
            primary_action_label: isEdit ? __("保存修改并生效") : __("保存并生效提交"),
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
                                contract_no: contractNo,
                                company: company,
                                supplier: supplier,
                                contract_title: title,
                                contract_type: type,
                                total_contract_amount: totalAmt,
                                effective_date: effDate,
                                expiry_date: expDate,
                                remarks: remarks,
                                payment_terms: termRows,
                                auto_submit: isEdit ? true : autoSubmit
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
                        if (!isEdit) localStorage.removeItem(draftKey);
                        frappe.show_alert({ message: r.message.message, indicator: "green" }, 5);
                        self.load_contracts();
                    }
                } catch (e) {
                    frappe.dom.unfreeze();
                    console.error("Save contract failed:", e);
                }
            }
        });

        d.$wrapper.addClass("picker-create-mr-modal");

        const update_term_calcs = () => {
            const totalAmt = flt(d.$wrapper.find("#modal-contract-total-amt").val());
            let sumRatio = 0;
            let sumAmt = 0;

            d.$wrapper.find(".contract-term-row").each(function () {
                const ratio = flt($(this).find(".modal-term-ratio").val());
                const calcAmt = flt(totalAmt * (ratio / 100.0), 2);
                $(this).find(".modal-term-amount").val(calcAmt.toFixed(2));
                sumRatio += ratio;
                sumAmt += calcAmt;
            });

            const isBalanced = Math.abs(sumRatio - 100.0) <= 0.05;
            d.$wrapper.find("#modal-term-sum-ratio").text(`${sumRatio.toFixed(1)}%`);
            d.$wrapper.find("#modal-term-sum-amt").text(format_contract_money(sumAmt));

            if (isBalanced) {
                d.$wrapper.find("#modal-term-sum-ratio").removeClass("ashan-foot-invalid").addClass("ashan-foot-valid");
                d.$wrapper.find("#modal-term-balance-status").html('<span class="ashan-status-badge ashan-status-green">比例完整 (100.0%)</span>');
            } else {
                d.$wrapper.find("#modal-term-sum-ratio").removeClass("ashan-foot-valid").addClass("ashan-foot-invalid");
                d.$wrapper.find("#modal-term-balance-status").html(`<span class="ashan-status-badge ashan-status-amber">未满 100% (尚差 ${(100.0 - sumRatio).toFixed(1)}%)</span>`);
            }
        };

        const render_term_rows = () => {
            const rowsHtml = terms.map((t, idx) => `
                <tr class="contract-term-row" data-idx="${idx}">
                    <td class="picker-modal-cell-center font-mono font-bold text-muted">${idx + 1}</td>
                    <td><input type="text" class="modal-input-name modal-term-stage" value="${frappe.utils.escape_html(t.stage_name)}" placeholder="例如：首期预付款..." /></td>
                    <td class="picker-cell-right"><input type="number" step="any" min="0" max="100" class="modal-input-rate modal-term-ratio font-mono text-right ashan-no-spin" value="${t.payment_ratio}" placeholder="%" /></td>
                    <td class="picker-cell-right"><input type="number" step="any" class="modal-input-amount modal-input-readonly modal-term-amount font-mono text-right" value="${flt(t.term_amount).toFixed(2)}" readonly tabindex="-1" placeholder="0.00" /></td>
                    <td class="picker-modal-cell-center"><input type="date" class="modal-input-code modal-term-date text-center" value="${t.planned_date || ''}" /></td>
                    <td><input type="text" class="modal-input-remarks modal-term-remarks" value="${frappe.utils.escape_html(t.remarks || '')}" placeholder="阶段条款/交付条件说明..." /></td>
                    <td class="picker-modal-cell-center">
                        <button type="button" class="ashan-btn-row-copy modal-term-copy-btn" data-idx="${idx}" title="复制此阶段">复制</button>
                        <button type="button" class="ashan-btn-row-del modal-term-del-btn" data-idx="${idx}" title="移除该阶段">移除</button>
                    </td>
                </tr>
            `).join("");
            d.$wrapper.find("#modal-term-rows-wrap").html(rowsHtml);
            update_term_calcs();
        };

        const status_cls = isEdit ? (existingContract.docstatus === 1 ? "is-submitted" : "is-draft") : "is-draft";
        const status_txt = isEdit ? (existingContract.status || (existingContract.docstatus === 1 ? __("已生效") : __("草稿"))) : __("待生效草稿");

        const form_html = `
            <div>
                <!-- 1. 严格 6 大法定要素对称卡片 (所属公司在最前面，3行3列无缝高密度卡片) -->
                <div class="ashan-po-context-card">
                    <div class="ashan-po-form-grid ashan-po-form-grid-3x3">
                        <!-- Row 1: Company (Pos 1) | Doc No | Status -->
                        <div class="ashan-po-form-group">
                            <label class="ashan-po-label"><strong>所属签约公司</strong> <span class="ashan-req">*</span></label>
                            <select id="modal-contract-company" class="ashan-po-input">
                                <option value="">请选择签约主体公司</option>
                                ${companyOptions}
                            </select>
                        </div>
                        <div class="ashan-po-form-group">
                            <label class="ashan-po-label">合同编号</label>
                            <input type="text" class="ashan-po-input ashan-po-input-readonly font-mono" id="modal-contract-no" value="${frappe.utils.escape_html(contractNo || '（保存时系统自动分配）')}" readonly tabindex="-1" />
                        </div>
                        <div class="ashan-po-form-group">
                            <label class="ashan-po-label">合同状态</label>
                            <div class="ashan-status-display ${status_cls}" id="modal-contract-status">${status_txt}</div>
                        </div>

                        <!-- Row 2: Supplier | Effective Date | Expiry Date (Pos 6) -->
                        <div class="ashan-po-form-group">
                            <label class="ashan-po-label"><strong>合作供应商 / 乙方</strong> <span class="ashan-req">*</span></label>
                            <input type="text" class="ashan-po-input" id="modal-contract-supplier" value="${frappe.utils.escape_html(selectedSupplier)}" placeholder="输入供应商全称..." />
                        </div>
                        <div class="ashan-po-form-group">
                            <label class="ashan-po-label"><strong>合同生效日期</strong> <span class="ashan-req">*</span></label>
                            <input type="date" class="ashan-po-input" id="modal-contract-eff-date" value="${selectedEffDate}" />
                        </div>
                        <div class="ashan-po-form-group">
                            <label class="ashan-po-label"><strong>期望履约/到期日期</strong> <span class="ashan-req">*</span></label>
                            <input type="date" class="ashan-po-input font-bold text-slate-900" id="modal-contract-exp-date" value="${selectedExpDate}" />
                        </div>

                        <!-- Row 3: Subject | Type | Total Amount -->
                        <div class="ashan-po-form-group">
                            <label class="ashan-po-label"><strong>合同标的 / 名称</strong> <span class="ashan-req">*</span></label>
                            <input type="text" class="ashan-po-input" id="modal-contract-title" value="${frappe.utils.escape_html(selectedTitle)}" placeholder="输入采购合同名称或项目采购标的..." />
                        </div>
                        <div class="ashan-po-form-group">
                            <label class="ashan-po-label"><strong>合同类别</strong> <span class="ashan-req">*</span></label>
                            <select class="ashan-po-input" id="modal-contract-type">
                                <option value="专项采购合同"${selectedType === '专项采购合同' ? ' selected' : ''}>专项采购合同</option>
                                <option value="采购框架协议"${selectedType === '采购框架协议' ? ' selected' : ''}>采购框架协议</option>
                                <option value="委外加工合同"${selectedType === '委外加工合同' ? ' selected' : ''}>委外加工合同</option>
                                <option value="设备采购合同"${selectedType === '设备采购合同' ? ' selected' : ''}>设备采购合同</option>
                                <option value="日常物料供应合同"${selectedType === '日常物料供应合同' ? ' selected' : ''}>日常物料供应合同</option>
                            </select>
                        </div>
                        <div class="ashan-po-form-group">
                            <label class="ashan-po-label"><strong>合同标的总额 (¥)</strong> <span class="ashan-req">*</span></label>
                            <input type="number" class="ashan-po-input font-mono font-bold text-primary ashan-no-spin" id="modal-contract-total-amt" value="${frappe.utils.escape_html(selectedTotalAmt || '')}" placeholder="0.00" step="100" />
                        </div>
                    </div>

                    <!-- Row 4: Remarks & Auto Submit (一体化底栏，拒绝盒子套盒子) -->
                    <div class="contract-modal-footer-row">
                        <div class="ashan-po-form-group contract-modal-remarks-group">
                            <label class="ashan-po-label">合同补充说明与违约责任</label>
                            <input type="text" class="ashan-po-input" id="modal-contract-remarks" value="${frappe.utils.escape_html(selectedRemarks)}" placeholder="特殊条款、交付地点或商务约定..." />
                        </div>
                        <div class="contract-modal-auto-submit-group">
                            <label class="ashan-checkbox-label">
                                <input type="checkbox" id="modal-contract-auto-submit"${isEdit ? ' checked disabled' : ' checked'} />
                                <span class="font-bold text-slate-800">${isEdit ? '修改后自动重新生效' : '保存并直接生效提交 (推荐)'}</span>
                            </label>
                        </div>
                    </div>
                </div>

                <!-- 2. 一体化物理分期付款里程碑表 (单行表头 + 闭式守恒 + 严密网格线) -->
                <div class="contract-modal-table-wrap">
                    <table class="contract-modal-item-table" id="modal-contract-terms-table">
                        <colgroup>
                            <col class="contract-term-col-seq">
                            <col class="contract-term-col-stage">
                            <col class="contract-term-col-ratio">
                            <col class="contract-term-col-amt">
                            <col class="contract-term-col-date">
                            <col class="contract-term-col-remarks">
                            <col class="contract-term-col-action">
                        </colgroup>
                        <thead>
                            <tr>
                                <th class="picker-modal-cell-center">#</th>
                                <th><strong>分期阶段说明</strong> <span class="ashan-req">*</span></th>
                                <th class="picker-cell-right"><strong>付款比例 %</strong> <span class="ashan-req">*</span></th>
                                <th class="picker-cell-right"><strong>分期预核金额 (¥)</strong> <span class="ashan-req">*</span></th>
                                <th class="picker-modal-cell-center"><strong>预计付款日期</strong> <span class="ashan-req">*</span></th>
                                <th>阶段条款备注</th>
                                <th class="picker-modal-cell-center">操作</th>
                            </tr>
                        </thead>
                        <tbody id="modal-term-rows-wrap"></tbody>
                    </table>
                </div>

                <!-- 4. 工具栏：添加分期 + 比例快捷预设 -->
                <div class="picker-modal-table-toolbar">
                    <button type="button" class="picker-modal-add-btn" id="modal-add-term-btn">+ 添加分期</button>
                    <div class="picker-modal-tax-preset-group">
                        <span class="picker-tax-preset-lbl">比例快捷预设:</span>
                        <button type="button" class="ashan-btn-tax-tag ashan-btn-preset" data-preset="30-60-10">预付30/到货60/质保10</button>
                        <button type="button" class="ashan-btn-tax-tag ashan-btn-preset" data-preset="50-50">五五50/50</button>
                        <button type="button" class="ashan-btn-tax-tag ashan-btn-preset" data-preset="100">全额100%</button>
                    </div>
                </div>

                <!-- 5. 底部分期汇总条 -->
                <div class="picker-modal-summary-bar">
                    <span>分期付款汇总:</span>
                    <div class="picker-modal-summary-items">
                        <span>分期总比例: <strong id="modal-term-sum-ratio" class="picker-summary-highlight">100.0%</strong></span>
                        <span>分期总金额: <strong id="modal-term-sum-amt" class="picker-summary-highlight">¥ 0.00</strong></span>
                        <span id="modal-term-balance-status"><span class="ashan-status-badge ashan-status-green">比例完整 (100.0%)</span></span>
                    </div>
                </div>
            </div>
        `;

        d.set_secondary_action_label(__("✕ 关闭"));
        d.set_secondary_action(() => {
            d.hide();
        });

        d.set_value("form_html", form_html);
        d.show();

        // 显式在 modal-header 注入右上角关闭按钮 (✕，悬浮微红)
        const $modalHeader = d.$wrapper.find(".modal-header");
        $modalHeader.find(".ashan-modal-close-btn, .reim-modal-header-close-btn, .ashan-po-close-btn").remove();
        const $closeBtn = $(`<button type="button" class="ashan-modal-close-btn" title="关闭 (Esc)">✕</button>`);
        $closeBtn.on("click", () => d.hide());
        $modalHeader.append($closeBtn);

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
                if (terms[index]) {
                    terms[index] = {
                        stage_name: $(this).find(".modal-term-stage").val()?.trim() || "",
                        payment_ratio: flt($(this).find(".modal-term-ratio").val()),
                        term_amount: flt($(this).find(".modal-term-amount").val()),
                        planned_date: $(this).find(".modal-term-date").val() || "",
                        remarks: $(this).find(".modal-term-remarks").val() || "",
                    };
                }
            });
            update_term_calcs();
            saveDraft();
        });

        // Ratio preset shortcuts
        d.$wrapper.on("click", ".ashan-btn-preset", function () {
            const preset = $(this).data("preset");
            const effDate = d.$wrapper.find("#modal-contract-eff-date").val() || frappe.datetime.get_today();
            const expDate = d.$wrapper.find("#modal-contract-exp-date").val() || get_default_contract_expiry();
            if (preset === "30-60-10") {
                terms = [
                    { stage_name: "首期预付款", payment_ratio: 30, term_amount: 0, planned_date: effDate, remarks: "合同签订后生效支付" },
                    { stage_name: "到货验收进度款", payment_ratio: 60, term_amount: 0, planned_date: expDate, remarks: "到货初检合格后支付" },
                    { stage_name: "质保尾款 (1年)", payment_ratio: 10, term_amount: 0, planned_date: "", remarks: "质保期满无异议后结清" },
                ];
            } else if (preset === "50-50") {
                terms = [
                    { stage_name: "首期进度款 (50%)", payment_ratio: 50, term_amount: 0, planned_date: effDate, remarks: "签约预付款" },
                    { stage_name: "尾款结清款 (50%)", payment_ratio: 50, term_amount: 0, planned_date: expDate, remarks: "交货验收结清" },
                ];
            } else if (preset === "100") {
                terms = [
                    { stage_name: "全额一次性付款", payment_ratio: 100, term_amount: 0, planned_date: expDate, remarks: "合同约定期限一次性结清" },
                ];
            }
            render_term_rows();
            saveDraft();
        });

        // Add milestone
        d.$wrapper.on("click", "#modal-add-term-btn", function () {
            terms.push({ stage_name: `第${terms.length + 1}期款`, payment_ratio: 0, term_amount: 0, planned_date: "", remarks: "" });
            render_term_rows();
            saveDraft();
        });

        // Copy milestone
        d.$wrapper.on("click", ".modal-term-copy-btn", function () {
            const idx = $(this).closest(".contract-term-row").data("idx");
            const src = terms[idx] || {};
            terms.splice(idx + 1, 0, {
                stage_name: `${src.stage_name || ''} (复制)`,
                payment_ratio: src.payment_ratio || 0,
                term_amount: src.term_amount || 0,
                planned_date: src.planned_date || "",
                remarks: src.remarks || ""
            });
            render_term_rows();
            saveDraft();
        });

        // Delete milestone
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

            d.$wrapper.find("#calc-term-remain").text(format_contract_money(remainInTerm));
            d.$wrapper.find("#calc-net-amt").text(format_contract_money(netAmt));
            d.$wrapper.find("#calc-tax-amt").text(format_contract_money(taxAmt));
            d.$wrapper.find("#calc-eff-pct").text(`${currentSettleRatio.toFixed(1)}%`);
        };

        let values_invoice_type = "专用发票";

        const info_html = `
            <div class="contract-dynamic-calc-box">
                <div class="ashan-smart-grid-3">
                    <div><span class="text-xs text-muted">采购合同:</span> <span class="font-mono text-primary font-bold">${frappe.utils.escape_html(contractNo)}</span></div>
                    <div><span class="text-xs text-muted">分期阶段:</span> <span class="font-bold text-slate-800">${frappe.utils.escape_html(stageName)} (规划 ${plannedRatio}%)</span></div>
                    <div><span class="text-xs text-muted">本期规划总额:</span> <span class="font-mono text-slate-900 font-bold">${format_contract_money(plannedAmount)}</span></div>
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
                            <input type="number" class="ashan-doc-input font-mono font-bold text-primary ashan-no-spin" id="dynamic-settle-amt-input" value="${currentSettleAmt.toFixed(2)}" step="100" />
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-700">占合同总标的比例 (%)*</label>
                            <input type="number" class="ashan-doc-input font-mono font-bold ashan-no-spin" id="dynamic-settle-ratio-input" value="${currentSettleRatio.toFixed(1)}" step="1" min="0.1" max="100" />
                        </div>
                    </div>
                </div>

                <!-- Dynamic Real-Time Metric Cards -->
                <div class="ashan-smart-grid-4 contract-grid-gap">
                    <div class="contract-calc-metric">
                        <div class="contract-calc-metric-lbl">不含税金额</div>
                        <div class="contract-calc-metric-val" id="calc-net-amt">¥ 0.00</div>
                    </div>
                    <div class="contract-calc-metric">
                        <div class="contract-calc-metric-lbl">增值税额</div>
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
        const self = this;
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
                        <td class="text-right font-mono font-bold text-slate-900">${format_contract_money(t.term_amount)}</td>
                        <td class="text-right font-mono text-green-600 font-bold">${format_contract_money(t.paid_amount)}</td>
                        <td class="text-right font-mono text-amber-600 font-bold">${format_contract_money(t.outstanding_amount)}</td>
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
                        <td class="text-right font-mono font-bold text-slate-900">${format_contract_money(rr.total_amount)}</td>
                        <td class="text-right font-mono font-bold ${flt(rr.outstanding_amount) > 0 ? 'text-amber-600' : 'text-green-600'}">${format_contract_money(rr.outstanding_amount)}</td>
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
                        暂无关联派生的电汇整算单据。当针对上方分期节点发起【派生整算】后，对应单据将自动归集于此。
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
                                            <div class="contract-ledger-metric-number">${format_contract_money(c.total_contract_amount)}</div>
                                        </div>
                                        <div class="contract-ledger-metric-card">
                                            <div class="contract-ledger-metric-title">累计已整算 (${((settledAmt/totalAmt)*100).toFixed(1)}%)</div>
                                            <div class="contract-ledger-metric-number text-primary">${format_contract_money(c.total_settled_amount)}</div>
                                        </div>
                                        <div class="contract-ledger-metric-card">
                                            <div class="contract-ledger-metric-title">实际已出账付款 (${paidPct.toFixed(1)}%)</div>
                                            <div class="contract-ledger-metric-number text-green-600">${format_contract_money(c.total_paid_amount)}</div>
                                        </div>
                                        <div class="contract-ledger-metric-card">
                                            <div class="contract-ledger-metric-title">履约待付余额 (${((outAmt/totalAmt)*100).toFixed(1)}%)</div>
                                            <div class="contract-ledger-metric-number text-amber-600">${format_contract_money(c.outstanding_amount)}</div>
                                        </div>
                                    </div>

                                    <!-- Triple-Segment Progress Bar -->
                                    <div class="contract-ledger-progress-wrap">
                                        <div class="contract-progress-segment-paid"></div>
                                        <div class="contract-progress-segment-settled"></div>
                                    </div>
                                    <div class="contract-progress-legend">
                                        <span><span class="contract-legend-dot legend-dot-paid"></span>实际已付款: ${format_contract_money(paidAmt)} (${paidPct.toFixed(1)}%)</span>
                                        <span><span class="contract-legend-dot legend-dot-settled"></span>整算待付款: ${format_contract_money(Math.max(0, settledAmt - paidAmt))} (${settledOnlyPct.toFixed(1)}%)</span>
                                        <span><span class="contract-legend-dot legend-dot-remain"></span>未整算额: ${format_contract_money(Math.max(0, totalAmt - settledAmt))} (${remainPct.toFixed(1)}%)</span>
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

            const canEditContract = (c.docstatus === 0) || (flt(c.total_settled_amount) <= 0.0001 && flt(c.total_paid_amount) <= 0.0001);
            if (canEditContract) {
                d.set_primary_action(__("修改合同"), function () {
                    d.hide();
                    setTimeout(() => {
                        d.$wrapper.remove();
                        $(".modal-backdrop").remove();
                        $("body").removeClass("modal-open");
                        self.open_contract_form_modal(contractNo);
                    }, 200);
                });
            }

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
