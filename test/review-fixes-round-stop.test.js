// Review fixes F4 and F5 (the paid M6 review, Fable 5.1; C&C verdicts 18 Okt 2026), driven through the real CLI on an explicit MOCK layered chain that stops at the overseer-round cap (small numbers so a stop is reachable;
// the same fixture shape as test/overseer-choice.test.js). Offline, $0.
//  F4: schemas/report-v1.json `stop` said "present only in report-partial.json" and did not declare `chosen`; a --finish puts the stop (with chosen: 'finish') into report.json.
//  F5: the stop sentence named "the deliverable in report-partial.json", which holds no plan. The plan as it stands is written beside the partial report as deliverable-partial.md (DECLINED lines stripped) and the sentence names it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import Ajv2020 from 'ajv/dist/2020.js';
import { typeCap } from './helpers/typed-cap.js';
import { listGates } from '../src/gate.js';
import { budgetOf } from '../src/run-budget.js';
import { malformedProviderKeys } from './helpers/no-real-keys.js';
import { stopIdOf } from '../src/overseer-rounds.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true }); ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
const validate = ajv.compile(schema);
const judge = (pattern, id, lab, layer) => ({ provider: 'mock', model: `mock-critic-script-${pattern}-${id}`, lab, layer });
const chainOf = critics => ({
  name: 'ovc', signoff: 'unanimous', maxOverseerRounds: 2, layerRevisions: { 1: 2, 2: 1 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics },
});
function stopped(taskText = '# A plan\n') {
  const dir = mkdtempSync(join(tmpdir(), 'rfx-')); mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'ovc.json'), JSON.stringify(chainOf([judge('o', 'a', 'l1', 1), judge('o', 'b', 'l2', 2), judge('x', 'c', 'l3', 3)])));
  writeFileSync(join(dir, 'tasks', 't.md'), taskText);
  const run = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  const first = run(['--chain', 'ovc', '--task', 'tasks/t.md']);
  assert.equal(first.status, 23, first.stdout + first.stderr);
  return { dir, run, first, runDir: join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]), done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('F4: a --finish puts the stop with chosen: finish into report.json, the schema declares chosen, validates that report, and no longer says the stop is only in report-partial.json', () => {
  const p = stopped();
  try {
    const r = p.run(['--resume', p.runDir, '--finish']);
    assert.notEqual(r.status, 23, r.stdout + r.stderr);
    const report = JSON.parse(readFileSync(join(p.runDir, 'report.json'), 'utf8'));
    assert.equal(report.stop.chosen, 'finish');
    assert.ok(validate(report), JSON.stringify(validate.errors));
    // EDITED 23 Okt 2026 (lane D; stale test, not a changed behaviour). OLD: ['finish'], "the one value the writer can write". e13a779 (20 Okt 2026, ROADMAP 83 commit 2; Muad 20 Okt 2026 12:50,
    // "ROADMAP 83 (EARLY FINISH BY THE MAIN SESSION, OVERSEER STILL DECIDES) SHIPS IN 0.8.3") added a second writer, chain.js earlyFinish (kind early_finish), that writes chosen: 'early'.
    // A --finish still writes 'finish' (asserted above); the schema declares both and rejects any other value (asserted below).
    assert.deepEqual(schema.properties.stop.properties.chosen?.enum, ['finish', 'early'], 'the schema declares chosen, with the two values the writers (chain.js finishedStop: finish; earlyFinish: early) write');
    assert.doesNotMatch(schema.properties.stop.description, /only in report-partial\.json/);
    assert.ok(!validate({ ...report, stop: { ...report.stop, chosen: 'continue' } }), 'a value the writer never writes is rejected');
  } finally { p.done(); }
});

test('F5: the stop sentence names deliverable-partial.md, which exists, holds the plan with no DECLINED line (while the revise-N.md stage files DO carry them), and is gone after the person\'s --finish; report-partial.json holds no draft key', () => {
  const p = stopped('# A plan\n\nTRIGGER_DECLINED_TEST\n');
  try {
    const text = p.first.stdout + p.first.stderr;
    assert.match(text, /The plan as it stands is in deliverable-partial\.md in /);
    assert.doesNotMatch(text, /deliverable in report-partial\.json/);
    const file = join(p.runDir, 'deliverable-partial.md');
    assert.ok(existsSync(file), 'the file the sentence names exists');
    const plan = readFileSync(file, 'utf8');
    assert.ok(plan.trim().length > 0);
    const raw = readdirSync(p.runDir).filter(f => /^revise-\d+\.md$/.test(f)).map(f => readFileSync(join(p.runDir, f), 'utf8'));
    assert.ok(raw.some(t => /^DECLINED:/m.test(t)), 'the known-bad input: a revise stage file the sentence could have named DOES carry DECLINED lines');
    assert.doesNotMatch(plan, /DECLINED/, 'the DECLINED trailer lines are not part of the plan');
    assert.equal(Object.keys(JSON.parse(readFileSync(join(p.runDir, 'report-partial.json'), 'utf8'))).includes('currentDraft'), false, 'the draft is not leaked into the partial report');
    p.run(['--resume', p.runDir, '--finish']);
    assert.equal(existsSync(file), false, 'a resume cleans the partial twin like report-partial.json');
  } finally { p.done(); }
});

// F7: --continue / --finish with a report-partial.json that cannot be read. Before: the choice was dropped silently and the run went on as if nothing had been typed. Now: refused (exit 2, nothing recorded, run or spent), and a resume
// WITHOUT a choice rebuilds the file for free (the replay re-stops at the same place), after which the choice works.
// ASYNC runner for rows whose stub lives in THIS process: spawnSync would block the event loop that has to answer the child (the first run of F7-5 hung 300 s on exactly that).
const runAsync = (dir, env) => args => new Promise(done => { let out = ''; const c = spawn(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, env }); c.stdout.on('data', d => { out += d; }); c.stderr.on('data', d => { out += d; }); c.on('close', code => done({ status: code, stdout: out, stderr: '' })); });
const filesOf = dir => readdirSync(dir).sort();
const usageOf = dir => readdirSync(dir).filter(f => f.endsWith('.usage.json')).sort();
test('F7-1: a typed choice with an unreadable report-partial.json exits 2 with the way out, records nothing and runs nothing', () => {
  const p = stopped();
  try {
    writeFileSync(join(p.runDir, 'report-partial.json'), '{ not json');
    const before = { files: filesOf(p.runDir), runJson: readFileSync(join(p.runDir, 'run.json'), 'utf8'), marker: readFileSync(join(p.runDir, 'STOPPED-overseer_cap.json'), 'utf8') };
    for (const flag of ['--finish', '--continue']) {
      const r = p.run(['--resume', p.runDir, flag]);
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /report-partial\.json cannot be read \(missing or damaged\), so your choice cannot be matched to the stop it answers\. Nothing was recorded, run or spent\./);
      assert.match(r.stderr, /--resume .* once without a choice/);
      assert.deepEqual(filesOf(p.runDir), before.files, 'no stage ran, nothing was written');
      assert.equal(readFileSync(join(p.runDir, 'run.json'), 'utf8'), before.runJson, 'no choice recorded');
      assert.equal(readFileSync(join(p.runDir, 'STOPPED-overseer_cap.json'), 'utf8'), before.marker);
    }
  } finally { p.done(); }
});

test('F7-2 (zero dollars on the heal): a plain --resume with a damaged report-partial.json exits 23, makes no new usage file, rewrites the partial with the SAME stop id and the plan file, and the choice then works', () => {
  const p = stopped();
  try {
    const stop = JSON.parse(readFileSync(join(p.runDir, 'report-partial.json'), 'utf8')).stop;
    const usageBefore = usageOf(p.runDir);
    assert.ok(usageBefore.length > 0);
    const spent = d => usageOf(d).reduce((t, f) => t + (JSON.parse(readFileSync(join(d, f), 'utf8')).usd ?? 0), 0);
    const spentBefore = spent(p.runDir);
    writeFileSync(join(p.runDir, 'report-partial.json'), '{ not json');
    rmSync(join(p.runDir, 'deliverable-partial.md'), { force: true });
    const r = p.run(['--resume', p.runDir]);
    assert.equal(r.status, 23, r.stdout + r.stderr);
    assert.deepEqual(usageOf(p.runDir), usageBefore, 'no new usage file: nothing was sent');
    assert.equal(spent(p.runDir), spentBefore, 'spent is unchanged');
    let healed = null; assert.doesNotThrow(() => { healed = JSON.parse(readFileSync(join(p.runDir, 'report-partial.json'), 'utf8')).stop; }, 'the partial report was rewritten and parses');
    assert.equal(stopIdOf(healed), stopIdOf(stop), 'the same stop');
    assert.ok(existsSync(join(p.runDir, 'deliverable-partial.md')));
    const f = p.run(['--resume', p.runDir, '--finish']);
    assert.notEqual(f.status, 23, f.stdout + f.stderr);
    assert.ok(existsSync(join(p.runDir, 'report.json')));
  } finally { p.done(); }
});

test('F7-3 (C1 unchanged): a plain --resume with a READABLE report-partial.json still exits 23 and changes nothing in the folder', () => {
  const p = stopped();
  try {
    const before = filesOf(p.runDir); const partial = readFileSync(join(p.runDir, 'report-partial.json'), 'utf8');
    const r = p.run(['--resume', p.runDir]);
    assert.equal(r.status, 23, r.stdout + r.stderr);
    assert.deepEqual(filesOf(p.runDir), before);
    assert.equal(readFileSync(join(p.runDir, 'report-partial.json'), 'utf8'), partial);
  } finally { p.done(); }
});

// F7, the money question (C&C condition 2): the heal on a PAID chain. The handoff seat is paid (a loopback stub that COUNTS requests); the run stops at the overseer cap BEFORE the handoff, so the stub has seen nothing. A damaged partial report +
// a plain --resume replays the stages on disk: the stub still sees nothing and no usage file appears. The resume's cap gate (cli.js capGateOrExit, before the first reservation and the first provider call) stands in front of anything paid.
test('F7-4 (paid chain): the heal sends nothing to a paid seat and creates no usage file; the resume asks what a resume of this run always asks', async () => {
  let requests = 0;
  const srv = http.createServer((req, res) => { requests += 1; req.resume(); res.statusCode = 500; res.end('{"error":"stub"}'); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); srv.unref();
  const dir = mkdtempSync(join(tmpdir(), 'rfx-paid-')); mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  const cfg = chainOf([judge('o', 'a', 'l1', 1), judge('o', 'b', 'l2', 2), judge('x', 'c', 'l3', 3)]);
  cfg.name = 'ovpaid'; cfg.handoff = true;
  cfg.seats.handoff = { provider: 'openrouter', model: 'anthropic/claude-opus-5', originalProvider: 'anthropic', maxTokens: 500, baseUrl: `http://127.0.0.1:${srv.address().port}` };
  writeFileSync(join(dir, 'chains', 'ovpaid.json'), JSON.stringify(cfg)); writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const env = { PATH: process.env.PATH, HOME: dir, ...malformedProviderKeys(), OPENROUTER_API_KEY: `sk-or-v1-${'e'.repeat(40)}`, COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' };
  const run = runAsync(dir, env);
  try {
    const start = await run(['--chain', 'ovpaid', '--task', 'tasks/t.md']);
    assert.equal(start.status, 21, start.stdout + start.stderr);
    const runDir = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
    typeCap(runDir, '4');
    const stop = await run(['--resume', runDir]);
    assert.equal(stop.status, 23, stop.stdout + stop.stderr);
    assert.equal(requests, 0, 'the stop comes before the paid handoff seat');
    const usageBefore = usageOf(runDir);
    writeFileSync(join(runDir, 'report-partial.json'), '{ not json');
    const heal = await run(['--resume', runDir]);
    assert.equal(heal.status, 23, `the heal re-stops at the same place (exit ${heal.status}): ${heal.stdout}${heal.stderr}`.slice(0, 600));
    assert.equal(requests, 0, 'nothing was sent to the paid seat');
    assert.deepEqual(usageOf(runDir), usageBefore, 'no new usage file');
    assert.doesNotThrow(() => JSON.parse(readFileSync(join(runDir, 'report-partial.json'), 'utf8')).stop.kind, 'the partial report was rebuilt');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// F7, the missing-stage case (C&C 18 Okt 2026): the BUILDER is the paid seat (a loopback stub that serves a valid reply and COUNTS requests), so a paid stage exists BEFORE the stop. After the stop its stage file is removed by hand and the partial report is
// damaged; the plain --resume (the heal) is an ordinary resume: it re-sends that one stage, once, under the limit already typed, with a reservation written before the send, and asks no new limit question.
test('F7-5 (paid stage file missing): the heal re-sends exactly that stage once, reserved before it is sent and settled after, within the typed limit, with no new limit question', async () => {
  let requests = 0;
  const srv = http.createServer((req, res) => {
    requests += 1; req.resume();
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id: 'stub', model: 'anthropic/claude-opus-5', provider: 'StubHost', choices: [{ index: 0, message: { role: 'assistant', content: '# A plan\n\nDo the small thing.\n' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50 } }));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); srv.unref();
  const dir = mkdtempSync(join(tmpdir(), 'rfx-paid2-')); mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  const cfg = chainOf([judge('o', 'a', 'l1', 1), judge('o', 'b', 'l2', 2), judge('x', 'c', 'l3', 3)]);
  cfg.name = 'ovpaid2';
  cfg.seats.builder = { provider: 'openrouter', model: 'anthropic/claude-opus-5', originalProvider: 'anthropic', maxTokens: 500, lab: 'author', baseUrl: `http://127.0.0.1:${srv.address().port}` };
  writeFileSync(join(dir, 'chains', 'ovpaid2.json'), JSON.stringify(cfg)); writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const env = { PATH: process.env.PATH, HOME: dir, ...malformedProviderKeys(), OPENROUTER_API_KEY: `sk-or-v1-${'e'.repeat(40)}`, COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' };
  const run = runAsync(dir, env);
  const reservations = d => readFileSync(join(d, 'spend-reservations.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  try {
    const start = await run(['--chain', 'ovpaid2', '--task', 'tasks/t.md']);
    assert.equal(start.status, 21, start.stdout + start.stderr);
    const runDir = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
    typeCap(runDir, '4');
    const stop = await run(['--resume', runDir]);
    assert.equal(stop.status, 23, stop.stdout + stop.stderr);
    assert.equal(requests, 1, 'the paid build stage was sent once');
    const gatesBefore = JSON.stringify(listGates(runDir));
    writeFileSync(join(runDir, 'report-partial.json'), '{ not json');
    rmSync(join(runDir, 'build.md'));
    const heal = await run(['--resume', runDir]);
    assert.equal(heal.status, 23, `${heal.stdout}${heal.stderr}`.slice(0, 600));
    assert.equal(requests, 2, 'exactly one more request: the removed stage, asked of its seat again');
    const lines = reservations(runDir);
    assert.deepEqual(lines.map(l => l.event), ['reserved', 'settled', 'reserved', 'settled'], 'one reserved/settled pair per send, the reservation written first');
    assert.equal(lines[2].label, 'build');
    assert.equal(JSON.stringify(listGates(runDir)), gatesBefore, 'no new limit question was asked');
    // The counted spend, read the way the resume cap reads its floor (usage files + superseded/ + unsettled), must not lose the first call's dollars: it is at least both settled figures of the reservation ledger, and within the typed limit.
    const settledUsd = lines.filter(l => l.event === 'settled').reduce((t, l) => t + (Number.isFinite(l.usd) ? l.usd : 0), 0);
    const counted = budgetOf(runDir, null).spentUsd;
    assert.ok(settledUsd > 0, 'both sends were settled with a dollar figure');
    assert.ok(counted >= settledUsd - 1e-9, `counted spend ${counted} keeps both payments (settled ${settledUsd}): the first call's dollars are not lost`);
    assert.ok(counted <= 4, `counted spend ${counted} stays within the typed limit of 4`);
    assert.doesNotThrow(() => JSON.parse(readFileSync(join(runDir, 'report-partial.json'), 'utf8')).stop.kind);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
