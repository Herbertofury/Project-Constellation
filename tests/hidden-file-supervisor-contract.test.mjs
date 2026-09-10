import fs from 'node:fs';
import assert from 'node:assert/strict';

const supervisor = fs.readFileSync(new URL('../extension/src/tab-supervisor.js', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));

assert.equal(manifest.version, '0.16.2', 'hidden rich capture ships as v0.16.2');
assert.match(supervisor, /ProjectConstellationBrainCore/, 'hidden file lane reuses canonical brain IDs/normalization');
assert.match(supervisor, /async function scanHiddenFiles/, 'tab supervisor owns a bounded hidden file scan');
assert.match(supervisor, /if \(!document\.hidden/, 'hidden file lane must stay off in foreground where legacy rich capture already runs');
assert.match(supervisor, /hiddenFileDirty/, 'file-relevant mutations must be coalesced instead of scanning on every DOM mutation');
assert.match(supervisor, /lastHiddenFileScanAt/, 'hidden scans must be throttled');
assert.match(supervisor, /PC_BRAIN_INGEST_BATCH/, 'hidden file records must enter the canonical brain ingestion path');
assert.match(supervisor, /source:'hidden-tab-supervisor'/, 'hidden file records must preserve their capture provenance');
assert.match(supervisor, /response\?\.ok === true/, 'seen-file cache may advance only after canonical ingest acknowledges success');
assert.match(supervisor, /attributeFilter:\[[^\]]*'href'[^\]]*'data-testid'[^\]]*'aria-label'/, 'hidden supervisor observer must notice file-link and attachment attributes');
assert.match(supervisor, /if \(!healthRelevant && !fileRelevant\) return/, 'new file-only observer attributes must not create extra foreground supervisor evaluations');
assert.match(supervisor, /await scanHiddenFiles\(force\)/, 'every supervisor wake provides a forced hidden-file safety scan');

console.log('hidden-file-supervisor-contract.test.mjs: PASS');
