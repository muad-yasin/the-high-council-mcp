// The dry-run's typical review output per seat (0.7.8). A chain's flat estimate.critiqueTokens was
// one figure for every reviewer; reasoning models spend most of a review thinking, so plan-premium-7
// projected its Fable seat at ~$0.45 a round against ~$1.04 real (thc-research brief 08). The
// estimate now takes a seat's own figure, else the larger of the chain's and the model's measured
// typical (pricing.json critiqueTokens), capped at the seat's review cap. The spend cap is untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { critiqueTokensFor, estimateChainRows, worstCaseOf, priceOf } from '../src/cost.js';

const here = dirname(fileURLToPath(import.meta.url));
const chain = name => JSON.parse(readFileSync(resolve(here, `../chains/${name}.json`), 'utf8'));
const pricing = JSON.parse(readFileSync(resolve(here, '../src/pricing.json'), 'utf8'));
const fable = { provider: 'openrouter', model: 'anthropic/claude-fable-5.1', maxTokens: 36000, lab: 'fable5.1' };
const astra = { provider: 'openrouter', model: 'openai/gpt-6-astra', maxTokens: 36000 };

test('critiqueTokensFor: measured typical raises the chain figure, never lowers it', () => {
  assert.equal(priceOf(fable.provider, fable.model).critiqueTokens, 10000);
  assert.equal(critiqueTokensFor(fable, 5000), 10000);
  assert.equal(critiqueTokensFor(fable, 12000), 12000, 'a higher chain figure stands');
  assert.equal(critiqueTokensFor(astra, 5000), 5000, 'astra measures 3500: the chain\'s 5000 is kept');
  assert.equal(critiqueTokensFor({ provider: 'mock', model: 'mock-critic-a' }, 300), 300, 'no measurement: the chain figure');
  assert.equal(critiqueTokensFor({ provider: 'external', model: 'anthropic/claude-fable-5.1' }, 300), 300, 'an external seat is never billed');
});

test('critiqueTokensFor: a seat\'s own estimate.critiqueTokens wins both ways, and nothing passes the review cap', () => {
  assert.equal(critiqueTokensFor({ ...fable, estimate: { critiqueTokens: 2000 } }, 5000), 2000);
  assert.equal(critiqueTokensFor({ ...astra, estimate: { critiqueTokens: 9000 } }, 5000), 9000);
  assert.equal(critiqueTokensFor({ ...fable, maxTokens: 8000 }, 5000), 8000, 'capped at maxTokens');
  assert.equal(critiqueTokensFor({ ...fable, panelMaxTokens: 6000 }, 5000), 6000, 'capped at panelMaxTokens');
  assert.equal(critiqueTokensFor({ ...astra, maxTokens: 4000, estimate: { critiqueTokens: 9000 } }, 5000), 4000);
});

test('plan-premium-7: panel rows use each seat\'s typical review output', () => {
  const rows = estimateChainRows(chain('plan-premium-7'));
  const out = label => rows.find(r => r.label === label).output;
  assert.equal(out('panel-1-fable5.1'), 10000);
  assert.equal(out('panel-1-glm5.3'), 36000, 'GLM 5.3 ran to its cap in real reviews');
  assert.equal(out('panel-1-gpt6-astra'), 5000);
  assert.equal(out('panel-7-fable5.1'), 10000, 'every round');
});

test('the spend cap\'s worst case still projects the full maxTokens, whatever the typical estimate', () => {
  const p = pricing['openrouter/anthropic/claude-fable-5.1'];
  const w = worstCaseOf(fable.provider, fable.model, { promptChars: 40000, maxTokens: 36000, retries: 1 });
  assert.equal(w.usd, (10000 / 1e6) * p.in + (36000 / 1e6) * p.out);
});

test('every measured critiqueTokens is an integer within a seat\'s default cap, with its source noted', () => {
  for (const [k, v] of Object.entries(pricing)) {
    if (!v || typeof v !== 'object' || !('critiqueTokens' in v)) continue;
    assert.ok(Number.isInteger(v.critiqueTokens) && v.critiqueTokens > 0 && v.critiqueTokens <= 36000, k);
    assert.match(v._critiqueTokens || '', /median panel-review output/, `${k}: say where the figure came from`);
  }
});
