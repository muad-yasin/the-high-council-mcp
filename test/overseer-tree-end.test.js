// Round semantics 2b-i FIX-UP (C&C review 15 Oct 2026): what the TREE does with a member that stopped at its overseer limit (exit 23, STOPPED-overseer_cap/layer_bound.json, no report.json). It ended cleanly and waits for the
// person's choice: recovery writes NO node_stopped / budget event for it (no top-up can help), a sitting does NOT resume it (no node_resumed), `tree decide --close` still accepts it (its only way out until the member verb), and the
// sitting says awaiting_choice. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planRecovery } from '../src/tree-recovery.js';
import { closeRefusal, describePhase } from '../src/tree-close.js';
import { stateOf } from '../src/tree-record.js';

const line = (id, e) => ({ schema: 'tree-events/1', id, at: '2026-10-15T12:00:00.000Z', ...e });
const events = [
  line('e1', { event: 'tree_started', treeId: 't' }),
  line('e2', { event: 'node_registered', node: 'R', generation: 1, runId: 't', attempt: 1, depth: 0, parentNode: null, frontierKey: null, chain: { name: 'c', sha256: 'a'.repeat(64) }, grant: { amount: 1, unit: 'usd' } }),
  line('e3', { event: 'node_started', node: 'R', generation: 1, runId: 't', pid: 1, host: 'h' }),
];
const record = { events, corrupt: [], tree: { treeId: 't' }, treeSha256: 'x' };
const facts = { host: 'h', pidAlive: () => false };
const plan = end => planRecovery(record, { runFactsOf: () => ({ hasRunJson: true, runDir: '/nonexistent', end, paused: false }), facts });

test('T1: recovery for a member that ended round_stopped: no node_stopped / budget event, no resume; it waits for a person (reason round_stop)', () => {
  const actions = plan({ kind: 'round_stopped' });
  assert.equal(actions.some(a => a.action === 'append'), false, JSON.stringify(actions));
  assert.equal(actions.some(a => a.action === 'resume'), false);
  assert.deepEqual(actions.map(a => [a.action, a.reason]), [['wait_for_person', 'round_stop']]);
});

test('T2 (PIN): a member that ended at a BUDGET stop is still recorded as node_stopped / budget, and an interrupted one (no end) is still resumed', () => {
  const stopped = plan({ kind: 'stopped' });
  assert.deepEqual(stopped.map(a => [a.action, a.event?.event, a.event?.reason]), [['append', 'node_stopped', 'budget']]);
  assert.equal(plan(null)[0].action, 'resume');
});

test('T3: tree decide --close still accepts a round-stopped member (its only way out until the member verb), and still refuses one whose run really ended with a report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ovt-'));
  try {
    const state = stateOf(record);
    mkdirSync(join(dir, 't'));
    writeFileSync(join(dir, 't', 'STOPPED-overseer_cap.json'), '{}');
    assert.equal(closeRefusal({ state, runsDir: dir, node: 'R/M1', generation: 1, facts }).kind, 'unknown', 'sanity: closeRefusal is wired to this state');
    const n = [...state.nodes.values()][0];
    const fake = { nodes: new Map([['M@g1', { ...n, node: 'M', generation: 1, phase: 'running', runId: 't' }]]) };
    assert.equal(closeRefusal({ state: fake, runsDir: dir, node: 'M', generation: 1, facts }), null, 'close allowed');
    writeFileSync(join(dir, 't', 'report.json'), '{}');
    assert.equal(closeRefusal({ state: fake, runsDir: dir, node: 'M', generation: 1, facts })?.kind, 'ended', 'a run with a report.json is still "already ended"');
    fs.rmSync(join(dir, 't', 'report.json'));
    assert.match(describePhase({ phase: 'running', runId: 't' }, dir) ?? '', /overseer limit, not agreed, waiting for a choice/);
    assert.match(describePhase({ phase: 'running', runId: 'nope' }, dir) ?? '', /interrupted/, 'a run with no marker is still an interrupted one');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('T4: the sitting line for a round-stopped member says awaiting_choice and names the exit that exists (no direct --resume)', async () => {
  const { sittingLines } = await import('../src/tree-resume.js');
  const text = sittingLines({ status: 'awaiting_choice', started: [], node: 'R/M1', runId: 'r1' }, 'root1').join('\n');
  assert.match(text, /waits for YOUR choice/); assert.match(text, /tree decide root1 --close R\/M1/); assert.equal(/--resume/.test(text), false);
});

// ---- the SITTING level (advisor + C&C 15 Oct 2026): a real tree sitting over a member that stopped at its overseer limit.
import { hostname } from 'node:os';
import { appendTreeEvent } from '../src/tree-record.js';
import { runTree } from '../src/tree-run.js';
import { exitCodeOf, resumeHandler } from '../src/tree-resume.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { approvePending, eventsOf } from './helpers/sitting.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

// The first sitting starts the child, which "stops at its overseer limit" (the fake starter returns 23); the member then looks as a real one would after exit 23: node_started on record (a dead pid), a run folder with run.json and
// STOPPED-overseer_cap.json, no report.json.
async function roundStoppedMember() {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  const first = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 3, startRun: async () => ({ exitCode: 23 }) });
  appendTreeEvent(r.t.rootDir, { event: 'node_started', node: 'R/M1', generation: 1, runId: first.runId, pid: 999999, host: hostname() });
  const d = join(r.t.runsDir, first.runId); mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'run.json'), '{}'); writeFileSync(join(d, 'STOPPED-overseer_cap.json'), '{}');
  return { r, first };
}
const dead = { pidAlive: () => false };

test('T5: a tree sitting over a round-stopped member: the start returning 23 is awaiting_choice (exit 20, never crashed: tree-run.js start path); the NEXT sitting holds at it (awaiting_choice, exit 20), starts and resumes nothing, writes no node_resumed / node_stopped', async () => {
  const { r, first } = await roundStoppedMember();
  assert.equal(first.status, 'awaiting_choice'); assert.equal(exitCodeOf(first), 20);
  let started = 0; let resumed = 0;
  const second = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 3, facts: dead, startRun: async () => { started += 1; return { exitCode: 0 }; }, resumeRun: async () => { resumed += 1; return { exitCode: 0 }; } });
  assert.deepEqual([second.status, second.node, exitCodeOf(second), started, resumed], ['awaiting_choice', 'R/M1', 20, 0, 0]);
  const kinds = eventsOf(r).map(e => e.event);
  assert.equal(kinds.includes('node_resumed'), false); assert.equal(kinds.includes('node_stopped'), false);
});

test('T6: `council tree resume` over the same member: it prints the awaiting-choice sitting line, exits 20, calls no resumeRun and writes no node_resumed', async () => {
  const { r } = await roundStoppedMember();
  let resumed = 0; const out = [];
  const io = { write: s => { out.push(String(s)); return true; } };
  const code = await resumeHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdout: io, stderr: io, now: () => Date.now(), facts: dead, deps: { startRun: async () => ({ exitCode: 0 }), resumeRun: async () => { resumed += 1; return { exitCode: 0 }; } } });
  assert.equal(code, 20, out.join(''));
  assert.equal(resumed, 0);
  assert.match(out.join(''), /waits for YOUR choice/);
  assert.equal(eventsOf(r).some(e => e.event === 'node_resumed'), false);
});
