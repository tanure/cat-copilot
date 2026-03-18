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

  console.log('\nAdapters loaded successfully!');
})();
