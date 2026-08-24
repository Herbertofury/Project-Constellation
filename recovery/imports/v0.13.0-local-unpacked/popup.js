(() => {
  'use strict';
  const STORAGE_KEY = 'projectConstellationPerformanceSettings';
  const DEFAULTS = { enabled:true,responsiveScrolling:true,adaptiveMotionRelief:false,pressureWindowMs:5000,highPressureLongTaskMs:350,highPressureLongTaskCount:5,recoveryQuietMs:3500 };
  const ids = ['enabled','responsiveScrolling','adaptiveMotionRelief','pressure','status','longTasks','maxTask','provider','chatState','resetMetrics','openHome','openConstellation','openAccounts'];
  const els = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
  let currentSettings = { ...DEFAULTS }; let currentTabId = null;
  function renderSettings(){ for (const key of ['enabled','responsiveScrolling','adaptiveMotionRelief']) els[key].checked = Boolean(currentSettings[key]); }
  function renderStatus(status){
    if (!status) { els.pressure.textContent='offline'; els.pressure.dataset.state='offline'; els.provider.textContent='—'; els.chatState.textContent='—'; els.status.textContent='Open a supported AI chat to see live performance. The Command Center remains available.'; return; }
    const state=status.pressure?.pressure||'normal'; els.pressure.textContent=state; els.pressure.dataset.state=state;
    const health=status.chat?.health;
    els.provider.textContent=status.provider?.name||'AI'; els.chatState.textContent=health?.title||status.chat?.status||'idle'; els.longTasks.textContent=status.metrics?.totalLongTasks||0; els.maxTask.textContent=`${status.metrics?.maxLongTaskMs||0} ms`;
    els.status.textContent=health?.detail||'Performance protection and continuity capture are active on this tab.';
  }
  async function activeTab(){ const [tab]=await chrome.tabs.query({active:true,currentWindow:true}); return tab?.id ? tab : null; }
  async function refresh(){ const tab=await activeTab(); currentTabId=tab?.id||null; if(!currentTabId){renderStatus(null);return;} try{renderStatus(await chrome.tabs.sendMessage(currentTabId,{type:'PC_GET_STATUS'}));}catch(_){renderStatus(null);} }
  async function save(){ currentSettings={...currentSettings,enabled:els.enabled.checked,responsiveScrolling:els.responsiveScrolling.checked,adaptiveMotionRelief:els.adaptiveMotionRelief.checked}; await chrome.storage.local.set({[STORAGE_KEY]:currentSettings}); await refresh(); }
  ['enabled','responsiveScrolling','adaptiveMotionRelief'].forEach((key)=>els[key].addEventListener('change',save));
  els.resetMetrics.addEventListener('click',async()=>{ if(currentTabId){ try{renderStatus(await chrome.tabs.sendMessage(currentTabId,{type:'PC_RESET_METRICS'}));}catch(_){renderStatus(null);} } });
  els.openHome.addEventListener('click',async()=>{ await chrome.tabs.create({url:chrome.runtime.getURL('home.html'),active:true}); window.close(); });
  els.openConstellation.addEventListener('click',async()=>{ const [tab]=await chrome.tabs.query({active:true,currentWindow:true}); let opened=false; if(tab?.windowId&&chrome.sidePanel?.open){ try{await chrome.sidePanel.open({windowId:tab.windowId});opened=true;}catch(_){opened=false;} } if(!opened)await chrome.tabs.create({url:chrome.runtime.getURL('sidepanel.html'),active:true}); window.close(); });
  els.openAccounts.addEventListener('click',async()=>{await chrome.tabs.create({url:chrome.runtime.getURL('home.html?view=connections'),active:true});window.close();});
  (async()=>{ const stored=await chrome.storage.local.get(STORAGE_KEY); currentSettings={...DEFAULTS,...(stored[STORAGE_KEY]||{})}; renderSettings(); await refresh(); })();
})();
