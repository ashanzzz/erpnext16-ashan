# Ashan ERPNext UI and Backend Architecture 2026

## Executive decision

The recommended product direction is **Frappe-native Operational SaaS**.

Do not rebuild ERPNext as an Odoo clone.

Do not restyle it as a GitHub clone.

Do not generate a new SPA for each business module.

Use Frappe Desk as the platform and standardize the parts that are currently most likely to drift:

- Navigation
- Page archetypes
- Design tokens
- Table behavior
- Action hierarchy
- Async/error states
- Backend service boundaries
- API contracts
- Server permissions
- Shared-file ownership
- AI implementation workflow

## Why this fits this repository

This repository already has the right foundation:

- A dedicated `ashan_cn_procurement` custom app
- Frappe `hooks.py`
- DocType-specific form/list scripts
- Shared `ashan_ui_kit.css`
- Shared `ashan_ui_kit.js`
- Workspaces and custom Pages
- Server services and overrides
- AI development documentation

The problem is not lack of customization.

The main architectural risk is that AI can interpret historical visual rules as universal product rules and then add another special-case component, API, CSS selector, or workflow.

The new governance files change the unit of design from "what should this page look like" to "what task archetype is this, what existing platform capability serves it, and what frontend/backend contract is required."

## UI reference model

### Odoo

Useful ideas:

- Module-oriented navigation
- Strong context between apps and operations
- Workbench/dashboard concepts
- Consistent enterprise task structure

Do not copy:

- Odoo's full web client architecture
- Owl component architecture
- Odoo routing/service registries

Those solve Odoo's platform problem, not Frappe's.

### GitHub Primer

Useful ideas:

- Design tokens
- Predictable components
- Dense information surfaces
- Data tables
- Accessible action controls
- Progressive disclosure
- Explicit loading, empty, error, and save states

Do not copy:

- GitHub visual branding
- Repository/developer-centric information architecture

### Frappe

Keep as the actual platform:

- Desk
- Workspace
- List
- Form
- Report
- Dialog
- Page
- Permission model
- DocType lifecycle
- REST/RPC
- Background jobs
- Hooks

## Product structure

```text
Frappe Desk shell
|
+-- Permission-aware module navigation
|
+-- Workspace / module home
|
+-- Standard Forms and Lists
|
+-- Reports and ledgers
|
+-- Custom Workbenches only for cross-DocType operations
|
+-- Shared Ashan UI primitives
```

## Backend structure

```text
Frontend
|
+-- standard Frappe APIs where sufficient
|
+-- thin custom whitelisted method
      |
      +-- authorization
      +-- input validation
      +-- domain service
            |
            +-- DocType / ERPNext controller lifecycle
            +-- query helpers
            +-- background job when needed
```

## Design system direction

The UI should feel:

- Compact
- Calm
- Data-first
- Operational
- Predictable
- Auditable

The interface should not feel:

- Marketing-first
- Card-heavy
- Decorative
- Experimental
- Different on every route

Use the existing Ashan UI kit as the runtime source of shared UI primitives.

Gradually replace raw values with semantic tokens. Do not require a full visual rewrite first.

## Navigation direction

Maintain one Desk navigation hierarchy.

A module entry should answer:

- Where am I?
- What work is pending?
- What can I do here?
- What records or evidence should I review next?

Avoid creating custom nested navigation inside every workbench.

## Page selection

### Use Form/List when

The task centers on one DocType and standard lifecycle.

### Use Report when

The task centers on analysis or a stable dataset.

### Use Workspace when

The task is module entry, shortcuts, summary, or navigation.

### Use custom Desk Page when

The task requires:

- Cross-DocType coordination
- Reconciliation
- Import review
- Bulk approval
- Exception handling
- Evidence comparison
- Operational command center

### Use Vue in Desk Page when

The Page is already justified and its local state/interactions are complex enough that declarative reactivity materially reduces complexity.

Vue is not a visual style decision.

## Backend design direction

### Standard document lifecycle first

For financial, stock, payroll, and purchasing actions, standard ERPNext controller behavior is the safest default.

### Service layer second

Put custom domain rules in reusable Python services.

### Thin endpoint last

Expose only what the frontend needs.

### Permission at the server

Role-based UI is insufficient.

Use standard permissions and action-specific Frappe v16 Permission Types when CRUD permissions cannot express the business action.

## Current rules that should no longer be interpreted absolutely

The following concepts may remain useful but must be contextual, not universal:

- Every 2 to 4 option field must be a segmented control
- Every high-frequency action should directly submit
- Fixed pixel widths are always wrong
- `ignore_permissions=True` is a normal save strategy
- Every table needs the same frozen-column treatment
- Every business action should happen in-place rather than opening a standard form

The correct decision depends on business risk, data density, accessibility, workflow frequency, platform behavior, and reuse.

## Migration strategy

Do not redesign the entire product in one release.

### Phase 1

Add AI governance.

- Execution contract
- UI design system
- Backend contract
- Conflict-prevention rules
- Feature implementation template

### Phase 2

Normalize shared UI primitives.

- Semantic token aliases
- Buttons/actions
- Status badges
- Table primitives
- Empty/loading/error states
- Focus states

Keep old classes compatible.

### Phase 3

Audit global assets.

Review what is loaded from `hooks.py`.

Keep genuinely global navigation/context behavior global.

Move feature-only behavior to feature-specific loading when practical.

### Phase 4

Audit backend actions.

For each high-impact API:

- Confirm HTTP method
- Confirm permission
- Confirm company scope
- Confirm transaction behavior
- Confirm idempotency
- Confirm call sites

### Phase 5

Migrate pages by archetype.

Start with the most frequently changed custom Pages, not standard ERPNext Forms.

For each page, complete a Feature Implementation Contract first.

## Definition of success

The architecture is working when a new AI-generated feature usually adds a small number of files and reuses the rest.

A good change should not require:

- New global styling
- New navigation conventions
- New authorization conventions
- New response conventions
- New duplicate components
- New duplicate services

The UI can still evolve. The rules define how it evolves coherently.
