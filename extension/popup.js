(() => {
  'use strict';
  const STORAGE_KEY = 'projectConstellationPerformanceSettings';
  const PULSE_UX_KEY = 'projectConstellationPulseUxSettings';
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const constrainedDevice=Number(navigator.hardwareConcurrency||8)<=4||Number(navigator.deviceMemory||8)<=4;
  document.body.dataset.atmosphere=reducedMotion?'off':constrainedDevice?'static':'animated';
  const DEFAULTS = { enabled:true,responsiveScrolling:true,adaptiveMotionRelief:false,pressureWindowMs:5000,highPressureLongTaskMs:350,highPressureLongTaskCount:5,recoveryQuietMs:3500 };
  const PULSE_DEFAULTS = { statusPinEnabled:true,outputWarningsEnabled:true,outputWarningStrictness:'balanced' };
  const ACTIVE_STATUSES = new Set(['running','paused','waiting-user','blocked-approval']);
  const STALE_STATUSES = new Set(['refresh-required','rate-limited','errored','stalled','auth-required','unavailable']);
  const COMPLETED_STATUSES = new Set(['idle','archived']);
  const ids = ['enabled','responsiveScrolling','adaptiveMotionRelief','pressure','status','longTasks','maxTask','provider','chatState','resetMetrics','openHome','openConstellation','openAccounts','chatPulse','chatPulseHint','activeSummary','staleSummary','completedSummary','activeCount','staleCount','completedCount','activeLatest','staleLatest','completedLatest','statusPinEnabled','outputWarningsEnabled','outputWarningStrictness'];
  const els = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
  let currentSettings = { ...DEFAULTS };
  let pulseSettings = { ...PULSE_DEFAULTS };
  let brainOverview = null;
  let currentTabId = null;
  const safe = (value,max=90)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
  const statusBucket=(status='idle')=>ACTIVE_STATUSES.has(status)?'active':STALE_STATUSES.has(status)?'stale':'completed';
  const sumStatuses=(counts,set)=>[...set].reduce((sum,status)=>sum+Math.max(0,Number(counts?.[status]||0)),0);
  const primaryChatLabel=(status='idle')=>statusBucket(status)==='completed'?'complete':statusBucket(status)==='stale'?'needs attention':status.replaceAll('-',' ');

  function renderSettings(){
    for (const key of ['enabled','responsiveScrolling','adaptiveMotionRelief']) els[key].checked = Boolean(currentSettings[key]);
    els.statusPinEnabled.checked = pulseSettings.statusPinEnabled !== false;
    els.outputWarningsEnabled.checked = pulseSettings.outputWarningsEnabled !== false;
    els.outputWarningStrictness.value = ['relaxed','balanced','strict'].includes(pulseSettings.outputWarningStrictness) ? pulseSettings.outputWarningStrictness : 'balanced';
    els.chatPulse.hidden = !els.statusPinEnabled.checked;
  }
  function renderStatus(status){
    if (!status) { els.pressure.textContent='offline'; els.pressure.dataset.state='offline'; els.provider.textContent='—'; els.chatState.textContent='—'; els.status.textContent='Open a supported AI chat to see live performance. The Command Center remains available.'; return; }
    const state=status.pressure?.pressure||'normal'; els.pressure.textContent=state; els.pressure.dataset.state=state;
    const health=status.chat?.health; const rawStatus=String(status.chat?.status||'idle'); const outputOnly=health?.state==='output-regressed'||/^saved output is missing/i.test(String(health?.title||''));
    els.provider.textContent=status.provider?.name||'AI'; els.chatState.textContent=outputOnly?primaryChatLabel(rawStatus):(health?.title||rawStatus); els.longTasks.textContent=status.metrics?.totalLongTasks||0; els.maxTask.textContent=`${status.metrics?.maxLongTaskMs||0} ms`;
    els.status.textContent=outputOnly?`Chat is ${primaryChatLabel(rawStatus)}. Saved/page differences are tracked separately in Output Vault.`:(health?.detail||'Performance protection and continuity capture are active on this tab.');
  }
  function renderChatPulse(){
    els.chatPulse.hidden = pulseSettings.statusPinEnabled === false;
    if (els.chatPulse.hidden) return;
    const snapshot=brainOverview||{}; const counts=snapshot.statusCounts||{}; const chats=Array.isArray(snapshot.recentChats)?snapshot.recentChats:[];
    const groups={active:[],stale:[],completed:[]};
    for(const chat of chats){groups[statusBucket(String(chat?.status||'idle'))].push(chat);}
    const totals={active:sumStatuses(counts,ACTIVE_STATUSES),stale:sumStatuses(counts,STALE_STATUSES),completed:sumStatuses(counts,COMPLETED_STATUSES)};
    for(const bucket of ['active','stale','completed']){
      const latest=groups[bucket][0]||null;
      els[`${bucket}Count`].textContent=String(totals[bucket]||0);
      els[`${bucket}Latest`].textContent=latest?safe(latest.title||latest.projectName||'Untitled chat',58):`No ${bucket} chats`;
      const card=els[bucket==='completed'?'completedSummary':`${bucket}Summary`];
      card.dataset.url=latest?.url||''; card.disabled=!latest?.url; card.title=latest?.url?`Open ${safe(latest.title||'latest chat',100)}`:`No ${bucket} chat is available to open`;
    }
    els.chatPulseHint.textContent=totals.active||totals.stale?'Active and stale work stays visible here without opening the Command Center.':'No active or stale chats right now. Latest completed work remains one click away.';
  }
  async function activeTab(){ const [tab]=await chrome.tabs.query({active:true,currentWindow:true}); return tab?.id ? tab : null; }
  async function refresh(){ const tab=await activeTab(); currentTabId=tab?.id||null; if(!currentTabId){renderStatus(null);return;} try{renderStatus(await chrome.tabs.sendMessage(currentTabId,{type:'PC_GET_STATUS'}));}catch(_){renderStatus(null);} }
  async function refreshBrainOverview(){
    if(!chrome.runtime?.sendMessage){brainOverview=null;renderChatPulse();return;}
    try{const response=await chrome.runtime.sendMessage({type:'PC_BRAIN_COUNTS'});brainOverview=response?.ok?(response.counts||null):null;}catch(_){brainOverview=null;}
    renderChatPulse();
  }
  async function savePerformance(){ currentSettings={...currentSettings,enabled:els.enabled.checked,responsiveScrolling:els.responsiveScrolling.checked,adaptiveMotionRelief:els.adaptiveMotionRelief.checked}; await chrome.storage.local.set({[STORAGE_KEY]:currentSettings}); await refresh(); }
  async function savePulseUx(){
    pulseSettings={...pulseSettings,statusPinEnabled:els.statusPinEnabled.checked,outputWarningsEnabled:els.outputWarningsEnabled.checked,outputWarningStrictness:['relaxed','balanced','strict'].includes(els.outputWarningStrictness.value)?els.outputWarningStrictness.value:'balanced'};
    await chrome.storage.local.set({[PULSE_UX_KEY]:pulseSettings}); renderSettings(); renderChatPulse();
  }
  ['enabled','responsiveScrolling','adaptiveMotionRelief'].forEach((key)=>els[key].addEventListener('change',savePerformance));
  ['statusPinEnabled','outputWarningsEnabled','outputWarningStrictness'].forEach((key)=>els[key].addEventListener('change',savePulseUx));
  for(const card of [els.activeSummary,els.staleSummary,els.completedSummary]) card.addEventListener('click',async()=>{const url=card.dataset.url;if(!url)return;await chrome.tabs.create({url,active:true});window.close();});
  els.resetMetrics.addEventListener('click',async()=>{ if(currentTabId){ try{renderStatus(await chrome.tabs.sendMessage(currentTabId,{type:'PC_RESET_METRICS'}));}catch(_){renderStatus(null);} } });
  els.openHome.addEventListener('click',async()=>{ await chrome.tabs.create({url:chrome.runtime.getURL('home.html'),active:true}); window.close(); });
  els.openConstellation.addEventListener('click',async()=>{ const [tab]=await chrome.tabs.query({active:true,currentWindow:true}); let opened=false; if(tab?.windowId&&chrome.sidePanel?.open){ try{await chrome.sidePanel.open({windowId:tab.windowId});opened=true;}catch(_){opened=false;} } if(!opened)await chrome.tabs.create({url:chrome.runtime.getURL('sidepanel.html'),active:true}); window.close(); });
  els.openAccounts.addEventListener('click',async()=>{await chrome.tabs.create({url:chrome.runtime.getURL('home.html?view=connections'),active:true});window.close();});
  (async()=>{ const stored=await chrome.storage.local.get([STORAGE_KEY,PULSE_UX_KEY]); currentSettings={...DEFAULTS,...(stored[STORAGE_KEY]||{})}; pulseSettings={...PULSE_DEFAULTS,...(stored[PULSE_UX_KEY]||{})}; renderSettings(); await Promise.all([refresh(),refreshBrainOverview()]); })();
})();