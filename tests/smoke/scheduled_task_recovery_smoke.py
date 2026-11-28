"""A scheduled follow-up requires human permission review; safe resume remains available."""
from playwright.sync_api import sync_playwright
import pathlib, os, json

root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_ROOT',str(pathlib.Path(__file__).resolve().parents[2]/'extension')))
scripts=[(root/name).read_text() for name in ['src/core.js','src/brain-core.js','src/health-core.js','src/provider-health-core.js','src/content.js']]
mock=r'''(() => {
  window.__brain=[];window.__clicks=[];window.__changes=[];
  window.ProjectConstellationProviders={detectProvider:()=>({id:'chatgpt',name:'ChatGPT',home:'https://chatgpt.com/'}),chatIdFromUrl:()=> 'chatgpt:schedule-test',isLikelyChatUrl:()=>true,canonicalChatUrl:(u)=>u,classifyExternalUrl:()=>({kind:'external',provider:'',external:false}),hashString:(v)=>String(v||'').length.toString(36)};
  window.chrome={storage:{local:{get:async()=>({projectConstellationPerformanceSettings:{enabled:true,responsiveScrolling:true,adaptiveMotionRelief:false},projectConstellationBrainSettings:{approvalAutopilot:{enabled:true,acknowledged:true,alwaysAllow:true,fallbackAllowOnce:true,autoRecoverPaused:true},liveHealth:{enabled:false}}}),set:async()=>{}},onChanged:{addListener:(fn)=>__changes.push(fn)}},runtime:{sendMessage:async(msg)=>{if(msg.type==='PC_BRAIN_INGEST_BATCH')__brain.push(...msg.payload);if(msg.type==='PC_LIVE_HEALTH_CONTEXT')return {ok:true,settings:{enabled:false},network:{pending:0,observed:false},latestTurns:[],integrityFindings:[]};return {ok:true};},onMessage:{addListener:(fn)=>window.__listener=fn}}};
})();'''

def scan(page,recover_paused=True):
    return page.evaluate('''(recoverPaused)=>Promise.race([
      new Promise(resolve=>window.__listener({type:'PC_APPROVAL_RECOVERY_SCAN',options:{alwaysAllow:true,fallbackAllowOnce:true,recoverPaused,scheduledTaskRepair:true}},{},resolve)),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('Recovery handler did not answer')),6000))
    ])''',recover_paused)

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox'],executable_path=os.environ.get('PROJECT_CONSTELLATION_CHROMIUM') or None)
    page=browser.new_page(viewport={'width':1280,'height':900});errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.set_content('''<!doctype html><html><body><main id="main">
      <section class="card" id="taskCard"><h3>Minecraft Mod Catalogue Updater</h3><div id="attention">This task needs your attention</div><button id="followup">Follow-up</button></section>
      <section class="card" id="legacyCard"><h3>REPLACED — Minecraft Mod Catalogue Updater — scheduler-poisoned legacy</h3><div>This task needs your attention</div><button>Follow-up</button></section>
      <div id="taskDetailHost"></div></main><textarea id="draft">Preserve this user draft</textarea></body></html>''')
    page.evaluate(mock)
    page.evaluate(r'''() => {
      document.querySelector('#followup').onclick=()=>{
        __clicks.push('followup');
        document.querySelector('#taskDetailHost').innerHTML=`<div role="dialog" id="taskDetail"><h2>Minecraft Mod Catalogue Updater</h2>
          <div role="dialog" id="permission"><h3>Allow ChatGPT to use GitHub?</h3><button id="allow">Allow</button><button id="arrow" aria-haspopup="menu" aria-label="Allow options">⌄</button><button>Deny</button></div>
          <button id="resume">Resume</button></div>`;
        document.querySelector('#arrow').onclick=()=>{__clicks.push('arrow');document.querySelector('#permission').insertAdjacentHTML('beforeend','<button id="always">Always allow for this conversation</button>');document.querySelector('#always').onclick=()=>__clicks.push('always');};
        document.querySelector('#allow').onclick=()=>__clicks.push('allow');
        document.querySelector('#resume').onclick=()=>{__clicks.push('resume');document.querySelector('#attention').textContent='Task active';document.querySelector('#followup').remove();document.querySelector('#taskDetail').remove();};
      };
    }''')
    for source in scripts:page.add_script_tag(content=source)
    page.wait_for_timeout(150)

    initial=scan(page)
    assert initial['ok'] is True and initial['action']=='none',initial
    assert page.evaluate('__clicks')==[],'An ordinary permission scan cannot open a follow-up automatically.'

    # Simulate the user opening the follow-up. The extension must keep permission
    # controls untouched, even with legacy Always Allow settings and visible Resume.
    page.locator('#followup').click()
    review=scan(page);page.wait_for_timeout(200)
    assert review['ok'] is True and review['action']=='manual-review',review
    assert review['automaticRetryForbidden'] is True and review['retryForbidden'] is True
    assert page.evaluate('__clicks')==['followup'],'Permission dropdown, Allow and Resume stay untouched during a hold.'
    assert page.locator('#permission').count()==1
    assert page.input_value('#draft')=='Preserve this user draft'

    # Fixture models the provider clearing a permission after human review. The
    # remaining Resume is safe, explicit scan functionality rather than consent.
    page.evaluate('document.querySelector("#permission").remove()')
    paused=scan(page,False)
    assert paused['action']=='none',paused
    assert page.evaluate('__clicks')==['followup'],'The resume option remains opt-out.'
    resumed=scan(page,True)
    assert resumed['ok'] is True and resumed['action']=='resume',resumed
    assert page.evaluate('__clicks')==['followup','resume']
    assert 'Task active' in page.locator('#taskCard').inner_text()
    assert page.input_value('#draft')=='Preserve this user draft'
    assert 'REPLACED' in page.locator('#legacyCard').inner_text()
    assert page.locator('#legacyCard button').count()==1,'Unrelated legacy tasks remain untouched.'
    assert not errors,errors
    print(json.dumps({'initial':initial['action'],'review':review['action'],'resume_disabled':paused['action'],'resumed':resumed['action'],'clicks':page.evaluate('__clicks'),'permission_clicks':0,'draft_preserved':True,'errors':errors},sort_keys=True))
    browser.close()
