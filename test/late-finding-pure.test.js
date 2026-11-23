// 0.8.4 S4b (M1), U3-1: the PURE parts of the late finding and of the last round of the ending exchange (D24, Q1(g), Q12, W26; T22a, T22b, T22v, T22w, T22u, T17z). No chain run, no model, $0.
// Namespace imports and a guarded dynamic import, so on a tree without the new options or modules each row fails by assertion and the file still loads (the red tree).
// T17z's collision: two DIFFERENT problem texts that hash to the same eight hex digits for the seat 'raiser-alpha' and the criterion 'The plan defines a retry limit.' were FOUND by a brute-force search over 'The limit case <n> is not covered.'
// (n = 1, 2, ...; sha256 over seat NUL criterion-key NUL normalised-problem, first eight hex digits, exactly as src/objection-ids.js lateFindingKey reads them; the first repeat was n = 30118 and n = 30565, hash 118adebe). No hash seam in src.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as LD from '../src/layer-debate.js';
import * as IDS from '../src/objection-ids.js';
const LF = await import('../src/late-finding.js').catch(() => ({}));

const DRAFT = 'The worker retries failed requests at most three times.';
const CRITERION = 'The plan defines a retry limit.';
const SHOWN = [{ id: 'O-aaaaaaaa', key: 'x', criterion: CRITERION, problem: 'No owner.' }];
const post = body => LD.readPosts(body, { shown: SHOWN, draft: DRAFT, severity: true, lastRound: true });

test('T22a / T22v: the last round reads the field late_finding: criterion, quoted passage and rating are kept (8.5 stays 8.5), nothing is minted as an objection and nothing goes to proposed', () => {
  const got = post({ posts: [], late_finding: { criterion: CRITERION, problem: 'There is no back-off between retries.', quote: 'retries failed requests', rating: 8.5 } });
  assert.deepEqual(got.late, [{ problem: 'There is no back-off between retries.', criterion: CRITERION, quote: 'retries failed requests', rating: 8.5, flags: [] }]);
  assert.deepEqual([got.news, got.proposed], [[], []], 'a late finding mints no objection and is never "proposed"');
  const several = post({ late_finding: [{ criterion: CRITERION, problem: 'First.', quote: 'retries failed requests', rating: 5 }, { criterion: CRITERION, problem: 'Second.', quote: 'at most three times', rating: 3.5 }] });
  assert.deepEqual(several.late.map(l => [l.problem, l.rating]), [['First.', 5], ['Second.', 3.5]]);
});
test('T22b / T22w: a rating that is missing or invalid (11, a word, none) keeps the finding UNRATED with the reason; nothing is retried (the parse is the only step)', () => {
  for (const rating of [11, 'high', undefined]) {
    const got = post({ late_finding: { criterion: CRITERION, problem: 'A defect.', quote: 'retries failed requests', ...(rating !== undefined ? { rating } : {}) } });
    assert.equal(got.late.length, 1, String(rating));
    assert.equal(got.late[0].rating, null, String(rating));
    assert.equal(typeof got.late[0].rating_refused, 'string', String(rating));
  }
});
test('Q-i4: no criterion, no quote, or a quote the plan does not hold: the finding is kept and flagged ungrounded with why, never dropped; a finding with no text at all is not recorded', () => {
  const got = post({ late_finding: [
    { problem: 'No criterion.', quote: 'retries failed requests', rating: 5 },
    { criterion: CRITERION, problem: 'No quote.', rating: 5 },
    { criterion: CRITERION, problem: 'A quote the plan lacks.', quote: 'exponential back-off with jitter', rating: 5 },
    { criterion: CRITERION, quote: 'retries failed requests', rating: 5 },
  ] });
  assert.deepEqual(got.late.map(l => [l.problem, l.flags, l.ungrounded_why]), [['No criterion.', ['ungrounded'], 'no_criterion'], ['No quote.', ['ungrounded'], 'no_quote'], ['A quote the plan lacks.', ['ungrounded'], 'quote_not_in_plan']]);
});
test('Q-i5: an entry of new_objections in the last round is NOT minted and NOT dropped: it is a late finding flagged named_as_objection', () => {
  const got = post({ new_objections: [{ criterion: CRITERION, problem: 'Named as an objection.', quote: 'retries failed requests', severity: 6 }] });
  assert.deepEqual([got.news, got.proposed], [[], []]);
  assert.deepEqual(got.late.map(l => [l.problem, l.rating, l.flags]), [['Named as an objection.', 6, ['named_as_objection']]]);
});
test('control: in an ordinary round (lastRound off) the same new_objections entry is minted as before and `late` is absent', () => {
  const got = LD.readPosts({ new_objections: [{ criterion: CRITERION, problem: 'A new defect.', quote: 'retries failed requests', severity: 6 }] }, { shown: SHOWN, draft: DRAFT, severity: true });
  assert.equal(got.news.length, 1); assert.equal(got.late, undefined);
});
test('T22u: in the last round a raiser\'s amend is invalid (amend_in_last_round): it counts as no reply and records no amended text; keep and withdraw are read as before', () => {
  const own = [{ id: 'O-aaaaaaaa', criterion: CRITERION, shown: [{}] }];
  const amend = LD.readReplies({ replies: [{ id: 'O-aaaaaaaa', action: 'amend', text: 'Right in part.', problem: 'The back-off is missing.' }] }, { own, draft: DRAFT, noAmend: true });
  assert.deepEqual([amend[0].action, amend[0].invalid, amend[0].invalid_reason], ['amend', true, 'amend_in_last_round']);
  const ordinary = LD.readReplies({ replies: [{ id: 'O-aaaaaaaa', action: 'amend', text: 'Right in part.', problem: 'The back-off is missing.' }] }, { own, draft: DRAFT });
  assert.equal(ordinary[0].invalid, undefined, 'control: an amend is valid in an ordinary round');
  const keep = LD.readReplies({ replies: [{ id: 'O-aaaaaaaa', action: 'keep', text: 'It stands.' }] }, { own, draft: DRAFT, noAmend: true });
  assert.equal(keep[0].invalid, undefined);
});

// ---- the id: T17z ----
const A = 'The limit case 30118 is not covered.'; const B = 'The limit case 30565 is not covered.';
test('T17z: two findings of one seat and criterion with different texts whose hashes collide get L-118adebe and L-118adebe#2; no collision means no suffix; the same text twice is one finding', () => {
  assert.equal(IDS.lateFindingKey('raiser-alpha', { criterion: CRITERION, problem: A }).base, 'L-118adebe');
  assert.equal(IDS.lateFindingKey('raiser-alpha', { criterion: CRITERION, problem: B }).base, 'L-118adebe', 'the forced collision');
  const ids = LF.assignLateFindingIds([{ lab: 'raiser-alpha', criterion: CRITERION, problem: A }, { lab: 'raiser-alpha', criterion: CRITERION, problem: B }]).map(f => f.id);
  assert.deepEqual(ids, ['L-118adebe', 'L-118adebe#2']);
  const third = LF.assignLateFindingIds([{ lab: 'raiser-alpha', criterion: CRITERION, problem: A }, { lab: 'raiser-alpha', criterion: CRITERION, problem: 'A different text.' }, { lab: 'mid-beta', criterion: CRITERION, problem: A }]);
  assert.equal(third.length, 3); assert.equal(third.filter(f => f.id.includes('#')).length, 0, 'no collision, no suffix (and another seat\'s key is its own)');
  assert.equal(third[0].id === third[2].id, false, 'the seat is part of the key');
  assert.equal(LF.assignLateFindingIds([{ lab: 'raiser-alpha', criterion: CRITERION, problem: A }, { lab: 'raiser-alpha', criterion: CRITERION, problem: '  the limit CASE 30118 is not covered. ' }]).length, 1, 'the same text, normalised, is the same finding');
});
test('lateFindingRow: the record keeps the finder\'s words, the rating or "read as 4 or above", the flags, the mark "not debated, found in the last round" and an empty sorting', () => {
  const rated = LF.lateFindingRow({ id: 'L-1', lab: 'a', criterion: CRITERION, problem: 'p', quote: 'q', rating: 8.5, flags: [], round: 7 });
  assert.deepEqual([rated.rating, rated.rating_read_as, rated.found, rated.not_debated, rated.sorted, rated.round], [8.5, undefined, 'ending_exchange_last_round', true, null, 7]);
  const unrated = LF.lateFindingRow({ id: 'L-2', lab: 'a', problem: 'p', rating: null, rating_refused: 'out_of_range', flags: ['ungrounded'], round: 7 });
  assert.deepEqual([unrated.rating, unrated.rating_read_as, unrated.rating_refused, unrated.flags, 'criterion' in unrated], [null, '4 or above', 'out_of_range', ['ungrounded'], false]);
});

test('renderLateFindingsBoard / withLateFindings (shown to the handler, D24): the highest rating is read first, an unrated finding sits with the 4s and says so, a list with nothing in it adds no section', () => {
  const rows = [
    LF.lateFindingRow({ id: 'L-aaaaaaa1', lab: 'a', criterion: CRITERION, problem: 'Low.', rating: 2, flags: [], round: 7 }),
    LF.lateFindingRow({ id: 'L-bbbbbbb2', lab: 'b', problem: 'Unrated.', rating: null, rating_refused: 'out_of_range', flags: ['ungrounded'], round: 7 }),
    LF.lateFindingRow({ id: 'L-ccccccc3', lab: 'c', criterion: CRITERION, problem: 'High.', quote: 'retries failed requests', rating: 8.5, flags: [], round: 7 }),
  ];
  const board = LF.renderLateFindingsBoard(rows);
  const at = ['L-ccccccc3', 'L-bbbbbbb2', 'L-aaaaaaa1'].map(id => board.indexOf(id));
  assert.ok(at[0] > -1 && at[0] < at[1] && at[1] < at[2], 'order 8.5, then the unrated (read as 4), then 2: ' + at.join(','));
  assert.ok(board.includes('not rated, read as 4 or above'));
  const handoff = LF.withLateFindings('# Handoff\n', rows);
  assert.ok(handoff.startsWith('# Handoff\n\n## Late findings (not debated)'));
  assert.ok(handoff.indexOf('L-ccccccc3') < handoff.indexOf('L-bbbbbbb2') && handoff.indexOf('L-bbbbbbb2') < handoff.indexOf('L-aaaaaaa1'));
  assert.equal(LF.renderLateFindingsBoard([]), ''); assert.equal(LF.withLateFindings('# Handoff\n', []), '# Handoff\n');
});

test('C&C item 5: a late_finding entry with no text, an entry that is not an object and a field that is neither an object nor a list are counted in `dropped` with a reason, never silent; an ordinary round is unchanged', () => {
  const got = post({ late_finding: [{ criterion: CRITERION, quote: 'retries failed requests', rating: 5 }, 'a bare string', { criterion: CRITERION, problem: 'Kept.', quote: 'retries failed requests', rating: 5 }], new_objections: [{ criterion: CRITERION, quote: 'retries failed requests' }] });
  assert.deepEqual(got.late.map(l => l.problem), ['Kept.']);
  assert.deepEqual(got.dropped.map(d => d.reason), ['late_finding_no_text', 'late_finding_unreadable', 'late_finding_no_text']);
  assert.deepEqual(post({ late_finding: 'it is broken' }).dropped.map(d => d.reason), ['late_finding_unreadable']);
  assert.deepEqual(LD.readPosts({ new_objections: [{ criterion: CRITERION }] }, { shown: SHOWN, draft: DRAFT, severity: true }).dropped, [], 'control: an ordinary round drops a textless new objection as it always did');
});
