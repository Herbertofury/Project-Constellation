import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const configPath = process.env.CHATGPT_RESCUE_AGENT_CONFIG || path.join(here, "agent-config.json");
const statePath = path.join(here, "agent-state.json");
const lockPath = path.join(here, "agent.lock");
const logPath = path.join(here, "agent.log.jsonl");
const reportPath = path.join(here, "last-rescue-report.json");

function nowIso() { return new Date().toISOString(); }

function log(event, data = {}) {
  const row = { ts: nowIso(), event, ...data };
  fs.appendFileSync(logPath, JSON.stringify(row) + "\n", "utf8");
  console.log(JSON.stringify(row));
}

function readJson(file, fallback) {
  // Windows PowerShell 5.1 writes a UTF-8 BOM for Set-Content -Encoding UTF8.
  // Accept those installed configs and state files without hiding other syntax errors.
  try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch { return fallback; }
}

function writeJson(file, value) {
  const tmp = file + ".tmp";
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n", "utf8");
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

function savedTime(value, now = Date.now()) {
  if (typeof value !== "string") return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= now ? parsed : 0;
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function acquireLock() {
  const existing = readJson(lockPath, null);
  if (existing && pidAlive(existing.pid)) {
    log("skip-overlap", { active_pid: existing.pid, since: existing.started_at });
    return false;
  }
  try { fs.unlinkSync(lockPath); } catch {}
  writeJson(lockPath, { pid: process.pid, started_at: nowIso() });
  return true;
}

function releaseLock() {
  try {
    const current = readJson(lockPath, null);
    if (!current || current.pid === process.pid) fs.unlinkSync(lockPath);
  } catch {}
}

function requiredConfig() {
  const cfg = readJson(configPath, null);
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) throw new Error("agent-config.json is missing or contains invalid JSON.");
  for (const key of ["heartbeatUrl", "cdpUrl", "chromePath", "profileDir"]) {
    if (!cfg[key]) throw new Error(`agent-config.json is missing ${key}.`);
  }
  const result = {
    heartbeatPollSeconds: 240,
    heartbeatTimeoutSeconds: 10,
    minRescueIntervalSeconds: 55,
    cdpReadySeconds: 20,
    rescueTimeoutSeconds: 120,
    ...cfg
  };
  if (!Number.isFinite(result.heartbeatTimeoutSeconds) || result.heartbeatTimeoutSeconds <= 0 || result.heartbeatTimeoutSeconds > 30) {
    throw new Error("agent-config.json heartbeatTimeoutSeconds must be a number greater than 0 and at most 30.");
  }
  return result;
}

function parseHeartbeat(body) {
  const generation = Number((body.match(/^generation:\s*(\d+)/mi) || [])[1] || 0);
  const action = ((body.match(/^desired_action:\s*(\S+)/mi) || [])[1] || "").trim();
  const heartbeatUtc = ((body.match(/^heartbeat_utc:\s*(.+)$/mi) || [])[1] || "").trim();
  return { generation, action, heartbeatUtc };
}

async function fetchHeartbeat(cfg, state) {
  const last = savedTime(state.lastHeartbeatFetch);
  if (Date.now() - last < cfg.heartbeatPollSeconds * 1000 && state.lastHeartbeat) return state.lastHeartbeat;
  try {
    const response = await fetch(cfg.heartbeatUrl, {
      signal: AbortSignal.timeout(Math.max(1, Math.ceil(cfg.heartbeatTimeoutSeconds * 1000))),
      headers: {
        "Accept": "application/vnd.github+json",
        "User-Agent": "ProjectConstellation-ChatGPT-Rescue-Agent"
      }
    });
    if (!response.ok) throw new Error(`heartbeat HTTP ${response.status}`);
    const issue = await response.json();
    const hb = parseHeartbeat(issue.body || "");
    state.lastHeartbeatFetch = nowIso();
    state.lastHeartbeat = hb;
    log("heartbeat", hb);
    return hb;
  } catch (err) {
    state.lastHeartbeatFetch = nowIso();
    log("heartbeat-unavailable", { message: String(err.message || err) });
    return state.lastHeartbeat || { generation: 0, action: "", heartbeatUtc: "" };
  }
}

async function cdpReady(cdpUrl) {
  try {
    const u = new URL("/json/version", cdpUrl);
    const r = await fetch(u, { signal: AbortSignal.timeout(1800) });
    return r.ok;
  } catch { return false; }
}

function launchChrome(cfg) {
  fs.mkdirSync(cfg.profileDir, { recursive: true });
  const u = new URL(cfg.cdpUrl);
  const port = u.port || "9222";
  const args = [
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${cfg.profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-mode",
    "https://chatgpt.com/schedules"
  ];
  const child = spawn(cfg.chromePath, args, { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
  log("chrome-launched", { pid: child.pid, profileDir: cfg.profileDir, cdpUrl: cfg.cdpUrl });
}

async function ensureChrome(cfg) {
  if (await cdpReady(cfg.cdpUrl)) return;
  launchChrome(cfg);
  const deadline = Date.now() + cfg.cdpReadySeconds * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (await cdpReady(cfg.cdpUrl)) return;
  }
  throw new Error("Local Chrome CDP endpoint did not become ready.");
}

function runRescue(cfg) {
  return new Promise((resolve) => {
    try { fs.unlinkSync(reportPath); } catch {}
    const child = spawn(process.execPath, ["rescue.mjs"], {
      cwd: here,
      env: {
        ...process.env,
        CHATGPT_CDP_URL: cfg.cdpUrl,
        CHATGPT_BASE_URL: "https://chatgpt.com",
        CHATGPT_RESCUE_REPORT: reportPath
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
    }, cfg.rescueTimeoutSeconds * 1000);
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      const report = readJson(reportPath, null);
      resolve({ code, signal, stdout: stdout.slice(-8000), stderr: stderr.slice(-8000), report });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, signal: null, stdout, stderr: String(err), report: null });
    });
  });
}

if (!acquireLock()) process.exit(0);

const savedState = readJson(statePath, null);
let state = savedState && typeof savedState === "object" && !Array.isArray(savedState) ? savedState : { schema: 1 };
try {
  const cfg = requiredConfig();
  const hb = await fetchHeartbeat(cfg, state);
  const lastAttemptMs = Math.max(savedTime(state.lastAttemptAt), savedTime(state.lastRescueAt));
  const lastGeneration = Math.max(Number(state.lastAttemptHeartbeatGeneration || 0), Number(state.lastHeartbeatGeneration || 0));
  const heartbeatChanged = Number(hb.generation || 0) > lastGeneration;
  const intervalDue = Date.now() - lastAttemptMs >= cfg.minRescueIntervalSeconds * 1000;
  const force = process.env.CHATGPT_FORCE_RESCUE === "1";

  if (!force && !heartbeatChanged && !intervalDue) {
    writeJson(statePath, state);
    log("cooldown-noop", { heartbeat_generation: hb.generation || 0, previous_attempt: state.lastAttemptStatus || state.lastReportStatus || "unknown" });
    process.exitCode = 0;
  } else {
    // Commit the attempt before Chrome launch or rescue can change anything.
    // A terminated agent therefore cannot immediately replay the same request.
    // This is an attempt claim, never evidence that a task was repaired.
    state.lastAttemptAt = nowIso();
    state.lastAttemptHeartbeatGeneration = Number(hb.generation || 0);
    state.lastAttemptStatus = "started";
    delete state.lastAgentError;
    writeJson(statePath, state);
    await ensureChrome(cfg);
    const result = await runRescue(cfg);
    state.lastRescueAt = nowIso();
    state.lastHeartbeatGeneration = Number(hb.generation || state.lastHeartbeatGeneration || 0);
    state.lastExitCode = result.code;
    state.lastReportStatus = result.report?.status || "missing-report";
    state.lastAttemptStatus = result.code === 0 ? "completed" : "failed";
    state.lastRepairedCards = result.report?.repaired_cards?.map((x) => x.title) || [];
    state.lastRemainingBlockedCards = result.report?.remaining_blocked_cards || [];
    state.lastErrors = result.report?.errors || [];
    writeJson(statePath, state);
    log("rescue-result", {
      code: result.code,
      status: state.lastReportStatus,
      repaired: state.lastRepairedCards,
      remaining: state.lastRemainingBlockedCards,
      stderr: result.stderr.slice(-1200)
    });

    if (result.report?.status === "auth-refresh-required") {
      log("local-login-required", { message: "Chrome was left open on ChatGPT. Sign in there once; the next scheduled run will retry automatically." });
      process.exitCode = 2;
    } else if (result.report?.status === "browser-verification-required") {
      log("local-verification-required", { message: "Chrome was left open for normal local verification; the next scheduled run will retry automatically." });
      process.exitCode = 3;
    } else {
      process.exitCode = result.code === 0 ? 0 : 1;
    }
  }
} catch (err) {
  state.lastAttemptStatus = "failed";
  state.lastAgentError = { at: nowIso(), message: String(err.stack || err) };
  writeJson(statePath, state);
  log("agent-error", { message: String(err.stack || err) });
  process.exitCode = 1;
} finally {
  releaseLock();
}
