// Copyright (c) 2026, Ashan CN Procurement and contributors
// For license information, please see license.txt

frappe.ui.form.on("Property Charge Rate", {
    refresh(frm) {
        frm.trigger("toggle_fields");
    },

    property_lease(frm) {
        if (frm.doc.property_lease) {
            frappe.db.get_value("Property Lease", frm.doc.property_lease, ["area", "property_fee_mode"], (r) => {
                if (r) {
                    if (r.property_fee_mode) {
                        frm.set_value("property_fee_mode", r.property_fee_mode);
                    }
                    frm.trigger("recalc_all");
                }
            });
        }
    },

    rent_pricing_mode(frm) {
        frm.trigger("toggle_fields");
        frm.trigger("recalc_all");
    },

    property_fee_mode(frm) {
        frm.trigger("toggle_fields");
        frm.trigger("recalc_all");
    },

    property_fee_pricing_mode(frm) {
        frm.trigger("toggle_fields");
        frm.trigger("recalc_all");
    },

    // 触发房租重算
    rent_daily_rate(frm) { if (frm.doc.rent_pricing_mode === "按日单价 (元/㎡·天)") frm.trigger("recalc_all"); },
    rent_monthly_rate(frm) { if (frm.doc.rent_pricing_mode === "按月单价 (元/㎡·月)") frm.trigger("recalc_all"); },
    rent_annual_rate(frm) { if (frm.doc.rent_pricing_mode === "按年单价 (元/㎡·年)") frm.trigger("recalc_all"); },
    rent_annual_amount(frm) { if (frm.doc.rent_pricing_mode === "按年总金额 (元/年)") frm.trigger("recalc_all"); },
    rent_monthly_amount(frm) { if (frm.doc.rent_pricing_mode === "按月总金额 (元/月)") frm.trigger("recalc_all"); },

    // 触发物业费重算
    property_fee_daily_rate(frm) { if (frm.doc.property_fee_pricing_mode === "按日单价 (元/㎡·天)") frm.trigger("recalc_all"); },
    property_fee_monthly_rate(frm) { if (frm.doc.property_fee_pricing_mode === "按月单价 (元/㎡·月)") frm.trigger("recalc_all"); },
    property_fee_annual_rate(frm) { if (frm.doc.property_fee_pricing_mode === "按年单价 (元/㎡·年)") frm.trigger("recalc_all"); },
    property_fee_annual_amount(frm) { if (frm.doc.property_fee_pricing_mode === "按年总金额 (元/年)") frm.trigger("recalc_all"); },

    toggle_fields(frm) {
        const isSeparate = (frm.doc.property_fee_mode === "单独计收物业费");
        frm.toggle_display(["property_fee_pricing_mode", "property_fee_daily_rate", "property_fee_monthly_rate", "property_fee_annual_rate", "property_fee_annual_amount", "property_fee_tax_rate"], isSeparate);
    },

    recalc_all(frm) {
        if (!frm.doc.property_lease) return;
        frappe.db.get_value("Property Lease", frm.doc.property_lease, "area", (r) => {
            const area = flt(r ? r.area : 0);
            if (area <= 0) return;

            const mode = frm.doc.rent_pricing_mode || "按年总金额 (元/年)";
            let r_day = flt(frm.doc.rent_daily_rate);
            let r_mon = flt(frm.doc.rent_monthly_rate);
            let r_yr = flt(frm.doc.rent_annual_rate);
            let r_amt_yr = flt(frm.doc.rent_annual_amount);
            let r_amt_mon = flt(frm.doc.rent_monthly_amount);

            if (mode === "按日单价 (元/㎡·天)") {
                r_yr = Math.round(r_day * 365 * 1000000) / 1000000;
                r_mon = Math.round((r_day * 365 / 12) * 1000000) / 1000000;
                r_amt_yr = Math.round(area * r_day * 365 * 100) / 100;
                r_amt_mon = Math.round((r_amt_yr / 12) * 100) / 100;
            } else if (mode === "按月单价 (元/㎡·月)") {
                r_yr = Math.round(r_mon * 12 * 1000000) / 1000000;
                r_day = Math.round((r_mon * 12 / 365) * 1000000) / 1000000;
                r_amt_mon = Math.round(area * r_mon * 100) / 100;
                r_amt_yr = Math.round(r_amt_mon * 12 * 100) / 100;
            } else if (mode === "按年单价 (元/㎡·年)") {
                r_mon = Math.round((r_yr / 12) * 1000000) / 1000000;
                r_day = Math.round((r_yr / 365) * 1000000) / 1000000;
                r_amt_yr = Math.round(area * r_yr * 100) / 100;
                r_amt_mon = Math.round((r_amt_yr / 12) * 100) / 100;
            } else if (mode === "按月总金额 (元/月)") {
                r_amt_yr = Math.round(r_amt_mon * 12 * 100) / 100;
                r_mon = Math.round((r_amt_mon / area) * 1000000) / 1000000;
                r_yr = Math.round(r_mon * 12 * 1000000) / 1000000;
                r_day = Math.round((r_amt_yr / area / 365) * 1000000) / 1000000;
            } else { // 按年总金额 (元/年)
                r_amt_mon = Math.round((r_amt_yr / 12) * 100) / 100;
                r_yr = Math.round((r_amt_yr / area) * 1000000) / 1000000;
                r_mon = Math.round((r_yr / 12) * 1000000) / 1000000;
                r_day = Math.round((r_amt_yr / area / 365) * 1000000) / 1000000;
            }

            frm.set_value({
                rent_daily_rate: r_day,
                rent_monthly_rate: r_mon,
                rent_annual_rate: r_yr,
                rent_annual_amount: r_amt_yr,
                rent_monthly_amount: r_amt_mon
            });

            // 物业费
            let p_amt_yr = 0;
            if (frm.doc.property_fee_mode === "单独计收物业费") {
                const p_mode = frm.doc.property_fee_pricing_mode || "按月单价 (元/㎡·月)";
                let p_day = flt(frm.doc.property_fee_daily_rate);
                let p_mon = flt(frm.doc.property_fee_monthly_rate);
                let p_yr = flt(frm.doc.property_fee_annual_rate);
                p_amt_yr = flt(frm.doc.property_fee_annual_amount);

                if (p_mode === "按日单价 (元/㎡·天)") {
                    p_yr = Math.round(p_day * 365 * 1000000) / 1000000;
                    p_mon = Math.round((p_day * 365 / 12) * 1000000) / 1000000;
                    p_amt_yr = Math.round(area * p_day * 365 * 100) / 100;
                } else if (p_mode === "按月单价 (元/㎡·月)") {
                    p_yr = Math.round(p_mon * 12 * 1000000) / 1000000;
                    p_day = Math.round((p_mon * 12 / 365) * 1000000) / 1000000;
                    p_amt_yr = Math.round(area * p_mon * 12 * 100) / 100;
                } else if (p_mode === "按年单价 (元/㎡·年)") {
                    p_mon = Math.round((p_yr / 12) * 1000000) / 1000000;
                    p_day = Math.round((p_yr / 365) * 1000000) / 1000000;
                    p_amt_yr = Math.round(area * p_yr * 100) / 100;
                } else {
                    p_yr = Math.round((p_amt_yr / area) * 1000000) / 1000000;
                    p_mon = Math.round((p_yr / 12) * 1000000) / 1000000;
                    p_day = Math.round((p_amt_yr / area / 365) * 1000000) / 1000000;
                }

                frm.set_value({
                    property_fee_daily_rate: p_day,
                    property_fee_monthly_rate: p_mon,
                    property_fee_annual_rate: p_yr,
                    property_fee_annual_amount: p_amt_yr
                });
            }

            const grand_yr = Math.round((r_amt_yr + p_amt_yr) * 100) / 100;
            frm.set_value({
                total_annual_amount: grand_yr,
                total_monthly_amount: Math.round((grand_yr / 12) * 100) / 100
            });
        });
    }
});
