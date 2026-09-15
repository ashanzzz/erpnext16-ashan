#!/usr/bin/env python3
"""Search the architecture registry before creating code.

Usage:
    python scripts/ai_architecture_query.py permission company
    python scripts/ai_architecture_query.py procurement invoice
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path.cwd()
REGISTRY = ROOT / ".agents/architecture/component_registry.json"


def main() -> int:
    if not REGISTRY.exists():
        print("ERROR: component registry is not installed")
        return 1

    terms = [term.strip().lower() for term in sys.argv[1:] if term.strip()]
    if not terms:
        print("Usage: python scripts/ai_architecture_query.py <keyword> [keyword...]")
        return 1

    data = json.loads(REGISTRY.read_text(encoding="utf-8"))
    matches = []
    for component in data.get("components", []):
        haystack = " ".join([
            str(component.get("id", "")),
            str(component.get("domain", "")),
            str(component.get("responsibility", "")),
            " ".join(component.get("reuse_keywords", [])),
            " ".join(component.get("canonical_files", [])),
            " ".join(component.get("owned_roots", [])),
        ]).lower()
        score = sum(1 for term in terms if term in haystack)
        if score:
            matches.append((score, component))

    if not matches:
        print("No registry match. Do NOT create shared architecture yet.")
        print("Search the repository, then request a registry approval if no owner exists.")
        return 2

    matches.sort(key=lambda item: (-item[0], item[1].get("id", "")))
    for score, component in matches[:12]:
        print(f"\n[{component.get('id')}] domain={component.get('domain')} score={score}")
        print(component.get("responsibility", ""))
        for path in component.get("canonical_files", []):
            print(f"  canonical: {path}")
        for root in component.get("owned_roots", []):
            print(f"  root:      {root}")
        if component.get("parallel_implementations_forbidden"):
            print("  policy:    extend/reuse; parallel implementation forbidden")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
