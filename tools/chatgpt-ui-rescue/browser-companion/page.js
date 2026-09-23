/* Isolated-world UI adapter. No private API, cookie export, remote script or approval bypass. */
(function (root) {
  'use strict';
  if (root.PCXTaskRecoveryPage) return;
  const C = root.PCXTaskRecoveryCore;
  let tokens = new Map();
  const CONTINUE = 'Continue this existing scheduled run from its last verified checkpoint. Preserve its complete original scope, Google Sheets/Docs/Drive work, GitHub requirements, email delivery, testing and verification. Do not repeat completed external actions, create a duplicate run, change the schedule, weaken requirements or change permissions. Continue only already-authorized work; do not bypass any approval or security check.';
  const visible = el => !!el && el.isConnected && !el.closest('[hidden],[aria-hidden="true"],[inert]') &&
    getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && !!el.getClientRects().length;
  const text = el => C.normal(el?.innerText || el?.textContent || '');
  const label = el => C.normal(el?.getAttribute('aria-label') || el?.innerText || el?.textContent || el?.value || '');
  const controls = scope => [...scope.querySelectorAll('button,a[href],[role="button"]')].filter(visible);
  const headings = scope => [...scope.querySelectorAll('h1,h2,h3,h4,[role="heading"]')].filter(visible);
  const insideMessage = el => el.closest('[data-message-author-role],pre,code');
  const forbidden = /^(allow(?: .*)?|approve(?: .*)?|confirm(?: .*)?|grant(?: .*)?|review access|review permission|always allow|never ask|don.t ask again|accept(?: .*)?)$/i;
  const security = /permission required|approval required|approve (this|the) action|allow (this|the) (app|action)|grant .*access|additional approval|administrator consent|two.factor|2fa|one.time (code|password)|confirm (the )?(payment|purchase|deletion|transfer)/i;
  function scopes() {
    const dialogs = [...document.querySelectorAll('[role="dialog"],[aria-modal="true"]')].filter(visible);
    const messages = [...document.querySelectorAll('[data-message-author-role="assistant"]')].filter(visible);
    return dialogs.length ? dialogs : messages.length ? [messages.at(-1)] : [document.querySelector('main') || document.body];
  }
  function approval() {
    return scopes().some(scope => {
      const names = controls(scope).map(label);
      return names.some(n => forbidden.test(n)) || (security.test(text(scope)) && names.some(n => /^(continue|proceed|yes|ok)$/i.test(n)));
    });
  }
  function composer() { return [...document.querySelectorAll('#prompt-textarea,[contenteditable="true"][role="textbox"],textarea')].find(visible); }
  const draft = () => { const e = composer(); return !!e && !!C.normal(e.value ?? e.innerText); };
  const busy = () => controls(document).some(el => /^(stop generating|stop streaming|stop response)$/i.test(label(el)) || el.getAttribute('data-testid') === 'stop-button');
  function signedOut() {
    return /^\/(auth|login|signin)(\/|$)/.test(location.pathname) ||
      controls(document).some(b => /^(log in|sign in)$/i.test(label(b))) && !composer();
  }
  const challenge = () => /^(just a moment|verify you are human|security verification)/i.test(document.title) ||
    !![...document.querySelectorAll('iframe[src*="challenges.cloudflare.com"]')].find(visible);
  function token(el, kind, binding) {
    const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() :
      [...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, '0')).join('');
    tokens.set(id, {el, kind, binding, url: location.href, name: label(el)});
    return {token: id, kind};
  }
  function usefulHeading(h) { return text(h) && !/^(scheduled|scheduled tasks|tasks|active|completed|paused)$/i.test(text(h)); }
  function cardTitle(scope) {
    const named = scope.getAttribute('data-task-title');
    if (named) return C.normal(named);
    const hs = headings(scope).filter(usefulHeading);
    if (hs.length === 1) return text(hs[0]);
    // The supplied screenshot uses an untagged title in a side panel.
    const known = C.TASKS.filter(t => text(scope).includes(t));
    if (known.length === 1) return known[0];
    const lines = (scope.innerText || '').split('\n').map(C.normal).filter(Boolean);
    const candidate = lines.find(s => !/^(hourly|daily|weekly|next run|\d+\s+(seconds?|minutes?|hours?|days?)|this task|follow.up|resume|paused|disabled|edit|scheduled|tasks)/i.test(s));
    return candidate && candidate.length < 200 && !/[{}<>]/.test(candidate) ? candidate : '';
  }
  function cardRoot(button) {
    let node = button.parentElement;
    while (node && ![document.body, document.documentElement].includes(node)) {
      if (insideMessage(node)) return null;
      const hs = headings(node).filter(usefulHeading);
      if (hs.length > 1) return null;
      if (cardTitle(node) && (hs.length === 1 || C.TASKS.some(t => text(node).includes(t)) ||
          node.matches('article,[role="listitem"],[data-task-id],[data-task-title],[data-testid*="task-card"]'))) return node;
      node = node.parentElement;
    }
    return null;
  }
  function stableStatus(scope) {
    return text(scope).replace(/\b\d+\s+(seconds?|minutes?|hours?|days?)\s+ago\b/gi, 'AGE')
      .replace(/next run in\s+\d+\s+\w+/gi, 'NEXT_RUN');
  }
  function scanTasks() {
    if (!C.schedule(location.href)) return [];
    const roots = new Set([...document.querySelectorAll('article,[data-task-id],[data-task-title],[role="listitem"],[data-testid*="task-card"]')]
      .filter(el => visible(el) && !insideMessage(el)));
    for (const button of controls(document)) if (!insideMessage(button) && /^(follow-up|follow up|resume|view details|open task)$/i.test(label(button))) {
      const card = cardRoot(button); if (card) roots.add(card);
    }
    const result = [], seen = new Set();
    for (const scope of roots) {
      const title = cardTitle(scope);
      if (!title || C.tombstone(title) || headings(scope).filter(usefulHeading).length > 1) continue;
      const value = text(scope);
      const attention = /needs (your )?attention|action required|follow[ -]up/i.test(value);
      const paused = /\bpaused\b|\bdisabled\b/i.test(value);
      const button = controls(scope).find(el => /^follow[ -]up$/i.test(label(el)));
      const id = scope.getAttribute('data-task-id') || scope.getAttribute('data-automation-id') || '';
      const runLink = [...scope.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).find(x => /^\/c\//.test(x)) || '';
      const runId = scope.getAttribute('data-run-id') || runLink || scope.querySelector('time[datetime]')?.getAttribute('datetime') || '';
      const binding = {title, id, runId};
      const key = C.key(binding);
      if (seen.has(key)) continue; seen.add(key);
      result.push({...binding, attention, paused,
        running: /\brunning\b|in progress/i.test(value),
        completed: /\bcompleted\b|finished successfully/i.test(value) && !attention,
        fingerprint: C.hash(key + stableStatus(scope)), openAction: button ? token(button, 'open-followup', binding) : null});
    }
    return result;
  }
  function isBound(active, tasks) {
    if (!active) return false;
    if (active.conversationUrl && C.conversation(location.href) && new URL(active.conversationUrl).pathname === location.pathname) return true;
    if (tasks.some(t => t.title === active.title && (!active.id || t.id === active.id))) return true;
    if (C.normal(document.title).includes(C.normal(active.title)) || headings(document).some(h => text(h) === C.normal(active.title))) return true;
    return scopes().some(s => s.matches('[role="dialog"],[aria-modal="true"]') &&
      (text(s).includes(C.normal(active.title)) || (!!active.id && s.getAttribute('data-task-id') === active.id)));
  }
  function inspect(active = null) {
    tokens = new Map();
    const tasks = scanTasks(), live = scopes(), input = composer();
    const snap = {url: location.href, auth: signedOut(), challenge: challenge(), approval: approval(), draft: draft(),
      running: busy(), tasks, recognized: C.schedule(location.href) &&
        (headings(document).some(h => /^(scheduled|scheduled tasks|tasks)$/i.test(text(h))) || tasks.length > 0),
      explicitEmpty: C.schedule(location.href) && /you (have|don.t have) (no|any) (scheduled )?tasks|no scheduled tasks|no tasks yet/i.test(text(document.querySelector('main') || document.body)),
      bound: false, completed: false, ambiguous: false, action: null,
      coverage: 'VISIBLE_DOM', fingerprint: ''};
    if (!active) return snap;
    snap.bound = isBound(active, tasks);
    snap.recognized ||= snap.bound;
    if (!snap.bound) return snap;
    const task = tasks.find(t => t.title === active.title && (!active.id || t.id === active.id));
    snap.running ||= !!task?.running;
    snap.completed = !!task?.completed;
    if (snap.auth || snap.challenge || snap.approval || snap.running || snap.draft) return snap;
    let contexts = live.filter(s => s.matches('[role="dialog"],[aria-modal="true"]'));
    if (contexts.length && !contexts.every(s => text(s).includes(C.normal(active.title)) || (!!active.id && s.getAttribute('data-task-id') === active.id))) {
      snap.ambiguous = true; return snap;
    }
    if (!contexts.length) contexts = live;
    const opts = [...new Set(contexts.flatMap(controls).filter(e => /^(continue generating|resume|continue)$/i.test(label(e)) && !e.closest('[data-message-author-role="user"],pre,code')))];
    if (opts.length > 1) { snap.ambiguous = true; return snap; }
    const context = contexts.map(text).join(' '), el = opts[0];
    snap.fingerprint = C.hash(active.title + '|' + context + '|' + label(el));
    if (el && (/^continue generating$/i.test(label(el)) || /interrupted|paused|stopped|resume (this|the) (task|run)|continue (this|the) (task|run)/i.test(context))) {
      snap.action = token(el, /^resume$/i.test(label(el)) ? 'resume' : 'continue-generating', active);
    } else if (input && /(?:reply|say|type|send) ["']?continue["']? (?:to|and)|(?:shall|should) I continue\??|continue (?:this|the) (?:existing )?(?:run|task)\?/i.test(context) &&
        !/permission|approv|grant|sign in|log in|password|which|provide|upload|missing (information|file)|choose/i.test(context)) {
      const send = controls(document).find(e => e.getAttribute('data-testid') === 'send-button' || /^(send|send message|send prompt)$/i.test(label(e)));
      if (send) snap.action = token(send, 'continue-run', active);
    }
    return snap;
  }
  async function act(action, active) {
    const entry = tokens.get(action?.token); tokens.clear();
    if (!entry || entry.kind !== action.kind || entry.url !== location.href || !visible(entry.el)) return {ok: false, reason: 'STALE_CONTROL'};
    if (!C.site(location.href) || signedOut() || challenge() || approval() || busy()) return {ok: false, reason: 'STATE_CHANGED_OR_APPROVAL'};
    if (label(entry.el) !== entry.name || forbidden.test(entry.name)) return {ok: false, reason: 'CONTROL_CHANGED'};
    if (draft()) return {ok: false, reason: 'USER_DRAFT_PRESENT'};
    if (entry.el.matches('a[href]')) {
      const u = new URL(entry.el.href, location.href);
      if (u.origin !== location.origin || !/^\/(c|schedules|tasks)(\/|$)/.test(u.pathname)) return {ok: false, reason: 'UNSAFE_DESTINATION'};
    }
    if (entry.kind === 'open-followup') {
      if (!C.schedule(location.href) || !/^follow[ -]up$/i.test(entry.name) || C.tombstone(entry.binding.title)) return {ok: false, reason: 'UNBOUND_FOLLOWUP'};
    } else if (!active || entry.binding.title !== active.title || !isBound(active, scanTasks())) return {ok: false, reason: 'UNBOUND_RUN'};
    if (entry.kind === 'continue-run') {
      const input = composer();
      if (!input) return {ok: false, reason: 'COMPOSER_MISSING'};
      input.focus();
      if (input instanceof HTMLTextAreaElement) Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, CONTINUE);
      else {
        document.execCommand('insertText', false, CONTINUE);
        if (C.normal(input.innerText) !== C.normal(CONTINUE)) input.textContent = CONTINUE;
      }
      input.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: CONTINUE}));
      await new Promise(r => setTimeout(r, 80));
      if (approval() || signedOut() || challenge() || busy()) return {ok: false, reason: 'DRAFT_PREPARED_BUT_SECURITY_STATE_CHANGED'};
      if (C.normal(input.value ?? input.innerText) !== C.normal(CONTINUE)) return {ok: false, reason: 'DRAFT_CHANGED'};
    }
    if (entry.el.disabled || entry.el.getAttribute('aria-disabled') === 'true') return {ok: false, reason: 'CONTROL_DISABLED'};
    entry.el.click();
    return {ok: true, status: 'CLICK_DISPATCHED_NOT_VERIFIED', kind: entry.kind};
  }
  // Scroll is confined to a controller-owned, idle schedule tab. No task/result count cap.
  function scanMore() {
    if (!C.schedule(location.href) || approval() || signedOut() || challenge() || draft() || busy()) return {status: 'SCROLL_NOT_SAFE'};
    const main = document.querySelector('main') || document.scrollingElement;
    const scrollables = [main, ...main.querySelectorAll('*')].filter(e => e.scrollHeight > e.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(e).overflowY));
    const owner = scrollables.find(e => e.querySelector('article,[data-task-id],button')) || document.scrollingElement;
    const atBottom = owner.scrollTop + owner.clientHeight >= owner.scrollHeight - 3;
    if (!atBottom) { owner.scrollTop += Math.max(owner.clientHeight * .8, 200); return {status: 'SCROLLED', position: owner.scrollTop}; }
    const more = controls(main).filter(e => /^(load more tasks|show more tasks)$/i.test(label(e)));
    if (more.length === 1 && !more[0].disabled) { more[0].click(); return {status: 'MORE_TASKS_REQUESTED'}; }
    const next = [...main.querySelectorAll('nav,[role="navigation"]')].filter(visible)
      .flatMap(controls).filter(e => /^(next|next page)$/i.test(label(e)) && !e.disabled && e.getAttribute('aria-disabled') !== 'true');
    if (next.length === 1 && /tasks|pagination|pages/i.test(next[0].closest('nav,[role="navigation"]')?.getAttribute('aria-label') || '')) {
      next[0].click(); return {status: 'NEXT_PAGE_REQUESTED'};
    }
    if (main.querySelector('[aria-busy="true"],[role="progressbar"]')) return {status: 'LOADING_MORE'};
    return {status: next.length ? 'PAGINATION_UNVERIFIED' : 'END_OF_VISIBLE_LIST'};
  }
  root.PCXTaskRecoveryPage = {inspect, act, scanMore};
})(globalThis);
