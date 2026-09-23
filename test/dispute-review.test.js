// test/dispute-review.test.js
//
// Dispute review (2026-09-23, opt-in `dispute: { enabled: true, review: true }`). Muad: "Reviewers
// should check disputes thoroughly, no?" The dispute stage gives the reviser the last word on every
// open objection; this has the seat that raised each one check, in one call per seat, whether the
// final draft deals with it honestly. It can flag, never pass.
//
// mock-dispute's holdout critic (lab mock-holdout) holds the one open objection. The mock reviewer's
// verdict is scripted by a marker in the request (see src/providers.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as fsMod from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, renderDisputeReviewBoard, runDisputeReview } from '../src/chain.js';
import { lintChain } from '../src/chain-lint.js';
import { computeOutcome } from '../src/outcome.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chain = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));
const withReview = () => {
  const c = chain('mock-dispute');
  c.dispute = { ...c.dispute, review: true };
  return c;
};
const run = (config, request = 'A mock task.') => runChain({ config, request, log: () => {} });

test('off unless the chain opts in: no review call, no review field', async () => {
  const r = await run(chain('mock-dispute'));
  assert.equal(r.dispute.ran, true);
  assert.equal('review' in r.dispute, false, 'report.json must not grow a field on chains that did not ask');
  assert.ok(!r.stages.some(s => s.label.startsWith('dispute-review')));
});

test('no shipped chain enables it', () => {
  const { readdirSync } = fsMod;
  for (const f of readdirSync(join(root, 'chains')).filter(n => n.endsWith('.json'))) {
    const c = JSON.parse(readFileSync(join(root, 'chains', f), 'utf8'));
    assert.notEqual(c.dispute?.review, true, `${f} enables dispute.review`);
  }
});

test('one call per seat that held an open objection, through invoke(), with a stable label', async () => {
  const r = await run(withReview());
  const calls = r.stages.filter(s => s.label.startsWith('dispute-review'));
  assert.deepEqual(calls.map(s => s.label), ['dispute-review-mock-holdout'], 'only the holdout still objected');
  assert.equal(calls[0].lab, 'mock-holdout');
  assert.equal(calls[0].model, 'mock-critic-holdout', 'the objecting seat itself answers, not the reviser');
  assert.ok('usd' in calls[0] && 'usage' in calls[0], 'recorded like every invoke() stage, so the spend cap sees it');
});

test('an honest handling is recorded as accepted, with a quote that is really in the draft', async () => {
  const r = await run(withReview());
  const [e] = r.dispute.review.entries;
  assert.equal(e.verdict, 'accepted');
  assert.equal(e.lab, 'mock-holdout');
  assert.equal(e.quote_found, true);
  assert.deepEqual(r.dispute.review.counts, { accepted: 1, misrepresented: 0, silently_dropped: 0, unconfirmed: 0 });
  assert.match(r.deliverable, /Dispute review: every seat that held an open objection confirmed/);
  assert.equal(r.passed, false, 'a clean review never turns the run into a pass');
  assert.match(JSON.stringify(computeOutcome(r)), /no.?consensus/i);
});

for (const [marker, verdict, flag] of [
  ['TRIGGER_REVIEW_MISREP', 'misrepresented', 'MISREPRESENTED'],
  ['TRIGGER_REVIEW_DROPPED', 'silently_dropped', 'SILENTLY DROPPED'],
]) {
  test(`${verdict} is flagged at the top of the deliverable, inside the dissent block`, async () => {
    const r = await run(withReview(), `A mock task. ${marker}`);
    assert.equal(r.dispute.review.entries[0].verdict, verdict);
    const d = r.deliverable;
    assert.match(d, /^## Unresolved dissent/);
    const flagAt = d.indexOf(flag);
    assert.ok(flagAt > 0 && flagAt < d.indexOf('\n---\n'), 'the flag must be in the top block, before the plan');
    assert.match(d, /Dispute review: 1 objection\(s\) not confirmed as honestly handled/);
  });
}

test('a quote that is not in the final draft makes the verdict unconfirmed, never accepted', async () => {
  const r = await run(withReview(), 'A mock task. TRIGGER_REVIEW_FAKEQUOTE');
  const [e] = r.dispute.review.entries;
  assert.equal(e.claimed_verdict, 'accepted');
  assert.equal(e.verdict, 'unconfirmed');
  assert.equal(e.reason, 'quote not found in the final draft');
  assert.match(r.deliverable, /NOT CONFIRMED/);
});

test('an unreadable review is unconfirmed, never read as consent', async () => {
  const r = await run(withReview(), 'A mock task. TRIGGER_REVIEW_UNREADABLE');
  const [e] = r.dispute.review.entries;
  assert.equal(e.verdict, 'unconfirmed');
  assert.equal(e.reason, 'unreadable reply');
});

test('BOARD.md section lists every objection with the verdict and the quote', async () => {
  const r = await run(withReview(), 'A mock task. TRIGGER_REVIEW_FAKEQUOTE');
  const board = renderDisputeReviewBoard(r.dispute);
  assert.match(board, /^\n\n## Dispute review/);
  assert.match(board, /\*\*unconfirmed\*\* - It states the assumptions it was written under\. \(mock-holdout\); seat said "accepted"; quote not found in the final draft/);
  assert.match(board, /Quote: "This sentence is not in the draft\." \(not found in the final draft\)/);
  assert.equal(renderDisputeReviewBoard({ ran: true }), '');
  assert.equal(renderDisputeReviewBoard(undefined), '');
});

test('chain-lint: review must be a boolean and needs the dispute stage on', () => {
  const base = chain('mock-dispute');
  assert.deepEqual(lintChain({ ...base, dispute: { enabled: true, review: true } }, 'x.json'), []);
  assert.ok(lintChain({ ...base, dispute: { enabled: true, review: 'yes' } }, 'x.json').some(f => /dispute\.review must be a boolean/.test(f.message)));
  assert.ok(lintChain({ ...base, dispute: { enabled: false, review: true } }, 'x.json').some(f => /does nothing unless dispute\.enabled/.test(f.message)));
});

test('one call covers all of a seat\'s objections; a skipped one and a seatless lab stay unconfirmed', async () => {
  const config = { seats: { critics: [{ provider: 'mock', model: 'x', lab: 'lab-a' }] } };
  const openFailures = [
    { criterion: 'C1', lab: 'lab-a', problem: 'p1' },
    { criterion: 'C2', lab: 'lab-a', problem: 'p2' },
    { criterion: 'C3', lab: 'lab-gone', problem: 'p3' },
  ];
  const seen = [];
  const invoke = async (seat, { user, label }) => {
    seen.push({ label, n: (user.match(/<critic-claim>/g) || []).length });
    return { label, text: JSON.stringify({ reviews: [{ objection: 1, verdict: 'accepted', quote: 'the   final\ndraft', note: 'ok' }] }) };
  };
  const r = await runDisputeReview(config, { request: 'q', openFailures, draftBefore: 'before', draftAfter: 'this is the final draft text', invoke, record: s => s });
  assert.deepEqual(seen, [{ label: 'dispute-review-lab-a', n: 2 }], 'one call for lab-a carrying both of its objections');
  assert.deepEqual(r.entries.map(e => e.verdict), ['accepted', 'unconfirmed', 'unconfirmed']);
  assert.equal(r.entries[0].quote_found, true, 'whitespace differences in a quote are not a mismatch');
  assert.equal(r.entries[1].reason, 'objection not answered');
  assert.equal(r.entries[2].reason, 'no panel seat for this lab');
});

test('control flow (budget cap, denied model) is never swallowed into "unconfirmed"', async () => {
  const config = { seats: { critics: [{ provider: 'mock', model: 'x', lab: 'lab-a' }] } };
  const boom = Object.assign(new Error('cap'), { controlFlow: true });
  await assert.rejects(
    runDisputeReview(config, { request: 'q', openFailures: [{ criterion: 'C1', lab: 'lab-a' }], draftBefore: '', draftAfter: '', invoke: async () => { throw boom; }, record: s => s }),
    /cap/,
  );
  const r = await runDisputeReview(config, { request: 'q', openFailures: [{ criterion: 'C1', lab: 'lab-a' }], draftBefore: '', draftAfter: '', invoke: async () => { throw new Error('503'); }, record: s => s });
  assert.equal(r.entries[0].verdict, 'unconfirmed');
  assert.match(r.entries[0].reason, /seat unreachable: 503/);
});
