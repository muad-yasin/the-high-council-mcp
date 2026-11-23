// CR-5F-002 (25 Okt 2026): the published `RunStatus` union (types/index.d.ts) listed 7 words while deriveRunStatus can return 17, so a caller that switches on the union read a paid, resumable run that waits for a spending limit or a choice
// (awaiting_user_cap, awaiting_choice) as an unknown or dead state. The expected list is DERIVED from the code: the literals deriveRunStatus returns, and the stop-cause table (STOP_STATUS); 0.8.4 (the add-on removal): the eight words of the removed advice add-on stay in the union as LEGACY words (REM-w11), listed below by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveRunStatus } from '../src/run-status.js';
import { STOP_STATUS } from '../src/stop-files.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// LEGACY words (0.8.4, REM-w11): an advice call's three stop states and five approval states. The code no longer returns any of them (APPROVAL_STATUSES and the three stop causes are gone); they stay in the published union so code that switches on them still compiles.
const LEGACY = ['user_stopped', 'client_cancel_stopped', 'wall_clock_stopped', 'awaiting_approval', 'approved', 'declined', 'approval_expired', 'approval_invalid'];

// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD: the expected set was the code's literals + STOP_STATUS + APPROVAL_STATUSES (run-status.js), and the loop asserted three of the stop words are declared. NEW: the expected set is the code's literals + STOP_STATUS + the eight LEGACY words listed by hand; the test also asserts the code returns none of the legacy words. WHY: APPROVAL_STATUSES and the three advice stop causes are removed from the code, while types/index.d.ts keeps the words (REM-w11, the owner's Q4).
test('RS-1 (CR-5F-002): the RunStatus union in types/index.d.ts is exactly the set of words deriveRunStatus can return, plus the eight legacy words of the removed advice add-on', () => {
  const literals = [...deriveRunStatus.toString().matchAll(/return ([^;\n]*)/g)].flatMap(m => [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]));   // every quoted word of a return statement (a ternary returns two)
  const fromCode = new Set([...literals, ...Object.values(STOP_STATUS)]);
  for (const w of LEGACY) assert.equal(fromCode.has(w), false, `${w} is a legacy word: the code does not return it`);
  for (const w of LEGACY) fromCode.add(w);
  const text = readFileSync(join(root, 'types', 'index.d.ts'), 'utf8');
  const union = /export type RunStatus =([^;]+);/.exec(text)?.[1];
  assert.ok(union, 'the union is declared');
  const declared = new Set([...union.matchAll(/'([a-z_]+)'/g)].map(m => m[1]));
  assert.deepEqual([...declared].sort(), [...fromCode].sort());
  for (const w of ['awaiting_user_cap', 'awaiting_choice', ...LEGACY]) assert.ok(declared.has(w), `${w} is in the union`);
});
