import { beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let behavior;
let clients;
class FakeClient {
  constructor(options) { this.options = options; this.sessions = []; this.stops = 0; clients.push(this); }
  async start() { if (behavior.start) await behavior.start(); }
  async stop() { this.stops++; return []; }
  async getAuthStatus() { return { isAuthenticated: true }; }
  async listModels() { return [{ id: 'test-model', name: 'Test model' }]; }
  rpc = { models: { list: async () => ({ models: behavior.models ?? [{ id: 'test-model', name: 'Test model' }] }) } };
  async createSession(options) {
    const session = {
      options, disconnected: false, listeners: new Map(),
      on(type, listener) { this.listeners.set(type, listener); return () => this.listeners.delete(type); },
      async sendAndWait(message) {
        this.message = message;
        return behavior.send ? behavior.send(message, this) : { data: { content: '# Synthetic draft' } };
      },
      async abort() { if (behavior.abort) await behavior.abort(); },
      async disconnect() { this.disconnected = true; },
      rpc: { accounts: { login: {
        async begin() { return { flowId: 'test-flow', step: behavior.loginStep }; },
        async advance() { return behavior.loginStep; },
        async cancel() { behavior.loginCancelled = true; },
      } } },
    };
    this.sessions.push(session);
    return session;
  }
}
mock.module('@github/copilot-sdk', { namedExports: {
  CopilotClient: FakeClient,
  defineTool: (name, config) => ({ name, ...config }),
  RuntimeConnection: { forStdio: options => ({ kind: 'stdio', ...options }) },
} });
const { CopilotProvider } = await import('../dist/provider-test/apps/desktop/src/main/provider.js');

beforeEach(() => { behavior = {}; clients = []; });
async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'catpilot-provider-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  return new CopilotProvider(home);
}

test('draft sessions deny tools and keep workspace context separate', async t => {
  const provider = await fixture(t);
  assert.equal(await provider.draft('work', 'Summarize', 'Synthetic work context', 'test-model'), '# Synthetic draft');
  assert.equal(await provider.draft('personal', 'Summarize', 'Synthetic personal context'), '# Synthetic draft');
  const [work, personal] = clients[0].sessions;
  assert.deepEqual(work.options.availableTools, []);
  assert.deepEqual(work.options.excludedTools, ['builtin:*', 'mcp:*']);
  assert.equal(work.options.onPermissionRequest().kind, 'denied-interactively-by-user');
  assert.equal(work.options.model, 'test-model');
  assert.notEqual(work.options.workingDirectory, personal.options.workingDirectory);
  assert.ok(!personal.message.prompt.includes('Synthetic work context'));
  assert.ok(work.disconnected && personal.disconnected);
  await provider.stop();
});

test('draft deltas are cumulative, unsubscribed, and ignored after cancellation', async t => {
  const provider = await fixture(t);
  const chunks = [];
  behavior.send = async (_message, session) => {
    const emit = session.listeners.get('assistant.message_delta');
    emit({ data: { deltaContent: '# Synthetic' } });
    emit({ data: { deltaContent: ' draft' } });
    return { data: { content: '# Synthetic draft' } };
  };
  assert.equal(await provider.draft('work', 'Write', '', undefined, text => chunks.push(text)), '# Synthetic draft');
  assert.deepEqual(chunks, ['# Synthetic', '# Synthetic draft']);
  assert.equal(clients[0].sessions[0].options.streaming, true);
  assert.equal(clients[0].sessions[0].listeners.size, 0);
  behavior.send = async (_message, session) => {
    await provider.cancel();
    session.listeners.get('assistant.message_delta')({ data: { deltaContent: 'Discarded' } });
    return { data: { content: 'Discarded' } };
  };
  await assert.rejects(provider.draft('work', 'Write', '', undefined, text => chunks.push(text)), /cancelled/);
  assert.equal(chunks.length, 2);
  assert.equal(clients[0].sessions[1].listeners.size, 0);
  await provider.stop();
});

test('structured tools only propose selected-record edits and never accept target or arbitrary field overrides', async t => {
  const provider = await fixture(t);
  const change = { title: 'Synthetic record', body: 'Keep the original body.', fields: { goal: 'Ship the fictional app', priority: 'P1' } };
  behavior.send = async (_message, session) => {
    const [tool] = session.options.tools;
    assert.deepEqual(session.options.availableTools, ['catpilot_propose_record_change']);
    assert.deepEqual(session.options.excludedTools, ['builtin:*', 'mcp:*']);
    assert.equal(tool.skipPermission, true, 'An in-memory proposal does not need runtime filesystem permission');
    assert.throws(() => tool.handler({ ...change, workspaceId: 'other' }), /Unrecognized key/);
    assert.throws(() => tool.handler({ ...change, fields: { parent: 'other-workspace-record' } }), /Unrecognized key/);
    assert.deepEqual(await tool.handler(change), { proposed: true, saved: false, requiresUserApproval: true });
    return { data: { content: 'Review the proposed change in CatPilot.' } };
  };
  assert.deepEqual(await provider.propose('work', 'Improve SMART', 'Synthetic selected context'), change);
  assert.equal(clients[0].sessions[0].disconnected, true);
  behavior.send = undefined;
  await assert.rejects(provider.propose('work', 'Improve SMART', ''), /did not propose/);
  behavior.send = async (_message, session) => {
    await session.options.tools[0].handler(change);
    await provider.cancel();
    return { data: { content: 'Cancelled' } };
  };
  await assert.rejects(provider.propose('work', 'Improve SMART', ''), /cancelled/);
  await provider.stop();
});

test('packaged providers launch the explicit unpacked runtime, not an ASAR path', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'catpilot-unpacked-runtime-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const runtime = path.join(home, 'copilot-runtime');
  await fs.writeFile(runtime, '', { mode: 0o700 });
  const provider = new CopilotProvider(home, runtime);
  assert.equal((await provider.status()).authenticated, true);
  assert.deepEqual(clients[0].options.connection, { kind: 'stdio', path: runtime });
  await provider.stop();
});

test('cancellation during runtime startup never creates a generation session', async t => {
  const provider = await fixture(t);
  let release;
  let started;
  const starting = new Promise(resolve => { started = resolve; });
  behavior.start = () => { started(); return new Promise(resolve => { release = resolve; }); };
  const draft = provider.draft('work', 'Summarize', 'Synthetic context');
  const rejected = assert.rejects(draft, /cancelled/);
  await starting;
  await provider.cancel();
  release();
  await rejected;
  assert.equal(clients[0].sessions.length, 0);
  behavior.start = undefined;
  assert.equal(await provider.draft('work', 'Retry', ''), '# Synthetic draft');
  await provider.stop();
});

test('runtime failures and empty responses are explicit and a draft can be retried', async t => {
  const provider = await fixture(t);
  behavior.start = async () => { throw new Error('Synthetic missing runtime'); };
  const status = await provider.status();
  assert.equal(status.authenticated, false);
  assert.match(status.message, /Synthetic missing runtime/);
  behavior.start = undefined;
  behavior.send = async () => undefined;
  await assert.rejects(provider.draft('work', 'Summarize', ''), /no draft/);
  assert.equal(clients.at(-1).sessions[0].disconnected, true);
  behavior.send = undefined;
  assert.equal(await provider.draft('work', 'Retry', ''), '# Synthetic draft');
  await provider.stop();
});

test('plaintext credential consent is refused and its login flow cancelled', async t => {
  const provider = await fixture(t);
  behavior.loginStep = { kind: 'completed', result: { status: 'needs-plaintext-consent' } };
  await assert.rejects(provider.login(true), /will not store your token in plaintext/);
  assert.equal(behavior.loginCancelled, true);
  await provider.stop();
});

test('model discovery refreshes after authentication instead of reusing the SDK cache', async t => {
  const provider = await fixture(t);
  behavior.models = [];
  assert.deepEqual(await provider.models(), []);
  behavior.loginStep = { kind: 'device-code', userCode: 'TEST-CODE', verificationUri: 'https://github.com/login/device' };
  assert.equal((await provider.login(true)).code, 'TEST-CODE');
  behavior.loginStep = { kind: 'completed', result: { status: 'completed' } };
  assert.equal((await provider.login(false)).complete, true);
  behavior.models = [{ id: 'new-model', name: 'New model' }];
  assert.deepEqual(await provider.models(), behavior.models);
  behavior.models = [{ id: 'another-model', name: 'Another model' }];
  assert.deepEqual(await provider.models(), behavior.models);
  await provider.stop();
});

test('shutdown stops the runtime even when cancelling an active draft fails', async t => {
  const provider = await fixture(t);
  let release;
  let sending;
  const sent = new Promise(resolve => { sending = resolve; });
  behavior.send = () => { sending(); return new Promise(resolve => { release = resolve; }); };
  behavior.abort = async () => { throw new Error('Synthetic abort failure'); };
  const draft = provider.draft('work', 'Summarize', '');
  const rejected = assert.rejects(draft, /cancelled/);
  await sent;
  try {
    await assert.rejects(provider.stop(), /Synthetic abort failure/);
    assert.equal(clients[0].stops, 1);
  } finally {
    release({ data: { content: 'Discarded draft' } });
    await rejected;
  }
});
