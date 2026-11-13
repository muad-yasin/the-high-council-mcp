// 0.8.4 round 2, the second shape of floor_by (the first, 10a, is the layer BELOW the layer the ladder started a pass at). In-process, $0, every seat a mock, replies scripted through the stage cache.
// The shape: the ladder (block 1, visits 1). Pass 1 starts at layer 1 and layer 1 objects. Pass 2 starts at layer 2 (layer 2's one visit) and layer 2 objects. Pass 3 is a new block, starts at layer 1: layer 1 SIGNS OFF, layer 2 is skipped
// (its visits are used up) and layer 3 is asked and signs off. On the tip the layer-2 row of pass 3 reads state not_asked with no mark, so the report and the BOARD say "a layer below did not sign off" about a pass in which layer 1 signed off.
// What tells the case apart (not a wording pin): the layer-2 row of pass 3 carries floor_by 'ladder_visits' (state stays not_asked: its readers are unchanged), and the words of that row (layerStateWord, the BOARD's words) are not the words that say
// a layer below did not sign off. Controls (same run): the layer-2 row of pass 1 (layer 1 objected) has no floor_by and keeps those words; the layer-1 row of pass 2 keeps floor_by 'ladder'; the report validates against the schema.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { runChain, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import { reportJsonShape, renderLayersBoard } from '../src/report-shape.js';
import { layerStateWord, LAYER_STATE_WORDS } from '../src/layers.js';
import { CRITERION, DRAFT, failureOf } from './helpers/layer-two-run.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EV = 'Section two sets the retry limit to five attempts.';
const signoff = JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: EV }], failures: [], verdict_line: 'ok' });
const raise = JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: [failureOf(5)], verdict_line: 'no' });
const OVERRIDES = { 'panel-1-l1': raise, 'panel-2-l2': raise };
const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
const config = { name: 'floorby-visits', criteria: [CRITERION], maxRounds: 6, signoff: 'unanimous', ladder: { block: 1, visits: 1 },
  seats: { builder: seat('writer'), reviser: seat('writer'), critics: [seat('l1', 1), seat('l2', 2), seat('l3', 3)] } };

let RUN = null;
async function run() {
  if (RUN) return RUN;
  setPromptSpy(() => {});
  setCache({ invalidate: () => {}, get(label) { const text = OVERRIDES[label] ?? (label.startsWith('panel-') ? signoff : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label}.` : label === 'build' ? DRAFT : null); return text === null ? null : { text, provider: 'mock', model: 'mock-review-fixture', usage: { input: 0, output: 0 }, usd: 0 }; } });
  try {
    const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-floorby-visits', log: () => {}, config, ladder: { block: 1, visits: 1, credit: 0, exchange: 0 } });
    RUN = { result, report: JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-floorby-visits', chain: 'floorby-visits', task: 't.md', result, config }))) };
  } finally { setPromptSpy(null); setCache(null); setBudget(null); }
  return RUN;
}
const row = (rep, round, layer) => rep.layers.find(r => r.round === round && r.layer === layer);

test('floor_by second shape: premise: pass 3 starts at layer 1, layer 1 signs off, layer 3 signs off, layer 2 is not asked', async () => {
  const { report } = await run();
  assert.deepEqual([1, 2, 3].map(l => row(report, 3, l)?.state), ['signed_off', 'not_asked', 'signed_off'], 'the shape of job 205');
  assert.equal(report.escalated_signoff?.ladder, true, 'a ladder sign-off');
});

test('floor_by second shape: the layer-2 row of pass 3 says why it was not asked (floor_by ladder_visits; state stays not_asked), and its words do not say a layer below did not sign off', async () => {
  const { report } = await run();
  const r = row(report, 3, 2);
  assert.equal(r.state, 'not_asked', 'the state stays not_asked: its readers are unchanged');
  assert.equal(r.floor_by, 'ladder_visits', 'the row records that the ladder had no visit left for the layer');
  assert.notEqual(layerStateWord(r), LAYER_STATE_WORDS.not_asked, 'the row\'s words are not the "a layer below did not sign off" words');
  const board = renderLayersBoard(report.layers);
  const line = board.split('\n').find(l => l.startsWith('| 3 | 2 |'));
  assert.ok(line && !line.includes(LAYER_STATE_WORDS.not_asked), `the BOARD line of that row does not say a layer below did not sign off (${line})`);
});

test('floor_by second shape controls (same run): layer 2 not asked because layer 1 objected has no mark and keeps its words; the layer-1 row below the ladder floor keeps floor_by ladder; the report validates', async () => {
  const { report } = await run();
  const a = row(report, 1, 2);
  assert.deepEqual([a.state, a.floor_by], ['not_asked', undefined], 'a layer not asked because a layer below objected is not marked');
  assert.equal(layerStateWord(a), LAYER_STATE_WORDS.not_asked, 'and says so');
  const b = row(report, 2, 1);
  assert.deepEqual([b.state, b.floor_by], ['not_asked', 'ladder'], 'the first shape (10a) is unchanged');
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true }); ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
  const validate = ajv.compile(JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8')));
  validate(report);
  assert.deepEqual((validate.errors ?? []).filter(e => /\/layers\//.test(e.instancePath)).map(e => `${e.instancePath} ${e.message}`), [], 'no schema error names a layers[] row');
});
