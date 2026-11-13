// 0.8.4 unit 6 (D11; plan A T6.6, Mini-C&C R393/R394): every paid call's record, and every reservation never settled, contributes its amount ONCE to the totals a person reads: the spend total (`runSpentUsd`, what `--spend`, the spend report and run_status read)
// and the count-once figure of the folder (src/counted-spend.js: totals.counted, the stop screens' floor). Offline, $0, hand-built run folders: this file tests the READER, the real verbs are in test/counted-floor.test.js.
// The plan's fixture holds five $1.00 charges: (i) a superseded stage's usage, (ii) a settled reservation with its usage file, (iii) an unsettled reservation, (iv) a paid usage file whose label the resumed sitting never asks again, (v) a replayed stage - written
// twice, once with a reservation id and once without (as a file from before 0.8.3 is). Variants add the defects the trace found: a reservation a usage file carries (counted twice), a settled call with no file (counted nowhere), and the waste/billed pair that shares one id.
// A test that passes on the old source is named: the base case already counted five (a PIN of "the five charges are five", not of the fix).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSpentUsd } from '../src/spend.js';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: got ${a}, expected ${b}`);
// ONE reader: the spend total (`--spend`, run_status, the floor) and the count-once figure of the folder (totals.counted) are the same number. On the old source the module is missing: red by import, named.
async function once(d, expected, msg) {
  near(runSpentUsd(d), expected, `${msg}: the spend total`);
  const { countedSummaryOf } = await import('../src/counted-spend.js');
  near(countedSummaryOf(d)?.usd ?? 0, expected, `${msg}: the count-once figure`);
}
const folder = () => { const d = mkdtempSync(join(tmpdir(), 'thc-count-once-')); mkdirSync(join(d, 'superseded')); return d; };
const usage = (d, rel, o) => writeFileSync(join(d, rel), JSON.stringify({ provider: 'openrouter', model: 'x/y', usage: { input: 1, output: 1 }, usd: 1, ...o }));
const reservations = (d, lines) => writeFileSync(join(d, 'spend-reservations.jsonl'), lines.map(l => JSON.stringify({ schema: 'spend-reservations/1', at: '2026-11-04T10:00:00.000Z', ...l })).join('\n') + '\n');
const reserved = (id, label, usd, extra = {}) => ({ event: 'reserved', id, label, seat: 'openrouter/x/y', usd, ...extra });
const settled = (id, outcome, usd, extra = {}) => ({ event: 'settled', id, outcome, usd, ...extra });

// the five charges of the plan, written as a run folder would hold them
function planFixture(d, { withIdOnReplay = true } = {}) {
  usage(d, 'superseded/a-stage.1.usage.json', { basis: 'token_priced' });                                       // (i)
  usage(d, 'b-stage.usage.json', { reservationId: 'r1', basis: 'token_priced' });                               // (ii)
  usage(d, 'd-stage.usage.json', { basis: 'token_priced' });                                                    // (iv) a label the resumed sitting never asks again
  usage(d, 'e-stage.usage.json', { ...(withIdOnReplay ? { reservationId: 'r3' } : {}), basis: 'token_priced' }); // (v) a replayed stage: its record is read back, never written twice
  reservations(d, [reserved('r1', 'b-stage', 1), settled('r1', 'recorded', 1, { basis: 'token_priced' }), reserved('r2', 'c-stage', 1), reserved('r3', 'e-stage', 1), settled('r3', 'recorded', 1, { basis: 'token_priced' })]);   // (iii) r2 is never settled
}

test('the five charges of the plan are five dollars, with and without a reservation id on the replayed record (PIN: the old source also counts five here; it is the base the variants below move)', async () => {
  for (const withId of [true, false]) {
    const d = folder(); planFixture(d, { withIdOnReplay: withId });
    await once(d, 5, `spend total, replayed record ${withId ? 'with' : 'without'} a reservation id`);
  }
});

test('the count-once figure of the folder (src/counted-spend.js) is the same five dollars and says which part is an estimate', async () => {
  const { countedSummaryOf } = await import('../src/counted-spend.js');
  for (const withId of [true, false]) {
    const d = folder(); planFixture(d, { withIdOnReplay: withId });
    const c = countedSummaryOf(d);
    near(c.usd, 5, `counted.usd, replayed record ${withId ? 'with' : 'without'} an id`);
    near(c.estimatedUsd, 1, 'the unsettled reservation (case iii) is the one estimate');
    near(c.bases.token_priced, 4, 'four token-priced charges'); near(c.bases.reserved_unsettled, 1, 'one reserved_unsettled');
  }
});

test('a settled call whose usage file was never written (the process ended between the settle line and the file) is counted, at the settled figure and never at a waste part: the old source counted nothing', async () => {
  const d = folder(); planFixture(d);
  reservations(d, [reserved('r1', 'b-stage', 1), settled('r1', 'recorded', 1), reserved('r2', 'c-stage', 1), reserved('r3', 'e-stage', 1), settled('r3', 'recorded', 1), reserved('r5', 'g-stage', 2), settled('r5', 'recorded', 0.7, { basis: 'token_priced' })]);
  await once(d, 5.7, 'the settled 0.70 with no file is in the total');
});

test('a record written without a reservation id stands for the settled line of its label: it is not counted as a call with no file (a hand-built or older folder)', async () => {
  const d = folder(); planFixture(d);
  usage(d, 'h-stage.usage.json', { usd: 0.3 });   // no reservationId
  reservations(d, [reserved('r1', 'b-stage', 1), settled('r1', 'recorded', 1), reserved('r2', 'c-stage', 1), reserved('r3', 'e-stage', 1), settled('r3', 'recorded', 1), reserved('r6', 'h-stage', 0.3), settled('r6', 'recorded', 0.3)]);
  await once(d, 5.3, 'the 0.30 is counted once');
});

test('a discarded thinking attempt\'s waste charge and the call\'s billed charge SHARE one reservation id and are different amounts: both are counted (PIN: the old source also counts both; the new reader must not merge files by id)', async () => {
  const d = folder();
  usage(d, 'superseded/k.charge-1.usage.json', { usd: 0.2, kind: 'waste', reservationId: 'r7', basis: 'token_priced' });
  usage(d, 'superseded/k.charge-2.usage.json', { usd: 0.5, kind: 'billed', reservationId: 'r7', basis: 'typical_error' });
  reservations(d, [reserved('r7', 'k', 1), settled('r7', 'billed_unreadable', 0.5, { basis: 'typical_error' })]);
  await once(d, 0.7, 'spend total');
});

test('a waste charge alone does not mark its call as carried: the settled billed part with no billed file is counted beside it', async () => {
  const { countedSummaryOf } = await import('../src/counted-spend.js');
  const d = folder();
  usage(d, 'superseded/k.charge-1.usage.json', { usd: 0.2, kind: 'waste', reservationId: 'r7', basis: 'token_priced' });
  reservations(d, [reserved('r7', 'k', 1), settled('r7', 'billed_unreadable', 0.5, { basis: 'typical_error' })]);
  const c = countedSummaryOf(d);
  near(c.usd, 0.7, 'waste 0.20 from its file + billed 0.50 from the settled line');
  near(c.estimatedUsd, 0.5, 'the settled billed part is a typical cost');
});

test('a fallback reservation that stands for a call whose record could not be written counts the call once: the settled line it names is not counted again', async () => {
  const { countedSummaryOf } = await import('../src/counted-spend.js');
  const d = folder();
  reservations(d, [reserved('r1', 'handoff-from-run', 0.4), settled('r1', 'recorded', 0.4), reserved('r2', 'handoff-from-run', 3, { standsFor: 'r1' })]);   // r2 never settled
  near(countedSummaryOf(d).usd, 3, 'the worst case of the fallback, once');
});

test('a record from before 0.8.4 names no basis: it is counted as before and shown as unlabelled, never guessed from its reason text', async () => {
  const { countedSummaryOf } = await import('../src/counted-spend.js');
  const d = folder();
  usage(d, 'old-stage.usage.json', { usd: 0.25 });
  usage(d, 'superseded/old.charge-1.usage.json', { usd: 0.1, kind: 'billed', reason: 'the provider answered with an error reply and no usage figure; counted toward the cap at a typical cost for this call' });
  const c = countedSummaryOf(d);
  near(c.usd, 0.35, 'both counted'); near(c.unlabelledUsd, 0.35, 'both unlabelled'); near(c.estimatedUsd, 0, 'no estimate is claimed for a record that names no basis');
});

test('an invalid basis is not a basis: it reads as unlabelled', async () => {
  const { countedSummaryOf } = await import('../src/counted-spend.js');
  const d = folder();
  usage(d, 'x-stage.usage.json', { usd: 1, basis: 'provider_cost' });   // plan A F3 (c)'s name: not a basis (his 03 and 04 Nov picks)
  const c = countedSummaryOf(d);
  near(c.unlabelledUsd, 1, 'unlabelled'); assert.equal(c.bases.provider_cost, undefined);
});

test('schemas/spend-reservations-v1.json stays closed and takes the new fields: basis on a settled line, standsFor on a reserved line, reachedProvider on a settled line; none of them on the other kind (schema of the lines this unit writes)', async () => {
  const { readFileSync } = await import('node:fs');
  const Ajv2020 = (await import('ajv/dist/2020.js')).default;
  const validate = new Ajv2020({ allErrors: true, allowUnionTypes: true, validateFormats: false }).compile(JSON.parse(readFileSync(new URL('../schemas/spend-reservations-v1.json', import.meta.url), 'utf8')));
  const res = { schema: 'spend-reservations/1', event: 'reserved', id: 'r2', at: '2026-11-04T10:00:00Z', label: 'x', seat: 'mock/mock-priced', usd: 3 };
  const set = { schema: 'spend-reservations/1', event: 'settled', id: 'r1', at: '2026-11-04T10:00:01Z', outcome: 'billed_unreadable', usd: 0.5 };
  assert.equal(validate({ ...set, basis: 'typical_error', reachedProvider: true }), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...res, standsFor: 'r1' }), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...set, basis: 'provider_cost' }), false, 'provider_cost is not a basis');
  assert.equal(validate({ ...set, standsFor: 'r1' }), false, 'standsFor belongs to a reserved line');
  assert.equal(validate({ ...res, basis: 'worst_case' }), false, 'basis belongs to a settled line');
});

test('across sittings: a call settled without a usage file in an earlier sitting, then the stage run again and the run finished: --spend reads the report\'s count-once figure and agrees with it (totals.usd holds only the rerun)', async () => {
  const { countedSummaryOf } = await import('../src/counted-spend.js');
  const d = folder();
  usage(d, 'a-stage.usage.json', { usd: 0.5, reservationId: 'r2', basis: 'token_priced' });      // the rerun: the one stage row of the report
  reservations(d, [reserved('r1', 'a-stage', 1), settled('r1', 'recorded', 0.4, { basis: 'token_priced' }), reserved('r2', 'a-stage', 1), settled('r2', 'recorded', 0.5, { basis: 'token_priced' })]);   // r1: the earlier sitting's payment, its file never written
  const counted = countedSummaryOf(d);
  near(counted.usd, 0.9, 'the reader counts the rerun and the earlier payment');
  writeFileSync(join(d, 'report.json'), JSON.stringify({ chain: 'c', totals: { usd: 0.5, counted }, stages: [{ label: 'a-stage', usd: 0.5, reservationId: 'r2' }] }));
  near(runSpentUsd(d), 0.9, 'with the report on disk --spend still reads the reader\'s figure, not totals.usd');
  usage(d, 'b-stage.usage.json', { usd: 0.25, basis: 'token_priced' });                          // a file that arrived after the report
  near(runSpentUsd(d), 1.15, 'and a file added since is in it too');
});
