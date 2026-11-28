import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';

export const APP_NAME = 'Project Constellation';
export const VERSION = '0.25.0';

export function stateDir() {
  return process.env.CONSTELLATION_COMMANDER_HOME || path.join(os.homedir(), '.constellation-commander');
}

function randomSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function parseRoots(value) {
  if (!value) return null;
  if (value.trim() === '*') return ['*'];
  return value.split(path.delimiter).map(v => v.trim()).filter(Boolean);
}

export async function loadConfig() {
  const dir = stateDir();
  await fsp.mkdir(dir, { recursive: true });
  await fsp.mkdir(path.join(dir, 'processes'), { recursive: true });
  await fsp.mkdir(path.join(dir, 'searches'), { recursive: true });
  const configPath = path.join(dir, 'config.json');
  let persisted = {};
  let configCorruption = null;
  try {
    persisted = JSON.parse((await fsp.readFile(configPath, 'utf8')).replace(/^\uFEFF/, ''));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const badPath = `${configPath}.bad.${stamp}`;
      try { await fsp.rename(configPath, badPath); } catch {}
      configCorruption = { message: String(error?.message || error), quarantinedPath: badPath };
    }
  }

  const envRoots = parseRoots(process.env.CONSTELLATION_ALLOWED_ROOTS);
  const fullAccess = process.env.CONSTELLATION_FULL_ACCESS === '1';
  const defaults = {
    host: '127.0.0.1',
    port: 8765,
    endpointToken: randomSecret(24),
    bearerToken: randomSecret(32),
    deviceName: os.hostname(),
    allowedRoots: fullAccess ? ['*'] : [os.homedir()],
    blockedCommands: [],
    enableShell: true,
    enableGuiAutomation: true,
    localToolMode: 'auto',
    emergencyLock: false,
    telemetryEnabled: false,
    defaultShell: process.platform === 'win32' ? 'powershell' : 'bash',
    searchIgnore: ['.git', 'node_modules', '.cache', '$RECYCLE.BIN', 'System Volume Information'],
    browserBridgeEnabled: false,
    browserBridgeHost: '127.0.0.1',
    browserBridgePort: 47721,
    remoteRelayUrl: '',
    remotePluginEnabled: false,
    autoUpdateCheck: true,
    updateChannel: 'stable'
  };
  const config = { ...defaults, ...persisted };
  if (envRoots) config.allowedRoots = envRoots;
  if (process.env.CONSTELLATION_HOST) config.host = process.env.CONSTELLATION_HOST;
  if (process.env.CONSTELLATION_PORT) config.port = Number(process.env.CONSTELLATION_PORT);
  if (process.env.CONSTELLATION_ENDPOINT_TOKEN) config.endpointToken = process.env.CONSTELLATION_ENDPOINT_TOKEN;
  if (process.env.CONSTELLATION_BEARER_TOKEN) config.bearerToken = process.env.CONSTELLATION_BEARER_TOKEN;
  if (process.env.CONSTELLATION_BRIDGE_PORT) config.browserBridgePort = Number(process.env.CONSTELLATION_BRIDGE_PORT);

  if (!fs.existsSync(configPath) || configCorruption) {
    await saveConfig(configPath, config);
  }
  return { config, configPath, dir, configCorruption };
}

export async function saveConfig(configPath, config) {
  await fsp.mkdir(path.dirname(configPath), { recursive: true });
  const tempPath = `${configPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(tempPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  await fsp.rename(tempPath, configPath);
}
