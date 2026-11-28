// Append-only JSONL with an 8-byte row-offset sidecar. Pagination does not
// reread/parse preceding rows. A row is visible only after both writes finish.
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
export class IndexedJsonl {
  constructor(file){this.file=file;this.index=file+'.idx';this.count=0;this.bytes=0;this.queue=Promise.resolve();}
  async create(){await fs.writeFile(this.file,'',{mode:0o600});await fs.writeFile(this.index,'',{mode:0o600});return this;}
  async reopen(){
    const [data,index]=await Promise.all([fs.stat(this.file),fs.stat(this.index)]);
    this.count=Math.floor(index.size/8);this.bytes=0;
    if(this.count){
      const idx=await fs.open(this.index,'r'),f=await fs.open(this.file,'r');
      try{const offset=Buffer.alloc(8);await idx.read(offset,0,8,(this.count-1)*8);let pos=Number(offset.readBigUInt64LE()),found=false;
        while(pos<data.size){const buf=Buffer.alloc(Math.min(16384,data.size-pos)),{bytesRead}=await f.read(buf,0,buf.length,pos);if(!bytesRead)break;const newline=buf.subarray(0,bytesRead).indexOf(10);if(newline>=0){this.bytes=pos+newline+1;found=true;break;}pos+=bytesRead;}
        if(!found)throw new Error('Last indexed search record is incomplete');
      }finally{await idx.close();await f.close();}
    }
    // Drop only uncommitted append tails in these private result/index files.
    if(index.size!==this.count*8)await fs.truncate(this.index,this.count*8);
    if(data.size!==this.bytes)await fs.truncate(this.file,this.bytes);
    return this;
  }
  append(rows){
    if(!rows.length)return this.queue;
    const text=rows.map(r=>JSON.stringify(r)+'\n');
    this.queue=this.queue.then(async()=>{
      const offsets=Buffer.alloc(8*text.length);let cursor=this.bytes;
      text.forEach((s,i)=>{offsets.writeBigUInt64LE(BigInt(cursor),i*8);cursor+=Buffer.byteLength(s);});
      await fs.appendFile(this.file,text.join(''));await fs.appendFile(this.index,offsets);
      this.bytes=cursor;this.count+=text.length;
    });return this.queue;
  }
  async page(offset=0,limit=100){
    await this.queue;const count=this.count,totalBytes=this.bytes;
    offset=Math.min(count,Math.max(0,Math.floor(offset)));limit=Math.max(1,Math.floor(limit));
    const end=Math.min(count,offset+limit);if(offset===end)return {results:[],next_offset:end,count,bytes_read:0};
    const index=await fs.open(this.index,'r'),data=await fs.open(this.file,'r');
    try{
      const first=Buffer.alloc(8),last=Buffer.alloc(8);await index.read(first,0,8,offset*8);
      let stop=totalBytes;if(end<count){await index.read(last,0,8,end*8);stop=Number(last.readBigUInt64LE());}
      const begin=Number(first.readBigUInt64LE()),buffer=Buffer.alloc(stop-begin);let read=0;
      while(read<buffer.length){const r=await data.read(buffer,read,buffer.length-read,begin+read);if(!r.bytesRead)throw new Error('Search results truncated');read+=r.bytesRead;}
      return {results:buffer.toString('utf8').trimEnd().split('\n').map(x=>JSON.parse(x)),next_offset:end,count,bytes_read:buffer.length+8+(end<count?8:0)};
    }finally{await index.close();await data.close();}
  }
}
// Bounded backwards reads; no truncation of records or fixed maximum log size.
export async function tailJsonl(file,limit=30){
  limit=Math.max(1,Math.floor(limit));let handle;
  try{handle=await fs.open(file,'r');}catch(e){if(e.code==='ENOENT')return [];throw e;}
  try{
    const size=(await handle.stat()).size;let pos=size,buf=Buffer.alloc(0),lines=0;
    while(pos>0&&lines<=limit){const n=Math.min(16384,pos),part=Buffer.alloc(n);pos-=n;await handle.read(part,0,n,pos);buf=Buffer.concat([part,buf]);lines+=part.reduce((n,v)=>n+(v===10),0);}
    const rows=buf.toString('utf8').split('\n');if(pos>0)rows.shift();if(buf.length&&buf[buf.length-1]!==10)rows.pop();
    return rows.filter(s=>s.trim()).slice(-limit).map(s=>JSON.parse(s));
  }finally{await handle.close();}
}
export async function buildIndex(file){
  const store=new IndexedJsonl(file);const offsets=[];let bytes=0;
  const input=createReadStream(file);const lines=createInterface({input,crlfDelay:Infinity});
  for await(const line of lines){JSON.parse(line);offsets.push(bytes);bytes+=Buffer.byteLength(line)+1;}
  const index=Buffer.alloc(offsets.length*8);offsets.forEach((v,i)=>index.writeBigUInt64LE(BigInt(v),i*8));
  await fs.writeFile(store.index,index,{mode:0o600});store.count=offsets.length;store.bytes=bytes;return store;
}
