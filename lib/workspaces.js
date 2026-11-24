// Loaded only for registered workspace operations; legacy Markdown needs no build.
let modulePromise;
export async function workspaceCore() {
  modulePromise ??= import('../dist/core/index.js').catch(error => {
    modulePromise = undefined;
    if (error.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error('Workspace services are not built. Run npm run build:core in a source checkout, or reinstall the published CatPilot package.', { cause: error });
    }
    throw error;
  });
  return modulePromise;
}

export async function workspaceRequest(request) {
  const { WorkspaceService } = await workspaceCore();
  return new WorkspaceService().execute(request);
}

export async function resolveWorkspace(selector) {
  const { WorkspaceRegistry } = await workspaceCore();
  return new WorkspaceRegistry().get(selector || process.env.CATPILOT_WORKSPACE || '');
}

export function workspaceSelected(params = {}) {
  return Boolean(params?.workspace || process.env.CATPILOT_WORKSPACE);
}

export function assertLegacyWorkspace(surface, params = {}) {
  if (workspaceSelected(params)) throw new Error(`${surface} does not support a selected record workspace. Use workspace CLI/MCP operations or the desktop. Refusing to read or change legacy Markdown data.`);
}

export async function workspaceManagement(selector, request) {
  const workspace = await resolveWorkspace(selector);
  return workspaceRequest({ action: 'management', workspaceId: workspace.id, request });
}

function timerRange(params) {
  if (params.from || params.to) return { from: params.from, to: params.to };
  const period = params.period || 'all';
  if (period === 'all') return {};
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start);
  if (period === 'this-week' || period === 'last-week') {
    start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7 - (period === 'last-week' ? 7 : 0));
    if (period === 'last-week') end.setTime(start.getTime() + 6 * 86400000);
  } else if (period === 'this-month' || period === 'last-month') {
    start.setUTCDate(1);
    if (period === 'last-month') { end.setUTCDate(0); start.setUTCMonth(start.getUTCMonth() - 1); }
  } else if (['last-7', 'last-30'].includes(period)) start.setUTCDate(start.getUTCDate() - (period === 'last-7' ? 6 : 29));
  else if (period !== 'today') throw new Error('Unknown timer period. Use today, this-week, last-week, this-month, last-month, last-7, last-30 or all.');
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

/** Async adapter for record workspaces; never fabricates legacy paths/numeric IDs. */
export async function workspaceTool(tool, params = {}) {
  try {
    const workspace = await resolveWorkspace(params.workspace);
    const { openRepository, recordInputSchema, ManagementService } = await workspaceCore();
    const { withWorkspaceWrite } = await import('../dist/core/files.js');
    const execute = async () => {
    const repository = await openRepository(workspace);
    try {
      const { records } = await repository.snapshot();
      const management = new ManagementService(repository);
      let data;
      const byId = () => {
        const record = records.find(item => item.id === params.id);
        if (!record) throw new Error('Record not found. Workspace tools require UUID record IDs, not legacy numeric IDs.');
        return record;
      };
      const update = async fields => {
        const record = byId();
        return repository.put({ ...record, fields: { ...record.fields, ...fields } }, record.id, params.expectedRevision);
      };
      switch (tool) {
        case 'list_tasks':
          data = records.filter(record => record.domain === 'tasks' && (!params.status || params.status === 'all' || record.fields.status.toLowerCase() === params.status.toLowerCase()));
          if (params.quadrant) {
            const ranked = await management.execute({ action: 'prioritize', asOf: new Date().toISOString().slice(0, 10) });
            const ids = new Set(ranked.filter(item => item.quadrant === params.quadrant).map(item => item.record.id));
            data = data.filter(record => ids.has(record.id));
          }
          break;
        case 'add_task':
        case 'add_journal_entry':
        case 'create_memo': {
          const domain = tool === 'add_task' ? 'tasks' : tool === 'create_memo' ? 'knowledge' : 'journal';
          const fields = { ...params.fields };
          for (const key of ['status', 'priority', 'due', 'project', 'goal', 'measure', 'steps', 'why', 'importance', 'urgency', 'period']) {
            if (params[key] !== undefined) fields[key] = params[key];
          }
          if (params.tags !== undefined) fields.tags = Array.isArray(params.tags) ? params.tags : params.tags.split(',').map(tag => tag.trim()).filter(Boolean);
          data = await repository.put(recordInputSchema.parse({ domain, title: params.title || params.text || params.entry, body: params.body ?? params.content ?? params.context ?? params.text ?? params.entry ?? '', fields }));
          break;
        }
        case 'set_task_smart': {
          const fields = {};
          for (const key of ['goal', 'measure', 'steps', 'why', 'importance', 'urgency', 'due']) {
            if (params[key] !== undefined) fields[key] = params[key] === 'auto' ? '' : params[key];
          }
          if (byId().domain !== 'tasks') throw new Error('Expected a task record.');
          data = await update(fields);
          break;
        }
        case 'set_task_status':
          if (byId().domain !== 'tasks') throw new Error('Expected a task record.');
          if (params.status === 'Done') data = await management.execute({ action: 'complete', id: params.id, expectedRevision: params.expectedRevision });
          else data = await update({ status: params.status, completed: '', progress: Math.min(byId().fields.progress, 99) });
          break;
        case 'complete_task':
        case 'add_task_comment':
        case 'task_carry':
          if (byId().domain !== 'tasks') throw new Error('Expected a task record.');
          data = await management.execute({
            action: tool === 'complete_task' ? 'complete' : tool === 'task_carry' ? 'carryForward' : 'comment',
            id: params.id, expectedRevision: params.expectedRevision,
            text: params.text ?? params.comment, period: params.period, dryRun: params.dryRun === true || params.dry_run === true,
          });
          break;
        case 'edit_task_comment':
        case 'remove_task_comment': {
          const record = byId();
          if (record.domain !== 'tasks') throw new Error('Expected a task record.');
          const collections = ['comments', 'log', 'logs'].filter(key => Array.isArray(record.fields[key]) && record.fields[key].length);
          if (!params.collection && collections.length > 1) throw new Error('Multiple comment/log collections exist. Pass collection from list_task_comments together with index and expectedRevision.');
          data = await management.execute({
            action: tool === 'edit_task_comment' ? 'editComment' : 'removeComment',
            id: record.id, expectedRevision: params.expectedRevision, index: Number(params.index),
            collection: params.collection || collections[0] || 'comments', text: params.text, date: params.date,
          });
          break;
        }
        case 'list_task_comments':
          if (byId().domain !== 'tasks') throw new Error('Expected a task record.');
          data = ['log', 'comments', 'logs'].flatMap(collection => {
            const entries = byId().fields[collection];
            if (entries !== undefined && !Array.isArray(entries)) throw new Error(`Invalid ${collection} history. Inspect the record source; metadata was not changed.`);
            return (entries || []).map((entry, index) => ({ ...entry, collection, index }));
          });
          break;
        case 'remove_task': {
          if (byId().domain !== 'tasks') throw new Error('Expected a task record.');
          await repository.remove(params.id, params.expectedRevision);
          data = { removed: params.id };
          break;
        }
        case 'task_focus':
        case 'task_matrix':
          data = await management.execute({ action: 'prioritize', asOf: params.asOf || new Date().toISOString().slice(0, 10) });
          if (tool === 'task_focus' && params.limit) data = data.slice(0, Number(params.limit));
          break;
        case 'list_journal': data = records.filter(record => record.domain === 'journal'); break;
        case 'list_memos': data = records.filter(record => record.domain === 'knowledge'); break;
        case 'read_memo':
          data = byId();
          if (data.domain !== 'knowledge') throw new Error('Expected a knowledge record.');
          break;
        case 'pomodoro_start':
          if (params.force) throw new Error('Complete or cancel the current UUID timer with its expectedRevision before replacing it. No partial timer replacement was performed.');
          if (params.task && !records.some(record => record.domain === 'tasks' && record.id === params.task)) throw new Error('Workspace timer task references must be task UUIDs, not numeric IDs or display labels.');
          data = await management.execute({ action: 'timerStart', title: params.label || params.title, minutes: params.minutes === undefined ? undefined : Number(params.minutes), type: params.type, task: params.task || undefined });
          break;
        case 'pomodoro_status': {
          const status = await management.execute({ action: 'timerStatus' });
          data = status.active ? { ...status.active, elapsedSec: status.elapsedSec, remainingSec: status.remainingSec, isExpired: status.isExpired } : null;
          break;
        }
        case 'pomodoro_complete':
        case 'pomodoro_cancel':
          if (!params.id || !params.expectedRevision) throw new Error('Workspace timer changes require the active UUID id and expectedRevision returned by pomodoro_status.');
          data = await management.execute({ action: tool === 'pomodoro_complete' ? 'timerComplete' : 'timerCancel', id: params.id, expectedRevision: params.expectedRevision, notes: params.notes });
          break;
        case 'pomodoro_list':
          data = records.filter(record => record.domain === 'pomodoro').sort((a, b) => (b.fields.started || b.created).localeCompare(a.fields.started || a.created));
          if (params.limit) data = data.slice(0, Math.max(1, Number(params.limit)));
          break;
        case 'pomodoro_stats':
        case 'pomodoro_report': {
          const range = timerRange(params);
          data = await management.execute({ action: 'timerStats', ...range });
          if (tool === 'pomodoro_report') {
            const groupBy = params.groupBy || 'day';
            if (!['day', 'task', 'type'].includes(groupBy)) throw new Error('Workspace timer reports group by day, task UUID or type.');
            const groups = new Map();
            for (const record of data.sessions) {
              const key = groupBy === 'day' ? (record.fields.started || record.created).slice(0, 10) : String(record.fields[groupBy] || 'Unassigned');
              const group = groups.get(key) || { key, sessions: 0, minutes: 0 };
              group.sessions += 1;
              group.minutes += typeof record.fields.elapsedSec === 'number' ? record.fields.elapsedSec / 60 : 0;
              groups.set(key, group);
            }
            data = { ...data, ...range, groupBy, groups: [...groups.values()].sort((a, b) => a.key.localeCompare(b.key)) };
          }
          break;
        }
        default: throw new Error(`${tool} is not supported for record workspaces. Use workspace record/management APIs; legacy data was not accessed.`);
      }
      return { success: true, data, workspace: { id: workspace.id, backend: workspace.backend }, message: 'Selected workspace responses contain UUID records, not legacy numeric rows. Use expectedRevision for edits; no physical Markdown path is implied.', ...(Array.isArray(data) ? { count: data.length } : {}), ...(tool === 'list_task_comments' ? { comments: data } : {}) };
    } finally { repository.close(); }
    };
    const readOnly = ['list_tasks', 'list_task_comments', 'task_focus', 'task_matrix', 'list_journal', 'list_memos', 'read_memo', 'pomodoro_status', 'pomodoro_list', 'pomodoro_stats', 'pomodoro_report'].includes(tool) || (tool === 'task_carry' && (params.dryRun === true || params.dry_run === true));
    return await (readOnly ? execute() : withWorkspaceWrite(workspace.location, execute));
  } catch (error) { return { success: false, error: error.message }; }
}
