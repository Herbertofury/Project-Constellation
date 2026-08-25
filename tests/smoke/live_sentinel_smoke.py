from playwright.sync_api import sync_playwright
import json, pathlib, os

root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_ROOT','/mnt/data/project-constellation'))
sentinel=(root/'src/live-sentinel.js').read_text()
html='''<!doctype html><html><body><main>
<section data-testid="conversation-turn-1"><div data-message-author-role="user" data-message-id="u-old">Earlier request</div></section>
<section data-testid="conversation-turn-2"><div data-message-author-role="assistant" data-message-id="a-old"><p>Previous answer is complete.</p><button aria-label="Copy">Copy</button></div></section>
<section data-testid="conversation-turn-3"><div data-message-author-role="user" data-message-id="u-current">Continue building and inspect the current mob animations.</div></section>
<div id="current-progress">
  <div class="text-token-text-tertiary">Searched 20 websites</div>
  <div id="searching" class="text-token-text-tertiary">Searching the web</div>
  <div id="inspecting">Inspecting mob animation rendering logic</div>
  <button>Called tool</button><button>Called tool</button><button>Called tool</button>
</div>
</main></body></html>'''
mock=r'''(() => {
  window.__messages=[];window.__listeners=[];
  window.chrome={runtime:{
    sendMessage:async(msg)=>{window.__messages.push(msg);return {ok:true};},
    onMessage:{addListener:(fn)=>window.__listeners.push(fn),removeListener:(fn)=>{window.__listeners=window.__listeners.filter(x=>x!==fn);}}
  }};
  window.__send=(msg)=>new Promise((resolve)=>{let resolved=false;for(const fn of window.__listeners){const keep=fn(msg,{},(value)=>{if(!resolved){resolved=true;resolve(value);}});if(keep===true)return;}setTimeout(()=>{if(!resolved)resolve(undefined);},10);});
  const host=document.createElement('div');host.id='projectConstellationHealthHud';const shadow=host.attachShadow({mode:'open'});shadow.innerHTML='<div id="pcHealthTitle">Chat complete</div><div id="pcHealthMini">old detector</div><div id="pcHealthNowTitle">Searched 20 websites</div><div id="pcHealthNowDetail"></div><div id="pcHealthActivity">model</div><div id="pcHealthTool">—</div>';document.documentElement.appendChild(host);
})();'''

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
    page=browser.new_page();errors=[];page.on('pageerror',lambda exc:errors.append(str(exc)))
    page.set_content(html,wait_until='load');page.evaluate(mock);page.add_script_tag(content=sentinel);page.wait_for_timeout(220)
    active=page.evaluate("__send({type:'PC_GET_LIVE_SENTINEL_STATE'})")
    hud_active=page.evaluate("document.getElementById('projectConstellationHealthHud').shadowRoot.getElementById('pcHealthTitle').textContent")
    # Finish the current frontier: the exact visible in-progress labels become past tense,
    # then the current assistant turn gets its final control.
    page.evaluate("""() => {
      document.getElementById('searching').textContent='Searched the web';
      document.getElementById('inspecting').textContent='Inspected mob animation rendering logic';
      const turn=document.createElement('section');turn.setAttribute('data-testid','conversation-turn-4');
      turn.innerHTML='<div data-message-author-role="assistant" data-message-id="a-current"><p>Finished the requested animation inspection.</p><button aria-label="Copy">Copy</button></div>';
      document.querySelector('main').appendChild(turn);
    }""")
    page.wait_for_timeout(260)
    done=page.evaluate("__send({type:'PC_GET_LIVE_SENTINEL_STATE'})")
    print(json.dumps({'active':active,'hudActive':hud_active,'done':done,'errors':errors},sort_keys=True))
    assert active['ok'] and active['chat']['status']=='running'
    assert active['generation']['active'] is True and active['generation']['progressiveTool'] is True
    assert active['generation']['source']=='current-progress-label'
    assert active['generation']['toolLabel']=='Inspecting mob animation rendering logic'
    assert active['tool']['current'] is True
    assert hud_active.startswith('Tool working')
    assert done['ok'] and done['chat']['status']=='idle' and done['generation']['active'] is False
    assert done['generation']['finalControls'] is True
    assert not errors
    browser.close()
