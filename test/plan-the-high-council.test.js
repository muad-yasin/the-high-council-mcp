// The shipped chain plan-the-high-council (0.8.4): 15 seats on two bills, offline and $0. Its roster, a persona on every seat with the persona setting on in the form title, the Open Inference ignore on
// every OpenRouter seat, reasoning at high wherever the table has a field for it, the output caps, a stall called after 3 verdicts of the same judge in a row, the settings copied from plan-high-council while the review
// mechanics wait for the second judge-system debate, and what the chain does NOT carry (no alternatives stage, deep dive, judging override or second cap; no early-finish claim in its description).
// Each check is a function of a chain object, so the last test can plant a bad copy and show the check catches it (the pattern of test/advice-chains-denied.test.js).
//
// CHANGED ACCEPTED TEST (0.8.4, lane C; the owner's 30 Okt 2026 roster and his 4 Nov 2026 heading "a title for every seat"):
//   OLD: the chain had no persona field, and PHC-5/PHC-6 asserted its absence; the four models whose own default is above high were sent no effort (ABOVE_HIGH); `dispute` equalled plan-high-council's
//        (stall_rounds 2); MiniMax M3.1 Flash and Kimi K3.1 Pro were "above high".
//   NEW: every seat carries its roster name and `seat_personas` is { enabled: true, form: "title" } (PERSONAS below); an effort is stated as high wherever the reasoning table has a field for the model
//        (Kimi, GLM and MiniMax now state it, by the owner's 2 Nov 2026 rule "High for THC's chains") and none where it has no field (Qwen 3.8 27B); `dispute.stall_rounds` is 3 (E10: the layered chains
//        call a stall after 3 verdicts of the same judge in a row); the description does not say the reviser may propose to finish early (N14).
//   WHY: X4 of the overlap map named three defects of this chain (no persona field, an early-finish sentence against N14, stall_rounds 2 against E10); the effort rule is the base's own (DC-6 of test/chain-description-claims.test.js).
// CHANGED ACCEPTED TEST (0.8.4 seats unit; his picks of 09-10 Nov 2026, headings 'plan-the-high-council (THE FLAGSHIP) SEAT PICKS', 'plan-the-high-council (AND ITS TWIN plan-high-council) PROPOSERS CHANGE' and 'plan-high-council BECOMES THE FLAGSHIP\'S TWIN'):
//   OLD: proposers Sonnet 5.5, Kimi K3.1 Pro, Gemini 4 Argon; layer 2 Opus 5.5, GPT-6.1 Terra, MiMo V2.6 Pro, Hy4 Preview, Qwen 3.8 27B; layer 3 Fable 5.1, GPT-6.1 Sol; 15 seats on 15 labs; one persona name per model;
//        Qwen 3.8 27B stated no effort; the chain carried no judging override ('judging' was a forbidden key).
//   NEW: proposers Opus 5.5, DeepSeek V4.1 Flash 1017, GPT-6.1 Sol; layer 2 Opus 5.5, GPT-6.1 Sol, Mistral Large 4, Kimi K3.1 Pro, Qwen 3.8 27B; layer 3 Fable 5.2, GPT-6 Astra; 15 seats on 12 labs (Opus, Sol and DeepSeek each sit on a
//        proposer seat and a judge seat); the names are asserted BY SEAT (proposers Noah, Husayn, Abraham by position; layer 3 Melchizedek and Karpathy; layers 1-2 follow the model), not by model; both DeepSeek seats also ignore
//        Morph; Qwen 3.8 27B states xhigh (the model offers no high) at 128,000; "judging": "all-roles" is required (his "yes, (a)": the chain is tiered by majority_guard, and a model that proposes also judges).
//   WHY: the owner's picks above; PHC-1/3/4/5/6/7 follow them. The persona map could not stay keyed by model once one model carries two names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layerProblems } from '../src/layers.js';
import { lintChain } from '../src/chain-lint.js';
import { rowOf } from '../src/reasoning.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => JSON.parse(readFileSync(join(root, f), 'utf8'));
const chain = read('chains/plan-the-high-council.json');
const high = read('chains/plan-high-council.json');
const pricing = read('src/pricing.json');

// His roster (09-10 Nov 2026): layer 3 Fable 5.2, GPT-6 Astra; layer 2 Opus 5.5, GPT-6.1 Sol, Mistral Large 4, Kimi K3.1 Pro, Qwen 3.8 27B; layer 1 Haiku 5.5, GPT-6 Luna, GLM 5.3 Flash, MiniMax M3.1 Flash, DeepSeek V4.1 Flash 1017;
// proposers Opus 5.5, DeepSeek V4.1 Flash 1017, GPT-6.1 Sol. The four Claude seats are provider "anthropic", the other eleven are OpenRouter.
const ROSTER = {
  1: ['anthropic/claude-haiku-5-5', 'openrouter/openai/gpt-6-luna', 'openrouter/z-ai/glm-5.3-flash', 'openrouter/minimax/minimax-m3.1-flash', 'openrouter/deepseek/deepseek-v4.1-flash-1017'],
  2: ['anthropic/claude-opus-5-5', 'openrouter/openai/gpt-6.1-sol', 'openrouter/mistralai/mistral-large-4-0', 'openrouter/moonshotai/kimi-k3.1-pro', 'openrouter/qwen/qwen3.8-27b'],
  3: ['anthropic/claude-fable-5-2', 'openrouter/openai/gpt-6-astra'],
};
const PROPOSERS = ['anthropic/claude-opus-5-5', 'openrouter/deepseek/deepseek-v4.1-flash-1017', 'openrouter/openai/gpt-6.1-sol'];
const key = s => `${s.provider}/${s.model}`;
const paid = c => [...(c.seats.proposers || []), ...(c.seats.critics || [])].filter(s => s.provider !== 'external');
// His names (30 Okt 2026, then 09-10 Nov 2026: "the names are for the seats, and preferably stay with the models in-between chains"; proposers always Noah, Husayn, Abraham by position; layer 3 always Melchizedek and Karpathy by
// position; layers 1-2 follow the model). "Van Gogh" is spelled as the shipped persona set spells it and "da Vinci" as the usual form: an A-DRAFT choice. Asserted BY SEAT: one model now carries two names (Opus, Sol, DeepSeek).
const PROPOSER_NAMES = ['Noah', 'Husayn', 'Abraham'];
const CRITIC_NAMES = { 1: ['Matthew', 'Merkel', 'Herbert', 'Van Gogh', 'Aristotle'], 2: ['Moses', 'Einstein', 'da Vinci', 'Archimedes', 'Plato'], 3: ['Melchizedek', 'Karpathy'] };
const nameOf = (c, s) => { const p = c.seats.proposers.indexOf(s); if (p >= 0) return PROPOSER_NAMES[p]; const same = c.seats.critics.filter(x => x.layer === s.layer); return CRITIC_NAMES[s.layer]?.[same.indexOf(s)]; };
const seatTag = (c, s) => { const p = c.seats.proposers.indexOf(s); return p >= 0 ? `${key(s)} (proposer ${p + 1})` : `${key(s)} (layer ${s.layer})`; };
const NO_LIMIT = new Set(['openrouter/moonshotai/kimi-k3.1-pro', 'openrouter/minimax/minimax-m3.1-flash', 'openrouter/mistralai/mistral-large-4-0']);                       // no published output limit: seat cap 128,000

const rosterProblems = c => {
  const bad = [];
  for (const layer of [1, 2, 3]) {
    const got = c.seats.critics.filter(s => s.layer === layer).map(key);
    if (JSON.stringify(got) !== JSON.stringify(ROSTER[layer])) bad.push(`layer ${layer}: ${got.join(', ')}`);
  }
  if (JSON.stringify(c.seats.proposers.map(key)) !== JSON.stringify(PROPOSERS)) bad.push(`proposers: ${c.seats.proposers.map(key).join(', ')}`);
  if (new Set(paid(c).map(s => s.lab)).size !== 12) bad.push('the 15 seats are not on 12 distinct labs (Opus, Sol and DeepSeek each sit on a proposer seat and a judge seat)');
  if (paid(c).some(s => !s.lab)) bad.push('a seat has no lab');
  return bad;
};
const ignoreProblems = c => paid(c).flatMap(s => {
  const ig = s.extra?.provider?.ignore;
  const want = key(s) === 'openrouter/deepseek/deepseek-v4.1-flash-1017' ? ['open-inference', 'morph'] : ['open-inference'];   // his "yeah we can build that" (09 Nov 2026 22:23 CET): Morph is skipped on the DeepSeek seats
  if (s.provider === 'openrouter') return JSON.stringify(ig) === JSON.stringify(want) ? [] : [`${key(s)}: provider.ignore is ${JSON.stringify(ig)}, not ${JSON.stringify(want)}`];
  return s.extra?.provider === undefined ? [] : [`${key(s)}: an Anthropic seat carries a provider object`];
});
const reasoningProblems = c => paid(c).flatMap(s => {
  const k = key(s), row = rowOf(s), bad = [];
  if (!pricing[k]) bad.push(`${k}: no price row`);
  if (!row) return [...bad, `${k}: no reasoning row`];
  const eff = s.provider === 'anthropic' ? s.extra?.output_config?.effort : s.extra?.reasoning?.effort;
  if (row.form === null) { if (eff !== 'xhigh' || s.extra?.output_config !== undefined) bad.push(`${k}: the table has no high setting for it, so the seat must state xhigh (found ${eff ?? 'none'})`); }   // Qwen 3.8 27B: the model offers no high; stated explicitly, not left to the default
  else if (eff !== 'high') bad.push(`${k}: states ${eff ?? 'no effort'}, not high`);
  if (s.provider === 'anthropic' && s.extra?.reasoning !== undefined) bad.push(`${k}: carries the OpenRouter effort form`);
  return bad;
});
const capProblems = c => paid(c).flatMap(s => {
  const k = key(s), row = rowOf(s);
  if (typeof row?.maxOutput === 'number') return s.maxTokens === row.maxOutput ? [] : [`${k}: cap ${s.maxTokens}, the table says ${row.maxOutput}`];
  return NO_LIMIT.has(k) && row?.maxOutput === null && s.maxTokens === 128000 ? [] : [`${k}: a null or missing table figure needs the 128,000 cap and a place in the no-limit set (cap ${s.maxTokens})`];
});
const absenceProblems = c => {
  const bad = [];
  for (const s of [...Object.values(c.seats).flat()]) if (s && typeof s === 'object' && 'role' in s) bad.push(`${s.model}: carries a role field (the persona is the seat's own field, never a role.persona: the lint refuses both)`);
  for (const k of ['alternatives', 'deep_dive', 'persona', 'caps', 'cap']) if (k in c) bad.push(`top-level ${k}`);
  if (c.judging !== 'all-roles') bad.push(`judging is ${JSON.stringify(c.judging)}, not "all-roles" (the chain is tiered by majority_guard and a model that proposes also judges)`);
  if (!/each both propose and judge, which is why "judging" is "all-roles"/.test(c.description)) bad.push('the description does not say why judging is all-roles');
  return bad;
};
const personaProblems = c => {
  const bad = [];
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: seat_personas must be { enabled: true, form: "title" }. NEW: { enabled: true, form: "voice" }. WHY: the flagship flips to the voice form (WORDING_0.8.4.md section E #14; seatVoiceBlock, src/prompts/recorded-084-c.js); chains/plan-the-high-council.json carries it.
  if (JSON.stringify(c.seat_personas) !== JSON.stringify({ enabled: true, form: 'voice' })) bad.push(`seat_personas is ${JSON.stringify(c.seat_personas)}, not { enabled: true, form: "voice" }`);
  for (const s of paid(c)) if (s.persona !== nameOf(c, s)) bad.push(`${seatTag(c, s)}: persona ${JSON.stringify(s.persona)}, the roster says ${JSON.stringify(nameOf(c, s))}`);
  if (new Set(paid(c).map(s => s.persona)).size !== 15) bad.push('the 15 persona names are not 15 distinct names');
  return bad;
};
const stallProblems = c => (c.dispute?.stall_rounds === 3 ? [] : [`dispute.stall_rounds is ${c.dispute?.stall_rounds}, not 3`]);
const effortSentenceProblems = c => (/Every API seat reasons at high, except Qwen 3\.8 27B/.test(c.description) ? [] : ['the description does not name the Qwen 3.8 27B exception to "reasons at high"']);
const finishProblems = c => [/finish early/i, /propose to finish/i, /no [^.;]*persona field/i].filter(re => re.test(c.description)).map(re => `the description matches ${re}`);

test('PHC-1: the roster is his 15 seats: layers 5/5/2, three proposers, four Anthropic and eleven OpenRouter seats on 12 labs (Opus, Sol and DeepSeek each also propose); the layers lint clean', () => {
  assert.deepEqual(rosterProblems(chain), []);
  assert.deepEqual(layerProblems(chain, 'chains/plan-the-high-council.json'), []);
  assert.deepEqual(lintChain(chain, join(root, 'chains', 'plan-the-high-council.json')), []);   // the absolute path: a shipped-only rule must see it as shipped
  assert.equal(paid(chain).filter(s => s.provider === 'anthropic').length, 4);
  assert.equal(paid(chain).filter(s => s.provider === 'openrouter').length, 11);
});

test('PHC-2: every OpenRouter seat asks OpenRouter to skip Open Inference (and only that), no Anthropic seat carries a provider object', () => {
  assert.deepEqual(ignoreProblems(chain), []);
});

test('PHC-3: every API seat has a price row and a reasoning row and states high wherever the table has an effort field for its model (Qwen 3.8 27B offers no high and states xhigh)', () => {
  assert.deepEqual(reasoningProblems(chain), []);
  assert.equal(chain.seats.critics.find(s => s.model === 'claude-opus-5-5').extra.output_config.effort, 'high');   // Opus 5.5 and Haiku 5.5 default to medium: high is stated, never left to the default
  assert.equal(chain.seats.critics.find(s => s.model === 'claude-haiku-5-5').extra.output_config.effort, 'high');
});

test('PHC-4: each paid seat\'s cap is the table\'s number for its model; Kimi K3.1 Pro, MiniMax M3.1 Flash and Mistral Large 4 (no published limit) sit at 128,000; Qwen 3.8 27B at his 128,000', () => {
  assert.deepEqual(capProblems(chain), []);
  assert.equal(chain.seats.critics.find(s => s.model === 'qwen/qwen3.8-27b').maxTokens, 128000);   // his "B ... I like the uniformity of 128k" (09 Nov 2026 22:25 CET); the row is his pick, not the lab's 131,072
});

test('PHC-5: the review settings are plan-high-council\'s (its stall window is 3 rounds, E10); judging is all-roles; no alternatives stage, no deep dive, no role field, no cap setting', () => {
  assert.deepEqual(chain.dispute, { ...high.dispute, stall_rounds: 3 });
  for (const k of ['maxOverseerRounds', 'layerRevisions', 'signoff', 'signoff_table', 'answer_back', 'debate_hygiene', 'handoff_contract', 'proposals', 'debate', 'decisions', 'majority_guard', 'canary', 'handoff', 'reviewNotes', 'estimate']) {
    assert.deepEqual(chain[k], high[k], k);
  }
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the description is marked pending (/PENDING: .*not settled/) and names 28 Oct 2026 and 29 Oct 2026. NEW: it carries none of the three. WHY: the resolved description of plan-the-high-council (RESOLVED_LIST: 'The High Council on a new roster (0.8.4): ...', built text had 'PENDING'); chains/plan-the-high-council.json as recorded.
  assert.doesNotMatch(chain.description, /PENDING|28 Oct 2026|29 Oct 2026/);
  assert.deepEqual(absenceProblems(chain), []);
  assert.deepEqual(chain.seats.decider, high.seats.decider);
  assert.deepEqual(finishProblems(chain), []);
  assert.deepEqual(effortSentenceProblems(chain), []);
});

test('PHC-7: every seat carries its roster name and the persona setting is on in the form voice; the stall window is 3 rounds', () => {
  assert.deepEqual(personaProblems(chain), []);
  assert.deepEqual(stallProblems(chain), []);
  assert.equal(chain.seats.proposers.length + chain.seats.critics.length, 15);
});

test('PHC-6: the checks can fail: a Kimi with no effort, an effort on Qwen, an OpenRouter seat without the ignore, an Anthropic seat in the OpenRouter form, a role field, a Mistral cap below the no-limit 128,000, a swapped layer, a seat without its name, the switch off or in the form title, stall_rounds 2 and the early-finish sentence are each caught', () => {
  const plant = f => { const c = structuredClone(chain); f(c); return c; };
  const seat = (c, model) => [...c.seats.proposers, ...c.seats.critics].find(s => s.model === model);
  const criticSeat = (c, model) => c.seats.critics.find(s => s.model === model);
  assert.match(reasoningProblems(plant(c => { delete seat(c, 'moonshotai/kimi-k3.1-pro').extra.reasoning; })).join('|'), /kimi-k3.1-pro: states no effort, not high/);
  assert.match(reasoningProblems(plant(c => { seat(c, 'qwen/qwen3.8-27b').extra.reasoning = { effort: 'high' }; })).join('|'), /qwen3.8-27b: the table has no high setting for it, so the seat must state xhigh \(found high\)/);
  assert.match(ignoreProblems(plant(c => { delete seat(c, 'openai/gpt-6-luna').extra.provider; })).join('|'), /gpt-6-luna: provider.ignore is undefined/);
  assert.match(ignoreProblems(plant(c => { seat(c, 'deepseek/deepseek-v4.1-flash-1017').extra.provider.ignore = ['open-inference']; })).join('|'), /deepseek-v4.1-flash-1017: provider.ignore is \["open-inference"\], not \["open-inference","morph"\]/);
  assert.match(reasoningProblems(plant(c => { const s = seat(c, 'claude-fable-5-2'); s.extra = { reasoning: { effort: 'high' } }; })).join('|'), /claude-fable-5-2: (states no effort|carries the OpenRouter effort form)/);
  assert.match(absenceProblems(plant(c => { seat(c, 'openai/gpt-6-astra').role = { persona: 'karpathy' }; })).join('|'), /gpt-6-astra: carries a role field/);
  assert.match(absenceProblems(plant(c => { delete c.judging; })).join('|'), /judging is undefined, not "all-roles"/);
  assert.match(personaProblems(plant(c => { delete seat(c, 'openai/gpt-6-astra').persona; })).join('|'), /gpt-6-astra \(layer 3\): persona undefined, the roster says "Karpathy"/);
  assert.match(personaProblems(plant(c => { c.seats.proposers[1].persona = 'Aristotle'; })).join('|'), /deepseek-v4.1-flash-1017 \(proposer 2\): persona "Aristotle", the roster says "Husayn"/);
  assert.match(personaProblems(plant(c => { c.seat_personas.enabled = false; })).join('|'), /seat_personas is/);
  assert.match(personaProblems(plant(c => { c.seat_personas.form = 'title'; })).join('|'), /seat_personas is/);   // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the planted form was 'voice'. NEW: 'title' (the shipped form is now voice).
  assert.match(personaProblems(plant(c => { criticSeat(c, 'claude-opus-5-5').persona = 'Karpathy'; })).join('|'), /claude-opus-5-5 \(layer 2\): persona "Karpathy"/);
  assert.match(effortSentenceProblems(plant(c => { c.description = c.description.replace('Every API seat reasons at high, except Qwen 3.8 27B', 'Every API seat reasons at high'); })).join('|'), /does not name the Qwen 3.8 27B exception/);
  assert.match(stallProblems(plant(c => { c.dispute.stall_rounds = 2; })).join('|'), /stall_rounds is 2, not 3/);
  assert.match(finishProblems(plant(c => { c.description += ' If the reviser is your Claude Code session, it may propose to finish early.'; })).join('|'), /finish early/);
  assert.match(capProblems(plant(c => { seat(c, 'mistralai/mistral-large-4-0').maxTokens = 64000; })).join('|'), /mistral-large-4-0: a null or missing table figure needs the 128,000 cap/);
  assert.match(rosterProblems(plant(c => { seat(c, 'qwen/qwen3.8-27b').layer = 1; })).join('|'), /layer 1/);
});
