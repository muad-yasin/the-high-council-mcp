// 0.8.4 S9 + S9a, the proposer return: the batch block of test/held-prompts/held-084-s9.js (the pairing convention of test/held-prompts.test.js: held-084-<x>.js is owned by held-prompts-084-<x>.test.js). Recorded all together or not at all;
// every function has calls here; a recorded one renders exactly as drafted; no name is drafted in two batches. The plan's words (W8, W10, W13, W29(ii)) are pinned below by clause body (substring), because W10 is ONE sentence in the plan
// and this step splits it across three calls: the only edits are "Then," and "and" dropped and a capital letter at the start of each piece.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../src/roles.js';
import * as HS9 from './held-prompts/held-084-s9.js';
import * as HS8 from './held-prompts/held-084-s8.js';

const heldDir = join(dirname(fileURLToPath(import.meta.url)), 'held-prompts');
const otherBatches = await Promise.all(readdirSync(heldDir).filter(f => f.endsWith('.js') && f !== 'held-084-s9.js').map(f => import(`./held-prompts/${f}`)));

const OBJ = { criterion: 'The plan keeps one database.', problem: 'Decision 2 picks two stores.', fix: 'Pick one.' };
const ALT = { choice: 'One store', trade_offs: 'Simpler, less scale', why_original_wins_or_loses: 'The original loses on cost' };
const CALLS_S9 = {
  decisionLevelRule: [[]],
  decisionLevelKeys: [[]],
  proposerReturnAltUser: [[{ request: 'Build X', criteria: ['A', 'B'], skeleton: 'Sk', plan: 'Plan text', number: 2, entryText: 'Decision 2\nChoice: two stores', choice: 'two stores', objection: OBJ }], [{ request: 'R', criteria: ['A'], plan: 'P', number: 1, entryText: 'E', choice: 'C', objection: { criterion: 'K', problem: 'Q' } }], [{}]],
  proposerReturnPostUser: [[{ request: 'R', criteria: ['A', 'B'], number: 2, entryText: 'E', choice: 'two stores', objection: OBJ, alternatives: [ALT, { ...ALT, choice: 'Other' }] }], [{}]],
  proposerReturnAnswerUser: [[{ request: 'R', criteria: ['A'], number: 2, entryText: 'E', choice: 'two stores', objection: OBJ, own: ALT, posts: ['post one', 'post two'] }], [{}]],
  proposerReturnSystem: [[]],
  proposerReturnReplyForm: [['alt'], ['post'], ['answer'], ['other']],
  decisionsNumberingRule: [[]],
  returnIntegrationNote: [[{ number: 2, entryText: 'E', objection: OBJ, alternatives: [ALT], posts: ['p'], answers: ['a'] }], [{ number: 2, entryText: 'E', objection: OBJ }], [{}]],
  noProposerRouteNote: [[{ number: 2, entryText: 'E', objection: OBJ }], [{}]],
  layerThreeSortingRouteClause: [[]],
  noProposerSortingRouteClause: [[]],
  layerThreeSortingRouteKey: [[{ proposers: true }], [{ proposers: false }], [{}]],
};

test('the S9 batch of the 0.8.4 build (held-084-s9.js): recorded all together or not at all, a recorded one renders exactly as drafted, and no name is drafted in two batches', () => {
  const names = Object.keys(HS9).filter(n => typeof HS9[n] === 'function');
  assert.deepEqual(Object.keys(CALLS_S9).sort(), names.slice().sort(), 'every drafted S9 function has calls here: add one when you draft one');
  assert.deepEqual(names.filter(n => otherBatches.some(m => n in m)), [], 'a name drafted in more than one batch');
  const recorded = names.filter(n => n in R);
  assert.ok(recorded.length === 0 || recorded.length === names.length, `a partial S9 re-record: ${recorded.join(', ')} are in src/roles.js, ${names.filter(n => !(n in R)).join(', ')} are not (the missing ones would be silently skipped)`);
  for (const name of recorded) for (const args of CALLS_S9[name]) assert.equal(R[name](...args), HS9[name](...args), `${name}: src/roles.js renders differently from test/held-prompts/held-084-s9.js`);
});

test('the plan\'s words are in the drafts: W8, W13 (both sentences), W29(ii) whole; W10 by clause body, across the three calls', () => {
  assert.equal(HS9.decisionLevelRule(), 'If you object, say whether the objection is about a decision or about wording. It is about a decision only if fixing it would change which option a Decisions entry chooses; then name the entry, quote its Choice line and cite the criterion it fails and the earlier decision, if any, that it contradicts. Otherwise it is about wording. If you raise several objections about decisions, say which one matters most; if you do not, the first one you list is taken.');   // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: `If you raise several such objections` (W8) and, for W29(i), `...and name the entry (W8).`. NEW: `If you raise several objections about decisions` and `...say so and name the entry.` WHY: the reviewed rows edited the held file and src/prompts/recorded-084-s9.js:12 and :102 together (the apply, commit 1).
  assert.equal(HS9.decisionsNumberingRule(), 'Number each entry of your Decisions section (Decision 1, Decision 2, and so on) and keep an entry\'s number when you revise.');
  const integ = HS9.returnIntegrationNote({ number: 2, entryText: 'E', objection: OBJ });
  assert.ok(integ.startsWith('For the decision named below, integrate one of the alternatives, or keep the original and give your reasons; record the others in that entry\'s options and why-lost fields.'));
  const route = HS9.noProposerRouteNote({ number: 2, entryText: 'E', objection: OBJ });
  assert.ok(route.startsWith('For the decision named below, reconsider the Choice: keep it and give your reasons, or change it, and record the options you weighed in that entry\'s options and why-lost fields.'));
  const alt = HS9.proposerReturnAltUser(CALLS_S9.proposerReturnAltUser[0][0]);
  assert.ok(alt.includes('A reviewer objects to one decision of the plan:'));
  assert.ok(alt.endsWith('Without seeing the other proposers\' answers, write an alternative choice for this decision only, with its trade-offs and why the original wins or loses.'));
  // CHANGED ACCEPTED TEST (0.8.4 apply, job 12 row 'the plan's words are in the drafts'): OLD: the second and third return calls ended with the plan's W10 clause bodies, 'Reading the others\' alternatives without their authors, write one post on them together.' and 'Answer once on the posts on yours.'. NEW: they end with the reviewed sentences that replaced them at the wording review: 'Write one post covering the other proposers\' alternatives for this decision. Their identities are hidden.' (S9-w4, Astra ADOPT) and 'Write one answer to the posts on your alternative.' (NS-0304, Astra AMEND), both in Review/084/wording-batch/v2/RESOLVED_LIST.md and applied by f60ebad2 in test/held-prompts/held-084-s9.js and src/prompts/recorded-084-s9.js. WHY: error 'The expression evaluated to a falsy value: assert.ok(HS9.proposerReturnPostUser(...).endsWith(...))' (line 53 of the old file; line 54 follows with the same cause): W10's plan wording is no longer the text, and the first row of this file (R[name](...args) === HS9[name](...args)) pins the recorded text to the held mirror. The expected endings are the reviewed literals, not the code under test.
  assert.ok(HS9.proposerReturnPostUser(CALLS_S9.proposerReturnPostUser[0][0]).endsWith('Write one post covering the other proposers\' alternatives for this decision. Their identities are hidden.'));
  assert.ok(HS9.proposerReturnAnswerUser(CALLS_S9.proposerReturnAnswerUser[0][0]).endsWith('Write one answer to the posts on your alternative.'));
});

test('Q10(b): the first call carries the request, the criteria, the skeleton (only when there is one), the plan, the numbered entry and the objection; nothing can name the raising seat', () => {
  const full = HS9.proposerReturnAltUser(CALLS_S9.proposerReturnAltUser[0][0]);
  for (const part of ['# Request\n\nBuild X', '1. A\n2. B', '# Skeleton of the plan\n\nSk', '# The current plan\n\nPlan text', '(Decision 2)', 'Decision 2\nChoice: two stores', 'The Choice line: two stores', 'Criterion: The plan keeps one database.', 'Problem: Decision 2 picks two stores.', 'Fix proposed: Pick one.']) assert.ok(full.includes(part), `missing: ${part}`);
  const noSk = HS9.proposerReturnAltUser(CALLS_S9.proposerReturnAltUser[1][0]);
  assert.ok(!noSk.includes('# Skeleton of the plan'), 'no skeleton section when the run had none');
  assert.ok(!noSk.includes('Fix proposed'), 'no fix line when the objection carries none');
  // the objection is built from criterion, problem and fix ONLY: a seat, lab or model key on the object never reaches the text
  const leaky = HS9.proposerReturnAltUser({ ...CALLS_S9.proposerReturnAltUser[0][0], objection: { ...OBJ, lab: 'anthropic', seat: 'critic-3', model: 'claude-x', raised_by: { lab: 'anthropic' } } });
  assert.doesNotMatch(leaky, /anthropic|critic-3|claude-x|raised_by/);
});

test('the post and the answer calls show anonymised numbered items only, and the answer shows the posts handed to it (never a third source)', () => {
  const post = HS9.proposerReturnPostUser({ ...CALLS_S9.proposerReturnPostUser[0][0], alternatives: [ALT, { ...ALT, choice: 'Other' }] });
  for (const part of ['The Choice line: two stores', 'Criterion: The plan keeps one database.', 'Problem: Decision 2 picks two stores.']) assert.ok(post.includes(part), `post call missing: ${part}`);
  assert.match(post, /Alternative 1\nChoice: One store/);
  assert.match(post, /Alternative 2\nChoice: Other/);
  const ans = HS9.proposerReturnAnswerUser({ ...CALLS_S9.proposerReturnAnswerUser[0][0], posts: ['first post', 'second post'] });
  for (const part of ['The Choice line: two stores', 'Criterion: The plan keeps one database.', 'Problem: Decision 2 picks two stores.']) assert.ok(ans.includes(part), `answer call missing: ${part}`);
  assert.match(ans, /# Your alternative\nChoice: One store/);
  // CHANGED ACCEPTED (PR #2 fix unit, item 4): OLD: /Post 1\nfirst post\n\nPost 2\nsecond post/. NEW: a post's text is indented four spaces from its first line, as its continuation lines are, so a post that starts with a forged "Post 9" line cannot read as another post (text another model wrote never starts a line of the prompt).
  assert.match(ans, /Post 1\n    first post\n\nPost 2\n    second post/);
});

test('the integration note leaves an empty list out and keeps the others in order', () => {
  const none = HS9.returnIntegrationNote({ number: 3, entryText: 'E', objection: OBJ });
  assert.doesNotMatch(none, /Alternatives from the proposers|Posts on the alternatives|Answers to the posts/);
  const all = HS9.returnIntegrationNote({ number: 3, entryText: 'E', objection: OBJ, alternatives: [ALT], posts: ['p'], answers: ['a'] });
  assert.ok(all.indexOf('Alternatives from the proposers:') < all.indexOf('Posts on the alternatives:') && all.indexOf('Posts on the alternatives:') < all.indexOf('Answers to the posts:'));
});

test('the route (S9-R1): W7\'s route clause is in S8\'s recorded W7 exactly once (the anchor stage-system.js replaces); W29(i) is the plan\'s words; the key sentence names the key', () => {
  const w7 = HS8.layerThreeSortingRule();
  assert.equal(w7.split(HS9.layerThreeSortingRouteClause()).length - 1, 1, 'FAIL = S8\'s W7 no longer carries the plan\'s route clause once, so W29(i) has no place to go');
  assert.equal(HS9.noProposerSortingRouteClause(), 'For each must-do, name the route that would repair it: the writer. If fixing the objection would change which option a Decisions entry chooses, say so and name the entry.');
  assert.equal(HS9.layerThreeSortingRouteKey({ proposers: true }), 'For each must-do entry add the field "route": "writer" or "proposers".');
  assert.equal(HS9.layerThreeSortingRouteKey({ proposers: false }), 'For each must-do entry add the field "route": "writer".');
});
