// D2 F7 (CR-2J-003, B5): one status policy for both readers, and the free KEEP is printed where the table would take it. Real all-mock trees, $0, on the split test/tree-keep.test.js's real-verb KEEP test runs on (R/M1 ends with the
// Status needs_decision and no needs-decision milestone; R/M2 expects from R/M1).
//   T7  (F7a): after `decide --keep R/M1@g1` the consumer R/M2 registers (the provider's eligibility reads the KEEP in its lint check too, as readiness does).
//   T7b (F7b, S4 A-DRAFT): the node_closed stop text of R/M1 names the free KEEP route, exactly as keepRefusal allows it.
//   S5 (F7b, A-DRAFT): the sitting's generic open-stop line names `--stop <id>` and status, never `--milestone` (which a node with no needs-decision milestone does not take).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { decideHandler } from '../src/tree-decide.js';
import { runTree } from '../src/tree-run.js';
import { needsDecisionStopText } from '../src/tree-stop-view.js';
import { sittingLines } from '../src/tree-resume.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { needsDecisionChildren } from './helpers/child-chains.js';
import { approvePending, draftStarter } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

async function stoppedOnM1() {
  const r = await trackedRealRoot(needsDecisionChildren()); approvePending(r);
  const out = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  const record = readTreeRecord(r.t.rootDir); const st = stateOf(record);
  const stopId = st.openStops[0]; const stop = record.events.find(e => e.id === stopId);
  assert.equal(stop?.source, 'node_closed', JSON.stringify(stop));
  return { r, out, stop, key: `${stop.node}@g${stop.generation}` };
}

test('T7b (F7b, S4): the node_closed stop of a child that ended needs_decision with no milestone names the free KEEP route, and the route is one `decide --keep` takes', { timeout: 400_000 }, async () => {
  const { r, stop, key } = await stoppedOnM1();
  const text = needsDecisionStopText(r.t.rootDir, stop);
  assert.ok(text.includes(`accept it as it is ($0): council tree decide ${ROOT_ID} --keep ${key}`), text);
});

test('T7 (F7a, CR-2J-003): after `decide --keep R/M1@g1` the next sitting registers the consumer R/M2 (its provider is eligible: the lint check reads the KEEP as readiness does)', { timeout: 400_000 }, async () => {
  const { r, key } = await stoppedOnM1();
  const t = terminal(['The result stands.\n.', key, 'y']); const timer = setTimeout(() => t.stdin.end(), 8000);
  const code = await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { keep: key }, work: r.t.work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer));
  assert.equal(code, 0, t.shown() + t.errors());
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });       // a full sitting (D2 T7: resume): the independent R/M3 may be chosen first
  assert.ok(readTreeRecord(r.t.rootDir).events.some(e => e.event === 'node_registered' && e.node === 'R/M2'), JSON.stringify(out).slice(0, 600));
});

test('S5 (F7b): the sitting\'s generic open-stop line names `--stop <id>` and `tree status`, and no longer offers --milestone', () => {
  const lines = sittingLines({ status: 'held_by_stop', started: [], stopIds: ['e5'], held: [{ node: 'R/M2', why: ['x'], sources: [{ kind: 'stop', id: 'e5' }] }], waiting: [] }, 'rid').join('\n');
  assert.match(lines, /Open stop e5: answer it with `council tree decide rid --stop e5`; `council tree status rid` shows the answers each stop takes\./, lines);
  assert.equal(lines.includes('--milestone <id>'), false);
});
