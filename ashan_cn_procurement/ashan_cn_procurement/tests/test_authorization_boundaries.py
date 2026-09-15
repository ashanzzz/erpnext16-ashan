"""Regression tests for custom-module role and company authorization boundaries."""

import unittest
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from ashan_cn_procurement.ashan_cn_procurement.page.environmental_management import (
    environmental_management,
)
from ashan_cn_procurement.ashan_cn_procurement.page.oil_card_ledger import oil_card_ledger
from ashan_cn_procurement.ashan_cn_procurement.page.property_settlement_workbench import (
    property_settlement_workbench,
)
from ashan_cn_procurement.ashan_cn_procurement.page.stock_issue_workbench import (
    stock_issue_workbench,
)
from ashan_cn_procurement.ashan_cn_procurement.page.tax_invoice_center import tax_invoice_center
from ashan_cn_procurement.services import authorization_service


class TestAuthorizationBoundaries(FrappeTestCase):
    """Protect custom workbenches from role and company-scope regressions."""

    def test_module_role_matrix(self):
        """Managers can delete; operators can only perform daily actions."""
        for module, role_pair in authorization_service.MODULE_ACCESS_MODEL.items():
            with self.subTest(module=module, role="manager"):
                with patch.object(
                    authorization_service.frappe,
                    "get_roles",
                    return_value=[role_pair["manager_role"]],
                ):
                    self.assertTrue(
                        authorization_service.assert_module_access(
                            module, "delete", user="audit.manager@example.invalid"
                        )
                    )

            with self.subTest(module=module, role="operator"):
                with patch.object(
                    authorization_service.frappe,
                    "get_roles",
                    return_value=[role_pair["operator_role"]],
                ):
                    self.assertTrue(
                        authorization_service.assert_module_access(
                            module, "write", user="audit.operator@example.invalid"
                        )
                    )
                    with self.assertRaises(frappe.PermissionError):
                        authorization_service.assert_module_access(
                            module, "delete", user="audit.operator@example.invalid"
                        )

    def test_generic_role_cannot_read_custom_modules(self):
        """Legacy generic roles must not bypass custom-module access control."""
        with patch.object(
            authorization_service.frappe,
            "get_roles",
            return_value=["Accounts User"],
        ):
            for module in authorization_service.MODULE_ACCESS_MODEL:
                with self.subTest(module=module):
                    with self.assertRaises(frappe.PermissionError):
                        authorization_service.assert_module_access(
                            module, "read", user="audit.generic@example.invalid"
                        )

    def test_company_scope_rejects_another_company(self):
        """A company permission grants no implicit cross-company access."""
        with patch.object(
            authorization_service,
            "get_allowed_companies",
            return_value={"Company A"},
        ):
            authorization_service.assert_company_access("Company A", user="audit.operator@example.invalid")
            with self.assertRaises(frappe.PermissionError):
                authorization_service.assert_company_access("Company B", user="audit.operator@example.invalid")

    def test_legacy_user_company_field_is_schema_safe(self):
        """Missing legacy User.company columns must not make authorization crash."""
        with patch.object(authorization_service.frappe.db, "has_column", return_value=False):
            with patch.object(authorization_service.frappe.db, "get_value") as get_value:
                self.assertEqual(
                    authorization_service._company_from_user_field("audit.operator@example.invalid"),
                    "",
                )
                get_value.assert_not_called()

    def test_module_read_rpcs_reject_a_generic_role_before_querying_data(self):
        """Direct reader RPCs reject a generic role before any business-data read."""
        readers = {
            "oil_card": oil_card_ledger.get_all_oil_cards,
            "property": lambda: property_settlement_workbench.get_settlement(2026, 8),
            "tax_invoice": tax_invoice_center.get_tax_invoices,
            "environmental": environmental_management.get_environmental_dashboard_data,
        }
        with (
            patch.object(
                authorization_service,
                "_current_user",
                return_value="audit.generic@example.invalid",
            ),
            patch.object(authorization_service.frappe, "get_roles", return_value=["Accounts User"]),
        ):
            for module, reader in readers.items():
                with self.subTest(module=module):
                    with self.assertRaises(frappe.PermissionError):
                        reader()

    def test_stock_meta_uses_only_the_authorized_company_scope(self):
        """Stock metadata must not restore hard-coded or unauthorized companies."""
        company = "Company A"
        warehouse = frappe._dict(name="WH-A", warehouse_name="Warehouse A")
        with (
            patch.object(stock_issue_workbench, "get_allowed_companies", return_value={company}),
            patch.object(stock_issue_workbench, "assert_company_access") as assert_company_access,
            patch.object(stock_issue_workbench, "_get_company_warehouses", return_value=[warehouse]),
            patch.object(
                stock_issue_workbench.frappe,
                "get_all",
                side_effect=[[frappe._dict(name=company)], []],
            ),
        ):
            result = stock_issue_workbench.get_stock_issue_meta(company)

        self.assertEqual(result["companies"], [company])
        self.assertEqual(result["warehouses"], [warehouse])
        assert_company_access.assert_called_once_with(company)

    def test_stock_meta_rejects_an_empty_company_scope(self):
        """An account with no company scope must not receive fallback companies."""
        with (
            patch.object(stock_issue_workbench, "get_allowed_companies", return_value=set()),
            patch.object(stock_issue_workbench.frappe, "get_all", return_value=[]),
        ):
            with self.assertRaises(frappe.PermissionError):
                stock_issue_workbench.get_stock_issue_meta()

    def test_stock_warehouse_mismatch_is_rejected_before_stock_query(self):
        """A warehouse resolved to another company must be rejected server-side."""
        with (
            patch.object(stock_issue_workbench, "_get_warehouse_company", return_value="Company B"),
            patch.object(stock_issue_workbench, "assert_company_access") as assert_company_access,
        ):
            with self.assertRaises(frappe.PermissionError):
                stock_issue_workbench._assert_warehouse_company("Company A", "WH-B")
        assert_company_access.assert_not_called()


def run_authorization_boundary_tests() -> dict:
    """Run the authorization regression suite without creating business data."""
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(TestAuthorizationBoundaries)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.wasSuccessful():
        frappe.throw("授权边界回归测试失败。")
    return {
        "tests_run": result.testsRun,
        "errors": len(result.errors),
        "failures": len(result.failures),
    }
