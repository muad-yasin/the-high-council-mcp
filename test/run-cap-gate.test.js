// The `run_cap` gate kind (0.8.3 M6 typed cap T3, record half; typed-cap gate page sections 3 and 7; 14 Oct 2026): the limit a person TYPES for one run is a gate answer. The pending decision (operation, run id, scope digest,
// the ceiling in force) is bound into the gate's metadata; the answer is the person's raw text, parsed by answerGate against the BOUND ceiling, and the dollars written are the parse's - never a caller's figure; an approval
// with no typed text is refused by answerGate itself (no bare yes); the use is `cap_consumed`, single-use for ever; continuing a run under its cap is the read-only runCapAuthority. Mock-only, $0, no network.
// `import * as gate`: rows for the NEW exports (consumeRunCap, runCapAuthority, capScopeSha256) are new-API rows; the security rows (a bare approval, a forged figure, an amount above the ceiling) are value rows against
// exports that already exist, so they show what the old gate did.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as gate from '../src/gate.js';
import { LEDGER_FILE, withLedger } from '../src/gate-ledger.js';

const here = dirname(fileURLToPath(import.meta.url));
const T0 = Date.parse('2026-10-14T12:00:00.000Z');
const at = ms => () => ms;
const SCREEN = 'The screen: estimate, maximum, your limit (blank).\n';
const SCOPE = { task: 'a'.repeat(64), chain: 'b'.repeat(64), seats: ['mock/mock-a'], policy: null };   // for the capScopeSha256 row
const scopeSha = () => createHash('sha256').update('scope-1').digest('hex');   // a local digest: the rows below must reach requestGate/answerGate on the OLD tree too (capScopeSha256 has its own row)
const otherScopeSha = () => createHash('sha256').update('scope-2').digest('hex');
const cap = (over = {}) => ({ operation: 'start', run_id: 'run-1', scope_sha256: scopeSha(), ceiling_usd: 10, ceiling_source: 'COUNCIL_MAX_USD_LIMIT', ...over });
const ledgerLines = d => { try { return readFileSync(join(d, LEDGER_FILE), 'utf8').split('\n').filter(Boolean); } catch { return []; } };
const jsonLines = d => ledgerLines(d).map(l => JSON.parse(l));

function runDir() { const d = mkdtempSync(join(tmpdir(), 'run-cap-gate-')); writeFileSync(join(d, 'cap-screen.md'), SCREEN); return d; }
function capGate(over = {}, extra = {}) {
  const d = runDir();
  const r = gate.requestGate(d, { kind: 'run_cap', textPath: 'cap-screen.md', cap: cap(over), expiresAt: T0 + 30 * 60_000, ...extra }, { now: at(T0) });
  assert.equal(r.ok, true, `request: ${JSON.stringify(r)}`);
  return { d, id: r.gate.id, sha: r.gate.sha256, gate: r.gate };
}
const person = (sha, typedCap, extra = {}) => ({ channel: 'cli', shownSha256: sha, decision: 'approved', actor: 'tester', tty: true, typedCap, ...extra });
const approved = (over = {}, typed = '7.50') => { const g = capGate(over); const a = gate.answerGate(g.d, g.id, person(g.sha, typed), { now: at(T0 + 1000) }); assert.equal(a.ok, true, JSON.stringify(a)); return g; };

test('BACKWARD COMPAT: a gate without `cap` hashes its metadata exactly as release a59bd78 did (fixed digests), so in-flight advice, contract and tree gates stay valid', () => {
  const full = { price: { ceiling_usd: 0.75, expected_usd: 0.4 }, seats: [{ lab: 'openai', retention: '30 days' }], sensitivity: { label: 'public', set_by: 'operator' }, masks: { email: 2 }, follow_up: 'A follow-up.' };
  assert.equal(gate.metaSha256(full), 'e37fcceb6f3df9538ba0f20b7684765a642eb89c745790eab83177a3cdafc9bf');
  assert.equal(gate.metaSha256({ price: null, seats: [], sensitivity: null, masks: {} }), '88836f5c9b5239016e7dbd01ae08da739c8fe2c93b290f2838c83b0996af9798');
});

test('requestGate: a non-finite number anywhere in the metadata is refused as bad_number, never written as the null it becomes in JSON; nothing is appended', () => {
  // JSON writes NaN and Infinity as null, which a cap ceiling ("no ceiling") and a seat value ("unknown") both ACCEPT: the round trip must refuse them first (box-21, 14 Oct 2026).
  const rows = {
    'cap ceiling NaN': { kind: 'run_cap', cap: cap({ ceiling_usd: NaN }) }, 'cap ceiling Infinity': { kind: 'run_cap', cap: cap({ ceiling_usd: Infinity }) }, 'cap ceiling -Infinity': { kind: 'run_cap', cap: cap({ ceiling_usd: -Infinity }) },
    'seat value NaN': { kind: 'advice', seats: [{ lab: 'openai', retention: NaN }] }, 'price ceiling Infinity': { kind: 'advice', price: { ceiling_usd: Infinity } }, 'mask count NaN': { kind: 'advice', masks: { email: NaN } },
  };
  for (const [name, extra] of Object.entries(rows)) {
    const d = runDir();
    const r = gate.requestGate(d, { textPath: 'cap-screen.md', ...extra }, { now: at(T0) });
    assert.deepEqual([r.ok, r.code], [false, 'bad_number'], `${name}: ${JSON.stringify(r).slice(0, 200)}`);
    assert.equal(ledgerLines(d).length, 0, `${name}: nothing was appended`);
  }
  const d = runDir();
  assert.equal(gate.requestGate(d, { kind: 'advice', textPath: 'cap-screen.md', seats: [{ lab: 'openai', retention: null }] }, { now: at(T0) }).ok, true, 'an honest null seat value still passes');
});

test('requestGate: a run_cap gate needs a complete, well-formed pending decision; every other kind refuses `cap`; a refusal appends nothing', () => {
  const bad = {
    missing: undefined, 'extra key': { ...cap(), note: 'x' }, 'no operation': { ...cap(), operation: undefined }, 'operation unknown': cap({ operation: 'launch' }), 'side verb in capitals': cap({ operation: 'side:Replay' }),
    'run id with a slash': cap({ run_id: '../x' }), 'scope not a digest': cap({ scope_sha256: 'abc' }), 'ceiling zero': cap({ ceiling_usd: 0 }), 'ceiling a string': cap({ ceiling_usd: '5' }), 'ceiling negative': cap({ ceiling_usd: -1 }), 'ceiling missing': cap({ ceiling_usd: undefined }),
    'source an object': cap({ ceiling_source: { a: 1 } }), 'source a number': cap({ ceiling_source: 5 }), 'source missing': cap({ ceiling_source: undefined }),
    'ceiling set, source null': cap({ ceiling_source: null }), 'ceiling null, source set': cap({ ceiling_usd: null }),
  };
  for (const [name, c] of Object.entries(bad)) {
    const d = runDir();
    const r = gate.requestGate(d, { kind: 'run_cap', textPath: 'cap-screen.md', cap: c }, { now: at(T0) });
    assert.equal(r.ok, false, `${name}: refused (got ${JSON.stringify(r).slice(0, 200)})`);
    assert.equal(r.code, 'bad_cap', `${name}: code ${r.code}`);
    assert.equal(ledgerLines(d).length, 0, `${name}: nothing was appended`);
  }
  for (const ok of [cap({ ceiling_usd: null, ceiling_source: null }), cap({ operation: 'resume_legacy' }), cap({ operation: 'tree_start' }), cap({ operation: 'side:replay' })]) {
    const d = runDir();
    const r = gate.requestGate(d, { kind: 'run_cap', textPath: 'cap-screen.md', cap: ok }, { now: at(T0) });
    assert.equal(r.ok, true, `${ok.operation} / ceiling ${ok.ceiling_usd}: ${JSON.stringify(r)}`);
  }
  const d = runDir();
  const other = gate.requestGate(d, { kind: 'advice', textPath: 'cap-screen.md', price: { ceiling_usd: 1 }, cap: cap() }, { now: at(T0) });
  assert.deepEqual([other.ok, other.code], [false, 'bad_cap'], `an advice gate takes no cap: ${JSON.stringify(other)}`);
  assert.equal(ledgerLines(d).length, 0);
});

test('SECURITY: an approval without typed text is refused (no bare yes), and so is every text the grammar or the BOUND ceiling refuses; each refusal appends nothing and leaves the gate pending', () => {
  const g = capGate();
  const refusals = [
    [undefined, 'cap_required'], [null, 'cap_required'], [7.5, 'cap_required'],
    ['y', 'cap_format'], ['yes', 'cap_format'], ['', 'cap_empty'], ['   ', 'cap_empty'], ['none', 'cap_unlimited'], ['0', 'cap_zero_paid'], ['7,5', 'cap_comma'], ['1e1', 'cap_format'], ['$5', 'cap_format'],
    ['10.0001', 'cap_above_ceiling'], ['11', 'cap_above_ceiling'], ['999999', 'cap_above_ceiling'], ['1000000', 'cap_too_large'], ['7.123456', 'cap_precision'],
  ];
  for (const [typed, code] of refusals) {
    const a = gate.answerGate(g.d, g.id, person(g.sha, typed), { now: at(T0 + 1000) });
    assert.deepEqual([a.ok, a.code], [false, code], `typed ${JSON.stringify(typed)} -> ${JSON.stringify(a).slice(0, 220)}`);
  }
  assert.equal(ledgerLines(g.d).length, 1, `only the request line: ${ledgerLines(g.d).length}`);
  assert.equal(gate.readGateAnswer(g.d, g.id, { now: at(T0 + 2000) }).status, 'pending');
  const atCeiling = gate.answerGate(g.d, g.id, person(g.sha, '10'), { now: at(T0 + 3000) });
  assert.equal(atCeiling.ok, true, `exactly the ceiling is allowed: ${JSON.stringify(atCeiling)}`);
});

test('SECURITY: the figure written is the parse of the typed text; a figure smuggled in as an argument is ignored (answerGate reads no such argument)', () => {
  const g = capGate();
  const a = gate.answerGate(g.d, g.id, { ...person(g.sha, '5'), capUsd: '999', capMicroUsd: 999_000_000, cap_usd: '999', cap_micro_usd: 999_000_000, ceilingUsd: 100_000 }, { now: at(T0 + 1000) });
  assert.equal(a.ok, true, JSON.stringify(a));
  const line = jsonLines(g.d).find(l => l.event === 'gate_answered');
  assert.deepEqual([line.cap_usd, line.cap_micro_usd], ['5', 5_000_000], `the ledger line: ${JSON.stringify(line)}`);
  const s = gate.readGateAnswer(g.d, g.id, { now: at(T0 + 2000) });
  assert.deepEqual([s.status, s.answer.cap_usd, s.answer.cap_micro_usd, s.gate.answer.cap_usd, s.gate.answer.cap_micro_usd], ['approved', '5', 5_000_000, '5', 5_000_000], `the read: ${JSON.stringify(s.answer)}`);
});

test('the typed amount is normalized and exact in micro-dollars (7.50 -> "7.5"; 0.0001 -> 100); a decline needs no text and writes no figure; typed text with a decline, or on another kind of gate, is refused', () => {
  const g = capGate({ ceiling_usd: null, ceiling_source: null });
  const a = gate.answerGate(g.d, g.id, person(g.sha, '0.0001'), { now: at(T0 + 1000) });
  assert.equal(a.ok, true, JSON.stringify(a));
  const line = jsonLines(g.d).find(l => l.event === 'gate_answered');
  assert.deepEqual([line.cap_usd, line.cap_micro_usd], ['0.0001', 100], JSON.stringify(line));
  const n = capGate();
  assert.deepEqual([gate.answerGate(n.d, n.id, { ...person(n.sha, '3'), decision: 'declined' }, { now: at(T0 + 1000) }).code], ['cap_not_asked'], 'typed text with a decline');
  const dec = gate.answerGate(n.d, n.id, { channel: 'cli', shownSha256: n.sha, decision: 'declined', actor: 't', tty: true }, { now: at(T0 + 1000) });
  assert.equal(dec.ok, true, JSON.stringify(dec));
  const dl = jsonLines(n.d).find(l => l.event === 'gate_answered');
  assert.equal(Object.hasOwn(dl, 'cap_usd') || Object.hasOwn(dl, 'cap_micro_usd'), false, `a decline carries no figure: ${JSON.stringify(dl)}`);
  assert.equal(gate.readGateAnswer(n.d, n.id, { now: at(T0 + 2000) }).status, 'declined');
  const d = runDir();
  const adv = gate.requestGate(d, { kind: 'advice', textPath: 'cap-screen.md', price: { ceiling_usd: 1 } }, { now: at(T0) });
  const wrong = gate.answerGate(d, adv.gate.id, person(adv.gate.sha256, '5'), { now: at(T0 + 1000) });
  assert.deepEqual([wrong.ok, wrong.code], [false, 'cap_not_asked'], `typed text on an advice gate: ${JSON.stringify(wrong)}`);
  assert.equal(gate.answerGate(d, adv.gate.id, { channel: 'cli', shownSha256: adv.gate.sha256, decision: 'approved', actor: 't', tty: true }, { now: at(T0 + 1000) }).ok, true, 'an advice approval is unchanged');
});

test('channels: an elicitation answer records the client name and version; the terminal answer does not; an unknown channel still cannot answer', () => {
  const e = capGate();
  assert.equal(gate.answerGate(e.d, e.id, { channel: 'elicitation', shownSha256: e.sha, decision: 'approved', actor: null, typedCap: '4', client: { name: 'claude-code', version: '9.9' } }, { now: at(T0 + 1000) }).ok, true);
  const el = jsonLines(e.d).find(l => l.event === 'gate_answered');
  assert.deepEqual([el.channel, el.client_name, el.client_version, el.cap_usd], ['elicitation', 'claude-code', '9.9', '4'], JSON.stringify(el));
  const c = capGate();
  gate.answerGate(c.d, c.id, { ...person(c.sha, '4'), client: { name: 'spoof', version: '1' } }, { now: at(T0 + 1000) });
  const cl = jsonLines(c.d).find(l => l.event === 'gate_answered');
  assert.deepEqual([cl.channel, cl.tty, Object.hasOwn(cl, 'client_name')], ['cli', true, false], `a terminal answer carries no client: ${JSON.stringify(cl)}`);
  assert.equal(gate.answerGate(c.d, 'g1', { ...person(c.sha, '4'), channel: 'agent' }, { now: at(T0 + 1000) }).code, 'channel_not_person');
});

test('TAMPER: an edit of the gate file, or of the typed figure in the ledger, reads as invalid - except a consistent edit of both fields on the last line (the known limit)', () => {
  const view = approved();
  const path = join(view.d, 'gates', `${view.id}.json`);
  const rec = JSON.parse(readFileSync(path, 'utf8'));
  writeFileSync(path, JSON.stringify({ ...rec, answer: { ...rec.answer, cap_micro_usd: 9_000_000 } }));
  assert.deepEqual([gate.readGateAnswer(view.d, view.id, { now: at(T0 + 2000) }).status, gate.readGateAnswer(view.d, view.id, { now: at(T0 + 2000) }).reason], ['invalid', 'gate_record_mismatch'], 'the view disagrees with the ledger');
  const ceil = approved();
  const cp = join(ceil.d, 'gates', `${ceil.id}.json`);
  const cr = JSON.parse(readFileSync(cp, 'utf8'));
  writeFileSync(cp, JSON.stringify({ ...cr, cap: { ...cr.cap, ceiling_usd: 1000 } }));
  assert.equal(gate.readGateAnswer(ceil.d, ceil.id, { now: at(T0 + 2000) }).reason, 'gate_record_mismatch', 'the bound ceiling cannot be raised in the gate file');
  const inf = approved();
  const ip = join(inf.d, 'gates', `${inf.id}.json`);
  writeFileSync(ip, readFileSync(ip, 'utf8').replace(/"ceiling_usd":\s*10\b/, '"ceiling_usd": 1e999'));   // JSON.parse reads 1e999 as Infinity
  assert.match(readFileSync(ip, 'utf8'), /1e999/, 'the edit landed');
  assert.equal(gate.readGateAnswer(inf.d, inf.id, { now: at(T0 + 2000) }).reason, 'gate_record_mismatch', 'a ceiling edited to 1e999 reads as a changed record and does not throw');
  const lines = approved();
  const lp = join(lines.d, LEDGER_FILE);
  const all = readFileSync(lp, 'utf8').split('\n').filter(Boolean);
  const last = JSON.parse(all[all.length - 1]);
  const put = over => writeFileSync(lp, `${all.slice(0, -1).join('\n')}\n${JSON.stringify({ ...last, ...over })}\n`);
  put({ cap_micro_usd: 9_000_000 });
  assert.equal(gate.readGateAnswer(lines.d, lines.id, { now: at(T0 + 2000) }).reason, 'gate_record_mismatch', 'figure and dollars no longer agree');
  put({ cap_usd: '99', cap_micro_usd: 99_000_000 });
  assert.equal(gate.readGateAnswer(lines.d, lines.id, { now: at(T0 + 2000) }).reason, 'gate_record_mismatch', 'consistent but above the bound ceiling');
  put({ cap_usd: '9', cap_micro_usd: 9_000_000 });
  const limit = gate.readGateAnswer(lines.d, lines.id, { now: at(T0 + 2000) });
  assert.equal(limit.reason, 'gate_record_mismatch', `the view still says 7.5, so even this edit is caught while the view stands: ${JSON.stringify(limit.reason)}`);
  // KNOWN LIMIT (decided rule 9, said in the gate header): the SAME consistent edit made in the last ledger line AND in the gate file together is not detected.
  const vp = join(lines.d, 'gates', `${lines.id}.json`); const vr = JSON.parse(readFileSync(vp, 'utf8'));
  writeFileSync(vp, JSON.stringify({ ...vr, answer: { ...vr.answer, cap_usd: '9', cap_micro_usd: 9_000_000 } }));
  const both = gate.readGateAnswer(lines.d, lines.id, { now: at(T0 + 2000) });
  assert.deepEqual([both.status, both.answer.cap_micro_usd], ['approved', 9_000_000], `known limit: ${JSON.stringify(both.reason ?? both.answer)}`);
});

test('consumeRunCap: a copied run id and a changed scope are refused and append nothing; the first consume writes cap_consumed with the figure; any second consume fails, even for the same run', () => {
  const g = approved();
  const before = ledgerLines(g.d).length;
  const copied = gate.consumeRunCap(g.d, g.id, { runId: 'run-2', scopeSha256: scopeSha() }, { now: at(T0 + 2000) });
  assert.deepEqual([copied.ok, copied.code], [false, 'cap_copied'], JSON.stringify(copied));
  assert.match(copied.message, /typed for run run-1, not for run run-2/);
  const stale = gate.consumeRunCap(g.d, g.id, { runId: 'run-1', scopeSha256: otherScopeSha() }, { now: at(T0 + 2000) });
  assert.deepEqual([stale.ok, stale.code], [false, 'cap_stale'], JSON.stringify(stale));
  assert.equal(ledgerLines(g.d).length, before, 'neither refusal appended a line');
  const used = gate.consumeRunCap(g.d, g.id, { runId: 'run-1', scopeSha256: scopeSha() }, { now: at(T0 + 2000) });
  assert.deepEqual([used.ok, used.runId, used.capUsd, used.capMicroUsd], [true, 'run-1', '7.5', 7_500_000], JSON.stringify(used));
  const line = jsonLines(g.d).find(l => l.event === 'cap_consumed');
  assert.deepEqual([line.gate, line.run_id, line.cap_micro_usd, line.sha256 === g.sha], [g.id, 'run-1', 7_500_000, true], JSON.stringify(line));
  for (const runId of ['run-1', 'run-2']) {
    const again = gate.consumeRunCap(g.d, g.id, { runId, scopeSha256: scopeSha() }, { now: at(T0 + 3000) });
    assert.deepEqual([again.ok, again.code], [false, 'gate_used'], `second consume for ${runId}: ${JSON.stringify(again)}`);
  }
  assert.equal(jsonLines(g.d).filter(l => l.event === 'cap_consumed').length, 1, 'one use line, ever');
  assert.equal(gate.readGateAnswer(g.d, g.id, { now: at(T0 + 3000) }).usable, false);
});

test('consumeRunCap refuses a pending, declined, expired or foreign-kind gate, and a screen text edited after the approval', () => {
  const pending = capGate();
  assert.equal(gate.consumeRunCap(pending.d, pending.id, { runId: 'run-1', scopeSha256: scopeSha() }, { now: at(T0 + 1000) }).code, 'gate_not_approved');
  const declined = capGate();
  gate.answerGate(declined.d, declined.id, { channel: 'cli', shownSha256: declined.sha, decision: 'declined', actor: 't', tty: true }, { now: at(T0 + 1000) });
  assert.equal(gate.consumeRunCap(declined.d, declined.id, { runId: 'run-1', scopeSha256: scopeSha() }, { now: at(T0 + 2000) }).code, 'gate_not_approved');
  const old = approved();
  assert.equal(gate.consumeRunCap(old.d, old.id, { runId: 'run-1', scopeSha256: scopeSha() }, { now: at(T0 + 31 * 60_000) }).code, 'gate_expired');
  const edited = approved();
  writeFileSync(join(edited.d, 'cap-screen.md'), `${SCREEN}and one more line\n`);
  assert.equal(gate.consumeRunCap(edited.d, edited.id, { runId: 'run-1', scopeSha256: scopeSha() }, { now: at(T0 + 2000) }).code, 'hash_mismatch');
  const d = runDir();
  const adv = gate.requestGate(d, { kind: 'advice', textPath: 'cap-screen.md', price: { ceiling_usd: 1 } }, { now: at(T0) });
  assert.equal(gate.consumeRunCap(d, adv.gate.id, { runId: 'run-1', scopeSha256: scopeSha() }, { now: at(T0 + 1000) }).code, 'not_run_cap');
  for (const g of [pending, declined, old, edited]) assert.equal(jsonLines(g.d).some(l => l.event === 'cap_consumed'), false, 'no use line written');
});

test('RACE: two processes consuming one approval for the same run - exactly one wins, the other sees gate_used; one cap_consumed line', async () => {
  const g = approved();
  const script = `import * as gate from ${JSON.stringify(join(here, '..', 'src', 'gate.js'))};
const r = gate.consumeRunCap(${JSON.stringify(g.d)}, ${JSON.stringify(g.id)}, { runId: 'run-1', scopeSha256: ${JSON.stringify(scopeSha())} }, { now: () => ${T0 + 2000} });
process.stdout.write(JSON.stringify({ ok: r.ok, code: r.code }));`;
  const one = () => new Promise((resolveP, reject) => { const c = spawn(process.execPath, ['--input-type=module', '-e', script]); let out = ''; c.stdout.on('data', x => { out += x; }); c.on('error', reject); c.on('close', () => resolveP(JSON.parse(out))); });
  const results = await Promise.all([one(), one(), one()]);
  assert.deepEqual(results.map(r => r.ok).sort(), [false, false, true], `one winner: ${JSON.stringify(results)}`);
  assert.deepEqual([...new Set(results.filter(r => !r.ok).map(r => r.code))], ['gate_used'], JSON.stringify(results));
  assert.equal(jsonLines(g.d).filter(l => l.event === 'cap_consumed').length, 1);
});

test('runCapAuthority: none for a legacy run; ok after a consume (and for the right run id); fails closed on a copied folder, two uses, a use line that disagrees, an edited screen and a broken ledger', () => {
  const legacy = runDir();
  assert.deepEqual(gate.runCapAuthority(legacy), { status: 'none' });
  const g = approved();
  assert.deepEqual(gate.runCapAuthority(g.d, { runId: 'run-1' }), { status: 'none' }, 'approved but not consumed is no authority yet');
  gate.consumeRunCap(g.d, g.id, { runId: 'run-1', scopeSha256: scopeSha() }, { now: at(T0 + 2000) });
  const ok = gate.runCapAuthority(g.d, { runId: 'run-1', now: at(T0 + 3000) });
  assert.deepEqual({ ...ok, seq: undefined }, { status: 'ok', gate: g.id, runId: 'run-1', operation: 'start', capUsd: '7.5', capMicroUsd: 7_500_000, channel: 'cli', actor: 'tester', seq: undefined, scopeSha256: scopeSha(), consumptions: 1 }, JSON.stringify(ok));
  assert.deepEqual(gate.runCapAuthority(g.d, { runId: 'run-9' }), { status: 'invalid', reason: 'cap_copied' }, 'a folder copied or moved carries the original run id');
  assert.equal(gate.runCapAuthority(g.d).status, 'ok', 'with no run id given the check is the record only');
  // T4b: a SECOND `start` for the same run is refused by consumeRunCap itself (a later consumption is a raise or an amendment) and appends nothing; a forged second line (written through the ledger API, chained) reads invalid
  const second = gate.requestGate(g.d, { kind: 'run_cap', textPath: 'cap-screen.md', cap: cap(), expiresAt: T0 + 30 * 60_000 }, { now: at(T0 + 4000) });
  gate.answerGate(g.d, second.gate.id, person(second.gate.sha256, '3'), { now: at(T0 + 5000) });
  const refusedSecond = gate.consumeRunCap(g.d, second.gate.id, { runId: 'run-1', scopeSha256: scopeSha() }, { now: at(T0 + 6000) });
  assert.deepEqual([refusedSecond.ok, refusedSecond.code], [false, 'cap_sequence']);
  assert.equal(jsonLines(g.d).filter(l => l.event === 'cap_consumed').length, 1, 'nothing appended by the refusal');
  withLedger(g.d, ({ append }) => append('cap_consumed', { gate: second.gate.id, sha256: second.gate.sha256, run_id: 'run-1', cap_micro_usd: 3_000_000 }));
  assert.deepEqual(gate.runCapAuthority(g.d, { runId: 'run-1' }), { status: 'invalid', reason: 'cap_sequence' }, 'a later `start` is invalid');
  // a use line that disagrees with its gate (the last line edited)
  const m = approved(); gate.consumeRunCap(m.d, m.id, { runId: 'run-1', scopeSha256: scopeSha() }, { now: at(T0 + 2000) });
  const lp = join(m.d, LEDGER_FILE); const all = readFileSync(lp, 'utf8').split('\n').filter(Boolean); const last = JSON.parse(all[all.length - 1]);
  writeFileSync(lp, `${all.slice(0, -1).join('\n')}\n${JSON.stringify({ ...last, cap_micro_usd: 1 })}\n`);
  assert.deepEqual(gate.runCapAuthority(m.d), { status: 'invalid', reason: 'cap_record_mismatch' });
  const e = approved(); gate.consumeRunCap(e.d, e.id, { runId: 'run-1', scopeSha256: scopeSha() }, { now: at(T0 + 2000) });
  writeFileSync(join(e.d, 'cap-screen.md'), `${SCREEN}changed\n`);
  assert.deepEqual(gate.runCapAuthority(e.d), { status: 'invalid', reason: 'hash_mismatch' });
  const b = approved(); gate.consumeRunCap(b.d, b.id, { runId: 'run-1', scopeSha256: scopeSha() }, { now: at(T0 + 2000) });
  const bp = join(b.d, LEDGER_FILE); const bl = readFileSync(bp, 'utf8').split('\n').filter(Boolean);
  writeFileSync(bp, `${bl[0].replace('"gate_requested"', '"gate_requested_x"')}\n${bl.slice(1).join('\n')}\n`);
  assert.deepEqual(gate.runCapAuthority(b.d), { status: 'invalid', reason: 'gate_ledger_corrupt' });
});

test('capScopeSha256: key order does not matter, any value change does; a run_cap gate edited to a different scope reads invalid', () => {
  assert.equal(gate.capScopeSha256({ a: 1, b: { c: [1, 2], d: null } }), gate.capScopeSha256({ b: { d: null, c: [1, 2] }, a: 1 }));
  assert.notEqual(gate.capScopeSha256({ a: 1 }), gate.capScopeSha256({ a: 2 }));
  assert.match(gate.capScopeSha256(SCOPE), /^[0-9a-f]{64}$/);
  for (const v of [NaN, Infinity, -Infinity]) assert.throws(() => gate.capScopeSha256({ ceiling_usd: v }), /not a finite number/, `${v} would hash like null (no ceiling)`);
  assert.notEqual(gate.capScopeSha256({ ceiling_usd: null }), gate.capScopeSha256({ ceiling_usd: 10 }));
  const g = capGate();
  const p = join(g.d, 'gates', `${g.id}.json`); const r = JSON.parse(readFileSync(p, 'utf8'));
  writeFileSync(p, JSON.stringify({ ...r, cap: { ...r.cap, scope_sha256: 'f'.repeat(64) } }));
  assert.equal(gate.readGateAnswer(g.d, g.id, { now: at(T0 + 1000) }).reason, 'gate_record_mismatch');
});

// ---- T4b1 (14 Oct 2026): a run's limit after the first one: raise and amend_scope -------------------------------------------------------------------------------------------------------------------------------
// One typed limit still has ONE spender (a gate is consumed once); a RUN may carry a sequence of consumptions and its limit in force is the LAST. Every row below goes through the public functions; the invalid sequences that the
// public functions refuse are forged through the ledger API (chained lines, as a buggy or hostile writer with the account's rights could) to prove the READER fails closed too.
let tick = 10_000;
function addGate(d, operation, typed, over = {}) {
  // a ceiling of 100 so the totals typed below (up to 15) are inside it: the ceiling is not what these rows test
  const r = gate.requestGate(d, { kind: 'run_cap', textPath: 'cap-screen.md', cap: cap({ operation, ceiling_usd: 100, ...over }), expiresAt: T0 + 60 * 60_000 }, { now: at(T0 + (tick += 10)) });
  assert.equal(r.ok, true, JSON.stringify(r));
  const a = gate.answerGate(d, r.gate.id, person(r.gate.sha256, typed), { now: at(T0 + (tick += 10)) });
  assert.equal(a.ok, true, JSON.stringify(a));
  return r.gate;
}
const consume = (d, g, extra = {}) => gate.consumeRunCap(d, g.id, { runId: 'run-1', scopeSha256: scopeSha(), ...extra }, { now: at(T0 + (tick += 10)) });

test('T4b1: start -> raise -> amend_scope is one valid sequence; the limit in force is the LAST total; each gate is consumed once', () => {
  const d = runDir();
  const g1 = addGate(d, 'start', '7.50'); assert.equal(consume(d, g1).ok, true);
  const g2 = addGate(d, 'raise', '12'); assert.equal(consume(d, g2, { committedMicroUsd: 7_500_000 }).ok, true);
  let a = gate.runCapAuthority(d, { runId: 'run-1' });
  assert.deepEqual([a.status, a.operation, a.capUsd, a.consumptions, a.gate], ['ok', 'raise', '12', 2, g2.id]);
  const g3 = addGate(d, 'amend_scope', '9.25'); assert.equal(consume(d, g3, { committedMicroUsd: 8_000_000 }).ok, true);
  a = gate.runCapAuthority(d, { runId: 'run-1' });
  assert.deepEqual([a.status, a.operation, a.capUsd, a.capMicroUsd, a.consumptions], ['ok', 'amend_scope', '9.25', 9_250_000, 3], 'a LOWER total above the floor is allowed: the last consumption wins');
  assert.equal(consume(d, g2).code, 'gate_used', 'one typed limit, one spender: a gate is never consumed twice');
  assert.equal(jsonLines(d).filter(l => l.event === 'cap_consumed').length, 3);
});

test('T4b1: consumeRunCap refuses an invalid sequence or a total not above the floor, and appends nothing', () => {
  const lines = d => jsonLines(d).length;
  const first = runDir(); const r1 = addGate(first, 'raise', '10'); const n1 = lines(first);
  assert.deepEqual([consume(first, r1).ok, consume(first, r1).code], [false, 'cap_sequence'], 'the first consumption is never a raise (nothing to raise)'); assert.equal(lines(first), n1);
  const d = runDir(); const g1 = addGate(d, 'start', '7.50'); consume(d, g1);
  const again = addGate(d, 'start', '3'); const n = lines(d);
  assert.deepEqual([consume(d, again).ok, consume(d, again).code], [false, 'cap_sequence'], 'a later `start` is invalid'); assert.equal(lines(d), n);
  const low = addGate(d, 'raise', '7'); const n2 = lines(d);
  assert.equal(consume(d, low, { committedMicroUsd: 7_500_000 }).code, 'below_exposure'); assert.equal(lines(d), n2);
  const equal = addGate(d, 'raise', '7.5'); assert.equal(consume(d, equal, { committedMicroUsd: 7_500_000 }).code, 'below_exposure', 'equal to the floor is not above it');
  const ok = addGate(d, 'raise', '7.5001'); assert.equal(consume(d, ok, { committedMicroUsd: 7_500_000 }).ok, true);
  // a gate requested BEFORE the previous consumption and used late asks about a state of the run that is gone
  const e = runDir(); const s1 = addGate(e, 'start', '5'); const early = addGate(e, 'raise', '9'); assert.equal(consume(e, s1).ok, true);
  const n3 = lines(e); assert.equal(consume(e, early).code, 'cap_sequence_stale'); assert.equal(lines(e), n3);
  const late = addGate(e, 'raise', '9'); assert.equal(consume(e, late).ok, true, 'a gate requested after the last consumption is fine');
});

test('T4b1: runCapAuthority fails closed on forged sequences: a first raise, a later start, a repeated gate, a stale gate, a line for another run, an edited middle gate', () => {
  const forge = (d, g, over = {}) => withLedger(d, ({ append }) => append('cap_consumed', { gate: g.id, sha256: g.sha256, run_id: 'run-1', cap_micro_usd: Math.round(Number(g.capTyped) * 1e6), ...over }));
  const typed = (d, op, t) => { const g = addGate(d, op, t); g.capTyped = t; return g; };
  const firstRaise = runDir(); forge(firstRaise, typed(firstRaise, 'raise', '4'));
  assert.deepEqual(gate.runCapAuthority(firstRaise, { runId: 'run-1' }), { status: 'invalid', reason: 'cap_sequence' }, 'a first consumption that is a raise');
  const laterStart = runDir(); const a = typed(laterStart, 'start', '5'); consume(laterStart, a); forge(laterStart, typed(laterStart, 'start', '3'));
  assert.deepEqual(gate.runCapAuthority(laterStart, { runId: 'run-1' }), { status: 'invalid', reason: 'cap_sequence' }, 'a later start');
  const repeated = runDir(); const r0 = typed(repeated, 'start', '5'); consume(repeated, r0); forge(repeated, r0);
  assert.deepEqual(gate.runCapAuthority(repeated, { runId: 'run-1' }), { status: 'invalid', reason: 'cap_consumed_more_than_once' }, 'a repeated gate');
  const stale = runDir(); const s0 = typed(stale, 'start', '5'); const early = typed(stale, 'raise', '9'); consume(stale, s0); forge(stale, early);
  assert.deepEqual(gate.runCapAuthority(stale, { runId: 'run-1' }), { status: 'invalid', reason: 'cap_sequence_stale' }, 'a gate requested before the previous consumption');
  const other = runDir(); const o0 = typed(other, 'start', '5'); consume(other, o0); const o1 = typed(other, 'raise', '9'); forge(other, o1, { run_id: 'run-2' });
  assert.equal(gate.runCapAuthority(other).status, 'invalid', 'a consumption line for another run');
  const edited = runDir(); const e0 = typed(edited, 'start', '5'); consume(edited, e0); const e1 = typed(edited, 'raise', '9'); consume(edited, e1);
  writeFileSync(join(edited, 'gates', `${e0.id}.json`), readFileSync(join(edited, 'gates', `${e0.id}.json`), 'utf8').replace('"operation": "start"', '"operation": "raise"'));
  assert.equal(gate.runCapAuthority(edited, { runId: 'run-1' }).status, 'invalid', 'an edited earlier gate file');
});
