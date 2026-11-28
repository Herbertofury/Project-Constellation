(() => {
  'use strict';

  const core = globalThis.ProjectConstellationChatVaultCore;
  const projectIdentity = globalThis.ProjectConstellationProjectIdentity;
  if (!core || !projectIdentity || globalThis.__ProjectConstellationChatOrganizerV3) return;
  if (!['chatgpt.com','chat.openai.com'].includes(location.hostname.toLowerCase())) return;
  globalThis.__ProjectConstellationChatOrganizerV3 = true;

  const VERSION = '1.2.0';
  const KEY = core.DECORATIONS_KEY;
  const VAULT_KEY = core.VAULT_KEY;
  const OWNED = 'data-project-constellation-chat-organizer';
  const ROW = 'a[href*="/c/"]';
  const STYLES = new Set(core.STYLE_VALUES);
  const EMOJI = ['\u{1F525}','\u{1F4CC}','\u{1F4A1}','\u{1F9EA}','\u{2705}','\u{1F9E0}','\u{1F4BB}','\u{1F3AE}','\u{1F31F}','\u{1F680}','\u{1F49C}','\u{1F4DA}','\u{1F528}','\u{1F9F9}','\u{1F6A7}','\u{1F48E}'];
  const clean = core.clean;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const CONTEXT_TTL = 5 * 60 * 1000;
  const CONTEXT_CONCURRENCY = 3;

  let decorations = {};
  let vault = core.emptyVault();
  let scanFrame = 0;
  let observer = null;
  let editor = null;
  let editorAnchor = null;
  let contextActive = 0;
  let menuTarget = null;
  const contextCache = new Map();
  const contextPending = new Set();
  const contextQueue = [];

  const idFor = (anchor) => core.conversationId(anchor?.href || anchor?.getAttribute?.('href') || '');
  const keyFor = (anchor) => core.decorationKey(anchor?.href || anchor?.getAttribute?.('href') || '');
  const vaultKeyFor = (anchor) => core.chatKey(anchor?.href || anchor?.getAttribute?.('href') || '');
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

  function setIcon(node, token, className = 'pc-project-vector-icon') {
    if (!node) return;
    node.replaceChildren();
    const normalized = projectIdentity.normalizeIcon(token || '', '');
    if (!normalized) return;
    const markup = projectIdentity.iconMarkup(normalized, className);
    if (markup) node.innerHTML = markup;
    else node.textContent = normalized;
  }

  function localProjectsFor(anchor) {
    const key = vaultKeyFor(anchor);
    if (!key) return [];
    return (vault.stacks || []).filter((stack) => (stack.items || []).some((item) => item?.key === key)).map((stack) => ({
      id:`vault:${stack.id}`,
      name:stack.name,
      icon:stack.icon || '',
      color:stack.color,
      source:'command-center'
    }));
  }

  function cachedContext(id) {
    const row = contextCache.get(id);
    return row && Date.now() - row.at < CONTEXT_TTL ? row.context : null;
  }

  function pumpContexts() {
    while (contextActive < CONTEXT_CONCURRENCY && contextQueue.length) {
      const id = contextQueue.shift();
      if (!id || contextPending.has(id)) continue;
      contextPending.add(id);
      contextActive += 1;
      chrome.runtime.sendMessage({ type:'PC_CHAT_ORGANIZER_CONTEXT', chatId:id }).then((response) => {
        if (response?.ok) contextCache.set(id, { at:Date.now(), context:response.context || {} });
      }).catch(() => {}).finally(() => {
        contextPending.delete(id);
        contextActive = Math.max(0, contextActive - 1);
        scheduleScan();
        pumpContexts();
      });
    }
  }

  function queueContext(id) {
    if (!id || cachedContext(id) || contextPending.has(id) || contextQueue.includes(id)) return;
    contextQueue.push(id);
    pumpContexts();
  }

  async function getContext(id, force = false) {
    const cached = !force && cachedContext(id);
    if (cached) return cached;
    try {
      const response = await chrome.runtime.sendMessage({ type:'PC_CHAT_ORGANIZER_CONTEXT', chatId:id });
      if (response?.ok) {
        const context = response.context || {};
        contextCache.set(id, { at:Date.now(), context });
        return context;
      }
    } catch (_) {}
    return cachedContext(id) || {};
  }

  function projectRows(anchor, context = {}) {
    const title = plainTitle(anchor);
    const rows = [];
    const add = (project, source, score = 1, fingerprint = '') => {
      if (!project?.name && !project?.id) return;
      const identity = projectIdentity.identity(project);
      const key = `${project.id || ''}|${project.name || ''}|${identity.icon}`;
      if (rows.some((row) => row.key === key)) return;
      rows.push({ key, project, source, score:Number(score || 0), fingerprint, identity });
    };
    if (context.assignedProject) add(context.assignedProject, 'assigned', 1);
    for (const project of localProjectsFor(anchor)) add(project, 'command-center', .99);
    if (context.chat?.projectName && !/^inbox$/i.test(context.chat.projectName)) {
      add({ id:`provider:${context.chat.projectId || context.chat.projectName}`, name:context.chat.projectName, icon:projectIdentity.semanticIcon(context.chat.projectName), color:'#8d99ae' }, 'provider', .94);
    }
    for (const candidate of context.suggestions || []) {
      if (Number(candidate.score || 0) >= .68 && candidate.project) add(candidate.project, 'suggested', candidate.score, candidate.fingerprint || '');
    }
    const anchorFamily = rows[0]?.project?.name || title;
    for (const project of context.projects || []) {
      if (projectIdentity.sameFamily(project.name || '', anchorFamily) || projectIdentity.sameFamily(project.name || '', title)) add(project, 'family', .66);
    }
    return rows.sort((a,b) => b.score - a.score || a.project.name.localeCompare(b.project.name));
  }

  function primaryIdentity(anchor, decoration, context) {
    if (decoration.iconMode === 'none') return null;
    if (decoration.iconMode === 'manual') {
      const token = decoration.iconKey || decoration.emoji;
      if (!token) return null;
      return { token, color:decoration.color || '#8b5cf6', label:'Custom chat icon', source:'manual' };
    }
    const rows = projectRows(anchor, context);
    const first = rows[0];
    if (first) return { token:first.identity.icon, color:decoration.color || first.identity.color, label:first.project.name || 'Matched project', source:first.source, row:first };
    if (decoration.iconMode === 'project') return null;
    const title = plainTitle(anchor);
    return { token:projectIdentity.semanticIcon(title), color:decoration.color || '#7d92ff', label:`Smart icon for ${title || 'chat'}`, source:'semantic' };
  }

  function secondaryIdentities(anchor, decoration, context, primary) {
    if (!decoration.showProjectBadges) return [];
    const seen = new Set([primary?.row?.key || '']);
    return projectRows(anchor, context).filter((row) => {
      if (seen.has(row.key)) return false;
      seen.add(row.key);
      return row.source !== 'provider' || row.score >= .9;
    }).slice(0,3);
  }

  function decorate(anchor) {
    const id = idFor(anchor);
    const key = keyFor(anchor);
    const shell = rowShell(anchor);
    if (!id || !key || !shell) return;
    const value = core.normalizeDecoration(decorations[key] || {});
    const context = cachedContext(id) || {};
    queueContext(id);
    anchor.classList.add('pc-chat-decorated');
    anchor.dataset.pcDecorationKey = key;
    anchor.dataset.pcStyle = STYLES.has(value.style) ? value.style : 'clean';
    if (value.color) anchor.style.setProperty('--pc-chat-color', value.color);
    else anchor.style.removeProperty('--pc-chat-color');
    shell.classList.add('pc-chat-organizer-shell');
    shell.dataset.pcConversationId = id;

    let identityWrap = anchor.querySelector(':scope > .pc-chat-project-identity-wrap');
    if (!identityWrap) {
      identityWrap = document.createElement('span');
      identityWrap.className = 'pc-chat-project-identity-wrap';
      identityWrap.setAttribute(OWNED, '1');
      identityWrap.setAttribute('aria-hidden', 'true');
      anchor.insertBefore(identityWrap, anchor.firstChild);
    }
    const primary = primaryIdentity(anchor, value, context);
    identityWrap.replaceChildren();
    if (primary) {
      const main = document.createElement('span');
      main.className = 'pc-chat-project-icon';
      main.style.setProperty('--pc-project-color', projectIdentity.normalizeColor(primary.color));
      main.title = primary.label;
      setIcon(main, primary.token);
      identityWrap.appendChild(main);
      for (const row of secondaryIdentities(anchor, value, context, primary)) {
        const badge = document.createElement('span');
        badge.className = 'pc-chat-project-badge';
        badge.style.setProperty('--pc-project-color', row.identity.color);
        badge.title = `${row.source === 'family' ? 'Related project' : 'Also matches'}: ${row.project.name}`;
        setIcon(badge, row.identity.icon);
        identityWrap.appendChild(badge);
      }
    }
    identityWrap.hidden = !identityWrap.childElementCount;

    const oldEmoji = anchor.querySelector(':scope > .pc-chat-emoji');
    oldEmoji?.remove();

    const button = ensureOwned(shell, '.pc-chat-style-button', 'button', 'pc-chat-style-button');
    button.type = 'button';
    button.textContent = '\u2726';
    button.dataset.pcConversationId = id;
    button.dataset.pcDecorationKey = key;
    button.title = 'Project icon, smart project match, color, text style, or rename';
    button.setAttribute('aria-label', 'Project Constellation chat appearance and project match');
  }

  function scanRows() {
    scanFrame = 0;
    const roots = [document.querySelector('nav'), document.querySelector('aside')].filter(Boolean);
    for (const root of roots.length ? roots : [document]) root.querySelectorAll(ROW).forEach(decorate);
    injectOpenNativeMenu();
  }

  function scheduleScan() {
    if (!scanFrame) scanFrame = requestAnimationFrame(scanRows);
  }

  async function loadState() {
    const stored = await chrome.storage.local.get([KEY,VAULT_KEY]).catch(() => ({}));
    decorations = core.normalizeDecorations(stored?.[KEY]);
    vault = core.normalizeVault(stored?.[VAULT_KEY]);
    scheduleScan();
  }

  async function saveDecoration(key, patch = {}) {
    if (!key) return { ok:false, error:'Missing chat identity.' };
    const next = core.normalizeDecoration({ ...(decorations[key] || {}), ...patch, updatedAt:Date.now() });
    const copy = { ...decorations };
    const isDefault = !next.emoji && !next.iconKey && next.iconMode === 'auto' && next.showProjectBadges && !next.color && next.style === 'clean';
    if (isDefault) delete copy[key];
    else copy[key] = next;
    decorations = copy;
    await chrome.storage.local.set({ [KEY]:decorations });
    scheduleScan();
    return { ok:true, decoration:next };
  }

  async function setChatProject(chatId, projectId) {
    const response = await chrome.runtime.sendMessage({ type:'PC_CHAT_ORGANIZER_PROJECT_SET', chatId, projectId:projectId || '' }).catch((error) => ({ ok:false, error:error?.message || String(error) }));
    if (response?.ok) {
      contextCache.delete(chatId);
      await getContext(chatId, true);
      scheduleScan();
    }
    return response;
  }

  async function patchChat(chatId, patch) {
    const response = await chrome.runtime.sendMessage({ type:'PC_ORG_CHAT_PATCH', chatIds:[chatId], patch }).catch((error) => ({ ok:false, error:error?.message || String(error) }));
    if (response?.ok) {
      contextCache.delete(chatId);
      await getContext(chatId, true);
      scheduleScan();
    }
    return response;
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
    return [nav, ...nav.querySelectorAll('div')].filter((node) => node.scrollHeight > node.clientHeight + 120 && node.clientHeight > 180).sort((a,b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight)).slice(0,3);
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
    return buttons.find((button) => /more|option|menu|actions|chat/i.test(`${button.getAttribute('aria-label') || ''} ${button.title || ''}`)) || buttons.find((button) => /\u2026|\.\.\./.test(clean(button.textContent || '', 20))) || buttons.at(-1) || null;
  }

  function openMenu() {
    return [...document.querySelectorAll('[role="menu"],[data-radix-menu-content],[data-testid*="menu" i]')].filter(visible).at(-1) || null;
  }

  function renameChoice(menu) {
    return [...(menu?.querySelectorAll?.('[role="menuitem"],button') || [])].filter(visible).find((node) => /(^|\s)rename(\s|$)/i.test(clean(`${node.textContent || ''} ${node.getAttribute('aria-label') || ''}`, 140))) || null;
  }

  function renameInput(shell, oldTitle) {
    const inputs = [...document.querySelectorAll('input:not([type="hidden"]),textarea')].filter(visible);
    return inputs.find((input) => shell?.contains(input)) || inputs.find((input) => input.closest('[role="dialog"]')) || inputs.find((input) => clean(input.value || '', 300) === clean(oldTitle, 300)) || inputs.find((input) => /rename|title|chat/i.test(`${input.getAttribute('aria-label') || ''} ${input.placeholder || ''}`)) || null;
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
    const button = [...(root?.querySelectorAll?.('button') || [])].filter(visible).find((node) => /^(save|rename|done)$/i.test(clean(node.textContent || node.getAttribute('aria-label') || '', 80)));
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
      menuTarget = { id:conversationId, anchor:found.anchor, at:Date.now(), suppressInject:true };
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
      menuTarget = null;
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
    const width = Math.min(410, Math.max(310, innerWidth - 24));
    let top = rect ? rect.bottom + 8 : 72;
    const left = rect ? Math.max(12, Math.min(rect.left, innerWidth - width - 12)) : Math.max(12, innerWidth - width - 18);
    if (top + 600 > innerHeight) top = Math.max(12, (rect?.top || innerHeight) - 600);
    Object.assign(editor.style, { width:`${width}px`, top:`${Math.round(top)}px`, left:`${Math.round(left)}px` });
  }

  function projectChoiceMarkup(context, currentId) {
    const projects = context.projects || [];
    const options = [`<option value="">No Constellation project</option>`, ...projects.map((project) => `<option value="${String(project.id).replace(/&/g,'&amp;').replace(/"/g,'&quot;')}"${project.id === currentId ? ' selected' : ''}>${String(project.name || 'Untitled project').replace(/&/g,'&amp;').replace(/</g,'&lt;')}</option>`)].join('');
    const suggestions = (context.suggestions || []).slice(0,5).map((candidate) => {
      const project = candidate.project || {};
      const identity = projectIdentity.identity(project);
      return `<button type="button" class="pc-project-suggestion" data-assign-project="${String(project.id || '').replace(/"/g,'&quot;')}" data-fingerprint="${String(candidate.fingerprint || '').replace(/"/g,'&quot;')}" style="--pc-project-color:${identity.color}"><span class="pc-suggestion-icon">${projectIdentity.iconMarkup(identity.icon) || String(identity.icon || '')}</span><span><strong>${String(project.name || 'Project').replace(/&/g,'&amp;').replace(/</g,'&lt;')}</strong><small>${Math.round(Number(candidate.score || 0) * 100)}% match${candidate.reason ? ` - ${String(candidate.reason).replace(/&/g,'&amp;').replace(/</g,'&lt;')}` : ''}</small></span></button>`;
    }).join('');
    return { options, suggestions };
  }

  async function openEditorFor(conversationId, preferred = null, focusProject = false) {
    const found = preferred ? { anchor:preferred } : await locate(conversationId);
    const anchor = found.anchor;
    if (!anchor) return { ok:false, error:'That chat row is not currently mounted in the ChatGPT sidebar.' };
    const shell = rowShell(anchor);
    const key = keyFor(anchor);
    if (!shell || !key) return { ok:false, error:'Could not resolve the chat row.' };
    closeEditor();
    editorAnchor = anchor;
    const current = core.normalizeDecoration(decorations[key] || {});
    const context = await getContext(conversationId, true);
    const choices = projectChoiceMarkup(context, context.chat?.workspaceProjectId || '');
    let manualIcon = current.iconKey || '';
    const panel = document.createElement('section');
    panel.id = 'projectConstellationChatStylePopover';
    panel.setAttribute(OWNED, '1');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Project Constellation chat appearance and project matching');
    panel.innerHTML = `
      <div class="pc-chat-editor-head"><div><span>PROJECT CONSTELLATION</span><strong class="pc-editor-title"></strong></div><button type="button" class="pc-chat-editor-close" aria-label="Close">x</button></div>
      <div class="pc-editor-project-summary"><span class="pc-editor-project-icon"></span><div><strong class="pc-editor-project-name">Smart project identity</strong><small class="pc-editor-project-detail">Icons follow the best confirmed project automatically. Related project families can appear as small badges.</small></div></div>
      <label class="pc-chat-editor-label">Icon behavior</label><select class="pc-icon-mode"><option value="auto">Auto - project first, smart fallback</option><option value="project">Project only</option><option value="manual">Custom icon</option><option value="none">No icon</option></select>
      <label class="pc-chat-editor-label">Project-style icons</label><div class="pc-vector-icon-presets"></div>
      <div class="pc-chat-emoji-line"><input class="pc-chat-emoji-input" maxlength="16" placeholder="or custom emoji"><div class="pc-chat-emoji-presets"></div></div>
      <label class="pc-badge-toggle"><input type="checkbox" class="pc-project-badges"> Show matching icons when this work spans related projects</label>
      <div class="pc-chat-editor-divider"></div>
      <label class="pc-chat-editor-label">Constellation project</label><div class="pc-project-assign-row"><select class="pc-project-select">${choices.options}</select><button type="button" class="pc-project-assign">Apply project</button></div>
      <div class="pc-project-suggestions">${choices.suggestions || '<small>No confident extra project matches yet. Auto icon still uses the chat title when needed.</small>'}</div>
      <div class="pc-chat-editor-grid"><label>Color override<span class="pc-chat-color-line"><input class="pc-color" type="color"><input class="pc-color-enabled" type="checkbox" title="Use custom color"></span></label><label>Text style<select class="pc-style"><option value="clean">Clean</option><option value="bold">Bold</option><option value="serif">Serif</option><option value="italic">Italic</option><option value="mono">Mono</option><option value="wide">Wide</option><option value="glow">Glow</option><option value="soft">Soft pill</option></select></label></div>
      <div class="pc-chat-editor-actions"><button type="button" class="primary pc-apply">Apply appearance</button><button type="button" class="pc-clear">Reset auto</button><span class="pc-chat-editor-status"></span></div>
      <div class="pc-chat-editor-divider"></div><label class="pc-chat-editor-label">Rename the actual ChatGPT chat</label><div class="pc-chat-rename-row"><input class="pc-rename" maxlength="120" placeholder="Chat name"><button type="button" class="primary pc-rename-go">Rename</button></div><small class="pc-chat-rename-status">Uses ChatGPT's own visible Rename UI; no provider API request.</small>`;
    panel.querySelector('.pc-editor-title').textContent = plainTitle(anchor) || 'Chat appearance';
    const emojiInput = panel.querySelector('.pc-chat-emoji-input');
    const color = panel.querySelector('.pc-color');
    const colorEnabled = panel.querySelector('.pc-color-enabled');
    const style = panel.querySelector('.pc-style');
    const mode = panel.querySelector('.pc-icon-mode');
    const badges = panel.querySelector('.pc-project-badges');
    const rename = panel.querySelector('.pc-rename');
    const status = panel.querySelector('.pc-chat-editor-status');
    const projectSelect = panel.querySelector('.pc-project-select');
    emojiInput.value = current.emoji;
    color.value = current.color || '#8b5cf6';
    colorEnabled.checked = Boolean(current.color);
    style.value = current.style;
    mode.value = current.iconMode;
    badges.checked = current.showProjectBadges;
    rename.value = plainTitle(anchor);

    const preview = primaryIdentity(anchor, current, context);
    const previewIcon = panel.querySelector('.pc-editor-project-icon');
    if (preview) { previewIcon.style.setProperty('--pc-project-color', projectIdentity.normalizeColor(preview.color)); setIcon(previewIcon, preview.token); }
    else previewIcon.textContent = '-';
    const assignedName = context.assignedProject?.name || localProjectsFor(anchor)[0]?.name || '';
    if (assignedName) {
      panel.querySelector('.pc-editor-project-name').textContent = assignedName;
      panel.querySelector('.pc-editor-project-detail').textContent = 'Confirmed project identity. Auto mode will keep this chat visually matched to the project.';
    }

    const vectorRoot = panel.querySelector('.pc-vector-icon-presets');
    for (const iconKey of projectIdentity.VECTOR_KEYS) {
      const token = `pc:${iconKey}`;
      const def = projectIdentity.iconDefinition(token);
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.projectIcon = token;
      button.title = def?.label || iconKey;
      button.setAttribute('aria-label', `Use ${def?.label || iconKey} icon`);
      button.innerHTML = projectIdentity.iconMarkup(token);
      button.classList.toggle('selected', manualIcon === token);
      button.addEventListener('click', () => {
        manualIcon = token;
        emojiInput.value = '';
        mode.value = 'manual';
        vectorRoot.querySelectorAll('button').forEach((entry) => entry.classList.toggle('selected', entry === button));
      });
      vectorRoot.appendChild(button);
    }
    for (const value of EMOJI) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = value;
      button.addEventListener('click', () => { emojiInput.value = value; manualIcon = ''; mode.value = 'manual'; vectorRoot.querySelectorAll('button').forEach((entry) => entry.classList.remove('selected')); });
      panel.querySelector('.pc-chat-emoji-presets').appendChild(button);
    }
    emojiInput.addEventListener('input', () => { if (emojiInput.value) { manualIcon = ''; mode.value = 'manual'; vectorRoot.querySelectorAll('button').forEach((entry) => entry.classList.remove('selected')); } });
    panel.querySelector('.pc-chat-editor-close').addEventListener('click', closeEditor);
    panel.querySelector('.pc-apply').addEventListener('click', async () => {
      status.textContent = 'Saving...';
      await saveDecoration(key, { emoji:emojiInput.value, iconKey:manualIcon, iconMode:mode.value, showProjectBadges:badges.checked, color:colorEnabled.checked ? color.value : '', style:style.value });
      status.textContent = 'Saved';
    });
    panel.querySelector('.pc-clear').addEventListener('click', async () => {
      emojiInput.value = ''; manualIcon = ''; mode.value = 'auto'; badges.checked = true; colorEnabled.checked = false; style.value = 'clean';
      vectorRoot.querySelectorAll('button').forEach((entry) => entry.classList.remove('selected'));
      await saveDecoration(key, { emoji:'', iconKey:'', iconMode:'auto', showProjectBadges:true, color:'', style:'clean' });
      status.textContent = 'Back to smart auto';
    });
    panel.querySelector('.pc-project-assign').addEventListener('click', async () => {
      status.textContent = 'Updating project...';
      const result = await setChatProject(conversationId, projectSelect.value);
      status.textContent = result?.ok ? (projectSelect.value ? 'Project assigned' : 'Project removed') : (result?.error || 'Project update failed');
    });
    panel.querySelectorAll('[data-assign-project]').forEach((button) => button.addEventListener('click', async () => {
      status.textContent = 'Applying smart match...';
      const result = await setChatProject(conversationId, button.dataset.assignProject || '');
      if (result?.ok) {
        projectSelect.value = button.dataset.assignProject || '';
        status.textContent = 'Smart project match confirmed';
      } else status.textContent = result?.error || 'Project match failed';
    }));
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
    if (focusProject) requestAnimationFrame(() => panel.querySelector('.pc-project-select')?.focus());
    return { ok:true, key, conversationId };
  }

  function captureMenuTarget(event) {
    const shell = event.target?.closest?.('.pc-chat-organizer-shell');
    const anchor = shell?.querySelector?.(ROW);
    if (!anchor) return;
    const isContext = event.type === 'contextmenu' || event.button === 2;
    const isActions = Boolean(event.target?.closest?.('button:not(.pc-chat-style-button)'));
    if (!isContext && !isActions) return;
    menuTarget = { id:idFor(anchor), anchor, at:Date.now(), suppressInject:false };
    queueContext(menuTarget.id);
  }

  function nativeMenuButton(label, action, extraClass = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.className = `pc-native-menu-item ${extraClass}`.trim();
    button.setAttribute(OWNED, '1');
    button.textContent = label;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      Promise.resolve(action()).catch(() => {});
      button.closest('[role="menu"]')?.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }));
    }, true);
    return button;
  }

  function injectNativeMenu(menu, target = menuTarget) {
    if (!menu || menu.querySelector(':scope > .pc-native-menu-section') || !target?.id || target.suppressInject || Date.now() - target.at > 5000) return;
    const context = cachedContext(target.id) || {};
    queueContext(target.id);
    const section = document.createElement('div');
    section.className = 'pc-native-menu-section';
    section.setAttribute(OWNED, '1');
    section.setAttribute('role', 'group');
    section.setAttribute('aria-label', 'Project Constellation');
    const heading = document.createElement('div');
    heading.className = 'pc-native-menu-heading';
    heading.textContent = 'PROJECT CONSTELLATION';
    section.appendChild(heading);
    section.appendChild(nativeMenuButton('Appearance + project icon...', () => openEditorFor(target.id, target.anchor)));
    const top = (context.suggestions || []).find((row) => Number(row.score || 0) >= .68 && row.project?.id);
    if (top) section.appendChild(nativeMenuButton(`Smart match: ${top.project.name} (${Math.round(Number(top.score || 0) * 100)}%)`, () => setChatProject(target.id, top.project.id), 'pc-native-menu-smart'));
    else section.appendChild(nativeMenuButton('Smart project matching...', () => openEditorFor(target.id, target.anchor, true)));
    const chat = context.chat || {};
    section.appendChild(nativeMenuButton(chat.favorite ? 'Remove Constellation favorite' : 'Favorite in Constellation', () => patchChat(target.id, { favorite:!chat.favorite })));
    section.appendChild(nativeMenuButton(chat.pinned ? 'Unpin in Constellation' : 'Pin in Constellation', () => patchChat(target.id, { pinned:!chat.pinned })));
    section.appendChild(nativeMenuButton('Open in Command Center', () => chrome.runtime.sendMessage({ type:'PC_CHAT_VAULT_OPEN', chatId:target.id })));
    menu.appendChild(section);
  }

  function injectOpenNativeMenu() {
    const menu = openMenu();
    if (menu) injectNativeMenu(menu);
  }

  document.addEventListener('contextmenu', captureMenuTarget, true);
  document.addEventListener('pointerdown', captureMenuTarget, true);
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
    if (area !== 'local') return;
    let changed = false;
    if (changes?.[KEY]) { decorations = core.normalizeDecorations(changes[KEY].newValue); changed = true; }
    if (changes?.[VAULT_KEY]) { vault = core.normalizeVault(changes[VAULT_KEY].newValue); changed = true; }
    if (changed) scheduleScan();
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
    const added = mutations.some((mutation) => [...mutation.addedNodes].some((node) => node?.nodeType === Node.ELEMENT_NODE && !node.closest?.(`[${OWNED}]`) && (node.matches?.(ROW) || node.querySelector?.(ROW) || node.matches?.('[role="menu"]') || node.querySelector?.('[role="menu"]'))));
    if (added) scheduleScan();
  });
  observer.observe(document.documentElement, { childList:true, subtree:true });

  loadState().catch(() => {});
  scheduleScan();
})();
