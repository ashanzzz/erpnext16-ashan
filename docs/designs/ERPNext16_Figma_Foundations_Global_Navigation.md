# ERPNext 16 Figma Foundations + Global Navigation

- Revision date: 2026-09-22
- Product: Ashan ERPNext 16 custom app
- Design source: current ERPNext 16 Desk plus `ashan_ui_kit.css`, `ashan_product_shell.css`, `ashan_cn_sidebar_v2.js`
- Current reference page: `采购执行`
- Design status: review-ready foundation, not yet a production UI change

## Purpose

This package is the Figma-ready design contract for the ERPNext 16 shell and global navigation. It does not invent a second sidebar, menu, permission model, company scope, or UI kit. It describes the visual states that the existing Frappe-native sidebar must support.

## Current system facts used in the design

- The live Desk shell currently exposes `我的业务（总控主页）`, search, notification center, a company selector, and the business navigation.
- The current workspace sidebar contains nine business groups: `采购与供应链`, `仓库与库存`, `销售与收款`, `财税与结算`, `祺富人事薪酬`, `吉众人事薪酬`, `物业与租赁`, `车辆与用油`, and `企业合规`.
- The current custom runtime uses one expanded section at a time, persists the open section, highlights the active child route, and renders task-count badges.
- The current oil-card board is a business reference for four-pillar conservation, pure input/output columns, period locking, and ledger-first information density. It is not a generic page template for payroll or procurement.

## Source-of-truth contract

| Layer | Source | Rule |
|---|---|---|
| Product facts | live Desk and existing workspace/sidebar JSON | Do not invent labels or routes |
| Visual tokens | `ashan_ui_kit.css` | Figma Variables mirror the existing token names |
| Global sidebar behavior | `ashan_cn_sidebar_v2.js` | Extend the current owner; do not create a parallel sidebar runtime |
| Sidebar styling | `ashan_product_shell.css` | Keep the selector boundary under `.body-sidebar` |
| Domain UI | Existing page CSS/JS | Do not move procurement, payroll, oil-card, or compliance rules into the shell |
| Business data | existing services and DocTypes | Figma does not redefine permissions, company filters, or calculations |

## Figma file structure

Use a Figma project named `Ashan ERPNext 16` with these files or pages:

1. `00 Foundations`
2. `01 Frappe Native Shell`
3. `02 Global Navigation`
4. `10 Procurement`
5. `20 Inventory`
6. `30 Finance & Tax`
7. `40 Payroll - Qifu`
8. `41 Payroll - Jizhong`
9. `50 Vehicle & Oil Card`
10. `60 Property & Compliance`
11. `90 Prototype & Acceptance`

The global shell and navigation must be approved before redesigning each domain page. Domain files may consume the component library, but must not redefine the global navigation component.

## Required Foundations

### Color variables

Use the existing Ashan token families:

- Brand/action: `blue-800`, `blue-700`, `blue-600`, `blue-200`, `blue-50`
- Neutral: `slate-950`, `slate-700`, `slate-500`, `slate-300`, `slate-200`, `slate-50`
- Status: success, warning, danger text/background/border triples
- Navigation: sidebar background, active background, active text, active rail, sub-line, and task-count badge

Do not add a second brand blue or a dark navigation palette until a separate approved visual direction exists.

### Typography variables

- Page title: 22/30, 700
- Section title: 17/25, 700
- Control: 13/20, 600
- Table body: 14/21, 400
- Meta: 13/18, 400
- Numeric and monetary data use tabular numerals and keep the existing unit/currency rules.

### Geometry variables

- 4px base spacing rhythm
- Existing radius: 6px, 8px, pill
- Expanded navigation reference: 216px
- Collapsed navigation design target: 64px
- Section row: 34px
- Child row: 30px
- No fixed viewport assumptions inside domain pages

## Global Navigation components

Create these Figma components with explicit variants:

- `Workspace Header / Default / Active`
- `Global Search / Default / Focus / Keyboard Hint`
- `Notification Center / Default / Has Count`
- `Business Section / Closed / Open / Active Child`
- `Business Child / Default / Hover / Active / Disabled`
- `Task Count / Zero / 1-99 / 99+`
- `Sidebar / Expanded / Collapsed`
- `Collapsed Rail / Default / Active / Hover / Tooltip`
- `User Footer / Default / Menu Open`
- `Company Selector / All Companies / Specific Company`

## Company context placement

- Expanded sidebar: place the shared company context in a sticky footer at the lower-left, immediately above the user footer.
- The footer shows `所属公司`, the active company value, and a restrained `编辑` action. It must not look like a KPI card or lifecycle badge.
- Collapsed sidebar: show a compact company context control using `全` for all companies or a short company identifier; expose the full company name through an accessible tooltip/popover.
- Use the existing `AshanWorkContext` owner. Do not create a second localStorage key or page-specific global company context.
- The global context is a default and navigation context only. Payroll, statutory, posting, and other company-sensitive actions must continue to show and validate the explicit company at page/action level.
- Company switching must preserve route and scroll position and update the active data region without a full page rebuild where the current page supports it.
## Navigation states to prototype

1. Default Desk load
2. Active `采购执行`
3. Open `采购与供应链`
4. Switch to `仓库与库存`
5. Collapse sidebar while the active route remains visible
6. Hover a collapsed icon and show a non-destructive label tooltip
7. Keyboard focus on a section and child link
8. Task count values `0`, `4`, and `99+`
9. Module hidden by permission
10. Long Chinese label and narrow laptop viewport
11. Route change with no full-page jump
12. Rehydrate after browser reload using the current persisted open-section behavior

## Oil-card relationship

The oil-card board is the reference for business seriousness, ledger density, four-pillar conservation, input/output separation, and period locking. It is consumed as a domain pattern by `50 Vehicle & Oil Card`.

It must not be copied mechanically to:

- Qifu payroll
- Jizhong payroll
- procurement workbench
- compliance records

Those domains remain physically and behaviorally separate while consuming the shared foundations and approved shell components.

## Design-to-code acceptance

Before production implementation:

- Every Figma component has a current DOM owner.
- Every new token maps to an existing `--ashan-*` token or is approved before adding one.
- No new page-level money formatter, permission helper, company context, sidebar runtime, or inline style is introduced.
- Expanded and collapsed states have separate prototype frames.
- The design is checked at 1366px and 1920px Desk widths.
- Playwright captures the real Desk page after implementation and compares shell, active route, section expansion, count badge, keyboard focus, and collapsed navigation.

## Package files

- `erpnext16_figma_foundations_tokens.json`: Figma/Tokens Studio-ready variables aligned with current UI kit tokens.
- `erpnext16_figma_foundations_global_navigation.svg`: importable visual board for Figma review.
- `erpnext16_figma_foundations_global_navigation.html`: browser prototype with foundation tokens, current menu labels, expanded state, and collapsed state.
- `current_erpnext_sidebar_reference.png`: real Desk reference captured from the configured ERPNext 16 site.
