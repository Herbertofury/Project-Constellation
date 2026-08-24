import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = process.env.PROJECT_CONSTELLATION_ROOT ? path.resolve(process.env.PROJECT_CONSTELLATION_ROOT) : path.join(repoRoot, 'extension');
const surfaces = [['home.html','home.js'],['sidepanel.html','sidepanel.js'],['popup.html','popup.js']];
const delegated = ['view','jump','layout-toggle','layout-preset','density','theme-choice','primary-side','panel-position','panel-tab','command','dialog-close','sidebar-section','inspector-tab','tab'];
const failures = [];
const delegatedOwner = (attrs, js) => {
  for (const name of delegated) {
    if (!attrs.includes(`data-${name}`)) continue;
    const camel=name.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
    return js.includes(`data-${name}`) || js.includes(`dataset.${camel}`) || js.includes(`dataset['${camel}']`);
  }
  return false;
};
for (const [htmlName, jsName] of surfaces) {
  const html=fs.readFileSync(path.join(root,htmlName),'utf8');
  const js=fs.readFileSync(path.join(root,jsName),'utf8');
  for (const match of html.matchAll(/<button\b([^>]*)>/gi)) {
    const attrs=match[1];
    const id=attrs.match(/\bid=["']([^"']+)["']/i)?.[1] || '';
    const type=attrs.match(/\btype=["']([^"']+)["']/i)?.[1]?.toLowerCase() || '';
    const directOwned=id && (js.includes(`$('${id}')`) || js.includes(`$(\"${id}\")`) || js.includes(`getElementById('${id}')`) || js.includes(`getElementById(\"${id}\")`) || js.includes(`'${id}'`) || js.includes(`\"${id}\"`));
    const formOwned=type==='submit' && /addEventListener\(['"]submit['"]/.test(js);
    const delegatedOwned=delegatedOwner(attrs,js);
    if (!directOwned && !formOwned && !delegatedOwned) failures.push(`${htmlName}: button${id?` #${id}`:''} has no JavaScript owner: <button${attrs}>`);
  }
  for (const banned of [/Coming soon/i,/\bTODO\b/i,/href=["']#["']/i]) if (banned.test(html)) failures.push(`${htmlName}: placeholder/dead UI marker ${banned}`);
}
if (failures.length) throw new Error(`UI contract failed:\n- ${failures.join('\n- ')}`);
console.log('ui-contract.mjs: PASS');
