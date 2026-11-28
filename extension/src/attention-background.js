import './attention-service.js';
import './attention-audio.js';

(() => {
  'use strict';
  const core = globalThis.ProjectConstellationAttentionService;
  if (!core || !globalThis.chrome?.runtime) return;
  let offscreenCreating = null;
  async function ensureAudioSurface() {
    const url = chrome.runtime.getURL('offscreen.html');
    if (chrome.runtime.getContexts) {
      const contexts = await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[url]});
      if (contexts.length) return;
    }
    if (!chrome.offscreen?.createDocument) throw new Error('This browser needs the companion sensor audio surface.');
    if (!offscreenCreating) offscreenCreating = chrome.offscreen.createDocument({url:'offscreen.html',
      reasons:['DOM_PARSER','AUDIO_PLAYBACK'],justification:'Play configured agent attention alerts and parse provider metadata.'
    }).catch(async (error) => {
      // The existing parser/guardian may create the same single offscreen document
      // concurrently. Accept only a verified document, never swallow a real failure.
      const contexts = await chrome.runtime.getContexts?.({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[url]}) || [];
      if (!contexts.length) throw error;
    }).finally(()=>{offscreenCreating=null;});
    await offscreenCreating;
  }
  async function playSound(options) {
    if(typeof document!=='undefined' && (globalThis.AudioContext||globalThis.webkitAudioContext))return globalThis.pcAttentionPlayAudio({...options,backend:'background-web-audio'});
    for(let attempt=0;attempt<2;attempt++) {
      await ensureAudioSurface();
      let result,timer;
      try {
        result=await Promise.race([
          chrome.runtime.sendMessage({type:'PC_ATTENTION_AUDIO_PLAY',target:'pc-attention-audio',...options}),
          new Promise((resolve)=>{timer=setTimeout(()=>resolve({ok:false,error:'The audio surface did not respond within four seconds.'}),4000);})
        ]);
      } catch(error) {result={ok:false,error:String(error?.message||error)};}
      finally {if(timer)clearTimeout(timer);}
      if(result?.ok===true&&result.started===true)return result;
      // Chrome may close a silent AUDIO_PLAYBACK document between discovery and
      // messaging. Recreate once only when it is gone; never keep it alive with
      // inaudible loops or retry an acknowledged playback/blocked audio context.
      const contexts=await chrome.runtime.getContexts?.({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[chrome.runtime.getURL('offscreen.html')]})||[];
      if(attempt===0&&!contexts.length)continue;
      return {ok:false,error:String(result?.error||'The audio surface did not confirm that playback started.')};
    }
    return {ok:false,error:'The audio surface is unavailable.'};
  }
  const service=core.createService({
    read:async(key)=>(await chrome.storage.local.get(key))[key],
    write:async(key,value)=>chrome.storage.local.set({[key]:value}),
    alarm:async(name,when)=>chrome.alarms.create(name,{when}),
    clearAlarm:async(name)=>chrome.alarms.clear(name),
    notify:async(item)=>{
      if (!chrome.notifications?.create) return {ok:false,error:'Browser notifications are unavailable.'};
      if (chrome.notifications.getPermissionLevel) {
        const level=await chrome.notifications.getPermissionLevel();
        if (level==='denied') return {ok:false,error:'Browser notification permission is denied. Enable it in browser settings.'};
      }
      const options={type:'basic',iconUrl:chrome.runtime.getURL('assets/attention-icon.png'),
        title:item.label,message:`${item.title}${item.reason ? ' · '+item.reason : ''}`.slice(0,320),
        contextMessage:'Project Constellation · '+item.browser,priority:item.severity==='critical'?2:1,
        requireInteraction:item.severity==='critical',silent:true,
        buttons:[{title:'Review chat'},{title:'Snooze 10 min'}]};
      if(item.kind==='test')delete options.buttons;
      try { await chrome.notifications.create(item.id,options); }
      catch (error) {
        // Firefox and some platform notification backends reject action buttons.
        const fallback={...options};delete fallback.buttons;delete fallback.requireInteraction;
        await chrome.notifications.create(item.id,fallback);
      }
      return {ok:true};
    },
    clearNotification:async(id)=>{await chrome.notifications?.clear?.(id);},
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
  chrome.tabs?.onRemoved?.addListener((id)=>{void service.closeTab(id);});
  chrome.tabs?.onUpdated?.addListener((id,change,tab)=>{
    if(change.url)void service.get().then((snapshot)=>{if(snapshot.sessions.some((row)=>row.sourceId==='local'&&row.tabId===id&&row.status!=='closed'&&row.url!==core.canonicalUrl(change.url)))return service.closeTab(id);});
    if(change.discarded===true||change.frozen===true) void service.get().then((snapshot)=>{
      const previous=snapshot.sessions.find((x)=>x.tabId===id&&x.sourceId==='local'&&x.status!=='closed');
      if(previous) return service.observe({...previous,url:tab.url||previous.url,discarded:change.discarded,frozen:change.frozen,observedAt:Date.now()});
    });
  });
  chrome.notifications?.onClicked?.addListener((id)=>{if(String(id).startsWith('pc-attention:'))void service.focus(id);});
  chrome.notifications?.onButtonClicked?.addListener((id,index)=>{if(!String(id).startsWith('pc-attention:'))return;if(index===0)void service.focus(id);if(index===1)void service.snooze(id,10);});
  async function reconcileStartup() {
    const snapshot=await service.start();
    if(!chrome.tabs?.query)return;
    const tabs=await chrome.tabs.query({});
    const byId=new Map(tabs.map((tab)=>[tab.id,tab]));
    const local=snapshot.sessions.filter((row)=>row.sourceId==='local'&&row.status!=='closed');
    await Promise.allSettled(local.map(async(row)=>{
      const tab=byId.get(row.tabId);
      if(!tab||core.canonicalUrl(tab.url)!==row.url){await service.closeTab(row.tabId);return;}
      if(tab.discarded||tab.frozen){await service.observe({...row,status:'suspended',observedAt:Date.now()});return;}
      const state=await chrome.tabs.sendMessage(tab.id,{type:'PC_GET_LIVE_SENTINEL_STATE'}).catch(()=>null);
      if(state?.ok&&state.source==='live-sentinel'&&state.version==='0.22.0'&&typeof state?.chat?.status==='string'&&state.chat.status)await service.observe({
        ...row,status:state.chat?.status||'idle',healthState:state.chat?.healthState||'',
        generation:state.generation,health:state.health,failure:state.failure,source:state.source,
        authoritative:true,suspended:false,observedAt:Date.now()
      });
      else await chrome.tabs.sendMessage(tab.id,{type:'PC_MONITOR_RESCAN'}).catch(()=>null);
      // Missing/unresponsive sensors remain explicitly offline until their next
      // genuine event. Firefox's minimal sensor publishes on the explicit rescan;
      // the full extension bootstrap owns hot reinjection. Neither needs polling.
    }));
  }
  void reconcileStartup().catch((error)=>console.warn('Constellation attention startup:',String(error?.message||error)));
})();
