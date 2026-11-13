// 0.8.4 found-secret pause, --finish, a layer cut off mid-pass (c2g). The person's --finish arms the outbound scan so that the FIRST call that misses the cache in the pass loop throws SecretFinish (setOutboundScan({ finish: true })).
// These rows drive runChain in-process (chain.js only; the CLI path is SP-20 in secret-pause.test.js): the cache stub answers every stage by its label and returns null for the ONE label the finish cuts. Offline, $0.
// WHY IN-PROCESS: the ruling words and the sign-off re-ask note are held prompt text, so a real CLI run never writes a rule-* or -reask3 stage file for a rewind to cut.
// Pinned: the cut layer ends `unfinished` (the row is set back even when its state was already computed), its seats' rows stay in panelVerdicts[] and signoff[] marked `cut`, they count for no sign-off, `reasked` is false for a re-ask no call was sent
// for, an escalation ruling that was cut is not recorded as ruled, and the words say which layer was cut off.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as CHAIN from '../src/chain.js';   // a namespace import: a tree without a name fails the row that uses it and the file still loads
const { runChain, setPromptSpy, setCache, setBudget } = CHAIN;
import { setHeldForTest } from '../src/held-roles.js';
import { reportJsonShape } from '../src/report-shape.js';
import { objectionId } from '../src/objection-ids.js';
import { secretFinishWords } from '../src/verdict-headline.js';
import * as HB084 from './held-prompts/held-084-b.js';
import * as HESC from './held-prompts/held-escalation.js';
import { DEMAND } from './helpers/rating-demand.js';

afterEach(() => { CHAIN.setOutboundScan({}); setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });

const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const reply = text => ({ text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 });
const meets = () => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok' });
const objects = f => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: f.problem }], failures: [f], verdict_line: 'no' });
const states = r => r.layers.map(x => `${x.round}.${x.layer}:${x.state}`).join(' ');

// ---- the sign-off re-ask (short-exchange-signoff.test.js's fixture): layer 3's raiser r3 withdraws its only objection and ends "sign-off: no"; the extra verdict call (-reask3) is the call the finish cuts.
const PAIR = { shortExchangeRule: HB084.shortExchangeRule, signoffLineRule: HB084.signoffLineRule, signoffRefusedReaskNote: HB084.signoffRefusedReaskNote };
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the scripted failures carried no `relation` (X3 no `severity` either). NEW: X3 carries `severity: 5` (layered unanimous chain: the rating demand); X3 carries no `relation` (the two X3 chains have no answer_back, so the judge is not asked for one); in the escalation fixture (answer_back on) the first raise of X says `new` and the second raise by the same seat (pass 2) says `continues <id>`. WHY: relationRule and ratingDemand recorded (src/chain.js relation gate; src/ratings-demand.js).
const X3 = { criterion: CRITERION, problem: 'No limit on retries.', quote: 'retries failed requests', severity: 5 };
const idX3 = objectionId('r3', X3);
const support = id => JSON.stringify({ posts: [{ on: id, stance: 'support', text: 'It holds against the criteria.' }], new_objections: [] });
const withdraw = (id, line) => `${JSON.stringify({ replies: [{ id, action: 'withdraw', text: 'The quoted passage settles it.', quote: 'retries failed requests' }] })}\nsign-off: ${line}`;

async function runReask({ cutLabel }) {
  const script = { 'panel-1-r3': objects(X3), 'ldebate-1-q3': support(idX3), 'lreply-1-r3': withdraw(idX3, 'no'), [cutLabel]: null };
  setHeldForTest(PAIR);
  setCache({ invalidate() {}, get(label) {
    if (label in script) return script[label] === null ? null : reply(script[label]);
    return reply((label.startsWith('panel-') || label.startsWith('final-read-')) ? meets() : DRAFT);
  } });
  CHAIN.setOutboundScan({ finish: true });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = { name: 'fixture-secret-cut-reask', criteria: [CRITERION], signoff: 'unanimous', maxRounds: 1, seats: { builder, reviser: builder, critics: [seat('l1', 1), seat('l2', 2), seat('r3', 3), seat('q3', 3)] } };
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-cut-reask', log: () => {}, config });
  return { result, report: JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-cut-reask', chain: config.name, task: 't.md', result, config }))) };
}

test('CUT-1 a finish that cuts the top layer\'s sign-off re-ask: the layer ends unfinished, its seats\' rows are marked cut and count for no sign-off, the run is not agreed, the words say layer 3 was cut off', async () => {
  const { report } = await runReask({ cutLabel: 'panel-1-r3-reask3' });
  // premise: the finish really cut the run at the re-ask (a run that finished normally has no stop block)
  assert.equal(report.stop?.kind, 'secret_pause', `the finish cut the run: ${JSON.stringify(report.stop)}`);
  assert.equal(report.passed, false);
  assert.deepEqual([report.stop.reviewed, report.stop.asked_layers, report.stop.cut_layers, report.stop.not_asked_layers], ['part', [1, 2], [3], []]);
  assert.match(states(report), /1\.3:unfinished/, states(report));
  const cutRows = [...report.panelVerdicts, ...report.signoff].filter(r => r.cut === true).map(r => r.lab).sort();
  assert.deepEqual(cutRows, ['q3', 'q3', 'r3', 'r3'], 'both layer-3 seats are marked cut in panelVerdicts[] and in signoff[]');
  assert.ok([...report.panelVerdicts, ...report.signoff].filter(r => ['l1', 'l2'].includes(r.lab)).every(r => !r.cut), 'the layers that answered are not marked');
  assert.equal(report.panelVerdicts.find(v => v.lab === 'r3').reasked, false, 'the re-ask was never sent: reasked is false');
  assert.equal(report.layer_debates.find(d => d.layer === 3).signoffs[0].said, 'no', 'the "no" of the exchange survives in layer_debates');
  assert.match(secretFinishWords(report), /layers 1 and 2 were asked in this pass and layer 3 was cut off$/);
  assert.doesNotMatch(secretFinishWords(report), /every layer signed/);
});

test('CUT-2 control: the same run with no finish armed signs off at layer 3 (so the cut rows above come from the finish, not from the fixture)', async () => {
  const script = { 'panel-1-r3': objects(X3), 'ldebate-1-q3': support(idX3), 'lreply-1-r3': withdraw(idX3, 'no'), 'panel-1-r3-reask3': meets() };
  setHeldForTest(PAIR);
  setCache({ invalidate() {}, get(label) { return label in script ? reply(script[label]) : reply((label.startsWith('panel-') || label.startsWith('final-read-')) ? meets() : DRAFT); } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = { name: 'fixture-secret-cut-control', criteria: [CRITERION], signoff: 'unanimous', maxRounds: 1, seats: { builder, reviser: builder, critics: [seat('l1', 1), seat('l2', 2), seat('r3', 3), seat('q3', 3)] } };
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-cut-control', log: () => {}, config });
  const report = JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-cut-control', chain: config.name, task: 't.md', result, config })));
  assert.equal(report.stop, undefined);
  assert.ok(![...report.panelVerdicts, ...report.signoff].some(r => r.cut), 'nothing is marked cut when nothing is cut');
});

// ---- the escalation ruling (stall-escalation.test.js's SE-1 fixture): layer 1 stalls, the plan goes up, layer 2 reviews blind and then rules; the ruling call (rule-3-mid-beta) is the call the finish cuts.
const INJECT = { escalationRulingSystem: HESC.escalationRulingSystem, escalationRulingUser: HESC.escalationRulingUser, ledgerRulingsSection: HESC.ledgerRulingsSection };
const CLOSING = { ...INJECT, ...DEMAND };
const LOW = 'raiser-alpha';
const X = { severity: 5, criterion: CRITERION, problem: 'No limit on retries.', quote: 'retries failed requests' };
const idX = objectionId(LOW, X);

async function runRule() {
  const script = { 'panel-1-raiser-alpha': objects({ ...X, relation: 'new' }), 'panel-2-raiser-alpha': objects({ ...X, relation: `continues ${idX}` }), 'revise-1': `${DRAFT}\n\nRevision 1.\n\nDECLINED: ${idX}: The limit is set in section two.`, 'rule-3-mid-beta': null };
  setHeldForTest(CLOSING);
  setCache({ invalidate() {}, get(label) {
    if (label in script) return script[label] === null ? null : reply(script[label]);
    return reply((label.startsWith('panel-') || label.startsWith('final-read-')) ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT);
  } });
  CHAIN.setOutboundScan({ finish: true });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = { name: 'fixture-secret-cut-rule', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2 }, maxRounds: 6,
    seats: { builder, reviser: builder, critics: [seat(LOW, 1), seat('mid-beta', 2), seat('top-gamma', 3)] } };
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-cut-rule', log: () => {}, config });
  const report = JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-cut-rule', chain: config.name, task: 't.md', result, config })));
  return report;
}

test('CUT-3 a finish that cuts an escalation ruling call: the ruling is not recorded (no outcome, no rulings), the layer that was to rule ends unfinished, the stalled objection is not closed by it', async () => {
  const report = await runRule();
  assert.equal(report.stop?.kind, 'secret_pause', `the finish cut the run: ${JSON.stringify(report.stop)}`);
  assert.equal(report.passed, false);
  assert.deepEqual(report.stop.cut_layers, [2], JSON.stringify(report.stop));
  assert.match(states(report), /3\.2:unfinished/, states(report));
  const e = (report.escalations ?? [])[0];
  assert.ok(e, 'the escalation is on the record');
  assert.deepEqual([e.outcome ?? [], e.rulings ?? []], [[], []], 'the cut ruling decided nothing: no outcome row and no ruling is recorded');
  assert.match(secretFinishWords(report), /layer 2 was cut off/);
});

test('CUT-3b the same cut: the cut layer\'s rows in the pass written for it do not make that pass the final panel round (signed_text.round is the last pass in which a verdict stood)', async () => {
  const report = await runRule();
  assert.equal(report.stop?.kind, 'secret_pause', `premise: the finish cut the run: ${JSON.stringify(report.stop)}`);
  assert.equal(report.signed_text?.round, 2, JSON.stringify(report.signed_text));
});
