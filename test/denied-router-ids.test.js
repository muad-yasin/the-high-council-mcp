// Router ids that could pick a denied model (0.8.1 plan M7 Work 3, decided rule 1): every OpenRouter router the research named is
// refused as a seat's model, one test case per id, and ordinary model ids that only look similar are not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deniedReasonsOf, ROUTER_MODEL } from '../src/denied-models.js';

const seat = model => ({ provider: 'openrouter', model, lab: 'x' });
// The plan's list (M7 Work 3 and decided rule 1): the router ids, in OpenRouter's own namespace and bare.
const ROUTERS = ['openrouter/auto', 'openrouter/auto-beta', 'openrouter/fusion', 'openrouter/free', 'openrouter/bodybuilder', 'openrouter/pareto-code', 'auto', 'pareto-code', 'router', 'some-lab/router',
  // the bare forms the plan names (M7 Work 5), and a doubled prefix (M7 review)
  'auto-beta', 'fusion', 'free', 'bodybuilder', 'openrouter/openrouter/fusion', 'openrouter/openrouter/free', 'openrouter/openrouter/bodybuilder'];

for (const id of ROUTERS) {
  test(`a seat whose model is ${id} is refused as a router`, () => {
    assert.ok(ROUTER_MODEL.test(id), `${id} is not matched by ROUTER_MODEL`);
    const reasons = deniedReasonsOf(seat(id));
    assert.ok(reasons.length, `${id} was not refused`);
    assert.match(reasons.join(' '), /router/);
  });
}

test('the same ids are refused where extra can choose the model (models, provider.order)', () => {
  for (const id of ['openrouter/fusion', 'openrouter/free']) {
    assert.ok(deniedReasonsOf({ ...seat('openai/gpt-6.1-sol'), extra: { models: [id] } }).length, `extra.models ${id}`);
    assert.ok(deniedReasonsOf({ ...seat('openai/gpt-6.1-sol'), extra: { provider: { order: [id] } } }).length, `extra.provider.order ${id}`);
  }
});

test('ordinary ids are not routers: a lab-prefixed model, a pricing key, a :free variant, a name containing "auto"', () => {
  for (const id of ['openai/gpt-6.1-sol', 'openrouter/openai/gpt-6.1-sol', 'deepseek/deepseek-v4.1-flash:free', 'z-ai/glm-5.3', 'autodesk/model-1', 'some-lab/fusion-7b', 'qwen/qwen3.7-plus']) {
    assert.equal(ROUTER_MODEL.test(id), false, id);
    assert.deepEqual(deniedReasonsOf(seat(id)).filter(r => /router/.test(r)), [], id);
  }
});
