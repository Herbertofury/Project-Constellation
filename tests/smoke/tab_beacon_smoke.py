from playwright.sync_api import sync_playwright
import json, pathlib, os

root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_ROOT','/mnt/data/project-constellation'))
beacon=(root/'src/tab-beacon.js').read_text()
html='''<!doctype html><html><head><title>Original Chat</title><link rel="icon" href="data:image/svg+xml,old"></head><body><main>chat</main></body></html>'''
mock=r'''(() => {window.__listeners=[];window.chrome={runtime:{onMessage:{addListener:(fn)=>window.__listeners.push(fn),removeListener:(fn)=>{window.__listeners=window.__listeners.filter(x=>x!==fn);}}}};window.__send=(msg)=>new Promise((resolve)=>{for(const fn of window.__listeners){fn(msg,{},resolve);}});})();'''

with sync_playwright() as p:
    launch={'headless':True,'args':['--no-sandbox']}; chromium=os.environ.get('PROJECT_CONSTELLATION_CHROMIUM','').strip(); launch.update({'executable_path':chromium} if chromium else {})
    browser=p.chromium.launch(**launch); page=browser.new_page(); errors=[]; page.on('pageerror',lambda exc:errors.append(str(exc)))
    page.set_content(html,wait_until='load'); page.evaluate(mock); page.add_script_tag(content=beacon)
    state=page.evaluate("__send({type:'PC_TAB_BEACON_APPLY',presentation:{enabled:true,titleEnabled:true,faviconEnabled:true,emoji:'🟣',color:'#8b5cf6',tag:'🔥'}})")
    page.wait_for_timeout(80)
    first=page.evaluate("({title:document.title,href:document.getElementById('projectConstellationTabBeaconFavicon')?.getAttribute('href')||''})")
    page.evaluate("document.title='Renamed by ChatGPT'")
    page.wait_for_timeout(80)
    renamed=page.evaluate("document.title")
    page.evaluate("__send({type:'PC_TAB_BEACON_APPLY',presentation:{enabled:true,titleEnabled:true,faviconEnabled:true,emoji:'✅',color:'#45bd8c',tag:'📌'}})")
    page.wait_for_timeout(80)
    completed=page.evaluate("document.title")
    page.evaluate("__send({type:'PC_TAB_BEACON_APPLY',presentation:{enabled:false,titleEnabled:false,faviconEnabled:false,emoji:'',color:'#45bd8c',tag:''}})")
    page.wait_for_timeout(80)
    disabled=page.evaluate("({title:document.title,beacon:!!document.getElementById('projectConstellationTabBeaconFavicon')})")
    print(json.dumps({'state':state,'first':first,'renamed':renamed,'completed':completed,'disabled':disabled,'errors':errors},ensure_ascii=False,sort_keys=True))
    assert state['ok'] is True
    assert first['title']=='🔥 🟣 Original Chat'
    assert first['href'].startswith('data:image/svg+xml,')
    assert renamed=='🔥 🟣 Renamed by ChatGPT'
    assert completed=='📌 ✅ Renamed by ChatGPT'
    assert disabled=={'title':'Renamed by ChatGPT','beacon':False}
    assert not errors
    browser.close()
