// Copyright (c) 2026, Ashan CN Procurement and contributors
// AshanUI Kit - 全局企业级标准交互与样式模块库

(function () {
    "use strict";

    // 启动首帧自动读取并注入用户自定义排版尺寸 (Dynamic Typography Boot Engine)
    (function () {
        try {
            var raw = localStorage.getItem("ashan_custom_typography_settings");
            if (raw) {
                var parsed = JSON.parse(raw);
                var tokens = parsed.tokens || parsed;
                var root = document.documentElement;
                if (root && tokens) {
                    for (var k in tokens) {
                        if (tokens.hasOwnProperty(k)) {
                            root.style.setProperty("--ashan-" + k, tokens[k]);
                        }
                    }
                    if (parsed.font_family) {
                        root.style.setProperty("--ashan-font-family-ui", parsed.font_family);
                    }
                }
            }
        } catch (e) {}
    })();


    if (window.AshanUI) {
        if (typeof window.AshanUI.applyTypographyProfile !== "function") {
            window.AshanUI.applyTypographyProfile = function (profile) {
                var valid = ["stock-ledger", "comfortable"];
                var target = valid.indexOf(profile) !== -1 ? profile : "stock-ledger";
                if (typeof document !== "undefined" && document.documentElement) {
                    document.documentElement.dataset.ashanTypographyProfile = target;
                }
                return target;
            };
            window.AshanUI.getTypographyProfile = function () {
                if (typeof document !== "undefined" && document.documentElement && document.documentElement.dataset) {
                    var current = document.documentElement.dataset.ashanTypographyProfile;
                    if (current === "stock-ledger" || current === "comfortable") {
                        return current;
                    }
                }
                return "stock-ledger";
            };
        }
        var existingBootProfile = window.frappe && window.frappe.boot
            ? window.frappe.boot.ashan_typography_profile
            : "stock-ledger";
        window.AshanUI.applyTypographyProfile(existingBootProfile || "stock-ledger");
        return;
    }

    window.AshanUI = Object.assign(window.AshanUI || {}, {
        version: "1.0.0",

        /**
         * 1. 统一标准金额格式化
         * @param {number|string} amount 金额数值
         * @param {boolean} withSymbol 是否带人民币符号 ¥ (默认 true)
         * @param {string} suffix 后缀单位 (例如 "元" 或 "")
         * @returns {string} 格式化后的金额字符串
         */
        formatMoney: function (amount, withSymbol = true, suffix = "") {
            const val = parseFloat(amount);
            if (isNaN(val)) return withSymbol ? "¥ 0.00" : "0.00";
            const formatted = val.toLocaleString("zh-CN", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            });
            const prefix = withSymbol ? "¥ " : "";
            const sfx = suffix ? (suffix.startsWith(" ") ? suffix : ` ${suffix}`) : "";
            return `${prefix}${formatted}${sfx}`;
        },

        /**
         * 2. 稳态防抖自动保存指示胶囊 (彻底消除文字抖动与布局位移)
         * @param {jQuery|HTMLElement|string} container 容器元素
         * @param {Object} options 配置项
         * @returns {Object} 控制器对象 { setSaving, setSaved, setDraft, setLocked, setError }
         */
        createSaveIndicator: function (container, options = {}) {
            const $el = $(container);
            $el.empty();

            const defaultText = options.initialText || "草稿就绪";
            const $capsule = $(`
                <div class="ashan-save-indicator state-draft" title="自动保存状态">
                    <span class="indicator-dot"></span>
                    <span class="indicator-text">${defaultText}</span>
                    <span class="indicator-time"></span>
                </div>
            `);
            $el.append($capsule);

            const $text = $capsule.find(".indicator-text");
            const $time = $capsule.find(".indicator-time");

            return {
                setSaving: function (msg = "正在保存...") {
                    $capsule.attr("class", "ashan-save-indicator state-saving");
                    $text.text(msg);
                    $time.text("");
                },
                setSaved: function (timeStr) {
                    $capsule.attr("class", "ashan-save-indicator state-saved");
                    $text.text("已自动保存");
                    if (!timeStr) {
                        const now = new Date();
                        timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
                    }
                    $time.text(timeStr);
                },
                setDraft: function (msg = "草稿录入中") {
                    $capsule.attr("class", "ashan-save-indicator state-draft");
                    $text.text(msg);
                    $time.text("");
                },
                setLocked: function (msg = "已核定锁定") {
                    $capsule.attr("class", "ashan-save-indicator state-locked");
                    $text.text(msg);
                    $time.text("");
                },
                setError: function (msg = "保存异常") {
                    $capsule.attr("class", "ashan-save-indicator state-error");
                    $text.text(msg);
                    $time.text("");
                },
            };
        },

        /**
         * 3. 统一标准年月/账期选择器组件 (Year-Month Navigator)
         * @param {jQuery|HTMLElement|string} container 容器元素
         * @param {Object} options 配置项 { currentYear, currentMonth, minYear, maxYear, onChange }
         * @returns {Object} 控制器对象
         */
        renderPeriodSelector: function (container, options = {}) {
            const $el = $(container);
            $el.empty();

            const now = new Date();
            let year = parseInt(options.currentYear || now.getFullYear(), 10);
            let month = parseInt(options.currentMonth || now.getMonth() + 1, 10);
            const minYear = options.minYear || 2024;
            const maxYear = options.maxYear || 2030;

            let yearOptions = "";
            for (let y = minYear; y <= maxYear; y++) {
                yearOptions += `<option value="${y}" ${y === year ? "selected" : ""}>${y}年</option>`;
            }

            let monthOptions = "";
            for (let m = 1; m <= 12; m++) {
                monthOptions += `<option value="${m}" ${m === month ? "selected" : ""}>${String(m).padStart(2, "0")}月</option>`;
            }

            const $picker = $(`
                <div class="ashan-period-navigator">
                    <button class="ashan-nav-btn btn-prev" title="上一月 (快捷键: Alt+←)">‹</button>
                    <div class="ashan-period-select-wrap">
                        <select class="ashan-period-select sel-year">${yearOptions}</select>
                        <select class="ashan-period-select sel-month">${monthOptions}</select>
                    </div>
                    <button class="ashan-nav-btn btn-next" title="下一月 (快捷键: Alt+→)">›</button>
                    <button class="ashan-nav-today-btn btn-today" title="回到当月">本月</button>
                </div>
            `);
            $el.append($picker);

            function emitChange() {
                if (typeof options.onChange === "function") {
                    options.onChange(year, month);
                }
            }

            $picker.find(".btn-prev").on("click", function () {
                month -= 1;
                if (month < 1) {
                    month = 12;
                    year -= 1;
                }
                $picker.find(".sel-year").val(year);
                $picker.find(".sel-month").val(month);
                emitChange();
            });

            $picker.find(".btn-next").on("click", function () {
                month += 1;
                if (month > 12) {
                    month = 1;
                    year += 1;
                }
                $picker.find(".sel-year").val(year);
                $picker.find(".sel-month").val(month);
                emitChange();
            });

            $picker.find(".btn-today").on("click", function () {
                const cur = new Date();
                year = cur.getFullYear();
                month = cur.getMonth() + 1;
                $picker.find(".sel-year").val(year);
                $picker.find(".sel-month").val(month);
                emitChange();
            });

            $picker.find(".sel-year, .sel-month").on("change", function () {
                year = parseInt($picker.find(".sel-year").val(), 10);
                month = parseInt($picker.find(".sel-month").val(), 10);
                emitChange();
            });

            return {
                getYear: () => year,
                getMonth: () => month,
                getYearMonthString: () => `${year}-${String(month).padStart(2, "0")}`,
                setPeriod: function (newYear, newMonth, triggerChange = false) {
                    year = parseInt(newYear, 10);
                    month = parseInt(newMonth, 10);
                    $picker.find(".sel-year").val(year);
                    $picker.find(".sel-month").val(month);
                    if (triggerChange) emitChange();
                },
            };
        },

        /**
         * 4. 统一公司/实体切换胶囊栏
         * @param {jQuery|HTMLElement|string} container 容器元素
         * @param {Object} options 配置项 { tabs: [{ id, label, badge, color }], activeTab, onChange }
         */
        renderEntityTabs: function (container, options = {}) {
            const $el = $(container);
            $el.empty();

            const tabs = options.tabs || [];
            let activeTab = options.activeTab || (tabs[0] ? tabs[0].id : "");

            const $tabsWrap = $('<div class="ashan-entity-tabs"></div>');
            tabs.forEach((tab) => {
                const isActive = tab.id === activeTab;
                const badgeHtml = tab.badge ? `<span class="tab-badge">${tab.badge}</span>` : "";
                const $btn = $(`
                    <button class="ashan-entity-tab-btn ${isActive ? "active" : ""}" data-id="${tab.id}">
                        <span class="tab-label">${tab.label}</span>
                        ${badgeHtml}
                    </button>
                `);
                $tabsWrap.append($btn);
            });

            $el.append($tabsWrap);

            $tabsWrap.on("click", ".ashan-entity-tab-btn", function () {
                const id = $(this).data("id");
                $tabsWrap.find(".ashan-entity-tab-btn").removeClass("active");
                $(this).addClass("active");
                activeTab = id;
                if (typeof options.onChange === "function") {
                    options.onChange(id);
                }
            });

            return {
                getActiveTab: () => activeTab,
                setActiveTab: function (id, triggerChange = false) {
                    activeTab = id;
                    $tabsWrap.find(".ashan-entity-tab-btn").removeClass("active");
                    $tabsWrap.find(`.ashan-entity-tab-btn[data-id="${id}"]`).addClass("active");
                    if (triggerChange && typeof options.onChange === "function") {
                        options.onChange(id);
                    }
                },
            };
        },

        /**
         * 5. 统一页面级快捷键绑定支持 (Ctrl+S / Cmd+S 保存, Esc 关闭等)
         * @param {Object} handlers { onSave, onEsc, onPrevMonth, onNextMonth }
         */
        bindGlobalHotkeys: function (handlers = {}) {
            $(document).off("keydown.ashanHotkeys").on("keydown.ashanHotkeys", function (e) {
                // Ctrl+S / Cmd+S 保存草稿
                if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
                    e.preventDefault();
                    if (typeof handlers.onSave === "function") {
                        handlers.onSave();
                    }
                }
                // ESC 取消
                if (e.key === "Escape") {
                    if (typeof handlers.onEsc === "function") {
                        handlers.onEsc();
                    }
                }
            });
        },

        /**
         * 6. 统一大宽表表头/顶部滚动条鼠标滚轮转横向滚动能力 (Mousewheel-to-Horizontal Scroll)
         * 当用户在表头 (thead) 或顶部辅助滚动条上下拨动鼠标滚轮时，若容器存在横向溢出，自动转换为横向滚动；内容行/明细行保持默认垂直上下移动。
         * @param {jQuery|HTMLElement|string} container 滚动容器元素
         * @param {jQuery|HTMLElement|string} triggerEl 触发元素（如 thead 或顶部滚动条，默认查找 container 内 thead）
         */
        enableMousewheelHorizontalScroll: function (container, triggerEl) {
            const $container = $(container);
            const $trigger = triggerEl ? $(triggerEl) : $container.find("thead");

            $trigger.on("wheel", function (e) {
                const raw = e.originalEvent || e;
                const dy = raw.deltaY;
                const dx = raw.deltaX;
                if (Math.abs(dy) > Math.abs(dx) && dy !== 0) {
                    const el = $container[0];
                    if (el && el.scrollWidth > el.clientWidth) {
                        el.scrollLeft += dy;
                        e.preventDefault();
                    }
                }
            });
        },

        /**
         * 7. 统一单据状态中文语义化徽章 (Standard Chinese Document Status Badges - 纯净严肃规范)
         * @param {string} doctype 单据类型 (e.g. "Purchase Order", "Material Request")
         * @param {string} status 原始状态字符串
         * @param {number} docstatus 文档状态代码 (0: Draft, 1: Submitted, 2: Cancelled)
         * @param {Object} r 原始行或文档对象
         * @returns {string} HTML 胶囊标签
         */
        formatDocStatus: function (doctype, status, docstatus, r) {
            status = (status || "").trim();
            if (docstatus === 0 || status === "Draft" || status === "草稿") {
                return `<span class="ashan-status-badge ashan-status-amber">待提交草稿</span>`;
            }
            if (docstatus === 2 || status === "Cancelled" || status === "已作废") {
                return `<span class="ashan-status-badge ashan-status-gray">已作废</span>`;
            }

            const STATUS_MAP = {
                // 采购订单与入库单状态 (Purchase Order / Receipt)
                "To Receive and Bill": { label: "待收货待开票", cls: "ashan-status-blue" },
                "To Receive": { label: "待收货入库", cls: "ashan-status-blue" },
                "To Bill": { label: "待开票结算", cls: "ashan-status-purple" },
                "Completed": { label: "已完成", cls: "ashan-status-green" },
                "Submitted": { label: "已生效", cls: "ashan-status-green" },
                "Closed": { label: "已关闭", cls: "ashan-status-gray" },
                "Stopped": { label: "已停止", cls: "ashan-status-red" },
                "On Hold": { label: "挂起中", cls: "ashan-status-amber" },
                "Delivered": { label: "已交付", cls: "ashan-status-green" },

                // 工作流状态 (Workflow Statuses)
                "Pending": { label: "待处理", cls: "ashan-status-amber" },
                "Ordered": { label: "已订购", cls: "ashan-status-green" },
                "Issued": { label: "已发料", cls: "ashan-status-green" },
                "Transferred": { label: "已调拨", cls: "ashan-status-blue" },
                "Approved": { label: "已核准", cls: "ashan-status-green" },
                "Rejected": { label: "已驳回", cls: "ashan-status-red" },

                // 支付/结算/开票状态 (Payment / Settlement Statuses)
                "Paid": { label: "已付款", cls: "ashan-status-green" },
                "Unpaid": { label: "待付款", cls: "ashan-status-red" },
                "未付款": { label: "待付款", cls: "ashan-status-red" },
                "已付款": { label: "已付款", cls: "ashan-status-green" },
                "已结清": { label: "已结清", cls: "ashan-status-green" },
                "Partly Paid": { label: "部分付款", cls: "ashan-status-amber" },
                "部分付款": { label: "部分付款", cls: "ashan-status-amber" },
                "Overdue": { label: "已逾期", cls: "ashan-status-red" },
                "Partly Billed": { label: "部分开票", cls: "ashan-status-purple" },
                "Partly Received": { label: "部分收货", cls: "ashan-status-blue" },
            };

            const conf = STATUS_MAP[status];
            if (conf) {
                return `<span class="ashan-status-badge ${conf.cls}">${conf.label}</span>`;
            }

            return `<span class="ashan-status-badge ashan-status-blue">${window.frappe && frappe.utils ? frappe.utils.escape_html(status || "已生效") : (status || "已生效")}</span>`;
        },

        /**
         * 8. 统一标准防误触业务弹窗工厂 (Static Backdrop Dialog Factory)
         * 默认注入 static: true, backdrop: "static", 确保点击遮罩不丢失未提交工作
         * @param {Object} opts frappe.ui.Dialog 配置选项
         * @returns {frappe.ui.Dialog}
         */
        createDialog: function (opts = {}) {
            opts.static = opts.static !== undefined ? opts.static : true;
            if (window.frappe && frappe.ui && frappe.ui.Dialog) {
                const dialog = new frappe.ui.Dialog(opts);
                // 确保底层 modal 也是 static
                if (dialog.$wrapper) {
                    dialog.$wrapper.attr("data-backdrop", "static");
                    dialog.$wrapper.attr("data-keyboard", "false");
                }
                return dialog;
            }
            return null;
        },

        /**
         * 9. 全局排版配置模式切换 (Global Typography Profile)
         * @param {string} profile "stock-ledger" | "comfortable"
         * @returns {string} 实际应用的 profile
         */
        applyTypographyProfile: function (profile) {
            var valid = ["stock-ledger", "comfortable"];
            var target = valid.indexOf(profile) !== -1 ? profile : "stock-ledger";
            if (typeof document !== "undefined" && document.documentElement) {
                document.documentElement.dataset.ashanTypographyProfile = target;
            }
            return target;
        },

        /**
         * 10. 读取当前全局排版配置模式
         * @returns {string} "stock-ledger" | "comfortable"
         */
        getTypographyProfile: function () {
            if (typeof document !== "undefined" && document.documentElement && document.documentElement.dataset) {
                var current = document.documentElement.dataset.ashanTypographyProfile;
                if (current === "stock-ledger" || current === "comfortable") {
                    return current;
                }
            }
            return "stock-ledger";
        },

        /**
         * 11. 全系统表格多列智能排序引擎 (Universal Client-Side Table Sorter)
         * 支持点击任意表头列快速排序 (升序 / 降序 / 恢复默认)
         * 智能识别：金额/货币、工时/天数/百分比/年龄数值、日期/账期时序、中文字符串拼音自然排序
         * @param {jQuery|HTMLElement|string} thEl 表头单元格元素
         */
        
        /**
         * 11. 动态应用自定义排版尺度与字型 (Dynamic Typography Engine)
         * @param {Object} tokens CSS变量键值对
         * @param {string} fontFamily 字体字族
         */
        applyTypographyCustom: function (tokens, fontFamily) {
            var root = document.documentElement;
            if (!root) return;
            if (tokens && typeof tokens === "object") {
                for (var k in tokens) {
                    if (tokens.hasOwnProperty(k)) {
                        root.style.setProperty("--ashan-" + k, tokens[k]);
                    }
                }
            }
            if (fontFamily) {
                root.style.setProperty("--ashan-font-family-ui", fontFamily);
            }
            try {
                localStorage.setItem("ashan_custom_typography_settings", JSON.stringify({
                    tokens: tokens,
                    font_family: fontFamily,
                    updated_at: new Date().toISOString()
                }));
            } catch (e) {}
        },

        /**
         * 12. 呼出全局排版与表格尺度调度设置弹窗
         */
        openTypographySettingsDialog: function () {
            const self = this;
            const isAdmin = Boolean(
                (window.AshanWorkContext && typeof window.AshanWorkContext.canSetTypography === "function" && window.AshanWorkContext.canSetTypography())
                || (window.frappe?.session?.user === "Administrator")
                || (window.frappe?.boot && Boolean(window.frappe.boot.ashan_is_system_manager))
            );
            if (!isAdmin) {
                frappe.msgprint(__("只有系统管理员才有权限修改全局排版设置。"));
                return;
            }

            const currentFontSize = (window.frappe?.boot?.ashan_work_context?.font_size)
                || parseInt(document.documentElement.style.getPropertyValue("--ashan-table-cell-font-size"))
                || 13;
            const currentRowHeight = (window.frappe?.boot?.ashan_work_context?.row_height)
                || parseInt(document.documentElement.style.getPropertyValue("--ashan-table-row-height"))
                || 38;
            const currentModalFontSize = (window.frappe?.boot?.ashan_work_context?.modal_font_size)
                || parseInt(document.documentElement.style.getPropertyValue("--ashan-modal-font-size"))
                || currentFontSize;
            const currentModalRowHeight = (window.frappe?.boot?.ashan_work_context?.modal_row_height)
                || parseInt(document.documentElement.style.getPropertyValue("--ashan-modal-row-height"))
                || currentRowHeight;
            const currentButtonFontSize = (window.frappe?.boot?.ashan_work_context?.button_font_size)
                || parseInt(document.documentElement.style.getPropertyValue("--ashan-button-font-size"))
                || currentFontSize;
            const currentButtonHeight = (window.frappe?.boot?.ashan_work_context?.button_height)
                || parseInt(document.documentElement.style.getPropertyValue("--ashan-button-height"))
                || Math.max(26, currentRowHeight - 6);

            const currentSidebarHeaderFont = (window.frappe?.boot?.ashan_work_context?.sidebar_header_font_size)
                || parseInt(document.documentElement.style.getPropertyValue("--ashan-sidebar-header-font-size"))
                || 14;
            const currentSidebarToolsFont = (window.frappe?.boot?.ashan_work_context?.sidebar_tools_font_size)
                || parseInt(document.documentElement.style.getPropertyValue("--ashan-sidebar-tools-font-size"))
                || 13;
            const currentSidebarL1Font = (window.frappe?.boot?.ashan_work_context?.sidebar_l1_font_size)
                || parseInt(document.documentElement.style.getPropertyValue("--ashan-sidebar-l1-font-size"))
                || 13;
            const currentSidebarL2Font = (window.frappe?.boot?.ashan_work_context?.sidebar_l2_font_size)
                || parseInt(document.documentElement.style.getPropertyValue("--ashan-sidebar-l2-font-size"))
                || 13;
            const currentSidebarItemHeight = (window.frappe?.boot?.ashan_work_context?.sidebar_item_height)
                || parseInt(document.documentElement.style.getPropertyValue("--ashan-sidebar-item-height"))
                || 34;

            const d = new frappe.ui.Dialog({
                title: __("全局排版与尺度调度中心 (菜单各层·工作台·弹窗全自定义)"),
                fields: [
                    {
                        fieldtype: "Section Break",
                        label: __("一、左侧菜单导航设置 (各层级精准拆分)"),
                    },
                    {
                        fieldtype: "Int",
                        fieldname: "sidebar_header_font_size",
                        label: __("菜单顶部标题大小 (px, 如 14、15、16)"),
                        default: currentSidebarHeaderFont,
                        description: __("控制顶部工作区标题（如“我的业务 (总控主页)”、“业务扩展”）"),
                    },
                    {
                        fieldtype: "Int",
                        fieldname: "sidebar_tools_font_size",
                        label: __("搜索与通知字号 (px, 如 12、13、14)"),
                        default: currentSidebarToolsFont,
                        description: __("控制“搜索 Ctrl+K”与“通知中心”字号"),
                    },
                    {
                        fieldtype: "Int",
                        fieldname: "sidebar_l1_font_size",
                        label: __("一级菜单大小 (px, 如 13、14、15、16)"),
                        default: currentSidebarL1Font,
                        description: __("控制“采购与报销”、“仓库与库存”、“祺富人事薪酬”等一级分类标题大小"),
                    },
                    {
                        fieldtype: "Int",
                        fieldname: "sidebar_l2_font_size",
                        label: __("二级菜单大小 (px, 如 13、14、15、16)"),
                        default: currentSidebarL2Font,
                        description: __("控制“物料申请”、“采购执行”、“收货入库”等具体业务子菜单大小"),
                    },
                    {
                        fieldtype: "Int",
                        fieldname: "sidebar_item_height",
                        label: __("菜单条目每项高度 (px, 如 32、34、36、38)"),
                        default: currentSidebarItemHeight,
                        description: __("控制侧边栏各菜单项垂直行高，随字号自适应消除挤压"),
                    },
                    {
                        fieldtype: "Section Break",
                        label: __("二、工作台大宽表设置 (主界面)"),
                    },
                    {
                        fieldtype: "Int",
                        fieldname: "font_size",
                        label: __("工作台字体大小 (px, 如 13、14、15、16、17)"),
                        default: currentFontSize,
                        description: __("控制主页面大宽表正文字号"),
                    },
                    {
                        fieldtype: "Int",
                        fieldname: "row_height",
                        label: __("工作台表格高度 (px, 如 36、38、40、42、45)"),
                        default: currentRowHeight,
                        description: __("控制主页面大宽表每行高度"),
                    },
                    {
                        fieldtype: "Int",
                        fieldname: "button_font_size",
                        label: __("工作台操作按钮大小 (px, 如 12、13、14、15)"),
                        default: currentButtonFontSize,
                        description: __("控制导出Excel、单证预览、保存草稿、完成结算、添加调整、新建单据等所有操作按钮字号"),
                    },
                    {
                        fieldtype: "Int",
                        fieldname: "button_height",
                        label: __("工作台操作按钮高度 (px, 如 28、30、32、34、36)"),
                        default: currentButtonHeight,
                        description: __("控制工作台操作按钮、筛选输入控件及视图切换按钮的统一高度"),
                    },
                    {
                        fieldtype: "Section Break",
                        label: __("三、弹出单据页面设置 (弹窗)"),
                    },
                    {
                        fieldtype: "Int",
                        fieldname: "modal_font_size",
                        label: __("弹窗字体大小 (px, 如 13、14、15、16、17)"),
                        default: currentModalFontSize,
                        description: __("控制采购订单明细、采购入库单等所有弹出单据的字体大小"),
                    },
                    {
                        fieldtype: "Int",
                        fieldname: "modal_row_height",
                        label: __("弹窗表格高度 (px, 如 36、38、40、42、45)"),
                        default: currentModalRowHeight,
                        description: __("控制所有弹出单据明细表格行高及输入框高度"),
                    }
                ],
                primary_action_label: __("保存并全系统生效 (修改所有人页面)"),
                primary_action: () => {
                    const vals = d.get_values();
                    if (!vals) return;
                    const fs = parseInt(vals.font_size) || 13;
                    const rh = parseInt(vals.row_height) || 38;
                    const mfs = parseInt(vals.modal_font_size) || fs;
                    const mrh = parseInt(vals.modal_row_height) || rh;
                    const shfs = parseInt(vals.sidebar_header_font_size) || 14;
                    const stfs = parseInt(vals.sidebar_tools_font_size) || 13;
                    const sl1 = parseInt(vals.sidebar_l1_font_size) || 13;
                    const sl2 = parseInt(vals.sidebar_l2_font_size) || 13;
                    const sih = parseInt(vals.sidebar_item_height) || 34;
                    const hh = rh + 2;
                    const bfs = parseInt(vals.button_font_size) || fs;
                    const bh = parseInt(vals.button_height) || Math.max(26, rh - 6);

                    frappe.call({
                        method: "ashan_cn_procurement.services.work_context_service.save_work_context",
                        type: "POST",
                        args: {
                            font_size: fs,
                            row_height: rh,
                            modal_font_size: mfs,
                            modal_row_height: mrh,
                            sidebar_header_font_size: shfs,
                            sidebar_tools_font_size: stfs,
                            sidebar_l1_font_size: sl1,
                            sidebar_l2_font_size: sl2,
                            sidebar_item_height: sih,
                            button_font_size: bfs,
                            button_height: bh,
                        },
                        freeze: true,
                        freeze_message: __("正在保存全局排版设置并同步给全系统所有用户..."),
                        callback(response) {
                            if (window.frappe?.boot?.ashan_work_context) {
                                window.frappe.boot.ashan_work_context.font_size = fs;
                                window.frappe.boot.ashan_work_context.row_height = rh;
                                window.frappe.boot.ashan_work_context.modal_font_size = mfs;
                                window.frappe.boot.ashan_work_context.modal_row_height = mrh;
                                window.frappe.boot.ashan_work_context.sidebar_header_font_size = shfs;
                                window.frappe.boot.ashan_work_context.sidebar_tools_font_size = stfs;
                                window.frappe.boot.ashan_work_context.sidebar_l1_font_size = sl1;
                                window.frappe.boot.ashan_work_context.sidebar_l2_font_size = sl2;
                                window.frappe.boot.ashan_work_context.sidebar_item_height = sih;
                                window.frappe.boot.ashan_work_context.button_font_size = bfs;
                                window.frappe.boot.ashan_work_context.button_height = bh;
                            }
                            self.applyTypographyCustom({
                                "table-cell-font-size": fs + "px",
                                "table-header-font-size": fs + "px",
                                "table-row-height": rh + "px",
                                "table-header-height": hh + "px",
                                "modal-font-size": mfs + "px",
                                "modal-row-height": mrh + "px",
                                "sidebar-header-font-size": shfs + "px",
                                "sidebar-tools-font-size": stfs + "px",
                                "sidebar-l1-font-size": sl1 + "px",
                                "sidebar-l2-font-size": sl2 + "px",
                                "sidebar-item-height": sih + "px",
                                "button-font-size": bfs + "px",
                                "button-height": bh + "px",
                                "control-font-size": bfs + "px",
                                "control-height": bh + "px",
                            });
                            d.hide();
                            frappe.show_alert({
                                message: __(`全局排版已生效：一级菜单 ${sl1}px、二级菜单 ${sl2}px、顶部 ${shfs}px、工作台 ${fs}px/高度 ${rh}px、按钮 ${bfs}px/高度 ${bh}px、弹窗 ${mfs}px/高度 ${mrh}px，全员页面同步更新。`),
                                indicator: "green",
                            }, 5);
                        }
                    });
                }
            });

            d.set_secondary_action_label(__("恢复官方默认基准"));
            d.set_secondary_action(() => {
                d.set_value("font_size", 13);
                d.set_value("row_height", 38);
                d.set_value("modal_font_size", 13);
                d.set_value("modal_row_height", 38);
                d.set_value("sidebar_header_font_size", 14);
                d.set_value("sidebar_tools_font_size", 13);
                d.set_value("sidebar_l1_font_size", 13);
                d.set_value("sidebar_l2_font_size", 13);
                d.set_value("sidebar_item_height", 34);
                d.set_value("button_font_size", 13);
                d.set_value("button_height", 32);

                document.documentElement.style.setProperty("--ashan-table-cell-font-size", "13px");
                document.documentElement.style.setProperty("--ashan-table-header-font-size", "13px");
                document.documentElement.style.setProperty("--ashan-table-row-height", "38px");
                document.documentElement.style.setProperty("--ashan-table-header-height", "40px");
                document.documentElement.style.setProperty("--ashan-modal-font-size", "13px");
                document.documentElement.style.setProperty("--ashan-modal-row-height", "38px");
                document.documentElement.style.setProperty("--ashan-sidebar-header-font-size", "14px");
                document.documentElement.style.setProperty("--ashan-sidebar-tools-font-size", "13px");
                document.documentElement.style.setProperty("--ashan-sidebar-l1-font-size", "13px");
                document.documentElement.style.setProperty("--ashan-sidebar-l2-font-size", "13px");
                document.documentElement.style.setProperty("--ashan-sidebar-item-height", "34px");
                document.documentElement.style.setProperty("--ashan-button-font-size", "13px");
                document.documentElement.style.setProperty("--ashan-button-height", "32px");
                document.documentElement.style.setProperty("--ashan-control-font-size", "13px");
                document.documentElement.style.setProperty("--ashan-control-height", "32px");
            });

            // 监听各级输入实时变化预览
            d.fields_dict.sidebar_header_font_size.$input.on("input change", function () {
                const num = parseInt($(this).val());
                if (!isNaN(num) && num > 0) {
                    document.documentElement.style.setProperty("--ashan-sidebar-header-font-size", num + "px");
                }
            });

            d.fields_dict.sidebar_tools_font_size.$input.on("input change", function () {
                const num = parseInt($(this).val());
                if (!isNaN(num) && num > 0) {
                    document.documentElement.style.setProperty("--ashan-sidebar-tools-font-size", num + "px");
                }
            });

            d.fields_dict.sidebar_l1_font_size.$input.on("input change", function () {
                const num = parseInt($(this).val());
                if (!isNaN(num) && num > 0) {
                    document.documentElement.style.setProperty("--ashan-sidebar-l1-font-size", num + "px");
                }
            });

            d.fields_dict.sidebar_l2_font_size.$input.on("input change", function () {
                const num = parseInt($(this).val());
                if (!isNaN(num) && num > 0) {
                    document.documentElement.style.setProperty("--ashan-sidebar-l2-font-size", num + "px");
                }
            });

            d.fields_dict.sidebar_item_height.$input.on("input change", function () {
                const num = parseInt($(this).val());
                if (!isNaN(num) && num > 0) {
                    document.documentElement.style.setProperty("--ashan-sidebar-item-height", num + "px");
                }
            });

            d.fields_dict.font_size.$input.on("input change", function () {
                const num = parseInt($(this).val());
                if (!isNaN(num) && num > 0) {
                    document.documentElement.style.setProperty("--ashan-table-cell-font-size", num + "px");
                    document.documentElement.style.setProperty("--ashan-table-header-font-size", num + "px");
                }
            });

            d.fields_dict.row_height.$input.on("input change", function () {
                const num = parseInt($(this).val());
                if (!isNaN(num) && num > 0) {
                    document.documentElement.style.setProperty("--ashan-table-row-height", num + "px");
                    document.documentElement.style.setProperty("--ashan-table-header-height", (num + 2) + "px");
                }
            });

            d.fields_dict.modal_font_size.$input.on("input change", function () {
                const num = parseInt($(this).val());
                if (!isNaN(num) && num > 0) {
                    document.documentElement.style.setProperty("--ashan-modal-font-size", num + "px");
                }
            });

            d.fields_dict.modal_row_height.$input.on("input change", function () {
                const num = parseInt($(this).val());
                if (!isNaN(num) && num > 0) {
                    document.documentElement.style.setProperty("--ashan-modal-row-height", num + "px");
                }
            });

            d.show();
        },

        sortCurrentTable: function ($th) {
            $th = $($th);
            const $table = $th.closest("table");
            if (!$table.length) return;
            const $tbody = $table.children("tbody");
            if (!$tbody.length) return;

            const text = $th.text().trim();
            // 排除复选框列与操作列，以及由工作台专属整人分组排序器接管的合并单元格大宽表
            if ($th.find('input[type="checkbox"]').length || text === "操作" ||
                $table.hasClass("jz-raw-matrix-table") || $table.attr("data-custom-sort") ||
                $th.hasClass("col-w-check") || $th.hasClass("col-w-action") ||
                $th.hasClass("jz-col-check") || $th.hasClass("jz-col-action") ||
                $th.hasClass("qifu-col-action")) {
                return;
            }

            const colIndex = $th.index();
            const currentDir = $th.attr("data-sort-dir") || "none";
            const newDir = currentDir === "asc" ? "desc" : "asc";

            // 清理同级表头状态
            $th.siblings("th").removeAttr("data-sort-dir").removeAttr("aria-sort")
                .removeClass("ashan-sort-asc ashan-sort-desc")
                .find(".ashan-sort-indicator").remove();

            // 设置当前表头状态
            $th.attr("data-sort-dir", newDir)
                .attr("aria-sort", newDir === "asc" ? "ascending" : "descending")
                .removeClass("ashan-sort-asc ashan-sort-desc")
                .addClass(newDir === "asc" ? "ashan-sort-asc" : "ashan-sort-desc");

            let $indicator = $th.find(".ashan-sort-indicator");
            if (!$indicator.length) {
                $indicator = $('<span class="ashan-sort-indicator" aria-hidden="true"></span>');
                $th.append($indicator);
            }
            $indicator.text(newDir === "asc" ? "▲" : "▼");

            const rows = $tbody.children("tr").get();
            if (!rows.length) return;
            // 如果仅有一行且为暂无数据提示，不进行排序
            if (rows.length === 1 && $(rows[0]).find("td[colspan]").length) return;

            const parseVal = function (str) {
                if (!str) return { type: "empty", val: "" };
                const s = String(str).trim();
                // 1. 货币与数值（识别 ¥, $, 逗号, 单位如 天, h, 元, 岁, %）
                if (/^[-+]?[¥$€]?\s*[-+]?[0-9,]+(\.[0-9]+)?(\s*[%元天个件h次岁]|\s*\/.*)?$/i.test(s)) {
                    const clean = s.replace(/[¥$€,元天个件h次岁%]/g, "").trim().split("/")[0].trim();
                    const n = parseFloat(clean);
                    if (!isNaN(n)) return { type: "num", val: n };
                }
                // 2. 日期 / 账期（如 2026-06, 1987-11-30）
                if (/^\d{4}[-/]\d{2}([-/]\d{2})?$/.test(s)) {
                    return { type: "date", val: s };
                }
                // 3. 中英文自然文本
                return { type: "str", val: s };
            };

            rows.sort(function (a, b) {
                const cellA = $(a).children("td").eq(colIndex).text();
                const cellB = $(b).children("td").eq(colIndex).text();
                const va = parseVal(cellA);
                const vb = parseVal(cellB);

                let cmp = 0;
                if (va.type === "num" && vb.type === "num") {
                    cmp = va.val - vb.val;
                } else if (va.type === "date" && vb.type === "date") {
                    cmp = va.val.localeCompare(vb.val);
                } else {
                    cmp = String(va.val).localeCompare(String(vb.val), "zh-CN", { numeric: true, sensitivity: "base" });
                }
                return newDir === "asc" ? cmp : -cmp;
            });

            // 移动已有 DOM 节点，保留所有已绑定的事件与勾选状态
            $tbody.append(rows);
            $table.trigger("ashan-table-sorted", { colIndex: colIndex, direction: newDir });
        }
    });

    function initTypographyProfile() {
        if (!window.AshanUI || typeof window.AshanUI.applyTypographyProfile !== "function") return;
        var bootProfile = (typeof window !== "undefined" && window.frappe && window.frappe.boot && window.frappe.boot.ashan_typography_profile) || "stock-ledger";
        window.AshanUI.applyTypographyProfile(bootProfile);
    }

    initTypographyProfile();

    if (typeof window.frappe !== "undefined" && typeof window.frappe.ready === "function") {
        window.frappe.ready(initTypographyProfile);
    } else if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
        document.addEventListener("DOMContentLoaded", initTypographyProfile);
    }

    // 全局自建单据与工作台表格表头点击排序事件委托
    if (typeof document !== "undefined") {
        $(document).off("click.ashanTableSort").on(
            "click.ashanTableSort",
            ".ashan-domain-workbench table thead th, .qifu-table thead th, .jz-table thead th, .ashan-table thead th, .stock-ledger-table thead th, .picker-modal-detail-table thead th",
            function (e) {
                if ($(e.target).is("input, button, a, select, textarea, label")) return;
                if (window.AshanUI && typeof window.AshanUI.sortCurrentTable === "function") {
                    window.AshanUI.sortCurrentTable(this);
                }
            }
        );

        // 全局表格标题行 (thead) 与顶部辅助滚动条鼠标滚轮转左右横向滚动事件委托
        $(document).off("wheel.ashanHeaderScroll").on(
            "wheel.ashanHeaderScroll",
            "table thead, .qifu-table thead, .jz-table thead, .ashan-table thead, .stock-ledger-table thead, .picker-modal-detail-table thead, .qifu-top-scrollbar-wrapper, .picker-top-scrollbar",
            function (e) {
                if (e.isDefaultPrevented && e.isDefaultPrevented()) return;
                if (e.originalEvent && e.originalEvent.defaultPrevented) return;
                const raw = e.originalEvent || e;
                const dy = raw.deltaY;
                const dx = raw.deltaX;
                if (Math.abs(dy) > Math.abs(dx) && dy !== 0) {
                    let $container = $(this).closest(".ashan-table-wrapper, .si-table-wrapper, .picker-main-table-scroll, .jz-table-box, .qifu-table-box, .ashan-table-box, .stock-ledger-table-box, .table-responsive, [class*='table-box'], [class*='table-container'], [class*='table-wrap']");
                    if (!$container.length && $(this).hasClass("qifu-top-scrollbar-wrapper")) {
                        $container = $(this).closest(".qifu-tab-content").find(".qifu-table-box");
                    }
                    if (!$container.length) {
                        $container = $(this).parent();
                    }
                    const el = $container[0];
                    if (el && el.scrollWidth > el.clientWidth) {
                        el.scrollLeft += dy;
                        e.preventDefault();
                    }
                }
            }
        );
    }
})();

    function applyBootTypography() {
        try {
            var fs = window.frappe?.boot?.ashan_work_context?.font_size;
            var rh = window.frappe?.boot?.ashan_work_context?.row_height;
            var mfs = window.frappe?.boot?.ashan_work_context?.modal_font_size || fs;
            var mrh = window.frappe?.boot?.ashan_work_context?.modal_row_height || rh;
            var shfs = window.frappe?.boot?.ashan_work_context?.sidebar_header_font_size || 14;
            var stfs = window.frappe?.boot?.ashan_work_context?.sidebar_tools_font_size || 13;
            var sl1 = window.frappe?.boot?.ashan_work_context?.sidebar_l1_font_size || 13;
            var sl2 = window.frappe?.boot?.ashan_work_context?.sidebar_l2_font_size || 13;
            var sih = window.frappe?.boot?.ashan_work_context?.sidebar_item_height || 34;
            var bfs = window.frappe?.boot?.ashan_work_context?.button_font_size || fs;
            var bh = window.frappe?.boot?.ashan_work_context?.button_height || (rh ? (rh - 6) : 32);
            var root = document.documentElement;
            if (root) {
                if (fs) {
                    root.style.setProperty("--ashan-table-cell-font-size", fs + "px");
                    root.style.setProperty("--ashan-table-header-font-size", fs + "px");
                }
                if (rh) {
                    root.style.setProperty("--ashan-table-row-height", rh + "px");
                    root.style.setProperty("--ashan-table-header-height", (rh + 2) + "px");
                }
                if (mfs) {
                    root.style.setProperty("--ashan-modal-font-size", mfs + "px");
                }
                if (mrh) {
                    root.style.setProperty("--ashan-modal-row-height", mrh + "px");
                }
                if (shfs) {
                    root.style.setProperty("--ashan-sidebar-header-font-size", shfs + "px");
                }
                if (stfs) {
                    root.style.setProperty("--ashan-sidebar-tools-font-size", stfs + "px");
                }
                if (sl1) {
                    root.style.setProperty("--ashan-sidebar-l1-font-size", sl1 + "px");
                }
                if (sl2) {
                    root.style.setProperty("--ashan-sidebar-l2-font-size", sl2 + "px");
                }
                if (sih) {
                    root.style.setProperty("--ashan-sidebar-item-height", sih + "px");
                }
                if (bfs) {
                    root.style.setProperty("--ashan-button-font-size", bfs + "px");
                    root.style.setProperty("--ashan-control-font-size", bfs + "px");
                    root.style.setProperty("--ashan-font-size-control", bfs + "px");
                }
                if (bh) {
                    root.style.setProperty("--ashan-button-height", bh + "px");
                    root.style.setProperty("--ashan-control-height", bh + "px");
                }
            }
        } catch (e) {}
    }
    if (typeof window !== "undefined") {
        if (window.frappe) applyBootTypography();
        document.addEventListener("ashan-work-context-changed", applyBootTypography);
    }


// =========================================================================
// Ashan Table Layout Engine (表格列布局与自适应引擎)
// =========================================================================
/*
 * Ashan Table Layout Engine
 * User-facing column layout controls for custom ERPNext/Frappe Desk tables.
 * Keeps business rendering untouched and applies a reversible presentation layer.
 */
(function () {
    "use strict";

    const ENGINE_VERSION = "1.0.0";
    const STORAGE_PREFIX = "ashan_table_layout_v1";
    const SUPPORTED_TABLES = [
        { route: "material-request-workbench", selector: "#picker-data-table", label: "物料申请" },
        { route: "procurement-execution-workbench", selector: "#picker-data-table", label: "采购执行" },
        { route: "material-receipt-workbench", selector: "#picker-data-table", label: "收货入库" },
        { route: "contract-workbench", selector: "#contract-data-table", label: "采购合同" },
        { route: "monthly-settlement-picker", selector: "#monthly-data-table", label: "月结补录" },
        { route: "wire-transfer-picker", selector: "#wire-data-table", label: "自办电汇" },
        { route: "reimbursement-picker", selector: "#reim-data-table", label: "报销申请" },
        { route: "qifu-hr-salary-workbench", selector: "#salary-data-table", label: "外部实发工资" },
    ];

    function routeString() {
        try {
            if (window.frappe && frappe.get_route) return (frappe.get_route() || []).join("/");
        } catch (_) {}
        return String(window.location.pathname || "").replace(/^\/desk\/?/, "");
    }

    function currentUser() {
        return (window.frappe && frappe.session && frappe.session.user) || "Guest";
    }

    function escapeHtml(value) {
        if (window.frappe && frappe.utils && frappe.utils.escape_html) {
            return frappe.utils.escape_html(String(value == null ? "" : value));
        }
        const node = document.createElement("div");
        node.textContent = String(value == null ? "" : value);
        return node.innerHTML;
    }

    function normalizeLabel(value) {
        return String(value || "")
            .replace(/\s+/g, " ")
            .replace(/[▲▼↕]/g, "")
            .trim() || "未命名列";
    }

    function slug(value) {
        return normalizeLabel(value)
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, "-")
            .replace(/^-+|-+$/g, "") || "column";
    }

    function headerCells(table) {
        const row = table.tHead && table.tHead.rows && table.tHead.rows[0];
        return row ? Array.from(row.cells) : [];
    }

    function getViewModeLabel(table) {
        const page = table.closest(".picker-page-container, .stock-issue-workbench-page, .contract-workbench-container, .desk-page, .page-container") || document;
        const activeViewBtn = page.querySelector(".picker-view-btn.active, .si-view-switch-btn.active, .ashan-view-btn.active");
        if (activeViewBtn) {
            return activeViewBtn.innerText.trim();
        }
        const thTexts = Array.from(table.querySelectorAll("th")).map((t) => t.innerText.trim());
        if (thTexts.includes("物料名称") || thTexts.includes("物料代码") || thTexts.includes("规格型号") || thTexts.includes("开票数量")) {
            return "明细视图";
        }
        return "单号视图";
    }

    function inferColumns(table) {
        const seen = new Map();
        return headerCells(table).map((th, index) => {
            const raw = th.innerText || th.textContent || "";
            const cls = String(th.className || "");
            const isCheckbox = Boolean(th.querySelector('input[type="checkbox"]')) || /checkbox|col-w-check/.test(cls);
            let label = normalizeLabel(raw);
            if (isCheckbox && (label === "未命名列" || !raw.trim())) {
                label = "选择";
            } else if (label === "未命名列") {
                const titleAttr = th.getAttribute("title") || th.getAttribute("aria-label");
                label = titleAttr ? normalizeLabel(titleAttr) : `列 ${index + 1}`;
            }
            const base = th.dataset.layoutKey || th.dataset.colKey || (isCheckbox ? "checkbox" : slug(label));
            const count = (seen.get(base) || 0) + 1;
            seen.set(base, count);
            const key = count === 1 ? base : `${base}-${count}`;
            const isSequence = label === "#" || label === "序号";
            const isAction = /操作|动作/.test(label) || /picker-col-user|action/.test(cls);
            const isAmount = /金额|总额|税额|价格|单价|含税|未付|已付|合计/.test(label) || /money|rate/.test(cls);
            const isLongText = /明细|备注|规格|名称|供应商|关联/.test(label) || /details|remarks|spec|name|supplier|linked/.test(cls);
            let width = 9;
            if (isCheckbox) width = 4;
            else if (isSequence) width = 4;
            else if (isAction) width = 8;
            else if (isAmount) width = 9;
            else if (isLongText) width = 13;
            return {
                key,
                label,
                index,
                visible: true,
                width,
                lockedVisible: isCheckbox,
            };
        });
    }

    function signature(columns) {
        return columns.map((c) => `${c.key}:${c.label}`).join("|");
    }

    function storageKey(route, tableId, sig) {
        return [STORAGE_PREFIX, currentUser(), route, tableId || "table", slug(sig)].join(":");
    }

    function readLayout(key, defaults) {
        try {
            const parsed = JSON.parse(window.localStorage.getItem(key) || "null");
            if (!parsed || parsed.version !== ENGINE_VERSION || !Array.isArray(parsed.columns)) return null;
            const saved = new Map(parsed.columns.map((c) => [c.key, c]));
            return {
                version: ENGINE_VERSION,
                density: parsed.density === "compact" ? "compact" : "standard",
                wrap: parsed.wrap !== false,
                columns: defaults.map((column) => {
                    const item = saved.get(column.key) || {};
                    return {
                        ...column,
                        visible: column.lockedVisible ? true : item.visible !== false,
                        width: Number.isFinite(Number(item.width)) ? Math.max(2, Math.min(60, Number(item.width))) : column.width,
                    };
                }),
            };
        } catch (_) {
            return null;
        }
    }

    function saveLayout(key, layout) {
        window.localStorage.setItem(key, JSON.stringify({
            version: ENGINE_VERSION,
            density: layout.density,
            wrap: layout.wrap,
            columns: layout.columns.map(({ key, visible, width }) => ({ key, visible, width })),
        }));
    }

    function defaultLayout(columns) {
        const next = columns.map((column) => ({ ...column }));
        const total = next.reduce((sum, column) => sum + Number(column.width || 0), 0);
        if (total > 0 && total < 100) {
            const factor = 100 / total;
            next.forEach((column) => { column.width = Math.round(column.width * factor * 2) / 2; });
            const normalized = next.reduce((sum, column) => sum + Number(column.width || 0), 0);
            if (next.length && normalized !== 100) next[next.length - 1].width += (100 - normalized);
        }
        return {
            version: ENGINE_VERSION,
            density: "standard",
            wrap: true,
            columns: next,
        };
    }

    function visibleTotal(layout) {
        return layout.columns
            .filter((c) => c.visible)
            .reduce((sum, c) => sum + Number(c.width || 0), 0);
    }

    function setCellVisibility(table, index, visible) {
        const rows = [];
        if (table.tHead) rows.push(...Array.from(table.tHead.rows));
        if (table.tBodies) Array.from(table.tBodies).forEach((body) => rows.push(...Array.from(body.rows)));
        if (table.tFoot) rows.push(...Array.from(table.tFoot.rows));
        rows.forEach((row) => {
            const cells = Array.from(row.cells || []);
            // Aggregated footer/empty rows with colspan intentionally remain untouched.
            if (cells.length !== headerCells(table).length) return;
            const cell = cells[index];
            if (!cell) return;
            cell.classList.toggle("ashan-layout-hidden-col", !visible);
            cell.setAttribute("aria-hidden", visible ? "false" : "true");
        });
    }

    function ensureColgroup(table, count) {
        let group = table.querySelector(":scope > colgroup.ashan-layout-colgroup");
        if (!group) {
            group = document.createElement("colgroup");
            group.className = "ashan-layout-colgroup";
            table.insertBefore(group, table.firstChild);
        }
        while (group.children.length < count) group.appendChild(document.createElement("col"));
        while (group.children.length > count) group.lastElementChild.remove();
        return group;
    }

    function applyLayout(instance) {
        const table = instance.table;
        if (!table || !document.documentElement.contains(table)) return;
        const current = inferColumns(table);
        if (!current.length) return;

        // If the view mode changed, use a different layout scope automatically.
        const sig = signature(current);
        if (sig !== instance.signature) {
            instance.signature = sig;
            instance.defaults = current;
            instance.key = storageKey(instance.route, table.id, sig);
            instance.layout = readLayout(instance.key, current) || defaultLayout(current);
        }

        const layout = instance.layout;
        const group = ensureColgroup(table, current.length);
        const byKey = new Map(layout.columns.map((c) => [c.key, c]));
        const total = Math.max(100, visibleTotal(layout));
        table.style.setProperty("--ashan-layout-total", `${total}%`);
        table.classList.add("ashan-layout-managed");
        table.classList.toggle("ashan-layout-density-compact", layout.density === "compact");
        table.classList.toggle("ashan-layout-nowrap", layout.wrap === false);

        current.forEach((currentColumn, index) => {
            const configured = byKey.get(currentColumn.key) || currentColumn;
            const visible = configured.lockedVisible ? true : configured.visible !== false;
            const effective = total > 0 ? (Number(configured.width || currentColumn.width) / total) * 100 : 0;
            const col = group.children[index];
            col.style.width = `${effective}%`;
            col.classList.toggle("ashan-layout-hidden-col", !visible);
            setCellVisibility(table, index, visible);
        });

        instance.refreshBar();
    }

    function findActionBar(table) {
        const card = table.closest(".ashan-table-card, .picker-table-wrapper, .contract-table-wrap") || table.parentElement;
        if (card) {
            let prev = card.previousElementSibling;
            while (prev) {
                if (prev.matches && (prev.matches(".picker-action-bar, .contract-action-bar, .ashan-action-bar"))) {
                    return prev;
                }
                if (prev.querySelector && prev.querySelector(".picker-action-bar, .contract-action-bar")) {
                    return prev.querySelector(".picker-action-bar, .contract-action-bar");
                }
                prev = prev.previousElementSibling;
            }
        }
        const page = table.closest(".picker-page-container, .stock-issue-workbench-page, .contract-workbench-container, .desk-page, .page-container") || document;
        return page.querySelector(".picker-action-bar, .contract-action-bar, .picker-filter-bar");
    }

    function renderDialogHtml(instance) {
        const visible = instance.layout.columns.filter((c) => c.visible);
        const hidden = instance.layout.columns.filter((c) => !c.visible);
        const rows = visible.map((c) => `
            <div class="ashan-layout-column-row" data-key="${escapeHtml(c.key)}">
                <div class="ashan-layout-column-name">
                    <span class="ashan-layout-column-dot" aria-hidden="true"></span>
                    <span title="${escapeHtml(c.label)}">${escapeHtml(c.label)}</span>
                </div>
                <label class="ashan-layout-width-field">
                    <input class="form-control input-xs ashan-layout-width-input" type="number" min="2" max="60" step="0.5" value="${Number(c.width)}" data-key="${escapeHtml(c.key)}" aria-label="${escapeHtml(c.label)}列宽百分比">
                    <span>%</span>
                </label>
                <button type="button" class="btn btn-default btn-xs ashan-layout-remove" data-key="${escapeHtml(c.key)}" ${c.lockedVisible ? "disabled" : ""} aria-label="隐藏${escapeHtml(c.label)}">移除</button>
            </div>
        `).join("");
        const hiddenRows = hidden.map((c) => `
            <button type="button" class="ashan-layout-add-column" data-key="${escapeHtml(c.key)}">
                <span>${escapeHtml(c.label)}</span><span>+ 添加</span>
            </button>
        `).join("") || `<div class="ashan-layout-empty">没有隐藏列</div>`;
        const total = visibleTotal(instance.layout);
        const viewLabel = getViewModeLabel(instance.table);
        return `
            <div class="ashan-layout-editor" data-layout-key="${escapeHtml(instance.key)}">
                <div class="ashan-layout-editor-note">
                    <div>
                        <strong>按百分比设置列宽</strong>
                        <span>当前修改列数据：<strong>${escapeHtml(instance.label)} · ${escapeHtml(viewLabel)}</strong> ｜ 100% 正好铺满可视区，超过 100% 自动横向滚动。</span>
                    </div>
                    <span class="ashan-layout-total ${total < 100 ? "is-warning" : ""}">当前 ${total.toFixed(1).replace(/\.0$/, "")}%</span>
                </div>
                <div class="ashan-layout-options">
                    <label><span>行密度</span><select class="form-control input-sm ashan-layout-density"><option value="standard" ${instance.layout.density !== "compact" ? "selected" : ""}>标准</option><option value="compact" ${instance.layout.density === "compact" ? "selected" : ""}>紧凑</option></select></label>
                    <label class="ashan-layout-checkbox"><input type="checkbox" class="ashan-layout-wrap" ${instance.layout.wrap !== false ? "checked" : ""}><span>长文本自动换行</span></label>
                </div>
                <div class="ashan-layout-editor-grid">
                    <section>
                        <div class="ashan-layout-section-title"><strong>当前显示列</strong><span>${visible.length} 列</span></div>
                        <div class="ashan-layout-visible-list">${rows}</div>
                    </section>
                    <section>
                        <div class="ashan-layout-section-title"><strong>可添加列</strong><span>${hidden.length} 列</span></div>
                        <div class="ashan-layout-hidden-list">${hiddenRows}</div>
                    </section>
                </div>
            </div>
        `;
    }

    function openDialog(instance) {
        if (!window.frappe || !frappe.ui || !frappe.ui.Dialog) return;
        const dialog = new frappe.ui.Dialog({
            title: `${instance.label} · 表格列设置`,
            size: "large",
            fields: [{ fieldtype: "HTML", fieldname: "layout_editor" }],
            primary_action_label: "保存布局",
            primary_action() {
                const root = dialog.$wrapper[0].querySelector(".ashan-layout-editor");
                if (!root) return;
                const widths = new Map();
                root.querySelectorAll(".ashan-layout-width-input").forEach((input) => {
                    widths.set(input.dataset.key, Math.max(2, Math.min(60, Number(input.value) || 2)));
                });
                instance.layout.columns.forEach((column) => {
                    if (widths.has(column.key)) column.width = widths.get(column.key);
                });
                instance.layout.density = root.querySelector(".ashan-layout-density").value === "compact" ? "compact" : "standard";
                instance.layout.wrap = root.querySelector(".ashan-layout-wrap").checked;
                const total = visibleTotal(instance.layout);
                if (total < 100) {
                    frappe.msgprint({
                        title: "列宽合计至少需要 100%",
                        indicator: "orange",
                        message: `当前可见列合计为 ${total.toFixed(1)}%。请增加部分列宽，或重新添加隐藏列。`,
                    });
                    return;
                }
                saveLayout(instance.key, instance.layout);
                applyLayout(instance);
                dialog.hide();
                frappe.show_alert({ message: "表格布局已保存到当前用户浏览器", indicator: "green" });
            },
            secondary_action_label: "恢复默认",
            secondary_action() {
                window.localStorage.removeItem(instance.key);
                instance.layout = defaultLayout(instance.defaults);
                applyLayout(instance);
                dialog.hide();
                frappe.show_alert({ message: "已恢复默认列布局", indicator: "blue" });
            },
        });

        function rerender() {
            dialog.fields_dict.layout_editor.$wrapper.html(renderDialogHtml(instance));
            bindDialogEvents();
        }

        function bindDialogEvents() {
            const root = dialog.$wrapper[0].querySelector(".ashan-layout-editor");
            if (!root) return;
            root.querySelectorAll(".ashan-layout-remove").forEach((button) => {
                button.addEventListener("click", () => {
                    const column = instance.layout.columns.find((c) => c.key === button.dataset.key);
                    if (!column || column.lockedVisible) return;
                    const visibleCount = instance.layout.columns.filter((c) => c.visible).length;
                    if (visibleCount <= 2) {
                        frappe.show_alert({ message: "至少保留 2 列", indicator: "orange" });
                        return;
                    }
                    // capture width edits before rebuilding the editor
                    root.querySelectorAll(".ashan-layout-width-input").forEach((input) => {
                        const item = instance.layout.columns.find((c) => c.key === input.dataset.key);
                        if (item) item.width = Math.max(2, Math.min(60, Number(input.value) || item.width));
                    });
                    column.visible = false;
                    rerender();
                });
            });
            root.querySelectorAll(".ashan-layout-add-column").forEach((button) => {
                button.addEventListener("click", () => {
                    const column = instance.layout.columns.find((c) => c.key === button.dataset.key);
                    if (!column) return;
                    column.visible = true;
                    rerender();
                });
            });
            root.querySelectorAll(".ashan-layout-width-input").forEach((input) => {
                input.addEventListener("input", () => {
                    let total = 0;
                    root.querySelectorAll(".ashan-layout-width-input").forEach((el) => { total += Number(el.value) || 0; });
                    const badge = root.querySelector(".ashan-layout-total");
                    if (badge) {
                        badge.textContent = `当前 ${total.toFixed(1).replace(/\.0$/, "")}%`;
                        badge.classList.toggle("is-warning", total < 100);
                    }
                });
            });
        }

        rerender();
        dialog.show();
    }

    function mount(config, table) {
        if (!table || table.dataset.ashanLayoutEngineMounted === "1") return null;
        const cols = inferColumns(table);
        if (!cols.length) return null;
        const route = config.route;
        const sig = signature(cols);
        const instance = {
            config,
            route,
            label: config.label,
            table,
            defaults: cols,
            signature: sig,
            key: storageKey(route, table.id, sig),
            layout: null,
            bar: null,
            observer: null,
            refreshing: false,
            refreshBar() {
                const card = this.table.closest(".ashan-table-card, .picker-table-wrapper, .contract-table-wrap");
                if (card) {
                    const oldBars = card.querySelectorAll(".ashan-table-layout-bar");
                    oldBars.forEach((b) => b.remove());
                }

                // 彻底删除任何解释性废话胶囊 ("这种解释性的东西删掉，永远不要")
                document.querySelectorAll(".ashan-layout-summary-pill, .ashan-table-layout-summary").forEach((b) => b.remove());

                const actionBar = findActionBar(this.table);
                if (actionBar) {
                    const btnHost = actionBar.querySelector(".picker-btn-group, .contract-btn-group, .contract-ml-auto, .si-btn-group") || actionBar;
                    let triggerBtn = actionBar.querySelector(".ashan-table-layout-trigger");
                    if (!triggerBtn || !document.contains(triggerBtn)) {
                        triggerBtn = document.createElement("button");
                        triggerBtn.type = "button";
                        triggerBtn.className = "picker-btn-secondary ashan-table-layout-trigger";
                        triggerBtn.title = "设置表格列宽与显隐";
                        triggerBtn.innerHTML = `<span class="ashan-table-layout-icon" aria-hidden="true">☷</span> <span>列设置</span>`;
                        triggerBtn.addEventListener("click", () => openDialog(this));
                        btnHost.appendChild(triggerBtn);
                    }
                    this.triggerBtn = triggerBtn;
                    this.bar = actionBar;
                }
            },
        };
        instance.layout = readLayout(instance.key, cols) || defaultLayout(cols);
        // Ensure no bar exists inside the table card
        const card = table.closest(".ashan-table-card, .picker-table-wrapper, .contract-table-wrap");
        if (card) {
            const oldBars = card.querySelectorAll(".ashan-table-layout-bar");
            oldBars.forEach((b) => b.remove());
        }
        table.dataset.ashanLayoutEngineMounted = "1";
        table._ashanTableLayoutInstance = instance;
        instance.observer = new MutationObserver(() => {
            if (instance.refreshing) return;
            instance.refreshing = true;
            window.requestAnimationFrame(() => {
                applyLayout(instance);
                instance.refreshing = false;
            });
        });
        instance.observer.observe(table, { childList: true, subtree: true });
        applyLayout(instance);
        return instance;
    }

    function scan() {
        const route = routeString();
        SUPPORTED_TABLES.forEach((config) => {
            if (!route.includes(config.route)) return;
            document.querySelectorAll(config.selector).forEach((table) => mount(config, table));
        });
    }

    let scanTimer = null;
    function scheduleScan() {
        window.clearTimeout(scanTimer);
        scanTimer = window.setTimeout(scan, 80);
    }

    function start() {
        scheduleScan();
        const root = document.querySelector(".desk-container") || document.body;
        if (root) {
            const observer = new MutationObserver(scheduleScan);
            observer.observe(root, { childList: true, subtree: true });
        }
        if (window.frappe && frappe.router && frappe.router.on) {
            frappe.router.on("change", scheduleScan);
        }
        window.addEventListener("hashchange", scheduleScan);
    }

    window.AshanUI.TableLayoutEngine = {
        version: ENGINE_VERSION,
        scan,
        open(table) {
            const element = typeof table === "string" ? document.querySelector(table) : table;
            if (element && element._ashanTableLayoutInstance) openDialog(element._ashanTableLayoutInstance);
        },
        reset(table) {
            const element = typeof table === "string" ? document.querySelector(table) : table;
            const instance = element && element._ashanTableLayoutInstance;
            if (!instance) return;
            window.localStorage.removeItem(instance.key);
            instance.layout = defaultLayout(instance.defaults);
            applyLayout(instance);
        },
    };

    window.AshanUI.TableColumns = {
        async setColumn(tableOrSelector, colIndex, options) {
            const table = typeof tableOrSelector === "string" ? document.querySelector(tableOrSelector) : tableOrSelector;
            if (!table) return null;
            const opts = options || {};
            const headerRow = table.tHead && table.tHead.rows && table.tHead.rows[0];
            const cell = headerRow && headerRow.cells && headerRow.cells[colIndex];
            if (cell && opts.title !== undefined) {
                cell.textContent = opts.title;
            }
            let colgroup = table.querySelector("colgroup");
            if (!colgroup && headerRow) {
                colgroup = document.createElement("colgroup");
                for (let i = 0; i < headerRow.cells.length; i++) {
                    colgroup.appendChild(document.createElement("col"));
                }
                table.insertBefore(colgroup, table.firstChild);
            }
            if (colgroup && opts.width !== undefined) {
                const cols = colgroup.querySelectorAll("col");
                if (cols[colIndex]) {
                    const w = typeof opts.width === "number" ? `${opts.width}%` : String(opts.width);
                    cols[colIndex].style.width = w;
                    if (cell) cell.style.width = w;
                }
            }
            if (table._ashanTableLayoutInstance) {
                const inst = table._ashanTableLayoutInstance;
                if (inst.layout && inst.layout.columns && inst.layout.columns[colIndex]) {
                    if (opts.title) inst.layout.columns[colIndex].title = opts.title;
                    if (opts.width !== undefined) inst.layout.columns[colIndex].width = parseFloat(opts.width);
                    if (opts.hidden !== undefined) inst.layout.columns[colIndex].visible = !opts.hidden;
                }
                if (typeof inst.applyLayout === "function") {
                    inst.applyLayout();
                }
            }
            return { table, colIndex, options: opts };
        },

        async setColumns(tableOrSelector, columnsMap) {
            if (Array.isArray(columnsMap)) {
                for (let i = 0; i < columnsMap.length; i++) {
                    if (columnsMap[i]) await this.setColumn(tableOrSelector, i, columnsMap[i]);
                }
            } else if (columnsMap && typeof columnsMap === "object") {
                for (const [idx, cfg] of Object.entries(columnsMap)) {
                    await this.setColumn(tableOrSelector, parseInt(idx, 10), cfg);
                }
            }
        },

        getColumn(tableOrSelector, colIndex) {
            const table = typeof tableOrSelector === "string" ? document.querySelector(tableOrSelector) : tableOrSelector;
            if (!table) return null;
            const headerRow = table.tHead && table.tHead.rows && table.tHead.rows[0];
            const cell = headerRow && headerRow.cells && headerRow.cells[colIndex];
            return {
                title: cell ? cell.textContent.trim() : "",
                width: cell ? cell.style.width : "",
            };
        }
    };
    

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
})();

