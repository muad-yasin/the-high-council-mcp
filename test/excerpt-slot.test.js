// 0.8.4 D38 (C&C 09 Nov 2026, option I; conditions 2 and 3): the placement of the excerpt block is ONE pure function (src/excerpt-slot.js) with three pinned cases, tested directly: a head given -> the block directly after
// the head; no head -> the true end of the text; an empty block -> the very same string. Plus: the head of a critic prompt is a pure prefix of the full prompt (every variant, so naming it as the placement head changes
// nothing while caching is off), and invoke() holds no excerpt state of its own (a source scan). Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { placeExcerptBlock } from '../src/excerpt-slot.js';
import * as R from '../src/roles.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BLOCK = '# Project excerpts added during this run\n\n## E-1: src/a.js\n\ntext';

test('case 1, a head given: the block follows the head directly, the rest of the prompt follows the block', () => {
  const head = '# Original request\n\nPlan.\n\n# Draft under review\n\nThe plan.';
  const tail = '\n\n# Rulings by the person\n\nRuling 1.\n\n# Reply identity\n\nreview_id: abc';
  const out = placeExcerptBlock(`${head}${tail}`, BLOCK, head);
  assert.equal(out, `${head}\n\n${BLOCK}${tail}`);
  assert.equal(placeExcerptBlock(head, BLOCK, head), `${head}\n\n${BLOCK}`, 'a prompt that is only its head: the block ends it');
});

test('case 2, no head: the block is at the true end of the text, after any directive', () => {
  const user = 'Revise the plan.\n\nGive your verdict now.';
  assert.equal(placeExcerptBlock(user, BLOCK), `${user}\n\n${BLOCK}`);
  assert.equal(placeExcerptBlock(user, BLOCK, undefined), `${user}\n\n${BLOCK}`);
  assert.equal(placeExcerptBlock(user, BLOCK, null), `${user}\n\n${BLOCK}`);
});

test('case 3, an empty block: the very same string, with or without a head (no byte moves while nothing is recorded)', () => {
  const user = 'A prompt.\n\nWith a tail.';
  for (const block of ['', undefined, null]) for (const head of [undefined, 'A prompt.']) assert.equal(placeExcerptBlock(user, block, head), user, JSON.stringify([block, head]));
  const s = 'x'.repeat(50); assert.ok(placeExcerptBlock(s, '') === s);
});

test('a head that is not the start of the prompt is a call-site error: it throws and nothing is placed', () => {
  assert.throws(() => placeExcerptBlock('A prompt.', BLOCK, 'Another start'), /not the start of the prompt/);
  assert.throws(() => placeExcerptBlock('A prompt.', BLOCK, ''), /not the start of the prompt/);
  assert.throws(() => placeExcerptBlock('A prompt.', BLOCK, 42), /not the start of the prompt/);
});

test('R.criticUserHead is a pure prefix of the full criticUser text for every variant (so naming it as the placement head changes nothing while caching is off)', () => {
  const base = { request: 'Plan a tea service.', criteria: ['It states its assumptions.', 'It lists the steps.'], draft: '# Plan\n\n1. Boil.' };
  const prior = [{ lab: 'la', verdict_line: 'One criterion failed.', failures: [{ criterion: 'It lists the steps.', problem: 'No pour step.' }] }];
  const variants = [base, { ...base, checks: '\n\n# How the checkable criteria are settled\n\nCriterion 2 is settled by counting.' }, { ...base, prior }, { ...base, answeredQuestion: { question: 'Which tea?', answer: 'Black.' } }, { ...base, endMarker: true }, { ...base, endMarker: true, prior, answeredQuestion: { question: 'q', answer: 'a' }, checks: '\n\nChecks.' }];
  for (const [i, v] of variants.entries()) {
    const head = R.criticUserHead(v); const full = R.criticUser(v);
    assert.ok(full.startsWith(head), `variant ${i}`);
    assert.equal(placeExcerptBlock(full, '', head), full);
    assert.ok(placeExcerptBlock(full, BLOCK, head).startsWith(`${head}\n\n${BLOCK}`));
  }
});

test('the layer exchange heads are pure prefixes of the full debate and reply texts (so naming a head as the placement head changes nothing while caching is off)', () => {
  const base = { request: 'Plan a tea service.', criteria: ['It states its assumptions.', 'It lists the steps.'], draft: '# Plan\n\n1. Boil.' };
  const objections = [{ id: 'O-1', criterion: 'It lists the steps.', quote: '1. Boil.', problem: 'No pour step.' }, { id: 'O-2', criterion: 'It states its assumptions.', problem: 'None stated.', earlier: { posts: [{ round: 1, mine: false, stance: 'support', text: 'Agreed.' }] } }];
  const items = [{ id: 'O-1', criterion: 'It lists the steps.', problem: 'No pour step.', posts: [{ stance: 'support', text: 'Yes.' }] }];
  const debateFull = R.layerDebateUser({ ...base, objections });
  const replyFull = R.layerReplyUser({ ...base, items });
  for (const [name, head, full] of [['debate', R.layerDebateUserHead(base), debateFull], ['reply', R.layerReplyUserHead(base), replyFull]]) {
    assert.ok(head.length > 0 && head.length < full.length, name);
    assert.ok(full.startsWith(head), `${name}: the head is a prefix of the full text`);
    assert.equal(placeExcerptBlock(full, '', head), full, `${name}: an empty block changes nothing`);
    assert.ok(placeExcerptBlock(full, BLOCK, head).startsWith(`${head}\n\n${BLOCK}`), `${name}: the block follows the head`);
    assert.ok(placeExcerptBlock(full, BLOCK, head).endsWith(full.slice(head.length)), `${name}: the rest of the text follows the block unchanged`);
  }
});

test('source scan: invoke() holds no excerpt state, it asks the reader runChain sets; the reader is restored when a run returns (a nested run shows no excerpt)', () => {
  const src = readFileSync(join(root, 'src', 'chain.js'), 'utf8');
  const from = src.indexOf('async function invokeCall(seat,');
  assert.ok(from > 0);
  const invoke = src.slice(from, src.indexOf('\n}\n', from));
  assert.match(invoke, /const block = excerptReader \? excerptReader\(label\) : ''/);
  assert.doesNotMatch(invoke, /excerptBlockShown|recordedLabels|excerptsVisible/);
  assert.match(src, /const outerExcerptReader = excerptReader; excerptReader = null;/);
  assert.match(src, /excerptReader = outerExcerptReader;/);
});

test('source scan: a call site that keeps a copy of the prompt for a repair pause hands the PLACED text to it (the resume is held to the hash of what was sent)', () => {
  const src = readFileSync(join(root, 'src', 'chain.js'), 'utf8');
  const pauses = [...src.matchAll(/(nearJsonPause|tablePause)\([^;]*?(askedPrompt|rrPrompt)\.user[^;]*?\)/g)].map(m => m[0]);
  assert.ok(pauses.length >= 4, `the four repair-pause sites are found (${pauses.length})`);
  for (const c of pauses) assert.match(c, /sentUserOf\(cs, (askedPrompt|rrPrompt)\.user\)/, c);
  assert.match(src, /const stage = await invokeCall\(seat, opts, sent\);/);
});

test('the one call that reads no plan is excluded BY NAME with its reason; every other label (the harness helpers that carry the draft or the objections included) gets the block', async () => {
  const { NOT_A_SEAT, isNotASeat } = await import('../src/excerpt-slot.js');
  assert.ok(NOT_A_SEAT.length === 1 && NOT_A_SEAT.every(r => typeof r.reason === 'string' && r.reason.length > 10), 'one exclusion, with its reason');
  assert.equal(isNotASeat('preflight-mock-a'), true);
  for (const l of ['canary-reply-x', 'conflict-3', 'claims', 'argued', 'security-review', 'ambiguity-a', 'questions', 'criteria', 'criteria-retry', 'alternative-a', 'skeleton', 'propose-a', 'debate-a', 'reply-a', 'build', 'panel-1-a', 'panel-2-a-retry', 'critique-1', 'revise-1', 'dispute', 'dispute-review-a', 'challenge', 'final', 'cold-read', 'final-read-l3a', 'ldebate-1-a', 'lreply-1-a', 'rule-1-a', 'handoff', 'notes-answer', 'deep-dive-a-1', 'deep-dive-revise', 'allocator-1']) assert.equal(isNotASeat(l), false, l);
});

test('source scan: the layer exchange calls name their head unconditionally (the block follows the plan, not the closing sentence), and their repair pauses keep the placed text', () => {
  const src = readFileSync(join(root, 'src', 'chain.js'), 'utf8');
  assert.equal((src.match(/blockAfter: R\.layerDebateUserHead\(\{ request, criteria, draft \}\), \.\.\.\(exchangeCallCarriesHead/g) || []).length, 1);
  assert.equal((src.match(/blockAfter: R\.layerReplyUserHead\(\{ request, criteria, draft \}\), \.\.\.\(exchangeCallCarriesHead/g) || []).length, 1);
  assert.equal((src.match(/ask\.system, sentUserOf\(st, ask\.user\)/g) || []).length, 4, 'the four exchange repair pauses');
  assert.doesNotMatch(src, /ask\.system, ask\.user/);
});
