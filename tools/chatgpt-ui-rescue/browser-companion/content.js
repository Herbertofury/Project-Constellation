(function () {
  'use strict';
  if (globalThis.PCXTaskRecoveryListener) return;
  globalThis.PCXTaskRecoveryListener = true;
  let managed = false, timer = null;
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    const page = globalThis.PCXTaskRecoveryPage;
    if (!page) return;
    if (message?.type === 'PCX_RECOVERY_INSPECT') { managed = true; respond(page.inspect(message.active)); }
    else if (message?.type === 'PCX_RECOVERY_ACT') {
      page.act(message.action, message.active).then(respond).catch(e => respond({ok: false, reason: String(e.message)})); return true;
    } else if (message?.type === 'PCX_RECOVERY_SCAN_MORE') respond(page.scanMore());
  });
  const observer = new MutationObserver(() => {
    if (!managed || timer) return;
    timer = setTimeout(() => {
      timer = null;
      chrome.runtime.sendMessage({type: 'PCX_RECOVERY_DOM_CHANGED'}).catch(() => {});
    }, 300);
  });
  if (document.documentElement) observer.observe(document.documentElement, {childList: true, subtree: true, attributes: true, attributeFilter: ['hidden','aria-hidden','disabled','aria-disabled','data-state']});
})();
