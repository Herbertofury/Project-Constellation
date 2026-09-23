"""Real Chromium DOM fixtures. No live login, tasks, account data or permission changes.
The container blocks extension installation; this test executes the production UI adapter
against browser-rendered fixtures, not a claim of installed-extension/live-account proof.
"""
import asyncio, json, pathlib, time, os
from playwright.async_api import async_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
RESULTS=[]
TITLE='Minecraft Mod Catalogue Updater'
ORIGIN='http://127.0.0.1:43819'
def html(body, script='', title='Scheduled tasks'):
 return '<!doctype html><html><head><meta charset="utf-8"><title>'+title+'</title><style>body{background:#12151e;color:white;font:16px system-ui;margin:32px}button,textarea{margin:10px;padding:10px}article,.panel{padding:16px;border:1px solid #567;margin:10px} [hidden]{display:none!important}</style></head><body><main><h1>Scheduled</h1>'+body+'</main><script>'+script+'</script></body></html>'
def card(title=TITLE, ident='task1', run='r1', heading=True):
 h='<h2>'+title+'</h2>' if heading else '<div style="font-weight:bold">'+title+'</div>'
 return f'<article data-task-id="{ident}" data-run-id="{run}">{h}<small>Hourly - Next run in 11 minutes</small><p class="attention">This task needs your attention.</p><button class="follow">Follow-up</button></article>'
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.getenv('CHROMIUM_EXECUTABLE','/usr/lib/chromium/chromium'),headless=True,args=['--no-sandbox','--disable-gpu'])
  async def case(name, body, callback, script='', url='https://chatgpt.com/schedules', title='Scheduled tasks'):
   context=await browser.new_context()
   await context.route(ORIGIN+'/**',lambda r:r.fulfill(status=200,content_type='text/html',body=html(body,script,title)))
   page=await context.new_page()
   await page.set_content(html(body,script,title))
   await page.evaluate('(url)=>{const u=new URL(url);window.fixtureLocation={href:url,origin:u.origin,pathname:u.pathname}}',url)
   await page.add_script_tag(path=str(ROOT/'browser-companion'/'core.js'))
   await page.add_script_tag(content='(function(location){'+(ROOT/'browser-companion'/'page.js').read_text()+'})(window.fixtureLocation);')
   start=time.monotonic()
   try:
    await callback(page)
    RESULTS.append({'name':name,'status':'PASS','seconds':round(time.monotonic()-start,3)})
   except Exception as e:
    RESULTS.append({'name':name,'status':'FAIL','error':str(e)})
    await page.screenshot(path=str(ROOT/'companion-evidence'/('FAILED-'+str(len(RESULTS))+'.png')))
   finally:await context.close()
  async def scan(page):return await page.evaluate('PCXTaskRecoveryPage.inspect()')
  active={'title':TITLE,'id':'task1','runId':'r1','key':TITLE+'|task1|r1'}
  async def inspect(page):return await page.evaluate('(a)=>PCXTaskRecoveryPage.inspect(a)',active)
  async def act(page,action):return await page.evaluate('([a,s])=>PCXTaskRecoveryPage.act(a,s)',[action,active])
  async def title_case(page):
   s=await scan(page);assert len(s['tasks'])==1 and s['tasks'][0]['title']==TITLE
  await case('Supplied-panel style untagged title is discovered',card(heading=False),title_case)
  async def delayed(page):
   s=await scan(page);r=await act(page,s['tasks'][0]['openAction']);assert r['ok']
   s=await inspect(page);assert not s['completed'] and not s['running']
   await page.wait_for_selector('#resume',state='visible')
   s=await inspect(page);assert s['action']['kind']=='resume'
   assert (await act(page,s['action']))['ok']
   s=await inspect(page);assert s['running'] and not s['completed']
   assert await page.evaluate('window.clicks')=={'open':1,'resume':1}
   await page.screenshot(path=str(ROOT/'companion-evidence'/'chromium-recovered-fixture.png'))
  script="""window.clicks={open:0,resume:0};document.querySelector('.follow').onclick=()=>{clicks.open++;setTimeout(()=>{let d=document.createElement('div');d.setAttribute('role','dialog');d.innerHTML='<h2>Minecraft Mod Catalogue Updater</h2><p>Task run interrupted. Resume this run.</p><button id="resume">Resume</button>';document.body.append(d);document.querySelector('#resume').onclick=()=>{clicks.resume++;d.remove();document.querySelector('.attention').textContent='Running';document.querySelector('.follow').remove();}},350)};"""
  await case('Delayed Follow-up -> Resume -> positive Running evidence',card(),delayed,script)
  async def approval_case(page):
   s=await inspect(page);assert s['approval'];assert s['action'] is None
  await case('Allow-all permission card is not auto-approved',card()+'<div role="dialog"><h2>'+TITLE+'</h2><p>Approval required</p><button>Allow all actions</button><button>Allow</button><button>Continue</button></div>',approval_case)
  async def swap_approval(page):
   s=await inspect(page);assert s['action']
   await page.evaluate("document.body.insertAdjacentHTML('beforeend','<div role=dialog><p>Approval required</p><button>Allow</button></div>')")
   r=await act(page,s['action']);assert not r['ok'];assert await page.evaluate('window.clicked||0')==0
  resume='<section data-message-author-role="assistant"><p>This run was interrupted. Resume this run.</p><button id="resume" onclick="window.clicked=(window.clicked||0)+1">Resume</button></section>'
  await case('Approval appears between inspect and click: no click',card()+resume,swap_approval)
  async def draft_case(page):
   s=await inspect(page);assert s['draft'] and s['action'] is None
   assert await page.locator('textarea').input_value()=='user draft stays'
  await case('Existing draft remains untouched',card()+resume+'<textarea>user draft stays</textarea>',draft_case)
  async def draft_race(page):
   s=await inspect(page);assert s['action'];await page.locator('textarea').fill('new draft')
   r=await act(page,s['action']);assert not r['ok'];assert await page.evaluate('window.clicked||0')==0
  await case('Draft appears after inspection: action rejected',card()+resume+'<textarea></textarea>',draft_race)
  async def ambiguous(page):
   s=await inspect(page);assert s['ambiguous'] and s['action'] is None
  await case('Multiple Resume controls require an unambiguous target',card()+resume.replace('</section>','<button>Resume</button></section>'),ambiguous)
  async def disabled(page):
   s=await inspect(page);r=await act(page,s['action']);assert not r['ok'] and r['reason']=='CONTROL_DISABLED'
  await case('Disabled Resume not forced',card()+resume.replace('id="resume"','id="resume" disabled'),disabled)
  async def unknown(page):
   s=await scan(page);assert not s['recognized'];assert not s['tasks']
  await case('Unknown page never reports no blockers', '<p>Unexpected screen layout</p>',unknown,script="document.querySelector('h1').remove()")
  async def many(page):
   s=await scan(page);assert len(s['tasks'])==151
  await case('All 151 task cards discovered, no first-100 truncation',''.join(card('Task '+str(i),'t'+str(i),'r'+str(i)) for i in range(151)),many)
  async def retired(page):assert not (await scan(page))['tasks']
  await case('Intentional tombstone ignored',card('RETIRED - Old service'),retired)
  async def changed_control(page):
   s=await inspect(page);await page.locator('#resume').evaluate("e=>e.textContent='Allow'")
   assert not (await act(page,s['action']))['ok']
  await case('Control changed to Allow after inspection is rejected',card()+resume,changed_control)
  async def vanished(page):
   s=await inspect(page);assert not s['completed'] and not s['running']
  await case('Disappeared attention marker alone is not success',card().replace('This task needs your attention.',''),vanished)
  async def complete(page):assert (await inspect(page))['completed']
  await case('Explicit Completed UI is recognized, separate from delivery',card().replace('This task needs your attention.','Completed').replace('<button class="follow">Follow-up</button>',''),complete)
  async def continuation(page):
   s=await inspect(page);assert s['action']['kind']=='continue-run'
   r=await act(page,s['action']);assert r['ok']
   sent=await page.evaluate('window.sent');assert len(sent)==1 and 'complete original scope' in sent[0]
  q='<section data-message-author-role="assistant"><p>Shall I continue?</p></section><textarea id="prompt-textarea"></textarea><button data-testid="send-button" onclick="window.sent.push(document.querySelector(\'textarea\').value)">Send</button>'
  await case('Explicit non-security continuation is sent once',card()+q,continuation,'window.sent=[]')
  async def missing(page):assert (await inspect(page))['action'] is None
  await case('Missing file question does not fabricate input',card()+q.replace('Shall I continue?','Please upload the missing file. Shall I continue?'),missing)
  async def challenge_case(page):assert (await inspect(page))['challenge']
  await case('Browser verification not bypassed',card()+resume,challenge_case,title='Verify you are human')
  async def late_consent(page):
   s=await inspect(page);assert s['approval'];await page.locator('#approval').evaluate('e=>e.remove()')
   s=await inspect(page);assert not s['approval'] and s['action']['kind']=='resume'
   assert (await act(page,s['action']))['ok']
  await case('After legitimate consent change, safe Resume becomes available',card()+resume+'<div role="dialog" id="approval"><h2>'+TITLE+'</h2><p>Approval required</p><button>Approve</button></div>',late_consent)
  async def stale(page):
   s=await scan(page);await page.evaluate("fixtureLocation.href='https://chatgpt.com/c/unrelated';fixtureLocation.pathname='/c/unrelated'")
   assert not (await act(page,s['tasks'][0]['openAction']))['ok']
  await case('Navigation invalidates an old Follow-up token',card(),stale)
  async def outside(page):
   s=await scan(page);r=await act(page,s['tasks'][0]['openAction']);assert not r['ok'] and r['reason']=='UNSAFE_DESTINATION'
  await case('Off-site Follow-up link never followed',card().replace('<button class="follow">Follow-up</button>','<a href="https://evil.invalid/c/fake">Follow-up</a>'),outside)
  await browser.close()
 (ROOT/'companion-evidence'/'dom-results.json').write_text(json.dumps({'runtime':'Chromium 144 / production DOM adapter / in-memory DOM fixtures with injected Location dependency (no live site access)','live_chatgpt_verified':False,'results':RESULTS},indent=2))
 for r in RESULTS:print(r['status'],r['name'],r.get('error',''))
 if any(r['status']!='PASS' for r in RESULTS):raise SystemExit(1)
asyncio.run(main())
