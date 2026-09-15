"""
user_preference_service.py
「我的业务」用户偏好服务端持久化层

存储：frappe.db.get_default / set_default (tabDefaultValue)
  - parent = user email
  - key    = "ashan_my_biz_prefs"
  - value  = JSON {"shortcuts":[...],"auto_sort":bool,"click_counts":{...}}
"""

import frappe
import json

_PREF_KEY = "ashan_my_biz_prefs"


def _load_prefs(user):
    raw = frappe.db.get_default(_PREF_KEY, parent=user)
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except Exception:
        return {}


def _save_prefs(user, prefs):
    payload = json.dumps(prefs, ensure_ascii=False, separators=(",", ":"))
    frappe.db.set_default(_PREF_KEY, payload, parent=user)
    frappe.db.commit()


@frappe.whitelist()
def get_my_biz_prefs():
    """Return the current user's full My Biz prefs from DB."""
    user = frappe.session.user
    if not user or user == "Guest":
        frappe.throw("请先登录", frappe.AuthenticationError)
    prefs = _load_prefs(user)
    return {
        "shortcuts": prefs.get("shortcuts"),
        "auto_sort": bool(prefs.get("auto_sort", False)),
        "click_counts": prefs.get("click_counts") or {},
    }


@frappe.whitelist(methods=["POST"])
def save_my_biz_prefs(shortcuts=None, auto_sort=None, click_counts=None):
    """Partial-update the current user's My Biz prefs."""
    user = frappe.session.user
    if not user or user == "Guest":
        frappe.throw("请先登录", frappe.AuthenticationError)
    prefs = _load_prefs(user)
    if shortcuts is not None:
        if isinstance(shortcuts, str):
            shortcuts = json.loads(shortcuts)
        prefs["shortcuts"] = shortcuts
    if auto_sort is not None:
        if isinstance(auto_sort, str):
            auto_sort = auto_sort.lower() in ("true", "1", "yes")
        prefs["auto_sort"] = bool(auto_sort)
    if click_counts is not None:
        if isinstance(click_counts, str):
            click_counts = json.loads(click_counts)
        existing = prefs.get("click_counts") or {}
        for k, v in (click_counts or {}).items():
            existing[k] = existing.get(k, 0) + int(v)
        prefs["click_counts"] = existing
    _save_prefs(user, prefs)
    return {"ok": True}


@frappe.whitelist(methods=["POST"])
def clear_my_biz_click_counts():
    """Reset click counts to empty for the current user."""
    user = frappe.session.user
    if not user or user == "Guest":
        frappe.throw("请先登录", frappe.AuthenticationError)
    prefs = _load_prefs(user)
    prefs["click_counts"] = {}
    _save_prefs(user, prefs)
    return {"ok": True}
