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
let stopping;
function stop(){
  if(stopping)return;
  stopping=app.close().then(()=>process.exit(0)).catch(error=>{
    // Keep the runtime alive for a retry instead of abandoning an unconfirmed
    // owned child. A second stop signal retries the same owned handles.
    console.error(`Project Constellation shutdown failed: ${error.message}`);
    stopping=null;
  });
}
process.on('SIGINT',stop);
process.on('SIGTERM',stop);
