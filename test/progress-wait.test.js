// src/mcp/progress-wait.js (13 Oct 2026, the load-dependent mcp-run-status-wait test): the long-poll behind run_status, driven with a SCRIPTED log and status and an
// injected sleep and clock: no process, no wall clock. The real-process test (test/mcp-run-status-wait.test.js) pins the structural facts; the cadence of notifications
// (one per poll in which the log grew, progress = the line count, rising) is pinned here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForProgress, POLL_MS } from '../src/mcp/progress-wait.js';

const line = n => ({ stage: `s${n}`, lab: 'l', ms: 1, outcome: 'ok', tokensOut: 1, usd: 0.5 });
// ticks: [{ lines: how many stage-log lines exist, status }] - the state at poll 0, 1, 2, ... ; each injected sleep() moves to the next tick (the last one repeats).
function harness(ticks, { token = 'tok', aborted = () => false } = {}) {
  let tick = 0; let clock = 1000; const notes = []; let sleeps = 0;
  const at = () => ticks[Math.min(tick, ticks.length - 1)];
  const io = {
    readStatus: () => at().status,
    readLog: () => Array.from({ length: at().lines }, (_, i) => line(i + 1)),
    sleep: async ms => { sleeps++; tick++; clock += ms; },
    now: () => clock,
  };
  const extra = { _meta: token === null ? {} : { progressToken: token }, sendNotification: async n => { notes.push(n.params); }, signal: { get aborted() { return aborted(); } } };
  return { io, extra, notes, sleeps: () => sleeps };
}

test('until=settled: a log that grows by one line per poll sends progress 1, 2, 3 once each, then returns once, settled and done, with every event', async () => {
  const h = harness([{ lines: 1, status: 'running' }, { lines: 2, status: 'running' }, { lines: 3, status: 'running' }, { lines: 3, status: 'done' }]);
  const r = await waitForProgress(h.io, { seconds: 30, since: 0, until: 'settled' }, h.extra);
  assert.deepEqual(h.notes.map(n => n.progress), [1, 2, 3]);
  assert.ok(h.notes.every(n => n.progressToken === 'tok'));
  assert.equal(r.settled, true); assert.equal(r.status, 'done'); assert.equal(r.timedOut, false); assert.equal(r.cancelled, false);
  assert.equal(r.events.length, 3); assert.equal(r.cursor, 3); assert.equal(r.usdSoFar, 1.5);
  assert.equal(h.sleeps(), 3, 'one sleep per poll that did not settle');
  assert.deepEqual(r.events[0], { stage: 's1', lab: 'l', ms: 1, outcome: 'ok', tokensOut: 1 });
});

test('two lines landing inside one poll interval send ONE notification (progress = the line count): the cadence is the poll, not the line', async () => {
  const h = harness([{ lines: 1, status: 'running' }, { lines: 3, status: 'running' }, { lines: 3, status: 'done' }]);
  const r = await waitForProgress(h.io, { seconds: 30, since: 0, until: 'settled' }, h.extra);
  assert.deepEqual(h.notes.map(n => n.progress), [1, 3]);
  assert.equal(r.cursor, 3); assert.equal(r.events.length, 3);
});

test('no progressToken, no notifications; until=event returns at the first new line without settling; a cancelled call returns cancelled; the time limit returns timedOut', async () => {
  const noToken = harness([{ lines: 1, status: 'running' }, { lines: 2, status: 'done' }], { token: null });
  await waitForProgress(noToken.io, { seconds: 30, since: 0, until: 'settled' }, noToken.extra);
  assert.deepEqual(noToken.notes, []);

  const ev = harness([{ lines: 0, status: 'running' }, { lines: 1, status: 'running' }, { lines: 1, status: 'running' }]);
  const e = await waitForProgress(ev.io, { seconds: 30, since: 0, until: 'event' }, ev.extra);
  assert.equal(e.settled, false); assert.equal(e.status, 'running'); assert.equal(e.events.length, 1);

  let stop = false;
  const ab = harness([{ lines: 0, status: 'running' }], { aborted: () => stop });
  ab.io.sleep = async () => { stop = true; };
  const c = await waitForProgress(ab.io, { seconds: 30, since: 0, until: 'settled' }, ab.extra);
  assert.equal(c.cancelled, true); assert.equal(c.timedOut, false);

  const slow = harness([{ lines: 0, status: 'running' }]);
  const t = await waitForProgress(slow.io, { seconds: 1, since: 0, until: 'settled' }, slow.extra);
  assert.equal(t.timedOut, true); assert.equal(t.settled, false);
  assert.ok(t.waitedMs >= 1000 && t.waitedMs < 1000 + 2 * POLL_MS, `the fake clock moved by ${t.waitedMs} ms`);
});
