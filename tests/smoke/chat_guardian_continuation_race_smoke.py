"""Exercise continuation races in real DOM with unmodified production source.

All provider traffic is fulfilled locally. Chrome messaging is a transport stub;
this is a DOM regression test, not installed-extension or account acceptance.
"""
from playwright.sync_api import sync_playwright
import json
import os
import pathlib

repo = pathlib.Path(__file__).resolve().parents[2]
health_source = (repo / 'extension/src/health-core.js').read_text(encoding='utf-8')
sentinel_source = (repo / 'extension/src/live-sentinel.js').read_text(encoding='utf-8')
prompt = 'Continue the unfinished task.'
edited = prompt + ' Preserve this unsent user addition.'
next_path = '/c/99999999-0000-4000-8000-000000000001'
cases = [
    ('unchanged', 'sent-continue', ''),
    ('edited', 'composer-busy', edited),
    ('cleared', 'composer-busy', ''),
    ('permission', 'blocked-hold', prompt),
    ('review', 'blocked-hold', prompt),
    ('resumed', 'still-running', prompt),
    ('completed', 'already-complete', prompt),
    ('navigated', 'chat-moved', prompt),
    ('home', 'chat-moved', prompt),
    ('replaced', 'composer-busy', prompt),
    ('before-stage-navigation', 'chat-moved', ''),
    ('before-stage-permission', 'blocked-hold', ''),
    ('edited-without-send', 'composer-busy', edited),
]
html = '''<!doctype html><html><head><title>Continuation race fixture</title></head><body><main>
<article data-testid="conversation-turn-1" data-message-author-role="user" data-message-id="user-1">Finish the reliability task.</article>
<section id="failure" role="alert">ChatGPT stream recovery polling timed out <button id="retry">Retry</button></section>
<form id="composer-form"><div id="prompt-textarea" class="ProseMirror" contenteditable="true" role="textbox" style="white-space:pre-wrap"></div><div id="send-slot"></div></form>
</main></body></html>'''
mock = '''() => {
  window.__runtimeListeners=[]; window.__tabActions=[]; window.__windowFocusCalls=0;
  window.focus=()=>{__windowFocusCalls++;};
  window.chrome={
    runtime:{sendMessage:async()=>({ok:true}),onMessage:{addListener:fn=>__runtimeListeners.push(fn),removeListener:()=>{}}},
    storage:{local:{get:async()=>({})},onChanged:{addListener:()=>{},removeListener:()=>{}}},
    tabs:{update:async(...args)=>__tabActions.push(['update',...args]),reload:async(...args)=>__tabActions.push(['reload',...args])}
  };
}'''
exercise = '''async ({kind, expectedChatId, edited, nextPath}) => {
  const text=node=>node?.innerText||node?.textContent||'';
  const composer=document.querySelector('#prompt-textarea');
  const events={sent:[],retry:0,permission:0,stagedAt:0,mutatedAt:0,hydratedAt:0};
  document.querySelector('#retry').onclick=()=>events.retry++;
  const mutate=()=>{
    events.mutatedAt=Date.now();
    if(kind==='edited'||kind==='edited-without-send') {
      composer.textContent=edited;
      composer.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:edited}));
    } else if(kind==='cleared') {
      composer.replaceChildren();
      composer.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'deleteContentBackward'}));
    } else if(kind==='permission'||kind==='before-stage-permission') {
      const hold=document.createElement('div');hold.id='permission';hold.setAttribute('role','dialog');
      hold.innerHTML='<h2>Allow ChatGPT to use GitHub?</h2><button id="allow">Allow for this conversation</button><button>Deny</button>';
      document.body.appendChild(hold);hold.querySelector('#allow').onclick=()=>events.permission++;
    } else if(kind==='review') {
      const hold=document.createElement('div');hold.id='review';hold.setAttribute('role','status');
      hold.textContent='Our systems are thinking a bit more about this request before responding. You can retry with a faster model.';
      document.querySelector('main').insertBefore(hold,document.querySelector('form'));
    } else if(kind==='resumed') {
      document.querySelector('#failure').remove();
      const stop=document.createElement('button');stop.dataset.testid='stop-button';stop.textContent='Stop';
      document.querySelector('main').insertBefore(stop,document.querySelector('form'));
    } else if(kind==='completed') {
      document.querySelector('#failure').remove();
      const answer=document.createElement('article');answer.dataset.testid='conversation-turn-2';
      answer.dataset.messageAuthorRole='assistant';answer.dataset.messageId='assistant-1';
      answer.innerHTML='The task completed successfully.<button aria-label="Copy">Copy</button>';
      document.querySelector('main').insertBefore(answer,document.querySelector('form'));
    } else if(kind==='navigated'||kind==='before-stage-navigation') {
      history.pushState({},'',nextPath);
    } else if(kind==='home') {
      history.pushState({},'','/');
    } else if(kind==='replaced') {
      composer.replaceWith(composer.cloneNode(true));
    }
  };
  const hydrate=()=>{
    events.hydratedAt=Date.now();
    const send=document.createElement('button');send.id='composer-submit-button';send.type='button';
    send.setAttribute('aria-label','Send');send.textContent='Send';
    send.onclick=()=>{
      const current=document.querySelector('#prompt-textarea');
      events.sent.push(text(current));current.replaceChildren();
    };
    document.querySelector('#send-slot').appendChild(send);
  };
  composer.addEventListener('input',()=>{
    if(events.stagedAt||!text(composer).trim())return;
    events.stagedAt=Date.now();
    if(kind!=='unchanged')setTimeout(mutate,50);
    if(kind!=='edited-without-send')setTimeout(hydrate,400);
  });
  if(kind.startsWith('before-stage-')) {
    composer.remove();setTimeout(mutate,50);
    setTimeout(()=>document.querySelector('form').prepend(composer),400);
  }
  const startedAt=Date.now();
  const response=await ProjectConstellationLiveSentinel.continueUnfinished({
    expectedChatId,reason:'response-interrupted',fingerprint:'race-'+kind,prompt:'Continue the unfinished task.'
  });
  return {kind,response,events,draft:text(document.querySelector('#prompt-textarea')),path:location.pathname,
    elapsedMs:Date.now()-startedAt,permissionPresent:!!document.querySelector('#permission'),
    reviewPresent:!!document.querySelector('#review'),tabActions:__tabActions,windowFocusCalls:__windowFocusCalls};
}'''

results = []
failures = []
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        executable_path=os.environ.get('PROJECT_CONSTELLATION_CHROMIUM') or None,
        headless=True, args=['--no-sandbox'])
    try:
        context = browser.new_context()
        document_requests = []

        def local_route(route):
            if route.request.resource_type == 'document':
                document_requests.append(route.request.url)
                route.fulfill(status=200, content_type='text/html', body=html)
            else:
                route.fulfill(status=200, content_type='application/json', body='{}')

        context.route('**/*', local_route)
        for index, (kind, expected_action, expected_draft) in enumerate(cases):
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            chat_id = f'00000000-0000-4000-8000-{index+1:012d}'
            url = f'https://chatgpt.com/c/{chat_id}'
            page.goto(url, wait_until='domcontentloaded')
            page.evaluate(mock)
            page.add_script_tag(content=health_source)
            page.add_script_tag(content=sentinel_source)
            initial = page.evaluate('ProjectConstellationLiveSentinel.getState(true)')
            assert initial['chat']['id'] == chat_id, initial
            assert initial['failure']['active'] and initial['chat']['status'] == 'response-interrupted', initial
            result = page.evaluate(exercise, {'kind':kind, 'expectedChatId':f'chatgpt:{chat_id}',
                                             'edited':edited, 'nextPath':next_path})
            results.append(result)
            try:
                assert result['response']['action'] == expected_action, result
                assert result['response']['ok'] is (kind == 'unchanged'), result
                assert result['events']['sent'] == ([prompt] if kind == 'unchanged' else []), result
                assert result['draft'] == expected_draft, result
                assert result['events']['retry'] == result['events']['permission'] == 0, result
                assert result['tabActions'] == [] and result['windowFocusCalls'] == 0, result
                assert document_requests.count(url) == 1, document_requests
                assert not errors, errors
                if kind.startswith('before-stage-'):
                    assert result['events']['stagedAt'] == 0, result
                else:
                    assert result['events']['stagedAt'] > 0, result
                    if kind != 'unchanged':
                        assert result['events']['mutatedAt'] > result['events']['stagedAt'], result
                if kind in ('permission', 'before-stage-permission'):
                    assert result['permissionPresent'], result
                if kind == 'review':
                    assert result['reviewPresent'], result
                if kind in ('navigated', 'before-stage-navigation'):
                    assert result['path'] == next_path, result
                if kind == 'home':
                    assert result['path'] == '/', result
                if kind == 'unchanged':
                    assert result['events']['hydratedAt'] >= result['events']['stagedAt'] + 350, result
            except AssertionError as error:
                failures.append({'kind':kind, 'error':str(error)})
            finally:
                page.close()
        context.close()
    finally:
        browser.close()

print(json.dumps({'cases':results, 'failures':failures}, sort_keys=True))
assert not failures, failures
