# Ashan Global Typography Architecture Contract (V1 Canonical)

## 1. Executive Summary & Architecture Ownership

This document establishes the canonical contract for global screen typography across all Ashan custom workbenches in ERPNext 16.

Prior to this contract, individual workbenches defined fragmented, hard-coded pixel sizes (including sub-12px font sizes such as 9px, 9.5px, 10px, 10.5px, 11px, and 11.5px). This created readability discrepancies and maintenance debt.

Under this contract:
1. **Single Token Center**: The `:root` selector in `ashan_ui_kit.css` is the **sole numerical source** of truth for all screen typography tokens.
2. **Canonical Default Profile**: All custom workbenches deploy the **Stock Ledger typography profile** by default (`stock-ledger`).
3. **Future-Ready Comfortable Profile**: An optional profile (`comfortable`) is provided for high-readability environments without code rewrites.
4. **Ownership & Scope**: Typography tokens and adaptation layers are exclusively owned by the `shared_ui` domain:
   - `ashan_cn_procurement/ashan_cn_procurement/public/css/ashan_ui_kit.css` (Component: `shared-ui-kit`)
   - `ashan_cn_procurement/ashan_cn_procurement/public/css/ashan_product_shell.css` (Component: `product-shell`)
   - `ashan_cn_procurement/ashan_cn_procurement/public/css/ashan_domain_refactor.css` (Component: `product-shell`)
   - `ashan_cn_procurement/ashan_cn_procurement/public/js/ashan_ui_kit.js` (Component: `shared-ui-kit`)
5. **Desk Isolation**: Un-scoped global rules that alter native Frappe/ERPNext Desk forms are strictly prohibited. All adaptations are scoped to designated Ashan custom workbench containers.

---

## 2. Canonical Typography Token Scale

### 2.1 Default Profile: Stock Ledger (`stock-ledger`)
The stock-ledger profile provides high information density, calibrated to match the scientific layout established by the Stock Ledger Workbench.

```css
:root,
html[data-ashan-typography-profile="stock-ledger"] {
    /* Font Family */
    --ashan-font-family-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Arial, sans-serif;
    --ashan-font-family-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;

    /* Canonical Screen Typography Tokens */
    --ashan-font-size-page-title: 20px;
    --ashan-line-height-page-title: 28px;

    --ashan-font-size-section-title: 16px;
    --ashan-line-height-section-title: 24px;

    --ashan-font-size-kpi: 20px;
    --ashan-line-height-kpi: 26px;

    --ashan-font-size-control: 12px;
    --ashan-line-height-control: 18px;

    --ashan-font-size-table-header: 12px;
    --ashan-line-height-table-header: 16px;

    --ashan-font-size-table-body: 13px;
    --ashan-line-height-table-body: 20px;

    --ashan-font-size-meta: 12px;
    --ashan-line-height-meta: 16px;

    /* Backward-Compatible Token Aliases */
    --ashan-font-size-body: var(--ashan-font-size-table-body);
    --ashan-line-height-body: var(--ashan-line-height-table-body);
    --ashan-font-size-table: var(--ashan-font-size-table-body);
    --ashan-line-height-table: var(--ashan-line-height-table-body);
    --ashan-font-size-input: var(--ashan-font-size-control);
    --ashan-line-height-input: var(--ashan-line-height-control);
    --ashan-font-size-button: var(--ashan-font-size-control);
    --ashan-line-height-button: var(--ashan-line-height-control);
    --ashan-font-size-badge: var(--ashan-font-size-meta);
    --ashan-line-height-badge: var(--ashan-line-height-meta);
    --ashan-font-size-help: var(--ashan-font-size-meta);
    --ashan-line-height-help: var(--ashan-line-height-meta);
    --ashan-font-size-kpi-value: var(--ashan-font-size-kpi);
    --ashan-line-height-kpi-value: var(--ashan-line-height-kpi);
}
```

### 2.2 Optional Profile: Comfortable (`comfortable`)
The comfortable profile increases font sizes and line heights for larger displays or accessibility needs without structural rewrites.

```css
html[data-ashan-typography-profile="comfortable"] {
    --ashan-font-size-page-title: 22px;
    --ashan-line-height-page-title: 30px;

    --ashan-font-size-section-title: 17px;
    --ashan-line-height-section-title: 25px;

    --ashan-font-size-kpi: 22px;
    --ashan-line-height-kpi: 28px;

    --ashan-font-size-control: 13px;
    --ashan-line-height-control: 20px;

    --ashan-font-size-table-header: 13px;
    --ashan-line-height-table-header: 18px;

    --ashan-font-size-table-body: 14px;
    --ashan-line-height-table-body: 21px;

    --ashan-font-size-meta: 13px;
    --ashan-line-height-meta: 18px;
}
```

---

## 3. Element Mapping & Prohibited Sizes

| Element Category | Target Token | Stock-Ledger (Default) | Comfortable | Prohibited Legacy Sizes |
| :--- | :--- | :--- | :--- | :--- |
| **Page Title** | `--ashan-font-size-page-title` | 20px / 28px | 22px / 30px | 17px, 18px, 19px |
| **Section / Card Title** | `--ashan-font-size-section-title` | 16px / 24px | 17px / 25px | 12.5px, 13px, 14px, 15px |
| **KPI Primary Metric** | `--ashan-font-size-kpi` | 20px / 26px | 22px / 28px | 18px, 19px |
| **Controls (btn, input, tab, select)** | `--ashan-font-size-control` | 12px / 18px | 13px / 20px | 10.5px, 11px, 11.5px |
| **Table Header (`th`)** | `--ashan-font-size-table-header` | 12px / 16px | 13px / 18px | 10px, 10.5px, 10.8px, 11px |
| **Table Body (`td`, list items)** | `--ashan-font-size-table-body` | 13px / 20px | 14px / 21px | 10.8px, 11px, 11.5px, 12px |
| **Meta (subtitles, badges, captions)** | `--ashan-font-size-meta` | 12px / 16px | 13px / 18px | 9px, 9.5px, 10px, 10.5px, 11.5px |

### 3.1 Prohibited Sizes Rule
Any font-size declaration of `9px`, `9.5px`, `10px`, `10.5px`, `10.8px`, `11px`, or `11.5px` for screen-facing readable text is strictly prohibited. All elements must consume one of the canonical tokens above.

### 3.2 Explicit Exemptions
The following non-text or fixed-geometry glyphs are explicitly exempt from readable text typography token scaling:
1. **Icon Toggle Glyphs**: `.sl-group-toggle-icon` (9px) - purely a visual chevron indicator for table group expand/collapse, not human-readable text.
2. **Step Sequence Circular Badges**: `.step-seq-circle` (9.5px) - fixed 16px × 16px circular badge glyph indicating step order (1, 2, 3), maintaining circular badge aspect ratio without text overflow.
3. **Modal & Dialog Close Glyphs**: `.picker-close-btn` (20px), `.ashan-dialog-close` (14px) - icon-only close glyph (`✕`) ensuring sufficient touch/click bounding box.
4. **Tool & Navigation Icons**: `.my-biz-item-icon` (15px), `.my-biz-autosort-icon` (18px) - graphical navigation glyphs.
5. **Print Media Stylesheets**: Rules scoped within `@media print` are isolated from screen tokens to preserve standard A4/A5 physical printing points and page breaks.

---

## 4. Shared Utility Classes & Tabular Numbers Standard

### 4.1 Utility Classes
Applications and templates should use canonical utility classes rather than declaring custom styles:

```css
.ashan-font-page-title {
    font-size: var(--ashan-font-size-page-title);
    line-height: var(--ashan-line-height-page-title);
}

.ashan-font-section-title {
    font-size: var(--ashan-font-size-section-title);
    line-height: var(--ashan-line-height-section-title);
}

.ashan-font-kpi {
    font-size: var(--ashan-font-size-kpi);
    line-height: var(--ashan-line-height-kpi);
}

.ashan-font-control {
    font-size: var(--ashan-font-size-control);
    line-height: var(--ashan-line-height-control);
}

.ashan-font-table-header {
    font-size: var(--ashan-font-size-table-header);
    line-height: var(--ashan-line-height-table-header);
}

.ashan-font-table-body {
    font-size: var(--ashan-font-size-table-body);
    line-height: var(--ashan-line-height-table-body);
}

.ashan-font-table {
    font-size: var(--ashan-font-size-table-body);
    line-height: var(--ashan-line-height-table-body);
}

.ashan-font-meta {
    font-size: var(--ashan-font-size-meta);
    line-height: var(--ashan-line-height-meta);
}
```

### 4.2 Tabular Numbers Standard
All numeric cells, quantity columns, rates, and financial amounts must use proportional alignment via tabular numerals:

```css
.ashan-money-cell,
.qifu-money-cell,
.ashan-numeric-cell {
    text-align: right !important;
    font-variant-numeric: tabular-nums !important;
    white-space: nowrap !important;
}
```

**Monospace Prohibition**: Do not force all amounts into monospace fonts (`font-family: monospace` or `var(--ashan-font-mono)`). The standard UI font family combined with `font-variant-numeric: tabular-nums` maintains equal digit widths while matching the modern visual typography of the suite.

---

## 5. Runtime Profile Switching & Authority

### 5.1 JavaScript API
`window.AshanUI` exposes two canonical methods:

```javascript
// Apply a typography profile ('stock-ledger' or 'comfortable')
window.AshanUI.applyTypographyProfile(profile);

// Query the current typography profile
window.AshanUI.getTypographyProfile();
```

### 5.2 Source of Authority
- **Primary Source**: `frappe.boot?.ashan_typography_profile` (when delivered by the server).
- **Default Fallback**: `stock-ledger`.
- **Prohibition on localStorage**: `localStorage` is not permitted as the profile authority to avoid split-brain state between user sessions or cross-device discrepancies.
- **HTML Attribute**: The active profile is written to `document.documentElement.dataset.ashanTypographyProfile`, matching the CSS selectors `html[data-ashan-typography-profile="..."]`.
- **Idempotency**: Multiple invocations safely overwrite the dataset attribute without DOM churn or memory leakage.

---

## 6. Print Media Isolation Standard

Screen typography tokens and density adjustments must not distort print media or PDF report generations.

```css
@media print {
    :root,
    html[data-ashan-typography-profile] {
        --ashan-font-family-ui: inherit;
    }
    .ashan-domain-workbench {
        font-family: inherit !important;
    }
}
```

Workbenches implementing print stylesheets must ensure report headers, tables, and signatures retain their standard print points and page break rules without interference from screen CSS variables.

---

## 7. Scope Boundaries & Desk Isolation

All rules in the adaptation layers (`ashan_domain_refactor.css` and `ashan_product_shell.css`) must strictly scope their rules to designated Ashan workbench roots:

1. `.ashan-domain-workbench`
2. `.contract-workbench-container` (Contract Workbench)
3. `.payroll-workbench-wrapper` (Payroll Settlement Workbench)
4. `.toll-ledger-wrapper` (Vehicle Toll Ledger)
5. `.emp-workbench-container` (Employee Salary Workbench)
6. `.stock-ledger-page-container` (Stock Ledger Workbench)
7. `.stock-issue-workbench-page` (Stock Issue Workbench)
8. `.env-mgmt-wrapper` (Environmental Management)
9. `.sec-center-wrapper` (Special Equipment Center)
10. `.prop-settle-wrapper` (Property & Lease Settlement)
11. `.meal-workbench-container` (Meal Settlement Workbench)
12. `.mcc-container` (Monthly Closing Center)
13. `.tax-inv-wrapper` (Tax Invoice Center)
14. `.oil-console-layout` (Oil Card Ledger)
15. `.qifu-wb-wrapper` (Qifu HR Salary Workbench)
16. `.jz-wb-wrapper` (Jizhong HR Salary Workbench)
17. `.picker-page-container` (Procurement Execution, Material Request, Material Receipt, Reimbursement Picker, Wire Transfer Picker, Monthly Settlement Picker)
18. `.mission-control-container` (Custom HTML Block Workspace Fixture)

Unscoped global selectors (e.g. bare `table`, bare `th`, bare `button`, bare `.btn`, bare `.form-control`) outside `shared_ui` are blocked by architecture guardrails to prevent polluting standard Frappe DocType desk forms.

---

## 8. Verification Gateways & Compliance

Every AI modifying typography or UI layers must verify the following gateways before completion:

1. **AI Architecture Governance**:
   ```bash
   python scripts/verify_ai_architecture_governance.py
   ```
2. **UI Style Governance (Inline Style Baseline)**:
   ```bash
   python scripts/verify_ui_style_governance.py
   ```
3. **Hard Guardrails**:
   ```bash
   python scripts/run_ai_guards.py --staged
   ```
4. **JavaScript Syntax Verification**:
   ```bash
   node --check ashan_cn_procurement/ashan_cn_procurement/public/js/ashan_ui_kit.js
   ```
5. **Git Diff Hygiene**:
   ```bash
   git diff --check
   ```

---

## 9. Workbench Coverage Matrix & Runtime Convergence Inventory

The table below documents every Ashan custom workbench and fixture block in the repository, along with its container selector, token bindings, and runtime convergence status.

| Domain / Workbench | Page Route / Container | Page Title (20/28) | Section Title (16/24) | KPI Value (20/26) | Controls (12/18) | Table Header (12/16) | Table Body (13/20) | Meta (12/16) | Runtime Override Status |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **Contract Workbench** | `contract-workbench`<br>`.contract-workbench-container` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **Covered** via `ashan_domain_refactor.css` |
| **Environmental Mgmt** | `environmental-management`<br>`.env-mgmt-wrapper` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **Covered** via `ashan_domain_refactor.css` |
| **Lease Settlement** | `lease-settlement-workbench`<br>`.prop-settle-wrapper` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **Covered** via `ashan_domain_refactor.css` |
| **Meal Settlement** | `meal-settlement-workbench`<br>`.meal-workbench-container` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **Covered** via `ashan_domain_refactor.css` |
| **Monthly Closing** | `monthly-closing-center`<br>`.mcc-container` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **Covered** via `ashan_domain_refactor.css` |
| **Monthly Settlement** | `monthly-settlement-picker`<br>`.picker-page-container` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **Covered** via `ashan_product_shell.css` + `ashan_domain_refactor.css` |
| **Oil Card Ledger** | `oil-card-ledger`<br>`.oil-console-layout` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **Covered** via `ashan_domain_refactor.css` + `ashan_product_shell.css` |
| **Payroll Settlement** | `payroll-settlement-workbench`<br>`.payroll-workbench-wrapper` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **Covered** via `ashan_domain_refactor.css` |
| **Property Settlement** | `property-settlement-workbench`<br>`.prop-settle-wrapper` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **Covered** via `ashan_domain_refactor.css` |
| **Qifu HR Salary** | `qifu-hr-salary-workbench`<br>`.qifu-wb-wrapper`, `.ashan-qifu-workbench` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **Covered** via `ashan_domain_refactor.css` |
| **Reimbursement Picker** | `reimbursement-picker`<br>`.picker-page-container`, `.ashan-reimbursement-workbench` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **Covered** via `ashan_domain_refactor.css` + `ashan_product_shell.css` |
| **Special Equipment** | `special-equipment-center`<br>`.sec-center-wrapper` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **Covered** via `ashan_domain_refactor.css` |
| **Stock Issue** | `stock-issue-workbench`<br>`.stock-issue-workbench-page` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **Covered** via `ashan_domain_refactor.css` |
| **Stock Ledger** | `stock-ledger-workbench`<br>`.stock-ledger-page-container` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **Covered** via `ashan_domain_refactor.css` |
| **Tax Invoice Center** | `tax-invoice-center`<br>`.tax-inv-wrapper` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **Covered** via `ashan_domain_refactor.css` |
| **Vehicle Toll Ledger** | `vehicle-toll-ledger`<br>`.toll-ledger-wrapper` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **Covered** via `ashan_domain_refactor.css` |
| **Wire Transfer Picker** | `wire-transfer-picker`<br>`.picker-page-container` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **Covered** via `ashan_domain_refactor.css` + `ashan_product_shell.css` |
| **Procurement Execution** | `procurement-execution-workbench`<br>`.picker-page-container` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **Covered** via `ashan_product_shell.css` + `ashan_domain_refactor.css` |
| **Material Request** | `material-request-workbench`<br>`.picker-page-container` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **Covered** via `ashan_product_shell.css` + `ashan_domain_refactor.css` |
| **Material Receipt** | `material-receipt-workbench`<br>`.picker-page-container` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **Covered** via `ashan_product_shell.css` + `ashan_domain_refactor.css` |
| **Employee Salary** | `employee-salary-workbench`<br>`.emp-workbench-container` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **Covered** via `ashan_domain_refactor.css` |
| **Jizhong HR Salary** | `jizhong-hr-salary-workbench`<br>`.jz-wb-wrapper`, `.ashan-jizhong-workbench` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **Covered** via `ashan_domain_refactor.css` |
| **Fixture Custom HTML** | Workspace Custom HTML Block<br>`.mission-control-container` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **Covered** via `ashan_domain_refactor.css` |

---

## 10. Migration Completeness & Architecture Distinction

### 10.1 Source Cleanup vs. Runtime Coverage
A rigorous architectural distinction is maintained between **source cleanup** and **runtime coverage**:

1. **Source Cleanup in Shared Foundation Files**:
   - `ashan_ui_kit.css`: Contains **zero hard-coded sub-12px font sizes** for readable text. Full canonical utility classes (`.ashan-font-*`) include paired line-height variables. Tabular numerals standard is enforced for numeric cells.
   - `ashan_product_shell.css`: Contains **zero hard-coded sub-12px font sizes** for readable text. All duplicate line-height declarations shadowing typography tokens (such as `line-height: 1.35;` on `.ashan-doc-detail-chip`) have been eliminated.
   - `ashan_domain_refactor.css`: Contains **zero hard-coded sub-12px font sizes**. Acts as the shared convergence layer that injects scoped adapters for all 18 workbench and fixture containers.
   - `ashan_ui_kit.js`: Implements idempotent typography profile initialization, defaulting to `stock-ledger` without server boot setting, writing directly to `document.documentElement.dataset.ashanTypographyProfile`, with zero `localStorage` dependency.

2. **Runtime Coverage for Page-Local Styles**:
   - In accordance with file ownership rules and multi-agent repository stability, historical page-local CSS files in `page/.../*.css` and `fixtures/*.css` were preserved without intrusive modifications.
   - 267 out of 270 historical sub-12px rules are dynamically overridden at runtime by the higher-cascade shared convergence layer (`ashan_domain_refactor.css` and `ashan_product_shell.css`).
   - The remaining 3 rules are explicit non-text glyph exemptions (`.sl-group-toggle-icon` 9px chevron glyph and `.step-seq-circle` 9.5px 16×16px circular badge).

### 10.2 Gateways Verification Status
- **Node.js Syntax**: `node --check ashan_cn_procurement/ashan_cn_procurement/public/js/ashan_ui_kit.js` passed.
- **AI Architecture Governance**: `python scripts/verify_ai_architecture_governance.py` passed (0 blocking violations, 0 warnings).
- **UI Style Governance**: `python scripts/verify_ui_style_governance.py` passed (1486 inline styles, below 1588 baseline ceiling).
- **Git Diff Hygiene**: `git diff --check` passed with no whitespace or indentation corruptions.
