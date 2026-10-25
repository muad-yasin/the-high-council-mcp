// `council tree start` refuses BEFORE any write what the root run's own CLI would refuse after the records exist (0.8.3 M6 S5 commit 3; C&C ruling 12 Oct): a missing API key for a seat (both chains), the policy file,
// the outbound key scan on the task text - each through the SAME code the normal run calls (src/run-preflight.js), so the messages and the exit codes are the normal run's own. A tree takes no override of the key scan
// or an allow-list for the PII gate (`--allow-secret-shaped`, `--allow-pii`): a flag typed once at the root would flow into every child's context. The PII gate WARNS by default (0.8.3; `--pii-gate warn|hard-stop`, tests/tree-start-piigate.test.js) and `start` prints nothing for warn, so with the root run's defaults there is
// nothing to pre-check (PRE-4 pins that). The normal run's own output for the same four refusals was captured at 35a9b38 (test/fixtures/preflight-35a9b38.json) before the extraction: GOLD-1 pins it byte for byte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseTreeArgs } from '../src/tree-cli.js';
import { cli, installSplitRoot } from './helpers/tree-fixture.js';
import { pricedDebate } from './helpers/child-chains.js';
import { installOutdatedChain } from './helpers/chain-file.js';

// GOLD-1/GOLD-2 compare a NORMAL run's stderr, byte for byte, with what it printed before the pre-checks were extracted (the fixtures in test/fixtures/). To re-capture them after an intended wording change: run the
// same CLI calls the tests make (`--task tasks/x.md --chain <chain> --max-usd 5` in a temp work folder built by work()), keep the exit status and stderr with the work folder's path replaced by <WORK>.
const GOLD = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'preflight-35a9b38.json'), 'utf8'));
// CHANGED ACCEPTED FIXTURE (E4b unit 2 fix-up, 18 Okt 2026). OLD: the key list inside the missing-stage-contract fix line ended "..., alternatives, deep_dive". NEW: it ends "..., alternatives, deep_dive, decider". WHY: `seats.decider` is a new known seat key (src/chain-lint.js KNOWN_SEAT_KEYS), and the lint prints that list verbatim. The extraction claim below still holds (the answer is the normal run's, byte for byte); only the derived list moved.
const GOLD_LINT = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'lint-4e5f4b1.json'), 'utf8'));   // what a NORMAL run printed for a chain that fails the chain lint, captured at 4e5f4b1 before the extraction
const made = [];
process.on('exit', () => { for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch { /* a leftover is a nuisance */ } } });
const SECRET = `sk_${'live_'}${'abcd'.repeat(6)}`;
function work({ task = 'Plan a tiny change.\n', policy = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-pre-')); made.push(dir);
  mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 'x.md'), task);
  installSplitRoot(dir); installOutdatedChain(join(import.meta.dirname, '..'), dir, 'plan-daily-7');   // 0.8.3 (lane B): plan-daily-7 is retired to chains/outdated/; the test uses it as a real paid chain, copied the way the hint tells a person to
  writeFileSync(join(dir, 'chains', 'priced-debate.json'), JSON.stringify({ ...pricedDebate(), name: 'priced-debate' }, null, 2));
  if (policy !== null) writeFileSync(join(dir, 'policy.json'), policy);
  // a chain that fails the chain lint with a rule that is not the denied-model one (a seat under a key no stage reads: missing-stage-contract)
  writeFileSync(join(dir, 'chains', 'lint-bad.json'), JSON.stringify({ ...pricedDebate(), name: 'lint-bad', seats: { ...pricedDebate().seats, critic: { provider: 'mock', model: 'mock-critic-a' } } }, null, 2));
  return dir;
}
const run = (dir, args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 120_000 });
const norm = (dir, s) => s.split(dir).join('<WORK>');
const start = (dir, chain, child, extra = []) => run(dir, ['tree', 'start', '--task', 'tasks/x.md', '--chain', chain, '--child-chain', child, '--max-usd', '5', ...extra]);
const snapshot = dir => JSON.stringify(readdirSync(dir, { recursive: true }).sort());
/** The refusal block of a normal run: stderr without its leading blank line. */
const block = g => g.stderr.replace(/^\n/, '');

test('GOLD-1 the NORMAL run prints exactly what it printed at 35a9b38 for a missing key, a refusing policy, an unreadable policy and a credential-shaped task (the extraction changed nothing)', () => {
  const cases = { missing_key: { chain: 'plan-daily-7' }, policy_refused: { chain: 'plan-daily-7', policy: JSON.stringify({ allowed_providers: ['mock'] }) }, policy_parse_error: { chain: 'mock', policy: '{ not json' }, outbound_scan: { chain: 'mock', task: `Plan a tiny change.\nThe key is ${SECRET}\n` } };
  for (const [name, c] of Object.entries(cases)) {
    const dir = work({ ...(c.task ? { task: c.task } : {}), policy: c.policy ?? null });
    const r = run(dir, ['--task', 'tasks/x.md', '--chain', c.chain, '--max-usd', '5']);
    assert.equal(r.status, GOLD[name].status, name); assert.equal(norm(dir, r.stderr), GOLD[name].stderr, name);
  }
});

test('PRE-1 a missing API key (root chain, or child chain) is refused with the normal run\'s own E001 text and exit 5, and nothing is written', () => {
  const dir = work(); const before = snapshot(dir); const want = block(GOLD.missing_key);
  for (const [chain, child] of [['plan-daily-7', 'plan-daily-7'], ['split-root', 'plan-daily-7']]) {
    const r = start(dir, chain, child);
    assert.equal(r.status, GOLD.missing_key.status, `${chain}/${child}: ${r.stderr}`); assert.ok(norm(dir, r.stderr).includes(want), `${chain}/${child}: the normal run's refusal block is in the answer:\n${r.stderr}`);
    assert.equal(snapshot(dir), before, 'nothing written'); assert.equal(existsSync(join(dir, 'runs')), false);
  }
});

test('PRE-2 the policy file is applied as the normal run applies it: a refusing policy exits 12 with the normal E005 text, an unreadable one exits 6, nothing is written', () => {
  const refused = work({ policy: JSON.stringify({ allowed_providers: ['mock'] }) }); const b1 = snapshot(refused);
  const r1 = start(refused, 'plan-daily-7', 'plan-daily-7');
  assert.equal(r1.status, GOLD.policy_refused.status, r1.stderr); assert.ok(norm(refused, r1.stderr).includes(block(GOLD.policy_refused)), r1.stderr); assert.equal(snapshot(refused), b1);
  const broken = work({ policy: '{ not json' }); const b2 = snapshot(broken);
  const r2 = start(broken, 'split-root', 'priced-debate');
  assert.equal(r2.status, GOLD.policy_parse_error.status, r2.stderr); assert.ok(norm(broken, r2.stderr).includes(block(GOLD.policy_parse_error)), r2.stderr); assert.equal(snapshot(broken), b2);
  // the child chain is held to the policy too: an allowed root and a child the policy forbids
  const kid = work({ policy: JSON.stringify({ allowed_providers: ['mock'] }) });
  const r3 = start(kid, 'split-root', 'plan-daily-7'); assert.equal(r3.status, GOLD.policy_refused.status, r3.stderr); assert.equal(existsSync(join(kid, 'runs')), false);
});

test('PRE-3 a credential-shaped string in the task text is refused with the normal run\'s own lines and exit 11, the closing sentence says a tree takes no override, nothing is written', () => {
  const dir = work({ task: `Plan a tiny change.\nThe key is ${SECRET}\n` }); const before = snapshot(dir);
  const r = start(dir, 'split-root', 'priced-debate');
  assert.equal(r.status, GOLD.outbound_scan.status, r.stderr);
  const lines = norm(dir, r.stderr).split('\n');
  for (const l of block(GOLD.outbound_scan).split('\n').slice(0, 2)) assert.ok(lines.includes(l), `the normal run's line is in the answer: ${JSON.stringify(l)}\n${r.stderr}`);
  assert.match(r.stderr, /A tree takes no override: change the task, or use a normal `council --task` run with --allow-secret-shaped\./);
  assert.doesNotMatch(r.stderr, /rerun with --allow-secret-shaped to send it deliberately/, 'the normal run\'s closing line offers an override a tree does not have');
  assert.doesNotMatch(r.stderr, new RegExp(SECRET), 'the value is never printed'); assert.equal(snapshot(dir), before);
});

test('PRE-4 the PII gate STOPS by default, so with the root run\'s defaults a task with an e-mail address and a number is refused by `start` (exit 11, nothing written; the lines are pinned by tests/pii-warn-default.test.js PW-11)', () => {
  const dir = work({ task: 'Plan a change for jane.doe@acme-corp.de, phone 030 1234567.\n' });   // old: jane.doe@example.com - a reserved domain, exempt from the PII scan, so the text held no finding and this check could not go red if the gate's default changed
  // CHANGED ACCEPTED (owner 18 Okt 2026 16:45; the old title said "if the default ever becomes hard-stop this goes red"). OLD: exit 0, the warning passed. NEW: exit 11. WHY: the default is the stop.
  const r = start(dir, 'split-root', 'priced-debate'); assert.equal(r.status, 11, r.stderr + r.stdout); assert.match(r.stderr, /PII-GATE: stopped/);
});

test('PRE-5 a tree takes no override of the key scan: --allow-secret-shaped (the scan IS on by default) is refused by `start` with one plain sentence, exit 2, nothing written; --pii-gate and --allow-pii are NOT overrides (the PII gate only warns by default, so an allow-list would override nothing) and are simply not offered', () => {
  const dir = work(); const before = snapshot(dir);
  const r = start(dir, 'split-root', 'priced-debate', ['--allow-secret-shaped']);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /--allow-secret-shaped: a tree takes no override of the key scan: change the task, or use a normal `council --task` run with the flag/);
  assert.equal(snapshot(dir), before);
  // CHANGED ACCEPTED (T-b, owner 19 Okt 2026). OLD (M6 S5 commit 5 / S5b part A commit 2): `--allow-pii` was NOT an option of `start` ("not an option of `council tree start`"; a tree has no allow-list). NEW: it is a shared option of `start` (the root task's way on after seeing the stop, recorded in tree.json `piiAllow`; tests/tree-pii-allow.test.js TA-5); this test keeps only that it is no override of the KEY scan (no word "override") and that other verbs still refuse it. WHY: the person chooses to continue after seeing; F1's closure of a member's own flag stands.
  assert.deepEqual(parseTreeArgs(['start', '--allow-pii', 'email']).flags, { 'allow-pii': 'email' });
  assert.match(parseTreeArgs(['start', '--allow-secret-shaped']).error ?? '', /a tree takes no override/);
  assert.match(parseTreeArgs(['status', 'r', '--allow-pii', 'x']).error ?? '', /not an option of `council tree status`/, 'the sentence is `start`\'s alone');
});

test('PRE-6 a key that lives ONLY in the project\'s .env passes the key pre-check (no false refusal for the way E001 itself tells people to set keys); without the file the same call is refused; the starter is a stub, nothing is sent', () => {
  const onUrl = rel => pathToFileURL(join(import.meta.dirname, '..', 'src', rel)).href;
  // a child process in the work folder, like `council tree start`: cli.js applies the project's .env to the environment (applyEnvFile, src/cli.js) before it dispatches the tree command; the starter is a stub
  const script = `
    import { readFileSync, existsSync } from 'node:fs'; import { PassThrough } from 'node:stream';
    import { applyEnvFile } from ${JSON.stringify(onUrl('env-file.js'))}; import { startHandler } from ${JSON.stringify(onUrl('tree-start.js'))};
    if (existsSync('.env')) applyEnvFile(readFileSync('.env', 'utf8'), process.env);
    const sink = () => { const s = new PassThrough(); let t = ''; s.on('data', d => { t += d; }); return [s, () => t]; };
    const [so, o] = sink(), [se, e] = sink(); let starts = 0;
    const code = await startHandler({ flags: { task: 'tasks/x.md', chain: 'plan-daily-7', 'child-chain': 'plan-daily-7', 'max-usd': '5' }, work: process.cwd(), stdout: so, stderr: se, ceiling: () => ({ usd: null, source: 'environment', unreadable: null }), deps: { startRun: async () => { starts += 1; return { exitCode: 0 }; } } });
    process.stdout.write(JSON.stringify({ code, starts, err: e().slice(0, 300) }));`;
  const go = dir => JSON.parse(spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 }).stdout);
  const withKey = work(); writeFileSync(join(withKey, '.env'), 'OPENROUTER_API_KEY=placeholder-not-a-real-key\n');
  const ok = go(withKey); assert.deepEqual([ok.code, ok.starts], [0, 1], `the .env key is seen: ${ok.err}`);
  const without = work(); const no = go(without); assert.deepEqual([no.code, no.starts], [5, 0], 'the same call without the .env file is refused before the starter');
  assert.equal(existsSync(join(without, 'runs')), false);
});

test('GOLD-2 the NORMAL run prints exactly what it printed at 4e5f4b1 for a chain that fails the chain lint (the extraction of the lint refusal changed nothing)', () => {
  const dir = work(); const r = run(dir, ['--task', 'tasks/x.md', '--chain', 'lint-bad', '--max-usd', '5']);
  assert.equal(r.status, GOLD_LINT.status); assert.equal(norm(dir, r.stderr), GOLD_LINT.stderr);
});

test('PRE-7 the chain lint is asked first, as the run asks it (before the policy file), for the root chain and the child chain: the normal run\'s own lint text, exit 1, nothing written', () => {
  const dir = work({ policy: JSON.stringify({ allowed_providers: ['mock'] }) }); const before = snapshot(dir);
  for (const [chain, child, who] of [['lint-bad', 'priced-debate', 'root'], ['split-root', 'lint-bad', 'child']]) {
    const r = start(dir, chain, child);
    assert.equal(r.status, GOLD_LINT.status, `${who}: ${r.stderr}`); assert.ok(norm(dir, r.stderr).includes(GOLD_LINT.stderr.replace(/^\n/, '')), `${who}: the normal run's lint block is in the answer:\n${r.stderr}`);
    assert.match(r.stderr, new RegExp(`tree start: the ${who} chain lint-bad cannot start:`)); assert.equal(snapshot(dir), before, 'nothing written'); assert.equal(existsSync(join(dir, 'runs')), false);
  }
});

test('PRE-8 the chain lint comes BEFORE the policy file, as in the run: with a policy that refuses the root chain (exit 12 on its own) a lint problem in the child chain still answers first (exit 1)', () => {
  const dir = work({ policy: JSON.stringify({ allowed_providers: ['mock'] }) });
  assert.equal(start(dir, 'plan-daily-7', 'priced-debate').status, GOLD.policy_refused.status, 'control: without a lint problem the policy answers (12)');
  const r = start(dir, 'plan-daily-7', 'lint-bad');
  assert.equal(r.status, 1, r.stderr); assert.match(r.stderr, /chain lint: .*lint-bad\.json has 1 problem/); assert.doesNotMatch(r.stderr, /COUNCIL-E005/); assert.equal(existsSync(join(dir, 'runs')), false);
});

test('PRE-9 the chain lint is the FIRST question, as in the run: a chain that fails the lint AND does not write the milestone lint answers with the lint (a normal run never reaches the milestone question), as root and as child; a schema-broken chain (`seats` not an object) is refused by the lint and does not throw', () => {
  const dir = work();
  const noMs = pricedDebate(); delete noMs.handoff_contract;
  writeFileSync(join(dir, 'chains', 'lint-and-no-milestones.json'), JSON.stringify({ ...noMs, name: 'lint-and-no-milestones', seats: { ...noMs.seats, critic: { provider: 'mock', model: 'mock-critic-a' } } }, null, 2));
  writeFileSync(join(dir, 'chains', 'seats-string.json'), JSON.stringify({ ...pricedDebate(), name: 'seats-string', seats: 'not an object' }, null, 2));
  const before = snapshot(dir);
  for (const [chain, child, who] of [['lint-and-no-milestones', 'priced-debate', 'root'], ['split-root', 'lint-and-no-milestones', 'child'], ['seats-string', 'priced-debate', 'root']]) {
    const r = start(dir, chain, child);
    assert.equal(r.status, 1, `${chain}/${child}: ${r.stderr}`); assert.match(r.stderr, /chain lint: .* will not run/); assert.match(r.stderr, new RegExp(`tree start: the ${who} chain ${who === 'root' ? chain : child} cannot start:`));
    assert.doesNotMatch(r.stderr, /does not set handoff_contract\.milestones to true/, 'the milestone question is asked after the lint'); assert.doesNotMatch(r.stderr, /TypeError|at .*\.js:\d+/, 'no stack trace');
    assert.equal(snapshot(dir), before); assert.equal(existsSync(join(dir, 'runs')), false);
  }
});
