(function(){
  'use strict';
  if (globalThis.PCXScheduleRecoveryPage) return;
  let tokens=new Map();
  let domNoticeTimer=0;
  let lastDomSignature='';
  const norm=s=>String(s||'').replace(/[\u2010-\u2015]/g,'-').replace(/\s+/g,' ').trim();
  const hash=s=>{let h=2166136261;for(const c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return(h>>>0).toString(16)};
  const visible=e=>!!e&&e.isConnected&&!e.closest('[hidden],[aria-hidden="true"],[inert]')&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden'&&!!e.getClientRects().length;
  const label=e=>norm(e?.getAttribute('aria-label')||e?.innerText||e?.textContent||e?.value||'');
  const text=e=>norm(e?.innerText||e?.textContent||'');
  const controls=s=>[...s.querySelectorAll('button,a[href],[role="button"]')].filter(visible);
  const schedule=()=>/^\/(scheduled|schedules|tasks)(\/|$)/.test(location.pathname);
  const security=/permission required|approval required|approve (this|the) action|allow (this|the) (app|action)|grant .*access|additional approval|administrator consent|two.factor|2fa|one.time (code|password)|confirm (the )?(payment|purchase|deletion|transfer)/i;
  const forbidden=/^(allow(?: .*)?|approve(?: .*)?|confirm(?: .*)?|grant(?: .*)?|review access|review permission|always allow|never ask|don.t ask again|accept(?: .*)?)$/i;
  const recoveryControl=/^(follow[ -]?up|resume|continue generating|continue|view details|open task|log in|sign in|stop generating|stop streaming|stop response|allow(?: .*)?|approve(?: .*)?)$/i;
  const scopes=()=>{const d=[...document.querySelectorAll('[role="dialog"],[aria-modal="true"]')].filter(visible);return d.length?d:[document.querySelector('main')||document.body]};
  const approval=()=>scopes().some(s=>controls(s).some(c=>forbidden.test(label(c)))||security.test(text(s)));
  const composer=()=>[...document.querySelectorAll('#prompt-textarea,[contenteditable="true"][role="textbox"],textarea')].find(visible);
  const draft=()=>{const e=composer();return !!e&&!!norm(e.value??e.innerText)};
  const busy=()=>controls(document).some(e=>/^(stop generating|stop streaming|stop response)$/i.test(label(e))||e.getAttribute('data-testid')==='stop-button');
  const signedOut=()=>/^\/(auth|login|signin)(\/|$)/.test(location.pathname)||(controls(document).some(b=>/^(log in|sign in)$/i.test(label(b)))&&!composer());
  const challenge=()=>/^(just a moment|verify you are human|security verification)/i.test(document.title)||!![...document.querySelectorAll('iframe[src*="challenges.cloudflare.com"]')].find(visible);
  function tok(el,kind,binding){const id=crypto.randomUUID?.()||String(Date.now())+Math.random();tokens.set(id,{el,kind,binding,url:location.href,name:label(el)});return{token:id,kind}}
  function cardRoots(){return[...document.querySelectorAll('article,[role="listitem"],[data-task-id],[data-automation-id],[data-testid*="task"]')].filter(visible)}
  function cards(){
    if(!schedule())return[]; const roots=cardRoots(); const out=[];
    for(const r of roots){const raw=text(r);const h=[...r.querySelectorAll('h1,h2,h3,h4,[role="heading"]')].filter(visible).map(text).find(Boolean);const title=norm(r.getAttribute('data-task-title')||h||raw.split('\n')[0]); if(!title||/^(scheduled|tasks)$/i.test(title))continue;
      const b=controls(r).find(x=>/^(follow[ -]?up|resume|view details|open task)$/i.test(label(x))); const attention=/needs (your )?attention|action required|follow[ -]?up/i.test(raw);
      const id=r.getAttribute('data-task-id')||r.getAttribute('data-automation-id')||''; const runId=r.getAttribute('data-run-id')||r.querySelector('a[href^="/c/"]')?.getAttribute('href')||'';
      out.push({title,id,runId,attention,paused:/\bpaused\b|\bdisabled\b/i.test(raw),fingerprint:hash([title,id,runId,attention,raw.replace(/\b\d+\s+(seconds?|minutes?|hours?|days?)\s+ago\b/gi,'AGE')].join('|')),openAction:b?tok(b,'open-followup',{title,id,runId}):null});
    } return out;
  }
  function recoveryDomSignature(){
    const taskState=schedule()?cardRoots().slice(0,40).map(r=>{
      const raw=text(r).replace(/\b\d+\s+(seconds?|minutes?|hours?|days?)\s+ago\b/gi,'AGE').slice(0,700);
      const id=r.getAttribute('data-task-id')||r.getAttribute('data-automation-id')||'';
      const runId=r.getAttribute('data-run-id')||r.querySelector('a[href^="/c/"]')?.getAttribute('href')||'';
      const controlLabels=controls(r).map(label).filter(x=>recoveryControl.test(x)).slice(0,8);
      return [id,runId,/needs (your )?attention|action required|follow[ -]?up/i.test(raw)?1:0,/\bpaused\b|\bdisabled\b/i.test(raw)?1:0,controlLabels.join(','),hash(raw)].join(':');
    }):[];
    const stateControls=[...new Set(scopes().flatMap(controls).map(label).filter(x=>recoveryControl.test(x)))].slice(0,20);
    return hash(JSON.stringify({path:location.pathname,title:norm(document.title).slice(0,160),schedule:schedule(),auth:signedOut(),challenge:challenge(),approval:approval(),draft:draft(),running:busy(),controls:stateControls,tasks:taskState}));
  }
  function emitDomChanged(){
    const signature=recoveryDomSignature();
    if(signature===lastDomSignature)return;
    lastDomSignature=signature;
    chrome.runtime.sendMessage({type:'PC_SCHEDULE_RECOVERY_DOM_CHANGED',signature}).catch(()=>{});
  }
  function queueDomChanged(delay=900){
    if(domNoticeTimer)clearTimeout(domNoticeTimer);
    domNoticeTimer=setTimeout(()=>{domNoticeTimer=0;emitDomChanged()},Math.max(150,Number(delay||0)));
  }
  function inspect(active=null){tokens=new Map();const tasks=cards();const snap={url:location.href,recognized:schedule(),auth:signedOut(),challenge:challenge(),approval:approval(),draft:draft(),running:busy(),tasks,bound:false,completed:false,ambiguous:false,action:null};if(!active)return snap;
    snap.bound=tasks.some(t=>t.title===active.title&&(!active.id||t.id===active.id))||norm(document.title).includes(norm(active.title))||/^\/c\//.test(location.pathname); if(!snap.bound)return snap;
    if(snap.auth||snap.challenge||snap.approval||snap.running||snap.draft)return snap;
    const ctx=scopes().map(text).join(' ');snap.completed=(/(^|[.!?]\s)(task|run)?\s*(completed|finished successfully)[.!]?($|\s)/i.test(ctx)&&!snap.approval);const opts=[...new Set(scopes().flatMap(controls).filter(e=>/^(continue generating|resume|continue)$/i.test(label(e))))];if(opts.length>1){snap.ambiguous=true;return snap}const el=opts[0];snap.fingerprint=hash([active.title,ctx,label(el)].join('|'));if(el&&(/^continue generating$/i.test(label(el))||/interrupted|paused|stopped|resume (this|the) (task|run)|continue (this|the) (task|run)/i.test(ctx)))snap.action=tok(el,/^resume$/i.test(label(el))?'resume':'continue-generating',active);return snap;
  }
  async function act(action,active){const e=tokens.get(action?.token);tokens.clear();if(!e||e.kind!==action.kind||e.url!==location.href||!visible(e.el))return{ok:false,reason:'STALE_CONTROL'};if(signedOut()||challenge()||approval()||busy()||draft())return{ok:false,reason:'STATE_CHANGED_OR_APPROVAL'};if(forbidden.test(label(e.el))||e.el.disabled||e.el.getAttribute('aria-disabled')==='true')return{ok:false,reason:'UNSAFE_CONTROL'};e.el.click();queueDomChanged(250);return{ok:true,status:'CLICK_DISPATCHED_NOT_VERIFIED',kind:e.kind}}
  globalThis.PCXScheduleRecoveryPage={inspect,act,recoveryDomSignature};
  chrome.runtime.onMessage.addListener((m,s,r)=>{if(s.id!==chrome.runtime.id)return;if(m?.type==='PC_SCHEDULE_RECOVERY_INSPECT')r(inspect(m.active));else if(m?.type==='PC_SCHEDULE_RECOVERY_ACT'){act(m.action,m.active).then(r);return true;}});
  const mo=new MutationObserver(()=>queueDomChanged());
  if(document.documentElement)mo.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','aria-hidden','disabled','aria-disabled','data-state']});
  addEventListener('popstate',()=>queueDomChanged(150));
  addEventListener('hashchange',()=>queueDomChanged(150));
  addEventListener('pageshow',()=>queueDomChanged(200));
  queueDomChanged(250);
})();
