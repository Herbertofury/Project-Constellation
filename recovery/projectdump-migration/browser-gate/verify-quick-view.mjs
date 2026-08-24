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
const countText = async () => (await page.locator('#count').textContent()) || '';
const cardCount = async () => page.locator('#grid .card').count();
const lensButton = name => page.locator('#lenses').getByRole('button', { name, exact: true });

try {
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#grid .card', { timeout: 15000 });

  expect((await page.locator('h1').textContent())?.includes('Project Constellation Quick View'), 'Quick View heading missing');
  expect((await countText()).includes('63 tracked'), `Expected 63 tracked, got: ${await countText()}`);
  expect(await cardCount() === 63, 'Expected all 63 project cards on initial render');

  const overlay = (await page.locator('#evidence-overlay').innerText()) || '';
  expect(overlay.includes('63'), 'Current-evidence overlay does not expose 63-project authority');
  expect(/wiki|evidence/i.test(overlay), 'Current-evidence overlay is missing evidence/wiki context');
  expect(/PRJ-022/.test(overlay), 'Current-evidence overlay is missing the current research cursor');

  await page.locator('#search').fill('Feature Foundry');
  await page.waitForTimeout(100);
  expect((await countText()).includes('63 tracked'), 'Search changed canonical tracked count');
  expect(await page.locator('#grid').innerText().then(t => /Feature Foundry/i.test(t)), 'Search did not surface Feature Foundry');
  expect(await cardCount() > 0 && await cardCount() < 63, 'Search did not filter the visible project set');
  await page.locator('#search').fill('');
  expect(await cardCount() === 63, 'Clearing search did not restore all 63 project cards');

  const builtInLenses = ['Today', 'Review Queue', 'Blocked', 'Version proof', 'Research stale', 'Changed since last visit'];
  for (const name of builtInLenses) {
    const button = lensButton(name);
    expect(await button.count() === 1, `Missing built-in lens: ${name}`);
    await button.click();
    await page.waitForTimeout(50);
    expect(((await button.getAttribute('class')) || '').includes('active'), `${name} lens did not become active`);
    expect((await countText()).includes('63 tracked'), `${name} lens changed canonical tracked count`);
    expect(await cardCount() <= 63, `${name} lens rendered more than 63 project cards`);
  }
  await lensButton('All').click();
  expect(await cardCount() === 63, 'All lens did not restore 63 visible cards');

  const featureCard = page.locator('#grid .card[data-id="PRJ-002"]');
  expect(await featureCard.count() === 1, 'PRJ-002 Feature Foundry card missing');
  await featureCard.getByRole('button', { name: 'Open', exact: true }).click();
  expect(!((await page.locator('#drawer').getAttribute('class')) || '').includes('hidden'), 'Project drawer did not open');
  expect(((await page.locator('#drawer h2').textContent()) || '').includes('Feature Foundry'), 'Project drawer opened the wrong project');
  expect(await page.locator('#eStop').count() === 1, 'Project continuity editor missing from drawer');
  await page.locator('#drawer').getByRole('button', { name: 'Close', exact: true }).click();

  await featureCard.getByRole('button', { name: 'Add Today', exact: true }).click();
  await lensButton('Today').click();
  expect(await page.locator('#grid .card[data-id="PRJ-002"]').count() === 1, 'Today lens did not retain the selected PRJ-002 project');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#grid .card', { timeout: 15000 });
  await lensButton('Today').click();
  expect(await page.locator('#grid .card[data-id="PRJ-002"]').count() === 1, 'Today state did not persist through reload/localStorage');
  await page.locator('#grid .card[data-id="PRJ-002"]').getByRole('button', { name: 'Remove Today', exact: true }).click();
  await lensButton('All').click();
  expect(await cardCount() === 63, 'Removing Today state did not restore the complete All lens');

  await page.locator('#appResearch').click();
  expect(!((await page.locator('#drawer').getAttribute('class')) || '').includes('hidden'), 'App research drawer did not open');
  expect(((await page.locator('#drawer h2').textContent()) || '').includes('Ideas & Research'), 'App research drawer content missing');
  expect(await page.locator('#drawer .research').count() === 2, 'Expected both app-research records in the drawer');
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
  expect(snapshot.state && typeof snapshot.state === 'object', 'Snapshot export omitted persistent state');

  const chooserPromise = page.waitForEvent('filechooser', { timeout: 10000 });
  await page.locator('#import').click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'Project-Constellation-Snapshot.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(snapshot)),
  });
  await page.waitForTimeout(300);
  expect((await countText()).includes('63 tracked'), 'Snapshot import changed canonical tracked count');
  expect(await cardCount() === 63, 'Snapshot import did not retain all 63 project cards in the All lens');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#grid .card', { timeout: 15000 });
  expect((await countText()).includes('63 tracked'), 'Reload after snapshot import changed canonical tracked count');
  expect(await cardCount() === 63, 'Reload after snapshot import lost project availability');

  expect(errors.length === 0, `Runtime errors detected:\n${errors.join('\n')}`);
  console.log(JSON.stringify({
    status: 'PASS',
    htmlPath,
    trackedProjects: 63,
    checks: [
      'load',
      'all-63-cards',
      'current-evidence-overlay',
      'search',
      'all-built-in-lenses',
      'project-drawer',
      'today-localStorage-reload-persistence',
      'app-research-drawer',
      'snapshot-export',
      'snapshot-import-file-reader',
      'post-import-reload-persistence',
      'runtime-errors'
    ],
  }, null, 2));
} finally {
  await browser.close();
}
