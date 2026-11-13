// 0.8.4 H1-d (Builder A's D30 slot, committed by Builder B; C&C's go, 08 Nov 2026): the four reviser calls in src/chain.js that built their system prompt with `R.reviserSystem(...)` directly (the deep-dive revise, the contested-criterion revision, the first-mode revise round, the challenge revision) now go through the same composition point as every other reviser call, `reviserSystemFor` (imported as `reviserSystemOf`), with the arguments that give the same function today: (false, false) = the plain reviser prompt. Nothing is held on that path yet (H8 puts the excerpt clause inside reviserSystemFor), so the bytes do not change; the seam is what changes: once D30's sentence is recorded it reaches these four calls too.
// H1-D-1 SCAN (this row fails on the parent, where all four sites call R.reviserSystem directly): no direct R.reviserSystem( call is left in src/chain.js, and exactly four sites read reviserSystemOf(false, false)(open, !!fencedSource, promptOpts).
// H1-D-2 PIN (green on both trees by construction; it cannot fail): for an unfenced prompt the seam with (false, false) gives the same bytes as R.reviserSystem, so the four sites' bytes are unchanged today. It compares bytes only for fenced = false, because H8 (Builder A) will put the excerpt clause inside the function reviserSystemFor returns and a fenced prompt may then differ on purpose.
// Offline, $0, no run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '../src/roles.js';
import { reviserSystemFor } from '../src/stage-system.js';

const src = readFileSync(new URL('../src/chain.js', import.meta.url), 'utf8');

test('H1-D-1: no direct R.reviserSystem( call is left in src/chain.js; four sites call reviserSystemOf(false, false)(open, !!fencedSource, promptOpts)', () => {
  assert.equal((src.match(/R\.reviserSystem\(/g) || []).length, 0, 'a direct R.reviserSystem( call is left');
  assert.equal((src.match(/reviserSystemOf\(false, false\)\(open, !!fencedSource, promptOpts\)/g) || []).length, 4, 'the four sites');
});

test('H1-D-2 (PIN): for an unfenced prompt the seam with (false, false) gives the plain reviser prompt, byte for byte (the excerpt clause of H8 leaves an unfenced prompt unchanged)', () => {
  const opts = { decisions: false };
  for (const open of [false, true]) assert.equal(reviserSystemFor(false, false)(open, false, opts), R.reviserSystem(open, false, opts));
});
