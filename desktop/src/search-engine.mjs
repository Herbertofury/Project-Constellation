import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {StringDecoder} from 'node:string_decoder';
import path from 'node:path';
import crypto from 'node:crypto';
import {IndexedJsonl} from './indexed-jsonl.mjs';
import {assertAllowedPath} from './policy.mjs';
import {atomicWrite} from './file-operations.mjs';
const now=()=>new Date().toISOString();
export class SearchEngine {
  constructor(state,config){this.state=state;this.config=config;this.dir=null;this.loading=null;}
  async load(){if(this.loading)return this.loading;this.loading=(async()=>{this.dir=path.join(this.state.baseDir,'searches');await fs.mkdir(this.dir,{recursive:true});for(const file of await fs.readdir(this.dir)){
    if(!/^search_[a-f0-9]+\.json$/.test(file))continue;
    try{const j=JSON.parse(await fs.readFile(path.join(this.dir,file),'utf8'));if(file!==j.id+'.json')continue;
      j.resultsPath=path.join(this.dir,j.id+'.jsonl');j.store=await new IndexedJsonl(j.resultsPath).reopen();j.count=j.store.count;
      if(['running','cancelling'].includes(j.status))j.status='interrupted';this.state.searches.set(j.id,j);
    }catch(e){this.state.searchLoadError=String(e.message);}
  }})();return this.loading;}
  async save(j){const {store,promise,...data}=j;await atomicWrite(path.join(this.dir,j.id+'.json'),JSON.stringify(data));}
  async start(args){await this.load();if(args.regex)new RegExp(args.query,args.case_sensitive?'':'i');const root=assertAllowedPath(args.path,this.config);
    const id='search_'+crypto.randomBytes(16).toString('hex'),resultsPath=path.join(this.dir,id+'.jsonl');const store=await new IndexedJsonl(resultsPath).create();
    const j={id,root,query:args.query,mode:args.mode||'both',regex:!!args.regex,caseSensitive:!!args.case_sensitive,resultsPath,store,status:'running',count:0,scanned:0,skippedBinary:0,ignored:0,errors:[],startedAt:now(),cancelled:false};
    await this.save(j);this.state.searches.set(id,j);j.promise=this.run(j).catch(async e=>{j.status='error';j.error=String(e.message);try{await this.save(j);}catch{};});return {search_id:id,status:j.status,root};
  }
  async run(j){
    const ignore=new Set(this.config.searchIgnore||[]),regex=j.regex?new RegExp(j.query,j.caseSensitive?'':'i'):null;
    const needle=j.caseSensitive?j.query:j.query.toLowerCase();const match=text=>regex?regex.test(text):(j.caseSensitive?text:text.toLowerCase()).includes(needle);
    let rows=[];
    const flush=async()=>{if(!rows.length)return;await j.store.append(rows);rows=[];j.count=j.store.count;await this.save(j);};
    const walk=async dir=>{
      if(j.cancelled)return;let entries;
      try{assertAllowedPath(dir,this.config);entries=await fs.readdir(dir,{withFileTypes:true});}catch(e){j.errors.push({path:dir,error:String(e.message)});return;}
      entries.sort((a,b)=>a.name.localeCompare(b.name));
      for(const e of entries){
        if(j.cancelled)break;if(ignore.has(e.name)){j.ignored++;continue;}const p=path.join(dir,e.name);
        if(e.isDirectory()){await walk(p);continue;}if(!e.isFile())continue;
        j.scanned++;try{
          assertAllowedPath(p,this.config);let matched=j.mode!=='content'&&match(e.name),excerpt='';
          if(!matched&&j.mode!=='name'){
            // Literal matching streams every byte and preserves cross-chunk matches.
            // General JS regex needs the whole string for full multiline semantics.
            const decoder=new StringDecoder('utf8');let text='',carry='',found=false,binary=false;
            for await(const chunk of createReadStream(p)){
              if(j.cancelled)break;if(chunk.includes(0)){binary=true;break;}
              const part=decoder.write(chunk);
              if(regex){text+=part;continue;}
              const combined=carry+part;
              if(!found&&match(combined)){found=true;const at=(j.caseSensitive?combined:combined.toLowerCase()).indexOf(needle);excerpt=combined.slice(Math.max(0,at-120),at+Math.max(240,needle.length)).replace(/\s+/g,' ');}
              carry=needle.length>1?combined.slice(-(needle.length-1)):'';
            }
            const last=decoder.end();if(regex){text+=last;found=match(text);if(found){const m=regex.exec(text);excerpt=text.slice(Math.max(0,m.index-120),m.index+240).replace(/\s+/g,' ');}}
            else if(!found&&match(carry+last))found=true;
            if(binary){j.skippedBinary++;matched=false;}else matched=found;
          }
          if(matched&&!j.cancelled)rows.push({path:p,excerpt});if(rows.length>=32)await flush();
        }catch(e){j.errors.push({path:p,error:String(e.message)});}
      }
    };
    await walk(j.root);await flush();j.status=j.cancelled?'cancelled':j.errors.length?'partial':'complete';j.finishedAt=now();await this.save(j);
  }
  async get(id){await this.load();const j=this.state.searches.get(id);if(!j)throw new Error('Unknown search_id');assertAllowedPath(j.root,this.config);return j;}
  async page(args){const j=await this.get(args.search_id);const data=await j.store.page(args.offset||0,args.limit||100);return {search_id:j.id,status:j.status,offset:Math.max(0,Math.floor(args.offset||0)),...data,scanned:j.scanned,skipped_binary:j.skippedBinary,ignored:j.ignored,errors:j.errors,error:j.error||null};}
  async list(){await this.load();return [...this.state.searches.values()].filter(j=>{try{assertAllowedPath(j.root,this.config);return true;}catch{return false;}}).map(j=>({id:j.id,root:j.root,query:j.query,status:j.status,count:j.store.count,scanned:j.scanned,startedAt:j.startedAt,finishedAt:j.finishedAt||null}));}
  async stop(id){const j=await this.get(id);if(j.status==='running'){j.cancelled=true;j.status='cancelling';await this.save(j);}return {search_id:id,status:j.status};}
}
