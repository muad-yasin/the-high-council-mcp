// `council tree start --pii-gate warn|hard-stop` (0.8.3 M6 S5b part A, commit 2; contract Review/Build_0.8.3/m6-closing/S5b_PII_Gate_And_Registration_Precheck_Contract.md section 3, Muad's answer 3: a tree may carry the personal-data gate).
// The mode is recorded in tree.json (src/tree-pii-mode.js), the root's task is checked with it BEFORE anything is written (the PII gate first, then the key scan: the order cli.js asks them), and the root run is launched with the mode.
// `--allow-pii` stays not offered (a tree's text is model-written; a typed allow-list would silently exempt every child). Every working folder is a temp folder of the test's own; every chain is mock ($0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import * as api from '../src/api.js';
import { DEFAULT_HANDLERS, TREE_ONLY_FLAGS, TREE_VALUE_FLAGS, parseTreeArgs, treeCommand } from '../src/tree-cli.js';
import { readTreeRecord } from '../src/tree-record.js';
import { treePiiModeFrom } from '../src/tree-pii-mode.js';
import { cli, installSplitRoot } from './helpers/tree-fixture.js';
import { pricedDebate } from './helpers/child-chains.js';

const made = [];
process.on('exit', () => { for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch { /* a leftover is a nuisance */ } } });
const MAIL = ['jane.doe', '@', 'mail-corp', '.de'].join('');
const IBAN = ['DE89', '3704', '0044', '0532', '0130', '00'].join('');
const SECRET = `sk_${'live_'}${'abcd'.repeat(6)}`;
function work({ task = 'Plan a tiny change.\n' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-pg-')); made.push(dir);
  mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 'x.md'), task);
  installSplitRoot(dir); writeFileSync(join(dir, 'chains', 'priced-debate.json'), JSON.stringify({ ...pricedDebate(), name: 'priced-debate' }, null, 2));
  return dir;
}
const run = (dir, args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 120_000 });
const start = (dir, extra = []) => run(dir, ['tree', 'start', '--task', 'tasks/x.md', '--chain', 'split-root', '--child-chain', 'priced-debate', '--max-usd', '5', ...extra]);
const snapshot = dir => JSON.stringify(readdirSync(dir, { recursive: true }).sort());
const io = () => { const stdin = new PassThrough(); const stdout = new PassThrough(); const stderr = new PassThrough(); let o = ''; let e = ''; stdout.on('data', d => { o += d; }); stderr.on('data', d => { e += d; }); return { stdin, stdout, stderr, out: () => o, err: () => e }; };
/** `tree start` through the handler with a starter that records what it was handed and stops there (exit 0): tree.json is written before the starter is called. */
async function viaHandler(dir, extra) {
  const d = io(); const seen = [];
  const code = await treeCommand(['start', '--task', 'tasks/x.md', '--chain', 'split-root', '--child-chain', 'priced-debate', '--max-usd', '5', ...extra], { work: dir, ...d, handlers: { ...DEFAULT_HANDLERS, start: x => DEFAULT_HANDLERS.start({ ...x, deps: { startRun: async o => { seen.push(o); return { exitCode: 0 }; } } }) } });
  return { code, seen, out: d.out(), err: d.err() };
}
const treeOf = dir => { const id = readdirSync(join(dir, 'runs'))[0]; return { id, rec: readTreeRecord(join(dir, 'runs', id)) }; };

test('PG-1 the option: `--pii-gate` takes a value and is a SHARED option (a normal run takes it too), so it is in neither tree-only list; `--allow-pii` is a shared option of `start` only (T-b); a missing value and a repeat are refused', () => {
  assert.deepEqual(parseTreeArgs(['start', '--pii-gate', 'hard-stop', '--task', 't.md']), { verb: 'start', rootArg: null, flags: { 'pii-gate': 'hard-stop', task: 't.md' } });
  assert.equal(TREE_ONLY_FLAGS.includes('pii-gate'), false); assert.equal(TREE_VALUE_FLAGS.includes('pii-gate'), false);
  assert.match(parseTreeArgs(['start', '--pii-gate']).error ?? '', /--pii-gate needs a value/);
  assert.match(parseTreeArgs(['start', '--pii-gate', 'warn', '--pii-gate', 'warn']).error ?? '', /--pii-gate was given twice/);
  // CHANGED ACCEPTED (T-b, owner 19 Okt 2026: the person chooses to continue after seeing). OLD: `--allow-pii` was "not an option of `council tree start`" (a tree has no allow-list; C&C's F1 ruling on 3822f9a). NEW: it is a SHARED option of `start` only (the root task's way on, recorded once in tree.json `piiAllow`); every other tree verb still refuses it, and a MEMBER still refuses it (tree-member-pii-warnings). WHY: F1 closed a member started by hand with its own flag; T-b opens only an allowance the tree record carries.
  assert.deepEqual(parseTreeArgs(['start', '--allow-pii', 'email', '--task', 't.md']), { verb: 'start', rootArg: null, flags: { 'allow-pii': 'email', task: 't.md' } });
  assert.equal(TREE_ONLY_FLAGS.includes('allow-pii'), false); assert.equal(TREE_VALUE_FLAGS.includes('allow-pii'), false);
  assert.match(parseTreeArgs(['status', 'r', '--allow-pii', 'email']).error ?? '', /--allow-pii: not an option of `council tree status`/);
  // another verb never takes it
  assert.match(parseTreeArgs(['status', 'r', '--pii-gate', 'warn']).error ?? '', /not an option of `council tree status`/);
  // `--pii-gate=warn` is split like every value flag: it reaches the handler (whose first refusal here is the missing task), not the option refusal
  const dir = work(); const eq = run(dir, ['tree', 'start', '--pii-gate=warn']);
  assert.equal(eq.status, 2); assert.match(eq.stderr, /council tree start needs --task <file>/); assert.doesNotMatch(eq.stderr, /not an option|takes no value/);
});

test('PG-2 a word other than warn or hard-stop is refused with the NORMAL RUN\'s own sentence, exit 2, nothing written; so is `--pii-gate` with a value that is another option', () => {
  const dir = work(); const before = snapshot(dir);
  const normal = run(dir, ['--task', 'tasks/x.md', '--chain', 'mock', '--pii-gate', 'loud', '--dry-run']);
  const r = start(dir, ['--pii-gate', 'loud']);
  assert.equal(normal.status, 2); assert.equal(r.status, 2, r.stderr);
  assert.ok(r.stderr.includes(normal.stderr.trim()), `the same sentence: ${r.stderr}`); assert.match(r.stderr, /--pii-gate: expected "warn" or "hard-stop", got "loud"/);
  assert.equal(snapshot(dir), before);
  assert.equal(start(dir, ['--pii-gate', '--max-usd', '5']).status, 2);
});

test('PG-3 hard-stop checks the ROOT task before anything is written: e-mail and IBAN found -> exit 11, the normal PII-GATE lines, the tree\'s own closing sentence (no allow-list), no value echoed, nothing written; the same task without the flag starts', async () => {
  const dir = work({ task: `Plan a change. Contact ${MAIL}. Bank: IBAN ${IBAN}.\n` }); const before = snapshot(dir);
  const r = start(dir, ['--pii-gate', 'hard-stop']);
  assert.equal(r.status, 11, r.stderr);
  assert.match(r.stderr, /PII-GATE \(hard-stop\): \[the task file and --context documents\] line 1, col \d+: email \(value not shown\)/);   // CHANGED ACCEPTED (PII fix-up 4, 18 Okt 2026). OLD `looks like a email` / `looks like a iban` / `looks like Stripe`. NEW `email (value not shown)` / `iban (value not shown)` / `secret (Stripe ...)`. WHY: one line builder for console and logs, no masked prefix in anything persisted.
  assert.match(r.stderr, /iban \(value not shown\)/); // CHANGED ACCEPTED (owner 19 Okt 2026, the stop is the default). OLD: `PII-GATE: refusing to run - N match(es) ... under --pii-gate hard-stop.` and `A tree takes no allow-list: change the task, or start the tree without --pii-gate, or use a normal ...`. NEW: the stop screen's own words, and the tree's closing sentence that names the typed warn as the blind choice. WHY: the default stops, so "without --pii-gate" is no way on.
  assert.match(r.stderr, /PII-GATE: stopped - 2 match\(es\) found in the task file and --context documents\. Nothing was started, sent or spent\./);
  // CHANGED AGAIN (T-b, 19 Okt 2026): the tree screen now offers the way on for the ROOT task: `--allow-pii <types found>` (recorded in tree.json), says later sub-plans stop on their own, and keeps the typed warn as the blind choice. OLD (commit 1): "Change the task, or use a normal `council --task` run with --allow-pii, or start the tree with --pii-gate warn".
  assert.match(r.stderr, /To send it anyway, run the same command again and add:  --allow-pii email,iban/); assert.match(r.stderr, /That allows these types in the root TASK text only/); assert.match(r.stderr, /or start the tree with --pii-gate warn \(a choice made before seeing anything/);
  assert.equal(r.stderr.includes(MAIL), false, 'the match is never echoed'); assert.equal(snapshot(dir), before, 'nothing written');
  const dflt = await viaHandler(dir, []); assert.equal(dflt.code, 11, 'without the flag it stops too (the default)');
  const free = await viaHandler(dir, ['--pii-gate', 'warn']); assert.equal(free.code, 0, free.err); assert.equal(free.seen.length, 1, 'with the typed warn the task starts a tree');
});

test('PG-4 the order is the run\'s: the PII gate answers BEFORE the key scan (a task with both gets the PII lines, not the key-scan lines); the gate has a secret type of its own, so under hard-stop a key alone is refused by the GATE too (as a normal run does), and under warn - which never refuses - the key scan then refuses it (exit 11)', () => {
  const dir = work({ task: `Contact ${MAIL}. Key ${SECRET}.\n` }); const before = snapshot(dir);
  const both = start(dir, ['--pii-gate', 'hard-stop']); assert.equal(both.status, 11);
  assert.match(both.stderr, /PII-GATE \(hard-stop\)/); assert.doesNotMatch(both.stderr, /OUTBOUND KEY SCAN/);
  const keyOnly = work({ task: `Key ${SECRET}.\n` }); const keyBefore = snapshot(keyOnly);
  // CHANGED ACCEPTED (owner 19 Okt 2026, one stop, the right one). OLD: under hard-stop a key alone was refused by the PII gate (secret type) and not by the key scan. NEW: the key scan's screen is the one stop in every mode; start prints no PII line for a text the key scan refuses. WHY: allowing the key would otherwise stop the same text a second time.
  const k = start(keyOnly, ['--pii-gate', 'hard-stop']); assert.equal(k.status, 11); assert.match(k.stderr, /OUTBOUND KEY SCAN/); assert.doesNotMatch(k.stderr, /PII-GATE/);
  const w = start(keyOnly, ['--pii-gate', 'warn']); assert.equal(w.status, 11, w.stderr); assert.match(w.stderr, /OUTBOUND KEY SCAN/); assert.doesNotMatch(w.stderr, /PII-GATE/, 'start prints no PII lines under warn');
  assert.equal(snapshot(dir), before); assert.equal(snapshot(keyOnly), keyBefore, 'nothing written either way');
});

test('PG-5 the mode is recorded and handed on: tree.json carries piiGate for warn and hard-stop (and `warn` without the flag since 0.8.3), the root run is launched with the same mode, and `warn` makes `start` itself print nothing (the root\'s own CLI prints and records the findings)', async () => {
  for (const mode of ['warn', 'hard-stop']) {
    const dir = work({ task: `Plan a change. Contact ${MAIL}.\n` });
    const r = await viaHandler(dir, ['--pii-gate', mode]);
    if (mode === 'warn') { assert.equal(r.code, 0, r.err); assert.doesNotMatch(r.err + r.out, /PII-GATE/, 'start prints no PII lines under warn'); }
    else { assert.equal(r.code, 11, r.err); assert.equal(existsSync(join(dir, 'runs')), false); continue; }
    const { rec } = treeOf(dir);
    assert.equal(rec.tree.piiGate, mode); assert.deepEqual(treePiiModeFrom(rec.tree), { status: 'on', mode });
    assert.equal(r.seen.length, 1); assert.equal(r.seen[0].piiGate, mode, 'the root run is launched with the mode');
  }
  const clean = work(); const hard = await viaHandler(clean, ['--pii-gate', 'hard-stop']); assert.equal(hard.code, 0, hard.err);
  assert.equal(treeOf(clean).rec.tree.piiGate, 'hard-stop'); assert.equal(hard.seen[0].piiGate, 'hard-stop');
  // CHANGED ACCEPTED PIN (PII warn by default, 18 Okt 2026). OLD: no flag = no field in tree.json and nothing handed to the root run (the gate was off). NEW: no flag and no setting = the tree records and hands on `warn`. WHY: owner, via the caps session: "Warn by default sounds very good and very user friendly."; C&C ruling: the tree record learns the mode at start (flag, else the COUNCIL_PII_GATE setting, else warn).
  const off = work(); const none = await viaHandler(off, []); assert.equal(none.code, 0);
  // CHANGED AGAIN (owner 18 Okt 2026 16:45): OLD (above) warn; NEW: no flag and no setting = the tree records and hands on `hard-stop`. WHY: the stop is the default.
  assert.equal(treeOf(off).rec.tree.piiGate, 'hard-stop', 'no flag, no setting: hard-stop is recorded'); assert.equal(none.seen[0].piiGate, 'hard-stop', 'and handed on'); assert.deepEqual(treePiiModeFrom(treeOf(off).rec.tree), { status: 'on', mode: 'hard-stop' });
});

test('PG-6 the REAL root run (api.run on the split-root chain, the plan handed as a draft) is saved with the mode: run.json carries piiGate.mode, the tree record is sound, and a clean task passes the root\'s own gate', async () => {
  for (const mode of ['warn', 'hard-stop']) {
    const dir = work(); const d = io();
    const code = await treeCommand(['start', '--task', 'tasks/x.md', '--chain', 'split-root', '--child-chain', 'priced-debate', '--max-usd', '5', '--pii-gate', mode], { work: dir, ...d, handlers: { ...DEFAULT_HANDLERS, start: x => DEFAULT_HANDLERS.start({ ...x, deps: { startRun: o => api.run({ ...o, draft: 'plan.md', rounds: 1 }) } }) } });
    assert.equal(code, 0, d.err() + d.out());
    const { id, rec } = treeOf(dir); assert.equal(rec.corrupt.length, 0);
    const runJson = JSON.parse(readFileSync(join(dir, 'runs', id, 'run.json'), 'utf8'));
    assert.deepEqual(runJson.piiGate, { mode, allow: [] }, 'the root saved the mode as any run does'); assert.equal(rec.tree.piiGate, mode);
  }
});

test('PG-7 `--dry-run --pii-gate`: a bad word is refused as `start` refuses it; a good one with a task that would trip the gate still exits 0 with the projection (a normal dry run exits before the PII block), and nothing is written', () => {
  const dir = work({ task: `Contact ${MAIL}.\n` }); const before = snapshot(dir);
  const bad = start(dir, ['--dry-run', '--pii-gate', 'loud']); assert.equal(bad.status, 2); assert.match(bad.stderr, /--pii-gate: expected "warn" or "hard-stop", got "loud"/);
  const ok = start(dir, ['--dry-run', '--pii-gate', 'hard-stop']); assert.equal(ok.status, 0, ok.stderr); assert.match(ok.stdout, /^Tree cost, PROJECTED/m); assert.doesNotMatch(ok.stdout + ok.stderr, /PII-GATE/);
  assert.equal(snapshot(dir), before);
});
