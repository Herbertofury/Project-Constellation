// Minimal cross-browser DOM adapter; no transcript capture and no provider requests.
(() => {
  'use strict';
  const VERSION='0.24.0';
  if(globalThis.__pcBrowserMonitorSensor?.version===VERSION)return;
  globalThis.__pcBrowserMonitorSensor?.dispose?.();
  const api=globalThis.browser||globalThis.chrome;
  const documentId=crypto.randomUUID();
  const USER='[data-message-author-role="user"],[data-testid="user-message"],[data-test-id="user-query"],article[data-turn="user"]';
  const ASSISTANT='[data-message-author-role="assistant"],[data-testid="assistant-message"],.font-claude-message,[data-test-id="model-response"],article[data-turn="assistant"]';
  const TURN=`${USER},${ASSISTANT},[data-testid^="conversation-turn-"]`;
  const OWNED='[data-pc-monitor],[data-project-constellation-owned],[id^="projectConstellation"]';
  const CODE='pre,code,textarea,[contenteditable="true"]';
  const DELIVERY_RETRY_MS=[250,1000,3000];
  const DELIVERY_TIMEOUT_MS=4000;
  const userNodes=new WeakMap();
  const pendingDeliveries=new Set();
  let timer=null,deliveryTimer=null,deliverySequence=0,userSequence=0,lastSignature='',lastStatus='idle',wasRunning=false,lastUrl='',lastUserKey='',runId='',destroyed=false,paused=false,observer,completionAt=0;
  let lastDelivery={ok:false,attempts:0,error:'No observation has been accepted yet.'};
  const clean=(value,max=180)=>String(value||'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
  const hash=value=>{let out=2166136261;for(const ch of value){out^=ch.charCodeAt(0);out=Math.imul(out,16777619);}return (out>>>0).toString(36);};
  const visible=el=>{
    if(!el||el.closest('[aria-hidden="true"],[hidden],[inert]')||el.closest(OWNED))return false;
    if(el.checkVisibility?.({checkOpacity:true,checkVisibilityCSS:true})===false)return false;
    const r=el.getBoundingClientRect();if(!r.width||!r.height)return false;
    const style=getComputedStyle(el);return style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity||1)>0.01;
  };
  const usable=el=>visible(el)&&!el.disabled&&el.getAttribute('aria-disabled')!=='true'&&!el.closest(CODE);
  const label=el=>clean(el.getAttribute('aria-label')||el.textContent,160);
  const follows=(node,boundary)=>Boolean(node&&boundary&&!boundary.contains(node)&&(boundary.compareDocumentPosition(node)&Node.DOCUMENT_POSITION_FOLLOWING));
  function frontier(){
    const users=[...document.querySelectorAll(USER)].filter(el=>!el.closest(CODE)&&visible(el));
    const assistants=[...document.querySelectorAll(ASSISTANT)].filter(el=>!el.closest(CODE)&&visible(el));
    const user=users.at(-1)||null;
    const assistant=user?[...assistants].reverse().find(el=>follows(el,user))||null:assistants.at(-1)||null;
    return {user,assistant};
  }
  function current(el,edge){
    if(!el||el.closest(CODE)||el.closest(OWNED)||edge.user?.contains(el))return false;
    const owner=el.closest(TURN);
    if(owner?.matches(USER)||owner?.querySelector?.(USER)?.contains(el))return false;
    // Provider dialogs/banners outside transcript turns may precede <main>. Historical
    // inline cards inside an old turn must not contaminate the current request.
    return !edge.user||!owner||follows(el,edge.user);
  }
  function permissionButton(edge=frontier()){
    const controls=[...document.querySelectorAll('button,[role="button"],[role="menuitem"]')].slice(-180);
    for(const el of controls.reverse()){
      if(!usable(el)||!current(el,edge))continue;
      const title=label(el);
      if(/^(?:allow(?: [a-z0-9 ._-]{1,80})? for (?:this|the) (?:conversation|chat)|grant permission)$/i.test(title))return el;
      if(!/^(?:allow(?: once| this time)?|approve(?: action| request)?)$/i.test(title))continue;
      let scope=el.parentElement;
      for(let depth=0;scope&&scope!==document.body&&depth<4;depth++,scope=scope.parentElement){
        const nearby=[...scope.querySelectorAll('button,[role="button"],[role="menuitem"]')].slice(0,30).filter(usable);
        const deny=nearby.some(node=>/^(?:deny|reject|decline|cancel|not now)$/i.test(label(node)));
        if(deny&&/permission|access|connect|allow|approve|tool|app/i.test(clean(scope.textContent,1400)))return el;
      }
    }
    return null;
  }
  function progressKey(edge){
    const tail=edge.assistant;
    const value=String(tail?.textContent||'');
    const statuses=[...document.querySelectorAll('[role="status"],[aria-live="polite"],[data-testid*="tool"]')].slice(-24)
      .filter(el=>visible(el)&&current(el,edge)).slice(-8).map(el=>clean(el.textContent,160)).join('|');
    // Only this opaque fingerprint remains in the content world. No answer/prompt
    // text is attached to an event or placed in extension storage.
    return `${value.length}:${hash(value.slice(-160))}:${hash(statuses)}`;
  }
  function read(){
    const url=new URL(location.href);url.search='';url.hash='';const canonical=url.toString();
    const edge=frontier();
    const userValue=String(edge.user?.textContent||'');
    if(edge.user&&!userNodes.has(edge.user))userNodes.set(edge.user,++userSequence);
    // Loading/virtualizing earlier turns cannot create a new current run. A stable
    // provider message ID (or this node's local identity) identifies the frontier.
    // Repeated identical prompts in separate nodes still start separate runs.
    const userKey=edge.user?`${edge.user.getAttribute('data-message-id')||'node-'+userNodes.get(edge.user)}:${userValue.length}:${hash(userValue.slice(-100))}`:'';
    if(canonical!==lastUrl){lastUrl=canonical;wasRunning=false;lastStatus='idle';lastUserKey='';runId='';completionAt=0;}
    if(userKey!==lastUserKey){lastUserKey=userKey;wasRunning=false;lastStatus='idle';runId=crypto.randomUUID();completionAt=0;}
    const buttons=[...document.querySelectorAll('button,[role="button"]')].slice(-180);
    const stop=buttons.find(el=>usable(el)&&current(el,edge)&&(/^(?:stop(?: generating| response| streaming| responding| generation)?|cancel (?:generation|response))$/i.test(label(el))||el.getAttribute('data-testid')==='stop-button'));
    const busy=[...(edge.assistant?.querySelectorAll?.('[aria-busy="true"],[data-is-streaming="true"],[data-state="streaming"]')||[])].some(visible)||Boolean(edge.assistant?.matches?.('[aria-busy="true"],[data-is-streaming="true"],[data-state="streaming"]')&&visible(edge.assistant));
    const permission=permissionButton(edge);
    const notices=[...document.querySelectorAll('[role="alert"],[role="alertdialog"],[data-testid*="error"],[data-testid*="limit"],[data-state="error"]')].slice(-80)
      .filter(el=>visible(el)&&current(el,edge));
    const notice=clean(notices.map(el=>clean(el.textContent,500)).join(' '),2000);
    const finalControl=buttons.some(el=>usable(el)&&current(el,edge)&&Boolean(edge.assistant&&(edge.assistant.contains(el)||(edge.assistant.parentElement&&!edge.assistant.parentElement.contains(edge.user)&&edge.assistant.parentElement.contains(el))))&&(/^(?:copy(?: response| answer)?|good response|bad response|retry|regenerate(?: response)?)$/i.test(label(el))||el.getAttribute('data-testid')==='copy-turn-action-button'));
    let status='idle',reason='';
    if(permission){status='permission_required';reason=`${label(permission)} · review the permission in this chat.`;completionAt=0;}
    else if(/(?:conversation.{0,70}(?:too long|limit)|context (?:window|length)|maximum.{0,30}(?:conversation|context)|start a new chat)/i.test(notice)){status='context_limit';reason=clean(notice,240);completionAt=0;}
    else if(/(?:too many requests|rate.?limit|usage limit|message limit|try again (?:in|after)|reached.{0,40}(?:limit|cap))/i.test(notice)){status='rate_limited';reason=clean(notice,240);completionAt=0;}
    else if(/(?:sign in|log in|session expired)/i.test(notice)){status='waiting_for_user';reason='The provider is asking you to sign in.';completionAt=0;}
    else if(/(?:something went wrong|failed to|error|network|disconnected|connection (?:lost|interrupted)|unable to|generation (?:failed|stopped))/i.test(notice)){status='error';reason=clean(notice,240);completionAt=0;}
    else if(stop||busy){status='running';reason='The provider shows current generation activity.';if(!wasRunning&&!runId)runId=crypto.randomUUID();wasRunning=true;completionAt=0;}
    else if(wasRunning&&edge.assistant){
      // An old response above the current user turn is insufficient. Settle briefly
      // when a provider lacks final-action controls; this is one deadline, not polling.
      if(!completionAt)completionAt=Date.now();
      if(finalControl||Date.now()-completionAt>=1200){status='completed';reason='Current generation stopped and an assistant response is visible.';wasRunning=false;completionAt=0;}
      else {status='running';reason='Waiting for the current response to settle.';schedule(1250);}
    } else if(lastStatus==='completed'&&edge.assistant){status='completed';reason='Latest observed response finished.';}
    if(status==='idle')wasRunning=false;
    lastStatus=status;
    const event={documentId,runId,url:canonical,title:clean(document.title)||'Agent chat',status,reason,observedAt:Date.now(),authoritative:true};
    return {event,signature:JSON.stringify([event.url,event.title,event.runId,event.status,event.reason,status==='running'?progressKey(edge):''])};
  }
  function sendObservation(event){
    return new Promise(resolve=>{
      let settled=false,timeout;
      const finish=result=>{
        if(settled)return;settled=true;
        if(timeout)clearTimeout(timeout);pendingDeliveries.delete(cancel);
        resolve(result);
      };
      const cancel=()=>finish({ok:false,error:'The sensor document is unavailable.'});
      pendingDeliveries.add(cancel);
      timeout=setTimeout(()=>finish({ok:false,error:'The monitor did not acknowledge this observation within four seconds.'}),DELIVERY_TIMEOUT_MS);
      try {
        Promise.resolve(api.runtime.sendMessage({type:'PC_SENSOR_OBSERVE',event})).then(finish,error=>finish({ok:false,error:clean(error?.message||error,240)}));
      }catch(error){finish({ok:false,error:clean(error?.message||error,240)});}
    });
  }
  async function sample(force=false,retryAttempt=0){
    if(timer)clearTimeout(timer);timer=null;if(destroyed||paused||!document.body)return {ok:false,error:'The sensor document is unavailable.'};
    const {event,signature}=read();if(!force&&signature===lastSignature)return {ok:true,unchanged:true};
    if(signature!==lastSignature)retryAttempt=0;
    lastSignature=signature;
    if(deliveryTimer)clearTimeout(deliveryTimer);deliveryTimer=null;
    const sequence=++deliverySequence;
    let result;
    try {
      result=await sendObservation(event);
      if(result?.ok!==true)result={ok:false,error:clean(result?.error||'The monitor did not accept this observation.',240)};
    }catch(error){result={ok:false,error:clean(error?.message||error,240)};}
    // A late failure from an older snapshot cannot invalidate a newer delivery or
    // enqueue obsolete evidence after navigation. Retries always resample the DOM.
    if(!destroyed&&!paused&&sequence===deliverySequence){
      lastDelivery={ok:result.ok===true,attempts:retryAttempt+1,error:result.ok===true?'':result.error};
      if(result.ok!==true&&retryAttempt<DELIVERY_RETRY_MS.length)deliveryTimer=setTimeout(()=>{
        deliveryTimer=null;void sample(true,retryAttempt+1);
      },DELIVERY_RETRY_MS[retryAttempt]);
    }
    return result;
  }
  function schedule(delay=180){if(timer||destroyed||paused)return;timer=setTimeout(()=>sample(),delay);}
  function start(){
    if(destroyed||paused||!document.body)return;
    if(!observer)observer=new MutationObserver(records=>{if(records.some(record=>!(record.target?.closest?.(OWNED)||record.target?.parentElement?.closest?.(OWNED))))schedule();});
    observer.observe(document.documentElement||document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-label','aria-hidden','aria-disabled','aria-busy','data-is-streaming','data-state','data-testid','hidden','disabled','style','class']});
    return sample(true);
  }
  const listener=message=>{
    if(message?.type==='PC_MONITOR_RESCAN')return sample(true);
    if(message?.type==='PC_ATTENTION_REVEAL_PERMISSION'){
      const control=permissionButton();if(control){control.scrollIntoView({block:'center',behavior:'instant'});control.focus({preventScroll:true});}
      return Promise.resolve({ok:Boolean(control),manualReview:true});
    }
    return undefined;
  };
  api.runtime.onMessage.addListener(listener);
  const forceSample=()=>sample(true);
  const pageshow=()=>{if(destroyed)return;paused=false;return start();};
  document.addEventListener('visibilitychange',forceSample);window.addEventListener('pageshow',pageshow);window.addEventListener('popstate',forceSample);window.addEventListener('hashchange',forceSample);
  const pagehide=()=>{
    paused=true;if(timer)clearTimeout(timer);timer=null;if(deliveryTimer)clearTimeout(deliveryTimer);deliveryTimer=null;deliverySequence++;
    observer?.disconnect();for(const cancel of [...pendingDeliveries])cancel();
  };window.addEventListener('pagehide',pagehide);
  const sensor={version:VERSION,rescan:forceSample,get delivery(){return {...lastDelivery};},dispose(){
    destroyed=true;pagehide();api.runtime.onMessage.removeListener?.(listener);document.removeEventListener('DOMContentLoaded',start);document.removeEventListener('visibilitychange',forceSample);
    window.removeEventListener('pageshow',pageshow);for(const name of ['popstate','hashchange'])window.removeEventListener(name,forceSample);window.removeEventListener('pagehide',pagehide);
    if(globalThis.__pcBrowserMonitorSensor===sensor)delete globalThis.__pcBrowserMonitorSensor;
  }};
  globalThis.__pcBrowserMonitorSensor=sensor;
  if(document.body)start();else document.addEventListener('DOMContentLoaded',start,{once:true});
})();
