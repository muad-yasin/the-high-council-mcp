// D2 F12 (A1b; lane T, G5+6): `council tree status` and the MCP tree_status payload name the approval for a frontier that was NEVER previewed. Before: the status listed only previewed frontiers (awaitingApprovalOf), so a root whose
// split was verified and whose frontier nobody had shown yet read "Nothing is asked of you right now." while `council tree approve` (findPendingFrontier, its first read) offers exactly that frontier. Real verbs, all-mock, $0:
// realRoot (trackedRealRoot(pricedChildren()), as BUG-B-010 in test/tree-status.test.js; the root ran and its split is verified; no frontier was ever previewed) -> statusHandler / gatherStatusFacts + renderTreeStatus / treeStatusPayload. No new words: the two sentences are the view's own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVENTS_FILE, readTreeRecord, stateOf, treeDirOf } from '../src/tree-record.js';
import { describeFrontier, findPendingFrontier } from '../src/tree-frontier.js';
import { verifySplit } from '../src/tree-expansion.js';
import { approveHandler } from '../src/tree-approve.js';
import { runTree } from '../src/tree-run.js';
import { stopToOpenLine } from '../src/tree-handoff.js';
import { splitChangedOf } from '../src/tree-split-changed.js';
import { gatherStatusFacts, renderTreeStatus, statusHandler } from '../src/tree-status.js';
import { treeStatusPayload } from '../src/mcp/tree-status.js';
import { prefixOf } from '../src/tree-stop.js';
import { ROOT_ID } from './helpers/tree-fixture.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { approvePending } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';

const nextSteps = text => text.slice(text.indexOf('What you can do')).split('\n').slice(1).map(l => l.trim()).filter(Boolean);
const waitingOf = text => { const lines = text.split('\n'); const i = lines.indexOf('Waiting'); const rest = lines.slice(i + 1); const j = rest.findIndex(l => l !== '' && !l.startsWith(' ')); return rest.slice(0, j < 0 ? rest.length : j).map(l => l.trim()).filter(Boolean); };

test('T12 (D2 F12): a verified root whose frontier was never previewed: the status facts, the view and the MCP payload name the approval (`council tree approve`), once; after the approval it is gone again', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot(pricedChildren());
  const record = readTreeRecord(r.t.rootDir);
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  assert.ok(pending?.key, 'precondition: `council tree approve` would offer a frontier');
  assert.equal(stateOf(record).frontiers.get(pending.key)?.previewed ?? false, false, 'precondition: it was never previewed');
  assert.equal(record.events.some(e => e.event === 'frontier_previewed'), false, 'precondition: no frontier_previewed on record at all');
  const facts = gatherStatusFacts(r.t.rootDir, { work: r.t.work });
  assert.deepEqual(facts.awaitingApproval, [pending.key], 'the facts list the frontier the approve verb offers, once');       // red at 7a0b4229: [] (only previewed frontiers were listed)
  const text = renderTreeStatus(facts);
  assert.ok(waitingOf(text).includes(`A frontier (${prefixOf(pending.key)}) waits for your approval: run \`council tree approve ${ROOT_ID}\`.`), waitingOf(text).join(' | '));
  assert.ok(nextSteps(text).includes(`approve the frontier with \`council tree approve ${ROOT_ID}\``), nextSteps(text).join(' | '));
  assert.ok(!text.includes('Nothing is asked of you right now.'), 'the old answer is gone');
  const out = { text: '', write(s) { this.text += s; } };
  assert.equal(await statusHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdout: out }), 0);
  assert.equal(out.text, text, 'the verb prints the same view');
  const payload = treeStatusPayload(facts);
  assert.deepEqual(payload.awaitingApproval, [pending.key], 'the MCP tree_status payload lists it');
  assert.equal(payload.view, text, 'the MCP view is the same text');
  // control: once approved, nothing waits for approval (no double listing, no line that sticks); the next step is the resume line (BUG-B-010)
  approvePending(r);
  const after = gatherStatusFacts(r.t.rootDir, { work: r.t.work });
  assert.deepEqual(after.awaitingApproval, []);
  const afterText = renderTreeStatus(after);
  assert.ok(!nextSteps(afterText).some(l => l.includes('council tree approve')), nextSteps(afterText).join(' | '));
  assert.ok(nextSteps(afterText).includes(`start the next child with \`council tree resume ${ROOT_ID}\``), nextSteps(afterText).join(' | '));
});

test('T12b (D2 F12): a verified root whose plan no longer reads (findPendingFrontier\'s key is null: describeFrontier refuses it) is not listed as waiting for approval', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot(pricedChildren());
  appendFileSync(join(r.runDir, 'deliverable.md'), '\nedited after the review\n');       // no longer the text whose hash report.json records: the plan does not read
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  assert.ok(pending && pending.key === null, `precondition: the frontier comes back with no key (${JSON.stringify(pending && { key: pending.key })})`);
  const facts = gatherStatusFacts(r.t.rootDir, { work: r.t.work });
  assert.deepEqual(facts.awaitingApproval, []);
  assert.ok(!nextSteps(renderTreeStatus(facts)).some(l => l.includes('council tree approve')), 'no approve line for a frontier the verb refuses');
});

test('T12c (D2 F12, RULE 1c: C&C\'s ruling): a never-previewed frontier that `council tree approve` REFUSES (split_changed (B), then (C) after the refused approve) is not listed; "What you can do" names the state\'s own way out (`council tree resume` opens the stop, stopToOpenLine), and after the sitting the stop\'s `decide` route', { timeout: 400_000 }, async () => {
  // red against the FIRST F12 patch (tree 7948440c, before the describeFrontier gate): awaitingApproval held the key and the view printed "approve the frontier"; at 7a0b4229 this test is green (nothing unpreviewed was listed)
  const r = await trackedRealRoot(pricedChildren());
  const file = join(treeDirOf(r.t.rootDir), EVENTS_FILE);
  writeFileSync(file, readFileSync(file, 'utf8').split('\n').map(l => (l.includes('"event":"split_verified"') ? l.replace(/"splitSha256":"[0-9a-f]{64}"/, `"splitSha256":"${'d'.repeat(64)}"`) : l)).join('\n'));       // (B) as test/tree-status.test.js builds it
  assert.equal(verifySplit(r.t.rootDir, { node: 'R', generation: 1, runId: ROOT_ID, runDir: r.runDir, work: r.t.work, inheritedGlobal: [], ancestorQuestions: [] }).refusal?.check, 'split_changed');
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  assert.ok(pending?.key, 'precondition: findPendingFrontier still offers a key, so it is the describeFrontier gate that keeps it out');
  assert.equal(describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending }).refusal?.check, 'split_changed', 'precondition: the approve verb\'s second read refuses it');
  const check = (label) => {
    const facts = gatherStatusFacts(r.t.rootDir, { work: r.t.work });
    assert.deepEqual(facts.awaitingApproval, [], `${label}: a frontier the approve verb refuses is not listed`);       // the first red against 7948440c: [pending.key]
    const text = renderTreeStatus(facts);
    assert.ok(!nextSteps(text).some(l => l.includes('council tree approve')), `${label}: ${nextSteps(text).join(' | ')}`);
    assert.ok(nextSteps(text).includes(stopToOpenLine(['R@g1'], ROOT_ID)), `${label}: the way out is named: ${nextSteps(text).join(' | ')}`);
    assert.equal(treeStatusPayload(facts).awaitingApproval.length, 0, `${label}: the MCP payload agrees`);
  };
  check('(B)');
  // (C): the person runs approve anyway; it refuses (exit 19) and leaves the history line; the view still offers the real route, not approve
  const io = terminal([]);
  assert.equal(await approveHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }), 19, io.shown() + io.errors());
  assert.ok(splitChangedOf(readTreeRecord(r.t.rootDir)).some(i => i.kind === 'approve_refused'), 'the (C) record is there');
  check('(C)');
  // the printed way out is true: the sitting opens the stop, and the view then names its `decide` route and no resume line
  await runTree(r.t.rootDir, { work: r.t.work });
  const after = gatherStatusFacts(r.t.rootDir, { work: r.t.work });
  assert.ok(after.openStops.some(s => s.node === 'R'), `the sitting opened the stop on R: ${JSON.stringify(after.openStops.map(s => s.node))}`);
  const steps = nextSteps(renderTreeStatus(after));
  assert.match(steps[0] ?? '', /council tree decide/, steps.join(' | '));
  assert.ok(!steps.some(l => l.includes('council tree approve') || l.includes('council tree resume')), steps.join(' | '));
});
