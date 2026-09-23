import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const userDataDir = process.env.CHROME_USER_DATA_DIR;
const profile = process.env.CHROME_PROFILE_DIRECTORY || "Default";
const chromePath = process.env.CHROME_EXECUTABLE_PATH || undefined;
const output = path.resolve(process.env.CHATGPT_STORAGE_STATE_OUT || ".chatgpt-storage-state.json");

if (!userDataDir || !fs.existsSync(userDataDir)) {
  console.error("CHROME_USER_DATA_DIR does not exist.");
  process.exit(2);
}

const options = {
  headless: false,
  args: ["--profile-directory=" + profile]
};

if (chromePath) options.executablePath = chromePath;
else options.channel = "chrome";

const context = await chromium.launchPersistentContext(userDataDir, options);

try {
  const page = context.pages()[0] || await context.newPage();
  await page.goto("https://chatgpt.com/schedules", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1800);

  const login = page.getByRole("button", { name: /log in|sign in/i });
  const signup = page.getByRole("button", { name: /sign up/i });
  const signedOut = /auth0|login|signin/i.test(page.url()) ||
    ((await login.isVisible().catch(() => false)) && (await signup.isVisible().catch(() => false)));

  if (signedOut) {
    console.error("PROFILE_NOT_AUTHENTICATED");
    process.exitCode = 3;
  } else {
    await context.storageState({ path: output });
    fs.chmodSync(output, 0o600);
    console.log("CAPTURED_AUTHENTICATED_CHATGPT_STATE=" + output);
  }
} finally {
  await context.close();
}
