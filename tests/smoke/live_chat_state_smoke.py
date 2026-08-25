from playwright.sync_api import sync_playwright
import json, pathlib, os
root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_ROOT','/mnt/data/project-constellation'))
core=(root/'src/core.js').read_text();brain=(root/'src/brain-core.js').read_text();health=(root/'src/health-core.js').read_text();sentinel=(root/'src/live-sentinel.js').read_text();content=(root/'src/content.js').read_text()
html='''<!doctype html><html><body><main>
<section data-testid="conversation-turn-1"><div data-message-author-role="user" data-message-id="u1">Fix the project.</div></section>
<section id="assistant-turn" data-testid="conversation-turn-2"><div data-message-author-role="assistant" data-message-id="a1"><div id="tool" class="text-token-text-tertiary">Searching Google Drive for Creeperella 1.4.16 files</div></div></section>
<form><div id="prompt-textarea" contenteditable="true" role="textbox"></div><button data-testid="send-button" aria-label="Send message" type="button">Send</button></form>
</main></body></html>'''
mock=r'''(() => {window.__brain=[];window.ProjectConstellationProviders={detectProvider:()=>({id:'chatgpt',name:'ChatGPT',home:'https://chatgpt.com/'}),chatIdFromUrl:()=> 'chatgpt:live-test',isLikelyChatUrl:()=>true,canonicalChatUrl:(u)=>u,classifyExternalUrl:()=>({kind:'external',provider:'',external:false}),hashString:(value)=>{let h=2166136261;for(const ch of String(value||'')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(36);}};window.chrome={storage:{local:{get:async()=>({projectConstellationPerformanceSettings:{enabled:true,responsiveScrolling:true,adaptiveMotionRelief:false},projectConstellationBrainSettings:{liveHealth:{enabled:false}},projectConstellationPulseUxSettings:{branchReviewBeforeSend:true}}),set:async()=>{}},onChanged:{addListener:()=>{}}},runtime:{sendMessage:async(msg)=>{if(msg.type==='PC_BRAIN_INGEST_BATCH')window.__brain.push(...(msg.payload||[]));return {ok:true};},onMessage:{addListener:(fn)=>window.__listener=fn}}};window.__sendToContent=(msg)=>new Promise((resolve)=>{const keep=window.__listener(msg,{},resolve);if(!keep)setTimeout(()=>resolve(undefined),0);});})();'''
with sync_playwright() as p:
    launch={'headless':True,'args':['--no-sandbox']}; chromium=os.environ.get('PROJECT_CONSTELLATION_CHROMIUM','').strip(); launch.update({'executable_path':chromium} if chromium else {}); browser=p.chromium.launch(**launch);page=browser.new_page();errors=[];page.on('pageerror',lambda exc:errors.append(str(exc)))
    page.set_content(html,wait_until='load');page.evaluate(mock);page.add_script_tag(content=core);page.add_script_tag(content=brain);page.add_script_tag(content=health);page.add_script_tag(content=sentinel);page.add_script_tag(content=content);page.wait_for_timeout(350)
    active=page.evaluate("__sendToContent({type:'PC_GET_LIVE_CHAT_STATE'})")
    page.evaluate("""() => {document.getElementById('tool').textContent='Searched Google Drive for Creeperella 1.4.16 files';const b=document.createElement('button');b.setAttribute('aria-label','Copy');b.textContent='Copy';const p=document.createElement('p');p.textContent='The production release pipeline passed verification, build, packaging, and release publishing. Thinking and reasoning are mentioned only as final prose.';document.querySelector('[data-message-author-role="assistant"]').appendChild(p);document.getElementById('assistant-turn').appendChild(b);}""")
    page.wait_for_timeout(2600)
    done=page.evaluate("__sendToContent({type:'PC_GET_LIVE_CHAT_STATE'})")
    print(json.dumps({'active':active,'done':done,'errors':errors},sort_keys=True))
    assert active['ok'] and active['chat']['status']=='running' and active['generation']['progressiveTool'] is True
    assert done['ok'] and done['chat']['status']=='idle' and done['generation']['active'] is False and done['generation']['finalControls'] is True
    assert not errors
    browser.close()
