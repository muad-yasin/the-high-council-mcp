// ROADMAP 83 fixes (C&C thcmcp-6d, 20 Okt 2026, after the gate): every place that would show the overseer's early yes as an ordinary sign-off labels it, and every place that says "not agreed" for an early finish says "finished early by the
// session". Offline, $0.
//  ER-1 the live status: the overseer's yes to a proposal is `early_yes`, not `signed` (its objection stays `objected`); an ordinary verdict event is unchanged.
//  ER-2 the viewer (src/ui/server.js): the reply file of the top layer in the early pass is labelled `early`; the pass-1 reply is not.
//  ER-3 the verdict words: headline, run_status line, BOARD.md section; an ordinary not-agreed report keeps its words.
//  ER-4 `council handoff --from-run` keeps the builder tasks: derived from dispute.open_objections (the same N), what the reviser did from stop.items by id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const server = resolve(dirname(fileURLToPath(import.meta.url)), '../src/ui/server.js');
const STOP = { kind: 'early_finish', pass: 2, overseer_round: 1, chosen: 'early', items: [{ id: 'O-aaaaaaaa', lab: 'l1', handled: 'declined' }], overseer: ['l3'] };
const REPORT = { passed: false, stop: STOP, dispute: { ran: true, reason: 'early_finish', open_objections: [{ criterion: 'It names a limit.', lab: 'l1', problem: 'No limit.', id: 'O-aaaaaaaa' }] } };

test('ER-1: the live status of the overseer\'s answer to a proposal is early_yes, never signed', async () => {
  const { classifyVerdictEvent } = await import('../src/run-state.js');
  assert.equal(classifyVerdictEvent({ passed: true, earlyAnswer: true }), 'early_yes');
  assert.equal(classifyVerdictEvent({ passed: false, earlyAnswer: true }), 'objected');
  assert.equal(classifyVerdictEvent({ passed: true }), 'signed');
});

test('ER-2: the viewer labels the early pass\'s top-layer reply, and only that one', async () => {
  const work = mkdtempSync(join(tmpdir(), 'thc-ef-viewer-'));
  const id = '2026-01-01T00-00-00-000Z'; const dir = join(work, 'runs', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ ...REPORT, stages: [{ label: 'panel-1-l1', lab: 'l1' }, { label: 'panel-2-l3', lab: 'l3' }] }));
  const ok = JSON.stringify({ meets: true, criteria: [], failures: [], verdict_line: 'ok' });
  writeFileSync(join(dir, 'panel-1-l1.md'), ok); writeFileSync(join(dir, 'panel-2-l3.md'), ok);
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [server], { env: { ...process.env, PORT: String(port), COUNCIL_WORKDIR: work }, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await new Promise((res, fail) => { child.stdout.on('data', d => { if (String(d).includes('relay viewer')) res(); }); child.on('exit', c => fail(new Error(`viewer exited (${c})`))); });
    const body = await new Promise((res, fail) => { const r = request({ host: '127.0.0.1', port, path: `/api/runs/${id}`, headers: { host: `127.0.0.1:${port}` } }, x => { let b = ''; x.on('data', d => { b += d; }); x.on('end', () => res(b)); }); r.on('error', fail); r.end(); });
    const panels = JSON.parse(body).panels;
    assert.equal(panels[2][0].early, true, 'the early answer is labelled');
    assert.equal(panels[1][0].early, undefined, 'an ordinary reply is not');
  } finally { child.kill(); rmSync(work, { recursive: true, force: true }); }
});

test('ER-3: the headline, the run_status line and the BOARD say "finished early by the session"; an ordinary not-agreed report is unchanged', async () => {
  const { verdictHeadline, earlyFinishWords } = await import('../src/verdict-headline.js');
  const { finishedRunState } = await import('../src/run-status.js');
  const { renderBoardMd } = await import('../src/report-shape.js');
  const h = verdictHeadline(REPORT);
  assert.equal(h.label, 'FINISHED EARLY');
  assert.match(h.text, /finished early by the session, NOT agreement/);
  assert.match(finishedRunState(REPORT), /finished early by the session \(not agreed\)/);
  assert.match(finishedRunState(REPORT), /^done: open objections/, 'the old sentence stays the start');
  const board = renderBoardMd({ runId: 'r', result: { stop: STOP, passed: false } });
  assert.match(board, /## Finished early by the session\n\nfinished early by the session, NOT agreement/);
  const plain = { passed: false };
  assert.equal(verdictHeadline(plain).label, 'OPEN OBJECTIONS');
  assert.equal(finishedRunState(plain), 'done: open objections');
  assert.equal(earlyFinishWords({ ...REPORT, passed: true }), null, 'a passed run is never an early finish');
  assert.equal(renderBoardMd({ runId: 'r', result: { passed: false } }), '');
});

test('ER-4: the builder tasks of a rebuilt handoff come from dispute.open_objections (same N); stop.items only says what the reviser did; no early finish gives none', async () => {
  const { earlyTasksFromReport, withBuilderTasks } = await import('../src/chain.js');
  const tasks = earlyTasksFromReport(REPORT);
  assert.equal(tasks.length, REPORT.dispute.open_objections.length);
  assert.deepEqual({ id: tasks[0].id, lab: tasks[0].lab, handled: tasks[0].handled }, { id: 'O-aaaaaaaa', lab: 'l1', handled: 'declined' });
  const out = withBuilderTasks('# Plan\n', tasks);
  assert.match(out, /^- BT-1 \(O-aaaaaaaa, raised by l1; the reviser declined it\): It names a limit\. - No limit\.$/m);
  assert.equal(earlyTasksFromReport({ passed: false, dispute: REPORT.dispute }), null);
  assert.equal(earlyTasksFromReport({ ...REPORT, dispute: { open_objections: [] } }), null);
});
