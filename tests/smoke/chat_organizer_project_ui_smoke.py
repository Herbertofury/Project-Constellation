import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright

root=Path(os.environ.get('PROJECT_CONSTELLATION_ROOT') or Path(__file__).resolve().parents[2]/'extension')
chromium=os.environ.get('PROJECT_CONSTELLATION_CHROMIUM') or None
chat_id='11111111-1111-1111-1111-111111111111'
html='''<!doctype html><html><body><nav><ul><li id="row"><a href="https://chatgpt.com/c/%s"><span>Spellbrook animation work</span></a><button aria-label="More actions">...</button></li></ul></nav></body></html>'''%chat_id
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox'],executable_path=chromium)
    page=browser.new_page()
    errors=[]
    page.on('pageerror',lambda exc:errors.append(str(exc)))
    page.set_content(html)
    mock='''
    window.__writes=[];
    window.chrome={
      storage:{local:{get:async(keys)=>({projectConstellationChatDecorationsV1:{},projectConstellationChatVaultV1:{version:3,stacks:[{id:'stack:spell',name:'Spellbrook Animation',icon:'pc:palette',color:'#45bd8c',items:[{id:'i',key:'chatgpt:%s',url:location.href,title:'Spellbrook animation work'}]}]}}),set:async(v)=>{window.__writes.push(v)}},onChanged:{addListener:()=>{}}},
      runtime:{onMessage:{addListener:()=>{}},sendMessage:async(msg)=>{
        if(msg.type==='PC_CHAT_ORGANIZER_CONTEXT')return {ok:true,context:{chat:{id:'%s',title:'Spellbrook animation work',workspaceProjectId:'p1',pinned:false,favorite:false},assignedProject:{id:'p1',name:'Spellbrook Mod',icon:'*',color:'#7d92ff'},projects:[{id:'p1',name:'Spellbrook Mod',icon:'*',color:'#7d92ff'},{id:'p2',name:'Spellbrook Assets',icon:'pc:palette',color:'#45bd8c'}],suggestions:[{projectId:'p2',score:.92,reason:'same project family',fingerprint:'fp',project:{id:'p2',name:'Spellbrook Assets',icon:'pc:palette',color:'#45bd8c'}}]}};
        if(msg.type==='PC_ORG_CHAT_PATCH'||msg.type==='PC_CHAT_ORGANIZER_PROJECT_SET'||msg.type==='PC_CHAT_VAULT_OPEN')return {ok:true,items:[]};
        return {ok:true};
      }}
    };
    '''%(chat_id,chat_id)
    page.add_script_tag(content=mock)
    page.add_style_tag(path=str(root/'src'/'chat-organizer.css'))
    for rel in ['src/project-identity-core.js','src/chat-vault-core.js']:
        page.add_script_tag(path=str(root/rel))
    organizer=(root/'src'/'chat-organizer.js').read_text(encoding='utf-8').replace("if (!['chatgpt.com','chat.openai.com'].includes(location.hostname.toLowerCase())) return;","if (false) return;")
    page.add_script_tag(content=organizer)
    page.wait_for_selector('.pc-chat-project-icon svg',timeout=3000)
    page.wait_for_selector('.pc-chat-project-badge svg',timeout=3000)
    page.click('.pc-chat-style-button',force=True)
    page.wait_for_selector('#projectConstellationChatStylePopover.open',timeout=3000)
    assert page.locator('.pc-vector-icon-presets button').count() >= 24
    assert page.locator('.pc-project-suggestion').count() >= 1
    page.click('.pc-chat-editor-close')
    page.dispatch_event('#row','contextmenu')
    page.evaluate("""() => { const m=document.createElement('div');m.setAttribute('role','menu');m.innerHTML='<button role=menuitem>Rename</button>';document.body.appendChild(m); }""")
    page.wait_for_selector('.pc-native-menu-section',timeout=3000)
    labels=page.locator('.pc-native-menu-item').all_text_contents()
    assert any('Smart match: Spellbrook Assets' in x for x in labels),labels
    assert 'Favorite in Constellation' in labels
    assert 'Pin in Constellation' in labels
    assert 'Open in Command Center' in labels
    assert not errors,errors
    browser.close()
print('chat_organizer_project_ui_smoke.py: PASS')
