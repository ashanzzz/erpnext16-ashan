/* Unified document-detail summary renderer for procurement and finance lists. */
frappe.provide("ashan.doc_details");

(function () {
    "use strict";

    const store = new Map();
    const MAX_VISIBLE = 2;
    const TARGET_DOCTYPES = [
        "Material Request",
        "Purchase Order",
        "Purchase Receipt",
        "Purchase Invoice",
        "Reimbursement Request",
    ];

    function escapeHtml(value) {
        return frappe.utils.escape_html(String(value ?? ""));
    }

    function splitItems(value) {
        return String(value || "")
            .split(/[、;；]/)
            .map((item) => item.trim())
            .filter(Boolean);
    }

    function detailKey(value) {
        let hash = 5381;
        const text = String(value || "");
        for (let index = 0; index < text.length; index += 1) {
            hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
        }
        return `ashan-detail-${(hash >>> 0).toString(36)}`;
    }

    function itemParts(item) {
        const match = item.match(/^(.*?)\s*(\(.*?\))$/);
        return match
            ? { name: match[1].trim(), meta: match[2].trim() }
            : { name: item, meta: "" };
    }

    function renderChip(item) {
        const parts = itemParts(item);
        if (/等共|项|张/.test(item) && !parts.meta) {
            return `<span class="ashan-doc-detail-chip ashan-doc-detail-chip-summary">${escapeHtml(item)}</span>`;
        }
        const meta = parts.meta
            ? `<span class="ashan-doc-detail-chip-meta">${escapeHtml(parts.meta)}</span>`
            : "";
        return (
            `<span class="ashan-doc-detail-chip">` +
                `<span class="ashan-doc-detail-chip-name">${escapeHtml(parts.name)}</span>` +
                meta +
            `</span>`
        );
    }

    function renderBadges(value) {
        const items = splitItems(value);
        if (!items.length) {
            return `<span class="ashan-doc-detail-empty">—</span>`;
        }

        const key = detailKey(value);
        store.set(key, { value: String(value), items });

        const visible = items.slice(0, MAX_VISIBLE).map(renderChip).join("");
        const remaining = items.length - MAX_VISIBLE;
        const more = remaining > 0
            ? `<button type="button" class="ashan-doc-detail-more" data-ashan-detail-key="${key}" ` +
              `aria-label="查看其余 ${remaining} 项单据明细">+${remaining}</button>`
            : "";

        return (
            `<div class="ashan-doc-details" data-ashan-detail-key="${key}" ` +
            `role="button" tabindex="0" aria-label="查看单据明细，共 ${items.length} 项">` +
            visible + more +
            `</div>`
        );
    }

    function inspectorBody(items) {
        const list = document.createElement("div");
        list.className = "ashan-detail-inspector-list";

        items.forEach((item, index) => {
            const parts = itemParts(item);
            const row = document.createElement("div");
            row.className = "ashan-detail-inspector-row";

            const seq = document.createElement("span");
            seq.className = "ashan-detail-inspector-seq";
            seq.textContent = String(index + 1);

            const main = document.createElement("div");
            main.className = "ashan-detail-inspector-main";

            const name = document.createElement("div");
            name.className = "ashan-detail-inspector-name";
            name.textContent = parts.name;
            main.appendChild(name);

            if (parts.meta) {
                const meta = document.createElement("div");
                meta.className = "ashan-detail-inspector-meta";
                meta.textContent = parts.meta;
                main.appendChild(meta);
            }

            row.appendChild(seq);
            row.appendChild(main);
            list.appendChild(row);
        });

        return list;
    }

    function openDetail(key) {
        const entry = store.get(key);
        if (!entry) return;

        if (window.AshanUI?.openInspector) {
            AshanUI.openInspector({
                title: "单据明细",
                subtitle: `共 ${entry.items.length} 项`,
                body: inspectorBody(entry.items),
            });
            return;
        }

        frappe.msgprint({
            title: "单据明细",
            message: `<div>${entry.items.map((item) => `<div>${escapeHtml(item)}</div>`).join("")}</div>`,
        });
    }

    function bindInspector() {
        if (window.__ashanDocDetailInspectorBound) return;

        document.addEventListener("click", (event) => {
            const target = event.target instanceof Element
                ? event.target.closest("[data-ashan-detail-key]")
                : null;
            if (!target) return;
            const wrapper = target.closest(".ashan-doc-details") || target;
            const key = wrapper.getAttribute("data-ashan-detail-key");
            if (!key) return;
            event.preventDefault();
            event.stopPropagation();
            openDetail(key);
        });

        document.addEventListener("keydown", (event) => {
            if (!["Enter", " "].includes(event.key)) return;
            const target = event.target instanceof Element
                ? event.target.closest(".ashan-doc-details")
                : null;
            if (!target) return;
            event.preventDefault();
            openDetail(target.getAttribute("data-ashan-detail-key"));
        });

        window.__ashanDocDetailInspectorBound = true;
    }

    function registerFormatter(doctype) {
        frappe.listview_settings[doctype] = frappe.listview_settings[doctype] || {};
        const settings = frappe.listview_settings[doctype];
        settings.formatters = settings.formatters || {};
        settings.formatters.custom_doc_details = function (value, df, doc) {
            return renderBadges(value || doc?.custom_doc_details || "");
        };
    }

    function registerPurchaseInvoiceFields() {
        registerFormatter("Purchase Invoice");
        const settings = frappe.listview_settings["Purchase Invoice"];
        settings.add_fields = Array.from(new Set([
            ...(settings.add_fields || []),
            "custom_doc_details",
            "supplier",
            "bill_no",
            "bill_date",
            "grand_total",
            "status",
        ]));
    }

    ashan.doc_details.render_badges = renderBadges;
    ashan.doc_details.open = openDetail;
    ashan.doc_details.register = registerFormatter;

    TARGET_DOCTYPES.forEach(registerFormatter);
    registerPurchaseInvoiceFields();
    bindInspector();

    $(document).on("page-change.ashanDocDetails", function () {
        TARGET_DOCTYPES.forEach(registerFormatter);
        registerPurchaseInvoiceFields();
    });
})();
