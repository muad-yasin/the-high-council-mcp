// plan-china-high-council (0.8.3; Muad 18 Okt 2026: "Yes to the suggested chinese High", his picks CF + DeepSeek V4 Pro kept in layer 2, repeats OK; 19-20 Okt: DeepSeek V4 Pro as its 0813 build at the listed price 0.66/1.98 (PICK 6), effort max, ONE LAB PER MODEL).
// What is true of the file itself, offline and for $0: the roster, the labs (a model that sits in two layers is one lab), the 0813 seat's price pin and effort, lint, and the two figures the dry run prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintChain } from '../src/chain-lint.js';
import { panelLabCount } from '../src/chain.js';
import { pinnedExtra } from '../src/price-pin.js';
import { dryRunReport } from '../src/dry-run.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const chain = JSON.parse(readFileSync(join(root, 'chains', 'plan-china-high-council.json'), 'utf8'));
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const critics = chain.seats.critics;

test('PCH-1: the roster is the High shape with twelve judge seats on nine models from seven companies, lint clean, and the panel counts nine labs (one per model, no -lN suffix)', () => {
  assert.equal(chain.seats.proposers.length, 6); assert.equal(chain.seats.alternatives.length, 3); assert.equal(chain.maxOverseerRounds, 7); assert.deepEqual(chain.layerRevisions, { 1: 5, 2: 3 });
  assert.deepEqual([1, 2, 3].map(l => critics.filter(s => s.layer === l).length), [6, 4, 2]);
  assert.equal(new Set(critics.map(s => s.model)).size, 9); assert.equal(new Set(critics.map(s => s.model.split('/')[0])).size, 7);
  const labOf = new Map(); for (const s of [...chain.seats.proposers, ...chain.seats.alternatives, ...critics, chain.seats.deep_dive]) { assert.ok(!/-(l[123]|p)$/.test(s.lab), s.lab); assert.equal(labOf.get(s.model) ?? s.lab, s.lab, `${s.model} has two labs`); labOf.set(s.model, s.lab); }
  assert.equal(panelLabCount(chain), 9);
  assert.deepEqual(lintChain(chain, 'chains/plan-china-high-council.json'), []);
});

// CHANGED ACCEPTED TEST (HIGH unit, 23 Okt 2026). OLD: the DeepSeek V4 Pro 0813 seat is at effort max. NEW: effort high. WHY: Muad, 23 Okt 2026 20:44: "High should be *our* default setting. Some models are so cheap that *their* default is Max effort, and we can go with that" (DeepSeek V4 Pro's own default is high, so the seat states high).
test('PCH-2: the DeepSeek V4 Pro seat is the 0813 build at effort high with 384,000 output (the owner\'s pick; none found on DeepSeek\'s pages), and its request carries the listed price 0.66/1.98 as the pin', () => {
  const s = critics.find(x => x.model === 'deepseek/deepseek-v4-pro-0813');
  assert.ok(s, 'the 0813 id');
  assert.equal(critics.some(x => x.model === 'deepseek/deepseek-v4-pro'), false, 'the 0423 build is not used');
  assert.equal(s.maxTokens, 384000); assert.equal(s.extra.reasoning.effort, 'high');
  assert.deepEqual(pinnedExtra(s, s.extra).provider.max_price, { prompt: 0.66, completion: 1.98 });
});

test('PCH-3: the dry run prints the two figures the description and the Pricing table carry, and the Known limit says five hosts serve the 0813 seat', () => {
  const est = dryRunReport(chain).estimate;
  const usd = n => `$${n.toFixed(2)}`;
  assert.ok(chain.description.includes(`${usd(est.expectedUsd)} expected`) && chain.description.includes(`${usd(est.maximumUsd)}`), 'the description carries the dry run');
  // CHANGED ACCEPTED (Pricing table layout, 26 Okt 2026): OLD the row read `| name | not run yet | expected | upper estimate |`; NEW the columns are Chain | Expected | Upper estimate | Tested, and an unrun chain's tested cell is an en dash.
  assert.ok(readme.includes(`| \`plan-china-high-council\` | ${usd(est.expectedUsd)} | ${usd(est.maximumUsd)} | \u2013 |`), 'the Pricing table row');
  assert.ok(readme.includes('has five hosts at its price (0.8.3)'), 'the Known limit');
  assert.ok(chain.description.includes('nine models from seven companies'), 'the description says what it counts');
});

test('PCH-4: Chinese labs only on every API seat (no Kimi, Grok or Mistral outside the description), a price row and a reasoning row for every API seat, every seat reasons at high or above, and the file makes no compliance claim (like its siblings)', () => {
  const pricing = JSON.parse(readFileSync(join(root, 'src', 'pricing.json'), 'utf8'));
  const reasoning = JSON.parse(readFileSync(join(root, 'src', 'reasoning-table.json'), 'utf8')).models;
  const LABS = ['deepseek', 'minimax', 'qwen', 'stepfun', 'tencent', 'xiaomi', 'z-ai'];
  const seats = [...chain.seats.proposers, ...chain.seats.alternatives, ...critics, chain.seats.deep_dive].filter(s => s.provider !== 'external');
  const ORDER = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
  for (const s of seats) {
    assert.ok(LABS.includes(s.model.split('/')[0]), s.model);
    const key = `${s.provider}/${s.model}`;
    assert.ok(pricing[key]?.in > 0 && pricing[key]?.out > 0, `price row for ${key}`); assert.ok(reasoning[key], `reasoning row for ${key}`);
    // CHANGED ACCEPTED TEST (HIGH unit, 23 Okt 2026). OLD: every API seat states an effort of high or above. NEW: a seat on a model whose own default is above high (GLM-5.3, GLM-5.3 Flash, Qwen 3.8 Max) states none, so the harness sends no effort setting and the model runs at that default (the same skip as plan-tiers T4 and china-chains C2). WHY: Muad, 23 Okt 2026 20:44.
    if (reasoning[key].defaultAboveHigh && !s.extra?.reasoning?.effort) continue;
    assert.ok(ORDER.indexOf(s.extra?.reasoning?.effort) >= ORDER.indexOf('high'), `${key} reasons at ${s.extra?.reasoning?.effort}`);
  }
  assert.doesNotMatch(JSON.stringify({ ...chain, description: '' }), /kimi|moonshot|mistral|grok|x-ai/i);
  assert.equal('compliance' in chain, false);
});
