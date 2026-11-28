(() => {
  'use strict';

  const SCHEMA = 'pc-state-event-v1';
  const pending = new Map();
  let sequence = 0;

  function cleanTopic(value) {
    return String(value || '').trim().replace(/[^a-z0-9._:-]+/gi, '-').slice(0, 120);
  }

  function cleanSource(value) {
    return String(value || 'background').trim().replace(/[^a-z0-9._:-]+/gi, '-').slice(0, 80) || 'background';
  }

  function envelope(topic, detail = {}, options = {}) {
    const at = Date.now();
    const normalizedTopic = cleanTopic(topic);
    sequence = (sequence + 1) % Number.MAX_SAFE_INTEGER;
    return {
      schema: SCHEMA,
      id: `${at.toString(36)}-${sequence.toString(36)}`,
      seq: sequence,
      topic: normalizedTopic,
      source: cleanSource(options.source),
      at,
      detail: detail && typeof detail === 'object' ? detail : { value: detail }
    };
  }

  function send(event) {
    if (!event?.topic || !globalThis.chrome?.runtime?.sendMessage) return Promise.resolve({ ok: false, skipped: true });
    try {
      return Promise.resolve(chrome.runtime.sendMessage({ type: 'PC_STATE_EVENT', event })).catch(() => ({ ok: false }));
    } catch (_) {
      return Promise.resolve({ ok: false });
    }
  }

  function publish(topic, detail = {}, options = {}) {
    const event = envelope(topic, detail, options);
    void send(event);
    return event;
  }

  function publishCoalesced(topic, detail = {}, options = {}) {
    const normalizedTopic = cleanTopic(topic);
    const key = `${cleanSource(options.source)}:${normalizedTopic}:${String(options.key || '')}`;
    const prior = pending.get(key);
    if (prior?.timer) clearTimeout(prior.timer);
    const delayMs = Math.max(0, Math.min(5000, Number(options.delayMs ?? 80) || 0));
    const slot = { topic: normalizedTopic, detail, options: { ...options } };
    slot.timer = setTimeout(() => {
      pending.delete(key);
      publish(slot.topic, slot.detail, slot.options);
    }, delayMs);
    pending.set(key, slot);
    return key;
  }

  function isStateEvent(value) {
    return Boolean(value && value.schema === SCHEMA && cleanTopic(value.topic) === value.topic && Number.isFinite(Number(value.at)));
  }

  globalThis.ProjectConstellationStateEventBusCore = Object.freeze({ SCHEMA, envelope, publish, publishCoalesced, isStateEvent });
})();
