#!/usr/bin/env node
import { createCommanderServer } from '../src/server.mjs';
const app=await createCommanderServer();
const address=await app.listen();
const host=typeof address==='string'?address:address.address;
const port=typeof address==='string'?'':address.port;
console.log(`Constellation Commander ${app.config.deviceName} online`);
console.log(`Local MCP: http://${host}:${port}${app.mcpPath}`);
console.log(`Health:    http://${host}:${port}${app.healthPath}`);
console.log('Quota:     none enforced by Constellation Commander');
console.log(`Allowed:   ${app.config.allowedRoots.join(', ')}`);
process.on('SIGINT',async()=>{await app.close();process.exit(0);});
process.on('SIGTERM',async()=>{await app.close();process.exit(0);});
