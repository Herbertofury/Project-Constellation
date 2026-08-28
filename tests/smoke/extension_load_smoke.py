from playwright.sync_api import sync_playwright
import pathlib, json, os, tempfile
root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_BUILD','/mnt/data/project-constellation/dist/project-constellation')).resolve()
with sync_playwright() as p:
    context=p.chromium.launch_persistent_context(tempfile.mkdtemp(prefix='project-constellation-smoke-'),headless=True,args=[f'--disable-extensions-except={root}',f'--load-extension={root}','--no-sandbox'],executable_path=(os.environ.get('PROJECT_CONSTELLATION_CHROMIUM') or None))
    workers=[]
    context.on('serviceworker',lambda worker:workers.append(worker.url))
    page=context.new_page();page.wait_for_timeout(1500)
    print(json.dumps({'serviceWorkers':workers,'root':str(root)}));context.close()
