from playwright.sync_api import sync_playwright
import json, pathlib, os

root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_ROOT','/mnt/data/project-constellation'))
core=(root/'src/core.js').read_text();brain=(root/'src/brain-core.js').read_text();health=(root/'src/health-core.js').read_text();sentinel=(root/'src/live-sentinel.js').read_text();content=(root/'src/content.js').read_text();pulse=(root/'src/pulse-ux.js').read_text()
html='''<!doctype html><html><body><main>
<section data-testid="conversation-turn-1"><div data-message-author-role="user" data-message-id="u1">Fix the live status detector and publish it.</div></section>
<section data-testid="conversation-turn-2"><div data-message-author-role="assistant" data-message-id="a1" aria-busy="true" data-state="loading"><p>The production release pipeline also passed verification, build, packaging, release publishing, and artifact upload. Thinking, reasoning, building, and testing are mentioned here as ordinary final prose.</p><button aria-label="Copy">Copy</button></div></section>
<div id="staleBusy" aria-busy="true" data-state="loading"><span class="text-token-text-secondary">The production release pipeline also passed verification, build, packaging, release publishing, and artifact upload.</span></div>
<form><div id="prompt-textarea" contenteditable="true" role="textbox"></div><button data-testid="send-button" aria-label="Send message" type="button">Send</button></form>
</main></body></html>'''
mock=r'''(() => {
  const listeners=[];window.__brain=[];window.__networkTick=0;
  const settings={enabled:true,showHealthy:true,corner:'bottom-right',density:'compact',softStallMs:5000,hardStallMs:10000,deadStallMs:45000,hydrationGraceMs:0,pollActiveMs:900,pollIdleMs:900,toolWatchdogEnabled:true,capacityGuardEnabled:true,capacityWarningTurns:180,capacityHandoffTurns:260};
  const regression={active:true,title:'Saved output differs from this page',detail:'secondary vault check',missingTurns:[],changedTurns:[],missingAssets:0,missingLinks:0,missingCodeBlocks:0};
  window.__healthContext=()=>{const now=Date.now(), pending=(window.__networkTick++%2)?7:0;return {ok:true,settings,capacity:{storedTurns:12},network:{pending,auxiliaryPending:pending?2:0,observed:true,lastStartAt:now-80,lastResponseAt:now-40,lastCompleteAt:now-20,lastErrorAt:0,lastStatusCode:200,rateLimited:false,streamLikely:pending>0,inflight:pending?[{id:'aux',category:'response stream',method:'POST',startedAt:now-80}]:[],events:[{id:'aux',phase:pending?'started':'completed',category:'response stream',method:'POST',status:200,startedAt:now-80,at:now-20,durationMs:60}]},latestTurns:[],integrityFindings:[],baseline:{latestVersion:'0.14.3'},chat:{coverage:'server-rendered-content',updatedAt:now,outputRegression:regression}}};
  window.ProjectConstellationProviders={detectProvider:()=>({id:'chatgpt',name:'ChatGPT',home:'https://chatgpt.com/'}),chatIdFromUrl:()=> 'chatgpt:stable-test',isLikelyChatUrl:()=>true,canonicalChatUrl:(u)=>u,classifyExternalUrl:()=>({kind:'external',provider:'',external:false}),hashString:(value)=>{let h=2166136261;for(const ch of String(value||'')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(36);}};
  window.chrome={storage:{local:{get:async()=>({projectConstellationPerformanceSettings:{enabled:true,responsiveScrolling:true,adaptiveMotionRelief:false},projectConstellationBrainSettings:{liveHealth:settings,approvalAutopilot:{enabled:false,acknowledged:false}},projectConstellationPulseUxSettings:{branchReviewBeforeSend:true},projectConstellationPerformanceMetrics:{}}),set:async()=>{}},onChanged:{addListener:(fn)=>listeners.push(fn)}},runtime:{sendMessage:async(msg)=>{if(msg.type==='PC_BRAIN_INGEST_BATCH'){window.__brain.push(...(msg.payload||[]));return {ok:true};}if(msg.type==='PC_BRAIN_INGEST'){window.__brain.push(msg.payload);return {ok:true};}if(msg.type==='PC_LIVE_HEALTH_CONTEXT')return structuredClone(window.__healthContext());if(msg.type==='PC_OUTPUT_OBSERVE')return {ok:true,regression};if(msg.type==='PC_BRANCH_CONTINUATION_CLAIM')return {ok:false,state:'none'};return {ok:true};},onMessage:{addListener:(fn)=>window.__listener=fn,removeListener:()=>{}}}};
  window.__send=(msg)=>new Promise((resolve)=>{const keep=window.__listener(msg,{},resolve);if(!keep)setTimeout(()=>resolve(undefined),0);});
})();'''

with sync_playwright() as p:
    launch={'headless':True,'args':['--no-sandbox']}
    chromium=os.environ.get('PROJECT_CONSTELLATION_CHROMIUM','').strip()
    if chromium: launch['executable_path']=chromium
    browser=p.chromium.launch(**launch);page=browser.new_page(viewport={'width':1440,'height':920});errors=[];page.on('pageerror',lambda exc:errors.append(str(exc)))
    page.set_content(html,wait_until='load');page.evaluate(mock);page.add_script_tag(content=core);page.add_script_tag(content=brain);page.add_script_tag(content=health);page.add_script_tag(content=sentinel);page.add_script_tag(content=content);page.add_script_tag(content=pulse)
    page.wait_for_timeout(3600)
    completed=page.evaluate("__send({type:'PC_GET_LIVE_CHAT_STATE'})")
    before=page.evaluate("""() => {const h=document.getElementById('projectConstellationHealthHud'),s=h?.shadowRoot;return {level:h?.dataset.level,state:h?.dataset.state,title:s?.getElementById('pcHealthTitle')?.textContent,page:s?.getElementById('pcHealthPage')?.textContent,network:s?.getElementById('pcHealthNetwork')?.textContent,now:s?.getElementById('pcHealthNowTitle')?.textContent};}""")
    stable=page.evaluate("""async () => {const h=document.getElementById('projectConstellationHealthHud'),s=h.shadowRoot,frames=[];let i=0;const churn=setInterval(()=>{const x=document.getElementById('staleBusy');x.dataset.state=(i++%2)?'loading':'pending';x.setAttribute('aria-busy',(i%3)?'true':'false');},35);for(let f=0;f<120;f++){await new Promise(requestAnimationFrame);frames.push([h.dataset.level,h.dataset.state,s.getElementById('pcHealthTitle').textContent]);}clearInterval(churn);return {bad:frames.filter(x=>x[0]!=='healthy'||x[1]!=='healthy'||x[2]!=='Chat complete'),diag:ProjectConstellationLiveSentinel.diagnostics()};}""")

    page.evaluate("""() => {const n=document.createElement('div');n.id='genuineProgress';n.className='text-token-text-tertiary';n.textContent='Searching the web';document.querySelector('main').appendChild(n);}""")
    page.wait_for_timeout(240)
    active=page.evaluate("__send({type:'PC_GET_LIVE_CHAT_STATE'})")
    activeHud=page.evaluate("""() => {const h=document.getElementById('projectConstellationHealthHud'),s=h.shadowRoot;return {level:h.dataset.level,state:h.dataset.state,title:s.getElementById('pcHealthTitle').textContent};}""")
    page.evaluate("document.getElementById('genuineProgress').textContent='Searched the web'")
    page.wait_for_timeout(2800)
    done=page.evaluate("__send({type:'PC_GET_LIVE_CHAT_STATE'})")
    after=page.evaluate("""() => {const h=document.getElementById('projectConstellationHealthHud'),s=h.shadowRoot;return {level:h.dataset.level,state:h.dataset.state,title:s.getElementById('pcHealthTitle').textContent,page:s.getElementById('pcHealthPage').textContent,network:s.getElementById('pcHealthNetwork').textContent,diag:ProjectConstellationLiveSentinel.diagnostics()};}""")
    print(json.dumps({'completed':completed,'before':before,'stable':stable,'active':active,'activeHud':activeHud,'done':done,'after':after,'errors':errors},sort_keys=True))
    assert completed['ok'] and completed['chat']['status']=='idle' and completed['generation']['active'] is False
    assert before['level']=='healthy' and before['state']=='healthy' and before['title']=='Chat complete'
    assert before['page']=='output missing', before
    assert stable['bad']==[], stable
    assert active['chat']['status']=='running' and active['generation']['progressiveTool'] is True
    assert activeHud['level']=='active' and activeHud['state']=='tool-running' and activeHud['title'].startswith('Tool working')
    assert done['chat']['status']=='idle' and done['generation']['active'] is False
    assert after['level']=='healthy' and after['state']=='healthy' and after['title']=='Chat complete'
    assert after['page']=='output missing'
    assert after['diag']['transitionCount'] <= 2
    assert not errors
    browser.close()
