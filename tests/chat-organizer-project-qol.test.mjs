import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const read=(rel)=>fs.readFileSync(path.join(root,rel),'utf8');
const manifest=JSON.parse(read('extension/manifest.json'));
const organizer=read('extension/src/chat-organizer.js');
const background=read('extension/background.js');
const vaultHtml=read('extension/chat-vault.html');
const vaultJs=read('extension/chat-vault.js');
const sideHtml=read('extension/sidepanel.html');
const sideJs=read('extension/sidepanel.js');

const script=manifest.content_scripts.find((entry)=>entry.js?.includes('src/chat-organizer.js'));
assert.ok(script,'ChatGPT organizer registration is required');
assert.deepEqual(script.js.slice(-3),['src/project-identity-core.js','src/chat-vault-core.js','src/chat-organizer.js']);
for(const token of ['PC_CHAT_ORGANIZER_CONTEXT','PC_CHAT_ORGANIZER_PROJECT_SET','PC_ORG_CHAT_PATCH','contextmenu','role','menuitem','iconMode','showProjectBadges','sameFamily','Open in Command Center','Favorite in Constellation','Pin in Constellation','Smart project matching']) assert.ok(organizer.includes(token),`organizer missing ${token}`);
assert.doesNotMatch(organizer,/\bfetch\s*\(/,'sidebar project QOL must not fetch provider data itself');
assert.doesNotMatch(organizer,/setInterval\s*\(/,'sidebar project QOL must remain event/queue driven');
for(const token of ['chatOrganizerContext','chatOrganizerProjectSet','PC_CHAT_ORGANIZER_PROJECT_SET','PC_CHAT_VAULT_OPEN']) assert.ok(background.includes(token),`background missing ${token}`);
for(const token of ['projectIdentityPreview','projectVectorPalette','projectIconInput','project-identity-core.js']) assert.ok(vaultHtml.includes(token),`Command Center project settings missing ${token}`);
for(const token of ['paintProjectIcon','projectDisplayIcon','projectIdentity.semanticIcon','project.icon = icon']) assert.ok(vaultJs.includes(token),`Command Center identity behavior missing ${token}`);
for(const token of ['quickProjectVectorIcon','quickProjectVectorPalette']) assert.ok(sideHtml.includes(token),`side panel project creator missing ${token}`);
for(const token of ['projectIdentity.VECTOR_KEYS','quickProjectIconManual','paintProjectIcon']) assert.ok(sideJs.includes(token),`side panel vector project identity missing ${token}`);
console.log('chat-organizer-project-qol.test.mjs: PASS');
