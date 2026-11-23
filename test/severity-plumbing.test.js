// B3 prep, JUDGE lane, unit 2: severity PLUMBING (no blocking yet; that is unit 3). With the rating demand in force (since 0.8.4 S19 ratings are recorded on every layered unanimous chain and the demand is the held word `ratingDemand`, injected here with DEMAND; there is no switch): a judge's verdict whose objection carries no readable severity is an unreadable verdict (asked again, then unheard),
// never a default number; a readable severity survives every copy of an objection (the answer-back pair, the exchange's objections, rows and new objections, a sustained objection adopted by a higher layer); the report declares the field
// (and `layer_debates`, which it wrote without declaring); lint refuses a layered unanimous chain with a one-seat layer (fail closed: "one judge cannot hold the plan alone" cannot be honoured there). With the demand held (NO_DEMAND) no rating is asked for or required, a volunteered tag is dropped, and the lines are recorded unrated.
// The functions are read off the module namespaces on purpose: a missing export fails each test by name.
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { normaliseCritique, runChain, setCache, setBudget, setPromptSpy } from '../src/chain.js';
import { buildAnswerBack, applyAnswers } from '../src/answer-back.js';
import { exchangeObjections, readPosts } from '../src/layer-debate.js';
import { objectionId } from '../src/objection-ids.js';
import { lintChain } from '../src/chain-lint.js';
import { reportJsonShape } from '../src/report-shape.js';
import { setHeldForTest } from '../src/held-roles.js';
import { DEMAND, NO_DEMAND } from './helpers/rating-demand.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
afterEach(() => { setCache(null); setBudget(null); setPromptSpy(null); setHeldForTest(null); });
// S19 (M1): the rating demand is ONE held word; every test of this file runs with it injected unless it says otherwise (NO_DEMAND proves the held path, and keeps proving it after the release re-record, when the name is recorded).
beforeEach(() => setHeldForTest(DEMAND));
const C = 'It states the assumptions it was written under.';
const F = (extra = {}) => ({ criterion: C, problem: 'None stated.', fix: 'Add them.', quote: 'Steep.', ...extra });
const verdict = (failures, extra = {}) => ({ meets: false, criteria: [], failures, verdict_line: 'One criterion failed.', ...extra });

test('normaliseCritique with the severity option: a readable severity survives; a missing, worded or out-of-range one makes the verdict unreadable (re-ask), never a default', () => {
  const log = [];
  const ok = normaliseCritique(verdict([F({ severity: 6.5 })]), m => log.push(m), { severity: true });
  assert.equal(ok.unreadable, undefined); assert.equal(ok.meets, false); assert.equal(ok.failures[0].severity, 6.5);
  for (const bad of [undefined, null, 'high', '7', 0, 11, 6.55, [], {}]) {
    const r = normaliseCritique(verdict([F(bad === undefined ? {} : { severity: bad })]), () => {}, { severity: true });
    assert.equal(r.unreadable, true, `severity ${JSON.stringify(bad)}`);
    assert.equal(r.meets, false); assert.deepEqual(r.failures, []);
    assert.match(r.unreadableWhy, /severity/);
  }
  // one unreadable objection among readable ones makes the whole verdict unreadable: a judge is never half heard
  assert.equal(normaliseCritique(verdict([F({ severity: 8 }), F({ criterion: 'Other.', severity: 'x' })]), () => {}, { severity: true }).unreadable, true);
  // the failures the harness writes itself carry no severity, so with the option on they are unreadable too
  const tableOnly = { meets: false, criteria: [{ criterion: C, verdict: 'FAILED', evidence: 'No assumptions.' }], failures: [], verdict_line: 'x' };
  assert.equal(normaliseCritique(tableOnly, () => {}, { severity: true }).unreadable, true, 'a FAILED table row the judge left out of its list');
  assert.equal(normaliseCritique({ meets: false, criteria: [], failures: [], verdict_line: 'no' }, () => {}, { severity: true }).unreadable, true, 'meets:false naming nothing');
  // a clean verdict has no failure to tag
  assert.equal(normaliseCritique({ meets: true, criteria: [], failures: [], verdict_line: 'ok' }, () => {}, { severity: true }).meets, true);
});

test('normaliseCritique without the option: a severity-less failure is an ordinary objection, and a severity a judge volunteers is DROPPED (a deliberate change from carrying it through: no record kept without the demand may carry one, so the published type of the field cannot be violated)', () => {
  const r = normaliseCritique(verdict([F()]), () => {});
  assert.equal(r.unreadable, undefined); assert.equal(r.meets, false); assert.equal('severity' in r.failures[0], false);
  for (const v of ['high', 6.5, 11]) assert.equal('severity' in normaliseCritique(verdict([F({ severity: v })]), () => {}).failures[0], false, `volunteered ${JSON.stringify(v)} is dropped`);
  assert.equal(normaliseCritique(verdict([F({ severity: 6.5 })]), () => {}, { severity: false }).meets, false);
});

const seat = (model, lab, layer) => ({ provider: 'mock', model, lab, ...(layer ? { layer } : {}) });
const cfgOf = (critics, extra = {}) => ({
  name: 'severity-test', maxRounds: 1, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics }, ...extra,
});
const go = async cfg => { const seen = []; setPromptSpy(p => seen.push(p)); const r = await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-sev', config: cfg }); return { r, seen }; };

// CHANGED ACCEPTED (0.8.4 S19, C&C's option (b): ratings are recorded on every layered unanimous chain, there is no `severity` switch, the rating demand is the held word `ratingDemand`). OLD: an UNLAYERED two-judge panel with `severity: { enabled: true }` (strict refusal of a missing rating) and the same panel with the key off (lenient). NEW: the two judges sit on layer 1 with a third seat on layer 2 (a layered chain, never asked while layer 1 objects; the layer exchange now runs between the two, no assertion here reads its labels, prompts or counts), the strict half runs with DEMAND injected (the file-level beforeEach), the lenient half with NO_DEMAND, and a flat chain with the demand injected is added (it asks for nothing, drops a volunteered tag, writes no severity section). WHY: the key is gone and an unlayered chain records nothing, so the old fixture could no longer reach the strict path. RED ON OLD SRC: with no key the old src never demanded a rating and its parser drops the volunteered tag, so the first assertion to fail is deepEqual(sev('ea'), [6.5]) (the tagged judge's objection carries no rating); the 'unheard' assertions fail after it.
test('through a real run on a layered chain with the rating demand in force: a judge that tags 6.5 is heard and its objection carries 6.5 into signoff[]; a judge that gives none, or a worded tag, is unheard (never an objection and never a default); with the demand held an untagged objection is an ordinary one and a volunteered tag is dropped; an unlayered chain asks for nothing and records nothing', async () => {
  const layered = (a, b) => cfgOf([seat(a, 'ea', 1), seat(b, 'eb', 1), seat('mock-critic-x', 'ec', 2)]);   // the severity ledger and the rating demand belong to a LAYERED unanimous chain
  const tagged = await go(layered('mock-exch-support-keep-sev6p5', 'mock-exch-support-keep-sev9'));
  const rowOf = (r, lab) => r.panelVerdicts.find(v => v.round === 1 && v.lab === lab);
  assert.equal(rowOf(tagged.r, 'ea').verdict, 'objected'); assert.equal(rowOf(tagged.r, 'eb').verdict, 'objected');
  const sev = lab => tagged.r.signoff.find(s => s.lab === lab).objections.map(o => o.severity);
  assert.deepEqual(sev('ea'), [6.5]); assert.deepEqual(sev('eb'), [9]);
  for (const model of ['mock-exch-support-keep-sevnone', 'mock-exch-support-keep-sevword']) {
    const g = await go(layered(model, 'mock-exch-support-keep-sev9'));
    assert.equal(rowOf(g.r, 'ea').verdict, 'unheard', `${model}: unreadable after the re-ask`);
    // (a verdict unreadable for a missing rating is asked ONCE more with a note, whatever the other judge did (src/chain.js, unit V); still without one the judge is unheard, and the one judge that was heard is the lone heard judge of its layer: its objection is recorded as not debated, since the exchange needs two. The verdict is unheard and never an objection)
    assert.deepEqual(g.r.signoff.find(x => x.lab === 'ea')?.objections ?? [], [], `${model}: nothing from the unreadable verdict reaches the record as an objection`);
    assert.equal(rowOf(g.r, 'eb').verdict, 'objected');
  }
  setHeldForTest(NO_DEMAND);   // the demand held: the chain is layered and records, but asks for nothing and requires nothing
  const off = await go(layered('mock-exch-support-keep-sevnone', 'mock-exch-support-keep-sev9'));
  assert.equal(rowOf(off.r, 'ea').verdict, 'objected', 'demand held: no rating is asked for or required');
  const offJudges = await go(cfgOf([seat('mock-exch-support-keep-sev6p5', 'ea', 1), seat('mock-exch-new-keep-sev9', 'eb', 1), seat('mock-critic-x', 'ec', 2)], {}));
  assert.deepEqual(offJudges.r.signoff.flatMap(s => s.objections || []).filter(o => 'severity' in o), [], 'demand held: judges that volunteer a tag leave none in signoff[]');
  assert.deepEqual(offJudges.r.layerDebates.flatMap(d => d.objections).filter(o => 'severity' in o), [], 'demand held: none in layer_debates');
  // an unlayered chain records nothing and asks for nothing, even with the demand injected: a missing rating is no refusal, a volunteered tag is dropped, no severity section is written
  setHeldForTest(DEMAND);
  const flatCfg = cfgOf([seat('mock-exch-support-keep-sevnone', 'ea'), seat('mock-exch-support-keep-sev9', 'eb')]);
  const flat = await go(flatCfg);
  assert.equal(rowOf(flat.r, 'ea').verdict, 'objected', 'unlayered, demand injected: no rating is required');
  assert.deepEqual(flat.r.signoff.flatMap(s => s.objections || []).filter(o => 'severity' in o), [], 'unlayered: the tag eb volunteered is dropped');
  assert.equal(reportJsonShape({ runId: 'r-sev', chain: 'severity-test', task: 'task.md', result: flat.r, config: flatCfg }).severity, undefined, 'unlayered: no severity section');
});

test('answer-back copies: the entry a judge is shown and the carried and unanswered objections keep the severity', () => {
  const failures = [{ lab: 'la', id: 'O-aaaaaaaa', criterion: C, problem: 'None stated.', quote: 'Steep.', severity: 7.5 }, { lab: 'la', id: 'O-bbbbbbbb', criterion: 'Second.', problem: 'No pour step.' }];
  const entry = buildAnswerBack({ failures, declined: [], oldDraft: 'a', newDraft: 'b' }).la;
  assert.equal(entry.objections.find(o => o.id === 'O-aaaaaaaa').severity, 7.5);
  assert.equal('severity' in entry.objections.find(o => o.id === 'O-bbbbbbbb'), false, 'an untagged objection stays untagged (no default)');
  const own = entry.objections;
  const r = applyAnswers({ lab: 'la', critique: { answers: [{ id: 'O-aaaaaaaa', status: 'sustained', evidence: 'still' }], failures: [] }, own, shownDraft: 'b', round: 2 });
  assert.equal(r.carried.find(f => f.id === 'O-aaaaaaaa').severity, 7.5, 'carried');
  assert.equal(r.unanswered.find(f => f.id === 'O-bbbbbbbb').severity, undefined, 'unanswered, untagged');
  const r2 = applyAnswers({ lab: 'la', critique: { answers: [], failures: [] }, own, shownDraft: 'b', round: 2 });
  assert.equal(r2.unanswered.find(f => f.id === 'O-aaaaaaaa').severity, 7.5, 'unanswered, tagged');
});

test('exchange copies: exchangeObjections carries the severity and, for two copies of one id, keeps the highest readable one; a post\'s new objection keeps a readable severity and drops an unreadable one', () => {
  const id = objectionId('la', F());
  const out = exchangeObjections([{ key: 'la', failures: [F({ severity: 5 }), F({ problem: 'Again.', severity: 8 })] }, { key: 'lb', failures: [F({ criterion: 'Other.' })] }], objectionId);
  assert.equal(out.find(o => o.id === id).severity, 8);
  assert.equal('severity' in out.find(o => o.key === 'lb'), false);
  const one = exchangeObjections([{ key: 'la', failures: [F({ severity: 'high' }), F({ severity: 4 })] }], objectionId);
  assert.equal(one[0].severity, 4, 'an unreadable copy never lowers or replaces a readable one');
  const posted = { posts: [], new_objections: [{ criterion: C, problem: 'A new one.', severity: 6 }, { criterion: 'X.', problem: 'Another.', severity: 'bad' }, { criterion: 'Y.', problem: 'Third.' }] };
  const { news, proposed } = readPosts(posted, { shown: [], draft: 'd', severity: true });
  assert.deepEqual(news.map(n => n.severity), [6]);
  assert.deepEqual(proposed.map(n => [n.problem, n.why]), [['Another.', 'no_valid_rating'], ['Third.', 'no_valid_rating']], 'a new objection with no readable severity is PROPOSED, with its reason (NEW-F4-1)');
  assert.deepEqual(readPosts(posted, { shown: [], draft: 'd' }).news.map(n => n.severity), [undefined, undefined, undefined], 'without the option: a volunteered tag in a post is dropped too');
  assert.equal(news.length, 1, 'with the rating demand in force only a defect with a readable severity becomes an objection; the others are proposed and mint no id');
  assert.equal(readPosts(posted, { shown: [], draft: 'd' }).news.length, 3, 'without the option a new objection is KEPT (nobody was asked to rate; a failure a judge raised is never dropped for lacking a tag)');
});

// CHANGED ACCEPTED (0.8.4 S19, then S19 (b) NEW-F4-1). OLD: with `severity: { enabled: true }` the exchange-born objection (a defect a mock-exch-new judge names in its post) carried NO severity and was kept, asserted as 'a new objection that gave none carries none'. NEW: the chain is layered with no key and DEMAND injected; the poster is a judge WITHOUT a `-sev` suffix, so the mock rates its post defect 5 and the rated defect is minted as before (born.severity is 5; eb's own blind rating is the mock's default 5, not the 9 of the old suffix); a defect with no valid rating is now PROPOSED and mints nothing (FEATURE_SPECS l.267; row NEW-F4-1), which test/new-objection-proposed.test.js pins. The held half is added: with NO_DEMAND no row carries a severity and the exchange still names the new objection. WHY: no switch; NEW-F4-1. RED ON OLD SRC: with no key the old parser drops the volunteered tags, so the first assertion to fail is the ea row's severity 6.5 (undefined).

test('the exchange rows in layer_debates carry the severity of each objection, exchange-born ones included; with the demand held none carries one', async () => {
  const cfg = cfgOf([seat('mock-exch-support-keep-sev6p5', 'ea', 1), seat('mock-exch-new-keep', 'eb', 1), seat('mock-critic-x', 'ec', 2)]);
  const { r } = await go(cfg);
  const rows = r.layerDebates[0].objections;
  assert.equal(rows.find(o => o.raised_by === 'ea' && !o.from_exchange).severity, 6.5);
  assert.equal(rows.find(o => o.raised_by === 'eb' && !o.from_exchange).severity, 5, 'a judge with no suffix writes the mock\'s default rating under the demand');
  const born = rows.find(o => o.from_exchange);
  assert.ok(born, 'the judge that posts "new" names one new objection');
  assert.equal(born.severity, 5, 'the defect named in a post carries the rating the post prompt asked for (the mock writes 5 once the prompt demands one; one with no valid rating would be PROPOSED, test/new-objection-proposed.test.js)');
  // the demand held: nobody is asked to rate, the tags the judges volunteer are dropped, and the exchange-born objection (it gave none) carries none: held later, never defaulted
  setHeldForTest(NO_DEMAND);
  const held = await go(JSON.parse(JSON.stringify(cfg)));
  const heldRows = held.r.layerDebates[0].objections;
  assert.ok(heldRows.some(o => o.from_exchange), 'the exchange still names the new objection');
  assert.deepEqual(heldRows.filter(o => 'severity' in o), [], 'demand held: no row carries a severity');
});

test('source scan: the sustained-objection adoption in chain.js (not live under the ladder) copies the severity too', () => {
  const src = readFileSync(join(root, 'src', 'chain.js'), 'utf8');
  const at = src.indexOf('adoptedNow.push({'); assert.notEqual(at, -1);
  assert.match(src.slice(at, at + 400), /severity/);
});

// CHANGED ACCEPTED (0.8.4 S19). OLD: the run carried `severity: { enabled: true }`; validate() also accepts a report with no severity section, so the test could pass on a record with no ratings at all. NEW: no key, DEMAND injected; it asserts the section is written and that a rating reaches signoff[] before validating, and adds the held half (NO_DEMAND: the section is still written on the layered chain, with unrated lines only, and validates). WHY: the section is written on every layered unanimous chain. RED ON OLD SRC: with no key the old src wrote no section and no ratings (shape.severity is undefined).
test('report schema: `severity` is declared on the objection (number or null, never required) and `layer_debates` is declared; a report with the field validates, and so does the report of a layered chain whose demand is held (unrated lines only)', async () => {
  const schema = JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'));
  const obj = schema.$defs?.objection || schema.definitions?.objection;
  assert.ok(obj, 'the objection definition exists');
  assert.ok(obj.properties.severity, 'severity declared'); assert.equal((obj.required || []).includes('severity'), false);
  assert.ok(schema.properties.layer_debates, 'layer_debates declared (it was written and never declared)'); assert.equal(schema.required.includes('layer_debates'), false);
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true }); ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
  const validate = ajv.compile(schema);
  const cfg = cfgOf([seat('mock-exch-support-keep-sev6p5', 'ea', 1), seat('mock-exch-support-keep-sev9', 'eb', 1), seat('mock-critic-x', 'ec', 2)]);
  const { r } = await go(cfg);
  const shape = reportJsonShape({ runId: 'r-sev', chain: 'severity-test', task: 'task.md', result: r, config: cfg });
  assert.ok(shape.layer_debates.length > 0);
  assert.ok(shape.severity, 'a layered unanimous chain writes the severity section');
  assert.ok(shape.signoff.flatMap(s => s.objections || []).some(o => typeof o.severity === 'number'), 'and the ratings the judges gave reach signoff[] (without this the test would pass on a record that had none)');
  assert.equal(validate(shape), true, JSON.stringify(validate.errors?.slice(0, 3)));
  for (const bad of ['high', 11, {}]) { const copy = JSON.parse(JSON.stringify(shape)); copy.signoff[0].objections[0].severity = bad; assert.equal(validate(copy), false, `severity ${JSON.stringify(bad)} is not valid`); }
  // the demand held: the layered chain still records (the section is written, unrated), and the report still validates
  setHeldForTest(NO_DEMAND);
  const held = await go(JSON.parse(JSON.stringify(cfg)));
  const heldShape = reportJsonShape({ runId: 'r-sev', chain: 'severity-test', task: 'task.md', result: held.r, config: cfg });
  assert.ok(heldShape.severity, 'held: the severity section is still written on a layered unanimous chain');
  assert.equal(heldShape.signoff.flatMap(s => s.objections || []).some(o => 'severity' in o), false, 'held: no objection carries a tag');
  assert.equal(validate(heldShape), true, JSON.stringify(validate.errors?.slice(0, 3)));
});

// CHANGED ACCEPTED (0.8.4 S19; C&C's ruling 04 Nov 2026: the lint is REMOVED). OLD: `lintSeverityChain` (src/severity.js) ran only with `severity: { enabled: true }` and refused a chain with a one-seat layer (`severity-one-seat-layer`, "layer N has a single seat ..."); the test asserted that refusal on layered([2, 1, 2]) and layered([1, 2, 2]), and that 4/3/2 and 2/2 were clean. NEW: a layered unanimous chain with a layer of ONE seat is VALID and loads: no finding about ratings or seats comes back for [4, 3, 2], [2, 2], [2, 1, 2], [1, 2, 2] or [1, 1, 1], and the removed kind never appears. WHY: the copy declares a one-seat layer valid - FEATURE_SPECS l.292 (Q4(d)): "A layer of one seat follows Q3: no exchange, sign-off by F2", row NEW-A2-1 ("a layer of one seat whose judge answered; expect no re-ask and no stop"), RU-ADD-A2 / RU-S3-70 - and S19 (l.758-882) names no seat minimum; the lint was written for the experimental switch and never shipped. RED ON THE TREE THAT HAS THE LINT (the committed S19 (a) src with the lint): layered([2, 1, 2]) returns `severity-one-seat-layer`, so the first one-seat assertion fails.
test('lint: a layered unanimous chain with a layer of ONE seat loads - there is no finding about ratings or seats (the copy: a layer of one seat follows Q3, no exchange, sign-off by F2)', () => {
  const kinds = c => lintChain(c, 'chains/fixture.json').map(f => f.kind);
  const layered = (counts, extra = {}) => cfgOf(counts.flatMap((n, i) => Array.from({ length: n }, (_, k) => seat('mock-critic-a', `l${i + 1}s${k}`, i + 1))), extra);
  for (const counts of [[4, 3, 2], [2, 2], [2, 1, 2], [1, 2, 2], [1, 1, 1]]) {
    assert.deepEqual(kinds(layered(counts)).filter(k => /severity|seat/.test(k)), [], `layers ${JSON.stringify(counts)}`);
  }
  assert.equal(kinds(layered([2, 1, 2])).includes('severity-one-seat-layer'), false, 'the removed kind never appears');
  assert.deepEqual(kinds(cfgOf([seat('mock-critic-a', 'a')])).filter(k => /severity/.test(k)), [], 'an unlayered panel of one');
});
