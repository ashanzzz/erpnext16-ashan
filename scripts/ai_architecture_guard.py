#!/usr/bin/env python3
"""Hard architecture gate for Ashan ERPNext.

The central rule is intentionally strict:

    AI may modify existing architecture.
    AI may not invent new architecture and approve it in the same change.

New shared assets, services, Page registrations, DocTypes, Reports, Workspaces
and whitelisted APIs must already be present in the registry on the BASE
branch. Updating the registry in the same PR does not grant permission.
"""

from __future__ import annotations

import difflib
import re
from pathlib import Path

from ai_guard_common import (
    AddedLine,
    REPO_ROOT,
    classify_domain,
    find_exception,
    ignored,
    is_source,
    load_json,
    load_worktree_json,
    load_json_from_base,
    module_name_from_path,
    name_status_map,
    new_paths,
    parse_added_lines,
    path_matches,
    registered_api,
    registered_component_for_path,
    resolve_diff_context,
    run_git,
    git_stdout,
    parse_args,
)


EXCEPTION_MARKER = "AI-GOVERNANCE-EXCEPTION:"

BLOCK_PATTERNS = [
    (
        "INLINE_STYLE",
        re.compile(r'''style\s*=\s*["']''', re.I),
        "Do not add inline style=. Use a scoped class or existing shared component.",
        False,
    ),
    (
        "IGNORE_PERMISSIONS",
        re.compile(r"ignore_permissions\s*=\s*True"),
        "New user-path ignore_permissions=True is blocked without an explicit governance exception comment.",
        True,
    ),
    (
        "MANUAL_COMMIT",
        re.compile(r"\bfrappe\.db\.commit\s*\("),
        "Ordinary request/service code must let Frappe own the transaction.",
        True,
    ),
    (
        "DIRECT_GL_WRITE",
        re.compile(
            r'''(?:INSERT|UPDATE|DELETE).*tabGL Entry|'''
            r'''frappe\.(?:new_doc|get_doc)\s*\(\s*["']GL Entry["']''',
            re.I,
        ),
        "Do not directly write GL Entry. Use ERPNext accounting controllers.",
        True,
    ),
    (
        "DIRECT_STOCK_LEDGER_WRITE",
        re.compile(
            r'''(?:INSERT|UPDATE|DELETE).*tabStock Ledger Entry|'''
            r'''frappe\.(?:new_doc|get_doc)\s*\(\s*["']Stock Ledger Entry["']''',
            re.I,
        ),
        "Do not directly write Stock Ledger Entry. Use ERPNext stock controllers.",
        True,
    ),
]

CANONICAL_HELPERS = {
    "formatMoney": {
        "ashan_cn_procurement/ashan_cn_procurement/public/js/ashan_ui_kit.js",
    },
    "renderPeriodSelector": {
        "ashan_cn_procurement/ashan_cn_procurement/public/js/ashan_ui_kit.js",
    },
    "renderEntityTabs": {
        "ashan_cn_procurement/ashan_cn_procurement/public/js/ashan_ui_kit.js",
    },
    "get_allowed_companies": {
        "ashan_cn_procurement/ashan_cn_procurement/services/authorization_service.py",
    },
    "assert_company_access": {
        "ashan_cn_procurement/ashan_cn_procurement/services/authorization_service.py",
    },
    "assert_module_access": {
        "ashan_cn_procurement/ashan_cn_procurement/services/authorization_service.py",
    },
    "assert_payroll_access": {
        "ashan_cn_procurement/ashan_cn_procurement/services/authorization_service.py",
    },
    "assert_oil_ledger_access": {
        "ashan_cn_procurement/ashan_cn_procurement/services/authorization_service.py",
    },
    "can_module_access": {
        "ashan_cn_procurement/ashan_cn_procurement/services/authorization_service.py",
    },
}

ROLE_CHECK_ALLOWED = {
    "ashan_cn_procurement/ashan_cn_procurement/services/authorization_service.py",
    "ashan_cn_procurement/ashan_cn_procurement/boot.py",
    "ashan_cn_procurement/ashan_cn_procurement/navigation_config.py",
}

BROAD_CSS = re.compile(
    r"^\s*(?:html|body|:root|\.btn|\.form-control|table|thead|tbody|th|td|"
    r"\.modal-dialog|\.modal-content|\.modal-body)\s*(?:,|\{)"
)

GLOBAL_NAMESPACE = re.compile(r"\bwindow\.([A-Za-z_$][\w$]*)\s*=")
GLOBAL_NAMESPACE_BRACKET = re.compile(r'''window\[\s*["']([^"']+)["']\s*\]\s*=''')
ROLE_CHECK = re.compile(r"\bfrappe\.get_roles\s*\(|\bfrappe\.user_roles\b")
MANAGER_HELPER = re.compile(r"^\s*def\s+is_(?:system_admin|[a-z0-9_]*manager)\s*\(", re.I)
GET_ALL = re.compile(r"\bfrappe\.get_all\s*\(")
FSTRING_SQL = re.compile(r"\bfrappe\.db\.sql\s*\(\s*f[\"']")
WHITELIST = re.compile(r"^\s*@frappe\.whitelist\b")
DEF_LINE = re.compile(r"^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(")
BAD_JS_HELPER = re.compile(
    r"^\s*(?:function\s+|(?:const|let|var)\s+)"
    r"(formatMoney|renderPeriodSelector|renderEntityTabs)\b"
)
PY_HELPER = re.compile(
    r"^\s*def\s+("
    + "|".join(re.escape(name) for name in CANONICAL_HELPERS if "_" in name)
    + r")\s*\("
)


def validate_configs() -> list[str]:
    errors: list[str] = []
    required = {
        ".agents/architecture/ownership.json": ("domains",),
        ".agents/architecture/component_registry.json": ("components",),
        ".agents/architecture/api_registry.json": ("apis",),
        ".agents/architecture/architecture_exceptions.json": ("exceptions",),
        ".agents/architecture/guard_config.json": ("scope_limits", "new_architecture_globs"),
    }
    for path, keys in required.items():
        try:
            data = load_worktree_json(path)
        except Exception as exc:
            errors.append(str(exc))
            continue
        for key in keys:
            if key not in data:
                errors.append(f"{path}: missing required key {key}")

    try:
        registry = load_worktree_json(".agents/architecture/component_registry.json")
        ids = [item.get("id") for item in registry.get("components", [])]
        if len(ids) != len(set(ids)):
            errors.append("component_registry.json: duplicate component id")
        for item in registry.get("components", []):
            if not item.get("id") or not item.get("domain") or not item.get("responsibility"):
                errors.append(f"component_registry.json: incomplete entry {item!r}")
    except Exception:
        pass

    try:
        api_registry = load_worktree_json(".agents/architecture/api_registry.json")
        endpoints = [item.get("endpoint") for item in api_registry.get("apis", [])]
        if len(endpoints) != len(set(endpoints)):
            errors.append("api_registry.json: duplicate endpoint")
        for item in api_registry.get("apis", []):
            required = ("endpoint", "domain", "permission_guard", "company_scope", "reason")
            missing = [key for key in required if not str(item.get(key, "")).strip()]
            if missing:
                errors.append(
                    f"api_registry.json: API entry {item.get('endpoint')!r} lacks {', '.join(missing)}"
                )
            if item.get("mutation") is True:
                methods = {str(method).upper() for method in item.get("http_methods", [])}
                if "POST" not in methods:
                    errors.append(
                        f"api_registry.json: mutation {item.get('endpoint')!r} must approve POST"
                    )

        exception_registry = load_worktree_json(
            ".agents/architecture/architecture_exceptions.json"
        )
        for item in exception_registry.get("exceptions", []):
            required = ("id", "reason", "allowed_paths", "allowed_domains", "capabilities")
            missing = [key for key in required if not item.get(key)]
            if missing:
                errors.append(
                    f"architecture_exceptions.json: exception {item.get('id')!r} lacks {', '.join(missing)}"
                )
    except Exception:
        pass

    return errors


def augmented_added_lines(context) -> list[AddedLine]:
    lines = parse_added_lines(context.diff_text)
    seen = {(item.path, item.line_no, item.text) for item in lines}

    if context.include_untracked:
        for path in git_stdout("ls-files", "--others", "--exclude-standard").splitlines():
            p = REPO_ROOT / path
            if not p.is_file() or ignored(path) or not is_source(path):
                continue
            for line_no, text in enumerate(
                p.read_text(encoding="utf-8", errors="replace").splitlines(), 1
            ):
                key = (path, line_no, text)
                if key not in seen:
                    lines.append(AddedLine(path, line_no, text))
                    seen.add(key)

    return lines


def has_exception_comment(lines: list[AddedLine], index: int) -> bool:
    current = lines[index]
    for candidate in lines[max(0, index - 3): index + 1]:
        if candidate.path != current.path:
            continue
        if not 0 <= current.line_no - candidate.line_no <= 3:
            continue
        if EXCEPTION_MARKER not in candidate.text:
            continue
        reason = candidate.text.split(EXCEPTION_MARKER, 1)[1].strip()
        if reason:
            return True
    return False


def is_new_architecture(path: str, config: dict) -> bool:
    return path_matches(path, config.get("new_architecture_globs", []))


def parent_existed_in_base(context, path: str) -> bool:
    if not context.base_commit:
        return False
    p = Path(path)
    parts = p.parts
    if "page" in parts:
        idx = parts.index("page")
        if len(parts) > idx + 1:
            page_root = "/".join(parts[: idx + 2])
            proc = run_git("ls-tree", "-d", context.base_commit, page_root, check=False)
            return proc.returncode == 0 and bool(proc.stdout.strip())
    return False


def normalize_for_similarity(text: str) -> list[str]:
    result: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith(("#", "//", "/*", "*", "*/")):
            continue
        line = re.sub(r"\s+", " ", line)
        line = re.sub(r'''["'][^"']{1,80}["']''', '"STR"', line)
        result.append(line)
    return result


def duplicate_file_match(context, new_path: str) -> tuple[str, float] | None:
    if not context.base_commit:
        return None
    p = REPO_ROOT / new_path
    if not p.is_file() or not is_source(new_path):
        return None

    new_lines = normalize_for_similarity(p.read_text(encoding="utf-8", errors="replace"))
    if len(new_lines) < 100:
        return None

    candidates = git_stdout("ls-tree", "-r", "--name-only", context.base_commit).splitlines()
    best: tuple[str, float] | None = None
    for candidate in candidates:
        if candidate == new_path:
            continue
        if Path(candidate).suffix.lower() != Path(new_path).suffix.lower():
            continue
        if "/test" in candidate.lower() or "/patches/" in candidate.lower():
            continue
        proc = run_git("show", f"{context.base_commit}:{candidate}", check=False)
        if proc.returncode != 0:
            continue
        old_lines = normalize_for_similarity(proc.stdout)
        if len(old_lines) < 80:
            continue
        ratio_size = len(new_lines) / max(len(old_lines), 1)
        if ratio_size < 0.55 or ratio_size > 1.8:
            continue
        score = difflib.SequenceMatcher(None, new_lines, old_lines, autojunk=True).ratio()
        if best is None or score > best[1]:
            best = (candidate, score)
    return best if best and best[1] >= 0.90 else None


def added_line_numbers(lines: list[AddedLine]) -> dict[str, set[int]]:
    result: dict[str, set[int]] = {}
    for item in lines:
        result.setdefault(item.path, set()).add(item.line_no)
    return result


def newly_added_whitelisted_functions(
    context,
    lines: list[AddedLine],
    changed_files: set[str],
) -> list[tuple[str, str, str]]:
    added_numbers = added_line_numbers(lines)
    result: list[tuple[str, str, str]] = []

    for path in sorted(changed_files):
        if Path(path).suffix != ".py" or ignored(path):
            continue
        module = module_name_from_path(path)
        file_path = REPO_ROOT / path
        if not module or not file_path.is_file():
            continue

        source_lines = file_path.read_text(encoding="utf-8", errors="replace").splitlines()
        added = added_numbers.get(path, set())
        for index, source in enumerate(source_lines):
            if not WHITELIST.search(source):
                continue
            decorator_line = index + 1
            decorator_parts = [source.strip()]
            cursor = index + 1
            while cursor < len(source_lines) and "def " not in source_lines[cursor]:
                decorator_parts.append(source_lines[cursor].strip())
                if ")" in source_lines[cursor]:
                    cursor += 1
                    break
                cursor += 1
                if cursor - index > 8:
                    break

            while cursor < len(source_lines) and not DEF_LINE.search(source_lines[cursor]):
                cursor += 1
            if cursor >= len(source_lines):
                continue
            match = DEF_LINE.search(source_lines[cursor])
            if not match:
                continue
            def_line = cursor + 1
            if decorator_line not in added and def_line not in added:
                continue

            endpoint = f"{module}.{match.group(1)}"
            result.append((endpoint, " ".join(decorator_parts), path))

    return result


def main() -> int:
    args = parse_args("Ashan hard architecture guard")
    config_errors = validate_configs()
    if config_errors:
        for error in config_errors:
            print("ERROR [CONFIG]", error)
        return 1
    if args.validate_config:
        print("PASS: architecture guard configuration is valid")
        return 0

    context = resolve_diff_context(staged=args.staged, base_ref=args.base_ref)

    # Enforce the immutable base policy if hard guardrails already exist there.
    base_guard_config = load_json_from_base(
        context.base_commit, ".agents/architecture/guard_config.json"
    )
    if base_guard_config is not None and context.base_commit:
        import os
        os.environ["ASHAN_GUARD_POLICY_REF"] = context.base_commit

    config = load_json(".agents/architecture/guard_config.json")
    ownership = load_json(".agents/architecture/ownership.json")
    base_components = load_json_from_base(
        context.base_commit, ".agents/architecture/component_registry.json"
    )
    base_apis = load_json_from_base(
        context.base_commit, ".agents/architecture/api_registry.json"
    )
    base_exceptions = load_json_from_base(
        context.base_commit, ".agents/architecture/architecture_exceptions.json"
    )

    statuses = name_status_map(context)
    added_lines = augmented_added_lines(context)
    errors: list[str] = []
    warnings: list[str] = []

    allowed_namespaces = set(config.get("allowed_global_js_namespaces", []))

    for index, item in enumerate(added_lines):
        path = item.path
        if ignored(path) or not is_source(path):
            continue

        for code, pattern, message, exception_allowed in BLOCK_PATTERNS:
            if pattern.search(item.text):
                if exception_allowed and has_exception_comment(added_lines, index):
                    warnings.append(
                        f"{path}:{item.line_no} [{code}] exception comment present; reviewer must verify necessity"
                    )
                else:
                    errors.append(f"{path}:{item.line_no} [{code}] {message}")

        if ROLE_CHECK.search(item.text) and path not in ROLE_CHECK_ALLOWED:
            errors.append(
                f"{path}:{item.line_no} [ADHOC_ROLE_CHECK] "
                "Do not create page/service-local role logic. Use authorization_service or standard DocPerm."
            )

        if MANAGER_HELPER.search(item.text) and path not in ROLE_CHECK_ALLOWED:
            errors.append(
                f"{path}:{item.line_no} [DUPLICATE_CAPABILITY_HELPER] "
                "Do not add another is_*_manager/is_system_admin helper."
            )

        namespace = GLOBAL_NAMESPACE.search(item.text) or GLOBAL_NAMESPACE_BRACKET.search(item.text)
        if namespace:
            name = namespace.group(1)
            if name not in allowed_namespaces:
                errors.append(
                    f"{path}:{item.line_no} [NEW_GLOBAL_NAMESPACE] window.{name} is not approved. "
                    "Extend AshanUI or keep state module-local."
                )

        js_helper = BAD_JS_HELPER.search(item.text)
        if js_helper:
            name = js_helper.group(1)
            canonical = CANONICAL_HELPERS.get(name, set())
            if path not in canonical:
                errors.append(
                    f"{path}:{item.line_no} [DUPLICATE_SHARED_HELPER] {name} already has a canonical implementation."
                )

        py_helper = PY_HELPER.search(item.text)
        if py_helper:
            name = py_helper.group(1)
            if path not in CANONICAL_HELPERS.get(name, set()):
                errors.append(
                    f"{path}:{item.line_no} [DUPLICATE_SHARED_HELPER] {name} belongs in the existing authorization service."
                )

        if Path(path).suffix.lower() in {".css", ".scss"}:
            domain = classify_domain(path, ownership)
            if BROAD_CSS.search(item.text) and domain != "shared_ui":
                errors.append(
                    f"{path}:{item.line_no} [GLOBAL_CSS_POLLUTION] "
                    "Broad selectors are only allowed in the canonical shared UI layer."
                )
            if "!important" in item.text and domain != "shared_ui":
                warnings.append(
                    f"{path}:{item.line_no} [CSS_IMPORTANT] Avoid adding !important outside the shared convergence layer."
                )

        if GET_ALL.search(item.text):
            warnings.append(
                f"{path}:{item.line_no} [GET_ALL] Verify explicit server permission/company scope; prefer get_list for user-facing reads."
            )

        if FSTRING_SQL.search(item.text):
            warnings.append(
                f"{path}:{item.line_no} [FSTRING_SQL] Verify that no user-controlled text is interpolated into SQL."
            )

    bad_name = re.compile(config.get("bad_filename_suffixes_regex", r"$^"), re.I)
    grandfathered = set(config.get("grandfathered_versioned_paths", []))
    for path in new_paths(context):
        if path in grandfathered or ignored(path):
            continue
        if bad_name.search(Path(path).name):
            errors.append(
                f"{path}:1 [VERSIONED_DUPLICATE] Do not create *_v2/_new/_final/_fixed/_backup/_copy files. "
                "Extend the current owner."
            )

    for path in new_paths(context):
        if ignored(path) or not is_source(path):
            continue
        if not is_new_architecture(path, config):
            continue
        if "/page/" in path and parent_existed_in_base(context, path):
            continue

        approved_component = registered_component_for_path(base_components, path)
        if approved_component is None:
            errors.append(
                f"{path}:1 [UNAPPROVED_NEW_ARCHITECTURE] "
                "New service/shared asset/Page/DocType/Report/Workspace must be registered on the base branch first. "
                "Editing component_registry.json in this same change does NOT approve it."
            )
        else:
            missing_evidence = []
            if not approved_component.get("reuse_searches"):
                missing_evidence.append("reuse_searches")
            if not str(approved_component.get("why_existing_cannot_extend", "")).strip():
                missing_evidence.append("why_existing_cannot_extend")
            if missing_evidence:
                errors.append(
                    f"{path}:1 [INCOMPLETE_ARCHITECTURE_APPROVAL] Base registry entry "
                    f"{approved_component.get('id')} lacks {', '.join(missing_evidence)}."
                )

    changed_files = set(statuses)
    for endpoint, decorator, path in newly_added_whitelisted_functions(
        context, added_lines, changed_files
    ):
        api = registered_api(base_apis, endpoint)
        if api is None:
            errors.append(
                f"{path} [UNAPPROVED_WHITELIST_API] {endpoint} is new. "
                "Pre-register it in api_registry.json on the base branch before implementation."
            )
            continue

        required = ("domain", "permission_guard", "company_scope", "reason")
        missing = [key for key in required if not str(api.get(key, "")).strip()]
        if missing:
            errors.append(
                f"{path} [INCOMPLETE_API_APPROVAL] {endpoint} registry entry lacks {', '.join(missing)}."
            )
        if api.get("mutation") is True and "POST" not in decorator.upper():
            errors.append(
                f"{path} [MUTATION_NOT_POST] {endpoint} is registered as mutation but decorator does not restrict POST."
            )

    changed_nonignored = [path for path in statuses if not ignored(path)]
    domains = {classify_domain(path, ownership) for path in changed_nonignored}
    for sensitive in config.get("sensitive_root_files", []):
        if sensitive not in statuses:
            continue
        capability = (
            "hooks" if sensitive.endswith("hooks.py")
            else "migration" if sensitive.endswith("patches.txt")
            else "dependency"
        )
        if not find_exception(base_exceptions, [sensitive], domains, capability):
            errors.append(
                f"{sensitive} [PROTECTED_PLATFORM_CHANGE] Changes to this file require a "
                f"base-branch architecture exception with capability '{capability}'."
            )

    for path in new_paths(context):
        if ignored(path) or not is_source(path):
            continue
        match = duplicate_file_match(context, path)
        if not match:
            continue
        candidate, score = match
        domain = classify_domain(path, ownership)
        if not find_exception(
            base_exceptions, [path, candidate], [domain], "duplicate-file"
        ):
            errors.append(
                f"{path}:1 [COPY_PASTE_ARCHITECTURE] New file is {score:.0%} similar to {candidate}. "
                "Extend/configure the existing implementation instead of copying it."
            )

    arch_control_changed = [
        path for path in statuses
        if path.startswith(".agents/architecture/")
        or path in {".github/CODEOWNERS", ".github/workflows/ai-hard-guardrails.yml"}
    ]
    business_source_changed = [
        path for path in statuses
        if is_source(path)
        and not ignored(path)
        and classify_domain(path, ownership) != "architecture"
    ]
    if arch_control_changed and business_source_changed:
        errors.append(
            "[SELF_APPROVAL_CHANGE] Architecture registry/exception changes must be a separate approval change. "
            "Do not mix them with implementation source code."
        )

    for warning in warnings:
        print("WARN", warning)
    for error in errors:
        print("ERROR", error)

    if errors:
        print(f"FAILED: {len(errors)} architecture violation(s), {len(warnings)} warning(s)")
        return 1

    print(f"PASS: architecture guard, {len(warnings)} warning(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
