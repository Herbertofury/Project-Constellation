(() => {
  'use strict';

  const PROVIDERS = Object.freeze([
    {
      id: 'chatgpt', name: 'ChatGPT', home: 'https://chatgpt.com/', login: 'https://chatgpt.com/', guestAccess: true, connection: { type: 'browser-session', historyAccess: 'browser-session+export', oauthHistory: false }, hosts: ['chatgpt.com', 'chat.openai.com'],
      chatPatterns: [/\/c\/([a-zA-Z0-9-]+)/, /\/share\/([a-zA-Z0-9-]+)/],
      catalog: { browserHistory: true, backgroundHtml: true, livePassive: true, exportImport: 'chatgpt-data-export', officialHistoryApi: false, manualFullCapture: true }
    },
    {
      id: 'claude', name: 'Claude', home: 'https://claude.ai/', login: 'https://claude.ai/', connection: { type: 'browser-session', historyAccess: 'browser-session', oauthHistory: false }, hosts: ['claude.ai'],
      chatPatterns: [/\/chat\/([a-zA-Z0-9-]+)/],
      catalog: { browserHistory: true, backgroundHtml: true, livePassive: true, exportImport: 'manual-export-if-available', officialHistoryApi: false, manualFullCapture: true }
    },
    {
      id: 'gemini', name: 'Gemini', home: 'https://gemini.google.com/app', login: 'https://gemini.google.com/app', connection: { type: 'browser-session', historyAccess: 'browser-session+takeout', oauthHistory: false }, hosts: ['gemini.google.com'],
      chatPatterns: [/\/app\/([a-zA-Z0-9_-]+)/],
      catalog: { browserHistory: true, backgroundHtml: true, livePassive: true, exportImport: 'google-takeout', officialHistoryApi: false, manualFullCapture: true }
    },
    {
      id: 'grok', name: 'Grok', home: 'https://grok.com/', login: 'https://grok.com/', guestAccess: true, connection: { type: 'browser-session', historyAccess: 'browser-session', oauthHistory: false }, hosts: ['grok.com'],
      chatPatterns: [/\/(?:c|chat|conversation)\/([a-zA-Z0-9_-]+)/],
      catalog: { browserHistory: true, backgroundHtml: true, livePassive: true, exportImport: 'manual-export-if-available', officialHistoryApi: false, manualFullCapture: true }
    },
    {
      id: 'deepseek', name: 'DeepSeek', home: 'https://chat.deepseek.com/', login: 'https://chat.deepseek.com/', connection: { type: 'browser-session', historyAccess: 'browser-session', oauthHistory: false }, hosts: ['chat.deepseek.com'],
      chatPatterns: [/\/a\/chat\/s\/([a-zA-Z0-9_-]+)/, /\/(?:chat|conversation)\/([a-zA-Z0-9_-]+)/],
      catalog: { browserHistory: true, backgroundHtml: true, livePassive: true, exportImport: 'manual-export-if-available', officialHistoryApi: false, manualFullCapture: true }
    },
    {
      id: 'perplexity', name: 'Perplexity', home: 'https://www.perplexity.ai/', login: 'https://www.perplexity.ai/', guestAccess: true, connection: { type: 'browser-session', historyAccess: 'browser-session', oauthHistory: false }, hosts: ['perplexity.ai', 'www.perplexity.ai'],
      chatPatterns: [/\/(?:search|page)\/([^/?#]+)/],
      catalog: { browserHistory: true, backgroundHtml: true, livePassive: true, exportImport: 'manual-export-if-available', officialHistoryApi: false, manualFullCapture: true }
    },
    {
      id: 'copilot', name: 'Microsoft Copilot', home: 'https://copilot.microsoft.com/', login: 'https://copilot.microsoft.com/', guestAccess: true, connection: { type: 'browser-session', historyAccess: 'browser-session+account-export', oauthHistory: false }, hosts: ['copilot.microsoft.com'],
      chatPatterns: [/\/(?:chats?|conversation)\/([a-zA-Z0-9_-]+)/],
      catalog: { browserHistory: true, backgroundHtml: true, livePassive: true, exportImport: 'microsoft-account-export', officialHistoryApi: false, manualFullCapture: true }
    },
    {
      id: 'mistral', name: 'Le Chat', home: 'https://chat.mistral.ai/', login: 'https://chat.mistral.ai/', connection: { type: 'browser-session', historyAccess: 'browser-session', oauthHistory: false }, hosts: ['chat.mistral.ai'],
      chatPatterns: [/\/(?:chat|conversation)\/([a-zA-Z0-9_-]+)/],
      catalog: { browserHistory: true, backgroundHtml: true, livePassive: true, exportImport: 'manual-export-if-available', officialHistoryApi: false, manualFullCapture: true }
    },
    {
      id: 'poe', name: 'Poe', home: 'https://poe.com/', login: 'https://poe.com/', connection: { type: 'browser-session', historyAccess: 'browser-session', oauthHistory: false }, hosts: ['poe.com'],
      chatPatterns: [/\/chat\/([a-zA-Z0-9_-]+)/],
      catalog: { browserHistory: true, backgroundHtml: true, livePassive: true, exportImport: 'manual-export-if-available', officialHistoryApi: false, manualFullCapture: true }
    },
    {
      id: 'metaai', name: 'Meta AI', home: 'https://www.meta.ai/', login: 'https://www.meta.ai/', connection: { type: 'browser-session', historyAccess: 'browser-session+account-export', oauthHistory: false }, hosts: ['meta.ai', 'www.meta.ai'],
      chatPatterns: [/\/(?:chat|conversation|prompt)\/([a-zA-Z0-9_-]+)/],
      catalog: { browserHistory: true, backgroundHtml: false, livePassive: true, exportImport: 'meta-account-export', officialHistoryApi: false, manualFullCapture: true }
    },
    {
      id: 'qwen', name: 'Qwen Chat', home: 'https://chat.qwen.ai/', login: 'https://chat.qwen.ai/', guestAccess: true, connection: { type: 'browser-session', historyAccess: 'browser-session', oauthHistory: false }, hosts: ['chat.qwen.ai'],
      chatPatterns: [/\/(?:c|chat|conversation)\/([a-zA-Z0-9_-]+)/],
      catalog: { browserHistory: true, backgroundHtml: true, livePassive: true, exportImport: 'manual-export-if-available', officialHistoryApi: false, manualFullCapture: true }
    },
    {
      id: 'kimi', name: 'Kimi', home: 'https://www.kimi.com/', login: 'https://www.kimi.com/', connection: { type: 'browser-session', historyAccess: 'browser-session', oauthHistory: false }, hosts: ['kimi.com', 'www.kimi.com'],
      chatPatterns: [/\/(?:chat|conversation)\/([a-zA-Z0-9_-]+)/],
      catalog: { browserHistory: true, backgroundHtml: true, livePassive: true, exportImport: 'manual-export-if-available', officialHistoryApi: false, manualFullCapture: true }
    },
    {
      id: 'characterai', name: 'Character.AI', home: 'https://character.ai/', login: 'https://character.ai/', connection: { type: 'browser-session', historyAccess: 'browser-session+account-export', oauthHistory: false }, hosts: ['character.ai', 'www.character.ai'],
      chatPatterns: [/\/(?:chat|chats|conversation)\/([a-zA-Z0-9_-]+)/],
      catalog: { browserHistory: true, backgroundHtml: false, livePassive: true, exportImport: 'account-export-if-available', officialHistoryApi: false, manualFullCapture: true }
    },
    {
      id: 'huggingchat', name: 'HuggingChat', home: 'https://huggingface.co/chat/', login: 'https://huggingface.co/chat/', connection: { type: 'browser-session', historyAccess: 'browser-session', oauthHistory: false }, hosts: ['huggingface.co'],
      chatPatterns: [/\/chat\/(?:conversation\/)?([a-zA-Z0-9_-]+)/],
      catalog: { browserHistory: true, backgroundHtml: true, livePassive: true, exportImport: 'huggingface-account-export', officialHistoryApi: false, manualFullCapture: true }
    },
    {
      id: 'you', name: 'You.com Chat', home: 'https://you.com/chat', login: 'https://you.com/signin?redirectUrl=/chat', connection: { type: 'browser-session', historyAccess: 'browser-session', oauthHistory: false }, hosts: ['you.com', 'www.you.com'],
      chatPatterns: [/\/(?:chat|search|conversation)\/([a-zA-Z0-9_-]+)/],
      catalog: { browserHistory: true, backgroundHtml: true, livePassive: true, exportImport: 'manual-export-if-available', officialHistoryApi: false, manualFullCapture: true }
    },
    {
      id: 'pi', name: 'Pi', home: 'https://pi.ai/', login: 'https://pi.ai/', guestAccess: true, connection: { type: 'browser-session', historyAccess: 'browser-session', oauthHistory: false }, hosts: ['pi.ai', 'www.pi.ai'],
      chatPatterns: [/\/(?:talk|chat|conversation)\/([a-zA-Z0-9_-]+)/],
      catalog: { browserHistory: true, backgroundHtml: false, livePassive: true, exportImport: 'manual-export-if-available', officialHistoryApi: false, manualFullCapture: true }
    },
    {
      id: 'duckai', name: 'Duck.ai', home: 'https://duck.ai/', login: 'https://duck.ai/', guestOnly: true, connection: { type: 'local-browser-session', historyAccess: 'browser-session-local', oauthHistory: false }, hosts: ['duck.ai'],
      chatPatterns: [/\/(?:chat|conversation)\/([a-zA-Z0-9_-]+)/],
      catalog: { browserHistory: false, backgroundHtml: false, livePassive: true, exportImport: 'none', officialHistoryApi: false, manualFullCapture: true }
    }
  ]);

  const byId = Object.freeze(Object.fromEntries(PROVIDERS.map((provider) => [provider.id, provider])));

  function safeUrl(value) {
    try { return new URL(value); } catch (_) { return null; }
  }

  function detectProvider(value) {
    const url = safeUrl(value);
    if (!url) return null;
    const host = url.hostname.toLowerCase();
    return PROVIDERS.find((provider) => provider.hosts.includes(host)) || null;
  }

  function chatIdFromUrl(value, explicitProviderId = '') {
    const url = safeUrl(value);
    if (!url) return '';
    const provider = explicitProviderId ? byId[explicitProviderId] : detectProvider(value);
    if (!provider) return '';
    for (const pattern of provider.chatPatterns) {
      const match = url.pathname.match(pattern);
      if (match?.[1]) return `${provider.id}:${decodeURIComponent(match[1])}`;
    }
    if (provider.id === 'chatgpt') {
      const projectChat = url.pathname.match(/\/g\/[^/]+\/c\/([a-zA-Z0-9-]+)/);
      if (projectChat?.[1]) return `${provider.id}:${projectChat[1]}`;
    }
    const path = url.pathname.replace(/\/+$/, '');
    if (!path || path === '/app') return '';
    return `${provider.id}:route:${hashString(`${url.hostname}${path}${url.search}`)}`;
  }

  function isLikelyChatUrl(value, providerId = '') {
    const url = safeUrl(value);
    if (!url) return false;
    const provider = providerId ? byId[providerId] : detectProvider(value);
    if (!provider || !provider.hosts.includes(url.hostname.toLowerCase())) return false;
    return provider.chatPatterns.some((pattern) => pattern.test(url.pathname)) || /\/(chat|chats|conversation|search|app|c)\//i.test(url.pathname);
  }

  function canonicalChatUrl(value, providerId = '') {
    const url = safeUrl(value);
    if (!url) return '';
    const provider = providerId ? byId[providerId] : detectProvider(value);
    if (!provider) return '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref$|source$|share$)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  }

  function providerForHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    return PROVIDERS.find((provider) => provider.hosts.includes(host)) || null;
  }

  function hashString(value) {
    const text = String(value || '');
    let h = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function classifyExternalUrl(value) {
    const url = safeUrl(value);
    if (!url) return { kind: 'local', provider: '', external: false };
    const host = url.hostname.toLowerCase();
    if (/^(drive|docs)\.google\.com$/.test(host)) return { kind: 'google-drive', provider: 'google-drive', external: true };
    if (host === 'github.com' || host.endsWith('.githubusercontent.com')) return { kind: 'github', provider: 'github', external: true };
    if (host.endsWith('dropbox.com')) return { kind: 'dropbox', provider: 'dropbox', external: true };
    if (host.endsWith('sharepoint.com') || host === '1drv.ms' || host.endsWith('onedrive.live.com')) return { kind: 'onedrive', provider: 'onedrive', external: true };
    if (host === 'huggingface.co') return { kind: 'huggingface', provider: 'huggingface', external: true };
    if (host.endsWith('notion.so') || host.endsWith('notion.site')) return { kind: 'notion', provider: 'notion', external: true };
    return { kind: 'external', provider: host, external: true };
  }

  const api = Object.freeze({ PROVIDERS, byId, detectProvider, chatIdFromUrl, isLikelyChatUrl, canonicalChatUrl, providerForHost, classifyExternalUrl, hashString });
  globalThis.ProjectConstellationProviders = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
