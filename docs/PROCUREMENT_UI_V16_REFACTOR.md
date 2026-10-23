# 采购与报销工作台 UI 规范（ERPNext / Frappe v16）

更新日期：2026-10-22

## 目标

“采购与报销”下的工作台统一遵循 Frappe v16 Desk 的页面结构。页面标题、主操作、公司上下文、筛选工具栏和数据表各自只保留一个职责入口，避免重复标题、重复公司选择器和说明卡片占用主工作区。

适用页面：

- `material-request-workbench` 物料申请
- `procurement-execution-workbench` 采购执行
- `material-receipt-workbench` 收货入库
- `contract-workbench` 采购合同
- `monthly-settlement-picker` 月结补录
- `wire-transfer-picker` 自办电汇
- `reimbursement-picker` 报销申请

## 单一标题原则

页面标题只使用 Frappe `frappe.ui.Page` 提供的原生 `.page-head` / PageHeader。

禁止在工作区正文再次创建以下结构：

```html
<div class="picker-top-bar">
  <h2>页面名称</h2>
</div>
```

也不要再创建“当前：某工作台”以及长说明文案作为正文顶部卡片。页面含义已经由 Sidebar 当前项、PageHeader 标题、筛选状态和数据本身表达。

## 公司上下文原则

公司选择只在左侧 Sidebar 的“默认公司”控件维护。

业务工作台通过 `window.AshanWorkContext` 读取并监听：

```javascript
const company = window.AshanWorkContext?.getCompany?.() || "All";

document.addEventListener("ashan-work-context-changed", (event) => {
    const company = event.detail?.company || "All";
    // refresh current workbench
});
```

工作台正文不得再次放置 `所属公司 / 全部公司 / 天津...` 的筛选控件。这样可以避免同一页面出现两份公司状态。

注意：当 Sidebar 选择“全部公司”时，表格中的“所属公司”数据列仍可保留，因为该列用于区分不同行的数据归属，不属于重复筛选控件。

## 主操作原则

创建类动作优先放在原生 PageHeader：

```javascript
page.set_primary_action(__("新建报销"), () => open_create_dialog());
```

正文工具栏不再重复显示同一个“新建”按钮。正文只保留与当前选择集直接相关的批量操作，例如：

- 全选本页
- 清空选择
- 批量删除
- 批量生成
- 刷新

## 筛选区

筛选区使用轻量工具栏，不使用大卡片外框：

- 背景透明
- 只保留必要的底部分隔线
- 输入框使用 Frappe 语义变量 `--control-bg`、`--border-color`
- 状态切换采用紧凑 segmented control
- 不使用大面积蓝色填充或明显阴影

## 数据表

表格是主视觉面：

- 表格容器允许 1px 边框和 8px 圆角
- 表头使用 `--subtle-fg` / `--control-bg`
- 行高保持紧凑
- 数字使用 tabular numbers
- hover 只改变浅背景
- 不使用装饰性 Emoji
- 列标题和百分比宽度继续由 `AshanTableColumns` API 控制

详见 `docs/TABLE_COLUMN_API.md`。

## 不应恢复的旧 UI

以下模式已经退役，不应重新加入：

- 正文顶部大标题卡片
- “当前：XXX 工作台”说明 Banner
- 工作台内部的第二套公司选择器
- 用户菜单旁的第二套工作环境公司按钮
- 同一个“新建”动作同时出现在 PageHeader 和正文工具栏

## 设计依据

Frappe v16 的 Desk 将 Sidebar 作为模块内主导航，并将 List View 的筛选进一步集中到主内容顶部，以减少重复侧栏和无效占用。自定义 Page 应尽量使用 `frappe.ui.make_app_page` 的原生 PageHeader，而不是在正文复制页面标题。
