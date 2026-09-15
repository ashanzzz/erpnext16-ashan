#!/usr/bin/env python3
"""Limit the blast radius of AI changes.

This guard does not ask the AI to declare a scope and then trust that
declaration. It derives the scope from Git paths and the ownership registry.

Normal feature work:
- one business domain
- small number of files
- limited new source
- no whole-file rewrites

Cross-domain or unusually large work requires an architecture exception that
already exists on the base branch.
"""

from __future__ import annotations

from ai_guard_common import (
    base_line_count,
    classify_domain,
    find_exception,
    ignored,
    is_source,
    load_json,
    load_worktree_json,
    load_json_from_base,
    name_status_map,
    numstat_map,
    resolve_diff_context,
    parse_args,
)


def main() -> int:
    args = parse_args("Ashan AI diff scope guard")
    if args.validate_config:
        config = load_worktree_json(".agents/architecture/guard_config.json")
        limits = config.get("scope_limits", {})
        required = {
            "max_business_domains",
            "max_changed_source_files",
            "max_new_source_files",
            "max_added_source_lines",
            "max_shared_files",
            "large_rewrite_min_changed_lines",
            "large_rewrite_fraction",
        }
        missing = sorted(required - set(limits))
        if missing:
            for key in missing:
                print("ERROR [CONFIG] missing scope limit", key)
            return 1
        print("PASS: diff scope configuration is valid")
        return 0

    context = resolve_diff_context(staged=args.staged, base_ref=args.base_ref)

    base_guard_config = load_json_from_base(
        context.base_commit, ".agents/architecture/guard_config.json"
    )
    if base_guard_config is not None and context.base_commit:
        import os
        os.environ["ASHAN_GUARD_POLICY_REF"] = context.base_commit

    config = load_json(".agents/architecture/guard_config.json")
    ownership = load_json(".agents/architecture/ownership.json")
    base_exceptions = load_json_from_base(
        context.base_commit,
        ".agents/architecture/architecture_exceptions.json",
    )
    limits = config["scope_limits"]
    shared_ids = set(ownership.get("shared_domain_ids", []))

    statuses = name_status_map(context)
    stats = numstat_map(context)

    source_paths = [
        path for path in statuses
        if is_source(path) and not ignored(path)
    ]
    domains_by_path = {
        path: classify_domain(path, ownership)
        for path in source_paths
    }

    business_domains = sorted({
        domain for domain in domains_by_path.values()
        if domain not in shared_ids and domain != "unclassified"
    })
    shared_paths = [
        path for path, domain in domains_by_path.items()
        if domain in shared_ids
    ]
    new_source = [
        path for path in source_paths
        if statuses[path].startswith("A")
    ]
    total_added = sum(stats.get(path, (0, 0))[0] for path in source_paths)

    errors: list[str] = []
    warnings: list[str] = []

    # One business domain by default.
    if len(business_domains) > int(limits["max_business_domains"]):
        if not find_exception(
            base_exceptions,
            source_paths,
            business_domains,
            "cross-domain",
        ):
            errors.append(
                "[CROSS_DOMAIN_CHANGE] Normal feature work may touch only one business domain. "
                f"Detected: {', '.join(business_domains)}. "
                "A base-branch architecture exception with capability 'cross-domain' is required."
            )

    # File and line budgets stop runaway refactors.
    threshold_checks = [
        (
            len(source_paths),
            int(limits["max_changed_source_files"]),
            "TOO_MANY_SOURCE_FILES",
            "changed source files",
        ),
        (
            len(new_source),
            int(limits["max_new_source_files"]),
            "TOO_MANY_NEW_FILES",
            "new source files",
        ),
        (
            total_added,
            int(limits["max_added_source_lines"]),
            "TOO_MANY_ADDED_LINES",
            "added source lines",
        ),
        (
            len(shared_paths),
            int(limits["max_shared_files"]),
            "TOO_MANY_SHARED_FILES",
            "shared/platform files",
        ),
    ]

    for actual, maximum, code, label in threshold_checks:
        if actual <= maximum:
            continue
        if not find_exception(
            base_exceptions,
            source_paths,
            business_domains,
            "large-change",
        ):
            errors.append(
                f"[{code}] {actual} {label}; default maximum is {maximum}. "
                "Split the task or preapprove a 'large-change' exception."
            )

    # Whole-file rewrites are one of the most common weak-model failure modes.
    min_changed = int(limits["large_rewrite_min_changed_lines"])
    max_fraction = float(limits["large_rewrite_fraction"])
    for path in source_paths:
        if statuses[path].startswith("A"):
            continue
        added, deleted = stats.get(path, (0, 0))
        churn = added + deleted
        old_lines = base_line_count(context.base_commit, path)
        if old_lines <= 0 or churn < min_changed:
            continue
        fraction = churn / max(old_lines, 1)
        if fraction < max_fraction:
            continue

        domain = domains_by_path[path]
        if not find_exception(
            base_exceptions,
            [path],
            [domain],
            "large-rewrite",
        ):
            errors.append(
                f"{path} [LARGE_REWRITE] {churn} changed lines against {old_lines} base lines "
                f"({fraction:.0%} churn). Modify the existing structure incrementally or "
                "preapprove a 'large-rewrite' exception."
            )

    # Unclassified source is not blocked outright, but it is visible so the
    # ownership map can be improved when new legitimate areas emerge.
    unclassified = [p for p, d in domains_by_path.items() if d == "unclassified"]
    for path in unclassified:
        warnings.append(
            f"{path} [UNCLASSIFIED] Source path is not mapped in ownership.json."
        )

    for warning in warnings:
        print("WARN", warning)
    for error in errors:
        print("ERROR", error)

    if errors:
        print(f"FAILED: {len(errors)} scope violation(s), {len(warnings)} warning(s)")
        return 1

    print(
        "PASS: diff scope guard "
        f"({len(source_paths)} source files, {len(new_source)} new, "
        f"{len(business_domains)} business domain(s), {total_added} added lines)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
