// Shared by the tree-run and tree-resume tests (0.8.3 M5c). Not a test file.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import * as api from '../../src/api.js';
import { appendTreeEvent, readTreeRecord, stateOf } from '../../src/tree-record.js';
import { treePiiModeFrom } from '../../src/tree-pii-mode.js';
import { describeFrontier, findPendingFrontier } from '../../src/tree-frontier.js';
import { GATE_FIELDS } from './tree-fixture.js';

export const eventsOf = r => readTreeRecord(r.t.rootDir).events;
export const phases = r => Object.fromEntries([...stateOf(readTreeRecord(r.t.rootDir)).nodes.values()].map(n => [n.node, n.phase]));
export const indexOf = (r, pred) => eventsOf(r).findIndex(pred);

/** Approves the frontier that waits (the previewed/approved pair, one hash), as `tree approve` would record it. */
export function approvePending(r) {
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  assert.ok(pending, 'a frontier waits for approval');
  const d = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending });
  assert.equal(d.refusal, undefined, JSON.stringify(d.refusal));
  const f = stateOf(readTreeRecord(r.t.rootDir)).frontiers.get(d.frontierKey);
  appendTreeEvent(r.t.rootDir, { event: 'frontier_previewed', ...d.preview, boundSha256: d.boundSha256 });
  appendTreeEvent(r.t.rootDir, { event: 'frontier_approved', ...GATE_FIELDS, frontierKey: d.frontierKey, revision: (f?.revisions.length ?? 0) + 1, boundSha256: d.boundSha256 });
  return d;
}
export const LEAF_PLAN = '# The provider plan\n\n## Overview\nThe store keeps every record.\n\nREVISED MOCK DELIVERABLE\n';
/** A starter that runs each child through api.run on a DRAFT plan (so the mock critics sign it and the plan has the headings a consumer's provider_refs name); `plans` maps a node to its own plan file. */
export const draftStarter = (r, plans = {}) => {
  writeFileSync(join(r.t.work, 'leaf-plan.md'), LEAF_PLAN);
  return ({ node, chain, bundleDir, runId, grantUsd }) => { const mode = treePiiModeFrom(readTreeRecord(r.t.rootDir).tree); return api.run({ chain, task: join(bundleDir, 'task.md'), criteria: join(bundleDir, 'criteria.json'), context: join(bundleDir, 'context.md'), runId, treeNode: join(bundleDir, 'node.json'), ...(mode.status === 'on' ? { piiGate: mode.mode } : {}), cwd: r.t.work, maxUsd: grantUsd, draft: plans[node] ?? 'leaf-plan.md', rounds: 1  }); };
};

