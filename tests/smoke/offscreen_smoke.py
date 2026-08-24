from playwright.sync_api import sync_playwright
import pathlib, json, os
root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_ROOT','/mnt/data/project-constellation'))
brain=(root/'src/brain-core.js').read_text(); providers=(root/'src/provider-core.js').read_text(); off=(root/'offscreen.js').read_text()
mock="""
(() => { const listeners={}; globalThis.chrome={runtime:{onMessage:{addListener:(fn)=>listeners.message=fn}}}; globalThis.__listeners=listeners; })();
"""
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
    page=browser.new_page(); errors=[]; page.on('pageerror',lambda exc: errors.append(str(exc)))
    page.set_content('<!doctype html><html><body></body></html>')
    page.add_script_tag(content=mock); page.add_script_tag(content=brain); page.add_script_tag(content=providers); page.add_script_tag(content=off)
    result=page.evaluate("""async()=>new Promise((resolve)=>{
      const html=`<!doctype html><html><head><title>Minecraft Mod Repair</title></head><body>
        <a href='/c/abc123'>Minecraft mod repair</a>
        <main><article data-message-id='u1' data-message-author-role='user'>Fix my Minecraft mod crash</article><article data-message-id='a1' data-message-author-role='assistant'>Done. Download https://drive.google.com/file/d/modjar/view</article></main>
        <a href='https://github.com/example/mod/releases/download/v2/fixed-mod.jar'>fixed-mod.jar</a>
      </body></html>`;
      __listeners.message({type:'PC_OFFSCREEN_PARSE_HTML',target:'pc-offscreen-parser',payload:{providerId:'chatgpt',url:'https://chatgpt.com/c/abc123',html}}, {}, resolve);
    })""")
    print(json.dumps({'result':result,'errors':errors},sort_keys=True))
    assert result['ok'] and len(result['chats'])==1 and len(result['turns'])>=2 and len(result['files'])>=1
    assert result['chats'][0]['url'].startswith('https://chatgpt.com/c/abc123')
    assert any('fixed-mod.jar' in (f.get('name') or '') for f in result['files'])
    assert not errors
    browser.close()
