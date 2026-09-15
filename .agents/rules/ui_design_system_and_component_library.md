# UI Design System and Component Library

## 1. Product design model

The target UI is **Frappe-native Operational SaaS**.

It is not an Odoo clone and it is not a GitHub clone.

Use Frappe Desk as the application foundation. Reuse its Form, List, Report, Workspace, Page, routing, permissions, dialogs, notifications, and document lifecycle.

Borrow only useful interaction principles from mature enterprise systems:

- From Odoo: clear module hierarchy, task-oriented workspaces, strong context between record and workflow
- From GitHub Primer: predictable components, calm visual hierarchy, dense tables, explicit states, progressive disclosure, strong keyboard and accessibility behavior
- From modern enterprise SaaS: semantic design tokens, consistent empty/loading/error states, restrained surfaces, measurable interaction rules

The UI must look like one Ashan product, not a collection of generated pages.

## 2. Page archetypes

Every new page must declare one primary archetype before UI code is written.

### A. Workspace / Module Home

Use for navigation and module status.

Show:

- Module identity
- A small set of meaningful KPI or exception summaries
- Current work requiring attention
- Primary shortcuts
- Recent or important operational items

Do not turn the home page into a wall of charts.

### B. List / Ledger

Use for scanning, filtering, comparison, reconciliation, and audit.

Default to a real table or Frappe List/Report.

Use:

- Stable column order
- Sticky header when needed
- Right alignment and tabular numerals for numbers
- Explicit unit/currency
- Sortable columns when useful
- Consistent filter placement
- Row action menu for secondary actions
- Bulk actions only after selection

Do not turn every row into a card.

### C. Record / Form

Use for creating and editing one business document.

Prefer the native Frappe Form and lifecycle.

Group fields by business meaning rather than database order.

Keep primary action semantics consistent with Frappe.

### D. Review / Approval

Use when the main task is checking evidence and making a decision.

Show:

- What is being decided
- Current status
- Important exceptions
- Source evidence
- Differences or validation results
- Approve/reject or submit/cancel actions

High-risk actions must not be disguised as passive controls.

### E. Workbench / Command Center

Use only when users must coordinate multiple DocTypes, bulk operations, reconciliation, imports, exception handling, or operational monitoring in one context.

A custom Desk Page is appropriate here.

A workbench is not an excuse to reimplement standard Forms and Lists.

### F. Settings / Administration

Use standard Frappe settings patterns when possible.

Separate configuration from daily operational actions.

## 3. Technology choice

Use this order:

```text
Frappe Form / List / Report / Workspace
then Form Script / List Script / Dialog
then Frappe Desk Page
then Vue in Desk Page for genuinely complex reactive state
then independent frontend only with explicit approval
```

Do not start with Vue because a feature is visually complex.

Do not start with raw HTML because a native control exists.

## 4. Application shell

The application should have one navigation model.

Use:

- Existing Frappe Desk shell
- One permission-aware module/sidebar hierarchy
- Frappe route state
- Page header for current task
- Breadcrumb/context only when it adds orientation

Do not add a second permanent sidebar inside normal pages.

Do not add a second global top navigation.

Do not create page-specific visual shells that change the product identity.

## 5. Design tokens

Shared visual values belong in:

`ashan_cn_procurement/ashan_cn_procurement/public/css/ashan_ui_kit.css`

New page code must consume semantic tokens instead of inventing local colors and spacing.

Preferred semantic token families:

```text
surface
canvas
text-primary
text-secondary
border
brand
action-primary
focus
success
warning
danger
info
spacing
radius
control-height
font-size
shadow
z-index
```

Existing Ashan tokens should be reused and gradually normalized into semantic aliases.

Feature CSS must not repeat literal brand or status colors if an appropriate token exists.

The brand accent may identify selected navigation, focus, or brand moments. It must not be used as a large decorative surface.

Status colors communicate state. They are not decoration.

## 6. Density and spacing

This is an ERP used for operational work. Default density is compact but not cramped.

Use a 4 px base spacing rhythm.

Typical desktop controls may use 32 to 36 px visual height when this remains accessible and readable.

Interactive targets must meet WCAG 2.2 minimum target sizing or spacing requirements.

Do not shrink controls simply to fit more content.

Do not add large marketing-style whitespace inside data-heavy workflows.

## 7. Typography

Use the system/UI font stack already compatible with Frappe.

Recommended hierarchy:

- Page title: clear and compact
- Section title: one level below page title
- Body/table: optimized for long reading and scanning
- Metadata/help text: smaller but still legible
- Numeric data: `font-variant-numeric: tabular-nums`

Avoid excessive bold text.

Avoid uppercase text as a hierarchy mechanism for Chinese UI.

## 8. Tables

Tables are a primary ERP surface.

### Required behavior

- Header remains visually distinct from data
- Numeric values align right
- Text aligns left
- Dates and codes use stable formatting
- Currency always includes currency context
- Quantities include unit when ambiguity is possible
- Status uses a restrained semantic badge
- Long content truncates only when a detail path is available
- Horizontal scrolling is allowed for genuinely wide ledgers
- Critical identity columns may be sticky

### Column width rule

Do not apply the old absolute rule that all pixel widths are forbidden.

Use fixed or bounded widths for stable identity, date, status, checkbox, quantity, and action columns when that improves scanning.

Use flexible widths for descriptive text columns.

Use `min-width`, `max-width`, `minmax()`, or flex/grid constraints based on content behavior.

The goal is stable scanning, not avoiding a CSS unit.

### Table actions

One row should not contain many equally prominent buttons.

Prefer:

- Row click for record navigation when unambiguous
- One visible high-frequency action at most
- An action menu for secondary actions
- Selection-driven bulk actions for multi-record workflows

## 9. Forms and input controls

Use Frappe controls before custom controls.

A segmented control is preferred for 2 to 4 mutually exclusive options only when:

- Labels are short
- All options fit without wrapping
- Users benefit from seeing all options simultaneously
- The control remains keyboard accessible
- The choice is not destructive

Otherwise use radio buttons, Select, Autocomplete, Link, or another native control.

Do not force a segmented control because the option count is small.

Autocomplete should be used when users choose from a large or searchable domain.

Never make users memorize internal document names when a meaningful label can be displayed.

## 10. Actions and safety

Each page should have one clear primary action for the current task.

Secondary actions should be visually quieter.

Dangerous actions require:

- Clear action wording
- Confirmation when the consequence is meaningful
- Server-side revalidation
- Permission validation
- Error feedback
- Audit data where the business domain requires it

"Direct submit by default" is not a global rule.

For accounting, stock, payroll, approval, closing, deletion, or other irreversible/high-impact flows, use the standard document lifecycle and an explicit review step unless the domain has a proven, authorized fast path.

## 11. Async states

Every asynchronous region must define:

- Idle
- Loading
- Success
- Empty
- Error
- Retry

Do not leave the previous data looking current while a failed refresh is silently ignored.

Use skeletons only when they preserve layout and meaning. A spinner is enough for short bounded actions.

## 12. Empty and error states

An empty state should explain what is empty and what the user can do next.

An error should explain:

- What operation failed
- What object/context was affected
- A user-actionable reason when known
- Safe retry or navigation

Do not expose secrets or raw traceback to normal users.

## 13. Progressive disclosure

Keep the main surface focused on the current decision.

Move secondary metadata, technical evidence, audit details, or rare actions into:

- Collapsible sections
- Dialogs
- Drawers only when the existing Frappe pattern supports them
- Detail routes

Do not hide information that is required to make the primary decision.

## 14. Accessibility baseline

Target WCAG 2.2 AA for custom UI.

Required:

- Visible keyboard focus
- Semantic buttons/links/inputs
- Accessible labels
- No color-only status meaning
- Sufficient text and non-text contrast
- Keyboard operability
- Minimum target size or sufficient spacing
- Error messages connected to the relevant action/control
- Motion kept subtle and non-essential

Icon-only actions must have an accessible name and a tooltip where useful.

## 15. CSS ownership

Shared CSS belongs in `ashan_ui_kit.css`.

Feature-local CSS must:

- Be namespaced under one page root
- Avoid broad selectors such as `body`, `.page`, `.form-control`, `table`, or `.btn` without a feature root
- Avoid `!important` unless required for a documented Frappe compatibility override
- Avoid inline `style=`
- Use existing tokens and primitives
- Avoid duplicating a shared component under another class name

Do not solve a page-local problem with a global selector.

## 16. JavaScript ownership

Shared UI utilities belong in the existing Ashan UI kit only if multiple features need them.

Page-local state stays page-local.

Do not create new global variables.

The existing `window.AshanUI` is an approved compatibility namespace. Do not create additional global namespaces. New shared functions added to it require a repository search and reuse review.

Bind events with a page-specific namespace where applicable.

Clean up listeners or observers when the Page is unloaded or recreated.

## 17. Visual anti-patterns

Do not generate:

- Gradient-heavy admin UI
- Glassmorphism
- Decorative blur
- Large hero sections
- Excessive cards
- Card-per-field layouts
- Badge-per-value tables
- Multiple primary buttons
- Decorative emoji
- Unnecessary animation
- Floating controls that obscure table content
- Random colors per module
- A different spacing system per page

## 18. UI acceptance checklist

Before completion verify:

- Page archetype is correct
- Native Frappe surface was reused where suitable
- UI primitives are reused
- No duplicate component was introduced
- No page-local problem leaked into global CSS
- All async states exist
- Keyboard focus is visible
- Primary action is unambiguous
- High-risk actions have safe lifecycle behavior
- Tables scan correctly with realistic long data
- Permission-denied state is handled
- Empty and error states are useful
- Page works at common laptop widths without hiding essential actions
