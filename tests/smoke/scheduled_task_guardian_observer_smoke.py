from playwright.sync_api import sync_playwright
import pathlib, json, os

root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_ROOT','/mnt/data/project-constellation/extension')).resolve()
if (root/'extension').is_dir(): root=root/'extension'
probe=(root/'src/scheduled-task-page-probe.js').read_text()
bridge=(root/'src/scheduled-task-observer.js').read_text()
payload={
  'tasks':[{
    'id':'task-1','title':'Morning brief','is_enabled':True,'status':'active','next_run_at':'2026-09-05T14:00:00Z',
    'last_run':{'id':'run-2','status':'completed','completed_at':'2026-09-04T14:00:00Z','result':'PRIVATE RESULT'},
    'prompt':'PRIVATE PROMPT','instructions':'PRIVATE INSTRUCTIONS'
  }],
  'debug':{'message':'PRIVATE MESSAGE','content':'PRIVATE CONTENT'}
}
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox'],executable_path=(os.environ.get('PROJECT_CONSTELLATION_CHROMIUM') or None))
    page=browser.new_page(); errors=[]; page.on('pageerror',lambda exc:errors.append(str(exc)))
    page.set_content('<html><body></body></html>')
    page.evaluate("""()=>{window.__runtimeCalls=[];window.__runtimeListener=null;globalThis.chrome={runtime:{sendMessage:async(msg)=>{window.__runtimeCalls.push(msg);return {ok:true};},onMessage:{addListener:(fn)=>window.__runtimeListener=fn,removeListener:()=>{}}}};window.__originalFetch=window.fetch;}""")
    page.add_script_tag(content=probe); page.add_script_tag(content=bridge)
    rows=page.evaluate('(payload)=>ProjectConstellationScheduledTaskPageProbe.collectTasks(payload)',payload)
    page.evaluate("""(rows)=>window.postMessage({source:'project-constellation-scheduled-task-page-probe',kind:'scheduled-task-snapshot',version:'0.17.8',snapshot:{tasks:rows,source:'network',sourceUrl:'',observedAt:Date.now()}},'*')""",rows)
    page.wait_for_timeout(80)
    calls=page.evaluate('window.__runtimeCalls')
    unchanged=page.evaluate('window.fetch===window.__originalFetch')
    api=page.evaluate("""()=>({version:ProjectConstellationScheduledTaskPageProbe.version,hasDispose:typeof ProjectConstellationScheduledTaskPageProbe.dispose==='function',hasRefreshListener:typeof window.__runtimeListener==='function'})""")
    print(json.dumps({'rows':rows,'calls':calls,'unchangedFetch':unchanged,'api':api,'errors':errors},sort_keys=True))
    assert unchanged is True
    assert rows and rows[0]['id']=='task-1' and rows[0]['title']=='Morning brief' and rows[0]['lastRunId']=='run-2' and rows[0]['lastRunStatus']=='completed'
    assert all(key not in rows[0] for key in ['prompt','instructions','result','content','message','body','text'])
    snapshots=[c for c in calls if c.get('type')=='PC_SCHEDULE_GUARDIAN_TASK_SNAPSHOT']
    assert snapshots and snapshots[-1]['snapshot']['tasks'][0]['id']=='task-1'
    assert api['version']=='0.18.1' and api['hasDispose'] and api['hasRefreshListener']
    assert not errors
    browser.close()
