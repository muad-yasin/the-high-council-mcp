// The advice add-on's words (0.8.1 decided rule 2, plan M5 Work 5 and 8): no efficacy wording, "leaning" never "verdict", "ZDR" as
// OpenRouter's routing tag and never a guarantee, a dated retention table; and the hold's schema limit (DR-6).
//
// Scope, on purpose: the two advice tools' descriptions and argument descriptions, the answer the agent reads (adviceResult) for
// both shipped report shapes, the send preview, the README's advice section and docs/mcp-clients.md's advice section. Not every
// tool: `verdict_stats` is a public tool name about planning runs, and renaming it is not additive (decided rule 11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adviceResult } from '../src/mcp/advice.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');

// Efficacy and verdict words (decided rule 2). "verdict" is matched as a word, so a JSON key such as `verdict_text` in a report is
// not text anyone reads here; the answer builder's own output is what is checked.
const BANNED = [/\bverdicts?\b/i, /\bbetter\b/i, /\bsafer\b/i, /\bmore reliable\b/i, /\bguarantee[sd]? (?:that|your|the)\b/i];
const banned = (where, text) => BANNED.filter(re => re.test(text)).map(re => `${where}: ${re} matches "${text.match(re)[0]}"`);

function section(text, heading) {
  const start = text.indexOf(heading);
  assert.ok(start >= 0, `no section ${heading}`);
  const rest = text.slice(start + heading.length);
  const end = rest.search(/\n#{2,3} /);
  return heading + (end < 0 ? rest : rest.slice(0, end));
}

function session(cwd, env = {}) {
  const child = spawn(process.execPath, [cli, '--mcp'], { cwd, env: { PATH: process.env.PATH, HOME: cwd, COUNCIL_ADVISE_MOCK: '1', ...env } });
  const pending = new Map(); let buf = ''; let n = 0;
  child.stdout.on('data', d => {
    buf += d; let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    }
  });
  const rpc = (method, params) => new Promise(r => { const id = ++n; pending.set(id, r); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  const ready = rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'wording', version: '0' } })
    .then(() => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`));
  return { rpc: async (m, p) => { await ready; return rpc(m, p); }, close: () => { child.stdin.end(); child.kill(); } };
}

const BRIEF = {
  schema_version: 'advice-brief/1', moment: 'before_commit',
  question: 'Should we drop the legacy invoices column before the release?',
  decision_at_stake: 'A dropped column cannot be restored once the migration has run in production.',
  options_considered: [{ name: 'Drop it now', summary: 'Run the migration before the release.' }, { name: 'Do less', summary: 'Keep the column and add a new one beside it.' }],
  tried: [{ what: 'Ran the migration on a copy of the data', result: 'It passed in 3 seconds.' }],
  sensitivity: 'internal', not_included: ['the conversation'], excerpts: [],
};

test('no efficacy or verdict words in the advice tools, the answer, the preview, or the README and docs advice sections', async () => {
  const problems = [];
  const s = session(mkdtempSync(join(tmpdir(), 'thc-wording-')));
  try {
    const tools = (await s.rpc('tools/list', {})).result.tools.filter(t => t.name.startsWith('council_'));
    assert.equal(tools.length, 2);
    for (const t of tools) problems.push(...banned(`${t.name} description`, t.description), ...banned(`${t.name} arguments`, JSON.stringify(t.inputSchema)));
    const q = (await s.rpc('tools/call', { name: 'council_quote', arguments: { brief: BRIEF, mode: 'single' } })).result;
    assert.equal(q.isError, undefined, JSON.stringify(q));
    problems.push(...banned('send preview', q.content.map(c => c.text).join('\n')));
    assert.match(q.content[0].text, /ZDR-tagged by OpenRouter" is OpenRouter's routing tag for that endpoint, not a guarantee/);
    assert.match(q.content[0].text, /The retention table is dated \d{4}-\d{2}-\d{2}/);
  } finally { s.close(); }
  // The words the harness writes around the models' text: every model-written string in the fixture becomes a neutral placeholder,
  // since what a model writes is not ours to word (it is shown as untrusted text).
  const MODEL_FIELDS = new Set(['verdict_text', 'next_step', 'answer', 'risk', 'quote', 'would_change_if', 'missing_from_brief', 'synthesis', 'restated_question']);
  const neutral = (v, key = '') => (Array.isArray(v) ? v.map(x => neutral(x, key))
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, neutral(x, k)]))
      : typeof v === 'string' && MODEL_FIELDS.has(key) ? 'model text' : v);
  for (const f of ['report-advice-single.json', 'report-advice-council.json']) {
    const r = adviceResult({ run: 'r1', report: neutral(JSON.parse(readFileSync(join(root, 'test', 'fixtures', f), 'utf8'))) });
    const text = r.content.map(c => c.text).join('\n');
    problems.push(...banned(`answer (${f})`, text));
    assert.match(text, /Leaning: /, `${f}: the answer says "leaning"`);
    assert.ok(!('verdict' in r.structuredContent), `${f}: no verdict key in what the agent reads`);
    assert.ok('leaning' in r.structuredContent);
  }
  const readme = section(readFileSync(join(root, 'README.md'), 'utf8'), '### Asking other labs for advice');
  problems.push(...banned('README advice section', readme));
  assert.match(readme, /\bleaning\b/);
  assert.match(readme, /OpenRouter's routing tag for an\s+endpoint, not a guarantee/);
  assert.match(readme, /dated snapshot \(read on \d{4}-\d{2}-\d{2}/);
  for (const v of ['COUNCIL_ADVICE_SENSITIVITY_FLOOR', 'COUNCIL_ADVICE_CHAINS_DIR', 'COUNCIL_ADVISE_MAX_USD_PER_CALL', 'council gate answer', 'council advise-rate', 'awaiting_approval']) assert.ok(readme.includes(v), `README advice section names ${v}`);
  const docs = section(readFileSync(join(root, 'docs', 'mcp-clients.md'), 'utf8'), '## The advice tools in any client');
  problems.push(...banned('docs/mcp-clients.md advice section', docs));
  assert.match(docs, /at most 30 seconds/);
  assert.match(docs, /Headless use is refused by design/);
  assert.deepEqual(problems, []);
});

test('the date in the README is the retention table\'s own', () => {
  const asOf = JSON.parse(readFileSync(join(root, 'src', 'advice-retention.json'), 'utf8')).asOf;
  assert.match(readFileSync(join(root, 'README.md'), 'utf8'), new RegExp(`dated snapshot \\(read on ${asOf}`));
});

test('DR-6: wait_seconds above 30 is refused by the schema of council_advise and run_status; 30 is accepted', async () => {
  const s = session(mkdtempSync(join(tmpdir(), 'thc-wording-hold-')));
  try {
    const tools = Object.fromEntries((await s.rpc('tools/list', {})).result.tools.map(t => [t.name, t]));
    for (const name of ['council_advise', 'run_status']) assert.equal(tools[name].inputSchema.properties.wait_seconds.maximum, 30, name);
    const adv = await s.rpc('tools/call', { name: 'council_advise', arguments: { quote_id: `q_${'0'.repeat(24)}`, confirm_sha256: '0'.repeat(64), wait_seconds: 31 } });
    const st = await s.rpc('tools/call', { name: 'run_status', arguments: { run: '2026-10-03T00-00-00-000Z', wait_seconds: 31 } });
    for (const [name, m] of [['council_advise', adv], ['run_status', st]]) {
      const refused = m.error || m.result?.isError;
      assert.ok(refused, `${name} took wait_seconds 31: ${JSON.stringify(m).slice(0, 200)}`);
      assert.match(JSON.stringify(m), /wait_seconds/, name);
    }
    const ok = await s.rpc('tools/call', { name: 'run_status', arguments: { run: '2026-10-03T00-00-00-000Z', wait_seconds: 30 } });
    assert.ok(!ok.error && !/wait_seconds/.test(JSON.stringify(ok)), JSON.stringify(ok).slice(0, 200));
  } finally { s.close(); }
});
