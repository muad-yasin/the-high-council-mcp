// 0.8.2 item 3 (owner decision 2): a debate post that quotes nothing of the proposal it is about is detected (data only; the mark an author sees waits for the prompt list). $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { quotedSpans, quotesTarget, markPostQuote, itemText } from '../src/post-quotes.js';
import { runChain } from '../src/chain.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const P = { id: 'A-1', lab: 'a', title: 'Cache layer', what: 'Every read goes through one shared **cache** with a five minute TTL.', why: 'Latency.' };

test('quotedSpans: a span across a line break and a "> " blockquote line count (the review finding); a long unclosed quote does not make the regex slow', () => {
  assert.deepEqual(quotedSpans('It says "one shared\ncache" there.'), ['one shared\ncache']);
  assert.deepEqual(quotedSpans('> every read goes through one cache\nand then'), ['every read goes through one cache']);
  const t0 = Date.now();
  quotedSpans('"' + 'x'.repeat(200000)); quotedSpans('`' + 'y '.repeat(100000)); quotedSpans('> ' + 'z'.repeat(200000));
  assert.ok(Date.now() - t0 < 1500, 'bounded and linear on a long unclosed quote');
  assert.equal(quotesTarget('"one shared\ncache"', 'there is one shared cache here'), true);
});

test('quotedSpans: quotes of at least 4 characters (once normalised) in "", curly quotes, backticks and guillemets; one-or-two-letter ones and apostrophes are not quotes (audit fix cnc-prompts F1: the minimum was 8)', () => {
  assert.deepEqual(quotedSpans('It says "one shared cache" and `five minute TTL` and “Latency matters” but "no" and it\'s fine.'), ['one shared cache', 'five minute TTL', 'Latency matters']);
  assert.deepEqual(quotedSpans('no quotes at all'), []);
});

test('quotesTarget: a span found in the proposal counts, whatever the case, emphasis or spacing; a span that is not in it does not; an empty target never matches', () => {
  assert.equal(quotesTarget('The plan says "ONE shared   cache" - that is a bottleneck.', itemText(P)), true);
  assert.equal(quotesTarget('The plan says "one global lock" - that is a bottleneck.', itemText(P)), false);
  assert.equal(quotesTarget('It is a bottleneck.', itemText(P)), false);
  assert.equal(quotesTarget('"anything at all"', ''), false);
});

test('markPostQuote: objections and merges are marked quoted true/false; support posts and unknown targets are left alone', () => {
  assert.equal(markPostQuote({ by: 'b', on: 'A-1', stance: 'object', text: 'Why "one shared cache"?' }, [P]).quoted, true);
  assert.equal(markPostQuote({ by: 'b', on: 'A-1', stance: 'merge', text: 'Fold it into mine.' }, [P]).quoted, false);
  assert.deepEqual(markPostQuote({ by: 'b', on: 'A-1', stance: 'support', text: 'Agreed.' }, [P]), { by: 'b', on: 'A-1', stance: 'support', text: 'Agreed.' });
  assert.equal(markPostQuote({ by: 'b', on: 'ZZ-9', stance: 'object', text: 'x "something long enough"' }, [P]).quoted, false, 'a post on an id that is not on the board quotes nothing of it');
});

test('a mock debate with debate_hygiene.noQuoteMarks records quoted on objection and merge posts; without the flag the posts are unchanged', async () => {
  const cfg = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  const go = extra => runChain({ request: 'Write a short fixture deliverable.', config: { ...cfg, ...extra }, runId: 'r', log: () => {} });
  const on = await go({ debate_hygiene: { noQuoteMarks: true } });
  const marked = on.debate.posts.filter(p => p.stance === 'object' || p.stance === 'merge');
  assert.ok(marked.length >= 1 && marked.every(p => typeof p.quoted === 'boolean'), JSON.stringify(on.debate.posts));
  assert.ok(on.debate.posts.filter(p => p.stance === 'support').every(p => !('quoted' in p)));
  const off = await go({});
  assert.ok(off.debate.posts.every(p => !('quoted' in p)), 'off: the post shape is byte-identical to before');
});

// ---- review of c40a25d..429fff4: what a poster could actually quote ----
test('markPostQuote: a phrase copied from what the poster was shown matches (the harness\'s \\# and &lt; escapes are undone); fields the poster never sees (id, lab, model) are not a target; a merge may quote the proposal it folds into', () => {
  const A = { id: 'proposer-a-1', lab: 'anthropic', model: 'claude-opus-4-1', title: 'Cache', what: '# Setup heading\nLoad <critic-claim> tags once.', why: 'Latency.' };
  const B = { id: 'proposer-b-1', lab: 'b', title: 'Layer', what: 'Use the cache layer.' };
  assert.equal(markPostQuote({ by: 'x', on: 'proposer-a-1', stance: 'object', text: 'It says "\\# Setup heading" and that is wrong.' }, [A, B]).quoted, true);
  assert.equal(markPostQuote({ by: 'x', on: 'proposer-a-1', stance: 'object', text: 'It says "Load &lt;critic-claim> tags once." and that is wrong.' }, [A, B]).quoted, true);
  for (const t of ['"claude-opus-4-1" is old', '`anthropic` is a lab', '"proposer-a-1" is a bad id']) assert.equal(markPostQuote({ by: 'x', on: 'proposer-a-1', stance: 'object', text: t }, [A, B]).quoted, false, t);
  assert.equal(markPostQuote({ by: 'x', on: 'proposer-a-1', stance: 'merge', merge_with: 'proposer-b-1', text: 'Fold into "Use the cache layer."' }, [A, B]).quoted, true);
  assert.equal(markPostQuote({ by: 'x', on: 'proposer-a-1', stance: 'object', merge_with: 'proposer-b-1', text: 'Fold into "Use the cache layer."' }, [A, B]).quoted, false, 'only a merge looks at its merge_with');
});
