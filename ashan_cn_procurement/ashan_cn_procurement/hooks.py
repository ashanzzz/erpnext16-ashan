from ashan_cn_procurement.navigation_config import ROLE_HOME_PAGE

app_name = "ashan_cn_procurement"
app_title = "业务扩展"
app_publisher = "Ashan CN Procurement"
app_description = "ERPNext 16 采购、报销、油卡与受限单据业务扩展"
app_email = "dev@example.invalid"
app_license = "mit"

# Includes in <head>
# ------------------

app_include_css = [
    "/assets/ashan_cn_procurement/css/ashan_cn_procurement.css?v=20260910.01",
    "/assets/ashan_cn_procurement/css/ashan_ui_kit.css?v=20260910.01",
    "/assets/ashan_cn_procurement/css/ashan_product_shell.css?v=20260910.01",
    "/assets/ashan_cn_procurement/css/ashan_domain_refactor.css?v=20260910.02",
]

# Load only capabilities that are genuinely shared across Desk.
# Work context is loaded before sidebar so navigation can use one canonical
# company context instead of inferring company from DOM/form/list state.
app_include_js = [
    "/assets/ashan_cn_procurement/js/ashan_ui_kit.js?v=20260910.01",
    "/assets/ashan_cn_procurement/js/ashan_cn_translations.js?v=20260910.01",
    "/assets/ashan_cn_procurement/js/ashan_work_context.js?v=20260910.01",
    "/assets/ashan_cn_procurement/js/ashan_cn_sidebar_v2.js?v=20260910.01",
    "/assets/ashan_cn_procurement/js/ashan_product_shell.js?v=20260910.01",
    "/assets/ashan_cn_procurement/js/ashan_domain_refactor.js?v=20260910.02",
    "/assets/ashan_cn_procurement/js/doc_details_list.js?v=20260910.01",
]

# App Switcher Dropdown Registration (Frappe 16 Official Multi-App Standard)
add_to_apps_screen = [
    {
        "name": "ashan_cn_procurement",
        "title": "业务扩展",
        "route": "/desk/Workspaces/Home"
    }
]

website_redirects = [
    {
        "source": "/",
        "target": "/desk/Workspaces/Home",
        "redirect_http_status": 302,
    },
]

on_session_creation = "ashan_cn_procurement.boot.set_login_redirect"
get_website_user_home_page = "ashan_cn_procurement.boot.get_website_user_home_page"
extend_bootinfo = "ashan_cn_procurement.boot.boot_session"

role_home_page = ROLE_HOME_PAGE

doctype_js = {
    "Purchase Invoice": "public/js/purchase_invoice_tax_calculator.js",
    "Reimbursement Request": "public/js/reimbursement_request.js",
    "Vehicle": "public/js/vehicle_custom.js",
}

doctype_list_js = {
    "Material Request": "public/js/material_request_list.js",
    "Purchase Order": "public/js/purchase_order_list.js",
    "Purchase Receipt": "public/js/purchase_receipt_list.js",
    "Purchase Invoice": "public/js/purchase_invoice_list.js",
    "Reimbursement Request": "public/js/reimbursement_request_list.js"
}

doc_events = {
    "Material Request": {
        "validate": [
            "ashan_cn_procurement.overrides.procurement_closing.validate_procurement_period_not_locked",
            "ashan_cn_procurement.overrides.document_details.update_doc_details"
        ],
        "on_cancel": "ashan_cn_procurement.overrides.procurement_closing.validate_procurement_period_not_locked",
        "on_trash": "ashan_cn_procurement.overrides.procurement_closing.validate_procurement_period_not_locked"
    },
    "Purchase Order": {
        "validate": [
            "ashan_cn_procurement.overrides.procurement_closing.validate_procurement_period_not_locked",
            "ashan_cn_procurement.overrides.document_details.update_doc_details"
        ],
        "on_cancel": "ashan_cn_procurement.overrides.procurement_closing.validate_procurement_period_not_locked",
        "on_trash": "ashan_cn_procurement.overrides.procurement_closing.validate_procurement_period_not_locked"
    },
    "Purchase Receipt": {
        "validate": [
            "ashan_cn_procurement.overrides.procurement_closing.validate_procurement_period_not_locked",
            "ashan_cn_procurement.overrides.document_details.update_doc_details"
        ],
        "on_cancel": "ashan_cn_procurement.overrides.procurement_closing.validate_procurement_period_not_locked",
        "on_trash": "ashan_cn_procurement.overrides.procurement_closing.validate_procurement_period_not_locked"
    },
    "Purchase Invoice": {
        "before_validate": [
            "ashan_cn_procurement.overrides.procurement_closing.validate_procurement_period_not_locked",
            "ashan_cn_procurement.overrides.purchase_invoice_tax.calculate_china_line_taxes",
            "ashan_cn_procurement.overrides.document_details.update_doc_details"
        ],
        "validate": "ashan_cn_procurement.overrides.purchase_invoice_tax.validate_purchase_invoice_taxes",
        "after_insert": "ashan_cn_procurement.services.tax_invoice_matcher.on_purchase_invoice_change",
        "on_update": "ashan_cn_procurement.services.tax_invoice_matcher.on_purchase_invoice_change",
        "on_update_after_submit": "ashan_cn_procurement.services.tax_invoice_matcher.on_purchase_invoice_change",
        "on_cancel": [
            "ashan_cn_procurement.overrides.procurement_closing.validate_procurement_period_not_locked",
            "ashan_cn_procurement.services.tax_invoice_matcher.on_purchase_invoice_change"
        ],
        "on_trash": [
            "ashan_cn_procurement.overrides.procurement_closing.validate_procurement_period_not_locked",
            "ashan_cn_procurement.services.tax_invoice_matcher.on_purchase_invoice_delete"
        ]
    },
    "Reimbursement Request": {
        "validate": [
            "ashan_cn_procurement.overrides.procurement_closing.validate_procurement_period_not_locked",
            "ashan_cn_procurement.overrides.document_details.update_doc_details"
        ],
        "on_cancel": "ashan_cn_procurement.overrides.procurement_closing.validate_procurement_period_not_locked",
        "on_trash": "ashan_cn_procurement.overrides.procurement_closing.validate_procurement_period_not_locked"
    },
    "Vehicle": {
        "on_update": "ashan_cn_procurement.overrides.vehicle_sync.on_vehicle_update"
    }
}

scheduler_events = {
    "daily": [
        "ashan_cn_procurement.services.special_equipment.refresh_all_special_equipment_status",
        "ashan_cn_procurement.services.environmental_management.refresh_all_environmental_status",
        "ashan_cn_procurement.services.tax_invoice_cleanup.cleanup_expired_tax_invoice_pdfs",
        "ashan_cn_procurement.services.tax_invoice_matcher.reconcile_tax_invoice_matches"
    ]
}

# home.json is the single curated Workspace Sidebar template. setup.after_migrate
# synchronizes it to all business sidebars.
after_migrate = "ashan_cn_procurement.setup.after_migrate"
