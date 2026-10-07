// 0.8.2 audit fixes, Tier 1 item 1: the quote-span family (cnc-debate F1, cnc-prompts-parsers F1 + F2, 73-verdicts 1 + 3, 73-config F1).
// Two readers, two needs: a debate post is DETECTED as quoting (data only), a judge's withdrawal must quote the draft (it changes when a run passes). $0, offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { quotedSpans, quotesTarget, evidenceSpans } from '../src/post-quotes.js';
import { applyAnswers } from '../src/answer-back.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OWN = [{ id: 'O-aaaaaaaa', criterion: 'C1', problem: 'p1' }];
const withdraw = (evidence, draft) => applyAnswers({ lab: 'a', critique: { failures: [], answers: [{ id: 'O-aaaaaaaa', status: 'withdrawn', evidence }] }, own: OWN, shownDraft: draft, round: 2 });
const effect = (evidence, draft) => withdraw(evidence, draft).records[0].effect;
const DRAFT = 'The cache is cleared on every write. Reads go through one shared cache with a five minute TTL.';

test('cnc-prompts F1 / 73-verdicts 1: two short quoted terms with prose between them are not a span (the prose is not a quote), in both readers', () => {
  assert.deepEqual(quotedSpans('The `TTL` is now invalidated by `API` calls here.'), []);
  assert.deepEqual(evidenceSpans('The `TTL` is now invalidated by `API` calls here.'), []);
  assert.equal(effect('The `owner` and the `rollback` are now named.', 'deployed by the CI job and the release script, now named'), 'withdrawal_refused', 'neither term is in the draft: the words between them are not a quote');
  assert.equal(effect('`X` now reads the shared `Y`', 'now reads the shared cache'), 'withdrawal_refused');
  assert.equal(effect('"cache" is now fine, "ok"', 'the plan is now fine here'), 'withdrawal_refused');
  assert.equal(quotesTarget('The `cache` and the `queue` are coupled', 'x and the y'), false, 'a debate post: "and the" between two quoted terms is not a quote');
});

test('73-verdicts 1: a short quoted term BEFORE the real quote does not use up the real quote\'s opening delimiter', () => {
  assert.equal(effect('The `cache` is now fixed by `cleared on every write` in Section 4.', DRAFT), 'withdrawn');
  assert.deepEqual(quotedSpans('The `TTL` is now invalidated by `cleared on every write` in Section 4.'), ['cleared on every write']);
  assert.equal(quotesTarget('The `TTL` is wrong; see `cleared on every write` here.', DRAFT), true);
});

test('cnc-prompts F1: a correct short exact quote (`Redis`) counts as quoted in a debate post; a one-or-two-letter quote and an apostrophe still do not', () => {
  assert.equal(quotesTarget('`Redis` is a single point of failure', 'Uses Redis as the store.'), true);
  assert.equal(quotesTarget('`Redis` is a single point of failure', 'Uses Memcached as the store.'), false);
  assert.deepEqual(quotedSpans('it says "no" and it\'s fine'), []);
});

test('cnc-debate F1 / 73-config F1: a faithful copy of a paragraph longer than 400 characters is a withdrawal', () => {
  const para = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} says the cache is cleared.`).join(' ');
  assert.ok(para.length > 1000);
  assert.equal(effect(`\`${para}\``, `Intro.\n\n${para}\n\nOutro.`), 'withdrawn');
  assert.equal(effect(`\`${para.slice(0, 399)}\``, `Intro.\n\n${para}`), 'withdrawn');
  assert.equal(effect(`\`${para} and then something that is not in the draft\``, `Intro.\n\n${para}`), 'withdrawal_refused', 'a long span is still checked against the draft');
});

test('cnc-debate F1: straight and curly quotes and apostrophes are the same on both sides', () => {
  assert.equal(effect('`the plan doesn\'t name an owner`', 'Note: the plan doesn’t name an owner.'), 'withdrawn');
  assert.equal(effect('`the plan doesn’t name an owner`', 'Note: the plan doesn\'t name an owner.'), 'withdrawn');
  assert.equal(effect('“the dead-letter table is listed”', 'The "dead-letter table" is listed in section 3.'), 'withdrawn');
  assert.equal(effect('"the dead-letter table is listed"', 'The “dead-letter table” is listed in section 3.'), 'withdrawn');
});

test('73-verdicts 3: a quote that is empty after normalising (underscores, asterisks, spaces) closes nothing', () => {
  for (const e of ['`________`', '"        "', '`********`', '`**__**__`', '``', '"   "']) assert.equal(effect(e, DRAFT), 'withdrawal_refused', e);
  assert.equal(quotesTarget('`________`', 'some target text'), false);
  assert.equal(effect('`short`', 'a short draft'), 'withdrawal_refused', 'a withdrawal span is at least 8 characters AFTER normalising');
});

test('the old shapes still work: a span across a line break, a > blockquote line, a long unclosed quote is linear', () => {
  assert.deepEqual(quotedSpans('It says "one shared\ncache" there.'), ['one shared\ncache']);
  assert.deepEqual(quotedSpans('> every read goes through one cache\nand then'), ['every read goes through one cache']);
  assert.equal(effect('> Reads go through one shared cache with a five minute TTL.', DRAFT), 'withdrawn');
  const t0 = Date.now();
  for (const open of ['"', '`', '“', '«']) { quotedSpans(open.repeat(100000)); evidenceSpans(open.repeat(100000) + ' x'); quotedSpans(open + 'x'.repeat(200000)); evidenceSpans(`${open} ab `.repeat(30000)); }
  assert.ok(Date.now() - t0 < 3000, `linear on unclosed delimiters (${Date.now() - t0} ms)`);
});

test('cnc-prompts F2: in patch mode a withdrawal is matched against the draft alone, never the "Was:" blocks or the harness\'s own sentences', () => {
  const src = readFileSync(join(root, 'src', 'chain.js'), 'utf8');
  const call = src.split('\n').find(l => l.includes('applyAnswers({'));
  assert.ok(call, 'the applyAnswers call site');
  assert.match(call, /shownDraft: draft,/, 'shownDraft is the draft, not draft + changedSince(lastPatches)');
  assert.equal(/shownDraft: draft \+/.test(call), false);
});
