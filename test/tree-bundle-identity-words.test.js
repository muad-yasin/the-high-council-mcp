// 0.8.3 M7 apply, group 6 (E82): the words of a bundle-identity refusal, pure (no folder is read: with no bundle hash on record the first comparison is skipped and node.json's pointer is what is compared).
// A node.json that names a bundle while the record holds no bundle hash used to print a hash called "none"; it now says no hash is recorded. A sub-plan is told to restore the files to what was recorded for it or close the node; the root, which cannot be closed, is told to restore the files and otherwise start a new tree (B-DRAFT join).
import test from 'node:test';
import assert from 'node:assert/strict';
import { bundleIdentityRefusal } from '../src/tree-continuation.js';

const refusal = (node, generation) => bundleIdentityRefusal({ rootDir: '/runs/2026-10-08T11-00-00-000Z', node: { node, generation, phase: 'registered' }, registered: {}, lineage: { bundleSha256: 'a'.repeat(64) } });

test('E82: node.json names a bundle but the record holds no bundle hash: the sentence says no hash is recorded (it does not print a hash called "none"), and the way out is restore-or-close for a sub-plan', () => {
  const r = refusal('R/M1', 1);
  assert.equal(r.check, 'bundle');
  assert.equal(r.detail, 'R/M1@g1: its node.json names the bundle aaaaaaaaaaaa; no bundle hash is recorded for it. Restore the bundle\'s files to what was recorded for it, or close the node: `council tree decide 2026-10-08T11-00-00-000Z --close R/M1@g1`.');
  assert.equal(r.detail.includes('none'), false);
});

test('E82: for the root, which cannot be closed, the way out keeps the restore route (C&C 18 Okt: a $0 restore exists where a new tree is paid) before the start-a-new-tree sentence', () => {
  const r = refusal('R', 2);
  assert.equal(r.detail, 'R@g2: its node.json names the bundle aaaaaaaaaaaa; no bundle hash is recorded for it. Restore the bundle\'s files to what was recorded for it. The root cannot be closed: start a new tree with `council tree start`.');
});
