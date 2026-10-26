// CR-2J-001 / B6 (25 Okt 2026): `council tree stop` ends the sitting at its first line, BEFORE stop detection; the sitting's end still opened the BLOCKED-child stops, and the status policy blocks a needs_decision close, so a child that
// finished needs_decision while the stop was in force got a `blocked` stop (answers: regenerate, paid) and detection later found the key taken and wrote no node_closed stop (answers: the free --keep). A close detection will still write a
// stop for (undetectedDecisionCloses) is now left to detection. Real children (all-mock, $0): the marker lands while R/M1 runs, R/M1 ends needs_decision.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { decideHandler } from '../src/tree-decide.js';
import { clearStop, requestStop, runTree } from '../src/tree-run.js';
import { gatherStatusFacts, renderTreeStatus } from '../src/tree-status.js';
import { ROOT_ID } from './helpers/tree-fixture.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { needsDecisionChildren } from './helpers/child-chains.js';
import { approvePending, draftStarter, eventsOf } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';

const stopsOf = (r, node) => eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.node === node);

test('BU-1 (real verbs): a needs_decision close made while `tree stop` is in force gets NO blocked stop; the next sitting writes its node_closed stop and --keep ($0) is accepted', async t => {
  const r = await trackedRealRoot(needsDecisionChildren()); approvePending(r);
  const real = draftStarter(r);
  const out = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: async args => { const res = await real(args); requestStop(r.t.rootDir); return res; } });   // the marker appears while R/M1 runs
  assert.equal(out.status, 'stopped_by_person');
  const closed = eventsOf(r).find(e => e.event === 'node_closed' && e.node === 'R/M1');
  assert.equal(closed?.status, 'needs_decision', 'R/M1 ended needs_decision');
  t.diagnostic(`STATUS while the stop is in force:\n${renderTreeStatus(gatherStatusFacts(r.t.rootDir, { work: r.t.work }))}`);   // printed for the report: what a person reads in this window
  assert.deepEqual(stopsOf(r, 'R/M1').map(e => e.source), [], `no stop of any source yet: ${JSON.stringify(stopsOf(r, 'R/M1').map(e => e.source))} (a blocked stop would only be answerable by regenerating)`);
  assert.equal(clearStop(r.t.rootDir), true);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  assert.deepEqual(stopsOf(r, 'R/M1').map(e => e.source), ['node_closed'], 'the next sitting writes the node_closed stop');
  const meta = stateOf(readTreeRecord(r.t.rootDir)).stopMeta.get(stopsOf(r, 'R/M1')[0].id); const key = `${meta.node}@g${meta.generation}`;
  const term = terminal(['The result stands.\n.', key, 'y']); const timer = setTimeout(() => term.stdin.end(), 8000);
  const code = await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { keep: key }, work: r.t.work, stdin: term.stdin, stdout: term.stdout, stderr: term.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer));
  assert.equal(code, 0, `--keep is accepted: ${term.shown()}${term.errors()}`);
  assert.ok(stateOf(readTreeRecord(r.t.rootDir)).accepted.has(key), 'the node is accepted as it is');
});
