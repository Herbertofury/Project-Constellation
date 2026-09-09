(() => {
  'use strict';
  if (globalThis.__PROJECT_CONSTELLATION_TAB_SUPERVISOR__) return;
  globalThis.__PROJECT_CONSTELLATION_TAB_SUPERVISOR__ = true;

  const core = globalThis.ProjectConstellationTabSupervisorCore;
  const providers = globalThis.ProjectConstellationProviders;
  if (!core || !providers || !/^(chatgpt\.com|chat\.openai\.com)$/i.test(location.hostname)) return;

  const BRAIN_SETTINGS_KEY = 'projectConstellationBrainSettings';
  const sentTurns = new Map();
  const seenProjects = new Map();
  let brainSettings = {};
  let port = null;
  let reconnectTimer = 0;
  let evaluateTimer = 0;
  let observer = null;
  let resumeBusy = false;
  let lastSnapshotSignature = '';
  let lastSnapshotSentAt = 0;

  const cleanText = (value, max = 120000) => String(value || '').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim().slice(0, max);
  const hash = (value) => {
    const text = String(value || '');
    let h = 2166136261;
    for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  };
  const post = (message) => { try { port?.postMessage(message); } catch (_) {} };

  function currentChatId() { return providers.chatIdFromUrl(location.href, 'chatgpt') || core.chatIdFromUrl(location.href); }
  function sentinelState() { try { return globalThis.ProjectConstellationLiveSentinel?.getState?.(true) || null; } catch (_) { return null; } }
  function turnNodes() {
    const primary = [...document.querySelectorAll('[data-testid^="conversation-turn-"]')];
    return primary.length ? primary : [...document.querySelectorAll('[data-message-author-role][data-message-id]')];
  }
  function turnRole(node) {
    const direct = node.getAttribute('data-message-author-role') || node.getAttribute('data-author') || node.querySelector('[data-message-author-role]')?.getAttribute('data-message-author-role') || '';
    if (/user|human/i.test(direct)) return 'user';
    if (/assistant|bot/i.test(direct)) return 'assistant';
    const label = `${node.getAttribute('data-testid') || ''} ${node.getAttribute('aria-label') || ''}`;
    if (/user|prompt/i.test(label)) return 'user';
    if (/assistant|response/i.test(label)) return 'assistant';
    return 'unknown';
  }
  function turnId(node, chatId, ordinal) {
    const raw = node.getAttribute('data-message-id') || node.querySelector('[data-message-id]')?.getAttribute('data-message-id') || node.id || node.getAttribute('data-testid') || `turn-${ordinal}`;
    return `${chatId}:${String(raw).slice(0, 280)}`;
  }
  function failureText() {
    return [...document.querySelectorAll('[role="alert"],[data-testid*="error" i],[class*="error" i],[class*="warning" i]')]
      .slice(-12).map((node) => cleanText(node.innerText || node.textContent || '', 1200)).filter(Boolean).slice(-5).join(' | ').slice(0, 5000);
  }
  function approvalVisible() {
    for (const button of document.querySelectorAll('button,[role="button"]')) {
      const label = cleanText(button.innerText || button.textContent || button.getAttribute('aria-label') || '', 120).toLowerCase();
      if (!/allow|approve|permission|continue|connect/.test(label)) continue;
      const parent = button.closest('[role="dialog"],[data-testid*="tool" i],[data-testid*="permission" i],[class*="modal" i],[class*="dialog" i],article,section') || button.parentElement;
      const context = cleanText(parent?.innerText || parent?.textContent || '', 2200).toLowerCase();
      if (/(drive|github|connector|connected app|plugin|tool|permission|access|authorize)/.test(context)) return true;
    }
    return false;
  }

  function currentProject() {
    const parsed = core.projectFromUrl(location.href);
    if (!parsed) return null;
    const escaped = globalThis.CSS?.escape ? CSS.escape(parsed.providerProjectId) : parsed.providerProjectId.replace(/[^a-zA-Z0-9_-]/g, '');
    const anchor = document.querySelector(`a[href*="/g/${escaped}"]`);
    const name = core.cleanProjectName(anchor?.innerText || anchor?.textContent || '');
    return { ...parsed, name: name || `ChatGPT Project ${parsed.providerProjectId.slice(-8)}` };
  }
  function scanProjects() {
    for (const anchor of document.querySelectorAll('a[href*="/g/g-p-"]')) {
      const parsed = core.projectFromUrl(anchor.href);
      const name = parsed ? core.cleanProjectName(anchor.innerText || anchor.textContent || anchor.getAttribute('aria-label') || '') : '';
      if (!parsed || !name) continue;
      const signature = `${name}|${anchor.href}`;
      if (seenProjects.get(parsed.id) === signature) continue;
      seenProjects.set(parsed.id, signature);
      post({ type:'project-upsert', project:{ ...parsed, name, url:anchor.href, providerId:'chatgpt', sourceType:'provider', updatedAt:Date.now() } });
    }
  }

  function collectSnapshot() {
    const nodes = turnNodes();
    const last = nodes.at(-1) || null;
    const lastText = cleanText(last?.innerText || last?.textContent || '', 160000);
    const lastRole = last ? turnRole(last) : '';
    let charCount = 0;
    for (const node of nodes) charCount += Math.min(160000, cleanText(node.innerText || node.textContent || '', 160000).length);
    const sentinel = sentinelState();
    const sentinelStatus = String(sentinel?.chat?.status || '');
    const sentinelHealth = String(sentinel?.health?.state || sentinel?.chat?.healthState || sentinel?.chat?.state || '');
    const sentinelFailure = sentinel?.failure?.active ? sentinel.failure : sentinel?.chat?.failure?.active ? sentinel.chat.failure : null;
    const failureKind = String(sentinelFailure?.state || sentinelFailure?.status || core.classifyFailureText(failureText()) || '');
    const running = sentinelStatus === 'running' || Boolean(document.querySelector('[data-is-streaming="true"],[aria-busy="true"]')) || [...document.querySelectorAll('button,[role="button"]')].some((button) => /stop generating|stop response|cancel generation/i.test(cleanText(button.innerText || button.textContent || button.getAttribute('aria-label') || '', 100)));
    let status = failureKind || (approvalVisible() ? 'blocked-approval' : sentinelHealth || sentinelStatus || (running ? 'running' : 'idle'));
    if (['working','tool-running','request-running'].includes(status)) status = 'running';
    const body = cleanText(document.body?.innerText || '', 20000).toLowerCase();
    const project = currentProject();
    const signature = hash(`${nodes.length}|${lastRole}|${lastText.length}|${lastText.slice(-240)}|${status}|${failureKind}`);
    return {
      chatId:currentChatId(), url:location.href, title:cleanText(document.title || 'ChatGPT', 240), hidden:document.hidden,
      status, running, wasRunning:running || /running|stalled|dead/.test(status), unresolvedUser:lastRole === 'user', failureKind,
      turnCount:nodes.length, charCount, lastRole, lastTurnChars:lastText.length, signature,
      projectId:project?.id || '', projectName:project?.name || '',
      explicitLimitSignal:/reached the maximum length for this conversation|conversation maximum reached/.test(body),
      nearLimitSignal:/approaching the maximum length|conversation is getting long|start a new chat soon/.test(body),
      observedAt:Date.now()
    };
  }

  async function checkpoint(snapshot, nodes) {
    if (!snapshot.chatId) return;
    const project = currentProject();
    const payload = [{ type:'CHAT_UPSERT', data:{
      id:snapshot.chatId, providerId:'chatgpt', providerName:'ChatGPT', title:snapshot.title, url:location.href,
      projectId:project?.id || 'chatgpt:inbox', projectName:project?.name || 'Inbox', source:document.hidden ? 'hidden-tab-supervisor' : 'tab-supervisor',
      status:snapshot.status, lastSeenAt:Date.now(), updatedAt:Date.now()
    }}];
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      const text = cleanText(node.innerText || node.textContent || '');
      if (!text) continue;
      const role = turnRole(node);
      const id = turnId(node, snapshot.chatId, index);
      const fingerprint = hash(`${role}|${text}`);
      if (sentTurns.get(id) === fingerprint) continue;
      sentTurns.set(id, fingerprint);
      payload.push({ type:'TURN_UPSERT', data:{ id, chatId:snapshot.chatId, providerId:'chatgpt', role, ordinal:index, text, contentFingerprint:fingerprint, url:location.href, updatedAt:Date.now() } });
    }
    try { await chrome.runtime.sendMessage({ type:'PC_BRAIN_INGEST_BATCH', payload:payload.slice(0,500) }); } catch (_) {}
  }

  function renderCapacityAlert(level, snapshot) {
    let host = document.getElementById('pc-reliability-alert');
    if (level === 'clear') { host?.remove(); return; }
    if (!host) {
      host = document.createElement('div');
      host.id = 'pc-reliability-alert';
      host.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483646;max-width:min(760px,calc(100vw - 32px));padding:10px 14px;border-radius:10px;background:#17191f;color:#fff;font:600 13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 8px 32px rgba(0,0,0,.35);pointer-events:none;text-align:center;';
      document.documentElement.appendChild(host);
    }
    host.textContent = level === 'handoff' ? `Project Constellation: this chat is at the handoff boundary (${snapshot.turnCount} turns). Secure a continuation now.` : `Project Constellation: chat runway is narrowing (${snapshot.turnCount} turns). Branch soon.`;
  }

  async function evaluate(force = false) {
    if (!document.documentElement) return;
    scanProjects();
    const snapshot = collectSnapshot();
    if (!snapshot.chatId) return;
    const capacity = core.capacityLevel(snapshot, brainSettings?.liveHealth || {});
    renderCapacityAlert(capacity, snapshot);
    if (snapshot.signature !== lastSnapshotSignature || Date.now() - lastSnapshotSentAt > 30000 || force) {
      lastSnapshotSignature = snapshot.signature;
      lastSnapshotSentAt = Date.now();
      await checkpoint(snapshot, turnNodes());
      post({ type:'snapshot', snapshot:{ ...snapshot, capacity } });
    }
    if (snapshot.status === 'blocked-approval') post({ type:'approval-scan', chatId:snapshot.chatId, at:Date.now() });
  }

  async function setComposerText(composer, text) {
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      if (String(composer.value || '').trim()) return false;
      const proto = composer instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(composer, text);
      composer.dispatchEvent(new Event('input', { bubbles:true }));
      composer.dispatchEvent(new Event('change', { bubbles:true }));
      return true;
    }
    if (!composer?.isContentEditable || cleanText(composer.innerText || composer.textContent || '', 200)) return false;
    composer.focus();
    try { document.execCommand('insertText', false, text); } catch (_) { composer.textContent = text; }
    composer.dispatchEvent(new InputEvent('input', { bubbles:true, inputType:'insertText', data:text }));
    return true;
  }
  function findComposer() { return document.querySelector('#prompt-textarea,textarea[data-testid*="composer" i],textarea[placeholder*="Message" i],[contenteditable="true"][data-lexical-editor="true"],[contenteditable="true"][role="textbox"]'); }
  function findSendButton() { return document.querySelector('button[data-testid="send-button"],button[aria-label^="Send" i],button[aria-label*="send message" i]'); }
  async function resumeAfterReload(command) {
    if (resumeBusy || !command?.prompt) return;
    resumeBusy = true;
    let status = 'failed';
    let inserted = false;
    try {
      const deadline = Date.now() + 90000;
      while (Date.now() < deadline) {
        if (command.chatId && currentChatId() && command.chatId !== currentChatId()) break;
        const composer = findComposer();
        if (!composer) { await new Promise((resolve) => setTimeout(resolve, 1000)); continue; }
        if (!inserted) {
          if (!await setComposerText(composer, command.prompt)) { status = 'composer-busy'; break; }
          inserted = true;
          status = 'prefilled';
        }
        const send = findSendButton();
        if (send && !send.disabled && send.getAttribute('aria-disabled') !== 'true') { send.click(); status = 'sent'; break; }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch (_) { status = 'failed'; }
    post({ type:'resume-result', chatId:command.chatId || currentChatId(), recoveryId:command.recoveryId || '', status, at:Date.now() });
    resumeBusy = false;
  }

  function connect() {
    if (port) return;
    try {
      port = chrome.runtime.connect({ name:'pc-tab-supervisor-v1' });
      port.onMessage.addListener((message) => {
        if (message?.type === 'tick') void evaluate(true);
        else if (message?.type === 'resume') void resumeAfterReload(message);
      });
      port.onDisconnect.addListener(() => {
        port = null;
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, 1200 + Math.round(Math.random() * 1000));
      });
      post({ type:'hello', chatId:currentChatId(), url:location.href, title:document.title, hidden:document.hidden, at:Date.now() });
      void evaluate(true);
    } catch (_) {
      port = null;
      reconnectTimer = setTimeout(connect, 2000);
    }
  }

  function startObserver() {
    observer?.disconnect();
    observer = new MutationObserver(() => {
      clearTimeout(evaluateTimer);
      evaluateTimer = setTimeout(() => void evaluate(false), document.hidden ? 1000 : 180);
    });
    observer.observe(document.documentElement, { subtree:true, childList:true, attributes:true, attributeFilter:['aria-busy','data-is-streaming','data-state','disabled','aria-disabled'] });
  }

  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes[BRAIN_SETTINGS_KEY]) brainSettings = changes[BRAIN_SETTINGS_KEY].newValue || {}; });
  chrome.runtime.onMessage.addListener((message) => { if (message?.type === 'PC_TAB_SUPERVISOR_TICK') void evaluate(true); });
  document.addEventListener('visibilitychange', () => void evaluate(true));
  window.addEventListener('popstate', () => setTimeout(() => void evaluate(true), 100));
  window.addEventListener('hashchange', () => setTimeout(() => void evaluate(true), 100));

  void (async () => {
    try { brainSettings = (await chrome.storage.local.get(BRAIN_SETTINGS_KEY))?.[BRAIN_SETTINGS_KEY] || {}; } catch (_) {}
    connect();
    if (document.documentElement) startObserver(); else document.addEventListener('DOMContentLoaded', startObserver, { once:true });
    setInterval(() => void evaluate(false), 15000);
  })();
})();
