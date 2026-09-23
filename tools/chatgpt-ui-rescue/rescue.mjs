import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE_URL = process.env.CHATGPT_BASE_URL || "https://chatgpt.com";
const STATE_PATH = process.env.CHATGPT_STORAGE_STATE || "";
const REPORT_PATH = process.env.CHATGPT_RESCUE_REPORT || "chatgpt-ui-rescue-report.json";
const TARGETS = (process.env.CHATGPT_TARGET_TASKS || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

const report = {
  schema_version: 1,
  started_at_utc: new Date().toISOString(),
  authenticated: false,
  blocked_cards_found: 0,
  repaired_cards: [],
  unchanged_cards: [],
  errors: [],
  status: "starting"
};

function addError(stage, err) {
  report.errors.push({
    stage,
    name: err && err.name ? err.name : "Error",
    message: String(err && err.message ? err.message : err).slice(0, 1200)
  });
}

function saveReport() {
  report.finished_at_utc = new Date().toISOString();
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");
}

async function isVisible(locator, timeout = 1000) {
  try {
    await locator.first().waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

async function clickNamed(scope, names) {
  for (const name of names) {
    for (const role of ["button", "link", "menuitem", "option", "tab"]) {
      const locator = name instanceof RegExp
        ? scope.getByRole(role, { name })
        : scope.getByRole(role, { name, exact: true });
      if (await isVisible(locator, 700)) {
        await locator.first().click();
        return true;
      }
    }

    const text = name instanceof RegExp
      ? scope.getByText(name, { exact: false })
      : scope.getByText(name, { exact: true });

    if (await isVisible(text, 700)) {
      await text.first().click();
      return true;
    }
  }
  return false;
}

async function signedOut(page) {
  if (/auth0|login|signin/i.test(page.url())) return true;
  const login = page.getByRole("button", { name: /log in|sign in/i });
  const signup = page.getByRole("button", { name: /sign up/i });
  return (await isVisible(login, 500)) && (await isVisible(signup, 500));
}

async function settle(page, ms = 650) {
  await page.waitForTimeout(ms);
}

function targetAllowed(title) {
  if (!TARGETS.length) return true;
  return TARGETS.some((target) => title.toLowerCase().includes(target.toLowerCase()));
}

async function choosePersistentPermission(page) {
  let changed = false;

  const persistControls = [
    /allow all actions/i,
    /always allow/i,
    /never ask/i,
    /don.?t ask again/i,
    /remember (my )?choice/i
  ];

  for (const rx of persistControls) {
    for (const role of ["radio", "checkbox", "option", "menuitem", "button"]) {
      const locator = page.getByRole(role, { name: rx });
      if (!(await isVisible(locator, 450))) continue;
      try {
        if (role === "checkbox" || role === "radio") {
          const checked = await locator.first().isChecked().catch(() => false);
          if (!checked) await locator.first().check().catch(async () => locator.first().click());
        } else {
          await locator.first().click();
        }
        changed = true;
        await settle(page, 350);
      } catch {}
    }
  }

  const approve = [
    /^(Allow|Approve|Confirm|Continue|Proceed)$/i,
    /allow this time/i,
    /allow and continue/i
  ];

  for (const rx of approve) {
    const button = page.getByRole("button", { name: rx });
    if (await isVisible(button, 600)) {
      await button.first().click();
      changed = true;
      await settle(page, 700);
      break;
    }
  }

  return changed;
}

async function resumeInsideTask(page) {
  let actions = 0;

  for (let pass = 0; pass < 12; pass++) {
    let progressed = false;

    if (await choosePersistentPermission(page)) {
      actions++;
      progressed = true;
    }

    const labels = [
      /^(Follow-up|Review|Review access|Review permission|Grant access)$/i,
      /^(Resume|Retry|Continue|Run now|Try again|Enable|Turn on)$/i
    ];

    for (const rx of labels) {
      const button = page.getByRole("button", { name: rx });
      if (await isVisible(button, 600)) {
        await button.first().click();
        actions++;
        progressed = true;
        await settle(page, 700);
        break;
      }

      const link = page.getByRole("link", { name: rx });
      if (await isVisible(link, 600)) {
        await link.first().click();
        actions++;
        progressed = true;
        await settle(page, 700);
        break;
      }
    }

    if (!progressed) break;
  }

  return actions;
}

async function getCardTitle(card) {
  const heading = card.getByRole("heading").first();
  if (await isVisible(heading, 300)) {
    const value = (await heading.innerText().catch(() => "")).trim();
    if (value) return value;
  }

  const text = (await card.innerText().catch(() => "")).trim();
  return text.split("\n").map((x) => x.trim()).find(Boolean) || "Unknown task";
}

async function scanBlockedCards(page) {
  const markers = [
    /this task needs your attention/i,
    /needs your attention/i,
    /needs attention/i,
    /follow-up/i,
    /permission required/i,
    /action required/i,
    /approval required/i
  ];

  const cards = [];
  const seen = new Set();

  for (const marker of markers) {
    const texts = page.getByText(marker, { exact: false });
    const count = Math.min(await texts.count().catch(() => 0), 100);

    for (let i = 0; i < count; i++) {
      const markerNode = texts.nth(i);
      if (!(await markerNode.isVisible().catch(() => false))) continue;

      let card = markerNode.locator("xpath=ancestor::*[self::article or @role='article' or @data-testid or contains(@class,'card')][1]");
      if ((await card.count().catch(() => 0)) === 0) {
        card = markerNode.locator("xpath=ancestor::div[.//button or .//a][1]");
      }

      if ((await card.count().catch(() => 0)) === 0) continue;

      const title = await getCardTitle(card);
      const key = title + "|" + (await card.innerText().catch(() => "")).slice(0, 200);
      if (seen.has(key)) continue;
      seen.add(key);
      cards.push({ title, card });
    }
  }

  return cards;
}

async function openCard(card) {
  const preferred = [
    /^(Follow-up|Review|Open|View details|Continue|Resume|Retry)$/i
  ];

  for (const rx of preferred) {
    for (const role of ["button", "link"]) {
      const locator = card.getByRole(role, { name: rx });
      if (await isVisible(locator, 500)) {
        await locator.first().click();
        return true;
      }
    }
  }

  const link = card.locator("a[href]").first();
  if (await isVisible(link, 500)) {
    await link.click();
    return true;
  }

  await card.click();
  return true;
}

async function repairCard(page, title, card) {
  const entry = { title, actions: 0, resolved: false, note: "" };

  try {
    if (!targetAllowed(title)) {
      entry.note = "skipped-by-target-filter";
      return entry;
    }

    await openCard(card);
    await settle(page, 750);

    entry.actions += await resumeInsideTask(page);

    const attention = page.getByText(/this task needs your attention|needs attention|permission required|approval required/i, { exact: false });
    entry.resolved = !(await isVisible(attention, 800));

    if (!entry.resolved) {
      entry.actions += await resumeInsideTask(page);
      entry.resolved = !(await isVisible(attention, 800));
    }

    await clickNamed(page, ["Done", "Close"]).catch(() => {});
    await settle(page, 350);
  } catch (err) {
    entry.note = "error";
    addError("task:" + title, err);
  }

  return entry;
}

if (!STATE_PATH || !fs.existsSync(STATE_PATH)) {
  report.status = "auth-bootstrap-required";
  addError("bootstrap", new Error("CHATGPT_STORAGE_STATE is missing."));
  saveReport();
  process.exit(2);
}

const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({ storageState: STATE_PATH });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);

  await page.goto(BASE_URL + "/schedules", { waitUntil: "domcontentloaded", timeout: 45000 });
  await settle(page, 1200);

  if (await signedOut(page)) {
    throw new Error("AUTH_REQUIRED: stored ChatGPT browser state expired or is invalid.");
  }

  report.authenticated = true;

  for (let cycle = 0; cycle < 8; cycle++) {
    const blocked = await scanBlockedCards(page);
    report.blocked_cards_found = Math.max(report.blocked_cards_found, blocked.length);

    const eligible = blocked.filter((item) => targetAllowed(item.title));
    if (!eligible.length) break;

    let resolvedThisCycle = 0;

    for (const item of eligible) {
      const result = await repairCard(page, item.title, item.card);
      if (result.resolved) {
        report.repaired_cards.push(result);
        resolvedThisCycle++;
      } else {
        report.unchanged_cards.push(result);
      }

      await page.goto(BASE_URL + "/schedules", { waitUntil: "domcontentloaded", timeout: 45000 });
      await settle(page, 900);
    }

    if (!resolvedThisCycle) break;
  }

  const remaining = await scanBlockedCards(page);
  const remainingEligible = remaining.filter((item) => targetAllowed(item.title));

  report.remaining_blocked_cards = remainingEligible.map((item) => item.title);
  report.status = remainingEligible.length === 0 ? "success" : "partial-blockers-remain";
  saveReport();

  console.log(JSON.stringify(report, null, 2));
  process.exitCode = remainingEligible.length === 0 ? 0 : 3;
} catch (err) {
  addError("main", err);
  report.status = /AUTH_REQUIRED/.test(String(err && err.message ? err.message : err))
    ? "auth-refresh-required"
    : "error";
  saveReport();
  console.error(String(err && err.stack ? err.stack : err));
  process.exitCode = report.status === "auth-refresh-required" ? 2 : 1;
} finally {
  await browser.close();
}
