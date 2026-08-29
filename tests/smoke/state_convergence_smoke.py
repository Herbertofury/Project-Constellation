from playwright.sync_api import sync_playwright
import json, pathlib, os

root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_ROOT','/mnt/data/project-constellation'))
health=(root/'src/health-core.js').read_text()
sentinel=(root/'src/live-sentinel.js').read_text()
base='''<!doctype html><html><body><main id="main"></main></body></html>'''
mock=r'''(() => {
  window.__clock=Date.now(); Date.now=()=>window.__clock;
  window.__listeners=[]; window.__messages=[]; window.__storageListeners=[];
  window.chrome={
    runtime:{
      sendMessage:async(msg)=>{window.__messages.push(msg);return {ok:true};},
      onMessage:{addListener:(fn)=>window.__listeners.push(fn),removeListener:(fn)=>{window.__listeners=window.__listeners.filter(x=>x!==fn);}}
    },
    storage:{
      local:{get:async()=>({projectConstellationBrainSettings:{liveHealth:{enabled:true,toolWatchdogEnabled:true,capacityGuardEnabled:true}}})},
      onChanged:{addListener:(fn)=>window.__storageListeners.push(fn),removeListener:(fn)=>{window.__storageListeners=window.__storageListeners.filter(x=>x!==fn);}}
    }
  };
  window.__send=(msg)=>new Promise((resolve)=>{let resolved=false;for(const fn of window.__listeners){const keep=fn(msg,{},(value)=>{if(!resolved){resolved=true;resolve(value);}});if(keep===true)return;}setTimeout(()=>{if(!resolved)resolve(undefined);},20);});
  window.__hud=(watchdog,state)=>{const host=document.createElement('div');host.id='projectConstellationHealthHud';host.dataset.watchdog=watchdog;host.dataset.state=state;host.dataset.level='danger';const shadow=host.attachShadow({mode:'open'});shadow.innerHTML='<div id="pcHealthTitle">Chat may be stuck</div><div id="pcHealthMini">stale warning renderer</div><div id="pcHealthNowTitle">Old tool</div><div id="pcHealthNowDetail">no progress 999s</div><div id="pcHealthActivity">tool</div><div id="pcHealthTool">stalled</div><div id="pcHealthCapacity">38% · clear</div><button id="pcHealthHandoff" hidden>Handoff</button>';document.documentElement.appendChild(host);return host;};
})();'''

with sync_playwright() as p:
    launch={'headless':True,'args':['--no-sandbox']}
    chromium=os.environ.get('PROJECT_CONSTELLATION_CHROMIUM','').strip()
    if chromium: launch['executable_path']=chromium
    browser=p.chromium.launch(**launch)

    # Exact screenshot-shaped recovery: pre-upgrade HUD says tool-stalled while the
    # current turn has fresh real tool progress. v0.14.12 must converge to healthy.
    page=browser.new_page(); errors=[]; page.on('pageerror',lambda exc:errors.append(str(exc)))
    page.set_content(base,wait_until='load'); page.evaluate(mock)
    page.evaluate("""() => {
      const main=document.getElementById('main');
      main.innerHTML='<section data-testid="conversation-turn-1"><div data-message-author-role="user" data-message-id="u1">Continue the conversion.</div></section><div id="progress" class="text-token-text-tertiary">Inspecting ModForge source and report formats</div>';
      __hud('7','tool-stalled');
    }""")
    page.add_script_tag(content=health); page.add_script_tag(content=sentinel); page.wait_for_timeout(220)
    recovered=page.evaluate("__send({type:'PC_GET_LIVE_SENTINEL_STATE'})")
    recovered_hud=page.evaluate("""() => { const h=document.getElementById('projectConstellationHealthHud');const s=h.shadowRoot;return {watchdog:h.dataset.watchdog,state:h.dataset.state,level:h.dataset.level,title:s.getElementById('pcHealthTitle').textContent,now:s.getElementById('pcHealthNowTitle').textContent,detail:s.getElementById('pcHealthNowDetail').textContent}; }""")

    # Current-version HUD is content-owned. Sentinel must not read a stale stall bit
    # back as truth or race the visible clocks/text, but its canonical state must recover.
    page2=browser.new_page(); errors2=[]; page2.on('pageerror',lambda exc:errors2.append(str(exc)))
    page2.set_content(base,wait_until='load'); page2.evaluate(mock)
    page2.evaluate("""() => {
      const main=document.getElementById('main');
      main.innerHTML='<section data-testid="conversation-turn-1"><div data-message-author-role="user" data-message-id="u1">Keep working.</div></section><div id="progress" class="text-token-text-tertiary">Inspecting ModForge source and report formats</div>';
      __hud('10','tool-stalled');
    }""")
    before=page2.evaluate("document.getElementById('projectConstellationHealthHud').shadowRoot.getElementById('pcHealthTitle').textContent")
    page2.add_script_tag(content=health); page2.add_script_tag(content=sentinel); page2.wait_for_timeout(220)
    current=page2.evaluate("__send({type:'PC_GET_LIVE_SENTINEL_STATE'})")
    current_hud=page2.evaluate("""() => { const h=document.getElementById('projectConstellationHealthHud');const s=h.shadowRoot;return {watchdog:h.dataset.watchdog,state:h.dataset.state,level:h.dataset.level,title:s.getElementById('pcHealthTitle').textContent,detail:s.getElementById('pcHealthNowDetail').textContent}; }""")

    result={'recovered':recovered,'recoveredHud':recovered_hud,'current':current,'currentHud':current_hud,'errors':errors+errors2}
    print(json.dumps(result,sort_keys=True))
    assert recovered['chat']['status']=='running', recovered
    assert recovered['chat']['healthState'] in ('tool-running','working'), recovered
    assert recovered['healthStale'] is False and recovered['healthActive'] is True, recovered
    assert recovered_hud['watchdog']=='7', recovered_hud  # legacy HUD stays Sentinel-owned until a page/content refresh.
    assert recovered_hud['state'] in ('tool-running','working') and recovered_hud['level']=='active', recovered_hud
    assert 'Inspecting ModForge' in recovered_hud['now'], recovered_hud

    assert current['chat']['status']=='running', current
    assert current['chat']['healthState'] in ('tool-running','working'), current
    assert current['healthStale'] is False and current['healthActive'] is True, current
    assert current_hud['title']==before, current_hud  # Sentinel did not race the content-owned HUD.
    assert current_hud['state']=='tool-stalled', current_hud  # stale DOM cannot poison canonical state anymore.
    assert not result['errors'], result['errors']
    browser.close()
