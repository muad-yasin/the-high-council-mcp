// A tree whose ROOT run really ran (all-mock, $0) on a plan that carries a valid split block, and whose split is verified (a `split_verified` record): the state `council tree approve` starts from. Shared by the approve
// tests; the same helper lives inline in test/tree-derive.test.js (M4). Not a test file.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as api from '../../src/api.js';
import { registerRoot } from '../../src/tree-register.js';
import { verifySplit } from '../../src/tree-expansion.js';
import { ROOT_ID, newTree, rootOpts } from './tree-fixture.js';
import { block3, planWith } from './split-fixture.js';

/** -> { t, runDir, split, rootTaskPath }. cap 100 and the fixture-priced child chain `mock-budget` (cheapest 6.1, at most 40.8) make all three children admissible. */
export async function realRoot({ childChain = 'mock-budget', plan = planWith(block3(), { preface: 'REVISED MOCK DELIVERABLE\n\n' }), cap = 100, verify = true, limits, extraChains, rootCriteria, piiGate, bundleAllowanceBytes } = {}) {   // bundleAllowanceBytes undefined = newTree's fixture default
  const t = newTree({ cap, childChain, limits, piiGate, ...(bundleAllowanceBytes !== undefined ? { bundleAllowanceBytes } : {}), ...(extraChains ? { extraChains } : {}) });
  registerRoot(t.rootDir);
  writeFileSync(join(t.work, 'plan.md'), plan);
  if (rootCriteria) writeFileSync(join(t.work, 'crit.json'), JSON.stringify(rootCriteria));     // the root's acceptance list, handed in (a list the root's own guards accept and a child chain's flags may not)
  const res = await api.run({ ...rootOpts(t), ...(rootCriteria ? { criteria: 'crit.json' } : {}), ...(piiGate ? { piiGate } : {}) });      // the root is a member: it runs under the tree's mode (src/tree-member.js)
  assert.equal(res.exitCode, 0, res.outputTail);
  const runDir = join(t.runsDir, ROOT_ID);
  let split = null;
  if (verify) {
    const v = verifySplit(t.rootDir, { node: 'R', generation: 1, runId: ROOT_ID, runDir, work: t.work, inheritedGlobal: [], ancestorQuestions: [] });
    assert.equal(v.refusal, null, v.refusal && JSON.stringify(v.refusal));
    split = v.sha256;
  }
  return { t, runDir, split, rootTaskPath: join(t.work, 'tasks', 'x.md') };
}
