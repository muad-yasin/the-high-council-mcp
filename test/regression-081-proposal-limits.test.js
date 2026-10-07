// 0.8.1 FX-12 (AMENDMENTS; the 2026-10-02 council run: Hy4 and Qwen were cut off at 12,300 tokens, retried at 24,600
// and paid twice): proposals.maxTokens (per part) is 12,000 in every shipped chain that is not a mock chain. The call
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
  for (const { f, c } of shipped) assert.equal(c.proposals.maxTokens, 12_000, f);
  for (const { f, c } of chains.filter(({ f, c }) => c.proposals && f.startsWith('mock'))) assert.notEqual(c.proposals.maxTokens, 12_000, `${f}: mock chains keep their own small caps`);
});

test('FX-12: the dry run prices a proposal call at what the call can produce: min(seat cap, parts x perPart + 300)', () => {
  for (const { f, c } of chains.filter(({ f, c }) => c.proposals && !f.startsWith('mock'))) {
    const parts = c.proposals.parts ?? 3;
    for (const r of estimateChainRows(c).filter(r => r.label.startsWith('propose-') && !r.label.endsWith('-retry'))) {
      const seat = (c.seats.proposers || c.seats.critics).find(s => r.label.startsWith(`propose-${s.lab || s.provider}`));
      const want = Math.min(seat.maxTokens ?? SEAT_DEFAULT_MAX_TOKENS, parts * 12_000 + 300);
      assert.equal(r.output, want, `${f} ${r.label}`);
    }
  }
});

test('FX-12: a cut-off proposal at 36,000 is retried once at 64,000 (the global retry ceiling), as critics are', () => {
  assert.equal(cutOffRetryCap(36_000), 64_000);
  assert.equal(cutOffRetryCap(12_300), 24_600, "plan-daily-7's old cap (3 x 4,000 + 300) and its doubled retry, from the run");
});
