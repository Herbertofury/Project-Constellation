from playwright.sync_api import sync_playwright
import pathlib, os, tempfile, time, json

root = pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_BUILD', '/mnt/data/project-constellation/build/unpacked')).resolve()
extension_id = 'geljambmkfjkhodgkpjhnmfojkpcamig'
hidden_url = 'https://chatgpt.com/c/hidden-file-smoke'
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

    # Playwright keeps normal pages renderer-visible under automation even when their Chrome tab
    # is inactive. Create an actual inactive browser tab, then drive Chromium's own lifecycle API
    # through frozen -> active. Page.setWebLifecycleState('frozen') invokes WebContents::WasHidden();
    # the following 'active' transition resumes script execution without synthesizing JS visibility.
    foreground = context.new_page()
    foreground.goto(foreground_url, wait_until='domcontentloaded')
    foreground.bring_to_front()

    browser = context.browser
    assert browser is not None, 'persistent Chromium context did not expose its browser handle'
    browser_cdp = browser.new_browser_cdp_session()
    with context.expect_page(timeout=10000) as hidden_page_info:
        created = browser_cdp.send('Target.createTarget', {
            'url': hidden_url,
            'background': True,
            'forTab': True,
        })
    hidden = hidden_page_info.value
    hidden.wait_for_load_state('domcontentloaded')
    time.sleep(0.5)

    target_id = created.get('targetId')
    assert target_id, created
    target_info = browser_cdp.send('Target.getTargetInfo', {'targetId': target_id}).get('targetInfo', {})
    tab_state = admin.evaluate('''async (url) => {
      const tab = (await chrome.tabs.query({})).find((row) => row.url === url);
      return tab ? { found:true, active:Boolean(tab.active), highlighted:Boolean(tab.highlighted), id:tab.id } : { found:false };
    }''', hidden_url)
    assert target_info.get('type') == 'tab', target_info
    assert tab_state.get('found') is True and tab_state.get('active') is False, tab_state

    page_cdp = context.new_cdp_session(hidden)
    visibility_before = hidden.evaluate('({ hidden:document.hidden, state:document.visibilityState })')
    page_cdp.send('Page.setWebLifecycleState', {'state': 'frozen'})
    page_cdp.send('Page.setWebLifecycleState', {'state': 'active'})
    time.sleep(0.25)
    visibility = hidden.evaluate('({ hidden:document.hidden, state:document.visibilityState })')
    assert visibility == {'hidden': True, 'state': 'hidden'}, {
        'before': visibility_before,
        'after': visibility,
        'target': target_info,
        'tab': tab_state,
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
    # This must trigger the narrow hidden-file observer without waiting for the minute safety sweep.
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

    hidden.evaluate('''() => {
      const host = document.querySelector('#fixture');
      const attachment = document.createElement('a');
      attachment.href = 'https://drive.google.com/file/d/hidden-safety-file';
      attachment.setAttribute('aria-label', 'Download hidden-safety-data.csv');
      attachment.textContent = 'hidden-safety-data.csv';
      host.appendChild(attachment);
    }''')
    time.sleep(2.7)  # remain outside the bounded 2.5s hidden-scan throttle

    wake = admin.evaluate('''async (url) => {
      const tab = (await chrome.tabs.query({})).find((row) => row.url === url);
      if (!tab) return { ok:false, error:'tab-missing' };
      const response = await chrome.tabs.sendMessage(tab.id, { type:'PC_TAB_SUPERVISOR_TICK', at:Date.now() });
      return { active:tab.active, response };
    }''', hidden_url)
    assert wake.get('active') is False, wake
    assert wake.get('response', {}).get('ok') is True, wake
    assert wake.get('response', {}).get('supervisor') == 'pc-tab-supervisor-v1', wake
    assert wake.get('response', {}).get('snapshot', {}).get('hidden') is True, wake

    safety_files = files_for_hidden_chat()
    safety_record = next((row for row in safety_files if 'hidden-safety-data.csv' in str(row.get('name', ''))), None)
    assert safety_record is not None, f'service-worker safety wake did not preserve hidden file state: {safety_files}'
    assert safety_record.get('source') == 'hidden-tab-supervisor', safety_record

    print(json.dumps({
        'runtime': runtime,
        'hidden': True,
        'visibilityBefore': visibility_before,
        'visibility': visibility,
        'target': {k: target_info.get(k) for k in ['targetId','type','url','attached']},
        'tab': tab_state,
        'mutationRecord': {k: mutation_record.get(k) for k in ['name','href','kind','source','chatId']},
        'lateDownloadRecord': {k: late_record.get(k) for k in ['name','href','kind','source','chatId']},
        'safetyRecord': {k: safety_record.get(k) for k in ['name','href','kind','source','chatId']},
        'wake': wake,
        'fileCount': len(safety_files),
    }, sort_keys=True))
    page_cdp.detach()
    browser_cdp.detach()
    context.close()
