// authorizeStart: finding or asking for the typed limit at the start of a run (0.8.3 M6 typed cap T4a; T4 start-path page section 3, the decision order). Real gate files and ledgers in a temp folder, no model, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { authorizeStart, CAP_GATE_TTL_MS, MAX_LIMIT_SCREENS } from '../src/start-cap.js';
import { capScopeSha256 } from '../src/gate.js';
import { answerGate, readGateAnswer, runCapAuthority } from '../src/gate.js';
import { LEDGER_FILE } from '../src/gate-ledger.js';
import { runResumability, deriveRunStatus, awaitingUserCap } from '../src/run-status.js';

const T0 = Date.parse('2026-10-14T12:00:00.000Z');
let clock = T0;
const now = () => clock;
// The status readers (deriveRunStatus, runResumability, awaitingUserCap) take no clock argument and read Date.now(); a gate's expiry is judged against it, so a test that pins T0 to a past date would see every gate EXPIRED once the real clock passed T0 + the TTL (it did, on 16 Okt 2026). The test's clock is injected for the call, never a moved date.
const asOf = fn => { const real = Date.now; Date.now = now; try { return fn(); } finally { Date.now = real; } };
const scopeA = createHash('sha256').update('scope-a').digest('hex');
const scopeB = createHash('sha256').update('scope-b').digest('hex');
const SCREEN = 'SCREEN: type your limit.\n';
const ledger = d => readFileSync(join(d, LEDGER_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
function folder() { clock = T0; const base = mkdtempSync(join(tmpdir(), 'start-cap-')); const d = join(base, 'run-1'); mkdirSync(d); return d; }
const call = (d, over = {}) => authorizeStart({ runDir: d, runId: 'run-1', resume: false, scopeSha256: scopeA, screenText: SCREEN, ceiling: { usd: 10, source: 'COUNCIL_MAX_USD_LIMIT' }, interactive: false, ask: async () => 1, now, ...over });
// the person answering from another terminal: the same answerGate the terminal form calls
function person(d, gateId, typed) {
  const g = readGateAnswer(d, gateId, { now }).gate;
  return answerGate(d, gateId, { channel: 'cli', shownSha256: g.sha256, decision: 'approved', actor: 'tester', tty: true, typedCap: typed }, { now });
}

test('a start with no limit waits: one gate, the screen written to the run folder, a second call shows the SAME gate and appends nothing; no limit is invented', async () => {
  const d = folder();
  const a = await call(d);
  assert.deepEqual([a.status, a.gate], ['pending', 'g1']);
  const linesAfterFirst = ledger(d).length;
  const b = await call(d);
  assert.deepEqual([b.status, b.gate], ['pending', 'g1'], 'the same gate, not a second one');
  assert.equal(ledger(d).length, linesAfterFirst, 'nothing appended by the second call');
  const g = readGateAnswer(d, 'g1', { now }).gate;
  assert.deepEqual([g.kind, g.cap.operation, g.cap.run_id, g.cap.scope_sha256, g.cap.ceiling_usd, g.cap.ceiling_source], ['run_cap', 'start', 'run-1', scopeA, 10, 'COUNCIL_MAX_USD_LIMIT']);
  assert.equal(readFileSync(join(d, g.text), 'utf8'), SCREEN);
  assert.equal(Date.parse(g.expires_at), T0 + CAP_GATE_TTL_MS);
  assert.equal(runCapAuthority(d).status, 'none', 'no limit was consumed');
  // the status readers know a run that waits for its limit (a client sees the state, not a crashed run)
  assert.equal(asOf(() => deriveRunStatus(d, null)), 'awaiting_user_cap');
  const res = asOf(() => runResumability(d, null));
  assert.deepEqual([res.status, res.resumable, res.reason, res.needs, res.gate], ['awaiting_user_cap', true, 'awaiting_user_cap', 'type_limit', 'g1']);
});

test('answered elsewhere, then the next start consumes it once; every later start continues under it with no second consume', async () => {
  const d = folder();
  await call(d);
  assert.equal(person(d, 'g1', '7.50').ok, true);
  const first = await call(d);
  assert.deepEqual([first.status, first.via, first.capUsd, first.capMicroUsd], ['authorized', 'answered', 7.5, 7_500_000]);
  const second = await call(d);
  assert.deepEqual([second.status, second.via, second.capUsd], ['authorized', 'continued', 7.5]);
  assert.equal(ledger(d).filter(l => l.event === 'cap_consumed').length, 1, 'exactly one consume');
  // a resume after the task, the chain or the settings changed does NOT continue under a limit typed for the old screen: it refuses (a run consumes once, so it cannot be asked again)
  // T4b2: a resume after the task, the chain or the settings changed asks a NEW question (an amend_scope gate), it does not end the run
  const changed = await call(d, { scopeSha256: scopeB });
  assert.deepEqual([changed.status, changed.gate], ['pending', 'g2']);
  assert.equal(readGateAnswer(d, 'g2', { now }).gate.cap.operation, 'amend_scope');
  assert.equal(ledger(d).filter(l => l.event === 'cap_consumed').length, 1, 'nothing more was consumed');
});

test('interactive: the person types in this process; a refused entry leaves the gate pending (no limit), a good one is consumed at once', async () => {
  const d = folder();
  const asked = [];
  const refuse = await call(d, { interactive: true, ask: async (dir, id) => { asked.push(id); return person(dir, id, '99').ok ? 0 : 1; } });   // above the ceiling of 10
  assert.deepEqual([refuse.status, refuse.gate, asked], ['pending', 'g1', ['g1']]);
  const good = await call(d, { interactive: true, ask: async (dir, id) => { asked.push(id); return person(dir, id, '4.25').ok ? 0 : 1; } });
  assert.deepEqual([good.status, good.via, good.capUsd, asked], ['authorized', 'answered', 4.25, ['g1', 'g1']], 'the SAME gate was asked again, not a new one');
});

test('a limit typed for another scope is never consumed: the scope changed, so a NEW gate is requested and the old approval is left alone', async () => {
  const d = folder();
  await call(d);
  person(d, 'g1', '5');
  const changed = await call(d, { scopeSha256: scopeB });
  assert.deepEqual([changed.status, changed.gate], ['pending', 'g2']);
  assert.equal(ledger(d).filter(l => l.event === 'cap_consumed').length, 0, 'the old approval was not used');
  assert.equal(readGateAnswer(d, 'g1', { now }).status, 'approved', 'the old gate is untouched');
  assert.deepEqual(readdirSync(d).filter(f => f.startsWith('cap-screen')).sort(), ['cap-screen-1.md', 'cap-screen-2.md'], 'each gate keeps its own screen bytes');
});

test('an expired gate gets a new one; a declined gate gets a new one', async () => {
  const d = folder();
  await call(d);
  clock = T0 + CAP_GATE_TTL_MS + 1000;
  const again = await call(d);
  assert.deepEqual([again.status, again.gate], ['pending', 'g2'], 'expired -> new gate');
  const g = readGateAnswer(d, 'g2', { now }).gate;
  assert.equal(answerGate(d, 'g2', { channel: 'cli', shownSha256: g.sha256, decision: 'declined', actor: 'tester', tty: true }, { now }).ok, true);
  const after = await call(d);
  assert.deepEqual([after.status, after.gate], ['pending', 'g3'], 'declined -> new gate');
});

test('a folder copied from another run id is refused, not given a limit; a legacy resume asks for a typed total with its own operation', async () => {
  const d = folder();
  await call(d);
  person(d, 'g1', '5');
  assert.equal((await call(d)).status, 'authorized');
  const copied = await call(d, { runId: 'run-2' });
  assert.deepEqual([copied.status, copied.code], ['refused', 'cap_copied']);
  const legacy = folder();
  const l = await call(legacy, { resume: true });
  assert.equal(readGateAnswer(legacy, l.gate, { now }).gate.cap.operation, 'resume_legacy', 'a resume with no run_cap gate on record is a legacy run');
  clock = T0 + CAP_GATE_TTL_MS + 1000;
  const l2 = await call(legacy, { resume: true });
  assert.equal(readGateAnswer(legacy, l2.gate, { now }).gate.cap.operation, 'start', 'a resume whose own gate expired asks again as start, NOT as legacy: a pending gate is never misread as a legacy run');
});

test('no ceiling in force: the gate carries both ceiling fields null (the pairing rule), and a limit can still be typed', async () => {
  const d = folder();
  const p = await call(d, { ceiling: null });
  const g = readGateAnswer(d, p.gate, { now }).gate;
  assert.deepEqual([g.cap.ceiling_usd, g.cap.ceiling_source], [null, null]);
  assert.equal(person(d, p.gate, '250').ok, true);
  assert.equal((await call(d, { ceiling: null })).capUsd, 250);
});

test('a broken ledger fails closed: nothing is started and no limit is invented', async () => {
  const d = folder();
  await call(d);
  const lp = join(d, LEDGER_FILE);
  const text = readFileSync(lp, 'utf8');
  await import('node:fs').then(fs => fs.writeFileSync(lp, `${text}not json\n`));
  const r = await call(d);
  assert.equal(r.status, 'refused');
});

test('the ceiling in force NOW: a TIGHTER one sets the typed limit aside and asks again under it (a NEW gate, never a lock); a looser or a missing one lets the typed limit stand', async () => {
  const d = folder();
  await call(d);                                   // asked under a ceiling of 10
  person(d, 'g1', '8');
  const tight = { usd: 5, source: 'COUNCIL_MAX_USD_LIMIT' };
  const lowered = await call(d, { ceiling: tight });
  assert.deepEqual([lowered.status, lowered.gate, lowered.note?.code], ['pending', 'g2', 'above_ceiling_now']);
  assert.match(lowered.note.message, /\$8.*\$5.*COUNCIL_MAX_USD_LIMIT/);
  assert.equal(readGateAnswer(d, 'g2', { now }).gate.cap.ceiling_usd, 5, 'the new gate is bound to the ceiling now in force');
  assert.equal(ledger(d).filter(l => l.event === 'cap_consumed').length, 0, 'nothing was consumed');
  const again = await call(d, { ceiling: tight });
  assert.deepEqual([again.status, again.gate], ['pending', 'g2'], 'the next start under the same ceiling shows g2, NOT the same refusal and not a g3');
  assert.equal(person(d, 'g2', '4').ok, true);
  const ok = await call(d, { ceiling: tight });
  assert.deepEqual([ok.status, ok.capUsd, ok.gate], ['authorized', 4, 'g2'], 'the old g1 approval was never used');
  const loose = folder();
  await call(loose); person(loose, 'g1', '8');
  const looser = await call(loose, { ceiling: { usd: 500, source: 'COUNCIL_MAX_USD_LIMIT' } });
  assert.deepEqual([looser.status, looser.capUsd], ['authorized', 8], 'a looser ceiling: the typed amount stands');
  const missing = folder();
  await call(missing); person(missing, 'g1', '8');
  assert.deepEqual([(await call(missing, { ceiling: null })).capUsd], [8], 'no ceiling now: the typed amount stands');
});

test('a PENDING gate asked under a higher ceiling is replaced when a lower one is now in force (its screen showed the old ceiling)', async () => {
  const d = folder();
  await call(d);                                   // g1 pending under 10
  const r = await call(d, { ceiling: { usd: 3, source: 'max_usd' } });
  assert.deepEqual([r.status, r.gate], ['pending', 'g2']);
  assert.equal(readGateAnswer(d, 'g2', { now }).gate.cap.ceiling_usd, 3);
});
test('the screens are bounded: a ceiling that keeps getting lower ends, after MAX_LIMIT_SCREENS gates, in a plain refusal that points at a new run (a pending gate under the current ceiling is always shown again)', async () => {
  const d = folder();
  let last;
  for (let i = 0; i < MAX_LIMIT_SCREENS; i++) last = await call(d, { ceiling: { usd: 100 - i, source: 'COUNCIL_MAX_USD_LIMIT' } });   // each call is a lower ceiling than the gate before: a new gate each time
  assert.deepEqual([last.status, last.gate], ['pending', `g${MAX_LIMIT_SCREENS}`]);
  const again = await call(d, { ceiling: { usd: 100 - MAX_LIMIT_SCREENS + 1, source: 'COUNCIL_MAX_USD_LIMIT' } });
  assert.deepEqual([again.status, again.gate], ['pending', `g${MAX_LIMIT_SCREENS}`], 'the live gate is shown again, not refused');
  const over = await call(d, { ceiling: { usd: 50, source: 'COUNCIL_MAX_USD_LIMIT' } });
  assert.deepEqual([over.status, over.code], ['refused', 'too_many_limit_screens']);
  assert.match(over.message, /Start a new run/);
});

// ---- T4b2: a run's limit after the first one -------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const objA = { task_sha256: 'a'.repeat(64), chain_sha256: 'c'.repeat(64), seats: [], policy_sha256: null };
const objB = { ...objA, chain_sha256: 'd'.repeat(64), policy_sha256: 'e'.repeat(64) };
const shaOf = o => capScopeSha256(o);
const bigCeiling = { usd: 1000, source: 'COUNCIL_MAX_USD_LIMIT' };
const screens = [];
const callT = (d, over = {}) => authorizeStart({ runDir: d, runId: 'run-1', resume: true, scopeSha256: shaOf(objA), scope: objA, buildScreen: (kind, { history }) => { screens.push({ kind, history }); return `SCREEN ${kind}\n`; }, ceiling: bigCeiling, interactive: false, ask: async () => 1, now, ...over });
async function firstLimit(d, typed = '5') { await callT(d, { resume: false }); person(d, 'g1', typed); const r = await callT(d, { resume: false }); assert.equal(r.status, 'authorized', JSON.stringify(r)); return r; }

test('T4b2 AMEND: a changed scope after the first limit opens an amend_scope screen that NAMES what changed (from cap-scope-<n>.json); the new total is consumed above the floor and the run continues under it', async () => {
  const d = folder(); screens.length = 0;
  await firstLimit(d, '5');
  const hist = () => ({ spentUsd: 3, floorUsd: 3, unsettledUsd: 0.5, stopped: null });
  const p = await callT(d, { scopeSha256: shaOf(objB), scope: objB, history: hist });
  assert.deepEqual([p.status, p.gate], ['pending', 'g2']);
  const amend = screens.at(-1);
  assert.equal(amend.kind, 'amend'); assert.deepEqual(amend.history.changed, ['the chain file', 'the policy file']); assert.equal(amend.history.previousCapUsd, 5);
  assert.equal(readGateAnswer(d, 'g2', { now }).gate.cap.operation, 'amend_scope');
  assert.equal(person(d, 'g2', '9').ok, true);
  const ok = await callT(d, { scopeSha256: shaOf(objB), scope: objB, history: hist });
  assert.deepEqual([ok.status, ok.via, ok.capUsd, ok.operation], ['authorized', 'answered', 9, 'amend_scope']);
  assert.equal(ledger(d).filter(l => l.event === 'cap_consumed').length, 2);
  const again = await callT(d, { scopeSha256: shaOf(objB), scope: objB, history: hist });
  assert.deepEqual([again.status, again.via, again.capUsd], ['authorized', 'continued', 9]);
  // the earlier scope object is gone or altered: the screen still opens and says it cannot be shown
  const e = folder(); screens.length = 0; await firstLimit(e, '5');
  const f = join(e, 'cap-scope-1.json'); writeFileSync(f, JSON.stringify({ ...objA, task_sha256: 'f'.repeat(64) }));
  await callT(e, { scopeSha256: shaOf(objB), scope: objB, history: hist });
  assert.equal(screens.at(-1).history.changed, null);
});

test('T4b2 RAISE: a budget stop AT the active limit opens a raise screen (history from the stop file); an OLD stop (another total) does not; the raised total is the one in force', async () => {
  const d = folder(); screens.length = 0;
  await firstLimit(d, '5');
  const stopped = { stopped: { capUsd: 5 }, spentUsd: 5.5, floorUsd: 5.5, suggestedUsd: 6.1, projectedStageUsd: 0.6, unsettledUsd: 0 };
  const p = await callT(d, { history: () => stopped });
  assert.deepEqual([p.status, p.gate], ['pending', 'g2']); assert.equal(screens.at(-1).kind, 'raise');
  assert.equal(readGateAnswer(d, 'g2', { now }).gate.cap.operation, 'raise');
  assert.equal(person(d, 'g2', '8').ok, true);
  const ok = await callT(d, { history: () => stopped });
  assert.deepEqual([ok.status, ok.capUsd, ok.operation], ['authorized', 8, 'raise']);
  const later = await callT(d, { history: () => stopped });
  assert.deepEqual([later.status, later.via, later.capUsd], ['authorized', 'continued', 8], 'the stop file of the OLD total (5) does not ask again');
});

test('T4b2: a typed total NOT ABOVE the floor is set aside with a note and a NEW gate asks again (never a locked gate); above the floor it is consumed', async () => {
  const d = folder(); await firstLimit(d, '5');
  const hist = { stopped: { capUsd: 5 }, spentUsd: 5.5, floorUsd: 5.5, projectedStageUsd: 0.6, suggestedUsd: 6.1, unsettledUsd: 0 };
  await callT(d, { history: () => hist });
  person(d, 'g2', '5.5');                                       // equal to the floor: not above it
  const r = await callT(d, { history: () => hist });
  assert.deepEqual([r.status, r.gate, r.note?.code], ['pending', 'g3', 'below_floor']);
  assert.equal(ledger(d).filter(l => l.event === 'cap_consumed').length, 1, 'nothing consumed');
  person(d, 'g3', '6.5');
  const ok = await callT(d, { history: () => hist });
  assert.deepEqual([ok.status, ok.capUsd, ok.gate], ['authorized', 6.5, 'g3']);
});

test('T4b2 LEGACY: a resume of a run with no limit gate at all gets a legacy screen with what was already spent (one number, split in two) and its own operation', async () => {
  const d = folder(); screens.length = 0;
  const r = await callT(d, { history: () => ({ spentUsd: 4.2, floorUsd: 4.2, unsettledUsd: 0.7, stopped: null }) });
  assert.equal(r.status, 'pending'); assert.equal(screens.at(-1).kind, 'legacy'); assert.equal(screens.at(-1).history.spentUsd, 4.2);
  assert.equal(readGateAnswer(d, r.gate, { now }).gate.cap.operation, 'resume_legacy');
  person(d, r.gate, '4.2');                                      // not above what it already spent
  const again = await callT(d, { history: () => ({ spentUsd: 4.2, floorUsd: 4.2, unsettledUsd: 0.7, stopped: null }) });
  assert.deepEqual([again.status, again.note?.code], ['pending', 'below_floor']);
});

test('T4b2: the screens are counted SINCE THE LAST CONSUMPTION - answered raises and amendments do not use them up', async () => {
  const d = folder();
  let last;
  for (let i = 0; i < MAX_LIMIT_SCREENS; i++) last = await callT(d, { resume: false, ceiling: { usd: 100 - i, source: 'COUNCIL_MAX_USD_LIMIT' } });
  assert.equal(last.gate, `g${MAX_LIMIT_SCREENS}`);
  person(d, last.gate, '5');
  const ok = await callT(d, { resume: false, ceiling: { usd: 100 - MAX_LIMIT_SCREENS + 1, source: 'COUNCIL_MAX_USD_LIMIT' } });
  assert.equal(ok.status, 'authorized', JSON.stringify(ok));
  const amend = await callT(d, { scopeSha256: shaOf(objB), scope: objB, history: () => ({ spentUsd: 1, floorUsd: 1 }) });
  assert.deepEqual([amend.status, amend.gate], ['pending', `g${MAX_LIMIT_SCREENS + 1}`], 'five screens before the first limit do not forbid the next question');
});

test('T4b2: run_status / runResumability see a PENDING raise or amend gate requested after the last consumption (the first limit alone is not "waiting"); the MCP exit-21 result keeps its decision', async () => {
  const d = folder(); await firstLimit(d, '5');
  assert.equal(asOf(() => awaitingUserCap(d)), null, 'a consumed first limit and nothing pending: not waiting');
  assert.notEqual(asOf(() => deriveRunStatus(d, null)), 'awaiting_user_cap');
  await callT(d, { scopeSha256: shaOf(objB), scope: objB, history: () => ({ spentUsd: 1, floorUsd: 1 }) });
  assert.deepEqual(asOf(() => awaitingUserCap(d)), { gate: 'g2' });
  assert.equal(asOf(() => deriveRunStatus(d, null)), 'awaiting_user_cap');
  const res = asOf(() => runResumability(d, null));
  assert.deepEqual([res.status, res.needs, res.gate], ['awaiting_user_cap', 'type_limit', 'g2']);
  person(d, 'g2', '9'); await callT(d, { scopeSha256: shaOf(objB), scope: objB, history: () => ({ spentUsd: 1, floorUsd: 1 }) });
  assert.equal(asOf(() => awaitingUserCap(d)), null, 'after the amended limit is consumed nothing waits');
});

test('T4c: the notes that set a typed limit aside print every figure through formatUsd (a floor of 0.1 + 0.2 reads $0.3000, never $0.30000000000000004; a ceiling of 8.5 reads $8.50)', async () => {
  const d = folder(); await firstLimit(d, '5');
  const hist = { stopped: { capUsd: 5 }, spentUsd: 0.1 + 0.2, floorUsd: 0.1 + 0.2, projectedStageUsd: 0.6, suggestedUsd: 6.1, unsettledUsd: 0 };
  await callT(d, { history: () => hist });
  person(d, 'g2', '0.3');                                       // the floor, to the cent: not above it
  const r = await callT(d, { history: () => hist });
  assert.equal(r.note?.code, 'below_floor');
  assert.equal(r.note.message, 'the limit typed for this run ($0.3000) is not above what the run has already counted ($0.3000), so it was not used. Nothing was started.');
  const e = folder(); await call(e);                            // asked under a ceiling of 10
  person(e, 'g1', '9');
  const lowered = await call(e, { ceiling: { usd: 8.5, source: 'COUNCIL_MAX_USD_LIMIT' } });
  assert.equal(lowered.note?.code, 'above_ceiling_now');
  assert.equal(lowered.note.message, 'the limit typed for this run ($9.00) is above the ceiling now in force ($8.50, set by COUNCIL_MAX_USD_LIMIT), so it was not used. Nothing was started.');
});
