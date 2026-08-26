(() => {
  'use strict';

  const VERSION = '0.14.4';
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
    return value.replace(/^\s*(?:🔥|📌|💡|🧪|✅|🟣|🟢|🟡|🔴|⚠️|🔵|🟠|🟤|⚪|⭐|✨)(?:\s+(?:🔥|📌|💡|🧪|✅|🟣|🟢|🟡|🔴|⚠️|🔵|🟠|🟤|⚪|⭐|✨))*\s+/u, '');
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

  function faviconDataUri(color) {
    const safe = validColor(color);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="27" fill="${safe}"/><circle cx="32" cy="32" r="19" fill="none" stroke="white" stroke-opacity=".92" stroke-width="4"/><circle cx="32" cy="32" r="5" fill="white"/></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
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
    const href = faviconDataUri(current.color);
    if (link.href !== href) link.href = href;
  }

  function apply(next = {}) {
    const oldApplied = appliedTitle;
    if (oldApplied && document.title === oldApplied) document.title = baseTitle;
    else if (document.title && document.title !== oldApplied) baseTitle = stripOwnedPrefix(document.title);
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

  titleObserver = new MutationObserver(() => {
    if (applying) return;
    const observed = document.title || '';
    if (observed && observed !== appliedTitle) {
      baseTitle = stripOwnedPrefix(observed);
      queueMicrotask(applyTitle);
    }
  });
  const titleNode = document.querySelector('title');
  if (titleNode) titleObserver.observe(titleNode, { childList:true, characterData:true, subtree:true });
  else titleObserver.observe(document.documentElement, { childList:true, subtree:true });

  headObserver = new MutationObserver((mutations) => {
    if (!current.enabled || !current.faviconEnabled) return;
    if (mutations.some((mutation) => [...mutation.removedNodes].some((node) => node?.id === OWNED))) queueMicrotask(applyFavicon);
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
