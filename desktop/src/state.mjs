import path from 'node:path';
import fsp from 'node:fs/promises';
import { atomicWrite } from './file-operations.mjs';

export function createRuntimeState(baseDir) {
  return {baseDir,processes:new Map(),searches:new Map(),shutdownRequested:false,callsPath:path.join(baseDir,'tool-calls.jsonl'),statsPath:path.join(baseDir,'stats.json'),recordQueue:Promise.resolve()};
}
export function recordCall(state,entry) {
  state.recordQueue=(state.recordQueue||Promise.resolve()).catch(()=>{}).then(async()=>{
    await fsp.mkdir(state.baseDir,{recursive:true});
    await fsp.appendFile(state.callsPath,JSON.stringify({ts:new Date().toISOString(),...entry})+'\n');
    let stats={totalCalls:0,byTool:{},errors:0};
    try{stats=JSON.parse(await fsp.readFile(state.statsPath,'utf8'));}catch{}
    stats.totalCalls=(stats.totalCalls||0)+1;stats.byTool||={};stats.byTool[entry.tool]=(stats.byTool[entry.tool]||0)+1;
    if(!entry.ok)stats.errors=(stats.errors||0)+1;
    await atomicWrite(state.statsPath,JSON.stringify(stats,null,2));
  });
  return state.recordQueue.catch(error=>{state.auditError=String(error?.message||error);});
}
