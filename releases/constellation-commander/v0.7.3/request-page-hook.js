/* Request-bound bridge. Never rewrites arbitrary POSTs or an older matching turn. */
(() => {
  'use strict';
  const SOURCE = 'constellation-commander-page-hook';
  const CONTEXT_OPEN='[PROJECT CONSTELLATION LOCAL CONTEXT]', CONTEXT_CLOSE='[/PROJECT CONSTELLATION LOCAL CONTEXT]';
  const post = (type, extra = {}) => { try { window.postMessage({source:SOURCE,type,...extra},'*'); } catch {} };
  if (window.__constellationHookInstalled) { post('CC_PAGE_HOOK_READY_V2',{version:'0.7.3',receipts:true}); return; }
  window.__constellationHookInstalled = true;
  let pending = null;
  const normalize = value => String(value ?? '').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
  const userLike = value => value && typeof value === 'object' && String(value.role || value.author?.role || '').toLowerCase() === 'user';
  function latestUser(payload) {
    for (const key of ['messages','input']) {
      const values=payload?.[key];
      if(Array.isArray(values)) {
        const users=values.filter(userLike);
        if(users.length)return users[users.length-1];
      }
    }
    if(userLike(payload?.message))return payload.message;
    if(userLike(payload))return payload;
    if(typeof payload?.input==='string')return payload;
    return null;
  }
  function matchingText(root, original) {
    const expected=normalize(original), hits=[];
    function visit(value,parent,key,inContent=false) {
      const content=inContent || /^(content|parts|text|input)$/.test(String(key));
      if(typeof value==='string') { if(content && normalize(value)===expected)hits.push({parent,key,value});return; }
      if(!value || typeof value!=='object')return;
      for(const [k,v] of Object.entries(value))visit(v,value,k,content);
    }
    visit(root,null,'');
    return hits.at(-1) || null;
  }
  function isConversation(input) {
    try {
      const raw=typeof input==='string'?input:input instanceof URL?input.href:input?.url;
      const url=new URL(raw,location.href);
      return url.protocol==='https:' && url.hostname==='chatgpt.com' && /^\/(?:backend-api|backend-anon)\/(?:f\/)?conversation(?:\/|$)/.test(url.pathname);
    } catch { return false; }
  }
  function active() {
    if(pending && pending.expiresAt>Date.now() && !pending.used)return pending;
    pending=null;return null;
  }
  function transform(body) {
    const item=active();
    if(!item || typeof body!=='string' || body.length>8*1024*1024)return {body,item:null};
    let payload;try{payload=JSON.parse(body);}catch{return {body,item:null};}
    const newest=latestUser(payload);if(!newest)return {body,item:null};
    let hit=matchingText(newest,item.original);
    if(!hit && item.mode==='context')hit=matchingText(newest,`${item.original}\n\n${item.context}`);
    if(!hit)return {body,item:null};
    if(item.mode==='context' && !hit.value.includes(item.context))hit.parent[hit.key]=`${hit.value}\n\n${item.context}`;
    item.used=true;pending=null;
    if(item.mode==='context')post('CC_PAGE_CONTEXT_INJECTED_V2',{id:item.id,url:location.href});
    post('CC_REQUEST_STARTED_V3',{id:item.id,mode:item.mode});
    return {body:item.mode==='context'?JSON.stringify(payload):body,item};
  }
  function receipt(item,response,error) {
    if(!item)return;
    if(error || !response || response.status<200 || response.status>=300) {
      post('CC_REQUEST_FAILED_V3',{id:item.id,status:response?.status || 0,reason:error?'Network request failed':`ChatGPT returned HTTP ${response?.status || 0}`});
    } else post('CC_REQUEST_ACCEPTED_V3',{id:item.id,status:response.status});
  }
  window.addEventListener('message',event=>{
    if(event.source!==window || event.data?.source!=='constellation-commander-content')return;
    const data=event.data;
    if(data.type==='CC_CANCEL_REQUEST_V3') { if(pending?.id===data.id)pending=null;return; }
    if(!['CC_ARM_CONTEXT_V2','CC_WATCH_DELIVERY_V3'].includes(data.type))return;
    const id=String(data.id||''), original=String(data.original||''), context=String(data.context||'');
    if(!id || !original || (data.type==='CC_ARM_CONTEXT_V2'&&(!context.startsWith(CONTEXT_OPEN)||!context.endsWith(CONTEXT_CLOSE))))return;
    pending={id,original,context,mode:data.type==='CC_ARM_CONTEXT_V2'?'context':'delivery',used:false,expiresAt:Date.now()+30000};
    post('CC_PAGE_CONTEXT_ARMED_V2',{id});
  });
  const originalFetch=window.fetch.bind(window);
  window.fetch=async function commanderFetch(input,init) {
    if(!active() || !isConversation(input))return originalFetch(input,init);
    const request=input instanceof Request?input:null;
    if(String(init?.method || request?.method || 'GET').toUpperCase()!=='POST')return originalFetch(input,init);
    let changed={item:null},nextInput=input,nextInit=init;
    try {
      if(typeof init?.body==='string') { changed=transform(init.body);if(changed.item)nextInit={...init,body:changed.body}; }
      else if(request && init?.body==null) {
        const body=await request.clone().text();changed=transform(body);
        if(changed.item)nextInput=new Request(request,{body:changed.body});
      } else if(typeof Blob!=='undefined' && init?.body instanceof Blob) {
        changed=transform(await init.body.text());if(changed.item)nextInit={...init,body:changed.body};
      }
    }catch(error){post('CC_PAGE_CONTEXT_MISSED_V2',{id:pending?.id,reason:'Unsupported conversation request body'});}
    try {const response=await originalFetch(nextInput,nextInit);receipt(changed.item,response);return response;}
    catch(error){receipt(changed.item,null,error);throw error;}
  };
  if(typeof XMLHttpRequest!=='undefined') {
    const open=XMLHttpRequest.prototype.open,send=XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open=function(method,url,...rest){this.__ccMethod=String(method).toUpperCase();this.__ccUrl=url;return open.call(this,method,url,...rest);};
    XMLHttpRequest.prototype.send=function(body){
      const changed=this.__ccMethod==='POST'&&isConversation(this.__ccUrl)?transform(body):{body,item:null};
      if(changed.item && this.addEventListener)this.addEventListener('loadend',()=>receipt(changed.item,this),{once:true});
      return send.call(this,changed.body);
    };
  }
  post('CC_PAGE_HOOK_READY_V2',{version:'0.7.3',receipts:true});
})();
