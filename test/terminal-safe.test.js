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
import * as terminalSafeModule from '../src/terminal-safe.js';

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
      selfReview: 'allowed', // superseded by the audit decision cnc-chains-lint F1: the writer and the critic are the same external session, which lint rule 12 now sees; this fixture says so in writing
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
    // CHANGED ACCEPTED TEST (decider-readiness apply patch fix-up, 24 Okt 2026; the full suite on fad02049 listed it, #3519). OLD: the hand-written reply carried only the verdict. NEW: once src/roles.js records the verdict-envelope sentence the stage prompt carries a review_id and a draft_id, and a reply without them is not counted (unheard), so the verdict text never reached the log; the reply now carries the pair read from the call's own record (`<label>.envelope.json`), as the person or session answering would copy it from the prompt. Without a record (the words not recorded) it carries none, as before. WHY: the property under test is that a hostile verdict line is logged clean; an unheard reply never reached the log.
    const envFile = join(runDir, panel.replace(/\.md$/, '.envelope.json'));
    const ids = existsSync(envFile) ? (({ review_id, draft_id }) => ({ review_id, draft_id }))(JSON.parse(readFileSync(envFile, 'utf8'))) : {};
    writeFileSync(join(runDir, panel), JSON.stringify({ ...ids, meets: false, verdict_line: HOSTILE, criteria: [], failures: [{ criterion: `crit ${HOSTILE}`, problem: `prob ${HOSTILE}` }] }));
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

test('item 7: terminalSafeMarked shows every hidden character in place as [U+XXXX] after the display filter, leaves an emoji sequence alone, and the tree gate text builders use it (a bare terminalSafe there would hash text a person cannot read)', () => {
  const cp = (...a) => String.fromCodePoint(...a);
  assert.equal(typeof terminalSafeModule.terminalSafeMarked, 'function');
  const marked = terminalSafeModule.terminalSafeMarked;
  assert.equal(marked?.(`a${cp(0x200B)}b${cp(0x202E)}c${cp(0x7)}d${cp(0xFE00, 0x3164)}`), 'a[U+200B]bcd[U+FE00][U+3164]', 'controls and bidi are removed first, hidden characters are marked');
  const emoji = `${cp(0x1F468, 0x200D, 0x1F469)} ${cp(0x1F600, 0xFE0F)} plain text`;
  assert.equal(marked?.(emoji), emoji);
  assert.equal(marked?.('plain'), 'plain');
  // the builders of the tree gate texts (what the gate hashes) must not call the bare filter any more
  for (const f of ['tree-approve.js', 'tree-check.js', 'tree-decide.js']) {
    const src = readFileSync(join(root, 'src', f), 'utf8');
    assert.equal(/\bterminalSafe\(/.test(src), false, `${f} builds a gate text with the bare terminalSafe`);
    assert.equal(/\bterminalSafeMarked\(/.test(src), true, `${f} uses terminalSafeMarked`);
  }
  // the two other builders of a gate text: no `text: terminalSafe(` (tree-decide-stop.js keeps one bare call for the decision text the person TYPES; it is the person's own text, shown marked wherever it is quoted back)
  for (const f of ['tree-decide-stop.js', 'tree-decide-accept.js']) assert.equal(/text: terminalSafe\(/.test(readFileSync(join(root, 'src', f), 'utf8')), false, `${f} builds a gate text with the bare terminalSafe`);
});
