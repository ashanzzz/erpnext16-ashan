# ERPNext 16 Custom App 最佳实践总纲
# ashan_cn_procurement 专属版本 — Schema 驱动开发规范

---

## 为什么要有这个文档

本项目在 ERPNext 16 上做深度二次开发，过去积累了以下典型问题：

1. 手写 HTML 拼串表格，表头改了漏改表体，导致「税率」和「金额」列颠倒
2. 手算 `colspan`，增加一列就算错，合计行数据全线左移
3. 多处 `frappe.require` 异步加载 CSS，与本地 CSS 竞争覆盖，产生进入页面时的闪屏抖动
4. 自定义 `formatMoney()` 各自为政，与 `AshanUI.formatMoney` 同时存在
5. AI 在修改表格时，只改了三处中的两处，留下隐藏 Bug

**这些问题都有一个共同根因：缺乏强制的声明式 Schema 驱动规范。**

本文档建立了一套经过生产验证（祺富 68 列大宽表已验证）、
专为这套技术栈和业务场景设计的最佳实践体系。

---

## 第一部分：技术定位与约束（必须理解）

### 系统技术栈

```
ERPNext 16 + Frappe v16（Custom App 方式）
原生 Frappe Page + jQuery + AshanUI 共享运行时
无 npm，无 Vue，无独立前端构建管线
部署：SSH 内存管道热同步，< 1s 生效
```

### Frappe Desk 的天然约束（每个 AI 都必须牢记）

**约束 1：SPA 架构，CSS 永不卸载**
```
frappe.require('xyz.css') 加载的样式 → 永久存留在 <head>
用户切换到其他页面 → CSS 不卸载
所以：页面私有 CSS 必须有根容器作用域
```

**约束 2：on_page_show 每次切换都触发**
```
on_page_load  → 只执行一次（首次）
on_page_show  → 每次切换到该 URL 都执行
所以：事件绑定必须防重复；数据刷新放在 on_page_show
```

**约束 3：frappe.require 是异步的，会导致闪屏**
```
在 frappe.require callback 外初始化 DOM → 报错
在 JS 里延时 .hide() 原生顶栏 → 先显示顶栏，再闪烁消失
正确方式：用 CSS 作用域规则静态隐藏顶栏
```

**约束 4：原生顶栏 .page-head 默认显示**
```
page.set_primary_action() → 在原生顶栏注册按钮
页面自建 action bar → 不调用 set_primary_action，避免双按钮
隐藏顶栏 → 在 ashan_ui_kit.css 加路由作用域 display:none
禁止：JS .hide() / .remove()
```

---

## 第二部分：前端开发范式（核心）

### 规范 1：表格必须 Schema 驱动

**这是本项目最重要的单一规范。**

任何自定义表格（picker 选单、台账、大宽表、工资表），
必须用 `cols` 数组作为唯一真理源，
表头、表体、合计行、空状态全部从 `cols` 自动派生。

**禁止手写任何 `<tr>`、`<th>`、`<td>` 字符串。**

参见：`规则 12_table_and_ledger_standard.md` 的完整实现规范。

已验证：祺富 68 列大宽表（`render_tax_full_68_table`）用这个模式，
**从未出现列错位或 colspan 算错**，这是本规范的权威来源。

### 规范 2：金额唯一来源

```javascript
AshanUI.formatMoney(val)   // ✅ 唯一合法
// 所有其他自定义 formatMoney / format_currency 都是违规
```

### 规范 3：CSS 三步法

```
Step 1: 搜索 ashan_ui_kit.css 是否有
Step 2: 没有 → 在 ashan_ui_kit.css 新增
Step 3: 页面只引用 UI Kit 类名
```

### 规范 4：页面骨架标准模板

```
on_page_load → make_app_page → new PageClass(page, wrapper)
PageClass.constructor → _renderLayout() + _bindEvents() + refresh()
on_page_show → instance.refresh()
_renderLayout → 只写静态 HTML 骨架（无网络请求，无动态数据）
_bindEvents  → 事件委托，绑定一次，带命名空间
refresh      → loadKpis + loadRows（async）
_renderRows  → buildTableHtml(cols, rows) → 写入 thead/tbody/tfoot
```

---

## 第三部分：后端开发规范（精简）

### 读取接口标准

```python
@frappe.whitelist()
def get_rows(company, filters=None):
    assert_company_access(company)          # 权限第一
    filters = frappe.parse_json(filters or "{}")
    rows = frappe.db.get_all(...)           # 有界查询
    return {"rows": rows}
```

### 写入接口标准

```python
@frappe.whitelist(methods=["POST"])
def create_or_update(company, **kwargs):
    assert_company_access(company)          # 权限第一
    validate_state(...)                     # 状态校验
    check_duplicate(...)                    # 幂等保护
    doc = frappe.get_doc({...})
    doc.insert()                            # 标准生命周期
    return {"name": doc.name, "success": True}
```

### 绝对禁止

```python
ignore_permissions=True   # 禁止（除非有 AI-GOVERNANCE-EXCEPTION 注释）
frappe.db.commit()        # 禁止
直接写 GL Entry           # 禁止
直接写 Stock Ledger       # 禁止
公司过滤只在前端           # 禁止
```

---

## 第四部分：AI 协作规范

### 接到任务时的正确思考顺序

```
1. 这个功能在哪个页面/DocType？
2. 改动是否涉及表格列？
   → 是：只修改 cols 数组，其余自动联动
3. 改动是否涉及共享文件（ashan_ui_kit, hooks.py）？
   → 是：读完相关 section，最小修改
4. 改动是否涉及 CSS？
   → 是：三步法（查 Kit → 扩展 Kit → 引用）
5. 改动是否涉及后端 API？
   → 是：必须有 company 鉴权，有界查询
6. 完成后必须：
   → python scripts/run_ai_guards.py
   → python scripts/fast_sync.py
   → 靶向 Playwright 验证截图
```

### AI 最容易犯的 6 种错（禁止清单）

| # | 禁止行为 | 正确替代 |
|---|---------|---------|
| 1 | 手写 `<tr><td>` 字符串拼接 | `buildTableHtml(cols, rows)` |
| 2 | 手算 `colspan="N"` | `cols.length` 自动计算 |
| 3 | 定义私有 `formatMoney()` | `AshanUI.formatMoney()` |
| 4 | 裸全局 CSS 选择器 | 作用域包裹 |
| 5 | JS 里 `.hide()` 原生顶栏 | 作用域 CSS |
| 6 | 测试写死人数/金额 | 从 SQL 动态计算期望值 |

### 完成任务后的自检清单（每次必须过一遍）

```
□ 表格是否有 cols 数组？（必须有）
□ 表头/表体/表尾/空状态都从 cols 派生？（必须是）
□ 列宽都用了 col-w-* 标准类？（必须是）
□ 金额都用了 AshanUI.formatMoney？（必须是）
□ 没有新增 inline style=？（必须没有）
□ 没有新增装饰 Emoji？（必须没有）
□ 页面 CSS 有作用域包裹？（必须有）
□ 后端接口有 company 鉴权？（必须有）
□ 运行了 run_ai_guards.py？（必须运行）
□ 截图确认了视觉效果？（必须确认）
```

---

## 第五部分：业务模块隔离边界

### 祺富 vs 吉众（绝对物理隔离）

| 维度 | 规则 |
|------|------|
| 导航入口 | 完全独立的 Page |
| 数据查询 | 每个查询必须有 `company` 过滤，两公司数据不交叉 |
| 算法 | 绝对不共用（考勤、工时、工资公式、费率、配钞全部异构） |
| UI Token | 可共享（ashan_ui_kit 颜色、字体、表格基础类） |
| DocType | 同一 DocType，但 `company` 字段是天然隔离边界 |

### 用工属性（最高级禁令）

**未经用户在当前会话明确授权，AI 绝对禁止：**
- 自动插入任何用工属性（正式工/临时工/返聘工等）
- 在后端代码里编写任何 `doc.insert()` 用工属性的逻辑
- 提供任何用工属性的"默认值"或"种子数据"

用工属性只能由用户自己通过 Desk 界面手动创建。

---

## 第六部分：版本化与可维护性指标

当本规范被完整遵守时，Git Diff 应该呈现如下特征：

**增加一列时（理想状态）：**
```diff
  const cols = [
      { k: "supplier", l: "供应商", cls: "col-w-supplier" },
+     { k: "posting_date", l: "单据日期", cls: "col-w-date", type: "date" },
      { k: "amount", l: "金额", cls: "col-w-amount", type: "money", total: true },
  ];
```

**结果：1 行变更，表头、表体、合计行、空状态全部自动正确。**

这就是 Schema 驱动的价值：**最小 Diff，最大正确性保证，AI 想错都错不了。**
