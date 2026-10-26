// 0.8.3 M6 X4 unit (13 Oct 2026): the approve screen of a root re-plan says which root plan the held nodes hang under. PURE render tests of src/tree-stop.js renderFrontierText on a root_replan view (the real flow is in test/tree-held-release.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderFrontierText } from '../src/tree-stop.js';

const view = (extra = {}) => ({ kind: 'root_replan', frontierKey: 'a'.repeat(64), rootId: 'rid', generation: 3, previous: { generation: 2, runId: 'run-2' }, openedBy: [{ id: 'e9', text: 'Plan it again.' }], taskHash: 'abc123def456',
  child: { chain: { name: 'c', figures: null }, grant: 4, ceiling: 4, admitted: true, notAdmittedReason: null, mayStop: false, refusedLimit: null }, setAside: 1, held: 1, heldEras: [2],
  budget: { rootCapUsd: 100, spentUsd: 1, heldUsd: 0, availableUsd: 99 }, limits: [], ...extra });
const heldLine = v => renderFrontierText(v).split('\n').find(l => /finished nodes? (is|are) held/.test(l));
// EDITED 18 Okt 2026 (C2a-record K2, B-DRAFT). OLD tail: "...they stay held until you approve the new root plan's children, and are replaced then (checking them for reuse comes in a later step)." NEW: the false clause "and are replaced then" is dropped (approving the children passes the held nodes over, it replaces nothing); the "later step" tail stays for C3 (E130/E21).
const TAIL = "they stay held until you approve the new root plan's children (checking them for reuse comes in a later step).";

test('the held line: held under the plan being replaced = the old sentence, unchanged (also when the view has no heldEras: fixtures from before X4)', () => {
  assert.equal(heldLine(view()), `1 finished node is held below the earlier plan; ${TAIL}`);
  assert.equal(heldLine(view({ heldEras: undefined })), `1 finished node is held below the earlier plan; ${TAIL}`);
  assert.equal(heldLine(view({ held: 2 })), `2 finished nodes are held below the earlier plan; ${TAIL}`);
});

test('the held line: held under an OLDER root plan names it and says it is not the plan being replaced (the old text read as if the node hung under R@g2)', () => {
  assert.equal(heldLine(view({ heldEras: [1] })), `1 finished node is held below the earlier root plan R@g1 (not below R@g2, the plan being replaced); ${TAIL}`);
  assert.equal(heldLine(view({ held: 2, heldEras: [1] })), `2 finished nodes are held below the earlier root plan R@g1 (not below R@g2, the plan being replaced); ${TAIL}`);
});

test('the held line: held under SEVERAL plans, the replaced one among them, names them all and does not contradict itself (reachable once the per-frontier release lands; B checks this line then)', () => {
  assert.equal(heldLine(view({ held: 2, heldEras: [1, 2] })), `2 finished nodes are held below the earlier root plans R@g1 and R@g2; ${TAIL}`);
  assert.equal(heldLine(view({ held: 2, heldEras: [1, 3] })), `2 finished nodes are held below the earlier root plans R@g1 and R@g3 (not below R@g2, the plan being replaced); ${TAIL}`);
  assert.equal(renderFrontierText(view({ held: 0, heldEras: [] })).includes('held below'), false, 'no held node: no line');
});

// X4 fix-up (14 Oct 2026, C&C's owed line): a held node whose root plan the record cannot identify is never dropped from the sentence while `held` still counts it (it cannot happen for a node heldKeys holds, which skips a null era; the screen must not rely on that)
test('the held line: a node whose root plan is unknown is COUNTED and said to be unidentified (never named as the replaced plan, never dropped)', () => {
  assert.equal(heldLine(view({ heldEras: [], heldUnknown: 1 })), `1 finished node is held below an earlier root plan (the record does not say which one); ${TAIL}`);
  assert.equal(heldLine(view({ held: 2, heldEras: [1], heldUnknown: 1 })), `2 finished nodes are held below the earlier root plan R@g1 (and, for 1 of them, a root plan the record does not identify); ${TAIL}`);
  assert.equal(heldLine(view({ held: 2, heldEras: [2], heldUnknown: 1 })), `2 finished nodes are held below the earlier root plan R@g2 (and, for 1 of them, a root plan the record does not identify); ${TAIL}`);
  assert.equal(heldLine(view({ heldUnknown: 0 })), `1 finished node is held below the earlier plan; ${TAIL}`, 'no unknown: the sentence is as before');
});
