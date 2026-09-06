(() => {
  'use strict';

  const core = globalThis.ProjectConstellationChatVaultCore;
  if (!core) return;
  const host = location.hostname.toLowerCase();
  if (host !== 'chatgpt.com' && host !== 'chat.openai.com') return;

  const VERSION = '1.0.0';
  const DECORATIONS_KEY = core.DECORATIONS_KEY;
  const OWNED = 'data-project-constellation-chat-organizer';
  const ROW_SELECTOR = 'a[href*="/c/"]';
  const STYLE_VALUES = new Set(core.STYLE_VALUES);
  const PRESET_EMOJI = [
    '\u{1F525}','\u{1F4CC}','\u{1F4A1}','\u{1F9EA}','\u2705','\u{1F9E0}','\u{1F4BB}','\u{1F3AE}',
    '\u{1F31F}','\u{1F680}','\u{1F49C}','\u{1F4DA}','\u{1F528}','\u{1F9F9}','\u{1F6A7}','\u{1F48E}'
  ];

  let decorations = {};
  let scanFrame = 0;
  let observer = null;
  let storageListener = null;
  let messageListener = null;
  let activeEditor = null;
  let activeKey = '';
  let activeAnchor = null;

  const clean = core.clean;
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function idFromAnchor(anchor) {
    return core.conversationId(anchor?.href || anchor?.getAttribute?.('href') || '');
  }

  function keyFromAnchor(anchor) {
    return core.decorationKey(anchor?.href || anchor?.getAttribute?.('href') || '');
  }

  function rowShell(anchor) {
    if (!anchor) return null;
    return anchor.closest('li,[data-testid*="history" i] > div,[role="listitem"]') || anchor.parentElement;
  }

  function unadornedTitle(anchor) {
    if (!anchor) return '';
    const clone = anchor.cloneNode(true);
    for (const node of clone.querySelectorAll(`[${OWNED}]`)) node.remove();
    return clean(clone.textContent || anchor.getAttribute('aria-label') || document.title || 'Chat', 300);
  }

  function ensureEmoji(anchor) {
    let node = anchor.querySelector(':scope > .pc-chat-emoji');
    if (!node) {
      node = document.createElement('span');
      node.className = 'pc-chat-emoji';
      node.setAttribute(OWNED, '1');
      node.setAttribute('aria-hidden', 'true');
      anchor.insertBefore(node, anchor.firstChild);
    }
    return node;
  }

  function ensureStyleButton(anchor, shell) {
    if (!shell) return null;
    let button = shell.querySelector(':scope > .pc-chat-style-button');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'pc-chat-style-button';
      button.setAttribute(OWNED, '1');
      button.setAttribute('aria-label', 'Style this chat with Project Constellation');
      button.title = 'Emoji, color, text style, or rename this chat';
      button.textContent = '\u2726';
      shell.appendChild(button);
    }
    button.dataset.pcConversationId = idFromAnchor(anchor);
    button.dataset.pcDecorationKey = keyFromAnchor(anchor);
    return button;
  }

  function applyDecoration(anchor) {
    const key = keyFromAnchor(anchor);
    if (!key) return;
    const shell = rowShell(anchor);
    if (!shell) return;
    const decoration = core.normalizeDecoration(decorations[key] || {});
    anchor.classList.add('pc-chat-decorated');
    anchor.dataset.pcDecorationKey = key;
    anchor.dataset.pcStyle = STYLE_VALUES.has(decoration.style) ? decoration.style : 'clean';
    if (decoration.color) anchor.style.setProperty('--pc-chat-color', decoration.color);
    else anchor.style.removeProperty('--pc-chat-color');
    shell.classList.add('pc-chat-organizer-shell');
    shell.dataset.pcDecorationKey = key;
    const emoji = ensureEmoji(anchor);
    emoji.textContent = decoration.emoji || '';
    emoji.hidden = !decoration.emoji;
    ensureStyleButton(anchor, shell);
  }

  function scanRows() {
    scanFrame = 0;
    const roots = [document.querySelector('nav'), document.querySelector('aside')].filter(Boolean);
    const scope = roots.length ? roots : [document];
    const seen = new Set();
    for (const root of scope) {
      for (const anchor of root.querySelectorAll(ROW_SELECTOR)) {
        if (seen.has(anchor) || !idFromAnchor(anchor)) continue;
        seen.add(anchor);
        applyDecoration(anchor);
      }
    }
  }

  function scheduleScan() {
    if (scanFrame) return;
    scanFrame = requestAnimationFrame(scanRows);
  }

  async function loadDecorations() {
    const stored = await chrome.storage.local.get(DECORATIONS_KEY).catch(() => ({}));
    decorations = core.normalizeDecorations(stored?.[DECORATIONS_KEY]);
    scheduleScan();
  }

  async function saveDecoration(key, patch = {}) {
    if (!key) return { ok:false, error:'Missing chat identity.' };
    const current = core.normalizeDecoration(decorations[key] || {});
    const next = core.normalizeDecoration({ ...current, ...patch, updatedAt:Date.now() });
    decorations = { ...decorations, [key]:next };
    if (!next.emoji && !next.color && next.style === 'clean') {
      const trimmed = { ...decorations };
      delete trimmed[key];
      decorations = trimmed;
    }
    await chrome.storage.local.set({ [DECORATIONS_KEY]:decorations });
    scheduleScan();
    return { ok:true, decoration:decorations[key] || core.normalizeDecoration({}) };
  }

  async function waitFor(predicate, timeoutMs = 2200, intervalMs = 45) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const result = predicate();
      if (result) return result;
      await delay(intervalMs);
    }
    return null;
  }

  function visibleElement(node) {
    if (!node || !node.isConnected) return false;
    const rect = node.getBoundingClientRect?.();
    if (rect && rect.width <= 0 && rect.height <= 0) return false;
    const style = getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.01;
  }

  function findAnchorById(conversationId) {
    const wanted = clean(conversationId, 200);
    if (!wanted) return null;
    return [...document.querySelectorAll(ROW_SELECTOR)].find((anchor) => idFromAnchor(anchor) === wanted) || null;
  }

  function scrollContainers() {
    const nav = document.querySelector('nav') || document.querySelector('aside');
    if (!nav) return [];
    return [nav, ...nav.querySelectorAll('div')]
      .filter((node) => {
        const rect = node.getBoundingClientRect?.();
        return node.scrollHeight > node.clientHeight + 120 && node.clientHeight > 180 && (!rect || rect.height > 160);
      })
      .sort((a,b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))
      .slice(0,3);
  }

  async function locateConversationAnchor(conversationId) {
    const direct = findAnchorById(conversationId);
    if (direct) return { anchor:direct, restore:null };
    for (const scroller of scrollContainers()) {
      const original = scroller.scrollTop;
      const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const step = Math.max(220, Math.floor(scroller.clientHeight * 0.82));
      for (let position = 0; position <= max; position += step) {
        scroller.scrollTop = Math.min(position, max);
        await delay(36);
        const anchor = findAnchorById(conversationId);
        if (anchor) return { anchor, restore:() => { scroller.scrollTop = original; } };
      }
      scroller.scrollTop = original;
    }
    return { anchor:null, restore:null };
  }

  function triggerHover(shell) {
    if (!shell) return;
    for (const type of ['pointerenter','mouseenter','mouseover']) {
      try { shell.dispatchEvent(new MouseEvent(type, { bubbles:true, cancelable:false, view:window })); } catch (_) ²È="24€€€½¹ÍÐ½±½É]É…À€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ±…‰•°œ¤ì½±½É]É…À¹Ñ•áÑ½¹Ñ•¹Ð€ô€½±½Èœì(€€€½¹ÍÐ½±½É%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì½±½É%¹ÁÕÐ¹ÑåÁ”€ô€½±½Èœì½±½É%¹ÁÕÐ¹Ù…±Õ”€ôÕÉÉ•¹Ð¹½±½Èñð€œŒáˆÕ˜Øœì(€€€½¹ÍÐ½±½É¹…‰±•€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì½±½É¹…‰±•¹ÑåÁ”€ô€¡•­‰½àœì½±½É¹…‰±•¹¡•­•€ô	½½±•…¸¡ÕÉÉ•¹Ð¹½±½È¤ì½±½É¹…‰±•¹Ñ¥Ñ±”€ô€UÍ”ÕÍÑ½´½±½Èœì(€€€½¹ÍÐ½±½É1¥¹”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÍÁ…¸œ¤ì½±½É1¥¹”¹±…ÍÍ9…µ”€ô€ÁŒµ¡…Ðµ½±½Èµ±¥¹”œì½±½É1¥¹”¹…ÁÁ•¹¡½±½É%¹ÁÕÐ°½±½É¹…‰±•¤ì(€€€½±½É]É…À¹…ÁÁ•¹‘¡¥±¡½±½É1¥¹”¤ì(€€€½¹ÍÐÍÑå±•]É…À€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ±…‰•°œ¤ìÍÑå±•]É…À¹Ñ•áÑ½¹Ñ•¹Ð€ô€Q•áÐÍÑå±”œì(€€€½¹ÍÐÍÑå±•M•±•Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Í•±•Ðœ¤ì(€€€™½È€¡½¹ÍÐmÙ…±Õ”±±…‰•±t½˜ml±•…¸œ°±•…¸t±l‰½±œ°	½±t±lÍ•É¥˜œ°M•É¥˜t±l¥Ñ…±¥Œœ°%Ñ…±¥Œt±lµ½¹¼œ°5½¹¼t±lÝ¥‘”œ°]¥‘”t±l±½Üœ°±½Üt±lÍ½™Ðœ°M½™ÐÁ¥±°ut¤ì(€€€€€½¹ÍÐ½ÁÑ¥½¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ½ÁÑ¥½¸œ¤ì½ÁÑ¥½¸¹Ù…±Õ”€ôÙ…±Õ”ì½ÁÑ¥½¸¹Ñ•áÑ½¹Ñ•¹Ð€ô±…‰•°ì½ÁÑ¥½¸¹Í•±•Ñ•€ôÕÉÉ•¹Ð¹ÍÑå±”€ôôôÙ…±Õ”ìÍÑå±•M•±•Ð¹…ÁÁ•¹‘¡¥±¡½ÁÑ¥½¸¤ì(€€€ô(€€€ÍÑå±•]É…À¹…ÁÁ•¹‘¡¥±¡ÍÑå±•M•±•Ð¤ì(€€€…ÁÁ•…É…¹”¹…ÁÁ•¹¡½±½É]É…À°ÍÑå±•]É…À¤ì((€€€½¹ÍÐ‘•½É…Ñ¥½¹Ñ¥½¹Ì€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì‘•½É…Ñ¥½¹Ñ¥½¹Ì¹±…ÍÍ9…µ”€ô€ÁŒµ¡…Ðµ•‘¥Ñ½Èµ…Ñ¥½¹Ìœì(€€€½¹ÍÐ…ÁÁ±ä€ôÉ•…Ñ•	ÕÑÑ½¸ ÁÁ±äÍÑå±”œ°€ÁÉ¥µ…Éäœ¤ì(€€€½¹ÍÐ±•…È€ôÉ•…Ñ•	ÕÑÑ½¸ ±•…Èœ¤ì(€€€½¹ÍÐÍÑ…ÑÕÌ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÍÁ…¸œ¤ìÍÑ…ÑÕÌ¹±…ÍÍ9…µ”€ô€ÁŒµ¡…Ðµ•‘¥Ñ½ÈµÍÑ…ÑÕÌœì(€€€…ÁÁ±ä¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°…Íå¹Œ€ ¤€ôøì(€€€€€…ÁÁ±ä¹‘¥Í…‰±•€ôÑÉÕ”ìÍÑ…ÑÕÌ¹Ñ•áÑ½¹Ñ•¹Ð€ô€M…Ù¥¹œ¸¸¸œì(€€€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥ÐÍ…Ù••½É…Ñ¥½¸¡­•ä°ì•µ½©¤é•µ½©¥%¹ÁÕÐ¹Ù…±Õ”°½±½Èé½±½É¹…‰±•¹¡•­•€ü½±½É%¹ÁÕÐ¹Ù…±Õ”€è€œœ°ÍÑå±”éÍÑå±•M•±•Ð¹Ù…±Õ”ô¤ì(€€€€€…ÁÁ±ä¹‘¥Í…‰±•€ô™…±Í”ìÍÑ…ÑÕÌ¹Ñ•áÑ½¹Ñ•¹Ð€ôÉ•ÍÕ±Ð¹½¬€ü€M…Ù•œ€è€½Õ±¹½ÐÍ…Ù”œì(€€€€€¥˜€¡É•ÍÕ±Ð¹½¬¤Í•ÑQ¥µ•½ÕÐ  ¤€ôøì¥˜€¡ÍÑ…ÑÕÌ¹¥Í½¹¹•Ñ•¤ÍÑ…ÑÕÌ¹Ñ•áÑ½¹Ñ•¹Ð€ô€œœìô°€äÀÀ¤ì(€€€ô¤ì(€€€±•…È¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°…Íå¹Œ€ ¤€ôøì(€€€€€•µ½©¥%¹ÁÕÐ¹Ù…±Õ”€ô€œœì½±½É¹…‰±•¹¡•­•€ô™…±Í”ìÍÑå±•M•±•Ð¹Ù…±Õ”€ô€±•…¸œì(€€€€€…Ý…¥ÐÍ…Ù••½É…Ñ¥½¸¡­•ä°ì•µ½©¤èœœ°½±½Èèœœ°ÍÑå±”è±•…¸œô¤ìÍÑ…ÑÕÌ¹Ñ•áÑ½¹Ñ•¹Ð€ô€±•…É•œì(€€€ô¤ì(€€€‘•½É…Ñ¥½¹Ñ¥½¹Ì¹…ÁÁ•¹¡…ÁÁ±ä°±•…È°ÍÑ…ÑÕÌ¤ì((€€€½¹ÍÐ‘¥Ù¥‘•È€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì‘¥Ù¥‘•È¹±…ÍÍ9…µ”€ô€ÁŒµ¡…Ðµ•‘¥Ñ½Èµ‘¥Ù¥‘•Èœì(€€€½¹ÍÐÉ•¹…µ•1…‰•°€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ±…‰•°œ¤ìÉ•¹…µ•1…‰•°¹±…ÍÍ9…µ”€ô€ÁŒµ¡…Ðµ•‘¥Ñ½Èµ±…‰•°œìÉ•¹…µ•1…‰•°¹Ñ•áÑ½¹Ñ•¹Ð€ô€I•¹…µ”Ñ¡”…ÑÕ…°¡…ÑAP¡…Ðœì(€€€½¹ÍÐÉ•¹…µ•I½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ìÉ•¹…µ•I½Ü¹±…ÍÍ9…µ”€ô€ÁŒµ¡…ÐµÉ•¹…µ”µÉ½Üœì(€€€½¹ÍÐÉ•¹…µ•%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ìÉ•¹…µ•%¹ÁÕÐ¹µ…á1•¹Ñ €ô€ÄÈÀìÉ•¹…µ•%¹ÁÕÐ¹Ù…±Õ”€ôÕ¹…‘½É¹•‘Q¥Ñ±”¡…¹¡½È¤ìÉ•¹…µ•%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€¡…Ð¹…µ”œì(€€€½¹ÍÐÉ•¹…µ•	ÕÑÑ½¸€ôÉ•…Ñ•	ÕÑÑ½¸ I•¹…µ”œ°€ÁÉ¥µ…Éäœ¤ì(€€€É•¹…µ•I½Ü¹…ÁÁ•¹¡É•¹…µ•%¹ÁÕÐ°É•¹…µ•	ÕÑÑ½¸¤ì(€€€½¹ÍÐÉ•¹…µ•MÑ…ÑÕÌ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Íµ…±°œ¤ìÉ•¹…µ•MÑ…ÑÕÌ¹±…ÍÍ9…µ”€ô€ÁŒµ¡…ÐµÉ•¹…µ”µÍÑ…ÑÕÌœìÉ•¹…µ•MÑ…ÑÕÌ¹Ñ•áÑ½¹Ñ•¹Ð€ô€UÍ•Ì¡…ÑAQpÌ½Ý¸Ù¥Í¥‰±”I•¹…µ”U$ì¹¼ÁÉ½Ù¥‘•ÈA$É•ÅÕ•ÍÐ¸œì(€€€É•¹…µ•	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°…Íå¹Œ€ ¤€ôøì(€€€€€É•¹…µ•	ÕÑÑ½¸¹‘¥Í…‰±•€ôÑÉÕ”ìÉ•¹…µ•MÑ…ÑÕÌ¹Ñ•áÑ½¹Ñ•¹Ð€ô€I•¹…µ¥¹œ¸¸¸œì(€€€€€±½Í•‘¥Ñ½È ¤ì(€€€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥ÐÉ•¹…µ•¡…Ð¡½¹Ù•ÉÍ…Ñ¥½¹%°É•¹…µ•%¹ÁÕÐ¹Ù…±Õ”¤ì(€€€€€¥˜€ …É•ÍÕ±Ð¹½¬¤ì(€€€€€€€…Ý…¥Ð½Á•¹‘¥Ñ½É½È¡½¹Ù•ÉÍ…Ñ¥½¹%¤ì(€€€€€€€½¹ÍÐÉ•½Á•¹•€ô‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ÁÉ½©•Ñ½¹ÍÑ•±±…Ñ¥½¹¡…ÑMÑå±•A½Á½Ù•Èœ¤ì(€€€€€€€½¹ÍÐ¹½Ñ”€ôÉ•½Á•¹•ü¹ÅÕ•ÉåM•±•Ñ½È œ¹ÁŒµ¡…ÐµÉ•¹…µ”µÍÑ…ÑÕÌœ¤ì(€€€€€€€¥˜€¡¹½Ñ”¤¹½Ñ”¹Ñ•áÑ½¹Ñ•¹Ð€ôÉ•ÍÕ±Ð¹•ÉÉ½Èñð€I•¹…µ”™…¥±•¸œì(€€€€€ô(€€€ô¤ì(€€€É•¹…µ•%¹ÁÕÐ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ­•å‘½Ý¸œ°€¡•Ù•¹Ð¤€ôøì¥˜€¡•Ù•¹Ð¹­•ä€ôôô€¹Ñ•Èœ¤ì•Ù•¹Ð¹ÁÉ•Ù•¹Ñ•™…Õ±Ð ¤ìÉ•¹…µ•	ÕÑÑ½¸¹±¥¬ ¤ìôô¤ì((€€€•‘¥Ñ½È¹…ÁÁ•¹¡¡•…°•µ½©¥1…‰•°°ÁÉ•Í•ÑÌ°•µ½©¥%¹ÁÕÐ°…ÁÁ•…É…¹”°‘•½É…Ñ¥½¹Ñ¥½¹Ì°‘¥Ù¥‘•È°É•¹…µ•1…‰•°°É•¹…µ•I½Ü°É•¹…µ•MÑ…ÑÕÌ¤ì(€€€‘½Õµ•¹Ð¹‰½‘ä¹…ÁÁ•¹‘¡¥±¡•‘¥Ñ½È¤ì(€€€…Ñ¥Ù•‘¥Ñ½È€ô•‘¥Ñ½Èì(€€€Á½Í¥Ñ¥½¹‘¥Ñ½È¡•‘¥Ñ½È°Í¡•±°¤ì(€€€É•ÅÕ•ÍÑ¹¥µ…Ñ¥½¹É…µ”  ¤€ôø•‘¥Ñ½È¹±…ÍÍ1¥ÍÐ¹…‘ ½Á•¸œ¤¤ì(€€€É•ÑÕÉ¸ì½¬éÑÉÕ”°­•ä°½¹Ù•ÉÍ…Ñ¥½¹%ôì(€ô((€™Õ¹Ñ¥½¸‘•±•…Ñ•‘±¥¬¡•Ù•¹Ð¤ì(€€€½¹ÍÐÍÑå±•	ÕÑÑ½¸€ô•Ù•¹Ð¹Ñ…É•Ðü¹±½Í•ÍÐü¸ œ¹ÁŒµ¡…ÐµÍÑå±”µ‰ÕÑÑ½¸œ¤ì(€€€¥˜€¡ÍÑå±•	ÕÑÑ½¸¤ì(€€€€€•Ù•¹Ð¹ÁÉ•Ù•¹Ñ•™…Õ±Ð ¤ì•Ù•¹Ð¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ì•Ù•¹Ð¹ÍÑ½Á%µµ•‘¥…Ñ•AÉ½Á……Ñ¥½¸ü¸ ¤ì(€€€€€½¹ÍÐ¥€ô±•…¸¡ÍÑå±•	ÕÑÑ½¸¹‘…Ñ…Í•Ð¹Á½¹Ù•ÉÍ…Ñ¥½¹%ñð€œœ°€ÈÀÀ¤ì(€€€€€½¹ÍÐÍ¡•±°€ôÍÑå±•	ÕÑÑ½¸¹±½Í•ÍÐ œ¹ÁŒµ¡…Ðµ½É…¹¥é•ÈµÍ¡•±°œ¤ì(€€€€€½¹ÍÐ…¹¡½È€ôÍ¡•±°ü¹ÅÕ•ÉåM•±•Ñ½Èü¸¡I=]}M1Q=H¤ñð¹Õ±°ì(€€€€€½Á•¹‘¥Ñ½É½È¡¥°…¹¡½È¤¹…Ñ   ¤€ôøíô¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€¥˜€¡…Ñ¥Ù•‘¥Ñ½È€˜˜€……Ñ¥Ù•‘¥Ñ½È¹½¹Ñ…¥¹Ì¡•Ù•¹Ð¹Ñ…É•Ð¤¤ì(€€€€€½¹ÍÐÍ¡•±°€ô•Ù•¹Ð¹Ñ…É•Ðü¹±½Í•ÍÐü¸ œ¹ÁŒµ¡…Ðµ½É…¹¥é•ÈµÍ¡•±°œ¤ì(€€€€€¥˜€ …Í¡•±°¤±½Í•‘¥Ñ½È ¤ì(€€€ô(€ô((€™Õ¹Ñ¥½¸ÍÑ…ÉÑ=‰Í•ÉÙ•È ¤ì(€€€½‰Í•ÉÙ•Èü¹‘¥Í½¹¹•Ð ¤ì(€€€½‰Í•ÉÙ•È€ô¹•Ü5ÕÑ…Ñ¥½¹=‰Í•ÉÙ•È ¡µÕÑ…Ñ¥½¹Ì¤€ôøì(€€€€€¥˜€¡µÕÑ…Ñ¥½¹Ì¹Í½µ” ¡µÕÑ…Ñ¥½¸¤€ôøl¸¸¹µÕÑ…Ñ¥½¸¹…‘‘•‘9½‘•Ít¹Í½µ” ¡¹½‘”¤€ôøì(€€€€€€€¥˜€¡¹½‘”ü¹¹½‘•QåÁ”€„ôô9½‘”¹159Q}9=¤É•ÑÕÉ¸™…±Í”ì(€€€€€€€¥˜€¡¹½‘”¹¡…ÍÑÑÉ¥‰ÕÑ”ü¸¡=]9¤ñð¹½‘”¹±½Í•ÍÐü¸¡l‘í=]9õu€¤¤É•ÑÕÉ¸™…±Í”ì(€€€€€€€É•ÑÕÉ¸¹½‘”¹µ…Ñ¡•Ìü¸¡I=]}M1Q=H¤ñð¹½‘”¹ÅÕ•ÉåM•±•Ñ½Èü¸¡I=]}M1Q=H¤ì(€€€€€ô¤¤¤Í¡•‘Õ±•M…¸ ¤ì(€€€ô¤ì(€€€½‰Í•ÉÙ•È¹½‰Í•ÉÙ”¡‘½Õµ•¹Ð¹‘½Õµ•¹Ñ±•µ•¹Ð°ì¡¥±‘1¥ÍÐéÑÉÕ”°ÍÕ‰ÑÉ•”éÑÉÕ”ô¤ì(€ô((€ÍÑ½É…•1¥ÍÑ•¹•È€ô€¡¡…¹•Ì°…É•…9…µ”¤€ôøì(€€€¥˜€¡…É•…9…µ”€„ôô€±½…°œñð€…¡…¹•Ìü¹m=IQ%=9M}-et¤É•ÑÕÉ¸ì(€€€‘•½É…Ñ¥½¹Ì€ô½É”¹¹½Éµ…±¥é••½É…Ñ¥½¹Ì¡¡…¹•Ím=IQ%=9M}-et¹¹•ÝY…±Õ”¤ì(€€€Í¡•‘Õ±•M…¸ ¤ì(€ôì(€¡É½µ”¹ÍÑ½É…”¹½¹¡…¹•¹…‘‘1¥ÍÑ•¹•È¡ÍÑ½É…•1¥ÍÑ•¹•È¤ì((€µ•ÍÍ…•1¥ÍÑ•¹•È€ô€¡µ•ÍÍ…”°}Í•¹‘•È°Í•¹‘I•ÍÁ½¹Í”¤€ôøì(€€€¥˜€ …µ•ÍÍ…”ü¹ÑåÁ”ü¹ÍÑ…ÉÑÍ]¥Ñ ü¸ A}!Q}=I9%iI|œ¤¤É•ÑÕÉ¸™…±Í”ì(€€€¥˜€¡µ•ÍÍ…”¹ÑåÁ”€ôôô€A}!Q}=I9%iI}A%9œ¤ì(€€€€€Í•¹‘I•ÍÁ½¹Í”¡ì½¬éÑÉÕ”°Ù•ÉÍ¥½¸éYIM%=8°ÕÉ°é±½…Ñ¥½¸¹¡É•˜ô¤ìÉ•ÑÕÉ¸™…±Í”ì(€€€ô(€€€¥˜€¡µ•ÍÍ…”¹ÑåÁ”€ôôô€A}!Q}=I9%iI}IM8œ¤ì(€€€€€Í¡•‘Õ±•M…¸ ¤ìÍ•¹‘I•ÍÁ½¹Í”¡ì½¬éÑÉÕ”ô¤ìÉ•ÑÕÉ¸™…±Í”ì(€€€ô(€€€¥˜€¡µ•ÍÍ…”¹ÑåÁ”€ôôô€A}!Q}=I9%iI}Q}=IQ%=8œ¤ì(€€€€€½¹ÍÐ­•ä€ôµ•ÍÍ…”¹­•äñð½É”¹‘•½É…Ñ¥½¹-•ä¡µ•ÍÍ…”¹ÕÉ°ñð±½…Ñ¥½¸¹¡É•˜¤ì(€€€€€Í•¹‘I•ÍÁ½¹Í”¡ì½¬éÑÉÕ”°­•ä°‘•½É…Ñ¥½¸é½É”¹¹½Éµ…±¥é••½É…Ñ¥½¸¡‘•½É…Ñ¥½¹Ím­•åtñðíô¤ô¤ìÉ•ÑÕÉ¸™…±Í”ì(€€€ô(€€€¥˜€¡µ•ÍÍ…”¹ÑåÁ”€ôôô€A}!Q}=I9%iI}MQ}=IQ%=8œ¤ì(€€€€€½¹ÍÐ­•ä€ôµ•ÍÍ…”¹­•äñð½É”¹‘•½É…Ñ¥½¹-•ä¡µ•ÍÍ…”¹ÕÉ°ñð±½…Ñ¥½¸¹¡É•˜¤ì(€€€€€Í…Ù••½É…Ñ¥½¸¡­•ä°µ•ÍÍ…”¹‘•½É…Ñ¥½¸ñðíô¤¹Ñ¡•¸¡Í•¹‘I•ÍÁ½¹Í”¤ìÉ•ÑÕÉ¸ÑÉÕ”ì(€€€ô(€€€¥˜€¡µ•ÍÍ…”¹ÑåÁ”€ôôô€A}!Q}=I9%iI}I95œ¤ì(€€€€€½¹ÍÐ¥€ô±•…¸¡µ•ÍÍ…”¹½¹Ù•ÉÍ…Ñ¥½¹%ñð½É”¹½¹Ù•ÉÍ…Ñ¥½¹%¡µ•ÍÍ…”¹ÕÉ°ñð±½…Ñ¥½¸¹¡É•˜¤°€ÈÀÀ¤ì(€€€€€É•¹…µ•¡…Ð¡¥°µ•ÍÍ…”¹Ñ¥Ñ±”¤¹Ñ¡•¸¡Í•¹‘I•ÍÁ½¹Í”¤ìÉ•ÑÕÉ¸ÑÉÕ”ì(€€€ô(€€€¥˜€¡µ•ÍÍ…”¹ÑåÁ”€ôôô€A}!Q}=I9%iI}=A9}%Q=Hœ¤ì(€€€€€½¹ÍÐ¥€ô±•…¸¡µ•ÍÍ…”¹½¹Ù•ÉÍ…Ñ¥½¹%ñð½É”¹½¹Ù•ÉÍ…Ñ¥½¹%¡µ•ÍÍ…”¹ÕÉ°ñð±½…Ñ¥½¸¹¡É•˜¤°€ÈÀÀ¤ì(€€€€€½Á•¹‘¥Ñ½É½È¡¥¤¹Ñ¡•¸¡Í•¹‘I•ÍÁ½¹Í”¤ìÉ•ÑÕÉ¸ÑÉÕ”ì(€€€ô(€€€É•ÑÕÉ¸™…±Í”ì(€ôì(€¡É½µ”¹ÉÕ¹Ñ¥µ”¹½¹5•ÍÍ…”¹…‘‘1¥ÍÑ•¹•È¡µ•ÍÍ…•1¥ÍÑ•¹•È¤ì((€‘½Õµ•¹Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°‘•±•…Ñ•‘±¥¬°ÑÉÕ”¤ì(€‘½Õµ•¹Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ­•å‘½Ý¸œ°€¡•Ù•¹Ð¤€ôøì¥˜€¡•Ù•¹Ð¹­•ä€ôôô€Í…Á”œ€˜˜…Ñ¥Ù•‘¥Ñ½È¤±½Í•‘¥Ñ½È ¤ìô°ÑÉÕ”¤ì(€Ý¥¹‘½Ü¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È É•Í¥é”œ°€ ¤€ôøì¥˜€¡…Ñ¥Ù•‘¥Ñ½È€˜˜…Ñ¥Ù•¹¡½È¤Á½Í¥Ñ¥½¹‘¥Ñ½È¡…Ñ¥Ù•‘¥Ñ½È°É½ÝM¡•±°¡…Ñ¥Ù•¹¡½È¤¤ìô°ìÁ…ÍÍ¥Ù”éÑÉÕ”ô¤ì((€±½…‘•½É…Ñ¥½¹Ì ¤¹…Ñ   ¤€ôøíô¤ì(€ÍÑ…ÉÑ=‰Í•ÉÙ•È ¤ì(€Í¡•‘Õ±•M…¸ ¤ì)ô¤ ¤ì(