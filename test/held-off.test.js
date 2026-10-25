// The explicit off state of the held prompts the 0.8.3 re-record switches on (conflict decider, early finish, the 11 of held-083.js) (test/helpers/held-off.js; decider-readiness unit, 24 Okt 2026). The map must keep held(name) undefined for every one of
// the 16 names whether or not src/roles.js records them, and withHeldOff must merge. $0, offline.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { held, setHeldForTest } from '../src/held-roles.js';
import * as HDEC from './held-prompts/held-083-decider.js';
import * as HEARLY from './held-prompts/held-083-early.js';
import * as H083 from './held-prompts/held-083.js';
import * as HNOTES from './held-prompts/held-083-notes.js';
import { HELD_OFF, HELD_OFF_NAMES, withHeldOff } from './helpers/held-off.js';

afterEach(() => setHeldForTest(null));
const DRAFTED = [...Object.keys(HDEC), ...Object.keys(HEARLY), ...Object.keys(H083).filter(n => !(n in HNOTES))];   // the same derivation, restated here from the files; the test below pins the helper to it

test('HO-1 the off map holds EXACTLY the names derived from the drafted files, and every one is an own property set to undefined; a count ratchet at 16 (3 decider + 2 early finish + 11 of held-083.js) says when the set grows', () => {
  assert.deepEqual([...HELD_OFF_NAMES].sort(), DRAFTED.slice().sort());
  for (const n of HELD_OFF_NAMES) assert.ok(Object.hasOwn(HELD_OFF, n) && HELD_OFF[n] === undefined, `${n} is an own property set to undefined`);
  assert.equal(HELD_OFF_NAMES.length, 16, 'a new drafted function changes this number on purpose: say so here and in the report');
  assert.equal(new Set(HELD_OFF_NAMES).size, 16, 'no name is drafted twice');
});

test('HO-2 under the off map held(name) is undefined for all 16 names, whatever src/roles.js records', () => {
  setHeldForTest(HELD_OFF);
  for (const n of DRAFTED) assert.equal(held(n), undefined, `${n} is off`);
});

test('HO-3 withHeldOff merges: the injected names are on, the rest of the 16 stay off', () => {
  const f = () => 'x';
  setHeldForTest(withHeldOff({ reviserEarlyFinishNote: f }));
  assert.equal(held('reviserEarlyFinishNote'), f);
  for (const n of DRAFTED.filter(n => n !== 'reviserEarlyFinishNote')) assert.equal(held(n), undefined, `${n} stays off`);
});
