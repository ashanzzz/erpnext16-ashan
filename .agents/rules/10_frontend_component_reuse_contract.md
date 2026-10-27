# 前端组件与页面结构规范 V3

---

## 一、页面类型决策（写代码前必须对号入座）

```
新需求
  ↓
问：是否标准 DocType 的单记录增删改查？
  → 是 → 用 Form + DocPerm（绝对不要自建表单 Dialog）
  ↓ 否
问：是否稳定的数据分析、导出、报表？
  → 是 → 用 Script Report / Query Report
  ↓ 否（跨 DocType / 批量 / 候选池 / 台账）
  → 用自定义 Desk Page（分三型）：
      A. 采购域 Profile → 扩展 procurement_workbench.js 的 PROFILES
      B. 独立业务页     → 新建 Page，使用 Schema 驱动表格
      C. 多 Tab 工作台  → 新建 Page，Tab 严格单显
```

**"更现代"不是重建 Form/List 的理由。**
**"想要更好的样式"不是放弃 Frappe Report 的理由。**

---

## 二、自定义 Page 固定结构层级

所有 Desk Page 的信息架构必须从上到下按以下顺序排列，禁止随机重排：

```
1. 页面标题区（可选，unboxed 纯排版）
2. 公司 / 账期等业务上下文选择
3. 阶段 Tab 或任务 Tab（Multi-Tab 工作台）
4. 筛选条件栏（Filter Bar）
5. 选择摘要 + 动作工具栏（Action Bar）
6. 核心表格或工作区
7. 详情区（必要时，通常用 Dialog 代替）
8. Loading / Empty / Error 状态
```

---

## 三、CSS 作用域（SPA 最高铁律）

Frappe Desk 是 SPA，CSS 加载后永久存留，切页不卸载。

**页面私有 CSS 所有规则必须套在页面根容器选择器内：**

```css
/* ✅ 正确 */
.ashan-reimbursement-page .filter-bar { ... }
.ashan-reimbursement-page table th { ... }

/* ❌ 致命错误：会污染整个 Desk 的其他页面 */
.filter-bar { ... }
table th { ... }
.page-head { display: none !important; }
```

**隐藏 `.page-head` 的唯一合法方式（加路由作用域）：**
```css
.page-container[data-page-route="reimbursement-picker"] .page-head {
    display: none !important;
}
```
此规则写在 `ashan_ui_kit.css` 中（全局加载，无需 frappe.require）。

---

## 四、原生 `.page-head` 顶栏处理规范

| 场景 | 做法 |
|------|------|
| 页面自建标题区（picker/workbench 类） | 在 `ashan_ui_kit.css` 加路由作用域规则隐藏原生顶栏 |
| 使用 `page.set_primary_action()` | 只有当页面不自建 action bar 时才用 |
| 禁止 | JS 里 `.hide()` / `.remove()` 原生顶栏（造成闪屏） |
| 禁止 | 同时用 `page.set_primary_action()` 和自建按钮区（出现双按钮） |

---

## 五、金额格式化（全系统唯一来源）

```javascript
// ✅ 唯一合法写法
AshanUI.formatMoney(value)

// ❌ 所有以下写法都是违规，必须替换
function formatMoney(val) { ... }
function format_currency(val) { ... }
val.toLocaleString('zh-CN', { ... })
`¥ ${flt(val).toFixed(2)}`
```

金额 cell 必须加 `.ashan-money-cell`（右对齐 + tabular-nums）。

---

## 六、状态 Badge

```javascript
// ✅ 合法
AshanUI.formatDocStatus(val, row.status_label)

// ✅ 允许使用的 badge 场景
单据生命周期状态（草稿 / 已提交 / 已取消 / 待结款 / 已结清）

// ❌ 禁止用 badge 包裹的场景
金额、数量、姓名、公司名、物料名、规格型号
```

---

## 七、账期选择器

```javascript
// ✅ 优先使用
AshanUI.renderPeriodSelector(containerEl, {
    minYear: 2024,
    maxYear: new Date().getFullYear() + 1,
    onChange: (period) => loadData(period),
})

// ❌ 禁止
自己实现上月 / 下月 / 本月的月份导航逻辑
```

---

## 八、公司上下文

```javascript
// ✅ 多公司工作台
AshanUI.renderEntityTabs(containerEl, companies, (company) => {
    currentCompany = company;
    loadData();
})

// ✅ 简单公司选择
// 从服务端获取当前用户有权访问的公司列表，填充 <select>
frappe.call({ method: "authorization_service.get_allowed_companies", args: { module: "payroll" } })

// ❌ 禁止
从数据库拉取全部 Company 后在前端过滤
在页面 JS 里硬编码公司名列表
```

---

## 九、页面生命周期事件规范

```javascript
frappe.pages["page-name"].on_page_load = function(wrapper) {
    // 只执行一次。在这里初始化 Page 实例，绑定在 wrapper 上防止重复
    const page = frappe.ui.make_app_page({ parent: wrapper, title: "...", single_column: true });
    wrapper.my_instance = new MyPage(page, wrapper);
};

frappe.pages["page-name"].on_page_show = function(wrapper) {
    // 每次切换到此页都执行。调用实例的 refresh 方法
    wrapper.my_instance?.refresh();
};
```

**禁止在 `on_page_show` 里重复绑定事件！**
事件绑定必须在 constructor 或 `_bindEvents()` 里只执行一次，
使用命名空间（如 `.on("click.mypage", ...)`），并在 `destroy()` 里 `.off(".mypage")`。

---

## 十、横向滚动

```javascript
// ✅ 只在真实大宽表（超出视口宽度的表格）上启用
AshanUI.enableMousewheelHorizontalScroll(tableContainer)

// ❌ 禁止
给普通 10 列以内的表格加双滚动条
为了"看起来专业"给所有表格加顶部辅助滚动条
```

---

## 十一、Tab 工作台严格单显铁律

多 Tab 工作台（如薪酬工作台 6 个 Tab）：

1. 初始化时：所有 Tab 内容区必须 `display: none`，仅激活一个 Tab 为 `display: block`
2. 切换 Tab 时：先隐藏当前，再显示目标
3. **禁止**：多个 Tab 同时处于 `display: block` 状态（即使内容区位置无重叠）
4. **Playwright 测试**：必须断言"初次加载 0 点击时有且仅有 1 个 Tab 内容区可见"

---

## 十二、HTML 安全

所有从服务端返回的自由文本（用户输入的名称、备注、描述等），
插入 DOM 前必须调用：

```javascript
frappe.utils.escape_html(value)
```

---

## 十三、禁止项快查表

| 禁止 | 替代 |
|------|------|
| 页面自定义 `formatMoney()` | `AshanUI.formatMoney()` |
| 新增 `style=` 内联样式 | CSS 类 |
| 新增装饰性 Emoji | 无（纯文字） |
| 裸全局 CSS 选择器 | 作用域包裹 |
| JS 里 `.hide()` 顶栏 | 作用域 CSS |
| `frappe.require` 加载其他 Page 的 CSS | 只加载自己 Page 的资源 |
| 重复绑定 `on_page_show` 里的事件 | constructor 里绑定一次 |
| 全量数据前端过滤 | 服务端有界查询 |
| 手写 `<tr><td>` 字符串 | cols 数组 + buildTableHtml |
| 手算 `colspan` | `cols.length` 自动 |
