import asyncio,json,pathlib,threading,functools,re,os,tempfile
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.async_api import async_playwright
BASE=pathlib.Path(__file__).resolve().parents[1];E=BASE/'test-results';E.mkdir(exist_ok=True);TEMP=tempfile.TemporaryDirectory(prefix='commander-ui-');os.environ['COMMANDER_UI_TEST_HOME']=TEMP.name
async def main():
 server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(SimpleHTTPRequestHandler,directory=str(BASE)));threading.Thread(target=server.serve_forever,daemon=True).start();origin=f'http://127.0.0.1:{server.server_port}'
 proc=await asyncio.create_subprocess_exec('node',str(BASE/'tests/ui-worker.mjs'),stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
 lock=asyncio.Lock();n=0;results=[]
 async def rpc(op,args=None):
  nonlocal n
  async with lock:
   n+=1;proc.stdin.write((json.dumps({'id':n,'op':op,'args':args or {}})+'\n').encode());await proc.stdin.drain()
   response=json.loads(await proc.stdout.readline())
   if 'error' in response:raise RuntimeError(response['error'])
   return response['result']
 try:
  async with async_playwright() as p:
   browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
   page=await browser.new_page(viewport={'width':1400,'height':1000})
   ui_errors=[];page.on('pageerror',lambda error:ui_errors.append(str(error)))
   await page.expose_function('__tool',rpc)
   mock=r'''window.__ui={theme:'dark',chatZoom:1,alwaysOnTop:false};
   window.__views=[];window.__overlay=false;window.__eventListeners=new Set();
   window.__nativeAccess={};window.__nativeFixture=null;window.__nativeReads=0;window.__nativeOpens=0;
   window.__emit=e=>{for(const fn of window.__eventListeners)fn(e);};
   window.commanderShell={
     snapshot:async()=>{const s=await window.__tool('snapshot');return {...s,config:{...s.config,...window.__nativeAccess},emergencyLock:Boolean(window.__nativeAccess.emergencyLock),ui:window.__ui,platform:window.__nativeFixture?.platform||'linux'};},
     listTools:()=>window.__tool('listTools'),runTool:(name,args)=>window.__tool('runTool',{name,args}),
     onEvent:fn=>{window.__eventListeners.add(fn);return ()=>window.__eventListeners.delete(fn);},
     setWorkspaceVisible:()=>Promise.resolve({ok:true}),setView:async(view)=>{window.__views.push(view);return {ok:true,view}},
     setOverlayVisible:async(visible)=>{window.__overlay=visible;return {ok:true}},
     setPreferences:async(patch)=>{Object.assign(window.__ui,patch);return {ok:true,preferences:window.__ui}},
     setSidebarCollapsed:async()=>({ok:true}),retryResult:async()=>({ok:true}),setEmergencyLock:async()=>({ok:true}),
     computerLinkStatus:async()=>{window.__nativeReads++;if(window.__nativeStatusFailure)throw new Error('Fixture: native discovery failed');return window.__nativeFixture?structuredClone(window.__nativeFixture):window.__tool('native-status');},
     computerLinkSessionStatus:async()=>window.__nativeProbeFailure?{available:true,verified:false,reason:'Fixture: native connection timed out'}:window.__tool('native-session'),
     openComputerLink:async()=>{window.__nativeOpens++;if(!window.__nativeFixture)throw new Error('UI fixture is required for Windows owner actions');window.__nativeFixture.owner.running=true;window.__nativeFixture.owner.pid=12345;return {started:true};},
     stopComputerLink:async()=>{if(window.__nativeStopFailure)return {stopped:false,reason:'Fixture: native process has not confirmed exit'};if(!window.__nativeFixture)throw new Error('UI fixture is required for Windows owner actions');window.__nativeFixture.owner.running=false;window.__nativeFixture.owner.pid=null;return {stopped:true};}
   };'''

   # The sandbox blocks both HTTP and file navigations. Mount the owned document in
   # a test page; only transport/loading are substituted, never production CSP.
   shell=(BASE/'electron/shell.html').read_text()
   shell=re.sub(r'<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*>','',shell,flags=re.I)
   shell=re.sub(r'<script\b[^>]*>.*?</script\s*>','',shell,flags=re.I|re.S)
   shell=re.sub(r'<link\b[^>]*rel="stylesheet"[^>]*>','',shell,flags=re.I)
   await page.set_content(shell);await page.evaluate(mock)
   await page.add_style_tag(content=(BASE/'electron/shell.css').read_text())
   for name in ['shell.js','workspace.js','computer-link.js','chrome.js','tasks.js']:await page.add_script_tag(content=(BASE/'electron'/name).read_text())
   await page.wait_for_function("document.getElementById('workspace-path').value.length>0")
   await page.locator('.rail-button[data-view=workspace]').click();await page.wait_for_function("document.body.dataset.view==='workspace'")
   await page.click('#workspace-browse');await page.get_by_text('File: example.txt',exact=True).click();await page.wait_for_function("document.getElementById('workspace-editor').value==='original text\\n'")
   await page.fill('#workspace-editor','saved via real controls\n');await page.click('#workspace-save');await page.wait_for_function("document.getElementById('workspace-status').textContent==='Saved and verified.'")
   file=pathlib.Path(TEMP.name)/'workspace'/'example.txt';assert file.read_text()=='saved via real controls\n';results.append('real file browse/open/edit/save')
   file.write_text('external change\n');await page.fill('#workspace-editor','stale change');await page.click('#workspace-save');await page.wait_for_function("document.getElementById('workspace-status').textContent.includes('changed since')")
   assert file.read_text()=='external change\n';results.append('editor refuses concurrent external modification')
   await page.locator('.rail-button[data-view=terminal]').click()
   await page.fill('#terminal-command','printf "terminal control works"');await page.click('#terminal-run');await page.wait_for_function("document.getElementById('terminal-status').textContent.includes('finished')")
   assert 'terminal control works' in await page.locator('#terminal-output').inner_text();results.append('real terminal start and complete output')
   await page.fill('#terminal-command','sleep 30');await page.click('#terminal-run');await page.wait_for_function("!document.getElementById('terminal-stop').disabled")
   await page.click('#terminal-stop');await page.wait_for_function("document.getElementById('terminal-status').textContent.includes('terminated')");results.append('terminal Stop terminates actual managed process')
   assert await page.locator('#workspace-view').is_visible();results.append('wide workspace switches without discarding editor state')
   await page.screenshot(path=str(E/'workspace-controls.png'),full_page=True)
   await page.click('#workspace-toggle');assert await page.locator('#workspace-view').is_hidden()
   await page.locator('.rail-button[data-view=settings]').click()
   await page.select_option('#theme','light');await page.wait_for_function("document.documentElement.dataset.theme==='light'")
   results.append('light appearance applies through preferences API')
   await page.select_option('#theme','dark');await page.wait_for_function("document.documentElement.dataset.theme==='dark'")
   await page.select_option('#chat-zoom','1.25');await page.wait_for_function("window.__ui.chatZoom===1.25");results.append('chat zoom and appearance controls dispatch validated preferences')
   await page.click('#pin-window');await page.wait_for_function("window.__ui.alwaysOnTop===true");results.append('pin control reflects stored state')
   await page.keyboard.press('Control+Shift+P');await page.wait_for_function("document.getElementById('quick-actions').open")
   assert await page.evaluate('window.__overlay');await page.fill('#action-query','terminal');await page.keyboard.press('Enter');await page.wait_for_function("document.body.dataset.view==='terminal'")
   await page.wait_for_function('window.__overlay===false');results.append('palette keyboard navigation hides native view during modal and restores it')
   await page.fill('#terminal-command','cat');await page.click('#terminal-run');await page.wait_for_function("!document.getElementById('terminal-stop').disabled")
   await page.fill('#terminal-stdin','interactive input works');await page.click('#terminal-send');await page.wait_for_function("document.getElementById('terminal-output').textContent.includes('interactive input works')")
   await page.click('#terminal-stop');results.append('interactive terminal stdin returns real process output')
   await page.click('button[data-view=tools]');await page.select_option('#direct-tool','read_file')
   await page.wait_for_function("document.querySelector('#tool-fields [data-key=path]')!==null")
   await page.locator('#tool-fields [data-key=path]').fill(str(file));await page.click('#direct-run');await page.wait_for_function("document.getElementById('direct-result').textContent.includes('external change')")
   results.append('generated tool form calls the real file handler without hand-written JSON')
   await page.keyboard.press('Control+Shift+E');await page.wait_for_function("document.body.dataset.view==='workspace'")
   assert await page.locator('#workspace-editor').input_value()=='stale change';results.append('workspace survives navigation and retains unsaved draft')
   await page.click('#workspace-browse');await page.wait_for_function("document.getElementById('workspace-status').textContent.startsWith('1 entries')");await page.fill('#file-filter','not-a-matching-file');assert await page.locator('#workspace-list button:visible').count()==0
   await page.fill('#file-filter','');assert await page.locator('#workspace-list button:visible').count()>0;results.append('explorer filename filter retains complete folder listing')
   await page.screenshot(path=str(E/'workspace-dark.png'),full_page=True)
   for width in [1440,1100,950]:
    await page.set_viewport_size({'width':width,'height':1000})
    assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    assert await page.evaluate('document.getElementById("workspace-view").scrollWidth <= document.getElementById("workspace-view").clientWidth')
   results.append('workspace remains usable at 1440, 1100 and 950 pixel widths')
   await page.click('#controls');await page.wait_for_function("document.body.dataset.view==='access'");assert await page.locator('.sidebar').is_visible()
   await page.keyboard.press('Escape');await page.wait_for_function("document.body.dataset.view==='chat'");results.append('narrow-window permissions open without native chat occlusion')
   await page.set_viewport_size({'width':1440,'height':1000});await page.locator('.rail-button[data-view=connections]').click();assert await page.locator('#relay-url').is_visible();results.append('remote MCP connection is explicit, not falsely labeled connected')
   await page.wait_for_function("document.getElementById('native-tools-status').getAttribute('aria-busy')==='false' && document.getElementById('native-tools-badge').textContent==='Unavailable'")
   assert await page.locator('#native-tools-open').is_disabled()
   assert await page.locator('#native-tools-test').is_enabled()
   await page.locator('#native-tools-test').evaluate("el=>{el.closest('details').open=true;}")
   await page.click('#native-tools-test');await page.wait_for_function("document.getElementById('native-tools-status').textContent.includes('handshake verified')")
   assert 'NOT CONNECTED' in await page.locator('#native-tools-diagnostic').text_content()
   assert await page.evaluate('window.__nativeOpens')==0
   results.append('actual Linux native MCP status handshake renders without owner activation; Windows-only tools remain unavailable')

   # Windows presentation/action responses below are explicit UI fixtures. Real
   # Windows owner/process acceptance is enforced separately on Windows CI.
   await page.evaluate("""async()=>{const actual=await window.__tool('native-status');window.__nativeFixture={...actual,platform:'win32',windowsSupported:true,available:true,owner:{available:true,running:false,pid:null},mcp:{...actual.mcp,available:true,command:'C:\\Program Files\\Project Constellation\\resources\\computer-link\\computer-link-mcp-session.exe'},capabilities:actual.capabilities.map(c=>({...c,available:true}))};window.__nativeAccess={enableGuiAutomation:true,localToolMode:'auto'};window.__emit({type:'config-changed',detail:{config:window.__nativeAccess}});}""")
   await page.click('#native-tools-refresh');await page.wait_for_function("document.getElementById('native-tools-badge').textContent==='Ready'")
   assert await page.locator('#native-tools-open').is_enabled()
   await page.wait_for_function("document.getElementById('gui-toggle').checked===true")
   await page.screenshot(path=str(E/'native-tools-desktop.png'),full_page=True)
   await page.click('#native-tools-open');await page.wait_for_function("document.getElementById('native-tools-badge').textContent==='Running'")
   assert await page.locator('#native-tools-stop').is_enabled()
   assert await page.locator('#native-tools-open').is_disabled()
   await page.evaluate('window.__nativeStopFailure=true');await page.click('#native-tools-stop');await page.wait_for_function("document.getElementById('native-tools-badge').textContent==='Close unconfirmed'")
   assert await page.locator('#native-tools-stop').is_enabled()
   await page.screenshot(path=str(E/'native-tools-close-unconfirmed.png'),full_page=True)
   await page.evaluate('window.__nativeStatusFailure=true');await page.click('#native-tools-refresh');await page.wait_for_function("document.getElementById('native-tools-badge').textContent==='Check failed'")
   assert await page.locator('#native-tools-stop').is_enabled()
   await page.evaluate("()=>{window.__nativeStatusFailure=false;window.__nativeStopFailure=false;window.__nativeFixture.owner.running=false;window.__emit({type:'computer-link-state',detail:{type:'exited'}});}")
   await page.wait_for_function("document.getElementById('native-tools-badge').textContent==='Ready' && document.getElementById('native-tools-status').textContent==='Native tools closed.'")
   results.append('UI fixtures: launch/running state, unconfirmed-close and discovery failures preserve Close; observed exit recovers')
   await page.evaluate("()=>{window.__nativeAccess.enableGuiAutomation=false;window.__emit({type:'config-changed',detail:{config:{enableGuiAutomation:false}}});window.__emit({type:'emergency-lock',detail:{enabled:true}});window.__emit({type:'emergency-lock',detail:{enabled:false}});}")
   assert await page.locator('#native-tools-open').is_disabled()
   assert await page.locator('#native-tools-badge').inner_text()=='Access disabled'
   await page.evaluate("()=>{window.__nativeAccess.enableGuiAutomation=true;window.__emit({type:'config-changed',detail:{config:{enableGuiAutomation:true}}});}")
   assert await page.locator('#native-tools-open').is_enabled()
   await page.evaluate('window.__nativeProbeFailure=true');await page.click('#native-tools-test');await page.wait_for_function("document.getElementById('native-tools-badge').textContent==='Test failed'")
   assert 'timed out' in await page.locator('#native-tools-status').inner_text()
   await page.evaluate('window.__nativeProbeFailure=false');await page.click('#native-tools-test');await page.wait_for_function("document.getElementById('native-tools-status').textContent.includes('handshake verified')")
   results.append('UI fixtures: unlock respects disabled GUI access; failed MCP handshake stays failed until successful real retry')
   await page.locator('#native-tools-command').evaluate("el=>{el.closest('details').open=true;}")
   for width in [1440,950]:
    await page.set_viewport_size({'width':width,'height':1000})
    assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    assert await page.locator('#native-tools-open').is_visible()
    assert await page.locator('#native-tools-stop').is_visible()
    assert await page.evaluate("document.getElementById('native-tools-command').scrollWidth <= document.getElementById('native-tools-command').clientWidth")
   await page.screenshot(path=str(E/'native-tools-narrow.png'),full_page=True)
   await page.evaluate("()=>{window.__nativeFixture.owner.available=false;window.__nativeFixture.mcp.available=false;}")
   await page.click('#native-tools-refresh');await page.wait_for_function("document.getElementById('native-tools-badge').textContent==='Unavailable'")
   assert await page.locator('#native-tools-open').is_disabled() and await page.locator('#native-tools-test').is_disabled()
   results.append('UI fixtures: desktop and narrow native controls fit, connector settings wrap, missing components show unavailable')
   await page.set_viewport_size({'width':1440,'height':1000})
   await page.locator('.rail-button[data-view=settings]').click();await page.select_option('#theme','light');await page.wait_for_timeout(200);await page.screenshot(path=str(E/'settings-light.png'),full_page=True)
   assert await page.evaluate('(()=>{const ids=[...document.querySelectorAll("[id]")].map(x=>x.id);return ids.length===new Set(ids).size})()');results.append('all production control IDs are unique')

   assert not ui_errors,ui_errors
   # Run the production preload in Chromium. Only the Electron IPC transport is substituted.
   chat=await browser.new_page(viewport={'width':1200,'height':800});await chat.expose_function('__ipc',rpc)
   await chat.add_init_script('''window.__listeners={};window.require=()=>({ipcRenderer:{invoke:(channel,args)=>window.__ipc(channel,args),on:(channel,fn)=>{window.__listeners[channel]=fn;}}});''')
   await chat.route('https://constellation.test/**',lambda route:route.fulfill(status=200,content_type='text/html',body=(BASE/'electron/fixture-chat.html').read_text()))
   await chat.goto('https://constellation.test/c/fixture');await chat.evaluate("window.__listeners={};window.require=()=>({ipcRenderer:{invoke:(channel,args)=>window.__ipc(channel,args),on:(channel,fn)=>{window.__listeners[channel]=fn;}}})")
   await chat.evaluate('''()=>{const a=document.createElement('article');a.dataset.messageAuthorRole='assistant';a.dataset.messageId='old';a.textContent='[PC_BUDDY_CALL]{"id":"old","nonce":"ui-test-nonce","tool":"ping","args":{}}[/PC_BUDDY_CALL]';document.querySelector('main').append(a);}''')
   await chat.add_script_tag(content=(BASE/'electron/chat-preload.cjs').read_text());await chat.add_script_tag(content=(BASE.parent/'extension/src/local-work-page-hook.js').read_text());await chat.wait_for_timeout(150)
   assert (await rpc('metrics'))['chatCalls']==0;results.append('history is inert on startup')
   chat_errors=[];chat.on('pageerror',lambda error:chat_errors.append(str(error)))
   await chat.click('#composer-submit-button')
   try:await chat.wait_for_function("document.querySelector('main').textContent.includes('Project Constellation Electron smoke complete.')",timeout=15000)
   except Exception as error:raise AssertionError({'errors':chat_errors,'metrics':await rpc('metrics'),'fixture':await chat.evaluate('window.fixture')}) from error
   assert (await rpc('metrics'))['chatCalls']==1;results.append('fresh nonce-authenticated assistant call executes and delivers')
   await chat.evaluate('''()=>{const nodes=[...document.querySelectorAll('[data-message-author-role="assistant"]')];const a=nodes.find(n=>n.textContent.includes(window.fixture.lastId));const copy=a.cloneNode(true);delete copy.dataset.constellationCommanderCallClaimed;delete copy.dataset.constellationCommanderCallId;a.replaceWith(copy);}''')
   await chat.wait_for_timeout(150);assert (await rpc('metrics'))['chatCalls']==1;results.append('DOM remount cannot replay an action')
   await chat.evaluate('''()=>{for(const [role,text] of [['user','[PC_BUDDY_CALL]{"id":"user","nonce":"ui-test-nonce","tool":"ping","args":{}}[/PC_BUDDY_CALL]'],['assistant','Example: [PC_BUDDY_CALL]{"id":"quote","nonce":"ui-test-nonce","tool":"ping","args":{}}[/PC_BUDDY_CALL]'],['assistant','[PC_BUDDY_CALL]{"id":"stale","nonce":"stale","tool":"ping","args":{}}[/PC_BUDDY_CALL]']]){const a=document.createElement('article');a.dataset.messageAuthorRole=role;a.textContent=text;document.querySelector('main').append(a);}}''')
   await chat.wait_for_timeout(200);assert (await rpc('metrics'))['chatCalls']==1;results.append('user wrappers, quoted examples, and stale nonces do not execute')
   await chat.locator('#prompt-textarea').fill('KEEP MY UNSENT DRAFT')
   await chat.evaluate('''()=>{const a=document.createElement('article');a.dataset.messageAuthorRole='assistant';a.textContent='[PC_BUDDY_CALL]{"id":"draft","nonce":"ui-test-nonce","tool":"ping","args":{}}[/PC_BUDDY_CALL]';document.querySelector('main').append(a);}''')
   await chat.wait_for_timeout(250);metrics=await rpc('metrics');assert metrics['chatCalls']==2 and len(metrics['pending'])==1
   assert await chat.locator('#prompt-textarea').inner_text()=='KEEP MY UNSENT DRAFT';results.append('unsent draft preserved and completed result retained')
   await chat.evaluate("()=>window.__listeners['cc:config-changed']({}, {localToolMode:'off'})")
   await chat.evaluate('''()=>{const a=document.createElement('article');a.dataset.messageAuthorRole='assistant';a.textContent='[PC_BUDDY_CALL]{"id":"off","nonce":"ui-test-nonce","tool":"ping","args":{}}[/PC_BUDDY_CALL]';document.querySelector('main').append(a);}''');await chat.wait_for_timeout(150)
   assert (await rpc('metrics'))['chatCalls']==2;results.append('Off mode prevents further execution')
   await browser.close()
  (E/'browser-regression.json').write_text(json.dumps({'passed':results,'failed':[],'transport':'Chromium with IPC test adapter; production tool handler executes real disk/process operations'},indent=2));print(json.dumps(results,indent=2))
 finally:
  if proc.returncode is None:
   proc.stdin.close()
   try:await asyncio.wait_for(proc.wait(),10)
   except asyncio.TimeoutError:proc.kill();await proc.wait()
  server.shutdown()
asyncio.run(main())
