// CR-2E-003 + CR-AST-001 + CR-MAP-017 (the owner's decision, Muad 25 Okt 2026 14:45: "Yes to all" on Astra's decision list, Q1 = A + X + a restricted B; C&C's ruling on the headingless root task, 25 Okt 2026): how a child's context_refs
// resolve. ONE resolver (src/tree-derive.js resolveContextRefs) serves the verification of a split and the derivation of a child. Pure ($0, no model, no run): deriveChild on in-memory data.
//   restricted B: a reference without "root-task:" / "parent-plan:" resolves only when exactly ONE heading of that text exists across the root task and this plan; anything else refuses and names both counts.
//   X: every exclusions section of the root task is supplied by the harness, by POSITION (a heading twice is two sections), verbatim, once per byte range; it never counts as the goal (CR-AST-001).
//   headingless root task: a "root-task:" reference resolves to the whole file (C&C ruling: nothing is chosen, the whole file is supplied anyway); a bare reference that matches nothing still refuses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, sha256Of } from '../src/thin-contract.js';
import { DeriveRefusal, deriveChild, sectionOf } from '../src/tree-derive.js';
import { planWith, validBlock } from './helpers/split-fixture.js';

const clone = v => JSON.parse(JSON.stringify(v));
const ROOT_ID = '2026-10-08T11-00-00-000Z';
const doc = (name, text) => ({ name, text, sha256: sha256Of(text) });
const ROOT_TASK = doc('task.md', '# Goal\nBuild a small reading-list app.\n\n# Notes\nSome notes.\n\n# Non-goals\nNo mobile app.\n');
const CRITERIA = ['The plan names an owner for every step.', 'No step calls the network.', { criterion: 'Every step has a date.', kind: 'checkable', check: 'grep -c date plan.md', on: 'plan' }, 'The plan fits on one page.'];
const PREFIXED = [['root-task: Goal', 'root-task: Non-goals', 'parent-plan: Overview'], ['root-task: Goal', 'root-task: Non-goals', 'parent-plan: Overview'], ['root-task: Goal', 'root-task: Non-goals']];

function parentWith(refsK1, { all = PREFIXED, preface = 'REVISED MOCK DELIVERABLE\n\n' } = {}) {
  const block = validBlock();
  block.children.forEach((c, i) => { c.context_refs = clone(all[i]); });
  if (refsK1) block.children[0].context_refs = refsK1;
  const text = planWith(block, { preface });
  return { node: 'R', generation: 1, runId: ROOT_ID, items: CRITERIA.map((form, i) => ({ id: `C${i + 1}`, form })), obligations: null, block, blockSha256: sha256Of(canonicalJson(block)), plan: doc('deliverable.md', text) };
}
const PROVIDER_TEXT = '# Plan\n\n## Overview\nget(id) and put(record).\n\n## Other\nUnrelated.\n';
const THIN = sha256Of('thin-contract of K1');
const PROVIDERS = { K1: { node: 'R/M1', generation: 1, runId: '2026-10-08T11-20-00-000Z', thinContractSha256: THIN, pin: THIN, plan: doc('deliverable.md', PROVIDER_TEXT), descendants: [], resolutions: [] } };
const derive = (parent, childId = 'K1', rootTask = ROOT_TASK, providers = PROVIDERS) => deriveChild({ treeId: ROOT_ID, generation: 1, parent, childId, rootTask, childChain: { handoff: true, debate: true, kindsEnabled: false }, providers });
const part2 = d => { const c = d.files['context.md']; return c.slice(c.indexOf('## 2. '), c.indexOf('## 3. ')); };
const part4 = d => { const c = d.files['context.md']; return c.slice(c.indexOf('## 4. '), c.indexOf('## 5. ')); };
const refusal = fn => { try { fn(); } catch (e) { if (e instanceof DeriveRefusal) return e; throw e; } assert.fail('no refusal'); };
const countOf = (hay, needle) => hay.split(needle).length - 1;

test('restricted B: a bare heading that exactly one document holds exactly once resolves there and is labelled with its document; the exclusions are supplied by X', () => {
  const parent = parentWith(['Goal', 'Overview']);
  const d = derive(parent);
  const goal = sectionOf(ROOT_TASK.text, 'Goal').section;
  assert.ok(part2(d).includes(`----- root task task.md (sha256 ${ROOT_TASK.sha256}), heading "Goal" -----\n${goal}----- end -----`), part2(d));
  assert.ok(part2(d).includes(`heading "Non-goals" -----\n${sectionOf(ROOT_TASK.text, 'Non-goals').section}----- end -----`), 'X supplies the Non-goals section the split did not name');
  const plan = parent.plan;
  assert.ok(part4(d).includes(`----- parent plan deliverable.md (sha256 ${plan.sha256}), heading "Overview" -----\n${sectionOf(plan.text, 'Overview').section}----- end -----`), part4(d));
  assert.equal(countOf(d.files['context.md'], 'heading "Goal"'), 1, 'the goal section is copied once');
});

test('restricted B refuses an ambiguous or unknown bare heading and names both counts (no root-first guess); a prefixed reference to the same heading resolves', () => {
  const both = doc('task.md', '# Goal\nG.\n\n# Overview\nThe task\'s own overview.\n\n# Non-goals\nN.\n');
  const amb = refusal(() => derive(parentWith(['root-task: Goal', 'Overview']), 'K1', both));
  assert.equal(amb.code, 'missing_context');
  assert.match(amb.detail, /"Overview".*the root task holds that heading 1 time and this plan 1 time/, amb.detail);
  const none = refusal(() => derive(parentWith(['root-task: Goal', 'Nowhere'])));
  assert.match(none.detail, /"Nowhere".*the root task holds that heading 0 times and this plan 0 times/, none.detail);
  const d = derive(parentWith(['root-task: Goal', 'parent-plan: Overview']), 'K1', both);
  assert.ok(part4(d).includes('heading "Overview"') && !part2(d).includes('heading "Overview"'), 'the prefix decides');
});

test('X by POSITION (CR-MAP-017): a root task with "Out of scope" twice gives the child BOTH sections, each once, in document order, labelled with its occurrence; naming it explicitly changes nothing', () => {
  const task = doc('task.md', '# Goal\nShip two phases.\n\n# Phase 1\nFirst.\n\n## Out of scope\nNo export in phase 1.\n\n# Phase 2\nSecond.\n\n## Out of scope\nNo sync in phase 2.\n');
  const d = derive(parentWith(['root-task: Goal']), 'K1', task);
  const p = part2(d);
  const first = p.indexOf('heading "Out of scope" (occurrence 1 of 2) -----\n## Out of scope\nNo export in phase 1.\n\n----- end -----');
  const second = p.indexOf('heading "Out of scope" (occurrence 2 of 2) -----\n## Out of scope\nNo sync in phase 2.\n----- end -----');
  assert.ok(first > 0 && second > first, p);
  assert.equal(countOf(p, 'No export in phase 1.'), 1); assert.equal(countOf(p, 'No sync in phase 2.'), 1);
  const named = derive(parentWith(['root-task: Goal', 'root-task: Out of scope']), 'K1', task);
  assert.equal(named.files['context.md'], d.files['context.md'], 'an explicit reference to an exclusions heading is already covered: no single-heading lookup, no second copy');
});

test('X deduplicates by byte RANGE: an exclusions section inside a named section is not copied twice; a named section inside an exclusions section is not copied twice either', () => {
  const nested = doc('task.md', '# Goal\nBuild it.\n\n## Out of scope\nNo mobile app.\n\n# Notes\nN.\n');
  const d = derive(parentWith(['root-task: Goal']), 'K1', nested);
  assert.equal(countOf(part2(d), 'No mobile app.'), 1, part2(d));
  const inside = doc('task.md', '# Goal\nBuild it.\n\n# Non-goals\nNone of these:\n\n## Detail\nNo mobile app.\n');
  const e = derive(parentWith(['root-task: Goal', 'root-task: Detail']), 'K1', inside);
  assert.equal(countOf(part2(e), 'No mobile app.'), 1, part2(e));
});

test('CR-AST-001: a selection of exclusions sections only is refused (the harness supplies them anyway, and they never count as the goal); naming only plan sections is refused as before', () => {
  const r = refusal(() => derive(parentWith(['root-task: Non-goals', 'parent-plan: Overview'])));
  assert.equal(r.code, 'missing_context');
  assert.match(r.detail, /name only exclusions sections of the root task/, r.detail);
  assert.equal(refusal(() => derive(parentWith(['parent-plan: Overview']))).code, 'missing_context');
});

test('a HEADINGLESS root task (C&C ruling, 25 Okt 2026): a "root-task:" reference resolves to the whole file and the label says so; a bare reference that matches nothing still refuses', () => {
  const bare = doc('task.md', 'Just a paragraph of plain text,\nwith no headings at all.\n');
  const d = derive(parentWith(['root-task: Goal', 'parent-plan: Overview']), 'K1', bare);
  const p = part2(d);
  assert.ok(p.includes(`----- root task task.md (sha256 ${bare.sha256}), the whole file: it has no addressable headings (context_refs "root-task: Goal" resolve to it) -----\n${bare.text}----- end -----`), p);
  assert.equal(refusal(() => derive(parentWith(['Goal', 'parent-plan: Overview']), 'K1', bare)).code, 'missing_context', 'a bare "Goal" the plan does not hold either is refused');
});

test('[guard, not red] a split that is valid today derives BYTE-IDENTICAL bundles (bundle hashes computed at 943906f before the resolver)', () => {
  const p = parentWith(null);
  assert.deepEqual(['K1', 'K2', 'K3'].map(id => derive(p, id).bundleSha256), [
    'c530dcea6780d29160dd53eb97fc560943dd381ec8160f5db53a2e7501c21fc0',
    '48bc5a14c841f55a7d14340b8bcdd1e27a742d5a71dcd32e4321bba8287f8781',
    '02a6c0f242d40ffaeee5450c778ee632e41c9524bc9e987b7b3e30393cc386d3',
  ]);
});

test('D2 F2(a) + D3 F2-3: a refusal caused by a plan\'s own text names the node whose text failed (in memory, never recorded): the parent for its references, the provider for a promised heading, the descendant for its ready milestone\'s basis', () => {
  const ownerOf = fn => { const e = refusal(fn); return e.owner ?? null; };
  assert.deepEqual(ownerOf(() => derive(parentWith(['root-task: Goal', 'Nowhere']))), { node: 'R', generation: 1 }, 'a reference of the parent\'s split');
  const noHeading = { K1: { ...PROVIDERS.K1, plan: doc('deliverable.md', '# Plan\n\n## Store\nget and put.\n') } };
  assert.deepEqual(ownerOf(() => derive(parentWith(null), 'K2', ROOT_TASK, noHeading)), { node: 'R/M1', generation: 1 }, 'a provider_refs heading the provider does not hold (tree-derive.js:308)');
  const desc = text => ({ node: 'R/M1/A', generation: 1, runId: '2026-10-08T11-30-00-000Z', thinContractSha256: THIN, pin: THIN, plan: doc('deliverable.md', text), block: { milestones: [{ id: 'M1', status: 'ready', basis: 'Interface details', open_question: null }] } });
  const withDesc = text => ({ K1: { ...PROVIDERS.K1, descendants: [desc(text)] } });
  assert.deepEqual(ownerOf(() => derive(parentWith(null), 'K2', ROOT_TASK, withDesc('# A\n\n## Something else\nx.\n'))), { node: 'R/M1/A', generation: 1 }, 'a ready basis that names no heading (tree-derive.js:318)');
  assert.deepEqual(ownerOf(() => derive(parentWith(null), 'K2', ROOT_TASK, withDesc('# A\n\n## Interface details\nx.\n\n## Interface details\ny.\n'))), { node: 'R/M1/A', generation: 1 }, 'a basis heading twice (tree-derive.js:322)');
  const unpinned = { K1: { ...PROVIDERS.K1, pin: null } };
  assert.equal(ownerOf(() => derive(parentWith(null), 'K2', ROOT_TASK, unpinned)), null, 'a record cause (no pin) has no owner: no plan text can fix it');
});

test('LB-2 (ii) (C&C ruling, 25 Okt 2026): a root task whose ONLY headings are exclusions headings is given whole, like a headingless one; each of the reader\'s three variants derives (root-task: Non-goals, a plan section only, a bare "Non-goals") and the label names the case', () => {
  const onlyExcl = doc('task.md', 'Build X.\n\n## Non-goals\nNo Android.\n');
  const label = `----- root task task.md (sha256 ${onlyExcl.sha256}), the whole file: its only headings are exclusions headings`;
  const named = part2(derive(parentWith(['root-task: Non-goals', 'parent-plan: Overview']), 'K1', onlyExcl));
  assert.ok(named.includes(`${label} (context_refs "root-task: Non-goals" resolve to it) -----\n${onlyExcl.text}----- end -----`), named);
  for (const refs of [['parent-plan: Overview'], ['Non-goals', 'parent-plan: Overview']]) {
    const p = part2(derive(parentWith(refs), 'K1', onlyExcl));
    assert.ok(p.includes(`${label} -----\n${onlyExcl.text}----- end -----`), `${JSON.stringify(refs)}: ${p}`);
  }
  assert.match(refusal(() => derive(parentWith(['Goal', 'parent-plan: Overview']), 'K1', onlyExcl)).detail, /the root task holds that heading 0 times and this plan 0 times/, 'a bare reference that names no exclusions heading is looked up in the plan only, as for a headingless task');
});

test('LB-8: a heading whose own text starts with "#" is addressable ("# #hashtags" is "#hashtags"); heading marks followed by a space are still dropped, and "#Goal" with no space is not the heading "Goal"', () => {
  const tagged = doc('task.md', '# Goal\nBuild a small reading-list app.\n\n# #hashtags\nTag every entry.\n');      // sibling headings: a nested one would sit inside Goal's range and share its copy
  const p = part2(derive(parentWith(['root-task: Goal', 'root-task: #hashtags', 'parent-plan: Overview']), 'K1', tagged));
  assert.match(p, /heading "#hashtags" -----\n# #hashtags\nTag every entry\.\n/, p);
  assert.match(part2(derive(parentWith(['root-task: ## Goal', 'parent-plan: Overview']), 'K1', tagged)), /heading "Goal" -----\n# Goal\n/);
  assert.match(refusal(() => derive(parentWith(['root-task: #Goal', 'parent-plan: Overview']), 'K1', tagged)).detail, /the heading "#Goal" must exist exactly once, found 0/);
});
