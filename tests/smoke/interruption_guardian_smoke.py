from playwright.sync_api import sync_playwright
import json, pathlib, os

root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_ROOT','/mnt/data/project-constellation'))
health=(root/'src/health-core.js').read_text()
sentinel=(root/'src/live-sentinel.js').read_text()
html='''<!doctype html><html><body><main id="main">
<section data-testid="conversation-turn-1"><div data-message-author-role="user" data-message-id="u-old">Old request</div></section>
<div id="old-error" role="alert">Message delivery timed out. Please try again.<button>Retry</button></div>
<section data-testid="conversation-turn-2"><div data-message-author-role="assistant" data-message-id="a-old">Old answer<button aria-label="Copy">Copy</button></div></section>
<section data-testid="conversation-turn-3"><div data-message-author-role="user" data-message-id="u-current">Continue the project and test the tools.</div></section>
<div id="activity"><div class="text-token-text-tertiary">Called tool</div><div class="text-token-text-tertiary">Called tool</div><div class="text-token-text-tertiary">Talked to App</div></div>
<section data-testid="conversation-turn-4"><div data-message-author-role="assistant" data-message-id="a-current"><p id="partial">Partial answer output that was preserved here.</p></div></section>
<div id="current-error" role="alert"><span id="error-text">Message delivery timed out. Please try again.</span><button id="provider-retry">Retry</button></div>
</main></body></html>'''
mock=r'''(() => {
  window.__messages=[]; window.__listeners=[]; window.__storageListeners=[]; window.__providerClicks=0;
  window.chrome={runtime:{sendMessage:async(msg)=>{window.__messages.push(msg);return {ok:true};},onMessage:{addListener:(fn)=>window.__listeners.push(fn),removeListener:(fn)=>{window.__listeners=window.__listeners.filter(x=>x!==fn);}}},storage:{local:{get:async()=>({projectConstellationBrainSettings:{liveHealth:{enabled:true,toolWatchdogEnabled:true,capacityGuardEnabled:true}}})},onChanged:{addListener:(fn)=>window.__storageListeners.push(fn),removeListener:(fn)=>{window.__storageListeners=window.__storageListeners.filter(x=>x!==fn);}}}};
  window.__send=(msg)=>new Promise((resolve)=>{let resolved=false;for(const fn of window.__listeners){const keep=fn(msg,{},(value)=>{if(!resolved){resolved=true;resolve(value);}});if(keep===true)return;}setTimeout(()=>{if(!resolved)resolve(undefined);},20);});
  const host=document.createElement('div');host.id='projectConstellationHealthHud';const shadow=host.attachShadow({mode:'open'});shadow.innerHTML='<div id="pcHealthTitle">Legacy health</div><div id="pcHealthMini">legacy</div><div id="pcHealthNowTitle">Legacy now</div><div id="pcHealthNowDetail"></div><div id="pcHealthActivity">model</div><div id="pcHealthTool">—</div><div id="pcHealthCapacity">clear</div><div class="actions"><button id="pcHealthRefresh">Refresh</button><button id="pcHealthHandoff" hidden>Handoff</button></div>';document.documentElement.appendChild(host);
  document.getElementById('provider-retry').addEventListener('click',()=>{window.__providerClicks++;document.getElementById('current-error')?.remove();const n=document.createElement('div');n.id='searching';n.className='text-token-text-tertiary';n.textContent='Searching project files';document.getElementById('activity').appendChild(n);});
})();'''

with sync_playwright() as p:
    launch={'headless':True,'args':['--no-sandbox']}
    chromium=os.environ.get('PROJECT_CONSTELLATION_CHROMIUM','').strip()
    if chromium: launch['executable_path']=chromium
    browser=p.chromium.launch(**launch)
    page=browser.new_page(); errors=[]; page.on('pageerror',lambda exc:errors.append(str(exc)))
    page.set_content(html,wait_until='load'); page.evaluate(mock)
    page.add_script_tag(content=health); page.add_script_tag(content=sentinel); page.wait_for_timeout(180)
    timed=page.evaluate("__send({type:'PC_GET_LIVE_SENTINEL_STATE'})")
    hud=page.evaluate("""() => {const h=document.getElementById('projectConstellationHealthHud'),s=h.shadowRoot,r=s.getElementById('pcHealthRetry');return {state:h.dataset.state,level:h.dataset.level,title:s.getElementById('pcHealthTitle').textContent,detail:s.getElementById('pcHealthNowDetail').textContent,retryHidden:r?.hidden,retryText:r?.textContent,refreshHidden:s.getElementById('pcHealthRefresh').hidden,clicks:window.__providerClicks};}""")
    retry=page.evaluate("__send({type:'PC_LIVE_SENTINEL_RETRY_FAILURE'})")
    page.wait_for_timeout(180)
    running=page.evaluate("__send({type:'PC_GET_LIVE_SENTINEL_STATE'})")

    cases={}
    for text,name in [
        ('A network error occurred. Please check your connection and try again.','connection-interrupted'),
        ('There was an error generating a response.','response-interrupted'),
        ('Message was not sent.','send-failed')
    ]:
        page.evaluate("""([text]) => {document.getElementById('searching')?.remove();document.getElementById('current-error')?.remove();const e=document.createElement('div');e.id='current-error';e.setAttribute('role','alert');e.innerHTML=`<span>${text}</span><button id="provider-retry">Retry</button>`;document.getElementById('main').appendChild(e);}""", [text])
        page.wait_for_timeout(90)
        state=page.evaluate("__send({type:'PC_GET_LIVE_SENTINEL_STATE'})")
        cases[name]=state['chat']['status']
        page.evaluate("document.getElementById('current-error')?.remove()")

    # Historical guard: leave only the old timeout before the newest user, then show real current work.
    page.evaluate("""() => {document.getElementById('current-error')?.remove();const n=document.createElement('div');n.id='searching';n.className='text-token-text-tertiary';n.textContent='Searching project files phase 2';document.getElementById('activity').appendChild(n);}""")
    page.wait_for_timeout(120)
    historical=page.evaluate("__send({type:'PC_GET_LIVE_SENTINEL_STATE'})")

    result={'timed':timed,'hud':hud,'retry':retry,'running':running,'cases':cases,'historical':historical,'providerClicks':page.evaluate('window.__providerClicks'),'errors':errors}
    print(json.dumps(result,sort_keys=True))
    assert timed['chat']['status']=='delivery-timeout', timed
    assert timed['chat']['healthState']=='delivery-timeout', timed
    assert timed['failure']['active'] is True and timed['failure']['retryAvailable'] is True
    assert timed['generation']['interrupted'] is True and timed['generation']['phase']=='interrupted'
    assert timed['failure']['partialAssistantChars'] >= 45, timed['failure']
    assert hud['state']=='delivery-timeout' and hud['level']=='danger', hud
    assert hud['retryHidden'] is False and hud['retryText']=='Retry', hud
    assert hud['refreshHidden'] is True and hud['clicks']==0, hud
    assert 'partial chars preserved' in hud['detail'] and 'Retry available' in hud['detail'], hud
    assert retry=={'ok':True,'action':'retry','state':'delivery-timeout','label':'Retry','attempt':1}, retry
    assert result['providerClicks']==1, result
    assert running['chat']['status']=='running' and running['failure'] is None, running
    assert 'Searching project files' in running['tool']['label'], running
    assert cases=={'connection-interrupted':'connection-interrupted','response-interrupted':'response-interrupted','send-failed':'send-failed'}, cases
    assert historical['chat']['status']=='running' and historical['failure'] is None, historical
    assert not errors, errors
    browser.close()
