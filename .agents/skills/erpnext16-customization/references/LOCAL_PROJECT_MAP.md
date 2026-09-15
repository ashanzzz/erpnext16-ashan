# 本地项目地图与事实源

在 `erpnext16` 仓库中，优先从下列位置定位真实实现，不要凭知识包猜文件名或调用约定。

| 需求 | 首要位置 |
| --- | --- |
| 总原则、财务边界、交付铁律 | 项目根 `AGENTS.md` |
| ERPNext 基础学习、API、UI、业务规则 | `docs/ai/ERPNext16_LEARN.md`、`ERPNext16_API_MAP.md`、`ERPNext16_UI_GUIDE.md`、`ERPNext_PROJECT_RULES.md` |
| 模块设计和风格记忆 | `docs/ai/ASHAN_APP_MODULES_AND_DESIGN_GUIDE.md` |
| UI 令牌与共享组件 | `ashan_cn_procurement/ashan_cn_procurement/public/css/ashan_ui_kit.css` |
| UI 公共行为 | `ashan_cn_procurement/ashan_cn_procurement/public/js/ashan_ui_kit.js` |
| CSS/JS 资源版本 | `ashan_cn_procurement/ashan_cn_procurement/hooks.py` |
| UI 内联样式治理 | `scripts/verify_ui_style_governance.py` 与 `ashan_cn_procurement/ui_style_baseline.json` |
| 模块、角色、公司范围与薪酬状态机 | `ashan_cn_procurement/ashan_cn_procurement/services/authorization_service.py` |
| 自定义字段、属性设置、业务注册 | `ashan_cn_procurement/ashan_cn_procurement/setup.py`、`custom/` 与 `hooks.py` |
| 页面实现 | `ashan_cn_procurement/ashan_cn_procurement/ashan_cn_procurement/page/` |
| 报销申请中心、草稿与发票联锁 | `ashan_cn_procurement/ashan_cn_procurement/ashan_cn_procurement/page/reimbursement_picker/`、`services/reimbursement_picker_service.py`、`reimbursement/` |
| 月结入库与自办电汇工作台 | `page/monthly_settlement_picker/`、`services/monthly_settlement_service.py`、`page/wire_transfer_picker/`、`services/wire_transfer_service.py` |
| Doctype 实现 | `ashan_cn_procurement/ashan_cn_procurement/ashan_cn_procurement/doctype/` |
| Playwright 验收与业务回归 | `scripts/`、`scratch/`、项目根 `test_*` / `verify_*` 文件 |

## 已有共享能力

- CSS：卡片、状态、提示、文件标签、金额单元格、保存状态、账期导航、实体 Tab、按钮、弹窗、智能表格、建议下拉、关闭和草稿按钮。
- JS：`formatMoney`、`createSaveIndicator`、`renderPeriodSelector`、`renderEntityTabs`、`bindGlobalHotkeys`、`enableMousewheelHorizontalScroll`。
- 鉴权：`assert_module_access`、`assert_company_access`、`assert_payroll_access`、`assert_oil_ledger_access` 与统一 `PAYROLL_WORKFLOW_POLICY`。
- 字段事实源：采购/报销的 `custom_biz_mode`、`custom_doc_details` 定义于 `setup.py`；车辆字段由 `setup_vehicle_custom_fields()` 定义；现存报销属性设置在 `custom/reimbursement_*.json`。详情见字段目录。

## 读取顺序

1. `AGENTS.md`
2. `docs/ai/ERPNext_PROJECT_RULES.md`
3. 目标模块源码与其服务层
4. 按需打开 `docs/ai/ERPNext16_LEARN.md`、API Map、UI Guide、模块设计文档
5. 当前 Frappe / ERPNext v16 Controller
6. `OFFICIAL_DOCUMENTS.md` 指向的官方页面
