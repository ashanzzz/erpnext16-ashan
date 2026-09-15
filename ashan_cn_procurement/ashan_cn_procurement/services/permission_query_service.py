"""Permission-aware helpers for SQL-backed read models.

Raw SQL is sometimes appropriate for dense ERP workbenches, but it does not
automatically apply Frappe's document permission query conditions. These
helpers let a service keep its efficient aggregate/query shape while filtering
the returned document identities through one permission-aware get_list query.
"""

from __future__ import annotations

from collections.abc import Iterable

import frappe


def assert_doctype_permission(doctype: str, ptype: str = "read", doc=None) -> None:
    """Require a standard Frappe DocType permission before continuing."""
    if frappe.has_permission(doctype, ptype, doc=doc):
        return
    frappe.throw(
        f"权限不足：当前账号没有 {doctype} 的 {ptype} 权限。",
        frappe.PermissionError,
    )


def permitted_document_names(doctype: str, names: Iterable[str]) -> set[str]:
    """Return the subset of names visible through Frappe permission queries."""
    unique_names = list(dict.fromkeys(
        str(name).strip() for name in names if str(name or "").strip()
    ))
    if not unique_names:
        return set()

    assert_doctype_permission(doctype, "read")

    rows = frappe.get_list(
        doctype,
        filters={"name": ["in", unique_names]},
        pluck="name",
        limit_page_length=max(len(unique_names), 20),
    )
    return {str(name) for name in rows}


def filter_rows_by_doctype_permission(
    rows: Iterable,
    doctype: str,
    name_field: str,
) -> list:
    """Filter SQL rows through one permission-aware Frappe list query."""
    row_list = list(rows or [])
    if not row_list:
        return row_list

    def value(row):
        if isinstance(row, dict):
            return row.get(name_field)
        return getattr(row, name_field, None)

    allowed = permitted_document_names(
        doctype,
        (value(row) for row in row_list),
    )
    return [row for row in row_list if str(value(row) or "") in allowed]


def assert_standard_lifecycle_permissions(
    doctype: str,
    *,
    create: bool = False,
    submit: bool = False,
    cancel: bool = False,
    delete: bool = False,
) -> None:
    """Preflight standard lifecycle rights used by service-level workbenches."""
    if create:
        assert_doctype_permission(doctype, "create")
    if submit:
        assert_doctype_permission(doctype, "submit")
    if cancel:
        assert_doctype_permission(doctype, "cancel")
    if delete:
        assert_doctype_permission(doctype, "delete")
