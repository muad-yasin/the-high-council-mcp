// M1 (S19, C&C's option (b)): ratings are RECORDED on every layered unanimous chain (a severity ledger, report.json `severity`), and the rating DEMAND (the sentences in every prompt AND the parser's strict refusal of a missing rating) is ONE held word, `ratingDemand` (src/ratings-demand.js).
// While it is held every prompt is byte-identical to a chain without ratings and a failure with no rating reads as unrated (it holds the sign-off); injected, the chain behaves as the removed `severity: { enabled: true }` chain did on a layered unanimous chain. Offline, mock seats, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, setCache, setBudget, setPromptSpy } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { reportJsonShape } from '../src/report-shape.js';
import * as SEV from '../src/severity.js';   // read through the namespace / a guarded import, so a tree without the new exports fails those tests alone and not the whole file (the red-tree method)
const RD = await import('../src/ratings-demand.js').catch(() => ({}));
const ratingsRecorded = (...a) => SEV.ratingsRecorded(...a);
const ratingsDemanded = (...a) => RD.ratingsDemanded(...a);
import { readChainFile } from './helpers/chain-file.js';
import { DEMAND, NO_DEMAND } from './helpers/rating-demand.js';

afterEach(() => { setCache(null); setBudget(null); setPromptSpy(null); setHeldForTest(null); });
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seat = (model, lab, layer) => ({ provider: 'mock', model, lab, layer });
const chainOf = (critics, extra = {}) => ({
  name: 'ratings-record-test', maxRounds: 1, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics },
  ...extra,
});
const go = async config => { const seen = []; setPromptSpy(p => seen.push(p)); const r = await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-ratings-record', config }); return { r, seen, shape: shapeOf(r, config) }; };
// the report's severity section is written from the CHAIN (ratingsRecorded(config)) as well as the result, so the config goes in
function shapeOf(r, config) { return JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-ratings-record', chain: 'ratings-record-test', task: 'task.md', result: r, config }))); }
const promptText = seen => seen.map(p => `${p.system ?? ''}\n${p.user ?? ''}`).join('\n=====\n');
// What the rating demand puts into prompts (each is one sentence or heading of the A-DRAFT rating text in src/roles.js).
const MARKERS = [/carries a severity: a number from 1 to 10/, /Give each new objection a severity from 1 to 10/, /\n {3}Severity: /, /# Objections raised against the draft/, /You may change the rating of any objection in the ledger/, /Some objections carry a severity/];
const labels = r => r.stages.map(s => s.label);
const mockLayered = extra => ({ ...readChainFile(root, 'mock-layered'), ...extra });   // the shipped layered mock chain (3 layers of 2, dispute on, 3 rounds); { maxRounds: 1 } stops after the first pass, so its signoff[] keeps the first pass's objections

test('predicates: ratings are recorded on a layered unanimous chain only; the demand needs the held word as well', () => {
  const layered = chainOf([seat('m', 'a', 1), seat('m', 'b', 1)]);
  const flat = chainOf([{ provider: 'mock', model: 'm', lab: 'a' }, { provider: 'mock', model: 'm', lab: 'b' }]);
  assert.deepEqual([ratingsRecorded(layered), ratingsRecorded(flat), ratingsRecorded({ ...layered, signoff: 'first' }), ratingsRecorded({})], [true, false, false, false]);
  setHeldForTest(NO_DEMAND);
  assert.equal(ratingsDemanded(layered), false, 'the held word is not recorded: no demand');
  setHeldForTest(DEMAND);
  assert.deepEqual([ratingsDemanded(layered), ratingsDemanded(flat)], [true, false], 'recorded: the demand on a layered chain, never on a flat one');
});

test('HELD: a layered chain records ratings (a severity section) but no prompt of the run carries a rating sentence, a Severity line or the re-tag rule; nobody is unheard', async () => {
  setHeldForTest(NO_DEMAND);
  const { r, seen, shape } = await go(mockLayered());   // the whole run: revise, the layer exchange, the ledger, the dispute stage
  const text = promptText(seen);
  for (const m of MARKERS) assert.doesNotMatch(text, m, `held: no prompt carries ${m}`);
  assert.equal(r.panelVerdicts.some(v => v.verdict === 'unheard'), false, 'a missing rating reads as unrated: no judge is refused');
  const sev = shape.severity;
  assert.ok(sev && typeof sev.computed === 'boolean' && Array.isArray(sev.open_at_end), 'the severity section is written on every layered unanimous run');
  assert.equal(sev.asked, false, 'and it says no one was asked to rate (every band reads unreadable because of that, not because a reply broke)');
  assert.deepEqual(r.signoff.flatMap(s => s.objections || []).filter(o => 'severity' in o), [], 'held: no tag in the record');
});

test('INJECTED: the critic prompts carry the demand, the mock judges rate their objections (5), the ratings reach the record, and every judge of the shipped layered mock chain stays heard (C&C\'s bar)', async () => {
  setHeldForTest(DEMAND);
  const whole = await go(mockLayered());
  assert.match(promptText(whole.seen), MARKERS[0], 'the demand is in the blind-review system prompt');
  assert.match(promptText(whole.seen), MARKERS[3], 'and the writer\'s revise prompt uses the objections heading');
  assert.equal(whole.r.panelVerdicts.some(v => v.verdict === 'unheard'), false, 'with the demand in force no judge of mock-layered is unheard, in any pass');
  const first = await go(mockLayered({ maxRounds: 1 }));
  const tags = first.r.signoff.flatMap(s => s.objections || []).map(o => o.severity);
  assert.ok(tags.length > 0 && tags.every(t => t === 5), `the objections of the first pass carry the mock's rating: ${JSON.stringify(tags)}`);
  assert.ok(first.shape.severity, 'and the section is there');
  assert.equal(first.shape.severity.asked, true, 'and it says the judges were asked to rate');
});

test('INJECTED: a judge whose objection carries no rating is refused, asked once more with a note, and unheard if it still gives none; HELD, the same judge is heard and its objection holds the sign-off', async () => {
  const cfg = () => chainOf([seat('mock-exch-support-keep-sevnone', 'ea', 1), seat('mock-exch-support-keep-sev6p5', 'eb', 1), seat('mock-critic-x', 'ec', 2)]);
  setHeldForTest(DEMAND);
  const on = await go(cfg());
  assert.equal(on.r.panelVerdicts.find(v => v.lab === 'ea').verdict, 'unheard', 'strict: a missing rating makes the verdict unreadable');
  assert.ok(labels(on.r).includes('panel-1-ea-reask1'), 'asked once more, with a note');
  assert.match(promptText(on.seen), /could not be read: objection 1 .* has no severity/s, 'the re-ask note names the missing rating');
  setHeldForTest(NO_DEMAND);
  const off = await go(cfg());
  assert.equal(off.r.panelVerdicts.find(v => v.lab === 'ea').verdict, 'objected', 'held: lenient, the objection holds');
  assert.equal(labels(off.r).some(l => /-reask/.test(l)), false, 'held: no re-ask');
  assert.deepEqual(off.r.signoff.flatMap(s => s.objections || []).filter(o => 'severity' in o), [], 'held: the volunteered tag (6.5) is dropped, as with the removed switch off');
});

test('asked comes from the RUN, not from the process that shapes the report: a run made while the demand is held says asked false even when the report is shaped after the demand is in force, and the other way round', async () => {
  setHeldForTest(NO_DEMAND);
  const held = await go(mockLayered({ maxRounds: 1 }));
  setHeldForTest(DEMAND);
  assert.equal(shapeOf(held.r, mockLayered({ maxRounds: 1 })).severity.asked, false, 'shaped later with the demand in force: still false, nobody was asked');
  const asked = await go(mockLayered({ maxRounds: 1 }));
  setHeldForTest(NO_DEMAND);
  assert.equal(shapeOf(asked.r, mockLayered({ maxRounds: 1 })).severity.asked, true, 'shaped later with the demand held: still true, the judges were asked');
});

test('a flat unanimous chain records nothing: no severity section', async () => {
  const flat = readChainFile(root, 'mock-unanimous');
  const { shape } = await go({ ...flat, maxRounds: 1 });
  assert.equal(shape.severity, undefined);
});
