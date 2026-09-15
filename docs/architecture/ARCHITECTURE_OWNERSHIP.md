# Architecture Ownership

本文件是人类可读版本。机器以 `.agents/architecture/ownership.json` 为准。

## 核心原则

现有结构拥有优先权。普通 AI 功能任务默认只有“修改权”和“局部增加权”，没有“创建新架构的权力”。

### 共享 UI

唯一共享 UI 基座：

- `public/css/ashan_ui_kit.css`
- `public/js/ashan_ui_kit.js`
- `public/css/ashan_product_shell.css`
- `public/js/ashan_product_shell.js`
- `public/css/ashan_domain_refactor.css`
- `public/js/ashan_domain_refactor.js`

禁止新增 `common_ui.js`、`ui_utils.js`、`design_v2.css`、`better_table.css` 等平行公共层。

### 权限

自定义业务模块：

- `services/authorization_service.py`

SQL 读模型和标准 DocPerm 过滤：

- `services/permission_query_service.py`

禁止页面、Page Python、业务 Service 再创建第二套 role map、company access、`is_*_manager()`。

### 采购

采购申请、订单、入库、发票、付款优先：

- `public/js/procurement_workbench.js`
- `public/css/procurement_workbench.css`
- `services/procurement_picker_service.py`
- `services/monthly_settlement_service.py`

新采购阶段优先扩展 profile/stage，不复制整个 Workbench。

### 工资

祺富和吉众业务算法保持隔离。共享的是 UI、权限和基础工具，不共享企业特定工资规则。

### 任务

跨模块任务唯一后端读模型：

- `services/task_hub_service.py`

页面自己的步骤提示可以存在，但不得再创建第二个全局 Task Hub。

## 新架构两阶段审批

需要新增以下对象时：

- 新 Service
- 新共享 JS/CSS
- 新 Desk Page
- 新 DocType
- 新 Report
- 新 Workspace
- 新 whitelist API
- 新 hooks/scheduler
- 新依赖

必须先单独提交“架构审批变更”，把对象登记进 registry 或 exception。

该审批合并到 `main` 后，第二个 PR 才能写实现。

**同一个 PR 同时改 registry 和实现会失败。**

这样弱 AI 无法自己给自己批准。
