// S8-9 C3, the PURE layer (contract §11, gate 1 passed 13 Oct 2026; no record change, no approval text): reuse is checked piece by piece at EVERY split, so the comparison and its loader work for any parent, not only the root.
//   src/tree-reuse.js       `changed: its branch is not whole` (a held-eligible node whose branch has a missing piece is never adopted as a unit), `ownFields`, and the ambiguity reason naming whose list repeats.
//   src/tree-reuse-load.js  `loadChildren` takes TWO required predicates (per-node eligibility, whole-branch), works for a NON-ROOT old/new parent (verified on the depth-2 fixture), and the ambiguity check covers the new parent's list AND every ancestor's
//                           (`newRootKeys` hard-coded originNode 'R' and was wrong below the root).
// New exports are read through namespaces (the habit from the views-lock slip). All $0; the working folders are removed at the end of the file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import * as reuse from '../src/tree-reuse.js';
import * as loader from '../src/tree-reuse-load.js';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { driveToDepthTwoReplan } from './helpers/depth-two-replan.js';

const KEY = (text, cls = 'delegated', originNode = 'R') => ({ originNode, originClass: cls, textSha256: `h:${text.replace(/\s+/g, ' ').trim()}` });
const idOf = (text, gen, id, cls = 'delegated', originNode = 'R') => ({ originNode, originGeneration: gen, originId: id, originClass: cls, textSha256: `h:${text.replace(/\s+/g, ' ').trim()}`, form: text });
const acc = (text, gen, id, originNode = 'R') => ({ key: KEY(text, 'delegated', originNode), text, form: text, from: `${originNode}@g${gen}:${id}`, identity: idOf(text, gen, id, 'delegated', originNode) });
const side = (o = {}) => ({
  node: 'R/M1/M1', milestone: 'M1', scope: 'Build the first piece.', openQuestion: 'Which store holds the records?',
  acceptance: [acc('The store keeps every record.', 1, 'C1')], refinements: [], carried: [], agreements: [], rootSections: [], chain: '{"debate":true}', expects: [], ...o,
});
const child = (o = {}) => ({ node: 'R/M1/M1', slot: { node: 'R/M1/M1', generation: 2 }, newSide: side(), oldSide: side(), old: { node: 'R/M1/M1', generation: 1, runId: '2026-10-12T08-00-00-000Z' }, oldProblem: null, eligible: true, ineligibleWhy: null, wholeBranch: true, ...o });
const one = (c, extra = {}) => reuse.compareChildren({ children: [c], ambiguousKeys: [], ...extra })[0];

test('RC3-1: a held-eligible node whose BRANCH is not whole is never adopted as a unit: `changed: its branch is not whole`, with its own F1-F9 verdict attached; ineligible wins over it; a MISSING flag reads as not whole (fail closed)', () => {
  const same = one(child({ wholeBranch: true })); assert.equal(same.verdict, 'same');
  const { wholeBranch: _gone, ...noFlag } = child(); const unflagged = one(noFlag);
  assert.deepEqual([unflagged.verdict, unflagged.field], ['changed', 'branch_not_whole'], 'no flag: a caller that forgot the predicate adopts nothing');
  const notWhole = one(child({ wholeBranch: false }));
  assert.deepEqual([notWhole.verdict, notWhole.field, notWhole.reason], ['changed', 'branch_not_whole', 'changed: its branch is not whole']);
  assert.deepEqual(notWhole.ownFields, { verdict: 'same' }, 'its own inputs are unchanged: only the branch is the reason');
  assert.equal(notWhole.adopts, undefined, 'a changed row adopts nothing');
  const both = one(child({ wholeBranch: false, newSide: side({ scope: 'Build the first piece differently.' }) }));
  assert.equal(both.field, 'branch_not_whole');
  assert.deepEqual([both.ownFields.verdict, both.ownFields.field], ['changed', 'scope'], 'the approval can print the node\'s own scope change as well');
  assert.equal(one(child({ wholeBranch: false, eligible: false, ineligibleWhy: 'A says no' })).field, 'ineligible', 'ineligible comes first in the fixed order');
  const rows = reuse.compareChildren({ ambiguousKeys: [], children: [child({ node: 'R/M1/M1', wholeBranch: false }), child({ node: 'R/M1/M2', newSide: side({ node: 'R/M1/M2', expects: ['R/M1/M1'] }), oldSide: side({ node: 'R/M1/M2', expects: ['R/M1/M1'] }), wholeBranch: true })] });
  assert.deepEqual(rows.map(r => [r.node, r.field]), [['R/M1/M1', 'branch_not_whole'], ['R/M1/M2', 'provider']], 'a consumer of a provider that is not adopted is redone too');
});

test('RC3-2: the ambiguity reason names the plan that REALLY repeats the criterion, from the matched key\'s own origin node (root -> "the new root plan", C1\'s sentence unchanged; a deeper node -> "the plan of <node>"); a root repeat is never blamed on the parent', () => {
  const rootDup = KEY('The store keeps every record.', 'delegated', 'R');
  const rootKey = reuse.duplicateKeysOf([rootDup, rootDup])[0];
  const atRoot = one(child(), { ambiguousKeys: [rootKey] });
  assert.equal(atRoot.field, 'acceptance'); assert.match(atRoot.reason, /the new root plan lists the same criterion more than once/);
  const parentDup = KEY('Own item.', 'delegated', 'R/M1');
  const parentKey = reuse.duplicateKeysOf([parentDup, parentDup])[0];
  const own = side({ acceptance: [acc('Own item.', 1, 'C1', 'R/M1')] });
  const atParent = one(child({ newSide: own, oldSide: own }), { ambiguousKeys: [parentKey] });
  assert.match(atParent.reason, /the plan of R\/M1 lists the same criterion more than once/); assert.doesNotMatch(atParent.reason, /new root plan/);
  const mixed = one(child(), { ambiguousKeys: [parentKey] });
  assert.equal(mixed.verdict, 'same', 'a repeat in another plan\'s list that this child does not carry is not its ambiguity');
});

test('RC3-3: the ambiguity check covers EVERY ancestor\'s list: a root criterion repeated at the root is ambiguous for a deeper adoption although the parent\'s own list holds it once (pure part: ambiguousKeysOfLists)', () => {
  const rootList = [KEY('Reads are fast.', 'global', 'R'), KEY('Reads are fast.', 'global', 'R'), KEY('Writes are safe.', 'delegated', 'R')];
  const parentList = [KEY('Reads are fast.', 'global', 'R/M1'), KEY('Keep a log.', 'delegated', 'R/M1')];
  const got = loader.ambiguousKeysOfLists([parentList, rootList]);
  assert.equal(got.length, 1, 'one repeated key: the root\'s'); assert.equal(JSON.parse(got[0]).originNode, 'R');
  assert.deepEqual(loader.ambiguousKeysOfLists([parentList]), [], 'the parent\'s own list alone has none (the old root-only check would have said so for a non-root parent)');
  const itemsOf = (originNode) => loader.ambiguousKeysOfItems({ items: [{ id: 'C1', form: 'Same text.' }, { id: 'C2', form: 'Same text.' }], classOf: () => 'delegated', originNode });
  assert.equal(JSON.parse(itemsOf('R/M1')[0]).originNode, 'R/M1', 'the origin node is a parameter, not a constant "R"'); assert.equal(JSON.parse(itemsOf(undefined)[0]).originNode, 'R', 'default: the root (C1)');
});

test('RC3-6: the ancestor chain stops at the ROOT (it has no tree parent): a hand-built state where R@g2\'s frontier names R@g1 still ends at R@g2; a deeper node walks to R and no further', () => {
  const node = (n, g, fk) => [`${n}@g${g}`, { node: n, generation: g, frontierKey: fk }];
  const state = { nodes: new Map([node('R', 1, null), node('R', 2, 'fr'), node('R/M1', 2, 'kids'), node('R/M1/M1', 2, 'gk')]), frontiers: new Map([['fr', { parentNode: 'R', parentGeneration: 1 }], ['kids', { parentNode: 'R', parentGeneration: 2 }], ['gk', { parentNode: 'R/M1', parentGeneration: 2 }]]) };
  assert.deepEqual(loader.ancestorChainOf(state, { node: 'R', generation: 2 }), [{ node: 'R', generation: 2 }], 'never into the superseded root generation');
  assert.deepEqual(loader.ancestorChainOf(state, { node: 'R/M1/M1', generation: 2 }), [{ node: 'R/M1/M1', generation: 2 }, { node: 'R/M1', generation: 2 }, { node: 'R', generation: 2 }]);
});

let S;
const fixture = async () => { S ??= await driveToDepthTwoReplan(); return S; };
const rootTaskOf = f => join(f.work, 'tasks', 'x.md');

test('RC3-4: on the REAL depth-2 tree, `loadChildren` works with a NON-ROOT parent (R/M1@g1 compared with itself): the old side of each piece verifies, providers come before consumers, both predicates are asked per old node key and reach each child; a missing predicate throws', async () => {
  const f = await fixture();
  const asked = { eligibility: [], wholeBranch: [] };
  const args = { rootDir: f.rootDir, work: f.work, rootTaskPath: rootTaskOf(f), newParent: { node: 'R/M1', generation: 1 }, oldParent: { node: 'R/M1', generation: 1 }, slotGeneration: 2,
    eligibility: key => { asked.eligibility.push(key); return key === 'R/M1/M3@g1' ? { eligible: false, why: 'it stopped' } : { eligible: true, why: null }; },
    wholeBranch: key => { asked.wholeBranch.push(key); return key !== 'R/M1/M2@g1'; } };
  const rows = loader.loadChildren(args);
  assert.deepEqual(rows.map(c => c.node), ['R/M1/M1', 'R/M1/M2', 'R/M1/M3'].filter(n => rows.some(c => c.node === n)), 'the non-root children are lined up');
  assert.ok(rows.length === 3 && rows.every(c => c.old && c.oldProblem === null), JSON.stringify(rows.map(c => [c.node, c.oldProblem])));
  const order = rows.map(c => c.node); for (const c of rows) for (const p of c.newSide.expects) assert.ok(order.indexOf(p) < order.indexOf(c.node), `${p} before ${c.node}`);
  assert.deepEqual(asked.eligibility.sort(), ['R/M1/M1@g1', 'R/M1/M2@g1', 'R/M1/M3@g1']); assert.deepEqual(asked.wholeBranch.sort(), ['R/M1/M1@g1', 'R/M1/M2@g1', 'R/M1/M3@g1']);
  assert.deepEqual(rows.map(c => [c.node, c.eligible, c.wholeBranch]), [['R/M1/M1', true, true], ['R/M1/M2', true, false], ['R/M1/M3', false, true]]);
  const verdicts = reuse.compareChildren({ children: rows, ambiguousKeys: loader.ambiguousKeysOfChain({ rootDir: f.rootDir, newParent: { node: 'R/M1', generation: 1 } }) });
  assert.deepEqual(verdicts.map(v => [v.node, v.verdict, v.field]), [['R/M1/M1', 'same', null], ['R/M1/M2', 'changed', 'branch_not_whole'], ['R/M1/M3', 'changed', 'ineligible']]);
  assert.equal(verdicts[0].adopts.runId, rows[0].old.runId, 'the unit adopts its old run');
  for (const missing of ['eligibility', 'wholeBranch']) assert.throws(() => loader.loadChildren({ ...args, [missing]: undefined }), new RegExp(`\`${missing}\``), `a missing ${missing} predicate throws: no fail-open default`);
});

test('RC3-5: the ancestor chain and the keys below the root: ancestorChainOf walks the frontiers up to the root; newParentKeys carries the PARENT\'s node as originNode (known-bad: the C1 helper said "R" for every parent); the root level is unchanged', async () => {
  const f = await fixture();
  const state = stateOf(readTreeRecord(f.rootDir));
  assert.deepEqual(loader.ancestorChainOf(state, { node: 'R/M1', generation: 1 }), [{ node: 'R/M1', generation: 1 }, { node: 'R', generation: 1 }]);
  assert.deepEqual(loader.ancestorChainOf(state, { node: 'R', generation: 1 }), [{ node: 'R', generation: 1 }]);
  assert.deepEqual(loader.ancestorChainOf(state, { node: 'R/M9', generation: 1 }), [{ node: 'R/M9', generation: 1 }], 'a node the record does not hold ends the chain at itself');
  const keys = loader.newParentKeys({ rootDir: f.rootDir, newParent: { node: 'R/M1', generation: 1 } });
  assert.ok(keys.length > 0 && keys.every(k => k.originNode === 'R/M1'), JSON.stringify(keys));
  const rootKeys = loader.newRootKeys({ rootDir: f.rootDir, newParent: { node: 'R', generation: 1 } });
  assert.ok(rootKeys.length > 0 && rootKeys.every(k => k.originNode === 'R'));
  // the keys a child REALLY inherits from R/M1's own list match the ones the loader makes for it (the contract's RU-16 check, one level down)
  const rows = loader.loadChildren({ rootDir: f.rootDir, work: f.work, rootTaskPath: rootTaskOf(f), newParent: { node: 'R/M1', generation: 1 }, oldParent: { node: 'R/M1', generation: 1 }, slotGeneration: 2, eligibility: () => ({ eligible: true, why: null }), wholeBranch: () => true });
  const made = new Set(keys.map(k => JSON.stringify(k))); const inherited = rows.flatMap(c => [...c.newSide.acceptance, ...c.newSide.carried]).filter(x => x.key && x.key.originNode === 'R/M1');
  assert.ok(inherited.length > 0 && inherited.every(x => made.has(JSON.stringify(x.key))), 'every R/M1-origin key a child carries is one the loader makes');
  assert.deepEqual(loader.ambiguousKeysOfChain({ rootDir: f.rootDir, newParent: { node: 'R/M1', generation: 1 } }), [], 'an ordinary tree lists nothing twice, at any level');
  assert.deepEqual(loader.newRootAmbiguousKeys({ rootDir: f.rootDir, newParent: { node: 'R', generation: 1 } }), []);
});
