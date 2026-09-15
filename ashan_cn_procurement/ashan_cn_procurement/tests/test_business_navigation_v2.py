from unittest import TestCase

from ashan_cn_procurement import hooks
from ashan_cn_procurement.boot import _resolve_login_home_route


class TestBusinessNavigationV2(TestCase):
    def test_role_aware_login_routes(self):
        self.assertEqual(
            _resolve_login_home_route(["System Manager"]),
            "/desk/Workspaces/Home",
        )
        self.assertEqual(
            _resolve_login_home_route(["Purchase User"]),
            "/desk/Workspaces/Procurement Management",
        )
        self.assertEqual(
            _resolve_login_home_route(["Stock User"]),
            "/desk/Workspaces/Stock and Inventory",
        )
        self.assertEqual(
            _resolve_login_home_route(["Accounts User"]),
            "/desk/Workspaces/Accounting and Finance",
        )
        self.assertEqual(
            _resolve_login_home_route(["Oil Card Operator"]),
            "/desk/oil-card-ledger",
        )
        self.assertEqual(
            _resolve_login_home_route(["HR User"]),
            "/desk/Workspaces/Home",
        )

    def test_procurement_and_reimbursement_form_scripts_are_not_global(self):
        global_js = set(hooks.app_include_js)
        self.assertNotIn(
            "/assets/ashan_cn_procurement/js/purchase_invoice_tax_calculator.js",
            global_js,
        )
        self.assertNotIn(
            "/assets/ashan_cn_procurement/js/reimbursement_request.js",
            global_js,
        )
        self.assertEqual(
            hooks.doctype_js.get("Purchase Invoice"),
            "public/js/purchase_invoice_tax_calculator.js",
        )
        self.assertEqual(
            hooks.doctype_js.get("Reimbursement Request"),
            "public/js/reimbursement_request.js",
        )
