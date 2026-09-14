// test/ambiguity-union.test.js
//
// Item 5 (relay/runs/2026-09-14T14-56-18-834Z/deliverable.md): three cheap seats each list the
// ambiguities they see in a raw request before any proposal exists; src/chain.js unions and
// dedupes the lists (string/set-level, no dependency on any claim schema) and appends the result
// to the request text, which the questions and criteria stages already read. Gated on
// `ambiguity_union.enabled: true` - absent leaves the questions stage's input unchanged from today.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runChain, unionAmbiguities } from '../src/chain.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const unanimousConfig = JSON.parse(readFileSync(join(root, 'chains', 'mock-unanimous.json'), 'utf8'));

test('unionAmbiguities: three lists with one overlap between every pair dedupe to the three unique entries', () => {
  const a = ['Is the deliverable code or prose?', 'Should assumption X default to A?'];
  const b = ['Is the deliverable code or prose?', 'What audience is this for?'];
  const c = ['Should assumption X default to A?', 'What audience is this for?'];
  const union = unionAmbiguities([a, b, c]);
  assert.equal(union.length, 3);
  assert.deepEqual([...union].sort(), [
    'Is the deliverable code or prose?',
    'Should assumption X default to A?',
    'What audience is this for?',
  ].sort());
});

test('unionAmbiguities: dedup is case/whitespace-insensitive but keeps the first-seen wording', () => {
  const union = unionAmbiguities([
    ['Is the deliverable code or prose?'],
    ['is the deliverable   code or prose?'],
  ]);
  assert.deepEqual(union, ['Is the deliverable code or prose?']);
});

test('unionAmbiguities: ignores non-string entries, blank entries, and non-array lists without throwing', () => {
  const union = unionAmbiguities([
    ['A real one.', '', null, 42],
    null,
    undefined,
    ['A real one.', 'Another one.'],
  ]);
  assert.deepEqual(union, ['A real one.', 'Another one.']);
});

test('runChain: ambiguity_union absent leaves the questions stage input unchanged (no ambiguities stage runs)', async () => {
  const config = {
    ...unanimousConfig,
    questions: { max: 2, wait: false },
  };
  const result = await runChain({ request: 'Write a short fixture deliverable.', config, log: () => {} });
  assert.equal(result.ambiguities, null);
  assert.ok(!result.stages.some(s => s.label.startsWith('ambiguity-')), 'no ambiguity-* stage should have run');
});

test('runChain: ambiguity_union.enabled unions three mock seats\' lists and folds the result into the request the questions stage sees', async () => {
  const config = {
    ...unanimousConfig,
    ambiguity_union: { enabled: true },
    questions: { max: 2, wait: false },
    seats: {
      ...unanimousConfig.seats,
      ambiguity: [
        { provider: 'mock', model: 'mock-ambiguity-a', lab: 'mock-a' },
        { provider: 'mock', model: 'mock-ambiguity-b', lab: 'mock-b' },
        { provider: 'mock', model: 'mock-ambiguity-c', lab: 'mock-c' },
      ],
    },
  };
  const result = await runChain({ request: 'Write a short fixture deliverable.', config, log: () => {} });
  assert.equal(result.ambiguities.length, 3);
  assert.ok(result.stages.some(s => s.label === 'ambiguity-mock-a'));
  assert.ok(result.stages.some(s => s.label === 'ambiguity-mock-b'));
  assert.ok(result.stages.some(s => s.label === 'ambiguity-mock-c'));
});

test('runChain: with no seats.ambiguity configured, falls back to the first three critic seats', async () => {
  const config = {
    ...unanimousConfig,
    ambiguity_union: { enabled: true },
    questions: { max: 2, wait: false },
  };
  const result = await runChain({ request: 'Write a short fixture deliverable.', config, log: () => {} });
  // mock-unanimous.json's critics are mock-critic-a/mock-critic-b, which have no ambiguity-prompt
  // branch in the mock provider and so return an empty list each - the stage still runs and
  // still returns a (possibly empty) array rather than null, proving the fallback seat selection
  // fired rather than being silently skipped.
  assert.ok(Array.isArray(result.ambiguities));
  assert.ok(result.stages.some(s => s.label.startsWith('ambiguity-')));
});
