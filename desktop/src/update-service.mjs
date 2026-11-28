import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const UPDATE_SCHEMA = 'project-constellation-update-v1';
export const DEFAULT_REPO = 'Herbertofury/Project-Constellation';

export function parseVersion(input='') {
  const match=String(input).trim().replace(/^v/i,'').match(/^(\d+)\.(\d+)\.(\d+)(?:[-+]([0-9A-Za-z.-]+))?$/);
  return match ? {major:Number(match[1]),minor:Number(match[2]),patch:Number(match[3]),pre:match[4]||''} : null;
}
export function compareVersions(a,b){
  const av=parseVersion(a), bv=parseVersion(b); if(!av||!bv)return 0;
  for(const key of ['major','minor','patch']){if(av[key]!==bv[key])return av[key]>bv[key]?1:-1;}
  if(av.pre===bv.pre)return 0; if(!av.pre)return 1; if(!bv.pre)return -1; return av.pre.localeCompare(bv.pre,undefined,{numeric:true});
}
export function isNewer(current,candidate){return compareVersions(candidate,current)>0;}
export function parseSha256Sums(text=''){
  const out=new Map();
  for(const line of String(text).split(/\r?\n/)){
    const match=line.trim().match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/); if(match)out.set(path.basename(match[2].trim()),match[1].toLowerCase());
  }
  return out;
}
export async function sha256File(file){
  return await new Promise((resolve,reject)=>{const h=crypto.createHash('sha256');const stream=fs.createReadStream(file);stream.on('data',d=>h.update(d));stream.on('end',()=>resolve(h.digest('hex')));stream.on('error',reject);});
}
async function writeJsonAtomic(file,value){await fsp.mkdir(path.dirname(file),{recursive:true});const tmp=`${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;await fsp.writeFile(tmp,JSON.stringify(value,null,2));await fsp.rename(tmp,file);}
async function fetchChecked(fetchImpl,url,options={}){const r=await fetchImpl(url,options);if(!r?.ok)throw new Error(`Update request failed (${r?.status||'network'}): ${url}`);return r;}
function chooseAssets(release={}){
  const assets=Array.isArray(release.assets)?release.assets:[];
  const portable=assets.find(a=>/Project-Constellation-(?:Desktop|Windows-Portable).*x64.*\.zip$/i.test(a.name||''))
    || assets.find(a=>/Project-Constellation.*\.zip$/i.test(a.name||'')&&!/source|extension|migration/i.test(a.name||''));
  const sums=assets.find(a=>/SHA256SUMS/i.test(a.name||''));
  return {portable,sums};
}
export function createUpdateService({currentVersion,stateDir,repo=DEFAULT_REPO,fetchImpl=globalThis.fetch}={}){
  if(!currentVersion||!stateDir)throw new Error('Update service requires currentVersion and stateDir.');
  if(typeof fetchImpl!=='function')throw new Error('Update service requires fetch.');
  const dir=path.join(stateDir,'updates'); const statePath=path.join(dir,'state.json');
  let state={schema:UPDATE_SCHEMA,currentVersion,phase:'idle',checkedAt:0,availableVersion:'',releaseUrl:'',portable:null,error:'',rollbackAvailable:false};
  async function load(){try{state={...state,...JSON.parse(await fsp.readFile(statePath,'utf8'))};}catch{};state.currentVersion=currentVersion;state.rollbackAvailable=await hasRollback();return {...state};}
  async function save(patch={}){state={...state,...patch,currentVersion};state.rollbackAvailable=await hasRollback();await writeJsonAtomic(statePath,state);return {...state};}
  async function hasRollback(){try{const names=await fsp.readdir(dir);return names.some(n=>n.startsWith('backup-'));}catch{return false;}}
  async function check(){
    await fsp.mkdir(dir,{recursive:true}); await save({phase:'checking',error:''});
    try{
      const response=await fetchChecked(fetchImpl,`https://api.github.com/repos/${repo}/releases/latest`,{headers:{accept:'application/vnd.github+json','user-agent':'Project-Constellation-Updater'}});
      const release=await response.json(); const version=String(release?.tag_name||'').replace(/^v/,''); const assets=chooseAssets(release);
      const updateAvailable=Boolean(parseVersion(version)&&isNewer(currentVersion,version));
      return await save({phase:updateAvailable?'available':'current',checkedAt:Date.now(),availableVersion:updateAvailable?version:'',releaseUrl:String(release?.html_url||''),portable:updateAvailable&&assets.portable?{name:assets.portable.name,url:assets.portable.browser_download_url,size:Number(assets.portable.size||0)}:null,sums:updateAvailable&&assets.sums?{name:assets.sums.name,url:assets.sums.browser_download_url,size:Number(assets.sums.size||0)}:null,error:updateAvailable&&!assets.portable?'Release exists but has no portable Windows asset.':''});
    }catch(error){return save({phase:'error',checkedAt:Date.now(),error:String(error?.message||error)});}
  }
  async function stage(){
    if(!state.availableVersion||!state.portable?.url)throw new Error('No portable update is available to stage.');
    if(!state.sums?.url)throw new Error('The release is missing SHA256SUMS; refusing an unverifiable update.');
    await save({phase:'downloading',error:''});
    try{
      const target=path.join(dir,path.basename(state.portable.name)); const sumsPath=path.join(dir,path.basename(state.sums.name));
      const [assetResp,sumsResp]=await Promise.all([fetchChecked(fetchImpl,state.portable.url),fetchChecked(fetchImpl,state.sums.url)]);
      await fsp.writeFile(target,Buffer.from(await assetResp.arrayBuffer())); const sumsText=await sumsResp.text(); await fsp.writeFile(sumsPath,sumsText);
      const expected=parseSha256Sums(sumsText).get(path.basename(target)); if(!expected)throw new Error(`SHA256SUMS does not contain ${path.basename(target)}.`);
      const actual=await sha256File(target); if(actual!==expected)throw new Error(`Update SHA-256 mismatch: expected ${expected}, got ${actual}.`);
      return await save({phase:'staged',staged:{version:state.availableVersion,file:target,sha256:actual,size:(await fsp.stat(target)).size,verifiedAt:Date.now()},error:''});
    }catch(error){await save({phase:'error',error:String(error?.message||error)});throw error;}
  }
  async function markInstalling(){if(!state.staged?.file)throw new Error('No verified staged update.');return save({phase:'installing',installRequestedAt:Date.now()});}
  async function markRollback(){return save({phase:'rollback-requested',rollbackRequestedAt:Date.now()});}
  function snapshot(){return {...state};}
  function paths(){return {dir,statePath};}
  return Object.freeze({load,check,stage,markInstalling,markRollback,snapshot,paths,hasRollback});
}
