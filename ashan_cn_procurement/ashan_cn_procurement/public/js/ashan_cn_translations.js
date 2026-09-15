/* ==========================================================================
   ERPNext 16 业务扩展 - 全站日常操作页面高级中文汉化补全与本地化增强
   (Comprehensive Daily Operations Chinese Localization & Translation Engine)
   ========================================================================== */

(function() {
    const CN_TRANSLATIONS = {
        // === 1. 顶部栏、导航、主菜单与系统基础操作 ===
        "Search or type a command (Ctrl + K)": "搜索单据、页面或输入快捷指令 (Ctrl + K)",
        "Search": "搜索",
        "Notification": "通知中心",
        "Notifications": "通知中心",
        "Events": "日程事件",
        "What's New": "最新动态",
        "No New notifications": "暂无新通知",
        "Looks like you haven’t received any notifications.": "您当前没有收到任何新通知。",
        "No Upcoming Events": "暂无近期日程",
        "There are no upcoming events for you.": "您当前没有即将开始的日程事件。",
        "Nothing New": "暂无更新动态",
        "There is nothing new to show you right now.": "当前暂无最新动态。",
        "Home": "首页",
        "User": "用户与账号",
        "Role": "角色与岗位",
        "Permissions": "权限配置",
        "User Permission": "用户数据权限",
        "Permission Manager": "角色权限管理器",
        "Permission Inspector": "权限检查器",
        "Role Permissions Manager": "角色权限管理器",
        "Set User Permissions": "设置用户权限",
        "Audits": "审计与日志",
        "Activity Log": "操作动态日志",
        "Permission Log": "权限变更日志",
        "Access Log": "系统访问日志",
        "Settings": "系统设置",
        "System Settings": "全局系统设置",
        "My Settings": "个人设置",
        "Logout": "退出登录",
        "Log out": "退出登录",
        "Switch to standard": "切换至标准界面",
        "Toggle Full Width": "切换全屏/等宽",
        "Toggle Sidebar": "展开/折叠侧边栏",
        "Toggle Theme": "切换深浅主题",
        "Theme": "系统主题",
        "Dark Theme": "深色模式",
        "Dark Mode": "深色模式",
        "Light Theme": "浅色模式",
        "Light Mode": "浅色模式",
        "Automatic": "跟随系统",
        "Session Defaults": "会话默认值",
        "Reload": "重新加载",
        "Help": "帮助与支持",
        "About": "关于系统",
        "Keyboard Shortcuts": "键盘快捷键",
        "System Health": "系统健康状态",
        "Frappe Support": "技术支持",
        "Documentation": "官方文档",
        "User Forum": "用户社区",
        "Report an Issue": "反馈问题",
        "Desktop": "控制台",
        "Workspaces": "工作区",
        "Website": "网站主页",
        "Display": "界面显示",
        "Session Expired": "会话已过期",
        "Please login again": "请重新登录系统",
        "Logged In": "登录成功",
        "Invalid login credentials": "账号或密码错误",
        "Not permitted": "无访问权限",
        "Not found": "未找到请求的页面",
        "The resource you are looking for is not available": "您访问的资源不存在或已被移动",
        "You do not have enough permissions to access this resource. Please contact your manager to get access.": "您没有足够的权限访问此资源，请联系管理员为您配置权限。",

        // === 2. 常用工作区名称 (Workspaces) ===
        "Accounting": "财务会计",
        "Buying": "采购管理",
        "Stock": "库存与仓库",
        "CRM": "客户关系管理 (CRM)",
        "HR": "人力资源 (HR)",
        "Payroll": "薪资管理 (Payroll)",
        "Quality": "质量管理",
        "Projects": "项目管理",
        "Manufacturing": "生产制造",
        "Selling": "销售管理",
        "Support": "客户服务与支持",
        "Users": "用户与权限",
        "Integrations": "集成与对接",
        "Build": "开发与构建",
        "Retail": "零售管理",
        "Assets": "固定资产",
        "My Business": "我的业务 (总控主页)",
        "Property and Lease": "物业与租赁",
        "Vehicle Fuel Hub": "车辆燃油中心",
        "Company Compliance Center": "企业合规中心",
        "Accounting and Finance": "财务与记账中心",
        "Procurement Management": "采购管理中心",
        "Stock and Inventory": "库存与仓储中心",

        // === 3. 列表视图 (List View)、筛选与排序 ===
        "List View": "列表视图",
        "Report View": "报表视图",
        "Dashboard View": "仪表盘看板",
        "Kanban": "看板视图",
        "Gantt": "甘特图",
        "Calendar": "日历视图",
        "Image View": "卡片图库",
        "Saved Filters": "已存常用筛选",
        "Filter": "筛选",
        "Filters": "筛选条件",
        "Filter By": "筛选条件",
        "Add Filter": "添加筛选条件",
        "Clear Filters": "清空全部筛选",
        "Sort By": "排序规则",
        "Created On": "创建时间",
        "Modified On": "修改时间",
        "Created By": "创建人",
        "Modified By": "修改人",
        "Descending": "降序 (最新优先)",
        "Ascending": "升序 (最早优先)",
        "Load More": "加载更多记录",
        "Refresh": "刷新数据",
        "Select All": "全选当前页",
        "Unselect All": "取消全选",
        "Showing {0} to {1} of {2}": "显示第 {0} 至 {1} 项，共 {2} 项",
        "of": "项，共",
        "No matching records found": "未找到符合条件的单据记录",
        "No Data": "暂无数据",

        // === 4. 表单操作与按钮 (Form Actions & Buttons) ===
        "Actions": "操作 ▾",
        "Action": "操作",
        "Save": "保存单据",
        "Saved": "已保存",
        "Not Saved": "未保存修改",
        "Discard": "放弃修改",
        "Submit": "提交单据",
        "Cancel": "作废单据",
        "Amend": "修改重开",
        "Delete": "删除单据",
        "Permanently Delete": "永久删除",
        "Delete permanently": "永久删除",
        "Duplicate": "复制新建",
        "Print": "打印单据",
        "Email": "发送邮件",
        "Upload": "上传文件",
        "Download": "下载附件",
        "Add row": "添加行",
        "Add Row": "添加行",
        "Add multiple": "批量添加",
        "Insert Above": "在上方插入行",
        "Insert Below": "在下方插入行",
        "Move Up": "上移",
        "Move Down": "下移",
        "Delete Row": "删除行",
        "Confirm": "确认执行",
        "Close": "关闭窗口",
        "Edit": "编辑修改",
        "New": "新建",
        "Create": "创建",
        "Update": "更新",
        "Import": "批量导入",
        "Export": "导出数据",
        "Attach": "选择附件",
        "Attach File": "上传文件",
        "Upload File": "上传文件",
        "Browse": "浏览文件",
        "Drop files here": "拖拽文件至此区域",

        // === 5. 权限与角色术语 ===
        "Read": "查看权限 (Read)",
        "Write": "编辑权限 (Write)",
        "Share": "共享单据 (Share)",
        "User Permissions": "按用户隔离数据权限",
        "If Owner": "仅限创建者本人",

        // === 5.1 单据状态与工作流术语 (Document Statuses) ===
        "Draft": "待提交草稿",
        "Pending": "待处理",
        "Submitted": "已生效",
        "Completed": "已完成",
        "Cancelled": "已作废",
        "Closed": "已关闭",
        "Stopped": "已停止",
        "On Hold": "挂起中",
        "Delivered": "已交付",
        "Ordered": "已订购",
        "Issued": "已发料",
        "Transferred": "已调拨",
        "Approved": "已核准",
        "Rejected": "已驳回",
        "Paid": "已付款",
        "Unpaid": "待付款",
        "Partly Paid": "部分付款",
        "Overdue": "已逾期",
        "Partly Billed": "部分开票",
        "Partly Received": "部分收货",
        "To Receive and Bill": "待收货待开票",
        "To Receive": "待收货入库",
        "To Bill": "待开票结算",

        "Purchase Order": "采购订单",
        "Purchase Receipt": "采购入库单",
        "Purchase Invoice": "采购发票",
        "Supplier": "供应商档案",
        "Supplier Name": "供应商名称",
        "Supplier Group": "供应商分类",
        "Item": "物料主数据",
        "Item Code": "物料编码",
        "Item Name": "物料名称",
        "Item Group": "物料分类",
        "Item Type": "物料类型",
        "Service": "服务类",
        "Sales & Purchase": "销售与采购",
        "Series": "编号系列",
        "Last Updated On": "最后更新时间",
        "Stock Entry": "物料调拨与出入库",
        "Delivery Note": "销售出库单",
        "Stock Ledger": "库存台账明细",
        "Warehouse": "仓库",
        "Default Warehouse": "默认仓库",
        "Quantity": "数量",
        "Qty": "数量",
        "Rate": "含税单价",
        "Amount": "金额 (¥)",
        "Grand Total": "总计金额 (¥)",
        "Net Total": "不含税净额 (¥)",
        "Total Quantity": "总数量",
        "Taxes and Charges": "税费与附加项",
        "Tax Rate": "税率 %",
        "Tax Amount": "税额 (¥)",
        "Reimbursement Request": "报销申请单",
        "Expense Claim": "费用报销单",
        "Payment Entry": "付款凭证",
        "Journal Entry": "日记账凭证",
        "Oil Card": "油卡档案",
        "Oil Card Ledger": "油卡综合台账明细台",
        "Oil Card Refuel Log": "车辆加油明细表",
        "Oil Card Recharge Log": "油卡充值明细表",
        "Oil Card Monthly Closing": "油卡月度能耗汇总",
        "Vehicle Archive": "车辆档案",
        "Oil Card Manager": "油卡管理员",
        "Oil Card Operator": "油卡操作员",
        "Stock Manager": "仓库管理员",
        "Purchase Manager": "采购管理员",
        "Accounts Manager": "财务主管",
        "Fleet Manager": "车队主管",
        "System Manager": "系统管理员",

        // === 6. 表单校验与必填项提示 (Validation & Mandatory Prompts) ===
        "Missing Values Required": "请填写必填项",
        "Following fields have missing values:": "以下必填字段尚未填写：",
        "Following fields have missing values": "以下必填字段尚未填写",
        "Value missing for:": "以下字段未填写：",
        "Value missing for": "以下字段未填写",
        "Mandatory fields required": "请完善以下必填项",
        "Mandatory fields missing": "缺少必填字段",
        "Please specify": "请填写",
        "Please select": "请选择",
        "Supplier is required": "供应商为必填项",
        "Please select a Supplier": "请选择供应商",
        "Schedule Date is required": "期望到货日期为必填项",
        "Please enter a valid rate": "请输入有效单价",
        "Amount cannot be zero": "金额不能为 0",
        "Rate and Amount must be greater than zero": "单价与金额必须大于 0"
    };

    // 1. 注入前端 Frappe 翻译字典
    if (window.frappe) {
        frappe.provide("frappe._messages");
        frappe._messages = frappe._messages || {};
        Object.assign(frappe._messages, CN_TRANSLATIONS);

        if (frappe.boot && frappe.boot.__messages) {
            Object.assign(frappe.boot.__messages, CN_TRANSLATIONS);
        }

        // 2. 增强 frappe.__ 国际化查找逻辑
        const originalTranslate = window.__;
        window.__ = function(txt, replace, context) {
            if (typeof txt === "string") {
                const trimmed = txt.trim();
                if (CN_TRANSLATIONS[trimmed]) {
                    let res = CN_TRANSLATIONS[trimmed];
                    if (replace && Array.isArray(replace)) {
                        replace.forEach((val, idx) => {
                            res = res.replace(new RegExp(`\\{${idx}\\}`, "g"), val);
                        });
                    }
                    return res;
                }
            }
            if (typeof originalTranslate === "function") {
                return originalTranslate(txt, replace, context);
            }
            return txt;
        };

        if (window.frappe.__) {
            window.frappe.__ = window.__;
        }
    }

    // 3. 动态扫描并汉化原生 DOM 节点（如左上角原生下拉菜单、通知中心、弹出层等）
    function translateTextNode(node) {
        if (!node || node.nodeType !== 3) return;
        const text = node.nodeValue.trim();
        if (text && CN_TRANSLATIONS[text]) {
            node.nodeValue = node.nodeValue.replace(text, CN_TRANSLATIONS[text]);
        }
    }

    function localize_dynamic_dom() {
        // A. 汉化左上角菜单与 context-menu 项
        $(".menu-item-title, .dropdown-item, .dropdown-menu-item a, .notifications-list .header, .notifications-list .empty-state").each(function() {
            $(this).contents().each(function() {
                if (this.nodeType === 3) {
                    translateTextNode(this);
                }
            });
        });

        // B. 汉化 List View 状态、按钮和操作文字
        $(".btn:contains('Actions'), button:contains('Actions')").each(function() {
            if ($(this).children().length === 0 || $(this).find("svg, .icon").length > 0) {
                $(this).contents().filter(function() { return this.nodeType === 3 && this.nodeValue.trim() === "Actions"; }).replaceWith("操作 ▾");
            }
        });
        $(".btn:contains('Add Row'), button:contains('Add Row')").each(function() {
            $(this).contents().filter(function() { return this.nodeType === 3 && this.nodeValue.trim() === "Add Row"; }).replaceWith("添加行");
        });
        $(".btn:contains('Add multiple'), button:contains('Add multiple')").each(function() {
            $(this).contents().filter(function() { return this.nodeType === 3 && this.nodeValue.trim() === "Add multiple"; }).replaceWith("批量添加");
        });
    }

    // 4. 使用 MutationObserver 实时监听动态插入的下拉菜单 (0ms 零延迟汉化)
    function setup_mutation_observer() {
        const observer = new MutationObserver(function(mutations) {
            let shouldLocalize = false;
            for (let i = 0; i < mutations.length; i++) {
                const added = mutations[i].addedNodes;
                for (let j = 0; j < added.length; j++) {
                    const node = added[j];
                    if (node.nodeType === 1) {
                        if (
                            node.classList?.contains('context-menu') ||
                            node.classList?.contains('frappe-menu') ||
                            node.classList?.contains('dropdown-menu') ||
                            node.classList?.contains('notifications-list') ||
                            node.querySelector?.('.menu-item-title, .dropdown-item, .dropdown-menu-item')
                        ) {
                            shouldLocalize = true;
                            break;
                        }
                    }
                }
                if (shouldLocalize) break;
            }
            if (shouldLocalize) {
                localize_dynamic_dom();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    $(document).ready(function() {
        localize_dynamic_dom();
        setup_mutation_observer();

        $(document).ajaxComplete(function() {
            setTimeout(localize_dynamic_dom, 100);
        });

        // 监听点击弹出下拉菜单时
        $(document).on('click mouseenter', '.app-switcher-menu, .navbar-brand, .sidebar-header, .app-switcher, [data-toggle="dropdown"], .dropdown-menu-item', function() {
            setTimeout(localize_dynamic_dom, 10);
            setTimeout(localize_dynamic_dom, 50);
        });
    });
})();
