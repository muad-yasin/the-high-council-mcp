// Roadmap item 30 (found while building item 27, 7 Oct 2026; Muad's yes via C&C): a judge with open objections that is UNHEARD in a round where every other judge signs off used to lose them.
// The run goes on to the next round with no revise, and answer-back data was set only at a revise, so in that next round the judge was not shown its objections and its answers were not read:
// a plain clean sign-off passed the run. The same false pass as Astra's F1, through another door. $0, offline: every reply comes from a label-keyed cache.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { objectionId } from '../src/objection-ids.js';
import { promptHashOf } from '../src/cache-integrity.js';
import * as HN from './held-prompts/held-next.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); });

const criterion = 'The plan defines a retry limit.';
const failure = { criterion, problem: 'No retry limit is specified.', fix: 'Specify a retry limit.' };
const ID = objectionId('la', failure);
const DRAFT = 'The worker retries failed requests.';
const verdict = (meets, extra = {}) => JSON.stringify({ meets, criteria: [{ criterion, verdict: meets ? 'MET' : 'FAILED', evidence: meets ? 'Checked.' : 'No limit appears.' }], failures: meets ? [] : [failure], verdict_line: meets ? 'Pass.' : 'Limit missing.', ...extra });
const SECTION = '# Your objections from the last round';

// `replies(label)` returns the judge's reply text for a panel label, or null for the default (a clean sign-off with no answers). Builder and reviser return the same draft every time.
async function run(replies, { maxRounds = 4, dispute = null } = {}) {
  const hashes = new Map(); const prompts = new Map();
  setBudget(null);
  setPromptSpy(p => { hashes.set(p.label, promptHashOf(p.system, p.user)); prompts.set(p.label, p.user); });
  setCache({ get(label) {
    const text = label.startsWith('panel-') ? (replies(label) ?? verdict(true)) : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0, promptHash: hashes.get(label) };
  } });
  const seat = lab => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000 });
  const r = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-30', log: () => {}, config: {
    name: 'fixture-30', criteria: [criterion], maxRounds, signoff: 'unanimous', answer_back: { enabled: true }, ...(dispute ? { dispute } : {}),
    seats: { builder: seat('writer'), reviser: seat('writer'), critics: [seat('la'), seat('lb')] },
  } });
  return { r, prompts };
}
const UNREADABLE = 'I could not finish my review';
// Round 1: la objects. Round 2: la's reply and both re-asks are unreadable, lb signs off, so the round goes on with no revise. Round 3: la is asked again.
// From round 3 on, la gives `later` every time (so a run cannot pass merely because a later round lets it go).
const unheardInRound2 = later => label => label === 'panel-1-la' ? verdict(false) : /^panel-2-la/.test(label) ? UNREADABLE : /^panel-([3-9]|\d\d)-la/.test(label) ? later : null;

test('30: in the round after it was unheard, the judge is shown its objections again, and a SUSTAINED answer keeps the run from passing', async () => {
  const { r, prompts } = await run(unheardInRound2(verdict(true, { answers: [{ id: ID, status: 'sustained', evidence: '`The worker retries failed requests.`' }] })));
  assert.ok(prompts.has('panel-2-la-reask2'), [...prompts.keys()].join(', '));
  assert.equal(prompts.has('revise-2'), false, 'round 2 had nothing to revise');
  assert.ok(prompts.get('panel-3-la').includes(SECTION), 'shown its objections in round 3');
  assert.equal(prompts.has('panel-3-lb'), false, 'the clean judge of round 2 is carried, not asked again');
  assert.equal(r.passed, false);
  assert.deepEqual(r.answerBackReplies.filter(x => x.round === 3).map(x => [x.lab, x.effect]), [['la', 'sustained']]);
  assert.deepEqual(r.answerBack.filter(x => x.round === 3).map(x => [x.lab, x.objection_ids]), [['la', [ID]]], 'report.json says what round 3 showed, and to whom');
});

test('30 + 27: a plain clean sign-off with no `answers` in that round is re-asked and, still silent, keeps the objection open', async () => {
  setHeldForTest({ criticUnansweredNote: HN.criticUnansweredNote });
  const { r, prompts } = await run(unheardInRound2(null));
  assert.ok(prompts.get('panel-3-la').includes(SECTION));
  assert.ok(prompts.get('panel-3-la-reask1')?.includes('it gave no answer for your objection'), [...prompts.keys()].join(', '));
  assert.equal(r.passed, false);
});

test('30: a quoted withdrawal in that round closes the objection and the run passes; a judge with nothing open is never shown the section', async () => {
  const { r, prompts } = await run(unheardInRound2(verdict(true, { answers: [{ id: ID, status: 'withdrawn', evidence: '`The worker retries failed requests.`' }] })));
  assert.equal(r.passed, true);
  assert.equal([...prompts].some(([label, user]) => label.includes('-lb') && user.includes(SECTION)), false);
});

test('30: an objection the judge withdrew (with a quote) is not shown again after a later unheard round', async () => {
  // Round 1: la objects. Round 2: la withdraws with a quote but lb objects, so the draft is revised. Round 3: la unreadable, lb signs off: no revise. Round 4: la asked again.
  const replies = label => label === 'panel-1-la' ? verdict(false)
    : label === 'panel-2-la' ? verdict(true, { answers: [{ id: ID, status: 'withdrawn', evidence: '`The worker retries failed requests.`' }] })
      : label === 'panel-2-lb' ? JSON.stringify({ meets: false, criteria: [{ criterion, verdict: 'FAILED', evidence: 'x' }], failures: [{ criterion, problem: 'Other gap.', fix: 'y' }], verdict_line: 'No.' })
        : /^panel-3-la/.test(label) ? UNREADABLE : null;
  const { prompts } = await run(replies, { maxRounds: 5 });
  assert.ok(prompts.has('panel-4-la'), [...prompts.keys()].join(', '));
  assert.equal(prompts.get('panel-4-la').includes(SECTION), false, 'la had no open objection after round 2: nothing to show');
});

test('30 + 27: a judge that never answers is still bounded: the dispute stage stops the run on the same objection, not the round cap', async () => {
  setHeldForTest({ criticUnansweredNote: HN.criticUnansweredNote });
  const { r } = await run(label => label === 'panel-1-la' ? verdict(false) : null, { maxRounds: 7, dispute: { enabled: true } });
  assert.equal(r.passed, false);
  assert.equal(r.dispute?.reason, 'stalled', JSON.stringify(r.dispute && { reason: r.dispute.reason, at: r.dispute.stopped_at_round }));
  assert.ok(r.dispute.stopped_at_round < 7, `before the round cap (round ${r.dispute.stopped_at_round})`);
  assert.ok(r.dispute.open_objections.some(o => o.lab === 'la'), 'the open objection is la\'s, on the record');
});
