from playwright.sync_api import sync_playwright
import pathlib, json, os, tempfile

root = pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_BUILD', '/mnt/data/project-constellation/dist/project-constellation')).resolve()
extension_id = 'geljambmkfjkhodgkpjhnmfojkpcamig'

with sync_playwright() as p:
    context = p.chromium.launch_persistent_context(
        tempfile.mkdtemp(prefix='project-constellation-smoke-'),
        channel='chromium',
        headless=True,
        args=[f'--disable-extensions-except={root}', f'--load-extension={root}', '--no-sandbox'],
        executable_path=(os.environ.get('PROJECT_CONSTELLATION_CHROMIUM') or None),
    )
    page = context.new_page()
    extension_url = f'chrome-extension://{extension_id}/popup.html'
    page.goto(extension_url, wait_until='domcontentloaded')
    proof = page.evaluate('''async () => {
      const manifest = chrome.runtime.getManifest();
      const response = await Promise.race([
        chrome.runtime.sendMessage({ type:'PC_PROVIDER_LIST' }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('runtime probe timeout')), 5000))
      ]);
      return {
        id: chrome.runtime.id,
        version: manifest.version,
        name: manifest.name,
        runtimeOk: Boolean(response?.ok),
        providerCount: Array.isArray(response?.providers) ? response.providers.length : 0
      };
    }''')
    print(json.dumps({'extension': proof, 'root': str(root)}, sort_keys=True))
    assert proof['id'] == extension_id, proof
    assert proof['version'] == '0.16.1', proof
    assert proof['runtimeOk'], f'Project Constellation runtime message round-trip failed: {proof}'
    assert proof['providerCount'] > 0, f'Project Constellation provider handler did not answer: {proof}'
    context.close()
