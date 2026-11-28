#!/usr/bin/env node
import { createBrowserBridge } from '../src/browser-bridge.mjs';
const bridge = await createBrowserBridge();
await bridge.start();
console.log(`[Constellation Commander] Normal-chat bridge ready at http://${bridge.host}:${bridge.port}`);
console.log('[Constellation Commander] Waiting for browser companion.');
const stop = async () => { await bridge.stop(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
