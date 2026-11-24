import readline from 'node:readline';
import { createWorkspaceClient } from './workspace-client.js';

export class WorkspaceTerminal {
  constructor(client) { this.client = client; this.records = []; }
  static async open(selector, options) {
    const terminal = new WorkspaceTerminal(await createWorkspaceClient(selector, options));
    await terminal.refresh();
    return terminal;
  }
  get workspace() { return this.client.workspace; }
  async refresh() { const snapshot = await this.client.request({ action: 'snapshot' }); this.records = snapshot.records; return snapshot; }
  find(id) {
    const record = this.records.find(item => item.id === id);
    if (!record) throw new Error('Record not found in the last snapshot. Use a UUID and refresh first.');
    return record;
  }
  async create(domain, title, fields = {}) {
    const record = await this.client.request({ action: 'put', input: { domain, title, fields } });
    this.records.push(record);
    return record;
  }
  async update(id, patch) {
    const record = this.find(id);
    if (patch.domain && patch.domain !== record.domain) throw new Error('Record domain cannot change.');
    const updated = await this.client.request({
      action: 'put', id, expectedRevision: record.revision,
      input: { domain: record.domain, title: patch.title ?? record.title, body: patch.body ?? record.body, fields: { ...record.fields, ...patch.fields } },
    });
    this.records = this.records.map(item => item.id === id ? updated : item);
    return updated;
  }
  async manage(id, request) {
    const result = await this.client.request({ action: 'management', request: { ...request, id, expectedRevision: this.find(id).revision } });
    await this.refresh();
    return result;
  }
  async command(line) {
    const [, command = '', payload = ''] = /^\s*(\S+)(?:\s+([\s\S]*))?$/.exec(line.trim()) || [];
    const args = payload.split(/\s+/);
    const remainder = payload.slice(args[0]?.length || 0).trimStart();
    switch (command) {
      case 'list': await this.refresh(); return this.records.filter(record => !args[0] || record.domain === args[0]);
      case 'read': return this.find(args[0]);
      case 'add': return this.create(args[0], remainder);
      case 'update': return this.update(args[0], JSON.parse(remainder));
      case 'complete': return this.manage(args[0], { action: 'complete' });
      case 'comment': return this.manage(args[0], { action: 'comment', text: remainder });
      case 'carry': return this.manage(args[0], { action: 'carryForward', period: args[1] });
      case 'remove': {
        const record = this.find(args[0]);
        await this.client.request({ action: 'remove', id: record.id, expectedRevision: record.revision });
        this.records = this.records.filter(item => item.id !== record.id);
        return { removed: record.id };
      }
      case 'report': return this.client.request({ action: 'management', request: { action: 'report', from: args[0], to: args[1] } });
      case 'help': return 'list [domain] | read UUID | add DOMAIN TITLE | update UUID JSON_PATCH | complete UUID | comment UUID TEXT | carry UUID PERIOD | remove UUID | report FROM TO | quit';
      default: throw new Error('Unknown command. Type help. Commands are data operations, never shell commands.');
    }
  }
}

export async function runWorkspaceTerminal(selector, { snapshotOnly = false, input = process.stdin, output = process.stdout, ...options } = {}) {
  const terminal = await WorkspaceTerminal.open(selector, options);
  if (snapshotOnly) { output.write(JSON.stringify({ workspace: terminal.workspace, records: terminal.records }) + '\n'); return; }
  output.write(`CatPilot workspace: ${terminal.workspace.name} (${terminal.workspace.backend}; ${terminal.workspace.id})\nType help for commands. Edits use last-observed revisions; list reloads after conflicts.\n`);
  const reader = readline.createInterface({ input, output, terminal: Boolean(input.isTTY) });
  if (input.isTTY) reader.setPrompt('catpilot> ');
  if (input.isTTY) reader.prompt();
  try {
    for await (const line of reader) {
      if (['quit', 'q', 'exit'].includes(line.trim())) break;
      if (line.trim()) {
        try { output.write(JSON.stringify(await terminal.command(line), null, 2) + '\n'); }
        catch (error) { output.write(`Error: ${error.message}\n`); }
      }
      if (input.isTTY) reader.prompt();
    }
  } finally { reader.close(); }
}
