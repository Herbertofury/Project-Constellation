(() => {
  'use strict';

  const VERSION = 1;
  const QUICK_ACTION_KEY = 'projectConstellationCommandCenterQuickActionV1';
  const LAST_ACTION_KEY = 'projectConstellationCommandCenterLastQuickActionV1';
  const DEFAULT_MODE = 'gather';
  const MODES = Object.freeze(['gather','smart-collapse','stash-close']);
  const META = Object.freeze({
    gather:Object.freeze({
      id:'gather',
      shortLabel:'Keep live',
      buttonLabel:'Gather AI chats',
      menuLabel:'Keep tabs live (gather only)',
      description:'Save and organize every open AI chat without closing provider tabs.'
    }),
    'smart-collapse':Object.freeze({
      id:'smart-collapse',
      shortLabel:'Smart collapse',
      buttonLabel:'Smart collapse AI chats',
      menuLabel:'Smart collapse (close finished, keep working/pinned)',
      description:'Save everything, close only clearly finished unpinned chats, and keep working, attention, uncertain, and pinned chats alive.'
    }),
    'stash-close':Object.freeze({
      id:'stash-close',
      shortLabel:'OneTab-style',
      buttonLabel:'Stash + close AI chats',
      menuLabel:'OneTab-style stash (save, close unpinned)',
      description:'Save and verify every AI chat, then close all unpinned AI tabs even if a turn is still running.'
    })
  });

  const clean = (value,max = 120) => String(value ?? '').replace(/\s+/g,' ').trim().slice(0,max);

  function normalizeMode(value) {
    const mode = clean(value,40);
    return MODES.includes(mode) ? mode : DEFAULT_MODE;
  }

  function modeMeta(value) {
    return META[normalizeMode(value)];
  }

  function sentinelInfo(state = {}) {
    const chat = state?.chat || state || {};
    const generation = state?.generation || {};
    const status = clean(chat.status || chat.rawStatus || state.status || 'idle',80).toLowerCase();
    const health = clean(chat.healthState || state?.health?.state || state.healthState || '',100).toLowerCase();
    const active = Boolean(
      status === 'running' ||
      generation.active ||
      state.healthActive ||
      /^(?:working|tool-running|tool-quiet|quiet-working|uncertain-working|request-stalled|tool-stalled|stalled|capacity-watch|capacity-handoff|capacity-reached)$/i.test(health)
    );
    const attention = Boolean(
      /^(?:paused|waiting-user|blocked-approval|delivery-timeout|connection-interrupted|response-interrupted|send-failed|refresh-required|rate-limited|errored|stalled|auth-required|unavailable)$/i.test(status) ||
      /^(?:tool-stalled|tool-dead|request-stalled|stalled|dead|capacity-watch|capacity-handoff|capacity-reached|delivery-timeout|connection-interrupted|response-interrupted|send-failed)$/i.test(health)
    );
    const complete = Boolean(
      !active &&
      !attention &&
      /^(?:idle|completed|complete|done|finished|healthy)$/i.test(status || 'idle')
    );
    return { status, health, active, attention, complete };
  }

  function smartDisposition(tab = {}, state = null) {
    if (tab?.pinned) return { close:false, reason:'pinned' };
    if (!state) return { close:false, reason:'unproven' };
    const info = sentinelInfo(state);
    if (info.active) return { close:false, reason:'working' };
    if (info.attention) return { close:false, reason:'attention' };
    if (info.complete) return { close:true, reason:'finished' };
    return { close:false, reason:'uncertain' };
  }

  function closeDisposition(modeValue, tab = {}, state = null) {
    const mode = normalizeMode(modeValue);
    if (mode === 'gather') return { close:false, reason:'keep-live' };
    if (mode === 'stash-close') return tab?.pinned ? { close:false, reason:'pinned' } : { close:true, reason:'one-tab-style' };
    return smartDisposition(tab,state);
  }

  globalThis.ProjectConstellationCommandCenterActionCore = Object.freeze({
    VERSION, QUICK_ACTION_KEY, LAST_ACTION_KEY, DEFAULT_MODE, MODES, META,
    clean, normalizeMode, modeMeta, sentinelInfo, smartDisposition, closeDisposition
  });
})();
