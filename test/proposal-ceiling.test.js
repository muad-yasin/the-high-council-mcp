// Mini unit, commit 1 (gate note Review/Build_0.8.3/m6-closing/Mini_Unit_Gate_Note.md, C&C PASS ON CONDITIONS 15-16 Okt 2026; Muad: "a 36k cap ... has no actual advantage whatsoever"): the proposal ceiling.
// chain.js asks every proposal call for min(seat cap, parts x perPart + 300), perPart = proposals.maxTokens. With the old 12,000 that ceiling was 36,300 and silently capped the 136,000 / 360,000 proposers of the
// tiers. PC-1 is an EXACT-SET RATCHET over EVERY shipped chain with `proposals` (C&C 16 Okt 2026): parts x perPart + 300 must be at least every proposer's own cap (parts = proposals.parts ?? 3, the cap default as
// chain.js: seat.maxTokens ?? DEFAULT_MAX_TOKENS), EXCEPT the pinned list below, each with its reason. The test asserts SET EQUALITY: a new violator fails, and a fixed one must leave the list. The tiers
// (Mini and its copies, Medium, High) are not on it. PC-2 pins the retry trace the note records: a cut-off proposal is retried at max(cap, min(2 x cap, ceiling)), never below the cut call's cap.
// PC-3: perPart is in no prompt text. // Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { retryCapFor, retryCeilingOf } from '../src/reasoning.js';
import { cutOffRetryCap, DEFAULT_MAX_TOKENS, runChain, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import { readChainFile } from './helpers/chain-file.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tierFiles = readdirSync(join(root, 'chains')).filter(f => /^plan-(mini|medium|high)-council(-.+)?\.json$/.test(f));
const load = f => JSON.parse(readFileSync(join(root, 'chains', f), 'utf8'));
const ceilingOf = c => (c.proposals.parts ?? 3) * (c.proposals.maxTokens ?? 1500) + 300; // chain.js:2734/:2769: min(seat cap, parts * perPart + 300), perPart = proposals.maxTokens ?? 1500
const proposersOf = c => c.seats.proposers || c.seats.critics || []; // chain.js:2741: the proposers are the panel seats when the chain names none
const MOCK = 'an offline fixture on purpose: a tiny ceiling keeps the mock proposals short and cheap';
// The known exceptions (name -> reason). Do not add a name without a reason; remove a name when its chain is fixed (the test fails until you do).
const EXCEPTIONS = {
  'mock-debate.json': MOCK, 'mock-external.json': MOCK, 'mock-open.json': MOCK, 'mock-partitioned.json': MOCK, 'mock-proposals.json': MOCK,
  'mock-questions-wait.json': MOCK, 'mock-questions.json': MOCK, 'mock-tiered.json': MOCK,
  'coder-gate-v1.json': 'the proposer is an external session (no token cap applies to it); parts 1 x 12,000 comes from the chain\'s first commit b75e9ce (2026-09-14, "Add MLLM Coder v1 chain config"); no recorded reason for the number',
  'coder-gate-v2.json': 'the proposer is an external session (no token cap applies to it); parts 1 x 12,000 comes from the chain\'s first commit b75e9ce (2026-09-14, "Add MLLM Coder v1 chain config", parts set to 1 in e6b65f4); no recorded reason for the number',
  'plan-daily-7.json': "awaiting Muad's decision: a 360k proposer under the 36,300 ceiling",
  'cheap-7-v2.json': "awaiting Muad's decision: no seats.proposers, so the panel seats propose (chain.js:2741), and a 360k seat of them sits under the 36,300 ceiling",
  'plan-open-7.json': "awaiting Muad's decision: no seats.proposers, so the panel seats propose (chain.js:2741), and a 360k seat of them sits under the 36,300 ceiling",
  'plan-highest-7.json': "awaiting Muad's decision: a 360k proposer under the 36,300 ceiling",
  // 'daily7-sub-a.json' left this list on 18 Oct 2026 (roster apply, CHANGED ACCEPTED: OLD bar = a 360k proposer under the 36,300 ceiling, awaiting Muad; NEW = proposals.maxTokens 393216 per part, covered by his 'NO STEP CAPS' ruling, so the ceiling 3 x 393216 + 300 is above every proposer's cap and the chain is no violator).
};

test('PC-1 (exact-set ratchet): on every shipped chain with proposals, parts x perPart + 300 is at least every proposer\'s own cap, except the pinned list of known exceptions (set equality, each with a reason)', () => {
  const violators = [];
  let checked = 0;
  // 0.8.3 (lane B): the retired chains in chains/outdated/ are scanned too (the ruling: the checks still scan the folder), so their exceptions stay on the list.
  for (const f of ['chains', join('chains', 'outdated')].flatMap(d => readdirSync(join(root, d)).filter(f => f.endsWith('.json')))) {
    const c = readChainFile(root, f.slice(0, -5));
    if (!c.proposals || !proposersOf(c).length) continue;
    checked += 1;
    const ceiling = ceilingOf(c);
    const biggest = Math.max(...proposersOf(c).map(s => s.maxTokens ?? DEFAULT_MAX_TOKENS));
    if (ceiling < biggest) violators.push(f);
  }
  assert.ok(checked >= 18, `the scan covered the shipped chains with proposals (${checked})`);
  for (const [f, reason] of Object.entries(EXCEPTIONS)) assert.ok(typeof reason === 'string' && reason.length > 20, `${f} carries a reason`);
  assert.deepEqual(violators.sort(), Object.keys(EXCEPTIONS).sort(), 'a new violator fails here; a chain that was fixed must be removed from EXCEPTIONS');
  for (const f of tierFiles) assert.equal(f in EXCEPTIONS, false, `${f}: the planning tiers are never on the list`);
  assert.ok(tierFiles.length >= 3, `the tier files were found (${tierFiles.join(', ')})`);
});

test('PC-2: the retry of a cut-off proposal never goes BELOW the cut call\'s cap; a seat already at its model\'s maximum is not retried (no room); the tier proposers\' retry caps are derived from the files', () => {
  assert.equal(retryCapFor(136000, 64000), 136000, 'a ceiling under the cap gives the cap itself: no room, no retry');
  assert.equal(retryCapFor(36000, 64000), 64000);
  assert.equal(retryCapFor(36000, 128000), 72000);
  for (const cap of [1000, 36000, 64000, 131072, 136000, 360000]) for (const ceiling of [8000, 64000, 131072, 943718]) {
    assert.ok(retryCapFor(cap, ceiling) >= cap, `retryCapFor(${cap}, ${ceiling}) is never below the cap`);
    assert.equal(cutOffRetryCap(cap, ceiling), retryCapFor(cap, ceiling), 'the panel\'s and the proposals\' retry rule is the one function');
  }
  for (const f of tierFiles) {
    const c = load(f); const ceiling = ceilingOf(c);
    for (const s of c.seats.proposers) {
      const first = Math.min(s.maxTokens, ceiling);
      const retry = retryCapFor(first, retryCeilingOf({ ...s, maxTokens: first }));
      assert.ok(retry >= first, `${f}: ${s.model}: retry ${retry} is not below the first cap ${first}`);
      if (s.model === 'xiaomi/mimo-v2.6-pro') assert.equal(retry, first, `${f}: MiMo is at its model maximum: no room to retry`);
    }
  }
});

test('PC-3: perPart (proposals.maxTokens) is in no prompt text: the same mock proposals chain at 12,000 and at 46,000 sends byte-identical system and user prompts at every stage', async () => {
  const prompts = async perPart => {
    setCache(null); setBudget(null);
    const seen = [];
    setPromptSpy(p => seen.push(`${p.label}\n${p.system}\n${p.user}`));
    const config = { name: 'pc3', maxRounds: 1, proposals: { parts: 3, maxTokens: perPart }, debate: true, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
      seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, skeleton: { provider: 'mock', model: 'mock-skeleton' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'w' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'w' },
        proposers: [{ provider: 'mock', model: 'mock-proposer-a', lab: 'pa', maxTokens: 136000 }, { provider: 'mock', model: 'mock-proposer-b', lab: 'pb', maxTokens: 136000 }], critics: [{ provider: 'mock', model: 'mock-critic-a', lab: 'a' }] } };
    try { await runChain({ request: 'Write a plan.', log: () => {}, runId: 'r-pc3', config }); } finally { setPromptSpy(null); }
    return seen;
  };
  const low = await prompts(12000); const high = await prompts(46000);
  assert.ok(low.some(p => /^propos/.test(p)) && low.length >= 6, `the run reached the proposals and the stages after them (${low.length} prompts)`);
  assert.deepEqual(high, low, 'no prompt text depends on the per-part number or on the effective cap it produces (36,300 against 136,000 here)');
});
