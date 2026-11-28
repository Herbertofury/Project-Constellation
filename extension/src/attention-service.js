(() => {
  'use strict';

  // This is the browser delivery/persistence adapter. Health classification is supplied
  // by the existing provider sensors; it never infers a stalled agent from elapsed time.
  const STORAGE_KEY = 'projectConstellationAttentionV1';
  const ALARM_NAME = 'project-constellation-attention-reminder';
  // Recovery deadlines belong to a failed delivery, never an idle polling loop.
  // Persist them so a suspended/restarted worker keeps the same bounded budget.
  const DELIVERY_RETRY_MS = Object.freeze([2000, 10000, 30000]);
  const DEFAULTS = Object.freeze({ enabled:true, audioEnabled:true, notificationsEnabled:true,
    volume:0.45, reminderMinutes:0, maxReminders:3, muteUntil:0, completionEnabled:false });
  const STATES = Object.freeze({
    'blocked-approval':['permission_required','Approval needed','critical'],
    permission_required:['permission_required','Approval needed','critical'],
    'provider-review':['waiting_for_user','Review needed','warning'],
    'waiting-user':['waiting_for_user','Your input is needed','warning'],
    waiting_for_user:['waiting_for_user','Your input is needed','warning'],
    no_visible_progress:['no_visible_progress','No visible progress','warning'],
    'auth-required':['auth_required','Sign-in needed','critical'],
    'rate-limited':['rate_limited','Provider rate limit','warning'],
    rate_limited:['rate_limited','Provider rate limit','warning'],
    'capacity-watch':['context_limit','Conversation capacity warning','warning'],
    'capacity-handoff':['context_limit','Secure a conversation handoff','critical'],
    'capacity-reached':['context_limit','Conversation limit reached','critical'],
    context_limit:['context_limit','Conversation limit reached','critical'],
    'delivery-timeout':['error','Message delivery timed out','critical'],
    'connection-interrupted':['error','Connection interrupted','critical'],
    'response-interrupted':['error','Response interrupted','critical'],
    'send-failed':['error','Message was not sent','critical'],
    'refresh-required':['error','Chat needs a refresh','critical'],
    errored:['error','Provider error','critical'], error:['error','Provider error','critical'],
    unavailable:['error','Conversation unavailable','critical'],
    dead:['error','Chat needs attention','critical'],
    'tool-dead':['error','Tool stopped responding','critical'],
    stalled:['error','Chat may be stalled','warning'],
    'request-stalled':['error','Request may be stalled','warning'],
    'tool-stalled':['error','Tool may be stalled','warning']
  });
  const QUIET_STATES = new Set(['quiet-working','uncertain-working','tool-quiet']);
  const SETTLED_STATES = new Set(['idle','healthy','completed','working','running','tool-running']);
  const SUSPENDED_STATES = new Set(['suspended','discarded','frozen','closed','reconnecting','sensor-offline']);
  const text = (value, max = 240) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const clamp = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
  const copy = (value) => JSON.parse(JSON.stringify(value));
  function canonicalUrl(value) {
    try { const url = new URL(String(value || '')); return url.protocol === 'https:' ? `${url.origin}${url.pathname}`.slice(0, 1000) : ''; }
    catch (_) { return ''; }
  }
  function hash(value) { let out = 2166136261; for (const ch of value) { out ^= ch.charCodeAt(0); out = Math.imul(out, 16777619); } return (out >>> 0).toString(36); }
  function normalizeSettings(value = {}) {
    return { enabled:value.enabled !== false, audioEnabled:value.audioEnabled !== false,
      notificationsEnabled:value.notificationsEnabled !== false, completionEnabled:value.completionEnabled === true,
      volume:clamp(value.volume, 0, 1, DEFAULTS.volume),
      reminderMinutes:clamp(value.reminderMinutes, 0, 120, DEFAULTS.reminderMinutes),
      maxReminders:Math.floor(clamp(value.maxReminders, 0, 10, DEFAULTS.maxReminders)),
      muteUntil:clamp(value.muteUntil, 0, Number.MAX_SAFE_INTEGER, 0) };
  }
  function observation(input = {}, at = Date.now()) {
    const tabId = Number(input.tabId || 0);
    if (!Number.isSafeInteger(tabId) || tabId < 1) return null;
    const url = canonicalUrl(input.url || input.chat?.url);
    if (!url) return null;
    const candidates=[input.status,input.chat?.status,input.healthState,input.chat?.healthState].filter(Boolean);
    const suspended=input.discarded||input.frozen||candidates.some((value)=>SUSPENDED_STATES.has(value));
    const permission=input.permission?.active||input.chat?.permission?.active||candidates.some((value)=>['blocked-approval','permission_required'].includes(value));
    const status = text(suspended ? (candidates.includes('closed')?'closed':'suspended') : permission ? 'permission_required' : input.healthState || input.chat?.healthState || input.status || input.chat?.status || 'idle', 64);
    const sourceId = text(input.sourceId || 'local', 160);
    const documentId = text(input.documentId || input.chatId || input.chat?.id || url, 180);
    const key = `${sourceId}:${tabId}:${hash(documentId + ':' + url)}`;
    let incident = STATES[status] || null;
    // Existing sensors carry corroborated health evidence. A raw stale status label
    // without current-turn evidence is not enough to ring an alarm.
    if (/stalled|dead/.test(status) && !input.failure?.active && !input.corroborated &&
        !input.generation?.active && !input.generation?.stopControl && !input.generation?.assistantBusy &&
        !(Number(input.network?.pending || 0) > 0) && !input.health?.corroborated && !(input.health?.proof?.sources?.length >= 2)) incident = null;
    return { key, sourceId, tabId, documentId, runId:text(input.runId || input.generation?.runId || '', 120), url,
      title:text(input.title || input.chat?.title || input.providerName || 'Agent chat'),
      providerId:text(input.providerId || '', 60), browser:text(input.browser || 'This browser', 80),
      status, kind:incident?.[0] || (SUSPENDED_STATES.has(status) ? 'suspended' : QUIET_STATES.has(status) ? 'running' : status === 'healthy' ? 'idle' : status),
      label:incident?.[1] || '', severity:incident?.[2] || '',
      reason:text(input.reason || input.failure?.title || input.health?.detail || input.statusDetail || (incident?.[0] === 'permission_required' ? 'Open this chat and review the permission request.' : ''), 300),
      observedAt:clamp(input.observedAt, 0, at + 5000, at),
      authoritative:input.authoritative !== false && input.source !== 'scripting-dom-probe' && !input.reconnecting,
      incident:Boolean(incident), suspended:SUSPENDED_STATES.has(status) };
  }

  function createService(io = {}) {
    const now = () => io.now?.() ?? Date.now();
    let state = null;
    let loading = null;
    let queue = Promise.resolve();
    let owner = { enabled:true, reason:'standalone' };
    let scheduledAt;
    let started=false;
    let needsPersistence=false;
    let reminderWriteAttempt=0,reminderWriteRetryAt=0;
    const listeners = new Set();
    const enqueue = (work) => { const task = queue.then(work); queue = task.catch(() => {}); return task; };
    async function load() {
      if (state) return state;
      if (!loading) loading = (async () => {
        const stored = await io.read?.(STORAGE_KEY) || {};
        state = { schema:1, sequence:Number(stored.sequence || 0), settings:normalizeSettings(stored.settings),
          sessions:Array.isArray(stored.sessions) ? stored.sessions : [],
          incidents:Array.isArray(stored.incidents) ? stored.incidents : [],
          delivery:stored.delivery && typeof stored.delivery === 'object' ? stored.delivery : {}, updatedAt:Number(stored.updatedAt || 0) };
        recoverInterruptedDeliveries();
        return state;
      })().finally(() => { loading = null; });
      return loading;
    }
    function snapshot() {
      return copy({ ...state, audioOwner:owner, counts:{
        open:state.incidents.filter((x) => !x.resolvedAt && !x.acknowledgedAt).length,
        acknowledged:state.incidents.filter((x) => !x.resolvedAt && x.acknowledgedAt).length,
        suspended:state.sessions.filter((x) => x.suspended).length,
        sessions:state.sessions.length } });
    }
    async function persist(event = null) {
      // A rejected write must remain dirty even if the next observation has the
      // same visible state. In-memory deduplication is not a durable ACK.
      needsPersistence=true;
      state.updatedAt = now();
      if (state.incidents.length > 500) {
        const open = state.incidents.filter((x) => !x.resolvedAt);
        const resolved = state.incidents.filter((x) => x.resolvedAt);
        state.incidents = [...resolved.slice(-500), ...open];
      }
      state.sessions = [...state.sessions.filter((x) => x.status === 'closed').slice(-500), ...state.sessions.filter((x) => x.status !== 'closed')];
      await io.write?.(STORAGE_KEY, state);
      needsPersistence=false;
      if(reminderWriteAttempt>DELIVERY_RETRY_MS.length){reminderWriteAttempt=0;reminderWriteRetryAt=0;}
      if (event) {
        for (const listener of listeners) { try { listener(copy(event)); } catch (_) {} }
        io.changed?.({ type:event.type, id:event.incident?.id || '', session:event.session ? copy(event.session) : null });
      }
    }
    function recoverInterruptedDeliveries() {
      for(const item of state.incidents) {
        const delivery=item.delivery;
        if(!delivery||(!['pending','claimed'].includes(delivery.audio)&&delivery.notification!=='pending'))continue;
        if(delivery.notification==='pending') {
          delivery.notification='failed';
          delivery.notificationError='The worker stopped before notification delivery was confirmed.';
        }
        if(delivery.audio==='pending'||delivery.audio==='claimed') {
          // Older journals used pending for both unstarted and claimed audio.
          // A durable playback claim is ambiguous after termination: report it,
          // but never automatically replay sound which may already have started.
          const claimed=delivery.audio==='claimed'||Number(state.delivery.lastAudioAt||0)===Number(delivery.at||-1);
          delivery.audio=claimed?'interrupted':'failed';
          delivery.audioError=claimed?'Sound delivery was interrupted after its playback claim. Use Test alert to check audio.':'The worker stopped before sound playback was requested.';
        }
        const failed=delivery.notification==='failed'||delivery.audio==='failed';
        const delay=DELIVERY_RETRY_MS[Math.max(0,Number(delivery.attempt||1)-1)];
        delivery.retryAt=failed&&delay?Math.max(now(),Number(delivery.at||0)+delay):0;
        delivery.retryExhausted=failed&&!delay;
        state.delivery.lastResult=copy(delivery);
        state.delivery.lastError=[delivery.notificationError,delivery.audioError].filter(Boolean).join(' ');
        if(delivery.retryExhausted)state.delivery.lastError+=' Automatic delivery retries are exhausted. Check the alert channels and use Test alert.';
        state.delivery.lastErrorAt=now();
        needsPersistence=true;
      }
    }
    function matchesSnapshot(row, expected) {
      return !expected||Boolean(row&&['key','runId','status','suspended','observedAt'].every(field=>row[field]===expected[field]));
    }
    function channelsEnabled() {
      return state.settings.notificationsEnabled || (state.settings.audioEnabled && state.settings.volume > 0);
    }
    const persistenceRetryExhausted=()=>needsPersistence&&reminderWriteAttempt>DELIVERY_RETRY_MS.length;
    function dueAt(item) {
      if(item.resolvedAt||item.acknowledgedAt||item.suspended||item.sourceClosed)return 0;
      // A first alert deferred by mute/ownership/settings, and an explicit snooze,
      // are delivery deadlines even when automatic repeat reminders are disabled.
      const retryAt=Number(item.delivery?.retryAt||0);
      const reminderAt=item.reminders<state.settings.maxReminders ? Number(item.nextReminderAt||0) : 0;
      let due=!item.notifiedAt ? Number(item.firstSeenAt||item.lastSeenAt||state.updatedAt||1) : item.snoozedUntil>0 ? item.snoozedUntil :
        retryAt>0&&reminderAt>0 ? Math.min(retryAt,reminderAt) : retryAt||reminderAt;
      return due>0 ? Math.max(due,Number(item.snoozedUntil||0),Number(state.settings.muteUntil||0)) : 0;
    }
    async function schedule() {
      const cfg = state.settings;
      const due = state.incidents.map(dueAt).filter((x) => x > 0);
      if (!cfg.enabled || !owner.enabled || !channelsEnabled() || persistenceRetryExhausted() || !due.length) {
        if (scheduledAt !== 0) await io.clearAlarm?.(ALARM_NAME); scheduledAt=0;
      } else {
        const target=Math.min(...due),deadline=Math.max(now(),target,reminderWriteRetryAt);
        // Keep an already-due alarm in place. Frequent snapshots must not keep
        // pushing its wake time forward; future native snoozes stay exact too.
        if(scheduledAt>0&&scheduledAt<=deadline&&target<=scheduledAt)return;
        if (deadline!==scheduledAt) {await io.alarm?.(ALARM_NAME,deadline);scheduledAt=deadline;}
      }
    }
    function eligible(item) {
      return state.settings.enabled && owner.enabled && channelsEnabled() && now() >= state.settings.muteUntil && !item.acknowledgedAt &&
        !item.resolvedAt && !item.suspended && !item.sourceClosed && now() >= Number(item.snoozedUntil || 0);
    }
    async function clearToast(id) {
      try {await io.clearNotification?.(id);}
      catch(error){state.delivery.lastCleanupError=text(error?.message||error);}
    }
    async function deliver(item, reason = 'new', retryOnly = false, countReminder = false) {
      if (!eligible(item)) return { ok:false, skipped:true };
      const at = now();
      const beforeClaim={notifiedAt:item.notifiedAt,snoozedUntil:item.snoozedUntil,nextReminderAt:item.nextReminderAt,reminders:item.reminders,delivery:item.delivery};
      const previous=retryOnly ? item.delivery || {} : {};
      const attempt=retryOnly ? Number(previous.attempt||1)+1 : 1;
      const notify=state.settings.notificationsEnabled&&(!retryOnly||previous.notification==='failed');
      const sound=state.settings.audioEnabled&&state.settings.volume>0&&(!retryOnly||previous.audio==='failed');
      if(!retryOnly){
        if(countReminder)item.reminders+=1;
        item.notifiedAt = at;
        item.snoozedUntil = 0;
        item.nextReminderAt = state.settings.reminderMinutes > 0 ? at + state.settings.reminderMinutes * 60000 : 0;
      }
      item.delivery = { at, reason, attempt, retryAt:0, retryExhausted:false,
        notification:notify?'pending':retryOnly&&previous.notification==='accepted'?'accepted':'disabled',
        audio:sound?'pending':retryOnly&&['started','grouped-or-disabled','interrupted'].includes(previous.audio)?previous.audio:'grouped-or-disabled' };
      // Persist the episode before contacting the OS. Stable notification identifiers
      // let a retry replace the toast instead of multiplying it.
      try {await persist();}
      catch(error){
        // No channel has been contacted yet. A failed durable claim cannot
        // mark this untouched episode as announced and silence a later retry.
        Object.assign(item,beforeClaim);throw error;
      }
      let notification = { ok:true, skipped:true };
      let audio = retryOnly&&previous.audio==='interrupted'?{ok:false,error:previous.audioError}:{ ok:true, skipped:true };
      if (notify) {
        try { notification = await io.notify?.(copy(item)) || {ok:false,error:'Notifications are unavailable.'}; }
        catch (error) { notification = {ok:false,error:text(error?.message || error)}; }
        item.delivery.notification=notification.skipped?'disabled':notification.ok?'accepted':'failed';
      }
      if (sound) {
        const lastSound = Number(state.delivery.lastAudioAt || 0);
        const soundAt=now();
        if (soundAt - lastSound >= 1500 || lastSound === 0) {
          // Commit the sound claim before playback: worker restarts must not create
          // overlapping alarms for an already-announced episode.
          state.delivery.lastAudioAt = soundAt;
          item.delivery.audio='claimed';
          try {await persist();audio = await io.sound?.({kind:item.kind,severity:item.severity,volume:state.settings.volume}) || {ok:false,error:'Audio is unavailable.'}; }
          catch (error) { audio = {ok:false,error:text(error?.message || error)}; }
          if(audio.ok!==true&&!audio.interrupted)state.delivery.lastAudioAt=lastSound;
        } else audio = {ok:true,skipped:true,reason:'Grouped with another recent alert.'};
      }
      if(sound)item.delivery.audio=audio.interrupted?'interrupted':audio.skipped?'grouped-or-disabled':audio.ok?'started':'failed';
      item.delivery.notificationError=text(notification.error||'');
      item.delivery.audioError=text(audio.error||'');
      const failed=item.delivery.notification==='failed'||item.delivery.audio==='failed';
      const retryDelay=DELIVERY_RETRY_MS[attempt-1];
      item.delivery.retryAt=failed&&retryDelay ? now()+retryDelay : 0;
      item.delivery.retryExhausted=failed&&!retryDelay;
      state.delivery.lastResult = copy(item.delivery);
      state.delivery.lastError = [item.delivery.notificationError,item.delivery.audioError].filter(Boolean).join(' ');
      if(failed)state.delivery.lastError += item.delivery.retryExhausted ? ' Automatic delivery retries are exhausted. Check the alert channels and use Test alert.' : ` Retrying the failed alert channel in ${retryDelay/1000} seconds (${attempt}/${DELIVERY_RETRY_MS.length}).`;
      state.delivery.lastErrorAt = state.delivery.lastError ? at : 0;
      await persist({type:'delivery',incident:item});
      return {ok:notification.ok && audio.ok,notification,audio};
    }
    async function observe(input, expected = null) {
      return enqueue(async () => {
        await load();
        const row = observation(input, now());
        if (!row) return {ok:false,error:'A valid open HTTPS chat tab is required.'};
        const currentTab=state.sessions.filter((x)=>x.sourceId===row.sourceId&&x.tabId===row.tabId)
          .reduce((latest,item)=>!latest||item.observedAt>=latest.observedAt?item:latest,null);
        const ignore=async(reason)=>{if(needsPersistence)await persist();return {ok:true,ignored:reason};};
        if(!matchesSnapshot(currentTab,expected))return ignore('session-changed');
        if(row.status==='closed'&&currentTab&&(row.key!==currentTab.key||row.runId&&currentTab.runId&&row.runId!==currentTab.runId))return ignore('stale-close');
        if(currentTab&&row.observedAt<currentTab.observedAt)return ignore('out-of-order');
        const previous = state.sessions.find((x) => x.key === row.key);
        if(previous?.closedAt&&row.observedAt<=previous.closedAt)return ignore('closed-document');
        if (previous && row.observedAt < previous.observedAt) return ignore('out-of-order');
        if(row.status==='closed')row.closedAt=row.observedAt;
        // A tab's document may navigate. Old unresolved incidents retain evidence,
        // but cannot keep ringing or focus the newly opened conversation.
        for (const prior of state.sessions) {
          if (prior.sourceId === row.sourceId && prior.tabId === row.tabId && prior.key !== row.key) {
            prior.suspended = true; prior.status = 'closed';
            for (const item of state.incidents.filter((x) => x.sessionKey === prior.key && !x.resolvedAt)) {item.sourceClosed = true;await clearToast(item.id);}
          }
        }
        state.sessions = state.sessions.filter((x) => x.key !== row.key);
        state.sessions.push(row);
        const active = state.incidents.filter((x) => x.sessionKey === row.key && !x.resolvedAt);
        // A fallback/probe can describe what it saw, but cannot replace current
        // confirmed incident evidence or its owner suppression/run identity.
        // Missing authority on older journals is conservatively confirmed.
        if(!row.authoritative&&!row.suspended&&active.some(item=>item.authoritative!==false))row.suspended=true;
        let created = null;
        let unannounced = null;
        if (row.suspended) for (const item of active) {
          item.suspended = true;
          if(row.status==='closed'){item.sourceClosed=true;await clearToast(item.id);}
        }
        else if (row.incident) {
          const recordedRun=active.find((item)=>item.authoritative!==false&&item.runId)?.runId||
            (previous?.authoritative!==false?previous?.runId:'')||'';
          const newRun=Boolean(row.authoritative&&row.runId&&recordedRun&&row.runId!==recordedRun);
          const same = !newRun && active.find((x) => x.kind === row.kind && x.status === row.status);
          for (const item of active) {
            item.suspended = false;
            if (item !== same) { item.resolvedAt=now(); item.resolution=newRun?'superseded-by-new-run':'state-changed'; await clearToast(item.id); }
          }
          if (same) { same.lastSeenAt=row.observedAt; same.title=row.title; same.reason=row.reason; same.runId=row.runId||same.runId||''; same.sourceClosed=false; if(row.authoritative)same.authoritative=true; if(!same.notifiedAt)unannounced=same; }
          else {
            state.sequence += 1;
            created = {id:`pc-attention:${hash(row.key)}:${state.sequence}`,sessionKey:row.key,
              sourceId:row.sourceId,tabId:row.tabId,documentId:row.documentId,runId:row.runId,url:row.url,title:row.title,
              browser:row.browser,kind:row.kind,status:row.status,label:row.label,severity:row.severity,reason:row.reason,authoritative:row.authoritative,
              firstSeenAt:now(),lastSeenAt:row.observedAt,resolvedAt:0,acknowledgedAt:0,snoozedUntil:0,
              notifiedAt:0,nextReminderAt:state.settings.reminderMinutes > 0 ? now()+state.settings.reminderMinutes*60000 : 0,reminders:0,suspended:false,sourceClosed:false};
            state.incidents.push(created);
          }
        } else if (row.authoritative && (SETTLED_STATES.has(row.status) || QUIET_STATES.has(row.status))) {
          for (const item of active) { item.resolvedAt=now(); item.resolution='provider-state-cleared'; await clearToast(item.id); }
        }
        // Authority and availability are part of evidence too. Two messages may
        // share a timestamp while only the later one can resolve an incident.
        const changed = !previous || Object.entries(row).some(([field,value])=>field!=='observedAt'&&previous[field]!==value);
        if (!created && state.settings.completionEnabled && previous && /^(running|working|tool-running|quiet-working|tool-quiet|uncertain-working)$/.test(previous.status) && /^(idle|healthy|completed)$/.test(row.status) && row.authoritative) {
          state.sequence+=1;created={id:`pc-attention:${hash(row.key)}:${state.sequence}`,sessionKey:row.key,sourceId:row.sourceId,tabId:row.tabId,documentId:row.documentId,url:row.url,title:row.title,browser:row.browser,kind:'completed',status:'completed',label:'Chat completed',severity:'info',reason:'The response is ready to review.',firstSeenAt:now(),lastSeenAt:now(),resolvedAt:0,acknowledgedAt:0,snoozedUntil:0,nextReminderAt:0,reminders:0};state.incidents.push(created);
        }
        const event={type:created ? 'incident' : 'observation',session:row,incident:created};
        // A duplicate issue can carry newer ordering evidence without opening a
        // new episode. Persist that watermark before acknowledging it, so a
        // restarted worker cannot accept an older delayed clearance.
        const orderingAdvanced=previous&&row.observedAt>previous.observedAt;
        if (needsPersistence || changed || created || orderingAdvanced || now()-Number(state.updatedAt || 0)>30000) await persist(event);
        else for (const listener of listeners) {try {listener(copy(event));} catch (_) {}}
        if (unannounced) await deliver(unannounced);
        if (created) {await deliver(created);if (created.kind==='completed') {created.resolvedAt=now();created.resolution='completion-notice';created.nextReminderAt=0;await persist({type:'completed',incident:created});}}
        await schedule();
        return {ok:true,session:copy(row),incident:created ? copy(created) : null};
      });
    }
    async function changeIncident(id, action, minutes=10) {
      return enqueue(async () => {
        await load();
        const item = state.incidents.find((x) => x.id === id);
        if (!item) return {ok:false,error:'This incident is no longer available.'};
        if (action === 'acknowledge') { item.acknowledgedAt=now(); item.snoozedUntil=0; }
        if (action === 'snooze') { item.acknowledgedAt=0; item.snoozedUntil=now()+clamp(minutes,1,1440,10)*60000; item.nextReminderAt=item.snoozedUntil; item.reminders=0; }
        await clearToast(item.id);
        await persist({type:action,incident:item});
        await schedule();
        return {ok:true,incident:copy(item)};
      });
    }
    async function deliverDue(reasonOverride='') {
      if(persistenceRetryExhausted())return;
      for(const item of state.incidents) {
        const due=dueAt(item);
        if(due>0&&eligible(item)&&now()>=due) {
          const retry=Boolean(item.notifiedAt&&!item.snoozedUntil&&item.delivery?.retryAt&&now()>=item.delivery.retryAt&&
            (!item.nextReminderAt||item.reminders>=state.settings.maxReminders||item.delivery.retryAt<=item.nextReminderAt));
          const reason=!item.notifiedAt?'deferred-first-alert':item.snoozedUntil?'snooze-ended':retry?'delivery-retry':'reminder';
          await deliver(item,reasonOverride||reason,retry,reason==='reminder');
        }
      }
    }
    function applyIncidentState(id, patch) {
      return enqueue(async()=>{
        await load();
        // Only the trusted native bridge calls this internal API after matching
        // incident/document/run identity. It has no provider or UI message route.
        const fields=['acknowledgedAt','snoozedUntil'];
        if(typeof id!=='string'||!id||!patch||typeof patch!=='object'||Array.isArray(patch)||
          !fields.some((field)=>Object.hasOwn(patch,field))||Object.keys(patch).some((field)=>!fields.includes(field)))return {ok:false,error:'Absolute incident state is required.'};
        const at=now();
        for(const field of fields)if(Object.hasOwn(patch,field)) {
          const value=patch[field],limit=at+(field==='snoozedUntil'?7*86400000:5*60000);
          if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>limit)return {ok:false,error:'Incident timestamps must be bounded nonnegative safe integers.'};
        }
        if(patch.acknowledgedAt>0&&patch.snoozedUntil>0)return {ok:false,error:'An incident cannot be acknowledged and snoozed simultaneously.'};
        const item=state.incidents.find((entry)=>entry.id===id);
        if(!item)return {ok:false,error:'This incident is no longer available.'};
        let acknowledgedAt=Object.hasOwn(patch,'acknowledgedAt')?patch.acknowledgedAt:Number(item.acknowledgedAt||0);
        let snoozedUntil=Object.hasOwn(patch,'snoozedUntil')?patch.snoozedUntil:Number(item.snoozedUntil||0);
        if(patch.acknowledgedAt>0)snoozedUntil=0;
        if(patch.snoozedUntil>0)acknowledgedAt=0;
        const mirrored={acknowledgedAt,snoozedUntil};
        // Preserve the source token even after local snooze delivery clears its
        // active deadline. Reconnecting to the same expired native snooze cannot
        // replay it after worker/browser restarts.
        if(item.mirroredState?.acknowledgedAt===acknowledgedAt&&item.mirroredState?.snoozedUntil===snoozedUntil){
          if(needsPersistence){
            await persist({type:'incident-state-mirrored',incident:item});
            await deliverDue();await schedule();
          }
          return {ok:true,unchanged:true,incident:copy(item)};
        }
        const wasSnoozed=Number(item.snoozedUntil||0)>0;
        item.acknowledgedAt=acknowledgedAt;item.snoozedUntil=snoozedUntil;item.mirroredState=mirrored;
        if(acknowledgedAt)item.nextReminderAt=0;
        else if(snoozedUntil){item.nextReminderAt=snoozedUntil;item.reminders=0;}
        else if(wasSnoozed)item.nextReminderAt=state.settings.reminderMinutes>0?at+state.settings.reminderMinutes*60000:0;
        if(acknowledgedAt||snoozedUntil)await clearToast(item.id);
        await persist({type:'incident-state-mirrored',incident:item});
        await deliverDue();
        await schedule();
        return {ok:true,incident:copy(item)};
      });
    }
    async function reminders() {
      return enqueue(async () => {
        await load();
        scheduledAt=undefined;
        try {
          if(needsPersistence)await persist();
          await deliverDue();
          reminderWriteAttempt=0;reminderWriteRetryAt=0;
          await schedule();
          return {ok:true};
        } catch(error) {
          // An alarm is one-shot. A rejected durable claim must retain the
          // reminder budget and get a finite recovery deadline of its own.
          if(needsPersistence){
            const delay=DELIVERY_RETRY_MS[reminderWriteAttempt++];
            reminderWriteRetryAt=delay?now()+delay:0;
            state.delivery.lastError='The pending alert could not be saved. '+text(error?.message||error)+
              (delay?` Retrying persistence in ${delay/1000} seconds.`:' Automatic persistence retries are exhausted. Check storage and use Test alert.');
            state.delivery.lastErrorAt=now();
            try{
              if(delay){await io.alarm?.(ALARM_NAME,reminderWriteRetryAt);scheduledAt=reminderWriteRetryAt;}
              else{await io.clearAlarm?.(ALARM_NAME);scheduledAt=0;}
            }catch(_){}
          }
          throw error;
        }
      });
    }
    async function focus(id) {
      await load();
      const item=state.incidents.find((x)=>x.id===id) || state.sessions.find((x)=>x.key===id);
      if (!item || item.sourceClosed || item.status==='closed') return {ok:false,error:'This chat is no longer open.'};
      return io.focus?.(copy(item)) || {ok:false,error:'Tab focus is unavailable.'};
    }
    return Object.freeze({
      observe,
      get:async()=>{await queue;await load();return snapshot();},
      start:()=>enqueue(async()=>{
        await load();
        if(!started){
          started=true;
          // Storage is history, not proof that a browser tab is still alive. Fresh
          // provider observations or the one-shot startup reconcile restore coverage.
          for(const row of state.sessions){if(row.status==='closed')continue;row.lastKnownStatus=row.status;row.status='sensor-offline';row.kind='suspended';row.suspended=true;row.authoritative=false;for(const item of state.incidents.filter((x)=>x.sessionKey===row.key&&!x.resolvedAt))item.suspended=true;}
          if(state.sessions.length)needsPersistence=true;
        }
        if(needsPersistence)await persist({type:'reconnecting'});
        await schedule();return snapshot();
      }),
      acknowledge:(id)=>changeIncident(id,'acknowledge'),snooze:(id,minutes)=>changeIncident(id,'snooze',minutes),
      focus,reminders,applyIncidentState,
      subscribe:(fn)=>{listeners.add(fn);return ()=>listeners.delete(fn);},
      settings:(patch)=>enqueue(async()=>{
        await load();const previous=state.settings;state.settings=normalizeSettings({...previous,...patch});
        if(previous.reminderMinutes!==state.settings.reminderMinutes)for(const item of state.incidents){
          if(item.resolvedAt||item.acknowledgedAt||item.snoozedUntil>now())continue;
          item.nextReminderAt=state.settings.reminderMinutes>0?now()+state.settings.reminderMinutes*60000:0;
        }
        await persist({type:'settings'});
        for(const item of state.incidents)if(!item.notifiedAt&&eligible(item))await deliver(item,'settings-enabled');
        await schedule();return snapshot();
      }),
      setAudioOwner:(value)=>enqueue(async()=>{
        await load();const wasEnabled=owner.enabled;owner={enabled:value?.enabled!==false,reason:text(value?.reason||'standalone')};
        if(!wasEnabled&&owner.enabled)await deliverDue('ownership-transfer');
        await schedule();return copy(owner);
      }),
      closeTab:(tabId,sourceId='local',expected=null)=>enqueue(async()=>{
        await load();
        const rows=state.sessions.filter((row)=>row.tabId===Number(tabId)&&row.sourceId===sourceId&&matchesSnapshot(row,expected));
        if(expected&&!rows.length){if(needsPersistence){await persist();await schedule();}return {ok:true,ignored:'session-changed'};}
        for(const row of rows){
          row.observedAt=Math.max(now(),Number(row.observedAt||0));row.closedAt=row.observedAt;row.suspended=true;row.status='closed';
          for(const item of state.incidents.filter((x)=>x.sessionKey===row.key&&!x.resolvedAt)){item.sourceClosed=true;await clearToast(item.id);}
        }
        await persist({type:'closed'});await schedule();return {ok:true};
      }),
      test:()=>enqueue(async()=>{
        await load();let sound,notification;
        try{sound=await io.sound?.({kind:'test',severity:'warning',volume:state.settings.volume})||{ok:false,error:'Audio is unavailable.'};}catch(error){sound={ok:false,error:text(error?.message||error)};}
        try{notification=await io.notify?.({id:'pc-attention:test',kind:'test',label:'Constellation test alert',title:'Agent Monitor',reason:'Notification delivery was accepted. Confirm that you hear the sound and see this notification.',severity:'info',browser:'This browser'})||{ok:false,error:'Notifications are unavailable.'};}catch(error){notification={ok:false,error:text(error?.message||error)};}
        const limitations=[];
        if(!state.settings.enabled)limitations.push('automatic alerts are disabled');
        if(state.settings.muteUntil>now())limitations.push('automatic alerts are muted');
        if(!state.settings.audioEnabled)limitations.push('automatic sound is off');
        if(state.settings.volume===0)limitations.push('sound volume is zero');
        if(!state.settings.notificationsEnabled)limitations.push('automatic notifications are off');
        if(!owner.enabled)limitations.push('another browser owns shared alerts');
        const settingsNotice='This explicit diagnostic tests both channels independently of automatic-alert switches and mute.'+(limitations.length?' Current settings: '+limitations.join('; ')+'.':'');
        const result={ok:Boolean(sound.ok&&notification.ok),mode:'explicit-diagnostic',settingsNotice,audio:sound,notification,error:[sound.error,notification.error].filter(Boolean).join(' ')};
        state.delivery.lastTest={...result,at:now()};await persist({type:'test'});return result;
      })
    });
  }
  globalThis.ProjectConstellationAttentionService=Object.freeze({STORAGE_KEY,ALARM_NAME,DEFAULTS,normalizeSettings,observation,canonicalUrl,createService});
})();
