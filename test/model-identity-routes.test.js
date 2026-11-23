// 0.8.4 the OpenRouter switch, first group (Builder B; plan section 14): ONE model on both routes. OpenRouter writes a Claude version with a dot ("anthropic/claude-haiku-5.5"), Anthropic with a hyphen ("claude-haiku-5-5").
// At the base, modelIdentity kept the dot, so a routed copy of a repeated model was not recognised as it: src/seat-key.js assertSeatKeyed (a copy that lost its seat key is refused loudly) stayed silent for it.
// Claude ids only: every other id keeps its dots. The shipped chains' identities do not move (script over chains/*.json, 10 Nov 2026: no shipped chain changes an identity or gains an equal pair).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { modelIdentity, seatIdentity } from '../src/stage-system.js';
import { registerSeatKeys, seatKeyOf, assertSeatKeyed, keepSeatKey } from '../src/seat-key.js';
import { lintChain } from '../src/chain-lint.js';
import { criticPromptFor, labOf } from '../src/chain.js';
import { readChainFile } from './helpers/chain-file.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('MI-1 a Claude model is one model on both routes: the dotted OpenRouter id, the hyphenated direct id, a :variant and any case give the same identity; other labs\' ids keep their dots; mock and external have none', () => {
  const direct = { provider: 'anthropic' }, routed = { provider: 'openrouter' };
  for (const [d, o] of [['claude-haiku-5-5', 'anthropic/claude-haiku-5.5'], ['claude-sonnet-5-5', 'anthropic/claude-sonnet-5.5'], ['claude-opus-5-5', 'anthropic/claude-opus-5.5'], ['claude-fable-5-1', 'anthropic/claude-fable-5.1'], ['claude-fable-5-2', 'anthropic/claude-fable-5.2'], ['claude-sonnet-5', 'anthropic/claude-sonnet-5']]) {
    assert.equal(modelIdentity({ ...routed, model: o }), d, o);
    assert.equal(modelIdentity({ ...direct, model: d }), d, d);
    assert.equal(seatIdentity({ ...routed, model: o }), seatIdentity({ ...direct, model: d }));
  }
  assert.equal(modelIdentity({ ...routed, model: 'Anthropic/Claude-Opus-5.5:beta' }), 'claude-opus-5-5');
  for (const [m, want] of [['google/gemini-3.8-flash', 'gemini-3.8-flash'], ['openai/gpt-6.1-sol', 'gpt-6.1-sol'], ['qwen/qwen3.8-max-0902', 'qwen3.8-max-0902'], ['deepseek/deepseek-v4.1-flash-1017', 'deepseek-v4.1-flash-1017']]) assert.equal(modelIdentity({ provider: 'openrouter', model: m }), want, `${m} keeps its dots`);
  assert.equal(modelIdentity({ provider: 'mock', model: 'claude-x.y' }), null); assert.equal(modelIdentity({ provider: 'external', model: 'claude-code-session' }), null);
});

test('MI-2 a routed copy of a repeated Claude model that LOST its seat key is refused loudly (assertSeatKeyed), as a direct copy is; one that keeps it (keepSeatKey) passes; and the routed twins get the direct roster\'s keys', () => {
  const direct = { seats: { critics: [{ provider: 'anthropic', model: 'claude-haiku-5-5', lab: 'haiku5.5', layer: 1 }, { provider: 'anthropic', model: 'claude-haiku-5-5', lab: 'haiku5.5', layer: 1 }, { provider: 'mock', model: 'mock-critic-a', lab: 'm', layer: 2 }] } };
  registerSeatKeys(direct);
  const keys = direct.seats.critics.map(seatKeyOf);
  assert.deepEqual(keys, ['haiku5.5', 'haiku5.5-l1-2', 'm']);
  const routedCopy = s => ({ ...s, provider: 'openrouter', model: 'anthropic/claude-haiku-5.5', originalProvider: 'anthropic' });
  assert.throws(() => assertSeatKeyed(routedCopy(direct.seats.critics[1])), /reached a call without its seat key/, 'a routed copy that lost its key');
  assert.throws(() => assertSeatKeyed({ ...direct.seats.critics[1], maxTokens: 10 }), /reached a call without its seat key/, 'and a direct one, for comparison');
  assert.doesNotThrow(() => assertSeatKeyed(keepSeatKey(direct.seats.critics[1], routedCopy(direct.seats.critics[1]))));
  const routed = { seats: { critics: direct.seats.critics.map(s => (s.provider === 'mock' ? s : routedCopy(s))) } };
  registerSeatKeys(routed);
  assert.deepEqual(routed.seats.critics.map(seatKeyOf), keys, 'the routed twins get the same keys');
  registerSeatKeys({ seats: {} });
});

test('MI-3 no SHIPPED chain changes a seat identity by this rule (the lint and the writer check read identities) -- a GUARD with no red of its own; the scan itself is shown able to fail on a hand-made wrong identity that turns every dot into a hyphen', () => {
  const before = seat => (!seat.model || seat.provider === 'mock' || seat.provider === 'external' ? null : String(seat.model).toLowerCase().split('/').pop().split(':')[0]);
  const walk = (x, out) => { if (Array.isArray(x)) x.forEach(i => walk(i, out)); else if (x && typeof x === 'object') { if (typeof x.model === 'string' && typeof x.provider === 'string') out.push(x); Object.values(x).forEach(v => walk(v, out)); } return out; };
  const shipped = readdirSync(join(root, 'chains')).filter(n => n.endsWith('.json')).flatMap(f => walk(JSON.parse(readFileSync(join(root, 'chains', f), 'utf8')).seats ?? {}, []));
  const movedBy = identityOf => shipped.filter(s => identityOf(s) !== before(s)).map(s => `${s.provider}/${s.model}`);
  assert.ok(shipped.length > 50, `shipped seats were found (${shipped.length})`);
  assert.deepEqual(movedBy(modelIdentity), [], 'no shipped seat changes its identity');
  const everyDot = s => before(s)?.replace(/\./g, '-') ?? null;      // a wrong rule: every id loses its dots, not only Claude ids
  assert.ok(movedBy(everyDot).length > 0, 'the scan sees a rule that moves identities (it is not blind)');
});

test('MI-4 what moves (stage-system.js isWriterSeat and chain-lint\'s self-review read the identity): a person\'s OWN chain whose builder is the direct claude-opus-5-5 and whose critic is the dotted OpenRouter id is one model, so the lint says self-review (before this change it saw two models and said nothing)', () => {
  const c = JSON.parse(readFileSync(new URL('../chains/outdated/cheap-7-v2.json', import.meta.url), 'utf8'));
  const selfReview = chain => lintChain(chain, 'own.json').filter(f => f.kind === 'self-review');
  c.seats.builder = { provider: 'anthropic', model: 'claude-opus-5-5', lab: 'writer' };
  assert.equal(selfReview(c).filter(f => /seats\.builder runs model/.test(f.message)).length, 0, 'the premise: no critic runs the builder\'s model yet');
  c.seats.critics.push({ provider: 'openrouter', model: 'anthropic/claude-opus-5.5', lab: 'critic-x' });
  assert.ok(selfReview(c).some(f => /seats\.builder runs model/.test(f.message)), 'the dotted OpenRouter id is the builder\'s model');
  assert.deepEqual([modelIdentity(c.seats.builder), modelIdentity(c.seats.critics.at(-1))], ['claude-opus-5-5', 'claude-opus-5-5']);
});

test('MI-5 which seat reads the WRITER-CRITIC opening (stage-system.js criticPromptFor, isWriterSeat): in a person\'s own chain that sets "selfReview": "allowed", the seat of the writer\'s model under the dotted OpenRouter id gets EXACTLY the prompt the hyphenated seat of that model gets (before the identity change it did not), and a seat of another model gets a different one -- compared seat against seat, so no recorded sentence is retyped here', () => {
  const cfg = readChainFile(root, 'plan-mini-council');      // a CURRENT shipped chain as the base (chains/plan-mini-council.json, read by other prompt tests too; not a retired file); everything this test is about is set below
  cfg.selfReview = 'allowed';
  cfg.seats.builder = { provider: 'anthropic', model: 'claude-opus-5-5', lab: 'writer' }; cfg.seats.reviser = cfg.seats.builder;
  cfg.seats.critics = [
    { provider: 'anthropic', model: 'claude-opus-5-5', lab: 'direct-same' },
    { provider: 'openrouter', model: 'anthropic/claude-opus-5.5', lab: 'dotted-same' },
    { provider: 'openrouter', model: 'google/gemini-3.8-flash', lab: 'other' },
  ];
  const [direct, dotted, other] = cfg.seats.critics;
  const prompt = c => criticPromptFor(c, false, undefined, cfg);
  assert.equal(prompt(dotted), prompt(direct), 'the dotted OpenRouter seat of the writer\'s model reads what the hyphenated seat of that model reads (this is the change)');
  assert.notEqual(prompt(other), prompt(direct), `${labOf(other)}: a seat of another model does not read it (so equal means the writer-critic opening for both, not the plain one for all)`);
  assert.equal(prompt(other), criticPromptFor(other, false, undefined, { ...cfg, selfReview: undefined }), 'and its prompt is the plain one: the same as with self-review off');
});
