# Salary Workbench Table Consistency Plan

Date: 2026-10-10

## Approved scope

Improve existing Qifu and Jizhong workbenches. Use independent columns and one data line per employee. Keep business-specific tables, company isolation, salary engines, permissions, and existing RPC contracts. Preserve amber warning, green passed, and red blocked states without emoji.

## Implementation contract

- Page type: existing cross-document payroll workbenches.
- Canonical owners: existing Qifu/Jizhong Page JS and CSS.
- Shared reuse: AshanUI.formatMoney and existing typography, surface, border, semantic color, and column-width tokens.
- Backend: no service, API, schema, authorization, or transaction change.
- Actions: existing read/filter/edit/export/confirmation actions remain bound to existing methods. Verification does not submit payroll or change financial records.
- Conflict scope: the four Page files have existing local changes. Keep them; do not replace files from HEAD. Do not edit shared kit, registries, exception rules, hooks, or unrelated modules.
- Deployment: compare target files with runtime first. Limit the upload archive to this task's Page files, preserving other local work.
- Rollback: retain a remote snapshot of target files before upload. No schema rollback is needed for this frontend change.
- Privacy: screenshots and real-site reports stay in ignored temp_screenshots. Tests use synthetic employees only.

## Steps

1. Add failing UI contract tests. Check independent columns, single-line employee cells, column counts, escaping, and period-based ages.
2. Flatten Qifu identity, organization, salary, insurance, retirement, and archive fields. Preserve authoritative values and editing actions.
3. Add matching identity columns to Jizhong, keep its own pay fields, show policy details as columns, and align total/loading spans.
4. Apply the same Page-scoped table, toolbar, tab, and status styling. Preserve each business table's independent structure and sticky identities.
5. Remove emoji in both workbench sources. Remove touched inline styles; do not increase baseline counts.
6. Run unit tests, JavaScript syntax checks, architecture governance, style governance, and all AI guards. Report unrelated existing failures without changing guards.
7. Use scoped hot sync and the existing migrate/build/cache/restart workflow. Check actual migrate exit status.
8. Use Playwright to verify both real routes, all business tabs, filters, selection, read-only dialogs, sticky columns, totals, laptop and desktop layouts, console errors, and full-page screenshots. Do not click submit, confirm, resign, reset, or lock.
9. Review the diff and report verified scope and any remaining limitations. Do not commit or push unless requested.
