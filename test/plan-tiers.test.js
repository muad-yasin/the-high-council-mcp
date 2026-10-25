// 0.8.3 tiers unit, commit 1 (gate note Tiers_Gate_Note.md, C&C PASS ON CONDITIONS 15 Okt 2026; Muad's tier answers 15 Okt 12:48 / 12:58): the shipped chains plan-medium-council (the balanced roster, 3 overseer rounds, bounds {1:5,2:3}) and
// plan-mini-council (a small layered roster, 2 overseer rounds, bounds {1:1,2:1}); plan-high-council is the file as it was (its own test, test/plan-high-council.test.js, is untouched). Offline, $0. Every price in a description is
// derived here from the dry run (the dry-run-figures-docs rule). No estimate key and no chain-level critiqueTokens is set in either file (C&C: Muad has not chosen the panel size). Mini unit commit 2 (Muad 15 Okt 23:09): the new Mini is seven judges from five companies, layers 3/2/2, judging all-roles, Sol (paid) + the Claude Code session's Opus at layer 3; plan-mini-council-sol-session answers Sol through the person's own ChatGPT plan (external).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dryRunReport } from '../src/dry-run.js';
import { layerProblems } from '../src/layers.js';
import { lintChain } from '../src/chain-lint.js';
import { runChain } from '../src/chain.js';
import { chainFigures } from '../src/tree-budget.js';
import { companyOfSeat } from '../src/answered-by.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');
const pricing = JSON.parse(read('src/pricing.json'));
const reasoning = JSON.parse(read('src/reasoning-table.json')).models;
// CHANGED ACCEPTED DATA (roster apply, 18 Okt 2026). OLD: the 0.8.3 tiers' first rosters (Medium: ten judges from eight companies, bounds {1:5,2:3}; Mini: seven judges, 2 rounds; Haiku, MiniMax, Qwen, Mistral paid judges). NEW: the seven files Muad accepted through the caps session
// (Astra's rosters; Haiku on the subscription in every tier): Medium six... see the typed data below, Mini one overseer round, bounds {1:1,2:1}. WHY: owner, via the caps session thcmcp-76 (FOCUS-detail "ASTRA ROSTERS ACCEPTED EXCEPT HIGH", "SEVEN ANSWERS ...": Haiku on the subscription in every tier, Chinese Medium revisions 2/1, both Mediums keep everyone debating the architectures).
const MEDIUM = {
  file: 'chains/plan-medium-council.json', rounds: 3, bounds: { 1: 2, 2: 1 }, companies: 5,
  labs: ['deepseek-v4.1-flash', 'glm5.3-flash', 'gpt6-luna', 'gpt6.1-sol', 'haiku5.5-sub', 'mimo-v2.6-pro', 'opus5.5-sub'],   // typed, not derived
  layers: {
    1: ['z-ai/glm-5.3-flash', 'xiaomi/mimo-v2.6-pro', 'openai/gpt-6-luna'],
    2: ['deepseek/deepseek-v4.1-flash-1017', 'subscription:haiku-5.5'],
    3: ['subscription:opus-5.5', 'openai/gpt-6.1-sol'],
  },
};
const MINI = {
  file: 'chains/plan-mini-council.json', rounds: 1, bounds: { 1: 1, 2: 1 }, companies: 4,
  labs: ['glm5.3-flash', 'gpt6-luna', 'gpt6.1-sol', 'haiku5.5-sub', 'mimo-v2.6-pro', 'opus5.5-sub'],   // typed, not derived
  layers: { 1: ['z-ai/glm-5.3-flash', 'openai/gpt-6-luna'], 2: ['xiaomi/mimo-v2.6-pro', 'subscription:haiku-5.5'], 3: ['openai/gpt-6.1-sol', 'subscription:opus-5.5'] },   // at least two judges in every layer (Muad 15 Okt 22:16)
  proposers: ['deepseek-v4.1-flash', 'glm5.3-flash', 'mimo-v2.6-pro'],
};
const MINI_SOL = {
  file: 'chains/plan-mini-council-sol-session.json', rounds: 2, bounds: { 1: 1, 2: 1 }, companies: 4,
  labs: ['glm5.3-flash', 'gpt6-luna', 'gpt6.1-sol-sub', 'haiku5.5-sub', 'mimo-v2.6-pro', 'opus5.5-sub'],
  layers: { 1: MINI.layers[1], 2: MINI.layers[2], 3: ['subscription:gpt-6.1-sol', 'subscription:opus-5.5'] },
  proposers: MINI.proposers,
};
const TIERS = [MEDIUM, MINI, MINI_SOL];
const chainOf = t => JSON.parse(read(t.file));
const companyOf = companyOfSeat;   // 0.8.3 harness (a): the one model-to-company table (src/answered-by.js), no second copy here
const names = { [MEDIUM.file]: 'plan-medium-council', [MINI.file]: 'plan-mini-council', [MINI_SOL.file]: 'plan-mini-council-sol-session' };

for (const t of TIERS) {
  const chain = chainOf(t), critics = chain.seats.critics, name = names[t.file];

  test(`${name} T1: the panel is exactly the typed judges in the typed layers, each on its own lab value, layers valid`, () => {
    for (const layer of [1, 2, 3]) assert.deepEqual(critics.filter(s => s.layer === layer).map(s => s.model).sort(), [...t.layers[layer]].sort(), `layer ${layer}`);
    assert.equal(critics.length, Object.values(t.layers).flat().length);
    assert.equal(new Set(critics.map(s => s.lab)).size, critics.length, 'every judge has its own lab value (vote identities)');
    assert.deepEqual(layerProblems(chain, t.file), []);
    assert.equal(chain.name, name);
  });

  test(`${name} T2: the round keys are the ruled numbers, no maxRounds beside them, and NO estimate key and no chain-level critiqueTokens beyond today's (Muad has not chosen the panel size)`, () => {
    assert.equal(chain.maxOverseerRounds, t.rounds);
    assert.deepEqual(chain.layerRevisions, { 1: t.bounds[1], 2: t.bounds[2] });
    assert.equal('maxRounds' in chain, false);
    assert.deepEqual(chain.estimate, { promptTokens: 28000, draftTokens: 10000, critiqueTokens: 5000 }, 'the estimate block is the one plan-high-council ships: no key set');
  });

  test(`${name} T3: answer_back on, unanimous sign-off, the writer is not on the panel, no selfReview`, () => {
    assert.equal(chain.answer_back?.enabled, true);
    assert.equal(chain.signoff, 'unanimous');
    assert.equal('selfReview' in chain, false);
    assert.equal(critics.some(s => s.model === 'claude-code-session'), false);
  });

  test(`${name} T4: every API judge has a price row and a reasoning row and reasons at high or above (never below)`, () => {
    const ORDER = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
    for (const s of [...critics, ...chain.seats.proposers, ...(chain.seats.alternatives || [])].filter(x => x.provider !== 'external')) {
      const key = `${s.provider}/${s.model}`;
      assert.ok(pricing[key], `price row for ${key}`);
      assert.ok(reasoning[key], `reasoning row for ${key}`);
      const eff = s.extra?.reasoning?.effort;
      if (reasoning[key].defaultAboveHigh && !eff) continue;
      assert.ok(ORDER.indexOf(eff) >= ORDER.indexOf('high'), `${key} reasons at ${eff}, below high`);
    }
  });

  test(`${name} T5: every paid seat's cap is the typed per-model figure (no seat at 360,000 or at the old 136,000 / 36,000 caps), typed per model here`, () => {
    // CHANGED ACCEPTED TEST (GLM unit sweep, 23 Okt 2026). OLD: the description had to include "Output caps are each model's published output limit" and the title said "published output limit". NEW: it must include "Output caps are the largest reply the harness knows for each model" (no lab page was traced for every model; the figures themselves are unchanged).
    // CHANGED ACCEPTED TEST (roster apply, 18 Okt 2026). OLD: caps per model in every tier: the two 360k models (GLM Flash, DeepSeek) and Mistral Large 4 at 136,000, Gemini at 36,000, and the description named "the two models that could write 360,000 tokens". NEW: each paid seat's maxTokens is its model's PUBLISHED output limit (typed below; MiniMax, Mistral and Muse, whose labs publish none, at Muad's 128,000). WHY: owner, via the caps session ("NO STEP CAPS AND NO BUDGETED RETRIES EITHER ...", "ASTRA ROSTERS ACCEPTED EXCEPT HIGH ...").
    const LIMIT = { 'deepseek/deepseek-v4.1-flash-1017': 393216, 'xiaomi/mimo-v2.6-pro': 131072, 'z-ai/glm-5.3-flash': 131072, 'z-ai/glm-5.3': 131072, 'qwen/qwen3.8-max-0902': 131072, 'openai/gpt-6-luna': 128000, 'openai/gpt-6.1-sol': 128000, 'openai/gpt-6-astra': 128000, 'google/gemini-3.8-flash': 65536, 'tencent/hy4-preview': 64000, 'stepfun/step-5-preview': 64000, 'minimax/minimax-m3': 128000, 'mistralai/mistral-large-4-0': 128000, 'meta/muse-spark-1.3': 128000 };
    const seats = [...critics, ...chain.seats.proposers, ...(chain.seats.alternatives || []), ...(chain.seats.deep_dive ? [chain.seats.deep_dive].flat() : [])].filter(x => x.provider !== 'external');
    for (const s of seats) assert.equal(s.maxTokens, LIMIT[s.model], `${s.model}: its typed cap`);
    assert.ok(chain.description.includes("Output caps are the largest reply the harness knows for each model"));
  });

  test(`${name} T6: the description prints the dry run's figures (derived, not typed), the price sentence says "plus a Claude subscription", and the maximum is called not a ceiling`, () => {
    const r = dryRunReport(chain, { defaultCapUsd: 7 });
    const exp = `$${r.estimate.expectedUsd.toFixed(2)}`, max = `$${r.estimate.maximumUsd.toFixed(2)}`;
    assert.ok(chain.description.includes(`${exp} expected`) && chain.description.includes(`an upper estimate of ${max}`), `the description should print "${exp} expected" and "an upper estimate of ${max}"`);
    // CHANGED ACCEPTED (label rename part 2, 20 Okt 2026; Muad 18 Okt: "upper estimate" replaces "at most" and "maximum"): OLD "$Y at most" and "the 'at most' figure"; NEW "an upper estimate of $Y" and "the upper estimate". WHY: only the printed label.
    assert.ok(chain.description.includes(`about ${exp} plus a Claude subscription`), 'the advertised price carries the subscription');
    assert.match(chain.description, /not a ceiling: the limit you type is what stops spending/);
    assert.ok(chain.description.includes("Type a limit above the upper estimate to keep the run from stopping at its limit unless a call outside the plan adds up; a lower limit, even the expected figure, can stop it there (exit 4, resumable with a higher total)."), 'the typed-limit sentence (C&C Q6 a)');
    assert.equal(/ROADMAP/.test(chain.description), false);
    assert.equal(/every seat votes/i.test(`${chain.summary} ${chain.description}`), false);
    assert.equal(/\b(better|best|more accurate|outperform)/i.test(`${chain.summary} ${chain.description}`), false, 'no efficacy claim');
  });

  test(`${name} T7: the description says how many judges and how many companies, and the company count is derived from the seats`, () => {
    const n = critics.length;
    const companies = new Set(critics.map(companyOf)).size;
    assert.equal(companies, t.companies);
    const word = { 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 10: 'ten' };
    assert.ok(chain.description.includes(`${word[n]} judges from ${word[companies]} companies`), `the description should say "${word[n]} judges from ${word[companies]} companies"`);
  });

  test(`${name} T8: FLOOR figure (cheapestUsd, the cheapest end a tree grant must cover: tree-budget admission is enforced on it) is finite and below the expected and at-most figures`, (tctx) => {
    const f = chainFigures(chain), r = dryRunReport(chain, { defaultCapUsd: 7 });
    assert.ok(Number.isFinite(f.cheapestUsd) && f.cheapestUsd > 0);
    assert.ok(f.cheapestUsd <= r.estimate.expectedUsd + 1e-9 && r.estimate.expectedUsd < f.atMostUsd);
    tctx.diagnostic(`${name}: cheapestUsd ${f.cheapestUsd.toFixed(2)} expected ${r.estimate.expectedUsd.toFixed(2)} atMostUsd ${f.atMostUsd.toFixed(2)}`);
  });

  test(`${name} T9: on a mock run the voters are exactly the typed judge labs (the proposers, architects, deep-dive seat and writer do not vote), and a stray critic would show`, async () => {
    const M = (model, over = {}) => ({ provider: 'mock', model, ...over });
    const s = chain.seats;
    const seats = {
      criteria: M('mock-criteria'), skeleton: M('mock-skeleton'), builder: M('mock-builder', { lab: 'author' }), reviser: M('mock-builder', { lab: 'author' }), handoff: M('mock-builder', { lab: 'author' }),
      proposers: s.proposers.map(x => M('mock-proposer-a', { lab: x.lab })),
      ...(s.alternatives ? { alternatives: s.alternatives.map(x => M('mock-alt-a', { lab: x.lab })) } : {}),
      ...(s.deep_dive ? { deep_dive: M('mock-deep', { lab: s.deep_dive.lab }) } : {}),
      critics: s.critics.map(x => M(`mock-critic-script-o-${name}-${x.lab}`, { lab: x.lab, layer: x.layer })),   // a scripted judge that signs off every ask (one climb); its counter is per model string, so each tier and lab gets its own
    };
    const mock = { ...chain, seats }; delete mock.signoff_table;
    const r = await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-voters', config: mock });
    const typed = [...t.labs];   // typed in this file, not read from the chain: a stray or missing critic must fail this row
    assert.equal(r.passed, true, 'the mock run climbs all layers');
    assert.deepEqual([...new Set((r.panelVerdicts || []).map(v => v.lab))].sort(), typed);
    assert.deepEqual([...new Set((r.signoff || []).map(v => v.lab))].sort(), typed);
  });
}

test('plan-medium-council T10: the description prints the API fallback seats of its two subscription judges verbatim (Haiku layer 2, Opus layer 3)', () => {
  // CHANGED ACCEPTED TEST (roster apply, 18 Okt 2026). OLD: the printed API Opus block was the seat plan-highest-7 ships, at layer 3. NEW: Haiku (layer 2) and Opus (layer 3) both print as typed API seats (maxTokens 128000, effort max). WHY: Haiku on the subscription in every tier; approved description text.
  const chain = chainOf(MEDIUM);
  // CHANGED ACCEPTED TEST (HIGH unit, 23 Okt 2026). OLD: the two printed API fallback seats carry effort max. NEW: effort high. WHY: Muad, 23 Okt 2026 20:44, "High should be *our* default setting" (typed seats, no wording).
  const api = (model, lab, layer) => ({ provider: 'openrouter', model, maxTokens: 128000, lab, extra: { reasoning: { effort: 'high' } }, layer });
  for (const seat of [api('anthropic/claude-haiku-5.5', 'haiku5.5', 2), api('anthropic/claude-opus-5.5', 'opus5.5', 3)]) assert.ok(chain.description.includes(JSON.stringify(seat)), `the description prints ${seat.model} at layer ${seat.layer}`);
});

test('plan-medium-council and the Mini files T11: judging is all-roles (the overlaps are exactly the declared ones), and the lint finds nothing', () => {
  assert.equal(chainOf(MEDIUM).judging, 'all-roles');
  for (const t of [MINI, MINI_SOL]) {
    const mini = chainOf(t);
    assert.equal(mini.judging, 'all-roles', `${t.file}: MiMo and GLM Flash both propose and judge`);
    const proposerLabs = new Set(mini.seats.proposers.map(s => s.lab)), judgeLabs = new Set(mini.seats.critics.map(s => s.lab));
    assert.deepEqual([...proposerLabs].filter(l => judgeLabs.has(l)).sort(), ['glm5.3-flash', 'mimo-v2.6-pro'], `${t.file}: the two labs that propose and judge (CHANGED with the roster apply: GLM 5.3 Flash proposes AND judges since 18 Okt 2026)`);
    assert.deepEqual(lintChain(mini, t.file).map(f => f.kind), []);
  }
  assert.deepEqual(lintChain(chainOf(MEDIUM), MEDIUM.file).map(f => f.kind), []);
});

test('plan-mini-council and plan-mini-council-sol-session T12: no alternatives stage and no deep dive; the three typed proposers; the description says it will not plan as well as plan-high-council and no longer calls layer 3 provisional (Sol is OK for now, Muad 15 Okt 21:51; Opus joined layer 3, 23:09)', () => {
  for (const t of [MINI, MINI_SOL]) {
    const mini = chainOf(t);
    assert.equal('alternatives' in mini, false); assert.equal('deep_dive' in mini, false);
    assert.equal('alternatives' in mini.seats, false); assert.equal('deep_dive' in mini.seats, false);
    assert.deepEqual(mini.seats.proposers.map(s => s.lab).sort(), [...t.proposers].sort());
    // CHANGED ACCEPTED (roster apply, 18 Okt 2026). OLD: the description said Mini "will not plan as well as plan-high-council" (the owner's 15 Okt wish). NEW: the regenerated approved text says "smaller and cheaper than plan-high-council" (summary) and "Compared with plan-high-council, Mini asks fewer models, runs fewer rounds and allows fewer revisions" (description); the quality sentence is no longer in either. WHY: this is one of the four new sentence types Muad approved (FOCUS-detail "DESCRIPTIONS + README ROWS APPROVED; HIGH'S ARCHITECTURE AUTHOR GLM 5.3 ...", 18 Okt 2026: "the Mini comparison that replaces 'will not plan as well'"); C&C ruled no restore.
    assert.ok(mini.description.includes('Compared with plan-high-council, Mini asks fewer models, runs fewer rounds and allows fewer revisions'));
    assert.doesNotMatch(mini.description, /layer 3 is provisional/i);
  }
});

test('Mini T13: layer 1 is the shipped seats verbatim (typed data AND equal to plan-medium-council\'s identical seat objects); the Sol-session copy differs from Mini in exactly the Sol seat; Sol in Mini is a paid API seat at its shipped cap, in the copy an external seat', () => {
  const L1 = [
    // CHANGED ACCEPTED TEST (HIGH unit, 23 Okt 2026). OLD: GLM Flash carried effort max and Luna effort max. NEW: GLM Flash carries no extra (its own default is max, so the harness sends no effort setting) and Luna carries high; Sol (paid and session copy) carries high. WHY: Muad, 23 Okt 2026 20:44, "High should be *our* default setting. Some models are so cheap that *their* default is Max effort, and we can go with that".
    { provider: 'openrouter', model: 'z-ai/glm-5.3-flash', maxTokens: 131072, lab: 'glm5.3-flash', layer: 1 },
    { provider: 'openrouter', model: 'openai/gpt-6-luna', maxTokens: 128000, lab: 'gpt6-luna', extra: { reasoning: { effort: 'high' } }, layer: 1 },
  ];
  const mini = chainOf(MINI), copy = chainOf(MINI_SOL), medium = chainOf(MEDIUM);
  assert.deepEqual(mini.seats.critics.filter(s => s.layer === 1), L1);
  for (const seat of L1) assert.deepEqual(medium.seats.critics.find(s => s.lab === seat.lab), seat, `${seat.lab}: identical to Medium's seat object`);
  const solPaid = mini.seats.critics.find(s => s.lab === 'gpt6.1-sol');
  assert.deepEqual(solPaid, { provider: 'openrouter', model: 'openai/gpt-6.1-sol', maxTokens: 128000, lab: 'gpt6.1-sol', extra: { reasoning: { effort: 'high' } }, layer: 3 });
  assert.deepEqual(copy.seats.critics.find(s => s.lab === 'gpt6.1-sol-sub'), { provider: 'external', model: 'subscription:gpt-6.1-sol', maxTokens: 128000, lab: 'gpt6.1-sol-sub', extra: { reasoning: { effort: 'high' } }, layer: 3 });   // CHANGED ACCEPTED (roster apply): an external seat now carries the same maxTokens/effort envelope as every seat
  // CHANGED ACCEPTED (roster apply, C&C ruling 18 Okt 2026): OLD 'everything but the name, summary, description and the Sol seat is the same'. NEW: maxOverseerRounds is the second deliberate difference, pinned (Mini 1, the Sol-session copy 2).
  // WHY: the approved Sol-session description says 'This chain allows 2 such overseer rounds' (DESCRIPTIONS + README ROWS APPROVED, 18 Okt 13:55) and m7/roster-apply/README.md:9 and :33 give it 2 rounds because its layer 3 is all subscription seats (its $1.41 / $4.45 row is in the same approved batch).
  assert.equal(mini.maxOverseerRounds, 1); assert.equal(copy.maxOverseerRounds, 2);
  const strip = c => ({ ...c, name: null, summary: null, description: null, maxOverseerRounds: null, seats: { ...c.seats, critics: c.seats.critics.filter(s => !/gpt6\.1-sol/.test(s.lab)) } });
  assert.deepEqual(strip(copy), strip(mini), 'everything but the name, summary, description, the round count and the Sol seat is the same');
});

test('Mini T14: at least two judges in every layer of every shipped layered chain (Muad 15 Okt 22:16: "1 judge in a Layer is not going to be a debate"); derived from the files', () => {
  const layered = [];
  for (const f of readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json'))) {
    const c = JSON.parse(read(`chains/${f}`));
    const by = {};
    for (const s of c.seats?.critics ?? []) if (s.layer !== undefined) by[s.layer] = (by[s.layer] ?? 0) + 1;
    if (!Object.keys(by).length) continue;
    layered.push(f);
    for (const [layer, n] of Object.entries(by)) assert.ok(n >= 2, `${f}: layer ${layer} has ${n} judge(s)`);
  }
  assert.ok(layered.includes('plan-mini-council.json') && layered.includes('plan-mini-council-sol-session.json') && layered.length >= 5, `the scan found the layered chains (${layered.join(', ')})`);
});

test('Mini T15: the Mini description carries the separate-fresh-session sentence (as Medium\'s does), the Sol-session description says BOTH layer-3 verdicts come through the person\'s own sessions and nothing in the harness checks they are independent, and Sol is the one paid-API difference', () => {
  const fresh = 'the answers should come from a separate fresh session, not the one that wrote the plan';   // CHANGED ACCEPTED (roster apply): OLD 'the answer should come ...' (singular); NEW the approved descriptions say 'the answers' (two seats are answered through the subscription now). WHY: the approved text (DESCRIPTIONS + README ROWS APPROVED, 18 Okt 13:55).
  assert.ok(chainOf(MEDIUM).description.includes(fresh));
  assert.ok(chainOf(MINI).description.includes(fresh));
  const d = chainOf(MINI_SOL).description;
  // CHANGED ACCEPTED TEST (roster apply, 18 Okt 2026): OLD sentences "both layer-3 verdicts come through your own sessions ..." / "shows $0 for both of them" / Mini's "GPT-6.1 Sol at layer 3 is a paid API seat". NEW: the approved Sol-session text says Sol is answered through the ChatGPT plan, the price shows $0 for every seat the person answers, nothing in the harness checks who answered, and the default chain is the one where Sol is a paid API seat.
  assert.match(d, /nothing in the harness checks who answered or that the answers are independent of each other or of the session that wrote the plan/);
  assert.match(d, /layer 3 pauses twice in every round/);
  assert.match(d, /The price shows \$0 for every seat you answer yourself/);
  assert.ok(d.includes('the default chain is plan-mini-council, where Sol is a paid API seat'));
});

test('plan-high-council keeps its roster (the tiers unit left its file alone; the Mini unit commit 1 changed ONLY proposals.maxTokens 12,000 -> 120,000, the figures in its description and the above-the-default-cap and cut-off-retry sentences): hash pin of the file as of that commit; its own test pins the roster', () => {
  // CHANGED ACCEPTED TEST (Mini unit commit 1, C&C 16 Okt 2026): the pin was '2ed6b9557db5b0e93b61' (the file at c518ff6).
  // CHANGED AGAIN (notes lane 2b-2, 16 Okt 2026): the file gains ONE key, `reviewNotes: { enabled: true, perKind: 3 }` (inert until the four lane sentences are recorded); the pin was 'b7e79efc3ce14c30b56b' (the file at e9b541e).
  // CHANGED A THIRD TIME (notes lane ON, A2, 18 Okt 2026): the description gains the E194 memory clause inside the 'leaves out' list and one closing sentence about the quoted review notes (nothing else in the file moves); the pin was '2682ed128724fb82e713'.
  // CHANGED A FOURTH TIME (E4b unit 2, 18 Okt 2026): the file gains ONE key, `seats.decider` (the external Claude Code session, Muad's roster default from the record; inert until the decider's prompt is recorded: the stage then records `prompt_held` and calls nothing); the pin was 'dfba120252f385709cf5'.
  // CHANGED A FIFTH TIME (roster apply, 18 Okt 2026): the file is the accepted High roster (GLM 5.3 in layer 1 and as an architecture author, Haiku and Fable on the subscription, the lab output limits, effort = each model's highest, proposals.maxTokens 393216, the regenerated description and summary); the pin was 'ca59f4007117a1d8cfd9'. The roster itself is pinned by test/plan-high-council.test.js.
  // CHANGED A SIXTH TIME (estimator system-text unit, 19 Okt 2026): ONLY the generated figures in the description move (the dry run's rows now carry each call's longest system text: plan-high-council $25.73 / $271.80 -> $25.89 / $272.24); the pin was '327f3f8d90c89a8dde2e'.
  // CHANGED A NINTH TIME (HIGH unit, 23 Okt 2026; Muad: "High should be *our* default setting. Some models are so cheap that *their* default is Max effort, and we can go with that"): the file's explicit max/xhigh efforts become high (the four GLM-5.3 and Qwen 3.8 Max seats state none), the three printed API fallback seats say high, and the description's effort sentence is replaced; the pin was '4833e18e5770b038cd07'.
  // CHANGED AN EIGHTH TIME (GLM unit sweep, 23 Okt 2026; C&C thcmcp-cd + Muad's 21:14 "yes to all", item 1): ONLY the description's two "published limit" sentences move (the retry sentence and the output-caps prefix); the pin was '2b95fc90cbeb76b3cc00'.
  assert.equal(createHash('sha256').update(read('chains/plan-high-council.json')).digest('hex').slice(0, 20), '01f96884a169a92754f9');   // CHANGED AN ELEVENTH TIME (CR-4C-001, 25 Okt 2026; C&C GO, Muad: "not in 0.8.3, we can add it to 0.8.4"): ONLY the description's --continue clause moves, "continue (you type a new spending limit)" -> "continue (it extends the limit that was reached; the run's spending limit still applies)" (the words plan-medium-council already carries); recomputed from the real file; the pin was 'd2d302eb84d562c6d36f'.   // CHANGED A TENTH TIME (0.8.3 wording apply, 24 Okt 2026): d0's FINALs for the high description (ST-SC04, NX-024, LN-039, S2-113 appended at the end of the description); recomputed from the real file; the pin was 'c3238c887f86f80a113e'.   // CHANGED A SEVENTH TIME (the 1017 unit, 23 Okt 2026; Muad: "Make sure DeepSeek V4.1 Flash is updated to version 1017 on our chains as well"): ONLY the model id of the DeepSeek seats moves, deepseek/deepseek-v4.1-flash -> deepseek/deepseek-v4.1-flash-1017 (the 'lab' fields stay); the pin was '2fc1630dc9bc0cdfbfb5'. CHANGED ACCEPTED (label rename part 2, 20 Okt 2026; Muad 18 Okt: "upper estimate" replaces "at most" and "maximum"): OLD hash 57fe57df25ee373f54f0; NEW 2fc1630dc9bc0cdfbfb5. WHY: only the description's label ("at most" -> "upper estimate").
});
