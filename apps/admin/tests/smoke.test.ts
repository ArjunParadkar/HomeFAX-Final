import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

/**
 * Walks the primary flows of the admin app against a running `next dev` on
 * port 3002 (override with ADMIN_BASE_URL). Signs in as each demo institution,
 * opens the dashboard, the board, and one property; the city records a review;
 * the bank decides a draw.
 *
 * Server actions redirect inside the POST, so every step waits on the URL or
 * a selector, never on a GET.
 */

const BASE = process.env.ADMIN_BASE_URL ?? "http://localhost:3002";
const PASSWORD = "homefax-demo-2026";
const CHROMIUM = process.env.CHROMIUM_PATH ?? "/usr/bin/chromium";

let browser: Browser;

before(async () => {
  const ok = await fetch(`${BASE}/`).then((r) => r.ok).catch(() => false);
  assert.ok(ok, `admin app is not answering at ${BASE} — run \`npm run dev -w @homefax/admin\` first`);
  browser = await chromium.launch({
    executablePath: CHROMIUM,
    args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-accelerated-video-decode"],
  });
});

after(async () => {
  await browser?.close();
});

async function signIn(email: string): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/?mode=signin`);
  await page.fill("#signin-email", email);
  await page.fill("#signin-password", PASSWORD);
  await page.click("button[type=submit]:has-text('Sign in')");
  await page.waitForURL(/\/dashboard$/, { timeout: 60_000 });
  return { ctx, page, errors };
}

async function bodyText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText);
}

async function expectClean(page: Page, errors: string[]) {
  const text = await bodyText(page);
  assert.doesNotMatch(text, /Application error|Unhandled Runtime Error|Internal Server Error/);
  assert.deepEqual(errors, []);
}

/** Dashboard → board → one property, as every workspace. */
async function walk(email: string, orgName: string, propertySlug: string, boardPath: string) {
  const { ctx, page, errors } = await signIn(email);
  try {
    assert.match(await bodyText(page), new RegExp(orgName));
    await expectClean(page, errors);

    await page.goto(`${BASE}/properties`);
    await page.waitForSelector("a.tile");
    assert.ok((await page.locator("a.tile").count()) >= 1, "the board shows at least one house");
    await expectClean(page, errors);

    await page.goto(`${BASE}${boardPath}`);
    await page.waitForSelector("main h1");
    await expectClean(page, errors);

    await page.goto(`${BASE}/properties/${propertySlug}`);
    await page.waitForSelector("main h1");
    const text = await bodyText(page);
    assert.match(text, /You see this house/);
    assert.match(text, /Risk profile/i);
    await expectClean(page, errors);
  } finally {
    await ctx.close();
  }
}

describe("admin smoke", () => {
  test("landing page offers sign in and create account", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    try {
      await page.goto(`${BASE}/`);
      assert.ok(await page.locator("#signin-email").isVisible());
      await page.goto(`${BASE}/?mode=signup`);
      assert.ok(await page.locator("#signup-email").isVisible());
      await page.goto(`${BASE}/dashboard`);
      await page.waitForURL(/\/\??(mode=signin)?$/);
    } finally {
      await ctx.close();
    }
  });

  test("wrong password is refused with a message", async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await page.goto(`${BASE}/?mode=signin`);
      await page.fill("#signin-email", "cal@demo.homefax");
      await page.fill("#signin-password", "not-the-password");
      await page.click("button[type=submit]:has-text('Sign in')");
      await page.waitForURL(/error=/);
      assert.match(await bodyText(page), /do not match|Too many attempts/);
    } finally {
      await ctx.close();
    }
  });

  test("City of Bentonville: dashboard, board, a property", async () => {
    await walk("cal@demo.homefax", "City of Bentonville", "1418-ridgemont-dr-bentonville", "/jurisdiction");
  });

  test("First Ozark Bank: dashboard, board, a property", async () => {
    await walk("bea@demo.homefax", "First Ozark Bank", "1418-ridgemont-dr-bentonville", "/portfolio");
  });

  test("Ozark Mutual: dashboard, board, a property", async () => {
    await walk("omar@demo.homefax", "Ozark Mutual", "1418-ridgemont-dr-bentonville", "/policies");
  });

  test("Ridgeline Realty: dashboard, board, a property", async () => {
    await walk("ava@demo.homefax", "Ridgeline Realty", "7-maple-ct-bentonville", "/listings");
  });

  test("the city records a review", async () => {
    const { ctx, page, errors } = await signIn("cal@demo.homefax");
    try {
      await page.goto(`${BASE}/inspections?all=1`);
      await page.waitForSelector("main h1");
      const review = page.locator("table a[href^='/inspections/']").first();
      assert.ok(await review.count(), "there is a filmed stage to review");
      await review.click();
      await page.waitForURL(/\/inspections\/[\w-]+$/);
      await page.waitForSelector("form button[name=verdict][value=verified]");
      const note = `Smoke review ${new Date().toISOString()}`;
      await page.fill("#notes", note);
      await page.click("form button[name=verdict][value=verified]");
      await page.waitForURL(/\/inspections\?ok=verified/);
      assert.match(await bodyText(page), /Verdict recorded/);
      // The verdict is in the history with the note.
      await page.goto(`${BASE}/inspections?all=1`);
      assert.match(await bodyText(page), new RegExp(note.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      await expectClean(page, errors);
    } finally {
      await ctx.close();
    }
  });

  test("the bank decides a draw", async () => {
    const { ctx, page, errors } = await signIn("bea@demo.homefax");
    try {
      // Record a fresh request so there is always one to decide, then hold it with a note.
      await page.goto(`${BASE}/draws`);
      await page.waitForSelector("#holding");
      await page.selectOption("#stage", "drywall");
      await page.fill("#amount", "1250");
      await page.click("form:has(#holding) button[type=submit]");
      // The action redirects back to /draws; wait for the new row, not the URL.
      const row = page.locator("table tbody tr", { hasText: "Drywall" }).filter({ hasText: "Requested" }).first();
      await row.waitFor({ timeout: 30_000 });
      assert.ok(await row.count(), "the new draw is in the ledger awaiting decision");
      await row.locator("a:has-text('Detail')").click();
      await page.waitForURL(/\/draws\/[\w-]+$/);
      await page.waitForSelector("text=What the record says now");
      const text = await bodyText(page);
      assert.match(text, /What the record says now/i);
      assert.match(text, /has not been filmed|Stage graded/i);
      await page.fill("#note", "Smoke test: held pending the filmed stage");
      await page.click("form button[name=status][value=held]");
      await page.waitForSelector("text=Smoke test: held", { timeout: 30_000 });
      const after = await bodyText(page);
      assert.match(after, /Held/i);
      assert.match(after, /Smoke test: held/);
      await expectClean(page, errors);
    } finally {
      await ctx.close();
    }
  });

  test("the jurisdiction exports as CSV", async () => {
    const { ctx, page } = await signIn("cal@demo.homefax");
    try {
      const res = await page.request.get(`${BASE}/jurisdiction/export?status=active`);
      assert.equal(res.status(), 200);
      assert.match(res.headers()["content-type"] ?? "", /text\/csv/);
      const csv = await res.text();
      assert.match(csv.split("\n")[0], /^address,city,state,zip/);
    } finally {
      await ctx.close();
    }
  });

  test("a lender cannot open a municipality page", async () => {
    const { ctx, page } = await signIn("bea@demo.homefax");
    try {
      await page.goto(`${BASE}/inspections`);
      await page.waitForURL(/\/dashboard$/);
      const res = await page.request.get(`${BASE}/jurisdiction/export`);
      assert.equal(res.status(), 403);
    } finally {
      await ctx.close();
    }
  });
});
