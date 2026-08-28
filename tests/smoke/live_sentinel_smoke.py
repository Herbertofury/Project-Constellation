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
  <div id="inspecting" class="text-token-text-tertiary">Inspecting mob animation rendering logic</div>
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
    launch={'headless':True,'args':['--no-sandbox']}
    chromium=os.environ.get('PROJECT_CONSTELLATION_CHROMIUM','').strip()
    if chromium: launch['executable_path']=chromium
    browser=p.chromium.launch(**launch)
    page=browser.new_page();errors=[];page.on('pageerror',lambda exc:errors.append(str(exc)))
    page.set_content(html,wait_until='load');page.evaluate(mock);page.add_script_tag(content=sentinel);page.wait_for_timeout(220)
    active=page.evaluate("__send({type:'PC_GET_LIVE_SENTINEL_STATE'})")
    hud_active=page.evaluate("document.getElementById('projectConstellationHealthHud').shadowRoot.getElementById('pcHealthTitle').textContent")

    # An unchanged spinner/tool label is an activity claim, not proof of progress.
    # The no-progress clock must keep aging while total response time also advances.
    page.wait_for_timeout(1400)
    quiet=page.evaluate("__send({type:'PC_GET_LIVE_SENTINEL_STATE'})")
    # The v7 health renderer owns watchdog/capacity severity. The Sentinel must carry
    # that state into canonical Chat Pulse instead of repainting it as merely active.
    page.evaluate("""() => { const h=document.getElementById('projectConstellationHealthHud'); h.dataset.watchdog='7'; h.dataset.state='tool-stalled'; h.dataset.level='danger'; }""")
    page.wait_for_timeout(220)
    watchdog=page.evaluate("__send({type:'PC_GET_LIVE_SENTINEL_STATE'})")
    page.evaluate("""() => { const h=document.getElementById('projectConstellationHealthHud'); delete h.dataset.watchdog; h.dataset.state='tool-running'; h.dataset.level='active'; }""")
    page.evaluate("document.getElementById('inspecting').textContent='Inspecting mob animation rendering logic phase 2'")
    page.wait_for_timeout(220)
    moved=page.evaluate("__send({type:'PC_GET_LIVE_SENTINEL_STATE'})")

    # Finish the exact reported current frontier, then include final prose containing
    # words such as verification/building. Ordinary assistant prose must never be
    # reinterpreted as live tool work.
    page.evaluate("""() => {
      document.getElementById('searching').textContent='Searched the web';
      document.getElementById('inspecting').textContent='Inspected mob animation rendering logic';
      const turn=document.createElement('section');turn.setAttribute('data-testid','conversation-turn-4');
      turn.innerHTML='<div data-message-author-role="assistant" data-message-id="a-current" aria-busy="true" data-state="loading"><p>The production release pipeline also passed verification, build, packaging, release publishing, and artifact upload. Thinking and reasoning are discussed here.</p><button aria-label="Copy">Copy</button></div>';
      document.querySelector('main').appendChild(turn);
      const stale=document.createElement('div');stale.id='stale-layout-busy';stale.setAttribute('aria-busy','true');stale.setAttribute('data-state','loading');stale.innerHTML='<span class="text-token-text-secondary">The production release pipeline also passed verification, build, packaging, release publishing, and artifact upload.</span>';document.querySelector('main').appendChild(stale);
    }""")
    page.wait_for_timeout(2600)
    done=page.evaluate("__send({type:'PC_GET_LIVE_SENTINEL_STATE'})")

    # Simulate the still-loaded v0.14.2 content renderer racing the hot-injected
    # Sentinel. It writes wrong colors/titles repeatedly. The HUD guard must repair
    # those mutations before paint, so no animation frame exposes the wrong state.
    guard=page.evaluate("""async () => {
      const h=document.getElementById('projectConstellationHealthHud');const sh=h.shadowRoot;let i=0;
      const timer=setInterval(()=>{const levels=['active','warning','danger'];h.dataset.level=levels[i%3];h.dataset.state=i%2?'tool-running':'stalled';sh.getElementById('pcHealthTitle').textContent=i%2?'Tool working · stale renderer':'Chat stalled';i++;if(i>=120)clearInterval(timer);},8);
      const frames=[];for(let f=0;f<60;f++){await new Promise(requestAnimationFrame);frames.push([h.dataset.level,h.dataset.state,sh.getElementById('pcHealthTitle').textContent]);}
      return {bad:frames.filter(x=>x[0]!=='healthy'||x[1]!=='healthy'||x[2]!=='Chat complete'),diag:ProjectConstellationLiveSentinel.diagnostics()};
    }""")

    print(json.dumps({'active':active,'quiet':quiet,'watchdog':watchdog,'moved':moved,'hudActive':hud_active,'done':done,'guard':guard,'errors':errors},sort_keys=True))
    assert active['ok'] and active['chat']['status']=='running'
    assert active['generation']['active'] is True and active['generation']['progressiveTool'] is True
    assert active['generation']['source']=='current-progress-label'
    assert active['generation']['toolLabel']=='Inspecting mob animation rendering logic'
    assert active['tool']['current'] is True
    assert quiet['generation']['active'] is True
    assert quiet['tool']['lastProgressAt']==active['tool']['lastProgressAt'], (active, quiet)
    assert quiet['generation']['quietForMs'] >= 1000, quiet
    assert quiet['generation']['elapsedMs'] >= active['generation']['elapsedMs'] + 1000, (active, quiet)
    assert watchdog['chat']['healthState']=='tool-stalled' and watchdog['healthStale'] is True and watchdog['healthActive'] is False, watchdog
    assert moved['tool']['lastProgressAt'] > quiet['tool']['lastProgressAt'], (quiet, moved)
    assert moved['generation']['quietForMs'] < 900, moved
    assert moved['generation']['elapsedMs'] >= quiet['generation']['elapsedMs'], (quiet, moved)
    assert hud_active.startswith('Tool working')
    assert done['ok'] and done['chat']['status']=='idle' and done['generation']['active'] is False
    assert done['generation']['finalControls'] is True
    assert done['generation']['progressiveTool'] is False
    assert guard['bad']==[]
    assert guard['diag']['transitionCount'] <= 2
    assert not errors
    browser.close()
