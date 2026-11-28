(() => {
  'use strict';

  const VERSION = '0.17.6';
  const OWNED = 'projectConstellationTabBeaconFavicon';
  const prior = globalThis.ProjectConstellationTabBeacon;
  if (prior?.version === VERSION) return;
  try { prior?.dispose?.(); } catch (_) {}

  let current = { enabled:false, titleEnabled:false, faviconEnabled:false, emoji:'', color:'#8b5cf6', tag:'' };
  let baseTitle = document.title || '';
  let appliedTitle = '';
  let titleObserver = null;
  let headObserver = null;
  let messageListener = null;
  let applying = false;
  let titleObservedNode = null;
  let titleRepairQueued = false;
  let faviconRepairQueued = false;
  const faviconCache = new Map();

  const clean = (value, max = 120) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const validColor = (value) => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : '#8b5cf6';

  function prefix() {
    const parts = [clean(current.tag, 24), clean(current.emoji, 12)].filter(Boolean);
    return parts.length ? `${parts.join(' ')} ` : '';
  }

  function stripOwnedPrefix(title) {
    const value = String(title || '');
    const owned = prefix();
    if (owned && value.startsWith(owned)) return value.slice(owned.length);
    return value.replace(/^\s*(?:🔥|📌|💡|🧪|✅|🟣|🟢|🟡|🔴|⚠️|🔵|🛡️|🟠|🟤|⚪|⭐|✨)(?:\s+(?:🔥|📌|💡|🧪|✅|🟣|🟢|🟡|🔴|⚠️|🔵|🛡️|🟠|🟤|⚪|⭐|✨))*\s+/u, '');
  }

  function applyTitle() {
    if (applying) return;
    applying = true;
    try {
      if (!current.enabled || !current.titleEnabled) {
        if (appliedTitle && document.title === appliedTitle) document.title = baseTitle;
        appliedTitle = '';
        return;
      }
      const wanted = `${prefix()}${baseTitle || 'AI chat'}`;
      if (document.title !== wanted) document.title = wanted;
      appliedTitle = wanted;
    } finally { applying = false; }
  }

  function faviconDataUri(color, emoji = '') {
    const safe = validColor(color);
    const isShield = clean(emoji, 12).includes('🛡️');
    const cacheKey = `${safe}|${isShield ? 'shield' : 'circle'}`;
    if (faviconCache.has(cacheKey)) return faviconCache.get(cacheKey);
    const svg = isShield
      ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M32 4 54 12v17c0 14-8.8 25.1-22 31C18.8 54.1 10 43 10 29V12L32 4Z" fill="${safe}"/><path d="M32 11 47 16.4V29c0 10.1-5.7 18.3-15 23.3C22.7 47.3 17 39.1 17 29V16.4L32 11Z" fill="none" stroke="white" stroke-opacity=".94" stroke-width="3.6"/></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="27" fill="${safe}"/><circle cx="32" cy="32" r="19" fill="none" stroke="white" stroke-opacity=".92" stroke-width="4"/><circle cx="32" cy="32" r="5" fill="white"/></svg>`;
    const href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    faviconCache.set(cacheKey, href);
    return href;
  }

  function removeOwnedFavicon() {
    document.getElementById(OWNED)?.remove?.();
  }

  function applyFavicon() {
    if (!current.enabled || !current.faviconEnabled) { removeOwnedFavicon(); return; }
    let link = document.getElementById(OWNED);
    if (!link) {
      link = document.createElement('link');
      link.id = OWNED;
      link.rel = 'icon';
      link.type = 'image/svg+xml';
      link.dataset.projectConstellationOwned = '1';
      (document.head || document.documentElement).appendChild(link);
    }
    const href = faviconDataUri(current.color, current.emoji);
    if (link.getAttribute('href') !== href) link.setAttribute('href', href);
  }

  function apply(next = {}) {
    const oldApplied = appliedTitle;
    // A repeated presentation must be a true no-op. The old implementation briefly
    // restored baseTitle and then reapplied the same prefix on every background state
    // push, generating two tab-title mutations per push and feeding Chrome's tab/update
    // machinery even when nothing visible changed.
    if (!(oldApplied && document.title === oldApplied) && document.title && document.title !== oldApplied) {
      baseTitle = stripOwnedPrefix(document.title);
    }
    current = {
      enabled:next.enabled !== false,
      titleEnabled:next.titleEnabled !== false,
      faviconEnabled:next.faviconEnabled !== false,
      emoji:clean(next.emoji, 12),
      color:validColor(next.color),
      tag:clean(next.tag, 24)
    };
    applyTitle();
    applyFavicon();
    return { ...current, baseTitle };
  }

  function scheduleTitleRepair() {
    if (titleRepairQueued) return;
    titleRepairQueued = true;
    queueMicrotask(() => { titleRepairQueued = false; applyTitle(); });
  }

  function bindTitleObserver() {
    titleObserver?.disconnect();
    const titleNode = document.querySelector('title');
    titleObservedNode = titleNode || null;
    if (titleNode) {
      titleObserver.observe(titleNode, { childList:true, characterData:true, subtree:true });
      return;
    }
    // document_start frequently runs before <title> exists. Observe only the head
    // construction path until it appears instead of subscribing to the entire chat DOM.
    const root = document.head || document.documentElement;
    if (root) titleObserver.observe(root, { childList:true, subtree:Boolean(document.head) });
  }

  titleObserver = new MutationObserver(() => {
    if (applying) return;
    const currentTitleNode = document.querySelector('title');
    if (currentTitleNode !== titleObservedNode) bindTitleObserver();
    const observed = document.title || '';
    if (observed && observed !== appliedTitle) {
      baseTitle = stripOwnedPrefix(observed);
      scheduleTitleRepair();
    }
  });
  bindTitleObserver();
  document.addEventListener('DOMContentLoaded', bindTitleObserver, { once:true });

  function scheduleFaviconRepair() {
    if (faviconRepairQueued) return;
    faviconRepairQueued = true;
    queueMicrotask(() => { faviconRepairQueued = false; applyFavicon(); });
  }

  headObserver = new MutationObserver((mutations) => {
    if (!current.enabled || !current.faviconEnabled) return;
    if (mutations.some((mutation) => [...mutation.removedNodes].some((node) => node?.id === OWNED))) scheduleFaviconRepair();
  });
  if (document.head) headObserver.observe(document.head, { childList:true });

  messageListener = (message, _sender, sendResponse) => {
    if (message?.type === 'PC_TAB_BEACON_APPLY') {
      sendResponse({ ok:true, state:apply(message.presentation || {}) });
      return false;
    }
    if (message?.type === 'PC_TAB_BEACON_STATE') {
      sendResponse({ ok:true, version:VERSION, current:{ ...current }, baseTitle });
      return false;
    }
    return false;
  };
  chrome?.runtime?.onMessage?.addListener?.(messageListener);

  globalThis.ProjectConstellationTabBeacon = {
    version:VERSION,
    apply,
    state:() => ({ ...current, baseTitle }),
    dispose() {
      try { chrome?.runtime?.onMessage?.removeListener?.(messageListener); } catch (_) {}
      titleObserver?.disconnect();
      headObserver?.disconnect();
      if (appliedTitle && document.title === appliedTitle) document.title = baseTitle;
      removeOwnedFavicon();
    }
  };
})();
