// 0.8.1 FX-12 (AMENDMENTS; the 2026-10-02 council run: Hy4 and Qwen were cut off at 12,300 tokens, retried at 24,600
// and paid twice): proposals.maxTokens (per part) is 12,000 in every shipped chain that is not a mock chain (since the Mini unit of 16 Okt 2026 the planning tiers carry a lifted number, see the first test). The call
// cap is min(seat.maxTokens ?? 36,000, parts x perPart + 300), so a 3-part proposal call gets the seat's whole 36,000,
// like every other call of that seat. The dry run prices exactly that (it priced parts x perPart unclamped).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimateChainRows, SEAT_DEFAULT_MAX_TOKENS } from '../src/cost.js';
import { cutOffRetryCap } from '../src/chain.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const chains = readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json')).map(f => ({ f, c: JSON.parse(readFileSync(join(root, 'chains', f), 'utf8')) }));

test('FX-12: every shipped non-mock chain with proposals asks 12,000 tokens per part; mock chains are unchanged', () => {
  const shipped = chains.filter(({ f, c }) => c.proposals && !f.startsWith('mock'));
  // 0.8.2 (owner, 6 Oct 2026, archive the unused chains): 10 of the 18 chains with proposals moved to archive/chains/, 8 ship; the floor was 10.
  assert.ok(shipped.length >= 8);
  // CHANGED ACCEPTED TEST (Mini unit, commit 1 of 16 Okt 2026 should have changed it and did not: its row list missed this file; fixed in commit 2): the planning tiers carry the LIFTED per-part number (Muad: "a 36k cap ... has no
  // actual advantage"), so the ceiling parts x perPart + 300 is not below any proposer's cap (test/proposal-ceiling.test.js is the ratchet); every other shipped non-mock chain still asks 12,000.
  // R1 (18 Okt 2026), CHANGED ACCEPTED TEST: old bar = LIFTED named the four tier chains; the Chinese chains were read as 12,000; new bar = LIFTED also names plan-china-mini-council and plan-china-medium-council at 46,000, the number of plan-mini-council and plan-medium-council (the ceiling parts x perPart + 300 is below no proposer's cap: test/proposal-ceiling.test.js). The five older chains stay at 12,000 until A3b's pick 4 (Muad 18 Okt: 'yes') moves them into this table with its own dated note. The two Chinese chains are at 46,000 as their siblings are (China_Chains_Gate_Note, picks 59-62, 16 Okt 2026); Muad's yes on the chain at M7; why = picks 59-62 added plan-china-mini-council and plan-china-medium-council as 'the same machinery' as their tier siblings (m6-closing/China_Chains_Gate_Note.md lines 8, 12; Muad 15 Okt 22:34 'additional and advertised', 23:09 '4: all three'); each carries exactly the sibling's value, so the typed list names them; the lists stay hand-typed.
  // CHANGED ACCEPTED TEST (roster apply, 18 Okt 2026): OLD bar = LIFTED at 46,000 (the tiers/China) and 120,000 (High); every other shipped non-mock chain 12,000. NEW bar = the seven roster files carry the per-part number 393216 (DeepSeek's published output limit), so the seat's own limit decides (owner: "NO STEP CAPS AND NO BUDGETED RETRIES EITHER"; C&C 18 Okt 2026: it only stops the per-part cap binding).
  const LIFTED = { 'plan-default-opro-council.json': 393_216, 'plan-mini-council.json': 393_216, 'plan-mini-council-sol-session.json': 393_216, 'plan-medium-council.json': 393_216, 'plan-china-mini-council.json': 393_216, 'plan-china-medium-council.json': 393_216, 'plan-high-council.json': 393_216, 'daily7-sub-a.json': 393_216, 'plan-claude-council.json': 393_216, 'plan-china-high-council.json': 393_216 };   // plan-claude-council (18 Okt 2026, 76's file): the same lifted per-part number; its proposers are external subscription seats, so nothing is priced from it
  for (const { f, c } of shipped) assert.equal(c.proposals.maxTokens, LIFTED[f] ?? 12_000, f);
  assert.deepEqual(Object.keys(LIFTED).filter(f => !shipped.some(x => x.f === f)), [], 'every lifted chain is a shipped chain with proposals');
  for (const { f, c } of chains.filter(({ f, c }) => c.proposals && f.startsWith('mock'))) assert.notEqual(c.proposals.maxTokens, 12_000, `${f}: mock chains keep their own small caps`);
});

test('FX-12: the dry run prices a proposal call at what the call can produce: min(seat cap, parts x perPart + 300)', () => {
  for (const { f, c } of chains.filter(({ f, c }) => c.proposals && !f.startsWith('mock'))) {
    const parts = c.proposals.parts ?? 3;
    for (const r of estimateChainRows(c).filter(r => r.label.startsWith('propose-') && !r.label.endsWith('-retry'))) {
      const seat = (c.seats.proposers || c.seats.critics).find(s => r.label.startsWith(`propose-${s.lab || s.provider}`));
      const want = Math.min(seat.maxTokens ?? SEAT_DEFAULT_MAX_TOKENS, parts * c.proposals.maxTokens + 300); // the chain's own per-part number (12,000, or the tiers' lifted one)
      assert.equal(r.output, want, `${f} ${r.label}`);
    }
  }
});

test('FX-12: a cut-off proposal at 36,000 is retried once at 64,000 (the global retry ceiling), as critics are', () => {
  assert.equal(cutOffRetryCap(36_000), 64_000);
  assert.equal(cutOffRetryCap(12_300), 24_600, "plan-daily-7's old cap (3 x 4,000 + 300) and its doubled retry, from the run");
});
