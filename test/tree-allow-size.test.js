// ROADMAP 77 / Muad's two-way refusal (20 Okt 2026; C&C thcmcp-6d: defaults accepted, admission at the raised price). When a new root plan's input is over the tree's allowance, `tree decide` offers BOTH ways on: a shorter decision / --fresh, or
// --allow-size <bytes>, which prices THIS new root plan at the raised size, shows the old and the new price on the gate screen, records the raise on the decision (allowanceBytes) and registers the plan under it. A session never raises it. All words A-DRAFT.
// Rows: AS-1 the refusal names both ways (nothing recorded); AS-2 the raise: screen, record, approval figures, registration over the old limit, children keep the tree's number; AS-3 bad values and the wrong forms are refused in words;
// AS-4 the table refuses a raise from the session or on a decision that does not re-plan the root; AS-5 a refusal of a chosen recommendation says the advice was paid for.
// AS-8 the root re-plan screen prices cheapest, expected and upper estimate for the same input.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { driveToDepthTwoReplan } from './helpers/depth-two-replan.js';
import { rootBundle } from '../src/tree-root-replan.js';
import { bundleAllowanceBytesOf, allowanceOfDecision } from '../src/tree-budget.js';
import { readTreeRecord } from '../src/tree-record.js';
import { chooseForm } from '../src/tree-decide.js';
import { buildStopDecision } from '../src/tree-decide-stop.js';
import * as TR from '../src/tree-transitions.js';
import { dryRunReport } from '../src/dry-run.js';
import { money } from '../src/tree-stop.js';

const sizedText = S => {
  const taskText = readFileSync(join(S.work, 'tasks', 'x.md'), 'utf8');
  const bytesWith = text => Object.values(rootBundle({ treeId: S.rootId, generation: 2, decisions: [{ id: 'd0', text }], taskText }).files).reduce((n, t) => n + Buffer.byteLength(t, 'utf8'), 0);
  return 'a'.repeat(3950 - bytesWith('a') + 1);       // the bundle WITHOUT the earlier plan is 3950 bytes; the earlier plan takes it over the fixture's 4000
};

test('AS-1 the size refusal names both ways on (a shorter decision or --fresh; or --allow-size N) and records nothing', { timeout: 600_000 }, async () => {
  const S = await driveToDepthTwoReplan({ stopBeforeReplan: true });
  const before = S.kinds('decision_recorded').length;
  const big = await S.decide(S.rootStop.id, sizedText(S)); assert.equal(big.code, 1, big.text);
  assert.match(big.text, /would be about (\d+) bytes, over the 4000 this tree's approval was priced for\. Two ways on: give a shorter decision or leave the earlier plan out with --fresh; or raise the size for this new plan with --allow-size \d+ \(the new plan's price is then shown for you to approve\)/);
  assert.equal(S.kinds('decision_recorded').length, before, 'nothing was recorded');
});

test('AS-2 THE RAISE: the gate screen shows the price now and after, the decision records allowanceBytes, the approval is priced at the raised size, R@g2 registers over the old limit, and the tree keeps its number', { timeout: 600_000 }, async () => {
  const S = await driveToDepthTwoReplan({ stopBeforeReplan: true });
  const text = sizedText(S);
  const refusal = await S.decide(S.rootStop.id, text); const N = Number(/--allow-size (\d+)/.exec(refusal.text)?.[1]); assert.ok(N > 4000, refusal.text);       // the number the refusal names must be enough
  const d = await S.decide(S.rootStop.id, text, { 'allow-size': String(N) }); assert.equal(d.code, 0, d.text);
  assert.match(d.text, new RegExp(`Raising the size this new plan is priced for from 4000 to ${N} bytes \\(--allow-size\\)\\. Price now: cheapest end \\$[\\d.]+, upper estimate \\$[\\d.]+\\. Price after the raise: cheapest end \\$[\\d.]+, upper estimate \\$[\\d.]+\\. Typing the stop id approves that price; it applies to this new root plan only\\.`));
  const dec = S.kinds('decision_recorded').at(-1);
  assert.equal(dec.allowanceBytes, N);
  const record = readTreeRecord(S.rootDir);
  assert.equal(allowanceOfDecision(record.tree, dec), N);
  assert.equal(bundleAllowanceBytesOf(record.tree), 4000, 'the tree\'s own number is unchanged (children keep it)');
  const a = await S.approve(); assert.equal(a.code, 0, a.text);
  assert.match(a.text, new RegExp(`priced for an input of up to (${N} bytes|${Math.round(N / 1000)} KB)`));
  await S.sit();
  assert.ok(S.nodeOf('R', 2), 'R@g2 registered although its input is over the tree\'s 4000');
  assert.ok(S.kinds('node_started').some(e => e.node === 'R' && e.generation === 2), `R@g2 also STARTED: ${JSON.stringify(S.kinds('blocked').map(e => e.check))}`);
});

test('AS-3 the raise is refused in words when it is not above the tree\'s number, is not a number, sits next to --fresh or another form, or the input is still over it', { timeout: 600_000 }, async () => {
  assert.match(chooseForm({ 'allow-size': '6000', fresh: true }).error, /--allow-size belongs to a new root plan for a stop/);
  assert.match(chooseForm({ 'allow-size': '6000', close: 'R/M1' }).error, /--allow-size belongs to a new root plan for a stop/);
  assert.equal(chooseForm({ 'allow-size': '6000' }).form, 'regenerate');
  const S = await driveToDepthTwoReplan({ stopBeforeReplan: true });
  for (const bad of ['4000', '100', 'lots', '6000.5']) {
    const r = await S.decide(S.rootStop.id, 'x', { 'allow-size': bad }); assert.equal(r.code, 1, r.text);
    assert.match(r.text, /--allow-size: give a whole number of bytes above the 4000 this tree's approval is priced for/);
  }
  const still = await S.decide(S.rootStop.id, sizedText(S), { 'allow-size': '4001' }); assert.equal(still.code, 1, still.text);
  assert.match(still.text, /would be about \d+ bytes, over the 4001 this tree's approval was priced for/);
  assert.doesNotMatch(still.text, /--allow-size \d+ \(the new plan's price/, 'a raise is not offered again');
});

test('AS-4 the table refuses a raise recorded by the session, and on a decision that does not re-plan the root', { timeout: 600_000 }, async () => {
  const S = await driveToDepthTwoReplan({ stopBeforeReplan: true });
  const st = S.state();
  const base = { event: 'decision_recorded', text: 't', affected: [], form: 'regenerate', stopId: S.rootStop.id, replansRoot: true, oldPlan: { form: 'fresh' }, allowanceBytes: 6000, gateId: 'g', shownSha256: 'a'.repeat(64) };
  const why = e => TR.transitionRefusal(st, e)?.reason ?? '';
  assert.notEqual(why({ ...base, actor: 'session', via: 'mcp', reason: 'r' }), '', 'a session cannot record a root re-plan at all, raised or not');
  // a form the session MAY record (a keep), so the allowanceBytes rule is the only thing that can refuse it
  const keep = { event: 'decision_recorded', text: 't', affected: [], form: 'keep', stopId: S.rootStop.id, gateId: 'g', shownSha256: 'a'.repeat(64), actor: 'session', via: 'mcp', reason: 'r' };
  assert.doesNotMatch(why(keep), /never raises it/, 'a plain keep by the session is not refused by this rule');
  assert.match(why({ ...keep, allowanceBytes: 6000 }), /a raised size \(allowanceBytes\) belongs to a new root plan decided by a person at a terminal: the session never raises it/);
  assert.match(why({ ...base, actor: 'person', via: 'terminal', replansRoot: false }), /the session never raises it|belongs to a new root plan/);
  assert.doesNotMatch(why({ ...base, actor: 'person', via: 'terminal' }), /never raises it/);
  const shape = n => TR.eventShapeError({ schema: 'tree-events/1', id: 'e1', at: '2026-10-20T12:00:00.000Z', ...base, allowanceBytes: n });
  assert.equal(shape(6000), null); assert.match(shape(0) ?? '', /allowanceBytes/); assert.match(shape(1.5) ?? '', /allowanceBytes/);
});

test('AS-5 a chosen recommendation refused for size says the advice was already paid for', { timeout: 600_000 }, async () => {
  const S = await driveToDepthTwoReplan({ stopBeforeReplan: true });
  const r = buildStopDecision({ rootDir: S.rootDir, rootId: S.rootId, form: 'regenerate', stopArg: S.rootStop.id, decisionText: sizedText(S), work: S.work, sittingHeld: () => false, fromRecommendation: { n: 1, adviceId: 'rec-x' }, offerRaise: true });
  assert.match(r.refusal ?? '', /The advice you chose this from was already paid for; this refusal spends nothing more\./);
});

test('AS-6 THE 2 MB BOUNDARY (C&C 20 Okt, Q1): a decision that makes context.md exactly MAX_CONTEXT_FILE_BYTES passes that check (and is offered a size raise), one byte more is refused with NO number and no raise, because the member refuses such a file at its start', { timeout: 600_000 }, async () => {
  const S = await driveToDepthTwoReplan({ stopBeforeReplan: true });
  const taskText = readFileSync(join(S.work, 'tasks', 'x.md'), 'utf8');
  const ctx = k => Buffer.byteLength(rootBundle({ treeId: S.rootId, generation: 2, decisions: [{ id: 'e99999999', text: 'a'.repeat(k) }], taskText }).files['context.md'], 'utf8');
  const k0 = 2_000_000 - (ctx(1) - 1);
  assert.equal(ctx(k0), 2_000_000); assert.equal(ctx(k0 + 1), 2_000_001);
  const go = k => buildStopDecision({ rootDir: S.rootDir, rootId: S.rootId, form: 'regenerate', stopArg: S.rootStop.id, decisionText: 'a'.repeat(k), work: S.work, sittingHeld: () => false, fresh: true, offerRaise: true });
  const at = go(k0).refusal; assert.match(at, /--allow-size \d+ \(the new plan's price/, 'at the limit the raise is still offered (the allowance, not the file size, refuses)');
  const over = go(k0 + 1).refusal; assert.match(over, /context\.md would be 2000001 bytes, over the 2000000 the CLI accepts at the plan's start: give a shorter decision; no size raise can help/);
  assert.doesNotMatch(over, /--allow-size \d/);
});

test('AS-7 CHILDREN KEEP THE TREE\'S NUMBER (C&C 20 Okt, Q4): after R@g2 is registered at the raised size, the approval of R@g2\'s own children is priced for the tree\'s 4000 bytes, never the raise', { timeout: 600_000 }, async () => {
  const S = await driveToDepthTwoReplan({ stopBeforeReplan: true });
  const d = await S.decide(S.rootStop.id, sizedText(S), { 'allow-size': '10000' }); assert.equal(d.code, 0, d.text);
  assert.equal((await S.approve()).code, 0);
  await S.sit();
  assert.ok(S.nodeOf('R', 2), 'R@g2 registered at the raised size');
  const a = await S.approve(); assert.equal(a.code, 0, a.text);       // the frontier that waits now is R@g2's own children
  assert.match(a.text, /priced for an input of up to 4 KB/);
  assert.doesNotMatch(a.text, /priced for an input of up to 10 KB/);
});

test('AS-8 ONE BASIS ON THE ROOT RE-PLAN SCREEN: at a raised size the expected figure is priced for the same input as the cheapest end and the upper estimate, so it cannot sit below the cheapest end (no words changed)', { timeout: 600_000 }, async () => {
  const S = await driveToDepthTwoReplan({ stopBeforeReplan: true });
  const text = sizedText(S);
  const refusal = await S.decide(S.rootStop.id, text); const N = Number(/--allow-size (\d+)/.exec(refusal.text)?.[1]); assert.ok(N > 4000, refusal.text);
  const d = await S.decide(S.rootStop.id, text, { 'allow-size': String(N) }); assert.equal(d.code, 0, d.text);
  const root = JSON.parse(readFileSync(join(S.work, 'chains', 'depth2-root.json'), 'utf8'));
  const e = dryRunReport(root, { taskChars: N }).estimate;
  assert.ok(Number.isFinite(e.expectedWithTaskUsd) && e.expectedWithTaskUsd - e.expectedUsd >= 0.01, `fixture: both bases are reachable at ${N} bytes (${e.expectedUsd} without the task, ${e.expectedWithTaskUsd} with it)`);
  const a = await S.approve(); assert.equal(a.code, 0, a.text);
  const line = /Price: (\$[\d.]+) cheapest end, (\$[\d.]+) expected, (\$[\d.]+) upper estimate \(priced for an input of up to/.exec(a.text);
  assert.ok(line, a.text);
  assert.equal(line[1], money(e.floorWithTaskUsd), 'cheapest end: with the task');
  assert.equal(line[2], money(e.expectedWithTaskUsd), `expected: with the task, not ${money(e.expectedUsd)}`);       // red at 8c71d2b: the no-task figure
});
