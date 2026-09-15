/* ==========================================================================
   ERPNext 16 业务扩展 - 精准层级解耦与全站统一侧边栏架构 (Strict Hierarchy & Persistent Sidebar)
   1. 一级菜单小箭头：仅折叠/展开当前一级菜单
   2. 一级菜单文字区：折叠/展开当前一级菜单 + 联动分类 Dashboard
   3. 二级菜单单据项：绝对不触发折叠/展开，纯粹 SPA 路由跳转
   4. 全站刷新持久化：即使在单据页（如 Purchase Invoice）直接按 F5 刷新，侧边栏也始终稳定保持业务扩展中文侧边栏
   ========================================================================== */

(function() {
    function get_user_roles() {
        if (!window.frappe) return [];
        if (frappe.boot && frappe.boot.user && Array.isArray(frappe.boot.user.roles)) {
            return frappe.boot.user.roles;
        }
        if (Array.isArray(frappe.user_roles)) {
            return frappe.user_roles;
        }
        return [];
    }

    function is_oil_card_manager_user() {
        const roles = get_user_roles();
        const mgr_roles = ["System Manager", "Oil Card Manager", "油卡管理员", "Purchase Manager", "Accounts Manager", "Stock Manager"];
        return roles.some(r => mgr_roles.includes(r)) || (frappe.session && frappe.session.user === "Administrator");
    }

    function is_pure_operator() {
        const roles = get_user_roles();
        const isOp = roles.includes("Oil Card Operator") || roles.includes("油卡操作员");
        return isOp && !is_oil_card_manager_user();
    }

    // 0. 路由守卫与官方 Desktop 映射
    // Frappe v16 中 Workspace name='Home' 的前端路由为 'Workspaces/Home'
    // 1) 普通员工阻止访问总控主页，重定向到油卡台账
    // 2) 管理员访问原生 desktop / desk 路由或大图标页时，平滑直达定制总控主页 Workspaces/Home
    function handle_route_guard() {
        if (!window.frappe) return;
        const routeArr = (frappe.get_route && frappe.get_route()) || [];
        const route = Array.isArray(routeArr) ? routeArr.join("/") : "";
        const isMgr = is_oil_card_manager_user();

        if (!isMgr) {
            if (
                route === "home" ||
                route === "Workspaces/Home" ||
                route === "Workspaces/My Business" ||
                route === "Workspaces/home" ||
                route === "desktop" ||
                (routeArr.length === 1 && routeArr[0] === "desktop")
            ) {
                frappe.set_route("oil-card-ledger");
            }
        } else {
            const isDesktopPage = (
                route === "desktop" ||
                route === "desk" ||
                (routeArr.length === 1 && routeArr[0] === "desktop") ||
                (frappe.container && frappe.container.page && frappe.container.page.page_name === "desktop")
            );
            if (isDesktopPage) {
                frappe.set_route(["Workspaces", "Home"]);
            }
        }
    }

    if (window.frappe) {
        frappe.router && frappe.router.on && frappe.router.on("change", handle_route_guard);
    }

    // 1. 一级标题 → 对应 Workspace / Page 映射
    const SECTION_WORKSPACE_MAP = {
        "车辆和车用油管理": "oil-card-ledger",
        "油卡使用明细": "oil-card-ledger",
        "车油能耗中心": "oil-card-ledger",
        "车辆燃油": "oil-card-ledger",
        "燃油管理": "oil-card-ledger",
        "仓库与库存": "stock-and-inventory",
        "库存": "stock-and-inventory",
        "采购协同": "procurement-management",
        "采购": "procurement-management",
        "物业与租赁": "property-and-lease",
        "物业与租赁管理": "property-and-lease",
        "公司合规": "company-compliance-center",
        "企业合规中心": "company-compliance-center",
        "财税与发票中心": "accounting-and-finance",
        "财税中心": "accounting-and-finance",
        "发票中心": "accounting-and-finance",
        "人事薪酬与用工": "accounting-and-finance",
        "人事薪酬": "accounting-and-finance",
        "人事管理": "accounting-and-finance",
        "财务与报销": "accounting-and-finance",
        "财务": "accounting-and-finance",
        "我的业务 (总主页)": "home",
        "我的业务 (总控主页)": "home",
        "我的业务 (总看板)": "home",
        "我的业务": "home",
        "Home": "home",
        "home": "home"
    };

    const FUEL_SECTION_TITLES = [
        "车辆和车用油管理",
        "🚗 车辆和车用油管理",
        "油卡使用明细",
        "车油能耗中心",
        "车辆燃油",
        "燃油管理"
    ];

    const ALL_WS_KEYS = [
        "home", "Home",
        "my business", "my-business",
        "stock and inventory", "stock-and-inventory",
        "procurement management", "procurement-management",
        "property and lease", "property-and-lease",
        "vehicle fuel hub", "vehicle-fuel-hub",
        "company compliance center", "company-compliance-center",
        "accounting and finance", "accounting-and-finance",
        "ashan cn procurement", "ashan_cn_procurement",
        "业务扩展"
    ];

    // 2. 单据页统一使用 App 维护的业务侧边栏。
    const BUSINESS_SIDEBAR = "My Business";
    const SYSTEM_MANAGEMENT_SECTIONS = ["系统管理", "系统与权限中心"];
    const SYSTEM_MANAGEMENT_ROUTES = [
        "/desk/role",
        "/desk/user",
        "/desk/permission-manager",
        "/desk/workspaces",
        "/desk/client-script",
        "/desk/customize-form",
        "/desk/server-script",
        "/desk/system-settings"
    ];

    function get_system_manager_status() {
        if (!window.frappe) return null;
        if (frappe.boot && Object.prototype.hasOwnProperty.call(frappe.boot, "ashan_is_system_manager")) {
            return Boolean(frappe.boot.ashan_is_system_manager);
        }
        if (frappe.boot && frappe.boot.user && Array.isArray(frappe.boot.user.roles)) {
            return frappe.boot.user.roles.includes("System Manager");
        }
        if (Array.isArray(frappe.user_roles)) {
            return frappe.user_roles.includes("System Manager");
        }
        if (frappe.user && typeof frappe.user.has_role === "function") {
            return Boolean(frappe.user.has_role("System Manager"));
        }
        return null;
    }

    // Workspace Sidebar Item has no native role field in Frappe v16. Keep the
    // business navigation clean for ordinary users; actual access remains
    // protected by the standard DocType and System Settings permissions.
    function restrict_system_management_section() {
        const $sidebar = $(".body-sidebar");
        if (!$sidebar.length) return;

        // 1. 如果是纯操作员：
        // 操作员只能看见左边【车辆和车用油管理】（且手风琴下拉仅保留【油卡综合台账明细台】）
        if (is_pure_operator()) {
            // 移除顶部的【我的业务 (总控主页)】
            $sidebar.find("a").filter(function() {
                const href = ($(this).attr("href") || "").toLowerCase();
                const text = $(this).text().trim();
                return href.includes("my-business") || href.includes("/desk/home") || text.includes("我的业务") || text.includes("总控主页");
            }).closest(".standard-sidebar-item, .sidebar-item-container").remove();

            // 移除除【车辆和车用油管理】之外的所有一级分类大项
            $sidebar.find(".section-item").each(function() {
                const $section = $(this);
                const title = ($section.attr("item-name") || $section.attr("title") || "").trim();
                const labelText = $section.find(".sidebar-item-label").first().text().trim();
                if (!FUEL_SECTION_TITLES.includes(title) && !FUEL_SECTION_TITLES.includes(labelText)) {
                    $section.remove();
                }
            });

            // 在【车辆和车用油管理】下，只保留【油卡综合台账明细台】，移除所有底层原始单据
            $sidebar.find(".sidebar-child-item .standard-sidebar-item").filter(function() {
                const href = ($(this).find("a").attr("href") || "").toLowerCase();
                const text = $(this).text().trim();
                const isLedgerPage = href.includes("oil-card-ledger") || text.includes("油卡综合台账明细台") || text.includes("车辆和车用油管理");
                return !isLedgerPage;
            }).remove();

            // 确保【车辆和车用油管理】手风琴结构与小箭头完整呈现，并默认处于展开状态
            const $fuelSection = $sidebar.find(".section-item").filter(function() {
                const title = ($(this).attr("item-name") || $(this).attr("title") || "").trim();
                const labelText = $(this).find(".sidebar-item-label").first().text().trim();
                return FUEL_SECTION_TITLES.includes(title) || FUEL_SECTION_TITLES.includes(labelText);
            });
            if ($fuelSection.length) {
                $fuelSection.attr("data-state", "opened");
                $fuelSection.find(".drop-icon").attr("data-state", "opened").show().find("use").attr("href", "#icon-chevron-down");
                $fuelSection.find(".sidebar-item-control").show();
                $fuelSection.find(".sidebar-child-item").show().removeClass("hidden");
                $fuelSection.find(".sidebar-child-item .standard-sidebar-item").show().removeClass("hidden");
            }

            return;
        }

        // 2. 如果是普通管理员（非系统管理员），移除系统设置菜单
        if (get_system_manager_status() === false) {
            $sidebar.find("a").filter(function() {
                const href = $(this).attr("href") || "";
                return SYSTEM_MANAGEMENT_ROUTES.some((route) => href === route || href.startsWith(`${route}?`));
            }).closest(".sidebar-child-item").remove();

            $sidebar.find(".section-item").filter(function() {
                const $section = $(this);
                const title = ($section.attr("item-name") || $section.attr("title") || "").trim();
                const labelText = $section.find(".sidebar-item-label").first().text().trim();
                return SYSTEM_MANAGEMENT_SECTIONS.includes(title) || SYSTEM_MANAGEMENT_SECTIONS.includes(labelText);
            }).each(function() {
                const $section = $(this);
                $section.nextUntil(".section-item").filter(".sidebar-child-item").remove();
                $section.remove();
            });
        }
    }

    function schedule_system_management_visibility(retries = 20) {
        restrict_system_management_section();
        const status = get_system_manager_status();
        if (status === true && !is_pure_operator()) return;
        if (status === false || is_pure_operator()) {
            restrict_system_management_section();
            return;
        }
        if (retries > 0) {
            window.setTimeout(() => schedule_system_management_visibility(retries - 1), 150);
        }
    }

    function sanitize_boot_sidebars() {
        if (!window.frappe || !frappe.boot || !frappe.boot.workspace_sidebar_item) return;
        if (is_pure_operator()) {
            // 立即注入 CSS 零延迟防护层，杜绝首屏任何一闪而过
            if (!document.getElementById("operator-zero-fouc-style")) {
                const style = document.createElement("style");
                style.id = "operator-zero-fouc-style";
                style.innerHTML = `
                    .body-sidebar a[href*="my-business"],
                    .body-sidebar a[href*="/desk/home"],
                    .body-sidebar .section-item:not([item-name*="车辆和车用油"]):not([title*="车辆和车用油"]):not([item-name*="油卡"]):not([title*="油卡"]),
                    .body-sidebar a[href*="/desk/oil-card"]:not([href*="oil-card-ledger"]),
                    .body-sidebar a[href*="/desk/oil-card-recharge"],
                    .body-sidebar a[href*="/desk/oil-card-refuel-log"],
                    .body-sidebar a[href*="/desk/oil-card-invoice-batch"],
                    .body-sidebar a[href*="/desk/user"],
                    .body-sidebar a[href*="/desk/role"] {
                        display: none !important;
                    }
                `;
                document.head.appendChild(style);
            }

            Object.keys(frappe.boot.workspace_sidebar_item).forEach(ws_key => {
                const ws = frappe.boot.workspace_sidebar_item[ws_key];
                if (ws && Array.isArray(ws.items)) {
                    const filtered = [];
                    let inFuelSection = false;
                    ws.items.forEach(item => {
                        const title = (item.label || item.item_name || "").trim();
                        if (item.type === "Section Break") {
                            if (FUEL_SECTION_TITLES.includes(title)) {
                                inFuelSection = true;
                                item.label = "车辆和车用油管理";
                                item.show_arrow = 1;
                                item.collapsible = 1;
                                filtered.push(item);
                            } else {
                                inFuelSection = false;
                            }
                        } else if (inFuelSection) {
                            const linkTo = (item.link_to || "").toLowerCase();
                            if (linkTo === "oil-card-ledger" || title.includes("油卡综合台账明细台")) {
                                filtered.push(item);
                            }
                        }
                    });
                    ws.items = filtered;
                }
            });
        }
    }

    // 立即执行 boot 数据净化
    sanitize_boot_sidebars();

    function patch_sidebar_resolver() {
        if (!window.frappe || !frappe.ui || !frappe.ui.Sidebar) return false;
        const Sidebar = frappe.ui.Sidebar;
        if (Sidebar._ashan_resolved_patched) return true;

        const orig_prepare = Sidebar.prototype.prepare;
        Sidebar.prototype.prepare = function() {
            sanitize_boot_sidebars();
            if (is_pure_operator()) {
                if (this.sidebar_data && Array.isArray(this.sidebar_data.items)) {
                    const filtered = [];
                    let inFuelSection = false;
                    this.sidebar_data.items.forEach(item => {
                        const title = (item.label || item.item_name || "").trim();
                        if (item.type === "Section Break") {
                            if (FUEL_SECTION_TITLES.includes(title)) {
                                inFuelSection = true;
                                item.label = "车辆和车用油管理";
                                item.show_arrow = 1;
                                item.collapsible = 1;
                                filtered.push(item);
                            } else {
                                inFuelSection = false;
                            }
                        } else if (inFuelSection) {
                            const linkTo = (item.link_to || "").toLowerCase();
                            if (linkTo === "oil-card-ledger" || title.includes("油卡综合台账明细台")) {
                                filtered.push(item);
                            }
                        }
                    });
                    this.sidebar_data.items = filtered;
                    this.workspace_sidebar_items = filtered;
                }
            }
            if (orig_prepare) orig_prepare.apply(this, arguments);
        };

        const orig_find_nested_items = Sidebar.prototype.find_nested_items;
        Sidebar.prototype.find_nested_items = function() {
            if (is_pure_operator()) {
                const filtered = [];
                let inFuelSection = false;
                (this.workspace_sidebar_items || []).forEach(item => {
                    const title = (item.label || item.item_name || "").trim();
                    if (item.type === "Section Break") {
                        if (FUEL_SECTION_TITLES.includes(title)) {
                            inFuelSection = true;
                            item.label = "车辆和车用油管理";
                            item.show_arrow = 1;
                            item.collapsible = 1;
                            filtered.push(item);
                        } else {
                            inFuelSection = false;
                        }
                    } else if (inFuelSection) {
                        const linkTo = (item.link_to || "").toLowerCase();
                        if (linkTo === "oil-card-ledger" || title.includes("油卡综合台账明细台")) {
                            filtered.push(item);
                        }
                    }
                });
                this.workspace_sidebar_items = filtered;
            }
            if (orig_find_nested_items) orig_find_nested_items.apply(this, arguments);
        };

        const orig_resolve_sidebar = Sidebar.prototype.resolve_sidebar;
        Sidebar.prototype.resolve_sidebar = function(doctype, module) {
            // 当处于采购、库存、财务等业务单据或标准模块时，统一解析为 App 维护的
            // 业务侧边栏。这样从一级看板进入任意二级单据后，不会切换到系统 Home。
            const mod_lower = (module || "").toLowerCase();
            if (!module || mod_lower === "setup" || mod_lower === "buying" || mod_lower === "stock" || mod_lower === "accounts" || mod_lower === "hr" || mod_lower === "ashan_cn_procurement" || mod_lower === "ashan cn procurement") {
                return BUSINESS_SIDEBAR;
            }
            const res = orig_resolve_sidebar ? orig_resolve_sidebar.apply(this, arguments) : null;
            return res || BUSINESS_SIDEBAR;
        };

        const orig_choose_app_name = Sidebar.prototype.choose_app_name;
        Sidebar.prototype.choose_app_name = function() {
            if (orig_choose_app_name) orig_choose_app_name.apply(this, arguments);
            const title_lower = (this.sidebar_title || "").toLowerCase();
            if (title_lower === "home" || title_lower === "my business" || ALL_WS_KEYS.includes(title_lower)) {
                this.header_subtitle = "业务扩展";
                if (this.sidebar_header && this.sidebar_header.find) {
                    this.sidebar_header.find(".sidebar-header-subtitle").text("业务扩展");
                }
            }
        };

        Sidebar._ashan_resolved_patched = true;
        return true;
    }

    // 3. 深度重写 Frappe 原生 TypeSectionBreak 原型方法
    function patch_native_section_break() {
        if (!window.frappe || !frappe.ui || !frappe.ui.sidebar_item || !frappe.ui.sidebar_item.TypeSectionBreak) {
            return false;
        }

        const TypeSectionBreak = frappe.ui.sidebar_item.TypeSectionBreak;
        if (TypeSectionBreak._ashan_strict_patched) return true;

        // 丝滑动画切换 toggle()
        // Frappe 内部的 open()/close() 会在 SPA 路由切换与侧栏尺寸变化时调用
        // toggle()，这类同步不应播放动画；一级文字和箭头的用户点击会显式传入
        // true，仍保留 180ms 的展开/收起反馈。
        TypeSectionBreak.prototype.toggle = function(animate = false) {
            const $nested = $(this.$nested_items);
            if (!$nested.length) return;

            $nested.removeClass("hidden");

            if (this.collapsed) {
                if (this.$drop_icon) {
                    this.$drop_icon.attr("data-state", "closed").find("use").attr("href", "#icon-chevron-right");
                }
                $(this.wrapper).attr("data-state", "closed");
                if (animate) {
                    $nested.stop(true, true).slideUp(180);
                } else {
                    $nested.hide();
                }
            } else {
                if (this.$drop_icon) {
                    this.$drop_icon.attr("data-state", "opened").find("use").attr("href", "#icon-chevron-down");
                }
                $(this.wrapper).attr("data-state", "opened");
                if (animate) {
                    $nested.stop(true, true).slideDown(180);
                } else {
                    $nested.show();
                }
            }
        };

        // 状态持久化
        TypeSectionBreak.prototype.save_section_break_state = function() {
            try {
                let state = JSON.parse(localStorage.getItem("section-breaks-state") || "{}");
                const title = (this.wrapper.attr("item-name") || this.wrapper.attr("title") || "").trim();
                if (title) {
                    ALL_WS_KEYS.forEach(k => {
                        if (!state[k]) state[k] = {};
                        state[k][title] = this.collapsed;
                    });
                    this.section_breaks_state = state;
                    localStorage.setItem("section-breaks-state", JSON.stringify(state));
                }
            } catch(e) {}
        };

        // 严格层级解耦：只给一级标题的元素绑定事件，绝对不污染二级子菜单
        TypeSectionBreak.prototype.setup_event_listner = function() {
            const me = this;
            const $l1_standard_item = this.wrapper.children(".standard-sidebar-item");
            if (!$l1_standard_item.length) return;

            $l1_standard_item.off("click");

            // [1] 一级右侧小箭头按钮 -> 仅执行手风琴折叠/展开
            $l1_standard_item.find(".sidebar-item-control, .drop-icon").off("click").on("click", function(e) {
                e.preventDefault();
                e.stopPropagation();
                if (e.stopImmediatePropagation) e.stopImmediatePropagation();
                me.collapsed = !me.collapsed;
                me.toggle(true);
                me.save_section_break_state();
            });

            // [2] 一级左侧文字与图标 -> 仅在一级标题点击时触发折叠/展开 + 联动看板
            $l1_standard_item.find(".sidebar-item-label, .sidebar-item-icon, .item-anchor").off("click").on("click", function(e) {
                if ($(e.target).closest(".sidebar-item-control, .drop-icon").length) return;

                e.preventDefault();
                e.stopPropagation();

                // 丝滑展开/折叠切换当前一级菜单
                me.collapsed = !me.collapsed;
                me.toggle(true);
                me.save_section_break_state();

                // 联动跳转至对应分类 Dashboard
                const title = (me.wrapper.attr("item-name") || me.wrapper.attr("title") || "").trim();
                const targetWs = SECTION_WORKSPACE_MAP[title];
                if (targetWs) {
                    try {
                        const currentRouteArr = (frappe.get_route && frappe.get_route()) || [];
                        const currentRoute = Array.isArray(currentRouteArr) ? currentRouteArr.join('/') : '';
                        if (!currentRoute.includes(targetWs)) {
                            frappe.set_route("desk", targetWs);
                        }
                    } catch(err) {}
                }
            });
        };

        TypeSectionBreak._ashan_strict_patched = true;
        return true;
    }

    // 4. 注入样式
    function inject_styles() {
        if ($("#ashan-strict-style").length) return;
        const styleHtml = `
        <style id="ashan-strict-style">
            .body-sidebar .section-item > .standard-sidebar-item .item-anchor {
                cursor: pointer !important;
                display: flex !important;
                align-items: center !important;
                justify-content: space-between !important;
                border-radius: var(--border-radius, 6px);
                transition: background-color 0.15s ease;
                padding: 4px 8px !important;
                user-select: none;
            }
            .body-sidebar .section-item > .standard-sidebar-item .item-anchor:hover {
                background-color: rgba(0, 0, 0, 0.05);
            }
            .body-sidebar .section-item > .standard-sidebar-item .sidebar-item-label {
                font-weight: 700 !important;
                font-size: 13.5px !important;
                color: var(--text-color, #1f272e) !important;
                flex: 1 !important;
                cursor: pointer !important;
                transition: color 0.15s ease;
            }
            .body-sidebar .section-item > .standard-sidebar-item .sidebar-item-label:hover {
                color: var(--primary-color, #2f54eb) !important;
            }
            .body-sidebar .section-item > .standard-sidebar-item .sidebar-item-control {
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                margin-left: auto !important;
                z-index: 10;
            }
            .body-sidebar .section-item > .standard-sidebar-item .sidebar-item-control .drop-icon {
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                width: 28px !important;
                height: 28px !important;
                border-radius: 4px !important;
                cursor: pointer !important;
                transition: background-color 0.15s ease, transform 0.15s ease;
                pointer-events: auto !important;
            }
            .body-sidebar .section-item > .standard-sidebar-item .sidebar-item-control .drop-icon:hover {
                background-color: rgba(0, 0, 0, 0.12) !important;
            }
            .body-sidebar .sidebar-child-item .sidebar-item-icon {
                display: none !important;
            }
            .body-sidebar .sidebar-child-item .standard-sidebar-item .item-anchor {
                padding-left: 24px !important;
                font-size: 13px !important;
                font-weight: 400 !important;
                color: #64748b !important;
                cursor: pointer !important;
            }
            .body-sidebar .sidebar-child-item .standard-sidebar-item .sidebar-item-label {
                color: #64748b;
                transition: color 0.15s ease, font-weight 0.15s ease;
            }
            /* 工作台置顶加粗高亮 (* 标记项) */
            .body-sidebar .sidebar-child-item .standard-sidebar-item.workbench-highlight-item .item-anchor,
            .body-sidebar .sidebar-child-item .standard-sidebar-item .item-anchor:has(.sidebar-item-label:contains('*')) {
                font-weight: 700 !important;
                color: #0f172a !important;
            }
            .body-sidebar .sidebar-child-item .standard-sidebar-item.workbench-highlight-item .sidebar-item-label,
            .body-sidebar .sidebar-child-item .standard-sidebar-item .sidebar-item-label:contains('*') {
                font-weight: 700 !important;
                color: #0f172a !important;
            }
        </style>
        `;
        $("head").append(styleHtml);
    }

    function highlight_workbench_items() {
        $(".body-sidebar .sidebar-child-item .sidebar-item-label").each(function() {
            const text = $(this).text().trim();
            if (text.includes("*") || text.includes("工作台") || text.includes("资料库") || text.includes("台账明细台")) {
                $(this).closest(".standard-sidebar-item").addClass("workbench-highlight-item");
                $(this).css({
                    "font-weight": "700",
                    "color": "#0f172a"
                });
                $(this).closest(".standard-sidebar-item").find(".item-anchor").css({
                    "font-weight": "700",
                    "color": "#0f172a"
                });
            }
        });
    }

    // 5. 初始化挂载
    function init() {
        inject_styles();
        patch_sidebar_resolver();
        patch_native_section_break();
        schedule_system_management_visibility();
        handle_route_guard();
        highlight_workbench_items();

        $(document).on("sidebar_setup app_ready route-change page-change", function() {
            inject_styles();
            patch_sidebar_resolver();
            patch_native_section_break();
            schedule_system_management_visibility();
            handle_route_guard();
            highlight_workbench_items();
        });
    }

    init();
    $(document).ready(init);
    $(document).on("app_ready", function() {
        init();
        setTimeout(() => {
            handle_route_guard();
            highlight_workbench_items();
        }, 50);
    });
})();
