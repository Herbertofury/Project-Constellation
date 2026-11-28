"""Require a real installed extension worker and an answering runtime.

A browser that launches but ignores --load-extension is not a passing check.
This uses an isolated temporary profile and never the owner's browser profile.
"""
from playwright.sync_api import sync_playwright
from pathlib import Path
import json
import os
import tempfile

repo = Path(__file__).resolve().parents[2]
root = Path(os.environ.get('PROJECT_CONSTELLATION_BUILD', str(repo / 'build/unpacked'))).resolve()
manifest = json.loads((root / 'manifest.json').read_text())
extension_id = 'geljambmkfjkhodgkpjhnmfojkpcamig'

with tempfile.TemporaryDirectory(prefix='project-constellation-load-') as profile, sync_playwright() as p:
    context = p.chromium.launch_persistent_context(
        profile, channel='chromium', headless=True,
        args=[f'--disable-extensions-except={root}', f'--load-extension={root}', '--no-sandbox'],
        executable_path=os.environ.get('PROJECT_CONSTELLATION_CHROMIUM') or None,
    )
    try:
        workers = context.service_workers
        worker = workers[0] if workers else context.wait_for_event('serviceworker', timeout=15000)
        expected_worker = f"chrome-extension://{extension_id}/{manifest['background']['service_worker']}"
        assert worker.url == expected_worker, {'expected': expected_worker, 'actual': worker.url}
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(f'chrome-extension://{extension_id}/popup.html', wait_until='domcontentloaded', timeout=15000)
        runtime = page.evaluate('''async () => {
          const reply = await Promise.race([
            chrome.runtime.sendMessage({type:'PC_PROVIDER_LIST'}),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Installed runtime did not answer')), 5000))
          ]);
          return {id:chrome.runtime.id, version:chrome.runtime.getManifest().version,
            ok:reply?.ok===true, providerCount:reply?.providers?.length||0};
        }''')
        assert runtime['id'] == extension_id and runtime['version'] == manifest['version'], runtime
        assert runtime['ok'] and runtime['providerCount'] > 0, runtime
        assert page.locator('body').inner_text().strip(), 'Installed popup rendered no content'
        assert not errors, errors
        print(json.dumps({'passed': True, 'serviceWorker': worker.url, 'runtime': runtime, 'popup': 'rendered'}))
    finally:
        context.close()
