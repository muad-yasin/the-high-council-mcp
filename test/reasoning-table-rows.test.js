// 0.8.3 (C&C ruling 23 Oct 2026, step (g)): the reasoning-table refresh NEVER drops a row. The README promises the high default "for any model the table has a field for", and a user's own chain may seat
// any model with a row, so a row that no shipped chain seats (its model sits only in chains/outdated/) or whose id left OpenRouter's list stays. src/table-rows.js builds the OpenRouter rows from a
// list, with no file read and no network, so this drives it with a small list. $0, offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenRouterRows } from '../src/table-rows.js';

const model = (id, { max = 100000, ctx, params = ['reasoning'], efforts = ['high', 'low'], def = 'high', mandatory = false } = {}) => ({ id, supported_parameters: params, reasoning: { supported_efforts: efforts, default_effort: def, mandatory }, top_provider: { max_completion_tokens: max }, ...(ctx === undefined ? {} : { context_length: ctx }) });
const byId = new Map([model('a/seated'), model('a/unseated', { max: 777 }), model('a/plain', { params: [], efforts: null, def: null })].map(m => [m.id, m]));
const old = { form: 'openrouter-effort', maxOutput: 5, defaultEffort: 'low', supportedEfforts: ['low'], mandatory: false, source: 'openrouter-models' };
const run = (extra = {}) => buildOpenRouterRows({ ids: new Set(['a/seated']), byId, previous: { 'a/unseated': old, 'a/gone': { ...old, maxOutput: 42 } }, asOf: '2026-10-23', ...extra });

test('TR-1 a row no shipped chain seats stays and is refreshed from the list (it used to be dropped)', () => {
  const { rows } = run();
  assert.ok('openrouter/a/unseated' in rows, 'the unseated row is still there');
  assert.equal(rows['openrouter/a/unseated'].maxOutput, 777, 'refreshed from the router list, not left at 5');
  assert.equal(rows['openrouter/a/unseated'].defaultEffort, 'high');
});

test('TR-2 a row whose id left the list keeps its last numbers with a dated note, and keeps the FIRST date', () => {
  const first = run();
  const row = first.rows['openrouter/a/gone'];
  assert.ok(row, 'the row for the id that left the list is kept');
  assert.equal(row.maxOutput, 42); assert.equal(row.form, 'openrouter-effort');
  assert.match(row.notOnRouter, /not in OpenRouter's public list on 2026-10-23/);
  assert.deepEqual(first.keptOffList, ['a/gone']);
  const again = buildOpenRouterRows({ ids: new Set(), byId, previous: { 'a/gone': row }, asOf: '2026-12-01' });
  assert.match(again.rows['openrouter/a/gone'].notOnRouter, /on 2026-10-23/, 'the first date stays');
  assert.ok(!again.missing.includes('a/gone'), 'a kept row is not "missing"');
});

test('TR-3 an id with no earlier row that is seated and missing from the list is reported missing, with no row', () => {
  const r = buildOpenRouterRows({ ids: new Set(['a/seated', 'a/never-listed']), byId, previous: {}, asOf: '2026-10-23' });
  assert.deepEqual(r.missing, ['a/never-listed']);
  assert.ok(!('openrouter/a/never-listed' in r.rows));
});

test('TR-4 no earlier row is ever lost: every previous id is in the result', () => {
  const { rows } = run();
  for (const id of ['a/unseated', 'a/gone']) assert.ok(`openrouter/${id}` in rows, id);
});

test('TR-5 the lab limit wins over the router number, for a listed id and for a kept one', () => {
  const { rows } = run({ labLimits: { 'a/seated': 131072, 'a/gone': 131072 } });
  assert.ok(rows['openrouter/a/seated'] && rows['openrouter/a/gone'], 'both rows exist');
  assert.equal(rows['openrouter/a/seated'].maxOutput, 131072);
  assert.equal(rows['openrouter/a/gone'].maxOutput, 131072);
  assert.equal(run().rows['openrouter/a/seated'].maxOutput, 100000, 'without the map: the router number');
});

test('TR-6 a model that takes no reasoning gets form null and no efforts', () => {
  const r = buildOpenRouterRows({ ids: new Set(['a/plain']), byId, previous: {}, asOf: '2026-10-23' });
  assert.equal(r.rows['openrouter/a/plain'].form, null);
  assert.equal(r.rows['openrouter/a/plain'].supportedEfforts, null);
});

const NOTE = 'no output limit found on example.org/docs; read 2026-10-23';
test('TR-7 a model whose lab pages state no limit gets maxOutput null and its dated note, never the router number (listed id and kept id); a number still lands; an id with no entry takes the router number', () => {
  const { rows } = run({ labLimits: { 'a/seated': { limit: null, note: NOTE }, 'a/gone': { limit: null, note: NOTE }, 'a/unseated': 4096 } });
  for (const id of ['a/seated', 'a/gone']) {
    assert.ok(rows[`openrouter/${id}`], id);
    assert.equal(rows[`openrouter/${id}`].maxOutput, null, `${id}: null, not the router's 100000 or the earlier 42`);
    assert.equal(rows[`openrouter/${id}`].maxOutputNote, NOTE, id);
  }
  assert.equal(rows['openrouter/a/unseated'].maxOutput, 4096, 'a number entry beside a null entry');
  assert.ok(!('maxOutputNote' in rows['openrouter/a/unseated']), 'a number entry carries no note');
  const becameNumber = buildOpenRouterRows({ ids: new Set(), byId, previous: { 'a/gone': rows['openrouter/a/gone'] }, asOf: '2026-12-01', labLimits: { 'a/gone': 65536 } }).rows['openrouter/a/gone'];
  assert.equal(becameNumber.maxOutput, 65536); assert.ok(!('maxOutputNote' in becameNumber), 'a kept row whose null became a number loses the old note');
  const plain = run().rows;
  assert.equal(plain['openrouter/a/seated'].maxOutput, 100000, 'no entry: the router number');
  assert.ok(!('maxOutputNote' in plain['openrouter/a/seated']));
});

test('TR-8 a malformed lab-limit entry is refused loudly (a bare null, a limit without a note, a non-number, a number with a blank note or a limit that is not a finite number)', () => {
  for (const bad of [null, { limit: null }, { limit: null, note: '  ' }, { limit: 5 }, { limit: 5, note: '  ' }, { limit: '5', note: NOTE }, { limit: Number.POSITIVE_INFINITY, note: NOTE }, 'x', Number.NaN]) {
    assert.throws(() => run({ labLimits: { 'a/seated': bad } }), /lab output limit for a\/seated must be a number, \{ limit: null/, JSON.stringify(bad));
  }
});

// 0.8.3 (the owner, 2026-10-24, via C&C): deepseek-v4-pro-0813 stays at 384,000 although the router declares 393,216 and DeepSeek publishes no limit. The figure is the owner's pick, not a lab figure, so it is a NUMBER WITH A NOTE.
test('TR-9 an owner\'s pick ({ limit: number, note }) lands as that number WITH its note, for a listed id and for a kept one, and a regeneration keeps it (the router number never comes back)', () => {
  const PICK = "the owner's pick (2026-10-24), not a lab figure";
  const labLimits = { 'a/seated': { limit: 384000, note: PICK }, 'a/gone': { limit: 384000, note: PICK } };
  const first = run({ labLimits }).rows;
  for (const id of ['a/seated', 'a/gone']) { assert.equal(first[`openrouter/${id}`].maxOutput, 384000, id); assert.equal(first[`openrouter/${id}`].maxOutputNote, PICK, id); }
  assert.notEqual(first['openrouter/a/seated'].maxOutput, 100000, 'not the router number');
  const again = buildOpenRouterRows({ ids: new Set(['a/seated']), byId, previous: { 'a/seated': first['openrouter/a/seated'], 'a/gone': first['openrouter/a/gone'] }, asOf: '2026-12-01', labLimits }).rows;
  assert.equal(again['openrouter/a/seated'].maxOutput, 384000, 'a second run keeps it'); assert.equal(again['openrouter/a/seated'].maxOutputNote, PICK);
  assert.equal(again['openrouter/a/gone'].maxOutput, 384000); assert.equal(again['openrouter/a/gone'].maxOutputNote, PICK);
  const dropped = buildOpenRouterRows({ ids: new Set(['a/seated']), byId, previous: { 'a/seated': first['openrouter/a/seated'] }, asOf: '2026-12-01', labLimits: {} }).rows['openrouter/a/seated'];
  assert.equal(dropped.maxOutput, 100000, 'with the entry removed the router number returns'); assert.ok(!('maxOutputNote' in dropped), 'and the owner\'s-pick note goes with it (not left on a router figure)');
});

// 0.8.3 (C&C, 2026-10-24): a router figure that is 0.9 x the context window is derived, not published; the build refuses it unless the id has a labLimits entry (the owner's rule of 2026-10-23; two table rows had landed that way).
test('TR-10 a router figure of 0.9 x context is refused unless the id has an entry; every entry form lets it through; an ordinary figure, a missing context length and an off-list row are not refused', () => {
  const withById = (m) => new Map(m.map(x => [x.id, x]));
  const build = (models, extra = {}) => buildOpenRouterRows({ ids: new Set(models.map(m => m.id)), byId: withById(models), previous: {}, asOf: '2026-10-24', ...extra });
  const floor = model('b/floor', { max: 235929, ctx: 262144 });          // floor(0.9 x 262144) = 235929 (235929.6)
  const round = model('b/round', { max: 943718, ctx: 1048576 });        // round(0.9 x 1048576) = 943718 (943718.4)
  assert.throws(() => build([floor]), /b\/floor; the table was not written/);
  assert.throws(() => build([round]), /b\/round; the table was not written/);
  assert.throws(() => build([floor, round]), /b\/floor, b\/round; the table was not written/, 'one throw naming every offender');
  assert.throws(() => build([model('b/up', { max: 235930, ctx: 262144 })]), /b\/up; the table was not written/, 'the figure one above the floor (a router that rounds up) is the same derived number');
  for (const entry of [235929, { limit: null, note: 'none found; read 2026-10-24' }, { limit: 131072, note: "the owner's pick (2026-10-24), not a lab figure" }]) {
    const rows = build([floor], { labLimits: { 'b/floor': entry } }).rows;
    assert.ok(rows['openrouter/b/floor'], JSON.stringify(entry));
  }
  assert.doesNotThrow(() => build([model('b/ordinary', { max: 131072, ctx: 262144 })]), 'an ordinary figure');
  assert.doesNotThrow(() => build([model('b/noctx', { max: 235929 })]), 'no context length: nothing to compare');
  assert.doesNotThrow(() => build([model('b/near', { max: 235931, ctx: 262144 })]), 'more than 1 away from 0.9 x context (235929.6): not derived');
  const kept = buildOpenRouterRows({ ids: new Set(), byId: new Map(), previous: { 'b/gone': { ...old, maxOutput: 235929 } }, asOf: '2026-10-24' });
  assert.equal(kept.rows['openrouter/b/gone'].maxOutput, 235929, 'an off-list row keeps its old number: the list gives no context length to check it with');
});
