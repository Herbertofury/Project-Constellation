(() => {
  'use strict';
  if (globalThis.__PROJECT_CONSTELLATION_ACTIVE__) return;
  globalThis.__PROJECT_CONSTELLATION_ACTIVE__ = true;

  const perf = globalThis.ProjectConstellationPerformance;
  const brain = globalThis.ProjectConstellationBrainCore;
  const providers = globalThis.ProjectConstellationProviders;
  if (!perf || !brain || !providers) return;

  const provider = providers.detectProvider(location.href);
  if (!provider) return;

  const STORAGE_KEY = 'projectConstellationPerformanceSettings';
  const METRICS_KEY = 'projectConstellationPerformanceMetrics';
  const settings = { ...perf.DEFAULTS };
  const pressure = new perf.PressureWindow(settings);
  const metrics = {
    sessionStartedAt: Date.now(), totalLongTasks: 0, totalLongTaskMs: 0, maxLongTaskMs: 0,
    pressureTransitions: 0, lastPressure: 'normal', route: location.pathname,
    providerId: provider.id, lastUpdatedAt: Date.now()
  };

  const root = document.documentElement;
  const seenTurnHashes = new Map();
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
  let navCleanup = null;
  let lastSemanticActivityAt = Date.now();
  let lastStatus = 'idle';

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
  const currentChatId = () => providers.chatIdFromUrl(location.href, provider.id) || `${provider.id}:home`;
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
    const id = providers.chatIdFromUrl(href, provider.id);
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
    const direct = node.getAttribute?.('data-message-author-role') || node.getAttribute?.('data-author');
    if (direct) return direct;
    const nested = node.querySelector?.('[data-message-author-role],[data-author]');
    const nestedRole = nested?.getAttribute('data-message-author-role') || nested?.getAttribute('data-author');
    if (nestedRole) return nestedRole;
    const label = `${node.getAttribute?.('data-testid') || ''} ${node.getAttribute?.('aria-label') || ''}`;
    if (/user|human|prompt/i.test(label)) return 'user';
    if (/assistant|ai|bot|response/i.test(label)) return 'assistant';
    return 'unknown';
  }

  function turnNodes(scope) {
    const selector = [
      '[data-message-id]', '[data-testid^="conversation-turn"]', '[data-testid*="message"]',
      '[data-author]', 'article[data-testid*="conversation"]', 'main article'
    ].join(',');
    return nodesWithin(scope, selector);
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
      const signature = hashText(`${role}|${text}`);
      if (seenTurnHashes.get(id) === signature) return;
      seenTurnHashes.set(id, signature);
      lastSemanticActivityAt = Date.now();
      sendBrain('TURN_UPSERT', { id, providerId: provider.id, chatId, messageId, role, ordinal, text, source: 'mounted-dom', url: location.href, updatedAt: Date.now() });
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

  function detectStatus() {
    const statusText = boundedStatusText();
    const lower = statusText.toLowerCase();
    const signals = {
      text: statusText,
      running: /stop generating|stop response|cancel generation|generating|thinking|reasoning/.test(lower) || Boolean(document.querySelector('[data-is-streaming="true"],[aria-busy="true"]')),
      paused: /continue generating|resume generation|resume response/.test(lower),
      approval: /(allow|approve|permission|confirm).{0,100}(drive|connector|access|tool|continue)/.test(lower),
      error: /something went wrong|there was an error|retry|try again|network error|failed to (generate|respond|send)/.test(lower),
      authRequired: /sign in|log in|login required|session expired/.test(lower),
      unavailable: /conversation.{0,30}(not found|unavailable|deleted)|page not found/.test(lower)
    };
    if (signals.running) lastSemanticActivityAt = Date.now();
    const next = brain.classifyChatStatus(signals);
    if (next !== lastStatus) {
      lastStatus = next;
      lastSemanticActivityAt = Date.now();
      sendBrain('STATUS_EVENT', { providerId: provider.id, chatId: currentChatId(), status: next, detail: statusText.slice(0, 1200), url: location.href, updatedAt: Date.now() });
    } else if (next === 'running') {
      sendBrain('STATUS_HEARTBEAT', { providerId: provider.id, chatId: currentChatId(), status: next, lastActivityAt: lastSemanticActivityAt, url: location.href, updatedAt: Date.now() });
    }
  }

  function processCaptureQueue() {
    captureHandle = 0; captureHandleKind = '';
    if (document.hidden) return;
    const roots = pendingRoots.size ? [...pendingRoots] : [document];
    pendingRoots.clear();
    for (const scope of roots.slice(0, 120)) {
      scanChats(scope); scanTurns(scope); scanFiles(scope);
    }
    detectStatus();
  }

  function scheduleCapture(scope) {
    if (scope) pendingRoots.add(scope);
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
        if (mutation.type === 'attributes') scheduleCapture(mutation.target);
        for (const node of mutation.addedNodes) if (node instanceof Element) scheduleCapture(node);
      }
    });
    captureObserver.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['href','data-message-id','data-testid','aria-label','aria-busy','data-is-streaming'] });
    scheduleCapture(document);
  }

  function updateRoute() {
    if (metrics.route === location.pathname + location.search) return;
    metrics.route = location.pathname + location.search;
    metrics.lastUpdatedAt = Date.now();
    lastSemanticActivityAt = Date.now();
    seenTurnHashes.clear(); seenFileHashes.clear();
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
    try { const stored = await chrome.storage.local.get(STORAGE_KEY); configure(stored?.[STORAGE_KEY]); }
    catch (_) { configure(); }
  }

  let manualCaptureCommand = 'run';

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
      }
      harvest();
      setScrollTop(scroller, 0);
    }
    await drainBrainOutbox();
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
    return {
      ok: manualCaptureCommand !== 'stop', complete, paused: manualCaptureCommand === 'pause', stopped: manualCaptureCommand === 'stop',
      chatId, turns: Math.max(0, seenTurnHashes.size - startTurns), totalTurnsObserved: seenTurnHashes.size,
      files: Math.max(0, seenFileHashes.size - startFiles), totalFilesObserved: seenFileHashes.size,
      steps, reachedTop, reachedBottom, url: location.href
    };
  }

  function publicStatus() {
    return {
      provider: { id: provider.id, name: provider.name }, settings: { ...settings }, metrics: { ...metrics }, pressure: pressure.tick(), chat: { id: currentChatId(), status: lastStatus, lastActivityAt: lastSemanticActivityAt },
      capabilities: { longTaskObserver: Boolean(PerformanceObserver?.supportedEntryTypes?.includes('longtask')), navigationApi: Boolean(globalThis.navigation?.addEventListener), constellationCapture: true, zeroTabCatalog: true, manualFullCapture: true }
    };
  }

  function scheduleStatusPulse(delay) {
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      statusTimer = 0;
      detectStatus();
      scheduleStatusPulse(document.hidden ? 15000 : 5000);
    }, delay ?? (document.hidden ? 15000 : 5000));
  }

  chrome.storage.onChanged.addListener((changes, areaName) => { if (areaName === 'local' && changes[STORAGE_KEY]) configure(changes[STORAGE_KEY].newValue); });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'PC_GET_STATUS') { sendResponse(publicStatus()); return false; }
    if (message?.type === 'PC_RESET_METRICS') {
      Object.assign(metrics, { sessionStartedAt: Date.now(), totalLongTasks: 0, totalLongTaskMs: 0, maxLongTaskMs: 0, pressureTransitions: 0, lastPressure: 'normal', lastUpdatedAt: Date.now() });
      pressure.reset(); applyPressure(pressure.snapshot()); sendResponse(publicStatus()); return false;
    }
    if (message?.type === 'PC_RESCAN') { scheduleCapture(document); sendResponse({ ok: true }); return false; }
    if (message?.type === 'PC_MANUAL_DISCOVER_CHATS') { manualDiscoverChats(message.options || {}).then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) })); return true; }
    if (message?.type === 'PC_MANUAL_FULL_CAPTURE') { manualFullCapture(message.options || {}).then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) })); return true; }
    if (message?.type === 'PC_MANUAL_CAPTURE_CONTROL') { manualCaptureCommand = message.action === 'pause' ? 'pause' : message.action === 'stop' ? 'stop' : 'run'; sendResponse({ ok: true, command: manualCaptureCommand }); return false; }
    if (message?.type === 'PC_GET_PROVIDER') { sendResponse({ ok: true, provider }); return false; }
    return false;
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopPerformanceObserver(); captureObserver?.disconnect(); cancelCapture(); }
    else { if (settings.enabled) startPerformanceObserver(); applyPressure(pressure.tick()); setupCaptureObserver(); }
    scheduleStatusPulse(document.hidden ? 15000 : 1500);
  }, { passive: true });

  setupNavigationTracking();
  setupCaptureObserver();
  loadSettings();
  sendBrain('PROVIDER_SEEN', { id: provider.id, name: provider.name, home: provider.home, host: location.hostname, updatedAt: Date.now() });
  sendBrain('ROUTE_EVENT', { providerId: provider.id, chatId: currentChatId(), url: location.href, title: document.title, updatedAt: Date.now() });
  scheduleStatusPulse(1800);

  window.addEventListener('pagehide', () => {
    stopPerformanceObserver(); captureObserver?.disconnect(); navCleanup?.();
    if (recoveryTimer) clearTimeout(recoveryTimer); if (statusTimer) clearTimeout(statusTimer);
    cancelCapture(); cancelPendingPersist(); flushBrainOutbox();
    chrome.storage.local.set({ [METRICS_KEY]: { ...metrics } }).catch(() => {});
  }, { once: true });
})();
