#!/usr/bin/env node
import { computerUse, closeComputerUseHelper } from '../src/computer-use.mjs';

if (process.platform !== 'win32') {
  console.error(JSON.stringify({ ok: false, error: 'Full control self-test is Windows-only.' }));
  process.exit(2);
}

try {
  const displays = await computerUse('displays');
  const before = await computerUse('cursor');
  const all = Array.isArray(displays?.displays) ? displays.displays : [];
  const minX = all.length ? Math.min(...all.map(x => Number(x.x))) : before.x - 100;
  const maxX = all.length ? Math.max(...all.map(x => Number(x.x) + Number(x.width) - 1)) : before.x + 100;
  const targetX = before.x + 12 <= maxX ? before.x + 12 : Math.max(minX, before.x - 12);
  await computerUse('actions', { actions: [
    { type: 'move', x: targetX, y: before.y },
    { type: 'wait', ms: 140 },
    { type: 'move', x: before.x, y: before.y }
  ] });
  const after = await computerUse('cursor');
  const clipBefore = await computerUse('clipboard_read');
  const marker = `Constellation Commander control test ${Date.now()}`;
  await computerUse('clipboard_write', { text: marker });
  const clipProbe = await computerUse('clipboard_read');
  await computerUse('clipboard_write', { text: clipBefore?.text || '' });
  const shot = await computerUse('screenshot', { target: 'all', format: 'jpeg', quality: 45, max_width: 720 });
  const bytes = Number(shot?.bytes || (shot?.base64 ? Buffer.from(shot.base64, 'base64').length : 0));
  const ok = Number(after?.x) === Number(before?.x) && Number(after?.y) === Number(before?.y) && clipProbe?.text === marker && bytes > 1000;
  console.log(JSON.stringify({
    ok,
    displays: all.length,
    cursorReturned: Number(after?.x) === Number(before?.x) && Number(after?.y) === Number(before?.y),
    clipboardRoundTrip: clipProbe?.text === marker,
    screenshotBytes: bytes
  }));
  process.exit(ok ? 0 : 1);
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }));
  process.exit(1);
} finally {
  await closeComputerUseHelper().catch(() => {});
}
