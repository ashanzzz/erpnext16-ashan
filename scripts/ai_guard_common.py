#!/usr/bin/env python3
"""Shared Git/diff/config helpers for Ashan AI hard guardrails."""

from __future__ import annotations

import argparse
import fnmatch
import json
import os
import subprocess
from functools import lru_cache
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


REPO_ROOT = Path.cwd()


@dataclass
class DiffContext:
    mode: str
    base_commit: str | None
    diff_text: str
    name_status_text: str
    numstat_text: str
    include_untracked: bool


@dataclass
class AddedLine:
    path: str
    line_no: int
    text: str


def run_git(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    proc = subprocess.run(
        ["git", *args],
        cwd=REPO_ROOT,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if check and proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or f"git {' '.join(args)} failed")
    return proc


def git_stdout(*args: str, check: bool = True) -> str:
    return run_git(*args, check=check).stdout


def repo_root() -> Path:
    out = git_stdout("rev-parse", "--show-toplevel").strip()
    return Path(out)


def current_head() -> str | None:
    proc = run_git("rev-parse", "HEAD", check=False)
    return proc.stdout.strip() if proc.returncode == 0 else None


def merge_base(ref_a: str, ref_b: str) -> str:
    return git_stdout("merge-base", ref_a, ref_b).strip()


def resolve_diff_context(staged: bool = False, base_ref: str | None = None) -> DiffContext:
    """Resolve the diff and immutable base used for approval lookups.

    Local working tree:
      base_commit = HEAD
      diff = HEAD..working tree
      includes untracked files

    Local staged:
      base_commit = HEAD
      diff = HEAD..index

    GitHub pull request:
      base_commit = merge-base(HEAD, origin/<base>)
      diff = base_commit..HEAD

    GitHub push:
      base_commit = HEAD^ where possible
      diff = HEAD^..HEAD
    """
    head = current_head()
    github = os.environ.get("GITHUB_ACTIONS") == "true"
    event = os.environ.get("GITHUB_EVENT_NAME", "")

    if base_ref:
        base_commit = merge_base("HEAD", base_ref) if head else None
        if not base_commit:
            raise RuntimeError(f"Unable to resolve base ref {base_ref}")
        return DiffContext(
            mode="base-ref",
            base_commit=base_commit,
            diff_text=git_stdout("diff", "--unified=3", f"{base_commit}...HEAD", "--"),
            name_status_text=git_stdout("diff", "--name-status", f"{base_commit}...HEAD", "--"),
            numstat_text=git_stdout("diff", "--numstat", f"{base_commit}...HEAD", "--"),
            include_untracked=False,
        )

    if github and event == "pull_request":
        base_branch = os.environ.get("GITHUB_BASE_REF")
        if not base_branch:
            raise RuntimeError("GITHUB_BASE_REF is missing for pull_request")
        remote_ref = f"origin/{base_branch}"
        base_commit = merge_base("HEAD", remote_ref)
        return DiffContext(
            mode="github-pr",
            base_commit=base_commit,
            diff_text=git_stdout("diff", "--unified=3", f"{base_commit}...HEAD", "--"),
            name_status_text=git_stdout("diff", "--name-status", f"{base_commit}...HEAD", "--"),
            numstat_text=git_stdout("diff", "--numstat", f"{base_commit}...HEAD", "--"),
            include_untracked=False,
        )

    if github and head:
        parent = run_git("rev-parse", "HEAD^", check=False)
        if parent.returncode == 0:
            base_commit = parent.stdout.strip()
            return DiffContext(
                mode="github-push",
                base_commit=base_commit,
                diff_text=git_stdout("diff", "--unified=3", f"{base_commit}...HEAD", "--"),
                name_status_text=git_stdout("diff", "--name-status", f"{base_commit}...HEAD", "--"),
                numstat_text=git_stdout("diff", "--numstat", f"{base_commit}...HEAD", "--"),
                include_untracked=False,
            )

    if staged:
        return DiffContext(
            mode="staged",
            base_commit=head,
            diff_text=git_stdout("diff", "--cached", "--unified=3", "HEAD", "--") if head else git_stdout("diff", "--cached", "--unified=3", "--"),
            name_status_text=git_stdout("diff", "--cached", "--name-status", "HEAD", "--") if head else git_stdout("diff", "--cached", "--name-status", "--"),
            numstat_text=git_stdout("diff", "--cached", "--numstat", "HEAD", "--") if head else git_stdout("diff", "--cached", "--numstat", "--"),
            include_untracked=False,
        )

    if head:
        return DiffContext(
            mode="working-tree",
            base_commit=head,
            diff_text=git_stdout("diff", "--unified=3", "HEAD", "--"),
            name_status_text=git_stdout("diff", "--name-status", "HEAD", "--"),
            numstat_text=git_stdout("diff", "--numstat", "HEAD", "--"),
            include_untracked=True,
        )

    return DiffContext(
        mode="initial",
        base_commit=None,
        diff_text=git_stdout("diff", "--unified=3", "--"),
        name_status_text=git_stdout("diff", "--name-status", "--"),
        numstat_text=git_stdout("diff", "--numstat", "--"),
        include_untracked=True,
    )


@lru_cache(maxsize=None)
def load_worktree_json(path: str) -> dict:
    p = REPO_ROOT / path
    if not p.exists():
        raise RuntimeError(f"Required guardrail config is missing: {path}")
    return json.loads(p.read_text(encoding="utf-8"))


@lru_cache(maxsize=None)
def _load_policy_json(path: str, policy_ref: str) -> dict:
    if policy_ref and path.startswith(".agents/architecture/"):
        proc = run_git("show", f"{policy_ref}:{path}", check=False)
        if proc.returncode == 0:
            return json.loads(proc.stdout)
    return load_worktree_json(path)


def load_json(path: str) -> dict:
    """Load enforcement policy with process-local caching."""
    policy_ref = os.environ.get("ASHAN_GUARD_POLICY_REF", "").strip()
    return _load_policy_json(path, policy_ref)


@lru_cache(maxsize=None)
def load_json_from_base(base_commit: str | None, path: str) -> dict | None:
    """Load a policy file from the immutable approval base.

    This deliberately does not fall back to the working tree. A weak AI cannot
    approve a new service/API/exception and implement it in the same change.
    """
    if not base_commit:
        return None
    proc = run_git("show", f"{base_commit}:{path}", check=False)
    if proc.returncode != 0:
        return None
    return json.loads(proc.stdout)


def parse_added_lines(diff_text: str) -> list[AddedLine]:
    result: list[AddedLine] = []
    current_path = ""
    new_line = 0
    in_hunk = False

    for raw in diff_text.splitlines():
        if raw.startswith("diff --git "):
            current_path = ""
            in_hunk = False
            continue
        if raw.startswith("+++ b/"):
            current_path = raw[6:]
            continue
        if raw.startswith("@@ "):
            import re
            match = re.search(r"\+(\d+)(?:,(\d+))?", raw)
            if match:
                new_line = int(match.group(1))
                in_hunk = True
            continue
        if not in_hunk or not current_path:
            continue

        if raw.startswith("+") and not raw.startswith("+++"):
            result.append(AddedLine(current_path, new_line, raw[1:]))
            new_line += 1
        elif raw.startswith("-") and not raw.startswith("---"):
            continue
        else:
            new_line += 1

    return result


def name_status_map(context: DiffContext) -> dict[str, str]:
    result: dict[str, str] = {}
    for row in context.name_status_text.splitlines():
        parts = row.split("\t")
        if len(parts) < 2:
            continue
        status = parts[0]
        path = parts[-1]
        result[path] = status

    if context.include_untracked:
        for path in git_stdout("ls-files", "--others", "--exclude-standard").splitlines():
            if path:
                result.setdefault(path, "A?")

    return result


def numstat_map(context: DiffContext) -> dict[str, tuple[int, int]]:
    result: dict[str, tuple[int, int]] = {}
    for row in context.numstat_text.splitlines():
        parts = row.split("\t")
        if len(parts) < 3:
            continue
        added_raw, deleted_raw, path = parts[0], parts[1], parts[-1]
        try:
            added = int(added_raw)
            deleted = int(deleted_raw)
        except ValueError:
            added = deleted = 0
        result[path] = (added, deleted)

    if context.include_untracked:
        for path in git_stdout("ls-files", "--others", "--exclude-standard").splitlines():
            p = REPO_ROOT / path
            if p.is_file():
                try:
                    lines = len(p.read_text(encoding="utf-8", errors="replace").splitlines())
                except Exception:
                    lines = 0
                result.setdefault(path, (lines, 0))

    return result


def base_line_count(base_commit: str | None, path: str) -> int:
    if not base_commit:
        return 0
    proc = run_git("show", f"{base_commit}:{path}", check=False)
    if proc.returncode != 0:
        return 0
    return len(proc.stdout.splitlines())


def path_matches(path: str, patterns: Iterable[str]) -> bool:
    return any(fnmatch.fnmatch(path, pattern) for pattern in patterns)


def source_extensions() -> set[str]:
    config = load_json(".agents/architecture/guard_config.json")
    return set(config.get("source_extensions", []))


def is_source(path: str) -> bool:
    return Path(path).suffix.lower() in source_extensions()


def ignored(path: str) -> bool:
    config = load_json(".agents/architecture/guard_config.json")
    for prefix in config.get("ignored_prefixes", []):
        if prefix.endswith("/") and path.startswith(prefix):
            return True
        if path == prefix:
            return True
    return False


def classify_domain(path: str, ownership: dict | None = None) -> str:
    ownership = ownership or load_json(".agents/architecture/ownership.json")
    for domain in ownership.get("domains", []):
        if path_matches(path, domain.get("path_globs", [])):
            return domain["id"]
    return "unclassified"


def changed_paths(context: DiffContext) -> list[str]:
    return sorted(name_status_map(context))


def new_paths(context: DiffContext) -> list[str]:
    statuses = name_status_map(context)
    return sorted(
        path for path, status in statuses.items()
        if status.startswith("A")
    )


def registered_component_for_path(registry: dict | None, path: str) -> dict | None:
    if not registry:
        return None
    for component in registry.get("components", []):
        if path in component.get("canonical_files", []):
            return component
        for root in component.get("owned_roots", []):
            if path.startswith(root):
                return component
    return None


def registered_api(registry: dict | None, endpoint: str) -> dict | None:
    if not registry:
        return None
    for api in registry.get("apis", []):
        if api.get("endpoint") == endpoint:
            return api
    return None


def active_exceptions(base_registry: dict | None) -> list[dict]:
    if not base_registry:
        return []
    from datetime import date
    today = date.today().isoformat()
    result = []
    for item in base_registry.get("exceptions", []):
        if not item.get("enabled", True):
            continue
        expires = item.get("expires")
        if expires and str(expires) < today:
            continue
        result.append(item)
    return result


def exception_covers(
    exception: dict,
    paths: Iterable[str],
    domains: Iterable[str],
    capability: str | None = None,
) -> bool:
    allowed_paths = exception.get("allowed_paths", [])
    allowed_domains = set(exception.get("allowed_domains", []))
    capabilities = set(exception.get("capabilities", []))

    if capability and capability not in capabilities and "*" not in capabilities:
        return False

    path_list = list(paths)
    if allowed_paths and not all(path_matches(path, allowed_paths) for path in path_list):
        return False

    domain_set = {d for d in domains if d}
    if allowed_domains and not domain_set.issubset(allowed_domains):
        return False

    return True


def find_exception(
    base_registry: dict | None,
    paths: Iterable[str],
    domains: Iterable[str],
    capability: str,
) -> dict | None:
    for item in active_exceptions(base_registry):
        if exception_covers(item, paths, domains, capability):
            return item
    return None


def module_name_from_path(path: str) -> str | None:
    p = Path(path)
    parts = p.parts
    if len(parts) < 3 or parts[0] != "ashan_cn_procurement":
        return None
    if parts[1] != "ashan_cn_procurement":
        return None
    module_parts = list(parts[1:])
    module_parts[-1] = Path(module_parts[-1]).stem
    if module_parts[-1] == "__init__":
        module_parts = module_parts[:-1]
    return ".".join(module_parts)


def parse_args(description: str) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--staged", action="store_true", help="inspect only staged changes")
    parser.add_argument("--base-ref", help="compare HEAD to merge-base with this Git ref")
    parser.add_argument("--validate-config", action="store_true", help="validate configuration only")
    return parser.parse_args()
