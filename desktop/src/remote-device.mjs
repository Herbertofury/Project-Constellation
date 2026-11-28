import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { loadConfig, saveConfig, APP_NAME, VERSION } from './config.mjs';
import { createRuntimeState } from './state.mjs';
import { createToolHandler } from './tools.mjs';

const execFileAsync = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function normalizeRelayUrl(value) {
  if (!value) return null;
  const u = new URL(value);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Relay URL must use http or https.');
  if(u.username||u.password||u.search||u.hash)throw new Error('Relay URL must not include credentials, a query or a fragment.');
  if(u.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(u.hostname))throw new Error('Remote relays must use HTTPS.');
  return u.toString().replace(/\/+$/, '');
}

async function openBrowser(url) {
  if (process.env.CONSTELLATION_NO_BROWSER === '1') return;
  if (process.platform === 'win32') {
    await execFileAsync('cmd.exe', ['/d', '/s', '/c', 'start', '', url]);
    return;
  }
  if (process.platform === 'darwin') {
    await execFileAsync('open', [url]);
    return;
  }
  await execFileAsync('xdg-open', [url]);
}

async function fetchJson(url, options = {}, expected = [200]) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!expected.includes(response.status)) {
    const error = new Error(data.message || data.error_description || data.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function parseArgs(argv) {
  const out = { relay: null, resetPairing: false, once: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--relay') out.relay = argv[++i];
    else if (arg.startsWith('--relay=')) out.relay = arg.slice('--relay='.length);
    else if (arg === '--reset-pairing') out.resetPairing = true;
    else if (arg === '--once') out.once = true;
  }
  return out;
}

export async function createRemoteDeviceAgent(options = {}) {
  const loaded = options.runtime || await loadConfig();
  const { config, configPath, dir } = loaded;
  const args = options.args || parseArgs(process.argv.slice(2));
  const relayUrl = normalizeRelayUrl(options.relayUrl || args.relay || process.env.CONSTELLATION_RELAY_URL || config.remoteRelayUrl);
  if (!relayUrl) throw new Error('Relay URL is required. Use --relay https://your-relay.example.com or set CONSTELLATION_RELAY_URL.');

  if (args.resetPairing || options.resetPairing || (config.remoteRelayUrl && config.remoteRelayUrl !== relayUrl)) {
    delete config.remoteDeviceId;
    delete config.remoteDeviceToken;
  }
  config.remoteRelayUrl = relayUrl;
  await (options.persistRemote?.(config) || saveConfig(configPath, config));

  const runtimeState = options.runtime?.state || createRuntimeState(dir);
  const controller=new AbortController();
  const send=(url,init={},expected)=>fetchJson(url,{...init,signal:controller.signal},expected);
  const status=(phase,detail={})=>options.onState?.({phase,...detail});
  const completedJobs=new Map();
  let stopped = false;
  const handler = options.callTool || createToolHandler({
    config,
    configPath,
    state: runtimeState,
    onShutdown: () => { stopped = true; }
  });

  const identity = () => ({
    device_name: config.deviceName,
    platform: process.platform,
    arch: process.arch,
    version: VERSION
  });

  async function pair() {
    console.log(`[${APP_NAME}] Starting secure pairing with ${relayUrl}`);
    const started = await send(`${relayUrl}/device/pair/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(identity())
    });
    console.log(`[${APP_NAME}] Pairing code: ${started.user_code}`);
    console.log(`[${APP_NAME}] Approve this computer: ${started.verification_uri_complete || started.verification_uri}`);
    const approval=started.verification_uri_complete||started.verification_uri;
    if(new URL(approval).origin!==new URL(relayUrl).origin)throw new Error('Pairing approval URL must belong to the relay.');
    status('pairing',{code:started.user_code,approvalUrl:approval});
    try { await (options.openVerification || openBrowser)(approval); }
    catch (error) { console.warn(`[${APP_NAME}] Could not open browser automatically: ${error.message}`); }

    const deadline = Date.now() + Number(started.expires_in || 900) * 1000;
    const interval = Math.max(1, Number(started.interval || 2)) * 1000;
    while (Date.now() < deadline && !stopped) {
      await sleep(interval);
      try {
        const token = await send(`${relayUrl}/device/pair/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ device_code: started.device_code })
        });
        config.remoteDeviceId = token.device_id;
        config.remoteDeviceToken = token.device_token;
        config.remotePairedAt = new Date().toISOString();
        await (options.persistRemote?.(config) || saveConfig(configPath, config));
        console.log(`[${APP_NAME}] Paired as ${config.remoteDeviceId}`);
        return;
      } catch (error) {
        if (error.status === 428 && error.data?.error === 'authorization_pending') continue;
        if (error.data?.error === 'expired_token') break;
        throw error;
      }
    }
    throw new Error('Pairing expired before approval.');
  }

  async function ensurePaired() {
    if (!config.remoteDeviceId || !config.remoteDeviceToken) await pair();
  }

  async function postResult(job, ok, result, error) {
    await send(`${relayUrl}/device/result`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.remoteDeviceToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ job_id: job.id, ok, result, error })
    });
  }

  async function pollOnce() {
    const data = await send(`${relayUrl}/device/poll`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.remoteDeviceToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(identity())
    }, [200, 409]);
    if (data.error === 'superseded_poll') return false;
    if(stopped)return false;
    const job = data.job;
    if (!job) return false;
    const key=String(job.id),signature=JSON.stringify([job.tool,job.args||{}]);
    let cached=completedJobs.get(key);
    if(cached&&cached.signature!==signature){
      await postResult(job,false,null,'Remote job ID reused with different arguments.');
      return true;
    }
    if(!cached){
      const result=Promise.resolve().then(()=>{
        if(stopped)throw new Error('Remote device is disconnected.');
        if(job.tool==='set_config_value'||job.tool==='shutdown')throw new Error('Change computer permissions in Commander, not through remote chat.');
        return handler(job.tool,job.args||{},{owner:`remote:${relayUrl}`,canContinue:()=>{if(stopped)throw new Error('Remote connection stopped');}});
      }).then(result=>({ok:true,result,error:null}),error=>({ok:false,result:null,error:String(error.message||error)}));
      cached={signature,result};completedJobs.set(key,cached);
    }
    const outcome=await cached.result;
    // Delivery failure is not an execution failure. A repeated job delivers its
    // saved outcome, without running the action again or changing success to failure.
    await postResult(job,outcome.ok,outcome.result,outcome.error);
    return true;
  }

  async function run() {
    status('connecting');
    await ensurePaired();
    if(stopped)return;
    status('connected',{deviceId:config.remoteDeviceId});
    console.log(`[${APP_NAME}] Connected device agent -> ${relayUrl}`);
    console.log(`[${APP_NAME}] Device: ${config.deviceName} (${config.remoteDeviceId})`);
    console.log(`[${APP_NAME}] Plugin-side quota: none`);
    let failures = 0;
    do {
      try {
        await pollOnce();
        failures = 0;
        if (args.once || options.once) break;
      } catch (error) {
        if(stopped)break;
        status('error',{error:String(error.message)});
        if (error.status === 401) {
          console.warn(`[${APP_NAME}] Device authorization expired; pairing again.`);
          delete config.remoteDeviceId;
          delete config.remoteDeviceToken;
          await (options.persistRemote?.(config) || saveConfig(configPath, config));
          await ensurePaired();
          failures = 0;
          continue;
        }
        failures += 1;
        const delay = Math.min(30_000, 500 * 2 ** Math.min(failures, 6));
        console.warn(`[${APP_NAME}] Relay connection error: ${error.message}; retrying in ${delay} ms`);
        await sleep(delay);
      }
    } while (!stopped);
  }

  return {
    config,
    configPath,
    relayUrl,
    get stopped() { return stopped; },
    stop() { stopped = true; controller.abort(); status('disconnected'); },
    pair,
    ensurePaired,
    pollOnce,
    run
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const agent = await createRemoteDeviceAgent();
  const stop = () => agent.stop();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  await agent.run();
}
