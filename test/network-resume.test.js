// Network-error resume (0.8.4, cost side, unit 0). His decision 9 of 28 Okt 2026: "Yes, up to 3, counted and bounded. BUT: expected-case not maximum-case cost"; the pilot's rule "resume up to 3 times"; C&C's ruling of 04 Nov 2026: the three are
// PER RUN (every stage, label and re-ask of the run share them; a resume a person starts does not refill them), and the failure after the third stops the run instead of becoming a judge's re-ask.
// A call that failed in transit AFTER the request went out (a reset, a dropped body: possibly billed) is asked again inside invoke() while the run has resumes left. Every attempt goes through the cap
// gate, has its own reservation on disk BEFORE it is sent and its own settlement, and a failed attempt is its own charge record: the counted amount holds each paid attempt exactly once.
// Charges: in an auto-resumed call a failed attempt that carries no usage figure is charged at the call's expected cost (plan A T6.1 / his pick "Both figures"); a call the dry run does not plan at a typical size for what it writes (unit 3, D43).
// Every "is not asked again" test first proves, in the same test, that a dropped connection IS asked again (the control), so it cannot pass just because nothing is ever resumed.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSingleStage, runChain, setBudget, setCache, setPromptSpy, setReservationSink, setChargeHook, budgetState } from '../src/chain.js';
import { openReservations, RESERVATIONS_FILE } from '../src/spend-reservations.js';
import { recordLostCharge, supersededStagesOf } from '../src/superseded.js';
import { filesReadForFigure } from '../src/tree-budget.js';
import { runSpentUsd, spendReport } from '../src/spend.js';
import { setRetrySleep, setRequestDeadline } from '../src/providers.js';
import { priceOf } from '../src/cost.js';

const dir = () => mkdtempSync(join(tmpdir(), 'thc-netres-'));
const lines = d => readFileSync(join(d, RESERVATIONS_FILE), 'utf8').trimEnd().split('\n').map(l => JSON.parse(l));
// The resumes a run folder records: the charge files that name one. Counted here, not by the function under test.
const resumesUsedIn = d => { const sd = join(d, 'superseded'); return existsSync(sd) ? readdirSync(sd).filter(f => /\.charge-\d+\.usage\.json$/.test(f)).filter(f => Number.isInteger(JSON.parse(readFileSync(join(sd, f), 'utf8')).resumed)).length : 0; };
const reservedFor = (d, label) => lines(d).filter(l => l.event === 'reserved' && l.label === label).length;
const MOCK = { provider: 'mock', model: 'mock-priced', maxTokens: 500 };
const MOCK_FREE = { provider: 'mock', model: 'mock-free', maxTokens: 500 };   // projects $0: a seat that does not bill
const near = (a, b) => Math.abs(a - b) < 1e-9;
let tag = 0;
const netfail = (n, mode = '') => { process.env.COUNCIL_MOCK_NETFAIL = `${n}:t${++tag}${mode}`; };

// Arms one test: a cap, a reservation file, a charge collector, no waits between attempts, and `n` failures in transit for the next mock calls.
function arm(n, { cap = 50, seed } = {}) {
  const d = dir(); const charges = [];
  setCache(null); setBudget(cap); setRetrySleep(() => Promise.resolve());
  const sink = openReservations(d); setReservationSink(sink); setChargeHook(c => { charges.push(c); recordLostCharge(d, c.label, c); });
  if (seed) seed(sink);
  netfail(n);
  return { d, charges };
}
function disarm() {
  delete process.env.COUNCIL_MOCK_NETFAIL;
  setBudget(null); setReservationSink(null); setChargeHook(null); setRetrySleep(null); setRequestDeadline(null); setPromptSpy(null);
}

// The counting check. What a call's attempts must leave behind, from the reservation file and the charge records alone: each reservation is settled exactly once, each `billed_unreadable` settlement has exactly one
// `billed` charge record with its reservation id and the same figure (the shape src/tree-budget.js matches), and no charge record belongs to no settlement. Returns the problems found, [] when the books are right.
// Its own test below feeds it books that count an attempt twice and books that count one zero times.
function problemsOf(all, charges) {
  const out = [];
  const reserved = all.filter(l => l.event === 'reserved'), settled = all.filter(l => l.event === 'settled');
  const ids = reserved.map(l => l.id);
  if (new Set(ids).size !== ids.length) out.push('a reservation is on the file twice');
  for (const id of new Set(ids)) { const n = settled.filter(l => l.id === id).length; if (n !== 1) out.push(`reservation ${id} is settled ${n} times`); }
  for (const s of settled) if (!ids.includes(s.id)) out.push(`settlement of ${s.id} has no reservation`);
  const billed = settled.filter(l => l.outcome === 'billed_unreadable');
  for (const s of billed) {
    const mine = charges.filter(c => c.kind === 'billed' && c.reservationId === s.id);
    if (mine.length !== 1) out.push(`failed attempt ${s.id} has ${mine.length} charge records`);
    else if (!near(mine[0].usd, s.usd)) out.push(`the charge record and the settlement of ${s.id} differ`);
  }
  for (const c of charges.filter(c => c.kind === 'billed')) if (!billed.some(s => s.id === c.reservationId)) out.push(`a charge record names ${c.reservationId}, which no billed settlement closes`);
  return out;
}
function perAttempt(d, charges) {
  const all = lines(d);
  assert.deepEqual(problemsOf(all, charges), [], 'the books of the attempts are right');
  return { reserved: all.filter(l => l.event === 'reserved'), settled: all.filter(l => l.event === 'settled'), billed: all.filter(l => l.event === 'settled' && l.outcome === 'billed_unreadable') };
}
// The control: a dropped connection on `label` is asked again and the second attempt answers (2 attempts).
async function control(d, label) {
  netfail(1);
  await runSingleStage(MOCK, { system: 's', user: 'u', label, log: () => {} });
  assert.equal(reservedFor(d, label), 2, `control: a dropped connection on ${label} is asked again (2 attempts)`);
}

test('the counting check: books that count an attempt twice, books that count one zero times, and right books', () => {
  const R = (id, usd = 1) => ({ event: 'reserved', id, label: 'x', usd });
  const S = (id, outcome, usd) => ({ event: 'settled', id, outcome, usd });
  const C = (id, usd) => ({ kind: 'billed', reservationId: id, usd });
  assert.deepEqual(problemsOf([R('r1'), S('r1', 'billed_unreadable', 1), R('r2'), S('r2', 'recorded', 2)], [C('r1', 1)]), [], 'right books');
  assert.ok(problemsOf([R('r1'), R('r1'), S('r1', 'billed_unreadable', 1)], [C('r1', 1)]).length > 0, 'a reservation on the file twice: an attempt counted twice');
  assert.ok(problemsOf([R('r1'), S('r1', 'billed_unreadable', 1)], [C('r1', 1), C('r1', 1)]).length > 0, 'a charge record twice: an attempt counted twice');
  assert.ok(problemsOf([R('r1'), S('r1', 'billed_unreadable', 1), S('r1', 'billed_unreadable', 1)], [C('r1', 1)]).length > 0, 'a settlement twice: an attempt counted twice');
  assert.ok(problemsOf([R('r1'), R('r2'), S('r2', 'recorded', 2)], []).length > 0, 'a reservation with no settlement: an attempt that is never closed');
  assert.ok(problemsOf([R('r1'), S('r1', 'billed_unreadable', 1)], []).length > 0, 'a failed attempt with no charge record: an attempt counted zero times');
  assert.ok(problemsOf([R('r1'), S('r1', 'billed_unreadable', 1)], [C('r1', 0.5)]).length > 0, 'a charge record that differs from its settlement');
  assert.ok(problemsOf([R('r1'), S('r1', 'recorded', 1)], [C('r1', 1)]).length > 0, 'a charge record for an attempt that was not billed_unreadable');
});

test('3 failures in transit then an answer: 4 attempts, each reserved before it is sent and settled once, each failed attempt charged once, the counted amount holds every attempt once', async () => {
  const { d, charges } = arm(3);
  try {
    const st = await runSingleStage(MOCK, { system: 's', user: 'u'.repeat(400), label: 'one', log: () => {} });
    const { reserved, settled, billed } = perAttempt(d, charges);
    assert.equal(reserved.length, 4, 'one reservation per attempt');
    assert.deepEqual(settled.map(l => l.outcome), ['billed_unreadable', 'billed_unreadable', 'billed_unreadable', 'recorded']);
    assert.equal(billed.length, 3);
    assert.deepEqual(charges.map(c => c.resumed), [1, 2, 3], 'each failed attempt names the run\'s resume that followed it');
    assert.equal(resumesUsedIn(d), 3, 'the run folder holds the count');
    // no expected size outside runChain: a failed attempt is charged a typical size for what the call writes (unit 3, D43); for this 500-token seat that is its whole cap (the critique size is 1200), so it equals the worst case its reservation carried
    for (const b of billed) assert.ok(near(b.usd, reserved[0].usd), 'a call the dry run does not plan: a typical size, capped at the seat\'s own cap');
    assert.equal(settled[3].usd, st.usd, 'the answer is the stage, and the stage carries only its own attempt');
    const sum = charges.reduce((n, c) => n + c.usd, 0) + st.usd;
    assert.ok(near(budgetState().spent, sum), `spent ${budgetState().spent} = three failed attempts + the answer (${sum}), each exactly once`);
    assert.equal(budgetState().reserved, 0, 'every reservation is released');
  } finally { disarm(); }
});

test('the bound is the run\'s: the failure after the third resume stops the run (controlFlow, so no catch turns it into an abstention or a re-ask), and no fifth attempt is sent', async () => {
  const { d, charges } = arm(9);
  try {
    await assert.rejects(() => runSingleStage(MOCK, { system: 's', user: 'u', label: 'bound', log: () => {} }), err => err.maybeBilled === true && err.controlFlow === true);
    const { reserved, settled } = perAttempt(d, charges);
    assert.equal(reserved.length, 4, 'exactly 4 attempts were reserved and sent: the first and the run\'s 3 resumes');
    assert.ok(settled.every(l => l.outcome === 'billed_unreadable'));
    assert.deepEqual(charges.map(c => c.resumed), [1, 2, 3, undefined], 'the last failed attempt was followed by no resume');
    assert.ok(near(budgetState().spent, charges.reduce((n, c) => n + c.usd, 0)), 'the four failed attempts are counted once each');
  } finally { disarm(); }
});

test('the three are the run\'s, not a call\'s: a second call finds only what the first left', async () => {
  const { d } = arm(2);
  try {
    await runSingleStage(MOCK, { system: 's', user: 'u', label: 'first', log: () => {} });
    assert.equal(reservedFor(d, 'first'), 3, 'the first call used 2 of the run\'s 3 resumes');
    netfail(9);
    await assert.rejects(() => runSingleStage(MOCK, { system: 's', user: 'u', label: 'second', log: () => {} }), err => err.controlFlow === true);
    assert.equal(reservedFor(d, 'second'), 2, 'the second call got the one resume left, then the run stopped');
    assert.equal(resumesUsedIn(d), 3);
  } finally { disarm(); }
});

test('a resume the person starts does not refill the three: a new sitting on the same run folder finds them used', async () => {
  const { d } = arm(9);
  try {
    await assert.rejects(() => runSingleStage(MOCK, { system: 's', user: 'u', label: 'one', log: () => {} }), err => err.controlFlow === true);
    assert.equal(resumesUsedIn(d), 3);
    // the next sitting: a new budget (nothing taken in memory), the same run folder
    setBudget(50); setReservationSink(openReservations(d)); netfail(9);
    await assert.rejects(() => runSingleStage(MOCK, { system: 's', user: 'u', label: 'later', log: () => {} }), err => err.controlFlow === true);
    assert.equal(reservedFor(d, 'later'), 1, 'sent once, then the run stops: the run folder says the three are used');
    // the SAME label again: it has 4 billed_unreadable settlements, so the label guard would deny it; the used-up run still stops it (controlFlow), it must not end as a judge's re-ask
    setBudget(50); setReservationSink(openReservations(d)); netfail(9);
    await assert.rejects(() => runSingleStage(MOCK, { system: 's', user: 'u', label: 'one', log: () => {} }), err => err.controlFlow === true);
    assert.equal(reservedFor(d, 'one'), 5, 'the 4 earlier attempts + 1 new, and the run stopped');
  } finally { disarm(); }
});

const FREE_RESUMES_FILE = 'network-resumes.jsonl';
const freeRecord = d => (existsSync(join(d, FREE_RESUMES_FILE)) ? readFileSync(join(d, FREE_RESUMES_FILE), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const resumeLines = logs => logs.filter(m => /asking again/.test(m)).length;

test('a seat that does not bill: its three resumes are counted per sitting, each is a line in the log AND in network-resumes.jsonl, and a resume the person starts gives them back', async () => {
  const { d } = arm(9); const logs = [];
  const free = label => runSingleStage(MOCK_FREE, { system: 's', user: 'u', label, log: m => logs.push(m) });
  try {
    await assert.rejects(() => free('free1'), err => err.controlFlow === true && err.maybeBilled === true);
    assert.equal(resumeLines(logs), 3, 'three resume lines in the log');
    assert.ok(logs.filter(m => /asking again/.test(m)).every(m => /for this sitting\)\. Each resume is recorded in network-resumes\.jsonl\.$/.test(m)), 'which say "this sitting" and that each resume (not each attempt) is recorded in network-resumes.jsonl');
    assert.ok(freeRecord(d).length === 3 && freeRecord(d).every(r => r.schema === 'network-resumes/1'), 'the record carries the schema name network-resumes/1');
    assert.ok(logs.some(m => /retries of this sitting are used: the run stops here\.[^]*a resume you start has 3 of its own/.test(m)), 'and the stop line says the person\'s resume has its own three');
    assert.deepEqual(freeRecord(d).map(r => [r.label, r.resumed]), [['free1', 1], ['free1', 2], ['free1', 3]], 'and three lines in network-resumes.jsonl');
    assert.equal(resumesUsedIn(d), 0, 'the charge-file count (billing seats, run-wide) does not read it');
    assert.equal(existsSync(join(d, RESERVATIONS_FILE)), false, 'a $0 call reserves nothing');
    // the person\'s resume: a new sitting on the same run folder
    setBudget(50); setReservationSink(openReservations(d)); netfail(9);
    await assert.rejects(() => free('free2'), err => err.controlFlow === true);
    assert.equal(freeRecord(d).length, 6, 'a free seat has its three again in the new sitting');
    assert.equal(resumeLines(logs), 6);
  } finally { disarm(); }
});

test('the billing seats\' bound is unchanged beside it: when the run folder says their three are used, a free seat still gets its own three in the new sitting', async () => {
  const { d } = arm(9); const logs = [];
  try {
    await assert.rejects(() => runSingleStage(MOCK, { system: 's', user: 'u', label: 'bill1', log: () => {} }), err => err.controlFlow === true);
    assert.equal(resumesUsedIn(d), 3);
    setBudget(50); setReservationSink(openReservations(d)); netfail(9);
    await assert.rejects(() => runSingleStage(MOCK_FREE, { system: 's', user: 'u', label: 'free3', log: m => logs.push(m) }), err => err.controlFlow === true);
    assert.equal(resumeLines(logs), 3, 'the free seat is not held to the billing seats\' count');
    assert.equal(resumesUsedIn(d), 3, 'and the billing count is unchanged by it');
    assert.equal(freeRecord(d).length, 3);
  } finally { disarm(); }
});

test('a free seat\'s resume record moves no spend figure: the run\'s spend, the spend report, the superseded rows and the files the tree accounting reads its figure from (tree-budget filesReadForFigure) are the same with and without it (and the check can fail: a $1 charge file in its place moves them)', () => {
  const root = mkdtempSync(join(tmpdir(), 'thc-netres-spend-')); const runs = join(root, 'runs'); const d = join(runs, '2026-11-04T03-00-00-000Z'); mkdirSync(d, { recursive: true });
  recordLostCharge(d, 'a', { provider: 'p', model: 'm', usd: 0.5, reason: 'r', kind: 'billed', reservationId: 'r1' });
  const figures = () => ({ files: filesReadForFigure(d), run: runSpentUsd(d), report: spendReport(runs, { days: 3650, now: Date.parse('2026-11-05T00:00:00Z') }).totalUsd, rows: supersededStagesOf(d).map(r => [r.label, r.usd, r.kind, r.reservationId]) });
  const before = figures();
  assert.equal(before.run, 0.5);
  recordLostCharge(d, 'free', { provider: 'mock', model: 'mock-free', usd: 0, resumed: 1, cause: 'TypeError > Error ECONNRESET read' });
  assert.equal(freeRecord(d).length, 1, 'the record is there');
  assert.deepEqual(figures(), before, 'and no spend reader moved');
  recordLostCharge(d, 'badrecord', { provider: 'mock', model: 'mock-free', usd: 1, reason: 'a record that is a charge file', kind: 'billed' });
  assert.notDeepEqual(figures(), before, 'the known-bad input (the same record written as a $1 charge file) does move them');
});

test('a panel judge whose connection never stops failing: the run stops after the 4th attempt, there is no re-ask under a new label (the measured fall-through)', async () => {
  const { d, charges } = arm(99);
  try {
    await assert.rejects(() => runChain({ request: 'Req.', config: panelConfig, draft: DRAFT, log: () => {} }), err => err.controlFlow === true && err.maybeBilled === true);
    const labels = lines(d).filter(l => l.event === 'reserved').map(l => l.label);
    assert.deepEqual(labels, ['panel-1-a', 'panel-1-a', 'panel-1-a', 'panel-1-a'], 'one stage, four attempts, and no panel-1-a-reask1');
    // a planned call: all four are charged at its expected cost, and the record of the last one says that the call is not asked again (the probe's old text said "is asked again" there)
    assert.deepEqual(charges.map(c => /is not asked again/.test(c.reason)), [false, false, false, true]);
    assert.ok(charges.every(c => /counted at its expected cost/.test(c.reason)), 'every attempt of a planned call is counted at its expected cost');
  } finally { disarm(); }
});

test('the ledger guard: a label that already settled billed_unreadable twice is not asked again after a new failure', async () => {
  const { d, charges } = arm(0, { seed: sink => { for (let i = 0; i < 2; i++) sink.settle(sink.reserve({ label: 'repeat', seat: 'mock/mock-priced', usd: 1 }), { outcome: 'billed_unreadable', usd: 1 }); } });
  try {
    await control(d, 'other');
    netfail(9);
    await assert.rejects(() => runSingleStage(MOCK, { system: 's', user: 'u', label: 'repeat', log: () => {} }), err => err.maybeBilled === true);
    assert.equal(reservedFor(d, 'repeat'), 3, 'the 2 earlier reservations + exactly 1 new attempt: no resume');
    assert.equal(charges.filter(c => c.label === 'repeat').length, 1, 'the one new failed attempt is its own charge');
  } finally { disarm(); }
});

test('the ledger guard\'s threshold: a label that settled billed_unreadable once is still asked again', async () => {
  const { d } = arm(2, { seed: sink => { sink.settle(sink.reserve({ label: 'once', seat: 'mock/mock-priced', usd: 1 }), { outcome: 'billed_unreadable', usd: 1 }); } });
  try {
    await runSingleStage(MOCK, { system: 's', user: 'u', label: 'once', log: () => {} });
    assert.equal(reservedFor(d, 'once'), 4, 'the 1 earlier reservation + 3 attempts (2 failures, then the answer): asked again');
  } finally { disarm(); }
});

// CHANGED ACCEPTED TEST (0.8.4 add-on removal, box set fix): OLD: a test that an advice label (advise-x) is not asked again. NEW: gone. WHY: the advice add-on is removed; the deep-dive row below keeps the one-shot rule.

test('a deep-dive call is not resumed: the stage checks each call against its own dollar cap before it is sent', async () => {
  const { d } = arm(0);
  try {
    await control(d, 'other');
    netfail(9);
    await assert.rejects(() => runSingleStage(MOCK, { system: 's', user: 'u', label: 'deep-dive-a-1', log: () => {} }), err => err.maybeBilled === true);
    assert.equal(reservedFor(d, 'deep-dive-a-1'), 1);
  } finally { disarm(); }
});

test('the side commands\' calls are not resumed: each is judged against a policy limit before it is sent', async () => {
  const { d } = arm(0);
  try {
    await control(d, 'other');
    for (const label of ['digest', 'handoff-from-run', 'contract-draft']) {
      netfail(9);
      await assert.rejects(() => runSingleStage(MOCK, { system: 's', user: 'u', label, log: () => {} }), err => err.maybeBilled === true);
      assert.equal(reservedFor(d, label), 1, `${label} is sent once`);
    }
  } finally { disarm(); }
});

test('a failure that carries no transport flags is not asked again', async () => {
  const { d, charges } = arm(0);
  try {
    await control(d, 'other');
    netfail(9, ':plain');
    await assert.rejects(() => runSingleStage(MOCK, { system: 's', user: 'u', label: 'plain', log: () => {} }));
    assert.equal(reservedFor(d, 'plain'), 1, 'sent once');
    assert.equal(charges.filter(c => c.label === 'plain').length, 0, 'an unflagged failure is not a billed charge');
  } finally { disarm(); }
});

// The gate's expected figure for a planned call: the whole prompt in plus the dry run's expected review size out, at the fixture price (worked out here by hand, as test/expected-cost-gate.test.js does).
const DRAFT = 'MOCK DRAFT TO REVIEW ' + 'x'.repeat(4000);
const CRITIQUE_TOKENS = 300, MAX_TOKENS = 8000;
const panelConfig = { name: 'netres', signoff: 'unanimous', maxRounds: 1, criteria: ['It exists.'], estimate: { critiqueTokens: CRITIQUE_TOKENS }, seats: { critics: [{ provider: 'mock', model: 'mock-priced', maxTokens: MAX_TOKENS, lab: 'a' }] } };

test('a planned call: each failed attempt is charged at the call\'s expected cost, not its worst case (his decision 9; plan A T6.1)', async () => {
  const price = priceOf('mock', 'mock-priced'); assert.deepEqual({ in: price.in, out: price.out }, { in: 1000, out: 1000 }, 'fixture price');
  let chars = 0; setCache(null); setBudget(null); setPromptSpy(p => { if (p.label === 'panel-1-a') chars = (p.system || '').length + (p.user || '').length; });
  try { await runChain({ request: 'Req.', config: panelConfig, draft: DRAFT, log: () => {} }); } finally { setPromptSpy(null); }
  assert.ok(chars > 0, 'fixture: the panel prompt was read');
  const inTok = Math.ceil(chars / 4), expected = (inTok + CRITIQUE_TOKENS) * 1000 / 1e6, worst = (inTok + MAX_TOKENS) * 1000 / 1e6;
  const { d, charges } = arm(3); const stages = [];
  try {
    await runChain({ request: 'Req.', config: panelConfig, draft: DRAFT, log: () => {}, onStage: s => stages.push(s) });
    const { reserved, billed } = perAttempt(d, charges);
    assert.equal(reserved.length, 4);
    assert.equal(billed.length, 3);
    for (const b of billed) { assert.ok(near(b.usd, expected), `a failed attempt is charged ${expected}, its expected cost (not ${worst}): ${b.usd}`); assert.ok(b.usd < worst); }
    for (const r of reserved) assert.ok(near(r.usd, worst), 'the reservation on disk stays the worst case');
    const panel = stages.find(s => s.label === 'panel-1-a'); assert.ok(panel, 'the fourth attempt answered');
    assert.ok(near(budgetState().spent, 3 * expected + panel.usd), 'spent = three expected-cost attempts + the answer');
  } finally { disarm(); }
});

// The real adapter: the flags are the ones post() sets, not hand-made ones.
function stub(handler) {
  const seen = []; const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => { seen.push(req.url); handler(seen.length, req, res); }); });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, seen, url: `http://127.0.0.1:${srv.address().port}` })));
}
const ok = res => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50 } })); };
const PRICED = { provider: 'openrouter', model: 'anthropic/claude-opus-5', originalProvider: 'anthropic', maxTokens: 500 };
async function withKey(fn) {
  const env0 = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-or-v1-' + 'c'.repeat(40);
  try { await fn(); } finally { if (env0 === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = env0; }
}

test('the real adapter: a connection reset after the request went out is asked again, and each attempt is reserved on disk before its request arrives', () => withKey(async () => {
  const d = dir(); const atSend = [];
  const s = await stub((n, req, res) => { atSend.push(lines(d).filter(l => l.event === 'reserved').length); if (n === 1) req.socket.destroy(); else ok(res); });
  const { charges } = arm(0);
  setReservationSink(openReservations(d));
  try {
    const st = await runSingleStage({ ...PRICED, baseUrl: s.url }, { system: 's', user: 'u', label: 'reset', log: () => {} });
    assert.deepEqual(atSend, [1, 2], 'request k finds k reservations on disk: each attempt is reserved before it is sent');
    const { settled } = perAttempt(d, charges);
    assert.deepEqual(settled.map(l => l.outcome), ['billed_unreadable', 'recorded']);
    assert.equal(st.text, 'ok');
  } finally { disarm(); s.srv.close(); }
}));

test('the real adapter: an HTTP 400 is sent once (after a reset that was asked again, as the control)', () => withKey(async () => {
  const s = await stub((n, req, res) => { if (n === 1) req.socket.destroy(); else if (n === 2) ok(res); else { res.statusCode = 400; res.end('{"error":"bad"}'); } });
  const { d } = arm(0);
  try {
    await runSingleStage({ ...PRICED, baseUrl: s.url }, { system: 's', user: 'u', label: 'ctl', log: () => {} });
    assert.equal(s.seen.length, 2, 'control: the reset was asked again');
    await assert.rejects(() => runSingleStage({ ...PRICED, baseUrl: s.url }, { system: 's', user: 'u', label: 'bad', log: () => {} }));
    assert.equal(s.seen.length, 3, 'a refusal is sent once');
    assert.equal(reservedFor(d, 'bad'), 1);
  } finally { disarm(); s.srv.close(); }
}));

test('the real adapter: a call that ran into the request deadline is not asked for another whole period (after a reset that was asked again, as the control)', () => withKey(async () => {
  const s = await stub((n, req, res) => { if (n === 1) req.socket.destroy(); else if (n === 2) ok(res); /* the third request is never answered */ });
  const { d } = arm(0);
  try {
    await runSingleStage({ ...PRICED, baseUrl: s.url }, { system: 's', user: 'u', label: 'ctl', log: () => {} });
    assert.equal(s.seen.length, 2, 'control: the reset was asked again');
    setRequestDeadline(150);
    await assert.rejects(() => runSingleStage({ ...PRICED, baseUrl: s.url }, { system: 's', user: 'u', label: 'slow', log: () => {} }), err => err.maybeBilled === true);
    assert.equal(s.seen.length, 3);
    assert.equal(reservedFor(d, 'slow'), 1);
  } finally { disarm(); s.srv.closeAllConnections?.(); s.srv.close(); }
}));

// The three claims the README makes about what is NOT asked again that the tests above reach only through a control: a 200 whose body is not JSON, a failure before anything was sent, a 200 that carries an error.
// Each assertion pair is the one test scratch/knownbad-netresume fed a connection reset to (and saw fail): [requests, reservations] = [1, 1], then the settlement.
test('a 200 whose body is not JSON is sent once and counted at its worst case (the dropped-body text is not this case)', () => withKey(async () => {
  const s = await stub((n, req, res) => { res.statusCode = 200; res.setHeader('content-type', 'application/json'); res.end('this is not json'); });
  const { d } = arm(0);
  try {
    await assert.rejects(() => runSingleStage({ ...PRICED, baseUrl: s.url }, { system: 's', user: 'u', label: 'notjson', log: () => {} }));
    assert.deepEqual([s.seen.length, reservedFor(d, 'notjson')], [1, 1], 'sent once');
    assert.deepEqual(lines(d).filter(l => l.event === 'settled').map(l => l.outcome), ['billed_unreadable']);
  } finally { disarm(); s.srv.close(); }
}));

test('a failure before anything was sent (nothing is listening) is one reservation that settles failed at $0, and the resume does not ask again', () => withKey(async () => {
  const port = await new Promise(r => { const t = net.createServer(); t.listen(0, '127.0.0.1', () => { const p = t.address().port; t.close(() => r(p)); }); });
  const { d, charges } = arm(0);
  try {
    await assert.rejects(() => runSingleStage({ ...PRICED, baseUrl: `http://127.0.0.1:${port}` }, { system: 's', user: 'u', label: 'presend', log: () => {} }));
    assert.equal(reservedFor(d, 'presend'), 1, 'one reservation');
    assert.deepEqual(lines(d).filter(l => l.event === 'settled').map(l => [l.outcome, l.usd]), [['failed', 0]]);
    assert.equal(charges.length, 0, 'and no charge');
  } finally { disarm(); }
}));

test('a 200 that carries an error and no reply (S5-03) is sent once and settles billed_unreadable at a typical cost for the call outside runChain; an error reply is never asked again', () => withKey(async () => {
  const s = await stub((n, req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: { code: 529, message: 'overloaded' } })); });
  const { d } = arm(0);
  try {
    await assert.rejects(() => runSingleStage({ ...PRICED, baseUrl: s.url }, { system: 's', user: 'u', label: 'errreply', log: () => {} }));
    assert.deepEqual([s.seen.length, reservedFor(d, 'errreply')], [1, 1], 'sent once');
    assert.deepEqual(lines(d).filter(l => l.event === 'settled').map(l => l.outcome), ['billed_unreadable']);
  } finally { disarm(); s.srv.close(); }
}));
