import { chromium } from "playwright";
import readline from "node:readline/promises";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const output = path.resolve(process.env.CHATGPT_STORAGE_STATE_OUT || ".chatgpt-storage-state.json");

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();

await page.goto("https://chatgpt.com/schedules", { waitUntil: "domcontentloaded" });

console.log("");
console.log("Sign in to the ChatGPT account that owns the scheduled tasks.");
console.log("Leave the Scheduled page open with your task cards visible.");
console.log("Then return here and press ENTER.");
console.log("");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await rl.question("Press ENTER after the Scheduled page is fully visible: ");
rl.close();

await context.storageState({ path: output });
await browser.close();
fs.chmodSync(output, 0o600);

console.log("Saved browser state to " + output);
console.log("Do not commit this file. Store it only in the encrypted GitHub Actions secret CHATGPT_STORAGE_STATE_B64.");
