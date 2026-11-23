// 0.8.4 S9 + S9a (the proposer return; Q10, D8, D29): the top layer's decision-level objection ends an overseer round and one decision goes back to the proposers (3P calls at most), or, with no proposer seat, to the writer. $0, offline.
// The harness is the one of test/s7-go-up.test.js: the cache stub answers every stage by its label, setPromptSpy reads every prompt. The S9 words are injected (setHeldForTest). Every NEGATIVE row (nothing returned, nothing sent) carries a POSITIVE CONTROL in the same
// test (the same fixture, one input changed, the calls DO happen), so a zero count cannot be vacuous; counts are of served `return-*` labels, never of a missing export.
// Rows: T10a T10b(pin) T10c T10d T10e T10f T10h T20m T20y, the Q10(b) frame (no raising seat in any return prompt), the writer note, the numbering sentence, the refused marks.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { runChain, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import * as RS from '../src/report-shape.js';   // a namespace: renderProposerReturnsBoard is this unit's export
import { setHeldForTest } from '../src/held-roles.js';
import { stopIdOf } from '../src/overseer-rounds.js';
import { objectionId } from '../src/objection-ids.js';
import { builderSystemOf, reviserSystemFor } from '../src/stage-system.js';
import { estimateChainRows, estimateTokens, DEFAULT_ESTIMATE, SEAT_DEFAULT_MAX_TOKENS } from '../src/cost.js';
import * as RL from '../src/roles.js';
const PR = await import('../src/proposer-return.js').catch(() => ({}));   // a dynamic import: on a tree without the module a row fails by assertion, not at link time
import * as HS9 from './held-prompts/held-084-s9.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });

import { S9, CRITERION, PLAN, meets, objects, D1, D2, W1, NAME, ALT, POST, ANSWER, returnLabels, failuresOf, withdrawAll, run, idsInReply } from './helpers/proposer-return-fixture.js';

test('T10a (Q10): a decision-level objection naming Decision 1, quoting its Choice line and citing a criterion: exactly 3P = 9 return calls at P = 3, in three rounds, then the climb restarts at LAYER 1', async () => {
  const { served, returns, prompts } = await run();
  assert.deepEqual(returnLabels(served).filter(l => l.startsWith('return-alt-')).sort(), ['prop-0', 'prop-1', 'prop-2'].map(k => `return-alt-1-${k}`));
  assert.equal(returnLabels(served).length, 9);
  assert.deepEqual(['alt', 'post', 'answer'].map(k => returnLabels(served).filter(l => l.startsWith(`return-${k}-`)).length), [3, 3, 3]);
  const at = l => served.indexOf(l);
  assert.ok(at('return-alt-1-prop-0') < at('return-post-1-prop-0') && at('return-post-1-prop-0') < at('return-answer-1-prop-0') && at('return-answer-1-prop-2') < at('revise-1'), 'alternatives, posts, answers, then the writer');
  assert.ok(at('panel-2-raiser-alpha') > at('revise-1') && (at('panel-2-mid-beta') === -1 || at('panel-2-mid-beta') > at('panel-2-raiser-alpha')), 'pass 2 restarts at layer 1 (FAIL = it restarts at layer 2)');
  assert.deepEqual(returns.map(r => [r.route, r.status, r.entry, r.selected_by, r.calls, r.writer_step]), [['proposers', 'ran', 1, 'first_listed', 9, 'revise-1']]);
  assert.match(prompts.get('revise-1').user, /For the decision named below, integrate one of the alternatives, or keep the original and give your reasons/);
});

// NEW (0.8.4 apply, group 7, C&C RULING_STEP5_6 E and the 12 Nov ruling on row 4: the return rows are listed on every shipped chain and a ladder run asks for all 9). RET-IN: the proposer return's input rows BY TERM, with the prompt-spy leg: on this fixture (no estimate block: DEFAULT_ESTIMATE; P = 3 proposers of cap 3000) the maximum lists 3P rows, n - 1 times each, whose per-call input is
// return-alt = promptTokens + draftTokens + 1000 + the system line, return-post = promptTokens + 1000 + the other proposers' caps + the system line, return-answer = promptTokens + 1000 + its own cap + the others' caps + the system line; the system line SENT by the spied return calls is the line priced, and no spied prompt is larger than its priced row (the unit is an upper bound).
test('RET-IN (T10a shape): the return rows of the maximum by term, and the return prompts SENT carry the priced system line and stay within their rows', async () => {
  const { prompts, served, config } = await run();
  const labels = returnLabels(served); assert.equal(labels.length, 9, 'control: the fixture sends the 9 return calls');
  const a = { ...DEFAULT_ESTIMATE, ...(config.estimate || {}) }; const line = estimateTokens(RL.proposerReturnSystem());
  const capOf = seat => seat.maxTokens ?? SEAT_DEFAULT_MAX_TOKENS; const props = config.seats.proposers; const N = config.maxOverseerRounds;
  const rows = estimateChainRows(config, { maximum: true }).filter(r => r.label.startsWith('return-')); const perCall = r => r.input / (r.times ?? 1);
  assert.equal(rows.length, 3 * props.length, '3P rows'); assert.equal(estimateChainRows(config, { maximum: false }).filter(r => r.label.startsWith('return-')).length, 0, 'none in the expected figure');
  for (const seat of props) {
    const others = props.filter(o => o !== seat).reduce((t, o) => t + capOf(o), 0); const row = kind => rows.find(r => r.label === `return-${kind}-${seat.lab}`);
    for (const kind of ['alt', 'post', 'answer']) assert.equal(row(kind).times ?? 1, N - 1, `${seat.lab}: return-${kind} runs n - 1 times (a row that runs once carries no times field)`);
    assert.equal(perCall(row('alt')), a.promptTokens + a.draftTokens + 1000 + line, `${seat.lab}: return-alt = prompt + draft + 1000 + the system line (no proposals stage: no skeleton term)`);
    assert.equal(perCall(row('post')), a.promptTokens + 1000 + others + line, `${seat.lab}: return-post`);
    assert.equal(perCall(row('answer')), a.promptTokens + 1000 + capOf(seat) + others + line, `${seat.lab}: return-answer`);
    for (const kind of ['alt', 'post', 'answer']) {
      const sent = prompts.get(`return-${kind}-1-${seat.lab}`); assert.ok(sent, `${seat.lab}: return-${kind} was sent`);
      assert.equal(estimateTokens(sent.system), line, `${seat.lab}: the system line SENT in return-${kind} is the line priced`);
      assert.ok(estimateTokens(sent.system) + estimateTokens(sent.user) <= perCall(row(kind)), `${seat.lab}: the return-${kind} prompt SENT is within its priced row`);
    }
  }
});

test('T10b NAMED PIN (unreachable through the loop: a top-layer objection always ends the overseer round, so a second return cannot be asked for): the slot guard is true once per overseer round. FAIL = the guard returns true for a round that already had its return', () => {
  const done = new Set();
  assert.equal(PR.returnSlotFree?.(done, 1), true);
  done.add(1);
  assert.equal(PR.returnSlotFree?.(done, 1), false);
  assert.equal(PR.returnSlotFree?.(done, 2), true, 'the next overseer round has its own slot');
});

test('T10c (Q10): a WORDING-level objection goes to the writer: no return call, no record; the decision-level twin of the same fixture makes 9 (positive control)', async () => {
  const wording = await run({ top: [W1] });
  assert.equal(returnLabels(wording.served).length, 0);
  assert.deepEqual(wording.returns, []);
  assert.ok(wording.served.includes('revise-1'), 'the writer revised for the wording objection');
  assert.equal(returnLabels((await run({ top: [D1] })).served).length, 9, 'control');
});

test('T10d (Q10): a decision-level objection in the LAST allowed round stops the run, no return starts; the same fixture with a --continue (T10h) makes the 9', async () => {
  const stopped = await run({ ov: { rounds: 1, bounds: { 1: 1, 2: 1 } } }).then(() => null, e => e);
  assert.ok(stopped?.stop, 'the run stopped at the overseer cap');
  assert.equal(returnLabels(stopped.served).length, 0, 'FAIL = a return starts at the stop');
  const stop = stopped.stop;
  // T10h: the person continues at that stop (one more overseer round): the return runs at the start of the round the continue adds
  const cont = await run({ ov: { rounds: 1, bounds: { 1: 1, 2: 1 } }, roundChoices: [{ stop: stopIdOf(stop), choice: 'continue', kind: 'overseer_cap', overseer_round: stop.overseer_round, add: 1 }] });
  assert.equal(returnLabels(cont.served).length, 9, 'T10h: one return, whose 3P calls are the 3P of that continue');
  assert.deepEqual(cont.returns.map(r => [r.status, r.overseer_round]), [['ran', stop.overseer_round]]);
  assert.ok(cont.served.indexOf('return-alt-1-prop-0') < cont.served.indexOf('revise-1'));
});

test('T10e (Q10): two decision-level objections (Decision 1 and Decision 2), layer 3 names Decision 2: ONE return (9 calls, not 18), for Decision 2; the Decision 1 objection goes to the writer', async () => {
  const both = objects(D1, D2).replace('"verdict_line":"no"', '"verdict_line":"no","most_consequential":2');
  const { served, returns, prompts } = await run({ scripts: { 'panel-1-top-gamma': both } });
  assert.equal(returnLabels(served).length, 9);
  assert.deepEqual(returns.map(r => [r.entry, r.selected_by]), [[2, 'named']]);
  const revise = prompts.get('revise-1').user;
  assert.match(revise, /Decision 2/);
  assert.match(revise, /Decision 1 picks one store for all data\./, 'the other objection reaches the writer as an ordinary one');
  assert.ok(prompts.get('return-alt-1-prop-0').user.includes('Decision 2 queues in process.') && !prompts.get('return-alt-1-prop-0').user.includes('Decision 1 picks one store'));
  // T10e twin: nothing named, one top-layer seat: the FIRST objection in that reply's own order is taken (the order W8 promises), and a placeholder entry listed first shifts nothing
  const reversed = objects(D2, D1);
  assert.deepEqual((await run({ scripts: { 'panel-1-top-gamma': reversed } })).returns.map(r => [r.entry, r.selected_by]), [[2, 'first_listed']]);
  const withPlaceholder = JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'e' }], failures: [{}, D2, D1], verdict_line: 'no' });
  assert.deepEqual((await run({ scripts: { 'panel-1-top-gamma': withPlaceholder } })).returns.map(r => [r.entry, r.selected_by]), [[2, 'first_listed']]);
  // two top-layer seats, one signs off, the other lists two decision marks and names neither: the marks sit with ONE seat, so the first LISTED is taken (W8's promise), not the one with the smaller id
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: each mark's id was objectionId('top-gamma', f). NEW: the ids a seat's first reply gets, in listed order (idsInReply): D1 and D2 quote nothing, so they share one derived key and the second takes #2. WHY: relationRule (W6) is recorded (K6).
  const firstIds = idsInReply([D1, D2]);
  const [lo, hi] = [D1, D2].map((f, i) => [firstIds[i], f]).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(x => x[1]);
  assert.notEqual(hi.entry, lo.entry);
  const two = await run({ topSeats: ['top-gamma', 'top-delta'], scripts: { 'panel-1-top-gamma': objects(hi, lo) } });
  assert.deepEqual(two.returns.map(r => [r.entry, r.selected_by]), [[hi.entry, 'first_listed']], 'FAIL = the id order (or the seat count) picked the other mark');
  assert.equal(returnLabels(two.served).length, 9);
  // and by the ledger's order the id order could differ: D1 first in the reply gives Decision 1
  assert.deepEqual((await run({ scripts: { 'panel-1-top-gamma': objects(D1, D2) } })).returns.map(r => r.entry), [1]);
});

test('T10f (Q10(c)): one proposer\'s alternative does not parse: recorded unreadable, NO retry (its label asked once), 8 calls in all (3 alternatives, 3 posts, 2 answers: it has no alternative to defend), the writer note carries the readable ones only', async () => {
  const { served, returns, prompts } = await run({ scripts: { 'return-alt-1-prop-1': 'this is not json' } });
  assert.equal(served.filter(l => l === 'return-alt-1-prop-1').length, 1, 'FAIL = a retry call is made');
  assert.equal(returnLabels(served).length, 8);
  assert.equal(served.includes('return-answer-1-prop-1'), false, 'an author with no readable alternative has nothing to answer for');
  assert.ok(served.includes('return-post-1-prop-1'), 'it still reads the others\' alternatives and posts');
  const [r] = returns;
  assert.deepEqual(r.alternatives.map(a => [a.lab, a.status]), [['prop-0', 'readable'], ['prop-1', 'unreadable'], ['prop-2', 'readable']]);
  assert.equal(r.status, 'ran');
  const revise = prompts.get('revise-1').user;
  assert.ok(revise.includes('Two stores (alpha)') && revise.includes('Two stores (gamma)') && !revise.includes('this is not json'));
});

test('T10f (none readable): every alternative unreadable: the return is FAILED after round 1 (P calls), no post, no answer, and the objection is an ordinary one for the writer (no integration note)', async () => {
  const bad = Object.fromEntries([0, 1, 2].map(i => [`return-alt-1-prop-${i}`, 'nope']));
  const { served, returns, prompts } = await run({ scripts: bad });
  assert.equal(returnLabels(served).length, 3);
  assert.deepEqual(returns.map(r => [r.status, r.calls]), [['failed', 3]]);
  const revise = prompts.get('revise-1').user;
  assert.doesNotMatch(revise, /For the decision named below/);
  assert.match(revise, /Decision 1 picks one store for all data\./);
});

test('one readable alternative only: the others post on it, its author answers: P + (P - 1) + 1 = 6 calls at P = 3', async () => {
  const { served } = await run({ scripts: { 'return-alt-1-prop-1': 'nope', 'return-alt-1-prop-2': '{}' } });
  assert.equal(returnLabels(served).filter(l => l.startsWith('return-alt-')).length, 3);
  assert.deepEqual(['post', 'answer'].map(k => returnLabels(served).filter(l => l.startsWith(`return-${k}-`)).length), [2, 1]);
  assert.equal(served.includes('return-post-1-prop-0'), false, 'the only author has no OTHER alternative to read');
});

test('T20m / T20y (S9a, D29): NO proposer seat: no return call, the route writer recorded with the contested entry, the writer step carries W29(ii) and the entry in full, the climb restarts at layer 1, the objection is not dropped; with proposers the same fixture returns', async () => {
  const { served, returns, prompts } = await run({ proposers: 0 });
  assert.equal(returnLabels(served).length, 0, 'T20m FAIL = a proposer call is made');
  assert.deepEqual(returns.map(r => [r.route, r.status, r.entry, r.writer_step]), [['writer', 'no_proposers', 1, 'revise-1']]);
  const revise = prompts.get('revise-1').user;
  assert.match(revise, /For the decision named below, reconsider the Choice: keep it and give your reasons, or change it/);
  assert.ok(revise.includes('### Decision 1: Storage') && revise.includes('Decision 1 picks one store for all data.'), 'T20y: the entry in full and the objection reach the writer, nothing is dropped as unroutable');
  assert.doesNotMatch(revise, /integrate one of the alternatives/);
  assert.ok(served.indexOf('panel-2-raiser-alpha') > served.indexOf('revise-1'));
  assert.equal(returnLabels((await run({ proposers: 3 })).served).length, 9, 'control');
});

test('Q10(b): on a chain with a proposals stage the skeleton reaches the first return call as text (not as the stage record); without a proposals stage the section is absent', async () => {
  const withSk = await run({ proposals: true });
  assert.equal(returnLabels(withSk.served).filter(l => l.startsWith('return-alt-')).length, 3);
  assert.ok(withSk.prompts.get('return-alt-1-prop-0').user.includes('# Skeleton of the plan\n\nSKELETON-MARKER-TEXT'));
  assert.ok(!(await run()).prompts.get('return-alt-1-prop-0').user.includes('# Skeleton of the plan'));
});

test('Q10(b): no return prompt (system or user) names the raising seat, its lab, its model or its seat key; they carry the request, the criteria, the plan, the numbered entry and the objection', async () => {
  const { prompts } = await run();
  const all = [...prompts.entries()].filter(([l]) => l.startsWith('return-'));
  assert.equal(all.length, 9);
  for (const [label, p] of all) {
    const text = `${p.system}\n${p.user}`;
    assert.doesNotMatch(text, /top-gamma|mock-review-fixture|raiser-alpha|mid-beta/, label);
    assert.ok(text.includes('Decision 1') && text.includes(CRITERION) && text.includes('Decision 1 picks one store for all data.'), `${label}: the entry and the objection`);
  }
  const alt = prompts.get('return-alt-1-prop-0').user;
  assert.ok(alt.includes('Write a worker plan with a retry limit.') && alt.includes('### Decision 2: Queue'), 'the request and the current plan');
  assert.equal(prompts.get('return-alt-1-prop-0').system, HS9.proposerReturnSystem());
});

test('W8: the top layer\'s review prompt carries the decision-level note (rule and keys) once the words are recorded and the Decisions rule is on; layers 1 and 2, the held state and a chain without the Decisions rule carry nothing', async () => {
  const on = await run();
  const top = on.prompts.get('panel-1-top-gamma').user;
  assert.ok(top.includes(HS9.decisionLevelRule()) && top.includes(HS9.decisionLevelKeys()));
  for (const l of ['panel-1-raiser-alpha', 'panel-1-mid-beta']) assert.ok(!on.prompts.get(l).user.includes(HS9.decisionLevelRule()), l);
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: a `held: {}` run carried no decision-level note and made no return call. NEW: that held half is removed (K7, SIBLING: the first half of this row and T10a assert the recorded note and the return). The `decisions: false` half stays: it is a chain switch a person can set. WHY: decisionLevelRule and the S9 batch are recorded.
  const noRule = await run({ decisions: false });
  assert.ok(!noRule.prompts.get('panel-1-top-gamma').user.includes(HS9.decisionLevelRule()));
  assert.equal(returnLabels(noRule.served).length, 0);
});

test('refused marks are NOT decision-level: an entry that does not exist, a Choice quote that is not in the entry, a missing entry number: no return, recorded as refused with the reason, the objection goes to the writer; the valid twin returns (control)', async () => {
  for (const [name, f, reason] of [
    ['no such entry', { ...D1, entry: 7 }, 'entry_not_found'],
    ['quote not in the entry', { ...D1, choice: 'Use MySQL for everything.' }, 'choice_not_found'],
    ['quote from another field', { ...D1, choice: 'Postgres needs a server the request does not have.' }, 'choice_not_found'],
    ['no entry number', { ...D1, entry: undefined }, 'entry_not_a_number'],
  ]) {
    const { served, returns, prompts } = await run({ top: [f] });
    assert.equal(returnLabels(served).length, 0, name);
    assert.deepEqual(returns.map(r => [r.route, r.status, r.refused]), [['writer', 'refused', reason]], name);
    assert.match(prompts.get('revise-1').user, /Decision 1 picks one store for all data\./, `${name}: the objection reaches the writer`);
  }
  assert.equal(returnLabels((await run({ top: [D1] })).served).length, 9, 'control');
});

test('classification and selection, pure: the entry named by more seats wins, ties go to the ledger\'s first, a mark of another seat naming nothing counts for nothing', () => {
  const verdicts = [
    { lab: 'a', failures: [{ id: 'O-a1', level: 'decision', entry: 1, choice: 'SQLite for the first release, with a migration path to Postgres.' }, { id: 'O-a2', level: 'decision', entry: 2, choice: 'an in-process queue for background jobs.' }], mostConsequential: 2 },
    { lab: 'b', failures: [{ id: 'O-b1', level: 'decision', entry: 1, choice: 'SQLite for the first release, with a migration path to Postgres.' }, { id: 'O-b2', level: 'decision', entry: 2, choice: 'an in-process queue for background jobs.' }], mostConsequential: 'Decision 2' },
    { lab: 'c', failures: [{ id: 'O-c1', level: 'wording' }], mostConsequential: undefined },
  ];
  const { marks, refused, named } = PR.classifyDecisionObjections?.({ plan: PLAN, verdicts });
  assert.equal(marks.length, 4); assert.deepEqual(refused, []);
  assert.deepEqual([...named], [['a', 2], ['b', 2]]);
  const rank = m => [1, m.lab, m.id];
  assert.deepEqual((({ mark, selected_by }) => [mark.id, selected_by])(PR.selectReturnMark?.({ marks, named, rankOf: rank })), ['O-a2', 'named']);
  assert.deepEqual((({ mark, selected_by }) => [mark.id, selected_by])(PR.selectReturnMark?.({ marks, named: new Map([['a', 1], ['b', 2]]), rankOf: rank })), ['O-a1', 'majority'], 'one vote each: the ledger\'s first entry');
  assert.deepEqual((({ mark, selected_by }) => [mark.id, selected_by])(PR.selectReturnMark?.({ marks, named: new Map(), rankOf: rank })), ['O-a1', 'first_recorded']);
  assert.equal(PR.selectReturnMark?.({ marks: [], named: new Map(), rankOf: rank }), null);
});

test('refusalWords: one sentence per reason', () => {
  assert.equal(PR.refusalWords?.('entry_not_found', 7), 'the plan has no Decision 7');
  assert.equal(PR.refusalWords?.('choice_not_found', 1), 'its quoted Choice line is not in Decision 1');
  assert.equal(PR.refusalWords?.('entry_ambiguous', 2), 'two entries are numbered 2');
  assert.equal(PR.refusalWords?.('entry_not_a_number'), 'it does not name an entry by number');
  assert.equal(PR.refusalWords?.('no_decisions_section'), 'the plan has no Decisions section');
});

test('W13: the numbering sentence ends the builder\'s and the reviser\'s system text where the Decisions rule is on and the sentence is recorded; nothing otherwise', () => {
  const sentence = HS9.decisionsNumberingRule();
  setHeldForTest(S9);
  assert.ok(builderSystemOf(false, { decisions: true }).endsWith(`\n\n${sentence}`));
  assert.ok(reviserSystemFor(false, false)(false, false, { decisions: true }).endsWith(`\n\n${sentence}`));
  assert.ok(reviserSystemFor(false, true)(false, false, { decisions: true }).endsWith(`\n\n${sentence}`), 'patch mode too');
  assert.ok(!builderSystemOf(false, { decisions: false }).includes(sentence) && !reviserSystemFor(false, false)(false, false, {}).includes(sentence), 'the Decisions rule off');
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: with `{}` held the numbering sentence was absent from both system texts. NEW: that held half is removed (K7, SIBLING: the assertions above in this row). WHY: decisionsNumberingRule is recorded.
});

test('a resume replays the same text: the order of the alternatives a reader is shown is a pure function of the run, the round, the reader and the kind (sorted by key, or seeded when debate_hygiene.shuffle is on)', async () => {
  const a = await run({ shuffle: true }); const b = await run({ shuffle: true });
  for (const l of ['return-post-1-prop-0', 'return-post-1-prop-1', 'return-post-1-prop-2', 'return-answer-1-prop-0', 'return-answer-1-prop-1', 'return-answer-1-prop-2']) assert.equal(a.prompts.get(l).user, b.prompts.get(l).user, l);
  const plain = await run();
  // the seeded path is really taken: for the run id of this fixture the seeded order equals the key order in every POST prompt (two others to read; sha256 of 'r-return|return-1|post|<reader>|<key>'), so the post prompts alone would prove nothing; the ANSWER prompt of prop-0 shows its two posts seeded (gamma first) and, without the shuffle, by key (beta first)
  const seeded = a.prompts.get('return-answer-1-prop-0').user; const byKey = plain.prompts.get('return-answer-1-prop-0').user;
  assert.ok(seeded.indexOf('Post one by gamma') < seeded.indexOf('Post one by beta'), 'seeded order with the shuffle');
  assert.ok(byKey.indexOf('Post one by beta') < byKey.indexOf('Post one by gamma'), 'key order without the shuffle');
  const text = plain.prompts.get('return-post-1-prop-0').user;
  assert.ok(text.indexOf('Two stores (beta)') < text.indexOf('Two stores (gamma)'), 'sorted by seat key without the shuffle');
  assert.doesNotMatch(text, /prop-1|prop-2/, 'only the choices are shown, never the seat that wrote them');
});

// ---- the record: report.json proposer_returns, its schema, and BOARD.md
const validator = () => { const schema = JSON.parse(readFileSync(new URL('../schemas/report-v1.json', import.meta.url), 'utf8')); const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true }); ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' }); return ajv.compile(schema); };

test('the record: report.json carries proposer_returns for a return, a writer route and a refused mark, validates against report-v1, and the raising seat is nowhere in it; a run with no decision-level objection has no such key', async () => {
  const validate = validator();
  const ran = await run();
  assert.ok(validate(ran.report), JSON.stringify(validate.errors, null, 2));
  const [row] = ran.report.proposer_returns;
  assert.deepEqual([row.overseer_round, row.pass, row.route, row.status, row.entry, row.entry_title, row.selected_by, row.calls, row.writer_step], [1, 1, 'proposers', 'ran', 1, 'Storage', 'first_listed', 9, 'revise-1']);
  assert.equal(row.choice, 'SQLite for the first release, with a migration path to Postgres.');
  assert.deepEqual(row.alternatives.map(a => [a.lab, a.status]), [['prop-0', 'readable'], ['prop-1', 'readable'], ['prop-2', 'readable']]);
  assert.ok(row.alternatives[0].alt.choice.startsWith('Two stores') && row.posts.length === 3 && row.answers.length === 3);
  assert.doesNotMatch(JSON.stringify(ran.report.proposer_returns), /top-gamma|mock-review-fixture/, 'the raising seat is not named');
  for (const opts of [{ proposers: 0 }, { top: [{ ...D1, entry: 7 }] }, { scripts: { 'return-alt-1-prop-1': 'nope' } }]) {
    const r = await run(opts);
    assert.ok(validate(r.report), JSON.stringify(validate.errors, null, 2));
    assert.equal(r.report.proposer_returns.length, 1);
  }
  const none = await run({ top: [W1] });
  assert.equal('proposer_returns' in none.report, false);
  assert.ok(validate(none.report));
  // CHANGED ACCEPTED TEST (0.8.4 apply, own commit after group 7; C&C 12 Nov: "hold the word out in the test, or re-aim the row at the recorded state"). The row was red from dc60423a (job 110: green at f60ebad2; at dc60423a a different first error, 16 of 19 rows red; this line itself red at 6c08410b, job 102). OLD: `run({ held: {} })` with the comment "the S9 words held: the key is absent from every report": an empty held map no longer holds anything back (the S9 words are recorded in src/roles.js, K7), so the run returns to the proposers and the key is present.
  // NEW: the same claim at its REAL off, `decisions: false`: with the Decisions rule off no objection is decision-level (src/call-gates.js proposerReturnOn = decisionLevelOn && proposers), so no return can start (proposerReturnOn is false: nothing goes back to the proposers) and no `proposer_returns` key is written (the key is read from the code path; whether a writer-route record exists for the same objection is not what this line pins). WHY: a state a run can have (a chain without the Decisions rule) instead of a held-off state no shipped run has; the red source is the same assertion on the default run (decisions on), where the key appears.
  assert.equal('proposer_returns' in (await run({ decisions: false })).report, false, 'decisions off: the key is absent from every report');
});

test('BOARD.md: a "Proposer returns" section for people, one line per row, nothing when there are no rows', async () => {
  const ran = await run();
  const board = RS.renderBoardMd({ result: ran.result, config: ran.config, runId: 'r-return', chain: 'fixture-return', task: 't.md' });
  assert.match(board, /\n## Proposer returns\n/);
  assert.match(board, /- Overseer round 1, pass 1: Decision 1 \(Storage\) went back to 3 proposer\(s\): 3 of 3 alternative\(s\) read, 3 post\(s\), 3 answer\(s\)\. It was chosen as the first the seat listed\. The writer's step was revise-1\./);
  assert.doesNotMatch(board, /top-gamma[^\n]*Decision 1 \(Storage\) went back/);
  const rows = [
    { overseer_round: 1, pass: 2, route: 'writer', status: 'no_proposers', entry: 2, entry_title: 'Queue', objection_id: 'O-x' },
    { overseer_round: 2, pass: 5, route: 'proposers', status: 'failed', entry: 1, entry_title: 'Storage', objection_id: 'O-y' },
    { overseer_round: 2, pass: 6, route: 'writer', status: 'refused', entry: 7, objection_id: 'O-z', refused: 'entry_not_found' },
    { overseer_round: 3, pass: 8, route: 'proposers', status: 'ran', entry: 1, entry_title: 'Storage', objection_id: 'O-w', selected_by: 'named', writer_step: 'revise-8', alternatives: [{ lab: 'p', status: 'unreadable' }, { lab: 'q', status: 'readable' }], posts: [], answers: [] },
  ];
  const text = RS.renderProposerReturnsBoard?.(rows);
  assert.match(text, /Decision 2 \(Queue\) is contested and the chain has no proposer seat, so the objection went to the writer with the entry in full\./);
  assert.match(text, /Decision 1 \(Storage\) went back to the proposers, but no alternative could be read; the objection went to the writer as an ordinary one\./);
  assert.match(text, /an objection \(O-z\) marked as a decision was not taken as one: the plan has no Decision 7; it went to the writer as an ordinary objection\./);
  assert.match(text, /chosen because the top layer named it as the most consequential\. The writer's step was revise-8\. Unreadable: 1 alternative\(s\)\./);
  assert.match(RS.renderProposerReturnsBoard?.([rows[3]], 2), /chosen because layer 2 named it as the most consequential\./, 'the number comes from the run\'s own top layer (a two-layer run), not from a default');
  assert.equal(RS.renderProposerReturnsBoard?.([]), '');
  assert.equal(RS.renderProposerReturnsBoard?.(undefined), '');
  assert.doesNotMatch(RS.renderBoardMd({ result: (await run({ top: [W1] })).result, config: ran.config, runId: 'r-return', chain: 'fixture-return', task: 't.md' }), /Proposer returns/);
});
