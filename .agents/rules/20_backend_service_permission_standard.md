# 后端服务、权限和数据完整性强制规范

## 权限类型
ERPNext 标准 DocType 优先：
- `frappe.has_permission()`
- `doc.check_permission()`
- 标准 DocPerm
- 标准 Workflow/lifecycle

自定义业务模块优先 `services/authorization_service.py`。

## 统一授权入口
自定义模块：
`assert_module_access(module, action, company=company)`

薪酬：
`assert_payroll_access(action, company=company)`

油卡：
`assert_oil_ledger_access(action, oil_card=oil_card)`

公司：
`assert_company_access(company)`

禁止自定义模块新增平行 role map，除非现有 service 无法表达并有明确架构理由。

## Company
API 只要接收或可推导 company，就必须服务端验证。

禁止：
- 浏览器传 company 后直接相信
- 查全公司数据后只靠前端过滤
- 因为有模块角色就默认全公司

## 用户触发写操作顺序
1. parse input
2. authorize action
3. authorize company/document
4. validate current state
5. load authoritative docs
6. domain validation
7. standard lifecycle
8. stable response

禁止先写数据再查权限。

## ignore_permissions
新代码默认禁止 `ignore_permissions=True`。

例外必须：
- 已显式完成服务端授权
- 标准 permission-respecting lifecycle 无法满足
- 有注释 `AI-GOVERNANCE-EXCEPTION: ignore_permissions <reason>`
- 有 denied-role 测试

旧代码可增量迁移。

## db.set_value
只适合明确派生缓存或技术字段。
修改业务关键字段时优先 `doc.save()`，否则必须说明为何绕 controller。

## Raw SQL
只在复杂聚合或明确性能需求使用。
必须参数化、company scoped、权限已确认、明确排序，并有 limit/时间范围。

禁止用户输入字符串拼接 SQL。

## 余额
余额算法必须只有一个权威实现。
例如油卡 `opening + submitted recharge - submitted refuel`。

如果存 current_balance 缓存，必须能从权威流水重建，并在新增、取消、删除等相关事件统一更新。

浏览器不得传入最终余额作为权威值。

## Mutation API
新状态修改 endpoint 使用：
`@frappe.whitelist(methods=["POST"])`

旧 API 为兼容可以暂留，但新功能不复制 GET mutation。

## Service 和 Page Python
复杂领域逻辑优先 `services/<domain>_service.py`。
Page `.py` 只保留页面 read model、thin adapter 和少量 UI metadata。

同一个 mutation service 不因不同 Page 而复制。

## 标准生命周期
采购、库存、会计等关键单据使用 `new_doc/get_doc/insert/save/submit/cancel`。

禁止：
- 手工改 docstatus
- 直接写 GL Entry
- 直接写 Stock Ledger Entry
- 浏览器直接写业务表
- 用 db_set 模拟完整提交

## Transaction
普通 HTTP mutation 由 Frappe 管理事务。
新代码默认禁止 `frappe.db.commit()`。

例外使用：
`AI-GOVERNANCE-EXCEPTION: db_commit <reason>`

并说明恢复策略。

## 幂等
生成下游单据、支付、入库、批量关联、导入、后台任务、封账必须服务端防重复。

可使用 existing-linked-doc check、unique key、source operation id、workflow state 或 deterministic upsert。

前端 disabled 不算后端幂等。

## Scheduler
新的 scheduler handler 必须可重复执行、有明确范围、不假设上次成功、不产生重复业务结果。
