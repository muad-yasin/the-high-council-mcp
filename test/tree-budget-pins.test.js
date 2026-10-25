// 0.8.3 M6 atomic tree budget, COMMIT 0 (C&C 14 Oct 2026; gate page Review/Build_0.8.3/m6-closing/Atomic_Tree_Budget_Gate_Page.md sections 2, 6, 9, 12): TESTS ONLY - pins of TODAY's disjoint-money invariant before any change to it.
//   effective cap  >=  treeSpentUsd (settled + unsettled reservations at their bound) + unknownSpendHeldUsd + heldUsd (unspent grants of live registered nodes);  availableUsd = cap - those three.
// Offline, $0: synthetic run folders written by hand (test/helpers/tree-fixture.js), two real Node processes for the races, and one real all-mock member (`mock-budget`) running in a child process while another process admits.
// What each test pins is named in its title. At COMMIT 0 one test (7) was a KNOWN-HAZARD pin asserting the behaviour the root-hold fix would change; the fix commit EDITED it on purpose (it now asserts the root generation's hold) and added the two
// ROOT HOLD tests after it. Commit 0 itself changed no src file and none of its tests was written to pass: each was run once at the base to see what the code did (the evidence is in that commit's message).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { runWorkers } from './helpers/race-workers.js';
import { assertInvariant, spend, stoppedKid } from './helpers/tree-money.js';
import { appendFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as api from '../src/api.js';
import { EVENTS_FILE, TreeRefusal, appendTreeEvent, readTreeRecord, stateOf, treeDirOf } from '../src/tree-record.js';
import { MONEY_EPS, amendCap, budgetOf, gateTree, lifetimeCapOf, proposeGrants, topUp } from '../src/tree-budget.js';
import { registerRoot } from '../src/tree-register.js';
import { rootBundle, rootReplanPreflight, registerRootReplan, writeRootBundle } from '../src/tree-root-replan.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { GATE_FIELDS, IDS, ROOT_ID, approveFrontier, chainSha, claim, closedRootTree, hostnameOf, lineageFile, newTree, registerKid, reservedLine, rootOpts, settledLine, syntheticRun, writeLines } from './helpers/tree-fixture.js';

const cents = n => Math.round(n * 1e6) / 1e6;
const codes = g => g.problems.map(p => p.code);
const events = rootDir => readTreeRecord(rootDir).events;
const made = new Set();
const track = t => { made.add(t.work); return t; };
after(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });
const SRC = resolve(import.meta.dirname, '..', 'src');
const srcUrl = name => pathToFileURL(join(SRC, name)).href;

// ------------------------------------------------------------------------------------------------------------------------------- Astra #12's own numeric example (gate page section 2, DECISION 1)
test('Astra\'s example, driven: cap 10, settled 4, outstanding bounds 2, unspent grants 3 -> available 1; a $1 request funded from a grant leaves the exposure at 9; the next unrelated $2 is refused (gate page 2)', () => {
  const t = track(closedRootTree({ cap: 10 }));
  const key = approveFrontier(t.rootDir, ['R/M1', 'R/M2', 'R/M3']);
  // R/M1: grant 7, one call settled at 4.00 (it had reserved 4.50), one call in flight at its bound 2.00 -> spent 6, holds 1; stopped at its cap
  stoppedKid(t, key, 'R/M1', IDS[0], 7, [{ id: 'r1', reservedUsd: 4.5, settledUsd: 4 }, { id: 'r2', reservedUsd: 2 }]);
  // R/M2: grant 2, nothing spent yet -> holds 2
  registerKid(t, key, 'R/M2', IDS[1], 2);
  const b = assertInvariant(t.rootDir, 'before the request');
  assert.deepEqual([b.rootCapUsd, cents(b.treeSpentUsd), b.unknownSpendHeldUsd, cents(b.heldUsd), cents(b.availableUsd)], [10, 6, 0, 3, 1], 'cap 10; settled 4 + outstanding 2 = 6; unspent grants 1 + 2 = 3; available 1');
  // a $1 request funded from R/M2's grant: it moves from "held" to "spent"; the exposure does not move
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M2', IDS[1], process.pid, 1, hostnameOf()) });
  spend(t, 'R/M2', IDS[1], [{ id: 'r3', reservedUsd: 1 }]);
  const after1 = assertInvariant(t.rootDir, 'after the $1 request');
  assert.deepEqual([cents(after1.treeSpentUsd), cents(after1.heldUsd), cents(after1.availableUsd)], [7, 2, 1], 'spent 7, held 1 + 1, available still 1');
  assert.equal(cents(after1.treeSpentUsd + after1.heldUsd + after1.unknownSpendHeldUsd), 9, 'the exposure is 9 before and after');
  // the next unrelated $2: refused by the top-up and by an admission, each with a blocked record and no new grant or registration
  const before = events(t.rootDir).length;
  assert.throws(() => topUp(t.rootDir, { node: 'R/M1', amountUsd: 2, ...GATE_FIELDS }), e => e instanceof TreeRefusal && e.code === 'continuation_refused');
  const grants = () => events(t.rootDir).filter(e => e.event === 'grant_issued').length;
  assert.equal(grants(), 0);
  assert.ok(events(t.rootDir).length > before, 'the refusal is recorded (a blocked line), not silent');
  assertInvariant(t.rootDir, 'after the refusal');
  // and the dollar that IS free can be granted (the refusal above was about the $2, not about the tree)
  topUp(t.rootDir, { node: 'R/M1', amountUsd: 1, ...GATE_FIELDS });
  const last = assertInvariant(t.rootDir, 'after a $1 top-up');
  assert.equal(cents(last.availableUsd), 0);
});

// ------------------------------------------------------------------------------------------------------------------------------- the duplicate settle line (gate page 6, 12.3)
test('a DUPLICATE settled line never releases a reservation twice: in the run file, in the mirror, or in both, the reservation stays charged at its bound, the gate blocks, and nothing is granted (gate page 6)', () => {
  const variant = (name, damage, { code, spent }) => {
    const t = track(closedRootTree({ cap: 100 }));
    const key = approveFrontier(t.rootDir, ['R/M1']);
    stoppedKid(t, key, 'R/M1', IDS[0], 10, [{ id: 'r1', reservedUsd: 1, settledUsd: 0.6 }]);
    const clean = budgetOf(t.rootDir);
    assert.equal(cents(clean.treeSpentUsd), 0.6, `${name}: one settled call counts once, at what was recorded`);
    damage(t);
    const g = gateTree(t.rootDir);
    const b = budgetOf(t.rootDir, { gate: g });
    assert.equal(g.ok, false, `${name}: a second settled line fails the gate (${codes(g)})`);
    assert.ok(codes(g).includes(code), `${name}: the gate names ${code} (it names ${codes(g)})`);
    assert.equal(cents(b.treeSpentUsd), spent, `${name}: the reservation stays charged at its bound ${spent}, not released to its 0.6 and not counted twice (treeSpent ${b.treeSpentUsd})`);
    assert.ok(b.availableUsd <= clean.availableUsd + MONEY_EPS, `${name}: a duplicate never makes more room`);
    assert.throws(() => topUp(t.rootDir, { node: 'R/M1', amountUsd: 1, ...GATE_FIELDS }), e => e instanceof TreeRefusal, `${name}: no grant while blocked`);
    assert.ok(!events(t.rootDir).some(e => e.event === 'grant_issued'), `${name}: nothing granted`);
    return { problems: codes(g), spent: cents(b.treeSpentUsd) };
  };
  const file = t => join(t.runsDir, IDS[0], 'spend-reservations.jsonl');
  const dup = settledLine('r1', 'recorded', 0.6);
  const got = {
    'run file only': variant('run file only', t => appendFileSync(file(t), `${JSON.stringify(dup)}\n`), { code: 'settled_twice', spent: 1 }),
    'mirror only': variant('mirror only', t => appendTreeEvent(t.rootDir, { event: 'reservation_mirrored', runId: IDS[0], node: 'R/M1', generation: 1, line: dup }), { code: 'settled_twice', spent: 1 }),
    both: variant('both', t => { appendFileSync(file(t), `${JSON.stringify(dup)}\n`); appendTreeEvent(t.rootDir, { event: 'reservation_mirrored', runId: IDS[0], node: 'R/M1', generation: 1, line: dup }); }, { code: 'settled_twice', spent: 1 }),
  };
  assert.ok(Object.keys(got).length === 3, JSON.stringify(got));
});

// ------------------------------------------------------------------------------------------------------------------------------- sequencing (gate page 9 T3)
test('sequencing known-bad: a hand-written registration of a child BEFORE its parent closed is refused by the table, and nothing is registered', () => {
  const t = track(newTree({ cap: 100 }));
  registerRoot(t.rootDir);                                                                   // R@g1 is registered and ACTIVE: it has not closed
  syntheticRun(t, ROOT_ID, {});
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R', ROOT_ID, process.pid, 1, hostnameOf()) });
  const n0 = events(t.rootDir).filter(e => e.event === 'node_registered').length;
  assert.throws(() => { const key = approveFrontier(t.rootDir, ['R/M1']); registerKid(t, key, 'R/M1', IDS[0], 10); }, e => e instanceof TreeRefusal, 'refused at the preview or at the registration');
  assert.equal(events(t.rootDir).filter(e => e.event === 'node_registered').length, n0, 'no child was registered');
  assert.ok(!stateOf(readTreeRecord(t.rootDir)).nodes.has('R/M1@g1'));
  assertInvariant(t.rootDir, 'after the refusal');
});

/** A tree whose root is RUNNING (not closed) and whose events.jsonl then receives a preview, an approval and a child registration written straight to the file (the table never saw them). -> { t, verdict }. */
function handWrittenChild(grantUsd) {
  const donor = track(closedRootTree({ cap: 100 }));                                          // a donor tree supplies well-formed lines
  const dkey = approveFrontier(donor.rootDir, ['R/M1']); registerKid(donor, dkey, 'R/M1', IDS[0], grantUsd);
  const donorLines = events(donor.rootDir).filter(e => e.event === 'frontier_previewed' || e.event === 'frontier_approved' || (e.event === 'node_registered' && e.node === 'R/M1'));
  assert.deepEqual(donorLines.map(e => e.event), ['frontier_previewed', 'frontier_approved', 'node_registered']);
  const t = track(newTree({ cap: 100 }));
  registerRoot(t.rootDir); syntheticRun(t, ROOT_ID, {});
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R', ROOT_ID, process.pid, 1, hostnameOf()) });
  let next = Math.max(...events(t.rootDir).map(e => Number(e.id.slice(1))));
  for (const l of donorLines) appendFileSync(join(treeDirOf(t.rootDir), EVENTS_FILE), `${JSON.stringify({ ...l, id: `e${++next}` })}\n`);
  const rec = readTreeRecord(t.rootDir);
  const state = stateOf(rec);
  const g = gateTree(t.rootDir);
  const b = budgetOf(t.rootDir, { gate: g });
  return { t, verdict: { corrupt: rec.corrupt.map(c => c.reason), sticky: [...state.sticky.keys()], rootPhase: state.nodes.get('R@g1').phase, childPhase: state.nodes.get('R/M1@g1')?.phase ?? null, active: state.active, gateOk: g.ok, gate: codes(g), heldUsd: b.heldUsd, availableUsd: b.availableUsd } };
}

test('sequencing known-bad, HAND-WRITTEN: a preview, an approval and a child registration appended straight to events.jsonl while the parent is still running - the READ still accepts the registration as a record (a finding, pinned), but a grant above the cap now FAILS THE GATE (over_committed, budget commit 1; EDITED from "gate passes"), and a member start and an admission are still refused', async () => {
  const small = handWrittenChild(10);
  const big = handWrittenChild(150);                                                          // a grant above the whole cap: admission would refuse it, the file does not
  const started = await api.run({ chain: small.t.childChain, task: 'tasks/x.md', cwd: small.t.work, runId: IDS[0], treeNode: lineageFile(small.t.work, 'R/M1'), maxUsd: 5 });
  const grant = () => { try { topUp(small.t.rootDir, { node: 'R/M1', amountUsd: 1, ...GATE_FIELDS }); return 'granted'; } catch (e) { return e instanceof TreeRefusal ? `refused:${e.code}:${e.message}` : `other:${e.name}:${e.message}`; } };
  const grantBeforeStart = grant();
  const v = small.verdict; const w = big.verdict;
  // FINDING, pinned: the READ accepts a child registered before its parent closed (the transition table only runs on WRITE; a hand-written file is the same-account class, Astra #2); since budget commit 1 the GATE refuses a grant above the whole cap (over_committed)
  assert.deepEqual([v.corrupt, v.sticky, v.rootPhase, v.childPhase, v.gateOk, v.gate, v.heldUsd, v.availableUsd], [[], [], 'running', 'registered', false, ['over_committed'], 110, -10], 'a hand-written registration is read as a normal one and its grant is held - on top of the running root\'s hold of the whole cap (the root-hold fix; EDITED, old: gate passes, held 10, available 90): ANY child registered while the root runs over-commits');
  assert.deepEqual([w.corrupt, w.gateOk, w.gate, w.heldUsd, w.availableUsd], [[], false, ['over_committed'], 250, -150], 'a grant above the cap is read and held in full (available is negative) but the gate now FAILS CLOSED with over_committed (budget commit 1; at commit 0 it passed)');
  // what keeps the money bounded: the member of such a child cannot start - the gate refuses first (the running root holds the whole cap, so the registration over-commits; before the root-hold fix the ancestor check refused: parent_changed, report_missing) - and a later claim is clamped by lifetimeCapOf
  assert.equal(started.exitCode, 19);
  assert.match(String(started.outputTail), /accounting_blocked/); assert.match(String(started.outputTail), /over_committed/); assert.match(String(started.outputTail), /Nothing was run and nothing was spent/);      // EDITED, the root-hold fix (disclosed; old: parent_changed / report_missing, the ancestor check): the gate refuses first now
  // and no admission can be made on top of it: the gate fails first now (EDITED, the root-hold fix; old: the table refused because the node is NOT STOPPED, "a top-up follows a budget stop")
  assert.match(grantBeforeStart, /^refused:continuation_refused:.*the accounting gate fails \(over_committed\)/, 'a top-up is refused by the gate, read BEFORE the member start wrote anything');
  assert.match(grant(), /^refused:continuation_refused:.*the accounting gate fails \(over_committed\)/, 'and the same after the failed member start');
});

// ------------------------------------------------------------------------------------------------------------------------------- two processes admit at once (gate page 9 T1; 12.2 (i))
test('two PROCESSES admit at the same moment with a sum above what is free: only the admissible subset is granted, the other is refused with a recorded reason, and the invariant holds afterwards - in both orders and four rounds (gate page 3, 12.2 (i))', async () => {
  for (let round = 0; round < 4; round += 1) {
    const t = track(closedRootTree({ cap: 10 }));
    const key = approveFrontier(t.rootDir, ['R/M1', 'R/M2', 'R/M3']);
    stoppedKid(t, key, 'R/M1', IDS[0], 2, [{ id: 'r1', reservedUsd: 2, settledUsd: 2 }]);
    stoppedKid(t, key, 'R/M2', IDS[1], 2, [{ id: 'r1', reservedUsd: 2, settledUsd: 2 }]);
    const free = budgetOf(t.rootDir).availableUsd;
    assert.equal(cents(free), 6, 'the base: cap 10, spent 4, no unspent grant');
    const goFile = join(t.work, 'go');
    // a sitting registers a child with a grant of 4 while a terminal top-up gives 4 to R/M1: 4 + 4 > 6
    const child = { frontierKey: key, node: 'R/M3', generation: 1, runId: IDS[2], parentRunId: ROOT_ID, chain: { name: t.childChain, sha256: chainSha(t.childChain) }, grant: { amount: 4, unit: 'usd' }, bundleSha256: 'c'.repeat(64), bundleBytes: 10 };
    const jobs = [{ kind: 'register', rootDir: t.rootDir, child }, { kind: 'topup', rootDir: t.rootDir, top: { node: 'R/M1', generation: 1, amountUsd: 4, ...GATE_FIELDS } }];
    if (round % 2) jobs.reverse();
    const pending = runWorkers(jobs, goFile);
    await Promise.all(pending.ready);
    writeFileSync(goFile, 'go');
    const results = await Promise.all(pending.results);
    const wins = results.filter(r => r.ok);
    assert.equal(wins.length, 1, `round ${round}: exactly one of two 4-dollar admissions fits 6 (${JSON.stringify(results)})`);
    assert.equal(results.filter(r => !r.ok)[0].code, 'continuation_refused', `round ${round}: the loser is refused with the budget reason`);
    const ev = events(t.rootDir);
    const registered = ev.filter(e => e.event === 'node_registered' && e.node === 'R/M3').length;
    const granted = ev.filter(e => e.event === 'grant_issued').length;
    assert.equal(registered + granted, 1, `round ${round}: one registration or one grant on the record, never both`);
    assert.ok(ev.some(e => e.event === 'blocked' && e.reason === 'continuation_refused'), `round ${round}: the refusal is recorded`);
    const b = assertInvariant(t.rootDir, `round ${round}`);
    assert.equal(cents(b.availableUsd), 2, `round ${round}: 6 free minus the 4 that was admitted`);
  }
});

// ------------------------------------------------------------------------------------------------------------------------------- a RUNNING member while another process admits (gate page 12.2 (ii))
const MEMBER_WORKER = `
const api = await import(${JSON.stringify(srcUrl('api.js'))});
// every chunk the member writes passes through onOutput (src/api.js runCli), not only the last 40 lines outputTail keeps: the ceiling line is written once, early, and a whole run's log would push it out of a tail
let ceiling = false;
const r = await api.run({ ...JSON.parse(process.argv[1]), onOutput: s => { if (/mock hold: ceiling reached/.test(s)) ceiling = true; } });
process.stdout.write(JSON.stringify({ exitCode: r.exitCode, ceiling }) + '\\n');
`;

/** The scenario of gate page 12.2 (ii). `parentDelayMs` is a FORCED SLOW PARENT (0 = none): the old shape lost the window to a slow parent, the hold keeps the window open whatever the delay. */
async function memberRunningScenario({ parentDelayMs = 0 }) {
  const t = track(newTree({ cap: 100 }));
  registerRoot(t.rootDir);
  const root = await api.run(rootOpts(t));
  assert.equal(root.exitCode, 0, root.outputTail);
  const key = approveFrontier(t.rootDir, ['R/M1', 'R/M2']);
  registerKid(t, key, 'R/M1', IDS[0], 40);
  const stop = await api.run({ chain: t.childChain, task: 'tasks/x.md', cwd: t.work, runId: IDS[0], treeNode: lineageFile(t.work, 'R/M1'), maxUsd: 9 });
  assert.equal(stop.exitCode, 4, stop.outputTail);                                           // R/M1 is budget-stopped: spent about 9, holds the rest of its 40
  registerKid(t, key, 'R/M2', IDS[1], 40);
  const before = assertInvariant(t.rootDir, 'before the member runs');
  const room = before.availableUsd;
  assert.ok(room > 5 && room < 40, `the base leaves a little room to fight over (${room})`);
  // SEAM-2 (C&C 14 Oct 2026; no signal, no source change): the member's mock calls are HELD in flight by the existing mock hold seam (src/providers.js COUNCIL_MOCK_HOLD_FILE, used by advice-tools, stop-rule and side-run-stages): a call waits until THIS file
  // exists. The parent creates it only after it has decided an admission, so the member cannot finish first - by construction, however slow this parent is. The env reaches the real member through api.run's `env` (runCli merges it into the member's environment).
  const releaseFile = join(t.work, 'member-release.flag');
  rmSync(releaseFile, { force: true });
  const member = new Promise((res, rej) => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', MEMBER_WORKER, JSON.stringify({ chain: t.childChain, task: 'tasks/x.md', cwd: t.work, runId: IDS[1], treeNode: lineageFile(t.work, 'R/M2'), env: { COUNCIL_MOCK_HOLD_FILE: releaseFile } })], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
    p.on('error', rej);
    p.on('close', code => { const line = out.split('\n').filter(l => l.startsWith('{')).at(-1); code === 0 && line ? res(JSON.parse(line)) : rej(new Error(`member exited ${code}: ${err || out}`)); });
  });
  let done = false; member.finally(() => { done = true; });
  // admissions begin only once the member's claim is on the record (the claim is appended BEFORE the chain's first call: src/cli.js memberStart, then runChain), so they happen while the member is held inside its first mock call
  for (let i = 0; i < 6000 && !done && !events(t.rootDir).some(e => e.event === 'node_started' && e.node === 'R/M2'); i += 1) await new Promise(r => setTimeout(r, 5));
  const outcomes = [];
  // THE SEAM (this test failed once in 90 suites, then its SIGSTOP interim hung a box set when the frozen member held the tree lock): the member is HELD by the release file, the parent decides admissions however slowly (`parentDelayMs`), and only then creates
  // the file. A momentary RunLockedError (the member's claim append may still hold the tree lock for a moment) is retried; the assertions below are UNCHANGED.
  let decided = 0;
  if (parentDelayMs) await new Promise(r => setTimeout(r, parentDelayMs));
  for (let i = 0; i < 2000 && decided < 3; i += 1) {
    try { topUp(t.rootDir, { node: 'R/M1', generation: 1, amountUsd: 3, ...GATE_FIELDS }); outcomes.push('granted'); decided += 1; }
    catch (e) {
      if (e instanceof TreeRefusal) { outcomes.push(e.code); decided += 1; }
      else if (e?.name === 'RunLockedError') { outcomes.push('other:RunLockedError'); await new Promise(r => setTimeout(r, 5)); }
      else { outcomes.push(`other:${e.name}`); }
    }
  }
  writeFileSync(releaseFile, '');                                                           // existence only: the seam never reads it
  assert.ok(decided >= 1, 'an admission was decided while the member was held');
  for (let i = 0; i < 400 && !done; i += 1) {
    try { topUp(t.rootDir, { node: 'R/M1', generation: 1, amountUsd: 3, ...GATE_FIELDS }); outcomes.push('granted'); } catch (e) { outcomes.push(e instanceof TreeRefusal ? e.code : `other:${e.name}`); }
    await new Promise(r => setTimeout(r, 5));
  }
  const res = await member;
  assert.equal(res.ceiling, false, 'the hold was released by the parent, never by its 60 s ceiling (the member\'s stderr is read chunk by chunk: providers.js holdMockCall process.stderr.write -> api.js runCli child.stderr take() -> onOutput)');
  assert.ok([0, 4].includes(res.exitCode), `the member ended on its own terms (exit ${res.exitCode})`);
  assert.ok(outcomes.length > 0 && outcomes.every(o => o === 'granted' || o === 'continuation_refused' || o === 'other:RunLockedError'), `only grants and budget refusals: ${JSON.stringify([...new Set(outcomes)])}`);
  const after1 = assertInvariant(t.rootDir, 'after the member ended');
  const ev = events(t.rootDir);
  const claims = ev.filter(e => e.event === 'node_started' && e.node === 'R/M2');
  assert.ok(claims.length >= 1);
  // the admissions really overlapped the running member: a grant sits on the record between the member's claim and its end
  const idx = f => ev.findIndex(f);
  const started = idx(e => e.event === 'node_started' && e.node === 'R/M2');
  const ended = idx(e => (e.event === 'node_closed' || e.event === 'node_stopped') && e.node === 'R/M2');
  const grantsDuring = ev.slice(started + 1, ended < 0 ? undefined : ended).filter(e => e.event === 'grant_issued' || (e.event === 'blocked' && e.check === 'top_up')).length;
  assert.ok(started >= 0 && ended > started && grantsDuring >= 1, `an admission (granted or refused) was decided while the member ran: ${grantsDuring} between lines ${started} and ${ended}`);
  const m2 = after1.nodes.find(n => n.key === 'R/M2@g1');
  const lifetimeCap = Math.min(...claims.map(c => c.lifetimeCapUsd));
  assert.ok(Number.isFinite(lifetimeCap) && lifetimeCap > 0, `the claim records its lifetime cap (lifetimeCapUsd ${lifetimeCap})`);
  assert.ok(m2.spentUsd <= lifetimeCap + MONEY_EPS, `the member spent ${m2.spentUsd}, its claimed lifetime cap was ${lifetimeCap}`);
  assert.ok(m2.spentUsd <= m2.grantUsd + MONEY_EPS, 'and never above its own grant');
}

test('a real member RUNNING in its own process while another process tops up a stopped sibling again and again: every refusal is a budget refusal, the member stays inside its lifetime cap, and settled + outstanding + unspent grants never exceed the cap (gate page 12.2 (ii))' , async () => { await memberRunningScenario({ parentDelayMs: 0 }); });
test('the same, with a FORCED SLOW PARENT (it waits 3 s after the member\'s claim before its first admission): the member is held, so the admission still lands inside its start..end window (this is the race of the old shape, reproduced on demand)', { timeout: 120_000 }, async () => { await memberRunningScenario({ parentDelayMs: 3000 }); });

// ------------------------------------------------------------------------------------------------------------------------------- the ROOT HOLD (gate page 12.1): a running root generation holds grant - spent like a child

test('ROOT HOLD (the root-hold fix; EDITED from the commit-0 KNOWN HAZARD pin, which asserted heldUsd 0): a registered, running R@g2 holds its grant, so `available` no longer contains the dollars it was granted and a second admission is offered only what is really free (gate page 12.1)', async () => {
  const r = await trackedRealRoot();
  const stop = appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'node_closed', affected: [{ node: 'R', generation: 1 }] });
  const p = rootReplanPreflight(r.t.rootDir, { work: r.t.work, sittingHeld: () => false });
  assert.equal(p.ok, true, JSON.stringify(p.refusal));
  const dec = appendTreeEvent(r.t.rootDir, { event: 'decision_recorded', text: 'Plan the whole task again.', form: 'regenerate', stopId: stop.id, replansRoot: true, affected: [{ node: 'R', generation: 1 }], ...GATE_FIELDS });
  appendTreeEvent(r.t.rootDir, { event: 'generation_opened', decisionId: dec.id, nodes: [{ node: 'R', generation: 2 }] });
  const bundle = rootBundle({ treeId: ROOT_ID, generation: 2, decisions: [{ id: dec.id, text: 'Plan the whole task again.' }], taskText: p.task.text }); writeRootBundle(r.t.rootDir, bundle);
  const bound = 'f'.repeat(64);
  appendTreeEvent(r.t.rootDir, { event: 'frontier_previewed', kind: 'root_replan', openedBy: dec.id, frontierKey: 'kRoot', parentNode: null, parentGeneration: null, parentRunId: null, splitSha256: null, children: [{ node: 'R', generation: 2 }], boundSha256: bound });
  appendTreeEvent(r.t.rootDir, { event: 'frontier_approved', ...GATE_FIELDS, boundSha256: bound, frontierKey: 'kRoot', revision: 1 });
  const ev = registerRootReplan(r.t.rootDir, { generation: 2, frontierKey: 'kRoot', bundle, chain: p.chain, previous: p.previous, taskSha256: p.task.taskSha256, capUsd: p.chain.figures.atMostUsd });
  syntheticRun(r.t, ev.runId, {});                                                        // the member\'s run folder (a started member without one fails the accounting gate)
  appendTreeEvent(r.t.rootDir, { event: 'node_started', node: 'R', generation: 2, runId: ev.runId, pid: process.pid, host: hostnameOf() });
  assert.equal(stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R@g2').phase, 'running');
  const b = budgetOf(r.t.rootDir);
  const g2 = b.nodes.find(n => n.key === 'R@g2');
  assert.ok(g2.grantUsd > 0 && g2.spentUsd === 0, `R@g2 holds a real grant (${g2.grantUsd}) and has spent nothing yet`);
  // THE FIX: the grant is held
  assert.equal(cents(g2.heldUsd), cents(g2.grantUsd), 'a running root generation holds grant - spent (here all of it) like a child');
  assert.equal(cents(b.availableUsd), cents(b.rootCapUsd - b.treeSpentUsd - b.unknownSpendHeldUsd - g2.grantUsd), 'the grant of the running R@g2 is subtracted from available');
  assert.equal(cents(b.availableUsd + b.heldUsd + b.treeSpentUsd + b.unknownSpendHeldUsd), cents(b.rootCapUsd), 'spent + held + available is the cap: the pool is disjoint');
  const again = proposeGrants({ availableUsd: b.availableUsd, children: [{ id: 'x', atMostUsd: 1e6, cheapestUsd: 0.01 }] });
  assert.equal(cents(again[0].grantUsd), cents(b.availableUsd), 'a second admission that wants everything is offered exactly what is free ...');
  assert.equal(cents(b.rootCapUsd - b.treeSpentUsd - b.unknownSpendHeldUsd - again[0].grantUsd), cents(g2.grantUsd), '... which is the old offer (cap - spent) minus the dollars R@g2 holds: the same dollars are not offered twice');
  assertInvariant(r.t.rootDir, 'a running R@g2');
  // a hand-called admission of the same dollars: a top-up for R@g2 itself, equal to its grant, is still refused by the table (R@g2 is not stopped)
  const before = events(r.t.rootDir).length;
  let handCalled;
  try { topUp(r.t.rootDir, { node: 'R', generation: 2, amountUsd: g2.grantUsd, ...GATE_FIELDS }); handCalled = 'granted'; } catch (e) { handCalled = e instanceof TreeRefusal ? `refused:${e.code}:${e.transition}:${e.message}` : `other:${e.name}:${e.message}`; }
  assert.match(handCalled, /^refused:transition_refused:grant_issued:.*R@g2 is not stopped; a top-up follows a budget stop/, `a hand-called top-up equal to R@g2's grant (${events(r.t.rootDir).length - before} lines written)`);
  // while R@g2 is active the table refuses the PREVIEW of any other frontier, so no second node can be approved, let alone registered
  assert.throws(() => approveFrontier(r.t.rootDir, ['R/M9'], { generation: 2, parentGeneration: 2 }), e => e instanceof TreeRefusal && e.transition === 'frontier_previewed' && /R@g2 is active/.test(e.message), 'a second frontier cannot be previewed while R@g2 is active');
  // what the fix PRESERVES: the running root\'s own lifetime cap is its grant (its own hold is not counted against itself)
  const life = lifetimeCapOf(b, 'R@g2');
  assert.equal(cents(life.lifetimeCapUsd), cents(g2.grantUsd), 'R@g2\'s own lifetime cap is its grant');
});

test('a ROOT holds cap - spent for as long as it is not closed (registered, running, stopped): available is 0 while it runs and the whole remainder is free again once it closes; the invariant holds throughout', () => {
  const t = track(newTree({ cap: 30 }));
  registerRoot(t.rootDir);
  assert.deepEqual([budgetOf(t.rootDir).rootCapUsd, budgetOf(t.rootDir).heldUsd, budgetOf(t.rootDir).availableUsd], [30, 30, 0], 'a registered root holds the cap it was granted');
  syntheticRun(t, ROOT_ID, { usage: [{ file: 'stage-r1', usd: 2, reservationId: 'r1' }] });
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R', ROOT_ID, process.pid, 1, hostnameOf()) });
  writeLines(t, ROOT_ID, 'R', [reservedLine('r1', 2.5, 'stage-r1'), settledLine('r1', 'recorded', 2), reservedLine('r2', 1.5, 'stage-r2')], { generation: 1 });
  const run = budgetOf(t.rootDir);
  assert.deepEqual([cents(run.treeSpentUsd), cents(run.heldUsd), cents(run.availableUsd)], [3.5, 26.5, 0], 'running: spent 2 + 1.5 in flight; the rest of the cap is held by the root; nothing else is free');
  assertInvariant(t.rootDir, 'a running root');
  appendTreeEvent(t.rootDir, { event: 'node_stopped', node: 'R', generation: 1, runId: ROOT_ID, reason: 'budget' });
  assert.deepEqual([cents(budgetOf(t.rootDir).heldUsd), cents(budgetOf(t.rootDir).availableUsd)], [26.5, 0], 'a stopped root is not closed: its grant stays held (like a stopped child)');
  assert.throws(() => topUp(t.rootDir, { node: 'R', amountUsd: 1, ...GATE_FIELDS }), e => e instanceof TreeRefusal && /only 0\.0000 of the root cap is free/.test(e.message), 'a root that already holds the whole cap cannot be topped up beyond it');
  assertInvariant(t.rootDir, 'a stopped root');
});

test('a CLOSED root holds nothing again (its spend stays counted); and the amendment floor sees a live root\'s room: below the cap a running root may still spend is refused, a raise is accepted', () => {
  const closed = track(closedRootTree({ cap: 30 }));
  assert.deepEqual([budgetOf(closed.rootDir).heldUsd, budgetOf(closed.rootDir).availableUsd], [0, 30], 'a closed root holds nothing');
  const t = track(newTree({ cap: 10 }));
  registerRoot(t.rootDir); syntheticRun(t, ROOT_ID, {});
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R', ROOT_ID, process.pid, 1, hostnameOf()) });
  assert.throws(() => amendCap(t.rootDir, { toCapUsd: 8, expectedRevision: 1, ...GATE_FIELDS }), e => e instanceof TreeRefusal && /below the 10\.00 already committed.*the lowest total accepted now is 10\.00/.test(e.message), 'a running root may spend up to its whole cap: the floor is the cap');
  amendCap(t.rootDir, { toCapUsd: 14, expectedRevision: 1, ...GATE_FIELDS });
  assert.equal(cents(budgetOf(t.rootDir).availableUsd), 4, 'a raise is free to admit; the root keeps its claimed room');
});

// ------------------------------------------------------------------------------------------------------------------------------- R9 holds for a ROOT exactly as for a child (the unreturnedUsd fix; C&C 14 Oct)
const closeWithReturn = (t, node, runId, returnedUsd) => appendTreeEvent(t.rootDir, { event: 'node_closed', node, generation: 1, runId, outcome: 'passed', passed: true, status: 'ready_for_build', share: 'released', returnedUsd });

test('R9 for a ROOT, as for a child: a node closed with a returnedUsd below its unspent grant (its spend could not be read) keeps holding the part it did not give back - the same formula, so a dollar that may have been spent is never shown as free (EDITED scope of R9: before, a root released its whole remainder)', () => {
  // the child case, as it has always been: grant 10, spent 2, closed with returnedUsd 0 -> 8 unreturned
  const c = track(closedRootTree({ cap: 30 }));
  const key = approveFrontier(c.rootDir, ['R/M1']);
  registerKid(c, key, 'R/M1', IDS[0], 10);
  appendTreeEvent(c.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) });
  spend(c, 'R/M1', IDS[0], [{ id: 'r1', reservedUsd: 2, settledUsd: 2 }]);
  closeWithReturn(c, 'R/M1', IDS[0], 0);
  const cb = budgetOf(c.rootDir);
  assert.deepEqual([cents(cb.unknownSpendHeldUsd), cb.unknownSpendNodes, cents(cb.treeSpentUsd), cents(cb.availableUsd)], [8, 1, 2, 20], 'a child: 10 granted - 2 spent - 0 returned = 8 held as unknown');
  // the ROOT case: grant 30 (the cap), spent 2, closed with returnedUsd 0 -> 28 unreturned
  const r = track(newTree({ cap: 30 }));
  registerRoot(r.rootDir);
  appendTreeEvent(r.rootDir, { event: 'node_started', ...claim('R', ROOT_ID, process.pid, 1, hostnameOf()) });
  spend(r, 'R', ROOT_ID, [{ id: 'r1', reservedUsd: 2, settledUsd: 2 }]);
  closeWithReturn(r, 'R', ROOT_ID, 0);
  const rb = budgetOf(r.rootDir);
  assert.deepEqual([cents(rb.unknownSpendHeldUsd), rb.unknownSpendNodes, cents(rb.treeSpentUsd), cents(rb.availableUsd)], [28, 1, 2, 0], 'a root: 30 granted - 2 spent - 0 returned = 28 held as unknown; nothing is shown as free');
  assertInvariant(r.rootDir, 'a closed root with an unreadable spend');
});

test('the amendment floor counts a closed root\'s unreturned part: with 28 held for a spend that cannot be read and 2 spent, a total below 30 is refused and 31 is accepted', () => {
  const r = track(newTree({ cap: 30 }));
  registerRoot(r.rootDir);
  appendTreeEvent(r.rootDir, { event: 'node_started', ...claim('R', ROOT_ID, process.pid, 1, hostnameOf()) });
  spend(r, 'R', ROOT_ID, [{ id: 'r1', reservedUsd: 2, settledUsd: 2 }]);
  closeWithReturn(r, 'R', ROOT_ID, 0);
  assert.throws(() => amendCap(r.rootDir, { toCapUsd: 29, expectedRevision: 1, ...GATE_FIELDS }), e => e instanceof TreeRefusal && /below the 30\.0+ already committed.*the lowest total accepted now is 30\.0+/.test(e.message));
  amendCap(r.rootDir, { toCapUsd: 31, expectedRevision: 1, ...GATE_FIELDS });
  assert.equal(cents(budgetOf(r.rootDir).availableUsd), 1);
});
