from playwright.sync_api import sync_playwright
import json, pathlib, os

root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_ROOT','/mnt/data/project-constellation'))
health=(root/'src/health-core.js').read_text()
sentinel=(root/'src/live-sentinel.js').read_text()
html='''<!doctype html><html><body><main id="main">
<section data-testid="conversation-turn-1"><div data-message-author-role="user" data-message-id="u-old">Old request</div></section>
<div id="historic-timeout"><span>Message delivery timed out. Please try again.</span><button>Retry</button></div>
<section data-testid="conversation-turn-2"><div data-message-author-role="assistant" data-message-id="a-old"><p>Old answer.</p><button aria-label="Copy">Copy</button></div></section>
<section data-testid="conversation-turn-3"><div data-message-author-role="user" data-message-id="u-current">Run the current QA pass.</div></section>
<section data-testid="conversation-turn-4"><div data-message-author-role="assistant" data-message-id="a-current"><p>I verified the UI. The phrase “Message delivery timed out. Please try again.” is mentioned here only as documentation and must not be treated as a live provider error.</p><button aria-label="Copy">Copy</button></div></section>
</main></body></html>'''
mock=r'''(() => {
  window.__messages=[];window.__listeners=[];window.chrome={storage:{local:{get:async()=>({})}},runtime:{sendMessage:async(msg)=>{window.__messages.push(structuredClone(msg));return {ok:true};},onMessage:{addListener:(fn)=>window.__listeners.push(fn),removeListener:(fn)=>{window.__listeners=window.__listeners.filter(x=>x!==fn);}}}};
  window.__send=(msg)=>new Promise((resolve)=>{let done=false;for(const fn of window.__listeners){const keep=fn(msg,{},(value)=>{if(!done){done=true;resolve(value);}});if(keep===true)return;}setTimeout(()=>{if(!done)resolve(undefined);},20);});
})();'''

with sync_playwright() as p:
    launch={'headless':True,'args':['--no-sandbox']}
    chromium=os.environ.get('PROJECT_CONSTELLATION_CHROMIUM','').strip()
    if chromium: launch['executable_path']=chromium
    browser=p.chromium.launch(**launch)
    page=browser.new_page(); errors=[]; page.on('pageerror',lambda exc:errors.append(str(exc)))
    page.set_content(html,wait_until='load'); page.evaluate(mock); page.add_script_tag(content=health); page.add_script_tag(content=sentinel); page.wait_for_timeout(300)
    baseline=page.evaluate("__send({type:'PC_GET_LIVE_SENTINEL_STATE'})")
    assert baseline['chat']['status']=='idle' and baseline['chat']['healthState']=='healthy', baseline

    # Current ChatGPT failure shape from the user's screenshot: ordinary styled DIV,
    # no role=alert/aria-live/error test id. Native Retry is the structural anchor.
    page.evaluate("""() => { const box=document.createElement('div'); box.id='current-timeout'; box.innerHTML='<span>Message delivery timed out. Please try again.</span><button id="retry-now">Retry</button>'; document.getElementById('main').appendChild(box); }""")
    page.wait_for_timeout(350)
    timeout=page.evaluate("__send({type:'PC_GET_LIVE_SENTINEL_STATE'})")
    assert timeout['chat']['status']=='delivery-timeout', timeout
    assert timeout['chat']['healthState']=='delivery-timeout', timeout
    assert timeout['failure']['active'] is True and timeout['failure']['retryAvailable'] is True and timeout['failure']['retryLabel']=='Retry', timeout
    assert timeout['health']['level'] in ('danger','critical'), timeout

    page.evaluate("document.getElementById('current-timeout').remove()")
    page.wait_for_timeout(2600)
    cleared=page.evaluate("__send({type:'PC_GET_LIVE_SENTINEL_STATE'})")
    assert cleared['chat']['status']=='idle' and cleared['chat']['healthState']=='healthy', cleared

    # Hard-cap banner with no ARIA semantics and no button must still win over settled
    # transcript/DOM state and appear as Critical through healthState.
    page.evaluate("""() => { const box=document.createElement('div'); box.id='plain-capacity'; box.textContent=\"You've reached the maximum length for this conversation, but you can keep talking by starting a new chat.\"; document.getElementById('main').appendChild(box); }""")
    page.wait_for_timeout(350)
    reached=page.evaluate("__send({type:'PC_GET_LIVE_SENTINEL_STATE'})")
    assert reached['chat']['healthState']=='capacity-reached', reached
    assert reached['health']['state']=='capacity-reached' and reached['health']['level']=='critical', reached
    assert reached['generation']['capacityState']=='reached', reached
    assert reached['health']['recommendedAction']=='handoff', reached

    pushes=page.evaluate("window.__messages.filter(x=>x.type==='PC_LIVE_CHAT_STATE_PUSH').map(x=>x.state).slice(-8)")
    assert any((x.get('chat') or {}).get('status')=='delivery-timeout' for x in pushes), pushes
    assert any((x.get('chat') or {}).get('healthState')=='capacity-reached' for x in pushes), pushes
    print(json.dumps({'baseline':baseline,'timeout':timeout,'cleared':cleared,'reached':reached,'pushes':pushes,'errors':errors},sort_keys=True))
    assert not errors
    browser.close()
