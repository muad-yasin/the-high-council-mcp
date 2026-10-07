// Wiring item (6), P4: the "[no quote]" mark before the colon (4a), the canary through the same marker (4c), the gloss for the reply prompts (4b) and the poster's quoting sentence (4d). Held sentences
// (src/held-roles.js; drafted in test/held-prompts/held.js); used only in a chain with debate_hygiene.noQuoteMarks. $0, offline.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, setPromptSpy } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import * as H from './held-prompts/held.js';
import * as R from '../src/roles.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chain = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));
afterEach(() => { setHeldForTest(null); setPromptSpy(null); });
const ALL = { replyUserMarked: H.replyUserMarked, altReplyUserMarked: H.altReplyUserMarked, noQuoteGloss: H.noQuoteGloss, debatePostQuoteRule: H.debatePostQuoteRule };
const BEFORE = { skip: 'replyUserMarked' in R && 'recorded in src/roles.js: this describes the state before the re-record' };

const P = [{ id: 'proposer-a-1', lab: 'a', title: 'Cache', serves: 'C1', what: 'One shared cache.', why: 'Latency.', how: 'TTL five minutes.', acceptance_test: 'Hit rate above 90%.' }];
const A = [{ id: 'alt-a', lab: 'a', name: 'Monolith', shape: 'One process.', key_tradeoffs: 'Simple.', bad_at: 'Scale.' }];
const maps = { labTo: { a: 'Lab A', b: 'Lab B', c: 'Lab C', canary: 'Lab C' }, idTo: { 'proposer-a-1': 'A-1', 'alt-a': 'A-1' }, idFrom: {} };
const post = (by, stance, text, extra = {}) => ({ by, on: 'proposer-a-1', stance, text, ...extra });
const POSTS = [
  post('b', 'object', 'The cache is a bottleneck.', { quoted: false }),
  post('c', 'object', 'Why "One shared cache"?', { quoted: true }),
  post('b', 'merge', 'Fold it into mine.', { quoted: false, merge_with: 'proposer-a-1' }),
  post('c', 'support', 'Agreed.'),
  post('b', 'object', 'The cache is a bottleneck.', { quoted: false }),
];
const args = (posts, guard) => ({ request: 'Req', proposals: P, posts, lab: 'a', maps, guard });
const altArgs = (posts, guard) => ({ request: 'Req', alternatives: A, posts: posts.map(x => ({ ...x, on: 'alt-a' })), lab: 'a', maps, guard });

test('4a fidelity: with no unquoted post the held reply prompts are byte-identical to replyUser / altReplyUser (the copy is a copy), with and without the guard', () => {
  const plain = [post('b', 'object', 'x', { quoted: true }), post('c', 'support', 'y'), post('b', 'merge', 'z', { merge_with: 'proposer-a-1' }), post('c', 'object', 'Old shape, no quoted field')];
  for (const guard of [false, true]) {
    assert.equal(H.replyUserMarked(args(plain, guard)), R.replyUser(args(plain, guard)), `guard ${guard}`);
    assert.equal(H.altReplyUserMarked(altArgs(plain, guard)), R.altReplyUser(altArgs(plain, guard)), `alt, guard ${guard}`);
    assert.equal(H.replyUserMarked(args([], guard)), R.replyUser(args([], guard)));
  }
});

test('4a: the mark sits before the colon, next to the stance; support and quoted posts are not marked; the guard keeps its de-duplication, order and hidden names', () => {
  const out = H.replyUserMarked(args(POSTS, false));
  assert.match(out, /^- Lab B - object \[no quote\]: The cache is a bottleneck\.$/m);
  assert.match(out, /^- Lab C - object: Why "One shared cache"\?$/m);
  assert.match(out, /^- Lab B - merge with A-1 \[no quote\]: Fold it into mine\.$/m);
  assert.match(out, /^- Lab C - support: Agreed\.$/m);
  const g = H.replyUserMarked(args(POSTS, true));
  assert.match(g, /^- object \[no quote\]: The cache is a bottleneck\.$/m);
  assert.equal((g.match(/The cache is a bottleneck/g) || []).length, 1, 'the same argument twice is shown once');
  assert.equal(/Lab B|Lab C/.test(g.split('# Your proposals')[1].replace(/\(you are Lab A\)/, '').replace(/\(by Lab A\)/, '')), false, 'authors stay withheld');
  assert.ok(g.indexOf('- object [no quote]') < g.indexOf('- merge'), 'objections first');
  assert.match(H.altReplyUserMarked(altArgs(POSTS, false)), /^- Lab B - object \[no quote\]: The cache is a bottleneck\.$/m);
});

const go = async (extra = {}) => {
  const cfg = { ...chain('mock-debate'), debate_hygiene: { noQuoteMarks: true }, canary: { enabled: true, sampleRate: 1 }, ...extra };
  const seen = [];
  setPromptSpy(p => seen.push(p));
  const r = await runChain({ request: 'Write a short fixture deliverable.', config: cfg, runId: 'r-4a', log: () => {} });
  return { r, seen };
};
const MARK = '[no quote]';

test('4a-4d before the re-record: the prompts of a noQuoteMarks chain are the ones that were always sent (no mark, no gloss, no poster sentence), and the canary record says no mark was rendered', BEFORE, async () => {
  const { r, seen } = await go();
  assert.ok(seen.length > 5);
  assert.ok(seen.every(p => !p.user.includes(MARK) && !p.system.includes(MARK) && !p.system.includes('inside backticks')));
  assert.equal(r.canary?.no_quote_mark, false);
});

test('4a-4d door: in a noQuoteMarks chain the author\'s reply prompt carries the mark on an unquoted objection, the reply system says what it means, the debate system tells posters to copy the phrase in backticks; the canary is shown through the same mark and the report says so', async () => {
  setHeldForTest(ALL);
  // Audit fix cnc-prompts F1 (supersedes the old 8-character minimum): a correct short exact quote ("mock.js", 7 characters, found in the proposal) now counts as quoted, so this door needs a proposer whose objections quote nothing.
  const base = chain('mock-debate');
  const { r, seen } = await go({ seats: { ...base.seats, proposers: base.seats.proposers.map(s => ({ ...s, model: 'mock-proposer-unquoted' })) } });
  const deb = seen.filter(p => p.label.startsWith('debate-') && !p.label.endsWith('-retry'));
  assert.ok(deb.length >= 1 && deb.every(p => p.system.includes('For object and merge, copy the phrase you are talking about from the proposal, inside backticks.')));
  const rep = seen.filter(p => /^reply-[^-]+$/.test(p.label) || /^reply-.*$/.test(p.label) && !p.label.endsWith('-retry'));
  assert.ok(rep.length >= 1 && rep.every(p => p.system.includes('A post marked [no quote] quotes nothing from the proposal it is about.')));
  assert.ok(rep.some(p => /^- .* - (object|merge)[^\n]*\[no quote\]: /m.test(p.user)), rep.map(p => p.user.slice(-300)).join('\n---\n'));
  const can = seen.filter(p => p.label.startsWith('canary-reply-'));
  assert.ok(can.length >= 1, seen.map(p => p.label).join(','));
  assert.ok(can.every(p => /^- .* - object \[no quote\]: /m.test(p.user) && p.system.includes('[no quote]')), can[0]?.user.slice(-400));
  assert.equal(r.canary.no_quote_mark, true);
  assert.equal(r.debate.posts.find(p => p.canary)?.quoted, undefined, 'the recorded canary post is not changed by showing it marked');
});

test('4a-4d: a chain without noQuoteMarks gets none of it, even when the sentences exist', async () => {
  setHeldForTest(ALL);
  const { seen, r } = await go({ debate_hygiene: undefined });
  assert.ok(seen.every(p => !p.user.includes(MARK) && !p.system.includes(MARK) && !p.system.includes('inside backticks')));
  assert.equal(r.canary?.no_quote_mark, undefined);
});

test('4a on the alternatives stage: the alternatives debate records `quoted` too, and the alternative author\'s reply prompt carries the mark and the gloss; the alternatives debate prompt carries the poster sentence', async () => {
  setHeldForTest(ALL);
  const base = chain('mock-tiered');
  const cfg = { ...base, debate_hygiene: { noQuoteMarks: true }, seats: { ...base.seats, alternatives: base.seats.alternatives.map(s => ({ ...s, model: 'mock-alt-unquoting' })) } };
  const seen = [];
  setPromptSpy(p => seen.push(p));
  const r = await runChain({ request: 'Write a short fixture deliverable.', config: cfg, runId: 'r-4a-alt', log: () => {} });
  const posts = r.alternatives?.posts || [];
  assert.ok(posts.some(p => p.stance === 'object' || p.stance === 'merge'), JSON.stringify(posts).slice(0, 300));
  assert.ok(posts.filter(p => p.stance !== 'support').every(p => typeof p.quoted === 'boolean'), JSON.stringify(posts).slice(0, 400));
  const rep = seen.filter(p => p.label.startsWith('alt-reply-'));
  assert.ok(rep.length >= 1 && rep.every(p => p.system.includes('A post marked [no quote]')));
  assert.ok(rep.some(p => /^- (.* - )?(object|merge)[^\n]*\[no quote\]: /m.test(p.user)), rep.map(p => p.user.slice(-300)).join('\n---\n'));
  assert.ok(seen.filter(p => p.label.startsWith('alt-debate-')).every(p => p.system.includes('inside backticks')));
});
