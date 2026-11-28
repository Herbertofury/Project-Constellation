// Durable tasks are explicit user/model-authored tool plans, not an autonomous
// permission escalator. Never automatically repeat a started, uncertain step.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {atomicWrite} from './file-operations.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const forbidden=new Set(['run_task','resume_task','cancel_task','set_config_value','shutdown']);
const activeStatus=new Set(['running','waiting']);
const stamp=()=>new Date().toISOString();
function resolveRefs(value,steps){
  if(Array.isArray(value))return value.map(v=>resolveRefs(v,steps));
  if(value&&typeof value==='object'){
    if(Object.keys(value).length===1&&typeof value.$result==='string'){
      const [id,...keys]=value.$result.split('/');const step=steps.find(s=>s.id===id);
      if(!step||step.status!=='completed')throw new Error(`Result is not ready: ${id}`);
      let out=step.result;for(const raw of keys){const key=raw.replace(/~1/g,'/').replace(/~0/g,'~');if(['__proto__','constructor','prototype'].includes(key)||out==null||!Object.hasOwn(out,key))throw new Error(`Missing result field: ${value.$result}`);out=out[key];}
      return structuredClone(out);
    }
    return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolveRefs(v,steps)]));
  }return value;
}
function checkRefs(value,known){
  if(!value||typeof value!=='object')return;
  if(Object.hasOwn(value,'$result')){if(Object.keys(value).length!==1||typeof value.$result!=='string'||!known.has(value.$result.split('/')[0]))throw new Error('Result reference must point to a preceding step');return;}
  for(const v of Object.values(value))checkRefs(v,known);
}
export class TaskRunner {
  constructor({state,definitions,callTool}){this.state=state;this.definitions=definitions;this.callTool=callTool;this.dir=null;this.jobs=new Map();this.loading=null;}
  async load(){if(this.loading)return this.loading;this.loading=(async()=>{
    this.dir=path.join(this.state.baseDir,'tasks');await fs.mkdir(this.dir,{recursive:true});
    for(const name of await fs.readdir(this.dir)){if(!/^task_[a-f0-9]{32}\.json$/.test(name))continue;
      try{const task=JSON.parse(await fs.readFile(path.join(this.dir,name),'utf8'));if(path.basename(name)!==task.id+'.json')continue;
        if(activeStatus.has(task.status)){task.status='interrupted';task.error='Application stopped. Inspect the interrupted step before resuming.';for(const s of task.steps)if(activeStatus.has(s.status))s.status='uncertain';await this.save(task);}
        this.jobs.set(task.id,task);
      }catch(e){this.state.taskLoadError=String(e.message);}
    }
  })();return this.loading;}
  async save(task){task.updatedAt=stamp();const {_run,_control,...data}=task;await atomicWrite(path.join(this.dir,task.id+'.json'),JSON.stringify(data));this.state.onTaskChange?.(this.summary(task));}
  summary(t){return {id:t.id,title:t.title,status:t.status,completed:t.steps.filter(s=>s.status==='completed').length,total:t.steps.length,current:t.steps.find(s=>activeStatus.has(s.status))?.id||null,error:t.error||null,createdAt:t.createdAt,updatedAt:t.updatedAt};}
  owner(context){return context?.owner||'shell';}
  allowed(t,c){if(this.owner(c)!=='shell'&&t.owner!==this.owner(c))throw new Error('Task belongs to another connection or conversation');}
  async get(id,c){await this.load();const t=this.jobs.get(id);if(!t)throw new Error('Unknown task_id');this.allowed(t,c);return t;}
  async list(c){await this.load();return [...this.jobs.values()].filter(t=>this.owner(c)==='shell'||t.owner===this.owner(c)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(t=>this.summary(t));}
  validate(args){
    if(!Array.isArray(args.steps)||!args.steps.length)throw new Error('A task needs at least one step');
    const catalog=new Map(this.definitions().map(d=>[d.name,d]));const known=new Set();
    return args.steps.map((s,i)=>{
      if(!s||typeof s!=='object'||typeof s.tool!=='string'||!catalog.has(s.tool)||forbidden.has(s.tool))throw new Error(`Step ${i+1} uses an unavailable or administrative tool`);
      const id=s.id||`step_${i+1}`;if(!/^[A-Za-z0-9_-]{1,80}$/.test(id)||known.has(id))throw new Error('Step IDs must be unique simple names');
      if(!s.args||typeof s.args!=='object'||Array.isArray(s.args))throw new Error(`Step ${id} needs an argument object`);
      checkRefs(s.args,known);for(const k of catalog.get(s.tool).inputSchema.required||[])if(s.args[k]===undefined)throw new Error(`Step ${id} is missing ${k}`);
      for(const [key,value] of Object.entries(s.args)){
        if(value&&typeof value==='object'&&Object.hasOwn(value,'$result'))continue;
        const prop=catalog.get(s.tool).inputSchema.properties?.[key];if(!prop)continue;
        const valid=prop.type==='array'?Array.isArray(value):prop.type==='object'?value!==null&&typeof value==='object'&&!Array.isArray(value):!prop.type||typeof value===prop.type;
        if(!valid||(prop.type==='number'&&!Number.isFinite(value))||(prop.enum&&!prop.enum.includes(value)))throw new Error(`Step ${id}: invalid ${key}`);
      }
      if(s.wait_for_exit!==undefined&&typeof s.wait_for_exit!=='boolean')throw new Error('wait_for_exit must be boolean');
      if(s.wait_for_exit&&s.tool!=='start_process')throw new Error('Only start_process supports wait_for_exit');
      known.add(id);return {id,tool:s.tool,args:structuredClone(s.args),wait_for_exit:Boolean(s.wait_for_exit),status:'pending'};
    });
  }
  async start(args,c={}){await this.load();const steps=this.validate(args);await c.canContinue?.();
    const t={id:'task_'+crypto.randomBytes(16).toString('hex'),title:String(args.title||'Computer task'),owner:this.owner(c),status:'running',createdAt:stamp(),steps};
    await this.save(t);this.jobs.set(t.id,t);this.launch(t,c);return this.summary(t);
  }
  launch(t,c){t._run=this.run(t,c).catch(async e=>{t.status='interrupted';t.error=String(e.message);for(const s of t.steps)if(activeStatus.has(s.status))s.status='uncertain';try{await this.save(t);}catch{};});}
  async run(t,c){
    for(const step of t.steps){
      if(step.status==='completed')continue;
      if(t.cancelRequested){t.status='cancelled';await this.save(t);return;}
      try{await c.canContinue?.();}catch(e){t.status='paused';t.error=String(e.message);await this.save(t);return;}
      let args;try{args=resolveRefs(step.args,t.steps);}catch(e){step.status='failed';step.error=String(e.message);t.status='failed';t.error=step.error;await this.save(t);return;}step.status='running';step.startedAt=stamp();delete t.error;await this.save(t);
      let phase='execute';
      try{
        step.result=await this.callTool(step.tool,args,c);step.status=step.wait_for_exit?'waiting':'completed';phase='checkpoint';await this.save(t);phase='wait';
        if(step.wait_for_exit){
          let output='',cursor=0;
          while(true){
            try{await c.canContinue?.();}catch(e){t.cancelRequested=true;t.error=String(e.message);}
            if(t.cancelRequested){await this.callTool('force_terminate',{session_id:step.result.session_id},c);step.status='failed';step.error=t.error||'Process stopped by user';t.status='cancelled';await this.save(t);return;}
            const result=await this.callTool('read_process_output',{session_id:step.result.session_id,byte_offset:cursor,length:0},c);
            output+=result.output;cursor=result.next_offset;
            if(!['starting','running','stopping'].includes(result.status)){step.result={...step.result,...result,output};if(result.exit_code!==0||result.status!=='finished')throw new Error(`Process ${result.status}; exit ${result.exit_code}`);break;}
            await sleep(150);
          }
          step.status='completed';
        }
        step.finishedAt=stamp();phase='checkpoint';await this.save(t);
      }catch(e){step.status=phase==='checkpoint'?'uncertain':'failed';step.error=String(e.message);t.status=phase==='checkpoint'?'interrupted':t.cancelRequested?'cancelled':'failed';t.error=step.error;await this.save(t);return;}
    }
    t.status='completed';await this.save(t);
  }
  async detail(args,c){
    const t=await this.get(args.task_id,c),out=this.summary(t);out.steps=structuredClone(t.steps.map(({args,...s})=>s));
    const attachments=[];
    for(const step of out.steps){if(Array.isArray(step.result?._attachments)){
      step.attachment_indices=step.result._attachments.map(a=>{const index=attachments.length;attachments.push({...a,name:`${step.id}-${a.name||'attachment'}`});return index;});
      delete step.result._attachments;
    }}
    if(attachments.length)out._attachments=attachments;return out;
  }
  async cancel(args,c){const t=await this.get(args.task_id,c);if(t._run&&activeStatus.has(t.status)){t.cancelRequested=true;await this.save(t);}else if(t.status!=='completed'){t.status='cancelled';await this.save(t);}return this.summary(t);}
  async resume(args,c){const task=await this.get(args.task_id,c);const next=(task._control||Promise.resolve()).catch(()=>{}).then(()=>this.resumeNow(args,c));task._control=next;return next;}
  async resumeNow(args,c){const t=await this.get(args.task_id,c);if(t.status==='completed'||activeStatus.has(t.status))return this.summary(t);
    const uncertain=t.steps.find(s=>s.status==='uncertain');
    if(uncertain){if(this.owner(c)!=='shell'||!['accept-completed','retry'].includes(args.resolve_uncertain))throw new Error('Interrupted step outcome is uncertain. Inspect it in Tasks; only the local user can acknowledge completion or authorize a retry.');
      if(args.resolve_uncertain==='accept-completed'){uncertain.status='completed';uncertain.result??={acknowledgedByUser:true};}else uncertain.status='pending';
    }
    const failed=t.steps.find(s=>s.status==='failed');if(failed){if(!args.retry_failed)throw new Error('Inspect the failed step before explicitly requesting retry_failed');failed.status='pending';delete failed.error;}
    await c.canContinue?.();t.cancelRequested=false;t.status='running';delete t.error;await this.save(t);this.launch(t,c);return this.summary(t);
  }
}
