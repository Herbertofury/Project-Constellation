from playwright.sync_api import sync_playwright
import pathlib, json, os, tempfile, time

root = pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_BUILD', '/mnt/data/project-constellation/dist/project-constellation')).resolve()
with sync_playwright() as p:
    context = p.chromium.launch_persistent_context(
        tempfile.mkdtemp(prefix='project-constellation-smoke-'),
        channel='chromium',
        headless=True,
        args=[f'--disable-extensions-except={root}', f'--load-extension={root}', '--no-sandbox'],
        executable_path=(os.environ.get('PROJECT_CONSTELLATION_CHROMIUM') or None),
    )
    page = context.new_page()
    page.wait_for_timeout(500)
    deadline = time.time() + 10
    workers = []
    while time.time() < deadline:
        workers = [worker.url for worker in context.service_workers]
        if workers:
            break
        page.wait_for_timeout(100)
    print(json.dumps({'serviceWorkers': workers, 'root': str(root)}))
    assert workers, 'Project Constellation service worker did not load in extension-capable Chromium headless mode'
    context.close()
