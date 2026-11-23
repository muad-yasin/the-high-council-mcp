// 0.8.4 (R1, a record path): a finish at once at the FINAL-READ stop of a NOT-agreed layered run records that stop. Before: the finish-now branch (src/chain.js, the final-read loop) set no `finishedStop`, so the report had no `stop`, no
// `stop_kind`, and an `ending_word` that came from whatever flag the run had set (here round_cap); only final_read.reason said finished_at_once. The docs already promise the stop (CHANGELOG `stop_kind`, docs/report-format.md,
// schemas/report-v1.json lists layer_bound/final_read), and the person is told that layer 3 did not sign off on the plan (his 05 Nov rule; the sentence is src/overseer-rounds.js didNotSignOffPhrase, read through verdict-headline.js).
// Offline, mock seats, $0. The fixture is the layered scenario of test/helpers/layer-two-run.js with NO overseer rounds, so the run ends at its round cap with only layer 1 asked (no earlier finish, no stop: the state R1 names as case 1);
// both layer-3 seats are a model that never gives a readable reply, so the final read stops the run. (test/finish-now.test.js FN-5 reaches the same stop through a credential-pause finish: an earlier finish exists there, which is the control below.)
// passed, outcome and the exit predicate do not move: the run is not agreed either way.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { RoundStopped, setCache, setBudget, setPromptSpy, setOutboundScan } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { roundChoiceEntry, didNotSignOffPhrase } from '../src/overseer-rounds.js';
import { reportJsonShape } from '../src/report-shape.js';
import { verdictHeadline, secretFinishWords, budgetFinishWords, ownerPauseFinishWords } from '../src/verdict-headline.js';
import { agreedOf } from '../src/ending-matrix.js';
import { endsNotAgreed } from '../src/ending.js';
import { scenario, CRITERION, repeatOf } from './helpers/layer-two-run.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); setOutboundScan({}); });

const validate = (() => { const ajv = new Ajv2020({ strict: false, allErrors: true }); ajv.addFormat('date-time', true); return ajv.compile(JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'))); })();
const MET = JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok' });
// layer 1 objects in both passes (round 2 is the cap); layers 2 and 3 are never asked; both layer-3 seats never read
const L3 = [['la', 1], ['lb', 2], ['lc', 3, 'mock-unreadable'], ['ld', 3, 'mock-unreadable']];
const RAISE_AGAIN = JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: [repeatOf(5)], verdict_line: 'no' });
const readLabels = tag => ['lc', 'ld'].flatMap(k => [`final-read-${k}${tag}`, `final-read-${k}${tag}-reask1`]);
const ALL = ['', '-c1', '-c2', '-f'].flatMap(readLabels);   // every final-read label is a cache MISS (a real mock call), unless a row leaves one out
const without = labels => ALL.filter(l => !labels.includes(l));

async function atFinalRead({ choices = [], cut = ALL, overrides = {}, extra = {} } = {}) {
  try {
    const done = await scenario({ critics: L3, handler: true, cutLabels: cut, extra: { maxRounds: 2, maxOverseerRounds: undefined, layerRevisions: undefined, ...extra }, overrides: { 'panel-2-la': RAISE_AGAIN, ...overrides }, runExtra: { roundChoices: choices } });
    return { done, report: JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-l2', chain: 'fixture-l2', task: 't.md', result: done.result, config: null }))) };
  } catch (e) { if (e instanceof RoundStopped) return { stop: e.stop }; throw e; }
}
const finishAt = (stop, extra = {}) => ({ ...roundChoiceEntry(stop, 'finish_now', null), ...extra });
const RELAYED = { actor: 'person', channel: 'session', relayed: true, person_words: 'End it now.' };

test('R1 (case 1, no earlier finish): a finish-now at the final-read stop records that stop: stop_kind layer_bound/final_read, ending_word finish_chosen (never round_cap), and says layer 3 did not sign off; not agreed, outcome and the exit predicate as before', async () => {
  const first = await atFinalRead();
  assert.deepEqual([first.stop?.kind, first.stop?.why, first.stop?.top_layer, first.stop?.pass], ['layer_bound', 'final_read', 3, 2], 'the premise: the run stops at the final read, after the round cap');
  const now = await atFinalRead({ choices: [finishAt(first.stop)], cut: without(readLabels('')) });
  assert.ok(now.done, 'the run ended instead of stopping again');
  const rep = now.report;
  assert.deepEqual([rep.ending_word, rep.stop_kind], ['finish_chosen', 'layer_bound/final_read'], 'OLD: round_cap and no stop_kind');
  assert.deepEqual(rep.stop, { kind: 'layer_bound', why: 'final_read', layer: 3, top_layer: 3, pass: 2, overseer_round: 1, attempt: 0, chosen: 'finish', finished_at_once: true });   // the stop as it was raised, plus the person's choice; no `relayed` on a typed finish
  assert.deepEqual([rep.final_read.ran, rep.final_read.reason, rep.final_read.run_end, rep.final_read.seats.some(s => s.read === true)], [true, 'finished_at_once', 'not_agreed', false], 'the record of the read that found nobody is as it was');
  assert.equal(validate(rep), true, JSON.stringify(validate.errors));
  // the whole headline: the person is told layer 3 did not sign off (OLD: the bare "OPEN OBJECTIONS"). No "no judge was asked again" tail: the final read WAS asked (lc and ld, twice each) and got no usable reply (src/verdict-headline.js finishedAtStopWords)
  assert.equal(verdictHeadline(rep).text, `OPEN OBJECTIONS - ${didNotSignOffPhrase(3)}`);
  // not agreed either way: passed, outcome, the agreed reading and the exit predicate (src/cli.js exits EXIT_NOT_AGREED (22) on endsNotAgreed(result); read there, not run) do not move
  assert.deepEqual([rep.passed, rep.outcome, agreedOf(rep), endsNotAgreed(now.done.result)], [false, 'no_consensus', false, true]);
  assert.deepEqual(now.done.served.filter(l => /-f$|-f-reask1$|-c\d/.test(l)), [], 'no further final read was asked');
});

test('R1 (control, a continue instead of the finish-now): the same run continued once with a seat that reads ends the ordinary way: no stop, no stop_kind, ending_word round_cap, not agreed', async () => {
  const first = await atFinalRead();
  const r = await atFinalRead({ choices: [roundChoiceEntry(first.stop, 'continue', null)], cut: without(['final-read-lc-c1']), overrides: { 'final-read-lc-c1': MET } });
  assert.ok(r.done, 'the continue ended the run');
  const rep = r.report;
  assert.deepEqual([rep.ending_word, rep.stop, rep.stop_kind, rep.passed, rep.outcome], ['round_cap', undefined, undefined, false, 'no_consensus']);
  assert.notEqual(rep.final_read.reason, 'finished_at_once');
  assert.equal(validate(rep), true, JSON.stringify(validate.errors));
});

test('R1 (relayed): the finish-now the handling session relayed carries relayed true on the stop and on the final read; the typed one carries neither (the control, the row above)', async () => {
  const first = await atFinalRead();
  const rel = await atFinalRead({ choices: [finishAt(first.stop, RELAYED)], cut: without(readLabels('')) });
  assert.deepEqual([rel.report.stop_kind, rel.report.stop?.chosen, rel.report.stop?.finished_at_once, rel.report.stop?.relayed, rel.report.final_read.relayed], ['layer_bound/final_read', 'finish', true, true, true]);
  assert.equal(validate(rel.report), true, JSON.stringify(validate.errors));
  const typed = await atFinalRead({ choices: [finishAt(first.stop)], cut: without(readLabels('')) });
  assert.deepEqual([typed.report.stop?.relayed, typed.report.final_read.relayed], [undefined, undefined]);
});

test('R1 (the guard, a DELIBERATE exception to "records the final-read stop"): a run finished at a credential-shaped pause and then finished at once at the final-read stop keeps the pause as its stop (stop_kind secret_pause), so the pause keeps its words; green on the unchanged tip too, it pins the exception, not the fix', async () => {
  // the fixture of test/finish-now.test.js FN-5: the armed finish cuts the first revision at a credential-shaped pause; layers 2 and 3 are never asked, then the final read finds nobody
  const secret = async (choices, cut) => {
    setOutboundScan({ finish: true });
    try { const done = await scenario({ critics: L3, handler: true, cutLabels: ['revise-1', ...cut], runExtra: { roundChoices: choices } }); return { done, report: JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-l2', chain: 'fixture-l2', task: 't.md', result: done.result, config: null }))) }; }
    catch (e) { if (e instanceof RoundStopped) return { stop: e.stop }; throw e; }
    finally { setOutboundScan({}); }
  };
  const first = await secret([], ALL);
  assert.deepEqual([first.stop?.kind, first.stop?.why], ['layer_bound', 'final_read'], 'the premise: the run stops at the final read');
  const now = await secret([finishAt(first.stop)], without(readLabels('')));
  assert.ok(now.done, 'the run ended instead of stopping again');
  assert.deepEqual([now.report.ending_word, now.report.stop_kind, now.report.stop.kind, now.report.final_read.reason, now.report.passed], ['finish_chosen', 'secret_pause', 'secret_pause', 'finished_at_once', false]);
  assert.match(verdictHeadline(now.report).text, /^NOT AGREED - finished at the person's choice at a credential-shaped pause in stage "revise-1", NOT agreement: /, 'the pause keeps its own words');
  // C&C 13 Nov, the condition of the guard: those runs still tell him that layer 3 did not sign off (his 05 Nov heading), by the existing clause (OLD: the pause words alone)
  assert.ok(verdictHeadline(now.report).text.endsWith(`, and ${didNotSignOffPhrase(3)}`), verdictHeadline(now.report).text);
  assert.ok(secretFinishWords(now.report).endsWith(`, and ${didNotSignOffPhrase(3)}`));
});

test('R1 (the guard, the spending limit and the owner\'s pause): the words of an earlier finish at the spending limit or at the owner\'s pause, followed by a finish at once at the final-read stop, say that layer 3 did not sign off, once; without that finish they are as they were', () => {
  const layers = [{ round: 2, layer: 1, state: 'objected' }, { round: 2, layer: 2, state: 'not_asked' }, { round: 2, layer: 3, state: 'not_asked' }];
  const readNobody = { ran: true, reason: 'finished_at_once', run_end: 'not_agreed', seats: [{ lab: 'lc', read: false }, { lab: 'ld', read: false }] };
  const clause = `, and ${didNotSignOffPhrase(3)}`;
  const budget = { passed: false, layers, stop: { kind: 'budget_stop', chosen: 'finish', pass: 2, label: 'panel-2-la' } };
  assert.ok(budgetFinishWords({ ...budget, final_read: readNobody }).endsWith(clause), 'the spending limit');
  assert.ok(!budgetFinishWords({ ...budget, final_read: { ran: true, reason: 'every_top_seat_read_this_plan', seats: [] } }).includes('did not sign off'), 'control: a read that was not a finish at once');
  assert.ok(budgetFinishWords({ ...budget, final_read: { ...readNobody, seats: [{ lab: 'lc', read: true }] } }).indexOf('did not sign off') === -1, 'control: a seat read the plan');
  const owner = { passed: false, layers, stop: { kind: 'owner_pause', chosen: 'finish', pass: 3 } };   // no layer row of pass 3: the words carry no layer clause of their own
  assert.equal(ownerPauseFinishWords({ ...owner, final_read: readNobody }).split('did not sign off').length - 1, 1, 'the owner\'s pause: the clause once');
});

test('R1 (case 2, an earlier PLAIN finish at a round stop): finish at the stall stop, then finish-now at the final-read stop: the report records the final-read stop (OLD: stop_kind stall_stop/last_pass, the earlier stop); the stalled facts leave `stop`', async () => {
  const extra = { dispute: { enabled: true, stall_rounds: 2 } };   // layer 1's objection stands unchanged through both passes: the run stops at a stall that cannot be passed up (no pass is left) before the final read is reached
  const s1 = await atFinalRead({ extra });
  assert.deepEqual([s1.stop?.kind, s1.stop?.why], ['stall_stop', 'last_pass'], 'the premise: the first stop');
  const plain = roundChoiceEntry(s1.stop, 'finish', null);   // a plain finish (not at once): the judges after the stop are still asked, so the final read is reached
  const s2 = await atFinalRead({ extra, choices: [plain] });
  assert.deepEqual([s2.stop?.kind, s2.stop?.why], ['layer_bound', 'final_read'], 'the premise: after the plain finish the run stops again, at the final read');
  const s3 = await atFinalRead({ extra, choices: [plain, finishAt(s2.stop)], cut: without(readLabels('')) });
  assert.ok(s3.done, 'the run ended instead of stopping again');
  const rep = s3.report;
  assert.deepEqual([rep.ending_word, rep.stop_kind, rep.passed, rep.outcome], ['finish_chosen', 'layer_bound/final_read', false, 'no_consensus']);
  assert.deepEqual(rep.stop, { kind: 'layer_bound', why: 'final_read', layer: 3, top_layer: 3, pass: 2, overseer_round: 1, attempt: 0, chosen: 'finish', finished_at_once: true }, 'OLD: the stall stop, with its `stalled` facts and no finished_at_once');
  assert.equal(validate(rep), true, JSON.stringify(validate.errors));
  assert.equal(verdictHeadline(rep).text, `OPEN OBJECTIONS - ${didNotSignOffPhrase(3)}`);
});
