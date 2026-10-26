// BUG-C-059 (bug audit 24 Okt 2026, lane B fix): a recommendation request that was registered and given a call, whose process is gone (a closed terminal, SIGHUP, a throw out of the send), stays
// open and holds its grant. Only a new request's admission released stale requests, so a person who typed their own decision met the table's "a recommendation request is still open" refusal AFTER
// their gate approval was spent, on every rerun. `council tree decide` now releases such a request first (the reconcile admission uses): a request ends only when its wait ran out or its claim is
// dead AND every call's folder shows an end. Real verbs (decideHandler, a scripted terminal), $0.
// Rows: (R1) a request with a call and a dead process is released, then the typed decision records; (R2) a request whose call is still going keeps its hold and no end is written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { adviceStart, registerAdviceAdmitted } from '../src/tree-advice-record.js';
import { budgetOf } from '../src/tree-budget.js';
import { decideHandler } from '../src/tree-decide.js';
import { closedRootTree, GATE_FIELDS, ROOT_ID } from './helpers/tree-fixture.js';
import { track } from './helpers/temp-trees.js';
import { terminal } from './helpers/terminal.js';

const SHA = 'a'.repeat(64);
const RUN = '2026-10-24T12-01-00-000Z';
// a process id that is certainly gone: a child that has already exited
const deadPid = () => spawnSync(process.execPath, ['-e', '0']).pid;

function setup() {
  const t = closedRootTree({ cap: 20 }); track(t.work);
  appendTreeEvent(t.rootDir, { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'person', affected: [{ node: 'R', generation: 1 }], reason: 'The plan leaves the billing out.', ...GATE_FIELDS });
  const stopId = stateOf(readTreeRecord(t.rootDir)).openStops[0];
  return { t, stopId, env: { PATH: process.env.PATH, HOME: t.work } };
}
// the state a throw out of the send (or a closed terminal) leaves: registered, one call added, no end. By default the call's folder holds only the brief: no gate file, no run.json, no lock, so its run status derives as `stopped`, which is not a running-class status.
function strandedRequest(s, { folder, checkHeld = true } = {}) {
  registerAdviceAdmitted(s.t.rootDir, { adviceId: 'A-gone', grantUsd: 4, stopId: s.stopId, gateId: 'g-grant', shownSha256: SHA, answer: { actor: 'person', via: 'terminal' }, ttlMs: 600_000, pid: deadPid() });
  adviceStart(s.t.rootDir, { adviceId: 'A-gone', runId: RUN, kind: 'first', briefSha256: SHA, shownSha256: SHA });
  const dir = join(s.t.runsDir, RUN); mkdirSync(dir, { recursive: true });
  if (folder) folder(dir); else appendFileSync(join(dir, 'advice-brief.md'), 'the brief, waiting for its approval\n');
  const a = [...stateOf(readTreeRecord(s.t.rootDir)).advice.values()];
  assert.equal(a.length, 1, 'premise: one request'); assert.equal(a[0].ended, null, 'premise: it is open'); assert.equal(a[0].runs.length, 1, 'premise: it has one call');
  if (checkHeld) assert.equal(budgetOf(s.t.rootDir).advice[0].heldUsd, 4, 'premise: its grant is held');
}
const decide = (s, io) => decideHandler({ rootDir: s.t.rootDir, rootId: ROOT_ID, flags: { fresh: true }, work: s.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now(), env: s.env });
const typedDecision = s => terminal(['A fresh plan that covers the billing.\n.', s.stopId, 'y']);

test('R1 (BUG-C-059) a recommendation request with a call whose process is gone is released when `tree decide` starts; the typed decision then records, with the end written before it', { timeout: 60_000 }, async () => {
  const s = setup(); strandedRequest(s);
  const io = typedDecision(s);
  const code = await decide(s, io);
  const events = readTreeRecord(s.t.rootDir).events;
  assert.equal(code, 0, io.shown() + io.errors());
  const ended = events.findIndex(e => e.event === 'advice_ended' && e.adviceId === 'A-gone'); const decided = events.findIndex(e => e.event === 'decision_recorded');
  assert.ok(ended !== -1 && decided !== -1 && ended < decided, `the request ended (${ended}) before the decision was recorded (${decided})`);
  assert.equal(events[ended].reason, 'crashed');
  assert.equal(budgetOf(s.t.rootDir).advice[0].heldUsd, 0, 'its grant is given back');
});

test('R2 (BUG-C-059) a request whose call is still going keeps its hold through a `tree decide`: nothing is ended', { timeout: 60_000 }, async () => {
  const s = setup();
  // a stage of the call's run is waiting for an external answer: the run status reads `paused`, a running-class status (the accounting figures of such a synthetic folder are not the subject, so only the record is read)
  strandedRequest(s, { checkHeld: false, folder: dir => { appendFileSync(join(dir, 'run.json'), '{}'); appendFileSync(join(dir, 'NEEDS-propose.md'), 'waiting\n'); } });
  const io = typedDecision(s);
  await decide(s, io).catch(() => null);        // what the typed decision then does with the open request is not the subject here
  const events = readTreeRecord(s.t.rootDir).events;
  assert.equal(events.some(e => e.event === 'advice_ended'), false, 'no end was written: the call can still spend');
  assert.equal([...stateOf(readTreeRecord(s.t.rootDir)).advice.values()][0].ended, null, 'the request is still open, its grant still held');
});
