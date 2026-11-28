import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {performance} from 'node:perf_hooks';import {IndexedJsonl,tailJsonl} from '../src/indexed-jsonl.mjs';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cc-pagination-bench-'));
const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
async function measure(f){const times=[];for(let i=0;i<9;i++){const start=performance.now();await f();times.push(performance.now()-start);}return median(times);}
const report={node:process.version,platform:process.platform,fixture:'identical UTF-8 results; warm filesystem cache; median of 9; local pagination algorithm, not online ChatGPT throughput',pagination:[]};
for(const count of [1000,10000,100000]){
 const store=await new IndexedJsonl(path.join(dir,`${count}.jsonl`)).create();const rows=Array.from({length:count},(_,i)=>({path:`C:/Workspace/project/module-${i}/source-file.ts`,excerpt:`line ${i}: match here `+'unchanged content '.repeat(5)}));
 const start=performance.now();await store.append(rows);const setup=performance.now()-start,offset=Math.floor(count*.9),limit=100;
 const old=async()=>{const txt=await fs.readFile(store.file,'utf8');return (txt.trim()?txt.trim().split('\n').map(x=>JSON.parse(x)):[]).slice(offset,offset+limit);};
 const fast=async()=>await store.page(offset,limit);assert.deepEqual((await fast()).results,await old());
 const oldMs=await measure(old),newMs=await measure(fast);report.pagination.push({rows:count,returned:limit,old_median_ms:oldMs,new_median_ms:newMs,speedup:oldMs/newMs,old_bytes_read:(await fs.stat(store.file)).size,new_bytes_read:(await fast()).bytes_read,index_bytes:count*8,index_and_data_creation_ms:setup,identical_results:true});
}
const log=path.join(dir,'100000.jsonl');
const oldTail=async()=>{const text=await fs.readFile(log,'utf8');return text.trim().split(/\r?\n/).slice(-30).map(x=>JSON.parse(x));};
assert.deepEqual(await oldTail(),await tailJsonl(log,30));const oldMs=await measure(oldTail),newMs=await measure(()=>tailJsonl(log,30));report.activity_tail={rows:100000,returned:30,old_median_ms:oldMs,new_median_ms:newMs,speedup:oldMs/newMs,identical_results:true};
console.log(JSON.stringify(report,null,2));await fs.rm(dir,{recursive:true,force:true});
