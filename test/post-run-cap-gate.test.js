// T5b (typed cap, the paid post-run calls; T5 gate page of 14 Oct 2026, C&C's conditions 1-6): `handoff --from-run`, `contract draft --from-run` and `digest --provider` on a PAID seat wait for a limit a person types, exactly like a run (same authorizeStart, operation side:<verb>).
// The gate lives in `<original run folder>/side/<verb>-<h8>/`; the spend, the floor and the usage lines are the ORIGINAL folder's. $0: a stub provider on loopback answers 500 (a request that is sent is only counted); a digest has no base-url flag, so its rows stop at the limit BEFORE any call.
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
import { readGateAnswer, consumeRunCap } from '../src/gate.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const ID = '2026-10-02T23-00-00-000Z';
const PAID = port => ({ provider: 'openrouter', model: 'anthropic/claude-opus-5', originalProvider: 'anthropic', maxTokens: 500, baseUrl: `http://127.0.0.1:${port}` });
const KEY = `sk-or-v1-${'e'.repeat(40)}`;

// a finished run folder with a draft (build.md), criteria and a task, and a chain whose builder/handoff seat is the stub; `seat` can be swapped (unpriced, mock)
async function fixture({ unpriced = false, free = false, id = ID } = {}) {
  let requests = 0;
  const srv = http.createServer((req, res) => { requests += 1; req.resume(); res.statusCode = 500; res.end('{"error":"stub"}'); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'thc-post-run-cap-')); mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small command-line tool.\n');
  const port = srv.address().port;
  const seat = free ? { provider: 'mock', model: 'mock-handoff' }
    : unpriced ? { provider: 'openrouter', model: 'vendor/not-in-the-table', originalProvider: 'openrouter', maxTokens: 500, baseUrl: `http://127.0.0.1:${port}` } : PAID(port);
  writeFileSync(join(dir, 'chains', 'h.json'), JSON.stringify({ name: 'h', maxRounds: 1, seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: seat, critics: [{ provider: 'mock', model: 'mock-critic-passer', lab: 'c' }] } }));
  const rd = join(dir, 'runs', id);
  mkdirSync(rd, { recursive: true });
  writeFileSync(join(rd, 'run.json'), JSON.stringify({ chain: 'h', task: 'tasks/t.md', cwd: dir, maxUsd: 5 }));
  writeFileSync(join(rd, 'criteria.md'), '{"criteria": ["It renames by date"]}');
  writeFileSync(join(rd, 'build.md'), '# Plan\n\nRename photos by date.\n');
  writeFileSync(join(rd, 'report.json'), JSON.stringify({ outcome: 'no_consensus', disagreement_groups: [{ on: 'p1', title: 'whether to build item 4', posts: [{ by: 'deepseek', stance: 'object', text: 'adds a script' }] }] }));
  const env = { PATH: process.env.PATH, HOME: dir, OPENROUTER_API_KEY: KEY, COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' };
  const run = (args, until = null) => new Promise(resolve => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    const poll = until ? setInterval(() => { if (requests >= until) child.kill('SIGKILL'); }, 50) : null;
    child.on('exit', status => { clearTimeout(timer); if (poll) clearInterval(poll); resolve({ status, stdout, stderr }); });
  });
  const gateDir = verb => { const side = join(rd, 'side'); const n = existsSync(side) ? readdirSync(side).find(x => x.startsWith(`${verb}-`)) : null; return n ? join(side, n) : null; };
  return { srv, dir, rd, run, count: () => requests, gateDir, handoff: (...x) => ['handoff', '--from-run', join('runs', id), ...x] };
}
const ledger = d => readFileSync(join(d, LEDGER_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
// the arguments of the command the exit-21 text prints as step 2 (it begins with the invocation word `council`, which the test replaces by its own spawn)
const printedArgs = stderr => {
  const line = stderr.split('\n').find(l => /^\s*(2\.\s+)\S+\s+\S/.test(l)) ?? stderr.split('\n').find(l => /^\s{2}\S+\s+(handoff|contract|digest)\s/.test(l));
  assert.ok(line, `the stop text prints the command that finds this logical run again: ${stderr}`);
  return line.replace(/^\s*(2\.\s+)?\S+\s+/, '').trim().split(/\s+/);
};

test('HANDOFF of a paid seat: exit 21 with the screen in side/handoff-<h8>, ZERO requests, --max-usd only a suggestion, run id <run>:handoff-<h8>, nothing but gate files in the gate folder; the SAME printed command consumes the limit once and reaches the stub', async () => {
  const f = await fixture();
  try {
    const r = await f.run(f.handoff('--max-usd', '7'));
    assert.equal(r.status, 21, r.stdout + r.stderr);
    assert.match(r.stderr, /This handoff waits for a spending limit that you type\. No call was started and nothing more was spent\./);
    assert.equal(f.count(), 0);
    const d = f.gateDir('handoff'); assert.ok(d, 'a gate folder side/handoff-<h8>');
    assert.match(d, /side[\\/]handoff-[0-9a-f]{8}$/);
    const screen = readFileSync(join(d, 'cap-screen-1.md'), 'utf8');
    assert.match(screen, /^Run this handoff\? Chain: h\./);
    assert.match(screen, /Configured suggestion: \$7\.00 \(from --max-usd\)\. It is shown only; it is not your limit until you type it\./);
    const gate = readGateAnswer(d, 'g1').gate.cap;
    assert.equal(gate.operation, 'side:handoff');
    assert.equal(gate.run_id, `${ID}:${d.split(/[\\/]/).pop()}`);
    assert.deepEqual(readdirSync(d).filter(n => /usage/.test(n)), [], 'the gate folder holds no usage file');
    assert.equal(existsSync(join(f.rd, 'HANDOFF.md')), false);
    const again = printedArgs(r.stderr);
    assert.deepEqual(again, f.handoff('--max-usd', '7'), 'the printed command is the person\'s own');
    typeCap(d, '3');
    const go = await f.run(again, 1);
    assert.ok(f.count() >= 1, `${go.stdout}${go.stderr}`);
    assert.match(go.stdout, /cap \$3\.00, \$0\.0000 already spent/);
    assert.deepEqual(ledger(d).map(l => l.event), ['gate_requested', 'gate_answered', 'cap_consumed']);
  } finally { f.srv.close(); }
});

test('`--max-usd none` is refused on a paid handoff with one sentence and no gate folder; an UNPRICED seat is refused with exit 5 EVEN with `none` (the paid-start refusal does not wait for a number)', async () => {
  const f = await fixture();
  try {
    const r = await f.run(f.handoff('--max-usd', 'none'));
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.equal(r.stderr.trim(), '--max-usd none is not offered: a limit is a number a person types. Nothing was started.');
    assert.equal(existsSync(join(f.rd, 'side')), false); assert.equal(f.count(), 0);
  } finally { f.srv.close(); }
  const g = await fixture({ unpriced: true });
  try {
    const r = await g.run(g.handoff('--max-usd', 'none'));
    assert.equal(r.status, 5, r.stdout + r.stderr); assert.equal(existsSync(join(g.rd, 'side')), false);
    const noFlag = await g.run(g.handoff());
    assert.equal(noFlag.status, 5, noFlag.stdout + noFlag.stderr);
  } finally { g.srv.close(); }
});

test('FLOOR (condition 1), handoff: the screen\'s floor IS the ORIGINAL folder\'s counted spend (an unsettled $0.50 there), the main run\'s own STOPPED-budget.json never makes the first screen a raise screen and is never overwritten; a total just above the floor stops at the call with spentUsd = the floor, ONE stop file in the gate folder, and the next screen is a raise', async () => {
  const f = await fixture();
  try {
    appendFileSync(join(f.rd, 'spend-reservations.jsonl'), `${JSON.stringify({ schema: 'spend-reservations/1', event: 'reserved', id: 'r900', label: 'criteria', seat: 'p/m', usd: 0.5, at: '2026-10-14T10:00:00.000Z' })}\n`);
    const mainStop = JSON.stringify({ stoppedAt: 'criteria', seat: 'p/m', spentUsd: 0.3, capUsd: 1, projectedStageUsd: 2 });
    writeFileSync(join(f.rd, 'STOPPED-budget.json'), mainStop);
    const first = await f.run(f.handoff());
    assert.equal(first.status, 21, first.stdout + first.stderr);
    const d = f.gateDir('handoff');
    const screen = readFileSync(join(d, 'cap-screen-1.md'), 'utf8');
    assert.match(screen, /^Run this handoff\?/, 'a first side screen, not a "Continue this run?" raise screen');
    assert.match(screen, /Already counted for this folder: \$0\.5000\./);
    assert.match(screen, /It must be above \$0\.5000\./);
    typeCap(d, '0.52');
    const stop = await f.run(printedArgs(first.stderr));
    assert.equal(stop.status, 4, stop.stdout + stop.stderr); assert.equal(f.count(), 0);
    const st = JSON.parse(readFileSync(join(d, 'STOPPED-budget.json'), 'utf8'));
    const floor = Number(screen.match(/Already counted for this folder: \$([0-9.]+)\./)[1]);
    assert.equal(st.capUsd, 0.52); assert.ok(Math.abs(st.spentUsd - floor) < 1e-9, `the armed earlier spend ${st.spentUsd} equals the floor on the screen ${floor}`);
    assert.match(stop.stderr, /Run the same command again: it asks for a new total above \$0\.5000 \(the smallest that gets past this stop is \$[0-9.]+\):/);
    assert.equal(readFileSync(join(f.rd, 'STOPPED-budget.json'), 'utf8'), mainStop, 'the main run\'s stop file is untouched');
    assert.equal(existsSync(join(f.rd, 'HANDOFF.md')), false);
    const next = await f.run(printedArgs(stop.stderr));
    assert.equal(next.status, 21, next.stdout + next.stderr);
    assert.match(readFileSync(join(d, 'cap-screen-2.md'), 'utf8'), /stopped at its limit of \$0\.5200/, 'after a stop the next screen is a raise screen');
  } finally { f.srv.close(); }
});

test('CONSUMED, THEN DEAD (condition 2), handoff: the state a death after the consumption leaves is made through the real consumeRunCap (NO process is killed here); the re-run continues under the recorded limit with NO second screen', async () => {
  const f = await fixture();
  try {
    const first = await f.run(f.handoff());
    assert.equal(first.status, 21);
    const d = f.gateDir('handoff');
    const gate = typeCap(d, '2.5');
    const bound = readGateAnswer(d, gate).gate.cap.scope_sha256;
    assert.equal(consumeRunCap(d, gate, { runId: `${ID}:${d.split(/[\\/]/).pop()}`, scopeSha256: bound }).ok, true);   // the state a death after the consumption leaves
    const events = () => ledger(d).map(l => l.event);
    assert.deepEqual(events(), ['gate_requested', 'gate_answered', 'cap_consumed']);
    const again = await f.run(printedArgs(first.stderr), 1);
    assert.ok(f.count() >= 1, `the re-run continued to the provider: ${again.stdout}${again.stderr}`);
    assert.match(again.stdout, /cap \$2\.50,/);
    assert.deepEqual(events(), ['gate_requested', 'gate_answered', 'cap_consumed'], 'no second screen, no second consumption');
  } finally { f.srv.close(); }
});

test('A CHANGED DRAFT is an AMEND of the same logical run: after the limit was consumed, editing the draft the handoff works from asks again and the screen names "the draft it works from"', async () => {
  const f = await fixture();
  try {
    const first = await f.run(f.handoff());
    assert.equal(first.status, 21);
    const d = f.gateDir('handoff');
    const gate = typeCap(d, '2.5');
    consumeRunCap(d, gate, { runId: `${ID}:${d.split(/[\\/]/).pop()}`, scopeSha256: readGateAnswer(d, gate).gate.cap.scope_sha256 });
    writeFileSync(join(f.rd, 'build.md'), '# Plan\n\nRename photos by date, and by place.\n');
    const second = await f.run(printedArgs(first.stderr));
    assert.equal(second.status, 21, second.stdout + second.stderr); assert.equal(f.count(), 0);
    assert.match(readFileSync(join(d, 'cap-screen-2.md'), 'utf8'), /Changed since the limit for this run was typed: the draft it works from\./);
    assert.equal(f.gateDir('handoff'), d, 'the same gate folder: one logical run');
  } finally { f.srv.close(); }
});

test('CONTRACT DRAFT of a paid seat: its own gate folder side/draft-<h8>, operation side:draft, the screen and the stop text name "contract draft"; the handoff and the draft are two logical runs', async () => {
  const f = await fixture();
  try {
    const r = await f.run(['contract', 'draft', '--from-run', join('runs', ID)]);
    assert.equal(r.status, 21, r.stdout + r.stderr);
    assert.match(r.stderr, /This contract draft waits for a spending limit that you type\./);
    assert.equal(f.count(), 0);
    const d = f.gateDir('draft'); assert.ok(d);
    assert.match(readFileSync(join(d, 'cap-screen-1.md'), 'utf8'), /^Run this contract draft\? Chain: h\./);
    assert.equal(readGateAnswer(d, 'g1').gate.cap.operation, 'side:draft');
    assert.deepEqual(printedArgs(r.stderr), ['contract', 'draft', '--from-run', join('runs', ID)]);
    const h = await f.run(f.handoff());
    assert.equal(h.status, 21);
    assert.notEqual(f.gateDir('handoff'), d); assert.equal(readdirSync(join(f.rd, 'side')).length, 2);
  } finally { f.srv.close(); }
});

test('A FREE seat has no gate: a handoff on a mock seat runs as before (no side folder, no screen)', async () => {
  const f = await fixture({ free: true });
  try {
    const r = await f.run(f.handoff());
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(existsSync(join(f.rd, 'side')), false);
    assert.ok(existsSync(join(f.rd, 'HANDOFF.md')));
  } finally { f.srv.close(); }
});

test('A run folder whose name cannot carry the logical run id (longer than 120 characters with the suffix) is refused with one sentence before any gate', async () => {
  const f = await fixture({ id: `${ID}-${'a'.repeat(90)}` });
  try {
    const r = await f.run(f.handoff());
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /the run folder's name \(.*\) is too long, or holds a character that a spending limit cannot be recorded under\. Nothing was started and nothing was spent\./);
    assert.equal(existsSync(join(f.rd, 'side')), false);
  } finally { f.srv.close(); }
});

test('DIGEST of a paid seat: exit 21 with the screen in side/digest-<h8>; `none` is refused; a typed total below the call\'s worst case stops BEFORE any request with ONE stop file in the gate folder, the floor is the run folder\'s unsettled $0.50, and the next screen is a raise; a consumed limit continues with no second screen', async () => {
  const f = await fixture();
  try {
    const digest = (...x) => ['digest', '--run', f.rd, '--provider', 'openrouter', '--model', 'anthropic/claude-opus-5', ...x];
    const none = await f.run(digest('--max-usd', 'none'));
    assert.equal(none.status, 2); assert.equal(none.stderr.trim(), '--max-usd none is not offered: a limit is a number a person types. Nothing was started.');
    assert.equal(existsSync(join(f.rd, 'side')), false);
    appendFileSync(join(f.rd, 'spend-reservations.jsonl'), `${JSON.stringify({ schema: 'spend-reservations/1', event: 'reserved', id: 'r900', label: 'criteria', seat: 'p/m', usd: 0.5, at: '2026-10-14T10:00:00.000Z' })}\n`);
    const first = await f.run(digest());
    assert.equal(first.status, 21, first.stdout + first.stderr);
    assert.match(first.stderr, /This digest waits for a spending limit that you type\./);
    const d = f.gateDir('digest'); assert.ok(d);
    const screen = readFileSync(join(d, 'cap-screen-1.md'), 'utf8');
    assert.match(screen, /^Run this digest\?/); assert.match(screen, /Already counted for this folder: \$0\.5000\./);
    assert.equal(readGateAnswer(d, 'g1').gate.cap.operation, 'side:digest');
    typeCap(d, '0.51');
    const stop = await f.run(printedArgs(first.stderr));
    assert.equal(stop.status, 4, stop.stdout + stop.stderr); assert.equal(f.count(), 0);
    const st = JSON.parse(readFileSync(join(d, 'STOPPED-budget.json'), 'utf8'));
    assert.equal(st.capUsd, 0.51); assert.ok(Math.abs(st.spentUsd - 0.5) < 1e-9, `the armed earlier spend ${st.spentUsd} equals the floor 0.5`);
    assert.match(stop.stderr, /Run the same command again: it asks for a new total above \$0\.5000 \(the smallest that gets past this stop is \$[0-9.]+\):/);
    assert.equal(existsSync(join(f.rd, 'STOPPED-budget.json')), false, 'no stop file in the run folder itself');
    const next = await f.run(printedArgs(stop.stderr));
    assert.equal(next.status, 21); assert.match(readFileSync(join(d, 'cap-screen-2.md'), 'utf8'), /stopped at its limit of \$0\.5100/);
    // consumed, then dead: a limit consumed through the real consumeRunCap continues with no second screen (it stops at the call: the total is too small)
    const gate = typeCap(d, '0.52');
    consumeRunCap(d, gate, { runId: `${ID}:${d.split(/[\\/]/).pop()}`, scopeSha256: readGateAnswer(d, gate).gate.cap.scope_sha256 });
    const before = ledger(d).length;
    const cont = await f.run(printedArgs(next.stderr));
    assert.equal(cont.status, 4, cont.stdout + cont.stderr); assert.equal(f.count(), 0);
    assert.equal(ledger(d).length, before, 'no second screen, no second consumption');
  } finally { f.srv.close(); }
});

test('DIGEST with an unpriced seat is refused with exit 5 even with `none` (no gate folder)', async () => {
  const f = await fixture();
  try {
    const r = await f.run(['digest', '--run', f.rd, '--provider', 'openrouter', '--model', 'vendor/not-in-the-table', '--max-usd', 'none']);
    assert.equal(r.status, 5, r.stdout + r.stderr); assert.equal(existsSync(join(f.rd, 'side')), false);
  } finally { f.srv.close(); }
});
