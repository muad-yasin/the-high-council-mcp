// test/patch-revise.test.js
//
// Patch-mode reviser (2026-09-20), default off. The reviser rewrites the whole plan every
// round: the largest output cost in a run, and worse, an invitation to drift - a model asked to
// reproduce 4,000 words while fixing three sentences quietly rewords the other 3,900, and no
// reviewer sees a diff.
//
// The honest limit, pinned here so it cannot be forgotten: whether REAL models produce anchors
// that match verbatim is UNVERIFIED and untestable at $0. That is why the fallback exists and
// why this ships default-off.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePatches, applyPatches, changedSince } from '../src/patch-revise.js';
import { runChain } from '../src/chain.js';
import { lintChain } from '../src/chain-lint.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chain = n => JSON.parse(readFileSync(join(root, 'chains', `${n}.json`), 'utf8'));

const DRAFT = 'Intro paragraph.\n\nBody text.\n\nClosing paragraph.';
const ONE = '<<<<<<< SEARCH\nBody text.\n=======\nBody text, expanded.\n>>>>>>> REPLACE';

test('parsePatches reads the blocks; applyPatches edits only what they name', () => {
  const patches = parsePatches(ONE);
  assert.equal(patches.length, 1);
  const r = applyPatches(DRAFT, patches);
  assert.equal(r.ok, true);
  assert.equal(r.text, 'Intro paragraph.\n\nBody text, expanded.\n\nClosing paragraph.');
});

test('untouched text is byte-identical by construction, not by trust', () => {
  const r = applyPatches(DRAFT, parsePatches(ONE));
  assert.ok(r.text.startsWith('Intro paragraph.'), 'the untouched opening must be exactly itself');
  assert.ok(r.text.endsWith('Closing paragraph.'));
  // This is the property a full rewrite cannot offer: nothing else COULD have changed.
  assert.equal(r.text.replace('Body text, expanded.', 'Body text.'), DRAFT);
});

test('a SEARCH that appears twice is refused, not resolved by picking the first', () => {
  const draft = 'Repeat me.\n\nMiddle.\n\nRepeat me.';
  const r = applyPatches(draft, parsePatches('<<<<<<< SEARCH\nRepeat me.\n=======\nChanged.\n>>>>>>> REPLACE'));
  assert.equal(r.ok, false);
  assert.match(r.reason, /more than once/);
  assert.equal(r.text, draft, 'a refused application changes nothing at all');
});

test('a SEARCH that is not in the draft fails without partially editing it', () => {
  const two = `${ONE}\n\n<<<<<<< SEARCH\nnot present anywhere\n=======\nx\n>>>>>>> REPLACE`;
  const r = applyPatches(DRAFT, parsePatches(two));
  assert.equal(r.ok, false);
  assert.equal(r.text, DRAFT, 'the first block must not survive when a later one fails');
});

test('a reply with no blocks at all fails cleanly into the fallback', () => {
  const r = applyPatches(DRAFT, parsePatches('I rewrote the whole thing instead.'));
  assert.equal(r.ok, false);
  assert.match(r.reason, /no search\/replace blocks/);
});

test('changedSince shows critics the edits, and says the rest is unchanged', () => {
  const s = changedSince(parsePatches(ONE));
  assert.match(s, /## Changed since your last review/);
  assert.match(s, /byte-identical/);
  assert.match(s, /Body text, expanded\./);
  assert.equal(changedSince([]), '', 'no patches, no section');
});

test('end to end: patch mode applies edits and records no fallback', async () => {
  const r = await runChain({ config: chain('mock-patch'), request: 'A mock task.', log: () => {} });
  assert.deepEqual(r.patchFallbacks, [], 'the mock patch applies cleanly');
  assert.match(r.deliverable, /with the assumptions stated/, 'the edit landed');
  assert.ok(!/MOCK DELIVERABLE for model mock-reviser-patch\b/.test(r.deliverable),
    'patch mode must not replace the draft with the reviser reply itself');
});

test('end to end: a block that does not apply falls back to one full rewrite', async () => {
  const r = await runChain({ config: chain('mock-patch-fallback'), request: 'A mock task.', log: () => {} });
  assert.equal(r.patchFallbacks.length >= 1, true, 'the fallback is recorded, not silent');
  assert.match(r.patchFallbacks[0].reason, /does not appear in the draft/);
  // The run still produced a revised draft rather than failing.
  assert.match(r.deliverable, /REVISED MOCK DELIVERABLE/);
  assert.ok(r.stages.some(s => s.label?.endsWith('-full')), 'the full rewrite ran as its own budgeted stage');
});

test('a chain without revise.mode is untouched and gains no report field', async () => {
  const r = await runChain({ config: chain('mock-unanimous'), request: 'A mock task.', log: () => {} });
  assert.equal(r.patchFallbacks, undefined);
});

test('chain-lint: revise.mode accepts only full or patch, and no other key', () => {
  assert.deepEqual(lintChain(chain('mock-patch'), 'chains/mock-patch.json'), []);
  const base = chain('mock-patch');
  assert.ok(lintChain({ ...base, revise: { mode: 'diff' } }, 'x.json')
    .some(f => f.kind === 'invalid-revise-config' && /silently reads as "full"/.test(f.message)));
  assert.ok(lintChain({ ...base, revise: { mode: 'patch', tolerance: 2 } }, 'x.json')
    .some(f => f.kind === 'invalid-revise-config' && /tolerance/.test(f.message)));
  assert.deepEqual(lintChain({ ...base, revise: { mode: 'full' } }, 'x.json'), []);
});
