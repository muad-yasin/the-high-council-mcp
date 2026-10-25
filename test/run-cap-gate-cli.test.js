// The terminal channel of the `run_cap` gate (0.8.3 M6 typed cap T3b; typed-cap gate page section 4.1; 14 Oct 2026): `council gate answer <run> <gate>` on a limit gate shows the screen, then asks for a TYPED number - there is no
// y/N after it, a bare "y" is refused (by answerGate, not by this file), and the text it prints says nothing about prices, seats or sending, because none of that is true of a limit. Declining keeps its y/N. $0, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { requestGate, readGateAnswer, consumeRunCap } from '../src/gate.js';
import { gateCommand, answerAtTerminal } from '../src/gate-cli.js';
import { LEDGER_FILE } from '../src/gate-ledger.js';

const T0 = Date.parse('2026-10-14T12:00:00.000Z');
const now = () => T0 + 1000;
const SCREEN = 'The screen: estimate, maximum, your limit (blank).\n';
const scope = createHash('sha256').update('scope-1').digest('hex');

async function fresh() {
  const base = mkdtempSync(join(tmpdir(), 'run-cap-cli-')); const d = join(base, 'run-1'); mkdirSync(d);
  writeFileSync(join(d, 'cap-screen.md'), SCREEN);
  const r = requestGate(d, { kind: 'run_cap', textPath: 'cap-screen.md', cap: { operation: 'start', run_id: 'run-1', scope_sha256: scope, ceiling_usd: 10, ceiling_source: 'COUNCIL_MAX_USD_LIMIT' }, expiresAt: T0 + 30 * 60_000 }, { now: () => T0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  return { base, d, id: r.gate.id };
}
function terminal(typed) {
  const stdin = new PassThrough(); stdin.isTTY = true; stdin.setRawMode = () => {};
  const stdout = new PassThrough(); stdout.isTTY = true; const stderr = new PassThrough();
  let shown = ''; let errs = '';
  stdout.on('data', x => { shown += x; }); stderr.on('data', x => { errs += x; });
  for (const t of typed) stdin.write(`${t}\n`);
  return { stdin, stdout, stderr, shown: () => shown, errs: () => errs };
}
const ledger = d => readFileSync(join(d, LEDGER_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const answer = (g, io, extra = []) => gateCommand(['answer', basename(g.d), g.id, ...extra], { work: g.base, ...io, now });

test('a typed limit is the answer: the screen is shown, the prompt asks for dollars, no y/N follows, the figure is recorded as a terminal answer', async () => {
  const g = await fresh(); const io = terminal(['7.50']);
  const code = await answer(g, io);
  assert.equal(code, 0, `exit ${code}: ${io.errs()} | ${io.shown().slice(-300)}`);
  assert.match(io.shown(), /The screen: estimate, maximum, your limit/);
  assert.match(io.shown(), /Type your limit in US dollars, then Enter:/);
  assert.doesNotMatch(io.shown(), /\[y\/N\]/, `no y/N after the number: ${io.shown().slice(-300)}`);
  assert.match(io.shown(), /gate g1: approved \(ledger line 2\); limit \$7\.5/);
  const a = ledger(g.d).find(l => l.event === 'gate_answered');
  assert.deepEqual([a.channel, a.tty, a.decision, a.cap_usd, a.cap_micro_usd], ['cli', true, 'approved', '7.5', 7_500_000], JSON.stringify(a));
  assert.equal(readGateAnswer(g.d, g.id, { now }).status, 'approved');
});

test('a bare "y", "yes", a unit, a comma or an amount above the ceiling is refused: exit 1, nothing written, the gate stays pending', async () => {
  for (const typed of ['y', 'yes', '$5', '7,5', '11', '0', 'none', '']) {
    const g = await fresh(); const io = terminal([typed]);
    const code = await answer(g, io);
    assert.equal(code, 1, `typed ${JSON.stringify(typed)}: exit ${code}; ${io.errs()} | ${io.shown().slice(-200)}`);
    assert.match(io.errs(), /gate g1: refused \(cap_/, `typed ${JSON.stringify(typed)}: ${io.errs()}`);
    assert.equal(ledger(g.d).length, 1, `typed ${JSON.stringify(typed)}: only the request line`);
    assert.equal(readGateAnswer(g.d, g.id, { now }).status, 'pending');
  }
});

test('without a terminal nothing is asked and nothing is written (exit 2); declining asks y/N, says no limit will be recorded, and writes no figure', async () => {
  const g = await fresh();
  const plain = new PassThrough(); const out = new PassThrough(); const errp = new PassThrough(); let e = ''; errp.on('data', x => { e += x; });
  assert.equal(await gateCommand(['answer', basename(g.d), g.id], { work: g.base, stdin: plain, stdout: out, stderr: errp, now }), 2, e);
  assert.equal(ledger(g.d).length, 1);
  const io = terminal(['y']);
  assert.equal(await answer(g, io, ['--decline']), 0, `${io.errs()} | ${io.shown().slice(-300)}`);
  assert.match(io.shown(), /Decline gate g1: no limit will be recorded and nothing will be started\. Decline\? \[y\/N\]/);
  const a = ledger(g.d).find(l => l.event === 'gate_answered');
  assert.deepEqual([a.decision, Object.hasOwn(a, 'cap_usd'), Object.hasOwn(a, 'cap_micro_usd')], ['declined', false, false], JSON.stringify(a));
});

test('what the terminal prints about a limit gate says nothing false: no price, seats, masks or "sending"; `gate show` of a used limit says "already used"', async () => {
  const g = await fresh(); const io = terminal(['7']);
  await answer(g, io);
  const text = io.shown();
  for (const bad of [/price: up to/, /seats:/, /masked before sending/, /sending exactly this text/, /already sent/]) assert.doesNotMatch(text, bad, `the output says ${bad}: ${text.slice(0, 400)}`);
  assert.match(text, /answering records the limit you type for this run; typing it sends nothing to any model and spends nothing/);
  const used = consumeRunCap(g.d, g.id, { runId: 'run-1', scopeSha256: scope }, { now });
  assert.equal(used.ok, true, JSON.stringify(used));
  const show = terminal([]);
  assert.equal(await gateCommand(['show', basename(g.d), g.id], { work: g.base, ...show, now }), 0, show.errs());
  assert.match(show.shown(), /status: approved; already used/, show.shown().slice(0, 300));
});

test('at the START of a run the facts line says the run begins and spends; `council gate answer` keeps "sends nothing" (E 154 vs E 157 g): never both, whichever way it is asked', async () => {
  const start = await fresh(); const a = terminal(['7.50']);
  assert.equal(await answerAtTerminal(start.d, start.id, { startsRun: true, stdin: a.stdin, stdout: a.stdout, stderr: a.stderr, now }), 0, a.errs());
  assert.match(a.shown(), /answering records the limit you type for this run; if the start's other checks pass, this run then starts and spends against it/);
  assert.doesNotMatch(a.shown(), /sends nothing to any model/, 'a start must not say that typing spends nothing');
  const apart = await fresh(); const b = terminal(['7.50']);
  assert.equal(await answerAtTerminal(apart.d, apart.id, { stdin: b.stdin, stdout: b.stdout, stderr: b.stderr, now }), 0, b.errs());
  assert.match(b.shown(), /typing it sends nothing to any model and spends nothing/);
  assert.doesNotMatch(b.shown(), /then starts and spends against it/);
});
