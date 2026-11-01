// The invariant behind "the smallest total that gets past this stop" (S5-05). A run stopped by the spend gate at stage S names a total (the printed resume command and run_status.suggestedMaxUsd, one figure). Resuming at that total must
// SEND stage S (it does not stop at S again), and resuming at one cent less must stop at S again (the figure is the smallest, not a padded one). The gate decides on the call's EXPECTED cost, so the figure is the spend the resume starts
// from plus the figure the gate decided on: for a planned call its expected cost; for the stop that REFUSED A THINKING RETRY the whole call's worst case, because that stop leaves no stage file and the resume re-runs the stage from its
// first attempt (premise checked below). Real CLI, a loopback stub, $0: an OpenRouter seat on a local server. The stub either answers with a valid criteria list or cuts every reply off by thinking.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { typeCap } from './helpers/typed-cap.js';
import { runResumability } from '../src/run-status.js';
import { runSpentUsd } from '../src/spend.js';
import { expectedCallUsd } from '../src/cost.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const ID = '2026-10-28T12-00-00-000Z';
// CHANGED ACCEPTED TEST (price refresh, 1 Nov 2026; the fix is DUALCAP's, thcmcp-5f, verified by it and carved out for the PRICES lane by C&C). OLD bar: the stub bills every cut-off reply at a flat 30 prompt tokens. NEW bar: it bills the request's own prompt size.
// WHY: with the flat 30 tokens the re-run first attempt cost less than its worst case (the prompt's input minus 30 tokens, at the input price); that slack plus the rounding up to the cent decided whether "one cent under stops again" held, and it stayed under a cent at opus-5's 5 / 25 and crossed one at 5.5 / 27.5 after the refresh.
// The cap held every cent in the original failure and src/resume-ceiling.js has no defect. 5f's rows: the green run Review/084/cnc/dualcap/t4-fix-20261101-0541/rows.txt (5 of 5), the known-bad run (a gate figure padded by one cent: t1, t2, t4, t5 red, t3 green) .../t4-red-20261101-0545/rows.txt, the reproduction .../t4-trace-20261101-0535/rows.txt (4 of 5, t4 red).
// A cut-off reply bills the request's OWN prompt size, by the projection's rule (src/cost.js CHARS_PER_TOKEN, 4, over the message text), so a first attempt costs exactly its worst case and "one cent under stops again" holds at any price.
const cut = (n, p = 30) => ({ model: 'anthropic/claude-opus-5', choices: [{ message: { content: '' }, finish_reason: 'length' }], usage: { prompt_tokens: p, completion_tokens: n, completion_tokens_details: { reasoning_tokens: n } } });
const promptTokensOf = j => Math.ceil((j.messages ?? []).reduce((s, m) => s + (typeof m.content === 'string' ? m.content.length : 0), 0) / 4);
const criteria = () => ({ model: 'anthropic/claude-opus-5', choices: [{ message: { content: JSON.stringify({ criteria: ['A real criterion.'] }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 30, completion_tokens: 20 } });

// `anthropic`: the seat is an Anthropic seat (a router id with originalProvider anthropic), so its call is retried once at a bigger cap when thinking uses the whole cap; `answer`: what the stub says ('criteria' or 'cut').
async function rig({ anthropic, answer }) {
  let requests = 0;
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', d => { b += d; }); req.on('end', () => {
      requests += 1; const j = JSON.parse(b || '{}'); const n = j.max_completion_tokens ?? j.max_tokens ?? 500;
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(answer === 'cut' ? cut(n, promptTokensOf(j)) : criteria()));
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  srv.unref();                                                                // a failed assertion must never keep the test process alive
  const work = mkdtempSync(join(tmpdir(), 'thc-stop-figure-')); mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'chains'));
  writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  const seat = { provider: 'openrouter', model: 'anthropic/claude-opus-5', ...(anthropic ? { originalProvider: 'anthropic' } : {}), maxTokens: 500, baseUrl: `http://127.0.0.1:${srv.address().port}` };
  writeFileSync(join(work, 'chains', 'p.json'), JSON.stringify({ ...base, name: 'p', seats: { ...base.seats, criteria: seat } }));
  const env = { PATH: process.env.PATH, HOME: work, OPENROUTER_API_KEY: `sk-or-v1-${'e'.repeat(40)}`, COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' };
  const go = args => new Promise(resolve => { const c = spawn(process.execPath, [cli, ...args], { cwd: work, env }); let out = ''; c.stdout.on('data', d => { out += d; }); c.stderr.on('data', d => { out += d; }); c.on('exit', code => resolve({ code, out })); });
  const runDir = join(work, 'runs', ID);
  // a sitting: the start (or a resume) waits for a typed limit (exit 21), the person types `typed`, the same run continues; `sent` = the requests this sitting made
  const sit = async (args, typed) => {
    const first = await go(args); assert.equal(first.code, 21, first.out);
    typeCap(runDir, String(typed));
    const before = requests; const r = await go(['--resume', runDir]);
    return { ...r, sent: requests - before };
  };
  const start = typed => sit(['--chain', 'p', '--task', 'tasks/x.md', '--run-id', ID], typed);
  const resume = typed => sit(['--resume', runDir], typed);
  // the figure both views name: run_status.suggestedMaxUsd, and the sentence the stop prints
  const suggested = () => {
    const status = runResumability(runDir, JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')));
    // the printed command and its sentence are in the stop's detail file (the console shows the path)
    const detail = readFileSync(join(runDir, 'STOPPED-budget.md'), 'utf8');
    const printed = Number((detail.match(/the smallest total that gets past this stop is \$([0-9]+\.[0-9]+)/) ?? [])[1]);
    assert.equal(printed, status.suggestedMaxUsd, `the printed figure ${printed} and run_status ${status.suggestedMaxUsd} are one figure`);
    return status.suggestedMaxUsd;
  };
  const stopped = () => JSON.parse(readFileSync(join(runDir, 'STOPPED-budget.json'), 'utf8'));
  return { srv, runDir, start, resume, suggested, stopped, requests: () => requests };
}
const cents = n => Math.round(n * 100) / 100;

test('a planned call stopped by the gate: the printed and the run_status figure are one, resuming at it sends the call, one cent less stops at the same stage', async () => {
  const t = await rig({ anthropic: false, answer: 'criteria' });
  try {
    const s1 = await t.start(0.005);                                           // below the call's expected cost: stopped before anything is sent
    assert.equal(s1.code, 4, s1.out); assert.equal(s1.sent, 0); assert.equal(t.stopped().stoppedAt, 'criteria');
    const S = t.suggested();
    const below = await t.resume(cents(S - 0.01));                             // the smallest total is the smallest: one cent less stops at the same stage, nothing sent
    assert.equal(below.code, 4, below.out); assert.equal(below.sent, 0); assert.equal(t.stopped().stoppedAt, 'criteria');
    const at = await t.resume(S);
    assert.ok(at.sent >= 1, `resuming at the suggested ${S} sends the call (${at.sent} requests): ${at.out}`);
  } finally { t.srv.close(); }
});

test('a planned Anthropic call stopped by the gate before its first attempt: the same, and the first attempt is sent', async () => {
  const t = await rig({ anthropic: true, answer: 'cut' });
  try {
    const s1 = await t.start(0.005);
    assert.equal(s1.code, 4, s1.out); assert.equal(s1.sent, 0); assert.equal(t.stopped().stoppedAt, 'criteria');
    const S = t.suggested();
    const below = await t.resume(cents(S - 0.01));
    assert.equal(below.code, 4, below.out); assert.equal(below.sent, 0, `one cent under ${S} still stops at the first gate: nothing is sent (an over-padded figure sends ${below.sent})`);
    const at = await t.resume(S);
    assert.ok(at.sent >= 1, `resuming at the suggested ${S} sends the first attempt (${at.sent} requests)`);
  } finally { t.srv.close(); }
});

// Two independent runs: the cent-under resume SENDS the first attempt (and is billed for it again), which would change the spend the other resume starts from. Each question gets its own run.
async function refusedRetryStop() {
  const t = await rig({ anthropic: true, answer: 'cut' });
  const s1 = await t.start(0.03);                                            // admits the first attempt (about $0.011 expected), cannot hold the retry after it
  assert.equal(s1.code, 4, s1.out); assert.equal(s1.sent, 1, 'one request: the first attempt, then the retry was refused');
  assert.equal(existsSync(join(t.runDir, 'criteria.md')), false, 'PREMISE: the stage was not completed, so the resume re-runs it from its first attempt');
  try { return { t, S: t.suggested() }; } catch (e) { t.srv.close(); throw e; }
}

test('a stop that REFUSED a thinking retry leaves no stage file and its figure covers the whole call: resuming at it sends both attempts', async () => {
  const { t, S } = await refusedRetryStop();
  try {
    const at = await t.resume(S);
    assert.notEqual(at.code, 4, `resuming at the suggested ${S} is not stopped by the cap again: ${at.out}`);
    assert.equal(at.sent, 2, 'both attempts were sent: the first, then the retry the figure paid for');
  } finally { t.srv.close(); }
});

test('a stop that REFUSED a thinking retry: one cent under its figure stops at the same stage again (the figure is the smallest)', async () => {
  const { t, S } = await refusedRetryStop();
  try {
    const below = await t.resume(cents(S - 0.01));
    assert.equal(below.code, 4, `one cent under ${S} stops at the same stage again: ${below.out}`); assert.equal(t.stopped().stoppedAt, 'criteria');
  } finally { t.srv.close(); }
});

// Two paid seats in flight (the obligation of the review of 2bbe2e3d): a panel of two reviews is asked at once; the first is admitted, the second is refused by the gate while the first is still being answered, and the first settles
// AFTER the throw. The stop record's spend is written once the siblings have settled; it must equal what the resume starts from (the run folder's own spend), or "the smallest total" is not exact. The stub answers a review slowly so the
// first call is in flight when the second is refused.
const verdict = () => ({ model: 'anthropic/claude-opus-5', choices: [{ message: { content: JSON.stringify({ meets: true, criteria: [{ criterion: 'It exists.', verdict: 'MET', evidence: 'Checked.' }], failures: [], verdict_line: 'Pass.' }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 40, completion_tokens: 30 } });
async function rigTwo() {
  let requests = 0;
  const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => { requests += 1; setTimeout(() => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(verdict())); }, 600); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); srv.unref();
  const work = mkdtempSync(join(tmpdir(), 'thc-stop-two-')); mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'chains'));
  writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  const critic = lab => ({ provider: 'openrouter', model: 'anthropic/claude-opus-5', lab, maxTokens: 500, baseUrl: `http://127.0.0.1:${srv.address().port}` });
  writeFileSync(join(work, 'chains', 'q.json'), JSON.stringify({ name: 'q', maxRounds: 1, signoff: 'unanimous', criteria: ['It exists.'], seats: { builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' }, critics: [critic('lab-a'), critic('lab-b')] } }));
  const env = { PATH: process.env.PATH, HOME: work, OPENROUTER_API_KEY: `sk-or-v1-${'e'.repeat(40)}`, COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' };
  const go = args => new Promise(resolve => { const c = spawn(process.execPath, [cli, ...args], { cwd: work, env }); let out = ''; c.stdout.on('data', d => { out += d; }); c.stderr.on('data', d => { out += d; }); c.on('exit', code => resolve({ code, out })); });
  const runDir = join(work, 'runs', ID);
  return { srv, runDir, go, requests: () => requests, seat: critic('lab-a') };
}

test('two paid seats in flight: the second is refused while the first is answered; the record\'s spend equals the resume\'s starting spend, and the suggested total is exact', async () => {
  const t = await rigTwo();
  try {
    // above one review's expected cost, below two: the first is admitted, the second refused while the first is in flight (Efloor: an empty prompt, a lower bound of a real review's expected cost)
    const Efloor = expectedCallUsd(t.seat, { system: '', user: '', label: 'panel-1-lab-a' });
    const cap = Math.ceil(Efloor * 1.5 * 10000) / 10000;
    const first = await t.go(['--chain', 'q', '--task', 'tasks/x.md', '--run-id', ID]); assert.equal(first.code, 21, first.out);
    typeCap(t.runDir, String(cap));
    const stop = await t.go(['--resume', t.runDir]);
    assert.equal(stop.code, 4, stop.out); assert.equal(t.requests(), 1, 'one review was sent before the second was refused');
    const rec = JSON.parse(readFileSync(join(t.runDir, 'STOPPED-budget.json'), 'utf8'));
    const startsFrom = runSpentUsd(t.runDir) + 0;                              // what a resume counts before it sends anything
    assert.ok(Math.abs((rec.spentUsd + (rec.assumedAtWorstCase?.usd || 0)) - startsFrom) < 1e-9, `the record's counted spend ${rec.spentUsd} equals the resume's starting spend ${startsFrom}`);
    const status = runResumability(t.runDir, JSON.parse(readFileSync(join(t.runDir, 'run.json'), 'utf8')));
    const S = status.suggestedMaxUsd;
    assert.ok(S > 0 && S >= startsFrom + rec.gateStageUsd - 1e-9 && S < startsFrom + rec.gateStageUsd + 0.0101, `the suggested ${S} is the starting spend ${startsFrom} + the gate figure ${rec.gateStageUsd}, to the cent`);
  } finally { t.srv.close(); }
});
