# ERPNext 16 / Frappe 16 AI Development LEARN

> 目标：教 AI 正确编辑 ERPNext 16 的 custom app、脚本、前端、后端、DocType、API、报表和迁移。
>
> 本文件聚焦开发，不是 ERPNext 普通用户操作手册。

---

## 1. 核心认知

ERPNext 是运行在 Frappe Framework 上的业务应用。

因此，开发时要分两层理解：

```text
ERPNext 16
采购 / 销售 / 库存 / 财务 / 制造等业务 Controller
        ↓
Frappe Framework 16
DocType / Document / ORM / Permissions / Desk / REST / Hooks / Jobs
        ↓
MariaDB/PostgreSQL + Redis/Valkey + Workers + Node assets
```

修改 ERPNext 标准业务对象前：

1. 先理解 Frappe v16 的框架行为。
2. 再检查 ERPNext `version-16` 对应 Controller。
3. 实现默认放进 custom app。
4. 不直接改 ERPNext/Frappe core。

---

## 2. 官方知识源优先级

AI 必须使用以下优先顺序：

```text
当前项目源码
↓
当前 Bench / Site 实际版本
↓
Frappe version-16 源码
↓
ERPNext version-16 源码
↓
Frappe 官方文档
↓
ERPNext 官方文档
↓
Frappe v16 Migration Notes
↓
必要时官方 Issue / PR
```

关键官方入口：

```text
Frappe Framework
https://docs.frappe.io/framework/

ERPNext
https://docs.frappe.io/erpnext/

Frappe version-16 source
https://github.com/frappe/frappe/tree/version-16

ERPNext version-16 source
https://github.com/frappe/erpnext/tree/version-16

v16 Migration Notes
https://github.com/frappe/frappe/wiki/Migrating-to-version-16
```

禁止把旧博客、旧 Stack Overflow 示例直接当作 v16 依据。

---

## 3. Bench、App、Site 的关系

典型结构：

```text
frappe-bench/
├── apps/
│   ├── frappe/
│   ├── erpnext/
│   └── my_app/
├── sites/
│   ├── common_site_config.json
│   └── mysite/
│       └── site_config.json
├── logs/
├── env/
└── config/
```

概念：

```text
Bench
    一套 Frappe 开发/运行环境

App
    Python package + Frappe 元数据 + JS/前端资源

Site
    一个独立数据库和配置实例

一个 Bench 可以安装多个 App
一个 Bench 可以承载多个 Site
每个 Site 可以安装不同的 App 集合
```

确认环境：

```bash
bench version
bench --site <site> list-apps
```

Frappe v16 Migration Notes 明确说明核心依赖最低版本提高到：

```text
Python 3.14+
NodeJS 24+
```

但是 AI 不得因为这个文件写了版本号，就擅自升级生产环境。先检查当前实际部署。

---

## 4. 创建和安装 custom app

从 Bench 根目录：

```bash
bench new-app my_app
```

安装到 Site：

```bash
bench --site <site> install-app my_app
```

确认：

```bash
bench --site <site> list-apps
```

开发标准 DocType、Standard Report、Standard Print Format 等源代码元数据时，需要 Developer Mode。

常见设置：

```bash
bench set-config -g developer_mode true
bench --site <site> clear-cache
```

实际生产环境是否启用 Developer Mode，应按项目部署策略决定。

官方：

```text
https://docs.frappe.io/framework/user/en/tutorial/create-an-app
https://docs.frappe.io/framework/user/en/tutorial/create-a-doctype
```

---

## 5. custom app 目录

典型结构：

```text
apps/my_app/
├── pyproject.toml
└── my_app/
    ├── __init__.py
    ├── hooks.py
    ├── modules.txt
    ├── patches.txt
    ├── public/
    │   ├── js/
    │   └── css/
    ├── templates/
    ├── www/
    └── my_module/
        ├── doctype/
        ├── report/
        └── page/
```

重要文件：

### `hooks.py`

Frappe 扩展入口。

常见内容：

```python
doctype_js = {
    "Purchase Invoice": "public/js/purchase_invoice.js",
}

doc_events = {
    "Purchase Invoice": {
        "validate": "my_app.events.purchase_invoice.validate",
    }
}

extend_doctype_class = {
    "Purchase Invoice": [
        "my_app.extensions.purchase_invoice.PurchaseInvoiceMixin"
    ]
}

scheduler_events = {
    "hourly": [
        "my_app.tasks.hourly.run"
    ]
}
```

### `patches.txt`

一次性数据迁移和兼容性 patch 的入口。

不要把“每次请求都应该执行”的业务逻辑写成 patch。

### `public/`

JS、CSS 和 bundle 资源。

### `doctype/`

自定义 DocType 的 JSON、Python Controller、JS Form Script 和测试。

---

## 6. 如何选择扩展方式

AI 先判断需求属于哪一层，不要直接写代码。

| 需求 | 首选方式 |
|---|---|
| 添加字段 | Custom Field / exported customization |
| 改字段属性 | Property Setter / exported customization |
| 一个 Site 的小型前端行为 | Client Script |
| App 中共享的 Form 行为 | `{doctype}.js` / `doctype_js` |
| 自定义 DocType 后端业务规则 | Controller |
| 监听标准 DocType 生命周期事件 | `doc_events` |
| 给标准 DocType 增加方法或属性 | `extend_doctype_class` |
| 完整替换标准 Controller | `override_doctype_class`，仅特殊情况 |
| 调用自定义服务器业务操作 | `@frappe.whitelist()` |
| 普通 CRUD 外部集成 | REST resource API |
| 长任务 | `frappe.enqueue` |
| 周期任务 | `scheduler_events` |
| 普通表单 CRUD | 原生 Desk Form/List |
| 跨多个 DocType 的工作台 | Desk Page |
| 状态复杂的 Desk 工作台 | Vue in Desk Page |
| 大型组件化前端 | Frappe UI / Vue |

---

## 7. `extend_doctype_class` 是 v16 的重点

Frappe 官方 Hooks 文档说明：

```text
extend_doctype_class
```

是 v16+ 提供的机制。

当你只是想给标准 DocType 增加功能时，优先使用它，而不是完整替换 Controller。

例：

```python
# my_app/extensions/purchase_invoice.py

import frappe

class PurchaseInvoiceMixin:
    @frappe.whitelist()
    def get_ai_match_summary(self):
        self.check_permission("read")

        return {
            "name": self.name,
            "supplier": self.supplier,
            "grand_total": self.grand_total,
        }
```

注册：

```python
# hooks.py

extend_doctype_class = {
    "Purchase Invoice": [
        "my_app.extensions.purchase_invoice.PurchaseInvoiceMixin"
    ]
}
```

完整替换：

```python
override_doctype_class = {
    "Purchase Invoice": "my_app.overrides.purchase_invoice.CustomPurchaseInvoice"
}
```

只有在确实需要完整 Controller 替换时才使用。

v16 Migration Notes 还要求 override class 必须继承原始 class。

---

## 8. DocType 的标准代码结构

自定义 DocType：

```text
my_app/my_module/doctype/ai_invoice_match/
├── __init__.py
├── ai_invoice_match.json
├── ai_invoice_match.py
├── ai_invoice_match.js
└── test_ai_invoice_match.py
```

职责：

```text
.json
字段、权限、命名、布局等元数据

.py
服务器 Controller

.js
Desk Form 前端交互

test_*.py
后端测试
```

---

## 9. Document Controller 生命周期

Controller 继承：

```python
from frappe.model.document import Document

class AIInvoiceMatch(Document):
    pass
```

常见生命周期：

```text
before_naming
autoname

before_insert
before_validate
validate
before_save
after_insert
on_update

before_submit
on_submit

before_cancel
on_cancel

before_update_after_submit
on_update_after_submit

on_change

before_rename
after_rename

on_trash
after_delete
```

业务规则通常放：

```text
validate
before_submit
on_submit
before_cancel
on_cancel
```

不要随便覆盖：

```text
db_insert
db_update
```

官方 Document API 明确提醒，这些底层方法会绕过标准校验和 Controller 生命周期。

`on_change` 可能被 `db_set` 触发，因此写在其中的逻辑应能安全重复执行。

官方：

```text
https://docs.frappe.io/framework/user/en/basics/doctypes/controllers
https://docs.frappe.io/framework/user/en/api/document
```

---

## 10. 前端校验与后端校验

原则：

```text
前端校验 = 用户体验
后端校验 = 数据完整性
```

不要只写：

```javascript
frappe.ui.form.on("My Doc", {
    validate(frm) {
        if (!frm.doc.some_field) {
            frappe.throw(__("Required"));
        }
    }
});
```

真正关键的业务规则还应在服务器端验证：

```python
def validate(self):
    if not self.some_field:
        frappe.throw("Required")
```

原因：

- REST 可以绕过浏览器 Form
- 后台任务可以直接创建文档
- bench console 可以写入
- 其他服务器代码可以调用 Document API
- Client Script 可被禁用或修改

---

## 11. Document API

读取：

```python
doc = frappe.get_doc("Purchase Invoice", invoice_name)
```

创建：

```python
doc = frappe.new_doc("My DocType")
doc.some_field = "value"
doc.insert()
```

或：

```python
doc = frappe.get_doc({
    "doctype": "My DocType",
    "some_field": "value",
})
doc.insert()
```

更新：

```python
doc = frappe.get_doc("My DocType", name)
doc.status = "Done"
doc.save()
```

权限：

```python
doc.check_permission("read")
doc.check_permission("write")
```

优先使用正常 Document 方法，因为它们负责标准校验和生命周期。

---

## 12. Database API

### `get_list`

```python
rows = frappe.get_list(
    "Purchase Receipt",
    filters={
        "supplier": supplier,
        "docstatus": 1,
    },
    fields=[
        "name",
        "posting_date",
        "grand_total",
    ],
    order_by="posting_date desc",
    page_length=50,
)
```

特点：

```text
会应用当前会话用户的记录权限
```

### `get_all`

```python
rows = frappe.get_all(
    "Purchase Receipt",
    filters={"docstatus": 1},
    fields=["name"],
)
```

特点：

```text
不应视为 get_list 的普通简写
不会应用与 get_list 相同的用户记录权限过滤
```

因此：

```text
用户可见数据 -> 优先 get_list
明确的内部系统任务 -> 才考虑 get_all
```

### 获取字段

```python
value = frappe.db.get_value(
    "Purchase Invoice",
    invoice_name,
    "supplier",
)
```

### 判断存在

```python
exists = frappe.db.exists("Purchase Invoice", invoice_name)
```

### 直接字段写入

```python
frappe.db.set_value(
    "My DocType",
    name,
    "status",
    "Done",
)
```

注意：

```text
db.set_value / db_set / db_update
不是 doc.save 的等价替代。
```

业务 Controller 校验必须执行时，加载文档并 `save()`。

官方：

```text
https://docs.frappe.io/framework/user/en/api/database
```

---

## 13. v16 Database API 易错点

v16 Migration Notes 明确包含以下变化。

### 默认排序改变

旧代码可能隐式依赖：

```text
modified desc
```

v16 默认转向：

```text
creation desc
```

所以业务逻辑需要最新修改记录时，必须显式：

```python
order_by="modified desc"
```

不要依赖默认顺序。

### `get_list` / `get_all` 使用 Query Builder 后端

如果代码依赖旧版生成 SQL 的具体格式，要重新验证。

### `run=False`

不要假设返回值一定是 SQL 字符串。

当得到 Query Builder 对象时，需要：

```python
query.get_sql()
```

### Single DocType 类型转换

v16 `db.get_value` 对 Single DocType 的返回值更符合字段原生类型。

不要只写：

```python
if enabled == "1":
```

还要按真实字段类型处理，例如：

```python
if enabled == 1:
```

---

## 14. Query Builder

复杂查询优先考虑：

```python
Receipt = frappe.qb.DocType("Purchase Receipt")

query = (
    frappe.qb.from_(Receipt)
    .select(
        Receipt.name,
        Receipt.supplier,
        Receipt.posting_date,
        Receipt.grand_total,
    )
    .where(Receipt.docstatus == 1)
    .where(Receipt.supplier == supplier)
)

rows = query.run(as_dict=True)
```

查看 SQL：

```python
sql = query.get_sql()
```

不要默认认为 Query Builder 自动等同于 `get_list` 的用户权限过滤。

用户可见数据的权限逻辑要明确验证。

官方：

```text
https://docs.frappe.io/framework/user/en/api/query-builder
```

---

## 15. Raw SQL

默认避免：

```python
frappe.db.sql(
    f"SELECT * FROM `tabPurchase Invoice` WHERE supplier='{supplier}'"
)
```

问题：

- SQL 注入
- 权限行为不明确
- 可维护性差
- 容易依赖数据库方言
- 容易绕过 Frappe 生命周期

推荐：

```text
Document API
Database API
Query Builder
```

确有性能或特殊 SQL 需求时再使用 raw SQL，并进行参数化。

---

## 16. Form Script

标准结构：

```javascript
frappe.ui.form.on("Purchase Invoice", {
    refresh(frm) {
        // UI behavior
    },

    supplier(frm) {
        // field event
    }
});
```

常用：

```javascript
frm.set_value(...)
frm.set_query(...)
frm.toggle_display(...)
frm.set_df_property(...)
frm.add_custom_button(...)
frm.save()
frm.reload_doc()
frappe.set_route(...)
frappe.ui.Dialog(...)
```

官方：

```text
https://docs.frappe.io/framework/user/en/api/form
https://docs.frappe.io/framework/user/en/api/dialog
```

---

## 17. Client Script 和 App JS 的边界

### Client Script

适合：

- 单个 Site
- 小规模
- 临时或本地化 UI 逻辑
- 管理员希望直接在 Desk 中维护

### App JS

适合：

- 需要 Git 版本控制
- 多 Site 共用
- 正式业务功能
- 代码较长
- 需要代码审查和测试
- 属于 custom app 产品逻辑

标准 ERPNext DocType 的共享 JS，不要改 ERPNext core JS。

使用：

```python
doctype_js = {
    "Purchase Invoice": "public/js/purchase_invoice.js",
}
```

文件：

```text
my_app/public/js/purchase_invoice.js
```

---

## 18. `frappe.call`

调用任意 whitelisted Python 方法：

```javascript
const r = await frappe.call({
    method: "my_app.api.invoice.get_candidates",
    args: {
        invoice_name: frm.doc.name,
    },
    freeze: true,
    freeze_message: __("Loading"),
});

const data = r.message;
```

Python：

```python
import frappe

@frappe.whitelist()
def get_candidates(invoice_name):
    invoice = frappe.get_doc("Purchase Invoice", invoice_name)
    invoice.check_permission("read")

    return []
```

`@frappe.whitelist()` 只表示“允许通过 RPC 调用”。

它不表示：

```text
无需权限检查
无需业务校验
可以 ignore_permissions
```

---

## 19. `frm.call`

适合调用当前 DocType Controller 中的 whitelisted method。

后端：

```python
class AIInvoiceMatch(Document):

    @frappe.whitelist()
    def recalculate(self):
        self.check_permission("read")
        return {
            "status": self.status,
        }
```

前端：

```javascript
const r = await frm.call("recalculate");
console.log(r.message);
```

---

## 20. REST API

Frappe 会自动给 DocType 提供 REST API。

### API v1

普通 CRUD：

```text
POST   /api/resource/:doctype
GET    /api/resource/:doctype/:name
PUT    /api/resource/:doctype/:name
DELETE /api/resource/:doctype/:name
```

调用 whitelisted method：

```text
/api/method/my_app.api.method_name
```

### API v2

Frappe 15+ 已提供 API v2，v16 可以使用。

常见：

```text
/api/v2/document/{doctype}
/api/v2/document/{doctype}/{name}
/api/v2/doctype/{doctype}/meta
/api/v2/method/{dotted.path}
```

不要为了“新”而强制把已有稳定 v1 集成全部重写为 v2。

新项目可根据实际接口能力、团队规范和兼容性选择。

官方：

```text
https://docs.frappe.io/framework/user/en/api/rest
https://docs.frappe.io/framework/user/en/guides/integration/rest_api
```

---

## 21. REST Token 安全

常见 Token Header：

```text
Authorization: token api_key:api_secret
```

原则：

- 使用专用 Integration User
- 最小化 Role
- API Secret 不放前端源码
- API Secret 不放 Git
- API Secret 不写进可下载的日志
- 后端服务从 Secret/环境变量读取
- 浏览器调用优先使用当前 ERPNext session，而不是硬编码 Token

---

## 22. 状态修改 RPC 必须注意 HTTP Method

v16 Migration Notes 明确加强了部分状态修改方法的 POST 要求。

通用规则：

```text
只读操作 -> GET 可以
修改数据库状态 -> POST
```

不要设计：

```text
GET /api/method/my_app.api.confirm_invoice
```

却在里面创建、提交或修改单据。

---

## 23. `doc_events`

当希望监听标准 DocType 生命周期，但不需要把方法挂到 Document class 上：

```python
doc_events = {
    "Purchase Invoice": {
        "validate": "my_app.events.purchase_invoice.validate",
        "on_submit": "my_app.events.purchase_invoice.on_submit",
    }
}
```

实现：

```python
def validate(doc, method=None):
    pass
```

适合：

- 审计
- 附加校验
- 数据同步
- 事件通知
- 不需要 Controller mixin 的简单扩展

注意 v16：

```text
通过 hooks.py 配置的 document hooks 不允许自行 frappe.db.commit()
```

不要绕过。

---

## 24. `override_whitelisted_methods`

仅在确实需要替换已有 RPC 时考虑。

这是一种高冲突机制。

优先问：

```text
是否能新增自己的 API？
是否能通过 hook 或业务层扩展，而不是覆盖官方 method？
```

如果多个 App 都覆盖同一个 method，要检查 Hook 解析顺序。

---

## 25. Custom Field / Property Setter 如何随 App 部署

有两种常见方式。

### 方式 A：Export Customizations

在 Customize Form 中通过官方的 Export Customizations。

Frappe 会把配置导出到 App 模块的：

```text
custom/
```

更新或 `bench migrate` 时同步。

重要警告：

官方文档说明，使用这种同步方式时，站点上的相应 Property Setter 和 custom permissions 可能会按代码中的内容替换。

因此不要在不理解后果时对大量标准 DocType 一键导出。

官方：

```text
https://docs.frappe.io/framework/user/en/guides/app-development/exporting-customizations
```

### 方式 B：Fixtures

hooks.py：

```python
fixtures = [
    "Custom Field",
]
```

或使用过滤条件：

```python
fixtures = [
    {
        "dt": "Custom Field",
        "filters": [
            ["name", "like", "Purchase Invoice-%"]
        ],
    }
]
```

导出：

```bash
bench --site <site> export-fixtures
```

会写入 App 的 fixtures 文件。

官方：

```text
https://docs.frappe.io/framework/user/en/python-api/hooks
```

AI 不能把“Export Customizations”和“fixtures”当成完全相同的机制。

---

## 26. Patch

当 App 升级需要一次性修改历史数据：

```text
patches.txt
```

例：

```text
my_app.patches.v1_1.backfill_ai_status
```

Python：

```python
import frappe

def execute():
    # one-time migration
    pass
```

Patch 要：

- 可重复执行时尽量安全
- 只做迁移任务
- 不依赖浏览器
- 不把日常业务流程写进 patch
- 大规模数据更新前评估锁表和耗时

---

## 27. `bench migrate`

App 修改后，不是所有变化都只需要刷新浏览器。

常见：

```bash
bench --site <site> migrate
```

它用于同步包括：

- schema
- patches
- fixtures
- 部分 metadata
- scheduler events
- desktop/page 等迁移内容

尤其修改：

```text
DocType schema
fixtures
patches
scheduler_events
```

时要考虑 migrate。

官方：

```text
https://docs.frappe.io/framework/user/en/bench/reference/migrate
```

---

## 28. `bench build`

涉及前端 bundle / Vue / assets 时：

```bash
bench build
```

或项目支持时：

```bash
bench build --app my_app
```

不要每次后端 Python 修改都机械执行 build。

---

## 29. `clear-cache`

常见：

```bash
bench --site <site> clear-cache
```

适合元数据或缓存更新后刷新状态。

不要把它当成所有 Bug 的万能修复命令。

---

## 30. Background Jobs

耗时任务不要阻塞正常请求。

```python
frappe.enqueue(
    "my_app.jobs.invoice.process",
    queue="long",
    invoice_name=invoice_name,
)
```

默认队列常见：

```text
short
default
long
```

如果任务依赖当前请求刚提交的数据库变化：

```python
frappe.enqueue(
    "my_app.jobs.invoice.process",
    queue="long",
    enqueue_after_commit=True,
    invoice_name=invoice_name,
)
```

避免 Worker 在事务提交前读取不到数据。

官方：

```text
https://docs.frappe.io/framework/user/en/api/background_jobs
```

---

## 31. Scheduler

hooks.py：

```python
scheduler_events = {
    "hourly": [
        "my_app.tasks.hourly.run"
    ],
    "daily": [
        "my_app.tasks.daily.run"
    ],
}
```

修改 `scheduler_events` 后：

```bash
bench --site <site> migrate
```

---

## 32. Realtime

用于：

- 后台任务进度
- AI/OCR 识别状态
- 批量导入完成通知
- 页面实时刷新

Frappe 提供 realtime / socket.io 能力。

官方：

```text
https://docs.frappe.io/framework/user/en/api/realtime
```

不要为了一个很快的同步请求引入 realtime。

---

## 33. Report 选择

### Report Builder

适合简单报表，不需要写复杂代码。

### Query Report

适合单 SQL 查询。

如果要随 App 维护：

```text
Is Standard = Yes
Developer Mode = enabled
```

会生成 App 中的标准 Report 文件。

### Script Report

适合：

- 复杂计算
- 多步骤查询
- Python 逻辑
- 需要图表、summary 等

标准 Script Report 应作为 App 源代码维护。

官方：

```text
https://docs.frappe.io/framework/user/en/desk/reports/query-report
https://docs.frappe.io/framework/user/en/desk/reports/script-report
```

复杂、耗时、结果相对稳定的 Script Report 可以考虑 Prepared Report。

---

## 34. Print Format 与 Jinja

普通文档 Print Format 使用 Jinja。

开发 App 中的 Standard Print Format 时，可在 Developer Mode 中生成并纳入版本控制。

注意：

```text
Report Print Format
```

和普通 Document Print Format 的模板执行环境不同。

不要把 Report Print Format 的客户端模板写法和普通 Jinja Print Format 混为一谈。

官方：

```text
https://docs.frappe.io/framework/user/en/desk/printing
https://docs.frappe.io/framework/user/en/api/jinja
```

---

## 35. Desk Page

普通 Form / List 不够时，再建自定义 Page。

适合：

- AI 发票匹配台
- 对账台
- 批量处理
- 多 DocType 工作台
- 导入审核
- 异常处理中心

基础：

```javascript
frappe.pages["invoice-ai"].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __("Invoice AI"),
        single_column: true,
    });

    page.set_primary_action(__("Run"), () => {
        // action
    });
};
```

官方：

```text
https://docs.frappe.io/framework/user/en/api/page
```

---

## 36. Vue in Desk Page

当 Page 的状态明显复杂时，再引入 Vue。

例如：

- 多个候选单据
- 筛选
- AI evidence
- loading / error / retry
- 多步骤确认
- 后台任务进度
- 批量选择

官方提供 Vue 挂载到 Desk Page 的方式。

参考：

```text
https://docs.frappe.io/framework/using-vue-inside-a-desk-page
```

原则：

```text
一个按钮 -> 不用 Vue
一个小 Dialog -> 不用 Vue
复杂工作台 -> 可以 Vue
```

---

## 37. Frappe UI

Frappe UI 是面向 Vue 3 的组件和前端数据工具。

适合：

- 组件化复杂前端
- Dialog / Button / Badge / List
- reactive resources
- 独立产品式页面

不适合：

```text
仅仅为了修改 Purchase Invoice 的一个按钮
```

官方：

```text
https://ui.frappe.io/docs/introduction
https://ui.frappe.io/docs/getting-started
```

---

## 38. v16 Desk / Navigation 变化

v16 引入持久 Sidebar 和 Workspace Sidebar。

Migration Notes 还说明：

```text
/apps deprecated
Desk frontend 从 /app 重定向到 /desk
```

因此：

- 不要在业务代码中大量硬编码旧 `/app/...`
- 不要自己重新画 ERPNext 全局 Sidebar
- 使用 Frappe 提供的路由和 Page 机制
- 如果官方示例仍出现旧路径，检查实际 v16 Site 行为

---

## 39. v16 JS 作用域变化

Reports、Dashboard Charts、Pages 的 JS 在 v16 改为 IIFE 方式执行。

不要依赖：

```javascript
some_global = ...
```

这种隐式全局变量。

确实需要全局命名空间时，明确：

```javascript
window.my_app = window.my_app || {};
```

---

## 40. 权限体系

需要理解：

- Role
- DocType Permission
- Permission Level
- User Permission
- `doc.check_permission`
- `permission_query_conditions`
- `has_permission`

`has_permission` hook：

```python
def my_has_permission(doc, user=None, permission_type=None):
    if condition:
        return True
    return False
```

v16 Migration Notes 明确要求允许访问时要显式返回 `True`。

不要依赖旧版非 False / None 的含糊行为。

---

## 41. submitted document

`docstatus`：

```text
0 Draft
1 Submitted
2 Cancelled
```

提交型业务单据必须考虑：

```text
draft
submit
cancel
amend
update after submit
```

不要认为：

```text
文档存在 = 可以随便改字段
```

尤其：

- Purchase Invoice
- Sales Invoice
- Purchase Receipt
- Delivery Note
- Stock Entry
- Payment Entry
- Journal Entry

需要检查对应 ERPNext v16 Controller。

---

## 42. 财务和库存对象禁止直接操作

高风险：

```text
GL Entry
Stock Ledger Entry
Payment allocation
Taxes
Stock valuation
Submitted Purchase Receipt
Submitted Invoice
```

AI 默认禁止：

```python
frappe.db.set_value("GL Entry", ...)
frappe.db.sql("UPDATE `tabStock Ledger Entry` ...")
```

正确方向：

```text
调用 ERPNext 标准业务文档
让标准 submit/cancel/controller 执行副作用
```

如果确实存在官方提供的重算、repost、reconciliation 流程，要使用对应标准接口。

---

## 43. Purchase Invoice / Purchase Receipt 扩展原则

常见 AI 发票场景应该分层。

### 读取候选单据

用权限感知查询：

```python
frappe.get_list(...)
```

### 读取具体单据

```python
frappe.get_doc(...)
doc.check_permission(...)
```

### AI 匹配

AI 只返回：

- 推荐 Purchase Receipt
- item 对应关系
- 数量差异
- 金额差异
- 供应商匹配
- 日期距离
- confidence
- evidence

### 真正写入 ERPNext

服务器重新加载相关文档。

重新验证：

- docstatus
- supplier
- item
- qty
- rate
- taxes
- amounts
- permission

然后使用 ERPNext 标准文档流程创建或更新 Purchase Invoice。

不要让浏览器或 AI 返回的数据直接成为最终财务事实。

---

## 44. Secrets

禁止：

```javascript
const token = "api_key:api_secret";
```

禁止把 Secret 放：

- Git
- 浏览器 bundle
- Client Script
- Page JS
- public JSON
- Debug 页面

外部服务 Secret 应放在服务器端安全配置、环境变量或专门 Secret 管理中。

---

## 45. 日志

服务器错误先看服务器日志。

常见：

```text
logs/web.error.log
logs/worker.error.log
logs/schedule.error.log
sites/<site>/logs/
```

浏览器问题：

```text
Console
Network
Request payload
Response
HTTP status
```

后台 Job 报错不要只看浏览器 Console。

官方：

```text
https://docs.frappe.io/framework/user/en/debugging
https://docs.frappe.io/framework/user/en/logging
```

---

## 46. Bench Console

```bash
bench --site <site> console
```

适合：

- 验证 API
- 查看 DocType meta
- 加载 document
- 调试 query
- 验证 hook

生产环境使用时要谨慎。

---

## 47. 测试

后端：

```bash
bench --site <test-site> run-tests --app my_app
```

重要测试：

- Draft
- Submit
- Cancel
- Permission denied
- Missing data
- Duplicate
- Child Table
- Background Job
- API
- 高风险财务/库存副作用

测试文件：

```text
test_*.py
```

重要业务改动不要只做“点一下页面看能不能跑”。

---

## 48. AI 每次修改前的判断问题

AI 在动代码前必须先回答这些问题：

```text
实际 ERPNext/Frappe 版本是什么？

这个需求影响哪个 DocType？

这是标准 ERPNext DocType 还是 custom DocType？

应该改前端还是后端？

是否应该用 Client Script？
还是 App JS？

是否需要 extend_doctype_class？
还是 doc_events？

是否需要 whitelist API？

用户权限如何处理？

会不会影响 draft/submit/cancel？

会不会影响 GL 或 Stock Ledger？

是否需要 background worker？

是否需要 bench migrate？

是否需要 bench build？

是否需要 export-fixtures？

是否涉及 Secret？

是否用了 v15 或更老的习惯？
```

---

## 49. AI 代码审查清单

出现以下内容时必须停下来检查原因：

```text
ignore_permissions=True
frappe.get_all(...)
frappe.db.set_value(...)
doc.db_set(...)
doc.db_update(...)
frappe.db.sql(...)
frappe.db.commit()
override_doctype_class
override_whitelisted_methods
直接编辑 apps/erpnext
直接编辑 apps/frappe
直接修改 submitted 财务/库存单据
浏览器保存 API Secret
```

它们不是绝对禁止，但都需要明确理由。

---

## 50. Definition of Done

ERPNext 任务完成时，AI 必须给出：

```text
Changed files
Affected DocTypes
Hooks
APIs
Permission impact
Migration command
Build command
Cache command
Tests performed
Accounting/stock impact
Known limitations
```

不要只回复：

```text
已完成。
```

---

# Official Reference Index

```text
Framework
https://docs.frappe.io/framework/

ERPNext
https://docs.frappe.io/erpnext/

Frappe v16 source
https://github.com/frappe/frappe/tree/version-16

ERPNext v16 source
https://github.com/frappe/erpnext/tree/version-16

Migration to v16
https://github.com/frappe/frappe/wiki/Migrating-to-version-16

Installation
https://docs.frappe.io/framework/user/en/installation

Create App
https://docs.frappe.io/framework/user/en/tutorial/create-an-app

Create DocType
https://docs.frappe.io/framework/user/en/tutorial/create-a-doctype

Controllers
https://docs.frappe.io/framework/user/en/basics/doctypes/controllers

Document API
https://docs.frappe.io/framework/user/en/api/document

Database API
https://docs.frappe.io/framework/user/en/api/database

Query Builder
https://docs.frappe.io/framework/user/en/api/query-builder

REST API
https://docs.frappe.io/framework/user/en/api/rest

REST Integration Guide
https://docs.frappe.io/framework/user/en/guides/integration/rest_api

Form API
https://docs.frappe.io/framework/user/en/api/form

Dialog API
https://docs.frappe.io/framework/user/en/api/dialog

Hooks
https://docs.frappe.io/framework/user/en/python-api/hooks

Client Script
https://docs.frappe.io/framework/user/en/desk/scripting/client-script

Server Script
https://docs.frappe.io/framework/user/en/desk/scripting/server-script

Background Jobs
https://docs.frappe.io/framework/user/en/api/background_jobs

Realtime
https://docs.frappe.io/framework/user/en/api/realtime

Page API
https://docs.frappe.io/framework/user/en/api/page

Vue in Desk Page
https://docs.frappe.io/framework/using-vue-inside-a-desk-page

Query Report
https://docs.frappe.io/framework/user/en/desk/reports/query-report

Script Report
https://docs.frappe.io/framework/user/en/desk/reports/script-report

Printing
https://docs.frappe.io/framework/user/en/desk/printing

Jinja
https://docs.frappe.io/framework/user/en/api/jinja

Export Customizations
https://docs.frappe.io/framework/user/en/guides/app-development/exporting-customizations

Bench Migrate
https://docs.frappe.io/framework/user/en/bench/reference/migrate

Frappe UI
https://ui.frappe.io/docs/introduction

Frappe Design
https://frappe.io/design

Espresso
https://frappe.io/design/espresso
```

最后核验：2026-08-12。
