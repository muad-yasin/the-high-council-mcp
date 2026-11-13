// 0.8.3 E5 (gate page Review/Build_0.8.3/m6-closing/E5_Gate_Page.md): the shipped layered chain plan-high-council. Offline, $0. Its figures in the description are derived here from the dry run
// (the dry-run-figures-docs rule: every public number must come from a dry run the tests can re-derive).
// CHANGED ACCEPTED TESTS (0.8.4 seats unit; his heading 'plan-high-council BECOMES THE FLAGSHIP'S TWIN' of 09 Nov 2026 22:56 CET and the seat picks of 09-10 Nov): OLD: six proposers, three alternatives seats, a deep-dive seat and
//   the 18 Okt 2026 twelve judges (GLM 5.3, MiMo, DeepSeek, MiniMax M3, Haiku, Luna / Opus, Sol, Qwen 3.8 Max, Mistral / Fable 5.1, Astra), the Claude seats on the subscription. NEW: the flagship's fifteen seats (three proposers, twelve
//   judges 5/5/2: Haiku, Luna, GLM 5.3 Flash, MiniMax M3.1 Flash, DeepSeek / Opus, Sol, Mistral, Kimi K3.1 Pro, Qwen 3.8 27B / Fable 5.2, Astra), the Claude seats on Anthropic's API, no alternatives and no deep dive, titles on every seat.
//   h1, h3, h4 and h7 follow the roster; h4b (the printed subscription fallback seats) is removed because the seats are API seats now.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dryRunReport } from '../src/dry-run.js';
import { layerProblems } from '../src/layers.js';
import { runChain } from '../src/chain.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');
const chain = JSON.parse(read('chains/plan-high-council.json'));
const pricing = JSON.parse(read('src/pricing.json'));
const reasoning = JSON.parse(read('src/reasoning-table.json')).models;
const critics = chain.seats.critics;

// CHANGED ACCEPTED DATA (0.8.4 seats unit; the twin of plan-the-high-council, his 09-10 Nov 2026 picks). The twelve judges and the three proposers of the flagship, in order.
const TWELVE_LABS = ['haiku5.5', 'gpt6-luna', 'glm5.3-flash', 'minimax-m3.1-flash', 'deepseek-v4.1-flash', 'opus5.5', 'gpt6.1-sol', 'mistral-large4', 'kimi-k3.1-pro', 'qwen3.8-27b', 'fable5.2', 'gpt6-astra'].sort();
const TWELVE = {
  1: ['claude-haiku-5-5', 'openai/gpt-6-luna', 'z-ai/glm-5.3-flash', 'minimax/minimax-m3.1-flash', 'deepseek/deepseek-v4.1-flash-1017'],
  2: ['claude-opus-5-5', 'openai/gpt-6.1-sol', 'mistralai/mistral-large-4-0', 'moonshotai/kimi-k3.1-pro', 'qwen/qwen3.8-27b'],
  3: ['claude-fable-5-2', 'openai/gpt-6-astra'],
};
const PROPOSER_MODELS = ['claude-opus-5-5', 'deepseek/deepseek-v4.1-flash-1017', 'openai/gpt-6.1-sol'];

test('E5 h1: the panel is exactly Muad\'s twelve judges, in his three layers, each on its own lab; the three proposers are the flagship\'s; no alternatives stage, no deep dive', () => {
  for (const layer of [1, 2, 3]) assert.deepEqual(critics.filter(s => s.layer === layer).map(s => s.model).sort(), [...TWELVE[layer]].sort(), `layer ${layer}`);
  assert.deepEqual(chain.seats.proposers.map(s => s.model), PROPOSER_MODELS);
  for (const k of ['alternatives', 'deep_dive']) { assert.equal(k in chain, false, k); assert.equal(k in chain.seats, false, `seats.${k}`); }
  assert.equal(critics.length, 12);
  assert.equal(new Set(critics.map(s => s.lab)).size, 12, 'twelve distinct labs');
  assert.deepEqual(layerProblems(chain, 'chains/plan-high-council.json'), []);
});

test('E5 h2: answer_back is ON (the E4 ledger, E84 and retained objections exist only where it is on), judging is all-roles, the writer is not on the panel and no selfReview key', () => {
  assert.equal(chain.answer_back?.enabled, true);
  assert.equal(chain.judging, 'all-roles');
  assert.equal('selfReview' in chain, false);
  assert.equal(critics.some(s => s.model === 'claude-code-session'), false);
  assert.equal(chain.signoff, 'unanimous');
});

// CHANGED ACCEPTED TEST (HIGH unit, 23 Okt 2026). OLD: the Haiku subscription seat carries the highest setting its row names (max). NEW: it carries high, like every seat the chain sets. WHY: Muad, 23 Okt 2026 20:44: "High should be *our* default setting. Some models are so cheap that *their* default is Max effort, and we can go with that".
test('E5 h3: every API judge has a price row and a reasoning row and reasons at high or above (never below); Haiku 5.5 carries high like every seat the chain sets (Qwen 3.8 27B states xhigh: the model offers no high)', () => {
  const ORDER = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
  for (const s of critics.filter(x => x.provider !== 'external')) {
    const key = `${s.provider}/${s.model}`;
    assert.ok(pricing[key], `price row for ${key}`);
    assert.ok(reasoning[key], `reasoning row for ${key}`);
    const eff = s.provider === 'anthropic' ? s.extra?.output_config?.effort : s.extra?.reasoning?.effort;
    // CHANGED ACCEPTED TEST (2 Nov 2026, owner: "High for THC's chains, default to High on all chains, users can change it if they want to"). OLD (23 Okt): a seat on a model whose own default is above high may state no effort (skipped here). NEW: every API seat states high in its file, the same bar for every model.
    assert.ok(ORDER.indexOf(eff) >= ORDER.indexOf('high'), `${key} reasons at ${eff}, below high`);
    if (eff) assert.ok(!reasoning[key].supportedEfforts || reasoning[key].supportedEfforts.includes(eff), `${key}: ${eff} is not a supported effort`);
  }
  assert.equal(critics.find(s => s.model === 'claude-haiku-5-5').extra.output_config.effort, 'high');
});

test('E5 h4: layer 2 holds Opus 5.5 on Anthropic\'s API (lab opus5.5); the chain carries overseer-round keys and NO maxRounds beside them (the numbers are the chain file\'s, never pinned here)', () => {
  const opus = critics.find(s => s.layer === 2 && s.model === 'claude-opus-5-5');
  assert.equal(opus.provider, 'anthropic');
  assert.equal(opus.lab, 'opus5.5');
  assert.equal('maxRounds' in chain, false);
  // MOVED BAR (commit 8, the ladder becomes the shipped shape): OLD maxOverseerRounds and layerRevisions as whole numbers; NEW the ladder key, and neither of the old round fields beside it
  assert.deepEqual(chain.ladder, { block: 3, visits: 3 });
  assert.equal('maxOverseerRounds' in chain, false); assert.equal('layerRevisions' in chain, false);
});

test('E5 h5: the description prints the dry run\'s expected and maximum figures, says the maximum is not a ceiling, and keeps out the ROADMAP reference', () => {
  const r = dryRunReport(chain, { defaultCapUsd: 7 });
  const exp = `$${r.estimate.expectedUsd.toFixed(2)}`; const max = `$${r.estimate.maximumUsd.toFixed(2)}`;
  assert.ok(chain.description.includes(`${exp} expected`) && chain.description.includes(`an upper estimate of ${max}`), `the description should print the dry run's "${exp} expected" and "an upper estimate of ${max}"`);
  // CHANGED ACCEPTED (label rename part 2, 20 Okt 2026; Muad 18 Okt: "upper estimate" replaces "at most" and "maximum"): OLD "$Y at most"; NEW "an upper estimate of $Y". WHY: only the printed label of the same figure.
  // CHANGED ACCEPTED TEST (roster apply, 18 Okt 2026): the comparison sentence "$X and $Y for plan-daily-7" is not in the approved High description any more; the pin on it is removed (the figures that remain, expected and at most, are still derived from the dry run above).
  assert.match(chain.description, /not a ceiling: the limit you type is what stops spending/);
  assert.equal(/ROADMAP/.test(chain.description), false);
  assert.equal(/every seat votes/i.test(`${chain.summary} ${chain.description}`), false, 'the 7 Oct "every seat votes" text must not be inherited');
});

test('E5 h6: plan-daily-7 keeps every key of the 0.8.2 file except its description, which carries the renamed label (the old single-layer chain stays so runs recorded on it still resume)', () => {
  // CHANGED ACCEPTED (label rename part 2, 20 Okt 2026; Muad 18 Okt: "upper estimate" replaces "at most" and "maximum"): OLD one pin, the whole file's sha256 38e15921ffb0c7609572 (byte-identical to 0.8.2). NEW two pins: the file WITHOUT its description keeps the 0.8.2 hash 3d13fb3b8ce40ca611a6 (computed from the 0.8.2 file at 0c57c97 and from this file: equal), and the description is pinned apart. WHY: only the description's label changed ("$33.25 at most" -> "with an upper estimate of $33.25"); the property the test names, an unchanged chain for old runs, is still checked on every other key.
  const j = JSON.parse(read('chains/outdated/plan-daily-7.json')); const description = j.description; delete j.description;
  assert.equal(createHash('sha256').update(JSON.stringify(j)).digest('hex').slice(0, 20), '3d13fb3b8ce40ca611a6');
  assert.equal(createHash('sha256').update(description).digest('hex').slice(0, 20), 'dbe89d5cf6aa2cfdbd0b');
});

// The voters on the real fold (C&C 15 Oct 2026: a lint reading or a description sentence does not prove who votes). Every seat of the chain becomes a mock seat with its own lab and layer kept; the critics sign off the revised draft
// (mock-critic-a), the signoff table is switched off for the mock only. The voters read from the panel's verdicts and the sign-off rows must be exactly the twelve labs: the proposers (three of whom also sit on the panel) and the
// writer do NOT vote as proposers under "judging": "all-roles" (the key only switches off two independence lints).
const mockFold = async (config) => {
  const M = (model, over = {}) => ({ provider: 'mock', model, ...over });
  const s = config.seats;
  const seats = {
    criteria: M('mock-criteria'), skeleton: M('mock-skeleton'), builder: M('mock-builder', { lab: 'author' }), reviser: M('mock-builder', { lab: 'author' }), handoff: M('mock-builder', { lab: 'author' }),
    proposers: s.proposers.map(x => M('mock-proposer-a', { lab: x.lab })),
    // CHANGED ACCEPTED TEST (0.8.4 seats unit, Muad 09 Nov 2026 22:56: the twin has no alternatives stage and no deep dive). OLD: every critic was `mock-critic-a`; the run reached sign-off through the alternatives and deep-dive stages the old twin had. NEW: every critic is a scripted judge that signs off every ask (one climb), its counter kept per model string by the lab (the helper plan-tiers T9 uses). WHY: with those stages cut the shared mock critic ended in a stall stop; the claim (the voters are exactly the twelve labs) is unchanged.
    critics: s.critics.map(x => M(`mock-critic-script-o-twin-${x.lab}`, { lab: x.lab, layer: x.layer })),
  };
  const mock = { ...config, seats }; delete mock.signoff_table;
  return runChain({ request: 'A mock task.', log: () => {}, runId: 'r-voters', config: mock });
};
const votersOf = r => ({ verdicts: [...new Set((r.panelVerdicts || []).map(v => v.lab))].sort(), signoff: [...new Set((r.signoff || []).map(v => v.lab))].sort() });

test('E5 h7: on a mock run of the chain the voters are exactly the twelve labs, and a thirteenth critic would show', async () => {
  const twelve = TWELVE_LABS; // typed, not derived from the chain: a chain with a thirteenth critic must fail this row
  const r = await mockFold(chain);
  assert.equal(r.passed, true, 'the mock run climbs all three layers');
  assert.deepEqual(votersOf(r), { verdicts: twelve, signoff: twelve });
  assert.deepEqual([...new Set(chain.seats.proposers.map(x => x.lab))].filter(l => !twelve.includes(l)), [], 'every proposer lab also sits on the panel (opus5.5, deepseek-v4.1-flash, gpt6.1-sol): the twelve voters are the panel, counted once');
  // the known-bad input: a thirteenth critic changes the voter set, so the row above would fail on it
  const bad = structuredClone(chain); bad.seats.critics.push({ provider: 'openrouter', model: 'google/gemini-3.8-flash', lab: 'gemini3.8-flash', maxTokens: 36000, layer: 1, extra: { reasoning: { effort: 'high' } } });
  const rb = await mockFold(bad);
  assert.notDeepEqual(votersOf(rb).verdicts, twelve); // the same check, run on the bad chain, sees the thirteenth voter
});
