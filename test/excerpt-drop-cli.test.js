// 0.8.4 D38 (C&C 09 Nov 2026, Muad's yes to a drop route): `--drop-excerpt` answers a run paused at a key-shaped string in an EXCERPT, on the pause's own channel (a command typed at a terminal), beside --continue. Proved
// here: the pause text for an excerpt offers it and a stage pause does not; the command refuses it everywhere it does not apply, with nothing run; the help names it. The path that records the drop and goes on is
// test/excerpt-resume.test.js (the id pin and the DROP red). Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { secretPauseText, SECRET_TERMINAL_SENTENCE } from '../src/secret-pause.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const run = (dir, args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir }, encoding: 'utf8', timeout: 120_000 });
const finding = { part: 'user', line: 2, name: 'OpenRouter API key' };

test('the pause text for an excerpt offers --continue and --drop-excerpt, names the excerpt and the line, never says "stage" or "prompt" for it, and stays terminal-only; a stage pause does not mention the drop', () => {
  const ex = secretPauseText({ label: 'excerpt-E-3', findings: [finding], phase: 'before' }, { runId: 'r1', command: 'council' });
  assert.match(ex, /^# Run paused: a credential-shaped string in an excerpt/);
  assert.match(ex, /Excerpt `E-3` was about to be recorded with text shaped like a key/);
  assert.match(ex, /- line 2: OpenRouter API key/);
  assert.match(ex, /council --resume runs\/r1 --continue\n/);
  assert.match(ex, /council --resume runs\/r1 --drop-excerpt\n\nleaves this text out: it is recorded as withheld, no seat is shown it, and the run goes on without it\./);
  assert.ok(ex.includes(SECRET_TERMINAL_SENTENCE));
  assert.doesNotMatch(ex, /--finish/, 'a finish cannot arise at an excerpt pause');
  const stage = secretPauseText({ label: 'panel-1-a', findings: [finding], phase: 'before' }, { runId: 'r1', command: 'council' });
  assert.doesNotMatch(stage, /drop-excerpt/);
  assert.match(stage, /Stage `panel-1-a` was about to be sent/);
});

test('the command refuses --drop-excerpt where it does not apply, and nothing is run: alone without --resume, beside another choice, on a finished run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-drop-cli-'));
  try {
    mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 'tea.md'), '# Task\n\nPlan a tea service for twelve guests.\n');
    const a = run(dir, ['--chain', 'mock', '--task', 'tasks/tea.md', '--drop-excerpt']);
    assert.equal(a.status, 2); assert.doesNotMatch(a.stderr, /unknown/i); assert.match(a.stderr, /--drop-excerpt answers a run paused at an excerpt: use it with --resume <run folder>\. Nothing was run and nothing was spent\./);
    const first = run(dir, ['--task', join(dir, 'tasks', 'tea.md'), '--chain', 'mock']);
    assert.equal(first.status, 0, first.stderr.slice(-300));
    const id = readdirSync(join(dir, 'runs'))[0];
    const c = run(dir, ['--resume', join('runs', id), '--drop-excerpt']);
    assert.equal(c.status, 15); assert.match(c.stderr, /already finished \(it has a report\.json\)\. Nothing was run and nothing was spent\./);   // CHANGED ACCEPTED: OLD a finished run was refused with the drop's own sentence (exit 2); NEW the existing already-finished refusal (exit 15) comes first, before any choice is read. WHY: it was always first; the drop's sentence is shown for a run that is paused somewhere else, below
    writeFileSync(join(dir, 'tasks', 'ext.md'), '# Task\n\nPlan a tea service for twelve guests.\n');
    const paused = run(dir, ['--task', join(dir, 'tasks', 'ext.md'), '--chain', 'mock-external']);
    assert.equal(paused.status, 3, paused.stderr.slice(-300));
    const pid = readdirSync(join(dir, 'runs')).filter(n => n !== id && !n.includes('.'))[0];
    const d = run(dir, ['--resume', join('runs', pid), '--drop-excerpt']);
    assert.equal(d.status, 2); assert.match(d.stderr, /is not paused at an excerpt, so there is nothing to answer\. Nothing was run and nothing was spent\./);
    // CHANGED ACCEPTED: OLD "beside another choice" was tried on the FINISHED run (exit 2); NEW it is tried on the run paused at an external seat. WHY: the already-finished refusal (exit 15) comes first on a finished run, before any choice is read, so the rule "it is its own choice" is only reachable on a run that has not finished
    const b = run(dir, ['--resume', join('runs', pid), '--drop-excerpt', '--continue']);
    assert.equal(b.status, 2); assert.match(b.stderr, /--drop-excerpt is its own choice: give it alone\./);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('--help names the drop beside --continue', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-drop-cli-'));
  try {
    const h = run(dir, ['--help']);
    assert.equal(h.status, 0);
    assert.match(h.stdout.replace(/\s+/g, ' '), /--drop-excerpt answers a run paused at a credential-shaped string in an excerpt/);   // the help wraps its lines: the sentence is read with its line breaks and indents as single spaces
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
