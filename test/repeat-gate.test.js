// Unit 4 (his pick OWNER 6, 03 Nov 2026, heading "PLAN A'S OWNER ITEMS ..."): "Re-asks and retries are checked at the expected size of the call they repeat: the run stops less often near the limit,
// but a re-ask can overrun the cap." The spend gate prices a re-ask (`-reask<n>`), a `-retry`, an `-answered` and a `-question` call at the expected cost of the call it repeats, on its own prompt; a repeat of a call
// with no expected size anywhere (a merge, a full revise, the decider, the allocator) keeps its worst case. The gate's figure only: the reservation on disk is still the worst case. The functions are reached through
// the namespace, so a missing export fails ONE test.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as chainNs from '../src/chain.js';
import * as costNs from '../src/cost.js';
import { openReservations, RESERVATIONS_FILE } from '../src/spend-reservations.js';

const { runChain, setBudget, setCache, setPromptSpy, setReservationSink, BudgetExceeded } = chainNs;
const { expectedCallUsd, projectAttempts } = costNs;
const near = (a, b) => Math.abs(a - b) < 1e-9;
const DRAFT = 'DRAFT TO REVIEW ' + 'x'.repeat(4000);
const ESTIMATE = { critiqueTokens: 300 };
const MODEL = { provider: 'openrouter', model: 'anthropic/claude-opus-5', maxTokens: 20000 };   // not an Anthropic seat here: one attempt per ask
const P = { system: 'S', user: 'U'.repeat(400) };

test('repeatExpectedCallUsd: a re-ask and a -retry are priced as the call they repeat; an -answered and a -question, a repeat of a call with no expected size, and a call that is not a repeat, give null', () => {
  const f = costNs.repeatExpectedCallUsd; assert.equal(typeof f, 'function');
  const est = ESTIMATE; const seat = MODEL;
  assert.equal(f(seat, { ...P, label: 'panel-1-a-reask1', estimate: est }), expectedCallUsd(seat, { ...P, label: 'panel-1-a', estimate: est }), 'a re-ask: its review\'s expected cost');
  assert.equal(f(seat, { ...P, label: 'panel-1-a-reask2', estimate: est }), expectedCallUsd(seat, { ...P, label: 'panel-1-a', estimate: est }));
  assert.equal(f(seat, { ...P, label: 'build-retry', estimate: est }), expectedCallUsd(seat, { ...P, label: 'build', estimate: est }), 'a -retry: the call it repeats');
  for (const label of ['panel-1-a-answered', 'panel-1-a-question']) assert.equal(f(seat, { ...P, label, estimate: est }), null, `${label}: an answer-back is not a re-ask and keeps its worst case at the gate (the upper estimate does not price it either)`);
  assert.ok(f(seat, { ...P, label: 'panel-1-a-reask1', estimate: est }) > 0, 'a real figure');
  for (const label of ['x-merge-reask1', 'conflict-1-retry', 'solo-reask1', 'revise-2-full-retry']) assert.equal(f(seat, { ...P, label, estimate: est }), null, `${label}: the call it repeats has no expected size, so it keeps its worst case`);
  for (const label of ['panel-1-a', 'build', 'solo']) assert.equal(f(seat, { ...P, label, estimate: est }), null, `${label}: not a repeat`);
  assert.ok(f(seat, { ...P, label: 'panel-1-a-reask1', estimate: est }) < projectAttempts(seat, P).first, 'and it is below the worst case');
});

function stub() {
  const seen = []; const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => { seen.push(1); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: { message: 'overloaded', code: 529 } })); }); });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, seen, url: `http://127.0.0.1:${srv.address().port}/v1` })));
}
const configOf = url => ({ name: 'repeat-gate', signoff: 'unanimous', maxRounds: 1, criteria: ['It exists.'], estimate: ESTIMATE, seats: { critics: [{ ...MODEL, baseUrl: url, lab: 'a' }] } });
async function withKey(fn) {
  const env0 = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-or-v1-' + 'c'.repeat(40);
  try { await fn(); } finally { if (env0 === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = env0; }
}

test('in a run: a re-ask whose worst case would pass the cap but whose expected cost fits is SENT; its reservation on disk is still the worst case', () => withKey(async () => {
  // Phase 1, uncapped: read the prompts the panel review and its first re-ask are sent with. The provider answers every call with an error reply that carries no usage figure, so the seat is silent and the panel re-asks it.
  const prompts = {}; const s1 = await stub();
  setCache(null); setBudget(null); setPromptSpy(p => { if (/^panel-1-a/.test(p.label)) prompts[p.label] ??= { system: p.system, user: p.user }; });
  try { await runChain({ request: 'Req.', config: configOf(s1.url), draft: DRAFT, log: () => {} }).catch(() => {}); } finally { setPromptSpy(null); s1.srv.close(); }
  assert.ok(prompts['panel-1-a'] && prompts['panel-1-a-reask1'], `fixture: the review and its first re-ask were sent (${Object.keys(prompts).join(', ')})`);
  const seat = { ...MODEL, lab: 'a' };
  const first = costNs.typicalCallUsd(seat, { ...prompts['panel-1-a'], label: 'panel-1-a', estimate: ESTIMATE });     // what the silent review is charged
  const e1 = expectedCallUsd(seat, { ...prompts['panel-1-a-reask1'], label: 'panel-1-a', estimate: ESTIMATE });         // the re-ask at the expected cost of the review it repeats
  const w1 = projectAttempts(seat, prompts['panel-1-a-reask1']).first;                                                    // the re-ask at its worst case
  const cap = first + (e1 + w1) / 2;
  assert.ok(first + w1 > cap && first + e1 < cap, `fixture: a worst-case gate refuses the re-ask (${first + w1} > ${cap}), an expected-cost gate admits it (${first + e1})`);
  // Phase 2, capped between the two.
  const d = mkdtempSync(join(tmpdir(), 'thc-repeat-gate-')); const s2 = await stub(); let err = null;
  setCache(null); setBudget(cap); setReservationSink(openReservations(d));
  try { await runChain({ request: 'Req.', config: configOf(s2.url), draft: DRAFT, log: () => {} }); } catch (e) { err = e; } finally { setBudget(null); setReservationSink(null); s2.srv.close(); }
  assert.ok(s2.seen.length >= 2, `the re-ask was sent: the provider saw ${s2.seen.length} request(s)`);
  assert.ok(!(err instanceof BudgetExceeded && /reask1/.test(err.label || '')), `and the gate did not refuse it: ${err?.message ?? 'no error'}`);
  const reserved = readFileSync(join(d, RESERVATIONS_FILE), 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(l => l.event === 'reserved' && l.label === 'panel-1-a-reask1');
  assert.equal(reserved.length, 1, 'the re-ask wrote one reservation');
  assert.ok(near(reserved[0].usd, w1), `and it carries the WORST case (${reserved[0].usd} vs ${w1}), not the figure the gate decided on`);
}));

// The stop record of a refused re-ask (S5-05, his 28 Okt pick: the "smallest total" figures carry the figure the gate DECIDED on): with the re-ask gated at the expected cost of the review it repeats, `gate` is that expected cost, `projected` stays the
// worst case. These two figures feed STOPPED-budget.json and the suggested resume total.
test('a re-ask the cap refuses: the stop carries the expected cost the gate decided on (gate) and the worst case (projected)', () => withKey(async () => {
  const prompts = {}; const s1 = await stub();
  setCache(null); setBudget(null); setPromptSpy(p => { if (/^panel-1-a/.test(p.label)) prompts[p.label] ??= { system: p.system, user: p.user }; });
  try { await runChain({ request: 'Req.', config: configOf(s1.url), draft: DRAFT, log: () => {} }).catch(() => {}); } finally { setPromptSpy(null); s1.srv.close(); }
  assert.ok(prompts['panel-1-a'] && prompts['panel-1-a-reask1'], 'fixture: the review and its first re-ask were sent');
  const seat = { ...MODEL, lab: 'a' };
  const first = costNs.typicalCallUsd(seat, { ...prompts['panel-1-a'], label: 'panel-1-a', estimate: ESTIMATE });
  const e1 = expectedCallUsd(seat, { ...prompts['panel-1-a-reask1'], label: 'panel-1-a', estimate: ESTIMATE });
  const w1 = projectAttempts(seat, prompts['panel-1-a-reask1']).first;
  const cap = first + e1 / 2;   // room for the review's charge and half of the re-ask's expected cost: the gate refuses the re-ask at either figure
  const s2 = await stub(); let err = null;
  setCache(null); setBudget(cap);
  try { await runChain({ request: 'Req.', config: configOf(s2.url), draft: DRAFT, log: () => {} }); } catch (e) { err = e; } finally { setBudget(null); s2.srv.close(); }
  assert.ok(err instanceof BudgetExceeded && err.label === 'panel-1-a-reask1', `the re-ask was refused: ${err?.message ?? 'no error'}`);
  assert.ok(near(err.gate, e1), `gate is the expected cost of the review it repeats (${err.gate} vs ${e1}), not the worst case (${w1})`);
  assert.ok(near(err.projected, w1), `projected stays the worst case (${err.projected} vs ${w1})`);
  assert.ok(err.gate < err.projected, 'and the figure to clear is the lower one');
}));
