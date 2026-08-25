"""Interactive real-browser acceptance harness for Project Constellation.

This intentionally sits outside the normal CI suite because a truthful live ChatGPT
acceptance run needs a real Chromium/Chrome-compatible browser profile and, usually,
a signed-in user session. It loads the unpacked extension, opens ChatGPT, then asks
the extension service worker for the same canonical Live Sentinel state used by the
popup and Execution Pulse.

Useful environment variables:
  PROJECT_CONSTELLATION_BROWSER_EXECUTABLE=/path/to/chrome-or-chromium
  PROJECT_CONSTELLATION_BROWSER_PROFILE=/path/to/dedicated/profile
  PROJECT_CONSTELLATION_LIVE_URL=https://chatgpt.com/
  PROJECT_CONSTELLATION_MANUAL_LOGIN_SECONDS=90
  PROJECT_CONSTELLATION_BUILD=/path/to/unpacked/extension
"""
from playwright.sync_api import sync_playwright
import json, os, pathlib, tempfile, time

repo = pathlib.Path(__file__).resolve().parents[1]
build = pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_BUILD', repo / 'build' / 'unpacked')).resolve()
if not (build / 'manifest.json').exists():
    raise SystemExit(f'Unpacked extension not found: {build}. Run npm run build:dev first.')

manifest = json.loads((build / 'manifest.json').read_text())
expected_version = str(manifest.get('version') or '')
expected_id = 'geljambmkfjkhodgkpjhnmfojkpcamig'
executable = os.environ.get('PROJECT_CONSTELLATION_BROWSER_EXECUTABLE', '').strip() or None
profile_env = os.environ.get('PROJECT_CONSTELLATION_BROWSER_PROFILE', '').strip()
profile = pathlib.Path(profile_env).expanduser().resolve() if profile_env else pathlib.Path(tempfile.mkdtemp(prefix='project-constellation-live-'))
live_url = os.environ.get('PROJECT_CONSTELLATION_LIVE_URL', 'https://chatgpt.com/').strip()
manual_login = max(0, int(os.environ.get('PROJECT_CONSTELLATION_MANUAL_LOGIN_SECONDS', '0') or 0))

result = {
    'schema':'project-constellation-live-browser-acceptance',
    'expectedVersion':expected_version,
    'expectedExtensionId':expected_id,
    'browserExecutable':executable or 'playwright-chromium',
    'profile':str(profile),
    'liveUrl':live_url,
    'manifestLoaded':False,
    'extensionId':'',
    'serviceWorkers':[],
    'states':[],
    'error':''
}

try:
    with sync_playwright() as p:
        launch = {
            'headless':False,
            'args':['--no-sandbox', f'--disable-extensions-except={build}', f'--load-extension={build}', '--no-first-run', '--no-default-browser-check']
        }
        if executable:
            launch['executable_path'] = executable
        context = p.chromium.launch_persistent_context(str(profile), **launch)
        page = context.pages[0] if context.pages else context.new_page()
        page.goto(live_url, wait_until='domcontentloaded', timeout=30000)
        if manual_login:
            print(f'Live browser opened. Sign in if needed; waiting {manual_login}s before acceptance sampling...', flush=True)
            page.wait_for_timeout(manual_login * 1000)

        # Opening our popup is a portable way to wake the MV3 service worker.
        popup = context.new_page()
        popup.goto(f'chrome-extension://{expected_id}/popup.html', wait_until='domcontentloaded', timeout=15000)
        result['manifestLoaded'] = popup.evaluate('chrome.runtime.getManifest().version') == expected_version
        result['extensionId'] = popup.evaluate('chrome.runtime.id')

        deadline = time.time() + 10
        while time.time() < deadline and not context.service_workers:
            context.wait_for_event('serviceworker', timeout=1000)
        result['serviceWorkers'] = [worker.url for worker in context.service_workers]
        worker = next((w for w in context.service_workers if w.url.startswith(f'chrome-extension://{result["extensionId"]}/')), None)
        if not worker:
            raise RuntimeError('Project Constellation MV3 service worker did not start.')

        # Ask the real loaded extension for every currently open ChatGPT tab's canonical state.
        result['states'] = worker.evaluate("""async () => {
          const tabs = await chrome.tabs.query({ url:['https://chatgpt.com/*','https://chat.openai.com/*'] });
          const out=[];
          for (const tab of tabs) {
            let state=null, error='';
            try { state=await chrome.tabs.sendMessage(tab.id,{type:'PC_GET_LIVE_SENTINEL_STATE'}); }
            catch (e) { error=String(e?.message||e); }
            out.push({tabId:tab.id,title:tab.title,url:tab.url,state,error});
          }
          return out;
        }""")
        print(json.dumps(result, indent=2, sort_keys=True), flush=True)
        context.close()
except Exception as exc:
    result['error'] = str(exc)
    print(json.dumps(result, indent=2, sort_keys=True), flush=True)
    raise SystemExit(2)

if not result['manifestLoaded'] or result['extensionId'] != expected_id:
    raise SystemExit(3)
