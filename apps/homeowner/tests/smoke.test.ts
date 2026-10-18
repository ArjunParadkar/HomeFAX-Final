/**
 * Smoke test for the homeowner app, against a running `next dev` on port 3001
 * (HOMEOWNER_URL overrides). Drives /usr/bin/chromium through playwright-core.
 *
 * Walks the primary flows as the seeded demo owner, then signs a fresh account
 * up through /claim with a code minted on the spot. It never decides the
 * seeded access request on 22 Cedar Ln — other apps' demos depend on it.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

const BASE = process.env.HOMEOWNER_URL ?? "http://localhost:3001";
const CHROMIUM = process.env.CHROMIUM_PATH ?? "/usr/bin/chromium";
const OWNER = { email: "rupali@demo.homefax", password: "homefax-demo-2026" };
const RIDGEMONT = "1418-ridgemont-dr-bentonville";
const UNCLAIMED = "1200-nw-3rd-st-bentonville";
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(APP_DIR, "..", "..");

let browser: Browser;
let ctx: BrowserContext;
let page: Page;
let shareUrl = "";
const shareLabel = `Smoke ${Date.now()}`;

async function newContext(): Promise<BrowserContext> {
  return browser.newContext({ viewport: { width: 390, height: 844 } });
}

async function signIn(p: Page, email: string, password: string): Promise<void> {
  await p.goto(`${BASE}/?mode=signin`);
  await p.fill("#signin-email", email);
  await p.fill("#signin-password", password);
  await p.click("form button[type=submit]");
  await p.waitForURL(/\/home/);
}

before(async () => {
  const ping = await fetch(`${BASE}/`).catch(() => null);
  assert.ok(ping && ping.ok, `the homeowner dev server must be running at ${BASE} (npm run dev -w @homefax/homeowner)`);
  browser = await chromium.launch({
    executablePath: CHROMIUM,
    args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-accelerated-video-decode"],
  });
  ctx = await newContext();
  page = await ctx.newPage();
});

after(async () => {
  await browser?.close();
});

test("the landing page offers sign in, create account, and a claim code", async () => {
  await page.goto(`${BASE}/`);
  await page.waitForSelector("main");
  assert.match(await page.textContent("main") ?? "", /Have a claim code\?/);
  assert.equal(await page.locator('a[aria-current="page"]').textContent(), "Sign in");
  await page.goto(`${BASE}/?mode=signup`);
  assert.equal(await page.locator('a[aria-current="page"]').textContent(), "Create account");
});

test("a wrong password says so on the same page", async () => {
  // A throwaway address: five failures in fifteen minutes lock an account, and
  // the demo owner must stay signed-in-able for the rest of the run.
  await page.goto(`${BASE}/?mode=signin`);
  await page.fill("#signin-email", `nobody-${Date.now()}@demo.homefax`);
  await page.fill("#signin-password", "not-the-password");
  await page.click("form button[type=submit]");
  await page.waitForSelector("main [role=alert]");
  assert.match((await page.textContent("main [role=alert]")) ?? "", /do not match/);
});

test("Rupali signs in and lands on her houses", async () => {
  await signIn(page, OWNER.email, OWNER.password);
  await page.waitForSelector("main");
  const text = (await page.textContent("main")) ?? "";
  assert.match(text, /1418 Ridgemont Dr/);
  assert.match(text, /7 Maple Ct/);
  // Every house card carries the eleven-tick comb as navigation.
  assert.equal(await page.locator('nav[aria-label="Stages of 1418 Ridgemont Dr"] a').count(), 11);
});

test("opens 1418 Ridgemont Dr: house card, grade stamp, stats, timeline, rail", async () => {
  await page.click('a[href="/home/1418-ridgemont-dr-bentonville"]');
  await page.waitForURL(new RegExp(`/home/${RIDGEMONT}$`));
  await page.waitForSelector("main");
  const text = (await page.textContent("main")) ?? "";
  assert.match(text, /stages on file/i);
  assert.match(text, /HomeFAX assessed/i);
  assert.match(text, /Points passed/);
  assert.match(text, /The sequence/);
  assert.match(text, /Show everything/);
  assert.equal(await page.locator("main").count(), 1);
});

test("a comb tick opens the framing stage with the ledger and the simulated-model note", async () => {
  await page.click('nav[aria-label="Stages of 1418 Ridgemont Dr"] a[aria-label*="Framing"]');
  await page.waitForURL(new RegExp(`/home/${RIDGEMONT}/stages/framing$`));
  await page.waitForSelector("main");
  const text = (await page.textContent("main")) ?? "";
  assert.match(text, /Simulated geometry/);
  assert.match(text, /50-point ledger/);
  assert.match(text, /What this means for your house/);
  assert.match(text, /What was put in/);
  assert.ok((await page.locator('img[alt^="Frame 1 of"]').count()) >= 1, "frames kept from the walk are shown");
});

test("materials lists what is in the walls with a total", async () => {
  await page.goto(`${BASE}/home/${RIDGEMONT}/materials`);
  await page.waitForSelector("main");
  const text = (await page.textContent("body")) ?? "";
  assert.match(text, /What is in your walls/);
  assert.match(text, /\$[\d,]+/);
});

test("/access shows the lender's grant and the municipality's statutory view", async () => {
  await page.goto(`${BASE}/home/${RIDGEMONT}/access`);
  await page.waitForSelector("main");
  const text = (await page.textContent("main")) ?? "";
  assert.match(text, /First Ozark Bank/);
  assert.match(text, /City of Bentonville/);
  assert.match(text, /Every look taken/);
  assert.ok((await page.locator('form button:has-text("Revoke")').count()) >= 1, "grants carry a Revoke");
});

test("creates a summary share link and sees the URL once", async () => {
  await page.fill("#share-label", shareLabel);
  await page.selectOption("#share-scope", "summary");
  await page.selectOption("#share-expires", "7");
  await page.click('button:has-text("Create share link")');
  await page.waitForSelector("#share-url");
  shareUrl = await page.inputValue("#share-url");
  assert.match(shareUrl, /\/r\/[A-Za-z0-9_-]{20,}$/);
  await page.click('button:has-text("I have copied it")');
  await page.waitForSelector("#share-url", { state: "detached" });
  await page.waitForSelector("main");
  assert.equal(await page.locator("#share-url").count(), 0, "the URL is shown once");
  assert.match((await page.textContent("main")) ?? "", new RegExp(shareLabel));
});

test("the share link opens signed out and shows the summary only", async () => {
  const visitor = await newContext();
  const v = await visitor.newPage();
  await v.goto(shareUrl);
  await v.waitForSelector("main");
  const text = (await v.textContent("main")) ?? "";
  assert.match(text, /1418 Ridgemont Dr/);
  assert.match(text, /Shared by the owner/);
  assert.match(text, /summary access/);
  assert.match(text, /Grade per stage/);
  assert.match(text, /Summary access/);
  assert.doesNotMatch(text, /Weighted rubric/, "ledger content stays hidden at summary scope");
  assert.doesNotMatch(text, /Simulated geometry/, "models stay hidden at summary scope");
  assert.doesNotMatch(text, /What was put in/, "materials stay hidden at summary scope");
  await visitor.close();
});

test("the visitor's look is on the owner's access log, and revoking kills the link", async () => {
  await page.goto(`${BASE}/home/${RIDGEMONT}/access`);
  await page.waitForSelector("main");
  assert.match((await page.textContent("main")) ?? "", new RegExp(`Someone with the “${shareLabel}” link looked at the summary`));
  const row = page.locator("li", { hasText: shareLabel }).filter({ has: page.locator('button:has-text("Revoke")') }).first();
  await row.locator('button:has-text("Revoke")').click();
  await page.waitForSelector("main");
  const visitor = await newContext();
  const v = await visitor.newPage();
  await v.goto(shareUrl);
  await v.waitForSelector("main");
  assert.match((await v.textContent("main")) ?? "", /no longer opens/);
  await visitor.close();
});

test("a house that is not hers is not found", async () => {
  // notFound() renders the app's not-found page; with a route loading state the
  // streamed shell has already gone out, so the status line is not the signal.
  await page.goto(`${BASE}/home/22-cedar-ln-bentonville`);
  await page.waitForSelector("main");
  assert.match((await page.textContent("main")) ?? "", /nothing here for you/i);
});

test("Dana has one house and is sent straight to it, with the insurer's request waiting", async () => {
  const dana = await newContext();
  const d = await dana.newPage();
  await signIn(d, "dana@demo.homefax", OWNER.password);
  await d.waitForURL(/\/home\/22-cedar-ln-bentonville$/);
  await d.waitForSelector("main");
  const text = (await d.textContent("main")) ?? "";
  assert.match(text, /Ozark Mutual is asking to see this house/);
  await d.goto(`${BASE}/home/22-cedar-ln-bentonville/access`);
  await d.waitForSelector("main");
  const access = (await d.textContent("main")) ?? "";
  assert.match(access, /Waiting on you/);
  assert.ok((await d.locator('button:has-text("Summary only")').count()) >= 1, "the owner can approve summary only");
  await dana.close();
});

test("the account page shows the person, their sessions, and sign out", async () => {
  await page.goto(`${BASE}/account`);
  await page.waitForSelector("main");
  const text = (await page.textContent("main")) ?? "";
  assert.match(text, /Signed in/);
  assert.match(text, /this device/i);
  assert.match(text, /Delete my account/);
});

test("a bad claim code is refused in the record's voice", async () => {
  const fresh = await newContext();
  const f = await fresh.newPage();
  await f.goto(`${BASE}/claim`);
  await f.fill("#claim-code", "zzzz2222");
  assert.equal(await f.inputValue("#claim-code"), "ZZZZ-2222", "the code auto-formats");
  await f.fill("#claim-name", "Nobody Smoke");
  await f.fill("#claim-email", `nobody-${Date.now()}@demo.homefax`);
  await f.fill("#claim-password", "a long passphrase 9");
  await f.click('button:has-text("Open my house")');
  await f.waitForSelector("main [role=alert]");
  assert.match((await f.textContent("main [role=alert]")) ?? "", /not valid or has expired/);
  await fresh.close();
});

test("a fresh account signs up through /claim with a minted code and lands on the house", async () => {
  // Run from the app directory so the script's env loader finds this app's .env.local.
  const out = execFileSync("npx", ["tsx", path.join(REPO_ROOT, "packages/db/scripts/issue-claim-code.ts"), UNCLAIMED], { cwd: APP_DIR, encoding: "utf8", env: process.env });
  const code = out.match(/claim code: ([A-Z0-9]{4}-[A-Z0-9]{4})/)?.[1];
  assert.ok(code, `issue-claim-code printed a code: ${out}`);

  const fresh = await newContext();
  const f = await fresh.newPage();
  await f.goto(`${BASE}/claim`);
  await f.fill("#claim-code", code.toLowerCase().replace("-", ""));
  await f.fill("#claim-name", "Smoke Owner");
  await f.fill("#claim-email", `smoke-${Date.now()}@demo.homefax`);
  await f.fill("#claim-password", "a long passphrase 9");
  await f.click('button:has-text("Open my house")');
  await f.waitForURL(new RegExp(`/home/${UNCLAIMED}`));
  await f.waitForSelector("main");
  const text = (await f.textContent("main")) ?? "";
  assert.match(text, /This house is now on your record/);
  assert.match(text, /1200 NW 3rd St/);
  // The one-use code is spent.
  await f.goto(`${BASE}/claim`);
  await f.fill("#claim-code", code);
  await f.click('button:has-text("Add the house")');
  await f.waitForSelector("main [role=alert]");
  assert.match((await f.textContent("main [role=alert]")) ?? "", /not valid or has expired/);
  await fresh.close();
});
