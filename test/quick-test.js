#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';

// Isolate all writes to a throwaway temp config so this smoke test never touches
// the real (Obsidian) vault. Must be set BEFORE importing the adapters, since
// config resolution reads these at call time. CATPILOT_CONFIG wins over all else.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'catpilot-quick-'));
fs.mkdirSync(path.join(tmpRoot, 'data'), { recursive: true });
const tmpConfigPath = path.join(tmpRoot, 'data', 'config.json');
fs.writeFileSync(
  tmpConfigPath,
  JSON.stringify({
    version: 1,
    storage: {
      root: 'data',
      partitioning: 'month',
      allowExternalPaths: true,
      files: {
        tasks: 'tasks.md', journal: 'journal.md', milestones: 'milestones.md',
        memos: 'memos', learning: 'learning', growth: 'growth', projects: 'projects',
        pomodoro: 'pomodoro.md'
      }
    },
    migration: { mode: 'move' }
  }, null, 2)
);
process.env.CATPILOT_CONFIG = tmpConfigPath;

const claudeTools = await import('../adapters/claude-code/tools.js');
const geminiTools = await import('../adapters/gemini-cli/tools.js');

(async () => {
  console.log('Testing Claude adapter...');
  try {
    const result = await claudeTools.list_tasks({ status: 'all' });
    console.log('Claude list_tasks:', result.success ? '✅ PASS' : '❌ FAIL', `(${result.data?.length || 0} tasks)`);
  } catch (e) {
    console.log('Claude list_tasks: ❌ ERROR', e.message);
  }

  console.log('\nTesting Gemini adapter...');
  try {
    const result = await geminiTools.catpilot_list_tasks({ status: 'all' });
    console.log('Gemini catpilot_list_tasks:', result.success ? '✅ PASS' : '❌ FAIL', `(${result.result?.tasks?.length || 0} tasks)`);
  } catch (e) {
    console.log('Gemini catpilot_list_tasks: ❌ ERROR', e.message);
  }

  console.log('\nTesting Pomodoro engine...');
  try {
    const started = await claudeTools.pomodoro_start({ type: 'focus', minutes: 25, force: true });
    const st = await claudeTools.pomodoro_status();
    const done = await claudeTools.pomodoro_complete({ notes: 'quick-test' });
    const ok = started.success && st.success && st.data?.remainingSec >= 0 && done.success && done.data?.status === 'completed';
    console.log('Claude pomodoro start→status→complete:', ok ? '✅ PASS' : '❌ FAIL');
  } catch (e) {
    console.log('Claude pomodoro cycle: ❌ ERROR', e.message);
  }

  console.log('\nTesting Pomodoro report...');
  try {
    const rep = await claudeTools.pomodoro_report({ period: 'all', groupBy: 'day' });
    const s = rep.data?.summary;
    const ok = rep.success && s && typeof s.completionRate === 'number' && Array.isArray(rep.data?.groups);
    console.log('Claude pomodoro_report (by day):', ok ? '✅ PASS' : '❌ FAIL', ok ? `(${s.totalSessions} sessions, ${rep.data.groups.length} group(s))` : '');
  } catch (e) {
    console.log('Claude pomodoro_report: ❌ ERROR', e.message);
  }

  console.log('\nAdapters loaded successfully!');

  // --- SMART + Eisenhower ------------------------------------------------
  console.log('\nTesting SMART round-trip and Eisenhower classification...');
  const eisen = await import('../lib/eisenhower.js');
  const cliUtils = await import('../lib/cli-utils.js');
  const checks = [];
  const check = (name, cond) => { checks.push(cond); console.log(`  ${cond ? '✅' : '❌'} ${name}`); };

  try {
    // Round-trip: SMART fields survive a full parse -> format -> parse cycle, and
    // a task with no SMART data must not emit a "## Task Details" section at all.
    const added = await claudeTools.add_task({
      title: 'Round-trip SMART task', due: '2099-06-01', priority: 'P2',
      goal: 'Ship the thing', measure: 'All tests green', why: 'Unblocks the release',
      steps: 'Design -> build -> verify', importance: 'High', urgency: 'Low'
    });
    check('add_task stores SMART fields', added.success && added.data.smart.goal === 'Ship the thing');
    check('explicit High/Low classifies as Q2', added.data.eisenhower.quadrant === 'q2');
    check('explicit axes are marked explicit', added.data.eisenhower.source === 'explicit');
    check('a fully filled task scores 5/5', added.data.smartScore.score === 5);

    const plain = await claudeTools.add_task({ title: 'Plain task, no SMART data' });
    const raw = fs.readFileSync(cliUtils.resolveFilePath('tasks', cliUtils.loadConfig()), 'utf8');
    check('SMART section is written', raw.includes('## Task Details') && raw.includes('- **Goal:** Ship the thing'));
    check('plain task writes no Task Details entry', !raw.includes(`### Task ${plain.data.id}\n- **Goal:`));
    check('Task Details precedes Task Log', !raw.includes('## Task Log') || raw.indexOf('## Task Details') < raw.indexOf('## Task Log'));

    const reparsed = cliUtils.parseTasksTable(raw);
    const rt = reparsed.find(t => t.id === added.data.id);
    check('SMART survives re-parse', rt && rt.smart.measure === 'All tests green' && rt.smart.urgency === 'Low');

    // Regression: the Completed-table header row must never be parsed as a task.
    // (parseTasksTable used to leak a phantom `{ id: 0 }` from the second table.)
    await claudeTools.complete_task({ id: plain.data.id });
    const afterDone = cliUtils.parseTasksTable(
      fs.readFileSync(cliUtils.resolveFilePath('tasks', cliUtils.loadConfig()), 'utf8'));
    check('no phantom task from the completed-table header', !afterDone.some(t => !t.id || t.title === 'Title'));
    check('SMART data survives another task completing', afterDone.find(t => t.id === added.data.id)?.smart.why === 'Unblocks the release');

    // Derivation rules, exercised directly against the shared core.
    const at = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };
    check('overdue + important -> Q1', eisen.classifyTask({ dueDate: at(-2), priority: 'P1' }).quadrant === 'q1');
    check('far away + P1 -> Q2', eisen.classifyTask({ dueDate: at(30), priority: 'P1' }).quadrant === 'q2');
    check('due tomorrow + P3 -> Q3', eisen.classifyTask({ dueDate: at(1), priority: 'P3' }).quadrant === 'q3');
    check('no date + P3 -> Q4', eisen.classifyTask({ priority: 'P3' }).quadrant === 'q4');
    check('a "why" makes a task important', eisen.classifyTask({ priority: 'P3', smart: { why: 'Feeds the roadmap' } }).quadrant === 'q2');
    check('derived classification is marked derived', eisen.classifyTask({ priority: 'P3' }).source === 'derived');
    check('explicit axes beat derivation', eisen.classifyTask({ dueDate: at(-5), priority: 'P0', smart: { importance: 'Low', urgency: 'Low' } }).quadrant === 'q4');
    check('title-only scores 0/5', eisen.smartScore({ title: 'x' }).score === 0);
    check('medium normalizes to High (binary axis)', eisen.normalizeAxis('medium') === 'High');
    check('"auto" normalizes to empty (derive it)', eisen.normalizeAxis('auto') === '');

    const matrix = await claudeTools.task_matrix({ status: 'all' });
    check('task_matrix returns four quadrants', matrix.success && matrix.data.quadrants.length === 4);
    check('task_matrix returns coaching insights', Array.isArray(matrix.data.insights.hints));
    const focus = await claudeTools.task_focus({ limit: 3 });
    check('task_focus ranks with reasons', focus.success && focus.data.focus.every(t => t.focusReason));

    const pinned = await claudeTools.set_task_smart({ id: added.data.id, urgency: 'High' });
    check('set_task_smart re-classifies to Q1', pinned.success && pinned.data.eisenhower.quadrant === 'q1');
    const cleared = await claudeTools.set_task_smart({ id: added.data.id, urgency: 'auto' });
    check('"auto" clears the axis and re-derives urgency', cleared.success && cleared.data.smart.urgency === '' && cleared.data.eisenhower.quadrant === 'q2');

    const q2Only = await claudeTools.list_tasks({ status: 'all', quadrant: 'q2' });
    check('list_tasks filters by quadrant', q2Only.success && q2Only.data.every(t => t.eisenhower.quadrant === 'q2'));
  } catch (e) {
    check(`SMART/Eisenhower suite threw: ${e.message}`, false);
  }

  const failed = checks.filter(c => !c).length;
  console.log(failed ? `\n❌ ${failed} SMART/Eisenhower check(s) failed.` : '\n✅ All SMART/Eisenhower checks passed.');

  // Clean up the throwaway temp workspace.
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  if (failed) process.exitCode = 1;
})();
