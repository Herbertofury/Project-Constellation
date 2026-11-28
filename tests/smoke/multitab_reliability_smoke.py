"""Installed-extension all-tab recovery using current provider evidence.

This intentionally requires extension-capable Chromium. It never substitutes a
mocked worker or reports acceptance when the installed service worker cannot load.
"""
from playwright.sync_api import sync_playwright
from contextlib import contextmanager
import pathlib, os, tempfile, time, json, subprocess

repo=pathlib.Path(__file__).resolve().parents[2]
root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_BUILD',str(repo/'build/unpacked'))).resolve()
manifest=json.loads((root/'manifest.json').read_text())
extension_id='geljambmkfjkhodgkpjhnmfojkpcamig'
kinds=['recover-slow','recover-fast','draft','permission','healthy']
urls=[f'https://chatgpt.com/c/00000000-0000-4000-8000-{index+1:012d}' for index in range(len(kinds))]
fixtures=dict(zip(urls,kinds));requests={url:0 for url in urls}
project_id='chatgpt:project:g-p-smoke-project'

def fixture_html(kind):
    failure='<section id="failure" role="alert">ChatGPT stream recovery polling timed out <button id="retry">Retry</button></section>'
    if kind=='permission':
        surface='<div role="dialog" id="permission"><h2>Allow ChatGPT to use GitHub?</h2><button id="allow">Allow for this conversation</button><button>Deny</button></div><button data-testid="stop-button">Stop</button>'
    elif kind=='healthy':
        surface='<article data-testid="conversation-turn-2" data-message-author-role="assistant" data-message-id="a1">The task is complete.<button aria-label="Copy">Copy</button></article>'
    else:surface=failure
    draft='Preserve this exact user draft' if kind=='draft' else ''
    delay=2800 if kind=='recover-slow' else 900
    return '''<!doctype html><html><head><title>Reliability KIND</title></head><body>
    <nav><a href="https://chatgpt.com/g/g-p-smoke-project/project">Smoke Project</a></nav><main>
    <article data-testid="conversation-turn-1" data-message-author-role="user" data-message-id="u1">Finish the reliability task.</article>
    SURFACE
    <form id="composer-form"><div id="prompt-textarea" class="ProseMirror" contenteditable="true" role="textbox">DRAFT</div><div id="send-slot"></div></form>
    </main><script>
      window.__sent=[];window.__retryClicks=0;window.__permissionClicks=0;window.__stagedAt=0;
      document.querySelector('#retry')?.addEventListener('click',()=>__retryClicks++);
      document.querySelector('#allow')?.addEventListener('click',()=>__permissionClicks++);
      const composer=document.querySelector('#prompt-textarea');
      composer.addEventListener('input',()=>{
        if(__stagedAt||!(composer.innerText||composer.textContent||'').trim())return;
        __stagedAt=Date.now();
        setTimeout(()=>{
          const button=document.createElement('button');button.type='button';button.id='composer-submit-button';button.dataset.testid='send-button';button.setAttribute('aria-label','Send');button.textContent='Send';
          button.onclick=()=>{
            const text=(composer.innerText||composer.textContent||'').trim();if(!text)return;
            __sent.push({text,at:Date.now(),stagedAt:__stagedAt});composer.replaceChildren();document.querySelector('#failure')?.remove();
            const answer=document.createElement('article');answer.dataset.testid='conversation-turn-2';answer.dataset.messageAuthorRole='assistant';answer.dataset.messageId='a1';answer.innerHTML='Completed the continuation.<button aria-label="Copy">Copy</button>';document.querySelector('main').insertBefore(answer,document.querySelector('form'));
          };
          document.querySelector('#send-slot').appendChild(button);
        },DELAY);
      });
    </script></body></html>'''.replace('KIND',kind).replace('SURFACE',surface).replace('DRAFT',draft).replace('DELAY',str(delay))

# Playwright's regular launch enables focus emulation on every controlled page.
# Attach without those overrides to a browser owned only by this fixture, with
# an empty temporary profile and an ephemeral loopback debugging port. This
# preserves Chromium's real tab visibility instead of mocking document.hidden.
@contextmanager
def installed_browser(playwright, profile):
    args=[os.environ.get('PROJECT_CONSTELLATION_CHROMIUM') or playwright.chromium.executable_path,
        f'--user-data-dir={profile}','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1',
        '--no-first-run','--no-default-browser-check','--disable-dev-shm-usage','--no-sandbox',
        f'--disable-extensions-except={root}',f'--load-extension={root}']
    if not headful:args.append('--headless=new')
    args.append('about:blank')
    log_path=pathlib.Path(profile)/'browser.log'
    browser=None
    with log_path.open('wb') as log:
        process=subprocess.Popen(args,stdout=log,stderr=subprocess.STDOUT)
        try:
            endpoint_path=pathlib.Path(profile)/'DevToolsActivePort'
            deadline=time.monotonic()+15
            while True:
                try:
                    endpoint=endpoint_path.read_text().splitlines()
                    port=int(endpoint[0])
                    if 0<port<65536 and len(endpoint)>1 and endpoint[1].startswith('/devtools/browser/'):
                        break
                except (FileNotFoundError,ValueError,IndexError):
                    pass
                if process.poll() is not None or time.monotonic()>=deadline:
                    raise RuntimeError('Isolated Chromium did not start: '+log_path.read_text(errors='replace')[-6000:])
                time.sleep(.05)
            browser=playwright.chromium.connect_over_cdp(f'ws://127.0.0.1:{port}{endpoint[1]}',no_defaults=True)
            assert len(browser.contexts)==1,'Fixture must use the unmodified default browser context.'
            yield browser.contexts[0]
        finally:
            try:
                if browser is not None:browser.close()
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill();process.wait(timeout=5)

# Hosted Linux uses a private Xvfb display for actual browser tab activation.
headful = os.environ.get('PROJECT_CONSTELLATION_HEADFUL') == '1'
with tempfile.TemporaryDirectory(prefix='project-constellation-multitab-') as profile, sync_playwright() as p, installed_browser(p,profile) as context:
    admin=context.new_page();admin.goto(f'chrome-extension://{extension_id}/popup.html',wait_until='domcontentloaded')
    runtime=admin.evaluate('''async()=>{
      const reply=await Promise.race([chrome.runtime.sendMessage({type:'PC_PROVIDER_LIST'}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Installed extension runtime did not answer')),5000))]);
      return {id:chrome.runtime.id,version:chrome.runtime.getManifest().version,worker:chrome.runtime.getManifest().background.service_worker,ok:reply?.ok===true,providerCount:reply?.providers?.length||0};
    }''')
    assert runtime['id']==extension_id and runtime['version']==manifest['version'],runtime
    assert runtime['worker']=='background-entry.js' and runtime['ok'] and runtime['providerCount']>0,runtime
    # Configure before opening provider pages so every recovery begins from the
    # explicit test trigger, not an uncontrolled installation/activation event.
    setup=admin.evaluate('''()=>chrome.runtime.sendMessage({type:'PC_BRAIN_SETTINGS_SET',settings:{chatGuardian:{enabled:false,failureDelayMs:500,cooldownMs:60000,maxContinuationsPerFingerprint:1},refreshRecovery:{enabled:false},approvalAutopilot:{enabled:false,acknowledged:false,alwaysAllow:false,fallbackAllowOnce:false},catalog:{autoSweep:false}}})''')
    assert setup.get('ok') is True,setup

    def route_chat(route):
        url=route.request.url.split('?',1)[0].rstrip('/')
        if url in fixtures:
            if route.request.resource_type=='document':requests[url]+=1
            route.fulfill(status=200,content_type='text/html',body=fixture_html(fixtures[url]))
        else:route.fulfill(status=200,content_type='application/json',body='{}')
    context.route('https://chatgpt.com/**',route_chat)
    pages=[context.new_page() for _ in urls]
    for page,url in zip(pages,urls):page.goto(url,wait_until='domcontentloaded')
    pages[0].bring_to_front()
    pages[1].wait_for_function('document.hidden === true',polling=100,timeout=5000)
    assert pages[1].evaluate('document.hidden') is True,'Fixture must exercise a genuinely hidden runnable tab.'

    # Read real canonical IndexedDB state: discovery is not proven by a sent message.
    project=None;deadline=time.time()+12
    while time.time()<deadline:
        project=admin.evaluate('''async(id)=>{
          const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('project-constellation-brain');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
          try{if(!db.objectStoreNames.contains('projects'))return null;return await new Promise((resolve,reject)=>{const request=db.transaction('projects','readonly').objectStore('projects').get(id);request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error);});}finally{db.close();}
        }''',project_id)
        if project:break
        time.sleep(.15)
    assert project is not None,'Sidebar provider project must be committed to canonical storage.'
    assert project['name']=='Smoke Project' and project['sourceType']=='provider' and project['providerId']=='chatgpt',project

    # All responses are from the actual current content scripts, including hidden
    # pages. Do not seed old watchdog storage or invent stale running evidence.
    prep=admin.evaluate('''async(urls)=>{
      const tabs=(await chrome.tabs.query({})).filter(tab=>urls.includes(tab.url));
      const states=await Promise.all(tabs.map(async(tab)=>({tabId:tab.id,url:tab.url,active:tab.active,state:await chrome.tabs.sendMessage(tab.id,{type:'PC_GET_LIVE_SENTINEL_STATE'})})));
      return {tabs,states};
    }''',urls)
    assert len(prep['tabs'])==len(urls) and any(not tab['active'] for tab in prep['tabs']),prep
    for row in prep['states']:
        state=row['state'];assert state.get('ok') is True and state.get('source')=='live-sentinel' and state.get('version')==manifest['version'],row
        assert state.get('chat',{}).get('id') and state['chat'].get('status'),row
    held=next(row['state'] for row in prep['states'] if row['url']==urls[3])
    assert held['chat']['status']=='blocked-approval' and held['permission']['active'] is True,held
    assert held['generation']['active'] is False,'Permission outranks the old Stop control.'
    time.sleep(.7)  # settle the explicit provider error, not a synthetic stall timer
    result=admin.evaluate('''async()=>{
      await chrome.runtime.sendMessage({type:'PC_BRAIN_SETTINGS_SET',settings:{chatGuardian:{enabled:true,failureDelayMs:500,cooldownMs:60000,maxContinuationsPerFingerprint:1}}});
      return chrome.runtime.sendMessage({type:'PC_CHAT_GUARDIAN_RUN'});
    }''')
    assert result.get('ok') is True and result['tabs']==len(urls) and result['responsive']==len(urls),result
    assert result['continued']==2 and result['reloaded']==0,result
    sent=[page.evaluate('__sent') for page in pages]
    assert sent[0] and sent[1] and all(not values for values in sent[2:]),sent
    assert all(values[0]['text']=='Continue the unfinished task.' for values in sent[:2]),sent
    assert sent[1][0]['at']<sent[0][0]['at'],'A slow Send hydration in tab A must not serialize recovery of hidden tab B.'
    assert all(values[0]['at']>values[0]['stagedAt'] for values in sent[:2]),sent
    assert pages[2].locator('#prompt-textarea').inner_text()=='Preserve this exact user draft'
    assert pages[3].locator('#permission').count()==1
    assert all(page.evaluate('__retryClicks===0&&__permissionClicks===0') for page in pages)
    assert all(count==1 for count in requests.values()),f'Current safe continuation must not force page reloads: {requests}'

    status=admin.evaluate('()=>chrome.runtime.sendMessage({type:"PC_CHAT_GUARDIAN_STATUS"})')
    rows=status['state']['chats'];by_url={row['url']:row for row in prep['states']}
    for url in urls[:2]:
        history=rows[by_url[url]['state']['chat']['id']]
        assert history['lastResult']=='sent-continue' and history['continuations']==1,history
    draft_history=rows[by_url[urls[2]]['state']['chat']['id']]
    assert draft_history['lastResult']=='composer-busy',draft_history
    active_before=[row['id'] for row in prep['tabs'] if row['active']]
    active_after=admin.evaluate('(urls)=>chrome.tabs.query({}).then(tabs=>tabs.filter(tab=>urls.includes(tab.url)&&tab.active).map(tab=>tab.id))',urls)
    assert active_after==active_before,'Background recovery cannot steal the active browser tab.'
    admin.evaluate('()=>chrome.runtime.sendMessage({type:"PC_CHAT_GUARDIAN_RUN"})')
    assert all(page.evaluate('__sent.length')==(1 if index<2 else 0) for index,page in enumerate(pages)),'Repeat sweep must not duplicate sends.'
    print(json.dumps({'runtime':runtime,'provider_project':project,'tabs':len(urls),'hidden_tabs':sum(not row['active'] for row in prep['tabs']),'guardian':result,'sent':sent,'document_requests':requests,'permission_clicks':0,'retry_clicks':0,'draft_preserved':True,'focus_preserved':True},sort_keys=True))
