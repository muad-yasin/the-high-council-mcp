// 0.8.4 D10 (plan A T5.5), the pause unit through the REAL command: with --approve-excerpts, a judge's request that the handling session answers with a paste waits at an excerpt_approval gate (exit 26), nothing is
// recorded or shown until the person answers, and the resume after the answer applies it (approve, or decline-all) and goes on; the privacy switch off is today's behaviour (test/text-requests-path.test.js). Offline, $0.
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

test('WITH THE SWITCH ON: the paste waits at one gate (exit 26): nothing is recorded, no prompt carries the text, run_status says awaiting_excerpt_approval; the answered gate is applied by the next resume and the run goes on', () => {
  const { dir, runDir, log, env, second } = toTheGate();
  try {
    assert.match(second.stderr, /This run is stopped at an approval of excerpts of your project \(gate g1\): it waits for your answers\./);
    assert.deepEqual(lines(join(runDir, 'excerpts.jsonl')), [], 'nothing is recorded before the person answers');
    assert.equal(deriveRunStatus(runDir, null), 'awaiting_excerpt_approval');
    const screen = readFileSync(join(runDir, 'excerpt-approval-1.txt'), 'utf8');
    assert.ok(screen.includes('the judge rq asked to see lines 1-2 of src/b.js') && screen.includes('bravo one') && screen.includes('bravo two'), screen);
    assert.equal(run(dir, ['--resume', runDir], env).status, 26, 'a resume before the answer is refused again');
    const g = readGateAnswer(runDir, 'g1').gate;
    assert.deepEqual(screenExcerptsOf(readGateText(runDir, g.text).toString('utf8'), g.excerpts), ['bravo one\nbravo two'], 'the terminal answer path can read the texts back from the screen the gate stored');
    const answered = answerGate(runDir, 'g1', { channel: 'cli', shownSha256: g.sha256, decision: 'approved', actor: 'alice', tty: true, excerptAnswers: [{ id: 'E-1', decision: 'approve' }] });
    assert.equal(answered.ok, true, JSON.stringify(answered));
    const third = run(dir, ['--resume', runDir], env);
    assert.ok([0, 3].includes(third.status), `${third.status} ${third.stdout.slice(-300)}${third.stderr.slice(-300)}`);
    const [e] = lines(join(runDir, 'excerpts.jsonl'));
    assert.deepEqual([e.id, e.origin, e.text, e.approval.status, e.approval.channel, e.approval.actor, e.answered_stage], ['E-1', 'panel-1-rq', 'bravo one\nbravo two', 'approved', 'cli', 'alice', 'revise-1']);
    const later = prompts(log).filter(p => /^panel-2-/.test(p.label));
    assert.ok(later.length > 0 && later.every(p => p.user.includes('bravo one\nbravo two')), 'the judges after the approval were shown the text');
    const ledger = readFileSync(join(runDir, LEDGER_FILE), 'utf8');
    assert.match(ledger, /"event":"excerpts_recorded"/);
    assert.equal(deriveRunStatus(runDir, null) === 'awaiting_excerpt_approval', false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('WITH THE SWITCH ON, declining the gate refuses every waiting excerpt: the line is recorded refused, no prompt carries the text, and the run goes on', () => {
  const { dir, runDir, log, env } = toTheGate();
  try {
    const g = readGateAnswer(runDir, 'g1').gate;
    const answered = answerGate(runDir, 'g1', { channel: 'cli', shownSha256: g.sha256, decision: 'declined', actor: 'alice', reason: 'Not these.', tty: true });
    assert.equal(answered.ok, true, JSON.stringify(answered));
    const third = run(dir, ['--resume', runDir], env);
    assert.ok([0, 3].includes(third.status), `${third.status} ${third.stdout.slice(-300)}${third.stderr.slice(-300)}`);
    const [e] = lines(join(runDir, 'excerpts.jsonl'));
    assert.deepEqual([e.text, e.approval.status, e.approval.reason, e.approval.channel], [null, 'refused', 'Not these.', 'cli']);
    assert.ok(prompts(log).length > 0 && prompts(log).every(p => !p.user.includes('bravo one')), 'the text was never sent to a seat');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('STRANDING (C&C 09 Nov 2026, option a): 21 texts at one pause with the switch on get TWO gates (20 and 1); a resume with one unanswered is refused naming the count; the resume after both are answered records all 21 and uses both gates', () => {
  const dir = project(); const log = join(dir, 'prompts.jsonl');
  const env = { THC_PROMPT_LOG: log, THC_HELD_ALL: '1' };
  try {
    assert.equal(run(dir, ['--chain', 'reqs', '--task', 'tasks/x.md', '--approve-excerpts'], env).status, 3);
    const runDir = onlyRun(dir);
    setHeldForTest({ ...H });
    try { submitStageAnswer(runDir, 'revise-1', '# Plan\n\nREVISED MOCK DELIVERABLE\n\nBody.\n\nAssumptions: none.\n', { excerptSwitch: RS.excerptSwitchForSubmit, sessionReads: Array.from({ length: 21 }, (_, i) => ({ path: 'src/b.js', lines: '1-2', why: `Read number ${i + 1}.` })) }); } finally { setHeldForTest(null); }
    const second = run(dir, ['--resume', runDir], env);
    assert.equal(second.status, 26, `${second.stdout.slice(-400)}${second.stderr.slice(-400)}`);
    assert.match(second.stderr, /\(gate g1\): it waits for your answers, and 1 more wait\./);
    assert.deepEqual(lines(join(runDir, 'excerpts.jsonl')), []);
    const g1 = readGateAnswer(runDir, 'g1').gate; const g2 = readGateAnswer(runDir, 'g2').gate;
    assert.deepEqual([g1.excerpts.length, g2.excerpts.length], [20, 1]);
    assert.notEqual(g1.sha256, g2.sha256, 'each gate has its own screen and hash');
    const approve = g => ({ channel: 'cli', shownSha256: g.sha256, decision: 'approved', actor: 'alice', tty: true, excerptAnswers: g.excerpts.map(e => ({ id: e.id, decision: 'approve' })) });
    assert.equal(answerGate(runDir, 'g1', approve(g1)).ok, true);
    const third = run(dir, ['--resume', runDir], env);
    assert.equal(third.status, 26, 'one gate still waits: refused');
    assert.match(third.stderr, /\(gate g2\): it waits for your answers\./);
    assert.deepEqual(lines(join(runDir, 'excerpts.jsonl')), [], 'nothing is applied until every gate is answered');
    assert.equal(answerGate(runDir, 'g2', approve(g2)).ok, true);
    const fourth = run(dir, ['--resume', runDir], env);
    assert.ok([0, 3].includes(fourth.status), `${fourth.status} ${fourth.stdout.slice(-300)}${fourth.stderr.slice(-300)}`);
    const rows = lines(join(runDir, 'excerpts.jsonl'));
    assert.equal(rows.length, 22, '21 reads and the judge\'s request, which the answer left out');
    assert.ok(rows.slice(0, 21).every(e => e.approval.status === 'approved' && e.request_kind === 'session_read'));
    assert.deepEqual([rows[21].id, rows[21].request_kind, rows[21].approval.status, rows[21].text], ['E-22', 'seat_request', 'unanswered', null], 'a row with no text takes an id and no slot at a gate');
    const ledger = readFileSync(join(runDir, LEDGER_FILE), 'utf8');
    assert.equal((ledger.match(/"event":"excerpts_recorded"/g) || []).length, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
