from playwright.sync_api import sync_playwright
import pathlib, os, tempfile, time, json

root = pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_BUILD', '/mnt/data/project-constellation/build/unpacked')).resolve()
extension_id = 'geljambmkfjkhodgkpjhnmfojkpcamig'
urls = ['https://chatgpt.com/c/pc-smoke-a', 'https://chatgpt.com/c/pc-smoke-b']
requests = {url: 0 for url in urls}

html = '''<!doctype html><html><head><title>Reliability smoke</title></head><body>
<main>
  <div data-testid="conversation-turn-0" data-message-author-role="user" data-message-id="user-1">Continue the unfinished reliability smoke task.</div>
  <div id="prompt-textarea" contenteditable="true" role="textbox" data-lexical-editor="true"></div>
  <div id="send-slot"></div>
</main>
<script>
  setTimeout(() => {
    const button = document.createElement('button');
    button.dataset.testid = 'send-button';
    button.setAttribute('aria-label', 'Send');
    button.textContent = 'Send';
    button.addEventListener('click', () => {
      const composer = document.querySelector('#prompt-textarea');
      const text = (composer.innerText || composer.textContent || '').trim();
      if (text) {
        localStorage.setItem('pc-reliability-sent', text);
        localStorage.setItem('pc-reliability-sent-at', String(Date.now()));
        document.body.dataset.sent = '1';
      }
    });
    document.querySelector('#send-slot').appendChild(button);
  }, 1200);
</script>
</body></html>'''

with sync_playwright() as p:
    context = p.chromium.launch_persistent_context(
        tempfile.mkdtemp(prefix='project-constellation-multitab-'),
        channel='chromium',
        headless=True,
        args=[f'--disable-extensions-except={root}', f'--load-extension={root}', '--no-sandbox'],
        executable_path=(os.environ.get('PROJECT_CONSTELLATION_CHROMIUM') or None),
    )

    admin = context.new_page()
    admin.goto(f'chrome-extension://{extension_id}/popup.html', wait_until='domcontentloaded')
    runtime_proof = admin.evaluate('''async () => {
      const response = await chrome.runtime.sendMessage({ type:'PC_BRAIN_SETTINGS_GET' });
      return { id:chrome.runtime.id, version:chrome.runtime.getManifest().version, ok:Boolean(response?.ok) };
    }''')
    assert runtime_proof == {'id': extension_id, 'version': '0.16.0', 'ok': True}, runtime_proof

    def route_chat(route):
        url = route.request.url.split('?', 1)[0].rstrip('/')
        if url in requests:
            requests[url] += 1
        route.fulfill(status=200, content_type='text/html', body=html)

    context.route('https://chatgpt.com/**', route_chat)
    pages = [context.new_page() for _ in urls]
    for page, url in zip(pages, urls):
        page.goto(url, wait_until='domcontentloaded')
    pages[0].bring_to_front()
    pages[1].bring_to_front()
    pages[0].bring_to_front()  # page B is now a real background tab.

    time.sleep(2.0)  # allow declarative content scripts to establish initial signatures
    prep = admin.evaluate('''async () => {
      await chrome.storage.local.set({
        projectConstellationBrainSettings: {
          refreshRecovery: { enabled:true, cooldownMs:60000, maxRefreshesPerChat:2 },
          approvalAutopilot: { enabled:false, acknowledged:false },
          liveHealth: { capacityWarningTurns:120, capacityHandoffTurns:180, capacityWarningChars:160000, capacityHandoffChars:280000 }
        }
      });
      await new Promise(r => setTimeout(r, 80));
      const key = 'projectConstellationReliabilitySupervisorState';
      const state = (await chrome.storage.local.get(key))[key] || { version:1, chats:{} };
      const now = Date.now();
      for (const id of ['chatgpt:pc-smoke-a','chatgpt:pc-smoke-b']) {
        const row = state.chats[id] || { chatId:id };
        state.chats[id] = {
          ...row,
          chatId:id,
          lastProgressAt:now - (2 * 60 * 60 * 1000 + 5000),
          lastObservedAt:now,
          wasRunning:true,
          unresolvedUser:true,
          status:'running',
          failureKind:'',
          recoveryCount:0,
          lastRecoveryAt:0,
          pending:null,
          updatedAt:now
        };
      }
      await chrome.storage.local.set({ [key]:state });
      const tabs = (await chrome.tabs.query({})).filter(t => String(t.url || '').startsWith('https://chatgpt.com/c/pc-smoke-'));
      const wakes = await Promise.allSettled(tabs.map(t => chrome.tabs.sendMessage(t.id, { type:'PC_TAB_SUPERVISOR_TICK', at:Date.now() })));
      return { tabs:tabs.map(t => ({id:t.id,url:t.url,active:t.active})), wakes:wakes.map(x => x.status) };
    }''')
    assert len(prep['tabs']) == 2, prep
    assert any(not tab['active'] for tab in prep['tabs']), prep
    assert all(status == 'fulfilled' for status in prep['wakes']), prep

    deadline = time.time() + 15
    sent = ['', '']
    while time.time() < deadline:
        sent = [page.evaluate("localStorage.getItem('pc-reliability-sent') || ''") for page in pages]
        if all(sent):
            break
        time.sleep(0.25)

    state = admin.evaluate('''async () => (await chrome.storage.local.get('projectConstellationReliabilitySupervisorState')).projectConstellationReliabilitySupervisorState''')
    print(json.dumps({'runtime': runtime_proof, 'prep': prep, 'requests': requests, 'sent': sent, 'state': state}, sort_keys=True))

    assert all(sent), f'both open chats must auto-continue after rescue even when Send hydrates late: {sent}'
    assert all('Resume from that exact next action immediately' in value for value in sent), sent
    assert all(requests[url] >= 2 for url in urls), f'both tabs must have been reloaded: {requests}'
    for chat_id in ['chatgpt:pc-smoke-a','chatgpt:pc-smoke-b']:
        row = state['chats'][chat_id]
        assert row.get('lastResumeStatus') == 'sent', row
        assert row.get('pending') is None, row
        assert int(row.get('recoveryCount') or 0) == 1, row

    context.close()
