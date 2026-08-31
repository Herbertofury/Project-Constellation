const PCX_LOCAL_BASE = 'http://127.0.0.1:17342';
const PCX_LOCAL_PREFIX = 'projectConstellationLocalSession:';

async function pcxLocalFetch(path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('X-Project-Constellation-Client', chrome.runtime.id);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${PCX_LOCAL_BASE}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
    credentials: 'omit'
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : {}; } catch (_) { payload = { ok:false, error:'invalid local companion response' }; }
  if (!response.ok) {
    return { ok:false, status:response.status, error:payload?.error || `Project Constellation local companion returned ${response.status}` };
  }
  return payload || { ok:true };
}

function sessionStorageKey(sessionKey) {
  return `${PCX_LOCAL_PREFIX}${sessionKey}`;
}

async function saveSession(sessionKey, value) {
  await chrome.storage.session.set({ [sessionStorageKey(sessionKey)]: value });
}

async function loadSession(sessionKey) {
  if (!sessionKey) return null;
  const key = sessionStorageKey(sessionKey);
  const stored = await chrome.storage.session.get(key);
  return stored?.[key] || null;
}

async function deleteSession(sessionKey) {
  if (!sessionKey) return;
  await chrome.storage.session.remove(sessionStorageKey(sessionKey));
}

async function handleLocalCompanionMessage(message, sender) {
  const type = String(message?.type || '');
  if (!type.startsWith('pcx-local-')) return undefined;

  if (type === 'pcx-local-health') {
    try { return await pcxLocalFetch('/v1/health'); }
    catch (error) { return { ok:false, status:0, error:String(error?.message || error) }; }
  }

  if (type === 'pcx-local-handshake') {
    try {
      const payload = await pcxLocalFetch('/v1/session', {
        method:'POST',
        body:JSON.stringify({
          conversationKey:String(message?.conversationKey || ''),
          tabKey:String(sender?.tab?.id ?? message?.tabKey ?? '')
        })
      });
      if (!payload?.ok || !payload.sessionToken) return payload;
      const sessionKey = crypto.randomUUID();
      await saveSession(sessionKey, {
        token:payload.sessionToken,
        nonce:payload.nonce || '',
        conversationKey:String(message?.conversationKey || ''),
        expiresAtUtc:payload.expiresAtUtc || ''
      });
      return {
        ok:true,
        sessionKey,
        nonce:payload.nonce || '',
        context:payload.context || '',
        expiresAtUtc:payload.expiresAtUtc || '',
        tools:payload.tools || []
      };
    } catch (error) {
      return { ok:false, status:0, error:String(error?.message || error) };
    }
  }

  if (type === 'pcx-local-tool') {
    const sessionKey = String(message?.sessionKey || '');
    const session = await loadSession(sessionKey);
    if (!session?.token) return { ok:false, status:401, error:'Project Constellation browser session is not available' };
    try {
      const payload = await pcxLocalFetch('/v1/tool', {
        method:'POST',
        headers:{ Authorization:`Bearer ${session.token}` },
        body:JSON.stringify({ call:message?.call || {} })
      });
      if (!payload?.ok && payload?.status === 401) await deleteSession(sessionKey);
      return payload;
    } catch (error) {
      return { ok:false, status:0, error:String(error?.message || error) };
    }
  }

  if (type === 'pcx-local-forget') {
    await deleteSession(String(message?.sessionKey || ''));
    return { ok:true };
  }

  return { ok:false, status:400, error:`Unknown Project Constellation local message: ${type}` };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!String(message?.type || '').startsWith('pcx-local-')) return false;
  handleLocalCompanionMessage(message, sender)
    .then((result) => sendResponse(result ?? { ok:false, error:'No local companion response' }))
    .catch((error) => sendResponse({ ok:false, status:0, error:String(error?.message || error) }));
  return true;
});

globalThis.ProjectConstellationLocalCompanionBackground = Object.freeze({
  version:'0.4.0',
  base:PCX_LOCAL_BASE
});
