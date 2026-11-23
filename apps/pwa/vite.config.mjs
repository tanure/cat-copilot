import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const publicFiles = ['manifest.webmanifest', 'icons/catpilot-192.png', 'icons/catpilot-512.png'];

export default defineConfig({
  base: './',
  plugins: [
    svelte({ configFile: false }),
    {
      name: 'catpilot-offline',
      generateBundle: { order: 'post', handler(_options, bundle) {
        const files = Object.keys(bundle).sort();
        const hash = createHash('sha256');
        for (const name of files) {
          const file = bundle[name];
          hash.update(name).update(file.type === 'chunk' ? file.code : file.source);
        }
        for (const name of publicFiles) hash.update(name).update(readFileSync(new URL('./public/' + name, import.meta.url)));
        const revision = hash.digest('hex').slice(0, 16);
        const assets = [...new Set(['./', './index.html', ...publicFiles.map(file => './' + file), ...files.map(file => './' + file)])];
        this.emitFile({ type: 'asset', fileName: 'sw.js', source: `
const PREFIX = 'catpilot:' + self.registration.scope + ':';
const CACHE = PREFIX + '${revision}';
const FILES = ${JSON.stringify(assets)};
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES))));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('message', event => { if (event.data === 'ACTIVATE_UPDATE') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(event.request, { ignoreSearch: event.request.mode === 'navigate' });
    if (hit) return hit;
    if (event.request.mode === 'navigate') return await cache.match(new URL('./index.html', self.registration.scope));
    return fetch(event.request);
  })());
});` });
      } },
    },
  ],
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
});
