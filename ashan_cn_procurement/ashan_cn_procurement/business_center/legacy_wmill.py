"""Small compatibility layer for the migrated Windmill report modules.

The legacy report code expects two Windmill variables. Inside Frappe there is no
second ERPNext server to authenticate to, so the values are stable sentinels and
all reads are routed to the current site by ``local_rest``.
"""

from __future__ import annotations


def get_variable(path: str):
    if path == "f/erpnext/base_url":
        return "local://erpnext"
    if path == "f/erpnext/api_token":
        return "current-session"
    raise KeyError(f"Unsupported migrated Windmill variable: {path}")


def set_variable(*_args, **_kwargs):
    raise RuntimeError("Windmill variables are not writable in the ERPNext-native migration.")
