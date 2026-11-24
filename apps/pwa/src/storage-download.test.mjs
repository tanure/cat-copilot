import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const dist = path.join(root, 'apps', 'pwa', 'dist');
const profile = path.join(root, 'apps', 'pwa', 'src', `.storage-download-profile-${process.pid}`);
const prefix = '/catpilot/';
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

test('production offline backup downloads', { timeout: 45_000 }, async () => {
  const server = http.createServer((request, response) => {
    void (async () => {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (!pathname.startsWith(prefix)) { response.writeHead(404).end(); return; }
      const file = path.resolve(dist, decodeURIComponent(pathname.slice(prefix.length)) || 'index.html');
      if (!file.startsWith(dist + path.sep)) { response.writeHead(403).end(); return; }
      response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
      response.end(await readFile(file));
    })().catch(error => response.writeHead(500).end(String(error)));
  });
  let context;
  try {
    await mkdir(profile, { recursive: true });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    context = await chromium.launchPersistentContext(profile, {
      headless: true, acceptDownloads: true,
      executablePath: process.env.CATPILOT_BROWSER_EXE || undefined,
      downloadsPath: path.join(profile, 'downloads'),
    });
    const page = await context.newPage();
    const messages = [];
    page.on('console', message => messages.push(`${message.type()}: ${message.text()}`));
    page.on('pageerror', error => messages.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}${prefix}`);
    await page.waitForFunction(() => window.catpilot && document.getElementById('platform-bar')?.innerText.includes('Offline ready'));
    const workspace = await page.evaluate(() => window.catpilot.request({ action: 'createWorkspace', name: 'Downloads', backend: 'sqlite' }));
    await page.evaluate(id => window.catpilot.request({ action: 'put', workspaceId: id, input: { domain: 'tasks', title: 'Exported offline' } }), workspace.id);
    await context.setOffline(true);
    const attempted = [];
    await page.evaluate(() => {
      window.downloadClicks = [];
      document.addEventListener('click', event => {
        const anchor = event.target.closest?.('a[download]');
        if (anchor) window.downloadClicks.push({ href: anchor.href, download: anchor.download, prevented: event.defaultPrevented, active: navigator.userActivation.isActive });
      });
    });
    for (const gesture of [false, true]) {
      try {
        const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
        const resultPromise = gesture
          ? page.evaluate(id => {
            const button = document.createElement('button');
            button.id = 'storage-export';
            button.textContent = 'Export test';
            button.onclick = () => { window.exportResult = window.catpilot.exportBackup(id); };
            document.body.append(button);
          }, workspace.id).then(() => page.click('#storage-export')).then(() => page.evaluate(() => window.exportResult))
          : page.evaluate(id => window.catpilot.exportBackup(id), workspace.id);
        const [download, result] = await Promise.all([downloadPromise, resultPromise]);
        const stream = await download.createReadStream();
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const backup = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        assert.equal(backup.records[0].title, 'Exported offline');
        assert.equal(result, true);
        attempted.push({ gesture, downloaded: true, name: download.suggestedFilename() });
      } catch (error) {
        attempted.push({ gesture, downloaded: false, error: error.message });
      }
    }
    console.log(JSON.stringify({ attempted, clicks: await page.evaluate(() => window.downloadClicks), messages }, null, 2));
    assert.ok(attempted.every(result => result.downloaded), 'Both bridge invocation and explicit click must initiate an offline download');
  } finally {
    await context?.close();
    await new Promise(resolve => server.close(resolve));
    await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
