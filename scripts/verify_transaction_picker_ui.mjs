/**
 * Read-only browser acceptance check for Ashan transaction pickers.
 *
 * It authenticates with the local development credentials from .env, opens
 * each page, checks its rendered title and compact table header, and saves a
 * full-page screenshot.  It never clicks a submit, delete, or write action.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const root = path.resolve(import.meta.dirname, "..");
const artifactDir = path.join(root, "temp_screenshots", "transaction_picker_acceptance");

function loadEnv(filePath) {
    const result = {};
    if (!fs.existsSync(filePath)) return result;

    for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const separator = line.indexOf("=");
        if (separator < 1) continue;
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
        result[key] = value;
    }
    return result;
}

const env = loadEnv(path.join(root, ".env"));
const siteUrl = (
    process.env.ERPNEXT_SITE_URL_LOCAL
    || process.env.ERPNEXT_SITE_URL
    || env.ERPNEXT_SITE_URL_LOCAL
    || env.ERPNEXT_SITE_URL
    || "http://192.168.8.11:6888"
).replace(/\/$/, "");
const username = process.env.ERPNEXT_USERNAME || env.ERPNEXT_USERNAME;
const password = process.env.ERPNEXT_PASSWORD || env.ERPNEXT_PASSWORD;

if (!username || !password) {
    throw new Error("Missing ERPNEXT_USERNAME or ERPNEXT_PASSWORD in .env; no browser check was run.");
}

const pages = [
    ["procurement-order-picker", "🛒 常规采购流程", "38px"],
    ["wire-transfer-picker", "自办电汇采购", "38px"],
    ["monthly-settlement-picker", "月结入库补录", "41px"],
    ["reimbursement-picker", "现金报销申请", "38px"],
];

fs.mkdirSync(artifactDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const consoleErrors = [];
const isPlatformSocketOriginWarning = (message) => (
    message === "Error connecting to socket.io: Invalid origin"
);

page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));

try {
    await page.goto(`${siteUrl}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.locator("#login_email").fill(username);
    await page.locator("#login_password").fill(password);
    await page.locator("button.btn-login:not(.btn-login-with-email-link)").click();
    await page.waitForURL(/\/desk/, { timeout: 30000 });

    const results = [];
    for (const [route, expectedTitle, expectedHeaderHeight] of pages) {
        const errorStart = consoleErrors.length;
        await page.goto(`${siteUrl}/desk/${route}`, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.locator(".picker-page-container h2").waitFor({ state: "visible", timeout: 30000 });
        await page.waitForTimeout(1500);

        const title = (await page.locator(".picker-page-container h2").innerText()).trim();
        const headers = page.locator(".picker-data-table thead th");
        const headerCount = await headers.count();
        const firstHeaderHeight = headerCount
            ? await headers.first().evaluate((element) => getComputedStyle(element).height)
            : null;
        const statusFilterGroups = [];
        if (route === "procurement-order-picker") {
            const stageCards = page.locator(".picker-kpi-card[data-stage]");
            for (let index = 0; index < await stageCards.count(); index += 1) {
                await stageCards.nth(index).click();
                await page.waitForTimeout(250);
                statusFilterGroups.push(await page.locator(".picker-status-btn-group").first().evaluate((group) => (
                    [...group.querySelectorAll(".picker-status-btn")].map((button) => button.textContent.trim())
                )));
            }
        }
        const statusFilterSemanticsOk = route !== "procurement-order-picker" || (
            statusFilterGroups.length === 5
            && statusFilterGroups.every((group) => (
                group[0]?.startsWith("🟡 ")
                && group[1]?.startsWith("🟢 ")
                && group[2]?.startsWith("全部")
                && !group.some((text) => text.includes("🌐"))
            ))
        );

        await page.screenshot({
            path: path.join(artifactDir, `${route}.png`),
            fullPage: true,
        });

        const routeErrors = consoleErrors.slice(errorStart);
        const applicationErrors = routeErrors.filter((message) => !isPlatformSocketOriginWarning(message));
        results.push({
            route,
            expectedTitle,
            expectedHeaderHeight,
            title,
            headerCount,
            firstHeaderHeight,
            statusFilterSemanticsOk,
            applicationConsoleErrorCount: applicationErrors.length,
            platformWarnings: routeErrors.filter(isPlatformSocketOriginWarning),
        });
    }

    const failed = results.filter((result) => (
        result.title !== result.expectedTitle
        || result.headerCount === 0
        || result.firstHeaderHeight !== result.expectedHeaderHeight
        || !result.statusFilterSemanticsOk
        || result.applicationConsoleErrorCount !== 0
    ));
    console.log(JSON.stringify(results, null, 2));
    if (failed.length) {
        throw new Error(`Picker acceptance failed for: ${failed.map((result) => result.route).join(", ")}`);
    }
} finally {
    await browser.close();
}
