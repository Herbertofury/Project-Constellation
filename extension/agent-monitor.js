(() => {
  'use strict';
  const api=globalThis.browser||globalThis.chrome;
  const $ = id => document.getElementById(id);
  const BROWSERS = {chrome:'Chrome',firefox:'Firefox',opera_gx:'Opera GX',edge:'Edge',chromium:'Chromium'};
  const ISSUE = {permission_required:'Approval needed',error:'Needs attention',rate_limited:'Rate limited',context_limit:'Conversation limit',waiting_for_user:'Your input needed',auth_required:'Sign-in needed',no_visible_progress:'No visible progress',completed:'Completed'};
  const ACTIVE = new Set(['running','working','tool-running','quiet-working','uncertain-working','thinking','streaming']);
  const ATTENTION = new Set(Object.keys(ISSUE).filter(x=>x!=='completed'));
  const UNAVAILABLE = new Set(['closed','suspended','discarded','frozen','sensor-offline','reconnecting']);
  const rendered={sessions:new Map(),incidents:new Map()};
  let state={attention:null,monitor:null},available={attention:false,monitor:false},filter='all',resolved=false,reloadQueued=false,reloadWork=null,toastTimer;
  let derivedSessions=null,derivedIncidents=null;
  const selectedIncidents=new Map();
  let visibleIncidents=[],bulkRunning=false,bulkStop=false,bulkProgress=null,profileDraft=null,profileSaving=false,profileNotice='',profileConfigEpoch=0,deadlineTimer;
  const node=(tag,className,content)=>{const el=document.createElement(tag);if(className)el.className=className;if(content!==undefined)el.textContent=content;return el;};
  const icon=(name,className='')=>{const el=node('span',`ui-icon icon-${name} ${className}`);el.setAttribute('aria-hidden','true');return el;};
  const age=at=>{if(!at)return 'Not observed';const seconds=Math.max(0,Math.floor((Date.now()-at)/1000));return seconds<10?'Just now':seconds<60?`${seconds}s ago`:seconds<3600?`${Math.floor(seconds/60)}m ago`:seconds<86400?`${Math.floor(seconds/3600)}h ago`:`${Math.floor(seconds/86400)}d ago`;};
  const browserName=value=>BROWSERS[value]||value||'This browser';
  function tell(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('toast').hidden=true;},5500);}
  function testSummary(test){return `${test.ok?'Sound and notification accepted by this browser.':test.error||test.audio?.error||test.notification?.error||'Check sound and notification permissions.'}${test.settingsNotice?' '+test.settingsNotice:''}`;}
  async function request(type,fields={},timeoutMs=15000){
    if(!api?.runtime?.sendMessage)throw new Error('Open Agent Monitor from the installed Constellation extension.');
    let timeout,result;
    try{result=await Promise.race([api.runtime.sendMessage({type,...fields}),new Promise((_,reject)=>{timeout=setTimeout(()=>{
      const error=new Error(type.endsWith('_GET')?'Live monitor status timed out. Refresh to reconnect.':'The action was not confirmed. Refresh before retrying; it may have completed.');
      error.code='monitor_action_unconfirmed';reject(error);
    },timeoutMs);})]);}catch(error){
      if(!type.endsWith('_GET')&&error?.code!=='monitor_action_unconfirmed'){
        const uncertain=new Error(`The action was not confirmed. ${error?.message||String(error)} Refresh before retrying; it may have completed.`);
        uncertain.code='monitor_action_unconfirmed';throw uncertain;
      }
      throw error;
    }finally{clearTimeout(timeout);}
    if(!type.endsWith('_GET')&&typeof result?.ok!=='boolean'){
      const error=new Error('The action returned no valid confirmation. Refresh before retrying; it may have completed.');
      error.code='monitor_action_unconfirmed';throw error;
    }
    return result;
  }
  async function send(type,fields={},timeoutMs=15000){
    const result=await request(type,fields,timeoutMs);
    if(!result?.ok)throw new Error(typeof result?.error==='string'?result.error:result?.error?.message||'The monitor did not answer. Reload the extension and try again.');
    return result;
  }
  function currentBrowser(){return state.monitor?.config?.browser||'chrome';}
  function hubConnected(){return available.monitor&&Boolean(state.monitor?.connected);}
  function searchMatcher(){
    const query=$('searchAgents').value.trim().toLowerCase(),browser=$('browserFilter').value;
    return row=>(browser==='all'||row.browser===browser)&&(!query||[row.title,row.reason,row.status,row.kind,browserName(row.browser),row.profile,providerLabel(row.url),row.url].join(' ').toLowerCase().includes(query));
  }
  function reconcileRows(target,name,entries){
    // Most observations keep the same complete row order. Replace only changed
    // rows in that case, preserving every other node without rebuilding the
    // membership set or moving focused controls.
    if(entries.length===rendered[name].size){
      const replacements=[];let index=0,stable=true;
      for(const previous of rendered[name].values()){
        const next=entries[index++];
        if(next.key!==previous.key){stable=false;break;}
        if(next!==previous)replacements.push([previous,next]);
      }
      if(stable){
        for(const [previous,next] of replacements){target.replaceChild(next.element,previous.element);rendered[name].set(next.key,next);}
        return;
      }
    }
    const desired=new Set(entries.map(entry=>entry.element)),focused=document.activeElement;
    for(const child of [...target.children])if(!desired.has(child))target.removeChild(child);
    let cursor=target.firstChild;
    const next=new Map();
    for(const entry of entries){
      next.set(entry.key,entry);
      if(entry.element===cursor)cursor=cursor.nextSibling;
      else target.insertBefore(entry.element,cursor);
    }
    while(cursor){const following=cursor.nextSibling;target.removeChild(cursor);cursor=following;}
    rendered[name]=next;
    if(focused?.isConnected&&document.activeElement!==focused&&target.contains(focused))focused.focus({preventScroll:true});
  }
  function reuseRow(name,key,fields,item){
    const existing=rendered[name].get(key);
    if(!existing||fields.length!==existing.fields.length||!fields.every((value,index)=>value===existing.fields[index]))return null;
    existing.item=item;
    existing.fields=fields;
    return existing;
  }
  function normalizeSession(row,source){
    return {...row,id:row.sessionId||row.key,source,browser:source==='native'?row.browser:currentBrowser(),
      title:String(row.title||'Untitled chat'),url:String(row.url||''),
      status:String(row.kind||row.status||'unknown'),rawStatus:row.status,connected:(source==='native'?hubConnected():available.attention)&&row.connected!==false&&!row.suspended&&!UNAVAILABLE.has(row.status),
      updatedAt:Number(row.observedAt||row.updatedAt)||0,profile:row.profileLabel||'',reason:row.reason||''};
  }
  function sessions(){
    if(derivedSessions)return derivedSessions;
    const local=(state.attention?.sessions||[]).filter(x=>x.sourceId==='local'&&x.status!=='closed');
    const monitor=state.monitor;
    const localKeys=new Set(local.map(x=>`${x.tabId}\n${x.url}`));
    const remote=(monitor?.snapshot?.sessions||[]).filter(x=>x.status!=='closed'&&(hubConnected()||x.clientId!==monitor.clientId||!localKeys.has(`${x.tabId}\n${x.url}`))).map(x=>normalizeSession(x,'native'));
    const clients=new Map((monitor?.snapshot?.clients||[]).map(x=>[x.clientId,x]));
    const ownKeys=new Set(remote.filter(x=>x.clientId===monitor?.clientId).map(x=>`${x.tabId}\n${x.url}`));
    for(const row of remote){const client=clients.get(row.clientId);row.profile=client?.label||'';if(client?.connected===false)row.connected=false;}
    for(const row of local){if(!ownKeys.has(`${row.tabId}\n${row.url}`))remote.push(normalizeSession(row,'local'));}
    return derivedSessions=remote;
  }
  function incidents(){
    if(derivedIncidents)return derivedIncidents;
    if(state.monitor?.snapshot){
      const rows=new Map(sessions().map(x=>[x.id,x]));
      const clients=new Map((state.monitor.snapshot.clients||[]).map(x=>[x.clientId,x]));
      const deliveryKey=item=>JSON.stringify([item.clientId,item.sessionId,item.documentId,item.runId||'',item.url,item.kind]);
      const deliveries=new Map();
      for(const item of state.attention?.incidents||[]){
        if(item.resolvedAt||!item.documentId||!item.url||!item.delivery)continue;
        const clientId=item.sourceId==='local'?state.monitor.clientId:item.sourceId?.startsWith('native:')?item.sourceId.slice(7):'';
        if(!clientId)continue;
        const key=deliveryKey({...item,clientId,sessionId:clientId+':'+item.tabId});
        // An ambiguous episode must not borrow another incident's delivery result.
        deliveries.set(key,deliveries.has(key)?null:item.delivery);
      }
      if(deliveries.size){
        const candidates=new Map();
        for(const item of state.monitor.snapshot.incidents||[])if(!item.resolvedAt){const key=deliveryKey(item);if(deliveries.has(key))candidates.set(key,(candidates.get(key)||0)+1);}
        for(const [key,count] of candidates)if(count!==1)deliveries.set(key,null);
      }
      const native=(state.monitor.snapshot?.incidents||[]).map(x=>{
        const session=rows.get(x.sessionId);
        const sameDocument=Boolean(session&&x.documentId&&x.url)&&x.documentId===session.documentId&&x.url===session.url&&(!x.runId||x.runId===session.runId);
        const client=clients.get(x.clientId);
        return {...x,id:x.incidentId,source:'native',title:x.title||(sameDocument?session.title:'Agent chat (identity unavailable)'),url:x.url||'',
          browser:x.browser||client?.browser,profile:client?.label||'',tabId:sameDocument?session.tabId:undefined,
          connected:hubConnected()&&sameDocument&&session.connected!==false,reason:x.reason||'',lastSeenAt:x.updatedAt,
          label:ISSUE[x.kind]||x.kind,severity:['permission_required','error','context_limit'].includes(x.kind)?'critical':'warning',
          delivery:!x.resolvedAt&&sameDocument?deliveries.get(deliveryKey(x))||null:null};
      });
      // Include newly observed local problems until the native transport acknowledges them.
      const identity=x=>x.documentId?JSON.stringify([x.clientId,x.sessionId,x.url,x.kind,x.documentId,x.runId||'',Boolean(x.resolvedAt)]):null;
      const nativeKeys=new Map();
      for(const [index,item] of native.entries()){const key=identity(item);if(!key)continue;if(!nativeKeys.has(key))nativeKeys.set(key,{indices:[],used:0});nativeKeys.get(key).indices.push(index);}
      for(const group of nativeKeys.values())group.indices.sort((a,b)=>(native[a].firstSeenAt||0)-(native[b].firstSeenAt||0));
      for(const item of (state.attention?.incidents||[]).filter(x=>x.sourceId==='local').sort((a,b)=>(a.firstSeenAt||0)-(b.firstSeenAt||0))){
        const key=identity({...item,clientId:state.monitor.clientId,sessionId:state.monitor.clientId+':'+item.tabId});
        const group=key&&nativeKeys.get(key),matched=group&&group.used<group.indices.length,row={...item,source:'local',browser:currentBrowser(),connected:available.attention&&!item.suspended&&!item.sourceClosed};
        if(!matched)native.push(row);
        else {const index=group.indices[group.used++];if(!hubConnected())native[index]=row;}
      }
      return derivedIncidents=native;
    }
    return derivedIncidents=(state.attention?.incidents||[]).filter(x=>x.sourceId==='local').map(x=>({...x,source:'local',browser:currentBrowser(),connected:available.attention&&!x.suspended&&!x.sourceClosed}));
  }
  function activeIncident(item){return !item.resolvedAt&&!item.sourceClosed&&item.kind!=='completed';}
  const incidentKey=item=>JSON.stringify([item.source,item.id]);
  const incidentContext=item=>JSON.stringify([item.source,item.id,item.documentId,item.runId,item.url,item.kind,item.firstSeenAt]);
  const incidentEditable=item=>item.source==='native'?hubConnected():available.attention;
  function renderBulkControls(){
    const eligible=visibleIncidents.filter(item=>activeIncident(item)&&incidentEditable(item));
    const selected=selectedIncidents.size?eligible.filter(item=>selectedIncidents.has(incidentKey(item))):[];
    $('bulkActions').hidden=!eligible.length&&!bulkRunning;
    const all=$('selectVisibleIncidents');all.checked=Boolean(eligible.length)&&selected.length===eligible.length;all.indeterminate=selected.length>0&&selected.length<eligible.length;all.disabled=bulkRunning||!eligible.length;
    $('selectionCount').textContent=bulkRunning?`${bulkProgress.done} of ${bulkProgress.total} processed`:`${selected.length} selected · ${eligible.length} available in this view`;
    $('acknowledgeSelected').disabled=bulkRunning||!selected.some(item=>!item.acknowledgedAt);
    $('snoozeSelected').disabled=bulkRunning||!selected.length;$('bulkSnoozeMinutes').disabled=bulkRunning;
    $('clearIncidentSelection').disabled=bulkRunning||!selectedIncidents.size;
    $('stopBulkAction').hidden=!bulkRunning;$('stopBulkAction').disabled=bulkStop;
    for(const entry of rendered.incidents.values())if(entry.selection){
      const checked=selectedIncidents.has(entry.key),disabled=bulkRunning||!incidentEditable(entry.item);
      if(entry.selection.checked!==checked)entry.selection.checked=checked;
      if(entry.selection.disabled!==disabled)entry.selection.disabled=disabled;
      if(entry.element.classList.contains('selected')!==checked)entry.element.classList.toggle('selected',checked);
    }
  }
  function clearSelection(){selectedIncidents.clear();renderBulkControls();}
  async function triageSelected(action){
    if(bulkRunning)return;
    const targets=visibleIncidents.filter(item=>selectedIncidents.has(incidentKey(item))&&activeIncident(item)&&incidentEditable(item)).map(item=>({key:incidentKey(item),context:incidentContext(item),title:item.title||'Agent chat'}));
    if(!targets.length)return;
    const minutes=Number($('bulkSnoozeMinutes').value)||10;
    if(action==='snooze'&&![5,10,30,60].includes(minutes)){tell('Choose a supported snooze duration.');return;}
    bulkRunning=true;bulkStop=false;bulkProgress={total:targets.length,done:0,succeeded:0,skipped:0,errors:[]};
    $('bulkResult').hidden=true;renderIncidents(incidents());
    let cursor=0;
    const worker=async()=>{
      while(!bulkStop&&cursor<targets.length){
        const target=targets[cursor++],item=incidents().find(row=>incidentKey(row)===target.key);
        if(!item||incidentContext(item)!==target.context||!activeIncident(item)||!incidentEditable(item)||(action==='acknowledge'&&item.acknowledgedAt)){
          bulkProgress.skipped++;selectedIncidents.delete(target.key);
        }else{
          try{
            await send(item.source==='native'?(action==='acknowledge'?'PC_MONITOR_ACK':'PC_MONITOR_SNOOZE'):(action==='acknowledge'?'PC_ATTENTION_ACK':'PC_ATTENTION_SNOOZE'),{id:item.id,...(action==='snooze'?{minutes}:{})});
            bulkProgress.succeeded++;selectedIncidents.delete(target.key);
          }catch(error){bulkProgress.errors.push(`${target.title}: ${error.message}`);if(error.code==='monitor_action_unconfirmed')bulkStop=true;}
        }
        bulkProgress.done++;renderBulkControls();
      }
    };
    try{await Promise.all(Array.from({length:Math.min(4,targets.length)},worker));}
    finally{bulkProgress.skipped+=targets.length-cursor;bulkRunning=false;await reload();}
    const result=bulkProgress,verb=action==='acknowledge'?'acknowledged':`snoozed for ${minutes} minutes`;
    $('bulkResult').textContent=[`${result.succeeded} ${verb}. ${result.errors.length} not confirmed. ${result.skipped} not sent or already handled.`,...result.errors,result.errors.length?'Unconfirmed incidents remain selected when still available. Review their current state before retrying.':''].filter(Boolean).join('\n');
    $('bulkResult').hidden=false;renderBulkControls();
  }
  function deliverySummary(item){
    const delivery=item.delivery;if(!delivery)return null;
    const labels={audio:{started:'playback started',claimed:'playback confirmation pending',pending:'pending',failed:'failed',interrupted:'interrupted; playback is uncertain','grouped-or-disabled':'grouped or disabled'},notification:{accepted:'accepted by browser',pending:'pending',failed:'failed',disabled:'disabled'}};
    const pieces=['Last delivery recorded in this browser.',`Sound: ${labels.audio[delivery.audio]||'not confirmed'}.`,`Notification: ${labels.notification[delivery.notification]||'not confirmed'}.`];
    for(const error of [delivery.audioError,delivery.notificationError])if(error)pieces.push(error);
    if(delivery.retryExhausted)pieces.push('Automatic retries exhausted. Use Test alert to check the channels.');
    else if(delivery.retryAt>0)pieces.push(`Recorded retry deadline: ${new Date(delivery.retryAt).toLocaleTimeString()}.`);
    return pieces.join(' ');
  }
  function statusClass(row){return !row.connected?'':ATTENTION.has(row.status)?(['rate_limited','waiting_for_user','no_visible_progress'].includes(row.status)?'warning':'danger'):ACTIVE.has(row.status)?'active':row.status==='completed'?'good':'';}
  function statusLabel(row){return !row.connected?'Unavailable':ISSUE[row.status]||(ACTIVE.has(row.status)?'Working':row.status==='suspended'?'Suspended':row.status==='idle'?'Idle':row.status.replaceAll('-',' '));}
  function button(label,cls,action){const el=node('button',cls,label);el.type='button';el.addEventListener('click',action);return el;}
  async function runAction(action,success){try{await action();if(success)tell(success);await reload();}catch(error){tell(error.message);await reload();}}
  async function focus(item){
    if(item.source==='native')return send('PC_MONITOR_FOCUS',{sessionId:item.sessionId||item.id});
    return send('PC_ATTENTION_FOCUS',{id:item.id});
  }
  function renderIncidents(items){
    const view=$('inboxFilter').value||'all',now=Date.now(),matchesSearch=searchMatcher();
    const visible=items.filter(x=>(resolved||activeIncident(x))&&matchesSearch(x)&&(view==='all'||view==='pending'&&!x.resolvedAt&&!x.acknowledgedAt&&!(x.snoozedUntil>now)||view==='acknowledged'&&x.acknowledgedAt||view==='snoozed'&&x.snoozedUntil>now||view==='unavailable'&&x.connected===false)).sort((a,b)=>Number(Boolean(a.resolvedAt))-Number(Boolean(b.resolvedAt))||Number(Boolean(a.acknowledgedAt))-Number(Boolean(b.acknowledgedAt))||Number(a.snoozedUntil>now)-Number(b.snoozedUntil>now)||b.firstSeenAt-a.firstSeenAt);
    visibleIncidents=visible;
    if(selectedIncidents.size){
      const visibleKeys=new Map(visible.filter(item=>activeIncident(item)&&incidentEditable(item)).map(item=>[incidentKey(item),incidentContext(item)]));
      for(const [key,context] of selectedIncidents)if(visibleKeys.get(key)!==context)selectedIncidents.delete(key);
    }
    $('inboxCount').textContent=items.filter(activeIncident).length;
    const target=$('incidentList');
    if(!visible.length){
      rendered.incidents.clear();target.replaceChildren();
      const narrowed=view!=='all'||$('searchAgents').value.trim()||$('browserFilter').value!=='all';
      const empty=node('div','empty-state');empty.append(icon('check','empty-icon'),node('h3','',narrowed?'No incidents match this view':!available.attention?'Live monitoring is unavailable':sessions().length?'Nothing needs your attention':'Ready when your agents are'));
      empty.append(node('p','',narrowed?'Change the inbox, browser or search filter to see other incidents.':!available.attention?'Refresh to reconnect. Last known observations stay visible until fresh status is available.':sessions().length?'No current problem has been reported by connected sensors. Unavailable tabs are shown separately below.':'Open a supported chat in this browser. Constellation will show observed activity and raise an alert when the chat needs you.'));
      target.append(empty);renderBulkControls();return;
    }
    const entries=[];
    for(const item of visible){
      const key=incidentKey(item);
      const canEdit=incidentEditable(item)&&!bulkRunning;
      const delivery=deliverySummary(item);
      const fields=[item.id,item.source,item.sessionId,item.kind,item.title,item.label,item.reason,item.severity,item.browser,item.profile,item.connected,item.sourceClosed,Boolean(item.resolvedAt),Boolean(item.acknowledgedAt),item.snoozedUntil>Date.now()?item.snoozedUntil:0,age(item.firstSeenAt),canEdit,delivery];
      const existing=reuseRow('incidents',key,fields,item);
      if(existing){entries.push(existing);continue;}
      const entry={key,fields,item,element:null};
      const card=node('article',`incident ${activeIncident(item)?'selectable':''} ${item.severity!=='critical'?'warning':''} ${item.resolvedAt?'resolved':item.acknowledgedAt?'acknowledged':''}`);
      if(activeIncident(item)){
        const select=node('input','incident-select');select.type='checkbox';select.checked=selectedIncidents.has(key);select.disabled=!canEdit;select.setAttribute('aria-label',`Select ${item.title||'agent chat'} incident`);
        select.addEventListener('change',()=>{if(bulkRunning||!incidentEditable(entry.item))return;if(select.checked)selectedIncidents.set(key,incidentContext(entry.item));else selectedIncidents.delete(key);renderBulkControls();});
        entry.selection=select;card.append(select);
      }
      const top=node('div','incident-top');top.append(item.kind==='permission_required'?icon('open','incident-icon'):item.resolvedAt?icon('check','incident-icon'):node('span','incident-icon','!'));
      const copy=node('div','incident-copy'),heading=node('h3','',item.title||'Agent chat');heading.append(node('span','issue-label',item.resolvedAt?'Resolved':item.label||ISSUE[item.kind]||'Needs attention'));copy.append(heading,node('p','',item.reason||'Open this chat to inspect the current provider state.'));
      const meta=node('div','incident-meta');meta.append(node('span','',browserName(item.browser)));
      for(const value of [item.profile,item.acknowledgedAt?'Acknowledged':item.snoozedUntil>Date.now()?`Snoozed until ${new Date(item.snoozedUntil).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`:'',item.connected===false?'Source unavailable':''].filter(Boolean)){meta.append(node('span','meta-dot'),node('span','',value));}
      copy.append(meta);top.append(copy,node('span','incident-age',age(item.firstSeenAt)));card.append(top);
      if(delivery)card.append(node('p','incident-delivery',delivery));
      if(!item.resolvedAt){const actions=node('div','incident-actions');const open=button(item.kind==='permission_required'?'Review permission':'Open chat','button quiet',()=>runAction(()=>focus(entry.item)));open.append(icon('open'));open.disabled=item.connected===false||item.sourceClosed;actions.append(open);
        if(!item.acknowledgedAt){const acknowledge=button('Acknowledge','text-button',()=>{if(!bulkRunning)return runAction(()=>send(entry.item.source==='native'?'PC_MONITOR_ACK':'PC_ATTENTION_ACK',{id:entry.item.id}),'Incident acknowledged.');});acknowledge.disabled=!canEdit;actions.append(acknowledge);}
        const snooze=button('Snooze 10 min','text-button',()=>{if(!bulkRunning)return runAction(()=>send(entry.item.source==='native'?'PC_MONITOR_SNOOZE':'PC_ATTENTION_SNOOZE',{id:entry.item.id,minutes:10}),'Alert snoozed for 10 minutes.');});snooze.disabled=!canEdit;actions.append(snooze);card.append(actions);}
      entry.element=card;entries.push(entry);
    }
    reconcileRows(target,'incidents',entries);renderBulkControls();
  }
  function providerLabel(url){try{const h=new URL(url).hostname;return h.includes('chatgpt')||h==='chat.openai.com'?'ChatGPT':h.includes('claude')?'Claude':h.includes('gemini')?'Gemini':h.includes('grok')?'Grok':h.replace(/^www\./,'');}catch{return 'Agent';}}
  function renderSessions(rows){
    const matchesSearch=searchMatcher();
    const selected=rows.filter(row=>matchesSearch(row)&&
      (filter==='all'||filter==='attention'&&ATTENTION.has(row.status)||filter==='running'&&row.connected&&ACTIVE.has(row.status)||filter==='completed'&&row.status==='completed'||filter==='unavailable'&&(!row.connected||row.status==='suspended')));
    const order=$('sortOrder').value;
    selected.sort((a,b)=>order==='title'?a.title.localeCompare(b.title):order==='recent'?b.updatedAt-a.updatedAt:Number(ATTENTION.has(b.status))-Number(ATTENTION.has(a.status))||b.updatedAt-a.updatedAt);
    $('activityHint').textContent=`${selected.length} of ${rows.length} observed chats · updates arrive when activity changes`;
    const list=$('sessionList');
    if(!selected.length){rendered.sessions.clear();list.replaceChildren();const empty=node('div','empty-state');empty.append(node('h3','',rows.length?'No chats match this view':'No chat observations yet'),node('p','',rows.length?'Try a different filter or search.':'Keep a supported chat open and refresh once. Disconnected browsers need their sensor connected before their chats can appear.'));list.append(empty);return;}
    const entries=[];
    for(const row of selected){
      const key=JSON.stringify([row.source,row.id]);
      const fields=[row.id,row.source,row.title,row.url,row.status,row.connected,row.browser,row.profile,row.reason,age(row.updatedAt)];
      const existing=reuseRow('sessions',key,fields,row);
      if(existing){entries.push(existing);continue;}
      const entry={key,fields,item:row,element:null};
      const el=node('article','session'),main=node('div','session-main'),provider=providerLabel(row.url),copy=node('div','session-copy');
      main.append(provider==='ChatGPT'?icon('star','provider-icon'):node('span','provider-icon',provider.slice(0,1)));const title=node('span','session-title',row.title||'Untitled chat');title.title=row.title;copy.append(title,node('div','session-subtitle',`${provider} · ${row.profile||browserName(row.browser)}`));main.append(copy);el.append(main);
      const status=node('span',`session-status ${statusClass(row)}`,statusLabel(row));status.title=row.reason||statusLabel(row);el.append(status,node('span','session-time',age(row.updatedAt)));
      const open=button('','open-session',()=>runAction(()=>focus(entry.item)));open.append(icon('open'));open.setAttribute('aria-label',`Open ${row.title||'chat'} in ${browserName(row.browser)}`);open.disabled=!row.connected;el.append(open);entry.element=el;entries.push(entry);
    }
    reconcileRows(list,'sessions',entries);
  }
  function renderCoverage(rows){
    const monitor=state.monitor,own=currentBrowser(),clients=monitor?.snapshot?.clients||[];
    const target=$('browserCoverage');target.replaceChildren();let covered=0;
    for(const [id,label] of Object.entries(BROWSERS).filter(([id])=>id!=='chromium'||own==='chromium')){
      const known=clients.filter(x=>x.browser===id),count=hubConnected()?known.filter(x=>x.connected).length:0;
      const connected=count>0||id===own&&available.attention;if(connected&&id!=='chromium')covered++;
      const el=node('div',`browser-row ${connected?'connected':''}`);el.append(node('span',`browser-logo ${id}`,label.slice(0,1)),node('span','',label));
      const summary=node('span','',connected?(count>1?`${count} profiles`:'Connected'):known.length?'Disconnected':'Not connected');if(connected)summary.prepend(node('i','status-dot'));el.append(summary);target.append(el);
    }
    $('coverageCount').textContent=`${covered} / 4`;
    $('connectNative').hidden=hubConnected();$('disconnectNative').hidden=!(monitor?.config?.enabled||monitor?.connected||monitor?.connecting);
    $('disconnectNative').textContent=monitor?.connected?'Disconnect browser hub':'Disable browser hub';
    $('connectNative').textContent=monitor?.connecting?'Connecting…':monitor?.waitingForWindow?'Waiting for a browser window':monitor?.error?'Retry browser hub':'Connect browser hub';$('connectNative').disabled=Boolean(monitor?.connecting||monitor?.waitingForWindow);
    $('nativeStatus').classList.toggle('error',Boolean(monitor?.error)||!available.monitor);
    $('nativeStatus').textContent=!available.monitor?'Browser hub status is unavailable. Last known chats remain visible as unavailable. Refresh to check the connection.':monitor?.error?`${monitor.error}${monitor.retryAt>Date.now()?' A bounded reconnect is scheduled.':''}`:hubConnected()?`Rust hub connected · ${clients.filter(x=>x.connected).length} browser profiles. ${state.attention?.audioOwner?.enabled?'This browser delivers shared alerts.':'Shared alerts are delivered by another connected browser.'}`:monitor?.waitingForWindow?'The hub is paused because no normal browser window is open. It reconnects automatically when you open one.':monitor?.connecting?'Connecting to the local Rust hub. Shared browser coverage is not confirmed yet.':'This browser works on its own. Connect the Rust companion to combine other browsers.';
    if(!profileDraft){$('browserIdentity').value=own;$('profileLabel').value=monitor?.config?.label||'';}
    $('saveProfile').disabled=profileSaving||!available.monitor;$('saveProfile').textContent=profileSaving?'Saving…':'Save';
    $('resetProfile').hidden=!profileDraft;$('resetProfile').disabled=profileSaving;
    $('profileFeedback').hidden=!profileNotice;$('profileFeedback').textContent=profileNotice;
    $('monitorState').classList.toggle('warn',Boolean(monitor?.error)||!available.attention||!available.monitor);
    const label=!available.attention?'Live alerts unavailable':hubConnected()?'Browser hub connected':available.monitor&&monitor?.waitingForWindow?'Browser hub paused':available.monitor&&monitor?.connecting?'Connecting browser hub':available.attention?'This browser connected':'Monitor unavailable';
    $('monitorState').replaceChildren(node('span','status-dot'),document.createTextNode(label));
  }
  function renderSettings(){
    const cfg=(state.monitor?.connected&&state.monitor.snapshot?.alertSettings)||state.attention?.settings||{};
    const settingsReady=available.attention&&available.monitor;
    $('alertScope').textContent=!settingsReady?'LAST KNOWN SETTINGS':hubConnected()?'SHARED SETTINGS':'THIS BROWSER';
    for(const id of ['alertsEnabled','soundEnabled','notificationsEnabled','completionEnabled','soundVolume','reminderMinutes','quietHour','unmute'])$(id).disabled=!settingsReady;
    $('alertsEnabled').checked=cfg.enabled!==false;
    $('soundEnabled').checked=cfg.audioEnabled!==false;$('notificationsEnabled').checked=cfg.notificationsEnabled!==false;$('completionEnabled').checked=cfg.completionEnabled===true;
    if(document.activeElement!==$('soundVolume'))$('soundVolume').value=Math.round((cfg.volume??.45)*100);
    $('volumeValue').value=`${$('soundVolume').value}%`;$('reminderMinutes').value=String(cfg.reminderMinutes||0);
    $('unmute').hidden=!(cfg.muteUntil>Date.now());$('quietHour').textContent=cfg.muteUntil>Date.now()?'Extend mute 1 hour':'Mute for 1 hour';
    const delivery=state.attention?.delivery||{},test=delivery.lastTest;
    const notes=[];
    if(!settingsReady)notes.push('Live alert status is unavailable. Refresh before changing settings.');
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
    const last=rows.reduce((latest,row)=>Math.max(latest,Number(row.updatedAt)||0),0);$('lastUpdated').textContent=last?`Last observed ${new Date(last).toLocaleTimeString()} · ${available.attention&&available.monitor?'event driven':'last known state'}`:'Waiting for the first observation';
    renderIncidents(items);renderSessions(rows);renderCoverage(rows);renderSettings();
    clearTimeout(deadlineTimer);
    // One render at an existing user deadline keeps snooze/mute controls honest.
    // It performs no reads, provider work, heartbeat or idle polling.
    if(!document.hidden){
      const cfg=(hubConnected()&&state.monitor.snapshot?.alertSettings)||state.attention?.settings||{},now=Date.now();
      let deadline=Number(cfg.muteUntil)>now?Number(cfg.muteUntil):Infinity;
      for(const item of items)if(Number(item.snoozedUntil)>now)deadline=Math.min(deadline,Number(item.snoozedUntil));
      if(Number.isFinite(deadline))deadlineTimer=setTimeout(render,Math.min(2147483647,deadline-now+1));
    }
  }
  async function reload(){
    if(reloadWork){reloadQueued=true;return reloadWork;}
    reloadWork=(async()=>{
      const profileEpoch=profileConfigEpoch;
      const read=async(type,key)=>{
        const result=await send(type,{},10000);
        if(!result[key]||typeof result[key]!=='object'||Array.isArray(result[key]))throw new Error('The monitor returned incomplete status. Refresh to reconnect.');
        return result[key];
      };
      const results=await Promise.allSettled([read('PC_ATTENTION_GET','attention'),read('PC_MONITOR_GET','monitor')]);
      for(const [index,key] of ['attention','monitor'].entries()){
        available[key]=results[index].status==='fulfilled';
        if(available[key]){
          const next=results[index].value;
          if(key==='monitor'&&profileEpoch!==profileConfigEpoch)next.config=state.monitor?.config;
          state[key]=next;
        }
      }
      // Reconcile each complete immutable source snapshot once. Filter changes,
      // selections and batch progress reuse its full model, never a capped view.
      derivedSessions=null;derivedIncidents=null;
      const errors=results.filter(x=>x.status==='rejected').map(x=>x.reason.message);
      $('loadError').hidden=!errors.length;$('loadError').textContent=errors.join(' ');render();
    })().finally(()=>{reloadWork=null;if(reloadQueued){reloadQueued=false;queueMicrotask(()=>void reload());}});
    return reloadWork;
  }
  function setting(patch){return runAction(()=>{if(!available.attention||!available.monitor)throw new Error('Refresh live status before changing alert settings.');return send(hubConnected()?'PC_MONITOR_ALERT_SETTINGS':'PC_ATTENTION_SETTINGS',{settings:patch});});}
  document.querySelectorAll('[data-filter]').forEach(el=>el.addEventListener('click',()=>{filter=el.dataset.filter;document.querySelectorAll('.filter-tabs [data-filter]').forEach(button=>{button.classList.toggle('active',button.dataset.filter===filter);button.setAttribute('aria-pressed',String(button.dataset.filter===filter));});renderSessions(sessions());}));
  const search=()=>{clearSelection();renderSessions(sessions());renderIncidents(incidents());};
  $('searchAgents').addEventListener('input',search);$('browserFilter').addEventListener('change',search);$('sortOrder').addEventListener('change',()=>renderSessions(sessions()));
  $('inboxFilter').addEventListener('change',()=>{clearSelection();renderIncidents(incidents());});
  $('showResolved').addEventListener('click',()=>{clearSelection();resolved=!resolved;$('showResolved').textContent=resolved?'Hide resolved':'Show resolved';$('showResolved').setAttribute('aria-pressed',String(resolved));renderIncidents(incidents());});
  $('selectVisibleIncidents').addEventListener('change',()=>{
    if(bulkRunning)return;
    for(const item of visibleIncidents.filter(item=>activeIncident(item)&&incidentEditable(item))){const key=incidentKey(item);if($('selectVisibleIncidents').checked)selectedIncidents.set(key,incidentContext(item));else selectedIncidents.delete(key);}
    renderBulkControls();
  });
  $('acknowledgeSelected').addEventListener('click',()=>triageSelected('acknowledge'));
  $('snoozeSelected').addEventListener('click',()=>triageSelected('snooze'));
  $('clearIncidentSelection').addEventListener('click',clearSelection);
  $('stopBulkAction').addEventListener('click',()=>{bulkStop=true;renderBulkControls();tell('Stopping after the requests already sent. Remaining incidents will stay selected.');});
  $('refreshMonitor').addEventListener('click',()=>runAction(async()=>{
    const result=await send('PC_MONITOR_REFRESH'),refresh=result.monitor?.refresh;
    if(refresh)tell(refresh.total?`This browser: ${refresh.observed} observed, ${refresh.rescanRequested} rescans requested, ${refresh.suspended} suspended, ${refresh.unavailable} unavailable.`:'No supported chats are open in this browser.');
    return result;
  }));
  $('testAlert').addEventListener('click',()=>runAction(async()=>{
    if(!api?.runtime?.sendMessage)throw new Error('Open Agent Monitor from the installed Constellation extension.');
    const result=await request('PC_ATTENTION_TEST');
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
  const profileEdited=()=>{profileDraft={browser:$('browserIdentity').value,label:$('profileLabel').value};profileNotice='Unsaved profile changes';renderCoverage(sessions());};
  $('browserIdentity').addEventListener('change',profileEdited);$('profileLabel').addEventListener('input',profileEdited);
  $('resetProfile').addEventListener('click',()=>{if(profileSaving)return;profileDraft=null;profileNotice='';renderCoverage(sessions());});
  $('saveProfile').addEventListener('click',async()=>{
    if(profileSaving)return;
    if(!available.monitor){tell('Refresh browser hub status before saving this profile.');return;}
    const settings={browser:$('browserIdentity').value,label:$('profileLabel').value};
    profileDraft={...settings};profileSaving=true;profileNotice='Saving profile…';renderCoverage(sessions());
    let saved=false,acceptedConfig=null;
    try{
      const result=await send('PC_MONITOR_SETTINGS',{settings});saved=true;
      if(result.monitor?.config&&BROWSERS[result.monitor.config.browser]&&typeof result.monitor.config.label==='string'){
        acceptedConfig=result.monitor.config;
        state.monitor={...state.monitor,config:{...acceptedConfig}};profileConfigEpoch++;
        derivedSessions=null;derivedIncidents=null;
      }
    }catch(error){profileNotice=error.message;tell(error.message);}
    finally{
      profileSaving=false;await reload();
      if(saved){
        const unchanged=profileDraft?.browser===settings.browser&&profileDraft?.label===settings.label;
        const expected=acceptedConfig||settings,current=state.monitor?.config;
        const confirmed=(available.monitor||acceptedConfig)&&current?.browser===expected.browser&&(current?.label||'')===expected.label;
        if(unchanged&&confirmed)profileDraft=null;
        profileNotice=!profileDraft?'Browser profile saved.':!unchanged?'Profile saved; your newer changes are still unsaved.':'Profile save accepted; current profile status is not confirmed. Your submitted values are retained.';
      }
      renderCoverage(sessions());
    }
  });
  $('alertsEnabled').addEventListener('change',()=>setting({enabled:$('alertsEnabled').checked}));
  $('soundEnabled').addEventListener('change',()=>setting({audioEnabled:$('soundEnabled').checked}));$('notificationsEnabled').addEventListener('change',()=>setting({notificationsEnabled:$('notificationsEnabled').checked}));$('completionEnabled').addEventListener('change',()=>setting({completionEnabled:$('completionEnabled').checked}));
  $('soundVolume').addEventListener('input',()=>{$('volumeValue').value=`${$('soundVolume').value}%`;});$('soundVolume').addEventListener('change',()=>setting({volume:Number($('soundVolume').value)/100}));
  $('reminderMinutes').addEventListener('change',()=>setting({reminderMinutes:Number($('reminderMinutes').value)}));$('quietHour').addEventListener('click',()=>setting({muteUntil:Date.now()+3600000}));$('unmute').addEventListener('click',()=>setting({muteUntil:0}));
  $('exportDiagnostics').addEventListener('click',()=>{
    const payload={schema:'constellation-monitor-diagnostics-v1',exportedAt:new Date().toISOString(),version:api.runtime.getManifest().version,
      connection:{connected:hubConnected(),statusAvailable:{...available},connecting:available.monitor&&Boolean(state.monitor?.connecting),waitingForWindow:available.monitor&&Boolean(state.monitor?.waitingForWindow),error:state.monitor?.error||'',retryAttempt:state.monitor?.retryAttempt||0},
      counts:state.attention?.counts,delivery:state.attention?.delivery,
      browsers:(state.monitor?.snapshot?.clients||[]).map(x=>({browser:x.browser,connected:x.connected,updatedAt:x.updatedAt})),
      incidents:incidents().map(x=>({kind:x.kind,severity:x.severity,resolved:Boolean(x.resolvedAt),acknowledged:Boolean(x.acknowledgedAt),firstSeenAt:x.firstSeenAt}))};
    const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)+'\n'],{type:'application/json'}));const a=node('a');a.href=url;a.download='constellation-monitor-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);tell('Diagnostics exported without chat titles, URLs, transcripts or credentials.');
  });
  document.addEventListener('keydown',event=>{if(event.key==='/'&&!event.ctrlKey&&!event.metaKey&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)){event.preventDefault();$('searchAgents').focus();}});
  document.addEventListener('visibilitychange',()=>{clearTimeout(deadlineTimer);if(!document.hidden)void reload();});
  api?.runtime?.onMessage?.addListener(message=>{if(message.type==='PC_MONITOR_CHANGED'||message.type==='PC_STATE_EVENT'&&message.event?.topic==='attention.changed')void reload();return false;});
  void reload();
})();
