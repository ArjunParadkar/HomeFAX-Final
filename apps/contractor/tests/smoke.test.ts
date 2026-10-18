/**
 * Smoke test against a running dev server (`npm run dev -w @homefax/contractor`).
 *
 *   BASE_URL=http://localhost:3000 npm test -w @homefax/contractor
 *
 * Signs in as the demo contractor, opens the records list, the Ridgemont
 * record, the framing stage (grade stamp on file), issues a claim code for the
 * homeowner, and signs out. Server actions redirect inside the POST, so every
 * step waits on the URL or a selector, never on a GET.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser, type Page } from "playwright-core";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const EMAIL = "arjun@demo.homefax";
const PASSWORD = "homefax-demo-2026";
const RECORD_SLUG = "1418-ridgemont-dr";
const STEP_TIMEOUT = 90_000;

let browser: Browser;
let page: Page;
const pageErrors: string[] = [];

before(async () => {
  const up = await fetch(`${BASE}/?mode=signin`).then((r) => r.ok).catch(() => false);
  assert.ok(up, `No server at ${BASE}. Start it with: npm run dev -w @homefax/contractor`);
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
    args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-accelerated-video-decode"],
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  page = await ctx.newPage();
  page.setDefaultTimeout(STEP_TIMEOUT);
  page.on("pageerror", (e) => pageErrors.push(e.message));
});

after(async () => {
  await browser?.close();
});

test("signs in as the demo contractor and lands on the records list", async () => {
  await page.goto(`${BASE}/?mode=signin`);
  await page.fill("#signin-email", EMAIL);
  await page.fill("#signin-password", PASSWORD);
  await page.click("button[type=submit]:has-text('Sign in')");
  await page.waitForURL("**/records");
  await page.waitForSelector("h1:has-text('On file')");
  assert.match(await page.textContent("header") ?? "", /Paradkar Builders/);
  assert.ok(await page.isVisible(`a[href='/records/${RECORD_SLUG}']`), "the Ridgemont record is listed");
});

test("the records list counts from the stats rows", async () => {
  const strip = (await page.textContent("dl.rule-grid")) ?? "";
  assert.match(strip, /Properties on file/);
  assert.match(strip, /Stages filmed/);
  assert.match(strip, /Points passed/);
});

test("opens the Ridgemont record with the hand-off panels", async () => {
  await page.click(`a[href='/records/${RECORD_SLUG}']`);
  await page.waitForURL(`**/records/${RECORD_SLUG}`);
  await page.waitForSelector("h1:has-text('1418 Ridgemont Dr')");
  const body = (await page.textContent("main")) ?? "";
  assert.match(body, /The sequence/);
  assert.match(body, /Homeowner/);
  assert.match(body, /Who can see this record/);
  assert.match(body, /City of Bentonville/, "the municipality covering the address is listed");
  assert.match(body, /Project team/);
});

test("issues a claim code and shows it once with the homeowner instructions", async () => {
  await page.click("button:has-text('Issue a claim code')");
  await page.waitForURL(`**/records/${RECORD_SLUG}`);
  await page.waitForSelector("[data-testid=claim-code]");
  const code = ((await page.textContent("[data-testid=claim-code]")) ?? "").trim();
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/, `claim code looks like XXXX-XXXX (got ${code})`);
  const plate = (await page.textContent("section.plate")) ?? "";
  assert.match(plate, /\/claim/, "the instructions name the homeowner app's claim page");
  assert.match(plate, new RegExp(code));

  // The action redirects back to the same URL, so wait for the plate to go, not for the URL.
  await page.click("button:has-text('Done, hide the code')");
  await page.waitForSelector("[data-testid=claim-code]", { state: "detached" });
  await page.waitForSelector("h1:has-text('1418 Ridgemont Dr')");
  assert.equal(await page.isVisible("[data-testid=claim-code]"), false, "the code is shown once");
});

test("opens the framing stage and sees the grade stamp", async () => {
  await page.click(`a[href='/records/${RECORD_SLUG}/stages/framing']`);
  await page.waitForURL("**/stages/framing");
  await page.waitForSelector("figure[aria-label^='Grade ']");
  const stamp = (await page.getAttribute("figure[aria-label^='Grade ']", "aria-label")) ?? "";
  assert.match(stamp, /^Grade [A-F]\. Score \d+ out of 100\.$/);
  const body = (await page.textContent("main")) ?? "";
  assert.match(body, /50-point ledger/i);
  assert.match(body, /Construction draw/, "a lender holds a loan on Ridgemont, so the draw panel is on");
  assert.match(body, /Request draw for this stage/);
});

test("the profile lists this session and the two ways out", async () => {
  await page.goto(`${BASE}/profile`);
  await page.waitForSelector("h2:has-text('Signed in on')");
  const body = (await page.textContent("main")) ?? "";
  assert.match(body, /This device/);
  assert.match(body, /Sign out everywhere else/);
  assert.match(body, /Ten characters or more/);
});

test("signs out", async () => {
  // Exact text: "Sign out everywhere else" is a different button on the same page.
  await page.click("button:text-is('Sign out')");
  await page.waitForURL((u) => u.pathname === "/");
  await page.waitForSelector("#signin-email");
  const res = await page.goto(`${BASE}/records`);
  assert.ok(res, "navigation returned a response");
  await page.waitForSelector("#signin-email");
  assert.equal(new URL(page.url()).pathname, "/", "a signed-out visitor is sent back to the front");
});

test("no page errors were thrown along the way", () => {
  assert.deepEqual(pageErrors, []);
});
