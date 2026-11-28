import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import test from "node:test";

const source = process.env.CHATGPT_RESCUE_AGENT_SOURCE || fileURLToPath(new URL("../tools/chatgpt-ui-rescue/local-agent.mjs", import.meta.url));

async function fixture(t, { bom = false, state = null, hangHeartbeat = false } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "constellation-local-agent-"));
  const children = new Set();
  let generation = 1;
  const server = http.createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/heartbeat" && hangHeartbeat) return;
    if (request.url === "/heartbeat") response.end(JSON.stringify({ body: `generation: ${generation}\ndesired_action: repair\n` }));
    else if (request.url === "/json/version") response.end(JSON.stringify({ Browser: "isolated-fixture" }));
    else { response.statusCode = 404; response.end("{}"); }
  });
  t.after(async () => {
    for (const child of children) child.kill("SIGKILL");
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const config = {
    heartbeatUrl: `${base}/heartbeat`, cdpUrl: base,
    chromePath: path.join(directory, "never-launch-Chrome"),
    profileDir: path.join(directory, "unused-profile"),
    heartbeatPollSeconds: 0, minRescueIntervalSeconds: 55,
    heartbeatTimeoutSeconds: 0.1,
    cdpReadySeconds: 1, rescueTimeoutSeconds: 2
  };
  await fs.copyFile(source, path.join(directory, "local-agent.mjs"));
  await fs.writeFile(path.join(directory, "agent-config.json"), (bom ? "\uFEFF" : "") + JSON.stringify(config));
  await fs.writeFile(path.join(directory, "rescue.mjs"), `
    import fs from 'node:fs';
    fs.appendFileSync('worker-runs.txt', 'run\\n');
    fs.writeFileSync(process.env.CHATGPT_RESCUE_REPORT, JSON.stringify({ status: 'success', repaired_cards: [], remaining_blocked_cards: [] }));
  `);
  if (state) await fs.writeFile(path.join(directory, "agent-state.json"), JSON.stringify(state));
  return {
    directory, config,
    setGeneration(value) { generation = value; },
    async run(env = {}, timeoutMs = 8000) {
      const child = spawn(process.execPath, [path.join(directory, "local-agent.mjs")], {
        cwd: directory, env: { ...process.env, CHATGPT_RESCUE_AGENT_CONFIG: path.join(directory, "agent-config.json"), CHATGPT_FORCE_RESCUE: "0", ...env },
        stdio: ["ignore", "pipe", "pipe"]
      });
      children.add(child);
      let stdout = "", stderr = "";
      child.stdout.on("data", (part) => { stdout += part; });
      child.stderr.on("data", (part) => { stderr += part; });
      const timeout = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
      const [code, signal] = await once(child, "close");
      clearTimeout(timeout);
      children.delete(child);
      return { code, signal, stdout, stderr };
    },
    async readState() { return JSON.parse(await fs.readFile(path.join(directory, "agent-state.json"), "utf8")); }
  };
}

test("accepts the UTF-8 BOM emitted by the Windows PowerShell installer", async (t) => {
  const f = await fixture(t, { bom: true });
  const result = await f.run();
  assert.equal(result.code, 0, JSON.stringify(result));
  assert.equal((await f.readState()).lastReportStatus, "success");
  assert.equal(await fs.readFile(path.join(f.directory, "worker-runs.txt"), "utf8"), "run\n");
  await assert.rejects(fs.access(path.join(f.directory, "unused-profile")));
});

test("retains failures for invalid JSON instead of launching the worker", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.directory, "agent-config.json"), "{invalid");
  const result = await f.run();
  assert.equal(result.code, 1, JSON.stringify(result));
  assert.match((await f.readState()).lastAgentError.message, /agent-config\.json/);
  await assert.rejects(fs.access(path.join(f.directory, "worker-runs.txt")));
});

test("a stalled heartbeat has a deadline and still allows local rescue", async (t) => {
  const f = await fixture(t, { hangHeartbeat: true });
  const result = await f.run({}, 3000);
  assert.equal(result.code, 0, JSON.stringify(result));
  assert.match(result.stdout, /heartbeat-unavailable/);
  assert.equal((await f.readState()).lastReportStatus, "success");
});

test("a process crash after starting rescue retains its cooldown claim", async (t) => {
  const f = await fixture(t);
  const worker = path.join(f.directory, "rescue.mjs");
  const normalWorker = await fs.readFile(worker, "utf8");
  await fs.writeFile(worker, `
    import fs from 'node:fs';
    fs.appendFileSync('worker-runs.txt', 'run\\n');
    process.kill(process.ppid, 'SIGKILL');
  `);
  const crashed = await f.run();
  assert.notEqual(crashed.code, 0, "Fixture must actually terminate the running agent");
  await fs.writeFile(worker, normalWorker);
  const retried = await f.run();
  assert.equal(retried.code, 0, JSON.stringify(retried));
  assert.equal(await fs.readFile(path.join(f.directory, "worker-runs.txt"), "utf8"), "run\n", "A started rescue must not replay before its minimum interval");
  assert.match(retried.stdout, /cooldown-noop/);
  assert.equal((await f.readState()).lastAttemptStatus, "started");
  assert.doesNotMatch(retried.stdout, /healthy-noop/);
});

test("future saved timestamps cannot suppress heartbeat refresh or rescue", async (t) => {
  const future = new Date(Date.now() + 86400000).toISOString();
  const f = await fixture(t, { state: {
    schema: 1, lastHeartbeatFetch: future,
    lastHeartbeat: { generation: 1 }, lastHeartbeatGeneration: 1,
    lastRescueAt: future, lastAttemptAt: future,
    lastAttemptHeartbeatGeneration: 1, lastAttemptStatus: "started"
  } });
  const result = await f.run();
  assert.equal(result.code, 0, JSON.stringify(result));
  assert.match(result.stdout, /"event":"heartbeat"/);
  assert.equal((await f.readState()).lastReportStatus, "success");
  assert.equal(await fs.readFile(path.join(f.directory, "worker-runs.txt"), "utf8"), "run\n");
});

test("cooldown preserves fresh-heartbeat, explicit-force and expired-interval retries", async (t) => {
  for (const trigger of ["heartbeat", "force", "elapsed"]) await t.test(trigger, async (childTest) => {
    const f = await fixture(childTest);
    assert.equal((await f.run()).code, 0);
    const noop = await f.run();
    assert.equal(noop.code, 0, JSON.stringify(noop));
    assert.match(noop.stdout, /cooldown-noop/);
    assert.equal(await fs.readFile(path.join(f.directory, "worker-runs.txt"), "utf8"), "run\n");
    if (trigger === "heartbeat") f.setGeneration(2);
    if (trigger === "elapsed") {
      const state = await f.readState();
      state.lastAttemptAt = state.lastRescueAt = new Date(Date.now() - 60000).toISOString();
      await fs.writeFile(path.join(f.directory, "agent-state.json"), JSON.stringify(state));
    }
    const retried = await f.run(trigger === "force" ? { CHATGPT_FORCE_RESCUE: "1" } : {});
    assert.equal(retried.code, 0, JSON.stringify(retried));
    assert.equal(await fs.readFile(path.join(f.directory, "worker-runs.txt"), "utf8"), "run\nrun\n");
    assert.equal((await f.readState()).lastAttemptStatus, "completed");
  });
});
