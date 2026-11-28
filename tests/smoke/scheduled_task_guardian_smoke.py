from playwright.sync_api import sync_playwright
import pathlib, json, os

root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_ROOT','/mnt/data/project-constellation/extension')).resolve()
if (root/'extension').is_dir():
    root=root/'extension'
brain=(root/'src/brain-core.js').read_text()
providers=(root/'src/provider-core.js').read_text()
guardian=(root/'src/scheduled-task-guardian-core.js').read_text()
off=(root/'offscreen.js').read_text()
mock="""
(() => { const listeners={}; globalThis.chrome={runtime:{onMessage:{addListener:(fn)=>listeners.message=fn}}}; globalThis.__listeners=listeners; })();
"""

def send(page, message):
    return page.evaluate("""async (m)=>new Promise((resolve)=>{
      const handled=__listeners.message(m, {}, resolve);
      if (handled === false) setTimeout(()=>resolve({ok:false,unhandled:true}),0);
    })""", message)

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox'],executable_path=(os.environ.get('PROJECT_CONSTELLATION_CHROMIUM') or None))
    page=browser.new_page()
    errors=[]
    page.on('pageerror',lambda exc: errors.append(str(exc)))
    page.set_content('<!doctype html><html><body></body></html>')
    page.add_script_tag(content=mock)
    page.add_script_tag(content=brain)
    page.add_script_tag(content=providers)
    page.add_script_tag(content=guardian)
    page.add_script_tag(content=off)

    start=send(page, {'type':'PC_SCHEDULE_GUARDIAN_START','target':'pc-scheduled-task-guardian','payload':{'url':'https://chatgpt.com/schedules'}})
    frame=page.locator('#project-constellation-scheduled-task-guardian')
    assert start['ok'] and start['framePresent']
    assert frame.count()==1
    assert frame.get_attribute('src')=='https://chatgpt.com/schedules'
    assert frame.get_attribute('aria-hidden')=='true'
    assert frame.get_attribute('tabindex')=='-1'
    style=frame.get_attribute('style') or ''
    for marker in ['width: 1px','height: 1px','opacity: 0','pointer-events: none','left: -10000px']:
        assert marker in style, (marker, style)

    # Unsafe or alternate URLs must be clamped to the one supported destination.
    forced=send(page, {'type':'PC_SCHEDULE_GUARDIAN_START','target':'pc-scheduled-task-guardian','payload':{'url':'https://evil.example/schedules','force':True}})
    assert forced['ok'] and forced['framePresent']
    assert frame.count()==1
    assert frame.get_attribute('src')=='https://chatgpt.com/schedules'

    # Repeated start is idempotent and never accumulates hidden pages.
    again=send(page, {'type':'PC_SCHEDULE_GUARDIAN_START','target':'pc-scheduled-task-guardian','payload':{'url':'https://chatgpt.com/schedules'}})
    assert again['ok'] and frame.count()==1
    ping=send(page, {'type':'PC_SCHEDULE_GUARDIAN_PING','target':'pc-scheduled-task-guardian'})
    assert ping['ok'] and ping['framePresent'] and ping['url']=='https://chatgpt.com/schedules'

    stopped=send(page, {'type':'PC_SCHEDULE_GUARDIAN_STOP','target':'pc-scheduled-task-guardian'})
    assert stopped['ok'] and not stopped['framePresent']
    assert frame.count()==0
    assert not errors, errors
    print(json.dumps({'start':start,'forced':forced,'ping':ping,'stopped':stopped,'errors':errors},sort_keys=True))
    browser.close()
