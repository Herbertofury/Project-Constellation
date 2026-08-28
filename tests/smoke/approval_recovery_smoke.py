from playwright.sync_api import sync_playwright
import pathlib, os, json
root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_ROOT','/mnt/data/project-constellation-v090-work'))
core=(root/'src/core.js').read_text(); brain=(root/'src/brain-core.js').read_text(); health=(root/'src/health-core.js').read_text(); content=(root/'src/content.js').read_text()
mock=r'''(() => {
  const changeListeners=[]; window.__changeListeners=changeListeners; window.__brain=[]; window.__clicks=[];
  window.ProjectConstellationProviders={detectProvider:()=>({id:'chatgpt',name:'ChatGPT',home:'https://chatgpt.com/'}),chatIdFromUrl:()=> 'chatgpt:approval-test',isLikelyChatUrl:()=>true,canonicalChatUrl:(u)=>u,classifyExternalUrl:()=>({kind:'external',provider:'',external:false}),hashString:(v)=>String(v||'').length.toString(36)};
  window.chrome={storage:{local:{get:async(keys)=>({projectConstellationPerformanceSettings:{enabled:true,responsiveScrolling:true,adaptiveMotionRelief:false},projectConstellationBrainSettings:{approvalAutopilot:{enabled:false,acknowledged:false,alwaysAllow:true,fallbackAllowOnce:true,autoRecoverPaused:true},liveHealth:{enabled:false}}}),set:async()=>{}},onChanged:{addListener:(fn)=>changeListeners.push(fn)}},runtime:{sendMessage:async(msg)=>{if(msg.type==='PC_BRAIN_INGEST_BATCH')window.__brain.push(...msg.payload);if(msg.type==='PC_LIVE_HEALTH_CONTEXT')return {ok:true,settings:{enabled:false},network:{pending:0,observed:false},latestTurns:[],integrityFindings:[]};return {ok:true};},onMessage:{addListener:(fn)=>window.__pcMessageListener=fn}}};
})();'''

def message(page, msg):
    return page.evaluate("""(msg)=>new Promise(resolve=>window.__pcMessageListener(msg,null,resolve))""", msg)

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox'],executable_path=(os.environ.get('PROJECT_CONSTELLATION_CHROMIUM') or None))
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

    # A click that ChatGPT does not accept must never be reported as recovered.
    page.evaluate('''() => { window.__clicks=[];const main=document.getElementById('main');main.innerHTML=`<section id="approval"><h2>Allow ChatGPT to use GitHub?</h2><button id="allow">Allow</button><button>Deny</button></section>`;document.getElementById('allow').onclick=()=>window.__clicks.push('unconfirmed-allow');}''')
    unconfirmed=message(page,{'type':'PC_APPROVAL_RECOVERY_SCAN','options':{'alwaysAllow':False,'fallbackAllowOnce':True}})
    assert unconfirmed['ok'] is False and unconfirmed['action']=='failed' and 'unconfirmed' in unconfirmed['strategy']
    assert page.evaluate('window.__clicks.includes("unconfirmed-allow")')

    # Delivery timeout is a first-class interruption. Recovery scanning reports the provider's native Retry, but never clicks it automatically.
    page.evaluate('''() => { window.__clicks=[];const main=document.getElementById('main');main.innerHTML=`<div role="alert" id="deliveryError"><strong>Message delivery timed out. Please try again.</strong><button id="retry">Retry</button></div>`;document.getElementById('retry').onclick=()=>window.__clicks.push('retry'); }''')
    refresh=message(page,{'type':'PC_APPROVAL_RECOVERY_SCAN','options':{'alwaysAllow':True,'fallbackAllowOnce':True,'recoverPaused':True}})
    page.wait_for_timeout(80); refresh_clicks=page.evaluate('window.__clicks.slice()')
    assert refresh['ok'] and refresh['action']=='delivery-timeout' and refresh['strategy']=='native-retry-available' and refresh['retryForbidden'] is False and refresh['automaticRetryForbidden'] is True and refresh['retryAvailable'] is True
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

    # Current ChatGPT DOM variant: the approval is an ordinary card (not a dialog),
    # the chevron is an unlabeled nested icon button, and its menu is portalled.
    # Enabling Autopilot and mounting this card must approve it without a manual scan.
    page.evaluate('''() => {
      window.__clicks=[];document.getElementById('main').innerHTML='';
      for(const listener of window.__changeListeners) listener({projectConstellationBrainSettings:{newValue:{approvalAutopilot:{enabled:true,acknowledged:true,alwaysAllow:true,fallbackAllowOnce:true,autoRecoverPaused:true},liveHealth:{enabled:false}}}},'local');
      const main=document.getElementById('main');
      main.innerHTML=`<section id="currentApproval"><header><h2>Allow ChatGPT to use GitHub?</h2><p>Creates a new GitHub branch from the selected commit SHA.</p><a>See details</a></header><footer><button id="currentDeny">Deny</button><div class="split"><button id="currentAllow">Allow</button><span><button id="currentArrow"><svg aria-hidden="true"><path></path></svg></button></span></div></footer></section>`;
      document.getElementById('currentAllow').onclick=()=>{window.__clicks.push('current-allow');document.getElementById('currentApproval')?.remove();document.getElementById('currentMenu')?.remove();};
      document.getElementById('currentArrow').onclick=()=>{window.__clicks.push('current-arrow');const menu=document.createElement('div');menu.id='currentMenu';menu.setAttribute('role','menu');menu.innerHTML='<div id="currentPersistent" role="menuitem" tabindex="0">Allow GitHub for this conversation</div>';document.body.appendChild(menu);document.getElementById('currentPersistent').onclick=()=>{window.__clicks.push('current-persistent');document.getElementById('currentApproval')?.remove();menu.remove();};};
    }''')
    page.wait_for_function("window.__clicks.includes('current-persistent')",timeout=2400)
    current_clicks=page.evaluate('window.__clicks.slice()')
    assert current_clicks[:2]==['current-arrow','current-persistent']
    assert page.locator('#currentApproval').count()==0

    print(json.dumps({'dropdown':dropdown,'checkbox':checkbox,'fallback':fallback,'unconfirmed':unconfirmed,'refresh':refresh,'refreshClicks':refresh_clicks,'rate':rate,'rateClicks':rate_clicks,'resume':resume,'currentClicks':current_clicks,'errors':errors},sort_keys=True))
    assert not errors
    browser.close()
