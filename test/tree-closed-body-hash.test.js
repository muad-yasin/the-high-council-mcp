// 0.8.3 M6 entry 3, commit 1 (Astra #13, the root piece; C&C 14 Oct 2026): the closing event of a tree member records the sha256 of the DELIVERED BODY (`deliveredBodySha256`), the same value readNodePlan checks, and only when deliverable.md really hashes
// to it at the close. One additive optional field: an older closure has none and is not guessed. The record, not report.json (which sits beside the file it protects), is what a later sitting can compare a repaired plan file against.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closedFieldsOf, runEndOf } from '../src/tree-member.js';
import { eventShapeError, foldRecord } from '../src/tree-transitions.js';
import { readNodePlan } from '../src/tree-derive-load.js';
import { readTreeRecord } from '../src/tree-record.js';
import { sha256Of } from '../src/thin-contract.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { track } from './helpers/temp-trees.js';

const BODY = '# Plan\n\nA plan body.\n';
const runDirWith = ({ body = BODY, deliverable = body, notes = [], report = {} } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-body-')); track(dir);
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ passed: true, delivered_text: { body_sha256: sha256Of(body), harness_notes: notes }, ...report }));
  writeFileSync(join(dir, 'deliverable.md'), deliverable);
  return dir;
};

test('closedFieldsOf records the delivered body\'s sha256 when deliverable.md hashes to it (with and without harness notes in front of the body); runEndOf (recovery) carries it too', () => {
  assert.equal(closedFieldsOf(runDirWith()).deliveredBodySha256, sha256Of(BODY));
  assert.equal(closedFieldsOf(runDirWith({ deliverable: `notes of the harness\n---\n${BODY}`, notes: ['a note'] })).deliveredBodySha256, sha256Of(BODY));
  assert.equal(runEndOf(runDirWith()).deliveredBodySha256, sha256Of(BODY), 'recovery writes the same closing fields from the files alone');
});

test('known-bad: a deliverable that no longer hashes to report.json, no delivered_text, or no deliverable at all records NO field (not a guess), and the rest of the closing fields are unchanged', () => {
  for (const [name, dir] of [['edited deliverable', runDirWith({ deliverable: `${BODY}\nEdited.\n` })], ['no delivered_text', runDirWith({ report: { delivered_text: undefined } })], ['delivered_text without a hash', runDirWith({ report: { delivered_text: { harness_notes: [] } } })]]) {
    const c = closedFieldsOf(dir); assert.equal('deliveredBodySha256' in c, false, name); assert.deepEqual([c.outcome, c.passed, c.share], ['passed', true, 'released'], `${name}: the other fields`);
  }
  const dir = runDirWith(); const gone = join(dir, 'gone'); mkdirSync(gone); writeFileSync(join(gone, 'report.json'), JSON.stringify({ passed: true, delivered_text: { body_sha256: sha256Of(BODY), harness_notes: [] } }));
  assert.equal('deliveredBodySha256' in closedFieldsOf(gone), false, 'no deliverable.md');
});

test('the field is ADDITIVE: the event shape accepts it (64 hex), refuses a malformed one, and accepts a closure without it; the fold keeps it on the node (null when absent)', () => {
  const base = { schema: 'tree-events/1', id: 'e9', at: '2026-10-14T10:00:00.000Z', event: 'node_closed', node: 'R', generation: 1, runId: 'run-1', outcome: 'passed', passed: true, share: 'released' };
  assert.equal(eventShapeError({ ...base, deliveredBodySha256: sha256Of(BODY) }), null);
  assert.equal(eventShapeError(base), null, 'an older closure has none');
  assert.match(eventShapeError({ ...base, deliveredBodySha256: 'not-a-hash' }) ?? '', /deliveredBodySha256/);
  const reg = { id: 'e2', event: 'node_registered', node: 'R', generation: 1, runId: 'run-1', attempt: 1, depth: 0, parentNode: null, frontierKey: null, chain: { name: 'c', sha256: 'a'.repeat(64) }, grant: { amount: 4, unit: 'usd' } };
  const events = extra => [{ id: 'e1', event: 'tree_started', treeId: 't' }, reg, { id: 'e3', event: 'node_started', node: 'R', generation: 1, runId: 'run-1', pid: 1, host: 'h' }, { ...base, id: 'e4', ...extra }];
  assert.equal(foldRecord(events({ deliveredBodySha256: sha256Of(BODY) })).nodes.get('R@g1').deliveredBodySha256, sha256Of(BODY));
  assert.equal(foldRecord(events({})).nodes.get('R@g1').deliveredBodySha256, null);
});

test('REAL FLOW: the root run of a real tree closes through the member\'s end hook and its node_closed carries the hash of the body readNodePlan reads from the run folder', async () => {
  const r = await trackedRealRoot(pricedChildren());
  const closed = readTreeRecord(r.t.rootDir).events.find(e => e.event === 'node_closed' && e.node === 'R');
  const plan = readNodePlan(join(r.t.runsDir, closed.runId)).plan;
  assert.ok(plan, 'the root plan reads'); assert.equal(closed.deliveredBodySha256, plan.sha256);
  assert.equal(closed.deliveredBodySha256, sha256Of(plan.text), 'and it is the hash of the body\'s bytes');
});
