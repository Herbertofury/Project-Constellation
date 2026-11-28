(() => {
  'use strict';

  const VERSION = 1;

  function createRouter() {
    const handlers = new Map();

    function register(type, handler) {
      const key = String(type || '').trim();
      if (!key) throw new Error('Message type is required.');
      if (typeof handler !== 'function') throw new Error(`Handler for ${key} must be a function.`);
      if (handlers.has(key)) throw new Error(`Handler already registered for ${key}.`);
      handlers.set(key, handler);
      return api;
    }

    function has(type) {
      return handlers.has(String(type || ''));
    }

    async function dispatch(type, context = {}) {
      const key = String(type || '');
      const handler = handlers.get(key);
      if (!handler) return { matched: false, value: undefined };
      return { matched: true, value: await handler(context) };
    }

    function list() {
      return [...handlers.keys()].sort();
    }

    const api = Object.freeze({ VERSION, register, has, dispatch, list });
    return api;
  }

  globalThis.ProjectConstellationBackgroundMessageRouterCore = Object.freeze({ VERSION, createRouter });
})();
