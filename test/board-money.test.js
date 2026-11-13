// 0.8.4 unit 6 (D32; plan A T6.5, "Dollars on the board"; Mini-C&C R444): the money section of a FINISHED run's debate board. (a) The section reads the run folder through the one counted-spend reader and lists each seat's counted amount
// with its basis labels, the counted total, and for a resumed run each usage file as superseded, replayed or never asked again; (b) its total is the sum of its own lines and equals report.json's `totals.counted.usd` for the same folder;
// (c) it never reads like a bill; (d) renderBoardMd (which reads no file) only places the finished text, never makes a board by itself, and the partial board carries none; (e) the real verb: a finished run's BOARD.md.
// Offline, $0: (a)-(d) use hand-built run folders (the fixture of test/resume-count-once.test.js, the plan's five $1.00 charges); (e) starts the CLI on a loopback stub whose replies are the mock provider's own.
// A test that passes on the old source is named (PIN). On the old source src/board-money.js is missing, so every row of (a)-(c) is red by its dynamic import, by name; (d)'s "placed at the end" row is red because renderBoardMd ignores `money`;
// (e) is red because the finished run's BOARD.md has no such section.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderBoardMd, renderPartialBoardMd } from '../src/report-shape.js';
import { startTyped } from './helpers/typed-cap.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: got ${a}, expected ${b}`);
const folder = () => { const d = mkdtempSync(join(tmpdir(), 'thc-board-money-')); mkdirSync(join(d, 'superseded')); return d; };
const usage = (d, rel, o) => writeFileSync(join(d, rel), JSON.stringify({ provider: 'openrouter', model: 'x/y', usage: { input: 1, output: 1 }, usd: 1, ...o }));
const reservations = (d, lines) => writeFileSync(join(d, 'spend-reservations.jsonl'), lines.map(l => JSON.stringify({ schema: 'spend-reservations/1', at: '2026-11-04T10:00:00.000Z', ...l })).join('\n') + '\n');
const reserved = (id, label, usd) => ({ event: 'reserved', id, label, seat: 'openrouter/x/y', usd });
const settled = (id, outcome, usd, extra = {}) => ({ event: 'settled', id, outcome, usd, ...extra });

// the plan's five $1.00 charges (test/resume-count-once.test.js): (i) superseded, (ii) a settled reservation with its file, (iii) an unsettled reservation, (iv) a file the resumed sitting never asks again, (v) a replayed stage
function planFixture(d, { withIdOnReplay = true } = {}) {
  usage(d, 'superseded/a-stage.1.usage.json', { basis: 'token_priced' });
  usage(d, 'b-stage.usage.json', { reservationId: 'r1', basis: 'token_priced' });
  usage(d, 'd-stage.usage.json', { basis: 'token_priced' });
  usage(d, 'e-stage.usage.json', { ...(withIdOnReplay ? { reservationId: 'r3' } : {}), basis: 'token_priced' });
  reservations(d, [reserved('r1', 'b-stage', 1), settled('r1', 'recorded', 1, { basis: 'token_priced' }), reserved('r2', 'c-stage', 1), reserved('r3', 'e-stage', 1), settled('r3', 'recorded', 1, { basis: 'token_priced' })]);
}
// the report's stage rows of the resumed sitting: d-stage and c-stage have no row (never asked again; the call that never settled); e-stage was served from the stage files
const STAGES = [
  { label: 'a-stage', lab: 'lab-a', model: 'm-a' },
  { label: 'b-stage', lab: 'lab-b', model: 'm-b' },
  { label: 'e-stage', lab: 'lab-e', model: 'm-e', cached: true },
];
const amounts = (text, re) => [...text.matchAll(re)].map(m => Number(m[1]));
const sum = xs => xs.reduce((a, b) => a + b, 0);

test('(a) the plan fixture: the total is $5.00 of which $1.00 is an estimate, and every file of the resumed run is listed with its state', async () => {
  const { moneySectionOf } = await import('../src/board-money.js');
  for (const withId of [true, false]) {
    const d = folder(); planFixture(d, { withIdOnReplay: withId });
    const text = moneySectionOf({ runDir: d, stages: STAGES });
    assert.match(text, /^\n\n## What the run cost\n\n/, 'it follows the board with its own heading');
    assert.match(text, /\nTotal: \$5\.00 counted \(of which \$1\.00 estimated\)\./, `the total, replayed record ${withId ? 'with' : 'without'} an id`);
    assert.match(text, /- superseded\/a-stage\.1\.usage\.json: \$1\.00, token-priced; superseded, still counted\./, '(i)');
    assert.match(text, /- b-stage\.usage\.json: \$1\.00, token-priced; counted in the total\./, '(ii)');
    assert.match(text, /- reservation r2: \$1\.00, reserved at its worst case, never settled, estimated; no settlement was written, counted\./, '(iii) A4: the unsettled reservation is one line');
    assert.match(text, /- d-stage\.usage\.json: \$1\.00, token-priced; never asked again by the resumed sitting, still counted\./, '(iv)');
    assert.match(text, /- e-stage\.usage\.json: \$1\.00, token-priced; replayed from an earlier sitting, counted once\./, '(v)');
  }
});

test('(b) the lines add up: the file lines and the seat lines each sum to the total, and a replayed file is counted ONCE (the plan\'s red: counted twice would read $6.00)', async () => {
  const { moneySectionOf } = await import('../src/board-money.js');
  const { countedSummaryOf } = await import('../src/counted-spend.js');
  for (const withId of [true, false]) {
    const d = folder(); planFixture(d, { withIdOnReplay: withId });
    const text = moneySectionOf({ runDir: d, stages: STAGES });
    const total = countedSummaryOf(d).usd;
    near(total, 5, 'the reader');
    near(sum(amounts(text, /^- [^:\n]+: \$([\d.]+), /gm)), total, 'the file lines');
    near(sum(amounts(text, /^- (?:[^:\n]+ \([^)\n]+\)|label [^:\n]+): \$([\d.]+) counted/gm)), total, 'the seat lines');
    near(amounts(text, /\nTotal: \$([\d.]+) counted/g)[0], total, 'the total line');
  }
});

test('(b) seats come from the stage rows by base label; a label no row names is listed under its label and never dropped', async () => {
  const { moneySectionOf } = await import('../src/board-money.js');
  const d = folder(); planFixture(d);
  const text = moneySectionOf({ runDir: d, stages: STAGES });
  assert.match(text, /- lab-a \(m-a\): \$1\.00 counted \(\$1\.00 token-priced\)/, 'the superseded file counts for its stage\'s seat');
  assert.match(text, /- lab-e \(m-e\): \$1\.00 counted/);
  assert.match(text, /- label c-stage: \$1\.00 counted \(\$1\.00 reserved at its worst case, never settled, estimated\)/, 'the call that never settled has no stage row');
  assert.match(text, /- label d-stage: \$1\.00 counted \(\$1\.00 token-priced\)/);
});

test('(c) the label says it is not a bill, and no word of the plan\'s provider-cost clause is used (R394: provider_cost is not a basis)', async () => {
  const { moneySectionOf, MONEY_LABEL } = await import('../src/board-money.js');
  const d = folder(); planFixture(d);
  const text = moneySectionOf({ runDir: d, stages: STAGES });
  assert.ok(text.includes(MONEY_LABEL));
  assert.match(MONEY_LABEL, /not your provider's bill/);
  assert.match(MONEY_LABEL, /'estimated'/);
  assert.doesNotMatch(text, /reported cost|provider's own/i);
});

test('(a) a basis the plan does not list is worded, and so is a record from before bases were kept; an unreadable figure is said, not shown as $0', async () => {
  const { moneySectionOf } = await import('../src/board-money.js');
  const d = folder();
  usage(d, 'x.usage.json', { basis: 'worst_case' });
  usage(d, 'y.usage.json', {});
  usage(d, 'z.usage.json', { usd: 'not a figure' });
  const text = moneySectionOf({ runDir: d, stages: [{ label: 'x', lab: 'l', model: 'm' }, { label: 'y', lab: 'l', model: 'm' }] });
  assert.match(text, /\$1\.00 one attempt's worst case, estimated/);
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: /\$1\.00 recorded before bases were kept/. NEW: /\$1\.00 recorded before THC noted what a figure stands for/. WHY: NO_BASIS_WORDS (src/board-money.js:25), the resolved text of the row (RESOLVED_LIST).
  assert.match(text, /\$1\.00 recorded before THC noted what a figure stands for/);
  assert.match(text, /\nTotal: \$2\.00 counted \(of which \$1\.00 estimated\)\./);
  assert.match(text, /1 record with a figure that could not be read is not in this total\./);
});

test('(a) a single-sitting run lists its seats and its total, and no per-file list; a folder with no paid record gives nothing', async () => {
  const { moneySectionOf } = await import('../src/board-money.js');
  const d = folder(); usage(d, 'b-stage.usage.json', { basis: 'token_priced' });
  const text = moneySectionOf({ runDir: d, stages: [{ label: 'b-stage', lab: 'lab-b', model: 'm-b' }] });
  assert.match(text, /- lab-b \(m-b\): \$1\.00 counted \(\$1\.00 token-priced\)/);
  assert.doesNotMatch(text, /Each file of the run folder/);
  const free = folder(); usage(free, 'b-stage.usage.json', { usd: 0 });
  assert.equal(moneySectionOf({ runDir: free, stages: [] }), '');
  assert.equal(moneySectionOf({ runDir: join(free, 'missing'), stages: undefined }), '', 'a folder that is not there is no section and no throw');
});

test('(d) renderBoardMd places the finished text at the end of the board', () => {
  const money = '\n\n## What the run cost\n\nTotal: $5.00 counted.';
  const board = renderBoardMd({ runId: 'x', result: { board: 'the board' }, money });
  assert.ok(board.endsWith(money), 'the money section is the last thing on the board');
});

test('(d) PIN: without money text renderBoardMd prints none; money never makes a board by itself (no board, no section); the advice early return and the partial board are untouched (the old source passes this too)', () => {
  const money = '\n\n## What the run cost\n\nTotal: $5.00 counted.';
  assert.doesNotMatch(renderBoardMd({ runId: 'x', result: { board: 'the board' } }), /What the run cost/);
  assert.equal(renderBoardMd({ runId: 'x', result: {}, money }), '', 'a run with no board writes none because of a cost');
  assert.equal(renderBoardMd({ runId: 'x', result: { advise: { status: 'running' } }, money }), '');
  assert.doesNotMatch(renderPartialBoardMd({ runId: 'x', result: { board: 'the board' } }), /What the run cost/, 'a partial board has no money section');
});

// (e) the real verb: a finished debate run whose criteria seat is a keyed OpenRouter seat on a loopback stub; the stub answers with the mock provider's own reply for the same prompt and a fixed usage, so the run finishes and pays for one stage.
test('(e) a finished run\'s BOARD.md carries the money section, and its total is report.json\'s totals.counted.usd', async () => {
  const { call } = await import('../src/providers.js');
  const srv = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; });
    req.on('end', async () => {
      const b = JSON.parse(raw); const system = (b.messages.find(m => m.role === 'system') || {}).content || '';
      const out = await call('mock', { model: 'mock-criteria', system, messages: b.messages.filter(m => m.role !== 'system'), maxTokens: b.max_tokens || 500 });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ model: 'x/y', choices: [{ message: { content: out.text }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 500 } }));
    });
  });
  await new Promise(done => srv.listen(0, '127.0.0.1', done));
  const work = mkdtempSync(join(tmpdir(), 'thc-board-money-cli-')); mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'chains'));
  writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  writeFileSync(join(work, 'chains', 'c.json'), JSON.stringify({ ...base, name: 'c', seats: { ...base.seats, criteria: { provider: 'openrouter', model: 'anthropic/claude-opus-5', maxTokens: 500, baseUrl: `http://127.0.0.1:${srv.address().port}` } } }));
  const RUN = '2026-11-08T07-00-00-000Z'; const runDir = join(work, 'runs', RUN);
  const env = { PATH: process.env.PATH, HOME: work, OPENROUTER_API_KEY: `sk-or-v1-${'e'.repeat(40)}`, COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' };
  const run = args => new Promise(done => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
    child.on('exit', code => done({ code, out }));
  });
  let end;
  try { end = await startTyped(run, ['--chain', 'c', '--task', 'tasks/x.md', '--run-id', RUN], runDir); } finally { srv.close(); }
  assert.equal(end.code, 0, end.out);
  assert.ok(existsSync(join(runDir, 'BOARD.md')), 'the finished debate run wrote its board');
  const board = readFileSync(join(runDir, 'BOARD.md'), 'utf8');
  const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
  assert.ok(report.totals.counted.usd > 0, 'the criteria stage was paid');
  assert.match(board, /\n## What the run cost\n/);
  const { formatUsd } = await import('../src/cost.js');
  assert.ok(board.includes(`Total: ${formatUsd(report.totals.counted.usd)} counted`), `the board's total is the report's counted figure (${report.totals.counted.usd})`);
  assert.match(board, /not your provider's bill/);
  assert.ok(board.trimEnd().split('\n').slice(-3).join('\n').includes('counted'), 'at the end of the board');
});
