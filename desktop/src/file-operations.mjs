import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const locks=new Map();
export function serialFile(p,task) {
  const key=process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
  const next=(locks.get(key)||Promise.resolve()).catch(()=>{}).then(task);
  locks.set(key,next);
  void next.finally(()=>{if(locks.get(key)===next)locks.delete(key);}).catch(()=>{});
  return next;
}
export const sha256=data=>crypto.createHash('sha256').update(data).digest('hex');
export async function atomicWrite(p,data,{expectedSha256,mode}={}) {
  return serialFile(p,async()=>{
    let previous=null; try{previous=await fs.readFile(p);}catch(e){if(e.code!=='ENOENT')throw e;}
    if(expectedSha256!==undefined && expectedSha256!==(previous===null?null:sha256(previous))) throw new Error('File changed since it was opened. Reload before saving; the existing file was not modified.');
    const bytes=Buffer.isBuffer(data)?data:Buffer.from(data,'utf8');
    await fs.mkdir(path.dirname(p),{recursive:true});
    const tmp=path.join(path.dirname(p),`.${path.basename(p)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
    let handle;
    try {
      const st=await fs.stat(p).catch(()=>null);
      handle=await fs.open(tmp,'wx',mode??st?.mode??0o600);
      await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
      // Never unlink the destination first. A failed replace preserves the old file.
      await fs.rename(tmp,p);
      return {path:p,bytes:bytes.length,sha256:sha256(bytes)};
    }finally{await handle?.close().catch(()=>{});await fs.unlink(tmp).catch(()=>{});}
  });
}
export async function safeMove(source,destination,overwrite=false) {
  const a=process.platform==='win32'?source.toLowerCase():source;
  const b=process.platform==='win32'?destination.toLowerCase():destination;
  if(a===b){await fs.stat(source);return {source,destination,unchanged:true};}
  const relative=path.relative(source,destination);
  if(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && (await fs.stat(source)).isDirectory()) throw new Error('Cannot move a directory into itself.');
  return serialFile(destination,async()=>{
    const sourceStat=await fs.stat(source);
    const destinationStat=await fs.stat(destination).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
    if(destinationStat && sourceStat.dev===destinationStat.dev && sourceStat.ino===destinationStat.ino) return {source,destination,unchanged:true};
    if(destinationStat&&!overwrite)throw new Error('Destination exists');
    await fs.mkdir(path.dirname(destination),{recursive:true});
    const backup=destinationStat?`${destination}.commander-backup-${crypto.randomBytes(6).toString('hex')}`:null;
    if(backup)await fs.rename(destination,backup);
    try {
      try{await fs.rename(source,destination);}
      catch(e){
        if(e.code!=='EXDEV')throw e;
        // Stage the complete cross-device copy before removing the source.
        const staging=`${destination}.commander-moving-${crypto.randomBytes(6).toString('hex')}`;
        try{await fs.cp(source,staging,{recursive:true,errorOnExist:true,force:false,verbatimSymlinks:true});await fs.rename(staging,destination);}
        finally{await fs.rm(staging,{recursive:true,force:true}).catch(()=>{});}
        try{await fs.rm(source,{recursive:true});}catch(e){return {source,destination,copied:true,sourceRetained:true,backup,warning:String(e.message)};}
      }
    }catch(error){if(backup)await fs.rename(backup,destination);throw error;}
    // Keep overwritten data recoverable; report its exact backup path.
    return {source,destination,...(backup?{backup}: {})};
  });
}
