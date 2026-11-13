// 0.8.4 (the ladder unit; C&C 10 Nov, item 3 of the per-limit follow-up): ONE command-line row of the resume-after-a-change screen on the PAID path with TWO limits (COUNCIL_SPEND_CAPS on). RC-5 covers one limit on the paid path and RC-1/RC-2 the two-limit figures
// by hand; this runs the real command: a run armed under an anthropic and an openrouter limit stops at the openrouter limit after its anthropic steps were paid, the chain file is changed, and the resume writes the amend screen(s). Each limit's screen names its
// own limit in the stale-steps sentence ("... bill(s) through the <limit> limit ..." or "None of these bills through the <limit> limit"), never the other's. Offline, $0: mock seats that bill (fixture test/fixtures/caps/mock-bills-two-caps.json).
// WRITTEN WITHOUT A RUN (no tests on the laptop): the first run on the box decides. The fixture and the stop are those of test/caps-resume.test.js (stoppedAtOpenrouter).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readGateAnswer, answerGate } from '../src/gate.js';
import { LEDGER_FILE } from '../src/gate-ledger.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const BOTH = { COUNCIL_SPEND_CAPS: 'openrouter,anthropic' };
const read = (...p) => JSON.parse(readFileSync(join(...p), 'utf8'));
const TWO_CAPS = read(root, 'test', 'fixtures', 'caps', 'mock-bills-two-caps.json');
const ledger = d => readFileSync(join(d, LEDGER_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const gatesOf = d => ledger(d).filter(l => l.event === 'gate_requested').map(l => l.gate);
const capOf = (d, id) => readGateAnswer(d, id).gate.cap;
const typeLimit = (d, id, total) => { const g = readGateAnswer(d, id).gate; const a = answerGate(d, id, { channel: 'cli', shownSha256: g.sha256, decision: 'approved', actor: 'tester', tty: true, typedCap: total }); assert.equal(a.ok, true, JSON.stringify(a)); };

test('RC-6 (the paid path with two limits, the real command): after the chain file changed, the amend screens of a run armed under two limits say, each for its own limit, how many of the earlier steps bill through it; the two sentences differ and neither names the other limit', () => {
  const work = mkdtempSync(join(tmpdir(), 'thc-rc6-'));
  mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'chains'));
  writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  writeFileSync(join(work, 'chains', `${TWO_CAPS.name}.json`), JSON.stringify(TWO_CAPS, null, 2));
  const run = args => { const r = spawnSync(process.execPath, [cli, ...args], { cwd: work, env: { PATH: process.env.PATH, HOME: work, ...BOTH }, encoding: 'utf8', timeout: 120_000 }); return { code: r.status, out: `${r.stdout}${r.stderr}` }; };
  const id = '2026-11-10T08-10-00-000Z'; const dir = join(work, 'runs', id);
  const s = run(['--task', 'tasks/x.md', '--chain', TWO_CAPS.name, '--run-id', id]);
  assert.equal(s.code, 21, s.out);
  for (const cap of ['anthropic', 'openrouter']) {
    const gate = gatesOf(dir).find(g => capOf(dir, g).cap_name === cap && capOf(dir, g).operation === 'start');
    typeLimit(dir, gate, cap === 'anthropic' ? '1000' : '0.01');   // openrouter's limit is too small for the first critique: the run stops there after its anthropic steps were paid
  }
  const first = run(['--resume', dir]);
  assert.equal(first.code, 4, `the premise: stopped at the openrouter limit (${first.out})`);
  const anthropicPaid = readdirSync(dir).filter(f => f.endsWith('.usage.json')).map(f => read(dir, f)).filter(u => u.capName === 'anthropic' && u.usd > 0);
  assert.ok(anthropicPaid.length >= 1, 'the premise: at least one step billed through the anthropic limit');
  // the chain changes: the builder\'s reply allowance, so the earlier steps\' inputs differ
  const edited = { ...TWO_CAPS, seats: { ...TWO_CAPS.seats, builder: { ...TWO_CAPS.seats.builder, maxTokens: (TWO_CAPS.seats.builder.maxTokens ?? 4000) + 100 } } };
  writeFileSync(join(work, 'chains', `${TWO_CAPS.name}.json`), JSON.stringify(edited, null, 2));
  const startScreens = new Set(readdirSync(dir).filter(n => /^cap-screen-\d+\.md$/.test(n)));   // the two the START wrote carry no stale-steps sentence: only the screens this resume adds are read
  const again = run(['--resume', dir]);
  assert.equal(again.code, 21, again.out);
  const screens = readdirSync(dir).filter(n => /^cap-screen-\d+\.md$/.test(n) && !startScreens.has(n)).sort().map(n => readFileSync(join(dir, n), 'utf8'));
  assert.ok(screens.length >= 1, 'the amend screen(s) are on disk');
  const all = screens.join('\n=====\n');
  assert.match(all, /(bills?|None of these bills) through the anthropic limit/, 'the anthropic limit has its own sentence');
  assert.match(all, /(bills?|None of these bills) through the openrouter limit/, 'the openrouter limit has its own sentence');
  for (const text of screens) {
    const names = ['anthropic', 'openrouter'].filter(c => new RegExp(`through the ${c} limit`).test(text));
    assert.equal(names.length, 1, `each screen names ONE limit in that sentence, not both:\n${text.slice(0, 600)}`);
  }
});
