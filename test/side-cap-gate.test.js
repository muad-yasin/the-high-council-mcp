// T5a (typed cap, the paid side commands; T5 gate page of 14 Oct 2026, C&C's conditions 1-6): --rematch and --replay of a PAID chain wait for a limit a person types, exactly like a run (same authorizeStart, operation side:<verb>).
// $0: a stub provider on loopback answers 500, so a request that is sent is only counted. The original run is made with a MOCK chain and the chain file is then swapped for a paid seat (the way unpriced-seat-refusal.test.js does), so the rematch / replay config is paid while the original is finished.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { typeCap } from './helpers/typed-cap.js';
import { LEDGER_FILE } from '../src/gate-ledger.js';
import { readGateAnswer } from '../src/gate.js';
import { listRuns } from '../src/api.js';
import { runResumability, deriveRunStatus } from '../src/run-status.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const ID = '2026-10-14T12-00-00-000Z';
const DATE = '2026-10-14';
const PAID = port => ({ provider: 'openrouter', model: 'anthropic/claude-opus-5', originalProvider: 'anthropic', maxTokens: 500, baseUrl: `http://127.0.0.1:${port}` });

async function fixture({ unpriced = false } = {}) {
  let requests = 0;
  const srv = http.createServer((req, res) => { requests += 1; req.resume(); res.statusCode = 500; res.end('{"error":"stub"}'); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const work = mkdtempSync(join(tmpdir(), 'thc-side-cap-')); mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'chains'));
  writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  writeFileSync(join(work, 'chains', 'c.json'), JSON.stringify({ ...base, name: 'c' }));
  const env = { PATH: process.env.PATH, HOME: work, OPENROUTER_API_KEY: `sk-or-v1-${'e'.repeat(40)}`, COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' };
  const run = (args, until = null) => new Promise(resolve => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    const poll = until ? setInterval(() => { if (requests >= until) child.kill('SIGKILL'); }, 50) : null;
    child.on('exit', status => { clearTimeout(timer); if (poll) clearInterval(poll); resolve({ status, stdout, stderr }); });
  });
  // the original: a finished MOCK run, then the chain file seats a paid criteria seat (or an unpriced one)
  const first = await run(['--chain', 'c', '--task', 'tasks/x.md', '--run-id', ID]);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const seat = unpriced ? { provider: 'openrouter', model: 'vendor/not-in-the-table', originalProvider: 'openrouter', maxTokens: 500, baseUrl: `http://127.0.0.1:${srv.address().port}` } : PAID(srv.address().port);
  writeFileSync(join(work, 'chains', 'c.json'), JSON.stringify({ ...base, name: 'c', seats: { ...base.seats, criteria: seat } }));
  return { srv, work, run, count: () => requests, origDir: join(work, 'runs', ID), rematchDir: seed => join(work, 'runs', `${ID}.rematch-${seed}`), replayDir: join(work, 'runs', `${ID}.replay-${DATE}`) };
}
const ledger = d => readFileSync(join(d, LEDGER_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
// the arguments of the command the exit-21 text prints as step 2 (it begins with the invocation word `council`, which the test replaces by its own spawn)
const printedArgs = stderr => {
  // two places print it: step 2 of the exit-21 text ("  2. council --rematch ...") and the budget stop's last line ("  council --rematch ...")
  const line = stderr.split('\n').find(l => /^\s*(2\.\s+)?\S+\s+(--rematch|--replay)\s/.test(l));
  assert.ok(line, `the stop text prints the command that finds this logical run again: ${stderr}`);
  return line.replace(/^\s*(2\.\s+)?\S+\s+/, '').trim().split(/\s+/);
};

test('REMATCH of a paid chain: exit 21 with the screen in the rematch folder, ZERO requests, --max-usd only a suggestion; the printed command carries the seed; after the limit is typed the SAME command consumes it once (one gate) and the stub is reached', async () => {
  const f = await fixture();
  try {
    const r = await f.run(['--rematch', join('runs', ID), '--rematch-seed', '7', '--max-usd', '30']);
    assert.equal(r.status, 21, r.stdout + r.stderr);
    assert.match(r.stderr, /This rematch waits for a spending limit that you type\. No call was started and nothing more was spent\./);
    assert.equal(f.count(), 0, 'no request reached the provider');
    const d = f.rematchDir(7);
    assert.ok(existsSync(join(d, 'cap-screen-1.md')) && existsSync(join(d, 'cap-scope-1.json')), 'the screen and its scope are in the rematch folder');
    assert.equal(existsSync(join(d, 'run.json')), false, 'a pending rematch folder has no run.json yet');
    const screen = readFileSync(join(d, 'cap-screen-1.md'), 'utf8');
    assert.match(screen, /^Run this rematch\? Chain: c\./);
    assert.match(screen, /Configured suggestion: \$30\.00 \(from --max-usd\)\. It is shown only/);
    assert.deepEqual(ledger(d).map(l => l.event), ['gate_requested']);
    assert.equal(readGateAnswer(d, 'g1').gate.cap.operation, 'side:rematch');
    assert.deepEqual(readdirSync(d).filter(n => n.endsWith('.usage.json') || n === 'spend-reservations.jsonl'), [], 'nothing was spent or reserved');
    const again = printedArgs(r.stderr);
    assert.deepEqual(again.slice(0, 1), ['--rematch']); assert.ok(again.includes('--rematch-seed') && again.includes('7'), `the printed command carries the seed: ${again}`);
    typeCap(d, '3.25');
    const go = await f.run(again, 1);   // the PRINTED command, nothing else
    assert.ok(f.count() >= 1, `the rematch went on and reached the provider: ${go.stdout}${go.stderr}`);
    assert.match(go.stdout, /cap:   \$3\.25 \(the limit typed for this rematch\)/);
    assert.deepEqual(ledger(d).map(l => l.event), ['gate_requested', 'gate_answered', 'cap_consumed'], 'ONE gate: the printed command found the same logical run');
  } finally { f.srv.close(); }
});

test('REMATCH: --max-usd none is refused with one sentence on a paid chain (nothing created); an UNPRICED seat is refused with exit 5 even with `none`, before any folder exists', async () => {
  const f = await fixture();
  try {
    const r = await f.run(['--rematch', join('runs', ID), '--rematch-seed', '7', '--max-usd', 'none']);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.equal(r.stderr.trim(), '--max-usd none is not offered: a limit is a number a person types. Nothing was started.');
    assert.equal(f.count(), 0); assert.equal(existsSync(f.rematchDir(7)), false, 'no rematch folder');
  } finally { f.srv.close(); }
  const g = await fixture({ unpriced: true });
  try {
    for (const flags of [[], ['--max-usd', 'none']]) {
      const r = await g.run(['--rematch', join('runs', ID), '--rematch-seed', '7', ...flags]);
      assert.equal(r.status, 5, `${flags}: ${r.stdout}${r.stderr}`);
      assert.equal(existsSync(g.rematchDir(7)), false, 'exit 5 leaves no rematch folder');
    }
    assert.equal(g.count(), 0);
  } finally { g.srv.close(); }
});

test('REMATCH: a stop at the typed total writes ONE stop file in the rematch folder; the printed command shows a RAISE screen above the floor; FREE rematches are unchanged (see side-run-budget.test.js)', async () => {
  const f = await fixture();
  try {
    const first = await f.run(['--rematch', join('runs', ID), '--rematch-seed', '7']);
    assert.equal(first.status, 21);
    typeCap(f.rematchDir(7), '0.001');                       // below the first call's worst case: the run stops before it sends anything
    const stop = await f.run(printedArgs(first.stderr));
    assert.equal(stop.status, 4, stop.stdout + stop.stderr); assert.equal(f.count(), 0);
    assert.match(stop.stderr, /Run the same command again: it asks for a new total above \$0\.0000 \(the smallest that gets past this stop is \$0\.0500\):\n  \S+ --rematch \S+ --rematch-seed 7/);
    assert.doesNotMatch(stop.stderr, /--max-usd none/);
    const d = f.rematchDir(7);
    assert.deepEqual(readdirSync(d).filter(n => /^STOPPED-budget\./.test(n)).sort(), ['STOPPED-budget.json'], 'one stop file, in the rematch folder (the original run folder is untouched)');
    assert.equal(existsSync(join(f.origDir, 'STOPPED-budget.json')), false);
    const raise = await f.run(printedArgs(stop.stderr));
    assert.equal(raise.status, 21, raise.stdout + raise.stderr);
    assert.match(readFileSync(join(d, 'cap-screen-2.md'), 'utf8'), /This run stopped at its limit of \$0\.0010/);
  } finally { f.srv.close(); }
});

test('FLOOR (condition 1), rematch: the screen\'s floor IS what the armed budget carries as earlier spend: an unsettled reservation of $0.50 in the rematch folder shows on the screen, a total not above it is set aside, a total just above it stops at the first call with spentUsd = the floor', async () => {
  const f = await fixture();
  try {
    const d = f.rematchDir(7); mkdirSync(d, { recursive: true });
    appendFileSync(join(d, 'spend-reservations.jsonl'), `${JSON.stringify({ schema: 'spend-reservations/1', event: 'reserved', id: 'r900', label: 'criteria', seat: 'p/m', usd: 0.5, at: '2026-10-14T10:00:00.000Z' })}\n`);
    const first = await f.run(['--rematch', join('runs', ID), '--rematch-seed', '7']);
    assert.equal(first.status, 21, first.stdout + first.stderr);
    const screen = readFileSync(join(d, 'cap-screen-1.md'), 'utf8');
    assert.match(screen, /Already counted for this folder: \$0\.5000\./);
    assert.match(screen, /It must be above \$0\.5000\./);
    typeCap(d, '0.5');                                        // not above the floor: set aside, a new question
    const aside = await f.run(printedArgs(first.stderr));
    assert.equal(aside.status, 21, aside.stdout + aside.stderr); assert.equal(f.count(), 0);
    assert.match(aside.stderr, /is not above what the run has already counted/);
    typeCap(d, '0.52');                                       // above the floor, below floor + the first call's worst case: stops with the floor as its spend
    const stop = await f.run(printedArgs(aside.stderr));
    assert.equal(stop.status, 4, stop.stdout + stop.stderr); assert.equal(f.count(), 0);
    const st = JSON.parse(readFileSync(join(d, 'STOPPED-budget.json'), 'utf8'));
    const floor = Number(screen.match(/Already counted for this folder: \$([0-9.]+)\./)[1]);
    assert.equal(st.capUsd, 0.52); assert.ok(Math.abs(st.spentUsd - floor) < 1e-9, `the armed earlier spend ${st.spentUsd} equals the floor on the screen ${floor}`);
  } finally { f.srv.close(); }
});

test('CONSUMED, THEN DEAD (condition 2), rematch: the state a death after the consumption leaves is made through the real consumeRunCap (NO process is killed here); the re-run continues under the recorded limit with NO second screen', async () => {
  const f = await fixture();
  try {
    const first = await f.run(['--rematch', join('runs', ID), '--rematch-seed', '7']);
    assert.equal(first.status, 21);
    const d = f.rematchDir(7);
    const gate = typeCap(d, '2.5');
    const { consumeRunCap } = await import('../src/gate.js');
    const bound = readGateAnswer(d, gate).gate.cap.scope_sha256;
    assert.equal(consumeRunCap(d, gate, { runId: `${ID}.rematch-7`, scopeSha256: bound }).ok, true);   // the state a death after the consumption leaves
    const events = () => ledger(d).map(l => l.event);
    assert.deepEqual(events(), ['gate_requested', 'gate_answered', 'cap_consumed']);
    const again = await f.run(printedArgs(first.stderr), 1);
    assert.ok(f.count() >= 1, `the re-run continued to the provider: ${again.stdout}${again.stderr}`);
    assert.match(again.stdout, /cap:   \$2\.50 \(the limit typed for this rematch\)/);
    assert.deepEqual(events(), ['gate_requested', 'gate_answered', 'cap_consumed'], 'no second screen, no second consumption');
  } finally { f.srv.close(); }
});

test('REPLAY of a paid chain: the limit is asked in the replay folder AFTER the replay\'s own refusals; exit 21, zero requests, the printed command carries the date; one gate; the run goes on under the typed total', async () => {
  const f = await fixture();
  try {
    const r = await f.run(['--replay', join('runs', ID), '--replay-date', DATE]);
    assert.equal(r.status, 21, r.stdout + r.stderr);
    assert.match(r.stderr, /This replay waits for a spending limit that you type\./);
    assert.equal(f.count(), 0);
    const d = f.replayDir;
    assert.match(readFileSync(join(d, 'cap-screen-1.md'), 'utf8'), /^Run this replay\? Chain: c\./);
    assert.equal(readGateAnswer(d, 'g1').gate.cap.operation, 'side:replay');
    const again = printedArgs(r.stderr); assert.ok(again.includes('--replay-date') && again.includes(DATE), `the printed command carries the date: ${again}`);
    typeCap(d, '3');
    const go = await f.run(again, 1);
    assert.ok(f.count() >= 1, `${go.stdout}${go.stderr}`);
    assert.match(go.stdout, /cap:   \$3\.00 \(the limit typed for this replay\)/);
    assert.deepEqual(ledger(d).map(l => l.event), ['gate_requested', 'gate_answered', 'cap_consumed']);
    // a refusal of the replay itself comes BEFORE any screen: the task file changed since the original run -> exit 1 with no gate
    const g = await fixture();
    try {
      writeFileSync(join(g.work, 'tasks', 'x.md'), 'A different task now.\n');
      const drift = await g.run(['--replay', join('runs', ID), '--replay-date', DATE]);
      assert.equal(drift.status, 1, drift.stdout + drift.stderr);
      assert.match(drift.stderr, /task file has changed since the original run/);
      assert.equal(existsSync(join(g.replayDir, LEDGER_FILE)), false, 'a replay that is refused for task drift asked for no limit');
    } finally { g.srv.close(); }
  } finally { f.srv.close(); }
});

test('REPLAY: the typed total is armed BEFORE the first call (the hook is awaited): a total below the first call\'s worst case stops with exit 4, ZERO requests, and a STOPPED-budget.json in the replay folder', async () => {
  const f = await fixture();
  try {
    const r = await f.run(['--replay', join('runs', ID), '--replay-date', DATE]);
    assert.equal(r.status, 21, r.stdout + r.stderr);
    typeCap(f.replayDir, '0.001');
    const stop = await f.run(printedArgs(r.stderr));
    assert.equal(stop.status, 4, stop.stdout + stop.stderr);
    assert.equal(f.count(), 0, 'no request was sent under a total that cannot pay for the first call');
    assert.equal(existsSync(join(f.replayDir, 'STOPPED-budget.json')), true);
  } finally { f.srv.close(); }
});

test('REPLAY: --max-usd none is refused on a paid chain; an unpriced seat is refused with exit 5 before any folder', async () => {
  const f = await fixture();
  try {
    const r = await f.run(['--replay', join('runs', ID), '--replay-date', DATE, '--max-usd', 'none']);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.equal(r.stderr.trim(), '--max-usd none is not offered: a limit is a number a person types. Nothing was started.');
    assert.equal(existsSync(f.replayDir), false);
  } finally { f.srv.close(); }
  const g = await fixture({ unpriced: true });
  try {
    const r = await g.run(['--replay', join('runs', ID), '--replay-date', DATE]);
    assert.equal(r.status, 5, r.stdout + r.stderr); assert.equal(existsSync(g.replayDir), false);
    // T5b (C&C carried pin): the same refusal WITH `none` (the paid-start refusal does not wait for a number; without paidStart the `none` sentence, exit 2, would come first)
    const withNone = await g.run(['--replay', join('runs', ID), '--replay-date', DATE, '--max-usd', 'none']);
    assert.equal(withNone.status, 5, withNone.stdout + withNone.stderr); assert.equal(existsSync(g.replayDir), false);
  } finally { g.srv.close(); }
});

test('REPLAY GUARD (T5b, C&C carried pin): a chain the CLI could not pre-read (a transport with no route for its paid seat) but the replay reads as it is is refused with one sentence, before any folder, request or gate', async () => {
  const f = await fixture();
  try {
    const base = JSON.parse(readFileSync(join(f.work, 'chains', 'c.json'), 'utf8'));
    writeFileSync(join(f.work, 'chains', 'c.json'), JSON.stringify({ ...base, transport: 'openrouter', seats: { ...base.seats, criteria: { provider: 'anthropic', model: 'claude-not-routed-9', maxTokens: 500 } } }));
    const r = await f.run(['--replay', join('runs', ID), '--replay-date', DATE]);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /--replay: the chain could not be read before the run, so no limit can be asked for it\. Nothing was started\./);
    assert.equal(f.count(), 0); assert.equal(existsSync(f.replayDir), false);
  } finally { f.srv.close(); }
});

test('PENDING FOLDER (condition 5): a rematch / replay folder that waits for its limit (gate files, no run.json) is listed by api.listRuns, reads as awaiting_user_cap, and is NOT resumable (the way on is the same command again)', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.run(['--rematch', join('runs', ID), '--rematch-seed', '7'])).status, 21);
    assert.equal((await f.run(['--replay', join('runs', ID), '--replay-date', DATE])).status, 21);
    const listed = listRuns({ cwd: f.work }).map(r => r.id ?? r.runId ?? r.name);
    assert.ok(listed.some(n => String(n).endsWith('.rematch-7')) && listed.some(n => String(n).endsWith(`.replay-${DATE}`)), `both pending folders are listed: ${listed}`);
    for (const d of [f.rematchDir(7), f.replayDir]) {
      assert.equal(deriveRunStatus(d, null), 'awaiting_user_cap', `${d}: run_status derivation on a folder with no run.json`);
      const res = runResumability(d, null);
      assert.equal(res.resumable, false, 'a --rematch / --replay folder is never resumed (--resume refuses it): answer the gate, then run the same command again');
      assert.deepEqual([res.reason, res.needs], ['side_command_awaiting_limit', 'type_limit_and_rerun']);
    }
    // an unseeded rematch run twice leaves two pending folders and no spend
    const a = await f.run(['--rematch', join('runs', ID)]); const b = await f.run(['--rematch', join('runs', ID)]);
    assert.equal(a.status, 21); assert.equal(b.status, 21);
    const folders = readdirSync(join(f.work, 'runs')).filter(n => /\.rematch-\d+$/.test(n));
    assert.ok(folders.length >= 2, `${folders}`);
    assert.equal(f.count(), 0, 'no spend');
  } finally { f.srv.close(); }
});

test('THE PRINTED COMMAND IS THE PERSON\'S OWN: every flag typed is kept (--allow-task-drift for a replay), and the seed / date is added only when it was left out', async () => {
  const f = await fixture();
  try {
    writeFileSync(join(f.work, 'tasks', 'x.md'), 'The task changed after the original run.\n');
    const r = await f.run(['--replay', join('runs', ID), '--allow-task-drift']);
    assert.equal(r.status, 21, r.stdout + r.stderr);
    const again = printedArgs(r.stderr);
    assert.ok(again.includes('--allow-task-drift'), `the flag the person typed is in the printed command: ${again}`);
    assert.ok(again.includes('--replay-date'), `the date is added when it was left out: ${again}`);
    // 15 Okt 2026 (date fix): the replay folder is named after the date the PRINTED command carries (left out = TODAY), not after the fixture's fixed 2026-10-14; the test failed from the first midnight on.
    const printedDate = again[again.indexOf('--replay-date') + 1];
    assert.match(printedDate ?? '', /^\d{4}-\d{2}-\d{2}$/, `the printed command carries a date: ${again}`);
    typeCap(join(f.work, 'runs', `${ID}.replay-${printedDate}`), '3');
    const go = await f.run(again, 1);          // without the kept flag this would be refused for task drift before the stub; with it the run reaches the provider
    assert.ok(f.count() >= 1, `${go.stdout}${go.stderr}`);
    // an unseeded rematch prints the seed it picked, and a seed the person passed is not repeated
    const m = await f.run(['--rematch', join('runs', ID)]);
    assert.equal(m.status, 21); const margs = printedArgs(m.stderr);
    assert.equal(margs.filter(a => a === '--rematch-seed').length, 1, `${margs}`);
    const seeded = await f.run(['--rematch', join('runs', ID), '--rematch-seed', '9']);
    assert.equal(printedArgs(seeded.stderr).filter(a => a === '--rematch-seed').length, 1);
  } finally { f.srv.close(); }
});
