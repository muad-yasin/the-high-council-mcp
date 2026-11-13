// NEW-F4-1 (FEATURE_SPECS l.267, Q1(c), D11; row l.458; M1 S19 (b)): with the rating demand in force, a defect a judge names in an exchange post needs a valid rating. One without it is recorded as PROPOSED with its refusal reason ("no_valid_rating"), mints no id, holds nothing,
// is never retried, and the rest of the post stays valid (the stance counts). With the demand held nobody was asked to rate, so the defect is kept as it always was. Offline, mock seats, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { runChain, setCache, setBudget, setPromptSpy } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { readPosts } from '../src/layer-debate.js';
import { severityRecord } from '../src/severity.js';
import { reportJsonShape } from '../src/report-shape.js';
import { DEMAND, NO_DEMAND } from './helpers/rating-demand.js';

afterEach(() => { setCache(null); setBudget(null); setPromptSpy(null); setHeldForTest(null); });
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seat = (model, lab, layer) => ({ provider: 'mock', model, lab, layer });
const cfgOf = critics => ({ name: 'proposed-test', maxRounds: 1, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics } });
const go = async config => { const labels = []; setPromptSpy(p => labels.push(p.label)); const r = await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-proposed', config }); return { r, labels }; };
const verdictOf = (r, lab) => r.panelVerdicts.find(v => v.lab === lab && v.round === 1);
// ea names a new defect in its post (mock-exch-new-*); a `-sev` model writes no rating on a post defect even when the prompt demands one, a model without the suffix writes the mock's default 5
const chain = poster => cfgOf([seat(poster, 'ea', 1), seat('mock-exch-support-keep-sev3', 'eb', 1), seat('mock-critic-x', 'ec', 2)]);

test('NEW-F4-1, readPosts: a post with a valid stance on another judge\'s objection and a new defect with no valid rating - the stance counts, the defect is PROPOSED with its refusal reason, no objection is built, the rest of the post is valid', () => {
  const shown = [{ id: 'O-aaaaaaaa' }];
  const parsed = { posts: [{ on: 'O-aaaaaaaa', stance: 'support', text: 'It holds.' }], new_objections: [{ criterion: 'It is scoped.', problem: 'A second deliverable.', quote: 'two things' }, { criterion: 'It is ordered.', problem: 'Bad rating.', severity: 'high' }, { criterion: 'It is short.', problem: 'Rated.', severity: 6 }, { problem: 'Names no criterion.', quote: 'a passage', severity: 7 }] };
  const got = readPosts(parsed, { shown, draft: 'd', severity: true });
  assert.deepEqual(got.posts.map(p => [p.on, p.stance, p.counted]), [['O-aaaaaaaa', 'support', true]], 'the stance is counted and the post is valid');
  assert.deepEqual(got.proposed, [{ criterion: 'It is scoped.', problem: 'A second deliverable.', quote: 'two things', why: 'no_valid_rating' }, { criterion: 'It is ordered.', problem: 'Bad rating.', why: 'no_valid_rating' }, { problem: 'Names no criterion.', quote: 'a passage', why: 'no_criterion' }]);
  assert.deepEqual(got.news.map(n => [n.criterion, n.severity]), [['It is short.', 6]], 'only the defect with a valid rating becomes a new objection');
  const held = readPosts(parsed, { shown, draft: 'd' });   // the demand held: nobody was asked to rate
  assert.deepEqual([held.news.length, held.proposed.map(p => p.why)], [3, ['no_criterion']], 'without the demand a defect with a criterion is kept, as before; one with no criterion (dropped without a trace before) is proposed now: purely additive');
});

test('NEW-F4-1, a run with the demand in force: the defect an exchange post names without a rating is PROPOSED in the entry (each round it is named), no id is minted, no row is built for it, no call is made again, its judge signs off on its own (swept) objection, and the stance of the post counted', async () => {
  setHeldForTest(DEMAND);
  const cfg = chain('mock-exch-new-keep-sev3');
  const { r, labels } = await go(cfg);
  const entry = r.layerDebates[0];
  assert.ok(entry.proposed.length >= 1);
  for (const p of entry.proposed) assert.deepEqual([p.by, p.why, p.criterion], ['ea', 'no_valid_rating', 'It adds no scope the request did not ask for.']);
  assert.deepEqual(entry.proposed.map(p => p.round), [1, 2].slice(0, entry.proposed.length), 'one entry per post and round');
  assert.equal(entry.new_objections, undefined, 'no new objection');
  assert.equal(entry.objections.some(o => o.from_exchange), false, 'no id was minted for the defect');
  assert.equal(labels.filter(l => /retry|reask/.test(l ?? '')).length, 0, 'no call is made again for it');
  const onEb = entry.objections.find(o => o.raised_by === 'eb');
  assert.ok(onEb.posts.some(p => p.by === 'ea' && p.stance === 'support' && p.counted !== false), 'the stance of the same post counted');
  assert.equal(verdictOf(r, 'ea').verdict, 'signed_off', 'nothing holds ea: its own objection is rated 3 and swept, and the proposed defect holds nothing');
  assert.equal((severityRecord(cfg, r).open_at_end ?? []).some(o => o.lab === 'ea'), false, 'and nothing of ea is open in the severity record');
});

test('NEW-F4-1, the control and the held path: a model whose post defect DOES carry a rating mints the objection (rated 5, it holds its judge); with the demand held the defect is kept untagged, as it always was', async () => {
  setHeldForTest(DEMAND);
  const rated = await go(chain('mock-exch-new-keep'));
  assert.equal(rated.r.layerDebates[0].proposed, undefined, 'a rated defect is not proposed');
  assert.deepEqual(rated.r.layerDebates[0].new_objections.map(n => n.severity), [5]);
  assert.equal(rated.r.layerDebates[0].objections.filter(o => o.from_exchange).length, 1, 'its id is minted');
  assert.equal(verdictOf(rated.r, 'ea').verdict, 'objected', 'and it holds its raiser');
  setHeldForTest(NO_DEMAND);
  const held = await go(chain('mock-exch-new-keep-sev3'));
  assert.equal(held.r.layerDebates[0].proposed, undefined, 'demand held: nothing is proposed');
  assert.deepEqual(held.r.layerDebates[0].new_objections.map(n => 'severity' in n), [false], 'the defect is kept, untagged');
  assert.equal(verdictOf(held.r, 'ea').verdict, 'objected', 'and an unrated objection holds, as before');
});

test('NEW-F4-1 per reason, a run: a defect a post names with NO CRITERION is proposed (no_criterion) with the demand in force AND while it is held (it was dropped without a trace before, so recording it is purely additive), and nothing is minted for it', async () => {
  for (const [name, state] of [['demand in force', DEMAND], ['demand held', NO_DEMAND]]) {
    setHeldForTest(state);
    const prompts = new Map(); setPromptSpy(p => prompts.set(p.label, p));
    setCache({ invalidate: () => {}, get(label) {
      if (!/^ldebate-1(?:-x\d+)?-ea$/.test(label)) return null;   // only ea's exchange posts; every other stage runs live
      const ids = [...String(prompts.get(label)?.user ?? '').matchAll(/^Objection (O-[0-9a-f]{8}(?:#r?[0-9]+)?)$/gm)].map(m => m[1]);
      return { text: JSON.stringify({ posts: ids.map(on => ({ on, stance: 'support', text: 'It holds against the criteria.' })), new_objections: [{ problem: 'The plan names a second deliverable nobody asked for.' }] }), provider: 'mock', model: 'mock-exch-support-keep-sev3', usage: { input: 0, output: 0 }, usd: 0 };
    } });
    const r = await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-proposed-c', config: chain('mock-exch-support-keep-sev3') });
    const entry = r.layerDebates[0];
    assert.ok(entry.proposed?.length >= 1 && entry.proposed.every(p => p.why === 'no_criterion' && p.by === 'ea' && !('criterion' in p)), `${name}: recorded as proposed with the reason`);
    assert.equal(entry.new_objections, undefined, `${name}: no new objection`);
    assert.equal(entry.objections.some(o => o.from_exchange), false, `${name}: no id minted`);
    setCache(null); setPromptSpy(null);
  }
});

test('NEW-F4-1, the schema: the entry\'s `proposed` is declared (by, round, problem, why; criterion is absent for no_criterion; why is one of two reasons), the entry in report.json carries it and validates and a known-bad entry does not', async () => {
  const schema = JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'));
  const validateEntry = new Ajv2020({ strict: false, allErrors: true }).compile({ $defs: schema.$defs, ...schema.properties.layer_debates.items });
  const good = { pass: 1, layer: 1, rounds: [], objections: [], proposed: [{ by: 'ea', round: 1, criterion: 'It is scoped.', problem: 'A second deliverable.', why: 'no_valid_rating' }] };
  assert.equal(validateEntry(good), true, JSON.stringify(validateEntry.errors));
  const bad = (name, p) => assert.equal(validateEntry({ ...good, proposed: [{ ...good.proposed[0], ...p }] }), false, name);
  bad('another reason', { why: 'because' });
  assert.equal(validateEntry({ ...good, proposed: [{ by: 'ea', round: 1, problem: 'p', why: 'no_criterion' }] }), true, 'a no_criterion entry carries no criterion');
  bad('a round that is not an integer', { round: 'one' });
  assert.equal(validateEntry({ ...good, proposed: [{ by: 'ea', round: 1, criterion: 'c', problem: 'p' }] }), false, 'an entry with no reason');
  setHeldForTest(DEMAND);
  const cfg = chain('mock-exch-new-keep-sev3');
  const { r } = await go(cfg);
  const inReport = JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-proposed', chain: 'proposed-test', task: 'task.md', result: r, config: cfg }).layer_debates[0]));
  assert.ok(inReport.proposed?.length >= 1, 'report.json carries the list (not only the in-process result)');
  assert.equal(validateEntry(inReport), true, JSON.stringify(validateEntry.errors?.slice(0, 3)));
});
