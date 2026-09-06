(() => {
  'use strict';

  const VERSION = 1;
  const VAULT_KEY = 'projectConstellationChatVaultV1';
  const DECORATIONS_KEY = 'projectConstellationChatDecorationsV1';
  const ONETAB_EXTENSION_ID = 'chphlpgkkbolifaimnlloiipkdnihall';
  const ONETAB_IMPORT_URL = `chrome-extension://${ONETAB_EXTENSION_ID}/onetab.html`;

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
      note:'',
      tags:[]
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
      note:clean(input.note || '', 2000),
      tags:[...new Set((Array.isArray(input.tags) ? input.tags : []).map((tag) => clean(tag, 60)).filter(Boolean))].slice(0,24)
    };
  }

  function normalizeStack(input = {}, index = 0) {
    const createdAt = Math.max(0, Number(input.createdAt || now()));
    const items = [];
    const seen = new Set();
    for (const raw of Array.isArray(input.items) ? input.items : []) {
      const item = normalizeItem(raw);
      if (!item) continue;
      if (seen.has(item.key)) continue;
      seen.add(item.key);
      items.push(item);
    }
    return {
      id:clean(input.id || `stack:${createdAt}:${index}:${Math.random().toString(36).slice(2,8)}`, 220),
      name:clean(input.name || `Chat stack ${index + 1}`, 120),
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
    const stack = normalizeStack({
      id:options.id || `stack:${stamp}:${Math.random().toString(36).slice(2,9)}`,
      name:clean(name || 'Saved chats', 120),
      color:options.color || SAFE_COLORS[Math.abs(stamp) % SAFE_COLORS.length],
      createdAt:stamp,
      updatedAt:stamp,
      items
    });
    return stack;
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

  function moveItem(vaultInput, itemId, fromStackId, toStackId) {
    const vault = normalizeVault(vaultInput);
    if (!itemId || !fromStackId || !toStackId || fromStackId === toStackId) return vault;
    const from = vault.stacks.find((stack) => stack.id === fromStackId);
    const to = vault.stacks.find((stack) => stack.id === toStackId);
    if (!from || !to) return vault;
    const index = from.items.findIndex((item) => item.id === itemId);
    if (index < 0) return vault;
    const [item] = from.items.splice(index,1);
    if (!to.items.some((row) => row.key === item.key)) to.items.unshift({ ...item, updatedAt:now() });
    from.updatedAt = to.updatedAt = vault.updatedAt = now();
    return vault;
  }

  function oneTabText(items = []) {
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

  function parseOneTabText(value) {
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

  function decorationKey(value) {
    return chatKey(value);
  }

  function stackCount(vaultInput) {
    const vault = normalizeVault(vaultInput);
    return vault.stacks.reduce((sum, stack) => sum + stack.items.length, 0);
  }

  const api = Object.freeze({
    VERSION, VAULT_KEY, DECORATIONS_KEY, ONETAB_EXTENSION_ID, ONETAB_IMPORT_URL,
    PROVIDERS, STYLE_VALUES, SAFE_COLORS,
    clean, parseUrl, providerForUrl, canonicalUrl, conversationId, chatKey, decorationKey, isSupportedChatUrl,
    tabToItem, normalizeDecoration, normalizeDecorations, normalizeItem, normalizeStack, normalizeVault, emptyVault,
    createStack, addStack, removeStack, moveItem, oneTabText, parseOneTabText, stackCount
  });
  globalThis.ProjectConstellationChatVaultCore = api;
})();
