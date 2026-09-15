# ERPNext 16 API MAP

> 用途：AI 在 ERPNext 16 custom app 中快速决定“该用什么”。

## 1. 文档操作

| 任务 | 首选 | 注意 |
|---|---|---|
| 读一个 Document | `frappe.get_doc` | 已知 name 时首选 |
| 新建 | `frappe.new_doc` | 再 `insert()` |
| 新建 dict | `frappe.get_doc({...})` | 再 `insert()` |
| 保存 | `doc.save()` | 执行标准 validation/lifecycle |
| 提交 | `doc.submit()` | 财务库存高风险 |
| 取消 | `doc.cancel()` | 先读 ERPNext controller |
| 删除 | `frappe.delete_doc` / `doc.delete()` | 检查链接和权限 |
| 检查权限 | `doc.check_permission()` | whitelist 不等于有权限 |

## 2. 查询

| 任务 | 首选 | 注意 |
|---|---|---|
| 用户可见列表 | `frappe.get_list` | 应用用户权限 |
| 内部不受记录权限过滤列表 | `frappe.get_all` | 需要明确授权理由 |
| 一字段 | `frappe.db.get_value` | 直接读 |
| Single 字段 | `frappe.db.get_single_value` | 注意 v16 原生类型 |
| 是否存在 | `frappe.db.exists` | 存在不代表用户有权限 |
| 复杂查询 | `frappe.qb` | 权限要另外确认 |
| SQL 文本 | `query.get_sql()` | v16 不要假设 `run=False` 返回 string |
| Raw SQL | 最后选择 | 参数化并写明理由 |

## 3. 文档写入优先级

```text
doc.save()
优先于
frappe.db.set_value()
优先于
raw SQL
```

除非明确需要绕过 lifecycle。

## 4. 标准 DocType 扩展

| 需求 | 首选 |
|---|---|
| 增加 class 方法/属性 | `extend_doctype_class` |
| 监听 validate/submit 等 | `doc_events` |
| 增加 Form JS | `doctype_js` |
| 增加 List JS | `doctype_list_js` |
| 完整 Controller 替换 | `override_doctype_class`，特殊情况 |
| 覆盖标准 RPC | `override_whitelisted_methods`，特殊情况 |

## 5. 前端

| 需求 | API |
|---|---|
| Form event | `frappe.ui.form.on` |
| 设置字段 | `frm.set_value` |
| 字段属性 | `frm.set_df_property` |
| Link 查询 | `frm.set_query` |
| 按钮 | `frm.add_custom_button` |
| Dialog | `frappe.ui.Dialog` |
| 路由 | `frappe.set_route` |
| 调服务器 API | `frappe.call` |
| 调当前 Controller method | `frm.call` |
| 简单客户端读 | `frappe.db.get_value/get_list/get_doc` |
| 自定义工作台 | `frappe.ui.Page` |
| 复杂工作台 | Vue in Desk Page |

## 6. API

### Resource v1

```text
POST   /api/resource/{doctype}
GET    /api/resource/{doctype}/{name}
PUT    /api/resource/{doctype}/{name}
DELETE /api/resource/{doctype}/{name}
```

### RPC v1

```text
/api/method/my_app.api.some_method
```

### API v2

```text
/api/v2/document/{doctype}
/api/v2/document/{doctype}/{name}
/api/v2/doctype/{doctype}/meta
/api/v2/method/{dotted.path}
```

### Whitelist

```python
@frappe.whitelist()
def method():
    ...
```

规则：

```text
read-only -> GET 可以
state-changing -> POST
```

## 7. Background

| 任务 | 首选 |
|---|---|
| 异步任务 | `frappe.enqueue` |
| 当前事务提交后执行 | `enqueue_after_commit=True` |
| 定时任务 | `scheduler_events` |
| 长报表 | Prepared Report |

## 8. 自定义元数据部署

| 内容 | 方式 |
|---|---|
| App 自己的 Standard DocType | Developer Mode + repo files |
| 标准 ERPNext DocType 的 Custom Field/Property Setter | Export Customizations 或 fixtures |
| 固定数据库配置记录 | `fixtures` |
| 一次性历史数据迁移 | patch |
| Schema/fixtures/scheduler 同步 | `bench migrate` |
| JS/Vue bundle | `bench build` |

## 9. 调试

```bash
bench version
bench --site <site> list-apps
bench --site <site> console
bench --site <site> migrate
bench --site <site> clear-cache
bench --site <test-site> run-tests --app <app>
bench build
```

## 10. 高风险信号

AI 生成以下代码时必须解释：

```text
get_all
ignore_permissions=True
db.set_value
db_set
db_update
raw SQL
db.commit
override_doctype_class
override_whitelisted_methods
直接改 ERPNext core
直接写 GL Entry
直接写 Stock Ledger Entry
```

## 官方入口

```text
https://docs.frappe.io/framework/user/en/api/document
https://docs.frappe.io/framework/user/en/api/database
https://docs.frappe.io/framework/user/en/api/query-builder
https://docs.frappe.io/framework/user/en/api/rest
https://docs.frappe.io/framework/user/en/api/form
https://docs.frappe.io/framework/user/en/python-api/hooks
https://docs.frappe.io/framework/user/en/api/background_jobs
https://github.com/frappe/frappe/wiki/Migrating-to-version-16
```
