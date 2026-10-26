// ROADMAP 83 (C&C thcmcp-6d ruling c, 20 Okt 2026): a tree treats an early-finished member exactly like a member the person finished with --finish-node. The tree's reader of a closed member (closedFieldsOf) reads passed and the
// handoff Status, never `stop`, so the two fold the same: outcome not_passed, passed false, the same share. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closedFieldsOf } from '../src/tree-member.js';

const fold = (stop, status) => {
  const dir = mkdtempSync(join(tmpdir(), 'ef-tree-'));
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ runId: 'r', passed: false, outcome: 'no_consensus', stop }));
  writeFileSync(join(dir, 'HANDOFF.md'), `Status: ${status}\n\n## Summary\n\nBuild it.\n\n## Builder tasks left open at the early finish\n\n- BT-1 (O-aaaaaaaa, raised by la; still open): c - p\n`);
  return closedFieldsOf(dir);
};
const EARLY = { kind: 'early_finish', pass: 2, overseer_round: 1, chosen: 'early', items: [{ id: 'O-aaaaaaaa', lab: 'la', handled: 'open' }], overseer: ['lc'] };
const FINISH = { kind: 'overseer_cap', pass: 2, overseer_round: 1, rounds: 1, cap: 1, chosen: 'finish' };

test('EF-T1: an early-finished member folds into the tree exactly like a finish-node member, for both handoff Status values', () => {
  for (const status of ['ready_for_build', 'needs_decision']) {
    const early = fold(EARLY, status); const finish = fold(FINISH, status);
    assert.deepEqual(early, finish, `status ${status}`);
    assert.deepEqual({ outcome: early.outcome, passed: early.passed, status: early.status, share: early.share }, { outcome: 'not_passed', passed: false, status, share: status === 'needs_decision' ? 'revoked' : 'released' });
  }
});
