# ASHAN-UNIFIED-V2: permission-aware procurement flow overview read model
"""Permission-aware multi-branch procurement business flow overview service.

Provides:
1. get_procurement_flow_overview(company, scope):
   Aggregates node metrics across standard procurement, monthly settlement,
   reimbursement direct-backwrite, and wire transfer paths with strict
   company scope and per-DocType permissions.
2. get_procurement_flow_node_records(node_key, company, scope, status_filter):
   Returns drill-down progress rows for a selected node, strictly redacting
   prices, amounts, and supplier names when the user lacks read permission
   on downstream documents while still letting requesters track their own
   Material Requests / Reimbursements end-to-end.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import flt

from ashan_cn_procurement.services.authorization_service import (
    assert_company_access,
    get_allowed_companies,
)
from ashan_cn_procurement.services.permission_query_service import (
    filter_rows_by_doctype_permission,
)


NODE_META = {
    "mr": {"doctype": "Material Request", "label": "1. 物料申请"},
    "po": {"doctype": "Purchase Order", "label": "2. 采购订单"},
    "pr": {"doctype": "Purchase Receipt", "label": "3A. 采购入库"},
    "pi": {"doctype": "Purchase Invoice", "label": "3B. 采购发票"},
    "rr": {"doctype": "Reimbursement Request", "label": "4. 整算单"},
    "pe": {"doctype": "Payment Entry", "label": "5. 付款核销"},
    "monthly": {"doctype": "Purchase Receipt", "label": "月结补录"},
    "reim": {"doctype": "Reimbursement Request", "label": "报销申请"},
    "wire": {"doctype": "Purchase Invoice", "label": "自办电汇"},
}


def _resolve_scope_companies(company: str | None = None) -> tuple[list[str], list[str], str]:
    """Return (all_accessible_companies, query_companies, effective_active_company)."""
    all_companies = frappe.db.sql(
        "SELECT name FROM `tabCompany` ORDER BY name ASC",
        pluck=True,
    )
    allowed = get_allowed_companies()
    accessible = (
        list(all_companies)
        if allowed is None
        else [c for c in all_companies if c in allowed]
    )
    if not accessible:
        return [], [], ""

    req = str(company or "").strip()
    if req and req not in ("All", "全部公司"):
        assert_company_access(req)
        return accessible, [req], req
    return accessible, accessible, "All"


def _get_capabilities() -> dict[str, bool]:
    """Compute current user's standard DocPerm capabilities across procurement nodes."""
    return {
        "mr_read": bool(frappe.has_permission("Material Request", "read")),
        "mr_create": bool(frappe.has_permission("Material Request", "create")),
        "po_read": bool(frappe.has_permission("Purchase Order", "read")),
        "po_create": bool(frappe.has_permission("Purchase Order", "create")),
        "pr_read": bool(frappe.has_permission("Purchase Receipt", "read")),
        "pr_create": bool(frappe.has_permission("Purchase Receipt", "create")),
        "pi_read": bool(frappe.has_permission("Purchase Invoice", "read")),
        "pi_create": bool(frappe.has_permission("Purchase Invoice", "create")),
        "rr_read": bool(frappe.has_permission("Reimbursement Request", "read")),
        "rr_create": bool(frappe.has_permission("Reimbursement Request", "create")),
        "pe_read": bool(frappe.has_permission("Payment Entry", "read")),
        "pe_create": bool(frappe.has_permission("Payment Entry", "create")),
        "se_read": bool(frappe.has_permission("Stock Entry", "read")),
        "se_create": bool(frappe.has_permission("Stock Entry", "create")),
    }


def _resolve_effective_scope(scope: str | None, caps: dict[str, bool]) -> tuple[str, bool]:
    """Resolve whether the user can view company-wide metrics or only their own."""
    can_view_company = any(
        caps.get(k) for k in ("po_read", "pr_read", "pi_read", "pe_read")
    )
    requested = str(scope or "mine").strip().lower()
    if requested == "company" and can_view_company:
        return "company", True
    return "mine", can_view_company


def _node_access_mode(has_perm: bool, tracked_count: int) -> str:
    """Determine node visual/access state: operable | tracked_readonly | restricted_muted."""
    if has_perm:
        return "operable"
    if tracked_count > 0:
        return "tracked_readonly"
    return "restricted_muted"


def _fmt_qty(val: float) -> str:
    """Format quantity cleanly without trailing zeroes when integer."""
    num = flt(val or 0.0, 2)
    if abs(num - round(num)) < 0.001:
        return str(int(round(num)))
    return f"{num:.2f}"


def _build_mr_pipeline(
    *,
    docstatus: int,
    status: str,
    ordered_qty: float,
    total_qty: float,
    received_qty: float,
    billed_amt: float,
    po_total_amt: float,
    paid_done: bool,
) -> list[dict]:
    """Build 5-step progress pipeline for a Material Request."""
    if docstatus == 0:
        return [
            {"label": "申请草稿", "state": "active"},
            {"label": "采购下单", "state": "pending"},
            {"label": "仓库入库", "state": "pending"},
            {"label": "发票结算", "state": "pending"},
        ]

    has_po = ordered_qty > 0.0001
    fully_ordered = total_qty > 0 and ordered_qty >= (total_qty - 0.0001)
    has_pr = received_qty > 0.0001
    fully_received = total_qty > 0 and received_qty >= (total_qty - 0.0001)
    has_pi = billed_amt > 0.01

    step1 = {"label": "申请已批", "state": "done"}
    if fully_ordered:
        step2 = {"label": "已下单", "state": "done"}
    elif has_po:
        step2 = {"label": "部分下单", "state": "active"}
    else:
        step2 = {"label": "待下单", "state": "active"}

    if fully_received:
        step3 = {"label": "已入库", "state": "done"}
    elif has_pr:
        step3 = {"label": "部分入库", "state": "active"}
    else:
        step3 = {"label": "待入库", "state": "active" if has_po else "pending"}

    if paid_done:
        step4 = {"label": "已付款", "state": "done"}
    elif has_pi or (po_total_amt > 0 and billed_amt >= po_total_amt - 0.01):
        step4 = {"label": "已登票", "state": "active"}
    else:
        step4 = {"label": "待开票/付", "state": "pending"}

    return [step1, step2, step3, step4]


def _query_mine_overview(companies: tuple[str, ...], user: str, caps: dict[str, bool]) -> dict:
    """Compute user-scoped overview counters across all procurement branches."""
    # 1. Material Requests owned by current user
    mr_rows = frappe.db.sql(
        """
        SELECT
            mr.name,
            mr.docstatus,
            mr.status,
            COALESCE(SUM(mri.stock_qty), 0) AS total_qty,
            COALESCE(SUM(LEAST(mri.stock_qty, COALESCE(mri.ordered_qty, 0))), 0) AS ordered_qty,
            COALESCE(SUM(LEAST(mri.stock_qty, COALESCE(mri.received_qty, 0))), 0) AS received_qty
        FROM `tabMaterial Request` mr
        LEFT JOIN `tabMaterial Request Item` mri ON mri.parent = mr.name
        WHERE mr.company IN %(companies)s
          AND mr.material_request_type = 'Purchase'
          AND mr.owner = %(user)s
          AND mr.docstatus < 2
        GROUP BY mr.name, mr.docstatus, mr.status
        ORDER BY mr.modified DESC
        """,
        {"companies": companies, "user": user},
        as_dict=True,
    )
    mr_draft = sum(1 for r in mr_rows if r.docstatus == 0)
    mr_pending_order = sum(
        1 for r in mr_rows
        if r.docstatus == 1
        and r.status not in ("Stopped", "Cancelled", "Transfer", "Completed")
        and flt(r.total_qty) - flt(r.ordered_qty) > 0.0001
    )
    mr_ordered_active = sum(
        1 for r in mr_rows
        if r.docstatus == 1
        and flt(r.ordered_qty) > 0.0001
        and r.status not in ("Stopped", "Cancelled", "Completed", "Received")
    )

    # 2. Purchase Orders linked to user's MRs (or owned by user if po_read)
    po_from_my_mr = frappe.db.sql(
        """
        SELECT DISTINCT
            po.name,
            po.docstatus,
            po.status,
            CASE WHEN EXISTS (
                SELECT 1 FROM `tabPurchase Order Item` poi2
                WHERE poi2.parent = po.name
                  AND (poi2.qty - COALESCE(poi2.received_qty, 0)) > 0.0001
            ) THEN 1 ELSE 0 END AS has_pending_receipt
        FROM `tabPurchase Order` po
        INNER JOIN `tabPurchase Order Item` poi ON poi.parent = po.name
        INNER JOIN `tabMaterial Request` mr ON mr.name = poi.material_request
        WHERE po.company IN %(companies)s
          AND po.docstatus < 2
          AND mr.owner = %(user)s
        ORDER BY po.modified DESC
        """,
        {"companies": companies, "user": user},
        as_dict=True,
    )
    po_in_progress = sum(
        1 for p in po_from_my_mr
        if p.docstatus == 1
        and p.status not in ("Closed", "Cancelled", "Delivered", "Completed")
        and p.has_pending_receipt
    )
    po_total_linked = len(po_from_my_mr)

    # 3. Purchase Receipts linked to user's MRs, user's Reimbursements, or owned by user
    pr_rows = frappe.db.sql(
        """
        SELECT DISTINCT
            pr.name,
            pr.docstatus,
            pr.status,
            COALESCE(pr.custom_biz_mode, '') AS biz_mode,
            CASE WHEN EXISTS (
                SELECT 1 FROM `tabPurchase Receipt Item` pri2
                WHERE pri2.parent = pr.name
                  AND (pri2.amount - COALESCE(pri2.billed_amt, 0)) > 0.01
            ) THEN 1 ELSE 0 END AS has_unbilled
        FROM `tabPurchase Receipt` pr
        LEFT JOIN `tabPurchase Receipt Item` pri ON pri.parent = pr.name
        LEFT JOIN `tabMaterial Request` mr ON mr.name = pri.material_request
        LEFT JOIN `tabPurchase Invoice Item` pii ON pii.purchase_receipt = pr.name
        LEFT JOIN `tabReimbursement Invoice Item` rii ON rii.source_pi = pii.parent
        LEFT JOIN `tabReimbursement Request` rr ON rr.name = rii.parent
        WHERE pr.company IN %(companies)s
          AND pr.docstatus = 1
          AND (mr.owner = %(user)s OR rr.owner = %(user)s OR pr.owner = %(user)s)
        ORDER BY pr.modified DESC
        """,
        {"companies": companies, "user": user},
        as_dict=True,
    )
    pr_pending_invoice = sum(
        1 for r in pr_rows
        if r.has_unbilled and r.status not in ("Closed", "Cancelled", "Return Issued")
    )
    pr_monthly_rows = [r for r in pr_rows if r.biz_mode == "月结补录"]
    pr_monthly_pending = sum(1 for r in pr_monthly_rows if r.has_unbilled)

    # 4. Purchase Invoices linked to user's MRs, user's Reimbursements, or owned by user
    pi_rows = frappe.db.sql(
        """
        SELECT DISTINCT
            pi.name,
            pi.docstatus,
            pi.outstanding_amount,
            COALESCE(pi.custom_biz_mode, '') AS biz_mode
        FROM `tabPurchase Invoice` pi
        LEFT JOIN `tabPurchase Invoice Item` pii ON pii.parent = pi.name
        LEFT JOIN `tabMaterial Request` mr ON mr.name = pii.material_request
        LEFT JOIN `tabReimbursement Invoice Item` rii ON rii.source_pi = pi.name
        LEFT JOIN `tabReimbursement Request` rr ON rr.name = rii.parent
        WHERE pi.company IN %(companies)s
          AND pi.docstatus = 1
          AND (mr.owner = %(user)s OR rr.owner = %(user)s OR pi.owner = %(user)s)
        ORDER BY pi.modified DESC
        """,
        {"companies": companies, "user": user},
        as_dict=True,
    )
    pi_unpaid = sum(1 for p in pi_rows if flt(p.outstanding_amount) > 0.01)
    pi_from_monthly = sum(1 for p in pi_rows if p.biz_mode == "月结补录")
    pi_from_reim = sum(1 for p in pi_rows if p.biz_mode == "现金报销")
    pi_from_wire = sum(1 for p in pi_rows if p.biz_mode in ("自办电汇", "电汇申请"))
    pi_from_std = len(pi_rows) - pi_from_monthly - pi_from_reim - pi_from_wire

    # 5. Reimbursement Requests owned by current user
    rr_rows = frappe.db.sql(
        """
        SELECT
            rr.name,
            rr.docstatus,
            rr.outstanding_amount,
            COALESCE(rr.custom_biz_mode, '') AS biz_mode
        FROM `tabReimbursement Request` rr
        WHERE rr.company IN %(companies)s
          AND rr.owner = %(user)s
          AND rr.docstatus < 2
        ORDER BY rr.modified DESC
        """,
        {"companies": companies, "user": user},
        as_dict=True,
    )
    reim_draft = sum(1 for r in rr_rows if r.docstatus == 0)
    reim_pending_pay = sum(1 for r in rr_rows if r.docstatus == 1 and flt(r.outstanding_amount) > 0.01)
    reim_completed = sum(1 for r in rr_rows if r.docstatus == 1 and flt(r.outstanding_amount) <= 0.01)

    reim_backwritten_pr = frappe.db.sql(
        """
        SELECT COUNT(DISTINCT pr.name)
        FROM `tabPurchase Receipt` pr
        WHERE pr.company IN %(companies)s
          AND pr.docstatus = 1
          AND COALESCE(pr.custom_biz_mode, '') = '现金报销'
          AND (
              pr.owner = %(user)s
              OR EXISTS (
                  SELECT 1 FROM `tabPurchase Invoice Item` pii
                  INNER JOIN `tabReimbursement Invoice Item` rii ON rii.source_pi = pii.parent
                  INNER JOIN `tabReimbursement Request` rr ON rr.name = rii.parent
                  WHERE pii.purchase_receipt = pr.name AND rr.owner = %(user)s
              )
          )
        """,
        {"companies": companies, "user": user},
    )[0][0] or 0
    reim_backwritten_pi = pi_from_reim

    # 6. Wire transfer invoices owned by user
    wire_total = pi_from_wire
    wire_unpaid = sum(
        1 for p in pi_rows
        if p.biz_mode in ("自办电汇", "电汇申请") and flt(p.outstanding_amount) > 0.01
    )

    # 7. Payment Entries linked to user's PIs or RRs (or owned by user)
    pe_rows = frappe.db.sql(
        """
        SELECT DISTINCT pe.name
        FROM `tabPayment Entry` pe
        LEFT JOIN `tabPayment Entry Reference` per ON per.parent = pe.name
        LEFT JOIN `tabPurchase Invoice Item` pii
            ON per.reference_doctype = 'Purchase Invoice' AND pii.parent = per.reference_name
        LEFT JOIN `tabMaterial Request` mr ON mr.name = pii.material_request
        LEFT JOIN `tabReimbursement Request` rr
            ON per.reference_doctype = 'Reimbursement Request' AND rr.name = per.reference_name
        WHERE pe.company IN %(companies)s
          AND pe.docstatus = 1
          AND pe.payment_type = 'Pay'
          AND (mr.owner = %(user)s OR rr.owner = %(user)s OR pe.owner = %(user)s)
        ORDER BY pe.modified DESC
        """,
        {"companies": companies, "user": user},
        as_dict=True,
    )

    # 8. Draft Stock Issues owned by user
    se_draft_cnt = 0
    if caps.get("se_read"):
        se_draft_cnt = frappe.db.sql(
            """
            SELECT COUNT(name)
            FROM `tabStock Entry`
            WHERE company IN %(companies)s
              AND docstatus = 0
              AND purpose IN ('Material Issue', 'Manufacture', 'Material Transfer')
              AND owner = %(user)s
            """,
            {"companies": companies, "user": user},
        )[0][0] or 0

    return {
        "mr": {
            "access_mode": _node_access_mode(caps["mr_read"], len(mr_rows)),
            "primary_count": mr_pending_order,
            "secondary_count": mr_draft,
            "tertiary_count": mr_ordered_active,
            "total_count": len(mr_rows),
            "metrics": [
                {"label": "草稿", "value": mr_draft},
                {"label": "待下单", "value": mr_pending_order},
                {"label": "已下单采购中", "value": mr_ordered_active},
            ],
        },
        "po": {
            "access_mode": _node_access_mode(caps["po_read"], po_total_linked),
            "primary_count": po_in_progress,
            "total_count": po_total_linked,
            "metrics": [
                {"label": "正在采购/待入库", "value": po_in_progress},
                {"label": "关联采购单", "value": po_total_linked},
            ],
        },
        "pr": {
            "access_mode": _node_access_mode(caps["pr_read"], len(pr_rows)),
            "primary_count": pr_pending_invoice,
            "total_count": len(pr_rows),
            "stock_issue_drafts": int(se_draft_cnt),
            "metrics": [
                {"label": "已入库单", "value": len(pr_rows)},
                {"label": "待开票核对", "value": pr_pending_invoice},
            ],
        },
        "pi": {
            "access_mode": _node_access_mode(caps["pi_read"], len(pi_rows)),
            "primary_count": pi_unpaid,
            "total_count": len(pi_rows),
            "metrics": [
                {"label": "待结/待付", "value": pi_unpaid},
                {"label": "累计发票", "value": len(pi_rows)},
            ],
            "origins": {
                "standard": pi_from_std,
                "monthly": pi_from_monthly,
                "reim": pi_from_reim,
                "wire": pi_from_wire,
            },
        },
        "rr": {
            "access_mode": _node_access_mode(caps["rr_read"], len(rr_rows)),
            "primary_count": reim_pending_pay + reim_draft,
            "total_count": len(rr_rows),
            "metrics": [
                {"label": "草稿", "value": reim_draft},
                {"label": "待结款", "value": reim_pending_pay},
                {"label": "已结清", "value": reim_completed},
            ],
        },
        "pe": {
            "access_mode": _node_access_mode(caps["pe_read"], len(pe_rows)),
            "primary_count": pi_unpaid,
            "total_count": len(pe_rows),
            "metrics": [
                {"label": "待付款发票", "value": pi_unpaid},
                {"label": "已付款单", "value": len(pe_rows)},
            ],
        },
        "monthly": {
            "access_mode": _node_access_mode(caps["pr_read"] and caps["po_create"], len(pr_monthly_rows)),
            "primary_count": pr_monthly_pending,
            "total_count": len(pr_monthly_rows),
            "metrics": [
                {"label": "待开票入库", "value": pr_monthly_pending},
                {"label": "月结入库单", "value": len(pr_monthly_rows)},
            ],
        },
        "reim": {
            "access_mode": _node_access_mode(caps["rr_read"], len(rr_rows)),
            "primary_count": reim_pending_pay + reim_draft,
            "total_count": len(rr_rows),
            "backwritten_pr": int(reim_backwritten_pr),
            "backwritten_pi": int(reim_backwritten_pi),
            "metrics": [
                {"label": "草稿", "value": reim_draft},
                {"label": "待结款", "value": reim_pending_pay},
                {"label": "反写入库", "value": int(reim_backwritten_pr)},
                {"label": "反写发票", "value": int(reim_backwritten_pi)},
            ],
        },
        "wire": {
            "access_mode": _node_access_mode(caps["pi_read"] and caps["pi_create"], wire_total),
            "primary_count": wire_unpaid,
            "total_count": wire_total,
            "metrics": [
                {"label": "待付电汇", "value": wire_unpaid},
                {"label": "电汇单据", "value": wire_total},
            ],
        },
    }


def _query_company_overview(companies: tuple[str, ...], caps: dict[str, bool]) -> dict:
    """Compute company-wide operational backlog overview gated by DocType permissions."""
    mr_draft = mr_pending = mr_ordered = 0
    if caps["mr_read"]:
        mr_stats = frappe.db.sql(
            """
            SELECT
                SUM(CASE WHEN docstatus = 0 THEN 1 ELSE 0 END) AS draft_cnt,
                SUM(CASE WHEN docstatus = 1 AND status NOT IN ('Stopped', 'Cancelled', 'Transfer', 'Completed')
                              AND EXISTS (
                                  SELECT 1 FROM `tabMaterial Request Item` mri
                                  WHERE mri.parent = mr.name
                                    AND (mri.stock_qty - COALESCE(mri.ordered_qty, 0)) > 0.0001
                              ) THEN 1 ELSE 0 END) AS pending_cnt,
                SUM(CASE WHEN docstatus = 1 AND status NOT IN ('Stopped', 'Cancelled', 'Completed', 'Received')
                              AND EXISTS (
                                  SELECT 1 FROM `tabMaterial Request Item` mri
                                  WHERE mri.parent = mr.name
                                    AND COALESCE(mri.ordered_qty, 0) > 0.0001
                              ) THEN 1 ELSE 0 END) AS ordered_cnt
            FROM `tabMaterial Request` mr
            WHERE mr.company IN %(companies)s
              AND mr.material_request_type = 'Purchase'
              AND mr.docstatus < 2
            """,
            {"companies": companies},
            as_dict=True,
        )[0]
        mr_draft = int(mr_stats.draft_cnt or 0)
        mr_pending = int(mr_stats.pending_cnt or 0)
        mr_ordered = int(mr_stats.ordered_cnt or 0)

    po_pending_pr = po_total = 0
    if caps["po_read"]:
        po_stats = frappe.db.sql(
            """
            SELECT
                COUNT(po.name) AS total_cnt,
                SUM(CASE WHEN po.docstatus = 1
                              AND po.status NOT IN ('Closed', 'Cancelled', 'Delivered', 'Completed')
                              AND EXISTS (
                                  SELECT 1 FROM `tabPurchase Order Item` poi
                                  WHERE poi.parent = po.name
                                    AND (poi.qty - COALESCE(poi.received_qty, 0)) > 0.0001
                              ) THEN 1 ELSE 0 END) AS pending_cnt
            FROM `tabPurchase Order` po
            WHERE po.company IN %(companies)s
              AND po.docstatus < 2
            """,
            {"companies": companies},
            as_dict=True,
        )[0]
        po_total = int(po_stats.total_cnt or 0)
        po_pending_pr = int(po_stats.pending_cnt or 0)

    pr_pending_pi = pr_total = monthly_pending = monthly_total = 0
    if caps["pr_read"]:
        pr_stats = frappe.db.sql(
            """
            SELECT
                COUNT(pr.name) AS total_cnt,
                SUM(CASE WHEN pr.status NOT IN ('Closed', 'Cancelled', 'Return Issued')
                              AND EXISTS (
                                  SELECT 1 FROM `tabPurchase Receipt Item` pri
                                  WHERE pri.parent = pr.name
                                    AND (pri.amount - COALESCE(pri.billed_amt, 0)) > 0.01
                              ) THEN 1 ELSE 0 END) AS pending_cnt,
                SUM(CASE WHEN COALESCE(pr.custom_biz_mode, '') = '月结补录' THEN 1 ELSE 0 END) AS monthly_total,
                SUM(CASE WHEN COALESCE(pr.custom_biz_mode, '') = '月结补录'
                              AND pr.status NOT IN ('Closed', 'Cancelled', 'Return Issued')
                              AND EXISTS (
                                  SELECT 1 FROM `tabPurchase Receipt Item` pri
                                  WHERE pri.parent = pr.name
                                    AND (pri.amount - COALESCE(pri.billed_amt, 0)) > 0.01
                              ) THEN 1 ELSE 0 END) AS monthly_pending
            FROM `tabPurchase Receipt` pr
            WHERE pr.company IN %(companies)s
              AND pr.docstatus = 1
            """,
            {"companies": companies},
            as_dict=True,
        )[0]
        pr_total = int(pr_stats.total_cnt or 0)
        pr_pending_pi = int(pr_stats.pending_cnt or 0)
        monthly_total = int(pr_stats.monthly_total or 0)
        monthly_pending = int(pr_stats.monthly_pending or 0)

    pi_unpaid = pi_total = pi_std = pi_monthly = pi_reim = pi_wire = wire_unpaid = 0
    if caps["pi_read"]:
        pi_stats = frappe.db.sql(
            """
            SELECT
                COUNT(pi.name) AS total_cnt,
                SUM(CASE WHEN pi.outstanding_amount > 0.01 THEN 1 ELSE 0 END) AS unpaid_cnt,
                SUM(CASE WHEN COALESCE(pi.custom_biz_mode, '') = '月结补录' THEN 1 ELSE 0 END) AS monthly_cnt,
                SUM(CASE WHEN COALESCE(pi.custom_biz_mode, '') = '现金报销' THEN 1 ELSE 0 END) AS reim_cnt,
                SUM(CASE WHEN COALESCE(pi.custom_biz_mode, '') IN ('自办电汇', '电汇申请') THEN 1 ELSE 0 END) AS wire_cnt,
                SUM(CASE WHEN COALESCE(pi.custom_biz_mode, '') IN ('自办电汇', '电汇申请')
                              AND pi.outstanding_amount > 0.01 THEN 1 ELSE 0 END) AS wire_unpaid_cnt
            FROM `tabPurchase Invoice` pi
            WHERE pi.company IN %(companies)s
              AND pi.docstatus = 1
            """,
            {"companies": companies},
            as_dict=True,
        )[0]
        pi_total = int(pi_stats.total_cnt or 0)
        pi_unpaid = int(pi_stats.unpaid_cnt or 0)
        pi_monthly = int(pi_stats.monthly_cnt or 0)
        pi_reim = int(pi_stats.reim_cnt or 0)
        pi_wire = int(pi_stats.wire_cnt or 0)
        wire_unpaid = int(pi_stats.wire_unpaid_cnt or 0)
        pi_std = max(0, pi_total - pi_monthly - pi_reim - pi_wire)

    rr_draft = rr_pending = rr_completed = rr_total = reim_pr_cnt = reim_pi_cnt = 0
    if caps["rr_read"]:
        rr_stats = frappe.db.sql(
            """
            SELECT
                COUNT(rr.name) AS total_cnt,
                SUM(CASE WHEN rr.docstatus = 0 THEN 1 ELSE 0 END) AS draft_cnt,
                SUM(CASE WHEN rr.docstatus = 1 AND rr.outstanding_amount > 0.01 THEN 1 ELSE 0 END) AS pending_cnt,
                SUM(CASE WHEN rr.docstatus = 1 AND rr.outstanding_amount <= 0.01 THEN 1 ELSE 0 END) AS completed_cnt
            FROM `tabReimbursement Request` rr
            WHERE rr.company IN %(companies)s
              AND rr.docstatus < 2
            """,
            {"companies": companies},
            as_dict=True,
        )[0]
        rr_total = int(rr_stats.total_cnt or 0)
        rr_draft = int(rr_stats.draft_cnt or 0)
        rr_pending = int(rr_stats.pending_cnt or 0)
        rr_completed = int(rr_stats.completed_cnt or 0)

        reim_pr_cnt = frappe.db.sql(
            """
            SELECT COUNT(name)
            FROM `tabPurchase Receipt`
            WHERE company IN %(companies)s
              AND docstatus = 1
              AND COALESCE(custom_biz_mode, '') = '现金报销'
            """,
            {"companies": companies},
        )[0][0] or 0
        reim_pi_cnt = pi_reim

    pe_total = 0
    if caps["pe_read"]:
        pe_total = frappe.db.sql(
            """
            SELECT COUNT(name)
            FROM `tabPayment Entry`
            WHERE company IN %(companies)s
              AND docstatus = 1
              AND payment_type = 'Pay'
            """,
            {"companies": companies},
        )[0][0] or 0

    se_draft_cnt = 0
    if caps["se_read"]:
        se_draft_cnt = frappe.db.sql(
            """
            SELECT COUNT(name)
            FROM `tabStock Entry`
            WHERE company IN %(companies)s
              AND docstatus = 0
              AND purpose IN ('Material Issue', 'Manufacture', 'Material Transfer')
            """,
            {"companies": companies},
        )[0][0] or 0

    return {
        "mr": {
            "access_mode": "operable" if caps["mr_read"] else "restricted_muted",
            "primary_count": mr_pending,
            "secondary_count": mr_draft,
            "tertiary_count": mr_ordered,
            "total_count": mr_draft + mr_pending + mr_ordered,
            "metrics": [
                {"label": "草稿", "value": mr_draft},
                {"label": "待采购订货", "value": mr_pending},
                {"label": "采购中", "value": mr_ordered},
            ],
        },
        "po": {
            "access_mode": "operable" if caps["po_read"] else "restricted_muted",
            "primary_count": po_pending_pr,
            "total_count": po_total,
            "metrics": [
                {"label": "在途待入库", "value": po_pending_pr},
                {"label": "有效采购单", "value": po_total},
            ],
        },
        "pr": {
            "access_mode": "operable" if caps["pr_read"] else "restricted_muted",
            "primary_count": pr_pending_pi,
            "total_count": pr_total,
            "stock_issue_drafts": int(se_draft_cnt),
            "metrics": [
                {"label": "待开票入库", "value": pr_pending_pi},
                {"label": "已入库单", "value": pr_total},
            ],
        },
        "pi": {
            "access_mode": "operable" if caps["pi_read"] else "restricted_muted",
            "primary_count": pi_unpaid,
            "total_count": pi_total,
            "metrics": [
                {"label": "待付/待整算", "value": pi_unpaid},
                {"label": "已登发票", "value": pi_total},
            ],
            "origins": {
                "standard": pi_std,
                "monthly": pi_monthly,
                "reim": pi_reim,
                "wire": pi_wire,
            },
        },
        "rr": {
            "access_mode": "operable" if caps["rr_read"] else "restricted_muted",
            "primary_count": rr_pending + rr_draft,
            "total_count": rr_total,
            "metrics": [
                {"label": "草稿", "value": rr_draft},
                {"label": "待结款", "value": rr_pending},
                {"label": "已结清", "value": rr_completed},
            ],
        },
        "pe": {
            "access_mode": "operable" if caps["pe_read"] else "restricted_muted",
            "primary_count": pi_unpaid,
            "total_count": int(pe_total),
            "metrics": [
                {"label": "待付款发票", "value": pi_unpaid},
                {"label": "已付款单", "value": int(pe_total)},
            ],
        },
        "monthly": {
            "access_mode": "operable" if (caps["pr_read"] and caps["po_create"]) else ("tracked_readonly" if caps["pr_read"] else "restricted_muted"),
            "primary_count": monthly_pending,
            "total_count": monthly_total,
            "metrics": [
                {"label": "待开票入库", "value": monthly_pending},
                {"label": "月结入库单", "value": monthly_total},
            ],
        },
        "reim": {
            "access_mode": "operable" if caps["rr_read"] else "restricted_muted",
            "primary_count": rr_pending + rr_draft,
            "total_count": rr_total,
            "backwritten_pr": int(reim_pr_cnt),
            "backwritten_pi": int(reim_pi_cnt),
            "metrics": [
                {"label": "草稿", "value": rr_draft},
                {"label": "待结款", "value": rr_pending},
                {"label": "反写入库", "value": int(reim_pr_cnt)},
                {"label": "反写发票", "value": int(reim_pi_cnt)},
            ],
        },
        "wire": {
            "access_mode": "operable" if (caps["pi_read"] and caps["pi_create"]) else ("tracked_readonly" if caps["pi_read"] else "restricted_muted"),
            "primary_count": wire_unpaid,
            "total_count": pi_wire,
            "metrics": [
                {"label": "待付电汇", "value": wire_unpaid},
                {"label": "电汇单据", "value": pi_wire},
            ],
        },
    }


@frappe.whitelist(methods=["GET", "POST"])
def get_procurement_flow_overview(company: str | None = None, scope: str = "mine") -> dict:
    """Return permission-aware procurement business flow overview metrics."""
    accessible, target_companies, active_company = _resolve_scope_companies(company)
    caps = _get_capabilities()
    effective_scope, can_view_company = _resolve_effective_scope(scope, caps)

    if not target_companies:
        return {
            "companies": [],
            "active_company": "",
            "scope": effective_scope,
            "can_view_company_scope": can_view_company,
            "capabilities": caps,
            "nodes": {},
        }

    comp_tuple = tuple(target_companies)
    nodes = (
        _query_company_overview(comp_tuple, caps)
        if effective_scope == "company"
        else _query_mine_overview(comp_tuple, frappe.session.user, caps)
    )

    return {
        "companies": accessible,
        "active_company": active_company,
        "scope": effective_scope,
        "can_view_company_scope": can_view_company,
        "capabilities": caps,
        "nodes": nodes,
    }


def _query_sanitized_mr_progress_rows(
    companies: tuple[str, ...],
    user: str,
    node_key: str,
) -> list[dict]:
    """Query strictly redacted downstream progress rows for requester's own Material Requests."""
    raw = frappe.db.sql(
        """
        SELECT
            mr.name AS mr_name,
            mr.company,
            mr.transaction_date,
            mr.docstatus,
            mr.status,
            COALESCE(mr.custom_doc_details, '') AS doc_details,
            COALESCE(SUM(mri.stock_qty), 0) AS total_qty,
            COALESCE(SUM(LEAST(mri.stock_qty, COALESCE(mri.ordered_qty, 0))), 0) AS ordered_qty,
            COALESCE(SUM(LEAST(mri.stock_qty, COALESCE(mri.received_qty, 0))), 0) AS received_qty,
            MAX(po.schedule_date) AS eta_date,
            COUNT(DISTINCT po.name) AS po_count,
            COUNT(DISTINCT pr.name) AS pr_count,
            COUNT(DISTINCT pi.name) AS pi_count,
            COUNT(DISTINCT CASE WHEN pi.outstanding_amount > 0.01 THEN pi.name END) AS pi_unpaid_count
        FROM `tabMaterial Request` mr
        LEFT JOIN `tabMaterial Request Item` mri ON mri.parent = mr.name
        LEFT JOIN `tabPurchase Order Item` poi
            ON poi.material_request_item = mri.name
            OR (COALESCE(poi.material_request_item, '') = '' AND poi.material_request = mr.name)
        LEFT JOIN `tabPurchase Order` po ON po.name = poi.parent AND po.docstatus < 2
        LEFT JOIN `tabPurchase Receipt Item` pri
            ON pri.material_request_item = mri.name
            OR (COALESCE(pri.material_request_item, '') = '' AND pri.material_request = mr.name)
        LEFT JOIN `tabPurchase Receipt` pr ON pr.name = pri.parent AND pr.docstatus = 1
        LEFT JOIN `tabPurchase Invoice Item` pii ON pii.material_request = mr.name
        LEFT JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent AND pi.docstatus = 1
        WHERE mr.company IN %(companies)s
          AND mr.material_request_type = 'Purchase'
          AND mr.owner = %(user)s
          AND mr.docstatus < 2
        GROUP BY mr.name, mr.company, mr.transaction_date, mr.docstatus, mr.status, mr.custom_doc_details
        ORDER BY (CASE WHEN mr.docstatus = 0 THEN 0 ELSE 1 END) ASC, mr.transaction_date DESC, mr.name DESC
        LIMIT 100
        """,
        {"companies": companies, "user": user},
        as_dict=True,
    )

    rows = []
    for r in raw:
        total_qty = flt(r.total_qty)
        ordered_qty = flt(r.ordered_qty)
        received_qty = flt(r.received_qty)
        po_cnt = int(r.po_count or 0)
        pr_cnt = int(r.pr_count or 0)
        pi_cnt = int(r.pi_count or 0)
        pi_unpaid_cnt = int(r.pi_unpaid_count or 0)

        if node_key == "po" and po_cnt == 0:
            continue
        if node_key == "pr" and pr_cnt == 0 and ordered_qty <= 0.0001:
            continue
        if node_key in ("pi", "pe") and pi_cnt == 0:
            continue

        paid_done = pi_cnt > 0 and pi_unpaid_cnt == 0
        if r.docstatus == 0:
            stage_status = "申请草稿"
        elif ordered_qty <= 0.0001:
            stage_status = "待采购订货"
        elif received_qty < total_qty - 0.0001:
            stage_status = "已下单采购中"
        elif paid_done:
            stage_status = "已入库并结清"
        else:
            stage_status = "已入库"

        rows.append({
            "docname": r.mr_name,
            "doctype": "Material Request",
            "company": r.company,
            "posting_date": str(r.transaction_date or ""),
            "eta_date": str(r.eta_date or "") if r.eta_date else "-",
            "status_label": stage_status,
            "item_summary": r.doc_details or "-",
            "progress_text": f"已下单 {_fmt_qty(ordered_qty)}/{_fmt_qty(total_qty)} · 已入库 {_fmt_qty(received_qty)}/{_fmt_qty(total_qty)}",
            "supplier": None,
            "amount": None,
            "redacted": True,
            "steps": _build_mr_pipeline(
                docstatus=int(r.docstatus),
                status=r.status or "",
                ordered_qty=ordered_qty,
                total_qty=total_qty,
                received_qty=received_qty,
                billed_amt=1.0 if pi_cnt > 0 else 0.0,
                po_total_amt=0.0,
                paid_done=paid_done,
            ),
        })
    return rows


@frappe.whitelist(methods=["GET", "POST"])
def get_procurement_flow_node_records(
    node_key: str,
    company: str | None = None,
    scope: str = "mine",
) -> dict:
    """Return drill-down records for one node in 采购业务流程总览 with permission redaction."""
    if node_key not in NODE_META:
        frappe.throw(_("未知的流程节点：{0}").format(node_key))

    accessible, target_companies, active_company = _resolve_scope_companies(company)
    caps = _get_capabilities()
    effective_scope, can_view_company = _resolve_effective_scope(scope, caps)
    user = frappe.session.user

    if not target_companies:
        return {"node_key": node_key, "redacted": False, "access_mode": "restricted_muted", "rows": []}

    comp_tuple = tuple(target_companies)
    owner_only = effective_scope == "mine"

    doctype_perm_map = {
        "mr": caps["mr_read"],
        "po": caps["po_read"],
        "pr": caps["pr_read"],
        "pi": caps["pi_read"],
        "rr": caps["rr_read"],
        "pe": caps["pe_read"],
        "monthly": caps["pr_read"],
        "reim": caps["rr_read"],
        "wire": caps["pi_read"],
    }
    has_perm = doctype_perm_map.get(node_key, False)

    # Redacted requester progress path when user lacks read permission on downstream node
    if not has_perm:
        if node_key in ("po", "pr", "pi", "pe") and caps["mr_read"]:
            rows = _query_sanitized_mr_progress_rows(comp_tuple, user, node_key)
            return {
                "node_key": node_key,
                "redacted": True,
                "access_mode": "tracked_readonly" if rows else "restricted_muted",
                "rows": rows,
            }
        return {
            "node_key": node_key,
            "redacted": True,
            "access_mode": "restricted_muted",
            "rows": [],
        }

    # Authorized full read paths
    rows: list[dict] = []
    if node_key == "mr":
        raw = frappe.db.sql(
            """
            SELECT
                mr.name AS docname,
                mr.company,
                mr.transaction_date,
                mr.docstatus,
                mr.status,
                mr.owner,
                COALESCE(mr.custom_doc_details, '') AS doc_details,
                COALESCE(SUM(mri.stock_qty), 0) AS total_qty,
                COALESCE(SUM(LEAST(mri.stock_qty, COALESCE(mri.ordered_qty, 0))), 0) AS ordered_qty,
                COALESCE(SUM(LEAST(mri.stock_qty, COALESCE(mri.received_qty, 0))), 0) AS received_qty,
                COALESCE(SUM(mri.amount), 0) AS total_amount
            FROM `tabMaterial Request` mr
            LEFT JOIN `tabMaterial Request Item` mri ON mri.parent = mr.name
            WHERE mr.company IN %(companies)s
              AND mr.material_request_type = 'Purchase'
              AND mr.docstatus < 2
              AND (%(owner_only)s = 0 OR mr.owner = %(user)s)
            GROUP BY mr.name, mr.company, mr.transaction_date, mr.docstatus, mr.status, mr.owner, mr.custom_doc_details
            ORDER BY (CASE WHEN mr.docstatus = 0 THEN 0 ELSE 1 END) ASC, mr.transaction_date DESC, mr.name DESC
            LIMIT 100
            """,
            {"companies": comp_tuple, "owner_only": 1 if owner_only else 0, "user": user},
            as_dict=True,
        )
        raw = filter_rows_by_doctype_permission(raw, "Material Request", "docname")
        for r in raw:
            total_qty = flt(r.total_qty)
            ordered_qty = flt(r.ordered_qty)
            received_qty = flt(r.received_qty)
            if r.docstatus == 0:
                status_label = "草稿"
            elif ordered_qty <= 0.0001:
                status_label = "待采购订货"
            elif received_qty < total_qty - 0.0001:
                status_label = "采购中"
            else:
                status_label = "已入库"
            rows.append({
                "docname": r.docname,
                "doctype": "Material Request",
                "company": r.company,
                "posting_date": str(r.transaction_date or ""),
                "status_label": status_label,
                "item_summary": r.doc_details or "-",
                "progress_text": f"已下单 {_fmt_qty(ordered_qty)}/{_fmt_qty(total_qty)} · 已入库 {_fmt_qty(received_qty)}/{_fmt_qty(total_qty)}",
                "supplier": "-",
                "amount": flt(r.total_amount, 2),
                "owner": r.owner,
                "redacted": False,
                "steps": _build_mr_pipeline(
                    docstatus=int(r.docstatus),
                    status=r.status or "",
                    ordered_qty=ordered_qty,
                    total_qty=total_qty,
                    received_qty=received_qty,
                    billed_amt=0.0,
                    po_total_amt=0.0,
                    paid_done=False,
                ),
            })

    elif node_key == "po":
        raw = frappe.db.sql(
            """
            SELECT DISTINCT
                po.name AS docname,
                po.company,
                po.transaction_date,
                po.schedule_date,
                po.docstatus,
                po.status,
                po.supplier,
                po.grand_total,
                po.owner,
                COALESCE(po.custom_doc_details, '') AS doc_details,
                COALESCE(po.per_received, 0) AS per_received,
                COALESCE(po.per_billed, 0) AS per_billed
            FROM `tabPurchase Order` po
            LEFT JOIN `tabPurchase Order Item` poi ON poi.parent = po.name
            LEFT JOIN `tabMaterial Request` mr ON mr.name = poi.material_request
            WHERE po.company IN %(companies)s
              AND po.docstatus < 2
              AND (%(owner_only)s = 0 OR mr.owner = %(user)s OR po.owner = %(user)s)
            ORDER BY (CASE WHEN po.docstatus = 0 THEN 0 ELSE 1 END) ASC, po.transaction_date DESC, po.name DESC
            LIMIT 100
            """,
            {"companies": comp_tuple, "owner_only": 1 if owner_only else 0, "user": user},
            as_dict=True,
        )
        raw = filter_rows_by_doctype_permission(raw, "Purchase Order", "docname")
        for r in raw:
            per_rec = flt(r.per_received)
            per_bill = flt(r.per_billed)
            if r.docstatus == 0:
                status_label = "草稿"
            elif per_rec < 99.9:
                status_label = "采购中 · 待入库"
            elif per_bill < 99.9:
                status_label = "已入库 · 待开票"
            else:
                status_label = "已完成"
            rows.append({
                "docname": r.docname,
                "doctype": "Purchase Order",
                "company": r.company,
                "posting_date": str(r.transaction_date or ""),
                "eta_date": str(r.schedule_date or "") if r.schedule_date else "-",
                "status_label": status_label,
                "item_summary": r.doc_details or "-",
                "progress_text": f"入库 {per_rec:.0f}% · 开票 {per_bill:.0f}%",
                "supplier": r.supplier or "-",
                "amount": flt(r.grand_total, 2),
                "owner": r.owner,
                "redacted": False,
                "steps": [
                    {"label": "采购下单", "state": "active" if r.docstatus == 0 else "done"},
                    {"label": "采购入库", "state": "done" if per_rec >= 99.9 else ("active" if r.docstatus == 1 else "pending")},
                    {"label": "采购发票", "state": "done" if per_bill >= 99.9 else ("active" if per_rec > 0 else "pending")},
                    {"label": "结算付款", "state": "pending"},
                ],
            })

    elif node_key in ("pr", "monthly"):
        biz_only = 1 if node_key == "monthly" else 0
        raw = frappe.db.sql(
            """
            SELECT DISTINCT
                pr.name AS docname,
                pr.company,
                pr.posting_date,
                pr.status,
                pr.supplier,
                pr.grand_total,
                pr.owner,
                COALESCE(pr.custom_biz_mode, '标准采购') AS biz_mode,
                COALESCE(pr.custom_doc_details, '') AS doc_details,
                COALESCE(pr.per_billed, 0) AS per_billed
            FROM `tabPurchase Receipt` pr
            LEFT JOIN `tabPurchase Receipt Item` pri ON pri.parent = pr.name
            LEFT JOIN `tabMaterial Request` mr ON mr.name = pri.material_request
            WHERE pr.company IN %(companies)s
              AND pr.docstatus = 1
              AND (%(biz_only)s = 0 OR COALESCE(pr.custom_biz_mode, '') = '月结补录')
              AND (%(owner_only)s = 0 OR mr.owner = %(user)s OR pr.owner = %(user)s)
            ORDER BY pr.posting_date DESC, pr.name DESC
            LIMIT 100
            """,
            {
                "companies": comp_tuple,
                "biz_only": biz_only,
                "owner_only": 1 if owner_only else 0,
                "user": user,
            },
            as_dict=True,
        )
        raw = filter_rows_by_doctype_permission(raw, "Purchase Receipt", "docname")
        for r in raw:
            billed = flt(r.per_billed) >= 99.9
            rows.append({
                "docname": r.docname,
                "doctype": "Purchase Receipt",
                "company": r.company,
                "posting_date": str(r.posting_date or ""),
                "status_label": "已开票" if billed else "待开票",
                "biz_mode": r.biz_mode or "标准采购",
                "item_summary": r.doc_details or "-",
                "progress_text": f"来源: {r.biz_mode or '标准采购'} · 开票 {flt(r.per_billed):.0f}%",
                "supplier": r.supplier or "-",
                "amount": flt(r.grand_total, 2),
                "owner": r.owner,
                "redacted": False,
                "steps": [
                    {"label": "月结补录" if r.biz_mode == "月结补录" else "采购入库", "state": "done"},
                    {"label": "采购发票", "state": "done" if billed else "active"},
                    {"label": "结算付款", "state": "pending"},
                ],
            })

    elif node_key in ("pi", "wire"):
        wire_only = 1 if node_key == "wire" else 0
        raw = frappe.db.sql(
            """
            SELECT DISTINCT
                pi.name AS docname,
                pi.company,
                pi.posting_date,
                pi.bill_no,
                pi.supplier,
                pi.grand_total,
                pi.outstanding_amount,
                pi.owner,
                COALESCE(pi.custom_biz_mode, '标准采购') AS biz_mode,
                COALESCE(pi.custom_doc_details, '') AS doc_details
            FROM `tabPurchase Invoice` pi
            LEFT JOIN `tabPurchase Invoice Item` pii ON pii.parent = pi.name
            LEFT JOIN `tabMaterial Request` mr ON mr.name = pii.material_request
            LEFT JOIN `tabReimbursement Invoice Item` rii ON rii.source_pi = pi.name
            LEFT JOIN `tabReimbursement Request` rr ON rr.name = rii.parent
            WHERE pi.company IN %(companies)s
              AND pi.docstatus = 1
              AND (%(wire_only)s = 0 OR COALESCE(pi.custom_biz_mode, '') IN ('自办电汇', '电汇申请'))
              AND (%(owner_only)s = 0 OR mr.owner = %(user)s OR rr.owner = %(user)s OR pi.owner = %(user)s)
            ORDER BY pi.posting_date DESC, pi.name DESC
            LIMIT 100
            """,
            {
                "companies": comp_tuple,
                "wire_only": wire_only,
                "owner_only": 1 if owner_only else 0,
                "user": user,
            },
            as_dict=True,
        )
        raw = filter_rows_by_doctype_permission(raw, "Purchase Invoice", "docname")
        for r in raw:
            paid = flt(r.outstanding_amount) <= 0.01
            rows.append({
                "docname": r.docname,
                "doctype": "Purchase Invoice",
                "company": r.company,
                "posting_date": str(r.posting_date or ""),
                "status_label": "已结清" if paid else "待付款",
                "biz_mode": r.biz_mode or "标准采购",
                "item_summary": r.doc_details or (f"发票号: {r.bill_no}" if r.bill_no else "-"),
                "progress_text": f"来源: {r.biz_mode or '标准采购'} · {'已结清' if paid else f'未付 ¥{flt(r.outstanding_amount):,.2f}'}",
                "supplier": r.supplier or "-",
                "amount": flt(r.grand_total, 2),
                "owner": r.owner,
                "redacted": False,
                "steps": [
                    {"label": r.biz_mode or "标准采购", "state": "done"},
                    {"label": "发票登记", "state": "done"},
                    {"label": "整算/付款", "state": "done" if paid else "active"},
                ],
            })

    elif node_key in ("rr", "reim"):
        raw = frappe.db.sql(
            """
            SELECT
                rr.name AS docname,
                rr.company,
                rr.posting_date,
                rr.docstatus,
                rr.title,
                rr.total_amount,
                rr.outstanding_amount,
                rr.owner,
                COALESCE(rr.custom_biz_mode, '现金报销') AS biz_mode,
                COALESCE(rr.custom_doc_details, '') AS doc_details
            FROM `tabReimbursement Request` rr
            WHERE rr.company IN %(companies)s
              AND rr.docstatus < 2
              AND (%(owner_only)s = 0 OR rr.owner = %(user)s)
            ORDER BY (CASE WHEN rr.docstatus = 0 THEN 0 ELSE 1 END) ASC, rr.posting_date DESC, rr.name DESC
            LIMIT 100
            """,
            {"companies": comp_tuple, "owner_only": 1 if owner_only else 0, "user": user},
            as_dict=True,
        )
        raw = filter_rows_by_doctype_permission(raw, "Reimbursement Request", "docname")
        for r in raw:
            if r.docstatus == 0:
                status_label = "草稿"
            elif flt(r.outstanding_amount) > 0.01:
                status_label = "待结款"
            else:
                status_label = "已结清"
            rows.append({
                "docname": r.docname,
                "doctype": "Reimbursement Request",
                "company": r.company,
                "posting_date": str(r.posting_date or ""),
                "status_label": status_label,
                "biz_mode": r.biz_mode or "现金报销",
                "item_summary": r.doc_details or r.title or "-",
                "progress_text": f"模式: {r.biz_mode or '现金报销'}",
                "supplier": "-",
                "amount": flt(r.total_amount, 2),
                "owner": r.owner,
                "redacted": False,
                "steps": [
                    {"label": "报销建单", "state": "active" if r.docstatus == 0 else "done"},
                    {"label": "反写入库+发票", "state": "done" if r.docstatus == 1 else "pending"},
                    {"label": "财务结款", "state": "done" if status_label == "已结清" else ("active" if r.docstatus == 1 else "pending")},
                ],
            })

    elif node_key == "pe":
        raw = frappe.db.sql(
            """
            SELECT DISTINCT
                pe.name AS docname,
                pe.company,
                pe.posting_date,
                pe.party AS supplier,
                pe.paid_amount,
                pe.mode_of_payment,
                pe.owner,
                COALESCE(pe.custom_biz_mode, '对公付款') AS biz_mode
            FROM `tabPayment Entry` pe
            LEFT JOIN `tabPayment Entry Reference` per ON per.parent = pe.name
            LEFT JOIN `tabPurchase Invoice Item` pii
                ON per.reference_doctype = 'Purchase Invoice' AND pii.parent = per.reference_name
            LEFT JOIN `tabMaterial Request` mr ON mr.name = pii.material_request
            LEFT JOIN `tabReimbursement Request` rr
                ON per.reference_doctype = 'Reimbursement Request' AND rr.name = per.reference_name
            WHERE pe.company IN %(companies)s
              AND pe.docstatus = 1
              AND pe.payment_type = 'Pay'
              AND (%(owner_only)s = 0 OR mr.owner = %(user)s OR rr.owner = %(user)s OR pe.owner = %(user)s)
            ORDER BY pe.posting_date DESC, pe.name DESC
            LIMIT 100
            """,
            {"companies": comp_tuple, "owner_only": 1 if owner_only else 0, "user": user},
            as_dict=True,
        )
        raw = filter_rows_by_doctype_permission(raw, "Payment Entry", "docname")
        for r in raw:
            rows.append({
                "docname": r.docname,
                "doctype": "Payment Entry",
                "company": r.company,
                "posting_date": str(r.posting_date or ""),
                "status_label": "已付款",
                "biz_mode": r.biz_mode or "对公付款",
                "item_summary": f"结算方式: {r.mode_of_payment or '-'}",
                "progress_text": f"渠道: {r.biz_mode or '对公付款'}",
                "supplier": r.supplier or "-",
                "amount": flt(r.paid_amount, 2),
                "owner": r.owner,
                "redacted": False,
                "steps": [
                    {"label": "前置单据", "state": "done"},
                    {"label": "付款核销", "state": "done"},
                ],
            })

    return {
        "node_key": node_key,
        "redacted": False,
        "access_mode": "operable",
        "rows": rows,
    }
