/* Global, user-level business working context for new Desk documents. */
(function () {
    "use strict";

    const ALL_COMPANY_LABEL = "全部公司";
    const DATE_MODE_SYSTEM = "system";
    const DATE_MODE_FIXED = "fixed";
    const SAFE_DATE_FIELDS = new Set(["posting_date", "transaction_date"]);
    const modelAppliedDocuments = new Set();
    const formAppliedDocuments = new Set();
    let context = normalizeContext(window.frappe?.boot?.ashan_work_context);
    let dialog = null;
    let triggerFrame = null;

    function getToday() {
        return window.frappe?.datetime?.get_today?.() || new Date().toISOString().slice(0, 10);
    }

    function normalizeContext(value) {
        const raw = value || {};
        const dateMode = raw.date_mode === DATE_MODE_FIXED ? DATE_MODE_FIXED : DATE_MODE_SYSTEM;
        const fixedWorkDate = String(
            raw.fixed_work_date || (dateMode === DATE_MODE_FIXED ? raw.work_date : "")
        ).slice(0, 10);
        return {
            company: String(raw.company || "").trim(),
            date_mode: dateMode,
            work_date: dateMode === DATE_MODE_FIXED ? (fixedWorkDate || getToday()) : getToday(),
            fixed_work_date: dateMode === DATE_MODE_FIXED ? fixedWorkDate : "",
            companies: Array.isArray(raw.companies) ? raw.companies.map(String) : [],
            restricted_doc_scope: String(raw.restricted_doc_scope || "all").trim(),
            has_restricted_access: Boolean(raw.has_restricted_access),
        };
    }

    function getEffectiveWorkDate() {
        return context.date_mode === DATE_MODE_FIXED
            ? (context.fixed_work_date || context.work_date)
            : getToday();
    }

    function documentKey(doc) {
        return `${doc?.doctype || ""}:${doc?.name || ""}`;
    }

    function getMeta(doc) {
        if (!doc?.doctype || !window.frappe?.get_meta) return null;
        try {
            return frappe.get_meta(doc.doctype);
        } catch (error) {
            return null;
        }
    }

    function getContextChanges(doc) {
        const meta = getMeta(doc);
        if (!meta || meta.istable) return {};
        const fields = new Map((meta.fields || []).map((field) => [field.fieldname, field]));
        const changes = {};
        const companyField = fields.get("company");
        if (companyField?.fieldtype === "Link" && companyField.options === "Company") {
            changes.company = context.company;
        }
        if (context.date_mode === DATE_MODE_FIXED) {
            SAFE_DATE_FIELDS.forEach((fieldname) => {
                const field = fields.get(fieldname);
                if (field?.fieldtype === "Date") {
                    changes[fieldname] = getEffectiveWorkDate();
                }
            });
        }
        return changes;
    }

    function applyToNewModel(doc) {
        if (!doc || doc.parent || !doc.__islocal) return doc;
        const key = documentKey(doc);
        if (!key || modelAppliedDocuments.has(key)) return doc;
        Object.assign(doc, getContextChanges(doc));
        modelAppliedDocuments.add(key);
        return doc;
    }

    function applyToCurrentForm() {
        const frm = window.cur_frm;
        if (!frm || !frm.is_new?.() || !frm.doc) return;
        const key = documentKey(frm.doc);
        if (!key || formAppliedDocuments.has(key)) return;

        const changes = getContextChanges(frm.doc);
        Object.entries(changes).forEach(([fieldname, value]) => {
            if (frm.doc[fieldname] !== value) {
                frm.set_value(fieldname, value);
            }
        });
        formAppliedDocuments.add(key);
    }

    function patchNewDocumentFactory() {
        if (!window.frappe?.model?.get_new_doc) {
            window.setTimeout(patchNewDocumentFactory, 100);
            return;
        }
        const original = frappe.model.get_new_doc;
        if (original.__ashanWorkContextPatched) return;

        function getNewDocumentWithContext() {
            const doc = original.apply(this, arguments);
            return applyToNewModel(doc);
        }
        getNewDocumentWithContext.__ashanWorkContextPatched = true;
        frappe.model.get_new_doc = getNewDocumentWithContext;
    }

    function emitContextChange() {
        if (window.frappe?.boot) {
            frappe.boot.ashan_work_context = context;
        }
        document.dispatchEvent(new CustomEvent("ashan-work-context-changed", { detail: getContext() }));
        scheduleWorkContextTrigger();
    }

    function getContext() {
        return {
            company: context.company,
            date_mode: context.date_mode,
            work_date: getEffectiveWorkDate(),
            fixed_work_date: context.fixed_work_date,
            companies: [...context.companies],
        };
    }

    function workContextLabel() {
        const dateLabel = context.date_mode === DATE_MODE_FIXED
            ? getEffectiveWorkDate()
            : "系统当天";
        return `${context.company || ALL_COMPANY_LABEL} · ${dateLabel}`;
    }

    function updateWorkContextTrigger(trigger) {
        const company = context.company || ALL_COMPANY_LABEL;
        const label = workContextLabel();
        const companyElement = trigger.querySelector(".ashan-work-context-company");
        const dateElement = trigger.querySelector(".ashan-work-context-date");
        if (companyElement && companyElement.textContent !== company) {
            companyElement.textContent = company;
        }
        const dateLabel = context.date_mode === DATE_MODE_FIXED
            ? getEffectiveWorkDate()
            : "系统当天";
        if (dateElement && dateElement.textContent !== dateLabel) {
            dateElement.textContent = dateLabel;
        }
        const accessibleLabel = `设置单据默认值：${label}`;
        if (trigger.getAttribute("aria-label") !== accessibleLabel) {
            trigger.setAttribute("aria-label", accessibleLabel);
        }
        if (trigger.getAttribute("title") !== accessibleLabel) {
            trigger.setAttribute("title", accessibleLabel);
        }
    }

    function createWorkContextTrigger() {
        const trigger = document.createElement("button");
        trigger.type = "button";
        trigger.id = "ashan-work-context-trigger";
        trigger.className = "ashan-work-context-trigger";
        trigger.innerHTML = `
            <span class="ashan-work-context-trigger-topline">
                <span class="ashan-work-context-trigger-label">单据默认值</span>
                <span class="ashan-work-context-trigger-action">修改</span>
            </span>
            <span class="ashan-work-context-trigger-value">
                <span class="ashan-work-context-company"></span>
                <span class="ashan-work-context-separator" aria-hidden="true">·</span>
                <span class="ashan-work-context-date"></span>
            </span>
        `;
        trigger.addEventListener("click", openContextDialog);
        return trigger;
    }

    function ensureWorkContextTrigger() {
        if (window.frappe?.session?.user === "Guest") return;
        const userMenu = document.querySelector('a[aria-label="User Menu"]');
        if (!userMenu?.parentElement) return;

        let trigger = document.getElementById("ashan-work-context-trigger");
        if (trigger && trigger.parentElement !== userMenu.parentElement) {
            trigger.remove();
            trigger = null;
        }
        if (!trigger) {
            trigger = createWorkContextTrigger();
            userMenu.parentElement.insertBefore(trigger, userMenu);
        }
        updateWorkContextTrigger(trigger);
    }

    function scheduleWorkContextTrigger() {
        if (triggerFrame) return;
        triggerFrame = window.requestAnimationFrame(() => {
            triggerFrame = null;
            ensureWorkContextTrigger();
        });
    }

    function bindWorkContextTrigger() {
        if (!document.body) {
            window.setTimeout(bindWorkContextTrigger, 100);
            return;
        }
        if (document.documentElement.dataset.ashanWorkContextTriggerBound) return;
        document.documentElement.dataset.ashanWorkContextTriggerBound = "true";
        const observer = new MutationObserver(scheduleWorkContextTrigger);
        observer.observe(document.body, { childList: true, subtree: true });
        scheduleWorkContextTrigger();
    }

    function openContextDialog() {
        if (!window.frappe?.ui?.Dialog) return;
        dialog?.hide();
        let selectedDateMode = context.date_mode;

        const fields = [
            {
                fieldname: "company",
                fieldtype: "Select",
                label: __("当前默认公司"),
                options: [ALL_COMPANY_LABEL, ...context.companies].join("\n"),
                default: context.company || ALL_COMPANY_LABEL,
                description: __("全部公司仅用于查询；新建必须归属公司的单据时，仍需明确选择公司。"),
            },
            {
                fieldname: "date_mode_control",
                fieldtype: "HTML",
            },
            {
                fieldname: "work_date",
                fieldtype: "Date",
                label: __("固定业务日期"),
                default: context.fixed_work_date || getToday(),
                hidden: context.date_mode !== DATE_MODE_FIXED,
                reqd: context.date_mode === DATE_MODE_FIXED,
                description: __("固定后，仅预填后续新单据的过账日期和交易日期，不修改系统当天。"),
            },
        ];

        if (context.has_restricted_access) {
            fields.push({
                fieldname: "restricted_doc_scope",
                fieldtype: "Select",
                label: __("保密单据核算范围 (高管特权)"),
                options: [
                    { label: __("全量真实口径 (含受限单据)"), value: "all" },
                    { label: __("仅公开业务 (普通员工视角)"), value: "public_only" },
                    { label: __("仅受限保密专账"), value: "restricted_only" },
                ],
                default: context.restricted_doc_scope || "all",
                description: __("控制库存台账与单据核算中是否包含涉密受限单据。"),
            });
        }

        dialog = new frappe.ui.Dialog({
            title: __("当前工作环境"),
            static: true,
            fields: fields,
            primary_action_label: __("保存并应用"),
            primary_action(values) {
                const selectedCompany = values.company === ALL_COMPANY_LABEL ? "" : values.company;
                frappe.call({
                    method: "ashan_cn_procurement.services.work_context_service.save_work_context",
                    type: "POST",
                    args: {
                        company: selectedCompany,
                        date_mode: selectedDateMode,
                        work_date: selectedDateMode === DATE_MODE_FIXED ? values.work_date : "",
                        restricted_doc_scope: values.restricted_doc_scope || context.restricted_doc_scope,
                    },
                    freeze: false,
                    callback(response) {
                        if (!response.message) return;
                        context = normalizeContext(response.message);
                        emitContextChange();
                        dialog.hide();
                        frappe.show_alert({
                            message: __("当前工作环境已应用到后续新建单据。"),
                            indicator: "green",
                        });
                    },
                });
            },
        });
        dialog.set_secondary_action_label(__("关闭"));
        dialog.set_secondary_action(() => dialog.hide());
        dialog.show();

        const modeControl = dialog.fields_dict.date_mode_control?.$wrapper;
        if (!modeControl) return;
        modeControl.html(`
            <div class="ashan-work-date-mode">
                <div class="ashan-work-date-mode-label">业务日期模式</div>
                <div class="ashan-work-date-mode-options" role="group" aria-label="业务日期模式">
                    <button type="button" class="ashan-work-date-mode-option" data-date-mode="system">
                        <span class="ashan-work-date-mode-title">系统默认</span>
                        <span class="ashan-work-date-mode-description">每天自动使用当天日期</span>
                    </button>
                    <button type="button" class="ashan-work-date-mode-option" data-date-mode="fixed">
                        <span class="ashan-work-date-mode-title">固定日期</span>
                        <span class="ashan-work-date-mode-description">一直使用主动指定的日期</span>
                    </button>
                </div>
                <div class="ashan-work-date-mode-note"></div>
            </div>
        `);

        const setDateMode = (dateMode) => {
            selectedDateMode = dateMode === DATE_MODE_FIXED ? DATE_MODE_FIXED : DATE_MODE_SYSTEM;
            const isFixed = selectedDateMode === DATE_MODE_FIXED;
            modeControl.find("[data-date-mode]").each(function () {
                const option = this;
                const active = option.dataset.dateMode === selectedDateMode;
                option.classList.toggle("active", active);
                option.setAttribute("aria-pressed", active ? "true" : "false");
            });
            const workDateField = dialog.fields_dict.work_date;
            workDateField.df.hidden = !isFixed;
            workDateField.df.reqd = isFixed;
            workDateField.refresh();
            modeControl.find(".ashan-work-date-mode-note").text(
                isFixed
                    ? "后续新单据将持续使用所选日期，直到改回系统默认。"
                    : `当前跟随系统日期：${getToday()}；明天会自动变为明天。`
            );
        };
        modeControl.on("click", "[data-date-mode]", function () {
            setDateMode(this.dataset.dateMode);
        });
        setDateMode(selectedDateMode);
    }

    function bindRoutes() {
        if (!window.frappe?.router?.on || window.__ashanWorkContextRouteBound) return;
        frappe.router.on("change", () => {
            window.setTimeout(applyToCurrentForm, 80);
            window.setTimeout(applyToCurrentForm, 350);
            window.setTimeout(scheduleWorkContextTrigger, 80);
        });
        window.__ashanWorkContextRouteBound = true;
    }

    function initialize() {
        if (!window.frappe) {
            window.setTimeout(initialize, 100);
            return;
        }
        context = normalizeContext(frappe.boot?.ashan_work_context || context);
        patchNewDocumentFactory();
        bindWorkContextTrigger();
        bindRoutes();
        scheduleWorkContextTrigger();
        window.setTimeout(applyToCurrentForm, 200);
    }

    window.AshanWorkContext = {
        getCompany: () => context.company,
        getWorkDate: getEffectiveWorkDate,
        getContext,
    };

    initialize();
    if (window.jQuery) {
        jQuery(document).ready(initialize);
        jQuery(document).on("app_ready", initialize);
    }
})();
