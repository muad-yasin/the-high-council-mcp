// The SLOT RULE and the comparison table's switches (0.8.3 M6 S8-9, C2a gate 1, C&C 14 Oct 2026; gate page Review/Build_0.8.3/m6-closing/C2a_Gate_Page.md sections 4 and 5). PURE: sides in, bindings and fates out. $0, no file, no clock.
//   F1 (the milestone id) is a LABEL and is not compared; F3 (open_question) is SUBSTANCE (Muad's word); F7 compares the SIBLING by its content, not its label.
//   comparePairs / assignSlots: every candidate from ANY path is compared with every slot (relocation by content); the NEWEST FULLY ADOPTABLE candidate takes a slot, one candidate per slot and one slot per candidate; EVERY candidate's fate is returned (a kept candidate is never dropped).
import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson } from '../src/thin-contract.js';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
const reuse = await import('../src/tree-reuse.js').catch(() => ({}));
const loader = await import('../src/tree-reuse-load.js').catch(() => ({}));
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { runTree } from '../src/tree-run.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { splitChildren } from './helpers/child-chains.js';
import { approvePending, draftStarter } from './helpers/sitting.js';

const KEY = (text, cls = 'delegated') => ({ originNode: 'R', originClass: cls, textSha256: `h:${text.replace(/\s+/g, ' ').trim()}` });
const idOf = (text, gen, id, cls = 'delegated') => ({ originNode: 'R', originGeneration: gen, originId: id, originClass: cls, textSha256: `h:${text.replace(/\s+/g, ' ').trim()}`, form: text });
const acc = (text, gen, id) => ({ key: KEY(text), text, form: text, from: `R@g${gen}:${id}`, identity: idOf(text, gen, id) });
/** A side as `sideOf` makes it. `topic` makes its content distinct from another milestone's. */
const side = (topic, o = {}) => ({
  node: 'R/M1', milestone: 'M1', scope: `Build the ${topic}.`, openQuestion: `Which ${topic}?`,
  acceptance: [acc(`The ${topic} works.`, 1, 'C1')], refinements: [], carried: [],
  agreements: [], rootSections: [{ heading: 'Goal', text: 'Build a small notes app.' }], chain: '{"debate":true,"handoff":true,"kindsEnabled":false}', expects: [], ...o,
});
const slot = (node, generation, position, topic, o = {}) => ({ node, generation, position, newSide: side(topic, { node, milestone: node.split('/').pop(), ...o.side }), ...(o.expects ? { expects: o.expects } : {}) });
const cand = (node, generation, topic, o = {}) => ({ key: `${node}@g${generation}`, node, generation, runId: `run-${node.replace(/\W/g, '')}-${generation}`, oldSide: side(topic, { node, milestone: node.split('/').pop() }), oldProblem: null, eligible: true, ineligibleWhy: null, wholeBranch: true, dependsOn: [], ...o });
const pin = (node, generation) => ({ node, generation, runId: `run-${node.replace(/\W/g, '')}-${generation}` });
const run = (slots, candidates, ambiguousKeys = []) => reuse.assignSlots({ slots, candidates, pairs: reuse.comparePairs({ slots, candidates, ambiguousKeys }) });
const bound = r => Object.fromEntries(r.bindings.map(b => [b.slot, b.candidate]));
const fateOf = (r, key) => r.fates.find(f => f.candidate === key);

test('SL-1 F1 is a LABEL: a changed milestone id alone is `same`, adopts, and leaves fieldsSha256 unchanged; F3 is SUBSTANCE: a changed open question is `changed: open question differs`', () => {
  const rows = (slotSide, oldSide) => reuse.compareChildren({ ambiguousKeys: [], children: [{ node: 'R/M1', slot: { node: 'R/M1', generation: 2 }, newSide: slotSide, oldSide, old: { node: 'R/M1', generation: 1, runId: 'r' }, eligible: true, wholeBranch: true }] })[0];
  const same = rows(side('store'), side('store'));
  const relabelled = rows(side('store', { milestone: 'M9', node: 'R/M9' }), side('store'));
  assert.equal(relabelled.verdict, 'same', JSON.stringify(relabelled)); assert.equal(relabelled.fieldsSha256, same.fieldsSha256, 'the label is not in the bound hash');
  const asked = rows(side('store', { openQuestion: 'Another question?' }), side('store'));
  assert.equal(asked.verdict, 'changed'); assert.equal(asked.field, 'open_question'); assert.match(asked.reason, /open question differs/);
  assert.equal(reuse.COMPARED_FIELDS.milestone, false); assert.equal(reuse.COMPARED_FIELDS.open_question, true); assert.ok(Object.isFrozen(reuse.COMPARED_FIELDS));
});

test('SL-2 F7 compares the sibling by its own CONTENT: the same agreement with a re-labelled sibling is `same`; a changed sibling scope is `changed: agreements differ`; two siblings with one scope make it ambiguous', () => {
  const agr = (o = {}) => ({ direction: 'provides', sibling: 'M2', siblingScope: 'Build the API.', siblingAmbiguous: false, what: 'get(id)', integrationCheck: 'Call get.', providerRefs: ['Overview'], ...o });
  const one = (n, o) => reuse.compareChildren({ ambiguousKeys: [], children: [{ node: 'R/M1', slot: { node: 'R/M1', generation: 2 }, newSide: side('store', { agreements: [agr(n)] }), oldSide: side('store', { agreements: [agr(o)] }), old: { node: 'R/M1', generation: 1, runId: 'r' }, eligible: true, wholeBranch: true }] })[0];
  assert.equal(one({ sibling: 'M7' }, {}).verdict, 'same', 'the sibling moved to another label: the same sibling');
  const moved = one({ siblingScope: 'Build the CLI.' }, {}); assert.equal(moved.verdict, 'changed'); assert.equal(moved.field, 'agreements');
  const amb = one({ siblingAmbiguous: true }, {}); assert.equal(amb.verdict, 'changed'); assert.match(amb.reason, /agreements are ambiguous/);
});

test('SL-3 the SAME PATH takes its own finished node (one slot, one candidate) and a kept candidate is returned with its reason, never dropped', () => {
  const slots = [slot('R/M1', 2, 0, 'store')];
  const r = run(slots, [cand('R/M1', 1, 'store'), cand('R/M2', 1, 'api')]);
  assert.deepEqual(bound(r), { 'R/M1@g2': 'R/M1@g1' });
  assert.deepEqual(r.fates.map(f => [f.candidate, f.fate]), [['R/M1@g1', 'adopted'], ['R/M2@g1', 'kept']]);
  assert.match(fateOf(r, 'R/M2@g1').reason, /^changed: scope differs/, 'the reason is the comparison\'s, shown');
  assert.equal(fateOf(r, 'R/M2@g1').code, 'scope', 'C3 a: the bound fate is a CODE, the field of the comparison');
  assert.equal(fateOf(r, 'R/M1@g1').code, 'same');
  assert.equal(fateOf(r, 'R/M1@g1').moved, false);
  assert.deepEqual(r.slotFates.map(f => [f.slot, f.fate, f.candidate]), [['R/M1@g2', 'reused', 'R/M1@g1']]);
});

test('SL-4 RELOCATION BY CONTENT: a swap (M1 and M2 trade content) adopts across paths, says it moved, and carries the identity map', () => {
  const slots = [slot('R/M1', 2, 0, 'api'), slot('R/M2', 2, 1, 'store')];
  const r = run(slots, [cand('R/M1', 1, 'store'), cand('R/M2', 1, 'api')]);
  assert.deepEqual(bound(r), { 'R/M1@g2': 'R/M2@g1', 'R/M2@g2': 'R/M1@g1' });
  assert.deepEqual(r.fates.map(f => [f.candidate, f.fate, f.slot, f.moved]), [['R/M1@g1', 'adopted', 'R/M2@g2', true], ['R/M2@g1', 'adopted', 'R/M1@g2', true]]);
  const row = r.bindings.find(b => b.slot === 'R/M1@g2').row;
  assert.deepEqual(row.adopts, { node: 'R/M2', generation: 1, runId: 'run-RM2-1' }, 'the row names the SOURCE node: the move is the difference between the slot and this');
  assert.ok(row.identityMap.length >= 1 && row.identityMap.every(m => /^R@g1:/.test(m.from)));
});

test('SL-5 two ERAS compete for one slot: the NEWEST fully adoptable candidate wins and the other is kept with the reason; if the newer one fails a gate the older one wins', () => {
  const slots = [slot('R/M1', 3, 0, 'store')];
  const both = run(slots, [cand('R/M1', 1, 'store'), cand('R/M1', 2, 'store')]);
  assert.deepEqual(bound(both), { 'R/M1@g3': 'R/M1@g2' });
  assert.equal(fateOf(both, 'R/M1@g1').fate, 'kept'); assert.equal(fateOf(both, 'R/M1@g1').reason, 'slot R/M1@g3 was filled by R/M1@g2'); assert.equal(fateOf(both, 'R/M1@g1').code, 'slot_filled');
  for (const [why, newer] of [['changed content', cand('R/M1', 2, 'other')], ['not eligible', cand('R/M1', 2, 'store', { eligible: false, ineligibleWhy: 'it is stopped' })], ['old side unverifiable', cand('R/M1', 2, 'store', { oldSide: null, oldProblem: 'its bundle was edited' })]]) {
    const r = run(slots, [cand('R/M1', 1, 'store'), newer]);
    assert.deepEqual(bound(r), { 'R/M1@g3': 'R/M1@g1' }, `${why}: the newest FULLY adoptable wins, not the newest match`);
    assert.equal(fateOf(r, 'R/M1@g2').fate, 'kept', why);
  }
  assert.equal(fateOf(run(slots, [cand('R/M1', 1, 'store'), cand('R/M1', 2, 'store', { eligible: false, ineligibleWhy: 'it is stopped' })]), 'R/M1@g2').reason, 'changed: it is stopped');
  // WHOLE BEFORE GENERATION (C&C's ruling, 14 Oct 2026; the recorded disposition is "newest FULLY adoptable" and Astra's own example picks a whole A@g1 over an unfinished A@g2): a NEWER candidate that is not whole (adopted as itself, outcome b) does NOT beat an older WHOLE one; the newer one stays kept with its reason. FLIPPED: this row used to assert the newer as-itself candidate wins.
  const newerSelf = run(slots, [cand('R/M1', 1, 'store'), cand('R/M1', 2, 'store', { wholeBranch: false })]);
  assert.deepEqual(bound(newerSelf), { 'R/M1@g3': 'R/M1@g1' }); assert.equal(newerSelf.bindings[0].outcome, 'whole'); assert.equal(fateOf(newerSelf, 'R/M1@g2').reason, 'slot R/M1@g3 was filled by R/M1@g1');
  const onlySelf = run(slots, [cand('R/M1', 2, 'store', { wholeBranch: false })]);
  assert.deepEqual(bound(onlySelf), { 'R/M1@g3': 'R/M1@g2' }); assert.equal(onlySelf.bindings[0].outcome, 'self', 'with no whole candidate the as-itself one is adopted');
});

test('SL-6 one candidate that fits TWO slots (duplicate milestones) fills exactly one: its own path first, the other slot is a new run, and the fate names both', () => {
  const slots = [slot('R/M1', 2, 0, 'store'), slot('R/M2', 2, 1, 'store')];
  const r = run(slots, [cand('R/M2', 1, 'store')]);
  assert.deepEqual(bound(r), { 'R/M2@g2': 'R/M2@g1' }, 'its own path wins the tie');
  assert.deepEqual(r.slotFates.map(f => [f.slot, f.fate]), [['R/M1@g2', 'new'], ['R/M2@g2', 'reused']]);
  const noPath = run(slots, [cand('R/M9', 1, 'store')]);
  assert.deepEqual(bound(noPath), { 'R/M1@g2': 'R/M9@g1' }, 'with no own path the earlier slot in the split wins, deterministically');
});

test('SL-7 the PROVIDER gate runs to a fixed point and at RUN level: a consumer whose supplier slot is not reused, or is reused from a different run than the one it was planned against, is not reused; its candidate is kept with the reason', () => {
  const slots = [slot('R/M1', 2, 0, 'store'), slot('R/M2', 2, 1, 'api', { expects: ['R/M1'] })];
  const consumer = (o = {}) => cand('R/M2', 1, 'api', { dependsOn: [pin('R/M1', 1)], ...o });
  const ok = run(slots, [cand('R/M1', 1, 'store'), consumer()]);
  assert.deepEqual(bound(ok), { 'R/M1@g2': 'R/M1@g1', 'R/M2@g2': 'R/M2@g1' });
  const redone = run(slots, [cand('R/M1', 1, 'changed supplier'), consumer()]);
  assert.deepEqual(bound(redone), {}, 'the supplier is redone, so its consumer is redone too');
  assert.equal(fateOf(redone, 'R/M2@g1').reason, 'changed: provider R/M1 is not reused');
  assert.equal(redone.slotFates.find(f => f.slot === 'R/M2@g2').fate, 'new');
  // two eras: the slot takes the NEWER supplier run (g2); a consumer planned against the OLDER one (g1) is not reused, one planned against g2 is (Astra #8: the run, not the path)
  const eras = [cand('R/M1', 1, 'store'), cand('R/M1', 2, 'store')];
  const against1 = run([slot('R/M1', 3, 0, 'store'), slot('R/M2', 3, 1, 'api', { expects: ['R/M1'] })], [...eras, consumer()]);
  assert.deepEqual(bound(against1), { 'R/M1@g3': 'R/M1@g2' }); assert.equal(fateOf(against1, 'R/M2@g1').reason, 'changed: provider R/M1 is not the run this plan was made against');
  const against2 = run([slot('R/M1', 3, 0, 'store'), slot('R/M2', 3, 1, 'api', { expects: ['R/M1'] })], [...eras, consumer({ dependsOn: [pin('R/M1', 2)] })]);
  assert.deepEqual(bound(against2), { 'R/M1@g3': 'R/M1@g2', 'R/M2@g3': 'R/M2@g1' });
  // a MOVED supplier still matches by its run: the supplier's content moved to R/M5, the consumer is still reused
  const moved = run([slot('R/M5', 2, 0, 'store'), slot('R/M2', 2, 1, 'api', { expects: ['R/M5'] })], [cand('R/M1', 1, 'store'), consumer()]);
  assert.deepEqual(bound(moved), { 'R/M5@g2': 'R/M1@g1', 'R/M2@g2': 'R/M2@g1' });
  // FAIL CLOSED: a supplier path that is not a slot of this frontier, or a consumer with no pins on record, is not reused
  const outside = run([slot('R/M2', 2, 0, 'api', { expects: ['R/M9'] })], [consumer()]);
  assert.deepEqual(bound(outside), {}); assert.equal(fateOf(outside, 'R/M2@g1').reason, 'changed: provider R/M9 is not reused');
  const legacy = run(slots, [cand('R/M1', 1, 'store'), cand('R/M2', 1, 'api', { dependsOn: undefined })]);
  assert.deepEqual(bound(legacy), { 'R/M1@g2': 'R/M1@g1' }); assert.match(fateOf(legacy, 'R/M2@g1').reason, /cannot be checked/);
  // a supplier the candidate was planned against that no supplier slot reuses
  const stray = run([slot('R/M2', 2, 0, 'api')], [consumer()]);
  assert.deepEqual(bound(stray), {}); assert.match(fateOf(stray, 'R/M2@g1').reason, /planned against R\/M1@g1, which no supplier slot of this plan reuses/);
});

test('SL-8 the result does not depend on the order the slots and candidates are listed in, and every candidate appears in the fates exactly once', () => {
  const slots = [slot('R/M1', 3, 0, 'store'), slot('R/M2', 3, 1, 'api'), slot('R/M3', 3, 2, 'cli', { expects: ['R/M2'] })];
  const cands = [cand('R/M1', 1, 'store'), cand('R/M1', 2, 'store'), cand('R/M2', 2, 'api'), cand('R/M3', 1, 'cli', { dependsOn: [pin('R/M2', 2)] }), cand('R/M4', 1, 'ui')];
  const canon = r => canonicalJson({ b: [...r.bindings.map(b => [b.slot, b.candidate])].sort(), f: [...r.fates].sort((a, b) => (a.candidate < b.candidate ? -1 : 1)), s: [...r.slotFates].sort((a, b) => (a.slot < b.slot ? -1 : 1)) });
  const base = canon(run(slots, cands));
  const perms = [[...slots].reverse(), [slots[1], slots[2], slots[0]]];
  for (const sl of perms) for (const cs of [[...cands].reverse(), [cands[3], cands[0], cands[4], cands[2], cands[1]]]) assert.equal(canon(run(sl, cs)), base);
  const r = run(slots, cands);
  assert.deepEqual(r.fates.map(f => f.candidate).sort(), cands.map(c => c.key).sort());
  assert.equal(fateOf(r, 'R/M4@g1').fate, 'kept'); assert.equal(r.slotFates.length, slots.length);
});

test('SL-9 an ambiguous acceptance list makes the pair `changed` for every candidate, and no slots at all keeps every candidate with that reason', () => {
  const slots = [slot('R/M1', 2, 0, 'store')];
  const key = canonicalJson(KEY('The store works.'));
  const r = run(slots, [cand('R/M1', 1, 'store')], [key]);
  assert.deepEqual(bound(r), {}); assert.match(fateOf(r, 'R/M1@g1').reason, /acceptance list is ambiguous/);
  const none = run([], [cand('R/M1', 1, 'store')]);
  assert.equal(fateOf(none, 'R/M1@g1').fate, 'kept'); assert.equal(fateOf(none, 'R/M1@g1').reason, 'the new plan has no slot for it'); assert.equal(fateOf(none, 'R/M1@g1').code, 'no_slot');
});

test('SL-10 OUTCOME (b): a candidate whose own inputs are unchanged but whose branch is not whole is adopted AS ITSELF (outcome `self`); a not-whole candidate whose own inputs changed is kept with the reason; a whole one of the same kind beats it', () => {
  const slots = [slot('R/M1', 2, 0, 'store')];
  const selfOnly = run(slots, [cand('R/M1', 1, 'store', { wholeBranch: false })]);
  assert.deepEqual(bound(selfOnly), { 'R/M1@g2': 'R/M1@g1' }); assert.equal(selfOnly.bindings[0].outcome, 'self');
  assert.match(fateOf(selfOnly, 'R/M1@g1').reason, /^adopted as itself: its own inputs are unchanged but its branch is not whole/);
  const whole = run(slots, [cand('R/M1', 1, 'store')]); assert.equal(whole.bindings[0].outcome, 'whole');
  const changed = run(slots, [cand('R/M1', 1, 'other', { wholeBranch: false })]);
  assert.deepEqual(bound(changed), {}); assert.equal(fateOf(changed, 'R/M1@g1').reason, 'changed: its branch is not whole');
  const both = run(slots, [cand('R/M1', 1, 'store', { wholeBranch: false }), cand('R/M2', 1, 'store')]);
  assert.deepEqual(bound(both), { 'R/M1@g2': 'R/M1@g1' }, 'the candidate on its own path wins before the outcome is weighed');
  const sameGen = run([slot('R/M3', 2, 0, 'store')], [cand('R/M1', 1, 'store', { wholeBranch: false }), cand('R/M2', 1, 'store')]);
  assert.deepEqual(bound(sameGen), { 'R/M3@g2': 'R/M2@g1' }, 'at equal path match and generation a WHOLE branch beats an as-itself one');
  const stopped = run(slots, [cand('R/M1', 1, 'store', { wholeBranch: false, eligible: false, ineligibleWhy: 'it is stopped' })]);
  assert.deepEqual(bound(stopped), {}, 'an ineligible node is never adopted, whole or not');
});

test('SL-11 the PER-CANDIDATE loader on a REAL tree: slots in the split\'s order, every candidate verified against its OWN proposing parent, supplier pins translated to run level, and the slot rule binds each node to itself with a consumer\'s pins satisfied (known-bad: a wrong pin keeps the consumer)', async () => {
  const r = await trackedRealRoot(splitChildren()); approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });      // the same fixture as RU-10: every child of the split is registered
  const state = stateOf(readTreeRecord(r.t.rootDir));
  const keys = [...state.nodes.keys()].filter(k => /^R\/[^/]+@g1$/.test(k));
  assert.ok(keys.length >= 2, `children registered: ${keys}`);
  const common = { rootDir: r.t.rootDir, work: r.t.work, rootTaskPath: join(r.t.work, 'tasks', 'x.md'), newParent: { node: 'R', generation: 1 }, slotGeneration: 2, candidateKeys: keys, eligibility: () => ({ eligible: true }), wholeBranch: () => true };
  assert.throws(() => loader.loadSlotsAndCandidates({ ...common, eligibility: undefined }), /eligibility/, 'no fail-open default for either predicate');
  assert.throws(() => loader.loadSlotsAndCandidates({ ...common, wholeBranch: undefined }), /wholeBranch/);
  const { slots, candidates, ambiguousKeys } = loader.loadSlotsAndCandidates(common);
  assert.equal(slots.length, keys.length); assert.ok(slots.every((x, i) => x.position === i && x.newSide && x.generation === 2));
  assert.ok(candidates.every(c => c.oldSide && c.oldProblem === null && c.runId === state.nodes.get(c.key).runId), JSON.stringify(candidates.map(c => [c.key, c.oldProblem])));
  const consumer = candidates.find(c => c.dependsOn?.length);
  assert.ok(consumer, 'the fixture has a CONSUMER whose supplier pins were registered');
  for (const d of consumer.dependsOn) assert.equal(d.runId, state.nodes.get(`${d.node}@g${d.generation}`).runId, 'the pin carries the supplier\'s run id from the record');
  const go = cs => reuse.assignSlots({ slots, candidates: cs, pairs: reuse.comparePairs({ slots, candidates: cs, ambiguousKeys }) });
  const ok = go(candidates);
  assert.deepEqual(Object.fromEntries(ok.bindings.map(b => [b.slot.replace(/@g2$/, ''), b.candidate.replace(/@g1$/, '')])), Object.fromEntries(keys.map(k => [k.replace(/@g1$/, ''), k.replace(/@g1$/, '')])), `every node takes its own slot: ${JSON.stringify(ok.fates)}`);
  const wrong = go(candidates.map(c => (c.key === consumer.key ? { ...c, dependsOn: c.dependsOn.map(d => ({ ...d, runId: 'some-other-run' })) } : c)));
  assert.ok(!wrong.bindings.some(b => b.candidate === consumer.key), 'a pin that names another run keeps the consumer out');
  assert.match(wrong.fates.find(f => f.candidate === consumer.key).reason, /is not the run this plan was made against/);
  const legacy = go(candidates.map(c => (c.key === consumer.key ? { ...c, dependsOn: undefined } : c)));
  assert.ok(!legacy.bindings.some(b => b.candidate === consumer.key) && /cannot be checked/.test(legacy.fates.find(f => f.candidate === consumer.key).reason), 'no pins on record: fail closed');
  // the pure translation: an unknown supplier and a missing field
  assert.deepEqual(loader.pinsOf({ registeredDependsOn: undefined, state, runsDir: '/nowhere' }), { pins: undefined, problem: null });
  assert.match(loader.pinsOf({ registeredDependsOn: [{ node: 'R/M99', generation: 1 }], state, runsDir: '/nowhere' }).problem, /is not in the record/);
});

test('SL-12 (BUG-B-002) a consumer\'s pins list the provider\'s whole SUBTREE: they count as filled when the occupant\'s own branch holds those very runs; a newer run of a branch node, or no branch on record, still refuses it', () => {
  const slots = [slot('R/M1', 2, 0, 'store'), slot('R/M2', 2, 1, 'api', { expects: ['R/M1'] })];
  const sub = [pin('R/M1/A', 1), pin('R/M1/B', 1)];
  const provider = (o = {}) => cand('R/M1', 1, 'store', { branchPins: sub, ...o });
  const consumer = cand('R/M2', 1, 'api', { dependsOn: [pin('R/M1', 1), ...sub] });
  const ok = run(slots, [provider(), consumer]);
  assert.deepEqual(bound(ok), { 'R/M1@g2': 'R/M1@g1', 'R/M2@g2': 'R/M2@g1' }, JSON.stringify(ok.fates));
  // FAIL CLOSED: the provider\'s branch now holds a NEWER run of A: the consumer was planned against the older one
  const newer = run(slots, [provider({ branchPins: [pin('R/M1/A', 2), pin('R/M1/B', 1)] }), consumer]);
  assert.deepEqual(bound(newer), { 'R/M1@g2': 'R/M1@g1' });
  assert.match(fateOf(newer, 'R/M2@g1').reason, /planned against R\/M1\/A@g1, which no supplier slot of this plan reuses/);
  // a candidate with no branch on record counts its own run only (the rule before this fix)
  const bare = run(slots, [cand('R/M1', 1, 'store'), consumer]);
  assert.deepEqual(bound(bare), { 'R/M1@g2': 'R/M1@g1' }); assert.match(fateOf(bare, 'R/M2@g1').reason, /planned against R\/M1\/A@g1/);
});

test('SL-13 (BUG-B-003) a candidate adopted AS ITSELF is dropped by the wire, so with adoptSelf false it binds nothing and cannot stand as the supplier of a consumer that is then reused against it', () => {
  const slots = [slot('R/M1', 2, 0, 'store'), slot('R/M2', 2, 1, 'api', { expects: ['R/M1'] })];
  const sub = [pin('R/M1/A', 1)];
  const cands = [cand('R/M1', 1, 'store', { wholeBranch: false, branchPins: sub }), cand('R/M2', 1, 'api', { dependsOn: [pin('R/M1', 1), ...sub] })];
  const go = o => reuse.assignSlots({ slots, candidates: cands, pairs: reuse.comparePairs({ slots, candidates: cands, ambiguousKeys: [] }), ...o });
  const pure = go({});
  assert.deepEqual(bound(pure), { 'R/M1@g2': 'R/M1@g1', 'R/M2@g2': 'R/M2@g1' }, 'the pure rule (C2b-3 as designed): the as-itself supplier binds and its consumer follows');
  assert.equal(pure.bindings.find(b => b.candidate === 'R/M1@g1').outcome, 'self');
  const wire = go({ adoptSelf: false });
  assert.deepEqual(bound(wire), {}, 'dropped: nothing binds, so the consumer is not reused against a supplier that is redone');
  assert.equal(fateOf(wire, 'R/M1@g1').fate, 'kept'); assert.equal(fateOf(wire, 'R/M1@g1').code, 'branch_not_whole');
  assert.equal(fateOf(wire, 'R/M2@g1').reason, 'changed: provider R/M1 is not reused');
  assert.match(readFileSync(new URL('../src/tree-reuse-wire.js', import.meta.url), 'utf8'), /assignSlots\(\{[^}]*adoptSelf: false/, 'a SOURCE pin: the wire passes adoptSelf false');
});

test('SL-14 branchPinsOf reads a candidate\'s own branch from the record by lineage: the newest run of each path below it, however deep, and nothing of another lineage', () => {
  const n = (node, generation, parentKey) => ({ node, generation, runId: `run-${node.replace(/\W/g, '')}-${generation}`, frontierKey: parentKey });
  const nodes = [n('R/M1', 1, 'f0'), n('R/M1/A', 1, 'f1'), n('R/M1/A', 2, 'f1'), n('R/M1/B', 1, 'f1'), n('R/M1/A/X', 1, 'f2'), n('R/M2', 1, 'f0'), n('R/M2/Q', 1, 'f3'), n('R/M1', 2, 'f0'), n('R/M1/C', 1, 'f4')];
  const state = { nodes: new Map(nodes.map(x => [`${x.node}@g${x.generation}`, x])), frontiers: new Map([['f0', { parentNode: 'R', parentGeneration: 1 }], ['f1', { parentNode: 'R/M1', parentGeneration: 1 }], ['f2', { parentNode: 'R/M1/A', parentGeneration: 2 }], ['f3', { parentNode: 'R/M2', parentGeneration: 1 }], ['f4', { parentNode: 'R/M1', parentGeneration: 2 }]]) };
  assert.deepEqual(loader.branchPinsOf(state, state.nodes.get('R/M1@g1')).map(p => `${p.node}@g${p.generation}`), ['R/M1/A@g2', 'R/M1/A/X@g1', 'R/M1/B@g1'], 'R/M1/C@g1 sits under R/M1@g2 (a replacement parent): another lineage, however equal the path prefix');
  assert.deepEqual(loader.branchPinsOf(state, state.nodes.get('R/M2@g1')).map(p => p.runId), ['run-RM2Q-1']);
  assert.deepEqual(loader.branchPinsOf(state, state.nodes.get('R/M1/B@g1')), [], 'a leaf has no branch');
});
