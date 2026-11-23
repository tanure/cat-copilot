import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { recordInputSchema } from '../dist/core/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'catpilot-design-'));
const screenshots = process.env.CATPILOT_DESIGN_SCREENSHOTS;
let app;
let succeeded = false;
const errors = [];
try {
  app = await electron.launch({
    ...(process.env.CATPILOT_TEST_EXE ? { executablePath: process.env.CATPILOT_TEST_EXE } : {}),
    args: process.env.CATPILOT_TEST_EXE ? [] : [path.join(root, 'apps', 'desktop')],
    env: { ...process.env, CATPILOT_HOME: path.join(temp, 'registry'), CATPILOT_USER_DATA: path.join(temp, 'profile') },
    timeout: 60_000,
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1520, height: 960 });
  await page.getByRole('heading', { name: 'Make yourself at home.' }).waitFor();
  const logo = await page.locator('.welcome img').evaluate(image => ({
    rendering: getComputedStyle(image).imageRendering,
    width: image.width,
    natural: image.naturalWidth,
  }));
  assert.equal(logo.rendering, 'auto');
  assert.ok(logo.natural >= logo.width * 2, 'The brand asset must remain sharp at 2x display scale');
  if (screenshots) {
    await fs.mkdir(screenshots, { recursive: true });
    await page.screenshot({ path: path.join(screenshots, 'catpilot-welcome.png') });
  }
  const request = value => page.evaluate(value => window.catpilot.request(value), value);
  const workspace = await request({ action: 'createWorkspace', name: 'Product studio', backend: 'sqlite' });
  const entries = [
    { title: 'Finalize desktop onboarding', status: 'In Progress', priority: 'P1', tags: ['Design', 'Desktop'] },
    { title: 'Review accessibility checklist', status: 'Blocked', priority: 'P0', tags: ['Accessibility', 'Design'] },
    { title: 'Publish the workspace guide', status: 'Open', priority: 'P2', tags: ['Documentation'] },
    { title: 'Ship Markdown import', status: 'Done', priority: 'P3', tags: ['Desktop', 'Release'] },
  ];
  const records = [];
  for (const { title, ...fields } of entries) {
    records.push(await request({ action: 'put', workspaceId: workspace.id, input: recordInputSchema.parse({ domain: 'tasks', title, fields, body: '## Next steps\n\nMake the first workspace effortless to create.\n\n- [ ] Review the sign-in experience\n- [ ] Confirm keyboard navigation\n' }) }));
  }
  await request({ action: 'put', workspaceId: workspace.id, input: recordInputSchema.parse({ domain: 'knowledge', title: 'Onboarding research', fields: { folder: 'Design/Interviews' } }) });
  await page.reload();
  await page.getByRole('navigation').getByRole('button', { name: /^Tasks(?: \d+)?$/ }).click();
  await page.locator('.table-row').first().waitFor();
  assert.equal(await page.locator('nav .nav-icon > svg').count(), 9);
  assert.ok((await page.locator('nav .nav-icon').allTextContents()).every(text => !text.trim()));
  const tagTones = await page.locator('.items-table .tag-chip').evaluateAll(chips => chips.map(chip => ({
    text: chip.textContent, tone: chip.getAttribute('data-tone'),
  })));
  assert.equal(new Set(tagTones.filter(chip => chip.text === 'Design').map(chip => chip.tone)).size, 1);
  assert.ok(new Set(tagTones.map(chip => chip.tone)).size > 1);

  async function checkContrast() {
    const ratios = await page.locator('.items-table [data-tone]').evaluateAll(elements => {
      function luminance(color) {
        const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => value / 255);
        const [r, g, b] = channels.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
        return .2126 * r + .7152 * g + .0722 * b;
      }
      return elements.map(element => {
        const style = getComputedStyle(element);
        const a = luminance(style.color);
        const b = luminance(style.backgroundColor);
        return { text: element.textContent.trim(), ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
      });
    });
    assert.ok(ratios.length > 10);
    for (const item of ratios) assert.ok(item.ratio >= 4.5, `${item.text}: contrast ${item.ratio.toFixed(2)} is below 4.5:1`);
    const fits = await page.locator('.main-scroll').evaluate(element => element.scrollWidth <= element.clientWidth);
    assert.equal(fits, true, 'List view must not horizontally overflow');
  }
  await checkContrast();
  if (screenshots) await page.screenshot({ path: path.join(screenshots, 'catpilot-tasks-light.png') });
  await page.getByRole('main').getByRole('button', { name: 'Finalize desktop onboarding', exact: true }).click();
  await page.getByLabel('Rich document editor', { exact: true }).waitFor();
  const checklist = await page.locator('.rich-document li[data-type="taskItem"]').first().evaluate(element => {
    const input = element.querySelector('input').getBoundingClientRect();
    const text = element.querySelector('p').getBoundingClientRect();
    return { width: input.width, before: input.x < text.x, offset: Math.abs(input.y - text.y) };
  });
  assert.ok(checklist.width <= 20 && checklist.before && checklist.offset < 12, 'Native checklist controls align beside their text');
  assert.equal(await page.getByRole('combobox', { name: 'Insert rich block', exact: true }).count(), 0);
  assert.ok(await page.locator('.document-page').evaluate(element => element.clientWidth >= element.parentElement.clientWidth - 2), 'Editor uses the full center pane');
  if (screenshots) await page.screenshot({ path: path.join(screenshots, 'catpilot-editor-light.png') });
  await page.getByRole('tab', { name: 'Properties', exact: true }).click();
  if (screenshots) await page.screenshot({ path: path.join(screenshots, 'catpilot-properties-light.png') });
  await page.getByRole('button', { name: 'Back to tasks', exact: true }).click();
  await page.locator('.items-table').waitFor();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('combobox', { name: /^Theme/ }).selectOption('dark');
  await page.getByRole('navigation').getByRole('button', { name: /^Tasks(?: \d+)?$/ }).click();
  await checkContrast();
  assert.deepEqual(await page.locator('.items-table .tag-chip').evaluateAll(chips => chips.map(chip => ({
    text: chip.textContent, tone: chip.getAttribute('data-tone'),
  }))), tagTones);
  if (screenshots) await page.screenshot({ path: path.join(screenshots, 'catpilot-tasks-dark.png') });
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.getByRole('button', { name: 'Collapse primary sidebar', exact: true }).click();
  await checkContrast();
  assert.equal(await page.getByRole('navigation').getByRole('button', { name: 'Concepts', exact: true }).getAttribute('title'), 'Concepts');
  if (screenshots) await page.screenshot({ path: path.join(screenshots, 'catpilot-tasks-compact.png') });

  const status = page.getByRole('combobox', { name: 'Status for Publish the workspace guide', exact: true });
  await status.selectOption('In Progress');
  await page.waitForFunction(async id => {
    const snapshot = await window.catpilot.request({ action: 'snapshot', workspaceId: id });
    return snapshot.records.some(record => record.title === 'Publish the workspace guide' && record.fields.status === 'In Progress');
  }, workspace.id);
  assert.equal(await status.inputValue(), 'In Progress');
  const stale = records.find(record => record.title === 'Ship Markdown import');
  await page.evaluate(async command => {
    await window.catpilot.request(command);
    const select = document.querySelector('select[aria-label="Status for Ship Markdown import"]');
    select.value = 'Open';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, { action: 'put', workspaceId: workspace.id, id: stale.id, expectedRevision: stale.revision,
    input: recordInputSchema.parse({ domain: stale.domain, title: stale.title, body: 'External edit', fields: stale.fields }) });
  const failed = page.getByRole('combobox', { name: 'Status for Ship Markdown import', exact: true });
  await page.getByRole('alert').filter({ hasText: /changed/i }).waitFor();
  assert.equal(await failed.inputValue(), 'Done', 'A rejected write must not leave a success-shaped selection');
  const context = page.getByRole('complementary', { name: 'Context and records' });
  await context.getByRole('button', { name: 'Matrix', exact: true }).click();
  assert.equal(new Set(await page.locator('.matrix-quadrant').evaluateAll(nodes => nodes.map(node => getComputedStyle(node.querySelector('header')).backgroundColor))).size, 4);
  if (screenshots) await page.screenshot({ path: path.join(screenshots, 'catpilot-matrix-dark.png') });
  await context.getByRole('button', { name: 'Calendar', exact: true }).click();
  await page.setViewportSize({ width: 720, height: 800 });
  const calendar = page.getByRole('region', { name: 'Task calendar' });
  await calendar.waitFor();
  assert.ok(await calendar.evaluate(element => element.scrollWidth <= element.clientWidth), 'Narrow calendar fits its pane');
  if (screenshots) await page.screenshot({ path: path.join(screenshots, 'catpilot-calendar-narrow.png') });
  await calendar.getByRole('button', { name: 'New task on this day', exact: true }).click();
  const detail = page.getByRole('dialog', { name: 'New task' });
  await detail.waitFor();
  assert.ok(await detail.evaluate(element => element.clientWidth === innerWidth));
  if (screenshots) await page.screenshot({ path: path.join(screenshots, 'catpilot-detail-narrow.png') });
  await detail.getByRole('button', { name: 'Close item', exact: true }).click();
  await page.setViewportSize({ width: 1200, height: 900 });
  const nav = page.getByRole('navigation');
  await nav.getByRole('button', { name: 'Focus', exact: true }).click();
  assert.equal(await context.count(), 0);
  const focus = page.getByRole('region', { name: 'Persisted Focus timer' });
  await focus.getByLabel('Planned time', { exact: true }).waitFor();
  if (screenshots) await page.screenshot({ path: path.join(screenshots, 'catpilot-focus-dark.png') });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('combobox', { name: /^Theme/ }).selectOption('light');
  await nav.getByRole('button', { name: 'Concepts', exact: true }).click();
  await context.getByRole('button', { name: 'Expand Design', exact: true }).click();
  await context.getByRole('button', { name: 'Interviews', exact: true }).click();
  assert.equal(await page.getByRole('main').getByRole('group', { name: 'Concept folders' }).count(), 0);
  await page.getByRole('main').getByText('Onboarding research', { exact: true }).waitFor();
  if (screenshots) await page.screenshot({ path: path.join(screenshots, 'catpilot-concepts-light.png') });
  const folderGroup = context.getByRole('group', { name: 'Concept folders' });
  await folderGroup.getByRole('button', { name: 'New folder', exact: true }).click();
  const folderDialog = page.getByRole('dialog', { name: 'New folder', exact: true });
  await folderDialog.getByLabel('Folder name', { exact: true }).fill('Planning');
  await folderDialog.getByRole('button', { name: 'Create folder', exact: true }).click();
  await folderGroup.getByRole('button', { name: 'Planning', exact: true }).waitFor();
  assert.ok((await request({ action: 'snapshot', workspaceId: workspace.id })).records.some(record => record.domain === 'concept-folders' && record.fields.folder === 'Planning'));
  assert.deepEqual(errors, []);
  console.log('Desktop design passed: SVG navigation, sharp 2x logo, stable colored tags, light/dark contrast, compact layout, persisted status and rejected-write recovery.');
  succeeded = true;
} finally {
  if (app) {
    const process = app.process();
    const stopped = process.exitCode === null ? new Promise(resolve => process.once('close', resolve)) : Promise.resolve();
    if (succeeded) await app.close();
    else if (process.exitCode === null) await app.evaluate(({ app }) => app.exit(0));
    await stopped;
  }
  await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
