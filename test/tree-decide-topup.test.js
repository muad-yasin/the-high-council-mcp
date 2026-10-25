// CHANGED ACCEPTED (estimator unit commit 2 left these literals; bisect 1e81a99, C&C ruling B-narrow; 20 Okt 2026): OLD grant $6.65 / available $13.31 / after top-up $1.31 / would-be $18.65 and $13.65 / earlier-top-ups total $10.65 (root cap 20); NEW $8.65 / $17.31 / $5.31 / $20.65 and $15.65 / $12.65 (root cap 26, the fixture cap that commit set). WHY: that commit raised the fixture cap 20 -> 26 and one assertion but not these lines; no code moved.
// `council tree decide --top-up <node> --amount <usd>` (0.8.3 M5d, sub-commit 2; PLAN 7.5; M5 exit check L9). All-mock, $0: the stopped child is a REAL mock-budget run that hits its cap through the sitting. Decide starts nothing;
// the resume is `tree resume`. Every working folder is removed at the end of the file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256Of } from '../src/thin-contract.js';
import { appendTreeEvent, readTreeRecord, stateOf, TREE_DIR, TREE_FILE } from '../src/tree-record.js';
import { budgetOf } from '../src/tree-budget.js';
import { decideHandler, parseTopUpAmount } from '../src/tree-decide.js';
import { registerNextChild } from '../src/tree-loop.js';
import { runTree } from '../src/tree-run.js';
import { resumeHandler } from '../src/tree-resume.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { approvePending, eventsOf, phases } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { ROOT_ID, SPLIT_ROOT_HANDOFF_USD, claim, hostnameOf } from './helpers/tree-fixture.js';
import { stoppedChildFixture, usdRx } from './helpers/money-figures.js';
import { assertBoundTextClean, assertRefusedWithoutAsking, dirty, dirtyMarked } from './helpers/bound-text.js';

const treeJson = r => readFileSync(join(r.t.rootDir, TREE_DIR, TREE_FILE));
const decide = (r, flags, answers, extra = {}) => {
  const io = terminal(answers, extra.tty === false ? { tty: false } : {});
  if (answers.length === 0) io.stdin.end();     // a run that has nobody to answer and wrongly ASKS ends (and fails its assertions) instead of waiting for ever: a removed guard must not look like a hang
  if (extra.onPrompt) io.stdout.on('data', d => { if (/\[y\/N\]/.test(String(d))) extra.onPrompt(); });
  const run = () => decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() });
  return { io, run };
};
// CHANGED ACCEPTED TEST (decider-readiness apply patch, money-test TEMPLATE, 24 Okt 2026; C&C ruling (c); the full suite on fad02049 listed nine tests of this file, #4166-#4176). OLD: root cap 26 and the literals 8.65 / 17.31 / 5.31 / 20.65 / 15.65 / 12.65, sized against mock-budget's cheapest end 8.064. NEW: the figures are derived (test/helpers/money-figures.js):
// G = the equal share just over mock-budget's own cheapest end, CAP = the root cap whose equal share among three children, after the split root's own 0.04, is G; every amount a screen shows is a function of G, CAP and the top-up typed. WHY: recording the drafted words moves the cheapest end
// (8.064 -> 8.714), so 26 / 3 = 8.67 fell under it, R/M1 was not admitted, and every test of this file that needs the stopped child failed with another stop (held_by_stop: no_milestone_lint) before its own assertion. The expected amounts keep their meaning: grant G, available 2 x G after it, a top-up of 12 leaves 2 x G - 12.
const { G, CAP } = stoppedChildFixture();
const AVAILABLE = Math.round((CAP - SPLIT_ROOT_HANDOFF_USD - G) * 100) / 100;      // what the root still has after R/M1's grant
// the typed amounts of this file only make sense while the root has that much left: asserted here, so a figure that moves them fails HERE with the reason (the typed top-ups: 12 in L9 and K10, 5, 4 + 3 = 7 in the second-top-up test; 1000 is refused whatever AVAILABLE is)
assert.ok(AVAILABLE >= 12, `fixture: the root has ${AVAILABLE} left after R/M1's grant, enough for the typed top-up of 12`);
const rx = usdRx;
const gateFiles = r => { try { return readdirSync(join(r.t.rootDir, 'gates')).length; } catch { return 0; } };
/** A tree with a real child (R/M1) stopped at its cap: mock-budget children and a root cap CAP that stoppedChildFixture() derives from the chain's own dry run, so that each child's grant G (floorCents((CAP - 0.04, the root's handoff) / 3), R14 - proposeGrants, src/tree-budget.js) is just over the chain's cheapest end and the mock-budget chain cannot finish on it. (It was a typed cap 20 with grants of 6.65, then a typed 26 with 8.65.) */
async function stopped() {
  const r = await trackedRealRoot({ childChain: 'mock-budget', cap: CAP });      // CHANGED (money-test template): CAP is derived from the chain's own dry run by stoppedChildFixture() (the grant floorCents((CAP - 0.04) / 3) is G, just over mock-budget's cheapest end); it was a typed 20, then a typed 26
  approvePending(r);
  const out = await runTree(r.t.rootDir, { work: r.t.work });
  assert.equal(out.status, 'budget_stop', JSON.stringify(out)); assert.equal(out.node, 'R/M1');
  assert.equal(phases(r)['R/M1'], 'stopped', 'a budget stop is not active');
  return r;
}

test('R10 (Opus 2-2): a node that is STALE (a stop put it in question) or SUPERSEDED is not topped up: the form refuses before anybody is asked, instead of promising a resume the tree refuses with exit 19', { timeout: 300_000 }, async () => {
  const r = await stopped();
  const stop = appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'status', affected: [{ node: 'R', generation: 1 }, { node: 'R/M1', generation: 1 }] });   // a stop of the root puts R/M1 in question (a stopped node cannot have a stop of its own: it is not closed)
  const grants = () => eventsOf(r).filter(e => e.event === 'grant_issued').length;
  const d = decide(r, { 'top-up': 'R/M1', amount: '1' }, []);
  await assertRefusedWithoutAsking(d, new RegExp(`R/M1@g1 is stale[^]*stop ${stop.id}[^]*would refuse|R/M1@g1 is stale`));
  assert.equal(grants(), 0);
  assert.equal(/arrives in a later part|later part of this build/.test(d.io.errors()), false);
});

test('the typed amount goes through the ONE cap grammar (parseCapInput, paid: false, no ceiling): trimmed, kept as given for the retype, at most four places; each refusal code has the top-up\'s own sentence, which never says "limit" or "Nothing was started"', () => {
  assert.deepEqual(parseTopUpAmount('12'), { amount: 12, text: '12' });
  assert.deepEqual(parseTopUpAmount('2.50'), { amount: 2.5, text: '2.50' }, 'the text is as given: 2.50 is not 2.5');
  assert.deepEqual(parseTopUpAmount('0.0001'), { amount: 0.0001, text: '0.0001' });
  assert.deepEqual(parseTopUpAmount(' 2 '), { amount: 2, text: '2' }, 'the grammar trims, and the retype is compared to the trimmed text');
  const sentence = (raw, pattern) => { const r = parseTopUpAmount(raw); assert.equal(r.amount, undefined, JSON.stringify(raw)); assert.match(r.refusal, pattern, JSON.stringify(raw)); assert.equal(/\blimits?\b|Nothing was started/i.test(r.refusal), false, `the cap's words: ${r.refusal}`); };
  for (const zero of ['0', '0.0', '0.0000']) sentence(zero, /adds nothing\. Type an amount above zero/);
  for (const bad of ['-1', '+2', '1e3', '.5', '1 000', 'abc', '007', '007x', '0x10', '2.', '$2']) sentence(bad, /is not a plain amount of dollars\. Type only digits and an optional dot/);
  for (const word of ['none', 'unlimited', 'off', 'Infinity']) sentence(word, /is not an amount of dollars/);
  sentence('1,5', /has a comma\. Use a dot for the decimals/); sentence('', /type the dollars to add/); sentence('0.00001', /more than four decimals/); sentence('1.1234567', /more than four decimals/); sentence('0.000001', /more than four decimals/); sentence('1234567', /more than six digits before the dot/);
  sentence(12, /type the dollars to add/);        // the string as given: a number is not what a flag carries
  assert.equal(parseTopUpAmount('sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCDEF').refusal.includes('abcdefghijklmnop'), false, 'a key pasted into the wrong field is not echoed');
});

test('L9 (real): a child stopped at its cap is topped up at a terminal (typing the amount): the text carries its grant, the amount, the new total and the root\'s AVAILABLE figure; grant_issued carries the gate id and the hash of that text; nothing starts; `tree resume` then resumes the SAME run under first grant + top-up, node_resumed first', { timeout: 400_000 }, async () => {
  const r = await stopped();
  const treeBefore = treeJson(r); const cap = readTreeRecord(r.t.rootDir).tree.rootCapUsd;
  const registeredBefore = eventsOf(r).filter(e => e.event === 'node_registered').length;
  const runId = stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M1@g1').runId;
  const d = decide(r, { 'top-up': 'R/M1', amount: '12' }, ['12', 'y']);
  assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  const shown = d.io.shown();
  assert.match(shown, /R\/M1 stopped at its budget cap\./); assert.match(shown, /STOPPED-budget/);
  // `spent so far` is what R/M1's own record says it spent when the budget stop came (0.00 when it stopped before its first paid call): derived, not typed, because whether it stops before or after a call depends on its projected worst case against the grant, which the figure does not control
  const spentSoFar = budgetOf(r.t.rootDir).nodes.find(n => n.node === 'R/M1').spentUsd;
  assert.match(shown, new RegExp(`Its grant now: \\$${rx(G)} first = \\$${rx(G)}; spent so far \\$${rx(spentSoFar)}\\.`)); assert.match(shown, new RegExp(`This top-up: \\$12\\.00\\. Its grant would be \\$${rx(G + 12)}\\.`));
  // available = cap - spent - held = 20 - 0.04 (the root's handoff) - 6.65 (R/M1's grant) = 13.31, and 1.31 after the $12 top-up (it was 20 - 6.66 = 13.34 and 1.34)
  assert.match(shown, new RegExp(`still available \\$${rx(AVAILABLE)} now, \\$${rx(AVAILABLE - 12)} after this top-up\\. A top-up never raises the root cap\\.`)); assert.match(shown, /Deciding this starts nothing: `council tree resume .*` resumes R\/M1 under the new total as the same attempt/);
  assert.match(shown, /To approve, type the amount: 12\n/); assert.match(shown, /Type the amount shown in the last line above: /);
  const issued = eventsOf(r).filter(e => e.event === 'grant_issued');
  assert.equal(issued.length, 1); assert.deepEqual([issued[0].node, issued[0].generation, issued[0].amount, issued[0].unit], ['R/M1', 1, 12, 'usd']);
  assert.ok(issued[0].gateId); assert.match(issued[0].shownSha256, /^[0-9a-f]{64}$/);
  const textFile = join(r.t.rootDir, TREE_DIR, 'gate-texts', `tree_decide-${issued[0].shownSha256.slice(0, 16)}.txt`);
  assert.equal(existsSync(textFile), true, 'the text the person read is on disk under its hash'); assert.equal(sha256Of(readFileSync(textFile, 'utf8')), issued[0].shownSha256);
  assert.deepEqual(treeJson(r), treeBefore); assert.equal(readTreeRecord(r.t.rootDir).tree.rootCapUsd, cap);
  assert.equal(phases(r)['R/M1'], 'stopped', 'decide starts nothing'); assert.equal(eventsOf(r).some(e => e.event === 'node_resumed'), false);
  assert.equal(eventsOf(r).filter(e => e.event === 'node_registered').length, registeredBefore);
  // the resume is the existing verb; the siblings are not started by this test (a stub ends the sitting that follows)
  const io = terminal([]); const out = []; io.stdout.on('data', x => out.push(String(x)));
  const code = await resumeHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdout: io.stdout, stderr: io.stderr, deps: { startRun: async () => ({ exitCode: 3 }) } });
  const ev = eventsOf(r);
  const resumedAt = ev.findIndex(e => e.event === 'node_resumed' && e.node === 'R/M1');
  assert.ok(resumedAt > ev.findIndex(e => e.event === 'grant_issued'), 'node_resumed after the top-up');
  const claimEv = ev[resumedAt];
  assert.equal(claimEv.runId, runId, 'the same run: the same attempt'); assert.ok(Math.abs(claimEv.capAskedUsd - (G + 12)) < 1e-5, `asked ${claimEv.capAskedUsd}: first grant + top-up (the resume rounds the cap to 6 places)`);
  assert.ok(claimEv.capUsd <= budgetOf(r.t.rootDir).rootCapUsd, 'bounded by what the root has'); assert.ok(claimEv.capUsd <= claimEv.capAskedUsd + 1e-9);
  assert.equal(resumeCountOfNode(ev, 'R/M1'), 1);
  void code; void out;
});
const resumeCountOfNode = (events, node) => events.filter(e => e.event === 'node_resumed' && e.purpose === 'resume' && e.node === node).length;

test('while the topped-up node runs (its node_resumed is written), registering a sibling is refused through the one active rule', { timeout: 300_000 }, async () => {
  const r = await stopped();
  const d = decide(r, { 'top-up': 'R/M1', amount: '5' }, ['5', 'y']); assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  let during = null;
  const io = terminal([]);
  await resumeHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdout: io.stdout, stderr: io.stderr, deps: {
    resumeRun: async () => { appendTreeEvent(r.t.rootDir, { event: 'node_resumed', purpose: 'resume', ...claim('R/M1', stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M1@g1').runId, process.pid, 1, hostnameOf()) }); during = registerNextChild(r.t.rootDir, { work: r.t.work }); return { exitCode: 3 }; },
    startRun: async () => ({ exitCode: 3 }),
  }, facts: { pidAlive: () => true } });
  assert.deepEqual([during?.kind, during?.node], ['active', 'R/M1']);
  assert.deepEqual(Object.keys(phases(r)).sort(), ['R', 'R/M1'], 'no sibling was registered');
});

test('refusals ask nobody and write nothing: a node that is not stopped at its cap (its phase named), an unknown node, an amount the root cap does not have free, malformed amounts; --amount without --top-up and the other way round', { timeout: 300_000 }, async () => {
  const r = await stopped();
  const sib = registerNextChild(r.t.rootDir, { work: r.t.work });                     // R/M3 (R/M2 consumes the stopped R/M1 and waits): registered, active
  assert.equal(sib.node, 'R/M3');
  const gates0 = gateFiles(r); const events0 = eventsOf(r).length;
  const refuse = async (flags, pattern) => { const d = decide(r, flags, []); assert.equal(await d.run(), flags.amount === undefined || flags['top-up'] === undefined ? 2 : 1, d.io.errors()); assert.match(d.io.errors(), pattern); };
  await refuse({ 'top-up': 'R/M3', amount: '2' }, /R\/M3@g1 is registered \(active\); only a node that stopped at its budget cap can be topped up/);
  await refuse({ 'top-up': 'R', amount: '2' }, /R@g1 is closed; only a node that stopped at its budget cap/);
  await refuse({ 'top-up': 'R/M9', amount: '2' }, /no such node in this tree/);
  await refuse({ 'top-up': 'R/M1', amount: '1000' }, /only \$\d+\.\d\d of the root cap is free; \$1000\.00 was asked/);
  await refuse({ 'top-up': 'R/M1', amount: '0' }, /--amount: "0" adds nothing\. Type an amount above zero/);
  for (const bad of ['-3', '1e3', 'two', '2.']) await refuse({ 'top-up': 'R/M1', amount: bad }, /--amount: ".*" is not a plain amount of dollars\. Type only digits and an optional dot/);
  await refuse({ 'top-up': 'R/M1', amount: '1,5' }, /--amount: "1,5" has a comma/); await refuse({ 'top-up': 'R/M1', amount: '0.00001' }, /more than four decimals/);
  await refuse({ amount: '2' }, /--amount belongs to --top-up only/); await refuse({ 'top-up': 'R/M1' }, /--top-up needs --amount/);
  assert.equal(gateFiles(r), gates0, 'no gate was requested'); assert.equal(eventsOf(r).length, events0, 'nothing was written');
});

test('the typed step is the amount AS GIVEN: 12.0 does not approve 12; a decline and a missing terminal write nothing; a sibling\'s claim between the read and the yes changes the available figure, so the approval is NOT used', { timeout: 300_000 }, async () => {
  const r = await stopped();
  const g0 = eventsOf(r).filter(e => e.event === 'grant_issued').length;
  const wrong = decide(r, { 'top-up': 'R/M1', amount: '12' }, ['12.0', 'y']); assert.equal(await wrong.run(), 1); assert.match(wrong.io.shown(), /That is not what the text asks you to type/);
  const trailing = decide(r, { 'top-up': 'R/M1', amount: '2.50' }, ['2.5', 'y']); assert.equal(await trailing.run(), 1); assert.match(trailing.io.shown(), /To approve, type the amount: 2\.50\n/); assert.match(trailing.io.shown(), /That is not what the text asks you to type/);
  const declined = decide(r, { 'top-up': 'R/M1', amount: '12' }, ['12', 'n']); assert.equal(await declined.run(), 1);
  const notty = decide(r, { 'top-up': 'R/M1', amount: '12' }, [], { tty: false }); assert.equal(await notty.run(), 2);
  const moved = decide(r, { 'top-up': 'R/M1', amount: '5' }, ['5', 'y'], { onPrompt: () => registerNextChild(r.t.rootDir, { work: r.t.work }) });
  assert.equal(await moved.run(), 1); assert.match(moved.io.errors(), /what you were shown has changed while you were reading it/); assert.match(moved.io.errors(), /Your approval was NOT used and nothing was recorded/);
  assert.equal(eventsOf(r).filter(e => e.event === 'grant_issued').length, g0, 'no top-up was recorded by any of them');
});

test('the approval screen shows the amount AS RECORDED: an amount two decimals cannot hold (0.0125, 2.5025) is shown as typed, not rounded to the cent; one it can hold keeps the two-decimal form', { timeout: 300_000 }, async () => {
  const r = await stopped();
  for (const [typed, line] of [['0.0125', /This top-up: \$0\.0125\. Its grant would be/], ['2.5025', /This top-up: \$2\.5025\. Its grant would be/], ['0.0001', /This top-up: \$0\.0001\. Its grant would be/]]) {
    const d = decide(r, { 'top-up': 'R/M1', amount: typed }, [typed, 'n']); await d.run();
    assert.match(d.io.shown(), line, typed); assert.match(d.io.shown(), new RegExp(`To approve, type the amount: ${typed.replace('.', '\\.')}\\n`));
  }
  const whole = decide(r, { 'top-up': 'R/M1', amount: '2.5' }, ['2.5', 'n']); await whole.run();
  assert.match(whole.io.shown(), /This top-up: \$2\.50\. Its grant would be/, 'an amount the cent can hold keeps the two-decimal form');
});

test('a second top-up of the same node shows the earlier ones and the total they make; the top-up must follow a stop (a node topped up once and running again is refused)', { timeout: 300_000 }, async () => {
  const r = await stopped();
  const first = decide(r, { 'top-up': 'R/M1', amount: '4' }, ['4', 'y']); assert.equal(await first.run(), 0, first.io.shown() + first.io.errors());
  const runId = stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M1@g1').runId;
  appendTreeEvent(r.t.rootDir, { event: 'node_resumed', purpose: 'resume', ...claim('R/M1', runId, 999991, 1, hostnameOf()) });       // it ran again ...
  const running = decide(r, { 'top-up': 'R/M1', amount: '1' }, []); assert.equal(await running.run(), 1); assert.match(running.io.errors(), /R\/M1@g1 is running \(active\); only a node that stopped at its budget cap/);
  appendTreeEvent(r.t.rootDir, { event: 'node_stopped', node: 'R/M1', generation: 1, runId, reason: 'budget' });                           // ... and stopped at the new cap
  const second = decide(r, { 'top-up': 'R/M1', amount: '3' }, ['3', 'y']); assert.equal(await second.run(), 0, second.io.shown() + second.io.errors());
  assert.match(second.io.shown(), new RegExp(`Its grant now: \\$${rx(G)} first \\+ \\$4\\.00 in earlier top-ups = \\$${rx(G + 4)};`)); assert.match(second.io.shown(), new RegExp(`Its grant would be \\$${rx(G + 7)}\\.`));
  assert.deepEqual(eventsOf(r).filter(e => e.event === 'grant_issued').map(e => e.amount), [4, 3]);
});

test('the sources: topUp/acceptAccounting are still not part of the public library, its types or any MCP tool (the M2 pin), and tree-decide.js reads no environment variable', () => {
  const root = join(import.meta.dirname, '..');
  for (const f of ['src/api.js', 'src/api.d.ts', 'src/mcp/server.js']) { if (!existsSync(join(root, f))) continue; const t = readFileSync(join(root, f), 'utf8'); assert.equal(/\btopUp\b|\bacceptAccounting\b|\bcloseIncomplete\b/.test(t), false, f); }
});

test('T1 / T2 fail-fast: a top-up of a node that did not stop at its cap, and of more than the root cap has free, are refused BEFORE anybody is asked: nothing is shown, no gate is requested, nothing is written', async () => {
  const r = await stopped();
  const gates0 = gateFiles(r); const events0 = eventsOf(r).length; const treeBefore = treeJson(r).toString();
  // T1: R is closed (not stopped at a cap)
  await assertRefusedWithoutAsking(decide(r, { 'top-up': 'R', amount: '1' }, []), /R@g1 is closed; only a node that stopped at its budget cap can be topped up/);
  // T2: R/M1 is stopped, but 1000 is more than the root cap (20) has free
  await assertRefusedWithoutAsking(decide(r, { 'top-up': 'R/M1', amount: '1000' }, []), /only \$\d+\.\d+ of the root cap is free; \$1000\.00 was asked/);
  assert.equal(gateFiles(r), gates0, 'no gate was requested'); assert.equal(eventsOf(r).length, events0, 'nothing was recorded'); assert.equal(treeJson(r).toString(), treeBefore);
});

test('K10: the top-up is shown and hashed through terminalSafe: a control character and a bidi mark in a stop reason read from the run folder are gone from the gate text, the screen and the hash, which agree', async () => {
  const r = await stopped();
  const runId = stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M1@g1').runId;
  const word = dirtyMarked('HostileStopReasonWords', 7);
  writeFileSync(join(r.t.runsDir, runId, 'STOPPED-note.md'), `${word.raw} came from a file in the run folder.\n`);
  const d = decide(r, { 'top-up': 'R/M1', amount: '12' }, ['12', 'y']);
  assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  const grant = eventsOf(r).find(e => e.event === 'grant_issued');
  assertBoundTextClean({ rootDir: r.t.rootDir, shownSha256: grant.shownSha256, shown: d.io.shown(), word: word.clean });
});
