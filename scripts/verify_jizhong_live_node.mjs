import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, "temp_screenshots", "jizhong_verification");
fs.mkdirSync(outDir, { recursive: true });

function loadEnv() {
    const envFile = path.join(root, ".env");
    const result = {};
    if (fs.existsSync(envFile)) {
        for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            const idx = trimmed.indexOf("=");
            if (idx > 0) {
                result[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
            }
        }
    }
    return result;
}

const env = loadEnv();
const siteUrl = env.ERPNEXT_SITE_URL || "http://192.168.8.11:6888";
const username = env.ERPNEXT_USERNAME || "ashanzzz1213@gmail.com";
const password = env.ERPNEXT_PASSWORD || "Woo@@@204317";

console.log(`Connecting to ${siteUrl}...`);

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

    const errors = [];
    page.on("console", (msg) => {
        if (msg.type() === "error") {
            console.error(`[CONSOLE ERROR] ${msg.text()}`);
            errors.push(msg.text());
        }
    });
    page.on("pageerror", (err) => {
        console.error(`[PAGE ERROR] ${err.message}`);
        errors.push(err.message);
    });

    // 1. Login
    console.log("1. Logging into Frappe Desk...");
    await page.goto(`${siteUrl}/login`);
    await page.fill("#login_email", username);
    await page.fill("#login_password", password);
    await page.click("button[type='submit']");
    await page.waitForURL("**/desk**", { timeout: 20000 });
    console.log("Logged in successfully!");

    // 2. Stock Ledger Benchmark Check
    console.log("2. Checking Stock Ledger typography benchmark...");
    await page.goto(`${siteUrl}/desk/stock-ledger-workbench`);
    await page.waitForTimeout(3000);
    const stockTypography = await page.evaluate(() => {
        const title = document.querySelector(".title-text, .page-head h1, .page-head .title, h3");
        const th = document.querySelector("th");
        const td = document.querySelector("td");
        return {
            title: title ? window.getComputedStyle(title).fontSize : "N/A",
            th: th ? window.getComputedStyle(th).fontSize : "N/A",
            td: td ? window.getComputedStyle(td).fontSize : "N/A",
        };
    });
    console.log("Stock Ledger Typography Benchmark:", stockTypography);
    await page.screenshot({ path: path.join(outDir, "00_stock_ledger_benchmark.png") });

    // 3. Navigate to Jizhong Workbench
    console.log("3. Navigating to Jizhong HR Salary Workbench...");
    await page.goto(`${siteUrl}/desk/jizhong-hr-salary-workbench`);
    await page.waitForTimeout(3000);

    // Verify Jizhong Typography
    const jzTypography = await page.evaluate(() => {
        const title = document.querySelector(".ashan-jizhong-title, .ashan-product-title, .ashan-jizhong-workbench h1, .page-title");
        const th = document.querySelector("#table-jz-employees th");
        const td = document.querySelector("#tbody-jz-employees td");
        return {
            title: title ? window.getComputedStyle(title).fontSize : "N/A",
            th: th ? window.getComputedStyle(th).fontSize : "N/A",
            td: td ? window.getComputedStyle(td).fontSize : "N/A",
        };
    });
    console.log("Jizhong Typography Computed:", jzTypography);

    // 4. Test Tab: employees (员工薪酬档案)
    console.log("4. Testing Tab: employees (员工薪酬档案)...");
    await page.click(".jz-tab-btn[data-tab='employees']");
    await page.waitForSelector("#table-jz-employees", { state: "visible", timeout: 10000 });
    await page.waitForTimeout(2000);

    // Check freeze columns order: Checkbox, 序号, 工号, 姓名
    const columnLayout = await page.evaluate(() => {
        const ths = Array.from(document.querySelectorAll("#table-jz-employees thead tr:first-child th"));
        return ths.slice(0, 8).map((th, i) => {
            const cs = window.getComputedStyle(th);
            return {
                index: i,
                text: th.innerText.trim(),
                position: cs.position,
                left: cs.left,
                width: cs.width,
            };
        });
    });
    console.log("Column layout (first 8 columns):", JSON.stringify(columnLayout, null, 2));

    // Verify header text includes '税后固定工资'
    const headersText = await page.evaluate(() => {
        const ths = Array.from(document.querySelectorAll("#table-jz-employees thead th"));
        return ths.map(th => th.innerText.trim());
    });
    console.log("Headers contain 税后固定工资:", headersText.some(t => t.includes("税后固定工资")));
    console.log("Headers contain 旧名称 税后管理工资:", headersText.some(t => t.includes("税后管理工资")));

    // Verify body cells display standard '税后固定工资'
    const allModes = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll("#tbody-jz-employees tr"));
        return rows.map(r => {
            const cells = Array.from(r.querySelectorAll("td"));
            return {
                name: cells[3]?.innerText.trim(),
                mode: cells[6]?.innerText.trim(),
                fixedNet: cells[7]?.innerText.trim(),
            };
        });
    });
    console.log("Sample employee salary modes in table:", JSON.stringify(allModes.slice(0, 5), null, 2));

    // Test selection and parameter adjustment button
    const btnParamStateBefore = await page.evaluate(() => {
        const btn = document.getElementById("btn-jz-adjust-param");
        return { exists: !!btn, disabled: btn?.disabled, text: btn?.innerText.trim() };
    });
    console.log("Param button before selection:", btnParamStateBefore);

    // Select row 1
    const firstCheckbox = await page.$("#tbody-jz-employees tr:first-child .jz-emp-row-check");
    if (firstCheckbox) {
        await firstCheckbox.click();
        await page.waitForTimeout(500);

        const btnParamStateAfter1 = await page.evaluate(() => {
            const btn = document.getElementById("btn-jz-adjust-param");
            return { disabled: btn?.disabled, text: btn?.innerText.trim() };
        });
        console.log("Param button after checking 1 row:", btnParamStateAfter1);

        // Open Dialog
        await page.click("#btn-jz-adjust-param");
        await page.waitForSelector(".modal-dialog", { state: "visible", timeout: 5000 });
        await page.waitForTimeout(1000);

        // Check options in modal parameter field
        const modalFields = await page.evaluate(() => {
            const sel = document.querySelector(".modal-dialog select[data-fieldname='parameter_field']");
            if (!sel) return [];
            return Array.from(sel.options).map(o => ({ value: o.value, text: o.text }));
        });
        console.log("Adjustment dialog parameter options count:", modalFields.length);
        console.log("Adjustment dialog options:", modalFields.map(o => o.text));

        await page.screenshot({ path: path.join(outDir, "01_jizhong_param_dialog.png") });

        // Close dialog
        const closeBtn = await page.$(".modal-dialog .btn-modal-close, .modal-dialog .btn-default, .modal-dialog [data-dismiss='modal']");
        if (closeBtn) await closeBtn.click();
        await page.waitForTimeout(1000);
    }

    // Uncheck first row
    if (firstCheckbox) await firstCheckbox.click();
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(outDir, "02_jizhong_employees_tab.png") });

    // 5. Test Tab: payroll (月度薪酬核定表)
    console.log("5. Testing Tab: payroll (月度薪酬核定表)...");
    await page.fill("#jz-month-select", "2026-07");
    await page.click("#btn-jz-refresh-all");
    await page.waitForTimeout(2000);
    await page.click(".jz-tab-btn[data-tab='payroll']");
    await page.waitForSelector("#table-jz-payroll", { state: "visible", timeout: 10000 });
    await page.waitForTimeout(2000);

    const payrollSummary = await page.evaluate(() => {
        return {
            status: document.getElementById("jz-kpi-status")?.innerText.trim(),
            count: document.getElementById("jz-kpi-count")?.innerText.trim(),
            net: document.getElementById("jz-kpi-net")?.innerText.trim(),
            gross: document.getElementById("jz-kpi-gross")?.innerText.trim(),
        };
    });
    console.log("Payroll Summary (2026-07):", payrollSummary);

    // Verify fixed net salary employees in payroll table
    const fixedNetEmployeesInPayroll = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll("#tbody-jz-payroll tr"));
        return rows.map(r => {
            const cells = Array.from(r.querySelectorAll("td"));
            return {
                name: cells[3]?.innerText.trim(),
                mode: cells[4]?.innerText.trim(),
                gross: cells[15]?.innerText.trim(),
                tax: cells[22]?.innerText.trim(),
                net: cells[23]?.innerText.trim(),
            };
        }).filter(x => x.mode?.includes("税后") || x.mode?.includes("固定"));
    });
    console.log("Fixed Net Employees in Payroll Table:", JSON.stringify(fixedNetEmployeesInPayroll, null, 2));

    await page.screenshot({ path: path.join(outDir, "03_jizhong_payroll_tab.png") });

    // 6. Test other tabs: Attendance, Cash Bills, History
    console.log("6. Testing Attendance tab...");
    await page.click(".jz-tab-btn[data-tab='attendance']");
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(outDir, "04_jizhong_attendance_tab.png") });

    console.log("7. Testing Cash Bills tab...");
    await page.click(".jz-tab-btn[data-tab='cash_bills']");
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(outDir, "05_jizhong_cash_bills_tab.png") });

    console.log("8. Testing History tab...");
    await page.click(".jz-tab-btn[data-tab='history']");
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(outDir, "06_jizhong_history_tab.png") });

    console.log("\n--- Verification Summary ---");
    console.log(`Total console/page errors detected: ${errors.length}`);
    if (errors.length > 0) {
        console.error("Errors:", errors);
    }

    await browser.close();
    console.log("Verification finished successfully!");
})();
