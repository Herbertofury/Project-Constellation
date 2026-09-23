from playwright.sync_api import sync_playwright
import pathlib, os, json

root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_ROOT','/mnt/data/project-constellation/extension'))
supervisor=(root/'src/approval-supervisor-background.js').read_text()

mock=r'''(() => {
  window.__tabs=[];
  window.__created=[];
  window.__messages=[];
  window.__alarms=[];
  const noopEvent=()=>({addListener:()=>{},removeListener:()=>{}});
  window.chrome={
    storage:{
      local:{
        get:async()=>({projectConstellationBrainSettings:{approvalAutopilot:{enabled:false,acknowledged:false,alwaysAllow:false,fallbackAllowOnce:false,autoRecoverPaused:false}}})
      },
      onChanged:noopEvent()
    },
    tabs:{
      query:async()=>window.__tabs.slice(),
      create:async(opts)=>{
        const tab={id:41,url:opts.url,status:'complete',active:Boolean(opts.active)};
        window.__tabs.push(tab);
        window.__created.push(opts);
        return tab;
      },
      get:async(id)=>window.__tabs.find(tab=>tab.id===id)||null,
      sendMessage:async(id,msg)=>{
        window.__messages.push({id,msg});
        return {ok:true,action:'scheduled-task-recovered'};
      },
      onUpdated:noopEvent()
    },
    alarms:{
      create:async(name,opts)=>{window.__alarms.push({name,opts});},
      onAlarm:noopEvent()
    },
    runtime:{
      onInstalled:noopEvent(),
      onStartup:noopEvent(),
      onConnect:noopEvent()
    }
  };
})();'''

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox'],executable_path=(os.environ.get('PROJECT_CONSTELLATION_CHROMIUM') or None))
    page=browser.new_page()
    errors=[]
    page.on('pageerror',lambda exc:errors.append(str(exc)))
    page.set_content('<!doctype html><html><body></body></html>')
    page.evaluate(mock)
    page.add_script_tag(content=supervisor)
    page.wait_for_function('window.__messages.length > 0',timeout=3000)

    created=page.evaluate('window.__created.slice()')
    messages=page.evaluate('window.__messages.slice()')
    alarms=page.evaluate('window.__alarms.slice()')

    assert created and created[0]['url']=='https://chatgpt.com/schedules'
    assert created[0]['active'] is False
    assert messages[0]['id']==41
    options=messages[0]['msg']['options']
    assert messages[0]['msg']['type']=='PC_APPROVAL_RECOVERY_SCAN'
    assert options['scheduledTaskRepair'] is True
    assert options['alwaysAllow'] is True
    assert options['fallbackAllowOnce'] is True
    assert options['recoverPaused'] is True
    assert alarms and alarms[0]['name']=='project-constellation-approval-supervisor'
    assert not errors, errors

    print(json.dumps({'created':created,'messages':messages,'alarms':alarms,'errors':errors},sort_keys=True))
    browser.close()
