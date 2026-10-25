// 0.8.3 M6 (Builder D, after the fail-open unit): the MCP printers of the spend figures. A usage file whose `usd` is not a number of dollars is left out of every sum (src/usd-figure.js), so `totalUsd` / `usd` are a FLOOR.
// spend_report and run_status now say so - ONLY when something was left out, so the shape is unchanged otherwise - with a count and fixed words: no file names (spend_report is an unwrapped tool, 'run ids, chain names and dollar sums';
// run_status's other fields are wrapped as untrusted text, and a project-writable file name belongs in neither). `council --spend` and the month check of policy.json name the files. Real stdio server, $0, offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mcpCalls } from './helpers/mcp-calls.js';

const made = [];
process.on('exit', () => { for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch { /* a leftover is a nuisance */ } } });
// The run id is built from the clock at test start (the shape prerelease-batch2.test.js already uses): session_cost_today counts the LOCAL calendar day (src/spend.js costToday), so the hard-coded date this file had stopped counting
// the run at the next local midnight (found 14 Oct 2026: MSU-1 read `session_cost_today.unknownFigures` as undefined). The one race left is a test that straddles local midnight, a few seconds a day.
const RUN = new Date().toISOString().replace(/[:.]/g, '-');
function workWith(files) {
  const work = mkdtempSync(join(tmpdir(), 'thc-mcp-spend-')); made.push(work);
  const dir = join(work, 'runs', RUN); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ chain: 'c', maxUsd: 5 }));
  for (const [name, c] of Object.entries(files)) writeFileSync(join(dir, name), JSON.stringify(c));
  return work;
}
const usage = usd => ({ provider: 'p', model: 'm', usage: { input: 1, output: 1 }, usd });
const body = r => JSON.parse(r.result.content.map(c => c.text).join('\n'));
const ask = async work => { const m = await mcpCalls(work, [{ name: 'spend_report', arguments: { days: 5 } }, { name: 'run_status', arguments: { run: RUN } }, { name: 'list_runs', arguments: {} }]); return { spend: body(m.get(2)), status: body(m.get(3)), list: body(m.get(4)), raw: JSON.stringify([m.get(2), m.get(3), m.get(4)]) }; };

test('MSU-1 a figure that does not read: spend_report says the total is a floor (count, per-run count, session_cost_today); run_status and list_runs say budget.spentUsd is (usd is null here: no report.json total); no file name appears in any', async () => {
  const { spend, status, list, raw } = await ask(workWith({ 'a.usage.json': usage('0.5'), 'b.usage.json': usage(1) }));
  assert.equal(spend.totalUsd, 1);
  assert.equal(typeof spend.totalUsd, 'number');
  assert.equal(spend.unknownFigures, 1);
  assert.match(spend.totalNote, /^totalUsd is a floor, not the whole total: 1 figure in the run folders could not be read and was left out\./);
  assert.equal(spend.runs[0].unknownFigures, 1);
  assert.equal(spend.session_cost_today.unknownFigures, 1);
  assert.equal(status.budget.unknownFigures, 1);
  assert.equal(status.budget.remainingUsd, 0, 'no room is promised on a spend that cannot be read');
  assert.equal(status.usd, null, 'no report.json total yet: the floor is budget.spentUsd, and the note must name that field');
  assert.equal(status.budget.spentUsd, 1);
  assert.equal(status.usdNote, 'budget.spentUsd is a floor, not the whole cost: 1 figure in this run folder could not be read and was left out.');
  const listed = (Array.isArray(list) ? list : list.runs).find(x => x.id === RUN);
  assert.equal(listed.usdNote, status.usdNote, 'list_runs shares the summary');
  assert.ok(!/a\.usage\.json|b\.usage\.json/.test(raw), 'no file name in a trusted answer');
});

test('MSU-2 control: when every figure reads, none of the new fields exists (the shape of both answers is unchanged)', async () => {
  const { spend, status } = await ask(workWith({ 'a.usage.json': usage(0.25), 'b.usage.json': usage(1) }));
  assert.equal(spend.totalUsd, 1.25);
  for (const k of ['unknownFigures', 'totalNote']) assert.ok(!(k in spend), `spend_report has no ${k}`);
  assert.ok(!('unknownFigures' in spend.runs[0]));
  assert.ok(!('unknownFigures' in spend.session_cost_today));
  assert.ok(!('usdNote' in status));
  assert.ok(!('unknownFigures' in status.budget));
  assert.equal(status.budget.remainingUsd, 3.75);
});

test('MSU-3 a finished run (report.json total 3.5) with one unreadable figure beside it: usd HAS a value, so the note names both fields; two unreadable figures read in the plural', async () => {
  const one = workWith({ 'report.json': { chain: 'c', totals: { usd: 3.5 } }, 'handoff-from-run.usage.json': usage('x') });
  const a = await ask(one);
  assert.equal(a.status.usd, 3.5);
  assert.equal(a.status.usdNote, 'usd and budget.spentUsd are a floor, not the whole cost: 1 figure in this run folder could not be read and was left out.');
  const two = workWith({ 'a.usage.json': usage('x'), 'b.usage.json': usage(-1), 'c.usage.json': usage(1) });
  const b = await ask(two);
  assert.equal(b.status.usdNote, 'budget.spentUsd is a floor, not the whole cost: 2 figures in this run folder could not be read and were left out.');
  assert.match(b.spend.totalNote, /2 figures in the run folders could not be read and were left out\./);
});
