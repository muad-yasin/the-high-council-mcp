// 0.8.3 Chinese chains unit (gate note China_Chains_Gate_Note.md, C&C GO 16 Okt 2026; Muad 15 Okt 23:21): plan-china-mini-council, an additional chain next to the three tiers. Offline, $0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dryRunReport } from '../src/dry-run.js';
import { lintChain } from '../src/chain-lint.js';
import { layerProblems } from '../src/layers.js';
import { PROMOTED_CHAINS } from '../src/chain-name.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');
const pricing = JSON.parse(read('src/pricing.json'));
const reasoning = JSON.parse(read('src/reasoning-table.json')).models;
const CHINA = ['chains/plan-china-mini-council.json', 'chains/plan-china-medium-council.json'];
// typed per chain (the picks of the Medium proposer/alternatives/deep-dive seats are Builder A's, C&C 16 Okt: Chinese-only, one deep-dive seat)
// CHANGED ACCEPTED DATA (roster apply, 18 Okt 2026). OLD: seven judges in layers 3/2/2 from seven Chinese labs; Mini 2 overseer rounds; Medium proposers/alternatives incl. MiniMax and Qwen, bounds {1:5,2:3}. NEW: Astra's rosters as Muad accepted them: six judges in layers 2/2/2
// from six Chinese labs (MiniMax out), Mini one overseer round, Medium bounds {1:2,2:1} and its architects GLM Flash, MiMo and HY4. WHY: owner, via the caps session thcmcp-76 (FOCUS-detail "ASTRA ROSTERS ACCEPTED EXCEPT HIGH", "SEVEN ANSWERS: CHINESE MINI 1 ROUND; CHINESE MEDIUM REVISIONS 2/1; ...").
const SPEC = {
  'plan-china-mini-council': { proposers: ['deepseek-v4.1-flash', 'glm5.3-flash', 'mimo-v2.6-pro'], rounds: 1, bounds: { 1: 1, 2: 1 } },
  'plan-china-medium-council': { proposers: ['deepseek-v4.1-flash', 'glm5.3-flash', 'hy4-preview', 'mimo-v2.6-pro'], rounds: 3, bounds: { 1: 2, 2: 1 }, alternatives: ['glm5.3-flash', 'hy4-preview', 'mimo-v2.6-pro'] },
};
const LABS = ['deepseek', 'qwen', 'stepfun', 'tencent', 'xiaomi', 'z-ai'];   // typed: the OpenRouter vendor prefix of every seat, Chinese labs only
const allSeats = c => [...c.seats.proposers, ...(c.seats.alternatives || []), ...c.seats.critics, ...(c.seats.deep_dive ? [c.seats.deep_dive].flat() : [])];

for (const file of CHINA) {
  const c = JSON.parse(read(file));
  test(`${c.name} C1: six judges in layers 2/2/2 (at least two per layer), six labs each with its own lab value, Chinese labs only, no Kimi/Grok/Mistral anywhere in the file`, () => {
    const by = {}; for (const s of c.seats.critics) (by[s.layer] ??= []).push(s);
    assert.deepEqual(Object.values(by).map(l => l.length), [2, 2, 2]);
    assert.equal(c.seats.critics.length, 6);
    assert.equal(new Set(c.seats.critics.map(s => s.lab)).size, 6);
    assert.deepEqual([...new Set(c.seats.critics.map(s => s.model.split('/')[0]))].sort(), LABS);
    for (const s of allSeats(c).filter(x => x.provider !== 'external')) assert.ok(LABS.includes(s.model.split('/')[0]), s.model);
    assert.doesNotMatch(readFileSync(join(root, file), 'utf8').replace(/"description":.*/, ''), /kimi|moonshot|mistral|grok|x-ai/i);
    assert.deepEqual(layerProblems(c, file), []);
    assert.deepEqual(lintChain(c, file).map(f => f.kind), []);
    const spec = SPEC[c.name];
    assert.deepEqual(c.seats.proposers.map(s => s.lab).sort(), spec.proposers);
    assert.deepEqual((c.seats.alternatives || []).map(s => s.lab).sort(), spec.alternatives || []);
    assert.equal('alternatives' in c, Boolean(spec.alternatives)); assert.equal('deep_dive' in c, Boolean(spec.alternatives));
    if (spec.alternatives) { assert.equal(c.seats.deep_dive.model, 'deepseek/deepseek-v4.1-flash-1017'); assert.ok(c.description.includes('a layered review panel of six named judges'), 'the description counts the judges (CHANGED ACCEPTED, roster apply: the old sentence "Plan-medium-council has ten judges; this chain has seven, on purpose" is gone with the old roster)'); }   // typed: C&C FIX 16 Okt, the Mini proposer is GLM-5.3 Flash (the gate note priced it)
    assert.equal(c.judging, 'all-roles'); assert.equal(c.maxOverseerRounds, SPEC[c.name].rounds); assert.deepEqual(c.layerRevisions, { 1: SPEC[c.name].bounds[1], 2: SPEC[c.name].bounds[2] });
  });
  test(`${c.name} C2: every API seat has a price row and a reasoning row and reasons at high or above; StepFun sends high explicitly; StepFun and HY4 are capped at their 64,000 model maximum`, () => {
    const ORDER = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
    for (const s of allSeats(c).filter(x => x.provider !== 'external')) {
      const key = `${s.provider}/${s.model}`;
      assert.ok(pricing[key] && pricing[key].in > 0 && pricing[key].out > 0, `price row for ${key}`);
      assert.ok(reasoning[key], `reasoning row for ${key}`);
      const eff = s.extra?.reasoning?.effort;
      if (reasoning[key].defaultAboveHigh && !eff) continue;
      assert.ok(ORDER.indexOf(eff) >= ORDER.indexOf('high'), `${key} reasons at ${eff}`);
    }
    for (const m of ['stepfun/step-5-preview', 'tencent/hy4-preview']) {   // judges and (Medium) the HY4 proposer: the model max, above the 46,000 proposal ceiling
      const s = [...c.seats.critics, ...c.seats.proposers].find(x => x.model === m);
      assert.equal(s.maxTokens, 64000); assert.equal(s.extra.reasoning.effort, 'high');
    }
    // (the OLD pin that MiniMax and Qwen propose at 46,000 in Medium is gone with those proposers, roster apply 18 Okt 2026)
    assert.deepEqual(pricing['openrouter/stepfun/step-5-preview'].in, 1); assert.deepEqual(pricing['openrouter/stepfun/step-5-preview'].out, 2.7);
  });
  test(`${c.name} C3: the notes key is on and inert, it is not a promoted chain, the description prints the dry run's figures and names the previews and the Claude session`, () => {
    assert.deepEqual(c.reviewNotes, { enabled: true, perKind: 3 });
    assert.equal(PROMOTED_CHAINS.includes(c.name), false);
    const r = dryRunReport(c, { defaultCapUsd: 7 });
    assert.ok(c.description.includes(`$${r.estimate.expectedUsd.toFixed(2)} expected`) && c.description.includes(`an upper estimate of $${r.estimate.maximumUsd.toFixed(2)}`));   // CHANGED ACCEPTED (label rename part 2, 20 Okt 2026; Muad 18 Okt: "upper estimate" replaces "at most" and "maximum"): OLD "$Y at most"; NEW "an upper estimate of $Y"
    assert.ok(c.description.includes(`about $${r.estimate.expectedUsd.toFixed(2)} plus a Claude subscription`));
    const over = r.estimate.maximumUsd > 7;   // the Desktop-ceiling passage is true only for a maximum above the $7 default (C&C 16 Okt: the stale passage on a $5.95 maximum)
    assert.equal(c.description.includes('is above the default cap of $7'), over, 'the "above the default cap" sentence appears only when the printed maximum is above $7');
    assert.equal(c.description.includes('fits under the $7 default cap'), !over, 'the "fits under" line appears only when it is not');
    assert.match(c.description, /Tencent HY4 Preview and StepFun Step 5 Preview are preview models/);
    assert.match(c.description, /your Claude Code session/);
    assert.doesNotMatch(`${c.summary} ${c.description}`, /\b(better|best|more accurate|outperform)\b/i);
  });
}
