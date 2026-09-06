(() => {
  'use strict';

  const core = globalThis.ProjectConstellationChatVaultCore || null;
  const $ = (id) => document.getElementById(id);
  const PULSE_UX_KEY = 'projectConstellationPulseUxSettings';
  const bound = new WeakSet();

  const clean = (value, max = 220) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

  function report(message, kind = '') {
    const vaultStatus = $('vaultStatus');
    if (vaultStatus) {
      vaultStatus.textContent = clean(message, 260);
      vaultStatus.className = kind;
      return;
    }
    const popupStatus = $('status');
    if (popupStatus) popupStatus.textContent = clean(message, 260);
  }

  async function focusTab(tab) {
    if (!tab?.id) return false;
    if (tab.windowId) await chrome.windows?.update?.(tab.windowId, { focused:true }).catch(() => {});
    await chrome.tabs.update(tab.id, { active:true });
    return true;
  }

  async function openOrFocusExtensionPage(targetUrl, matchPrefix = targetUrl) {
    const tabs = await chrome.tabs.query({});
    const existing = tabs.find((tab) => String(tab.url || '').startsWith(matchPrefix));
    if (existing?.id) {
      if (existing.url !== targetUrl) await chrome.tabs.update(existing.id, { url:targetUrl }).catch(() => {});
      await focusTab(existing);
      return existing;
    }
    return chrome.tabs.create({ url:targetUrl, active:true });
  }

  function bindExtensionPageButton(id, targetPath, matchPath = targetPath) {
    const button = $(id);
    if (!button || bound.has(button)) return;
    bound.add(button);
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      button.disabled = true;
      const original = button.textContent;
      try {
        const targetUrl = chrome.runtime.getURL(targetPath);
        const matchPrefix = chrome.runtime.getURL(matchPath);
        await openOrFocusExtensionPage(targetUrl, matchPrefix);
        if (typeof window.close === 'function') window.close();
      } catch (error) {
        report(clean(error?.message || `Could not open ${original}.`, 220));
        button.disabled = false;
      }
    }, true);
  }

  function installPopupLaunchQol() {
    if (!$('chatPulse')) return;
    bindExtensionPageButton('openHome', 'home.html', 'home.html');
    bindExtensionPageButton('openConstellation', 'chat-vault.html', 'chat-vault.html');
    bindExtensionPageButton('openAccounts', 'home.html?view=connections', 'home.html');

    const attention = $('attentionNotificationsEnabled');
    if (attention && !bound.has(attention)) {
      bound.add(attention);
      attention.addEventListener('change', () => {
        // popup.js historically preserved the old value through ...pulseSettings.
        // Commit the user's current checkbox after that handler finishes.
        setTimeout(async () => {
          const stored = await chrome.storage.local.get(PULSE_UX_KEY).catch(() => ({}));
          const next = { ...(stored?.[PULSE_UX_KEY] || {}), attentionNotificationsEnabled:Boolean(attention.checked) };
          await chrome.storage.local.set({ [PULSE_UX_KEY]:next }).catch(() => {});
        }, 80);
      });
    }

    const tagHint = $('tabTagHint');
    const tagInput = $('customTabTag');
    const apply = $('applyTabTag');
    const clear = $('clearTabTag');
    const presets = $('tagPresets');
    const syncTagAvailability = () => {
      if (!tagHint) return;
      const unavailable = /open a supported ai chat|not a supported ai chat/i.test(tagHint.textContent || '');
      for (const node of [tagInput, apply, clear, ...(presets?.querySelectorAll('button[data-tag]') || [])]) {
        if (!node) continue;
        node.disabled = unavailable;
        if (unavailable) node.title = 'Open a supported AI chat to use tab tags.';
        else if (node.title === 'Open a supported AI chat to use tab tags.') node.removeAttribute('title');
      }
    };
    if (tagHint) {
      new MutationObserver(syncTagAvailability).observe(tagHint, { childList:true, characterData:true, subtree:true });
      syncTagAvailability();
    }

    const pressure = $('pressure');
    const reset = $('resetMetrics');
    const syncResetAvailability = () => {
      if (!pressure || !reset) return;
      const unavailable = pressure.dataset.state === 'offline' || /offline/i.test(pressure.textContent || '');
      reset.disabled = unavailable;
      reset.title = unavailable ? 'Open a supported AI chat to reset its session metrics.' : 'Reset metrics for the current supported AI chat.';
    };
    if (pressure && reset) {
      new MutationObserver(syncResetAvailability).observe(pressure, { childList:true, characterData:true, attributes:true, attributeFilter:['data-state'], subtree:true });
      syncResetAvailability();
    }
  }

  function hardenOrganizerRows() {
    if (!core) return;
    const chatList = $('chatList');
    if (!chatList) return;
    for (const shell of chatList.querySelectorAll('.chat-list-row-shell')) {
      const row = shell.querySelector('.chat-list-row');
      const provider = core.providerForUrl(row?.dataset?.url || '');
      if (provider?.id === 'chatgpt' && core.conversationId(row?.dataset?.url || '')) continue;
      // Native rename/style is currently ChatGPT-only. Do not render controls that
      // can only answer "unsupported" for every click.
      shell.querySelector(':scope > .pc-popup-row-actions')?.remove();
      shell.querySelector(':scope > .pc-popup-inline-rename')?.remove();
    }
  }

  function hardenOrganizerToolbar() {
    const bar = $('pcPopupOrganizerBar');
    if (!bar) return;
    const center = [...bar.querySelectorAll('button')].find((button) => /command center/i.test(button.textContent || ''));
    if (!center || bound.has(center)) return;
    bound.add(center);
    center.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      center.disabled = true;
      try {
        await openOrFocusExtensionPage(chrome.runtime.getURL('chat-vault.html'), chrome.runtime.getURL('chat-vault.html'));
        if (typeof window.close === 'function') window.close();
      } catch (error) {
        report(clean(error?.message || 'Could not open AI Command Center.', 220));
        center.disabled = false;
      }
    }, true);
  }

  function installPopupOrganizerQol() {
    const chatList = $('chatList');
    if (!chatList) return;
    const sync = () => { hardenOrganizerRows(); hardenOrganizerToolbar(); };
    new MutationObserver(sync).observe(document.body, { childList:true, subtree:true });
    sync();
  }

  function installDialogQol() {
    document.addEventListener('click', (event) => {
      const closer = event.target?.closest?.('[data-dialog-close]');
      if (!closer) return;
      const id = closer.dataset.dialogClose;
      const dialog = id ? $(id) : closer.closest('dialog');
      if (!dialog?.open) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      dialog.close('cancel');
    }, true);

    const importButton = $('importChats');
    const importFile = $('jsonImportFile');
    const importDialog = $('importDialog');
    if (importButton && importFile) importButton.addEventListener('click', () => { importFile.value = ''; });
    if (importDialog && importFile) importDialog.addEventListener('close', () => { importFile.value = ''; });
  }

  async function touchVaultChat(key, tab) {
    if (!core?.VAULT_KEY || !key || !tab?.id) return;
    const stored = await chrome.storage.local.get(core.VAULT_KEY).catch(() => ({}));
    const vault = core.normalizeVault(stored?.[core.VAULT_KEY]);
    let changed = false;
    for (const stack of vault.stacks) {
      for (const item of stack.items) {
        if (item.key !== key) continue;
        item.lastOpenedAt = Date.now();
        item.sourceTabId = Number(tab.id || 0);
        item.sourceWindowId = Number(tab.windowId || 0);
        stack.updatedAt = Date.now();
        changed = true;
      }
    }
    if (changed) {
      vault.updatedAt = Date.now();
      await chrome.storage.local.set({ [core.VAULT_KEY]:core.normalizeVault(vault) }).catch(() => {});
    }
  }

  async function openOrFocusChat(url) {
    if (!core) throw new Error('Chat routing is unavailable.');
    const canonical = core.canonicalUrl(url || '');
    const key = core.chatKey(canonical);
    if (!canonical || !key) throw new Error('This saved chat URL is no longer valid.');
    const tabs = await chrome.tabs.query({});
    const existing = tabs.find((tab) => core.chatKey(tab.url || '') === key);
    const tab = existing?.id ? existing : await chrome.tabs.create({ url:canonical, active:true });
    if (existing?.id) await focusTab(existing);
    await touchVaultChat(key, tab);
    chrome.runtime.sendMessage({ type:'PC_TAB_BEACON_REFRESH' }).catch(() => {});
    return { tab, reused:Boolean(existing?.id) };
  }

  function syncMoveSelects() {
    for (const select of document.querySelectorAll('#chatGrid .move-select')) {
      const noDestination = select.options.length <= 1;
      select.disabled = noDestination;
      const placeholder = select.options[0];
      if (placeholder) placeholder.textContent = noDestination ? 'No other projects' : (select.closest('.chat-card')?.dataset?.stackId ? 'Move…' : 'Assign…');
      select.title = noDestination ? 'Create another project to move this chat.' : 'Assign this chat to another project.';
    }
  }

  function syncCommandButtons() {
    const status = $('vaultStatus');
    const busy = status?.classList?.contains('busy') || false;
    const viewMeta = $('viewMeta');
    const emptyProject = /^0 organized chat/i.test(clean(viewMeta?.textContent || '', 120));
    const openMissing = $('openMissing');
    const guarded = ['gatherOpenChats','emptyGather','organizeTabs','newProject','newProjectSide','renameProject','deleteProject','importChats','exportVault'];
    for (const id of guarded) {
      const node = $(id);
      if (node) node.disabled = busy;
    }
    if (openMissing) {
      openMissing.disabled = busy || (!openMissing.hidden && emptyProject);
      openMissing.title = emptyProject ? 'This project has no saved chats to open.' : 'Open only project chats that are not already live.';
    }
  }

  function syncRefreshButton() {
    const button = $('refreshLive');
    const label = $('lastLiveUpdate');
    if (!button || !label) return;
    const checking = /^checking live state/i.test(label.textContent || '');
    if (!button.dataset.pcDefaultLabel) button.dataset.pcDefaultLabel = button.textContent || 'Refresh live state';
    button.disabled = checking;
    button.textContent = checking ? 'Refreshing…' : button.dataset.pcDefaultLabel;
  }

  function installCommandCenterQol() {
    const grid = $('chatGrid');
    if (!grid || !core) return;
    installDialogQol();

    grid.addEventListener('click', async (event) => {
      const button = event.target?.closest?.('button.open-chat,button.focus-chat');
      if (!button) return;
      const card = button.closest('.chat-card');
      const url = card?.querySelector('.chat-url')?.textContent || '';
      if (!url) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const old = button.textContent;
      button.disabled = true;
      button.textContent = old === 'Focus' ? 'Focusing…' : 'Opening…';
      try {
        const result = await openOrFocusChat(url);
        report(result.reused ? 'Focused the existing provider tab. No duplicate was opened.' : 'Opened the saved provider chat.', 'success');
      } catch (error) {
        report(clean(error?.message || 'Could not open that chat.', 220), 'error');
      } finally {
        button.disabled = false;
        button.textContent = old;
      }
    }, true);

    const status = $('vaultStatus');
    const viewMeta = $('viewMeta');
    const lastLive = $('lastLiveUpdate');
    const sync = () => { syncMoveSelects(); syncCommandButtons(); syncRefreshButton(); };
    new MutationObserver(sync).observe(grid, { childList:true, subtree:true });
    if (status) new MutationObserver(sync).observe(status, { childList:true, characterData:true, attributes:true, attributeFilter:['class'], subtree:true });
    if (viewMeta) new MutationObserver(sync).observe(viewMeta, { childList:true, characterData:true, subtree:true });
    if (lastLive) new MutationObserver(sync).observe(lastLive, { childList:true, characterData:true, subtree:true });
    sync();
  }

  installPopupLaunchQol();
  installPopupOrganizerQol();
  installCommandCenterQol();
})();
