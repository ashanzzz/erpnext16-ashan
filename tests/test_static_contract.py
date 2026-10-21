from __future__ import annotations

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PKG = ROOT / "ashan_cn_procurement" / "ashan_cn_procurement"


def test_no_windmill_or_real_requests_imports():
    report_root = PKG / "business_center" / "reports"
    for path in report_root.glob("*.py"):
        text = path.read_text(encoding="utf-8")
        assert "import wmill" not in text
        assert "import requests" not in text
        assert "import urllib.request" not in text


def test_single_public_whitelist_surface():
    hits = []
    for path in PKG.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef):
                for deco in node.decorator_list:
                    value = ast.unparse(deco)
                    if "frappe.whitelist" in value:
                        hits.append((path, node.name))
    assert [(p.name, name) for p, name in hits] == [("business_center.py", "run")]
