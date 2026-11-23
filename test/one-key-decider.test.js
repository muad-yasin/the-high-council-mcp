// 0.8.3 decider-readiness unit (Muad, 24 Okt 2026: "I think the decider should be the LLM that handles the run, not the model that is placed on one of the seats"; then "B sounds fine to me" on doctor's one-key line): doctor's "one key alone runs" line leaves an EXTERNAL `seats.decider` slot out of its
// one-key test, so plan-china-medium-council stays on the line with the session as its decider, and prints a caveat only while that decider can really pause the run (an external decider whose prompt is recorded).
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

// CHANGED ACCEPTED TEST (0.8.4 HS, Muad 05 Nov 2026 22:19: every layered chain needs a handling session; the quick-start chain's four writer seats are the session). OLD title: "... with its decider slot left out, every remaining seat is an OpenRouter seat". NEW: with the session seats left out (the decider and the writer seats, as doctor's one-key line reads them), every remaining seat is an OpenRouter seat. WHY: the writer seats are external now; a chain still stays off the line when it has an external seat that is NOT the session (a seat answered through a subscription).
// CHANGED ACCEPTED TEST (0.8.4 seats unit, Muad 10 Nov 2026 01:10 and 01:56: plan-default-opro-council retires; the default chain seats Claude on the Anthropic key). OLD: the quick-start chain, plan-default-opro-council, qualified for doctor's one-key line (its criteria seat was a paid OpenRouter seat), and plan-mini-council and plan-high-council stayed off it because of a subscription seat. NEW: no shipped chain qualifies, because every one answers the criteria stage through the Claude subscription (an external seat that is not the session); plan-china-medium-council is the closest: only that seat keeps it off the line. WHY: the seats changed; the gate (one key plus the session) is unchanged and its synthetic cases above still pin it.
test('OK-3 no shipped chain is a one-key chain: the criteria seat is a subscription seat in every one; in plan-china-medium-council it is the only seat that is not an OpenRouter seat once the session seats are left out; the mini and high chains also seat Anthropic', async () => {
  const { seatsForOneKey, externalDeciderOf } = await import('../src/conflict-decider.js');
  const isSession = s => s.provider === 'external' && s.model === 'claude-code-session';
  const c = load('plan-china-medium-council');
  assert.deepEqual(externalDeciderOf(c), SESSION);
  const rest = seatsForOneKey(c, everySeatOf(c)).filter(s => !isSession(s));
  assert.deepEqual(rest.filter(s => s.provider !== 'openrouter').map(s => `${s.provider}/${s.model}`), ['external/subscription:opus-5.5']);
  for (const n of ['plan-mini-council', 'plan-high-council']) {
    const k = load(n);
    assert.deepEqual([...new Set(seatsForOneKey(k, everySeatOf(k)).filter(s => !isSession(s)).map(s => s.provider))].sort(), ['anthropic', 'external', 'openrouter'], `${n}: two keys and a subscription seat, so it stays off the one-key line`);
  }
});
