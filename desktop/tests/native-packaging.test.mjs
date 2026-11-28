import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {verifyNativePayload}=require('../scripts/verify-native-resources.cjs');
const config=require('../package.json');
const names=['computer-link-owner-proof.exe','local-client.exe','local-window-focus.exe','computer-link-mcp-session.exe','computer-link-workspace-candidate.exe','owned-worker.exe'];

async function fixture(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'constellation-package-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const binaries=[];for(const name of names){const bytes=Buffer.from('MZ packaging fixture '+name);await fs.writeFile(path.join(dir,name),bytes);binaries.push({name,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}
  const manifest={schema:1,product:'project-constellation',version:config.version,target:'x86_64-pc-windows-msvc',binaries};
  await fs.writeFile(path.join(dir,'BUILD-MANIFEST.json'),JSON.stringify(manifest));await fs.writeFile(path.join(dir,'THIRD_PARTY_NOTICES.md'),'fixture notices');await fs.writeFile(path.join(dir,'DEPENDENCY-LICENSES.json'),'{}');await fs.mkdir(path.join(dir,'licenses'));
  return{dir,manifest};
}

test('Windows package maps all native resources outside ASAR and checks final copy',()=>{
  assert.deepEqual(config.build.win.extraResources,[{from:'../build/computer-link/windows-x64',to:'computer-link',filter:['**/*']}]);
  assert.equal(config.build.beforePack,'./scripts/verify-native-resources.cjs');assert.equal(config.build.afterPack,'./scripts/verify-packaged-native.cjs');
});
test('native packaging verifies exact executable identities and version',async t=>{
  const {dir}=await fixture(t);assert.equal((await verifyNativePayload(dir,config.version)).binaries,6);
  await assert.rejects(verifyNativePayload(dir,'0.0.0'),/does not match/);
  await fs.appendFile(path.join(dir,names[0]),'changed');await assert.rejects(verifyNativePayload(dir,config.version),/mismatch/);
});
test('missing native components fail packaging instead of shipping unavailable controls',async t=>{
  const {dir}=await fixture(t);await fs.rm(path.join(dir,names[2]));await assert.rejects(verifyNativePayload(dir,config.version));
});
