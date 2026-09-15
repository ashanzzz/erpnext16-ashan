# Copyright (c) 2026, Ashan CN Procurement
import frappe

def execute():
    frappe.set_user("Administrator")
    old_name = "天津吉众机电设备有限公司"
    new_name = "天津吉众科技有限公司"

    companies = frappe.get_all("Company", pluck="name")
    print(f"Current companies in DB: {companies}")

    if old_name in companies:
        print(f"Renaming Company '{old_name}' -> '{new_name}'...")
        frappe.rename_doc("Company", old_name, new_name, force=True, merge=False)
        comp = frappe.get_doc("Company", new_name)
        comp.company_name = new_name
        comp.save(ignore_permissions=True)
        frappe.db.commit()
        print(f"[SUCCESS] Company renamed successfully to '{new_name}'!")
    elif new_name in companies:
        print(f"[INFO] Company '{new_name}' already exists in DB.")
    else:
        print(f"[WARNING] Neither '{old_name}' nor '{new_name}' found in DB. Available: {companies}")

    updated_companies = frappe.get_all("Company", pluck="name")
    print(f"Updated companies in DB: {updated_companies}")

    # Also check if any Employee or user default company has old_name
    frappe.db.sql("""UPDATE `tabEmployee` SET company = %s WHERE company = %s""", (new_name, old_name))
    frappe.db.sql("""UPDATE `tabUser Permission` SET for_value = %s WHERE allow = 'Company' AND for_value = %s""", (new_name, old_name))
    frappe.db.commit()
    print("[SUCCESS] All company references updated and committed!")
