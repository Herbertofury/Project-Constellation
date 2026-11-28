from playwright.sync_api import sync_playwright
import json, pathlib, os

root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_ROOT','/mnt/data/project-constellation'))
health=(root/'src/health-core.js').read_text()
sentinel=(root/'src/live-sentinel.js').read_text().replace("const host = location.hostname.toLowerCase();", "const host = 'chatgpt.com';", 1)
html='''<!doctype html><html><head><title>Review hold test</title></head><body><main id="main"><article data-testid="conversation-turn-1" data-turn="user"><div data-message-author-role="user">Please finish the release verification.</div></article><div id="reviewHold" class="text-token-text-secondary">Our systems are thinking a bit more about this request before responding. You can retry with a faster model for a quick response, though it may be less capable of handling complex requests. Learn more</div></main></body></html>'''
mock=r'''(() => {
  window.__pcPushes=[];
  window.chrome={
    runtime:{id:'pc-review-test',sendMessage:async(msg)=>{if(msg?.type==='PC_LIVE_CHAT_STATE_PUSH')window.__pcPushes.push(structuredClone(msg.state));return {ok:true};}},
    storage:{local:{get:async()=>({projectConstellationBrainSettings:{liveHealth:{enabled:true}}})}}
  };
})();'''

with sync_playwright() as p:
    launch={'headless':True,'args':['--no-sandbox']}; chromium=os.environ.get('PROJECT_CONSTELLATION_CHROMIUM','').strip(); launch.update({'executable_path':chromium} if chromium else {})
    browser=p.chromium.launch(**launch); page=browser.new_page(); errors=[]; page.on('pageerror',lambda exc:errors.append(str(exc)))
    page.set_content(html,wait_until='domcontentloaded'); page.evaluate(mock); page.add_script_tag(content=health); page.add_script_tag(content=sentinel); page.wait_for_timeout(220)
    held=page.evaluate("ProjectConstellationLiveSentinel.getState(true)")
    page.evaluate("document.getElementById('reviewHold').remove()")
    page.wait_for_timeout(260)
    cleared=page.evaluate("ProjectConstellationLiveSentinel.getState(true)")
    pushes=page.evaluate("window.__pcPushes.map(s=>({status:s.chat?.status,healthState:s.chat?.healthState,healthHold:s.healthHold,source:s.generation?.source,generationPhase:s.generation?.phase}))")
    diag=page.evaluate("ProjectConstellationLiveSentinel.diagnostics()")
    print(json.dumps({'held':{'status':held.get('chat',{}).get('status'),'healthState':held.get('chat',{}).get('healthState'),'healthHold':held.get('healthHold'),'healthStale':held.get('healthStale'),'source':held.get('generation',{}).get('source'),'phase':held.get('generation',{}).get('phase')},'cleared':{'status':cleared.get('chat',{}).get('status'),'healthState':cleared.get('chat',{}).get('healthState'),'healthHold':cleared.get('healthHold'),'healthStale':cleared.get('healthStale'),'source':cleared.get('generation',{}).get('source')},'pushes':pushes,'diagnostics':{'stableStatus':diag.get('stableStatus'),'transitionCount':diag.get('transitionCount')},'errors':errors},sort_keys=True))
    assert held['chat']['status']=='provider-review', held
    assert held['chat']['healthState']=='provider-review', held
    assert held['healthHold'] is True and held['healthStale'] is False, held
    assert held['generation']['source']=='provider-review-surface' and held['generation']['phase']=='review-hold', held
    assert cleared['chat']['status']!='provider-review' and cleared['chat']['healthState']!='provider-review', cleared
    assert cleared['healthHold'] is False, cleared
    assert any(row['status']=='provider-review' and row['healthHold'] is True for row in pushes), pushes
    assert any(row['status']!='provider-review' for row in pushes), pushes
    assert not errors, errors
    browser.close()
