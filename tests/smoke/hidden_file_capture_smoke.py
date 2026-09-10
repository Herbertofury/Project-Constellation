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

    # Proof B: Chrome's protocol-native hidden target is guaranteed renderer-hidden but, by CDP
    # contract, is intentionally absent from the tab UI strip. This isolates the exact
    # document.hidden content-script path that Playwright cannot expose on a UI-strip tab.
    hidden_created = browser_cdp.send('Target.createTarget', {
        'url': hidden_url,
        'background': True,
        'hidden': True,
    })
    hidden_target_id = hidden_created.get('targetId')
    assert hidden_target_id, hidden_created

    hidden = None
    deadline = time.time() + 10
    while time.time() < deadline and hidden is None:
        hidden = next((page for page in context.pages if page.url == hidden_url), None)
        if hidden is None:
            time.sleep(0.1)
    assert hidden is not None, 'protocol-native hidden target was not adopted into the Playwright browser context'
    hidden.wait_for_load_state('domcontentloaded')

    hidden_target_info = browser_cdp.send('Target.getTargetInfo', {'targetId': hidden_target_id}).get('targetInfo', {})
    hidden_tab_state = admin.evaluate('''async (url) => {
      const tab = (await chrome.tabs.query({})).find((row) => row.url === url);
      return tab ? { found:true, active:Boolean(tab.active), highlighted:Boolean(tab.highlighted), id:tab.id } : { found:false };
    }''', hidden_url)
    assert hidden_tab_state.get('found') is False, hidden_tab_state

    hidden_cdp = context.new_cdp_session(hidden)
    hidden_cdp.send('Emulation.setFocusEmulationEnabled', {'enabled': False})
    hidden_visibility_before = hidden.evaluate('({ hidden:document.hidden, state:document.visibilityState, focused:document.hasFocus() })')
    if hidden_visibility_before.get('hidden') is not True:
        hidden_cdp.send('Page.setWebLifecycleState', {'state': 'frozen'})
        time.sleep(0.15)
        hidden_cdp.send('Page.setWebLifecycleState', {'state': 'active'})
        time.sleep(0.25)
    hidden_visibility = hidden.evaluate('({ hidden:document.hidden, state:document.visibilityState, focused:document.hasFocus() })')
    assert hidden_visibility.get('hidden') is True and hidden_visibility.get('state') == 'hidden', {
        'before': hidden_visibility_before,
        'after': hidden_visibility,
        'target': hidden_target_info,
        'chromeTabs': hidden_tab_state,
    }

    hidden.evaluate('''() => {
      const host = document.querySelector('#fixture');
      const attachment = document.createElement('a');
      attachment.href = 'sandbox:/mnt/data/hidden-mutation-report.pdf';
      attachment.download = 'hidden-mutation-report.pdf';
      attachment.dataset.testid = 'file-attachment';
      attachment.setAttribute('aria-label', 'Download hidden-mutation-report.pdf');
      attachment.textContent = 'hidden-mutation-report.pdf';
      host.appendChild(attachment);
    }''')

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
    assert mutation_record is not None, f'hidden mutation attachment was not captured: {mutation_files}'
    assert mutation_record.get('source') == 'hidden-tab-supervisor', mutation_record

    # Existing hidden links can become attachments by changing only the download attribute.
    time.sleep(2.7)
    hidden.evaluate('''() => {
      const host = document.querySelector('#fixture');
      const attachment = document.createElement('a');
      attachment.id = 'late-download-only';
      attachment.href = 'https://chatgpt.com/backend-api/content/opaque-123';
      attachment.textContent = 'Open generated content';
      host.appendChild(attachment);
    }''')
    time.sleep(1.2)
    hidden.evaluate("document.querySelector('#late-download-only').setAttribute('download', 'late-hidden-data.csv')")

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
        'proofMode': 'split-hidden-renderer-plus-inactive-ui-tab',
        'hiddenTarget': {k: hidden_target_info.get(k) for k in ['targetId','type','url','attached']},
        'hiddenVisibilityBefore': hidden_visibility_before,
        'hiddenVisibility': hidden_visibility,
        'hiddenChromeTabs': hidden_tab_state,
        'inactiveTarget': {k: inactive_target_info.get(k) for k in ['targetId','type','url','attached']},
        'inactiveTab': inactive_tab_state,
        'inactiveVisibility': inactive_visibility,
        'mutationRecord': {k: mutation_record.get(k) for k in ['name','href','kind','source','chatId']},
        'lateDownloadRecord': {k: late_record.get(k) for k in ['name','href','kind','source','chatId']},
        'wake': wake,
        'hiddenFileCount': len(late_files),
    }, sort_keys=True))
    hidden_cdp.detach()
    browser_cdp.detach()
    context.close()
