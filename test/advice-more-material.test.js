// An advisor's request for more material needs a person (0.8.1 plan M5 Work 3, decided rule 5c, DR-8), the advice record's new
// fields (Work 6, P7) and `council advise-rate` (Work 7). Mock-only, $0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { moreMaterialRequested } from '../src/advice-run.js';
import { readLedger } from '../src/gate-ledger.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (pred, ms = 30_000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(100); } return false; };

const BRIEF = (question = 'Should we drop the legacy invoices column before the release?') => ({
  schema_version: 'advice-brief/1', moment: 'before_commit', question,
  decision_at_stake: 'A dropped column cannot be restored once the migration has run in production.',
  options_considered: [{ name: 'Drop it now', summary: 'Run the migration before the release.' }, { name: 'Do less', summary: 'Keep the column and add a new one beside it.' }],
  tried: [{ what: 'Ran the migration on a copy of the data', result: 'It passed in 3 seconds.' }],
  sensitivity: 'internal', not_included: ['the conversation', 'environment variables'], excerpts: [],
});

// An operator chain (outside the work folder, rule 5d) whose one mock seat answers "not enough information" and lists what is missing.
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-more-'));
  const operator = mkdtempSync(join(tmpdir(), 'thc-more-chains-'));
  const c = JSON.parse(readFileSync(join(root, 'chains', 'mock-advise-single.json'), 'utf8'));
  c.name = 'mock-need-info'; c.seats.critics = [{ provider: 'mock', model: 'mock-advisor-need-info', lab: 'solo' }];
  writeFileSync(join(operator, 'mock-need-info.json'), JSON.stringify(c));
  return { dir, env: { COUNCIL_ADVICE_CHAINS_DIR: operator, COUNCIL_ADVISE_CHAIN_SINGLE: 'mock-need-info' } };
}

function session(cwd, { env = {}, person = null, clientName = 'more-material', clientVersion = '1.2.3' } = {}) {
  const child = spawn(process.execPath, [cli, '--mcp'], { cwd, env: { PATH: process.env.PATH, HOME: cwd, COUNCIL_ADVISE_COOLDOWN_MS: '0', ...env } });
  const pending = new Map(); let buf = ''; let n = 0; const asked = [];
  child.stdout.on('data', d => {
    buf += d; let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.method && m.id !== undefined) { asked.push(m.params?.message); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: m.id, result: person ? person(m) : { action: 'decline' } })}\n`); }
      else if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    }
  });
  const rpc = (method, params) => new Promise(r => { const id = ++n; pending.set(id, r); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  const ready = rpc('initialize', { protocolVersion: '2025-06-18', capabilities: person ? { elicitation: {} } : {}, clientInfo: { name: clientName, version: clientVersion } })
    .then(() => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`));
  return {
    asked,
    async raw(name, args) { await ready; return rpc('tools/call', { name, arguments: args }); },
    async call(name, args) { const m = await this.raw(name, args); return m.result?.structuredContent ?? m.result; },
    async close() { child.stdin.end(); await Promise.race([new Promise(r => child.on('exit', r)), sleep(3000)]); child.kill(); },
  };
}
const ACCEPT = () => ({ action: 'accept', content: { send: true } });

test('an answer that asks for more material: the ledger event, then the next call carries the follow-up line and sends nothing until its own gate is answered', async () => {
  const { dir, env } = project();
  const first = session(dir, { env, person: ACCEPT });
  let run1;
  try {
    const q = await first.call('council_quote', { brief: BRIEF(), mode: 'single' });
    assert.equal(q.follow_up, undefined, 'the first call follows nothing');
    const a = await first.call('council_advise', { quote_id: q.quote_id, confirm_sha256: q.text.sha256, wait_seconds: 25 });
    assert.equal(a.kind, 'advice', JSON.stringify(a).slice(0, 300));
    assert.ok(a.missing_from_brief.length > 0);
    run1 = join(dir, 'runs', a.run);
    assert.ok(await waitFor(() => existsSync(join(run1, 'report.json'))));
    assert.ok(await waitFor(() => readLedger(run1).lines.some(l => l.event === 'more_material_requested')), 'the event is in the run\'s own ledger');
    const ev = readLedger(run1).lines.find(l => l.event === 'more_material_requested');
    assert.equal(ev.items, a.missing_from_brief.length);
    // P7: the record names the client as it named itself and how long the person took; still no brief text.
    const log = JSON.parse(readFileSync(join(run1, 'advise-log.json'), 'utf8'));
    assert.deepEqual(log.client, { name: 'more-material', version: '1.2.3' });
    assert.ok(Number.isInteger(log.approval_wait_ms) && log.approval_wait_ms >= 0, JSON.stringify(log.approval_wait_ms));
    assert.equal(log.approval, 'elicitation');
    assert.equal(log.owner_rating, null);
    for (const word of ['legacy', 'invoices', 'migration']) assert.ok(!JSON.stringify(log).toLowerCase().includes(word), word);
  } finally { await first.close(); }

  // The follow-up, in a client that cannot ask: the quote says it, the gate binds it, the terminal prints it, nothing starts.
  const nobody = session(dir, { env });
  try {
    const q = await nobody.call('council_quote', { brief: BRIEF('Which deadline applies to dropping the legacy invoices column?'), mode: 'single' });
    assert.match(q.follow_up, new RegExp(`follows an advisor's request for more material \\(run ${run1.split('/').pop()}\\)`));
    const w = await nobody.call('council_advise', { quote_id: q.quote_id, confirm_sha256: q.text.sha256 });
    assert.equal(w.status, 'awaiting_approval', JSON.stringify(w));
    const gate = JSON.parse(readFileSync(join(dir, 'runs', w.run, 'gates', 'g1.json'), 'utf8'));
    assert.equal(gate.follow_up, q.follow_up);
    const shown = spawnSync(process.execPath, [cli, 'gate', 'show', `runs/${w.run}`, 'g1'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
    assert.equal(shown.status, 0, shown.stderr);
    assert.match(shown.stdout, /^follow-up: This call follows an advisor's request for more material/m);
    assert.match(shown.stdout, /^status: pending$/m);
    assert.equal(existsSync(join(dir, 'runs', w.run, 'advise-log.json')), false, 'nothing started');
    assert.equal(existsSync(join(dir, 'runs', w.run, 'run.json')), false, 'nothing started');
  } finally { await nobody.close(); }

  // The same, in a client that asks: the dialog the person reads carries the line; a decline sends nothing.
  let message = null;
  const asks = session(dir, { env, person: m => { message = m.params.message; return { action: 'decline' }; } });
  try {
    const q = await asks.call('council_quote', { brief: BRIEF('Which owner signs off on dropping the legacy invoices column?'), mode: 'single' });
    const d = await asks.call('council_advise', { quote_id: q.quote_id, confirm_sha256: q.text.sha256 });
    assert.equal(d.code, 'declined', JSON.stringify(d));
    assert.match(message, /This call follows an advisor's request for more material/);
    assert.equal(existsSync(join(dir, 'runs', d.run, 'advise-log.json')), false);
  } finally { await asks.close(); }
});

test('moreMaterialRequested also reads report.json, so a lost event still shows the line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-more-unit-'));
  assert.equal(moreMaterialRequested(dir), false);
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ advise: { missing_from_brief: [] } }));
  assert.equal(moreMaterialRequested(dir), false);
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ advise: { missing_from_brief: ['the deadline'] } }));
  assert.equal(moreMaterialRequested(dir), true);
  writeFileSync(join(dir, 'report.json'), '{ broken');
  assert.equal(moreMaterialRequested(dir), false);
});

test('M4 follow-up: a prepared quote sent again with different dispositions is refused, not silently dropped; the same call again is fine', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-more-disp-'));
  const s = session(dir, { env: { COUNCIL_ADVISE_MOCK: '1' } });
  try {
    const q = await s.call('council_quote', { brief: BRIEF(), mode: 'single' });
    const w = await s.call('council_advise', { quote_id: q.quote_id, confirm_sha256: q.text.sha256 });
    assert.equal(w.status, 'awaiting_approval');
    const late = await s.call('council_advise', { quote_id: q.quote_id, confirm_sha256: q.text.sha256, dispositions: [{ id: 'r#x', decision: 'reject', reason: 'A reason that is long enough to count.' }] });
    assert.equal(late.code, 'dispositions_too_late', JSON.stringify(late));
    assert.equal(late.run, w.run);
    const again = await s.call('council_advise', { quote_id: q.quote_id, confirm_sha256: q.text.sha256 });
    assert.equal(again.status, 'awaiting_approval', 'the same call again picks the same gate up');
    assert.equal(again.run, w.run);
  } finally { await s.close(); }
});

test('council advise-rate: not-useful is stored as "not useful"; any other token, a damaged record or a folder outside runs/ writes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-rate-'));
  const run = join(dir, 'runs', '2026-10-03T02-00-00-000Z');
  mkdirSync(run, { recursive: true });
  const log = { schema: 'advise-log/1', run: '2026-10-03T02-00-00-000Z', ts: 1, quoted: { ceiling_usd: 1 }, owner_rating: null };
  writeFileSync(join(run, 'advise-log.json'), `${JSON.stringify(log, null, 2)}\n`);
  const rate = (...args) => spawnSync(process.execPath, [cli, 'advise-rate', ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  const r = rate('runs/2026-10-03T02-00-00-000Z', 'not-useful', 'missed', 'the', 'real\u0007constraint');
  assert.equal(r.status, 0, r.stderr);
  const after = JSON.parse(readFileSync(join(run, 'advise-log.json'), 'utf8'));
  assert.deepEqual(after.owner_rating, { rating: 'not useful', note: 'missed the real constraint' });
  assert.deepEqual({ ...after, owner_rating: null }, log, 'no other field changed');
  const before = readFileSync(join(run, 'advise-log.json'));
  for (const token of ['not useful', 'Useful', 'good', 'not_useful', '1']) {
    const bad = rate('runs/2026-10-03T02-00-00-000Z', token);
    assert.equal(bad.status, 2, token);
    assert.deepEqual(readFileSync(join(run, 'advise-log.json')), before, `${token} wrote something`);
  }
  for (const token of ['useful', 'unclear']) {
    assert.equal(rate('runs/2026-10-03T02-00-00-000Z', token).status, 0);
    assert.equal(JSON.parse(readFileSync(join(run, 'advise-log.json'), 'utf8')).owner_rating.rating, token);
  }
  assert.equal(rate('.', 'useful').status, 2);
  assert.equal(rate('runs/nope', 'useful').status, 2);
  assert.equal(rate('runs/2026-10-03T02-00-00-000Z', 'useful', 'x'.repeat(501)).status, 2);
  writeFileSync(join(run, 'advise-log.json'), '{ "owner_rating": ');
  const damaged = rate('runs/2026-10-03T02-00-00-000Z', 'useful');
  assert.equal(damaged.status, 1);
  assert.equal(readFileSync(join(run, 'advise-log.json'), 'utf8'), '{ "owner_rating": ', 'a damaged record is left for a person');
});
