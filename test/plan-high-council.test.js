// 0.8.3 E5 (gate page Review/Build_0.8.3/m6-closing/E5_Gate_Page.md): the shipped layered chain plan-high-council. Offline, $0. Its figures in the description are derived here from the dry run
// (the dry-run-figures-docs rule: every public number must come from a dry run the tests can re-derive).
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

// CHANGED ACCEPTED DATA (roster apply, 18 Okt 2026). OLD: GLM 5.3 Flash in layer 1, Haiku and Fable as paid API seats (labs haiku5.5, fable5.1). NEW: GLM 5.3 (not Flash) replaces GLM 5.3 Flash; Haiku (layer 1) and Fable (layer 3) are seats on the Claude subscription (labs haiku5.5-sub, fable5.1-sub); still exactly twelve judges in the same three layers.
// WHY: owner, via the caps session thcmcp-76 (FOCUS-detail "HIGH = HIS 12 JUDGES, PREMIUM MODELS: GLM 5.3 (NOT FLASH) ...", "HIGH KEEPS TODAY'S SHAPE ... FABLE AND HAIKU ON THE SUBSCRIPTION").
const TWELVE_LABS = ['glm5.3', 'mimo-v2.6-pro', 'deepseek-v4.1-flash', 'minimax-m3', 'haiku5.5-sub', 'gpt6-luna', 'opus5.5-sub', 'gpt6.1-sol', 'qwen3.8-max', 'mistral-large4', 'fable5.1-sub', 'gpt6-astra'].sort();
const TWELVE = {
  1: ['z-ai/glm-5.3', 'xiaomi/mimo-v2.6-pro', 'deepseek/deepseek-v4.1-flash-1017', 'minimax/minimax-m3', 'subscription:haiku-5.5', 'openai/gpt-6-luna'],
  2: ['subscription:opus-5.5', 'openai/gpt-6.1-sol', 'qwen/qwen3.8-max-0902', 'mistralai/mistral-large-4-0'],
  3: ['subscription:fable-5.1', 'openai/gpt-6-astra'],
};

test('E5 h1: the panel is exactly Muad\'s twelve judges, in his three layers, each on its own lab', () => {
  for (const layer of [1, 2, 3]) assert.deepEqual(critics.filter(s => s.layer === layer).map(s => s.model).sort(), [...TWELVE[layer]].sort(), `layer ${layer}`);
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
test('E5 h3: every API judge has a price row and a reasoning row and reasons at high or above (never below); Haiku 5.5 (a subscription seat) carries high like every seat the chain sets', () => {
  const ORDER = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
  for (const s of critics.filter(x => x.provider !== 'external')) {
    const key = `${s.provider}/${s.model}`;
    assert.ok(pricing[key], `price row for ${key}`);
    assert.ok(reasoning[key], `reasoning row for ${key}`);
    const eff = s.extra?.reasoning?.effort;
    if (reasoning[key].defaultAboveHigh && !eff) continue; // runs at its own higher default (GLM Flash, Qwen), which the harness never lowers
    assert.ok(ORDER.indexOf(eff) >= ORDER.indexOf('high'), `${key} reasons at ${eff}, below high`);
    if (eff) assert.ok(!reasoning[key].supportedEfforts || reasoning[key].supportedEfforts.includes(eff), `${key}: ${eff} is not a supported effort`);
  }
  assert.equal(critics.find(s => s.model === 'subscription:haiku-5.5').extra.reasoning.effort, 'high');
});

// CHANGED ACCEPTED TEST (roster apply, 18 Okt 2026). OLD: the description printed the API Opus block exactly as plan-highest-7 ships it, plus layer 2. NEW: Haiku (layer 1), Opus (layer 2) and Fable (layer 3) are subscription seats and the description prints the three API fallback seats a person without a subscription pastes in (maxTokens 128000, effort max, the labs haiku5.5 / opus5.5 / fable5.1); each printed seat is typed here and must have a price row and a reasoning row.
// WHY: owner, via the caps session ("Fable and Haiku on subscription", "EFFORT = EACH MODEL'S HIGHEST"); approved description text.
// CHANGED ACCEPTED TEST (HIGH unit, 23 Okt 2026). OLD: the printed fallback seats carry effort max. NEW: effort high (the three printed blocks are typed seats; no wording). WHY: Muad, 23 Okt 2026 20:44, "High should be *our* default setting".
test('E5 h4b: the description prints the API fallback seats of the three subscription judges verbatim (Haiku layer 1, Opus layer 2, Fable layer 3), and each has a price row and a reasoning row', () => {
  const api = (model, lab, layer) => ({ provider: 'openrouter', model, maxTokens: 128000, lab, extra: { reasoning: { effort: 'high' } }, layer });
  for (const seat of [api('anthropic/claude-haiku-5.5', 'haiku5.5', 1), api('anthropic/claude-opus-5.5', 'opus5.5', 2), api('anthropic/claude-fable-5.1', 'fable5.1', 3)]) {
    assert.ok(chain.description.includes(JSON.stringify(seat)), `the description prints ${seat.model} at layer ${seat.layer}`);
    assert.ok(pricing[`openrouter/${seat.model}`] && reasoning[`openrouter/${seat.model}`], `${seat.model}: price row and reasoning row`);
  }
});

test('E5 h4: layer 2 holds the Claude Code session\'s Opus (external, lab opus5.5-sub); the chain carries overseer-round keys and NO maxRounds beside them (the numbers are the chain file\'s, never pinned here)', () => {
  const opus = critics.find(s => s.layer === 2 && s.model === 'subscription:opus-5.5');
  assert.equal(opus.provider, 'external');
  assert.equal(opus.lab, 'opus5.5-sub');
  assert.equal('maxRounds' in chain, false);
  assert.ok(Number.isInteger(chain.maxOverseerRounds) && chain.maxOverseerRounds >= 1);
  assert.ok(Number.isInteger(chain.layerRevisions[1]) && Number.isInteger(chain.layerRevisions[2]));
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
// (mock-critic-a), the signoff table is switched off for the mock only. The voters read from the panel's verdicts and the sign-off rows must be exactly the twelve labs: the proposers, architects, deep-dive seat and writer do NOT vote
// under "judging": "all-roles" (the key only switches off two independence lints).
const mockFold = async (config) => {
  const M = (model, over = {}) => ({ provider: 'mock', model, ...over });
  const s = config.seats;
  const seats = {
    criteria: M('mock-criteria'), skeleton: M('mock-skeleton'), builder: M('mock-builder', { lab: 'author' }), reviser: M('mock-builder', { lab: 'author' }), handoff: M('mock-builder', { lab: 'author' }),
    proposers: s.proposers.map(x => M('mock-proposer-a', { lab: x.lab })), alternatives: s.alternatives.map(x => M('mock-alt-a', { lab: x.lab })), deep_dive: M('mock-deep', { lab: s.deep_dive.lab }),
    critics: s.critics.map(x => M('mock-critic-a', { lab: x.lab, layer: x.layer })),
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
  const outsiders = [...new Set([...chain.seats.proposers, ...chain.seats.alternatives, chain.seats.deep_dive].map(x => x.lab))].filter(l => !twelve.includes(l));
  assert.ok(outsiders.length >= 3, `the chain has proposers/architects off the panel: ${outsiders.join(', ')}`);
  for (const l of outsiders) assert.equal(votersOf(r).verdicts.includes(l), false, `${l} does not vote`);
  // the known-bad input: a thirteenth critic changes the voter set, so the row above would fail on it
  const bad = structuredClone(chain); bad.seats.critics.push({ provider: 'openrouter', model: 'google/gemini-3.8-flash', lab: 'gemini3.8-flash', maxTokens: 36000, layer: 1, extra: { reasoning: { effort: 'high' } } });
  const rb = await mockFold(bad);
  assert.notDeepEqual(votersOf(rb).verdicts, twelve); // the same check, run on the bad chain, sees the thirteenth voter
});
