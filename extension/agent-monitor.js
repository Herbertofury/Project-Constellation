(() => {
  'use strict';
  const api=globalThis.browser||globalThis.chrome;
  const $ = id => document.getElementById(id);
  const BROWSERS = {chrome:'Chrome',firefox:'Firefox',opera_gx:'Opera GX',edge:'Edge',chromium:'Chromium'};
  const ISSUE = {permission_required:'Approval needed',error:'Needs attention',rate_limited:'Rate limited',context_limit:'Conversation limit',waiting_for_user:'Your input needed',auth_required:'Sign-in needed',no_visible_progress:'No visible progress',completed:'Completed'};
  const ACTIVE = new Set(['running','working','tool-running','quiet-working','uncertain-working','thinking','streaming']);
  const ATTENTION = new Set(Object.keys(ISSUE).filter(x=>x!=='completed'));
  const UNAVAILABLE = new Set(['closed','suspended','discarded','frozen','sensor-offline','reconnecting']);
  let state={attention:null,monitor:null},filter='all',resolved=false,reloadQueued=false,reloadWork=null,toastTimer;
  const node=(tag,className,content)=>{const el=document.createElement(tag);if(className)el.className=className;if(content!==undefined)el.textContent=content;return el;};
  const icon=(name,className='')=>{const el=node('span',`ui-icon icon-${name} ${className}`);el.setAttribute('aria-hidden','true');return el;};
  const age=at=>{if(!at)return 'Not observed';const seconds=Math.max(0,Math.floor((Date.now()-at)/1000));return seconds<10?'Just now':seconds<60?`${seconds}s ago`:seconds<3600?`${Math.floor(seconds/60)}m ago`:seconds<86400?`${Math.floor(seconds/3600)}h ago`:`${Math.floor(seconds/86400)}d ago`;};
  const browserName=value=>BROWSERS[value]||value||'This browser';
  function tell(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('toast').hidden=true;},5500);}
  function testSummary(test){return `${test.ok?'Sound and notification accepted by this browser.':test.error||test.audio?.error||test.notification?.error||'Check sound and notification permissions.'}${test.settingsNotice?' '+test.settingsNotice:''}`;}
  async function send(type,fields={}){
    if(!api?.runtime?.sendMessage)throw new Error('Open Agent Monitor from the installed Constellation extension.');
    const result=await api.runtime.sendMessage({type,...fields});
    if(!result?.ok)throw new Error(typeof result?.error==='string'?result.error:result?.error?.message||'The monitor did not answer. Reload the extension and try again.');
    return result;
  }
  function currentBrowser(){return state.monitor?.config?.browser||'chrome';}
  function normalizeSession(row,source){
    return {...row,id:row.sessionId||row.key,source,browser:source==='native'?row.browser:currentBrowser(),
      title:String(row.title||'Untitled chat'),url:String(row.url||''),
      status:String(row.kind||row.status||'unknown'),rawStatus:row.status,connected:row.connected!==false&&!row.suspended&&!UNAVAILABLE.has(row.status),
      updatedAt:Number(row.observedAt||row.updatedAt)||0,profile:row.profileLabel||'',reason:row.reason||''};
  }
  function sessions(){
    const local=(state.attention?.sessions||[]).filter(x=>x.sourceId==='local'&&x.status!=='closed');
    const monitor=state.monitor;
    if(!monitor?.connected)return local.map(x=>normalizeSession(x,'local'));
    const remote=(monitor.snapshot?.sessions||[]).filter(x=>x.status!=='closed').map(x=>normalizeSession(x,'native'));
    const clients=monitor.snapshot?.clients||[];
    for(const row of remote)row.profile=clients.find(x=>x.clientId===row.clientId)?.label||'';
    for(const row of local){if(!remote.some(x=>x.clientId===monitor.clientId&&x.tabId===row.tabId&&x.url===row.url))remote.push(normalizeSession(row,'local'));}
    return remote;
  }
  function incidents(){
    if(state.monitor?.connected){
      const rows=sessions();
      const native=(state.monitor.snapshot?.incidents||[]).map(x=>{
        const session=rows.find(s=>s.id===x.sessionId);
        const sameDocument=Boolean(session&&x.documentId&&x.url)&&x.documentId===session.documentId&&x.url===session.url&&(!x.runId||x.runId===session.runId);
        const client=state.monitor.snapshot?.clients?.find(row=>row.clientId===x.clientId);
        return {...x,id:x.incidentId,source:'native',title:x.title||(sameDocument?session.title:'Agent chat (identity unavailable)'),url:x.url||'',
          browser:x.browser||client?.browser,profile:client?.label||'',tabId:sameDocument?session.tabId:undefined,
          connected:sameDocument&&session.connected!==false,reason:x.reason||'',lastSeenAt:x.updatedAt,
          label:ISSUE[x.kind]||x.kind,severity:['permission_required','error','context_limit'].includes(x.kind)?'critical':'warning'};
      });
      // Include newly observed local problems until the native transport acknowledges them.
      for(const item of (state.attention?.incidents||[]).filter(x=>x.sourceId==='local')){
        const sameSource=x=>x.clientId===state.monitor.clientId&&x.sessionId===state.monitor.clientId+':'+item.tabId&&x.url===item.url&&x.kind===item.kind&&Boolean(x.documentId&&item.documentId)&&x.documentId===item.documentId&&(!(x.runId||item.runId)||x.runId===item.runId);
        if(!native.some(x=>sameSource(x)&&x.resolvedAt===item.resolvedAt)){
          const matched=native.some(x=>sameSource(x)&&!x.resolvedAt&&!item.resolvedAt);
          if(!matched)native.push({...item,source:'local',browser:currentBrowser()});
        }
      }
      return native;
    }
    return (state.attention?.incidents||[]).filter(x=>x.sourceId==='local').map(x=>({...x,source:'local',browser:currentBrowser(),connected:!x.suspended&&!x.sourceClosed}));
  }
  function activeIncident(item){return !item.resolvedAt&&!item.sourceClosed&&item.kind!=='completed';}
  function statusClass(row){return !row.connected?'':ATTENTION.has(row.status)?(['rate_limited','waiting_for_user','no_visible_progress'].includes(row.status)?'warning':'danger'):ACTIVE.has(row.status)?'active':row.status==='completed'?'good':'';}
  function statusLabel(row){return !row.connected?'Unavailable':ISSUE[row.status]||(ACTIVE.has(row.status)?'Working':row.status==='suspended'?'Suspended':row.status==='idle'?'Idle':row.status.replaceAll('-',' '));}
  function button(label,cls,action){const el=node('button',cls,label);el.type='button';el.addEventListener('click',action);return el;}
  async function runAction(action,success){try{await action();if(success)tell(success);await reload();}catch(error){tell(error.message);await reload();}}
  async function focus(item){
    if(item.source==='native')return send('PC_MONITOR_FOCUS',{sessionId:item.sessionId||item.id});
    return send('PC_ATTENTION_FOCUS',{id:item.id});
  }
  function renderIncidents(items){
    const visible=items.filter(x=>resolved||activeIncident(x)).sort((a,b)=>Number(Boolean(a.resolvedAt))-Number(Boolean(b.resolvedAt))||Number(Boolean(a.acknowledgedAt))-Number(Boolean(b.acknowledgedAt))||b.firstSeenAt-a.firstSeenAt);
    $('inboxCount').textContent=items.filter(activeIncident).length;
    const target=$('incidentList');target.replaceChildren();
    if(!visible.length){
      const empty=node('div','empty-state');empty.append(icon('check','empty-icon'),node('h3','',sessions().length?'Nothing needs your attention':'Ready when your agents are'));
      empty.append(node('p','',sessions().length?'No current problem has been reported by connected sensors. Unavailable tabs are shown separately below.':'Open a supported chat in this browser. Constellation will show observed activity and raise an alert when the chat needs you.'));
      target.append(empty);return;
    }
    for(const item of visible){
      const card=node('article',`incident ${item.severity!=='critical'?'warning':''} ${item.resolvedAt?'resolved':item.acknowledgedAt?'acknowledged':''}`);
      const top=node('div','incident-top');top.append(item.kind==='permission_required'?icon('open','incident-icon'):item.resolvedAt?icon('check','incident-icon'):node('span','incident-icon','!'));
      const copy=node('div','incident-copy'),heading=node('h3','',item.title||'Agent chat');heading.append(node('span','issue-label',item.resolvedAt?'Resolved':item.label||ISSUE[item.kind]||'Needs attention'));copy.append(heading,node('p','',item.reason||'Open this chat to inspect the current provider state.'));
      const meta=node('div','incident-meta');meta.append(node('span','',browserName(item.browser)));
      for(const value of [item.profile,item.acknowledgedAt?'Acknowledged':item.snoozedUntil>Date.now()?`Snoozed until ${new Date(item.snoozedUntil).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`:'',item.connected===false?'Source unavailable':''].filter(Boolean)){meta.append(node('span','meta-dot'),node('span','',value));}
      copy.append(meta);top.append(copy,node('span','incident-age',age(item.firstSeenAt)));card.append(top);
      if(!item.resolvedAt){const actions=node('div','incident-actions');const open=button(item.kind==='permission_required'?'Review permission':'Open chat','button quiet',()=>runAction(()=>focus(item)));open.append(icon('open'));open.disabled=item.connected===false||item.sourceClosed;actions.append(open);
        if(!item.acknowledgedAt)actions.append(button('Acknowledge','text-button',()=>runAction(()=>send(item.source==='native'?'PC_MONITOR_ACK':'PC_ATTENTION_ACK',{id:item.id}),'Incident acknowledged.')));
        actions.append(button('Snooze 10 min','text-button',()=>runAction(()=>send(item.source==='native'?'PC_MONITOR_SNOOZE':'PC_ATTENTION_SNOOZE',{id:item.id,minutes:10}),'Alert snoozed for 10 minutes.')));card.append(actions);}
      target.append(card);
    }
  }
  function providerLabel(url){try{const h=new URL(url).hostname;return h.includes('chatgpt')||h==='chat.openai.com'?'ChatGPT':h.includes('claude')?'Claude':h.includes('gemini')?'Gemini':h.includes('grok')?'Grok':h.replace(/^www\./,'');}catch{return 'Agent';}}
  function renderSessions(rows){
    const query=$('searchAgents').value.trim().toLowerCase(),browser=$('browserFilter').value;
    const selected=rows.filter(row=>(browser==='all'||row.browser===browser)&&(!query||[row.title,row.reason,row.status,browserName(row.browser),row.profile,providerLabel(row.url)].join(' ').toLowerCase().includes(query))&&
      (filter==='all'||filter==='attention'&&ATTENTION.has(row.status)||filter==='running'&&row.connected&&ACTIVE.has(row.status)||filter==='completed'&&row.status==='completed'||filter==='unavailable'&&(!row.connected||row.status==='suspended')));
    const order=$('sortOrder').value;
    selected.sort((a,b)=>order==='title'?a.title.localeCompare(b.title):order==='recent'?b.updatedAt-a.updatedAt:Number(ATTENTION.has(b.status))-Number(ATTENTION.has(a.status))||b.updatedAt-a.updatedAt);
    const list=$('sessionList');list.replaceChildren();
    if(!selected.length){const empty=node('div','empty-state');empty.append(node('h3','',rows.length?'No chats match this view':'No chat observations yet'),node('p','',rows.length?'Try a different filter or search.':'Keep a supported chat open and refresh once. Disconnected browsers need their sensor connected before their chats can appear.'));list.append(empty);return;}
    for(const row of selected){
      const el=node('article','session'),main=node('div','session-main'),provider=providerLabel(row.url),copy=node('div','session-copy');
      main.append(provider==='ChatGPT'?icon('star','provider-icon'):node('span','provider-icon',provider.slice(0,1)));const title=node('span','session-title',row.title||'Untitled chat');title.title=row.title;copy.append(title,node('div','session-subtitle',`${provider} · ${row.profile||browserName(row.browser)}`));main.append(copy);el.append(main);
      const status=node('span',`session-status ${statusClass(row)}`,statusLabel(row));status.title=row.reason||statusLabel(row);el.append(status,node('span','session-time',age(row.updatedAt)));
      const open=button('','open-session',()=>runAction(()=>focus(row)));open.append(icon('open'));open.setAttribute('aria-label',`Open ${row.title||'chat'} in ${browserName(row.browser)}`);open.disabled=!row.connected;el.append(open);list.append(el);
    }
    $('activityHint').textContent=`${selected.length} of ${rows.length} observed chats · updates arrive when activity changes`;
  }
  function renderCoverage(rows){
    const monitor=state.monitor,own=currentBrowser(),clients=monitor?.connected?(monitor.snapshot?.clients||[]):[];
    const target=$('browserCoverage');target.replaceChildren();let covered=0;
    for(const [id,label] of Object.entries(BROWSERS).filter(([id])=>id!=='chromium'||own==='chromium')){
      const known=clients.filter(x=>x.browser===id),count=known.filter(x=>x.connected).length;
      const connected=count>0||id===own&&Boolean(state.attention);if(connected&&id!=='chromium')covered++;
      const el=node('div',`browser-row ${connected?'connected':''}`);el.append(node('span',`browser-logo ${id}`,label.slice(0,1)),node('span','',label));
      const summary=node('span','',connected?(count>1?`${count} profiles`:'Connected'):known.length?'Disconnected':'Not connected');if(connected)summary.prepend(node('i','status-dot'));el.append(summary);target.append(el);
    }
    $('coverageCount').textContent=`${covered} / 4`;
    $('connectNative').hidden=Boolean(monitor?.connected);$('disconnectNative').hidden=!(monitor?.config?.enabled||monitor?.connected||monitor?.connecting);
    $('disconnectNative').textContent=monitor?.connected?'Disconnect browser hub':'Disable browser hub';
    $('connectNative').textContent=monitor?.connecting?'Connecting…':monitor?.waitingForWindow?'Waiting for a browser window':monitor?.error?'Retry browser hub':'Connect browser hub';$('connectNative').disabled=Boolean(monitor?.connecting||monitor?.waitingForWindow);
    $('nativeStatus').classList.toggle('error',Boolean(monitor?.error));
    $('nativeStatus').textContent=monitor?.error?`${monitor.error}${monitor.retryAt>Date.now()?' A bounded reconnect is scheduled.':''}`:monitor?.connected?`Rust hub connected · ${clients.filter(x=>x.connected).length} browser profiles. ${state.attention?.audioOwner?.enabled?'This browser delivers shared alerts.':'Shared alerts are delivered by another connected browser.'}`:monitor?.waitingForWindow?'The hub is paused because no normal browser window is open. It reconnects automatically when you open one.':monitor?.connecting?'Connecting to the local Rust hub. Shared browser coverage is not confirmed yet.':'This browser works on its own. Connect the Rust companion to combine other browsers.';
    if(document.activeElement!==$('browserIdentity'))$('browserIdentity').value=own;
    if(document.activeElement!==$('profileLabel'))$('profileLabel').value=monitor?.config?.label||'';
    $('monitorState').classList.toggle('warn',Boolean(monitor?.error)||!state.attention);
    const label=monitor?.connected?'Browser hub connected':monitor?.waitingForWindow?'Browser hub paused':monitor?.connecting?'Connecting browser hub':state.attention?'This browser connected':'Monitor unavailable';
    $('monitorState').replaceChildren(node('span','status-dot'),document.createTextNode(label));
  }
  function renderSettings(){
    const cfg=(state.monitor?.connected&&state.monitor.snapshot?.alertSettings)||state.attention?.settings||{};
    $('alertScope').textContent=state.monitor?.connected?'SHARED SETTINGS':'THIS BROWSER';
    $('alertsEnabled').checked=cfg.enabled!==false;
    $('soundEnabled').checked=cfg.audioEnabled!==false;$('notificationsEnabled').checked=cfg.notificationsEnabled!==false;$('completionEnabled').checked=cfg.completionEnabled===true;
    if(document.activeElement!==$('soundVolume'))$('soundVolume').value=Math.round((cfg.volume??.45)*100);
    $('volumeValue').value=`${$('soundVolume').value}%`;$('reminderMinutes').value=String(cfg.reminderMinutes||0);
    $('unmute').hidden=!(cfg.muteUntil>Date.now());$('quietHour').textContent=cfg.muteUntil>Date.now()?'Extend mute 1 hour':'Mute for 1 hour';
    const delivery=state.attention?.delivery||{},test=delivery.lastTest;
    const notes=[];
    if(cfg.enabled===false)notes.push('Automatic alerts are off. Observations and incidents are still collected.');
    if(cfg.muteUntil>Date.now())notes.push(`Alerts muted until ${new Date(cfg.muteUntil).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}. Incidents continue to appear here.`);
    const errorAt=delivery.lastErrorAt||delivery.lastResult?.at;
    const newerFailure=delivery.lastError&&(!test||!errorAt||Number(errorAt)>=Number(test.at||0));
    if(newerFailure)notes.push(`Latest alert delivery failed: ${delivery.lastError}`);
    else if(test)notes.push(`Last test ${age(test.at)} · ${testSummary(test)}`);
    else notes.push('Test alert checks both channels in this browser, even when normal alerts are muted or disabled. It uses your volume setting; browser acceptance cannot verify your speaker or OS focus mode.');
    $('alertDelivery').textContent=notes.join(' ');
  }
  function render(){
    const rows=sessions(),items=incidents(),attention=items.filter(activeIncident);
    $('totalCount').textContent=rows.length;$('navCount').textContent=attention.length;$('attentionCount').textContent=attention.length;
    $('runningCount').textContent=rows.filter(x=>x.connected&&ACTIVE.has(x.status)).length;$('completedCount').textContent=rows.filter(x=>x.status==='completed').length;
    $('totalHint').textContent=`${rows.filter(x=>!x.connected||x.status==='suspended').length} unavailable · ${new Set(rows.map(x=>x.browser)).size} browsers observed`;
    const approvals=attention.filter(x=>x.kind==='permission_required').length;$('attentionHint').textContent=approvals?`${approvals} waiting for approval`:attention.length?'Open the inbox below':'No open incidents';
    const last=Math.max(0,...rows.map(x=>Number(x.updatedAt)||0));$('lastUpdated').textContent=last?`Last observed ${new Date(last).toLocaleTimeString()} · event driven`:'Waiting for the first observation';
    renderIncidents(items);renderSessions(rows);renderCoverage(rows);renderSettings();
  }
  async function reload(){
    if(reloadWork){reloadQueued=true;return reloadWork;}
    reloadWork=(async()=>{
      const results=await Promise.allSettled([send('PC_ATTENTION_GET'),send('PC_MONITOR_GET')]);
      if(results[0].status==='fulfilled')state.attention=results[0].value.attention;
      if(results[1].status==='fulfilled')state.monitor=results[1].value.monitor;
      const errors=results.filter(x=>x.status==='rejected').map(x=>x.reason.message);
      $('loadError').hidden=!errors.length;$('loadError').textContent=errors.join(' ');render();
    })().finally(()=>{reloadWork=null;if(reloadQueued){reloadQueued=false;queueMicrotask(()=>void reload());}});
    return reloadWork;
  }
  function setting(patch){return runAction(()=>send(state.monitor?.connected?'PC_MONITOR_ALERT_SETTINGS':'PC_ATTENTION_SETTINGS',{settings:patch}));}
  document.querySelectorAll('[data-filter]').forEach(el=>el.addEventListener('click',()=>{filter=el.dataset.filter;document.querySelectorAll('.filter-tabs [data-filter]').forEach(button=>{button.classList.toggle('active',button.dataset.filter===filter);button.setAttribute('aria-pressed',String(button.dataset.filter===filter));});renderSessions(sessions());}));
  $('searchAgents').addEventListener('input',()=>renderSessions(sessions()));$('browserFilter').addEventListener('change',()=>renderSessions(sessions()));$('sortOrder').addEventListener('change',()=>renderSessions(sessions()));
  $('showResolved').addEventListener('click',()=>{resolved=!resolved;$('showResolved').textContent=resolved?'Hide resolved':'Show resolved';$('showResolved').setAttribute('aria-pressed',String(resolved));renderIncidents(incidents());});
  $('refreshMonitor').addEventListener('click',()=>runAction(async()=>{
    const result=await send('PC_MONITOR_REFRESH'),refresh=result.monitor?.refresh;
    if(refresh)tell(refresh.total?`This browser: ${refresh.observed} observed, ${refresh.rescanRequested} rescans requested, ${refresh.suspended} suspended, ${refresh.unavailable} unavailable.`:'No supported chats are open in this browser.');
    return result;
  }));
  $('testAlert').addEventListener('click',()=>runAction(async()=>{
    if(!api?.runtime?.sendMessage)throw new Error('Open Agent Monitor from the installed Constellation extension.');
    const result=await api.runtime.sendMessage({type:'PC_ATTENTION_TEST'});
    if(!result)throw new Error('The alert test did not answer.');
    tell(testSummary(result));
  }));
  $('connectNative').addEventListener('click',async()=>{
    try{
      const granted=await api.permissions.request({permissions:['nativeMessaging']});
      if(!granted){tell('Native messaging was not enabled. This browser continues to work on its own.');return;}
      await runAction(async()=>{
        const result=await send('PC_MONITOR_CONNECT'),monitor=result.monitor;
        if(monitor?.connected)tell('Browser hub connected.');
        else if(monitor?.waitingForWindow)tell('Browser hub enabled. Open a normal browser window to connect.');
        else if(monitor?.error)throw new Error(monitor.error);
        else tell('Connection requested. Shared browser coverage is not confirmed yet.');
      });
    }catch(error){tell(error.message);}
  });
  $('disconnectNative').addEventListener('click',()=>runAction(()=>send('PC_MONITOR_DISCONNECT'),'This browser is now monitoring on its own.'));
  $('saveProfile').addEventListener('click',()=>runAction(()=>send('PC_MONITOR_SETTINGS',{settings:{browser:$('browserIdentity').value,label:$('profileLabel').value}}),'Browser profile saved.'));
  $('alertsEnabled').addEventListener('change',()=>setting({enabled:$('alertsEnabled').checked}));
  $('soundEnabled').addEventListener('change',()=>setting({audioEnabled:$('soundEnabled').checked}));$('notificationsEnabled').addEventListener('change',()=>setting({notificationsEnabled:$('notificationsEnabled').checked}));$('completionEnabled').addEventListener('change',()=>setting({completionEnabled:$('completionEnabled').checked}));
  $('soundVolume').addEventListener('input',()=>{$('volumeValue').value=`${$('soundVolume').value}%`;});$('soundVolume').addEventListener('change',()=>setting({volume:Number($('soundVolume').value)/100}));
  $('reminderMinutes').addEventListener('change',()=>setting({reminderMinutes:Number($('reminderMinutes').value)}));$('quietHour').addEventListener('click',()=>setting({muteUntil:Date.now()+3600000}));$('unmute').addEventListener('click',()=>setting({muteUntil:0}));
  $('exportDiagnostics').addEventListener('click',()=>{
    const payload={schema:'constellation-monitor-diagnostics-v1',exportedAt:new Date().toISOString(),version:api.runtime.getManifest().version,
      connection:{connected:state.monitor?.connected,connecting:Boolean(state.monitor?.connecting),waitingForWindow:Boolean(state.monitor?.waitingForWindow),error:state.monitor?.error||'',retryAttempt:state.monitor?.retryAttempt||0},
      counts:state.attention?.counts,delivery:state.attention?.delivery,
      browsers:(state.monitor?.snapshot?.clients||[]).map(x=>({browser:x.browser,connected:x.connected,updatedAt:x.updatedAt})),
      incidents:incidents().map(x=>({kind:x.kind,severity:x.severity,resolved:Boolean(x.resolvedAt),acknowledged:Boolean(x.acknowledgedAt),firstSeenAt:x.firstSeenAt}))};
    const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)+'\n'],{type:'application/json'}));const a=node('a');a.href=url;a.download='constellation-monitor-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);tell('Diagnostics exported without chat titles, URLs, transcripts or credentials.');
  });
  document.addEventListener('keydown',event=>{if(event.key==='/'&&!event.ctrlKey&&!event.metaKey&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)){event.preventDefault();$('searchAgents').focus();}});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void reload();});
  api?.runtime?.onMessage?.addListener(message=>{if(message.type==='PC_MONITOR_CHANGED'||message.type==='PC_STATE_EVENT'&&message.event?.topic==='attention.changed')void reload();return false;});
  void reload();
})();
