"""Real DOM acceptance: current permission cards outrank stale running controls."""
import json, os, pathlib
from playwright.sync_api import sync_playwright

root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_ROOT',str(pathlib.Path(__file__).resolve().parents[2]/'extension')))
mock='''(() => {
window.__listeners=[];window.__messages=[];window.__clicks=[];
window.chrome={runtime:{sendMessage:async(message)=>{__messages.push(message);return {ok:true};},onMessage:{addListener:fn=>__listeners.push(fn),removeListener:fn=>{__listeners=__listeners.filter(x=>x!==fn);}}}};
window.__state=()=>ProjectConstellationLiveSentinel.getState(true);
})();'''
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox'],executable_path=os.environ.get('PROJECT_CONSTELLATION_CHROMIUM') or None)
    page=browser.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.set_content('''<html><body><main>
      <section data-testid="conversation-turn-1"><div data-message-author-role="user">Earlier task</div></section>
      <section data-testid="conversation-turn-2"><div data-message-author-role="assistant"><pre><code>Allow for this conversation</code></pre><p>The tutorial discusses permission required errors.</p></div></section>
      <section data-testid="conversation-turn-3"><div data-message-author-role="user">Run the current task</div></section>
      <button data-testid="stop-button">Stop</button><div id="surface"></div>
      </main><textarea>A draft to preserve</textarea></body></html>''')
    page.evaluate(mock)
    page.add_script_tag(content=(root/'src/health-core.js').read_text())
    page.add_script_tag(content=(root/'src/live-sentinel.js').read_text())
    assert page.evaluate('__state().chat.status')=='running'
    variants=[
      '<section><h2>Allow ChatGPT to use GitHub?</h2><button>Allow</button><button>Deny</button></section>',
      '<section><h2>Allow access to drive.google.com</h2><button>Allow</button><button>Deny</button></section>',
      '<div role="dialog"><h2>Permission required</h2><button>Allow for this conversation</button><button>Deny</button></div>',
      '<div role="dialog"><h2>Approve a tool</h2><button>Allow once</button><button>Deny</button></div>',
    ]
    for html in variants:
      page.evaluate('(html)=>{document.querySelector("#surface").innerHTML=html;for(const button of document.querySelectorAll("#surface button"))button.onclick=()=>__clicks.push(button.textContent);}',html)
      state=page.evaluate('__state()')
      assert state['chat']['status']=='blocked-approval',state
      assert state['chat']['healthState']=='blocked-approval',state
      assert state['permission']['active'] is True
      assert state['generation']['active'] is False,'Permission must outrank an old Stop button.'
      assert page.evaluate('__clicks')==[]
      assert page.input_value('textarea')=='A draft to preserve'
    page.evaluate('document.querySelector("#surface").style.display="none"')
    assert page.evaluate('__state().permission.active') is False,'Hidden controls are not current approval evidence.'
    page.evaluate('document.querySelector("#surface").remove()')
    assert page.evaluate('__state().chat.status')=='running','Provider activity resumes without clicking anything.'
    assert not errors,errors
    print(json.dumps({'permission_variants':len(variants),'zero_permission_clicks':True,'draft_preserved':True,'errors':errors}))
    browser.close()
