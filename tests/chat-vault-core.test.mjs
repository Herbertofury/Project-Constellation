import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../extension/src/chat-vault-core.js', import.meta.url), 'utf8');
const context = vm.createContext({ URL, console, Date, Math, setTimeout, clearTimeout });
vm.runInContext(source, context, { filename:'chat-vault-core.js' });
const core = context.ProjectConstellationChatVaultCore;
assert.ok(core, 'chat vault core should install a global API');

const raw = 'https://chatgpt.com/c/6a9cb369-893c-83e8-8611-50965505761a?utm_source=nope#tail';
assert.equal(core.canonicalUrl(raw), 'https://chatgpt.com/c/6a9cb369-893c-83e8-8611-50965505761a');
assert.equal(core.chatKey(raw), 'chatgpt:6a9cb369-893c-83e8-8611-50965505761a');
assert.equal(core.isSupportedChatUrl(raw), true);
assert.equal(core.isSupportedChatUrl('https://chatgpt.com/'), false);
assert.equal(core.isSupportedChatUrl('https://example.com/c/not-a-chat'), false);

const items = core.parseOneTabText([
  'https://chatgpt.com/c/11111111-1111-1111-1111-111111111111 | Alpha chat',
  'https://claude.ai/chat/2222 | Claude beta',
  'https://chatgpt.com/c/11111111-1111-1111-1111-111111111111 | duplicate',
  'https://example.com/nope | ignore'
].join('\n'));
assert.equal(items.length, 2, 'OneTab import should keep unique supported chats only');
assert.equal(items[0].title, 'Alpha chat');
assert.equal(items[1].providerId, 'claude');
const exported = core.oneTabText(items);
assert.match(exported, /Alpha chat/);
assert.match(exported, /Claude beta/);
assert.equal(core.parseOneTabText(exported).length, 2, 'OneTab export should round-trip');

const duplicateStack = core.normalizeStack({
  id:'stack:a',
  name:'Dupes',
  items:[items[0], { ...items[0], id:'second-copy', title:'Duplicate copy' }, items[1]]
});
assert.equal(duplicateStack.items.length, 2, 'stack normalization should de-duplicate by stable chat key');

let vault = core.emptyVault();
const a = core.createStack('A', [items[0]], { id:'stack:a', createdAt:100 });
const b = core.createStack('B', [items[1]], { id:'stack:b', createdAt:200 });
vault = core.addStack(vault, a);
vault = core.addStack(vault, b);
assert.equal(core.stackCount(vault), 2);
const from = vault.stacks.find((stack) => stack.id === 'stack:a');
assert.ok(from?.items[0]);
vault = core.moveItem(vault, from.items[0].id, 'stack:a', 'stack:b');
assert.equal(vault.stacks.find((stack) => stack.id === 'stack:a').items.length, 0);
assert.equal(vault.stacks.find((stack) => stack.id === 'stack:b').items.length, 2);

assert.deepEqual(
  JSON.parse(JSON.stringify(core.normalizeDecoration({ emoji:'🔥', color:'#ABCDEF', style:'mono', updatedAt:7 }))),
  { emoji:'🔥', color:'#abcdef', style:'mono', updatedAt:7 }
);
assert.equal(core.normalizeDecoration({ color:'red', style:'not-real' }).color, '');
assert.equal(core.normalizeDecoration({ color:'red', style:'not-real' }).style, 'clean');

console.log('chat-vault-core: ok');
