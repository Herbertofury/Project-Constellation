from playwright.sync_api import sync_playwright
import pathlib, json, os

root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_ROOT','/mnt/data/project-constellation'))
core=(root/'src/core.js').read_text()
brain=(root/'src/brain-core.js').read_text()
providers=(root/'src/provider-core.js').read_text()
health=(root/'src/health-core.js').read_text()
provider_health=(root/'src/provider-health-core.js').read_text(); content=(root/'src/content.js').read_text()
page_html='''<!doctype html><html><body><main><form><textarea id="prompt-textarea" aria-label="Chat with ChatGPT"></textarea><button data-testid="send-button" type="button" aria-label="Send message">Send</button></form></main></body></html>'''
mock=r'''(() => {
  window.__sendClicks=0; window.__listener=null; window.__brain=[];
  window.chrome={
    storage:{local:{get:async()=>({projectConstellationPerformanceSettings:{enabled:true,responsiveScrolling:true,adaptiveMotionRelief:false},projectConstellationBrainSettings:{liveHealth:{enabled:false}},projectConstellationPulseUxSettings:{branchReviewBeforeSend:true}}),set:async()=>{}},onChanged:{addListener:()=>{}}},
    runtime:{
      sendMessage:async(msg)=>{if(msg.type==='PC_BRANCH_CONTINUATION_CLAIM')return {ok:false,state:'none'};if(msg.type==='PC_LIVE_HEALTH_CONTEXT')return {ok:true,settings:{enabled:false},network:{pending:0,observed:false},latestTurns:[],integrityFindings:[]};if(msg.type==='PC_BRAIN_INGEST_BATCH'){window.__brain.push(...(msg.payload||[]));return {ok:true};}return {ok:true};},
      onMessage:{addListener:(fn)=>window.__listener=fn}
    }
  };
  document.querySelector('[data-testid="send-button"]').addEventListener('click',()=>window.__sendClicks++);
  window.__deliver=(message)=>new Promise((resolve,reject)=>{try{const keep=window.__listener(message,{},resolve);if(keep!==true&&message.type!=='PC_STAGE_APPROVED_PROJECT_CONTEXT')resolve({ok:false,error:'listener did not keep channel'});}catch(error){reject(error);}});
})();'''
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox'],executable_path=(os.environ.get('PROJECT_CONSTELLATION_CHROMIUM') or None))
    page=browser.new_page(viewport={'width':1280,'height':720}); errors=[]; page.on('pageerror',lambda exc:errors.append(str(exc)))
    page.set_content(page_html,wait_until='domcontentloaded'); page.add_script_tag(content=mock); page.add_script_tag(content=core); page.add_script_tag(content=brain); page.add_script_tag(content=providers); page.evaluate("""()=>{const p=ProjectConstellationProviders;globalThis.ProjectConstellationProviders={...p,detectProvider:()=>({id:'chatgpt',name:'ChatGPT',home:'https://chatgpt.com/'})};}"""); page.add_script_tag(content=health); page.add_script_tag(content=provider_health); page.add_script_tag(content=content); page.wait_for_timeout(120)
    assert page.evaluate('()=>typeof window.__listener')=='function'
    payload='''# Project context\n\nObjective: Validate the guarded dependency brain.\n\nReusable lesson: Keep expensive project reasoning off the live capture path.'''
    content_hash=page.evaluate('(value)=>ProjectConstellationBrainCore.hashString(value)',payload)
    invalid=page.evaluate("""async({payload,hash})=>await __deliver({type:'PC_STAGE_APPROVED_PROJECT_CONTEXT',content:payload,approval:{approved:false,fingerprint:'fp-1',contentHash:hash,token:'t-1'}})""",{'payload':payload,'hash':content_hash})
    assert not invalid['ok']
    assert page.locator('#prompt-textarea').input_value()==''
    bad_hash=page.evaluate("""async({payload})=>await __deliver({type:'PC_STAGE_APPROVED_PROJECT_CONTEXT',content:payload,approval:{approved:true,fingerprint:'fp-1',contentHash:'wrong',token:'t-1'}})""",{'payload':payload})
    assert not bad_hash['ok']
    assert page.locator('#prompt-textarea').input_value()==''
    valid=page.evaluate("""async({payload,hash})=>await __deliver({type:'PC_STAGE_APPROVED_PROJECT_CONTEXT',content:payload,approval:{approved:true,fingerprint:'fp-1',contentHash:hash,token:'t-1'}})""",{'payload':payload,'hash':content_hash})
    assert valid['ok'] and valid['state']=='staged'
    assert page.locator('#prompt-textarea').input_value()==payload
    assert page.evaluate('()=>window.__sendClicks')==0
    page.fill('#prompt-textarea','Unrelated user draft')
    refused=page.evaluate("""async({payload,hash})=>await __deliver({type:'PC_STAGE_APPROVED_PROJECT_CONTEXT',content:payload,approval:{approved:true,fingerprint:'fp-2',contentHash:hash,token:'t-2'}})""",{'payload':payload,'hash':content_hash})
    assert not refused['ok']
    assert page.locator('#prompt-textarea').input_value()=='Unrelated user draft'
    assert page.evaluate('()=>window.__sendClicks')==0
    page.locator('[data-testid="send-button"]').click()
    assert page.evaluate('()=>window.__sendClicks')==1
    print(json.dumps({'invalid':invalid,'badHash':bad_hash,'valid':valid,'refused':refused,'sendClicks':page.evaluate('()=>window.__sendClicks'),'errors':errors},sort_keys=True))
    assert not errors
    browser.close()
