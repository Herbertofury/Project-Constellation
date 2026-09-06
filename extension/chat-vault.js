(() => {
  'use strict';

  const core = globalThis.ProjectConstellationChatVaultCore;
  if (!core) return;

  const $ = (id) => document.getElementById(id);
  const els = Object.fromEntries([
    'saveOpenChats','stashOpenChats','oneTabHandoff','importTabs','exportVault','vaultSearch','newStack','totalSavedCount','stackList',
    'stackEyebrow','stackTitle','stackMeta','renameStack','restoreAll','copyOneTab','deleteStack','emptyState','emptyStash','searchSummary','chatGrid','vaultStatus',
    'stackDialog','stackForm','stackDialogTitle','stackNameInput','stackColorInput','saveStackDialog','importDialog','importForm','oneTabImportText','jsonImportFile','importCountHint','runTextImport',
    'styleDialog','styleForm','styleChatTitle','styleEmoji','styleEmojiPresets','styleColor','styleColorEnabled','styleText','clearStyle','saveStyle'
  ].map((id) => [id,$(id)]));

  const PRESET_EMOJI = [
    '\u{1F525}','\u{1F4CC}','\u{1F4A1}','\u{1F9EA}','\u2705','\u{1F9E0}','\u{1F4BB}','\u{1F3AE}',
    '\u{1F31F}','\u{1F680}','\u{1F49C}','\u{1F4DA}','\u{1F528}','\u{1F9F9}','\u{1F6A7}','\u{1F48E}'
  ];

  let vault = core.emptyVault();
  let decorations = {};
  let editingStackId = '';
  let stylingItem = null;
  let statusTimer = 0;

  const clean = core.clean;

  function setStatus(message, kind = '') {
    els.vaultStatus.textContent = message;
    els.vaultStatus.className = kind;
    if (statusTimer) clearTimeout(statusTimer);
    if (kind) statusTimer = setTimeout(() => { els.vaultStatus.className = ''; els.vaultStatus.textContent = 'Ready.'; }, 4200);
  }

  function dateLabel(stamp = Date.now()) {
    try { return new Intl.DateTimeFormat(undefined, { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }).format(new Date(stamp)); }
    catch (_) { return new Date(stamp).toLocaleString(); }
  }

  function selectedStack() {
    return vault.stacks.find((stack) => stack.id === vault.selectedStackId) || null;
  }

  async function saveVault(next = vault) {
    vault = core.normalizeVault(next);
    vault.updatedAt = Date.now();
    await chrome.storage.local.set({ [core.VAULT_KEY]:vault });
    return vault;
  }

  async function saveDecorations() {
    decorations = core.normalizeDecorations(decorations);
    await chrome.storage.local.set({ [core.DECORATIONS_KEY]:decorations });
  }

  async function load() {
    const stored = await chrome.storage.local.get([core.VAULT_KEY,core.DECORATIONS_KEY]);
    vault = core.normalizeVault(stored?.[core.VAULT_KEY]);
    decorations = core.normalizeDecorations(stored?.[core.DECORATIONS_KEY]);
    render();
  }

  function stackItemsForSearch(query) {
    const q = clean(query, 180).toLowerCase();
    if (!q) return null;
    const matches = [];
    for (const stack of vault.stacks) {
      for (const item of stack.items) {
        const haystack = `${item.title} ${item.url} ${item.providerName} ${(item.tags || []).join(' ')} ${item.note || ''}`.toLowerCase();
        if (haystack.includes(q)) matches.push({ item, stack });
      }
    }
    return matches;
  }

  function renderStackList() {
    els.stackList.replaceChildren();
    for (const stack of vault.stacks) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `stack-row${stack.id === vault.selectedStackId ? ' active' : ''}`;
      button.dataset.stackId = stack.id;
      const color = document.createElement('span'); color.className = 'stack-color'; color.style.setProperty('--stack-color', stack.color);
      const copy = document.createElement('span'); copy.className = 'stack-copy';
      const name = document.createElement('strong'); name.textContent = stack.name;
      const updated = document.createElement('small'); updated.textContent = dateLabel(stack.updatedAt || stack.createdAt);
      copy.append(name, updated);
      const count = document.createElement('span'); count.className = 'stack-count'; count.textContent = String(stack.items.length);
      button.append(color, copy, count);
      button.addEventListener('click', async () => { vault.selectedStackId = stack.id; await saveVault(vault); render(); });
      button.addEventListener('dragover', (event) => { event.preventDefault(); button.classList.add('drag-over'); });
      button.addEventListener('dragleave', () => button.classList.remove('drag-over'));
      button.addEventListener('drop', async (event) => {
        event.preventDefault(); button.classList.remove('drag-over');
        const payload = event.dataTransfer?.getData('application/x-project-constellation-chat');
        if (!payload) return;
        try {
          const data = JSON.parse(payload);
          vault = core.moveItem(vault, data.itemId, data.stackId, stack.id);
          vault.selectedStackId = stack.id;
          await saveVault(vault); render();
          setStatus('Moved chat to another stack.', 'success');
        } catch (_) { setStatus('Could not move that chat.', 'error'); }
      });
      els.stackList.appendChild(button);
    }
    els.totalSavedCount.textContent = `${core.stackCount(vault)} saved`;
  }

  function styleForItem(item) {
    const key = core.decorationKey(item.url);
    return core.normalizeDecoration(decorations[key] || {});
  }

  function createChatCard(item, stack) {
    const decoration = styleForItem(item);
    const card = document.createElement('article');
    card.className = 'chat-card';
    card.draggable = true;
    card.dataset.itemId = item.id;
    card.dataset.stackId = stack.id;
    card.style.setProperty('--chat-color', decoration.color || stack.color || '#8b5cf6');

    const head = document.createElement('div'); head.className = 'chat-head';
    const titleWrap = document.createElement('div'); titleWrap.className = 'chat-title';
    const emoji = document.createElement('span'); emoji.className = 'chat-emoji'; emoji.textContent = decoration.emoji || '\u2726';
    const titleCopy = document.createElement('div'); titleCopy.className = 'chat-title-copy';
    const title = document.createElement('strong'); title.textContent = item.title; title.className = `style-${decoration.style}`;
    const meta = document.createElement('small'); meta.textContent = `${stack.name} - ${dateLabel(item.createdAt)}`;
    titleCopy.append(title, meta); titleWrap.append(emoji, titleCopy);
    const provider = document.createElement('span'); provider.className = 'provider-badge'; provider.textContent = item.providerName || item.providerId || 'AI';
    head.append(titleWrap, provider);

    const url = document.createElement('span'); url.className = 'chat-url'; url.textContent = item.url; url.title = item.url;

    const actions = document.createElement('div'); actions.className = 'chat-actions-row';
    const open = document.createElement('button'); open.type = 'button'; open.className = 'open-chat'; open.textContent = 'Open';
    const style = document.createElement('button'); style.type = 'button'; style.textContent = 'Style';
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove';
    const move = document.createElement('select'); move.className = 'move-select'; move.title = 'Move to another stack';
    const keep = document.createElement('option'); keep.value = ''; keep.textContent = 'Move...'; move.appendChild(keep);
    for (const target of vault.stacks.filter((row) => row.id !== stack.id)) {
      const option = document.createElement('option'); option.value = target.id; option.textContent = target.name; move.appendChild(option);
    }
    open.addEventListener('click', () => openItem(item));
    style.addEventListener('click', () => openStyleDialog(item));
    remove.addEventListener('click', async () => { await removeItem(stack.id, item.id); });
    move.addEventListener('change', async () => {
      if (!move.value) return;
      vault = core.moveItem(vault, item.id, stack.id, move.value); await saveVault(vault); render(); setStatus('Moved chat.', 'success');
    });
    actions.append(open, style, remove, move);
    card.append(head, url, actions);

    card.addEventListener('dragstart', (event) => {
      card.classList.add('dragging');
      event.dataTransfer?.setData('application/x-project-constellation-chat', JSON.stringify({ itemId:item.id, stackId:stack.id }));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    return card;
  }

  function renderChats() {
    els.chatGrid.replaceChildren();
    const query = els.vaultSearch.value;
    const matches = stackItemsForSearch(query);
    if (matches) {
      els.searchSummary.hidden = false;
      els.searchSummary.textContent = `${matches.length} result${matches.length === 1 ? '' : 's'} across ${vault.stacks.length} stack${vault.stacks.length === 1 ? '' : 's'}.`;
      for (const { item, stack } of matches) els.chatGrid.appendChild(createChatCard(item, stack));
      return;
    }
    els.searchSummary.hidden = true;
    const stack = selectedStack();
    if (!stack) return;
    for (const item of stack.items) els.chatGrid.appendChild(createChatCard(item, stack));
  }

  function render() {
    renderStackList();
    const stack = selectedStack();
    const searching = Boolean(clean(els.vaultSearch.value,180));
    els.stackTitle.textContent = stack?.name || 'No saved chats yet';
    els.stackEyebrow.textContent = searching ? 'SEARCH RESULTS' : 'CHAT STACK';
    els.stackMeta.textContent = stack ? `${stack.items.length} saved chat${stack.items.length === 1 ? '' : 's'} - updated ${dateLabel(stack.updatedAt)}` : 'Use Save open chats or Stash + close to start a recoverable list.';
    els.renameStack.disabled = !stack; els.restoreAll.disabled = !stack?.items?.length; els.copyOneTab.disabled = !stack?.items?.length; els.deleteStack.disabled = !stack;
    els.emptyState.hidden = Boolean(vault.stacks.length || searching);
    renderChats();
  }

  async function openItem(item) {
    const tab = await chrome.tabs.create({ url:item.url, active:true });
    const stack = vault.stacks.find((row) => row.items.some((candidate) => candidate.id === item.id));
    if (stack) {
      const row = stack.items.find((candidate) => candidate.id === item.id);
      if (row) row.lastOpenedAt = Date.now();
      stack.updatedAt = Date.now(); await saveVault(vault); render();
    }
    return tab;
  }

  async function removeItem(stackId, itemId) {
    const stack = vault.stacks.find((row) => row.id === stackId);
    if (!stack) return;
    stack.items = stack.items.filter((item) => item.id !== itemId); stack.updatedAt = Date.now(); vault.updatedAt = Date.now();
    await saveVault(vault); render(); setStatus('Removed from this stack.', 'success');
  }

  async function queryOpenChatTabs() {
    const tabs = await chrome.tabs.query({});
    return tabs.filter((tab) => core.isSupportedChatUrl(tab.url || ''));
  }

  async function captureOpenChats({ close = false, reason = 'Saved' } = {}) {
    const tabs = await queryOpenChatTabs();
    const stamp = Date.now();
    const items = tabs.map((tab) => core.tabToItem(tab, stamp)).filter(Boolean);
    if (!items.length) { setStatus('No open supported chat tabs were found.', 'error'); return null; }
    const stack = core.createStack(`${reason} ${dateLabel(stamp)}`, items, { createdAt:stamp });
    vault = core.addStack(vault, stack, { select:true, recent:close });
    await saveVault(vault);

    const verification = await chrome.storage.local.get(core.VAULT_KEY);
    const verified = core.normalizeVault(verification?.[core.VAULT_KEY]).stacks.find((row) => row.id === stack.id);
    if (!verified || verified.items.length !== stack.items.length) {
      setStatus('Safety check failed; no tabs were closed.', 'error'); render(); return stack;
    }

    if (close) {
      const closeIds = tabs.filter((tab) => !tab.pinned).map((tab) => tab.id).filter(Boolean);
      if (closeIds.length) await chrome.tabs.remove(closeIds).catch(() => {});
      const pinned = tabs.length - closeIds.length;
      setStatus(`Stashed ${verified.items.length} chat${verified.items.length === 1 ? '' : 's'}${pinned ? `; ${pinned} pinned tab${pinned === 1 ? '' : 's'} left open` : ''}.`, 'success');
    } else setStatus(`Saved ${verified.items.length} open chat${verified.items.length === 1 ? '' : 's'} into a new stack.`, 'success');
    render();
    return stack;
  }

  async function restoreStack(stack) {
    if (!stack?.items?.length) return;
    const created = [];
    const groupable = [];
    for (const item of [...stack.items].reverse()) {
      try {
        const pinned = Boolean(item.pinned);
        const tab = await chrome.tabs.create({ url:item.url, active:false, pinned });
        if (tab?.id) {
          created.push(tab.id);
          if (!pinned) groupable.push(tab.id);
        }
      } catch (_) {}
    }
    let grouped = false;
    if (groupable.length > 1 && chrome.tabs.group) {
      try {
        const groupId = await chrome.tabs.group({ tabIds:groupable });
        await chrome.tabGroups.update(groupId, { title:`PC - ${clean(stack.name,70)}`, color:'purple', collapsed:false });
        grouped = true;
      } catch (_) {}
    }
    if (created.length) await chrome.tabs.update(created.at(-1), { active:true }).catch(() => {});
    const pinnedCount = created.length - groupable.length;
    setStatus(`Restored ${created.length} chat${created.length === 1 ? '' : 's'}${grouped ? ' with unpinned chats grouped' : ''}${pinnedCount ? `; ${pinnedCount} pinned` : ''}.`, 'success');
  }

  async function copyOneTabItems(items) {
    const text = core.oneTabText(items);
    if (!text) { setStatus('There are no chat URLs to copy.', 'error'); return false; }
    try { await navigator.clipboard.writeText(text); setStatus(`Copied ${text.split(/\r?\n/).length} OneTab-ready chat URL${text.includes('\n') ? 's' : ''}.`, 'success'); return true; }
    catch (_) { setStatus('Clipboard access was blocked by Chrome.', 'error'); return false; }
  }

  async function oneTabHandoff() {
    const tabs = await queryOpenChatTabs();
    const items = tabs.map((tab) => core.tabToItem(tab)).filter(Boolean);
    const fallback = selectedStack()?.items || [];
    const selected = items.length ? items : fallback;
    if (!selected.length) { setStatus('No open or selected saved chats to hand off.', 'error'); return; }
    if (items.length) {
      const stamp = Date.now();
      const safety = core.createStack(`OneTab handoff ${dateLabel(stamp)}`, items, { createdAt:stamp });
      vault = core.addStack(vault, safety, { select:false, recent:false });
      await saveVault(vault);
    }
    if (!(await copyOneTabItems(selected))) return;
    try {
      await chrome.tabs.create({ url:core.ONETAB_IMPORT_URL, active:true });
      setStatus('OneTab import list is on your clipboard. Paste it into OneTab Import and click Import.', 'success');
    } catch (_) {
      setStatus('OneTab list copied. Open OneTab Import/Export and paste it there.', 'success');
    }
    render();
  }

  function openStackDialog(mode = 'new') {
    const stack = selectedStack();
    editingStackId = mode === 'rename' ? (stack?.id || '') : '';
    els.stackDialogTitle.textContent = editingStackId ? 'Rename stack' : 'New stack';
    els.stackNameInput.value = editingStackId ? stack.name : '';
    els.stackColorInput.value = editingStackId ? stack.color : core.SAFE_COLORS[vault.stacks.length % core.SAFE_COLORS.length];
    els.stackDialog.showModal();
    setTimeout(() => { els.stackNameInput.focus(); els.stackNameInput.select(); }, 40);
  }

  async function commitStackDialog(event) {
    event.preventDefault();
    const name = clean(els.stackNameInput.value,120) || 'Saved chats';
    const color = els.stackColorInput.value;
    if (editingStackId) {
      const stack = vault.stacks.find((row) => row.id === editingStackId);
      if (stack) { stack.name = name; stack.color = color; stack.updatedAt = Date.now(); }
    } else {
      const stack = core.createStack(name, [], { color });
      vault = core.addStack(vault, stack, { select:true });
    }
    await saveVault(vault); els.stackDialog.close(); render(); setStatus('Stack saved.', 'success');
  }

  async function deleteSelectedStack() {
    const stack = selectedStack();
    if (!stack) return;
    if (!confirm(`Delete the stack "${stack.name}"? This removes only the saved Vault entries, not the chats from the provider.`)) return;
    vault = core.removeStack(vault, stack.id); await saveVault(vault); render(); setStatus('Stack deleted.', 'success');
  }

  async function importOneTabText() {
    const items = core.parseOneTabText(els.oneTabImportText.value);
    if (!items.length) { els.importCountHint.textContent = 'No supported AI chat URLs found.'; return; }
    const stack = core.createStack(`Imported ${dateLabel()}`, items);
    vault = core.addStack(vault, stack, { select:true });
    await saveVault(vault); els.oneTabImportText.value = ''; els.importDialog.close(); render(); setStatus(`Imported ${items.length} chat${items.length === 1 ? '' : 's'}.`, 'success');
  }

  async function importJsonFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const imported = core.normalizeVault(parsed?.vault || parsed);
      if (!imported.stacks.length) throw new Error('Backup contains no chat stacks.');
      const stamp = Date.now();
      for (const stack of imported.stacks.reverse()) {
        const copy = core.createStack(stack.name, stack.items, { createdAt:stack.createdAt || stamp, color:stack.color });
        vault = core.addStack(vault, copy, { select:false });
      }
      if (parsed?.decorations && typeof parsed.decorations === 'object') decorations = { ...decorations, ...core.normalizeDecorations(parsed.decorations) };
      await Promise.all([saveVault(vault), saveDecorations()]);
      els.importDialog.close(); render(); setStatus(`Imported ${imported.stacks.length} stack${imported.stacks.length === 1 ? '' : 's'} from backup.`, 'success');
    } catch (error) { setStatus(clean(error?.message || 'Could not import that JSON backup.',220), 'error'); }
  }

  function exportBackup() {
    const payload = JSON.stringify({ format:'project-constellation-chat-vault', version:1, exportedAt:new Date().toISOString(), vault, decorations }, null, 2);
    const blob = new Blob([payload], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `Project-Constellation-Chat-Vault-${new Date().toISOString().slice(0,10)}.json`; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000); setStatus('Vault backup exported.', 'success');
  }

  function openStyleDialog(item) {
    stylingItem = item;
    const decoration = styleForItem(item);
    els.styleChatTitle.textContent = item.title;
    els.styleEmoji.value = decoration.emoji;
    els.styleColor.value = decoration.color || '#8b5cf6';
    els.styleColorEnabled.checked = Boolean(decoration.color);
    els.styleText.value = decoration.style;
    els.styleDialog.showModal();
  }

  async function commitStyle(event) {
    event.preventDefault();
    if (!stylingItem) return;
    const key = core.decorationKey(stylingItem.url);
    const decoration = core.normalizeDecoration({ emoji:els.styleEmoji.value, color:els.styleColorEnabled.checked ? els.styleColor.value : '', style:els.styleText.value, updatedAt:Date.now() });
    if (!decoration.emoji && !decoration.color && decoration.style === 'clean') delete decorations[key]; else decorations[key] = decoration;
    await saveDecorations(); els.styleDialog.close(); stylingItem = null; render(); setStatus('Chat style saved. It will appear in the ChatGPT sidebar when that chat is mounted.', 'success');
  }

  async function clearStyle(event) {
    event.preventDefault();
    if (!stylingItem) return;
    delete decorations[core.decorationKey(stylingItem.url)];
    await saveDecorations(); els.styleDialog.close(); stylingItem = null; render(); setStatus('Chat style cleared.', 'success');
  }

  for (const emoji of PRESET_EMOJI) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = emoji; button.addEventListener('click', () => { els.styleEmoji.value = emoji; }); els.styleEmojiPresets.appendChild(button);
  }

  els.saveOpenChats.addEventListener('click', () => captureOpenChats({ close:false, reason:'Saved' }).catch((error) => setStatus(clean(error?.message || error,220),'error')));
  els.stashOpenChats.addEventListener('click', () => captureOpenChats({ close:true, reason:'Stashed' }).catch((error) => setStatus(clean(error?.message || error,220),'error')));
  els.emptyStash.addEventListener('click', () => els.stashOpenChats.click());
  els.oneTabHandoff.addEventListener('click', () => oneTabHandoff().catch((error) => setStatus(clean(error?.message || error,220),'error')));
  els.importTabs.addEventListener('click', () => { els.importCountHint.textContent = ''; els.importDialog.showModal(); setTimeout(() => els.oneTabImportText.focus(),40); });
  els.exportVault.addEventListener('click', exportBackup);
  els.newStack.addEventListener('click', () => openStackDialog('new'));
  els.renameStack.addEventListener('click', () => openStackDialog('rename'));
  els.deleteStack.addEventListener('click', () => deleteSelectedStack().catch(() => {}));
  els.restoreAll.addEventListener('click', () => restoreStack(selectedStack()).catch((error) => setStatus(clean(error?.message || error,220),'error')));
  els.copyOneTab.addEventListener('click', () => copyOneTabItems(selectedStack()?.items || []));
  els.vaultSearch.addEventListener('input', render);
  els.stackForm.addEventListener('submit', commitStackDialog);
  els.runTextImport.addEventListener('click', (event) => { event.preventDefault(); importOneTabText().catch(() => {}); });
  els.oneTabImportText.addEventListener('input', () => { els.importCountHint.textContent = `${core.parseOneTabText(els.oneTabImportText.value).length} supported chats`; });
  els.jsonImportFile.addEventListener('change', () => importJsonFile(els.jsonImportFile.files?.[0]));
  els.styleForm.addEventListener('submit', commitStyle);
  els.clearStyle.addEventListener('click', clearStyle);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    let changed = false;
    if (changes[core.VAULT_KEY]) { vault = core.normalizeVault(changes[core.VAULT_KEY].newValue); changed = true; }
    if (changes[core.DECORATIONS_KEY]) { decorations = core.normalizeDecorations(changes[core.DECORATIONS_KEY].newValue); changed = true; }
    if (changed) render();
  });

  load().catch((error) => setStatus(clean(error?.message || error || 'Could not load Chat Vault.',220),'error'));
})();
