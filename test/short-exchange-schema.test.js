// 0.8.4 S6 (M1), U6-2: the record fields of the shortened exchange are declared in schemas/report-v1.json (additive, schemaVersion 1): a real run with the pair recorded validates and carries `signoffs`, and the schema is not vacuous for it
// (a value outside an enum, or a missing key, is rejected). Offline, mock seats only, $0. WRITTEN WITHOUT A RUN (overnight, no box). Same method as the layer_debates rows of test/report-schema.test.js.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { runChain, setCache, setBudget, setPromptSpy } from '../src/chain.js';
import { reportJsonShape } from '../src/report-shape.js';
import { setHeldForTest } from '../src/held-roles.js';
import * as HB084 from './held-prompts/held-084-b.js';

afterEach(() => { setCache(null); setBudget(null); setPromptSpy(null); setHeldForTest(null); });
const schema = JSON.parse(readFileSync(new URL('../schemas/report-v1.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
const validate = ajv.compile(schema);
const PAIR = { shortExchangeRule: HB084.shortExchangeRule, signoffLineRule: HB084.signoffLineRule };

async function reportOf(critics) {
  setHeldForTest(PAIR);
  const config = { name: 'schema-short-exchange', maxRounds: 1, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' },
      critics: critics.map(([model, lab, layer]) => ({ provider: 'mock', model, lab, layer })) } };
  const result = await runChain({ config, request: 'A mock task.', log: () => {} });
  return JSON.parse(JSON.stringify(reportJsonShape({ runId: 'schema-short-exchange', chain: config.name, task: 'tasks/t.md', result, config })));
}
const withLine = () => reportOf([['mock-exch-support-keep-clean', 'l1', 1], ['mock-exch-support-keep-clean', 'l2', 2], ['mock-exch-support-withdraw-signoffyes', 'r3', 3], ['mock-exch-support-keep-clean', 'q3', 3]]);

test('report schema (S6): a layer_debates row of the shortened exchange carries signoffs and validates', async () => {
  const report = await withLine();
  const row = report.layer_debates.find(d => d.layer === 3);
  assert.deepEqual(row.signoffs.map(s => [s.seat, s.line, s.said, s.computed]), [['r3', 'yes', 'yes', 'signs']], 'the premise: the row carries the record');
  assert.equal(validate(report), true, JSON.stringify((validate.errors || []).slice(0, 3)));
});
test('report schema (S6): a sign-off word outside its enum, a computed word outside its enum, or a missing key is rejected (known-bad input)', async () => {
  for (const [what, mutate] of [
    ['line', r => { r.layer_debates.find(d => d.layer === 3).signoffs[0].line = 'shrugged'; }],
    ['field', r => { r.layer_debates.find(d => d.layer === 3).signoffs[0].field = 'perhaps'; }],
    ['computed', r => { r.layer_debates.find(d => d.layer === 3).signoffs[0].computed = 'maybe'; }],
    ['said', r => { r.layer_debates.find(d => d.layer === 3).signoffs[0].said = 'maybe'; }],
    ['missing key', r => { delete r.layer_debates.find(d => d.layer === 3).signoffs[0].differs; }],
  ]) {
    const report = await withLine();
    mutate(report);
    assert.equal(validate(report), false, `${what}: rejected`);
  }
});
test('report schema (S6): the not_run row of an upper layer that cannot run the exchange validates (the same shape as layer 1\'s)', async () => {
  const report = await reportOf([['mock-exch-support-keep-clean', 'l1', 1], ['mock-exch-support-keep', 'r2', 2], ['mock-exch-support-keep-clean', 't3', 3]]);
  const row = report.layer_debates.find(d => d.layer === 2);
  assert.deepEqual([row.not_run, row.objections.map(o => o.outcome)], ['fewer_than_two_heard', ['not_debated']], 'the premise');
  assert.equal(validate(report), true, JSON.stringify((validate.errors || []).slice(0, 3)));
});
