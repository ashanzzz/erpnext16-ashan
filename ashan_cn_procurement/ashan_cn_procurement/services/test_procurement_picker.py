# Copyright (c) 2026, Ashan CN Procurement
"""Automated regression & end-to-end test suite for Procurement Order Picker (4 execution stages / 6 overview stages, 整算单 & 付款单下级账单穿透)."""

import unittest
import frappe
from frappe.utils import nowdate, flt, random_string

from ashan_cn_procurement.services.procurement_picker_service import (
    get_user_procurement_companies,
    search_picker_items,
    get_material_request_picker_rows,
    get_material_request_doc_rows,
    quick_create_material_request,
    get_pending_material_request_items,
    get_pending_material_request_docs,
    make_purchase_orders_from_mr_items,
    get_pending_purchase_order_items,
    get_pending_purchase_order_docs,
    make_purchase_receipts_from_po_items,
    get_pending_purchase_receipt_items,
    get_pending_purchase_receipt_docs,
    make_purchase_invoices_from_pr_items,
    get_pending_reimbursement_invoice_items,
    get_pending_reimbursement_invoices,
    make_reimbursement_from_invoices,
    get_pending_payment_invoices,
    get_pending_payment_docs,
    get_company_payment_accounts,
    get_supplier_bank_details,
    make_wire_transfer_payment_from_invoices,
    get_payment_entry_sub_invoices,
    get_procurement_picker_overview_kpis,
    get_procurement_workbench_context,
)


class TestProcurementPicker(unittest.TestCase):
    def setUp(self):
        frappe.set_user("Administrator")
        self.company = frappe.db.get_value("Company", {}, "name") or "天津祺富机械加工有限公司"

    def test_01_user_companies_and_kpis(self):
        """Verify get_user_procurement_companies and 4-step execution / 6-step overview KPIs."""
        user_comps = get_user_procurement_companies()
        self.assertIn("companies", user_comps)
        self.assertTrue(len(user_comps["companies"]) >= 1)

        # Test KPI with "All"
        res_all = get_procurement_picker_overview_kpis("All")
        self.assertIn("kpis", res_all)
        self.assertIn("item_to_mr", res_all["kpis"])
        self.assertIn("mr_to_po", res_all["kpis"])
        self.assertIn("po_to_pr", res_all["kpis"])
        self.assertIn("pr_to_pi", res_all["kpis"])
        self.assertIn("pi_to_rr", res_all["kpis"])
        self.assertIn("pi_to_pay", res_all["kpis"])
        self.assertEqual(res_all["kpis"]["pi_to_rr"]["label"], "待整算")
        self.assertEqual(res_all["kpis"]["pi_to_pay"]["label"], "待付款")

        request_context = get_procurement_workbench_context("request")
        self.assertEqual(request_context["allowed_stages"], ["item_to_mr"])
        request_kpis = get_procurement_picker_overview_kpis("All", "request")
        self.assertEqual(set(request_kpis["kpis"]), {"item_to_mr"})

        execution_context = get_procurement_workbench_context("execution")
        self.assertEqual(
            execution_context["allowed_stages"],
            ["mr_to_po", "pr_to_pi", "pi_to_rr", "pi_to_pay"],
        )
        execution_kpis = get_procurement_picker_overview_kpis("All", "execution")
        self.assertEqual(
            set(execution_kpis["kpis"]),
            {"mr_to_po", "pr_to_pi", "pi_to_rr", "pi_to_pay"},
        )

    def test_02_all_dual_views_smoke(self):
        """Verify query endpoints for all stages in both Detail View and Doc View."""
        for comp_scope in ["All", self.company]:
            # Search helper
            s_res = search_picker_items(query="TEST", company=comp_scope)
            self.assertIn("items", s_res)

            # Stage 1: MR (Detail & Doc)
            mr_items = get_material_request_picker_rows(comp_scope)
            self.assertIn("rows", mr_items)
            mr_docs = get_material_request_doc_rows(comp_scope)
            self.assertIn("rows", mr_docs)

            # Stage 2: PO (Detail & Doc)
            po_items = get_pending_material_request_items(comp_scope)
            self.assertIn("rows", po_items)
            po_docs = get_pending_material_request_docs(comp_scope)
            self.assertIn("rows", po_docs)

            # Stage 3: PR (Detail & Doc)
            pr_items = get_pending_purchase_order_items(comp_scope)
            self.assertIn("rows", pr_items)
            pr_docs = get_pending_purchase_order_docs(comp_scope)
            self.assertIn("rows", pr_docs)

            # Stage 4: PI (Detail & Doc)
            pi_items = get_pending_purchase_receipt_items(comp_scope)
            self.assertIn("rows", pi_items)
            pi_docs = get_pending_purchase_receipt_docs(comp_scope)
            self.assertIn("rows", pi_docs)

            # Stage 5: RR / 整算单 (Detail & Doc)
            rr_items = get_pending_reimbursement_invoice_items(comp_scope)
            self.assertIn("rows", rr_items)
            rr_docs = get_pending_reimbursement_invoices(comp_scope)
            self.assertIn("rows", rr_docs)

            # Stage 6: Pay / 付款单 (Detail & Doc)
            pay_items = get_pending_payment_invoices(comp_scope)
            self.assertIn("rows", pay_items)
            pay_docs = get_pending_payment_docs(comp_scope)
            self.assertIn("rows", pay_docs)

    def test_03_quick_create_and_full_lifecycle(self):
        """Test smart Material Request creation, downstream PO/PR/PI flow, 整算单, and 付款单."""
        supplier = frappe.db.get_value("Supplier", {}, "name")
        if not supplier:
            sup_doc = frappe.get_doc({
                "doctype": "Supplier",
                "supplier_name": "测试选单供应商_" + random_string(4),
                "supplier_group": "All Supplier Groups",
            }).insert()
            supplier = sup_doc.name

        warehouse = frappe.db.get_value("Warehouse", {"company": self.company, "is_group": 0}, "name")
        uom = frappe.db.get_value("UOM", {}, "name") or "Nos"
        item_code = frappe.db.get_value("Item", {"is_stock_item": 1, "has_variants": 0}, "name")
        if not item_code:
            item_doc = frappe.get_doc({
                "doctype": "Item",
                "item_code": "TEST-PICKER-ITEM-" + random_string(4),
                "item_name": "测试选单物料",
                "item_group": "All Item Groups",
                "stock_uom": uom,
                "is_stock_item": 1,
            }).insert()
            item_code = item_doc.name

        # --- Step 1: Quick Create Material Request via Dialog RPC (With rate, tax, amount) ---
        mr_res = quick_create_material_request(
            company=self.company,
            department=frappe.db.get_value("Department", {"company": self.company}, "name") or "总经办 - TJ",
            items=[{
                "item_code": item_code,
                "qty": 20.0,
                "rate": 150.0,
                "tax_rate": 13.0,
                "supplier": supplier,
                "warehouse": warehouse,
                "custom_spec_model": "规格M20",
                "custom_line_remark": "全流程自动化测试",
            }],
            purpose="测试选单工作台物料申请",
        )
        self.assertTrue(mr_res["success"])
        mr_name = mr_res.get("name") or mr_res.get("material_request_name")

        # Submit MR
        mr_doc = frappe.get_doc("Material Request", mr_name)
        mr_doc.submit()

        try:
            mri_name = mr_doc.items[0].name

            # --- Step 2: Material Request -> Purchase Order ---
            po_gen = make_purchase_orders_from_mr_items(
                self.company,
                selected_items=[{"mri_name": mri_name, "this_qty": 20.0, "rate": 150.0, "supplier": supplier}],
            )
            self.assertTrue(po_gen["success"])
            po_name = (po_gen.get("purchase_orders") or po_gen.get("orders"))[0]["name"]

            po_doc = frappe.get_doc("Purchase Order", po_name)
            po_doc.submit()
            poi_name = po_doc.items[0].name

            # --- Step 3: Purchase Order -> Purchase Receipt ---
            pr_gen = make_purchase_receipts_from_po_items(
                self.company,
                selected_items=[{"poi_name": poi_name, "this_qty": 20.0, "accepted_warehouse": warehouse}],
            )
            self.assertTrue(pr_gen["success"])
            pr_name = pr_gen["receipts"][0]["name"]

            pr_doc = frappe.get_doc("Purchase Receipt", pr_name)
            pr_doc.submit()
            pri_name = pr_doc.items[0].name

            # --- Step 4: Purchase Receipt -> Purchase Invoice ---
            pi_gen = make_purchase_invoices_from_pr_items(
                self.company,
                selected_items=[{"pri_name": pri_name, "this_qty": 20.0}],
                bill_no="TEST-AUTO-INV-004",
                bill_date=nowdate(),
            )
            self.assertTrue(pi_gen["success"])
            pi_name = pi_gen["invoices"][0]["name"]

            pi_doc = frappe.get_doc("Purchase Invoice", pi_name)
            pi_doc.submit()

            # --- Step 5: Purchase Invoice -> 整算单 (Reimbursement Request) ---
            pi_item_pool = get_pending_reimbursement_invoice_items(self.company, {"bill_no": "TEST-AUTO-INV-004"})
            self.assertTrue(len(pi_item_pool["rows"]) > 0)

            rr_gen = make_reimbursement_from_invoices(
                self.company,
                selected_invoices=[pi_name],
                purpose="4区全流程整算单测试",
            )
            self.assertTrue(rr_gen["success"])
            rr_name = rr_gen["reimbursement_name"]
            self.assertTrue(bool(rr_name))

            # --- Step 6: Payment accounts & Bank details lookup ---
            accounts = get_company_payment_accounts(self.company)
            self.assertTrue(isinstance(accounts, list))
            bank_info = get_supplier_bank_details(supplier, self.company)
            self.assertTrue(isinstance(bank_info, dict))

        finally:
            frappe.db.rollback()


def run_tests():
    suite = unittest.TestLoader().loadTestsFromTestCase(TestProcurementPicker)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    return result.wasSuccessful()


if __name__ == "__main__":
    import sys
    success = run_tests()
    sys.exit(0 if success else 1)
