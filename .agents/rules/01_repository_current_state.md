# 仓库当前状态与技术边界（事实快照，以 PROJECT_MAP.md 为准）

## 路径约定

| 概念 | 实际路径 |
|------|---------|
| App 根 | `ashan_cn_procurement/` |
| Python 包根 | `ashan_cn_procurement/ashan_cn_procurement/` |
| Frappe 模块根（Page/DocType/Report） | `ashan_cn_procurement/ashan_cn_procurement/ashan_cn_procurement/` |
| 公共前端资源 | `ashan_cn_procurement/ashan_cn_procurement/public/` |

路径以 `PROJECT_MAP.md` 为唯一权威，禁止从旧示例推断路径。

## 全局加载资源（hooks.py 注册，所有 Desk 页面共享）

**CSS（已全局加载，不需要 frappe.require）：**
- `ashan_cn_procurement.css`（基础）
- `ashan_ui_kit.css`（设计 Token + 公共组件）
- `ashan_product_shell.css`（顶部导航外壳）
- `ashan_domain_refactor.css`（域级重构样式）

**JS（已全局加载，所有页面可直接调用 window.AshanUI）：**
- `ashan_ui_kit.js` → `window.AshanUI.*`
- `ashan_cn_translations.js`
- `ashan_work_context.js` → `window.AshanWorkContext.*`
- `ashan_cn_sidebar_v2.js`
- `ashan_product_shell.js`
- `ashan_domain_refactor.js`
- `doc_details_list.js`

**页面专用资源（Page 自己 frappe.require，不进 hooks.py）：**
- `procurement_workbench.css` / `procurement_workbench.js` → 采购 4 个 Page 按需加载
- 各独立 Page 的 CSS 文件 → Frappe 自动打包，无需手动 require

## AshanUI 已有能力（使用前先查，禁止重复实现）

| 方法/属性 | 功能 |
|----------|------|
| `AshanUI.formatMoney(val)` | 金额格式化，全系统唯一来源 |
| `AshanUI.formatDocStatus(val, label)` | 单据状态 Badge 渲染 |
| `AshanUI.renderPeriodSelector(el, opts)` | 账期月份选择器 |
| `AshanUI.renderEntityTabs(el, companies, onSelect)` | 公司/实体 Tab 切换 |
| `AshanUI.createSaveIndicator(el)` | 保存状态指示器 |
| `AshanUI.enableMousewheelHorizontalScroll(el)` | 表头滚轮横向滚动 |
| `AshanUI.bindGlobalHotkeys(bindings)` | 全局快捷键绑定 |
| `AshanUI.TableLayoutEngine` | 列宽用户自定义（"列设置"按钮） |
| `AshanUI.TableColumns` | 程序化设置列宽/显隐 |
| `AshanUI.getSegmentedValue(el)` | 读取分段控件当前值 |
| `AshanUI.setSegmentedValue(el, val)` | 设置分段控件值 |
| `AshanWorkContext.getCompany()` | 获取当前用户选定公司 |

**新增同类能力前必须先搜索以上列表。**

## 采购域（Domain Workbench）

4 个 Page 共享一个运行时，Page JS 文件只有约 10 行：
- `material_request_workbench` → profile: `"request"`
- `procurement_execution_workbench` → profile: `"execution"`
- `material_receipt_workbench` → profile: `"receipt"`
- （报销 `reimbursement_picker` 是独立 Page，不属于这个域）

新采购阶段优先扩展 `procurement_workbench.js` 的 `PROCUREMENT_WORKBENCH_PROFILES`，
禁止新建 `procurement_workbench_v2.js`。

## 权限服务（services/authorization_service.py）

已有守卫：

| 函数 | 用途 |
|------|------|
| `assert_company_access(company)` | 验证当前用户有权访问该公司 |
| `assert_module_access(module, action, company)` | 模块级权限 |
| `assert_payroll_access(action, company)` | 薪酬模块专用 |
| `assert_oil_ledger_access(action, oil_card)` | 油卡模块专用 |
| `get_allowed_companies(module)` | 返回用户有权的公司列表 |
| `filter_rows_by_company(rows, company)` | 数据行公司过滤 |

自定义模块禁止在 Page 里新建平行 role map。

## 薪酬工作台（两家公司绝对隔离）

| 维度 | 祺富（Qifu） | 吉众（Jizhong） |
|------|-------------|----------------|
| 导航入口 | `qifu-hr-salary-workbench` | `jizhong-hr-salary-workbench` |
| 核心 DocType | `Ashan Monthly Payroll Settlement` + `company='天津祺富机械加工有限公司'` | 同 DocType + `company='天津吉众科技有限公司'` |
| 前端 JS | `qifu_hr_salary_workbench.js` | `jizhong_hr_salary_workbench.js` |
| 算法共享 | **禁止** | **禁止** |
| UI Token 共享 | ✅ 允许（ashan_ui_kit） | ✅ 允许 |

**两家公司的薪酬表单、算法、规则不得共用、不得互相引用。**

## 已确认的历史包袱代码（只允许迁移，不允许复制）

- `oil_card_ledger.js`：有本地 `formatMoney()`、inline style、装饰 Emoji、私有账期控件
- `reimbursement_picker.js`（老版本写法）：手拼 `<tr><td>` 字符串，缺少 cols 数组统一驱动

新代码**不得**复制这些模式。修改到旧区域时，在不扩大范围的前提下局部迁移到 AshanUI。

## 高冲突文件清单（修改前必须读完相关 section）

```
hooks.py
public/css/ashan_ui_kit.css
public/js/ashan_ui_kit.js
public/js/ashan_cn_sidebar_v2.js
public/js/ashan_work_context.js
services/authorization_service.py
workspace/sidebar JSON
patches.txt
```

禁止整文件替换。只做最小局部修改。
