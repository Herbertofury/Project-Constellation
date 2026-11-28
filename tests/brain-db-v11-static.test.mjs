import assert from 'node:assert/strict';
import fs from 'node:fs';
const bg=fs.readFileSync(new URL('../extension/background.js', import.meta.url),'utf8');
assert.match(bg,/const DB_VERSION = 11;/);
for(const name of ['providerHealth','incidentRecipes','migrationReceipts']) assert.ok(bg.includes(name), `missing ${name}`);
assert.match(bg,/createSharedConnection/);
assert.match(bg,/brain-db:v\$\{DB_VERSION\}/);
console.log('brain db v11 static PASS');
