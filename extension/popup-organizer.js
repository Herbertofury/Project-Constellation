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
  let quickActionButton = null;

  const clean = core.clean;
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const QUICK_FALLBACK = Object.freeze({
    gather:{buttonLabel:'Gather AI chats',description:'Save and organize open AI chats while keeping provider tabs live.'},
    'smart-collapse':{buttonLabel:'Smart collapse',description:'Save everything, close clearly finished chats, and keep working or uncertain chats alive.'},
    'stash-close':{buttonLabel:'Stash + close',description:'Save and verify everything, then close unpinned AI chat tabs.'}
  });

  function conversationId(url) {
    return core.conversationId(url || '');
  }

  function setToast(message,kind = '') {
    let node = document.getElementById('pcPopupOrganizerToast');
    if (!node) {
      node = document.createElement('div'); node.id = 'pcPopupOrganizerToast'; node.className = 'pc-popup-organizer-toast'; chatPulse.appendChild(node);
    }
    node.textContent = message; node.dataset.kind = kind; node.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.hidden = true; },3600);
  }

  async function ensureOrganizer(tabId) {
    if (!tabId) return false;
    try {
      const ping = await chrome.tabs.sendMessage(tabId,{type:'PC_CHAT_ORGANIZER_PING'});
      if (ping?.ok) return true;
    } catch (_) {}
    try {
      await chrome.scripting.insertCSS({target:{tabId},files:['src/chat-organizer.css']}).catch(() => {});
      await chrome.scripting.executeScript({target:{tabId},files:['src/chat-vault-core.js','src/chat-organizer.js']});
      await delay(90);
      const ping = await chrome.tabs.sendMessage(tabId,{type:'PC_CHAT_ORGANIZER_PING'});
      return Boolean(ping?.ok);
    } catch (_) { return false; }
  }

  async function renameRow(shell,input,status) {
    const row = shell.querySelector('.chat-list-row');
    const tabId = Number(row?.dataset.tabId || 0);
    const url = row?.dataset.url || '';
    const id = conversationId(url);
    const title = clean(input?.value || '',120);
    if (!tabId || !id || !title) {
      status.textContent = 'Missing chat, tab, or title.'; status.dataset.kind = 'error'; return false;
    }
    input.disabled = true; status.textContent = 'Renaming…'; status.dataset.kind = '';
    const ready = await ensureOrganizer(tabId);
    if (!ready) {
      input.disabled = false; status.textContent = 'Reload that chat once so Constellation can use its Rename menu.'; status.dataset.kind = 'error'; return false;
    }
    let result = null;
    try { result = await chrome.tabs.sendMessage(tabId,{type:'PC_CHAT_ORGANIZER_RENAME',conversationId:id,url,title}); }
    catch (error) { result = {ok:false,error:String(error?.message || error)}; }
    input.disabled = false;
    if (!result?.ok) { status.textContent = clean(result?.error || 'Rename failed.',160); status.dataset.kind = 'error'; return false; }
    const titleNode = row.querySelector('.chat-list-copy strong'); if (titleNode) titleNode.textContent = title;
    status.textContent = result.verified ? 'Renamed' : 'Rename sent'; status.dataset.kind = 'success';
    setTimeout(() => { if (status.isConnected) status.textContent = ''; },1200);
    return true;
  }

  function openInlineRename(shell) {
    let form = shell.querySelector(':scope > .pc-popup-inline-rename');
    if (form) { form.hidden = false; form.querySelector('input')?.focus(); return; }
    const row = shell.querySelector('.chat-list-row'); const title = row?.querySelector('.chat-list-copy strong')?.textContent || '';
    form = document.createElement('div'); form.className = 'pc-popup-inline-rename';
    const input = document.createElement('input'); input.type = 'text'; input.maxLength = 120; input.value = clean(title,120); input.setAttribute('aria-label','New chat name');
    const save = document.createElement('button'); save.type = 'button'; save.textContent = 'Save'; save.className = 'primary';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
    const status = document.createElement('small'); status.className = 'pc-popup-rename-status';
    save.addEventListener('click',() => renameRow(shell,input,status));
    cancel.addEventListener('click',() => { form.hidden = true; status.textContent = ''; });
    input.addEventListener('keydown',(event) => {
      if (event.key === 'Enter') { event.preventDefault(); save.click(); }
      else if (event.key === 'Escape') { event.preventDefault(); cancel.click(); }
    });
    form.append(input,save,cancel,status); shell.appendChild(form); setTimeout(() => { input.focus(); input.select(); },0);
  }

  async function openStyleOnSite(shell) {
    const row = shell.querySelector('.chat-list-row');
    const tabId = Number(row?.dataset.tabId || 0); const windowId = Number(row?.dataset.windowId || 0); const url = row?.dataset.url || ''; const id = conversationId(url);
    if (!tabId || !id) { setToast('That live chat is no longer available.','error'); return; }
    const ready = await ensureOrganizer(tabId);
    if (!ready) { setToast('Reload that chat once to enable the live style editor.','error'); return; }
    try {
      if (windowId) await chrome.windows.update(windowId,{focused:true});
      await chrome.tabs.update(tabId,{active:true});
      const result = await chrome.tabs.sendMessage(tabId,{type:'PC_CHAT_ORGANIZER_OPEN_EDITOR',conversationId:id,url});
      if (result?.ok) window.close(); else setToast(result?.error || 'Style editor unavailable.','error');
    } catch (_) { setToast('Could not focus that chat.','error'); }
  }

  function enhanceRow(shell) {
    if (!shell || shell.dataset.pcOrganizerReady === '1') return;
    const row = shell.querySelector('.chat-list-row'); if (!row) return;
    shell.dataset.pcOrganizerReady = '1';
    const actions = document.createElement('div'); actions.className = 'pc-popup-row-actions';
    const rename = document.createElement('button'); rename.type = 'button'; rename.textContent = 'Rename'; rename.title = 'Rename the actual provider chat';
    const style = document.createElement('button'); style.type = 'button'; style.textContent = '✦ Style'; style.title = 'Emoji, color, and fancy text on the live ChatGPT sidebar';
    rename.addEventListener('click',(event) => { event.preventDefault(); event.stopPropagation(); openInlineRename(shell); });
    style.addEventListener('click',(event) => { event.preventDefault(); event.stopPropagation(); openStyleOnSite(shell); });
    actions.append(rename,style); shell.appendChild(actions);
    if (batchRenameMode) openInlineRename(shell);
  }

  function enhanceRows() {
    for (const shell of chatList.querySelectorAll('.chat-list-row-shell')) enhanceRow(shell);
  }

  function applyQuickActionState(result) {
    if (!quickActionButton) return;
    const mode = result?.mode || 'gather';
    const meta = result?.meta || QUICK_FALLBACK[mode] || QUICK_FALLBACK.gather;
    quickActionButton.textContent = meta.buttonLabel || QUICK_FALLBACK[mode]?.buttonLabel || 'AI tabs';
    quickActionButton.title = `${meta.description || QUICK_FALLBACK[mode]?.description || ''} Right-click the pinned Project Constellation extension icon to change this one-click behavior.`.trim();
    quickActionButton.dataset.mode = mode;
  }

  async function refreshQuickActionState() {
    try {
      const result = await chrome.runtime.sendMessage({type:'PC_COMMAND_CENTER_GET_QUICK_ACTION'});
      if (result?.ok) applyQuickActionState(result);
    } catch (_) {}
  }

  async function runConfiguredQuickAction() {
    // The background worker owns opening Command Center after the action. That is
    // intentional: stash-close may close the tab hosting this popup mid-operation.
    const result = await chrome.runtime.sendMessage({type:'PC_COMMAND_CENTER_RUN_QUICK_ACTION',openCommandCenter:true});
    if (!result?.ok) {
      setToast(clean(result?.error || 'AI tab quick action failed.',180),'error');
      return null;
    }
    setToast(clean(result.message || `Saved ${Number(result.saved || 0)} AI chats.`,220),'success');
    return result;
  }

  function openCommandCenter() {
    chrome.tabs.create({url:chrome.runtime.getURL('chat-vault.html'),active:true}).then(() => window.close()).catch(() => {});
  }

  function installToolbar() {
    if (document.getElementById('pcPopupOrganizerBar')) return;
    const bar = document.createElement('div'); bar.id = 'pcPopupOrganizerBar'; bar.className = 'pc-popup-organizer-bar';
    const center = document.createElement('button'); center.type = 'button'; center.textContent = 'Command Center'; center.title = 'Open the Project Constellation AI operations room';
    const quick = document.createElement('button'); quick.type = 'button'; quick.textContent = 'AI tabs…'; quick.title = 'Run the configured AI tab quick action';
    const renameMode = document.createElement('button'); renameMode.type = 'button'; renameMode.textContent = 'Rename mode'; renameMode.title = 'Show rename fields for every chat in the current Pulse list';
    quickActionButton = quick;
    center.addEventListener('click',openCommandCenter);
    quick.addEventListener('click',() => runConfiguredQuickAction().catch((error) => setToast(clean(error?.message || error,160),'error')));
    renameMode.addEventListener('click',() => {
      batchRenameMode = !batchRenameMode; renameMode.classList.toggle('active',batchRenameMode); renameMode.textContent = batchRenameMode ? 'Rename mode on' : 'Rename mode';
      for (const shell of chatList.querySelectorAll('.chat-list-row-shell')) {
        if (batchRenameMode) openInlineRename(shell);
        else { const form = shell.querySelector(':scope > .pc-popup-inline-rename'); if (form) form.hidden = true; }
      }
    });
    bar.append(center,quick,renameMode);
    const head = chatPulse.querySelector('.section-head');
    if (head?.nextSibling) chatPulse.insertBefore(bar,head.nextSibling); else chatPulse.appendChild(bar);
    refreshQuickActionState().catch(() => {});
  }

  installToolbar(); enhanceRows();
  rowObserver = new MutationObserver(enhanceRows); rowObserver.observe(chatList,{childList:true,subtree:true});
})();
