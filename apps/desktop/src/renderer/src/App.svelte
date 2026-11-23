<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { Domain, RecordEntry, RecordInput, Workspace, Snapshot, AIStatus, AIModel, AILogin, AiProposal } from '../../shared.js';
  import MarkdownEditor from './MarkdownEditor.svelte';
  import Pagination from './Pagination.svelte';
  import SidebarResizer from './SidebarResizer.svelte';
  import ManagementPanel from './ManagementPanel.svelte';
  import ReportsPanel from './ReportsPanel.svelte';
  import TaskPlanning from './TaskPlanning.svelte';
  import ConceptExplorer from './ConceptExplorer.svelte';
  import ConceptNavigation from './ConceptNavigation.svelte';
  import ProjectPortfolio from './ProjectPortfolio.svelte';
  import WorkspaceHistory from './WorkspaceHistory.svelte';
  import AiProposalReview from './AiProposalReview.svelte';
  import FocusPanel from './FocusPanel.svelte';
  import StatusSelect from './StatusSelect.svelte';
  import PriorityBadge from './PriorityBadge.svelte';
  import TagList from './TagList.svelte';
  import { statusNames as statuses, priorityNames } from './presentation.js';
  import {
    LayoutDashboard, ListTodo, BookOpen, NotebookPen, FolderKanban,
    Trophy, Timer, ChartColumn, History, Settings, CircleHelp,
    PanelLeftClose, PanelLeftOpen, Plus, Search, X, FileText, ChevronRight,
    ArrowUpRight, List, Columns3, Grid2x2, CalendarDays, FolderOpen,
    ArrowLeft, Copy, Sparkles, SlidersHorizontal, KeyRound, CircleCheck,
  } from './icons.js';
  import { afterSave, canAutosave } from './autosave.js';
  import { isDocument, recordInputSchema, type RecordEntry as StoredRecord } from '../../../../../packages/core/types.js';
  import { conceptFolderTree, flattenFolders, folderParent, folderTrail, folderVersion, inFolder, joinFolder } from '../../../../../packages/core/concept-folders.js';
  import type { FolderCommand } from '../../../../../packages/core/folder-command.js';
  import { taskReadiness } from '../../../../../packages/core/management.js';
  import { proposalMatches } from './proposal.js';
  import type { ManagementReport } from '../../../../../packages/core/management-types.js';
  import { pageWindow } from './pagination.js';
  import { defaultFields, draftKey, readPreference, writePreference, splitFrontmatter } from './document.js';
  import { dayKey, isDay, dateFromDay, journalDay, achievementYear, focusTaskIds, isConcept, kindNames, kindTones, conceptKinds, tones, type ConceptKind, type Tone } from './workspace-views.js';
  import logo from '../../../../../assets/catpilot-pixel.png';
  const isWeb = window.catpilot.platform === 'web';

  type Page = Exclude<Domain, ConceptKind> | 'concepts' | 'overview' | 'timeline' | 'settings' | 'help';
  const pageForDomain = (domain: Domain): Page => isConcept(domain) ? 'concepts' : domain;
  const navigation: { page: Page; label: string; icon: typeof LayoutDashboard }[] = [
    { page: 'overview', label: 'Overview', icon: LayoutDashboard }, { page: 'tasks', label: 'Tasks', icon: ListTodo },
    { page: 'concepts', label: 'Concepts', icon: BookOpen }, { page: 'journal', label: 'Journal', icon: NotebookPen },
    { page: 'projects', label: 'Projects', icon: FolderKanban },
    { page: 'achievements', label: 'Achievements', icon: Trophy }, { page: 'pomodoro', label: 'Focus', icon: Timer },
    { page: 'reports', label: 'Reports', icon: ChartColumn }, { page: 'timeline', label: 'Timeline', icon: History },
  ];
  const taskViews = [
    { id: 'list', label: 'List', icon: List }, { id: 'board', label: 'Board', icon: Columns3 },
    { id: 'matrix', label: 'Matrix', icon: Grid2x2 }, { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  ];
  const collectionPages = ['tasks', 'projects', 'achievements', 'reports'] as const;
  const capturePages = ['tasks', 'projects', 'achievements', 'reports', 'journal'] as const;
  let workspaces = $state<Workspace[]>([]);
  let workspaceId = $state('');
  let workspace = $derived(workspaces.find(w => w.id === workspaceId));
  let page = $state<Page>('overview');
  // Snapshots are replaced immutably; deep proxies for every field waste memory in large workspaces.
  let storedRecords = $state.raw<StoredRecord[]>([]);
  let records = $derived(storedRecords.filter(isDocument));
  let snapshotRevision = '';
  let selectedId = $state<string | null>(null);
  let draft = $state<RecordInput | null>(null);
  let base = $state('');
  let baseRevision = $state('');
  let dirty = $derived(draft !== null && JSON.stringify(draft) !== base);
  let error = $state('');
  let notice = $state('');
  let loading = $state(false);
  let saving = $state(false);
  let saveError = $state('');
  let changing = $state(false);
  let externalChange = $state(false);
  let recovery = $state<RecordInput | null>(null);
  let recoveryRevision = $state('');
  let search = $state('');
  let filterStatus = $state('');
  let filterFolder = $state('');
  let filterTag = $state('');
  let filterOverdue = $state(false);
  let taskView = $state('list');
  let conceptKind = $state<ConceptKind | ''>('');
  let conceptFolder = $state<string | null>(null);
  let journalMonth = $state('');
  let achievementPeriod = $state('');
  let focusSeed = $state('');
  let conceptPalette = $state<Record<ConceptKind, Tone>>({ knowledge: 'teal', milestones: 'amber', learning: 'violet', growth: 'rose' });
  let editorPanel = $state(false);
  let editorDialog = $state<HTMLDialogElement>();
  let editorTrigger: HTMLElement | null = null;
  let baseJournalDate = $state<unknown>(undefined);
  let documentTab = $state('content');
  const documentTabs = ['content', 'properties', 'activity', 'ai'];
  let contentPage = $state(0);
  let childPage = $state(0);
  let paginationScope = '';
  let sidebarCollapsed = $state(readPreference('context-collapsed', 'false') === 'true');
  let sidebarWidth = $state(220);
  let primaryCollapsed = $state(false);
  let primaryWidth = $state(225);
  let theme = $state(readPreference('theme', 'system'));
  let settingsTab = $state('application');
  let rename = $state('');
  let now = $state(Date.now());
  let modal = $state<'' | 'create' | 'unsaved' | 'remove' | 'unregister' | 'import' | 'folder'>('');
  let folderMode = $state<'create' | 'move' | 'delete'>('create');
  let folderTarget = $state('');
  let folderDestination = $state('');
  let folderName = $state('');
  let folderContents = $state<'keep' | 'delete'>('keep');
  let folderSource = $state.raw<StoredRecord[]>([]);
  let folderStale = $state(false);
  let modalElement = $state<HTMLDivElement>();
  let lastFocus: HTMLElement | null = null;
  let pendingAction: (() => void | Promise<void>) | null = null;
  let createName = $state('');
  let createBackend = $state<'sqlite' | 'markdown'>('sqlite');
  let createLocation = $state('');
  let importPreview = $state<unknown>(null);
  let importKind = $state<'backup' | 'legacy'>('backup');
  let aiEnabled = $state(false);
  let aiStatus = $state<AIStatus | null>(null);
  let aiPrompt = $state('');
  let aiDraft = $state('');
  let aiBusy = $state(false);
  let aiOperation = $state<'' | 'status' | 'login-start' | 'login-finish' | 'models' | 'draft' | 'propose' | 'apply' | 'cancel'>('');
  let aiLogin = $state<AILogin | null>(null);
  let aiCodeMessage = $state('');
  let aiModels = $state<AIModel[]>([]);
  let aiModelsLoaded = $state(false);
  let aiModel = $state('');
  let aiDraftComplete = $state(false);
  let aiProposal = $state.raw<AiProposal | null>(null);
  let aiProposalOrigin = $state<{ workspaceId: string; recordId: string; expectedRevision: string; selection: number } | null>(null);
  let unsubscribeAI: (() => void) | null = null;
  let aiGeneration = 0;
  let selectionGeneration = $state(0);
  let requestGeneration = 0;

  const label = $derived(navigation.find(n => n.page === page)?.label ?? (page === 'settings' ? 'Settings' : 'Help'));
  const names: Partial<Record<Page | Domain, string>> = { tasks: 'task', knowledge: 'note', journal: 'entry', projects: 'project', learning: 'learning path', milestones: 'milestone', growth: 'growth entry', achievements: 'achievement', pomodoro: 'session', reports: 'report' };
  const itemName = $derived(names[draft?.domain ?? page] ?? 'item');
  const availableViews = $derived(page === 'tasks' ? taskViews : []);
  const isCollection = $derived(collectionPages.some(value => value === page));
  const canCreate = $derived(capturePages.some(value => value === page));
  const today = $derived(dayKey(new Date(now)));
  const domainRecords = $derived(records.filter(r => r.domain === page));
  const journalMonths = $derived(page === 'journal' ? [...new Set(domainRecords.map(record => journalDay(record).slice(0, 7)))].sort().reverse() : []);
  const achievementYears = $derived(page === 'achievements' ? [...new Set(domainRecords.map(achievementYear))].sort().reverse() : []);
  const projectStatuses = $derived(page === 'projects' ? statuses.filter(status => domainRecords.some(record => record.fields.status === status) || filterStatus === status) : []);
  const hasContext = $derived(page === 'settings' || (!!workspace && (page === 'tasks' || page === 'concepts' ||
    (page === 'journal' && journalMonths.length > 0) || (page === 'projects' && projectStatuses.length > 0) ||
    (page === 'achievements' && achievementYears.length > 0))));
  const folders = $derived([...new Set(domainRecords.map(r => r.fields.folder).filter(Boolean))].sort());
  const tags = $derived([...new Set(domainRecords.flatMap(r => r.fields.tags))].sort());
  const filtered = $derived(domainRecords.filter(r =>
    (!search || `${r.title} ${r.body} ${r.fields.tags.join(' ')}`.toLowerCase().includes(search.toLowerCase())) &&
    (!filterStatus || r.fields.status === filterStatus) && (page !== 'achievements' || !achievementPeriod || achievementYear(r) === achievementPeriod) &&
    (!filterFolder || r.fields.folder === filterFolder) && (!filterTag || r.fields.tags.includes(filterTag)) &&
    (!filterOverdue || (r.fields.status !== 'Done' && isDay(r.fields.due) && r.fields.due < today))
  ).sort((a, b) => b.updated.localeCompare(a.updated)));
  const recent = $derived([...records].sort((a, b) => b.updated.localeCompare(a.updated)));
  const tasks = $derived(records.filter(r => r.domain === 'tasks'));
  const taskNames = $derived(new Map(tasks.map(task => [task.id, task.title])));
  const activeTasks = $derived(tasks.filter(r => r.fields.status !== 'Done'));
  const overdue = $derived(activeTasks.filter(r => isDay(r.fields.due) && r.fields.due < today).sort((a, b) => a.fields.due.localeCompare(b.fields.due)));
  const upcoming = $derived(activeTasks.filter(r => isDay(r.fields.due) && r.fields.due >= today).sort((a, b) => a.fields.due.localeCompare(b.fields.due)));
  const activeProjects = $derived(records.filter(r => r.domain === 'projects' && r.fields.status !== 'Done'));
  const concepts = $derived(recent.filter(r => isConcept(r.domain)));
  const conceptTree = $derived(conceptFolderTree(storedRecords));
  const conceptPaths = $derived(flattenFolders(conceptTree));
  const affectedConcepts = $derived(folderSource.filter(record => isConcept(record.domain) && inFolder(record.fields.folder, folderTarget)).length);
  const affectedSubfolders = $derived(conceptPaths.filter(path => path !== folderTarget && inFolder(path, folderTarget)).length);
  const contentRange = $derived(pageWindow(filtered.length, contentPage));
  const contentRecords = $derived(filtered.slice(contentRange.start, contentRange.end));
  const focusSessions = $derived(recent.filter(r => r.domain === 'pomodoro' && (r.fields.completed || r.fields.status === 'Done' || r.fields.timerState === 'cancelled'))
    .sort((a, b) => (b.fields.completed || b.fields.started || b.created).localeCompare(a.fields.completed || a.fields.started || a.created)));
  const focusRange = $derived(pageWindow(focusSessions.length, contentPage));
  const focusStats = $derived(focusSessions.reduce((totals, r) => {
    if (r.fields.timerState === 'cancelled') totals.cancelled++;
    else if (r.fields.status === 'Done') {
      totals.completed++;
      if (r.fields.type === 'focus' && typeof r.fields.elapsedSec === 'number') totals.focusMinutes += r.fields.elapsedSec / 60;
    }
    return totals;
  }, { completed: 0, cancelled: 0, focusMinutes: 0 }));
  const readiness = $derived(draft?.domain === 'tasks' ? taskReadiness(draft) : null);
  const contentLabel = $derived(({ knowledge: 'Reference notes', milestones: 'Outcome', learning: 'What you want to learn', growth: 'Accomplishment and impact', journal: 'Reflection', pomodoro: 'Session notes' } as Partial<Record<Domain, string>>)[draft?.domain ?? 'tasks']);
  const children = $derived(selectedId ? records.filter(r => r.id !== selectedId &&
    (r.fields.parent === selectedId || (draft?.domain === 'projects' && r.fields.project === selectedId))) : []);
  const childRange = $derived(pageWindow(children.length, childPage));
  const childRecords = $derived(children.slice(childRange.start, childRange.end));
  const draftScope = $derived(selectedId ?? `new-${draft?.domain ?? page}`);
  const aiControlsBusy = $derived(aiOperation !== '');
  const aiModelUnavailable = $derived(aiModelsLoaded && !!aiModel && !aiModels.some(model => model.id === aiModel));
  const aiDeviceStep = $derived(aiLogin && !aiLogin.complete && !!(aiLogin.code || aiLogin.url));
  const aiLoginUrl = $derived(httpsUrl(aiLogin?.url));
  const selectedRecord = $derived(records.find(record => record.id === selectedId));
  const draftErrors = $derived.by(() => {
    if (!draft) return [];
    const result = recordInputSchema.safeParse(draft);
    const errors = result.success ? [] : result.error.issues.map(issue => {
      const field = issue.path.at(-1);
      if (field === 'title') return 'Title is required (up to 500 characters).';
      if (field === 'due') return 'Choose a valid due date or leave it empty.';
      return `${issue.path.join(' / ')}: ${issue.message}`;
    });
    if (!Number.isInteger(draft.fields.progress)) errors.push('Progress must be a whole number from 0 to 100.');
    if (!Number.isInteger(draft.fields.minutes)) errors.push('Session duration must be a whole number from 1 to 1440 minutes.');
    if (draft.domain === 'journal' && (!selectedId || draft.fields.date !== baseJournalDate) && !isDay(draft.fields.date)) errors.push('Choose a valid entry date.');
    if (draft.domain === 'journal' && !selectedId && !draft.body.trim()) errors.push('Write an entry before saving.');
    if (isConcept(draft.domain) && draft.fields.folder && !conceptPaths.includes(draft.fields.folder)) {
      errors.push('This folder is no longer available. Choose a different folder or Unfiled.');
    }
    return [...new Set(errors)];
  });
  const draftValid = $derived(!!draft && !draftErrors.length);
  const importWarnings = $derived(importPreview && typeof importPreview === 'object' && 'warnings' in importPreview &&
    Array.isArray(importPreview.warnings) ? importPreview.warnings.filter((value): value is string => typeof value === 'string') : []);

  function message(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
  async function request<T>(value: Parameters<Window['catpilot']['request']>[0]): Promise<T> {
    return await window.catpilot.request(value) as T;
  }
  function attempt(action: () => Promise<unknown>) { void action().catch(cause => { error = message(cause); }); }
  function date(value: string) { return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); }
  function openModal(value: typeof modal) {
    lastFocus = document.activeElement as HTMLElement;
    modal = value;
  }
  function closeModal() {
    const folderDialog = modal === 'folder';
    modal = ''; pendingAction = null;
    if (folderDialog) error = '';
    const trigger = lastFocus;
    void tick().then(() => {
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      else if (folderDialog) [...document.querySelectorAll<HTMLButtonElement>('.folder-tree-link, button[aria-label="New folder"]')]
        .find(button => button.getClientRects().length && (button.dataset.folderPath === conceptFolder || !button.dataset.folderPath))?.focus();
    });
  }
  function guard(action: () => void | Promise<void>) {
    if (saving || changing) return;
    if (dirty) { pendingAction = action; openModal('unsaved'); }
    else attempt(async () => { await action(); });
  }
  async function resolveUnsaved(saveFirst: boolean) {
    const action = pendingAction;
    if (saveFirst && !await save()) return;
    if (!saveFirst) {
      clearRecovery();
      if (draft && base) {
        draft = JSON.parse(base) as RecordInput;
        recovery = null;
        selectionGeneration++;
      }
    }
    closeModal();
    if (action) await action();
  }
  function clearRecovery() {
    if (!workspaceId || !draft) return;
    try { localStorage.removeItem(draftKey(workspaceId, draftScope)); } catch { /* Do not block explicit saves. */ }
  }
  function clearSelection() {
    const trigger = editorTrigger;
    editorTrigger = null;
    if (editorPanel) {
      editorDialog?.close();
      editorPanel = false;
      if (trigger) void tick().then(() => { if (trigger.isConnected) trigger.focus({ preventScroll: true }); });
    }
    const hadProposal = !!aiProposalOrigin;
    stopAIStream();
    clearAIProposal();
    if (hadProposal || aiControlsBusy || aiDeviceStep) attempt(() => window.catpilot.aiCancel());
    selectionGeneration++;
    selectedId = null; draft = null; base = ''; baseRevision = ''; externalChange = false;
    recovery = null; recoveryRevision = ''; aiDraft = ''; aiPrompt = ''; aiGeneration++; aiBusy = false;
    aiOperation = ''; aiLogin = null;
    documentTab = 'content'; aiCodeMessage = '';
    aiDraftComplete = false;
    saveError = '';
    childPage = 0;
  }
  function selectRecord(record: StoredRecord, panel = false) {
    if (!isDocument(record)) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    guard(() => {
      clearSelection();
      if (panel) { editorPanel = true; editorTrigger = trigger; }
      else page = pageForDomain(record.domain);
      selectedId = record.id;
      baseJournalDate = record.fields.date;
      draft = { domain: record.domain, title: record.title, body: record.body, fields: structuredClone($state.snapshot(record.fields)) };
      base = JSON.stringify(draft); baseRevision = record.revision; readRecovery();
    });
  }
  function readRecovery() {
    try {
      const raw = localStorage.getItem(draftKey(workspaceId, draftScope));
      if (!raw) return;
      const stored = JSON.parse(raw);
      if (stored.input && stored.input.domain === draft?.domain && typeof stored.input.title === 'string' &&
          typeof stored.input.body === 'string' && stored.input.fields && typeof stored.input.fields === 'object' &&
          JSON.stringify(stored.input) !== base) {
        recovery = stored.input;
        recoveryRevision = typeof stored.baseRevision === 'string' ? stored.baseRevision : '';
      }
    } catch { notice = 'A recovery draft could not be read. The saved document is unchanged.'; }
  }
  function newRecord(parent = '', options: { domain?: Domain; date?: string; panel?: boolean } = {}) {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    guard(() => {
      clearSelection();
      const domain = options.domain ?? (page === 'concepts' ? conceptKind || 'knowledge' : isCollection || page === 'journal' ? page as Domain : 'tasks');
      const fields: RecordInput['fields'] = { ...defaultFields(), parent };
      if (isConcept(domain)) fields.folder = conceptFolder ?? '';
      if (parent && domain === 'tasks' && records.some(record => record.id === parent && record.domain === 'projects')) fields.project = parent;
      if (domain === 'journal') fields.date = options.date ?? today;
      if (domain === 'tasks' && options.date) fields.due = options.date;
      if (options.panel) { editorPanel = true; editorTrigger = trigger; }
      else page = pageForDomain(domain);
      draft = { domain, title: domain === 'journal' ? String(fields.date) : '', body: '', fields };
      base = JSON.stringify(draft); readRecovery();
    });
  }
  function closeEditor() {
    guard(() => { clearSelection(); error = ''; notice = ''; });
  }
  function renameJournalDate(day: string) {
    if (!draft || !isDay(day)) return;
    if (!selectedId && draft.title === draft.fields.date) draft.title = day;
    draft.fields.date = day;
  }
  function changeConceptColor(kind: ConceptKind, tone: Tone) {
    conceptPalette[kind] = tone;
    writePreference(`concept-tone:${workspaceId}:${kind}`, tone);
  }
  function openFolderDialog(mode: typeof folderMode, path: string) {
    if (saving || changing || loading) return;
    folderMode = mode; folderTarget = path; folderName = ''; folderContents = 'keep';
    folderDestination = mode === 'move' ? folderParent(path) : path;
    folderSource = storedRecords;
    folderStale = false; error = '';
    openModal('folder');
  }
  async function changeFolder(command: FolderCommand, observed = storedRecords) {
    if (saving || changing || loading || !workspaceId) return;
    const ws = workspaceId;
    requestGeneration++;
    changing = true; error = ''; notice = '';
    try {
      const snapshot = await request<Snapshot>({ action: 'conceptFolder', workspaceId: ws, expected: await folderVersion(observed), command });
      if (workspaceId !== ws) return;
      storedRecords = snapshot.records; snapshotRevision = snapshot.revision;
      if (command.type === 'create') {
        conceptFolder = joinFolder(command.parent, command.name);
        notice = 'Folder created.';
      } else if (command.type === 'move') {
        const destination = joinFolder(command.parent, folderTrail(command.path).at(-1)!);
        conceptFolder = conceptFolder && inFolder(conceptFolder, command.path)
          ? destination + conceptFolder.slice(command.path.length) : destination;
        notice = 'Folder and its contents moved.';
      } else {
        if (conceptFolder && inFolder(conceptFolder, command.path)) conceptFolder = folderParent(command.path);
        notice = command.contents === 'keep' ? 'Folder deleted. Its contents were kept.' : 'Folder and its contents deleted.';
      }
      if (modal === 'folder') closeModal();
    } catch (cause) {
      if (/another window|another process/i.test(message(cause))) {
        if (modal === 'folder') folderStale = true;
        throw new Error('Concepts changed in another window or process. Close this dialog if it is open, refresh the workspace, then try again.');
      }
      throw cause;
    } finally { changing = false; }
  }
  function submitFolder(event: SubmitEvent) {
    event.preventDefault();
    const command: FolderCommand = folderMode === 'create' ? { type: 'create', parent: folderTarget, name: folderName.trim() }
      : folderMode === 'move' ? { type: 'move', path: folderTarget, parent: folderDestination }
      : { type: 'delete', path: folderTarget, contents: folderContents };
    attempt(() => changeFolder(command, folderSource));
  }
  function navigate(target: Page) {
    guard(() => {
      clearSelection(); page = target; search = ''; filterStatus = ''; filterFolder = ''; filterTag = '';
      filterOverdue = false;
      error = ''; notice = '';
      if (!isWeb && target === 'settings' && settingsTab === 'agents') attempt(testAIConnection);
    });
  }
  function focusOnTask(id: string) {
    guard(() => {
      clearSelection(); page = 'pomodoro'; focusSeed = id; error = ''; notice = '';
    });
  }
  function chooseView(view: string) {
    guard(() => { clearSelection(); taskView = view; error = ''; notice = ''; });
  }
  function chooseSettings(tab: string) {
    settingsTab = tab;
    if (!isWeb && tab === 'agents' && !aiControlsBusy) attempt(testAIConnection);
  }
  function tabKeys(event: KeyboardEvent, values: string[], current: string, select: (value: string) => void) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? values.length - 1
      : (values.indexOf(current) + (event.key === 'ArrowRight' ? 1 : -1) + values.length) % values.length;
    select(values[index]);
    (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus();
  }
  async function loadWorkspace(requestedId: string) {
    const id = workspaces.some(item => item.id === requestedId) ? requestedId : workspaces[0]?.id ?? '';
    const generation = ++requestGeneration;
    clearSelection(); workspaceId = id; storedRecords = []; snapshotRevision = ''; loading = true;
    primaryWidth = Math.max(180, Math.min(300, Number(readPreference(`primary-width:${id}`, '225')) || 225));
    sidebarWidth = 220;
    primaryCollapsed = readPreference(`primary-collapsed:${id}`, 'false') === 'true';
    sidebarCollapsed = readPreference(`context-collapsed:${id}`, 'false') === 'true';
    aiModel = id ? readPreference(`ai-model:${id}`, '') : '';
    aiModels = []; aiModelsLoaded = false;
    filterStatus = ''; filterFolder = ''; filterTag = ''; filterOverdue = false; search = ''; importPreview = null;
    conceptKind = ''; conceptFolder = null; journalMonth = ''; achievementPeriod = ''; focusSeed = '';
    for (const kind of conceptKinds) {
      const tone = readPreference(`concept-tone:${id}:${kind}`, kindTones[kind]);
      conceptPalette[kind] = tones.find(value => value === tone) ?? kindTones[kind];
    }
    rename = workspaces.find(w => w.id === id)?.name ?? '';
    try {
      if (id) {
        const snapshot = await request<Snapshot>({ action: 'snapshot', workspaceId: id });
        if (generation !== requestGeneration) return;
        storedRecords = snapshot.records; snapshotRevision = snapshot.revision;
      }
      writePreference('workspace', id);
    } finally { if (generation === requestGeneration) loading = false; }
    if (aiStatus?.authenticated && !aiControlsBusy) attempt(loadAIModels);
  }
  async function refresh(poll = false) {
    if (!workspaceId || loading || saving || changing || (poll && modal)) return;
    const id = workspaceId;
    const generation = requestGeneration;
    const snapshot = await request<Snapshot>({ action: 'snapshot', workspaceId: id });
    if (id !== workspaceId || generation !== requestGeneration || saving || changing) return;
    if (snapshot.revision === snapshotRevision) return;
    const current = snapshot.records.find(r => r.id === selectedId);
    if (draft && selectedId && current?.revision !== baseRevision) {
      externalChange = true;
      // Keep the active editor intact, including clean selections, until explicit reload.
    }
    // Draft content is separate: unrelated records and our own completed saves are not conflicts.
    storedRecords = snapshot.records; snapshotRevision = snapshot.revision;
    if (conceptFolder && !conceptPaths.includes(conceptFolder)) conceptFolder = null;
  }
  async function reload() {
    guard(async () => {
      const id = selectedId;
      const ws = workspaceId;
      const snapshot = await request<Snapshot>({ action: 'snapshot', workspaceId: ws });
      if (ws !== workspaceId) return;
      storedRecords = snapshot.records; snapshotRevision = snapshot.revision;
      const record = records.find(r => r.id === id);
      if (record && editorPanel) {
        draft = { domain: record.domain, title: record.title, body: record.body, fields: structuredClone($state.snapshot(record.fields)) };
        base = JSON.stringify(draft); baseRevision = record.revision; baseJournalDate = record.fields.date;
        externalChange = false; saveError = ''; error = ''; recovery = null; selectionGeneration++;
      } else {
        clearSelection();
        if (record) selectRecord(record);
        else notice = 'The item is no longer in this workspace.';
      }
    });
  }
  async function save(automatic = false): Promise<boolean> {
    if (!draft || !workspaceId || saving || changing || loading || externalChange || aiOperation === 'apply') return false;
    if (!draftValid) {
      error = draftErrors.join(' ');
      if (!draft.title.trim()) { documentTab = 'content'; document.getElementById('document-title')?.focus(); }
      else if (draft.domain === 'journal') { documentTab = 'content'; }
      else documentTab = 'properties';
      return false;
    }
    if (!dirty && selectedId) return true;
    const ws = workspaceId;
    const generation = selectionGeneration;
    const input = structuredClone($state.snapshot(draft));
    const key = draftKey(ws, draftScope);
    requestGeneration++;
    saving = true; error = ''; saveError = '';
    try {
      const saved = await request<RecordEntry>({ action: 'put', workspaceId: ws, input, ...(selectedId ? { id: selectedId, expectedRevision: baseRevision } : {}) });
      if (ws !== workspaceId || generation !== selectionGeneration) return false;
      storedRecords = [...storedRecords.filter(r => r.id !== saved.id), saved];
      selectedId = saved.id; baseRevision = saved.revision;
      baseJournalDate = saved.fields.date;
      const reconciled = afterSave(input, $state.snapshot(draft), saved);
      draft = reconciled.draft; base = reconciled.base; recovery = null; externalChange = false;
      try { localStorage.removeItem(key); } catch { /* Saved data is authoritative. */ }
      if (!automatic) notice = dirty ? 'Saved earlier changes. Newer edits are waiting to save.' : 'Saved to workspace.';
      return !dirty;
    } catch (cause) {
      saveError = message(cause); error = saveError;
      if (/another window|another process|conflict|changed.*reload/i.test(saveError)) externalChange = true;
      return false;
    }
    finally { saving = false; }
  }
  async function updateFields(record: RecordEntry, fields: Partial<RecordInput['fields']>) {
    if (saving || changing) return;
    const ws = workspaceId;
    requestGeneration++;
    changing = true;
    try {
      const updated = await request<RecordEntry>({
        action: 'put', workspaceId: ws, id: record.id, expectedRevision: record.revision,
        input: { domain: record.domain, title: record.title, body: record.body, fields: { ...record.fields, ...fields } },
      });
      if (ws === workspaceId) storedRecords = storedRecords.map(r => r.id === updated.id ? updated : r);
      if (ws === workspaceId && fields.status) notice = `Moved “${updated.title}” to ${fields.status}.`;
    } finally { changing = false; }
  }
  function managementBusy(value: boolean) {
    if (value) requestGeneration++;
    changing = value;
  }
  function managementUpdated(record: RecordEntry) {
    storedRecords = [...storedRecords.filter(item => item.id !== record.id), record];
    if (selectedId !== record.id) return;
    if (dirty) { externalChange = true; return; }
    draft = { domain: record.domain, title: record.title, body: record.body, fields: structuredClone(record.fields) };
    base = JSON.stringify(draft); baseRevision = record.revision; externalChange = false;
    notice = 'Management update saved.';
  }
  function createReport(report: ManagementReport) {
    guard(() => {
      clearSelection(); page = 'reports';
      draft = { domain: 'reports', title: `Report ${report.from} to ${report.to}`, body: report.markdown, fields: { ...defaultFields(), folder: 'Reports', period: `${report.from} to ${report.to}` } };
      base = '';
    });
  }
  async function removeRecord() {
    if (!selectedId) return;
    requestGeneration++;
    changing = true;
    try {
      await request({ action: 'remove', workspaceId, id: selectedId, expectedRevision: baseRevision });
      clearRecovery(); storedRecords = storedRecords.filter(r => r.id !== selectedId); clearSelection(); closeModal();
      notice = 'Item deleted.';
    } finally { changing = false; }
  }
  async function createWorkspace() {
    changing = true;
    try {
      const created = await request<Workspace>({ action: 'createWorkspace', name: createName, backend: createBackend, ...(createLocation ? { location: createLocation } : {}) });
      workspaces = [...workspaces, created]; closeModal(); await loadWorkspace(created.id); page = 'overview';
      createName = ''; createLocation = ''; createBackend = 'sqlite';
    } finally { changing = false; }
  }
  async function renameWorkspace() {
    changing = true;
    try {
      await request({ action: 'renameWorkspace', workspaceId, name: rename });
      workspaces = workspaces.map(w => w.id === workspaceId ? { ...w, name: rename.trim() } : w);
      notice = 'Workspace renamed.';
    } finally { changing = false; }
  }
  async function unregisterWorkspace() {
    changing = true;
    try {
      await request({ action: 'unregisterWorkspace', workspaceId });
      workspaces = workspaces.filter(w => w.id !== workspaceId);
      closeModal(); await loadWorkspace(workspaces[0]?.id ?? ''); notice = 'Workspace unregistered. Its files were not deleted.';
    } finally { changing = false; }
  }
  async function previewImport(kind: 'backup' | 'legacy' = 'backup') {
    const ws = workspaceId;
    if (!ws || storedRecords.length) { error = 'Choose an empty destination workspace before importing.'; return; }
    changing = true;
    try {
      const preview = kind === 'legacy' ? await window.catpilot.importLegacy(ws, true) : await window.catpilot.importBackup(ws, true);
      if (ws !== workspaceId || preview == null || preview === false) return;
      importKind = kind; importPreview = preview; error = ''; openModal('import');
    } finally { changing = false; }
  }
  async function approveImport() {
    changing = true;
    try {
      if (storedRecords.length) throw new Error('The destination is no longer empty. Choose another destination and preview again.');
      const result = importKind === 'legacy' ? await window.catpilot.importLegacy(workspaceId, false) : await window.catpilot.importBackup(workspaceId, false);
      if (result === false || result == null) { notice = 'Import canceled.'; return; }
      const legacy = importKind === 'legacy';
      closeModal(); await loadWorkspace(workspaceId); notice = legacy ? 'Legacy vault imported. The source remains untouched.' : 'Backup imported with its portable assets.';
    } finally { changing = false; }
  }
  async function enableAI() {
    if (aiControlsBusy) return;
    aiEnabled = !aiEnabled;
    if (!aiEnabled && aiProposalOrigin) await cancelAI(true);
    if (aiEnabled) await testAIConnection();
  }
  function httpsUrl(value: string | undefined): string {
    if (!value) return '';
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
  }
  function aiCurrent(generation: number, ws: string): boolean {
    return generation === aiGeneration && workspaceId === ws;
  }
  async function testAIConnection() {
    if (aiControlsBusy) return;
    const generation = ++aiGeneration;
    const ws = workspaceId;
    aiOperation = 'status'; error = '';
    try {
      const status = await window.catpilot.aiStatus();
      if (aiCurrent(generation, ws)) {
        aiStatus = status;
        if (status.authenticated) {
          aiLogin = null; aiCodeMessage = '';
          aiOperation = 'models';
          await discoverModels(generation, ws);
        } else { aiModels = []; aiModelsLoaded = false; }
      }
    } catch (cause) {
      if (aiCurrent(generation, ws)) {
        if (aiOperation === 'status') aiStatus = null;
        error = aiOperation === 'models' ? `GitHub is connected, but models could not be loaded. Refresh models to retry. ${message(cause)}` : message(cause);
      }
    } finally { if (aiCurrent(generation, ws)) aiOperation = ''; }
  }
  async function signIn(begin: boolean) {
    if (aiControlsBusy) return;
    const generation = ++aiGeneration;
    const ws = workspaceId;
    aiOperation = begin ? 'login-start' : 'login-finish'; error = '';
    if (begin) { aiLogin = null; aiStatus = null; aiModels = []; aiModelsLoaded = false; }
    try {
      let result = await window.catpilot.aiLogin(begin);
      if (!aiCurrent(generation, ws)) return;
      aiLogin = result;
      if (result.code) await copyDeviceCode();
      const deadline = Date.now() + 10 * 60_000;
      aiOperation = 'login-finish';
      while (!result.complete && aiCurrent(generation, ws)) {
        if (Date.now() >= deadline) throw new Error('GitHub sign-in timed out. Start sign-in again to get a new code.');
        result = await window.catpilot.aiLogin(false);
        if (!aiCurrent(generation, ws)) return;
        aiLogin = { ...aiLogin, ...result, code: result.code ?? aiLogin?.code, url: result.url ?? aiLogin?.url };
        if (!result.complete) await new Promise(resolve => window.setTimeout(resolve, 5000));
      }
      if (!aiCurrent(generation, ws)) return;
      aiLogin = null; aiCodeMessage = ''; aiOperation = 'status';
      const status = await window.catpilot.aiStatus();
      if (!aiCurrent(generation, ws)) return;
      aiStatus = status;
      if (!status.authenticated) throw new Error(status.message);
      aiOperation = 'models';
      await discoverModels(generation, ws);
      if (aiCurrent(generation, ws)) notice = 'GitHub connected. Available AI models are ready.';
    } catch (cause) {
      if (aiCurrent(generation, ws)) {
        aiLogin = null; aiCodeMessage = ''; error = message(cause);
        try { await window.catpilot.aiCancel(); }
        catch (cleanup) { error += ` Sign-in cleanup failed: ${message(cleanup)}`; }
      }
    }
    finally { if (aiCurrent(generation, ws)) aiOperation = ''; }
  }
  async function copyDeviceCode() {
    try { await window.catpilot.copyLoginCode(); aiCodeMessage = 'Code copied to clipboard.'; }
    catch (cause) { aiCodeMessage = `Could not copy the code: ${message(cause)} Select and copy the code below.`; }
  }
  async function discoverModels(generation: number, ws: string) {
    const models = await window.catpilot.aiModels();
    if (!aiCurrent(generation, ws)) return;
    aiModels = models; aiModelsLoaded = true;
  }
  async function loadAIModels() {
    if (aiControlsBusy || !aiStatus?.authenticated) return;
    const generation = ++aiGeneration;
    const ws = workspaceId;
    aiOperation = 'models'; error = '';
    try {
      await discoverModels(generation, ws);
    } catch (cause) { if (aiCurrent(generation, ws)) error = message(cause); }
    finally { if (aiCurrent(generation, ws)) aiOperation = ''; }
  }
  function selectAIModel(value: string) {
    aiModel = value;
    if (workspaceId) writePreference(`ai-model:${workspaceId}`, value);
  }
  async function generateAI() {
    if (!draft || !aiPrompt.trim() || aiPrompt.length > 10_000 || !aiEnabled || aiControlsBusy || !aiStatus?.authenticated || aiModelUnavailable) return;
    clearAIProposal();
    const generation = ++aiGeneration;
    const ws = workspaceId;
    const context = `Title: ${draft.title}\n\n${draft.body}`;
    aiBusy = true; aiOperation = 'draft'; aiDraft = ''; aiDraftComplete = false; error = '';
    try {
      stopAIStream();
      unsubscribeAI = window.catpilot.onAiChunk(chunk => {
        if (aiCurrent(generation, ws) && aiOperation === 'draft' && chunk.workspaceId === ws) aiDraft = chunk.text;
      });
      const text = await window.catpilot.aiDraft(ws, aiPrompt, context, aiModel || undefined);
      if (aiCurrent(generation, ws)) { aiDraft = text; aiDraftComplete = true; }
    } catch (cause) { if (aiCurrent(generation, ws)) error = message(cause); }
    finally { if (aiCurrent(generation, ws)) { stopAIStream(); aiBusy = false; aiOperation = ''; } }
  }
  function stopAIStream() { unsubscribeAI?.(); unsubscribeAI = null; }
  function clearAIProposal() { aiProposal = null; aiProposalOrigin = null; }
  async function proposeAI() {
    if (!selectedRecord || !draft || dirty || externalChange || saving || changing || aiControlsBusy ||
        !aiEnabled || !aiStatus?.authenticated || !aiPrompt.trim() || aiPrompt.length > 10_000 || aiModelUnavailable ||
        selectedRecord.revision !== baseRevision) return;
    const origin = { workspaceId, recordId: selectedRecord.id, expectedRevision: baseRevision, selection: selectionGeneration };
    const generation = ++aiGeneration;
    clearAIProposal(); stopAIStream();
    aiProposalOrigin = origin; aiOperation = 'propose'; error = '';
    try {
      const proposal = await window.catpilot.aiPropose(origin.workspaceId, origin.recordId, origin.expectedRevision, aiPrompt, aiModel || undefined);
      if (!aiCurrent(generation, origin.workspaceId) || origin.selection !== selectionGeneration) return;
      if (dirty || externalChange || !selectedRecord || !proposalMatches(proposal, origin, selectedRecord)) {
        throw new Error('The saved record changed or the proposal does not match this selection. Reload and request a new proposal.');
      }
      aiProposal = proposal;
    } catch (cause) {
      if (aiCurrent(generation, origin.workspaceId)) {
        clearAIProposal(); error = message(cause);
        attempt(() => cancelAI(true));
      }
    } finally { if (aiCurrent(generation, origin.workspaceId)) aiOperation = ''; }
  }
  async function applyAIProposal() {
    if (!aiProposal || !aiProposalOrigin || aiControlsBusy || saving || changing) return;
    const proposal = aiProposal;
    const origin = aiProposalOrigin;
    if (dirty || externalChange || !selectedRecord || selectedId !== origin.recordId || workspaceId !== origin.workspaceId ||
        baseRevision !== origin.expectedRevision || selectedRecord.revision !== origin.expectedRevision ||
        selectionGeneration !== origin.selection || !proposalMatches(proposal, origin, selectedRecord)) {
      clearAIProposal(); error = 'This proposal is no longer current. Save or reload the record and request a new proposal.'; return;
    }
    const generation = ++aiGeneration;
    requestGeneration++;
    changing = true; aiOperation = 'apply'; error = '';
    clearAIProposal();
    try {
      const saved = await window.catpilot.aiApply(origin.workspaceId, proposal.id);
      if (!aiCurrent(generation, origin.workspaceId) || selectedId !== origin.recordId) return;
      if (saved.id !== origin.recordId) throw new Error('The approved edit returned a different record. Reload the selected record.');
      clearRecovery(); recovery = null; recoveryRevision = '';
      managementUpdated(saved); if (!editorPanel) page = pageForDomain(saved.domain); selectionGeneration++;
      notice = 'Approved AI edit saved to workspace.';
    } catch (cause) {
      if (aiCurrent(generation, origin.workspaceId)) {
        error = message(cause); externalChange = true;
        try { await window.catpilot.aiCancel(); }
        catch (cleanup) { error += ` Approval token cleanup failed: ${message(cleanup)}`; }
      }
    } finally {
      changing = false;
      if (aiCurrent(generation, origin.workspaceId)) aiOperation = '';
    }
  }
  async function cancelAI(preserveDraft = false) {
    if (aiOperation === 'cancel' || aiOperation === 'apply') return;
    const generation = ++aiGeneration;
    const ws = workspaceId;
    stopAIStream();
    clearAIProposal();
    aiBusy = false; if (!preserveDraft) aiDraftComplete = false;
    aiOperation = 'cancel'; aiLogin = null;
    try {
      await window.catpilot.aiCancel();
      if (aiCurrent(generation, ws)) notice = 'AI operation canceled.';
    } catch (cause) { if (aiCurrent(generation, ws)) error = message(cause); }
    finally { if (aiCurrent(generation, ws)) aiOperation = ''; }
  }
  function keydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!modal) void save(); }
    if (!modal) return;
    if (event.key === 'Escape' && !changing && !saving) { event.preventDefault(); closeModal(); }
    if (event.key === 'Tab' && modalElement) {
      const elements = [...modalElement.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')];
      const first = elements[0]; const last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }
  function interceptLinks(event: MouseEvent) {
    const anchor = (event.target as Element).closest('a');
    if (!anchor) return;
    event.preventDefault();
    const href = anchor.getAttribute('href') ?? '';
    if (/^https?:\/\//i.test(href)) attempt(() => window.catpilot.openExternal(href));
    else notice = 'Only HTTP and HTTPS external links can be opened here.';
  }
  $effect(() => {
    writePreference('theme', theme);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.theme = theme === 'system' ? media.matches ? 'dark' : 'light' : theme; };
    apply(); media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  });
  $effect(() => { if (workspaceId) writePreference(`context-collapsed:${workspaceId}`, String(sidebarCollapsed)); });
  $effect(() => { if (workspaceId) writePreference(`primary-collapsed:${workspaceId}`, String(primaryCollapsed)); });
  $effect(() => {
    const scope = JSON.stringify([workspaceId, page, search, filterStatus, filterFolder, filterTag, filterOverdue, taskView, achievementPeriod]);
    if (scope !== paginationScope) {
      paginationScope = scope;
      contentPage = 0;
    }
  });
  $effect(() => {
    const origin = aiProposalOrigin;
    if (!origin) return;
    if (dirty || externalChange || workspaceId !== origin.workspaceId || selectedId !== origin.recordId ||
        baseRevision !== origin.expectedRevision || selectedRecord?.revision !== origin.expectedRevision ||
        selectionGeneration !== origin.selection) {
      clearAIProposal();
      attempt(() => cancelAI(true));
      notice = 'AI edit proposal cleared because the selected record changed. Save or reload before requesting another.';
    }
  });
  $effect(() => {
    const content = draft ? JSON.stringify(draft) : '';
    if (!selectedId || !content || !canAutosave({
      dirty, valid: draftValid, workspace: !!workspaceId, loading, saving, changing, conflict: externalChange,
      modal: !!modal, aiBusy: aiControlsBusy || !!aiProposalOrigin, failed: !!saveError,
    })) return;
    const timeout = window.setTimeout(() => { void save(true); }, 1000);
    return () => clearTimeout(timeout);
  });
  $effect(() => {
    if (!dirty || !draft || !workspaceId) return;
    try { localStorage.setItem(draftKey(workspaceId, draftScope), JSON.stringify({ input: draft, baseRevision, savedAt: new Date().toISOString() })); }
    catch { error = 'Draft recovery could not be stored. Save explicitly before leaving this window.'; }
  });
  $effect(() => { if (modal) queueMicrotask(() => modalElement?.querySelector<HTMLElement>('input, button, select')?.focus()); });
  $effect(() => {
    if (editorDialog && !editorDialog.open) editorDialog.showModal();
  });
  onMount(() => {
    attempt(async () => {
      workspaces = await request<Workspace[]>({ action: 'listWorkspaces' });
      await loadWorkspace(readPreference('workspace', ''));
    });
    const poll = window.setInterval(() => { attempt(() => refresh(true)); now = Date.now(); }, 3000);
    const clock = window.setInterval(() => { now = Date.now(); }, 1000);
    const unload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', unload);
    return () => { stopAIStream(); clearInterval(poll); clearInterval(clock); window.removeEventListener('beforeunload', unload); };
  });
</script>

<svelte:window onkeydown={keydown} />

{#snippet aiModelControls()}
  <div class="model-picker">
  <label>AI model
    <select aria-label="AI model" value={aiModel} disabled={aiControlsBusy || !aiStatus?.authenticated || !workspaceId} onchange={event => selectAIModel(event.currentTarget.value)}>
      <option value="">Provider default</option>
      {#if aiModel && !aiModels.some(model => model.id === aiModel)}<option value={aiModel}>{aiModel} (saved selection)</option>{/if}
      {#each aiModels as model (model.id)}<option value={model.id}>{model.name} ({model.id})</option>{/each}
    </select>
  </label>
  <button disabled={aiControlsBusy || !aiStatus?.authenticated} onclick={() => attempt(loadAIModels)}>{aiOperation === 'models' ? 'Loading models...' : 'Refresh models'}</button>
  </div>
  {#if !workspaceId}<p class="small subtle">Select a workspace to choose a model.</p>
  {:else}<p class="small subtle">{aiStatus?.authenticated ? 'Models refresh after sign-in. Your selection is saved for this workspace.' : 'Connect GitHub to discover available models.'}</p>{/if}
  {#if aiModelsLoaded && !aiModels.length}<p class="editor-notice">The provider returned no selectable models. You can still use its default model.</p>{/if}
  {#if aiModelUnavailable}<p class="editor-notice" role="status">The saved model is not in the available list. Choose another model or Provider default before drafting.</p>{/if}
{/snippet}

<div class="desktop-shell">
  <aside class="primary-sidebar" class:is-collapsed={primaryCollapsed} style:--primary-width={`${primaryWidth}px`} aria-label="Main navigation">
    <div class="brand"><img src={logo} alt="CatPilot logo" /><span>CatPilot<span class="brand-dot">.</span></span></div>
    <div class="workspace-switcher">
      <label class="eyebrow" for="workspace">WORKSPACE</label>
      <div class="workspace-row">
        <select id="workspace" value={workspaceId} disabled={loading || saving || changing} onchange={event => {
          const target = event.currentTarget.value; event.currentTarget.value = workspaceId; guard(() => loadWorkspace(target));
        }} aria-label="Switch workspace">
          {#if !workspaces.length}<option value="">No workspace yet</option>{/if}
          {#each workspaces as item}<option value={item.id}>{item.name}</option>{/each}
        </select>
        <button class="icon-button" aria-label="Create workspace" title="Create workspace" onclick={() => guard(() => openModal('create'))}><Plus size={18} aria-hidden="true" /></button>
      </div>
      {#if workspace}<span class="backend-label"><span class="status-dot"></span>{workspace.backend === 'sqlite' ? 'SQLite' : 'Markdown'} workspace</span>{/if}
    </div>
    <nav>
      {#each navigation as item}
        <button aria-label={item.label} title={item.label} class:nav-active={page === item.page} onclick={() => navigate(item.page)} aria-current={page === item.page ? 'page' : undefined}>
          <span class="nav-icon" aria-hidden="true"><item.icon size={19} strokeWidth={1.75} /></span><span>{item.label}</span>
          {#if item.page === 'tasks' && activeTasks.length}<span class="nav-count">{activeTasks.length}</span>{/if}
        </button>
      {/each}
    </nav>
    <div class="sidebar-bottom">
      <p class="local-note"><span class="status-dot"></span> Your space. Your files.</p>
      <button aria-label="Settings" title={primaryCollapsed ? 'Settings' : undefined} class:nav-active={page === 'settings'} onclick={() => navigate('settings')}><span class="nav-icon" aria-hidden="true"><Settings size={19} strokeWidth={1.75} /></span><span>Settings</span></button>
      <button aria-label="Help & shortcuts" title={primaryCollapsed ? 'Help & shortcuts' : undefined} class:nav-active={page === 'help'} onclick={() => navigate('help')}><span class="nav-icon" aria-hidden="true"><CircleHelp size={19} strokeWidth={1.75} /></span><span>Help & shortcuts</span></button>
      <button aria-label={primaryCollapsed ? 'Expand primary sidebar' : 'Collapse primary sidebar'} title={primaryCollapsed ? 'Expand primary sidebar' : 'Collapse primary sidebar'} onclick={() => primaryCollapsed = !primaryCollapsed}><span class="nav-icon" aria-hidden="true">{#if primaryCollapsed}<PanelLeftOpen size={19} strokeWidth={1.75} />{:else}<PanelLeftClose size={19} strokeWidth={1.75} />{/if}</span><span>Collapse sidebar</span></button>
    </div>
    {#if !primaryCollapsed}{#key workspaceId}<SidebarResizer label="Primary sidebar width" value={primaryWidth} min={180} max={300} onresize={value => primaryWidth = value} oncommit={value => writePreference(`primary-width:${workspaceId}`, String(value))} />{/key}{/if}
  </aside>

  {#if hasContext && !sidebarCollapsed}
    <aside class="context-sidebar" style:--context-width={`${sidebarWidth}px`} aria-label="Context and records">
      <div class="context-heading"><h2>{label}</h2><button class="icon-button" aria-label="Collapse contextual sidebar" title="Collapse contextual sidebar" onclick={() => sidebarCollapsed = true}><PanelLeftClose size={18} aria-hidden="true" /></button></div>
      {#if page === 'tasks'}
        <p class="context-description">Track work, plan deadlines, and decide what to do next.</p>
        <div class="context-views" aria-label={`${label} views`}>
          {#each availableViews as view}
            <button class="context-tab" class:active={taskView === view.id} aria-pressed={taskView === view.id} onclick={() => chooseView(view.id)}><view.icon size={17} aria-hidden="true" />{view.label}</button>
          {/each}
        </div>
        <div class="context-summary"><span>{domainRecords.length} total items</span><span>{domainRecords.filter(record => record.fields.status === 'In Progress').length} in progress</span></div>
        <button class="primary new-context" disabled={!workspace || saving || changing} onclick={() => newRecord('', { panel: taskView !== 'list' })}><Plus size={16} aria-hidden="true" />New task</button>
      {:else if page === 'settings'}
        {#each ['application', 'workspaces', 'agents'] as tab}<button class="context-tab" class:active={settingsTab === tab} onclick={() => chooseSettings(tab)}>{tab[0].toUpperCase() + tab.slice(1)}</button>{/each}
      {:else}
        <div class="context-group-scroll">{@render sectionGroups()}</div>
      {/if}
      {#key workspaceId}<SidebarResizer label="Contextual sidebar width" value={sidebarWidth} min={220} max={420} onresize={value => sidebarWidth = value} oncommit={value => writePreference(`context-width:${workspaceId}`, String(value))} />{/key}
    </aside>
  {/if}

  <main>
    <header class="main-header">
      <div class="breadcrumbs">
        {#if isWeb}<select class="compact-workspace" aria-label="Switch workspace" value={workspaceId} onchange={event => { const target = event.currentTarget.value; event.currentTarget.value = workspaceId; guard(() => loadWorkspace(target)); }}>{#if !workspaces.length}<option value="">No workspace</option>{/if}{#each workspaces as item}<option value={item.id}>{item.name}</option>{/each}</select>{/if}
        {#if hasContext && sidebarCollapsed}<button class="icon-button context-expand" aria-label="Expand contextual sidebar" title="Expand contextual sidebar" onclick={() => sidebarCollapsed = false}><PanelLeftOpen size={18} aria-hidden="true" /></button>{/if}
        <span>{workspace?.name ?? 'Welcome'}</span><ChevronRight class="crumb-divider" size={14} aria-hidden="true" /><button class="breadcrumb-button" onclick={() => draft ? closeEditor() : navigate(page)}>{label}</button>{#if draft && !editorPanel}<ChevronRight class="crumb-divider" size={14} aria-hidden="true" /><strong>{selectedId ? 'Edit' : 'New'} {itemName}</strong>{/if}
      </div>
      <div class="header-actions">
        {#if draft && !editorPanel}{@render editorActions()}
        {:else if canCreate && page !== 'journal'}<button class="primary" disabled={!workspace || loading || saving || changing} onclick={() => newRecord('', { panel: page === 'tasks' && taskView !== 'list' })}><Plus size={16} aria-hidden="true" />New item</button>{/if}
      </div>
    </header>
    {#if !editorPanel}{@render banners()}{/if}

    <div class="main-scroll">
      {#if loading}<div class="empty-state"><span class="loading-ring"></span><h1>Opening your workspace</h1><p>Reading local records...</p></div>
      {:else if page === 'help'}
        <section class="page-content readable"><h1>A small guide to CatPilot</h1><p class="lead">Local-first tools for your work, knowledge, and growth.</p>
          <article class="card"><h2>One workspace, many perspectives</h2>{#if isWeb}<p>Create a private SQLite workspace in this browser, or choose a Markdown folder in Chrome. Markdown documents live in that folder's CatPilot directory. Clearing site data can remove browser workspaces, so keep external backups. Installing does not synchronize devices.</p>{:else}<p>Create a SQLite or Markdown workspace. CatPilot stores its new schema under <code>&lt;location&gt;/CatPilot</code>. Existing legacy Markdown vaults are not automatically imported.</p>{/if}<p>Use a full-fidelity CatPilot backup to move records between backends. Imports require an empty target workspace.</p></article>
          <article class="card"><h2>Writing, without surprises</h2><p>Start writing directly. Type / in an empty paragraph for headings, checklists and tables. Use Markdown source for HTML, wiki links, plugin syntax, or exact formatting. Preview is sanitized and raw frontmatter stays intact.</p><p>New items require a title and an explicit Create action. After creation, valid edits autosave after one second of inactivity. Save immediately with <kbd>Ctrl / Cmd + S</kbd>. Content, Properties, Activity and AI assistant tabs keep each task focused. Recovery drafts are kept locally for each workspace and document. Errors require Retry save; conflicts require Reload. Closing a window with changes is prevented; save or discard before closing.</p></article>
          <article class="card"><h2>AI is opt-in</h2>{#if isWeb}<p>AI assistance requires the desktop app. This browser version has no AI server and does not send documents to an AI service.</p>{:else}<p>Draft requests send your prompt and the selected document's title and body. Structured edit requests also send the selected saved record's metadata. Nothing is saved until you explicitly approve it. Provider access requires your configured Copilot authentication.</p>{/if}</article>
        </section>
      {:else if page === 'settings'}
        <section class="page-content readable"><h1>Settings</h1>
          <div class="tabs mobile-settings" role="tablist" aria-label="Settings sections">{#each ['application', 'workspaces', 'agents'] as tab}<button role="tab" aria-selected={settingsTab === tab} tabindex={settingsTab === tab ? 0 : -1} class:active={settingsTab === tab} onclick={() => chooseSettings(tab)} onkeydown={event => tabKeys(event, ['application', 'workspaces', 'agents'], settingsTab, chooseSettings)}>{tab[0].toUpperCase() + tab.slice(1)}</button>{/each}</div>
          {#if settingsTab === 'application'}
            <article class="card"><h2>Appearance</h2><p class="subtle">A comfortable canvas, day or night.</p><label>Theme<select bind:value={theme}><option value="light">Light</option><option value="dark">Dark</option><option value="system">Match system</option></select></label><label class="checkbox-label"><input type="checkbox" bind:checked={sidebarCollapsed} />Collapse contextual sidebar</label></article>
            <article class="card"><h2>Local-first by design</h2><p>Each window keeps its active workspace; the last successfully opened workspace is remembered for this {isWeb ? 'browser' : 'desktop'} profile. Appearance and recovery drafts are stored locally. This does not change CLI or MCP workspace selection. No analytics or remote imagery are needed by this renderer.</p></article>
          {:else if settingsTab === 'workspaces'}
            <article class="card"><div class="section-heading"><h2>Current workspace</h2><button onclick={() => openModal('create')}><Plus size={16} aria-hidden="true" />Create workspace</button></div>
              {#if workspace}<p class="backend-pill">{workspace.backend === 'sqlite' ? 'SQLite' : 'Markdown'}</p><p class="location">{workspace.location}</p><p class="subtle small">{isWeb && workspace.backend === 'sqlite' ? 'The SQLite database is private to this browser and device. Export backups before clearing site data or changing devices.' : "CatPilot's new schema lives under this location's CatPilot directory. Legacy vaults are not auto-imported."}</p>
                {#if isWeb && workspace.backend === 'markdown'}<button disabled={changing || loading} onclick={() => attempt(async () => {
                  const granted = window.catpilot.restoreWorkspaceAccess
                    ? await window.catpilot.restoreWorkspaceAccess(workspaceId)
                    : !!await window.catpilot.chooseDirectory();
                  if (!granted) throw new Error('Folder access was not granted. Allow read and write access to reconnect this workspace.');
                  await loadWorkspace(workspaceId);
                })}>Reconnect Markdown folder</button>{/if}
                <form onsubmit={event => { event.preventDefault(); attempt(renameWorkspace); }}><label for="rename">Workspace name</label><div class="inline-form"><input id="rename" maxlength="80" required bind:value={rename} /><button disabled={changing || !rename.trim()}>Rename</button></div></form>
                <div class="button-row"><button class="danger-quiet" disabled={changing} onclick={() => openModal('unregister')}>Unregister workspace</button></div><p class="subtle small">Unregister removes it from the switcher; it never deletes files.</p>
              {:else}<p>No workspace selected. Create one to get started.</p>{/if}
            </article>
            {#if workspace}<article class="card"><h2>Backup & restore</h2><p>Export every record, its Markdown, IDs, timestamps, fields, revisions, and portable assets. Import into an empty workspace only.</p><div class="button-row"><button disabled={changing} onclick={() => attempt(async () => { const ws = workspaceId; const exported = await window.catpilot.exportBackup(ws); if (ws === workspaceId) notice = exported ? 'Backup exported.' : 'Export canceled.'; })}>Export full backup</button><button disabled={changing || !!storedRecords.length} onclick={() => attempt(() => previewImport('backup'))}>Preview import</button></div>{#if storedRecords.length}<p class="editor-notice">Import is disabled because this workspace is not empty. Create an empty target first.</p>{/if}</article>
              {#if !isWeb}<article class="card"><h2>Import an existing legacy vault</h2><p>Choose an empty destination workspace first, then select your legacy Markdown folder using the native picker. Review record/asset counts and warnings before approving. Original source files remain untouched.</p><button disabled={changing || !!storedRecords.length} onclick={() => attempt(() => previewImport('legacy'))}>Import legacy Markdown vault</button>{#if storedRecords.length}<p class="editor-notice">This destination has records. Create or select an empty workspace before previewing a legacy import.</p>{/if}</article>{/if}
            {/if}
          {:else if isWeb}
            <article class="card"><h2>AI requires the desktop app</h2><p>The Copilot SDK runs outside the browser. This offline PWA does not include an AI server, cannot use desktop GitHub credentials, and does not send documents to an external service.</p><p>Use the desktop app for AI assistance. Full workspace backups let you transfer documents between versions.</p></article>
          {:else}
            <article class="card ai-service"><h2><Sparkles size={20} aria-hidden="true" />AI assistance</h2><p>Connect once, choose a model, and request help from any document. Your content is sent only when you request AI assistance.</p><button disabled={aiControlsBusy} onclick={() => attempt(enableAI)}>{aiEnabled ? 'Turn off AI' : 'Enable AI for this window'}</button></article>
            <article class="card" aria-label="GitHub authentication">
              <div class="section-heading"><h2><KeyRound size={20} aria-hidden="true" />GitHub connection</h2><span class="connection-badge" class:connected={aiStatus?.authenticated}>{aiStatus?.authenticated ? 'Connected' : aiDeviceStep ? 'Awaiting authorization' : aiOperation === 'status' ? 'Checking...' : 'Not connected'}</span></div>
              <p>{aiStatus?.authenticated ? aiStatus.message : 'Sign in to discover AI models. After browser authorization, CatPilot updates this screen automatically.'}</p>
              <div class="button-row">
                {#if !aiStatus?.authenticated && !aiDeviceStep}<button class="primary" disabled={aiControlsBusy} onclick={() => attempt(() => signIn(true))}><KeyRound size={17} aria-hidden="true" />Sign in with GitHub</button>{/if}
                {#if !aiDeviceStep}<button disabled={aiControlsBusy} onclick={() => attempt(testAIConnection)}>{aiOperation === 'status' ? 'Checking connection...' : 'Refresh connection'}</button>{/if}
              </div>
              {#if aiLogin}
                <div class="device-authorization">
                <p role="status">{aiLogin.message}</p>
                {#if aiLogin.code}<span class="device-code-label">Your one-time device code</span><div class="device-code-row"><output class="device-code" aria-label="GitHub device code">{aiLogin.code}</output><button onclick={() => attempt(copyDeviceCode)}><Copy size={16} aria-hidden="true" />Copy code</button></div><p class="small" role="status">{aiCodeMessage}</p>{/if}
                {#if aiLoginUrl}
                  <button class="primary" disabled={aiControlsBusy && aiOperation !== 'login-finish'} onclick={() => attempt(() => window.catpilot.openExternal(aiLoginUrl))}>Open GitHub authorization <ArrowUpRight size={16} aria-hidden="true" /></button>
                {:else if aiLogin.url}<p class="error" role="alert">The provider returned an invalid or non-HTTPS authorization link. It has not been opened.</p>{/if}
                <p class="small subtle">Waiting for your browser. You do not need to finish sign-in or test the connection here.</p>
                </div>
              {/if}
              {#if aiControlsBusy}
                <p role="status">{aiOperation === 'login-start' ? 'Starting device sign-in...' : aiOperation === 'login-finish' ? 'Waiting for GitHub device authorization...' : aiOperation === 'status' ? 'Checking GitHub connection...' : aiOperation === 'models' ? 'Loading available models...' : aiOperation === 'cancel' ? 'Canceling AI operation...' : 'Waiting for the complete AI draft...'}</p>
              {/if}
              {#if aiControlsBusy || aiDeviceStep}<div class="button-row"><button disabled={aiOperation === 'cancel'} onclick={() => attempt(cancelAI)}>Cancel AI operation</button></div>{/if}
              <p class="small subtle">GitHub credentials stay in the SDK's secure storage. CatPilot never asks you to paste a token.</p>
            </article>
            <article class="card"><h2>Model preference</h2>{@render aiModelControls()}</article>
            <article class="card"><h2>Other providers</h2><p class="subtle">Claude and Gemini integrations are planned; they are not available in this release.</p></article>
          {/if}
        </section>
      {:else if !workspace}
        <section class="empty-state welcome"><img src={logo} alt="CatPilot" width="128" height="128" /><h1>Make yourself at home.</h1><p>Your tasks, thoughts, and next big thing.<br />Start with a workspace that's entirely yours.</p><button class="primary" onclick={() => openModal('create')}>Create your workspace</button><p class="small subtle">SQLite by default. Markdown if you prefer.</p></section>
      {:else if draft && !editorPanel}{@render documentEditor()}
      {:else}{@render collection()}{/if}
    </div>
    {#if draft && editorPanel}
      <dialog class="editor-panel" bind:this={editorDialog} aria-labelledby="editor-panel-title" oncancel={event => {
        event.preventDefault();
        if (!modal) closeEditor();
      }}>
        <div class="editor-panel-layout" inert={!!modal}>
          <header class="editor-panel-header">
            <div class="section-heading"><h2 id="editor-panel-title">{selectedId ? 'Edit' : 'New'} {itemName}</h2><button class="icon-button" aria-label="Close item" title="Close item" disabled={saving || changing} onclick={closeEditor}><X size={20} aria-hidden="true" /></button></div>
            <div class="header-actions">{@render editorActions()}</div>
          </header>
          {@render banners()}
          <div class="editor-panel-scroll">{@render documentEditor()}</div>
        </div>
        {@render confirmation()}
      </dialog>
    {/if}
  </main>
</div>
{#if !editorPanel}{@render confirmation()}{/if}

{#snippet banners()}
  {#if error}<div class="banner error" role="alert"><span>{error}</span><button aria-label="Dismiss error" onclick={() => error = ''}><X size={16} aria-hidden="true" /></button></div>{/if}
  {#if notice}<div class="banner notice" role="status"><span>{notice}</span><button aria-label="Dismiss notification" onclick={() => notice = ''}><X size={16} aria-hidden="true" /></button></div>{/if}
  {#if externalChange}<div class="banner warning" role="status"><span>The workspace changed outside this editor. Your draft has not been overwritten.</span><button onclick={() => attempt(reload)}>Reload latest</button></div>{/if}
{/snippet}

{#snippet editorActions()}
  <span class="save-state" class:save-problem={!!saveError || externalChange || (!!draft && !draftValid)} role="status" aria-label="Document save status">{saveError ? 'Save error' : externalChange ? 'Conflict: reload required' : saving ? 'Saving...' : !selectedId ? 'Not yet created' : dirty ? draftValid ? 'Autosave pending' : 'Unsaved: fix the fields below' : 'Saved locally'}</span>
  {#if saveError}<button disabled={saving || changing || externalChange || !draftValid} onclick={() => void save()}>Retry save</button>{/if}
  {#if selectedId && draft?.domain === 'tasks'}<button disabled={saving || changing || externalChange} onclick={() => { if (selectedId) focusOnTask(selectedId); }}><Timer size={15} aria-hidden="true" />Focus on this task</button>{/if}
  <button disabled={saving || changing} onclick={() => openModal('remove')} class="danger-quiet">{selectedId ? 'Delete' : 'Discard'}</button><button class="primary" disabled={saving || changing || externalChange || (!dirty && !!selectedId)} onclick={() => void save()}>{#if selectedId}Save <kbd>Ctrl S</kbd>{:else}Create {itemName}{/if}</button>
{/snippet}

{#snippet documentEditor()}
  {#if draft}
        <section class="document-page">
          {#if recovery}<div class="banner warning"><span>A recovery draft is available. The saved record is still untouched.</span><button onclick={() => {
            if (recovery) {
              draft = structuredClone($state.snapshot(recovery));
              if (selectedId && recoveryRevision !== baseRevision) {
                externalChange = true;
                baseRevision = recoveryRevision || 'unknown-recovery-revision';
              }
              selectionGeneration++;
            }
            recovery = null;
          }}>Recover draft</button><button onclick={() => { clearRecovery(); recovery = null; }}>Dismiss</button></div>{/if}
          {#if !editorPanel}<div class="document-navigation"><button class="text-button" onclick={closeEditor}><ArrowLeft size={17} aria-hidden="true" />Back to {label.toLowerCase()}</button><span class="backend-pill">{selectedId ? 'Autosave on' : 'New draft'}</span></div>{/if}
          <fieldset disabled={changing} class="document-fields">
            <label class="title-label" for="document-title">{itemName[0].toUpperCase() + itemName.slice(1)} title <span>{draft.domain === 'journal' ? 'Defaults to the entry date' : 'Required'}</span></label>
            <input id="document-title" class="title-input" aria-label="Document title" aria-invalid={!draft.title.trim()} aria-describedby="draft-guidance" required maxlength="500" placeholder={`Name this ${itemName}...`} bind:value={draft.title} />
            {#if draft.domain === 'journal'}<label class="journal-date-field">Entry date<input type="date" aria-label="Entry date" value={journalDay({ fields: draft.fields, created: selectedRecord?.created ?? new Date(now).toISOString() })} oninput={event => renameJournalDate(event.currentTarget.value)} /></label>{/if}
            <p id="draft-guidance" class="form-guidance">{selectedId ? 'Changes save automatically after a short pause. Use Save or Ctrl / Cmd + S to save now.' : draft.domain === 'journal' ? 'Write your reflection, then choose Create entry to save it under this date.' : `Only a title is required. Add content now or later, then choose Create ${itemName}. Nothing is created until you do.`}</p>
            {#if draftErrors.length}<div class="validation-summary" role="status"><strong>{!draft.title.trim() ? 'Add a title to continue' : 'Check these fields'}</strong><ul>{#each draftErrors as issue}<li>{issue}</li>{/each}</ul></div>{/if}
          </fieldset>
          <div class="document-tabs tabs" role="tablist" aria-label="Item sections">
            {#each documentTabs as tab}
              <button id={`item-tab-${tab}`} role="tab" aria-selected={documentTab === tab} aria-controls={`item-panel-${tab}`} tabindex={documentTab === tab ? 0 : -1} class:active={documentTab === tab} onclick={() => documentTab = tab} onkeydown={event => tabKeys(event, documentTabs, documentTab, value => documentTab = value)}>
                {#if tab === 'content'}<FileText size={16} aria-hidden="true" />Content{:else if tab === 'properties'}<SlidersHorizontal size={16} aria-hidden="true" />Properties{:else if tab === 'activity'}<History size={16} aria-hidden="true" />Activity{:else}<Sparkles size={16} aria-hidden="true" />AI assistant{/if}
              </button>
            {/each}
          </div>
          <div id="item-panel-properties" role="tabpanel" aria-labelledby="item-tab-properties" hidden={documentTab !== 'properties'}>
          <fieldset disabled={changing} class="document-properties">
            <h2>Properties</h2><p class="subtle small">Optional details to organize this {itemName}.</p>
            <div class="metadata-grid">
              {#if ['tasks', 'projects', 'milestones', 'learning', 'achievements', 'pomodoro'].includes(draft.domain)}<label>Status<StatusSelect value={draft.fields.status} label="Status" disabled={draft.domain === 'pomodoro'} onchange={value => { if (draft) draft.fields.status = value; }} /></label>{/if}
              {#if draft.domain === 'tasks'}<label>Priority<select bind:value={draft.fields.priority}>{#each Object.entries(priorityNames) as [priority, name]}<option value={priority}>{priority} - {name}</option>{/each}</select></label>{/if}
              {#if ['tasks', 'milestones', 'projects', 'learning'].includes(draft.domain)}<label>{draft.domain === 'milestones' ? 'Target date' : 'Due date'}<input type="date" bind:value={draft.fields.due} /></label>{/if}
              {#if !isConcept(draft.domain) && !['pomodoro', 'projects', 'achievements'].includes(draft.domain)}<label>Folder<input maxlength="200" bind:value={draft.fields.folder} /></label>{/if}
              <label class="wide">Tags<input aria-label="Comma separated tags" value={draft.fields.tags.join(', ')} onchange={event => { if (draft) draft.fields.tags = event.currentTarget.value.split(',').map(t => t.trim()).filter(Boolean); }} placeholder="Separate with commas" /></label>
              {#if ['tasks', 'milestones', 'learning', 'growth'].includes(draft.domain)}
                <label>Project<select bind:value={draft.fields.project}><option value="">None</option>{#if draft.fields.project && !records.some(r => r.domain === 'projects' && r.id === draft?.fields.project)}<option value={draft.fields.project}>{draft.fields.project} (existing link)</option>{/if}{#each records.filter(r => r.domain === 'projects') as project}<option value={project.id}>{project.title}</option>{/each}</select></label>
              {/if}
              {#if ['tasks', 'projects', 'milestones', 'learning', 'growth'].includes(draft.domain)}
                {@const parents = records.filter(r => r.id !== selectedId && (draft?.domain === 'milestones' ? r.domain === 'learning' : ['projects', 'learning', draft?.domain].includes(r.domain)))}
                <label>{draft.domain === 'milestones' ? 'Learning path' : 'Parent'}<select bind:value={draft.fields.parent}><option value="">None</option>{#if draft.fields.parent && !parents.some(r => r.id === draft?.fields.parent)}<option value={draft.fields.parent}>{records.find(r => r.id === draft?.fields.parent)?.title || draft.fields.parent} (existing link)</option>{/if}{#each parents as parent}<option value={parent.id}>{parent.title}</option>{/each}</select></label>
              {/if}
            </div>
            <TagList tags={draft.fields.tags} limit={12} />
            {#if draft.domain === 'learning' || draft.domain === 'projects' || draft.domain === 'tasks'}
            <details class="additional-fields" open={draft.domain === 'learning' || draft.domain === 'projects'}><summary>{draft.domain === 'tasks' ? 'Task clarity & Matrix overrides' : 'Goal and progress'}</summary>
            {#if readiness}<p class="form-guidance">Optional SMART guidance: {readiness.score} of {readiness.max} criteria met. {readiness.missing[0]?.question ?? 'This task has a clear outcome and plan.'} Clarity does not set urgency or block saving.</p>{/if}
            <div class="metadata-grid">
              <label class="wide">Goal<input bind:value={draft.fields.goal} /></label>{#if draft.domain === 'tasks'}<label class="wide">Measure<input bind:value={draft.fields.measure} /></label>{/if}
              <div class="wide rich-field"><span class="field-label">Steps</span><MarkdownEditor value={draft.fields.steps} {workspaceId} label="Steps" sourceLabel="Steps Markdown" compact attachments={false} disabled={changing} onchange={value => { if (draft && !changing) draft.fields.steps = value; }} onsave={() => void save()} /></div>
              {#if draft.domain === 'tasks'}
              <div class="wide rich-field"><span class="field-label">Why</span><MarkdownEditor value={draft.fields.why} {workspaceId} label="Why" sourceLabel="Why Markdown" compact attachments={false} disabled={changing} onchange={value => { if (draft && !changing) draft.fields.why = value; }} onsave={() => void save()} /></div>
              <label>Importance<select bind:value={draft.fields.importance}><option value="">Not set</option><option>High</option><option>Low</option></select></label>
              <label>Urgency<select bind:value={draft.fields.urgency}><option value="">Not set</option><option>High</option><option>Low</option></select></label>
              {/if}
              <label>Progress (%)<input type="number" min="0" max="100" step="1" bind:value={draft.fields.progress} /></label>
            </div></details>
            {/if}
            {#if draft.domain === 'growth' || draft.domain === 'achievements'}<label>Period<input bind:value={draft.fields.period} placeholder="e.g. 2026-Q4" /></label>{/if}
          </fieldset>
          </div>
          <div id="item-panel-content" role="tabpanel" aria-labelledby="item-tab-content" hidden={documentTab !== 'content'}>
          {#if isConcept(draft.domain)}
            <label class="concept-folder-field">Folder<select disabled={changing} bind:value={draft.fields.folder}><option value="">Unfiled</option>
              {#if draft.fields.folder && !conceptPaths.includes(draft.fields.folder)}<option value={draft.fields.folder}>{draft.fields.folder} (previous folder)</option>{/if}
              {#each conceptPaths as path (path)}<option value={path}>{path}</option>{/each}</select></label>
          {/if}
          <div class="document-summary">{#if isConcept(draft.domain)}<span class="kind-badge" data-tone={conceptPalette[draft.domain]}>{kindNames[draft.domain]}</span>{/if}{#if draft.domain === 'tasks'}<PriorityBadge value={draft.fields.priority} />{/if}{#if ['tasks', 'projects', 'learning', 'milestones', 'achievements'].includes(draft.domain)}<span>{draft.fields.status}</span>{/if}{#if draft.fields.due && draft.domain !== 'journal'}<span>Due {draft.fields.due}</span>{/if}<TagList tags={draft.fields.tags} /><button class="text-button" onclick={() => documentTab = 'properties'}>Edit properties</button></div>
          {#if contentLabel}<p class="field-label">{contentLabel}</p>{/if}
          {#if draft.domain === 'pomodoro'}
            {@const linkedTasks = focusTaskIds(draft.fields)}
            {#if typeof draft.fields.focusPurpose === 'string' && draft.fields.focusPurpose}<p class="focus-purpose"><strong>Purpose:</strong> {draft.fields.focusPurpose}</p>{/if}
            {#if linkedTasks.length}<ul class="focus-scope-list" aria-label="Session tasks">{#each linkedTasks as id (id)}<li><ListTodo size={16} aria-hidden="true" />{taskNames.get(id) ?? 'Task no longer available'}</li>{/each}</ul>{/if}
          {/if}
          {#key `${workspaceId}:${selectionGeneration}`}
            <MarkdownEditor value={draft.body} {workspaceId} onchange={body => { if (draft && !changing) draft.body = body; }} onsave={() => void save()} disabled={changing} />
          {/key}
          </div>
          <div id="item-panel-activity" role="tabpanel" aria-labelledby="item-tab-activity" hidden={documentTab !== 'activity'}>
          <h2>Activity & related items</h2>
          {#if selectedId && ['projects', 'learning'].includes(draft.domain)}
            <article class="children-panel"><div class="section-heading"><h2>Child items ({children.length})</h2><button onclick={() => newRecord(selectedId ?? '', { domain: draft?.domain === 'learning' ? 'milestones' : 'tasks', panel: editorPanel })}><Plus size={16} aria-hidden="true" />Add linked {draft.domain === 'learning' ? 'milestone' : 'task'}</button></div>{#each childRecords as child}<button class="overview-item" onclick={() => selectRecord(child, editorPanel)}><span>{child.title}</span><span class="subtle">{child.fields.status} / {child.fields.progress}%</span></button>{/each}<Pagination label="Child items" total={children.length} page={childPage} onchange={value => childPage = value} /></article>
          {/if}
          {#if selectedRecord && ['tasks', 'projects', 'learning', 'milestones', 'growth'].includes(draft.domain)}
            {#key `${workspaceId}:${selectedId}`}<ManagementPanel {workspaceId} record={selectedRecord} disabled={dirty || saving || changing || externalChange} hasChildren={!!children.length} onbusy={managementBusy} onupdate={managementUpdated} onerror={message => error = message} />{/key}
          {:else if !selectedId}<p class="editor-notice">Create this item first to add comments, logs or completion details.</p>{/if}
          </div>
          <div id="item-panel-ai" role="tabpanel" aria-labelledby="item-tab-ai" hidden={documentTab !== 'ai'}>
          <section class="ai-panel" aria-label="AI drafting">
            {#if isWeb}<h2>AI assistance on desktop</h2><p>The PWA keeps your data on this device. The native Copilot SDK requires a trusted server or the desktop app; this browser version does not connect to AI or send your content anywhere.</p>
            {:else}
            <div class="section-heading"><div><h2><Sparkles size={20} aria-hidden="true" />Write with AI</h2></div><button onclick={() => attempt(enableAI)} disabled={aiControlsBusy}>{aiEnabled ? 'Turn off AI' : 'Enable AI'}</button></div>
            {#if aiEnabled}
              <p class="subtle small">{aiStatus?.message ?? 'Use Test connection to check provider availability.'} Drafts send this document's title and body with your prompt. Structured edits also send the selected saved record's metadata, and require separate approval before saving.</p>
              <div class="button-row"><button disabled={aiControlsBusy} onclick={() => attempt(testAIConnection)}>Test connection</button>{#if !aiStatus?.authenticated}<button disabled={aiControlsBusy} onclick={() => { settingsTab = 'agents'; navigate('settings'); }}>Open sign-in settings</button>{/if}</div>
              {@render aiModelControls()}
              <div class="rich-field"><span class="field-label">Your instruction</span><MarkdownEditor value={aiPrompt} {workspaceId} label="Your instruction" sourceLabel="Your instruction Markdown" maxLength={10_000} compact attachments={false} disabled={aiControlsBusy} onchange={value => aiPrompt = value} /></div>
              <div class="button-row">
                <button class="primary" disabled={aiControlsBusy || !aiPrompt.trim() || aiPrompt.length > 10_000 || !aiStatus?.authenticated || aiModelUnavailable} onclick={() => attempt(generateAI)}>Request draft</button>
                <button disabled={aiControlsBusy || !selectedRecord || dirty || externalChange || saving || changing || !aiPrompt.trim() || aiPrompt.length > 10_000 || !aiStatus?.authenticated || aiModelUnavailable || selectedRecord.revision !== baseRevision} onclick={() => attempt(proposeAI)}>Propose structured edit</button>
                {#if aiControlsBusy}<span role="status">{aiOperation === 'propose' ? 'AI is proposing changes to this saved record. Nothing is applied automatically.' : aiOperation === 'apply' ? 'Saving the approved AI edit...' : aiBusy ? 'AI is drafting. Partial text is read-only until the request finishes.' : aiOperation === 'cancel' ? 'Canceling...' : aiOperation === 'models' ? 'Loading models...' : 'Checking connection...'}</span><button disabled={aiOperation === 'cancel' || aiOperation === 'apply'} onclick={() => attempt(cancelAI)}>Cancel</button>{/if}
              </div>
              {#if !selectedRecord || dirty || externalChange}<p class="small subtle">Structured edits require a selected, saved record with no unsaved or external changes. Save or reload first.</p>{/if}
              {#if aiProposal}<AiProposalReview proposal={aiProposal} disabled={dirty || externalChange || saving || changing || aiControlsBusy} onapprove={() => attempt(applyAIProposal)} ondiscard={() => attempt(() => cancelAI(true))} />{/if}
              {#if aiDraft}<div class="rich-field"><span class="field-label">{aiDraftComplete ? 'Review AI draft' : 'Partial AI draft (not final)'}</span><MarkdownEditor value={aiDraft} {workspaceId} label="AI draft" sourceLabel="AI draft Markdown" readOnly /></div><p class="small subtle">{aiDraftComplete ? 'Applying replaces the Markdown content but preserves existing raw frontmatter. Review the result before saving.' : 'Partial output is never applied to your document. Only a successfully completed request can be applied.'}</p><div class="button-row"><button disabled={saving || changing || aiControlsBusy || !aiDraftComplete} onclick={() => { if (draft && aiDraftComplete) { const prefix = splitFrontmatter(draft.body).prefix; draft.body = prefix + (prefix ? splitFrontmatter(aiDraft).body : aiDraft); aiDraft = ''; aiDraftComplete = false; selectionGeneration++; documentTab = 'content'; } }}>Apply to editor</button><button disabled={aiBusy} onclick={() => { aiDraft = ''; aiDraftComplete = false; }}>Discard draft</button></div>{/if}
            {:else}<p class="subtle small">Off by default. Nothing is sent until you explicitly request a draft.</p>{/if}
            {/if}
          </section>
          </div>
        </section>
  {/if}
{/snippet}

{#snippet sectionGroups()}
  {#if page === 'concepts'}
    {#key workspaceId}<ConceptNavigation tree={conceptTree} folder={conceptFolder} kind={conceptKind} palette={conceptPalette}
      disabled={loading || saving || changing} onfolder={value => conceptFolder = value} onkind={value => conceptKind = value}
      oncreate={parent => openFolderDialog('create', parent)} onmanage={openFolderDialog}
      onmove={(path, parent) => attempt(() => changeFolder({ type: 'move', path, parent }))} />{/key}
  {:else}
    {@const group = page === 'journal' ? { label: 'Journal months', all: 'All entries', active: journalMonth, choices: journalMonths.map(value => ({ value, label: dateFromDay(`${value}-01`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) })), select: (value: string) => journalMonth = value }
      : page === 'projects' ? { label: 'Project status', all: 'All projects', active: filterStatus, choices: projectStatuses.map(value => ({ value, label: value })), select: (value: string) => filterStatus = value }
      : { label: 'Achievement years', all: 'All achievements', active: achievementPeriod, choices: achievementYears.map(value => ({ value, label: value })), select: (value: string) => achievementPeriod = value }}
    <div class="context-groups" role="group" aria-label={group.label}>
      <button class="folder-link" aria-pressed={!group.active} onclick={() => group.select('')}>{group.all}</button>
      {#each group.choices as choice (choice.value)}<button class="folder-link" aria-pressed={group.active === choice.value} onclick={() => group.select(choice.value)}>{choice.label}</button>{/each}
    </div>
  {/if}
{/snippet}

{#snippet compactGroups()}
  {#if hasContext}
    <details class="compact-context" class:context-collapsed={sidebarCollapsed}>
      <summary>{page === 'concepts' ? 'Folders and kinds' : page === 'journal' ? 'Browse by month' : page === 'projects' ? 'Browse by status' : 'Browse by year'}</summary>
      {@render sectionGroups()}
    </details>
  {/if}
{/snippet}

{#snippet collection()}
  {#if page === 'overview' && workspace}
        <section class="page-content">
          <div class="page-intro"><div><h1>Overview</h1><p class="lead">What needs attention in {workspace.name}.</p></div><span class="today">{new Date(now).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</span></div>
          <div class="stats-grid">{#each [{ title: 'Open tasks', value: activeTasks.length, target: 'tasks', tone: 'teal' }, { title: 'Overdue', value: overdue.length, target: 'tasks', tone: 'rose' }, { title: 'Active projects', value: activeProjects.length, target: 'projects', tone: 'blue' }, { title: 'Concepts', value: concepts.length, target: 'concepts', tone: 'violet' }] as stat}<button class="stat-card" data-tone={stat.tone} onclick={() => {
            navigate(stat.target as Page);
            if (stat.title === 'Overdue') { taskView = 'list'; filterOverdue = true; }
          }}><span>{stat.title}</span><strong>{stat.value}</strong><span class="stat-footer">Open section <ArrowUpRight size={13} aria-hidden="true" /></span></button>{/each}</div>
          <div class="overview-columns">
            {#each [{ title: 'Overdue', list: overdue, tone: 'rose', empty: 'Nothing overdue.' }, { title: 'Coming up', list: upcoming, tone: 'teal', empty: 'No upcoming deadlines.' }] as group}
              <article class="card overview-group" data-tone={group.tone}><h2>{group.title}</h2>{#each group.list.slice(0, 5) as task}<button class="overview-item" onclick={() => selectRecord(task, true)}><span class="overview-task"><PriorityBadge value={task.fields.priority} />{task.title}</span><time class="small" datetime={task.fields.due}>{task.fields.due}</time></button>{:else}<p class="subtle">{group.empty}</p>{/each}</article>
            {/each}
            <article class="card overview-group" data-tone="blue"><h2>Active projects</h2>{#each activeProjects.slice(0, 5) as record}<button class="overview-item" onclick={() => selectRecord(record, true)}><strong>{record.title}</strong><span class="small subtle">{record.fields.status}</span></button>{:else}<p class="subtle">No active projects.</p>{/each}</article>
            <article class="card overview-group" data-tone="violet"><h2>Recently touched</h2>{#each recent.slice(0, 5) as record}<button class="overview-item stacked" onclick={() => selectRecord(record, true)}><strong>{record.title}</strong><span class="small subtle">{kindNames[record.domain]} / {date(record.updated)}</span></button>{:else}<p class="subtle">Saved work will appear here.</p>{/each}</article>
          </div>
        </section>
      {:else if page === 'timeline' || page === 'journal'}
        {#key `${workspaceId}:${page}`}<WorkspaceHistory view={page} {records} {today} month={journalMonth} navigation={page === 'journal' ? compactGroups : undefined} disabled={changing || saving} onopen={record => selectRecord(record, true)} oncreate={day => newRecord('', { domain: 'journal', date: day, panel: true })} />{/key}
      {:else if page === 'concepts'}
        <section class="page-content">
          <div class="page-intro"><div><h1>Concepts</h1><p class="lead">Collect knowledge, milestones, learning, and growth in one place.</p></div></div>
          {@render compactGroups()}
          {#key workspaceId}<ConceptExplorer records={concepts} folder={conceptFolder} kind={conceptKind} palette={conceptPalette} disabled={changing || saving} oncolor={changeConceptColor} onopen={record => selectRecord(record, true)} oncreate={domain => newRecord('', { domain, panel: true })} />{/key}
        </section>
      {:else if page === 'pomodoro'}
        <section class="page-content focus-page">
          <div class="page-intro"><div><h1>Focus</h1><p class="lead">Make time for a task, a goal, or a break.</p></div></div>
          {#key workspaceId}<FocusPanel {workspaceId} {records} {tasks} seed={focusSeed} onseedused={() => focusSeed = ''} disabled={saving || changing || loading} onbusy={managementBusy} onupdate={managementUpdated} onerror={message => error = message} />{/key}
          <section aria-label="Session history">
            <div class="section-heading"><h2>Session history</h2><span class="small subtle">All time</span></div>
            <div class="focus-summary">
              <div data-tone="teal"><strong>{Math.round(focusStats.focusMinutes)}</strong><span>Focus minutes logged</span></div>
              <div data-tone="blue"><strong>{focusStats.completed}</strong><span>Completed sessions</span></div>
              <div data-tone="slate"><strong>{focusStats.cancelled}</strong><span>Cancelled sessions</span></div>
            </div>
            {#each focusSessions.slice(focusRange.start, focusRange.end) as session (session.id)}
              {@const links = focusTaskIds(session.fields)}
              <button class="overview-item focus-session" onclick={() => selectRecord(session, true)}><span class="focus-session-name"><strong>{session.title}</strong>{#if links.length}<span>{links.length === 1 ? taskNames.get(links[0]) ?? 'Task no longer available' : `${links.length} linked tasks`}</span>{/if}</span><span>{session.fields.timerState === 'cancelled' ? 'Cancelled' : 'Completed'} · {session.fields.type || 'Session'} · {typeof session.fields.elapsedSec === 'number' ? `${Math.round(session.fields.elapsedSec / 60)} min elapsed` : `${session.fields.minutes} min planned`} · {date(session.fields.completed || session.fields.started || session.created)}</span></button>
            {:else}<p class="subtle">Completed and cancelled sessions appear here.</p>{/each}
            <Pagination label="Focus sessions" total={focusSessions.length} page={contentPage} onchange={value => contentPage = value} />
          </section>
        </section>
      {:else if isCollection}
        <section class="page-content">
          <div class="page-intro"><div><h1>{label}</h1><p class="lead">{page === 'projects' ? 'Portfolio of goals, progress, and blockers.' : `${filtered.length} ${filtered.length === 1 ? 'item' : 'items'}${domainRecords.length !== filtered.length ? ` of ${domainRecords.length}` : ''}`}</p></div></div>
          {#if page === 'projects' || page === 'achievements'}{@render compactGroups()}{/if}
          {#if page === 'tasks' && (sidebarCollapsed || isWeb)}<div class="tabs" aria-label="Collection view">{#each availableViews as view}<button class:active={taskView === view.id} aria-pressed={taskView === view.id} onclick={() => chooseView(view.id)}><view.icon size={16} aria-hidden="true" />{view.label}</button>{/each}</div>{/if}
          <div class="collection-filters" aria-label="Collection filters">
            <label class="collection-search">Search<div class="search-box"><Search size={17} aria-hidden="true" /><input aria-label="Search current section" placeholder={`Search ${label.toLowerCase()}...`} bind:value={search} /></div></label>
            {#if page !== 'projects'}<label>Status<select aria-label="Filter by status" bind:value={filterStatus}><option value="">All statuses</option>{#each statuses as status}<option>{status}</option>{/each}</select></label>{/if}
            {#if page !== 'projects' && page !== 'achievements'}<label>Folder<select aria-label="Filter by folder" bind:value={filterFolder}><option value="">All folders</option>{#each folders as folder}<option>{folder}</option>{/each}</select></label>{/if}
            <label>Tag<select aria-label="Filter by tag" bind:value={filterTag}><option value="">All tags</option>{#each tags as tag}<option>{tag}</option>{/each}</select></label>
            {#if page === 'tasks'}<label class="overdue-filter"><input type="checkbox" bind:checked={filterOverdue} />Overdue only</label>{/if}
            {#if search || filterStatus || filterFolder || filterTag || filterOverdue || achievementPeriod}<button onclick={() => { search = ''; filterStatus = ''; filterFolder = ''; filterTag = ''; filterOverdue = false; achievementPeriod = ''; }}>Clear filters</button>{/if}
          </div>
          {#if page === 'reports'}{#key workspaceId}<ReportsPanel {workspaceId} onselect={selectRecord} oncreate={createReport} onerror={message => error = message} />{/key}{/if}
          {#if page === 'tasks' && (taskView === 'board' || taskView === 'calendar' || taskView === 'matrix')}
            {#key workspaceId}<TaskPlanning view={taskView} records={filtered} {today} disabled={saving || changing} onopen={record => selectRecord(record, true)} onmove={(record, status) => attempt(() => updateFields(record, { status }))} oncreate={day => newRecord('', { domain: 'tasks', date: day, panel: true })} />{/key}
          {:else}
            {#if !filtered.length}<div class="empty-state section-empty"><span class="empty-symbol" aria-hidden="true"><FolderOpen size={28} strokeWidth={1.5} /></span><h2>{domainRecords.length ? 'Nothing matches these filters.' : `No ${label.toLowerCase()} yet.`}</h2>{#if !domainRecords.length}<button class="primary" onclick={() => newRecord()}>Create your first item</button>{/if}</div>
            {:else if page === 'projects'}<ProjectPortfolio projects={contentRecords} {records} onopen={record => selectRecord(record, true)} />
            {:else}
              <div class="items-table"><div class="table-heading"><span>NAME</span><span>STATUS</span><span>PRIORITY</span><span>UPDATED</span></div>{#each contentRecords as record (record.id)}<div class="table-row"><div class="item-identity"><button class="item-name" onclick={() => selectRecord(record)}><span class="document-icon" aria-hidden="true">{#if record.domain === 'tasks'}<ListTodo size={18} />{:else}<FileText size={18} />{/if}</span><span>{record.title}</span></button><TagList tags={record.fields.tags} /></div><StatusSelect label={`Status for ${record.title}`} value={record.fields.status} disabled={changing || saving} onchange={value => attempt(() => updateFields(record, { status: value }))} /><PriorityBadge value={record.fields.priority} /><span class="small subtle">{date(record.updated)}</span></div>{/each}</div>
            {/if}
            <Pagination label="Content items" total={filtered.length} page={contentPage} onchange={value => contentPage = value} />
          {/if}
        </section>
      {/if}
{/snippet}

{#snippet confirmation()}
{#if modal}
  <div class="modal-backdrop" role="presentation">
    <div class="modal" bind:this={modalElement} role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1">
      {#if modal === 'create'}
        <form onsubmit={event => { event.preventDefault(); attempt(createWorkspace); }}>
          <h2 id="modal-title">Create a workspace</h2><p class="subtle">A home for your work, stored on your machine.</p>
          <fieldset disabled={changing}><label>Name<input required maxlength="80" bind:value={createName} placeholder="My workspace" /></label><label>Storage backend<select bind:value={createBackend}><option value="sqlite">SQLite - recommended</option><option value="markdown">Markdown - local files</option></select></label>
            {#if isWeb && createBackend === 'sqlite'}<p>SQLite is stored privately in this browser on this device. Export backups before clearing site data or changing devices. Installing the PWA does not synchronize data.</p>
            {:else}<label>Location<div class="inline-form"><input readonly value={createLocation} placeholder="Default application location" /><button type="button" onclick={() => attempt(async () => { const chosen = await window.catpilot.chooseDirectory(); if (chosen) createLocation = chosen; })}>Choose folder</button></div></label>
            <p class="small subtle">Data uses a new schema in &lt;location&gt;/CatPilot. Existing legacy Markdown files are not automatically imported.</p>{/if}
            <div class="modal-actions"><button type="button" onclick={closeModal}>Cancel</button><button class="primary" disabled={!createName.trim() || (createBackend === 'markdown' && !createLocation)}>{changing ? 'Creating...' : 'Create workspace'}</button></div>{#if createBackend === 'markdown' && !createLocation}<p class="small subtle">Choose a folder for a Markdown workspace.</p>{/if}
          </fieldset>
        </form>
      {:else if modal === 'folder'}
        <form class="folder-dialog-form" onsubmit={submitFolder} aria-busy={changing}>
          <h2 id="modal-title">{folderMode === 'create' ? folderTarget ? 'New subfolder' : 'New folder' : folderMode === 'move' ? 'Move folder' : 'Delete folder'}</h2>
          {#if folderMode === 'create'}
            <p class="subtle">Location: <strong>{folderTarget || 'Top level'}</strong></p>
            <label>Folder name<input required maxlength="200" placeholder="e.g. Research" bind:value={folderName} disabled={changing} /></label>
          {:else if folderMode === 'move'}
            <p class="subtle">Move <strong>{folderTarget}</strong> and everything inside it.</p>
            <label>Destination<select bind:value={folderDestination} disabled={changing}><option value="">Top level</option>
              {#each conceptPaths.filter(path => !inFolder(path, folderTarget)) as path (path)}<option value={path}>{path}</option>{/each}
            </select></label>
          {:else}
            <p>Remove <strong>{folderTarget}</strong>? It contains {affectedConcepts} {affectedConcepts === 1 ? 'concept' : 'concepts'} and {affectedSubfolders} {affectedSubfolders === 1 ? 'subfolder' : 'subfolders'}.</p>
            {#if affectedConcepts || affectedSubfolders}
              <fieldset disabled={changing} class="folder-delete-options">
                <legend>What should happen to the contents?</legend>
                <label><input type="radio" value="keep" bind:group={folderContents} /><span><strong>Keep contents</strong><small>Move subfolders up one level. Move concepts in this folder to {folderParent(folderTarget) ? `“${folderParent(folderTarget)}”` : 'Unfiled'}.</small></span></label>
                <label><input type="radio" value="delete" bind:group={folderContents} /><span><strong>Delete everything inside</strong><small>Permanently delete all concepts and subfolders in this folder.</small></span></label>
              </fieldset>
            {/if}
          {/if}
          <div class="modal-actions"><button type="button" disabled={changing} onclick={closeModal}>Cancel</button>
            <button type="submit" class:primary={folderMode !== 'delete'} class:danger={folderMode === 'delete'}
              disabled={changing || folderStale || (folderMode === 'create' && !folderName.trim()) || (folderMode === 'move' && folderDestination === folderParent(folderTarget))}>
              {changing ? 'Saving…' : folderMode === 'create' ? 'Create folder' : folderMode === 'move' ? 'Move folder' : folderContents === 'delete' ? 'Delete folder and contents' : 'Delete folder'}
            </button>
          </div>
        </form>
      {:else if modal === 'unsaved'}
        <h2 id="modal-title">Keep your changes?</h2><p>This document has unsaved edits. Save them before continuing, or explicitly discard this draft.</p>
        <div class="modal-actions"><button disabled={saving} onclick={closeModal}>Cancel</button><button class="danger-quiet" disabled={saving} onclick={() => attempt(() => resolveUnsaved(false))}>Discard changes</button><button class="primary" disabled={saving} onclick={() => attempt(() => resolveUnsaved(true))}>{saving ? 'Saving...' : 'Save & continue'}</button></div>
      {:else if modal === 'remove'}
        <h2 id="modal-title">{selectedId ? 'Delete this item?' : 'Discard this draft?'}</h2><p>{selectedId ? 'This removes the saved item and its recovery draft. This cannot be undone here.' : 'Your unsaved draft will be removed.'}</p>
        <div class="modal-actions"><button disabled={changing} onclick={closeModal}>Cancel</button><button class="danger" disabled={changing} onclick={() => attempt(async () => { if (selectedId) await removeRecord(); else { clearRecovery(); clearSelection(); closeModal(); } })}>{selectedId ? 'Delete item' : 'Discard draft'}</button></div>
      {:else if modal === 'unregister'}
        <h2 id="modal-title">Unregister {workspace?.name}?</h2><p>The workspace will leave your switcher. All files remain on disk. No workspace data is deleted.</p><div class="modal-actions"><button disabled={changing} onclick={closeModal}>Cancel</button><button class="danger" disabled={changing} onclick={() => attempt(unregisterWorkspace)}>Unregister only</button></div>
      {:else if modal === 'import'}
        <h2 id="modal-title">{importKind === 'legacy' ? 'Review legacy vault import' : 'Review backup import'}</h2><p>Import into <strong>{workspace?.name}</strong>. The target must be empty. Review record and asset counts below before explicitly approving.</p>{#if importKind === 'legacy'}<p>Legacy source files are read-only and remain untouched. Only the selected destination receives imported records and assets.</p>{/if}
        {#if importWarnings.length}<h3>Import warnings</h3><ul>{#each importWarnings as warning}<li>{warning}</li>{/each}</ul>{/if}
        <pre class="import-preview" aria-label="Import counts and summary">{JSON.stringify(importPreview, null, 2)}</pre>{#if error}<p class="small subtle">If approval failed, cancel and preview again before retrying.</p>{/if}<div class="modal-actions"><button disabled={changing} onclick={() => { importPreview = null; closeModal(); }}>Cancel</button><button class="primary" disabled={changing || !!storedRecords.length} onclick={() => attempt(approveImport)}>Approve & import</button></div>
      {/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
    </div>
  </div>
{/if}
{/snippet}

<svelte:document onclick={interceptLinks} />
