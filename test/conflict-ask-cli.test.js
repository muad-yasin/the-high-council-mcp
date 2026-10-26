// E4b unit 3, REAL VERBS (A, 18 Okt 2026): the CLI stops at exit 25 when the conflict decider asks for the person, a plain resume only says so at $0, a bad --prevail is refused with nothing run, and a good one is recorded and the run finishes.
// Offline, $0: every judge and the decider is an OpenRouter-shaped seat served by its own loopback stub that answers from a SCRIPT (call number -> reply), so the swing of rule R happens exactly when the script says; the writer is a mock.
// The decider's prompt words are held until Muad's yes, so the CLI child is started with test/helpers/inject-decider.js (--import), which records the DRAFTED words for that process only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { echoIds } from './helpers/echo-envelope.js';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { objectionId } from '../src/objection-ids.js';
import { EXIT_CONFLICT_ASKED } from '../src/exit-codes.js';
import { readStoppedMarker } from '../src/stop-files.js';
import { runResumability } from '../src/run-status.js';
import { startTyped } from './helpers/typed-cap.js';
import { malformedProviderKeys } from './helpers/no-real-keys.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const inject = join(root, 'test', 'helpers', 'inject-decider.js');
const RUN = '2026-10-18T09-00-00-000Z';
const CRITERION = 'The plan defines a retry limit.';
const X = { criterion: CRITERION, problem: 'No limit on retries.', quote: 'retries failed requests' };
const Y = { criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker' };
const idX = objectionId('la', X); const idY = objectionId('lb', Y);
const meets = JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok' });
const objects = f => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: f.problem }], failures: [f], verdict_line: 'no' });
const body = text => ({ id: 'stub', model: 'qwen/qwen3.7-plus', provider: 'StubHost', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 200, completion_tokens: 80 } });

// CHANGED ACCEPTED TEST (decider-readiness apply patch, 24 Okt 2026; C&C ruling (b)): OLD the scripted reply went out as written. NEW it echoes the envelope ids of the request (test/helpers/echo-envelope.js), because with the verdict-envelope sentence recorded a reply without them is an abstention. WHY: src/roles.js records verdictEnvelopeSection.
// A stub that answers its n-th request with script[n-1] (the last entry repeats) and counts requests.
async function scripted(script) {
  const hits = []; const srv = createServer((req, res) => { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => { hits.push(req.url); const text = echoIds(b, script[Math.min(hits.length, script.length) - 1]); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body(text))); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { hits, url: `http://127.0.0.1:${srv.address().port}/v1`, close: () => new Promise(r => srv.close(r)) };
}
const seat = (lab, layer, url) => ({ provider: 'openrouter', model: 'qwen/qwen3.7-plus', lab, layer, maxTokens: 4000, baseUrl: url });
const spawnCli = dir => args => new Promise(done => {
  let out = '';
  const child = spawn(process.execPath, ['--import', inject, cli, ...args], { cwd: dir, env: { PATH: process.env.PATH, HOME: tmpdir(), ...malformedProviderKeys(), OPENROUTER_API_KEY: 'test-key-not-real', COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' } });
  child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  child.on('exit', code => done({ code, out }));
});

test('CD-22 (real verbs): the swing stops the run at exit 25; a plain resume says so at $0; a bad --prevail is refused with nothing run; a good one is recorded and the run finishes, the decider never paid twice', async () => {
  // pass 1 la raises X; pass 2 la is heard and silent, lb (layer 2) raises Y and a revise follows; pass 3 la raises X AGAIN (the swing); pass 4 everyone signs off.
  const la = await scripted([objects(X), meets, objects(X), meets]); const lb = await scripted([objects(Y), meets]); const lc = await scripted([meets]);
  const dec = await scripted([JSON.stringify({ rulings: [{ conflict: 1, prevail: idY, reason: 'The earlier fix stands.', ask_person: true }] })]);
  try {
    const dir = mkdtempSync(join(tmpdir(), 'thc-conflict-ask-')); mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
    writeFileSync(join(dir, 'tasks', 't.md'), 'Write a worker plan with a retry limit.\n');
    const writer = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
    writeFileSync(join(dir, 'chains', 'swing.json'), JSON.stringify({ name: 'swing', description: 'A fixture.', criteria: [CRITERION], signoff: 'unanimous', maxOverseerRounds: 3, layerRevisions: { 1: 3, 2: 2 }, estimate: { promptTokens: 1000, draftTokens: 1000, critiqueTokens: 300 }, seats: { builder: writer, reviser: writer, critics: [seat('la', 1, la.url), seat('lb', 2, lb.url), seat('lc', 3, lc.url)], decider: seat('dec', undefined, dec.url) } }));
    const run = spawnCli(dir); const rd = join(dir, 'runs', RUN);
    const first = await startTyped(run, ['--chain', 'swing', '--task', 'tasks/t.md', '--run-id', RUN], rd);
    assert.equal(first.code, EXIT_CONFLICT_ASKED, first.out);
    assert.ok(existsSync(join(rd, 'STOPPED-conflict.json')) && !existsSync(join(rd, 'report.json')), 'a stop, not a finished run');
    assert.equal(readStoppedMarker(rd).stoppedBy, 'conflict');
    const stop = JSON.parse(readFileSync(join(rd, 'report-partial.json'), 'utf8')).stop;
    assert.deepEqual([stop.kind, stop.pass, stop.conflicts[0].ids, stop.conflicts[0].decider_prevail], ['conflict', 3, [idX, idY], idY]);
    for (const piece of ['The conflict decider asks you to choose', '--prevail 1=<', 'Over MCP there is no verb']) assert.ok(first.out.includes(piece), `${piece}\n${first.out}`);
    const res = runResumability(rd, {}); assert.deepEqual([res.resumable, res.needs], [true, 'person_choice']);
    assert.equal(dec.hits.length, 1, 'the decider was asked once');
    const spent = [la.hits.length, lb.hits.length, lc.hits.length];
    // a plain resume asks nothing and spends nothing
    const plain = await run(['--resume', rd]);
    assert.equal(plain.code, EXIT_CONFLICT_ASKED, plain.out); assert.deepEqual([la.hits.length, lb.hits.length, lc.hits.length, dec.hits.length], [...spent, 1], 'no request left the process');
    // a choice that is not an objection of the conflict is refused with nothing run
    const bad = await run(['--resume', rd, '--prevail', '1=O-ffffffff']);
    assert.equal(bad.code, 2, bad.out); assert.match(bad.out, /not an objection of conflict 1/); assert.equal(la.hits.length, spent[0]);
    // --prevail without --resume, and on a run that is not stopped this way
    const lone = await run(['--chain', 'swing', '--task', 'tasks/t.md', '--prevail', idY]); assert.equal(lone.code, 2, lone.out); assert.match(lone.out, /answers a stopped run/);
    // the good choice: recorded, applied, the run finishes
    const done = await run(['--resume', rd, '--prevail', `1=${idY}`]);
    assert.ok([0, 22].includes(done.code), done.out);
    const meta = JSON.parse(readFileSync(join(rd, 'run.json'), 'utf8'));
    assert.deepEqual(meta.conflictChoices.map(c => [c.pass, c.n, c.prevail, c.via, 'by' in c]), [[3, 1, idY, 'cli', false]], 'the channel is recorded, no actor');
    const report = JSON.parse(readFileSync(join(rd, 'report.json'), 'utf8'));
    const d = report.decisions[0];
    assert.deepEqual([d.decided, d.prevail, d.via, d.decider_prevail, d.ask_person], [true, idY, 'cli', idY, true]);
    assert.equal(dec.hits.length, 1, 'the decider\'s ruling was replayed from disk: the seat was never paid twice');
    assert.ok(!existsSync(join(rd, 'STOPPED-conflict.json')), 'the stale stop file is gone');
  } finally { await la.close(); await lb.close(); await lc.close(); await dec.close(); }
});
