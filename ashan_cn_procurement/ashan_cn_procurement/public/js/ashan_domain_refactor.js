/* Ashan Domain Experience Layer 2026.09
 * Thin UI enhancement for completed business modules.
 * Business calculations remain in their domain services.
 */
(function () {
    "use strict";

    const TASK_API = "ashan_cn_procurement.services.task_hub_service.get_my_task_hub";
    const TASK_CENTER_ID = "ashan-task-center";
    const ACTIONABLE_STATES = new Set(["overdue", "due_soon", "pending"]);
    const DECORATIVE_ACTION_EMOJI = /^[\s]*[🖨️📤📥🔄🔍💰📊📋📑⚙️🧮🛡️🏛️👥💼💳⛽📦🚀➕➖🏁🔒⚠️✅🗑️⛔📜🚗]+\s*/u;
    let taskRequest = null;
    let taskCache = null;
    let taskLoadedAt = 0;
    let scheduleFrame = 0;

    function routeParts() {
        return (window.frappe?.get_route?.() || []).map((part) => String(part || ""));
    }

    function routeKey() {
        return routeParts().join("/").toLowerCase();
    }

    function isHomeWorkspace() {
        const route = routeParts();
        return route.length >= 2 &&
            String(route[0]).toLowerCase() === "workspaces" &&
            String(route[1]).toLowerCase() === "home";
    }

        function normalizeActionLabels(root) {
        if (!root) return;
        // Strip decorative emojis from buttons, tabs, card labels and group headers
        root.querySelectorAll("button, .qifu-tab-btn, .jz-tab-btn, .qifu-master-chip, .qifu-kpi-card .label, .qifu-kpi-card [style*='font-weight:700'], .ashan-kpi-title").forEach((el) => {
            if (el.children.length && !el.classList.contains('qifu-tab-btn')) return;
            const text = el.textContent || "";
            const cleaned = text.replace(DECORATIVE_ACTION_EMOJI, "").trim();
            if (cleaned && cleaned !== text.trim()) {
                // If it has children (like badge in tab), only strip leading emoji from text node
                if (el.firstChild && el.firstChild.nodeType === 3) {
                    el.firstChild.textContent = el.firstChild.textContent.replace(DECORATIVE_ACTION_EMOJI, "");
                } else if (!el.children.length) {
                    el.textContent = cleaned;
                }
            }
        });
    }

    function enhancePayrollSurfaces() {
        const qifu = document.querySelector(".qifu-wb-wrapper");
        if (qifu) {
            qifu.classList.add("ashan-domain-workbench", "ashan-payroll-workbench", "ashan-qifu-workbench");
            normalizeActionLabels(qifu);
        }

        const jizhong = document.querySelector(".jz-wb-wrapper");
        if (jizhong) {
            jizhong.classList.add("ashan-domain-workbench", "ashan-payroll-workbench", "ashan-jizhong-workbench");
            normalizeActionLabels(jizhong);
        }
    }

    function enhanceProcurementAndReimbursement() {
        document.querySelectorAll(".picker-page-container").forEach((root) => {
            root.classList.add("ashan-domain-workbench", "ashan-transaction-workbench");
        });

        const reimbursement = document.querySelector("#reim-data-table")?.closest(".picker-page-container");
        if (reimbursement) {
            reimbursement.classList.add("ashan-reimbursement-workbench");
            normalizeActionLabels(reimbursement);
        }
    }


    function enhanceRemainingSurfaces() {
        const key = routeKey();
        const main = document.querySelector(".layout-main-section");
        if (!main) return;

        const routeClasses = [
            "ashan-oil-workbench",
            "ashan-property-workbench",
            "ashan-monthly-settlement-workbench",
            "ashan-tax-invoice-workbench",
            "ashan-compliance-workbench",
            "ashan-stock-workbench",
            "ashan-closing-workbench",
            "ashan-meal-workbench",
        ];
        routeClasses.forEach((name) => main.classList.remove(name));

        const routes = [
            [["oil-card-ledger"], "ashan-oil-workbench"],
            [["lease-settlement-workbench", "property-settlement-workbench"], "ashan-property-workbench"],
            [["monthly-settlement-picker"], "ashan-monthly-settlement-workbench"],
            [["tax-invoice-center"], "ashan-tax-invoice-workbench"],
            [["environmental-management", "special-equipment-center"], "ashan-compliance-workbench"],
            [["stock-issue-workbench", "stock-ledger-workbench"], "ashan-stock-workbench"],
            [["monthly-closing-center"], "ashan-closing-workbench"],
            [["meal-settlement-workbench"], "ashan-meal-workbench"],
        ];

        for (const [routeNames, className] of routes) {
            if (routeNames.some((name) => key.includes(name))) {
                main.classList.add("ashan-domain-workbench", className);
                normalizeActionLabels(main);
                break;
            }
        }
    }

    function taskRoute(task) {
        if (task?.route) return task.route;
        if (task?.source !== "payroll_workflow") return "";
        const company = String(task.company || "");
        if (company.includes("吉众")) return "jizhong-hr-salary-workbench";
        if (company.includes("祺富")) return "qifu-hr-salary-workbench";
        return "";
    }

    function navigateTask(task) {
        if (!task || !window.frappe?.set_route) return;
        const company = String(task.company || "").trim();
        const period = String(task.period_month || "").trim();

        frappe.route_options = Object.assign({}, frappe.route_options || {});
        if (company) frappe.route_options.company = company;
        if (period) frappe.route_options.period_month = period;

        const route = taskRoute(task);
        if (Array.isArray(route)) {
            frappe.set_route(...route);
            return;
        }

        const normalized = String(route || "")
            .replace(/^https?:\/\/[^/]+/i, "")
            .replace(/^\/?(desk|app)\//i, "")
            .replace(/^#/, "")
            .replace(/^\/+/, "")
            .replace(/[?#].*$/, "");

        if (!normalized) return;
        frappe.set_route(...normalized.split("/").filter(Boolean));
    }

    function stateLabel(state) {
        return {
            overdue: "已逾期",
            due_soon: "临期",
            pending: "待处理",
            locked: "已完成",
        }[state] || "待处理";
    }

    function createCount(label, value, state) {
        const wrap = document.createElement("div");
        wrap.className = `ashan-task-count ashan-task-count-${state}`;

        const number = document.createElement("strong");
        number.textContent = String(value || 0);

        const text = document.createElement("span");
        text.textContent = label;

        wrap.append(number, text);
        return wrap;
    }

    function createTaskRow(task) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = `ashan-task-row ashan-task-row-${task.state || "pending"}`;
        row.addEventListener("click", () => navigateTask(task));

        const state = document.createElement("span");
        state.className = `ashan-task-state ashan-task-state-${task.state || "pending"}`;
        state.textContent = stateLabel(task.state);

        const content = document.createElement("span");
        content.className = "ashan-task-content";

        const title = document.createElement("span");
        title.className = "ashan-task-title";
        title.textContent = task.title || "待处理事项";

        const summary = document.createElement("span");
        summary.className = "ashan-task-summary";
        const company = task.company_short_name || task.company || "";
        summary.textContent = [company, task.summary].filter(Boolean).join(" · ");

        content.append(title, summary);

        const action = document.createElement("span");
        action.className = "ashan-task-action";
        action.textContent = task.action_label || "打开";

        row.append(state, content, action);
        return row;
    }

    function renderTaskCenter(data) {
        if (!isHomeWorkspace()) return;

        const main = document.querySelector(
            '[data-page-route="Workspaces"] .layout-main-section, .layout-main-section'
        );
        if (!main) return;

        let root = document.getElementById(TASK_CENTER_ID);
        if (!root) {
            root = document.createElement("section");
            root.id = TASK_CENTER_ID;
            root.className = "ashan-task-center";
            root.setAttribute("aria-label", "我的待办任务");
            main.insertBefore(root, main.firstChild);
        }

        const signature = JSON.stringify({
            period: data?.period || "",
            counts: data?.counts || {},
            tasks: (data?.tasks || []).map((task) => [task.id, task.state, task.summary]),
        });
        if (root.dataset.ashanTaskSignature === signature) return;
        root.dataset.ashanTaskSignature = signature;
        root.replaceChildren();

        const header = document.createElement("div");
        header.className = "ashan-task-center-header";

        const heading = document.createElement("div");
        heading.className = "ashan-task-center-heading";

        const title = document.createElement("h2");
        title.textContent = "我的待办";

        const period = document.createElement("span");
        period.className = "ashan-task-period";
        period.textContent = data?.period_label || data?.period || "";

        heading.append(title, period);

        const counts = document.createElement("div");
        counts.className = "ashan-task-counts";
        counts.append(
            createCount("逾期", data?.counts?.overdue, "overdue"),
            createCount("临期", data?.counts?.due_soon, "due_soon"),
            createCount("待处理", data?.counts?.pending, "pending")
        );

        const refresh = document.createElement("button");
        refresh.type = "button";
        refresh.className = "ashan-btn-outline ashan-task-refresh";
        refresh.textContent = "刷新";
        refresh.addEventListener("click", () => loadTaskCenter(true));

        header.append(heading, counts, refresh);
        root.appendChild(header);

        const tasks = (data?.tasks || []).filter((task) => ACTIONABLE_STATES.has(task.state));
        const list = document.createElement("div");
        list.className = "ashan-task-list";

        if (!tasks.length) {
            const empty = document.createElement("div");
            empty.className = "ashan-task-empty";
            empty.textContent = "当前没有需要立即处理的事项。";
            list.appendChild(empty);
        } else {
            tasks.slice(0, 8).forEach((task) => list.appendChild(createTaskRow(task)));

            if (tasks.length > 8) {
                const more = document.createElement("div");
                more.className = "ashan-task-more";
                more.textContent = `还有 ${tasks.length - 8} 项，请优先处理逾期和临期事项。`;
                list.appendChild(more);
            }
        }

        root.appendChild(list);
    }

    async function fetchTasks(force = false) {
        const now = Date.now();
        if (!force && taskCache && now - taskLoadedAt < 60_000) return taskCache;
        if (taskRequest) return taskRequest;
        if (!window.frappe?.call) return null;

        taskRequest = frappe.call({
            method: TASK_API,
            freeze: false,
        }).then((response) => {
            taskCache = response?.message || null;
            taskLoadedAt = Date.now();
            return taskCache;
        }).catch((error) => {
            if (window.console) console.error("Task hub load failed", error);
            return null;
        }).finally(() => {
            taskRequest = null;
        });

        return taskRequest;
    }

    async function loadTaskCenter(force = false) {
        if (!isHomeWorkspace()) {
            document.getElementById(TASK_CENTER_ID)?.remove();
            return;
        }

        const data = await fetchTasks(force);
        if (data) renderTaskCenter(data);
    }

    function enhance() {
        enhancePayrollSurfaces();
        enhanceProcurementAndReimbursement();
        enhanceRemainingSurfaces();
        loadTaskCenter(false);
    }

    function schedule() {
        if (scheduleFrame) return;
        scheduleFrame = requestAnimationFrame(() => {
            scheduleFrame = 0;
            enhance();
        });
    }

    function init() {
        schedule();

        if (window.frappe?.router?.on && !window.__ashanDomainRefactorRouteBound) {
            frappe.router.on("change", () => {
                taskCache = null;
                schedule();
            });
            window.__ashanDomainRefactorRouteBound = true;
        }

        if (document.body && !window.__ashanDomainRefactorObserver) {
            const observer = new MutationObserver((mutations) => {
                const externalMutation = mutations.some((mutation) => {
                    const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
                    return !target?.closest?.(`#${TASK_CENTER_ID}`);
                });
                if (externalMutation) schedule();
            });
            observer.observe(document.body, { childList: true, subtree: true });
            window.__ashanDomainRefactorObserver = observer;
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }
})();
