// 0.8.4 D10 slice 2c-3 (H17; C&C's ruling (ii)): the MCP tools and a run stopped at an excerpt approval. resume() in src/mcp/server.js is the ONE place resume_run, submit_stage and the limit dialog's resume spawn the CLI; it
// answers a run with an excerpt_approval gate that has no excerpts_recorded line BEFORE the spawn, with the state, the code (26) and words that name the gate and say only a person answers it. run_status reports the state with its
// code and a state text that is true. The session never answers the gate: nothing here can. Offline, $0: a mock chain with an external builder seat; the gate is made through the gate module; the tools run over a real stdio session.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// guarded: on a tree without these exports (the red tree of the unit) each row fails by itself at its first use, instead of one load failure for the file; nothing is skipped
const { requestGate, answerGate, recordExcerptsRecorded, recordExcerptSwitchOn } = await import('../src/gate.js');
const { writeStoppedMarker } = await import('../src/stop-files.js');
import { LEDGER_FILE } from '../src/gate-ledger.js';
import { malformedProviderKeys } from './helpers/no-real-keys.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const dirs = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });
const EX = [{ id: 'E-1', lines: null, text_sha256: 'a'.repeat(64), shown_lines: 2 }];

function session(cwd, calls, timeoutMs = 60_000) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [cli, '--mcp'], { cwd, env: { PATH: process.env.PATH, HOME: cwd, ...malformedProviderKeys() } });
    const answers = []; let buf = ''; let next = 0; let err = '';
    child.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => { child.kill(); fail(new Error(`timed out after ${answers.length} answers; stderr: ${err}`)); }, timeoutMs);
    const send = m => child.stdin.write(`${JSON.stringify(m)}\n`);
    const sendNext = () => {
      if (next >= calls.length) { clearTimeout(timer); child.stdin.end(); child.kill(); return done(answers); }
      send({ jsonrpc: '2.0', id: next + 2, method: 'tools/call', params: calls[next++] });
    };
    child.stdout.on('data', d => {
      buf += d; let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.id === 1) { send({ jsonrpc: '2.0', method: 'notifications/initialized' }); sendNext(); }
        else if (m.id !== undefined) { answers.push(JSON.parse(m.result.content[0].text)); sendNext(); }
      }
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'excerpt-approval-test', version: '0' } } });
  });
}
// `ago` minutes in the past the gate was asked (a gate lives ten minutes, so 20 gives an expired one); `answer` answers it a minute later: 'approve' (answers recorded, not applied) or 'decline'
function stoppedRun({ ago = 0, answer = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-mcp-excerpt-')); dirs.push(dir);
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small command-line tool that renames photos by the date they were taken.\n');
  const cfg = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  writeFileSync(join(dir, 'chains', 'p.json'), JSON.stringify({ ...cfg, name: 'p', seats: { ...cfg.seats, builder: { provider: 'external', model: 'x', lab: 'ext' } } }));
  const started = spawnSync(process.execPath, [cli, '--chain', 'p', '--task', 'tasks/t.md'], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH, HOME: dir }, timeout: 90_000 });
  assert.equal(started.status, 3, started.stdout + started.stderr);
  const id = readdirSync(join(dir, 'runs')).filter(d => !d.includes('.'))[0];
  const rd = join(dir, 'runs', id);
  writeFileSync(join(rd, 'excerpt-screen.md'), 'Excerpt 1 of 1\n1  one\n2  two\n');
  const t0 = Date.now() - ago * 60_000;
  const g = requestGate(rd, { kind: 'excerpt_approval', textPath: 'excerpt-screen.md', excerpts: EX }, { now: () => t0 }).gate;
  if (answer) assert.equal(answerGate(rd, g.id, { channel: 'cli', shownSha256: g.sha256, decision: answer === 'approve' ? 'approved' : 'declined', actor: 'alice', tty: true, ...(answer === 'approve' ? { excerptAnswers: [{ id: 'E-1', decision: 'approve' }] } : {}) }, { now: () => t0 + 60_000 }).ok, true);
  const stage = readdirSync(rd).find(f => f.startsWith('NEEDS-')).replace(/^NEEDS-/, '').replace(/\.md$/, '');
  return { dir, id, rd, g, stage };
}
const logsIn = dir => readdirSync(dir).filter(f => /^council-\d+\.log$/.test(f));

test('run_status reports the state WITH its code and a true state text: awaiting_excerpt_approval, not resumable, the gate and exit 26, and "waiting for a person" rather than "stopped without a report (crashed ...)"', async () => {
  const { dir, id, g } = stoppedRun();
  const [status] = await session(dir, [{ name: 'run_status', arguments: { run: id } }]);
  assert.equal(status.status, 'awaiting_excerpt_approval', JSON.stringify(status).slice(0, 500));
  assert.deepEqual([status.resumable.resumable, status.resumable.needs, status.resumable.gate, status.resumable.exitCode], [false, 'excerpt_approval', g.id, 26]);
  assert.match(status.state, /^stopped at an approval of excerpts of the project: it waits for a person's answers \(nothing was run and nothing was spent\)$/);
  assert.equal(/crashed/.test(status.state), false);
});

test('resume_run on such a run is answered BEFORE any spawn: resumed false, the state, requires_user, exit_code 26, the gate, and words that name the gate and say only a person answers it (the terminal command for a gate that waits)', async () => {
  const { dir, id, g, rd } = stoppedRun();
  const [r] = await session(dir, [{ name: 'resume_run', arguments: { run: id } }]);
  assert.deepEqual([r.resumed, r.state, r.requires_user, r.exit_code, r.gate, r.paid_started], [false, 'awaiting_excerpt_approval', true, 26, g.id, false], JSON.stringify(r));
  assert.match(r.next, /This run is stopped at an approval of excerpts of the project \(gate g1\): it waits for a person's answers\. Only a person answers it, at a terminal with `.*gate answer .*`; this tool cannot\. A resume is refused until a person has answered, and the resume after that records the answers\./);
  assert.ok(r.next.includes(`gate answer ${join('runs', id)} ${g.id}`));
  assert.match(r.next, /Nothing was run and nothing was spent\.$/);
  assert.deepEqual(logsIn(dir), [], 'nothing was spawned: no CLI log was opened');
  assert.equal(existsSync(join(rd, '.council.lock')), false);
});

test('the words follow the gate\'s status: only a gate that waits for a person says so, names the terminal command and sets requires_user; an answered, declined or expired gate says what the record holds (run_status and resume_run)', async () => {
  const cases = [
    ['approved, not applied', { ago: 5, answer: 'approve' }, /: it has the person's answers, which are not applied yet \(nothing/, /: it has the person's answers, which are not applied yet\. A resume is refused until they are applied\. Nothing was run and nothing was spent\.$/],
    ['declined', { ago: 5, answer: 'decline' }, /: it was declined, which is not applied yet \(nothing/, /: it was declined, which is not applied yet\. A resume is refused until that is applied\. Nothing was run and nothing was spent\.$/],
    ['expired', { ago: 20 }, /: it ran out of time before it was answered \(nothing/, /: it ran out of time before it was answered\. A resume is refused until it is asked again\. Nothing was run and nothing was spent\.$/],
  ];
  for (const [what, opts, stateRe, nextRe] of cases) {
    const { dir, id } = stoppedRun(opts);
    const [status, r] = await session(dir, [{ name: 'run_status', arguments: { run: id } }, { name: 'resume_run', arguments: { run: id } }]);
    assert.match(status.state, stateRe, `${what}: ${status.state}`);
    assert.equal(/waiting for a person|waits for a person/.test(status.state), false, `${what}: nothing waits on a person: ${status.state}`);
    assert.deepEqual([r.resumed, r.state, r.requires_user, r.exit_code], [false, 'awaiting_excerpt_approval', false, 26], `${what}: ${JSON.stringify(r)}`);
    assert.match(r.next, nextRe, `${what}: ${r.next}`);
    assert.equal(/Only a person answers it|gate answer/.test(r.next), false, `${what}: no instruction to answer a gate that has its answer: ${r.next}`);
  }
});

test('submit_stage on such a run saves the stage answer but does not resume the run (the same answer, the state and the code); the saved answer is on disk as given', async () => {
  const { dir, id, rd, g, stage } = stoppedRun();
  const [r] = await session(dir, [{ name: 'submit_stage', arguments: { run: id, stage, content: '# The builder\'s answer\n\nA plan.\n' } }]);
  assert.equal(r.written, `${stage}.md`, JSON.stringify(r).slice(0, 400));
  assert.deepEqual([r.resumed, r.state, r.exit_code, r.gate], [false, 'awaiting_excerpt_approval', 26, g.id]);
  assert.ok(readFileSync(join(rd, `${stage}.md`), 'utf8').includes('# The builder\'s answer\n\nA plan.'), 'the answer is on disk as given');
  assert.deepEqual(logsIn(dir), [], 'no CLI was spawned');
});

test('a gate with its excerpts_recorded line no longer stops the tools: resume_run goes on (it spawns the CLI again), and the answered-but-not-applied state still refuses', async () => {
  const { dir, id, rd, g } = stoppedRun();
  assert.equal(answerGate(rd, g.id, { channel: 'cli', shownSha256: g.sha256, decision: 'approved', actor: 'alice', tty: true, excerptAnswers: [{ id: 'E-1', decision: 'approve' }] }).ok, true);
  const [still] = await session(dir, [{ name: 'resume_run', arguments: { run: id } }]);
  assert.deepEqual([still.resumed, still.exit_code], [false, 26], 'answered but not applied: still refused');
  assert.equal(recordExcerptsRecorded(rd, g.id, { runId: id, count: 1 }).ok, true);
  const [lifted] = await session(dir, [{ name: 'resume_run', arguments: { run: id } }]);
  assert.equal(lifted.resumed, true, JSON.stringify(lifted).slice(0, 400));
  assert.notEqual(lifted.state, 'awaiting_excerpt_approval');
  // the resumed CLI is detached and may still be running: wait (bounded) until it has let go of the run folder, so nothing writes into it while the test's cleanup removes it
  for (let waited = 0; existsSync(join(rd, '.council.lock')) && waited < 15_000; waited += 100) await new Promise(r => setTimeout(r, 100));
  assert.equal(existsSync(join(rd, '.council.lock')), false, 'the resumed run stopped again (it pauses at its external seat)');
});

test('a relayed raise (resume_run with max_usd and person_words) at such a stop gets the same plain stop with relayed false, and nothing is recorded or used: no CLI is spawned and the gate ledger is byte for byte what it was (the relay of D\'s H10 runs only after the pre-check)', async () => {
  const { dir, id, rd, g } = stoppedRun();
  const before = readFileSync(join(rd, LEDGER_FILE));
  const [r] = await session(dir, [{ name: 'resume_run', arguments: { run: id, max_usd: 12, person_words: 'Raise it to $12.' } }]);
  assert.deepEqual([r.resumed, r.state, r.exit_code, r.gate, r.relayed, r.paid_started], [false, 'awaiting_excerpt_approval', 26, g.id, false, false], JSON.stringify(r).slice(0, 500));
  assert.equal(r.note, undefined, 'the note of an opened-but-unanswered raise is for a resumed run only');
  assert.ok(readFileSync(join(rd, LEDGER_FILE)).equals(before), 'nothing was appended: no raise screen was opened, no figure recorded');
  assert.deepEqual(logsIn(dir), [], 'no CLI was spawned');
});

test('a raise of the limit (resume_run with raise_limit: true) at such a stop gets the same plain stop with raised false, and nothing is recorded or opened: the excerpt answer sits before every raise branch of resume(), so no CLI is spawned and the gate ledger is byte for byte what it was', async () => {
  const { dir, id, rd, g } = stoppedRun();
  const before = readFileSync(join(rd, LEDGER_FILE));
  const [r] = await session(dir, [{ name: 'resume_run', arguments: { run: id, raise_limit: true } }]);
  assert.deepEqual([r.resumed, r.state, r.exit_code, r.gate, r.raised, r.paid_started], [false, 'awaiting_excerpt_approval', 26, g.id, false, false], JSON.stringify(r).slice(0, 500));
  assert.equal(r.note, undefined, 'the note of an unopened raise is for a resumed run only');
  assert.ok(readFileSync(join(rd, LEDGER_FILE)).equals(before), 'nothing was appended: no raise screen was opened');
  assert.deepEqual(logsIn(dir), [], 'no CLI was spawned');
});

test('CARRIED FIX: run_status of a run that carries an owner-pause marker AND an open excerpt gate agrees with itself: status AND state say the excerpt approval, never owner_paused', async () => {
  const { dir, id, rd } = stoppedRun();
  writeStoppedMarker(rd, { stoppedBy: 'owner_pause', beforeFirstCall: false, spentUsd: 0, resumeAfterStop: true, reason: 'paused after the round' });
  const [status] = await session(dir, [{ name: 'run_status', arguments: { run: id } }]);
  assert.equal(status.status, 'awaiting_excerpt_approval', JSON.stringify(status).slice(0, 400));
  assert.match(status.state, /^stopped at an approval of excerpts of the project: it waits for a person's answers/);
  assert.equal(/owner|paused/.test(status.state), false, status.state);
});

test('WITH THE SWITCH ON an answered gate is not a stop: run_status says awaiting_excerpt_approval with the answers in (the next resume applies them) and resume_run spawns (the resume records the answers); a gate that still waits for the person stops as before', async () => {
  const { dir, id, rd, g } = stoppedRun();
  assert.equal(recordExcerptSwitchOn(rd, { source: 'flag' }).ok, true);
  const [pending] = await session(dir, [{ name: 'resume_run', arguments: { run: id } }]);
  assert.deepEqual([pending.resumed, pending.exit_code, pending.requires_user], [false, 26, true]);
  assert.equal(answerGate(rd, g.id, { channel: 'cli', shownSha256: g.sha256, decision: 'approved', actor: 'alice', tty: true, excerptAnswers: [{ id: 'E-1', decision: 'approve' }] }).ok, true);
  const [status, resumed] = await session(dir, [{ name: 'run_status', arguments: { run: id } }, { name: 'resume_run', arguments: { run: id } }]);
  // CHANGED ACCEPTED (C&C 09 Nov 2026, the run_status finding): OLD assert.notEqual(status.status, 'awaiting_excerpt_approval'); NEW the status is awaiting_excerpt_approval and the state says the answers are in and the next resume applies them. WHY: an answered, unapplied gate is a state the run is in (like an approved limit gate); reading it as a crashed run said "needs nothing" while a resume is needed
  assert.equal(status.status, 'awaiting_excerpt_approval');
  assert.match(status.state, /the person's answers are in \(approved\) and the next resume applies them/);
  assert.equal(resumed.resumed, true, JSON.stringify(resumed).slice(0, 400));
  for (let waited = 0; existsSync(join(rd, '.council.lock')) && waited < 15_000; waited += 100) await new Promise(r => setTimeout(r, 100));
});
