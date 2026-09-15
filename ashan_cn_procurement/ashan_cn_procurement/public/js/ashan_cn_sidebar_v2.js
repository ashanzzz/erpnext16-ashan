/* Ashan business sidebar: Frappe-native, deterministic, permission-friendly. */
(function () {
    "use strict";

    const SIDEBAR_NAME = "My Business";
    const BUSINESS_MODULES = new Set([
        "setup", "buying", "stock", "accounts", "selling", "hr",
        "ashan_cn_procurement", "ashan cn procurement",
    ]);
    const STORAGE_PREFIX = "ashan.sidebar.open.";
    const LAST_SECTION_KEY = "ashan.sidebar.last-section";
    const KPI_TTL_MS = 60 * 1000;
    const KPI_ROUTES = {
        "material-request-workbench": "material-request-workbench",
        "procurement-execution-workbench": "procurement-execution-workbench",
        "material-receipt-workbench": "material-receipt-workbench",
        "stock-issue-workbench": "stock-issue-workbench",
    };

    let scheduledFrame = 0;
    let observer = null;
    let observedItems = null;
    let kpiCache = { at: 0, value: null, pending: null };

    function currentUser() {
        return window.frappe?.session?.user || "anonymous";
    }

    function storageKey() {
        return `${STORAGE_PREFIX}${currentUser()}`;
    }

    function readStorage(key) {
        try {
            return window.sessionStorage.getItem(key) || "";
        } catch (error) {
            return "";
        }
    }

    function writeStorage(key, value) {
        try {
            window.sessionStorage.setItem(key, value || "");
        } catch (error) {
            // Storage may be unavailable in restricted browser sessions.
        }
    }

    function sidebarRoot() {
        return document.querySelector(".body-sidebar");
    }

    function sections(sidebar) {
        return Array.from(sidebar?.querySelectorAll(".sidebar-items > .section-item") || []);
    }

    function sectionId(section) {
        return String(
            section?.dataset?.id ||
            section?.getAttribute("item-name") ||
            section?.getAttribute("title") ||
            section?.querySelector(":scope > .standard-sidebar-item .sidebar-item-label")?.textContent ||
            ""
        ).trim();
    }

    function normalizeHref(href) {
        return String(href || "")
            .toLowerCase()
            .replace(/^https?:\/\/[^/]+/i, "")
            .replace(/^\/desk\//, "")
            .replace(/^\/app\//, "")
            .replace(/^#/, "")
            .replace(/^\//, "")
            .replace(/[?#].*$/, "")
            .replace(/\/+$/, "");
    }

    function routeToServerHomeIfNeeded() {
        const target = String(window.frappe?.boot?.ashan_home_route || "").trim();
        if (!target || !window.frappe?.set_route) return;

        const pathname = String(window.location.pathname || "")
            .toLowerCase()
            .replace(/\/+$/, "");
        const hash = String(window.location.hash || "").toLowerCase();
        const trueRoot = ["", "/", "/desk", "/app"].includes(pathname)
            && ["", "#", "#desk", "#app"].includes(hash);
        if (!trueRoot) return;

        const current = normalizeHref((window.frappe?.get_route?.() || []).join("/"));
        if (current && !["desk", "desktop"].includes(current)) return;

        const segments = target
            .replace(/^\/desk\//i, "")
            .replace(/^\/app\//i, "")
            .replace(/^\//, "")
            .split("/")
            .filter(Boolean)
            .map((segment) => decodeURIComponent(segment));
        if (segments.length) frappe.set_route(...segments);
    }

    function routeTokens() {
        const route = window.frappe?.get_route?.() || [];
        const tokens = new Set();
        if (route.length) {
            const joined = normalizeHref(route.join("/"));
            if (joined) tokens.add(joined);
            route.forEach((part) => {
                const token = normalizeHref(part);
                if (token) {
                    tokens.add(token);
                    tokens.add(token.replace(/[\s_]+/g, "-"));
                }
            });
        }
        return Array.from(tokens).filter(Boolean);
    }

    function anchorScore(anchor, tokens) {
        const href = normalizeHref(anchor?.getAttribute("href"));
        if (!href) return 0;
        let score = 0;
        tokens.forEach((token) => {
            if (href === token) score = Math.max(score, 100);
            else if (href.endsWith(`/${token}`) || token.endsWith(`/${href}`)) score = Math.max(score, 80);
            else if (href.includes(token) || token.includes(href)) score = Math.max(score, 50);
        });
        return score;
    }

    function companyMarker() {
        const company = String(window.AshanWorkContext?.getCompany?.() || "").trim();
        if (company.includes("祺富")) return "祺富";
        if (company.includes("吉众")) return "吉众";

        const routeCompany = String(window.frappe?.route_options?.company || "").trim();
        if (routeCompany.includes("祺富")) return "祺富";
        if (routeCompany.includes("吉众")) return "吉众";
        return "";
    }

    function matchingSections(sidebar) {
        const tokens = routeTokens();
        if (!tokens.length) return [];

        return sections(sidebar)
            .map((section) => {
                const score = Array.from(
                    section.querySelectorAll(":scope > .sidebar-child-item a[href]")
                ).reduce((best, anchor) => Math.max(best, anchorScore(anchor, tokens)), 0);
                return { section, id: sectionId(section), score };
            })
            .filter((entry) => entry.score > 0)
            .sort((a, b) => b.score - a.score);
    }

    function activeSectionId(sidebar) {
        const matches = matchingSections(sidebar);
        if (!matches.length) return "";

        const bestScore = matches[0].score;
        const best = matches.filter((entry) => entry.score === bestScore);
        if (best.length === 1) return best[0].id;

        const marker = companyMarker();
        if (marker) {
            const companyMatch = best.find((entry) => entry.id.includes(marker));
            if (companyMatch) return companyMatch.id;
        }

        const remembered = readStorage(LAST_SECTION_KEY) || readStorage(storageKey());
        const rememberedMatch = best.find((entry) => entry.id === remembered);
        return rememberedMatch?.id || best[0].id;
    }

    function setSectionOpen(sidebar, openId, persist = true) {
        sections(sidebar).forEach((section) => {
            const id = sectionId(section);
            const open = Boolean(openId) && id === openId;
            section.classList.toggle("ashan-sidebar-section-expanded", open);

            const trigger = section.querySelector(":scope > .standard-sidebar-item .item-anchor");
            if (trigger) {
                trigger.setAttribute("role", "button");
                trigger.setAttribute("tabindex", "0");
                trigger.setAttribute("aria-expanded", String(open));
            }

            const child = section.querySelector(":scope > .sidebar-child-item");
            if (child) {
                child.classList.toggle("hidden", !open);
                child.setAttribute("aria-hidden", String(!open));
            }

            const dropIcon = section.querySelector(":scope > .standard-sidebar-item .drop-icon");
            dropIcon?.setAttribute("data-state", open ? "opened" : "closed");
        });

        if (persist) {
            writeStorage(storageKey(), openId);
            if (openId) writeStorage(LAST_SECTION_KEY, openId);
        }
    }

    function syncOpenSection(sidebar) {
        const all = sections(sidebar);
        if (!all.length) return;

        const active = activeSectionId(sidebar);
        const remembered = readStorage(storageKey());
        const rememberedExists = all.some((section) => sectionId(section) === remembered);
        setSectionOpen(sidebar, active || (rememberedExists ? remembered : ""), false);
    }

    function sectionCompany(section) {
        const id = sectionId(section);
        let marker = "";
        if (id.includes("祺富")) marker = "祺富";
        if (id.includes("吉众")) marker = "吉众";
        if (!marker) return "";

        const companies = window.AshanWorkContext?.getContext?.().companies || [];
        return String(companies.find((company) => String(company).includes(marker)) || "");
    }

    function classifyItems(sidebar) {
        sidebar.querySelectorAll(".section-item").forEach((section) => {
            section.dataset.ashanSection = "true";
        });

        sidebar.querySelectorAll(".sidebar-child-item .standard-sidebar-item").forEach((row) => {
            const anchor = row.querySelector("a[href]");
            if (!anchor) return;
            const href = normalizeHref(anchor.getAttribute("href"));
            const label = row.querySelector(".sidebar-item-label");
            const text = String(label?.textContent || "").replace(/^[*•·\s]+/, "").trim();
            if (label && label.textContent !== text) label.textContent = text;

            const isWorkbench = /workbench|picker|center|ledger/.test(href) ||
                /(工作台|台账|资料库|核定中心)/.test(text);
            row.dataset.ashanNavKind = isWorkbench ? "workbench" : "record";
        });
    }

    function highlightActiveItem(sidebar) {
        const tokens = routeTokens();
        if (!tokens.length) return;

        sidebar.querySelectorAll(".sidebar-child-item .standard-sidebar-item").forEach((row) => {
            row.classList.remove("active", "selected", "active-sidebar");
        });

        const openId = activeSectionId(sidebar);
        const scope = sections(sidebar).find((section) => sectionId(section) === openId) || sidebar;
        let bestRow = null;
        let bestScore = 0;

        scope.querySelectorAll(".sidebar-child-item .standard-sidebar-item").forEach((row) => {
            const score = anchorScore(row.querySelector("a[href]"), tokens);
            if (score > bestScore) {
                bestScore = score;
                bestRow = row;
            }
        });

        if (bestRow) bestRow.classList.add("active-sidebar");
    }

    function patchResolver() {
        if (!window.frappe?.ui?.Sidebar) return false;
        const Sidebar = frappe.ui.Sidebar;
        if (Sidebar._ashanResolverPatched) return true;

        const original = Sidebar.prototype.resolve_sidebar;
        Sidebar.prototype.resolve_sidebar = function (doctype, module) {
            const moduleName = String(module || "").toLowerCase();
            if (!moduleName || BUSINESS_MODULES.has(moduleName)) return SIDEBAR_NAME;
            return original ? original.apply(this, arguments) : null;
        };
        Sidebar._ashanResolverPatched = true;
        return true;
    }

    async function fetchKpis(force = false) {
        const now = Date.now();
        if (!force && kpiCache.value && now - kpiCache.at < KPI_TTL_MS) return kpiCache.value;
        if (kpiCache.pending) return kpiCache.pending;
        if (!window.frappe?.call || window.frappe?.session?.user === "Guest") return null;

        kpiCache.pending = frappe.call({
            method: "ashan_cn_procurement.services.procurement_picker_service.get_sidebar_notification_kpis",
            freeze: false,
        }).then((response) => {
            kpiCache.value = response?.message || {};
            kpiCache.at = Date.now();
            return kpiCache.value;
        }).catch(() => kpiCache.value).then(() => {
            kpiCache.pending = null;
        });

        return kpiCache.pending;
    }

    function renderKpis(sidebar, kpis) {
        if (!sidebar || !kpis) return;
        sidebar.querySelectorAll(".sidebar-child-item a[href]").forEach((anchor) => {
            const href = normalizeHref(anchor.getAttribute("href"));
            const route = Object.keys(KPI_ROUTES).find((key) => href.includes(key));
            const count = route ? Number(kpis[KPI_ROUTES[route]] || 0) : 0;
            let badge = anchor.querySelector(".ashan-sidebar-count-badge");

            if (count > 0) {
                if (!badge) {
                    badge = document.createElement("span");
                    badge.className = "ashan-sidebar-count-badge";
                    anchor.appendChild(badge);
                }
                badge.textContent = count > 99 ? "99+" : String(count);
                badge.setAttribute("aria-label", `${count} 项待处理`);
                badge.setAttribute("title", `${count} 项待处理`);
            } else {
                badge?.remove();
            }
        });
    }

    async function refreshBadges(force = false) {
        const sidebar = sidebarRoot();
        if (!sidebar) return;
        renderKpis(sidebar, await fetchKpis(force));
    }

    function hydrate(sidebar) {
        if (!sidebar || sidebar !== sidebarRoot()) return;
        sidebar.dataset.ashanSidebarHydrating = "true";
        classifyItems(sidebar);
        syncOpenSection(sidebar);
        highlightActiveItem(sidebar);
        refreshBadges(false);
        requestAnimationFrame(() => {
            if (sidebar === sidebarRoot()) delete sidebar.dataset.ashanSidebarHydrating;
        });
    }

    function schedule(sidebar = sidebarRoot()) {
        if (!sidebar) return;
        if (scheduledFrame) cancelAnimationFrame(scheduledFrame);
        scheduledFrame = requestAnimationFrame(() => {
            scheduledFrame = 0;
            hydrate(sidebar);
            observe();
        });
    }

    function toggleFromTarget(target) {
        if (!(target instanceof Element)) return false;
        if (target.closest(".sidebar-item-edit-controls")) return false;

        const trigger = target.closest(".body-sidebar .section-item > .standard-sidebar-item");
        if (!trigger) return false;

        const section = trigger.closest(".section-item");
        const sidebar = trigger.closest(".body-sidebar");
        if (!section || !sidebar || !section.parentElement?.classList.contains("sidebar-items")) return false;

        const id = sectionId(section);
        // Use the child element's actual visual state (hidden class) as ground truth.
        // Frappe native code may change `hidden` without touching our CSS class, so
        // reading only `ashan-sidebar-section-expanded` can give inverted toggle behaviour.
        const child = section.querySelector(":scope > .sidebar-child-item");
        const isActuallyOpen = child
            ? !child.classList.contains("hidden")
            : section.classList.contains("ashan-sidebar-section-expanded");
        setSectionOpen(sidebar, isActuallyOpen ? "" : id);
        return true;
    }

    function bindInteractions() {
        if (window.__ashanUnifiedSidebarBound) return;

        document.addEventListener("click", (event) => {
            if (toggleFromTarget(event.target)) {
                event.preventDefault();
                event.stopImmediatePropagation();
                return;
            }

            const anchor = event.target instanceof Element
                ? event.target.closest(".body-sidebar .section-item > .sidebar-child-item a[href]")
                : null;
            if (!anchor) return;

            const section = anchor.closest(".section-item");
            const sidebar = anchor.closest(".body-sidebar");
            if (!section || !sidebar) return;

            const id = sectionId(section);
            setSectionOpen(sidebar, id);
            const company = sectionCompany(section);
            if (company && window.frappe) {
                frappe.route_options = Object.assign({}, frappe.route_options || {}, { company });
            }
        }, true);

        document.addEventListener("keydown", (event) => {
            if (!["Enter", " "].includes(event.key)) return;
            if (!toggleFromTarget(event.target)) return;
            event.preventDefault();
            event.stopImmediatePropagation();
        }, true);

        window.__ashanUnifiedSidebarBound = true;
    }

    function observe() {
        const items = sidebarRoot()?.querySelector(".sidebar-items");
        if (!items) return;
        if (observedItems === items) return;

        observer?.disconnect();
        observer = new MutationObserver((mutations) => {
            if (mutations.some((mutation) => mutation.type === "childList")) schedule(sidebarRoot());
        });
        observer.observe(items, { childList: true, subtree: true });
        observedItems = items;
    }

    function init() {
        if (!window.frappe) {
            window.setTimeout(init, 100);
            return;
        }
        patchResolver();
        bindInteractions();
        routeToServerHomeIfNeeded();
        schedule();
        observe();

        if (frappe.router?.on && !window.__ashanUnifiedSidebarRouteBound) {
            frappe.router.on("change", () => {
                routeToServerHomeIfNeeded();
                schedule();
            });
            window.__ashanUnifiedSidebarRouteBound = true;
        }

        window.AshanUI = window.AshanUI || {};
        window.AshanUI.refreshSidebarBadges = () => refreshBadges(true);
    }

    init();
    if (window.jQuery) {
        jQuery(document).ready(init);
        jQuery(document).on("app_ready sidebar_setup", init);
    }
})();
