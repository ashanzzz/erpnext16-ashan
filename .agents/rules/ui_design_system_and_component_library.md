# UI Design System and Component Library

## 1. Product design model

The target UI is **Frappe-native Operational SaaS**.

It is not an Odoo clone and it is not a GitHub clone.

Use Frappe Desk as the application foundation. Reuse its Form, List, Report, Workspace, Page, routing, permissions, dialogs, notifications, and document lifecycle.

Borrow only useful interaction principles from mature enterprise systems:

- From Odoo: clear module hierarchy, task-oriented workspaces, strong context between record and workflow
- From GitHub Primer: predictable components, calm visual hierarchy, dense tables, explicit states, progressive disclosure, strong keyboard and accessibility behavior
- From modern enterprise SaaS: semantic design tokens, consistent empty/loading/error states, restrained surfaces, measurable interaction rules

The UI must look like one Ashan product, not a collection of generated pages.

## 2. Page archetypes

Every new page must declare one primary archetype before UI code is written.

### A. Workspace / Module Home

Use for navigation and module status.

Show:

- Module identity
- A small set of meaningful KPI or exception summaries
- Current work requiring attention
- Primary shortcuts
- Recent or important operational items

Do not turn the home page into a wall of charts.

### B. List / Ledger

Use for scanning, filtering, comparison, reconciliation, and audit.

Default to a real table or Frappe List/Report.

Use:

- Stable column order
- Sticky header when needed
- Right alignment and tabular numerals for numbers
- Explicit unit/currency
- Sortable columns when useful
- Consistent filter placement
- Row action menu for secondary actions
- Bulk actions only after selection

Do not turn every row into a card.

### C. Record / Form

Use for creating and editing one business document.

Prefer the native Frappe Form and lifecycle.

Group fields by business meaning rather than database order.

Keep primary action semantics consistent with Frappe.

### D. Review / Approval

Use when the main task is checking evidence and making a decision.

Show:

- What is being decided
- Current status
- Important exceptions
- Source evidence
- Differences or validation results
- Approve/reject or submit/cancel actions

High-risk actions must not be disguised as passive controls.

### E. Workbench / Command Center

Use only when users must coordinate multiple DocTypes, bulk operations, reconciliation, imports, exception handling, or operational monitoring in one context.

A custom Desk Page is appropriate here.

A workbench is not an excuse to reimplement standard Forms and Lists.

### F. Settings / Administration

Use standard Frappe settings patterns when possible.

Separate configuration from daily operational actions.

## 3. Technology choice

Use this order:

```text
Frappe Form / List / Report / Workspace
then Form Script / List Script / Dialog
then Frappe Desk Page
then Vue in Desk Page for genuinely complex reactive state
then independent frontend only with explicit approval
```

Do not start with Vue because a feature is visually complex.

Do not start with raw HTML because a native control exists.

## 4. Application shell

The application should have one navigation model.

Use:

- Existing Frappe Desk shell
- One permission-aware module/sidebar hierarchy
- Frappe route state
- Page header for current task
- Breadcrumb/context only when it adds orientation

Do not add a second permanent sidebar inside normal pages.

Do not add a second global top navigation.

Do not create page-specific visual shells that change the product identity.

## 5. Design tokens

Shared visual values belong in:

`ashan_cn_procurement/ashan_cn_procurement/public/css/ashan_ui_kit.css`

New page code must consume semantic tokens instead of inventing local colors and spacing.

Preferred semantic token families:

```text
surface
canvas
text-primary
text-secondary
border
brand
action-primary
focus
success
warning
danger
info
spacing
radius
control-height
font-size
shadow
z-index
```

Existing Ashan tokens should be reused and gradually normalized into semantic aliases.

Feature CSS must not repeat literal brand or status colors if an appropriate token exists.

The brand accent may identify selected navigation, focus, or brand moments. It must not be used as a large decorative surface.

Status colors communicate state. They are not decoration.

## 6. Density and spacing

This is an ERP used for operational work. Default density is compact but not cramped.

Use a 4 px base spacing rhythm.

Typical desktop controls may use 32 to 36 px visual height when this remains accessible and readable.

Interactive targets must meet WCAG 2.2 minimum target sizing or spacing requirements.

Do not shrink controls simply to fit more content.

Do not add large marketing-style whitespace inside data-heavy workflows.

## 7. Typography

Use the system/UI font stack already compatible with Frappe.

Recommended hierarchy:

- Page title: clear and compact
- Section title: one level below page title
- Body/table: optimized for long reading and scanning
- Metadata/help text: smaller but still legible
- Numeric data: `font-variant-numeric: tabular-nums`

Avoid excessive bold text.

Avoid uppercase text as a hierarchy mechanism for Chinese UI.

## 8. Tables

Tables are a primary ERP surface.

### Required behavior

- Header remains visually distinct from data
- Numeric values align right
- Text aligns left
- Dates and codes use stable formatting
- Currency always includes currency context
- Quantities include unit when ambiguity is possible
- Status uses a restrained semantic badge
- Long content truncates only when a detail path is available
- Horizontal scrolling is allowed for genuinely wide ledgers
- Critical identity columns may be sticky

### Column width rule

Do not apply the old absolute rule that all pixel widths are forbidden.

Use fixed or bounded widths for stable identity, date, status, checkbox, quantity, and action columns when that improves scanning.

Use flexible widths for descriptive text columns.

Use `min-width`, `max-width`, `minmax()`, or flex/grid constraints based on content behavior.

The goal is stable scanning, not avoiding a CSS unit.

### Table actions

One row should not contain many equally prominent buttons.

Prefer:

- Row click for record navigation when unambiguous
- One visible high-frequency action at most
- An action menu for secondary actions
- Selection-driven bulk actions for multi-record workflows

## 9. Forms and input controls

Use Frappe controls before custom controls.

A segmented control is preferred for 2 to 4 mutually exclusive options only when:

- Labels are short
- All options fit without wrapping
- Users benefit from seeing all options simultaneously
- The control remains keyboard accessible
- The choice is not destructive

Otherwise use radio buttons, Select, Autocomplete, Link, or another native control.

Do not force a segmented control because the option count is small.

Autocomplete should be used when users choose from a large or searchable domain.

Never make users memorize internal document names when a meaningful label can be displayed.

## 10. Actions and safety

Each page should have one clear primary action for the current task.

Secondary actions should be visually quieter.

Dangerous actions require:

- Clear action wording
- Confirmation when the consequence is meaningful
- Server-side revalidation
- Permission validation
- Error feedback
- Audit data where the business domain requires it

"Direct submit by default" is not a global rule.

For accounting, stock, payroll, approval, closing, deletion, or other irreversible/high-impact flows, use the standard document lifecycle and an explicit review step unless the domain has a proven, authorized fast path.

## 11. Async states

Every asynchronous region must define:

- Idle
- Loading
- Success
- Empty
- Error
- Retry

Do not leave the previous data looking current while a failed refresh is silently ignored.

Use skeletons only when they preserve layout and meaning. A spinner is enough for short bounded actions.

## 12. Empty and error states

An empty state should explain what is empty and what the user can do next.

An error should explain:

- What operation failed
- What object/context was affected
- A user-actionable reason when known
- Safe retry or navigation

Do not expose secrets or raw traceback to normal users.

## 13. Progressive disclosure

Keep the main surface focused on the current decision.

Move secondary metadata, technical evidence, audit details, or rare actions into:

- Collapsible sections
- Dialogs
- Drawers only when the existing Frappe pattern supports them
- Detail routes

Do not hide information that is required to make the primary decision.

## 14. Accessibility baseline

Target WCAG 2.2 AA for custom UI.

Required:

- Visible keyboard focus
- Semantic buttons/links/inputs
- Accessible labels
- No color-only status meaning
- Sufficient text and non-text contrast
- Keyboard operability
- Minimum target size or sufficient spacing
- Error messages connected to the relevant action/control
- Motion kept subtle and non-essential

Icon-only actions must have an accessible name and a tooltip where useful.

## 15. CSS ownership

Shared CSS belongs in `ashan_ui_kit.css`.

Feature-local CSS must:

- Be namespaced under one page root
- Avoid broad selectors such as `body`, `.page`, `.form-control`, `table`, or `.btn` without a feature root
- Avoid `!important` unless required for a documented Frappe compatibility override
- Avoid inline `style=`
- Use existing tokens and primitives
- Avoid duplicating a shared component under another class name

Do not solve a page-local problem with a global selector.

## 16. JavaScript ownership

Shared UI utilities belong in the existing Ashan UI kit only if multiple features need them.

Page-local state stays page-local.

Do not create new global variables.

The existing `window.AshanUI` is an approved compatibility namespace. Do not create additional global namespaces. New shared functions added to it require a repository search and reuse review.

Bind events with a page-specific namespace where applicable.

Clean up listeners or observers when the Page is unloaded or recreated.

## 17. Visual anti-patterns

Do not generate:

- Gradient-heavy admin UI
- Glassmorphism
- Decorative blur
- Large hero sections
- Excessive cards
- Card-per-field layouts
- Badge-per-value tables
- Multiple primary buttons
- Decorative emoji
- Unnecessary animation
- Floating controls that obscure table content
- Random colors per module
- A different spacing system per page

## 18. UI acceptance checklist

Before completion verify:

- Page archetype is correct
- Native Frappe surface was reused where suitable
- UI primitives are reused
- No duplicate component was introduced
- No page-local problem leaked into global CSS
- All async states exist
- Keyboard focus is visible
- Primary action is unambiguous
- High-risk actions have safe lifecycle behavior
- Tables scan correctly with realistic long data
- Permission-denied state is handled
- Empty and error states are useful
- Page works at common laptop widths without hiding essential actions


## 社保与公积金方式专属色彩规范 (2026-10-12 用户特别授权固化铁律)
> **强制约束**：社保方式与公积金方式的 4 列排版与其专属色彩阶梯，属于用户特别授权与强制固化的核心规范，**严禁任何 AI 模型在后续任务、重构或新页面中随意修改为其他色系！**

### 1. 五列标准排版与设置规范（基数方式与周期方式完全拆开，绝不合并）
* **表格五列标准顺序（祺富与吉众统一）**：
  1. **社保方式**（左对齐：`最低基数` / `固定基数` / `动态基数(税前工资20%)` / `不参保`）
  2. **社保基数**（等宽靠右，纯数值金额 `¥ #,##0.00`）
  3. **公积金方式**（左对齐，纯粹表达基数方式：`最低基数` / `固定基数` / `动态基数(税前工资20%)` / `不缴纳`）
  4. **公积金基数**（等宽靠右，纯数值金额 `¥ #,##0.00`）
  5. **公积金周期**（居中，独立表达缴纳周期：`季初缴纳` / `正常缴纳` / `不缴纳`）
* **设置弹窗字段标准命名（祺富与吉众统一）**：
  * **公积金方式**：`最低基数` / `固定基数` / `动态基数(税前工资20%)` / `不缴纳`
  * **基数**：固定基数金额输入（当选择固定基数时生效）
  * **周期**：`季初缴纳`（1/4/7/10月） / `正常缴纳`（每月） / `不缴纳`

### 2. 专属色彩阶梯定义 (严禁篡改色系)
1. **最低基数系列**（`最低基数`、`最低基数(季初缴纳)`）:
   * **标准翡翠绿 (Emerald Green)**: 文字 `#15803d` | 背景 `#f0fdf4` | 边框 `#86efac`
   * 对应数值金额文字色: `#15803d`
2. **最低基数正常缴纳特例**（`最低基数(正常缴纳)`）:
   * **青翠绿 (Teal Green)**: 文字 `#0f766e` | 背景 `#f0fdfa` | 边框 `#5eead4`
   * 对应数值金额文字色: `#0f766e`
3. **固定基数系列**（`固定基数`、`固定基数(季初缴纳)`）:
   * **琥珀金黄 (Amber Gold)**: 文字 `#b45309` | 背景 `#fffbeb` | 边框 `#fcd34d`
   * 对应数值金额文字色: `#b45309`
4. **固定基数正常缴纳特例**（`固定基数(正常缴纳)`）:
   * **暖橙黄 (Warm Orange)**: 文字 `#c2410c` | 背景 `#fff7ed` | 边框 `#fdba74`
   * 对应数值金额文字色: `#c2410c`
5. **动态基数系列**（`动态基数(税前工资20%)`、`动态基数(正常/季初)`）:
   * **科技宝蓝 (Royal Blue)**: 文字 `#1d4ed8` | 背景 `#eff6ff` | 边框 `#93c5fd`
   * 对应数值金额文字色: `#1d4ed8`
6. **免参保/免缴系列**（`不参保`、`不缴纳`）:
   * **中性岩灰 (Slate Muted)**: 文字 `#64748b` | 背景 `#f8fafc` | 边框 `#cbd5e1`
   * 对应数值金额文字色: `#94a3b8`（金额显示 `-`）


## 员工档案双通道修改与表头滚轮横向滚动标准 (2026-10-12 用户强制标准)
> **全局表格与档案交互铁律**：所有员工信息模块与大宽表必须无条件遵守以下交互规范，严禁后续改动回退。

### 1. 修改前提（未确认即允许修改）
* **前提 1**：只要当前账期的员工信息**尚未点击确认放行**（未锁定，即 `!is_confirmed`），则员工的所有档案信息**均可随时修改**；
* 若当前账期已确认放行或月度已封账，则进入只读受控状态，点击时友好提示：“本账期员工档案已确认并处于只读受控状态；如需修改，请先取消确认”。

### 2. 修改的双通道触发方式
* **方式 1（整行点击直达）**：鼠标悬停在员工行上呈现手型光标（`.jz-row-clickable` / `.qifu-row-clickable` / `.ashan-row-clickable`），点击该员工行的任意信息区域（除左侧勾选复选框与右侧操作按钮外），**直接弹出该员工的修改界面**；
* **方式 2（最右侧操作按钮）**：点击该行最右侧【操作】列中的【编辑档案 / 修改】按钮，同样**弹出该员工的修改界面**；
* **左侧复选框独立**：点击序号左侧的复选框（或复选框单元格）仅切换人员勾选状态，用于批量参数调整或批量离职，与整行点击修改互不干扰。

### 3. 标题行鼠标滚轮左右横向滚动（全局所有表格通用）
* **表头滚轮转横向滚动（Mousewheel-to-Horizontal Scroll）**：当鼠标光标悬停在任何表格的**标题行（`thead`）**或顶部辅助滚动条上拨动滚轮时，若表格存在横向溢出（`scrollWidth > clientWidth`），系统自动拦截默认垂直滚动，将滚轮增量（`deltaY`）平滑转换为表格容器的**左右横向滚动（`scrollLeft += deltaY`）**；
* **表体保持纵向滚动**：当鼠标位于表格内容区（`tbody`）时，滚轮保持默认的上下垂直滚动，实现“表头滚轮左右看列、表体滚轮上下看行”的高效人机工程体验。


## 全项目共用一套颜色体系与 CSS 标准 (2026-10-12 用户最高架构指令)
> **最高原则**：整个 `ashan_cn_procurement` 项目共用**唯一一套颜色体系、CSS 令牌与表格规范**（以 `public/css/ashan_ui_kit.css` 与 `public/js/ashan_ui_kit.js` 为全局 SSOT），**不区分具体表格，也不区分祺富或吉众**。此举旨在彻底保证全系统视觉与交互的绝对统一、便于全局维护；**仅在重点业务差异部分允许按模块单独配置**。

### 1. 全局统一项（严禁按表格或按公司搞多套标准）
1. **统一颜色体系**：
   * 品牌与操作主色：科技蓝 `#2563eb` / `#1d4ed8`；
   * 确认放行与最低基数：翡翠绿 `#15803d`（背景 `#f0fdf4`，边框 `#86efac`）、正常月缴青翠绿 `#0f766e`（背景 `#f0fdfa`，边框 `#5eead4`）；
   * 固定基数与预警提示：琥珀黄 `#b45309`（背景 `#fffbeb`，边框 `#fcd34d`）、正常月缴暖橙黄 `#c2410c`（背景 `#fff7ed`，边框 `#fdba74`）；
   * 动态基数（税前工资20%）：宝石蓝 `#1d4ed8`（背景 `#eff6ff`，边框 `#93c5fd`）；
   * 免参保/免缴纳与只读辅助：中性岩灰 `#64748b`（背景 `#f8fafc`，边框 `#cbd5e1`）；
   * 校验错误与红框高亮：警示红 `#ef4444` / `#b91c1c`（背景 `#fef2f2`，内嵌框 `inset 0 0 0 1.5px #ef4444`）。
2. **统一表格 CSS 与网格标准（不区分任何表格）**：
   * **字体层级**：页面主标题 `20px`（800字重）、区块标题 `16px`（700字重）、表头 `12px`（700字重，`#334155`）、表格明细 `13px`（400字重，`#1e293b`）、辅助说明 `12px`；
   * **完整行列网格线**：所有表格统一绘制行横线（`border-bottom: 1px solid #e2e8f0`）与列竖线（`border-right: 1px solid #e2e8f0`，表头 `1px solid #cbd5e1`）；
   * **非按钮零底色**：除真实 `<button>` 按钮外，普通文本、班次、作业工时、用工性质等严禁添加背景底色或胶囊包裹；
   * **通用交互能力**：所有表格自动共享表头滚轮左右横向滚动（`Mousewheel-to-Horizontal Scroll`）、表头点击智能排序（合并单元格按原子分组整组排序）、以及未确认状态下“点击整行 + 点击右侧按钮”双通道修改。

### 2. 重点差异单独配置项（仅限核心业务异构部分）
* **底层业务模型隔离，视觉基座共享**：
  * **祺富重点差异**：车间 24 列外部实发表核对、68 列全员综合结算大宽表列定义、税局申报 PDF/ZIP 原件解压比对、大额医疗救助金（21元/22元）、姓名别名容错映射；
  * **吉众重点差异**：5 行月度结构化打卡矩阵（班次/作业/加班/餐补/备注）、倒休 2 倍冲抵闭环、管理岗税后固定工资 1:1 VBA 闭式倒推、现金五档配钞点钞。
* 除上述核心业务字段、列结构与计算公式外，**严禁在各自页面 CSS 中私自发明第二套颜色或覆盖全局表格标准**。


### 4. 明细表格多选模式与行点击双态交互铁律 (2026-10-12 用户强制标准)
* **未多选状态（已勾选人数 = 0）**：
  * 点击任意员工行（除最右侧操作按钮外）：直接调起该员工的档案修改弹窗（极速编辑模式）；
  * 点击最右侧【操作】列中的【编辑档案 / 修改】按钮：调起该员工的档案修改弹窗。
* **多选状态（已勾选人数 > 0 / 多选模式激活）**：
  * **点击任意行不再弹出编辑弹窗，而是切换该行的勾选状态（选择 / 取消选择）**！便于连续批量选定人员；
  * 如果在多选模式下需要编辑单个员工，必须点击最右侧【操作】列中的按钮，或者取消所有勾选恢复单选编辑模式；
  * 勾选状态下的行以 `.jz-row-selected` / `.qifu-row-selected` 全行背景微蓝高亮反馈（`#eff6ff`）。

### 5. 社保与公积金动态基数差异化计算重构标准 (2026-10-12 用户强制重构)
* **社保动态基数**：
  * 选项名称：`动态基数(税前工资20%)`；
  * 计算法则：`社保基数 = 税前工资 × 20%`。
* **公积金动态基数**：
  * 选项名称：`动态基数(税前工资5%)`；
  * 计算法则：联动当前企业配置的公积金公司缴费比例（当前设定：公司 `5%`、个人 `5%`），`公积金基数 = 税前工资 × 5%`（严禁与社保混用 20%）。
