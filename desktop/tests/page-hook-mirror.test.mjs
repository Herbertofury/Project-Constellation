import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const packaged=await fs.readFile(new URL('../browser-companion/page-hook.js',import.meta.url));
const canonical=await fs.readFile(new URL('../../extension/src/local-work-page-hook.js',import.meta.url));
assert.deepEqual(packaged,canonical,'desktop packaged page hook must remain byte-identical to canonical extension hook');
console.log('page-hook-mirror.test.mjs: PASS');
