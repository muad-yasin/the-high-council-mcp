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
// CHANGED ACCEPTED DATA (0.8.4 HS / N4, Muad 05 Nov 2026 22:15: "7 at layer 1 and 3 at layer 2, as the starting point; Sunday's data may change them"). OLD: bounds {1:2,2:1} (Medium), {1:1,2:1} (Mini and Mini-Sol). NEW: {1:7,2:3} in all three (and in every shipped layered planning chain). WHY: one starting point for every chain; maxOverseerRounds is untouched.
// CHANGED ACCEPTED DATA (0.8.4 seats unit, Muad 10 Nov 2026: "plan-medium-council seat picks (final)" 00:59, "plan-mini-council seat picks (final)" 00:42, plan-mini-council-sol-session retires 01:10). OLD: Medium and Mini with Haiku and Opus on the subscription, MiMo and GPT-6.1 Sol seats; the Sol-session copy. NEW: Medium = proposers Sonnet 5.5 (API), DeepSeek V4.1 Flash 1017, GLM 5.3; L1 Haiku 5.5 (API), GPT-6 Luna, MiniMax M3.1 Flash; L2 GLM 5.3, Mistral Large 4, DeepSeek V4.1 Flash 1017; L3 Opus 5.5 (API), GPT-6.1 Sol. Mini = proposers DeepSeek V4.1 Flash 1017, GLM 5.3 Flash, Mistral Large 4; L1 Haiku 5.5 (API), GPT-6 Luna, MiniMax M3.1 Flash; L2 DeepSeek V4.1 Flash 1017, GLM 5.3, Qwen 3.8 27B; L3 Sonnet 5.5 (API), GPT-6.1 Terra. No alternatives and no deep dive in either. The copy is gone. WHY: the owner's final picks, typed here from his headings, not read from the files.
const MEDIUM = {
  file: 'chains/plan-medium-council.json', rounds: 3, bounds: { 1: 7, 2: 3 }, companies: 6,
  labs: ['deepseek-v4.1-flash', 'glm5.3', 'gpt6-luna', 'gpt6.1-sol', 'haiku5.5', 'minimax-m3.1-flash', 'mistral-large4', 'opus5.5'],   // typed, not derived
  layers: {
    1: ['claude-haiku-5-5', 'openai/gpt-6-luna', 'minimax/minimax-m3.1-flash'],
    2: ['z-ai/glm-5.3', 'mistralai/mistral-large-4-0', 'deepseek/deepseek-v4.1-flash-1017'],
    3: ['claude-opus-5-5', 'openai/gpt-6.1-sol'],
  },
  proposers: ['deepseek-v4.1-flash', 'glm5.3', 'sonnet5.5'],
  overlap: ['deepseek-v4.1-flash', 'glm5.3'],
};
const MINI = {
  file: 'chains/plan-mini-council.json', rounds: 1, bounds: { 1: 7, 2: 3 }, companies: 6,
  labs: ['deepseek-v4.1-flash', 'glm5.3', 'gpt6-luna', 'gpt6.1-terra', 'haiku5.5', 'minimax-m3.1-flash', 'qwen3.8-27b', 'sonnet5.5'],   // typed, not derived
  layers: { 1: ['claude-haiku-5-5', 'openai/gpt-6-luna', 'minimax/minimax-m3.1-flash'], 2: ['deepseek/deepseek-v4.1-flash-1017', 'z-ai/glm-5.3', 'qwen/qwen3.8-27b'], 3: ['claude-sonnet-5-5', 'openai/gpt-6.1-terra'] },   // at least two judges in every layer (Muad 15 Okt 22:16)
  proposers: ['deepseek-v4.1-flash', 'glm5.3-flash', 'mistral-large4'],
  overlap: ['deepseek-v4.1-flash'],
};
const TIERS = [MEDIUM, MINI];
const chainOf = t => JSON.parse(read(t.file));
const companyOf = companyOfSeat;   // 0.8.3 harness (a): the one model-to-company table (src/answered-by.js), no second copy here
const names = { [MEDIUM.file]: 'plan-medium-council', [MINI.file]: 'plan-mini-council' };

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
    // MOVED BAR (commit 8, the ladder becomes the shipped shape): OLD the tier's maxOverseerRounds and layer bounds; NEW the ladder key, the same for every tier (the tier's own round numbers are gone with it)
    assert.deepEqual(chain.ladder, { block: 3, visits: 3 }); assert.equal('maxOverseerRounds' in chain, false); assert.equal('layerRevisions' in chain, false);
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
      const eff = s.extra?.reasoning?.effort ?? s.extra?.output_config?.effort;   // CHANGED (0.8.4 seats unit): a direct Anthropic seat states its effort in output_config
      // CHANGED ACCEPTED TEST (2 Nov 2026, owner: "High for THC's chains, default to High on all chains, users can change it if they want to"). OLD (23 Okt): a seat on a model whose own default is above high may state no effort (skipped here). NEW: every API seat states high in its file, the same bar for every model.
      assert.ok(ORDER.indexOf(eff) >= ORDER.indexOf('high'), `${key} reasons at ${eff}, below high`);
    }
  });

  test(`${name} T5: every paid seat's cap is the typed per-model figure (no seat at 360,000 or at the old 136,000 / 36,000 caps), typed per model here`, () => {
    // CHANGED ACCEPTED TEST (GLM unit sweep, 23 Okt 2026). OLD: the description had to include "Output caps are each model's published output limit" and the title said "published output limit". NEW: it must include "Output caps are the largest reply the harness knows for each model" (no lab page was traced for every model; the figures themselves are unchanged).
    // CHANGED ACCEPTED TEST (roster apply, 18 Okt 2026). OLD: caps per model in every tier: the two 360k models (GLM Flash, DeepSeek) and Mistral Large 4 at 136,000, Gemini at 36,000, and the description named "the two models that could write 360,000 tokens". NEW: each paid seat's maxTokens is its model's PUBLISHED output limit (typed below; MiniMax, Mistral and Muse, whose labs publish none, at Muad's 128,000). WHY: owner, via the caps session ("NO STEP CAPS AND NO BUDGETED RETRIES EITHER ...", "ASTRA ROSTERS ACCEPTED EXCEPT HIGH ...").
    // CHANGED ACCEPTED TEST (0.8.4 seats unit): OLD table without the Claude API seats, MiniMax M3.1 Flash, Qwen 3.8 27B and GPT-6.1 Terra; NEW: they are added (Claude 128,000 as on every Anthropic seat; Qwen 3.8 27B 128,000 is the owner's pick, the lab's figure is 131,072; MiniMax and Mistral publish none, so 128,000). WHY: the new picks.
    const LIMIT = { 'deepseek/deepseek-v4.1-flash-1017': 393216, 'xiaomi/mimo-v2.6-pro': 131072, 'z-ai/glm-5.3-flash': 131072, 'z-ai/glm-5.3': 131072, 'qwen/qwen3.8-max-0902': 131072, 'qwen/qwen3.8-27b': 128000, 'openai/gpt-6-luna': 128000, 'openai/gpt-6.1-sol': 128000, 'openai/gpt-6.1-terra': 128000, 'openai/gpt-6-astra': 128000, 'minimax/minimax-m3.1-flash': 128000, 'mistralai/mistral-large-4-0': 128000, 'claude-haiku-5-5': 128000, 'claude-sonnet-5-5': 128000, 'claude-opus-5-5': 128000 };
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
    // CHANGED ACCEPTED TEST (0.8.4 cap sentences, 11 Nov 2026). OLD: "...to keep the run from stopping at its limit unless a call outside the plan adds up; a lower limit, even the expected figure, can stop it there (exit 4, resumable with a higher total)." NEW: "...unless a call outside the plan adds up or the run needs more than the seven assumed top-layer reads; a lower limit, ..." (the rest of the sentence is unchanged). WHY: commit f60ebad2 (the apply of the reviewed 0.8.4 wording) put the seven-reads clause into both descriptions and left this pin behind; the pin was red for plan-medium-council and plan-mini-council on the tree of the regeneration commit 40a9d116 (a box run of that tree: 23 of 25 pass, these two fail); the sentence itself is not edited here.
    assert.ok(chain.description.includes("Type a limit above the upper estimate to keep the run from stopping at its limit unless a call outside the plan adds up or the run needs more than the seven assumed top-layer reads; a lower limit, even the expected figure, can stop it there (exit 4, resumable with a higher total)."), 'the typed-limit sentence (C&C Q6 a)');
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

// CHANGED ACCEPTED TEST (0.8.4 seats unit). OLD T10: the Medium description prints the API fallback seats of its two subscription judges. NEW T10: Haiku, Sonnet and Opus sit on the Anthropic API in both files, with the effort in output_config, and nothing prints a subscription fallback. WHY: Haiku, Sonnet and Opus are API seats now (Muad 10 Nov 2026 00:42 and 00:59).
test('plan-medium-council and plan-mini-council T10: the Claude judges and the Medium proposer are Anthropic API seats at high (output_config), and neither description tells a reader to replace a subscription seat', () => {
  const claude = c => [...c.seats.proposers, ...c.seats.critics].filter(s => /^claude-/.test(s.model));
  for (const [t, expected] of [[MEDIUM, ['claude-haiku-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5']], [MINI, ['claude-haiku-5-5', 'claude-sonnet-5-5']]]) {
    const chain = chainOf(t), seats = claude(chain);
    assert.deepEqual(seats.map(s => s.model).sort(), expected, t.file);
    for (const s of seats) { assert.equal(s.provider, 'anthropic', `${s.model}`); assert.equal(s.maxTokens, 128000); assert.deepEqual(s.extra, { output_config: { effort: 'high' } }, `${s.model}: high, no provider block`); }
    assert.doesNotMatch(chain.description, /Without a Claude subscription, replace each of those seats|subscription:haiku|subscription:opus/);
  }
});

test('plan-medium-council and plan-mini-council T11: judging is all-roles (the overlaps are exactly the declared ones), and the lint finds nothing', () => {
  for (const t of TIERS) {
    const c = chainOf(t);
    assert.equal(c.judging, 'all-roles', `${t.file}: judges that also propose`);
    const proposerLabs = new Set(c.seats.proposers.map(s => s.lab)), judgeLabs = new Set(c.seats.critics.map(s => s.lab));
    assert.deepEqual([...proposerLabs].filter(l => judgeLabs.has(l)).sort(), t.overlap, `${t.file}: the labs that propose and judge`);
    assert.deepEqual(lintChain(c, t.file).map(f => f.kind), []);
  }
});

test('plan-medium-council and plan-mini-council T12: no alternatives stage and no deep dive in either; the three typed proposers; the Mini description keeps its comparison sentence and does not call layer 3 provisional', () => {
  // CHANGED ACCEPTED TEST (0.8.4 seats unit, Muad 10 Nov 2026 00:59 and 00:42: "no alternatives and no deep dive, so all three tiers run the same stages"). OLD: the loop covered the Mini and its Sol-session copy only; Medium kept the alternatives stage. NEW: Medium is in the loop; the Sol-session copy is gone. WHY: the picks.
  for (const t of TIERS) {
    const c = chainOf(t);
    assert.equal('alternatives' in c, false, `${t.file}`); assert.equal('deep_dive' in c, false, `${t.file}`);
    assert.equal('alternatives' in c.seats, false); assert.equal('deep_dive' in c.seats, false);
    assert.deepEqual(c.seats.proposers.map(s => s.lab).sort(), [...t.proposers].sort());
  }
  // CHANGED ACCEPTED (0.8.4 HS / N4, Muad 05 Nov 2026 22:15). OLD sentence: 'Compared with plan-high-council, Mini asks fewer models, runs fewer rounds and allows fewer revisions.' NEW: 'Compared with plan-high-council, Mini asks fewer models and runs fewer rounds.' WHY: Mini now allows the same 7 and 3 revisions per overseer round as plan-high-council, so the revisions clause was untrue (a whole-sentence pin moved to the new whole sentence, not loosened).
  const mini = chainOf(MINI);
  // CHANGED ACCEPTED (0.8.4 ladder unit, owed list: 'rows that read the shipped chains\' old round fields'; 10 Nov 2026). OLD sentence: '... Mini asks fewer models and runs fewer rounds.' NEW: 'Compared with plan-high-council, Mini asks fewer models.': a ladder chain has no round limit of its own, so the clause was removed from the chain's description.
  assert.ok(mini.description.includes('Compared with plan-high-council, Mini asks fewer models.'));
  assert.doesNotMatch(mini.description, /layer 3 is provisional/i);
});

test('Mini T13: layer 1 is the shipped seats verbatim (typed data AND equal to plan-medium-council\'s identical seat objects)', () => {
  // CHANGED ACCEPTED TEST (0.8.4 seats unit). OLD: layer 1 = GLM 5.3 Flash and GPT-6 Luna, plus the Sol-session copy differing in exactly the Sol seat. NEW: layer 1 = Haiku 5.5 (API), GPT-6 Luna and MiniMax M3.1 Flash, the same three seat objects in Medium; the copy is gone. WHY: the picks (Muad 10 Nov 2026 00:42 and 00:59).
  const ignore = { provider: { ignore: ['open-inference'] } };
  const L1 = [
    { provider: 'anthropic', model: 'claude-haiku-5-5', maxTokens: 128000, lab: 'haiku5.5', extra: { output_config: { effort: 'high' } }, layer: 1 },
    { provider: 'openrouter', model: 'openai/gpt-6-luna', maxTokens: 128000, lab: 'gpt6-luna', extra: { reasoning: { effort: 'high' }, ...ignore }, layer: 1 },
    { provider: 'openrouter', model: 'minimax/minimax-m3.1-flash', maxTokens: 128000, lab: 'minimax-m3.1-flash', extra: { reasoning: { effort: 'high' }, ...ignore }, layer: 1 },
  ];
  const mini = chainOf(MINI), medium = chainOf(MEDIUM);
  const bare = s => { const { persona, ...rest } = s; return rest; };   // each seat also carries its persona name (title form), which differs between chains and is pinned by test/seat-title.test.js
  assert.deepEqual([...mini.seats.critics.filter(s => s.layer === 1)].map(bare).sort((a, b) => a.lab.localeCompare(b.lab)), [...L1].sort((a, b) => a.lab.localeCompare(b.lab)));
  for (const seat of L1) assert.deepEqual(bare(medium.seats.critics.find(s => s.lab === seat.lab)), seat, `${seat.lab}: identical to Medium's seat object`);
  const qwen = bare(mini.seats.critics.find(s => s.lab === 'qwen3.8-27b'));
  assert.deepEqual(qwen, { provider: 'openrouter', model: 'qwen/qwen3.8-27b', maxTokens: 128000, lab: 'qwen3.8-27b', extra: { reasoning: { effort: 'xhigh' }, ...ignore }, layer: 2 }, 'Qwen 3.8 27B: xhigh, 128,000 (Muad 09 Nov 2026 21:51)');
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
  assert.ok(layered.includes('plan-mini-council.json') && layered.includes('plan-medium-council.json') && layered.length >= 5, `the scan found the layered chains (${layered.join(', ')})`);
});

test('Mini T15: the Medium and Mini descriptions say a Claude seat uses an Anthropic key when there is one and goes through OpenRouter without it', () => {
  // CHANGED ACCEPTED TEST (0.8.4 seats unit). OLD: both carried the separate-fresh-session sentence about their subscription seats, and the Sol-session description said both layer-3 verdicts come through the person's own sessions. NEW: the Claude judges are API seats, so the descriptions say they need an Anthropic key; the Sol-session copy is gone. WHY: Haiku, Sonnet and Opus are API seats (Muad 10 Nov 2026 00:42 and 00:59).
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: '(provider anthropic) and need an Anthropic key' and 'so this default chain needs both keys'. NEW: the Claude seats 'are called through Anthropic's API (provider anthropic) with an Anthropic key, and go through OpenRouter without one'; the Mini says it whole (the sentence about its Claude seats), and 'needs both keys' is gone. WHY: the resolved descriptions of plan-medium-council and plan-mini-council (RESOLVED_LIST, chains/ as recorded).
  for (const t of TIERS) assert.match(chainOf(t).description, /\(provider anthropic\) with an Anthropic key, and go through OpenRouter without one; the other .* seats \(.* models\) are called through OpenRouter and need an OpenRouter key/, t.file);
  assert.ok(chainOf(MINI).description.includes("Claude Haiku 5.5 (layer 1) and Claude Sonnet 5.5 (layer 3) are called through Anthropic's API (provider anthropic) with an Anthropic key, and go through OpenRouter without one; the other nine seats (eight models) are called through OpenRouter and need an OpenRouter key."));
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
  // CHANGED A FOURTEENTH TIME (DUALCAP 4d, 1 Nov 2026): ONLY the upper estimate the description derives from the dry run moves ($264.32 -> $265.94; script-made: the dry run's maximum now prices a call over a price step at the step); the pin was '508d4d159f3e8cffe4f8'.
  // CHANGED A TWELFTH TIME (price refresh, 1 Nov 2026): ONLY the figures the description derives from the dry run move ($25.89 / $272.24 -> $25.57 / $263.89 and the cheapest end $17.29 -> $17.36; script-made); the pin was '01f96884a169a92754f9'.
  // CHANGED A THIRTEENTH TIME (price refresh, Luna and GPT-5.5 base-price fix-up, 1 Nov 2026): ONLY the upper estimate the description derives from the dry run moves ($263.89 -> $264.32; script-made); the pin was '042c8ac4ec20e3073a03'.
  // CHANGED A FIFTEENTH TIME (judge opening, 1 Nov 2026): ONLY the figures the description derives from the dry run move ($25.57 -> $25.58 expected, $265.94 -> $265.98 upper; script-made: every judge system prompt got longer by the Council introduction and shorter by the removed clause); the pin was '1e394cdba598bb6cc398'.
  // CHANGED A SIXTEENTH TIME (B3 judge apply, 1 Nov 2026): ONLY the description's date label moves in the applied file ("prices of 2026-10-18" -> "prices of 2026-11-01"); the pin was '500b7bd55642c8777588'; re-pinned from the failure output of the applied tree BEFORE the generated figures were regenerated: it moves AGAIN when scripts/regen-derived-figures.mjs rewrites the description's $25.58 / $265.98 to the dry run's $25.59 / $266.00.
  // CHANGED A SEVENTEENTH TIME (all seats high, 2 Nov 2026; owner: "High for THC's chains, default to High on all chains, users can change it if they want to"): TWO things move: the four GLM-5.3 and Qwen 3.8 Max seats gain `extra.reasoning.effort: "high"` (before: no extra, sent no effort setting), and the description's effort sentence loses its parenthesis ("Every API seat reasons at high;"); nothing else; recomputed from the real file; the pin was 'b293c8ba303135f19616'.
  // CHANGED AN EIGHTEENTH TIME (0.8.4, `layer_debate.enabled` removed; script-made): ONLY the figures the description derives from the dry run move ($25.59 / $266.00 -> $30.44 / $1880.71 and the cheapest end $17.36 -> $18.06): the dry run now prices the layer exchange of this chain's six layer-1 judges, seven rounds per pass in the upper estimate and one in the expected figure; recomputed from the real file; the pin was 'e16b6895b59c99d010c4'.
  // CHANGED A NINETEENTH TIME (Open Inference block, 4 Nov 2026; Muad's decision 8 of 28 Okt 2026): ONLY `extra.provider.ignore: ["open-inference"]` is added on every OpenRouter seat of the file (additions only in the diff); the pin was 'e6e286a0da54b40c0f1f'.
  // CHANGED A TWENTIETH TIME (E10, 4 Nov 2026; Muad chose a stall window of 3 over 2 for the shipped layered chains): ONLY `dispute.stall_rounds` 2 -> 3 moves in the file; the pin was '4e3922d4dddca40642a0'.
  // CHANGED A TWENTY-FIRST TIME (0.8.4 unit 4, 04 Nov 2026; his picks OWNER 5 and 6; script-made): ONLY the upper estimate the description derives from the dry run moves ($1880.71 -> $1960.11, twice): the upper estimate now adds a judge's re-asks and the automatic retries after a network error at their expected cost; the pin was '9cedf6db0d18e0029c15'.
  // CHANGED ACCEPTED (0.8.4 apply, the one regeneration of the derived figures, 11 Nov 2026; script-made: scripts/regen-derived-figures.mjs, run on the box on e1b83440's tree; the new value is the failure output of that run's patched tree): ONLY the figures the description derives from the dry run move (expected $23.08 -> $31.56, upper estimate $1065.03 -> $1882.67, cheapest end $14.33 -> $17.34); the pin was '4a188f7b746a81440360'.
  // CHANGED ACCEPTED (0.8.4 cap sentences, 11 Nov 2026; sha256 of the file by python hashlib, the method checked first on the committed file, which gives the old pin): ONLY the description's date label moves ("Dry run (0.8.3, prices of 2026-11-01, ..." -> "Dry run (0.8.4, prices of 2026-11-11, ..."; the date is the price table's _openrouterCheckedAt); the pin was 'aa6cbc829d1d93d88eef'.
  // CHANGED ACCEPTED (0.8.4 apply, the over-count; script-made: scripts/regen-derived-figures.mjs, run on the box on the tree with the cost fix; the new value is the failure output of that run's regenerated tree): OLD pin '889faa9a61466aba383b'. NEW '2f280a63197b4c79ed92'. WHY: ONLY the upper estimate the description derives from the dry run moves ($1882.67 -> $1749.87): the dry run no longer lists the go-up ruling rows (rule-bound-L2, rule-go-up-L3) that a ladder run cannot send.
  assert.equal(createHash('sha256').update(read('chains/plan-high-council.json')).digest('hex').slice(0, 20), '0716ae3d9bcd85bda640');   // CHANGED ACCEPTED (0.8.4 apply, ROUND2 entry 8-high; sha256 of chains/plan-high-council.json by python hashlib, the method checked first on the committed file which gives the old pin; job 230 row 25 is the red: actual 0716ae3d9bcd85bda640): ONLY the description's cap sentence moves (the old pin was '2f280a63197b4c79ed92'). // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): the pin was '2ebdf1e0eee68978fa1b'; ONLY the description moves (commit 1: the Anthropic-key sentence and the resolved description row, RL 'The High Council (0.8.4): the most thorough ...'); sha256 of chains/plan-high-council.json as it stands. It moves again at the regeneration of the figures. // CHANGED (0.8.4 ladder unit, second merge of integration 89f23370 with cache part (b)2, 10 Nov 2026; sha256sum of the file after the box generator ran on the merged tree, no project code run): the file carries BOTH sides: the ladder's description and ladder key and (b)2's `"prompt_cache": { "enabled": true, "ttl": "5m" }`, and ONLY the figures the description derives from the dry run move ($1067.14 -> $1065.03, the upper estimate) because the shipped chain now carries the cache switch; the pins were 'ee126e2b8c96de13b516' (the ladder's, before the merge) and 'c6f18052af35e2ebbd64' ((b)2's, before the merge). Earlier: CHANGED (0.8.4 ladder unit, default cap $12, 10 Nov 2026; sha256sum of the file): ONLY the figure of the default cap moves in the description's two cap sentences ($7 -> $12; "above the default cap of $12" and the Desktop Spend ceiling of $12); the pin was '066cf49e935ab9ed744e'.   // CHANGED (0.8.4 ladder unit, commit 8, 10 Nov 2026; sha256sum of the file after the box regen on tree 1a2db078): OLD f12f46c2eeb13d1924e2; the round fields became the ladder key, the description's round and figure sentences moved and the regen rewrote its dollar figures. WAS (0.8.4 seats unit, 10 Nov 2026; sha256sum of the file after the box generator ran, no project code run): the file is the flagship's twin roster (proposers Opus 5.5 API, DeepSeek V4.1 Flash 1017, GPT-6.1 Sol; 15 seats; no alternatives, no deep dive; title-form personas; judging all-roles; Qwen 3.8 27B at xhigh and 128,000); the pin was 'e0ea76f6cd883254bdc3'. Earlier: CHANGED (0.8.4 cache part a, 3b, 09 Nov 2026; sha256sum of the file after the box generator ran, no project code run): ONLY the figures the description derives from the dry run move (expected $30.44 -> $31.57, upper estimate $2361.55 -> $2367.57), because a call to an OpenRouter openai/ GPT 5.6-or-later seat is now priced as a cache write; the pin was 'a5d6764cd1f71b8b2119'. Earlier: CHANGED (0.8.4 D27, 09 Nov 2026; sha256sum of the file, no project code run): ONLY `draft_end_marker: { enabled: true }` is added after `name`; the pin was 'fe188b55c69515a97856'. EARLIER: (0.8.4 S16, 09 Nov 2026; script-made, from the box generator run on tree 4247d1a1): ONLY the upper estimate the description derives from the dry run moves ($2354.11 -> $2361.55): the final read is part of every layered run, so its rows are priced; the pin was '96efdea683e183fe2271'.
  // CHANGED (0.8.4 HS regen at NEW, 08 Nov 2026; script-made, from the box generator run): ONLY the figures the description derives from the dry run move (upper estimate $1960.11 -> $2354.11); the pin was '7349b7708b79cc8c2ee6'.
  // Earlier history of this pin:    // CHANGED A TWELFTH TIME (0.8.4 S7 A3b, C&C 05 Nov: the go-up is live): ONLY the description's limit sentence moves, "When either limit is reached the run stops" -> "When the overseer-round limit or layer 1's revision limit is reached the run stops" and one sentence is appended (layer 2's limit sends the plan up to layer 3); recomputed from the real file; the pin was 'a009dd3c6c97388650e0'.   // CHANGED AN ELEVENTH TIME (CR-4C-001, 25 Okt 2026; C&C GO, Muad: "not in 0.8.3, we can add it to 0.8.4"): ONLY the description's --continue clause moves, "continue (you type a new spending limit)" -> "continue (it extends the limit that was reached; the run's spending limit still applies)" (the words plan-medium-council already carries); recomputed from the real file; the pin was 'd2d302eb84d562c6d36f'.   // CHANGED A TENTH TIME (0.8.3 wording apply, 24 Okt 2026): d0's FINALs for the high description (ST-SC04, NX-024, LN-039, S2-113 appended at the end of the description); recomputed from the real file; the pin was 'c3238c887f86f80a113e'.   // CHANGED A SEVENTH TIME (the 1017 unit, 23 Okt 2026; Muad: "Make sure DeepSeek V4.1 Flash is updated to version 1017 on our chains as well"): ONLY the model id of the DeepSeek seats moves, deepseek/deepseek-v4.1-flash -> deepseek/deepseek-v4.1-flash-1017 (the 'lab' fields stay); the pin was '2fc1630dc9bc0cdfbfb5'. CHANGED ACCEPTED (label rename part 2, 20 Okt 2026; Muad 18 Okt: "upper estimate" replaces "at most" and "maximum"): OLD hash 57fe57df25ee373f54f0; NEW 2fc1630dc9bc0cdfbfb5. WHY: only the description's label ("at most" -> "upper estimate").
});
