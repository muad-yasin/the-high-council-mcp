// The sub-plan regenerate never races a running node (C&C thcmcp-6d ruling 20 Okt 2026, owed since 18 Okt; mirrors the root route's refusal at src/tree-transitions.js, "a root re-plan never races a running node"): REFUSE while anything at or under a listed node is active (registered, running or holding a post-run claim). No kill, no wait. One real-verb row: R/M1's frontier registered R/M1/M1 (active, its claim is this live process), R/M1 gets a stop, and `council tree decide` answers it with a REGENERATE. Offline, $0. The refusal sentence is A-DRAFT.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { affectedFor } from '../src/tree-affected.js';
import { registerNextChild } from '../src/tree-loop.js';
import { decideHandler } from '../src/tree-decide.js';
import { runTree } from '../src/tree-run.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { splitChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { approvePending, draftStarter, eventsOf } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { ROOT_ID, claim, hostnameOf } from './helpers/tree-fixture.js';

/** The fixture block of tree-replace.test.js (oldBlock): R/M1 splits into children K1..M3 and M5 is ready. */
function oldBlock() {
  const b = block3();
  for (const m of b.milestones) if (m.open_question) m.open_question = `Inside the store: ${m.open_question}`;
  b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  return b;
}

test('SG-1: a sub-plan regenerate is refused while R/M1/M1 (under the replaced R/M1) is RUNNING: nothing is recorded, the descendant is not listed dead', { timeout: 300_000 }, async () => {
  const r = await trackedRealRoot(splitChildren());
  approvePending(r);
  writeFileSync(join(r.t.work, 'plan-a.md'), planWith(oldBlock(), { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
  const start = draftStarter(r, { 'R/M1': 'plan-a.md' });
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  approvePending(r);                                                                                 // R/M1's own frontier
  const reg = registerNextChild(r.t.rootDir, { work: r.t.work });
  assert.deepEqual([reg.kind, reg.node], ['registered', 'R/M1/M1'], 'a descendant of R/M1 is registered');
  // CHANGED ACCEPTED (C&C thcmcp-cd, 23 Okt 2026, SG-1 REFINED: "a node with no process is NOT active for SG-1"; the question it answered: CnC_M7_Lists.md:175, a RUNNING descendant "while its process lives"). OLD: a REGISTERED, never-started descendant was the "active" node. NEW: the descendant is STARTED (a live claim), because only a node with a process races. A registered-only descendant is no longer refused (test/tree-subplan-preflight.test.js P3).
  appendTreeEvent(r.t.rootDir, { event: 'node_started', ...claim('R/M1/M1', stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M1/M1@g1').runId, process.pid, 1, hostnameOf()) });
  const read = () => { const record = readTreeRecord(r.t.rootDir); return { record, state: stateOf(record), runsDir: r.t.runsDir }; };
  const { record, state, runsDir } = read();
  assert.ok(state.activeKeys.some(k => k.startsWith('R/M1/M1@')), 'the descendant is active');
  const stop = appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: state.nodes.get('R/M1@g1').runId, source: 'status', affected: affectedFor({ record, state, runsDir, node: 'R/M1' }).affected });
  const events0 = eventsOf(r).length;
  const io = terminal([]);       // CHANGED ACCEPTED (same ruling, Q4: refuse BEFORE the person types): no typed answers any more, the refusal comes from the preflight
  const timer = setTimeout(() => io.stdin.end(), 6000);
  const code = await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: {}, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer));
  assert.notEqual(code, 0, io.shown() + io.errors());
  assert.match(io.shown() + io.errors(), /active|running/i);
  assert.equal(eventsOf(r).filter(e => e.event === 'decision_recorded').length, 0, 'no decision was recorded');
  const added = eventsOf(r).slice(events0);
  assert.deepEqual(added, [], 'the preflight refuses before anything is typed and writes nothing (OLD: the table row wrote its own blocked line after the typed approval)');
  assert.match(io.errors(), /node R\/M1\/M1 is active: a sub-plan regenerate never races a running node/, 'the guard fired and named the descendant');
  assert.ok(stateOf(readTreeRecord(r.t.rootDir)).openStops.includes(stop.id), 'the stop stays open for the person');
});
