import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const htmlPath = path.resolve(process.argv[2] || 'project-constellation/browser-gate/quick-view.html');
const errors = [];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
page.on('console', msg => {
  if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
});
page.on('dialog', async dialog => {
  errors.push(`unexpected dialog: ${dialog.type()} ${dialog.message()}`);
  await dialog.dismiss();
});

const fail = message => { throw new Error(message); };
const expect = (condition, message) => { if (!condition) fail(message); };

try {
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#grid .card', { timeout: 15000 });

  expect((await page.locator('h1').textContent())?.includes('Project Constellation Quick View'), 'Quick View heading missing');
  const initialCount = (await page.locator('#count').textContent()) || '';
  expect(initialCount.includes('63 tracked'), `Expected 63 tracked, got: ${initialCount}`);
  expect(await page.locator('#grid .card').count() === 63, 'Expected all 63 project cards on initial render');

  const overlay = (await page.locator('#evidence-overlay').innerText()) || '';
  expect(overlay.includes('63'), 'Current-evidence overlay does not expose 63-project authority');
  expect(/wiki|evidence/i.test(overlay), 'Current-evidence overlay is missing evidence/wiki context');

  await page.locator('#search').fill('Feature Foundry');
  await page.waitForTimeout(100);
  const searchedCount = (await page.locator('#count').textContent()) || '';
  expect(searchedCount.includes('63 tracked'), 'Search changed canonical tracked count');
  expect(await page.locator('#grid').innerText().then(t => /Feature Foundry/i.test(t)), 'Search did not surface Feature Foundry');
  expect(await page.locator('#grid .card').count() > 0 && await page.locator('#grid .card').count() < 63, 'Search did not filter the visible project set');
  await page.locator('#search').fill('');

  await page.getByRole('button', { name: 'Blocked', exact: true }).click();
  await page.waitForTimeout(100);
  expect(((await page.locator('#count').textContent()) || '').includes('63 tracked'), 'Blocked lens changed canonical tracked count');
  expect(await page.getByRole('button', { name: 'Blocked', exact: true }).getAttribute('class').then(c => (c || '').includes('active')), 'Blocked lens did not become active');
  await page.getByRole('button', { name: 'All', exact: true }).click();
  expect(await page.locator('#grid .card').count() === 63, 'All lens did not restore 63 visible cards');

  await page.locator('#grid .card').first().getByRole('button', { name: 'Open', exact: true }).click();
  expect(!(await page.locator('#drawer').getAttribute('class')).includes('hidden'), 'Project drawer did not open');
  expect(await page.locator('#eStop').count() === 1, 'Project continuity editor missing from drawer');
  await page.locator('#drawer').getByRole('button', { name: 'Close', exact: true }).click();

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.locator('#export').click(),
  ]);
  const downloadPath = await download.path();
  expect(Boolean(downloadPath), 'Snapshot export did not produce a downloadable file');
  const snapshot = JSON.parse(await fs.readFile(downloadPath, 'utf8'));
  expect(snapshot.schema === 'project-constellation.snapshot/1', 'Snapshot export schema mismatch');
  expect(snapshot.catalogCount === 63, 'Snapshot export project count mismatch');

  const chooserPromise = page.waitForEvent('filechooser', { timeout: 10000 });
  await page.locator('#import').click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'Project-Constellation-Snapshot.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(snapshot)),
  });
  await page.waitForTimeout(300);
  expect(((await page.locator('#count').textContent()) || '').includes('63 tracked'), 'Snapshot import changed canonical tracked count');

  expect(errors.length === 0, `Runtime errors detected:\n${errors.join('\n')}`);
  console.log(JSON.stringify({
    status: 'PASS',
    htmlPath,
    trackedProjects: 63,
    checks: ['load','all-63-cards','evidence-overlay','search','blocked-lens','project-drawer','snapshot-export','snapshot-import','runtime-errors'],
  }, null, 2));
} finally {
  await browser.close();
}
