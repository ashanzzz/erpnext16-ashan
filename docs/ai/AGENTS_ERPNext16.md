# ERPNext 16 AI Development Rules

本项目的 ERPNext 开发目标版本为 ERPNext 16 / Frappe Framework 16。

## 开始开发前必须读取

1. `docs/ai/ERPNext_PROJECT_RULES.md`
2. `docs/ai/ERPNext16_LEARN.md`
3. 需要选 API 时读取 `docs/ai/ERPNext16_API_MAP.md`
4. 涉及页面和 UI 时读取 `docs/ai/ERPNext16_UI_GUIDE.md`
5. 涉及业务模块架构、设计哲学与 UI 风格记忆时读取 `docs/ai/ASHAN_APP_MODULES_AND_DESIGN_GUIDE.md`

## 版本原则

不要把 Frappe 13、14、15 的示例默认当成 v16 可用代码。

进行重要修改前，先确认实际运行版本：

```bash
bench version
bench --site <site> list-apps
```

v16 的 `bench version` 默认输出格式与旧版本不同。不要写依赖旧文本格式的脆弱解析器。

若 API、生命周期、权限、路由或 ERPNext 业务行为存在不确定性，按以下顺序确认：

1. 当前项目源码
2. 当前 Bench / Site 配置
3. Frappe `version-16` 源码
4. ERPNext `version-16` 源码
5. Frappe / ERPNext 官方文档
6. 官方 v16 Migration Notes

禁止仅凭模型记忆猜测。

## Core 修改

默认禁止直接修改：

```text
apps/frappe/
apps/erpnext/
```

默认使用 custom app 扩展。

优先机制：

- 自定义 DocType
- Custom Field / Property Setter
- `extend_doctype_class`
- `doc_events`
- `doctype_js`
- `doctype_list_js`
- whitelisted method
- REST API
- Desk Page
- Report
- fixtures
- patch

只有用户明确要求维护 fork 时，才考虑修改 core。

## 后端原则

业务完整性必须放在服务器端。

正常文档写入优先：

```python
doc = frappe.get_doc(...)
doc.save()
```

或：

```python
doc = frappe.new_doc(...)
doc.insert()
```

不要因为代码更短就使用：

```python
frappe.db.set_value(...)
doc.db_set(...)
doc.db_update(...)
raw SQL
ignore_permissions=True
```

如果确实需要绕过标准生命周期，必须在代码或交付说明中写明原因。

## 权限

用户可见列表默认使用：

```python
frappe.get_list(...)
```

不要随意改成：

```python
frappe.get_all(...)
```

`get_list` 会应用当前会话用户的记录权限。`get_all` 不应被视为等价替代。

whitelisted method 仍然必须检查相应权限。

不要用 `ignore_permissions=True` 修复权限错误。

## v16 必须记住

- Python 与 Node 的最低要求在 v16 提高。
- 默认排序从 `modified` 转向 `creation`。业务依赖顺序时显式写 `order_by`。
- `get_list` / `get_all` 在 v16 使用 Query Builder 后端。
- 某些 `run=False` 场景返回 Query Builder 对象，不要假设是 SQL 字符串。
- 需要 SQL 文本时使用相应 Query Builder 的 `.get_sql()`。
- `has_permission` hook 允许访问时要显式返回 `True`。
- `frappe.flags.in_test` 已弃用，使用 `frappe.in_test`。
- Document hooks 不得自行 `frappe.db.commit()`。
- 修改状态的 RPC 使用 POST。
- v16+ 扩展标准 DocType 优先考虑 `extend_doctype_class`。
- Desk 导航发生变化，不要把旧 `/app/...` 路由写死。
- Reports、Dashboard Charts、Pages 的 JS 在 v16 使用 IIFE 方式执行，不要依赖隐式全局变量。
- Single DocType 的 `db.get_value` 会返回更符合字段类型的原生值，不要只按旧字符串值判断。

## 前端原则

优先使用最简单、最原生的方案：

```text
原生 Form / List / Report
↓
Form Script / doctype_js / Dialog
↓
Desk Page
↓
Vue in Desk Page
↓
Frappe UI / 独立复杂前端
```

不要为了“现代化”把一个按钮需求升级成完整 SPA。

客户端校验用于改善操作体验，不替代服务器端校验。

## 财务与库存高风险对象

以下对象涉及修改时，先查看 ERPNext v16 对应 controller：

- Purchase Invoice
- Sales Invoice
- Purchase Receipt
- Delivery Note
- Payment Entry
- Journal Entry
- Stock Entry
- GL Entry
- Stock Ledger Entry
- submitted document
- cancel / amend / repost / reconciliation

禁止直接写 GL Entry 或 Stock Ledger Entry 来模拟标准业务流程。

禁止为了省事直接 `db.set_value` 修改应由标准 controller 管理的关键财务或库存状态。

## 交付前必须说明

- 修改了哪些文件
- 涉及哪些 DocType
- 增加或修改了哪些 hooks
- API 是否新增或改变
- 权限影响
- 是否需要 `bench migrate`
- 是否需要 `bench build`
- 是否需要 `clear-cache`
- 测试结果
- 财务或库存副作用
- 已知限制
