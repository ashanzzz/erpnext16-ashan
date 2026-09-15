# 官方文档与源码索引

最后核验：2026-08-24。此表保存入口和适用边界，不复制易过时的实现细节。每次涉及版本敏感 API、权限、Hook、迁移或客户端行为时，打开对应页面并与当前运行源码交叉检查。

## 资料优先级

1. 当前项目 `AGENTS.md`、配置、custom app 和实际站点行为。
2. 当前安装的 Frappe / ERPNext v16 源码与目标 Controller。
3. Frappe / ERPNext 官方文档。
4. 官方 `version-16` 源码仓库和 Migration Notes。
5. 社区文章仅用于定位线索，不能单独作为财务、权限或 API 行为依据。

## Frappe Framework（官方）

| 主题 | 官方入口 | 使用时机 |
| --- | --- | --- |
| DocType 基础 | <https://docs.frappe.io/framework/user/en/basics/doctypes> | 新数据模型、Child Table、命名、Meta |
| Controller 生命周期 | <https://docs.frappe.io/framework/user/en/basics/doctypes/controllers> | `validate` / 提交 / 取消 / 幂等性 |
| Hooks | <https://docs.frappe.io/framework/user/en/python-api/hooks> | `doc_events`、资产注入、`extend_doctype_class`、权限 Hook、迁移 Hook |
| Developer API | <https://docs.frappe.io/framework/user/en/api> | Python `frappe` API、Desk JS、Dialog、Query Builder |
| REST API | <https://docs.frappe.io/framework/user/en/api/rest> | 认证、Resource/RPC、v1/v2 端点核验 |
| 用户与权限 | <https://docs.frappe.io/framework/user/en/basics/users-and-permissions> | Role、DocPerm、User Permission、Page/Report 可见性 |
| 官方 Frappe 源码 | <https://github.com/frappe/frappe/tree/version-16> | 文档不足或行为需精确确认时读取目标 Controller |

## ERPNext（官方）

| 主题 | 官方入口 | 使用时机 |
| --- | --- | --- |
| ERPNext 定制总览 | <https://docs.frappe.io/erpnext/customize-erpnext> | Field、Report、Workflow、Print Format 的低代码边界 |
| 官方 ERPNext 源码 | <https://github.com/frappe/erpnext/tree/version-16> | Purchase / Stock / Accounts / HR 等标准对象行为核验 |
| ERPNext 文档首页 | <https://docs.frappe.io/erpnext/> | 查找当前模块用户文档与版本说明 |

## 查阅规则

- 要添加/调整 Hook 时，先读 Hooks，再打开安装版本的同名实现。
- 要调用或暴露 RPC/REST 时，先读 Developer/REST API，并验证认证、HTTP 方法和权限。
- 要扩展标准单据时，先看版本 16 Controller；不能只参考旧博客或 v14/v15 的示例。
- 要变更可见性、DocPerm 或公司范围时，先读权限文档，再同时审计 UI、DocPerm 和服务端断言。
- 官方文档和当前运行源码冲突时，报告冲突，以当前版本源码和实际测试为准，并在本知识包记录值得长期保留的差异。

