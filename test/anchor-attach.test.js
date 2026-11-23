// 0.8.4 S14 (Q12, R22, D21; C&C R510/R517 conditions): a quote that arrives in the exchange is ATTACHED to the objection that had none, under the id it was raised with (T18c, T18i), and the stall reads it from then on.
// The mechanism: the raiser's reply (W24: keep or amend, not a withdrawal) or its own post (W1's clause, `own_quote`) carries a passage; exchangeRound attaches it when the objection still stands, has no quote and the plan holds the passage;
// runChainStages folds it into a map and overlays it at the fold of the pass's failures AFTER markFailures and AFTER the id (so the raise-time id is kept and a draft passage is never scored 'unverified'). Offline, mock seats, $0.
// Mock seats (src/providers.js, test-only): `mock-exch-<post>-<reply>`; the reply `keep-attach` / `amend-attach` give a passage of the plan beside the reply. Only exports that exist on the parent are imported (the new ones through a guarded import).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, setCache, setBudget, setPromptSpy } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import * as R from '../src/roles.js';
import * as HS14 from './held-prompts/held-084-s14.js';
import { readPosts } from '../src/layer-debate.js';
import * as LD from '../src/layer-debate.js';
import { objectionId } from '../src/objection-ids.js';
import { reportJsonShape } from '../src/report-shape.js';

afterEach(() => { setCache(null); setBudget(null); setPromptSpy(null); setHeldForTest(null); });
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seat = (model, lab, layer) => ({ provider: 'mock', model, lab, layer });
const chainOf = (critics, extra = {}) => ({
  name: 'anchor-attach-test', maxRounds: 2, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics },
  ...extra,
});
const go = async (config, request = 'A mock task.') => { const seen = []; setPromptSpy(p => seen.push(p)); const r = await runChain({ request, log: () => {}, runId: 'r-anchor-attach', config }); return { r, seen }; };
const CRITERION = 'It states the assumptions it was written under.';
const COARSE = lab => objectionId(lab, { criterion: CRITERION });   // an unquoted failure's id: the quote part of the hash is empty
const firstLineOf = seen => ((seen.find(p => p.label === 'lreply-1-e1')?.user.split('# Draft under review\n\n')[1] || '').split('\n').find(l => l.trim().length >= 8) || '').trim();
const rowOf = (r, lab) => r.layerDebates[0].objections.find(o => o.raised_by === lab);

test('AT-1 T18c: a raiser that KEEPS its objection and gives a passage of the plan beside the reply (W24) has that passage attached to the objection, under the id it was raised with, and the row names the reply that carried it', async () => {
  const { r, seen } = await go(chainOf([seat('mock-exch-contest-keep-attach', 'e1', 1), seat('mock-exch-contest-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)]));
  const row = rowOf(r, 'e1');
  assert.ok(row, 'the premise: e1 raised an objection that went through the exchange');
  const quote = firstLineOf(seen);
  assert.ok(quote.length >= 8, 'the premise: the draft has a first line');
  assert.equal(row.attached_quote, quote, 'the passage the reply gave is attached, as its OWN field (C&C R528 hold)');
  assert.equal(row.quote, undefined, '... and `quote` stays what the judge gave: nothing');
  assert.match(row.quote_attached_in, /^lreply-1-e1/, 'the stage whose reply carried it');
  assert.equal(row.id, COARSE('e1'), 'the id did not change: it is still the raise-time (coarse) id');
  assert.equal(rowOf(r, 'e2').quote_attached_in, undefined, 'e2 gave no passage: nothing is attached to its objection');
  assert.equal(rowOf(r, 'e2').quote, undefined);
});

test('AT-2 T18i: a raiser that AMENDS and gives a passage: the text is amended, the passage is attached, the id is unchanged (an amend alone adds no quote, RU-S14-08; the field goes with it)', async () => {
  const { r } = await go(chainOf([seat('mock-exch-contest-amend-attach', 'e1', 1), seat('mock-exch-contest-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)]));
  const row = rowOf(r, 'e1');
  assert.ok(row && row.original_problem, 'the premise: the objection was amended');
  assert.ok(row.attached_quote && row.quote_attached_in && !row.quote, 'the passage beside the amend is attached');
  assert.equal(row.id, COARSE('e1'));
});

test('AT-3 a WITHDRAWAL that gives a passage attaches nothing: the objection is closed (and a keep-only raiser attaches nothing either)', async () => {
  const { r } = await go(chainOf([seat('mock-exch-contest-withdraw', 'e1', 1), seat('mock-exch-contest-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)]));
  const row = rowOf(r, 'e1');
  assert.equal(row.outcome, 'withdrawn_argued');
  assert.equal(row.quote_attached_in, undefined);
  assert.equal(row.quote, undefined);
  assert.equal(row.attached_quote, undefined);
});

test('AT-4 the attached passage reaches the pass\'s failures AFTER the id: the report\'s lastCritique carries it for that objection (no `unanchored` flag, `quote_attached_in` named) under the same id; the objection that got none stays unanchored', async () => {
  const { r } = await go(chainOf([seat('mock-exch-contest-keep-attach-always', 'e1', 1), seat('mock-exch-contest-keep-always', 'e2', 1), seat('mock-critic-x', 'e3', 2)]));   // -always: the judges object to every draft, so the last critique still holds the objections
  const rep = reportJsonShape({ runId: 'x', chain: 'c', task: 't', result: r });
  assert.equal(JSON.stringify(rep).includes('attached_quote'), false, 'the run\'s internal field never reaches report.json: the record names the passage `quote` (R528)');
  assert.ok(rep.layer_debates[0].objections.some(o => o.raised_by === 'e1' && o.quote && o.quote_attached_in && !o.unanchored), 'and the exchange rows of the report carry it the same way');
  const mine = rep.lastCritique.failures.filter(f => f.lab === 'e1' && f.id === COARSE('e1'));
  const theirs = rep.lastCritique.failures.filter(f => f.lab === 'e2' && f.id === COARSE('e2'));
  assert.ok(mine.length >= 1 && theirs.length >= 1, `the premise: both objections reach the last critique: ${JSON.stringify(rep.lastCritique.failures.map(f => [f.lab, f.id]))}`);
  for (const f of mine) { assert.ok(f.quote && f.quote_attached_in, JSON.stringify(f)); assert.equal('unanchored' in f, false); assert.notEqual(f.quote_status, 'unverified', 'a draft passage is never scored unverified'); }
  for (const f of theirs) assert.equal(f.unanchored, true);
});

test('AT-5 reading the passage: quoteFound holds a passage of at least 8 normalised characters that the plan contains; readPosts reads `own_quote` only for the ids it was asked about, once each, in an ordinary round and in the last round of the ending exchange', () => {
  assert.equal(LD.quoteFound('The worker retries failed requests, three times.', 'retries failed requests'), true);
  assert.equal(LD.quoteFound('The worker retries failed requests.', 'a passage the plan lacks'), false);
  assert.equal(LD.quoteFound('The worker retries failed requests.', 'worker'), false, 'shorter than 8 characters');
  const parsed = { posts: [], own_quote: [{ id: 'O-aaaaaaaa', quote: 'retries failed requests' }, { id: 'O-aaaaaaaa', quote: 'second for the same id' }, { id: 'O-zzzzzzzz', quote: 'not asked' }, { id: 'O-bbbbbbbb' }, 'x'] };
  const draft = 'The worker retries failed requests.';
  assert.deepEqual(readPosts(parsed, { shown: [], draft, own: ['O-aaaaaaaa', 'O-bbbbbbbb'] }).own_quotes, [{ id: 'O-aaaaaaaa', quote: 'retries failed requests' }]);
  assert.deepEqual(readPosts(parsed, { shown: [], draft, own: ['O-aaaaaaaa'], lastRound: true }).own_quotes, [{ id: 'O-aaaaaaaa', quote: 'retries failed requests' }]);
  assert.equal('own_quotes' in readPosts({ posts: [] }, { shown: [], draft, own: ['O-aaaaaaaa'] }), false, 'no field when nothing was given: the shape of a post read is unchanged');
});

test('AT-6 T18e (the stall reads the attached passage): the overlay sits after markFailures and after the id at the single fold, and the stall input still reads each failure\'s own quote (so an attached passage changes quoteKey, which restarts the count, src/stall-book.js)', () => {
  const src = readFileSync(resolve(root, 'src', 'chain.js'), 'utf8');
  // CHANGED ACCEPTED (0.8.4 D41, 09 Nov 2026): the call gains a fourth argument, the recorded excerpts the seats were shown (`excerptsForQuotes()`); the overlay order this row pins is unchanged.
  // CHANGED ACCEPTED (0.8.4 D14, 09 Nov 2026). OLD: the call ended at `excerptsForQuotes())`. NEW: it ends at `excerptsForQuotes(), { request, criteria, rows: failedRowsOf(v.critique) })`. WHY: the located marks look a span up in the request and the criteria too, and in the FAILED rows of the verdict's table (src/quote-check.js markFailures); the overlay order this row pins is unchanged.
  assert.match(src, /markFailures\(v\.critique\.failures, fencedSource, shownDraft, excerptsForQuotes\(\), \{ request, criteria, rows: failedRowsOf\(v\.critique\) \}\)\.map\(f => \(\{ \.\.\.f, lab: seatKeyOf\(v\.seat\), id: objectionId\(seatKeyOf\(v\.seat\), f\) \}\)\)\.map\(f => \{ const at = f\.quote \? null : attachedQuotes\.get/, 'the overlay is the map AFTER the one that sets the id');
  assert.match(src, /return at \? \{ \.\.\.f, attached_quote: at\.quote, quote_attached_in: at\.from \} : f; \}\)/, 'the overlay spreads the failure into its OWN field attached_quote (R528: never quote), so quote_status (F7, made from the judge\'s own reply) is KEPT (R525); AT-7 drives it in a fenced run');
  assert.match(src, /const anchorQuote = f\.quote \|\| f\.attached_quote; const quoteKey = problemKey\(\{ quote: anchorQuote \}\); const present = quoteKey \? draftTight\.includes\(normQuoteTight\(anchorQuote\)\) : false;/, 'S5\'s stall input reads the judge\'s own quote, else the attached one (R528)');
});

test('AT-7 R525 (C&C): an attached passage is a STALL anchor, not an F7 check: a repo claim that carried no quote of its own and got a draft passage attached KEEPS its \'unquoted\' mark (quote_status) next to quote_attached_in, and its warning line stays in the log and in quoteFindings (FENCED run; the other judge\'s non-repo objection has no mark)', async () => {
  const lines = []; setPromptSpy(() => {});
  const config = chainOf([seat('mock-exch-contest-keep-attach-always-repoclaim', 'e1', 1), seat('mock-exch-contest-keep-always', 'e2', 1), seat('mock-critic-x', 'e3', 2)]);
  const r = await runChain({ request: 'Review this.\n\n```js\nconst retries = 3;\nexport const run = () => retries;\n```\n', log: l => lines.push(String(l)), runId: 'r-anchor-attach-7', config });
  const e1 = r.lastCritique.failures.find(f => f.lab === 'e1');
  assert.ok(e1, 'the premise: e1\'s objection reaches the last critique');
  assert.ok((e1.attached_quote ?? e1.quote) && e1.quote_attached_in, `the passage was attached (field-agnostic premise: the red of this row is the mark below): ${JSON.stringify([e1.attached_quote, e1.quote, e1.quote_attached_in])}`);
  assert.equal(e1.quote_status, 'unquoted', 'F7\'s mark is made from the judge\'s OWN reply and is kept');
  // At least once, not exactly once: the run-wide attach map re-overlays e1 at every later fold, and each fold warns again about its still-unquoted repo claim.
  const warned = l => /makes a claim about the repository without quoting the fenced source - kept, but nobody checked it/.test(l);
  assert.ok(lines.some(warned), 'its warning line is in the log (the fold where the overlay applied; at least once: a carried verdict may fold it again in a later round)');
  assert.ok((r.quoteFindings || []).some(warned), 'and in quoteFindings (log, record, report.json)');
  const e2 = r.lastCritique.failures.find(f => f.lab === 'e2');
  if (e2) assert.equal(e2.quote_status, undefined, 'a non-repo objection has no mark');
});

const FENCED = 'Review this.\n\n```js\nconst retries = 3;\nexport const run = () => retries;\n```\n';
const reviseOf = seen => seen.find(p => /^revise-1(-|$)/.test(p.label));
const twin = (attachModel, plainModel) => [attachModel, plainModel].map(m => chainOf([seat(m, 'e1', 1), seat('mock-exch-contest-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)]));

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: a row 'AT-8 R528 HOLD, half 1: with nothing recorded, the reviser prompt of a run in which a quote was ATTACHED equals, byte for byte, the prompt of the twin run in which it was not' sat here. NEW: removed; its sibling AT-9 (half 2) asserts the recorded state of the same prompt (the attached passage once, under the label's words, in the place of the quote-check status). WHY: attachedQuoteLabel is recorded (src/prompts/recorded-084-s14.js; src/chain.js attachedShown), so no shipped run is in the unrecorded state.

test('AT-9 R528 HOLD, half 2: with the held label set, the attached passage is in the reviser prompt ONCE, under the label\'s words in the place of the quote-check status (on the tree before the hold both halves fail: there the passage is shown with "(unquoted)" and no label can be set)', async () => {
  const label = HS14.attachedQuoteLabel();
  for (const [fenced, a] of [[false, 'mock-exch-contest-keep-attach'], [true, 'mock-exch-contest-keep-attach-repoclaim']]) {
    setHeldForTest({ attachedQuoteLabel: HS14.attachedQuoteLabel });
    const { r, seen } = await go(twin(a, a)[0], fenced ? FENCED : undefined);
    const passage = rowOf(r, 'e1').attached_quote ?? rowOf(r, 'e1').quote;   // field-agnostic: red on the tree before the hold is the label line, not this premise
    const pa = reviseOf(seen);
    assert.ok(passage && pa, `the premise: ${fenced}`);
    const claim = pa.user.split('<critic-claim>').slice(1).map(c => c.split('</critic-claim>')[0]).find(c => c.includes(R.claimText(passage))) ?? '';   // e1's claim block (never the prompt head: the draft, which holds the passage, comes before the first claim)
    assert.equal(claim.split(`Quote: "${R.claimText(passage)}" (${label})`).length - 1, 1, `the passage once, labelled, in e1's claim: ${fenced}`);
    assert.equal(claim.includes('(unquoted)'), false, `the label takes the status's place in e1's claim: ${fenced}`);
    setHeldForTest(null);
  }
});

test('AT-10 R530 (the firstSeen defect of the reported tree before the hold): an objection raised in pass 1 whose passage is attached only in pass 2 keeps first_raised_round 1 in the dispute record and the dissent line: the key must not move when the passage arrives (red on the tree where the passage went into quote)', async () => {
  const critics = [seat('mock-exch-contest-keep-attachlate-always', 'e1', 1), seat('mock-exch-contest-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)];
  const { r } = await go(chainOf(critics, { maxRounds: 2, dispute: { enabled: true, stall_rounds: 2 } }));
  const second = r.layerDebates.find(d => d.pass === 2)?.objections.find(o => o.raised_by === 'e1');
  assert.ok(second && (second.attached_quote ?? second.quote) && second.id === COARSE('e1'), `the premise: the passage was attached in pass 2 under the raise-time id: ${JSON.stringify(second && [second.attached_quote, second.quote, second.id])}`);
  const first = r.layerDebates.find(d => d.pass === 1)?.objections.find(o => o.raised_by === 'e1');
  assert.ok(first && !(first.attached_quote ?? first.quote), 'the premise: nothing was attached in pass 1');
  const open = (r.dispute?.open_objections || []).find(o => o.id === COARSE('e1'));
  assert.ok(open, `the premise: the objection is still open when the run stops: ${JSON.stringify(r.dispute && r.dispute.reason)}`);
  assert.equal(open.first_raised_round, 1, 'first raised in pass 1, not in the pass that attached its passage');
  assert.match(r.deliverable, /### [^\n]*\n\*Raised by e1[^\n]*, round 1, /, 'and the dissent block says round 1 too');
});
