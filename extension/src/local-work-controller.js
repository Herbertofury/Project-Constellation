const PCX_DESKTOP_BASE = 'http://127.0.0.1:47721';
const PCX_DESKTOP_VERSION = '0.23.0';
const PCX_DESKTOP_ALARM = 'pcx-local-work-heartbeat-v020';
const PCX_DESKTOP_STATUS_KEY = 'projectConstellationDesktopStatus';

async function pcxDesktopBridge(path, {method='GET', body=null, token=''} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${PCX_DESKTOP_BASE}${path}`, {
      method,
      headers: {
        ...(body ? {'content-type':'application/json'} : {}),
        ...(token ? {authorization:`Bearer ${token}`} : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    const data = await response.json().catch(()=>({ok:false,error:`HTTP ${response.status}`}));
    return {status:response.status,...data};
  } finally { clearTimeout(timer); }
}
async function pcxStoreDesktopStatus(patch){
  const value={version:PCX_DESKTOP_VERSION,at:new Date().toISOString(),...patch};
  await chrome.storage.local.set({[PCX_DESKTOP_STATUS_KEY]:value});
  chrome.runtime.sendMessage({type:'PC_LOCAL_DESKTOP_STATUS_UPDATED',value}).catch(()=>{});
  globalThis.ProjectConstellationStateEventBusCore?.publishCoalesced?.('desktop.status.changed',{connected:Boolean(value.connected),versionMismatch:Boolean(value.versionMismatch),desktopVersion:value.desktopVersion||null},{source:'local-work',key:'desktop',delayMs:80});
  return value;
}
async function pcxScheduleDesktopFallback(connected){
  if (typeof chrome.alarms?.clear === 'function') {
    await chrome.alarms.clear(PCX_DESKTOP_ALARM).catch(()=>{});
  }
  if (typeof chrome.alarms?.create === 'function') {
    await chrome.alarms.create(PCX_DESKTOP_ALARM,{delayInMinutes:connected?10:3});
  }
}
async function pcxAnnounceDesktop(){
  try {
    const response=await pcxDesktopBridge('/v1/companion/hello',{method:'POST',body:{version:PCX_DESKTOP_VERSION,extensionId:chrome.runtime.id}});
    const connected=!!response?.ok;
    await pcxStoreDesktopStatus({connected,versionMismatch:!!response?.versionMismatch,desktopVersion:response?.version||null,error:''});
    await pcxScheduleDesktopFallback(connected);
    return response;
  } catch(error){
    await pcxStoreDesktopStatus({connected:false,error:String(error?.message||error)});
    await pcxScheduleDesktopFallback(false);
    return{ok:false,offline:true};
  }
}
chrome.alarms.onAlarm.addListener(a=>{if(a.name===PCX_DESKTOP_ALARM)void pcxAnnounceDesktop()});
chrome.runtime.onStartup.addListener(()=>{void pcxAnnounceDesktop()});
chrome.runtime.onInstalled.addListener(()=>{void pcxAnnounceDesktop()});
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(sender.id!==chrome.runtime.id)return;
  (async()=>{
    try {
      if(message?.type==='PC_LOCAL_DESKTOP_STATUS'){const v=await chrome.storage.local.get(PCX_DESKTOP_STATUS_KEY);return sendResponse(v[PCX_DESKTOP_STATUS_KEY]||{connected:false,version:PCX_DESKTOP_VERSION})}
      if(message?.type==='PC_LOCAL_DESKTOP_REFRESH')return sendResponse(await pcxAnnounceDesktop());
      if(message?.type==='CC_HEALTH')return sendResponse(await pcxDesktopBridge('/health'));
      if(message?.type==='CC_BOOTSTRAP')return sendResponse(await pcxDesktopBridge('/v1/session/bootstrap',{method:'POST',body:{chatId:message.chatId,url:message.url}}));
      if(message?.type==='CC_REFRESH')return sendResponse(await pcxDesktopBridge('/v1/session/refresh',{method:'POST',token:message.sessionToken,body:{nonce:message.nonce}}));
      if(message?.type==='CC_CALL')return sendResponse(await pcxDesktopBridge('/v1/session/call',{method:'POST',token:message.sessionToken,body:message.call}));
      if(message?.type==='CC_DIAGNOSTIC')return sendResponse(await pcxDesktopBridge('/v1/companion/event',{method:'POST',body:{event:message.event,detail:message.detail||null,at:new Date().toISOString()}}));
    } catch(error){return sendResponse({ok:false,error:String(error?.message||error),offline:true})}
  })(); return true;
});
void pcxAnnounceDesktop();
