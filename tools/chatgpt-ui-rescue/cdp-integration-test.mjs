import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const host = "127.0.0.1";
const webPort = 8765;
const cdpPort = 9333;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-cdp-test-"));
const reportPath = path.join(tempDir, "report.json");

const html = `<!doctype html>
<html><body>
<article class="card">
<h2>Minecraft Mod Catalogue Updater</h2>
<div id="attention">This task needs your attention</div>
<button id="review">Review</button>
</article>
<div id="dialog" role="dialog" aria-label="Task follow-up" hidden>
<button id="full">Allow all actions</button>
<button id="allow">Allow</button>
<button id="resume" hidden>Resume</button>
</div>
<script>
const dialog = document.getElementById("dialog");
document.getElementById("review").addEventListener("click", () => { dialog.hidden = false; });
document.getElementById("full").addEventListener("click", () => { document.body.dataset.permission = "full"; });
document.getElementById("allow").addEventListener("click", () => {
  document.getElementById("resume").hidden = false;
  document.getElementById("allow").hidden = true;
});
document.getElementById("resume").addEventListener("click", () => {
  document.getElementById("attention").remove();
  dialog.hidden = true;
  document.body.dataset.resumed = "true";
});
</script>
</body></html>`;

const server = http.createServer((req, res) => {
  if (req.url === "/schedules" || req.url === "/schedules/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

await new Promise((resolve) => server.listen(webPort, host, resolve));

const chromePath = chromium.executablePath();
const chrome = spawn(chromePath, [
  `--remote-debugging-port=${cdpPort}`,
  `--remote-debugging-address=${host}`,
  `--user-data-dir=${path.join(tempDir, "profile")}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--no-sandbox",
  "--headless=new",
  `http://${host}:${webPort}/schedules`
], { stdio: ["ignore", "pipe", "pipe"] });

async function waitForCdp() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://${host}:${cdpPort}/json/version`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Chrome CDP endpoint did not become ready.");
}

function runRescue() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["rescue.mjs"], {
      cwd: here,
      env: {
        ...process.env,
        CHATGPT_CDP_URL: `http://${host}:${cdpPort}`,
        CHATGPT_BASE_URL: `http://${host}:${webPort}`,
        CHATGPT_RESCUE_REPORT: reportPath,
        CHATGPT_TARGET_TASKS: "Minecraft Mod Catalogue Updater"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`rescue exited ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
    });
  });
}

try {
  await waitForCdp();
  const output = await runRescue();
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  if (report.status !== "success") throw new Error(`unexpected status: ${report.status}`);
  if (report.repaired_cards.length < 1) throw new Error("no blocked card was repaired");
  if ((report.remaining_blocked_cards || []).length) throw new Error("blocked card remained after CDP rescue");
  console.log(output.stdout.trim());
  console.log("CDP_INTEGRATION_PASS");
} finally {
  server.close();
  chrome.kill("SIGTERM");
}
