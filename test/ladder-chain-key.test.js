// The permanent ladder (0.8.4, the ladder unit, commit 2): a chain whose FILE carries `"ladder": { "block": N, "visits": M }` runs the ladder with no flag. Layer 1 revises in blocks of N, layer 2 gets M visits, layer 3 has no number, and a ladder run has no
// pass ceiling. A chain without the key runs as it always did (a typed --ladder on it is the old ladder, cap included). Offline, $0: scripted mock judges through the real CLI, small chains of this test. Every looping fixture carries its own bound (`maxRounds`,
// or a judge that stops objecting): nothing here can run forever.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { roundLimitsOf, advance, newRoundState } from '../src/overseer-rounds.js';
import { fingerprintInputs } from '../src/cache-integrity.js';
import { lintChain } from '../src/chain-lint.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const critics = (l1, l2, l3, id) => [
  { provider: 'mock', model: `mock-critic-${l1}-${id}1`, lab: 'l1', layer: 1 },
  { provider: 'mock', model: `mock-critic-${l2}-${id}2`, lab: 'l2', layer: 2 },
  { provider: 'mock', model: `mock-critic-${l3}-${id}3`, lab: 'l3', layer: 3 }];
const keyed = (critic, ladder, over = {}, writer = { provider: 'mock', model: 'mock-builder', lab: 'author' }) => ({
  name: 'lad', signoff: 'unanimous', ladder, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: writer, reviser: writer, critics: critic }, ...over,
});
const project = config => {
  const dir = mkdtempSync(join(tmpdir(), 'lad-key-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'lad.json'), JSON.stringify(config));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const run = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  const runDir = () => join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  return { dir, run, runDir, done: () => rmSync(dir, { recursive: true, force: true }) };
};
const reportOf = dir => JSON.parse(readFileSync(join(dir, existsSync(join(dir, 'report.json')) ? 'report.json' : 'report-partial.json'), 'utf8'));
const askedOf = report => { const by = {}; for (const r of report.layers) if (r.state !== 'not_asked') (by[r.round] ||= []).push(r.layer); return Object.keys(by).map(Number).sort((a, b) => a - b).map(n => by[n]); };
const lowest = report => askedOf(report).map(a => a[0]);
const kinds = (cfg, k) => lintChain(cfg, 'chains/x.json').filter(f => f.kind === k);

test('LK-1: a chain with the ladder key reads as a ladder chain with no layer-3 count and no pass ceiling; a chain with the old keys reads as it always did; the lint refuses a bad key', () => {
  const c = keyed(critics('script-x', 'script-x', 'script-x', 'a'), { block: 2, visits: 3 });
  assert.deepEqual(roundLimitsOf(c), { passes: null, overseer: null, layerRevisions: null, ladder: { block: 2, visits: 3 } });
  assert.deepEqual(roundLimitsOf({ ...c, maxRounds: 18 }).passes, 18, 'the person\'s own pass bound stands beside the key');
  const old = { ...c, ladder: undefined, maxOverseerRounds: 3, layerRevisions: { 1: 3, 2: 3 } };
  delete old.ladder;
  // The factor 3 stays (the lone-heard pass of layer 1 keeps its two re-ask passes, 10 Nov 2026): passes 3 * 7 * 3 = 63, as before the solo ask. (The round before had moved it to 21; moved back.)
  assert.deepEqual(roundLimitsOf(old), { passes: 3 * 7 * 3, overseer: 3, layerRevisions: { 1: 3, 2: 3 } });
  assert.deepEqual(kinds(c, 'invalid-ladder'), []);
  for (const bad of [{ block: 0, visits: 3 }, { block: 3 }, { block: 3, visits: 3, layer3: 4 }, 'x', [3, 3], { block: 1.5, visits: 3 }]) assert.equal(kinds(keyed(c.seats.critics, bad), 'invalid-ladder').length, 1, JSON.stringify(bad));
  assert.equal(kinds({ ...c, maxOverseerRounds: 3, layerRevisions: { 1: 3, 2: 3 } }, 'invalid-ladder').length, 1, 'the key and the two old keys cannot both be answers');
  assert.equal(kinds(keyed(c.seats.critics.slice(0, 2), { block: 3, visits: 3 }), 'invalid-ladder').length, 1, 'two layers: no ladder');
});

test('LK-2: the key\'s numbers set the run: block 2 and 2 layer-2 visits give the cycle 1,1,2,1,1,2,1,1,3; block 3 (the swapped input) gives the cycle of three; the run saves its own numbers in run.json', () => {
  const twoTwo = project(keyed(critics('script-x', 'script-x', 'script-x', 'b'), { block: 2, visits: 2 }, { maxRounds: 18 }));
  const threeThree = project(keyed(critics('script-x', 'script-x', 'script-x', 'c'), { block: 3, visits: 3 }, { maxRounds: 16 }));
  try {
    twoTwo.run(['--chain', 'lad', '--task', 'tasks/t.md']);
    assert.deepEqual(lowest(reportOf(twoTwo.runDir())), [1, 1, 2, 1, 1, 2, 1, 1, 3, 1, 1, 2, 1, 1, 2, 1, 1, 3]);
    assert.deepEqual(JSON.parse(readFileSync(join(twoTwo.runDir(), 'run.json'), 'utf8')).ladder, { block: 2, visits: 2, credit: 0, exchange: 0 });
    threeThree.run(['--chain', 'lad', '--task', 'tasks/t.md']);
    assert.deepEqual(lowest(reportOf(threeThree.runDir())), [1, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 3]);
  } finally { twoTwo.done(); threeThree.done(); }
});

test('LK-3: layer 3 has no round count: a ladder chain asks layer 3 a fourth time at pass 64, where the old ladder stopped at its third visit (pass 48); the run ends at the fixture\'s own bound, with no stop', () => {
  const p = project(keyed(critics('script-x', 'script-x', 'script-x', 'd'), { block: 3, visits: 3 }, { maxRounds: 64 }));
  try {
    p.run(['--chain', 'lad', '--task', 'tasks/t.md']);
    const rep = reportOf(p.runDir());
    const cycle = [1, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 3];
    assert.deepEqual(lowest(rep), [...cycle, ...cycle, ...cycle, ...cycle]);
    assert.equal(rep.stop, undefined, 'no layer-3 cap, no stop: the pass bound of the fixture ends it');
  } finally { p.done(); }
});

test('LK-4 (L-4c): a judge that objects in NEW WORDS at every ask never stalls: the run climbs to layer 3 and signs off the moment the fixture\'s judge stops objecting (its own bound: 3 asks); a judge that repeats the same words stalls at its second ask', () => {
  const dispute = { dispute: { enabled: true, stall_rounds: 2 }, maxRounds: 80 };
  const fresh = project(keyed(critics('script-x', 'script-x', 'restless-3', 'e'), { block: 3, visits: 3 }, dispute));
  const same = project(keyed(critics('script-x', 'script-x', 'script-x', 'f'), { block: 3, visits: 3 }, dispute));
  try {
    const r = fresh.run(['--chain', 'lad', '--task', 'tasks/t.md']);
    assert.equal(r.status, 22, r.stdout + r.stderr);
    const rep = reportOf(fresh.runDir());
    assert.equal(rep.stop, undefined, 'no stop of any kind: nothing stalled');
    assert.deepEqual(rep.escalated_signoff, { pass: 64, layer: 3, overseer_round: 4, below: [1, 2], ladder: true });
    same.run(['--chain', 'lad', '--task', 'tasks/t.md']);
    assert.deepEqual([reportOf(same.runDir()).stop.kind, reportOf(same.runDir()).stop.pass], ['stall_stop', 32], 'the same chain with a judge that repeats itself ends at the stall stop (the swapped input)');
  } finally { fresh.done(); same.done(); }
});

test('LK-5: a typed --rounds N on a ladder run is N overseer rounds (N layer-3 verdicts), the meaning it has on any layered chain; the overseer_cap stop asks at it; it is saved as run.json ladderRounds and the chain\'s round fields stay untouched', () => {
  const two = project(keyed(critics('script-x', 'script-x', 'script-x', 'g'), { block: 3, visits: 3 }));
  const one = project(keyed(critics('script-x', 'script-x', 'script-x', 'g2'), { block: 3, visits: 3 }));
  try {
    const r = two.run(['--chain', 'lad', '--task', 'tasks/t.md', '--rounds', '2']);
    assert.equal(r.status, 23, r.stdout + r.stderr);
    const rep = reportOf(two.runDir());
    assert.deepEqual({ kind: rep.stop.kind, rounds: rep.stop.rounds, cap: rep.stop.cap, pass: rep.stop.pass }, { kind: 'overseer_cap', rounds: 2, cap: 2, pass: 32 });
    const saved = JSON.parse(readFileSync(join(two.runDir(), 'run.json'), 'utf8'));
    assert.deepEqual([saved.ladderRounds, saved.rounds], [2, undefined]);
    one.run(['--chain', 'lad', '--task', 'tasks/t.md', '--rounds', '1']);
    assert.deepEqual([reportOf(one.runDir()).stop.kind, reportOf(one.runDir()).stop.cap, reportOf(one.runDir()).stop.pass], ['overseer_cap', 1, 16], 'the swapped input: the bound is the number typed');
  } finally { two.done(); one.done(); }
});

test('LK-14 (his word on --rounds): the stop after the Nth top-layer read ASKS; --continue goes on to the next read and stops again (cap 3, pass 48); --finish ends it there, not agreed; a --rounds typed at a resume is the TOTAL of reads, replaces the saved number, is refused at or below the reads made, and survives the next plain resume', () => {
  const a = project(keyed(critics('script-x', 'script-x', 'script-x', 'h'), { block: 3, visits: 3 }));
  const b = project(keyed(critics('script-x', 'script-x', 'script-x', 'h2'), { block: 3, visits: 3 }));
  const c = project(keyed(critics('script-x', 'script-x', 'script-x', 'h3'), { block: 3, visits: 3 }));
  try {
    assert.equal(a.run(['--chain', 'lad', '--task', 'tasks/t.md', '--rounds', '2']).status, 23);
    const more = a.run(['--resume', a.runDir(), '--continue']);
    assert.equal(more.status, 23, more.stdout + more.stderr);
    const stop = reportOf(a.runDir()).stop;
    assert.deepEqual([stop.kind, stop.rounds, stop.cap, stop.pass], ['overseer_cap', 3, 3, 48]);
    assert.deepEqual(JSON.parse(readFileSync(join(a.runDir(), 'run.json'), 'utf8')).roundChoices.map(x => [x.choice, x.add]), [['continue', 1]]);
    assert.equal(b.run(['--chain', 'lad', '--task', 'tasks/t.md', '--rounds', '1']).status, 23);
    const low = b.run(['--resume', b.runDir(), '--rounds', '1', '--continue']);
    assert.equal(low.status, 2, 'a number at or below the reads already made is refused, before any call');
    assert.match(low.stderr, /--rounds 1: this run has already made 1 top-layer read, so 1 is not a limit it can still reach\. Type a number above 1/);
    assert.equal(b.run(['--resume', b.runDir(), '--rounds', '2', '--continue']).status, 23);
    const next = reportOf(b.runDir()).stop;
    assert.deepEqual([next.kind, next.cap, next.pass], ['overseer_cap', 2, 32], 'the typed number is the TOTAL of reads (his word): the continue typed with it answers the stop and adds nothing');
    assert.equal(JSON.parse(readFileSync(join(b.runDir(), 'run.json'), 'utf8')).ladderRounds, 2, 'the typed number is saved');
    assert.equal(b.run(['--resume', b.runDir(), '--continue']).status, 23);
    assert.deepEqual([reportOf(b.runDir()).stop.cap, reportOf(b.runDir()).stop.pass], [3, 48], 'a plain resume keeps the saved number; its own continue adds one');
    c.run(['--chain', 'lad', '--task', 'tasks/t.md', '--rounds', '1']);
    const fin = c.run(['--resume', c.runDir(), '--finish']);
    assert.notEqual(fin.status, 23, fin.stdout + fin.stderr);
    const done = JSON.parse(readFileSync(join(c.runDir(), 'report.json'), 'utf8'));
    assert.deepEqual([done.passed, done.stop.kind, done.stop.chosen], [false, 'overseer_cap', 'finish']);
  } finally { a.done(); b.done(); c.done(); }
});

test('LK-13: a typed --ladder on a chain with the OLD keys is the same ladder: the chain\'s own maxOverseerRounds (1 here) bounds nothing; only the typed --rounds 3 does (the third layer-3 verdict, pass 48)', () => {
  const old = project({ ...keyed(critics('script-x', 'script-x', 'script-x', 'n'), undefined), ladder: undefined, maxOverseerRounds: 1, layerRevisions: { 1: 3, 2: 3 } });
  try {
    old.run(['--chain', 'lad', '--task', 'tasks/t.md', '--ladder', '--rounds', '3']);
    const rep = reportOf(old.runDir());
    assert.deepEqual([rep.stop.kind, rep.stop.cap, rep.stop.pass], ['overseer_cap', 3, 48]);
    assert.equal(JSON.parse(readFileSync(join(old.runDir(), 'run.json'), 'utf8')).ladderRounds, 3);
  } finally { old.done(); }
});

test('LK-6: a typed --ladder at a fresh start wins over the chain key (the person\'s own numbers: 3 and 3); on a resume the saved numbers stand and a different typed ladder is refused with the numbers named; --ladder-credit is refused on a ladder chain', () => {
  const p = project(keyed(critics('script-x', 'script-x', 'script-x', 'h'), { block: 2, visits: 2 }, { maxRounds: 4 }, { provider: 'external', model: 'claude-code-session' }));
  const q = project(keyed(critics('script-x', 'script-x', 'script-x', 'i'), { block: 2, visits: 2 }, { maxRounds: 4 }));
  try {
    assert.equal(p.run(['--chain', 'lad', '--task', 'tasks/t.md', '--ladder']).status, 3);
    const saved = JSON.parse(readFileSync(join(p.runDir(), 'run.json'), 'utf8')).ladder;
    assert.deepEqual(saved, { block: 3, visits: 3, credit: 0, exchange: 0 }, 'typed --ladder wins at a fresh start');
    const again = p.run(['--resume', p.runDir(), '--ladder', '--ladder-credit', '2']);
    assert.equal(again.status, 2, again.stdout + again.stderr);
    // FINDING (not on the owed list of the ladder unit; the first box run, 10 Nov 2026; first box run). OLD: a resume carrying --ladder --ladder-credit 2 met the credit refusal first. NEW: the saved ladder (credit 0) is compared with the typed one (credit 2) before the credit flag is looked at, so the refusal that comes is the different-ladder one, with the saved numbers named; both are exit 2 with nothing run. The credit refusal on a ladder chain is pinned by the fresh start below.
    assert.match(again.stderr, /--ladder: this run already runs under a ladder \(layer-1 blocks of 3, 3 layer-2 visits, credit 0\)/);
    const r = q.run(['--chain', 'lad', '--task', 'tasks/t.md', '--ladder', '--ladder-credit', '2']);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /--ladder-credit: this chain runs the ladder from its first pass/);
    assert.equal(existsSync(join(q.dir, 'runs')) && readdirSync(join(q.dir, 'runs')).some(d => existsSync(join(q.dir, 'runs', d, 'criteria.md'))), false, 'refused before any stage ran');
  } finally { p.done(); q.done(); }
});

test('LK-7: a run paused at an external stage on a ladder chain saves the chain key\'s numbers; a resume with a different typed ladder is refused naming the saved numbers; a plain resume keeps them', () => {
  const p = project(keyed(critics('script-x', 'script-x', 'script-x', 'j'), { block: 2, visits: 2 }, { maxRounds: 4 }, { provider: 'external', model: 'claude-code-session' }));
  try {
    assert.equal(p.run(['--chain', 'lad', '--task', 'tasks/t.md']).status, 3);
    assert.deepEqual(JSON.parse(readFileSync(join(p.runDir(), 'run.json'), 'utf8')).ladder, { block: 2, visits: 2, credit: 0, exchange: 0 });
    const bad = p.run(['--resume', p.runDir(), '--ladder']);
    assert.equal(bad.status, 2, bad.stdout + bad.stderr);
    assert.match(bad.stderr, /already runs under a ladder \(layer-1 blocks of 2, 2 layer-2 visits, credit 0\)/);
    assert.equal(p.run(['--resume', p.runDir()]).status, 3, 'a plain resume goes on under the saved numbers');
  } finally { p.done(); }
});

test('LK-8: the ladder key is not part of the stage-cache fingerprint (editing it keeps a paused run\'s stages); any other edit still is', () => {
  const a = keyed(critics('script-x', 'script-x', 'script-x', 'k'), { block: 2, visits: 2 });
  const b = keyed(critics('script-x', 'script-x', 'script-x', 'k'), { block: 3, visits: 3 });
  const c = keyed(critics('script-x', 'script-x', 'script-x', 'k'), { block: 2, visits: 2 }, { signoff: 'first' });
  assert.equal(fingerprintInputs('t', a), fingerprintInputs('t', b));
  assert.equal(fingerprintInputs('t', a), fingerprintInputs('t', { ...a, ladder: undefined }), 'a chain with and without the key hash alike');
  assert.notEqual(fingerprintInputs('t', a), fingerprintInputs('t', c));
});

test('LK-9: the chain schema accepts the ladder key and refuses a bad one', () => {
  const schema = JSON.parse(readFileSync(join(root, 'config', 'chain-schema.json'), 'utf8'));
  const validate = new Ajv({ allErrors: true }).compile(schema);
  const base = keyed(critics('script-x', 'script-x', 'script-x', 'l'), { block: 3, visits: 3 });
  assert.equal(validate(base), true, JSON.stringify(validate.errors));
  for (const bad of [{ block: 0, visits: 3 }, { block: 3 }, { block: 3, visits: 3, extra: 1 }, 'x']) assert.equal(validate({ ...base, ladder: bad }), false, JSON.stringify(bad));
});

test('LK-10: advance() with no caps (a ladder chain): a layer-3 objection starts the next overseer round at any round, a lower layer never reaches a bound, and the silent-seat bound still stops', () => {
  const cfg = { maxOverseerRounds: null, layerRevisions: null, reasks: 2 };
  let s = newRoundState();
  for (let i = 0; i < 40; i++) { const r = advance(cfg, s, { outcome: 'overseer_verdict', verdict: 'objected' }); assert.equal(r.action, 'revise'); s = r.state; }
  assert.equal(s.overseerRound, 41);
  for (let i = 0; i < 40; i++) { const r = advance(cfg, s, { outcome: 'layer_objected', layer: i % 2 ? 1 : 2 }); assert.equal(r.action, 'revise'); s = r.state; }
  assert.equal(advance(cfg, s, { outcome: 'overseer_verdict', verdict: 'signed_off' }).action, 'done');
  let u = newRoundState(); const seen = [];
  for (let i = 0; i < 3; i++) { const r = advance(cfg, u, { outcome: 'unheard', layer: 2 }); seen.push(r.action); u = r.state; }
  assert.deepEqual(seen, ['ask_again', 'ask_again', 'stop']);
  assert.throws(() => advance({ maxOverseerRounds: null, layerRevisions: { 1: 3, 2: 3 }, reasks: 2 }, newRoundState(), { outcome: 'unheard' }), RangeError, 'only both null is a ladder config');
});

test('LK-11 (Q-D): a ladder run\'s stall stop has no `rounds`, so it is not a hard stop and the stop sentence does not say so (the session may continue or finish there, as at any stall stop); the same stop WITH `rounds: 9` is the hard stop (the swapped input)', async () => {
  const { isHardStop, stopSentence, stopOffersContinue } = await import('../src/overseer-rounds.js');
  const stall = { kind: 'stall_stop', why: 'top_layer', top_layer: 3, stalled: [{ id: 'O-1', lab: 'l3', layer: 3, passes: [16, 32] }], pass_left: true, pass: 32, overseer_round: 9 };
  assert.equal(isHardStop(stall), false);
  assert.doesNotMatch(stopSentence(stall, { runDir: '/r' }), /hard stop/);
  assert.equal(stopOffersContinue(stall), true);
  assert.equal(isHardStop({ ...stall, rounds: 9 }), true, 'with the field the same stop is the hard stop');
  assert.match(stopSentence({ ...stall, rounds: 9 }, { runDir: '/r' }), /hard stop/);
});

test('LK-12: early finish stays as built on a ladder chain (GO: "early finish stays as built"): a layered chain with the ladder key and a session reviser is eligible, exactly as one with the old keys is; a chain with neither is not', async () => {
  const { earlyFinishEligible } = await import('../src/early-finish-eligible.js');
  const session = { provider: 'external', model: 'claude-code-session' };
  const c = keyed(critics('script-x', 'script-x', 'script-x', 'm'), { block: 3, visits: 3 }, {}, session);
  const old = { ...c, maxOverseerRounds: 3, layerRevisions: { 1: 3, 2: 3 } }; delete old.ladder;
  const flat = { ...c, maxRounds: 4 }; delete flat.ladder;
  assert.equal(earlyFinishEligible(old), true, 'premise: the old-key chain is eligible at the tip');
  assert.equal(earlyFinishEligible(c), true);
  assert.equal(earlyFinishEligible(flat), false);
});
