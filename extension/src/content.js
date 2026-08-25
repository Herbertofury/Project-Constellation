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
  const PULSE_UX_KEY = 'projectConstellationPulseUxSettings';
  const settings = { ...perf.DEFAULTS };
  let approvalSettings = { enabled: false, acknowledged: false, alwaysAllow: true, fallbackAllowOnce: true, autoRecoverPaused: true };
  let liveHealthSettings = { ...health.DEFAULTS };
  let pulseUxSettings = { branchReviewBeforeSend: true };
  let approvalAutopilotBusy = false;
  let approvalAutopilotLastAt = 0;
  let approvalAutopilotTimer = 0;
  let approvalAutopilotRetryCount = 0;
  let approvalAutopilotPromptKey = '';
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
  const embeddedMediaQueued = new Set();
  const seenChats = new Map();
  const pendingRoots = new Set();
  let performanceObserver = null;
  let captureObserver = null;
  let approvalObserver = null;
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
  const liveActivityLedger = [];
  const LIVE_ACTIVITY_LIMIT = 48;
  let lastToolEvidence = null;
  let lastToolScanAt = 0;
  let toolEvidenceDirty = true;
  let handoffClipboardArea = null;
  let branchResumeBusy = false;
  let outputCompareBusy = false;
  let outputVaultBusy = false;
  let outputCompareHost = null;
  let outputCompareSummary = null;
  let outputVaultReport = null;
  let outputVaultItems = [];
  let outputVaultEscapeHandler = null;
  let outputVaultDockObserver = null;
  let outputVaultResizeHandler = null;
  let outputVaultDockFrame = 0;
  let outputVaultViewMode = 'reader';
  let lastOutputObservationFingerprint = '';
  let lastOutputObservationAt = 0;
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
    chrome.runtime.sendMessage({ type: 'PC_BRAIN_INGEST_BATCH', payload: batch.map(({ type, data }) => ({ type, data })) }).catch(() => {});
    if (brainOutbox.length) brainFlushTimer = setTimeout(flushBrainOutbox, 80);
  }
  function sendBrain(type, data) {
    const coalesceKey = /_UPSERT$/.test(String(type || '')) && data?.id ? `${type}:${data.id}` : type === 'STATUS_HEARTBEAT' && data?.chatId ? `${type}:${data.chatId}` : '';
    if (coalesceKey) {
      const index = brainOutbox.findIndex((row) => row.coalesceKey === coalesceKey);
      if (index >= 0) { brainOutbox[index] = { type, data, coalesceKey }; return; }
    }
    brainOutbox.push({ type, data, coalesceKey });
    if (brainOutbox.length >= 100) { flushBrainOutbox(); return; }
    if (!brainFlushTimer) brainFlushTimer = setTimeout(flushBrainOutbox, 120);
  }
  function noteLiveActivity(kind, label, detail = '', key = '', at = Date.now()) {
    const safeKind = String(kind || 'page').replace(/[^a-z0-9-]/gi, '').slice(0, 24) || 'page';
    const safeLabel = brain.normalizeText(label || '', 180);
    const safeDetail = brain.normalizeText(detail || '', 220);
    if (!safeLabel) return;
    const eventKey = String(key || `${safeKind}:${hashText(`${safeLabel}|${safeDetail}`)}`).slice(0, 180);
    const signature = hashText(`${safeLabel}|${safeDetail}`);
    const existing = liveActivityLedger.find((row) => row.key === eventKey);
    if (existing) {
      if (existing.signature === signature && Number(at || 0) - Number(existing.at || 0) < 900) return;
      existing.label = safeLabel; existing.detail = safeDetail; existing.at = Number(at || Date.now()); existing.signature = signature;
      liveActivityLedger.sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
      return;
    }
    liveActivityLedger.unshift({ kind:safeKind, label:safeLabel, detail:safeDetail, key:eventKey, at:Number(at || Date.now()), signature });
    if (liveActivityLedger.length > LIVE_ACTIVITY_LIMIT) liveActivityLedger.length = LIVE_ACTIVITY_LIMIT;
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
    const changed = metrics.lastPressure !== next;
    if (changed) { metrics.pressureTransitions += 1; metrics.lastPressure = next; }
    root.dataset.projectConstellationPressure = next;
    if (changed) {
      metrics.lastUpdatedAt = Date.now();
      schedulePersist();
      if (next === 'normal') scheduleCapture(document.querySelector('main') || document);
    }
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
    metrics.lastUpdatedAt = Date.now();
    schedulePersist();
    scheduleRecoveryCheck();
  }

  function startPerformanceObserver() {
    if (!settings.enabled || performanceObserver) return;
    try {
      if (!PerformanceObserver?.supportedEntryTypes?.includes('longtask')) return;
      performanceObserver = new PerformanceObserver((list) => list.getEntries().forEach(onLongTask));
      performanceObserver.observe({ type: 'longtask', buffered: false });
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
  function turnTextOf(node, max = 120000) {
    return String(node?.innerText || node?.textContent || '').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim().slice(0, max);
  }

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

  function structuredTurnFormattedText(node) {
    const semantic=node?.querySelector?.('.markdown,[class*="markdown" i],[class*="prose" i]');
    if(!semantic)return '';
    let visited=0;
    const inline=(root)=>{
      const parts=[];
      const walk=(child)=>{
        if(visited++>4000)return;
        if(child.nodeType===Node.TEXT_NODE){parts.push(String(child.nodeValue||''));return;}
        if(!(child instanceof Element)||child.matches('button,svg,img,video,audio,canvas,[aria-hidden="true"]'))return;
        const tag=child.tagName.toLowerCase();
        if(tag==='br'){parts.push('\n');return;}
        const value=()=>{const before=parts.length;for(const nested of child.childNodes)walk(nested);return parts.splice(before).join('');};
        if(tag==='a'){
          const label=value().trim();const href=safeVaultUrl(child.href||child.getAttribute('href')||'');parts.push(href?`[${label||href}](${href})`:label);return;
        }
        if(tag==='strong'||tag==='b'){const text=value().trim();parts.push(text?`**${text}**`:'');return;}
        if(tag==='em'||tag==='i'){const text=value().trim();parts.push(text?`_${text}_`:'');return;}
        if(tag==='code'&&!child.closest('pre')){const text=value().replace(/`/g,'\\`');parts.push(text?`\`${text}\``:'');return;}
        for(const nested of child.childNodes)walk(nested);
      };
      for(const child of root.childNodes)walk(child);
      return parts.join('').replace(/[ \t]+\n/g,'\n').trim();
    };
    const blocks=[];
    const emit=(value)=>{const text=String(value||'').trim();if(text)blocks.push(text);};
    const block=(element,depth=0)=>{
      if(visited>4000||depth>18||!(element instanceof Element)||element.matches('button,svg,img,video,audio,canvas,[aria-hidden="true"]'))return;
      const tag=element.tagName.toLowerCase();
      if(/^h[1-6]$/.test(tag)){emit(`${'#'.repeat(Math.min(4,Math.max(2,Number(tag[1]))))} ${inline(element)}`);return;}
      if(tag==='p'){emit(inline(element));return;}
      if(tag==='pre'){const code=String(element.innerText||element.textContent||'').trim();const language=String(element.querySelector('code')?.className||'').match(/(?:language-|lang-)([\w#+.-]+)/i)?.[1]||'';emit(`\`\`\`${language}\n${code}\n\`\`\``);return;}
      if(tag==='blockquote'){emit(inline(element).split('\n').map((row)=>`> ${row}`).join('\n'));return;}
      if(tag==='ul'||tag==='ol'){
        const ordered=tag==='ol';const rows=[...element.children].filter((child)=>child.tagName?.toLowerCase()==='li').map((child,index)=>`${ordered?`${index+1}.`:'-'} ${inline(child)}`);emit(rows.join('\n'));return;
      }
      if(tag==='table'){
        const rows=[...element.querySelectorAll('tr')].slice(0,100).map((row)=>[...row.querySelectorAll(':scope > th,:scope > td')].map((cell)=>inline(cell).replace(/\|/g,'\\|'))).filter((row)=>row.length);
        if(rows.length){const width=Math.max(...rows.map((row)=>row.length));const head=rows[0];emit(`| ${head.join(' | ')} |\n| ${Array.from({length:width},()=> '---').join(' | ')} |${rows.slice(1).map((row)=>`\n| ${row.join(' | ')} |`).join('')}`);}return;
      }
      const blockChildren=[...element.children].filter((child)=>/^(H[1-6]|P|PRE|BLOCKQUOTE|UL|OL|TABLE|DIV|SECTION|ARTICLE)$/.test(child.tagName||''));
      if(blockChildren.length)for(const child of blockChildren)block(child,depth+1);else emit(inline(element));
    };
    for(const child of semantic.children)block(child,0);
    if(!blocks.length)emit(inline(semantic));
    return blocks.join('\n\n').replace(/\n{4,}/g,'\n\n\n').slice(0,120000);
  }

  function structuredTurnAssets(node) {
    const out = [];
    const seen = new Set();
    const media = [...node.querySelectorAll?.('img[src],video[src],audio[src],source[src],image[href],object[data],embed[src]') || []];
    for (const item of media.slice(0, 64)) {
      const parentMedia = item.closest?.('video,audio');
      const kind = item.matches?.('img,image') ? 'image' : item.matches?.('video') || parentMedia?.matches?.('video') ? 'video' : item.matches?.('audio') || parentMedia?.matches?.('audio') ? 'audio' : item.matches?.('object,embed') ? 'document' : 'media';
      const source = String(item.currentSrc || item.src || item.getAttribute?.('href') || item.getAttribute?.('src') || item.getAttribute?.('data') || '').trim();
      const linked = String(item.closest?.('a[href]')?.href || '').trim();
      let url = linked || source;
      let embeddedDataUrl = '';
      if (!linked && /^data:/i.test(source)) {
        const token = hashText(`${source.slice(0,4096)}|${source.slice(-512)}|${source.length}`);
        url = `constellation-embedded:${token}`;
        if (source.length <= 8 * 1024 * 1024) embeddedDataUrl = source;
      }
      if (!url || seen.has(`${kind}:${url}`)) continue;
      const width = Math.max(0, Number(item.naturalWidth || item.videoWidth || item.width || 0));
      const height = Math.max(0, Number(item.naturalHeight || item.videoHeight || item.height || 0));
      const alt = brain.normalizeText(item.getAttribute?.('alt') || item.getAttribute?.('aria-label') || item.getAttribute?.('title') || '', 320);
      const generatedHint = `${url} ${alt} ${item.className || ''}`;
      if (kind === 'image' && width && height && width < 72 && height < 72 && !linked && !/(generated|result|artifact|image|output)/i.test(generatedHint)) continue;
      seen.add(`${kind}:${url}`);
      out.push({ id:hashText(`${kind}|${url}`), kind, url:url.slice(0, 8000), sourceUrl:/^data:/i.test(source) ? '' : source.slice(0, 8000), embeddedDataUrl, alt, width, height });
      if (out.length >= 32) break;
    }
    return out;
  }

  function queueEmbeddedMediaCapture(asset, chatId, turnId, ordinal) {
    const source = String(asset?.sourceUrl || '');
    const embedded = String(asset?.embeddedDataUrl || '');
    const key = `${turnId}:${asset?.id || hashText(asset?.url || source)}`;
    if (embeddedMediaQueued.has(key)) return;
    if (!embedded) return;
    embeddedMediaQueued.add(key);
    const run = async () => {
      try {
        const dataUrl = embedded; const size = embedded.length; const mimeType = embedded.match(/^data:([^;,]+)/i)?.[1] || '';
        if (!dataUrl || dataUrl.length > 12 * 1024 * 1024) return;
        sendBrain('FILE_UPSERT', { id:brain.fileKey(chatId, asset.url, asset.alt || asset.kind), providerId:provider.id, chatId, parentTurnId:turnId, name:asset.alt || `${asset.kind} from turn ${ordinal + 1}`, href:asset.url, kind:asset.kind, width:asset.width, height:asset.height, sourceUrl:source, embeddedDataUrl:dataUrl, embeddedMimeType:mimeType, embeddedSize:size, embedded:true, source:'embedded-output', updatedAt:Date.now() });
      } catch (_) {}
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => run(), { timeout:2200 }); else setTimeout(run, 450);
  }

  function scanTurns(scope = document) {
    const chatId = currentChatId();
    if (!chatId || chatId.endsWith(':home')) return;
    const nodes = turnNodes(scope);
    nodes.forEach((node, localOrdinal) => {
      const text = turnTextOf(node);
      if (!text || text.length < 2) return;
      const role = roleForTurn(node);
      const messageId = node.getAttribute?.('data-message-id') || node.querySelector?.('[data-message-id]')?.getAttribute('data-message-id') || `${role}-${hashText(text.slice(0, 300))}`;
      const ordinalAttr = node.getAttribute?.('data-testid')?.match(/(\d+)/)?.[1];
      const ordinal = ordinalAttr ? Number(ordinalAttr) : localOrdinal;
      const id = brain.turnKey(chatId, messageId, role, ordinal);
      const links = structuredTurnLinks(node);
      const codeBlocks = structuredCodeBlocks(node);
      const assets = structuredTurnAssets(node);
      const signature = brain.turnFingerprint({ role, text, links, codeBlocks, assets });
      if (seenTurnHashes.get(id) === signature) return;
      const formattedText = role === 'assistant' ? structuredTurnFormattedText(node) : '';
      seenTurnHashes.set(id, signature);
      const previousLength = Number(seenTurnLengths.get(id) || 0);
      seenTurnLengths.set(id, text.length);
      seenTurnTextChars = Math.max(0, seenTurnTextChars + text.length - previousLength);
      healthEvidence.lastTurnProgressAt = Date.now();
      healthEvidence.lastDomProgressAt = healthEvidence.lastTurnProgressAt;
      lastSemanticActivityAt = healthEvidence.lastTurnProgressAt;
      noteLiveActivity(role === 'assistant' ? 'response' : 'message', role === 'assistant' ? 'Response content updated' : 'Message captured', `${text.length.toLocaleString()} rendered characters · turn ${ordinal + 1}`, `turn:${id}`, healthEvidence.lastTurnProgressAt);
      sendBrain('TURN_UPSERT', { id, providerId: provider.id, chatId, messageId, role, ordinal, text, formattedText, links, codeBlocks, assets, contentFingerprint:signature, source: 'mounted-dom', url: location.href, updatedAt: Date.now() });
      for (const asset of assets) sendBrain('FILE_UPSERT', {
        id:brain.fileKey(chatId, asset.url, asset.alt || asset.kind), providerId:provider.id, chatId, parentTurnId:id,
        name:asset.alt || `${asset.kind} from turn ${ordinal + 1}`, href:asset.url, kind:asset.kind, width:asset.width, height:asset.height,
        sourceUrl:asset.sourceUrl || '', source:'mounted-output', updatedAt:Date.now()
      });
      for (const asset of assets) queueEmbeddedMediaCapture(asset, chatId, id, ordinal);
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

  const APPROVAL_CONTROL_SELECTOR = 'button,[role="button"],[role="menuitem"],[role="option"],label,input[type="checkbox"]';

  function isMainAllowControl(node) {
    return node instanceof Element && /^allow(?: once)?$/i.test(elementLabel(node, 120)) && isUsableControl(node);
  }

  function isDenyControl(node) {
    return node instanceof Element && /^(?:deny|cancel)$/i.test(elementLabel(node, 120)) && isUsableControl(node);
  }

  function approvalPromptLike(text = '') {
    return /\ballow\s+chatgpt\s+to\s+(?:use|access)\b/i.test(text)
      || /\ballow\b.{0,120}\b(?:github|google drive|onedrive|dropbox|sharepoint|notion|slack|connector|connected app|plugin)\b/i.test(text)
      || /\b(?:github|google drive|onedrive|dropbox|sharepoint|notion|slack|connector|connected app|plugin)\b.{0,180}\b(?:allow|permission|access)\b/i.test(text);
  }

  function approvalCardForAllow(mainAllow) {
    let node = mainAllow?.parentElement || null;
    let structuralFallback = null;
    for (let depth = 0; node && node !== document.body && depth < 11; depth += 1, node = node.parentElement) {
      const controls = [...node.querySelectorAll(APPROVAL_CONTROL_SELECTOR)].filter(isUsableControl);
      if (!controls.includes(mainAllow) || !controls.some(isDenyControl)) continue;
      const text = elementLabel(node, 6000);
      if (!structuralFallback && (node.querySelector('h1,h2,h3,[role="heading"]') || text.length > 40)) structuralFallback = node;
      if (approvalPromptLike(text)) return node;
    }
    return structuralFallback;
  }

  function approvalSurface() {
    const exactAllowButtons = [...document.querySelectorAll('button,[role="button"]')].slice(-240).filter(isMainAllowControl);
    const candidates = [
      ...exactAllowButtons.map(approvalCardForAllow),
      ...[...document.querySelectorAll('[role="dialog"],[role="alertdialog"],[data-state="open"],[data-testid*="dialog" i],[class*="modal" i],[class*="dialog" i]')].slice(-160)
    ];
    let best = null, bestScore = -1;
    for (const node of [...new Set(candidates.filter(Boolean))]) {
      const text = elementLabel(node, 6000);
      const controls = [...node.querySelectorAll(APPROVAL_CONTROL_SELECTOR)].filter(isUsableControl);
      const hasAllow = controls.some(isMainAllowControl);
      const hasDeny = controls.some(isDenyControl);
      const promptLike = approvalPromptLike(text);
      if (!hasAllow || (!hasDeny && !promptLike)) continue;
      let score = (promptLike ? 180 : 0) + (hasDeny ? 120 : 0) + (/for this (chat|conversation)/i.test(text) ? 50 : 0);
      if (node.getAttribute('role')?.includes('dialog')) score += 90;
      score -= Math.max(0, controls.length - 6) * 4;
      score -= Math.min(40, Math.floor(text.length / 1000));
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
    const all = [...document.querySelectorAll(APPROVAL_CONTROL_SELECTOR)].filter(isUsableControl);
    const within = [...surface.querySelectorAll(APPROVAL_CONTROL_SELECTOR)].filter(isUsableControl);
    const persistentPattern = /(?:^|\b)(always allow|never ask|allow all|allow.*(?:this )?(?:conversation|chat))(?:\b|$)/i;
    const persistent = all.find((node) => persistentPattern.test(elementLabel(node, 260)) && !/low[- ]risk/i.test(elementLabel(node, 260))) || null;
    const checkbox = within.find((node) => {
      const label = node.matches?.('label') ? elementLabel(node, 300) : elementLabel(node.closest?.('label') || node.parentElement, 300);
      return /always allow|allow all|never ask|conversation|this chat/i.test(label) && (node.matches?.('input[type="checkbox"]') || node.querySelector?.('input[type="checkbox"]'));
    }) || null;
    const mainAllow = within.find(isMainAllowControl) || null;
    const buttonControls = within.filter((node) => node.matches?.('button,[role="button"]'));
    const mainIndex = buttonControls.indexOf(mainAllow);
    let dropdown = null;
    let dropdownScore = -1;
    for (let index = 0; index < buttonControls.length; index += 1) {
      const node = buttonControls[index];
      if (node === mainAllow || isDenyControl(node) || persistentPattern.test(elementLabel(node, 260))) continue;
      const label = elementLabel(node, 180);
      let score = 0;
      if (/^(?:menu|listbox)$/.test(node.getAttribute('aria-haspopup') || '')) score += 120;
      if (node.hasAttribute('aria-expanded')) score += 80;
      if (/allow|more|option|menu/i.test(label)) score += 60;
      if (node.querySelector('svg')) score += 45;
      if (label.length <= 3) score += 35;
      if (mainAllow && node.parentElement === mainAllow.parentElement) score += 110;
      else if (mainAllow && node.parentElement?.parentElement === mainAllow.parentElement?.parentElement) score += 55;
      if (mainIndex >= 0 && Math.abs(index - mainIndex) === 1) score += 65;
      const a = mainAllow?.getBoundingClientRect?.(); const b = node.getBoundingClientRect?.();
      if (a && b && (a.width || a.height) && (b.width || b.height)) {
        const gap = Math.hypot((a.right + a.left - b.right - b.left) / 2, (a.bottom + a.top - b.bottom - b.top) / 2);
        if (gap < 100) score += 70; else if (gap < 180) score += 30;
      }
      if (score > dropdownScore) { dropdown = node; dropdownScore = score; }
    }
    if (dropdownScore < 60) dropdown = null;
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

  async function confirmApprovalCleared(timeoutMs = 3600) {
    return Boolean(await waitForDom(() => !approvalSurface() ? true : null, timeoutMs));
  }

  async function settlePersistentApproval(strategy) {
    // Some ChatGPT builds make the persistent menu item approve immediately;
    // others first set the preference and leave the current Allow button active.
    // Support both without double-clicking a completed action.
    await wait(120);
    const remaining = approvalSurface();
    if (remaining) {
      const controls = approvalControls(remaining);
      if (controls.mainAllow) { controls.mainAllow.click(); strategy = `${strategy}+allow`; }
    }
    return { strategy, confirmed: await confirmApprovalCleared() };
  }

  async function clickApprovalPersistentOption(surface, options) {
    let controls = approvalControls(surface);
    if (controls.checkbox) {
      const input = controls.checkbox.matches?.('input[type="checkbox"]') ? controls.checkbox : controls.checkbox.querySelector?.('input[type="checkbox"]');
      if (input && !input.checked) controls.checkbox.click();
      await wait(80);
      controls = approvalControls(surface);
      if (controls.mainAllow) {
        controls.mainAllow.click();
        const confirmed = await confirmApprovalCleared();
        return confirmed ? { action: 'always-allow', strategy: 'checkbox+allow' } : { action: 'failed', strategy: 'checkbox+allow-unconfirmed', reason: 'The approval card remained open after clicking Allow.' };
      }
    }
    if (controls.persistent) {
      controls.persistent.click();
      const settled = await settlePersistentApproval('direct-persistent');
      return settled.confirmed ? { action: 'always-allow', strategy: settled.strategy } : { action: 'failed', strategy: `${settled.strategy}-unconfirmed`, reason: 'The approval card remained open after selecting the persistent option.' };
    }
    if (controls.dropdown) {
      controls.dropdown.click();
      const persistent = await waitForDom(() => approvalControls(approvalSurface() || surface).persistent, 3200);
      controls = approvalControls(approvalSurface() || surface);
      if (persistent || controls.persistent) {
        (persistent || controls.persistent).click();
        const settled = await settlePersistentApproval('dropdown-persistent');
        return settled.confirmed ? { action: 'always-allow', strategy: settled.strategy } : { action: 'failed', strategy: `${settled.strategy}-unconfirmed`, reason: 'The approval card remained open after selecting the conversation-wide option.' };
      }
    }
    if (options.fallbackAllowOnce !== false && controls.mainAllow) {
      controls.mainAllow.click();
      const confirmed = await confirmApprovalCleared();
      return confirmed ? { action: 'allow-once', strategy: 'allow-fallback' } : { action: 'failed', strategy: 'allow-fallback-unconfirmed', reason: 'The approval card remained open after clicking Allow.' };
    }
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
          if (options.fallbackAllowOnce !== false && controls.mainAllow) {
            controls.mainAllow.click();
            const confirmed = await confirmApprovalCleared();
            result = confirmed ? { action: 'allow-once', strategy: 'allow' } : { action: 'failed', strategy: 'allow-unconfirmed', reason: 'The approval card remained open after clicking Allow.' };
          }
        }
        if (result.action === 'always-allow' || result.action === 'allow-once') {
          approvalAutopilotLastAt = Date.now();
          await wait(220);
          sendBrain('STATUS_EVENT', { providerId: provider.id, chatId: currentChatId(), status: 'idle', detail: `Approval recovered automatically (${result.action})${connector ? ` · ${connector}` : ''}`, url: location.href, approvalConnector: connector, updatedAt: Date.now() });
          sendBrain('CHAT_UPSERT', { id: currentChatId(), providerId: provider.id, url: location.href, approvalRecoveredAt: Date.now(), approvalRecoveryAction: result.action, approvalConnector: connector, updatedAt: Date.now() });
          await drainBrainOutbox().catch(() => {});
        }
        return { ok: result.action !== 'failed', action: result.action, strategy: result.strategy, connector, prompt: prompt.slice(0, 1200), reason: result.reason || (result.action === 'none' ? 'No persistent or current Allow control was available.' : '') };
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
    scheduleApprovalAutopilotScan(30);
  }

  function approvalMutationHint(mutations = []) {
    const hinted = (node) => {
      if (!(node instanceof Element)) return false;
      if (isMainAllowControl(node) || isDenyControl(node)) return true;
      const text = elementLabel(node, 1800);
      if (/\ballow\b/i.test(text) && /\b(?:deny|chatgpt|github|google drive|for this conversation|for this chat|connector|connected app|plugin)\b/i.test(text)) return true;
      const controls = [...node.querySelectorAll?.('button,[role="button"]') || []].slice(-24);
      return controls.some(isMainAllowControl) && (controls.some(isDenyControl) || approvalPromptLike(text));
    };
    for (const mutation of mutations.slice(0, 80)) {
      if (mutation.type === 'attributes' && hinted(mutation.target)) return true;
      for (const node of [...mutation.addedNodes].slice(0, 32)) if (hinted(node)) return true;
    }
    return false;
  }

  function scheduleApprovalAutopilotScan(delay = 90) {
    if (provider.id !== 'chatgpt' || !approvalSettings.enabled || !approvalSettings.acknowledged) return;
    if (approvalAutopilotTimer) return;
    approvalAutopilotTimer = setTimeout(async () => {
      approvalAutopilotTimer = 0;
      const surface = approvalSurface();
      if (!surface) { approvalAutopilotRetryCount = 0; approvalAutopilotPromptKey = ''; return; }
      const promptKey = hashText(elementLabel(surface, 1800));
      if (promptKey !== approvalAutopilotPromptKey) { approvalAutopilotPromptKey = promptKey; approvalAutopilotRetryCount = 0; }
      if (approvalAutopilotBusy || Date.now() - approvalAutopilotLastAt < 800) { scheduleApprovalAutopilotScan(300); return; }
      const result = await runApprovalRecoveryScan({ alwaysAllow: approvalSettings.alwaysAllow !== false, fallbackAllowOnce: approvalSettings.fallbackAllowOnce !== false, recoverPaused: approvalSettings.autoRecoverPaused !== false }).catch((error) => ({ ok:false, action:'failed', error:String(error?.message || error) }));
      if (result?.action === 'always-allow' || result?.action === 'allow-once') { approvalAutopilotRetryCount = 0; approvalAutopilotPromptKey = ''; return; }
      if (approvalSurface() && approvalAutopilotRetryCount < 6) {
        approvalAutopilotRetryCount += 1;
        scheduleApprovalAutopilotScan(Math.min(2400, 220 * (2 ** approvalAutopilotRetryCount)));
      }
    }, Math.max(20, Number(delay) || 90));
  }

  function setupApprovalObserver() {
    if (provider.id !== 'chatgpt' || approvalObserver) return;
    approvalObserver = new MutationObserver((mutations) => {
      if (!approvalSettings.enabled || !approvalSettings.acknowledged) return;
      if (approvalMutationHint(mutations)) scheduleApprovalAutopilotScan(80);
    });
    approvalObserver.observe(document.documentElement, { subtree:true, childList:true, attributes:true, attributeFilter:['aria-expanded','data-state','aria-disabled','disabled'] });
  }


  function latestMountedTurnEvidence() {
    const nodes = turnNodes(document);
    for (let index = nodes.length - 1; index >= Math.max(0, nodes.length - 16); index -= 1) {
      const node = nodes[index];
       const text = turnTextOf(node, 120000);
      if (!text || text.length < 2) continue;
      const role = roleForTurn(node);
      const messageId = node.getAttribute?.('data-message-id') || node.querySelector?.('[data-message-id]')?.getAttribute('data-message-id') || `${role}-${hashText(text.slice(0, 300))}`;
      const ordinalAttr = node.getAttribute?.('data-testid')?.match(/(\d+)/)?.[1];
      const ordinal = ordinalAttr ? Number(ordinalAttr) : index;
      return { id: brain.turnKey(currentChatId(), messageId, role, ordinal), messageId, role, ordinal, textHash: hashText(text), textLength: text.length, capturedAt: Date.now() };
    }
    return null;
  }

  function mountedOutputObservation() {
    const chatId = currentChatId();
    const nodes = turnNodes(document);
    const turns = [];
    for (let index = Math.max(0, nodes.length - 64); index < nodes.length; index += 1) {
      const node = nodes[index];
      const text = turnTextOf(node, 120000);
      if (!text || text.length < 2) continue;
      const role = roleForTurn(node);
      const messageId = node.getAttribute?.('data-message-id') || node.querySelector?.('[data-message-id]')?.getAttribute('data-message-id') || `${role}-${hashText(text.slice(0, 300))}`;
      const ordinalAttr = node.getAttribute?.('data-testid')?.match(/(\d+)/)?.[1];
      const ordinal = ordinalAttr ? Number(ordinalAttr) : index;
      const links = structuredTurnLinks(node);
      const code = structuredCodeBlocks(node);
      const assets = structuredTurnAssets(node);
      const fingerprint = brain.turnFingerprint({ role, text, links, codeBlocks:code, assets });
      turns.push({
        id:brain.turnKey(chatId, messageId, role, ordinal), messageId, role, ordinal, fingerprint,
        score:brain.turnRichnessScore({ role, text, links, codeBlocks:code, assets }), textLength:text.length,
        excerpt:text.slice(0, 6000), links:links.map(({ href, text:label }) => ({ href, text:label })),
        assets:assets.map(({ kind, url, alt }) => ({ kind, url, alt })), codeBlocks:code.length
      });
    }
    return { turns, fingerprint:brain.outputObservationFingerprint(turns) };
  }

  async function maybeObserveOutputIntegrity(force = false) {
    const now = Date.now();
    if (outputCompareBusy || document.hidden || currentChatId().endsWith(':home') || lastStatus === 'running') return null;
    if (!force && now - lastOutputObservationAt < 10000) return null;
    const hydrated = now - routeStartedAt >= Number(liveHealthSettings.hydrationGraceMs || health.DEFAULTS.hydrationGraceMs);
    const atBottom = isConversationBottom();
    if (!hydrated || !atBottom || document.readyState !== 'complete') return null;
    const observation = mountedOutputObservation();
    if (!observation.turns.length) return null;
    if (!force && observation.fingerprint === lastOutputObservationFingerprint && now - lastOutputObservationAt < 60000) return null;
    outputCompareBusy = true;
    try {
      await drainBrainOutbox().catch(() => {});
      const response = await chrome.runtime.sendMessage({ type:'PC_OUTPUT_OBSERVE', chatId:currentChatId(), providerId:provider.id, url:location.href, hydrated, atBottom, running:false, turns:observation.turns, fingerprint:observation.fingerprint, observedAt:now }).catch(() => null);
      if (!response?.ok) return null;
      lastOutputObservationFingerprint = observation.fingerprint; lastOutputObservationAt = now;
      outputCompareSummary = response.regression || outputCompareSummary;
      if (response.regression?.active) noteLiveActivity('warning', 'Saved output differs from this page', response.regression.detail || 'Open Output Vault to compare and recover it.', 'output:regression', now);
      return response.regression || null;
    } finally { outputCompareBusy = false; }
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

  const TOOL_EVENT_PATTERN = /(?:called tool|calling tool|tool call|used [^|\n]{0,80} skill|search(?:ed|ing)|web search|fet(?:ched|ching)|inspect(?:ed|ing)|read(?:ing)?|brows(?:ed|ing)|run(?:ning)? tool|using [^|\n]{0,100}tool|audit(?:ed|ing)|patch(?:ed|ing)|analyz(?:ed|ing)|updat(?:ed|ing)|upload(?:ed|ing)|download(?:ed|ing)|verif(?:ied|ying)|test(?:ed|ing)|build(?:ing|t)|packag(?:ed|ing)|execut(?:ed|ing)|terminal|creat(?:ed|ing)|compar(?:ed|ing)|review(?:ed|ing)|check(?:ed|ing)|enhanc(?:ed|ing)|persist(?:ed|ing)|port(?:ed|ing)|modif(?:ied|ying)|compil(?:ed|ing)|trigger(?:ed|ing)|open(?:ed|ing)|click(?:ed|ing)|typ(?:ed|ing)|implement(?:ed|ing)|fix(?:ed|ing))/i;
  const GENERIC_TOOL_PATTERN = /^(?:called tool|calling tool|tool call|used [^|\n]{0,80} skill|ran tool|running tool)$/i;

  function toolPhaseFromLabel(label = '') {
    const text = String(label || '').toLowerCase();
    if (/search|brows/.test(text)) return 'searching';
    if (/fetch|download|read/.test(text)) return 'retrieving';
    if (/inspect|audit|analyz|compar|review|check/.test(text)) return 'inspecting';
    if (/upload|drive/.test(text)) return 'publishing';
    if (/github/.test(text)) return 'repository';
    if (/verif|test|smoke/.test(text)) return 'verifying';
    if (/build|packag|compil/.test(text)) return 'building';
    if (/patch|updat|edit|writ|creat|enhanc|persist|port|modif|implement|fix/.test(text)) return 'editing';
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
    const selector = '[data-testid*="tool" i],[aria-label*="tool" i],[data-message-author-role="tool"],.group\\/tool-message,[class*="tool-message" i],[data-state*="loading" i],[data-state*="pending" i],[aria-busy="true"],.loading-shimmer-tertiary,[class*="text-token-text-tertiary"]';
    const nodes = [...rootNode.querySelectorAll(selector)].slice(-320);
    const entries = [];
    for (const node of nodes) {
      const visibleLabel = brain.normalizeText(node.textContent || '', 280);
      const ariaLabel = brain.normalizeText(node.getAttribute?.('aria-label') || '', 260);
      const titleLabel = brain.normalizeText(node.getAttribute?.('title') || '', 260);
      const label = visibleLabel || ariaLabel || titleLabel;
      if (!label || label.length > 240 || !TOOL_EVENT_PATTERN.test(label) || /^worked for\b/i.test(label)) continue;
      const matchingChildren = [...(node.children || [])].filter((child) => {
        const text = brain.normalizeText(child.textContent || child.getAttribute?.('aria-label') || '', 260);
        return text && text.length <= 240 && TOOL_EVENT_PATTERN.test(text);
      });
      if (matchingChildren.length > 1) continue;
      const stateText = `${node.getAttribute?.('data-state') || ''} ${node.getAttribute?.('aria-busy') || ''} ${node.getAttribute?.('aria-expanded') || ''} ${node.className || ''}`.slice(0, 220);
      const busy = node.getAttribute?.('aria-busy') === 'true' || node.classList?.contains('loading-shimmer-tertiary') || /loading|pending|running|streaming|progress/i.test(stateText) || Boolean(node.querySelector?.('[aria-busy="true"],[data-state*="loading" i],[data-state*="pending" i],.loading-shimmer-tertiary,[class*="spinner" i],[class*="loading" i]'));
      entries.push({ label: label.slice(0, 220), stateText, busy, informative: !GENERIC_TOOL_PATTERN.test(label) });
    }
    const seenInformative = new Set();
    const logical = entries.filter((row) => {
      if (!row.informative) return true;
      const key = row.label.toLowerCase();
      if (seenInformative.has(key)) return false;
      seenInformative.add(key); return true;
    });
    const tail = logical.slice(-36);
    const latest = tail.at(-1) || null;
    const informative = [...tail].reverse().find((row) => row.informative && row.busy) || [...tail].reverse().find((row) => row.informative) || latest;
    const latestGeneric = Boolean(latest && GENERIC_TOOL_PATTERN.test(latest.label));
    const label = brain.normalizeText(informative?.label || latest?.label || '', 150);
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
      noteLiveActivity('tool', label || 'Tool activity changed', `${toolPhaseFromLabel(label)} · ${tail.length} observed step${tail.length === 1 ? '' : 's'}`, `tool:${healthEvidence.lastToolHash}`, now);
    } else if (label && label !== healthEvidence.lastToolLabel && active) {
      healthEvidence.lastToolLabel = label;
      healthEvidence.lastToolProgressAt = now;
      healthEvidence.lastDomProgressAt = now;
      lastSemanticActivityAt = Math.max(lastSemanticActivityAt, now);
      noteLiveActivity('tool', label, toolPhaseFromLabel(label), `tool:${hashText(label)}`, now);
    }
    lastToolEvidence = {
      present: Boolean(tail.length),
      active,
      busy,
      label: (label || latest?.label || '').slice(0, 110),
      phase: toolPhaseFromLabel(label || latest?.label),
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
    noteLiveActivity('checkpoint', 'Securing conversation handoff', 'Building a recoverable local checkpoint', 'handoff:current');
    try {
      const result = await chrome.runtime.sendMessage({ type:'PC_PREPARE_CHAT_HANDOFF', chatId:currentChatId(), url:location.href, capacity:liveHealthSnapshot?.capacity || conversationCapacityEvidence({}) });
      if (!result?.ok) throw new Error(result?.error || 'Could not secure the handoff.');
      await copyHandoffText(result.markdown || '');
      const driveLabel = result.drive?.verified ? ' · Drive verified' : result.drive?.attempted ? ' · Drive pending' : ' · local checkpoint';
      button.textContent = `Handoff copied${driveLabel}`;
      button.title = result.checkpointId ? `Checkpoint ${result.checkpointId}` : 'Safe handoff copied';
      noteLiveActivity('checkpoint', 'Safe handoff copied', result.drive?.verified ? 'Checkpoint round-trip verified in Drive' : 'Local recoverable checkpoint created', 'handoff:current');
      setTimeout(() => { if (button.isConnected) { button.textContent = 'Secure handoff'; button.disabled = false; button.dataset.busy = '0'; } }, 4200);
    } catch (error) {
      button.textContent = 'Handoff failed'; button.title = String(error?.message || error);
      noteLiveActivity('error', 'Handoff failed', String(error?.message || error), 'handoff:current');
      setTimeout(() => { if (button.isConnected) { button.textContent = prior || 'Secure handoff'; button.disabled = false; button.dataset.busy = '0'; } }, 3600);
    }
  }

  async function branchConversation(button) {
    if (!button || button.dataset.busy === '1') return;
    const prior = button.textContent; button.dataset.busy = '1'; button.disabled = true; button.textContent = '✦ Preparing branch…';
    noteLiveActivity('checkpoint', 'Preparing a continuation branch', 'Securing context and opening a fresh provider chat', 'branch:current');
    try {
      const result = await chrome.runtime.sendMessage({ type:'PC_BRANCH_CHAT', chatId:currentChatId(), url:location.href, capacity:liveHealthSnapshot?.capacity || conversationCapacityEvidence({}) });
      if (!result?.ok) throw new Error(result?.error || 'Could not open the continuation branch.');
      button.textContent = '✓ New chat opened'; button.title = `Continuation checkpoint ${result.checkpointId || 'ready'}`;
      noteLiveActivity('checkpoint', 'Continuation branch opened', 'The new chat will receive the recoverable continuation brief automatically', 'branch:current');
      setTimeout(() => { if (button.isConnected) { button.textContent = prior || '✦ Branch & continue'; button.disabled = false; button.dataset.busy = '0'; } }, 5200);
    } catch (error) {
      button.textContent = 'Branch failed'; button.title = String(error?.message || error);
      noteLiveActivity('error', 'Continuation branch failed', String(error?.message || error), 'branch:current');
      setTimeout(() => { if (button.isConnected) { button.textContent = prior || '✦ Branch & continue'; button.disabled = false; button.dataset.busy = '0'; } }, 4200);
    }
  }

  function showBranchTransferToast(title, detail, level = 'active') {
    document.getElementById('projectConstellationBranchToast')?.replaceWith();
    const host = document.createElement('div'); host.id = 'projectConstellationBranchToast'; host.style.cssText = 'all:initial;position:fixed;z-index:2147483001;left:50%;bottom:24px;transform:translateX(-50%);pointer-events:none';
    const shadow = host.attachShadow({ mode:'closed' });
    const accent = level === 'error' ? '#ff8f8f' : level === 'ready' ? '#63d6a7' : '#8b7cff';
    const box = document.createElement('div'); box.setAttribute('role','status'); box.setAttribute('aria-live','polite'); box.style.cssText = `min-width:280px;max-width:min(520px,calc(100vw - 32px));box-sizing:border-box;border:1px solid color-mix(in srgb,${accent} 48%,rgba(255,255,255,.16));border-radius:14px;padding:11px 14px;background:linear-gradient(145deg,rgba(17,18,48,.98),rgba(8,11,31,.98));box-shadow:0 18px 60px rgba(0,0,18,.55),0 0 24px color-mix(in srgb,${accent} 18%,transparent);color:#f7f8ff;font:600 12px/1.35 Inter,system-ui,sans-serif`;
    const heading = document.createElement('div'); heading.textContent = title; heading.style.cssText = 'font-weight:750';
    const copy = document.createElement('div'); copy.textContent = detail; copy.style.cssText = 'margin-top:3px;color:#abb4ce;font-size:10px;font-weight:500';
    box.append(heading, copy); shadow.appendChild(box); document.documentElement.appendChild(host); setTimeout(() => host.replaceWith(), 7200);
  }

  function safeVaultUrl(value, previewKind = '') {
    try {
      const raw = String(value || '');
      if (previewKind && new RegExp(`^data:${previewKind}/`, 'i').test(raw)) return raw;
      const url = new URL(raw, location.href);
      const localHttp = url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
      return url.protocol === 'https:' || localHttp || (previewKind && url.protocol === 'blob:') ? url.href : '';
    } catch (_) { return ''; }
  }

  function setPulseCollapsed(collapsed, managed = false) {
    if (!liveHealthHost?.isConnected || !liveHealthShadow) return;
    liveHealthHost.dataset.collapsed = collapsed ? '1' : '0';
    liveHealthHost.dataset.vaultManagedCollapse = managed ? '1' : '0';
    const button = liveHealthShadow.getElementById('pcHealthCollapse');
    if (button) {
      button.textContent = collapsed ? '+' : '−';
      button.setAttribute('aria-label', collapsed ? 'Expand execution pulse' : 'Collapse execution pulse');
    }
  }

  function syncConstellationDock() {
    if (outputVaultDockFrame) cancelAnimationFrame(outputVaultDockFrame);
    outputVaultDockFrame = requestAnimationFrame(() => {
      outputVaultDockFrame = 0;
      const vault = outputCompareHost;
      if (!vault?.isConnected) return;
      const pulseVisible = liveHealthHost?.isConnected && liveHealthHost.dataset.visible !== '0';
      const pulse = pulseVisible ? liveHealthShadow?.querySelector('.hud') : null;
      const rect = pulse?.getBoundingClientRect?.();
      const corner = String(liveHealthHost?.dataset.corner || liveHealthSettings.corner || 'bottom-right');
      const bottomDock = !corner.startsWith('top');
      const rightDock = !corner.endsWith('left');
      const margin = innerWidth <= 620 ? 8 : 18;
      const edge = innerWidth <= 620 ? 8 : 12;
      const gap = 10;
      const pulseReady = rect && rect.width > 40 && rect.height > 20;
      const inlineOffset = pulseReady ? Math.max(edge, rightDock ? innerWidth - rect.right : rect.left) : margin;
      const available = pulseReady
        ? Math.max(180, bottomDock ? rect.top - gap - edge : innerHeight - rect.bottom - gap - edge)
        : Math.max(180, innerHeight - (edge * 2));
      vault.style.setProperty('--pc-vault-left', rightDock ? 'auto' : `${inlineOffset}px`);
      vault.style.setProperty('--pc-vault-right', rightDock ? `${inlineOffset}px` : 'auto');
      vault.style.setProperty('--pc-vault-top', bottomDock ? 'auto' : `${pulseReady ? rect.bottom + gap : margin}px`);
      vault.style.setProperty('--pc-vault-bottom', bottomDock ? `${pulseReady ? innerHeight - rect.top + gap : margin}px` : 'auto');
      vault.style.setProperty('--pc-vault-height', `${Math.min(780, available)}px`);
      vault.style.setProperty('--pc-vault-dock-width', `${Math.max(300, Math.min(420, Number(rect?.width || 370)))}px`);
      vault.style.setProperty('--pc-vault-full-top', bottomDock ? `${edge}px` : `${pulseReady ? rect.bottom + gap : edge}px`);
      vault.style.setProperty('--pc-vault-full-bottom', bottomDock ? `${pulseReady ? innerHeight - rect.top + gap : edge}px` : `${edge}px`);
      vault.dataset.dockCorner = corner;
      vault.dataset.pulseVisible = pulseReady ? '1' : '0';
    });
  }

  function connectOutputVaultDock() {
    outputVaultDockObserver?.disconnect();
    outputVaultDockObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(syncConstellationDock) : null;
    const pulse = liveHealthShadow?.querySelector('.hud');
    if (pulse) outputVaultDockObserver?.observe(pulse);
    outputVaultResizeHandler = syncConstellationDock;
    addEventListener('resize', outputVaultResizeHandler, { passive:true });
    syncConstellationDock();
  }

  function closeOutputVault() {
    outputCompareHost?.replaceWith(); outputCompareHost = null;
    outputVaultDockObserver?.disconnect(); outputVaultDockObserver = null;
    if (outputVaultResizeHandler) removeEventListener('resize', outputVaultResizeHandler);
    outputVaultResizeHandler = null;
    if (outputVaultDockFrame) cancelAnimationFrame(outputVaultDockFrame); outputVaultDockFrame = 0;
    if (liveHealthHost?.dataset.vaultManagedCollapse === '1') setPulseCollapsed(false, false);
    if (outputVaultEscapeHandler) document.removeEventListener('keydown', outputVaultEscapeHandler, true);
    outputVaultEscapeHandler = null;
  }

  function outputVaultCss() {
    return `
      :host{all:initial;position:fixed;z-index:2147483004;left:var(--pc-vault-left,auto);right:var(--pc-vault-right,18px);top:var(--pc-vault-top,auto);bottom:var(--pc-vault-bottom,18px);width:min(820px,calc(100vw - 36px));height:var(--pc-vault-height,min(780px,calc(100vh - 36px)));font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#f7f8ff;pointer-events:none;--violet:#9d7bff;--blue:#54a7ff;--ink:#070a1c;--panel:rgba(11,15,41,.975);--line:rgba(153,171,255,.18);--muted:#9da8c6}
      :host([data-expanded="1"]){left:12px;right:12px;top:var(--pc-vault-full-top,12px);bottom:var(--pc-vault-full-bottom,12px);width:auto;height:auto}:host([data-collapsed="1"]){width:min(var(--pc-vault-dock-width,370px),calc(100vw - 24px));height:auto}
      *{box-sizing:border-box}[hidden]{display:none!important}.vault{pointer-events:auto;height:100%;display:grid;grid-template-rows:auto auto minmax(0,1fr) auto;border:1px solid color-mix(in srgb,var(--violet) 42%,var(--line));border-radius:24px;overflow:hidden;background:radial-gradient(circle at 88% -8%,rgba(68,126,255,.22),transparent 34%),radial-gradient(circle at 8% 0%,rgba(145,76,255,.19),transparent 30%),linear-gradient(155deg,rgba(16,20,56,.985),var(--panel) 58%,rgba(6,9,28,.99));box-shadow:0 30px 100px rgba(0,0,18,.68),0 0 55px rgba(83,78,219,.14);backdrop-filter:blur(24px) saturate(1.18)}
      .head{display:flex;align-items:center;gap:12px;padding:15px 17px 13px;border-bottom:1px solid var(--line)}.mark{display:grid;place-items:center;width:38px;height:38px;border-radius:13px;background:linear-gradient(135deg,#8f63ff,#378fef);box-shadow:0 8px 25px rgba(84,88,229,.34);font:800 18px/1 system-ui}.heading{min-width:0;flex:1}.eyebrow{font-size:9px;letter-spacing:.15em;color:#919cc1;text-transform:uppercase}.title{margin-top:2px;font-size:15px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.status{margin-top:3px;color:#aeb7cf;font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.headTools{display:flex;gap:5px}.icon{appearance:none;width:31px;height:31px;border:1px solid rgba(255,255,255,.1);border-radius:10px;background:rgba(255,255,255,.035);color:#c9d0e2;cursor:pointer;font:700 13px/1 system-ui}.icon:hover{background:rgba(255,255,255,.085);color:white}
      .alert{display:none;margin:11px 16px 0;padding:10px 12px;border:1px solid rgba(255,103,111,.4);border-radius:12px;background:linear-gradient(135deg,rgba(128,25,68,.28),rgba(66,34,120,.18));color:#ffd9df;font-size:10px;line-height:1.45}.alert[data-active="1"]{display:block}.alert strong{display:block;color:#fff;font-size:11px;margin-bottom:2px}
      .workspace{min-height:0;display:grid;grid-template-columns:190px minmax(0,1fr);gap:0}.rail{border-right:1px solid var(--line);padding:13px;background:rgba(5,8,26,.35);overflow:auto}.railTitle{font-size:8px;letter-spacing:.12em;text-transform:uppercase;color:#7f8aac;margin-bottom:8px}.stats{display:grid;gap:7px}.stat{padding:9px 10px;border:1px solid rgba(255,255,255,.075);border-radius:11px;background:rgba(255,255,255,.025)}.stat span{display:block;font-size:7.5px;color:#7f8aa7;text-transform:uppercase;letter-spacing:.08em}.stat strong{display:block;margin-top:4px;font-size:13px;color:#eef1ff}.filter{display:flex;gap:7px;align-items:center;margin-top:13px;font-size:9px;color:#b2bad0}.filter input{accent-color:#8e72f5}.railNote{font-size:8px;line-height:1.45;color:#727d9c;margin-top:13px}
      .main{min-width:0;min-height:0;display:flex;flex-direction:column}.toolbar{display:flex;align-items:center;gap:8px;padding:11px 12px;border-bottom:1px solid rgba(255,255,255,.07)}.search{min-width:120px;flex:1;border:1px solid rgba(154,171,255,.18);border-radius:10px;background:rgba(2,5,21,.48);color:#f4f6ff;padding:8px 10px;font:500 10px/1.2 system-ui;outline:none}.search:focus{border-color:rgba(137,115,255,.72);box-shadow:0 0 0 3px rgba(120,93,255,.12)}.viewSwitch{display:flex;padding:2px;border:1px solid rgba(151,165,255,.14);border-radius:10px;background:rgba(2,5,20,.38)}.viewBtn{appearance:none;border:0;border-radius:7px;background:transparent;color:#8994b1;padding:6px 8px;font:700 8px/1 system-ui;cursor:pointer}.viewBtn[aria-pressed="true"]{color:#fff;background:linear-gradient(135deg,rgba(126,84,239,.8),rgba(49,125,222,.72));box-shadow:0 4px 14px rgba(69,77,203,.2)}.count{align-self:center;color:#7f8aa7;font-size:8px;white-space:nowrap}.feed{min-height:0;overflow:auto;padding:12px;scrollbar-width:thin;scrollbar-color:rgba(126,144,255,.38) transparent}.cards{display:grid;gap:10px}.turn{border:1px solid rgba(255,255,255,.09);border-radius:15px;background:linear-gradient(145deg,rgba(255,255,255,.035),rgba(255,255,255,.016));overflow:hidden}.turn[data-affected="1"]{border-color:rgba(255,106,132,.5);box-shadow:0 0 0 2px rgba(255,89,124,.07),0 10px 36px rgba(63,14,61,.18)}.turnHead{display:flex;align-items:center;gap:8px;padding:10px 11px;border-bottom:1px solid rgba(255,255,255,.07)}.turnOrb{width:8px;height:8px;border-radius:50%;background:linear-gradient(135deg,var(--violet),var(--blue));box-shadow:0 0 12px rgba(110,113,255,.5)}.turn[data-affected="1"] .turnOrb{background:#ff6d83;box-shadow:0 0 12px rgba(255,93,124,.6)}.turnName{min-width:0;flex:1;font-size:10px;font-weight:750}.pills{display:flex;gap:4px;flex-wrap:wrap}.pill{font-size:7px;padding:4px 5px;border-radius:999px;background:rgba(108,123,205,.12);color:#aeb8d2}.pill.loss{background:rgba(255,91,124,.14);color:#ffb5c1}.miniBtn{appearance:none;border:1px solid rgba(255,255,255,.11);border-radius:8px;background:rgba(255,255,255,.035);color:#bec7da;padding:6px 7px;font:650 8px/1 system-ui;cursor:pointer}.miniBtn:hover{color:white;background:rgba(255,255,255,.08)}.turnBody{padding:13px}.savedText,.currentText{margin:0;white-space:pre-wrap;word-break:break-word;color:#dce1ed;font:500 10.5px/1.58 ui-monospace,SFMono-Regular,Consolas,monospace;max-height:320px;overflow:auto}.richText{max-width:82ch;color:#e2e6f1;font:450 12.5px/1.62 Inter,ui-sans-serif,system-ui,sans-serif;overflow-wrap:anywhere}.richText>*:first-child{margin-top:0}.richText>*:last-child{margin-bottom:0}.richText p{margin:0 0 10px}.richText h2,.richText h3,.richText h4{color:#f7f8ff;line-height:1.25;margin:18px 0 8px;letter-spacing:-.015em}.richText h2{font-size:18px}.richText h3{font-size:15px}.richText h4{font-size:13px}.richText ul,.richText ol{margin:8px 0 12px;padding-left:23px}.richText li{margin:4px 0;padding-left:2px}.richText blockquote{margin:10px 0;padding:9px 12px;border-left:3px solid #7f78ff;border-radius:0 9px 9px 0;background:rgba(102,91,213,.09);color:#c6cde0}.richText strong{color:#fff;font-weight:750}.richText code{border:1px solid rgba(146,158,238,.15);border-radius:5px;background:rgba(3,6,20,.55);color:#d9d4ff;padding:1px 4px;font:550 .88em/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}.richText a{color:#8bc8ff;text-decoration:none;border-bottom:1px solid rgba(91,172,255,.32)}.richText a:hover{color:#c3e5ff;border-color:#8bc8ff}.richText pre{margin:10px 0;padding:11px 12px;border:1px solid rgba(143,157,241,.14);border-radius:11px;background:#05081b;color:#dce4f3;white-space:pre-wrap;overflow:auto;font:500 10px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace}.richTableWrap{overflow:auto;margin:10px 0}.richTable{width:100%;border-collapse:separate;border-spacing:0;border:1px solid rgba(151,164,244,.15);border-radius:10px;overflow:hidden;font-size:10px}.richTable th,.richTable td{padding:8px 9px;border-right:1px solid rgba(151,164,244,.1);border-bottom:1px solid rgba(151,164,244,.1);text-align:left;vertical-align:top}.richTable th{color:#f2f4ff;background:rgba(92,91,190,.12)}.activityGroup{margin:9px 0;border:1px solid rgba(126,139,221,.13);border-radius:10px;background:rgba(4,7,24,.3);overflow:hidden}.activityGroup summary{cursor:pointer;padding:8px 10px;color:#aab5d1;font-size:9.5px;font-weight:650}.activityRows{display:grid;gap:2px;padding:0 10px 9px}.activityRow{display:flex;gap:7px;align-items:flex-start;color:#929db8;font-size:9px}.activityDot{width:5px;height:5px;margin-top:5px;border-radius:50%;background:linear-gradient(135deg,var(--violet),var(--blue));box-shadow:0 0 7px rgba(114,113,255,.44);flex:none}.compare{display:grid;grid-template-columns:1fr 1fr;gap:8px}.compareCol{min-width:0;border:1px solid rgba(255,255,255,.075);border-radius:11px;background:rgba(3,6,21,.32);padding:10px}.compareCol.current{border-color:rgba(255,96,127,.23)}.compareLabel{display:flex;justify-content:space-between;margin-bottom:9px;color:#8e99b8;font-size:7.5px;text-transform:uppercase;letter-spacing:.09em}.currentText,.compareCol.current .richText{color:#f2b6c2}.section{margin-top:12px}.sectionTitle{font-size:7.5px;text-transform:uppercase;letter-spacing:.1em;color:#7f8aa7;margin-bottom:6px}.linkGrid,.assetGrid,.fileGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:6px}.resource{display:flex;align-items:center;gap:7px;min-width:0;padding:8px 9px;border:1px solid rgba(255,255,255,.08);border-radius:9px;background:rgba(255,255,255,.025);color:#c8d0e2;text-decoration:none;font-size:8.5px}.resource:hover{border-color:rgba(123,144,255,.42);background:rgba(91,98,197,.09)}.resourceText{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.type{font-size:7px;color:#8e9abb;text-transform:uppercase}.preview{margin-top:7px}.preview img,.preview video{display:block;max-width:100%;max-height:340px;border-radius:10px;background:#030511}.preview audio{width:100%}.code details,.revisions details{border:1px solid rgba(255,255,255,.075);border-radius:10px;background:rgba(2,5,18,.3);margin-top:6px}.code summary,.revisions summary{cursor:pointer;color:#aeb8d0;padding:8px 9px;font-size:8.5px}.code pre,.revisionText{white-space:pre-wrap;word-break:break-word;margin:0;padding:9px;border-top:1px solid rgba(255,255,255,.06);max-height:320px;overflow:auto;color:#dce4f3;font:500 9px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}.revisionMeta{padding:8px 9px;color:#8995b4;font-size:8px;border-top:1px solid rgba(255,255,255,.06)}.empty{padding:40px 20px;text-align:center;color:#8792b0;font-size:10px}.load{display:block;margin:12px auto 2px}:host([data-expanded="1"]) .cards{width:100%;max-width:1180px;margin:0 auto}:host([data-expanded="1"]) .richText{font-size:13px}
      .footer{display:flex;flex-wrap:wrap;align-items:center;gap:7px;padding:11px 14px;border-top:1px solid var(--line);background:rgba(3,6,22,.42)}.btn{appearance:none;border:1px solid rgba(255,255,255,.12);border-radius:10px;background:rgba(255,255,255,.045);color:#d1d8e8;padding:8px 10px;font:700 9px/1 system-ui;cursor:pointer}.btn:hover{background:rgba(255,255,255,.09);color:white}.btn.primary{color:white;border-color:rgba(143,118,255,.52);background:linear-gradient(112deg,rgba(116,77,233,.94),rgba(48,132,235,.92));box-shadow:0 7px 24px rgba(65,77,217,.24)}.footerNote{margin-left:auto;color:#727e9c;font-size:7.5px}
      :host([data-collapsed="1"]) .vault{display:flex;height:auto;border-radius:18px}:host([data-collapsed="1"]) .head{width:100%;border:0;padding:11px 12px}:host([data-collapsed="1"]) .mark{width:30px;height:30px;border-radius:10px;font-size:14px}:host([data-collapsed="1"]) .alert,:host([data-collapsed="1"]) .workspace,:host([data-collapsed="1"]) .footer{display:none}:host([data-collapsed="1"]) .title{font-size:11px}:host([data-collapsed="1"]) .status{font-size:8px}
      @media(max-width:720px){:host{width:calc(100vw - 16px)}.workspace{grid-template-columns:1fr}.rail{display:none}.toolbar{flex-wrap:wrap}.search{flex-basis:100%}.compare{grid-template-columns:1fr}.footerNote{display:none}}
      @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
    `;
  }

  function ensureOutputVault() {
    if (outputCompareHost?.isConnected) return outputCompareHost;
    const host = document.createElement('div'); host.id = 'projectConstellationOutputVault'; host.dataset.collapsed = '0'; host.dataset.expanded = '0';
    const shadow = host.attachShadow({ mode:'open' });
    shadow.innerHTML = `<style>${outputVaultCss()}</style><section class="vault" role="dialog" aria-modal="false" aria-label="Project Constellation Output Vault"><header class="head"><div class="mark" aria-hidden="true">✦</div><div class="heading"><div class="eyebrow">PROJECT CONSTELLATION · OUTPUT VAULT</div><div class="title" id="pcVaultTitle">Loading saved output…</div><div class="status" id="pcVaultStatus">Comparing the rendered page with durable local revisions.</div></div><div class="headTools"><button class="icon" id="pcVaultCollapse" title="Collapse Output Vault" aria-label="Collapse Output Vault">⌄</button><button class="icon" id="pcVaultExpand" title="Expand Output Vault" aria-label="Expand Output Vault">⛶</button><button class="icon" id="pcVaultClose" title="Close Output Vault" aria-label="Close Output Vault">×</button></div></header><div class="alert" id="pcVaultAlert" role="status"><strong id="pcVaultAlertTitle">Saved output is missing</strong><span id="pcVaultAlertDetail"></span></div><div class="workspace"><aside class="rail"><div class="railTitle">Durable capture</div><div class="stats"><div class="stat"><span>Assistant outputs</span><strong id="pcVaultOutputs">0</strong></div><div class="stat"><span>Media + files</span><strong id="pcVaultMedia">0</strong></div><div class="stat"><span>Links</span><strong id="pcVaultLinks">0</strong></div><div class="stat"><span>Revisions</span><strong id="pcVaultRevisions">0</strong></div></div><label class="filter"><input type="checkbox" id="pcVaultAffected"> Show missing/changed only</label><p class="railNote">Saved output is local and revisioned. Remote media previews load only when you choose Preview.</p></aside><main class="main"><div class="toolbar"><input class="search" id="pcVaultSearch" type="search" placeholder="Search saved text, code, links, or media…" aria-label="Search Output Vault"><div class="viewSwitch" role="group" aria-label="Saved output display"><button class="viewBtn" id="pcVaultReader" aria-pressed="true">Reader</button><button class="viewBtn" id="pcVaultRaw" aria-pressed="false">Raw</button></div><span class="count" id="pcVaultCount">0 shown</span></div><div class="feed"><div class="cards" id="pcVaultCards"></div><button class="btn load" id="pcVaultLoad" hidden>Load older output</button></div></main></div><footer class="footer"><button class="btn primary" id="pcVaultCopy">Copy full vault</button><button class="btn" id="pcVaultDownload">Download Markdown</button><button class="btn" id="pcVaultBranch">✦ Branch from saved</button><span class="footerNote">Richest captured revisions are preserved even if the provider page rewrites itself.</span></footer></section>`;
    document.documentElement.appendChild(host); outputCompareHost = host;
    const collapse = shadow.getElementById('pcVaultCollapse');
    collapse.addEventListener('click', () => { host.dataset.collapsed = host.dataset.collapsed === '1' ? '0' : '1'; collapse.textContent = host.dataset.collapsed === '1' ? '⌃' : '⌄'; collapse.title = host.dataset.collapsed === '1' ? 'Expand Output Vault' : 'Collapse Output Vault'; syncConstellationDock(); });
    shadow.getElementById('pcVaultExpand').addEventListener('click', (event) => { host.dataset.expanded = host.dataset.expanded === '1' ? '0' : '1'; event.currentTarget.textContent = host.dataset.expanded === '1' ? '◱' : '⛶'; event.currentTarget.title = host.dataset.expanded === '1' ? 'Restore window size' : 'Expand Output Vault'; syncConstellationDock(); });
    shadow.getElementById('pcVaultClose').addEventListener('click', closeOutputVault);
    shadow.getElementById('pcVaultSearch').addEventListener('input', renderOutputVault);
    shadow.getElementById('pcVaultAffected').addEventListener('change', renderOutputVault);
    for (const [id, mode] of [['pcVaultReader','reader'],['pcVaultRaw','raw']]) shadow.getElementById(id).addEventListener('click', () => { outputVaultViewMode=mode; renderOutputVault(); });
    shadow.getElementById('pcVaultCopy').addEventListener('click', async (event) => { try { await copyHandoffText(outputVaultReport?.markdown || ''); event.currentTarget.textContent = '✓ Vault copied'; } catch (_) { event.currentTarget.textContent = 'Copy failed'; } setTimeout(()=>{ if(event.currentTarget?.isConnected)event.currentTarget.textContent='Copy full vault'; },2600); });
    shadow.getElementById('pcVaultDownload').addEventListener('click', () => {
      const blob = new Blob([outputVaultReport?.markdown || ''], { type:'text/markdown;charset=utf-8' }); const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = href; anchor.download = `Project-Constellation-Output-Vault-${new Date().toISOString().slice(0,10)}.md`; anchor.click(); setTimeout(()=>URL.revokeObjectURL(href),1000);
    });
    shadow.getElementById('pcVaultBranch').addEventListener('click', (event) => branchConversation(event.currentTarget));
    shadow.getElementById('pcVaultLoad').addEventListener('click', async (event) => {
      if (!outputVaultReport?.hasMore || event.currentTarget.dataset.busy === '1') return;
      event.currentTarget.dataset.busy='1'; event.currentTarget.textContent='Loading older output…';
      const older = await chrome.runtime.sendMessage({ type:'PC_OUTPUT_COMPARE', chatId:currentChatId(), offset:outputVaultReport.nextOffset, limit:120 }).catch(()=>null);
      if (older?.ok) { outputVaultItems = [...older.items, ...outputVaultItems]; outputVaultReport = { ...outputVaultReport, hasMore:older.hasMore, nextOffset:older.nextOffset }; }
      event.currentTarget.dataset.busy='0'; event.currentTarget.textContent='Load older output'; renderOutputVault();
    });
    outputVaultEscapeHandler = (event) => { if (event.key === 'Escape' && outputCompareHost?.isConnected) closeOutputVault(); };
    document.addEventListener('keydown', outputVaultEscapeHandler, true);
    connectOutputVaultDock();
    return host;
  }

  function vaultResource(label, url, type = 'link') {
    const safe = safeVaultUrl(url); const node = safe ? document.createElement('a') : document.createElement('div'); node.className='resource';
    if (safe) { node.href=safe; node.target='_blank'; node.rel='noopener noreferrer'; }
    const badge=document.createElement('span'); badge.className='type'; badge.textContent=type;
    const text=document.createElement('span'); text.className='resourceText'; text.textContent=label || url || type; text.title=label || url || type;
    node.append(badge,text); return node;
  }

  function vaultMediaResource(asset = {}) {
    const wrap=document.createElement('div'); wrap.className='resource';
    const badge=document.createElement('span'); badge.className='type'; badge.textContent=asset.kind || 'media';
    const text=document.createElement('span'); text.className='resourceText'; text.textContent=asset.alt || asset.url || 'Saved media'; text.title=asset.url || '';
    const preview=document.createElement('button'); preview.className='miniBtn'; preview.textContent='Preview';
    preview.addEventListener('click', () => {
      const container=wrap.parentElement?.querySelector?.(`[data-preview-id="${CSS.escape(asset.id || hashText(asset.url || 'media'))}"]`); if(!container)return;
      if(container.childElementCount){container.replaceChildren();preview.textContent='Preview';return;}
      const kind=['image','video','audio'].includes(asset.kind)?asset.kind:'media'; const url=safeVaultUrl(asset.embeddedDataUrl || asset.url,kind); if(!url){preview.textContent='Open unavailable';return;}
      let media=null; if(kind==='image'){media=document.createElement('img');media.alt=asset.alt||'Saved output image';media.loading='lazy';}
      else if(kind==='video'){media=document.createElement('video');media.controls=true;media.preload='metadata';}
      else if(kind==='audio'){media=document.createElement('audio');media.controls=true;media.preload='metadata';}
      if(!media){window.open(url,'_blank','noopener,noreferrer');return;} media.src=url; container.appendChild(media); preview.textContent='Hide';
    });
    wrap.append(badge,text,preview); return wrap;
  }

  function appendVaultInline(parent, value = '') {
    const text=String(value||'');
    const token=/(\*\*[^*\n]{1,500}\*\*|`[^`\n]{1,500}`|\[[^\]\n]{1,300}\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s<>{}\[\]]+)/g;
    let cursor=0; let match;
    while((match=token.exec(text))){
      if(match.index>cursor)parent.append(document.createTextNode(text.slice(cursor,match.index)));
      const raw=match[0];
      if(raw.startsWith('**')){const strong=document.createElement('strong');strong.textContent=raw.slice(2,-2);parent.appendChild(strong);}
      else if(raw.startsWith('`')){const code=document.createElement('code');code.textContent=raw.slice(1,-1);parent.appendChild(code);}
      else {
        const markdown=raw.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);const url=safeVaultUrl(markdown?.[2]||raw);
        if(url){const anchor=document.createElement('a');anchor.href=url;anchor.target='_blank';anchor.rel='noopener noreferrer';anchor.textContent=markdown?.[1]||raw;parent.appendChild(anchor);}
        else parent.append(document.createTextNode(raw));
      }
      cursor=match.index+raw.length;
    }
    if(cursor<text.length)parent.append(document.createTextNode(text.slice(cursor)));
  }

  function vaultLineKind(line = '', next = '') {
    if(/^```/.test(line.trim()))return 'code';
    if(/^#{1,6}\s+/.test(line))return 'heading';
    if(/^\s*[-*+]\s+/.test(line))return 'bullet';
    if(/^\s*\d+[.)]\s+/.test(line))return 'ordered';
    if(/^\s*>\s?/.test(line))return 'quote';
    if(line.includes('|')&&/^\s*\|?\s*:?-{3,}/.test(next||''))return 'table';
    if(/^(called tool|searched|used|read|updated|created|generated|verified|inspected|revalidated|exported|imported|built|rendered)\b/i.test(line.trim()))return 'activity';
    return line.trim()?'paragraph':'blank';
  }

  function vaultRichText(value = '') {
    const root=document.createElement('div');root.className='richText';
    const lines=String(value||'').replace(/\r\n?/g,'\n').split('\n');
    if(!lines.some((line)=>line.trim())){const empty=document.createElement('p');empty.textContent='No rendered text was captured.';root.appendChild(empty);return root;}
    for(let index=0;index<lines.length;){
      const line=lines[index];const kind=vaultLineKind(line,lines[index+1]);
      if(kind==='blank'){index+=1;continue;}
      if(kind==='code'){
        const language=line.trim().slice(3).trim();const body=[];index+=1;while(index<lines.length&&!/^```/.test(lines[index].trim()))body.push(lines[index++]);if(index<lines.length)index+=1;
        const pre=document.createElement('pre');if(language)pre.dataset.language=language;pre.textContent=body.join('\n');root.appendChild(pre);continue;
      }
      if(kind==='heading'){
        const match=line.match(/^(#{1,6})\s+(.+)$/);const level=Math.min(4,Math.max(2,Number(match?.[1]?.length||2)));const heading=document.createElement(`h${level}`);appendVaultInline(heading,match?.[2]||line);root.appendChild(heading);index+=1;continue;
      }
      if(kind==='bullet'||kind==='ordered'){
        const list=document.createElement(kind==='ordered'?'ol':'ul');const expression=kind==='ordered'?/^\s*\d+[.)]\s+/:/^\s*[-*+]\s+/;
        while(index<lines.length&&vaultLineKind(lines[index],lines[index+1])===kind){const item=document.createElement('li');appendVaultInline(item,lines[index].replace(expression,''));list.appendChild(item);index+=1;}root.appendChild(list);continue;
      }
      if(kind==='quote'){
        const quote=document.createElement('blockquote');const rows=[];while(index<lines.length&&vaultLineKind(lines[index],lines[index+1])==='quote')rows.push(lines[index++].replace(/^\s*>\s?/,''));appendVaultInline(quote,rows.join('\n'));root.appendChild(quote);continue;
      }
      if(kind==='table'){
        const rows=[];const split=(row)=>row.trim().replace(/^\||\|$/g,'').split('|').map((cell)=>cell.trim());const heads=split(line);index+=2;
        while(index<lines.length&&lines[index].includes('|')&&lines[index].trim())rows.push(split(lines[index++]));
        const wrap=document.createElement('div');wrap.className='richTableWrap';const table=document.createElement('table');table.className='richTable';const thead=document.createElement('thead');const headRow=document.createElement('tr');for(const value of heads){const cell=document.createElement('th');appendVaultInline(cell,value);headRow.appendChild(cell);}thead.appendChild(headRow);table.appendChild(thead);
        const tbody=document.createElement('tbody');for(const row of rows){const tr=document.createElement('tr');for(const value of row){const cell=document.createElement('td');appendVaultInline(cell,value);tr.appendChild(cell);}tbody.appendChild(tr);}table.appendChild(tbody);wrap.appendChild(table);root.appendChild(wrap);continue;
      }
      if(kind==='activity'){
        const steps=[];while(index<lines.length&&vaultLineKind(lines[index],lines[index+1])==='activity')steps.push(lines[index++].trim());
        const details=document.createElement('details');details.className='activityGroup';const summary=document.createElement('summary');summary.textContent=`Observed agent activity · ${steps.length} step${steps.length===1?'':'s'}`;const rows=document.createElement('div');rows.className='activityRows';for(const step of steps){const row=document.createElement('div');row.className='activityRow';const dot=document.createElement('span');dot.className='activityDot';const text=document.createElement('span');appendVaultInline(text,step);row.append(dot,text);rows.appendChild(row);}details.append(summary,rows);root.appendChild(details);continue;
      }
      const paragraph=document.createElement('p');const rows=[];
      while(index<lines.length&&vaultLineKind(lines[index],lines[index+1])==='paragraph')rows.push(lines[index++].trim());
      appendVaultInline(paragraph,rows.join(' '));root.appendChild(paragraph);
    }
    return root;
  }

  function vaultOutputText(value = '', tone = 'saved') {
    if(outputVaultViewMode==='reader')return vaultRichText(value);
    const pre=document.createElement('pre');pre.className=tone==='current'?'currentText':'savedText';pre.textContent=String(value||'')||'No rendered text was captured.';return pre;
  }

  function vaultTurnCopy(item = {}) {
    const lines=[String(item.text||'')];
    for(const block of item.codeBlocks||[])lines.push('',`\`\`\`${block.language||''}`,String(block.text||''),'\`\`\`');
    if((item.links||[]).length)lines.push('','Links:',...(item.links||[]).map((link)=>`- ${link.text||link.href}: ${link.href}`));
    if((item.assets||[]).length)lines.push('','Media:',...(item.assets||[]).map((asset)=>`- ${asset.kind||'media'}: ${asset.url}`));
    return lines.join('\n');
  }

  function createVaultTurnCard(item = {}, initiallyOpen = false) {
    const card=document.createElement('article'); card.className='turn'; card.dataset.affected=item.affected?'1':'0';
    const head=document.createElement('div');head.className='turnHead';const orb=document.createElement('span');orb.className='turnOrb';
    const name=document.createElement('div');name.className='turnName';name.textContent=`Assistant output · turn ${Number(item.ordinal||0)+1}`;
    const pills=document.createElement('div');pills.className='pills';
    const counts=[[(item.assets||[]).length,'media'],[(item.links||[]).length,'links'],[(item.codeBlocks||[]).length,'code'],[Math.max(1,Number(item.revisionCount||1)),'versions']];
    for(const [count,label] of counts)if(count){const pill=document.createElement('span');pill.className='pill';pill.textContent=`${count} ${label}`;pills.appendChild(pill);}
    if(item.affected){const loss=document.createElement('span');loss.className='pill loss';loss.textContent=item.current?'changed on page':'missing on page';pills.appendChild(loss);}
    const copy=document.createElement('button');copy.className='miniBtn';copy.textContent='Copy';copy.addEventListener('click',async()=>{await copyHandoffText(vaultTurnCopy(item));copy.textContent='✓ Copied';setTimeout(()=>{if(copy.isConnected)copy.textContent='Copy';},1800);});
    const versions=document.createElement('button');versions.className='miniBtn';versions.textContent='Versions';
    const toggle=document.createElement('button');toggle.className='miniBtn';toggle.textContent=initiallyOpen?'Collapse':'View';
    head.append(orb,name,pills,copy,versions,toggle); card.appendChild(head);
    const body=document.createElement('div');body.className='turnBody';body.hidden=!initiallyOpen;
    let mountPrimary=()=>{};
    if(item.affected){
      const compare=document.createElement('div');compare.className='compare';
      const savedDisplay=outputVaultViewMode==='reader'?(item.formattedText||item.text||''):(item.text||'');
      for(const [kind,label,text] of [['saved','Saved richest revision',savedDisplay],['current','Currently rendered',item.current?.excerpt||'This response is not present in the current mounted page tail.']]){
        const col=document.createElement('section');col.className=`compareCol ${kind}`;const heading=document.createElement('div');heading.className='compareLabel';heading.textContent=label;col.append(heading,vaultOutputText(text,kind));compare.appendChild(col);
      } body.appendChild(compare);
    } else {
      mountPrimary=()=>{if(body.dataset.primaryMounted==='1')return;const value=outputVaultViewMode==='reader'?(item.formattedText||item.text||''):(item.text||'');body.prepend(vaultOutputText(value,'saved'));body.dataset.primaryMounted='1';};
      if(initiallyOpen)mountPrimary();
    }
    toggle.addEventListener('click',()=>{body.hidden=!body.hidden;if(!body.hidden)mountPrimary();toggle.textContent=body.hidden?'View':'Collapse';});
    if((item.links||[]).length){const section=document.createElement('section');section.className='section';section.innerHTML='<div class="sectionTitle">Links</div>';const grid=document.createElement('div');grid.className='linkGrid';for(const link of item.links)grid.appendChild(vaultResource(link.text||link.href,link.href,'link'));section.appendChild(grid);body.appendChild(section);}
    if((item.assets||[]).length){const section=document.createElement('section');section.className='section';section.innerHTML='<div class="sectionTitle">Media and generated output</div>';const grid=document.createElement('div');grid.className='assetGrid';for(const asset of item.assets){const cell=document.createElement('div');const normalized={...asset,id:asset.id||hashText(asset.url||'media')};cell.appendChild(vaultMediaResource(normalized));const preview=document.createElement('div');preview.className='preview';preview.dataset.previewId=normalized.id;cell.appendChild(preview);grid.appendChild(cell);}section.appendChild(grid);body.appendChild(section);}
    if((item.codeBlocks||[]).length){const section=document.createElement('section');section.className='section code';section.innerHTML='<div class="sectionTitle">Code and structured output</div>';for(const [index,block] of item.codeBlocks.entries()){const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent=`${block.language||'code'} · block ${index+1}`;const pre=document.createElement('pre');pre.textContent=block.text||'';details.append(summary,pre);section.appendChild(details);}body.appendChild(section);}
    const revisionSection=document.createElement('section');revisionSection.className='section revisions';revisionSection.hidden=true;body.appendChild(revisionSection);
    versions.addEventListener('click',async()=>{if(!revisionSection.hidden){revisionSection.hidden=true;return;}revisionSection.hidden=false;if(revisionSection.dataset.loaded==='1')return;versions.textContent='Loading…';const response=await chrome.runtime.sendMessage({type:'PC_OUTPUT_TURN_REVISIONS',turnId:item.id}).catch(()=>null);revisionSection.replaceChildren();const title=document.createElement('div');title.className='sectionTitle';title.textContent='Captured revision history';revisionSection.appendChild(title);for(const revision of response?.revisions||[]){const details=document.createElement('details');const summary=document.createElement('summary');const best=revision.id===response?.turn?.bestRevisionId?' · richest saved':'';summary.textContent=`${new Date(revision.capturedAt||revision.updatedAt||0).toLocaleString()} · score ${Number(revision.richnessScore||0).toLocaleString()}${best}`;const pre=document.createElement('pre');pre.className='revisionText';pre.textContent=revision.text||'No text in this revision.';details.append(summary,pre);revisionSection.appendChild(details);}revisionSection.dataset.loaded='1';versions.textContent='Versions';});
    card.appendChild(body); return card;
  }

  function createVaultFilesCard(files = []) {
    const card=document.createElement('article');card.className='turn';
    const head=document.createElement('div');head.className='turnHead';const orb=document.createElement('span');orb.className='turnOrb';const name=document.createElement('div');name.className='turnName';name.textContent='Captured files, builds, and artifacts';const pill=document.createElement('span');pill.className='pill';pill.textContent=`${files.length} saved`;head.append(orb,name,pill);card.appendChild(head);
    const body=document.createElement('div');body.className='turnBody';const grid=document.createElement('div');grid.className='fileGrid';
    for(const file of files){const url=file.href||file.externalUrl||'';if(file.embeddedDataUrl&&['image','video','audio'].includes(file.kind)){const cell=document.createElement('div');const asset={id:file.id||hashText(url),kind:file.kind,url,embeddedDataUrl:file.embeddedDataUrl,alt:file.name||file.kind};cell.appendChild(vaultMediaResource(asset));const preview=document.createElement('div');preview.className='preview';preview.dataset.previewId=asset.id;cell.appendChild(preview);grid.appendChild(cell);}else grid.appendChild(vaultResource(file.name||url||file.kind,url,file.kind||'file'));}
    body.appendChild(grid);card.appendChild(body);return card;
  }

  function renderOutputVault() {
    if (!outputCompareHost?.isConnected || !outputVaultReport) return;
    const shadow=outputCompareHost.shadowRoot; const regression=outputVaultReport.regression||{};
    outputCompareHost.dataset.view=outputVaultViewMode;
    shadow.getElementById('pcVaultReader').setAttribute('aria-pressed',outputVaultViewMode==='reader'?'true':'false');
    shadow.getElementById('pcVaultRaw').setAttribute('aria-pressed',outputVaultViewMode==='raw'?'true':'false');
    shadow.getElementById('pcVaultTitle').textContent=outputVaultReport.chat?.title||'Captured chat output';
    shadow.getElementById('pcVaultStatus').textContent=regression.active?regression.detail:`${outputVaultReport.total||0} assistant outputs are stored in the durable local vault.`;
    const alert=shadow.getElementById('pcVaultAlert');alert.dataset.active=regression.active?'1':'0';shadow.getElementById('pcVaultAlertTitle').textContent=regression.title||'Saved output is missing';shadow.getElementById('pcVaultAlertDetail').textContent=regression.detail||'';
    const totalMedia=outputVaultItems.reduce((sum,item)=>sum+(item.assets||[]).length,0)+(outputVaultReport.files||[]).length;
    const totalLinks=outputVaultItems.reduce((sum,item)=>sum+(item.links||[]).length,0);
    const totalRevisions=outputVaultItems.reduce((sum,item)=>sum+Math.max(1,Number(item.revisionCount||1)),0);
    shadow.getElementById('pcVaultOutputs').textContent=Number(outputVaultReport.total||0).toLocaleString();shadow.getElementById('pcVaultMedia').textContent=totalMedia.toLocaleString();shadow.getElementById('pcVaultLinks').textContent=totalLinks.toLocaleString();shadow.getElementById('pcVaultRevisions').textContent=totalRevisions.toLocaleString();
    const query=String(shadow.getElementById('pcVaultSearch').value||'').toLowerCase().trim();const affectedOnly=shadow.getElementById('pcVaultAffected').checked;
    const filtered=outputVaultItems.filter((item)=>{if(affectedOnly&&!item.affected)return false;if(!query)return true;return `${item.text||''} ${(item.links||[]).map(x=>`${x.text} ${x.href}`).join(' ')} ${(item.assets||[]).map(x=>`${x.alt} ${x.url}`).join(' ')} ${(item.codeBlocks||[]).map(x=>`${x.language} ${x.text}`).join(' ')}`.toLowerCase().includes(query);}).sort((a,b)=>Number(b.ordinal||0)-Number(a.ordinal||0));
    const cards=shadow.getElementById('pcVaultCards');const fragment=document.createDocumentFragment();if((outputVaultReport.files||[]).length&&!affectedOnly&&(!query||(outputVaultReport.files||[]).some((file)=>`${file.name||''} ${file.href||file.externalUrl||''} ${file.kind||''}`.toLowerCase().includes(query))))fragment.appendChild(createVaultFilesCard(outputVaultReport.files));for(const [index,item] of filtered.entries())fragment.appendChild(createVaultTurnCard(item,item.affected||index<2));
    if(!filtered.length){const empty=document.createElement('div');empty.className='empty';empty.textContent=query||affectedOnly?'No saved output matches this filter.':'No assistant output has been captured for this chat yet.';fragment.appendChild(empty);}cards.replaceChildren(fragment);
    shadow.getElementById('pcVaultCount').textContent=`${filtered.length.toLocaleString()} shown`;shadow.getElementById('pcVaultLoad').hidden=!outputVaultReport.hasMore;
    syncConstellationDock();
  }

  async function openOutputVault(button = null) {
    if (outputVaultBusy) return;
    outputVaultBusy=true;const prior=button?.textContent||'';if(button){button.disabled=true;button.textContent='Opening vault…';}
    try {
      await maybeObserveOutputIntegrity(true).catch(()=>null);
      const report=await chrome.runtime.sendMessage({type:'PC_OUTPUT_COMPARE',chatId:currentChatId(),offset:0,limit:120}).catch(()=>null);
      if(!report?.ok)throw new Error(report?.error||'Output Vault could not be opened.');
      outputVaultReport=report;outputVaultItems=report.items||[];outputCompareSummary=report.regression||outputCompareSummary;
      if(liveHealthHost?.isConnected&&liveHealthHost.dataset.visible!=='0'&&liveHealthHost.dataset.collapsed!=='1')setPulseCollapsed(true,true);
      ensureOutputVault();renderOutputVault();
      if(outputCompareHost){outputCompareHost.dataset.collapsed='0';outputCompareHost.shadowRoot?.getElementById('pcVaultSearch')?.focus();}
    }catch(error){showBranchTransferToast('Output Vault unavailable',String(error?.message||error),'error');}
    finally{outputVaultBusy=false;if(button?.isConnected){button.disabled=false;button.textContent=prior||'⇄ Output Vault';}}
  }

  function branchComposer() {
    const selectors = provider.id === 'chatgpt'
      ? ['#prompt-textarea','[contenteditable="true"][role="textbox"]','textarea[placeholder]']
      : ['textarea','[contenteditable="true"][role="textbox"]','[contenteditable="true"]'];
    for (const selector of selectors) for (const node of document.querySelectorAll(selector)) {
      if (!(node instanceof HTMLElement) || node.getAttribute('aria-disabled') === 'true') continue;
      const style = getComputedStyle(node); const rect = node.getBoundingClientRect();
      if (style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 20 && rect.height > 10) return node;
    }
    return null;
  }

  function branchComposerText(node) {
    return brain.normalizeText(node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement ? node.value : node?.innerText || node?.textContent || '', 50000);
  }

  function fillBranchComposer(node, prompt) {
    if (!node || !prompt) return false;
    const existing = branchComposerText(node);
    if (existing && !String(prompt).startsWith(existing.slice(0, 160))) return false;
    node.focus();
    if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) {
      const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(node, prompt); else node.value = prompt;
    } else {
      let inserted = false;
      try { document.execCommand?.('selectAll', false, null); inserted = Boolean(document.execCommand?.('insertText', false, prompt)); } catch (_) {}
      if (!inserted || branchComposerText(node).length < Math.min(80, prompt.length / 2)) {
        const fragment = document.createDocumentFragment();
        for (const line of String(prompt).split('\n')) { const p = document.createElement('p'); if (line) p.textContent = line; else p.appendChild(document.createElement('br')); fragment.appendChild(p); }
        node.replaceChildren(fragment);
      }
    }
    try { node.dispatchEvent(new InputEvent('input', { bubbles:true, inputType:'insertText', data:null })); } catch (_) { node.dispatchEvent(new Event('input', { bubbles:true })); }
    node.dispatchEvent(new Event('change', { bubbles:true }));
    return branchComposerText(node).length >= Math.min(80, prompt.length / 2);
  }

  function branchSendButton(composer) {
    const scope = composer?.closest('form') || composer?.parentElement?.parentElement || document;
    const candidates = [...scope.querySelectorAll?.('[data-testid="send-button"],button[aria-label*="send" i],button[data-testid*="send" i],button[type="submit"]') || []];
    return candidates.find((node) => isUsableControl(node) && !/stop|cancel/i.test(elementLabel(node, 120))) || null;
  }

  async function resolveBranchLineage() {
    const chatId = currentChatId();
    if (!chatId || chatId.endsWith(':home')) return;
    await chrome.runtime.sendMessage({ type:'PC_BRANCH_LINEAGE_RESOLVE', chatId, url:location.href }).catch(() => null);
  }

  async function resumePendingBranch() {
    if (branchResumeBusy) return;
    branchResumeBusy = true;
    try {
      let claim = null;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        claim = await chrome.runtime.sendMessage({ type:'PC_BRANCH_CONTINUATION_CLAIM', providerId:provider.id, url:location.href }).catch(() => null);
        if (claim?.ok || claim?.state !== 'not-ready') break;
        await sleep(250);
      }
      if (!claim?.ok || !claim.prompt) { await resolveBranchLineage(); return; }
      showBranchTransferToast('Restoring previous-chat context…', `Continuation of ${claim.sourceTitle || 'your previous chat'}`);
      let composer = null;
      for (let attempt = 0; attempt < 50 && !composer; attempt += 1) { composer = branchComposer(); if (!composer) await sleep(300); }
      let status = 'failed';
      if (composer && fillBranchComposer(composer, claim.prompt)) {
        await sleep(350);
        if (pulseUxSettings.branchReviewBeforeSend !== false) {
          status = 'prefilled';
          composer.dataset.projectConstellationBranchReady = '1';
          const onBranchEnter = (event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
            const send = branchSendButton(composer);
            if (!send) return;
            event.preventDefault(); event.stopPropagation();
            composer.removeEventListener('keydown', onBranchEnter, true);
            delete composer.dataset.projectConstellationBranchReady;
            send.click();
          };
          composer.addEventListener('keydown', onBranchEnter, true);
          showBranchTransferToast('Continuation ready to edit', 'Edit anything you want, then press Enter to send. Shift+Enter still adds a new line.', 'ready');
        } else {
          let send = null;
          for (let attempt = 0; attempt < 24 && !send; attempt += 1) { send = branchSendButton(composer); if (!send) await sleep(250); }
          if (send) {
            send.click();
            for (let attempt = 0; attempt < 32; attempt += 1) {
              await sleep(250);
              if (!composer.isConnected || branchComposerText(composer).length < 8 || !currentChatId().endsWith(':home')) { status = 'sent'; break; }
            }
          }
          if (status !== 'sent') status = 'prefilled';
        }
      } else {
        try { await copyHandoffText(claim.prompt); status = 'copied'; } catch (_) { status = 'failed'; }
      }
      await chrome.runtime.sendMessage({ type:'PC_BRANCH_CONTINUATION_COMPLETE', branchId:claim.branchId, status, url:location.href }).catch(() => null);
      if (status === 'sent') { showBranchTransferToast('Continuation sent', 'The new chat is now linked to its parent checkpoint.', 'ready'); await resolveBranchLineage(); }
      else if (status === 'prefilled' && pulseUxSettings.branchReviewBeforeSend === false) showBranchTransferToast('Continuation ready', 'Context is in the composer. Press Send when you are ready.', 'ready');
      else if (status === 'copied') showBranchTransferToast('Continuation copied', 'The provider composer changed. Paste the recovered context to continue.', 'error');
      else showBranchTransferToast('Could not transfer context', 'Return to the parent chat and choose Branch & continue again.', 'error');
    } finally { branchResumeBusy = false; }
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
    const outputRegression = outputCompareSummary || context.chat?.outputRegression || null;
    return { refreshRequired: lastStatus === 'refresh-required', catalogAhead: catalogAhead || missingLatest, staleRevision: false, renderDegraded: hydrated && renderedConversationDegraded(), outputRegression, atBottom, hydrated, latestMounted: current };
  }

  function healthHudCss() {
    return `
      :host{all:initial;position:fixed;z-index:2147483006;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#f5f7ff;--pc-accent:#8b5cf6;--pc-level:#63d6a7;--pc-bg:rgba(7,10,28,.95);--pc-line:rgba(160,174,255,.16);--pc-muted:#a1a9ca;--pc-shadow:0 18px 60px rgba(2,3,18,.52),0 0 28px rgba(91,73,200,.09);pointer-events:none}
      :host([data-corner="bottom-right"]){right:18px;bottom:18px}:host([data-corner="bottom-left"]){left:18px;bottom:18px}:host([data-corner="top-right"]){right:18px;top:18px}:host([data-corner="top-left"]){left:18px;top:18px}
      :host([data-level="active"]),:host([data-level="info"]){--pc-level:#7f92ff}:host([data-level="warning"]){--pc-level:#f0c567}:host([data-level="danger"]){--pc-level:#ff8f8f}:host([data-level="critical"]){--pc-level:#ff676f}
      *{box-sizing:border-box}.hud{pointer-events:auto;width:388px;box-sizing:border-box;border:1px solid color-mix(in srgb,var(--pc-level) 32%,var(--pc-line));border-radius:18px;background:radial-gradient(circle at 92% 4%,rgba(79,118,240,.14),transparent 38%),linear-gradient(145deg,color-mix(in srgb,var(--pc-bg) 92%,var(--pc-level) 8%),var(--pc-bg));box-shadow:var(--pc-shadow);backdrop-filter:blur(18px) saturate(1.12);overflow:hidden;transition:width .18s ease,transform .18s ease,border-color .18s ease}
      .top{display:flex;align-items:center;gap:9px;padding:11px 12px 9px}.orb{width:9px;height:9px;border-radius:50%;background:var(--pc-level);box-shadow:0 0 0 4px color-mix(in srgb,var(--pc-level) 14%,transparent),0 0 18px color-mix(in srgb,var(--pc-level) 50%,transparent);flex:0 0 auto}.brand{min-width:0;flex:1}.eyebrow{font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--pc-muted);line-height:1.2}.state{font-size:12px;font-weight:720;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}.substate{font-size:8.5px;color:#9099a8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}.tools{display:flex;gap:4px}.icon{appearance:none;border:0;background:transparent;color:#adb5c4;border-radius:7px;width:27px;height:27px;cursor:pointer;font:600 14px/1 system-ui}.icon:hover{background:rgba(255,255,255,.08);color:white}.quickBranch,.quickVault{appearance:none;width:29px;height:29px;border:1px solid rgba(148,125,255,.5);border-radius:9px;color:#fff;background:linear-gradient(135deg,rgba(114,76,232,.94),rgba(51,126,235,.92));box-shadow:0 6px 18px rgba(67,75,213,.24);cursor:pointer;font:760 14px/1 system-ui}.quickVault{background:rgba(64,77,144,.24);color:#cbd7ff}.quickBranch:hover,.quickVault:hover{filter:brightness(1.12)}.quickBranch[data-urgent="1"],.quickVault[data-urgent="1"]{border-color:#ff879a;box-shadow:0 0 0 2px color-mix(in srgb,var(--pc-level) 18%,transparent),0 7px 22px color-mix(in srgb,var(--pc-level) 34%,transparent)}
      .body{padding:0 12px;max-height:min(590px,calc(100vh - 128px));overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:rgba(126,144,255,.38) transparent}.detail{font-size:10px;line-height:1.45;color:#b8bfcc;margin:0 0 9px}.now{position:relative;border:1px solid color-mix(in srgb,var(--pc-level) 30%,rgba(255,255,255,.08));border-radius:12px;background:linear-gradient(135deg,color-mix(in srgb,var(--pc-level) 10%,rgba(255,255,255,.025)),rgba(255,255,255,.018));padding:10px 11px;margin-bottom:8px;overflow:hidden}.now:before{content:"";position:absolute;left:0;top:0;bottom:0;width:2px;background:var(--pc-level)}.sectionHead,.nowHead{display:flex;align-items:center;justify-content:space-between;gap:8px;color:#858eaa;font-size:7.5px;letter-spacing:.11em;text-transform:uppercase}.nowTitle{font-size:11.5px;line-height:1.35;color:#f5f7ff;font-weight:720;margin-top:5px}.nowDetail{font-size:9px;line-height:1.4;color:#aeb6c8;margin-top:3px}.proof{display:flex;align-items:center;gap:6px;margin:0 0 8px;padding:6px 8px;border-radius:8px;background:rgba(98,114,190,.08);color:#aeb7ce;font-size:8px;line-height:1.3}.proofDot{width:5px;height:5px;border-radius:50%;background:#7990ff;box-shadow:0 0 9px rgba(121,144,255,.6);flex:none}.chips{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:9px}.chip{font-size:8px;line-height:1;border:1px solid rgba(255,255,255,.11);border-radius:999px;padding:5px 6px;color:#aeb7c6;background:rgba(255,255,255,.035)}.timelineWrap{margin:0 0 9px}.timeline{display:grid;gap:3px;margin-top:5px}.event{display:grid;grid-template-columns:7px minmax(0,1fr) auto;gap:7px;align-items:start;padding:5px 3px;border-radius:7px}.event:hover{background:rgba(255,255,255,.025)}.eventDot{width:6px;height:6px;margin-top:3px;border-radius:50%;background:#7787aa}.event[data-kind="tool"] .eventDot{background:#9a7cff}.event[data-kind="network"] .eventDot{background:#56a8ff}.event[data-kind="response"] .eventDot{background:#55d0a0}.event[data-kind="warning"] .eventDot,.event[data-kind="error"] .eventDot{background:#ff8f8f}.eventBody{min-width:0}.eventTitle,.eventDetail{display:block}.eventTitle{font-size:9px;color:#dce1ed;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.eventDetail{font-size:7.5px;color:#818ba2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}.eventTime{font-size:7.5px;color:#707990;white-space:nowrap;margin-top:1px}.metrics{display:grid;grid-template-columns:1fr 1fr;gap:6px}.metric{border:1px solid rgba(255,255,255,.08);border-radius:9px;background:rgba(255,255,255,.025);padding:7px 8px}.metric span{display:block;color:#7f8898;font-size:7.5px;text-transform:uppercase;letter-spacing:.08em}.metric strong{display:block;color:#e7ebf2;font-size:10px;margin-top:3px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.truth{font-size:7.5px;line-height:1.35;color:#737d94;margin:8px 1px 9px}.actions{display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:9px 12px 11px;border-top:1px solid rgba(255,255,255,.07);background:linear-gradient(180deg,rgba(8,11,31,.72),rgba(8,11,31,.97))}.btn{appearance:none;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.045);color:#cbd2de;border-radius:8px;padding:7px 9px;font:600 9px/1.1 system-ui;cursor:pointer}.btn:hover{background:rgba(255,255,255,.085);color:white}.btn.primary{background:color-mix(in srgb,var(--pc-level) 16%,rgba(255,255,255,.04));border-color:color-mix(in srgb,var(--pc-level) 42%,rgba(255,255,255,.12));color:#fff}.btn.branch{position:relative;overflow:hidden;color:#fff;border-color:rgba(148,125,255,.52);background:linear-gradient(112deg,rgba(114,76,232,.92),rgba(51,126,235,.9));box-shadow:0 7px 22px rgba(67,75,213,.22);font-weight:760}.btn.branch:hover{background:linear-gradient(112deg,rgba(132,91,246,.98),rgba(62,142,248,.96));box-shadow:0 9px 28px rgba(75,88,232,.34)}.btn.branch[data-urgent="1"]{border-color:color-mix(in srgb,var(--pc-level) 70%,white 12%);box-shadow:0 0 0 2px color-mix(in srgb,var(--pc-level) 13%,transparent),0 8px 28px color-mix(in srgb,var(--pc-level) 32%,transparent)}.btn[hidden]{visibility:hidden;position:absolute;pointer-events:none;opacity:0}
      .btn.vault{color:#eef2ff;border-color:rgba(111,145,255,.42);background:linear-gradient(135deg,rgba(74,71,167,.28),rgba(36,111,184,.24));font-weight:760}.btn.vault:hover{border-color:rgba(143,123,255,.7);box-shadow:0 7px 22px rgba(55,75,188,.22)}.btn.vault[data-urgent="1"]{border-color:#ff879a;background:linear-gradient(135deg,rgba(154,45,99,.32),rgba(84,54,171,.28));box-shadow:0 0 0 2px rgba(255,89,124,.08),0 7px 24px rgba(96,30,110,.28)}
      :host([data-level="active"]) .orb{animation:pc-health-pulse 1.35s ease-in-out infinite}:host([data-state="tool-stalled"]) .orb,:host([data-state="request-stalled"]) .orb,:host([data-state="stalled"]) .orb{animation:pc-health-alert 1.1s ease-in-out infinite}:host([data-state="tool-dead"]) .orb,:host([data-state="dead"]) .orb{box-shadow:0 0 0 5px color-mix(in srgb,var(--pc-level) 18%,transparent),0 0 24px color-mix(in srgb,var(--pc-level) 68%,transparent)}
      :host([data-density="compact"]) .detail,:host([data-density="compact"]) .chips{display:none}:host([data-density="compact"][data-collapsed="1"]) .hud{width:360px;border-radius:999px}:host([data-collapsed="1"]) .body{height:0;overflow:hidden;padding:0}:host([data-collapsed="1"]) .actions{display:none}:host([data-collapsed="0"]) .quickBranch,:host([data-collapsed="0"]) .quickVault{display:none}:host([data-collapsed="1"]) .top{padding:9px 10px}:host([data-collapsed="1"]) .eyebrow{font-size:7px}:host([data-collapsed="1"]) .state{font-size:10.5px}:host([data-collapsed="1"]) .substate{font-size:7.5px}
      :host([data-visible="0"]){visibility:hidden;opacity:0;pointer-events:none}
      @keyframes pc-health-pulse{0%,100%{transform:scale(.92);opacity:.72}50%{transform:scale(1.18);opacity:1}}@keyframes pc-health-alert{0%,100%{transform:scale(1)}50%{transform:scale(1.22)}}
      @media (max-width:620px){:host([data-corner$="right"]){right:8px}:host([data-corner$="left"]){left:8px}:host([data-corner^="bottom"]){bottom:8px}:host([data-corner^="top"]){top:8px}.hud{width:min(388px,calc(100vw - 16px))}:host([data-density="compact"][data-collapsed="1"]) .hud{width:min(360px,calc(100vw - 16px))}}
      @media (prefers-reduced-motion:reduce){.hud{transition:none}.orb{box-shadow:none!important;animation:none!important}}
    `;
  }

  function ensureLiveHealthHud() {
    if (liveHealthHost?.isConnected) return liveHealthHost;
    const host = document.createElement('div');
    host.id = 'projectConstellationHealthHud';
    host.dataset.corner = liveHealthSettings.corner || 'bottom-right'; host.dataset.density = liveHealthSettings.density || 'compact'; host.dataset.collapsed = '0'; host.dataset.visible = '1';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${healthHudCss()}</style><section class="hud" role="complementary" aria-label="Project Constellation execution pulse"><div class="top"><span class="orb"></span><div class="brand" aria-live="polite" aria-atomic="true"><div class="eyebrow">CONSTELLATION · EXECUTION PULSE</div><div class="state" id="pcHealthTitle">Starting monitor…</div><div class="substate" id="pcHealthMini">Watching model, tool, DOM, and network proof…</div></div><div class="tools"><button class="quickVault" id="pcHealthVaultQuick" title="Open the durable Output Vault" aria-label="Open Output Vault">⇄</button><button class="quickBranch" id="pcHealthBranchQuick" title="Branch early into a linked continuation chat" aria-label="Branch and continue in a new chat">✦</button><button class="icon" id="pcHealthOpen" title="Open Project Constellation" aria-label="Open Project Constellation">↗</button><button class="icon" id="pcHealthCollapse" title="Expand or collapse" aria-label="Collapse execution pulse">−</button></div></div><div class="body"><p class="detail" id="pcHealthDetail">Building a local execution-health picture without making provider requests.</p><div class="now"><div class="nowHead"><span>Observed now</span><span id="pcHealthNowTime">now</span></div><div class="nowTitle" id="pcHealthNowTitle">Starting local monitor</div><div class="nowDetail" id="pcHealthNowDetail">Waiting for the first observable browser signal.</div></div><div class="proof"><span class="proofDot"></span><span id="pcHealthProof">Local browser evidence · no hidden reasoning guessed</span></div><div class="chips" id="pcHealthChips"></div><div class="timelineWrap"><div class="sectionHead"><span>Recent observed activity</span><span id="pcHealthEventCount">0 events</span></div><div class="timeline" id="pcHealthTimeline" aria-live="off"></div></div><div class="metrics"><div class="metric"><span>Last proof</span><strong id="pcHealthProgress">—</strong></div><div class="metric"><span>Network</span><strong id="pcHealthNetwork">observing</strong></div><div class="metric"><span>Activity</span><strong id="pcHealthActivity">model</strong></div><div class="metric"><span>Tool pulse</span><strong id="pcHealthTool">—</strong></div><div class="metric"><span>Project</span><strong id="pcHealthProject">—</strong></div><div class="metric"><span>Page</span><strong id="pcHealthPage">current</strong></div><div class="metric capacity"><span>Capacity</span><strong id="pcHealthCapacity">clear</strong></div><div class="metric"><span>Handoff</span><strong id="pcHealthHandoffState">ready</strong></div></div><p class="truth">Reports only observable page, tool-card, response, status, and provider-request evidence. It never exposes or invents private reasoning.</p></div><div class="actions"><button class="btn vault" id="pcHealthVault" title="Open every saved output and compare it with this page">⇄ Output Vault</button><button class="btn branch" id="pcHealthBranch" title="Create a recoverable continuation in a new chat">✦ Branch &amp; continue</button><button class="btn primary" id="pcHealthRefresh" hidden>Refresh chat</button><button class="btn primary" id="pcHealthHandoff" hidden>Secure handoff</button><button class="btn" id="pcHealthSettings">Health settings</button></div></section>`;
    document.documentElement.appendChild(host);
    liveHealthHost = host; liveHealthShadow = shadow;
    shadow.getElementById('pcHealthCollapse').addEventListener('click', () => { setPulseCollapsed(host.dataset.collapsed !== '1', false); syncConstellationDock(); });
    shadow.getElementById('pcHealthOpen').addEventListener('click', () => chrome.runtime.sendMessage({ type:'PC_OPEN_CONSTELLATION_PAGE', view:'attention' }).catch(() => {}));
    shadow.getElementById('pcHealthSettings').addEventListener('click', () => chrome.runtime.sendMessage({ type:'PC_OPEN_CONSTELLATION_PAGE', view:'attention', focus:'live-health' }).catch(() => {}));
    shadow.getElementById('pcHealthRefresh').addEventListener('click', () => location.reload());
    shadow.getElementById('pcHealthHandoff').addEventListener('click', (event) => secureConversationHandoff(event.currentTarget));
    shadow.getElementById('pcHealthBranch').addEventListener('click', (event) => branchConversation(event.currentTarget));
    shadow.getElementById('pcHealthBranchQuick').addEventListener('click', (event) => branchConversation(event.currentTarget));
    shadow.getElementById('pcHealthVault').addEventListener('click', (event) => openOutputVault(event.currentTarget));
    shadow.getElementById('pcHealthVaultQuick').addEventListener('click', (event) => openOutputVault(event.currentTarget));
    return host;
  }

  function ageText(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '—';
    if (ms < 1000) return 'now';
    const sec = Math.round(ms / 1000); if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60); const rem = sec % 60; return `${min}m ${rem}s ago`;
  }

  function setHealthText(shadow, id, value) {
    const node = shadow.getElementById(id); const text = String(value ?? '');
    if (node && node.textContent !== text) node.textContent = text;
  }

  function networkActivityEvents(network = {}) {
    return (Array.isArray(network.events) ? network.events : []).map((event) => {
      const phase = String(event.phase || 'observed');
      const category = brain.normalizeText(event.category || 'provider request', 80);
      const verb = phase === 'started' ? 'Started' : phase === 'response' ? 'Received' : phase === 'completed' ? 'Completed' : phase === 'error' ? 'Failed' : 'Observed';
      const detail = [String(event.method || '').toUpperCase(), Number(event.status || 0) ? `HTTP ${Number(event.status)}` : '', Number(event.durationMs || 0) >= 1 ? `${Math.round(Number(event.durationMs))} ms` : ''].filter(Boolean).join(' · ');
      return { kind:phase === 'error' ? 'error' : event.activityBearing === false ? 'site' : 'network', label:`${verb} ${category}`, detail, key:`network:${event.id || ''}:${phase}:${event.at || 0}`, at:Number(event.at || 0) };
    }).filter((event) => event.at >= routeStartedAt - 2000);
  }

  function renderActivityTimeline(host, shadow, events, now = Date.now()) {
    const rows = events.slice(0, 7);
    const signature = rows.map((row) => `${row.key}|${row.label}|${row.detail}|${Math.floor(Math.max(0, now - row.at) / 5000)}`).join('||');
    setHealthText(shadow, 'pcHealthEventCount', `${events.length} event${events.length === 1 ? '' : 's'}`);
    if (host.dataset.timelineSignature === signature) return;
    host.dataset.timelineSignature = signature;
    const timeline = shadow.getElementById('pcHealthTimeline');
    const fragment = document.createDocumentFragment();
    for (const row of rows) {
      const event = document.createElement('div'); event.className = 'event'; event.dataset.kind = row.kind || 'page';
      const dot = document.createElement('span'); dot.className = 'eventDot';
      const body = document.createElement('span'); body.className = 'eventBody';
      const title = document.createElement('span'); title.className = 'eventTitle'; title.textContent = row.label || 'Activity observed'; title.title = row.label || '';
      const detail = document.createElement('span'); detail.className = 'eventDetail'; detail.textContent = row.detail || row.kind || 'browser evidence';
      const time = document.createElement('span'); time.className = 'eventTime'; time.textContent = ageText(Math.max(0, now - Number(row.at || now)));
      body.append(title, detail); event.append(dot, body, time); fragment.appendChild(event);
    }
    if (!rows.length) {
      const empty = document.createElement('div'); empty.className = 'event'; empty.dataset.kind = 'page';
      const dot = document.createElement('span'); dot.className = 'eventDot'; const body = document.createElement('span'); body.className = 'eventBody';
      const title = document.createElement('span'); title.className = 'eventTitle'; title.textContent = 'Monitor ready';
      const detail = document.createElement('span'); detail.className = 'eventDetail'; detail.textContent = 'Waiting for observable activity';
      body.append(title, detail); empty.append(dot, body); fragment.appendChild(empty);
    }
    timeline.replaceChildren(fragment);
  }

  function renderLiveHealthHud(snapshot, context = {}, page = {}) {
    liveHealthSnapshot = snapshot;
    if (!liveHealthSettings.enabled || currentChatId().endsWith(':home')) { if (liveHealthHost) liveHealthHost.dataset.visible = '0'; return; }
    const host = ensureLiveHealthHud(); const shadow = liveHealthShadow;
    const capacityAttention = ['watch','handoff','reached'].includes(snapshot.capacity?.state || '');
    host.dataset.visible = snapshot.state === 'healthy' && !capacityAttention && liveHealthSettings.showHealthy === false ? '0' : '1';
    host.dataset.corner = liveHealthSettings.corner || 'bottom-right'; host.dataset.density = liveHealthSettings.density || 'compact'; host.dataset.level = snapshot.level || 'healthy'; host.dataset.state = snapshot.state || 'healthy';
    if(outputCompareHost?.isConnected)syncConstellationDock();
    const now = Date.now();
    setHealthText(shadow, 'pcHealthTitle', snapshot.title || 'Chat health');
    setHealthText(shadow, 'pcHealthDetail', snapshot.detail || '');
    const chips = (snapshot.chips || []).map(String);
    const chipSignature = chips.join('|');
    if (host.dataset.chipSignature !== chipSignature) {
      host.dataset.chipSignature = chipSignature;
      const fragment = document.createDocumentFragment();
      for (const value of chips) { const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = value; fragment.appendChild(chip); }
      shadow.getElementById('pcHealthChips').replaceChildren(fragment);
    }
    setHealthText(shadow, 'pcHealthProgress', ageText(snapshot.progressAgeMs || 0));
    const network = context.network || {};
    const auxiliaryPending = Math.max(0, Number(network.auxiliaryPending || 0));
    const activeRequests = Number(network.pending || 1);
    const networkText = snapshot.networkActive ? `${activeRequests} agent request${activeRequests === 1 ? '' : 's'}${auxiliaryPending ? ` · ${auxiliaryPending} site` : ''}${snapshot.networkProgressAgeMs >= 1000 ? ` · ${ageText(snapshot.networkProgressAgeMs)}` : ''}` : auxiliaryPending ? `${auxiliaryPending} site background` : network.observed ? 'quiet' : 'DOM only';
    setHealthText(shadow, 'pcHealthNetwork', networkText);
    const activity = snapshot.activity || null;
    const activityKind = activity?.kind === 'tool' ? (activity.phase || 'tool') : activity?.kind === 'model' ? (activity.phase || 'model') : snapshot.state === 'blocked-approval' ? 'approval' : snapshot.state === 'paused' ? 'paused' : 'model';
    setHealthText(shadow, 'pcHealthActivity', activityKind);
    setHealthText(shadow, 'pcHealthTool', activity?.kind === 'tool' ? `${activity.entryCount || 1} step${Number(activity.entryCount || 1) === 1 ? '' : 's'} · ${ageText(activity.ageMs || 0)}` : '—');
    const miniParts = [];
    if (activity?.kind === 'tool') miniParts.push(activity.label || activity.phase || 'tool', ageText(activity.ageMs || 0));
    else miniParts.push(snapshot.state === 'working' ? 'model active' : snapshot.state.replaceAll('-', ' '));
    miniParts.push(snapshot.networkActive ? `${network.pending || 1} live request${Number(network.pending || 1) === 1 ? '' : 's'}` : `last proof ${ageText(snapshot.progressAgeMs || 0)}`);
    setHealthText(shadow, 'pcHealthMini', miniParts.filter(Boolean).join(' · '));

    const networkEvents = networkActivityEvents(network);
    const events = [...networkEvents, ...liveActivityLedger].filter((row) => Number(row.at || 0) >= routeStartedAt - 2000).sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
    const uniqueEvents = [...new Map(events.map((row) => [row.key || `${row.kind}:${row.label}:${row.at}`, row])).values()];
    renderActivityTimeline(host, shadow, uniqueEvents, now);
    const activeRequest = (Array.isArray(network.inflight) ? network.inflight : []).at(-1);
    const newest = uniqueEvents[0] || null;
    const nowTitle = activity?.kind === 'tool' && activity.label ? activity.label : snapshot.networkActive && activeRequest?.category ? `${activeRequest.category} in progress` : newest?.label || snapshot.title || 'Monitoring this chat';
    const nowAt = activity?.kind === 'tool' ? now - Number(activity.ageMs || 0) : activeRequest?.startedAt || newest?.at || now - Number(snapshot.progressAgeMs || 0);
    const nowDetail = activity?.kind === 'tool' ? `${activity.phase || 'tool'} · ${activity.entryCount || 1} observed step${Number(activity.entryCount || 1) === 1 ? '' : 's'}${snapshot.networkActive ? ` · ${network.pending || 1} live request${Number(network.pending || 1) === 1 ? '' : 's'}` : ' · DOM proof only'}` : snapshot.networkActive ? `${network.pending || 1} categorized provider request${Number(network.pending || 1) === 1 ? '' : 's'} in flight` : newest?.detail || snapshot.detail;
    setHealthText(shadow, 'pcHealthNowTitle', nowTitle);
    setHealthText(shadow, 'pcHealthNowDetail', nowDetail);
    setHealthText(shadow, 'pcHealthNowTime', ageText(Math.max(0, now - Number(nowAt || now))));
    const proofKinds = [...new Set((snapshot.proof?.sources || []).map((row) => row.kind).filter(Boolean))];
    setHealthText(shadow, 'pcHealthProof', `${String(snapshot.proof?.certainty || 'limited').toUpperCase()} observable confidence${proofKinds.length ? ` · ${proofKinds.join(' + ')}` : ''}`);

    setHealthText(shadow, 'pcHealthProject', context.baseline?.latestVersion ? `v${context.baseline.latestVersion}${snapshot.projectRisk ? ' · risk' : ''}` : snapshot.projectRisk ? 'attention' : 'tracked');
    setHealthText(shadow, 'pcHealthPage', page.outputRegression?.active ? 'output missing' : page.renderDegraded ? 'degraded' : page.catalogAhead ? 'behind' : page.atBottom ? 'current' : 'browsing history');
    const capacity = snapshot.capacity || {};
    const turns = Number(capacity.turnCount || 0);
    setHealthText(shadow, 'pcHealthCapacity', capacity.state === 'reached' ? 'provider limit' : capacity.state === 'handoff' ? `${turns || 'large'} turns · secure` : capacity.state === 'watch' ? `${turns || 'large'} turns · watch` : turns ? `${turns} turns · clear` : 'clear');
    setHealthText(shadow, 'pcHealthHandoffState', capacity.recommendedAction === 'handoff' ? 'checkpoint now' : 'armed');
    const branchUrgent = ['handoff','reached'].includes(capacity.state) ? '1' : '0'; const branchTitle = capacity.state === 'reached' ? 'Provider limit reached — branch into a linked continuation chat' : capacity.state === 'handoff' ? 'Capacity threshold reached — branch safely before the chat breaks' : 'Branch early into a linked continuation chat';
    for (const branch of [shadow.getElementById('pcHealthBranch'), shadow.getElementById('pcHealthBranchQuick')]) { branch.dataset.urgent = branchUrgent; branch.title = branchTitle; }
    const vaultUrgent = page.outputRegression?.active ? '1' : '0'; const vaultTitle = page.outputRegression?.active ? `Saved output is missing · ${page.outputRegression.detail || 'open Output Vault to recover it'}` : 'Open every saved response, file, link, code block, and media output';
    for (const vault of [shadow.getElementById('pcHealthVault'),shadow.getElementById('pcHealthVaultQuick')]) { vault.dataset.urgent=vaultUrgent; vault.title=vaultTitle; }
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
      const observedRegression = await maybeObserveOutputIntegrity().catch(() => null);
      if (observedRegression) context.chat = { ...(context.chat || {}), outputRegression:observedRegression };
      const page = pageHealthEvidence(context);
      const capacity = conversationCapacityEvidence(context);
      const snapshot = health.deriveHealth({ now:Date.now(), settings:liveHealthSettings, chatStatus:lastStatus, running:lastStatus==='running', network:context.network || {}, tool, page, capacity, integrityFindings:context.integrityFindings || [], baselineVersion:context.baseline?.latestVersion || '', lastTurnProgressAt:healthEvidence.lastTurnProgressAt, lastDomProgressAt:healthEvidence.lastDomProgressAt, lastStatusChangeAt:healthEvidence.lastStatusChangeAt });
      const prior = healthEvidence.lastHealthState || '';
      const activitySignature = hashText(`${snapshot.state}|${snapshot.level}|${snapshot.activity?.kind || ''}|${snapshot.activity?.phase || ''}|${snapshot.activity?.label || ''}|${snapshot.activity?.entryCount || 0}|${snapshot.networkActive ? 1 : 0}`);
      if (prior !== snapshot.state || activitySignature !== healthEvidence.lastHealthActivitySignature) {
        noteLiveActivity(['warning','danger','critical'].includes(snapshot.level) ? 'warning' : 'health', snapshot.title, snapshot.detail, 'health:current');
        healthEvidence.lastHealthState = snapshot.state;
        healthEvidence.lastHealthActivitySignature = activitySignature;
        sendBrain('CHAT_UPSERT', { id:currentChatId(), providerId:provider.id, url:location.href, liveHealthState:snapshot.state, liveHealthLevel:snapshot.level, liveHealthTitle:snapshot.title, liveHealthDetail:snapshot.detail, liveHealthActivityKind:snapshot.activity?.kind || '', liveHealthActivityPhase:snapshot.activity?.phase || '', liveHealthActivityLabel:snapshot.activity?.label || '', liveHealthToolSteps:Number(snapshot.activity?.entryCount || 0), liveHealthNetworkActive:Boolean(snapshot.networkActive), liveHealthProgressAgeMs:Number(snapshot.progressAgeMs || 0), liveHealthUpdatedAt:Date.now(), updatedAt:Date.now() });
      }
      renderLiveHealthHud(snapshot, context, page);
    } finally { liveHealthPollBusy = false; }
  }

  function scheduleLiveHealthPulse(delay) {
    if (liveHealthTimer) clearTimeout(liveHealthTimer);
    if (!liveHealthSettings.enabled) { if (liveHealthHost) liveHealthHost.dataset.visible = '0'; return; }
    const active = ['running','blocked-approval','paused','refresh-required','rate-limited','stalled'].includes(lastStatus) || ['working','tool-running','tool-quiet','tool-stalled','tool-dead','quiet-working','request-stalled','stalled','dead','output-regressed'].includes(liveHealthSnapshot?.state || '') || Boolean(outputCompareSummary?.active);
    const pressureDelay = metrics.lastPressure === 'high' ? 5000 : 0;
    const nextDelay = delay ?? (document.hidden ? 30000 : active ? liveHealthSettings.pollActiveMs : liveHealthSettings.pollIdleMs);
    liveHealthTimer = setTimeout(() => { liveHealthTimer = 0; updateLiveHealth().finally(() => scheduleLiveHealthPulse()); }, Math.max(900, pressureDelay, Number(nextDelay || 2500)));
  }

  const ACTIVE_TOOL_LABEL_PATTERN = /\b(searching|retrieving|fetching|reading|browsing|running|executing|building|verifying|updating|creating|uploading|downloading|processing|calling|generating)\b/i;
  const FINISHED_TOOL_LABEL_PATTERN = /\b(searched|retrieved|fetched|read|browsed|checked|analyzed|ran|executed|built|verified|updated|edited|wrote|created|uploaded|downloaded|processed|called|used|completed|finished)\b/i;

  function latestAssistantCompletionEvidence() {
    const turns = turnNodes(document);
    const assistants = turns.filter((node) => roleForTurn(node) === 'assistant');
    const latest = assistants.at(-1) || null;
    if (!latest) return { hasAssistant:false, finalControls:false, textLength:0 };
    const controls = [...latest.querySelectorAll?.('button,[role="button"]') || []];
    const finalControls = controls.some((node) => /^(copy|read aloud|good response|bad response|share|regenerate|retry)/i.test(elementLabel(node, 120)))
      || Boolean(latest.querySelector?.('[data-testid*="copy" i],[data-testid*="feedback" i],[data-testid*="regenerate" i]'));
    return { hasAssistant:true, finalControls, textLength:turnTextOf(latest, 200000).length };
  }

  function activeGenerationEvidence(tool = null) {
    const scope = document.querySelector('main') || document;
    const stopSelectors = '[data-testid="stop-button"],[data-testid*="stop" i],button[aria-label*="stop generating" i],button[aria-label*="stop streaming" i],button[aria-label*="stop response" i],button[aria-label*="cancel generation" i],button[aria-label*="cancel response" i]';
    const stopControl = [...document.querySelectorAll(stopSelectors)].find(isUsableControl) || null;
    // Only count explicit live-state markers here. Visual shimmer classes can remain mounted
    // after a tool step has finished and were the source of false "still running" states.
    const streamingNode = scope.querySelector?.('[data-is-streaming="true"],[data-testid*="streaming" i],[data-state="streaming" i],.result-streaming,[class*="result-streaming" i]') || null;
    const busyNode = scope.querySelector?.('[aria-busy="true"],[data-state="loading" i],[data-state="pending" i],[data-loading="true"]') || null;
    const toolEvidence = tool || detectToolEvidence(true);
    const completion = latestAssistantCompletionEvidence();
    const label = String(toolEvidence?.label || '');
    // Present-tense tool labels such as "Searching Google Drive ..." are strong live
    // evidence. Deliberately exclude broad verbs such as "working"/"implementing"
    // because historical tool cards can retain those words indefinitely.
    const progressiveTool = Boolean(toolEvidence?.present && !completion.finalControls && ACTIVE_TOOL_LABEL_PATTERN.test(label) && !FINISHED_TOOL_LABEL_PATTERN.test(label));
    const toolBusy = Boolean(toolEvidence?.busy && !completion.finalControls && (busyNode || stopControl || streamingNode || progressiveTool));
    const active = Boolean(stopControl || streamingNode || busyNode || toolBusy || progressiveTool);
    return {
      active,
      stopControl:Boolean(stopControl),
      streaming:Boolean(streamingNode),
      busyNode:Boolean(busyNode),
      toolBusy,
      progressiveTool,
      toolLabel:brain.normalizeText(label, 140),
      finalControls:Boolean(completion.finalControls),
      hasAssistant:Boolean(completion.hasAssistant),
      assistantTextLength:Number(completion.textLength || 0)
    };
  }

  function liveChatState() {
    detectStatus();
    const tool = detectToolEvidence(true);
    const generation = activeGenerationEvidence(tool);
    const healthState = String(liveHealthSnapshot?.state || '');
    const healthActive = ['working','tool-running','tool-quiet','quiet-working'].includes(healthState);
    const healthStale = ['refresh-required','rate-limited','blocked-approval','auth-required','unavailable','stalled','dead','request-stalled','tool-stalled','tool-dead','degraded','stale-page'].includes(healthState);
    let observedStatus = lastStatus;
    if ((generation.active || healthActive) && !['refresh-required','rate-limited','blocked-approval','auth-required','unavailable','errored','stalled'].includes(observedStatus)) observedStatus = 'running';
    const turns = turnNodes(document);
    const hasConversation = turns.length > 0 || !currentChatId().endsWith(':home');
    return {
      ok:true,
      provider:{ id:provider.id, name:provider.name },
      chat:{ id:currentChatId(), status:observedStatus, rawStatus:lastStatus, title:document.title || provider.name, url:location.href, lastActivityAt:lastSemanticActivityAt, hasConversation, turnCount:turns.length, healthState, health:liveHealthSnapshot ? { ...liveHealthSnapshot } : null },
      generation,
      tool:{ present:Boolean(tool?.present), busy:Boolean(tool?.busy), label:brain.normalizeText(tool?.label || '', 140), phase:brain.normalizeText(tool?.phase || '', 60), lastProgressAt:Number(tool?.lastProgressAt || 0) },
      healthActive,
      healthStale,
      observedAt:Date.now(),
      hidden:document.hidden
    };
  }

  function detectStatus() {
    const statusText = boundedStatusText();
    const lower = statusText.toLowerCase();
    const generation = activeGenerationEvidence(detectToolEvidence(true));
    const signals = {
      text: statusText,
      running: generation.active || /stop generating|stop response|cancel generation|generating|thinking|reasoning/.test(lower),
      paused: /continue generating|resume generation|resume response/.test(lower),
      approval: provider.id === 'chatgpt' && (Boolean(approvalSurface()) || /(allow|approve|permission|confirm).{0,180}(drive|github|connector|connected app|plugin|access|tool|use|continue)/.test(lower)),
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
      noteLiveActivity(['errored','stalled','refresh-required','rate-limited','auth-required','unavailable'].includes(next) ? 'warning' : 'status', `Chat status · ${next.replaceAll('-', ' ')}`, next === 'running' ? 'The page exposes an active generation signal' : 'Observable page status changed', 'status:current', healthEvidence.lastStatusChangeAt);
      sendBrain('STATUS_EVENT', { providerId: provider.id, chatId: currentChatId(), status: next, detail: statusText.slice(0, 1200), url: location.href, approvalConnector: signals.approval ? connectorNameFromApproval(approvalSurface()) : '', recoveryKind: signals.refreshRequired ? 'browser-refresh' : signals.rateLimited ? 'provider-cooldown' : '', retryForbidden: Boolean(signals.refreshRequired || signals.rateLimited), rateLimitWaitMs: signals.rateLimited ? rateLimitWaitMs(statusText) : 0, updatedAt: Date.now() });
      chrome.runtime.sendMessage({ type:'PC_LIVE_CHAT_STATE_PUSH', state:{ status:next, generation, chat:{ id:currentChatId(), status:next, rawStatus:next, title:document.title || provider.name, url:location.href, lastActivityAt:lastSemanticActivityAt, healthState:String(liveHealthSnapshot?.state || '') } } }).catch(() => {});
      if (signals.refreshRequired) chrome.runtime.sendMessage({ type: 'PC_REFRESH_RECOVERY_REQUEST', chatId: currentChatId(), url: location.href, detail: statusText.slice(0, 600) }).catch(() => {});
    } else if (next === 'running') {
      sendBrain('STATUS_HEARTBEAT', { providerId: provider.id, chatId: currentChatId(), status: next, lastActivityAt: lastSemanticActivityAt, url: location.href, updatedAt: Date.now() });
    }
    return lastStatus;
  }

  function processCaptureQueue() {
    captureHandle = 0; captureHandleKind = '';
    if (document.hidden) return;
    const roots = pendingRoots.size ? [...pendingRoots] : [document];
    pendingRoots.clear();
    const constrained = metrics.lastPressure === 'high';
    for (const scope of roots.slice(0, constrained ? 12 : 40)) {
      if (!constrained) scanChats(scope);
      scanTurns(scope);
      if (!constrained) scanFiles(scope);
    }
    const statusDueMs = lastStatus === 'running' ? 900 : 2200;
    if (!healthEvidence.lastStatusScanAt || Date.now() - healthEvidence.lastStatusScanAt >= statusDueMs) {
      healthEvidence.lastStatusScanAt = Date.now(); detectStatus();
    }
    if (lastStatus !== 'running') queueMicrotask(() => maybeObserveOutputIntegrity().catch(() => {}));
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
          if (mutation.target.matches?.('[data-testid*="tool" i],[aria-label*="tool" i],[class*="tool" i],.loading-shimmer-tertiary,[class*="text-token-text-tertiary"],[aria-busy],[data-state]')) toolEvidenceDirty = true;
        }
        for (const node of mutation.addedNodes) if (node instanceof Element) {
          scheduleCapture(node);
          if (node.matches?.('[data-testid*="tool" i],[aria-label*="tool" i],[class*="tool" i],.loading-shimmer-tertiary,[class*="text-token-text-tertiary"],[aria-busy],[data-state]') || node.querySelector?.('[data-testid*="tool" i],[aria-label*="tool" i],[class*="tool" i],.loading-shimmer-tertiary,[class*="text-token-text-tertiary"],[aria-busy],[data-state]')) toolEvidenceDirty = true;
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
    healthEvidence.lastTurnProgressAt = routeStartedAt; healthEvidence.lastDomProgressAt = routeStartedAt; healthEvidence.lastStatusChangeAt = routeStartedAt; healthEvidence.latestMountedTurn = null; healthEvidence.lastToolHash = ''; healthEvidence.lastToolProgressAt = 0; healthEvidence.lastToolStartedAt = 0; healthEvidence.lastToolEntryCount = 0; healthEvidence.lastToolSignature = ''; healthEvidence.lastToolLabel = ''; healthEvidence.lastHealthActivitySignature = ''; lastToolEvidence = null; lastToolScanAt = 0; toolEvidenceDirty = true; liveActivityLedger.length = 0; outputCompareSummary = null; lastOutputObservationFingerprint = ''; lastOutputObservationAt = 0; closeOutputVault();
    seenTurnHashes.clear(); seenTurnLengths.clear(); seenTurnTextChars = 0; seenFileHashes.clear(); embeddedMediaQueued.clear();
    schedulePersist();
    sendBrain('ROUTE_EVENT', { providerId: provider.id, chatId: currentChatId(), url: location.href, title: document.title, updatedAt: Date.now() });
    noteLiveActivity('route', 'Conversation route changed', 'Capture and health evidence reset for this page', 'route:current', routeStartedAt);
    resolveBranchLineage().catch(() => {});
    scheduleCapture(document);
    scheduleApprovalAutopilotScan(180);
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
      const stored = await chrome.storage.local.get([STORAGE_KEY, BRAIN_SETTINGS_KEY, PULSE_UX_KEY]);
      configure(stored?.[STORAGE_KEY]);
      approvalSettings = { ...approvalSettings, ...(stored?.[BRAIN_SETTINGS_KEY]?.approvalAutopilot || {}) };
      liveHealthSettings = health.normalizeSettings({ ...liveHealthSettings, ...(stored?.[BRAIN_SETTINGS_KEY]?.liveHealth || {}) });
      pulseUxSettings = { ...pulseUxSettings, ...(stored?.[PULSE_UX_KEY] || {}) };
    } catch (_) { configure(); }
  }

  let manualCaptureCommand = 'run';
  let manualAsyncRunner = null;

  async function drainBrainOutbox() {
    if (brainFlushTimer) { clearTimeout(brainFlushTimer); brainFlushTimer = 0; }
    while (brainOutbox.length) {
      const batch = brainOutbox.splice(0, 120);
      await chrome.runtime.sendMessage({ type: 'PC_BRAIN_INGEST_BATCH', payload: batch.map(({ type, data }) => ({ type, data })) }).catch(() => {});
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
    const live = liveChatState();
    return {
      provider: { id: provider.id, name: provider.name }, settings: { ...settings }, metrics: { ...metrics }, pressure: pressure.tick(), chat: { ...live.chat }, live,
      capabilities: { longTaskObserver: Boolean(PerformanceObserver?.supportedEntryTypes?.includes('longtask')), navigationApi: Boolean(globalThis.navigation?.addEventListener), constellationCapture: true, zeroTabCatalog: true, manualFullCapture: true, liveHealthHud: true, passiveNetworkHealth: true, conversationCapacityGuard: true, safeHandoff: true, outputVault:true, outputRevisionRecovery:true, liveTabPulse:true }
    };
  }

  function scheduleStatusPulse(delay) {
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      statusTimer = 0;
      detectStatus();
      maybeObserveOutputIntegrity().catch(() => {});
      const activeNow = lastStatus === 'running' || ['working','tool-running','tool-quiet','quiet-working'].includes(String(liveHealthSnapshot?.state || ''));
      scheduleStatusPulse(document.hidden ? (activeNow ? 3500 : 30000) : (activeNow ? 1400 : 8000));
    }, delay ?? (document.hidden ? 30000 : 8000));
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes[STORAGE_KEY]) configure(changes[STORAGE_KEY].newValue);
    if (changes[PULSE_UX_KEY]) pulseUxSettings = { ...pulseUxSettings, ...(changes[PULSE_UX_KEY].newValue || {}) };
    if (changes[BRAIN_SETTINGS_KEY]) {
      approvalSettings = { ...approvalSettings, ...(changes[BRAIN_SETTINGS_KEY].newValue?.approvalAutopilot || {}) };
      liveHealthSettings = health.normalizeSettings({ ...liveHealthSettings, ...(changes[BRAIN_SETTINGS_KEY].newValue?.liveHealth || {}) });
      if (liveHealthHost) { liveHealthHost.dataset.corner = liveHealthSettings.corner; liveHealthHost.dataset.density = liveHealthSettings.density; liveHealthHost.dataset.visible = liveHealthSettings.enabled ? '1' : '0'; }
      scheduleLiveHealthPulse(100);
      if (approvalSettings.enabled && approvalSettings.acknowledged && provider.id === 'chatgpt') {
        scheduleApprovalAutopilotScan(40);
        queueMicrotask(() => detectStatus());
      }
    }
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'PC_GET_STATUS') { detectStatus(); sendResponse(publicStatus()); return false; }
    if (message?.type === 'PC_GET_LIVE_CHAT_STATE') { sendResponse(liveChatState()); return false; }
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
    // Re-sample before going quiet so a response that started just before the user
    // switched tabs is not left classified as idle for the next 30 seconds.
    detectStatus();
    if (document.hidden) { stopPerformanceObserver(); captureObserver?.disconnect(); cancelCapture(); }
    else { if (settings.enabled) startPerformanceObserver(); applyPressure(pressure.tick()); setupCaptureObserver(); }
    const activeNow = lastStatus === 'running' || ['working','tool-running','tool-quiet','quiet-working'].includes(String(liveHealthSnapshot?.state || ''));
    scheduleStatusPulse(document.hidden ? (activeNow ? 1800 : 12000) : 500);
    scheduleLiveHealthPulse(document.hidden ? (activeNow ? 3500 : 30000) : 700);
  }, { passive: true });

  setupNavigationTracking();
  setupCaptureObserver();
  setupApprovalObserver();
  loadSettings().then(() => scheduleApprovalAutopilotScan(120));
  sendBrain('PROVIDER_SEEN', { id: provider.id, name: provider.name, home: provider.home, host: location.hostname, updatedAt: Date.now() });
  sendBrain('ROUTE_EVENT', { providerId: provider.id, chatId: currentChatId(), url: location.href, title: document.title, updatedAt: Date.now() });
  scheduleStatusPulse(1800);
  scheduleLiveHealthPulse(2200);
  setTimeout(() => resumePendingBranch().catch(() => {}), 900);
  setTimeout(() => resolveBranchLineage().catch(() => {}), 1600);

  window.addEventListener('pagehide', () => {
    stopPerformanceObserver(); captureObserver?.disconnect(); approvalObserver?.disconnect(); navCleanup?.(); closeOutputVault();
    if (recoveryTimer) clearTimeout(recoveryTimer); if (statusTimer) clearTimeout(statusTimer); if (liveHealthTimer) clearTimeout(liveHealthTimer); if (approvalAutopilotTimer) clearTimeout(approvalAutopilotTimer);
    cancelCapture(); cancelPendingPersist(); flushBrainOutbox();
    chrome.storage.local.set({ [METRICS_KEY]: { ...metrics } }).catch(() => {});
  }, { once: true });
})();
