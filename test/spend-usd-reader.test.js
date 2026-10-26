// 0.8.3 M6 (Builder D; Batch 1 audit item 10, Batch 3 entry 14, C&C ruling 13 Oct 2026, option C): the spend totals trusted whatever a run folder's files held. `usd += readJson(f)?.usd ?? 0` concatenated a string
// ("0.5" + 1 = "0.51"), let a negative number LOWER the total, turned a string "abc" into NaN, and read `null` (what JSON.stringify writes for a NaN cost) as 0.
// The rule now: ONE reader (usdFigure, built on src/cost.js readUsd): an ABSENT figure is $0 (an external stage); a PRESENT figure that is not a finite number of zero or more is UNKNOWN. The returned `usd`
// stays a finite number - the sum of what DID read, a floor - and `unknownFigures` counts the rest (0 when everything read). Nothing becomes null or Infinity. The month check of policy.json refuses on a total
// that has an unknown figure (the limit cannot be checked); run-budget.js's budgetOf says `remainingUsd: 0` on one. Free seats (mock, external, ollama) write the number 0, never null, so a clean run is never
// "unknown" (Review/Build_0.8.3/d-scratch/null-usd-writers.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as SPEND from '../src/spend.js';
import { budgetOf } from '../src/run-budget.js';
import { evaluatePolicy, buildPolicyContext } from '../src/policy.js';

const { spendReport, costToday, runSpentUsd } = SPEND;
// the new names, with a fallback to what exists at 59756d5 so that the red run before the fix fails on VALUES (a string sum, an undefined count), not on a missing export
const runSpendOf = dir => (SPEND.runSpendOf ? SPEND.runSpendOf(dir) : { usd: runSpentUsd(dir), unknownFigures: undefined });
const runSpendIsKnown = dir => (SPEND.runSpendIsKnown ? SPEND.runSpendIsKnown(dir) : undefined);

const made = [];
process.on('exit', () => { for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch { /* a leftover is a nuisance */ } } });
const RUN = '2026-10-13T08-00-00-000Z';
// a runs/ folder with one run whose files are given as { name: content } (objects are written as JSON, strings as they are)
function runsWith(files) {
  const runsDir = join(mkdtempSync(join(tmpdir(), 'thc-spend-usd-')), 'runs'); made.push(runsDir);
  const dir = join(runsDir, RUN); mkdirSync(dir, { recursive: true });
  for (const [name, c] of Object.entries(files)) writeFileSync(join(dir, name), typeof c === 'string' ? c : JSON.stringify(c));
  return { runsDir, dir };
}
const usage = usd => ({ provider: 'p', model: 'm', usage: { input: 1, output: 1 }, ...(usd === undefined ? {} : { usd }) });
const NOW = Date.parse('2026-10-13T12:00:00Z');

test('SUR-1 the rule itself: absent = 0; a finite number of zero or more reads; everything else present is unknown (null, strings, negatives, NaN, Infinity, objects, booleans)', () => {
  assert.equal(typeof SPEND.usdFigure, 'function', 'spend.js exports the one reader');
  const { usdFigure } = SPEND;
  assert.equal(usdFigure(undefined), 0);
  for (const ok of [0, 0.5, 12, 1e-9]) assert.equal(usdFigure(ok), ok);
  for (const bad of [null, '0.5', 'abc', '', -20, -0.0001, NaN, Infinity, -Infinity, {}, [], [1], true, false]) assert.equal(usdFigure(bad), null, `${JSON.stringify(bad)} is unknown`);
});

test('SUR-2 a string figure is no longer concatenated: {"usd":"0.5"} + {"usd":1} is a NUMBER (1, the readable part) with one unknown figure', () => {
  const { dir } = runsWith({ 'a.usage.json': usage('0.5'), 'b.usage.json': usage(1) });
  const r = runSpendOf(dir);
  assert.equal(typeof r.usd, 'number');
  assert.equal(r.usd, 1);
  assert.equal(r.unknownFigures, 1);
  assert.equal(runSpentUsd(dir), 1);
  assert.equal(runSpendIsKnown(dir), false);
});

test('SUR-3 a negative figure does not lower the total; null, "abc", NaN-as-null and an object are unknown, not 0', () => {
  for (const bad of [-20, null, 'abc', {}, true]) {
    const { dir } = runsWith({ 'a.usage.json': usage(bad), 'b.usage.json': usage(2) });
    const r = runSpendOf(dir);
    assert.equal(r.usd, 2, `usd ${JSON.stringify(bad)}: the floor is the readable part`);
    assert.equal(r.unknownFigures, 1, `usd ${JSON.stringify(bad)}`);
  }
  const { dir } = runsWith({ 'a.usage.json': '{"provider":"p","usd":' });   // a torn file: its cost cannot be read
  assert.deepEqual(runSpendOf(dir), { usd: 0, unknownFigures: 1, unknownFiles: ['a.usage.json'] });
});

test('SUR-4 a finished run: a report.json total that is a string or negative is not trusted for the figure (the stage files give a floor, unknown = 1); a good total is exactly as before', () => {
  for (const total of ['5', -1]) {
    const { dir } = runsWith({ 'report.json': { totals: { usd: total }, chain: 'c' }, 'a.usage.json': usage(0.25) });
    const r = runSpendOf(dir);
    assert.equal(r.usd, 0.25, `total ${JSON.stringify(total)}`);
    assert.equal(r.unknownFigures, 1);
  }
  const { dir } = runsWith({ 'report.json': { totals: { usd: 3.5 }, chain: 'c' }, 'a.usage.json': usage(99) });
  assert.deepEqual(runSpendOf(dir), { usd: 3.5, unknownFigures: 0, unknownFiles: [] });
  const h = runsWith({ 'report.json': { totals: { usd: 3.5 }, chain: 'c' }, 'handoff-from-run.usage.json': usage('x') });
  assert.deepEqual(runSpendOf(h.dir), { usd: 3.5, unknownFigures: 1, unknownFiles: ['handoff-from-run.usage.json'] });
});

test('SUR-5 a capped rematch/replay: STOPPED-budget.json spentUsd that is present and bad is unknown (it used to be 0); a good one still carries the sitting\'s spend', () => {
  const bad = runsWith({ 'STOPPED-budget.json': { spentUsd: 'lots' } });
  assert.deepEqual(runSpendOf(bad.dir), { usd: 0, unknownFigures: 1, unknownFiles: ['STOPPED-budget.json'] });
  const good = runsWith({ 'STOPPED-budget.json': { spentUsd: 0.75 } });
  assert.deepEqual(runSpendOf(good.dir), { usd: 0.75, unknownFigures: 0, unknownFiles: [] });
});

test('SUR-6 controls: an ABSENT usd (an external stage) is $0 and NOT unknown; normal figures sum exactly; a folder with no usage files is $0 and known', () => {
  const { dir } = runsWith({ 'a.usage.json': usage(0.1), 'b.usage.json': usage(0.2), 'c.usage.json': usage(undefined), 'd.usage.json': usage(0) });
  const r = runSpendOf(dir);
  assert.ok(Math.abs(r.usd - 0.3) < 1e-12);
  assert.equal(r.unknownFigures, 0);
  assert.equal(runSpendIsKnown(runsWith({}).dir), true);
});

test('SUR-7 the reports carry the count: spendReport and costToday rows and totals, tree subtotals only when something is unknown; the total stays a finite number', () => {
  const { runsDir } = runsWith({ 'a.usage.json': usage('0.5'), 'b.usage.json': usage(1) });
  const r = spendReport(runsDir, { days: 30, now: NOW });
  assert.equal(r.count, 1);
  assert.equal(r.totalUsd, 1);
  assert.equal(typeof r.totalUsd, 'number');
  assert.equal(r.unknownFigures, 1);
  assert.equal(r.runs[0].unknownFigures, 1);
  const t = costToday(runsDir, { date: new Date('2026-10-13T12:00:00'), now: NOW });
  assert.equal(t.unknownFigures, 1);
  assert.equal(t.perModel.find(m => m.model === 'p/m').usd, 1);
  assert.equal(t.perModel.find(m => m.model === 'p/m').unknownFigures, 1);
  const clean = spendReport(runsWith({ 'a.usage.json': usage(1) }).runsDir, { days: 30, now: NOW });
  assert.equal(clean.unknownFigures, 0);
  assert.equal(clean.runs[0].unknownFigures, 0);
});

test('SUR-8 run-budget budgetOf (run_status): an unknown figure makes the remaining budget 0 (fail closed), spentUsd is the floor, and the shape is unchanged when everything read', () => {
  const bad = runsWith({ 'a.usage.json': usage('x'), 'b.usage.json': usage(1), 'run.json': { maxUsd: 5 } });
  const b = budgetOf(bad.dir, null);
  assert.equal(b.spentUsd, 1);
  assert.equal(b.remainingUsd, 0);
  assert.equal(b.unknownFigures, 1);
  const ok = runsWith({ 'a.usage.json': usage(1), 'run.json': { maxUsd: 5 } });
  assert.deepEqual(Object.keys(budgetOf(ok.dir, null)).sort(), ['capUsd', 'remainingUsd', 'spentUsd', 'stoppedByCap']);
  assert.equal(budgetOf(ok.dir, null).remainingUsd, 4);
  const noCap = budgetOf(runsWith({ 'a.usage.json': usage('x') }).dir, null);
  assert.equal(noCap.remainingUsd, null, 'no cap: nothing to be left of');
  assert.equal(noCap.unknownFigures, 1);
});

test('SUR-9 policy.json max_usd_per_month: a month whose total has an unknown figure refuses (the limit cannot be checked) - and does NOT when nothing is unknown or no monthly limit is set', () => {
  const { runsDir } = runsWith({ 'a.usage.json': usage('0.5'), 'b.usage.json': usage(1) });
  const config = { name: 'c', seats: {}, maxRounds: 1 };
  const ctx = buildPolicyContext({ name: 'mock', seats: { critics: [{ provider: 'mock', model: 'mock-pass', lab: 'a' }] }, maxRounds: 1 }, [], runsDir, NOW);
  assert.equal(ctx.monthUnknownFigures, 1);
  const refused = evaluatePolicy({ max_usd_per_month: 50 }, { ...ctx, config });
  assert.equal(refused.ok, false);
  assert.match(refused.reasons.join(' '), new RegExp(`^max_usd_per_month: this month's spend cannot be totalled because 1 figure in the run folders could not be read as a number of dollars: ${RUN}/a\\.usage\\.json\\. The limit cannot be checked until that file holds a readable number of dollars\\.$`));
  assert.equal(evaluatePolicy({ max_usd_per_run: 50 }, { ...ctx, config }).reasons.some(r => /max_usd_per_month/.test(r)), false, 'no monthly limit, nothing to check');
  const clean = buildPolicyContext({ name: 'mock', seats: { critics: [{ provider: 'mock', model: 'mock-pass', lab: 'a' }] }, maxRounds: 1 }, [], runsWith({ 'a.usage.json': usage(1) }).runsDir, NOW);
  assert.equal(clean.monthUnknownFigures, 0);
  assert.equal(evaluatePolicy({ max_usd_per_month: 50 }, { ...clean, config }).ok, true);
  assert.equal(evaluatePolicy({ max_usd_per_month: 0.5 }, { ...ctx, config }).reasons.some(r => /already spent this month, over/.test(r)), true, 'a total that is already over the limit says so, unknown or not');
});

test('SUR-10 the month-check sentence names WHERE: up to 5 files as `<run id>/<file>` (a run id and a file name, never content), then "and N more"; and a superseded/ file is named too', () => {
  const runsDir = join(mkdtempSync(join(tmpdir(), 'thc-spend-where-')), 'runs'); made.push(runsDir);
  const ids = [];
  for (let i = 0; i < 4; i++) {            // four runs, two bad files in each = 8 unknown figures
    const id = `2026-10-13T0${i + 1}-00-00-000Z`; ids.push(id);
    const d = join(runsDir, id); mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'a.usage.json'), JSON.stringify(usage('x')));
    writeFileSync(join(d, 'b.usage.json'), '{"torn":');
  }
  const config = { name: 'c', seats: {}, maxRounds: 1 };
  const mock = { name: 'mock', seats: { critics: [{ provider: 'mock', model: 'mock-pass', lab: 'a' }] }, maxRounds: 1 };
  const ctx = buildPolicyContext(mock, [], runsDir, NOW);
  assert.equal(ctx.monthUnknownFigures, 8);
  const text = evaluatePolicy({ max_usd_per_month: 50 }, { ...ctx, config }).reasons.join(' ');
  assert.match(text, /because 8 figures in the run folders could not be read as a number of dollars: /);
  assert.equal((text.match(/\.usage\.json/g) ?? []).length, 5, 'exactly five files are named');
  assert.match(text, /, and 3 more\. The limit cannot be checked until every file named here holds a readable number of dollars\.$/);
  assert.ok(!text.includes('torn') && !text.includes('"x"'), 'no content, only run ids and file names');
  for (const id of ids.slice(1)) assert.ok(text.includes(id), `run ${id} is named (the newest four runs sort first)`);
  // a superseded/ file is named with its folder
  const s = runsWith({ 'a.usage.json': usage(1) });
  mkdirSync(join(s.dir, 'superseded'));
  writeFileSync(join(s.dir, 'superseded', 'build.usage.json'), JSON.stringify(usage('abc')));
  const one = evaluatePolicy({ max_usd_per_month: 50 }, { ...buildPolicyContext(mock, [], s.runsDir, NOW), config }).reasons.join(' ');
  assert.match(one, new RegExp(`because 1 figure in the run folders could not be read as a number of dollars: ${RUN}/superseded/build\\.usage\\.json\\.`));
});

test('SUR-11 superseded/ goes through the one reader (src/superseded.js used Number(usd)||0): a negative figure no longer LOWERS the total, "abc"/null/a torn file are unknown and named, a good one still counts', () => {
  const { dir } = runsWith({ 'a.usage.json': usage(1) });
  mkdirSync(join(dir, 'superseded'));
  const put = (n, c) => writeFileSync(join(dir, 'superseded', `${n}.usage.json`), typeof c === 'string' ? c : JSON.stringify(c));
  put('good', usage(0.25)); put('neg', usage(-5)); put('str', usage('abc')); put('nul', usage(null)); put('torn', '{"usd":');
  const r = runSpendOf(dir);
  assert.equal(r.usd, 1.25, 'the readable part: 1 + 0.25, the -5 does not lower it');
  assert.equal(r.unknownFigures, 4);
  assert.deepEqual([...(r.unknownFiles ?? [])].sort(), ['superseded/neg.usage.json', 'superseded/nul.usage.json', 'superseded/str.usage.json', 'superseded/torn.usage.json']);
  assert.equal(budgetOf(dir, null).unknownFigures, 4, 'run_status\'s budget counts them too');
});

test('SUR-12 file names in the month sentence come from a project-writable folder: escape and control characters and new lines are removed and a long name is cut (as policy keys are, PST-7)', () => {
  const { runsDir, dir } = runsWith({});
  writeFileSync(join(dir, 'a\u001b[31mred\nline.usage.json'), JSON.stringify(usage('x')));
  writeFileSync(join(dir, `${'k'.repeat(150)}.usage.json`), JSON.stringify(usage('x')));
  const mock = { name: 'mock', seats: { critics: [{ provider: 'mock', model: 'mock-pass', lab: 'a' }] }, maxRounds: 1 };
  const text = evaluatePolicy({ max_usd_per_month: 50 }, { ...buildPolicyContext(mock, [], runsDir, NOW), config: { name: 'c', seats: {}, maxRounds: 1 } }).reasons.join(' ');
  assert.match(text, /because 2 figures in the run folders could not be read as a number of dollars: /);
  assert.ok(!text.includes('\u001b') && !text.includes('\n'), 'no escape character and no line break in the sentence');
  assert.ok(text.includes('[31mredline'), 'the readable part of the name stays');
  assert.ok(!text.includes('k'.repeat(61)), 'a long name is cut at 60 characters');
});
