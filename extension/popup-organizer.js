(() => {
  'use strict';

  const core = globalThis.ProjectConstellationChatVaultCore;
  if (!core) return;
  const chatPulse = document.getElementById('chatPulse');
  const chatList = document.getElementById('chatList');
  if (!chatPulse || !chatList) return;

  let batchRenameMode = false;
  let rowObserver = null;
  let toastTimer = 0;

  const clean = core.clean;
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function conversationId(url) {
    return core.conversationId(url || '');
  }

  function setToast(message, kind = '') {
    let node = document.getElementById('pcPopupOrganizerToast');
    if (!node) {
      node = document.createElement('div');
      node.id = 'pcPopupOrganizerToast';
      node.className = 'pc-popup-organizer-toast';
      chatPulse.appendChild(node);
    }
    node.textContent = message;
    node.dataset.kind = kind;
    node.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.hidden = true; }, 2800);
  }

  async function ensureOrganizer(tabId) {
    if (!tabId) return false;
    try {
      const ping = await chrome.tabs.sendMessage(tabId, { type:'PC_CHAT_ORGANIZER_PING' });
      if (ping?.ok) return true;
    } catch (_) {}
    try {
      await chrome.scripting.insertCSS({ target:{ tabId }, files:['src/chat-organizer.css'] }).catch(() => {});
      await chrome.scripting.executeScript({ target:{ tabId }, files:['src/chat-vault-core.js','src/chat-organizer.js'] });
      await delay(90);
      const ping = await chrome.tabs.sendMessage(tabId, { type:'PC_CHAT_ORGANIZER_PING' });
      return Boolean(ping?.ok);
    } catch (_) { return false; }
  }

  async function renameRow(shell, input, status) {
    const row = shell.querySelector('.chat-list-row');
    const tabId = Number(row?.dataset.tabId || 0);
    const url = row?.dataset.url || '';
    const id = conversationId(url);
    const title = clean(input?.value || '', 120);
    if (!tabId || !id || !title) {
      status.textContent = 'Missing chat, tab, or title.';
      status.dataset.kind = 'error';
      return false;
    }
    input.disabled = true;
    status.textContent = 'Renaming...';
    status.dataset.kind = '';
    const ready = await ensureOrganizer(tabId);
    if (!ready) {
      input.disabled = false;
      status.textContent = 'Reload that chat once so Constellation can control its Rename menu.';
      status.dataset.kind = 'error';
      return false;
    }
    let result = null;
    try { result = await chrome.tabs.sendMessage(tabId, { type:'PC_CHAT_ORGANIZER_RENAME', conversationId:id, url, title }); }
    catch (error) { result = { ok:false, error:String(error?.message || error) }; }
    input.disabled = false;
    if (!result?.ok) {
      status.textContent = clean(result?.error || 'Rename failed.', 160);
      status.dataset.kind = 'error';
      return false;
    }
    const titleNode = row.querySelector('.chat-list-copy strong');
    if (titleNode) titleNode.textContent = title;
    status.textContent = result.verified ? 'Renamed' : 'Rename sent';
    status.dataset.kind = 'success';
    setTimeout(() => { if (status.isConnected) status.textContent = ''; }, 1200);
    return true;
  }

  function openInlineRename(shell) {
    let form = shell.querySelector(':scope > .pc-popup-inline-rename');
    if (form) { form.hidden = false; form.querySelector('input')?.focus(); return; }
    const row = shell.querySelector('.chat-list-row');
    const title = row?.querySelector('.chat-list-copy strong')?.textContent || '';
    form = document.createElement('div');
    form.className = 'pc-popup-inline-rename';
    const input = document.createElement('input'); input.type = 'text'; input.maxLength = 120; input.value = clean(title,120); input.setAttribute('aria-label','New chat name');
    const save = document.createElement('button'); save.type = 'button'; save.textContent = 'Save'; save.className = 'primary';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
    const status = document.createElement('small'); status.className = 'pc-popup-rename-status';
    save.addEventListener('click', () => renameRow(shell,input,status));
    cancel.addEventListener('click', () => { form.hidden = true; status.textContent = ''; });
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); save.click(); } else if (event.key === 'Escape') { event.preventDefault(); cancel.click(); } });
    form.append(input,save,cancel,status);
    shell.appendChild(form);
    setTimeout(() => { input.focus(); input.select(); }, 0);
  }

  async function openStyleOnSite(shell) {
    const row = shell.querySelector('.chat-list-row');
    const tabId = Number(row?.dataset.tabId || 0);
    const windowId = Number(row?.dataset.windowId || 0);
    const url = row?.dataset.url || '';
    const id = conversationId(url);
    if (!tabId || !id) { setToast('That live chat is no longer available.', 'error'); return; }
    const ready = await ensureOrganizer(tabId);
    if (!ready) { setToast('Reload that chat once to enable the live style editor.', 'error'); return; }
    try {
      if (windowId) await chrome.windows.update(windowId,{ focused:true });
      await chrome.tabs.update(tabId,{ active:true });
      const result = await chrome.tabs.sendMessage(tabId,{ type:'PC_CHAT_ORGANIZER_OPEN_EDITOR', conversationId:id, url });
      if (result?.ok) window.close(); else setToast(result?.error || 'Style editor unavailable.','error');
    } catch (_) { setToast('Could not focus that chat.','error'); }
  }

  function enhanceRow(shell) {
    if (!shell || shell.dataset.pcOrganizerReady === '1') return;
    const row = shell.querySelector('.chat-list-row');
    if (!row) return;
    shell.dataset.pcOrganizerReady = '1';
    const actions = document.createElement('div');
    actions.className = 'pc-popup-row-actions';
    const rename = document.createElement('button'); rename.type = 'button'; rename.textContent = 'Rename'; rename.title = 'Rename the actual provider chat';
    const style = document.createElement('button'); style.type = 'button'; style.textContent = '✦ Style'; style.title = 'Emoji, color, and fancy text on the live ChatGPT sidebar';
    rename.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); openInlineRename(shell); });
    style.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); openStyleOnSite(shell); });
    actions.append(rename,style);
    shell.appendChild(actions);
    if (batchRenameMode) openInlineRename(shell);
  }

  function enhanceRows() {
    for (const shell of chatList.querySelectorAll('.chat-list-row-shell')) enhanceRow(shell);
  }

  async function saveStackFromOpenTabs({ close = false, reason = 'Stashed' } = {}) {
    const tabs = (await chrome.tabs.query({})).filter((tab) => core.isSupportedChatUrl(tab.url || ''));
    const stamp = Date.now();
    const items = tabs.map((tab) => core.tabToItem(tab,stamp)).filter(Boolean);
    if (!items.length) { setToast('No open supported AI chat tabs found.','error'); return null; }
    const stored = await chrome.storage.local.get(core.VAULT_KEY);
    let vault = core.normalizeVault(stored?.[core.VAULT_KEY]);
    const label = new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(stamp));
    const stack = core.createStack(`${reason} ${label}`,items,{createdAt:stamp});
    vault = core.addStack(vault,stack,{select:true,recent:close});
    await chrome.storage.local.set({ [core.VAULT_KEY]:vault });
    const verify = await chrome.storage.local.get(core.VAULT_KEY);
    const saved = core.normalizeVault(verify?.[core.VAULT_KEY]).stacks.find((row) => row.id === stack.id);
    if (!saved || saved.items.length !== stack.items.length) { setToast('Safety check failed; no tabs were closed.','error'); return null; }
    if (close) {
      const closeIds = tabs.filter((tab) => !tab.pinned).map((tab) => tab.id).filter(Boolean);
      if (closeIds.length) await chrome.tabs.remove(closeIds).catch(() => {});
    }
    return stack;
  }

  async function quickStash() {
    const stack = await saveStackFromOpenTabs({close:true,reason:'Stashed'});
    if (stack) setToast(`Stashed ${stack.items.length} chat${stack.items.length === 1 ? '' : 's'}.`,'success');
  }

  async function oneTabHandoff() {
    const tabs = (await chrome.tabs.query({})).filter((tab) => core.isSupportedChatUrl(tab.url || ''));
    const items = tabs.map((tab) => core.tabToItem(tab)).filter(Boolean);
    if (!items.length) { setToast('No open supported AI chats to hand off.','error'); return; }
    await saveStackFromOpenTabs({close:false,reason:'OneTab handoff'});
    const text = core.oneTabText(items);
    try { await navigator.clipboard.writeText(text); }
    catch (_) { setToast('Chrome blocked clipboard access. Use Chat Vault -> Copy OneTab list.','error'); return; }
    try { await chrome.tabs.create({url:core.ONETAB_IMPORT_URL,active:true}); }
    catch (_) {}
    setToast('OneTab import list copied. Paste it into OneTab Import.','success');
  }

  function openVault() {
    chrome.tabs.create({ url:chrome.runtime.getURL('chat-vault.html'), active:true }).then(() => window.close()).catch(() => {});
  }

  function installToolbar() {
    if (document.getElementById('pcPopupOrganizerBar')) return;
    const bar = document.createElement('div'); bar.id = 'pcPopupOrganizerBar'; bar.className = 'pc-popup-organizer-bar';
    const vault = document.createElement('button'); vault.type = 'button'; vault.textContent = 'Chat Vault'; vault.title = 'Open the OneTab-style saved chat workspace';
    const stash = document.createElement('button'); stash.type = 'button'; stash.textContent = 'Stash chats'; stash.title = 'Save all open supported AI chats, verify them, then close unpinned chat tabs';
    const renameMode = document.createElement('button'); renameMode.type = 'button'; renameMode.textContent = 'Rename mode'; renameMode.title = 'Show rename fields for every chat in the current Pulse list';
    const oneTab = document.createElement('button'); oneTab.type = 'button'; oneTab.textContent = 'OneTab'; oneTab.title = 'Copy an import-ready OneTab list and open OneTab Import/Export';
    vault.addEventListener('click',openVault);
    stash.addEventListener('click',() => quickStash().catch((error) => setToast(clean(error?.message || error,160),'error')));
    oneTab.addEventListener('click',() => oneTabHandoff().catch((error) => setToast(clean(error?.message || error,160),'error')));
    renameMode.addEventListener('click',() => {
      batchRenameMode = !batchRenameMode;
      renameMode.classList.toggle('active',batchRenameMode);
      renameMode.textContent = batchRenameMode ? 'Rename mode on' : 'Rename mode';
      for (const shell of chatList.querySelectorAll('.chat-list-row-shell')) {
        if (batchRenameMode) openInlineRename(shell);
        else { const form = shell.querySelector(':scope > .pc-popup-inline-rename'); if (form) form.hidden = true; }
      }
    });
    bar.append(vault,stash,renameMode,oneTab);
    const head = chatPulse.querySelector('.section-head');
    if (head?.nextSibling) chatPulse.insertBefore(bar,head.nextSibling); else chatPulse.appendChild(bar);
  }

  installToolbar();
  enhanceRows();
  rowObserver = new MutationObserver(enhanceRows);
  rowObserver.observe(chatList,{childList:true,subtree:true});
})();
