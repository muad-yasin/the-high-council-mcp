// REUSE of old sub-plans at a root re-plan, C1 (0.8.3 M6 S8-9; contract Review/Build_0.8.3/m6-closing/S8-9_Reuse_Contract.md, gate 1 passed 12 Oct; Muad's reading 2: "same criteria text + same milestone scope, wording around them may change;
// deterministic, no model; a sub-plan whose supplier is redone is redone too; redo only with a shown reason"). Two pieces, no record change:
//   src/tree-reuse.js       PURE: `sideOf` (a derived child -> the plain data F1-F9 are compared on) and `compareChildren` (sides in, `same` / `changed: <field>` rows out). No file, clock, network or model.
//   src/tree-reuse-load.js  the LOADER: reads both sides from the run folders through `loadDerivation` + `deriveChild` (the one function on both sides) and VERIFIES the old side against what the old child registered.
// All $0: the real trees are all-mock; every working folder is a temp folder removed at the end of the file.
import test from 'node:test';
import { canonicalJson } from '../src/thin-contract.js';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// namespaces loaded with a catch, so a missing module fails each test that needs it by itself (and the others are reached on their own)
const reuse = await import('../src/tree-reuse.js').catch(() => ({}));
const loader = await import('../src/tree-reuse-load.js').catch(() => ({}));
import { deriveChild } from '../src/tree-derive.js';
import { loadDerivation } from '../src/tree-derive-load.js';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { runTree } from '../src/tree-run.js';
import { bundleDirOf } from '../src/tree-continuation.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren, splitChildren } from './helpers/child-chains.js';
import { approvePending, draftStarter } from './helpers/sitting.js';
import { realRoot } from './helpers/real-root.js';

const KEY = (text, cls = 'delegated') => ({ originNode: 'R', originClass: cls, textSha256: `h:${text.replace(/\s+/g, ' ').trim()}` });
/** A whole identity as src/tree-identity.js obligationIdentity makes it (the form is the raw text). */
const idOf = (text, gen, id, cls = 'delegated') => ({ originNode: 'R', originGeneration: gen, originId: id, originClass: cls, textSha256: `h:${text.replace(/\s+/g, ' ').trim()}`, form: text });
const acc = (text, gen, id) => ({ key: KEY(text), text, form: text, from: `R@g${gen}:${id}`, identity: idOf(text, gen, id) });
const carr = (text, gen, id, extra = {}) => ({ reason: 'context', originClass: 'global', text, check: null, on: null, key: KEY(text, 'global'), from: `R@g${gen}:${id}`, identity: idOf(text, gen, id, 'global'), ...extra });
/** A side as `sideOf` makes it, with every field settable. */
const side = (o = {}) => ({
  node: 'R/M1', milestone: 'M1', scope: 'Choose and build the record store.', openQuestion: 'Which store holds the records?',
  acceptance: [acc('The store keeps every record.', 1, 'C1'), acc('Reads are fast.', 1, 'C2')],
  refinements: ['Records are kept for 30 days.'], carried: [carr('Keep a log.', 1, 'G1')],
  agreements: [{ direction: 'provides', sibling: 'M2', what: 'get(id) and put(record)', integrationCheck: 'Call get after put.', providerRefs: ['Overview'] }],
  rootSections: [{ heading: 'Goal', text: 'Build a small notes app.' }], chain: '{"debate":true,"handoff":true,"kindsEnabled":false}', expects: [], ...o,
});
/** One child for compareChildren: old and new are the same side unless overridden. */
const child = (o = {}) => ({ node: 'R/M1', slot: { node: 'R/M1', generation: 2 }, newSide: side(), oldSide: side(), old: { node: 'R/M1', generation: 1, runId: '2026-10-12T08-00-00-000Z' }, oldProblem: null, eligible: true, ineligibleWhy: null, wholeBranch: true, ...o });
const one = c => reuse.compareChildren({ children: [c], ambiguousKeys: [] })[0];

test('RU-1 identical sides are SAME - after whitespace-only changes too (reading 2: wording around them may change; only runs of whitespace are collapsed) - and a one-word change is `changed: scope` with both texts (the known-bad control)', () => {
  const a = one(child()); assert.equal(a.verdict, 'same', JSON.stringify(a)); assert.equal(a.field, null);
  assert.deepEqual(a.adopts, { node: 'R/M1', generation: 1, runId: '2026-10-12T08-00-00-000Z' });
  const spaced = one(child({ newSide: side({ scope: '  Choose   and build\nthe record store.  ', refinements: ['Records  are kept\tfor 30 days.'] }) }));
  assert.equal(spaced.verdict, 'same', JSON.stringify(spaced));
  const worded = one(child({ newSide: side({ scope: 'Choose and build the record DATABASE.' }) }));
  assert.equal(worded.verdict, 'changed'); assert.equal(worded.field, 'scope'); assert.equal(worded.oldText, 'Choose and build the record store.'); assert.equal(worded.newText, 'Choose and build the record DATABASE.');
  assert.match(worded.reason, /scope differs/); assert.equal(worded.adopts, undefined, 'a changed child adopts nothing');
});

test('RU-2 every field F1-F9 flips the verdict to `changed: <that field>`, one known-bad row per field, and the FIRST differing field in F1..F9 order is the one named', () => {
  const rows = [
    ['scope', { scope: 'Something else.' }], ['open_question', { openQuestion: 'Another question?' }],
    ['acceptance', { acceptance: [{ ...acc('The store keeps every record.', 1, 'C1'), text: 'x', form: 'x' }, acc('Reads are slow.', 1, 'C2')] }],
    ['refinements', { refinements: ['Records are kept for 31 days.'] }], ['carried', { carried: [carr('Keep a log.', 1, 'G1', { reason: 'guard_refused' })] }],
    ['agreements', { agreements: [{ direction: 'provides', sibling: 'M2', what: 'get(id) and put(record)', integrationCheck: 'Call put after get.', providerRefs: ['Overview'] }] }],
    ['root_sections', { rootSections: [{ heading: 'Goal', text: 'Build a big notes app.' }] }], ['chain', { chain: '{"debate":false}' }],
  ];
  for (const [field, change] of rows) {
    const r = one(child({ newSide: side(change) }));
    assert.equal(r.verdict, 'changed', field); assert.equal(r.field, field, `${field}: ${JSON.stringify(r)}`);
    assert.ok(r.oldText !== undefined && r.newText !== undefined && r.oldText !== r.newText, `${field}: both texts are shown and differ`);
  }
  const two = one(child({ newSide: side({ scope: 'Other.', openQuestion: 'Other?' }) })); assert.equal(two.field, 'scope', 'scope (F2) before open_question (F3)');
  // FLIPPED 14 Oct 2026 (C2a gate 1: F1, the milestone id, is a LABEL - relocation by content): the row `['milestone', { milestone: 'M9', node: 'R/M9' }]` used to assert `changed: milestone`; a label change alone is now `same` (test/tree-reuse-slots.test.js SL-1 pins it with the hash).
  assert.equal(one(child({ newSide: side({ milestone: 'M9', node: 'R/M9' }) })).verdict, 'same', 'a re-labelled milestone alone is the same sub-plan');
});

test('RU-3 lists are compared as MULTISETS: order and the child\'s local ids do not count; a duplicated item on either side makes the acceptance list AMBIGUOUS (changed), because the identity map could not pair it', () => {
  const reordered = one(child({ newSide: side({ acceptance: [...side().acceptance].reverse().map((a, i) => acc(a.text, 2, `C${9 - i}`)), refinements: ['Records are kept for 30 days.'], agreements: [...side().agreements].reverse() }) }));
  assert.equal(reordered.verdict, 'same', JSON.stringify(reordered));
  assert.deepEqual(reordered.identityMap.map(m => [m.from, m.to.originGeneration, m.to.originId]).sort(), [['R@g1:C1', 2, 'C8'], ['R@g1:C2', 2, 'C9'], ['R@g1:G1', 1, 'G1']].sort(), 'the map pairs equal {originNode, originClass, text} items, old -> new (the carried item is unchanged: it maps to itself)');
  const dup = side({ acceptance: [side().acceptance[0], { ...side().acceptance[0], from: 'R@g1:C3', identity: { ...side().acceptance[0].identity, originId: 'C3' } }] });
  for (const [label, c] of [['new', child({ newSide: dup })], ['old', child({ oldSide: dup })], ['both', child({ newSide: dup, oldSide: dup })]]) {
    const r = one(c); assert.equal(r.verdict, 'changed', label); assert.equal(r.field, 'acceptance'); assert.match(r.reason, /ambiguous/);
  }
  const fewer = one(child({ newSide: side({ acceptance: [side().acceptance[0]] }) })); assert.equal(fewer.field, 'acceptance');
});

test('RU-4 the TRANSITIVE clause: a consumer of a changed provider is `changed` though its own fields are equal; a consumer of a reused provider is `same`; providers are decided before their consumers, in the order given', () => {
  const prov = (o = {}) => child({ node: 'R/M2', slot: { node: 'R/M2', generation: 2 }, newSide: side({ node: 'R/M2', milestone: 'M2', scope: 'Web layer.' }), oldSide: side({ node: 'R/M2', milestone: 'M2', scope: 'Web layer.' }), old: { node: 'R/M2', generation: 1, runId: 'p' }, ...o });
  const cons = () => child({ node: 'R/M3', slot: { node: 'R/M3', generation: 2 }, newSide: side({ node: 'R/M3', milestone: 'M3', expects: ['R/M2'] }), oldSide: side({ node: 'R/M3', milestone: 'M3', expects: ['R/M2'] }), old: { node: 'R/M3', generation: 1, runId: 'c' } });
  const ok = reuse.compareChildren({ children: [prov(), cons()], ambiguousKeys: [] }); assert.deepEqual(ok.map(r => r.verdict), ['same', 'same']);
  const bad = reuse.compareChildren({ children: [prov({ newSide: side({ node: 'R/M2', milestone: 'M2', scope: 'A different web layer.' }) }), cons()], ambiguousKeys: [] });
  assert.deepEqual(bad.map(r => r.verdict), ['changed', 'changed']); assert.equal(bad[1].field, 'provider'); assert.match(bad[1].reason, /provider R\/M2 is not reused/);
  const inel = reuse.compareChildren({ children: [prov({ eligible: false, ineligibleWhy: 'R/M2@g1 is stopped at its budget cap' }), cons()], ambiguousKeys: [] });
  assert.equal(inel[0].field, 'ineligible'); assert.match(inel[0].reason, /stopped at its budget cap/); assert.equal(inel[1].field, 'provider');
});

test('RU-5 the OTHER reasons a child is `changed`: no earlier node on that path (a new child), an earlier node that is not eligible (A\'s predicate says why), old inputs that cannot be verified; the order of reasons is fixed and every row says WHY in a sentence', () => {
  const none = one(child({ oldSide: null, old: null })); assert.equal(none.field, 'new_child'); assert.match(none.reason, /no earlier node/);
  const inel = one(child({ eligible: false, ineligibleWhy: 'R/M1/M1@g1 is not closed' })); assert.equal(inel.field, 'ineligible'); assert.match(inel.reason, /R\/M1\/M1@g1 is not closed/);
  const bad = one(child({ oldSide: null, oldProblem: 'its bundle hash is not the registered one' })); assert.equal(bad.field, 'old_side'); assert.match(bad.reason, /old inputs cannot be verified: its bundle hash is not the registered one/);
  // an unverifiable old side outranks "ineligible", and ineligible outranks a field difference
  assert.equal(one(child({ oldProblem: 'x', eligible: false, newSide: side({ scope: 'z' }) })).field, 'old_side');
  assert.equal(one(child({ eligible: false, ineligibleWhy: 'y', newSide: side({ scope: 'z' }) })).field, 'ineligible');
});

test('RU-6 `fieldsSha256` binds the NEW side\'s F1-F9 (normalised, order-free): the same for a reordered list, different for any changed field, and present on every row that compares', () => {
  const a = one(child()); const b = one(child({ newSide: side({ acceptance: [...side().acceptance].reverse() }) }));
  assert.match(a.fieldsSha256, /^[0-9a-f]{64}$/); assert.equal(a.fieldsSha256, b.fieldsSha256, 'a reordering is not a change');
  const c = one(child({ newSide: side({ scope: 'x' }), oldSide: side({ scope: 'x' }) })); assert.notEqual(c.fieldsSha256, a.fieldsSha256, 'another new side, another hash');
  assert.ok(one(child({ newSide: side({ scope: 'q' }) })).fieldsSha256, 'a changed row carries the hash too (what was compared)');
});

test('RU-7 PURE and DETERMINISTIC: the same inputs give the same bytes, the inputs are not mutated (deep-frozen inputs do not throw), and the module reads no file, no clock, no randomness (a source scan of src/tree-reuse.js; the loader is a separate file)', () => {
  const deepFreeze = o => { if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };
  const children = deepFreeze([child(), child({ node: 'R/M2', slot: { node: 'R/M2', generation: 2 }, newSide: side({ node: 'R/M2', scope: 'k' }) })]);
  const x = JSON.stringify(reuse.compareChildren({ children, ambiguousKeys: [] })); assert.equal(JSON.stringify(reuse.compareChildren({ children, ambiguousKeys: [] })), x);
  const src = readFileSync(join(import.meta.dirname, '..', 'src', 'tree-reuse.js'), 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  for (const bad of [/from 'node:fs'/, /readFileSync|writeFileSync|statSync|readdirSync/, /Date\.now|new Date\(/, /Math\.random/, /from 'node:(child_process|net|http|https)'/, /\bfetch\(/]) assert.doesNotMatch(src, bad, String(bad));
  assert.ok(existsSync(join(import.meta.dirname, '..', 'src', 'tree-reuse-load.js')), 'the loader is its own file');
});

test('RU-8 `sideOf` on REAL derivations (a real all-mock root, split verified): the same child derived twice is the same side; the same block with one word of the child\'s scope changed is `changed: scope` and nothing else; a refinement sentence reworded is `changed: refinements`', async () => {
  const r = await realRoot();
  const args = loadDerivation({ rootDir: r.t.rootDir, parentRef: { node: 'R', generation: 1 }, childId: 'K1', generation: 1, rootTaskPath: r.rootTaskPath, work: r.t.work, preview: true });
  const make = a => reuse.sideOf({ args: a, derived: deriveChild(a) });
  const old = make(args); assert.deepEqual(make(args), old, 'deterministic');
  assert.equal(old.node, 'R/M1'); assert.ok(old.scope.length > 0 && old.openQuestion.length > 0); assert.ok(old.acceptance.length >= 1); assert.ok(old.rootSections.length >= 1);
  const edit = f => { const b = JSON.parse(JSON.stringify(args.parent.block)); f(b.children.find(c => c.id === 'K1')); return { ...args, parent: { ...args.parent, block: b } }; };
  const scoped = make(edit(c => { c.scope = `${c.scope} (revised)`; }));
  const rs = one({ node: 'R/M1', slot: { node: 'R/M1', generation: 2 }, newSide: scoped, oldSide: old, old: { node: 'R/M1', generation: 1, runId: 'x' }, oldProblem: null, eligible: true, ineligibleWhy: null, wholeBranch: true });
  assert.equal(rs.verdict, 'changed'); assert.equal(rs.field, 'scope');
  const refined = make(edit(c => { c.obligations = c.obligations.length ? c.obligations.map(o => `${o} Also.`) : ['A new refinement.']; }));
  assert.equal(one({ node: 'R/M1', slot: { node: 'R/M1', generation: 2 }, newSide: refined, oldSide: old, old: { node: 'R/M1', generation: 1, runId: 'x' }, oldProblem: null, eligible: true, ineligibleWhy: null, wholeBranch: true }).field, 'refinements');
  assert.equal(one({ node: 'R/M1', slot: { node: 'R/M1', generation: 2 }, newSide: make(args), oldSide: old, old: { node: 'R/M1', generation: 1, runId: 'x' }, oldProblem: null, eligible: true, ineligibleWhy: null, wholeBranch: true }).verdict, 'same', 'unchanged: same (known-bad control)');
});

test('RU-9 the LOADER verifies the OLD side against what the old child REGISTERED: an untouched registered child is verified (known-bad control); an edited bundle file, an edited obligation map in the record, or a bundle folder that is gone is `old inputs cannot be verified` with the reason', async () => {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r), maxStarts: 1 });
  assert.ok(out.started.length >= 1, JSON.stringify(out));
  const record = readTreeRecord(r.t.rootDir); const state = stateOf(record);
  const reg = record.events.find(e => e.event === 'node_registered' && e.node === 'R/M1');
  const ok = loader.verifyOldChild({ rootDir: r.t.rootDir, work: r.t.work, rootTaskPath: join(r.t.work, 'tasks', 'x.md'), oldParent: { node: 'R', generation: 1 }, node: 'R/M1', generation: 1 });
  assert.equal(ok.problem, null, JSON.stringify(ok)); assert.equal(ok.side.node, 'R/M1'); assert.equal(ok.old.runId, reg.runId);
  const ctx = join(bundleDirOf(r.t.rootDir, 'R/M1', 1), 'context.md'); const before = readFileSync(ctx, 'utf8');
  writeFileSync(ctx, `${before}\nSneaked in.\n`);
  const edited = loader.verifyOldChild({ rootDir: r.t.rootDir, work: r.t.work, rootTaskPath: join(r.t.work, 'tasks', 'x.md'), oldParent: { node: 'R', generation: 1 }, node: 'R/M1', generation: 1 });
  assert.match(edited.problem ?? '', /bundle/); assert.equal(edited.side, null, 'an unverified old side is not offered for comparison');
  writeFileSync(ctx, before);
  assert.equal(loader.verifyOldChild({ rootDir: r.t.rootDir, work: r.t.work, rootTaskPath: join(r.t.work, 'tasks', 'x.md'), oldParent: { node: 'R', generation: 1 }, node: 'R/M1', generation: 1 }).problem, null, 'restored: verified again');
  const missing = loader.verifyOldChild({ rootDir: r.t.rootDir, work: r.t.work, rootTaskPath: join(r.t.work, 'tasks', 'x.md'), oldParent: { node: 'R', generation: 1 }, node: 'R/M2', generation: 1 });
  assert.match(missing.problem ?? '', /not registered|no such/, 'a node the record never registered has nothing to verify');
  assert.ok(state.nodes.has('R/M1@g1'));
});

test('RU-10 `loadChildren` lines the new split\'s children up with their old nodes, providers before consumers, and takes ELIGIBILITY from a predicate the caller hands in (A\'s `ineligibleBelowRoot`: one predicate, no second list); it never reads a thing it was not given a path to', async () => {
  const r = await trackedRealRoot(splitChildren()); approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  const rootTaskPath = join(r.t.work, 'tasks', 'x.md');
  const asks = [];
  // the "new" split here is R@g1's own split (the only one this fixture has): every child compares SAME with itself, which is the whole point of the control
  const rows = loader.loadChildren({ rootDir: r.t.rootDir, work: r.t.work, rootTaskPath, newParent: { node: 'R', generation: 1 }, oldParent: { node: 'R', generation: 1 }, slotGeneration: 2, eligibility: key => { asks.push(key); return { eligible: true, why: null }; }, wholeBranch: () => true });
  assert.ok(rows.length >= 2, `children: ${rows.length}`); assert.ok(rows.some(c => c.newSide.expects.length > 0), 'the fixture has a CONSUMER: the full-derivation provider branch is exercised'); assert.ok(rows.every(c => c.slot.generation === 2 && c.old && c.oldProblem === null), JSON.stringify(rows.map(c => [c.node, c.oldProblem])));
  const order = rows.map(c => c.node); for (const c of rows) for (const p of c.newSide.expects) assert.ok(order.indexOf(p) < order.indexOf(c.node), `${p} before ${c.node}`);
  assert.ok(asks.length >= rows.length && asks.every(k => /^R\/\w+@g1$/.test(k)), `the predicate is asked per old node key: ${asks.join(',')}`);
  const verdicts = reuse.compareChildren({ children: rows, ambiguousKeys: loader.newRootAmbiguousKeys({ rootDir: r.t.rootDir, newParent: { node: 'R', generation: 1 } }) }); assert.ok(verdicts.every(v => v.verdict === 'same'), JSON.stringify(verdicts.map(v => [v.node, v.field, v.reason])));
  const none = loader.loadChildren({ rootDir: r.t.rootDir, work: r.t.work, rootTaskPath, newParent: { node: 'R', generation: 1 }, oldParent: { node: 'R', generation: 1 }, slotGeneration: 2, eligibility: () => ({ eligible: false, why: 'A says no' }), wholeBranch: () => true });
  assert.ok(reuse.compareChildren({ children: none, ambiguousKeys: [] }).every(v => v.field === 'ineligible' && /A says no/.test(v.reason)));
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- fix-up: the old side is what the old child RAN ON
// C&C's ruling on 87f0ce2: "every F-field on the OLD side must come from bytes the old child actually ran on, or the verdict is `changed: old inputs cannot be verified`". The seam is `derive` (default `deriveChild`): a
// rendering change in deriveChild (how scope, agreements or the carried text are WRITTEN) leaves the obligation map and criteria.json equal and the bundle folder untouched, so only a byte comparison of the rendered files
// with the registered ones can see it. The parts the contract excludes (3, 4, 5, 7: the providers' text, the parent plan, the parent's criteria, the decisions) are NOT compared.
const rendersAs = edit => a => { const d = deriveChild(a); return d.files ? { ...d, files: edit(d.files) } : d; };
const part = (text, n) => text.replace(new RegExp(`(## ${n}\\. [^\\n]*\\n\\n)`), '$1RENDERED DIFFERENTLY. ');

test('RU-11 a RENDERING change in deriveChild is caught: task.md (scope, open question) and context parts 1 (the entry: agreements), 2 (root sections) and 6 (carried) are compared byte for byte with the registered bundle; parts 3, 4, 5 and 7 are not (known-bad: 87f0ce2 said `same` for every row here)', async () => {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r), maxStarts: 1 });
  const base = { rootDir: r.t.rootDir, work: r.t.work, rootTaskPath: join(r.t.work, 'tasks', 'x.md'), oldParent: { node: 'R', generation: 1 }, node: 'R/M1', generation: 1 };
  assert.equal(loader.verifyOldChild(base).problem, null, 'untouched: verified (control)');
  const must = {
    'task.md (scope line)': f => ({ ...f, 'task.md': f['task.md'].replace(/^Scope: /m, 'Scope: REWORDED ') }),
    'task.md (open question)': f => ({ ...f, 'task.md': f['task.md'].replace(/^Open question: /m, 'Open question: REWORDED ') }),
    'criteria.json': f => ({ ...f, 'criteria.json': f['criteria.json'].replace('"', '" ') }),
    'context part 1 (the entry)': f => ({ ...f, 'context.md': part(f['context.md'], 1) }),
    'context part 2 (root sections)': f => ({ ...f, 'context.md': part(f['context.md'], 2) }),
    'context part 6 (carried)': f => ({ ...f, 'context.md': part(f['context.md'], 6) }),
  };
  for (const [name, edit] of Object.entries(must)) {
    const v = loader.verifyOldChild({ ...base, derive: rendersAs(edit) });
    assert.match(v.problem ?? '', /rendered|render/, `${name}: ${JSON.stringify(v)}`); assert.equal(v.side, null, name);
    const row = one(child({ oldSide: null, old: v.old, oldProblem: v.problem })); assert.equal(row.verdict, 'changed'); assert.match(row.reason, /^changed: old inputs cannot be verified: the earlier derivation no longer renders /, 'the verdict C&C named');
  }
  for (const n of [3, 4, 5, 7]) {
    const v = loader.verifyOldChild({ ...base, derive: rendersAs(f => ({ ...f, 'context.md': part(f['context.md'], n) })) });
    assert.equal(v.problem, null, `part ${n} is excluded by the contract: ${JSON.stringify(v)}`);
  }
});

test('RU-12 the context splitter finds deriveChild\'s OWN seven headings, each exactly once and in order, and is not fooled by numbered headings QUOTED inside a part (known-bad: a quoted `## 1. Overview` made the line-start splitter hand back a slice of part 4 as part 1); a quoted copy of a real heading line fails closed', async () => {
  const r = await realRoot();
  const args = loadDerivation({ rootDir: r.t.rootDir, parentRef: { node: 'R', generation: 1 }, childId: 'K1', generation: 1, rootTaskPath: r.rootTaskPath, work: r.t.work, preview: false });
  const text = deriveChild(args).files['context.md'];
  const real = loader.contextParts(text); assert.ok(real, 'a real context splits'); assert.deepEqual([...real.keys()], [1, 2, 3, 4, 5, 6, 7]);
  assert.match(real.get(1), /^## 1\. The child's entry in the signed split\n/); assert.equal([...real.values()].join(''), text.slice(text.indexOf('## 1. ')), 'the parts tile the text after the title');
  // a quoted model-written plan section that carries numbered headings of its own (common): inside part 4's piece
  const quoted = text.replace(/(## 4\. [^\n]*\n\n)/, '$1----- parent plan, quoted -----\n## 1. Overview\nsome text\n## 2. Scope\n## 6. Risks\n----- end -----\n\n');
  assert.notEqual(quoted, text);
  const q = loader.contextParts(quoted); assert.ok(q, 'quoted headings that are not deriveChild\'s own do not break the split');
  assert.match(q.get(1) ?? '', /^## 1\. The child's entry in the signed split\n/, 'part 1 is still the real entry'); assert.equal(q.get(1), real.get(1)); assert.equal(q.get(2), real.get(2)); assert.equal(q.get(6), real.get(6));
  assert.ok(q.get(4).includes('## 1. Overview'), 'the quoted lines stay inside part 4');
  // a quoted copy of one of the real heading lines is ambiguous: no split at all
  assert.equal(loader.contextParts(text.replace(/(## 4\. [^\n]*\n\n)/, '$1## 6. Obligations carried in context only, and checks the harness cannot enforce\n')), null);
  assert.equal(loader.contextParts('# Context\n\n## 1. The child\'s entry in the signed split\n\nx\n'), null, 'a missing heading is no split either');
  // and through the verifier: the duplicate heading makes the old side unverifiable
  const t2 = await trackedRealRoot(pricedChildren()); approvePending(t2); await runTree(t2.t.rootDir, { work: t2.t.work, startRun: draftStarter(t2), maxStarts: 1 });
  const v = loader.verifyOldChild({ rootDir: t2.t.rootDir, work: t2.t.work, rootTaskPath: join(t2.t.work, 'tasks', 'x.md'), oldParent: { node: 'R', generation: 1 }, node: 'R/M1', generation: 1, derive: rendersAs(f => ({ ...f, 'context.md': f['context.md'].replace(/(## 4\. [^\n]*\n\n)/, '$1## 6. Obligations carried in context only, and checks the harness cannot enforce\n') })) });
  assert.match(v.problem ?? '', /context/, JSON.stringify(v));
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- C1-b (C&C's go on the identity-map reader survey, S8-9_Identity_Map_Reader_Survey.md)
// The comparison of F4/F5 is NOT touched here (finding 3, text only or the whole form, is Muad's call and is isolated in `formOf` in src/tree-reuse.js). What changes: the map carries the WHOLE `to` identity (an identity rebuilt by swapping
// two fields would keep the old raw `form` and a different obligationKey), it covers the CARRIED items too (they are what heldOf reads), and an item the NEW ROOT lists more than once makes every child inheriting it `changed`.
test('RU-13 the identity map carries the WHOLE `to` identity, not labels: each entry is { from: "R@g1:C2", to: <the new side\'s identity object, byte for byte> } (known-bad at 5021d96: `to` was a label string)', () => {
  const nw = side({ acceptance: [acc('The store keeps every record.', 2, 'C5'), acc('Reads are fast.', 2, 'C6')], carried: [carr('Keep a log.', 2, 'G9')] });
  const r = one(child({ newSide: nw }));
  assert.equal(r.verdict, 'same', JSON.stringify(r));
  const byFrom = new Map(r.identityMap.map(m => [m.from, m.to]));
  assert.deepEqual(byFrom.get('R@g1:C1'), nw.acceptance[0].identity); assert.deepEqual(byFrom.get('R@g1:C2'), nw.acceptance[1].identity);
  assert.equal(typeof byFrom.get('R@g1:C1'), 'object');
  // the raw form travels with the identity: a whitespace-only difference is `same`, and the map's `to` is the NEW copy's own identity
  const spaced = side({ acceptance: [{ ...acc('The  store keeps every record.', 2, 'C5'), identity: { ...idOf('The  store keeps every record.', 2, 'C5'), textSha256: idOf('The store keeps every record.', 2, 'C5').textSha256 } }, acc('Reads are fast.', 2, 'C6')], carried: [carr('Keep a log.', 2, 'G9')] });
  const r2 = one(child({ newSide: spaced })); assert.equal(r2.verdict, 'same', JSON.stringify(r2));
  assert.equal(new Map(r2.identityMap.map(m => [m.from, m.to])).get('R@g1:C1').form, 'The  store keeps every record.', 'the new copy\'s raw form, not the old one');
});

test('RU-14 the map covers the CARRIED items too (guard-refused, context-only, check_not_enforced), paired by { originNode, originClass, textSha256 }; an own refinement with no identity needs no entry; a duplicated carried key is ambiguous (known-bad at 5021d96: no carried entries at all)', () => {
  const oldC = [carr('Keep a log.', 1, 'G1'), carr('Run the linter.', 1, 'G2', { reason: 'check_not_enforced', check: 'npm run lint', on: 'build' }), { reason: 'guard_refused', guard: 'metaCriteria', originClass: null, text: 'be good', check: null, on: null, key: null, from: null, identity: null }];
  const newC = [carr('Keep a log.', 2, 'G7'), carr('Run the linter.', 2, 'G8', { reason: 'check_not_enforced', check: 'npm run lint', on: 'build' }), oldC[2]];
  const r = one(child({ oldSide: side({ carried: oldC }), newSide: side({ carried: newC }) }));
  assert.equal(r.verdict, 'same', JSON.stringify(r));
  const carriedEntries = r.identityMap.filter(m => ['R@g1:G1', 'R@g1:G2'].includes(m.from));
  assert.deepEqual(carriedEntries.map(m => [m.from, m.to.originId]).sort(), [['R@g1:G1', 'G7'], ['R@g1:G2', 'G8']]);
  assert.equal(r.identityMap.some(m => m.from === null || m.to === null), false, 'an entry with no identity is not mapped');
  const dupNew = [carr('Keep a log.', 2, 'G7'), carr('Keep a log.', 2, 'G7b')];
  const a = one(child({ oldSide: side({ carried: [carr('Keep a log.', 1, 'G1')] }), newSide: side({ carried: dupNew }) }));
  assert.equal(a.verdict, 'changed'); assert.equal(a.field, 'carried'); assert.match(a.reason, /ambiguous/);
});

test('RU-15 the ambiguity check runs over the NEW ROOT\'S WHOLE list: child A\'s new side holds the criterion as R@g2:C3 and child B\'s as R@g2:C7 (both from R@g1:C2); each looks clean alone and the shared table would hold TWO answers for one `from` - so both are `changed` once the new root\'s duplicate key is passed (known-bad at 5021d96: both said `same`)', () => {
  const kid = (node, milestone, newId) => child({ node, slot: { node, generation: 2 }, old: { node, generation: 1, runId: node }, oldSide: side({ node, milestone, acceptance: [acc('Reads are fast.', 1, 'C2')] }), newSide: side({ node, milestone, acceptance: [acc('Reads are fast.', 2, newId)] }) });
  const kids = [kid('R/M1', 'M1', 'C3'), kid('R/M2', 'M2', 'C7')];
  const dupKey = canonicalJson({ originClass: 'delegated', originNode: 'R', textSha256: KEY('Reads are fast.').textSha256 });
  const control = reuse.compareChildren({ children: kids, ambiguousKeys: [] });
  assert.deepEqual(control.map(r => r.verdict), ['same', 'same'], 'control: with no key passed each child looks clean');
  const answers = control.map(r => r.identityMap.find(m => m.from === 'R@g1:C2').to.originId);
  assert.deepEqual(answers, ['C3', 'C7'], 'THE HAZARD, shown: one `from`, two different `to`s across the two rows');
  const rows = reuse.compareChildren({ children: kids, ambiguousKeys: [dupKey] });
  assert.deepEqual(rows.map(r => r.verdict), ['changed', 'changed']); assert.ok(rows.every(r => r.field === 'acceptance' && /ambiguous/.test(r.reason) && /new root plan lists/.test(r.reason)), JSON.stringify(rows.map(r => r.reason)));
  const lone = reuse.compareChildren({ children: [child({ newSide: side({ acceptance: [acc('The store keeps every record.', 1, 'C1')] }), oldSide: side({ acceptance: [acc('The store keeps every record.', 1, 'C1')] }) })], ambiguousKeys: [dupKey] });
  assert.equal(lone[0].verdict, 'same', 'a child that does not inherit the duplicated item is untouched');
  assert.throws(() => reuse.compareChildren({ children: kids }), /ambiguousKeys/, 'the check cannot be silently off: the keys are required (as the loader requires `eligibility`)');
});

test('RU-15b `duplicateKeysOf` (pure): a key listed twice is returned once, in the canonical form compareChildren takes; a list without repeats gives none', () => {
  const k = t => ({ originNode: 'R', originClass: 'delegated', textSha256: KEY(t).textSha256 });
  assert.deepEqual(reuse.duplicateKeysOf?.([k('Reads are fast.'), k('Reads are fast.'), k('Other.')]), [canonicalJson({ originClass: 'delegated', originNode: 'R', textSha256: KEY('Reads are fast.').textSha256 })]);
  assert.deepEqual(reuse.duplicateKeysOf?.([k('A.'), k('B.')]), []);
});

test('RU-16 the LOADER\'s keys are the keys `sideOf` makes (known-bad: a class read differently from deriveChild\'s would match nothing and leave the check silently off): on a real root every acceptance key of a real derived child appears among `newRootKeys`; an ordinary root has no ambiguous key; a hand-built list with a repeated criterion yields its key', async () => {
  const r = await realRoot();
  const args = loadDerivation({ rootDir: r.t.rootDir, parentRef: { node: 'R', generation: 1 }, childId: 'K1', generation: 1, rootTaskPath: r.rootTaskPath, work: r.t.work, preview: true });
  const sd = reuse.sideOf({ args, derived: deriveChild(args) });
  const all = loader.newRootKeys?.({ rootDir: r.t.rootDir, newParent: { node: 'R', generation: 1 } }) ?? [];
  const have = new Set(all.map(k => canonicalJson({ originNode: k.originNode, originClass: k.originClass, textSha256: k.textSha256 })));
  const inherited = sd.acceptance.filter(a => a.identity.originNode === 'R'); assert.ok(inherited.length >= 1, 'the child inherits at least one root criterion');
  for (const a of inherited) assert.ok(have.has(canonicalJson(a.key)), `the loader's key for ${a.from} equals sideOf's`);
  assert.deepEqual(loader.newRootAmbiguousKeys?.({ rootDir: r.t.rootDir, newParent: { node: 'R', generation: 1 } }), [], 'an ordinary root lists nothing twice');
  const forms = ['Reads are fast.', 'Reads are fast.', 'Other.'].map((form, i) => ({ id: `C${i + 1}`, form }));
  assert.equal(loader.ambiguousKeysOfItems?.({ items: forms, classOf: () => 'delegated' })?.length, 1);
});

test('RU-17 the F4/F5 comparison is the WHOLE criterion form (Muad, 12 Oct 2026: "Redo" - a criterion with the same wording but a changed check counts as CHANGED): `formOf` takes the form and compares text, kind, check and `on`, each whitespace-collapsed; a string and an object with no check are the same item; known-bad at 50bb081: the text-only reading said `same` for a changed check', () => {
  const obj = { criterion: 'Reads are fast.', kind: 'checkable', check: 'npm test', on: 'build' };
  const f = reuse.formOf;
  assert.notEqual(f?.(obj), f?.({ ...obj, check: 'npm run other' }), 'a changed check differs');
  assert.notEqual(f?.(obj), f?.({ ...obj, kind: 'judgement' }), 'a changed kind differs'); assert.notEqual(f?.(obj), f?.({ ...obj, on: 'plan' }), 'a changed `on` differs');
  assert.notEqual(f?.(obj), f?.('Reads are fast.'), 'a checkable criterion is not the bare text');
  assert.equal(f?.(obj), f?.({ ...obj, criterion: '  Reads   are fast. ', check: 'npm  test' }), 'whitespace-only differences in the text or the check are the same');
  assert.equal(f?.({ criterion: 'Reads are fast.' }), f?.('Reads are fast.'), 'an object with no kind, check or on is its text');
  assert.equal(f?.('  Reads   are fast. '), 'Reads are fast.', 'a plain string reads as its collapsed text (the display form)');
  // through the comparison: the same wording with a changed check is `changed: acceptance list differs`, with both checks shown
  const a = { ...acc('Reads are fast.', 1, 'C2'), form: obj }; const b = { ...acc('Reads are fast.', 1, 'C2'), form: { ...obj, check: 'npm run other' } };
  const r = one(child({ oldSide: side({ acceptance: [a] }), newSide: side({ acceptance: [b] }) }));
  assert.equal(r.verdict, 'changed'); assert.equal(r.field, 'acceptance'); assert.match(r.oldText, /npm test/); assert.match(r.newText, /npm run other/);
  // and the same for a refinement
  const rf = one(child({ oldSide: side({ refinements: [obj] }), newSide: side({ refinements: [{ ...obj, check: 'npm run other' }] }) }));
  assert.equal(rf.verdict, 'changed'); assert.equal(rf.field, 'refinements');
  assert.equal(one(child({ oldSide: side({ acceptance: [a] }), newSide: side({ acceptance: [{ ...a, form: { ...obj, check: ' npm   test ' } }] }) })).verdict, 'same', 'control: the same check after whitespace collapse is the same item');
});

test('RU-19 under Reading F the per-child ambiguity test is KEY-based: two inherited items with the same wording and DIFFERENT checks share one key, so the identity map could not tell them apart - `changed: acceptance list is ambiguous` on its own, without the new root\'s keys (known-bad at e751666: both sides compared equal, said `same`, and the map pointed R@g1:C2 at the wrong item)', () => {
  const obj = c => ({ criterion: 'Reads are fast.', kind: 'checkable', check: c, on: 'build' });
  const two = gen => [{ ...acc('Reads are fast.', gen, gen === 1 ? 'C2' : 'C5'), form: obj('npm test') }, { ...acc('Reads are fast.', gen, gen === 1 ? 'C3' : 'C6'), form: obj('npm run other') }];
  const r = one(child({ oldSide: side({ acceptance: two(1) }), newSide: side({ acceptance: two(2) }) }));
  assert.equal(r.verdict, 'changed', JSON.stringify(r)); assert.equal(r.field, 'acceptance'); assert.match(r.reason, /ambiguous/);
});

test('RU-18 an item that is both an acceptance item and a check_not_enforced item enters the map ONCE (known-bad at 0651937: twice), with the same `to`', () => {
  const both = { ...carr('Run the linter.', 1, 'C4', { reason: 'check_not_enforced', check: 'npm run lint', on: 'build' }), originClass: 'delegated', key: KEY('Run the linter.'), identity: idOf('Run the linter.', 1, 'C4') };
  const bothNew = { ...both, from: 'R@g2:C9', identity: idOf('Run the linter.', 2, 'C9') };
  const oldS = side({ acceptance: [acc('Run the linter.', 1, 'C4')], carried: [both] }); const newS = side({ acceptance: [acc('Run the linter.', 2, 'C9')], carried: [bothNew] });
  const r = one(child({ oldSide: oldS, newSide: newS })); assert.equal(r.verdict, 'same', JSON.stringify(r));
  const entries = r.identityMap.filter(m => m.from === 'R@g1:C4'); assert.equal(entries.length, 1); assert.equal(entries[0].to.originId, 'C9');
});
