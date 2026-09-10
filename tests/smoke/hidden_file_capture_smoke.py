from playwright.sync_api import sync_playwright
import pathlib, os, tempfile, time, json

root = pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_BUILD', '/mnt/data/project-constellation/build/unpacked')).resolve()
extension_id = 'geljambmkfjkhodgkpjhnmfojkpcamig'
hidden_url = 'https://chatgpt.com/c/hidden-file-smoke'
inactive_tab_url = 'https://chatgpt.com/c/inactive-supervisor-smoke'
foreground_url = 'https://chatgpt.com/c/foreground-file-smoke'

html = '''<!doctype html><html><head><title>Hidden file capture smoke</title></head><body>
<main>
  <div data-testid="conversation-turn-0" data-message-author-role="user" data-message-id="user-1">Keep this project state safe.</div>
  <div id="fixture"></div>
  <div id="prompt-textarea" contenteditable="true" role="textbox" data-lexical-editor="true"></div>
</main>
</body></html>'''

headless = os.environ.get('PROJECT_CONSTELLATION_HEADFUL') != '1'

with sync_playwright() as p:
    context = p.chromium.launch_persistent_context(
        tempfile.mkdtemp(prefix='project-constellation-hidden-file-'),
        channel='chromium',
        headless=headless,
        ignore_default_args=[
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
        ],
        args=[f'--disable-extensions-except={root}', f'--load-extension={root}', '--no-sandbox'],
        executable_path=(os.environ.get('PROJECT_CONSTELLATION_CHROMIUM') or None),
    )
    context.route('https://chatgpt.com/**', lambda route: route.fulfill(status=200, content_type='text/html', body=html))

    admin = context.new_page()
    admin.goto(f'chrome-extension://{extension_id}/popup.html', wait_until='domcontentloaded')
    runtime = admin.evaluate('''async () => {
      const response = await Promise.race([
        chrome.runtime.sendMessage({ type:'PC_PROVIDER_LIST' }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('runtime probe timeout')), 5000))
      ]);
      return { ok:Boolean(response?.ok), version:chrome.runtime.getManifest().version };
    }''')
    assert runtime == {'ok': True, 'version': '0.16.2'}, runtime

    foreground = context.new_page()
    foreground.goto(foreground_url, wait_until='domcontentloaded')
    foreground.bring_to_front()

    browser = context.browser
    assert browser is not None, 'persistent Chromium context did not expose its browser handle'
    browser_cdp = browser.new_browser_cdp_session()

    # Proof A: a real UI-strip Chrome tab is created in the background and must remain inactive.
    with context.expect_page(timeout=10000) as inactive_page_info:
        inactive_created = browser_cdp.send('Target.createTarget', {
            'url': inactive_tab_url,
            'background': True,
            'forTab': True,
        })
    inactive = inactive_page_info.value
    inactive.wait_for_load_state('domcontentloaded')
    inactive_target_id = inactive_created.get('targetId')
    assert inactive_target_id, inactive_created
    inactive_target_info = browser_cdp.send('Target.getTargetInfo', {'targetId': inactive_target_id}).get('targetInfo', {})
    inactive_tab_state = admin.evaluate('''async (url) => {
      const tab = (await chrome.tabs.query({})).find((row) => row.url === url);
      return tab ? { found:true, active:Boolean(tab.active), highlighted:Boolean(tab.highlighted), id:tab.id } : { found:false };
    }''', inactive_tab_url)
    assert inactive_target_info.get('type') == 'tab', inactive_target_info
    assert inactive_tab_state.get('found') is True and inactive_tab_state.get('active') is False, inactive_tab_state

    # Proof B: Chrome's protocol-native hidden target is guaranteed renderer-hidden but is not
    # adopted as a Playwright Page. Attach directly through the Target domain and use the legacy
    # non-flat session transport so every command/event remains scoped to that hidden renderer.
    hidden_messages = {}
    hidden_events = []
    hidden_session_id = None
    hidden_command_state = {'next': 0}

    def on_target_message(event):
        if hidden_session_id is None or event.get('sessionId') != hidden_session_id:
            return
        try:
            payload = json.loads(event.get('message') or '{}')
        except json.JSONDecodeError:
            return
        if isinstance(payload, dict) and 'id' in payload:
            hidden_messages[payload['id']] = payload
        elif isinstance(payload, dict):
            hidden_events.append(payload)

    browser_cdp.on('Target.receivedMessageFromTarget', on_target_message)

    hidden_created = browser_cdp.send('Target.createTarget', {
        'url': hidden_url,
        'background': True,
        'hidden': True,
    })
    hidden_target_id = hidden_created.get('targetId')
    assert hidden_target_id, hidden_created

    attached = browser_cdp.send('Target.attachToTarget', {
        'targetId': hidden_target_id,
        'flatten': False,
    })
    hidden_session_id = attached.get('sessionId')
    assert hidden_session_id, attached

    def hidden_send(method, params=None, timeout=5.0):
        hidden_command_state['next'] += 1
        current = hidden_command_state['next']
        packet = {'id': current, 'method': method}
        if params:
            packet['params'] = params
        browser_cdp.send('Target.sendMessageToTarget', {
            'sessionId': hidden_session_id,
            'message': json.dumps(packet, separators=(',', ':')),
        })
        deadline = time.time() + timeout
        while current not in hidden_messages and time.time() < deadline:
            admin.wait_for_timeout(20)
        response = hidden_messages.pop(current, None)
        if response is None:
            raise AssertionError(f'raw hidden CDP command timed out: {method}')
        if response.get('error'):
            raise AssertionError(f'raw hidden CDP command failed: {method}: {response["error"]}')
        return response.get('result', {})

    def hidden_eval(expression, timeout=5.0):
        result = hidden_send('Runtime.evaluate', {
            'expression': expression,
            'returnByValue': True,
            'awaitPromise': True,
        }, timeout=timeout)
        if result.get('exceptionDetails'):
            raise AssertionError(f'raw hidden Runtime.evaluate failed: {result["exceptionDetails"]}')
        return result.get('result', {}).get('value')

    hidden_send('Runtime.enable')
    hidden_send('Page.enable')

    hidden_target_info = browser_cdp.send('Target.getTargetInfo', {'targetId': hidden_target_id}).get('targetInfo', {})
    hidden_tab_state = admin.evaluate('''async (url) => {
      const tab = (await chrome.tabs.query({})).find((row) => row.url === url);
      return tab ? { found:true, active:Boolean(tab.active), highlighted:Boolean(tab.highlighted), id:tab.id } : { found:false };
    }''', hidden_url)
    assert hidden_tab_state.get('found') is False, hidden_tab_state

    ready = None
    deadline = time.time() + 8
    while time.time() < deadline:
        try:
            ready = hidden_eval("({ready:document.readyState, href:location.href, fixture:Boolean(document.querySelector('#fixture'))})")
            if ready and ready.get('ready') in ('interactive', 'complete'):
                break
        except AssertionError:
            pass
        admin.wait_for_timeout(50)
    assert ready and ready.get('ready') in ('interactive', 'complete'), ready

    # BrowserContext routing normally supplies the deterministic fixture even for this hidden
    # target. If Playwright's route ownership excludes non-adopted targets, keep the URL/origin and
    # replace only the document body through CDP; manifest content scripts still match chatgpt.com.
    if not ready.get('fixture'):
        frame_tree = hidden_send('Page.getFrameTree')
        frame_id = frame_tree.get('frameTree', {}).get('frame', {}).get('id')
        assert frame_id, frame_tree
        hidden_send('Page.setDocumentContent', {'frameId': frame_id, 'html': html})
        deadline = time.time() + 5
        while time.time() < deadline:
            ready = hidden_eval("({ready:document.readyState, href:location.href, fixture:Boolean(document.querySelector('#fixture'))})")
            if ready and ready.get('fixture'):
                break
            admin.wait_for_timeout(50)
    assert ready and ready.get('fixture') is True, ready
    hidden_href = hidden_eval("history.replaceState({}, '', '/c/hidden-file-smoke'); location.href")
    assert hidden_href == hidden_url, hidden_href

    hidden_send('Emulation.setFocusEmulationEnabled', {'enabled': False})
    hidden_visibility = hidden_eval("({hidden:document.hidden,state:document.visibilityState,focused:document.hasFocus(),href:location.href})")
    assert hidden_visibility.get('hidden') is True and hidden_visibility.get('state') == 'hidden', {
        'visibility': hidden_visibility,
        'target': hidden_target_info,
        'chromeTabs': hidden_tab_state,
        'ready': ready,
    }

    hidden_eval("""(() => {
      const host = document.querySelector('#fixture');
      const attachment = document.createElement('a');
      attachment.href = 'sandbox:/mnt/data/hidden-mutation-report.pdf';
      attachment.download = 'hidden-mutation-report.pdf';
      attachment.dataset.testid = 'file-attachment';
      attachment.setAttribute('aria-label', 'Download hidden-mutation-report.pdf');
      attachment.textContent = 'hidden-mutation-report.pdf';
      host.appendChild(attachment);
      return true;
    })()""")

    def files_for_hidden_chat():
        return admin.evaluate('''async () => {
          const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('project-constellation-brain');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          try {
            if (!db.objectStoreNames.contains('files')) return [];
            const all = await new Promise((resolve, reject) => {
              const request = db.transaction('files', 'readonly').objectStore('files').getAll();
              request.onsuccess = () => resolve(request.result || []);
              request.onerror = () => reject(request.error);
            });
            return all.filter((row) => row.chatId === 'chatgpt:hidden-file-smoke');
          } finally { db.close(); }
        }''')

    mutation_files = []
    deadline = time.time() + 10
    while time.time() < deadline:
        mutation_files = files_for_hidden_chat()
        if any(row.get('name') == 'hidden-mutation-report.pdf' for row in mutation_files):
            break
        time.sleep(0.25)
    mutation_record = next((row for row in mutation_files if row.get('name') == 'hidden-mutation-report.pdf'), None)
    execution_contexts = [
        {
            'id': event.get('params', {}).get('context', {}).get('id'),
            'origin': event.get('params', {}).get('context', {}).get('origin'),
            'name': event.get('params', {}).get('context', {}).get('name'),
            'type': event.get('params', {}).get('context', {}).get('auxData', {}).get('type'),
        }
        for event in hidden_events
        if event.get('method') == 'Runtime.executionContextCreated'
    ]
    assert mutation_record is not None, f'hidden mutation attachment was not captured: files={mutation_files} contexts={execution_contexts}'
    assert mutation_record.get('source') == 'hidden-tab-supervisor', mutation_record

    # Existing hidden links can become attachments by changing only the download attribute.
    time.sleep(2.7)
    hidden_eval("""(() => {
      const host = document.querySelector('#fixture');
      const attachment = document.createElement('a');
      attachment.id = 'late-download-only';
      attachment.href = 'https://chatgpt.com/backend-api/content/opaque-123';
      attachment.textContent = 'Open generated content';
      host.appendChild(attachment);
      return true;
    })()""")
    time.sleep(1.2)
    hidden_eval("document.querySelector('#late-download-only').setAttribute('download', 'late-hidden-data.csv'); true")

    late_files = []
    deadline = time.time() + 6
    while time.time() < deadline:
        late_files = files_for_hidden_chat()
        if any('late-hidden-data.csv' in str(row.get('name', '')) for row in late_files):
            break
        time.sleep(0.25)
    late_record = next((row for row in late_files if 'late-hidden-data.csv' in str(row.get('name', ''))), None)
    assert late_record is not None, f'download-only hidden mutation was not captured: {late_files}'
    assert late_record.get('source') == 'hidden-tab-supervisor', late_record

    # Separately prove the background supervisor can address a genuine inactive UI-strip tab.
    inactive_visibility = inactive.evaluate('({ hidden:document.hidden, state:document.visibilityState, focused:document.hasFocus() })')
    wake = admin.evaluate('''async (url) => {
      const tab = (await chrome.tabs.query({})).find((row) => row.url === url);
      if (!tab) return { ok:false, error:'tab-missing' };
      const response = await chrome.tabs.sendMessage(tab.id, { type:'PC_TAB_SUPERVISOR_TICK', at:Date.now() });
      return { active:Boolean(tab.active), highlighted:Boolean(tab.highlighted), response };
    }''', inactive_tab_url)
    assert wake.get('active') is False, wake
    assert wake.get('response', {}).get('ok') is True, wake
    assert wake.get('response', {}).get('supervisor') == 'pc-tab-supervisor-v1', wake

    print(json.dumps({
        'runtime': runtime,
        'proofMode': 'raw-cdp-hidden-renderer-plus-inactive-ui-tab',
        'hiddenTarget': {k: hidden_target_info.get(k) for k in ['targetId','type','url','attached']},
        'hiddenVisibility': hidden_visibility,
        'hiddenReady': ready,
        'hiddenExecutionContexts': execution_contexts,
        'hiddenChromeTabs': hidden_tab_state,
        'inactiveTarget': {k: inactive_target_info.get(k) for k in ['targetId','type','url','attached']},
        'inactiveTab': inactive_tab_state,
        'inactiveVisibility': inactive_visibility,
        'mutationRecord': {k: mutation_record.get(k) for k in ['name','href','kind','source','chatId']},
        'lateDownloadRecord': {k: late_record.get(k) for k in ['name','href','kind','source','chatId']},
        'wake': wake,
        'hiddenFileCount': len(late_files),
        'hiddenProtocolEventCount': len(hidden_events),
    }, sort_keys=True))
    browser_cdp.send('Target.detachFromTarget', {'sessionId': hidden_session_id})
    browser_cdp.detach()
    context.close()
