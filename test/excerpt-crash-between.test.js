// 0.8.4 D10 (plan A T5.5), a crash between the rows of an answered excerpt gate and its use line (C&C 09 Nov 2026, ruling (b)), through the REAL command: the next resume writes the missing line and records no row; a damaged record
// is refused with a sentence that names the gate. The cases of the pure function: test/excerpt-pause.test.js. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setHeldForTest } from '../src/held-roles.js';
import { submitStageAnswer } from '../src/stage-submission.js';
import { answerGate, readGateAnswer, readGateText } from '../src/gate.js';
import { screenExcerptsOf } from '../src/excerpt-approval.js';
import { deriveRunStatus } from '../src/run-status.js';
import * as RS from '../src/run-status.js';   // a namespace import: excerptSwitchForSubmit is absent at the older commits this file is run against, and the option is then undefined there
import { LEDGER_FILE } from '../src/gate-ledger.js';
import { excerptBatch } from '../src/excerpt-resume.js';
import { pauseAtApproval } from '../src/excerpt-pause.js';
import { appendExcerpts } from '../src/excerpt-record.js';
import * as H from './held-prompts/held-084-a.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const preload = join(root, 'test', 'helpers', 'held-excerpt-preload.js');
const CHAIN = {
  name: 'reqs', maxRounds: 3, signoff: 'unanimous', criteria: ['It states the assumptions it was written under.'],
  estimate: { promptTokens: 1000, draftTokens: 1000, critiqueTokens: 300 },
  seats: { builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'external', model: 'claude-code-session' }, critics: [{ provider: 'mock', model: 'mock-critic-requests', lab: 'rq' }] },
};
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-priv-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'src')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 'x.md'), 'Plan a tea service for twelve guests.\n');
  writeFileSync(join(dir, 'src', 'b.js'), 'bravo one\nbravo two\nbravo three\n');
  writeFileSync(join(dir, 'chains', 'reqs.json'), JSON.stringify(CHAIN, null, 2));
  return dir;
}
const run = (dir, args, env = {}) => spawnSync(process.execPath, ['--import', preload, cli, ...args], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH, HOME: dir, ...env }, timeout: 120_000 });
const onlyRun = dir => join(dir, 'runs', readdirSync(join(dir, 'runs')).filter(d => !d.includes('.'))[0]);
const lines = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const answerStage = runDir => { setHeldForTest({ ...H }); try { return submitStageAnswer(runDir, 'revise-1', '# Plan\n\nREVISED MOCK DELIVERABLE\n\nBody.\n\nAssumptions: none.\n', { excerptSwitch: RS.excerptSwitchForSubmit, excerptAnswers: [{ request: 1 }] }); } finally { setHeldForTest(null); } };
const prompts = log => readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

function toTheGate() {
  const dir = project(); const log = join(dir, 'prompts.jsonl');
  const env = { THC_PROMPT_LOG: log, THC_HELD_ALL: '1' };
  const first = run(dir, ['--chain', 'reqs', '--task', 'tasks/x.md', '--approve-excerpts'], env);
  assert.equal(first.status, 3, `${first.stdout.slice(-300)}${first.stderr.slice(-300)}`);
  const runDir = onlyRun(dir);
  answerStage(runDir);
  const second = run(dir, ['--resume', runDir], env);
  assert.equal(second.status, 26, `${second.stdout.slice(-400)}${second.stderr.slice(-400)}`);
  return { dir, runDir, log, env, second };
}

// CRASH BETWEEN the rows and the use line, through the real command (C&C 09 Nov 2026, ruling (b)): the rows of an answered gate are on disk and the gate has no use line.
function crashShape(tamper = x => x) {
  const t = toTheGate();
  const g = readGateAnswer(t.runDir, 'g1').gate;
  const done = answerGate(t.runDir, 'g1', { channel: 'cli', shownSha256: g.sha256, decision: 'approved', actor: 'alice', tty: true, excerptAnswers: [{ id: 'E-1', decision: 'approve' }] });
  assert.equal(done.ok, true, JSON.stringify(done));
  const answer = readGateAnswer(t.runDir, 'g1').answer;
  setHeldForTest({ ...H });
  try {
    const batch = excerptBatch({ runDir: t.runDir, root: t.dir, hold: true });
    const step = pauseAtApproval({ batch: batch.inputs, firstId: batch.firstId, gate: { max: 20, waiting: () => [{ id: 'g1', status: 'approved', excerpts: g.excerpts, answer }], request: () => { throw new Error('not asked'); } } });
    assert.equal(step.action, 'record');
    appendExcerpts(t.runDir, step.rows.map(tamper));   // the append that happened before the process died; no use line follows
  } finally { setHeldForTest(null); }
  return t;
}
const usedLines = runDir => (readFileSync(join(runDir, LEDGER_FILE), 'utf8').match(/"event":"excerpts_recorded"/g) || []).length;

test('CRASH BETWEEN the rows and the use line: the next resume writes the missing line for the answered gate, appends no row, goes on and shows the text to the later judges', () => {
  const { dir, runDir, log, env } = crashShape();
  try {
    assert.equal(lines(join(runDir, 'excerpts.jsonl')).length, 1);
    assert.equal(usedLines(runDir), 0, 'the crash shape: rows, no use line');
    const resumed = run(dir, ['--resume', runDir], env);
    assert.ok([0, 3].includes(resumed.status), `${resumed.status} ${resumed.stdout.slice(-300)}${resumed.stderr.slice(-300)}`);
    assert.equal(lines(join(runDir, 'excerpts.jsonl')).length, 1, 'no row is added');
    assert.equal(usedLines(runDir), 1, 'the gate reads as used');
    assert.equal(deriveRunStatus(runDir, null) === 'awaiting_excerpt_approval', false);
    const again = run(dir, ['--resume', runDir], env);
    assert.ok(![2, 26].includes(again.status), `a second resume finds the gate used and is not refused: ${again.status} ${again.stderr.slice(-300)}`);
    assert.equal(usedLines(runDir), 1, 'a second resume writes no second use line');
    assert.equal(lines(join(runDir, 'excerpts.jsonl')).length, 1, 'and no row');
    const later = prompts(log).filter(p => /^panel-2-/.test(p.label));
    assert.ok(later.length > 0 && later.every(p => p.user.includes('bravo one\nbravo two')), 'the judges after the resume were shown the recorded text');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CRASH BETWEEN, a damaged record: a row at the gate\'s id that is not the text it bound refuses the resume (exit 2) with a sentence that names the gate; no use line is written', () => {
  const { dir, runDir, env } = crashShape(x => ({ ...x, text: 'tampered' }));
  try {
    const resumed = run(dir, ['--resume', runDir], env);
    assert.equal(resumed.status, 2, `${resumed.status} ${resumed.stdout.slice(-300)}${resumed.stderr.slice(-300)}`);
    assert.match(resumed.stderr, /The record of this run is damaged: gate g1 was answered, but excerpts\.jsonl holds only some of its excerpts, or holds them with other contents \(E-1\)\. Nothing was run and nothing was spent\./);
    assert.equal(usedLines(runDir), 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
