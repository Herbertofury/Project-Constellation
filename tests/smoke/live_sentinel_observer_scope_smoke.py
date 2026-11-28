from playwright.sync_api import sync_playwright
import json, pathlib, os

root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_ROOT','/mnt/data/project-constellation'))
sentinel=(root/'src/live-sentinel.js').read_text()
html='''<!doctype html><html><head><title>Observer scope</title></head><body><main>
<section data-testid="conversation-turn-1"><div data-message-author-role="user">test</div></section>
<section data-testid="conversation-turn-2"><div data-message-author-role="assistant"><p>complete</p><button aria-label="Copy">Copy</button></div></section>
<div id="unrelated">ordinary page chrome</div>
</main></body></html>'''
mock=r'''(() => {
  window.__messages=[];window.__listeners=[];
  window.chrome={runtime:{
    sendMessage:async(msg)=>{window.__messages.push(msg);return {ok:true};},
    onMessage:{addListener:(fn)=>window.__listeners.push(fn),removeListener:(fn)=>{window.__listeners=window.__listeners.filter(x=>x!==fn);}}
  }};
})();'''

with sync_playwright() as p:
    launch={'headless':True,'args':['--no-sandbox']}; chromium=os.environ.get('PROJECT_CONSTELLATION_CHROMIUM','').strip();
    if chromium: launch['executable_path']=chromium
    browser=p.chromium.launch(**launch); page=browser.new_page(); errors=[]; page.on('pageerror',lambda exc:errors.append(str(exc)))
    page.set_content(html,wait_until='load'); page.evaluate(mock); page.add_script_tag(content=sentinel); page.wait_for_timeout(220)
    before=page.evaluate("ProjectConstellationLiveSentinel.diagnostics().scanCount")
    # ChatGPT changes classes all over its shell while streaming/animating. Unrelated
    # class churn must not wake the expensive live-state scanner.
    page.evaluate("""async () => {
      const node=document.getElementById('unrelated');
      for(let i=0;i<18;i+=1){node.className='noise-'+i;await new Promise(r=>setTimeout(r,90));}
    }""")
    after=page.evaluate("ProjectConstellationLiveSentinel.diagnostics().scanCount")
    print(json.dumps({'before':before,'after':after,'delta':after-before,'errors':errors},sort_keys=True))
    assert after-before <= 1, (before,after)
    assert not errors, errors
    browser.close()
