#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getComputerLinkStatus, getComputerLinkMcpStatus, resolveComputerLinkBinary } from '../../desktop/src/computer-link.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [command = 'status', ...args] = process.argv.slice(2);
const usage = `Project Constellation Computer Tools
  status                              Report installed capabilities (no grants)
  mcp-status                          Exercise native status-only MCP once
  owner                               Open native Windows Computer Tools
  mcp                                 Run status-only native stdio MCP
  mcp --snapshot PIPE OWNER_PID       Run one locally owner-approved snapshot MCP session
  workspace --new ABSOLUTE_NEW_DIR    Run isolated new-workspace stdio tools
  focus                               Run interactive local window selector
  client OWNER_PID PIPE status|read   Invoke the separately approved local client
  worker [--program ...] -- [args]    Run trusted program in a native owned Job
  diagnostics [--workspace FOLDER]    Run preserved Python diagnostics JSON-lines
Local-only commands do not enroll a provider, register a remote listener, or preapprove native permission prompts.`;

async function execute(file, values, cwd = path.dirname(file)) {
  const child = spawn(file, values, { cwd, shell: false, stdio: 'inherit', windowsHide: false });
  const stop = () => child.kill();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve(code ?? (signal ? 130 : 1))); });
    process.exitCode = result;
  } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}

async function native(id, values) {
  if (id !== 'mcp' && process.platform !== 'win32') throw new Error('This native capability requires Windows; no host shell fallback.');
  const file = await resolveComputerLinkBinary(id);
  if (!file) throw new Error('Native binary is missing. Run Constellation Setup or tools/computer-link/build.mjs.');
  await execute(file, values);
}

try {
  switch (command) {
    case 'status':
      if (args.length) throw new Error(usage);
      console.log(JSON.stringify(await getComputerLinkStatus(), null, 2)); break;
    case 'mcp-status': {
      if (args.length) throw new Error(usage);
      const result = await getComputerLinkMcpStatus(); console.log(JSON.stringify(result, null, 2)); if (!result.verified) process.exitCode = 1; break;
    }
    case 'owner': case 'focus':
      if (args.length) throw new Error(usage);
      await native(command, []); break;
    case 'mcp':
      if (!args.length) await native('mcp', ['--status-only']);
      else if (args.length === 3 && args[0] === '--snapshot' && /^[1-9][0-9]*$/.test(args[2])) {
        if (process.platform !== 'win32') throw new Error('Snapshot pairing requires Windows and native owner approval');
        await native('mcp', ['--owner-approved-snapshot', args[1], args[2]]);
      } else throw new Error(usage);
      break;
    case 'workspace':
      if (args.length !== 2 || args[0] !== '--new' || !path.isAbsolute(args[1])) throw new Error(usage);
      await native('workspace', ['--consent-new-workspace', args[1]]); break;
    case 'client':
      if (args.length !== 3 || !/^[1-9][0-9]*$/.test(args[0]) || !['status', 'read'].includes(args[2])) throw new Error(usage);
      await native('client', args); break;
    case 'worker': await native('worker', args); break;
    case 'diagnostics':
      if (args.length && (args.length !== 2 || args[0] !== '--workspace' || !path.isAbsolute(args[1]))) throw new Error(usage);
      await execute(process.platform === 'win32' ? 'python' : 'python3', ['-m', 'computer_link', ...args], path.join(root, 'computer-link')); break;
    case 'help': case '--help': console.log(usage); break;
    default: throw new Error(usage);
  }
} catch (error) { console.error(error.message); process.exitCode = 2; }
