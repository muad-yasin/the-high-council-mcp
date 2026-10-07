// 0.8.2 item 1 (owner via C&C, 7 Oct 2026: "Terminal rule only, no cap change"; cnc-money F1): the advice send path's policy max_usd_per_run
// REFUSES on the call's EXPECTED cost and only WARNS on its ceiling, like the CLI's evaluatePolicy; the warning reaches the person before they approve. $0, mock chains, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { previewText, dialogMessage } from '../src/send-path.js';
import { evaluatePolicy } from '../src/policy.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BRIEF = () => ({
  schema_version: 'advice-brief/1', moment: 'before_commit',
  question: 'Should we drop the legacy invoices column before the release?',
  decision_at_stake: 'A dropped column cannot be restored once the migration has run in production.',
  options_considered: [{ name: 'Drop it now', summary: 'Run the migration before the release.' }, { name: 'Do less', summary: 'Keep the column and add a new one beside it.' }],
  tried: [{ what: 'Ran the migration on a copy of the data', result: 'It passed in 3 seconds.' }],
  sensitivity: 'internal', not_included: ['the conversation', 'environment variables'], excerpts: [],
});
function session(cwd, { person = null } = {}) {
  const child = spawn(process.execPath, [cli, '--mcp'], { cwd, env: { PATH: process.env.PATH, HOME: cwd, COUNCIL_ADVISE_MOCK: '0', COUNCIL_ADVISE_COOLDOWN_MS: '0' } }); // the shipped Sol advice chain, priced (nothing is sent: the dialog is declined)
  const pending = new Map(); let buf = ''; let n = 0;
  child.stdout.on('data', d => {
    buf += d; let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.method && m.id !== undefined) child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: m.id, result: person ? person(m) : { action: 'decline' } })}\n`);
      else if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    }
  });
  const rpc = (method, params) => new Promise(r => { const id = ++n; pending.set(id, r); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  const ready = rpc('initialize', { protocolVersion: '2025-06-18', capabilities: person ? { elicitation: {} } : {}, clientInfo: { name: 'advice-policy', version: '0' } })
    .then(() => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`));
  return {
    async call(name, args) { await ready; const m = await rpc('tools/call', { name, arguments: args }); return m.result; },
    async close() { child.stdin.end(); await Promise.race([new Promise(r => child.on('exit', r)), sleep(3000)]); child.kill(); },
  };
}
const project = policy => { const dir = mkdtempSync(join(tmpdir(), 'thc-advice-policy-')); mkdirSync(join(dir, 'runs')); if (policy) writeFileSync(join(dir, 'policy.json'), JSON.stringify(policy)); return dir; };

// The figures of the shipped single advice chain (GPT-6.1 Sol), read from a quote with no policy.
async function figures() {
  const s = session(project(null));
  try { const r = await s.call('council_quote', { brief: BRIEF(), mode: 'single' }); return { expected: r.structuredContent.price.expected_usd, ceiling: r.structuredContent.price.ceiling_usd, plain: r }; } finally { await s.close(); }
}

test('item 1: a $1 limit with a Sol quote (expected cost well under it, ceiling $1.32) ALLOWS the quote, and the warning is in the quote text and in the approval dialog', async () => {
  const f = await figures();
  assert.equal(f.ceiling, 1.32, 'no cap change: the call\'s own ceiling stays $1.32');
  assert.ok(f.expected > 0 && f.expected < 1, `a $1 limit lies between the two figures: ${f.expected} / ${f.ceiling}`);
  const limit = 1;
  let message = null;
  const s = session(project({ max_usd_per_run: limit }), { person: m => { message = m.params.message; return { action: 'decline' }; } });
  try {
    const r = await s.call('council_quote', { brief: BRIEF(), mode: 'single' });
    assert.equal(r.isError, undefined, `refused: ${JSON.stringify(r).slice(0, 400)}`);
    assert.equal(r.structuredContent.kind, 'send_preview');
    const warning = r.structuredContent.policy_warnings?.[0] ?? '';
    assert.match(warning, /max_usd_per_run: the expected cost of this call's chain \(the first figure --dry-run prints\) is \$0\.40\d\d, within the \$1\.0000 limit, but the most this call can spend \(its ceiling\) is \$1\.3200/);
    assert.match(warning, /its ceiling/);
    assert.ok(r.content[0].text.includes(warning), 'the quote text a person reads carries the warning');
    const d = (await s.call('council_advise', { quote_id: r.structuredContent.quote_id, confirm_sha256: r.structuredContent.text.sha256 })).structuredContent;
    assert.equal(d.code, 'declined', JSON.stringify(d));
    assert.ok(message && message.includes(warning), 'the approval dialog carries the same warning');
    assert.ok(message.indexOf(warning) < message.indexOf('The text that would be sent'), 'and it comes before the text, with the price');
  } finally { await s.close(); }
});

test('item 1: a limit BELOW the call\'s expected cost refuses, naming the expected figure; a limit above the ceiling says nothing; no policy is unchanged', async () => {
  const f = await figures();
  const below = session(project({ max_usd_per_run: Number((f.expected / 2).toFixed(6)) }));
  try {
    const r = await below.call('council_quote', { brief: BRIEF(), mode: 'single' });
    assert.equal(r.isError, true);
    assert.match(JSON.stringify(r), /policy\.json refuses this call: max_usd_per_run: the expected cost of this call's chain/);
  } finally { await below.close(); }
  const above = session(project({ max_usd_per_run: f.ceiling * 2 }));
  try {
    const r = await above.call('council_quote', { brief: BRIEF(), mode: 'single' });
    assert.equal(r.isError, undefined);
    assert.equal(r.structuredContent.policy_warnings, undefined);
    assert.equal(/max_usd_per_run/.test(r.content[0].text), false);
  } finally { await above.close(); }
  assert.equal(f.plain.structuredContent.policy_warnings, undefined, 'no policy: no field');
  assert.equal(/max_usd_per_run/.test(f.plain.content[0].text), false);
});

test('item 1: with no warning the preview and the dialog are byte-for-byte what HEAD (0f9a761) produced for the same quote; a warning adds one line under the price', () => {
  const golden = JSON.parse(readFileSync(join(root, 'test', 'fixtures', 'advice-preview-no-policy.json'), 'utf8'));
  const q = { quote_id: 'q_fixed', expires_ms: Date.UTC(2026, 9, 7, 12, 0, 0), mode: 'single', sensitivity: { effective: 'internal', floor: 'internal', raised: false, operator_floor: 'internal', operator_source: 'default', project_floor: null }, seats: [{ lab: 'a', model: 'm', retention: 'kept 30 days', detail: 'd' }], bytes: 12, sha256: 'ab'.repeat(32), masked: {}, price: { worst_usd: 0.4, expected_usd: 0.06, ceiling_usd: 1.32 }, text: 'Hello text\n' };
  // The retention table's date and age ("is dated 2026-..., (N days old: re-check it)") move with the clock, not with this change: that one sentence is normalised on both sides.
  const norm = t => t.replace(/The retention table is dated [^.]*\./g, 'The retention table is dated X.');
  assert.equal(norm(previewText(q)), norm(golden.preview));
  assert.equal(norm(dialogMessage(q)), norm(golden.dialog));
  assert.notEqual(norm(previewText(q)), norm(golden.preview.replace('expected about $0.0600', 'expected about $0.0601')), 'the comparison can fail: one character of the price line differs');
  const w = "max_usd_per_run: the expected cost of this call's chain is $0.4000, within the $1.0000 limit, but its ceiling is $1.3200.";
  const withW = previewText({ ...q, policyWarnings: [w] });
  assert.equal(norm(withW.replace(`\nPolicy warning: ${w}`, '')), norm(golden.preview), 'exactly one added line');
  assert.ok(dialogMessage({ ...q, policyWarnings: [w] }).includes(`Policy warning: ${w}`));
});

test('item 1: evaluatePolicy with figure "call": refuses on the first figure, warns on the second, in the advice words (the CLI words are unchanged)', () => {
  const ctx = { config: {}, allSeats: [], monthToDateUsd: 0 };
  const call = lim => evaluatePolicy({ max_usd_per_run: lim }, { ...ctx, worstCaseUsd: 0.4, maximumUsd: 1.32, figure: 'call' });
  assert.deepEqual([call(1).ok, call(1).warnings.length], [true, 1]);
  assert.match(call(1).warnings[0], /the expected cost of this call's chain \(the first figure --dry-run prints\) is \$0\.4000, within the \$1\.0000 limit, but the most this call can spend \(its ceiling\) is \$1\.3200/);
  assert.equal(call(0.3).ok, false);
  assert.match(call(0.3).reasons.join(' '), /the expected cost of this call's chain .* is \$0\.4000 and the most this call can spend \(its ceiling\) \$1\.3200, over the \$0\.3000 limit/);
  assert.equal(call(2).warnings.length, 0);
  assert.match(evaluatePolicy({ max_usd_per_run: 1 }, { ...ctx, worstCaseUsd: 1.32 }).reasons.join(' '), /this chain's expected cost \(the first figure --dry-run prints\) is \$1\.3200/);
});

test('item 1: a quote the policy allows is never refused by the CLI adopt gate after the person approves (same figures), and one it refuses is refused at the quote', async () => {
  const { preSendRefusals } = await import('../src/send-path-refusals.js');
  const { buildPolicyContext } = await import('../src/policy.js');
  const { everySeatOf } = await import('../src/chain.js');
  const config = JSON.parse(readFileSync(join(root, 'chains', 'advise-single.json'), 'utf8'));
  const cli = lim => evaluatePolicy({ max_usd_per_run: lim }, buildPolicyContext(config, everySeatOf(config), join(tmpdir(), 'no-runs-here'))).ok; // what src/cli.js evaluates for an adopted run
  const seen = new Set();
  for (const lim of [0.01, 0.06, 0.2, 0.3, 0.45, 0.9, 1, 1.5]) {
    const work = project({ max_usd_per_run: lim });
    const r = preSendRefusals('advice', { brief: BRIEF(), mode: 'single' }, { work, runsDir: join(work, 'runs'), env: { COUNCIL_ADVISE_MOCK: '0' }, loadChain: n => JSON.parse(readFileSync(join(root, 'chains', `${n}.json`), 'utf8')), usdLimit: null });
    const allowed = !r.refusal || r.refusal.code !== 'policy';
    assert.equal(allowed, cli(lim), `limit ${lim}: quote ${allowed ? 'allows' : 'refuses'}, the adopt gate ${cli(lim) ? 'passes' : 'refuses'}`);
    seen.add(allowed);
  }
  assert.deepEqual([...seen].sort(), [false, true], 'the limits tried lie on both sides of the expected cost');
});
