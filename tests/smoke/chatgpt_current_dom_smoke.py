from playwright.sync_api import sync_playwright
import json, pathlib, os

root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_ROOT','/mnt/data/project-constellation'))
core=(root/'src/core.js').read_text();brain=(root/'src/brain-core.js').read_text();health=(root/'src/health-core.js').read_text();content=(root/'src/content.js').read_text()
html='''<!doctype html><html><body><main>
<section data-testid="conversation-turn-1"><h4>You said:</h4><div data-message-author-role="user" data-message-id="52abb5ea-9b04-4746-8300-242636d01e1a">Reply with exactly: Constellation selector check.</div></section>
<section data-testid="conversation-turn-2"><h4>ChatGPT said:</h4><div data-message-author-role="assistant" data-message-id="e7ca69ef-127d-4b3e-91b4-18cde0a6c386"><div class="markdown prose"><h2>Selector result</h2><p>Constellation <strong>selector</strong> check.</p><ul><li>Rendered structure retained</li></ul></div></div></section>
<button data-testid="composer-plus-btn" aria-label="Add files and more"></button><div contenteditable="true" role="textbox" aria-label="Chat with ChatGPT"><p>Ask anything</p></div>
</main></body></html>'''
mock=r'''(() => { window.__brain=[];window.ProjectConstellationProviders={detectProvider:()=>({id:'chatgpt',name:'ChatGPT',home:'https://chatgpt.com/'}),chatIdFromUrl:()=>'',isLikelyChatUrl:()=>false,canonicalChatUrl:(u)=>u,classifyExternalUrl:()=>({kind:'external',provider:'',external:false}),hashString:(value)=>{let h=2166136261;for(const ch of String(value||'')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(36);}};window.chrome={storage:{local:{get:async()=>({projectConstellationPerformanceSettings:{enabled:true,responsiveScrolling:true,adaptiveMotionRelief:false},projectConstellationBrainSettings:{liveHealth:{enabled:false}}}),set:async()=>{}},onChanged:{addListener:()=>{}}},runtime:{sendMessage:async(msg)=>{if(msg.type==='PC_BRAIN_INGEST_BATCH')window.__brain.push(...(msg.payload||[]));return {ok:true};},onMessage:{addListener:(fn)=>window.__listener=fn}}};})();'''
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox']);page=browser.new_page();errors=[];page.on('pageerror',lambda exc:errors.append(str(exc)))
    page.set_content(html,wait_until='load');page.evaluate(mock);page.add_script_tag(content=core);page.add_script_tag(content=brain);page.add_script_tag(content=health);page.add_script_tag(content=content);page.wait_for_timeout(1500)
    result=page.evaluate('''() => {const turns=window.__brain.filter(row=>row.type==='TURN_UPSERT');const chats=window.__brain.filter(row=>row.type==='CHAT_UPSERT');return {turnCount:turns.length,roles:turns.map(row=>row.data.role),formatted:turns.find(row=>row.data.role==='assistant')?.data.formattedText||'',ids:[...new Set(turns.map(row=>row.data.chatId))],chatIds:[...new Set(chats.map(row=>row.data.id))],composer:document.querySelector('[role="textbox"]')?.innerText,sections:document.querySelectorAll('[data-testid^="conversation-turn-"]').length};}''')
    print(json.dumps({'result':result,'errors':errors},sort_keys=True))
    assert result['sections']==2 and result['turnCount']==2 and result['roles']==['user','assistant']
    assert '## Selector result' in result['formatted'] and '**selector**' in result['formatted'] and '- Rendered structure retained' in result['formatted']
    assert len(result['ids'])==1 and result['ids'][0].startswith('chatgpt:session:') and result['ids'][0] in result['chatIds']
    assert result['composer']=='Ask anything' and not errors
    browser.close()
