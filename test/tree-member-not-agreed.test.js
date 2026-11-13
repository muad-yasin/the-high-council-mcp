// 0.8.4 D2 / D29 (UNIT 3, C&C's condition 09 Nov 2026): a person must still be able to resolve a tree member whose run ended NOT AGREED. Since the Status clamp such a member closes needs_decision and opens a stop (src/tree-detect.js), and its closing
// record says outcome not_passed (the tree reads the agreed reading). `--keep` refuses it BY DESIGN (keepRefusal: a finished, PASSED run that ended needs_decision); the route that answers it is the regenerate form of `council tree decide`
// (src/tree-decide-stop.js buildStopDecision, chooseStop): it has no precondition on the outcome. The envelope is test/tree-detect.test.js (a real all-mock tree whose children end needs_decision); the closing records are then rewritten to the shape a
// not-agreed member now has (outcome not_passed, passed false). Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVENTS_FILE, readTreeRecord, stateOf, treeDirOf } from '../src/tree-record.js';
import { buildStopDecision } from '../src/tree-decide-stop.js';
import { decideHandler } from '../src/tree-decide.js';
import { terminal } from './helpers/terminal.js';
import { keepRefusal } from '../src/tree-transitions.js';
import { runTree } from '../src/tree-run.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { needsDecisionChildren } from './helpers/child-chains.js';
import { approvePending, draftStarter, eventsOf } from './helpers/sitting.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

test('NA-1 a member that closed needs_decision on a run that did not agree: --keep refuses it (outcome not passed) and the regenerate form answers its stop without a refusal', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot(needsDecisionChildren());
  approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });   // only R/M1 ran: it ended needs_decision and opened its stop
  const file = join(treeDirOf(r.t.rootDir), EVENTS_FILE);
  // the shape a NOT-AGREED member's closing record has now: outcome not_passed, passed false, handoff Status needs_decision (the clamp)
  writeFileSync(file, readFileSync(file, 'utf8').split('\n').map(l => {
    if (!l.includes('"event":"node_closed"') || !l.includes('"node":"R/M1"')) return l;
    const e = JSON.parse(l); return JSON.stringify({ ...e, outcome: 'not_passed', passed: false });
  }).join('\n'));
  const stop = eventsOf(r).find(e => e.event === 'needs_decision_opened' && e.node === 'R/M1');
  assert.ok(stop && stop.source === 'node_closed', 'the clamped member has an open stop');
  const state = stateOf(readTreeRecord(r.t.rootDir));
  assert.match(keepRefusal(state, { stopId: stop.id, node: 'R/M1', generation: 1 }) ?? '', /is not a finished, passed run that ended needs_decision/, '--keep is for a passed run only (by design)');
  const built = buildStopDecision({ rootDir: r.t.rootDir, rootId: ROOT_ID, form: 'regenerate', stopArg: stop.id, decisionText: 'Plan this part again.', work: r.t.work, sittingHeld: () => false });
  assert.equal(built.refusal, undefined, JSON.stringify(built.refusal));
  assert.equal(typeof built.text, 'string', 'the route builds the decision the person is asked to confirm');
  // and the person can ANSWER it: the decision typed and confirmed at the (scripted) terminal closes the stop
  const io = terminal(['Plan this part again.\n.', stop.id, 'y']);
  const code = await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { stop: stop.id }, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() });
  assert.equal(code, 0, io.shown() + io.errors());
  assert.ok(!stateOf(readTreeRecord(r.t.rootDir)).openStops.includes(stop.id), 'the stop of the not-agreed member is no longer open');
});
