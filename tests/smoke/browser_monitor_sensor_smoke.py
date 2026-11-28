"""Run the actual minimal sensor in both Chromium and Firefox DOM runtimes."""
import json, os, pathlib
from playwright.sync_api import sync_playwright
root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_ROOT',str(pathlib.Path(__file__).resolve().parents[2]/'extension')))
source=(root/'src/browser-monitor-sensor.js').read_text()
html='''<!doctype html><html><head><title>Fixture task</title></head><body><main>
<div data-message-author-role="user">Earlier request</div>
<div data-message-author-role="assistant" id="old"><p>Old answer</p><button>Allow for this conversation</button><div role="alert">Something went wrong</div><button>Copy</button></div>
<div data-message-author-role="user">Current request</div>
<pre><code><button>Allow for this conversation</button></code></pre>
<div id="current"></div></main><textarea>Preserve this user draft</textarea></body></html>'''
mock='''(() => {
window.__events=[];window.__listeners=[];window.__clicks=0;window.__network=0;
document.addEventListener('click',()=>__clicks++);
window.fetch=()=>{__network++;throw new Error('Sensor must not use provider requests');};
window.XMLHttpRequest=function(){__network++;throw new Error('Sensor must not use provider requests');};
window.browser={runtime:{sendMessage:async(message)=>{__events.push(message.event);return {ok:true};},onMessage:{addListener:fn=>__listeners.push(fn),removeListener:fn=>{__listeners=__listeners.filter(x=>x!==fn);}}}};
window.__rescan=()=>Promise.all(__listeners.map(fn=>fn({type:'PC_MONITOR_RESCAN'})));
})();'''
results=[]
with sync_playwright() as p:
    browsers=os.environ.get('PROJECT_CONSTELLATION_TEST_BROWSERS','chromium,firefox').split(',')
    assert browsers and all(name in ['chromium','firefox'] for name in browsers), 'Choose chromium and/or firefox explicitly.'
    for name in browsers:
        kwargs={'headless':True}
        if name=='chromium':
            kwargs['args']=['--no-sandbox']
            if os.environ.get('PROJECT_CONSTELLATION_CHROMIUM'):kwargs['executable_path']=os.environ['PROJECT_CONSTELLATION_CHROMIUM']
        browser=getattr(p,name).launch(**kwargs)
        page=browser.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
        page.route('https://chatgpt.com/**',lambda route:route.fulfill(status=200,content_type='text/html',body=html))
        page.goto('https://chatgpt.com/c/one?do-not-store=secret#hash')
        page.evaluate(mock);page.add_script_tag(content=source)
        def state(expected):
            page.wait_for_function('(status)=>__events.at(-1)?.status===status',arg=expected,timeout=5000)
            return page.evaluate('__events.at(-1)')
        state('idle')
        page.evaluate('document.querySelector("#current").innerHTML=\'<button data-testid="stop-button" id="stop">Stop</button>\'')
        run=state('running')['runId']
        page.evaluate('''() => {const card=document.createElement('section');card.id='permission';card.innerHTML='<h2>Allow access to github.com</h2><button>Allow</button><button>Deny</button>';document.querySelector('#current').appendChild(card);}''')
        state('permission_required');page.evaluate('Promise.all(__listeners.map(fn=>fn({type:"PC_ATTENTION_REVEAL_PERMISSION"})))')
        assert page.evaluate('__clicks')==0
        page.evaluate('document.querySelector("#permission").style.display="none"');state('running')
        page.evaluate('document.querySelector("#permission").remove()')
        page.evaluate('''() => {const alert=document.createElement('div');alert.id='error';alert.setAttribute('role','alert');alert.textContent='The conversation has reached the context limit. Start a new chat.';document.querySelector('#current').appendChild(alert);}''')
        state('context_limit')
        page.evaluate('document.querySelector("#error").textContent="Too many requests. Try again in 5 minutes."');state('rate_limited')
        page.evaluate('document.querySelector("#error").textContent="Network error: failed to generate"');state('error')
        page.evaluate('document.querySelector("#error").remove()');state('running')
        page.evaluate('document.querySelector("#stop").remove()');state('idle')
        page.evaluate('''() => {document.querySelector('#current').innerHTML='<button id="stop" data-testid="stop-button">Stop</button><div data-message-author-role="assistant" id="answer">'+ 'A'.repeat(400)+'</div>';}''')
        state('running');before=page.evaluate('__events.length')
        page.evaluate('document.querySelector("#answer").append(document.createTextNode("Additional current response text"))')
        page.wait_for_function('(count)=>__events.length>count',arg=before)
        assert 'Additional current response text' not in page.evaluate('JSON.stringify(__events)')
        page.evaluate('''() => {document.querySelector('#answer').insertAdjacentHTML('beforeend','<button data-testid="copy-turn-action-button">Copy</button>');document.querySelector('#stop').remove();}''')
        done=state('completed');assert done['runId']==run
        page.evaluate('''() => {history.pushState({},'', '/c/two');document.querySelector('main').innerHTML='<div data-message-author-role="assistant">Another existing response</div>';}''')
        changed=state('idle');assert changed['url']=='https://chatgpt.com/c/two'
        before=page.evaluate('__events.length');page.evaluate('__rescan()');assert page.evaluate('__events.length')==before+1
        assert page.evaluate('__network')==0 and page.evaluate('__clicks')==0
        assert page.input_value('textarea')=='Preserve this user draft'
        assert not errors,errors
        results.append({'browser':name,'events':page.evaluate('__events.length'),'permission_clicks':0,'provider_requests':0,'draft_preserved':True,'errors':errors})
        browser.close()
print(json.dumps({'browser_sensor_acceptance':results}))
