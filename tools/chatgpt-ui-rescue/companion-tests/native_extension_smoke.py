"""Real installed-extension fixture test. No live account or security-policy changes."""
import asyncio, json, os, pathlib, tempfile
from playwright.async_api import async_playwright
ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'companion-evidence'
FIXTURE = '''<!doctype html><html><head><title>Scheduled tasks</title></head><body><main><h1>Scheduled</h1><article data-task-id="task1" data-run-id="run1"><h2>Minecraft Mod Catalogue Updater</h2><p id="state">This task needs your attention</p><button id="follow">Follow-up</button></article></main><script>window.clicks={follow:0,resume:0};document.querySelector('#follow').onclick=()=>{clicks.follow++;setTimeout(()=>{const d=document.createElement('div');d.setAttribute('role','dialog');d.innerHTML='<h2>Minecraft Mod Catalogue Updater</h2><p>This run was interrupted. Resume this run.</p><button id="resume">Resume</button>';document.body.append(d);document.querySelector('#resume').onclick=()=>{clicks.resume++;document.querySelector('#state').textContent='Running';document.querySelector('#follow').remove();d.remove();};},350);};</script></body></html>'''
async def main():
 OUT.mkdir(exist_ok=True)
 async with async_playwright() as p:
  with tempfile.TemporaryDirectory(prefix='pcx-native-smoke-') as profile:
   options = dict(headless=True, channel='chromium', ignore_default_args=['--disable-extensions'], args=[f'--disable-extensions-except={ROOT / "browser-companion"}', f'--load-extension={ROOT / "browser-companion"}'])
   if os.getenv('CHROMIUM_EXECUTABLE'):
    options.pop('channel'); options['executable_path'] = os.environ['CHROMIUM_EXECUTABLE']
   ctx = await p.chromium.launch_persistent_context(profile, **options)
   try:
    await ctx.route('https://chatgpt.com/**', lambda r: r.fulfill(status=200, content_type='text/html', body=FIXTURE))
    worker = ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event('serviceworker', timeout=15000)
    extension_id = worker.url.split('/')[2]
    popup = await ctx.new_page(); await popup.goto(f'chrome-extension://{extension_id}/popup.html')
    # An extension-created tab can precede route registration. Establish the
    # intended fixture response before exercising the unmodified controller.
    state = await popup.evaluate("chrome.runtime.sendMessage({type:'PCX_RECOVERY_STATE'})")
    deadline = asyncio.get_running_loop().time() + 10
    pages = []
    while asyncio.get_running_loop().time() < deadline:
     pages = [page for page in ctx.pages if page.url.startswith('https://chatgpt.com')]
     if pages: break
     await asyncio.sleep(.1)
    assert pages, 'Controller did not create its task page'
    page = pages[0]
    await page.goto('https://chatgpt.com/schedules?pcx-native-fixture=1', wait_until='domcontentloaded')
    await page.get_by_role('heading', name='Minecraft Mod Catalogue Updater', exact=True).wait_for()
    await popup.evaluate("chrome.runtime.sendMessage({type:'PCX_RECOVERY_CHECK'})")
    deadline = asyncio.get_running_loop().time() + 25
    while asyncio.get_running_loop().time() < deadline:
     state = await popup.evaluate("chrome.runtime.sendMessage({type:'PCX_RECOVERY_STATE'})")
     if any(i.get('status') == 'RUNNING_OBSERVED' for i in state['incidents'].values()): break
     await asyncio.sleep(.25)
    else:
     diagnostics = {'state':state,'pages':[]}
     for page in ctx.pages:
      diagnostics['pages'].append({'url':page.url,'text':(await page.locator('body').inner_text())[:5000]})
     (OUT / 'native-extension-failure.json').write_text(json.dumps(diagnostics,indent=2))
     raise AssertionError('No positive Running evidence: ' + json.dumps(diagnostics))
    intents = [x for x in state['history'] if x['event'] == 'ACTION_INTENT']
    assert sum(x['kind'] == 'open-followup' for x in intents) == 1, intents
    assert sum(x['kind'] == 'resume' for x in intents) == 1, intents
    await popup.evaluate("chrome.runtime.sendMessage({type:'PCX_RECOVERY_CONFIG',config:{enabled:false}})")
    paused = await popup.evaluate("chrome.runtime.sendMessage({type:'PCX_RECOVERY_STATE'})")
    assert not paused['config']['enabled']
    await popup.screenshot(path=str(OUT / 'native-extension.png'), full_page=True)
    result = {'native_extension_fixture':'PASS', 'extension_id':extension_id, 'live_user_account':False, 'checks':['Follow-up dispatched exactly once','Delayed dialog mounted','Resume dispatched exactly once','Positive Running UI observed','Pause persisted']}
    (OUT / 'native-extension.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))
   finally: await ctx.close()
asyncio.run(main())
