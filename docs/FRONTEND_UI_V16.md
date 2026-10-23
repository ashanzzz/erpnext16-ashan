# Frontend and Sidebar Standard — ERPNext / Frappe v16

## Purpose

This app follows the Frappe v16 Desk navigation model. The active sidebar is a normal `Workspace Sidebar`; JavaScript may add badges, current-company controls and active highlighting, but it must not replace Frappe's native section open/close behavior.

## Single sources of truth

- Sidebar content: `ashan_cn_procurement/ashan_cn_procurement/workspace_sidebar/home.json`
- Sidebar behavior: `public/js/ashan_cn_sidebar_v2.js`
- Sidebar styling: `public/css/ashan_sidebar_v16.css`
- Cross-workbench final visual layer: `public/css/ashan_native_v16.css`
- Table title/width API: `docs/TABLE_COLUMN_API.md`

Do not create a Client Script that injects a second sidebar. Do not create a dashboard Custom HTML Block to reproduce navigation.

## Current menu

The maintained navigation uses text labels and Frappe icons. Decorative emoji are not used. Numeric badges are allowed for actionable pending counts.

The main sections are:

1. 我的业务
2. 采购与报销
3. 仓库与库存
4. 销售与收款
5. 财税与结算
6. 祺富人事薪酬
7. 吉众人事薪酬
8. 物业与租赁
9. 车辆与用油
10. 企业合规

## Legacy routes

`employee-salary-workbench` and `payroll-settlement-workbench` are compatibility routes only. They redirect to the maintained company-specific salary workbench and must not regain independent UI or business logic.

## Visual rules

- Prefer Frappe semantic variables such as `--bg-color`, `--fg-color`, `--control-bg`, `--border-color`, `--text-color`, and `--text-muted`.
- Use low or no shadow for operational tables and cards.
- Keep controls compact. Default custom table text is 13px; headers are 12px/600.
- Use Frappe `btn`, `form-control`, and `frappe.ui.Dialog` before inventing custom equivalents.
- Do not encode state with emoji. Use text plus Frappe indicator colors/classes.
- Keep business tables structurally unchanged unless a business requirement demands a schema change.
- Column title/width customization must use `AshanTableColumns`; do not add one-off CSS widths per page.

## Migration cleanup

`setup.after_migrate()` removes only the app-owned legacy records:

- Ashan Sidebar Oil Card Script
- Ashan Sidebar User Script
- Ashan Sidebar Workspace Script
- Custom HTML Block `业务场景导航`

No arbitrary user Client Script or Custom HTML Block is deleted.

## 2026-10-22 采购与报销工作台收敛

采购与报销域已经统一为 Frappe v16 原生 PageHeader。公司上下文只由左侧 Sidebar 控制，工作台内部不再提供第二套公司下拉框。正文顶部的大标题卡片、阶段说明 Banner 和重复“新建”按钮已退役。详细规范见 `docs/PROCUREMENT_UI_V16_REFACTOR.md`。
