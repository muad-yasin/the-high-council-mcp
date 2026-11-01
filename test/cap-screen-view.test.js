// The limit screen a person reads (0.8.4 DUALCAP milestone 2; Muad on the probe's screen: "cluttered with text ... no clear and easy to see indication what the
// number is for"; C&C's rulings of 1 Nov 2026). Under the per-provider caps each question names its cap in its first words and shows that cap's own estimate, by
// the dry run's count; the two prompts differ in their first word. In both modes the terminal no longer shows the gate's file/bytes/sha256 header, its expiry or the
// ledger line (they stay in the record); the fences around the screen stay, with a short label, for a limit gate; every other gate kind keeps its framing. The
// switch-off screen's reviewed sentences are unchanged. $0, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { requestGate } from '../src/gate.js';
import { gateCommand } from '../src/gate-cli.js';
import { buildCapScreen, ENFORCEMENT_SENTENCES, COMPLETION_SENTENCE } from '../src/cap-screen.js';
import { estimateChainRows, formatUsd } from '../src/cost.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TWO_CAPS = JSON.parse(readFileSync(join(root, 'test', 'fixtures', 'caps', 'mock-bills-two-caps.json'), 'utf8'));
const subject = { chain: 'probe', task: 'tasks/x.md' };
const of = ['anthropic', 'openrouter'];

test('V1 under the caps each screen opens with its cap in capitals ("ANTHROPIC spending limit", "1 of 2"), shows THAT cap\'s estimate by the dry run\'s count with its worst case marked "not a ceiling", and no whole-run figure; the reviewed guardrail sentences stay', () => {
  const a = buildCapScreen({ kind: 'run', subject, estimate: { usd: 0.06 }, maximum: { usd: 0.97 }, cap: { id: 'anthropic', of } }).text;
  const o = buildCapScreen({ kind: 'run', subject, estimate: { usd: 14.37 }, maximum: { usd: 40 }, cap: { id: 'openrouter', of } }).text;
  const [a1, a2] = a.split('\n');
  assert.match(a1, /^ANTHROPIC spending limit \(cap 1 of 2: anthropic, openrouter\)$/);
  assert.match(o.split('\n')[0], /^OPENROUTER spending limit \(cap 2 of 2: anthropic, openrouter\)$/);
  assert.match(a2, /Chain: probe\. Task: tasks\/x\.md\./);
  assert.ok(a.includes(`Calls through anthropic, by the dry run's count: about ${formatUsd(0.06)}; worst case ${formatUsd(0.97)} (not a ceiling).`), `the figures through the one shared formatter: ${a}`);
  assert.doesNotMatch(a, /every provider together|Most it could cost to finish/);
  assert.ok(a.includes(ENFORCEMENT_SENTENCES.weak) && a.includes(COMPLETION_SENTENCE), 'the reviewed sentences stay as approved');
  // every kind of a per-cap screen opens the same way (a raise of the openrouter cap here)
  const raise = buildCapScreen({ kind: 'raise', subject, cap: { id: 'openrouter', of }, history: { previousCapUsd: 0.01, spentUsd: 0, floorUsd: 0 } }).text;
  assert.match(raise.split('\n')[0], /^OPENROUTER spending limit \(cap 2 of 2: anthropic, openrouter\)$/);
  assert.match(raise.split('\n')[1], /^Continue this run\?/);
  assert.match(buildCapScreen({ kind: 'run', subject, estimate: { usd: 1 }, maximum: { usd: 2 }, priceAsOf: '2026-10-26', cap: { id: 'anthropic', of } }).text, /Calls through anthropic, by the dry run's count at the prices of 2026-10-26: about /, 'the price date stays under the caps');
  const none = buildCapScreen({ kind: 'run', subject, estimate: { usd: 0 }, maximum: { usd: 0 }, cap: { id: 'openrouter', of } }).text;
  assert.match(none, /No priced call goes through openrouter, by the dry run's count\./);
});

test('V2 with the switch off the screen is the reviewed one: the whole-run estimate and maximum, no cap line', () => {
  const t = buildCapScreen({ kind: 'run', subject, estimate: { usd: 3 }, maximum: { usd: 9 } }).text;
  assert.match(t, /^Start this run\? Chain: probe\. Task: tasks\/x\.md\.$/m);
  assert.match(t, /Estimate: about \$3\.00 for this run\./);
  assert.match(t, /Most it could cost to finish, by the dry run's count: \$9\.00 \(not a ceiling: see below\)\./);
  assert.doesNotMatch(t, /spending limit \(cap/);
});

test('V3 the dry run\'s rows carry the account each call bills through when asked ({ accounts: true }): a mockBills seat its account, a seat that bills none no field; without the option the row shape is unchanged', () => {
  const rows = estimateChainRows(TWO_CAPS, { accounts: true });
  const acc = Object.fromEntries(rows.map(r => [r.label, r.account ?? null]));
  assert.equal(acc.criteria, null);
  assert.equal(acc.build, 'anthropic');
  assert.ok(Object.entries(acc).some(([l, v]) => /^critique-/.test(l) && v === 'openrouter'), JSON.stringify(acc));
  assert.equal(estimateChainRows(TWO_CAPS).some(r => Object.hasOwn(r, 'account')), false, 'the default rows are unchanged');
});

// The terminal: `council gate answer` on a limit gate (the same printing the start's own prompts use).
const T0 = Date.parse('2026-11-01T12:00:00.000Z');
const now = () => T0 + 1000;
const scope = createHash('sha256').update('scope-1').digest('hex');
function fresh({ kind = 'run_cap', capName = null } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'cap-view-')); const d = join(base, 'run-1'); mkdirSync(d);
  writeFileSync(join(d, 'screen.md'), 'THE SCREEN TEXT\n');
  const req = kind === 'run_cap'
    ? { kind, textPath: 'screen.md', cap: { operation: 'start', run_id: 'run-1', scope_sha256: scope, ceiling_usd: null, ceiling_source: null, ...(capName ? { cap_name: capName } : {}) }, expiresAt: T0 + 3_600_000 }
    : { kind, textPath: 'screen.md', expiresAt: T0 + 3_600_000 };
  const r = requestGate(d, req, { now: () => T0 });
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
const answer = (g, io) => gateCommand(['answer', basename(g.d), g.id], { work: g.base, ...io, now });

test('V4 a limit gate of ONE cap at the terminal: no file/bytes/sha256 header, no expiry, no ledger line; the screen inside short fences; the prompt opens with the cap ("ANTHROPIC limit in US dollars: "); the answer reads "Limit recorded: $7.5"', async () => {
  const g = fresh({ capName: 'anthropic' }); const io = terminal(['7.50']);
  assert.equal(await answer(g, io), 0, io.errs());
  const out = io.shown();
  assert.match(out, /THE SCREEN TEXT/);
  assert.doesNotMatch(out, /sha256|expires:|ledger line|\d+ bytes/, out);
  assert.match(out, /-{5,} screen -{5,}[\s\S]*THE SCREEN TEXT[\s\S]*-{5,} end of screen -{5,}/);
  assert.match(out, /ANTHROPIC limit in US dollars, then Enter: /);
  assert.match(out, /Limit recorded: \$7\.5/);
});

test('V5 a limit gate with no cap (the switch off) loses the same three lines; its prompt stays the reviewed one', async () => {
  const g = fresh(); const io = terminal(['7.50']);
  assert.equal(await answer(g, io), 0, io.errs());
  const out = io.shown();
  assert.doesNotMatch(out, /sha256|expires:|ledger line|\d+ bytes/, out);
  assert.match(out, /Type your limit in US dollars, then Enter: /);
  assert.match(out, /Limit recorded: \$7\.5/);
});

test('V7 declining a limit gate at the terminal shows no ledger line: "Declined: no limit was recorded."', async () => {
  const g = fresh({ capName: 'openrouter' }); const io = terminal(['y']);
  assert.equal(await gateCommand(['answer', basename(g.d), g.id, '--decline'], { work: g.base, ...io, now }), 0, io.errs());
  assert.doesNotMatch(io.shown(), /ledger line/, io.shown());
  assert.match(io.shown(), /Declined: no limit was recorded\./);
});

test('V6 every other gate kind keeps its framing: the header with sha256, the expiry, and the long fence label', async () => {
  const g = fresh({ kind: 'contract_lock' }); const io = terminal(['n']);
  await answer(g, io);
  const out = io.shown();
  assert.match(out, /sha256 [0-9a-f]{64}/);
  assert.match(out, /expires: /);
  assert.match(out, /the exact text \(begin\)/);
});
