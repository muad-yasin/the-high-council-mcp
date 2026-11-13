// 0.8.4 D38 (the GO's "prove one end-to-end path first"; C&C 09 Nov 2026): the whole path through the REAL command, spawned, with the channel's words recorded by a preload (test/helpers/held-excerpt-preload.js).
// A run pauses at an external stage; the session answers it with `session_reads` naming a key-bearing file and a clean one; the next `--resume` stops at the excerpt pause (exit 11, the excerpt's own text, nothing
// recorded); then (A) --drop-excerpt records ONE withheld line, the clean read is recorded and shown to a later seat, and the dropped text is in NO prompt a seat was sent; or (B, the swapped input) --continue
// records the same text and a later seat's prompt DOES carry it. Offline, $0 (mock-external).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setHeldForTest } from '../src/held-roles.js';
import { submitStageAnswer } from '../src/stage-submission.js';
import { excerptSwitchForSubmit } from '../src/run-status.js';
import { excerptsBlock, sessionReadsField } from './held-prompts/held-084-a.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const preload = join(root, 'test', 'helpers', 'held-excerpt-preload.js');
const fill = (n, set) => Array.from({ length: n }, (_, i) => set[i % set.length]).join('');
const VALUE = fill(64, '0a1b2c3d4e5f6789');
const KEY_LINE = ['OPENROUTER_API_KEY=', 'sk', '-or-v1-', VALUE].join('');

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-whole-path-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'tasks', 'x.md'), 'Plan a tea service for twelve guests.\n');
  writeFileSync(join(dir, 'src', 'k1.js'), `const x = 1;\n${KEY_LINE}\n`);
  writeFileSync(join(dir, 'src', 'b.js'), 'bravo one\nbravo two\n');
  return dir;
}
const run = (dir, args, extraEnv = {}) => spawnSync(process.execPath, ['--import', preload, cli, ...args], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH, HOME: dir, ...extraEnv }, timeout: 120_000 });
const onlyRun = dir => join(dir, 'runs', readdirSync(join(dir, 'runs')).filter(d => !d.includes('.'))[0]);
const waiting = runDir => readdirSync(runDir).filter(f => /^NEEDS-.*\.md$/.test(f) && !existsSync(join(runDir, f.slice('NEEDS-'.length)))).map(f => f.slice('NEEDS-'.length, -'.md'.length));
const lines = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const reads = [{ path: 'src/k1.js', why: 'To check the key handling.' }, { path: 'src/b.js', lines: '1-2', why: 'To check the second file.' }];

// a project, a run paused at its external stage, answered with session_reads; returns what the next steps need
function pausedAndAnswered() {
  const dir = project();
  const first = run(dir, ['--chain', 'mock-external', '--task', 'tasks/x.md']);
  assert.equal(first.status, 3, `expected an external pause: ${first.stdout.slice(-300)}${first.stderr}`);
  const runDir = onlyRun(dir); const [stage] = waiting(runDir);
  setHeldForTest({ excerptsBlock, sessionReadsField });
  try { submitStageAnswer(runDir, stage, '# Plan\n\nBody.\n', { excerptSwitch: excerptSwitchForSubmit, sessionReads: reads }); } finally { setHeldForTest(null); }
  return { dir, runDir, stage, log: join(dir, 'prompts.jsonl'), before: promptHashes(runDir) };
}
// the stage files that exist when the run is handed back to the command, with the hash of the prompt each was asked (C&C 09 Nov, condition 4: a stage that ran before the pause replays with its hash unchanged)
const promptHashes = runDir => Object.fromEntries(readdirSync(runDir).filter(f => /\.usage\.json$/.test(f) && !/\.late\./.test(f)).map(f => [f, JSON.parse(readFileSync(join(runDir, f), 'utf8')).promptHash ?? null]));

test('the excerpt pause: exit 11, the excerpt\'s own text, the stop label excerpt-E-1, nothing recorded, no seat prompt carries the key', () => {
  const { dir, runDir, stage, log } = pausedAndAnswered();
  try {
    const r = run(dir, ['--resume', runDir], { THC_PROMPT_LOG: log });
    assert.equal(r.status, 11, `${r.stdout.slice(-400)}${r.stderr.slice(-400)}`);
    const text = readFileSync(join(runDir, 'STOPPED-secret.md'), 'utf8');
    assert.match(text, /^# Run paused: a credential-shaped string in an excerpt/);
    assert.match(text, /--drop-excerpt/); assert.doesNotMatch(text, /--finish/);
    assert.equal(text.includes(VALUE), false, 'the value is not repeated');
    const stop = JSON.parse(readFileSync(join(runDir, 'secret-stop.json'), 'utf8'));
    assert.deepEqual([stop.label, stop.phase], ['excerpt-E-1', 'before']);
    assert.equal(existsSync(join(runDir, 'excerpts.jsonl')), false, 'a hit records nothing, not even the clean second read');
    assert.equal(lines(log).length, 0, 'the pause came before any stage: no seat was sent anything');
    assert.ok(stage);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('DROP (A): --drop-excerpt records ONE withheld line, records the clean read, the run goes on, a later seat sees the clean text, and NO prompt or file carries the dropped key', () => {
  const { dir, runDir, stage, log, before } = pausedAndAnswered();
  try {
    assert.equal(run(dir, ['--resume', runDir], { THC_PROMPT_LOG: log }).status, 11);
    const r = run(dir, ['--resume', runDir, '--drop-excerpt'], { THC_PROMPT_LOG: log });
    assert.ok([0, 3].includes(r.status), `the run goes on: ${r.status} ${r.stdout.slice(-300)}${r.stderr.slice(-300)}`);
    const rows = lines(join(runDir, 'excerpts.jsonl'));
    assert.deepEqual(rows.map(e => [e.id, e.path, e.approval.status, e.text === null, e.answered_stage]), [['E-1', 'src/k1.js', 'withheld', true, stage], ['E-2', 'src/b.js', 'not_required', false, stage]]);
    assert.equal(rows[0].file_sha256, null); assert.equal(rows[0].scans, null);
    const saved = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
    assert.deepEqual(saved.secretDrops.map(d => d.label), ['excerpt-E-1']);
    const prompts = lines(log);
    assert.ok(prompts.some(p => p.user.includes('bravo one')), 'a later seat was shown the clean excerpt (else the next assertion proves nothing)');
    assert.equal(prompts.some(p => p.user.includes(VALUE) || p.user.includes('OPENROUTER_API_KEY')), false, 'the dropped text is in no prompt a seat was sent');
    for (const f of readdirSync(runDir)) if (/\.(md|json|jsonl)$/.test(f)) assert.equal(readFileSync(join(runDir, f), 'utf8').includes(VALUE), false, `${f} holds the dropped value`);
    assert.deepEqual(['STOPPED-secret.md', 'secret-stop.json'].filter(f => existsSync(join(runDir, f))), [], 'the pause records are gone once the run went on (run_status must not keep reporting a pause)');
    const after = promptHashes(runDir);
    const ranBefore = Object.entries(before).filter(([, h]) => h !== null);
    assert.ok(ranBefore.length > 0, 'stages with a recorded prompt hash ran before the pause');
    for (const [f, h] of ranBefore) assert.equal(after[f], h, `${f}: a stage that ran before the pause replays with its prompt hash unchanged`);
    assert.ok(Object.keys(after).length > Object.keys(before).length, 'stages after the pause ran');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CONTINUE (B, the swapped input of the drop red): --continue records the same text as continued_by_person and a later seat\'s prompt DOES carry it', () => {
  const { dir, runDir, stage, log, before } = pausedAndAnswered();
  try {
    assert.equal(run(dir, ['--resume', runDir], { THC_PROMPT_LOG: log }).status, 11);
    const r = run(dir, ['--resume', runDir, '--continue'], { THC_PROMPT_LOG: log });
    assert.notEqual(r.status, 11, 'D20: one stop per hit: the excerpt the person continued past does not stop the run again at the pre-send key scan of the prompts that carry it');
    assert.ok([0, 3].includes(r.status), `the run goes on: ${r.status} ${r.stdout.slice(-300)}${r.stderr.slice(-300)}`);
    const rows = lines(join(runDir, 'excerpts.jsonl'));
    assert.deepEqual(rows.map(e => [e.id, e.approval.status, e.scans.key_shape]), [['E-1', 'not_required', 'continued_by_person'], ['E-2', 'not_required', 'clear']]);
    assert.equal(rows[0].answered_stage, stage);
    assert.deepEqual(['STOPPED-secret.md', 'secret-stop.json'].filter(f => existsSync(join(runDir, f))), [], 'the pause records are gone once the run went on');
    assert.ok(lines(log).some(p => p.user.includes('OPENROUTER_API_KEY')), 'the continued text IS in a later seat\'s prompt');
    const after = promptHashes(runDir);
    for (const [f, h] of Object.entries(before).filter(([, x]) => x !== null)) assert.equal(after[f], h, `${f}: a stage that ran before the pause replays with its prompt hash unchanged (the changed-prompt rule of 05 Nov would otherwise re-run it)`);
    const labels = new Set(lines(log).map(p => p.label));
    assert.ok(lines(log).filter(p => p.user.includes('OPENROUTER_API_KEY')).every(p => !Object.keys(before).includes(`${p.label}.usage.json`)), 'only stages after the pause carry the block');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
