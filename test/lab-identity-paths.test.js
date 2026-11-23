// LAB-IDENTITY unit, the paths the first scan did not reach (C&C gate condition 1, 20 Okt 2026): the seat key of a repeated seat (here `la-l2`) may appear ONLY in a `seat` / `seats` field or a stage label,
// never in a prompt, a `lab` value or a text a person reads. LI-8: the conflict decider and the conflict stop (real CLI, loopback stubs, the injected decider words). LI-9: the objection ledger and the
// review-notes lane on one repeated-seat chain (in-process, cache-fed replies). Offline, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { echoIds } from './helpers/echo-envelope.js';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT_CONFLICT_ASKED } from '../src/exit-codes.js';
import { runChain, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { reportJsonShape } from '../src/report-shape.js';
import { objectionId } from '../src/objection-ids.js';
import { promptHashOf } from '../src/cache-integrity.js';
import * as H from './held-prompts/held-083.js';
import { buildArguedFacts } from '../src/argued.js';
import { startTyped } from './helpers/typed-cap.js';
import { resumeThroughPauses } from './helpers/answer-pauses.js';
import { malformedProviderKeys } from './helpers/no-real-keys.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const inject = join(root, 'test', 'helpers', 'inject-decider.js');
const KEY = /\bla-l\d\b/;
const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const QUOTE = '`The worker retries failed requests.`';
const meets = (extra = {}) => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok', ...extra });
const objects = (f, extra = {}) => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: f.problem }], failures: [f], verdict_line: 'no', ...extra });
// CHANGED ACCEPTED TEST (0.8.4 apply; the LI-5 ruling of C&C, 11 Nov 2026): the walk also allows the seat key at the exact paths the report schema declares as seat keys or stage labels in the layer-debate record (an objection's raised_by and raised_in, a post's by); see test/lab-identity.test.js. Any other path, `lab` and `labs` included, is still walked.
const DECLARED_SEAT_KEY_FIELDS = /\.layer_?[dD]ebates\.\d+\.objections\.\d+\.(raised_by|raised_in)$|\.layer_?[dD]ebates\.\d+\.objections\.\d+\.posts\.\d+\.by$/;
// every string of a JSON value whose path does not end in a seat / seats / label field
const keyHits = (value, root0) => { const hits = []; (function walk(o, p) { if (Array.isArray(o)) o.forEach((v, i) => walk(v, `${p}.${i}`)); else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, `${p}.${k}`); else if (typeof o === 'string' && KEY.test(o) && !/\.(seat|seats|label|stage)(\.\d+)?$/.test(p) && !DECLARED_SEAT_KEY_FIELDS.test(p)) hits.push(`${p} = ${o.slice(0, 70)}`); })(value, root0); return hits; };

// ---- LI-9 -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the stub failures X and Y of LI-9 and XX and YY of LI-8 carried no rating, and LI-9's carried no relation. NEW: all carry severity 5; LI-9's (a chain with answer_back) also carry a relation: 'new' for a first raise and `continues <id>` for a repeat by the same seat key (la-l2 raises Y in pass 2 and again in pass 3). WHY: ratingDemand is recorded (src/prompts/recorded-084-b.js); relationRule (NS-0193) is asked and read only on a chain with answer_back, and LI-8's swing chain has none.
const X = { criterion: CRITERION, problem: 'Layer one: no retry limit is specified.', fix: 'Specify one.', severity: 5, relation: 'new' };
// CHANGED ACCEPTED TEST (0.8.4 apply, job 16 log): OLD: Y named a criterion ('The plan names an owner.') that is not in the chain's list while the stub's table marks CRITERION failed. NEW: Y names CRITERION, as LI-8's YY does. WHY: the recorded rating demand adds a failure for the table's failed row that has none (no severity), the verdict is unreadable ('carries no readable severity') and the layer-2 seat is re-asked; the run log of job 16 shows it. Y keeps its own id: the ids hash the seat key, la-l2, as well.
const Y = { criterion: CRITERION, problem: 'Top layer: nobody owns the limit.', fix: 'Name one.', severity: 5 };
const idX = objectionId('la', X);
test('LI-9 LEDGER AND NOTES ON A REPEATED-SEAT CHAIN: no prompt (the ledger sentence included), no report record and no review-notes item names the seat key; the notes keep the bare lab (red before: ledger rows and notes items carried la-l2)', async () => {
  setHeldForTest({ criticStatedPassNote: H.criticStatedPassNote, otherReviewersBlock: H.otherReviewersBlock, overseerLedgerSection: H.overseerLedgerSection, ledgerOverflowExit: H.ledgerOverflowExit });
  const hashes = new Map(); const prompts = []; const logs = [];
  setPromptSpy(p => { hashes.set(p.label, promptHashOf(p.system, p.user)); prompts.push({ label: p.label, text: `${p.system}\n${p.user}` }); });
  const note = { proposals: [{ text: 'Add a queue' }] };
  const reply = label => (label === 'panel-1-la' ? objects(X, note)
    : label === 'panel-2-la' ? meets({ answers: [{ id: idX, status: 'withdrawn', evidence: `It now states the limit in section one. ${QUOTE}` }], ...note })
      : label === 'panel-2-la-l2' ? objects({ ...Y, relation: 'new' }, note) : label === 'panel-3-la-l2' ? objects({ ...Y, relation: `continues ${objectionId('la-l2', Y)}` }, note) : undefined);
  setCache({ invalidate() {}, get(label) {
    const text = label.startsWith('panel-') ? (reply(label) ?? meets()) : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0, promptHash: hashes.get(label) };
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, ...(layer === undefined ? {} : { layer }) });
  const config = { name: 'fixture-li9', criteria: [CRITERION], maxRounds: 4, signoff: 'unanimous', answer_back: { enabled: true }, freedoms: { pass: true }, reviewNotes: { enabled: true, perKind: 3 },
    seats: { builder: seat('writer'), reviser: seat('writer'), critics: [seat('la', 1), seat('la', 2)] } };
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-li9', log: l => logs.push(l), config });
  const ledger = prompts.filter(p => p.text.includes('# The objection ledger')).map(p => p.label);
  assert.ok(ledger.includes('panel-3-la-l2'), `precondition: the repeated top-layer seat was shown the ledger (${ledger.join(', ')}); the run said: ${(() => { const at = logs.findIndex(l => /re-asking only/.test(String(l))); return logs.slice(Math.max(0, at - 10), at + 3).map(l => String(l).trim()).join(' | '); })()}`);   // 0.8.4 apply: the message carries the log lines around the first re-ask (the 10 before it and 2 after), which name why a reply was not read (an earlier filter on words kept only the re-ask line)
  assert.deepEqual(prompts.filter(p => KEY.test(p.text)).map(p => p.label), [], 'a prompt names the seat key');
  const report = JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-li9', chain: 'fixture-li9', task: 't.md', result, config })));
  assert.ok(report.review_notes?.items?.length, 'precondition: the notes lane recorded items');
  assert.deepEqual(keyHits({ ...report, stages: undefined }, 'report'), []);
  assert.ok(report.review_notes.items.every(i => i.raised_by.every(l => l === 'la')), JSON.stringify(report.review_notes.items.map(i => i.raised_by)));
});

// ---- LI-8 -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const body = text => ({ id: 'stub', model: 'qwen/qwen3.7-plus', provider: 'StubHost', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 200, completion_tokens: 80 } });
async function scripted(script) {
  const hits = []; const bodies = [];
  const srv = createServer((req, res) => { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => { hits.push(req.url); // CHANGED ACCEPTED TEST (decider-readiness apply patch, 24 Okt 2026; C&C ruling (b)): OLD the scripted reply went out as written. NEW it echoes the envelope ids of the request (test/helpers/echo-envelope.js), because with the verdict-envelope sentence recorded a reply without them is an abstention. WHY: src/roles.js records verdictEnvelopeSection.
bodies.push(b); const text = echoIds(b, script[Math.min(hits.length, script.length) - 1]); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body(text))); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { hits, bodies, url: `http://127.0.0.1:${srv.address().port}/v1`, close: () => new Promise(r => srv.close(r)) };
}
const files = d => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? files(p) : [p]; });
test('LI-8 CONFLICT STOP ON A REPEATED-SEAT CHAIN (real CLI, injected decider): the decider prompt, report-partial.json, the stop file and the run log name no seat key outside seat/seats/label (red before: conflict rows carried la-l2)', async () => {
  const XX = { criterion: CRITERION, problem: 'No limit on retries.', quote: 'retries failed requests', severity: 5 };
  const YY = { criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker', severity: 5 };
  const la = await scripted([objects(XX), meets(), objects(XX), meets()]); const lb = await scripted([objects(YY), meets()]); const lc = await scripted([meets()]);
  const dec = await scripted([JSON.stringify({ rulings: [{ conflict: 1, prevail: objectionId('la-l2', YY), reason: 'The earlier fix stands.', ask_person: true }] })]);
  try {
    const dir = mkdtempSync(join(tmpdir(), 'thc-li8-')); mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
    writeFileSync(join(dir, 'tasks', 't.md'), 'Write a worker plan with a retry limit.\n');
    const seat = (lab, layer, url) => ({ provider: 'openrouter', model: 'qwen/qwen3.7-plus', lab, layer, maxTokens: 4000, baseUrl: url });
    const writer = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
    writeFileSync(join(dir, 'chains', 'swing.json'), JSON.stringify({ name: 'swing', description: 'A fixture.', criteria: [CRITERION], signoff: 'unanimous', maxOverseerRounds: 3, layerRevisions: { 1: 3, 2: 2 }, estimate: { promptTokens: 1000, draftTokens: 1000, critiqueTokens: 300 },
      seats: { builder: writer, reviser: { provider: 'external', model: 'claude-code-session' }, critics: [seat('la', 1, la.url), seat('la', 2, lb.url), seat('lc', 3, lc.url)], decider: seat('dec', undefined, dec.url) } }));
    const run = args => new Promise(done => { let out = ''; const child = spawn(process.execPath, ['--import', inject, cli, ...args], { cwd: dir, env: { PATH: process.env.PATH, HOME: tmpdir(), ...malformedProviderKeys(), OPENROUTER_API_KEY: 'test-key-not-real', COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' } }); child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; }); child.on('exit', code => done({ code, out })); });
    const rd = join(dir, 'runs', '2026-10-20T09-00-00-000Z');
    // CHANGED (0.8.4 HS, Muad 05 Nov 2026 22:19: every layered chain needs a handling session; chain-lint refuses one without). OLD: the reviser was the mock `writer`. NEW: the reviser is the external session, so the run pauses at each revision (exit 3) before the swing is reached; those pauses are answered (test/helpers/answer-pauses.js) and the run continues to the conflict stop this test is about. The critics and the decider stay the loopback stubs: that is what the test exercises.
    const first = await resumeThroughPauses(run, rd, await startTyped(run, ['--chain', 'swing', '--task', 'tasks/t.md', '--run-id', '2026-10-20T09-00-00-000Z'], rd));
    assert.equal(first.code, EXIT_CONFLICT_ASKED, first.out);
    assert.ok(dec.bodies.length >= 1, 'precondition: the decider was asked');
    assert.ok(/conflict/i.test(dec.bodies[0]), 'precondition: the decider body is the conflict prompt');
    assert.deepEqual(KEY.test(dec.bodies[0]) ? [dec.bodies[0].match(/.{0,80}la-l\d.{0,40}/)[0]] : [], [], 'the decider prompt names the seat key');
    const hits = [];
    for (const f of files(rd)) { if (!/\.(json|log|md|jsonl)$/.test(f)) continue; const t = readFileSync(f, 'utf8'); const rel = f.slice(rd.length + 1);
      if (f.endsWith('.json')) { try { hits.push(...keyHits(JSON.parse(t), rel)); } catch { /* not JSON */ } }
      else for (const l of t.split('\n')) if (KEY.test(l.replace(/\b(?:panel|reply|dispute-review)-\d*-?la-l\d\b/g, ''))) hits.push(`${rel}: ${l.slice(0, 90)}`); }
    assert.deepEqual(hits, []);
  } finally { await la.close(); await lb.close(); await lc.close(); await dec.close(); }
});

// ---- LI-10 ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
test('LI-10 TWO SEATS OF ONE LAB DO NOT OVERWRITE EACH OTHER IN "WHERE EACH LAB STOOD" (D7, strictest): an objecting layer-2 seat and a signed-off layer-1 seat of the same lab read "objected" in either order (red before: the later record replaced the earlier)', () => {
  const pv = (order) => order.map(([seat, verdict]) => ({ round: 1, lab: 'la', ...(seat ? { seat } : {}), verdict }));
  const standing = panelVerdicts => buildArguedFacts({ panelVerdicts }).labs.find(l => l.lab === 'la').final_verdict;
  assert.equal(standing(pv([[null, 'signed_off'], ['la-l2', 'objected']])), 'objected');
  assert.equal(standing(pv([['la-l2', 'objected'], [null, 'signed_off']])), 'objected');
  assert.equal(standing(pv([[null, 'signed_off'], ['la-l2', 'signed_off']])), 'signed off');
  const so = rows => buildArguedFacts({ signoff: rows }).labs.find(l => l.lab === 'la').final_verdict;
  assert.equal(so([{ provider: 'la', signedOff: false }, { provider: 'la', signedOff: true }]), 'objected');
  assert.equal(so([{ provider: 'la', signedOff: true }, { provider: 'la', signedOff: false }]), 'objected');
});

// ---- LI-11 ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

test('LI-11 THE PROGRESS ROWS KEEP BOTH SEATS OF ONE LAB (real CLI): state.json lists two rows for the repeated lab, the second with its `seat`, none named by the seat key in `lab` (red before: one row, the last write won)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-li11-')); mkdirSync(join(dir, 'chains'));
  const m = 'mock-critic-script-oxoxoxoxox-li11';
  writeFileSync(join(dir, 'chains', 'rep.json'), JSON.stringify({ name: 'rep', description: 'A fixture.', maxRounds: 3, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' },
      critics: [{ provider: 'mock', model: m, lab: 'ma', layer: 1 }, { provider: 'mock', model: m, lab: 'ma', layer: 2 }, { provider: 'mock', model: 'mock-critic-holdout', lab: 'mb', layer: 2 }] } }));
  writeFileSync(join(dir, 'task.md'), 'A mock plan.\n');
  spawnSync(process.execPath, [cli, '--task', 'task.md', '--chain', 'rep'], { cwd: dir, env: { PATH: process.env.PATH, HOME: tmpdir() }, encoding: 'utf8' });
  const runs = readdirSync(join(dir, 'runs')); assert.equal(runs.length, 1);
  const state = JSON.parse(readFileSync(join(dir, 'runs', runs[0], 'state.json'), 'utf8'));
  const rows = state.seats.filter(r => r.lab === 'ma');
  assert.deepEqual(rows.map(r => r.seat ?? '-').sort(), ['-', 'ma-l2'], JSON.stringify(state.seats));
  assert.deepEqual(rows.map(r => [r.seat ?? '-', r.status]).sort(), [['-', 'signed'], ['ma-l2', 'objected']], 'each seat has its own status: layer 1 signed, layer 2 objected');
  assert.equal(state.seats.some(r => r.lab === 'ma-l2'), false);
});

// ---- LI-12 ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
test('LI-12 THE LOCAL VIEWER KEEPS THE REPEATED SEAT\'S PANEL ROW (C&C pick blocker, ui/app.js:125): the seat row is listed with the RECORDED bare lab (report.json stages), the key only in `seat`; a lab with a hyphen or dot is listed too; a re-ask file is not a second row (red before: the file-name pattern allowed only [a-z0-9], so both rows vanished)', async () => {
  const work = mkdtempSync(join(tmpdir(), 'thc-li12-')); const id = '2026-10-20T00-00-00-000Z'; const rd = join(work, 'runs', id); mkdirSync(rd, { recursive: true });
  const reply = JSON.stringify({ meets: true, criteria: [], failures: [], verdict_line: 'ok' });
  for (const f of ['panel-1-alpha.md', 'panel-1-alpha-l2.md', 'panel-1-deepseek-v4.1-flash.md', 'panel-2-alpha-reask1.md', 'panel-2-alpha.md']) writeFileSync(join(rd, f), reply);
  writeFileSync(join(rd, 'deliverable.md'), '# Plan\n');
  writeFileSync(join(rd, 'report.json'), JSON.stringify({ stages: [{ label: 'panel-1-alpha', lab: 'alpha' }, { label: 'panel-1-alpha-l2', lab: 'alpha', seat: 'alpha-l2' }, { label: 'panel-1-deepseek-v4.1-flash', lab: 'deepseek-v4.1-flash' }] }));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [join(root, 'src', 'ui', 'server.js')], { env: { ...process.env, PORT: String(port), COUNCIL_WORKDIR: work }, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await new Promise((ok, fail) => { child.stdout.on('data', d => { if (String(d).includes('relay viewer')) ok(); }); child.on('exit', code => fail(new Error(`viewer exited early (${code})`))); });
    const body = await new Promise((ok, fail) => { const req = httpRequest({ host: '127.0.0.1', port, path: `/api/runs/${id}`, headers: { host: `127.0.0.1:${port}` } }, res => { let b = ''; res.on('data', d => { b += d; }); res.on('end', () => ok(b)); }); req.on('error', fail); req.end(); });
    const panels = JSON.parse(body).panels;
    assert.deepEqual(panels['1'].map(p => [p.lab, p.seat ?? '-']).sort(), [['alpha', '-'], ['alpha', 'alpha-l2'], ['deepseek-v4.1-flash', '-']], 'the recorded bare lab, the key only in `seat`');
    assert.deepEqual(panels['2'].map(p => p.file), ['panel-2-alpha.md'], 'the re-ask file is not a row of its own');
  } finally { child.kill(); }
});

// ---- LI-13 ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
test('LI-13 A RUN STILL GOING SHOWS NO SEAT KEY AS A LAB (C&C ruling): with no report.json the viewer reads the lab from state.json (one row per seat); a file with no recorded row gets no lab and the file-name part in `seat`', async () => {
  const work = mkdtempSync(join(tmpdir(), 'thc-li13-')); const id = '2026-10-20T00-00-00-000Z'; const rd = join(work, 'runs', id); mkdirSync(rd, { recursive: true });
  const reply = JSON.stringify({ meets: true, criteria: [], failures: [], verdict_line: 'ok' });
  for (const f of ['panel-1-alpha.md', 'panel-1-alpha-l2.md', 'panel-1-ghost-l3.md']) writeFileSync(join(rd, f), reply);
  writeFileSync(join(rd, 'state.json'), JSON.stringify({ seats: [{ lab: 'alpha', status: 'signed' }, { lab: 'alpha', seat: 'alpha-l2', status: 'working' }] }));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [join(root, 'src', 'ui', 'server.js')], { env: { ...process.env, PORT: String(port), COUNCIL_WORKDIR: work }, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await new Promise((ok, fail) => { child.stdout.on('data', d => { if (String(d).includes('relay viewer')) ok(); }); child.on('exit', code => fail(new Error(`viewer exited early (${code})`))); });
    const body = await new Promise((ok, fail) => { const req = httpRequest({ host: '127.0.0.1', port, path: `/api/runs/${id}`, headers: { host: `127.0.0.1:${port}` } }, res => { let b = ''; res.on('data', d => { b += d; }); res.on('end', () => ok(b)); }); req.on('error', fail); req.end(); });
    const rows = JSON.parse(body).panels['1'].map(p => [p.lab ?? '', p.seat ?? '-']).sort();
    assert.deepEqual(rows, [['', 'ghost-l3'], ['alpha', '-'], ['alpha', 'alpha-l2']]);
  } finally { child.kill(); }
});
