// T9 (typed cap; Review/Build_0.8.3/m6-closing/T9_Gate_Note.md): the CLI reads COUNCIL_MAX_USD_LIMIT as a CEILING the way the MCP server does.
//   (a) (b) labelled PINS of behaviour that exists since T3/T4a: a paid start / a paid post-run call shows the ceiling on its screen, refuses a typed amount above it and arms the typed total below it.
//   (c) F1: an unreadable limit is refused BEFORE any folder (it used to be refused inside the gate, after run.json or the side / gate folder existed): main start, rematch, replay, handoff, digest.
//   (d) F2: a project .env can only FILL an unset limit, never RAISE or REMOVE an operator's value (src/mcp/usd-limit.js limitSource), and a host placeholder gets the CLI's own sentence.
// Offline, $0: the paid seats point at a local stub that COUNTS requests (none are sent before a limit is typed). The original run is a finished MOCK run whose chain file is then swapped for paid seats.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { answerGate, readGateAnswer } from '../src/gate.js';
import { typeCap } from './helpers/typed-cap.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const ID = '2026-10-14T12-00-00-000Z';
const NEW_ID = '2026-10-14T13-00-00-000Z';
const DATE = '2026-10-14';
const SENTENCE = 'COUNCIL_MAX_USD_LIMIT is set but is not a positive number of dollars, so no limit can be checked against it. Nothing was started.';
const PAID = port => ({ provider: 'openrouter', model: 'anthropic/claude-opus-5', originalProvider: 'anthropic', maxTokens: 500, baseUrl: `http://127.0.0.1:${port}` });

async function fixture() {
  let requests = 0;
  const srv = http.createServer((req, res) => { requests += 1; req.resume(); res.statusCode = 500; res.end('{"error":"stub"}'); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const work = mkdtempSync(join(tmpdir(), 'thc-cli-usd-limit-')); mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'chains'));
  writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  writeFileSync(join(work, 'chains', 'c.json'), JSON.stringify({ ...base, name: 'c' }));
  const env = { PATH: process.env.PATH, HOME: work, OPENROUTER_API_KEY: `sk-or-v1-${'e'.repeat(40)}`, COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' };
  // `extraEnv` is merged per call; a value of undefined removes the name
  const run = (args, extraEnv = {}) => new Promise(resolve => {
    const e = { ...env, ...extraEnv }; for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
    const child = spawn(process.execPath, [cli, ...args], { cwd: work, env: e, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.on('exit', status => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
  const first = await run(['--chain', 'c', '--task', 'tasks/x.md', '--run-id', ID]);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  // the chain file now seats paid builder / handoff / criteria seats on the stub (the finished original stays a mock run)
  const seats = { ...base.seats, criteria: PAID(srv.address().port), builder: PAID(srv.address().port), handoff: PAID(srv.address().port) };
  writeFileSync(join(work, 'chains', 'c.json'), JSON.stringify({ ...base, name: 'c', seats }));
  const tree = () => [...readdirSync(join(work, 'runs')).sort(), ...(existsSync(join(work, 'runs', ID, 'side')) ? readdirSync(join(work, 'runs', ID, 'side')).map(n => `side/${n}`) : [])];
  return { srv, work, run, count: () => requests, runDir: join(work, 'runs', ID), newDir: join(work, 'runs', NEW_ID), tree };
}
const screenOf = dir => readFileSync(join(dir, readdirSync(dir).filter(n => /^cap-screen-\d+\.md$/.test(n)).sort().at(-1)), 'utf8');

test('PIN (a): a paid start under COUNCIL_MAX_USD_LIMIT=5 shows the ceiling on its screen, refuses a typed amount above it with the ceiling named, and arms a typed 4', async () => {
  const f = await fixture(); const env = { COUNCIL_MAX_USD_LIMIT: '5' };
  try {
    const r = await f.run(['--chain', 'c', '--task', 'tasks/x.md', '--run-id', NEW_ID], env);
    assert.equal(r.status, 21, r.stdout + r.stderr);
    assert.match(screenOf(f.newDir), /Ceiling in force: \$5\.00 \(set by COUNCIL_MAX_USD_LIMIT\)\. You cannot type more\./);
    const state = readGateAnswer(f.newDir, 'g1');
    const above = answerGate(f.newDir, 'g1', { channel: 'cli', shownSha256: state.gate.sha256, decision: 'approved', actor: 'test', tty: true, typedCap: '8' });
    assert.equal(above.ok, false); assert.match(JSON.stringify(above), /\$5\.00|COUNCIL_MAX_USD_LIMIT/, 'the refusal names the ceiling');
    assert.equal(typeCap(f.newDir, '4'), 'g1');
    const go = await f.run(['--resume', f.newDir], env);
    assert.notEqual(go.status, 21, go.stdout + go.stderr);
    assert.equal(JSON.parse(readFileSync(join(f.newDir, 'run.json'), 'utf8')).maxUsd, 4, 'the armed cap is the typed total');
  } finally { f.srv.close(); }
});

test('PIN (b): a paid handoff under COUNCIL_MAX_USD_LIMIT=1 shows the same ceiling line on its post-run screen (the ceiling is read on the post-run gate too)', async () => {
  const f = await fixture();
  try {
    const r = await f.run(['handoff', '--from-run', join('runs', ID)], { COUNCIL_MAX_USD_LIMIT: '1' });
    assert.equal(r.status, 21, r.stdout + r.stderr);
    const side = join(f.runDir, 'side'); const gate = join(side, readdirSync(side).find(n => n.startsWith('handoff-')));
    assert.match(screenOf(gate), /Ceiling in force: \$1\.00 \(set by COUNCIL_MAX_USD_LIMIT\)\. You cannot type more\./);
    assert.equal(f.count(), 0);
  } finally { f.srv.close(); }
});

test('RED (c) F1: an unreadable COUNCIL_MAX_USD_LIMIT is refused with ONE sentence BEFORE any folder, on every paid start (main, rematch, replay, handoff, digest); the failures leave no folder behind and no request is sent', async () => {
  const f = await fixture(); const env = { COUNCIL_MAX_USD_LIMIT: 'abc' };
  try {
    const before = f.tree();
    const commands = {
      main: ['--chain', 'c', '--task', 'tasks/x.md', '--run-id', NEW_ID],
      rematch: ['--rematch', join('runs', ID), '--rematch-seed', '7'],
      replay: ['--replay', join('runs', ID), '--replay-date', DATE],
      handoff: ['handoff', '--from-run', join('runs', ID)],
      digest: ['digest', '--run', f.runDir, '--provider', 'openrouter', '--model', 'anthropic/claude-opus-5'],
    };
    for (const [name, args] of Object.entries(commands)) {
      const r = await f.run(args, env);
      assert.equal(r.status, 2, `${name}: ${r.stdout}${r.stderr}`);
      assert.equal(r.stderr.trim(), SENTENCE, name);
      assert.deepEqual(f.tree(), before, `${name} left a folder behind a refusal that says nothing was started`);
    }
    assert.equal(f.count(), 0);
  } finally { f.srv.close(); }
});

test('RED (d) F2: a project .env can FILL an unset COUNCIL_MAX_USD_LIMIT but never RAISE or REMOVE an operator\'s value (whitespace-only, malformed or a number), and a host placeholder gets the CLI\'s own sentence', async () => {
  const f = await fixture();
  try {
    writeFileSync(join(f.work, '.env'), 'COUNCIL_MAX_USD_LIMIT=1000\n');
    const start = env => f.run(['--chain', 'c', '--task', 'tasks/x.md', '--run-id', NEW_ID], env);
    // an operator's whitespace-only value is not "absent": the file does not replace it, the start is refused
    const blank = await start({ COUNCIL_MAX_USD_LIMIT: '   ' });
    assert.equal(blank.status, 2, blank.stdout + blank.stderr); assert.equal(blank.stderr.trim(), SENTENCE);
    assert.equal(existsSync(f.newDir), false);
    // an operator's number wins over the file (the ceiling stays 3)
    const num = await start({ COUNCIL_MAX_USD_LIMIT: '3' });
    assert.equal(num.status, 21, num.stdout + num.stderr);
    assert.match(screenOf(f.newDir), /Ceiling in force: \$3\.00 \(set by COUNCIL_MAX_USD_LIMIT\)/);
    // a host placeholder: refused, in the CLI's words (the MCP sentence speaks of "the server did not start")
    writeFileSync(join(f.work, '.env'), '');
    const ph = await f.run(['--chain', 'c', '--task', 'tasks/x.md', '--run-id', '2026-10-14T14-00-00-000Z'], { COUNCIL_MAX_USD_LIMIT: '${user_config.max_usd}' });
    assert.equal(ph.status, 2, ph.stdout + ph.stderr);
    assert.equal(ph.stderr.trim(), 'COUNCIL_MAX_USD_LIMIT still holds a placeholder from a settings template that was never filled in, so no limit can be checked against it. Set it to a number of dollars, or unset it. Nothing was started.');
    // unset in the environment: the file FILLS it
    writeFileSync(join(f.work, '.env'), 'COUNCIL_MAX_USD_LIMIT=5\n');
    const fill = await f.run(['--chain', 'c', '--task', 'tasks/x.md', '--run-id', '2026-10-14T15-00-00-000Z'], { COUNCIL_MAX_USD_LIMIT: undefined });
    assert.equal(fill.status, 21, fill.stdout + fill.stderr);
    assert.match(screenOf(join(f.work, 'runs', '2026-10-14T15-00-00-000Z')), /Ceiling in force: \$5\.00 \(set by COUNCIL_MAX_USD_LIMIT\)/);
  } finally { f.srv.close(); }
});
