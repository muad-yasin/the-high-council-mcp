// 0.8.4 (the ladder unit, relayed accept commit; C&C 10 Nov, conditions 1-3): the AFTER-STATE of an answer on the ledger that the run did not take. When the command line refuses the answer's number, or the resume fails to start: run.json is unchanged, the stop can be
// quoted and answered again, and the stale answer is never consumed later (the harness writes a `stop_answer_closed` line; stopDecisionAnswerOf skips a closed gate). The reply of a resume that did not start names the number only as what the ledger recorded, beside the
// failure. And the final-read stop goes through the same function (applyTypedRounds takes no stop kind). Offline, $0. WRITTEN WITHOUT A RUN (no tests on the laptop): the first run on the box decides; the stall fixture of AS-2 is a PREDICTION (a ladder chain whose
// top layer holds one objection stops at a stall). AS-4 makes the ledger file read-only and is skipped when the box runs as root; it also assumes no ledger append before the refusal at cli.js:3661 (a PREDICTION).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEDGER_FILE } from '../src/gate-ledger.js';
import { untilRunIdle } from './helpers/round-stop-project.js';
import { session } from './helpers/mcp-stdio-session.js';
import * as LR from '../src/ladder-resume.js';
const { answerStopRelayed, requestStopQuote } = await import('../src/stop-gate.js');
const { relayedAnswersOf } = await import('../src/gate.js');
const { ANSWER_NOT_TAKEN_NOTE, stopDecideResult } = await import('../src/mcp/stop-decide.js').catch(() => ({}));

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projects = [];
afterEach(() => { while (projects.length) projects.pop().done(); });
const WORDS = 'Go on to four reads.';

const critics = id => [1, 2, 3].map(l => ({ provider: 'mock', model: `mock-critic-script-x-${id}${l}`, lab: `l${l}`, layer: l }));
const ladderChain = id => ({ name: 'lad', signoff: 'unanimous', ladder: { block: 1, visits: 1 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics: critics(id) } });
const stallChain = id => ({ ...ladderChain(id), maxRounds: 12, answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2 },
  seats: { ...ladderChain(id).seats, critics: [{ provider: 'mock', model: 'mock-exch-support-keep-clean', lab: `${id}1`, layer: 1 }, { provider: 'mock', model: 'mock-exch-support-keep-clean', lab: `${id}2`, layer: 2 }, { provider: 'mock', model: 'mock-exch-support-keep-always', lab: `${id}3`, layer: 3 }] } });
function project(config, firstArgs) {
  const dir = mkdtempSync(join(tmpdir(), 'ans-after-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'lad.json'), JSON.stringify(config)); writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const run = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  const first = run(['--chain', 'lad', '--task', 'tasks/t.md', ...firstArgs]);
  if (first.status !== 23) throw new Error(`the fixture was meant to stop at exit 23, got ${first.status}: ${first.stdout}${first.stderr}`);
  const id = readdirSync(join(dir, 'runs'))[0]; const runDir = join(dir, 'runs', id);
  const p = { dir, runDir, id, run, config, runJson: () => JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')), partial: () => JSON.parse(readFileSync(join(runDir, 'report-partial.json'), 'utf8')).stop, done: () => rmSync(dir, { recursive: true, force: true }) };
  projects.push(p);
  return p;
}
const call = (p, args) => session(p.dir, [{ name: 'stop_decide', arguments: { run: p.id, ...args } }]).then(a => a[0]);
const ledger = p => (existsSync(join(p.runDir, LEDGER_FILE)) ? readFileSync(join(p.runDir, LEDGER_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

test('AS-1 (the resume fails to start): the reply names the number only as what the ledger recorded, beside the failure; the answer is closed on the ledger; run.json is unchanged; a typed command naming the old gate is refused and consumes nothing; the stop is quoted and answered again (a new gate) and then the run takes the number', async () => {
  const p = project(ladderChain('as1'), ['--rounds', '2']);
  const before = JSON.stringify(p.runJson());
  const statusOf = async () => { const [st] = await session(p.dir, [{ name: 'run_status', arguments: { run: p.id } }]); return JSON.stringify({ state: st.state, choices: st.roundChoices ?? null }); };
  const stoppedStatus = await statusOf();
  // the first leg runs the tool in-process with a resume that does not start (the way test/accept-flow.test.js calls it): a live lock would make the quote itself refuse, and no gate would exist
  const inProcess = async args => JSON.parse((await stopDecideResult({ runsDir: join(p.dir, 'runs'), args: { run: p.id, ...args }, resumeWith: async () => ({ resumed: false, run: p.id, error: 'the run is still going (test)' }), readsOf: () => ({ ladder: true, made: LR.topLayerReadsMade(p.runDir, p.config) }) })).content[0].text);
  const q = await inProcess({ step: 'quote' });
  const r = await inProcess({ step: 'answer', gate: q.gate, shown: q.shown, choice: 'continue', person_words: WORDS, rounds: 4 });
  assert.equal(r.resumed, false, JSON.stringify(r).slice(0, 400)); assert.ok(r.error, 'the failure is beside it');
  assert.equal(r.recorded.rounds, undefined, 'never named as the run\'s limit');
  assert.equal(r.recorded.ledger_rounds, 4, 'named as what the ledger recorded');
  assert.equal(r.note, ANSWER_NOT_TAKEN_NOTE);
  assert.deepEqual(ledger(p).filter(l => l.event === 'stop_answer_closed').map(l => [l.gate, l.by, l.code]), [[q.gate, 'harness', 'resume_not_started']]);
  assert.equal(JSON.stringify(p.runJson()), before, 'run.json is unchanged');
  const stale = p.run(['--resume', p.runDir, '--continue', '--stop-gate', q.gate]);
  assert.equal(stale.status, 2, stale.stdout + stale.stderr); assert.match(stale.stderr, /no answered stop_decision gate of this run by that name matches this stop/);
  assert.equal(p.runJson().roundChoices, undefined, 'the stale answer consumed nothing');
  // a closed answer is never read as a choice the run made: not in the report's relayed rows, not in the quote's "Choices already made"
  // CHANGED (0.8.4, C&C 10 Nov): OLD bar: report.relayed did not list the closed answer (relayedAnswersOf skipped it). NEW: the schema says one row per relayed answer, so the closed answer KEEPS its row, marked not_taken with its close code, never omitted
  assert.deepEqual(relayedAnswersOf(p.runDir).map(x => [x.gate, x.not_taken]), [[q.gate, 'resume_not_started']], 'report.relayed keeps the closed answer\'s row, marked not taken');
  assert.equal(await statusOf(), stoppedStatus, 'run_status reads the stop as it was: no choice made');
  const q2 = await call(p, { step: 'quote' });
  assert.notEqual(q2.gate, q.gate, 'the stop can be quoted again: a new gate');
  assert.match(q2.text, /Choices already made in this run: none\./, 'the quote lists no choice made');
  const r2 = await call(p, { step: 'answer', gate: q2.gate, shown: q2.shown, choice: 'continue', person_words: WORDS, rounds: 4 });
  assert.equal(r2.error, undefined, JSON.stringify(r2).slice(0, 300)); assert.equal(r2.recorded.rounds, 4);
  await untilRunIdle(p.runDir, 180_000);
  assert.equal(p.runJson().ladderRounds, 4, 'and then the run holds the number');
});

test('AS-2 (the command line refuses the gate\'s number): a number the gate accepted but the terminal refuses (not above the reads made, at a ladder stall, where the gate holds no chain config to count with) is refused by the resume; run.json is unchanged; the answer is closed; a second command naming it consumes nothing; the stop is quoted and answered again', async () => {
  const p = project(stallChain('as2'), []);
  assert.equal(p.partial().kind, 'stall_stop', 'the premise (a prediction): the ladder chain stops at a stall');
  const made = LR.topLayerReadsMade(p.runDir, p.config);
  const q = await call(p, { step: 'quote' });
  const before = JSON.stringify(p.runJson());
  const direct = answerStopRelayed(p.runDir, q.gate, { shownSha256: q.shown, personWords: WORDS, choice: 'continue', rounds: made });
  assert.equal(direct.ok, true, 'the gate cannot count the reads at a stall: it accepts');
  const refused = p.run(['--resume', p.runDir, '--continue', '--stop-gate', q.gate]);
  assert.equal(refused.status, 2, refused.stdout + refused.stderr); assert.match(refused.stderr, new RegExp(`this run has already made ${made} top-layer read`));
  assert.equal(JSON.stringify(p.runJson()), before, 'run.json is unchanged');
  assert.deepEqual(ledger(p).filter(l => l.event === 'stop_answer_closed').map(l => [l.gate, l.code]), [[q.gate, 'number_refused']]);
  const again = p.run(['--resume', p.runDir, '--continue', '--stop-gate', q.gate]);
  assert.equal(again.status, 2); assert.match(again.stderr, /no answered stop_decision gate of this run by that name matches this stop/, 'the closed answer is never consumed');
  assert.equal(p.runJson().roundChoices, undefined);
  const q2 = await call(p, { step: 'quote' });
  assert.notEqual(q2.gate, q.gate);
  const r2 = await call(p, { step: 'answer', gate: q2.gate, shown: q2.shown, choice: 'continue', person_words: WORDS, rounds: made + 2 });
  assert.equal(r2.error, undefined, JSON.stringify(r2).slice(0, 300));
  await untilRunIdle(p.runDir, 180_000);
});

test('AS-3 (pure, the final-read stop): applyTypedRounds takes no stop kind, so a relayed number at the final-read stop goes through the same function as at every other stop (same saved limit); and the gate takes a relayed continue with a number at a final-read stop id', () => {
  const cli = readFileSync(join(root, 'src', 'cli.js'), 'utf8');
  const fn = cli.split('\n').find(l => l.startsWith('function applyTypedRounds(n)'));
  assert.ok(fn, 'applyTypedRounds is one function with one parameter');
  assert.doesNotMatch(fn, /kind|why|stop/, 'it reads no stop kind');
  assert.match(cli, /if \(a\.rounds !== undefined\) applyTypedRounds\(a\.rounds\);/, 'the gate\'s number takes it at the entry site with no condition on the stop');
  assert.match(cli, /^    applyTypedRounds\(n\);$/m, 'and the typed number takes the same function');
  const base = mkdtempSync(join(tmpdir(), 'ans-after-fr-')); projects.push({ done: () => rmSync(base, { recursive: true, force: true }) });
  const d = join(base, 'run-1'); mkdirSync(d);
  const stop = { kind: 'layer_bound', why: 'final_read', layer: 3, top_layer: 3, pass: 2, overseer_round: 1, attempt: 0 };
  writeFileSync(join(d, 'report-partial.json'), JSON.stringify({ stop }));
  const id = 'layer_bound:1:2:final_read0'; writeFileSync(join(d, 'q.md'), `Stop ${id}: x\n`);
  const asked = requestStopQuote(d, { textPath: 'q.md', stopId: id }); assert.equal(asked.ok, true, JSON.stringify(asked));
  assert.equal(answerStopRelayed(d, asked.gate.id, { shownSha256: asked.gate.sha256, personWords: WORDS, choice: 'continue', rounds: 9 }).ok, true);
});

test('AS-4 (a close that cannot be written): the refusal still exits 2 with the terminal\'s sentence, run.json is unchanged and nothing is run; the answer stays readable (it is not closed)', { skip: process.getuid?.() === 0 ? 'runs as root: a read-only ledger file does not stop the append, so the close would be written (UNVERIFIED on the box)' : false }, async () => {
  const p = project(stallChain('as4'), []);
  assert.equal(p.partial().kind, 'stall_stop', 'the premise (a prediction): the ladder chain stops at a stall');
  const made = LR.topLayerReadsMade(p.runDir, p.config);
  const q = await call(p, { step: 'quote' });
  assert.equal(answerStopRelayed(p.runDir, q.gate, { shownSha256: q.shown, personWords: WORDS, choice: 'continue', rounds: made }).ok, true);
  const before = JSON.stringify(p.runJson()); const files = readdirSync(p.runDir).filter(f => /^(panel|revise|build)-/.test(f)).sort();
  const ledgerFile = join(p.runDir, LEDGER_FILE); chmodSync(ledgerFile, 0o444);   // the close cannot be appended
  try {
    const r = p.run(['--resume', p.runDir, '--continue', '--stop-gate', q.gate]);
    assert.equal(r.status, 2, r.stdout + r.stderr); assert.match(r.stderr, new RegExp(`this run has already made ${made} top-layer read`));
    assert.equal(JSON.stringify(p.runJson()), before, 'run.json is unchanged');
    assert.deepEqual(readdirSync(p.runDir).filter(f => /^(panel|revise|build)-/.test(f)).sort(), files, 'nothing was run');
  } finally { chmodSync(ledgerFile, 0o644); }
  assert.deepEqual(ledger(p).filter(l => l.event === 'stop_answer_closed'), [], 'the close was not written');
});

test('AS-5 (an early exit that does not close): a command naming the answered gate with the OTHER choice exits 2 before anything is recorded and does not close the answer; the stop is quoted at once (a new gate, since the answered one is no longer pending) and answered again, and the run takes that answer, attributed to the new gate', async () => {
  const p = project(ladderChain('as5'), ['--rounds', '2']);
  const q = await call(p, { step: 'quote' });
  assert.equal(answerStopRelayed(p.runDir, q.gate, { shownSha256: q.shown, personWords: WORDS, choice: 'finish' }).ok, true);
  const wrong = p.run(['--resume', p.runDir, '--continue', '--stop-gate', q.gate]);
  assert.equal(wrong.status, 2, wrong.stdout + wrong.stderr); assert.match(wrong.stderr, /no answered stop_decision gate of this run by that name matches this stop/);
  assert.equal(p.runJson().roundChoices, undefined, 'nothing recorded');
  assert.deepEqual(ledger(p).filter(l => l.event === 'stop_answer_closed'), [], 'this exit does not close the answer');
  const q2 = await call(p, { step: 'quote' });
  assert.notEqual(q2.gate, q.gate, 'quoted again at once: a new gate');
  const r = await call(p, { step: 'answer', gate: q2.gate, shown: q2.shown, choice: 'continue', person_words: WORDS });
  assert.equal(r.error, undefined, JSON.stringify(r).slice(0, 300));
  await untilRunIdle(p.runDir, 180_000);
  const e = p.runJson().roundChoices[0];
  assert.deepEqual([e.choice, e.relayed, e.gate], ['continue', true, q2.gate], 'attributed to the new gate');
});
