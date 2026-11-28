import { recoveryFallbackMinutes, normalizedRecoverySignal } from './scheduled-task-recovery-policy.js';

const PCX_RECOVERY_KEY='pcx.scheduleRecovery.v2';
const PCX_RECOVERY_CONFIG='pcx.scheduleRecovery.v2.config';
const PCX_RECOVERY_ALARM='pcx-schedule-recovery-v2';
const PCX_RECOVERY_URL='https://chatgpt.com/schedules';
const PCX_DOM_SETTLE_MS=700;
const PCX_LEGACY_DOM_MIN_GAP_MS=15000;
let pcxRecoveryFlight=null;
let pcxRecoveryPendingReason='';
let pcxRecoveryDomTimer=0;
let pcxRecoveryLastDomSignal='';
let pcxRecoveryLastLegacyDomAt=0;

const pcxNow=()=>new Date().toISOString();

async function pcxRecLoad(){
  const v=await chrome.storage.local.get([PCX_RECOVERY_KEY,PCX_RECOVERY_CONFIG]);
  const stored=v[PCX_RECOVERY_KEY]||{};
  return {
    version:2,
    status:'NOT_YET_INSPECTED',
    sessions:{},
    incidents:{},
    history:[],
    schedulerTabId:null,
    lastInspection:null,
    lastTasks:[],
    config:{enabled:true},
    ...stored,
    sessions:stored.sessions||{},
    incidents:stored.incidents||{},
    history:Array.isArray(stored.history)?stored.history:[],
    lastTasks:Array.isArray(stored.lastTasks)?stored.lastTasks:[],
    config:{enabled:true,...(stored.config||{}),...(v[PCX_RECOVERY_CONFIG]||{})}
  };
}

async function pcxRecSave(s){
  const v=await chrome.storage.local.get(PCX_RECOVERY_CONFIG);
  s.config={...s.config,...(v[PCX_RECOVERY_CONFIG]||{})};
  if(s.history.length>1000)s.history.splice(0,s.history.length-1000);
  await chrome.storage.local.set({[PCX_RECOVERY_KEY]:s});
}

function pcxRecAudit(s,event,detail={}){s.history.push({at:pcxNow(),event,...detail});}
async function pcxRecGetTab(id){try{return Number.isInteger(id)?await chrome.tabs.get(id):null}catch{return null}}
async function pcxRecMessage(id,msg){
  try{return await chrome.tabs.sendMessage(id,msg,{frameId:0})}
  catch(e){
    const t=await pcxRecGetTab(id);
    if(!t||!/^https:\/\/chatgpt\.com\//.test(t.url||t.pendingUrl||''))throw e;
    await chrome.scripting.executeScript({target:{tabId:id,frameIds:[0]},files:['src/scheduled-task-recovery-page.js']});
    return chrome.tabs.sendMessage(id,msg,{frameId:0});
  }
}

async function pcxRecScheduler(s){
  let t=await pcxRecGetTab(s.schedulerTabId);
  if(t&&/^https:\/\/chatgpt\.com\/(scheduled|schedules|tasks)/.test(t.url||t.pendingUrl||''))return t;
  t=await chrome.tabs.create({url:PCX_RECOVERY_URL,active:false});
  s.schedulerTabId=t.id;
  pcxRecAudit(s,'CONTROL_TAB_CREATED',{tabId:t.id});
  await pcxRecSave(s);
  return t;
}

function pcxRecUnsafe(x){
  if(x.auth)return'SIGN_IN_REQUIRED';
  if(x.challenge)return'BROWSER_VERIFICATION_REQUIRED';
  if(x.approval)return'SECURITY_APPROVAL_REQUIRED';
  if(x.draft)return'USER_DRAFT_PRESENT';
  if(x.ambiguous)return'AMBIGUOUS_UI';
  return null;
}

function pcxRecCounts(s){
  const sessions=Object.values(s.sessions||{});
  s.counts={
    observed:(s.lastTasks||[]).length,
    attention:(s.lastTasks||[]).filter(t=>t.attention).length,
    paused:(s.lastTasks||[]).filter(t=>t.paused).length,
    recoverySessions:sessions.length,
    waitingApproval:sessions.filter(v=>v.status==='SECURITY_APPROVAL_REQUIRED').length
  };
}

async function pcxRecAct(s,tab,session,action,key){
  const inc=s.incidents[session.key]||(s.incidents[session.key]={actions:{}});
  inc.actions||={};
  if(inc.actions[key])return;
  inc.actions[key]={at:pcxNow(),status:'INTENT_PERSISTED'};
  session.status='ACTION_INTENT_PERSISTED';
  await pcxRecSave(s);
  const ack=await pcxRecMessage(tab,{type:'PC_SCHEDULE_RECOVERY_ACT',action,active:session}).catch(e=>({ok:false,reason:String(e.message)}));
  inc.actions[key].status=ack?.ok?'CLICK_DISPATCHED_NOT_VERIFIED':'NOT_EXECUTED_OR_UNCERTAIN';
  session.status=ack?.ok?'WAITING_FOR_RUN_EVIDENCE':'ACTION_NOT_VERIFIED';
  pcxRecAudit(s,'ACTION_RESULT',{task:session.title,kind:action.kind,ok:!!ack?.ok,reason:ack?.reason||''});
  await pcxRecSave(s);
}

async function pcxRecCycle(reason){
  const s=await pcxRecLoad();
  if(!s.config?.enabled)return s;
  s.lastReason=String(reason||'unknown');
  for(const [id,session] of Object.entries(s.sessions)){
    const tab=await pcxRecGetTab(Number(id));
    if(!tab){delete s.sessions[id];continue}
    if(tab.status==='loading')continue;
    const x=await pcxRecMessage(Number(id),{type:'PC_SCHEDULE_RECOVERY_INSPECT',active:session});
    const unsafe=pcxRecUnsafe(x);
    if(unsafe){session.status=unsafe;continue}
    if(x.running){session.status='RUNNING_OBSERVED';if(s.incidents[session.key])s.incidents[session.key].healthy=true;continue}
    if(x.completed){session.status='UI_COMPLETION_OBSERVED';if(s.incidents[session.key])s.incidents[session.key].healthy=true;delete s.sessions[id];continue}
    if(x.action){
      const k=session.key+'|'+x.action.kind+'|'+String(x.fingerprint||'current');
      await pcxRecAct(s,Number(id),session,x.action,k);
    }else session.status='NO_SAFE_CONTINUATION';
  }
  if(s.schedulerTabId!=null&&s.sessions[s.schedulerTabId]){
    s.lastInspection=pcxNow();
    pcxRecCounts(s);
    await pcxRecSave(s);
    return s;
  }
  const tab=await pcxRecScheduler(s);
  if(tab.status==='loading'){
    s.status='PAGE_LOADING';
    pcxRecCounts(s);
    await pcxRecSave(s);
    return s;
  }
  const x=await pcxRecMessage(tab.id,{type:'PC_SCHEDULE_RECOVERY_INSPECT'});
  s.lastTasks=(x.tasks||[]).map(({title,id,runId,attention,paused,fingerprint})=>({title,id,runId,attention,paused,fingerprint}));
  const unsafe=pcxRecUnsafe(x);
  if(unsafe){
    s.status=unsafe;
    s.lastInspection=pcxNow();
    pcxRecCounts(s);
    await pcxRecSave(s);
    return s;
  }
  const task=(x.tasks||[]).find(t=>t.attention&&t.openAction);
  if(task){
    const key=[task.title,task.id,task.runId].join('|');
    const prior=s.incidents[key];
    if(!prior||prior.healthy){
      const session={key,title:task.title,id:task.id,runId:task.runId,status:'OPENING_FOLLOWUP',openedAt:pcxNow()};
      s.sessions[tab.id]=session;
      s.incidents[key]={title:task.title,actions:{},healthy:false};
      await pcxRecAct(s,tab.id,session,task.openAction,key+'|open');
    }
  }else s.status='NO_ATTENTION_IN_INSPECTED_TASKS';
  s.lastInspection=pcxNow();
  pcxRecCounts(s);
  await pcxRecSave(s);
  return s;
}

async function pcxRecScheduleFallback(state){
  const minutes=recoveryFallbackMinutes(state);
  if(!minutes){
    await chrome.alarms.clear(PCX_RECOVERY_ALARM);
    return;
  }
  await chrome.alarms.create(PCX_RECOVERY_ALARM,{delayInMinutes:minutes});
  state.fallbackMinutes=minutes;
  state.nextInspectionAt=new Date(Date.now()+minutes*60*1000).toISOString();
  await pcxRecSave(state);
}

function pcxRecPendingPriority(reason){
  return ['user','config','fallback','startup'].includes(String(reason||''))?2:1;
}

function pcxRecMergePending(reason){
  if(!pcxRecoveryPendingReason||pcxRecPendingPriority(reason)>=pcxRecPendingPriority(pcxRecoveryPendingReason))pcxRecoveryPendingReason=reason;
}

async function pcxRecKick(reason){
  if(pcxRecoveryFlight){pcxRecMergePending(reason);return pcxRecoveryFlight}
  let cycleState=null;
  pcxRecoveryFlight=(async()=>{
    try{
      cycleState=await pcxRecCycle(reason);
      return cycleState;
    }finally{
      if(cycleState)await pcxRecScheduleFallback(cycleState).catch(()=>{});
      const next=pcxRecoveryPendingReason;
      pcxRecoveryPendingReason='';
      pcxRecoveryFlight=null;
      if(next){
        const delay=next==='dom'?PCX_DOM_SETTLE_MS:0;
        setTimeout(()=>void pcxRecKick(next),delay);
      }
    }
  })();
  return pcxRecoveryFlight;
}

function pcxRecHandleDomChanged(signature){
  const signal=normalizedRecoverySignal(signature);
  if(signal){
    if(signal===pcxRecoveryLastDomSignal)return;
    pcxRecoveryLastDomSignal=signal;
  }else{
    const at=Date.now();
    if(at-pcxRecoveryLastLegacyDomAt<PCX_LEGACY_DOM_MIN_GAP_MS)return;
    pcxRecoveryLastLegacyDomAt=at;
  }
  if(pcxRecoveryDomTimer)clearTimeout(pcxRecoveryDomTimer);
  pcxRecoveryDomTimer=setTimeout(()=>{
    pcxRecoveryDomTimer=0;
    void pcxRecKick('dom');
  },PCX_DOM_SETTLE_MS);
}

async function pcxRecEnsureFallback(){
  const state=await pcxRecLoad();
  if(state.config?.enabled===false){await chrome.alarms.clear(PCX_RECOVERY_ALARM);return}
  const alarm=await chrome.alarms.get(PCX_RECOVERY_ALARM);
  if(!alarm||Number(alarm.periodInMinutes||0)>0)await pcxRecScheduleFallback(state);
}

chrome.alarms.onAlarm.addListener(a=>{if(a.name===PCX_RECOVERY_ALARM)void pcxRecKick('fallback')});
chrome.runtime.onStartup.addListener(()=>{void pcxRecEnsureFallback().catch(()=>{})});
chrome.runtime.onInstalled.addListener(()=>{void pcxRecEnsureFallback().catch(()=>{})});
chrome.runtime.onMessage.addListener((m,s,r)=>{
  if(s.id!==chrome.runtime.id)return;
  if(m?.type==='PC_SCHEDULE_RECOVERY_DOM_CHANGED'){pcxRecHandleDomChanged(m.signature);return}
  if(m?.type==='PC_SCHEDULE_RECOVERY_STATE'){pcxRecLoad().then(r);return true}
  if(m?.type==='PC_SCHEDULE_RECOVERY_CHECK'){pcxRecKick('user').then(pcxRecLoad).then(r);return true}
  if(m?.type==='PC_SCHEDULE_RECOVERY_CONFIG'){
    (async()=>{
      const state=await pcxRecLoad();
      const cfg={...state.config,...m.config};
      await chrome.storage.local.set({[PCX_RECOVERY_CONFIG]:cfg});
      state.config=cfg;
      await pcxRecSave(state);
      if(cfg.enabled)void pcxRecKick('config');
      else await chrome.alarms.clear(PCX_RECOVERY_ALARM);
      r({ok:true,config:cfg});
    })();
    return true;
  }
});

void pcxRecEnsureFallback().catch(()=>{});
