// 0.8.4 the session route (Helper A): the stops line of the dry run (src/claude-route.js sessionStopsOf / sessionStopsLines, wording row SSW-w11) and the no-key way out in COUNCIL-E001 (src/errors.js, SSW-w12).
// PINNED: the count comes from the SHAPE of the chain, not from the cost estimator; a parallel stage is ONE stop however many seats it has; the figures of plan-claude-council are 5 stops and 14 answers (3 proposals + 3 debate + 3/3/2 judges), the same stops with other judge counts; a chain with no converted seat prints nothing;
// a draft handed in skips the proposals (and with them the debate), as runChain does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as CR from '../src/claude-route.js';      // a namespace import: an export that does not exist is undefined here, so each test fails on its own and the file still loads (a red run on an older tree shows assertion-level reds, not one load failure)

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const applySessionRoute = (...a) => CR.applySessionRoute(...a);
const sessionStopsOf = (...a) => CR.sessionStopsOf(...a);
const sessionStopsLines = (...a) => CR.sessionStopsLines(...a);
const chain = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));

test('SST-1 plan-claude-council: the switch adds 5 stops and 14 answers at least (3 proposals, 3 debate posts, layers of 3, 3 and 2), counted from the chain shape', () => {
  const r = applySessionRoute(chain('plan-claude-council'));
  assert.equal(r.unmapped.length, 0);
  assert.deepEqual(sessionStopsOf(r.config, r.converted), { stops: 5, answers: 14 });
});

test('SST-2 the stops do not depend on the number of judges, only the answers do (layers of 6, 4 and 2 give the same 5 stops)', () => {
  const base = chain('plan-claude-council');
  const mk = (n, layer) => Array.from({ length: n }, () => ({ provider: 'anthropic', model: 'claude-haiku-5-5', lab: 'haiku5.5', layer }));
  const wide = { ...base, seats: { ...base.seats, critics: [...mk(6, 1), ...mk(4, 2), ...mk(2, 3)] } };
  const r = applySessionRoute(wide);
  assert.deepEqual(sessionStopsOf(r.config, r.converted), { stops: 5, answers: 6 + 12 });      // 3 + 3 for the proposers' two stages, 6 + 4 + 2 for the layers
});

test('SST-3 a flat panel is ONE stop, a chain with no proposals or debate adds none for them, and a chain with no converted seat adds nothing', () => {
  const flat = { name: 'x', signoff: 'first', seats: { critics: [{ provider: 'anthropic', model: 'claude-opus-5-5' }, { provider: 'anthropic', model: 'claude-sonnet-5-5' }], builder: { provider: 'external', model: 'claude-code-session' } } };
  const r = applySessionRoute(flat);
  assert.deepEqual(sessionStopsOf(r.config, r.converted), { stops: 1, answers: 2 });
  const none = applySessionRoute({ name: 'm', seats: { critics: [{ provider: 'mock', model: 'mock-critic-a' }] } });
  assert.deepEqual(sessionStopsOf(none.config, none.converted), { stops: 0, answers: 0 });
});

test('SST-4 the dry run line (SSW-w11): exact words for 14 answers in 5 pauses and for 1 in 1, nothing for another route or for nothing', () => {
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: `...in at least 5 pauses of the run: a run in which every judge agrees at the first reading. A disagreement or a revision asks more.` NEW: `...in at least 5 pauses of the run. Those are the figures for a run in which every judge agrees at the first reading; a disagreement or a revision adds to them.` (K5; same for the 1-in-1 line). WHY: the reviewed sentence of src/claude-route.js:187 (SSW-w11).
  const r = applySessionRoute(chain('plan-claude-council'));
  assert.deepEqual(sessionStopsLines({ route: 'session', routed: r.converted }, r.config), ['Your sessions are asked at least 14 times, in at least 5 pauses of the run. Those are the figures for a run in which every judge agrees at the first reading; a disagreement or a revision adds to them.']);
  const one = applySessionRoute({ name: 'x', seats: { critics: [{ provider: 'anthropic', model: 'claude-opus-5-5' }] } });
  assert.deepEqual(sessionStopsLines({ route: 'session', routed: one.converted }, one.config), ['Your sessions are asked at least 1 time, in at least 1 pause of the run. Those are the figures for a run in which every judge agrees at the first reading; a disagreement or a revision adds to them.']);
  assert.deepEqual(sessionStopsLines({ route: 'openrouter', routed: r.converted }, r.config), []);
  assert.deepEqual(sessionStopsLines({ route: 'anthropic', routed: [] }, r.config), []);
  assert.deepEqual(sessionStopsLines({ route: 'session', routed: [] }, r.config), []);
});

test('SST-5 a draft handed in (--draft) skips the proposals and the debate in the count, as runChain does; one proposer seat has no debate', () => {
  const r = applySessionRoute(chain('plan-claude-council'));
  assert.deepEqual(sessionStopsOf(r.config, r.converted, { draft: true }), { stops: 3, answers: 8 });
  const one = applySessionRoute({ name: 'x', proposals: { parts: 3 }, debate: true, seats: { proposers: [{ provider: 'anthropic', model: 'claude-opus-5-5' }], critics: [{ provider: 'mock', model: 'mock-critic-a' }] } });
  assert.deepEqual(sessionStopsOf(one.config, one.converted), { stops: 1, answers: 1 });
});
