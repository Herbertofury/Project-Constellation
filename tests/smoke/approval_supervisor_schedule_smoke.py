"""Active scheduled recovery respects permission/draft holds and persists action intent.

The retired approval supervisor is deliberately not loaded. This fixture executes
its canonical replacement with mocked browser APIs, then its real DOM action guard.
"""
from playwright.sync_api import sync_playwright
import pathlib, os, json, re
root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_ROOT',str(pathlib.Path(__file__).resolve().parents[2]/'extension')))
entry=(root/'background-entry.js').read_text()
assert "import './src/scheduled-task-recovery-controller.js'" in entry
assert "import './src/approval-supervisor-background.js'" not in entry
policy=re.sub(r'^export\s+','',(root/'src/scheduled-task-recovery-policy.js').read_text(),flags=re.M)
controller=re.sub(r'^import[^\n]*\n','',(root/'src/scheduled-task-recovery-controller.js').read_text(),flags=re.M)
page_source=(root/'src/scheduled-task-recovery-page.js').read_text()
mock=r'''(() => {
  const configKey='pcx.scheduleRecovery.v2.config',stateKey='pcx.scheduleRecovery.v2';
  window.__bag={[configKey]:{enabled:false}};window.__tabs=[];window.__created=[];window.__actions=[];window.__alarms=[];window.__listeners=[];window.__mode='task';
  const event=()=>({addListener:()=>{}});
  window.chrome={runtime:{id:'fixture',onStartup:event(),onInstalled:event(),onMessage:{addListener:fn=>__listeners.push(fn)}},
    storage:{local:{get:async(keys)=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,structuredClone(__bag[key])])),set:async(values)=>Object.assign(__bag,structuredClone(values))}},
    alarms:{get:async()=>null,create:async(name,options)=>__alarms.push({name,options}),clear:async()=>true,onAlarm:event()},
    scripting:{executeScript:async()=>{throw new Error('Unexpected reinjection');}},
    tabs:{get:async(id)=>{const tab=__tabs.find(row=>row.id===id);if(!tab)throw new Error('Missing tab');return tab;},
      create:async(options)=>{__created.push(options);const tab={id:41,status:'complete',...options};__tabs.push(tab);return tab;},
      sendMessage:async(id,message)=>{
        if(message.type==='PC_SCHEDULE_RECOVERY_ACT'){
          const intents=Object.values(__bag[stateKey]?.incidents||{}).flatMap(row=>Object.values(row.actions||{}));
          __actions.push({id,action:message.action,intentPersisted:intents.some(row=>row.status==='INTENT_PERSISTED')});
          if(message.action.kind==='open-followup')__mode='approval';
          return {ok:true,status:'CLICK_DISPATCHED_NOT_VERIFIED'};
        }
        if(message.type!=='PC_SCHEDULE_RECOVERY_INSPECT')throw new Error('Unexpected message');
        if(__mode==='task')return {tasks:[{id:'task1',runId:'run1',title:'Fixture task',attention:true,openAction:{kind:'open-followup',token:'open'}}]};
        if(__mode==='approval')return {approval:true,action:{kind:'resume',token:'unsafe'}};
        if(__mode==='draft')return {draft:true,action:{kind:'resume',token:'unsafe'}};
        if(__mode==='resume')return {action:{kind:'resume',token:'resume'},fingerprint:'pause-1'};
        if(__mode==='running')return {running:true};
        return {completed:true,tasks:[]};
      }}
  };
  window.__send=message=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Scheduled controller did not answer')),6000);
    for(const listener of __listeners)listener(message,{id:'fixture'},value=>{clearTimeout(timer);resolve(value);});
  });
})();'''
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox'],executable_path=os.environ.get('PROJECT_CONSTELLATION_CHROMIUM') or None)
    page=browser.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.set_content('<!doctype html><html><body></body></html>');page.evaluate(mock)
    page.add_script_tag(content=policy);page.add_script_tag(content=controller);page.wait_for_timeout(100)
    assert page.evaluate('__created.length')==0 and page.evaluate('__actions.length')==0,'Disabled recovery cannot launch or act.'
    page.evaluate('__send({type:"PC_SCHEDULE_RECOVERY_CONFIG",config:{enabled:true}})')
    page.wait_for_function('__bag["pcx.scheduleRecovery.v2"]?.sessions?.[41]?.status==="WAITING_FOR_RUN_EVIDENCE" && __alarms.length>0')
    assert page.evaluate('__created')==[{'url':'https://chatgpt.com/schedules','active':False}]
    assert page.evaluate('__actions.length')==1
    holds=[]
    for mode,expected in [('approval','SECURITY_APPROVAL_REQUIRED'),('draft','USER_DRAFT_PRESENT')]:
        state=page.evaluate('(mode)=>{__mode=mode;return __send({type:"PC_SCHEDULE_RECOVERY_CHECK"});}',mode)
        assert state['sessions']['41']['status']==expected,state
        assert page.evaluate('__actions.length')==1,'A hold blocks Resume even if an action candidate is supplied.'
        holds.append(expected)
    state=page.evaluate('__mode="resume";__send({type:"PC_SCHEDULE_RECOVERY_CHECK"})')
    assert state['sessions']['41']['status']=='WAITING_FOR_RUN_EVIDENCE',state
    assert page.evaluate('__actions.length')==2
    page.evaluate('__send({type:"PC_SCHEDULE_RECOVERY_CHECK"})');assert page.evaluate('__actions.length')==2,'Same incident/action is not dispatched twice.'
    state=page.evaluate('__mode="running";__send({type:"PC_SCHEDULE_RECOVERY_CHECK"})')
    assert state['sessions']['41']['status']=='RUNNING_OBSERVED',state
    state=page.evaluate('__mode="completed";__send({type:"PC_SCHEDULE_RECOVERY_CHECK"})')
    assert not state['sessions'],state
    actions=page.evaluate('__actions');alarms=page.evaluate('__alarms')
    assert all(row['intentPersisted'] for row in actions)
    assert all('periodInMinutes' not in row['options'] and row['options']['delayInMinutes']>=2 for row in alarms),'Fallback remains adaptive and one-shot.'

    # Run actual scheduled-page controls. Consent, drafts and state changes between
    # inspection and dispatch all block action; stale tokens cannot be replayed.
    dom=browser.new_page();dom.on('pageerror',lambda error:errors.append(str(error)))
    fixture='''<!doctype html><html><head><title>Fixture task</title></head><body><main>
      <article data-task-id="task1" data-run-id="run1"><h3>Fixture task</h3><p>This task needs your attention.</p><button id="followup">Follow-up</button></article><div id="detail"></div>
      </main><script>window.__clicks=[];document.querySelector('#followup').onclick=()=>{__clicks.push('followup');document.querySelector('#detail').innerHTML='<div role="dialog"><h2>Fixture task</h2><p>Resume the task after an interrupted response.</p><div id="permission">Permission required <button id="allow">Allow for this conversation</button></div><textarea id="draft"></textarea><button id="resume">Resume</button></div>';document.querySelector('#allow').onclick=()=>__clicks.push('allow');document.querySelector('#resume').onclick=()=>__clicks.push('resume');};</script></body></html>'''
    dom.route('https://chatgpt.com/**',lambda route:route.fulfill(status=200,content_type='text/html',body=fixture))
    dom.goto('https://chatgpt.com/schedules');dom.evaluate('window.chrome={runtime:{id:"fixture",sendMessage:async()=>({ok:true}),onMessage:{addListener:()=>{}}}}')
    dom.add_script_tag(content=page_source)
    active={'id':'task1','title':'Fixture task','runId':'run1'}
    opened=dom.evaluate('async()=>{const x=PCXScheduleRecoveryPage.inspect();return PCXScheduleRecoveryPage.act(x.tasks[0].openAction);}');assert opened['ok'] is True
    inspection=dom.evaluate('(active)=>PCXScheduleRecoveryPage.inspect(active)',active);assert inspection['approval'] is True and inspection['action'] is None
    dom.evaluate('document.querySelector("#permission").remove();document.querySelector("#draft").value="Keep my draft"')
    inspection=dom.evaluate('(active)=>PCXScheduleRecoveryPage.inspect(active)',active);assert inspection['draft'] is True and inspection['action'] is None
    dom.evaluate('document.querySelector("#draft").value=""')
    action=dom.evaluate('(active)=>PCXScheduleRecoveryPage.inspect(active).action',active);assert action['kind']=='resume'
    dom.evaluate('document.querySelector("[role=dialog]").insertAdjacentHTML("afterbegin","<div id=permission>Permission required <button>Allow</button></div>")')
    rejected=dom.evaluate('([action,active])=>PCXScheduleRecoveryPage.act(action,active)',[action,active]);assert rejected['ok'] is False and rejected['reason']=='STATE_CHANGED_OR_APPROVAL',rejected
    assert dom.evaluate('__clicks')==['followup']
    dom.evaluate('document.querySelector("#permission").remove()')
    action=dom.evaluate('(active)=>PCXScheduleRecoveryPage.inspect(active).action',active)
    resumed=dom.evaluate('([action,active])=>PCXScheduleRecoveryPage.act(action,active)',[action,active]);assert resumed['status']=='CLICK_DISPATCHED_NOT_VERIFIED'
    replay=dom.evaluate('([action,active])=>PCXScheduleRecoveryPage.act(action,active)',[action,active]);assert replay['ok'] is False and replay['reason']=='STALE_CONTROL'
    assert dom.evaluate('__clicks')==['followup','resume']
    assert not errors,errors
    print(json.dumps({'implementation':'active scheduled recovery v2','holds':holds,'actions':actions,'one_shot_alarms':len(alarms),'dom_clicks':dom.evaluate('__clicks'),'permission_clicks':0,'stale_token_rejected':True,'errors':errors},sort_keys=True))
    browser.close()
