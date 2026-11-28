(() => {
  const VERSION = '0.22.0';
  const CONTEXT_OPEN = '[PROJECT CONSTELLATION LOCAL CONTEXT]';
  const CONTEXT_CLOSE = '[/PROJECT CONSTELLATION LOCAL CONTEXT]';
  const CALL_RE = /\[PC_BUDDY_CALL\](\{[\s\S]*?\})\[\/PC_BUDDY_CALL\]/;
  const RESULT_OPEN = '[PC BUDDY TOOL RESULT]';
  const RESULT_CLOSE = '[/PC BUDDY TOOL RESULT]';
  const PAGE_SOURCE = 'constellation-commander-page-hook';
  const ROUTE_SOURCE = 'project-constellation-route-observer';
  const CONTENT_SOURCE = 'constellation-commander-content';
  const handledCalls = new Set();
  const pageWaiters = new Map();
  let pageHookReady = false;
  let session = null;
  let sessionChatId = '';
  let plumbingSend = false;
  let arming = false;
  let route = location.href;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const runtimeMessage = payload => new Promise(resolve => {
    try { chrome.runtime.sendMessage(payload, response => resolve(response || { ok: false, error: chrome.runtime.lastError?.message || 'No response.' })); }
    catch (error) { resolve({ ok: false, error: String(error?.message || error) }); }
  });

  function toast(message, kind = 'info', sticky = false) {
    const id = 'constellation-commander-toast';
    let node = document.getElementById(id);
    if (!node) {
      node = document.createElement('div');
      node.id = id;
      Object.assign(node.style, {
        position: 'fixed', right: '18px', bottom: '18px', zIndex: '2147483647', maxWidth: '420px',
        padding: '10px 13px', borderRadius: '10px', font: '13px/1.35 system-ui,sans-serif', color: '#fff',
        boxShadow: '0 8px 28px rgba(0,0,0,.3)', transition: 'opacity .15s ease', pointerEvents: 'none'
      });
      document.documentElement.appendChild(node);
    }
    node.textContent = message;
    node.style.background = kind === 'error' ? '#991b1b' : kind === 'warn' ? '#a16207' : '#166534';
    node.style.opacity = '1';
    clearTimeout(toast._timer);
    if (!sticky) toast._timer = setTimeout(() => { if (node) node.style.opacity = '0'; }, 2200);
  }

  function chatId() {
    const match = location.pathname.match(/\/c\/([^/?#]+)/i);
    return match?.[1] || `route:${location.pathname}${location.search}`;
  }

  function composer() {
    const selectors = [
      '#prompt-textarea.ProseMirror[contenteditable="true"]',
      '#prompt-textarea[contenteditable="true"]',
      'div.ProseMirror[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"][role="textbox"][aria-label*="Chat" i]',
      'textarea[name="prompt-textarea"]',
      'textarea[placeholder]'
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
    if (!expected) return actual.length === 0;
    return actual.includes(expected.slice(0, Math.min(48, expected.length)));
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
      try { node.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: value })); }
      catch { node.dispatchEvent(new Event('input', { bubbles: true })); }
      node.dispatchEvent(new Event('change', { bubbles: true }));
      return composerContains(node, value);
    }

    // ChatGPT uses ProseMirror. Replace through the browser editing pipeline so
    // ProseMirror's internal document is updated instead of only mutating DOM.
    let inserted = false;
    try {
      selectEditableContents(node);
      inserted = Boolean(document.execCommand?.('insertText', false, value));
    } catch {}

    if (!inserted || !composerContains(node, value)) {
      try {
        selectEditableContents(node);
        const transfer = new DataTransfer();
        transfer.setData('text/plain', value);
        inserted = node.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, composed: true, clipboardData: transfer })) || inserted;
      } catch {}
    }

    if (!composerContains(node, value)) {
      // Last visual fallback. The MAIN-world request hook still guarantees the
      // outgoing network payload is augmented if ProseMirror ignores this DOM path.
      const fragment = document.createDocumentFragment();
      for (const line of value.split('\n')) {
        const p = document.createElement('p');
        if (line) p.textContent = line; else p.appendChild(document.createElement('br'));
        fragment.appendChild(p);
      }
      node.replaceChildren(fragment);
      try { node.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: value })); }
      catch { node.dispatchEvent(new Event('input', { bubbles: true })); }
    }
    node.dispatchEvent(new Event('change', { bubbles: true }));
    return composerContains(node, value);
  }

  function sendButton(node) {
    const scope = node?.closest('form') || node?.parentElement?.parentElement || document;
    const selectors = '#composer-submit-button,[data-testid="send-button"],button[aria-label*="send" i],button[data-testid*="send" i],button[type="submit"]';
    const buttons = [...(scope.querySelectorAll?.(selectors) || [])];
    return buttons.find(button => !button.disabled && !/stop|cancel/i.test(`${button.getAttribute('aria-label') || ''} ${button.textContent || ''}`)) || null;
  }

  function recentConversationMentionsCommander() {
    const turns = [...document.querySelectorAll('[data-message-author-role="assistant"],[data-message-author-role="user"]')].slice(-8);
    return turns.some(node => /Project Constellation|computer use|take control|local companion/i.test(node.textContent || ''));
  }

  function isLocalIntent(text) {
    const value = String(text || '').trim();
    if (!value || value.includes(CONTEXT_OPEN) || value.includes(RESULT_OPEN)) return false;
    if (/\b(take|gain|give|have)\s+(?:full\s+)?control\b|\bcontrol\s+(?:my|this|the)?\s*(?:computer|pc|desktop|laptop|machine|workstation|screen)?\b/i.test(value)) return true;
    if (/\b(full\s+computer\s+use|computer[- ]use|use\s+my\s+(?:computer|pc|desktop|screen)|drive\s+my\s+(?:mouse|keyboard)|move\s+my\s+mouse|see\s+my\s+screen|remote\s+control)\b/i.test(value)) return true;
    if (/\b(my|this|the)\s+(computer|pc|desktop|laptop|machine|workstation)\b/i.test(value)) return true;
    if (/\b(local|locally|on disk|filesystem|file system|powershell|cmd|terminal|process|folder|directory|screen|screenshot|mouse|keyboard|clipboard|window|desktop|computer use)\b/i.test(value)) return true;
    if (/\b(open|read|write|edit|rename|move|copy|delete|trash|create|run|launch|kill|search|find|click|double.?click|drag|scroll|type|press|focus|maximize|minimize|close|look|see|inspect|capture)\b.{0,70}\b(file|folder|directory|process|program|app|script|command|txt|json|log|jar|zip|exe|screen|desktop|window|button|menu|mouse|keyboard)\b/i.test(value)) return true;
    if (/(?:^|\s)[A-Za-z]:\\[^\s]+/.test(value) || /(?:^|\s)\\\\[^\s]+/.test(value)) return true;
    if (/^(try again|test it|test now|do it|go ahead|continue|take over|use it|again|now)[.! ]*$/i.test(value) && recentConversationMentionsCommander()) return true;
    return false;
  }

  async function ensureSession(force = false) {
    const id = chatId();
    if (!force && session && sessionChatId === id && Date.parse(session.expiresAt || '') > Date.now() + 30000) return session;
    const response = await runtimeMessage({ type: 'CC_BOOTSTRAP', chatId: id, url: location.href });
    if (response?.versionMismatch) throw new Error(`Browser companion ${VERSION} does not match local Project Constellation ${response.expectedVersion || 'version'}. Reload the unpacked extension once.`);
    if (!response?.ok) throw new Error(response?.error || 'Project Constellation local bridge is offline.');
    session = response;
    sessionChatId = id;
    return session;
  }

  function contextText(s) {
    const manifest = (s.tools || []).map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }));
    return `${CONTEXT_OPEN}\n${JSON.stringify({
      version: 2,
      product: 'Project Constellation',
      source: 'normal-chat-browser-companion',
      companionVersion: VERSION,
      nonce: s.nonce,
      expiresAt: s.expiresAt,
      tools: manifest,
      contract: s.contract
    })}\n${CONTEXT_CLOSE}`;
  }

  function attachmentFile(attachment) {
    if (!attachment?.base64 || !attachment?.mimeType) return null;
    const raw = atob(attachment.base64);
    const bytes = new Uint8Array(raw.length);
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
      for (let i = 0; i < 25 && !input; i++) { await sleep(100); input = document.querySelector('input#upload-files') || document.querySelector('input#upload-photos') || [...document.querySelectorAll('input[type="file"]')].find(el => !el.disabled); }
    }
    if (!input) throw new Error('ChatGPT file input is not available for the computer screenshot.');
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
    if (setter) setter.call(input, transfer.files); else input.files = transfer.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(500);
  }

  async function waitPageHookReady(timeout = 1200) {
    if (pageHookReady) return true;
    const until = Date.now() + timeout;
    while (!pageHookReady && Date.now() < until) await sleep(40);
    return pageHookReady;
  }

  function armPageHook(original, context) {
    const id = crypto.randomUUID?.() || `cc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const promise = new Promise(resolve => {
      const timer = setTimeout(() => { pageWaiters.delete(id); resolve({ ok: false, timeout: true }); }, 4000);
      pageWaiters.set(id, { resolve, timer });
    });
    window.postMessage({ source: CONTENT_SOURCE, type: 'CC_ARM_CONTEXT_V2', id, original, context }, '*');
    return { id, promise };
  }

  window.addEventListener('message', event => {
    if (event.source !== window || event.data?.source !== PAGE_SOURCE) return;
    const data = event.data;
    if (data.type === 'CC_PAGE_HOOK_READY_V2') { pageHookReady = true; return; }
    if (data.type === 'CC_PAGE_CONTEXT_INJECTED_V2') {
      const waiter = pageWaiters.get(data.id);
      if (waiter) { clearTimeout(waiter.timer); pageWaiters.delete(data.id); waiter.resolve({ ok: true, injected: true }); }
      void runtimeMessage({ type: 'CC_DIAGNOSTIC', event: 'context-injected', detail: { chatId: chatId() } });
      return;
    }
    if (data.type === 'CC_PAGE_CONTEXT_MISSED_V2') {
      const waiter = pageWaiters.get(data.id);
      if (waiter) { clearTimeout(waiter.timer); pageWaiters.delete(data.id); waiter.resolve({ ok: false, reason: data.reason || 'request payload did not contain the prompt' }); }
    }
  });

  async function triggerSend(node) {
    let button = null;
    for (let i = 0; i < 50 && !button; i++) { await sleep(i ? 80 : 40); button = sendButton(node); }
    if (!button) throw new Error('ChatGPT Send button is not available.');
    button.click();
  }

  async function sendText(text, { internal = false, attachments = [] } = {}) {
    let node = composer();
    for (let i = 0; i < 30 && !node; i++) { await sleep(100); node = composer(); }
    if (!node) throw new Error('ChatGPT composer is not available.');
    if (attachments?.length) await attachFiles(attachments);
    const staged = setComposerText(node, text);
    if (!staged) {
      await sleep(60);
      if (!composerContains(node, text)) throw new Error('Could not stage ChatGPT composer text through ProseMirror.');
    }
    plumbingSend = internal;
    await triggerSend(node);
    await sleep(120);
    plumbingSend = false;
  }

  function scrubInternalContext() {
    const candidates = [...document.querySelectorAll('[data-message-author-role="user"],article[data-turn="user"],[data-testid^="conversation-turn-"]')];
    for (const node of candidates.slice(-10)) {
      const text = node.textContent || '';
      const marker = text.indexOf(CONTEXT_OPEN);
      const resultMarker = text.indexOf(RESULT_OPEN);
      const cut = marker >= 0 ? marker : resultMarker >= 0 ? resultMarker : -1;
      if (cut < 0) continue;
      if (resultMarker >= 0) {
        node.style.display = 'none';
        node.dataset.constellationCommanderHidden = 'tool-result';
        continue;
      }
      const visible = text.slice(0, cut).trim();
      const leaf = [...node.querySelectorAll('p,div')].find(el => (el.textContent || '').includes(CONTEXT_OPEN));
      if (leaf) leaf.textContent = visible; else node.textContent = visible;
    }
  }

  async function armAndSend(original) {
    if (arming) return;
    arming = true;
    try {
      const s = await ensureSession();
      const context = contextText(s);
      const node = composer();
      if (!node) throw new Error('ChatGPT composer is not available.');

      const hookReady = await waitPageHookReady();
      const hook = hookReady ? armPageHook(original.trim(), context) : null;

      // Dual path: update ProseMirror *and* arm the MAIN-world request hook. If
      // either ChatGPT's editor model or DOM changes, the other path still gets
      // the trusted local context into the actual model request.
      const augmented = `${original.trim()}\n\n${context}`;
      const staged = setComposerText(node, augmented);
      if (!staged && !hook) throw new Error('Could not arm the ChatGPT message with local Project Constellation context.');
      await triggerSend(node);

      const proof = hook ? await hook.promise : { ok: staged, fallback: true };
      if (!proof.ok && !staged) throw new Error('Project Constellation could not inject its local tool context into the outgoing ChatGPT request.');
      if (!proof.ok) {
        void runtimeMessage({ type: 'CC_DIAGNOSTIC', event: 'context-fallback', detail: { reason: proof.reason || 'network hook timeout', chatId: chatId() } });
        toast('Project Constellation used the ProseMirror fallback. If control does not start, reload the Project Constellation extension once.', 'warn');
      } else {
        toast('Project Constellation armed — local computer control available.', 'info');
      }
      setTimeout(scrubInternalContext, 180);
      setTimeout(scrubInternalContext, 800);
      setTimeout(scrubInternalContext, 1800);
    } catch (error) {
      console.warn('[Project Constellation] local bridge unavailable:', error);
      toast(`Project Constellation: ${String(error?.message || error)}`, 'error', true);
      void runtimeMessage({ type: 'CC_DIAGNOSTIC', event: 'arm-failed', detail: { error: String(error?.message || error), chatId: chatId() } });
      const node = composer();
      if (node && !getComposerText(node).trim()) setComposerText(node, original);
    } finally {
      arming = false;
    }
  }

  function interceptSend(event) {
    if (plumbingSend || arming) return;
    const node = composer();
    if (!node) return;
    const text = getComposerText(node);
    if (!isLocalIntent(text)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void armAndSend(text);
  }

  document.addEventListener('submit', interceptSend, true);
  document.addEventListener('click', event => {
    if (plumbingSend || arming) return;
    const node = composer();
    const button = node && sendButton(node);
    if (button && (event.target === button || button.contains(event.target))) interceptSend(event);
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    const node = composer();
    if (node && (event.target === node || node.contains(event.target))) interceptSend(event);
  }, true);

  async function handleCall(call) {
    if (!call?.id || handledCalls.has(call.id)) return;
    handledCalls.add(call.id);
    try {
      let s = await ensureSession();
      if (call.nonce !== s.nonce) {
        s = await ensureSession(true);
        if (call.nonce !== s.nonce) throw new Error('Local call nonce is stale; ask ChatGPT to retry using the refreshed local context.');
      }
      toast(`Project Constellation running: ${call.tool}`, 'info');
      let response = await runtimeMessage({ type: 'CC_CALL', sessionToken: s.sessionToken, call });
      if (response?.status === 401 || response?.refresh) {
        s = await ensureSession(true);
        response = { ok: false, error: 'Local session refreshed. Retry the previous local call with the new nonce.', refreshedContext: contextText(s) };
      }
      const attachments = response?.result?._attachments || response?._attachments || [];
      const safeResponse = { ...response };
      if (safeResponse.result && typeof safeResponse.result === 'object') {
        safeResponse.result = { ...safeResponse.result };
        delete safeResponse.result._attachments;
      }
      delete safeResponse._attachments;
      const payload = `${RESULT_OPEN}\n${JSON.stringify({ id: call.id, tool: call.tool, ...safeResponse })}\n${RESULT_CLOSE}`;
      await sendText(payload, { internal: true, attachments });
      void runtimeMessage({ type: 'CC_DIAGNOSTIC', event: 'tool-result-sent', detail: { tool: call.tool, ok: response?.ok !== false, chatId: chatId() } });
      setTimeout(scrubInternalContext, 180);
      setTimeout(scrubInternalContext, 800);
      setTimeout(scrubInternalContext, 1800);
    } catch (error) {
      toast(`Project Constellation tool failed: ${String(error?.message || error)}`, 'error', true);
      const payload = `${RESULT_OPEN}\n${JSON.stringify({ id: call.id, tool: call.tool, ok: false, error: String(error?.message || error) })}\n${RESULT_CLOSE}`;
      try { await sendText(payload, { internal: true }); } catch {}
    }
  }

  function scanAssistantCalls() {
    const nodes = [...document.querySelectorAll('[data-message-author-role="assistant"],article[data-turn="assistant"],[data-testid^="conversation-turn-"]')];
    for (const node of nodes.slice(-14)) {
      const text = node.textContent || '';
      const match = text.match(CALL_RE);
      if (!match) continue;
      node.style.display = 'none';
      node.dataset.constellationCommanderHidden = 'tool-call';
      try { void handleCall(JSON.parse(match[1])); } catch {}
    }
    scrubInternalContext();
  }

  const observer = new MutationObserver(() => scanAssistantCalls());
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  scanAssistantCalls();

  function handleRouteChange(nextUrl = location.href) {
    const next = String(nextUrl || location.href);
    if (next === route) return;
    route = next;
    session = null;
    sessionChatId = '';
  }
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data || {};
    if (data.source === ROUTE_SOURCE && data.type === 'PC_ROUTE_CHANGED') handleRouteChange(data.url);
  }, true);
  window.addEventListener('popstate', () => handleRouteChange(), { passive:true });
  window.addEventListener('hashchange', () => handleRouteChange(), { passive:true });
})();
