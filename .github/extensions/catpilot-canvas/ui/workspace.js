const $ = id => document.getElementById(id);
const token = document.querySelector('meta[name=catpilot-token]').content;
const domains = ['tasks', 'knowledge', 'journal', 'projects', 'learning', 'milestones', 'growth', 'achievements', 'pomodoro', 'reports'];
let records = [], selected = null, dirty = false, previousDomain = 'tasks', bodyView = '';
for (const domain of domains) {
  const option = document.createElement('option');
  option.value = option.textContent = domain;
  $('domain').append(option);
}
function message(text, error = false) { $('message').textContent = text; $('message').dataset.error = String(error); }
async function request(data) {
  const response = await fetch(new URL('api/request', location.href), {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-catpilot-token': token }, body: JSON.stringify(data),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `Workspace request failed (${response.status}).`);
  return value;
}
async function perform(action) {
  document.querySelectorAll('button,input,textarea,select').forEach(element => { element.disabled = true; });
  try { await action(); }
  catch (error) { message(error.message, true); }
  finally { document.querySelectorAll('button,input,textarea,select').forEach(element => { element.disabled = false; }); }
}
function discard() { return !dirty || confirm('Discard unsaved editor changes?'); }
function choose(record) {
  selected = record;
  $('identity').textContent = record ? `${record.id} | revision ${record.revision}` : `New ${$('domain').value} record`;
  $('title').value = record?.title || '';
  $('body').value = record?.body || '';
  bodyView = $('body').value;
  $('fields').value = JSON.stringify(record?.fields || {}, null, 2);
  dirty = false;
  draw();
}
function draw() {
  $('records').replaceChildren();
  for (const record of records.filter(item => item.domain === $('domain').value)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${record.fields.status}: ${record.title}`;
    button.setAttribute('aria-current', String(record.id === selected?.id));
    button.onclick = () => { if (discard()) choose(record); };
    $('records').append(button);
  }
}
async function refresh(id = selected?.id) {
  records = (await request({ action: 'snapshot' })).records;
  choose(records.find(record => record.id === id) || null);
}
$('editor').oninput = () => { dirty = true; };
$('domain').onchange = () => {
  if (!discard()) { $('domain').value = previousDomain; return; }
  previousDomain = $('domain').value;
  choose(null);
};
$('new').onclick = () => { if (discard()) choose(null); };
$('refresh').onclick = () => { if (discard()) perform(() => refresh()); };
$('editor').onsubmit = event => {
  event.preventDefault();
  const current = selected;
  let fields;
  try { fields = JSON.parse($('fields').value); }
  catch { return message('Structured fields must contain valid JSON. Your draft was not changed.', true); }
  const input = {
    domain: current?.domain || $('domain').value,
    title: $('title').value, body: current && $('body').value === bodyView ? current.body : $('body').value, fields,
  };
  perform(async () => {
    const saved = await request({ action: 'put', input, ...(current ? { id: current.id, expectedRevision: current.revision } : {}) });
    await refresh(saved.id);
    message('Saved to the selected workspace.');
  });
};
for (const action of ['complete', 'comment', 'log', 'carry']) {
  $(action).onclick = () => {
    if (!selected) return message('Save or select a record first.', true);
    if (dirty) return message('Save your editor changes before running a workflow.', true);
    const workflow = { action: action === 'carry' ? 'carryForward' : action, id: selected.id, expectedRevision: selected.revision };
    if (action === 'comment' || action === 'log') {
      const text = prompt(`New ${action} text`);
      if (!text?.trim()) return;
      workflow.text = text;
    }
    if (action === 'carry') {
      const period = prompt('Destination period: YYYY-MM-DD, YYYY-Www or YYYY-MM', selected.fields.period);
      if (!period) return;
      workflow.period = period;
    }
    perform(async () => { await request({ action: 'management', request: workflow }); await refresh(); message('Workflow saved.'); });
  };
}
$('remove').onclick = () => {
  if (!selected || !confirm(`Permanently delete "${selected.title}" from this workspace?`)) return;
  const record = selected;
  perform(async () => { await request({ action: 'remove', id: record.id, expectedRevision: record.revision }); await refresh(null); message('Deleted.'); });
};
$('report').onclick = () => perform(async () => {
  const report = await request({ action: 'management', request: { action: 'report', from: $('from').value, to: $('to').value } });
  $('report-output').textContent = report.markdown;
});
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
perform(async () => {
  const response = await fetch(new URL('api/context', location.href), { headers: { 'x-catpilot-token': token } });
  const workspace = await response.json();
  if (!response.ok) throw new Error(workspace.error);
  $('context').textContent = `${workspace.name} | ${workspace.backend} | ${workspace.id}`;
  const today = new Date().toISOString().slice(0, 10);
  $('to').value = today;
  $('from').value = today.slice(0, 8) + '01';
  await refresh();
});
