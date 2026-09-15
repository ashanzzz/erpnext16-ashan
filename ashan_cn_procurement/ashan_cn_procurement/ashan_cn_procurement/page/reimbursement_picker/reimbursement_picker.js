// ASHAN-UNIFIED-V2: completed-module refactor
// Copyright (c) 2026, Ashan CN Procurement and contributors
// For license information, please see license.txt

frappe.pages["reimbursement-picker"].on_page_load = function (wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __("报销申请"),
        single_column: true,
    });

    $(page.wrapper).find(".page-head").hide();
    wrapper.reim_picker = new ReimbursementPicker(page);
};

frappe.pages["reimbursement-picker"].on_page_show = function (wrapper) {
    if (wrapper.reim_picker && typeof wrapper.reim_picker.refresh_all === "function") {
        wrapper.reim_picker.refresh_all();
    }
};

const REIM_API = {
    overview_kpis: "ashan_cn_procurement.services.reimbursement_picker_service.get_reimbursement_picker_overview_kpis",
    doc_summary: "ashan_cn_procurement.services.reimbursement_picker_service.get_reimbursement_picker_doc_summary_rows",
    item_rows: "ashan_cn_procurement.services.reimbursement_picker_service.get_reimbursement_picker_rows",
    companies: "ashan_cn_procurement.services.procurement_picker_service.get_user_procurement_companies",
    create_manual: "ashan_cn_procurement.services.reimbursement_picker_service.create_manual_multi_invoice_reimbursement",
    search_items: "ashan_cn_procurement.services.reimbursement_picker_service.search_items_for_reimbursement",
    search_suppliers: "ashan_cn_procurement.services.reimbursement_picker_service.get_suppliers_for_reimbursement",
    quick_create_item: "ashan_cn_procurement.services.reimbursement_picker_service.quick_create_reimbursement_item",
    quick_create_supp: "ashan_cn_procurement.services.reimbursement_picker_service.quick_create_reimbursement_supplier",
    get_detail: "ashan_cn_procurement.services.reimbursement_picker_service.get_reimbursement_detail_for_edit",
    delete_bundle: "ashan_cn_procurement.services.reimbursement_picker_service.delete_reimbursement_bundle",
    batch_delete: "ashan_cn_procurement.services.reimbursement_picker_service.batch_delete_reimbursements",
};

function flash_field_error($el, msg) {
    if (!$el || !$el.length) return;
    $el.addClass("reim-field-flash-error");
    $el.focus();
    frappe.show_alert({ message: __(msg), indicator: "orange" });
    setTimeout(() => {
        $el.removeClass("reim-field-flash-error");
    }, 2000);
}

class ReimbursementPicker {
    constructor(page) {
        this.page = page;
        this.active_company = window.AshanWorkContext?.getCompany?.() || "All";
        this.companies = [];
        this.view_mode = "doc";
        this.match_status = "pending";
        this.cached_rows = [];
        this.selected_map = new Map();
        this.kpis = {};
        this.cached_items = [];
        this.cached_suppliers = [];

        this.creation = {
            dialog: null,
            is_edit: false,
            current_rr_name: null,
            can_delete: false,
            company: null,
            posting_date: null,
            title: "",
            auto_receive_stock: 1,
            invoices: [],
            invoice_counter: 0,
            $wrapper: null,
        };

        this.init();
    }

    async init() {
        this.render_layout();
        await this.load_companies();
        this.preload_master_data();
        this.bind_global_events();
        this.refresh_all();
    }

    async preload_master_data() {
        try {
            const [itemRes, suppRes] = await Promise.all([
                frappe.call({ method: REIM_API.search_items, args: { txt: "", limit: 100 } }),
                frappe.call({ method: REIM_API.search_suppliers, args: { txt: "", limit: 100 } }),
            ]);
            if (itemRes.message) this.cached_items = itemRes.message;
            if (suppRes.message) this.cached_suppliers = suppRes.message;
        } catch (e) {
            console.error("Failed to preload master data:", e);
        }
    }

    render_layout() {
        const html = `
            <div class="picker-page-container">
                <!-- Top Header & Company Selector -->
                <div class="picker-top-bar">
                    <div class="picker-title-group">
                        <h2>报销申请</h2>
                        <div class="picker-subtitle">多发票录入、采购单据生成与报销付款闭环</div>
                    </div>
                    <div class="picker-company-group">
                        <label class="picker-company-label" for="reim-company-select">所属公司:</label>
                        <select id="reim-company-select" class="picker-company-select">
                            <option value="All">全部公司</option>
                        </select>
                    </div>
                </div>

                <!-- 4 KPI Cards Pipeline Bar -->
                <div class="picker-kpi-grid" id="reim-kpi-grid">
                    <div class="picker-kpi-card active" data-step="rr_pending">
                        <div class="picker-kpi-header">
                            <span class="picker-kpi-title">待结款报销</span>
                        </div>
                        <div class="picker-kpi-body">
                            <div class="picker-kpi-number" id="reim-kpi-pending-rr">0</div>
                            <div class="picker-kpi-sub" id="reim-kpi-pending-sub">待结款报销单</div>
                        </div>
                    </div>
                    <div class="picker-kpi-card" data-step="pi">
                        <div class="picker-kpi-header">
                            <span class="picker-kpi-title">垫付采购发票</span>
                        </div>
                        <div class="picker-kpi-body">
                            <div class="picker-kpi-number" id="reim-kpi-pi-count">0</div>
                            <div class="picker-kpi-sub">关联采购发票</div>
                        </div>
                    </div>
                    <div class="picker-kpi-card" data-step="pr">
                        <div class="picker-kpi-header">
                            <span class="picker-kpi-title">自动入库单</span>
                        </div>
                        <div class="picker-kpi-body">
                            <div class="picker-kpi-number" id="reim-kpi-pr-count">0</div>
                            <div class="picker-kpi-sub">库存品入库</div>
                        </div>
                    </div>
                    <div class="picker-kpi-card" data-step="outstanding_amt">
                        <div class="picker-kpi-header">
                            <span class="picker-kpi-title">待报销总额</span>
                        </div>
                        <div class="picker-kpi-body">
                            <div class="picker-kpi-number" id="reim-kpi-outstanding-amt">¥ 0.00</div>
                            <div class="picker-kpi-sub">待付款结清总额</div>
                        </div>
                    </div>
                </div>

                <!-- Section Context Banner -->
                <div class="picker-section-banner" id="reim-section-banner">
                    <div class="picker-section-main">
                        <div class="picker-section-heading">
                            <div class="picker-section-title">
                                <span>报销申请</span>
                            </div>
                            <div class="picker-section-desc">一张报销单可录入多张发票；系统生成关联采购发票、入库单和报销申请单。</div>
                        </div>
                    </div>
                    <div class="picker-section-badge" id="reim-total-summary-badge">
                        统计: 0 笔
                    </div>
                </div>

                <!-- Filter Controls Bar -->
                <div class="picker-filter-bar" id="reim-filter-bar">
                    <div class="picker-filter-group">
                        <label>付款状态:</label>
                        <div class="picker-status-btn-group" id="reim-status-btn-group">
                            <button type="button" class="picker-status-btn active" data-status="pending">待结款</button>
                            <button type="button" class="picker-status-btn" data-status="draft">草稿</button>
                            <button type="button" class="picker-status-btn" data-status="completed">已结清</button>
                            <button type="button" class="picker-status-btn" data-status="all">全部报销</button>
                        </div>
                    </div>
                    <div class="picker-filter-group">
                        <label>供应商:</label>
                        <input type="text" class="picker-input" data-filter="supplier" placeholder="搜索供应商..." />
                    </div>
                    <div class="picker-filter-group">
                        <label>发票号码:</label>
                        <input type="text" class="picker-input" data-filter="invoice_no" placeholder="发票号码..." />
                    </div>
                    <div class="picker-filter-group">
                        <label>物料名称:</label>
                        <input type="text" class="picker-input" data-filter="item_code" placeholder="搜索物料..." />
                    </div>
                    <div class="picker-filter-group">
                        <label>经手人:</label>
                        <input type="text" class="picker-input" data-filter="owner" placeholder="录单人..." />
                    </div>
                </div>

                <!-- Action Bar -->
                <div class="picker-action-bar">
                    <div class="picker-summary-text">
                        <div class="picker-view-switch-group">
                            <button type="button" class="picker-view-btn" data-mode="detail">明细视图</button>
                            <button type="button" class="picker-view-btn active" data-mode="doc">单号视图</button>
                        </div>
                        <span>已加载: <strong class="picker-summary-highlight" id="reim-loaded-count">0</strong> 笔</span>
                        <span>报销总额: <strong class="picker-summary-highlight" id="reim-sum-total-amt">¥ 0.00</strong></span>
                        <span>待结款: <strong class="picker-summary-highlight" id="reim-sum-outstanding-amt">¥ 0.00</strong></span>
                        <span class="picker-selected-summary reim-v2-hidden" id="reim-selected-summary-wrap">
                            <span>已选: <strong id="reim-selected-count">0</strong></span>
                            <span id="reim-selected-amt-wrap">(金额: <strong id="reim-selected-total-amt">¥ 0.00</strong>)</span>
                        </span>
                    </div>

                    <div class="picker-btn-group">
                        <button type="button" class="picker-btn-sub" id="reim-select-all-btn">全选</button>
                        <button type="button" class="picker-btn-sub reim-v2-hidden" id="reim-clear-sel-btn">清空选择</button>
                        <button type="button" class="reim-batch-delete-btn reim-v2-hidden" id="reim-batch-delete-btn">
                            <span>批量删除</span>
                        </button>
                        <button type="button" class="picker-btn-sub" id="reim-refresh-btn">刷新</button>
                        <button type="button" class="reim-btn-create-rr" id="reim-open-create-modal-btn">
                            <span>新建报销</span>
                        </button>
                    </div>
                </div>

                <!-- Table Container & Sticky Panes -->
                <div class="picker-table-wrapper">
                    <div class="picker-top-scrollbar-wrap" id="reim-top-scroll">
                        <div class="picker-top-scrollbar-inner" id="reim-top-scroll-inner"></div>
                    </div>
                    <div class="picker-main-table-scroll" id="reim-main-scroll">
                        <table class="picker-data-table" id="reim-data-table">
                            <thead id="reim-table-head"></thead>
                            <tbody id="reim-table-body"></tbody>
                            <tfoot id="reim-table-foot"></tfoot>
                        </table>
                    </div>
                </div>
            </div>
        `;

        this.page.main.html(html);

        this.page.set_primary_action(__("新建报销"), () => {
            this.open_create_reimbursement_modal();
        });
    }

    async load_companies() {
        const r = await frappe.call({ method: REIM_API.companies });
        if (r.message && r.message.companies) {
            this.companies = r.message.companies;
            const $sel = $("#reim-company-select");
            $sel.empty();
            if (this.companies.length > 1) {
                $sel.append(`<option value="All">全部公司</option>`);
            }
            this.companies.forEach((comp) => {
                $sel.append(`<option value="${comp}">${comp}</option>`);
            });
            if (this.companies.length === 1) {
                this.active_company = this.companies[0];
                $sel.val(this.active_company);
            }
        }
    }

    bind_global_events() {
        const me = this;

        document.addEventListener("ashan-work-context-changed", (event) => {
            const selectedCompany = event.detail?.company || "All";
            if (selectedCompany === me.active_company) return;
            if (selectedCompany !== "All" && !me.companies.includes(selectedCompany)) return;
            me.active_company = selectedCompany;
            me.clear_selection();
            me.refresh_all();
        });

        $("#reim-company-select").on("change", function () {
            me.active_company = $(this).val();
            me.clear_selection();
            me.refresh_all();
        });

        $("#reim-status-btn-group").on("click", ".picker-status-btn", function () {
            $(this).addClass("active").siblings().removeClass("active");
            me.match_status = $(this).data("status");
            me.clear_selection();
            me.load_rows();
        });

        $(this.page.body).find(".picker-view-switch-group").on("click", ".picker-view-btn", function () {
            $(this).addClass("active").siblings().removeClass("active");
            me.view_mode = $(this).data("mode");
            me.clear_selection();
            me.load_rows();
        });

        let filterTimer = null;
        $("#reim-filter-bar").on("input", "input.picker-input", function () {
            clearTimeout(filterTimer);
            filterTimer = setTimeout(() => {
                me.clear_selection();
                me.load_rows();
            }, 300);
        });

        $("#reim-refresh-btn").on("click", () => {
            this.clear_selection();
            this.refresh_all();
        });

        $("#reim-open-create-modal-btn").on("click", () => {
            this.open_create_reimbursement_modal();
        });

        $("#reim-select-all-btn").on("click", () => {
            this.select_all_visible();
        });

        $("#reim-clear-sel-btn").on("click", () => {
            this.clear_selection();
        });

        $("#reim-batch-delete-btn").on("click", () => {
            this.confirm_batch_delete();
        });

        $("#reim-data-table").on("change", "#reim-select-all-header", function () {
            if ($(this).is(":checked")) {
                me.select_all_visible();
            } else {
                me.clear_selection();
            }
        });

        $("#reim-data-table").on("change", ".picker-row-checkbox", function (e) {
            e.stopPropagation();
            const key = String($(this).data("key"));
            const isChecked = $(this).is(":checked");
            const row = me.cached_rows.find((r) => String(me.get_row_key(r)) === key);
            if (!row) return;

            if (isChecked) {
                me.selected_map.set(key, row);
                $(this).closest("tr").addClass("row-selected");
            } else {
                me.selected_map.delete(key);
                $(this).closest("tr").removeClass("row-selected");
            }
            me.update_selection_summary();
        });

        $("#reim-data-table").on("click", ".reim-btn-delete-doc", function (e) {
            e.stopPropagation();
            const rrName = $(this).data("rr-name");
            const isDraft = Number($(this).data("is-draft")) === 1;
            me.confirm_delete_reimbursement(rrName, isDraft);
        });

        $("#reim-data-table").on("click", ".picker-clickable-doc", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const rrName = $(this).data("rr-name");
            const docstatus = $(this).closest("tr").data("docstatus");
            me.open_reimbursement_row(rrName, docstatus);
        });

        $("#reim-data-table").on("click", "#reim-table-body tr[data-rr-name]", function (e) {
            if ($(e.target).closest("input, button, a").length) {
                return;
            }
            me.open_reimbursement_row($(this).data("rr-name"), $(this).data("docstatus"));
        });

        $("#reim-data-table").on("click", ".reim-quick-pay-btn", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const rrName = $(this).attr("data-rr-name");
            const supplier = $(this).attr("data-supplier");
            const amt = $(this).attr("data-amt");
            const total = $(this).attr("data-total");
            if (rrName) {
                me.open_reimbursement_payment_modal(rrName, supplier, amt, total);
            }
        });

        this.sync_scrollbars();
    }

    get_row_key(r) {
        if (this.view_mode === "doc") {
            return r.rr_name;
        }
        return r.item_row_name || `${r.rr_name}__${r.idx}`;
    }

    get_selected_rr_names() {
        const names = new Set();
        this.selected_map.forEach((r) => {
            if (r.rr_name) names.add(r.rr_name);
        });
        return Array.from(names);
    }

    update_selection_summary() {
        const selectedCount = this.selected_map.size;
        const rrNames = this.get_selected_rr_names();
        let totalAmt = 0;
        let hasSubmitted = false;
        let hasDraft = false;

        this.selected_map.forEach((r) => {
            totalAmt += flt(r.total_amount || r.amount || 0);
            if (r.docstatus === 0 || r.is_draft) {
                hasDraft = true;
            } else {
                hasSubmitted = true;
            }
        });

        const $summaryWrap = $("#reim-selected-summary-wrap");
        const $clearBtn = $("#reim-clear-sel-btn");
        const $batchDelBtn = $("#reim-batch-delete-btn");
        const $selectAllHeader = $("#reim-select-all-header");

        if (selectedCount > 0) {
            $summaryWrap.removeClass("reim-v2-hidden");
            $clearBtn.removeClass("reim-v2-hidden");
            $batchDelBtn.removeClass("reim-v2-hidden");

            const countText = this.view_mode === "doc"
                ? `${selectedCount} 笔`
                : `${selectedCount} 条明细 (${rrNames.length} 张单)`;
            $("#reim-selected-count").text(countText);
            $("#reim-selected-total-amt").text(format_currency(totalAmt));

            if (hasSubmitted && hasDraft) {
                $batchDelBtn.html(`<span>批量删除 (${rrNames.length})</span>`);
            } else if (hasSubmitted) {
                $batchDelBtn.html(`<span>批量删除单据 (${rrNames.length})</span>`);
            } else {
                $batchDelBtn.html(`<span>批量删除草稿 (${rrNames.length})</span>`);
            }
        } else {
            $summaryWrap.addClass("reim-v2-hidden");
            $clearBtn.addClass("reim-v2-hidden");
            $batchDelBtn.addClass("reim-v2-hidden");
        }

        const visibleRows = this.cached_rows || [];
        if (visibleRows.length === 0 || selectedCount === 0) {
            $selectAllHeader.prop("checked", false).prop("indeterminate", false);
        } else {
            const allSelected = visibleRows.every((r) => this.selected_map.has(this.get_row_key(r)));
            if (allSelected) {
                $selectAllHeader.prop("checked", true).prop("indeterminate", false);
            } else {
                $selectAllHeader.prop("checked", false).prop("indeterminate", true);
            }
        }
    }

    select_all_visible() {
        if (!this.cached_rows || this.cached_rows.length === 0) return;
        this.selected_map.clear();
        this.cached_rows.forEach((r) => {
            const key = this.get_row_key(r);
            this.selected_map.set(key, r);
        });
        $(".picker-row-checkbox").prop("checked", true);
        $("#reim-table-body tr").addClass("row-selected");
        this.update_selection_summary();
    }

    clear_selection() {
        this.selected_map.clear();
        $(".picker-row-checkbox").prop("checked", false);
        $("#reim-table-body tr").removeClass("row-selected");
        $("#reim-select-all-header").prop("checked", false).prop("indeterminate", false);
        this.update_selection_summary();
    }

    confirm_batch_delete() {
        const rrNames = this.get_selected_rr_names();
        if (!rrNames.length) {
            frappe.msgprint(__("请先勾选需要删除的报销单。"));
            return;
        }

        let draftCount = 0;
        let submittedCount = 0;
        this.selected_map.forEach((r) => {
            if (r.docstatus === 0 || r.is_draft) {
                draftCount++;
            } else {
                submittedCount++;
            }
        });

        let confirmMsg = "";
        if (submittedCount > 0) {
            confirmMsg = __(`所选包含 <strong>${submittedCount}</strong> 笔已提交报销单（共勾选 <strong>${rrNames.length}</strong> 张报销单）。<br><br><span class="text-danger font-bold">警告：</span>系统将自动撤销过账并作废关联的采购发票与采购入库单，然后彻底删除单据。<br><span class="text-muted text-xs">注意：已发生付款的报销单将被安全拦截。</span><br><br>确定要执行批量作废并删除吗？`);
        } else {
            confirmMsg = __(`确定要彻底删除所选的 <strong>${rrNames.length}</strong> 张草稿报销单及其关联草稿发票和入库单吗？<br><span class="text-muted text-xs">此操作不可恢复。</span>`);
        }

        const me = this;
        frappe.confirm(confirmMsg, async () => {
            try {
                const r = await frappe.call({
                    method: REIM_API.batch_delete,
                    type: "POST",
                    args: { rr_names: JSON.stringify(rrNames) },
                    freeze: true,
                    freeze_message: __("正在批量作废/删除报销单及关联单据..."),
                });
                if (r.message && r.message.success) {
                    frappe.show_alert({
                        message: r.message.message || __(`已成功删除 ${r.message.count || rrNames.length} 张报销单`),
                        indicator: "green",
                    }, 5);
                    me.clear_selection();
                    me.refresh_all();
                }
            } catch (e) {
                console.error("Batch delete failed:", e);
            }
        });
    }

    open_reimbursement_row(rrName, docstatus) {
        if (!rrName) return;
        if (Number(docstatus) === 0) {
            this.open_manage_reimbursement_modal(rrName);
            return;
        }
        this.show_reimbursement_detail_by_name(rrName);
    }

    sync_scrollbars() {
        const $top = $("#reim-top-scroll");
        const $main = $("#reim-main-scroll");
        const $inner = $("#reim-top-scroll-inner");
        const $table = $("#reim-data-table");

        const updateWidth = () => {
            const w = $table.outerWidth() || 1200;
            $inner.width(w);
        };

        $top.on("scroll", function () {
            $main.scrollLeft($(this).scrollLeft());
        });
        $main.on("scroll", function () {
            $top.scrollLeft($(this).scrollLeft());
        });

        $("#reim-table-head, #reim-top-scroll").on("wheel", function (e) {
            if (e.originalEvent.deltaY !== 0) {
                const delta = e.originalEvent.deltaY;
                $main.scrollLeft($main.scrollLeft() + delta);
                e.preventDefault();
            }
        });

        $(window).off("resize.reimbursementPicker").on("resize.reimbursementPicker", updateWidth);
        setTimeout(updateWidth, 300);
    }

    async refresh_all() {
        await Promise.all([this.load_kpis(), this.load_rows()]);
    }

    async load_kpis() {
        const r = await frappe.call({
            method: REIM_API.overview_kpis,
            args: { company: this.active_company },
        });
        if (r.message) {
            this.kpis = r.message;
            $("#reim-kpi-pending-rr").text(this.kpis.pending_rr_count || 0);
            $("#reim-kpi-pi-count").text(this.kpis.pi_count || 0);
            $("#reim-kpi-pr-count").text(this.kpis.pr_count || 0);
            $("#reim-kpi-outstanding-amt").text(format_currency(this.kpis.rr_outstanding || 0));
        }
    }

    get_filter_params() {
        const p = { match_status: this.match_status };
        $("#reim-filter-bar input.picker-input").each(function () {
            const key = $(this).data("filter");
            const val = $(this).val().trim();
            if (val) p[key] = val;
        });
        return p;
    }

    async load_rows() {
        const request_id = (this._rows_request_id || 0) + 1;
        this._rows_request_id = request_id;
        const filters = this.get_filter_params();
        const method = this.view_mode === "doc" ? REIM_API.doc_summary : REIM_API.item_rows;

        try {
            const r = await frappe.call({
                method: method,
                args: {
                    company: this.active_company,
                    filters: filters,
                },
            });
            if (request_id !== this._rows_request_id) return;

            const data = r.message || { rows: [], total_count: 0, total_amount: 0, total_outstanding: 0 };
            this.cached_rows = data.rows || [];

            $("#reim-loaded-count").text(data.total_count || 0);
            $("#reim-total-summary-badge").text(`统计: ${data.total_count || 0} 笔`);
            $("#reim-sum-total-amt").text(format_currency(data.total_amount || 0));
            $("#reim-sum-outstanding-amt").text(format_currency(data.total_outstanding || 0));

            if (this.view_mode === "doc") {
                this.render_doc_view(this.cached_rows);
            } else {
                this.render_detail_view(this.cached_rows);
            }

            window.requestAnimationFrame(() => {
                if (request_id !== this._rows_request_id) return;
                const w = $("#reim-data-table").outerWidth() || 1200;
                $("#reim-top-scroll-inner").width(w);
            });
        } catch (e) {
            if (request_id !== this._rows_request_id) return;
            console.error("Failed to load reimbursement rows:", e);
        }
    }

    render_doc_view(rows) {
        const thead = `
            <tr>
                <th class="picker-col-sticky-1 col-w-seq text-center">#</th>
                <th class="picker-col-sticky-2 col-w-check text-center">
                    <input type="checkbox" id="reim-select-all-header" title="全选/取消全选" />
                </th>
                <th class="picker-col-sticky-3 col-w-docname">报销单号</th>
                <th class="col-w-company">所属公司</th>
                <th class="col-w-date text-center">报销日期</th>
                <th class="col-w-invoice-no">发票信息</th>
                <th class="col-w-supplier">供应商</th>
                <th class="col-w-details">单据明细</th>
                <th class="col-w-total text-right">报销总额</th>
                <th class="col-w-amount text-right">待结款金额</th>
                <th class="col-w-status text-center">单据状态</th>
                <th class="col-w-docname">关联采购单据</th>
                <th class="col-w-action text-center">操作</th>
            </tr>
        `;
        $("#reim-table-head").html(thead);

        if (!rows.length) {
            $("#reim-table-body").html(`
                <tr>
                    <td colspan="13" class="picker-empty-state">
                        <div class="picker-empty-icon">无记录</div>
                        <div class="picker-empty-text">当前筛选条件下暂无报销单数据</div>
                    </td>
                </tr>
            `);
            $("#reim-table-foot").empty();
            this.update_selection_summary();
            return;
        }

        let totalAmt = 0;
        let totalOut = 0;

        const bodyHtml = rows.map((r, idx) => {
            totalAmt += flt(r.total_amount);
            totalOut += flt(r.outstanding_amount);

            // Format item details text cleanly (Zero-Badge Clutter & Pure Tabular Data)
            const detailText = r.doc_details || r.auto_items_summary || "";
            const detailItems = detailText.split("、").map(s => s.trim()).filter(Boolean);
            let detailCapsulesHtml = "";
            if (detailItems.length) {
                detailCapsulesHtml = detailItems.map(d => {
                    const match = d.match(/^(.*?)\s*(\(.*?\))$/);
                    if (match) {
                        return `<span class="reim-details-item-text"><span>${frappe.utils.escape_html(match[1])}</span><span class="reim-details-qty-text">${frappe.utils.escape_html(match[2])}</span></span>`;
                    }
                    return `<span class="reim-details-item-text">${frappe.utils.escape_html(d)}</span>`;
                }).join(" ");
            } else {
                detailCapsulesHtml = `<span class="text-muted text-xs font-mono">-</span>`;
            }

            const rowClass = r.is_draft ? "reim-row-draft" : "";
            const tagClass = r.is_draft ? "reim-tag-draft" : "picker-status-tag";
            const key = this.get_row_key(r);
            const isSelected = this.selected_map.has(key);

            let actionHtml = '-';
            if (r.is_draft) {
                if (r.can_delete) {
                    actionHtml = `<button type="button" class="reim-btn-delete-doc" data-rr-name="${r.rr_name}" data-is-draft="1" title="删除草稿及关联草稿单据">删除</button>`;
                }
            } else {
                const btns = [];
                if (flt(r.outstanding_amount) > 0) {
                    btns.push(`<button type="button" class="btn btn-default btn-xs reim-quick-pay-btn" data-rr-name="${r.rr_name}" data-supplier="${frappe.utils.escape_html(r.supplier_preview || r.suppliers || '')}" data-amt="${r.outstanding_amount}" data-total="${r.total_amount}" title="为此报销单快速执行比例付款">付款</button>`);
                }
                if (r.can_delete) {
                    btns.push(`<button type="button" class="reim-btn-delete-doc" data-rr-name="${r.rr_name}" data-is-draft="0" title="作废并删除已提交报销单及关联单据">删除</button>`);
                }
                actionHtml = btns.length ? btns.join(" ") : '-';
            }

            return `
                <tr class="ashan-row-clickable ${rowClass} ${isSelected ? 'row-selected' : ''}" data-rr-name="${r.rr_name}" data-docstatus="${r.docstatus}" data-key="${key}">
                    <td class="picker-col-sticky-1 text-center font-bold text-muted">${idx + 1}</td>
                    <td class="picker-col-sticky-2 text-center">
                        <input type="checkbox" class="picker-row-checkbox" data-key="${key}" ${isSelected ? 'checked' : ''} />
                    </td>
                    <td class="picker-col-sticky-3">
                        <span class="${r.is_draft ? 'picker-clickable-doc' : 'font-mono font-bold'}" ${r.is_draft ? `data-rr-name="${r.rr_name}" title="点击编辑草稿"` : ''}>${r.rr_name}</span>
                    </td>
                    <td>${r.company}</td>
                    <td class="text-center font-mono">${r.posting_date}</td>
                    <td>
                        <span class="font-bold">${r.invoice_count || 1} 张</span>
                        <div class="text-muted text-xs font-mono">${r.invoice_preview || r.invoice_nos}</div>
                    </td>
                    <td>
                        <span class="font-bold">${r.supplier_count || 1} 个商户</span>
                        <div class="text-muted text-xs">${r.supplier_preview || r.suppliers}</div>
                    </td>
                    <td>
                        <div class="reim-details-cell">${detailCapsulesHtml}</div>
                    </td>
                    <td class="text-right font-mono font-bold text-primary">${format_currency(r.total_amount)}</td>
                    <td class="text-right font-mono font-bold ${flt(r.outstanding_amount) > 0 ? 'text-amber-600' : 'text-green-600'}">${format_currency(r.outstanding_amount)}</td>
                    <td class="text-center">
                        <span class="${tagClass}">${r.status_label}</span>
                    </td>
                    <td><span class="text-muted text-xs font-mono">${r.linked_pis || '-'}</span></td>
                    <td class="text-center">${actionHtml}</td>
                </tr>
            `;
        }).join("");

        $("#reim-table-body").html(bodyHtml);

        const footHtml = `
            <tr>
                <td colspan="8" class="text-right font-bold">合计 (${rows.length} 笔):</td>
                <td class="text-right font-mono font-bold text-primary">${format_currency(totalAmt)}</td>
                <td class="text-right font-mono font-bold text-amber-600">${format_currency(totalOut)}</td>
                <td colspan="3"></td>
            </tr>
        `;
        $("#reim-table-foot").html(footHtml);
        this.update_selection_summary();
    }

    render_detail_view(rows) {
        const thead = `
            <tr>
                <th class="picker-col-sticky-1 col-w-seq text-center">#</th>
                <th class="picker-col-sticky-2 col-w-check text-center">
                    <input type="checkbox" id="reim-select-all-header" title="全选/取消全选" />
                </th>
                <th class="picker-col-sticky-3 col-w-docname">报销单号</th>
                <th class="col-w-company">所属公司</th>
                <th class="col-w-supplier">供应商</th>
                <th class="col-w-invoice-no">发票号码</th>
                <th class="col-w-status text-center">发票类型</th>
                <th class="col-w-item-name">物料名称</th>
                <th class="col-w-spec">规格</th>
                <th class="col-w-qty text-right">数量</th>
                <th class="col-w-rate text-right">单价</th>
                <th class="col-w-total text-right">报销金额</th>
                <th class="col-w-status text-center">单据状态</th>
                <th class="col-w-docname">来源采购发票</th>
                <th class="col-w-action text-center">操作</th>
            </tr>
        `;
        $("#reim-table-head").html(thead);

        if (!rows.length) {
            $("#reim-table-body").html(`
                <tr>
                    <td colspan="15" class="picker-empty-state">
                        <div class="picker-empty-icon">无记录</div>
                        <div class="picker-empty-text">当前筛选条件下暂无报销明细数据</div>
                    </td>
                </tr>
            `);
            $("#reim-table-foot").empty();
            this.update_selection_summary();
            return;
        }

        let totalQty = 0;
        let totalAmt = 0;

        const bodyHtml = rows.map((r, idx) => {
            totalQty += flt(r.qty);
            totalAmt += flt(r.amount);

            const isDraft = r.docstatus === 0;
            const key = this.get_row_key(r);
            const isSelected = this.selected_map.has(key);
            const actionHtml = r.can_delete ? `<button type="button" class="reim-btn-delete-doc" data-rr-name="${r.rr_name}" data-is-draft="${isDraft ? 1 : 0}" title="${isDraft ? '删除草稿及关联草稿单据' : '作废并删除报销单及关联单据'}">删除</button>` : '-';

            return `
                <tr class="ashan-row-clickable ${isDraft ? 'reim-row-draft' : ''} ${isSelected ? 'row-selected' : ''}" data-rr-name="${r.rr_name}" data-docstatus="${r.docstatus}" data-key="${key}">
                    <td class="picker-col-sticky-1 text-center font-bold text-muted">${idx + 1}</td>
                    <td class="picker-col-sticky-2 text-center">
                        <input type="checkbox" class="picker-row-checkbox" data-key="${key}" ${isSelected ? 'checked' : ''} />
                    </td>
                    <td class="picker-col-sticky-3">
                        <span class="${isDraft ? 'picker-clickable-doc' : 'font-mono font-bold'}" ${isDraft ? `data-rr-name="${r.rr_name}" title="点击编辑草稿"` : ''}>${r.rr_name}</span>
                    </td>
                    <td>${r.company}</td>
                    <td>${r.supplier || '-'}</td>
                    <td><span class="font-mono text-muted font-bold">${r.invoice_no || '-'}</span></td>
                    <td class="text-center"><span class="picker-status-tag">${r.invoice_type || '专用发票'}</span></td>
                    <td><span class="font-bold">${r.item_name}</span></td>
                    <td>${r.spec || '-'}</td>
                    <td class="text-right font-mono">${r.qty}</td>
                    <td class="text-right font-mono">${format_currency(r.rate)}</td>
                    <td class="text-right font-mono font-bold text-primary">${format_currency(r.amount)}</td>
                    <td class="text-center"><span class="${isDraft ? 'reim-tag-draft' : 'picker-status-tag'}">${r.status_label}</span></td>
                    <td><span class="text-muted font-mono text-xs">${r.source_pi}</span></td>
                    <td class="text-center">${actionHtml}</td>
                </tr>
            `;
        }).join("");

        $("#reim-table-body").html(bodyHtml);

        const footHtml = `
            <tr>
                <td colspan="9" class="text-right font-bold">合计:</td>
                <td class="text-right font-mono font-bold">${totalQty.toFixed(2)}</td>
                <td></td>
                <td class="text-right font-mono font-bold text-primary">${format_currency(totalAmt)}</td>
                <td colspan="3"></td>
            </tr>
        `;
        $("#reim-table-foot").html(footHtml);
        this.update_selection_summary();
    }

    // =========================================================================
    // Multi-Invoice Manual Entry & Edit Modal Engine
    // =========================================================================

    open_create_reimbursement_modal() {
        this.reset_creation_state(false, null);
        this.show_reimbursement_dialog(__("新建现金报销"));
        this.add_invoice_card();
    }

    async open_manage_reimbursement_modal(rrName) {
        try {
            const r = await frappe.call({
                method: REIM_API.get_detail,
                args: { rr_name: rrName },
            });
            if (r.message) {
                const data = r.message;
                // Current draft editing replaces the old draft bundle atomically;
                // it therefore requires both write and delete permission.
                if (Number(data.docstatus) !== 0 || !data.can_write || !data.can_delete) {
                    this.show_reimbursement_detail_dialog(data);
                    return;
                }
                this.reset_creation_state(true, rrName);
                this.creation.can_delete = Boolean(data.can_delete);
                this.show_reimbursement_dialog(__(`报销单管理 · ${rrName}`));
                this.creation.company = data.company;
                this.creation.posting_date = data.posting_date;
                this.creation.title = data.title;

                if (this.creation.$wrapper) {
                    this.creation.$wrapper.find("#modal-reim-company").val(data.company);
                    this.creation.$wrapper.find("#modal-reim-date").val(data.posting_date);
                    this.creation.$wrapper.find("#modal-reim-title").val(data.title);
                }

                if (data.invoices && data.invoices.length) {
                    data.invoices.forEach((inv) => {
                        this.add_invoice_card(inv);
                    });
                } else {
                    this.add_invoice_card();
                }
                this.recalculate_all();
            }
        } catch (e) {
            console.error("Failed to load reimbursement detail:", e);
        }
    }

    async show_reimbursement_detail_by_name(rrName) {
        try {
            const r = await frappe.call({
                method: REIM_API.get_detail,
                args: { rr_name: rrName },
            });
            if (r.message) {
                this.show_reimbursement_detail_dialog(r.message);
            }
        } catch (e) {
            console.error("Failed to load reimbursement detail:", e);
        }
    }

    show_reimbursement_detail_dialog(data) {
        const isDraft = Number(data.docstatus) === 0;
        const invoiceHtml = (data.invoices || []).map((invoice, invoiceIndex) => {
            const itemRows = (invoice.items || []).map((item, itemIndex) => `
                <tr>
                    <td class="picker-modal-col-seq font-bold text-muted">${itemIndex + 1}</td>
                    <td class="picker-modal-col-name">${frappe.utils.escape_html(item.item_name || "-")}</td>
                    <td class="picker-modal-col-spec">${frappe.utils.escape_html(item.spec || "-")}</td>
                    <td class="picker-modal-col-uom">${frappe.utils.escape_html(item.uom || "-")}</td>
                    <td class="picker-modal-col-qty qifu-money-cell">${flt(item.qty).toFixed(2)}</td>
                    <td class="picker-modal-col-rate qifu-money-cell">${format_currency(item.rate)}</td>
                    <td class="picker-modal-col-amount qifu-money-cell">${format_currency(item.amount)}</td>
                    <td class="picker-modal-col-tax-rate">${flt(item.tax_rate).toFixed(2)}%</td>
                    <td class="picker-modal-col-tax-amount qifu-money-cell">${format_currency(item.tax_amount)}</td>
                    <td class="picker-modal-col-total qifu-money-cell">${format_currency(item.line_total)}</td>
                    <td class="picker-modal-col-remarks">${frappe.utils.escape_html(item.remarks || "-")}</td>
                </tr>
            `).join("") || '<tr><td colspan="11" class="text-center text-muted">无物料明细</td></tr>';
            return `
                <div class="ashan-smart-section">
                    <div class="ashan-smart-section-header">
                        <div class="ashan-smart-section-title">
                            <span>发票 ${invoiceIndex + 1}：${frappe.utils.escape_html(invoice.invoice_no || "系统自动编号")}</span>
                        </div>
                    </div>
                    <div class="ashan-smart-grid-3">
                        <div class="ashan-smart-field">
                            <label class="ashan-smart-field-label">发票类型</label>
                            <div class="ashan-smart-static-val">${frappe.utils.escape_html(invoice.invoice_type || "-")}</div>
                        </div>
                        <div class="ashan-smart-field">
                            <label class="ashan-smart-field-label">供应商</label>
                            <div class="ashan-smart-static-val font-bold">${frappe.utils.escape_html(invoice.supplier || "-")}</div>
                        </div>
                        <div class="ashan-smart-field">
                            <label class="ashan-smart-field-label">开票日期</label>
                            <div class="ashan-smart-static-val font-mono">${frappe.utils.escape_html(invoice.invoice_date || "-")}</div>
                        </div>
                    </div>
                    <div class="ashan-smart-table-wrap">
                        <table class="picker-modal-detail-table">
                            <thead>
                                <tr>
                                    <th class="picker-modal-col-seq">#</th>
                                    <th class="picker-modal-col-name">物料名称</th>
                                    <th class="picker-modal-col-spec">规格</th>
                                    <th class="picker-modal-col-uom">单位</th>
                                    <th class="picker-modal-col-qty">数量</th>
                                    <th class="picker-modal-col-rate">单价</th>
                                    <th class="picker-modal-col-amount">不含税金额</th>
                                    <th class="picker-modal-col-tax-rate">税率</th>
                                    <th class="picker-modal-col-tax-amount">税额</th>
                                    <th class="picker-modal-col-total">价税合计</th>
                                    <th class="picker-modal-col-remarks">备注</th>
                                </tr>
                            </thead>
                            <tbody>${itemRows}</tbody>
                        </table>
                    </div>
                </div>
            `;
        }).join("") || '<div class="ashan-smart-section text-center text-muted">无发票明细</div>';

        const self = this;
        const canPay = !isDraft && flt(data.outstanding_amount) > 0;
        const d = AshanUI.createDialog({
            title: __("报销单详情 · {0}", [data.rr_name]),
            fields: [{
                fieldtype: "HTML",
                fieldname: "detail_html",
                options: `
                    <div class="ashan-smart-modal-body">
                        <!-- Section 1: Business Context -->
                        <div class="ashan-smart-section">
                            <div class="ashan-smart-section-header">
                                <div class="ashan-smart-section-title">
                                    <span>${frappe.utils.escape_html(data.title || "现金报销申请")}</span>
                                    <span class="ashan-status-badge ${isDraft ? 'ashan-status-amber' : 'ashan-status-green'}">
                                        ${isDraft ? '待提交草稿' : '已提交只读'}
                                    </span>
                                </div>
                            </div>
                            <div class="ashan-smart-grid-4">
                                <div class="ashan-smart-field">
                                    <label class="ashan-smart-field-label">所属公司</label>
                                    <div class="ashan-smart-static-val">${frappe.utils.escape_html(data.company || "-")}</div>
                                </div>
                                <div class="ashan-smart-field">
                                    <label class="ashan-smart-field-label">申请日期</label>
                                    <div class="ashan-smart-static-val font-mono">${frappe.utils.escape_html(data.posting_date || "-")}</div>
                                </div>
                                <div class="ashan-smart-field">
                                    <label class="ashan-smart-field-label">报销总额</label>
                                    <div class="ashan-smart-static-val font-bold text-primary">${format_currency(data.total_amount)}</div>
                                </div>
                                <div class="ashan-smart-field">
                                    <label class="ashan-smart-field-label">待结款金额</label>
                                    <div class="ashan-smart-static-val font-mono font-bold">${format_currency(data.outstanding_amount)}</div>
                                </div>
                            </div>
                        </div>

                        <!-- Section 2: Invoices List -->
                        ${invoiceHtml}
                    </div>
                `,
            }],
            primary_action_label: canPay ? __("执行比例付款") : null,
            primary_action: canPay ? function () {
                d.hide();
                const firstSupp = (data.invoices && data.invoices[0]) ? data.invoices[0].supplier : "";
                self.open_reimbursement_payment_modal(data.rr_name, firstSupp, data.outstanding_amount, data.total_amount);
            } : null,
            secondary_action_label: __("关闭"),
            secondary_action() {
                d.hide();
                setTimeout(() => {
                    $(".modal-backdrop").remove();
                    $("body").removeClass("modal-open");
                }, 300);
            },
        });

        if (data.can_delete) {
            d.add_custom_action(isDraft ? __("删除草稿") : __("作废并删除"), () => {
                self.confirm_delete_reimbursement(data.rr_name, isDraft, () => {
                    d.hide();
                });
            }, "reim-btn-danger");
        }

        d.$wrapper.find(".modal-dialog").addClass("ashan-smart-modal");
        d.show();
    }

    open_reimbursement_payment_modal(rr_name, supplier, default_amt, grand_total = 0) {
        const self = this;
        const outstandingAmt = flt(default_amt) > 0 ? flt(default_amt) : 0;
        const totalOrderAmt = flt(grand_total) > 0 ? flt(grand_total) : (outstandingAmt > 0 ? outstandingAmt : 0);
        const alreadyPaidAmt = Math.max(0, flt(totalOrderAmt - outstandingAmt, 2));

        const d = new frappe.ui.Dialog({
            title: __("报销整算 · 智能分期付款"),
            size: "medium",
            static: true,
            fields: [
                {
                    fieldtype: "HTML",
                    fieldname: "pay_info_html",
                },
                {
                    fieldname: "paid_amount",
                    label: __("本次实付金额 (¥)"),
                    fieldtype: "Currency",
                    default: outstandingAmt,
                    reqd: 1,
                },
                {
                    fieldname: "mode_of_payment",
                    label: __("付款方式"),
                    fieldtype: "Select",
                    options: ["电汇", "银行转账", "现金", "支票", "Wire Transfer"],
                    default: "电汇",
                    reqd: 1,
                },
                {
                    fieldname: "posting_date",
                    label: __("付款/出账日期"),
                    fieldtype: "Date",
                    default: frappe.datetime.get_today(),
                    reqd: 1,
                },
                {
                    fieldname: "reference_no",
                    label: __("银行交易流水号 / 付款参考号"),
                    fieldtype: "Data",
                    placeholder: "选填，例如：WT-BANK-20260829-001 或 银行回单号",
                },
                {
                    fieldname: "remarks",
                    label: __("付款备注"),
                    fieldtype: "Small Text",
                    default: `现金报销款项出账 · 报销单: ${rr_name} · 收款方: ${supplier || '-'}`,
                },
            ],
            primary_action_label: __("确认执行付款"),
            secondary_action_label: __("取消"),
            secondary_action: function () {
                d.hide();
            },
            primary_action: async function (values) {
                const payAmt = flt(values.paid_amount);
                if (!payAmt || payAmt <= 0) {
                    frappe.msgprint(__("付款金额必须大于 0！"));
                    return;
                }
                if (payAmt > outstandingAmt + 0.01) {
                    frappe.msgprint(__("本次付款金额 (¥ {0}) 不能大于待结款余额 (¥ {1})！", [payAmt.toFixed(2), outstandingAmt.toFixed(2)]));
                    return;
                }
                try {
                    frappe.dom.freeze(__("正在生成并提交付款单..."));
                    const r = await frappe.call({
                        method: "ashan_cn_procurement.services.reimbursement_picker_service.create_reimbursement_payment_entry",
                        args: {
                            rr_name: rr_name,
                            paid_amount: values.paid_amount,
                            mode_of_payment: values.mode_of_payment,
                            posting_date: values.posting_date,
                            reference_no: values.reference_no,
                            remarks: values.remarks,
                        },
                    });
                    frappe.dom.unfreeze();
                    d.hide();
                    if (r.message && r.message.success) {
                        frappe.show_alert({
                            message: r.message.message || __("报销付款单生成成功！"),
                            indicator: "green",
                        }, 5);
                        self.load_overview_data();
                        self.load_reimbursements();
                    }
                } catch (err) {
                    frappe.dom.unfreeze();
                    console.error("Failed to create reimbursement payment entry:", err);
                }
            },
        });

        d.$wrapper.find(".modal-dialog").addClass("ashan-smart-modal");

        const update_calculations = (payAmt) => {
            const currentPay = Math.max(0, flt(payAmt, 2));
            const remainAfter = Math.max(0, flt(outstandingAmt - currentPay, 2));
            const totalPaidAfter = flt(alreadyPaidAmt + currentPay, 2);

            const totalBase = totalOrderAmt > 0 ? totalOrderAmt : outstandingAmt;
            const paidPct = totalBase > 0 ? (alreadyPaidAmt / totalBase * 100).toFixed(1) : "0.0";
            const currentPct = totalBase > 0 ? (currentPay / totalBase * 100).toFixed(1) : "0.0";
            const remainPct = totalBase > 0 ? (remainAfter / totalBase * 100).toFixed(1) : "0.0";

            d.$wrapper.find("#smart-rr-pay-current-amt").text(format_currency(currentPay));
            d.$wrapper.find("#smart-rr-pay-current-pct").text(`${currentPct}%`);
            d.$wrapper.find("#smart-rr-pay-remain-amt").text(format_currency(remainAfter));
            d.$wrapper.find("#smart-rr-pay-remain-pct").text(`${remainPct}%`);

            d.$wrapper.find("#smart-rr-bar-paid").css("width", `${Math.min(100, flt(paidPct))}%`);
            d.$wrapper.find("#smart-rr-bar-current").css("width", `${Math.min(100, flt(currentPct))}%`);

            if (currentPay > outstandingAmt + 0.01) {
                d.$wrapper.find("#smart-rr-pay-remain-badge").addClass("warning").html(`超出待结款欠款 ¥ ${format_currency(currentPay - outstandingAmt)}`);
            } else {
                d.$wrapper.find("#smart-rr-pay-remain-badge").removeClass("warning").html(`付款后剩余待结: <strong>${format_currency(remainAfter)}</strong> (${remainPct}%)`);
            }
        };

        const pay_info_html = `
            <div class="ashan-payment-calc-card">
                <div class="ashan-smart-grid-3">
                    <div><span class="text-xs text-muted">报销单号:</span> <span class="font-mono text-primary font-bold">${frappe.utils.escape_html(rr_name)}</span></div>
                    <div><span class="text-xs text-muted">涉及商户:</span> <span class="font-bold text-slate-800">${frappe.utils.escape_html(supplier || '-')}</span></div>
                    <div><span class="text-xs text-muted">报销总额:</span> <span class="font-mono text-slate-700 font-bold">${format_currency(totalOrderAmt)}</span></div>
                </div>

                <div class="ashan-payment-divider">
                    <div class="ashan-payment-preset-header">
                        <span class="text-xs font-bold text-slate-700">快捷比例分期付款:</span>
                        <span class="ashan-remain-badge" id="smart-rr-pay-remain-badge">付款后剩余待结: <strong>${format_currency(0)}</strong></span>
                    </div>
                    <div class="ashan-percent-pill-group">
                        <button type="button" class="ashan-percent-pill" data-pct="20">20% 预付/定金</button>
                        <button type="button" class="ashan-percent-pill" data-pct="30">30% 进度款</button>
                        <button type="button" class="ashan-percent-pill" data-pct="50">50% 中期款</button>
                        <button type="button" class="ashan-percent-pill" data-pct="80">80% 阶段款</button>
                        <button type="button" class="ashan-percent-pill active" data-pct="100">100% 全额结清</button>
                    </div>
                </div>

                <div class="ashan-payment-progress-wrap">
                    <div class="ashan-payment-progress-labels">
                        <span>已结累计: ${format_currency(alreadyPaidAmt)}</span>
                        <span>本次实付: <strong class="text-blue-600 font-mono" id="smart-rr-pay-current-amt">${format_currency(outstandingAmt)}</strong> (<span id="smart-rr-pay-current-pct">100%</span>)</span>
                    </div>
                    <div class="ashan-payment-progress-bar">
                        <div class="ashan-progress-paid ashan-progress-init-0" id="smart-rr-bar-paid"></div>
                        <div class="ashan-progress-current ashan-progress-init-100" id="smart-rr-bar-current"></div>
                        <div class="ashan-progress-remain"></div>
                    </div>
                </div>
            </div>
        `;
        d.set_value("pay_info_html", pay_info_html);
        d.show();

        // 绑定比例点击事件
        d.$wrapper.on("click", ".ashan-percent-pill", function () {
            d.$wrapper.find(".ashan-percent-pill").removeClass("active");
            $(this).addClass("active");
            const pct = flt($(this).data("pct"));
            let targetAmt = 0;
            if (pct === 100) {
                targetAmt = outstandingAmt;
            } else {
                const base = totalOrderAmt > 0 ? totalOrderAmt : outstandingAmt;
                targetAmt = flt(base * (pct / 100), 2);
                if (targetAmt > outstandingAmt) targetAmt = outstandingAmt;
            }
            d.set_value("paid_amount", targetAmt);
            update_calculations(targetAmt);
        });

        // 监听金额输入变动
        d.$wrapper.find('input[data-fieldname="paid_amount"]').on("input change", function () {
            d.$wrapper.find(".ashan-percent-pill").removeClass("active");
            const val = flt($(this).val());
            update_calculations(val);
        });

        update_calculations(outstandingAmt);
    }

    reset_creation_state(isEdit = false, rrName = null) {
        this.creation.is_edit = isEdit;
        this.creation.current_rr_name = rrName;
        this.creation.can_delete = false;
        this.creation.company = window.AshanWorkContext
            ? (window.AshanWorkContext.getCompany() || null)
            : (this.active_company !== "All" ? this.active_company : (this.companies[0] || null));
        this.creation.posting_date = window.AshanWorkContext?.getWorkDate?.() || frappe.datetime.get_today();
        this.creation.title = "";
        this.creation.auto_receive_stock = 1;
        this.creation.invoices = [];
        this.creation.invoice_counter = 0;
        this.creation.$wrapper = null;
    }

    show_reimbursement_dialog(title) {
        if (this.creation.dialog) {
            try {
                this.creation.dialog.hide();
            } catch (e) {}
            this.creation.dialog = null;
        }
        $(".modal-backdrop").remove();
        $("body").removeClass("modal-open");
        $(".modal:has(.reim-v2-modal-container)").remove();

        const isEdit = this.creation.is_edit;
        const me = this;

        const d = AshanUI.createDialog({
            title: title,
            size: "extra-large",
            fields: [
                {
                    fieldtype: "HTML",
                    fieldname: "root_html",
                },
            ],
            primary_action_label: isEdit ? __("保存修改并过账") : __("确认创建并过账"),
            primary_action: () => this.submit_manual_reimbursement(0),
        });

        // 显式配置底部取消 / 关闭次级操作按钮
        d.set_secondary_action_label(__("关闭"));
        d.set_secondary_action(() => {
            me.close_dialog();
        });

        if (!isEdit) {
            d.add_custom_action(__("暂存草稿"), () => {
                me.submit_manual_reimbursement(1);
            }, "reim-btn-save-draft");
        } else if (this.creation.can_delete) {
            d.add_custom_action(__("删除整单"), () => {
                me.confirm_delete_reimbursement(me.creation.current_rr_name, true, () => {
                    me.close_dialog();
                });
            }, "reim-btn-danger");
        }

        this.creation.dialog = d;
        d.show();

        // 显式在 modal-header 注入右上角关闭按钮
        const $modalHeader = d.$wrapper.find(".modal-header");
        $modalHeader.find(".reim-modal-header-close-btn").remove();
        const $closeBtn = $(`<button type="button" class="reim-modal-header-close-btn" title="关闭窗口">✕</button>`);
        $closeBtn.on("click", () => {
            me.close_dialog();
        });
        $modalHeader.append($closeBtn);

        const $wrapper = d.fields_dict.root_html.$wrapper;
        this.creation.$wrapper = $wrapper;
        $wrapper.html(this.get_creation_dialog_html());

        this.populate_company_dropdown($wrapper);
        this.bind_creation_dialog_events($wrapper);
    }

    close_dialog() {
        if (this.creation.dialog) {
            try {
                this.creation.dialog.hide();
            } catch (e) {}
            this.creation.dialog = null;
        }
        this.creation.$wrapper = null;
        $(".modal-backdrop").remove();
        $("body").removeClass("modal-open");
    }

    populate_company_dropdown($wrapper) {
        const $sel = $wrapper.find("#modal-reim-company");
        $sel.empty();
        const comps = this.companies.length ? this.companies : [this.creation.company].filter(Boolean);
        if (!this.creation.company) {
            $sel.append('<option value="" selected>请选择公司</option>');
        }
        comps.forEach((c) => {
            $sel.append(`<option value="${c}">${c}</option>`);
        });
        if (this.creation.company) {
            $sel.val(this.creation.company);
        }
    }

    get_creation_dialog_html() {
        return `
            <div class="reim-v2-modal-container">
                <!-- Section 1: Business Context -->
                <div class="reim-v2-section-card">
                    <div class="reim-v2-section-header">
                        <div class="reim-v2-section-title">1. 报销业务信息</div>
                    </div>
                    <div class="reim-v2-grid-2">
                        <div class="reim-v2-field-group">
                            <label>所属公司<span class="req">*</span></label>
                            <select id="modal-reim-company" class="reim-v2-input-control"></select>
                        </div>
                        <div class="reim-v2-field-group">
                            <label>报销申请日期<span class="req">*</span></label>
                            <input type="date" id="modal-reim-date" class="reim-v2-input-control" value="${window.AshanWorkContext?.getWorkDate?.() || frappe.datetime.get_today()}" />
                        </div>
                        <div class="reim-full-width-field">
                            <label>报销标题<span class="req">*</span></label>
                            <input type="text" id="modal-reim-title" class="reim-v2-input-control" placeholder="例: 8月差旅与零星物料采购报销..." />
                        </div>
                    </div>
                    <label class="reim-v2-toggle-box">
                        <input type="checkbox" id="modal-reim-auto-stock" checked />
                        <span>包含允许维护库存的物料时，系统自动生成采购入库单并完成过账（默认开启）</span>
                    </label>
                </div>

                <!-- Section 2: Invoice Cards Workspace -->
                <div class="reim-v2-section-card">
                    <div class="reim-v2-section-header">
                        <div class="reim-v2-section-title">
                            <span>2. 发票列表与录单工作区</span>
                            <span class="text-muted text-xs font-normal">（专用发票/普通发票号码必填，明细备注为必填项）</span>
                        </div>
                        <div>
                            <button type="button" class="reim-btn-add-inv-card" id="modal-reim-add-inv-btn">
                                <span>➕ 添加发票</span>
                            </button>
                        </div>
                    </div>

                    <!-- Invoices List Container -->
                    <div class="reim-inv-flow-container" id="modal-reim-invoices-container"></div>
                </div>

                <!-- Section 3: Summary Dashboard & Submit -->
                <div class="reim-v2-summary-bar">
                    <div class="reim-v2-summary-left">
                        <div class="reim-v2-discipline-badge">
                            <span>财务纪律</span>
                            <span>发票号、单价与备注必填有效，1张发票对应1张采购发票并自动关联报销单</span>
                        </div>
                    </div>
                    <div class="reim-v2-summary-stats">
                        <div class="reim-v2-stat-item">
                            <span class="reim-v2-stat-label">已录发票</span>
                            <span class="reim-v2-stat-val" id="modal-reim-sum-inv-count">0 张</span>
                        </div>
                        <div class="reim-v2-stat-item">
                            <span class="reim-v2-stat-label">涉及商户</span>
                            <span class="reim-v2-stat-val" id="modal-reim-sum-supp-count">0 个</span>
                        </div>
                        <div class="reim-v2-stat-item">
                            <span class="reim-v2-stat-label">本次报销总额 (应付)</span>
                            <span class="reim-v2-stat-val primary" id="modal-reim-sum-grand-total">¥ 0.00</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    bind_creation_dialog_events($wrapper) {
        const me = this;

        $wrapper.on("change", "#modal-reim-company", function () {
            me.creation.company = $(this).val();
        });

        $wrapper.on("click", "#modal-reim-add-inv-btn", function () {
            me.add_invoice_card();
        });

        $wrapper.on("click", ".reim-btn-delete-inv", function () {
            const invId = $(this).closest(".reim-inv-card").data("inv-id");
            me.remove_invoice_card(invId);
        });

        // 分段控件切换发票类型与默认税率联动
        $wrapper.on("click", ".reim-segment-btn", function () {
            const $btn = $(this);
            const $control = $btn.closest(".reim-segmented-control");
            const invId = $control.data("inv-id");
            const val = $btn.data("value");

            $control.find(".reim-segment-btn").removeClass("active");
            $btn.addClass("active");
            $control.siblings(".modal-inv-type-value").val(val);

            const $card = me.creation.$wrapper ? me.creation.$wrapper.find(`#reim-inv-card-${invId}`) : $(`#reim-inv-card-${invId}`);
            const $noInput = $card.find(".modal-inv-no-input");
            const $noReq = $card.find(".modal-inv-no-req");

            if (val === "无发票") {
                $noInput.val("").prop("placeholder", "无发票 (系统自动编号)").prop("disabled", true);
                $noReq.addClass("reim-v2-hidden");
                $card.find(".modal-row-tax-rate").val("0").prop("disabled", true);
            } else if (val === "普通发票") {
                $noInput.prop("placeholder", "输入发票号码 (必填)...").prop("disabled", false);
                $noReq.removeClass("reim-v2-hidden");
                // 普通发票允许填写税率，默认设为 1%
                $card.find(".modal-row-tax-rate").prop("disabled", false);
                $card.find(".modal-row-tax-rate").each(function () {
                    if ($(this).val() === "0" || $(this).val() === "13" || !$(this).val()) {
                        $(this).val("1");
                    }
                });
            } else {
                $noInput.prop("placeholder", "输入发票号码 (必填)...").prop("disabled", false);
                $noReq.removeClass("reim-v2-hidden");
                // 专用发票默认 13%
                $card.find(".modal-row-tax-rate").prop("disabled", false);
                $card.find(".modal-row-tax-rate").each(function () {
                    if ($(this).val() === "0" || $(this).val() === "1" || !$(this).val()) {
                        $(this).val("13");
                    }
                });
            }

            $card.find(".modal-inv-tbody tr").each(function () {
                me.handle_row_calc("tax_rate", $(this), invId);
            });
            me.recalculate_invoice(invId);
        });

        $wrapper.on("click", ".reim-btn-add-item-row", function () {
            const invId = $(this).closest(".reim-inv-card").data("inv-id");
            me.add_item_row(invId);
        });

        $wrapper.on("click", ".reim-btn-delete-row", function () {
            const $row = $(this).closest("tr");
            const invId = $(this).closest(".reim-inv-card").data("inv-id");
            $row.remove();
            me.recalculate_invoice(invId);
        });

        // 1. 物料模糊搜索与智能下拉
        let itemSuggestTimer = null;
        $wrapper.on("input focus", ".modal-row-item-input", function () {
            const $input = $(this);
            const $wrap = $input.closest(".picker-suggest-wrapper");
            const $dd = $wrap.find(".picker-suggest-dropdown");
            const val = $input.val().trim().toLowerCase();

            clearTimeout(itemSuggestTimer);
            itemSuggestTimer = setTimeout(() => {
                const matched = me.cached_items.filter((it) => {
                    if (!val) return true;
                    return (it.item_code && it.item_code.toLowerCase().includes(val)) ||
                           (it.item_name && it.item_name.toLowerCase().includes(val)) ||
                           (it.spec && it.spec.toLowerCase().includes(val));
                }).slice(0, 15);

                let ddHtml = "";
                matched.forEach((it) => {
                    ddHtml += `
                        <div class="picker-suggest-item reim-suggest-item-entry"
                             data-code="${frappe.utils.escape_html(it.item_code)}"
                             data-name="${frappe.utils.escape_html(it.item_name)}"
                             data-spec="${frappe.utils.escape_html(it.spec || '')}"
                             data-uom="${frappe.utils.escape_html(it.uom || '个')}"
                             data-rate="${it.rate || 0}">
                            <div class="picker-suggest-main">
                                <span class="picker-suggest-code">${frappe.utils.escape_html(it.item_code)}</span>
                                <span class="picker-suggest-name">${frappe.utils.escape_html(it.item_name)} (${it.uom || '个'})</span>
                            </div>
                            <div class="picker-suggest-price">¥ ${flt(it.rate || 0).toFixed(2)}</div>
                        </div>
                    `;
                });

                ddHtml += `
                    <div class="picker-suggest-create-btn reim-suggest-create-item-btn">
                        <span>➕</span>
                        <span>新建物料 (Create Item)</span>
                    </div>
                `;

                $dd.html(ddHtml).addClass("is-open");

                const rect = $input[0].getBoundingClientRect();
                $dd.css({
                    top: (rect.bottom + 2) + "px",
                    left: rect.left + "px",
                    width: Math.max(rect.width, 360) + "px",
                });
            }, 150);
        });

        $wrapper.on("click", ".reim-suggest-item-entry", function (e) {
            e.stopPropagation();
            const $row = $(this).closest("tr");
            const code = $(this).data("code");
            const name = $(this).data("name");
            const spec = $(this).data("spec");
            const uom = $(this).data("uom");

            $row.find(".modal-row-item-input").val(name);
            $row.find(".modal-row-item-code").val(code);
            $row.find(".modal-row-item-name").val(name);
            $row.find(".modal-row-spec").val(spec || "-");
            $row.find(".modal-row-uom").val(uom || "个");

            $wrapper.find(".picker-suggest-dropdown").removeClass("is-open");
        });

        $wrapper.on("click", ".reim-suggest-create-item-btn", function (e) {
            e.stopPropagation();
            const $row = $(this).closest("tr");
            $wrapper.find(".picker-suggest-dropdown").removeClass("is-open");
            me.open_quick_create_item_dialog($row);
        });

        // 2. 供应商模糊搜索与智能下拉
        let suppSuggestTimer = null;
        $wrapper.on("input focus", ".modal-inv-supplier-input", function () {
            const $input = $(this);
            const $wrap = $input.closest(".picker-suggest-wrapper");
            const $dd = $wrap.find(".picker-suggest-dropdown");
            const val = $input.val().trim().toLowerCase();

            clearTimeout(suppSuggestTimer);
            suppSuggestTimer = setTimeout(() => {
                const matched = me.cached_suppliers.filter((s) => {
                    if (!val) return true;
                    return (s.supplier && s.supplier.toLowerCase().includes(val)) ||
                           (s.supplier_name && s.supplier_name.toLowerCase().includes(val));
                }).slice(0, 15);

                let ddHtml = "";
                matched.forEach((s) => {
                    ddHtml += `
                        <div class="picker-suggest-item reim-suggest-supp-entry"
                             data-code="${frappe.utils.escape_html(s.supplier)}"
                             data-name="${frappe.utils.escape_html(s.supplier_name || s.supplier)}">
                            <div class="picker-suggest-main">
                                <span class="picker-suggest-code">${frappe.utils.escape_html(s.supplier)}</span>
                                <span class="picker-suggest-name">${frappe.utils.escape_html(s.supplier_name || s.supplier)}</span>
                            </div>
                        </div>
                    `;
                });

                ddHtml += `
                    <div class="picker-suggest-create-btn reim-suggest-create-supp-btn">
                        <span>➕</span>
                        <span>新建供应商 (Create Supplier)</span>
                    </div>
                `;

                $dd.html(ddHtml).addClass("is-open");

                const rect = $input[0].getBoundingClientRect();
                $dd.css({
                    top: (rect.bottom + 2) + "px",
                    left: rect.left + "px",
                    width: Math.max(rect.width, 360) + "px",
                });
            }, 150);
        });

        $wrapper.on("click", ".reim-suggest-supp-entry", function (e) {
            e.stopPropagation();
            const $card = $(this).closest(".reim-inv-card");
            const suppName = $(this).data("name") || $(this).data("code");
            $card.find(".modal-inv-supplier-input").val(suppName);
            $wrapper.find(".picker-suggest-dropdown").removeClass("is-open");
            me.recalculate_all();
        });

        $wrapper.on("click", ".reim-suggest-create-supp-btn", function (e) {
            e.stopPropagation();
            const $card = $(this).closest(".reim-inv-card");
            $wrapper.find(".picker-suggest-dropdown").removeClass("is-open");
            me.open_quick_create_supplier_dialog($card);
        });

        $(document).off("click.reim_suggest").on("click.reim_suggest", (e) => {
            if (!$(e.target).closest(".picker-suggest-wrapper").length && !$(e.target).closest(".picker-suggest-dropdown").length) {
                $wrapper.find(".picker-suggest-dropdown.is-open").removeClass("is-open");
            }
        });

        $wrapper.closest(".modal-body").off("scroll.reim_suggest").on("scroll.reim_suggest", () => {
            $wrapper.find(".picker-suggest-dropdown.is-open").removeClass("is-open");
        });

        // Calculation Handlers
        $wrapper.on("input", ".modal-row-qty", function () {
            const $row = $(this).closest("tr");
            const invId = $(this).closest(".reim-inv-card").data("inv-id");
            me.handle_row_calc("qty", $row, invId);
        });

        $wrapper.on("input", ".modal-row-rate", function () {
            const $row = $(this).closest("tr");
            const invId = $(this).closest(".reim-inv-card").data("inv-id");
            me.handle_row_calc("rate", $row, invId);
        });

        $wrapper.on("input", ".modal-row-tax-rate", function () {
            const $row = $(this).closest("tr");
            const invId = $(this).closest(".reim-inv-card").data("inv-id");
            me.handle_row_calc("tax_rate", $row, invId);
        });

        $wrapper.on("input", ".modal-row-amount-input", function () {
            const $row = $(this).closest("tr");
            const invId = $(this).closest(".reim-inv-card").data("inv-id");
            me.handle_row_calc("amount", $row, invId);
        });

        $wrapper.on("input", ".modal-row-tax-amount-input", function () {
            const $row = $(this).closest("tr");
            const invId = $(this).closest(".reim-inv-card").data("inv-id");
            me.handle_row_calc("tax_amount", $row, invId);
        });

        $wrapper.on("input", ".modal-row-line-total-input", function () {
            const $row = $(this).closest("tr");
            const invId = $(this).closest(".reim-inv-card").data("inv-id");
            me.handle_row_calc("line_total", $row, invId);
        });
    }

    open_quick_create_item_dialog($row) {
        const me = this;
        const d = new frappe.ui.Dialog({
            title: __("➕ 新建物料 (Create Item)"),
            fields: [
                { fieldtype: "Data", fieldname: "item_code", label: __("物料代码 / 编号"), reqd: 1 },
                { fieldtype: "Data", fieldname: "item_name", label: __("物料名称"), reqd: 1 },
                { fieldtype: "Data", fieldname: "stock_uom", label: __("计量单位"), default: "个", reqd: 1 },
                { fieldtype: "Data", fieldname: "spec", label: __("规格") },
                { fieldtype: "Check", fieldname: "is_stock_item", label: __("允许维护库存品 (Stock Item)"), default: 0 },
            ],
            primary_action_label: __("保存并选中"),
            primary_action: async (values) => {
                try {
                    const r = await frappe.call({
                        method: REIM_API.quick_create_item,
                        type: "POST",
                        args: values,
                    });
                    if (r.message && r.message.success) {
                        d.hide();
                        const it = r.message;
                        me.cached_items.unshift(it);

                        $row.find(".modal-row-item-input").val(it.item_name);
                        $row.find(".modal-row-item-code").val(it.item_code);
                        $row.find(".modal-row-item-name").val(it.item_name);
                        $row.find(".modal-row-spec").val(it.spec || "-");
                        $row.find(".modal-row-uom").val(it.uom || "个");

                        frappe.show_alert({ message: __(`物料 [${it.item_code}] ${it.item_name} 已成功创建并回填！`), indicator: "green" });
                    }
                } catch (err) {
                    console.error("Quick create item error:", err);
                }
            },
        });
        d.show();
    }

    open_quick_create_supplier_dialog($card) {
        const me = this;
        const d = new frappe.ui.Dialog({
            title: __("➕ 新建供应商 (Create Supplier)"),
            fields: [
                { fieldtype: "Data", fieldname: "supplier_name", label: __("供应商 / 商户全称"), reqd: 1 },
            ],
            primary_action_label: __("保存并选中"),
            primary_action: async (values) => {
                try {
                    const r = await frappe.call({
                        method: REIM_API.quick_create_supp,
                        type: "POST",
                        args: values,
                    });
                    if (r.message && r.message.success) {
                        d.hide();
                        const supp = r.message;
                        me.cached_suppliers.unshift(supp);
                        $card.find(".modal-inv-supplier-input").val(supp.supplier_name);
                        me.recalculate_all();
                        frappe.show_alert({ message: __(`供应商 [${supp.supplier_name}] 已成功创建并回填！`), indicator: "green" });
                    }
                } catch (err) {
                    console.error("Quick create supplier error:", err);
                }
            },
        });
        d.show();
    }

    handle_row_calc(triggerField, $row, invId) {
        let qty = flt($row.find(".modal-row-qty").val() || 0);
        let rate = flt($row.find(".modal-row-rate").val() || 0);
        let taxRate = flt($row.find(".modal-row-tax-rate").val() || 0);
        let amount = flt($row.find(".modal-row-amount-input").val() || 0);
        let taxAmount = flt($row.find(".modal-row-tax-amount-input").val() || 0);
        let lineTotal = flt($row.find(".modal-row-line-total-input").val() || 0);

        if (triggerField === "qty" || triggerField === "rate") {
            amount = flt(qty * rate, 2);
            taxAmount = flt(amount * (taxRate / 100.0), 2);
            lineTotal = flt(amount + taxAmount, 2);
        } else if (triggerField === "tax_rate") {
            taxAmount = flt(amount * (taxRate / 100.0), 2);
            lineTotal = flt(amount + taxAmount, 2);
        } else if (triggerField === "amount") {
            if (qty > 0) rate = flt(amount / qty, 4);
            taxAmount = flt(amount * (taxRate / 100.0), 2);
            lineTotal = flt(amount + taxAmount, 2);
        } else if (triggerField === "tax_amount") {
            lineTotal = flt(amount + taxAmount, 2);
            if (amount > 0) taxRate = flt((taxAmount / amount) * 100, 2);
        } else if (triggerField === "line_total") {
            amount = flt(lineTotal / (1 + (taxRate / 100.0)), 2);
            taxAmount = flt(lineTotal - amount, 2);
            if (qty > 0) rate = flt(amount / qty, 4);
        }

        if (triggerField !== "qty") $row.find(".modal-row-qty").val(qty ? qty : "");
        if (triggerField !== "rate") $row.find(".modal-row-rate").val(rate ? rate.toFixed(2) : "");
        if (triggerField !== "tax_rate") $row.find(".modal-row-tax-rate").val(taxRate);
        if (triggerField !== "amount") $row.find(".modal-row-amount-input").val(amount ? amount.toFixed(2) : "");
        if (triggerField !== "tax_amount") $row.find(".modal-row-tax-amount-input").val(taxAmount ? taxAmount.toFixed(2) : "");
        if (triggerField !== "line_total") $row.find(".modal-row-line-total-input").val(lineTotal ? lineTotal.toFixed(2) : "");

        this.recalculate_invoice(invId);
    }

    add_invoice_card(initData = null) {
        this.creation.invoice_counter++;
        const invId = this.creation.invoice_counter;

        const initType = initData ? initData.invoice_type : "专用发票";
        const initSupp = initData ? initData.supplier : "";
        const initNo = initData ? initData.invoice_no : "";
        const initDate = initData ? initData.invoice_date : frappe.datetime.get_today();
        const isNoInv = initType === "无发票";

        const cardHtml = `
            <div class="reim-inv-card" id="reim-inv-card-${invId}" data-inv-id="${invId}">
                <!-- Invoice Header -->
                <div class="reim-inv-card-header">
                    <div class="reim-inv-card-title-group">
                        <span class="reim-inv-badge">发票 #${invId}</span>
                        <span class="font-bold text-slate-800 text-sm">录入发票信息与采购明细</span>
                    </div>
                    <div class="reim-v2-tool-btns">
                        <button type="button" class="reim-btn-upload-attach">
                            <span>上传附件（可选）</span>
                        </button>
                        <input type="file" id="reim-inv-file-${invId}" class="modal-inv-file-input reim-v2-hidden" data-inv-id="${invId}" accept=".pdf,.png,.jpg,.jpeg,.xml,.ofd,.zip" />
                        <span id="reim-inv-attach-wrap-${invId}"></span>
                        <button type="button" class="reim-btn-delete-inv" title="删除该张发票">
                            <span>删除发票</span>
                        </button>
                    </div>
                </div>

                <!-- Invoice Fields -->
                <div class="reim-inv-fields-grid">
                    <div class="reim-v2-field-group">
                        <label>发票类型<span class="req">*</span></label>
                        <div class="reim-segmented-control modal-inv-type-segmented" data-inv-id="${invId}">
                            <button type="button" class="reim-segment-btn ${initType === '专用发票' ? 'active' : ''}" data-value="专用发票">专用发票</button>
                            <button type="button" class="reim-segment-btn ${initType === '普通发票' ? 'active' : ''}" data-value="普通发票">普通发票</button>
                            <button type="button" class="reim-segment-btn ${initType === '无发票' ? 'active' : ''}" data-value="无发票">无发票</button>
                        </div>
                        <input type="hidden" class="modal-inv-type-value" value="${initType}" />
                    </div>
                    <div class="reim-v2-field-group">
                        <label>供应商<span class="req">*</span></label>
                        <div class="picker-suggest-wrapper">
                            <input type="text" class="reim-v2-input-control modal-inv-supplier-input" placeholder="输入或选择供应商..." value="${initSupp}" />
                            <div class="picker-suggest-dropdown" id="reim-supp-dd-${invId}"></div>
                        </div>
                    </div>
                    <div class="reim-v2-field-group">
                        <label>发票号码<span class="req modal-inv-no-req ${isNoInv ? 'reim-v2-hidden' : ''}">*</span></label>
                        <input type="text" class="reim-v2-input-control modal-inv-no-input" placeholder="${isNoInv ? '无发票 (系统自动编号)' : '输入发票号码 (必填)...'}" value="${initNo}" ${isNoInv ? 'disabled' : ''} />
                    </div>
                    <div class="reim-v2-field-group">
                        <label>开票日期<span class="req">*</span></label>
                        <input type="date" class="reim-v2-input-control modal-inv-date-input" value="${initDate}" />
                    </div>
                </div>

                <!-- Item Rows Table -->
                <div class="reim-inv-table-wrap">
                    <table class="reim-inv-table">
                        <thead>
                            <tr>
                                <th class="ashan-col-w40 text-center">#</th>
                                <th class="ashan-col-w180">物料名称<span class="req">*</span></th>
                                <th class="ashan-col-w100">规格</th>
                                <th class="ashan-col-w50 text-center">单位</th>
                                <th class="ashan-col-w80 text-right">数量<span class="req">*</span></th>
                                <th class="ashan-col-w90 text-right">单价(元)<span class="req">*</span></th>
                                <th class="ashan-col-w60 text-right">税率(%)</th>
                                <th class="ashan-col-w100 text-right">金额(不含税)</th>
                                <th class="ashan-col-w80 text-right">税额</th>
                                <th class="ashan-col-w100 text-right">价税合计</th>
                                <th class="ashan-col-w140">备注<span class="req">*</span></th>
                                <th class="ashan-col-w40 text-center">操作</th>
                            </tr>
                        </thead>
                        <tbody class="modal-inv-tbody"></tbody>
                    </table>
                </div>

                <!-- Invoice Card Footer -->
                <div class="reim-inv-footer">
                    <div>
                        <button type="button" class="reim-btn-grid-add reim-btn-add-item-row">
                            <span class="font-bold">+</span>
                            <span>添加行</span>
                        </button>
                    </div>
                    <div class="reim-inv-footer-summary">
                        <span>不含税: <strong class="font-mono text-slate-800" id="reim-inv-subtotal-${invId}">¥ 0.00</strong></span>
                        <span>税额: <strong class="font-mono text-slate-800" id="reim-inv-tax-${invId}">¥ 0.00</strong></span>
                        <span>发票合计: <strong class="reim-inv-total-highlight" id="reim-inv-total-${invId}">¥ 0.00</strong></span>
                    </div>
                </div>
            </div>
        `;

        const $container = this.creation.$wrapper ? this.creation.$wrapper.find("#modal-reim-invoices-container") : $("#modal-reim-invoices-container");
        $container.append(cardHtml);

        if (initData && initData.items && initData.items.length) {
            initData.items.forEach((item) => {
                this.add_item_row(invId, item);
            });
        } else {
            this.add_item_row(invId);
        }

        this.recalculate_invoice(invId);
    }

    remove_invoice_card(invId) {
        const count = $(".reim-inv-card").length;
        if (count <= 1) {
            frappe.show_alert({ message: __("至少需要保留一张发票卡片"), indicator: "orange" });
            return;
        }
        $(`#reim-inv-card-${invId}`).remove();
        this.recalculate_all();
    }

    add_item_row(invId, initItem = null) {
        const $card = this.creation.$wrapper ? this.creation.$wrapper.find(`#reim-inv-card-${invId}`) : $(`#reim-inv-card-${invId}`);
        const $tbody = $card.find(".modal-inv-tbody");
        const rowIdx = $tbody.find("tr").length + 1;
        const invType = $card.find(".modal-inv-type-value").val() || "专用发票";
        const defaultTaxRate = invType === "专用发票" ? "13" : (invType === "普通发票" ? "1" : "0");
        const isTaxDisabled = invType === "无发票" ? "disabled" : "";

        const nameVal = initItem ? initItem.item_name : "";
        const specVal = initItem ? (initItem.spec || "-") : "自动带出";
        const uomVal = initItem ? (initItem.uom || "个") : "个";
        const qtyVal = initItem ? initItem.qty : 1;
        const rateVal = initItem ? (flt(initItem.rate).toFixed(2)) : "";
        const taxRateVal = initItem ? initItem.tax_rate : defaultTaxRate;
        const amtVal = initItem ? (flt(initItem.amount).toFixed(2)) : "";
        const taxAmtVal = initItem ? (flt(initItem.tax_amount).toFixed(2)) : "";
        const lineTotalVal = initItem ? (flt(initItem.line_total).toFixed(2)) : "";
        const remarksVal = initItem ? (initItem.remarks || "") : "";

        const rowHtml = `
            <tr data-row-idx="${rowIdx}">
                <td class="text-center font-bold text-muted">${rowIdx}</td>
                <td>
                    <div class="picker-suggest-wrapper">
                        <input type="text" class="reim-cell-input modal-row-item-input" placeholder="输入或选择物料..." value="${nameVal}" />
                        <div class="picker-suggest-dropdown" id="reim-item-dd-${invId}-${rowIdx}"></div>
                        <input type="hidden" class="modal-row-item-code" value="${nameVal}" />
                        <input type="hidden" class="modal-row-item-name" value="${nameVal}" />
                    </div>
                </td>
                <td>
                    <input type="text" class="reim-cell-input readonly modal-row-spec" placeholder="自动带出" value="${specVal}" readonly />
                </td>
                <td>
                    <input type="text" class="reim-cell-input text-center readonly modal-row-uom" value="${uomVal}" readonly />
                </td>
                <td>
                    <input type="number" step="any" min="0.0001" class="reim-cell-input number modal-row-qty" value="${qtyVal}" />
                </td>
                <td>
                    <input type="number" step="any" min="0.01" class="reim-cell-input number modal-row-rate" placeholder="0.00" value="${rateVal}" />
                </td>
                <td>
                    <input type="number" step="any" class="reim-cell-input number modal-row-tax-rate" value="${taxRateVal}" ${isTaxDisabled} />
                </td>
                <td>
                    <input type="number" step="any" class="reim-cell-input number modal-row-amount-input" placeholder="0.00" value="${amtVal}" />
                </td>
                <td>
                    <input type="number" step="any" class="reim-cell-input number modal-row-tax-amount-input" placeholder="0.00" value="${taxAmtVal}" />
                </td>
                <td>
                    <input type="number" step="any" class="reim-cell-input number font-bold text-primary modal-row-line-total-input" placeholder="0.00" value="${lineTotalVal}" />
                </td>
                <td>
                    <input type="text" class="reim-cell-input modal-row-remarks" placeholder="必填用途/说明..." value="${remarksVal}" />
                </td>
                <td class="text-center">
                    <button type="button" class="reim-btn-delete-row" title="删除此行">✕</button>
                </td>
            </tr>
        `;

        $tbody.append(rowHtml);
    }

    recalculate_invoice(invId) {
        const $card = this.creation.$wrapper ? this.creation.$wrapper.find(`#reim-inv-card-${invId}`) : $(`#reim-inv-card-${invId}`);
        let subtotal = 0;
        let totalTax = 0;

        $card.find(".modal-inv-tbody tr").each(function () {
            const qty = flt($(this).find(".modal-row-qty").val() || 0);
            const rate = flt($(this).find(".modal-row-rate").val() || 0);
            let amt = flt($(this).find(".modal-row-amount-input").val() || 0);
            if (!amt && qty && rate) {
                amt = flt(qty * rate, 2);
            }
            const taxAmt = flt($(this).find(".modal-row-tax-amount-input").val() || 0);
            subtotal += amt;
            totalTax += taxAmt;
        });

        const totalAmt = flt(subtotal + totalTax, 2);

        $card.find(`#reim-inv-subtotal-${invId}`).text(format_currency(subtotal));
        $card.find(`#reim-inv-tax-${invId}`).text(format_currency(totalTax));
        $card.find(`#reim-inv-total-${invId}`).text(format_currency(totalAmt));

        this.recalculate_all();
    }

    recalculate_all() {
        let invCount = 0;
        const suppliers = new Set();
        let grandTotal = 0;
        const $wrap = this.creation.$wrapper || $("body");
        const $cards = $wrap.find(".reim-inv-card").length ? $wrap.find(".reim-inv-card") : $(".reim-inv-card");

        $cards.each(function () {
            invCount++;
            const invId = $(this).attr("id") ? $(this).attr("id").replace("reim-inv-card-", "") : "";
            let subtotal = 0;
            let totalTax = 0;

            const supp = $(this).find(".modal-inv-supplier-input").val()?.trim() || "";
            if (supp) suppliers.add(supp);

            $(this).find(".modal-inv-tbody tr").each(function () {
                const qty = flt($(this).find(".modal-row-qty").val() || 0);
                const rate = flt($(this).find(".modal-row-rate").val() || 0);
                let amt = flt($(this).find(".modal-row-amount-input").val() || 0);
                if (!amt && qty && rate) {
                    amt = flt(qty * rate, 2);
                }
                const taxAmt = flt($(this).find(".modal-row-tax-amount-input").val() || 0);
                const lineTotal = flt($(this).find(".modal-row-line-total-input").val() || (amt + taxAmt));
                subtotal += amt;
                totalTax += taxAmt;
                grandTotal += lineTotal;
            });

            if (invId) {
                const totalAmt = flt(subtotal + totalTax, 2);
                $(this).find(`#reim-inv-subtotal-${invId}`).text(format_currency(subtotal));
                $(this).find(`#reim-inv-tax-${invId}`).text(format_currency(totalTax));
                $(this).find(`#reim-inv-total-${invId}`).text(format_currency(totalAmt));
            }
        });

        $wrap.find("#modal-reim-sum-inv-count").text(`${invCount} 张`);
        $wrap.find("#modal-reim-sum-supp-count").text(`${suppliers.size} 个`);
        $wrap.find("#modal-reim-sum-grand-total").text(format_currency(grandTotal));
        $("#modal-reim-sum-inv-count").text(`${invCount} 张`);
        $("#modal-reim-sum-supp-count").text(`${suppliers.size} 个`);
        $("#modal-reim-sum-grand-total").text(format_currency(grandTotal));
    }

    confirm_delete_reimbursement(rrName, isDraft = true, onSuccess = null) {
        if (typeof isDraft === "function") {
            onSuccess = isDraft;
            isDraft = true;
        }
        const me = this;
        let confirmMsg = "";
        if (isDraft) {
            confirmMsg = __(`确定要删除草稿报销申请单 <strong>${rrName}</strong> 及其关联草稿单据吗？`);
        } else {
            confirmMsg = __(`确定要作废并删除报销申请单 <strong>${rrName}</strong> 及其关联已过账单据（采购发票、入库单）吗？<br><span class="text-muted text-xs">注意：已发生付款的单据将被系统安全拦截。</span>`);
        }

        frappe.confirm(
            confirmMsg,
            async () => {
                try {
                    const r = await frappe.call({
                        method: REIM_API.delete_bundle,
                        type: "POST",
                        args: { rr_name: rrName },
                        freeze: true,
                        freeze_message: __(isDraft ? "正在删除报销草稿及关联草稿单据..." : "正在作废并删除报销单及关联单据..."),
                    });
                    if (r.message && r.message.success) {
                        frappe.show_alert({ message: __(`报销单 ${rrName} 及关联单据已删除`), indicator: "green" });
                        if (me.selected_map.has(rrName)) {
                            me.selected_map.delete(rrName);
                        }
                        for (const [k, v] of me.selected_map.entries()) {
                            if (v.rr_name === rrName) {
                                me.selected_map.delete(k);
                            }
                        }
                        me.update_selection_summary();
                        if (onSuccess) onSuccess();
                        me.refresh_all();
                    }
                } catch (e) {
                    console.error("Delete failed:", e);
                }
            }
        );
    }

    async submit_manual_reimbursement(isDraft = 0) {
        const $titleInput = $("#modal-reim-title");
        let titleVal = $titleInput.val() ? $titleInput.val().trim() : "";

        // 草稿：不强制填写任何字段，标题为空则自动生成
        if (!titleVal) {
            if (!isDraft) {
                flash_field_error($titleInput, "请填写报销标题");
                return;
            }
            titleVal = `草稿报销-${frappe.datetime.get_today()}`;
        }

        const company = $("#modal-reim-company").val();
        if (!company) {
            flash_field_error($("#modal-reim-company"), "请选择所属公司");
            return;
        }

        const dateVal = $("#modal-reim-date").val() || frappe.datetime.get_today();
        const autoStock = $("#modal-reim-auto-stock").is(":checked") ? 1 : 0;

        const invoicePayload = [];
        let hasErrors = false;

        $(".reim-inv-card").each(function (idx) {
            const cardIdx = idx + 1;
            const $card = $(this);
            const invType = $card.find(".modal-inv-type-value").val() || "专用发票";
            const $suppInput = $card.find(".modal-inv-supplier-input");
            const supplier = $suppInput.val().trim();
            const $noInput = $card.find(".modal-inv-no-input");
            const invoiceNo = $noInput.val().trim();
            const invoiceDate = $card.find(".modal-inv-date-input").val() || dateVal;

            // 正式提交时校验供应商与发票号
            if (!isDraft) {
                if (!supplier && invType !== "无发票") {
                    flash_field_error($suppInput, `发票 #${cardIdx} 请填写供应商名称`);
                    hasErrors = true;
                    return false;
                }
                if ((invType === "专用发票" || invType === "普通发票") && !invoiceNo) {
                    flash_field_error($noInput, `发票 #${cardIdx} (${invType}) 必须填写发票号码`);
                    hasErrors = true;
                    return false;
                }
            }

            const items = [];
            $card.find(".modal-inv-tbody tr").each(function (rowIdx) {
                const $row = $(this);
                const itemCode = $row.find(".modal-row-item-code").val().trim();
                const $itemInput = $row.find(".modal-row-item-input");
                const itemName = $row.find(".modal-row-item-name").val().trim() || $itemInput.val().trim();
                const spec = $row.find(".modal-row-spec").val().trim();
                const uom = $row.find(".modal-row-uom").val().trim() || "个";
                const $qtyInput = $row.find(".modal-row-qty");
                const qty = flt($qtyInput.val() || 0);
                const $rateInput = $row.find(".modal-row-rate");
                const rate = flt($rateInput.val() || 0);
                const taxRate = flt($row.find(".modal-row-tax-rate").val() || 0);
                const amount = flt($row.find(".modal-row-amount-input").val() || (qty * rate));
                const taxAmount = flt($row.find(".modal-row-tax-amount-input").val() || (amount * taxRate / 100));
                const $remarksInput = $row.find(".modal-row-remarks");
                const remarks = $remarksInput.val().trim();

                // 草稿：所有空行直接忽略，不做任何必填校验
                if (!itemName && rate <= 0 && !remarks) {
                    return; // 跳过空行
                }

                // 正式提交时：有物料名称且数量/单价/备注必填
                if (!isDraft) {
                    if (!itemName) {
                        flash_field_error($itemInput, `发票 #${cardIdx} 第 ${rowIdx + 1} 行请填写物料名称`);
                        hasErrors = true;
                        return false;
                    }
                    if (qty <= 0 || rate <= 0 || amount <= 0) {
                        flash_field_error($rateInput, `发票 #${cardIdx} 第 ${rowIdx + 1} 行【${itemName}】数量与单价必须大于 0`);
                        hasErrors = true;
                        return false;
                    }
                    if (!remarks) {
                        flash_field_error($remarksInput, `发票 #${cardIdx} 第 ${rowIdx + 1} 行【${itemName}】备注为必填项，请填写用途或明细说明`);
                        hasErrors = true;
                        return false;
                    }
                }

                // 草稿：有物料名才加入 payload
                if (itemName) {
                    items.push({
                        item_code: itemCode || itemName,
                        item_name: itemName,
                        spec: spec,
                        uom: uom,
                        qty: qty,
                        rate: rate,
                        amount: amount,
                        tax_rate: taxRate,
                        tax_amount: taxAmount,
                        remarks: remarks,
                    });
                }
            });

            if (hasErrors) return false;

            // 正式提交时至少需要 1 行明细
            if (!isDraft && !items.length) {
                frappe.msgprint(__(`发票 #${cardIdx} 至少需要录入一行有效的明细。`));
                hasErrors = true;
                return false;
            }

            // 草稿：不管有没有明细，都加入 payload（后端会宽容处理）
            invoicePayload.push({
                invoice_type: invType,
                supplier: supplier,
                invoice_no: invoiceNo,
                invoice_date: invoiceDate,
                items: items,
            });
        });

        if (hasErrors) return;

        // 正式提交时至少需要一张发票
        if (!isDraft && !invoicePayload.length) return;

        const isEdit = this.creation.is_edit;
        const rrName = this.creation.current_rr_name;

        const $btn = this.creation.dialog.get_primary_btn();
        $btn.prop("disabled", true).text(__("正在创建单据..."));

        try {
            if (rrName) {
                await frappe.call({
                    method: REIM_API.delete_bundle,
                    type: "POST",
                    args: { rr_name: rrName },
                });
            }

            const r = await frappe.call({
                method: REIM_API.create_manual,
                type: "POST",
                freeze: true,
                freeze_message: __(isDraft ? "正在保存报销草稿..." : "正在生成报销单与采购发票/入库单 (PR+PI+RR)，请稍候..."),
                args: {
                    company: company,
                    posting_date: dateVal,
                    title: titleVal,
                    auto_receive_stock: autoStock,
                    is_draft: isDraft ? 1 : 0,
                    invoices: JSON.stringify(invoicePayload),
                },
            });

            if (r.message && r.message.success) {
                this.close_dialog();

                const statusText = isDraft ? "已成功保存为草稿！" : (isEdit ? "已更新并过账成功！" : "创建并过账成功！");
                frappe.show_alert({
                    message: __(`报销申请 ${r.message.rr_name} ${statusText} 共生成 ${r.message.invoice_count} 张发票单据链。`),
                    indicator: "green",
                });
                await this.refresh_all();
            }
        } catch (err) {
            console.error(err);
        } finally {
            $btn.prop("disabled", false).text(isEdit ? __("保存修改并过账") : __("确认创建并过账"));
        }
    }
}
