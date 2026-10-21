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
    let workContextSidebarBound = false;

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
            // The shared sidebar CSS rotates this chevron down while a section is open.
            dropIcon?.querySelector("use")?.setAttribute("href", "#icon-chevron-right");

            // Keep Frappe's internal accordion state aligned with the DOM state.
            // Child-link navigation consults this value after the route changes.
            const nativeItems = window.frappe?.app?.sidebar?.items;
            if (Array.isArray(nativeItems)) {
                const nativeItem = nativeItems.find((item) => {
                    const itemLabel = String(item?.item?.label || item?.item?.title || "").trim();
                    return itemLabel === id;
                });
                if (nativeItem) nativeItem.collapsed = !open;
            }
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

        kpiCache.pending = new Promise((resolve) => {
            frappe.call({
                method: "ashan_cn_procurement.services.procurement_picker_service.get_sidebar_notification_kpis",
                freeze: false,
                callback: (response) => {
                    kpiCache.value = response?.message || {};
                    kpiCache.at = Date.now();
                    kpiCache.pending = null;
                    resolve(kpiCache.value);
                },
                error: () => {
                    kpiCache.pending = null;
                    resolve(kpiCache.value || {});
                }
            });
        });

        return kpiCache.pending;
    }

    function renderKpis(sidebar, kpis) {
        if (!sidebar || !kpis) return;

        // 1. Render child badges with pure numbers
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

        // 2. Aggregate section totals and bubble up to section headers
        sections(sidebar).forEach((section) => {
            let sectionTotal = 0;
            section.querySelectorAll(".sidebar-child-item a[href]").forEach((anchor) => {
                const href = normalizeHref(anchor.getAttribute("href"));
                const route = Object.keys(KPI_ROUTES).find((key) => href.includes(key));
                const count = route ? Number(kpis[KPI_ROUTES[route]] || 0) : 0;
                sectionTotal += count;
            });

            const trigger = section.querySelector(":scope > .standard-sidebar-item .item-anchor");
            if (!trigger) return;

            let sectionBadge = trigger.querySelector(".ashan-sidebar-section-badge");
            if (sectionTotal > 0) {
                if (!sectionBadge) {
                    sectionBadge = document.createElement("span");
                    sectionBadge.className = "ashan-sidebar-section-badge";
                    trigger.appendChild(sectionBadge);
                }
                sectionBadge.textContent = sectionTotal > 99 ? "99+" : String(sectionTotal);
                sectionBadge.setAttribute("aria-label", `${sectionTotal} 项待处理`);
                sectionBadge.setAttribute("title", `${sectionTotal} 项待处理`);
            } else {
                sectionBadge?.remove();
            }
        });
    }

    async function refreshBadges(force = false) {
        const sidebar = sidebarRoot();
        if (!sidebar) return;
        renderKpis(sidebar, await fetchKpis(force));
    }

    
    function renderSidebarUtilityBox(sidebar) {
        if (!sidebar) return;
        const bottom = sidebar.querySelector(".body-sidebar-bottom");
        if (!bottom) return;

        const oldBox = bottom.querySelector(".ashan-sidebar-utility-box");
        if (oldBox) oldBox.remove();

        let ctrls = bottom.querySelector(".ashan-sidebar-section-ctrls");
        if (!ctrls) {
            ctrls = document.createElement("div");
            ctrls.className = "ashan-sidebar-section-ctrls";
            const userDropdown = bottom.querySelector(".dropdown-navbar-user, .sidebar-user-button, .nav-item");
            if (userDropdown) {
                bottom.insertBefore(ctrls, userDropdown);
            } else {
                bottom.prepend(ctrls);
            }
        }

        const isAdmin = Boolean(
            (window.AshanWorkContext && typeof window.AshanWorkContext.canSetDate === "function" && window.AshanWorkContext.canSetDate())
            || (window.frappe?.session?.user === "Administrator")
            || (window.frappe?.boot && Boolean(window.frappe.boot.ashan_is_system_manager))
        );

        const todayStr = (window.AshanWorkContext && typeof window.AshanWorkContext.getWorkDate === "function" && window.AshanWorkContext.getWorkDate())
            || (window.frappe && window.frappe.datetime && window.frappe.datetime.get_today && window.frappe.datetime.get_today())
            || new Date().toISOString().split("T")[0];

        const currentComp = (window.AshanWorkContext && typeof window.AshanWorkContext.getCompany === "function" && window.AshanWorkContext.getCompany())
            || (window.frappe && window.frappe.defaults && (window.frappe.defaults.get_user_default("Company") || window.frappe.defaults.get_default("company")))
            || "";

        let companiesList = (window.AshanWorkContext && typeof window.AshanWorkContext.getCompanies === "function" && window.AshanWorkContext.getCompanies())
            || (window.frappe && window.frappe.boot && window.frappe.boot.ashan_work_context && window.frappe.boot.ashan_work_context.companies)
            || [];

        if (!companiesList.length && window.frappe && window.frappe.boot && window.frappe.boot.all_companies) {
            companiesList = window.frappe.boot.all_companies.map(c => typeof c === "string" ? c : c.name);
        }
        if (!companiesList.length) {
            companiesList = ["天津市祺富汽车配件有限公司", "天津吉众科技有限公司"];
        }

        const compSelect = ctrls.querySelector("#ashan-sidebar-company-select");
        const dateInput = ctrls.querySelector("#ashan-sidebar-date-input");
        const isRenderedAdmin = Boolean(ctrls.querySelector("#ashan-sidebar-open-typo-btn"));

        if (!compSelect || (isAdmin !== isRenderedAdmin)) {
            let companyOptionsHtml = `<option value="">全部公司</option>`;
            companiesList.forEach(comp => {
                const isSel = (comp === currentComp) ? "selected" : "";
                companyOptionsHtml += `<option value="${frappe.utils.escape_html(comp)}" ${isSel}>${frappe.utils.escape_html(comp)}</option>`;
            });

            let adminControlsHtml = "";
            if (isAdmin) {
                adminControlsHtml = `
                    <div class="ashan-sidebar-ctrl-group">
                        <label class="ashan-sidebar-ctrl-label" for="ashan-sidebar-date-input">默认日期</label>
                        <input type="date" class="ashan-sidebar-ctrl-input" id="ashan-sidebar-date-input" value="${todayStr}" title="直接设置系统默认业务记账日期（无弹窗）">
                    </div>
                    <button type="button" class="ashan-sidebar-typo-btn" id="ashan-sidebar-open-typo-btn" title="调整全系统字体大小与表格高度">
                        页面设置
                    </button>
                `;
            }

            ctrls.innerHTML = `
                <div class="ashan-sidebar-ctrl-group">
                    <label class="ashan-sidebar-ctrl-label" for="ashan-sidebar-company-select">默认公司</label>
                    <select class="ashan-sidebar-ctrl-select" id="ashan-sidebar-company-select" title="直接切换当前工作公司（无弹窗）">
                        ${companyOptionsHtml}
                    </select>
                </div>
                ${adminControlsHtml}
            `;

            const newCompSelect = ctrls.querySelector("#ashan-sidebar-company-select");
            if (newCompSelect) {
                newCompSelect.addEventListener("change", function () {
                    const val = this.value;
                    if (window.AshanWorkContext && typeof window.AshanWorkContext.setCompany === "function") {
                        window.AshanWorkContext.setCompany(val);
                    }
                });
            }

            const newDateInput = ctrls.querySelector("#ashan-sidebar-date-input");
            if (newDateInput) {
                newDateInput.addEventListener("change", function () {
                    const val = this.value;
                    if (window.AshanWorkContext && typeof window.AshanWorkContext.setWorkDate === "function") {
                        window.AshanWorkContext.setWorkDate(val);
                    }
                });
            }

            const typoBtn = ctrls.querySelector("#ashan-sidebar-open-typo-btn");
            if (typoBtn) {
                typoBtn.addEventListener("click", function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (window.AshanUI && typeof window.AshanUI.openTypographySettingsDialog === "function") {
                        window.AshanUI.openTypographySettingsDialog();
                    }
                });
            }
        } else {
            if (compSelect.value !== currentComp) {
                compSelect.value = currentComp;
            }
            if (dateInput && dateInput.value !== todayStr) {
                dateInput.value = todayStr;
            }
        }
    }

    function hydrate(sidebar) {
        if (!sidebar || sidebar !== sidebarRoot()) return;
        sidebar.dataset.ashanSidebarHydrating = "true";
        classifyItems(sidebar);
        syncOpenSection(sidebar);
        highlightActiveItem(sidebar);
        refreshBadges(false);
        renderSidebarUtilityBox(sidebar);
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
            if (mutations.some((mutation) => mutation.type === "childList" && mutation.target === items)) {
                schedule(sidebarRoot());
            }
        });
        // Badges are rendered inside child links. Do not re-hydrate the accordion
        // for those asynchronous content changes, or the active route reopens later.
        observer.observe(items, { childList: true });
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

        if (!workContextSidebarBound) {
            document.addEventListener("ashan-work-context-changed", () => {
                const sidebar = sidebarRoot();
                if (sidebar) renderSidebarUtilityBox(sidebar);
            });
            workContextSidebarBound = true;
        }

        window.AshanUI.refreshSidebarBadges = () => refreshBadges(true);
    }

    window.AshanUI = window.AshanUI || {};
    window.AshanUI.renderSidebarUtilityBox = (sb) => renderSidebarUtilityBox(sb || sidebarRoot());

    init();
    if (window.jQuery) {
        jQuery(document).ready(init);
        jQuery(document).on("app_ready sidebar_setup", init);
    }
})();
