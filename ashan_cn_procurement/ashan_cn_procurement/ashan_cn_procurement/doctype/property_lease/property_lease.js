// Copyright (c) 2026, Ashan CN Procurement and contributors
// For license information, please see license.txt

frappe.ui.form.on("Property Lease", {
	refresh: function(frm) {
		frm.trigger("toggle_fields");
		frm.trigger("render_cost_summary_dashboard");
		frm.trigger("recalc");
	},

	area: function(frm) {
		frm.trigger("recalc");
	},

	rent_pricing_mode: function(frm) {
		frm.trigger("toggle_fields");
		frm.trigger("recalc");
	},

	is_tax_inclusive: function(frm) {
		frm.trigger("recalc");
	},

	rent_tax_rate: function(frm) {
		frm.trigger("recalc");
	},

	rent_annual_amount: function(frm) {
		if (frm.doc.rent_pricing_mode === "按年总金额 (元/年)") {
			frm.trigger("recalc");
		}
	},

	rent_monthly_amount: function(frm) {
		if (frm.doc.rent_pricing_mode === "按月总金额 (元/月)") {
			frm.trigger("recalc");
		}
	},

	rent_daily_rate: function(frm) {
		if (frm.doc.rent_pricing_mode === "按日单价 (元/㎡·天)") {
			frm.trigger("recalc");
		}
	},

	rent_monthly_rate: function(frm) {
		if (frm.doc.rent_pricing_mode === "按月单价 (元/㎡·月)") {
			frm.trigger("recalc");
		}
	},

	rent_annual_rate: function(frm) {
		if (frm.doc.rent_pricing_mode === "按年单价 (元/㎡·年)") {
			frm.trigger("recalc");
		}
	},

	property_fee_mode: function(frm) {
		frm.trigger("toggle_fields");
		frm.trigger("recalc");
	},

	property_fee_pricing_mode: function(frm) {
		frm.trigger("recalc");
	},

	property_fee_is_tax_inclusive: function(frm) {
		frm.trigger("recalc");
	},

	property_fee_tax_rate: function(frm) {
		frm.trigger("recalc");
	},

	property_fee_monthly_rate: function(frm) {
		if (frm.doc.property_fee_pricing_mode === "按月单价 (元/㎡·月)") {
			frm.trigger("recalc");
		}
	},

	property_fee_daily_rate: function(frm) {
		if (frm.doc.property_fee_pricing_mode === "按日单价 (元/㎡·天)") {
			frm.trigger("recalc");
		}
	},

	property_fee_annual_rate: function(frm) {
		if (frm.doc.property_fee_pricing_mode === "按年单价 (元/㎡·年)") {
			frm.trigger("recalc");
		}
	},

	property_fee_annual_amount: function(frm) {
		if (frm.doc.property_fee_pricing_mode === "按年总金额 (元/年)") {
			frm.trigger("recalc");
		}
	},

	property_fee_monthly_amount: function(frm) {
		if (frm.doc.property_fee_pricing_mode === "按月总金额 (元/月)") {
			frm.trigger("recalc");
		}
	},

	toggle_fields: function(frm) {
		const isSeparatePropFee = frm.doc.property_fee_mode === "单独计物业费";
		frm.toggle_display([
			"property_fee_pricing_mode",
			"property_fee_is_tax_inclusive",
			"property_fee_tax_rate",
			"property_fee_monthly_rate",
			"property_fee_daily_rate",
			"property_fee_annual_rate",
			"property_fee_annual_amount",
			"property_fee_monthly_amount",
			"property_fee_annual_tax_excl",
			"property_fee_annual_tax_amount"
		], isSeparatePropFee);
	},

	render_cost_summary_dashboard: function(frm) {
		if (frm.is_new()) return;

		const area = flt(frm.doc.area) || 0;
		const rDaily = flt(frm.doc.rent_daily_rate) || 0;
		const rAnnual = flt(frm.doc.rent_annual_rate) || 0;
		const rTax = flt(frm.doc.rent_tax_rate !== undefined ? frm.doc.rent_tax_rate : 5.0);

		const isProp = frm.doc.property_fee_mode === "单独计物业费";
		const pDaily = isProp ? (flt(frm.doc.property_fee_daily_rate) || 0) : 0;
		const pAnnual = isProp ? (flt(frm.doc.property_fee_annual_rate) || 0) : 0;
		const pTax = flt(frm.doc.property_fee_tax_rate !== undefined ? frm.doc.property_fee_tax_rate : 6.0);

		const totDaily = rDaily + pDaily;
		const totAnnual = rAnnual + pAnnual;
		const totAnnAmount = flt(frm.doc.total_annual_amount) || 0;

		frm.dashboard.clear_headline();
		frm.dashboard.set_headline(`
			<div style="display:flex; gap:16px; flex-wrap:wrap; align-items:center; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:10px 16px; font-size:12px;">
				<div style="border-right:1px solid #e2e8f0; padding-right:16px;">
					<div style="font-size:11px; color:#64748b;">📐 租赁面积</div>
					<div style="font-size:15px; font-weight:800; color:#0f172a;">${area} ㎡</div>
				</div>
				<div style="border-right:1px solid #e2e8f0; padding-right:16px;">
					<div style="font-size:11px; color:#64748b;">🏢 房租单价 (${rTax}% 专票)</div>
					<div style="font-weight:700; color:#2563eb;">${rDaily.toFixed(4)} 元/㎡·天 <span style="font-size:11px; color:#64748b;">(${rAnnual.toFixed(2)} 元/年)</span></div>
				</div>
				<div style="border-right:1px solid #e2e8f0; padding-right:16px;">
					<div style="font-size:11px; color:#64748b;">🛠️ 物业费单价 (${isProp ? `${pTax}% 专票` : '免收'})</div>
					<div style="font-weight:700; color:${isProp ? '#d97706' : '#16a34a'};">
						${isProp ? `${pDaily.toFixed(4)} 元/㎡·天 <span style="font-size:11px; color:#64748b;">(${pAnnual.toFixed(2)} 元/年)</span>` : '免物业费 (0元)'}
					</div>
				</div>
				<div>
					<div style="font-size:11px; color:#64748b;">📊 综合总成本 (含税)</div>
					<div style="font-size:14px; font-weight:800; color:#0f172a;">
						${totDaily.toFixed(4)} 元/㎡·天 <span style="font-size:11px; color:#64748b;">(${totAnnual.toFixed(2)} 元/年 · 年总额: <b>${format_currency(totAnnAmount)}</b>)</span>
					</div>
				</div>
			</div>
		`);
	},

	recalc: function(frm) {
		const area = flt(frm.doc.area) || 1.0;
		const mode = frm.doc.rent_pricing_mode || "按年总金额 (元/年)";
		const taxRate = flt(frm.doc.rent_tax_rate !== undefined ? frm.doc.rent_tax_rate : 5.0);
		const isIncl = frm.doc.is_tax_inclusive !== undefined ? Boolean(frm.doc.is_tax_inclusive) : true;

		let annIncl = 0.0;
		if (mode === "按年总金额 (元/年)") {
			const val = flt(frm.doc.rent_annual_amount);
			annIncl = isIncl ? val : (val * (1.0 + taxRate / 100.0));
		} else if (mode === "按月总金额 (元/月)") {
			const val = flt(frm.doc.rent_monthly_amount);
			annIncl = isIncl ? (val * 12.0) : (val * 12.0 * (1.0 + taxRate / 100.0));
		} else if (mode === "按日单价 (元/㎡·天)") {
			const val = flt(frm.doc.rent_daily_rate);
			annIncl = isIncl ? (val * area * 365.0) : (val * area * 365.0 * (1.0 + taxRate / 100.0));
		} else if (mode === "按月单价 (元/㎡·月)") {
			const val = flt(frm.doc.rent_monthly_rate);
			annIncl = isIncl ? (val * area * 12.0) : (val * area * 12.0 * (1.0 + taxRate / 100.0));
		} else if (mode === "按年单价 (元/㎡·年)") {
			const val = flt(frm.doc.rent_annual_rate);
			annIncl = isIncl ? (val * area) : (val * area * (1.0 + taxRate / 100.0));
		}

		if (annIncl > 0 || mode === "按年总金额 (元/年)") {
			frm.set_value("rent_annual_amount", flt(annIncl.toFixed(2)));
			frm.set_value("rent_monthly_amount", flt((annIncl / 12.0).toFixed(2)));
			frm.set_value("rent_daily_rate", flt((annIncl / (area * 365.0)).toFixed(6)));
			frm.set_value("rent_monthly_rate", flt((annIncl / (area * 12.0)).toFixed(6)));
			frm.set_value("rent_annual_rate", flt((annIncl / area).toFixed(6)));

			const annExcl = annIncl / (1.0 + taxRate / 100.0);
			const annTax = annIncl - annExcl;
			frm.set_value("rent_annual_tax_excl", flt(annExcl.toFixed(2)));
			frm.set_value("rent_annual_tax_amount", flt(annTax.toFixed(2)));
		}

		// 物业费计算
		let pAnnIncl = 0.0;
		if (frm.doc.property_fee_mode === "单独计物业费") {
			const pMode = frm.doc.property_fee_pricing_mode || "按年单价 (元/㎡·年)";
			const pTaxRate = flt(frm.doc.property_fee_tax_rate !== undefined ? frm.doc.property_fee_tax_rate : 6.0);
			const pIsIncl = frm.doc.property_fee_is_tax_inclusive !== undefined ? Boolean(frm.doc.property_fee_is_tax_inclusive) : true;

			if (pMode === "按年单价 (元/㎡·年)") {
				const val = flt(frm.doc.property_fee_annual_rate);
				pAnnIncl = pIsIncl ? (val * area) : (val * area * (1.0 + pTaxRate / 100.0));
			} else if (pMode === "按日单价 (元/㎡·天)") {
				const val = flt(frm.doc.property_fee_daily_rate);
				pAnnIncl = pIsIncl ? (val * area * 365.0) : (val * area * 365.0 * (1.0 + pTaxRate / 100.0));
			} else if (pMode === "按月单价 (元/㎡·月)") {
				const val = flt(frm.doc.property_fee_monthly_rate);
				pAnnIncl = pIsIncl ? (val * area * 12.0) : (val * area * 12.0 * (1.0 + pTaxRate / 100.0));
			} else if (pMode === "按年总金额 (元/年)") {
				const val = flt(frm.doc.property_fee_annual_amount);
				pAnnIncl = pIsIncl ? val : (val * (1.0 + pTaxRate / 100.0));
			} else if (pMode === "按月总金额 (元/月)") {
				const val = flt(frm.doc.property_fee_monthly_amount);
				pAnnIncl = pIsIncl ? (val * 12.0) : (val * 12.0 * (1.0 + pTaxRate / 100.0));
			}

			frm.set_value("property_fee_annual_amount", flt(pAnnIncl.toFixed(2)));
			frm.set_value("property_fee_monthly_amount", flt((pAnnIncl / 12.0).toFixed(2)));
			frm.set_value("property_fee_daily_rate", flt((pAnnIncl / (area * 365.0)).toFixed(6)));
			frm.set_value("property_fee_monthly_rate", flt((pAnnIncl / (area * 12.0)).toFixed(6)));
			frm.set_value("property_fee_annual_rate", flt((pAnnIncl / area).toFixed(6)));

			const pExcl = pAnnIncl / (1.0 + pTaxRate / 100.0);
			const pTax = pAnnIncl - pExcl;
			frm.set_value("property_fee_annual_tax_excl", flt(pExcl.toFixed(2)));
			frm.set_value("property_fee_annual_tax_amount", flt(pTax.toFixed(2)));
		} else {
			frm.set_value("property_fee_annual_amount", 0.0);
			frm.set_value("property_fee_monthly_amount", 0.0);
			frm.set_value("property_fee_daily_rate", 0.0);
			frm.set_value("property_fee_monthly_rate", 0.0);
			frm.set_value("property_fee_annual_rate", 0.0);
			frm.set_value("property_fee_annual_tax_excl", 0.0);
			frm.set_value("property_fee_annual_tax_amount", 0.0);
		}

		// 综合汇总
		const rAnn = flt(frm.doc.rent_annual_amount) || 0.0;
		const totAnn = rAnn + pAnnIncl;
		frm.set_value("total_annual_amount", flt(totAnn.toFixed(2)));
		frm.set_value("total_monthly_amount", flt((totAnn / 12.0).toFixed(2)));
		frm.set_value("total_daily_rate", flt((totAnn / (area * 365.0)).toFixed(6)));
		frm.set_value("total_annual_rate", flt((totAnn / area).toFixed(6)));

		frm.trigger("render_cost_summary_dashboard");
	}
});
