import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'extension');
const manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'),'utf8'));
const output=path.join(root,'build','firefox-sensor');
fs.rmSync(output,{recursive:true,force:true});
fs.mkdirSync(path.join(output,'src'),{recursive:true});
fs.mkdirSync(path.join(output,'assets'),{recursive:true});
fs.mkdirSync(path.join(output,'docs'),{recursive:true});
for(const name of ['AGENT-MONITOR.md','MONITOR-VERIFICATION.md'])fs.copyFileSync(path.join(root,'docs',name),path.join(output,'docs',name));
const files=['agent-monitor.html','agent-monitor.css','agent-monitor.js','sensor-background.js',
  'src/sensor-api.js','src/provider-core.js','src/state-event-bus-core.js','src/attention-service.js',
  'src/attention-background.js','src/attention-audio.js','src/native-monitor-bridge.js','src/browser-monitor-sensor.js','assets/attention-icon.png'];
for(const name of files){
  const from=path.join(source,name);if(!fs.existsSync(from))throw new Error(`Missing Firefox sensor runtime: ${name}`);
  fs.copyFileSync(from,path.join(output,name));
}
// Firefox is a monitoring sensor, not an unverified port of the complete desktop/backup UI.
const html=fs.readFileSync(path.join(output,'agent-monitor.html'),'utf8')
  .replace(/\s*<a class="nav-link" href="(?:home|chat-vault)\.html[^\"]*">[^]*?<\/a>/g,'')
  .replace('AGENT WORKSPACE','FIREFOX SENSOR');
fs.writeFileSync(path.join(output,'agent-monitor.html'),html);
const hosts=manifest.host_permissions.filter(x=>x.startsWith('https:'));
const firefox={manifest_version:3,name:'Constellation Browser Sensor',version:manifest.version,
  description:'Observe agent chat problems in Firefox and share local status with your Constellation browser hub.',
  browser_specific_settings:{gecko:{id:'constellation-monitor@project-constellation.local',strict_min_version:'128.0'}},
  permissions:['storage','tabs','alarms','notifications'],optional_permissions:['nativeMessaging'],host_permissions:hosts,
  background:{scripts:['sensor-background.js'],type:'module'},action:{default_title:'Open Constellation Agent Monitor'},
  icons:{128:'assets/attention-icon.png'},
  content_scripts:[{matches:hosts,js:['src/browser-monitor-sensor.js'],run_at:'document_idle'}]};
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(firefox,null,2)+'\n');
fs.writeFileSync(path.join(output,'INSTALL.txt'),`Constellation Firefox Sensor ${manifest.version}\n\nOpen about:debugging#/runtime/this-firefox, choose Load Temporary Add-on, and select manifest.json.\nOpen Agent Monitor, click Connect browser hub, and allow native messaging.\nThe Rust companion must first be registered with its install command.\nFirefox temporary add-ons are removed when Firefox restarts. A permanent Firefox release requires Mozilla signing; this development package is unsigned.\n\nThe Chrome, Edge and Opera GX package is build/unpacked. Full hidden-tab monitoring requires a connected sensor in every browser/profile.\n`);
console.log(`Firefox sensor built: ${output} (${files.length+4} files, unsigned development package)`);
