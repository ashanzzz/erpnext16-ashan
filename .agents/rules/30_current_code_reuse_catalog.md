# 当前可复用代码目录（Search Before Create）

在新建任何东西之前，先在这里查。

---

## 全局共享 JS（window.AshanUI）

文件：`public/js/ashan_ui_kit.js`（全局已加载，页面直接调用）

| 方法 | 用途 |
|------|------|
| `AshanUI.formatMoney(val)` | **唯一合法金额格式化**，全系统禁止重复实现 |
| `AshanUI.formatDocStatus(val, label)` | 单据状态 Badge |
| `AshanUI.renderPeriodSelector(el, opts)` | 账期月份选择器（上月/下月/本月） |
| `AshanUI.renderEntityTabs(el, items, onSelect)` | 公司/实体 Tab 切换 |
| `AshanUI.createSaveIndicator(el)` | 保存状态指示器（草稿/已保存） |
| `AshanUI.enableMousewheelHorizontalScroll(el)` | 表头滚轮横向滚动 |
| `AshanUI.bindGlobalHotkeys(bindings)` | 全局快捷键（当前 Page 单控制器） |
| `AshanUI.TableLayoutEngine.init(table, key)` | 列宽用户自定义（"列设置"弹窗） |
| `AshanUI.TableColumns.setColumn(table, idx, opts)` | 程序化设置单列宽/显隐 |
| `AshanUI.TableColumns.setColumns(table, columnsMap)` | 批量程序化设置列宽 |
| `AshanUI.getSegmentedValue(el)` | 读取分段控件当前激活值 |
| `AshanUI.setSegmentedValue(el, val)` | 设置分段控件激活值 |

**新增同类能力前必须先搜索以上列表。不得重复实现。**

---

## 全局共享 CSS（ashan_ui_kit.css）

文件：`public/css/ashan_ui_kit.css`（全局已加载）

已有基础类：
- 卡片：`.ashan-table-card`、`.ashan-kpi-card`
- 状态 Badge：`.ashan-status-badge`、`.ashan-status-green/amber/red/blue`
- 金额单元格：`.ashan-money-cell`
- 语义列宽：`.col-w-seq/check/status/docname/date/supplier/...`（完整列表见 rule 12）
- 空状态：`.ashan-table-empty-cell`
- Callout：`.ashan-callout`
- 保存状态：`.ashan-save-indicator`
- 冻结列：`.col-sticky-1/2/3`

---

## 工作上下文（window.AshanWorkContext）

文件：`public/js/ashan_work_context.js`（全局已加载）

多公司工作台优先使用：
- `AshanWorkContext.getCompany()` 获取当前用户选定公司
- `AshanWorkContext.setCompany(company)` 设置公司（触发 `ashan-work-context-changed` 事件）

**禁止新建第二套公司 global/localStorage context。**

---

## 采购域运行时

文件：`public/js/procurement_workbench.js` + `procurement_workbench.css`

挂载方式（每个采购 Page JS 只需 3 行）：
```javascript
frappe.pages["material-request-workbench"].on_page_load = function(wrapper) {
    frappe.require([
        "form.bundle.js",
        "/assets/ashan_cn_procurement/css/procurement_workbench.css",
        "/assets/ashan_cn_procurement/js/procurement_workbench.js",
    ], () => window.AshanProcurementWorkbench.mount(wrapper, "request"));
};
```

已有 Profile：`request`、`execution`、`receipt`

**新采购阶段：扩展 `PROCUREMENT_WORKBENCH_PROFILES`，禁止新建独立运行时文件。**

---

## 权限服务

文件：`services/authorization_service.py`

| 函数 | 场景 |
|------|------|
| `assert_company_access(company)` | 通用公司权限验证 |
| `assert_module_access(module, action, company)` | 模块级权限 |
| `assert_payroll_access(action, company)` | 薪酬相关 API |
| `assert_oil_ledger_access(action, oil_card)` | 油卡相关 API |
| `get_allowed_companies(module)` | 返回用户有权的公司列表 |
| `can_module_access(module, action, company)` | 布尔判断（不 throw） |

---

## 后端服务文件

| 文件 | 覆盖功能 |
|------|---------|
| `services/reimbursement_picker_service.py` | 报销申请选单 API |
| `services/procurement_picker_service.py` | 采购选单公共 API（公司列表等） |
| `services/authorization_service.py` | 权限守卫 |
| `payroll_engine.py` | 薪酬计算核心引擎 |
| `services/jizhong_payroll_service.py` | 吉众薪酬专属服务 |
| `services/payroll_excel_import_service.py` | Excel 导入解析 |
| `services/payroll_recalculation_service.py` | 薪酬重算 |

新功能优先扩展已有 service，禁止新建 `*_v2.py` 或在 Page .py 里直接写业务逻辑。

---

## DocType 客户端脚本（已有，按需扩展）

- `reimbursement_request.js` / `reimbursement_request_list.js`
- Purchase Order / Invoice / Receipt / Material Request（标准 ERPNext DocType）

新增同 DocType 行为：**扩展现有脚本**，禁止通过第二个 global include 注入。

---

## 同步与部署工具

| 脚本 | 用途 |
|------|------|
| `python scripts/fast_sync.py` | 日常改动（JS/CSS/Python）热同步 < 1s |
| `python scripts/sync_and_migrate.py` | DocType 字段变更 + bench migrate |
| `python scripts/verify_ai_architecture_governance.py` | 架构合规门禁 |
| `python scripts/verify_ui_style_governance.py` | UI 样式合规门禁 |
| `python scripts/run_ai_guards.py` | 所有门禁综合运行 |

**日常代码改动只用 fast_sync.py。只有 DocType JSON 结构变更才用 sync_and_migrate.py。**
