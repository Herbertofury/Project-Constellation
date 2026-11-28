import assert from 'node:assert/strict';
import fs from 'node:fs';
const m=JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url),'utf8'));
for(const permission of ['storage','sidePanel','tabs','alarms','identity','unlimitedStorage','idle','offscreen','webRequest','scripting','notifications','tabGroups','contextMenus']) assert.ok(m.permissions.includes(permission),`missing permission ${permission}`);
for(const host of ['https://chatgpt.com/*','https://claude.ai/*','https://gemini.google.com/*','https://grok.com/*','https://perplexity.ai/*','https://copilot.microsoft.com/*','http://127.0.0.1:47721/*']) assert.ok(m.host_permissions.includes(host),`missing host ${host}`);
console.log('full permissions regression PASS');
