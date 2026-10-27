# ERPNext 16 / Frappe Custom App — AI 工程执行总契约 V3
# ashan_cn_procurement 专项版本
# 生效日期: 2026-10-27 | 取代: V2 版本

---

## 一、架构定位与技术路线（必须理解再动手）

### 1.1 这是什么系统

本项目是在 **ERPNext 16 + Frappe v16** 基座上构建的**单一 Custom App**（`ashan_cn_procurement`），
同时承载：
- 多公司采购闭环（选单→订单→收货→发票→付款→报销）
- 两家公司薪酬工资（祺富/吉众，业务逻辑绝对隔离）
- 油卡/车辆/租赁/库存等辅助台账

没有 Vue、没有 npm、没有独立前端构建管线。
所有前端代码均为**原生 Frappe Page + 共享 AshanUI 运行时**。
部署方式为 SSH 内存管道热同步，< 1s 生效。

### 1.2 ERPNext 16 下前端页面的天然约束（必须记住）

1. **Frappe Desk 是 SPA（单页应用）**：
   用 `frappe.require('xyz.css')` 加载的 CSS **永久存留在 `<head>`，切页不卸载**。
   因此页面私有 CSS 绝不允许裸全局选择器（如 `.modal`、`table`、`body`、`.page-head`）。

2. **`on_page_show` 每次切换到该页都执行**：
   `on_page_load` 只执行一次（首次）。
   绑定事件、定时器、Observer 必须防止重复，并在页面离开时清理。

3. **`frappe.require` 是异步且会导致闪屏**：
   页面专用 CSS 优先放入 Page 同目录（Frappe 自动打包），无需 `frappe.require`。
   仅当需要条件加载非本页资源时才用 `frappe.require`，且必须在 callback 内初始化页面，**禁止在 callback 外引用任何 DOM**。

4. **原生 `.page-head` 会产生闪屏**：
   隐藏原生顶栏的正确方式是 **CSS 作用域规则**：
   ```css
   .page-container[data-page-route="my-page"] .page-head { display: none !important; }
   ```
   绝对禁止在 JS 里 `.hide()` 或 `.remove()` 顶栏元素。

5. **`page.set_primary_action()` 与内容区按钮不得重复**：
   若页面自建 action bar，则不调用 `page.set_primary_action()`，避免出现两个"新建"按钮。

---

## 二、页面类型决策树（写代码前必须对号入座）

```
需求 → 问题 → 推荐方案
──────────────────────────────────────────────────────────────────
单 DocType 的增删改查      → 先用标准 Form + List + DocPerm
数据分析、对账、导出       → Script Report / Query Report
跨 DocType 批量操作、候选 → 自定义 Desk Page（继续阅读）
复杂多表格工作台           → 自定义 Desk Page（继续阅读）
──────────────────────────────────────────────────────────────────
```

**自定义 Desk Page 内部再分三类：**

| 类型 | 典型场景 | 前端结构 |
|------|---------|---------|
| **A. 域级工作台（Domain Workbench）** | 采购选单各阶段（物料申请/采购执行/收货） | 所有 Profile 共享一个 `procurement_workbench.js` 运行时，每个 Page 只有 3 行挂载代码 |
| **B. 独立业务页（Standalone Business Page）** | 报销申请、月度结算选单、油卡台账 | 独立 Page JS + CSS，必须遵守本契约的 Schema 驱动规范 |
| **C. 大型多 Tab 工作台（Multi-Tab Workbench）** | 祺富/吉众薪酬工作台（6+ Tab） | 独立 Page + 域级状态管理，Tab 严格单显，禁止多 Tab 同时渲染 |

---

## 三、前端写代码的唯一正确范式：Schema 驱动（核心）

### 3.1 什么是 Schema 驱动，什么不是

❌ **禁止（过程式拼串——导致列错位、colspan 算错、闪屏的根源）：**
```javascript
// 严禁这种写法！AI 在上百行字符串中极易算错列数、改一处漏另外两处
let html = `<tr><th>单号</th><th>状态</th><th>金额</th></tr>`;
const rows = data.map(r => `<tr><td>${r.name}</td><td>${r.status}</td><td>${r.amount}</td></tr>`);
const foot = `<tr><td colspan="2">合计</td><td>${total}</td></tr>`;  // colspan 极易出错！
```

✅ **要求（Schema 声明——表头/表体/表尾/空状态全部由同一个 cols 数组派生）：**
```javascript
// 祺富 68 列大宽表已在用这个模式，且从未出现列错位
// 报销申请/选单/台账统一迁移到这个模式
const cols = [
    { k: "docname",      l: "报销单号", cls: "col-w-docname",   type: "link" },
    { k: "status",       l: "单据状态", cls: "col-w-status",    type: "badge" },
    { k: "posting_date", l: "单据日期", cls: "col-w-date",      type: "date" },
    { k: "supplier",     l: "供应商",   cls: "col-w-supplier",  ellipsis: true },
    { k: "tax_rate",     l: "税率 %",   cls: "col-w-tax-rate",  type: "percent" },
    { k: "amount",       l: "不含税金额", cls: "col-w-amount",   type: "money",   total: true },
    { k: "total_amount", l: "报销总额", cls: "col-w-total",     type: "money",   total: true },
    { k: "_actions",     l: "操作",     cls: "col-w-action-double", type: "actions",
      buttons: [
          { label: "付款", show: r => flt(r.outstanding_amount) > 0, onClick: r => openPay(r) },
          { label: "删除", show: r => r.can_delete,                   onClick: r => deleteDoc(r), danger: true },
      ]
    },
];
```

### 3.2 cols 数组与渲染的铁律

**一个 cols 数组驱动一切。绝不允许表头、表体、表尾、空状态、导出用不同的列定义。**

1. **表头 `<thead>`**：遍历 cols → `<th class="${c.cls}">${c.l}</th>`
2. **表体 `<tbody>`**：遍历 rows，每 row 遍历 cols → `<td class="${c.cls}">${renderCell(c, r)}</td>`
3. **表尾 `<tfoot>` 合计行**：遍历 cols，`total: true` 的列累加，其余留空
4. **空状态**：`<td colspan="${cols.length}" ...>暂无数据</td>`
5. **序号列**：序号由渲染器自动注入 `idx + 1`，cols 数组里不需要手写序号列
6. **前缀冻结列**（序号、勾选、公司）：由渲染器参数 `prefixCols` 控制，不计入 cols 业务列宽计算

### 3.3 标准列类型（type 字段映射）

| type | 渲染行为 | 对齐 | 特殊规则 |
|------|---------|------|--------|
| `text` | `frappe.utils.escape_html(val)` | 左 | 默认类型 |
| `link` | `<span class="picker-doc-clickable-link" data-name="${val}">` | 左 | 自动绑定行点击 |
| `badge` | `AshanUI.formatDocStatus(val, statusLabel)` | 中 | 只用于生命周期状态 |
| `date` | `val \|\| '-'` | 中 | 不做本地化，服务端已格式化 |
| `money` | `AshanUI.formatMoney(val)` + `.ashan-money-cell` | 右 | 必须用 AshanUI，禁止自己写 formatter |
| `percent` | `${flt(val)}%` | 中 | 小心：不是金额，不加 ¥ |
| `qty` | `flt(val).toFixed(2)` + tabular-nums | 右 | 数量列，不加货币符号 |
| `actions` | 按钮组，读 `buttons` 配置 | 中 | 见按钮规范 |
| `custom` | 调用 `c.render(r)` 自定义渲染函数 | 由 cls 决定 | 有且仅在无法用标准 type 时使用 |

### 3.4 渲染函数封装位置

渲染逻辑必须封装为页面内部函数，不得散落在模板字符串里：
```javascript
function renderCell(col, row) {
    const val = row[col.k];
    if (col.type === "money")   return AshanUI.formatMoney(val);
    if (col.type === "percent") return `${flt(val)}%`;
    if (col.type === "date")    return val || "-";
    if (col.type === "badge")   return AshanUI.formatDocStatus(val, row.status_label);
    if (col.type === "custom")  return col.render(row);
    return frappe.utils.escape_html(String(val ?? "-"));
}

function buildTableHtml(cols, rows, prefixCols = 0) {
    const colsCount = prefixCols + cols.length;
    // thead
    const ths = cols.map(c => `<th class="${c.cls}">${frappe.utils.escape_html(c.l)}</th>`).join("");
    // tbody
    if (!rows.length) {
        return {
            head: `<tr>${buildPrefixThs(prefixCols)}${ths}</tr>`,
            body: `<tr><td colspan="${colsCount}" class="ashan-table-empty-cell">暂无数据</td></tr>`,
            foot: ""
        };
    }
    const body = rows.map((r, idx) => {
        const tds = cols.map(c => `<td class="${c.cls}">${renderCell(c, r)}</td>`).join("");
        return `<tr class="${getRowClass(r)}" data-name="${frappe.utils.escape_html(r.name || "")}">${buildPrefixTds(idx, r, prefixCols)}${tds}</tr>`;
    }).join("");
    // tfoot
    const totalTds = cols.map(c => {
        if (!c.total) return `<td class="${c.cls}"></td>`;
        const sum = rows.reduce((acc, r) => acc + flt(r[c.k] || 0), 0);
        return `<td class="${c.cls} ashan-money-cell"><strong>${AshanUI.formatMoney(sum)}</strong></td>`;
    }).join("");
    const foot = `<tr><td colspan="${prefixCols}" class="col-sticky-foot">合计 (共 ${rows.length} 笔)</td>${totalTds}</tr>`;
    return {
        head: `<tr>${buildPrefixThs(prefixCols)}${ths}</tr>`,
        body,
        foot,
    };
}
```

---

## 四、页面生命周期标准模板

每个独立业务 Page 必须严格遵循以下骨架（不得随意增减层级）：

```javascript
frappe.pages["my-page"].on_page_load = function(wrapper) {
    // 1. 创建 Frappe Page（用标准 API，不自己创建 DOM）
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __("业务标题"),
        single_column: true,
    });

    // 2. 初始化页面实例（工厂函数，返回实例绑定到 wrapper 防重复）
    wrapper.my_page_instance = new MyPage(page, wrapper);
};

frappe.pages["my-page"].on_page_show = function(wrapper) {
    // 3. 重新显示时刷新数据（防止重复初始化）
    wrapper.my_page_instance?.refresh();
};

class MyPage {
    constructor(page, wrapper) {
        this.page = page;
        this.wrapper = wrapper;
        this._destroyed = false;

        // 4. 渲染静态骨架（同步，无网络请求）
        this._renderLayout();

        // 5. 绑定交互事件（只绑一次，事件委托）
        this._bindEvents();

        // 6. 加载初始数据（异步）
        this.refresh();
    }

    _renderLayout() {
        // 注入静态 HTML 骨架，包含带 ID 的锚点和空 thead/tbody/tfoot
        // 绝不在这里写动态数据
        // 绝不在这里发网络请求
        this.page.main.html(/* 静态骨架 HTML */);
    }

    _bindEvents() {
        // 用事件委托，绑定在稳定容器上，不绑定在动态生成的行上
        const $body = $(this.page.main);
        $body.on("change.mypage", "#company-select", () => this.refresh());
        $body.on("click.mypage", ".row-link", (e) => this._openDetail(e));
        // ... 其他事件
    }

    async refresh() {
        if (this._destroyed) return;
        await Promise.all([
            this._loadKpis(),
            this._loadRows(),
        ]);
    }

    async _loadRows() {
        const company = $("#company-select").val() || "All";
        this._setLoading(true);
        try {
            const r = await frappe.call({ method: MY_API.list_rows, args: { company } });
            this._renderRows(r.message?.rows || []);
        } catch (e) {
            frappe.show_alert({ message: __("加载失败，请刷新重试"), indicator: "red" });
        } finally {
            this._setLoading(false);
        }
    }

    _renderRows(rows) {
        // 调用 buildTableHtml，结果写入 thead/tbody/tfoot
        const { head, body, foot } = buildTableHtml(MY_COLS, rows, 3);
        $("#my-table-head").html(head);
        $("#my-table-body").html(body);
        $("#my-table-foot").html(foot);
    }

    destroy() {
        this._destroyed = true;
        // 清理命名空间事件
        $(this.page.main).off(".mypage");
    }
}
```

---

## 五、CSS 和样式规范（强制）

### 5.1 三步法铁律（每次写 CSS 前必须执行）

```
Step 1: 搜索 ashan_ui_kit.css 里是否有这个样式/类/Token
  ↓ 有 → 直接引用，结束
  ↓ 没有
Step 2: 把这个新样式加到 ashan_ui_kit.css（作为全局 Token 沉淀）
  ↓
Step 3: 页面/组件只引用 UI Kit 里的类名，不在页面私有 CSS 写死颜色/像素
```

### 5.2 页面私有 CSS 强制作用域

每个 Page 的专有 CSS 文件中，**所有规则必须套在页面根容器选择器内**：

```css
/* ✅ 正确：有作用域包裹 */
.ashan-reimbursement-page .filter-bar { ... }
.ashan-reimbursement-page table thead th { ... }

/* ❌ 错误：裸全局选择器，会污染其他页面 */
.filter-bar { ... }
table thead th { ... }
.page-head { display: none !important; }
```

### 5.3 标准列宽类（col-w-* 体系）

以下类已在 `ashan_ui_kit.css` 中定义，任何自定义表格必须使用（不得自造同义类）：

| 类名 | 宽度 | 用途 |
|------|------|------|
| `.col-w-seq` | 40px 锁死 | 序号列 # |
| `.col-w-check` | 38px 锁死 | 复选框列 |
| `.col-w-status` | 88~96px 居中 | 状态 Badge |
| `.col-w-docname` | 130~160px 左 | 核心单号 |
| `.col-w-inv-type` | 88~96px 居中 | 发票类型 |
| `.col-w-invoice-no` | 150~180px 左 | 发票号码（Mono） |
| `.col-w-date` | 104~110px 居中 | 日期 |
| `.col-w-company` | 130~160px 左 | 所属公司 |
| `.col-w-supplier` | 160~220px 左 | 供应商（ellipsis） |
| `.col-w-item-name` | min 180px flex | 物料名称 |
| `.col-w-spec` | min 160px flex | 规格型号（必须带 ellipsis） |
| `.col-w-uom` | 64~76px 居中 | 单位 |
| `.col-w-qty` | 88~104px 右 | 数量（tabular-nums） |
| `.col-w-rate` | 100~120px 右 | 单价 |
| `.col-w-tax-rate` | 72~88px 居中 | 税率 % |
| `.col-w-tax-amount` | 100~120px 右 | 税额 |
| `.col-w-amount` | 110~130px 右 | 不含税金额 |
| `.col-w-total` | 120~140px 右 加粗 | 总额/合计 |
| `.col-w-outstanding` | 110~130px 右 | 待付余额 |
| `.col-w-linked-doc` | 130~170px 左 | 关联单据 |
| `.col-w-details` | min 220px flex | 明细摘要 |
| `.col-w-action` | 76~96px 居中 | 单动作操作列 |
| `.col-w-action-double` | 130~144px 居中 | 双动作操作列（付款+删除） |

### 5.4 冻结列偏移精确计算公式

```
col-sticky-1 (序号):  left = 0px,  width = 40px (锁死)
col-sticky-2 (复选):  left = 40px, width = 38px (锁死)
col-sticky-3 (公司):  left = 78px, width = 140px (锁死)
```

如果冻结列定义不同（例如没有"公司"列），则三列偏移必须重新精确计算。
**禁止拍脑袋设 left 值——必须等于前面所有冻结列宽度之和。**

---

## 六、后端服务规范（精简版，完整版见 rule 20）

```python
# ✅ 标准读取接口骨架
@frappe.whitelist()
def get_rows(company, filters=None):
    # 1. 授权
    assert_company_access(company)           # 或 assert_payroll_access / assert_module_access
    # 2. 解析参数（不信任前端，服务端再验证）
    filters = frappe.parse_json(filters or "{}")
    # 3. 有界查询（有 company 过滤，有时间范围，有 limit）
    rows = frappe.db.get_all("DocType", filters={"company": company}, ...)
    # 4. 返回稳定结构
    return {"rows": rows, "total_count": len(rows)}

# ✅ 标准写入接口骨架
@frappe.whitelist(methods=["POST"])
def create_or_update(company, **kwargs):
    # 1. 授权
    assert_company_access(company)
    # 2. 校验状态
    validate_business_state(...)
    # 3. 幂等保护
    check_duplicate(...)
    # 4. 标准 Frappe 生命周期（不直接写 db）
    doc = frappe.get_doc({...})
    doc.insert()
    return {"name": doc.name, "success": True}
```

---

## 七、测试与验证门禁（完成前必须通过）

### 7.1 架构合规门禁（每次修改后必须运行）

```bash
python scripts/verify_ai_architecture_governance.py
python scripts/verify_ui_style_governance.py
python scripts/run_ai_guards.py
```

### 7.2 靶向浏览器验证（涉及前端修改时必须运行）

```bash
python scripts/fast_sync.py          # 同步代码到容器（< 1s）
python scripts/verify_<page>_live.py # 针对改动页面的 Playwright 验证
```

### 7.3 表格完整性自动断言（每次修改表格列后必须验证）

```python
# Playwright 断言：表头列数 = 表体列数 = 合计行总跨列数 = 空状态跨列数
def assert_table_column_alignment(page, table_selector):
    th_count = page.locator(f"{table_selector} thead tr th").count()
    td_count = page.locator(f"{table_selector} tbody tr:first-child td").count()
    assert th_count == td_count, f"列数不对齐: 表头 {th_count} 列，表体 {td_count} 列"
```

### 7.4 动态数据自检铁律（禁止魔法数字）

```python
# ❌ 禁止：写死人数，系统增减一人就失效
assert row_count == 26

# ✅ 要求：从数据库动态计算期望值
expected_count = frappe.db.count("Employee", {"company": COMPANY, "status": "Active"})
assert row_count == expected_count
```

---

## 八、AI 协作模式与自检协议

### 8.1 接到任务时的标准思考顺序

```
1. 这个功能在哪个页面（Page/Form/Report/Workbench）？
2. 改动范围是否涉及表格列？→ 是：必须同时改 cols 数组（thead/tbody/tfoot/空状态全部联动）
3. 改动范围是否涉及共享文件？→ 是：读完相关 section 再做最小编辑
4. 改动范围是否涉及 CSS？→ 是：先查 UI Kit，没有才扩展 UI Kit，再引用
5. 改动范围是否涉及后端 API？→ 是：必须有 company 鉴权、有界查询
6. 完成后：运行架构门禁，运行表格完整性断言，截图验证
```

### 8.2 绝对禁止的 6 种行为（AI 最容易犯的错）

| # | 禁止行为 | 正确替代 |
|---|---------|---------|
| 1 | 手写 `<tr><td>` 字符串拼接表格 | 用 cols 数组驱动 buildTableHtml |
| 2 | 手算 `colspan="N"` | 合计行由渲染器从 cols.length 自动计算 |
| 3 | 定义私有 `formatMoney()` | 统一使用 `AshanUI.formatMoney()` |
| 4 | 在页面 CSS 里写裸全局选择器 | 必须套页面根容器作用域 |
| 5 | 在 JS 里 `.hide()` 原生 `.page-head` | 用作用域 CSS `display:none` |
| 6 | 测试里写死人数/金额的魔法数字 | 从数据库 SQL 动态计算期望值 |

### 8.3 修改完成后的自我核查清单

```
□ cols 数组是唯一的列定义源（表头表体表尾都从它生成）
□ 没有在模板字符串里手写 <th> 或 <td>
□ 所有列宽都用了 col-w-* 标准类
□ 金额都用了 AshanUI.formatMoney
□ 没有新增 inline style=
□ 没有新增装饰 Emoji
□ 页面 CSS 都有作用域包裹
□ 后端接口有 company 鉴权
□ 运行了架构门禁脚本
□ 运行了靶向 Playwright 验证并截图
```

---

## 九、重要文件快速索引

| 文件 | 职责 | 修改前必读 |
|------|------|-----------|
| `public/css/ashan_ui_kit.css` | 全系统唯一样式真理源 | 是 |
| `public/js/ashan_ui_kit.js` | 全系统共享 JS 工具库 | 是 |
| `public/js/procurement_workbench.js` | 采购域级运行时（material_request / execution / receipt 共用） | 是（采购相关改动） |
| `public/css/procurement_workbench.css` | 采购域级样式 | 是（采购相关改动） |
| `services/authorization_service.py` | 所有自定义模块的权限守卫 | 是（涉及权限改动） |
| `hooks.py` | 全局资源注册表 | 是（新增全局资源时） |
| `PROJECT_MAP.md` | 项目路径地图 | 是（搜索文件前） |
