// The cost unit's first, fail-closed step (cost-unit gate page U1, 14 Oct 2026; audit item 2 of 13 Oct): a spend figure that is not a finite number >= 0 refuses, it never reads as "fits".
//   wouldBreach: `NaN > cap` is false, so a NaN projection used to be ADMITTED and made `reserved` NaN for the rest of the sitting (the cap was off); smallestCapThatPasses / formatUsd on such a figure said "$NaN" or threw;
//   priceOf: a price row that is not two finite numbers >= 0 is UNUSABLE (the seat reads as unpriced and a cap refuses it), named by the doctor and the dry run, never skipped and never 0.
// $0: pure functions, a copy of src/ with one broken pricing row, and the chain's own cap check on a mock seat with fixture prices. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { wouldBreach, smallestCapThatPasses, formatUsd, worstCaseOf } from '../src/cost.js';
import { setBudget, runSingleStage, BudgetExceeded } from '../src/chain.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('CF-1 wouldBreach fails closed on a spent or projected figure that is not a finite number >= 0 (known-bad: NaN used to read as "fits"); real figures and "no ceiling" are unchanged', () => {
  for (const [label, args] of [['NaN projected', { spent: 1, cap: 5, projected: NaN }], ['NaN spent', { spent: NaN, cap: 5, projected: 1 }], ['Infinity projected', { spent: 0, cap: 5, projected: Infinity }], ['negative projected', { spent: 1, cap: 5, projected: -2 }], ['string projected', { spent: 1, cap: 5, projected: '0.5' }]]) {
    const v = wouldBreach(args);
    assert.equal(v.breach, true, `${label}: ${JSON.stringify(v)}`); assert.equal(v.unbounded, true, label); assert.equal(v.remaining, 0, label);
  }
  assert.equal(wouldBreach({ spent: 1, cap: 5, projected: 3 }).breach, false, 'control: a figure that fits');
  assert.equal(wouldBreach({ spent: 1, cap: 5, projected: 4.5 }).breach, true, 'control: a figure that does not');
  assert.equal(wouldBreach({ spent: 1, cap: null, projected: NaN }).breach, false, 'no ceiling stays no ceiling (the typed cap work removes `none`; this unit does not)');
});

test('CF-2 smallestCapThatPasses names no figure for an unbounded call (NaN), and formatUsd says "an unknown amount" instead of "$NaN" or throwing; real figures format as before', () => {
  assert.ok(Number.isNaN(smallestCapThatPasses(1, NaN)) && Number.isNaN(smallestCapThatPasses(NaN, 1)) && Number.isNaN(smallestCapThatPasses(0, Infinity)));
  assert.equal(smallestCapThatPasses(1, 0.5), 1.5, 'control');
  for (const bad of [NaN, null, undefined, Infinity, '3']) assert.equal(formatUsd(bad), 'an unknown amount', String(bad));
  assert.equal(formatUsd(1.5), '$1.50'); assert.equal(formatUsd(0.5), '$0.5000');
});

test('CF-3 the chain\'s own cap check refuses a call whose projection is NaN (a seat with a non-numeric maxTokens), BEFORE anything is sent; known-bad: it was admitted', async () => {
  const seat = { provider: 'mock', model: 'mock-priced', maxTokens: NaN };
  assert.ok(Number.isNaN(worstCaseOf(seat.provider, seat.model, { promptChars: 40, maxTokens: seat.maxTokens }).usd), 'fixture: the projection really is NaN');
  setBudget(1000);
  try {
    await assert.rejects(runSingleStage(seat, { system: 's', user: 'a prompt', label: 'cf3' }), err => err instanceof BudgetExceeded && err.label === 'cf3');
  } finally { setBudget(null); }
});

test('CF-4 a price row that is not two finite numbers >= 0 is UNUSABLE: the seat reads as unpriced (a cap refuses it), the error says the row cannot be used, the doctor and the dry run name it (a copy of src/ with one broken row)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-cf4-'));
  cpSync(join(root, 'src'), join(dir, 'src'), { recursive: true }); cpSync(join(root, 'package.json'), join(dir, 'package.json'));
  symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'));
  const table = JSON.parse(readFileSync(join(dir, 'src', 'pricing.json'), 'utf8'));
  const key = Object.keys(table).find(k => /^openrouter\//.test(k) && typeof table[k]?.in === 'number');
  const good = table[key]; table[key] = { in: good.in };                       // `out` removed: worstCaseOf was NaN for it
  writeFileSync(join(dir, 'src', 'pricing.json'), JSON.stringify(table));
  const [provider, ...rest] = key.split('/'); const model = rest.join('/');
  const copy = name => import(pathToFileURL(join(dir, 'src', name)).href);
  const cost = await copy('cost.js'); const unpriced = await copy('unpriced.js'); const errors = await copy('errors.js');
  assert.equal(cost.priceOf(provider, model), null, 'the row is not a price');
  assert.equal(cost.priceProblemOf(provider, model), 'unusable'); assert.equal(cost.priceProblemOf(provider, 'not-a-model-at-all'), 'missing', 'control: no row at all is `missing`');
  assert.deepEqual(cost.unusablePriceRows().map(r => r.key), [key]);
  assert.equal(cost.worstCaseOf(provider, model, { promptChars: 400, maxTokens: 1000 }).usd, 0, 'not NaN: an unpriced seat projects 0 and a cap refuses it before anything is sent');
  assert.equal(cost.needsPrice({ provider, model }), true);
  const config = { seats: { criteria: { provider, model }, builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' }, critics: [{ provider: 'mock', model: 'mock-critic-a', lab: 'a' }] } };
  const found = unpriced.unpricedSeats(config);
  assert.deepEqual(found.map(f => [f.provider, f.model, f.problem]), [[provider, model, 'unusable']]);
  const text = errors.formatCouncilError('COUNCIL-E002', { provider, model, problem: found[0].problem, roles: found[0].roles, capUsd: 5 });
  assert.match(text, /has an entry in src\/pricing\.json, but its price cannot be used/); assert.match(text, /Nothing was sent and nothing was spent/);
  assert.doesNotMatch(errors.formatCouncilError('COUNCIL-E002', { provider, model, problem: 'missing', capUsd: 5 }), /cannot be used/, 'control: a missing row keeps its own sentence');
  assert.ok(cost.priceTableLines(new Date(), table).some(l => l.startsWith(`WARNING: price row ${key} has a price that cannot be used`)), 'doctor / dry run name the row');
  assert.match(readFileSync(join(root, 'src', 'cli.js'), 'utf8'), /COUNCIL-E002', \{ provider: u\.provider, model: u\.model, problem: u\.problem,/, 'the run start passes the problem on (a source scan: the sentence above is only reached through it)');
  const cliSrc = readFileSync(join(root, 'src', 'cli.js'), 'utf8');
  const sites = cliSrc.split('\n').filter(l => l.includes("formatCouncilError('COUNCIL-E002'"));
  assert.ok(sites.length >= 7 && sites.every(l => l.includes('problem:')), `every refusal of an unpriced seat passes the problem on (${sites.length} sites): ${sites.filter(l => !l.includes('problem:')).map(l => l.trim().slice(0, 80)).join(' | ')}`);
});
