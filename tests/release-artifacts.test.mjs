import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sha256, verifyArtifact, verifyWindowsDesktop, verifyWindowsSetup, verifyLinuxMonitor, stageWindowsDesktop} from '../tools/release-artifacts.mjs';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'constellation-release-'));
const expected = {version: '0.25.0', sourceCommit: 'a'.repeat(40)};
const write = (name, value) => fs.writeFileSync(path.join(directory, name), typeof value === 'string' ? value : JSON.stringify(value));
const artifact = name => {
  write(name, `actual bytes: ${name}`);
  return {file: name, bytes: fs.statSync(path.join(directory, name)).size, sha256: sha256(path.join(directory, name))};
};
try {
  const portable = artifact('Project-Constellation-Desktop-0.25.0-x64.zip');
  const desktopSetup = artifact('Project-Constellation-Desktop-0.25.0-x64.exe');
  const desktop = {
    schema: 'project-constellation-windows-runtime-v1', ...expected, sourceDirty: false,
    platform: 'windows-latest', nativeComputerUse: 'PASS', nativeComputerTools: 'PASS', integratedElectron: 'PASS', packagedPortable: 'PASS', gracefulShutdown: 'PASS',
    portableFile: portable.file, portableSize: portable.bytes, portableSha256: portable.sha256,
    setupFile: desktopSetup.file, setupSize: desktopSetup.bytes, setupSha256: desktopSetup.sha256,
  };
  const desktopReceipt = 'WINDOWS-RUNTIME-RECEIPT.json';
  write(desktopReceipt, '\uFEFF' + JSON.stringify(desktop));
  assert.equal(verifyWindowsDesktop(directory, expected).portable, path.join(directory, portable.file));
  // An older ZIP alongside the current one cannot be selected by glob order.
  artifact('Project-Constellation-Desktop-0.20.0-x64.zip');
  assert.equal(verifyWindowsDesktop(directory, expected).portable, path.join(directory, portable.file));
  write(desktopReceipt, {...desktop, version: '0.20.0'});
  assert.throws(() => verifyWindowsDesktop(directory, expected), /version/);
  write(desktopReceipt, {...desktop, sourceCommit: 'b'.repeat(40)});
  assert.throws(() => verifyWindowsDesktop(directory, expected), /source/);
  for (const sourceDirty of [true, undefined]) {
    write(desktopReceipt, {...desktop, sourceDirty});
    assert.throws(() => verifyWindowsDesktop(directory, expected), /dirty or unverified/);
  }
  write(desktopReceipt, {...desktop, packagedPortable: 'SKIPPED'});
  assert.throws(() => verifyWindowsDesktop(directory, expected), /did not pass/);
  write(desktopReceipt, {...desktop, nativeComputerTools: 'FAIL'});
  assert.throws(() => verifyWindowsDesktop(directory, expected), /nativeComputerTools/);
  write(desktopReceipt, desktop);
  const published = path.join(directory, 'published');
  fs.mkdirSync(published);
  const staged = stageWindowsDesktop(published, verifyWindowsDesktop(directory, expected), expected.version);
  assert.equal(path.basename(staged.portable), 'Project-Constellation-v0.25.0-Windows-Portable.zip');
  assert.equal(path.basename(staged.setup), 'Project-Constellation-v0.25.0-Windows-Desktop-Setup.exe');
  assert.equal(staged.receipt.buildArtifacts.portableFile, portable.file);
  assert.equal(JSON.parse(fs.readFileSync(path.join(published, staged.receipt.buildReceipt), 'utf8').replace(/^\uFEFF/, '')).portableFile, portable.file);
  write(portable.file, 'x'.repeat(portable.bytes));
  assert.throws(() => verifyWindowsDesktop(directory, expected), /SHA-256/);
  for (const name of ['../outside.zip', '..\\outside.zip', '/tmp/a.zip', 'C:a.zip', 'valid.zip ']) {
    assert.throws(() => verifyArtifact(directory, {...portable, file: name}), /Unsafe/);
  }
  // Symlink creation requires extra privileges on Windows, so exercise this
  // filesystem boundary wherever the host supports unprivileged symlinks.
  if (process.platform !== 'win32') {
    fs.symlinkSync(path.join(directory, desktopSetup.file), path.join(directory, 'alias.exe'));
    assert.throws(() => verifyArtifact(directory, {...desktopSetup, file: 'alias.exe'}), /regular file/);
  }
  const quickSetup = artifact('Constellation-0.25.0-Windows-Setup.exe');
  const build = {...expected, sourceDirty: false, acceptanceFixture: false, computerLinkIncluded: true, embeddedPayloadVerified: true, artifact: quickSetup};
  const acceptance = {...expected, platform: 'win32', passed: true, acceptanceFixture: false, artifact: quickSetup,
    checks: ['install', 'repair', 'diagnostics', 'rollback', 'rollback-manager-repair', 'uninstall', 'setup-gui', 'owner-gui', 'integrations-restored'].map(name => ({name, passed: true}))};
  write('windows-setup-receipt.json', build);
  write('windows-setup-acceptance.json', acceptance);
  assert.equal(verifyWindowsSetup(directory, expected).setup, path.join(directory, quickSetup.file));
  for (const mutation of [{sourceDirty: true}, {acceptanceFixture: true}, {acceptanceFixture: undefined}, {computerLinkIncluded: false}]) {
    write('windows-setup-receipt.json', {...build, ...mutation});
    assert.throws(() => verifyWindowsSetup(directory, expected));
  }
  write('windows-setup-receipt.json', build);
  for (const mutation of [{platform: 'linux'}, {passed: false}, {checks: []}, {checks: acceptance.checks.slice(1)}, {artifact: {...quickSetup, sha256: '0'.repeat(64)}}]) {
    write('windows-setup-acceptance.json', {...acceptance, ...mutation});
    assert.throws(() => verifyWindowsSetup(directory, expected));
  }
  // Every required acceptance route must be present; a generic passed flag is insufficient.
  for (const omitted of acceptance.checks.map(check => check.name)) {
    write('windows-setup-acceptance.json', {...acceptance, checks: acceptance.checks.filter(check => check.name !== omitted)});
    assert.throws(() => verifyWindowsSetup(directory, expected), /Missing Windows acceptance/);
  }
  const monitor = {version: expected.version, source_commit: expected.sourceCommit, source_dirty: false,
    build: {version: expected.version, mode: 'production'}, artifacts: [artifact('Constellation-0.25.0-Firefox-Sensor.zip'), artifact('Constellation-0.25.0-Linux-Browser-Hub.zip')]};
  write('artifact-receipt.json', monitor);
  assert.equal(verifyLinuxMonitor(directory, expected).files.length, 2);
  write('artifact-receipt.json', {...monitor, source_dirty: true});
  assert.throws(() => verifyLinuxMonitor(directory, expected), /dirty/);
  write('artifact-receipt.json', {...monitor, artifacts: [...monitor.artifacts, monitor.artifacts[0]]});
  assert.throws(() => verifyLinuxMonitor(directory, expected), /exactly one/);

  // Exercise the actual build output, not only its provisioned metadata. A
  // broad token replacement once rewrote the runtime's placeholder guard too,
  // causing it to reject the very public client ID the build had configured.
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const fixture=path.join(directory,'oauth-build');
  fs.mkdirSync(path.join(fixture,'tools'),{recursive:true});
  fs.mkdirSync(path.join(fixture,'docs'));
  fs.copyFileSync(path.join(root,'tools/build.mjs'),path.join(fixture,'tools/build.mjs'));
  fs.cpSync(path.join(root,'extension'),path.join(fixture,'extension'),{recursive:true});
  for(const name of ['AGENT-MONITOR.md','MONITOR-VERIFICATION.md'])fs.copyFileSync(path.join(root,'docs',name),path.join(fixture,'docs',name));
  const originalManifest=JSON.parse(fs.readFileSync(path.join(fixture,'extension/manifest.json'),'utf8'));
  const google='123456789012-abcdefghijklmnopqrstuvwxyz123456.apps.googleusercontent.com';
  const github='SyntheticClient0123456789';
  const runtimeIds=(background,manifest)=>{
    const declaration=background.match(/^const BUILT_GITHUB_CLIENT_ID = [^\n]+;/m)?.[0];
    const githubGetter=background.match(/^function githubClientId\(cfg = null\) \{[\s\S]*?^\}/m)?.[0];
    const googleGetter=background.match(/^function googleOAuthClientId\(\) \{[^\n]+\}/m)?.[0];
    const googleReady=background.match(/^function googleOAuthProvisioned\(\) \{[\s\S]*?^\}/m)?.[0];
    assert.ok(declaration&&githubGetter&&googleGetter&&googleReady,'actual shipped client-resolution functions are present');
    return JSON.parse(vm.runInNewContext(`${declaration}\n${githubGetter}\n${googleGetter}\n${googleReady}\nJSON.stringify({github:githubClientId(),google:googleOAuthClientId(),googleReady:googleOAuthProvisioned()})`,
      {chrome:{runtime:{getManifest:()=>manifest}}},{timeout:1000}));
  };
  const buildWithOAuth=(mode,googleId='',githubId='',extra=[])=>{
    const result=spawnSync(process.execPath,[path.join(fixture,'tools/build.mjs'),`--mode=${mode}`,...extra],{
      cwd:fixture,encoding:'utf8',env:{...process.env,PROJECT_CONSTELLATION_GOOGLE_CLIENT_ID:googleId,PROJECT_CONSTELLATION_GITHUB_CLIENT_ID:githubId}});
    if(result.status!==0)return {result};
    const manifest=JSON.parse(fs.readFileSync(path.join(fixture,'build/unpacked/manifest.json'),'utf8'));
    const background=fs.readFileSync(path.join(fixture,'build/unpacked/background.js'),'utf8');
    return {result,manifest,background,ids:runtimeIds(background,manifest),info:JSON.parse(fs.readFileSync(path.join(fixture,'build/build-info.json'),'utf8'))};
  };
  const production=buildWithOAuth('production',` ${google} `,` ${github} `);
  assert.equal(production.result.status,0,production.result.stderr);
  assert.deepEqual(production.ids,{github,google,googleReady:true},'production-generated runtime must return its configured public IDs');
  assert.deepEqual(production.info.oauth,{google:true,github:true});
  assert.equal(production.manifest.key,originalManifest.key,'OAuth injection preserves the stable extension identity');
  assert.equal(production.manifest.version,expected.version);
  assert.deepEqual(runtimeIds(fs.readFileSync(path.join(fixture,'extension/background.js'),'utf8'),originalManifest),{github:'',google:originalManifest.oauth2.client_id,googleReady:false},'unbuilt placeholders never qualify as provisioned IDs');
  for(const [googleId,githubId] of [['',''],['invalid-google','invalid-github'],['123-placeholderabcdefghijklmnopqrst.apps.googleusercontent.com','placeholderClient12345']]){
    const development=buildWithOAuth('development',googleId,githubId);
    assert.equal(development.result.status,0,development.result.stderr);
    assert.deepEqual(development.ids,{github:'',google:'',googleReady:false});
    assert.deepEqual(development.info.oauth,{google:false,github:false});
  }
  for(const [googleId,githubId,provider] of [[google,'','GITHUB'],['',github,'GOOGLE'],[google,'PROJECT_CONSTELLATION_GITHUB_CLIENT_ID','GITHUB'],['PROJECT_CONSTELLATION_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com',github,'GOOGLE'],[google,'placeholderClient12345','GITHUB'],['123-placeholderabcdefghijklmnopqrst.apps.googleusercontent.com',github,'GOOGLE'],[google,'bad-id','GITHUB'],['invalid-google',github,'GOOGLE']]){
    const rejected=buildWithOAuth('production',googleId,githubId);
    assert.notEqual(rejected.result.status,0,'invalid production IDs must fail the build');
    assert.match(rejected.result.stderr,new RegExp(`PROJECT_CONSTELLATION_${provider}_CLIENT_ID`));
  }
  const unprovisioned=buildWithOAuth('production','','',['--allow-unprovisioned-oauth']);
  assert.equal(unprovisioned.result.status,0,unprovisioned.result.stderr);
  assert.deepEqual(unprovisioned.ids,{github:'',google:'',googleReady:false});
  assert.deepEqual(unprovisioned.info.oauth,{google:false,github:false});
  console.log('release-artifacts: PASS (stale builds, source mismatch, tampering, traversal, acceptance fixtures, missing Windows gates, production OAuth runtime behavior)');
} finally {
  fs.rmSync(directory, {recursive: true, force: true});
}
