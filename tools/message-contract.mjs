import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=process.env.PROJECT_CONSTELLATION_ROOT?path.resolve(process.env.PROJECT_CONSTELLATION_ROOT):path.join(repoRoot,'extension');
const background=fs.readFileSync(path.join(root,'background.js'),'utf8');
const content=fs.readFileSync(path.join(root,'src/content.js'),'utf8');
const surfaces=['home.js','sidepanel.js','popup.js'].map((f)=>fs.readFileSync(path.join(root,f),'utf8')).join('\n');
const types=[...new Set([...surfaces.matchAll(/type\s*:\s*['"](PC_[A-Z0-9_]+)['"]/g)].map((m)=>m[1]))];
const failures=[];
for(const type of types){
  const owned=background.includes(`case '${type}'`)||background.includes(`case \"${type}\"`)||content.includes(`case '${type}'`)||content.includes(`case \"${type}\"`)||content.includes(`type === '${type}'`)||content.includes(`type==='${type}'`);
  if(!owned) failures.push(type);
}
if(failures.length)throw new Error(`Message contract has no backend owner for: ${failures.join(', ')}`);
console.log(`message-contract.mjs: PASS (${types.length} UI message types owned)`);
