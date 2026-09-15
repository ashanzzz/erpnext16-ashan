# -*- coding: utf-8 -*-
# Copyright (c) 2026, Ashan CN Procurement and contributors
# 期初与全流程机加工库存数据生成服务

import frappe
from frappe.utils import nowdate, flt


def seed_qifu_stock():
    """为天津祺富机械加工有限公司生成机加工真实实物库存与入库单据"""
    company = "天津祺富机械加工有限公司"

    # 1. 查找或创建仓库
    warehouses = frappe.get_all(
        "Warehouse",
        filters={"company": company, "is_group": 0, "disabled": 0},
        fields=["name", "warehouse_name"],
    )
    wh_names = [w.name for w in warehouses]
    
    target_wh = "仓库 - 祺富"
    if target_wh not in wh_names:
        if "Stores - 祺富" in wh_names:
            target_wh = "Stores - 祺富"
        elif wh_names:
            target_wh = wh_names[0]
        else:
            wh_doc = frappe.get_doc({
                "doctype": "Warehouse",
                "warehouse_name": "仓库",
                "company": company,
                "is_group": 0,
            })
            wh_doc.insert(ignore_permissions=True)
            target_wh = wh_doc.name

    print(f"[Seed] Target warehouse for {company}: {target_wh}")

    # 2. 机加工车间核心耗材与原料主数据
    items_data = [
        {
            "item_code": "ITEM-QF-CNC-001",
            "item_name": "CNC数控硬质合金刀片",
            "description": "CNMG120408-PM 高耐磨涂层精密车削刀片",
            "item_group": "Consumable",
            "stock_uom": "Nos",
            "qty": 120.0,
            "rate": 28.50,
        },
        {
            "item_code": "ITEM-QF-STEEL-002",
            "item_name": "优质冷轧特种合金钢棒",
            "description": "40Cr Φ45mm×3000mm 机械加工专用调质棒料",
            "item_group": "Raw Material",
            "stock_uom": "Kg",
            "qty": 450.0,
            "rate": 6.80,
        },
        {
            "item_code": "ITEM-QF-OIL-003",
            "item_name": "重负荷抗磨导轨润滑油",
            "description": "ISO VG 68# 导轨极压抗磨专用润滑油 (18L/桶)",
            "item_group": "Consumable",
            "stock_uom": "Nos",
            "qty": 25.0,
            "rate": 320.00,
        },
        {
            "item_code": "ITEM-QF-COOL-004",
            "item_name": "半合成水溶性金属切削液",
            "description": "ECO-COOL-500 超强润滑冷却切削浓缩液 (20L/桶)",
            "item_group": "Consumable",
            "stock_uom": "Nos",
            "qty": 18.0,
            "rate": 260.00,
        },
        {
            "item_code": "ITEM-QF-BEAR-005",
            "item_name": "精密角接触球主轴轴承",
            "description": "7008AC/P4 超高速高精度机床主轴配对轴承",
            "item_group": "Consumable",
            "stock_uom": "Nos",
            "qty": 45.0,
            "rate": 185.00,
        },
        {
            "item_code": "ITEM-QF-BOLT-006",
            "item_name": "高强度内六角圆柱头螺钉",
            "description": "M12×45 12.9级合金钢发黑高强度螺栓",
            "item_group": "Consumable",
            "stock_uom": "Nos",
            "qty": 600.0,
            "rate": 1.20,
        },
    ]

    for it in items_data:
        if not frappe.db.exists("Item", it["item_code"]):
            item_doc = frappe.get_doc({
                "doctype": "Item",
                "item_code": it["item_code"],
                "item_name": it["item_name"],
                "description": it["description"],
                "item_group": "Consumable" if frappe.db.exists("Item Group", "Consumable") else "All Item Groups",
                "stock_uom": it["stock_uom"],
                "is_stock_item": 1,
                "valuation_rate": it["rate"],
                "disabled": 0,
            })
            item_doc.insert(ignore_permissions=True)
            print(f"[Seed] Created Item: {it['item_code']}")
        else:
            doc = frappe.get_doc("Item", it["item_code"])
            doc.item_name = it["item_name"]
            doc.description = it["description"]
            doc.stock_uom = it["stock_uom"]
            doc.disabled = 0
            doc.is_stock_item = 1
            doc.save(ignore_permissions=True)
            print(f"[Seed] Updated Item: {it['item_code']}")

    # 3. 创建并提交标准物料入库单 (Material Receipt)
    receipt_items = []
    for it in items_data:
        receipt_items.append({
            "item_code": it["item_code"],
            "item_name": it["item_name"],
            "description": it["description"],
            "qty": it["qty"],
            "basic_rate": it["rate"],
            "t_warehouse": target_wh,
            "stock_uom": it["stock_uom"],
            "uom": it["stock_uom"],
            "conversion_factor": 1.0,
            "cost_center": "Main - 祺富" if frappe.db.exists("Cost Center", "Main - 祺富") else None,
        })

    stock_entry = frappe.get_doc({
        "doctype": "Stock Entry",
        "stock_entry_type": "Material Receipt",
        "purpose": "Material Receipt",
        "company": company,
        "posting_date": nowdate(),
        "to_warehouse": target_wh,
        "remarks": "期初材料入库与生产耗材备货 · 祺富车间机加工备品备件采购入库",
        "items": receipt_items,
    })

    stock_entry.insert(ignore_permissions=True)
    stock_entry.submit()
    frappe.db.commit()

    print(f"[Seed] Successfully created and submitted Stock Entry: {stock_entry.name}")

    # 4. 统计查询当前祺富实存
    bins = frappe.db.sql("""
        SELECT b.warehouse, b.item_code, i.item_name, b.actual_qty, b.stock_uom
        FROM `tabBin` b
        INNER JOIN `tabWarehouse` w ON w.name = b.warehouse
        INNER JOIN `tabItem` i ON i.name = b.item_code
        WHERE w.company = %s AND b.actual_qty > 0
        ORDER BY b.actual_qty DESC
    """, (company,), as_dict=True)

    print(f"[Seed] Total Positive Stock Items in {company}: {len(bins)}")
    for b in bins:
        print(f"  - [{b.warehouse}] {b.item_code} ({b.item_name}): {b.actual_qty} {b.stock_uom}")

    return {
        "voucher": stock_entry.name,
        "items_count": len(bins),
        "warehouse": target_wh,
    }
