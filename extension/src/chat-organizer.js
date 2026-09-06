(() => {
  'use strict';

  const core = globalThis.ProjectConstellationChatVaultCore;
  if (!core || globalThis.__ProjectConstellationChatOrganizerV2) return;
  if (!['chatgpt.com','chat.openai.com'].includes(location.hostname.toLowerCase())) return;
  globalThis.__ProjectConstellationChatOrganizerV2 = true;

  const VERSION = '1.1.0';
  const KEY = core.DECORATIONS_KEY;
  const OWNED = 'data-project-constellation-chat-organizer';
  const ROW = 'a[href*="/c/"]';
  const STYLES = new Set(core.STYLE_VALUES);
  const EMOJI = ['🔥','📌','💡','🧪','✅','🧠','💻','🎮','🌟','🚀','💜','📚','🔨','🧹','🚧','💎'];
  const clean = core.clean;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  let decorations = {};
  let scanFrame = 0;
  let observer = null;
  let editor = null;
  let editorAnchor = null;

  const idFor = (anchor) => core.conversationId(anchor?.href || anchor?.getAttribute?.('href') || '');
  const keyFor = (anchor) => core.decorationKey(anchor?.href || anchor?.getAttribute?.('href') || '');
  const rowShell = (anchor) => anchor?.closest?.('li,[data-testid*="history" i] > div,[role="listitem"]') || anchor?.parentElement || null;

  function plainTitle(anchor) {
    if (!anchor) return '';
    const clone = anchor.cloneNode(true);
    clone.querySelectorAll(`[${OWNED}]`).forEach((node) => node.remove());
    return clean(clone.textContent || anchor.getAttribute('aria-label') || document.title || 'Chat', 300);
  }

  function ensureOwned(shell, selector, tag, className) {
    let node = shell.querySelector(`:scope > ${selector}`);
    if (!node) {
      node = document.createElement(tag);
      node.className = className;
      node.setAttribute(OWNED, '1');
      shell.appendChild(node);
    }
    return node;
  }

  function decorate(anchor) {
    const id = idFor(anchor);
    const key = keyFor(anchor);
    const shell = rowShell(anchor);
    if (!id || !key || !shell) return;
    const value = core.normalizeDecoration(decorations[key] || {});
    anchor.classList.add('pc-chat-decorated');
    anchor.dataset.pcDecorationKey = key;
    anchor.dataset.pcStyle = STYLES.has(value.style) ? value.style : 'clean';
    if (value.color) anchor.style.setProperty('--pc-chat-color', value.color);
    else anchor.style.removeProperty('--pc-chat-color');
    shell.classList.add('pc-chat-organizer-shell');

    let emoji = anchor.querySelector(':scope > .pc-chat-emoji');
    if (!emoji) {
      emoji = document.createElement('span');
      emoji.className = 'pc-chat-emoji';
      emoji.setAttribute(OWNED, '1');
      emoji.setAttribute('aria-hidden', 'true');
      anchor.insertBefore(emoji, anchor.firstChild);
    }
    emoji.textContent = value.emoji || '';
    emoji.hidden = !value.emoji;

    const button = ensureOwned(shell, '.pc-chat-style-button', 'button', 'pc-chat-style-button');
    button.type = 'button';
    button.textContent = '✦';
    button.dataset.pcConversationId = id;
    button.dataset.pcDecorationKey = key;
    button.title = 'Emoji, color, text style, or rename this chat';
    button.setAttribute('aria-label', 'Style this chat with Project Constellation');
  }

  function scanRows() {
    scanFrame = 0;
    const roots = [document.querySelector('nav'), document.querySelector('aside')].filter(Boolean);
    for (const root of roots.length ? roots : [document]) {
      root.querySelectorAll(ROW).forEach(decorate);
    }
  }

  function scheduleScan() {
    if (!scanFrame) scanFrame = requestAnimationFrame(scanRows);
  }

  async function loadDecorations() {
    const stored = await chrome.storage.local.get(KEY).catch(() => ({}));
    decorations = core.normalizeDecorations(stored?.[KEY]);
    scheduleScan();
  }

  async function saveDecoration(key, patch = {}) {
    if (!key) return { ok:false, error:'Missing chat identity.' };
    const next = core.normalizeDecoration({ ...(decorations[key] || {}), ...patch, updatedAt:Date.now() });
    const copy = { ...decorations };
    if (!next.emoji && !next.color && next.style === 'clean') delete copy[key];
    else copy[key] = next;
    decorations = copy;
    await chrome.storage.local.set({ [KEY]:decorations });
    scheduleScan();
    return { ok:true, decoration:next };
  }

  const visible = (node) => {
    if (!node?.isConnected) return false;
    const rect = node.getBoundingClientRect?.();
    if (rect && rect.width <= 0 && rect.height <= 0) return false;
    const style = getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.01;
  };

  async function until(fn, timeout = 2200, interval = 45) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const value = fn();
      if (value) return value;
      await wait(interval);
    }
    return null;
  }

  const findAnchor = (id) => [...document.querySelectorAll(ROW)].find((anchor) => idFor(anchor) === clean(id, 200)) || null;

  function scrollers() {
    const nav = document.querySelector('nav') || document.querySelector('aside');
    if (!nav) return [];
    return [nav, ...nav.querySelectorAll('div')]
      .filter((node) => node.scrollHeight > node.clientHeight + 120 && node.clientHeight > 180)
      .sort((a,b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))
      .slice(0,3);
  }

  async function locate(id) {
    const direct = findAnchor(id);
    if (direct) return { anchor:direct, restore:null };
    for (const scroller of scrollers()) {
      const original = scroller.scrollTop;
      const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const step = Math.max(220, Math.floor(scroller.clientHeight * 0.82));
      for (let pos = 0; pos <= max; pos += step) {
        scroller.scrollTop = Math.min(pos, max);
        await wait(36);
        const anchor = findAnchor(id);
        if (anchor) return { anchor, restore:() => { scroller.scrollTop = original; } };
      }
      scroller.scrollTop = original;
    }
    return { anchor:null, restore:null };
  }

  function hover(node) {
    for (const type of ['pointerenter','mouseenter','mouseover']) {
      try { node?.dispatchEvent(new MouseEvent(type, { bubbles:true, view:window })); } catch (_) {}
    }
  }

  function actionsButton(shell) {
    const buttons = [...(shell?.querySelectorAll?.('button:not(.pc-chat-style-button)') || [])].filter(visible);
    return buttons.find((button) => /more|option|menu|actions|chat/i.test(`${button.getAttribute('aria-label') || ''} ${button.title || ''}`)) ||
      buttons.find((button) => /…|\.\.\./.test(clean(button.textContent || '', 20))) || buttons.at(-1) || null;
  }

  function openMenu() {
    return [...document.querySelectorAll('[role="menu"],[data-radix-menu-content],[data-testid*="menu" i]')].filter(visible).at(-1) || null;
  }

  function renameChoice(menu) {
    return [...(menu?.querySelectorAll?.('[role="menuitem"],button') || [])].filter(visible)
      .find((node) => /(^|\s)rename(\s|$)/i.test(clean(`${node.textContent || ''} ${node.getAttribute('aria-label') || ''}`, 140))) || null;
  }

  function renameInput(shell, oldTitle) {
    const inputs = [...document.querySelectorAll('input:not([type="hidden"]),textarea')].filter(visible);
    return inputs.find((input) => shell?.contains(input)) ||
      inputs.find((input) => input.closest('[role="dialog"]')) ||
      inputs.find((input) => clean(input.value || '', 300) === clean(oldTitle, 300)) ||
      inputs.find((input) => /rename|title|chat/i.test(`${input.getAttribute('aria-label') || ''} ${input.placeholder || ''}`)) || null;
  }

  function setInput(input, value) {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(input, value); else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles:true }));
    input.dispatchEvent(new Event('change', { bubbles:true }));
  }

  function submitRename(input) {
    const root = input.closest('[role="dialog"]') || input.parentElement?.parentElement || input.parentElement;
    const button = [...(root?.querySelectorAll?.('button') || [])].filter(visible)
      .find((node) => /^(save|rename|done)$/i.test(clean(node.textContent || node.getAttribute('aria-label') || '', 80)));
    if (button) return button.click();
    input.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', code:'Enter', bubbles:true, cancelable:true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key:'Enter', code:'Enter', bubbles:true }));
  }

  async function renameChat(conversationId, requestedTitle) {
    const title = clean(requestedTitle, 120);
    if (!title) return { ok:false, error:'Enter a chat name first.' };
    const found = await locate(conversationId);
    if (!found.anchor) return { ok:false, error:'That chat row is not mounted in the ChatGPT sidebar yet. Open or scroll the chat list once and try again.' };
    const shell = rowShell(found.anchor);
    const oldTitle = plainTitle(found.anchor);
    try {
      hover(shell);
      await wait(55);
      const menuButton = actionsButton(shell);
      if (!menuButton) return { ok:false, error:'ChatGPT did not expose its chat actions button.' };
      menuButton.click();
      const menu = await until(openMenu, 1800, 35);
      const choice = renameChoice(menu);
      if (!choice) return { ok:false, error:'The current ChatGPT chat menu does not expose Rename.' };
      choice.click();
      const input = await until(() => renameInput(shell, oldTitle), 2000, 35);
      if (!input) return { ok:false, error:'ChatGPT opened Rename but its title editor was not found.' };
      input.focus();
      setInput(input, title);
      submitRename(input);
      const verified = await until(() => {
        const anchor = findAnchor(conversationId);
        return anchor && plainTitle(anchor).includes(title) ? anchor : null;
      }, 2600, 70);
      scheduleScan();
      return { ok:true, title, verified:Boolean(verified), previousTitle:oldTitle };
    } catch (error) {
      return { ok:false, error:clean(error?.message || error || 'Rename failed.', 300) };
    } finally {
      try { found.restore?.(); } catch (_) {}
    }
  }

  function closeEditor() {
    editor?.remove();
    editor = null;
    editorAnchor = null;
  }

  function positionEditor(shell) {
    if (!editor) return;
    const rect = shell?.getBoundingClientRect?.();
    const width = Math.min(352, Math.max(290, innerWidth - 24));
    let top = rect ? rect.bottom + 8 : 72;
    const left = rect ? Math.max(12, Math.min(rect.left, innerWidth - width - 12)) : Math.max(12, innerWidth - width - 18);
    if (top + 390 > innerHeight) top = Math.max(12, (rect?.top || innerHeight) - 390);
    Object.assign(editor.style, { width:`${width}px`, top:`${Math.round(top)}px`, left:`${Math.round(left)}px` });
  }

  async function openEditorFor(conversationId, preferred = null) {
    const found = preferred ? { anchor:preferred } : await locate(conversationId);
    const anchor = found.anchor;
    if (!anchor) return { ok:false, error:'That chat row is not currently mounted in the ChatGPT sidebar.' };
    const shell = rowShell(anchor);
    const key = keyFor(anchor);
    if (!shell || !key) return { ok:false, error:'Could not resolve the chat row.' };
    closeEditor();
    editorAnchor = anchor;
    const current = core.normalizeDecoration(decorations[key] || {});
    const panel = document.createElement('section');
    panel.id = 'projectConstellationChatStylePopover';
    panel.setAttribute(OWNED, '1');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Project Constellation chat style editor');
    panel.innerHTML = `
      <div class="pc-chat-editor-head"><div><span>PROJECT CONSTELLATION</span><strong class="pc-editor-title"></strong></div><button type="button" class="pc-chat-editor-close" aria-label="Close">×</button></div>
      <label class="pc-chat-editor-label">Emoji</label><div class="pc-chat-emoji-presets"></div><input class="pc-chat-emoji-input" maxlength="16" placeholder="emoji">
      <div class="pc-chat-editor-grid"><label>Color<span class="pc-chat-color-line"><input class="pc-color" type="color"><input class="pc-color-enabled" type="checkbox" title="Use custom color"></span></label><label>Text style<select class="pc-style"><option value="clean">Clean</option><option value="bold">Bold</option><option value="serif">Serif</option><option value="italic">Italic</option><option value="mono">Mono</option><option value="wide">Wide</option><option value="glow">Glow</option><option value="soft">Soft pill</option></select></label></div>
      <div class="pc-chat-editor-actions"><button type="button" class="primary pc-apply">Apply style</button><button type="button" class="pc-clear">Clear</button><span class="pc-chat-editor-status"></span></div>
      <div class="pc-chat-editor-divider"></div><label class="pc-chat-editor-label">Rename the actual ChatGPT chat</label><div class="pc-chat-rename-row"><input class="pc-rename" maxlength="120" placeholder="Chat name"><button type="button" class="primary pc-rename-go">Rename</button></div><small class="pc-chat-rename-status">Uses ChatGPT's own visible Rename UI; no provider API request.</small>`;
    panel.querySelector('.pc-editor-title').textContent = plainTitle(anchor) || 'Chat style';
    const emojiInput = panel.querySelector('.pc-chat-emoji-input');
    const color = panel.querySelector('.pc-color');
    const colorEnabled = panel.querySelector('.pc-color-enabled');
    const style = panel.querySelector('.pc-style');
    const rename = panel.querySelector('.pc-rename');
    const status = panel.querySelector('.pc-chat-editor-status');
    emojiInput.value = current.emoji;
    color.value = current.color || '#8b5cf6';
    colorEnabled.checked = Boolean(current.color);
    style.value = current.style;
    rename.value = plainTitle(anchor);
    for (const value of EMOJI) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = value;
      button.addEventListener('click', () => { emojiInput.value = value; });
      panel.querySelector('.pc-chat-emoji-presets').appendChild(button);
    }
    panel.querySelector('.pc-chat-editor-close').addEventListener('click', closeEditor);
    panel.querySelector('.pc-apply').addEventListener('click', async () => {
      status.textContent = 'Saving...';
      await saveDecoration(key, { emoji:emojiInput.value, color:colorEnabled.checked ? color.value : '', style:style.value });
      status.textContent = 'Saved';
    });
    panel.querySelector('.pc-clear').addEventListener('click', async () => {
      emojiInput.value = ''; colorEnabled.checked = false; style.value = 'clean';
      await saveDecoration(key, { emoji:'', color:'', style:'clean' }); status.textContent = 'Cleared';
    });
    const runRename = async () => {
      const value = rename.value;
      closeEditor();
      const result = await renameChat(conversationId, value);
      if (!result.ok) {
        const reopened = await openEditorFor(conversationId);
        const note = reopened.ok ? editor?.querySelector('.pc-chat-rename-status') : null;
        if (note) note.textContent = result.error;
      }
    };
    panel.querySelector('.pc-rename-go').addEventListener('click', runRename);
    rename.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); runRename(); } });
    document.body.appendChild(panel);
    editor = panel;
    positionEditor(shell);
    requestAnimationFrame(() => panel.classList.add('open'));
    return { ok:true, key, conversationId };
  }

  document.addEventListener('click', (event) => {
    const button = event.target?.closest?.('.pc-chat-style-button');
    if (button) {
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation?.();
      const shell = button.closest('.pc-chat-organizer-shell');
      openEditorFor(button.dataset.pcConversationId, shell?.querySelector?.(ROW) || null).catch(() => {});
      return;
    }
    if (editor && !editor.contains(event.target) && !event.target?.closest?.('.pc-chat-organizer-shell')) closeEditor();
  }, true);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeEditor(); }, true);
  addEventListener('resize', () => { if (editor && editorAnchor) positionEditor(rowShell(editorAnchor)); }, { passive:true });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes?.[KEY]) return;
    decorations = core.normalizeDecorations(changes[KEY].newValue);
    scheduleScan();
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message?.type?.startsWith?.('PC_CHAT_ORGANIZER_')) return false;
    const key = message.key || core.decorationKey(message.url || location.href);
    const id = clean(message.conversationId || core.conversationId(message.url || location.href), 200);
    if (message.type === 'PC_CHAT_ORGANIZER_PING') { sendResponse({ ok:true, version:VERSION, url:location.href }); return false; }
    if (message.type === 'PC_CHAT_ORGANIZER_RESCAN') { scheduleScan(); sendResponse({ ok:true }); return false; }
    if (message.type === 'PC_CHAT_ORGANIZER_GET_DECORATION') { sendResponse({ ok:true, key, decoration:core.normalizeDecoration(decorations[key] || {}) }); return false; }
    if (message.type === 'PC_CHAT_ORGANIZER_SET_DECORATION') { saveDecoration(key, message.decoration || {}).then(sendResponse); return true; }
    if (message.type === 'PC_CHAT_ORGANIZER_RENAME') { renameChat(id, message.title).then(sendResponse); return true; }
    if (message.type === 'PC_CHAT_ORGANIZER_OPEN_EDITOR') { openEditorFor(id).then(sendResponse); return true; }
    return false;
  });

  observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => [...mutation.addedNodes].some((node) => node?.nodeType === Node.ELEMENT_NODE && !node.closest?.(`[${OWNED}]`) && (node.matches?.(ROW) || node.querySelector?.(ROW))))) scheduleScan();
  });
  observer.observe(document.documentElement, { childList:true, subtree:true });

  loadDecorations().catch(() => {});
  scheduleScan();
})();
