// 0.8.4 S7b, commit A2 (the prompts): when all five gate names are recorded and layer 1 SIGNED OFF in this pass, the layer above it is shown layer 1's open objections to RULE on, raisers hidden, with the reply tail; nothing reads the rulings yet (the hook is A3).
// Rows RS-1 (the gate), RS-2 (the live section), RS-3 (the predicate), RS-4 (the budget: none withheld below it, the count above it), RS-19 (the lab string is absent from the layer-2 prompt when the names are injected, PRESENT when the gate is held).
// $0, offline, runChain direct (no CLI, no api: they survive the rebase onto HS NEW). The fixture is test/helpers/layer-two-run.js; the held map injects the drafted words (test/held-prompts/held-084-b.js).
// With relationRule injected a failure without `relation` is an unreadable reply (the id assigner is on), so every layer-1 reply here is an override that declares relation "new".
// NOT DRIVEN (named): a not_debated objection in the section (needs a layer-1 exchange that leaves one: S6/S3 fixtures).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as HB from './held-prompts/held-084-b.js';
import { scenario, CRITERION, DRAFT, idOf } from './helpers/layer-two-run.js';
import { setHeldForTest } from '../src/held-roles.js';
import { DEMAND } from './helpers/rating-demand.js';
import * as ES from '../src/escalation.js';
import * as L from '../src/objection-ledger.js';

afterEach(() => setHeldForTest(null));

const NAMES = ['ratingDemand', 'relationRule', 'layerOneRulingsSection', 'layerOneRulingsReplyTail', 'layerOneRulingsLedgerSection'];
const LIVE = Object.freeze({ ...DEMAND, relationRule: HB.relationRule, layerOneRulingsSection: HB.layerOneRulingsSection, layerOneRulingsReplyTail: HB.layerOneRulingsReplyTail, layerOneRulingsLedgerSection: HB.layerOneRulingsLedgerSection });
const without = name => ({ ...LIVE, [name]: undefined });
const FRAME = 'Layer 1 signed off on this plan.';
const OLD_FRAME = 'You are not bound by them';
const HEADING = '# Open objections from layer 1';
const failure = (n, severity) => ({ criterion: n === undefined ? CRITERION : `${CRITERION} ${n}`, problem: n === undefined ? 'No retry limit is specified.' : `Problem ${n}: ${'x'.repeat(1700)}`, fix: 'Specify one.', quote: n === undefined ? 'retries failed requests' : `q${n}`, severity, relation: 'new' });
const raiseOf = failures => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures, verdict_line: 'no' });
// A clean sign-off that WITHDRAWS layer 1's own objection (the quote is the plan's first line, which the revised plan keeps): a plain sign-off with no answer leaves a rated-less objection unanswered, it is carried as an objection and layer 1 objects again.
const withdrawsOf = id => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok', answers: [{ id, status: 'withdrawn', evidence: `It reads "${DRAFT}"` }] });
const refsOf = text => [...text.matchAll(/<prior-review ref="([^"]+)">/g)].map(m => m[1]);

test('RS-1: the gate is five names: with any one held the layer-2 prompt is the recorded section (or none, without the rating demand); with all five it is the S7b section', async () => {
  assert.deepEqual([...ES.LAYER_ONE_RULING_HELD].sort(), [...NAMES].sort(), 'the test injects exactly the gate names');
  for (const name of NAMES) {
    setHeldForTest(without(name));
    // pass 2 (reached only without the rating demand: the rated-3 failure is not swept there, layer 1 objects in pass 1 and the plan is revised): layer 1 withdraws it, so the run ends on a full sign-off and returns its prompts
    const { prompts } = await scenario({ answerBack: true, l1Severity: 3, overrides: { 'panel-1-la': raiseOf([failure(undefined, 3)]), 'panel-2-la': withdrawsOf(idOf(3)) } });
    for (const [label, p] of prompts) {
      assert.equal(p.user.includes(FRAME), false, `without ${name}: no S7b frame in ${label}`);
      assert.equal(p.user.includes('"rulings":[{'), false, `without ${name}: no reply tail in ${label}`);
    }
    if (name === 'ratingDemand') {   // no severity run: the rated-3 failure is not swept, layer 1 objects in pass 1 and layer 2 is not asked in it (it is, in pass 2, after layer 1's withdrawal); no prompt of any pass carries a layer-one section
      for (const [label, p] of prompts) assert.equal(p.user.includes(HEADING), false, `without the rating demand: no layer-one section in ${label}`);
    } else {
      const lb = prompts.get('panel-1-lb');
      assert.ok(lb, `layer 2 was asked (without ${name})`);
      assert.ok(lb.user.includes(HEADING) && lb.user.includes(OLD_FRAME), `without ${name}: the recorded section (it names the raiser and says "you are not bound")`);
    }
  }
});

test('RS-2: with all five names recorded and layer 1 signed off (its objection rated 3, swept), layer 2 is shown the S7b section and the reply tail; layers 1 and 3 are not', async () => {
  setHeldForTest(LIVE);
  const { prompts } = await scenario({ answerBack: true, l1Severity: 3, overrides: { 'panel-1-la': raiseOf([failure(undefined, 3)]) } });
  const lb = prompts.get('panel-1-lb');
  assert.ok(lb.user.includes(HEADING) && lb.user.includes(FRAME) && lb.user.includes("The raisers' names are hidden."));
  assert.ok(lb.user.includes('Severity: 3.'), 'the rating in force is shown');
  assert.equal(lb.user.includes(OLD_FRAME), false, 'the context-only frame is replaced');
  assert.ok(lb.user.includes('"rulings":[{"id":"<objection id>"'), 'the reply tail is appended');
  assert.ok(lb.user.indexOf(HEADING) > lb.user.indexOf('# Draft under review'), 'after the draft');
  assert.equal(refsOf(lb.user).length, 1, 'one rulable objection');
  assert.equal(prompts.get('panel-1-la').user.includes(FRAME), false, 'layer 1 does not read it');
  assert.equal(prompts.get('panel-1-lc').user.includes(FRAME), false, 'layer 3 does not read it');
});

test('RS-3: the predicate: on a pass where layer 1 did NOT sign off (the ladder block: it keeps a 5, pass 4 starts at layer 2) the recorded section is used even with the gate live', async () => {
  setHeldForTest(LIVE);
  const { prompts } = await scenario({ answerBack: true, ladder: true, l1Severity: 5, overrides: { 'panel-1-la': raiseOf([failure(undefined, 5)]) } });
  const lb = prompts.get('panel-4-lb');
  assert.ok(lb, 'layer 2 was asked in pass 4');
  assert.ok(lb.user.includes(HEADING) && lb.user.includes(OLD_FRAME), 'the recorded section');
  assert.equal(lb.user.includes(FRAME), false, 'layer 1 never signed off in that pass: W39 would be false');
  assert.equal(lb.user.includes('"rulings":[{'), false);
});

test('RS-4: the budget: below it every objection is shown and none is cut; above it the lowest-rated are cut, the section says they are not shown and not ruled on, the record counts them, and layer 2 is still asked', async () => {
  setHeldForTest(LIVE);
  const small = await scenario({ answerBack: true, l1Severity: 3, overrides: { 'panel-1-la': raiseOf([failure(undefined, 3), failure(1, 3), failure(2, 3)]) } });
  const sRec = small.result.layers.find(l => l.round === 1 && l.layer === 2).layer_one_open;
  assert.deepEqual([sRec.shown, sRec.left_out], [3, 0], JSON.stringify(sRec));
  assert.equal(refsOf(small.prompts.get('panel-1-lb').user).length, 3, 'none withheld below the budget');
  assert.equal(small.prompts.get('panel-1-lb').user.includes('not shown to you for length'), false);
  const many = [failure(undefined, 3), ...Array.from({ length: 25 }, (_, i) => failure(i, 3.1))];
  const big = await scenario({ answerBack: true, l1Severity: 3, overrides: { 'panel-1-la': raiseOf(many) } });
  const lb = big.prompts.get('panel-1-lb');
  assert.ok(lb, 'layer 2 was asked');
  const rec = big.result.layers.find(l => l.round === 1 && l.layer === 2).layer_one_open;
  assert.ok(rec.left_out > 0 && rec.shown + rec.left_out === 26, JSON.stringify(rec));
  assert.ok(lb.user.includes(`${rec.left_out} objection${rec.left_out === 1 ? '' : 's'} of layer 1 ${rec.left_out === 1 ? 'is' : 'are'} not shown to you for length. You do not rule on ${rec.left_out === 1 ? 'it' : 'them'}; ${rec.left_out === 1 ? 'it stays' : 'they stay'} as ${rec.left_out === 1 ? 'it was' : 'they were'}.`));
  assert.equal(refsOf(lb.user).length, rec.shown, 'the shown rows are the refs in the prompt');
  assert.ok(rec.chars <= L.LEDGER_MAX_CHARS);
});

test('RS-19: the raisers are hidden: with the gate live neither the raiser\'s lab string nor its seat key is anywhere in the layer-2 prompt (system or user); with the gate held (the recorded section) the lab string IS there, so this test can fail', async () => {
  const LAB = 'zq7alpha';   // appears nowhere else in the fixture: no persona, no relay block, no lab name inside a criterion or problem text
  const critics = [[LAB, 1], ['lb', 2], ['lc', 3]];
  const overrides = { [`panel-1-${LAB}`]: raiseOf([failure(undefined, 3)]) };
  setHeldForTest(LIVE);
  const live = await scenario({ answerBack: true, l1Severity: 3, critics, overrides });
  const liveLb = live.prompts.get('panel-1-lb');
  assert.ok(liveLb && liveLb.user.includes(FRAME), 'the S7b section was shown');
  assert.equal(`${liveLb.system}\n${liveLb.user}`.includes(LAB), false, 'no lab string in the live layer-2 prompt');
  setHeldForTest(without('layerOneRulingsReplyTail'));
  const held = await scenario({ answerBack: true, l1Severity: 3, critics, overrides });
  const heldLb = held.prompts.get('panel-1-lb');
  assert.ok(heldLb.user.includes(`lab="${LAB}"`), 'with the gate held the recorded section names the raiser (the control)');
});
