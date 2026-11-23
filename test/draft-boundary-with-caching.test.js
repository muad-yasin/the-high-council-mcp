// 0.8.4 cache part (b)2, R2 = (c) (Muad, 10 Nov 2026 16:23: "R2: c"): where the chain's prompt_cache switch is on, the plan's start and end lines are always sent, a person's own chain included. Offline, $0, the gate only (src/draft-bounds.js draftBoundaryOn): what the lines say is tested where they are built.
// On the tree before this step the gate follows draft_end_marker alone: DB-1 fails at its first assertion ("a chain with caching on and no draft_end_marker"); DB-2 PASSES there (it pins that nothing is sent while the words are not recorded: NO RED OF ITS OWN).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as Held from '../src/held-roles.js';
import * as D27 from './held-prompts/held-084-d27.js';
import { draftBoundaryOn } from '../src/draft-bounds.js';

afterEach(() => Held.setHeldForTest(null));
const RECORDED = { draftStartLine: D27.draftStartLine, draftBoundarySentence: D27.draftBoundarySentence };

test('DB-1 with the boundary words recorded, caching on sends the lines whatever the chain\'s own switch says; without caching the chain\'s own switch decides, as before', () => {
  Held.setHeldForTest(RECORDED);
  assert.equal(draftBoundaryOn({ prompt_cache: { enabled: true } }), true, 'a chain with caching on and no draft_end_marker');
  assert.equal(draftBoundaryOn({ prompt_cache: { enabled: true, ttl: '1h' }, draft_end_marker: { enabled: false } }), true, 'caching on beats an explicit off of the marker');
  assert.equal(draftBoundaryOn({ draft_end_marker: { enabled: true } }), true, 'the marker alone, as before');
  assert.equal(draftBoundaryOn({ draft_end_marker: { enabled: false } }), false);
  assert.equal(draftBoundaryOn({ prompt_cache: { enabled: false } }), false, 'caching off and no marker');
  assert.equal(draftBoundaryOn({}), false);
});

test('DB-2 with the words not recorded the lines are never sent, caching or not (no half a boundary)', () => {
  Held.setHeldForTest({ draftStartLine: undefined, draftBoundarySentence: undefined });
  assert.equal(draftBoundaryOn({ prompt_cache: { enabled: true }, draft_end_marker: { enabled: true } }), false);
  assert.equal(draftBoundaryOn({ prompt_cache: { enabled: true } }), false);
});
