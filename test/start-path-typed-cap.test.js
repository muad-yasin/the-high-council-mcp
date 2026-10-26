// The main run's start path with a typed limit (0.8.3 M6 typed cap T4a; typed-cap gate page sections 2-4, 7-8; T4 start-path page). Offline, $0: the one paid seat points at a local stub that COUNTS the requests it gets.
// A paid chain started without a terminal writes its limit screen and exits 21 with ZERO requests sent; the limit is recorded by the gate; `--resume` consumes it once and the run then uses it as THE cap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { answerGate, readGateAnswer } from '../src/gate.js';
import { formatUsd } from '../src/cost.js';
import { typeCap } from './helpers/typed-cap.js';
import { LEDGER_FILE } from '../src/gate-ledger.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const ID = '2026-10-14T12-00-00-000Z';

async function fixture(paid) {
  let requests = 0;
  const srv = http.createServer((req, res) => { requests += 1; req.resume(); res.statusCode = 500; res.end('{"error":"stub"}'); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const work = mkdtempSync(join(tmpdir(), 'thc-typed-cap-')); mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'chains'));
  writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  const seats = paid ? { ...base.seats, criteria: { provider: 'openrouter', model: 'anthropic/claude-opus-5', originalProvider: 'anthropic', maxTokens: 500, baseUrl: `http://127.0.0.1:${srv.address().port}` } } : base.seats;
  writeFileSync(join(work, 'chains', 'c.json'), JSON.stringify({ ...base, name: 'c', seats }));
  const env = { PATH: process.env.PATH, HOME: work, OPENROUTER_API_KEY: `sk-or-v1-${'e'.repeat(40)}`, COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' };
  // ASYNC on purpose: the stub server lives in THIS process, and a synchronous spawn would block the event loop that has to answer the child.
  // `until`: kill the child as soon as the stub has been hit that many times in total (the run would otherwise retry a failing provider for a while); the test then reads the files.
  const run = (args, until = null) => new Promise(resolve => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    const poll = until ? setInterval(() => { if (requests >= until) child.kill('SIGKILL'); }, 50) : null;
    child.on('exit', status => { clearTimeout(timer); if (poll) clearInterval(poll); resolve({ status, stdout, stderr }); });
  });
  return { srv, work, env, run, count: () => requests, runDir: join(work, 'runs', ID) };
}
const ledger = d => readFileSync(join(d, LEDGER_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

test('a paid chain started without a terminal waits for a typed limit: exit 21, the screen on disk, ZERO requests sent, no stage, no reservation; --max-usd is only shown', async () => {
  const f = await fixture(true);
  try {
    const r = await f.run(['--chain', 'c', '--task', 'tasks/x.md', '--run-id', ID, '--max-usd', '30']);
    assert.equal(r.status, 21, r.stdout + r.stderr);
    assert.match(r.stderr, /waits for a spending limit that you type/);
    assert.match(r.stderr, /gate answer .* g1/); assert.match(r.stderr, /--resume /);
    assert.equal(f.count(), 0, 'no request reached the provider');
    const files = readdirSync(f.runDir);
    assert.equal(files.some(n => n.endsWith('.usage.json') || n === 'spend-reservations.jsonl'), false, `nothing was spent or reserved: ${files}`);
    assert.ok(files.includes('run.json') && files.includes('cap-screen-1.md'), 'the pending run and its screen exist');
    const screen = readFileSync(join(f.runDir, 'cap-screen-1.md'), 'utf8');
    assert.match(screen, /30/, '--max-usd 30 is shown as a suggestion');
    assert.deepEqual(ledger(f.runDir).map(l => l.event), ['gate_requested']);
    assert.equal(readGateAnswer(f.runDir, 'g1').status, 'pending');
    assert.equal(Object.hasOwn(JSON.parse(readFileSync(join(f.runDir, 'run.json'), 'utf8')), 'maxUsd'), false, 'a pending run carries no limit nobody typed (not the flag, not the $7 default)');
    const again = await f.run(['--resume', f.runDir]);   // the same run asks again: the SAME gate, still no request
    assert.equal(again.status, 21, again.stdout + again.stderr);
    assert.deepEqual(ledger(f.runDir).map(l => l.event), ['gate_requested'], 'a second start appends nothing');
    assert.equal(f.count(), 0);
  } finally { f.srv.close(); }
});

test('after the person types a limit: --resume consumes it once and the run uses it as THE cap (not --max-usd, not the $7 default); a later resume continues with no second consume', async () => {
  const f = await fixture(true);
  try {
    assert.equal((await f.run(['--chain', 'c', '--task', 'tasks/x.md', '--run-id', ID])).status, 21);
    const g = readGateAnswer(f.runDir, 'g1').gate;
    assert.equal(answerGate(f.runDir, 'g1', { channel: 'cli', shownSha256: g.sha256, decision: 'approved', actor: 'tester', tty: true, typedCap: '3.25' }).ok, true);
    assert.equal(f.count(), 0, 'answering sent nothing');
    const go = await f.run(['--resume', f.runDir], 1);
    assert.notEqual(go.status, 21, go.stdout + go.stderr);
    assert.ok(f.count() >= 1, 'the stub was reached once the limit was typed (so the zero above means something)');
    const log = readFileSync(join(f.runDir, 'run.log'), 'utf8');
    assert.match(log, /cap:   \$3\.25 per run \(the limit typed for this run\)/);
    assert.equal(JSON.parse(readFileSync(join(f.runDir, 'run.json'), 'utf8')).maxUsd, 3.25);
    assert.equal(ledger(f.runDir).filter(l => l.event === 'cap_consumed').length, 1);
    await f.run(['--resume', f.runDir], f.count() + 1);
    assert.equal(ledger(f.runDir).filter(l => l.event === 'cap_consumed').length, 1, 'a second resume continues under the same limit, no second consume');
    // the chain file is edited between sittings: the limit typed for the old screen does not cover it, so the next resume asks a NEW question (T4b2: an amend screen that names the chain file), before any request
    const chainPath = join(f.work, 'chains', 'c.json');
    const edited = JSON.parse(readFileSync(chainPath, 'utf8')); edited.seats.criteria.maxTokens = 600;
    writeFileSync(chainPath, JSON.stringify(edited));
    const before = f.count();
    const asked = await f.run(['--resume', f.runDir]);
    assert.equal(asked.status, 21, asked.stdout + asked.stderr);
    assert.match(asked.stderr, /waits for a spending limit that you type/);
    const gates = readdirSync(f.runDir).filter(n => /^cap-screen-\d+\.md$/.test(n)).sort();
    assert.match(readFileSync(join(f.runDir, gates.at(-1)), 'utf8'), /Changed since the limit for this run was typed: the chain file\./);
    assert.equal(f.count(), before, 'no request before the new limit');
    assert.equal(typeCap(f.runDir, '25'), 'g2');
    await f.run(['--resume', f.runDir], f.count() + 1);
    assert.equal(ledger(f.runDir).filter(l => l.event === 'cap_consumed').length, 2, 'the amended limit is the second consumption of the SAME run');
    assert.equal(JSON.parse(readFileSync(join(f.runDir, 'run.json'), 'utf8')).maxUsd, 25);
  } finally { f.srv.close(); }
});

test('a FREE chain is not a paid start: it runs under --max-usd as before, with no gate and no exit 21', async () => {
  const f = await fixture(false);
  try {
    const r = await f.run(['--chain', 'c', '--task', 'tasks/x.md', '--run-id', ID, '--max-usd', '30']);
    assert.notEqual(r.status, 21, r.stdout + r.stderr);
    assert.equal(existsSync(join(f.runDir, 'gates')), false, 'no gate was requested');
    assert.equal(f.count(), 0);
  } finally { f.srv.close(); }
});

test('answer, then resume from ANOTHER directory with a different environment: the limit typed once is consumed once (one cap_consumed, no second gate); the MCP-side ceiling is not part of what was shown', async () => {
  const f = await fixture(true);
  const elsewhere = mkdtempSync(join(tmpdir(), 'thc-typed-cap-elsewhere-'));
  writeFileSync(join(f.work, 'policy.json'), JSON.stringify({ max_usd_per_run: 100 }));
  writeFileSync(join(f.work, 'pricing.user.json'), JSON.stringify({ 'openrouter/anthropic/claude-opus-5': { in: 99, out: 99 } }));   // the project's price file lives in the START directory only: a resume typed elsewhere must read it from the run's recorded folder (a row above the shipped price enters the digest)   // the policy file lives in the START directory only: the digest must read it from the run's recorded cwd on resume, not from where the resume was typed
  try {
    // started where the host's setting COUNCIL_MAX_USD_LIMIT is present (an MCP-started run) ...
    const started = await new Promise(resolve => {
      const child = spawn(process.execPath, [cli, '--chain', 'c', '--task', 'tasks/x.md', '--run-id', ID], { cwd: f.work, env: { ...f.env, COUNCIL_MAX_USD_LIMIT: '50' }, stdio: ['ignore', 'pipe', 'pipe'] });
      child.on('exit', resolve);
    });
    assert.equal(started, 21);
    assert.equal(readGateAnswer(f.runDir, 'g1').gate.cap.ceiling_usd, 50, 'the ceiling is bound in the gate');
    assert.equal(typeCap(f.runDir, '20'), 'g1');
    // ... and resumed from a terminal in a different directory, without that variable
    const go = await new Promise(resolve => {
      const child = spawn(process.execPath, [cli, '--resume', f.runDir], { cwd: elsewhere, env: f.env, stdio: ['ignore', 'pipe', 'pipe'] });
      const poll = setInterval(() => { if (f.count() >= 1) child.kill('SIGKILL'); }, 50);
      child.on('exit', code => { clearInterval(poll); resolve(code); });
    });
    assert.notEqual(go, 21);
    const events = ledger(f.runDir).map(l => l.event);
    assert.equal(events.filter(e => e === 'gate_requested').length, 1, `no second gate: ${events}`);
    assert.equal(events.filter(e => e === 'cap_consumed').length, 1);
    assert.equal(JSON.parse(readFileSync(join(f.runDir, 'run.json'), 'utf8')).maxUsd, 20);
  } finally { f.srv.close(); }
});

test('a paid chain with an UNPRICED seat is refused at the start even when a flag said `none`: exit 5, no run folder, zero requests (the typed cap makes `none` unavailable, so the refusal comes before the typing)', async () => {
  const f = await fixture(true);
  try {
    const base = JSON.parse(readFileSync(join(f.work, 'chains', 'c.json'), 'utf8'));
    writeFileSync(join(f.work, 'chains', 'u.json'), JSON.stringify({ ...base, name: 'u', seats: { ...base.seats, criteria: { ...base.seats.criteria, model: 'vendor/not-in-the-price-table' } } }));
    const r = await f.run(['--chain', 'u', '--task', 'tasks/x.md', '--run-id', ID, '--max-usd', 'none']);
    assert.equal(r.status, 5, r.stdout + r.stderr);
    assert.match(r.stderr, /not-in-the-price-table/);
    assert.equal(existsSync(f.runDir), false, 'no run folder was made');
    assert.equal(f.count(), 0);
  } finally { f.srv.close(); }
});

test('T4b2 RAISE through the CLI: a run stopped at its typed limit (exit 4, before any request) is resumed -> a RAISE screen from the stop file; a new total above the floor is the second consumption of the SAME run and the run goes on', async () => {
  const f = await fixture(true);
  try {
    assert.equal((await f.run(['--chain', 'c', '--task', 'tasks/x.md', '--run-id', ID])).status, 21);
    assert.equal(typeCap(f.runDir, '0.001'), 'g1');                       // a limit too small for the first call: the run stops before it sends anything
    const stopped = await f.run(['--resume', f.runDir]);
    assert.equal(stopped.status, 4, stopped.stdout + stopped.stderr); assert.equal(f.count(), 0);
    assert.ok(existsSync(join(f.runDir, 'STOPPED-budget.json')));
    // the paid chain's way out is the new-total text (a free chain keeps `--resume ... --max-usd N`: stopped-budget-assumed.test.js), and the floor it names is the one the resume screen enforces: spentUsd + assumedAtWorstCase.usd of the stop file
    const stopMd = readFileSync(join(f.runDir, 'STOPPED-budget.md'), 'utf8');
    assert.match(stopMd, /asks for a NEW TOTAL for the whole run \(not extra\): it must be above \$/);
    assert.doesNotMatch(stopMd, /--resume runs\/\S+ --max-usd/, 'a paid stop does not print a --max-usd resume command');
    const st = JSON.parse(readFileSync(join(f.runDir, 'STOPPED-budget.json'), 'utf8'));
    assert.ok(stopMd.includes(`it must be above ${formatUsd(st.spentUsd + (st.assumedAtWorstCase?.usd || 0))}`), stopMd);
    assert.doesNotMatch(readFileSync(join(f.runDir, 'STOPPED-budget.md'), 'utf8'), /--max-usd none/, 'the stop text no longer offers `none`');
    const raise = await f.run(['--resume', f.runDir]);
    assert.equal(raise.status, 21, raise.stdout + raise.stderr);
    assert.match(readFileSync(join(f.runDir, 'cap-screen-2.md'), 'utf8'), /This run stopped at its limit of \$0\.001/);
    assert.match(readFileSync(join(f.runDir, 'cap-screen-2.md'), 'utf8'), /The smallest total that gets past this stop/);
    assert.equal(f.count(), 0);
    assert.equal(typeCap(f.runDir, '5'), 'g2');
    await f.run(['--resume', f.runDir], 1);
    assert.equal(ledger(f.runDir).filter(l => l.event === 'cap_consumed').length, 2, 'a raise is the second consumption of the same run');
    assert.equal(JSON.parse(readFileSync(join(f.runDir, 'run.json'), 'utf8')).maxUsd, 5);
    assert.ok(f.count() >= 1);
  } finally { f.srv.close(); }
});

test('T4b2 LEGACY through the CLI: a resume of a run made before the typed limit existed (no limit gate) shows a legacy screen and asks for a TOTAL; then it goes on', async () => {
  const f = await fixture(true);
  try {
    assert.equal((await f.run(['--chain', 'c', '--task', 'tasks/x.md', '--run-id', ID])).status, 21);
    const legacyDir = join(f.work, 'runs', '2026-10-13T09-00-00-000Z'); mkdirSync(legacyDir);
    writeFileSync(join(legacyDir, 'run.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(f.runDir, 'run.json'), 'utf8')), maxUsd: 2 }));   // a run.json of the old kind: a saved cap, no gate
    const asked = await f.run(['--resume', legacyDir]);
    assert.equal(asked.status, 21, asked.stdout + asked.stderr);
    assert.match(readFileSync(join(legacyDir, 'cap-screen-1.md'), 'utf8'), /This run was started before a typed limit existed\.\nAlready counted:/);
    assert.equal(f.count(), 0);
    assert.equal(typeCap(legacyDir, '3'), 'g1');
    await f.run(['--resume', legacyDir], 1);
    assert.equal(ledger(legacyDir).filter(l => l.event === 'cap_consumed').length, 1);
    assert.equal(JSON.parse(readFileSync(join(legacyDir, 'run.json'), 'utf8')).maxUsd, 3);
  } finally { f.srv.close(); }
});

test('T4c: `--max-usd none` on a PAID chain is refused on the main path too, at the start and at the resume (exit 2, the same sentence as the side commands, no run folder at the start, no request, no new gate); a chain with no paid seat keeps it', async () => {
  const f = await fixture(true);
  try {
    const none = await f.run(['--chain', 'c', '--task', 'tasks/x.md', '--run-id', ID, '--max-usd', 'none']);
    assert.equal(none.status, 2, none.stdout + none.stderr);
    assert.equal(none.stderr.trim(), '--max-usd none is not offered: a limit is a number a person types. Nothing was started.');
    assert.equal(existsSync(f.runDir), false, 'no run folder was made'); assert.equal(f.count(), 0);
    assert.equal((await f.run(['--chain', 'c', '--task', 'tasks/x.md', '--run-id', ID])).status, 21);   // a start without the flag waits as always
    const gates = ledger(f.runDir).length;
    const resume = await f.run(['--resume', f.runDir, '--max-usd', 'none']);
    assert.equal(resume.status, 2, resume.stdout + resume.stderr);
    assert.equal(resume.stderr.trim(), '--max-usd none is not offered: a limit is a number a person types. Nothing was started.');
    assert.equal(ledger(f.runDir).length, gates, 'the resume asked nothing new and wrote nothing'); assert.equal(f.count(), 0);
  } finally { f.srv.close(); }
  const free = await fixture(false);
  try {
    const r = await free.run(['--chain', 'c', '--task', 'tasks/x.md', '--run-id', ID, '--max-usd', 'none']);
    assert.notEqual(r.status, 21, r.stdout + r.stderr); assert.doesNotMatch(r.stderr, /not offered/);   // no gate, no refusal: the flag stays for a chain with no paid seat
  } finally { free.srv.close(); }
});

test('T4c fix-up: `none` from MAX_USD_PER_RUN (a .env, no flag typed) on a PAID start is refused with a sentence that names MAX_USD_PER_RUN, not a flag the person never used; with the flag typed the sentence names the flag', async () => {
  const f = await fixture(true);
  try {
    writeFileSync(join(f.work, '.env'), 'MAX_USD_PER_RUN=none\n');
    const env = await f.run(['--chain', 'c', '--task', 'tasks/x.md', '--run-id', ID]);
    assert.equal(env.status, 2, env.stdout + env.stderr);
    assert.equal(env.stderr.trim(), 'MAX_USD_PER_RUN=none is not offered: a limit is a number a person types. Nothing was started.');
    assert.equal(existsSync(f.runDir), false, 'no run folder was made'); assert.equal(f.count(), 0);
    const flag = await f.run(['--chain', 'c', '--task', 'tasks/x.md', '--run-id', ID, '--max-usd', 'none']);
    assert.equal(flag.stderr.trim(), '--max-usd none is not offered: a limit is a number a person types. Nothing was started.');
  } finally { f.srv.close(); }
});

