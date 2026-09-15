"""Reject new custom-page inline styles while allowing gradual cleanup.

Run this before every UI delivery. The checked-in baseline is intentionally a
ceiling: a page may reduce its count, but cannot add ``style=`` declarations
or introduce a new page containing them.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BASELINE_PATH = PROJECT_ROOT / "ashan_cn_procurement" / "ui_style_baseline.json"
PAGE_ROOT = (
    PROJECT_ROOT
    / "ashan_cn_procurement"
    / "ashan_cn_procurement"
    / "ashan_cn_procurement"
    / "page"
)
INLINE_STYLE_PATTERN = re.compile(r"\bstyle\s*=", re.IGNORECASE)


def count_inline_styles(path: Path) -> int:
    """Return the number of inline-style attributes in one JavaScript page."""
    return len(INLINE_STYLE_PATTERN.findall(path.read_text(encoding="utf-8")))


def main() -> int:
    """Compare source counts with the committed ceiling and print the result."""
    baseline = json.loads(BASELINE_PATH.read_text(encoding="utf-8"))["inline_style_counts"]
    current = {
        path.relative_to(PROJECT_ROOT).as_posix(): count_inline_styles(path)
        for path in sorted(PAGE_ROOT.rglob("*.js"))
    }

    violations: list[str] = []
    for path, count in current.items():
        ceiling = baseline.get(path)
        if ceiling is None and count:
            violations.append(f"{path}: new page contains {count} inline style attributes")
        elif ceiling is not None and count > ceiling:
            violations.append(f"{path}: {count} exceeds approved ceiling {ceiling}")

    current_total = sum(current.values())
    baseline_total = sum(baseline.values())
    print(f"Inline styles: {current_total} (baseline ceiling: {baseline_total})")
    if violations:
        print("UI style governance failed:")
        print("\n".join(f"- {violation}" for violation in violations))
        return 1

    print("UI style governance passed: no new inline styles were introduced.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
