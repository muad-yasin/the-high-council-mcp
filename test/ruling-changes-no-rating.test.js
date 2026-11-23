// 0.8.4 S20 slice 2 (T22x; RU-S20-13): a ruling the person gave changes no rating. The judges, the reviser and the decider READ it; no rule of the run reads it to rate, sustain, overrule or withdraw an objection. Offline, $0: the scripted three-layer run of
// test/helpers/layer-two-run.js, run twice, with and without an approved ruling, and the severity record of the two compared whole.
// A pin of behaviour that already holds (the audit found no ruling code path that reaches a rating), so its evidence of being able to fail is IN the file: T22x-2 runs the same comparison on two runs whose ratings really differ and requires it to report a difference.
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { scenario } from './helpers/layer-two-run.js';
import { setHeldForTest } from '../src/held-roles.js';
import { DEMAND } from './helpers/rating-demand.js';

// CHANGED ACCEPTED (0.8.4 S19, found by the (c) set; a row of D's slice 2, T22x-1 and T22x-2). OLD: scenario({ ... }) wrote the severity switch into the chain, so the rating a layer-1 judge gave (3, swept) was read. NEW: no option (the switch and the helper's option are gone); the rating demand is injected for every row (DEMAND, test/helpers/rating-demand.js), which is what the switch meant on this layered chain. Every assertion is the old one. WHY: S19 removed the switch. RED BEFORE: the two rows fail on the (c) tree with the old call ('the run stopped: layer_bound': without the demand the volunteered 3 is dropped, reads as unrated and holds, so the run never signs off), set c3d8ce72.
beforeEach(() => setHeldForTest(DEMAND));
afterEach(() => setHeldForTest(null));

// the ruling as `rulingsOf` hands it to runChain: dated at pass 1, so the first panel's prompt carries it
const RULING = { gate: 'g1', pass: 1, text: 'Replace E5 by the amended R19.', channel: 'session', actor: 'main-session', person_words: 'Yes, replace E5 by the amended R19.', at: '2026-11-04T12:00:00.000Z' };

// what the run recorded about ratings: the whole severity record (every objection's rating in force and every re-tag), as JSON
const ratingsOf = done => JSON.stringify(done.result.severityRun ?? null);
const differs = (a, b) => ratingsOf(a) !== ratingsOf(b);

test('T22x-1 a run with an approved ruling records exactly the ratings of the same run without it, and the ruling really was in force (its prompt carries it)', async () => {
  const without = await scenario({ answerBack: true, ladder: false, l1Severity: 3, extra: { maxRounds: 3 } });
  const withIt = await scenario({ answerBack: true, ladder: false, l1Severity: 3, extra: { maxRounds: 3 }, runExtra: { rulings: [RULING] } });
  assert.notEqual(ratingsOf(without), 'null', 'the run records a severity record at all (else the comparison below is empty)');
  assert.match(withIt.prompts.get('panel-1-la').user, /# Rulings by the person who owns this request/, 'the ruling was carried by the judges\' prompt');
  assert.doesNotMatch(without.prompts.get('panel-1-la').user, /# Rulings by the person/);
  assert.equal(differs(without, withIt), false, `a ruling changed a rating: ${ratingsOf(without)} versus ${ratingsOf(withIt)}`);
  assert.equal(withIt.result.passed, without.result.passed, 'and it changed no outcome');
});

test('T22x-2 (the comparison can fail) two runs whose ratings really differ are reported as different', async () => {
  const a = await scenario({ answerBack: true, ladder: false, l1Severity: 3, extra: { maxRounds: 3 } });
  const b = await scenario({ answerBack: true, ladder: false, l1Severity: 2, extra: { maxRounds: 3 } });
  assert.equal(differs(a, b), true, 'a different rating is a difference');
});
