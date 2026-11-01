// B3-only run controls, part (b): a raise of the run's limit at ANY resume (`--raise-cap`), answered by the person at a terminal or relayed by the handler session on his permission (`--relayed`, with his own words as a required
// field). Real gate files and ledgers in a temp folder, the harness of test/start-cap.test.js. Library level; the CLI path has its own rows at the end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { authorizeStart } from '../src/start-cap.js';
import { capScopeSha256, answerGate, answerGateAsRelay, readGateAnswer } from '../src/gate.js';
import { LEDGER_FILE } from '../src/gate-ledger.js';
import { buildCapScreen } from '../src/cap-screen.js';
import { relayCommand } from '../src/gate-relay-cli.js';

const T0 = Date.parse('2026-10-30T12:00:00.000Z');
const now = () => T0;
const obj = { task_sha256: 'a'.repeat(64), chain_sha256: 'c'.repeat(64), seats: [], policy_sha256: null };
const sha = capScopeSha256(obj);
const screens = [];
const call = (d, over = {}) => authorizeStart({ runDir: d, runId: 'run-1', resume: true, scopeSha256: sha, scope: obj, buildScreen: (kind, { history }) => { screens.push({ kind, history }); return `SCREEN ${kind}\n`; }, ceiling: { usd: 1000, source: 'COUNCIL_MAX_USD_LIMIT' }, interactive: false, ask: async () => 1, now, ...over });
const ledger = d => readFileSync(join(d, LEDGER_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const person = (d, id, typed) => { const g = readGateAnswer(d, id, { now }).gate; return answerGate(d, id, { channel: 'cli', shownSha256: g.sha256, decision: 'approved', actor: 'tester', tty: true, typedCap: typed }, { now }); };
const relay = (d, id, over = {}) => { const g = readGateAnswer(d, id, { now }).gate; return answerGateAsRelay(d, id, { shownSha256: g.sha256, reason: 'relayed on the person\'s permission', personWords: 'Raise it to $30, please', typedCap: '30', ...over }, { now }); };
const hist = { spentUsd: 2, floorUsd: 2, unsettledUsd: 0, stopped: null };
// a run with its first limit ($10) consumed, mid-run, not stopped at any limit
async function running() { screens.length = 0; const base = mkdtempSync(join(tmpdir(), 'b3-raise-')); const d = join(base, 'run-1'); mkdirSync(d); await call(d, { resume: false }); assert.equal(person(d, 'g1', '10').ok, true); assert.equal((await call(d, { resume: false })).status, 'authorized'); return d; }

test('R1: without --raise-cap a run that has not stopped at its limit simply continues under it (a guard: the old behaviour, no red); with it, a raise screen of its own kind opens and nothing is spent', async () => {
  const d = await running();
  const plain = await call(d, { history: () => hist });
  assert.deepEqual([plain.status, plain.via, plain.capUsd], ['authorized', 'continued', 10]);
  const early = await call(d, { history: () => hist, forceRaise: true });
  assert.deepEqual([early.status, early.gate], ['pending', 'g2']);
  assert.equal(screens.at(-1).kind, 'raise_early');
  assert.equal(readGateAnswer(d, 'g2', { now }).gate.cap.operation, 'raise');
  assert.equal(ledger(d).find(l => l.event === 'gate_requested' && l.gate === 'g2').requested_by, undefined, 'a person-requested gate unless --relayed');
});

test('R2: the early-raise screen tells the truth: the run is under a limit (not stopped at it), and the floor is the limit it has now', () => {
  const t = buildCapScreen({ kind: 'raise_early', history: { previousCapUsd: 10, spentUsd: 2, floorUsd: 2 }, subject: { chain: 'c', task: 't' } }).text;
  assert.match(t, /This run is under a limit of \$10\.00: \$2\.00 counted\./);
  assert.match(t, /It must be above \$10\.00, the limit it has now\./);
  assert.doesNotMatch(t, /stopped at its limit/);
  assert.doesNotMatch(t, /what the run has already counted/);
});

test('R3: a person-typed early raise: a total above the current limit is consumed; one at or below it is set aside with its own note and a NEW gate asks (never a locked gate), even when it is above what the run has spent', async () => {
  const d = await running();
  await call(d, { history: () => hist, forceRaise: true });
  assert.equal(person(d, 'g2', '8').ok, true);   // above the $2 spent, below the $10 limit: a LOWER limit
  const set = await call(d, { history: () => hist, forceRaise: true });
  assert.equal(set.status, 'pending');
  assert.equal(set.gate, 'g3');
  assert.equal(set.note.code, 'not_above_current');
  assert.match(set.note.message, /is not above the limit it has now \(\$10\.00\), so it was not used\. Nothing was started\./);
  assert.equal(person(d, 'g3', '10').ok, true);   // equal is not a raise either
  assert.equal((await call(d, { history: () => hist, forceRaise: true })).note.code, 'not_above_current');
  assert.equal(person(d, 'g4', '30').ok, true);
  const ok = await call(d, { history: () => hist, forceRaise: true });
  assert.deepEqual([ok.status, ok.capUsd, ok.operation, ok.via], ['authorized', 30, 'raise', 'answered']);
  assert.equal(ledger(d).filter(l => l.event === 'cap_consumed').map(l => l.cap_micro_usd).join(','), '10000000,30000000');
});

test('R4: a relayed raise: the gate is requested as a session gate, nothing prompts in this process, the relay with his words and the total in them is consumed, and the record shows channel session, the relayer, his words and the time', async () => {
  const d = await running();
  const asked = [];
  const p = await call(d, { history: () => hist, forceRaise: true, relayed: true, interactive: true, ask: async () => { asked.push(1); return 0; } });
  assert.deepEqual([p.status, p.gate], ['pending', 'g2']);
  assert.deepEqual(asked, [], 'a relayed gate is never answered by a prompt in this process');
  assert.equal(ledger(d).find(l => l.event === 'gate_requested' && l.gate === 'g2').requested_by, 'session');
  assert.equal(relay(d, 'g2').ok, true);
  const ok = await call(d, { history: () => hist, forceRaise: true, relayed: true });
  assert.deepEqual([ok.status, ok.capUsd, ok.operation], ['authorized', 30, 'raise']);
  const answer = ledger(d).find(l => l.event === 'gate_answered' && l.gate === 'g2');
  assert.deepEqual({ channel: answer.channel, actor: answer.actor, tty: answer.tty, person_words: answer.person_words, decision: answer.decision }, { channel: 'session', actor: 'main-session', tty: false, person_words: 'Raise it to $30, please', decision: 'approved' });
  assert.ok(answer.ts && answer.reason);
  const g = readGateAnswer(d, 'g2', { now }).gate;
  assert.equal(g.answer.person_words, 'Raise it to $30, please');
});

const refused = (id, name, setup, expectCode, expectMessage) => test(`${id}: a relay is refused and records nothing: ${name}`, async () => {
  const d = await running();
  await setup(d);
  const before = ledger(d).length;
  const r = relay(d, 'g2', setup.over ?? {});
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.equal(r.code, expectCode);
  assert.match(r.message, expectMessage);
  assert.equal(ledger(d).length, before, 'nothing appended');
});
const open = over => Object.assign(async d => { await call(d, { history: () => hist, forceRaise: true, relayed: true }); }, { over });
refused('R5a', 'no words of his', open({ personWords: '' }), 'person_words_required', /the session answers this gate only on the person's permission, with the person's own words as typed in the handler's window\. None were given\. Nothing was recorded\./);
refused('R5b', 'his words do not contain the figure', open({ personWords: 'Yes, go ahead and raise it' }), 'person_words_total', /the total 30 does not appear in the person's words as given, so the limit was not recorded\. Quote the person's words with the figure in digits\. Nothing was recorded\./);
refused('R5c', 'his words name another figure', open({ personWords: 'Raise it to $25' }), 'person_words_total', /the total 30 does not appear/);
refused('R5d', 'the gate was asked for by a person, not by the session (no --relayed on the resume that opened it)', async d => { await call(d, { history: () => hist, forceRaise: true }); }, 'gate_not_session_requested', /was asked for by a person: only the person answers it/);
test('R5e: a relay is refused for the FIRST limit and for an amendment: only a raise may be relayed', async () => {
  screens.length = 0;
  const base = mkdtempSync(join(tmpdir(), 'b3-raise-')); const d = join(base, 'run-1'); mkdirSync(d);
  await call(d, { resume: false, relayed: true });
  const first = relay(d, 'g1');
  assert.equal(first.ok, false);
  assert.equal(first.code, 'channel_not_session_eligible');
  assert.equal(ledger(d).some(l => l.event === 'gate_answered'), false);
  // an amendment (the scope changed after the first limit) is not a raise either
  const d2 = await running();
  const changed = { ...obj, chain_sha256: 'd'.repeat(64) };
  await call(d2, { scope: changed, scopeSha256: capScopeSha256(changed), relayed: true });
  const amend = relay(d2, 'g2');
  assert.equal(readGateAnswer(d2, 'g2', { now }).gate.cap.operation, 'amend_scope');
  assert.equal(amend.ok, false);
  assert.equal(amend.code, 'channel_not_session_eligible');
});
test('R5f: the session channel alone, without his words, never answers a limit', async () => {
  const d = await running();
  await call(d, { history: () => hist, forceRaise: true, relayed: true });
  const g = readGateAnswer(d, 'g2', { now }).gate;
  const r = answerGate(d, 'g2', { channel: 'session', shownSha256: g.sha256, decision: 'approved', actor: 'main-session', reason: 'x', tty: false, typedCap: '30' }, { now });
  assert.equal(r.code, 'person_words_required', 'the session channel alone, without his words, never answers a limit');
});

test('R6: the CLI form: council relay-answer <run> <gate> --total N --person-words "..." needs no terminal, records the relay, and says plainly that the permission is not verified; usage errors write nothing', () => {
  return running().then(async d => {
    await call(d, { history: () => hist, forceRaise: true, relayed: true });
    const sink = () => { const chunks = []; const w = new Writable({ write(c, _e, cb) { chunks.push(String(c)); cb(); } }); w.text = () => chunks.join(''); return w; };
    const run = (positional, opts = {}) => { const stdout = sink(); const stderr = sink(); const code = relayCommand(positional, { work: join(d, '..'), stdout, stderr, now, ...opts }); return { code, out: stdout.text(), err: stderr.text() }; };
    const noTotal = run(['run-1', 'g2'], { personWords: 'Raise it to $30' });
    assert.equal(noTotal.code, 2); assert.match(noTotal.err, /relay-answer: a limit needs --total <dollars>\. Nothing was written\./);
    const noWords = run(['run-1', 'g2'], { total: '30' });
    assert.equal(noWords.code, 1); assert.match(noWords.err, /None were given\. Nothing was recorded\./);
    const odd = run(['run-1']);
    assert.equal(odd.code, 2); assert.match(odd.err, /usage: council relay-answer <run folder> <gate>/);
    assert.equal(ledger(d).some(l => l.event === 'gate_answered' && l.gate === 'g2'), false, 'nothing was written by any refusal');
    const ok = run(['run-1', 'g2'], { total: '30', personWords: 'Raise it to $30, please' });
    assert.equal(ok.code, 0, ok.err);
    assert.match(ok.out, /recorded, relayed by the handler session on the person's words\. The tool cannot verify the permission; the record shows who relayed it\./);
    assert.equal(ledger(d).find(l => l.event === 'gate_answered' && l.gate === 'g2').person_words, 'Raise it to $30, please');
  });
});

test('R7: the report lists every relayed answer with the channel and his words (relayedAnswersOf); a person-typed answer is not listed', async () => {
  const { relayedAnswersOf } = await import('../src/gate.js');
  const d = await running();
  assert.deepEqual(relayedAnswersOf(d), [], 'the first limit was typed by a person');
  await call(d, { history: () => hist, forceRaise: true, relayed: true });
  assert.equal(relay(d, 'g2').ok, true);
  const rows = relayedAnswersOf(d);
  assert.equal(rows.length, 1);
  assert.deepEqual({ gate: rows[0].gate, kind: rows[0].kind, channel: rows[0].channel, actor: rows[0].actor, person_words: rows[0].person_words, total_usd: rows[0].total_usd }, { gate: 'g2', kind: 'run_cap', channel: 'session', actor: 'main-session', person_words: 'Raise it to $30, please', total_usd: 30 });
  assert.match(rows[0].at, /^2026-/);
});

test('R8: report.json carries `relayed` (validated against the published schema) when the result has relayed answers, and carries no such key otherwise', async () => {
  const { default: Ajv2020 } = await import('ajv/dist/2020.js');
  const { runChain } = await import('../src/chain.js');
  const { reportJsonShape } = await import('../src/report-shape.js');
  const { readFileSync: rf } = await import('node:fs');
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const validate = ajv.compile(JSON.parse(rf(new URL('../schemas/report-v1.json', import.meta.url), 'utf8')));
  const seat = { provider: 'mock', model: 'mock-critic-script-o-r8', lab: 'c' };
  const config = { name: 'r8', maxRounds: 2, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 }, seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'a' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'a' }, critics: [seat] } };
  const result = await runChain({ request: 'Req.', config, log: () => {} });
  const row = { gate: 'g2', kind: 'run_cap', channel: 'session', actor: 'main-session', person_words: 'Raise it to $30', at: '2026-10-30T12:00:00.000Z', total_usd: 30 };
  const without = reportJsonShape({ runId: 'x', chain: 'r8', task: 't', result, config });
  assert.equal('relayed' in without, false);
  const withRows = reportJsonShape({ runId: 'x', chain: 'r8', task: 't', result: { ...result, relayed: [row] }, config });
  assert.deepEqual(withRows.relayed, [row]);
  assert.ok(validate(withRows), JSON.stringify(validate.errors, null, 2));
});

test('R5g: his words are taken only on a relayed answer: a person-channel answer that carries words, and a tree kind answered by the session with words, are refused (the session channel is unchanged for the kinds it could already answer)', async () => {
  const { requestGate, answerGate: ag } = await import('../src/gate.js');
  const { writeFileSync: wf } = await import('node:fs');
  const d = await running();
  await call(d, { history: () => hist, forceRaise: true });
  const g = readGateAnswer(d, 'g2', { now }).gate;
  const p = ag(d, 'g2', { channel: 'cli', shownSha256: g.sha256, decision: 'approved', actor: 'tester', tty: true, typedCap: '30', personWords: 'Raise it to $30' }, { now });
  assert.deepEqual([p.ok, p.code], [false, 'person_words_not_asked']);
  wf(join(d, 'tree-text.md'), 'decide\n');
  const made = requestGate(d, { kind: 'tree_decide', textPath: 'tree-text.md', expiresAt: T0 + 3600e3, requestedBy: 'session' }, { now });
  assert.equal(made.ok, true, JSON.stringify(made));
  const sg = readGateAnswer(d, made.gate.id, { now }).gate;
  const s = ag(d, made.gate.id, { channel: 'session', shownSha256: sg.sha256, decision: 'approved', actor: 'main-session', reason: 'because', tty: false, personWords: 'yes' }, { now });
  assert.deepEqual([s.ok, s.code], [false, 'person_words_not_asked']);
  assert.match(s.message, /does not take the person's words with this answer\. Nothing was recorded\./);
});

test('R3b: a raise after a BUDGET STOP is unchanged: a total above the counted floor but below the old limit is still consumed there (the not-above-the-limit check belongs to --raise-cap only; a guard, no red)', async () => {
  const d = await running();
  const stopped = { stopped: { capUsd: 10 }, spentUsd: 9.4, floorUsd: 9.4, suggestedUsd: 10.1, projectedStageUsd: 0.7, unsettledUsd: 0 };
  const p = await call(d, { history: () => stopped });
  assert.deepEqual([p.status, p.gate], ['pending', 'g2']);
  assert.equal(screens.at(-1).kind, 'raise');
  assert.equal(person(d, 'g2', '9.6').ok, true);
  const ok = await call(d, { history: () => stopped });
  assert.deepEqual([ok.status, ok.capUsd], ['authorized', 9.6]);
});

test('R9: the relay is fenced: only src/gate.js (the definition) and src/gate-relay-cli.js name answerGateAsRelay', async () => {
  const { readdirSync: rd, readFileSync: rf } = await import('node:fs');
  const src = new URL('../src/', import.meta.url);
  const named = rd(src).filter(f => f.endsWith('.js') && /\banswerGateAsRelay\b/.test(rf(new URL(f, src), 'utf8')));
  assert.deepEqual(named.sort(), ['gate-relay-cli.js', 'gate.js']);
});
