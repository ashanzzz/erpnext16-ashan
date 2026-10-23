# Table Layout Engine

`AshanTableLayoutEngine` adds a user-facing column layout layer to the seven high-density procurement/payment workbenches.

Supported pages:

- material-request-workbench
- procurement-execution-workbench
- material-receipt-workbench
- contract-workbench
- monthly-settlement-picker
- wire-transfer-picker
- reimbursement-picker

## Width model

Each visible column stores a percentage of the table viewport. A visible total of 100% fits the viewport. A total above 100% makes the table wider than its container and uses the existing horizontal scrolling surface. This keeps wide ERP tables deterministic while allowing each user to choose information density.

## User controls

The toolbar immediately above each supported table exposes `列设置`.

The dialog supports width per visible column in percent, hide/remove, add hidden columns back, standard or compact row density, wrap or ellipsis long text, and reset to defaults.

The checkbox/select column remains visible because hiding it would break bulk-selection affordances.

## Scope and persistence

Layouts are stored per ERP user, route, table, and current header signature in browser local storage. Different table modes therefore keep different layouts automatically, such as summary/detail views or all-company/single-company views.

The engine is intentionally presentation-only. It does not change RPC calls, backend fields, document state, calculations, or permissions.

## Extension API

The engine is exposed as `window.AshanUI.TableLayoutEngine` with `scan()`, `open(table)` and `reset(table)`.
