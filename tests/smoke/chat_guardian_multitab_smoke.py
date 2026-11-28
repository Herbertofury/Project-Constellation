from playwright.sync_api import sync_playwright
import pathlib, os, json

repo = pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_REPO', pathlib.Path(__file__).resolve().parents[2])).resolve()
health_src = (repo / 'extension' / 'src' / 'health-core.js').read_text(encoding='utf-8')
guardian_src = (repo / 'extension' / 'src' / 'chat-guardian-core.js').read_text(encoding='utf-8')
sentinel_src = (repo / 'extension' / 'src' / 'live-sentinel.js').read_text(encoding='utf-8')
# The runtime is exercised in a local synthetic page because this harness blocks network
# navigation to chatgpt.com. Only the location reads are test-substituted; production
# detection/recovery code is otherwise executed byte-for-byte.
sentinel_src = sentinel_src.replace("const host = location.hostname.toLowerCase();", "const host = String(globalThis.__PC_TEST_HOST || location.hostname).toLowerCase();")
sentinel_src = sentinel_src.replace("String(location.pathname || '')", "String(globalThis.__PC_TEST_PATH || location.pathname || '')")
paths = [
    '/c/0a0a0a0a-1111-2222-3333-444444444444',
    '/c/0b0b0b0b-1111-2222-3333-444444444444',
    '/c/0c0c0c0c-1111-2222-3333-444444444444',
    '/c/0d0d0d0d-1111-2222-3333-444444444444',
    '/c/0e0e0e0e-1111-2222-3333-444444444444',
]

def page_html(kind):
    if kind == 'timeout':
        terminal = '<section class="new-provider-card"><div>ChatGPT stream recovery polling timed out</div><button id="retry" type="button">Retry</button></section>'
        assistant = ''
    elif kind == 'generic':
        terminal = '<div class="provider-card"><span>We hit a snag while restoring this answer. Please try again.</span><button id="retry" type="button" aria-label="Try again">Try again</button></div>'
        assistant = ''
    elif kind == 'draft':
        terminal = '<section class="new-provider-card"><div>ChatGPT stream recovery polling timed out</div><button id="retry" type="button">Retry</button></section>'
        assistant = ''
    elif kind == 'review':
        terminal = '<div class="review-card">Our systems are thinking a bit more about this request before responding. You can retry with a faster model.</div>'
        assistant = ''
    else:
        terminal = ''
        assistant = '<article data-turn="assistant" data-testid="conversation-turn-2" data-message-author-role="assistant" data-message-id="a1"><div class="markdown">The test is complete and all checks passed.</div><button type="button" aria-label="Copy">Copy</button></article>'
    return f'''<!doctype html><html><body><main>
<article data-turn="user" data-testid="conversation-turn-1" data-message-author-role="user" data-message-id="u1">Finish the performance integration and keep testing it.</article>
{assistant}{terminal}
<form id="composer-form"><div id="prompt-textarea" class="ProseMirror" contenteditable="true" role="textbox">{'Keep my draft exactly' if kind == 'draft' else ''}</div><button id="composer-submit-button" type="button" aria-label="Send">Send</button></form>
</main><script>
window.__retryClicks=0; window.__sent=[];
document.querySelector('#retry')?.addEventListener('click',()=>window.__retryClicks++);
document.querySelector('#composer-submit-button').addEventListener('click',()=>{{const c=document.querySelector('#prompt-textarea'); const t=(c.innerText||c.textContent||'').trim(); if(t){{window.__sent.push(t); c.replaceChildren();}}}});
</script></body></html>'''

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=(os.environ.get('PROJECT_CONSTELLATION_CHROMIUM') or None), headless=True, args=['--no-sandbox'])
    context = browser.new_context()
    pages=[]; states=[]; decisions=[]
    for index,kind in enumerate(['timeout','generic','healthy','draft','review']):
        page=context.new_page()
        page.set_content(page_html(kind), wait_until='domcontentloaded')
        page.evaluate("""([path]) => {
          window.__PC_TEST_HOST='chatgpt.com'; window.__PC_TEST_PATH=path;
          window.__pcRuntimeListeners=[];
          window.chrome={
            runtime:{sendMessage:()=>Promise.resolve({ok:true}),onMessage:{addListener:(fn)=>window.__pcRuntimeListeners.push(fn),removeListener:()=>{}}},
            storage:{local:{get:async()=>({})},onChanged:{addListener:()=>{},removeListener:()=>{}}}
          };
        }""", [paths[index]])
        page.add_script_tag(content=health_src)
        page.add_script_tag(content=guardian_src)
        page.add_script_tag(content=sentinel_src)
        page.wait_for_timeout(350)
        state=page.evaluate('ProjectConstellationLiveSentinel.getState(true)')
        row={
          'tabId':index+1,'providerId':'chatgpt','chatId':state.get('chat',{}).get('id',''),
          'status':state.get('chat',{}).get('status',''),'healthState':state.get('chat',{}).get('healthState',''),
          'failure':state.get('failure'),'generation':state.get('generation'),'network':{'pending':0}
        }
        decision=page.evaluate('(row)=>ProjectConstellationChatGuardianCore.shouldAttempt(row,{}, {failureDelayMs:500}, Date.now()+2000)', row)
        response=None
        if decision.get('recover'):
            response=page.evaluate('(d)=>ProjectConstellationLiveSentinel.continueUnfinished({reason:d.reason,fingerprint:d.fingerprint,prompt:d.prompt})', decision)
            if kind == 'draft':
                assert response.get('ok') is False and response.get('action') == 'composer-busy', response
            else:
                assert response.get('ok') is True and response.get('action') == 'sent-continue', response
        pages.append(page); states.append(state); decisions.append(decision)

    sent=[page.evaluate('window.__sent') for page in pages]
    retry=[page.evaluate('window.__retryClicks') for page in pages]
    drafts=[page.locator('#prompt-textarea').inner_text() for page in pages]
    assert states[0]['failure']['state']=='response-interrupted', states[0]
    assert states[1]['failure']['state']=='response-interrupted', states[1]
    assert states[3]['failure']['state']=='response-interrupted', states[3]
    assert states[4]['chat']['healthState']=='provider-review', states[4]
    assert decisions[0]['recover'] is True and decisions[1]['recover'] is True and decisions[3]['recover'] is True, decisions
    assert decisions[2]['recover'] is False and decisions[4]['recover'] is False, decisions
    assert sent[0]==['Continue the unfinished task.'] and sent[1]==['Continue the unfinished task.'], sent
    assert sent[2]==[] and sent[3]==[] and sent[4]==[], sent
    assert drafts[3]=='Keep my draft exactly', drafts
    assert retry==[0,0,0,0,0], retry
    print(json.dumps({'states':[s['chat']['healthState'] for s in states], 'decisions':decisions, 'sent':sent, 'retry':retry, 'drafts':drafts}, sort_keys=True))
    context.close(); browser.close()
