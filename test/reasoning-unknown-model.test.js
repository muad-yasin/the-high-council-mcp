// 0.8.3 (C&C ruling 23 Oct 2026, lane D): the chain-lint rule `reasoning-not-high` fails CLOSED for a model the reasoning table knows nothing about.
// Before: a seat with no `models` row passed whatever it stated (the check was guarded by `row?.form &&`), so a shipped seat on an unknown model could reason at
// the model's default and the lint said nothing. Now a shipped-path seat with no `models` row, no `unlisted` reason and no high-or-above effort of its own is a
// finding. The table is the list of what it knows (`models` plus `unlisted`); no provider is named in the code. $0, offline, nothing written to chains/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintChain } from '../src/chain-lint.js';
import { reasoningProblems, rowOf, unlistedReasonOf, loweringReasons, TABLE_KNOWN_WAYS, EFFORT_WORD_SPELLINGS, REASONING_TABLE } from '../src/reasoning.js';
import { notOnRouterReason, NOT_ON_ROUTER_PREFIX } from '../src/table-reasons.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shippedPath = join(root, 'chains', 'scratch-unknown-model.json');   // a path inside chains/ is the shipped branch; the file is never written
const userPath = '/tmp/some-project/chains/scratch-unknown-model.json';
const UNKNOWN = 'vendor/never-heard-of-it';
const chainWith = (seat) => ({ seats: { critics: [{ provider: 'openrouter', model: UNKNOWN, maxTokens: 16000, ...seat }] } });
const hits = (cfg, path = shippedPath) => lintChain(cfg, path).filter(f => f.kind === 'reasoning-not-high');

test('UM-0 the premise: the unknown id has no row and no unlisted reason, the control ids have what the tests below rely on', () => {
  assert.equal(rowOf({ provider: 'openrouter', model: UNKNOWN }), null);
  assert.equal(unlistedReasonOf({ provider: 'openrouter', model: UNKNOWN }), null);
  assert.ok(rowOf({ provider: 'openrouter', model: 'z-ai/glm-5.3-flash' }), 'a model with a models row');
  assert.match(unlistedReasonOf({ provider: 'mistral', model: 'mistral-large-latest' }) ?? '', /not a reasoning model/, 'an exact unlisted key');
  assert.ok(REASONING_TABLE.unlisted['ollama/*'], 'a prefix entry');
});

test('UM-1 a shipped-path seat on an unknown model with no extra is ONE finding that names the model and the two ways out; a user path passes', () => {
  const found = hits(chainWith({}));
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.ok(found[0].message.includes(`openrouter/${UNKNOWN}`) && found[0].message.includes('no row and no deliberate unlisted reason'), found[0].message);
  // the fix text is made from the SAME list the check reads: every way the check accepts is said, in the list's order, and nothing else is
  assert.equal(TABLE_KNOWN_WAYS.length, 3);
  TABLE_KNOWN_WAYS.forEach((w, n) => assert.ok(found[0].fix.includes(`(${n + 1}) ${w.say}`), `way ${w.id} missing from: ${found[0].fix}`));
  assert.ok(!found[0].fix.includes('(4)'), found[0].fix);
  assert.deepEqual(hits(chainWith({}), userPath), [], 'a user\'s own chain passes through');
});

test('UM-2 the neighbours that must NOT be flagged: a model with a row, an exact unlisted key, any ollama model', () => {
  assert.deepEqual(hits(chainWith({ model: 'z-ai/glm-5.3-flash' })), [], 'a models row: unchanged');
  assert.deepEqual(hits({ seats: { critics: [{ provider: 'mistral', model: 'mistral-large-latest', maxTokens: 16000 }] } }), [], 'an exact unlisted key');
  for (const model of ['llama3.1', 'a-model-the-table-never-named']) {
    assert.deepEqual(hits({ seats: { critics: [{ provider: 'ollama', model, maxTokens: 16000 }] } }), [], `ollama/${model}: the prefix entry`);
  }
  assert.equal(unlistedReasonOf({ provider: 'ollama', model: 'anything' }), REASONING_TABLE.unlisted['ollama/*']);
  assert.equal(unlistedReasonOf({ provider: 'olla', model: 'x' }), null, 'a prefix is a whole provider segment, not a string start');
});

test('UM-3 an effort of its own at high or above lets an unknown model through, in every field the harness reads', () => {
  const extras = [
    { reasoning: { effort: 'high' } }, { reasoning: { effort: 'xhigh' } }, { reasoning: { effort: 'max' } },
    { output_config: { effort: 'high' } }, { reasoning_effort: 'max' }, { chat_template_kwargs: { reasoning_effort: 'high' } },
    { extra_body: { reasoning: { effort: 'high' } } },
    { thinking: { type: 'enabled', budget_tokens: 12000 } },   // Haiku rule: at least half of the 16000 cap
  ];
  for (const extra of extras) assert.deepEqual(hits(chainWith({ extra })), [], JSON.stringify(extra));
});

test('UM-4 a bare switch states no level and does not let an unknown model through (the router reads reasoning.enabled alone as medium)', () => {
  for (const extra of [{ reasoning: { enabled: true } }, { enable_thinking: true }, { thinking: { type: 'enabled' } }, { chat_template_kwargs: { enable_thinking: true } }]) {
    assert.equal(hits(chainWith({ extra })).length, 1, JSON.stringify(extra));
  }
});

test('UM-5 a lowered effort on an unknown model is exactly ONE finding (the lowering), not two', () => {
  for (const extra of [{ reasoning: { effort: 'low' } }, { reasoning: { effort: 'medium' } }, { reasoning: { enabled: false } }]) {
    const found = hits(chainWith({ extra }));
    assert.equal(found.length, 1, `${JSON.stringify(extra)}: ${JSON.stringify(found)}`);
    assert.ok(!found[0].message.includes('no row and no deliberate unlisted reason'), 'the lowering is reported, not the unknown model');
  }
});

test('UM-6 reasoningProblems itself: the unknown-model problem carries its kind, and a mock or external seat is not asked', () => {
  const p = reasoningProblems({ provider: 'openrouter', model: UNKNOWN, maxTokens: 16000 });
  assert.equal(p.length, 1);
  assert.equal(p[0].kind, 'table-unknown');
  assert.deepEqual(reasoningProblems({ provider: 'openrouter', model: UNKNOWN, maxTokens: 16000, extra: { reasoning: { effort: 'high' } } }), []);
  const mock = { seats: { critics: [{ provider: 'mock', model: 'mock-critic-a', lab: 'mock-a' }] } };
  assert.deepEqual(hits(mock), [], 'a mock seat is never asked');
});

test('UM-7 an AUTO unlisted entry (the script\'s "not in OpenRouter\'s public list") does not let a shipped seat through; a deliberate entry does', () => {
  const key = `openrouter/${UNKNOWN}`;
  const real = REASONING_TABLE.unlisted['openrouter/mistralai/mistral-small'];
  assert.ok(real && real.startsWith(NOT_ON_ROUTER_PREFIX), 'the table really holds an auto entry (premise)');
  assert.equal(unlistedReasonOf({ provider: 'openrouter', model: 'mistralai/mistral-small' }), real, 'the plain lookup still finds it');
  assert.equal(unlistedReasonOf({ provider: 'openrouter', model: 'mistralai/mistral-small' }, { deliberateOnly: true }), null);
  try {
    REASONING_TABLE.unlisted[key] = notOnRouterReason('2026-10-23', true);
    assert.equal(hits(chainWith({})).length, 1, 'an id that dropped off the router list is no reason to leave a seat unchecked');
    assert.deepEqual(hits(chainWith({ extra: { reasoning: { effort: 'high' } } })), [], 'its own high effort still passes it');
    REASONING_TABLE.unlisted[key] = 'not a reasoning model; no reasoning field';
    assert.deepEqual(hits(chainWith({})), [], 'a deliberate entry passes');
  } finally { delete REASONING_TABLE.unlisted[key]; }
  assert.equal(rowOf({ provider: 'openrouter', model: UNKNOWN }), null);
  assert.equal(hits(chainWith({})).length, 1, 'the table is back as it was');
});

test('UM-8 the auto entry\'s reason is said truthfully: a seated id is not described as "no shipped seat uses it"', () => {
  const seated = notOnRouterReason('2026-10-23', true), unseated = notOnRouterReason('2026-10-23', false);
  assert.ok(seated.startsWith(NOT_ON_ROUTER_PREFIX) && unseated.startsWith(NOT_ON_ROUTER_PREFIX), 'both kinds start with the prefix the lint reads');
  assert.ok(seated.includes('a shipped chain seats it') && !seated.includes('no shipped'), seated);
  assert.ok(unseated.includes('no shipped chain seats it'), unseated);
});

test('UM-9 guard: every spelling in the ONE table (EFFORT_WORD_SPELLINGS) that loweringReasons reads as an effort WORD is also read as "states high" (so a seat that says high in any of them is not called unknown), and a path added to the table needs a spelling here', () => {
  const spellings = {
    'reasoning.effort': l => ({ reasoning: { effort: l } }), 'output_config.effort': l => ({ output_config: { effort: l } }), reasoning_effort: l => ({ reasoning_effort: l }),
    'chat_template_kwargs.reasoning_effort': l => ({ chat_template_kwargs: { reasoning_effort: l } }), thinking_level: l => ({ thinking_level: l }),
    'thinking_config.thinking_level': l => ({ thinking_config: { thinking_level: l } }), 'thinking_config.thinkingLevel': l => ({ thinking_config: { thinkingLevel: l } }),
    'thinkingConfig.thinkingLevel': l => ({ thinkingConfig: { thinkingLevel: l } }),
    'google.thinking_config.thinking_level': l => ({ google: { thinking_config: { thinking_level: l } } }), 'google.thinkingConfig.thinkingLevel': l => ({ google: { thinkingConfig: { thinkingLevel: l } } }),
    'extra_body.reasoning.effort': l => ({ extra_body: { reasoning: { effort: l } } }),
  };
  const seat = { provider: 'openrouter', model: UNKNOWN, maxTokens: 16000 };
  // the two readers share ONE table (EFFORT_WORD_SPELLINGS); this guard makes a path added to it come with a spelling here
  for (const sp of EFFORT_WORD_SPELLINGS) assert.ok(sp.path in spellings, `${sp.path} is in EFFORT_WORD_SPELLINGS but UM-9 has no spelling for it`);
  for (const [name, make] of Object.entries(spellings)) {
    assert.ok(loweringReasons(make('low'), seat).length > 0, `${name}: low is a lowering (the premise)`);
    assert.equal(loweringReasons(make('high'), seat).length, 0, `${name}: high is not`);
    assert.deepEqual(hits(chainWith({ extra: make('high') })), [], `${name}: states high, so the unknown model passes`);
  }
});
