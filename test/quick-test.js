#!/usr/bin/env node
import * as claudeTools from '../adapters/claude-code/tools.js';
import * as geminiTools from '../adapters/gemini-cli/tools.js';

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

  console.log('\nAdapters loaded successfully!');
})();
