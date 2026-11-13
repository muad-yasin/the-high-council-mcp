// 084/glm-format (A-DRAFT): JSON mode on the layer-exchange calls (src/exchange-json-mode.js, chain switch `exchange_json_mode`) and the closing sentence at the end of both exchange user messages
// (src/roles.js layerExchangeClosing, appended by exchangeClosingText). Offline, $0: OpenRouter and Anthropic seats are answered by a stubbed fetch that records every request body it is handed.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { runChain, exchangeRound, setCache, setBudget, setPromptSpy } from '../src/chain.js';
import { critic, chainOf } from './helpers/final-read-chain.js';
import { lintChain } from '../src/chain-lint.js';
import { exchangeJsonModeLabs, jsonModeSeat, lintExchangeJsonMode, exchangeClosingText, JSON_MODE_RESPONSE_FORMAT } from '../src/exchange-json-mode.js';
import { layerExchangeClosing } from '../src/roles.js';
import { setHeldForTest } from '../src/held-roles.js';
import { setProviderPreference, resetProviderPreference } from '../src/provider-preference.js';
import { fixExchangeBody } from '../scripts/exchange-body-fix.mjs';
import { wordingText, WORDING_FILES } from './helpers/wording-files.js';
// CHANGED ACCEPTED (0.8.4 N9, C&C's ruling 4: `layer_debate.rounds` is removed): its two chains set `layer_debate: { enabled: true, rounds: 3 }`; they now set no `layer_debate` block (the key and the switch are removed; the assertions are unchanged).

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SENTENCE = 'Reply as a reviewer on this panel with the single JSON object described in your instructions, and double-check that the JSON format is correct before you reply.';
const realFetch = globalThis.fetch;
const realEnv = { OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY };
afterEach(() => {
  globalThis.fetch = realFetch; setHeldForTest(null); resetProviderPreference(); setCache(null); setBudget(null); setPromptSpy(null);
  for (const [k, v] of Object.entries(realEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const GLM = { provider: 'openrouter', model: 'z-ai/glm-5.3-flash', lab: 'glm5.3-flash', layer: 1, maxTokens: 20000, extra: { reasoning: { effort: 'high' }, provider: { ignore: ['open-inference', 'fireworks/us'] } } };
const OTHER = { provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash-1017', lab: 'deepseek-v4.1-flash', layer: 1, maxTokens: 20000, extra: { reasoning: { effort: 'high' }, provider: { ignore: ['open-inference'] } } };
const CLAUDE = { provider: 'anthropic', model: 'claude-haiku-5-5', lab: 'haiku5.5', layer: 1, maxTokens: 20000, extra: { output_config: { effort: 'high' } } };
const failure = (criterion, problem) => [{ criterion, problem }];
const judgesOf = seats => seats.map((s, i) => ({ seat: s, key: s.lab, failures: failure(`Criterion ${i + 1} of the test plan.`, `Problem ${i + 1}: the plan does not say.`) }));
const RULINGS = '\n\n# Rulings\n\n1. The date is fixed.';
const common = (judges, rulingsText = RULINGS) => ({ judges, request: 'A bake sale.', criteria: ['It states its assumptions.'], draft: '# Plan\n\nBake a cake.', round: 1, record: s => s, rounds: 1, rulingsText });

// A stubbed provider: answers every post with a support on each objection id it was shown and every answer with a keep on each of its own, and records every request body.
function stubProviders() {
  const sent = [];
  process.env.OPENROUTER_API_KEY = 'test-key-not-real'; process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body); const u = String(url);
    const system = typeof body.system === 'string' ? body.system : (body.messages || []).find(m => m.role === 'system')?.content || '';
    const user = (body.messages || []).filter(m => m.role === 'user').at(-1)?.content;
    const userText = typeof user === 'string' ? user : JSON.stringify(user);
    const isReply = /"replies"/.test(system);
    sent.push({ url: u, model: body.model, type: isReply ? 'reply' : 'post', body });
    const own = [...new Set([...userText.matchAll(/Your objection (O-[0-9a-f]{8})/g)].map(m => m[1]))];
    const shown = [...new Set([...userText.matchAll(/Objection (O-[0-9a-f]{8})/g)].map(m => m[1]))];
    const text = isReply ? JSON.stringify({ replies: own.map(id => ({ id, action: 'keep', text: 'It stands.' })) }) : JSON.stringify({ posts: shown.map(id => ({ on: id, stance: 'support', text: 'It holds.' })), new_objections: [] });
    const json = u.includes('anthropic.com')
      ? { id: 'msg_1', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }
      : { id: 'gen-1', provider: 'Venice', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
    return new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return sent;
}

test('the switch is read once: off unless enabled is true AND at least one lab is listed', () => {
  assert.equal(exchangeJsonModeLabs({}), null);
  assert.equal(exchangeJsonModeLabs({ exchange_json_mode: { enabled: false, labs: ['a'] } }), null);
  assert.equal(exchangeJsonModeLabs({ exchange_json_mode: { enabled: true } }), null);
  assert.equal(exchangeJsonModeLabs({ exchange_json_mode: { enabled: true, labs: [] } }), null);
  assert.deepEqual([...exchangeJsonModeLabs({ exchange_json_mode: { enabled: true, labs: ['glm5.3-flash', ' ', 7] } })], ['glm5.3-flash']);
});

test('jsonModeSeat: a listed OpenRouter seat gets a copy with response_format and the original is untouched; an unlisted seat, an Anthropic seat (direct or rerouted), an external seat and a seat with its own response_format are returned as they are', () => {
  const labs = new Set(['glm5.3-flash', 'haiku5.5', 'ext']);
  const out = jsonModeSeat(GLM, labs);
  assert.notEqual(out, GLM);
  assert.deepEqual(out.extra.response_format, JSON_MODE_RESPONSE_FORMAT);
  assert.deepEqual(out.extra.reasoning, GLM.extra.reasoning);
  assert.equal('response_format' in GLM.extra, false, 'the seat itself is not mutated');
  assert.equal(jsonModeSeat(OTHER, labs), OTHER, 'unlisted lab');
  assert.equal(jsonModeSeat(CLAUDE, labs), CLAUDE, 'a direct Anthropic seat is never given JSON mode, even when its lab is listed');
  const rerouted = { ...GLM, lab: 'haiku5.5', originalProvider: 'anthropic' };
  assert.equal(jsonModeSeat(rerouted, labs), rerouted, 'a seat rerouted from Anthropic is never given JSON mode');
  const ext = { provider: 'external', model: 'x', lab: 'ext' };
  assert.equal(jsonModeSeat(ext, labs), ext);
  const own = { ...GLM, extra: { ...GLM.extra, response_format: { type: 'json_schema' } } };
  assert.equal(jsonModeSeat(own, labs), own, 'the seat\'s own response_format wins');
  assert.equal(jsonModeSeat(GLM, null), GLM, 'switch off');
});

test('exchange calls on the wire: only the listed OpenRouter seat\'s post AND answer carry response_format {"type":"json_object"}; the unlisted seat and the Anthropic seat (listed on purpose) carry none; nothing else in any body changes', async () => {
  const run = async labs => { const sent = stubProviders(); await exchangeRound({ ...common(judgesOf([GLM, OTHER, CLAUDE])), jsonModeLabs: labs }); return sent; };
  const on = await run(new Set(['glm5.3-flash', 'haiku5.5']));
  const off = await run(null);
  const of = (sent, model, type) => { const hits = sent.filter(s => s.model === model && s.type === type); assert.equal(hits.length, 1, `${model} ${type}`); return hits[0].body; };
  for (const type of ['post', 'reply']) {
    assert.deepEqual(of(on, GLM.model, type).response_format, { type: 'json_object' }, `GLM ${type}`);
    assert.equal('response_format' in of(on, OTHER.model, type), false, `unlisted ${type}`);
    assert.equal('response_format' in of(on, CLAUDE.model, type), false, `Anthropic ${type}: never`);
    for (const m of [GLM.model, OTHER.model, CLAUDE.model]) {
      const a = structuredClone(of(on, m, type)); delete a.response_format;
      assert.deepEqual(a, of(off, m, type), `${m} ${type}: with the switch on, the body is the same bar response_format`);
    }
    assert.equal('response_format' in of(off, GLM.model, type), false, 'switch off: nothing');
  }
  assert.equal(on.length, 6, 'three seats, one post and one answer each');
});

test('JSON mode lives in exchangeRound only: the source names jsonModeSeat in chain.js inside exchangeRound and nowhere else, and no other file of src/ builds a response_format', () => {
  const chain = readFileSync(join(root, 'src', 'chain.js'), 'utf8');
  const start = chain.indexOf('export async function exchangeRound(');
  const end = chain.indexOf('\nexport ', start + 10) > 0 ? chain.indexOf('\nexport ', start + 10) : chain.length;
  const body = chain.slice(start, end);
  const uses = [...chain.matchAll(/jsonModeSeat\(/g)].map(m => m.index);
  assert.equal(uses.length, 1, 'one use');
  assert.ok(uses[0] > start && uses[0] < start + body.length, 'inside exchangeRound');
  for (const f of readdirSync(join(root, 'src'), { recursive: true }).filter(f => String(f).endsWith('.js'))) {
    const t = readFileSync(join(root, 'src', String(f)), 'utf8');
    if (/response_format\s*:/.test(t)) assert.equal(String(f), 'exchange-json-mode.js', `${f} builds a response_format`);
  }
});

test('the closing sentence: the end of BOTH exchange user messages, after the rulings text; the cached head stays the start of the message; no other call carries it; held off, the messages end with the rulings text as before', async () => {
  const seatA = { provider: 'mock', model: 'mock-exch-contest-keep', lab: 'xa', layer: 1 }, seatB = { provider: 'mock', model: 'mock-exch-support-withdraw', lab: 'xb', layer: 1 };
  const judges = [{ key: 'xa', seat: seatA, failures: failure('It states its assumptions.', 'No assumptions are stated anywhere.') }, { key: 'xb', seat: seatB, failures: failure('It adds no scope.', 'It adds a billing system.') }];
  const args = { judges, request: 'A bake sale.', criteria: ['It states its assumptions.'], draft: '# Plan\n\nBake a cake.\n\n# Draft under review\n\nthe head ends here', round: 1, record: s => s, rounds: 3, rulingsText: RULINGS, cacheTtl: '5m' };   // FINDING (not on the owed list of the ladder unit; C&C's ruling B number, 10 Nov 2026): a 1-hour marker needs a 4-round budget now, a 5-minute one 3; this row only needs a head to be carried
  const spied = []; setPromptSpy(p => spied.push(p));
  await exchangeRound(args);
  const exch = spied.filter(p => /^l(debate|reply)-/.test(p.label));
  assert.ok(exch.some(p => /^ldebate-/.test(p.label)) && exch.some(p => /^lreply-/.test(p.label)), 'both a post and an answer were made');
  for (const p of exch) {
    assert.ok(p.user.endsWith(`${RULINGS}\n\n${SENTENCE}`), `${p.label}: the sentence is the very last thing, after the rulings`);
    assert.equal(p.user.split(SENTENCE).length - 1, 1, `${p.label}: once`);
    if ('cacheHead' in p) { assert.ok(p.user.startsWith(p.cacheHead), `${p.label}: the head is still the start`); assert.ok(!p.cacheHead.includes(SENTENCE), `${p.label}: the sentence is not in the cached head`); }
  }
  assert.ok(exch.some(p => 'cacheHead' in p), 'at least one call carried a head (round 2 or later)');
  assert.equal(layerExchangeClosing(), SENTENCE);
  assert.equal(exchangeClosingText(), `\n\n${SENTENCE}`);
  setHeldForTest({ layerExchangeClosing: undefined });
  spied.length = 0; await exchangeRound({ ...args, cacheTtl: null });
  assert.ok(spied.length > 0 && spied.every(p => p.user.endsWith(RULINGS)), 'held off: no byte added');
  setHeldForTest(null);
  assert.ok(spied.every(p => /^l(debate|reply)-/.test(p.label)), 'exchangeRound makes only exchange calls');
});

test('the closing sentence reaches the exchange calls of a WHOLE run and no other call (panel, revise, criteria, build, handoff), and is appended by one call site', async () => {
  const config = chainOf([critic('mock-exch-contest-keep', 'j1a', 1), critic('mock-exch-support-withdraw', 'j1b', 1), critic('mock-exch-support-keep', 'j2', 2), critic('mock-exch-support-keep', 'j3', 3)],
    { maxRounds: 2, answer_back: { enabled: true } });
  const spied = []; setPromptSpy(p => spied.push(p));
  await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-glm-format-whole', config });
  assert.ok(spied.some(p => /^ldebate-/.test(p.label)) && spied.some(p => /^lreply-/.test(p.label)) && spied.some(p => /^panel-/.test(p.label)), spied.map(p => p.label).join(','));
  for (const p of spied) assert.equal(p.user.includes(SENTENCE) || p.system.includes(SENTENCE), /^l(debate|reply)-/.test(p.label), `${p.label}: ${/^l(debate|reply)-/.test(p.label) ? 'must' : 'must not'} carry the sentence`);
  assert.equal(readFileSync(join(root, 'src', 'chain.js'), 'utf8').split('exchangeClosingText()').length - 1, 1, 'one call of exchangeClosingText in chain.js (inside exchangeRound)');
  // one definition in the words, and src/roles.js names it once more in its export line (the split: roles.js lists the names, the words are in src/prompts/)
  assert.equal(wordingText(root, WORDING_FILES.filter(f => f !== 'src/roles.js')).split('layerExchangeClosing').length - 1, 1, 'one export in the wording files');
  assert.equal(wordingText(root, ['src/roles.js']).split('layerExchangeClosing').length - 1, 1, 'and src/roles.js names it once');
});

test('lint: the switch is refused when it would do nothing or names a seat it must not touch; a good switch passes; an unknown key (require_parameters) is refused', () => {
  const chain = extra => ({ name: 't', signoff: 'unanimous', seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics: [GLM, OTHER, CLAUDE] }, ...extra });
  const kinds = c => lintExchangeJsonMode(c).map(f => f.kind);
  assert.deepEqual(kinds(chain({})), [], 'absent');
  assert.deepEqual(kinds(chain({ exchange_json_mode: { enabled: false, labs: ['nobody'] } })), [], 'off: nothing to say');
  assert.deepEqual(kinds(chain({ exchange_json_mode: { enabled: true, labs: ['glm5.3-flash'] } })), []);
  assert.deepEqual(kinds(chain({ exchange_json_mode: { enabled: true, labs: [] } })), ['exchange-json-mode-no-labs']);
  assert.deepEqual(kinds(chain({ exchange_json_mode: { enabled: true, labs: ['glm5.3-flash', 'ghost'] } })), ['exchange-json-mode-unknown-lab']);
  assert.deepEqual(kinds(chain({ exchange_json_mode: { enabled: true, labs: ['haiku5.5'] } })), ['exchange-json-mode-anthropic-lab']);
  // CHANGED ACCEPTED (0.8.4, `layer_debate.enabled` removed). OLD: the same chain without the switch (`layer_debate: undefined`) gave 'exchange-json-mode-needs-exchange'. NEW: the chains that never run an exchange give it: signoff not unanimous, and one judge on the lowest layer (the chain with its three layer-1 judges, above, passes). WHY: there is no switch; the lint reads whether the exchange can run (exchangeJudgeCount in src/layer-debate.js: layered, unanimous, two judges on the lowest layer).
  assert.deepEqual(kinds(chain({ signoff: 'first', exchange_json_mode: { enabled: true, labs: ['glm5.3-flash'] } })), ['exchange-json-mode-needs-exchange']);
  assert.deepEqual(lintExchangeJsonMode({ ...chain({ exchange_json_mode: { enabled: true, labs: ['glm5.3-flash'] } }), seats: { ...chain({}).seats, critics: [GLM] } }).map(f => f.kind), ['exchange-json-mode-needs-exchange']);
  const viaLint = chain({ exchange_json_mode: { enabled: true, labs: ['glm5.3-flash'], require_parameters: true } });
  assert.ok(lintChain(viaLint).some(f => /exchange_json_mode/.test(JSON.stringify(f))), 'an unknown key is refused by chain-lint');
  assert.ok(lintChain(chain({ exchange_json_mode: { enabled: true, labs: ['ghost'] } })).some(f => f.kind === 'exchange-json-mode-unknown-lab'), 'chain-lint runs the switch lint');
});

test('chain-schema lists exchange_json_mode (enabled, labs) and refuses another key or a non-string lab', () => {
  const schema = JSON.parse(readFileSync(join(root, 'config', 'chain-schema.json'), 'utf8'));
  const validate = new Ajv({ allErrors: true }).compile(schema);
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-layered.json'), 'utf8'));
  assert.ok(validate({ ...base, exchange_json_mode: { enabled: true, labs: ['glm5.3-flash'] } }), JSON.stringify(validate.errors));
  assert.equal(validate({ ...base, exchange_json_mode: { enabled: true, labs: ['glm5.3-flash'], require_parameters: true } }), false);
  assert.equal(validate({ ...base, exchange_json_mode: { enabled: true, labs: [7] } }), false);
  assert.equal(validate({ ...base, exchange_json_mode: { enable: true } }), false, 'a typo\'d key');
});

// The paid test's preparation relies on this equality: the body THC sent BEFORE the change, put through fixExchangeBody, is byte for byte the body the call site sends AFTER it. Two shapes of user message: one that ends with the handler's
// rulings text (a run with a ruling), and one with NO rulings text, which is the shape of the nine run-3 bodies the tiny test rebuilds (they end on the last objection).
for (const rulings of [RULINGS, '']) {
  test(`fixExchangeBody equals the call site (${rulings ? 'user message ends with the rulings text' : 'no rulings text: the message ends on the last objection'}): an old exchange body (switch off, sentence off, old host order) put through the transform is byte for byte the new body (switch on, sentence on, new host order), for the post and the answer`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'thc-glm-format-'));
    const write = prefer => { writeFileSync(join(dir, 'provider-preference.json'), JSON.stringify({ 'openrouter/z-ai/glm-5.3-flash': { prefer } })); setProviderPreference(dir); };
    const OLD_ORDER = ['gmicloud/fp8', 'novita/fp8', 'open-inference/fp4', 'fireworks/us', 'venice'], NEW_ORDER = ['venice', 'gmicloud/fp8', 'novita/fp8', 'open-inference/fp4', 'fireworks/us'];
    const labs = new Set(['glm5.3-flash']);
    write(OLD_ORDER); setHeldForTest({ layerExchangeClosing: undefined });
    let sent = stubProviders();
    await exchangeRound({ ...common(judgesOf([GLM, OTHER]), rulings), jsonModeLabs: null });
    const oldBodies = Object.fromEntries(sent.filter(s => s.model === GLM.model).map(s => [s.type, s.body]));
    setHeldForTest(null); write(NEW_ORDER);
    sent = stubProviders();
    await exchangeRound({ ...common(judgesOf([GLM, OTHER]), rulings), jsonModeLabs: labs });
    const newBodies = Object.fromEntries(sent.filter(s => s.model === GLM.model).map(s => [s.type, s.body]));
    assert.deepEqual(Object.keys(oldBodies).sort(), ['post', 'reply']);
    for (const type of ['post', 'reply']) {
      assert.deepEqual(oldBodies[type].provider.order, ['gmicloud/fp8', 'novita/fp8', 'venice'], `${type}: the old order (the ignored tags are dropped by orderFor)`);
      assert.deepEqual(newBodies[type].provider.order, ['venice', 'gmicloud/fp8', 'novita/fp8'], `${type}: the new order`);
      if (rulings) assert.ok(oldBodies[type].messages[1].content.endsWith(rulings), `${type}: the old user message ends with the rulings text`);
      // 0.8.4 (WORDING_0.8.4.md section E2, ownFailuresBlock, recorded at the apply): the round-1 POST also lists the judge's own failures that quote nothing, after the objections and before any rulings text; the reply has no such block.
      else if (type === 'post') assert.ok(!oldBodies[type].messages[1].content.includes('# Rulings') && /\n\nYour own failures that quote nothing:\n- [^\n]+(\n- [^\n]+)*$/.test(oldBodies[type].messages[1].content), `${type}: no rulings text, the old user message ends on the own-failures block`);
      else assert.ok(!oldBodies[type].messages[1].content.includes('# Rulings') && oldBodies[type].messages[1].content.endsWith('</critic-claim>'), `${type}: no rulings text, the old user message ends on the last objection`);
      const fixed = fixExchangeBody(oldBodies[type], { seat: GLM, jsonModeLabs: labs });
      assert.equal(JSON.stringify(fixed), JSON.stringify(newBodies[type]), `${type}: the transform and the call site give identical bytes`);
      assert.notEqual(JSON.stringify(oldBodies[type]), JSON.stringify(newBodies[type]), `${type}: and the change is not a no-op`);
    }
  });
}
