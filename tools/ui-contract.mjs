import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = process.env.PROJECT_CONSTELLATION_ROOT ? path.resolve(process.env.PROJECT_CONSTELLATION_ROOT) : path.join(repoRoot, 'extension');
const surfaces = [
  { html:'home.html', js:['home.js'] },
  { html:'sidepanel.html', js:['sidepanel.js'] },
  { html:'popup.html', js:['popup.js','popup-organizer.js','src/ui-qol.js'] },
  { html:'chat-vault.html', js:['chat-vault.js','src/closed-chat-watch-ui.js','src/ui-qol.js'] }
];
const delegated = ['view','jump','layout-toggle','layout-preset','density','theme-choice','primary-side','panel-position','panel-tab','command','dialog-close','sidebar-section','inspector-tab','tab','tag','chat-bucket'];
const failures = [];

const delegatedOwner = (attrs, js) => {
  for (const name of delegated) {
    if (!attrs.includes(`data-${name}`)) continue;
    const camel = name.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
    return js.includes(`data-${name}`) || js.includes(`dataset.${camel}`) || js.includes(`dataset['${camel}']`) || js.includes(`dataset?.${camel}`);
  }
  return false;
};

for (const surface of surfaces) {
  const html = fs.readFileSync(path.join(root,surface.html),'utf8');
  const js = surface.js.map((name) => fs.readFileSync(path.join(root,name),'utf8')).join('\n');
  for (const match of html.matchAll(/<button\b([^>]*)>/gi)) {
    const attrs = match[1];
    const id = attrs.match(/\bid=["']([^"']+)["']/i)?.[1] || '';
    const type = attrs.match(/\btype=["']([^"']+)["']/i)?.[1]?.toLowerCase() || '';
    const directOwned = id && (
      js.includes(`$('${id}')`) || js.includes(`$(\"${id}\")`) ||
      js.includes(`getElementById('${id}')`) || js.includes(`getElementById(\"${id}\")`) ||
      js.includes(`'${id}'`) || js.includes(`\"${id}\"`)
    );
    const formOwned = type === 'submit' && /addEventListener\(['"]submit['"]/.test(js);
    const delegatedOwned = delegatedOwner(attrs,js);
    if (!directOwned && !formOwned && !delegatedOwned) failures.push(`${surface.html}: button${id?` #${id}`:''} has no JavaScript owner: <button${attrs}>`);
  }
  for (const banned of [/Coming soon/i,/\bTODO\b/i,/href=["']#["']/i]) if (banned.test(html)) failures.push(`${surface.html}: placeholder/dead UI marker ${banned}`);
}

if (failures.length) throw new Error(`UI contract failed:\n- ${failures.join('\n- ')}`);
console.log('ui-contract.mjs: PASS');
