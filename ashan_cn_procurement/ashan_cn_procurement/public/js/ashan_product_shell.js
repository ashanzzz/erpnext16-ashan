/* Ashan Product Experience Layer
 * Adds shared page states, action handling and a context-preserving inspector.
 * It extends window.AshanUI instead of creating another global UI namespace.
 */
(function () {
    "use strict";

    const EXPERIENCE_VERSION = "2026.09";
    let enhanceFrame = 0;
    let activeInspector = null;

    function ensureUI() {
        window.AshanUI = window.AshanUI || {};
        return window.AshanUI;
    }

    function asElement(value) {
        if (!value) return null;
        if (value instanceof Element) return value;
        if (window.jQuery && value instanceof jQuery) return value[0] || null;
        if (typeof value === "string") return document.querySelector(value);
        return null;
    }

    function setButtonBusy(button, busy, busyLabel) {
        const el = asElement(button);
        if (!el) return;
        if (busy) {
            if (!el.dataset.ashanOriginalLabel) {
                el.dataset.ashanOriginalLabel = el.textContent || "";
            }
            el.disabled = true;
            el.setAttribute("aria-busy", "true");
            el.classList.add("ashan-is-busy");
            if (busyLabel) el.textContent = busyLabel;
        } else {
            el.disabled = false;
            el.removeAttribute("aria-busy");
            el.classList.remove("ashan-is-busy");
            if (el.dataset.ashanOriginalLabel !== undefined) {
                el.textContent = el.dataset.ashanOriginalLabel;
                delete el.dataset.ashanOriginalLabel;
            }
        }
    }

    async function runAction(button, executor, options = {}) {
        if (typeof executor !== "function") return null;
        const el = asElement(button);
        if (el?.dataset.ashanActionPending === "true") return null;

        if (el) el.dataset.ashanActionPending = "true";
        setButtonBusy(el, true, options.busyLabel || "处理中…");

        try {
            const result = await executor();
            if (options.successMessage && window.frappe?.show_alert) {
                frappe.show_alert({
                    message: options.successMessage,
                    indicator: "green",
                });
            }
            return result;
        } catch (error) {
            if (options.errorMessage && window.frappe?.msgprint) {
                frappe.msgprint({
                    title: options.errorTitle || "操作失败",
                    indicator: "red",
                    message: options.errorMessage,
                });
            }
            throw error;
        } finally {
            if (el) delete el.dataset.ashanActionPending;
            setButtonBusy(el, false);
        }
    }

    function clearState(container) {
        const el = asElement(container);
        if (!el) return;
        el.querySelectorAll(":scope > .ashan-state-view").forEach((node) => node.remove());
    }

    function renderState(container, options = {}) {
        const el = asElement(container);
        if (!el) return null;
        clearState(el);

        const type = ["loading", "empty", "error", "success"].includes(options.type)
            ? options.type
            : "empty";

        const state = document.createElement("div");
        state.className = `ashan-state-view ashan-state-${type}`;
        state.setAttribute("role", type === "error" ? "alert" : "status");

        const title = document.createElement("div");
        title.className = "ashan-state-title";
        title.textContent = options.title || (
            type === "loading" ? "正在加载" :
            type === "error" ? "加载失败" :
            type === "success" ? "操作完成" : "当前没有数据"
        );

        const message = document.createElement("div");
        message.className = "ashan-state-message";
        message.textContent = options.message || "";

        state.appendChild(title);
        if (message.textContent) state.appendChild(message);

        if (options.actionLabel && typeof options.onAction === "function") {
            const action = document.createElement("button");
            action.type = "button";
            action.className = "ashan-btn-outline ashan-state-action";
            action.textContent = options.actionLabel;
            action.addEventListener("click", options.onAction);
            state.appendChild(action);
        }

        el.appendChild(state);
        return state;
    }

    function focusableElements(container) {
        return Array.from(container.querySelectorAll(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), ' +
            'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter((node) => !node.hasAttribute("hidden"));
    }

    function closeInspector() {
        if (!activeInspector) return;
        const { backdrop, previousFocus, keyHandler } = activeInspector;
        document.removeEventListener("keydown", keyHandler, true);
        backdrop.classList.remove("is-open");
        document.body.classList.remove("ashan-inspector-open");
        window.setTimeout(() => {
            backdrop.remove();
            previousFocus?.focus?.();
        }, 160);
        activeInspector = null;
    }

    function openInspector(options = {}) {
        closeInspector();

        const previousFocus = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;

        const backdrop = document.createElement("div");
        backdrop.className = "ashan-inspector-backdrop";

        const panel = document.createElement("aside");
        panel.className = "ashan-inspector";
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-modal", "true");
        panel.setAttribute("aria-label", options.title || "详情");

        const header = document.createElement("header");
        header.className = "ashan-inspector-header";

        const headingWrap = document.createElement("div");
        headingWrap.className = "ashan-inspector-heading";

        const title = document.createElement("h2");
        title.className = "ashan-inspector-title";
        title.textContent = options.title || "详情";
        headingWrap.appendChild(title);

        if (options.subtitle) {
            const subtitle = document.createElement("div");
            subtitle.className = "ashan-inspector-subtitle";
            subtitle.textContent = options.subtitle;
            headingWrap.appendChild(subtitle);
        }

        const close = document.createElement("button");
        close.type = "button";
        close.className = "ashan-inspector-close";
        close.setAttribute("aria-label", "关闭详情");
        close.setAttribute("title", "关闭");
        close.textContent = "×";
        close.addEventListener("click", closeInspector);

        header.appendChild(headingWrap);
        header.appendChild(close);

        const body = document.createElement("div");
        body.className = "ashan-inspector-body";

        if (options.body instanceof Node) {
            body.appendChild(options.body);
        } else if (typeof options.renderBody === "function") {
            const rendered = options.renderBody();
            if (rendered instanceof Node) body.appendChild(rendered);
        } else if (options.message) {
            const message = document.createElement("p");
            message.className = "ashan-inspector-message";
            message.textContent = options.message;
            body.appendChild(message);
        }

        panel.appendChild(header);
        panel.appendChild(body);

        if (Array.isArray(options.actions) && options.actions.length) {
            const footer = document.createElement("footer");
            footer.className = "ashan-inspector-footer";
            options.actions.forEach((definition, index) => {
                const button = document.createElement("button");
                button.type = "button";
                button.className = definition.danger
                    ? "ashan-btn-danger"
                    : index === options.actions.length - 1
                        ? "ashan-btn-primary"
                        : "ashan-btn-outline";
                button.textContent = definition.label || "操作";
                button.addEventListener("click", () => {
                    if (typeof definition.onClick === "function") {
                        definition.onClick({ close: closeInspector, button });
                    }
                });
                footer.appendChild(button);
            });
            panel.appendChild(footer);
        }

        backdrop.appendChild(panel);
        backdrop.addEventListener("mousedown", (event) => {
            if (event.target === backdrop && options.closeOnBackdrop !== false) {
                closeInspector();
            }
        });

        const keyHandler = (event) => {
            if (!activeInspector) return;
            if (event.key === "Escape") {
                event.preventDefault();
                closeInspector();
                return;
            }
            if (event.key !== "Tab") return;
            const focusables = focusableElements(panel);
            if (!focusables.length) {
                event.preventDefault();
                close.focus();
                return;
            }
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener("keydown", keyHandler, true);
        document.body.appendChild(backdrop);
        document.body.classList.add("ashan-inspector-open");

        activeInspector = { backdrop, panel, previousFocus, keyHandler };
        requestAnimationFrame(() => {
            backdrop.classList.add("is-open");
            close.focus();
        });

        return { close: closeInspector, panel, body };
    }

    function enhancePageShell() {
        const route = window.frappe?.get_route?.() || [];
        const routeName = String(route[0] || "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
        if (document.body) document.body.dataset.ashanRoute = routeName;

        document.querySelectorAll([
            ".picker-page-container",
            ".oil-console-layout",
            ".ashan-smart-modal",
            ".salary-workbench",
            ".monthly-closing-center",
        ].join(",")).forEach((node) => {
            node.classList.add("ashan-unified-surface");
        });

        document.querySelectorAll(
            ".picker-data-table, .oil-data-table, .ashan-smart-table"
        ).forEach((table) => table.classList.add("ashan-unified-table"));

        document.querySelectorAll(
            ".picker-btn-primary, .btn-cmd-primary"
        ).forEach((button) => button.classList.add("ashan-action-primary"));

        document.querySelectorAll(
            ".picker-btn-secondary, .btn-cmd-secondary, .btn-nav-step"
        ).forEach((button) => button.classList.add("ashan-action-secondary"));
    }

    function ensureSkipLink() {
        if (!document.body || document.getElementById("ashan-skip-to-content")) return;
        const link = document.createElement("a");
        link.id = "ashan-skip-to-content";
        link.className = "ashan-skip-link";
        link.href = "#";
        link.textContent = "跳到主要内容";
        link.addEventListener("click", (event) => {
            event.preventDefault();
            const target = document.querySelector(
                ".layout-main-section, .page-content, .picker-page-container, .oil-console-main"
            );
            if (!target) return;
            if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
            target.focus({ preventScroll: true });
            target.scrollIntoView({ block: "start" });
        });
        document.body.prepend(link);
    }

    function enhance() {
        ensureSkipLink();
        enhancePageShell();
    }

    function scheduleEnhance() {
        if (enhanceFrame) return;
        enhanceFrame = requestAnimationFrame(() => {
            enhanceFrame = 0;
            enhance();
        });
    }

    function init() {
        const UI = ensureUI();
        UI.experienceVersion = EXPERIENCE_VERSION;
        UI.runAction = runAction;
        UI.renderState = renderState;
        UI.clearState = clearState;
        UI.openInspector = openInspector;
        UI.closeInspector = closeInspector;
        UI.enhancePage = scheduleEnhance;

        scheduleEnhance();

        if (window.frappe?.router?.on && !window.__ashanProductShellRouteBound) {
            frappe.router.on("change", scheduleEnhance);
            window.__ashanProductShellRouteBound = true;
        }

        if (document.body && !window.__ashanProductShellObserver) {
            const observer = new MutationObserver(scheduleEnhance);
            observer.observe(document.body, { childList: true, subtree: true });
            window.__ashanProductShellObserver = observer;
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }
})();
