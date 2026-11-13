// 0.8.4 DUALCAP unit 4b1: one typed limit PER CAP in the run's gate ledger (the contract: src/caps.js RECORDS, "run_cap gate"). A run_cap gate may carry
// cap.cap_name (a provider that bills), its `cap_consumed` line carries the same name, and the order rules (a first limit, then raises or amendments requested
// after the previous one) hold PER CAP: two caps are two sequences in one ledger. A gate without cap_name hashes, verifies and reads exactly as before (a ledger
// written before this unit still verifies: the fixture). Real gate files and ledgers in a temp folder, no model, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { authorizeStart } from '../src/start-cap.js';
import { requestGate, answerGate, readGateAnswer, runCapAuthority, consumeRunCap, RUN_CAP_KIND } from '../src/gate.js';
import { LEDGER_FILE } from '../src/gate-ledger.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const T0 = Date.parse('2026-11-01T12:00:00.000Z');
let clock = T0;
const now = () => clock;
const tick = () => { clock += 1000; };
const scope = createHash('sha256').update('scope-caps').digest('hex');
const SCREEN = 'SCREEN: type your limit.\n';
const ledger = d => readFileSync(join(d, LEDGER_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
function folder() { clock = T0; const base = mkdtempSync(join(tmpdir(), 'caps-ledger-')); const d = join(base, 'run-1'); mkdirSync(d); return d; }
const person = (d, id, typed) => { const g = readGateAnswer(d, id, { now }).gate; tick(); return answerGate(d, id, { channel: 'cli', shownSha256: g.sha256, decision: 'approved', actor: 'tester', tty: true, typedCap: typed }, { now }); };
const call = (d, capName, over = {}) => authorizeStart({ runDir: d, runId: 'run-1', resume: false, scopeSha256: scope, screenText: SCREEN, ceiling: null, interactive: false, ask: async () => 1, now, capName, ...over });
// one limit typed and consumed for a cap through authorizeStart, the path the CLI uses: ask (pending), the person answers, the next start consumes it
async function typed(d, capName, usd, over = {}) {
  const asked = await call(d, capName, over);
  assert.equal(asked.status, 'pending', `${capName}: asked`);
  assert.equal(person(d, asked.gate, usd).ok, true, `${capName}: answered`);
  tick();
  const got = await call(d, capName, over);
  assert.equal(got.status, 'authorized', `${capName}: ${JSON.stringify(got)}`);
  return { gate: asked.gate, got };
}
// a gate made by hand (the order rules are the ledger's, not authorizeStart's), each with its own screen file
let screens = 0;
const capGate = (d, cap) => { tick(); const file = `cap-screen-x${++screens}.md`; writeFileSync(join(d, file), SCREEN); return requestGate(d, { kind: RUN_CAP_KIND, textPath: file, cap, expiresAt: clock + 3_600_000 }, { now }); };

test('L1: a run_cap gate may name the cap its limit is for (a provider that bills); anything else under that key is refused as before', () => {
  const d = folder();
  const base = { operation: 'start', run_id: 'run-1', scope_sha256: scope, ceiling_usd: null, ceiling_source: null };
  const ok = capGate(d, { ...base, cap_name: 'openrouter' });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(readGateAnswer(d, ok.gate.id, { now }).gate.cap.cap_name, 'openrouter', 'read back with its cap');
  for (const bad of ['mock', 'ollama', 'OpenRouter', '', 5, null]) {
    const r = capGate(d, { ...base, cap_name: bad });
    assert.equal(r.ok, false, JSON.stringify(bad)); assert.equal(r.code, 'bad_cap', JSON.stringify(bad));
  }
  const extra = capGate(d, { ...base, cap_name: 'anthropic', other: 1 });
  assert.equal(extra.code, 'bad_cap', 'an unknown key is still refused');
  const plain = capGate(d, base);
  assert.equal(plain.ok, true, 'a gate with no cap_name is accepted as before');
});

test('L2: a ledger written before per-cap limits (no cap_name anywhere: a start, then a raise) still verifies and reads exactly as before', () => {
  clock = Date.parse('2026-11-01T09:05:00.000Z');
  const d = join(mkdtempSync(join(tmpdir(), 'caps-ledger-pre4b-')), 'run-1');
  cpSync(join(root, 'test', 'fixtures', 'caps', 'ledger-pre4b'), d, { recursive: true });
  assert.ok(ledger(d).every(l => !('cap_name' in l)), 'fixture: no cap_name anywhere');
  const a = runCapAuthority(d, { runId: 'run-1', now });
  assert.deepEqual([a.status, a.capUsd, a.capMicroUsd, a.consumptions, a.operation], ['ok', '8', 8_000_000, 2, 'raise']);
  assert.equal(runCapAuthority(d, { runId: 'run-1', capName: 'openrouter', now }).status, 'none', 'a cap\'s own authority reads none of the lines without a cap');
});

test('L3: two caps in one run are two sequences: each cap\'s first limit is consumed, each cap\'s authority is its own figure, and the run\'s plain authority sees neither', async () => {
  const d = folder();
  const o = await typed(d, 'openrouter', '3');
  const a = await typed(d, 'anthropic', '20');
  assert.deepEqual([o.got.via, o.got.capUsd, a.got.via, a.got.capUsd], ['answered', 3, 'answered', 20]);
  const used = ledger(d).filter(l => l.event === 'cap_consumed');
  assert.deepEqual(used.map(l => l.cap_name), ['openrouter', 'anthropic'], 'each use line names its cap');
  assert.deepEqual(['openrouter', 'anthropic'].map(c => runCapAuthority(d, { runId: 'run-1', capName: c, now }).capUsd), ['3', '20']);
  assert.equal(runCapAuthority(d, { runId: 'run-1', now }).status, 'none');
  // a later start continues each cap under its own limit, with no second consume
  tick();
  const again = [await call(d, 'openrouter'), await call(d, 'anthropic')];
  assert.deepEqual(again.map(r => [r.status, r.via, r.capUsd]), [['authorized', 'continued', 3], ['authorized', 'continued', 20]]);
  assert.equal(ledger(d).filter(l => l.event === 'cap_consumed').length, 2);
});

test('L4: the order rules hold per cap: a second first-limit for a cap is refused; a raise for a cap requested before THAT cap\'s latest limit is stale, one requested after it is consumed', async () => {
  const d = folder();
  await typed(d, 'openrouter', '3');
  const startAgain = capGate(d, { operation: 'start', run_id: 'run-1', scope_sha256: scope, ceiling_usd: null, ceiling_source: null, cap_name: 'openrouter' });
  assert.equal(person(d, startAgain.gate.id, '4').ok, true);
  const r1 = consumeRunCap(d, startAgain.gate.id, { runId: 'run-1', scopeSha256: scope }, { now });
  assert.deepEqual([r1.ok, r1.code], [false, 'cap_sequence'], 'openrouter already has a limit');
  // a raise for anthropic requested BEFORE anthropic's first limit is consumed: anthropic has nothing to raise yet
  const earlyRaise = capGate(d, { operation: 'raise', run_id: 'run-1', scope_sha256: scope, ceiling_usd: null, ceiling_source: null, cap_name: 'anthropic' });
  assert.equal(person(d, earlyRaise.gate.id, '30').ok, true);
  const r2 = consumeRunCap(d, earlyRaise.gate.id, { runId: 'run-1', scopeSha256: scope }, { now });
  assert.deepEqual([r2.ok, r2.code], [false, 'cap_sequence'], 'anthropic has no limit to raise');
  // anthropic's first limit, by hand (authorizeStart would pick up the stray approved raise above, which is the ledger's case to refuse, not this test's)
  const first = capGate(d, { operation: 'start', run_id: 'run-1', scope_sha256: scope, ceiling_usd: null, ceiling_source: null, cap_name: 'anthropic' });
  assert.equal(person(d, first.gate.id, '20').ok, true);
  tick();
  assert.equal(consumeRunCap(d, first.gate.id, { runId: 'run-1', scopeSha256: scope }, { now }).ok, true, 'anthropic\'s first limit');
  // a raise for openrouter requested now, after anthropic's consumption (and after openrouter's own): it is not stale for openrouter
  const raise = capGate(d, { operation: 'raise', run_id: 'run-1', scope_sha256: scope, ceiling_usd: null, ceiling_source: null, cap_name: 'openrouter' });
  assert.equal(person(d, raise.gate.id, '6').ok, true);
  tick();
  const r3 = consumeRunCap(d, raise.gate.id, { runId: 'run-1', scopeSha256: scope }, { now });
  assert.equal(r3.ok, true, JSON.stringify(r3));
  assert.equal(runCapAuthority(d, { runId: 'run-1', capName: 'openrouter', now }).capUsd, '6');
  assert.equal(runCapAuthority(d, { runId: 'run-1', capName: 'anthropic', now }).capUsd, '20', 'the other cap keeps its limit');
});

test('L5: a stop opens a raise only for the cap that stopped: the stop file\'s capName AND its capUsd must match that cap\'s limit (two caps with the same figure never raise the wrong one)', async () => {
  const d = folder();
  await typed(d, 'openrouter', '5');
  await typed(d, 'anthropic', '5');
  tick();
  const stopped = { capUsd: 5, capName: 'anthropic' };
  const hist = () => ({ stopped, floorUsd: 4 });
  const o = await call(d, 'openrouter', { resume: true, history: hist });
  assert.deepEqual([o.status, o.via, o.capUsd], ['authorized', 'continued', 5], 'openrouter did not stop: it continues');
  const a = await call(d, 'anthropic', { resume: true, history: hist });
  assert.equal(a.status, 'pending', 'anthropic stopped at its limit: a raise is asked');
  const g = readGateAnswer(d, a.gate, { now }).gate;
  assert.deepEqual([g.cap.operation, g.cap.cap_name], ['raise', 'anthropic']);
});
