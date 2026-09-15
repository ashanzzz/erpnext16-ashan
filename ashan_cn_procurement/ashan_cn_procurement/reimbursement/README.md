# 报销功能包

这是 `ashan_cn_procurement` 内唯一的报销功能开发入口。后续报销需求只修改此包及下列 Frappe 必须保留的元数据文件，不触碰采购税务、油卡或受限单据功能。

## 业务边界

- 从已提交、未付的采购发票选择可报销明细。
- 保存草稿后保留来源明细占用，避免重复导入。
- 报销单提交时由服务器重新校验来源发票、金额和占用。
- 付款使用标准 Payment Entry；不得直接创建 GL Entry 或自动提交付款。

## 文件地图

| 目的 | 位置 | 后续修改约定 |
| --- | --- | --- |
| 主单元数据与表单 UI | `doctype/reimbursement_request/` | 只放报销单字段、Controller、Form Script。 |
| 明细子表 | `doctype/reimbursement_invoice_item/` | 来源快照、金额和说明字段。 |
| 未付款清单 | `report/unpaid_reimbursement_list/` | 仅报销候选与待付视图。 |
| 付款状态报表 | `report/reimbursement_payment_status/` | 仅基于实际 Payment Entry 状态。 |
| 领域服务 | `reimbursement/service.py` | 候选查询、草稿占用、提交校验、状态同步。 |
| HTTP / RPC 入口 | `reimbursement/api.py` | 只放带权限检查的白名单方法。 |
| 自动化测试 | `reimbursement/tests/` | 覆盖草稿、提交、取消、重复导入和权限。 |
| 产品设计 | `docs/designs/reimbursement_unpaid_invoice_v16_design.md` | 修改流程或 UI 前先更新。 |

## 开发规则

1. 先修改本包的服务和测试，再修改 Form Script / Dialog。
2. 采购发票行只读取原生 `description`（Data）；不创建或读取规格型号字段。
3. 所有写入、占用和提交检查必须在服务器端完成；客户端只负责交互。
4. 使用 `frappe.get_list` 和 `Document.save()` / `insert()`，不使用 SQL 或 `ignore_permissions=True` 绕过业务规则。
5. 本功能的部署仍遵循项目工作流：本地修改、热同步到 v16、验收后再推送 GitHub。

## 当前状态

已完成 8888 参考站的复盘与 v16 设计，见 `docs/designs/reimbursement_unpaid_invoice_v16_design.md`。未付款发票选择弹窗、草稿占用和 Payment Entry 关联仍未实现，将以本包为唯一实现位置。
