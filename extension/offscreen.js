(() => {
  'use strict';
  const brain = globalThis.ProjectConstellationBrainCore;
  const providers = globalThis.ProjectConstellationProviders;
  const norm = (v, n=50000) => brain.normalizeText(v, n);
  const abs = (href, base) => { try { return new URL(href, base).toString(); } catch (_) { return ''; } };

  function role(node) {
    const direct = node.getAttribute?.('data-message-author-role') || node.getAttribute?.('data-author') || '';
    if (direct) return direct;
    const label = `${node.getAttribute?.('data-testid') || ''} ${node.getAttribute?.('aria-label') || ''}`;
    if (/user|human|prompt/i.test(label)) return 'user';
    if (/assistant|ai|bot|response/i.test(label)) return 'assistant';
    return 'unknown';
  }

  function parseHtml({ html, url, providerId }) {
    const provider = providers.byId[providerId] || providers.detectProvider(url);
    if (!provider) return { ok: false, error: 'Unknown provider' };
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const textSample = norm(doc.body?.innerText || doc.body?.textContent || '', 22000);
    const authRequired = /\b(sign in|log in|login|session expired|authenticate)\b/i.test(textSample) && !providers.isLikelyChatUrl(doc.location?.href || '', provider.id);
    const chats = [];
    const chatSeen = new Set();
    for (const a of doc.querySelectorAll('a[href]')) {
      const href = abs(a.getAttribute('href'), url);
      if (!providers.isLikelyChatUrl(href, provider.id)) continue;
      const canonical = providers.canonicalChatUrl(href, provider.id);
      if (!canonical || chatSeen.has(canonical)) continue;
      chatSeen.add(canonical);
      chats.push({ id: providers.chatIdFromUrl(canonical, provider.id), url: canonical, title: norm(a.textContent || a.getAttribute('aria-label') || 'Untitled chat', 300), providerId: provider.id });
    }

    const chatId = providers.chatIdFromUrl(url, provider.id);
    const turns = [];
    if (chatId) {
      const selector = '[data-message-id],[data-message-author-role],[data-author],[data-testid^="conversation-turn"],[data-testid*="message"],article[data-testid*="conversation"],main article';
      const seen = new Set();
      [...doc.querySelectorAll(selector)].forEach((node, ordinal) => {
        const text = norm(node.innerText || node.textContent || '', 50000);
        if (!text || text.length < 2) return;
        const r = role(node);
        const messageId = node.getAttribute('data-message-id') || `${r}-${providers.hashString(text.slice(0, 800))}`;
        const id = brain.turnKey(chatId, messageId, r, ordinal);
        if (seen.has(id)) return;
        seen.add(id);
        turns.push({ id, providerId: provider.id, chatId, messageId, role: r, ordinal, text, source: 'background-html', url, updatedAt: Date.now() });
      });
    }

    const files = [];
    const fileSeen = new Set();
    if (chatId) {
      for (const a of doc.querySelectorAll('a[href]')) {
        const href = abs(a.getAttribute('href'), url);
        if (!href) continue;
        const label = norm(a.getAttribute('download') || a.getAttribute('aria-label') || a.textContent || '', 260);
        const looksFile = /\.(zip|jar|7z|rar|pdf|docx?|xlsx?|pptx?|csv|json|ya?ml|toml|md|txt|png|jpe?g|gif|webp|svg|mp4|webm|mov|blend|obj|fbx|stl|py|js|ts|tsx|jsx|java|kt|cs|cpp|c|h)(?:[?#]|$)/i.test(href) || /\b(download|attachment|file|drive|github)\b/i.test(label);
        const external = providers.classifyExternalUrl(href);
        const hrefProvider = providers.detectProvider(href);
        if (!looksFile && hrefProvider?.id === provider.id) continue;
        if (!looksFile && !external.external) continue;
        const name = label || (() => { try { return decodeURIComponent(new URL(href).pathname.split('/').filter(Boolean).pop() || 'file'); } catch (_) { return 'file'; } })();
        const id = brain.fileKey(chatId, href, name);
        if (fileSeen.has(id)) continue;
        fileSeen.add(id);
        files.push({ id, providerId: provider.id, chatId, name, href, externalUrl: external.external ? href : '', externalProvider: external.provider, kind: 'linked-file', source: 'background-html', sourcePage: url, updatedAt: Date.now() });
      }
    }

    const title = norm(doc.querySelector('meta[property="og:title"]')?.getAttribute('content') || doc.title || doc.querySelector('h1')?.textContent || '', 300);
    return { ok: true, providerId: provider.id, url, title, authRequired, chats, turns, files, textLength: textSample.length };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.target !== 'pc-offscreen-parser') return false;
    try {
      if (message.type === 'PC_OFFSCREEN_PARSE_HTML') sendResponse(parseHtml(message.payload || {}));
      else sendResponse({ ok: false, error: 'Unknown offscreen parser message' });
    } catch (error) { sendResponse({ ok: false, error: String(error?.message || error) }); }
    return false;
  });
})();
