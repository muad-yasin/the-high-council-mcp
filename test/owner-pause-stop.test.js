// 0.8.4 S20 slice 2, #16c ("pause after this round"), step 2: the stop CAUSE the pause ends a run with. `owner_pause` is registered where every stop cause is (src/stop-files.js tables, the marker's `request_seq`, the partial board's words, the report schema's two
// enums, the published RunStatus union) and is a PERSON stop, never a round stop (no --continue / --finish). Offline, $0. The new module is imported through a guarded dynamic import so a tree without it still loads this file (each row fails on its own).
//   OS-1 the stop tables;  OS-2 the marker keeps the request;  OS-3 the words;  OS-4 run_status says owner_paused from the marker alone;  OS-5 the schema and the types.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as stopFiles from '../src/stop-files.js';
import * as reportShape from '../src/report-shape.js';
import * as runStatus from '../src/run-status.js';

const op = await import('../src/owner-pause.js').catch(() => ({}));
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = () => mkdtempSync(join(tmpdir(), 'owner-pause-'));
const mockConfig = { name: 'op', maxRounds: 2, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 }, seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'a' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'a' }, critics: [{ provider: 'mock', model: 'mock-critic-script-o-op', lab: 'c' }] } };
const mockResult = async () => (await import('../src/chain.js')).runChain({ request: 'Req.', config: mockConfig, log: () => {} });

test('OS-1 the stop tables: owner_pause is a stop cause that waits for the person, is NOT a round stop, maps to owner_paused and has its own marker file', () => {
  assert.ok(stopFiles.STOP_CAUSES.includes('owner_pause'));
  assert.ok(stopFiles.PERSON_STOP_CAUSES.includes('owner_pause'));
  assert.equal(stopFiles.ROUND_STOP_CAUSES.includes('owner_pause'), false, 'a pause offers no --continue / --finish');
  assert.equal(stopFiles.isRoundStop('owner_pause'), false);
  assert.equal(stopFiles.waitsForPerson('owner_pause'), true);
  assert.equal(stopFiles.STOP_STATUS.owner_pause, 'owner_paused');
  assert.equal(stopFiles.stoppedFileOf('owner_pause'), 'STOPPED-owner_pause.json');
  assert.equal(op.OWNER_PAUSE, 'owner_pause');
});

test('OS-2 the marker keeps the request it stopped for: request_seq is written and read; a marker without one has no such field (every other cause is unchanged)', () => {
  const d = tmp();
  try {
    stopFiles.writeStoppedMarker(d, { stoppedBy: 'owner_pause', beforeFirstCall: false, spentUsd: 0.5, resumeAfterStop: true, reason: 'paused', requestSeq: 3 });
    const m = stopFiles.readStoppedMarker(d);
    assert.equal(m.stoppedBy, 'owner_pause');
    assert.equal(m.data.request_seq, 3);
    assert.equal(m.data.resumeAfterStop, true);
    const e = tmp();
    stopFiles.writeStoppedMarker(e, { stoppedBy: 'price_refused', beforeFirstCall: false, spentUsd: 0, resumeAfterStop: true });
    assert.equal('request_seq' in stopFiles.readStoppedMarker(e).data, false);
    rmSync(e, { recursive: true, force: true });
    assert.throws(() => stopFiles.writeStoppedMarker(tmp(), { stoppedBy: 'owner_paused', beforeFirstCall: false, spentUsd: 0, resumeAfterStop: true }), /not a stop cause/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('OS-3 the words: the sentence names the pass, the way to go on and that nothing of that pass was started; the partial board says why; no "undefined" anywhere', async () => {
  const s = op.pauseSentence({ pass: 3, spentUsd: 1.234, draftFile: 'deliverable-partial.md', runDir: 'runs/x' });
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: /PAUSED at your request before pass 3: nothing of that pass was started, written or paid for\./. NEW: /PAUSED on request before pass 3: nothing of the next pass was started, written or paid for\./. WHY: src/owner-pause.js pauseSentence, reworded by the apply (f60ebad2).
  assert.match(s, /PAUSED on request before pass 3: nothing of the next pass was started, written or paid for\./);
  assert.match(s, /Spent so far: \$1\.23\./);
  // CHANGED ACCEPTED (0.8.4 ladder unit, owner pause as a choice stop): OLD bar: `(no --continue or --finish is needed`; NEW: the pause can be ended with --finish or --finish-now, and only --continue is not needed
  assert.match(s, /council --resume runs\/x \(no --continue is needed/);
  assert.match(s, /To end it here instead: council --resume runs\/x --finish .* or --finish-now /);
  assert.doesNotMatch(s, /undefined|null/);
  assert.match(op.pauseSentence({}), /between two passes/);
  const board = reportShape.renderPartialBoardMd({ runId: 'x', result: { board: 'the board' }, cause: 'owner_pause' });   // the shape of test/partial-board-planning-stops.test.js: the board text rides in result.board
  assert.match(board, /asked the run to pause between two passes/);
  assert.doesNotMatch(board, /undefined/);
});

test('OS-4 run_status says owner_paused from the stop marker alone (the folder has no ledger)', () => {
  const d = tmp();
  try {
    writeFileSync(join(d, 'run.json'), JSON.stringify({ chain: 'mock', task: 'tasks/t.md' }));
    stopFiles.writeStoppedMarker(d, { stoppedBy: 'owner_pause', beforeFirstCall: false, spentUsd: 0, resumeAfterStop: true, requestSeq: 1 });
    assert.equal(runStatus.deriveRunStatus(d), 'owner_paused');
    const src = readFileSync(join(root, 'src', 'run-status.js'), 'utf8');
    assert.doesNotMatch(src, /pauseStateOf|pausedPointOf|pauseRequestsOf|untakenPauseOf/, 'run_status reads no pause request from the ledger: the marker is its only source (the folder above has no ledger at all)');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('OS-5 the schema and the types: a partial report stopped by owner_pause validates (stoppedBy and stop.kind enums), a made-up kind does not; the published RunStatus union names owner_paused', async () => {
  const { default: Ajv2020 } = await import('ajv/dist/2020.js');
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const validate = ajv.compile(JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8')));
  const partial = reportShape.partialReportJsonShape({ stoppedBy: 'owner_pause', runId: 'x', chain: 'op', task: 't', result: await mockResult(), config: mockConfig });
  const stop = { kind: 'owner_pause', pass: 2, overseer_round: 0, request_seq: 3 };
  assert.ok(validate({ ...partial, stop }), JSON.stringify(validate.errors, null, 2));
  assert.equal(validate({ ...partial, stop: { ...stop, kind: 'owner_paused' } }), false, 'a made-up kind is rejected');
  assert.equal(validate({ ...partial, stoppedBy: 'owner_paused', stop }), false);
  assert.match(readFileSync(join(root, 'types', 'index.d.ts'), 'utf8'), /export type RunStatus =[^;]*'owner_paused'/);
});

// OS-6: the readers that word a stop (the SW-1 and SW-2 shapes of test/stop-cause-words.test.js, which loops over every cause and so already covers owner_pause for "no undefined"): a paused run reads as waiting for the person, not as a stop nobody waits for
test('OS-6 the handoff banner and the spend report say a paused run waits for the person, with no "undefined"', async () => {
  const { stopState } = await import('../src/handoff-from-run.js');
  const { spendReport } = await import('../src/spend.js');
  const dir = tmp(); const RUN = '2026-11-04T10-00-00-000Z'; const run = join(dir, 'runs', RUN);
  try {
    mkdirSync(run, { recursive: true });
    writeFileSync(join(run, 'run.json'), JSON.stringify({ chain: 'mock', task: 'tasks/t.md' }));
    stopFiles.writeStoppedMarker(run, { stoppedBy: 'owner_pause', beforeFirstCall: false, spentUsd: 0, resumeAfterStop: true, requestSeq: 1 });
    writeFileSync(join(run, 'report-partial.json'), '{}');
    assert.match(stopState(run).reason, /waiting for the person's choice/);
    assert.doesNotMatch(stopState(run).reason, /undefined/);
    const row = spendReport(join(dir, 'runs'), { days: 3650, now: Date.parse('2026-11-05T00:00:00Z') }).runs.find(r => r.id === RUN);
    assert.ok(row, 'the folder is a run row');
    assert.match(String(row.state), /waiting for the person's choice/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
