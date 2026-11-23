// M0 FIX 3 (C&C's verdict item 3, 4 Nov 2026; RU-S1-23 and RU-S1-24, Q3(f), D36): the record keeps each poster's maker (the company behind the seat) on every layer_debates post, the raiser's maker on each objection row, and per objection which makers
// raised, supported and contested it. RECORD ONLY: never shown to a judge, never weighed. API seats are named by the chain at record time (companyOfSeat of the seat's model); a session seat by the company its answer DECLARED, added at report time
// (src/answered-by.js layerDebatesWithMakers, called by report-shape.js); a mock seat or an undeclared session answer has none (no lab fallback: shipped judges have a lab each, so a lab would make makers equal seats).
// Offline, $0: OpenRouter and Anthropic seats are answered by a stubbed fetch (the style of test/exchange-json-mode.test.js).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exchangeRound, setCache, setBudget, setPromptSpy } from '../src/chain.js';
import { resetProviderPreference } from '../src/provider-preference.js';
import * as AB from '../src/answered-by.js';   // read through the namespace, so a tree without the report-side functions fails each test on its own (a TypeError), not the whole file at load
const layerDebatesWithMakers = (...a) => AB.layerDebatesWithMakers(...a);
const makerOfStage = (...a) => AB.makerOfStage(...a);

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const realFetch = globalThis.fetch;
const realEnv = { OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY };
afterEach(() => {
  globalThis.fetch = realFetch; resetProviderPreference(); setCache(null); setBudget(null); setPromptSpy(null);
  for (const [k, v] of Object.entries(realEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const GLM = { provider: 'openrouter', model: 'z-ai/glm-5.3-flash', lab: 'glm5.3-flash', layer: 1, maxTokens: 20000, extra: { reasoning: { effort: 'high' }, provider: { ignore: ['open-inference', 'fireworks/us'] } } };
const OTHER = { provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash-1017', lab: 'deepseek-v4.1-flash', layer: 1, maxTokens: 20000, extra: { reasoning: { effort: 'high' }, provider: { ignore: ['open-inference'] } } };
const HAIKU = { provider: 'anthropic', model: 'claude-haiku-5-5', lab: 'haiku5.5', layer: 1, maxTokens: 20000, extra: { output_config: { effort: 'high' } } };
const OPUS = { provider: 'anthropic', model: 'claude-opus-5-5', lab: 'opus5.5', layer: 1, maxTokens: 20000, extra: { output_config: { effort: 'high' } } };
const MOCK = { provider: 'mock', model: 'mock-exch-support-keep-clean', lab: 'mockjudge', layer: 1 };
const MAKERS = { 'glm5.3-flash': 'z-ai', 'deepseek-v4.1-flash': 'deepseek', 'haiku5.5': 'anthropic', 'opus5.5': 'anthropic' };
const DRAFT = '# Plan\n\nBake a cake. Sell it at the fair.';
const judgesOf = seats => seats.map((s, i) => ({ seat: s, key: s.lab, failures: s === MOCK ? [] : [{ criterion: `Criterion ${i + 1} of the test plan.`, problem: `Problem ${i + 1}: the plan does not say.` }] }));

// A stubbed provider: every post is `stance` on each objection it was shown (a contest quotes a passage of the plan), every answer a keep; it records nothing about the maker, it cannot know it.
function stub(stance) {
  process.env.OPENROUTER_API_KEY = 'test-key-not-real'; process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body); const u = String(url);
    const system = typeof body.system === 'string' ? body.system : (body.messages || []).find(m => m.role === 'system')?.content || '';
    const user = (body.messages || []).filter(m => m.role === 'user').at(-1)?.content;
    const userText = typeof user === 'string' ? user : JSON.stringify(user);
    const isReply = /"replies"/.test(system);
    const own = [...new Set([...userText.matchAll(/Your objection (O-[0-9a-f]{8})/g)].map(m => m[1]))];
    const shown = [...new Set([...userText.matchAll(/Objection (O-[0-9a-f]{8})/g)].map(m => m[1]))];
    const post = id => (stance === 'contest' ? { on: id, stance, quote: 'Bake a cake.', text: 'The plan already answers this where it says so.' } : { on: id, stance, text: 'It holds.' });
    const text = isReply ? JSON.stringify({ replies: own.map(id => ({ id, action: 'keep', text: 'It stands.' })) }) : JSON.stringify({ posts: shown.map(post), new_objections: [] });
    const json = u.includes('anthropic.com')
      ? { id: 'msg_1', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }
      : { id: 'gen-1', provider: 'Venice', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
    return new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}
const run = async (seats, stance) => {
  stub(stance);
  const seen = []; setPromptSpy(p => seen.push(p));
  const out = await exchangeRound({ judges: judgesOf(seats), request: 'A bake sale.', criteria: ['It states its assumptions.'], draft: DRAFT, round: 1, record: s => s, rounds: 3, layerOne: true });
  return { out, seen };
};

test('RU-S1-24 (record time): every post carries its poster\'s maker for model-API seats: two labs of one company show the same maker, a mock seat shows none', async () => {
  const { out } = await run([GLM, OTHER, HAIKU, OPUS, MOCK], 'support');
  const posts = out.rows.flatMap(r => r.posts);
  assert.ok(posts.length >= 10, `not vacuous: ${posts.length} posts`);
  for (const p of posts) {
    if (p.by === 'mockjudge') assert.equal('maker' in p, false, 'a mock seat has no maker (no lab fallback)');
    else assert.equal(p.maker, MAKERS[p.by], `${p.by}'s post names its company`);
  }
  assert.deepEqual([...new Set(posts.filter(p => p.by === 'haiku5.5' || p.by === 'opus5.5').map(p => p.maker))], ['anthropic'], 'two seats, one maker');
  assert.ok(posts.some(p => p.round >= 2), 'a later round was run: the later posts carry it too');
});

test('RU-S1-24 (privacy): no prompt of the exchange, post or answer, in any round, names a maker; the record has them, the judges never see them', async () => {
  const { out, seen } = await run([GLM, OTHER, HAIKU], 'contest');
  const exchange = seen.filter(p => /^(ldebate|lreply)-/.test(p.label));
  assert.ok(exchange.some(p => /^lreply-/.test(p.label)) && exchange.some(p => /-x2-/.test(p.label)), 'not vacuous: a later-round post prompt and an answer prompt were sent');
  assert.ok(out.rows.some(r => r.posts.some(p => p.maker)), 'the record has makers');
  for (const p of exchange) for (const company of ['z-ai', 'deepseek', 'anthropic']) assert.equal(`${p.system}\n${p.user}`.includes(company), false, `${p.label} does not name ${company}`);
});

// ---- the report side (src/answered-by.js layerDebatesWithMakers): session seats from the declared answerer, the raiser's maker and the three lists ----
const stageRow = (label, over = {}) => ({ label, provider: 'openrouter', model: 'z-ai/glm-5.3-flash', lab: label.split('-').at(-1), ...over });
const SESSION = (label, declared) => ({ label, provider: 'external', model: 'subscription:opus-5.5', asked_for: 'subscription:opus-5.5', lab: label.split('-').at(-1), ...(declared ? { answered_by: { model: declared, declared_by: 'caller' } } : {}) });
const post = (by, round, stance, over = {}) => ({ on: 'O-aaaaaaaa', stance, text: 'x', counted: true, by, round, ...over });
const row = () => ({ pass: 1, layer: 1, rounds: [], objections: [{ id: 'O-aaaaaaaa', raised_by: 'glm', raised_in: 'panel-1-glm', outcome: 'stands_contested', posts: [
  post('glm2', 1, 'support', { maker: 'z-ai' }), post('sess', 1, 'contest'), post('sess', 2, 'contest', { omitted: true, carried: true }), post('undeclared', 1, 'support'), post('mocky', 1, 'support'), post('glm2', 2, 'no_view'),
] }] });
const stages = [
  stageRow('panel-1-glm'), stageRow('ldebate-1-glm2', { model: 'z-ai/glm-5.3-flash' }), SESSION('ldebate-1-sess', 'claude-opus-5-5'), SESSION('ldebate-1-undeclared', null), { label: 'ldebate-1-mocky', provider: 'mock', model: 'mock-exch-support-keep-clean', lab: 'mocky' },
];

test('RU-S1-24 (report time): a session seat\'s post gets the company its answer DECLARED, never the model the chain asks for; an undeclared answer, a mock seat and a carried copy of an unknown post get none; a carried copy keeps the maker of the post it copies', () => {
  const [d] = layerDebatesWithMakers([row()], stages);
  const by = (who, round) => d.objections[0].posts.find(p => p.by === who && p.round === round);
  assert.equal(by('sess', 1).maker, 'anthropic', 'declared claude-opus-5-5');
  assert.equal(by('sess', 2).maker, 'anthropic', 'the carried copy keeps the maker of the post it copies');
  assert.equal('maker' in by('undeclared', 1), false, 'asked for opus, declared nothing: not the design model');
  assert.equal('maker' in by('mocky', 1), false);
  assert.equal(by('glm2', 1).maker, 'z-ai', 'the chain\'s own record is kept');
  assert.equal(makerOfStage(SESSION('x', 'qwen3-max')), 'qwen', 'a declared model of another company is that company, whatever the seat asked for');
  assert.equal(makerOfStage(SESSION('x', 'something-unknown')), null, 'a declared model the table has no row for is not guessed');
});

test('RU-S1-23 (report time): the raiser\'s maker on the row, and which makers raised, supported and contested it (counted posts of those stances only; unknown makers left out)', () => {
  const [d] = layerDebatesWithMakers([row()], stages);
  const o = d.objections[0];
  assert.equal(o.raiser_maker, 'z-ai', 'from the raiser\'s blind-review stage panel-1-glm');
  assert.deepEqual(o.makers, { raised: ['z-ai'], supported: ['z-ai'], contested: ['anthropic'] });
});

// M0 FIX-UP 2, item 3 (C&C's second review): the raiser's maker came from `panel-<carried_from ?? pass>-<seat>` and could name another stage's answerer for a session seat. The row now says which stage produced the objection (`raised_in`, written by the chain) and the report reads the answerer of THAT stage.
test('RU-S1-23 (report time, M0 FIX-UP 2): the raiser\'s maker is the company declared by the answerer of the stage `raised_in` names: a re-ask, not the first ask; an exchange post of an earlier pass, not the blind review the old rule guessed; a row without it names no maker', () => {
  const st = [SESSION('panel-2-la', 'claude-opus-5-5'), SESSION('panel-2-la-reask1', 'qwen3-max'), SESSION('panel-1-le', 'qwen3-max'), SESSION('panel-2-le', 'qwen3-max'), SESSION('ldebate-1-x3-le', 'claude-opus-5-5')];
  const obj = (id, raised_by, over) => ({ id, raised_by, outcome: 'stands_uncontested', posts: [], ...over });
  const [d] = layerDebatesWithMakers([{ pass: 2, layer: 1, rounds: [], objections: [
    obj('O-11111111', 'la', { raised_in: 'panel-2-la-reask1' }),                                   // raised in the re-ask (the first ask was answered by another company)
    obj('O-22222222', 'le', { carried_from: 1, raised_in: 'ldebate-1-x3-le' }),   // first named in pass 1's exchange (round 3), carried into pass 2
    obj('O-33333333', 'la', {}),                                                                    // an older row: no stage named
    obj('O-44444444', 'la', { raised_in: 'panel-9-nobody' }),                                       // a stage that is not in the run
  ] }], st);
  const [a, c, none, ghost] = d.objections;
  assert.deepEqual([a.raiser_maker, a.makers.raised], ['qwen', ['qwen']], 'the re-ask stage\'s answerer, not panel-2-la\'s (anthropic)');
  assert.deepEqual([c.raiser_maker, c.makers.raised], ['anthropic', ['anthropic']], 'the exchange post of pass 1, not panel-1-le (qwen) and not panel-2-le (qwen)');
  assert.equal('raiser_maker' in none || 'makers' in none, false, 'a row that names no stage names no maker');
  assert.equal('raiser_maker' in ghost || 'makers' in ghost, false, 'a stage that is not in the run names no maker');
});

test('RU-S1-23/24 (report time): a run with no known maker gets no maker keys at all (a mock run is unchanged); a row it cannot enrich is returned as it was', () => {
  const plain = { pass: 1, layer: 1, rounds: [], objections: [{ id: 'O-bbbbbbbb', raised_by: 'm', outcome: 'stands_uncontested', posts: [post('m2', 1, 'support')] }] };
  const [d] = layerDebatesWithMakers([plain], [{ label: 'panel-1-m', provider: 'mock', model: 'mock-critic-x', lab: 'm' }]);
  assert.deepEqual(d, plain);
  assert.equal(layerDebatesWithMakers(undefined, stages), undefined);
});

// ---- the schema: declared, with a pin and a known-bad input (schemas/report-v1.json is a public contract; additive) ----
const schema = JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'));
const objectionSchema = schema.properties.layer_debates.items.properties.objections.items;
test('RU-S1-23/24 (schema): posts, maker, raiser_maker and makers are declared, and a wrong type is rejected', () => {
  assert.deepEqual(Object.keys(objectionSchema.properties.makers.properties).sort(), ['contested', 'raised', 'supported']);
  assert.deepEqual(objectionSchema.properties.posts.items.properties.maker.type, ['string', 'null']);
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const ok = ajv.compile(objectionSchema);
  const good = layerDebatesWithMakers([row()], stages)[0].objections[0];
  assert.equal(ok(good), true, JSON.stringify(ok.errors));
  const bad = structuredClone(good); bad.posts[0].maker = 7;
  assert.equal(ok(bad), false, 'a numeric maker is rejected');
  const bad2 = structuredClone(good); bad2.makers.supported = 'anthropic';
  assert.equal(ok(bad2), false, 'a list that is a string is rejected');
});

// M0 FIX-UP 2, item 3: the new row field is declared (schemas/report-v1.json is a public contract; additive) and a wrong type is rejected.
test('raised_in (M0 FIX-UP 2, schema): the objection row declares the stage label as a string, and a number is rejected', () => {
  assert.equal(objectionSchema.properties.raised_in?.type, 'string');
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const ok = ajv.compile(objectionSchema);
  const good = layerDebatesWithMakers([row()], stages)[0].objections[0];
  assert.equal(good.raised_in, 'panel-1-glm', 'the fixture row carries it');
  assert.equal(ok(good), true, JSON.stringify(ok.errors));
  const bad = structuredClone(good); bad.raised_in = 7;
  assert.equal(ok(bad), false, 'a numeric stage label is rejected');
});
