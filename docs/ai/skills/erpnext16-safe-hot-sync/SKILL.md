---
name: erpnext16-safe-hot-sync
description: Safely deploy and verify this ERPNext 16 custom app to the Unraid container. Use for any local-to-live hot sync, DocType migration, app-directory repair, or when Frappe loads a different path from the Python package.
---

# ERPNext 16 Safe Hot Sync

Use this workflow only for `ashan_cn_procurement` in this repository.

1. Read `PROJECT_MAP.md`, `.agents/rules/dev_workflow.md`, and the ERPNext rules.
2. Treat the following structure as mandatory:

   ```text
   ashan_cn_procurement/ashan_cn_procurement/                     App package
   |-- hooks.py, public/, custom/, reimbursement/                 App-level code
   `-- ashan_cn_procurement/doctype/, report/, workspace/         Frappe module metadata
   ```

3. Before writing, use the script's `--check` mode. Confirm the live Python package path and Frappe module paths match this layout.
4. Before a structural repair or migration, retain a container App backup. Never delete a suspect directory before a backup exists; rename it only after the replacement has been verified.
5. Synchronize the complete App package from the repository root. Never extract an archive containing `ashan_cn_procurement/` into the already-existing Python package directory; extract it only into the Bench `apps/` directory.
6. Run `bench build --app ashan_cn_procurement` only when assets changed; run `bench --site site1.local migrate` for DocType/fixture/schema changes; then clear cache and restart the container.
7. Verify from the running container:
   - `import ashan_cn_procurement` resolves to the double-level App package;
   - `frappe.get_module_path("Ashan CN Procurement", "doctype")` resolves to the nested module package;
   - expected DocType metadata is available;
   - the Desk page works in the browser.
8. Do not push GitHub until the user accepts the live result.

Use `scripts/sync_and_migrate.py` as the only hot-sync runner. It archives tracked, non-sensitive App sources only and reads credentials from `.env`; do not add credentials to code, logs, or Git.
