# 架构、权限与安全边界

## 1. 版本与扩展策略

1. 当前项目的 custom app 源码、站点配置和已验证运行行为优先。
2. 其次查看 Frappe / ERPNext `version-16` 对应 Controller 和官方 v16 资料。
3. 默认把新业务放进 `ashan_cn_procurement`；禁止直接改 `apps/frappe` 与 `apps/erpnext` 核心。
4. 优先选择标准 Document 生命周期、Hooks、Desk Page、DocType/Client Script 或 `extend_doctype_class`；v16 允许以 mixin 扩展标准 DocType，优先于完全覆盖。

## 2. Python 服务层

- 遵循 PEP 8；函数有明确 docstring、输入验证和稳定排序。复杂计算改前/后均做语法校验（如 `ast.parse`）。
- 正常文档写入走 `doc.insert()` / `doc.save(ignore_permissions=True)` 等标准生命周期；后一种仅可在已完成角色和公司强校验后使用。
- 所有写入、导入、状态变更、锁定、解锁、审批 RPC 明确用 `@frappe.whitelist(methods=["POST"])`。
- 数据库读取显式指定 `order_by`，避免 v16 下默认顺序与预期不同；优先 `frappe.db.get_list` / Query Builder，慎用 Raw SQL。
- 不用菜单、前端字段禁用或前端筛选当安全控制；服务端才是权威。

## 3. 角色与公司双重收口

每个自定义模块只应有一个管理员/操作员角色对：

| 模块 | 管理员 | 操作员 |
| --- | --- | --- |
| 薪酬 | `Payroll Manager` | `Payroll Operator` |
| 油卡与车辆 | `Oil Card Manager` | `Oil Card Operator` |
| 合规与特种设备 | `Compliance Manager` | `Compliance Operator` |
| 物业与租赁 | `Property Manager` | `Property Operator` |
| 税局发票 | `Tax Invoice Manager` | `Tax Invoice Operator` |

- `System Manager` / `Administrator` 是全局平台身份，不是第三种模块角色。
- `All`、`Desk User`、Accounts、Purchase、Stock、Fleet 等通用身份不能因名字相近而取得自定义模块入口或数据权限。
- 操作员负责日常读取、录入、导入、计算、导出与解锁申请；管理员额外负责配置、删除、封账和解锁审批。没有明确需求时收紧到操作员。
- 页面入口（`Page.roles`）、DocType 权限（DocPerm / Custom DocPerm）和服务端 RPC 三层同时限制。
- 每个携带 `company` 的读取、导入、导出、写入、锁定和审批在服务端调用 `assert_company_access()`；不可只依赖前端公司筛选。
- 新接口首选 `assert_module_access()`；薪酬、油卡使用专用 `assert_payroll_access()` / `assert_oil_ledger_access()`。

## 4. 统一薪酬状态机

薪酬状态只认 `PAYROLL_WORKFLOW_POLICY`：

```text
草稿 → 已计算 → 凭证核验通过 → 已封账
                         ↓
               解锁申请中 → 已解锁 → 已计算
```

- 角色判断、状态迁移、必填原因和审计字段均从同一策略读取。
- 禁止在页面或遗留 API 另建更宽松的状态机。
- 封账为管理员权限；解锁申请要求原因；审批解锁要求可审计的原因和操作者。

## 5. 前后端职责

- 前端负责引导、即时校验、草稿与可解释展示；后端负责权限、公司范围、来源文档、金额、行项目、状态和最终写入。
- `frappe.call` / `frm.call` 之前先考虑 API 的读写性质；写操作必须 POST，错误返回要保留可理解的恢复信息。
- 客户端脚本仅在目标 DocType 或目标 Desk Page 加载，不在全 Desk 重复注册。
- 全局 JS 不污染作用域；自定义页面使用闭包管理状态，关闭弹窗时清理临时 DOM 与事件。

## 6. 数据、秘密和源文件

- 所有密码、Token、连接串只从 `.env` 或合规秘密管理读取；不可写进源码、脚本、插件或示例。
- 身份证、电话、工资等真实个人资料不进 Git；示例使用 `*.example.json`，真实文件限于私有目录或运行环境。
- 上传源文件不可被生成文件覆盖；删除、覆盖、迁移历史数据属于高风险操作，必须先确定精确范围并取得授权。

## 7. 财务/库存的高风险操作

- AI 可以推荐候选 Purchase Receipt / Invoice、计算匹配依据、提示异常；不能直接把建议当最终凭证事实。
- 保存前，后端必须重新加载目标 ERPNext Document，复查 docstatus、供应商、金额、项目行与权限，再调用标准流程。
- 已提交 Document 不做直接字段改写；使用合法的提交、取消、修订或业务工作流。

