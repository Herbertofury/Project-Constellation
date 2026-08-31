(() => {
  'use strict';

  const VERSION = '0.5.1';
  const INTERNAL_CONTEXT_MARKER = '[PROJECT CONSTELLATION LOCAL CONTEXT]';
  const TOOL_RESULT_MARKER = '[PC BUDDY TOOL RESULT]';
  const TOOL_CALL_RE = /\[PC_BUDDY_CALL\]([\s\S]*?)\[\/PC_BUDDY_CALL\]/gi;
  const LOCAL_INTENT_RE = /\b(project\s+constellation|use\s+(?:project\s+)?constellation|constellation\s+(?:app|agent|bridge)|my\s+(?:pc|computer|desktop|downloads?|documents?|files?|windows)|this\s+(?:pc|computer)|on\s+my\s+(?:pc|computer|desktop)|running\s+(?:processes|apps)|open\s+windows|files?\s+on\s+(?:my|this)\s+(?:pc|computer)|create\s+.*\s+on\s+my\s+desktop|save\s+.*\s+on\s+my\s+desktop)\b/i;
  const RETRY_RE = /^(?:try\s*(?:it\s*)?(?:again|now)?|retry|again|do\s*it|continue|go\s*ahead|run\s*it|use\s*it|yes|yep|now)$/i;
  const SESSION_REFRESH_MS = 5 * 60 * 1000;

  const previous = globalThis.ProjectConstellationCompanion;
  try { previous?.dispose?.(); } catch (_) {}

  let disposed = false;
  let activeSession = null;
  let localConversationArmed = false;
  let arming = false;
  let bypassSend = 0;
  let scanTimer = 0;
  let observer = null;
  let pendingOriginalText = '';
  let routeKey = currentConversationKey();
  const completedCalls = new Set();

  function promptElement() {
    return document.querySelector('#prompt-textarea') ||
      document.querySelector('textarea[data-testid="prompt-textarea"]') ||
      document.querySelector('[contenteditable="true"][data-virtualkeyboard="true"]') ||
      document.querySelector('main [contenteditable="true"]');
  }

  function sendButton() {
    return document.querySelector('button[data-testid="send-button"]') ||
      document.querySelector('button[aria-label*="Send"]') ||
      document.querySelector('button[aria-label*="send"]');
  }

  function promptText(el = promptElement()) {
    if (!el) return '';
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return String(el.value || '').trim();
    return String(el.innerText || el.textContent || '').trim();
  }

  function setPromptText(el, text) {
    if (!el) return false;
    el.focus();
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, text); else el.value = text;
      el.dispatchEvent(new InputEvent('input', { bubbles:true, inputType:'insertText', data:text }));
      el.dispatchEvent(new Event('change', { bubbles:true }));
      return true;
    }

    let inserted = false;
    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection?.removeAllRanges();
      selection?.addRange(range);
      inserted = document.execCommand('insertText', false, text);
    } catch (_) {}

    if (!inserted) {
      el.replaceChildren();
      const p = document.createElement('p');
      p.textContent = text;
      el.appendChild(p);
      el.dispatchEvent(new InputEvent('input', { bubbles:true, inputType:'insertText', data:text }));
    }
    el.dispatchEvent(new Event('change', { bubbles:true }));
    return true;
  }

  function runtimeMessage(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ ok:false, status:0, error:chrome.runtime.lastError.message });
            return;
          }
          resolve(response || { ok:false, status:0, error:'No Project Constellation background response' });
        });
      } catch (error) {
        resolve({ ok:false, status:0, error:String(error?.message || error) });
      }
    });
  }

  function currentConversationKey() {
    return `${location.pathname || '/'}${location.search || ''}`.slice(0, 512);
  }

  function pathOnly(key) {
    return String(key || '').split('?', 1)[0];
  }

  function syncRoute() {
    const current = currentConversationKey();
    if (current === routeKey) return;
    const previousPath = pathOnly(routeKey);
    const currentPath = pathOnly(current);
    routeKey = current;

    if ((previousPath === '/' || previousPath === '') && currentPath.startsWith('/c/')) {
      if (activeSession) activeSession.conversationKey = current;
      return;
    }

    activeSession = null;
    localConversationArmed = false;
    pendingOriginalText = '';
    completedCalls.clear();
    recoverArmedFromConversation();
  }

  function sameConversationOrInitialRouteTransition() {
    syncRoute();
    if (!activeSession) return false;
    const current = currentConversationKey();
    if (activeSession.conversationKey === current) return true;
    const previousPath = pathOnly(activeSession.conversationKey);
    const currentPath = pathOnly(current);
    if ((previousPath === '/' || previousPath === '') && currentPath.startsWith('/c/')) {
      activeSession.conversationKey = current;
      return true;
    }
    return false;
  }

  function sessionNeedsRefresh() {
    if (!activeSession) return true;
    if (!sameConversationOrInitialRouteTransition()) return true;
    const expires = Date.parse(activeSession.expiresAtUtc || '');
    return !Number.isFinite(expires) || expires - Date.now() < SESSION_REFRESH_MS;
  }

  async function handshake() {
    syncRoute();
    const conversationKey = currentConversationKey();
    const response = await runtimeMessage({ type:'pcx-local-handshake', conversationKey });
    if (!response?.ok || !response.sessionKey || !response.context) {
      activeSession = null;
      return response || { ok:false, error:'Project Constellation handshake failed' };
    }
    activeSession = {
      sessionKey:String(response.sessionKey),
      nonce:String(response.nonce || ''),
      context:String(response.context || ''),
      conversationKey,
      expiresAtUtc:String(response.expiresAtUtc || '')
    };
    completedCalls.clear();
    return response;
  }

  function needsLocalCompanion(text) {
    const value = String(text || '').trim();
    if (LOCAL_INTENT_RE.test(value)) return true;
    return localConversationArmed && RETRY_RE.test(value);
  }

  function recoverArmedFromConversation() {
    try {
      const messages = [...document.querySelectorAll('[data-message-author-role="user"]')].slice(-10);
      localConversationArmed = messages.some((node) => {
        const text = String(node.innerText || node.textContent || '');
        return LOCAL_INTENT_RE.test(text) || text.includes(INTERNAL_CONTEXT_MARKER);
      });
    } catch (_) {}
  }

  function isSendClick(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest('button[data-testid="send-button"], button[aria-label*="Send"], button[aria-label*="send"]'));
  }

  function shouldInterceptKey(event) {
    if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return false;
    const prompt = promptElement();
    if (!prompt) return false;
    return event.target === prompt || prompt.contains(event.target instanceof Node ? event.target : null);
  }

  function dispatchSend() {
    const button = sendButton();
    const prompt = promptElement();
    if (!prompt) return false;
    bypassSend += 1;
    if (button && !button.disabled) {
      button.click();
      return true;
    }
    prompt.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', code:'Enter', keyCode:13, which:13, bubbles:true }));
    prompt.dispatchEvent(new KeyboardEvent('keyup', { key:'Enter', code:'Enter', keyCode:13, which:13, bubbles:true }));
    return true;
  }

  async function armAndSend(original) {
    if (arming || disposed) return;
    arming = true;
    localConversationArmed = true;
    try {
      let handshakeResult = { ok:true };
      if (sessionNeedsRefresh()) handshakeResult = await handshake();
      if (!handshakeResult?.ok && !activeSession) {
        showStatus(`Project Constellation is not reachable: ${handshakeResult?.error || 'local companion offline'}`, false);
        setPromptText(promptElement(), original);
        return;
      }
      const session = activeSession;
      if (!session?.context) {
        showStatus('Project Constellation could not arm this ChatGPT conversation.', false);
        setPromptText(promptElement(), original);
        return;
      }
      pendingOriginalText = original;
      const combined = `${original}\n\n${session.context}`;
      if (!setPromptText(promptElement(), combined)) return;
      requestAnimationFrame(() => requestAnimationFrame(() => dispatchSend()));
      showStatus('Project Constellation armed for this chat', true);
    } finally {
      arming = false;
    }
  }

  function interceptSend(text, event) {
    syncRoute();
    const explicit = LOCAL_INTENT_RE.test(String(text || ''));
    if (explicit) localConversationArmed = true;
    if (!needsLocalCompanion(text)) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();
    void armAndSend(text);
    return true;
  }

  function onClickCapture(event) {
    if (disposed || !isSendClick(event.target)) return;
    if (bypassSend > 0) { bypassSend -= 1; return; }
    const text = promptText();
    if (!text) return;
    interceptSend(text, event);
  }

  function onKeyCapture(event) {
    if (disposed || !shouldInterceptKey(event)) return;
    if (bypassSend > 0) { bypassSend -= 1; return; }
    const text = promptText();
    if (!text) return;
    interceptSend(text, event);
  }

  function deepestContaining(root, marker) {
    let best = null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = root;
    while (node) {
      if (String(node.innerText || '').includes(marker)) best = node;
      node = walker.nextNode();
    }
    return best;
  }

  function scrubUserInternal(node) {
    const text = String(node.innerText || '');
    if (text.includes(TOOL_RESULT_MARKER)) {
      node.style.display = 'none';
      return;
    }
    if (!text.includes(INTERNAL_CONTEXT_MARKER)) return;
    localConversationArmed = true;
    const target = deepestContaining(node, INTERNAL_CONTEXT_MARKER) || node;
    const targetText = String(target.innerText || target.textContent || '');
    const markerIndex = targetText.indexOf(INTERNAL_CONTEXT_MARKER);
    if (markerIndex < 0) return;
    const visible = targetText.slice(0, markerIndex).trimEnd() || pendingOriginalText;
    if (visible) target.textContent = visible;
  }

  async function executeToolCall(raw, assistantNode) {
    let call = null;
    try { call = JSON.parse(raw); } catch (_) { return; }
    const id = String(call?.id || '');
    const dedupeKey = `${id}|${String(call?.nonce || '')}`;
    if (!id || completedCalls.has(dedupeKey)) return;
    completedCalls.add(dedupeKey);
    localConversationArmed = true;
    assistantNode.style.display = 'none';

    if (!activeSession || !sameConversationOrInitialRouteTransition()) {
      const rearm = await handshake();
      if (!rearm?.ok) {
        showStatus(`Project Constellation tool request could not run: ${rearm?.error || 'local companion offline'}`, false);
        return;
      }
      await sendInternal(`[PROJECT CONSTELLATION SESSION REFRESH]\n${activeSession.context}\nRetry the local tool request you just attempted using this refreshed context.`);
      return;
    }

    const response = await runtimeMessage({
      type:'pcx-local-tool',
      sessionKey:activeSession.sessionKey,
      call
    });

    if (!response?.ok && response?.status === 401) {
      const rearm = await handshake();
      if (!rearm?.ok) {
        showStatus(`Project Constellation session expired and could not re-arm: ${rearm?.error || 'offline'}`, false);
        return;
      }
      await sendInternal(`[PROJECT CONSTELLATION SESSION REFRESH]\n${activeSession.context}\nThe previous local session expired. Retry the last local tool request using this refreshed nonce.`);
      return;
    }

    if (!response?.ok) {
      await sendInternal(`[PC BUDDY TOOL RESULT]\ncall_id=${id}\n[PC_BUDDY_RESULT]{"ok":false,"error":${JSON.stringify(String(response?.error || 'Project Constellation local tool failed'))}}[/PC_BUDDY_RESULT]\nContinue truthfully from this failure; do not invent local state.`);
      showStatus(response?.error || 'Project Constellation local tool failed', false);
      return;
    }

    await sendInternal(String(response.toolResultMessage || ''));
    showStatus(`Local tool completed: ${String(response.tool || call.tool || '')}`, true);
  }

  async function sendInternal(text) {
    if (!text || disposed) return false;
    const prompt = promptElement();
    if (!prompt) return false;
    if (!setPromptText(prompt, text)) return false;
    requestAnimationFrame(() => requestAnimationFrame(() => dispatchSend()));
    return true;
  }

  function scanAssistantCalls() {
    document.querySelectorAll('[data-message-author-role="assistant"]').forEach((node) => {
      const text = String(node.innerText || '');
      TOOL_CALL_RE.lastIndex = 0;
      let match;
      let found = false;
      while ((match = TOOL_CALL_RE.exec(text)) !== null) {
        found = true;
        void executeToolCall(match[1], node);
      }
      if (found || text.includes('[PC BUDDY READY]')) node.style.display = 'none';
    });
  }

  function sanitizeInternalMessages() {
    syncRoute();
    document.querySelectorAll('[data-message-author-role="user"]').forEach(scrubUserInternal);
    scanAssistantCalls();
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(sanitizeInternalMessages, 100);
  }

  function showStatus(message, ok) {
    globalThis.dispatchEvent(new CustomEvent('project-constellation-companion-status', {
      detail:{ message:String(message || ''), ok:Boolean(ok), at:Date.now(), version:VERSION, armed:localConversationArmed }
    }));
  }

  async function health() {
    const response = await runtimeMessage({ type:'pcx-local-health' });
    showStatus(response?.ok ? 'Project Constellation browser companion ready' : (response?.error || 'Project Constellation desktop app is offline'), Boolean(response?.ok));
    return response;
  }

  function start() {
    if (disposed) return;
    document.addEventListener('click', onClickCapture, true);
    document.addEventListener('keydown', onKeyCapture, true);
    const attachObserver = () => {
      if (disposed || observer) return;
      if (!document.documentElement) { setTimeout(attachObserver, 0); return; }
      observer = new MutationObserver(scheduleScan);
      observer.observe(document.documentElement, { childList:true, subtree:true, characterData:true });
      recoverArmedFromConversation();
      sanitizeInternalMessages();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attachObserver, { once:true });
    else attachObserver();
    void health();
  }

  function dispose() {
    disposed = true;
    clearTimeout(scanTimer);
    observer?.disconnect();
    observer = null;
    document.removeEventListener('click', onClickCapture, true);
    document.removeEventListener('keydown', onKeyCapture, true);
    if (activeSession?.sessionKey) void runtimeMessage({ type:'pcx-local-forget', sessionKey:activeSession.sessionKey });
    activeSession = null;
  }

  globalThis.ProjectConstellationCompanion = Object.freeze({
    version:VERSION,
    health,
    dispose,
    get status() {
      syncRoute();
      return {
        connected:Boolean(activeSession),
        armed:localConversationArmed,
        conversationKey:activeSession?.conversationKey || routeKey,
        expiresAtUtc:activeSession?.expiresAtUtc || ''
      };
    }
  });

  start();
})();
