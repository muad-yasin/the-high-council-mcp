// 0.8.3 estimator unit (15 Oct 2026; C&C ruling on the chain-split note): the dry run's EXPECTED figure prices alternatives, proposals and deep-dive calls at a typical size when the chain sets
// estimate.alternativeOutTokens / proposalOutTokens / deepDiveOutTokens, and at the whole cap when it does not (today's behaviour). The MAXIMUM figure always uses the caps, and a key above a call's cap is clamped to the cap.
// The keys change only what is PRINTED; test/alternatives.test.js and test/chain-schema.test.js keep the runtime cap and the schema honest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimateChainRows } from '../src/cost.js';

const here = dirname(fileURLToPath(import.meta.url));
const base = () => JSON.parse(readFileSync(resolve(here, '../chains/plan-high-council.json'), 'utf8'));
const withKeys = keys => ({ ...base(), estimate: { ...(base().estimate || {}), ...keys } });
const rowsOf = (config, maximum = false) => estimateChainRows(config, { maximum });
const byPrefix = (rows, p) => rows.filter(r => r.label.startsWith(p));
const sum = rows => rows.reduce((n, r) => n + r.usd, 0);

test('keys absent: the expected figure is today\'s (every alternative, proposal and deep-dive call at its whole cap), and a key at or above the cap changes nothing (pin)', () => {
  const plain = rowsOf(base());
  const huge = rowsOf(withKeys({ alternativeOutTokens: 1_000_000, proposalOutTokens: 1_000_000, deepDiveOutTokens: 1_000_000 }));
  assert.deepEqual(huge, plain, 'a key above every cap is clamped to the cap: identical rows');
  const cfg = base();
  for (const r of byPrefix(plain, 'alternative-')) assert.equal(r.output, cfg.seats.alternatives.find(s => `alternative-${s.lab || s.provider}` === r.label).maxTokens ?? 36000, r.label);
});

test('keys set: the EXPECTED rows of those three stages carry the typical size, the figure falls, and the board the later stages read shrinks with it', () => {
  const plain = rowsOf(base());
  const typ = rowsOf(withKeys({ alternativeOutTokens: 12000, proposalOutTokens: 9000, deepDiveOutTokens: 40000 }));
  for (const r of byPrefix(typ, 'alternative-')) assert.equal(r.output, 12000, r.label);
  for (const r of byPrefix(typ, 'propose-')) assert.equal(r.output, 9000, r.label);
  for (const r of byPrefix(typ, 'deep-dive-').filter(r => !r.label.includes('revise'))) assert.equal(r.output, 40000, r.label);
  assert.ok(sum(typ) < sum(plain), `${sum(typ)} < ${sum(plain)}`);
  const buildIn = rows => rows.find(r => r.label === 'build').input;
  assert.ok(buildIn(typ) < buildIn(plain), 'the build reads a smaller board when the typical sizes are used');
});

test('the MAXIMUM figure is the caps with or without the keys (the keys never lower a ceiling)', () => {
  const a = rowsOf(base(), true);
  const b = rowsOf(withKeys({ alternativeOutTokens: 12000, proposalOutTokens: 9000, deepDiveOutTokens: 40000 }), true);
  assert.deepEqual(b, a);
});

test('a key that is not a positive number is ignored (0, negative, text, null): the cap stands', () => {
  const plain = rowsOf(base());
  for (const bad of [0, -5, 'big', null, Number.NaN]) assert.deepEqual(rowsOf(withKeys({ alternativeOutTokens: bad, proposalOutTokens: bad, deepDiveOutTokens: bad })), plain, String(bad));
});

test('the schema declares the three keys (integer, at least 1) under estimate', () => {
  const props = JSON.parse(readFileSync(resolve(here, '../config/chain-schema.json'), 'utf8')).properties.estimate.properties;
  for (const k of ['alternativeOutTokens', 'proposalOutTokens', 'deepDiveOutTokens']) assert.deepEqual([props[k]?.type, props[k]?.minimum], ['integer', 1], k);
});

test('deep-dive: the expected and maximum passes list the SAME rows when deep_dive.usd is finite, with or without the typical size (audit fix cnc-money F2 stays true)', () => {
  const labels = rows => rows.filter(r => r.label.startsWith('deep-dive-') && !r.label.includes('revise')).map(r => r.label);
  for (const usd of [0.05, 0.2, 0.5, 1, 3]) {
    const c = withKeys({ deepDiveOutTokens: 8000 }); c.deep_dive = { ...c.deep_dive, usd, maxCalls: 24 };
    assert.deepEqual(labels(rowsOf(c, false)), labels(rowsOf(c, true)), `usd ${usd}`);
  }
});
