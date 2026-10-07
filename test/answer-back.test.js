// 0.8.2 item 3 (owner decision 3, 5 Oct 2026; ticket 10): the data a judge will be shown about its own earlier objections from round 2 on. Data only: no prompt reads it yet. $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changedPassages, buildAnswerBack, answerBackSummary } from '../src/answer-back.js';
import { runChain } from '../src/chain.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chain = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));

test('changedPassages: paragraphs that are new or changed, not the ones that only moved or differ in spacing and case; capped', () => {
  const before = 'Intro.\n\nThe cache has a TTL.\n\nSecond   section here.';
  const after = 'Intro.\n\nthe cache has a ttl.\n\nA brand new paragraph.\n\nSecond section here.\n\nAnother new one.';
  assert.deepEqual(changedPassages(before, after), ['A brand new paragraph.', 'Another new one.']);
  assert.equal(changedPassages('a', 'b\n\nc\n\nd', { max: 2 }).length, 2);
  assert.equal(changedPassages('', 'x'.repeat(5000), { maxChars: 100 })[0].length, 100);
  assert.deepEqual(changedPassages('same', 'same'), []);
});

test('buildAnswerBack: one entry per lab that objected, with its own objections by id, the round\'s declined reasons and the changed passages; summary has counts only', () => {
  const failures = [{ lab: 'a', id: 'O-11111111', criterion: 'C1', problem: 'p1', quote: 'q1' }, { lab: 'b', id: 'O-22222222', criterion: 'C2', problem: 'p2' }, { lab: 'a', id: 'O-33333333', criterion: 'C3', problem: 'p3' }];
  const out = buildAnswerBack({ failures, declined: ['not a defect'], oldDraft: 'one', newDraft: 'one\n\ntwo' });
  assert.deepEqual(Object.keys(out).sort(), ['a', 'b']);
  assert.deepEqual(out.a.objections.map(o => o.id), ['O-11111111', 'O-33333333']);
  assert.equal(out.a.objections[0].quote, 'q1');
  assert.deepEqual(out.b.declined, ['not a defect']);
  assert.deepEqual(out.a.changed_passages, ['two']);
  assert.deepEqual(answerBackSummary(2, out), [
    { round: 2, lab: 'a', objection_ids: ['O-11111111', 'O-33333333'], declined: 1, changed_passages: 1 },
    { round: 2, lab: 'b', objection_ids: ['O-22222222'], declined: 1, changed_passages: 1 }]);
});

test('a mock chain with answer_back.enabled records, for the next round, the ids of the judge\'s own objections; off: no key', async () => {
  const cfg = chain('mock-dispute');
  const on = await runChain({ request: 'A mock task.', config: { ...cfg, answer_back: { enabled: true } }, runId: 'r', log: () => {} });
  assert.ok(on.answerBack.length >= 1, 'a holdout that objects every round is answered after round 1');
  const first = on.answerBack[0];
  assert.equal(first.round, 2);
  const sawIds = new Set(on.signoff.flatMap(s => (s.objections || []).map(o => o.id)));
  for (const id of first.objection_ids) assert.ok(sawIds.has(id), `${id} is an id the judge's own objection carried in the report`);
  const off = await runChain({ request: 'A mock task.', config: cfg, runId: 'r', log: () => {} });
  assert.equal(off.answerBack, undefined);
});

// ---- 0.8.2 (owner ruling 6 Oct 2026, decision 3 "withdrawn (with a quote)"): a withdrawal with no quote from the draft does not count ----
import { applyAnswers } from '../src/answer-back.js';
import { objectionId } from '../src/objection-ids.js';

const OWN = [{ id: 'O-aaaaaaaa', criterion: 'C1', problem: 'p1' }, { id: 'O-bbbbbbbb', criterion: 'C2', problem: 'p2', quote: 'the old wording' }, { id: 'O-cccccccc', criterion: 'C3', problem: 'p3' }];
const DRAFT = 'The cache is cleared on every write. Reads go through one shared cache.';

test('applyAnswers: a withdrawal counts only with a quote found in the draft; a refused or sustained objection is carried; unknown ids and unanswered objections are recorded and change nothing', () => {
  const critique = { meets: true, failures: [], answers: [
    { id: 'O-aaaaaaaa', status: 'withdrawn', evidence: 'It now says "cleared on every write" so it is fixed.' },
    { id: 'O-bbbbbbbb', status: 'withdrawn', evidence: 'Fixed, I checked it.' },
    { id: 'O-zzzzzzzz', status: 'sustained', evidence: 'x' },
  ] };
  const r = applyAnswers({ lab: 'a', critique, own: OWN, shownDraft: DRAFT, round: 2 });
  assert.deepEqual(r.records.map(x => [x.id, x.effect]), [['O-aaaaaaaa', 'withdrawn'], ['O-bbbbbbbb', 'withdrawal_refused'], ['O-zzzzzzzz', 'unknown_id'], ['O-cccccccc', 'unanswered']]);
  assert.deepEqual(r.carried.map(c => c.id), ['O-bbbbbbbb']);
  assert.deepEqual(r.carried[0], { criterion: 'C2', problem: 'p2', fix: '', quote: 'the old wording', id: 'O-bbbbbbbb', carried_from_round: 1 });
  // a quote that is NOT in the draft is no quote
  const fake = applyAnswers({ lab: 'a', critique: { failures: [], answers: [{ id: 'O-aaaaaaaa', status: 'withdrawn', evidence: 'It says "a sentence the draft never had" now.' }] }, own: OWN, shownDraft: DRAFT, round: 2 });
  assert.equal(fake.records[0].effect, 'withdrawal_refused');
  // sustained is carried unless the judge listed it again (same lab, criterion, quote = same id)
  const sus = applyAnswers({ lab: 'a', critique: { failures: [{ criterion: 'C1', problem: 'reworded' }], answers: [{ id: 'O-aaaaaaaa', status: 'sustained' }, { id: 'O-bbbbbbbb', status: 'sustained' }] }, own: [{ ...OWN[0], id: objectionId('a', { criterion: 'C1' }) }, OWN[1]], shownDraft: DRAFT, round: 2 });
  assert.deepEqual(sus.carried.map(c => c.id), ['O-bbbbbbbb'], 'the sustained objection the judge did not list again is carried; the one it listed again is not');
  assert.equal(sus.carried.some(c => c.id === objectionId('a', { criterion: 'C1' })), false, 'already listed: not carried twice');
  assert.equal(applyAnswers({ lab: 'a', critique: { meets: true, failures: [] }, own: [], shownDraft: DRAFT, round: 2 }).records.length, 0);
  assert.deepEqual(applyAnswers({ lab: 'a', critique: { failures: [], answers: 'nonsense' }, own: OWN, shownDraft: DRAFT, round: 2 }).carried, [], 'a non-array answers is ignored');
});

const answerChain = (model, extra = {}) => {
  const base = chain('mock-unanimous');
  return { ...base, maxRounds: 3, ...extra, seats: { ...base.seats, critics: [{ provider: 'mock', model, lab: 'la' }, { provider: 'mock', model: 'mock-critic-cut-signoff-then-fits', lab: 'lb' }] } };
};
const goAnswers = (model, extra) => runChain({ request: 'Write a short fixture deliverable.', config: answerChain(model, extra), runId: 'r-ans', log: () => {} });

test('a judge that withdraws its objection WITH a quote from the draft lets the round pass; WITHOUT a quote, or only sustaining it, the objection stays open and the run does not pass', async () => {
  const on = { answer_back: { enabled: true } };
  const quoted = await goAnswers('mock-critic-answers-withdraw-quoted', on);
  assert.equal(quoted.passed, true, 'a quoted withdrawal closes the objection: the judge signs off');
  assert.deepEqual(quoted.answerBackReplies.map(r => [r.round, r.lab, r.effect, r.quoted]), [[2, 'la', 'withdrawn', true]]);

  const unquoted = await goAnswers('mock-critic-answers-withdraw-unquoted', on);
  assert.equal(unquoted.passed, false, 'a withdrawal with no quote does not count');
  assert.ok(unquoted.answerBackReplies.length >= 1 && unquoted.answerBackReplies.every(r => r.effect === 'withdrawal_refused' && r.quoted === false), JSON.stringify(unquoted.answerBackReplies));
  const carried = unquoted.signoff.find(s => s.provider === 'la' || s.lab === 'la')?.objections ?? unquoted.lastCritique.failures.filter(f => f.lab === 'la');
  assert.ok(carried.some(f => f.carried_from_round >= 1 && /^O-[0-9a-f]{8}$/.test(f.id)), 'the carried objection is on the record with its id and the round it was carried from');

  const sustained = await goAnswers('mock-critic-answers-sustain', on);
  assert.equal(sustained.passed, false);
  assert.ok(sustained.answerBackReplies.every(r => r.effect === 'sustained'));

  // off: the answers are ignored and the run passes as before (the rule changes when a run passes, so it is opt-in)
  const off = await goAnswers('mock-critic-answers-withdraw-unquoted', {});
  assert.equal(off.passed, true);
  assert.equal(off.answerBackReplies, undefined);
});
