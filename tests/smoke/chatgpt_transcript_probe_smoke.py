from playwright.sync_api import sync_playwright
import json, pathlib, os

root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_ROOT','/mnt/data/project-constellation'))
probe=(root/'src/chatgpt-page-probe.js').read_text()
conversation_id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

user={'id':'u-current','parent':None,'children':['a-current'],'message':{'id':'u-current','author':{'role':'user'},'status':'finished_successfully','end_turn':False,'metadata':{}}}
running={'id':conversation_id,'current_node':'a-current','mapping':{
  'u-current':user,
  'a-current':{'id':'a-current','parent':'u-current','children':[],'message':{'id':'a-current','author':{'role':'assistant'},'status':'in_progress','end_turn':False,'metadata':{'model_slug':'gpt-5.6-sol'}}}
}}
finished={'id':conversation_id,'current_node':'a-current','mapping':{
  'u-current':user,
  'a-current':{'id':'a-current','parent':'u-current','children':[],'message':{'id':'a-current','author':{'role':'assistant'},'status':'finished_successfully','end_turn':True,'metadata':{'model_slug':'gpt-5.6-sol','is_complete':True}}}
}}
deep={'id':conversation_id,'current_node':'tool2','mapping':{
  'u-current':{'id':'u-current','parent':None,'children':['tool1'],'message':user['message']},
  'tool1':{'id':'tool1','parent':'u-current','children':['tool2'],'message':{'id':'tool1','author':{'role':'tool','name':'research_kickoff_tool.start_research_task'},'status':'finished_successfully','end_turn':False,'metadata':{'async_task_id':'deepresch_test','chatgpt_sdk.widget_state':{'status':'running','progress':{'percent':42}}}}},
  'tool2':{'id':'tool2','parent':'tool1','children':[],'message':{'id':'tool2','author':{'role':'assistant'},'status':'in_progress','end_turn':False,'metadata':{'model_slug':'gpt-5.6-sol'}}}
}}

failed={'id':conversation_id,'current_node':'a-current','mapping':{
  'u-current':user,
  'a-current':{'id':'a-current','parent':'u-current','children':[],'message':{'id':'a-current','author':{'role':'assistant'},'status':'failed','end_turn':False,'metadata':{'model_slug':'gpt-5.6-sol'}}}
}}
waiting={'id':conversation_id,'current_node':'a-current','mapping':{
  'u-current':user,
  'a-current':{'id':'a-current','parent':'u-current','children':[],'message':{'id':'a-current','author':{'role':'assistant'},'status':'requires_action','end_turn':False,'metadata':{'model_slug':'gpt-5.6-sol'}}}
}}
no_progress={'id':conversation_id,'current_node':'tool2','mapping':{
  'u-current':{'id':'u-current','parent':None,'children':['tool1'],'message':user['message']},
  'tool1':{'id':'tool1','parent':'u-current','children':['tool2'],'message':{'id':'tool1','author':{'role':'tool','name':'research_kickoff_tool.start_research_task'},'status':'finished_successfully','end_turn':False,'metadata':{'async_task_id':'deepresch_null','chatgpt_sdk.widget_state':{'status':'running'}}}},
  'tool2':{'id':'tool2','parent':'tool1','children':[],'message':{'id':'tool2','author':{'role':'assistant'},'status':'in_progress','end_turn':False,'metadata':{'model_slug':'gpt-5.6-sol'}}}
}}

with sync_playwright() as p:
    launch={'headless':True,'args':['--no-sandbox']}
    chromium=os.environ.get('PROJECT_CONSTELLATION_CHROMIUM','').strip()
    if chromium: launch['executable_path']=chromium
    browser=p.chromium.launch(**launch); page=browser.new_page(); errors=[]; page.on('pageerror',lambda exc:errors.append(str(exc)))
    page.set_content('<!doctype html><html><body></body></html>',wait_until='load')
    page.evaluate("""() => {
      window.__conversation=null; window.__fetches=[];
      window.fetch=async (url, options={})=>{
        window.__fetches.push({url:String(url),headers:Object.keys(options.headers||{})});
        if(String(url).includes('/backend-api/conversation/')) return new Response(JSON.stringify(window.__conversation),{status:200,headers:{'content-type':'application/json'}});
        if(String(url).includes('/api/auth/session')) return new Response(JSON.stringify({accessToken:'SECRET_MUST_STAY_IN_MAIN_WORLD'}),{status:200,headers:{'content-type':'application/json'}});
        return new Response('{}',{status:404});
      };
    }""")
    page.add_script_tag(content=probe)
    page.evaluate('(data)=>window.__conversation=data',running)
    running_state=page.evaluate(f"ProjectConstellationChatGPTPageProbe.readTranscript('{conversation_id}', true)")
    page.evaluate('(data)=>window.__conversation=data',finished)
    finished_state=page.evaluate(f"ProjectConstellationChatGPTPageProbe.readTranscript('{conversation_id}', true)")
    deep_state=page.evaluate('(data)=>ProjectConstellationChatGPTPageProbe.summarizeConversation(data, data.id)',deep)
    failed_state=page.evaluate('(data)=>ProjectConstellationChatGPTPageProbe.summarizeConversation(data, data.id)',failed)
    waiting_state=page.evaluate('(data)=>ProjectConstellationChatGPTPageProbe.summarizeConversation(data, data.id)',waiting)
    no_progress_state=page.evaluate('(data)=>ProjectConstellationChatGPTPageProbe.summarizeConversation(data, data.id)',no_progress)
    fetches=page.evaluate('window.__fetches')
    serialized=json.dumps({'running':running_state,'finished':finished_state,'deep':deep_state,'failed':failed_state,'waiting':waiting_state,'noProgress':no_progress_state,'fetches':fetches})
    print(serialized)
    assert running_state['running'] is True and running_state['final'] is False and running_state['transcriptStatus']=='running'
    assert running_state['modelSlug']=='gpt-5.6-sol' and running_state['latestUserMessageId']=='u-current'
    assert finished_state['final'] is True and finished_state['running'] is False and finished_state['transcriptStatus']=='finished'
    assert finished_state['endTurn'] is True and finished_state['isComplete'] is True
    assert deep_state['running'] is True and deep_state['phase']=='deep-research'
    assert deep_state['progressPercent']==42 and deep_state['asyncTaskId']=='deepresch_test'
    assert failed_state['condition']=='failed' and failed_state['terminal'] is True and failed_state['running'] is False
    assert waiting_state['condition']=='waiting-user' and waiting_state['waitingUser'] is True and waiting_state['terminal'] is False
    assert no_progress_state['progressPercent'] is None, 'missing task progress must stay unknown instead of becoming 0%'
    assert 'SECRET_MUST_STAY_IN_MAIN_WORLD' not in serialized
    assert not errors
    browser.close()
