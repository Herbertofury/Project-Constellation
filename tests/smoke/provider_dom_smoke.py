from playwright.sync_api import sync_playwright
import json, pathlib, os

root = pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_ROOT', '/mnt/data/project-constellation'))
core = (root / 'src/core.js').read_text()
brain = (root / 'src/brain-core.js').read_text()
health = (root / 'src/health-core.js').read_text()
content = (root / 'src/content.js').read_text()

cases = [
    {
        'id': 'grok', 'name': 'Grok', 'routed': '', 'chat_route': False, 'expected_state': 'guest',
        'html': '''<!doctype html><main><button>Sign in</button>
          <div role="article" aria-label="You" data-testid="user-message"><p>Constellation Grok selector check.</p></div>
          <div role="article" aria-label="Grok" data-testid="assistant-message"><p>Selector check complete.</p></div>
          <textarea aria-label="Ask Grok anything"></textarea></main>'''
    },
    {
        'id': 'deepseek', 'name': 'DeepSeek', 'routed': 'deepseek:abc', 'chat_route': True, 'expected_state': 'connected',
        'html': '''<!doctype html><main>
          <div data-message-id="ds-user" data-role="user"><p>Constellation DeepSeek selector check.</p></div>
          <div data-message-id="ds-assistant" data-role="assistant"><p>Selector check complete.</p></div>
          <textarea aria-label="Message DeepSeek"></textarea></main>'''
    },
    {
        'id': 'qwen', 'name': 'Qwen Chat', 'routed': 'qwen:guest', 'chat_route': True, 'expected_state': 'guest',
        'html': '''<!doctype html><main><button>Log in</button>
          <div class="qwen-chat-message qwen-chat-message-user"><p>Constellation Qwen selector check.</p></div>
          <div class="qwen-chat-message qwen-chat-message-assistant"><p>Selector check complete.</p></div>
          <textarea aria-label="Ask Qwen"></textarea></main>'''
    },
    {
        'id': 'kimi', 'name': 'Kimi', 'routed': '', 'chat_route': False, 'expected_state': 'login-required', 'expected_turns': 0,
        'html': '''<!doctype html><main><button>Log in</button>
          <textarea aria-label="Ask Kimi"></textarea></main>'''
    }
]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox'], executable_path=(os.environ.get('PROJECT_CONSTELLATION_CHROMIUM') or None))
    results = []
    for case in cases:
        page = browser.new_page()
        errors = []
        page.on('pageerror', lambda exc: errors.append(str(exc)))
        page.set_content(case['html'], wait_until='load')
        provider = json.dumps({'id': case['id'], 'name': case['name'], 'home': 'https://example.invalid/', 'guestAccess': case['expected_state'] == 'guest'})
        routed = json.dumps(case['routed'])
        chat_route = 'true' if case['chat_route'] else 'false'
        page.evaluate(f'''() => {{
          window.__brain=[];
          window.ProjectConstellationProviders={{
            detectProvider:()=>({provider}),chatIdFromUrl:()=>{routed},isLikelyChatUrl:()=>{chat_route},canonicalChatUrl:(u)=>u,
            classifyExternalUrl:()=>({{kind:'external',provider:'',external:false}}),
            hashString:(value)=>{{let h=2166136261;for(const ch of String(value||'')){{h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}}return (h>>>0).toString(36);}}
          }};
          window.chrome={{storage:{{local:{{get:async()=>({{projectConstellationPerformanceSettings:{{enabled:true,responsiveScrolling:true,adaptiveMotionRelief:false}},projectConstellationBrainSettings:{{liveHealth:{{enabled:false}}}}}}),set:async()=>{{}}}},onChanged:{{addListener:()=>{{}}}}}},runtime:{{sendMessage:async(msg)=>{{if(msg.type==='PC_BRAIN_INGEST_BATCH')window.__brain.push(...(msg.payload||[]));return {{ok:true}};}},onMessage:{{addListener:(fn)=>window.__listener=fn}}}}}};
        }}''')
        page.add_script_tag(content=core); page.add_script_tag(content=brain); page.add_script_tag(content=health); page.add_script_tag(content=content)
        page.wait_for_timeout(800)
        auth = page.evaluate("() => new Promise(resolve=>window.__listener({type:'PC_AUTH_STATUS'},null,resolve))")
        result = page.evaluate("""() => {const turns=window.__brain.filter(row=>row.type==='TURN_UPSERT');return {roles:turns.map(row=>row.data.role),chatIds:[...new Set(turns.map(row=>row.data.chatId))],turns:turns.length};}""")
        expected_turns = case.get('expected_turns', 2)
        assert result['turns'] == expected_turns
        if expected_turns:
            assert result['roles'] == ['user', 'assistant']
        assert auth['state'] == case['expected_state'] and not errors
        if not expected_turns:
            assert result['chatIds'] == []
        elif case['routed']:
            assert result['chatIds'] == [case['routed']]
        else:
            assert len(result['chatIds']) == 1 and result['chatIds'][0].startswith(case['id'] + ':session:')
        results.append({'provider': case['id'], 'auth': auth['state'], **result})
        page.close()
    print(json.dumps(results, sort_keys=True))
    browser.close()
