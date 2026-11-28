#!/usr/bin/env node
import { createRelayServer } from '../relay/relay-server.mjs';
import { VERSION } from '../src/config.mjs';
const relay = await createRelayServer();
const address = await relay.listen();
const actualPort = typeof address === 'object' && address ? address.port : relay.port;
console.log(`Constellation Commander Relay ${VERSION}`);
console.log(`Listening: ${relay.publicBaseUrl} (local port ${actualPort})`);
console.log(`MCP: ${relay.publicBaseUrl}/mcp`);
console.log('Quota: none enforced by Constellation Commander');
const stop = async () => { await relay.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
