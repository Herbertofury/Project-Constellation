from playwright.sync_api import sync_playwright
import pathlib, os, json

root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_ROOT','/mnt/data/project-constellation/extension'))
core=(root/'src/core.js').read_text()
brain=(root/'src/brain-core.js').read_text()
health=(root/'src/health-core.js').read_text()
content=(root/'src/content.js').read_text()

mock=r'''(() => {
  window.__brain=[]; window.__clicks=[]; window.__changeListeners=[];
  window.ProjectConstellationProviders={
    detectProvider:()=>({id:'chatgpt',name:'ChatGPT',home:'https://chatgpt.com/'}),
    chatIdFromUrl:()=> 'chatgpt:schedule-test',
    isLikelyChatUrl:()=>true,
    canonicalChatUrl:(u)=>u,
    classifyExternalUrl:()=>({kind:'external',provider:'',external:false}),
    hashString:(v)=>String(v||'').length.toString(36)
  };
  window.chrome={
    storage:{
      local:{
        get:async()=>({
          projectConstellationPerformanceSettings:{enabled:true,responsiveScrolling:true,adaptiveMotionRelief:false},
          projectConstellationBrainSettings:{approvalAutopilot:{enabled:false,acknowledged:false,alwaysAllow:true,fallbackAllowOnce:true,autoRecoverPaused:true},liveHealth:{enabled:false}}
        }),
        set:async()=>{}
      },
      onChanged:{addListener:(fn)=>window.__changeListeners.push(fn)}
    },
    runtime:{
      sendMessage:async(msg)=>{
        if(msg.type==='PC_BRAIN_INGEST_BATCH') window.__brain.push(...msg.payload);
        if(msg.type==='PC_LIVE_HEALTH_CONTEXT') return {ok:true,settings:{enabled:false},network:{pending:0,observed:false},latestTurns:[],integrityFindings:[]};
        return {ok:true};
      },
      onMessage:{addListener:(fn)=>window.__pcMessageListener=fn}
    }
  };
})();'''

def message(page, msg):
    return page.evaluate("""(msg)=>new Promise(resolve=>window.__pcMessageListener(msg,null,resolve))""", msg)

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox'],executable_path=(os.environ.get('PROJECT_CONSTELLATION_CHROMIUM') or None))
    page=browser.new_page(viewport={'width':1280,'height':900})
    errors=[]
    page.on('pageerror',lambda exc:errors.append(str(exc)))
    page.set_content('<!doctype html><html><body><main id="main"></main></body></html>')
    page.evaluate(mock)
    page.add_script_tag(content=core)
    page.add_script_tag(content=brain)
    page.add_script_tag(content=health)
    page.add_script_tag(content=content)
    page.wait_for_timeout(120)

    page.evaluate(r'''() => {
      const main=document.getElementById('main');
      main.innerHTML=`
        <section class="card" id="taskCard">
          <h3>Minecraft Mod Catalogue Updater</h3>
          <div id="attention">This task needs your attention</div>
          <button id="followup">Follow-up</button>
        </section>
        <section class="card" id="legacyCard">
          <h3>REPLACED — Minecraft Mod Catalogue Updater — scheduler-poisoned legacy</h3>
          <div>This task needs your attention</div>
          <button>Follow-up</button>
        </section>
        <div id="taskDetailHost"></div>
      `;

      document.getElementById('followup').onclick=()=>{
        window.__clicks.push('followup');
        const host=document.getElementById('taskDetailHost');
        host.innerHTML=`
          <div role="dialog" id="taskDetail">
            <h2>Minecraft Mod Catalogue Updater</h2>
            <div role="dialog" id="permission">
              <h3>Allow ChatGPT to use GitHub?</h3>
              <button id="allow">Allow</button>
              <button id="arrow" aria-haspopup="menu" aria-label="Allow options">⌄</button>
              <button>Deny</button>
            </div>
            <button id="resume" hidden>Resume</button>
          </div>`;

        document.getElementById('arrow').onclick=()=>{
          window.__clicks.push('arrow');
          let menu=document.getElementById('permissionMenu');
          if(menu) return;
          menu=document.createElement('div');
          menu.id='permissionMenu';
          menu.setAttribute('role','menu');
          menu.innerHTML='<button id="always" role="menuitem">Always allow for this conversation</button>';
          document.body.appendChild(menu);
          document.getElementById('always').onclick=()=>{
            window.__clicks.push('always');
            menu.remove();
          };
        };
        document.getElementById('allow').onclick=()=>{
          window.__clicks.push('allow');
          document.getElementById('permission').remove();
          document.getElementById('resume').hidden=false;
        };
        document.getElementById('resume').onclick=()=>{
          window.__clicks.push('resume');
          document.getElementById('attention').textContent='Task active';
          document.getElementById('followup').remove();
          document.getElementById('taskDetail').remove();
        };
      };
    }''')

    result=message(page,{
      'type':'PC_APPROVAL_RECOVERY_SCAN',
      'options':{
        'alwaysAllow':True,
        'fallbackAllowOnce':True,
        'recoverPaused':True,
        'scheduledTaskRepair':True
      }
    })
    page.wait_for_timeout(250)
    clicks=page.evaluate('window.__clicks.slice()')
    card_text=page.locator('#taskCard').inner_text()
    legacy_text=page.locator('#legacyCard').inner_text()

    assert result['ok'] is True
    assert result['action']=='scheduled-task-recovered', result
    assert clicks[:5]==['followup','arrow','always','allow','resume'], clicks
    assert 'Task active' in card_text
    assert 'needs your attention' not in card_text.lower()
    assert 'REPLACED' in legacy_text
    assert page.locator('#legacyCard button').count()==1
    assert not errors, errors

    print(json.dumps({'result':result,'clicks':clicks,'card':card_text,'legacy':legacy_text,'errors':errors},sort_keys=True))
    browser.close()
