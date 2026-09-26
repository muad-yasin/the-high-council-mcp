// test/tiered.test.js
//
// Tiered councils (2026-09-26, Muad: "the highest models for the highest tasks, and the lowest
// models (in price) for the mass-agentic tasks"). Three additions, all offline on mock seats:
//   - seats.alternatives: the anchors write the whole architectures; alternatives.debaters "all"
//     lets the mass seats (seats.proposers) post on them, and only the authors reply;
//   - the deep-dive seat: one seat, one job, its own dollar cap inside the run's, chunked input,
//     every call through invoke(); it does not vote;
//   - the majority guard (majority_guard.enabled): arguments without lab letters or counts, an
//     evidence bar in the reply prompt, and no withdrawal that does not quote what it concedes to.
// What is pinned: the new paths run, existing chains keep today's prompts byte for byte, the money
// guards hold, and chain-lint names every config that would silently do nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, BudgetExceeded, setCache, setBudget, guardWithdrawals, duplicateLabSlots, everySeatOf } from '../src/chain.js';
import * as R from '../src/roles.js';
import { estimateChainRows, projectStage } from '../src/cost.js';
import { lintChain } from '../src/chain-lint.js';
import { chunkSource, planDeepDive } from '../src/deep-dive.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chain = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));
const labels = r => r.stages.map(s => s.label);
const TASK = Array.from({ length: 30 }, (_, i) => `- R${i + 1}. A requirement line that is long enough to fill a chunk: number ${i + 1}.`).join('\n');

async function run(config, request = TASK) {
  setCache(null);
  return runChain({ config, request, log: () => {} });
}

// ---------------------------------------------------------------------------
// Existing chains are untouched.

// Muad's go (2026-09-26, "Yes and Yes"): on in plan-highest-7, a new chain; off everywhere else.
const GUARDED = new Set(['mock-tiered.json', 'plan-highest-7.json']);
test('tiered: no chain but mock-tiered and plan-highest-7 turns the majority guard on (it changes prompts)', () => {
  for (const f of readdirSync(join(root, 'chains')).filter(x => x.endsWith('.json'))) {
    const c = JSON.parse(readFileSync(join(root, 'chains', f), 'utf8'));
    if (GUARDED.has(f)) assert.equal(c.majority_guard?.enabled, true, `${f} has the guard on`);
    else assert.notEqual(c.majority_guard?.enabled, true, `${f} turns the majority guard on`);
  }
});

test('tiered: with the guard off, the reply prompts are byte for byte what they were', () => {
  assert.equal(R.replySystem(false), R.REPLY_SYSTEM);
  assert.equal(R.replySystem(), R.REPLY_SYSTEM);
  assert.equal(R.altReplySystem(false), R.ALT_REPLY_SYSTEM);
  const proposals = [{ id: 'X-1', lab: 'x', title: 't', serves: 's', what: 'w', why: 'y', how: 'h', acceptance_test: 'a' }, { id: 'Y-1', lab: 'y', title: 't', serves: 's', what: 'w', why: 'y', how: 'h', acceptance_test: 'a' }];
  const maps = R.anonymise(proposals);
  const posts = [{ by: 'y', on: 'X-1', stance: 'object', text: 'Quote: "h" - wrong.' }];
  const plain = R.replyUser({ request: 'r', proposals, posts, lab: 'x', maps });
  assert.equal(R.replyUser({ request: 'r', proposals, posts, lab: 'x', maps, guard: false }), plain);
  assert.match(plain, /- Lab B - object: Quote/);
  // The board an unguarded run writes carries no guard wording.
  assert.doesNotMatch(R.renderBoard(proposals, posts, [{ id: 'X-1', action: 'withdraw', text: 'ok' }]), /conceded to|STANDS/);
});

test('tiered: an author of an alternative still gets its own section; a non-author gets none', () => {
  const alternatives = [{ id: 'A-ALT', lab: 'a', name: 'n', shape: 's', key_tradeoffs: 'k', bad_at: 'b' }, { id: 'B-ALT', lab: 'b', name: 'n', shape: 's', key_tradeoffs: 'k', bad_at: 'b' }];
  const maps = R.anonymise(alternatives);
  maps.labTo.m = 'Lab C';
  const author = R.altDebateUser({ request: 'r', criteria: ['c'], alternatives, lab: 'a', maps });
  assert.match(author, /# Your own alternative \(you are Lab A\)/);
  assert.match(author, /# The other labs' alternatives/);
  const mass = R.altDebateUser({ request: 'r', criteria: ['c'], alternatives, lab: 'm', maps });
  assert.doesNotMatch(mass, /Your own alternative/);
  assert.match(mass, /you are Lab C; you wrote none of them/);
  assert.equal((mass.match(/^## [A-Z]-ALT/gm) || []).length, 2);
});

// ---------------------------------------------------------------------------
// The majority guard.

test('guard: the author sees each argument once, with no lab letter and no count', () => {
  const proposals = [{ id: 'X-1', lab: 'x', title: 't', serves: 's', what: 'w', why: 'y', how: 'h', acceptance_test: 'a' }];
  const maps = R.anonymise(proposals);
  ['y', 'z', 'w'].forEach((l, i) => { maps.labTo[l] = `Lab ${'BCD'[i]}`; });
  const posts = [
    { by: 'y', on: 'X-1', stance: 'support', text: 'Fine.' },
    { by: 'z', on: 'X-1', stance: 'object', text: 'Quote: "h" - no such file.' },
    { by: 'w', on: 'X-1', stance: 'object', text: 'Quote: "h" - no such file.' },
  ];
  const u = R.replyUser({ request: 'r', proposals, posts, lab: 'x', maps, guard: true });
  assert.doesNotMatch(u, /Lab [BCD]/, 'no poster letter');
  assert.equal((u.match(/no such file/g) || []).length, 1, 'a repeated argument is shown once');
  assert.ok(u.indexOf('- object:') < u.indexOf('- support:'), 'objections come first');
  assert.match(u, /authors and numbers withheld/);
  const sys = R.replySystem(true);
  assert.match(sys, /How many labs\s+raised a point is not evidence/);
  assert.match(sys, /"conceded_to"/);
  assert.match(R.altReplySystem(true), /"conceded_to"/);
});

test('guard: a withdrawal counts only when it quotes an objection on that proposal', () => {
  const posts = [
    { by: 'y', on: 'X-1', stance: 'object', text: 'Quote: "mock.js" - no such file exists.' },
    { by: 'z', on: 'X-2', stance: 'support', text: 'Fine as written, ship it.' },
  ];
  const replies = [
    { id: 'X-1', action: 'withdraw', conceded_to: '"mock.js" - No such file   exists' },
    { id: 'X-1', action: 'withdraw', conceded_to: 'no such' },
    { id: 'X-1', action: 'withdraw' },
    { id: 'X-2', action: 'withdraw', conceded_to: 'Fine as written, ship it.' },
    { id: 'X-1', action: 'keep', text: 'no' },
  ];
  guardWithdrawals(replies, posts);
  assert.equal(replies[0].unargued, undefined, 'a quote of the objection, normalised, is argued');
  assert.equal(replies[1].unargued, true, 'too short to be a quote');
  assert.equal(replies[2].unargued, true, 'no quote at all');
  assert.equal(replies[3].unargued, true, 'quoting a support post is not conceding to an argument');
  assert.equal(replies[4].unargued, undefined, 'a keep is never touched');
});

test('guard: a quote copied from the prompt matches a post containing "#" (finding 3)', () => {
  // The author reads posts through R.boardText, which escapes a leading "#" as "\#".
  const text = 'Wrong heading level:\n## Budget is not a section of its own, merge it into Scope.';
  const posts = [{ by: 'y', on: 'X-1', stance: 'object', text }];
  const shown = R.boardText(text);
  assert.match(shown, /\\## Budget/, 'the author is shown the escaped form');
  const replies = [
    { id: 'X-1', action: 'withdraw', conceded_to: shown.split('\n')[1] },
    { id: 'X-1', action: 'withdraw', conceded_to: '## Budget is not a section of its own' },
  ];
  guardWithdrawals(replies, posts);
  assert.equal(replies[0].unargued, undefined, 'the escaped quote, as shown, is argued');
  assert.equal(replies[1].unargued, undefined, 'the raw quote is argued too');
});

test('guard: in a run, an unargued withdrawal stays for the builder and an argued one is honoured', async () => {
  const r = await run(chain('mock-tiered'));
  const byId = Object.fromEntries(r.proposals.map(p => [p.id, p]));
  assert.equal(byId['MASSA-1'].withdrawn, true, 'mock-yield-argued quoted the objection');
  assert.ok(!byId['MASSB-1'].withdrawn, 'mock-yield-unargued did not');
  assert.equal(byId['MASSB-1'].withdraw_unargued, true);
  const rep = r.debate.replies.find(x => x.id === 'MASSB-1' && !x.canary);
  assert.equal(rep.action, 'withdraw', 'the record keeps what the author said');
  assert.equal(rep.unargued, true);
  assert.match(r.board, /^> Majority guard:/);
  assert.match(r.board, /MASSB-1 \(mass-b\) - STANDS: its author offered to withdraw/);
  assert.match(r.board, /conceded to: "Quote: "mock.js"/);
  // The same rule on the architectures: mock-alt-withdraw quotes nothing.
  const alt = r.alternatives.items.find(a => a.lab === 'anchor-b');
  assert.ok(!alt.withdrawn);
  assert.equal(alt.withdraw_unargued, true);
});

// ---------------------------------------------------------------------------
// Anchors write the architectures; mass seats post on them.

test('tiers: seats.alternatives write and reply; with debaters "all" the mass seats also post', async () => {
  const r = await run(chain('mock-tiered'));
  const L = labels(r);
  assert.deepEqual(r.alternatives.items.map(a => a.lab).sort(), ['anchor-a', 'anchor-b']);
  for (const lab of ['anchor-a', 'anchor-b']) for (const s of [`alternative-${lab}`, `alt-debate-${lab}`, `alt-reply-${lab}`]) assert.ok(L.includes(s), s);
  for (const lab of ['mass-a', 'mass-b', 'mass-c']) {
    assert.ok(L.includes(`alt-debate-${lab}`), `mass seat ${lab} posts on the architectures`);
    assert.ok(!L.includes(`alternative-${lab}`) && !L.includes(`alt-reply-${lab}`), `mass seat ${lab} writes no architecture`);
  }
  assert.ok(r.alternatives.posts.some(p => p.by.startsWith('mass-')));
  // Only anchors vote.
  assert.deepEqual([...new Set(r.panelVerdicts.map(v => v.lab))].sort(), ['anchor-a', 'anchor-b']);
});

test('tiers: without seats.alternatives or debaters, the alternatives stage is what it was', async () => {
  const base = { ...chain('mock-debate'), alternatives: { enabled: true } };
  const r = await run(base);
  assert.deepEqual(r.alternatives.items.map(a => a.lab).sort(), ['mock-a', 'mock-b']);
  assert.deepEqual(labels(r).filter(l => l.startsWith('alt-debate-')).sort(), ['alt-debate-mock-a', 'alt-debate-mock-b']);
  assert.equal(r.deep_dive, undefined, 'no deep_dive key without the stage');
  assert.ok(!labels(r).some(l => l.startsWith('deep-dive')));
});

// ---------------------------------------------------------------------------
// The deep-dive seat.

test('deep dive: chunks at a line break near the size, every character kept', () => {
  const chunks = chunkSource(TASK, 1000);
  assert.equal(chunks.join(''), TASK);
  assert.ok(chunks.length >= 2);
  for (const c of chunks.slice(0, -1)) { assert.ok(c.length <= 1000); assert.ok(c.endsWith('\n')); }
  assert.deepEqual(chunkSource('', 1000), ['']);
});

test('deep dive: one call per focus and chunk, cut at maxCalls', () => {
  const cfg = { deep_dive: { enabled: true, usd: 1, chunkChars: 1000, focus: ['a', 'b'], maxCalls: 3 } };
  const { calls, planned } = planDeepDive(cfg, TASK);
  assert.equal(planned, 2 * chunkSource(TASK, 1000).length);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].focus, 'a');
});

test('deep dive: runs after the first build, reports findings, and the reviser answers them before round 1', async () => {
  const r = await run(chain('mock-tiered'));
  const L = labels(r);
  const dd = r.deep_dive;
  assert.equal(dd.calls, 5);
  assert.equal(dd.stopped, 'max_calls');
  assert.equal(dd.findings.length, 5);
  assert.ok(dd.findings.every(f => f.quote_status === 'verified'), 'the mock quotes the plan exactly');
  assert.ok(L.indexOf('build') < L.indexOf('deep-dive-deep-a-1'));
  assert.ok(L.indexOf('deep-dive-deep-a-5') < L.indexOf('deep-dive-revise'));
  assert.ok(L.indexOf('deep-dive-revise') < L.findIndex(l => l.startsWith('panel-1-')));
  assert.ok(!r.panelVerdicts.some(v => v.lab === 'deep-a'), 'the deep-dive seat never votes');
});

test('deep dive: its own cap stops the deep dive, not the run', async () => {
  const cfg = chain('mock-tiered');
  cfg.seats.deep_dive = { provider: 'mock', model: 'mock-priced', maxTokens: 100, lab: 'deep-a' };
  // mock-priced is $1000 per Mtok: one call's worst case is ~$0.6-0.8 here.
  const one = projectStage(cfg.seats.deep_dive, { system: R.deepDiveSystem('sources'), user: 'x'.repeat(2000) });
  cfg.deep_dive = { ...cfg.deep_dive, usd: one * 1.5 };
  const r = await run(cfg);
  assert.equal(r.deep_dive.stopped, 'own_cap');
  assert.ok(r.deep_dive.calls >= 1 && r.deep_dive.calls < 5, `calls: ${r.deep_dive.calls}`);
  assert.ok(r.deep_dive.spent <= cfg.deep_dive.usd);
  assert.equal(r.passed, true, 'the run went on to the panel');
});

test('deep dive: the run cap still applies to every deep-dive call', async () => {
  const cfg = chain('mock-tiered');
  cfg.seats.deep_dive = { provider: 'mock', model: 'mock-priced', maxTokens: 100, lab: 'deep-a' };
  cfg.deep_dive = { ...cfg.deep_dive, usd: 1000 };
  setBudget(0.05);
  try {
    await assert.rejects(run(cfg), err => err instanceof BudgetExceeded && /deep-dive-deep-a-1/.test(err.message + JSON.stringify(err)));
  } finally { setBudget(null); }
});

test('deep dive: its own cap counts a stale cached call\'s superseded cost, like the run cap (finding 1)', async () => {
  const cfg = chain('mock-tiered');
  cfg.deep_dive = { ...cfg.deep_dive, usd: 1 };
  // Every deep-dive call has a stale answer on disk that cost $0.40: the call re-runs ($0 on the
  // mock) and the old $0.40 still counts toward the run cap - and now toward the deep dive's own.
  const stale = { text: '{"findings": []}', usage: { input: 1, output: 1 }, usd: 0.4, staleInputs: true };
  setCache({ get: l => (/^deep-dive-deep-a-\d+$/.test(l) ? { ...stale } : null), invalidate: () => {} });
  let r;
  try { r = await runChain({ config: cfg, request: TASK, log: () => {} }); } finally { setCache(null); }
  assert.equal(r.deep_dive.stopped, 'own_cap', 'three superseded answers ($1.20) pass its $1 cap');
  assert.equal(r.deep_dive.calls, 3);
  assert.ok(Math.abs(r.deep_dive.spent - 1.2) < 1e-9, `spent: ${r.deep_dive.spent}`);
});

test('deep dive: an unreadable call yields no findings and the run goes on', async () => {
  const cfg = chain('mock-tiered');
  cfg.seats.deep_dive = { provider: 'mock', model: 'mock-unreadable', lab: 'deep-a' };
  const r = await run(cfg);
  assert.equal(r.deep_dive.findings.length, 0);
  assert.equal(r.deep_dive.unreadable, 5);
  assert.ok(!labels(r).includes('deep-dive-revise'), 'nothing to revise');
});

test('deep dive: the seat is on the guard list (denied models, policy, missing keys)', () => {
  const cfg = chain('plan-highest-7');
  const all = everySeatOf(cfg);
  assert.ok(all.includes(cfg.seats.deep_dive));
  for (const s of cfg.seats.alternatives) assert.ok(all.includes(s));
  const denied = { ...cfg, seats: { ...cfg.seats, deep_dive: { provider: 'openrouter', model: 'x-ai/grok-5' } } };
  assert.ok(lintChain(denied).some(f => f.kind === 'denied-model'));
});

// ---------------------------------------------------------------------------
// Pricing.

test('dry run: deep-dive rows stop at its own cap; anchors reply, mass seats only post', () => {
  const cfg = chain('plan-highest-7');
  const rows = estimateChainRows(cfg);
  const dd = rows.filter(r => r.label.startsWith('deep-dive-deepseek'));
  assert.ok(dd.length >= 1);
  assert.ok(dd.reduce((s, r) => s + r.usd, 0) <= cfg.deep_dive.usd + 1e-9);
  assert.ok(rows.some(r => r.label === 'deep-dive-revise'));
  const big = estimateChainRows({ ...cfg, estimate: { ...cfg.estimate, promptTokens: 400000 } }).filter(r => r.label.startsWith('deep-dive-deepseek'));
  assert.ok(big.reduce((s, r) => s + r.usd, 0) <= cfg.deep_dive.usd + 1e-9, 'a huge task still stops at the own cap');
  assert.ok(big.length > dd.length);
  const L = rows.map(r => r.label);
  for (const lab of ['gpt6-astra', 'fable5.1']) { assert.ok(L.includes(`alternative-${lab}`)); assert.ok(L.includes(`alt-reply-${lab}`)); }
  assert.ok(L.includes('alt-debate-gpt5.6-luna') && !L.includes('alt-reply-gpt5.6-luna') && !L.includes('alternative-gpt5.6-luna'));
});

// ---------------------------------------------------------------------------
// chain-lint.

test('lint: the shipped tiered chains are clean', () => {
  assert.deepEqual(lintChain(chain('mock-tiered')), []);
  assert.deepEqual(lintChain(chain('plan-highest-7')), []);
});

test('lint: every tiered config that would do nothing, or spend uncapped, is named', () => {
  const t = chain('mock-tiered');
  const kinds = cfg => lintChain(cfg).map(f => f.kind);
  const { usd, ...noUsd } = t.deep_dive;
  assert.ok(kinds({ ...t, deep_dive: noUsd }).includes('deep-dive-uncapped'));
  assert.ok(kinds({ ...t, deep_dive: { ...t.deep_dive, usd: 0 } }).includes('deep-dive-uncapped'));
  const { deep_dive: _d, ...seatsNoDeep } = t.seats;
  assert.ok(kinds({ ...t, seats: seatsNoDeep }).includes('unreachable-stage'));
  assert.ok(kinds({ ...t, seats: { ...t.seats, deep_dive: [t.seats.deep_dive] } }).includes('unreachable-stage'));
  assert.ok(kinds({ ...t, seats: { ...t.seats, deep_dive: { provider: 'openrouter', model: 'nobody/unpriced-model' } } }).includes('deep-dive-unpriced'));
  assert.ok(kinds({ ...t, deep_dive: { ...t.deep_dive, job: 'everything' } }).includes('invalid-deep-dive-config'));
  assert.ok(kinds({ ...t, deep_dive: { ...t.deep_dive, usdCap: 3 } }).includes('invalid-deep-dive-config'));
  assert.ok(kinds({ ...t, alternatives: { enabled: false } }).includes('alternatives-seats-unused'));
  assert.ok(kinds({ ...t, seats: { ...t.seats, alternatives: [t.seats.alternatives[0]] } }).includes('alternatives-seats-too-few'));
  assert.ok(kinds({ ...t, alternatives: { enabled: true, debaters: 'everyone' } }).includes('invalid-alternatives-config'));
  const { proposers, ...noProposers } = t.seats;
  assert.ok(kinds({ ...t, proposals: undefined, debate: false, seats: noProposers }).includes('alternatives-debaters-unused'));
  assert.ok(kinds({ ...t, proposals: undefined, debate: false, alternatives: undefined, seats: { ...noProposers, alternatives: undefined } }).includes('majority-guard-without-debate'));
  const overlap = { ...t, seats: { ...t.seats, proposers: [...t.seats.proposers, { provider: 'mock', model: 'mock-proposer-b', lab: 'anchor-a' }] } };
  assert.ok(kinds(overlap).includes('mass-seat-votes'));
  // Finding 2: the tiers' rule holds whether or not the guard is on.
  assert.ok(kinds({ ...overlap, majority_guard: { enabled: false } }).includes('mass-seat-votes'), 'with the guard off too');
  // A classic chain (no tier fields) where the same labs propose and review is not tiered.
  assert.ok(!lintChain(chain('mock-debate')).some(f => f.kind === 'mass-seat-votes'));
  // The same model under another lab id, in either anchor list, is the same lab.
  const real = chain('plan-highest-7');
  const astra = real.seats.critics[0];
  const relabelled = { ...real, seats: { ...real.seats, proposers: [...real.seats.proposers.slice(1), { ...astra, lab: 'not-astra' }] } };
  assert.ok(kinds(relabelled).includes('mass-seat-votes'));
  const altOnly = { ...t, seats: { ...t.seats, alternatives: [...t.seats.alternatives, { provider: 'mock', model: 'mock-alt-a', lab: 'mass-c' }] } };
  assert.ok(kinds(altOnly).includes('mass-seat-votes'), 'an architecture author is in the anchor tier');
  // The deep-dive seat may not share a lab (or a model) with a voting anchor.
  assert.ok(kinds({ ...t, seats: { ...t.seats, deep_dive: { provider: 'mock', model: 'mock-deep', lab: 'anchor-a' } } }).includes('deep-dive-votes'));
  const ddPro = { ...real, seats: { ...real.seats, deep_dive: { ...real.seats.critics[2], lab: 'deep-dive-pro' } } };
  assert.ok(kinds(ddPro).includes('deep-dive-votes'), 'a voting anchor\'s model under another lab id');
  assert.ok(!kinds({ ...t, seats: { ...t.seats, deep_dive: { provider: 'mock', model: 'mock-deep', lab: 'mass-a' } } }).includes('deep-dive-votes'), 'a mass seat\'s lab does not vote');
  assert.ok(kinds({ ...t, majority_guard: { enable: true } }).includes('invalid-majority-guard-config'));
});

test('lint: two anchors from one lab in seats.alternatives share a stage label', () => {
  const t = chain('mock-tiered');
  const dup = { ...t, seats: { ...t.seats, alternatives: [t.seats.alternatives[0], { ...t.seats.alternatives[1], lab: 'anchor-a' }] } };
  assert.deepEqual(duplicateLabSlots(dup).find(d => d.slot === 'alternatives')?.labs, ['anchor-a']);
  assert.ok(lintChain(dup).some(f => f.kind === 'duplicate-lab'));
});

// ---------------------------------------------------------------------------
// The live status board (state.json) - finding 4.

test('status board: the architecture authors and the deep-dive seat are on it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-tiered-state-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 't.md'), TASK);
  execFileSync('node', [join(root, 'src', 'cli.js'), '--chain', 'mock-tiered', '--task', 'tasks/t.md'], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH } });
  const id = readdirSync(join(dir, 'runs'))[0];
  const state = JSON.parse(readFileSync(join(dir, 'runs', id, 'state.json'), 'utf8'));
  const byLab = Object.fromEntries(state.seats.map(x => [x.lab, x.status]));
  for (const lab of ['mass-a', 'mass-b', 'mass-c', 'anchor-a', 'anchor-b', 'deep-a']) assert.ok(lab in byLab, `${lab} missing from ${JSON.stringify(state.seats)}`);
  assert.equal(byLab['deep-a'], 'posted');
  assert.equal(state.seats.filter(x => /^(mass|anchor|deep)-/.test(x.lab)).length, 6, 'a lab in several lists is one row');
});
