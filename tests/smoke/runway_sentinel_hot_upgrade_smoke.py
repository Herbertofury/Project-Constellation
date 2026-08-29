from playwright.sync_api import sync_playwright
import json, pathlib, os

root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_ROOT','/mnt/data/project-constellation'))
health=(root/'src/health-core.js').read_text()
sentinel=(root/'src/live-sentinel.js').read_text()
base='''<!doctype html><html><body><main id="main"></main></body></html>'''
mock=r'''(() => {
  window.__clock=Date.now(); Date.now=()=>window.__clock;
  window.__messages=[]; window.__listeners=[]; window.__storageListeners=[];
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
  window.__send=(msg)=>new Promise((resolve)=>{let resolved=false;for(const fn of window.__listeners){const keep=fn(msg,{},(value)=>{if(!resolved){resolved=true;resolve(value);}});if(keep===true)return;}setTimeout(()=>{if(!resolved)resolve(undefined);},10);});
  window.__oldHud=()=>{const host=document.createElement('div');host.id='projectConstellationHealthHud';const shadow=host.attachShadow({mode:'open'});shadow.innerHTML='<div id="pcHealthTitle">Legacy health</div><div id="pcHealthMini">legacy renderer</div><div id="pcHealthNowTitle">Legacy now</div><div id="pcHealthNowDetail"></div><div id="pcHealthActivity">model</div><div id="pcHealthTool">—</div><div id="pcHealthCapacity">clear</div><button id="pcHealthHandoff" hidden>Handoff</button>';document.documentElement.appendChild(host);return host;};
})();'''

with sync_playwright() as p:
    launch={'headless':True,'args':['--no-sandbox']}
    chromium=os.environ.get('PROJECT_CONSTELLATION_CHROMIUM','').strip()
    if chromium: launch['executable_path']=chromium
    browser=p.chromium.launch(**launch)

    # Scenario 1: an already-open legacy tab must gain the v7 watchdog without refresh.
    page=browser.new_page(); errors=[]; page.on('pageerror',lambda exc:errors.append(str(exc)))
    page.set_content(base,wait_until='load'); page.evaluate(mock)
    page.evaluate("""() => { const main=document.getElementById('main'); main.innerHTML='<section data-testid="conversation-turn-1"><div data-message-author-role="user" data-message-id="u1">Build this.</div></section><div id="progress" class="text-token-text-tertiary">Inspecting project state</div>'; __oldHud(); }""")
    page.add_script_tag(content=health); page.add_script_tag(content=sentinel); page.wait_for_timeout(180)
    first=page.evaluate("__send({type:'PC_GET_LIVE_SENTINEL_STATE'})")
    page.evaluate("window.__clock += 121000")
    stalled=page.evaluate("__send({type:'PC_GET_LIVE_SENTINEL_STATE'})")
    stalled_hud=page.evaluate("""() => { const h=document.getElementById('projectConstellationHealthHud'); const s=h.shadowRoot; return {state:h.dataset.state,level:h.dataset.level,title:s.getElementById('pcHealthTitle').textContent,detail:s.getElementById('pcHealthNowDetail').textContent}; }""")

    # Scenario 2: the same hot-upgrade path must catch a long pre-existing chat from
    # the full mounted history, rather than resetting the runway counter at injection.
    page2=browser.new_page(); errors2=[]; page2.on('pageerror',lambda exc:errors2.append(str(exc)))
    page2.set_content(base,wait_until='load'); page2.evaluate(mock)
    page2.evaluate("""() => { const main=document.getElementById('main'); for(let i=0;i<270;i++){const sec=document.createElement('section');sec.setAttribute('data-testid',`conversation-turn-${i+1}`);const role=i%2===0?'user':'assistant';sec.innerHTML=`<div data-message-author-role="${role}" data-message-id="m${i}">${role==='user'?'Continue the project.':'Completed response.'}${role==='assistant'?'<button aria-label="Copy">Copy</button>':''}</div>`;main.appendChild(sec);} __oldHud(); }""")
    page2.add_script_tag(content=health); page2.add_script_tag(content=sentinel); page2.wait_for_timeout(180)
    runway=page2.evaluate("__send({type:'PC_GET_LIVE_SENTINEL_STATE'})")
    runway_hud=page2.evaluate("""() => { const h=document.getElementById('projectConstellationHealthHud'); const s=h.shadowRoot; return {state:h.dataset.state,level:h.dataset.level,capacity:h.dataset.capacity,title:s.getElementById('pcHealthTitle').textContent,capacityText:s.getElementById('pcHealthCapacity').textContent,handoffHidden:s.getElementById('pcHealthHandoff').hidden}; }""")

    # Scenario 3: warn materially before the terminal provider banner. This is the
    # exact failure class that v0.14.11 exists to prevent.
    page3=browser.new_page(); errors3=[]; page3.on('pageerror',lambda exc:errors3.append(str(exc)))
    page3.set_content(base,wait_until='load'); page3.evaluate(mock)
    page3.evaluate("""() => { const main=document.getElementById('main'); for(let i=0;i<130;i++){const sec=document.createElement('section');sec.setAttribute('data-testid',`conversation-turn-${i+1}`);const role=i%2===0?'user':'assistant';sec.innerHTML=`<div data-message-author-role="${role}" data-message-id="e${i}">${role==='user'?'Keep developing the project.':'Verified progress.'}${role==='assistant'?'<button aria-label="Copy">Copy</button>':''}</div>`;main.appendChild(sec);} __oldHud(); }""")
    page3.add_script_tag(content=health); page3.add_script_tag(content=sentinel); page3.wait_for_timeout(180)
    early=page3.evaluate("__send({type:'PC_GET_LIVE_SENTINEL_STATE'})")

    # Scenario 4: recognize ChatGPT's current exact terminal copy as a hard limit.
    page4=browser.new_page(); errors4=[]; page4.on('pageerror',lambda exc:errors4.append(str(exc)))
    page4.set_content(base,wait_until='load'); page4.evaluate(mock)
    page4.evaluate("""() => { const main=document.getElementById('main'); const sec=document.createElement('section'); sec.setAttribute('data-testid','conversation-turn-1'); sec.innerHTML='<div data-message-author-role="user" data-message-id="u1">Continue.</div>'; main.appendChild(sec); const alert=document.createElement('div'); alert.setAttribute('role','alert'); alert.textContent="You've reached the maximum length for this conversation, but you can keep talking by starting a new chat."; main.appendChild(alert); __oldHud(); }""")
    page4.add_script_tag(content=health); page4.add_script_tag(content=sentinel); page4.wait_for_timeout(180)
    hard_limit=page4.evaluate("__send({type:'PC_GET_LIVE_SENTINEL_STATE'})")

    result={'first':first,'stalled':stalled,'stalledHud':stalled_hud,'runway':runway,'runwayHud':runway_hud,'early':early,'hardLimit':hard_limit,'errors':errors+errors2+errors3+errors4}
    print(json.dumps(result,sort_keys=True))
    assert first['chat']['status']=='running' and first['chat']['healthState'] in ('tool-running','working'), first
    assert stalled['chat']['status']=='running' and stalled['chat']['healthState']=='tool-stalled', stalled
    assert stalled['healthStale'] is True and stalled['healthActive'] is False
    assert stalled_hud['state']=='tool-stalled' and stalled_hud['level']=='danger', stalled_hud
    assert 'stuck' in stalled_hud['title'].lower() or 'stall' in stalled_hud['title'].lower(), stalled_hud
    assert runway['chat']['status']=='idle' and runway['chat']['healthState']=='capacity-handoff', runway
    assert runway['generation']['capacityTurnCount'] >= 260, runway
    assert runway_hud['state']=='capacity-handoff' and runway_hud['capacity']=='handoff', runway_hud
    assert runway_hud['handoffHidden'] is False, runway_hud
    assert 'runway' in runway_hud['title'].lower() or 'handoff' in runway_hud['title'].lower(), runway_hud
    assert early['chat']['healthState']=='capacity-watch', early
    assert early['generation']['capacityTurnCount'] >= 120, early
    assert hard_limit['chat']['healthState']=='capacity-reached', hard_limit
    assert hard_limit['generation']['capacityState']=='reached', hard_limit
    assert not result['errors'], result['errors']
    browser.close()
