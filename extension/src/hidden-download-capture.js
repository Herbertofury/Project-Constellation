(() => {
  'use strict';
  if (globalThis.__PROJECT_CONSTELLATION_HIDDEN_DOWNLOAD_CAPTURE__) return;
  globalThis.__PROJECT_CONSTELLATION_HIDDEN_DOWNLOAD_CAPTURE__ = true;

  const brain = globalThis.ProjectConstellationBrainCore;
  const providers = globalThis.ProjectConstellationProviders;
  if (!brain || !providers || !/^(chatgpt\.com|chat\.openai\.com)$/i.test(location.hostname)) return;

  const seen = new Map();
  let timer = 0;
  let running = false;

  const clean = (value, max = 280) => brain.normalizeText(String(value || ''), max);
  const signature = (href, name) => `${href}|${name}`;
  const currentChatId = () => providers.chatIdFromUrl(location.href, 'chatgpt') || '';

  async function scan() {
    if (!document.hidden || running) return;
    const chatId = currentChatId();
    if (!chatId) return;
    running = true;
    try {
      const payload = [];
      const staged = [];
      for (const anchor of [...document.querySelectorAll('a[download][href]')].slice(-120)) {
        const href = String(anchor.href || '').slice(0, 8000);
        const name = clean(anchor.getAttribute('download') || anchor.getAttribute('aria-label') || anchor.textContent || 'download', 260) || 'download';
        const id = brain.fileKey(chatId, href, name);
        const fingerprint = signature(href, name);
        if (seen.get(id) === fingerprint) continue;
        const external = providers.classifyExternalUrl(href);
        staged.push([id, fingerprint]);
        payload.push({ type:'FILE_UPSERT', data:{
          id, providerId:'chatgpt', chatId, name, href, kind:'download-link',
          externalProvider:external.provider, externalUrl:external.external ? href : '', source:'hidden-tab-supervisor', updatedAt:Date.now()
        }});
      }
      if (!payload.length) return;
      const response = await chrome.runtime.sendMessage({ type:'PC_BRAIN_INGEST_BATCH', payload });
      if (response?.ok === true && response?.ignored !== true) {
        for (const [id, fingerprint] of staged) seen.set(id, fingerprint);
        while (seen.size > 1000) seen.delete(seen.keys().next().value);
      }
    } catch (_) {
      // Leave records unseen so the next hidden mutation/visibility pass retries them.
    } finally {
      running = false;
    }
  }

  function schedule() {
    if (!document.hidden) return;
    clearTimeout(timer);
    timer = setTimeout(() => void scan(), 300);
  }

  const observer = new MutationObserver((mutations) => {
    if (!document.hidden) return;
    if (mutations.some((mutation) => mutation.type === 'attributes' && mutation.attributeName === 'download' && mutation.target instanceof HTMLAnchorElement)) schedule();
  });

  function start() {
    if (!document.documentElement) return;
    observer.observe(document.documentElement, { subtree:true, attributes:true, attributeFilter:['download'] });
    schedule();
  }

  document.addEventListener('visibilitychange', schedule);
  if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start, { once:true });
})();
