import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=process.env.PROJECT_CONSTELLATION_ROOT?path.resolve(process.env.PROJECT_CONSTELLATION_ROOT):path.join(repoRoot,'extension');

function readGraph(entry, seen=new Set()) {
  const file=path.resolve(entry);
  if(seen.has(file) || !fs.existsSync(file)) return '';
  seen.add(file);
  const source=fs.readFileSync(file,'utf8');
  let combined=source;
  const dir=path.dirname(file);
  for(const match of source.matchAll(/import\s+(?:[^'";]+\s+from\s+)?['"](\.\.?\/[^'"]+)['"]/g)) {
    let target=path.resolve(dir,match[1]);
    if(!path.extname(target)) target+='.js';
    if(target.startsWith(root+path.sep) || target===root) combined+='\n'+readGraph(target,seen);
  }
  return combined;
}

const background=readGraph(path.join(root,'background-entry.js'));
const content=readGraph(path.join(root,'src/content.js'));
const surfaces=['home.js','sidepanel.js','popup.js','agent-monitor.js'].map((f)=>fs.readFileSync(path.join(root,f),'utf8')).join('\n');
// Include literal discriminators passed through helpers or conditional routing,
// not only object-literal `type` fields. Shared/local alert settings use both.
const types=[...new Set([...surfaces.matchAll(/['"](PC_[A-Z0-9_]+)['"]/g)].map((m)=>m[1]))];
const failures=[];
for(const type of types){
  const quoted=[`'${type}'`,`"${type}"`];
  const owned=quoted.some((q)=>background.includes(q)||content.includes(q));
  if(!owned) failures.push(type);
}
if(failures.length)throw new Error(`Message contract has no backend owner for: ${failures.join(', ')}`);
console.log(`message-contract.mjs: PASS (${types.length} UI message types owned across service-worker module graph)`);
