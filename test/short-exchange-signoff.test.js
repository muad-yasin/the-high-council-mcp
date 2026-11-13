// 0.8.4 S6 (M1), U6-5: G7, the top-layer sign-off line fails closed (TABLE_ANSWERS_M1 G7; T6b's failing case; Q8). A TOP-layer judge signs off only when the computed rule is clean AND its line is not "no". A "no" with nothing of its own standing is never recorded as a sign-off
// the seat refused: the seat is asked ONCE more for its verdict (a blind verdict call, label ending -reask3, with the held note) and the answer is read ONCE: a clean table signs, an objection named objects (a re-raise of one it withdrew that pass counts), a "does not meet" that names no objection is unheard when the rating demand is recorded and objects (through the failure its FAILED table row carries) when it is not, an unreadable verdict is unheard (the layer's
// unheard handling), and a stated pass is recorded as stated_pass (heard, no sign-off). A missing or garbled line, a layer below the top, a "yes", and a held note change nothing. Offline, $0: the cache stub answers every stage by its label, so the judges answer exactly as the script says.
// WRITTEN WITHOUT A RUN (overnight, no box). The U6-2 rows that inject the pair alone keep passing: without the note, a "no" is recorded and the computed rule decides.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as CHAIN from '../src/chain.js';   // a namespace import: on a tree without SIGNOFF_REASK_TAG the label row fails by an assertion and the file still loads
const { runChain, setPromptSpy, setCache, setBudget } = CHAIN;
import { IN_PASS_REASKS_PER_SEAT } from '../src/cost.js';
import { setHeldForTest } from '../src/held-roles.js';
import { reportJsonShape } from '../src/report-shape.js';
import { objectionId } from '../src/objection-ids.js';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import * as HB084 from './held-prompts/held-084-b.js';
import { DEMAND } from './helpers/rating-demand.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
const validate = ajv.compile(JSON.parse(readFileSync(new URL('../schemas/report-v1.json', import.meta.url), 'utf8')));
const PAIR = { shortExchangeRule: HB084.shortExchangeRule, signoffLineRule: HB084.signoffLineRule };
const WITH_NOTE = { ...PAIR, signoffRefusedReaskNote: HB084.signoffRefusedReaskNote };
const NOTE = HB084.signoffRefusedReaskNote();

const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the scripted failures carried neither `relation` nor `severity`. NEW: X3, Z and X2 carry `severity: 5` (a layered unanimous chain: the rating demand refuses a failure with none; the ids do not read it) and only the shared stubs say `relation: 'new'`: the default `script` (r3's blind raise) and the answer_back test's Z, because that one test runs with `answer_back` on; every other run here has no answer_back, so the judge is not asked for a relation. WHY: ratingDemand recorded (src/ratings-demand.js); relationRule only where answer_back is on (src/chain.js:5462).
const X3 = { criterion: CRITERION, problem: 'No limit on retries.', quote: 'retries failed requests', severity: 5 };
const Z = { criterion: CRITERION, problem: 'The retry limit is not stated anywhere.', quote: 'The worker retries', severity: 5 };
const NEW = f => ({ ...f, relation: 'new' });
const idX3 = objectionId('r3', X3); const idZ = objectionId('r3', Z);
const meets = () => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok' });
const objects = f => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: f.problem }], failures: [f], verdict_line: 'no' });
const noObjection = () => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'not ready' }], failures: [], verdict_line: 'no' });
const withdraw = (id, line) => `${JSON.stringify({ replies: [{ id, action: 'withdraw', text: 'The quoted passage settles it.', quote: 'retries failed requests' }] })}${line ? `\nsign-off: ${line}` : ''}`;
const keep = (id, line) => `${JSON.stringify({ replies: [{ id, action: 'keep', text: 'The posts do not change it.' }] })}${line ? `\nsign-off: ${line}` : ''}`;
const support = id => JSON.stringify({ posts: [{ on: id, stance: 'support', text: 'It holds against the criteria.' }], new_objections: [] });

// layer 1 and 2: one clean seat each; layer 3 (the top): the raiser r3 (objects blind) and q3 (clean, supports). maxRounds 1.
async function run({ held = WITH_NOTE, answers = {}, critics = null, configExtra = {} } = {}) {
  const served = []; const prompts = new Map();
  setPromptSpy(p => { prompts.set(p.label, p); });
  setHeldForTest(held);
  const script = { 'panel-1-r3': objects(NEW(X3)), 'ldebate-1-q3': support(idX3), 'lreply-1-r3': withdraw(idX3, 'no'), ...answers };
  setCache({ invalidate() {}, get(label) {
    served.push(label);
    if (label in script) return script[label] === null ? null : { text: script[label], provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
    return { text: (label.startsWith('panel-') || label.startsWith('final-read-')) ? meets() : DRAFT, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = { name: 'fixture-short-exchange-signoff', criteria: [CRITERION], signoff: 'unanimous', maxRounds: 1, ...configExtra,
    seats: { builder, reviser: builder, critics: critics ?? [seat('l1', 1), seat('l2', 2), seat('r3', 3), seat('q3', 3)] } };
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-short-signoff', log: () => {}, config });
  const report = JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-short-signoff', chain: config.name, task: 't.md', result, config })));
  return { result, served, prompts, report };
}
const states = r => r.layers.map(x => `${x.round}.${x.layer}:${x.state}`).join(' ');
const rowAt = (report, layer) => (report.layer_debates || []).find(d => d.layer === layer);
const verdictOf = (result, lab) => result.panelVerdicts.find(v => v.round === 1 && v.lab === lab);
const reasks = served => served.filter(l => /^panel-.*-reask\d+$/.test(l));   // 0.8.4 S16: panel re-asks only; the final read (part of every layered run) re-asks its own unreadable replies as final-read-<seat>-reask1

test('G7: the label of the extra verdict call is above the in-pass loop\'s and one constant bounds both: the loop runs reask 1..IN_PASS_REASKS_PER_SEAT, the top-layer re-ask is the next index', () => {
  assert.equal(IN_PASS_REASKS_PER_SEAT, 2);
  assert.equal(CHAIN.SIGNOFF_REASK_TAG, '-reask3');
  assert.ok(Number(/\d+$/.exec(CHAIN.SIGNOFF_REASK_TAG)[0]) > IN_PASS_REASKS_PER_SEAT, 'it cannot collide with a label the in-pass loop can produce (the cache replays by label)');
});

test('G7: a top-layer judge that withdrew its only objection and ended its reply with "sign-off: no" is asked once more; a clean verdict signs it off', async () => {
  const { served, report, result, prompts } = await run({ answers: { 'panel-1-r3-reask3': meets() } });
  assert.deepEqual(reasks(served), ['panel-1-r3-reask3'], 'one extra call, once');
  const entry = rowAt(report, 3).signoffs[0];
  assert.deepEqual([entry.seat, entry.said, entry.computed, entry.against_computed], ['r3', 'no', 'signs', true], 'the "no" over a judge the rule lets sign is on the record');
  assert.deepEqual(entry.re_asked, { result: 'signs' });
  assert.ok(states(report).includes('1.3:signed_off'), states(report));
  assert.deepEqual([verdictOf(result, 'r3').verdict, verdictOf(result, 'r3').reasked], ['signed_off', true]);
  const p = prompts.get('panel-1-r3-reask3');
  assert.ok(p.user.includes(NOTE), 'the held note is in the re-ask');
  assert.ok(p.user.includes(idX3), 'and so is the list of what the seat withdrew in the exchange (information, as in every later prompt)');
  assert.equal(p.system, prompts.get('panel-1-r3').system, 'the system text is the ordinary review prompt');
  assert.equal(validate(report), true, JSON.stringify((validate.errors || []).slice(0, 3)));
});

test('G7: the re-ask names an objection with a rating: the judge objects and the layer does not sign off', async () => {
  const { served, report, result } = await run({ answers: { 'panel-1-r3-reask3': objects(Z) } });
  assert.deepEqual(reasks(served), ['panel-1-r3-reask3']);
  assert.deepEqual(rowAt(report, 3).signoffs[0].re_asked, { result: 'objects', objections: [idZ] });
  assert.ok(states(report).includes('1.3:objected'), states(report));
  assert.equal(verdictOf(result, 'r3').verdict, 'objected');
  assert.equal(validate(report), true, JSON.stringify((validate.errors || []).slice(0, 3)));
});

test('G7: the re-ask raises again the objection the judge withdrew in this pass: it counts as objecting, and the record says it was a re-raise', async () => {
  const { report, result } = await run({ answers: { 'panel-1-r3-reask3': objects(X3) } });
  assert.deepEqual(rowAt(report, 3).signoffs[0].re_asked, { result: 'objects', objections: [idX3], re_raised: [idX3] });
  assert.equal(verdictOf(result, 'r3').verdict, 'objected');
});

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: 'G7 #5 (demand not recorded)' pinned two halves: (1) a "does not meet" that names no objection OBJECTS through the failure its FAILED table row carries (rating demand not recorded), (2) an unreadable verdict is unheard. NEW: half (1) is REMOVED (K7: a held-state half, the rating demand is recorded in every shipped run; sibling: 'G7 #5 (rating demand recorded)' below, the same "names no objection" reply, asserted on the recorded state); half (2) stays, as its own row. WHY: ratingDemand recorded.
test('G7 #5: an unreadable verdict from the re-ask is unheard', async () => {
  const un = await run({ answers: { 'panel-1-r3-reask3': 'I would rather not say.' } });
  assert.deepEqual(reasks(un.served), ['panel-1-r3-reask3']);
  assert.equal(rowAt(un.report, 3).signoffs[0].re_asked.result, 'unheard');
  assert.ok(states(un.report).includes('1.3:unheard'), states(un.report));
  assert.equal(verdictOf(un.result, 'r3').verdict, 'unheard');
  assert.equal(un.served.filter(l => /^panel-\d+-r3$/.test(l)).length, 1, 'the seat was asked blind once in this pass');
});

test('G7 #5 (rating demand recorded): a "does not meet" that names no objection is unheard: the verdict reader refuses it and the layer is unheard', async () => {
  const X3s = { ...X3, severity: 5 };   // with the demand every objection carries a rating (the id does not read it)
  const { served, report, result } = await run({ held: { ...WITH_NOTE, ...DEMAND }, answers: { 'panel-1-r3': objects(X3s), 'panel-1-r3-reask3': noObjection() } });
  assert.deepEqual(reasks(served), ['panel-1-r3-reask3'], 'one extra call only');
  assert.equal(rowAt(report, 3).signoffs[0].re_asked.result, 'unheard');
  assert.ok(states(report).includes('1.3:unheard'), states(report));
  assert.equal(verdictOf(result, 'r3').verdict, 'unheard');
});

// NEW (0.8.4 S6 U-C fix-up, 08 Nov 2026; C&C's pick: a new additive value on record truth). A re-ask answered with a STATED PASS: the seat was heard, signed nothing and named nothing, so the record must not say 'signs'. RED on the parent src: it records 'signs'.
test('G7: a re-ask answered with a stated pass is recorded as stated_pass, never as signs; the seat is not counted as signing off', async () => {
  const { report, result } = await run({ configExtra: { freedoms: { pass: true } }, answers: { 'panel-1-r3-reask3': JSON.stringify({ pass: true, pass_reason: 'I have nothing to add.' }) } });
  const re = rowAt(report, 3).signoffs[0].re_asked;
  assert.equal(re.result, 'stated_pass');
  assert.notEqual(re.result, 'signs');
  assert.equal(states(report).includes('1.3:signed_off'), false, states(report));
  assert.equal(result.passed, false);
  assert.equal(validate(report), true, JSON.stringify((validate.errors || []).slice(0, 3)));
});

test('G7: nothing happens for a "yes", a missing or garbled line, a "no" over an objection that stands, or a layer below the top', async () => {
  const none = async answers => { const { served, report } = await run({ answers }); return { served, entry: rowAt(report, 3)?.signoffs?.[0], report }; };
  for (const [what, reply] of [['a yes', withdraw(idX3, 'yes')], ['no line', withdraw(idX3, null)], ['a garbled line', withdraw(idX3, 'maybe')]]) {
    const { served, entry, report } = await none({ 'lreply-1-r3': reply });
    assert.deepEqual(reasks(served), [], `${what}: no extra call`);
    assert.equal(entry.re_asked, undefined, what);
    assert.ok(states(report).includes('1.3:signed_off'), `${what}: the computed rule decides: ${states(report)}`);
  }
  const kept = await none({ 'lreply-1-r3': keep(idX3, 'no') });
  assert.deepEqual(reasks(kept.served), [], 'a "no" over an objection that stands agrees with the rule: no extra call');
  assert.ok(states(kept.report).includes('1.3:objected'));
  // REMOVED (0.8.4 apply, recorded state; K7): the held-note half, 'with the note held a "no" is only recorded'. signoffRefusedReaskNote is recorded in every shipped run. Sibling: the first G7 row of this file (a "no" over a judge the rule lets sign is asked once more with the note, `panel-1-r3-reask3`).
});

test('G7: a layer below the top keeps the base rule: the "no" is recorded, the computed rule decides, no extra call', async () => {
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const X2 = { criterion: CRITERION, problem: 'No limit on retries.', quote: 'retries failed requests', severity: 5 };
  const idX2 = objectionId('r2', X2);
  const { served, report } = await run({ critics: [seat('l1', 1), seat('r2', 2), seat('p2', 2), seat('t3', 3)], answers: { 'panel-1-r2': objects(X2), 'ldebate-1-p2': support(idX2), 'lreply-1-r2': withdraw(idX2, 'no') } });
  assert.deepEqual(reasks(served), []);
  assert.deepEqual(rowAt(report, 2).signoffs.map(x => [x.seat, x.said, x.computed, x.against_computed]), [['r2', 'no', 'signs', true]]);
  assert.ok(states(report).includes('1.2:signed_off'), states(report));
});

test('G7 with answer_back on (the shipped shape): the extra verdict call replaces the seat\'s blind reply\'s answer records, NOT the withdrawals it made in the exchange of the same pass', async t => {
  // pass 1: r3 raises X3 and keeps it, so the layer objects and the plan is revised. pass 2: r3 raises Z and leaves X3 unanswered (carried), withdraws both in the exchange and ends with "sign-off: no"; the extra call answers X3 (withdrawn, quoting the revised plan) and signs.
  const both = JSON.stringify({ posts: [idZ, idX3].map(on => ({ on, stance: 'support', text: 'It holds against the criteria.' })), new_objections: [] });
  const withdrawBoth = `${JSON.stringify({ replies: [idZ, idX3].map(id => ({ id, action: 'withdraw', text: 'The quoted passage settles it.', quote: 'retries failed requests' })) })}\nsign-off: no`;
  const answered = JSON.stringify({ ...JSON.parse(meets()), answers: [{ id: idX3, status: 'withdrawn', evidence: 'The plan now reads "retries failed requests" in its first line.' }] });
  const { served, report } = await run({ configExtra: { maxRounds: 2, answer_back: { enabled: true } }, answers: {
    'lreply-1-r3': keep(idX3, null), 'revise-1': 'The worker retries failed requests, at most three times.',   // CHANGED ACCEPTED (second box run, 08 Nov 2026). NEW: the revision is a different text (it still holds both quotes). WHY: run()'s stub served the unchanged DRAFT for revise-1, so pass 2 had pass 1's draft id; X3 was already debated on it (`settled`, chain.js "const settled"), was left out of the pass-2 exchange, its withdrawal was ignored, X3 stood, and no re-ask was due. The comment above says the plan is revised; now it is.
    'panel-2-r3': objects(NEW(Z)), 'ldebate-2-q3': both, 'lreply-2-r3': withdrawBoth, 'panel-2-r3-reask3': answered,
  } });
  t.diagnostic(`G7 answer_back: reasks=${JSON.stringify(reasks(served))} premise(panel-2-r3-reask3 served)=${served.includes('panel-2-r3-reask3')} distinctRounds=${new Set((report.layers || []).map(x => x.round)).size} layerRows=${(report.layers || []).length} states=${report.layers ? states(report) : 'no layers'}`.slice(0, 600));
  t.diagnostic(`G7 answer_back: re_asked of top-layer signoffs=${JSON.stringify((report.layer_debates || []).filter(d => d.layer === 3).map(d => ({ round: d.round, signoffs: (d.signoffs || []).map(x => ({ seat: x.seat, said: x.said, computed: x.computed, re_asked: x.re_asked })) })))}`.slice(0, 600));
  t.diagnostic(`G7 answer_back: pass-2 layer-3 debate rows=${JSON.stringify((report.layer_debates || []).filter(d => d.layer === 3 && d.round === 2).map(d => ({ signoffs: d.signoffs, objections: d.objections, outcome: d.outcome })))}`.slice(0, 600));   // which objection still stands at the sign-off line
  t.diagnostic(`G7 answer_back: answer_back_replies r3 round 2=${JSON.stringify((report.answer_back_replies || []).filter(r => r.round === 2 && r.lab === 'r3').map(r => [r.id === idX3 ? 'X3' : r.id === idZ ? 'Z' : String(r.id).slice(0, 10), r.effect]))} open=${JSON.stringify((report.dispute?.open_objections || []).map(o => [o.id === idX3 ? 'X3' : o.id === idZ ? 'Z' : String(o.id).slice(0, 10), o.lab]))}`.slice(0, 600));
  t.diagnostic(`G7 answer_back: served (tail)=${JSON.stringify(served).slice(-550)}`.slice(0, 600));
  assert.ok(served.includes('panel-2-r3-reask3'), 'the premise: the extra call was made in pass 2');
  const mine = (report.answer_back_replies || []).filter(r => r.round === 2 && r.lab === 'r3');
  assert.deepEqual(mine.filter(r => r.effect === 'withdrawn_exchange').map(r => r.id).sort(), [idX3, idZ].sort(), 'act 1, the withdrawals in the exchange, is still on the record');
  assert.ok(mine.some(r => r.effect === 'withdrawn' && r.id === idX3), 'and the extra call\'s own answer is recorded beside them');
});
