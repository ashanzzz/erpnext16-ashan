// Copyright (c) 2026, Ashan CN Procurement and contributors
// AshanUI Kit - 全局企业级标准交互与样式模块库

(function () {
    "use strict";

    if (window.AshanUI) return;

    window.AshanUI = {
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
        }
    };
})();
