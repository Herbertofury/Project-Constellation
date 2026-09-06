(() => {
  'use strict';

  const VERSION = 2;
  // Keep the v1 storage key so existing Chat Vault stacks migrate in place.
  const VAULT_KEY = 'projectConstellationChatVaultV1';
  const DECORATIONS_KEY = 'projectConstellationChatDecorationsV1';
  const COMMAND_CENTER_PREFS_KEY = 'projectConstellationChatCommandCenterPrefsV1';
  const LIVE_PROJECT_NAME = 'Live AI Sessions';

  const PROVIDERS = Object.freeze([
    { id:'chatgpt', name:'ChatGPT', hosts:['chatgpt.com','chat.openai.com'], conversation:/\/c\/([^/?#]+)/i },
    { id:'claude', name:'Claude', hosts:['claude.ai'] },
    { id:'gemini', name:'Gemini', hosts:['gemini.google.com'] },
    { id:'grok', name:'Grok', hosts:['grok.com'] },
    { id:'deepseek', name:'DeepSeek', hosts:['chat.deepseek.com'] },
    { id:'perplexity', name:'Perplexity', hosts:['perplexity.ai','www.perplexity.ai'] },
    { id:'copilot', name:'Microsoft Copilot', hosts:['copilot.microsoft.com'] },
    { id:'mistral', name:'Le Chat', hosts:['chat.mistral.ai'] },
    { id:'poe', name:'Poe', hosts:['poe.com'] },
    { id:'metaai', name:'Meta AI', hosts:['meta.ai','www.meta.ai'] },
    { id:'qwen', name:'Qwen Chat', hosts:['chat.qwen.ai'] },
    { id:'kimi', name:'Kimi', hosts:['kimi.com','www.kimi.com'] },
    { id:'characterai', name:'Character.AI', hosts:['character.ai','www.character.ai'] },
    { id:'huggingchat', name:'HuggingChat', hosts:['huggingface.co'] },
    { id:'you', name:'You.com', hosts:['you.com','www.you.com'] },
    { id:'pi', name:'Pi', hosts:['pi.ai','www.pi.ai'] },
    { id:'duckai', name:'Duck.ai', hosts:['duck.ai'] }
  ]);

  const STYLE_VALUES = Object.freeze(['clean','bold','serif','italic','mono','wide','glow','soft']);
  const SAFE_COLORS = Object.freeze(['#8b5cf6','#6d9dfc','#45bd8c','#e0a458','#ef6b73','#d46bed','#63c7c2','#f59e0b','#a3a3a3']);
  const LIVE_STATES = Object.freeze(['running','watching','blocked','stalled','dead','done','offline']);
  const ATTENTION_STATES = Object.freeze(['blocked','stalled','dead']);
  const LIVE_PRIORITY = Object.freeze({ dead:0, stalled:1, blocked:2, running:3, watching:4, done:5, offline:6 });

  const now = () => Date.now();
  const clean = (value, max = 240) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

  function parseUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return /^https?:$/.test(url.protocol) ? url : null;
    } catch (_) { return null; }
  }

  function providerForUrl(value) {
    const url = parseUrl(value);
    if (!url) return null;
    const host = url.hostname.toLowerCase();
    return PROVIDERS.find((provider) => provider.hosts.includes(host)) || null;
  }

  function canonicalUrl(value) {
    const url = parseUrl(value);
    if (!url) return '';
    url.hash = '';
    const provider = providerForUrl(url.href);
    if (provider?.id === 'chatgpt') {
      const match = url.pathname.match(provider.conversation);
      if (match?.[1]) return `${url.origin}/c/${match[1]}`;
    }
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref$|referrer$|source$|share$)/i.test(key)) url.searchParams.delete(key);
    }
    return url.href.replace(/\/$/, '');
  }

  function conversationId(value) {
    const url = parseUrl(value);
    if (!url) return '';
    const provider = providerForUrl(url.href);
    if (!provider) return '';
    if (provider.id === 'chatgpt') return clean(url.pathname.match(provider.conversation)?.[1] || '', 180);
    return '';
  }

  function chatKey(value) {
    const canonical = canonicalUrl(value);
    if (!canonical) return '';
    const provider = providerForUrl(canonical);
    const id = conversationId(canonical);
    return id ? `${provider?.id || 'chat'}:${id}` : `${provider?.id || 'chat'}:${canonical}`;
  }

  function isSupportedChatUrl(value) {
    const provider = providerForUrl(value);
    if (!provider) return false;
    const url = parseUrl(value);
    if (!url) return false;
    if (provider.id === 'chatgpt') return Boolean(conversationId(value));
    if (provider.id === 'huggingchat') return url.pathname.startsWith('/chat/');
    return url.pathname !== '/' || Boolean(url.search);
  }

  function normalizeLive(input = {}) {
    const state = LIVE_STATES.includes(String(input.state || '')) ? String(input.state) : 'offline';
    return {
      state,
      label:clean(input.label || (state === 'offline' ? 'Saved' : state), 100),
      tone:clean(input.tone || state, 40),
      detail:clean(input.detail || '', 500),
      activity:clean(input.activity || '', 220),
      healthState:clean(input.healthState || '', 100),
      bucket:clean(input.bucket || '', 40),
      tabId:Math.max(0, Number(input.tabId || 0)),
      windowId:Math.max(0, Number(input.windowId || 0)),
      observedAt:Math.max(0, Number(input.observedAt || 0)),
      lastActivityAt:Math.max(0, Number(input.lastActivityAt || 0)),
      pending:Math.max(0, Number(input.pending || 0)),
      open:Boolean(input.open),
      attention:Boolean(input.attention || ATTENTION_STATES.includes(state)),
      retryAvailable:Boolean(input.retryAvailable),
      failureTitle:clean(input.failureTitle || '', 180)
    };
  }

  function livePresentation(row = {}, stamp = now()) {
    const healthState = clean(row.healthState || row?.chat?.healthState || '', 100).toLowerCase();
    const rawStatus = clean(row.status || row.rawStatus || row?.chat?.status || '', 100).toLowerCase();
    const bucket = clean(row.bucket || '', 40).toLowerCase();
    const failure = row?.failure?.active ? row.failure : row?.chat?.failure?.active ? row.chat.failure : null;
    const generation = row?.generation || {};
    const context = row?.context || {};
    const pending = Math.max(0, Number(row?.network?.pending || row.pending || 0));
    const lastActivityAt = Math.max(0, Number(row.lastActivityAt || row.observedAt || stamp));
    const activity = clean(
      context.liveActivity || context.taskHint || generation.label || generation.phase || row.activity || row.activityLabel || '',
      220
    );

    const deadStates = new Set(['dead','tool-dead']);
    const stalledStates = new Set(['stalled','tool-stalled','request-stalled']);
    const blockedStates = new Set([
      'paused','errored','delivery-timeout','connection-interrupted','response-interrupted','send-failed',
      'project-rollback','old-project-version','regression-risk','project-conflict','follow-up'
    ]);
    const watchingStates = new Set(['tool-quiet','quiet-working','uncertain-working']);

    let state = 'offline';
    let label = 'Saved';
    let tone = 'offline';
    let detail = 'Saved in Project Constellation. Open the chat to resume live monitoring.';

    if (failure) {
      state = 'blocked';
      label = 'Blocked';
      tone = 'blocked';
      detail = clean(failure.title || failure.detail || 'The provider reported a recoverable failure.', 500);
    } else if (deadStates.has(healthState) || deadStates.has(rawStatus)) {
      state = 'dead'; label = 'Dead'; tone = 'dead';
      detail = clean(row.healthTitle || row.healthDetail || 'No trustworthy progress signal is being observed.', 500);
    } else if (stalledStates.has(healthState) || stalledStates.has(rawStatus)) {
      state = 'stalled'; label = 'Stalled'; tone = 'stalled';
      detail = clean(row.healthTitle || row.healthDetail || 'The current turn appears active but has stopped making observable progress.', 500);
    } else if (blockedStates.has(healthState) || blockedStates.has(rawStatus)) {
      state = 'blocked'; label = healthState === 'paused' || rawStatus === 'paused' ? 'Paused' : 'Needs attention'; tone = 'blocked';
      detail = clean(row.healthTitle || row.healthDetail || 'This chat needs attention before it can continue normally.', 500);
    } else if (bucket === 'active' || row.active === true) {
      if (watchingStates.has(healthState)) {
        state = 'watching'; label = 'Watching'; tone = 'watching';
        detail = clean(row.healthTitle || row.healthDetail || 'The chat is quiet; Constellation is waiting for corroborating progress.', 500);
      } else {
        state = 'running'; label = /tool/.test(healthState) ? 'Tool running' : 'Running'; tone = 'running';
        detail = clean(row.healthTitle || row.healthDetail || (pending ? 'Provider work is still in flight.' : 'Live progress is being observed.'), 500);
      }
    } else if (bucket === 'completed' || row.completed === true || ['completed','complete','done','finished','healthy','idle'].includes(rawStatus)) {
      state = 'done'; label = 'Done'; tone = 'done';
      detail = clean(row.healthTitle || row.healthDetail || 'The current turn is complete.', 500);
    } else if (bucket === 'stale' || row.stale === true) {
      state = watchingStates.has(healthState) ? 'watching' : 'blocked';
      label = state === 'watching' ? 'Watching' : 'Needs attention';
      tone = state;
      detail = clean(row.healthTitle || row.healthDetail || 'The live tab is open but its state needs attention.', 500);
    }

    return normalizeLive({
      state, label, tone, detail, activity, healthState, bucket,
      tabId:row.tabId, windowId:row.windowId, observedAt:row.observedAt || stamp, lastActivityAt,
      pending, open:Boolean(row.tabId), attention:ATTENTION_STATES.includes(state),
      retryAvailable:Boolean(failure?.retryAvailable), failureTitle:failure?.title || ''
    });
  }

  function tabToItem(tab = {}, stamp = now()) {
    const url = canonicalUrl(tab.url || '');
    if (!url || !isSupportedChatUrl(url)) return null;
    const provider = providerForUrl(url);
    const key = chatKey(url);
    return {
      id:`item:${stamp}:${Math.random().toString(36).slice(2,10)}`,
      key,
      url,
      title:clean(tab.title || provider?.name || 'AI chat', 300),
      providerId:provider?.id || 'ai',
      providerName:provider?.name || 'AI chat',
      favIconUrl:clean(tab.favIconUrl || '', 1200),
      sourceTabId:Number(tab.id || 0),
      sourceWindowId:Number(tab.windowId || 0),
      pinned:Boolean(tab.pinned),
      createdAt:stamp,
      updatedAt:stamp,
      lastOpenedAt:0,
      lastSeenOpenAt:stamp,
      note:'',
      tags:[],
      live:normalizeLive({ state:'offline' })
    };
  }

  function normalizeDecoration(input = {}) {
    const style = STYLE_VALUES.includes(String(input.style || '')) ? String(input.style) : 'clean';
    const color = /^#[0-9a-f]{6}$/i.test(String(input.color || '')) ? String(input.color).toLowerCase() : '';
    return {
      emoji:clean(input.emoji || '', 16),
      color,
      style,
      updatedAt:Math.max(0, Number(input.updatedAt || 0))
    };
  }

  function normalizeDecorations(input) {
    const out = {};
    if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
    for (const [key, value] of Object.entries(input)) {
      const safeKey = clean(key, 500);
      if (!safeKey) continue;
      out[safeKey] = normalizeDecoration(value);
    }
    return out;
  }

  function normalizeItem(input = {}) {
    const url = canonicalUrl(input.url || '');
    if (!url || !isSupportedChatUrl(url)) return null;
    const provider = providerForUrl(url);
    return {
      id:clean(input.id || `item:${now()}:${Math.random().toString(36).slice(2,10)}`, 220),
      key:clean(input.key || chatKey(url), 1200),
      url,
      title:clean(input.title || provider?.name || 'AI chat', 300),
      providerId:clean(input.providerId || provider?.id || 'ai', 80),
      providerName:clean(input.providerName || provider?.name || 'AI chat', 120),
      favIconUrl:clean(input.favIconUrl || '', 1200),
      sourceTabId:Math.max(0, Number(input.sourceTabId || 0)),
      sourceWindowId:Math.max(0, Number(input.sourceWindowId || 0)),
      pinned:Boolean(input.pinned),
      createdAt:Math.max(0, Number(input.createdAt || now())),
      updatedAt:Math.max(0, Number(input.updatedAt || input.createdAt || now())),
      lastOpenedAt:Math.max(0, Number(input.lastOpenedAt || 0)),
      lastSeenOpenAt:Math.max(0, Number(input.lastSeenOpenAt || 0)),
      note:clean(input.note || '', 2000),
      tags:[...new Set((Array.isArray(input.tags) ? input.tags : []).map((tag) => clean(tag, 60)).filter(Boolean))].slice(0,24),
      live:normalizeLive(input.live || {})
    };
  }

  function mergeItems(existing = [], incoming = []) {
    const out = [];
    const byKey = new Map();
    for (const raw of existing) {
      const item = normalizeItem(raw);
      if (!item || byKey.has(item.key)) continue;
      byKey.set(item.key, item);
      out.push(item);
    }
    for (const raw of incoming) {
      const item = normalizeItem(raw);
      if (!item) continue;
      const current = byKey.get(item.key);
      if (!current) {
        byKey.set(item.key, item);
        out.unshift(item);
        continue;
      }
      const merged = normalizeItem({
        ...current,
        title:item.title || current.title,
        favIconUrl:item.favIconUrl || current.favIconUrl,
        sourceTabId:item.sourceTabId || current.sourceTabId,
        sourceWindowId:item.sourceWindowId || current.sourceWindowId,
        pinned:item.pinned,
        lastSeenOpenAt:Math.max(current.lastSeenOpenAt || 0, item.lastSeenOpenAt || item.updatedAt || 0),
        updatedAt:Math.max(current.updatedAt || 0, item.updatedAt || 0),
        live:item.live?.open ? item.live : current.live,
        note:current.note,
        tags:current.tags
      });
      const index = out.findIndex((row) => row.key === item.key);
      if (index >= 0) out[index] = merged;
      byKey.set(item.key, merged);
    }
    return out;
  }

  function normalizeStack(input = {}, index = 0) {
    const createdAt = Math.max(0, Number(input.createdAt || now()));
    const items = mergeItems([], Array.isArray(input.items) ? input.items : []);
    return {
      id:clean(input.id || `stack:${createdAt}:${index}:${Math.random().toString(36).slice(2,8)}`, 220),
      name:clean(input.name || `AI project ${index + 1}`, 120),
      color:/^#[0-9a-f]{6}$/i.test(String(input.color || '')) ? String(input.color).toLowerCase() : SAFE_COLORS[index % SAFE_COLORS.length],
      collapsed:Boolean(input.collapsed),
      createdAt,
      updatedAt:Math.max(createdAt, Number(input.updatedAt || createdAt)),
      items
    };
  }

  function emptyVault() {
    return { version:VERSION, stacks:[], selectedStackId:'', recentStashId:'', updatedAt:now() };
  }

  function normalizeVault(input) {
    const source = input && typeof input === 'object' ? input : {};
    const stacks = (Array.isArray(source.stacks) ? source.stacks : []).map(normalizeStack);
    const selected = stacks.some((stack) => stack.id === source.selectedStackId) ? source.selectedStackId : (stacks[0]?.id || '');
    return {
      version:VERSION,
      stacks,
      selectedStackId:selected,
      recentStashId:stacks.some((stack) => stack.id === source.recentStashId) ? source.recentStashId : '',
      updatedAt:Math.max(0, Number(source.updatedAt || now()))
    };
  }

  function createStack(name, items = [], options = {}) {
    const stamp = Math.max(0, Number(options.createdAt || now()));
    return normalizeStack({
      id:options.id || `stack:${stamp}:${Math.random().toString(36).slice(2,9)}`,
      name:clean(name || 'AI project', 120),
      color:options.color || SAFE_COLORS[Math.abs(stamp) % SAFE_COLORS.length],
      createdAt:stamp,
      updatedAt:stamp,
      items
    });
  }

  function addStack(vaultInput, stackInput, { select = true, recent = false } = {}) {
    const vault = normalizeVault(vaultInput);
    const stack = normalizeStack(stackInput, vault.stacks.length);
    vault.stacks.unshift(stack);
    if (select) vault.selectedStackId = stack.id;
    if (recent) vault.recentStashId = stack.id;
    vault.updatedAt = now();
    return vault;
  }

  function removeStack(vaultInput, stackId) {
    const vault = normalizeVault(vaultInput);
    vault.stacks = vault.stacks.filter((stack) => stack.id !== stackId);
    if (vault.selectedStackId === stackId) vault.selectedStackId = vault.stacks[0]?.id || '';
    if (vault.recentStashId === stackId) vault.recentStashId = '';
    vault.updatedAt = now();
    return vault;
  }

  function addItemsToStack(vaultInput, stackId, items = []) {
    const vault = normalizeVault(vaultInput);
    const stack = vault.stacks.find((row) => row.id === stackId);
    if (!stack) return vault;
    stack.items = mergeItems(stack.items, items);
    stack.updatedAt = vault.updatedAt = now();
    return vault;
  }

  function ensureStack(vaultInput, name = LIVE_PROJECT_NAME, options = {}) {
    let vault = normalizeVault(vaultInput);
    let stack = vault.stacks.find((row) => row.name.toLowerCase() === clean(name,120).toLowerCase()) || null;
    if (!stack) {
      stack = createStack(name, [], { color:options.color || SAFE_COLORS[0] });
      vault = addStack(vault, stack, { select:options.select !== false });
      stack = vault.stacks.find((row) => row.id === stack.id) || vault.stacks[0];
    } else if (options.select !== false) vault.selectedStackId = stack.id;
    return { vault, stack };
  }

  function moveItem(vaultInput, itemId, fromStackId, toStackId) {
    const vault = normalizeVault(vaultInput);
    if (!itemId || !fromStackId || !toStackId || fromStackId === toStackId) return vault;
    const from = vault.stacks.find((stack) => stack.id === fromStackId);
    const to = vault.stacks.find((stack) => stack.id === toStackId);
    if (!from || !to) return vault;
    const index = from.items.findIndex((item) => item.id === itemId);
    if (index < 0) return vault;
    const [item] = from.items.splice(index,1);
    to.items = mergeItems(to.items, [item]);
    from.updatedAt = to.updatedAt = vault.updatedAt = now();
    return vault;
  }

  function urlListText(items = []) {
    const seen = new Set();
    const lines = [];
    for (const raw of items) {
      const item = normalizeItem(raw);
      if (!item || seen.has(item.key)) continue;
      seen.add(item.key);
      lines.push(`${item.url} | ${clean(item.title || item.providerName || 'AI chat', 300)}`);
    }
    return lines.join('\n');
  }

  function parseUrlList(value) {
    const stamp = now();
    const out = [];
    const seen = new Set();
    for (const raw of String(value || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const divider = line.indexOf('|');
      const urlText = divider >= 0 ? line.slice(0, divider).trim() : line.split(/\s+/)[0];
      const titleText = divider >= 0 ? line.slice(divider + 1).trim() : '';
      const url = canonicalUrl(urlText);
      if (!url || !isSupportedChatUrl(url)) continue;
      const key = chatKey(url);
      if (seen.has(key)) continue;
      seen.add(key);
      const provider = providerForUrl(url);
      out.push(normalizeItem({
        id:`item:${stamp}:${out.length}:${Math.random().toString(36).slice(2,8)}`,
        key,
        url,
        title:titleText || provider?.name || 'AI chat',
        providerId:provider?.id || 'ai',
        providerName:provider?.name || 'AI chat',
        createdAt:stamp,
        updatedAt:stamp
      }));
    }
    return out.filter(Boolean);
  }

  function applyLiveToItem(input, row = {}, stamp = now()) {
    const item = normalizeItem(input);
    if (!item) return null;
    const live = livePresentation(row, stamp);
    return normalizeItem({
      ...item,
      sourceTabId:live.tabId || item.sourceTabId,
      sourceWindowId:live.windowId || item.sourceWindowId,
      lastSeenOpenAt:live.open ? Math.max(item.lastSeenOpenAt || 0, stamp) : item.lastSeenOpenAt,
      updatedAt:Math.max(item.updatedAt || 0, stamp),
      live
    });
  }

  function decorationKey(value) {
    return chatKey(value);
  }

  function stackCount(vaultInput) {
    const vault = normalizeVault(vaultInput);
    return vault.stacks.reduce((sum, stack) => sum + stack.items.length, 0);
  }

  function stateCounts(items = []) {
    const counts = Object.fromEntries(LIVE_STATES.map((state) => [state,0]));
    for (const raw of items) {
      const item = normalizeItem(raw);
      if (!item) continue;
      counts[item.live.state] = (counts[item.live.state] || 0) + 1;
    }
    counts.attention = ATTENTION_STATES.reduce((sum,state) => sum + Number(counts[state] || 0), 0);
    return counts;
  }

  const api = Object.freeze({
    VERSION, VAULT_KEY, DECORATIONS_KEY, COMMAND_CENTER_PREFS_KEY, LIVE_PROJECT_NAME,
    PROVIDERS, STYLE_VALUES, SAFE_COLORS, LIVE_STATES, ATTENTION_STATES, LIVE_PRIORITY,
    clean, parseUrl, providerForUrl, canonicalUrl, conversationId, chatKey, decorationKey, isSupportedChatUrl,
    normalizeLive, livePresentation, tabToItem, normalizeDecoration, normalizeDecorations, normalizeItem, mergeItems,
    normalizeStack, normalizeVault, emptyVault, createStack, addStack, removeStack, addItemsToStack, ensureStack, moveItem,
    urlListText, parseUrlList, applyLiveToItem, stackCount, stateCounts
  });
  globalThis.ProjectConstellationChatVaultCore = api;
})();