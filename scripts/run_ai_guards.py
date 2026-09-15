#!/usr/bin/env python3
"""Run installed AI guardrails.

When HEAD already contains the hard guards, this runner executes the approved
HEAD copies from a temporary directory. Current working-tree edits to the guard
scripts therefore do not weaken the check they are currently subject to.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile
from pathlib import Path


HARD_SCRIPTS = (
    "ai_guard_common.py",
    "ai_architecture_guard.py",
    "ai_diff_scope_guard.py",
)


def run(cmd: list[str], env: dict | None = None) -> int:
    return subprocess.run(cmd, env=env).returncode


def git_show(ref: str, path: str) -> str | None:
    proc = subprocess.run(
        ["git", "show", f"{ref}:{path}"],
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    return proc.stdout if proc.returncode == 0 else None


def approved_head_guards_available() -> bool:
    return all(git_show("HEAD", f"scripts/{name}") is not None for name in HARD_SCRIPTS)


def run_hard_guards(forwarded: list[str]) -> list[str]:
    failed: list[str] = []

    if not approved_head_guards_available():
        for name in HARD_SCRIPTS[1:]:
            path = Path("scripts") / name
            if path.exists() and run([sys.executable, str(path), *forwarded]) != 0:
                failed.append(name)
        return failed

    with tempfile.TemporaryDirectory(prefix="ashan-approved-guards-") as tmp:
        tmp_path = Path(tmp)
        for name in HARD_SCRIPTS:
            content = git_show("HEAD", f"scripts/{name}")
            if content is None:
                failed.append(name)
                continue
            (tmp_path / name).write_text(content, encoding="utf-8")

        env = os.environ.copy()
        env["PYTHONPATH"] = str(tmp_path)
        env["ASHAN_GUARD_POLICY_REF"] = "HEAD"

        for name in HARD_SCRIPTS[1:]:
            path = tmp_path / name
            if run([sys.executable, str(path), *forwarded], env=env) != 0:
                failed.append(name)

    return failed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--staged", action="store_true")
    parser.add_argument("--base-ref")
    parser.add_argument("--validate-config", action="store_true")
    args = parser.parse_args()

    forwarded: list[str] = []
    if args.staged:
        forwarded.append("--staged")
    if args.base_ref:
        forwarded += ["--base-ref", args.base_ref]
    if args.validate_config:
        forwarded.append("--validate-config")

    failed: list[str] = []

    # Existing governance remains useful as a supplementary check.
    legacy = Path("scripts/verify_ai_architecture_governance.py")
    if legacy.exists():
        if run([sys.executable, str(legacy)]) != 0:
            failed.append(legacy.name)

    failed.extend(run_hard_guards(forwarded))

    if failed:
        print("\nAI GUARDRAILS FAILED:", ", ".join(failed))
        return 1

    print("\nAI GUARDRAILS PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
