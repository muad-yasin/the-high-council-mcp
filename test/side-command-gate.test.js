// T2-1 commit 5 (14 Oct 2026): the five paid side commands (--replay, --rematch, handoff --from-run, contract draft --from-run, digest --provider) (1) ignored --dry-run and RAN their paid call (probes p23/p24, scratch/c/probe-out), and
// (2) did not share a policy gate: --replay, --rematch and digest --provider had none. Now one function (src/run-preflight.js sideCommandGate) is called by all five, and --dry-run is a separate early branch that prices and exits 0 before
// any lock, folder, reservation, tree claim or prompt file. Offline: the priced mock chain `mock-budget` ($0); every spawn runs in a fresh temp directory. A dry run is pinned by a CONTENT snapshot of the whole runs/ tree before and after.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireRunLock } from '../src/run-lock.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const ENV = { PATH: process.env.PATH };
const DATE = '2026-10-14';
const PRICE = /^(handoff|contract draft|digest): this call could cost up to \$[0-9]+\.[0-9]{2,4}\. Nothing was sent and nothing was spent\.$/;
const sh = (cwd, args, env = ENV) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env, timeout: 90_000 });
const readJson = p => JSON.parse(readFileSync(p, 'utf8'));

// every file under `dir` -> sha256 of its CONTENT (a name alone would miss a rewritten spend-reservations.jsonl); a directory is listed by its name
function snapshot(dir) {
  const out = {};
  (function walk(d) {
    for (const f of readdirSync(d).sort()) {
      const p = join(d, f); const rel = relative(dir, p);
      if (statSync(p).isDirectory()) { out[`${rel}/`] = 'dir'; walk(p); } else out[rel] = createHash('sha256').update(readFileSync(p)).digest('hex');
    }
  })(dir);
  return out;
}

// a finished priced run to price, replay, rematch, hand off, digest
function original() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-sidegate-'));
  mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 'x.md'), 'A mock task.');
  const first = sh(dir, ['--chain', 'mock-budget', '--task', 'tasks/x.md', '--max-usd', 'none']);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const run = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  return { dir, run, replayDir: `${run}.replay-${DATE}` };
}
const withOriginal = fn => { const o = original(); try { return fn(o); } finally { rmSync(o.dir, { recursive: true, force: true }); } };
const policy = (o, obj) => writeFileSync(join(o.dir, 'policy.json'), typeof obj === 'string' ? obj : JSON.stringify(obj));
// a user chain in the working directory (the run's run.json is pointed at it): mock-budget with one seat changed
function chainWith(o, name, change) {
  const cfg = readJson(join(root, 'chains', 'mock-budget.json'));
  change(cfg.seats); cfg.name = name;
  mkdirSync(join(o.dir, 'chains'), { recursive: true });
  writeFileSync(join(o.dir, 'chains', `${name}.json`), JSON.stringify(cfg));
  const meta = readJson(join(o.run, 'run.json')); meta.chain = name;
  writeFileSync(join(o.run, 'run.json'), JSON.stringify(meta));
}

const COMMANDS = {
  replay: o => ['--replay', o.run, '--replay-date', DATE],
  rematch: o => ['--rematch', o.run, '--rematch-seed', '7'],
  handoff: o => ['handoff', '--from-run', o.run],
  'contract draft': o => ['contract', 'draft', '--from-run', o.run],
  digest: o => ['digest', '--run', o.run, '--provider', 'mock', '--model', 'mock-priced'],
};
const SINGLE = ['handoff', 'contract draft', 'digest'];

for (const [name, args] of Object.entries(COMMANDS)) {
  test(`SG-1 ${name} --dry-run prices and exits 0, and the whole runs/ tree is byte-identical afterwards (no folder, lock, reservation, usage file, prompt file or digest)`, () => withOriginal(o => {
    const before = snapshot(join(o.dir, 'runs'));
    const r = sh(o.dir, [...args(o), '--dry-run']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(snapshot(join(o.dir, 'runs')), before, 'a dry run writes nothing');
    if (SINGLE.includes(name)) {
      assert.match(r.stdout.trim(), PRICE);
      assert.ok(r.stdout.startsWith(name), r.stdout);
      assert.doesNotMatch(r.stdout + r.stderr, /cap|--max-usd/i, 'a dry run needs no cap and says nothing about one');
    } else {
      assert.match(r.stdout, /^Chain: mock-budget - /m);
      assert.match(r.stdout, /TOTAL .* \$[0-9.]+ {2}per run {2}\(expected\)/);
      // CHANGED ACCEPTED (label rename, 20 Okt 2026): OLD /MAXIMUM / NEW /UPPER ESTIMATE / - the printed row label only.
      assert.match(r.stdout, /UPPER ESTIMATE .* \$[0-9.]+ {2}per run {2}\(every call at its whole output allowance\)/);
    }
  }));
}

test('SG-2 a run folder LOCKED by a live process is priced, not refused (exit 13 is the real command\'s answer); the lock is left as it was', () => withOriginal(o => {
  const release = acquireRunLock(o.run);
  try {
    const before = snapshot(join(o.dir, 'runs'));
    const dry = sh(o.dir, [...COMMANDS.handoff(o), '--dry-run']);
    assert.equal(dry.status, 0, dry.stdout + dry.stderr);
    assert.match(dry.stdout.trim(), PRICE);
    const real = sh(o.dir, COMMANDS.handoff(o));
    assert.equal(real.status, 13, 'control (green before this change): the real handoff on a locked folder is refused');
    assert.deepEqual(snapshot(join(o.dir, 'runs')), before);
  } finally { release(); }
}));

for (const name of Object.keys(COMMANDS)) {
  test(`SG-3 ${name}: a policy the chain does not meet (required_chain_tags) refuses with COUNCIL-E005 (exit 12) before anything is written, with or without --dry-run${['handoff', 'contract draft'].includes(name) ? ' (control: these two refused at the old inline copy too; the text must stay the same)' : ''}`, () => withOriginal(o => {
    policy(o, { required_chain_tags: ['approved'] });
    const before = snapshot(join(o.dir, 'runs'));
    const texts = [];
    for (const extra of [[], ['--dry-run']]) {
      const r = sh(o.dir, [...COMMANDS[name](o), ...extra, ...(name === 'digest' ? ['--max-usd', '5'] : [])]);
      assert.equal(r.status, 12, `${extra.join(' ') || 'real'}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /COUNCIL-E005/);
      assert.match(r.stderr, /required_chain_tags: chain "mock-budget" is missing required tag\(s\): approved\./);
      assert.doesNotMatch(r.stdout, /could cost up to|TOTAL/, 'no price is shown for a call the policy refuses');
      if (name === 'digest') assert.match(r.stderr, /digest: the policy is checked against this run's chain \("mock-budget"\) together with the digest seat, so a rule about the chain applies to the digest too\. Nothing was sent\.\n$/);
      else assert.doesNotMatch(r.stderr, /together with the digest seat/);
      texts.push(r.stderr);
    }
    assert.equal(texts[0], texts[1], 'the same text with and without --dry-run');
    assert.deepEqual(snapshot(join(o.dir, 'runs')), before);
  }));
}

for (const name of ['replay', 'digest', 'handoff']) {
  test(`SG-4 ${name}: a policy file that does not parse is refused with COUNCIL-E005 (exit 6), not read as no policy${name === 'handoff' ? ' (control: the old inline copy did this too)' : ''}`, () => withOriginal(o => {
    policy(o, '{ not json');
    const before = snapshot(join(o.dir, 'runs'));
    const r = sh(o.dir, [...COMMANDS[name](o), ...(name === 'digest' ? ['--max-usd', '5'] : [])]);
    assert.equal(r.status, 6, r.stdout + r.stderr);
    assert.match(r.stderr, /COUNCIL-E005/);
    assert.deepEqual(snapshot(join(o.dir, 'runs')), before);
  }));
}

test('SG-5 a policy that does not apply to mock seats (allowed_providers exempts the synthetic providers) changes nothing: the dry run prices (control)', () => withOriginal(o => {
  policy(o, { allowed_providers: ['anthropic'] });
  for (const name of Object.keys(COMMANDS)) {
    const r = sh(o.dir, [...COMMANDS[name](o), '--dry-run']);
    assert.equal(r.status, 0, `${name}: ${r.stdout}${r.stderr}`);
  }
}));

test('SG-6 a replay folder that was started and did not finish: the dry run names the stages already on disk and what a real run would still pay, and changes nothing', () => withOriginal(o => {
  assert.equal(sh(o.dir, [...COMMANDS.replay(o), '--max-usd', '3']).status, 4);   // stops before the build stage: only the criteria stage was paid
  const before = snapshot(join(o.dir, 'runs'));
  const r = sh(o.dir, [...COMMANDS.replay(o), '--dry-run']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, new RegExp(`--replay: ${o.replayDir.split('/').pop().replace(/\./g, '\\.')} was started and did not finish: 1 stage\\(s\\) are on disk \\(recorded spend so far: \\$0\\.0500\\); a real run could cost up to \\$[0-9.]+ more for the stages still to run, not the whole chain\\.`));
  assert.deepEqual(snapshot(join(o.dir, 'runs')), before);
}));

test('SG-7 an UNPRICED seat: the replay dry run shows it as unpriced and exits 0 (the real replay refuses one only under a cap); the single-call commands have no figure and exit 5 naming the seat', () => withOriginal(o => {
  chainWith(o, 'unpriced-x', seats => { seats.builder = { provider: 'openrouter', model: 'vendor/not-in-the-table', maxTokens: 8000, lab: 'vendor' }; });
  const before = snapshot(join(o.dir, 'runs'));
  const rep = sh(o.dir, [...COMMANDS.replay(o), '--dry-run', '--max-usd', 'none']);
  assert.equal(rep.status, 0, rep.stdout + rep.stderr);
  assert.match(rep.stdout, /openrouter\/vendor\/not-in-the-table .* unpriced/);
  const one = sh(o.dir, [...COMMANDS.handoff(o), '--dry-run']);
  assert.equal(one.status, 5, one.stdout + one.stderr);
  assert.match(one.stderr, /"openrouter\/vendor\/not-in-the-table" has no listed price, so its cost can't be shown/);
  assert.doesNotMatch(one.stdout, /could cost up to/);
  assert.deepEqual(snapshot(join(o.dir, 'runs')), before);
}));

test('SG-8 an EXTERNAL handoff seat has no call to price: the dry run says what a real run would do and writes nothing; a contract draft keeps its refusal (exit 2)', () => withOriginal(o => {
  chainWith(o, 'external-handoff', seats => { seats.handoff = { provider: 'external', model: 'claude-code-session' }; });
  const before = snapshot(join(o.dir, 'runs'));
  const r = sh(o.dir, [...COMMANDS.handoff(o), '--dry-run']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stdout.trim(), 'handoff: the handoff seat of "external-handoff" is external (a session you run), so there is no call to price. A real run writes the prompt file and stops for your session (exit 3); this dry run wrote nothing.');
  assert.deepEqual(snapshot(join(o.dir, 'runs')), before);
  const draft = sh(o.dir, [...COMMANDS['contract draft'](o), '--dry-run']);
  assert.equal(draft.status, 2, 'control (as without --dry-run): a contract draft is a model call');
  const real = sh(o.dir, COMMANDS.handoff(o));
  assert.equal(real.status, 3, 'control (green before this change): the real handoff writes its prompt file and stops');
  assert.ok(existsSync(join(o.run, 'handoff-from-run.prompt.md')));
}));

test('SG-9 digest: --dry-run needs no --max-usd and prices the seat\'s whole allowance; without --dry-run a FREE seat needs none either (T5b; old: the flag was required, exit 2)', () => withOriginal(o => {
  const dry = sh(o.dir, [...COMMANDS.digest(o), '--dry-run']);
  assert.equal(dry.status, 0, dry.stdout + dry.stderr);
  const usd = Number(/up to \$([0-9.]+)\./.exec(dry.stdout)[1]);
  assert.ok(usd > 30 && usd < 40, `mock-priced at the 36,000-token seat cap: about $36 (got ${usd})`);
  const real = sh(o.dir, COMMANDS.digest(o));
  assert.equal(real.status, 0, real.stdout + real.stderr);
  assert.doesNotMatch(real.stderr, /needs --max-usd/);
}));

test('SG-10 digest on a summary that holds a key-shaped string would make no call: the dry run says so and writes no digest; a tree member\'s folder is refused as without --dry-run', () => withOriginal(o => {
  const report = readJson(join(o.run, 'report.json'));
  writeFileSync(join(o.run, 'report.json'), JSON.stringify({ ...report, outcome: `sk-or-v1-${'a1b2c3d4e5'.repeat(4)}` }));
  const before = snapshot(join(o.dir, 'runs'));
  const r = sh(o.dir, [...COMMANDS.digest(o), '--dry-run']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stdout.trim(), 'digest: the summary holds a key-shaped string, so no model call would be made and there is nothing to price. Nothing was sent and nothing was spent.');
  assert.deepEqual(snapshot(join(o.dir, 'runs')), before);
  const meta = readJson(join(o.run, 'run.json'));
  writeFileSync(join(o.run, 'run.json'), JSON.stringify({ ...meta, tree: { root: 'r', id: 'n' } }));
  const member = sh(o.dir, [...COMMANDS.digest(o), '--dry-run']);
  assert.equal(member.status, 2, member.stdout + member.stderr);
  assert.match(member.stderr, /is a member of a recursive-councils tree/);
}));

test('SG-11 the old digest/handoff texts are untouched when no --dry-run is given: a cap refusal still reads as before (control)', () => withOriginal(o => {
  const r = sh(o.dir, [...COMMANDS.digest(o), '--max-usd', '5']);
  assert.equal(r.status, 4, r.stdout + r.stderr);
  assert.match(r.stderr, /^digest: stopped by the spend cap: this run's total so far is \$[0-9.]+, this call could cost up to \$36\.\d\d, and the cap is \$5\.00\./);
}));

test('SG-12 digest on a folder with a report and NO readable run.json: the one-seat stand-in goes through the policy gate (fail closed, no crash) with the neighbour line that says the chain could not be read, dry run and real call', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-sidegate-bare-'));
  try {
    mkdirSync(join(dir, 'run1'));
    writeFileSync(join(dir, 'run1', 'report.json'), JSON.stringify({ outcome: 'no_consensus', disagreement_groups: [] }));
    writeFileSync(join(dir, 'policy.json'), JSON.stringify({ required_chain_tags: ['approved'] }));
    const before = snapshot(dir);
    for (const extra of [['--dry-run'], ['--max-usd', '5']]) {
      const r = sh(dir, ['digest', '--run', 'run1', '--provider', 'mock', '--model', 'mock-priced', ...extra]);
      assert.equal(r.status, 12, `${extra.join(' ')}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /COUNCIL-E005/);
      assert.match(r.stderr, /required_chain_tags: chain "digest" is missing required tag\(s\): approved\./);
      assert.match(r.stderr, /digest: the run's chain could not be read, so the policy is checked against the digest seat alone, and a rule about the chain refuses it\. Nothing was sent\.\n$/);
    }
    assert.deepEqual(snapshot(dir), before, 'nothing was written');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// T5b (C&C ruling, 14 Oct 2026): the policy's max_usd_per_run is judged on the DIGEST CALL's own figure in both branches of the gate. The run's chain (mock-budget, expected $11.70) passes a $20 limit; the digest alone (mock-priced at the 36,000-token seat cap, $36.10) does not.
const CALL_LIMIT = /max_usd_per_run: the expected cost of this call's chain \(the first figure --dry-run prints\) is \$36\.\d+, over the \$20\.0000 limit/;
test('SG-14 digest, READABLE chain: a policy max_usd_per_run the digest call ALONE breaches refuses (exit 12, the policy refusal) in the dry run and the real call; nothing is written', () => withOriginal(o => {
  policy(o, { max_usd_per_run: 20 });
  const before = snapshot(join(o.dir, 'runs'));
  for (const extra of [['--dry-run'], []]) {
    const r = sh(o.dir, [...COMMANDS.digest(o), ...extra]);
    assert.equal(r.status, 12, `${extra.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /COUNCIL-E005/);
    assert.match(r.stderr, CALL_LIMIT);
    assert.match(r.stderr, /limit/);
  }
  assert.deepEqual(snapshot(join(o.dir, 'runs')), before, 'nothing was written');
  policy(o, { max_usd_per_run: 50 });
  const ok = sh(o.dir, [...COMMANDS.digest(o), '--dry-run']);
  assert.equal(ok.status, 0, 'a limit above the call lets it through: ' + ok.stdout + ok.stderr);
}));

test('SG-15 digest, UNREADABLE chain (the one-seat stand-in): the same policy max_usd_per_run refuses on the call\'s own figure; the stand-in used to price $0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-sidegate-bare2-'));
  try {
    mkdirSync(join(dir, 'run1'));
    writeFileSync(join(dir, 'run1', 'report.json'), JSON.stringify({ outcome: 'no_consensus', disagreement_groups: [] }));
    writeFileSync(join(dir, 'policy.json'), JSON.stringify({ max_usd_per_run: 20 }));
    const before = snapshot(dir);
    for (const extra of [['--dry-run'], []]) {
      const r = sh(dir, ['digest', '--run', 'run1', '--provider', 'mock', '--model', 'mock-priced', ...extra]);
      assert.equal(r.status, 12, `${extra.join(' ')}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, CALL_LIMIT);
    }
    assert.deepEqual(snapshot(dir), before, 'nothing was written');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('SG-13 --replay --dry-run when the chain recorded in the run cannot be read: exit 2 with one sentence, nothing run and nothing written', () => withOriginal(o => {
  const meta = readJson(join(o.run, 'run.json'));
  writeFileSync(join(o.run, 'run.json'), JSON.stringify({ ...meta, chain: 'no-such-chain-x' }));
  const before = snapshot(join(o.dir, 'runs'));
  const r = sh(o.dir, [...COMMANDS.replay(o), '--dry-run']);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.equal(r.stderr.trim(), '--replay: --dry-run prices the chain recorded in the run, and that chain could not be read (running the replay without --dry-run refuses it and says why). Nothing was run and nothing was spent.');
  assert.deepEqual(snapshot(join(o.dir, 'runs')), before);
}));

for (const name of ['handoff', 'contract draft']) {
  test(`SG-14 ${name} on a tree MEMBER's folder: the dry run prices it (the real command allows a member) and writes no post-run claim, no hook, no lock - runs/ is byte-identical`, () => withOriginal(o => {
    const meta = readJson(join(o.run, 'run.json'));
    // a member must carry a cap (the real command refuses `--max-usd none` on a member before anything else, and a dry run keeps that refusal): the original run saved none, so this one saves 5
    writeFileSync(join(o.run, 'run.json'), JSON.stringify({ ...meta, maxUsd: 5, tree: { root: 'r', id: 'n' } }));
    const before = snapshot(join(o.dir, 'runs'));
    const r = sh(o.dir, [...COMMANDS[name](o), '--dry-run']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout.trim(), PRICE);
    assert.deepEqual(snapshot(join(o.dir, 'runs')), before);
    assert.equal(existsSync(join(o.run, 'tree')), false, 'no tree record was started');
  }));
}

// C&C ruling (14 Oct 2026, on the commit-5 report): --json on a side command's dry run is REFUSED (it used to be ignored and the script got text), and the free template digest written under `digest --dry-run` without --provider is SAID.
const JSON_LABEL = { replay: '--replay', rematch: '--rematch', handoff: 'handoff', 'contract draft': 'contract draft', digest: 'digest' };
for (const [name, args] of Object.entries(COMMANDS)) {
  test(`SG-15 ${name} --dry-run --json is refused (exit 2, one sentence), never ignored, and nothing is written`, () => withOriginal(o => {
    const before = snapshot(join(o.dir, 'runs'));
    const r = sh(o.dir, [...args(o), '--dry-run', '--json']);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.equal(r.stderr.trim(), `${JSON_LABEL[name]}: --json cannot be used with --dry-run here: the dry run prints text, so the option would be ignored. Nothing was run and nothing was spent.`);
    assert.equal(r.stdout, '');
    assert.deepEqual(snapshot(join(o.dir, 'runs')), before);
  }));
}
const TEMPLATE_SAID = 'digest: --dry-run prices a model call, and without --provider there is none, so the free template digest was written. Nothing was sent and nothing was spent.';
test('SG-16 digest --dry-run WITHOUT --provider still writes the free template, and says so on the line before "Wrote <path>"', () => withOriginal(o => {
  const dry = sh(o.dir, ['digest', '--run', o.run, '--dry-run']);
  assert.equal(dry.status, 0, dry.stdout + dry.stderr);
  const lines = dry.stdout.split('\n');
  assert.ok(lines.includes(TEMPLATE_SAID), dry.stdout);
  assert.match(lines[lines.indexOf(TEMPLATE_SAID) + 1], /^Wrote .*digest\.md$/);
  assert.ok(existsSync(join(o.run, 'digest.md')));
}));
test('SG-16 control (green before this change): digest WITHOUT --dry-run and without --provider writes the template and does not carry the dry-run line', () => withOriginal(o => {
  const plain = sh(o.dir, ['digest', '--run', o.run]);
  assert.equal(plain.status, 0, plain.stdout + plain.stderr);
  assert.doesNotMatch(plain.stdout, /--dry-run prices a model call/);
  assert.match(plain.stdout, /^Wrote .*digest\.md$/m);
}));
