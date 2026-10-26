// 0.8.3 M7 MEMBER VERB (conflict ask), fix-up (C&C 6d gate, 20 Okt 2026): the MONEY FENCE at the CLI, through the real program. A tree member stopped at a conflict (exit 25); run.json (project-writable text) is
// given a conflictChoices entry that covers the whole conflict but that NO node_choice in the tree record backs; the real `cli.js --resume <member folder>` must stop again at exit 25 and spend nothing (no stub is asked
// again, no spend reservation is written). Offline, $0: the judges and the decider are loopback stubs that answer from a script (as test/conflict-ask-cli.test.js does) and the member is a real tree member
// started by the product's own sitting; the decider's held prompt words are injected for the child processes only (test/helpers/inject-decider.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { echoIds } from './helpers/echo-envelope.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { objectionId } from '../src/objection-ids.js';
import { EXIT_CONFLICT_ASKED } from '../src/exit-codes.js';
import { resumeHandler } from '../src/tree-resume.js';
import { decideHandler } from '../src/tree-decide.js';
import { terminal } from './helpers/terminal.js';
import { runResumability } from '../src/run-status.js';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { realRoot } from './helpers/real-root.js';
import { pricedDebate } from './helpers/child-chains.js';
import { approvePending } from './helpers/sitting.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CR = 'The plan defines a retry limit.';
const X = { criterion: CR, problem: 'No limit on retries.', quote: 'retries failed requests' };
const Y = { criterion: CR, problem: 'No owner is named.', quote: 'The worker' };
const idX = objectionId('la', X);
const meets = JSON.stringify({ meets: true, criteria: [{ criterion: CR, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok' });
const objects = f => JSON.stringify({ meets: false, criteria: [{ criterion: CR, verdict: 'FAILED', evidence: f.problem }], failures: [f], verdict_line: 'no' });
const body = text => ({ id: 'stub', model: 'qwen/qwen3.7-plus', provider: 'StubHost', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 200, completion_tokens: 80 } });
async function scripted(script) {
  const hits = []; const srv = createServer((req, res) => { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => { hits.push(req.url); const t = echoIds(b, script[Math.min(hits.length, script.length) - 1]); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body(t))); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { hits, url: `http://127.0.0.1:${srv.address().port}/v1`, close: () => new Promise(r => srv.close(r)) };
}
const seat = (lab, layer, url) => ({ provider: 'openrouter', model: 'qwen/qwen3.7-plus', lab, ...(layer ? { layer } : {}), maxTokens: 4000, baseUrl: url });

// the shared setup: a REAL tree member stopped at a conflict (exit 25) on loopback stubs, the decider's held words injected for the child processes only; `body` gets { r, dir, hits(), cli(args) }
async function withStoppedMember(body, { repeated = false } = {}) {   // repeated: the SAME model on layers 1 and 2 under ONE lab 'q' (the layer-2 seat's key is 'q-l2', never shown to a person)
  const env0 = { NODE_OPTIONS: process.env.NODE_OPTIONS, OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY, COUNCIL_ALLOW_LOOPBACK_KEY_HOST: process.env.COUNCIL_ALLOW_LOOPBACK_KEY_HOST };
  process.env.NODE_OPTIONS = `--import ${join(root, 'test', 'helpers', 'inject-decider.js')}`; process.env.OPENROUTER_API_KEY = 'test-key-not-real'; process.env.COUNCIL_ALLOW_LOOPBACK_KEY_HOST = '1';
  const la = await scripted([objects(X), meets, objects(X), meets]); const lb = await scripted([objects(Y), meets]); const lc = await scripted([meets]);
  const dec = await scripted([JSON.stringify({ rulings: [{ conflict: 1, prevail: objectionId(repeated ? 'q-l2' : 'lb', Y), reason: 'The earlier fix stands.', ask_person: true }] })]);
  try {
    const base = pricedDebate(); delete base.maxRounds;
    const chain = { ...base, criteria: [CR], signoff: 'unanimous', maxOverseerRounds: 3, layerRevisions: { 1: 3, 2: 2 }, seats: { ...base.seats, critics: [seat(repeated ? 'q' : 'la', 1, la.url), seat(repeated ? 'q' : 'lb', 2, lb.url), seat('lc', 3, lc.url)], decider: seat('dec', null, dec.url) } };
    const r = await realRoot({ childChain: 'swing-child', extraChains: { 'swing-child': chain } }); approvePending(r);
    const o = new PassThrough(); const buf = []; o.on('data', d => buf.push(String(d)));
    const code = await resumeHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdout: o, stderr: o });
    assert.equal(code, 20, buf.join(''));
    const m = stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M1@g1');
    const dir = join(r.t.runsDir, m.runId);
    assert.ok(existsSync(join(dir, 'STOPPED-conflict.json')), 'the member is stopped at the conflict');
    // ASYNC spawn: the loopback stubs live in THIS process, so a blocking spawn would starve them and "no seat was asked again" would be true by construction
    const cli = args => new Promise(done => {
      let out = ''; const child = spawn(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: r.t.work, env: process.env });
      child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
      const timer = setTimeout(() => child.kill(), 45_000);
      child.on('exit', (status, signal) => { clearTimeout(timer); done({ status, signal, stdout: out, stderr: '' }); });
    });
    await body({ r, dir, hits: () => [la.hits.length, lb.hits.length, lc.hits.length, dec.hits.length], cli, reservations: () => { try { return readFileSync(join(dir, 'spend-reservations.jsonl'), 'utf8').split('\n').filter(l => l.includes('"event":"reserved"')).length; } catch { return 0; } } });
  } finally {
    for (const [k, v] of Object.entries(env0)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    for (const s of [la, lb, lc, dec]) await s.close();
  }
}

test('CC-1 (real verbs, money fence): a member\'s run.json holds a conflictChoices entry with NO node_choice behind it; the real `--resume <member folder>` stops again at exit 25 and no stub is asked, nothing is reserved', async () => {
  await withStoppedMember(async ({ dir, hits, cli, reservations }) => {
    // a state check, not a test seen to fail (nothing is broken): what MCP reads for this member is `person_choice` and the marker's own sentence, which names the tree's verb and never the standalone --resume
    const res0 = runResumability(dir, {});
    assert.deepEqual([res0.resumable, res0.needs], [true, 'person_choice']);
    assert.ok(res0.stoppedAt.reason.includes('--prevail-node R/M1') && !res0.stoppedAt.reason.includes('--resume'), res0.stoppedAt.reason);
    const asked = hits(); const before = reservations();
    writeFileSync(join(dir, 'run.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')), conflictChoices: [{ pass: 3, n: 1, prevail: idX, via: 'tree', at: '2026-10-20T00:00:00.000Z' }] }));
    const res = await cli(['--resume', dir]);
    // the money assertions come BEFORE the exit status: a replay that went past the conflict may run on until the timeout (status null), and the red must still name what it spent
    assert.deepEqual(hits(), asked, 'no seat was asked again');
    assert.equal(reservations(), before, 'no spend reservation (a `reserved` record) was written');
    assert.equal(res.status, EXIT_CONFLICT_ASKED, res.stdout + res.stderr);
    assert.ok(existsSync(join(dir, 'STOPPED-conflict.json')), 'the member still waits');
  });
});

test('CC-2 (real verbs): the standalone `--resume <member folder> --prevail 1=<id>` is refused for a tree member (exit 2, the message names the tree verb), writes no conflictChoices entry, asks no seat and reserves nothing', async () => {
  await withStoppedMember(async ({ dir, hits, cli, reservations }) => {
    const runJson = () => JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
    const entries0 = JSON.stringify(runJson().conflictChoices ?? null); const asked = hits(); const before = reservations();
    const res = await cli(['--resume', dir, '--prevail', `1=${idX}`]);
    // what a missing refusal WRITES comes first: the CLI would record a via 'cli' entry in run.json and replay the member past its conflict
    assert.equal(JSON.stringify(runJson().conflictChoices ?? null), entries0, 'no conflictChoices entry was written');
    assert.deepEqual(hits(), asked, 'no seat was asked'); assert.equal(reservations(), before, 'nothing was reserved');
    assert.equal(res.status, 2, res.stdout + res.stderr); assert.match(res.stdout + res.stderr, /--prevail-node R\/M1 --prevail/);
    assert.ok(existsSync(join(dir, 'STOPPED-conflict.json')), 'the member still waits');
  });
});

// the person's pick through the real verbs: `tree decide --prevail-node R/M1 --prevail 1=<id>` (text of the screen), then `tree resume` (the sitting's text)
async function decideConflictPick(r, id) {
  const t = terminal([]); const code = await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { 'prevail-node': 'R/M1', prevail: `1=${id}` }, work: r.t.work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() });
  const o = new PassThrough(); const buf = []; o.on('data', d => buf.push(String(d)));
  const rc = await resumeHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdout: o, stderr: o });
  return { code, text: t.shown() + t.errors(), resume: buf.join(''), resumeCode: rc };
}

test('CC-3 (real verbs, repeated seat): the SAME model on layers 1 and 2 meets a member conflict stop: the stop names the BARE lab with a seat field, the two ids differ, no seat key reaches a person, and the pick applies through `tree decide` + `tree resume`', async () => {
  await withStoppedMember(async ({ r, dir, cli }) => {
    const stop = JSON.parse(readFileSync(join(dir, 'report-partial.json'), 'utf8')).stop;
    const c = stop.conflicts[0];
    assert.equal(new Set(c.ids).size, c.ids.length, `the ids of one conflict are distinct: ${JSON.stringify(c)}`);
    assert.deepEqual([...c.ids].sort(), [objectionId('q', X), objectionId('q-l2', Y)].sort());
    assert.deepEqual(c.labs, ['q', 'q'], 'each party carries the bare lab'); assert.deepEqual(c.seats, ['q', 'q-l2'], 'and the seat key in its own field');
    // every place a PERSON (or the MCP host) reads the stop before the pick. Each must show the conflict (an id or the bare lab) and must not show the seat key in any spelling (`q-l2`, or its tag form QL2)
    const exit = await cli(['--resume', dir]); assert.equal(exit.status, EXIT_CONFLICT_ASKED, exit.stdout + exit.stderr);
    const o = new PassThrough(); const buf = []; o.on('data', d => buf.push(String(d)));
    await resumeHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdout: o, stderr: o });
    const marker = JSON.parse(readFileSync(join(dir, 'STOPPED-conflict.json'), 'utf8'));
    const screens = [['the member exit-25 sentence', exit.stdout + exit.stderr], ['the pre-pick tree resume screen', buf.join('')], ['the marker reason', String(marker.reason)], ['what MCP reads (stoppedAt.reason)', String(runResumability(dir, {}).stoppedAt.reason)]];
    for (const [where, text] of screens) assert.ok(!/q-?l2/i.test(text), `${where} leaked the seat key: ${text}`);
    assert.ok(screens.some(([, text]) => text.includes('--prevail-node R/M1')), 'the screens do name the person\'s verb (so a scan of them is a scan of the real sentence)');
    const decided = await decideConflictPick(r, c.ids[1]);
    assert.ok(!/q-?l2/i.test(decided.text + decided.resume), `the decide/resume screens leaked the seat key: ${decided.text}${decided.resume}`);
    assert.equal(decided.code, 0, decided.text);
    assert.equal(existsSync(join(dir, 'STOPPED-conflict.json')), false, 'the pick applied and the member went on');
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')).conflictChoices.map(e => [e.pass, e.n, e.prevail, e.via]), [[stop.pass, 1, c.ids[1], 'tree']], 'the pick that applied is the person\'s, by the tree');
  }, { repeated: true });
});
