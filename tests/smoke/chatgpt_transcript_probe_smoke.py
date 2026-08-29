from playwright.sync_api import sync_playwright
import json, pathlib, os

root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_ROOT','/mnt/data/project-constellation'))
probe=(root/'src/chatgpt-page-probe.js').read_text()
conversation_id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

user={'id':'u-current','parent':None,'children':['a-current'],'message':{'id':'u-current','author':{'role':'user'},'status':'finished_successfully','end_turn':False,'create_time':1787860000,'content':{'content_type':'text','parts':['Continue the long-running Project Constellation extension work.']},'metadata':{}}}
running={'id':conversation_id,'current_node':'a-current','mapping':{
  'u-current':user,
  'a-current':{'id':'a-current','parent':'u-current','children':[],'message':{'id':'a-current','author':{'role':'assistant'},'status':'in_progress','end_turn':False,'create_time':1787860004,'update_time':1787860012,'content':{'content_type':'text','parts':['I am still growing this answer while tools continue to run.']},'metadata':{'model_slug':'gpt-5.6-sol'}}}
}}
finished={'id':conversation_id,'current_node':'a-current','mapping':{
  'u-current':user,
  'a-current':{'id':'a-current','parent':'u-current','children':[],'message':{'id':'a-current','author':{'role':'assistant'},'status':'finished_successfully','end_turn':True,'create_time':1787860004,'update_time':1787860025,'content':{'content_type':'text','parts':['The complete answer is now finished and verified.']},'metadata':{'model_slug':'gpt-5.6-sol','is_complete':True}}}
}}
deep={'id':conversation_id,'current_node':'tool2','mapping':{
  'u-current':{'id':'u-current','parent':None,'children':['tool1'],'message':user['message']},
  'tool1':{'id':'tool1','parent':'u-current','children':['tool2'],'message':{'id':'tool1','author':{'role':'tool','name':'research_kickoff_tool.start_research_task'},'status':'finished_successfully','end_turn':False,'metadata':{'async_task_id':'deepresch_test','chatgpt_sdk.widget_state':{'status':'running','progress':{'percent':42}}}}},
  'tool2':{'id':'tool2','parent':'tool1','children':[],'message':{'id':'tool2','author':{'role':'assistant'},'status':'in_progress','end_turn':False,'create_time':1787860030,'update_time':1787860040,'content':{'content_type':'text','parts':['Research synthesis is still streaming.']},'metadata':{'model_slug':'gpt-5.6-sol'}}}
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
    fetches=page.evaluate('window.__fetches')
    serialized=json.dumps({'running':running_state,'finished':finished_state,'deep':deep_state,'fetches':fetches})
    print(serialized)
    assert running_state['running'] is True and running_state['final'] is False and running_state['transcriptStatus']=='running'
    assert running_state['modelSlug']=='gpt-5.6-sol' and running_state['latestUserMessageId']=='u-current'
    assert running_state['visibleTurnCount']==2 and running_state['activeBranchMessages']==2
    assert running_state['contextChars'] > 60 and running_state['visibleChars']==running_state['contextChars']
    assert running_state['latestAssistantChars'] > 20 and running_state['recentAverageChars'] > 20
    assert running_state['responseStartedAt']==1787860004000 and running_state['latestAssistantCreatedAt']==1787860004000
    assert running_state['latestUserCreatedAt']==1787860000000 and running_state['latestAssistantUpdatedAt']==1787860012000
    assert finished_state['final'] is True and finished_state['running'] is False and finished_state['transcriptStatus']=='finished'
    assert finished_state['endTurn'] is True and finished_state['isComplete'] is True
    assert deep_state['running'] is True and deep_state['phase']=='deep-research'
    assert deep_state['progressPercent']==42 and deep_state['asyncTaskId']=='deepresch_test'
    assert deep_state['visibleTurnCount']==2 and deep_state['activeBranchMessages']==3
    assert deep_state['structuredMessages']==1 and deep_state['toolMessages']==1
    assert deep_state['contextChars'] > 40 and deep_state['latestAssistantChars'] > 20
    assert 'SECRET_MUST_STAY_IN_MAIN_WORLD' not in serialized
    assert not errors
    browser.close()
