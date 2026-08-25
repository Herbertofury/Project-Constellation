from playwright.sync_api import sync_playwright
import pathlib, json, os

root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_ROOT','/mnt/data/project-constellation'))
core=(root/'src/core.js').read_text(); brain=(root/'src/brain-core.js').read_text(); health=(root/'src/health-core.js').read_text(); content=(root/'src/content.js').read_text(); css=(root/'src/styles.css').read_text()
page_html='''<!doctype html><html><head><style>html,body{background:#090b16;color:#eef;margin:0}main{max-width:780px;margin:80px auto}form{display:flex;gap:8px}.composer{min-height:80px;flex:1;border:1px solid #465078;padding:12px;white-space:pre-wrap}button{padding:8px 14px}</style></head><body><main><h1>Fresh ChatGPT chat</h1><form><div id="prompt-textarea" class="composer" contenteditable="true" role="textbox" aria-label="Chat with ChatGPT"></div><button data-testid="send-button" type="button" aria-label="Send message">Send</button></form></main></body></html>'''
mock=r'''(() => {
  window.__brain=[]; window.__completeCalls=[]; window.__lineageCalls=[]; window.__sentPrompt=''; window.__newChatId=''; let claimed=false;
  window.ProjectConstellationProviders={detectProvider:()=>({id:'chatgpt',name:'ChatGPT',home:'https://chatgpt.com/'}),chatIdFromUrl:()=>window.__newChatId||'chatgpt:home',isLikelyChatUrl:()=>false,canonicalChatUrl:(u)=>u,classifyExternalUrl:()=>({kind:'external',provider:'',external:false}),hashString:(value)=>{let h=2166136261;for(const ch of String(value||'')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(36);}};
  const prompt='Continue this work as the direct continuation of my previous chat.\n\n# Project Constellation Safe Handoff\n\nSource chat: Performance repair\n\nContinue the unfinished implementation and preserve every verified decision.';
  window.chrome={storage:{local:{get:async()=>({projectConstellationPerformanceSettings:{enabled:true,responsiveScrolling:true,adaptiveMotionRelief:false},projectConstellationBrainSettings:{liveHealth:{enabled:false}},projectConstellationPulseUxSettings:{branchReviewBeforeSend:true}}),set:async()=>{}},onChanged:{addListener:()=>{}}},runtime:{sendMessage:async(msg)=>{if(msg.type==='PC_BRAIN_INGEST_BATCH'){window.__brain.push(...(msg.payload||[]));return {ok:true};}if(msg.type==='PC_BRANCH_CONTINUATION_CLAIM'){if(claimed)return {ok:false,state:'none'};claimed=true;return {ok:true,state:'ready',branchId:'branch:smoke',checkpointId:'handoff:smoke',sourceChatId:'chatgpt:parent',sourceTitle:'Performance repair',prompt};}if(msg.type==='PC_BRANCH_CONTINUATION_COMPLETE'){window.__completeCalls.push(msg);return {ok:true,status:msg.status};}if(msg.type==='PC_BRANCH_LINEAGE_RESOLVE'){window.__lineageCalls.push(msg);return {ok:true};}if(msg.type==='PC_LIVE_HEALTH_CONTEXT')return {ok:true,settings:{enabled:false},network:{pending:0,observed:false},latestTurns:[],integrityFindings:[]};return {ok:true};},onMessage:{addListener:(fn)=>window.__listener=fn}}};
  document.querySelector('[data-testid="send-button"]').addEventListener('click',()=>{const composer=document.getElementById('prompt-textarea');window.__sentPrompt=composer.innerText;composer.replaceChildren();window.__newChatId='chatgpt:continued';});
})();'''

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox']); page=browser.new_page(viewport={'width':1280,'height':800}); errors=[]; page.on('pageerror',lambda exc:errors.append(str(exc)))
    page.set_content(page_html,wait_until='domcontentloaded'); page.evaluate(mock); page.add_style_tag(content=css); page.add_script_tag(content=core); page.add_script_tag(content=brain); page.add_script_tag(content=health); page.add_script_tag(content=content)
    page.wait_for_timeout(2200)
    before=page.evaluate('''() => ({sentPrompt:window.__sentPrompt,completeCalls:window.__completeCalls,composerText:document.getElementById('prompt-textarea').innerText,armed:document.getElementById('prompt-textarea').dataset.projectConstellationBranchReady||'',toast:!!document.getElementById('projectConstellationBranchToast')})''')
    assert not before['sentPrompt'] and 'Project Constellation Safe Handoff' in before['composerText'] and 'direct continuation' in before['composerText']
    assert before['completeCalls'] and before['completeCalls'][-1]['status']=='prefilled' and before['armed']=='1' and before['toast']
    page.locator('#prompt-textarea').press('End'); page.keyboard.insert_text('\nUser edit before send.'); page.locator('#prompt-textarea').press('Enter'); page.wait_for_timeout(450)
    result=page.evaluate('''() => ({sentPrompt:window.__sentPrompt,completeCalls:window.__completeCalls,lineageCalls:window.__lineageCalls,newChatId:window.__newChatId,composerText:document.getElementById('prompt-textarea').innerText,nativeForm:!!document.querySelector('form')})''')
    print(json.dumps({'before':before,'result':result,'errors':errors},sort_keys=True))
    assert 'Project Constellation Safe Handoff' in result['sentPrompt'] and 'User edit before send.' in result['sentPrompt']
    assert result['newChatId']=='chatgpt:continued' and result['composerText']=='' and result['nativeForm']
    assert not errors
    browser.close()
