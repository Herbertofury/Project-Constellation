(() => {
  'use strict';
  const SOURCE = 'project-constellation-route-observer';
  let last = location.href;

  function emit(reason = 'navigation') {
    const url = location.href;
    if (url === last && reason !== 'initial') return;
    last = url;
    window.postMessage({ source: SOURCE, type: 'PC_ROUTE_CHANGED', url, reason, at: Date.now() }, location.origin);
  }

  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    if (typeof original !== 'function' || original.__pcRouteWrapped) continue;
    const wrapped = function (...args) {
      const result = original.apply(this, args);
      queueMicrotask(() => emit(method));
      return result;
    };
    Object.defineProperty(wrapped, '__pcRouteWrapped', { value: true });
    history[method] = wrapped;
  }

  addEventListener('popstate', () => emit('popstate'), true);
  addEventListener('hashchange', () => emit('hashchange'), true);
  if (globalThis.navigation?.addEventListener) globalThis.navigation.addEventListener('navigate', () => queueMicrotask(() => emit('navigation-api')));
  queueMicrotask(() => emit('initial'));
})();
