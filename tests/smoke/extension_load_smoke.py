from playwright.sync_api import sync_playwright
import pathlib, json, os, tempfile

root = pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_BUILD', '/mnt/data/project-constellation/build/unpacked')).resolve()
extension_id = 'geljambmkfjkhodgkpjhnmfojkpcamig'

with sync_playwright() as p:
    launch = {
        'user_data_dir': tempfile.mkdtemp(prefix='project-constellation-smoke-'),
        'channel': 'chromium',
        'headless': True,
        'args': [f'--disable-extensions-except={root}', f'--load-extension={root}', '--no-sandbox'],
    }
    if os.environ.get('PROJECT_CONSTELLATION_CHROMIUM'):
        launch['executable_path'] = os.environ['PROJECT_CONSTELLATION_CHROMIUM']
    context = p.chromium.launch_persistent_context(**launch)
    page = context.new_page()
    page.goto(f'chrome-extension://{extension_id}/popup.html', wait_until='domcontentloaded')
    proof = page.evaluate('''async () => {
      const manifest = chrome.runtime.getManifest();
      const response = await chrome.runtime.sendMessage({ type:'PC_BRAIN_SETTINGS_GET' });
      return {
        id: chrome.runtime.id,
        version: manifest.version,
        name: manifest.name,
        runtimeOk: Boolean(response?.ok),
        hasSettings: Boolean(response?.settings)
      };
    }''')
    print(json.dumps({'extension': proof, 'root': str(root)}, sort_keys=True))
    assert proof['id'] == extension_id, proof
    assert proof['version'] == '0.16.0', proof
    assert proof['runtimeOk'], f'Project Constellation runtime message round-trip failed: {proof}'
    assert proof['hasSettings'], f'Project Constellation settings handler did not answer: {proof}'
    context.close()
