from playwright.sync_api import sync_playwright
import pathlib, os, json
root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_ROOT','/mnt/data/project-constellation-v090-work'))
core=(root/'src/core.js').read_text(); brain=(root/'src/brain-core.js').read_text(); health=(root/'src/health-core.js').read_text(); content=(root/'src/content.js').read_text()
mock=r'''(() => {
  const changeListeners=[]; window.__brain=[]; window.__clicks=[];
  window.ProjectConstellationProviders={detectProvider:()=>({id:'chatgpt',name:'ChatGPT',home:'https://chatgpt.com/'}),chatIdFromUrl:()=> 'chatgpt:approval-test',isLikelyChatUrl:()=>true,canonicalChatUrl:(u)=>u,classifyExternalUrl:()=>({kind:'external',provider:'',external:false}),hashString:(v)=>String(v||'').length.toString(36)};
  window.chrome={storage:{local:{get:async(keys)=>({projectConstellationPerformanceSettings:{enabled:true,responsiveScrolling:true,adaptiveMotionRelief:false},projectConstellationBrainSettings:{approvalAutopilot:{enabled:false,acknowledged:false,alwaysAllow:true,fallbackAllowOnce:true,autoRecoverPaused:true},liveHealth:{enabled:false}}}),set:async()=>{}},onChanged:{addListener:(fn)=>changeListeners.push(fn)}},runtime:{sendMessage:async(msg)=>{if(msg.type==='PC_BRAIN_INGEST_BATCH')window.__brain.push(...msg.payload);if(msg.type==='PC_LIVE_HEALTH_CONTEXT')return {ok:true,settings:{enabled:false},network:{pending:0,observed:false},latestTurns:[],integrityFindings:[]};return {ok:true};},onMessage:{addListener:(fn)=>window.__pcMessageListener=fn}}};
})();'''

def message(page, msg):
    return page.evaluate("""(msg)=>new Promise(resolve=>window.__pcMessageListener(msg,null,resolve))""", msg)

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1200,'height':800}); errors=[]; page.on('pageerror',lambda exc:errors.append(str(exc)))
    page.set_content('''<!doctype html><html><body><main id="main"></main></body></html>''')
    page.evaluate(mock);page.add_script_tag(content=core);page.add_script_tag(content=brain);page.add_script_tag(content=health);page.add_script_tag(content=content);page.wait_for_timeout(100)

    # Exact screenshot-shaped flow: "Allow ChatGPT to use GitHub?" + Allow + chevron.
    # This fixture models the tougher variant where selecting the persistent option
    # changes the preference but the current action still needs the main Allow click.
    page.evaluate('''() => {
      const main=document.getElementById('main');
      main.innerHTML=`<div role="dialog" id="approval"><h2>Allow ChatGPT to use GitHub?</h2><p>This allows ChatGPT to access your GitHub resources.</p><p>Future prompts may be controlled from this menu.</p><div id="actions"><button id="allow">Allow</button><button id="arrow" aria-haspopup="menu" aria-label="Allow options">⌄</button><button>Deny</button></div></div>`;
      document.getElementById('allow').onclick=()=>{window.__clicks.push('allow');document.getElementById('approval')?.remove();document.getElementById('approval-menu')?.remove();};
      document.getElementById('arrow').onclick=()=>{window.__clicks.push('arrow');const menu=document.createElement('div');menu.id='approval-menu';menu.setAttribute('role','menu');menu.innerHTML='<button id="always" role="menuitem">Always allow for this conversation</button><button role="menuitem">Allow low-risk actions</button>';document.body.appendChild(menu);document.getElementById('always').onclick=()=>{window.__clicks.push('always');menu.remove();};};
    }''')
    dropdown=message(page,{'type':'PC_APPROVAL_RECOVERY_SCAN','options':{'alwaysAllow':True,'fallbackAllowOnce':True,'recoverPaused':True}})
    page.wait_for_timeout(280)
    clicks1=page.evaluate('window.__clicks.slice()')
    assert dropdown['ok'] and dropdown['action']=='always-allow' and dropdown['strategy']=='dropdown-persistent+allow'
    assert 'arrow' in clicks1 and 'always' in clicks1 and 'allow' in clicks1
    assert dropdown['connector']=='GitHub'

    # Checkbox-style persistent UI.
    page.evaluate('''() => { window.__clicks=[];const main=document.getElementById('main');main.innerHTML=`<div role="dialog" id="approval"><h2>Allow Google Drive Connector to access Drive for this chat?</h2><label id="alwaysLabel"><input id="alwaysCheck" type="checkbox">Always allow for this conversation</label><button id="allow">Allow</button><button>Deny</button></div>`;document.getElementById('alwaysLabel').onclick=()=>window.__clicks.push('checkbox');document.getElementById('allow').onclick=()=>{window.__clicks.push('allow');document.getElementById('approval')?.remove();};}''')
    checkbox=message(page,{'type':'PC_APPROVAL_RECOVERY_SCAN','options':{'alwaysAllow':True,'fallbackAllowOnce':True}})
    page.wait_for_timeout(160); clicks2=page.evaluate('window.__clicks.slice()')
    assert checkbox['ok'] and checkbox['action']=='always-allow' and checkbox['strategy']=='checkbox+allow'
    assert 'allow' in clicks2

    # Persistent option unavailable -> Allow once fallback.
    page.evaluate('''() => { window.__clicks=[];const main=document.getElementById('main');main.innerHTML=`<div role="dialog" id="approval"><h2>Allow Example Connector to access this chat?</h2><button id="allow">Allow</button><button>Deny</button></div>`;document.getElementById('allow').onclick=()=>{window.__clicks.push('allow');document.getElementById('approval')?.remove();};}''')
    fallback=message(page,{'type':'PC_APPROVAL_RECOVERY_SCAN','options':{'alwaysAllow':True,'fallbackAllowOnce':True}})
    page.wait_for_timeout(100); clicks3=page.evaluate('window.__clicks.slice()')
    assert fallback['ok'] and fallback['action']=='allow-once' and 'allow' in clicks3

    # Delivery timeout / connection interruption is NEVER a Retry click. It is a browser-refresh recovery class.
    page.evaluate('''() => { window.__clicks=[];const main=document.getElementById('main');main.innerHTML=`<div role="alert" id="deliveryError"><strong>Message delivery timed out. Please try again.</strong><button id="retry">Retry</button></div>`;document.getElementById('retry').onclick=()=>window.__clicks.push('retry'); }''')
    refresh=message(page,{'type':'PC_APPROVAL_RECOVERY_SCAN','options':{'alwaysAllow':True,'fallbackAllowOnce':True,'recoverPaused':True}})
    page.wait_for_timeout(80); refresh_clicks=page.evaluate('window.__clicks.slice()')
    assert refresh['ok'] and refresh['action']=='refresh-required' and refresh['strategy']=='browser-refresh' and refresh['retryForbidden'] is True
    assert 'retry' not in refresh_clicks

    # Provider rate limits enter a shared cooldown. They NEVER click Retry either.
    page.evaluate('''() => { window.__clicks=[];const main=document.getElementById('main');main.innerHTML=`<div role="alert" id="rateError"><strong>Too many requests. Try again in 2 minutes.</strong><button id="retry">Retry</button></div>`;document.getElementById('retry').onclick=()=>window.__clicks.push('retry'); }''')
    rate=message(page,{'type':'PC_APPROVAL_RECOVERY_SCAN','options':{'alwaysAllow':True,'fallbackAllowOnce':True,'recoverPaused':True}})
    page.wait_for_timeout(80); rate_clicks=page.evaluate('window.__clicks.slice()')
    assert rate['ok'] and rate['action']=='rate-limited' and rate['strategy']=='provider-cooldown' and rate['retryForbidden'] is True
    assert 115000 <= rate['waitMs'] <= 125000 and 'retry' not in rate_clicks

    # Safe stale/paused recovery.
    page.evaluate('''() => { window.__clicks=[];const main=document.getElementById('main');main.innerHTML='<button id="resume">Continue generating</button>';document.getElementById('resume').onclick=()=>window.__clicks.push('resume'); }''')
    resume=message(page,{'type':'PC_APPROVAL_RECOVERY_SCAN','options':{'alwaysAllow':True,'fallbackAllowOnce':True,'recoverPaused':True}})
    assert resume['ok'] and resume['action']=='resume' and page.evaluate('window.__clicks.includes("resume")')

    print(json.dumps({'dropdown':dropdown,'checkbox':checkbox,'fallback':fallback,'refresh':refresh,'refreshClicks':refresh_clicks,'rate':rate,'rateClicks':rate_clicks,'resume':resume,'errors':errors},sort_keys=True))
    assert not errors
    browser.close()
