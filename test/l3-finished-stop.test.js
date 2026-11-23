// 0.8.4 L3 (A-DRAFT words, WORDING rows L3-1..L3-7): a run a person FINISHED at a stop says that the top layer did not sign off on the plan the stop was raised on.
// Pure rows: the shared core (src/layers.js topLayerNotSignedFrom: the layer-row check only), the finished-run wrapper (src/verdict-headline.js finishedAtStopWords: adds `stop.chosen === 'finish'`),
// the readers that print it (verdictHeadline, finishedRunState, renderBoardMd) and the sitting line of a round-stopped tree member (src/tree-resume.js sittingLines). The new exports are read through
// NAMESPACE imports, so on a tree without L3 the file still loads and each row fails by assertion.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as LY from '../src/layers.js';
import * as VH from '../src/verdict-headline.js';
import * as OR from '../src/overseer-rounds.js';
import { verdictHeadline } from '../src/verdict-headline.js';
import { finishedRunState } from '../src/run-status.js';
import { renderBoardMd } from '../src/report-shape.js';
import { sittingLines } from '../src/tree-resume.js';
import { CONTINUE_WORDS, didNotSignOffWords } from '../src/overseer-rounds.js';

const PHRASE = 'layer 3 did not sign off on this plan';
const row = (layer, round, state) => ({ round, layer, state, labs: [`lab${layer}`] });
const climb = (round, states) => states.map((s, i) => row(i + 1, round, s));
// one stop and the layers[] rows of ITS pass, per kind (the fields each kind carries in src/chain.js and src/overseer-rounds.js)
const KINDS = [
  ['overseer_cap below seven', { kind: 'overseer_cap', pass: 4, overseer_round: 3, rounds: 3 }, climb(4, ['signed_off', 'signed_off', 'objected'])],
  ['overseer_cap, the hard stop (seven rounds)', { kind: 'overseer_cap', pass: 9, overseer_round: 7, rounds: 7 }, climb(9, ['signed_off', 'signed_off', 'objected'])],
  ['layer_bound, revisions (layer 1 objected, the layers above were not asked)', { kind: 'layer_bound', why: 'revisions', layer: 1, pass: 2, overseer_round: 1 }, climb(2, ['objected', 'not_asked', 'not_asked'])],
  ['layer_bound, unheard (a seat of layer 2 was silent, layer 3 not asked)', { kind: 'layer_bound', why: 'unheard', layer: 2, pass: 2, overseer_round: 1 }, climb(2, ['signed_off', 'unheard', 'not_asked'])],
  ['stall_stop, top_layer (the top layer holds the stalled objection)', { kind: 'stall_stop', why: 'top_layer', top_layer: 3, pass: 3, overseer_round: 3, rounds: 3, pass_left: true, stalled: [] }, climb(3, ['signed_off', 'signed_off', 'objected'])],
  ['stall_stop, last_pass (a lower layer objected, the top layer not asked)', { kind: 'stall_stop', why: 'last_pass', top_layer: 3, pass: 2, overseer_round: 0, pass_left: false, stalled: [] }, climb(2, ['objected', 'not_asked', 'not_asked'])],
];

test('L3-1 the core, per stop kind: the top layer\'s row for the stop\'s own pass is not signed off -> { layer: 3 }; the stop sentence (U-C1) carries the phrase exactly when the core says so (the CONSISTENCY row)', () => {
  assert.equal(typeof LY.topLayerNotSignedFrom, 'function', 'the core exists in src/layers.js');
  assert.equal(typeof OR.didNotSignOffPhrase, 'function', 'the one phrase exists in src/overseer-rounds.js');
  for (const [name, stop, layers] of KINDS) {
    const hit = LY.topLayerNotSignedFrom({ layers, stop });
    assert.deepEqual(hit, { layer: 3 }, name);
    const sentence = didNotSignOffWords(stop);
    assert.notEqual(sentence, '', `${name}: the stop sentence says the phrase`);
    // the same clause, once: "the top layer" where the stop has no layer number (advance() stops), "layer 3" where it has one (stall_stop)
    assert.equal(sentence, `, and ${OR.didNotSignOffPhrase(stop.top_layer)}`, name);
    assert.equal(OR.didNotSignOffPhrase(3), PHRASE);
    assert.equal(OR.didNotSignOffPhrase(undefined), 'the top layer did not sign off on this plan');
  }
});

test('L3-2 the core says nothing (null) where it could be wrong: signed_off, handler_not_yet, no layers[], no readable stop, no row for the stop\'s pass; an earlier round\'s objection does not count', () => {
  const stop = { kind: 'overseer_cap', pass: 4, overseer_round: 3, rounds: 3 };
  const objected = climb(4, ['signed_off', 'signed_off', 'objected']);
  assert.deepEqual(LY.topLayerNotSignedFrom({ layers: objected, stop }), { layer: 3 }, 'the premise');
  assert.equal(LY.topLayerNotSignedFrom({ layers: climb(4, ['signed_off', 'signed_off', 'signed_off']), stop }), null, 'the top layer signed off on that plan');
  assert.equal(LY.topLayerNotSignedFrom({ layers: objected, stop: { ...stop, handler_not_yet: true } }), null, 'handler_not_yet: the top layer signed that plan');
  for (const layers of [undefined, null, [], {}, 'x']) assert.equal(LY.topLayerNotSignedFrom({ layers, stop }), null, `layers ${JSON.stringify(layers)}`);
  for (const bad of [undefined, null, 'stop', {}, { kind: 'overseer_cap' }, { kind: 'overseer_cap', pass: '4' }]) assert.equal(LY.topLayerNotSignedFrom({ layers: objected, stop: bad }), null, `stop ${JSON.stringify(bad)}`);
  assert.equal(LY.topLayerNotSignedFrom({ layers: climb(3, ['signed_off', 'signed_off', 'objected']), stop }), null, 'no row for the stop\'s pass: no claim');
  assert.equal(LY.topLayerNotSignedFrom({ layers: [...climb(3, ['signed_off', 'signed_off', 'objected']), ...climb(4, ['signed_off', 'signed_off', 'signed_off'])], stop }), null, 'round 3 objected, but the stop is about pass 4, where the top layer signed');
  assert.deepEqual(LY.topLayerNotSignedFrom({ layers: [...climb(3, ['signed_off', 'signed_off', 'signed_off']), ...objected], stop }), { layer: 3 }, 'the pass-4 row decides, not an earlier signed round');
  assert.equal(LY.topLayerNotSignedFrom(), null, 'no argument');
  assert.equal(LY.topLayerNotSignedFrom({ layers: [{ round: 4, layer: 'x', state: 'objected' }], stop }), null, 'no readable layer number');
});

test('L3-3 the wrapper adds the gate: only a stop the person FINISHED (stop.chosen "finish") on a report that did not pass; early, continue, no choice and a passed report say nothing', () => {
  assert.equal(typeof VH.finishedAtStopWords, 'function', 'the wrapper exists in src/verdict-headline.js');
  const stop = { kind: 'overseer_cap', pass: 4, overseer_round: 3, rounds: 3 };
  const layers = climb(4, ['signed_off', 'signed_off', 'objected']);
  assert.equal(VH.finishedAtStopWords({ passed: false, layers, stop: { ...stop, chosen: 'finish' } }), PHRASE);
  assert.equal(VH.finishedAtStopWords({ layers, stop: { ...stop, chosen: 'finish' } }), PHRASE, 'a result-shaped object without `passed` (chain.js asks it that way)');
  for (const chosen of ['early', 'continue', undefined, null, 'Finish']) assert.equal(VH.finishedAtStopWords({ passed: false, layers, stop: { ...stop, chosen } }), null, `chosen ${chosen}`);
  assert.equal(VH.finishedAtStopWords({ passed: true, layers, stop: { ...stop, chosen: 'finish' } }), null, 'a passed report');
  assert.equal(VH.finishedAtStopWords({ passed: false, layers: climb(4, ['signed_off', 'signed_off', 'signed_off']), stop: { ...stop, chosen: 'finish' } }), null, 'the top layer signed off');
  assert.equal(VH.finishedAtStopWords({ passed: false, stop: { ...stop, chosen: 'finish' } }), null, 'an unlayered chain has no layers[]');
  assert.equal(VH.finishedAtStopWords({ passed: false, layers, stop: { ...stop, chosen: 'finish' }, escalated_signoff: { requested: true } }), null, 'a report with an escalated sign-off speaks through that record');
  assert.equal(VH.finishedAtStopWords({ passed: false, layers, stop: { ...stop, chosen: 'finish' }, ending: { kind: 'signed_off_at_top_not_agreed', basis: ['layer_3_sign_off', 'handler_not_yet'] } }), null, 'a report with a recorded ending speaks through that ending');
  assert.equal(VH.finishedAtStopWords(null), null); assert.equal(VH.finishedAtStopWords(undefined), null);
});

const FINISHED = { passed: false, layers: climb(4, ['signed_off', 'signed_off', 'objected']), stop: { kind: 'overseer_cap', pass: 4, overseer_round: 3, rounds: 3, chosen: 'finish' } };
test('L3-4 the readers: the headline text, the run_status state and the BOARD banner say it for a finished stop; the label, the words field, passed and the old sentences\' starts stay', () => {
  const h = verdictHeadline(FINISHED);
  assert.deepEqual([h.heading, h.label, h.words], ['Verdict', 'OPEN OBJECTIONS', null], 'the label and the words field are unchanged');
  assert.equal(h.text, `OPEN OBJECTIONS - ${PHRASE}`);
  assert.equal(finishedRunState(FINISHED), `done: open objections; ${PHRASE}`);
  const board = renderBoardMd({ runId: 'r', result: FINISHED });
  assert.ok(board.includes('## Not agreed: finished at the person\'s choice\n\nLayer 3 did not sign off on this plan.\n'), board);
  // the same report without the finish: the old texts, byte for byte
  const open = { ...FINISHED, stop: { ...FINISHED.stop, chosen: undefined } };
  assert.equal(verdictHeadline(open).text, 'OPEN OBJECTIONS'); assert.equal(finishedRunState(open), 'done: open objections');
  assert.doesNotMatch(renderBoardMd({ runId: 'r', result: open }), /finished at the person's choice|did not sign off on this plan/);
  // and the top layer having signed: nothing is claimed
  const signed = { ...FINISHED, layers: climb(4, ['signed_off', 'signed_off', 'signed_off']) };
  assert.equal(verdictHeadline(signed).text, 'OPEN OBJECTIONS'); assert.equal(finishedRunState(signed), 'done: open objections');
  assert.doesNotMatch(renderBoardMd({ runId: 'r', result: signed }), /did not sign off on this plan/);
});

const sitting = (stop, over = {}) => sittingLines({ status: 'awaiting_choice', started: [], node: 'R/M1', runId: 'run1', stopped: [], conflict: false, ...(stop ? { stop } : {}), ...over }, 'tree1').join('\n');
const OLD_CHOICE = `  Your choice: \`council tree decide tree1 --continue-node R/M1\` (${CONTINUE_WORDS}, under its own grant) or \`council tree decide tree1 --finish-node R/M1\` (the dispute stage and the handoff run, the result stays not agreed); then \`council tree resume tree1\` applies it.`;
test('L3-5 the sitting line of a round-stopped member: the finish parenthesis says the stop sentence\'s clause (the layer number where the stop has one); with no pass left there is no --continue-node; an unreadable stop reads exactly as before', () => {
  const capStop = { kind: 'overseer_cap', pass: 4, overseer_round: 3, rounds: 3 };
  assert.ok(sitting(capStop).includes('the result stays not agreed, and the top layer did not sign off on this plan); then `council tree resume tree1` applies it.'), sitting(capStop));
  assert.ok(sitting(capStop).includes('--continue-node R/M1`'), 'a pass is left: continue is offered');
  const stallStop = { kind: 'stall_stop', why: 'top_layer', top_layer: 3, pass: 3, overseer_round: 3, rounds: 3, pass_left: true, stalled: [] };
  assert.ok(sitting(stallStop).includes('the result stays not agreed, and layer 3 did not sign off on this plan); then'), sitting(stallStop));
  const none = sitting({ ...stallStop, why: 'last_pass', pass_left: false });
  assert.ok(none.includes('  No pass is left, so there is no `--continue-node`. Your choice: `council tree decide tree1 --finish-node R/M1` (the dispute stage and the handoff run, the result stays not agreed, and layer 3 did not sign off on this plan); then `council tree resume tree1` applies it.'), none);
  assert.doesNotMatch(none, /tree decide tree1 --continue-node/, 'the tree refuses a continue there, so it is not offered');
  assert.ok(sitting(undefined).includes(OLD_CHOICE), 'no stop on the result: the line is byte for byte as before');
  assert.ok(sitting({ kind: 'overseer_cap', overseer_round: 3 }).includes(OLD_CHOICE), 'a stop with no whole-number pass is unreadable: no claim');
  assert.ok(sitting({ ...capStop, handler_not_yet: true }).includes(OLD_CHOICE), 'handler_not_yet: the top layer signed that plan');
});
