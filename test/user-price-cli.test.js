// The project's own price row through the CLI (0.8.3 user price row P2a; gate page UserPriceRow_Gate_Page.md sections 3, 8, 9). Offline, $0: the paid seat points at a local stub that COUNTS requests; none may arrive before a limit is typed.
// A model the shipped table lacks is refused (exit 5) until the project's pricing.user.json prices it; the screen then shows the row's FIGURES; a row edited after the screen is a changed screen (a new gate, or a refusal once the limit is consumed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { readGateAnswer } from '../src/gate.js';
import { LEDGER_FILE } from '../src/gate-ledger.js';
import { typeCap } from './helpers/typed-cap.js';
import { malformedProviderKeys } from './helpers/no-real-keys.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const ID = '2026-10-14T12-00-00-000Z';
const MODEL = 'vendor/not-in-the-price-table';
const ROW = file => writeFileSync(file, JSON.stringify({ [`openrouter/${MODEL}`]: { in: 1, out: 4 } }));

async function fixture() {
  let requests = 0;
  const srv = http.createServer((req, res) => { requests += 1; req.resume(); res.statusCode = 500; res.end('{}'); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const work = mkdtempSync(join(tmpdir(), 'thc-userprice-cli-')); mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'chains'));
  writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  writeFileSync(join(work, 'chains', 'u.json'), JSON.stringify({ ...base, name: 'u', seats: { ...base.seats, criteria: { provider: 'openrouter', model: MODEL, maxTokens: 500, baseUrl: `http://127.0.0.1:${srv.address().port}` } } }));
  const env = { PATH: process.env.PATH, HOME: work, ...malformedProviderKeys(), OPENROUTER_API_KEY: `sk-or-v1-${'e'.repeat(40)}`, COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' };
  const run = (args, until = null) => new Promise(resolve => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    const poll = until ? setInterval(() => { if (requests >= until) child.kill('SIGKILL'); }, 50) : null;
    child.on('exit', status => { clearTimeout(timer); if (poll) clearInterval(poll); resolve({ status, stdout, stderr }); });
  });
  return { srv, work, run, count: () => requests, runDir: join(work, 'runs', ID), file: join(work, 'pricing.user.json') };
}
const events = d => readFileSync(join(d, LEDGER_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).event);
const START = ['--chain', 'u', '--task', 'tasks/x.md', '--run-id', ID];

test('a model the shipped table lacks is refused (exit 5, no folder) until pricing.user.json prices it; the screen then shows the row\'s figures and the file name; zero requests', async () => {
  const f = await fixture();
  try {
    const refused = await f.run(START);
    assert.equal(refused.status, 5, refused.stdout + refused.stderr); assert.equal(existsSync(f.runDir), false);
    ROW(f.file);
    const waits = await f.run(START);
    assert.equal(waits.status, 21, waits.stdout + waits.stderr);
    const screen = readFileSync(join(f.runDir, 'cap-screen-1.md'), 'utf8');
    assert.match(screen, /Priced from pricing\.user\.json in your project folder: openrouter\/vendor\/not-in-the-price-table in 1 \/ out 4 per million tokens/);
    assert.equal(f.count(), 0);
    const dry = await f.run(['--chain', 'u', '--dry-run']);
    assert.match(dry.stdout, /openrouter\/vendor\/not-in-the-price-table: from pricing\.user\.json in your project folder: in 1 \/ out 4 per million tokens/);
  } finally { f.srv.close(); }
});

test('a row edited AFTER the screen is a changed screen: an answered-but-unused limit is NOT consumed (a new gate asks again), and once consumed the next resume refuses', async () => {
  const f = await fixture();
  try {
    ROW(f.file);
    assert.equal((await f.run(START)).status, 21);
    assert.equal(typeCap(f.runDir, '5'), 'g1');
    writeFileSync(f.file, JSON.stringify({ [`openrouter/${MODEL}`]: { in: 0.01, out: 0.04 } }));   // 100x lower than the screen the person read
    const again = await f.run(['--resume', f.runDir]);
    assert.equal(again.status, 21, again.stdout + again.stderr);
    assert.deepEqual(events(f.runDir).filter(e => e === 'cap_consumed'), [], 'the limit typed for the old figures was not used');
    assert.equal(readGateAnswer(f.runDir, 'g2').status, 'pending', 'a new screen with the new figures');
    assert.match(readFileSync(join(f.runDir, 'cap-screen-2.md'), 'utf8'), /in 0\.01 \/ out 0\.04/);
    assert.equal(typeCap(f.runDir, '5'), 'g2');
    await f.run(['--resume', f.runDir], 1);
    assert.equal(events(f.runDir).filter(e => e === 'cap_consumed').length, 1);
    ROW(f.file);                                                                                    // changed again after the consume
    const before = f.count();
    const asked = await f.run(['--resume', f.runDir]);                                              // T4b2: a NEW question (an amend screen that names the price row), not the end of the run
    assert.equal(asked.status, 21, asked.stdout + asked.stderr);
    const names = readdirSync(f.runDir).filter(n => /^cap-screen-\d+\.md$/.test(n)).sort();
    assert.match(readFileSync(join(f.runDir, names.at(-1)), 'utf8'), /Changed since the limit for this run was typed: a price row of the project's pricing\.user\.json\./);
    assert.equal(f.count(), before);
  } finally { f.srv.close(); }
});

test('a pricing.user.json that cannot be read in full: dry run and start refuse with the file named (exit 2, nothing started); `council doctor` reports it and carries on', async () => {
  const f = await fixture();
  try {
    writeFileSync(f.file, JSON.stringify({ [`openrouter/${MODEL}`]: { in: 0, out: 4 } }));
    const dry = await f.run(['--chain', 'u', '--dry-run']);
    assert.equal(dry.status, 2, dry.stdout + dry.stderr); assert.match(dry.stderr, /pricing\.user\.json: openrouter\/vendor\/not-in-the-price-table: .*above 0.*not used at all/);
    const start = await f.run(START);
    assert.equal(start.status, 2); assert.equal(existsSync(f.runDir), false); assert.equal(f.count(), 0);
    const doctor = await f.run(['doctor']);
    assert.equal(doctor.status, 0, doctor.stdout + doctor.stderr); assert.match(doctor.stdout, /WARNING: pricing\.user\.json is not used at all: openrouter\/vendor\/not-in-the-price-table: .*above 0/); assert.doesNotMatch(doctor.stdout, /nothing was started/, 'doctor starts nothing, so it must not say so');
  } finally { f.srv.close(); }
});

test('a row ADDED for a SHIPPED model after the screen is a changed screen even when the merge ignores it (below the shipped price): the answered limit is not consumed, a new gate asks again', async () => {
  const f = await fixture();
  try {
    const shipped = JSON.parse(readFileSync(join(f.work, 'chains', 'u.json'), 'utf8'));
    shipped.seats.criteria.model = 'anthropic/claude-opus-5';   // a model the shipped table prices
    writeFileSync(join(f.work, 'chains', 'u.json'), JSON.stringify(shipped));
    assert.equal((await f.run(START)).status, 21);              // no user file: the screen shows no user-priced seat
    assert.doesNotMatch(readFileSync(join(f.runDir, 'cap-screen-1.md'), 'utf8'), /pricing\.user\.json/);
    assert.equal(typeCap(f.runDir, '5'), 'g1');
    writeFileSync(f.file, JSON.stringify({ 'openrouter/anthropic/claude-opus-5': { in: 0.001, out: 0.001 } }));   // BELOW the shipped price: the effective figures do not change
    const again = await f.run(['--resume', f.runDir]);
    assert.equal(again.status, 21, again.stdout + again.stderr);
    assert.equal(events(f.runDir).filter(e => e === 'cap_consumed').length, 0, 'the limit typed before the file existed was not used');
    assert.equal(readGateAnswer(f.runDir, 'g2').status, 'pending');
    assert.doesNotMatch(readFileSync(join(f.runDir, 'cap-screen-2.md'), 'utf8'), /Priced from pricing\.user\.json/, 'the ignored row is not claimed as the price of this seat');
    assert.equal(f.count(), 0);
  } finally { f.srv.close(); }
});

test('every command that PRICES refuses an unreadable pricing.user.json before it prices (a raised row must not be silently lost): rematch, replay, handoff, digest, contract draft, tree start', async () => {
  const f = await fixture();
  try {
    writeFileSync(f.file, JSON.stringify({ [`openrouter/${MODEL}`]: { in: 0, out: 4 } }));
    const calls = [['--rematch', 'runs/none'], ['replay', '--run', 'runs/none'], ['--replay', 'runs/none'], ['handoff', '--from-run', 'runs/none'], ['digest', '--provider', 'openrouter'], ['contract', 'draft', '--from-run', 'runs/none'], ['tree', 'start']];
    for (const args of calls) {
      const r = await f.run(args);
      assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /pricing\.user\.json: openrouter\/vendor\/not-in-the-price-table: .*not used at all/, `${args.join(' ')} names the price file`);
    }
    assert.equal(f.count(), 0);
  } finally { f.srv.close(); }
});
