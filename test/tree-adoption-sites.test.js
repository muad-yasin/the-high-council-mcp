// 0.8.3 M7 apply, C2b-1 (plan + gate answer: Review/Build_0.8.3/m7/C2b_Plan_2026-10-18.md; C&C thcmcp-6d: split accepted, the per-site red/kept table leads the report). The PREDICATE sites of the path-newest idioms (K4) move onto the adopted-aware
// predicate, each with a row on a REAL record: every event goes through the real table (appendTreeEvent / registerChildUnchecked), the adoption is a preview with a `reused` entry and its approval (the K8 table), and the readers are the REAL readers. Nothing in src/ writes
// `reused` yet (C2b-2), so the adoption is hand-written through the table, as in test/tree-adoption-rules.test.js; what these rows prove is that a reader asked about the ADOPTED node (R/M1/A@g1, live beside the new R/M1/A@g2 of its path) answers as for a live node.
// The sites that are keyed by PATH (a Map or a list with one entry per path) are NOT moved here and have no row: BASELINE in test/tree-supersession-guard.test.js keeps them with the reason. $0, no run is started.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pendingBlockedChildren } from '../src/tree-blocked-child.js';
import { continuationRefusal } from '../src/tree-continuation.js';
import { gatherReadinessFacts } from '../src/tree-ready.js';
import { gatherHandoffFacts } from '../src/tree-handoff.js';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { adoptedTree } from './helpers/adoption-fixture.js';

test('C2b-1 pendingBlockedChildren: a closed ADOPTED node that the readiness verdict blocks gets its stop like any live node, and a node that is really replaced (R/M1@g1) still does not (site: tree-blocked-child.js)', () => {
  const { t } = adoptedTree();
  const record = readTreeRecord(t.rootDir); const state = stateOf(record);
  const reason = scope => ({ severity: 'blocked', code: 'x_blocked', scope, text: 'blocked' });
  const got = pendingBlockedChildren(record, state, { reasons: [reason('R/M1/A@g1'), reason('R/M1@g1')] });
  assert.deepEqual(got.map(g => `${g.node}@g${g.generation}`), ['R/M1/A@g1'], 'the adopted node is listed; the replaced one is not');
});

test('C2b-1 gatherReadinessFacts: a consumer registered against the ADOPTED provider keeps the provider it was pinned to (newestGeneration 1, not the 2 of the new node of the path) (site: tree-ready.js providers)', () => {
  const { t } = adoptedTree();
  const facts = gatherReadinessFacts(t.rootDir, { work: t.work });
  const c = facts.nodes.find(n => n.node === 'R/M1/C');
  assert.ok(c, 'R/M1/C is a live node of the facts');
  assert.deepEqual(c.providers.map(p => ({ node: p.node, boundGeneration: p.boundGeneration, newestGeneration: p.newestGeneration })), [{ node: 'R/M1/A', boundGeneration: 1, newestGeneration: 1 }]);
});

test('C2b-1 continuationRefusal: a consumer registered against the ADOPTED provider is not refused for "provider has a newer generation" (site: tree-continuation.js provider pin)', () => {
  const { t, regC } = adoptedTree();
  const record = readTreeRecord(t.rootDir); const state = stateOf(record);
  const node = state.nodes.get('R/M1/C@g2');
// CHANGED ACCEPTED (already-false unit, Q3; C&C thcmcp-cd 24 Okt 2026): continuationRefusal now REFUSES a null `chainPath` when the node registered a chain hash (it used to skip the chain check). OLD: `chainPath: null`. NEW: the chain file of this fixture's registered chain (the file whose hash the registration holds), so the chain check really runs and passes. WHY: a null path with a registered hash is now a refusal; the test is about the check that FOLLOWS the chain check, which must still be reached.
  const chainPath = [join(t.work, 'chains', `${regC.chain.name}.json`), join(dirname(fileURLToPath(import.meta.url)), '..', 'chains', `${regC.chain.name}.json`)].find(existsSync);
  assert.ok(chainPath, 'the fixture\'s registered chain has a file');
  const out = continuationRefusal({ rootDir: t.rootDir, record, state, node, registered: regC, chainPath, work: t.work, deps: { ancestorCheck: () => null } });
  assert.equal(out, null, JSON.stringify(out));
});

test('C2b-1 gatherHandoffFacts: the ADOPTED node is not listed as replaced, while the node that is really replaced (R/M1@g1) is (site: tree-handoff.js replaced list)', () => {
  const { t } = adoptedTree();
  const facts = gatherHandoffFacts(t.rootDir, { work: t.work });
  const replaced = facts.replaced.map(r => `${r.node}@g${r.generation}`);
  assert.ok(replaced.includes('R/M1@g1'), `control: a replaced node is listed (${replaced.join(', ')})`);
  assert.ok(!replaced.includes('R/M1/A@g1'), `the adopted node is live, not replaced (${replaced.join(', ')})`);
});
