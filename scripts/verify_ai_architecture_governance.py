#!/usr/bin/env python3
"""Reject newly introduced high-risk patterns while tolerating untouched legacy code."""

from __future__ import annotations
import os, re, subprocess, sys
from pathlib import Path

EXCEPTION = "AI-GOVERNANCE-EXCEPTION:"
SKIP_PREFIXES = (".agents/", "docs/ai/", ".cursor/", ".github/")
SKIP_FILES = {
    "AI_PROJECT_INSTRUCTIONS.md", "CLAUDE.md", "AGENTS.md",
    "README_AI_GOVERNANCE_V2.md", "AGENTS_V2_INSERT.patch", "manifest.json",
    "scripts/verify_completed_module_refactor.py", "scripts/fix_and_run_refactor.py",
    "scripts/ai_architecture_guard.py", "scripts/ai_diff_scope_guard.py",
    "scripts/ai_guard_common.py", "scripts/run_ai_guards.py",
}
SOURCE_EXTS = {".py", ".js", ".css", ".html", ".vue", ".ts", ".tsx", ".jsx", ".json"}

BLOCK = [
    ("INLINE_STYLE", re.compile(r"""style\s*=\s*["']""", re.I), False,
     "Do not add inline style=. Use a scoped class."),
    ("IGNORE_PERMISSIONS", re.compile(r"ignore_permissions\s*=\s*True"), True,
     "ignore_permissions=True needs explicit prior authorization and a governance exception."),
    ("MANUAL_COMMIT", re.compile(r"\bfrappe\.db\.commit\s*\("), True,
     "Manual commit is blocked in ordinary request code."),
    ("DIRECT_GL_WRITE", re.compile(r"""(?:INSERT|UPDATE|DELETE).*tabGL Entry|frappe\.(?:new_doc|get_doc)\s*\(\s*["']GL Entry["']""", re.I), True,
     "Direct GL Entry writes are blocked."),
    ("DIRECT_SLE_WRITE", re.compile(r"""(?:INSERT|UPDATE|DELETE).*tabStock Ledger Entry|frappe\.(?:new_doc|get_doc)\s*\(\s*["']Stock Ledger Entry["']""", re.I), True,
     "Direct Stock Ledger Entry writes are blocked."),
]
WARN = [
    ("LOCAL_MONEY_FORMATTER", re.compile(r"^\s*(?:function\s+formatMoney\b|(?:const|let|var)\s+formatMoney\s*=)"),
     "Prefer AshanUI.formatMoney."),
    ("ADHOC_ROLE_CHECK", re.compile(r"frappe\.get_roles\s*\(|frappe\.user_roles"),
     "Check centralized authorization or standard DocPerm first."),
    ("DECORATIVE_EMOJI", re.compile(r"[💳🔍⏳💰➕➖🏁📅⛽🔄📑📋👥📤🛡️🏛️⚖️📊🗂️🏢👤⚙️⚡📥🖨️🧮]"),
     "Do not add decorative emoji to enterprise UI."),
]
BAD_NAME = re.compile(r"(?:_v[23]|_new2?|_final|_fixed|_backup|_temp)(?:\.[^.]+)?$", re.I)
GRANDFATHERED_VERSIONED_PATHS = {
    "ashan_cn_procurement/ashan_cn_procurement/public/js/ashan_cn_sidebar_v2.js",
}

def git(*args):
    p = subprocess.run(["git", *args], text=True, encoding="utf-8", errors="replace",
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode:
        raise RuntimeError(p.stderr.strip() or "git failed")
    return p.stdout

def should_skip(path):
    return (
        path in SKIP_FILES
        or path.startswith(SKIP_PREFIXES)
        or path == "scripts/verify_ai_architecture_governance.py"
    )

def parse_added(diff):
    out, path, n, active = [], "", 0, False
    for line in diff.splitlines():
        if line.startswith("diff --git "):
            active = False
        elif line.startswith("+++ b/"):
            path = line[6:]
        elif line.startswith("@@ "):
            m = re.search(r"\+(\d+)", line)
            if m:
                n, active = int(m.group(1)), True
        elif active and path:
            if line.startswith("+") and not line.startswith("+++"):
                out.append((path, n, line[1:]))
                n += 1
            elif line.startswith("-") and not line.startswith("---"):
                pass
            else:
                n += 1
    return out

def diff_for_environment():
    """Return diff and whether untracked files should also be scanned."""
    if os.environ.get("GITHUB_ACTIONS") == "true":
        event = os.environ.get("GITHUB_EVENT_NAME", "")
        if event == "pull_request" and os.environ.get("GITHUB_BASE_REF"):
            base_ref = f"origin/{os.environ['GITHUB_BASE_REF']}"
            return git("diff", "--unified=3", f"{base_ref}...HEAD", "--"), False
        try:
            return git("diff", "--unified=3", "HEAD^...HEAD", "--"), False
        except RuntimeError:
            return git("show", "--format=", "--unified=3", "HEAD"), False

    try:
        return git("diff", "--unified=3", "HEAD", "--"), True
    except RuntimeError:
        return git("diff", "--unified=3", "--"), True

def collect_lines():
    diff, include_untracked = diff_for_environment()
    lines = parse_added(diff)
    untracked = []

    if include_untracked:
        try:
            untracked = git("ls-files", "--others", "--exclude-standard").splitlines()
        except RuntimeError:
            untracked = []
        for path in untracked:
            if should_skip(path) or Path(path).suffix.lower() not in SOURCE_EXTS:
                continue
            p = Path(path)
            if p.is_file():
                for n, text in enumerate(p.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
                    lines.append((path, n, text))
    return lines, untracked

def exception_near(lines, idx):
    path, ln, _ = lines[idx]
    for p, n, text in lines[max(0, idx-3):idx+1]:
        if p == path and 0 <= ln-n <= 3 and EXCEPTION in text:
            if text.split(EXCEPTION, 1)[1].strip():
                return True
    return False

def main():
    try:
        lines, untracked = collect_lines()
    except RuntimeError as exc:
        print(f"ERROR [GIT] {exc}")
        return 1

    errors, warnings = [], []

    for i, (path, ln, text) in enumerate(lines):
        if should_skip(path) or Path(path).suffix.lower() not in SOURCE_EXTS:
            continue
        for code, pattern, can_except, msg in BLOCK:
            if pattern.search(text):
                if can_except and exception_near(lines, i):
                    warnings.append(f"{path}:{ln} [{code}] exception requires reviewer validation")
                else:
                    errors.append(f"{path}:{ln} [{code}] {msg}")
        for code, pattern, msg in WARN:
            if pattern.search(text):
                warnings.append(f"{path}:{ln} [{code}] {msg}")

    names = set(untracked)
    if os.environ.get("GITHUB_ACTIONS") != "true":
        try:
            for row in git("diff", "--name-status", "HEAD", "--").splitlines():
                parts = row.split("\t")
                if len(parts) >= 2 and parts[0].startswith("A"):
                    names.add(parts[-1])
        except RuntimeError:
            pass

    for path in sorted(names):
        if path in GRANDFATHERED_VERSIONED_PATHS:
            continue
        if not should_skip(path) and BAD_NAME.search(Path(path).name):
            errors.append(
                f"{path}:1 [VERSIONED_DUPLICATE] Extend existing code; "
                "do not add *_v2/_new/_final/_fixed/_backup/_temp."
            )

    for x in warnings:
        print("WARN", x)
    for x in errors:
        print("ERROR", x)

    if errors:
        print(f"FAILED: {len(errors)} blocking violation(s), {len(warnings)} warning(s)")
        return 1

    print(f"PASS: 0 blocking violations, {len(warnings)} warning(s)")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
