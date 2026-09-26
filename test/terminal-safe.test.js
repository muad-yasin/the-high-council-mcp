// Model text in the terminal and run.log (security scan 2026-09-26, THC #9). A reply's verdict line
// or objection holding an escape sequence, a carriage return or a bidi override reached the
// operator's terminal as-is. The CLI's log sinks now drop C0 controls (newline and tab kept), DEL,
// C1 controls and bidi controls; stage files and what the next seat is sent keep the text as it was.
// Offline: an external critic answered by hand, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { terminalSafe } from '../src/terminal-safe.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
const UNSAFE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F؜‎‏‪-‮⁦-⁩]/;
const HOSTILE = 'fine\u001b[2J\u001b]0;pwned\u0007 ‮evil‬ \rOVERPRINT \u009b31m';

test('terminalSafe keeps newlines, tabs and ordinary text, and drops control and bidi characters', () => {
  assert.equal(terminalSafe('a\tb\nc — ü ✓'), 'a\tb\nc — ü ✓');
  assert.equal(terminalSafe(HOSTILE), 'fine[2J]0;pwned evil OVERPRINT 31m');
  assert.ok(!UNSAFE.test(terminalSafe(HOSTILE)));
});

test('CLI: a critic\'s hostile verdict line is logged clean, and stored and forwarded unchanged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-terminal-safe-'));
  try {
    mkdirSync(join(dir, 'tasks'));
    mkdirSync(join(dir, 'chains'));
    writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n\nPlan a small note-taking app.\n');
    const ext = { provider: 'external', model: 'claude-code-session' };
    writeFileSync(join(dir, 'chains', 'ext-critic.json'), JSON.stringify({
      name: 'ext-critic', description: 'test', maxRounds: 2, signoff: 'unanimous',
      seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: ext, reviser: ext, critics: [{ ...ext, lab: 'ext' }] },
    }));
    const env = { PATH: process.env.PATH, HOME: dir };
    const run = args => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env, timeout: 60_000 });
    let r = run(['--chain', 'ext-critic', '--task', 'tasks/t.md']);
    assert.equal(r.status, 3, r.stderr);
    const runDir = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
    writeFileSync(join(runDir, 'build.md'), '# Plan\n\nA note app.\n');
    r = run(['--resume', runDir]);
    assert.equal(r.status, 3, r.stderr);
    const panel = readdirSync(runDir).find(f => /^NEEDS-panel-1-/.test(f)).slice('NEEDS-'.length);
    writeFileSync(join(runDir, panel), JSON.stringify({ meets: false, verdict_line: HOSTILE, criteria: [], failures: [{ criterion: `crit ${HOSTILE}`, problem: `prob ${HOSTILE}` }] }));
    r = run(['--resume', runDir]);
    assert.equal(r.status, 3, `pauses again for the reviser: ${r.stderr}`);
    const log = readFileSync(join(runDir, 'run.log'), 'utf8');
    assert.ok(log.includes('pwned') && log.includes('OVERPRINT'), 'the verdict text was logged');
    assert.ok(!UNSAFE.test(log), 'run.log holds no control or bidi characters');
    assert.ok(!UNSAFE.test(r.stdout), 'the terminal output holds none either');
    assert.ok(readFileSync(join(runDir, panel), 'utf8').includes('\\u001b'), 'the stage file is untouched');
    const needsRevise = readdirSync(runDir).find(f => /^NEEDS-revise-1/.test(f));
    assert.ok(needsRevise && existsSync(join(runDir, needsRevise)));
    assert.ok(readFileSync(join(runDir, needsRevise), 'utf8').includes('\u001b[2J'), 'the reviser is sent the objection unchanged');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
