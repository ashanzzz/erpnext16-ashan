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
- The current workspace sidebar contains nine business groups: `采购与报销`, `仓库与库存`, `销售与收款`, `财税与结算`, `祺富人事薪酬`, `吉众人事薪酬`, `物业与租赁`, `车辆与用油`, and `企业合规`.
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
3. Open `采购与报销`
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


## Approved Sidebar Accordion Design Contract (2026-10-17 Final Approval)

- **Approved visual direction**: 方案 1 · 无界蓝光精研风 (Ultra-Clean Blue Pulse).
- **Physical Indentation**: Strict 16px stepped indentation for child navigation items (`padding-left: 16px`), completely eliminating clumsy heavy borders and redundant guide lines.
- **Active Child Indicator**: 4px brand blue pulse dot (`.ashan-pulse-dot` / `::before`), with `box-shadow: 0 0 6px rgba(37, 99, 235, 0.5)` preceding the label text.
- **Active Child Styling**: 极简无界无外框 (Frameless & Border-free). Completely eliminated outer border box and background rectangle (`background: transparent; border-color: transparent;`). Focus is achieved purely through the 4px brand blue pulse dot and deep blue text (`#1d4ed8`, font-weight 700), maintaining an ultra-clean, serious financial/industrial aesthetic.
- **Parent Rollup Task Badge (Bubble-up Aggregation)**: Aggregated pending count from all child items bubbled up to the parent section header, placed between the title and the chevron arrow (`margin-left: auto; margin-right: 8px;`). Remains visible in both expanded and collapsed states to eliminate the "collapsed information black hole".
- **Badge Content Standard**: Pure numbers only (e.g. `4`, `99+`), strictly no Chinese units like "笔/个/项". Tabular numbers (`tabular-nums`), amber pill (`#fffbeb` background, `#b45309` text, `1px solid #fde68a` border, `height: 18px`, `border-radius: 999px`).
- **Zero Layout Shift (0px Shift)**: Pre-allocated `1px solid transparent` border on all items; strictly no `translateY` transforms on vertical navigation rows.
- **Typography Scale**: Standardized `13px` (Control 13/20) for both section headers and child item labels, ensuring high information density and effortless visual scanning.
- **Collapsed 64px Rail Flyout**: Standard 13px font size with direct click-through action.


### Company Boundary Principle: HR Absolute Isolation vs Native Multi-Company

- **HR / Payroll Domain (专属物理与模型隔离)**:
  - Applicable to: Qifu HR (`qifu-hr-salary-workbench`) and Jizhong HR (`jizhong-hr-salary-workbench`).
  - Reason: Fundamental divergence in business logic (workshop 68-col piecework vs office 5-row punch card matrix, rest-day 2x deduction, 1:1 VBA tax reversal, cash denomination split).
  - Architecture: Dedicated independent DocTypes, workbenches, and calculation engines. Cross-company inheritance of templates or calculations is strictly forbidden.

- **All Other Modules (原生多公司共享架构，拒绝过度设计)**:
  - Applicable to: 采购与报销 (Procurement & Reimbursement), 仓库与库存 (Stock & Inventory), 销售与收款 (Selling), 财税与结算 (Accounts), 车辆与用油 (Vehicle & Fuel), 物业与租赁 (Property & Lease).
  - Reason: Identical transactional models across both companies.
  - Architecture: Reuses ERPNext 16 native `Company` field, User Permissions, and unified workbenches. The top-left Company Selector filters data dynamically in-place without duplicating separate UI pages.


### Strict Single-Line Tabular Standard: Rejection of Two-Line Descriptions (严格单行排版 · 坚决拒绝双行描述)

- **Hard Rule (铁律)**: 严禁将物料代码、物料名、规格压缩在同一个单元格的双行描述中！必须严格拆分为 3 个独立的物理标准列：
  1. **`物料代码`**：独立单行，等宽字体（`font-mono`，如 `ITEM-2026-081`），支持独立排序、精准筛选、双击快速复制；
  2. **`物料名`**：独立单行，标准字重（如 `高精密压力轴承`）；
  3. **`规格`**：独立单行，次级灰字（如 `P4级 / 耐磨增强型`）。
- **Single-Line Rhythm (行高律动)**:
  - 单元格固定单行垂直居中，行高严格锁定在 `34~36px`；
  - 严禁折行导致行高参差不齐，严禁换行符（`\n`）污染 Excel/CSV 导出；
  - 文字超出单元格宽度时一律单行省略截断（`text-overflow: ellipsis; white-space: nowrap;`）并配备原生 `title` 气泡。
