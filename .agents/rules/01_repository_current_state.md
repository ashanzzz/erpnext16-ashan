# 当前仓库事实与迁移边界

## 核心路径
- App 根目录 `ashan_cn_procurement/`
- Python 包根目录 `ashan_cn_procurement/ashan_cn_procurement/`
- Frappe Page/DocType/Report/Workspace 根目录 `ashan_cn_procurement/ashan_cn_procurement/ashan_cn_procurement/`
- 公共前端资源 `ashan_cn_procurement/ashan_cn_procurement/public/`

路径以 `PROJECT_MAP.md` 为准，禁止从旧示例推断。

## 全局资源边界
`hooks.py` 已全局加载 `ashan_cn_procurement.css`、`ashan_ui_kit.css`、`ashan_ui_kit.js`、翻译、sidebar、work context 和 doc details。

新业务 Page 不得为了方便继续加入全局 include。页面专用 JS/CSS 优先由 Page 自己 `frappe.require()`。`hooks.py` 是高冲突注册表，只允许最小修改。

## 共享 UI 事实
共享 CSS 为 `public/css/ashan_ui_kit.css`。已有卡片、状态 badge、金额 cell、语义列宽、callout、保存状态、账期、实体 tabs 等基础类。

共享 JS 为 `public/js/ashan_ui_kit.js`。已有：
- `AshanUI.formatMoney`
- `AshanUI.createSaveIndicator`
- `AshanUI.renderPeriodSelector`
- `AshanUI.renderEntityTabs`
- `AshanUI.bindGlobalHotkeys`
- `AshanUI.enableMousewheelHorizontalScroll`
- `AshanUI.formatDocStatus`

新增同类能力前必须先搜索这些实现。

## 采购 Workbench
采购 Page 已经采用域级共享 runtime：
- `public/js/procurement_workbench.js`
- `public/css/procurement_workbench.css`

`material_request_workbench.js` 本身只加载共享资源，再调用 `AshanProcurementWorkbench.mount(wrapper, "request")`。

同一采购业务域出现新阶段、新 profile、新视图时，先扩展现有 runtime，禁止复制整页形成 `*_v2`。

## 油卡页面
`oil_card_ledger.js` 是历史迁移对象，不是新页面模板。当前仍有：
- 页面内独立 `formatMoney()`
- 多处 `style=`
- 装饰 Emoji
- 页面自己的账期控件
- 页面自己的按钮颜色体系
- 大量 Page 内 HTML

新增代码禁止复制这些写法。修改到旧区域时，在不扩大范围的前提下迁移到 `AshanUI` 和共享样式。

## 权限服务
`services/authorization_service.py` 是自定义模块统一授权入口。已有：
- `MODULE_ACCESS_MODEL`
- `get_allowed_companies`
- `assert_company_access`
- `assert_module_access`
- `can_module_access`
- `assert_payroll_access`
- `assert_oil_ledger_access`
- `filter_rows_by_company`

自定义模块禁止在 Page 中再创建平行 role map。

## 标准采购权限
采购工作台操作 ERPNext 标准 DocType，所以现有服务使用标准 `frappe.has_permission()` 计算 stage capability，这是正确模式。

规则：
- ERPNext 标准业务优先标准 DocPerm
- 自定义模块优先 `authorization_service.py`
- 两类都必须服务端确认 company scope

## 当前后端迁移点
油卡后端已调用统一 oil/company authorization，这是正确方向。但历史上还有 `is_oil_card_manager()`、`is_system_admin()`、部分 `ignore_permissions=True` 和 raw SQL。

这些只能作为待治理旧代码。新功能不得直接复制。
