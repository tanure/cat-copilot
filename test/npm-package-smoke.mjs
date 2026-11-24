import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this fixture through npm run test:package.');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'catpilot-installed-package-'));
function run(args, cwd = root, env = process.env) {
  return execFileSync(process.execPath, args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 });
}
try {
  const result = JSON.parse(run([npmCli, 'pack', '--json', '--ignore-scripts', '--pack-destination', temporary]));
  const packages = Array.isArray(result) ? result : Object.values(result);
  assert.equal(packages.length, 1, 'Expected exactly the CLI package, not all desktop workspaces');
  const [packed] = packages;
  assert.equal(packed.name, '@alberttanure/catpilot-cli');
  for (const required of ['dist/core/legacy.js', 'dist/core/assets.js', 'dist/core/transfer.js', 'dist/core/management.js', 'dist/core/ai.js', 'lib/workspace-bridge.js', 'lib/workspace-client.js', 'lib/workspace-tui.js']) {
    assert.ok(packed.files.some(file => file.path === required), `Missing published module: ${required}`);
  }
  const consumer = path.join(temporary, 'consumer');
  await fs.mkdir(consumer);
  await fs.writeFile(path.join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  await fs.writeFile(path.join(consumer, '.npmrc'), 'omit-lockfile-registry-resolved=true\n');
  run([npmCli, 'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund', path.join(temporary, packed.filename)], consumer);
  run([npmCli, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], consumer);
  const installed = path.join(consumer, 'node_modules', '@alberttanure', 'catpilot-cli');
  const cli = path.join(installed, 'bin', 'cat-cli.js');
  const env = { ...process.env, CATPILOT_HOME: path.join(temporary, 'profile'), CATPILOT_WORKSPACE: '', CATPILOT_CONFIG: '', CATPILOT_ROOT: '' };
  const command = (...args) => JSON.parse(run([cli, 'workspace', ...args], consumer, env));
  const sqlite = command('create', 'Installed SQL', '--backend', 'sqlite');
  const markdown = command('create', 'Installed Markdown', '--backend', 'markdown');
  const { WorkspaceService, recordInputSchema } = await import(pathToFileURL(path.join(installed, 'dist', 'core', 'index.js')).href);
  const { digest } = await import(pathToFileURL(path.join(installed, 'dist', 'core', 'assets.js')).href);
  const service = new WorkspaceService(env.CATPILOT_HOME);
  const bytes = Buffer.from([0, 255, 128, 13, 10]);
  await service.execute({ action: 'addAsset', workspaceId: sqlite.id, asset: { path: 'attachments/example.bin', data: bytes.toString('base64'), sha256: digest(bytes) } });
  const record = await service.execute({ action: 'put', workspaceId: sqlite.id, input: recordInputSchema.parse({
    domain: 'tasks', title: 'Installed task', body: '\uFEFF# Portable\r\n\r\n[File](catpilot-asset:attachments/example.bin)\r\n',
    fields: { goal: 'Ship', tags: ['one,two'], extra: { preserved: true } },
  }) });
  assert.equal(command('records', '--workspace', sqlite.id)[0].id, record.id);
  const backup = await service.execute({ action: 'export', workspaceId: sqlite.id });
  await service.execute({ action: 'import', workspaceId: markdown.id, backup, approved: true });
  const restored = command('records', '--workspace', markdown.id)[0];
  assert.equal(restored.body, record.body);
  assert.deepEqual(restored.fields.extra, { preserved: true });
  assert.deepEqual(Buffer.from((await service.execute({ action: 'readAsset', workspaceId: markdown.id, path: 'attachments/example.bin' })).data), bytes);
  const legacy = path.join(temporary, 'legacy');
  await fs.mkdir(legacy);
  const original = Buffer.from('\uFEFF# Installed legacy import\r\n\r\n<!-- Preserve -->\r\n');
  await fs.writeFile(path.join(legacy, 'note.md'), original);
  const imported = command('create', 'Imported package fixture', '--backend', 'sqlite');
  command('legacy-import', legacy, '--workspace', imported.id);
  assert.equal(command('records', '--workspace', imported.id).length, 0);
  command('legacy-import', legacy, '--workspace', imported.id, '--apply');
  assert.ok(command('records', '--workspace', imported.id).some(record => record.title === 'Installed legacy import'));
  assert.deepEqual(await fs.readFile(path.join(legacy, 'note.md')), original);
  console.log('Installed npm tarball passed outside the checkout: shared modules, SQLite/Markdown CLI, binary transfer and approved legacy import.');
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
