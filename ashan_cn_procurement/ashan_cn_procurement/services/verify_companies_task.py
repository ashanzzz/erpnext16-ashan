# Copyright (c) 2026, Ashan CN Procurement
import frappe

def verify():
    comps = frappe.get_all("Company", fields=["name", "company_name", "abbr"])
    print("=== Companies in Database ===")
    for c in comps:
        print(f"Name: {c.name} | company_name: {c.company_name} | Abbr: {c.abbr}")

    # Check Material Request, Purchase Order, Purchase Receipt, Purchase Invoice, Reimbursement Request company values
    for dt in ["Material Request", "Purchase Order", "Purchase Receipt", "Purchase Invoice", "Reimbursement Request", "Employee"]:
        if frappe.db.exists("DocType", dt):
            res = frappe.db.sql(f"SELECT DISTINCT company, count(*) as count FROM `tab{dt}` GROUP BY company", as_dict=True)
            print(f"--- {dt} Company Counts: {res}")
