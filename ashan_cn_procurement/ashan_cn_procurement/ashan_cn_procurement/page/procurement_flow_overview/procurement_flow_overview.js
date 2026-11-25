// Copyright (c) 2026, Ashan CN Procurement and contributors
// 采购业务流程总览 (Procurement Flow Overview)

frappe.pages["procurement-flow-overview"].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __("采购业务流程总览"),
        single_column: true,
    });

    $(page.wrapper).find(".page-head").hide();
    wrapper.procurement_flow_overview = new ProcurementFlowOverview(page);
};

frappe.pages["procurement-flow-overview"].on_page_show = function (wrapper) {
    if (wrapper.procurement_flow_overview) {
        wrapper.procurement_flow_overview.show();
    }
};

const PFO_API = {
    overview: "ashan_cn_procurement.services.procurement_flow_overview_service.get_procurement_flow_overview",
    node_records: "ashan_cn_procurement.services.procurement_flow_overview_service.get_procurement_flow_node_records",
};

const PFO_WORKBENCH_ROUTE = {
    mr: ["material-request-workbench"],
    po: ["procurement-execution-workbench", "mr_to_po"],
    pr: ["material-receipt-workbench"],
    pi: ["procurement-execution-workbench", "pr_to_pi"],
    rr: ["procurement-execution-workbench", "pi_to_rr"],
    pe: ["procurement-execution-workbench", "pi_to_pay"],
    monthly: ["monthly-settlement-picker"],
    reim: ["reimbursement-picker"],
    wire: ["wire-transfer-picker"],
    stock_issue: ["stock-issue-workbench"],
};

const PFO_NODE_LABELS = {
    mr: "1. 物料申请",
    po: "2. 采购订单",
    pr: "3A. 采购入库",
    pi: "3B. 采购发票",
    rr: "4. 整算单",
    pe: "5. 付款核销",
    monthly: "支线 A · 月结补录",
    reim: "支线 B · 报销申请",
    wire: "支线 C · 自办电汇",
};

class ProcurementFlowOverview {
    constructor(page) {
        this.page = page;
        this.$body = $(page.body);
        this.active_company = window.AshanWorkContext?.getCompany?.() || "All";
        this.scope = "mine";
        this.can_view_company_scope = false;
        this.selected_node = "mr";
        this.overview = null;
        this.node_data = null;
        this._overview_seq = 0;
        this._node_seq = 0;

        this.init();
    }

    show() {
        const ctxCompany = window.AshanWorkContext?.getCompany?.() || "All";
        if (ctxCompany && ctxCompany !== this.active_company) {
            this.active_company = ctxCompany;
        }
        this.refresh_all();
    }

    init() {
        this.render_skeleton();
        this.bind_events();
        this.refresh_all();
    }

    render_skeleton() {
        this.$body.html(`
            <div class="pfo-page">
                <div class="pfo-header-bar ashan-clean-title-bar">
                    <div class="picker-title-group">
                        <h2>采购业务流程总览</h2>
                        <div class="picker-subtitle">按当前账号权限展示标准采购、月结补录、报销直采反写与自办电汇的流转进度</div>
                    </div>
                    <div class="pfo-header-controls">
                        <div class="ashan-segmented-control" id="pfo-scope-control">
                            <button type="button" class="ashan-segment-btn active" data-scope="mine">与我相关</button>
                        </div>
                        <button type="button" class="ashan-btn-secondary" id="pfo-refresh-btn">刷新</button>
                    </div>
                </div>

                <div class="pfo-legend-strip">
                    <div class="pfo-legend-items">
                        <span class="pfo-legend-item"><span class="pfo-dot pfo-dot-operable"></span>有权操作节点（可查看详情或跳转工作台）</span>
                        <span class="pfo-legend-item"><span class="pfo-dot pfo-dot-tracked"></span>本人上游进度追踪（数量与环节可见，单价及供应商已脱敏）</span>
                        <span class="pfo-legend-item"><span class="pfo-dot pfo-dot-muted"></span>专岗处理节点（无权限且无本人关联单据）</span>
                    </div>
                    <div id="pfo-company-indicator" class="picker-subtitle"></div>
                </div>

                <div class="pfo-swimlanes-wrap" id="pfo-swimlanes-wrap"></div>

                <div class="pfo-detail-panel" id="pfo-detail-panel">
                    <div class="pfo-detail-header">
                        <div class="pfo-detail-title-group">
                            <span class="pfo-detail-title" id="pfo-detail-title">1. 物料申请 · 单据进度明细</span>
                            <span id="pfo-detail-mode-badge"></span>
                        </div>
                        <div id="pfo-detail-actions"></div>
                    </div>
                    <div class="ashan-table-card">
                        <div class="ashan-table-wrapper pfo-table-scroll" id="pfo-table-scroll">
                            <table class="ashan-data-table" id="pfo-detail-table">
                                <thead id="pfo-table-thead"></thead>
                                <tbody id="pfo-table-tbody">
                                    <tr>
                                        <td colspan="8" class="ashan-empty-cell">
                                            <div class="ashan-empty-state-inner">正在加载流程数据...</div>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        `);
    }

    bind_events() {
        const self = this;

        document.addEventListener("ashan-work-context-changed", (event) => {
            const nextCompany = event.detail?.company || "All";
            if (nextCompany === self.active_company) return;
            self.active_company = nextCompany;
            self.refresh_all();
        });

        this.$body.on("click", "#pfo-scope-control .ashan-segment-btn", function () {
            const nextScope = $(this).data("scope");
            if (!nextScope || nextScope === self.scope) return;
            self.scope = nextScope;
            $("#pfo-scope-control .ashan-segment-btn").removeClass("active");
            $(this).addClass("active");
            self.refresh_all();
        });

        this.$body.on("click", "#pfo-refresh-btn", () => {
            self.refresh_all();
        });

        this.$body.on("click", ".pfo-node-jump-btn", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const routeKey = $(this).attr("data-route-key");
            self.navigate_to_workbench(routeKey);
        });

        this.$body.on("click", ".pfo-sub-link", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const routeKey = $(this).attr("data-route-key");
            self.navigate_to_workbench(routeKey);
        });

        this.$body.on("click", ".pfo-node-card", function () {
            const nodeKey = $(this).attr("data-node");
            if (!nodeKey) return;
            self.selected_node = nodeKey;
            self.$body.find(".pfo-node-card").removeClass("is-selected");
            $(this).addClass("is-selected");
            self.load_node_records();
        });

        this.$body.on("click", ".pfo-doc-link", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const dt = $(this).attr("data-doctype");
            const nm = $(this).attr("data-name");
            if (dt && nm) {
                frappe.set_route("Form", dt, nm);
            }
        });
    }

    navigate_to_workbench(routeKey) {
        const routeParts = PFO_WORKBENCH_ROUTE[routeKey];
        if (!routeParts || !routeParts.length) return;
        frappe.set_route(...routeParts);
    }

    async refresh_all() {
        await this.load_overview();
        await this.load_node_records();
    }

    async load_overview() {
        const seq = ++this._overview_seq;
        try {
            const r = await frappe.call({
                method: PFO_API.overview,
                args: {
                    company: this.active_company,
                    scope: this.scope,
                },
            });
            if (seq !== this._overview_seq) return;
            const data = r.message || {};
            this.overview = data;
            this.scope = data.scope || "mine";
            this.can_view_company_scope = Boolean(data.can_view_company_scope);
            this.render_scope_control();
            this.render_company_indicator();
            this.render_swimlanes();
        } catch (e) {
            if (seq !== this._overview_seq) return;
            console.error("Failed to load procurement flow overview:", e);
        }
    }

    render_scope_control() {
        const $ctrl = this.$body.find("#pfo-scope-control");
        let html = `<button type="button" class="ashan-segment-btn ${this.scope === "mine" ? "active" : ""}" data-scope="mine">与我相关</button>`;
        if (this.can_view_company_scope) {
            html += `<button type="button" class="ashan-segment-btn ${this.scope === "company" ? "active" : ""}" data-scope="company">全公司业务</button>`;
        }
        $ctrl.html(html);
    }

    render_company_indicator() {
        const comp = this.overview?.active_company;
        const text = (!comp || comp === "All") ? "当前范围：全部授权公司" : `当前范围：${comp}`;
        this.$body.find("#pfo-company-indicator").text(text);
    }

    build_node_card_html(cfg) {
        const nodes = this.overview?.nodes || {};
        const node = nodes[cfg.key] || { access_mode: "restricted_muted", metrics: [] };
        const mode = node.access_mode || "restricted_muted";
        const isSelected = this.selected_node === cfg.key;
        const modeCls = mode === "operable"
            ? "is-operable"
            : (mode === "tracked_readonly" ? "is-tracked" : "is-muted");

        let rightBadge = "";
        if (mode === "operable" && cfg.routeKey) {
            rightBadge = `<button type="button" class="pfo-node-jump-btn" data-route-key="${cfg.routeKey}">去处理 ↗</button>`;
        } else if (mode === "tracked_readonly") {
            rightBadge = `<span class="pfo-node-access-pill is-tracked">本人进度追踪</span>`;
        } else {
            rightBadge = `<span class="pfo-node-access-pill is-muted">专岗处理</span>`;
        }

        const metrics = (node.metrics || []).map((m) => {
            const val = Number(m.value || 0);
            const pendingCls = val > 0 ? "has-pending" : "";
            return `<span class="pfo-metric-chip ${pendingCls}">${frappe.utils.escape_html(m.label)} <strong>${val}</strong></span>`;
        }).join("");

        let extraHtml = "";
        if (cfg.key === "pi" && node.origins) {
            const o = node.origins;
            extraHtml = `
                <div class="pfo-origins-bar">
                    <span class="pfo-origin-pill">标准 ${o.standard || 0}</span>
                    <span class="pfo-origin-pill">月结 ${o.monthly || 0}</span>
                    <span class="pfo-origin-pill">报销 ${o.reim || 0}</span>
                    <span class="pfo-origin-pill">电汇 ${o.wire || 0}</span>
                </div>
            `;
        }

        let subHtml = frappe.utils.escape_html(cfg.sub || "");
        if (cfg.key === "pr" && this.overview?.capabilities?.se_read) {
            const seDrafts = Number(node.stock_issue_drafts || 0);
            subHtml += `<span class="pfo-sub-link" data-route-key="stock_issue">材料出库${seDrafts > 0 ? ` (草稿 ${seDrafts})` : ""} ↗</span>`;
        }

        return `
            <div class="pfo-node-card ${modeCls} ${isSelected ? "is-selected" : ""}" data-node="${cfg.key}" role="button" tabindex="0">
                <div class="pfo-node-top">
                    <div class="pfo-node-title-group">
                        <span class="pfo-step-num">${frappe.utils.escape_html(cfg.step)}</span>
                        <span class="pfo-node-title">${frappe.utils.escape_html(cfg.title)}</span>
                    </div>
                    ${rightBadge}
                </div>
                <div class="pfo-node-metrics">${metrics || `<span class="pfo-metric-chip">暂无记录</span>`}</div>
                ${extraHtml}
                <div class="pfo-node-sub">${subHtml}</div>
            </div>
        `;
    }

    render_swimlanes() {
        const isMine = this.scope === "mine";
        const mrSub = isMine ? "我发起的采购需求与草稿" : "全公司物料采购申请";
        const poSub = isMine ? "我申请的单据正在采购中" : "采购下单与在途到货";
        const prSub = isMine ? "仓库收货与入库进度" : "仓库实收入库";
        const piSub = isMine ? "汇集标准/月结/报销/电汇发票" : "四路来源发票汇入核对";
        const rrSub = isMine ? "汇总发票确认报销或电汇" : "发票整算归集确认";
        const peSub = isMine ? "财务对公出账核销" : "对公电汇付款核销";

        const mrCard = this.build_node_card_html({ key: "mr", step: "1", title: "物料申请", sub: mrSub, routeKey: "mr" });
        const poCard = this.build_node_card_html({ key: "po", step: "2", title: "采购订单", sub: poSub, routeKey: "po" });
        const prCard = this.build_node_card_html({ key: "pr", step: "3A", title: "采购入库", sub: prSub, routeKey: "pr" });
        const piCard = this.build_node_card_html({ key: "pi", step: "3B", title: "采购发票", sub: piSub, routeKey: "pi" });
        const rrCard = this.build_node_card_html({ key: "rr", step: "4", title: "整算单", sub: rrSub, routeKey: "rr" });
        const peCard = this.build_node_card_html({ key: "pe", step: "5", title: "付款核销", sub: peSub, routeKey: "pe" });

        const monthlyCard = this.build_node_card_html({
            key: "monthly",
            step: "A",
            title: "月结补录",
            sub: "无采购申请，直接去月结供应商提货后同步补建订单+入库单",
            routeKey: "monthly",
        });
        const reimCard = this.build_node_card_html({
            key: "reim",
            step: "B",
            title: "报销申请",
            sub: "无申请无订单，填报销单自动反写采购入库单+采购发票",
            routeKey: "reim",
        });
        const wireCard = this.build_node_card_html({
            key: "wire",
            step: "C",
            title: "自办电汇",
            sub: "无申请直付，直接登记发票并可即入即出与自动整算",
            routeKey: "wire",
        });

        this.$body.find("#pfo-swimlanes-wrap").html(`
            <div class="pfo-lane">
                <div class="pfo-lane-header">
                    <div class="pfo-lane-title-wrap">
                        <span class="pfo-lane-tag">主泳道 · 标准计划采购</span>
                        <span class="pfo-lane-title">申请 → 订货 → 入库与发票分叉并进 → 整算（报销/电汇）→ 付款</span>
                    </div>
                    <span class="pfo-lane-desc">适用于先提申请审批、再由采购下单、仓库入库、财务登票结算的标准业务</span>
                </div>
                <div class="pfo-main-flow">
                    ${mrCard}
                    <div class="pfo-arrow-col">→</div>
                    ${poCard}
                    <div class="pfo-arrow-col">→</div>
                    <div class="pfo-fork-col">
                        ${prCard}
                        <div class="pfo-fork-sync-note">采购订单分出入库与发票 · 双向同步对账</div>
                        ${piCard}
                    </div>
                    <div class="pfo-arrow-col">→</div>
                    ${rrCard}
                    <div class="pfo-arrow-col">→</div>
                    ${peCard}
                </div>
            </div>

            <div class="pfo-bypass-grid">
                <div class="pfo-bypass-lane">
                    <div class="pfo-lane-header">
                        <div class="pfo-lane-title-wrap">
                            <span class="pfo-lane-tag pfo-lane-tag-amber">支线 A · 跳过采购申请</span>
                            <span class="pfo-lane-title">月结补录直采</span>
                        </div>
                    </div>
                    <div class="pfo-bypass-flow">
                        ${monthlyCard}
                        <div class="pfo-merge-badge">流向说明：跳过「1. 物料申请」，一步生成采购订单 + 采购入库单，随后自动汇入主泳道「3B. 采购发票」待开票与结算。</div>
                    </div>
                </div>

                <div class="pfo-bypass-lane">
                    <div class="pfo-lane-header">
                        <div class="pfo-lane-title-wrap">
                            <span class="pfo-lane-tag pfo-lane-tag-teal">支线 B · 跳过申请与订单</span>
                            <span class="pfo-lane-title">直接报销（自动反写入库+发票）</span>
                        </div>
                    </div>
                    <div class="pfo-bypass-flow">
                        ${reimCard}
                        <div class="pfo-merge-badge">流向说明：直接填报销单，提交后系统自动反写「采购发票」与库存品「采购入库单」（勾选即入即出可同步全部出库），等待财务结款。</div>
                    </div>
                </div>

                <div class="pfo-bypass-lane">
                    <div class="pfo-lane-header">
                        <div class="pfo-lane-title-wrap">
                            <span class="pfo-lane-tag">支线 C · 跳过申请与订单</span>
                            <span class="pfo-lane-title">自办电汇直采</span>
                        </div>
                    </div>
                    <div class="pfo-bypass-flow">
                        ${wireCard}
                        <div class="pfo-merge-badge">流向说明：经办人直接登记电汇发票，可同步生成入库单、领料出库单与整算单，随后进入财务付款核销。</div>
                    </div>
                </div>
            </div>
        `);
    }

    async load_node_records() {
        const seq = ++this._node_seq;
        const nodeKey = this.selected_node || "mr";
        const $title = this.$body.find("#pfo-detail-title");
        const $badge = this.$body.find("#pfo-detail-mode-badge");
        const $actions = this.$body.find("#pfo-detail-actions");

        $title.text(`${PFO_NODE_LABELS[nodeKey] || nodeKey} · 进度明细`);
        $badge.empty();
        $actions.empty();

        try {
            const r = await frappe.call({
                method: PFO_API.node_records,
                args: {
                    node_key: nodeKey,
                    company: this.active_company,
                    scope: this.scope,
                },
            });
            if (seq !== this._node_seq) return;
            const res = r.message || {};
            this.node_data = res;

            if (res.access_mode === "operable") {
                $badge.html(`<span class="pfo-full-banner">完整视图（拥有该环节读取权限）</span>`);
                const routeKey = nodeKey;
                if (PFO_WORKBENCH_ROUTE[routeKey]) {
                    $actions.html(`<button type="button" class="ashan-btn-primary pfo-node-jump-btn" data-route-key="${routeKey}">进入对应工作台 ↗</button>`);
                }
            } else if (res.access_mode === "tracked_readonly") {
                $badge.html(`<span class="pfo-redacted-banner">本人申请脱敏追踪（已隐藏采购单价、金额与供应商）</span>`);
            } else {
                $badge.html(`<span class="pfo-redacted-banner">专岗处理环节（当前账号无权限且无本人关联记录）</span>`);
            }

            this.render_detail_table(res);
        } catch (e) {
            if (seq !== this._node_seq) return;
            console.error("Failed to load node records:", e);
        }
    }

    render_detail_table(res) {
        const rows = res.rows || [];
        const redacted = Boolean(res.redacted);
        const showCompany = !this.active_company || this.active_company === "All";

        let headHtml = `
            <tr>
                <th class="col-w-seq cell-center">#</th>
                ${showCompany ? `<th class="col-w-company-badge">所属公司</th>` : ""}
                <th class="col-w-docname">单据编号</th>
                <th class="col-w-date cell-center">单据日期</th>
                ${redacted ? `<th class="col-w-date cell-center">预计交期</th>` : ""}
                <th class="col-w-status cell-center">当前状态</th>
                <th class="col-w-fluid">物料/单据摘要</th>
                <th>推进进度</th>
                <th>全流程足迹</th>
                ${redacted ? "" : `<th class="col-w-supplier">供应商</th><th class="col-w-money cell-right">单据金额</th><th class="col-w-user cell-center">制单人</th>`}
            </tr>
        `;
        this.$body.find("#pfo-table-thead").html(headHtml);
        if (window.AshanUI?.keyedTable?.bindWheelScroll) {
            AshanUI.keyedTable.bindWheelScroll(
                this.$body.find("#pfo-table-scroll")[0],
                this.$body.find("#pfo-table-thead")[0]
            );
        }

        const colCount = 7 + (showCompany ? 1 : 0) + (redacted ? 1 : 3);
        const $tbody = this.$body.find("#pfo-table-tbody");

        if (!rows.length) {
            const emptyMsg = res.access_mode === "restricted_muted"
                ? "该环节由采购/仓库/财务专岗处理，您当前没有关联单据。"
                : "当前范围下暂无该环节的记录。";
            $tbody.html(`
                <tr>
                    <td colspan="${colCount}" class="ashan-empty-cell">
                        <div class="ashan-empty-state-inner">${frappe.utils.escape_html(emptyMsg)}</div>
                    </td>
                </tr>
            `);
            return;
        }

        const bodyHtml = rows.map((row, idx) => {
            const stepsHtml = (row.steps || []).map((st, sIdx) => {
                const arrow = sIdx > 0 ? `<span class="pfo-pipe-arrow">→</span>` : "";
                const cls = st.state === "done" ? "is-done" : (st.state === "active" ? "is-active" : "");
                return `${arrow}<span class="pfo-pipe-step ${cls}">${frappe.utils.escape_html(st.label)}</span>`;
            }).join("");

            const docCell = redacted
                ? `<span class="font-mono">${frappe.utils.escape_html(row.docname)}</span>`
                : `<span class="pfo-doc-link" data-doctype="${frappe.utils.escape_html(row.doctype)}" data-name="${frappe.utils.escape_html(row.docname)}">${frappe.utils.escape_html(row.docname)}</span>`;

            const statusCls = (row.status_label || "").includes("草稿") || (row.status_label || "").includes("待")
                ? "ashan-status-amber"
                : ((row.status_label || "").includes("已完成") || (row.status_label || "").includes("已结清") || (row.status_label || "").includes("已付款") || (row.status_label || "").includes("已入库")
                    ? "ashan-status-green"
                    : "ashan-status-blue");

            const moneyText = (!redacted && row.amount !== null && row.amount !== undefined)
                ? AshanUI.formatMoney(row.amount)
                : "-";
            const userHtml = (!redacted && row.owner)
                ? (window.AshanUI?.formatUser ? AshanUI.formatUser(row.owner) : frappe.utils.escape_html(row.owner))
                : "-";

            return `
                <tr>
                    <td class="cell-center">${idx + 1}</td>
                    ${showCompany ? `<td>${frappe.utils.escape_html(row.company || "-")}</td>` : ""}
                    <td>${docCell}</td>
                    <td class="cell-center font-mono">${frappe.utils.escape_html(row.posting_date || "-")}</td>
                    ${redacted ? `<td class="cell-center font-mono">${frappe.utils.escape_html(row.eta_date || "-")}</td>` : ""}
                    <td class="cell-center"><span class="ashan-status-badge ${statusCls}">${frappe.utils.escape_html(row.status_label || "-")}</span></td>
                    <td>${frappe.utils.escape_html(row.item_summary || "-")}</td>
                    <td>${frappe.utils.escape_html(row.progress_text || "-")}</td>
                    <td><div class="pfo-pipeline">${stepsHtml}</div></td>
                    ${redacted ? "" : `
                        <td>${frappe.utils.escape_html(row.supplier || "-")}</td>
                        <td class="ashan-money-cell">${moneyText}</td>
                        <td class="cell-center">${userHtml}</td>
                    `}
                </tr>
            `;
        }).join("");

        $tbody.html(bodyHtml);
    }
}
