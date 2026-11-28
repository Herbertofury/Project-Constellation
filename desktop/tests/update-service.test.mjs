import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {createUpdateService,compareVersions,isNewer,parseSha256Sums} from '../src/update-service.mjs';

assert.equal(compareVersions('0.20.0','0.19.1'),1);
assert.equal(compareVersions('0.20.0-alpha.1','0.20.0'),-1);
assert.equal(isNewer('0.19.1','0.20.0'),true);
assert.equal(parseSha256Sums(`${'a'.repeat(64)}  file.zip`).get('file.zip'),'a'.repeat(64));

const root=await fs.mkdtemp(path.join(os.tmpdir(),'pc-update-'));
const payload=Buffer.from('portable-bytes');
const hash=crypto.createHash('sha256').update(payload).digest('hex');
const release={tag_name:'v0.20.0',html_url:'https://github.com/Herbertofury/Project-Constellation/releases/tag/v0.20.0',assets:[
  {name:'Project-Constellation-Desktop-0.20.0-x64.zip',browser_download_url:'https://assets.example/app.zip',size:payload.length},
  {name:'SHA256SUMS-v0.20.0.txt',browser_download_url:'https://assets.example/sums.txt',size:100}
]};
const fetchImpl=async url=>{
  if(String(url).includes('/releases/latest'))return new Response(JSON.stringify(release),{status:200,headers:{'content-type':'application/json'}});
  if(String(url).endsWith('app.zip'))return new Response(payload,{status:200});
  if(String(url).endsWith('sums.txt'))return new Response(`${hash}  Project-Constellation-Desktop-0.20.0-x64.zip\n`,{status:200});
  return new Response('no',{status:404});
};
const service=createUpdateService({currentVersion:'0.19.1',stateDir:root,fetchImpl});
await service.load();
const checked=await service.check(); assert.equal(checked.phase,'available'); assert.equal(checked.availableVersion,'0.20.0');
const staged=await service.stage(); assert.equal(staged.phase,'staged'); assert.equal(staged.staged.sha256,hash);
await fs.rm(root,{recursive:true,force:true});
console.log('update-service.test.mjs: PASS');
