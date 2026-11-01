// B3 prep, JUDGE lane, unit 2: severity PLUMBING (no blocking yet; that is unit 3). With the chain switch `severity: { enabled }` on: a judge's verdict whose objection carries no readable severity is an unreadable verdict (asked again, then unheard),
// never a default number; a readable severity survives every copy of an objection (the answer-back pair, the exchange's objections, rows and new objections, a sustained objection adopted by a higher layer); the report declares the field
// (and `layer_debates`, which it wrote without declaring); lint refuses the switch on a chain with a one-seat layer (fail closed: "one judge cannot hold the plan alone" cannot be honoured there). Off: nothing changes.
// The functions are read off the module namespaces on purpose: a missing export fails each test by name.
import test, { afterEach } from 'node:test';
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

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
afterEach(() => { setCache(null); setBudget(null); setPromptSpy(null); });
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
  // the failures the harness writes itself carry no severity, so with the switch on they are unreadable too
  const tableOnly = { meets: false, criteria: [{ criterion: C, verdict: 'FAILED', evidence: 'No assumptions.' }], failures: [], verdict_line: 'x' };
  assert.equal(normaliseCritique(tableOnly, () => {}, { severity: true }).unreadable, true, 'a FAILED table row the judge left out of its list');
  assert.equal(normaliseCritique({ meets: false, criteria: [], failures: [], verdict_line: 'no' }, () => {}, { severity: true }).unreadable, true, 'meets:false naming nothing');
  // a clean verdict has no failure to tag
  assert.equal(normaliseCritique({ meets: true, criteria: [], failures: [], verdict_line: 'ok' }, () => {}, { severity: true }).meets, true);
});

test('normaliseCritique without the option: a severity-less failure is an ordinary objection, and a severity a judge volunteers is DROPPED (a deliberate change from carrying it through: no switch-off record may carry one, so the published type of the field cannot be violated)', () => {
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

test('through a real run: a judge that tags 6.5 is heard and its objection carries 6.5 into signoff[]; a judge that gives none, or a worded tag, is unheard (never an objection and never a default); off, an untagged objection is an ordinary one', async () => {
  const on = { severity: { enabled: true } };
  const tagged = await go(cfgOf([seat('mock-exch-support-keep-sev6p5', 'ea'), seat('mock-exch-support-keep-sev9', 'eb')], on));
  const rowOf = (r, lab) => r.panelVerdicts.find(v => v.round === 1 && v.lab === lab);
  assert.equal(rowOf(tagged.r, 'ea').verdict, 'objected'); assert.equal(rowOf(tagged.r, 'eb').verdict, 'objected');
  const sev = lab => tagged.r.signoff.find(s => s.lab === lab).objections.map(o => o.severity);
  assert.deepEqual(sev('ea'), [6.5]); assert.deepEqual(sev('eb'), [9]);
  for (const model of ['mock-exch-support-keep-sevnone', 'mock-exch-support-keep-sevword']) {
    const g = await go(cfgOf([seat(model, 'ea'), seat('mock-exch-support-keep-sev9', 'eb')], on));
    assert.equal(rowOf(g.r, 'ea').verdict, 'unheard', `${model}: unreadable after the re-ask`);
    // (a seat is asked again only when its answer could decide the pass, the rule that was there before: here the other judge objects, so there is no re-ask to count; the verdict is unheard and never an objection)
    assert.deepEqual(g.r.signoff.find(x => x.lab === 'ea')?.objections ?? [], [], `${model}: nothing from the unreadable verdict reaches the record as an objection`);
    assert.equal(rowOf(g.r, 'eb').verdict, 'objected');
  }
  const off = await go(cfgOf([seat('mock-exch-support-keep-sevnone', 'ea'), seat('mock-exch-support-keep-sev9', 'eb')]));
  assert.equal(rowOf(off.r, 'ea').verdict, 'objected', 'switch off: no severity is asked for or required');
  const offJudges = await go(cfgOf([seat('mock-exch-support-keep-sev6p5', 'ea', 1), seat('mock-exch-new-keep-sev9', 'eb', 1), seat('mock-critic-x', 'ec', 2)], { layer_debate: { enabled: true } }));
  assert.deepEqual(offJudges.r.signoff.flatMap(s => s.objections || []).filter(o => 'severity' in o), [], 'switch off: judges that volunteer a tag leave none in signoff[]');
  assert.deepEqual(offJudges.r.layerDebates.flatMap(d => d.objections).filter(o => 'severity' in o), [], 'switch off: none in layer_debates');
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
  const { news } = readPosts(posted, { shown: [], draft: 'd', severity: true });
  assert.deepEqual(news.map(n => n.severity), [6, undefined, undefined]);
  assert.deepEqual(readPosts(posted, { shown: [], draft: 'd' }).news.map(n => n.severity), [undefined, undefined, undefined], 'switch off: a volunteered tag in a post is dropped too');
  assert.equal(news.length, 3, 'a new objection without a readable severity is KEPT (a failure a judge raised is never dropped for lacking a tag)');
});

test('the exchange rows in layer_debates carry the severity of each objection, exchange-born ones included', async () => {
  const cfg = cfgOf([seat('mock-exch-support-keep-sev6p5', 'ea', 1), seat('mock-exch-new-keep-sev9', 'eb', 1), seat('mock-critic-x', 'ec', 2)], { layer_debate: { enabled: true }, severity: { enabled: true } });
  const { r } = await go(cfg);
  const rows = r.layerDebates[0].objections;
  assert.equal(rows.find(o => o.raised_by === 'ea' && !o.from_exchange).severity, 6.5);
  assert.equal(rows.find(o => o.raised_by === 'eb' && !o.from_exchange).severity, 9);
  const born = rows.find(o => o.from_exchange);
  assert.ok(born, 'the judge that posts "new" names one new objection');
  assert.equal('severity' in born, false, 'a new objection that gave none carries none (held later, never defaulted)');
});

test('source scan: the sustained-objection adoption in chain.js (not live under the ladder) copies the severity too', () => {
  const src = readFileSync(join(root, 'src', 'chain.js'), 'utf8');
  const at = src.indexOf('adoptedNow.push({'); assert.notEqual(at, -1);
  assert.match(src.slice(at, at + 400), /severity/);
});

test('report schema: `severity` is declared on the objection (number or null, never required) and `layer_debates` is declared; a report with the field validates', async () => {
  const schema = JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'));
  const obj = schema.$defs?.objection || schema.definitions?.objection;
  assert.ok(obj, 'the objection definition exists');
  assert.ok(obj.properties.severity, 'severity declared'); assert.equal((obj.required || []).includes('severity'), false);
  assert.ok(schema.properties.layer_debates, 'layer_debates declared (it was written and never declared)'); assert.equal(schema.required.includes('layer_debates'), false);
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true }); ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
  const validate = ajv.compile(schema);
  const cfg = cfgOf([seat('mock-exch-support-keep-sev6p5', 'ea', 1), seat('mock-exch-support-keep-sev9', 'eb', 1), seat('mock-critic-x', 'ec', 2)], { layer_debate: { enabled: true }, severity: { enabled: true } });
  const { r } = await go(cfg);
  const shape = reportJsonShape({ runId: 'r-sev', chain: 'severity-test', task: 'task.md', result: r, config: cfg });
  assert.ok(shape.layer_debates.length > 0);
  assert.equal(validate(shape), true, JSON.stringify(validate.errors?.slice(0, 3)));
  for (const bad of ['high', 11, {}]) { const copy = JSON.parse(JSON.stringify(shape)); copy.signoff[0].objections[0].severity = bad; assert.equal(validate(copy), false, `severity ${JSON.stringify(bad)} is not valid`); }
});

test('lint: the switch is refused on a chain with a one-seat layer (fail closed), accepted on 4/3/2 and on an unlayered panel of two or more; off, never refused', () => {
  const kinds = c => lintChain(c, 'chains/fixture.json').map(f => f.kind);
  const on = { severity: { enabled: true } };
  const layered = (counts, extra = on) => cfgOf(counts.flatMap((n, i) => Array.from({ length: n }, (_, k) => seat('mock-critic-a', `l${i + 1}s${k}`, i + 1))), extra);
  assert.deepEqual(kinds(layered([4, 3, 2])).filter(k => /severity/.test(k)), []);
  assert.ok(kinds(layered([2, 1, 2])).includes('severity-one-seat-layer'));
  assert.ok(kinds(layered([1, 2, 2])).includes('severity-one-seat-layer'));
  assert.deepEqual(kinds(layered([2, 1, 2], {})).filter(k => /severity/.test(k)), [], 'off: never refused');
  assert.deepEqual(kinds(cfgOf([seat('mock-critic-a', 'a'), seat('mock-critic-b', 'b')], on)).filter(k => /severity/.test(k)), []);
  assert.ok(kinds(cfgOf([seat('mock-critic-a', 'a')], on)).includes('severity-one-seat-layer'), 'an unlayered panel of one is a one-seat layer too');
});
