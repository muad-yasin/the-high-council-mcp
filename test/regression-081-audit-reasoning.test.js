// 0.8.1 pre-release audit round (MAN-4), area A2 (reasoning, providers, keys), findings fixed in batch 2. Each test fails on 0d4a519 and passes after its fix.
// A2-1 a key with a control character is printed in a provider error and written to run files; A2-3 the harness default is added beside a seat's own
// reasoning field of a different spelling (a 400 on Google); A2-4 the single-vendor reroute can carry two reasoning fields or drop the high one;
// A2-5 loweringReasons misses spellings of "off" (extra_body, include_reasoning, top-level thinking_budget/thinking_level, thinkingConfig).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loweringReasons, highExtraFor, extraWithHighDefault } from '../src/reasoning.js';
import { keyFor, call, resolveVendorSeat } from '../src/providers.js';
import { keyEnvValue, keyProblem } from '../src/key-env.js';

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '../src/cli.js');
const withEnv = async (vars, fn) => {
  const had = {}; for (const k of Object.keys(vars)) { had[k] = process.env[k]; if (vars[k] === null) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(had)) { if (had[k] === undefined) delete process.env[k]; else process.env[k] = had[k]; } }
};
const TWO_LINES = 'sk-or-v1-FIRSTPART1234\nsk-or-v1-SECONDPART5678';

test('A2-1: a key with a line break in it is "set but malformed": never sent, named as such, and its text never appears in an error', async () => {
  await withEnv({ OPENROUTER_API_KEY: TWO_LINES, COUNCIL_PLUGIN_OPENROUTER_API_KEY: null }, async () => {
    assert.equal(keyEnvValue('OPENROUTER_API_KEY'), null, 'a malformed key is not a usable key');
    assert.equal(keyFor('openrouter'), null);
    assert.equal(keyProblem('OPENROUTER_API_KEY'), 'malformed');
    const original = globalThis.fetch; let sent = 0; globalThis.fetch = async () => { sent++; throw new Error('must not be called'); };
    try {
      await assert.rejects(() => call('openrouter', { model: 'deepseek/deepseek-v4.1-flash', system: 's', messages: [{ role: 'user', content: 'u' }], maxTokens: 100 }), err => {
        assert.match(err.message, /control character|line break/i);
        assert.doesNotMatch(err.message, /FIRSTPART|SECONDPART/);
        assert.notEqual(err.maybeBilled, true, 'nothing was sent, so nothing is possibly billed');
        return true;
      });
      assert.equal(sent, 0, 'no request left the process');
    } finally { globalThis.fetch = original; }
  });
  // A normal key, and a key with a trailing newline (a file read), are unchanged.
  await withEnv({ OPENROUTER_API_KEY: 'sk-or-v1-FINE\n', COUNCIL_PLUGIN_OPENROUTER_API_KEY: null }, async () => { assert.equal(keyProblem('OPENROUTER_API_KEY'), null); assert.ok(keyEnvValue('OPENROUTER_API_KEY')); });
});

test('A2-1: the request\'s own key is scrubbed from a network error text (a header the fetch layer rejects, echoed back)', async () => {
  await withEnv({ OPENROUTER_API_KEY: 'sk-or-v1-SECRETKEYVALUE9999', COUNCIL_PLUGIN_OPENROUTER_API_KEY: null }, async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => { throw new TypeError('Headers.append: "Bearer sk-or-v1-SECRETKEYVALUE9999" is an invalid header value.'); };
    try {
      await assert.rejects(() => call('openrouter', { model: 'deepseek/deepseek-v4.1-flash', system: 's', messages: [{ role: 'user', content: 'u' }], maxTokens: 100 }), err => {
        assert.doesNotMatch(err.message, /SECRETKEYVALUE9999/);
        return true;
      });
    } finally { globalThis.fetch = original; }
  });
});

test('A2-1: the scrub leaves headers that are not credentials readable (the Anthropic API version stays in an error text)', async () => {
  await withEnv({ ANTHROPIC_API_KEY: 'sk-ant-SECRETKEYVALUE9999', COUNCIL_PLUGIN_ANTHROPIC_API_KEY: null }, async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => { throw new TypeError('bad request: x-api-key sk-ant-SECRETKEYVALUE9999 anthropic-version 2023-06-01'); };
    try {
      await assert.rejects(() => call('anthropic', { model: 'claude-sonnet-5', system: 's', messages: [{ role: 'user', content: 'u' }], maxTokens: 100 }), err => {
        assert.doesNotMatch(err.message, /SECRETKEYVALUE9999/);
        assert.match(err.message, /2023-06-01/);
        return true;
      });
    } finally { globalThis.fetch = original; }
  });
});

test('A2-1: `council doctor` says a malformed key is malformed (presence only, never the text)', () => {
  const env = { ...process.env }; for (const k of Object.keys(env)) if (/API_KEY/.test(k)) delete env[k];
  env.OPENROUTER_API_KEY = TWO_LINES;
  const out = execFileSync(process.execPath, [cli, 'doctor'], { cwd: mkdtempSync(join(tmpdir(), 'thc-doctor-')), env, encoding: 'utf8', stdio: 'pipe' });
  assert.match(out, /OPENROUTER_API_KEY\s+.*malformed/i);
  assert.doesNotMatch(out, /FIRSTPART|SECONDPART/);
});

test('A2-3: a seat that carries a reasoning field of ANY spelling gets no harness default beside it (Google rejects reasoning_effort next to thinking_config)', () => {
  const google = extra => ({ provider: 'google', model: 'gemini-3.6-flash', maxTokens: 36000, extra });
  const own = [{ thinking_config: { thinking_level: 'high' } }, { google: { thinking_config: { thinking_budget: 24576 } } }, { thinking_budget: 24576 }, { thinkingConfig: { thinkingBudget: 24576 } }];
  for (const extra of own) {
    assert.equal(highExtraFor(google(extra)), null, `a default was added beside ${JSON.stringify(extra)}`);
    assert.deepEqual(extraWithHighDefault(google(extra)), extra);
  }
  // OpenRouter: an own top-level reasoning_effort gets no `reasoning` beside it.
  const orSeat = { provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash', maxTokens: 36000, extra: { reasoning_effort: 'high' } };
  assert.equal(highExtraFor(orSeat), null);
  // A seat with no reasoning field still gets the default.
  assert.ok(highExtraFor({ provider: 'google', model: 'gemini-3.6-flash', maxTokens: 36000 }));
  assert.ok(highExtraFor({ provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash', maxTokens: 36000, extra: { provider: { order: ['x'] } } }), 'an unrelated own field does not block the default');
});

test('A2-4: the single-vendor reroute leaves exactly one reasoning field on the wire (a native lowering field stays alone; output_config.effort is dropped leaf by leaf)', () => {
  const via = seat => resolveVendorSeat(seat, 'openrouter');
  const wire = seat => extraWithHighDefault(seat, seat.maxTokens);
  // output_config high next to thinking disabled: the user's own words stand alone (one field), not "disabled + reasoning high".
  const both = via({ provider: 'anthropic', model: 'claude-sonnet-5', maxTokens: 36000, extra: { output_config: { effort: 'high' }, thinking: { type: 'disabled' } } });
  assert.deepEqual(wire(both), { thinking: { type: 'disabled' } });
  // output_config high next to an unrelated sibling (format): only the effort leaf is dropped, the vendor high is added, the sibling goes through.
  const fmt = via({ provider: 'anthropic', model: 'claude-sonnet-5', maxTokens: 36000, extra: { output_config: { effort: 'high', format: { type: 'json_schema' } } } });
  assert.deepEqual(wire(fmt), { output_config: { format: { type: 'json_schema' } }, reasoning: { effort: 'high' } });
});

test('A2-5: loweringReasons sees every spelling of "off" the audit found (extra_body, include_reasoning:false, top-level thinking_budget/thinking_level, thinkingConfig)', () => {
  const cases = [
    { extra_body: { google: { thinking_config: { thinking_budget: 0 } } } },
    { extra_body: { reasoning_effort: 'low' } },
    { include_reasoning: false },
    { thinking_budget: 0 },
    { thinking_level: 'low' },
    { thinkingConfig: { thinkingBudget: 0 } },
    { thinkingConfig: { thinkingLevel: 'low' } },
  ];
  for (const extra of cases) assert.ok(loweringReasons(extra).length > 0, `not flagged: ${JSON.stringify(extra)}`);
  for (const ok of [{ include_reasoning: true }, { thinking_level: 'high' }, { thinkingConfig: { thinkingLevel: 'high' } }, { extra_body: { reasoning_effort: 'high' } }, {}]) assert.deepEqual(loweringReasons(ok), [], `wrongly flagged: ${JSON.stringify(ok)}`);
});
