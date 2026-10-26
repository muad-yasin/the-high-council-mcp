// 0.8.3 M6 TREE CEILING unit (gate note Review/Build_0.8.3/m6-closing/Tree_Ceiling_Gate_Note.md; C&C ruling 14 Oct 2026 23:28): COUNCIL_MAX_USD_LIMIT bounds a tree's typed dollar amounts too. Real verbs, spawned: `council tree start`, `council tree decide
// --amend-cap`, `council tree resume` (the member's start is the Q1 check). The paid seats point at a local stub that COUNTS requests (none may be sent by a refused command); the fake key and the loopback key host are the T9 test's (test/cli-usd-limit.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { installSplitRoot } from './helpers/tree-fixture.js';
import { pricedDebate } from './helpers/child-chains.js';
import { memberCeilingRefusal, typedCeilingRefusal } from '../src/tree-ceiling.js';
import { memberStart } from '../src/tree-member.js';
import { decideHandler } from '../src/tree-decide.js';
import { runTree } from '../src/tree-run.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { stoppedChildFixture, usdRx } from './helpers/money-figures.js';
import { approvePending, phases } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');
const KEY = `sk-or-v1-${'e'.repeat(40)}`;
const CEIL_SENTENCE = /above the ceiling in force \(\$10, set by COUNCIL_MAX_USD_LIMIT\)\. Type \$10 or less\./;

/** A working folder with a PAID tree's chains: the split-root and priced-debate fixtures with every mock seat swapped for an openrouter seat on the counting stub. */
async function paidFixture({ free = false } = {}) {
  let requests = 0;
  const srv = http.createServer((req, res) => { requests += 1; req.resume(); res.statusCode = 500; res.end('{"error":"stub"}'); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const work = mkdtempSync(join(tmpdir(), 'thc-ceiling-')); mkdirSync(join(work, 'tasks'));
  writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  installSplitRoot(work);
  const paid = free ? config => config : config => ({ ...config, seats: Object.fromEntries(Object.entries(config.seats).map(([role, seat]) => [role, seat.provider === 'mock' ? { provider: 'openrouter', model: 'anthropic/claude-opus-5', originalProvider: 'anthropic', maxTokens: 500, baseUrl: `http://127.0.0.1:${port}`, lab: seat.lab ?? role } : seat])) });
  if (!free) for (const name of ['split-root']) writeFileSync(join(work, 'chains', `${name}.json`), JSON.stringify(paid(JSON.parse(readFileSync(join(work, 'chains', `${name}.json`), 'utf8'))), null, 2));
  writeFileSync(join(work, 'chains', 'priced-debate.json'), JSON.stringify({ ...paid(pricedDebate()), name: 'priced-debate' }, null, 2));
  const base = { PATH: process.env.PATH, HOME: work, OPENROUTER_API_KEY: KEY, COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' };
  const run = (args, extraEnv = {}) => new Promise(resolve => {
    const e = { ...base, ...extraEnv }; for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
    const child = spawn(process.execPath, [cli, ...args], { cwd: work, env: e, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr, all: stdout + stderr }); });
  });
  const START = cap => ['tree', 'start', '--task', 'tasks/x.md', '--chain', 'split-root', '--child-chain', 'priced-debate', '--max-usd', String(cap)];
  return { work, run, START, requests: () => requests, close: () => srv.close(), runsDir: join(work, 'runs'), folders: () => (existsSync(join(work, 'runs')) ? readdirSync(join(work, 'runs')) : []) };
}

test('[CEILING] TREE START above the ceiling (environment): refused with the CLI\'s sentence + the environment way out, exit 2, NO folder, no request', { timeout: 300_000 }, async () => {
  const f = await paidFixture();
  try {
    const r = await f.run(f.START(11), { COUNCIL_MAX_USD_LIMIT: '10' });
    assert.equal(r.code, 2, r.all);
    assert.match(r.all, CEIL_SENTENCE);
    assert.match(r.all, /raise or unset COUNCIL_MAX_USD_LIMIT in the environment you start council from/);
    assert.deepEqual(f.folders(), [], 'nothing was written: no runs/ folder');
    assert.equal(f.requests(), 0);
  } finally { f.close(); }
});

const idOf = text => /Tree (\S+) started/.exec(text)?.[1];
const blockedOf = (f, id) => readTreeRecord(join(f.runsDir, id)).events.filter(e => e.event === 'blocked');

test('[CEILING] TREE START: the ceiling itself passes, one micro-dollar above is refused (the ONE comparison, src/cap-input.js ceilingRefusal), and a paid chain with the variable UNSET gets no refusal', { timeout: 600_000 }, async () => {
  const f = await paidFixture();
  try {
    const above = await f.run(f.START('10.000001'), { COUNCIL_MAX_USD_LIMIT: '10' });
    assert.equal(above.code, 2, above.all); assert.match(above.all, CEIL_SENTENCE); assert.deepEqual(f.folders(), []);
    const equal = await f.run(f.START(10), { COUNCIL_MAX_USD_LIMIT: '10' });
    assert.notEqual(equal.code, 2, equal.all); assert.doesNotMatch(equal.all, /above the ceiling/, 'PIN (equal passes: no stub can fail this)'); assert.equal(f.folders().length, 1, 'PIN: the tree was started: ' + equal.all);
    const unset = await f.run(f.START(50), {});
    assert.doesNotMatch(unset.all, /above the ceiling|COUNCIL_MAX_USD_LIMIT/, 'PIN (variable unset: no refusal)'); assert.equal(f.folders().length, 2, 'PIN: the tree was started with no variable set: ' + unset.all);
  } finally { f.close(); }
});

test('[CEILING] TREE START: the way out follows where the ceiling came from (the real environment, or only the project\'s .env)', { timeout: 300_000 }, async () => {
  const f = await paidFixture();
  try {
    writeFileSync(join(f.work, '.env'), 'COUNCIL_MAX_USD_LIMIT=10\n');
    const envOnly = await f.run(f.START(11), {});
    assert.equal(envOnly.code, 2, envOnly.all); assert.match(envOnly.all, CEIL_SENTENCE);
    assert.match(envOnly.all, /raise or remove COUNCIL_MAX_USD_LIMIT in the project's \.env/);
    const both = await f.run(f.START(11), { COUNCIL_MAX_USD_LIMIT: '10' });
    assert.match(both.all, /in the environment you start council from/, 'the real environment wins over a .env, so the .env cannot lift it');
    assert.doesNotMatch(both.all, /project's \.env/);
    assert.deepEqual(f.folders(), []);
  } finally { f.close(); }
});

test('[CEILING] TREE START: an unreadable ceiling on a PAID tree is refused before any folder (fail closed); the dry run stays ceiling-blind (PIN: the CLI\'s own --dry-run exits before its ceiling checks); a FREE tree is never refused (PIN)', { timeout: 300_000 }, async () => {
  const f = await paidFixture();
  const free = await paidFixture({ free: true });
  try {
    const bad = await f.run(f.START(5), { COUNCIL_MAX_USD_LIMIT: 'abc' });
    assert.equal(bad.code, 2, bad.all); assert.match(bad.all, /COUNCIL_MAX_USD_LIMIT is set but is not a positive number of dollars/); assert.deepEqual(f.folders(), []);
    const holder = await f.run(f.START(5), { COUNCIL_MAX_USD_LIMIT: '${user_config.max_usd}' });
    assert.equal(holder.code, 2, holder.all); assert.match(holder.all, /COUNCIL_MAX_USD_LIMIT still holds a placeholder from a settings template that was never filled in/); assert.deepEqual(f.folders(), [], 'a host placeholder is refused too, before any folder');
    const dry = await f.run([...f.START(11), '--dry-run'], { COUNCIL_MAX_USD_LIMIT: '10' });
    assert.equal(dry.code, 0, dry.all); assert.doesNotMatch(dry.all, /above the ceiling/); assert.deepEqual(f.folders(), []);
    const freeStart = await free.run(free.START(50), { COUNCIL_MAX_USD_LIMIT: '10' });
    assert.doesNotMatch(freeStart.all, /above the ceiling|COUNCIL_MAX_USD_LIMIT/, freeStart.all); assert.equal(free.folders().length, 1, 'the free tree started: ' + freeStart.all);
    assert.equal(f.requests() + free.requests(), 0, 'no request was sent by any of these');
  } finally { f.close(); free.close(); }
});

test('[CEILING] Q1, the REAL callers: a tree whose cap in force ($50) is above a ceiling set later ($10): `decide --amend-cap` above is refused (record unchanged), the boundary is not a ceiling refusal, `tree resume` (the root\'s member start in cli.js) is refused with exit 19 and ONE blocked, the printed line carries the figures and the way down; an unreadable ceiling at the paid member start is refused too; every refused start writes one blocked', { timeout: 900_000 }, async () => {
  const f = await paidFixture();
  try {
    const started = await f.run(f.START(50), {});
    const id = idOf(started.all); assert.ok(id, started.all);
    const rootDir = join(f.runsDir, id);
    const before = readTreeRecord(rootDir).events.length;
    const amend = await f.run(['tree', 'decide', id, '--amend-cap', '60'], { COUNCIL_MAX_USD_LIMIT: '10' });
    assert.notEqual(amend.code, 0); assert.match(amend.all, /--amend-cap: The limit you typed \(\$60\) is above the ceiling in force \(\$10, set by COUNCIL_MAX_USD_LIMIT\)\. Type \$10 or less\. To type more, raise or unset COUNCIL_MAX_USD_LIMIT in the environment you start council from\./);
    assert.equal(readTreeRecord(rootDir).events.length, before, 'the record is unchanged');
    const boundary = await f.run(['tree', 'decide', id, '--amend-cap', '10'], { COUNCIL_MAX_USD_LIMIT: '10' });
    assert.doesNotMatch(boundary.all, /above the ceiling/, 'PIN: exactly the ceiling is not a ceiling refusal');
    const blocked0 = blockedOf(f, id).length;
    const resume = await f.run(['tree', 'resume', id], { COUNCIL_MAX_USD_LIMIT: '10' });
    assert.equal(resume.code, 19, resume.all);
    const mine = blockedOf(f, id).slice(blocked0).filter(b => b.check === 'ceiling');
    assert.equal(mine.length, 1, 'ONE blocked record, check ceiling');
    assert.equal(mine[0].reason, 'continuation_refused');
    const line = resume.all.split('\n').filter(l => /refused to start or resume/.test(l)).join(' ').slice(0, 400);
    assert.match(line, /\$50\) is above the ceiling in force \(\$10, COUNCIL_MAX_USD_LIMIT\)/);
    // the root holds its WHOLE grant ($50 held) so the committed floor is $50: the form would refuse any total up to the ceiling, and the sentence names only the variable (the amend-cap branch is the pure row below)
    assert.match(line, /Raise or unset COUNCIL_MAX_USD_LIMIT where it is set/, 'the figures and the way out fit the 400 characters tree resume prints'); assert.doesNotMatch(line, /--amend-cap/);
    assert.match(mine[0].detail, /where it is set \(the environment, or the project's \.env\)/);
    assert.ok(mine[0].detail.length <= 340, `the detail is ${mine[0].detail.length} characters`);
    const again = await f.run(['tree', 'resume', id], { COUNCIL_MAX_USD_LIMIT: '10' });
    assert.equal(again.code, 19); assert.equal(blockedOf(f, id).filter(b => b.check === 'ceiling').length, 2, 'one blocked per refused start');
    const unreadable = await f.run(['tree', 'resume', id], { COUNCIL_MAX_USD_LIMIT: 'abc' });
    assert.equal(unreadable.code, 19, unreadable.all); assert.equal(blockedOf(f, id).filter(b => b.check === 'ceiling_unreadable').length, 1);
    assert.match(unreadable.all, /COUNCIL_MAX_USD_LIMIT is set but is not a positive number of dollars/);
    assert.equal(f.requests() >= 1, true, 'only the first start (no ceiling) reached the stub');
    const requestsBefore = f.requests();
    await f.run(['tree', 'resume', id], { COUNCIL_MAX_USD_LIMIT: '10' });
    assert.equal(f.requests(), requestsBefore, 'a refused start sends nothing');
  } finally { f.close(); }
});

// Bug audit 2026-10-24 C-009: cli.js cleared a resumed run's stop records (STOPPED-*, report-partial.json, BOARD-partial.md, deliverable-partial.md) BEFORE a tree member's claim, and a claim that refuses exits 19 and writes nothing back: the member was left stripped. The refusal here is the REAL one of
// the Q1 test above (a ceiling set after the tree's cap); the partial files are written by hand into the root's folder (the root is a member), as the member-stop tests do. A refused resume must leave every one of them as it was.
test('[CEILING] C-009: a member resume that its claim REFUSES (exit 19) leaves the member\'s partial report, partial board and partial deliverable as they were (the clearing waits for the claim)', { timeout: 300_000 }, async () => {
  const f = await paidFixture();
  try {
    const started = await f.run(f.START(50), {});
    const id = idOf(started.all); assert.ok(id, started.all);
    const rootDir = join(f.runsDir, id);
    const kept = { 'report-partial.json': '{"stop":null}\n', 'BOARD-partial.md': '# the board so far\n', 'deliverable-partial.md': 'the plan so far\n' };
    for (const [name, text] of Object.entries(kept)) writeFileSync(join(rootDir, name), text);
    const refused = await f.run(['tree', 'resume', id], { COUNCIL_MAX_USD_LIMIT: '10' });
    assert.equal(refused.code, 19, refused.all);
    assert.equal(blockedOf(f, id).filter(b => b.check === 'ceiling').length, 1, 'the refusal is the member claim\'s ceiling check: ' + refused.all);
    for (const [name, text] of Object.entries(kept)) {
      assert.ok(existsSync(join(rootDir, name)), `${name} survives a refused resume`);
      assert.equal(readFileSync(join(rootDir, name), 'utf8'), text, `${name} is unchanged`);
    }
  } finally { f.close(); }
});

test('[CEILING] pure: the member\'s way out names --amend-cap only when the committed floor is at or below the ceiling; the typed sentence is the CLI\'s; a missing `ceiling` argument is a TypeError', () => {
  const tree = { treeId: '2026-10-15T01-24-14-674Z' };
  const room = memberCeilingRefusal({ key: 'R/M1/M1@g1', tree, capUsd: 50, committedUsd: 3, ceiling: { usd: 10, source: 'environment', unreadable: null } });
  assert.equal(room?.check, 'ceiling'); assert.match(room?.detail ?? '', /--amend-cap <total up to \$10>/);
  assert.ok((room?.detail ?? 'x'.repeat(999)).length <= 340, `the longest variant (with the --amend-cap way, a realistic node key and tree id) is ${room?.detail?.length} characters: it must fit what tree resume prints`);
  const none = memberCeilingRefusal({ key: 'R/M1/M1@g1', tree, capUsd: 50, committedUsd: 20, ceiling: { usd: 10, source: 'environment', unreadable: null } });
  assert.doesNotMatch(none?.detail ?? '', /--amend-cap/, 'the form would refuse any total up to the ceiling: only the variable is named'); assert.match(none?.detail ?? '', /Raise or unset COUNCIL_MAX_USD_LIMIT/);
  assert.equal(memberCeilingRefusal({ key: 'k', tree, capUsd: 10, committedUsd: 0, ceiling: { usd: 10, source: 'environment', unreadable: null } }), null, 'PIN (the ceiling itself passes: no refusal exists to remove that a stub would not also return)');
  assert.equal(memberCeilingRefusal({ key: 'k', tree, capUsd: 50, committedUsd: 0, ceiling: null }), null, 'PIN: null = a free chain, or no ceiling set');
  assert.equal(typedCeilingRefusal({ capText: '9', capUsd: 9, ceiling: { usd: 10, source: 'environment', unreadable: null } }), null, 'PIN: a total below the ceiling is not refused');
  assert.throws(() => memberStart({ runDir: '/x/runs/r', runId: 'r', lineage: { treeId: 'r', node: 'R', generation: 1 }, capAskedUsd: 1, inputs: {}, piiGate: null, piiAllow: [], allowSecretShaped: false }), e => e instanceof TypeError && /ceiling must be null/.test(e.message));
});

test('[CEILING] TOP-UP screen (Q2): the ceiling is named ONLY when the cap in force ($20) is above it, the increment is never compared; an unreadable ceiling, or no reader given, refuses a PAID tree (here paid by the fail-closed rule: a chain file that is not the one the tree registered counts as paid)', { timeout: 600_000 }, async () => {
  // CHANGED ACCEPTED TEST (money-test conversion, lane C (drafted by lane B, reviewed by C), 24 Okt 2026; C&C ruling (c); the full suite on fad02049 listed it as #3951). OLD: cap 26 and a 'within' ceiling of 30, sized against mock-budget's cheapest end 8.064 (26 / 3 = 8.67 over it). NEW: CAP = test/helpers/money-figures.js stoppedChildFixture() (the root cap whose equal share among three children is just over mock-budget's own cheapest end) and the 'within' ceiling is CAP + 4. WHY: recording the drafted words moves the cheapest end (8.064 -> 8.714), so R/M1 was not admitted and stopped() ended in another stop.
  const { CAP } = stoppedChildFixture();
  const r = await trackedRealRoot({ childChain: 'mock-budget', cap: CAP });      // CAP is stoppedChildFixture()'s root cap (the CHANGED ACCEPTED note above); the 'within' ceiling below is CAP + 4, above the cap in force; history: the estimator unit moved the typed cap 20 -> 26 and the ceiling 25 -> 30 (fixture-delta-trace.txt)
  approvePending(r);
  const out = await runTree(r.t.rootDir, { work: r.t.work });
  assert.equal(out.status, 'budget_stop', JSON.stringify(out)); assert.equal(phases(r)['R/M1'], 'stopped');
  const chainFile = join(r.t.work, 'chains', 'split-root.json');
  const topUp = async ceiling => { const io = terminal([]); io.stdin.end(); const code = await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { 'top-up': 'R/M1', amount: '1' }, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now(), ...(ceiling === undefined ? {} : { ceiling }) }); return { code, shown: io.shown().replace(/\u001b\[[0-9;]*[A-Za-z]/g, ''), errors: io.errors() }; };
  // while the tree is FREE (the registered chain files are intact) the ceiling is never read: no line, no refusal, whatever the reader says
  const free = await topUp(() => { throw new Error('a free tree must not read the ceiling'); });
  assert.doesNotMatch(free.shown, /Ceiling in force/, 'PIN (free tree)'); assert.doesNotMatch(free.errors, /ceiling/i, 'PIN (free tree)');
  writeFileSync(chainFile, `${readFileSync(chainFile, 'utf8')}\n`);       // no longer the file the tree registered: counted as paid
  const ABOVE = Math.round((CAP - 5) * 100) / 100;      // a ceiling under the cap in force (typed 10 before, against a cap of 26): CAP - 5, so the cap in force is above it whatever the figures are
  const above = await topUp(() => ({ usd: ABOVE, source: 'environment', unreadable: null }));
  assert.match(above.shown, new RegExp(`Ceiling in force: \\$${usdRx(ABOVE)} \\(COUNCIL_MAX_USD_LIMIT\\)\\. The cap in force is above it, so R/M1 will not start again, with or without this top-up, until the cap is lowered`));
  const within = await topUp(() => ({ usd: Math.round((CAP + 4) * 100) / 100, source: 'environment', unreadable: null }));
  assert.doesNotMatch(within.shown, /Ceiling in force/, 'PIN: a cap at or below the ceiling: nothing about the ceiling on the screen');
  const none = await topUp(() => ({ usd: null, source: 'environment', unreadable: null }));
  assert.doesNotMatch(none.shown, /Ceiling in force/, 'PIN: no ceiling set: nothing');
  const bad = await topUp(() => ({ usd: null, source: 'environment', unreadable: 'COUNCIL_MAX_USD_LIMIT is set but is not a positive number of dollars, so no limit can be checked against it. Nothing was started.' }));
  assert.match(bad.errors, /--top-up: COUNCIL_MAX_USD_LIMIT is set but is not a positive number of dollars/); assert.doesNotMatch(bad.shown, /Give R\/M1 more money/);
  const missing = await topUp(undefined);
  assert.match(missing.errors, /a paid tree cannot be topped up: the COUNCIL_MAX_USD_LIMIT reader was not given/);
});
