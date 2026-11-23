import { mount } from 'svelte';
import App from '../../desktop/src/renderer/src/App.svelte';
import '../../desktop/src/renderer/src/styles.css';
import './platform.css';
import { createBrowserBridge } from './bridge.js';

interface InstallPrompt extends Event {
  prompt(): Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const bar = document.getElementById('platform-bar')!;
const status = document.createElement('span');
status.setAttribute('role', 'status');
const privacy = document.createElement('span');
privacy.textContent = 'Stored on this device. Export backups regularly.';
const install = document.createElement('button');
install.textContent = 'Install CatPilot';
install.hidden = true;
const update = document.createElement('button');
update.textContent = 'Update available';
update.hidden = true;
bar.append(privacy, status, install, update);
bar.hidden = false;
let prompt: InstallPrompt | null = null;
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault(); prompt = event as InstallPrompt; install.hidden = false;
});
install.onclick = () => {
  if (!prompt) return;
  const current = prompt;
  void current.prompt().then(result => {
    if (result.outcome === 'accepted') { install.hidden = true; prompt = null; }
  }).catch(error => { status.textContent = `Installation failed: ${String(error)}`; });
};
window.addEventListener('appinstalled', () => { install.hidden = true; prompt = null; });

async function start() {
  if (!window.isSecureContext || !navigator.locks || !window.indexedDB) throw new Error('CatPilot needs HTTPS (or localhost), IndexedDB and Web Locks. Open it in an up-to-date Chrome browser.');
  window.catpilot = await createBrowserBridge();
  mount(App, { target: document.getElementById('app')! });
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) {
    status.textContent = 'Development mode — offline installation is available in the production build.';
    return;
  }
  const registration = await navigator.serviceWorker.register(new URL('sw.js', document.baseURI), { scope: './', updateViaCache: 'none' });
  const connection = () => { status.textContent = navigator.onLine ? 'Offline ready' : 'Offline — local changes still save'; };
  await navigator.serviceWorker.ready;
  connection();
  window.addEventListener('online', connection);
  window.addEventListener('offline', connection);
  const offerUpdate = () => { update.hidden = !registration.waiting; };
  offerUpdate();
  registration.addEventListener('updatefound', () => {
    registration.installing?.addEventListener('statechange', offerUpdate);
  });
  update.onclick = () => {
    if (!window.dispatchEvent(new Event('beforeunload', { cancelable: true }))) {
      status.textContent = 'Save or discard your draft before updating.';
      return;
    }
    if (!registration.waiting) return;
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
    registration.waiting.postMessage('ACTIVATE_UPDATE');
  };
}
void start().catch(error => {
  status.textContent = `CatPilot could not start or prepare offline access: ${error instanceof Error ? error.message : String(error)}`;
  status.setAttribute('role', 'alert');
  const retry = document.createElement('button');
  retry.textContent = 'Reload';
  retry.onclick = () => location.reload();
  bar.append(retry);
});
