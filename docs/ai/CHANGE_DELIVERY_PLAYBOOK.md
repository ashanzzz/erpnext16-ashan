# Change Delivery Playbook

This playbook prevents mixed changes, unapproved APIs, and unsafe bulk releases.

Use one branch for one business domain and one delivery purpose.

## 1. Start a Change

Before editing code, run the architecture query.

```bash
python scripts/ai_architecture_query.py <business keywords>
```

Record the owner, domain, company scope, permission path, API need, and test plan.
Use the existing component when the query finds one.
Do not start a second domain while the first domain has uncommitted source changes.

## 2. Use the Normal Change Budget

The normal change budget has one business domain, at most 14 source files, at most 2 shared files, and at most 2,200 added source lines.

Stage only the explicit files for the current domain.

```bash
git add <explicit-path>...
python scripts/run_ai_guards.py --staged
git diff --cached --check
git diff --cached --name-only
```

Do not use `git add -A` for a business change. Do not use `--no-verify`.
If the guard reports mixed scope, unstage unrelated files without discarding their working-tree changes.

## 3. Add an API or Protected Change

Create an approval branch before implementation when a change adds a whitelist API, Service, shared component, Page, DocType, Report, Workspace, hook, migration, or dependency.

The approval change must contain only the relevant registry or exception file:

- `.agents/architecture/api_registry.json` for a whitelist API.
- `.agents/architecture/component_registry.json` for a new architectural component.
- `.agents/architecture/architecture_exceptions.json` for a hook, migration, dependency, large change, or cross-domain exception.

Merge the approval into the target base branch before implementing the feature. Never approve and implement the same protected change in one pull request.

## 4. Test and Deliver One Domain

```bash
python scripts/run_ai_guards.py --staged
python scripts/verify_ui_style_governance.py
```

Run the affected unit, permission, company-scope, workflow, migration, and Playwright tests.
Push a feature branch and open a pull request. Do not push directly to `main`.

## 5. Recover a Mixed Working Tree

Inspect staged files and group them by `.agents/architecture/ownership.json`.

```bash
git diff --cached --name-only
python scripts/ai_diff_scope_guard.py --staged
git restore --staged <unrelated-path>...
```

Create one branch per domain from the approved base. Keep unrelated edits unstaged until their branch starts. Local tool folders such as `.claude/` and `.codex-*/` must remain ignored.

## 6. Release Rules

The default approval base is `origin/main`.
Set `ASHAN_GUARD_BASE_REF` only when a pull request uses another approved target branch.

Keep Git `core.hooksPath` set to `.githooks`. The pre-push hook blocks direct pushes to `main` and runs the hard guards for feature branches.

GitHub protection must require pull requests, Code Owner review, required governance checks, an up-to-date branch, and blocked force pushes and branch deletion.
