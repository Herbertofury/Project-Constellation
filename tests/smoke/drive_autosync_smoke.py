from playwright.sync_api import sync_playwright
import pathlib, os, tempfile, json, shutil, time

source_root = pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_BUILD', '/mnt/data/project-constellation/build/unpacked')).resolve()
extension_id = 'geljambmkfjkhodgkpjhnmfojkpcamig'
profile_root = pathlib.Path(tempfile.mkdtemp(prefix='project-constellation-drive-policy-'))
extension_root = profile_root / 'extension'
shutil.copytree(source_root, extension_root)
manifest_path = extension_root / 'manifest.json'
manifest = json.loads(manifest_path.read_text())
manifest['oauth2'] = {
    'client_id': '123456789012-abcdefghijklmnopqrstuvwxyz.apps.googleusercontent.com',
    'scopes': ['https://www.googleapis.com/auth/drive.file']
}
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
headless = os.environ.get('PROJECT_CONSTELLATION_HEADFUL') != '1'

with sync_playwright() as p:
    context = p.chromium.launch_persistent_context(
        str(profile_root / 'profile'),
        channel='chromium',
        headless=headless,
        args=[f'--disable-extensions-except={extension_root}', f'--load-extension={extension_root}', '--no-sandbox'],
        executable_path=(os.environ.get('PROJECT_CONSTELLATION_CHROMIUM') or None),
    )
    print('drive-autosync: browser launched', flush=True)
    page = context.new_page()
    page.set_default_timeout(8000)
    page.goto(f'chrome-extension://{extension_id}/popup.html', wait_until='domcontentloaded', timeout=10000)
    print('drive-autosync: extension page loaded', flush=True)

    ready = page.evaluate('''async () => Promise.race([
      chrome.runtime.sendMessage({ type:'PC_PROVIDER_LIST' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('runtime probe timeout')), 5000))
    ])''')
    assert ready.get('ok'), ready
    print('drive-autosync: runtime ready', flush=True)

    setup = page.evaluate('''async () => {
      const key = 'projectConstellationBrainSettings';
      const guardKey = 'projectConstellationDriveSyncGuardStatus';
      const evidenceKey = 'projectConstellationDriveAutoSyncConnectedAt';
      const alarmName = 'project-constellation-drive-sync';
      const guardStatus = (await chrome.storage.local.get(guardKey))[guardKey] || {};
      const stored = (await chrome.storage.local.get(key))[key] || {};
      await chrome.storage.local.remove(evidenceKey);
      await chrome.storage.local.set({ [key]: {
        ...stored,
        drive: {
          ...(stored.drive || {}), autoSync:true, lastStatus:'not-connected', lastError:'',
          folderId:'', snapshotFileId:'', journalFileId:'', indexFileId:'', lastSyncAt:0, lastRestoreAt:0,
          debounceMs:60000, minSyncIntervalMs:60000
        }
      }});
      await chrome.alarms.clear(alarmName);
      return { guardStatus, version:chrome.runtime.getManifest().version, oauthProvisioned:Boolean(chrome.runtime.getManifest().oauth2?.client_id) };
    }''')
    print('drive-autosync: disconnected state seeded', flush=True)
    assert setup['version'] == '0.16.2', setup
    assert setup['oauthProvisioned'], setup
    assert setup['guardStatus'].get('active') and setup['guardStatus'].get('createPatched') and setup['guardStatus'].get('listenerPatched'), setup

    disconnected = page.evaluate('''async () => {
      const send = (message) => Promise.race([
        chrome.runtime.sendMessage(message),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`runtime timeout: ${message.type}`)), 5000))
      ]);
      const created = await send({ type:'PC_ORG_PROJECT_CREATE', input:{ name:'Drive policy smoke never connected' } });
      await new Promise(r => setTimeout(r, 250));
      const dirty = (await chrome.storage.local.get('projectConstellationDriveDirtyAt')).projectConstellationDriveDirtyAt || 0;
      const alarm = await chrome.alarms.get('project-constellation-drive-sync');
      return { createdOk:Boolean(created?.ok), dirty:Number(dirty), alarm:Boolean(alarm) };
    }''')
    print('drive-autosync: disconnected mutation checked', flush=True)
    assert disconnected['createdOk'] and disconnected['dirty'] > 0, disconnected
    assert not disconnected['alarm'], disconnected

    # Create the stale alarm from the popup context, which is intentionally outside the service-worker hook.
    page.evaluate("chrome.alarms.create('project-constellation-drive-sync', { when:Date.now() + 150 })")
    time.sleep(1.5)
    stale = page.evaluate('''async () => {
      const settings = (await chrome.storage.local.get('projectConstellationBrainSettings')).projectConstellationBrainSettings || {};
      const alarm = await chrome.alarms.get('project-constellation-drive-sync');
      return { status:settings?.drive?.lastStatus || '', error:settings?.drive?.lastError || '', alarm:Boolean(alarm) };
    }''')
    print('drive-autosync: stale alarm checked', flush=True)
    assert stale['status'] == 'not-connected' and not stale['error'], stale
    assert not stale['alarm'], stale

    connected = page.evaluate('''async () => {
      const key = 'projectConstellationBrainSettings';
      const stored = (await chrome.storage.local.get(key))[key] || {};
      await chrome.storage.local.set({ [key]: { ...stored, drive:{ ...(stored.drive || {}), autoSync:true, lastStatus:'verified', lastError:'', debounceMs:60000, minSyncIntervalMs:60000 } } });
      await new Promise(r => setTimeout(r, 400));
      const evidence = Number((await chrome.storage.local.get('projectConstellationDriveAutoSyncConnectedAt')).projectConstellationDriveAutoSyncConnectedAt || 0);
      const send = (message) => Promise.race([
        chrome.runtime.sendMessage(message),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`runtime timeout: ${message.type}`)), 5000))
      ]);
      const created = await send({ type:'PC_ORG_PROJECT_CREATE', input:{ name:'Drive policy smoke connected' } });
      await new Promise(r => setTimeout(r, 250));
      const alarm = await chrome.alarms.get('project-constellation-drive-sync');
      return { createdOk:Boolean(created?.ok), evidence, alarm:Boolean(alarm) };
    }''')
    print('drive-autosync: connected scheduling checked', flush=True)
    assert connected['createdOk'] and connected['evidence'] > 0 and connected['alarm'], connected

    # Simulate the state mutation performed by the existing explicit Disconnect handler. The guard owns alarm/evidence cleanup.
    disconnected_again = page.evaluate('''async () => {
      const key = 'projectConstellationBrainSettings';
      const stored = (await chrome.storage.local.get(key))[key] || {};
      await chrome.storage.local.set({ [key]: { ...stored, drive:{ ...(stored.drive || {}), lastStatus:'disconnected', lastError:'' } } });
      await new Promise(r => setTimeout(r, 400));
      const evidence = Number((await chrome.storage.local.get('projectConstellationDriveAutoSyncConnectedAt')).projectConstellationDriveAutoSyncConnectedAt || 0);
      const alarm = await chrome.alarms.get('project-constellation-drive-sync');
      return { evidence, alarm:Boolean(alarm) };
    }''')
    print('drive-autosync: disconnect cleanup checked', flush=True)
    assert disconnected_again['evidence'] == 0 and not disconnected_again['alarm'], disconnected_again

    proof = {
        'guardActive': bool(setup['guardStatus'].get('active')),
        'dirtyPreserved': disconnected['dirty'] > 0,
        'neverConnectedScheduled': disconnected['alarm'],
        'staleAlarmStatus': stale['status'],
        'staleAlarmRemaining': stale['alarm'],
        'connectedEvidence': connected['evidence'],
        'connectedScheduled': connected['alarm'],
        'disconnectCleared': disconnected_again['evidence'] == 0 and not disconnected_again['alarm'],
    }
    print(json.dumps(proof, sort_keys=True), flush=True)
    context.close()
