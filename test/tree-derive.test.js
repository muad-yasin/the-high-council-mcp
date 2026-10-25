// 0.8.3 M4: what a child receives (PLAN 6.1-6.4). Part 1: the pure derivation on in-memory data ($0, no model, no run). Part 2 (below): the loaders on real $0 mock runs, the real starts, the provider subtree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HELD_OFF } from './helpers/held-off.js';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson, sha256Of } from '../src/thin-contract.js';
import { infeasibleCriteria, metaCriteria, runChain } from '../src/chain.js';
import { DeriveRefusal, deriveChild, sectionOf, writeBundle } from '../src/tree-derive.js';
import { bundleDirName, bundleHashOfFiles, bundleSha256Of } from '../src/tree-continuation.js';
import { block3, planWith, validBlock } from './helpers/split-fixture.js';

const clone = v => JSON.parse(JSON.stringify(v));
const ROOT_ID = '2026-10-08T11-00-00-000Z';
const doc = (name, text) => ({ name, text, sha256: sha256Of(text) });
const ROOT_TASK = doc('task.md', '# Goal\nBuild a small reading-list app.\n\n# Notes\nSome notes.\n\n# Non-goals\nNo mobile app.\n');
const CHECKABLE = { criterion: 'Every step has a date.', kind: 'checkable', check: 'grep -c date plan.md', on: 'plan' };
const ROOT_CRITERIA = ['The plan names an owner for every step.', 'No step calls the network.', CHECKABLE, 'The plan fits on one page.'];   // C1..C4

/** The root as a parent: C1 global, C2 and C3 delegated, C4 root-only (validBlock's classes), with prefixed context_refs. */
function rootParent({ criteria = ROOT_CRITERIA, mutate = () => {} } = {}) {
  const block = validBlock();
  block.children[0].context_refs = ['root-task: Goal', 'root-task: Non-goals', 'parent-plan: Overview'];
  block.children[1].context_refs = ['root-task: Goal', 'root-task: Non-goals', 'parent-plan: Overview'];
  block.children[2].context_refs = ['root-task: Goal', 'root-task: Non-goals'];
  mutate(block);
  const text = planWith(block, { preface: 'REVISED MOCK DELIVERABLE\n\n' });
  return { node: 'R', generation: 1, runId: ROOT_ID, items: criteria.map((form, i) => ({ id: `C${i + 1}`, form })), obligations: null, block, blockSha256: sha256Of(canonicalJson(block)), plan: doc('deliverable.md', text) };
}
/** K1 as a provider for K2 (agreement A1 names the heading "Overview" in its plan). `pin` is what the record holds for it. */
function provider(over = {}) {
  const text = '# Plan\n\n## Overview\nget(id) and put(record).\n\n## Other\nUnrelated.\n';
  const thin = sha256Of('thin-contract of K1');
  return { node: 'R/M1', generation: 1, runId: '2026-10-08T11-20-00-000Z', thinContractSha256: thin, pin: thin, plan: doc('deliverable.md', text), descendants: [], resolutions: [], ...over };
}
const derive = (parent, childId, over = {}) => deriveChild({ treeId: ROOT_ID, generation: 1, parent, childId, rootTask: ROOT_TASK, childChain: { handoff: true, debate: true, kindsEnabled: false }, providers: { K1: provider() }, ...over });
/** A child that has run, as the parent of the next level: its list as it ran, its registered map, and a block of its own (every criterion classed; the two inherited ones global/delegated as asked). */
function asParent(derived, { node, block, plan, nodeGeneration = 1 }) {
  return { node, generation: nodeGeneration, runId: '2026-10-08T11-10-00-000Z', items: derived.criteria.map((form, i) => ({ id: `C${i + 1}`, form })), obligations: derived.obligationMap, block, blockSha256: sha256Of(canonicalJson(block)), plan };
}

test('the acceptance list of a child: global items, then what it inherits, then its own obligations, each in the FORM of its origin and BYTE-EQUAL to it (strings with ===, objects as canonical JSON); the root-only item never reaches it', () => {
  const p = rootParent();
  const k1 = derive(p, 'K1');
  assert.deepEqual(k1.criteria, [ROOT_CRITERIA[0], ROOT_CRITERIA[1], 'The store keeps every record for 30 days.']);   // C1 global, C2 inherited, then K1's own obligation
  assert.equal(k1.criteria.includes(ROOT_CRITERIA[3]), false, 'C4 is root-only: no child inherits it');
  // byte equality, item by item, with the origin
  for (const [i, origin] of [[0, ROOT_CRITERIA[0]], [1, ROOT_CRITERIA[1]]]) {
    assert.ok(Buffer.from(k1.criteria[i], 'utf8').equals(Buffer.from(origin, 'utf8')), `item ${i} is byte-equal to its origin`);
    assert.equal(JSON.parse(k1.files['criteria.json'])[i], origin);
  }
  const k2 = derive(p, 'K2');                                                          // C1 global, C3 (an OBJECT) inherited
  assert.equal(canonicalJson(k2.criteria[1]), canonicalJson(CHECKABLE), 'an object item is handed in as that object');
  assert.equal(Buffer.compare(Buffer.from(JSON.stringify(k2.criteria[1])), Buffer.from(JSON.stringify(CHECKABLE))), 0, 'and byte-equal as written');
  assert.deepEqual(JSON.parse(k2.files['criteria.json']), k2.criteria, 'criteria.json holds exactly the list');
  // the obligation map records each item's identity (origin node, generation, id, class, text hash) or `refinement`
  assert.deepEqual(k1.obligationMap.items.map(i => [i.id, i.identity?.originNode, i.identity?.originId, i.identity?.originClass, i.refinement ?? null]),
    [['C1', 'R', 'C1', 'global', null], ['C2', 'R', 'C2', 'delegated', null], ['C3', undefined, undefined, undefined, 'R/M1']]);
  assert.equal(k1.obligationMap.items[0].identity.textSha256, sha256Of(ROOT_CRITERIA[0]));
  assert.deepEqual(k1.held, []); assert.equal(k1.startable, true);
});

test('one changed character in the PARENT\'S OWN COPY of an inherited item is `weakened_obligation`: nothing is derived (the identity says what the origin held, the copy must still be it)', () => {
  const root = rootParent();
  const a = asParent(derive(root, 'K1'), { node: 'R/M1', block: validBlockForA(), plan: doc('deliverable.md', planWith(validBlockForA())) });
  assert.doesNotThrow(() => derive(a, 'K3'), 'unchanged copies derive');
  const tampered = clone(a); tampered.items[0].form = tampered.items[0].form.replace('owner', 'owners');                 // ONE character in an inherited string
  assert.throws(() => derive(tampered, 'K3'), e => e instanceof DeriveRefusal && e.code === 'weakened_obligation' && /C1/.test(e.detail));
  const b = asParent(derive(root, 'K2'), { node: 'R/M2', block: validBlockForA(), plan: doc('deliverable.md', planWith(validBlockForA())) });
  assert.doesNotThrow(() => derive(b, 'K3'));
  const checkChanged = clone(b); checkChanged.items[1].form.check = 'grep -c dates plan.md';                            // the check of an inherited object, one character
  assert.throws(() => derive(checkChanged, 'K3'), e => e.code === 'weakened_obligation');
  const spaced = clone(a); spaced.items[1].form = spaced.items[1].form.replace('No ', 'No  ');                          // the same text after oneLine, but not the origin's FORM byte for byte
  assert.throws(() => derive(spaced, 'K3'), e => e.code === 'weakened_obligation', 'a copy that is not the origin\'s form is refused too');
});

test('BUG-B-007: a parent whose chain has criterion kinds OFF holds the origin\'s checkable item as its plain TEXT - that is the origin\'s words, not a reworded copy: the derivation is the same as from the object parent; any other words (a character, a space) are still refused', () => {
  const root = rootParent();
  const b = asParent(derive(root, 'K2'), { node: 'R/M2', block: validBlockForA(), plan: doc('deliverable.md', planWith(validBlockForA())) });
  assert.equal(typeof b.items[1].form, 'object', 'the fixture parent holds the checkable item as an object');
  const plain = clone(b); plain.items[1].form = CHECKABLE.criterion;                                       // what a kinds-off chain\'s report.json holds: criteria as strings, no criteria_kinds
  const viaPlain = derive(plain, 'K3'); const viaObject = derive(b, 'K3');
  assert.deepEqual(viaPlain.criteria, viaObject.criteria); assert.deepEqual(viaPlain.obligationMap, viaObject.obligationMap);
  assert.equal(viaPlain.files['criteria.json'], viaObject.files['criteria.json'], 'the child below inherits the ORIGIN\'s form, never the plain text');
  const changed = clone(b); changed.items[1].form = CHECKABLE.criterion.replace(/.$/, 'X');
  assert.throws(() => derive(changed, 'K3'), e => e.code === 'weakened_obligation');
  const spaced = clone(b); spaced.items[1].form = `${CHECKABLE.criterion} `;
  assert.throws(() => derive(spaced, 'K3'), e => e.code === 'weakened_obligation', 'a plain copy must be the origin\'s criterion text byte for byte');
});

/** A's own block (A is node R/M1 with items C1 (root's C1), C2 (root's C2), C3 (its own refinement)): C1 stays global, the rest as asked. */
function validBlockForA() {
  const b = validBlock();
  b.classes = [{ id: 'C1', class: 'global' }, { id: 'C2', class: 'delegated' }, { id: 'C3', class: 'delegated' }, { id: 'C4', class: 'root-only' }];
  b.children.forEach(k => { k.context_refs = ['root-task: Goal', 'root-task: Non-goals']; });
  return b;
}

/** A's block when A holds two items (the root's global C1 and its own refinement C2): C1 stays global (PLAN 5.3 check 3), C2 is delegated to K1 and K3. */
function twoItemBlock() {
  const b = validBlock();
  b.classes = [{ id: 'C1', class: 'global' }, { id: 'C2', class: 'delegated' }];
  b.children[0].inherits = ['C2']; b.children[1].inherits = []; b.children[2].inherits = ['C2'];
  b.children.forEach(k => { k.context_refs = ['root-task: Goal', 'root-task: Non-goals']; });
  return b;
}
const HANDOFF_ITEM = 'The plan stays consistent with the milestone format of HANDOFF.md';

test('two delegation levels: a root `global` item reaches a GRANDCHILD verbatim through A with its origin recorded; an item a guard refused at A is carried into each of A\'s children as context only, still mandatory, with its identity', () => {
  const root = rootParent({ criteria: [ROOT_CRITERIA[0], HANDOFF_ITEM, ROOT_CRITERIA[2], ROOT_CRITERIA[3]] });   // C2 is the item the guard refuses once handoff is on
  const a = derive(root, 'K1');
  assert.deepEqual(a.criteria, [ROOT_CRITERIA[0], 'The store keeps every record for 30 days.'], 'the refused item is not in A\'s list');
  assert.deepEqual(a.guardRefused.map(g => [g.guard, g.form]), [['infeasibleCriteria', HANDOFF_ITEM]]);
  const aBlock = twoItemBlock();
  const aParent = asParent(a, { node: 'R/M1', block: aBlock, plan: doc('deliverable.md', planWith(aBlock)) });
  for (const id of ['K1', 'K3']) {
    const g = derive(aParent, id);
    assert.equal(g.criteria[0], ROOT_CRITERIA[0], 'the root global item arrives unchanged');
    assert.ok(Buffer.from(g.criteria[0]).equals(Buffer.from(ROOT_CRITERIA[0])));
    assert.deepEqual([g.obligationMap.items[0].identity.originNode, g.obligationMap.items[0].identity.originId, g.obligationMap.items[0].identity.originClass], ['R', 'C1', 'global'], 'with its origin');
    assert.equal(g.criteria.includes(HANDOFF_ITEM), false, 'the refused item stays out of the list');
    assert.equal(g.obligationMap.context.length, 1, 'but is carried');
    const c = g.obligationMap.context[0];
    assert.deepEqual([c.reason, c.guard, c.identity.originNode, c.identity.originId, c.identity.textSha256], ['guard_refused', 'infeasibleCriteria', 'R', 'C2', sha256Of(HANDOFF_ITEM)], 'still mandatory: reason, guard and identity travel with it');
    assert.ok(g.files['context.md'].includes(HANDOFF_ITEM), 'verbatim in context.md');
  }
  // and one hop further it is still there
  const a1 = derive(aParent, 'K1');
  const a1Block = twoItemBlock(); a1Block.classes.push({ id: 'C3', class: 'root-only' });     // A1 holds three items (the root's C1, A's C2 and its own refinement): all three classed, as PLAN 5.3 check 3 requires
  const deeper = derive(asParent(a1, { node: 'R/M1/M1', block: a1Block, plan: doc('deliverable.md', planWith(a1Block)) }), 'K3');
  assert.equal(deeper.obligationMap.context[0].identity.originId, 'C2', 'a context-only obligation never drops out at a later hop');
  assert.ok(deeper.files['context.md'].includes(HANDOFF_ITEM));
});

test('a valid item a guard refuses (infeasibleCriteria with the child chain\'s flags): absent from criteria.json, verbatim in context.md, a guard_refused event per item, the child blocked_criteria_guard; with the flags off the same item is handed in', async () => {
  const root = rootParent({ criteria: [ROOT_CRITERIA[0], HANDOFF_ITEM, ROOT_CRITERIA[2], ROOT_CRITERIA[3]] });
  const d = derive(root, 'K1');
  assert.equal(d.criteria.includes(HANDOFF_ITEM), false); assert.equal(JSON.parse(d.files['criteria.json']).includes(HANDOFF_ITEM), false);
  assert.ok(d.files['context.md'].includes(HANDOFF_ITEM));
  assert.deepEqual(d.held, ['blocked_criteria_guard']);
  assert.deepEqual(infeasibleCriteria([HANDOFF_ITEM], { handoff: true, debate: true }), [HANDOFF_ITEM], 'it really is a guard refusal, not ours');
  assert.deepEqual(derive(root, 'K1', { childChain: { handoff: false, debate: false } }).held, [], 'a child chain with handoff off hands it in');
  assert.ok(derive(root, 'K1', { childChain: { handoff: false, debate: false } }).criteria.includes(HANDOFF_ITEM));
  // a shape item (metaCriteria) is the other guard
  const shape = 'The deliverable is a JSON object with a "criteria" key holding a list of strings';
  const m = derive(rootParent({ criteria: [ROOT_CRITERIA[0], shape, ROOT_CRITERIA[2], ROOT_CRITERIA[3]] }), 'K1');
  assert.deepEqual(m.guardRefused.map(g => g.guard), ['metaCriteria']); assert.deepEqual(m.held, ['blocked_criteria_guard']);
  // one guard_refused event per refused item, written through the record
  const { closedRootTree } = await import('./helpers/tree-fixture.js');
  const { recordGuardRefusals } = await import('../src/tree-derive.js');
  const { readTreeRecord } = await import('../src/tree-record.js');
  const t = closedRootTree();
  const ev = recordGuardRefusals(t.rootDir, d);
  assert.equal(ev.length, 1);
  const rec = readTreeRecord(t.rootDir).events.filter(e => e.event === 'guard_refused');
  assert.deepEqual(rec.map(e => [e.node, e.guard, e.item]), [['R/M1', 'infeasibleCriteria', HANDOFF_ITEM]]);
});

test('why the item must not be handed in: runChain with it as a handed-in criterion stops before any paid round; and the DERIVED list passes a real start (the guards run there, --dry-run exits before them)', async () => {
  const mock = JSON.parse(readFileSync(join(process.cwd(), 'chains', 'mock-debate.json'), 'utf8'));
  await assert.rejects(runChain({ request: 'x', config: { ...mock, criteria: [HANDOFF_ITEM, 'It names an owner.'] }, log: () => {} }), /Stopped before any paid review round/);
  const d = derive(rootParent({ criteria: [ROOT_CRITERIA[0], HANDOFF_ITEM, ROOT_CRITERIA[2], ROOT_CRITERIA[3]] }), 'K1');
  const r = await runChain({ request: 'Plan the storage layer.', config: { ...mock, criteria: d.criteria }, log: () => {} });
  assert.deepEqual(r.criteria, d.criteria.map(c => (typeof c === 'string' ? c : c.criterion)), 'the derived list is handed in and passes both guards at the start');
});

test('a check the child chain will not enforce is not dropped silently: kinds off => the check text is in context.md, the obligation map marks it check_not_enforced, the child is held; kinds on => handed in as the object and not held', () => {
  const root = rootParent();
  const off = derive(root, 'K2');                                    // K2 inherits C3, the checkable object
  assert.deepEqual(off.held, ['check_not_enforced']);
  assert.equal(off.obligationMap.items.find(i => i.checkNotEnforced).identity.originId, 'C3');
  assert.ok(off.files['context.md'].includes(`Check (plan): ${CHECKABLE.check}`), 'the check text is in context.md');
  assert.equal(canonicalJson(off.criteria[1]), canonicalJson(CHECKABLE), 'and the item itself is still handed in, as the object');
  const on = derive(root, 'K2', { childChain: { handoff: true, debate: true, kindsEnabled: true } });
  assert.deepEqual(on.held, []); assert.equal(on.obligationMap.items.some(i => i.checkNotEnforced), false);
  assert.equal(canonicalJson(on.criteria[1]), canonicalJson(CHECKABLE));
});

test('context.md holds the seven parts of PLAN 6.4 in order, each copied section whole, byte for byte, with a label naming its source file, heading and the file\'s sha256; part 2 holds the root-task refs and part 4 only the parent-plan refs', async () => {
  const root = rootParent();
  const d = derive(root, 'K1');
  const c = d.files['context.md'];
  const at = [1, 2, 3, 4, 5, 6, 7].map(n => c.indexOf(`## ${n}. `));
  assert.ok(at.every(i => i >= 0) && at.every((v, i) => i === 0 || v > at[i - 1]), `seven parts in order: ${at}`);
  const goal = sectionOf(ROOT_TASK.text, 'Goal').section; const nongoals = sectionOf(ROOT_TASK.text, 'Non-goals').section;
  assert.equal(goal, '# Goal\nBuild a small reading-list app.\n\n', 'a section is the exact bytes from its heading to the next heading of the same or a higher level');
  for (const [heading, text] of [['Goal', goal], ['Non-goals', nongoals]]) {
    assert.ok(c.includes(`----- root task task.md (sha256 ${ROOT_TASK.sha256}), heading "${heading}" -----\n${text}----- end -----`), `${heading}: labelled and verbatim`);
    assert.ok(c.indexOf(text) > at[1] && c.indexOf(text) < at[2], `${heading} sits in part 2`);
  }
  const overview = sectionOf(root.plan.text, 'Overview').section;
  assert.ok(c.includes(`heading "Overview" -----\n${overview}----- end -----`) && c.indexOf(overview) > at[3] && c.indexOf(overview) < at[4], 'the parent-plan ref sits in part 4');
  assert.equal(c.split(goal).length - 1, 1, 'no section is copied twice');
  assert.ok(c.includes('1. The child\'s entry in the signed split') && c.includes('Scope: Choose and build the record store.') && c.includes('Open question: Which store holds the records?'), 'part 1 quotes the entry');
  // EDITED (Muad's yes, 11 Oct 2026, "Yes to all three"; old: assert.ok(c.includes(`C2. ${ROOT_CRITERIA[1]}`), 'part 5 lists the parent\'s locked criteria with their ids')): the parent's criteria are PC<n>, never C<n>, so a child cannot mistake them for its own
  assert.ok(c.includes(`PC2. ${ROOT_CRITERIA[1]} (this is your C2)`), 'part 5 lists the parent\'s locked criteria as PC<n>, with the cross-reference');
  assert.equal(/^C\d+\. /m.test(c.slice(c.indexOf('## 5. '), c.indexOf('## 6. '))), false, 'no line of part 5 starts with a C-number');
  assert.match(c, /## 7\. [^\n]*\n\n\(none: this is the first generation\)/);
  const g2 = derive(root, 'K1', { generation: 2, openedBy: [{ id: 'e41', text: 'Decision: the store is SQLite.' }] }).files['context.md'];
  assert.ok(g2.includes('----- decision e41 -----\nDecision: the store is SQLite.\n----- end -----'), 'generation 2: the decision that opened it, verbatim');
  // task.md is quoted data only (the instruction is a held word)
  // CHANGED ACCEPTED TEST (decider-readiness apply patch, 24 Okt 2026; C&C ruling (b)). OLD: task.md was the quoted data only, because the instruction was a held word. NEW: the recorded instruction follows the data (the exact bytes the door test below pins: data, a newline, the instruction, a newline). WHY: treeChildTaskInstruction is recorded in src/roles.js.
  const { treeChildTaskInstruction } = await import('../src/roles.js');
  assert.equal(d.files['task.md'], `Milestone: M1\nScope: Choose and build the record store.\nOpen question: Which store holds the records?\n\n${treeChildTaskInstruction()}\n`);
});

test('missing_context: a ref with no source document, a heading not exactly once, no root-task ref, an exclusions section not named, a root task without headings that is still referred to; a root task WITHOUT headings goes in whole', () => {
  const root = rootParent();
  const refuse = (refs, p = root, over = {}) => assert.throws(() => derive((() => { const q = clone(p); q.block.children[0].context_refs = refs; return q; })(), 'K1', over), e => e instanceof DeriveRefusal && e.code === 'missing_context', JSON.stringify(refs));
  refuse(['Goal', 'root-task: Non-goals']);                                                  // no source document
  refuse(['root-task: Goal', 'root-task: Non-goals', 'elsewhere: Overview']);                // an unknown source
  refuse(['root-task: Goal', 'root-task: Non-goals', 'parent-plan: No such heading']);       // zero
  refuse(['root-task: Goal', 'root-task: Non-goals', 'root-task: Nowhere']);
  refuse(['parent-plan: Overview']);                                                         // the child's refs omit the root goal altogether
  refuse(['root-task: Goal']);                                                               // the root task has a Non-goals section and the refs do not name it
  const dup = { ...ROOT_TASK, ...doc('task.md', '# Goal\nOne.\n\n# Goal\nTwo.\n\n# Non-goals\nNone.\n') };
  assert.throws(() => derive(root, 'K1', { rootTask: dup }), e => e.code === 'missing_context' && /found 2/.test(e.detail), 'a heading twice is not addressable');
  // a root task without any heading goes in whole and verbatim; naming a heading of it then names nothing
  const bare = doc('task.md', 'Just a paragraph of plain text,\nwith no headings at all.\n');
  const p2 = clone(root); p2.block.children[0].context_refs = ['parent-plan: Overview'];
  const d = derive(p2, 'K1', { rootTask: bare });
  assert.ok(d.files['context.md'].includes(`----- root task task.md (sha256 ${bare.sha256}), the whole file: it has no addressable headings -----\n${bare.text}----- end -----`));
  const p3 = clone(root); p3.block.children[0].context_refs = ['root-task: Goal'];
  assert.throws(() => derive(p3, 'K1', { rootTask: bare }), e => e.code === 'missing_context');
  // the exclusion headings are whole and case-insensitive; a different heading does not count as the exclusions section
  const ooo = doc('task.md', '# Goal\nG.\n\n# OUT OF SCOPE\nX.\n');
  const p4 = clone(root); p4.block.children[0].context_refs = ['root-task: Goal'];
  assert.throws(() => derive(p4, 'K1', { rootTask: ooo }), e => e.code === 'missing_context' && /OUT OF SCOPE/.test(e.detail));
  const p5 = clone(root); p5.block.children[0].context_refs = ['root-task: Goal'];
  assert.doesNotThrow(() => derive(p5, 'K1', { rootTask: doc('task.md', '# Goal\nG.\n\n# Out of scope reading\nX.\n') }), '"Out of scope reading" is not an exclusions heading');
});

test('a provider\'s answer: the sections its agreements name (provider_refs), labelled with node, generation, run id and pin; a missing heading, an unpinned provider, a re-pinned one and a missing provider are each missing_context', () => {
  const root = rootParent();
  const d = derive(root, 'K2');
  const c = d.files['context.md'];
  const p = provider();
  const sec = sectionOf(p.plan.text, 'Overview').section;
  assert.ok(c.includes(`----- provider R/M1 generation 1, run ${p.runId}, thin contract ${p.thinContractSha256}, deliverable.md (sha256 ${p.plan.sha256}), heading "Overview" -----\n${sec}----- end -----`), 'labelled with node, generation, run id, pin, file, sha256 and heading, and verbatim');
  assert.deepEqual(d.dependsOn, [{ node: 'R/M1', generation: 1, thinContractSha256: p.thinContractSha256 }], 'the pin is what the registration records (dependsOn)');
  const refuse = prov => assert.throws(() => derive(root, 'K2', { providers: { K1: prov } }), e => e instanceof DeriveRefusal && e.code === 'missing_context');
  refuse(provider({ plan: doc('deliverable.md', '# Plan\n\n## Something else\nx\n') }));       // the provider_refs heading is missing from the provider's plan
  refuse(provider({ pin: sha256Of('another contract') }));                                    // re-pinned
  refuse(provider({ pin: null }));                                                            // never pinned
  refuse(provider({ thinContractSha256: null }));                                             // unreadable
  assert.throws(() => derive(root, 'K2', { providers: {} }), e => e.code === 'missing_context');
});

test('the CHILD\'S OWN node path, generation, attempt and run id appear in neither task.md nor context.md (they live in lineage); the provider\'s labels are the only node paths there', () => {
  const root = rootParent();
  for (const id of ['K1', 'K2', 'K3']) {
    const d = derive(root, id);
    for (const f of ['task.md', 'context.md']) {
      const text = d.files[f];
      assert.equal(text.includes(d.node), false, `${f} of ${d.node} does not contain its own node path`);
      assert.equal(/@g\d/.test(text), false, `${f}: no node@generation`);
      assert.equal(/\ba\d\b/.test(text.replace(/[0-9a-f]{64}/g, '')), false, `${f}: no attempt id`);
    }
  }
  assert.ok(derive(root, 'K2').files['context.md'].includes('provider R/M1 generation 1'), 'the provider is named, as PLAN 6.4 item 3 requires');
});

test('the bundle: the hash covers task.md, criteria.json and context.md and NOT node.json (which carries it); node.json holds the lineage with that hash; derivation is deterministic; the write is atomic, idempotent and never over a different bundle', () => {
  const root = rootParent();
  const one = derive(root, 'K1'); const two = derive(clone(root), 'K1');
  assert.deepEqual(one.files, two.files, 'the same inputs give byte-identical files');
  assert.equal(JSON.parse(one.files['node.json']).bundleSha256, one.bundleSha256);
  assert.deepEqual(Object.keys(JSON.parse(one.files['node.json'])), ['treeId', 'node', 'generation', 'attempt', 'parentNode', 'depth', 'splitSha256', 'bundleSha256']);
  assert.deepEqual([JSON.parse(one.files['node.json']).node, JSON.parse(one.files['node.json']).attempt, JSON.parse(one.files['node.json']).depth, JSON.parse(one.files['node.json']).splitSha256], ['R/M1', 1, 1, root.blockSha256]);
  const dirs = [0, 1].map(() => newTree().rootDir);                       // a real tree record (M5f (a), ruled: a bundle always sits beside tree.json + events.jsonl; writeBundle refuses to move or rewrite one without)
  const written = dirs.map(rootDir => writeBundle(rootDir, one));
  assert.deepEqual(written.map(w => w.written), [true, true]);
  for (const f of Object.keys(one.files)) assert.ok(readFileSync(join(written[0].dir, f)).equals(readFileSync(join(written[1].dir, f))), `${f}: byte-identical in two trees`);
  assert.equal(bundleSha256Of(written[0].dir), one.bundleSha256, 'the folder hashes to the recorded value');
  assert.deepEqual(readdirSync(join(dirs[0], 'tree', 'inputs')), [bundleDirName('R/M1', 1)], 'no temp folder is left');
  // three-way: node.json is not part of the hash; each of the other three is
  const base = bundleSha256Of(written[0].dir);
  writeFileSync(join(written[0].dir, 'node.json'), `${one.files['node.json']} `);
  assert.equal(bundleSha256Of(written[0].dir), base, 'editing node.json leaves the hash unchanged');
  for (const f of ['task.md', 'criteria.json', 'context.md']) {
    const before = readFileSync(join(written[0].dir, f), 'utf8');
    writeFileSync(join(written[0].dir, f), `${before}x`);
    assert.notEqual(bundleSha256Of(written[0].dir), base, `editing ${f} changes it`);
    writeFileSync(join(written[0].dir, f), before);
  }
  assert.equal(bundleHashOfFiles(one.files), one.bundleSha256, 'one implementation for the folder and the files');
  // idempotent; a different bundle of a node that is NOT registered is moved aside, never deleted (M5f (b), the maintainer's ruling: the first sitting's rule "never overwritten" now means "never destroyed");
  // the registered-node refusal and the end-to-end path are tested in test/tree-bundle-replace.test.js
  assert.equal(writeBundle(dirs[1], one).written, false);
  const changed = { ...one, files: { ...one.files, 'task.md': 'Milestone: M1\nchanged\n' } };
  assert.equal(writeBundle(dirs[1], changed).written, true);
  const inputs = join(dirs[1], 'tree', 'inputs'); const name = bundleDirName('R/M1', 1);
  assert.equal(readFileSync(join(inputs, name, 'task.md'), 'utf8'), 'Milestone: M1\nchanged\n');
  assert.equal(readFileSync(join(inputs, `${name}.replaced-1`, 'task.md'), 'utf8'), one.files['task.md'], 'the old bundle is kept, untouched');
});

test('hostile node paths cannot make a bundle land outside tree/inputs/: `..`, `.x`, a backslash, an absolute path, an empty segment, a drive letter and a trailing slash are all refused before anything is written; a symlinked tree/inputs is refused', () => {
  const rootDir = join(mkdtempSync(join(tmpdir(), 'thc-hostile-')), 'runs', ROOT_ID); mkdirSync(join(rootDir, 'tree'), { recursive: true });
  const outside = mkdtempSync(join(tmpdir(), 'thc-outside-'));
  const files = { 'task.md': 'x\n', 'criteria.json': '[]\n', 'context.md': 'x\n', 'node.json': '{}\n' };
  for (const node of ['R/..', 'R/../..', 'R/.x', 'R\\M1', '/etc/passwd', 'R//M1', 'C:/x', 'R/M1/', '../x', '', 'R/M1/..']) {
    assert.throws(() => writeBundle(rootDir, { node, generation: 1, files }), TypeError, JSON.stringify(node));
    assert.throws(() => bundleDirName(node, 1), TypeError);
  }
  assert.throws(() => bundleDirName('R/M1', 0), TypeError); assert.throws(() => bundleDirName('R/M1', 1.5), TypeError);
  assert.equal(existsSync(join(rootDir, 'tree', 'inputs')), false, 'nothing was created for a hostile path');
  const ok = writeBundle(rootDir, { node: 'R/M1', generation: 1, files });
  assert.ok(realpathSync(ok.dir).startsWith(`${realpathSync(join(rootDir, 'tree', 'inputs'))}/`), 'a real node path lands under tree/inputs/');
  // tree/inputs as a symlink to a folder outside
  const other = join(mkdtempSync(join(tmpdir(), 'thc-hostile2-')), 'runs', ROOT_ID); mkdirSync(join(other, 'tree'), { recursive: true });
  symlinkSync(outside, join(other, 'tree', 'inputs'));
  assert.throws(() => writeBundle(other, { node: 'R/M1', generation: 1, files }), /symbolic link/);
  assert.deepEqual(readdirSync(outside), [], 'nothing was written through the link');
  assert.equal(lstatSync(join(other, 'tree', 'inputs')).isSymbolicLink(), true);
});

test('the guards are the chain\'s own: whatever criteria.json holds passes metaCriteria (shape only) and infeasibleCriteria with the child chain\'s flags, for every child of the fixture', () => {
  const root = rootParent({ criteria: [ROOT_CRITERIA[0], HANDOFF_ITEM, ROOT_CRITERIA[2], ROOT_CRITERIA[3]] });
  for (const id of ['K1', 'K2', 'K3']) {
    const texts = derive(root, id).criteria.map(c => (typeof c === 'string' ? c : c.criterion));
    assert.deepEqual(metaCriteria(texts, { shapeOnly: true }), []); assert.deepEqual(infeasibleCriteria(texts, { handoff: true, debate: true }), []);
  }
});

test('sectionOf: a heading inside a code fence is not a heading; a lower-level heading stays inside its section; CRLF is kept byte for byte', () => {
  const text = '# A\none\n## A1\nsub\n# B\ntwo\n```\n# Fenced\n```\n';
  assert.equal(sectionOf(text, 'A').section, '# A\none\n## A1\nsub\n');
  assert.equal(sectionOf(text, 'A1').section, '## A1\nsub\n');
  assert.equal(sectionOf(text, 'B').section, '# B\ntwo\n```\n# Fenced\n```\n');
  assert.equal(sectionOf(text, 'Fenced').count, 0);
  assert.equal(sectionOf('# A\r\nline\r\n# B\r\n', 'A').section, '# A\r\nline\r\n');
});

// ================================================================================================================================================================ part 2: real $0 mock runs, the record, real starts
import { spawnSync } from 'node:child_process';
import * as api from '../src/api.js';
import { loadDerivation, formsOfReport, readNodePlan } from '../src/tree-derive-load.js';
import { recordDerivationRefusal } from '../src/tree-derive.js';
import { EVENTS_FILE, TreeRefusal, appendTreeEvent, readTreeRecord, stateOf, treeDirOf } from '../src/tree-record.js';
import { registerChildUnchecked, registerRoot } from '../src/tree-register.js';
import { verifySplit } from '../src/tree-expansion.js';
import { GATE_FIELDS, IDS, approveFrontier, claim, cli, hostnameOf, lineageFile, newTree, rootOpts, root as REPO } from './helpers/tree-fixture.js';

const ids = ['2026-10-08T11-10-00-000Z', '2026-10-08T11-11-00-000Z', '2026-10-08T11-12-00-000Z', '2026-10-08T11-13-00-000Z'];
/** The tree's root run on a plan of our own (the shared block with the prefixed refs), run to the end through the library; the tree is verified (split_verified). */
async function realRoot({ childChain = 'mock-debate', plan = planWith(block3(), { preface: 'REVISED MOCK DELIVERABLE\n\n' }), cap = 100 } = {}) {
  const t = newTree({ cap, childChain });
  registerRoot(t.rootDir);
  writeFileSync(join(t.work, 'plan.md'), plan);
  const res = await api.run(rootOpts(t));
  assert.equal(res.exitCode, 0, res.outputTail);
  const runDir = join(t.runsDir, ROOT_ID);
  const v = verifySplit(t.rootDir, { node: 'R', generation: 1, runId: ROOT_ID, runDir, work: t.work, inheritedGlobal: [], ancestorQuestions: [] });
  assert.equal(v.refusal, null, v.refusal && JSON.stringify(v.refusal));
  return { t, runDir, split: v.sha256, rootTaskPath: join(t.work, 'tasks', 'x.md') };
}
const load = (r, childId = 'K1', over = {}) => loadDerivation({ rootDir: r.t.rootDir, parentRef: { node: 'R', generation: 1 }, childId, rootTaskPath: r.rootTaskPath, work: r.t.work, ...over });
const events = rootDir => readTreeRecord(rootDir).events;

test('real run: the loader reads the root\'s report, verified block and plan; a child derived from it is written, registered with its bundle hash and STARTED through the real CLI: run.json carries the bundle hash, the report keeps the derived list, the files hold none of its own ids', async () => {
  const r = await realRoot();
  const args = load(r, 'K1');
  assert.equal(args.parent.obligations, null, 'the root holds its own locked list');
  assert.deepEqual(args.parent.items.map(i => i.id), ['C1', 'C2', 'C3']);
  assert.equal(args.parent.blockSha256, r.split);
  assert.deepEqual([args.childChain.handoff, args.childChain.debate, args.childChain.kindsEnabled], [true, true, false], 'the flags of the registered child chain');
  const d = deriveChild(args);
  assert.deepEqual(d.held, []); assert.equal(d.startable, true);
  const bundle = writeBundle(r.t.rootDir, d);
  assert.equal(bundleSha256Of(bundle.dir), d.bundleSha256);
  const key = approveFrontier(r.t.rootDir, ['R/M1', 'R/M2', 'R/M3'], { split: r.split });
  registerChildUnchecked(r.t.rootDir, { frontierKey: key, node: d.node, generation: 1, runId: ids[0], parentRunId: ROOT_ID, chain: { name: args.childChain.name, sha256: r.t.shaIn(args.childChain.name) }, grant: { amount: 20, unit: 'usd' }, bundleSha256: d.bundleSha256, obligations: d.obligationMap, dependsOn: d.dependsOn, splitSha256: r.split });
  const res = await api.run({ chain: args.childChain.name, task: join(bundle.dir, 'task.md'), criteria: join(bundle.dir, 'criteria.json'), context: join(bundle.dir, 'context.md'), cwd: r.t.work, runId: ids[0], treeNode: join(bundle.dir, 'node.json') });
  assert.equal(res.exitCode, 0, res.outputTail);
  const childRun = join(r.t.runsDir, ids[0]);
  const runJson = JSON.parse(readFileSync(join(childRun, 'run.json'), 'utf8'));
  assert.equal(runJson.tree.bundleSha256, d.bundleSha256, 'the bundle hash lands in the child\'s run.json');
  assert.equal(runJson.tree.splitSha256, r.split); assert.equal(runJson.tree.node, 'R/M1');
  const report = JSON.parse(readFileSync(join(childRun, 'report.json'), 'utf8'));
  assert.deepEqual(report.criteria, d.criteria, 'the derived list is what the child ran with, byte for byte');
  // the lint finding on a derived list is NOT a stop and does not pass silently: the child started (exit 0), the finding is in its report.json criteria_lints, and the derivation returned it for the stop
  assert.deepEqual(d.lints.map(l => l.id), ['no-consistency']);
  assert.deepEqual(report.criteria_lints.map(l => l.id), ['no-consistency'], 'the same finding, recorded by the run');
  assert.equal(stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M1@g1').phase, 'closed');
  // the member's end hook pinned the run's thin contract on node_closed (a consumer's derivation compares the report with it)
  const closed = events(r.t.rootDir).filter(e => e.event === 'node_closed');
  assert.deepEqual(closed.map(e => e.node), ['R', 'R/M1']);
  assert.equal(closed[1].thinContractSha256, report.thin_contract.sha256, 'the child\'s pin is its report\'s thin-contract hash');
  assert.equal(closed[0].thinContractSha256, JSON.parse(readFileSync(join(r.runDir, 'report.json'), 'utf8')).thin_contract.sha256, 'and the root\'s');
  assert.equal(bundleSha256Of(bundle.dir), d.bundleSha256, 'and the bundle was not touched by the run');
  // the continuation checks of M2 still hold with the real bundle (a re-derivation is byte-identical)
  assert.deepEqual(deriveChild(load(r, 'K1')).files, d.files);
});

test('`node src/cli.js lint-criteria --criteria <derived criteria.json>` exits 0 or 1 (never 2) on a derived list; its output is the plan\'s recorded cross-check', async () => {
  const r = await realRoot();
  const d = deriveChild(load(r, 'K1'));
  const bundle = writeBundle(r.t.rootDir, d);
  const out = spawnSync(process.execPath, [cli, 'lint-criteria', '--criteria', join(bundle.dir, 'criteria.json')], { cwd: r.t.work, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: r.t.work } });
  assert.ok(out.status === 0 || out.status === 1, `exit ${out.status}: ${out.stderr}`);
  console.log(`# lint-criteria on the derived list: exit ${out.status}: ${out.stdout.trim().replace(/\n/g, ' | ')}`);
});

test('a kinds-enabled child chain keeps a handed-in check in report.json criteria_kinds; a chain without kinds does not (which is exactly why the item is held as check_not_enforced)', () => {
  const root = rootParent();
  const on = derive(root, 'K2', { childChain: { handoff: true, debate: true, kindsEnabled: true } });
  const dir = mkdtempSync(join(tmpdir(), 'thc-kinds-')); mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 'x.md'), 'Plan the web layer.\n');
  writeFileSync(join(dir, 'criteria.json'), on.files['criteria.json']);
  const go = chain => spawnSync(process.execPath, [cli, '--chain', chain, '--task', 'tasks/x.md', '--criteria', 'criteria.json', '--run-id', `2026-10-08T12-0${chain === 'mock-criteria-kinds' ? 0 : 1}-00-000Z`], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 120_000 });
  const a = go('mock-criteria-kinds'); assert.equal(a.status, 0, a.stdout + a.stderr);
  const ra = JSON.parse(readFileSync(join(dir, 'runs', '2026-10-08T12-00-00-000Z', 'report.json'), 'utf8'));
  assert.deepEqual(ra.criteria, on.criteria.map(itemTextOf));
  assert.deepEqual(ra.criteria_kinds[1], { criterion: CHECKABLE.criterion, kind: 'checkable', check: CHECKABLE.check, on: 'plan' }, 'the check survives in report.json');
  const b = go('mock-debate'); assert.equal(b.status, 0, b.stdout + b.stderr);
  const rb = JSON.parse(readFileSync(join(dir, 'runs', '2026-10-08T12-01-00-000Z', 'report.json'), 'utf8'));
  assert.equal(rb.criteria_kinds, undefined, 'a chain with kinds off records no check: the harness cannot enforce it');
});
const itemTextOf = c => (typeof c === 'string' ? c : c.criterion);

test('a refused derivation (`weakened_obligation`, `missing_context`) is a blocked record in the closed list (reason expansion_refused, the code as the check), and writes no bundle and no run folder', async () => {
  const r = await realRoot();
  const runsBefore = readdirSync(r.t.runsDir);
  const args = load(r, 'K1');
  args.parent.block.children[0].context_refs = ['parent-plan: No such heading'];
  let refusal;
  try { deriveChild(args); } catch (e) { refusal = e; }
  assert.ok(refusal instanceof DeriveRefusal && refusal.code === 'missing_context');
  const ev = recordDerivationRefusal(r.t.rootDir, { node: 'R/M1', generation: 1 }, refusal);
  assert.deepEqual([ev.event, ev.reason, ev.check, ev.scope], ['blocked', 'expansion_refused', 'missing_context', 'R/M1@g1']);
  assert.equal(stateOf(readTreeRecord(r.t.rootDir)).sticky.size, 0, 'no new sticky state');
  assert.deepEqual(readdirSync(r.t.runsDir), runsBefore, 'no run folder');
  assert.equal(existsSync(join(r.t.rootDir, 'tree', 'inputs')), false, 'no bundle');
});

test('task.md is quoted data only while the instruction is held; with the drafted instruction injected (held()) it follows the data and nothing else changes', async () => {
  const { setHeldForTest } = await import('../src/held-roles.js');
  setHeldForTest(HELD_OFF);   // CHANGED ACCEPTED TEST (decider-readiness unit, 24 Okt 2026): OLD no override = the instruction is held; NEW the explicit off map, so `plain` is the shipped-without-the-words derivation once roles.js records it
  const H = await import('./held-prompts/held-083.js');
  const root = rootParent();
  const plain = derive(root, 'K1');
  assert.equal(plain.files['task.md'].includes('Plan this milestone'), false, 'nothing about what to do is in the file while the words are held');
  setHeldForTest({ treeChildTaskInstruction: H.treeChildTaskInstruction });
  try {
    const withWords = derive(root, 'K1');
    assert.equal(withWords.files['task.md'], `${plain.files['task.md']}\n${H.treeChildTaskInstruction()}\n`);
    assert.equal(withWords.files['context.md'], plain.files['context.md'], 'the context does not change'); assert.equal(withWords.files['criteria.json'], plain.files['criteria.json']);
    assert.notEqual(withWords.bundleSha256, plain.bundleSha256, 'the bundle hash covers task.md');
    assert.match(H.treeChildTaskInstruction(), /binding as written/); assert.equal(/\b(better|best|improve|quality|accurate)/i.test(H.treeChildTaskInstruction()), false);
  } finally { setHeldForTest(null); }
});

/**
 * The provider scenario of PLAN 14 M4: root R splits into K1 (R/M1, the provider A) and K2 (R/M2, the consumer B; B expects A1 from K1). A delegated the interface to its child A1 (R/M1/M1), whose plan settles it in the
 * `basis` of a ready milestone; a person resolved a needs-decision milestone in A's subtree (a decision text, linked by decisionId). Every plan is a real $0 mock run; A and A1 are registered and closed with their pins.
 */
async function providerTree({ link = true } = {}) {
  const r = await realRoot({ plan: planWith((() => { const b = block3(); return b; })(), { preface: 'REVISED MOCK DELIVERABLE\n\n' }) });
  const t = r.t;
  const planA = planWith(validBlock(), { preface: 'REVISED MOCK DELIVERABLE\n\n' }).replace('A plan.', 'A settles the store interface: get(id) and put(record).');
  const planA1 = planWith(validBlock(), { preface: 'REVISED MOCK DELIVERABLE\n\n' }).replace('Ship behind a flag.', 'A1 ships the store behind a flag and rolls back by restoring the snapshot.');
  writeFileSync(join(t.work, 'planA.md'), planA); writeFileSync(join(t.work, 'planA1.md'), planA1);
  const key = approveFrontier(t.rootDir, ['R/M1', 'R/M2', 'R/M1/M1'], { split: r.split });
  const run = async (runId, draft) => { const res = await api.run({ chain: 'split-root', task: 'tasks/x.md', cwd: t.work, runId, draft, rounds: 1 }); assert.equal(res.exitCode, 0, res.outputTail); };
  const pinOf = runId => JSON.parse(readFileSync(join(t.runsDir, runId, 'report.json'), 'utf8')).thin_contract.sha256;
  const ranNode = async (node, runId, parentRunId, draft) => {
    await run(runId, draft);
    registerChildUnchecked(t.rootDir, { frontierKey: key, node, generation: 1, runId, parentRunId, chain: { name: t.childChain, sha256: t.shaIn(t.childChain) }, grant: { amount: 1, unit: 'usd' } });
    appendTreeEvent(t.rootDir, { event: 'node_started', ...claim(node, runId, process.pid, 1, hostnameOf()) });
    appendTreeEvent(t.rootDir, { event: 'node_closed', node, generation: 1, runId, outcome: 'passed', passed: true, status: 'ready_for_build', share: 'released', thinContractSha256: pinOf(runId) });
  };
  await ranNode('R/M1', ids[0], ROOT_ID, 'planA.md');
  await ranNode('R/M1/M1', ids[1], ids[0], 'planA1.md');
  const stop = appendTreeEvent(t.rootDir, { event: 'needs_decision_opened', source: 'integration', node: 'R/M1', generation: 1 });
  const d = appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: 'Decision: the record store is SQLite, one file per tree.', affected: [], form: 'milestone', stopId: stop.id, node: 'R/M1', generation: 1, milestone: 'M5', ...GATE_FIELDS });
  appendTreeEvent(t.rootDir, { event: 'milestone_resolved', node: 'R/M1', generation: 1, milestone: 'M5', decisionId: d.id, changesProvides: false });
  if (!link) {                                                                                  // a record written before the M5d rule: the line is edited in the file (appendTreeEvent now refuses a resolution that names no decision text)
    assert.throws(() => appendTreeEvent(t.rootDir, { event: 'milestone_resolved', node: 'R/M1', generation: 1, milestone: 'M5', decisionId: 'e999', changesProvides: false }), e => e instanceof TreeRefusal);
    const f = join(treeDirOf(t.rootDir), EVENTS_FILE); writeFileSync(f, readFileSync(f, 'utf8').replace(`"decisionId":"${d.id}"`, '"decisionId":"e999"'));
  }
  return { ...r, planA, planA1, pinOf, decisionId: d.id };
}

test('the provider\'s whole subtree: consumer B\'s context.md holds A\'s provider_refs section, A1\'s settling section (the basis of its ready milestone) and the recorded resolution, each verbatim with node, generation, run id and pin, in node-path order; a re-pinned or unreadable A1, or a resolution with no decision, refuses B\'s derivation with missing_context', async () => {
  const r = await providerTree();
  const d = deriveChild(load(r, 'K2'));
  const c = d.files['context.md'];
  const part3 = c.slice(c.indexOf('## 3. '), c.indexOf('## 4. '));
  const aSection = sectionOf(r.planA, 'Overview').section; const a1Section = sectionOf(r.planA1, 'Release and rollback plan').section;
  assert.ok(aSection.includes('A settles the store interface') && a1Section.includes('A1 ships the store behind a flag'));
  const aLabel = `----- provider R/M1 generation 1, run ${ids[0]}, thin contract ${r.pinOf(ids[0])}, deliverable.md`;
  const a1Label = `----- provider R/M1/M1 generation 1, run ${ids[1]}, thin contract ${r.pinOf(ids[1])}, deliverable.md`;
  const at = [part3.indexOf(aLabel), part3.indexOf(a1Label), part3.indexOf('----- recorded resolution of milestone M5 in R/M1 generation 1')];
  assert.ok(at.every(i => i >= 0) && at[0] < at[1] && at[1] < at[2], `a, b, c in order: ${at}`);
  assert.ok(part3.includes(`heading "Overview" -----\n${aSection}----- end -----`), 'A\'s section, byte for byte');
  assert.ok(part3.includes(`heading "Release and rollback plan" (basis of its ready milestone M4) -----\n${a1Section}----- end -----`), 'A1\'s settling section, byte for byte');
  assert.ok(part3.includes(`(decision ${r.decisionId}) -----\nDecision: the record store is SQLite, one file per tree.\n----- end -----`), 'the resolution, verbatim');
  // 0.8.3 M5c2 (EDITED, found by the real depth-2 test in test/tree-run.test.js): PLAN 4.4/8.1 say dependsOn lists EVERY node of the provider's subtree with its generation and pin; this assertion had pinned the provider only
  assert.deepEqual(d.dependsOn, [{ node: 'R/M1', generation: 1, thinContractSha256: r.pinOf(ids[0]) }, { node: 'R/M1/M1', generation: 1, thinContractSha256: r.pinOf(ids[1]) }]);
  assert.equal(part3.includes('R/M2'), false, 'the consumer\'s own node path is not in its context');
  // re-pinned: A1's report no longer says what it said when it closed
  const reportPath = join(r.t.runsDir, ids[1], 'report.json');
  const original = readFileSync(reportPath, 'utf8');
  const rep = JSON.parse(original); rep.thin_contract.sha256 = sha256Of('re-sealed'); writeFileSync(reportPath, JSON.stringify(rep));
  assert.throws(() => deriveChild(load(r, 'K2')), e => e instanceof DeriveRefusal && e.code === 'missing_context' && /R\/M1\/M1/.test(e.detail) && /pinned/.test(e.detail));
  writeFileSync(reportPath, original);
  assert.doesNotThrow(() => deriveChild(load(r, 'K2')), 'restored: derives again');
  // unreadable: A1's plan is not the file the run wrote
  const delivPath = join(r.t.runsDir, ids[1], 'deliverable.md'); const deliv = readFileSync(delivPath, 'utf8');
  writeFileSync(delivPath, 'garbage');
  assert.throws(() => deriveChild(load(r, 'K2')), e => e.code === 'missing_context' && /cannot be read/.test(e.detail));
  writeFileSync(delivPath, deliv);
  // a resolution that names no decision text (a fresh scenario: the bad event would stay in this record)
  const linkless = await providerTree({ link: false });
  assert.throws(() => load(linkless, 'K2'), e => e instanceof DeriveRefusal && e.code === 'missing_context' && /e999/.test(e.detail), 'a milestone_resolved whose decisionId names no decision text cannot be copied verbatim');
});

test('generation 2: the loader hands the decision that opened the generation, verbatim, to part 7 of context.md; a generation_opened whose decision has no text is missing_context', async () => {
  const r = await realRoot();
  const key = approveFrontier(r.t.rootDir, ['R/M1', 'R/M2', 'R/M3'], { split: r.split });
  void key;
  const stop = appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', source: 'integration', affected: [{ node: 'R/M1', generation: 1 }] }); // EDITED in the M7 apply (C2a-record commit 2; old: a stop with no `affected`; why: the table now binds a regenerate's list to the stop's recorded set, so the stop records the node the decision lists)
  const dec = appendTreeEvent(r.t.rootDir, { event: 'decision_recorded', text: 'Decision: start the storage plan again with SQLite fixed.', affected: [{ node: 'R/M1', generation: 1 }], form: 'regenerate', stopId: stop.id, ...GATE_FIELDS });
  appendTreeEvent(r.t.rootDir, { event: 'generation_opened', decisionId: dec.id, nodes: [{ node: 'R/M1', generation: 2 }] });
  const g2 = deriveChild(load(r, 'K1', { generation: 2 }));
  assert.ok(g2.files['context.md'].includes(`----- decision ${dec.id} -----\nDecision: start the storage plan again with SQLite fixed.\n----- end -----`));
  assert.equal(g2.generation, 2); assert.equal(JSON.parse(g2.files['node.json']).generation, 2);
  assert.equal(deriveChild(load(r, 'K1')).files['context.md'].includes('SQLite fixed'), false, 'generation 1 is not affected');
});

test('oneLine is applied once, in the obligation identity: an item with a line break and doubled spaces keeps its text byte for byte through two levels while its identity hashes the one-line form', () => {
  const odd = 'The plan names an owner\nfor  every   step.';
  const root = rootParent({ criteria: [odd, ROOT_CRITERIA[1], ROOT_CRITERIA[2], ROOT_CRITERIA[3]] });
  const a = derive(root, 'K1');
  assert.equal(a.criteria[0], odd, 'handed in exactly as it was written');
  assert.equal(a.obligationMap.items[0].identity.textSha256, sha256Of('The plan names an owner for every step.'));
  const aBlock = twoItemBlock(); aBlock.classes.push({ id: 'C3', class: 'root-only' });                   // A holds three items
  const g = derive(asParent(a, { node: 'R/M1', block: aBlock, plan: doc('deliverable.md', planWith(aBlock)) }), 'K1');
  assert.equal(g.criteria[0], odd, 'and one level further');
});

test('the root goal must be named when the root task has headings (and no exclusions section hides the refusal behind another one)', () => {
  const root = rootParent();
  const task = doc('task.md', '# Goal\nBuild a thing.\n\n# Notes\nSome notes.\n');            // headings, but no exclusions section
  const p = clone(root); p.block.children[0].context_refs = ['parent-plan: Overview'];
  assert.throws(() => derive(p, 'K1', { rootTask: task }), e => e instanceof DeriveRefusal && e.code === 'missing_context' && /name no section of the root task/.test(e.detail));
  const ok = clone(root); ok.block.children[0].context_refs = ['root-task: Goal', 'parent-plan: Overview'];
  assert.doesNotThrow(() => derive(ok, 'K1', { rootTask: task }));
});

test('the loader never rests on a parent that has drifted: PLAN 5.5 items 1-3 are re-run, so a parent whose deliverable.md was edited after its run cannot be expanded', async () => {
  const r = await realRoot();
  assert.doesNotThrow(() => load(r, 'K1'));
  writeFileSync(join(r.runDir, 'deliverable.md'), `${readFileSync(join(r.runDir, 'deliverable.md'), 'utf8')}\nEdited after the run.\n`);
  assert.throws(() => load(r, 'K1'), /cannot be expanded: PLAN 5\.5 item 2 \(contract_check\)/);
});

test('"byte-equal" holds for what the CHILD RUNS WITH: an inherited item the chain would clip, trim, downgrade or drop is refused (`weakened_obligation`), a long string is not clipped and passes', () => {
  const long = { criterion: 'x'.repeat(2500), kind: 'checkable', check: 'c', on: 'plan' };
  const refuse = (item, re) => assert.throws(() => derive(rootParent({ criteria: [ROOT_CRITERIA[0], ROOT_CRITERIA[1], item, ROOT_CRITERIA[3]] }), 'K2'), e => e instanceof DeriveRefusal && e.code === 'weakened_obligation' && re.test(e.detail), JSON.stringify(item).slice(0, 60));
  refuse(long, /C2.*clipped to 2000/s);                                                                                      // the criterion text over the limit
  refuse({ criterion: 'Every step has a date.', kind: 'checkable', check: 'c'.repeat(600), on: 'plan' }, /would become/);      // the check over 500
  refuse({ criterion: 'Every step has a date.', kind: 'checkable', check: 'grep date plan.md', on: 'Plan' }, /would become/);  // `on` is lower-cased by the chain
  refuse({ criterion: '  Every step has a date.  ', kind: 'checkable', check: 'grep date plan.md', on: 'plan' }, /trimmed or clipped/);
  refuse({ criterion: 'Every step has a date.', kind: 'checkable', on: 'plan' }, /would become/);                             // checkable with no check is downgraded by the chain
  // a whitespace-only refinement sentence would be dropped by the chain, shifting every id after it
  const p = rootParent(); p.block.children[0].obligations = ['   '];
  assert.throws(() => derive(p, 'K1'), e => e.code === 'weakened_obligation' && /drops an empty item/.test(e.detail));
  // strings are passed through untouched, however long; a well-formed object is a fixed point of the chain's reading
  const longString = 'The plan states, in one sentence of '.padEnd(3000, 'x');
  const ok = derive(rootParent({ criteria: [longString, ROOT_CRITERIA[1], CHECKABLE, ROOT_CRITERIA[3]] }), 'K2');
  assert.equal(ok.criteria[0], longString); assert.equal(canonicalJson(ok.criteria[2 - 1]), canonicalJson(CHECKABLE));
});

// ================================================================================================================================================================ the M4 FIX (C&C): the start is tied to the bundle; the provider is told its headings; the write is durable
import { copyFileSync } from 'node:fs';

test('F2: the plan that PROVIDES an agreement is shown its provider_refs verbatim in part 1 of its context.md (its consumer needs each heading to exist exactly once); the consumer is not shown them', () => {
  const root = rootParent();
  const provides = derive(root, 'K1').files['context.md'];
  assert.ok(provides.includes('- A1 to K2: K1 exposes get(id) and put(record) on the store.\n  Integration check: Call get after put on both plans and compare the record.\n  Provider refs:\n  - Overview\n'), 'K1 provides A1: its provider_refs follow the agreement');
  const consumes = derive(root, 'K2').files['context.md'];
  assert.equal(consumes.includes('Provider refs:'), false, 'the consumer is told its own refs, not the provider\'s');
  const two = clone(root); two.block.agreements[0].provider_refs = ['Overview', 'Release and rollback plan'];
  assert.ok(derive(two, 'K1', { providers: {} }).files['context.md'].includes('  Provider refs:\n  - Overview\n  - Release and rollback plan\n'), 'every ref, one per line, in order');
});

test('F3: writeBundle makes the rename durable (the new folder and tree/inputs/ are fsynced): a guard on the source, since no test can see an fsync', () => {
  const src = readFileSync(join(REPO, 'src', 'tree-derive.js'), 'utf8');
  assert.match(src, /fsyncDir\(tmp\);[^\n]*\n\s*renameSync\(tmp, final\);\n\s*fsyncDir\(base\);/, 'fsync the new folder, rename, fsync the parent folder');
});

/** A registered child with a real bundle; `start` runs it with the inputs given (default: the bundle's own files). Each call builds its own tree (a refused start leaves its run folder behind, PLAN 14 M6 note). */
async function bundledChild() {
  const r = await realRoot();
  const args = load(r, 'K1');
  const d = deriveChild(args);
  const bundle = writeBundle(r.t.rootDir, d);
  const key = approveFrontier(r.t.rootDir, ['R/M1', 'R/M2', 'R/M3'], { split: r.split });
  registerChildUnchecked(r.t.rootDir, { frontierKey: key, node: d.node, generation: 1, runId: ids[0], parentRunId: ROOT_ID, chain: { name: args.childChain.name, sha256: r.t.shaIn(args.childChain.name) }, grant: { amount: 20, unit: 'usd' }, bundleSha256: d.bundleSha256, obligations: d.obligationMap, dependsOn: d.dependsOn, splitSha256: r.split });
  const start = (over = {}) => api.run({ chain: args.childChain.name, task: join(bundle.dir, 'task.md'), criteria: join(bundle.dir, 'criteria.json'), context: join(bundle.dir, 'context.md'), cwd: r.t.work, runId: ids[0], treeNode: join(bundle.dir, 'node.json'), ...over });
  return { r, d, bundle, start };
}
const lastBlocked = rootDir => events(rootDir).filter(e => e.event === 'blocked').at(-1);

test('F1: a member whose registration names a bundle is refused (exit 19, blocked continuation_refused / inputs_not_bundle, no claim) unless the task, criteria and context it is started with are the bundle\'s own files BY CONTENT: the probe (one inherited item changed by one letter) is now refused', async () => {
  const variants = {
    'a criteria file with one inherited item reworded': async c => { const list = JSON.parse(c.d.files['criteria.json']); list[0] = list[0].replace('artifact', 'artefact'); assert.notEqual(list[0], c.d.criteria[0]); const f = join(c.r.t.work, 'other-criteria.json'); writeFileSync(f, JSON.stringify(list)); return { criteria: f }; },
    'no --criteria at all (an absent list is weaker: the chain would write its own)': async () => ({ criteria: undefined }),
    'another task file': async c => ({ task: join(c.r.t.work, 'tasks', 'x.md') }),
    'no --context': async () => ({ context: undefined }),
    'a different context file': async c => { const f = join(c.r.t.work, 'other-context.md'); writeFileSync(f, `${c.d.files['context.md']}\nOne more line.\n`); return { context: f }; },
    'the bundle\'s context.md AND another file': async c => ({ context: `${join(c.bundle.dir, 'context.md')},${join(c.r.t.work, 'tasks', 'x.md')}` }),
  };
  const wording = { criteria: /criteria/, task: /task/, context: /context/ };
  for (const [name, make] of Object.entries(variants)) {
    const c = await bundledChild();
    const over = await make(c);
    const res = await c.start(over);
    assert.equal(res.exitCode, 19, `${name}: ${res.outputTail}`);
    const b = lastBlocked(c.r.t.rootDir);
    assert.deepEqual([b.reason, b.check, b.scope], ['continuation_refused', 'inputs_not_bundle', 'R/M1@g1'], name);
    assert.match(b.detail, name.startsWith('no --criteria') ? /run was started with no --criteria/ : name.includes('criteria') ? /--criteria the run was started with is not the bundle's criteria\.json/ : name.includes('task') ? wording.task : name.includes('AND another') ? /more than the bundle's context\.md/ : wording.context, `${name}: ${b.detail}`);
    assert.equal(events(c.r.t.rootDir).some(e => e.event === 'node_started' && e.node === 'R/M1'), false, `${name}: no claim, so no phantom active node`);
    assert.equal(stateOf(readTreeRecord(c.r.t.rootDir)).active, 'R/M1@g1', 'the node is still just registered (active from its registration, as before)');
    assert.equal(bundleSha256Of(c.bundle.dir), c.d.bundleSha256, `${name}: the bundle is untouched`);
  }
  // content, never path: copies and a symlink to the same bytes are fine
  const c = await bundledChild();
  const copy = name => { const f = join(c.r.t.work, `copy-${name}`); copyFileSync(join(c.bundle.dir, name), f); return f; };
  const link = join(c.r.t.work, 'link-context.md'); symlinkSync(join(c.bundle.dir, 'context.md'), link);
  const ok = await c.start({ task: copy('task.md'), criteria: copy('criteria.json'), context: link });
  assert.equal(ok.exitCode, 0, ok.outputTail);
  assert.equal(JSON.parse(readFileSync(join(c.r.t.runsDir, ids[0], 'report.json'), 'utf8')).criteria.length, c.d.criteria.length);
});

test('F1: node.json is only a pointer: one that names a bundle the registration does not hold is refused; and a registration with NO bundle (the root, M2\'s fixtures) is exempt from the inputs check', async () => {
  const c = await bundledChild();
  const nodeJson = JSON.parse(readFileSync(join(c.bundle.dir, 'node.json'), 'utf8'));
  const other = join(c.r.t.work, 'node-other.json'); writeFileSync(other, JSON.stringify({ ...nodeJson, bundleSha256: sha256Of('another bundle') }));
  const res = await c.start({ treeNode: other });
  assert.equal(res.exitCode, 19, res.outputTail);
  const b = lastBlocked(c.r.t.rootDir);
  assert.deepEqual([b.reason, b.check], ['continuation_refused', 'bundle']); assert.match(b.detail, /node\.json names the bundle/);
  // a node with no bundle in its registration: any task is fine (the exemption; M5 must never register a child without one)
  const t = newTree({ cap: 10, childChain: 'mock' });
  registerRoot(t.rootDir); writeFileSync(join(t.work, 'plan.md'), planWith(block3(), { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
  assert.equal((await api.run(rootOpts(t))).exitCode, 0, 'the root has no bundle and runs on its own task');
});

test('C&C (M4 PASS): memberStart REQUIRES inputs for a start or resume and throws without them (the argument cannot be left out to skip the bundle check); post_run is the one purpose without them', async () => {
  const { memberStart } = await import('../src/tree-member.js');
  const t = await realRoot();
  const lineage = JSON.parse(readFileSync(lineageFile(t.t.work, 'R'), 'utf8'));
  const base = { runDir: join(t.t.runsDir, ROOT_ID), runId: ROOT_ID, lineage, capAskedUsd: 5, piiGate: null, piiAllow: [], allowSecretShaped: false, ceiling: null, work: t.t.work };
  assert.throws(() => memberStart({ ...base }), e => e instanceof TypeError && /requires inputs/.test(e.message));
  assert.throws(() => memberStart({ ...base, purpose: 'run', inputs: null }), TypeError);
  assert.throws(() => memberStart({ ...base, purpose: 'resume' }), TypeError);
  // post_run is exempt: it gets past the argument check (what happens next is the tree's own answer, here a refusal because the root is closed and a post-run claim needs a grant it has)
  let err = null; try { memberStart({ ...base, purpose: 'post_run' }); } catch (e) { err = e; }
  assert.ok(!(err instanceof TypeError && /requires inputs/.test(err.message)), 'post_run does not need inputs');
});

// ================================================================================================================================================================ M5b2: the preview (the stop before a frontier is approved)
test('a preview and the full derivation AGREE on everything the stop shows: the acceptance list, the guard refusals, the held items, the check_not_enforced items, the lints, the obligation map and startable (otherwise the stop shows one thing and registration does another); a preview needs no provider and has no bundle', () => {
  const root = rootParent();
  const chains = [{ handoff: true, debate: true, kindsEnabled: false }, { handoff: true, debate: true, kindsEnabled: true }, { handoff: false, debate: false, kindsEnabled: false }];
  let compared = 0; let heldSeen = 0;
  for (const childChain of chains) {
    for (const id of ['K1', 'K2', 'K3']) {
      const full = derive(root, id, { childChain });
      const pre = derive(root, id, { childChain, providers: {}, preview: true });
      for (const field of ['node', 'generation', 'criteria', 'guardRefused', 'checkNotEnforced', 'held', 'startable', 'lints', 'obligationMap']) assert.deepEqual(pre[field], full[field], `${id} ${field} under ${JSON.stringify(childChain)}`);
      compared += 1; heldSeen += full.held.length;
    }
  }
  assert.equal(compared, 9);
  assert.ok(heldSeen > 0, 'the comparison included children that are HELD (a guard refusal or an unenforced check), or it proves nothing about them');
  const pre = derive(root, 'K2', { providers: {}, preview: true });
  assert.deepEqual([pre.preview, pre.files, pre.lineage, pre.bundleSha256, pre.bundleBytes], [true, null, null, null, null]);
  assert.throws(() => derive(root, 'K2', { providers: {} }), e => e instanceof DeriveRefusal && e.code === 'missing_context', 'the full derivation of a consumer DOES need its provider');
  assert.throws(() => writeBundle(mkdtempSync(join(tmpdir(), 'thc-prev-')), pre), /a preview has no bundle/);
});

test('the loader\'s preview: a consumer whose provider is a sibling that is not in the record yet loads and previews; the same child loaded for a full derivation is `missing_context`', async () => {
  const r = await realRoot();
  const args = load(r, 'K2', { preview: true });
  assert.equal(args.preview, true); assert.deepEqual(args.providers, {});
  const pre = deriveChild(args);
  assert.equal(pre.preview, true); assert.equal(pre.node, 'R/M2');
  assert.throws(() => deriveChild(load(r, 'K2')), e => e instanceof DeriveRefusal && e.code === 'missing_context');
  const full = deriveChild(load(r, 'K1')); const prev1 = deriveChild(load(r, 'K1', { preview: true }));
  assert.deepEqual(prev1.criteria, full.criteria); assert.deepEqual(prev1.lints, full.lints);
});

test('context.md part 5 (Muad\'s yes, 11 Oct 2026): the parent\'s criteria are PC1.., the sentence sits on its own line under the kept heading, and each item says whether it is the child\'s own C<k> (by IDENTITY) or not in its acceptance list - for an item delegated to a sibling AND for one a guard refused', () => {
  const SENTENCE = 'The parent plan\'s criteria, for reference only. Check and cite only your own C-numbers.';
  const root = rootParent({ criteria: [ROOT_CRITERIA[0], HANDOFF_ITEM, ROOT_CRITERIA[2], ROOT_CRITERIA[3]] });   // C1 global, C2 (guard-refused at K1), C3 delegated to K2, C4 root-only
  const part5 = c => c.slice(c.indexOf('## 5. '), c.indexOf('## 6. '));
  const k1 = derive(root, 'K1').files['context.md'];
  assert.ok(part5(k1).startsWith(`## 5. The parent's locked criteria, for reference\n\n${SENTENCE}\n`), 'the heading is kept; the sentence is on its own line below it');
  assert.deepEqual(part5(k1).split('\n').filter(l => /^PC\d+\. /.test(l)), [
    `PC1. ${ROOT_CRITERIA[0]} (this is your C1)`,                                  // global: carried by every child
    `PC2. ${HANDOFF_ITEM} (not in your acceptance list)`,                          // inherited but REFUSED by a guard: in section 6, not in the list
    'PC3. Every step has a date. (not in your acceptance list)',                    // delegated to a sibling (K2)
    `PC4. ${ROOT_CRITERIA[3]} (not in your acceptance list)`,                      // root-only
  ]);
  // the child's own number is its position in criteria.json, which is the C-numbering its handoff prompt shows
  assert.deepEqual(JSON.parse(derive(root, 'K1').files['criteria.json']).slice(0, 1), [ROOT_CRITERIA[0]]);
  // K2 inherits C3 (an object item): its own number is its place in the list, whatever the parent called it
  const k2 = derive(root, 'K2').files['context.md'];
  assert.ok(part5(k2).includes(`PC1. ${ROOT_CRITERIA[0]} (this is your C1)`) && part5(k2).includes('PC3. Every step has a date. (this is your C2)'), 'C3 of the parent is C2 of K2');
  assert.ok(part5(k2).includes(`PC2. ${HANDOFF_ITEM} (not in your acceptance list)`));
  // a refinement has no parent item: nothing in part 5 mentions it, though it is in the child's list
  assert.equal(part5(k1).includes('The store keeps every record for 30 days.'), false);
  // identity, never text: a child whose list holds ANOTHER item with the same words as a parent item still marks the parent item by origin
  const twin = rootParent({ criteria: [ROOT_CRITERIA[0], ROOT_CRITERIA[1], ROOT_CRITERIA[2], ROOT_CRITERIA[3]], mutate: b => { b.children[0].obligations = [ROOT_CRITERIA[3]]; } });
  const t1 = derive(twin, 'K1').files['context.md'];
  assert.ok(part5(t1).includes(`PC4. ${ROOT_CRITERIA[3]} (not in your acceptance list)`), 'the child\'s own obligation has the same words as the root-only parent item, but it is not that item');
});
