// Browser transport only. The native Rust broker owns cross-browser state and routing.
(() => {
  'use strict';
  const api = globalThis.chrome;
  if (!api?.runtime || !globalThis.pcAttention) return;
  const HOST = 'com.project_constellation.monitor';
  const KEY = 'projectConstellationMonitorConnectionV1';
  const INSTANCE = 'projectConstellationMonitorInstanceV1';
  const RETRY = 'project-constellation-monitor-reconnect';
  const BACKOFF = [30000, 60000, 180000];
  const ALERT_DEFAULTS = Object.freeze({enabled:true,audioEnabled:true,notificationsEnabled:true,completionEnabled:false,volume:0.45,reminderMinutes:0,maxReminders:3,muteUntil:0});
  const browsers = new Set(['chrome','edge','opera_gx','firefox','chromium']);
  const pending = new Map();
  const localRows = new Map();
  const remoteSignatures = new Map();
  const mirrored = new Map();
  let config, instanceId, loading = null, port = null, connectWork = null, sequence = 0, retries = 0;
  let status = { connected:false, connecting:false, waitingForWindow:false, error:'', clientId:'', snapshot:null, lastConnectedAt:0, retryAt:0 };
  let connectionEpoch=0,windowQuery=0;
  let syncQueue = Promise.resolve();
  let appliedPolicy = '', deliveryOwner = null, syncFailure = '';
  const text = (value, max=240) => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g,' ').trim().slice(0,max);
  const uuid = () => crypto.randomUUID();
  const identity=(value)=>typeof value==='string'&&/^[A-Za-z0-9._@-]{1,80}$/.test(value)?value:uuid();
  const wireText=(value,max)=>{let out='',bytes=0;const encoder=new TextEncoder();for(const part of text(value,max)){const code=part.charCodeAt(0),ch=part.length===1&&code>=0xd800&&code<=0xdfff?'\ufffd':part;const n=encoder.encode(ch).length;if(bytes+n>max)break;out+=ch;bytes+=n;}return out;};
  function alertPatch(value,complete=false) {
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Alert settings must be an object.');
    const patch={};
    for(const [key,item] of Object.entries(value)){
      if(!Object.hasOwn(ALERT_DEFAULTS,key))throw new Error('Unsupported alert setting: '+key);
      if(typeof ALERT_DEFAULTS[key]==='boolean'){
        if(typeof item!=='boolean')throw new Error(key+' must be a boolean.');
      }else{
        const max=key==='volume'?1:key==='reminderMinutes'?120:key==='maxReminders'?10:Number.MAX_SAFE_INTEGER;
        if(typeof item!=='number'||!Number.isFinite(item)||item<0||item>max||(['maxReminders','muteUntil'].includes(key)&&!Number.isSafeInteger(item)))throw new Error('Invalid '+key+'.');
      }
      patch[key]=item;
    }
    if(complete&&Object.keys(ALERT_DEFAULTS).some(key=>!Object.hasOwn(patch,key)))throw new Error('The browser hub returned incomplete alert settings. Update the companion.');
    return complete?{...ALERT_DEFAULTS,...patch}:patch;
  }
  async function setDeliveryOwner(enabled,reason) {
    await globalThis.pcAttentionSetAudioOwner({enabled,reason});deliveryOwner=enabled;
  }
  function detectBrowser() {
    const ua = String(globalThis.navigator?.userAgent || '');
    if (/Firefox\//.test(ua)) return 'firefox';
    if (/Edg\//.test(ua)) return 'edge';
    if (/OPR\//.test(ua)) return 'opera_gx';
    return 'chrome';
  }
  function canonical(value) {
    try {const u=new URL(value);return u.protocol==='https:' ? u.origin+u.pathname : '';}catch{return '';}
  }
  function nativeStatus(row) {
    if (row.suspended || /^(closed|suspended|frozen|discarded|sensor-offline)$/.test(row.status)) return row.status==='closed'?'closed':'suspended';
    const value=row.kind||row.status;
    if (/^(permission_required|error|rate_limited|context_limit|waiting_for_user|completed|idle|no_visible_progress)$/.test(value)) return value;
    if (value==='auth_required') return 'waiting_for_user';
    if (/running|working|streaming|thinking|tool-quiet/.test(value)) return 'running';
    if (/stalled|dead/.test(value)) return 'no_visible_progress';
    if (/complete|finished/.test(value)) return 'completed';
    return 'idle';
  }
  async function load() {
    if(loading)return loading;
    if (config) return config;
    loading=(async()=>{
    const saved=(await api.storage.local.get(KEY))[KEY]||{};
    const browser=browsers.has(saved.browser)?saved.browser:detectBrowser();
    config={enabled:saved.enabled===true,browser,profileId:identity(saved.profileId),label:wireText(saved.label||'',80)};
    const session=api.storage.session;
    if(session){instanceId=identity((await session.get(INSTANCE))[INSTANCE]);await session.set({[INSTANCE]:instanceId});}
    else instanceId=uuid();
    await api.storage.local.set({[KEY]:config});
    return config;
    })().finally(()=>{loading=null;});return loading;
  }
  function announce() {
    const promise=api.runtime.sendMessage({type:'PC_MONITOR_CHANGED',revision:status.snapshot?.revision||0});
    promise?.catch?.(()=>{});
  }
  async function get() {
    await load();
    return {config:{...config},...status,host:HOST,retryAttempt:retries,standalone:true};
  }
  function request(op,fields={}) {
    if(!port)return Promise.reject(new Error('The browser hub is disconnected.'));
    const sourcePort=port;
    const id=`${Date.now().toString(36)}-${++sequence}`;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        pending.delete(id);const error=new Error(`The browser hub did not answer ${op}.`);reject(error);
        // A connected pipe is not proof of a responsive hub. Retire a hung
        // established connection, reject its other requests and use the same
        // bounded reconnect path as an actual disconnect. The hello setup
        // path owns its own failure cleanup; never retire a replacement port.
        if(status.connected&&port===sourcePort&&op!=='bye'){
          port=null;sourcePort.disconnect();void lost(error.message);
        }
      },8000);
      pending.set(id,{resolve,reject,timer});
      try{sourcePort.postMessage({v:1,id,op,...fields});}catch(error){clearTimeout(timer);pending.delete(id);reject(error);}
    });
  }
  async function observe(row) {
    if(row.sourceId && row.sourceId!=='local')return;
    const documentId=wireText(row.documentId||row.key,80);
    const event={tabId:Number(row.tabId),documentId,runId:wireText(row.runId,80),
      url:canonical(row.url),title:wireText(row.title,180),status:nativeStatus(row),reason:wireText(row.reason,240),observedAt:Number(row.observedAt)||Date.now()};
    const previous=localRows.get(event.tabId);
    if(previous && (event.observedAt<Number(previous.observedAt)||
      (event.status==='closed' && (documentId!==previous.wireDocumentId || event.runId!==wireText(previous.runId,80) || event.url!==canonical(previous.url)))))return;
    localRows.set(event.tabId,{...row,observedAt:event.observedAt,wireDocumentId:documentId});
    if(!status.connected)return;
    // Document closure is ordered evidence. Keep its context on the wire;
    // only the browser's authoritative tab-removed event uses unscoped remove.
    try{await request('observe',{event});}
    catch(error){status.error=text(error.message);announce();}
  }
  async function syncRemote(snapshot,sourcePort=port) {
    const current=()=>sourcePort&&sourcePort===port&&(!status.snapshot||Number(snapshot?.revision)>=Number(status.snapshot.revision));
    if(!current())return;
    if(!snapshot || !Array.isArray(snapshot.clients)||!Array.isArray(snapshot.sessions)||!Array.isArray(snapshot.incidents))return;
    if(snapshot.capabilities?.sharedAlertSettings!==true){
      await setDeliveryOwner(false,'browser-hub-policy-unavailable');
      throw new Error('Update the native companion: this version does not support shared alert settings.');
    }
    const policy=alertPatch(snapshot.alertSettings,true),policyToken=JSON.stringify(policy);
    const connected=snapshot.clients.filter(x=>x.connected).sort((a,b)=>a.clientId<b.clientId?-1:a.clientId>b.clientId?1:0);
    const owner=connected[0]?.clientId===status.clientId;
    let paused=false;
    const pause=async()=>{if(deliveryOwner!==false)await setDeliveryOwner(false,'browser-hub-sync');paused=true;};
    if(policyToken!==appliedPolicy||owner!==deliveryOwner)await pause();
    if(!current())return;
    let local=await globalThis.pcAttentionGet();
    if(!current())return;
    if(policyToken!==appliedPolicy||JSON.stringify(alertPatch(local.settings,true))!==policyToken){
      await pause();if(!current())return;
      await globalThis.pcAttention.settings(policy);
      if(!current())return;
      appliedPolicy=policyToken;
    }
    const sessionFor=item=>{
      if(item.resolvedAt||!item.documentId||!item.url)return null;
      const session=snapshot.sessions.find(x=>x.sessionId===item.sessionId);
      return session&&session.documentId===item.documentId&&canonical(session.url)===canonical(item.url)&&
        (item.runId===undefined||session.runId===item.runId)?session:null;
    };
    const targetFor=(item,session,attention)=>attention.incidents.find(x=>
      x.sourceId===(session.clientId===status.clientId?'local':'native:'+session.clientId)&&x.tabId===session.tabId&&x.kind===item.kind&&!x.resolvedAt&&
      wireText(x.documentId,80)===item.documentId&&wireText(x.runId,80)===(item.runId||'')&&canonical(x.url)===canonical(item.url));
    const signature=row=>JSON.stringify([row.status,row.connected,row.documentId,row.runId,row.url,row.title,row.reason,row.observedAt]);
    const token=item=>JSON.stringify([item.acknowledgedAt,item.snoozedUntil,item.resolvedAt]);
    // Stage only an actual policy/owner transition or an unsynced suppression.
    // Ordinary running snapshots leave the owner's absolute reminder alarm alone.
    if(!paused&&snapshot.incidents.some(item=>{
      const session=sessionFor(item);
      return session&&(item.acknowledgedAt||item.snoozedUntil)&&mirrored.get(item.incidentId)!==token(item)&&
        (targetFor(item,session,local)||(session.clientId!==status.clientId&&remoteSignatures.get(session.sessionId)!==signature(session)));
    }))await pause();
    if(!current())return;
    for(const row of snapshot.sessions){
      if(!current())return;
      if(row.clientId===status.clientId)continue;
      const value=signature(row);
      if(remoteSignatures.get(row.sessionId)===value)continue;
      const imported=await globalThis.pcAttentionObserve({sourceId:'native:'+row.clientId,tabId:row.tabId,documentId:row.documentId,runId:row.runId,
        url:row.url,title:row.title,browser:row.browser,status:row.connected?row.status:'sensor-offline',reason:row.reason,
        observedAt:row.observedAt,authoritative:row.connected});
      if(imported?.ok===false)throw new Error(imported.error||'Could not import the browser observation.');
      // Failed imports must remain retryable on the next authoritative
      // snapshot. Do not cache success before storage has accepted the row.
      if(current())remoteSignatures.set(row.sessionId,value);
    }
    local=await globalThis.pcAttentionGet();
    if(!current())return;
    for(const row of local.sessions.filter(x=>x.sourceId.startsWith('native:')&&x.status!=='closed')){
      if(!current())return;
      const sessionId=row.sourceId.slice(7)+':'+row.tabId;
      if(!snapshot.sessions.some(x=>x.sessionId===sessionId)){
        await globalThis.pcAttention.closeTab(row.tabId,row.sourceId);remoteSignatures.delete(sessionId);
      }
    }
    for(const item of snapshot.incidents){
      if(!current())return;
      const value=token(item);
      if(mirrored.get(item.incidentId)===value)continue;
      const session=sessionFor(item);
      if(!session)continue;
      const target=targetFor(item,session,local);
      if(!target)continue;
      if(item.acknowledgedAt||item.snoozedUntil){
        const result=await globalThis.pcAttention.applyIncidentState(target.id,{acknowledgedAt:Number(item.acknowledgedAt)||0,snoozedUntil:Number(item.snoozedUntil)||0});
        if(result?.ok===false)throw new Error(result.error||'Could not apply the shared incident state.');
      }
      mirrored.set(item.incidentId,value);
    }
    if(!current())return;
    if(paused||deliveryOwner!==owner)await setDeliveryOwner(owner,owner?'browser-hub-alert-owner':'another-browser-owns-alerts');
    if(status.error===syncFailure)status.error='';
    syncFailure='';
  }
  async function focusOwned(data) {
    const row=localRows.get(Number(data?.tabId));
    if(!row || row.wireDocumentId!==data.documentId || data.sessionId!==status.clientId+':'+data.tabId || /^(closed|suspended)$/.test(nativeStatus(row)))throw new Error('This chat changed since it was observed. Refresh the monitor.');
    const tab=await api.tabs.get(Number(data.tabId));
    if(canonical(tab.url)!==canonical(row.url))throw new Error('The observed chat is no longer open in this tab.');
    await api.tabs.update(tab.id,{active:true});
    if(Number.isInteger(tab.windowId))await api.windows.update(tab.windowId,{focused:true});
    if(nativeStatus(row)==='permission_required')await api.tabs.sendMessage(tab.id,{type:'PC_ATTENTION_REVEAL_PERMISSION'}).catch(()=>{});
  }
  function onMessage(message,sourcePort) {
    if(message?.v!==1||sourcePort!==port)return;
    if(message.id && pending.has(message.id)){
      const entry=pending.get(message.id);pending.delete(message.id);clearTimeout(entry.timer);
      if(message.ok===false)entry.reject(new Error(text(message.error?.message||message.error||'Browser hub rejected the request.')));
      else entry.resolve(message.data||{});
    }
    if(message.kind==='snapshot' && message.data){
      if(status.snapshot && Number(message.data.revision)<Number(status.snapshot.revision))return;
      if(message.data.clientId)status.clientId=message.data.clientId;
      status.snapshot=message.data;
      syncQueue=syncQueue.then(()=>syncRemote(message.data,sourcePort)).catch(error=>{if(sourcePort===port){syncFailure=text(error.message);status.error=syncFailure;announce();}});
      announce();
    }
    if(message.kind==='focus')void focusOwned(message.data).catch(error=>{status.error=text(error.message);announce();});
  }
  async function lost(error='') {
    port=null;status.connected=false;status.connecting=false;status.error=status.waitingForWindow?'':text(error||'The native browser hub disconnected.');
    for(const value of pending.values()){clearTimeout(value.timer);value.reject(new Error(status.error));}pending.clear();
    await setDeliveryOwner(false,'standalone-reconcile');
    if(port)return;
    if(status.snapshot){status.snapshot={...status.snapshot,clients:status.snapshot.clients.map(x=>({...x,connected:false})),sessions:status.snapshot.sessions.map(x=>({...x,connected:false}))};}
    const local=await globalThis.pcAttentionGet();
    if(port)return;
    for(const row of local.sessions.filter(x=>x.sourceId.startsWith('native:')&&!x.suspended)){
      if(port)return;
      // Transport loss changes availability, not the source observation time.
      // Advancing that watermark here would reject the unchanged live row on
      // reconnect and cache the ignored import as if coverage were restored.
      await globalThis.pcAttentionObserve({...row,status:'sensor-offline',healthState:'',authoritative:false});
    }
    if(port)return;
    await setDeliveryOwner(!status.waitingForWindow,status.waitingForWindow?'browser-windows-closed':'standalone-fallback');
    if(config?.enabled&&!status.waitingForWindow&&retries<BACKOFF.length&&!(status.retryAt>Date.now())){status.retryAt=Date.now()+BACKOFF[retries++];await api.alarms.create(RETRY,{when:status.retryAt});}
    announce();
  }
  async function suspendForWindows() {
    if(!status.waitingForWindow){status.waitingForWindow=true;connectionEpoch++;}
    // Close immediately, including an unfinished hello. Awaiting bye here can
    // leave a background-mode browser holding the hub after its last window.
    const previous=port;port=null;previous?.disconnect();
    const reconcile=lost('');
    status.retryAt=0;retries=0;
    await api.alarms.clear(RETRY);
    await reconcile;
    status.error='';announce();
  }
  async function refreshWindows(reconnect=false) {
    // Chrome, Edge, Opera and Firefox share this bridge. The windows API is
    // event-driven; hidden background pages and offscreen audio are not normal
    // browser windows and do not keep the native transport alive.
    if(!api.windows?.getAll)return true;
    const query=++windowQuery;
    const windows=await api.windows.getAll({windowTypes:['normal']});
    if(query!==windowQuery)return !status.waitingForWindow;
    if(!windows.some(window=>window.type==='normal')){
      await suspendForWindows();return false;
    }
    const resumed=status.waitingForWindow;
    status.waitingForWindow=false;
    if(resumed){
      announce();
      if(reconnect&&config?.enabled)void connect().catch(()=>{});
    }
    return true;
  }
  async function connect(manual=false) {
    await load();
    if(manual){retries=0;config.enabled=true;await api.storage.local.set({[KEY]:config});}
    if(!config.enabled)return get();
    if(!await refreshWindows())return get();
    if(status.connected)return get();
    if(connectWork)return connectWork;
    const epoch=connectionEpoch;
    const current=()=>epoch===connectionEpoch&&config.enabled&&!status.waitingForWindow;
    connectWork=(async()=>{
      if(!current())return get();
      if(!await api.permissions.contains({permissions:['nativeMessaging']}))throw new Error('Connect browser hub to grant its native messaging permission.');
      if(!api.runtime.connectNative)throw new Error('Native messaging is unavailable in this browser.');
      if(!current())return get();
      status.connecting=true;status.error='';status.retryAt=0;announce();
      status.snapshot=null;status.clientId='';remoteSignatures.clear();mirrored.clear();appliedPolicy='';syncFailure='';
      await setDeliveryOwner(false,'browser-hub-connecting');
      const preferences=await globalThis.pcAttentionGet();
      if(!current())return get();
      const initialSettings=alertPatch(preferences.settings,true);
      const activePort=api.runtime.connectNative(HOST);port=activePort;
      activePort.onMessage.addListener(message=>onMessage(message,activePort));
      activePort.onDisconnect.addListener(()=>{
        const error=api.runtime.lastError?.message||'';
        if(port===activePort)void lost(error);
      });
      const snapshot=await request('hello',{client:{browser:config.browser,profileId:config.profileId,instanceId,label:config.label||config.browser},alertSettings:initialSettings});
      if(port!==activePort)throw new Error('The browser hub disconnected during setup.');
      status.connected=true;status.connecting=false;status.clientId=snapshot.clientId||status.clientId;status.lastConnectedAt=Date.now();status.retryAt=0;
      await api.alarms.clear(RETRY);retries=0;
      if(!current()||port!==activePort)return get();
      if(!status.snapshot||Number(snapshot.revision)>=Number(status.snapshot.revision))status.snapshot=snapshot;
      await syncQueue;
      if(!current()||port!==activePort)return get();
      if(syncFailure)throw new Error(syncFailure);
      const local=await globalThis.pcAttentionGet();
      if(!current()||port!==activePort)return get();
      for(const row of local.sessions.filter(x=>x.sourceId==='local'&&x.status!=='closed'))await observe(row);
      announce();return get();
    })().catch(async error=>{
      if(!current())return get();
      if(port){const old=port;port=null;old.disconnect();}
      await lost(error.message);throw error;
    }).finally(()=>{
      connectWork=null;
      // A window may reopen while the cancelled setup was awaiting storage.
      // Resume exactly once when that old operation has fully unwound.
      if(epoch!==connectionEpoch&&config.enabled&&!status.waitingForWindow)void connect().catch(()=>{});
    });
    return connectWork;
  }
  async function disconnect() {
    await load();config.enabled=false;connectionEpoch++;await api.storage.local.set({[KEY]:config});await api.alarms.clear(RETRY);
    if(port){try{await request('bye');}catch{}const old=port;port=null;old?.disconnect();}
    await lost('');status.error='';status.retryAt=0;announce();return get();
  }
  async function settings(patch) {
    await load();
    if(patch.browser!==undefined&&!browsers.has(patch.browser))throw new Error('Choose a supported browser.');
    const reconnect=config.enabled;
    if(status.connected)await disconnect();
    config={...config,browser:patch.browser||config.browser,label:wireText(patch.label??config.label,80),enabled:reconnect};
    await api.storage.local.set({[KEY]:config});
    if(reconnect)await connect(true);
    announce();return get();
  }
  async function sharedAlertSettings(patch) {
    if(!status.connected)throw new Error('Connect the browser hub before changing shared alert settings.');
    const sourcePort=port;
    await request('alert_settings',{settings:alertPatch(patch),initializeOnly:false});
    await syncQueue;
    if(sourcePort!==port)throw new Error('The browser hub disconnected while applying alert settings.');
    if(syncFailure)throw new Error(syncFailure);
    return get();
  }
  async function refresh() {
    if(status.connected)await request('snapshot');
    const providers=globalThis.ProjectConstellationProviders;
    const tabs=(await api.tabs.query({})).filter(tab=>providers?.detectProvider(tab.url));
    const result={total:tabs.length,observed:0,rescanRequested:0,suspended:0,unavailable:0,at:Date.now()};
    const ask=async(tabId,type)=>{
      let timer;
      try{return await Promise.race([api.tabs.sendMessage(tabId,{type}),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),2500);})]);}
      catch{return null;}finally{if(timer)clearTimeout(timer);}
    };
    await Promise.all(tabs.map(async tab=>{
      try{
        if(tab.discarded||tab.frozen){result.suspended++;return;}
        const state=await ask(tab.id,'PC_GET_LIVE_SENTINEL_STATE');
        if(state?.ok&&state.source==='live-sentinel'&&state.version==='0.24.0'&&canonical(state.chat?.url)===canonical(tab.url)){
          const current=await api.tabs.get(tab.id);
          if(current.discarded||current.frozen){result.suspended++;return;}
          if(canonical(current.url)!==canonical(tab.url)){result.unavailable++;return;}
          await globalThis.pcAttentionObserve({sourceId:'local',tabId:tab.id,
            documentId:state.chat.id||canonical(tab.url),url:canonical(tab.url),title:state.chat.title||current.title||'',
            providerId:state.provider?.id||providers.detectProvider(tab.url)?.id||'',
            status:state.chat.status||'idle',healthState:state.chat.healthState||'',
            generation:state.generation,health:state.health,failure:state.failure,source:state.source,
            authoritative:true,suspended:false,observedAt:Number(state.observedAt)||Date.now()});
          result.observed++;return;
        }
        const response=await ask(tab.id,'PC_MONITOR_RESCAN');
        if(response?.ok)result.rescanRequested++;else result.unavailable++;
      }catch{result.unavailable++;}
    }));
    return {...await get(),refresh:result};
  }
  globalThis.pcNativeMonitor=Object.freeze({get,connect,disconnect,observe,focus:(sessionId)=>request('focus',{sessionId}),request});
  globalThis.pcAttentionSubscribe(event=>{if(event.session?.sourceId==='local')void observe(event.session);announce();});
  api.runtime.onMessage.addListener((message,sender,respond)=>{
    if(!/^PC_MONITOR_/.test(String(message?.type||''))||message.type==='PC_MONITOR_CHANGED'||message.type==='PC_MONITOR_RESCAN')return false;
    const ui=sender?.id===api.runtime.id && String(sender.url||'').startsWith(api.runtime.getURL(''));
    if(!ui){respond({ok:false,error:'Browser hub controls require the extension dashboard.'});return false;}
    let work;
    switch(message.type){
      case 'PC_MONITOR_GET':work=get();break;
      case 'PC_MONITOR_CONNECT':work=connect(true);break;
      case 'PC_MONITOR_DISCONNECT':work=disconnect();break;
      case 'PC_MONITOR_SETTINGS':work=settings(message.settings||{});break;
      case 'PC_MONITOR_ALERT_SETTINGS':work=sharedAlertSettings(message.settings);break;
      case 'PC_MONITOR_FOCUS':work=request('focus',{sessionId:text(message.sessionId,300)});break;
      case 'PC_MONITOR_ACK':work=request('ack',{incidentId:text(message.id,300)});break;
      case 'PC_MONITOR_SNOOZE':work=request('snooze',{incidentId:text(message.id,300),durationMs:Math.max(60000,Math.min(86400000,Number(message.minutes||10)*60000))});break;
      case 'PC_MONITOR_REFRESH':work=refresh();break;
      default:return false;
    }
    Promise.resolve(work).then(monitor=>respond({ok:true,monitor})).catch(error=>respond({ok:false,error:text(error.message)}));return true;
  });
  api.alarms.onAlarm.addListener(alarm=>{if(alarm.name===RETRY&&config?.enabled)void connect().catch(()=>{});});
  const windowChanged=()=>{void refreshWindows(true).catch(error=>{status.error=text(error.message);announce();});};
  api.windows?.onCreated?.addListener(windowChanged);
  api.windows?.onRemoved?.addListener(windowChanged);
  api.tabs.onRemoved.addListener(id=>{localRows.delete(id);if(status.connected)void request('remove',{tabId:id}).catch(()=>{});});
  api.tabs.onUpdated.addListener((id,change)=>{
    const row=localRows.get(id);
    if(!row)return;
    const navigation=change.url&&canonical(change.url)!==canonical(row.url);
    const unavailable=change.discarded===true||change.frozen===true;
    if(!navigation&&!unavailable)return;
    // Browser lifecycle callbacks and the tab lookup may both arrive after
    // a newer observation. Verify the actual tab and captured row before
    // closing or suspending that exact document.
    void api.tabs.get(id).then(current=>{
      if(localRows.get(id)!==row)return;
      const observedAt=Math.max(Date.now(),Number(row.observedAt)||0);
      if(navigation){
        if(canonical(current.url)!==canonical(change.url))return;
        return observe({...row,status:'closed',observedAt});
      }
      if(canonical(current.url)!==canonical(row.url)||(!current.discarded&&!current.frozen))return;
      return observe({...row,status:'suspended',suspended:true,observedAt});
    }).catch(()=>{});
  });
  void load().then(()=>connect()).catch(error=>{status.error=text(error.message);announce();});
})();
