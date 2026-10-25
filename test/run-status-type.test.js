// CR-5F-002 (25 Okt 2026): the published `RunStatus` union (types/index.d.ts) listed 7 words while deriveRunStatus can return 17, so a caller that switches on the union read a paid, resumable run that waits for a spending limit or a choice
// (awaiting_user_cap, awaiting_choice) as an unknown or dead state. The expected list is DERIVED from the code: the literals deriveRunStatus returns, the stop-cause table (STOP_STATUS) and the approval list (APPROVAL_STATUSES).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveRunStatus, APPROVAL_STATUSES } from '../src/run-status.js';
import { STOP_STATUS } from '../src/stop-files.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('RS-1 (CR-5F-002): the RunStatus union in types/index.d.ts is exactly the set of words deriveRunStatus can return', () => {
  const literals = [...deriveRunStatus.toString().matchAll(/return ([^;\n]*)/g)].flatMap(m => [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]));   // every quoted word of a return statement (a ternary returns two)
  const fromCode = new Set([...literals, ...Object.values(STOP_STATUS), ...APPROVAL_STATUSES]);
  const text = readFileSync(join(root, 'types', 'index.d.ts'), 'utf8');
  const union = /export type RunStatus =([^;]+);/.exec(text)?.[1];
  assert.ok(union, 'the union is declared');
  const declared = new Set([...union.matchAll(/'([a-z_]+)'/g)].map(m => m[1]));
  assert.deepEqual([...declared].sort(), [...fromCode].sort());
  for (const w of ['awaiting_user_cap', 'awaiting_choice', 'user_stopped', 'client_cancel_stopped', 'wall_clock_stopped']) assert.ok(declared.has(w), `${w} is in the union`);
});
