# 当前代码复用目录

## 共享 UI
`public/css/ashan_ui_kit.css`
先查卡片、状态、金额、语义列宽、callout、save indicator、period navigator、entity tabs。

`public/js/ashan_ui_kit.js`
先查：
- `AshanUI.formatMoney`
- `AshanUI.createSaveIndicator`
- `AshanUI.renderPeriodSelector`
- `AshanUI.renderEntityTabs`
- `AshanUI.bindGlobalHotkeys`
- `AshanUI.enableMousewheelHorizontalScroll`
- `AshanUI.formatDocStatus`

## 工作上下文
`public/js/ashan_work_context.js`
多公司 Workbench 先检查它，不再创建第二套 company global/localStorage context。

## 采购
- `public/js/procurement_workbench.js`
- `public/css/procurement_workbench.css`
- `services/procurement_picker_service.py`

现有阶段至少包括：
`item_to_mr`、`mr_to_po`、`po_to_pr`、`pr_to_pi`、`pi_to_rr`、`pi_to_pay`。

新采购 Page/阶段先判断能否扩展 profile/stage，不创建 `procurement_*_v2`。

## 权限
`services/authorization_service.py`
已有 module/company/payroll/oil-card 权限能力，是自定义模块首选。

## Hooks
`hooks.py` 已有 global assets、role home、doctype JS、list JS、doc events、scheduler、after_migrate。

新增前读取对应 section，禁止重复注册。

## DocType 客户端脚本
当前已有 Purchase Invoice、Reimbursement Request、Vehicle Form JS，以及 Material Request、Purchase Order、Purchase Receipt、Purchase Invoice、Reimbursement Request List JS。

对相同 DocType 新增行为先扩展现有 script，不通过第二个 global include 注入。

## 油卡
`page/oil_card_ledger/*` 是业务来源，但不是新 UI 模板。
新增代码向共享 UI、统一授权、无 inline style 方向收敛。

## 薪酬
已有薪酬 Workbench 和 payroll engine。
搜索时同时检查 Page、service、engine、authorization、company filter、tests。
不能只看前端表格决定算法。

## Workspace/sidebar
新增入口先查 workspace、workspace_sidebar、sidebar JS 和 setup/migration 同步逻辑，避免同一功能出现两个入口。
