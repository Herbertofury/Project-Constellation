"""Provider permission variants remain visible and require direct human approval."""
from playwright.sync_api import sync_playwright
import pathlib, os, json

root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_ROOT',str(pathlib.Path(__file__).resolve().parents[2]/'extension')))
scripts=[(root/name).read_text() for name in ['src/core.js','src/brain-core.js','src/health-core.js','src/provider-health-core.js','src/content.js']]
mock=r'''(() => {
  window.__changes=[];window.__clicks=[];window.__brain=[];
  window.ProjectConstellationProviders={detectProvider:()=>({id:'chatgpt',name:'ChatGPT',home:'https://chatgpt.com/'}),chatIdFromUrl:()=> 'chatgpt:approval-test',isLikelyChatUrl:()=>true,canonicalChatUrl:(u)=>u,classifyExternalUrl:()=>({kind:'external',provider:'',external:false}),hashString:(v)=>String(v||'').length.toString(36)};
  window.chrome={storage:{local:{get:async()=>({projectConstellationPerformanceSettings:{enabled:true,responsiveScrolling:true,adaptiveMotionRelief:false},projectConstellationBrainSettings:{approvalAutopilot:{enabled:true,acknowledged:true,alwaysAllow:true,fallbackAllowOnce:true,autoRecoverPaused:true},liveHealth:{enabled:false}}}),set:async()=>{}},onChanged:{addListener:(fn)=>__changes.push(fn)}},runtime:{sendMessage:async(msg)=>{if(msg.type==='PC_BRAIN_INGEST_BATCH')__brain.push(...msg.payload);if(msg.type==='PC_LIVE_HEALTH_CONTEXT')return {ok:true,settings:{enabled:false},network:{pending:0,observed:false},latestTurns:[],integrityFindings:[]};return {ok:true};},onMessage:{addListener:(fn)=>window.__listener=fn}}};
})();'''

def message(page,msg):
    return page.evaluate('(msg)=>new Promise(resolve=>window.__listener(msg,{},resolve))',msg)

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox'],executable_path=os.environ.get('PROJECT_CONSTELLATION_CHROMIUM') or None)
    page=browser.new_page(viewport={'width':1200,'height':800});errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.set_content('<!doctype html><html><body><main id="main"></main><textarea id="draft">A draft the user is writing</textarea></body></html>')
    page.evaluate(mock)
    for script in scripts:page.add_script_tag(content=script)
    page.wait_for_timeout(100)
    fixtures=[
      '<section><h2>Allow ChatGPT to use GitHub?</h2><button>Allow</button><button>Deny</button><button aria-haspopup="menu">More options</button></section>',
      '<div role="dialog"><h2>Allow Example Connector to access this chat?</h2><label><input type="checkbox">Always allow for this conversation</label><button>Allow</button><button>Deny</button></div>',
      '<section><h2>Allow access to drive.google.com</h2><button>Deny</button><button>Allow</button><button><svg></svg></button></section>',
      '<section><h2>Allow access to github.com</h2><button>Deny</button><button>Allow</button><button aria-haspopup="menu"><svg></svg></button></section>',
      '<div role="dialog"><h2>Permission required for GitHub</h2><button>Allow for this conversation</button><button>Deny</button></div>',
      '<div role="dialog"><h2>Allow ChatGPT to use Google Drive?</h2><button>Allow once</button><button>Deny</button></div>',
    ]
    results=[]
    for fixture in fixtures:
      page.evaluate('''(html)=>{__clicks=[];document.querySelector('#main').innerHTML=html;for(const node of document.querySelectorAll('#main button,#main input'))node.addEventListener('click',()=>__clicks.push(node.textContent||'checkbox'));}''',fixture)
      response=message(page,{'type':'PC_APPROVAL_RECOVERY_SCAN','options':{'alwaysAllow':True,'fallbackAllowOnce':True,'recoverPaused':True}})
      assert response['ok'] and response['action']=='manual-review',response
      assert response['automaticRetryForbidden'] is True
      page.wait_for_timeout(250)
      assert page.evaluate('__clicks')==[], 'Saved legacy Autopilot settings must never grant permission.'
      assert page.input_value('#draft')=='A draft the user is writing'
      assert page.locator('#main button').count()>0
      reveal=message(page,{'type':'PC_ATTENTION_REVEAL_PERMISSION'})
      assert reveal['ok'] and reveal['action']=='review-in-provider'
      assert page.evaluate('__clicks')==[]
      results.append({'action':response['action'],'connector':response.get('connector','')})

    for copy,expected in [('Message delivery timed out. Please try again.','delivery-timeout'),('Too many requests. Try again in 2 minutes.','rate-limited')]:
      page.evaluate('''(copy)=>{__clicks=[];document.querySelector('#main').innerHTML='<div role="alert"><strong></strong><button>Retry</button></div>';document.querySelector('strong').textContent=copy;document.querySelector('#main button').onclick=()=>__clicks.push('retry');}''',copy)
      result=message(page,{'type':'PC_APPROVAL_RECOVERY_SCAN','options':{'alwaysAllow':True,'fallbackAllowOnce':True}})
      assert result['action']==expected,result
      assert page.evaluate('__clicks')==[]
    assert not errors,errors
    print(json.dumps({'permission_variants':results,'clicks':0,'draft_preserved':True,'errors':errors}))
    browser.close()
