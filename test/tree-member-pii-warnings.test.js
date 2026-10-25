// A tree member under `--pii-gate warn` keeps what the gate found (0.8.3 M6 S5b part A, commit 3; contract Review/Build_0.8.3/m6-closing/S5b_PII_Gate_And_Registration_Precheck_Contract.md section 3.6, C&C ruling 1 at gate 1):
// `warn` prints its findings with console.error in the member's process, and `api.run` keeps only the last lines of a child's output, so in an unattended sitting they are LOST. A member's CLI therefore also writes them to
// `WARNINGS.md` in its own run folder - the file the policy warnings already use - as TYPE, WHERE and LINE only, NEVER the matched value (not even the masked prefix the console line shows). A normal run is byte-identical: it
// prints as before and writes no such file. A finding is recorded once per run (a later sitting scans again; a line already in the file is not appended again, as the policy warning is not).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import * as api from '../src/api.js';
import { DEFAULT_HANDLERS, treeCommand } from '../src/tree-cli.js';
import * as preflight from '../src/run-preflight.js';   // a namespace, so a missing export fails the test that uses it, not the whole file
const { piiGateReport } = preflight; const piiWarningLines = (...a) => preflight.piiWarningLines(...a);
import { cli, installSplitRoot } from './helpers/tree-fixture.js';
import { pricedDebate } from './helpers/child-chains.js';

const made = [];
process.on('exit', () => { for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch { /* a leftover is a nuisance */ } } });
const MAIL = ['jane.doe', '@', 'mail-corp', '.de'].join('');
const SECRET = `sk_${'live_'}${'abcd'.repeat(6)}`;
const TASK = `Plan a tiny change. Contact ${MAIL} about it.\n`;
function work(task = TASK) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-mw-')); made.push(dir);
  mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 'x.md'), task);
  installSplitRoot(dir); writeFileSync(join(dir, 'chains', 'priced-debate.json'), JSON.stringify({ ...pricedDebate(), name: 'priced-debate' }, null, 2));
  return dir;
}
const io = () => { const stdin = new PassThrough(); const stdout = new PassThrough(); const stderr = new PassThrough(); let o = ''; let e = ''; stdout.on('data', d => { o += d; }); stderr.on('data', d => { e += d; }); return { stdin, stdout, stderr, out: () => o, err: () => e }; };
/** A real `tree start` whose root is run for real on the split-root chain (the plan handed as a draft); returns the root's run folder. */
async function startReal(dir, extra) {
  const d = io();
  const code = await treeCommand(['start', '--task', 'tasks/x.md', '--chain', 'split-root', '--child-chain', 'priced-debate', '--max-usd', '5', ...extra], { work: dir, ...d, handlers: { ...DEFAULT_HANDLERS, start: x => DEFAULT_HANDLERS.start({ ...x, deps: { startRun: o => api.run({ ...o, draft: 'plan.md', rounds: 1 }) } }) } });
  const id = readdirSync(join(dir, 'runs'))[0];
  return { code, out: d.out(), err: d.err(), runDir: join(dir, 'runs', id) };
}

test('MW-1 piiGateReport also returns the findings as DATA - where, type, line, column, and the pattern name of a secret - and nothing that carries the value (no masked prefix); its lines carry the same fields (fix-up 4: no masked prefix)', () => {
  const sources = [['the task file and --context documents', `Contact ${MAIL} now.\nKey ${SECRET}.\n`]];
  const r = piiGateReport({ mode: 'warn', sources });
  assert.ok(Array.isArray(r.findings) && r.findings.length === 2, JSON.stringify(r.findings));
  for (const f of r.findings) assert.deepEqual(Object.keys(f).sort(), f.type === 'secret' ? ['column', 'line', 'pattern', 'type', 'where'] : ['column', 'line', 'type', 'where'], JSON.stringify(f));
  const json = JSON.stringify(r.findings); assert.equal(json.includes(MAIL), false); assert.equal(json.includes('jane'), false, 'not even the masked prefix'); assert.equal(json.includes(SECRET), false);
  assert.equal(r.blocked, false); assert.match(r.lines[0], /PII-GATE \(warn\): \[the task file and --context documents\] line 1, col \d+: email \(value not shown\)/, 'the console line is the finding fields only');   // CHANGED ACCEPTED (PII fix-up 4, C&C ruling 18 Okt 2026). OLD: `looks like a email (masked: jane...)`, 'the console lines are what they were'. NEW: `email (value not shown)`. WHY: one builder (piiFindingLine) feeds the console, run.log and council-<id>.log, so nothing persisted carries a masked prefix.
  assert.deepEqual(piiGateReport({ mode: 'warn', sources: [['x', 'nothing here']] }).findings, []);
});

test('MW-2 piiWarningLines turns findings into WARNINGS.md lines: type, where, line, column (a secret adds the pattern NAME); never a value; nothing for no findings', () => {
  const lines = piiWarningLines([{ where: 'the task file and --context documents', type: 'email', line: 1, column: 29 }, { where: 'the task file and --context documents', type: 'secret', line: 2, column: 5, pattern: 'Stripe (sk_/rk_/pk_ live/test)' }]);
  assert.deepEqual(lines, ['- pii_gate (warn): the task file and --context documents line 1, col 29: possible email\n', '- pii_gate (warn): the task file and --context documents line 2, col 5: possible secret (Stripe (sk_/rk_/pk_ live/test))\n']);
  assert.deepEqual(piiWarningLines([]), []); assert.deepEqual(piiWarningLines(undefined), []);
  // a finding with a hostile label cannot add a line: control characters are removed
  assert.equal(piiWarningLines([{ where: 'a\nb', type: 'email', line: 1, column: 1 }]).length, 1); assert.doesNotMatch(piiWarningLines([{ where: 'a\n- injected: line', type: 'email', line: 1, column: 1 }])[0].slice(0, -1), /\n/);
});

test('MW-3 a tree MEMBER (the real root of `tree start --pii-gate warn`) writes the findings to WARNINGS.md in its own run folder: type, where and line, no value; the console line is as before', async () => {
  const dir = work();
  const r = await startReal(dir, ['--pii-gate', 'warn']);
  assert.equal(r.code, 0, r.err + r.out);
  const warnings = readFileSync(join(r.runDir, 'WARNINGS.md'), 'utf8');
  assert.match(warnings, /^- pii_gate \(warn\): the task file and --context documents line 1, col \d+: possible email$/m, warnings);
  assert.equal(warnings.includes(MAIL), false, 'the value is never written'); assert.equal(warnings.includes('jane'), false, 'nor its masked prefix');
  assert.match(r.err + r.out, /PII-GATE \(warn\)/, 'the console path is unchanged');
});

test('MW-4 a NORMAL run is byte-identical: --pii-gate warn prints its lines and writes no WARNINGS.md; a member whose task is clean writes none (a member under the typed `--pii-gate warn` keeps its findings; a tree with no flag stops at the root-task email since 19 Okt 2026)', async () => {
  const dir = work();
  const n = spawnSync(process.execPath, [cli, '--task', 'tasks/x.md', '--chain', 'mock', '--pii-gate', 'warn'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 120_000 });
  assert.equal(n.status, 0, n.stderr); assert.match(n.stderr, /PII-GATE \(warn\)/);
  const runDir = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  assert.equal(existsSync(join(runDir, 'WARNINGS.md')), false, 'a normal run writes no warnings file for the PII gate');
  const noMode = await startReal(work(), ['--pii-gate', 'warn']); assert.equal(noMode.code, 0, noMode.err);   // CHANGED (owner 19 Okt 2026): OLD: no flag, the tree warned by default. NEW: the default tree stops at the root task's email, so the warn case needs the typed flag.
  // CHANGED ACCEPTED TEST (PII warn by default, 18 Okt 2026). OLD: a member with no mode wrote no WARNINGS.md (the gate was off for it). NEW: it scans under warn like every run and keeps what it found there. WHY: owner via the caps session: "Warn by default sounds very good and very user friendly."
  assert.equal(existsSync(join(noMode.runDir, 'WARNINGS.md')), true, 'a member with no mode now warns and keeps its findings');
  const clean = await startReal(work('Plan a tiny change.\n'), ['--pii-gate', 'warn']); assert.equal(clean.code, 0, clean.err);
  assert.equal(existsSync(join(clean.runDir, 'WARNINGS.md')), false, 'nothing found, nothing written');
});

test('MW-5 (PII fix-up 4) a tree MEMBER never reads COUNCIL_PII_GATE: with a typo in its environment the real root still runs (exit 0) under the mode its tree recorded and keeps its findings', async () => {
  const before = process.env.COUNCIL_PII_GATE;
  process.env.COUNCIL_PII_GATE = 'hardstop';   // the root run is a child process and inherits this; `startReal` hands the start handler no setting, so only the member's own CLI sees the typo
  try {
    const r = await startReal(work(), ['--pii-gate', 'warn']);
    assert.equal(r.code, 0, r.err + r.out); assert.doesNotMatch(r.err + r.out, /is not a mode/);
    assert.match(readFileSync(join(r.runDir, 'WARNINGS.md'), 'utf8'), /pii_gate \(warn\)/);
  } finally { if (before === undefined) delete process.env.COUNCIL_PII_GATE; else process.env.COUNCIL_PII_GATE = before; }
});
