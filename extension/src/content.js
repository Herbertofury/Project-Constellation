(() => {
  'use strict';
  if (globalThis.__PROJECT_CONSTELLATION_ACTIVE__) return;
  globalThis.__PROJECT_CONSTELLATION_ACTIVE__ = true;

  const perf = globalThis.ProjectConstellationPerformance;
  const brain = globalThis.ProjectConstellationBrainCore;
  const providers = globalThis.ProjectConstellationProviders;
  const health = globalThis.ProjectConstellationHealthCore;
  if (!perf || !brain || !providers || !health) return;

  const provider = providers.detectProvider(location.href);
  if (!provider) return;

  const STORAGE_KEY = 'projectConstellationPerformanceSettings';
  const METRICS_KEY = 'projectConstellationPerformanceMetrics';
  const BRAIN_SETTINGS_KEY = 'projectConstellationBrainSettings';
  const settings = { ...perf.DEFAULTS };
  let approvalSettings = { enabled: false, acknowledged: false, alwaysAllow: true, fallbackAllowOnce: true, autoRecoverPaused: true };
  let liveHealthSettings = { ...health.DEFAULTS };
  let approvalAutopilotBusy = false;
  let approvalAutopilotLastAt = 0;
  const pressure = new perf.PressureWindow(settings);
  const metrics = {
    sessionStartedAt: Date.now(), totalLongTasks: 0, totalLongTaskMs: 0, maxLongTaskMs: 0,
    pressureTransitions: 0, lastPressure: 'normal', route: location.pathname,
    providerId: provider.id, lastUpdatedAt: Date.now()
  };

  const root = document.documentElement;
  const seenTurnHashes = new Map();
  const seenTurnLengths = new Map();
  let seenTurnTextChars = 0;
  const seenFileHashes = new Map();
  const seenChats = new Map();
  const pendingRoots = new Set();
  let performanceObserver = null;
  let captureObserver = null;
  let recoveryTimer = 0;
  let persistHandle = 0;
  let persistHandleKind = '';
  let captureHandle = 0;
  let captureHandleKind = '';
  let statusTimer = 0;
  let liveHealthTimer = 0;
  let liveHealthPollBusy = false;
  let liveHealthHost = null;
  let liveHealthShadow = null;
  let liveHealthSnapshot = null;
  let lastToolEvidence = null;
  let lastToolScanAt = 0;
  let toolEvidenceDirty = true;
  let handoffClipboardArea = null;
  let navCleanup = null;
  let transientChatId = '';
  let lastSemanticActivityAt = Date.now();
  let lastStatus = 'idle';
  let lastStatusTextHash = '';
  let routeStartedAt = Date.now();
  const healthEvidence = { lastTurnProgressAt: Date.now(), lastDomProgressAt: Date.now(), lastStatusChangeAt: Date.now(), lastToolProgressAt: 0, lastToolStartedAt: 0, lastToolEntryCount: 0, lastToolSignature: '', lastToolLabel: '', lastHealthActivitySignature: '', latestMountedTurn: null, lastToolHash: '' };

  const brainOutbox = [];
  let brainFlushTimer = 0;
  function flushBrainOutbox() {
    if (brainFlushTimer) { clearTimeout(brainFlushTimer); brainFlushTimer = 0; }
    if (!brainOutbox.length) return;
    const batch = brainOutbox.splice(0, 120);
    chrome.runtime.sendMessage({ type: 'PC_BRAIN_INGEST_BATCH', payload: batch }).catch(() => {});
    if (brainOutbox.length) brainFlushTimer = setTimeout(flushBrainOutbox, 80);
  }
  function sendBrain(type, data) {
    brainOutbox.push({ type, data });
    if (brainOutbox.length >= 100) { flushBrainOutbox(); return; }
    if (!brainFlushTimer) brainFlushTimer = setTimeout(flushBrainOutbox, 120);
  }
  function currentChatId() {
    const routed = providers.chatIdFromUrl(location.href, provider.id);
    if (routed) return routed;
    const hasConversation = turnNodes(document).length > 0;
    if (hasConversation) {
      if (!transientChatId) transientChatId = `${provider.id}:session:${hashText(`${Date.now()}|${Math.random()}|${document.title}`)}`;
      return transientChatId;
    }
    return `${provider.id}:home`;
  }
  const hashText = providers.hashString;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function applySettingsToDom() {
    if (!root) return;
    root.dataset.projectConstellationEnabled = settings.enabled ? '1' : '0';
    root.dataset.projectConstellationResponsiveScroll = settings.enabled && settings.responsiveScrolling ? '1' : '0';
    root.dataset.projectConstellationMotionRelief = settings.enabled && settings.adaptiveMotionRelief ? '1' : '0';
    applyPressure(pressure.tick());
  }

  function applyPressure(snapshot) {
    const next = settings.enabled ? snapshot.pressure : 'normal';
    if (metrics.lastPressure !== next) { metrics.pressureTransitions += 1; metrics.lastPressure = next; }
    root.dataset.projectConstellationPressure = next;
    metrics.lastUpdatedAt = Date.now();
    schedulePersist();
  }

  function scheduleRecoveryCheck() {
    if (recoveryTimer) return;
    recoveryTimer = setTimeout(() => {
      recoveryTimer = 0;
      applyPressure(pressure.tick());
      if (pressure.state === 'high') scheduleRecoveryCheck();
    }, 500);
  }

  function persistMetrics() {
    persistHandle = 0; persistHandleKind = '';
    chrome.storage.local.set({ [METRICS_KEY]: { ...metrics } }).catch(() => {});
  }

  function schedulePersist() {
    if (persistHandle) return;
    if (typeof requestIdleCallback === 'function') {
      persistHandleKind = 'idle';
      persistHandle = requestIdleCallback(persistMetrics, { timeout: 1400 });
    } else {
      persistHandleKind = 'timeout';
      persistHandle = setTimeout(persistMetrics, 600);
    }
  }

  function cancelPendingPersist() {
    if (!persistHandle) return;
    if (persistHandleKind === 'idle' && typeof cancelIdleCallback === 'function') cancelIdleCallback(persistHandle);
    else clearTimeout(persistHandle);
    persistHandle = 0; persistHandleKind = '';
  }

  function onLongTask(entry) {
    const duration = Math.round(entry.duration || 0);
    metrics.totalLongTasks += 1;
    metrics.totalLongTaskMs += duration;
    metrics.maxLongTaskMs = Math.max(metrics.maxLongTaskMs, duration);
    applyPressure(pressure.addLongTask(duration, Date.now()));
    scheduleRecoveryCheck();
  }

  function startPerformanceObserver() {
    if (!settings.enabled || performanceObserver) return;
    try {
      if (!PerformanceObserver?.supportedEntryTypes?.includes('longtask')) return;
      performanceObserver = new PerformanceObserver((list) => list.getEntries().forEach(onLongTask));
      performanceObserver.observe({ type: 'longtask', buffered: true });
    } catch (_) { performanceObserver = null; }
  }

  function stopPerformanceObserver() { performanceObserver?.disconnect(); performanceObserver = null; }

  function nodesWithin(scope, selector) {
    if (!scope) return [];
    const result = [];
    if (scope instanceof Element && scope.matches(selector)) result.push(scope);
    if (typeof scope.querySelectorAll === 'function') result.push(...scope.querySelectorAll(selector));
    return result;
  }

  function textOf(node, max = 50000) { return brain.normalizeText(node?.innerText || node?.textContent || '', max); }

  function projectHintFromAnchor(anchor) {
    if (!anchor || typeof anchor.closest !== 'function') return { id: `${provider.id}:inbox`, name: 'Inbox' };
    const section = anchor.closest('nav section, aside section, [data-testid*="project"], [class*="project"], [class*="sidebar"]');
    const heading = section?.querySelector('h1,h2,h3,[role="heading"],[data-testid*="title"]');
    const name = brain.normalizeText(heading?.textContent || '', 140);
    return name ? { id: `${provider.id}:section:${brain.safeId(name.toLowerCase())}`, name } : { id: `${provider.id}:inbox`, name: 'Inbox' };
  }

  function captureChat(anchor, explicitCurrent = false) {
    const href = anchor?.href || location.href;
    const detected = providers.detectProvider(href);
    if (!detected || detected.id !== provider.id) return;
    const id = explicitCurrent ? currentChatId() : providers.chatIdFromUrl(href, provider.id);
    if (!id) return;
    const title = brain.normalizeText(anchor?.innerText || anchor?.textContent || document.title || 'Untitled chat', 300);
    const project = projectHintFromAnchor(anchor);
    const signature = `${title}|${project.id}|${href}`;
    if (seenChats.get(id) === signature && !explicitCurrent) return;
    seenChats.set(id, signature);
    sendBrain('CHAT_UPSERT', {
      id, providerId: provider.id, providerName: provider.name, title, url: href,
      projectId: project.id, projectName: project.name, source: explicitCurrent ? 'route' : 'history-ui',
      status: explicitCurrent ? lastStatus : undefined, lastSeenAt: Date.now(), lastActivityAt: explicitCurrent ? lastSemanticActivityAt : undefined, updatedAt: Date.now()
    });
  }

  function scanChats(scope = document) {
    for (const anchor of nodesWithin(scope, 'a[href]')) {
      if (providers.isLikelyChatUrl(anchor.href, provider.id)) captureChat(anchor);
    }
    if (scope === document) captureChat({ href: location.href, innerText: document.title }, true);
  }

  function roleForTurn(node) {
    const direct = node.getAttribute?.('data-message-author-role') || node.getAttribute?.('data-author') || node.getAttribute?.('data-role');
    if (direct) return direct;
    const nested = node.querySelector?.('[data-message-author-role],[data-author]');
    const nestedRole = nested?.getAttribute('data-message-author-role') || nested?.getAttribute('data-author');
    if (nestedRole) return nestedRole;
    const label = `${node.getAttribute?.('data-testid') || ''} ${node.getAttribute?.('aria-label') || ''} ${node.getAttribute?.('data-role') || ''} ${typeof node.className === 'string' ? node.className : ''}`.trim();
    if (/user|human|prompt/i.test(label) || /^(you|me)$/i.test(label)) return 'user';
    if (/assistant|ai|bot|response/i.test(label)) return 'assistant';
    if (provider.name && label.toLowerCase().includes(provider.name.toLowerCase())) return 'assistant';
    return 'unknown';
  }

  function turnNodes(scope) {
    if (provider.id === 'chatgpt') {
      const selector = '[data-testid^="conversation-turn-"]';
      const primary = nodesWithin(scope, selector);
      if (primary.length) return primary;
      const parent = scope instanceof Element ? scope.closest(selector) : null;
      if (parent) return [parent];
      return nodesWithin(scope, '[data-message-author-role][data-message-id]');
    }
    const selectorsByProvider = {
      claude: '[data-testid*="user-message" i],[data-testid*="assistant-message" i],[data-is-streaming],article[data-testid*="conversation" i]',
      gemini: 'user-query,model-response,[data-test-id*="response" i],[data-message-id]',
      grok: '[data-testid="user-message"],[data-testid="assistant-message"],[data-testid="response-message"],[role="article"][aria-label]',
      deepseek: '[data-message-id],[data-role="user"],[data-role="assistant"],[data-testid*="message" i],[role="article"][aria-label]',
      copilot: '[data-content="user-message"],[data-content="ai-message"],[data-message-id]',
      poe: '[data-message-id],[class*="Message_row" i]',
      metaai: '[data-message-id],[data-testid*="message" i],[data-role="user"],[data-role="assistant"],[role="article"][aria-label]',
      qwen: '.qwen-chat-message-user,.qwen-chat-message-assistant,[data-message-id],[data-testid*="message" i],[data-role="user"],[data-role="assistant"],[role="article"][aria-label]',
      kimi: '[data-message-id],[data-testid*="message" i],[data-role="user"],[data-role="assistant"],[role="article"][aria-label]',
      characterai: '[data-message-id],[data-testid*="message" i],[data-author],[role="article"][aria-label]',
      huggingchat: '[data-message-id],[data-testid*="message" i],[data-role="user"],[data-role="assistant"],[role="article"][aria-label]',
      you: '[data-message-id],[data-testid*="message" i],[data-role="user"],[data-role="assistant"],[role="article"][aria-label]',
      pi: '[data-message-id],[data-testid*="message" i],[data-role="user"],[data-role="assistant"],[role="article"][aria-label]',
      duckai: '[data-message-id],[data-testid*="message" i],[data-role="user"],[data-role="assistant"],[role="article"][aria-label]'
    };
    const selector = selectorsByProvider[provider.id] || '[data-message-id],[data-author],article[data-testid*="conversation" i]';
    return nodesWithin(scope, selector);
  }

  function structuredTurnLinks(node) {
    const out = [];
    const seen = new Set();
    for (const anchor of [...node.querySelectorAll?.('a[href]') || []].slice(0, 96)) {
      const href = String(anchor.href || '').trim();
      if (!/^https?:\/\//i.test(href) || seen.has(href)) continue;
      seen.add(href);
      const contextNode = anchor.closest?.('li,p,blockquote,td,th') || anchor.parentElement;
      out.push({ href, text: brain.normalizeText(anchor.innerText || anchor.textContent || anchor.getAttribute?.('aria-label') || '', 260), context: brain.normalizeText(contextNode?.innerText || contextNode?.textContent || '', 700) });
      if (out.length >= 64) break;
    }
    return out;
  }

  function structuredCodeBlocks(node) {
    const out = [];
    const seen = new Set();
    const blocks = [...node.querySelectorAll?.('pre, code') || []];
    for (const block of blocks) {
      if (block.matches?.('code') && block.closest?.('pre')) continue;
      const text = String(block.innerText || block.textContent || '').trim();
      if (!text || text.length < 2) continue;
      const classText = `${block.className || ''} ${block.querySelector?.('code')?.className || ''}`;
      const language = (classText.match(/(?:language-|lang-)([\w#+.-]{1,30})/i)?.[1] || '').toLowerCase();
      const bounded = text.slice(0, 32000);
      const signature = hashText(`${language}|${bounded}`);
      if (seen.has(signature)) continue;
      seen.add(signature); out.push({ language, text: bounded });
      if (out.length >= 24) break;
    }
    return out;
  }

  function scanTurns(scope = document) {
    const chatId = currentChatId();
    if (!chatId || chatId.endsWith(':home')) return;
    const nodes = turnNodes(scope);
    nodes.forEach((node, localOrdinal) => {
      const text = textOf(node);
      if (!text || text.length < 2) return;
      const role = roleForTurn(node);
      const messageId = node.getAttribute?.('data-message-id') || node.querySelector?.('[data-message-id]')?.getAttribute('data-message-id') || `${role}-${hashText(text.slice(0, 300))}`;
      const ordinalAttr = node.getAttribute?.('data-testid')?.match(/(\d+)/)?.[1];
      const ordinal = ordinalAttr ? Number(ordinalAttr) : localOrdinal;
      const id = brain.turnKey(chatId, messageId, role, ordinal);
      const links = structuredTurnLinks(node);
      const codeBlocks = structuredCodeBlocks(node);
      const signature = hashText(`${role}|${text}|${links.map((item) => item.href).join('|')}|${codeBlocks.map((item) => `${item.language}:${hashText(item.text)}`).join('|')}`);
      if (seenTurnHashes.get(id) === signature) return;
      seenTurnHashes.set(id, signature);
      const previousLength = Number(seenTurnLengths.get(id) || 0);
      seenTurnLengths.set(id, text.length);
      seenTurnTextChars = Math.max(0, seenTurnTextChars + text.length - previousLength);
      healthEvidence.lastTurnProgressAt = Date.now();
      healthEvidence.lastDomProgressAt = healthEvidence.lastTurnProgressAt;
      lastSemanticActivityAt = healthEvidence.lastTurnProgressAt;
      sendBrain('TURN_UPSERT', { id, providerId: provider.id, chatId, messageId, role, ordinal, text, links, codeBlocks, source: 'mounted-dom', url: location.href, updatedAt: Date.now() });
    });
  }

  function likelyFileName(node, href) {
    const text = brain.normalizeText(node.getAttribute?.('download') || node.getAttribute?.('aria-label') || node.textContent || '', 260);
    if (text && /\.[a-z0-9]{1,10}(\b|$)/i.test(text)) return text;
    try { const part = new URL(href, location.href).pathname.split('/').filter(Boolean).pop(); return decodeURIComponent(part || text || 'file'); }
    catch (_) { return text || 'file'; }
  }

  function scanFiles(scope = document) {
    const chatId = currentChatId();
    const selector = 'a[href], [data-testid*="file"], [data-testid*="attachment"], [aria-label*="file" i], [aria-label*="download" i]';
    for (const node of nodesWithin(scope, selector)) {
      const href = node.href || node.querySelector?.('a[href]')?.href || '';
      const hint = `${href} ${node.getAttribute?.('data-testid') || ''} ${node.getAttribute?.('aria-label') || ''} ${node.textContent || ''}`;
      if (!/(file|attachment|download|sandbox:|\.pdf\b|\.docx\b|\.xlsx\b|\.pptx\b|\.zip\b|\.md\b|\.csv\b|\.json\b|\.png\b|\.jpe?g\b|\.webp\b|drive\.google\.com|docs\.google\.com|github\.com|dropbox\.com|1drv\.ms)/i.test(hint)) continue;
      const name = likelyFileName(node, href);
      const external = providers.classifyExternalUrl(href);
      const id = brain.fileKey(chatId, href, name);
      const signature = hashText(`${name}|${href}|${hint.slice(0, 700)}`);
      if (seenFileHashes.get(id) === signature) continue;
      seenFileHashes.set(id, signature);
      sendBrain('FILE_UPSERT', {
        id, providerId: provider.id, chatId, name, href,
        kind: external.kind !== 'external' ? external.kind : /attachment/i.test(hint) ? 'attachment' : /download/i.test(hint) ? 'download-link' : 'file-link',
        externalProvider: external.provider, externalUrl: external.external ? href : '', source: 'mounted-dom', updatedAt: Date.now()
      });
    }
  }

  function boundedStatusText() {
    const selectors = '[role="alert"],[role="dialog"],[aria-live="assertive"],[aria-live="polite"],button,[role="button"],[data-testid*="error"],[data-testid*="toast"]';
    const nodes = [...document.querySelectorAll(selectors)].slice(0, 240);
    return brain.normalizeText(nodes.map((node) => node.textContent || node.getAttribute?.('aria-label') || '').join(' | '), 12000);
  }


  function elementLabel(node, max = 1200) {
    return brain.normalizeText(`${node?.innerText || node?.textContent || ''} ${node?.getAttribute?.('aria-label') || ''} ${node?.getAttribute?.('title') || ''}`, max);
  }

  function isUsableControl(node) {
    if (!(node instanceof Element)) return false;
    if (node.disabled || node.getAttribute('aria-disabled') === 'true') return false;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0) return false;
    return true;
  }

  function approvalSurface() {
    const candidates = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"],[data-state="open"],[data-testid*="dialog" i],[class*="modal" i],[class*="dialog" i]')];
    candidates.push(document.querySelector('main'));
    let best = null, bestScore = -1;
    for (const node of candidates.filter(Boolean)) {
      const text = elementLabel(node, 6000);
      const lower = text.toLowerCase();
      if (!/\ballow\b/.test(lower)) continue;
      if (!/(connector|connected app|plugin|app\b|access|for this chat|for this conversation|conversation)/.test(lower)) continue;
      const controls = [...node.querySelectorAll('button,[role="button"],[role="menuitem"],label,input[type="checkbox"]')].filter(isUsableControl);
      if (!controls.some((control) => /^allow(?: once)?$/i.test(elementLabel(control, 120)))) continue;
      let score = controls.length + (/for this (chat|conversation)/i.test(text) ? 80 : 0) + (/connector|plugin|connected app/i.test(text) ? 60 : 0);
      if (node.getAttribute('role')?.includes('dialog')) score += 120;
      if (score > bestScore) { best = node; bestScore = score; }
    }
    return best;
  }

  function connectorNameFromApproval(surface) {
    const text = elementLabel(surface, 3000);
    const patterns = [
      /allow\s+chatgpt\s+to\s+use\s+([^?\n|]{1,100})/i,
      /allow\s+(.{1,80}?)\s+(?:connector|plugin|app)\s+to\b/i,
      /allow\s+(.{1,100}?)\s+to\s+(?:access|use|read|write|continue)\b/i,
      /(?:connector|plugin|app)\s*[:\-]\s*([^|\n]{1,100})/i
    ];    for (const pattern of patterns) { const match = text.match(pattern); if (match?.[1]) return brain.normalizeText(match[1], 100); }
    return '';
  }

  function approvalControls(surface = approvalSurface()) {
    if (!surface) return { surface: null, mainAllow: null, persistent: null, dropdown: null, checkbox: null };
    const all = [...document.querySelectorAll('button,[role="button"],[role="menuitem"],[role="option"],label,input[type="checkbox"]')].filter(isUsableControl);
    const within = [...surface.querySelectorAll('button,[role="button"],[role="menuitem"],[role="option"],label,input[type="checkbox"]')].filter(isUsableControl);
    const persistentPattern = /(?:^|\b)(always allow|never ask|allow all|allow.*(?:this )?(?:conversation|chat))(?:\b|$)/i;
    const persistent = all.find((node) => persistentPattern.test(elementLabel(node, 260)) && !/low[- ]risk/i.test(elementLabel(node, 260))) || null;
    const checkbox = within.find((node) => {
      const label = node.matches?.('label') ? elementLabel(node, 300) : elementLabel(node.closest?.('label') || node.parentElement, 300);
      return /always allow|allow all|never ask|conversation|this chat/i.test(label) && (node.matches?.('input[type="checkbox"]') || node.querySelector?.('input[type="checkbox"]'));
    }) || null;
    const mainAllow = within.find((node) => /^allow(?: once)?$/i.test(elementLabel(node, 120))) || null;
    let dropdown = within.find((node) => node !== mainAllow && (node.getAttribute('aria-haspopup') === 'menu' || node.getAttribute('aria-haspopup') === 'listbox') && /allow|more|option|menu/i.test(elementLabel(node, 180))) || null;
    if (!dropdown && mainAllow?.parentElement) {
      const siblings = [...mainAllow.parentElement.querySelectorAll('button,[role="button"]')].filter((node) => node !== mainAllow && isUsableControl(node));
      dropdown = siblings.find((node) => node.getAttribute('aria-haspopup') || node.querySelector('svg') || elementLabel(node, 120).length < 4) || null;
    }
    return { surface, mainAllow, persistent, dropdown, checkbox };
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function waitForDom(predicate, timeoutMs = 2600) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (value) => { if (done) return; done = true; observer.disconnect(); clearTimeout(timer); resolve(value); };
      const probe = () => { try { const value = predicate(); if (value) finish(value); } catch (_) {} };
      const observer = new MutationObserver(probe);
      observer.observe(document.documentElement || document, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded','data-state','disabled','aria-disabled'] });
      const timer = setTimeout(() => finish(null), timeoutMs);
      probe();
    });
  }

  async function settlePersistentApproval(strategy) {
    // Some ChatGPT builds make the persistent menu item approve immediately;
    // others first set the preference and leave the current Allow button active.
    // Support both without double-clicking a completed action.
    await waitForDom(() => !approvalSurface() || approvalControls(approvalSurface()).mainAllow, 900);
    const remaining = approvalSurface();
    if (remaining) {
      const controls = approvalControls(remaining);
      if (controls.mainAllow) { controls.mainAllow.click(); return `${strategy}+allow`; }
    }
    return strategy;
  }

  async function clickApprovalPersistentOption(surface, options) {
    let controls = approvalControls(surface);
    if (controls.checkbox) {
      const input = controls.checkbox.matches?.('input[type="checkbox"]') ? controls.checkbox : controls.checkbox.querySelector?.('input[type="checkbox"]');
      if (input && !input.checked) controls.checkbox.click();
      await wait(80);
      controls = approvalControls(surface);
      if (controls.mainAllow) { controls.mainAllow.click(); return { action: 'always-allow', strategy: 'checkbox+allow' }; }
    }
    if (controls.persistent) {
      controls.persistent.click();
      return { action: 'always-allow', strategy: await settlePersistentApproval('direct-persistent') };
    }
    if (controls.dropdown) {
      controls.dropdown.click();
      const persistent = await waitForDom(() => approvalControls(approvalSurface() || surface).persistent, 3200);
      controls = approvalControls(approvalSurface() || surface);
      if (persistent || controls.persistent) {
        (persistent || controls.persistent).click();
        return { action: 'always-allow', strategy: await settlePersistentApproval('dropdown-persistent') };
      }
    }
    if (options.fallbackAllowOnce !== false && controls.mainAllow) { controls.mainAllow.click(); return { action: 'allow-once', strategy: 'allow-fallback' }; }
    return { action: 'none', strategy: 'persistent-option-unavailable' };
  }

  function findResumeControl() {
    const patterns = [/^continue generating$/i,/^resume(?: response| generation)?$/i,/^continue response$/i,/^continue$/i];
    return [...document.querySelectorAll('button,[role="button"]')].filter(isUsableControl).find((node) => patterns.some((pattern) => pattern.test(elementLabel(node, 160)))) || null;
  }

  function rateLimitSurface() {
    const patterns = [/too many requests/i, /rate limit(?:ed| exceeded)?/i, /http\s*429/i, /error\s*429/i, /status\s*429/i];
    const candidates = [...document.querySelectorAll('[role="alert"], [aria-live], main, article, div')];
    for (const node of candidates.slice(-800)) {
      const label = elementLabel(node, 900);
      if (patterns.some((pattern) => pattern.test(label))) return { node, label };
    }
    const bodyText = brain.normalizeText(document.body?.innerText || '', 5000);
    if (patterns.some((pattern) => pattern.test(bodyText))) return { node: document.body, label: bodyText };
    return null;
  }

  function rateLimitWaitMs(label = '') {
    const text = String(label || '');
    const match = text.match(/(?:try again|retry|wait)[^0-9]{0,30}(\d+(?:\.\d+)?)\s*(seconds?|secs?|minutes?|mins?)/i);
    if (!match) return 15 * 60 * 1000;
    const amount = Number(match[1] || 0); const unit = String(match[2] || '').toLowerCase();
    const ms = amount * (/min/.test(unit) ? 60_000 : 1_000);
    return Math.max(30_000, Math.min(60 * 60 * 1000, Math.round(ms)));
  }

  function refreshRequiredSurface() {
    const patterns = [
      /message delivery timed out/i,
      /connection interrupted/i,
      /connection (?:was )?lost/i,
      /network connection (?:was )?lost/i,
      /reconnect(?:ion)? failed/i,
      /failed to deliver message/i
    ];
    const candidates = [...document.querySelectorAll('[role="alert"], [aria-live], main, article, div')];
    for (const node of candidates.slice(-800)) {
      const label = elementLabel(node, 900);
      if (patterns.some((pattern) => pattern.test(label))) return { node, label };
    }
    const bodyText = brain.normalizeText(document.body?.innerText || '', 5000);
    if (patterns.some((pattern) => pattern.test(bodyText))) return { node: document.body, label: bodyText };
    return null;
  }

  async function runApprovalRecoveryScan(options = {}) {
    if (approvalAutopilotBusy) return { ok: true, action: 'busy', reason: 'Approval recovery is already running.' };
    approvalAutopilotBusy = true;
    try {
      const refresh = refreshRequiredSurface();
      if (refresh) {
        return { ok: true, action: 'refresh-required', strategy: 'browser-refresh', connector: '', retryForbidden: true, reason: refresh.label.slice(0, 600) };
      }
      const limited = rateLimitSurface();
      if (limited) {
        return { ok: true, action: 'rate-limited', strategy: 'provider-cooldown', connector: '', retryForbidden: true, waitMs: rateLimitWaitMs(limited.label), reason: limited.label.slice(0, 600) };
      }
      const surface = approvalSurface();
      if (surface) {
        const connector = connectorNameFromApproval(surface);
        const prompt = elementLabel(surface, 1800);
        let result = { action: 'none', strategy: 'disabled' };
        if (options.alwaysAllow !== false) result = await clickApprovalPersistentOption(surface, options);
        else {
          const controls = approvalControls(surface);
          if (options.fallbackAllowOnce !== false && controls.mainAllow) { controls.mainAllow.click(); result = { action: 'allow-once', strategy: 'allow' }; }
        }
        if (result.action !== 'none') {
          approvalAutopilotLastAt = Date.now();
          await wait(220);
          sendBrain('STATUS_EVENT', { providerId: provider.id, chatId: currentChatId(), status: 'idle', detail: `Approval recovered automatically (${result.action})${connector ? ` · ${connector}` : ''}`, url: location.href, approvalConnector: connector, updatedAt: Date.now() });
          sendBrain('CHAT_UPSERT', { id: currentChatId(), providerId: provider.id, url: location.href, approvalRecoveredAt: Date.now(), approvalRecoveryAction: result.action, approvalConnector: connector, updatedAt: Date.now() });
          await drainBrainOutbox().catch(() => {});
        }
        return { ok: true, action: result.action, strategy: result.strategy, connector, prompt: prompt.slice(0, 1200), reason: result.action === 'none' ? 'No persistent or current Allow control was available.' : '' };
      }
      if (options.recoverPaused !== false) {
        const resume = findResumeControl();
        if (resume) { const label = elementLabel(resume, 160); resume.click(); approvalAutopilotLastAt = Date.now(); return { ok: true, action: 'resume', strategy: 'resume-control', connector: '', reason: label }; }
      }
      const ready = document.readyState === 'complete' && Boolean(document.querySelector('main') || document.querySelector('textarea,[contenteditable=\"true\"],[role=\"textbox\"]') || brain.normalizeText(document.body?.innerText || '', 500).length > 80);
      if (!ready) return { ok: true, action: 'not-ready', connector: '', reason: 'Chat UI is still hydrating.' };
      return { ok: true, action: 'none', connector: '', reason: 'No approval or resumable pause was found.' };
    } catch (error) {
      return { ok: false, action: 'failed', connector: '', error: String(error?.message || error) };
    } finally { approvalAutopilotBusy = false; }
  }

  function maybeRunApprovalAutopilot(signals) {
    if (provider.id !== 'chatgpt' || !approvalSettings.enabled || !approvalSettings.acknowledged || !signals?.approval) return;
    if (approvalAutopilotBusy || Date.now() - approvalAutopilotLastAt < 1200) return;
    queueMicrotask(() => runApprovalRecoveryScan({ alwaysAllow: approvalSettings.alwaysAllow !== false, fallbackAllowOnce: approvalSettings.fallbackAllowOnce !== false, recoverPaused: approvalSettings.autoRecoverPaused !== false }).catch(() => {}));
  }


  function latestMountedTurnEvidence() {
    const nodes = turnNodes(document);
    for (let index = nodes.length - 1; index >= Math.max(0, nodes.length - 16); index -= 1) {
      const node = nodes[index];
      const text = textOf(node, 100000);
      if (!text || text.length < 2) continue;
      const role = roleForTurn(node);
      const messageId = node.getAttribute?.('data-message-id') || node.querySelector?.('[data-message-id]')?.getAttribute('data-message-id') || `${role}-${hashText(text.slice(0, 300))}`;
      const ordinalAttr = node.getAttribute?.('data-testid')?.match(/(\d+)/)?.[1];
      const ordinal = ordinalAttr ? Number(ordinalAttr) : index;
      return { id: brain.turnKey(currentChatId(), messageId, role, ordinal), messageId, role, ordinal, textHash: hashText(text), textLength: text.length, capturedAt: Date.now() };
    }
    return null;
  }

  function isConversationBottom() {
    try {
      const m = scrollMetrics(findConversationScroller());
      return m.max <= 80 || m.top >= m.max - Math.max(80, Math.min(320, m.client * 0.16));
    } catch (_) { return true; }
  }

  function renderedConversationDegraded() {
    const nodes = turnNodes(document).slice(-16);
    for (const node of nodes) {
      const rect = node.getBoundingClientRect?.();
      if (!rect || rect.bottom < 0 || rect.top > innerHeight) continue;
      const raw = brain.normalizeText(node.textContent || '', 12000);
      if (raw.length < 40) continue;
      const rendered = brain.normalizeText(node.innerText || '', 12000);
      const style = getComputedStyle(node);
      if (style.visibility === 'hidden' || Number(style.opacity || 1) <= 0.02) return true;
      if (rendered.length < 4 && raw.length > 80) return true;
    }
    return false;
  }

  const TOOL_EVENT_PATTERN = /(?:called tool|calling tool|tool call|used [^|\n]{0,80} skill|search(?:ed|ing)|web search|fet(?:ched|ching)|inspect(?:ed|ing)|read(?:ing)?|brows(?:ed|ing)|run(?:ning)? tool|using [^|\n]{0,100}tool|audit(?:ed|ing)|patch(?:ed|ing)|analyz(?:ed|ing)|updat(?:ed|ing)|upload(?:ed|ing)|download(?:ed|ing)|verif(?:ied|ying)|test(?:ed|ing)|build(?:ing|t)|packag(?:ed|ing)|execut(?:ed|ing)|terminal)/i;
  const GENERIC_TOOL_PATTERN = /^(?:called tool|calling tool|tool call|used [^|\n]{0,80} skill|ran tool|running tool)$/i;

  function toolPhaseFromLabel(label = '') {
    const text = String(label || '').toLowerCase();
    if (/search|brows/.test(text)) return 'searching';
    if (/fetch|download|read/.test(text)) return 'retrieving';
    if (/inspect|audit|analyz/.test(text)) return 'inspecting';
    if (/upload|drive/.test(text)) return 'publishing';
    if (/github/.test(text)) return 'repository';
    if (/verif|test|smoke/.test(text)) return 'verifying';
    if (/build|packag/.test(text)) return 'building';
    if (/patch|updat|edit|writ/.test(text)) return 'editing';
    if (/terminal|execut|run/.test(text)) return 'executing';
    if (/called tool|calling tool|tool call/.test(text)) return 'tool call';
    if (/used .*skill/.test(text)) return 'skill';
    return 'tool';
  }

  function detectToolEvidence(force = false) {
    const now = Date.now();
    const cacheMs = lastStatus === 'running' ? 1200 : 5000;
    if (!force && !toolEvidenceDirty && lastToolEvidence && now - lastToolScanAt < cacheMs) return lastToolEvidence;
    const rootNode = document.querySelector('main') || document.body;
    if (!rootNode) return { present:false, active:false, busy:false, label:'', phase:'', lastProgressAt:healthEvidence.lastToolProgressAt, startedAt:healthEvidence.lastToolStartedAt, entryCount:0, generic:false };
    const selector = '[data-testid*="tool" i],[aria-label*="tool" i],[class*="tool" i],[data-message-author-role="tool"],[data-state*="loading" i],[data-state*="pending" i],[aria-busy="true"],[aria-live]';
    const nodes = [...rootNode.querySelectorAll(selector)].slice(-220);
    const entries = [];
    for (const node of nodes) {
      const visibleLabel = brain.normalizeText(node.textContent || '', 520);
      const ariaLabel = brain.normalizeText(node.getAttribute?.('aria-label') || '', 260);
      const titleLabel = brain.normalizeText(node.getAttribute?.('title') || '', 260);
      const label = visibleLabel || ariaLabel || titleLabel;
      if (!label || !TOOL_EVENT_PATTERN.test(label)) continue;
      const stateText = `${node.getAttribute?.('data-state') || ''} ${node.getAttribute?.('aria-busy') || ''} ${node.getAttribute?.('aria-expanded') || ''} ${node.className || ''}`.slice(0, 220);
      const busy = node.getAttribute?.('aria-busy') === 'true' || /loading|pending|running|streaming|progress/i.test(stateText) || Boolean(node.querySelector?.('[aria-busy="true"],[data-state*="loading" i],[data-state*="pending" i],[class*="spinner" i],[class*="loading" i]'));
      entries.push({ label: label.slice(0, 220), stateText, busy });
    }
    const tail = entries.slice(-36);
    const latest = tail.at(-1) || null;
    const informative = [...tail].reverse().find((row) => !GENERIC_TOOL_PATTERN.test(row.label)) || latest;
    const latestGeneric = Boolean(latest && GENERIC_TOOL_PATTERN.test(latest.label));
    const label = brain.normalizeText((latestGeneric ? informative?.label : latest?.label) || latest?.label || '', 150);
    const busy = tail.slice(-10).some((row) => row.busy);
    const active = Boolean(tail.length) && (lastStatus === 'running' || busy);
    const signatureInput = tail.map((row) => `${row.label}|${row.busy ? 1 : 0}|${row.stateText}`).join('||');
    const signature = tail.length ? hashText(`${tail.length}|${signatureInput}`) : '';
    if (active && !healthEvidence.lastToolStartedAt) healthEvidence.lastToolStartedAt = now;
    if (!active) healthEvidence.lastToolStartedAt = 0;
    if (signature && signature !== healthEvidence.lastToolSignature) {
      healthEvidence.lastToolSignature = signature;
      healthEvidence.lastToolEntryCount = tail.length;
      healthEvidence.lastToolProgressAt = now;
      healthEvidence.lastToolHash = hashText(label || latest?.label || signature);
      healthEvidence.lastToolLabel = label;
      healthEvidence.lastDomProgressAt = now;
      lastSemanticActivityAt = Math.max(lastSemanticActivityAt, now);
    } else if (label && label !== healthEvidence.lastToolLabel && active) {
      healthEvidence.lastToolLabel = label;
      healthEvidence.lastToolProgressAt = now;
      healthEvidence.lastDomProgressAt = now;
      lastSemanticActivityAt = Math.max(lastSemanticActivityAt, now);
    }
    lastToolEvidence = {
      present: Boolean(tail.length),
      active,
      busy,
      label: (label || latest?.label || '').slice(0, 110),
      phase: toolPhaseFromLabel(latest?.label || label),
      lastProgressAt: healthEvidence.lastToolProgressAt,
      startedAt: healthEvidence.lastToolStartedAt,
      entryCount: tail.length,
      generic: latestGeneric,
      signature
    };
    lastToolScanAt = now;
    toolEvidenceDirty = false;
    return lastToolEvidence;
  }

  function conversationCapacityEvidence(context = {}) {
    const statusText = String(healthEvidence.lastStatusText || '');
    const explicitMatch = statusText.match(/(?:maximum conversation length|conversation (?:is )?too long|this conversation has reached.{0,80}limit|start a new chat to continue|context length (?:is )?(?:exceeded|too long)|maximum context length|conversation limit (?:reached|exceeded))/i);
    return {
      storedTurns: Math.max(0, Number(context.capacity?.storedTurns || 0)),
      sessionTurns: seenTurnHashes.size,
      mountedTurns: seenTurnHashes.size,
      capturedChars: seenTurnTextChars,
      explicitLimitSignal: Boolean(explicitMatch),
      explicitLimitText: explicitMatch ? brain.normalizeText(explicitMatch[0], 220) : ''
    };
  }

  async function copyHandoffText(text) {
    const value = String(text || '');
    if (!value) throw new Error('Constellation did not produce handoff text.');
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); return true; }
    } catch (_) {}
    const area = handoffClipboardArea || document.createElement('textarea');
    handoffClipboardArea = area;
    area.value = value; area.setAttribute('readonly',''); area.setAttribute('aria-hidden','true');
    area.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    if (!area.isConnected) document.documentElement.appendChild(area);
    area.select(); area.setSelectionRange(0, area.value.length);
    const copied = document.execCommand?.('copy'); area.blur(); area.value = '';
    if (!copied) throw new Error('Handoff was secured, but the browser blocked clipboard access. Open Constellation to copy it from the checkpoint.');
    return true;
  }

  async function secureConversationHandoff(button) {
    if (!button || button.dataset.busy === '1') return;
    const prior = button.textContent; button.dataset.busy = '1'; button.disabled = true; button.textContent = 'Securing handoff…';
    try {
      const result = await chrome.runtime.sendMessage({ type:'PC_PREPARE_CHAT_HANDOFF', chatId:currentChatId(), url:location.href, capacity:liveHealthSnapshot?.capacity || conversationCapacityEvidence({}) });
      if (!result?.ok) throw new Error(result?.error || 'Could not secure the handoff.');
      await copyHandoffText(result.markdown || '');
      const driveLabel = result.drive?.verified ? ' · Drive verified' : result.drive?.attempted ? ' · Drive pending' : ' · local checkpoint';
      button.textContent = `Handoff copied${driveLabel}`;
      button.title = result.checkpointId ? `Checkpoint ${result.checkpointId}` : 'Safe handoff copied';
      setTimeout(() => { if (button.isConnected) { button.textContent = 'Secure handoff'; button.disabled = false; button.dataset.busy = '0'; } }, 4200);
    } catch (error) {
      button.textContent = 'Handoff failed'; button.title = String(error?.message || error);
      setTimeout(() => { if (button.isConnected) { button.textContent = prior || 'Secure handoff'; button.disabled = false; button.dataset.busy = '0'; } }, 3600);
    }
  }

  function pageHealthEvidence(context = {}) {
    const latestMounted = latestMountedTurnEvidence();
    if (latestMounted) healthEvidence.latestMountedTurn = latestMounted;
    const current = healthEvidence.latestMountedTurn;
    const known = Array.isArray(context.latestTurns) ? context.latestTurns : [];
    const match = current && known.some((row) => (row.id && row.id === current.id) || (row.messageId && row.messageId === current.messageId) || (row.textHash && row.textHash === current.textHash));
    const hydrated = Date.now() - routeStartedAt >= Number(liveHealthSettings.hydrationGraceMs || health.DEFAULTS.hydrationGraceMs);
    const atBottom = isConversationBottom();
    const authoritativeCoverage = ['full-export','official-export','full-dom-walk'].includes(String(context.chat?.coverage || '')) || /export/i.test(String(context.chat?.source || ''));
    const catalogNewerThanPage = Number(context.chat?.updatedAt || context.chat?.catalogFetchedAt || 0) > routeStartedAt + 1500;
    const canCompare = hydrated && atBottom && (authoritativeCoverage || catalogNewerThanPage) && !['running','blocked-approval','refresh-required','rate-limited'].includes(lastStatus);
    const catalogAhead = Boolean(canCompare && known.length && current && !match);
    const missingLatest = Boolean(canCompare && known.length && !current && document.readyState === 'complete');
    return { refreshRequired: lastStatus === 'refresh-required', catalogAhead: catalogAhead || missingLatest, staleRevision: false, renderDegraded: hydrated && renderedConversationDegraded(), atBottom, hydrated, latestMounted: current };
  }

  function healthHudCss() {
    return `
      :host{all:initial;position:fixed;z-index:2147483000;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#f5f7ff;--pc-accent:#8b5cf6;--pc-level:#63d6a7;--pc-bg:rgba(7,10,28,.94);--pc-line:rgba(160,174,255,.16);--pc-muted:#a1a9ca;--pc-shadow:0 18px 60px rgba(2,3,18,.52),0 0 28px rgba(91,73,200,.09);pointer-events:none}
      :host([data-corner="bottom-right"]){right:18px;bottom:18px}:host([data-corner="bottom-left"]){left:18px;bottom:18px}:host([data-corner="top-right"]){right:18px;top:18px}:host([data-corner="top-left"]){left:18px;top:18px}
      :host([data-level="active"]),:host([data-level="info"]){--pc-level:#7f92ff}:host([data-level="warning"]){--pc-level:#f0c567}:host([data-level="danger"]){--pc-level:#ff8f8f}:host([data-level="critical"]){--pc-level:#ff676f}
      .hud{pointer-events:auto;width:350px;box-sizing:border-box;border:1px solid color-mix(in srgb,var(--pc-level) 32%,var(--pc-line));border-radius:16px;background:radial-gradient(circle at 92% 4%,rgba(79,118,240,.12),transparent 38%),linear-gradient(145deg,color-mix(in srgb,var(--pc-bg) 92%,var(--pc-level) 8%),var(--pc-bg));box-shadow:var(--pc-shadow);backdrop-filter:blur(18px) saturate(1.12);overflow:hidden;transition:width .18s ease,transform .18s ease,border-color .18s ease}
      .top{display:flex;align-items:center;gap:9px;padding:11px 12px 9px}.orb{width:9px;height:9px;border-radius:50%;background:var(--pc-level);box-shadow:0 0 0 4px color-mix(in srgb,var(--pc-level) 14%,transparent),0 0 18px color-mix(in srgb,var(--pc-level) 50%,transparent);flex:0 0 auto}.brand{min-width:0;flex:1}.eyebrow{font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--pc-muted);line-height:1.2}.state{font-size:12px;font-weight:720;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}.substate{font-size:8.5px;color:#9099a8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}.tools{display:flex;gap:4px}.icon{appearance:none;border:0;background:transparent;color:#adb5c4;border-radius:7px;width:27px;height:27px;cursor:pointer;font:600 14px/1 system-ui}.icon:hover{background:rgba(255,255,255,.08);color:white}
      .body{padding:0 12px 11px}.detail{font-size:10.5px;line-height:1.48;color:#b8bfcc;margin:0 0 9px}.chips{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:9px}.chip{font-size:8px;line-height:1;border:1px solid rgba(255,255,255,.11);border-radius:999px;padding:5px 6px;color:#aeb7c6;background:rgba(255,255,255,.035)}.metrics{display:grid;grid-template-columns:1fr 1fr;gap:6px}.metric{border:1px solid rgba(255,255,255,.08);border-radius:9px;background:rgba(255,255,255,.025);padding:7px 8px}.metric span{display:block;color:#7f8898;font-size:7.5px;text-transform:uppercase;letter-spacing:.08em}.metric strong{display:block;color:#e7ebf2;font-size:10px;margin-top:3px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.actions{display:flex;gap:6px;margin-top:9px}.btn{appearance:none;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.045);color:#cbd2de;border-radius:8px;padding:7px 9px;font:600 9px/1.1 system-ui;cursor:pointer}.btn:hover{background:rgba(255,255,255,.085);color:white}.btn.primary{background:color-mix(in srgb,var(--pc-level) 16%,rgba(255,255,255,.04));border-color:color-mix(in srgb,var(--pc-level) 42%,rgba(255,255,255,.12));color:#fff}.btn[hidden]{visibility:hidden;position:absolute;pointer-events:none;opacity:0}
      :host([data-level="active"]) .orb{animation:pc-health-pulse 1.35s ease-in-out infinite}:host([data-state="tool-stalled"]) .orb,:host([data-state="request-stalled"]) .orb,:host([data-state="stalled"]) .orb{animation:pc-health-alert 1.1s ease-in-out infinite}:host([data-state="tool-dead"]) .orb,:host([data-state="dead"]) .orb{box-shadow:0 0 0 5px color-mix(in srgb,var(--pc-level) 18%,transparent),0 0 24px color-mix(in srgb,var(--pc-level) 68%,transparent)}
      :host([data-density="compact"][data-collapsed="1"]) .hud{width:292px;border-radius:999px}:host([data-collapsed="1"]) .body{height:0;overflow:hidden;padding:0}:host([data-collapsed="1"]) .top{padding:9px 10px}:host([data-collapsed="1"]) .eyebrow{font-size:7px}:host([data-collapsed="1"]) .state{font-size:10.5px}:host([data-collapsed="1"]) .substate{font-size:7.5px}
      :host([data-visible="0"]){visibility:hidden;opacity:0;pointer-events:none}
      @keyframes pc-health-pulse{0%,100%{transform:scale(.92);opacity:.72}50%{transform:scale(1.18);opacity:1}}@keyframes pc-health-alert{0%,100%{transform:scale(1)}50%{transform:scale(1.22)}}
      @media (max-width:620px){:host([data-corner$="right"]){right:8px}:host([data-corner$="left"]){left:8px}:host([data-corner^="bottom"]){bottom:8px}:host([data-corner^="top"]){top:8px}.hud{width:min(350px,calc(100vw - 16px))}:host([data-density="compact"][data-collapsed="1"]) .hud{width:min(292px,calc(100vw - 16px))}}
      @media (prefers-reduced-motion:reduce){.hud{transition:none}.orb{box-shadow:none!important;animation:none!important}}
    `;
  }

  function ensureLiveHealthHud() {
    if (liveHealthHost?.isConnected) return liveHealthHost;
    const host = document.createElement('div');
    host.id = 'projectConstellationHealthHud';
    host.dataset.corner = liveHealthSettings.corner || 'bottom-right'; host.dataset.density = liveHealthSettings.density || 'compact'; host.dataset.collapsed = liveHealthSettings.density === 'compact' ? '1' : '0'; host.dataset.visible = '1';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${healthHudCss()}</style><section class="hud" role="status" aria-live="polite"><div class="top"><span class="orb"></span><div class="brand"><div class="eyebrow">CONSTELLATION · EXECUTION PULSE</div><div class="state" id="pcHealthTitle">Starting monitor…</div><div class="substate" id="pcHealthMini">Watching model, tool, DOM, and network proof…</div></div><div class="tools"><button class="icon" id="pcHealthOpen" title="Open Project Constellation">↗</button><button class="icon" id="pcHealthCollapse" title="Expand or collapse">−</button></div></div><div class="body"><p class="detail" id="pcHealthDetail">Building a local execution-health picture without making provider requests.</p><div class="chips" id="pcHealthChips"></div><div class="metrics"><div class="metric"><span>Last proof</span><strong id="pcHealthProgress">—</strong></div><div class="metric"><span>Network</span><strong id="pcHealthNetwork">observing</strong></div><div class="metric"><span>Activity</span><strong id="pcHealthActivity">model</strong></div><div class="metric"><span>Tool pulse</span><strong id="pcHealthTool">—</strong></div><div class="metric"><span>Project</span><strong id="pcHealthProject">—</strong></div><div class="metric"><span>Page</span><strong id="pcHealthPage">current</strong></div><div class="metric capacity"><span>Capacity</span><strong id="pcHealthCapacity">clear</strong></div><div class="metric"><span>Handoff</span><strong id="pcHealthHandoffState">ready</strong></div></div><div class="actions"><button class="btn primary" id="pcHealthRefresh" hidden>Refresh chat</button><button class="btn primary" id="pcHealthHandoff" hidden>Secure handoff</button><button class="btn" id="pcHealthSettings">Health settings</button></div></div></section>`;
    document.documentElement.appendChild(host);
    liveHealthHost = host; liveHealthShadow = shadow;
    shadow.getElementById('pcHealthCollapse').addEventListener('click', () => { host.dataset.collapsed = host.dataset.collapsed === '1' ? '0' : '1'; shadow.getElementById('pcHealthCollapse').textContent = host.dataset.collapsed === '1' ? '+' : '−'; });
    shadow.getElementById('pcHealthOpen').addEventListener('click', () => chrome.runtime.sendMessage({ type:'PC_OPEN_CONSTELLATION_PAGE', view:'attention' }).catch(() => {}));
    shadow.getElementById('pcHealthSettings').addEventListener('click', () => chrome.runtime.sendMessage({ type:'PC_OPEN_CONSTELLATION_PAGE', view:'attention', focus:'live-health' }).catch(() => {}));
    shadow.getElementById('pcHealthRefresh').addEventListener('click', () => location.reload());
    shadow.getElementById('pcHealthHandoff').addEventListener('click', (event) => secureConversationHandoff(event.currentTarget));
    return host;
  }

  function ageText(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '—';
    if (ms < 1000) return 'now';
    const sec = Math.round(ms / 1000); if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60); const rem = sec % 60; return `${min}m ${rem}s ago`;
  }

  function renderLiveHealthHud(snapshot, context = {}, page = {}) {
    liveHealthSnapshot = snapshot;
    if (!liveHealthSettings.enabled || currentChatId().endsWith(':home')) { if (liveHealthHost) liveHealthHost.dataset.visible = '0'; return; }
    const host = ensureLiveHealthHud(); const shadow = liveHealthShadow;
    const capacityAttention = ['watch','handoff','reached'].includes(snapshot.capacity?.state || '');
    host.dataset.visible = snapshot.state === 'healthy' && !capacityAttention && liveHealthSettings.showHealthy === false ? '0' : '1';
    host.dataset.corner = liveHealthSettings.corner || 'bottom-right'; host.dataset.density = liveHealthSettings.density || 'compact'; host.dataset.level = snapshot.level || 'healthy'; host.dataset.state = snapshot.state || 'healthy';
    shadow.getElementById('pcHealthTitle').textContent = snapshot.title || 'Chat health';
    shadow.getElementById('pcHealthDetail').textContent = snapshot.detail || '';
    shadow.getElementById('pcHealthChips').innerHTML = (snapshot.chips || []).map((chip) => `<span class="chip">${String(chip).replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</span>`).join('');
    shadow.getElementById('pcHealthProgress').textContent = ageText(snapshot.progressAgeMs || 0);
    const network = context.network || {};
    const networkText = snapshot.networkActive ? `${network.pending || 1} active${snapshot.networkProgressAgeMs >= 1000 ? ` · ${ageText(snapshot.networkProgressAgeMs)}` : ''}` : network.observed ? 'quiet' : 'DOM only';
    shadow.getElementById('pcHealthNetwork').textContent = networkText;
    const activity = snapshot.activity || null;
    const activityKind = activity?.kind === 'tool' ? (activity.phase || 'tool') : activity?.kind === 'model' ? (activity.phase || 'model') : snapshot.state === 'blocked-approval' ? 'approval' : snapshot.state === 'paused' ? 'paused' : 'model';
    shadow.getElementById('pcHealthActivity').textContent = activityKind;
    shadow.getElementById('pcHealthTool').textContent = activity?.kind === 'tool' ? `${activity.entryCount || 1} step${Number(activity.entryCount || 1) === 1 ? '' : 's'} · ${ageText(activity.ageMs || 0)}` : '—';
    const miniParts = [];
    if (activity?.kind === 'tool') miniParts.push(activity.phase || 'tool', ageText(activity.ageMs || 0));
    else miniParts.push(snapshot.state === 'working' ? 'model active' : snapshot.state.replaceAll('-', ' '));
    miniParts.push(snapshot.networkActive ? `${network.pending || 1} live request${Number(network.pending || 1) === 1 ? '' : 's'}` : `last proof ${ageText(snapshot.progressAgeMs || 0)}`);
    shadow.getElementById('pcHealthMini').textContent = miniParts.filter(Boolean).join(' · ');
    shadow.getElementById('pcHealthProject').textContent = context.baseline?.latestVersion ? `v${context.baseline.latestVersion}${snapshot.projectRisk ? ' · risk' : ''}` : snapshot.projectRisk ? 'attention' : 'tracked';
    shadow.getElementById('pcHealthPage').textContent = page.renderDegraded ? 'degraded' : page.catalogAhead ? 'behind' : page.atBottom ? 'current' : 'browsing history';
    const capacity = snapshot.capacity || {};
    const turns = Number(capacity.turnCount || 0);
    shadow.getElementById('pcHealthCapacity').textContent = capacity.state === 'reached' ? 'provider limit' : capacity.state === 'handoff' ? `${turns || 'large'} turns · secure` : capacity.state === 'watch' ? `${turns || 'large'} turns · watch` : turns ? `${turns} turns · clear` : 'clear';
    shadow.getElementById('pcHealthHandoffState').textContent = capacity.recommendedAction === 'handoff' ? 'checkpoint now' : 'armed';
    shadow.getElementById('pcHealthRefresh').hidden = snapshot.recommendedAction !== 'refresh';
    shadow.getElementById('pcHealthHandoff').hidden = capacity.recommendedAction !== 'handoff';
  }

  async function updateLiveHealth() {
    if (liveHealthPollBusy) return;
    if (!liveHealthSettings.enabled || currentChatId().endsWith(':home')) { if (liveHealthHost) liveHealthHost.dataset.visible = '0'; return; }
    liveHealthPollBusy = true;
    try {
      const tool = detectToolEvidence();
      const response = await chrome.runtime.sendMessage({ type:'PC_LIVE_HEALTH_CONTEXT', chatId:currentChatId(), url:location.href }).catch(() => null);
      const context = response?.ok ? response : { network:{ pending:0, observed:false }, latestTurns:[], integrityFindings:[], settings:liveHealthSettings };
      if (context.settings) liveHealthSettings = health.normalizeSettings({ ...liveHealthSettings, ...context.settings });
      const page = pageHealthEvidence(context);
      const capacity = conversationCapacityEvidence(context);
      const snapshot = health.deriveHealth({ now:Date.now(), settings:liveHealthSettings, chatStatus:lastStatus, running:lastStatus==='running', network:context.network || {}, tool, page, capacity, integrityFindings:context.integrityFindings || [], baselineVersion:context.baseline?.latestVersion || '', lastTurnProgressAt:healthEvidence.lastTurnProgressAt, lastDomProgressAt:healthEvidence.lastDomProgressAt, lastStatusChangeAt:healthEvidence.lastStatusChangeAt });
      renderLiveHealthHud(snapshot, context, page);
      const prior = healthEvidence.lastHealthState || '';
      const activitySignature = hashText(`${snapshot.state}|${snapshot.level}|${snapshot.activity?.kind || ''}|${snapshot.activity?.phase || ''}|${snapshot.activity?.label || ''}|${snapshot.activity?.entryCount || 0}|${snapshot.networkActive ? 1 : 0}`);
      if (prior !== snapshot.state || activitySignature !== healthEvidence.lastHealthActivitySignature) {
        healthEvidence.lastHealthState = snapshot.state;
        healthEvidence.lastHealthActivitySignature = activitySignature;
        sendBrain('CHAT_UPSERT', { id:currentChatId(), providerId:provider.id, url:location.href, liveHealthState:snapshot.state, liveHealthLevel:snapshot.level, liveHealthTitle:snapshot.title, liveHealthDetail:snapshot.detail, liveHealthActivityKind:snapshot.activity?.kind || '', liveHealthActivityPhase:snapshot.activity?.phase || '', liveHealthActivityLabel:snapshot.activity?.label || '', liveHealthToolSteps:Number(snapshot.activity?.entryCount || 0), liveHealthNetworkActive:Boolean(snapshot.networkActive), liveHealthProgressAgeMs:Number(snapshot.progressAgeMs || 0), liveHealthUpdatedAt:Date.now(), updatedAt:Date.now() });
      }
    } finally { liveHealthPollBusy = false; }
  }

  function scheduleLiveHealthPulse(delay) {
    if (liveHealthTimer) clearTimeout(liveHealthTimer);
    if (!liveHealthSettings.enabled) { if (liveHealthHost) liveHealthHost.dataset.visible = '0'; return; }
    const active = ['running','blocked-approval','paused','refresh-required','rate-limited','stalled'].includes(lastStatus) || ['working','tool-running','tool-quiet','tool-stalled','tool-dead','quiet-working','request-stalled','stalled','dead'].includes(liveHealthSnapshot?.state || '');
    const pressureDelay = metrics.lastPressure === 'high' ? 5000 : 0;
    const nextDelay = delay ?? (document.hidden ? 30000 : active ? liveHealthSettings.pollActiveMs : liveHealthSettings.pollIdleMs);
    liveHealthTimer = setTimeout(() => { liveHealthTimer = 0; updateLiveHealth().finally(() => scheduleLiveHealthPulse()); }, Math.max(900, pressureDelay, Number(nextDelay || 2500)));
  }

  function detectStatus() {
    const statusText = boundedStatusText();
    const lower = statusText.toLowerCase();
    const signals = {
      text: statusText,
      running: /stop generating|stop response|cancel generation|generating|thinking|reasoning/.test(lower) || Boolean(document.querySelector('[data-is-streaming="true"],[aria-busy="true"]')),
      paused: /continue generating|resume generation|resume response/.test(lower),
      approval: provider.id === 'chatgpt' && Boolean(approvalSurface()) || /(allow|approve|permission|confirm).{0,180}(drive|github|connector|connected app|plugin|access|tool|use|continue)/.test(lower),
      refreshRequired: Boolean(refreshRequiredSurface()) || /message delivery timed out|connection interrupted|connection (?:was )?lost|network connection (?:was )?lost|reconnect(?:ion)? failed|failed to deliver message/.test(lower),
      rateLimited: Boolean(rateLimitSurface()) || /too many requests|rate limit(?:ed| exceeded)?|http\s*429|error\s*429|status\s*429/.test(lower),
      error: /something went wrong|there was an error|retry|try again|network error|failed to (generate|respond|send)/.test(lower),
      authRequired: /sign in|log in|login required|session expired/.test(lower),
      unavailable: /conversation.{0,30}(not found|unavailable|deleted)|page not found/.test(lower)
    };
    healthEvidence.lastStatusText = statusText;
    const statusHash = hashText(statusText);
    if (statusHash && statusHash !== lastStatusTextHash) { lastStatusTextHash = statusHash; healthEvidence.lastDomProgressAt = Date.now(); }
    const next = brain.classifyChatStatus(signals);
    if (signals.approval) maybeRunApprovalAutopilot(signals);
    if (next !== lastStatus) {
      lastStatus = next;
      healthEvidence.lastStatusChangeAt = Date.now();
      lastSemanticActivityAt = healthEvidence.lastStatusChangeAt;
      sendBrain('STATUS_EVENT', { providerId: provider.id, chatId: currentChatId(), status: next, detail: statusText.slice(0, 1200), url: location.href, approvalConnector: signals.approval ? connectorNameFromApproval(approvalSurface()) : '', recoveryKind: signals.refreshRequired ? 'browser-refresh' : signals.rateLimited ? 'provider-cooldown' : '', retryForbidden: Boolean(signals.refreshRequired || signals.rateLimited), rateLimitWaitMs: signals.rateLimited ? rateLimitWaitMs(statusText) : 0, updatedAt: Date.now() });
      if (signals.refreshRequired) chrome.runtime.sendMessage({ type: 'PC_REFRESH_RECOVERY_REQUEST', chatId: currentChatId(), url: location.href, detail: statusText.slice(0, 600) }).catch(() => {});
    } else if (next === 'running') {
      sendBrain('STATUS_HEARTBEAT', { providerId: provider.id, chatId: currentChatId(), status: next, lastActivityAt: lastSemanticActivityAt, url: location.href, updatedAt: Date.now() });
    }
  }

  function processCaptureQueue() {
    captureHandle = 0; captureHandleKind = '';
    if (document.hidden) return;
    const roots = pendingRoots.size ? [...pendingRoots] : [document];
    pendingRoots.clear();
    for (const scope of roots.slice(0, 40)) {
      scanChats(scope); scanTurns(scope); scanFiles(scope);
    }
    detectStatus();
  }

  function scheduleCapture(scope) {
    if (scope) {
      if (scope instanceof Element) {
        for (const existing of pendingRoots) {
          if (existing instanceof Element && existing.contains(scope)) return;
          if (scope.contains(existing)) pendingRoots.delete(existing);
        }
      }
      pendingRoots.add(scope);
      if (pendingRoots.size > 40) { pendingRoots.clear(); pendingRoots.add(document.querySelector('main') || document); }
    }
    if (captureHandle) return;
    const run = () => processCaptureQueue();
    if (typeof requestIdleCallback === 'function') {
      captureHandleKind = 'idle';
      captureHandle = requestIdleCallback(run, { timeout: 700 });
    } else {
      captureHandleKind = 'timeout';
      captureHandle = setTimeout(run, 120);
    }
  }

  function cancelCapture() {
    if (!captureHandle) return;
    if (captureHandleKind === 'idle' && typeof cancelIdleCallback === 'function') cancelIdleCallback(captureHandle);
    else clearTimeout(captureHandle);
    captureHandle = 0; captureHandleKind = '';
  }

  function setupCaptureObserver() {
    captureObserver?.disconnect();
    captureObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          scheduleCapture(mutation.target);
          if (mutation.target.matches?.('[data-testid*="tool" i],[aria-label*="tool" i],[class*="tool" i],[aria-busy],[data-state]')) toolEvidenceDirty = true;
        }
        for (const node of mutation.addedNodes) if (node instanceof Element) {
          scheduleCapture(node);
          if (node.matches?.('[data-testid*="tool" i],[aria-label*="tool" i],[class*="tool" i],[aria-busy],[data-state]') || node.querySelector?.('[data-testid*="tool" i],[aria-label*="tool" i],[class*="tool" i],[aria-busy],[data-state]')) toolEvidenceDirty = true;
        }
      }
    });
    captureObserver.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['href','data-message-id','data-testid','aria-label','aria-busy','data-is-streaming'] });
    scheduleCapture(document);
  }

  function updateRoute() {
    if (metrics.route === location.pathname + location.search) return;
    metrics.route = location.pathname + location.search;
    if (!providers.chatIdFromUrl(location.href, provider.id) && !document.querySelector?.('[data-testid^="conversation-turn-"],[data-message-author-role][data-message-id]')) transientChatId = '';
    metrics.lastUpdatedAt = Date.now();
    lastSemanticActivityAt = Date.now();
    routeStartedAt = Date.now();
    healthEvidence.lastTurnProgressAt = routeStartedAt; healthEvidence.lastDomProgressAt = routeStartedAt; healthEvidence.lastStatusChangeAt = routeStartedAt; healthEvidence.latestMountedTurn = null; healthEvidence.lastToolHash = ''; healthEvidence.lastToolProgressAt = 0; healthEvidence.lastToolStartedAt = 0; healthEvidence.lastToolEntryCount = 0; healthEvidence.lastToolSignature = ''; healthEvidence.lastToolLabel = ''; healthEvidence.lastHealthActivitySignature = ''; lastToolEvidence = null; lastToolScanAt = 0; toolEvidenceDirty = true;
    seenTurnHashes.clear(); seenTurnLengths.clear(); seenTurnTextChars = 0; seenFileHashes.clear();
    schedulePersist();
    sendBrain('ROUTE_EVENT', { providerId: provider.id, chatId: currentChatId(), url: location.href, title: document.title, updatedAt: Date.now() });
    scheduleCapture(document);
  }

  function setupNavigationTracking() {
    if (globalThis.navigation?.addEventListener) {
      const handler = () => queueMicrotask(updateRoute);
      navigation.addEventListener('navigate', handler);
      navCleanup = () => navigation.removeEventListener('navigate', handler);
      return;
    }
    window.addEventListener('popstate', updateRoute, { passive: true });
    window.addEventListener('hashchange', updateRoute, { passive: true });
    navCleanup = () => { window.removeEventListener('popstate', updateRoute); window.removeEventListener('hashchange', updateRoute); };
  }

  function configure(nextSettings) {
    Object.assign(settings, perf.DEFAULTS, nextSettings || {});
    pressure.configure(settings);
    applySettingsToDom();
    if (settings.enabled) startPerformanceObserver(); else stopPerformanceObserver();
  }

  async function loadSettings() {
    try {
      const stored = await chrome.storage.local.get([STORAGE_KEY, BRAIN_SETTINGS_KEY]);
      configure(stored?.[STORAGE_KEY]);
      approvalSettings = { ...approvalSettings, ...(stored?.[BRAIN_SETTINGS_KEY]?.approvalAutopilot || {}) };
      liveHealthSettings = health.normalizeSettings({ ...liveHealthSettings, ...(stored?.[BRAIN_SETTINGS_KEY]?.liveHealth || {}) });
    } catch (_) { configure(); }
  }

  let manualCaptureCommand = 'run';
  let manualAsyncRunner = null;

  async function drainBrainOutbox() {
    if (brainFlushTimer) { clearTimeout(brainFlushTimer); brainFlushTimer = 0; }
    while (brainOutbox.length) {
      const batch = brainOutbox.splice(0, 120);
      await chrome.runtime.sendMessage({ type: 'PC_BRAIN_INGEST_BATCH', payload: batch }).catch(() => {});
    }
  }

  function captureProfile(name = 'balanced') {
    const profiles = {
      gentle: { stepDelayMs: 260, settleDelayMs: 520, boundaryDelayMs: 850, fraction: 0.62 },
      balanced: { stepDelayMs: 150, settleDelayMs: 360, boundaryDelayMs: 650, fraction: 0.72 },
      fast: { stepDelayMs: 80, settleDelayMs: 220, boundaryDelayMs: 420, fraction: 0.82 },
      test: { stepDelayMs: 0, settleDelayMs: 0, boundaryDelayMs: 0, fraction: 6 }
    };
    return profiles[name] || profiles.balanced;
  }

  function scrollMetrics(target) {
    const docScroll = target === document.scrollingElement || target === document.documentElement || target === document.body;
    const top = docScroll ? (window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0) : Number(target?.scrollTop || 0);
    const height = docScroll ? Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) : Number(target?.scrollHeight || 0);
    const client = docScroll ? window.innerHeight : Number(target?.clientHeight || 0);
    return { top, height, client, max: Math.max(0, height - client), docScroll };
  }

  function setScrollTop(target, top) {
    const metrics = scrollMetrics(target);
    if (metrics.docScroll) window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
    else target.scrollTo?.({ top: Math.max(0, top), behavior: 'auto' });
  }

  function findConversationScroller() {
    const candidates = [document.scrollingElement];
    const selector = [
      '[data-virtualized-list]', '[role="log"]', 'main',
      'main [class*="overflow-y-auto"]', 'main [class*="overflow-auto"]',
      'main [style*="overflow"]', '[data-testid*="conversation"] [class*="overflow"]'
    ].join(',');
    for (const node of document.querySelectorAll(selector)) candidates.push(node);
    let best = document.scrollingElement;
    let bestScore = -1;
    for (const node of [...new Set(candidates.filter(Boolean))]) {
      const m = scrollMetrics(node);
      if (m.max < 120) continue;
      const style = node === document.scrollingElement ? null : getComputedStyle(node);
      if (node !== document.scrollingElement && !/(auto|scroll|overlay)/i.test(`${style?.overflowY || ''} ${style?.overflow || ''}`)) continue;
      const marker = `${node.getAttribute?.('data-virtualized-list') || ''} ${node.getAttribute?.('role') || ''} ${node.className || ''}`;
      const localTurns = Math.min(80, turnNodes(node).length);
      const score = Math.log2(Math.max(2, m.height)) + localTurns * 2 + (/virtual/i.test(marker) ? 180 : 0) + (/log/i.test(marker) ? 80 : 0) + (node.closest?.('main') || node.matches?.('main') ? 25 : 0);
      if (score > bestScore) { best = node; bestScore = score; }
    }
    return best || document.scrollingElement;
  }

  async function emitManualRunnerProgress(options = {}, payload = {}) {
    if (!options.jobId) return;
    await chrome.runtime.sendMessage({ type: 'PC_FULL_CAPTURE_RUNNER_PROGRESS', jobId: options.jobId, ...payload }).catch(() => {});
  }

  function authStatus() {
    const visible = (node) => {
      if (!node) return false;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
    };
    const controls = [...document.querySelectorAll('a,button,[role="button"]')].filter(visible).slice(0, 500);
    const controlText = controls.map((node) => brain.normalizeText(`${node.textContent || ''} ${node.getAttribute('aria-label') || ''}`, 180)).join(' | ');
    const loginSignal = /\b(log in|login|sign in|sign up|continue with google|continue with microsoft|continue with apple)\b/i.test(controlText);
    const composer = [...document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"],[data-testid*="composer"],[class*="composer"]')].find(visible);
    const chatRoute = providers.isLikelyChatUrl(location.href, provider.id);
    const chatLinks = collectChatLinks(document).length;
    const connectedSignal = Boolean(composer || chatRoute || chatLinks > 0);
    const state = connectedSignal && provider.guestOnly ? 'guest' : connectedSignal && loginSignal ? (provider.guestAccess ? 'guest' : 'login-required') : connectedSignal ? 'connected' : loginSignal ? 'login-required' : 'unknown';
    return { ok: true, state, providerId: provider.id, name: provider.name, url: location.href, title: document.title || provider.name, chatLinks, composer: Boolean(composer), loginSignal, checkedAt: Date.now() };
  }

  function startManualAsyncRunner(kind, jobId, options = {}) {
    if (!jobId) return { ok: false, accepted: false, error: 'Capture job ID is required.' };
    if (manualAsyncRunner) return { ok: false, accepted: false, error: `Another ${manualAsyncRunner.kind} capture runner is active.` };
    manualCaptureCommand = 'run';
    const runner = { kind, jobId, startedAt: Date.now() };
    manualAsyncRunner = runner;
    const task = kind === 'discover' ? manualDiscoverChats({ ...options, jobId }) : manualFullCapture({ ...options, jobId });
    Promise.resolve(task).then(async (result) => {
      await chrome.runtime.sendMessage({ type: 'PC_FULL_CAPTURE_RUNNER_DONE', jobId, result }).catch(() => {});
    }).catch(async (error) => {
      await chrome.runtime.sendMessage({ type: 'PC_FULL_CAPTURE_RUNNER_ERROR', jobId, error: String(error?.message || error) }).catch(() => {});
    }).finally(() => { if (manualAsyncRunner?.jobId === jobId) manualAsyncRunner = null; });
    return { ok: true, accepted: true, jobId, kind };
  }

  function collectChatLinks(scope = document) {
    const found = new Map();
    for (const anchor of nodesWithin(scope, 'a[href]')) {
      const url = providers.canonicalChatUrl(anchor.href || '', provider.id);
      if (!providers.isLikelyChatUrl(url, provider.id)) continue;
      const id = providers.chatIdFromUrl(url, provider.id);
      if (!id) continue;
      const project = projectHintFromAnchor(anchor);
      found.set(url, {
        id, url, providerId: provider.id, providerName: provider.name,
        title: brain.normalizeText(anchor.innerText || anchor.textContent || 'Untitled chat', 300),
        projectId: project.id, projectName: project.name, source: 'manual-full-discovery',
        lastSeenAt: Date.now(), updatedAt: Date.now()
      });
    }
    return [...found.values()];
  }

  function sidebarScrollers() {
    const roots = [...document.querySelectorAll('aside,nav,[data-testid*="sidebar"],[class*="sidebar"]')];
    const out = [];
    for (const rootNode of roots) {
      const candidates = [rootNode, ...rootNode.querySelectorAll('[class*="overflow"],[style*="overflow"],[data-virtualized-list]')];
      for (const node of candidates) {
        const m = scrollMetrics(node);
        if (m.max < 80) continue;
        const style = getComputedStyle(node);
        if (!/(auto|scroll|overlay)/i.test(`${style.overflowY} ${style.overflow}`)) continue;
        out.push(node);
      }
    }
    return [...new Set(out)].sort((a, b) => scrollMetrics(b).max - scrollMetrics(a).max).slice(0, 5);
  }

  function safeMoreButtons() {
    const roots = [...document.querySelectorAll('aside,nav,[data-testid*="sidebar"],[class*="sidebar"]')];
    const buttons = [];
    for (const rootNode of roots) {
      for (const button of rootNode.querySelectorAll('button,[role="button"]')) {
        const text = brain.normalizeText(`${button.textContent || ''} ${button.getAttribute('aria-label') || ''}`, 200);
        if (/^(load more|show more|more chats|older chats|load older|show older)$/i.test(text)) buttons.push(button);
      }
    }
    return [...new Set(buttons)].slice(0, 8);
  }

  async function manualDiscoverChats(options = {}) {
    manualCaptureCommand = 'run';
    const profile = captureProfile(options.speed);
    const found = new Map();
    const harvest = () => {
      scanChats(document);
      for (const chat of collectChatLinks(document)) found.set(chat.url, chat);
    };
    harvest();
    let scrollers = sidebarScrollers();
    for (const scroller of scrollers) {
      setScrollTop(scroller, 0);
      await sleep(profile.settleDelayMs);
      let stable = 0;
      let lastMax = -1;
      let steps = 0;
      while (manualCaptureCommand === 'run' && stable < 4 && steps < 2400) {
        harvest();
        const m = scrollMetrics(scroller);
        if (m.max <= 2) break;
        const next = Math.min(m.max, m.top + Math.max(260, m.client * 0.78));
        setScrollTop(scroller, next);
        await sleep(profile.stepDelayMs);
        const after = scrollMetrics(scroller);
        const atEnd = after.top >= after.max - 3;
        if (atEnd && Math.abs(after.max - lastMax) < 3) stable += 1; else stable = 0;
        lastMax = after.max;
        if (atEnd) {
          for (const button of safeMoreButtons()) {
            if (button.disabled || button.getAttribute('aria-disabled') === 'true') continue;
            button.click();
            await sleep(profile.boundaryDelayMs);
          }
        }
        steps += 1;
        if (steps % 20 === 0) await emitManualRunnerProgress(options, { phase: 'discover', steps, discovered: found.size, title: document.title || provider.name });
      }
      harvest();
      setScrollTop(scroller, 0);
    }
    await drainBrainOutbox();
    await emitManualRunnerProgress(options, { phase: 'discover', steps: 0, discovered: found.size, title: document.title || provider.name });
    return { ok: manualCaptureCommand !== 'stop', paused: manualCaptureCommand === 'pause', stopped: manualCaptureCommand === 'stop', chats: [...found.values()], discovered: found.size };
  }

  async function settleManualScroll(scroller, profile, boundary = false) {
    await sleep(boundary ? profile.boundaryDelayMs : profile.stepDelayMs);
    scanTurns(document); scanFiles(document); scanChats(document);
    detectStatus();
  }

  async function manualFullCapture(options = {}) {
    manualCaptureCommand = 'run';
    const profile = captureProfile(options.speed);
    const scroller = findConversationScroller();
    const startTurns = seenTurnHashes.size;
    const startFiles = seenFileHashes.size;
    const original = scrollMetrics(scroller).top;
    let steps = 0;
    let reachedTop = false;
    let reachedBottom = false;
    let boundaryStable = 0;
    const maxSteps = Math.max(800, Math.min(Number(options.maxSteps || 6000), 15000));

    scanChats(document); scanTurns(document); scanFiles(document); detectStatus();
    setScrollTop(scroller, scrollMetrics(scroller).max);
    await settleManualScroll(scroller, profile, true);
    reachedBottom = scrollMetrics(scroller).top >= scrollMetrics(scroller).max - 3;

    while (manualCaptureCommand === 'run' && steps < maxSteps) {
      const m = scrollMetrics(scroller);
      if (m.top <= 2) {
        reachedTop = true;
        const beforeHeight = m.height;
        await settleManualScroll(scroller, profile, true);
        const after = scrollMetrics(scroller);
        if (after.top <= 2 && Math.abs(after.height - beforeHeight) < 4) boundaryStable += 1; else boundaryStable = 0;
        if (boundaryStable >= 3) break;
        setScrollTop(scroller, 0);
      } else {
        const delta = Math.max(300, m.client * profile.fraction);
        setScrollTop(scroller, Math.max(0, m.top - delta));
        await settleManualScroll(scroller, profile, false);
      }
      steps += 1;
      if (steps % 20 === 0) await emitManualRunnerProgress(options, { phase: 'capture', steps, turns: seenTurnHashes.size, files: seenFileHashes.size, reachedTop, reachedBottom, title: document.title || provider.name });
    }

    if (manualCaptureCommand === 'run' && reachedTop) {
      boundaryStable = 0;
      setScrollTop(scroller, 0);
      await settleManualScroll(scroller, profile, true);
      while (manualCaptureCommand === 'run' && steps < maxSteps) {
        const m = scrollMetrics(scroller);
        if (m.top >= m.max - 3) {
          reachedBottom = true;
          const beforeHeight = m.height;
          await settleManualScroll(scroller, profile, true);
          const after = scrollMetrics(scroller);
          if (after.top >= after.max - 3 && Math.abs(after.height - beforeHeight) < 4) boundaryStable += 1; else boundaryStable = 0;
          if (boundaryStable >= 2) break;
          setScrollTop(scroller, after.max);
        } else {
          const delta = Math.max(300, m.client * profile.fraction);
          setScrollTop(scroller, Math.min(m.max, m.top + delta));
          await settleManualScroll(scroller, profile, false);
        }
        steps += 1;
        if (steps % 20 === 0) await emitManualRunnerProgress(options, { phase: 'capture', steps, turns: seenTurnHashes.size, files: seenFileHashes.size, reachedTop, reachedBottom, title: document.title || provider.name });
      }
    }

    scanChats(document); scanTurns(document); scanFiles(document); detectStatus();
    await drainBrainOutbox();
    if (manualCaptureCommand === 'run') setScrollTop(scroller, Math.min(original, scrollMetrics(scroller).max));
    const complete = manualCaptureCommand === 'run' && reachedTop && reachedBottom && steps < maxSteps;
    const chatId = currentChatId();
    sendBrain('CHAT_UPSERT', {
      id: chatId, providerId: provider.id, providerName: provider.name, title: document.title || 'Untitled chat', url: location.href,
      source: 'manual-full-capture', coverage: complete ? 'full-dom-walk' : 'partial-dom-walk', status: lastStatus,
      lastSeenAt: Date.now(), lastActivityAt: lastSemanticActivityAt, updatedAt: Date.now()
    });
    await drainBrainOutbox();
    await emitManualRunnerProgress(options, { phase: 'capture', steps, turns: seenTurnHashes.size, files: seenFileHashes.size, reachedTop, reachedBottom, title: document.title || provider.name });
    return {
      ok: manualCaptureCommand !== 'stop', complete, paused: manualCaptureCommand === 'pause', stopped: manualCaptureCommand === 'stop',
      chatId, turns: Math.max(0, seenTurnHashes.size - startTurns), totalTurnsObserved: seenTurnHashes.size,
      files: Math.max(0, seenFileHashes.size - startFiles), totalFilesObserved: seenFileHashes.size,
      steps, reachedTop, reachedBottom, url: location.href
    };
  }

  function publicStatus() {
    return {
      provider: { id: provider.id, name: provider.name }, settings: { ...settings }, metrics: { ...metrics }, pressure: pressure.tick(), chat: { id: currentChatId(), status: lastStatus, lastActivityAt: lastSemanticActivityAt, health: liveHealthSnapshot ? { ...liveHealthSnapshot } : null },
      capabilities: { longTaskObserver: Boolean(PerformanceObserver?.supportedEntryTypes?.includes('longtask')), navigationApi: Boolean(globalThis.navigation?.addEventListener), constellationCapture: true, zeroTabCatalog: true, manualFullCapture: true, liveHealthHud: true, passiveNetworkHealth: true, conversationCapacityGuard: true, safeHandoff: true }
    };
  }

  function scheduleStatusPulse(delay) {
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      statusTimer = 0;
      detectStatus();
      scheduleStatusPulse(document.hidden ? 30000 : 8000);
    }, delay ?? (document.hidden ? 30000 : 8000));
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes[STORAGE_KEY]) configure(changes[STORAGE_KEY].newValue);
    if (changes[BRAIN_SETTINGS_KEY]) {
      approvalSettings = { ...approvalSettings, ...(changes[BRAIN_SETTINGS_KEY].newValue?.approvalAutopilot || {}) };
      liveHealthSettings = health.normalizeSettings({ ...liveHealthSettings, ...(changes[BRAIN_SETTINGS_KEY].newValue?.liveHealth || {}) });
      if (liveHealthHost) { liveHealthHost.dataset.corner = liveHealthSettings.corner; liveHealthHost.dataset.density = liveHealthSettings.density; liveHealthHost.dataset.visible = liveHealthSettings.enabled ? '1' : '0'; }
      scheduleLiveHealthPulse(100);
      if (approvalSettings.enabled && approvalSettings.acknowledged && provider.id === 'chatgpt') queueMicrotask(() => detectStatus());
    }
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'PC_GET_STATUS') { sendResponse(publicStatus()); return false; }
    if (message?.type === 'PC_RESET_METRICS') {
      Object.assign(metrics, { sessionStartedAt: Date.now(), totalLongTasks: 0, totalLongTaskMs: 0, maxLongTaskMs: 0, pressureTransitions: 0, lastPressure: 'normal', lastUpdatedAt: Date.now() });
      pressure.reset(); applyPressure(pressure.snapshot()); sendResponse(publicStatus()); return false;
    }
    if (message?.type === 'PC_RESCAN') { scheduleCapture(document); sendResponse({ ok: true }); return false; }
    if (message?.type === 'PC_AUTH_STATUS') { sendResponse(authStatus()); return false; }
    if (message?.type === 'PC_MANUAL_DISCOVER_CHATS_ASYNC') { sendResponse(startManualAsyncRunner('discover', message.jobId, message.options || {})); return false; }
    if (message?.type === 'PC_MANUAL_FULL_CAPTURE_ASYNC') { sendResponse(startManualAsyncRunner('capture', message.jobId, message.options || {})); return false; }
    if (message?.type === 'PC_MANUAL_DISCOVER_CHATS') { manualDiscoverChats(message.options || {}).then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) })); return true; }
    if (message?.type === 'PC_MANUAL_FULL_CAPTURE') { manualFullCapture(message.options || {}).then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) })); return true; }
    if (message?.type === 'PC_MANUAL_CAPTURE_CONTROL') { manualCaptureCommand = message.action === 'pause' ? 'pause' : message.action === 'stop' ? 'stop' : 'run'; sendResponse({ ok: true, command: manualCaptureCommand }); return false; }
    if (message?.type === 'PC_GET_PROVIDER') { sendResponse({ ok: true, provider }); return false; }
    if (message?.type === 'PC_APPROVAL_RECOVERY_SCAN') { runApprovalRecoveryScan(message.options || {}).then(sendResponse).catch((error) => sendResponse({ ok: false, action: 'failed', error: String(error?.message || error) })); return true; }
    return false;
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopPerformanceObserver(); captureObserver?.disconnect(); cancelCapture(); }
    else { if (settings.enabled) startPerformanceObserver(); applyPressure(pressure.tick()); setupCaptureObserver(); }
    scheduleStatusPulse(document.hidden ? 30000 : 1500);
    scheduleLiveHealthPulse(document.hidden ? 30000 : 900);
  }, { passive: true });

  setupNavigationTracking();
  setupCaptureObserver();
  loadSettings();
  sendBrain('PROVIDER_SEEN', { id: provider.id, name: provider.name, home: provider.home, host: location.hostname, updatedAt: Date.now() });
  sendBrain('ROUTE_EVENT', { providerId: provider.id, chatId: currentChatId(), url: location.href, title: document.title, updatedAt: Date.now() });
  scheduleStatusPulse(1800);
  scheduleLiveHealthPulse(2200);

  window.addEventListener('pagehide', () => {
    stopPerformanceObserver(); captureObserver?.disconnect(); navCleanup?.();
    if (recoveryTimer) clearTimeout(recoveryTimer); if (statusTimer) clearTimeout(statusTimer); if (liveHealthTimer) clearTimeout(liveHealthTimer);
    cancelCapture(); cancelPendingPersist(); flushBrainOutbox();
    chrome.storage.local.set({ [METRICS_KEY]: { ...metrics } }).catch(() => {});
  }, { once: true });
})();
