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
    page.evaluate("__send({type:'PC_TAB_BEACON_APPLY',presentation:{enabled:true,titleEnabled:true,faviconEnabled:true,emoji:'🛡️',color:'#4fa3ff',tag:'🔥'}})")
    page.wait_for_timeout(80)
    hold=page.evaluate("({title:document.title,href:document.getElementById('projectConstellationTabBeaconFavicon')?.getAttribute('href')||''})")
    # Crash guard: identical background presentations must be a true DOM no-op.
    page.evaluate("""() => {
      window.__pcBeaconMutations=[];
      const title=document.querySelector('title');
      const favicon=document.getElementById('projectConstellationTabBeaconFavicon');
      const observer=new MutationObserver((rows)=>window.__pcBeaconMutations.push(...rows.map((m)=>({type:m.type,attributeName:m.attributeName||''}))));
      if(title)observer.observe(title,{subtree:true,childList:true,characterData:true});
      if(favicon)observer.observe(favicon,{attributes:true});
      window.__pcBeaconMutationObserver=observer;
    }""")
    page.evaluate("""async () => {
      const presentation={enabled:true,titleEnabled:true,faviconEnabled:true,emoji:'🛡️',color:'#4fa3ff',tag:'🔥'};
      for(let i=0;i<5000;i+=1) await __send({type:'PC_TAB_BEACON_APPLY',presentation});
    }""")
    page.wait_for_timeout(80)
    stable=page.evaluate("({mutations:window.__pcBeaconMutations.length,title:document.title,href:document.getElementById('projectConstellationTabBeaconFavicon')?.getAttribute('href')||''})")
    page.evaluate("__send({type:'PC_TAB_BEACON_APPLY',presentation:{enabled:true,titleEnabled:true,faviconEnabled:true,emoji:'🔴',color:'#ff5c64',tag:'🔥'}})")
    page.wait_for_timeout(80)
    critical=page.evaluate("({title:document.title,href:document.getElementById('projectConstellationTabBeaconFavicon')?.getAttribute('href')||''})")
    page.evaluate("__send({type:'PC_TAB_BEACON_APPLY',presentation:{enabled:true,titleEnabled:true,faviconEnabled:true,emoji:'✅',color:'#45bd8c',tag:'📌'}})")
    page.wait_for_timeout(80)
    completed=page.evaluate("document.title")
    page.evaluate("__send({type:'PC_TAB_BEACON_APPLY',presentation:{enabled:false,titleEnabled:false,faviconEnabled:false,emoji:'',color:'#45bd8c',tag:''}})")
    page.wait_for_timeout(80)
    disabled=page.evaluate("({title:document.title,beacon:!!document.getElementById('projectConstellationTabBeaconFavicon')})")
    print(json.dumps({'state':state,'first':first,'renamed':renamed,'hold':hold,'stable':stable,'critical':critical,'completed':completed,'disabled':disabled,'errors':errors},ensure_ascii=False,sort_keys=True))
    assert state['ok'] is True
    assert first['title']=='🔥 🟣 Original Chat'
    assert first['href'].startswith('data:image/svg+xml,')
    assert renamed=='🔥 🟣 Renamed by ChatGPT'
    assert hold['title']=='🔥 🛡️ Renamed by ChatGPT' and '%234fa3ff' in hold['href'].lower() and '%3cpath' in hold['href'].lower()
    assert stable['mutations']==0, stable
    assert stable['title']==hold['title'] and stable['href']==hold['href'], stable
    assert critical['title']=='🔥 🔴 Renamed by ChatGPT' and '%23ff5c64' in critical['href'].lower()
    assert completed=='📌 ✅ Renamed by ChatGPT'
    assert disabled=={'title':'Renamed by ChatGPT','beacon':False}
    assert not errors
    browser.close()
