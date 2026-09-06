import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../extension/src/chat-vault-core.js', import.meta.url), 'utf8');
const context = vm.createContext({ URL, console, Date, Math, setTimeout, clearTimeout });
vm.runInContext(source, context, { filename:'chat-vault-core.js' });
const core = context.ProjectConstellationChatVaultCore;
assert.ok(core, 'AI Command Center core should install a global API');

const raw = 'https://chatgpt.com/c/6a9cb369-893c-83e8-8611-50965505761a?utm_source=nope#tail';
assert.equal(core.canonicalUrl(raw), 'https://chatgpt.com/c/6a9cb369-893c-83e8-8611-50965505761a');
assert.equal(core.chatKey(raw), 'chatgpt:6a9cb369-893c-83e8-8611-50965505761a');
assert.equal(core.isSupportedChatUrl(raw), true);
assert.equal(core.isSupportedChatUrl('https://chatgpt.com/'), false);
assert.equal(core.isSupportedChatUrl('https://example.com/c/not-a-chat'), false);

const items = core.parseUrlList([
  'https://chatgpt.com/c/11111111-1111-1111-1111-111111111111 | Alpha chat',
  'https://claude.ai/chat/2222 | Claude beta',
  'https://chatgpt.com/c/11111111-1111-1111-1111-111111111111 | duplicate',
  'https://example.com/nope | ignore'
].join('\n'));
assert.equal(items.length, 2, 'URL import should keep unique supported chats only');
assert.equal(items[0].title, 'Alpha chat');
assert.equal(items[1].providerId, 'claude');
const exported = core.urlListText(items);
assert.match(exported, /Alpha chat/);
assert.match(exported, /Claude beta/);
assert.equal(core.parseUrlList(exported).length, 2, 'URL export text should round-trip');

const duplicateStack = core.normalizeStack({
  id:'stack:a',
  name:'Dupes',
  items:[items[0], { ...items[0], id:'second-copy', title:'Duplicate copy' }, items[1]]
});
assert.equal(duplicateStack.items.length, 2, 'project normalization should de-duplicate by stable chat key');

let vault = core.emptyVault();
let ensured = core.ensureStack(vault, 'Live AI Sessions', { select:true });
vault = ensured.vault;
assert.equal(vault.stacks.length, 1);
assert.equal(ensured.stack.name, 'Live AI Sessions');
vault = core.addItemsToStack(vault, ensured.stack.id, items);
assert.equal(core.stackCount(vault), 2);
vault = core.addItemsToStack(vault, ensured.stack.id, [{ ...items[0], title:'Refreshed title', sourceTabId:99 }]);
assert.equal(core.stackCount(vault), 2, 'gather must merge instead of duplicating chats');
assert.equal(vault.stacks[0].items.find((item) => item.key === items[0].key).sourceTabId, 99);

const projectB = core.createStack('Project B', [], { id:'stack:b', createdAt:200 });
vault = core.addStack(vault, projectB);
const from = vault.stacks.find((stack) => stack.name === 'Live AI Sessions');
assert.ok(from?.items[0]);
vault = core.moveItem(vault, from.items[0].id, from.id, 'stack:b');
assert.equal(vault.stacks.find((stack) => stack.id === 'stack:b').items.length, 1);

assert.deepEqual(
  JSON.parse(JSON.stringify(core.normalizeDecoration({ emoji:'🔥', color:'#ABCDEF', style:'mono', updatedAt:7 }))),
  { emoji:'🔥', color:'#abcdef', style:'mono', updatedAt:7 }
);
assert.equal(core.normalizeDecoration({ color:'red', style:'not-real' }).color, '');
assert.equal(core.normalizeDecoration({ color:'red', style:'not-real' }).style, 'clean');

const running = core.livePresentation({
  tabId:5, windowId:1, url:raw, bucket:'active', active:true, status:'running', healthState:'working', network:{pending:1}, lastActivityAt:Date.now()
});
assert.equal(running.state, 'running');
assert.equal(running.open, true);
assert.equal(running.pending, 1);

const toolStalled = core.livePresentation({
  tabId:6, url:raw, bucket:'stale', stale:true, status:'running', healthState:'tool-stalled', lastActivityAt:Date.now() - 130000
});
assert.equal(toolStalled.state, 'stalled');
assert.equal(toolStalled.attention, true);

const failure = core.livePresentation({
  tabId:7, url:raw, bucket:'stale', failure:{ active:true, title:'Connection interrupted', retryAvailable:true }
});
assert.equal(failure.state, 'blocked');
assert.equal(failure.retryAvailable, true);
assert.equal(failure.failureTitle, 'Connection interrupted');

const done = core.livePresentation({ tabId:8, url:raw, bucket:'completed', completed:true, status:'completed' });
assert.equal(done.state, 'done');

const offline = core.normalizeLive({ state:'offline' });
assert.equal(offline.open, false);
assert.ok(core.LIVE_PRIORITY.dead < core.LIVE_PRIORITY.running, 'attention states should sort ahead of routine running work');

console.log('chat-vault-core: ok');