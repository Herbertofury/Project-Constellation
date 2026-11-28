import './attention-service.js';
import './attention-audio.js';

(() => {
  'use strict';
  const core = globalThis.ProjectConstellationAttentionService;
  if (!core || !globalThis.chrome?.runtime) return;
  const CHANNEL_TIMEOUT_MS=4000;
  function channelDeadline(action,message) {
    let timer;
    const pending=Promise.resolve().then(action);
    return Promise.race([pending,new Promise((_,reject)=>{
      timer=setTimeout(()=>{const error=new Error(message);error.code='PC_ATTENTION_CHANNEL_TIMEOUT';reject(error);},CHANNEL_TIMEOUT_MS);
    })]).finally(()=>clearTimeout(timer));
  }
  const audioContexts=()=>chrome.runtime.getContexts?channelDeadline(
    ()=>chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[chrome.runtime.getURL('offscreen.html')]}),
    'The browser did not respond while locating the audio surface within four seconds.'):Promise.resolve([]);
  let offscreenCreating = null;
  async function ensureAudioSurface() {
    if (chrome.runtime.getContexts) {
      const contexts = await audioContexts();
      if (contexts.length) return;
    }
    if (!chrome.offscreen?.createDocument) throw new Error('This browser needs the companion sensor audio surface.');
    if (!offscreenCreating) offscreenCreating = channelDeadline(()=>chrome.offscreen.createDocument({url:'offscreen.html',
      reasons:['DOM_PARSER','AUDIO_PLAYBACK'],justification:'Play configured agent attention alerts and parse provider metadata.'
    }),'The browser did not finish creating the audio surface within four seconds.').catch(async (error) => {
      // The existing parser/guardian may create the same single offscreen document
      // concurrently. Accept only a verified document, never swallow a real failure.
      const contexts = await audioContexts();
      if (!contexts.length) throw error;
    }).finally(()=>{offscreenCreating=null;});
    await offscreenCreating;
  }
  async function playSound(options) {
    if(typeof document!=='undefined' && (globalThis.AudioContext||globalThis.webkitAudioContext))return globalThis.pcAttentionPlayAudio({...options,backend:'background-web-audio'});
    for(let attempt=0;attempt<2;attempt++) {
      await ensureAudioSurface();
      let result,missingReceiver=false;
      try {
        result=await channelDeadline(()=>chrome.runtime.sendMessage({type:'PC_ATTENTION_AUDIO_PLAY',target:'pc-attention-audio',...options}),
          'The audio surface did not respond within four seconds.');
      } catch(error) {
        missingReceiver=/receiving end does not exist|could not establish connection/i.test(String(error?.message||error));
        result={ok:false,interrupted:!missingReceiver,error:String(error?.message||error)};
      }
      if(result?.ok===true&&result.started===true)return result;
      // A missing reply is not evidence that playback failed to start. Retrying
      // that request can ring twice, even if its offscreen document then closes.
      if(result?.interrupted||(!missingReceiver&&result?.ok!==false))return {ok:false,interrupted:true,
        error:String(result?.error||'The audio surface did not confirm that playback started.')+' Playback outcome is uncertain. Use Test alert to check audio.'};
      // Chrome may close a silent AUDIO_PLAYBACK document between discovery and
      // messaging. Recreate once only when it is gone; never keep it alive with
      // inaudible loops or retry an acknowledged playback/blocked audio context.
      const contexts=await audioContexts();
      if(attempt===0&&!contexts.length)continue;
      return {ok:false,error:String(result?.error||'The audio surface did not confirm that playback started.')};
    }
    return {ok:false,error:'The audio surface is unavailable.'};
  }
  // Notification APIs cannot be cancelled. Retain the latest desired state
  // while an operation is outstanding so a late create cannot resurrect an
  // acknowledged toast, and a late clear cannot erase its later snooze reminder.
  const notificationIntents=new Map();
  function notificationIntent(id,options) {
    let entry=notificationIntents.get(id);
    if(!entry){entry={revision:0,pending:0,options:null};notificationIntents.set(id,entry);}
    entry.revision+=1;entry.options=options;return entry;
  }
  function notificationOperation(id,entry,method,options) {
    const revision=entry.revision;
    entry.pending+=1;
    const pending=Promise.resolve().then(()=>chrome.notifications[method](id,...(method==='create'?[options]:[])));
    void pending.then(()=>{
      if(notificationIntents.get(id)===entry&&entry.revision!==revision){
        void notificationOperation(id,entry,entry.options?'create':'clear',entry.options).catch(()=>{});
      }
    },()=>{}).finally(()=>{
      entry.pending-=1;
      if(!entry.pending&&!entry.options&&notificationIntents.get(id)===entry)notificationIntents.delete(id);
    });
    return channelDeadline(()=>pending,`The browser did not confirm notification ${method==='create'?'delivery':'cleanup'} within four seconds.`);
  }
  const service=core.createService({
    read:async(key)=>(await chrome.storage.local.get(key))[key],
    write:async(key,value)=>chrome.storage.local.set({[key]:value}),
    alarm:async(name,when)=>chrome.alarms.create(name,{when}),
    clearAlarm:async(name)=>chrome.alarms.clear(name),
    notify:async(item)=>{
      if (!chrome.notifications?.create) return {ok:false,error:'Browser notifications are unavailable.'};
      if (chrome.notifications.getPermissionLevel) {
        const level=await channelDeadline(()=>chrome.notifications.getPermissionLevel(),'The browser did not report notification permission within four seconds.');
        if (level==='denied') return {ok:false,error:'Browser notification permission is denied. Enable it in browser settings.'};
      }
      const options={type:'basic',iconUrl:chrome.runtime.getURL('assets/attention-icon.png'),
        title:item.label,message:`${item.title}${item.reason ? ' · '+item.reason : ''}`.slice(0,320),
        contextMessage:'Project Constellation · '+item.browser,priority:item.severity==='critical'?2:1,
        requireInteraction:item.severity==='critical',silent:true,
        buttons:[{title:'Review chat'},{title:'Snooze 10 min'}]};
      if(item.kind==='test')delete options.buttons;
      const entry=notificationIntent(item.id,options);
      try { await notificationOperation(item.id,entry,'create',options); }
      catch (error) {
        if(error?.code==='PC_ATTENTION_CHANNEL_TIMEOUT')throw error;
        // Firefox and some platform notification backends reject action buttons.
        const fallback={...options};delete fallback.buttons;delete fallback.requireInteraction;
        entry.options=fallback;await notificationOperation(item.id,entry,'create',fallback);
      }
      return {ok:true};
    },
    clearNotification:async(id)=>{if(chrome.notifications?.clear)await notificationOperation(id,notificationIntent(id,null),'clear');},
    sound:playSound,
    focus:async(item)=>{
      if(String(item.sourceId||'').startsWith('native:'))return globalThis.pcNativeMonitor?.focus(item.sourceId.slice(7)+':'+item.tabId)||{ok:false,error:'The companion is unavailable.'};
      const tab=await chrome.tabs.get(item.tabId).catch(()=>null);
      if (!tab || core.canonicalUrl(tab.url)!==item.url) return {ok:false,error:'The original conversation is no longer in this tab.'};
      await chrome.tabs.update(tab.id,{active:true});
      if (tab.windowId) await chrome.windows?.update?.(tab.windowId,{focused:true});
      // This only reveals the provider prompt. It never clicks a permission control.
      if (item.kind==='permission_required') await chrome.tabs.sendMessage(tab.id,{type:'PC_ATTENTION_REVEAL_PERMISSION'}).catch(()=>{});
      return {ok:true,tabId:tab.id};
    },
    changed:(event)=>globalThis.ProjectConstellationStateEventBusCore?.publishCoalesced('attention.changed',event,{source:'attention',key:'journal',delayMs:80})
  });
  globalThis.pcAttention=service;
  globalThis.pcAttentionObserve=(row)=>service.observe(row);
  globalThis.pcAttentionGet=()=>service.get();
  globalThis.pcAttentionSubscribe=(listener)=>service.subscribe(listener);
  globalThis.pcAttentionSetAudioOwner=(value)=>service.setAudioOwner(value);

  const uiSender=(sender)=>Boolean(sender?.id===chrome.runtime.id && String(sender.url||'').startsWith(chrome.runtime.getURL('')));
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if (!/^PC_ATTENTION_/.test(String(message?.type||'')) || message?.target) return false;
    if (!uiSender(sender)) {respond({ok:false,error:'Attention controls are available only in the extension dashboard.'});return false;}
    let result;
    switch(message.type) {
      case 'PC_ATTENTION_GET': result=service.get().then((attention)=>({ok:true,attention}));break;
      case 'PC_ATTENTION_ACK': result=service.acknowledge(message.id);break;
      case 'PC_ATTENTION_SNOOZE': result=service.snooze(message.id,message.minutes);break;
      case 'PC_ATTENTION_FOCUS': result=service.focus(message.id);break;
      case 'PC_ATTENTION_SETTINGS': result=service.settings(message.settings||{}).then((attention)=>({ok:true,attention}));break;
      case 'PC_ATTENTION_TEST': result=service.test();break;
      default: result=Promise.resolve({ok:false,error:'Unknown attention control.'});
    }
    Promise.resolve(result).then(respond).catch((error)=>respond({ok:false,error:String(error?.message||error)}));
    return true;
  });
  chrome.alarms.onAlarm.addListener((alarm)=>{
    if(alarm.name===core.ALARM_NAME) void service.reminders().catch((error)=>console.warn('Constellation reminders:',String(error?.message||error)));
  });
  const lifecycleError=(error)=>console.warn('Constellation attention lifecycle:',String(error?.message||error));
  chrome.tabs?.onRemoved?.addListener((id)=>{void service.closeTab(id).catch(lifecycleError);});
  async function reconcileTabChange(id,change) {
    const at=Date.now(),snapshot=await service.get();
    const rows=snapshot.sessions.filter(row=>row.sourceId==='local'&&row.tabId===id&&row.status!=='closed');
    if(!rows.length)return;
    const current=await chrome.tabs.get(id).catch(()=>null);
    if(!current)return;
    const currentUrl=core.canonicalUrl(current.url);
    // Event delivery and the preceding storage read can straddle another
    // navigation. Check both the live tab and the captured journal row.
    if(change.url){
      if(currentUrl!==core.canonicalUrl(change.url))return;
      for(const row of rows)if(row.url!==currentUrl)await service.closeTab(id,'local',row);
    }
    if((change.discarded===true||change.frozen===true)&&(current.discarded||current.frozen)){
      for(const row of rows)if(row.url===currentUrl)await service.observe({...row,status:'suspended',healthState:'',
        discarded:current.discarded,frozen:current.frozen,observedAt:Math.max(at,Number(row.observedAt||0))},row);
    }
  }
  chrome.tabs?.onUpdated?.addListener((id,change)=>{
    if(change.url||change.discarded===true||change.frozen===true)void reconcileTabChange(id,change).catch(lifecycleError);
  });
  chrome.notifications?.onClicked?.addListener((id)=>{if(String(id).startsWith('pc-attention:'))void service.focus(id);});
  chrome.notifications?.onButtonClicked?.addListener((id,index)=>{if(!String(id).startsWith('pc-attention:'))return;if(index===0)void service.focus(id);if(index===1)void service.snooze(id,10);});
  async function reconcileStartup() {
    const snapshot=await service.start();
    if(!chrome.tabs?.query)return;
    const tabs=await chrome.tabs.query({});
    const byId=new Map(tabs.map((tab)=>[tab.id,tab]));
    const local=snapshot.sessions.filter((row)=>row.sourceId==='local'&&row.status!=='closed');
    const ask=async(id,type)=>{
      let timer;
      try{return await Promise.race([chrome.tabs.sendMessage(id,{type},{frameId:0}),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),2500);})]);}
      catch{return null;}finally{if(timer)clearTimeout(timer);}
    };
    await Promise.allSettled(local.map(async(row)=>{
      const tab=byId.get(row.tabId);
      if(!tab||core.canonicalUrl(tab.url)!==row.url){await service.closeTab(row.tabId,'local',row);return;}
      if(tab.discarded||tab.frozen){await service.observe({...row,status:'suspended',healthState:'',observedAt:Math.max(Date.now(),Number(row.observedAt||0))},row);return;}
      const requestedAt=Date.now(),state=await ask(tab.id,'PC_GET_LIVE_SENTINEL_STATE');
      if(state?.ok&&state.source==='live-sentinel'&&state.version==='0.25.0'&&typeof state?.chat?.status==='string'&&state.chat.status&&core.canonicalUrl(state.chat.url)===row.url){
        const current=await chrome.tabs.get(tab.id).catch(()=>null);
        if(!current||current.discarded||current.frozen||core.canonicalUrl(current.url)!==row.url)return;
        await service.observe({sourceId:'local',tabId:tab.id,documentId:state.chat.id||row.url,
          runId:state.generation?.runId||'',url:row.url,title:state.chat.title||current.title||row.title,
          browser:row.browser,providerId:state.provider?.id||row.providerId,
          status:state.chat.status,healthState:state.chat.healthState||'',
          generation:state.generation,health:state.health,failure:state.failure,source:state.source,
          authoritative:true,suspended:false,observedAt:Number(state.observedAt)||requestedAt
        });
      } else await ask(tab.id,'PC_MONITOR_RESCAN');
      // Missing/unresponsive sensors remain explicitly offline until their next
      // genuine event. Firefox's minimal sensor publishes on the explicit rescan;
      // the full extension bootstrap owns hot reinjection. Neither needs polling.
    }));
  }
  void reconcileStartup().catch((error)=>console.warn('Constellation attention startup:',String(error?.message||error)));
})();
