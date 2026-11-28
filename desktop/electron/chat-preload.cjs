'use strict';

const { ipcRenderer } = require('electron');

(() => {
  const VERSION = '0.23.0';
  const CONTEXT_OPEN = '[PROJECT CONSTELLATION LOCAL CONTEXT]';
  const CONTEXT_CLOSE = '[/PROJECT CONSTELLATION LOCAL CONTEXT]';
  const RESULT_OPEN = '[PC BUDDY TOOL RESULT]';
  const RESULT_CLOSE = '[/PC BUDDY TOOL RESULT]';
  const PAGE_SOURCE = 'constellation-commander-page-hook';
  const CONTENT_SOURCE = 'constellation-commander-content';
  const CALL_OPEN = '[PC_BUDDY_CALL]';
  const CALL_CLOSE = '[/PC_BUDDY_CALL]';
  const handledCalls = new Set();
  const pageWaiters = new Map();
  let pageHookReady = false;
  let session = null;
  let sessionChatId = '';
  let plumbingSend = false;
  let arming = false;
  let route = location.href;
  let localToolMode = 'auto';
  let forceNextPrompt = false;
  let activeContext = null;
  let deliveryQueue = Promise.resolve();
  let scanScheduled = false;
  const oldNodes = new WeakSet();
  const claimedMessages = new Set();
  ipcRenderer.on('cc:disarm',()=>{activeContext=null;forceNextPrompt=false;cancelWatchers();});

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const diagnostic = (event, detail = {}) => ipcRenderer.invoke('cc:diagnostic', { event, detail }).catch(() => null);
  ipcRenderer.on('cc:config-changed', (_event, config = {}) => { if (['auto','always','off'].includes(config.localToolMode)) { localToolMode = config.localToolMode; if(localToolMode==='off'){activeContext=null;forceNextPrompt=false;cancelWatchers();} } });
  ipcRenderer.on('cc:arm-next', () => { forceNextPrompt = true; toast('Project Constellation armed for the next message.'); void diagnostic('force-next-armed', { chatId: chatId() }); });
  void diagnostic('preload-loaded', { url: location.href, readyState: document.readyState });

  function toast(message, kind = 'info', sticky = false) {
    const id = 'constellation-commander-electron-toast';
    let node = document.getElementById(id);
    if (!node) {
      node = document.createElement('div');
      node.id = id;
      Object.assign(node.style, {
        position: 'fixed', right: '18px', bottom: '18px', zIndex: '2147483647', maxWidth: '440px',
        padding: '10px 13px', borderRadius: '10px', font: '13px/1.35 system-ui,sans-serif', color: '#fff',
        boxShadow: '0 8px 28px rgba(0,0,0,.35)', transition: 'opacity .15s ease', pointerEvents: 'none'
      });
      document.documentElement.appendChild(node);
    }
    node.textContent = message;
    node.style.background = kind === 'error' ? '#991b1b' : kind === 'warn' ? '#a16207' : '#166534';
    node.style.opacity = '1';
    clearTimeout(toast._timer);
    if (!sticky) toast._timer = setTimeout(() => { if (node) node.style.opacity = '0'; }, 2500);
  }

  function chatId() {
    const match = location.pathname.match(/\/c\/([^/?#]+)/i);
    return match?.[1] || `route:${location.pathname}${location.search}`;
  }

function sameConversation(first, second) {
  try {
    const identity = raw => {
      const u = new URL(raw), match=u.pathname.match(/\/c\/([^/]+)/);
      return u.protocol+'//'+u.host+(match?'/c/'+match[1]:u.pathname.replace(/\/$/,''));
    };
    return identity(first)===identity(second);
  } catch {return false;}
}

  function composer() {
    const selectors = [
      '#prompt-textarea.ProseMirror[contenteditable="true"]', '#prompt-textarea[contenteditable="true"]',
      'div.ProseMirror[contenteditable="true"][role="textbox"]', '[contenteditable="true"][role="textbox"]',
      'textarea[name="prompt-textarea"]', 'textarea[placeholder]'
    ];
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        if (!(node instanceof HTMLElement) || node.getAttribute('aria-disabled') === 'true') continue;
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        if (style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 20 && rect.height > 10) return node;
      }
    }
    return null;
  }

  function getComposerText(node) {
    if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) return node.value || '';
    return node?.innerText || node?.textContent || '';
  }

  function composerContains(node, value) {
    const normalize = text => String(text || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    const actual = normalize(getComposerText(node));
    const expected = normalize(value);
    return expected ? actual === expected : !actual;
  }

  function selectEditableContents(node) {
    const selection = window.getSelection?.();
    if (!selection) return false;
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  function setComposerText(node, text) {
    if (!node) return false;
    const value = String(text ?? '');
    node.focus();
    if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) {
      const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(node, value); else node.value = value;
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
      return composerContains(node, value);
    }
    let inserted = false;
    try { selectEditableContents(node); inserted = Boolean(document.execCommand?.('insertText', false, value)); } catch {}
    if (!inserted || !composerContains(node, value)) {
      try {
        selectEditableContents(node);
        const transfer = new DataTransfer(); transfer.setData('text/plain', value);
        node.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, composed: true, clipboardData: transfer }));
      } catch {}
    }
    if (!composerContains(node, value)) {
      const fragment = document.createDocumentFragment();
      for (const line of value.split('\n')) { const p = document.createElement('p'); if (line) p.textContent = line; else p.appendChild(document.createElement('br')); fragment.appendChild(p); }
      node.replaceChildren(fragment);
      node.dispatchEvent(new Event('input', { bubbles: true }));
    }
    node.dispatchEvent(new Event('change', { bubbles: true }));
    return composerContains(node, value);
  }

  function sendButton(node) {
    const scope = node?.closest('form') || node?.parentElement?.parentElement || document;
    const selectors = '#composer-submit-button,[data-testid="send-button"],button[aria-label*="send" i],button[data-testid*="send" i],button[type="submit"]';
    return [...(scope.querySelectorAll?.(selectors) || [])].find(button => !button.disabled && !/stop|cancel/i.test(`${button.getAttribute('aria-label') || ''} ${button.textContent || ''}`)) || null;
  }

  function recentConversationMentionsCommander() {
    const turns = [...document.querySelectorAll('[data-message-author-role="assistant"],[data-message-author-role="user"],article[data-turn]')].slice(-10);
    return turns.some(node => /Project Constellation|Constellation Commander|computer use|take control|local companion/i.test(node.textContent || ''));
  }

  function isLocalIntent(text) {
    const value = String(text || '').trim();
    if (!value || value.includes(CONTEXT_OPEN) || value.includes(RESULT_OPEN)) return false;
    if (localToolMode === 'off') return false;
    if (forceNextPrompt) return true;
    if (localToolMode === 'always') return true;
    if(activeContext && sameConversation(activeContext.url,location.href))return true;
    if (/\b(take|gain|give|have)\s+(?:full\s+)?control\b|\bcontrol\s+(?:my|this|the)?\s*(?:computer|pc|desktop|laptop|machine|workstation|screen)?\b/i.test(value)) return true;
    if (/\b(full\s+computer\s+use|computer[- ]use|use\s+my\s+(?:computer|pc|desktop|screen)|drive\s+my\s+(?:mouse|keyboard)|move\s+my\s+mouse|see\s+my\s+screen|remote\s+control)\b/i.test(value)) return true;
    if (/\b(local|locally|filesystem|file system|powershell|cmd|terminal|process|folder|directory|screen|screenshot|mouse|keyboard|clipboard|window|desktop|computer|pc|workstation|computer use)\b/i.test(value)) return true;
    if (/\b(open|read|write|edit|rename|move|copy|delete|trash|create|run|launch|kill|search|find|click|drag|scroll|type|press|focus|maximize|minimize|close|inspect|capture)\b.{0,70}\b(file|folder|directory|process|program|app|script|command|screen|desktop|window|button|menu|mouse|keyboard)\b/i.test(value)) return true;
    if (/(?:^|\s)[A-Za-z]:\\[^\s]+/.test(value) || /(?:^|\s)\\\\[^\s]+/.test(value)) return true;
    return /^(try again|test it|test now|do it|go ahead|continue|take over|use it|again|now)[.! ]*$/i.test(value) && recentConversationMentionsCommander();
  }

  async function ensureSession(force = false) {
    const id = chatId();
    if (!force && session && sessionChatId === id && Date.parse(session.expiresAt || '') > Date.now() + 30000) return session;
    const response = await ipcRenderer.invoke('cc:bootstrap', { chatId: id, url: location.href, renew: force });
    if (!response?.ok) throw new Error(response?.error || 'Integrated Project Constellation runtime is offline.');
    session = response; sessionChatId = id; return session;
  }

  function contextText(s) {
    return `${CONTEXT_OPEN}\n${JSON.stringify({ version: 3, product: 'Project Constellation', source: 'electron-integrated-workspace', companionVersion: VERSION, nonce: s.nonce, expiresAt: s.expiresAt, tools: s.tools || [], contract: s.contract })}\n${CONTEXT_CLOSE}`;
  }

  function attachmentFile(attachment) {
    if (!attachment?.base64 || !attachment?.mimeType) return null;
    const raw = atob(attachment.base64); const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return new File([bytes], attachment.name || 'computer-screenshot.jpg', { type: attachment.mimeType });
  }

  async function attachFiles(attachments) {
    const files = (attachments || []).map(attachmentFile).filter(Boolean);
    if (!files.length) return;
    let input = document.querySelector('input#upload-files') || document.querySelector('input#upload-photos') || [...document.querySelectorAll('input[type="file"]')].find(el => !el.disabled);
    if (!input) {
      const addButton = document.querySelector('[data-testid="composer-plus-btn"]') || [...document.querySelectorAll('button')].find(button => /attach|upload|add files|photos/i.test(`${button.getAttribute('aria-label') || ''} ${button.textContent || ''}`));
      addButton?.click();
      for (let i = 0; i < 30 && !input; i++) { await sleep(100); input = document.querySelector('input#upload-files') || document.querySelector('input#upload-photos') || [...document.querySelectorAll('input[type="file"]')].find(el => !el.disabled); }
    }
    if (!input) throw new Error('ChatGPT file input is unavailable for the Project Constellation screenshot.');
    const transfer = new DataTransfer(); for (const file of files) transfer.items.add(file);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
    if (setter) setter.call(input, transfer.files); else input.files = transfer.files;
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
    // Wait for the upload to finish rather than assuming 500 ms is enough.
    const deadline=Date.now()+30000;
    while(document.querySelector('[role=\"progressbar\"],[data-testid*=\"uploading\"]')){if(Date.now()>deadline)throw new Error('Screenshot upload is still in progress. Result retained for retry.');await sleep(100);}
  }

  async function waitPageHookReady(timeout = 2500) {
    if (pageHookReady) return true;
    const until = Date.now() + timeout;
    while (!pageHookReady && Date.now() < until) await sleep(40);
    return pageHookReady;
  }

  // A handshake arms observation; only the correlated HTTP receipt confirms delivery.
  function watchRequest(original, context = null) {
    const id = crypto.randomUUID();
    let resolveReady, resolveResult;
    const ready = new Promise(resolve => { resolveReady = resolve; });
    const promise = new Promise(resolve => { resolveResult = resolve; });
    const waiter = { resolveReady, resolveResult, acknowledged: false, started: false };
    const finish = result => {
      clearTimeout(waiter.armTimer); clearTimeout(waiter.timer);
      pageWaiters.delete(id);
      if (!waiter.acknowledged) resolveReady(result);
      resolveResult(result);
    };
    waiter.finish = finish;
    waiter.armTimer = setTimeout(() => finish({ok:false,reason:'Chat adapter did not acknowledge the request.'}), 3000);
    waiter.timer = setTimeout(() => finish({ok:false,reason:waiter.started ? 'ChatGPT has not acknowledged the request. Result retained.' : 'Conversation request not observed. Result retained; no automatic resend.'}), 30000);
    pageWaiters.set(id, waiter);
    window.postMessage({source:CONTENT_SOURCE,type:context===null?'CC_WATCH_DELIVERY_V3':'CC_ARM_CONTEXT_V2',id,original,context}, '*');
    return {id, ready, promise, cancel:() => {
      window.postMessage({source:CONTENT_SOURCE,type:'CC_CANCEL_REQUEST_V3',id},'*');
      finish({ok:false,reason:'Request observation canceled.'});
    }};
  }
  function armPageHook(original, context) { return watchRequest(original, context); }
  function cancelWatchers() {
    for(const [id,waiter] of pageWaiters){window.postMessage({source:CONTENT_SOURCE,type:'CC_CANCEL_REQUEST_V3',id},'*');waiter.finish({ok:false,reason:'Computer access stopped.'});}
  }

  window.addEventListener('message', event => {
    if (event.source !== window || event.data?.source !== PAGE_SOURCE) return;
    const data=event.data, waiter=pageWaiters.get(data.id);
    if(data.type==='CC_PAGE_HOOK_READY_V2') {
      pageHookReady=data.receipts===true;
      void diagnostic('page-hook-ready',{receipts:pageHookReady}); return;
    }
    if(!waiter)return;
    if(data.type==='CC_PAGE_CONTEXT_ARMED_V2') {
      waiter.acknowledged=true; clearTimeout(waiter.armTimer); waiter.resolveReady({ok:true});
    } else if(data.type==='CC_REQUEST_STARTED_V3') {
      waiter.started=true; void diagnostic('request-started',{});
    } else if(data.type==='CC_PAGE_CONTEXT_INJECTED_V2') {
      void diagnostic('context-injected',{chatId:chatId()});
    } else if(data.type==='CC_REQUEST_ACCEPTED_V3') {
      waiter.finish({ok:true,status:data.status}); void diagnostic('request-accepted',{status:data.status});
    } else if(['CC_REQUEST_FAILED_V3','CC_PAGE_CONTEXT_MISSED_V2'].includes(data.type)) {
      waiter.finish({ok:false,reason:data.reason||'Request not accepted.',status:data.status});
    }
  });

  function isGenerating() {
    return Boolean(document.querySelector('[data-testid="stop-button"],button[aria-label="Stop generating"],button[aria-label="Stop streaming"],[data-is-streaming="true"]'));
  }
  async function waitToDeliver(expectedRoute) {
    const deadline=Date.now()+90000;
    while(isGenerating()) {
      if(!sameConversation(location.href,expectedRoute))throw new Error('Conversation changed. Completed result stays in Activity.');
      if(Date.now()>deadline)throw new Error('ChatGPT is still generating. Use Retry in Activity when it finishes.');
      await sleep(100);
    }
  }

  async function triggerSend(node) {
    let button = null;
    for (let i = 0; i < 60 && !button; i++) { await sleep(i ? 75 : 30); button = sendButton(node); }
    if (!button) throw new Error('ChatGPT Send button is unavailable.');
    button.click();
  }

  async function sendText(text, { internal = false, attachments = [], expectedRoute = location.href } = {}) {
    const send=async()=>{
      if(!sameConversation(location.href,expectedRoute))throw new Error('Conversation changed. Result was not sent to another chat.');
      await waitToDeliver(expectedRoute);
      let node=composer();
      if(!node)throw new Error('ChatGPT composer unavailable. Open the original chat and Retry in Activity.');
      const draft=getComposerText(node), staged=composerContains(node,text);
      if(draft.trim()&&!staged)throw new Error('Your unsent draft is preserved. Send or clear it before retrying the saved result.');
      if(!await waitPageHookReady())throw new Error('Chat adapter not ready. Reload ChatGPT, then Retry in Activity.');
      let observation;
      plumbingSend=internal;
      try{
        if(attachments.length&&!staged)await attachFiles(attachments);
        if(!sameConversation(location.href,expectedRoute))throw new Error('Conversation changed while attaching the result.');
        node=composer();
        if(!node)throw new Error('ChatGPT composer disappeared. Result retained.');
        if(getComposerText(node).trim()&&!composerContains(node,text))throw new Error('A new draft appeared while preparing the result. Your draft is preserved.');
        if(!setComposerText(node,text))throw new Error('Could not stage the complete tool result.');
        observation=watchRequest(text);
        const armed=await observation.ready;
        if(!armed.ok)throw new Error(armed.reason);
        if(!sameConversation(location.href,expectedRoute)||!composerContains(node,text))throw new Error('The conversation or draft changed before sending. Result retained.');
        await triggerSend(node);
        const receipt=await observation.promise;
        if(!receipt.ok)throw new Error(receipt.reason);
        if(!sameConversation(location.href,expectedRoute))throw new Error('Conversation changed during delivery. Check Activity in the original chat.');
      }finally{observation?.cancel();plumbingSend=false;}
    };
    const next=deliveryQueue.catch(()=>{}).then(send);deliveryQueue=next;return next;
  }

  function scrubInternalContext() {
    const candidates = [...document.querySelectorAll('[data-message-author-role="user"],article[data-turn="user"],[data-testid^="conversation-turn-"]')];
    for (const node of candidates.slice(-14)) {
      const text = node.textContent || '';
      const contextAt = text.indexOf(CONTEXT_OPEN); const resultAt = text.indexOf(RESULT_OPEN);
      const cut = contextAt >= 0 ? contextAt : resultAt >= 0 ? resultAt : -1;
      if (cut < 0) continue;
      if (resultAt >= 0) { node.style.display = 'none'; node.dataset.constellationCommanderHidden = 'tool-result'; continue; }
      const visible = text.slice(0, cut).trim();
      const leaf = [...node.querySelectorAll('p,div')].find(el => (el.textContent || '').includes(CONTEXT_OPEN));
      if (leaf) leaf.textContent = visible; else node.textContent = visible;
    }
  }

  async function armAndSend(original) {
    if (arming) return;
    arming = true;
    let hook;
    activeContext=null;
    for(const node of assistantCandidates())oldNodes.add(node);
    void diagnostic('arm-start', { chatId: chatId(), text: String(original || '').slice(0, 80) });
    try {
      const s = await ensureSession(true);
      const context = contextText(s);
      activeContext={chatId:sessionChatId,url:location.href,nonce:s.nonce,initial:!location.pathname.includes('/c/'),results:0};
      const node = composer(); if (!node) throw new Error('ChatGPT composer is unavailable.');
      const hookReady = await waitPageHookReady();
      if (hookReady) {
        hook = armPageHook(original.trim(), context);
        const armed=await hook.ready;
        if(!armed.ok)throw new Error(armed.reason);
        await triggerSend(node);
        const proof = await hook.promise;
        void diagnostic('arm-hook-proof', { ok: Boolean(proof?.ok), reason: proof?.reason || '', timeout: Boolean(proof?.timeout) });
        hook.cancel();
        if (!proof.ok) throw new Error(`Integrated request hook missed the ChatGPT send: ${proof.reason || 'timeout'}`);
      } else {
        throw new Error('ChatGPT request adapter unavailable. Your prompt was not sent. Reload ChatGPT and retry.');
      }
      toast('Local request accepted. Waiting for ChatGPT to call a tool.');
      setTimeout(scrubInternalContext, 200); setTimeout(scrubInternalContext, 900);
    } catch (error) {
      activeContext=null;
      toast(`Commander: ${String(error?.message || error)}`, 'error', true);
      void diagnostic('arm-failed', { error: String(error?.message || error), chatId: chatId() });
    } finally { hook?.cancel(); arming = false; }
  }

  function interceptSend(event) {
    if (plumbingSend || arming) return;
    const node = composer(); if (!node) return;
    const text = getComposerText(node); if (!isLocalIntent(text)) { if(text.trim())activeContext=null; return; }
    forceNextPrompt = false;
    void diagnostic('intercept-send', { type: event.type, chatId: chatId(), text: String(text || '').slice(0, 80) });
    event.preventDefault(); event.stopImmediatePropagation(); void armAndSend(text);
  }

  document.addEventListener('submit', interceptSend, true);
  document.addEventListener('click', event => {
    if (plumbingSend || arming) return;
    const node = composer(); const button = node && sendButton(node);
    if (button && (event.target === button || button.contains(event.target))) interceptSend(event);
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    const node = composer(); if (node && (event.target === node || node.contains(event.target))) interceptSend(event);
  }, true);

  function extractCall(text) {
    text=String(text||'').trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i,'$1').trim();
    const start = text.indexOf(CALL_OPEN);
    if (start !== 0) return { present: false };
    const end = text.indexOf(CALL_CLOSE, start + CALL_OPEN.length);
    if (end < 0) return { present: true, complete: false };
    if(text.slice(end+CALL_CLOSE.length).trim())return {present:false};
    const raw = text.slice(start + CALL_OPEN.length, end).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    try {
      const parsed = JSON.parse(raw);
      if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('Expected a tool-call object.');
      parsed.id ||= crypto.randomUUID?.() || `electron_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      parsed.args = parsed.args && typeof parsed.args === 'object' ? parsed.args : parsed.arguments && typeof parsed.arguments === 'object' ? parsed.arguments : parsed.input && typeof parsed.input === 'object' ? parsed.input : {};
      delete parsed.arguments; delete parsed.input;
      if (!parsed || typeof parsed!=='object'||Array.isArray(parsed)||!parsed.nonce||parsed.nonce!==activeContext?.nonce) return {present:true,complete:true,error:new Error('Missing or stale call authorization.')};
      return { present: true, complete: true, call: parsed };
    } catch (error) { return { present: true, complete: true, error }; }
  }

  async function handleCall(call) {
    if(!activeContext || localToolMode==='off' || !call?.id || handledCalls.has(call.id))return;
    handledCalls.add(call.id);
    const context=activeContext;
    let response;
    try{
      if(call.nonce!==context.nonce)throw new Error('Call authorization no longer matches. Arm a new request.');
      response=await ipcRenderer.invoke('cc:call',{chatId:context.chatId,call});
    }catch(error){response={ok:false,error:String(error?.message||error),id:call.id,tool:call.tool};}
    const attachments=response?._attachments||[],safe={...response};delete safe._attachments;
    const payload=`${RESULT_OPEN}\n${JSON.stringify({id:call.id,tool:call.tool,...safe})}\n${RESULT_CLOSE}`;
    // The action result is saved BEFORE trying the network-facing composer.
    const pending={id:crypto.randomUUID(),callId:call.id,tool:call.tool,url:context.url,payload,attachments};
    try{await ipcRenderer.invoke('cc:save-result',pending);}catch(error){
      toast('Could not save the completed result. Do not repeat the action. Check the data folder.','error',true);
      await diagnostic('result-save-failed',{id:call.id,tool:call.tool,error:String(error?.message||error)});return;
    }
    try{
      if(activeContext!==context)throw new Error('Conversation authorization changed. Result saved; action was not repeated.');
      await sendText(payload,{internal:true,attachments,expectedRoute:context.url});
      await ipcRenderer.invoke('cc:ack-result',{id:pending.id});
      context.results++;
      const visibleLeak=assistantCandidates().some(node=>(node.textContent||'').trim().startsWith(CALL_OPEN)&&getComputedStyle(node).display!=='none'&&getComputedStyle(node).visibility!=='hidden');
      await diagnostic('tool-result-sent',{tool:call.tool,ok:response?.ok!==false,pong: response?.result?.pong === true,visibleLeak,chatId:context.chatId});
    }catch(error){
      toast(`Action result saved: ${String(error?.message||error)}`,'warn',true);
      await diagnostic('delivery-pending',{id:call.id,tool:call.tool,error:String(error?.message||error)});
    }
  }
  ipcRenderer.on('cc:test-connection',async()=>{
    if(localToolMode==='off'){toast('Enable local tools before testing.','warn',true);return;}
    const node=composer();
    if(!node||getComposerText(node).trim()||isGenerating()){toast('Finish the response and send or clear your draft before testing.','warn',true);return;}
    const prompt='Test this computer connection: call the Project Constellation ping tool exactly once and report the actual device name from its result.';
    if(!setComposerText(node,prompt)){toast('Could not prepare the connection test.','error',true);return;}
    await armAndSend(prompt);
  });

  ipcRenderer.on('cc:deliver-pending',async(_event,pending)=>{
    try{
      await sendText(pending.payload,{internal:true,attachments:pending.attachments||[],expectedRoute:pending.url});
      await ipcRenderer.invoke('cc:ack-result',{id:pending.id});
      await diagnostic('saved-result-delivered',{id:pending.id,tool:pending.tool});
    }catch(error){await diagnostic('delivery-pending',{id:pending.id,error:String(error?.message||error)});}
  });

  function assistantCandidates() {
    // Never search arbitrary main descendants or user conversation-turn wrappers.
    const nodes=[...document.querySelectorAll('[data-message-author-role="assistant"],article[data-turn="assistant"]')];
    return nodes.filter(node=>!node.parentElement?.closest('[data-message-author-role="assistant"],article[data-turn="assistant"]'));
  }

  function scanAssistantCalls() {
    if(!activeContext||localToolMode==='off')return;
    if(!sameConversation(location.href,activeContext.url)){
      if(activeContext.initial&&location.pathname.includes('/c/')){activeContext.url=location.href;activeContext.initial=false;}
      else{activeContext=null;return;}
    }
    for (const node of assistantCandidates().slice(-24)) {
      if(oldNodes.has(node))continue;
      const body=node.querySelector('.markdown')||node;
      const clean=body.cloneNode(true);
      clean.querySelectorAll('button,[role="button"],svg').forEach(el=>el.remove());
      const codes=[...clean.querySelectorAll('pre code')];
      let text=clean.textContent||'';
      if(codes.length===1 && (codes[0].textContent||'').trim().startsWith(CALL_OPEN)) {
        const wrapper=codes[0].textContent;
        codes[0].closest('pre')?.remove();
        const surrounding=(clean.textContent||'').trim();
        // A fenced action may contain its language label, never explanatory prose.
        if(!surrounding || /^(json|text|plaintext)$/i.test(surrounding))text=wrapper;
      }
      const parsed = extractCall(text);
      if (!parsed.present) continue;
      // Hide as soon as the opening marker streams in so internal control JSON can
      // never visibly leak while ChatGPT is still rendering the rest of the call.
      node.style.visibility = 'hidden';
      node.dataset.constellationCommanderHidden = 'tool-call-pending';
      if (!parsed.complete) continue;
      node.style.display = 'none';
      node.style.visibility = '';
      node.dataset.constellationCommanderHidden = 'tool-call';
      if (parsed.call) {
        if (node.dataset.constellationCommanderCallClaimed === 'true') continue;
        const identity=node.getAttribute('data-message-id')||node.closest('[data-message-id]')?.getAttribute('data-message-id')||text.trim();
        const messageKey=`${activeContext.nonce}:${identity}`;
        if(claimedMessages.has(messageKey))continue;claimedMessages.add(messageKey);
        const stableId = node.dataset.constellationCommanderCallId || parsed.call.id;
        node.dataset.constellationCommanderCallId = stableId;
        node.dataset.constellationCommanderCallClaimed = 'true';
        parsed.call.id = stableId;
        void diagnostic('assistant-call-detected', { tool: String(parsed.call.tool || parsed.call.name || ''), id: String(parsed.call.id || '') });
        void handleCall(parsed.call);
      } else toast('Project Constellation received malformed local-call JSON and suppressed it.', 'error', true);
    }
    scrubInternalContext();
  }

  const observer = new MutationObserver(()=>{if(scanScheduled)return;scanScheduled=true;setTimeout(()=>{scanScheduled=false;scanAssistantCalls();},30);});
  function startAssistantObserver() {
    const root = document.documentElement;
    if (!root) return false;
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    scanAssistantCalls();
    return true;
  }
  if (!startAssistantObserver()) window.addEventListener('DOMContentLoaded', startAssistantObserver, { once: true });

  // Integrated status badge. This is informational only; ChatGPT itself never gets
  // direct IPC or Node access.
  window.addEventListener('DOMContentLoaded', async () => {
    void diagnostic('dom-content-loaded', { url: location.href, readyState: document.readyState });
    try {
      const status = await ipcRenderer.invoke('cc:status');
      if (status?.ok) {
        if (['auto','always','off'].includes(status.localToolMode)) localToolMode = status.localToolMode;
        toast(`Project Constellation ${status.version} ready · local tools ${localToolMode}.`);
      }
    } catch {}
  });

  function handleRouteChange(nextUrl = location.href) {
    const next = String(nextUrl || location.href);
    if (next === route) return;
    route = next;
    if (activeContext?.initial && /\/c\//.test(new URL(next).pathname)) { activeContext.url = next; activeContext.initial = false; }
    else if (!sameConversation(activeContext?.url, next)) { activeContext = null; session = null; sessionChatId = ''; }
  }
  ipcRenderer.on('cc:route-changed', (_event, payload = {}) => handleRouteChange(payload.url));
  window.addEventListener('popstate', () => handleRouteChange(), { passive:true });
  window.addEventListener('hashchange', () => handleRouteChange(), { passive:true });
})();
