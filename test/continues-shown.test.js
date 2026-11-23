// 0.8.5 (dev), a judge that restates a row it was shown: a judge that restates a row of ANOTHER seat that was shown to it in that same ask
// (layer 1's open objections in a middle layer's section: the rulings section, or the context section) as "continues <that id>" is heard. The
// failure becomes the judge's own new objection (its own id), and the relation it declared stays on the record as written. A judge that restates
// the copy it took over by a sustain as "continues <the copy's id>" is heard too, before a counted verdict of it carries the copy. An id that is
// neither the seat's own, nor shown to it in that ask, nor a copy it holds, is refused as before. Nothing here changes what a sustain does, what a
// "new" or a "reopens" records, or any prompt word. $0, offline, runChain direct (no CLI, no api).
//   CN-1a  the rulings section (layer 1 signed off in the pass): the reply is heard, nothing is re-asked, and its ruling settles.
//   CN-1b  the context section, reached as a shipped chain reaches it: a ladder pass that starts at layer 2 (layer 1 not asked in it).
//   CN-1c  NAMED PIN: a "continues" on an id not in the seat's prompt is still refused and re-asked.
//   CN-1d  "continues" plus a sustain of the same row in one reply: heard; the sustain settles as today; the defect is held once.
//   CN-2   the sustaining judge's own copy, on a ladder chain: its "continues <the copy's id>" in the next pass is heard.
//   CN-2r  NAMED PIN: a "reopens" on a copy that still stands is refused.
//   CN-2n1 / CN-2n2  NAMED PINS: a "new" on a copy's key leaves today's record (the copy's id on the first ask; #2 once a counted verdict carries it).
//   CN-2w  NAMED PIN (unit): a copy its seat withdrew, or withdraws in the same reply, is refused for "continues".
// A NAMED PIN passes before and after the change; its FAIL CONDITION is in its title.
// RED BASE 6eb41961 (src/ and test/helpers/ identical at bbad2f50): CN-1a, CN-1b, CN-1d and CN-2 fail at "no relation refusal" (continues_not_standing).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as HB from './held-prompts/held-084-b.js';
import { scenario, CRITERION, idOf, repeatOf, bareFailureOf, FINAL_READ_OK } from './helpers/layer-two-run.js';
import { setHeldForTest } from '../src/held-roles.js';
import { objectionId } from '../src/objection-ids.js';
import { assignIds } from '../src/objection-assign.js';
import { DEMAND } from './helpers/rating-demand.js';

afterEach(() => setHeldForTest(null));

const LIVE = Object.freeze({ ...DEMAND, relationRule: HB.relationRule, layerOneRulingsSection: HB.layerOneRulingsSection, layerOneRulingsReplyTail: HB.layerOneRulingsReplyTail, layerOneRulingsLedgerSection: HB.layerOneRulingsLedgerSection });
const refsOf = text => [...String(text).matchAll(/<prior-review ref="([^"]+)"/g)].map(m => m[1]);
const verdictOf = (failures, extra = {}) => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures, verdict_line: 'no', ...extra });
const restated = (severity, id) => ({ ...bareFailureOf(severity), relation: `continues ${id}` });   // the judge restates the row as its own
const refusals = (lines, lab) => lines.map(String).filter(l => /relation field cannot be used/.test(l) && l.includes(`${lab}/`));
const ownFailureOf = (result, lab) => (result?.lastCritique?.failures ?? []).filter(f => f.lab === lab);
// The refusal checks come first and survive a throw (the helper puts `served` and `prompts` on the error; the log lines are the test's own).
const runOf = async opts => { try { return { ...(await scenario(opts)), threw: null }; } catch (e) { return { result: null, prompts: e?.prompts ?? new Map(), served: e?.served ?? [], threw: e }; } };

test('CN-1a: a layer-2 judge that restates a layer-1 row shown in its rulings section as "continues <that id>" is heard: the failure is its own (its own id, the relation kept), nothing is re-asked, and its ruling in the same reply settles', async () => {
  setHeldForTest(LIVE);
  const ID = idOf(3);
  const lines = [];
  const s = await runOf({ answerBack: true, l1Severity: 3, lines, overrides: { ...FINAL_READ_OK, 'panel-1-lb': verdictOf([restated(3, ID)], { rulings: [{ id: ID, ruling: 'overrule', reason: 'Section two sets the limit.' }] }) } });
  const p = s.prompts.get('panel-1-lb');
  assert.ok(p, 'premise: layer 2 was asked in pass 1');
  assert.deepEqual(refsOf(p.user), [ID], 'premise: the id is shown in its ask');
  assert.ok(p.user.includes(`<prior-review ref="${ID}">`), 'premise: the rulings section (its rows name no raiser)');
  assert.deepEqual(refusals(lines, 'lb'), [], 'no relation refusal');
  assert.equal(s.served.includes('panel-1-lb-reask1'), false, 'no re-ask');
  assert.equal(s.threw, null, `the run ends without a throw: ${s.threw?.message ?? ''}`);
  const mine = ownFailureOf(s.result, 'lb');
  assert.equal(mine.length, 1, 'the judge holds the defect as its own');
  assert.equal(mine[0].id, objectionId('lb', bareFailureOf(3)), 'under its own id');
  assert.equal(mine[0].relation, `continues ${ID}`, 'the declared relation stays as written');
  const lc = s.prompts.get('panel-1-lc');
  assert.ok(lc && lc.user.includes(`- ${ID}, raised by la (layer 1) in round 1: overruled by every judge of layer 2 in round 1.`), 'its ruling in the same reply settled');
});

test('CN-1b: on a ladder pass that starts at layer 2 (layer 1 not asked in it), a layer-2 judge that restates a layer-1 row shown in its context section as "continues <that id>" is heard the same way', async () => {
  setHeldForTest(LIVE);
  const ID = idOf(5);
  const lines = [];
  const s = await runOf({ answerBack: true, ladder: true, l1Severity: 5, lines, overrides: { ...FINAL_READ_OK, 'panel-2-la': verdictOf([repeatOf(5)]), 'panel-3-la': verdictOf([repeatOf(5)]), 'panel-4-lb': verdictOf([restated(5, ID)]) } });
  assert.ok(lines.map(String).some(l => /ladder: pass 4 starts at layer 2/.test(l)), 'premise: the ladder starts pass 4 at layer 2');
  assert.equal(s.prompts.has('panel-4-la'), false, 'premise: layer 1 is not asked in pass 4');
  const p = s.prompts.get('panel-4-lb');
  assert.ok(p, 'premise: layer 2 is asked in pass 4');
  assert.ok(refsOf(p.user).includes(ID), 'premise: the id is shown in its ask');
  assert.ok(p.user.includes(`<prior-review ref="${ID}" lab="la">`), 'premise: the context section (its rows name the raiser), not the rulings section');
  assert.deepEqual(refusals(lines, 'lb'), [], 'no relation refusal');
  assert.equal(s.served.includes('panel-4-lb-reask1'), false, 'no re-ask');
  assert.equal(s.threw, null, `the run ends without a throw: ${s.threw?.message ?? ''}`);
  const mine = ownFailureOf(s.result, 'lb');
  assert.equal(mine.length, 1, 'the judge holds the defect as its own');
  assert.equal(mine[0].id, objectionId('lb', bareFailureOf(5)), 'under its own id');
  assert.equal(mine[0].relation, `continues ${ID}`, 'the declared relation stays as written');
});

test('CN-1c NAMED PIN (passes before and after the change; FAIL CONDITION: the guard opens): a "continues" on an id that is not in the seat\'s prompt (another seat\'s id it was not shown) is still refused and re-asked', async () => {
  setHeldForTest(LIVE);
  const NOT_SHOWN = objectionId('lc', bareFailureOf(3));
  const lines = [];
  const s = await runOf({ answerBack: true, l1Severity: 3, lines, overrides: { ...FINAL_READ_OK, 'panel-1-lb': verdictOf([restated(3, NOT_SHOWN)]) } });
  const p = s.prompts.get('panel-1-lb');
  assert.ok(p, 'premise: layer 2 was asked in pass 1');
  assert.equal(refsOf(p.user).includes(NOT_SHOWN), false, 'premise: that id is not in its prompt');
  assert.ok(refusals(lines, 'lb').some(l => l.includes(`continues_not_standing: ${NOT_SHOWN}`)), 'refused as before');
  assert.ok(s.served.includes('panel-1-lb-reask1'), 're-asked as before');
});

test('CN-2: on a ladder chain, layer 2 sustains a layer-1 row in its own review; in the next pass that reaches it, its prompt shows the copy\'s id as its own, and its "continues <the copy\'s id>" is heard', async () => {
  setHeldForTest(LIVE);
  const ID = idOf(3);
  const COPY = objectionId('lb', bareFailureOf(3));   // the copy a sustain makes under the sustaining seat (src/chain.js settleEscalationRulings)
  const TOP = { criterion: CRITERION, problem: 'No back-off is named.', quote: 'failed requests', fix: 'Name one.', severity: 5, relation: 'new' };   // the top layer's own objection: it makes the writer revise
  const lines = [];
  const s = await runOf({ answerBack: true, ladder: true, l1Severity: 3, lines, overrides: { ...FINAL_READ_OK,
    'panel-1-lb': JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two.' }], failures: [], verdict_line: 'ok', rulings: [{ id: ID, ruling: 'sustain', reason: 'The limit is not stated.' }] }),
    'panel-1-lc': verdictOf([TOP]),
    'panel-2-lb': verdictOf([restated(3, COPY)]) } });
  assert.ok(lines.map(String).some(l => l.includes(`${ID}: sustained by lb`)), 'premise: layer 2 sustained the row in its own review in pass 1');
  const p = s.prompts.get('panel-2-lb');
  assert.ok(p, 'premise: layer 2 is asked again in pass 2');
  assert.ok(p.user.includes(COPY), 'premise: its prompt shows the copy\'s id');
  assert.deepEqual(refusals(lines, 'lb'), [], 'no relation refusal');
  assert.equal(s.served.includes('panel-2-lb-reask1'), false, 'no re-ask');
});

test('CN-2r NAMED PIN (passes before and after the change; FAIL CONDITION: a "reopens" on a copy the seat still holds is accepted): the sustaining judge\'s "reopens <the copy\'s id>" in a later pass is refused, as a "reopens" on any objection that still stands', async () => {
  setHeldForTest(LIVE);
  const ID = idOf(3);
  const COPY = objectionId('lb', bareFailureOf(3));
  const TOP = { criterion: CRITERION, problem: 'No back-off is named.', quote: 'failed requests', fix: 'Name one.', severity: 5, relation: 'new' };
  const lines = [];
  const s = await runOf({ answerBack: true, ladder: true, l1Severity: 3, lines, overrides: { ...FINAL_READ_OK,
    'panel-1-lb': JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two.' }], failures: [], verdict_line: 'ok', rulings: [{ id: ID, ruling: 'sustain', reason: 'The limit is not stated.' }] }),
    'panel-1-lc': verdictOf([TOP]),
    'panel-2-lb': verdictOf([{ ...bareFailureOf(3), relation: `reopens ${COPY}` }]) } });
  assert.ok(lines.map(String).some(l => l.includes(`${ID}: sustained by lb`)), 'premise: layer 2 sustained the row in its own review in pass 1');
  assert.ok(s.prompts.get('panel-2-lb')?.user.includes(COPY), 'premise: its pass-2 prompt shows the copy\'s id');
  assert.ok(refusals(lines, 'lb').some(l => l.includes(`reopens_not_closed: ${COPY}`)), 'refused: the copy still stands');
});

test('CN-1d: a layer-2 judge that restates a layer-1 row as "continues <that id>" and sustains it in the same reply is heard; the sustain settles as today (the raiser\'s id closes), and the defect is held once, under the judge\'s own id, because that id is the one a copy would take', async () => {
  setHeldForTest(LIVE);
  const ID = idOf(3);
  const MINE = objectionId('lb', bareFailureOf(3));   // the judge's own id for the restated row: the same criterion and quoted passage, so the same id a sustain's copy would take
  const lines = [];
  const s = await runOf({ answerBack: true, l1Severity: 3, lines, overrides: { ...FINAL_READ_OK, 'panel-1-lb': verdictOf([restated(3, ID)], { rulings: [{ id: ID, ruling: 'sustain', reason: 'The limit is not stated.' }] }) } });
  const p = s.prompts.get('panel-1-lb');
  assert.ok(p && refsOf(p.user).includes(ID), 'premise: the id is shown in its ask');
  assert.deepEqual(refusals(lines, 'lb'), [], 'no relation refusal');
  assert.equal(s.served.includes('panel-1-lb-reask1'), false, 'no re-ask');
  assert.ok(lines.map(String).some(l => l.includes(`${ID}: sustained by lb`)), 'the sustain in the same reply settled');
  assert.equal(s.threw, null, `the run ends without a throw: ${s.threw?.message ?? ''}`);
  const failures = s.result.lastCritique?.failures ?? [];
  assert.deepEqual(failures.filter(f => f.lab === 'lb').map(f => f.id), [MINE], 'the defect is held once, under the judge\'s own id');
  assert.equal(failures.find(f => f.lab === 'lb').relation, `continues ${ID}`, 'the declared relation stays as written');
  assert.equal(failures.some(f => f.lab === 'la' && f.id === ID), false, 'the raiser\'s id is closed by the sustain, as today');
});

// The two "new" rows on a copy's key: NAMED PINS of today's record (C&C's ruling: a "new" on a copy's key leaves the same record as today on every ask).
const sustainThenTop = { 'panel-1-lb': JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two.' }], failures: [], verdict_line: 'ok', rulings: [{ id: idOf(3), ruling: 'sustain', reason: 'The limit is not stated.' }] }), 'panel-1-lc': verdictOf([{ criterion: CRITERION, problem: 'No back-off is named.', quote: 'failed requests', fix: 'Name one.', severity: 5, relation: 'new' }]) };

test('CN-2n1 NAMED PIN (passes before and after the change; FAIL CONDITION: a "new" on a copy\'s key gets another id on the first ask after the sustain): on that first ask the judge\'s "new" with the copy\'s criterion and quoted passage takes the copy\'s own id, as today', async () => {
  setHeldForTest(LIVE);
  const COPY = objectionId('lb', bareFailureOf(3));
  const lines = [];
  const s = await runOf({ answerBack: true, ladder: true, l1Severity: 3, lines, overrides: { ...FINAL_READ_OK, ...sustainThenTop, 'panel-2-lb': verdictOf([{ ...bareFailureOf(3), relation: 'new' }]) } });
  assert.ok(lines.map(String).some(l => l.includes(`${idOf(3)}: sustained by lb`)), 'premise: layer 2 sustained the row in pass 1');
  assert.ok(s.prompts.get('panel-2-lb')?.user.includes(COPY), 'premise: the first ask after the sustain shows the copy\'s id');
  assert.deepEqual(refusals(lines, 'lb'), [], 'no relation refusal');
  assert.equal(s.threw, null, `the run ends without a throw: ${s.threw?.message ?? ''}`);
  const mine = ownFailureOf(s.result, 'lb');
  assert.deepEqual([...new Set(mine.map(f => f.id))], [COPY], 'the copy\'s own id, with no suffix, as today');
});

test('CN-2n2 NAMED PIN (passes before and after the change; FAIL CONDITION: a "new" on a copy\'s key keeps the copy\'s id once a counted verdict carries the copy): on a later ask, after a counted verdict of the judge carried its copy, a "new" with the copy\'s key is a second objection under that key (#2), as today', async () => {
  setHeldForTest(LIVE);
  const COPY = objectionId('lb', bareFailureOf(3));
  const TOP = { criterion: CRITERION, problem: 'No back-off is named.', quote: 'failed requests', fix: 'Name one.', severity: 5 };
  const lines = [];
  const s = await runOf({ answerBack: true, ladder: true, l1Severity: 3, lines, overrides: { ...FINAL_READ_OK, ...sustainThenTop,
    'panel-2-lc': verdictOf([{ ...TOP, relation: `continues ${objectionId('lc', TOP)}` }]),
    'panel-3-lb': verdictOf([{ ...bareFailureOf(3), relation: 'new' }]) } });
  assert.ok(lines.map(String).some(l => l.includes(`${idOf(3)}: sustained by lb`)), 'premise: layer 2 sustained the row in pass 1');
  assert.ok(s.prompts.has('panel-2-lb') && s.prompts.has('panel-3-lb'), 'premise: layer 2 was asked in passes 2 and 3');
  assert.deepEqual(refusals(lines, 'lb'), [], 'no relation refusal');
  assert.equal(s.threw, null, `the run ends without a throw: ${s.threw?.message ?? ''}`);
  const second = ownFailureOf(s.result, 'lb').find(f => f.id === `${COPY}#2`);
  assert.ok(second, `a second objection under the copy's key: ${JSON.stringify(ownFailureOf(s.result, 'lb').map(f => f.id))}`);   // the assigner's same_key mark is not kept on the record (no reader in src/), so the id is what this pins
});

test('CN-2w NAMED PIN (passes before and after the change; FAIL CONDITION: a copy its seat withdrew is heard for "continues"): a held copy that the seat\'s history holds as withdrawn, or that the same reply withdraws, is refused, as a withdrawn objection of its own is', () => {
  const COPY = objectionId('lb', bareFailureOf(3));
  const f = { ...bareFailureOf(3), relation: `continues ${COPY}` };
  const withdrawn = new Map([[COPY, { base: COPY, problemNorm: 'no retry limit is specified.', state: 'withdrawn' }]]);
  assert.equal(assignIds({ lab: 'lb', failures: [f], own: withdrawn, held: new Set([COPY]) }).unreadable?.why, 'continues_not_standing', 'its history holds the copy as withdrawn');
  assert.equal(assignIds({ lab: 'lb', failures: [f], own: new Map(), held: new Set([COPY]), withdrawnNow: new Set([COPY]) }).unreadable?.why, 'continues_not_standing', 'the same reply withdraws it');
});
