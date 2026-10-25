// 0.8.3 decider-readiness unit (Muad, 24 Okt 2026: "I think the decider should be the LLM that handles the run, not the model that is placed on one of the seats"; then "B sounds fine to me" on doctor's one-key line): doctor's "one key alone runs" line leaves an EXTERNAL `seats.decider` slot out of its
// one-key test, so plan-default-opro-council stays on the line with the session as its decider, and prints a caveat only while that decider can really pause the run (an external decider whose prompt is recorded).
// The gate must stay NARROW: any other external seat, a mock seat or a decider on a second key still keeps a chain off the line. All in-process, $0, no network; the real doctor output is read by test/first-ten-minutes.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { everySeatOf } from '../src/chain.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = n => JSON.parse(readFileSync(join(root, 'chains', `${n}.json`), 'utf8'));
const or = model => ({ provider: 'openrouter', model });
const SESSION = { provider: 'external', model: 'claude-code-session' };
const cfg = seats => ({ name: 'x', seats });
const NAMES = ['conflictDeciderSystem', 'conflictDeciderUser', 'reviserDecisionNote'];
const heldAll = name => (NAMES.includes(name) ? () => 'x' : undefined);
const heldNone = () => undefined;

test('OK-1a the external seats.decider slot is left out of the one-key count', async () => {
  const { seatsForOneKey } = await import('../src/conflict-decider.js');
  const c = cfg({ builder: or('a/b'), critics: [or('c/d')], decider: SESSION });
  assert.deepEqual(seatsForOneKey(c, everySeatOf(c)).map(s => s.provider), ['openrouter', 'openrouter']);
});

test('OK-1b the gate is NARROW: another external seat, a mock decider and a paid decider stay in the count, and a chain with no decider is unchanged', async () => {
  const { seatsForOneKey } = await import('../src/conflict-decider.js');
  const slots = c => seatsForOneKey(c, everySeatOf(c));
  const base = { builder: or('a/b'), critics: [or('c/d')] };
  assert.equal(slots(cfg({ ...base, decider: or('e/f') })).length, 3, 'a paid decider stays in the count');
  assert.equal(slots(cfg({ ...base, decider: { provider: 'mock', model: 'm' } })).length, 3, 'a mock decider stays in (it keeps the chain off the line)');
  assert.deepEqual(slots(cfg({ builder: SESSION, critics: [or('c/d')], decider: or('e/f') })).map(s => s.provider), ['external', 'openrouter', 'openrouter'], 'an external seat that is NOT the decider stays in (the gate drops no other external seat)');
  assert.equal(slots(cfg(base)).length, 2, 'a chain with no decider is unchanged');
});

test('OK-2 the caveat is wanted only while an external decider can pause the run: its prompt must be recorded, and a paid or missing decider never pauses', async () => {
  const { deciderPausesRun, ONE_KEY_PAUSE_CAVEAT } = await import('../src/conflict-decider.js');
  const c = cfg({ builder: or('a/b'), critics: [or('c/d')], decider: SESSION });
  assert.equal(deciderPausesRun(c, heldAll), true, 'external and recorded');
  assert.equal(deciderPausesRun(c, heldNone), false, 'external but held: nothing is asked, so nothing is said');
  assert.equal(deciderPausesRun(cfg({ builder: or('a/b'), critics: [or('c/d')], decider: or('e/f') }), heldAll), false, 'a paid decider does not leave a file to answer');
  assert.equal(deciderPausesRun(cfg({ builder: or('a/b'), critics: [or('c/d')] }), heldAll), false, 'no decider');
  assert.match(ONE_KEY_PAUSE_CAVEAT, /pauses the run and leaves a file to answer/);
  assert.equal(/\brare\b/i.test(ONE_KEY_PAUSE_CAVEAT), false, 'how often a swing happens has not been measured');
});

test('OK-3 the shipped quick-start chain qualifies: with its decider slot left out, every remaining seat is an OpenRouter seat', async () => {
  const { seatsForOneKey, externalDeciderOf } = await import('../src/conflict-decider.js');
  const c = load('plan-default-opro-council');
  assert.deepEqual(externalDeciderOf(c), SESSION);
  assert.deepEqual([...new Set(seatsForOneKey(c, everySeatOf(c)).map(s => s.provider))], ['openrouter']);
  for (const n of ['plan-mini-council', 'plan-high-council']) {
    const k = load(n);
    assert.ok(seatsForOneKey(k, everySeatOf(k)).some(s => s.provider === 'external'), `${n}: its session seats are not the decider, so it stays off the one-key line`);
  }
});
