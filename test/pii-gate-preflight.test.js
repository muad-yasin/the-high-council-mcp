// The PII gate, asked from ONE place (0.8.3 M6 S5b; C&C gate 1, 12 Oct): `piiGateReport` in src/run-preflight.js is the code the normal run's PII block ran inline in src/cli.js, extracted without changing a byte of what a normal run
// prints or which exit it takes (GOLD-3 pins that against the output recorded in test/fixtures/pii-bf39ec8.json: first captured at 374c36a, before the extraction, and bf39ec8 passed against THAT capture; e2d329f re-took it on top of bf39ec8 with an address that is not on a reserved domain, which moved two columns by one, so the file proves the output stayed as recorded since e2d329f, and the extraction's own evidence is bf39ec8's pass against the 374c36a capture; the file name is kept), so `council tree start` and a tree's registration pre-check ask the SAME question.
// To re-capture the golden file after an intended wording change: run the same CLI calls this test makes (`--task tasks/x.md --chain mock --max-usd 5` plus the case's flags, in a temp folder holding the task below), keep the exit
// status and the PII lines of stderr with the work folder's path replaced by <WORK>.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cli } from './helpers/tree-fixture.js';

const GOLD = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'pii-bf39ec8.json'), 'utf8'));
const TASK = 'Plan a tiny change. Contact jane.doe@mail-corp.de about it. Bank: IBAN DE89370400440532013000.\n';
const made = [];
process.on('exit', () => { for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch { /* a leftover is a nuisance */ } } });

// CHANGED ACCEPTED GOLDEN (the stop is the default, owner 18 Okt 2026 16:45, built 19 Okt): test/fixtures/pii-bf39ec8.json re-taken by the same four CLI calls. OLD: `hard_stop` ended `PII-GATE: refusing to run - 2 match(es) ... under --pii-gate hard-stop.` and `Fix the input, or rerun with --pii-gate warn / --allow-pii <type,...> to proceed deliberately.`; `off` (no flag) ran (exit 0, two warn lines). NEW: both stop (exit 11) with `PII-GATE: stopped - 2 match(es) found in ... Nothing was started, sent or spent.` and the way-on lines (`To send it anyway ... --allow-pii email,iban`); `warn` and `hard_stop_allow` are unchanged. WHY: the owner's rule; the per-finding lines are unchanged.
// CHANGED ACCEPTED GOLDEN (PII warn by default, 18 Okt 2026): the `off` case (no --pii-gate flag) recorded no PII lines; it now records the same lines as `warn` (the default). WHY: owner via the caps session: "Warn by default sounds very good and very user friendly."; test/fixtures/pii-bf39ec8.json `off.piiLines` was set to `warn.piiLines`.
// CHANGED ACCEPTED GOLDEN (PII fix-up 4, C&C ruling 18 Okt 2026): test/fixtures/pii-bf39ec8.json. OLD finding line: `line 1, col 29: looks like a email (masked: jane*****************)` (and `looks like a iban (masked: DE89******************)`). NEW: `line 1, col 29: email (value not shown)` / `iban (value not shown)`. WHY: one builder (src/run-preflight.js piiFindingLine) feeds the console, run.log and council-<id>.log, so nothing persisted carries a masked prefix. The exit codes, the order and the closing sentences are unchanged.
test('GOLD-3 the NORMAL run prints exactly what the golden file records (see the header: first captured at 374c36a) for --pii-gate hard-stop, --pii-gate warn, hard-stop with an allow-list, and no gate (the extraction of the PII block changed nothing)', () => {
  for (const [name, g] of Object.entries(GOLD)) {
    const dir = mkdtempSync(join(tmpdir(), 'thc-pii-')); made.push(dir);
    mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 'x.md'), TASK);
    const r = spawnSync(process.execPath, [cli, '--task', 'tasks/x.md', '--chain', 'mock', '--max-usd', '5', ...g.args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 120_000 });
    const norm = s => s.split(dir).join('<WORK>');
    assert.equal(r.status, g.status, `${name}: ${r.stderr}`);
    assert.deepEqual(norm(r.stderr).split('\n').filter(l => /PII-GATE|--pii-gate|PII/.test(l)), g.piiLines, name);
    if (g.stderrWhole !== null) assert.equal(norm(r.stderr), g.stderrWhole, `${name}: the whole refusal`);
  }
});

test('PII-1 piiGateReport (src/run-preflight.js): per source the findings, the PII-GATE lines in the run\'s own words, `blocked` only under hard-stop with a finding, the closing line of the normal run - and for a tree a closing line without an allow-list', async () => {
  const { piiGateReport } = await import('../src/run-preflight.js');
  const sources = [['the task file and --context documents', TASK], ['the handed draft (--draft / --from-run)', '']];
  const hard = piiGateReport({ mode: 'hard-stop', allow: [], sources });
  assert.equal(hard.blocked, true);
  assert.deepEqual(hard.lines.slice(0, 2), GOLD.hard_stop.piiLines.slice(0, 2).map(l => l.trimStart() === l ? l : `  ${l.trimStart()}`));
  // CHANGED ACCEPTED (owner 19 Okt 2026). OLD: `refusing to run ... under --pii-gate hard-stop.` and a closing line offering `--pii-gate warn / --allow-pii <type,...>`. NEW: `PII-GATE: stopped - ...` and the way-on lines naming the TYPES FOUND; the typed warn is no longer offered by the stop (the person never saw a finding when typing it). WHY: the stop is the default; the person chooses after seeing.
  assert.ok(hard.lines.includes('\nPII-GATE: stopped - 2 match(es) found in the task file and --context documents. Nothing was started, sent or spent.'));
  assert.deepEqual(hard.lines.slice(-2), ['To send it anyway, run the same command again and add:  --allow-pii email,iban', 'That allows every email / iban-shaped string in these files, also when this run is resumed.'], 'the normal run\'s closing lines');
  const tree = piiGateReport({ mode: 'hard-stop', allow: [], sources, forTree: true });
  assert.equal(tree.blocked, true); // CHANGED AGAIN (T-b, 19 Okt 2026): the tree screen's way-on lines are the SAME builder's first line plus the tree's own two sentences (root task only; later sub-plans stop on their own; the blind typed warn).
  assert.equal(tree.lines.at(-3), 'To send it anyway, run the same command again and add:  --allow-pii email,iban'); assert.match(tree.lines.at(-2), /^That allows these types in the root TASK text only\./); assert.match(tree.lines.at(-1), /^Or change the task, or start the tree with --pii-gate warn \(a choice made before seeing anything/);
  const warn = piiGateReport({ mode: 'warn', allow: [], sources }); assert.equal(warn.blocked, false); assert.equal(warn.lines.length, 2, 'warn reports each finding and nothing else');
  const allowed = piiGateReport({ mode: 'hard-stop', allow: ['email', 'iban'], sources }); assert.equal(allowed.blocked, false); assert.match(allowed.lines.join('\n'), /suppressed pattern class 'email' \(--allow-pii\)/);
  const clean = piiGateReport({ mode: 'hard-stop', allow: [], sources: [['the task file and --context documents', 'Plan a tiny change.\n']] }); assert.deepEqual(clean, { blocked: false, lines: [], findings: [] });   // S5b part A commit 3 (edited, disclosed; old: `{ blocked: false, lines: [] }`): the report also returns the findings as data (additive; none here)
});
