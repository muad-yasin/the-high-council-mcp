// 0.8.4 16c-MCP: the MCP tool `pause_run` and the state words of an owner pause over MCP (MERGE_ORDER row 16c-MCP; R380's two bound limits). Offline, $0.
//   PR-1 relayed (person_words): by person, channel session, the words and the relay sentence;  PR-2 the session's own (reason): by handler, channel session;  PR-3 neither is refused (an MCP call is never the person at a terminal);
//   PR-4 both refused;  PR-5 blank words, blank reason and a reason over 400 characters write nothing;  PR-6 a run nobody runs, a tree member, a request already open, a bad id: refused, nothing written;
//   PR-7 the real server: the tool is listed, records through the wire, a refusal names its `error` untrusted;  PR-8 the state words of an owner pause (library: stopStateOf; wire: run_status);  PR-9 the one mapping (pauseAskOf) both entry points use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const pause = await import('../src/mcp/pause.js').catch(() => ({}));   // guarded: a tree without the module still loads this file and each row fails on its own
import * as rc from '../src/run-controls.js';
import * as stopFiles from '../src/stop-files.js';
import { LOCK_FILE } from '../src/run-lock.js';
import { mcpCalls } from './helpers/mcp-calls.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUN = '2026-11-08T10-00-00-000Z';
const now = () => Date.parse('2026-11-08T10:00:00.000Z');
const RELAY = rc.RELAY_REASON;
// a cwd with runs/<RUN>: stage files for pass 1, run.json, and (live) a lock held by a live process that is not this one (the test runner's parent)
const project = ({ live = true, meta = { chain: 'lad', task: 'tasks/t.md' } } = {}) => {
  const cwd = mkdtempSync(join(tmpdir(), 'pause-run-'));
  const dir = join(cwd, 'runs', RUN); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'run.json'), JSON.stringify(meta));
  for (const f of ['panel-1-l1.md', 'critique-1.md']) writeFileSync(join(dir, f), 'x\n');
  if (live) writeFileSync(join(dir, LOCK_FILE), JSON.stringify({ pid: process.ppid, host: hostname(), at: new Date().toISOString(), nonce: 'x' }));
  return { cwd, runsDir: join(cwd, 'runs'), dir };
};
const events = dir => { const f = join(dir, 'gate-ledger.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []; };
const out = r => JSON.parse(r.content[0].text);
const call = (p, args) => out(pause.pauseRunResult({ runsDir: p.runsDir, args, now }));
const done = p => rmSync(p.cwd, { recursive: true, force: true });

test('PR-1 person_words records the PERSON\'s relayed request: by person, channel session, the words as given, the relay sentence; it names the pass', () => {
  const p = project();
  try {
    const r = call(p, { run: RUN, person_words: 'Yes, please pause it after this round.' });
    assert.equal(r.paused_requested, true, JSON.stringify(r));
    assert.deepEqual([r.run, r.pass, r.by, typeof r.request], [RUN, 1, 'person', 'number']);
    assert.match(r.note, /resume_run with only the run id/);
    const ev = events(p.dir);
    assert.equal(ev.length, 1);
    assert.deepEqual([ev[0].event, ev[0].by, ev[0].channel, ev[0].person_words, ev[0].reason, ev[0].pass], ['pause_requested', 'person', 'session', 'Yes, please pause it after this round.', RELAY, 1]);
  } finally { done(p); }
});

test('PR-2 reason records the session\'s OWN request: by handler, channel session, its reason, no person words', () => {
  const p = project();
  try {
    const r = call(p, { run: RUN, reason: 'the build check looks wrong, I want to read the draft' });
    assert.equal(r.paused_requested, true, JSON.stringify(r));
    assert.equal(r.by, 'handler');
    const ev = events(p.dir);
    assert.deepEqual([ev[0].by, ev[0].channel, ev[0].person_words, ev[0].reason], ['handler', 'session', null, 'the build check looks wrong, I want to read the draft']);
  } finally { done(p); }
});

test('PR-3 neither person_words nor reason is refused and writes nothing: an MCP call is never the person at a terminal, so the bare form has no MCP form', () => {
  const p = project();
  try {
    const r = call(p, { run: RUN });
    assert.equal(r.paused_requested, false);
    assert.match(r.error, /needs person_words .* or reason .*A session cannot ask as the person at a terminal\. Nothing was recorded\./);
    assert.deepEqual(events(p.dir), []);
  } finally { done(p); }
});

test('PR-4 both person_words and reason is refused and writes nothing (a request that is the person\'s carries no reason of its own)', () => {
  const p = project();
  try {
    const r = call(p, { run: RUN, person_words: 'Yes.', reason: 'and mine' });
    assert.equal(r.paused_requested, false);
    assert.match(r.error, /not both: a request that is the person's carries no reason of its own\. Nothing was recorded\./);
    assert.deepEqual(events(p.dir), []);
  } finally { done(p); }
});

test('PR-5 blank person_words, a blank reason and a reason over 400 characters are refused by the ledger\'s own rules, the same words as the verb, and write nothing', () => {
  const p = project();
  try {
    for (const args of [{ run: RUN, person_words: '' }, { run: RUN, person_words: '   ' }, { run: RUN, reason: '' }, { run: RUN, reason: '  ' }, { run: RUN, reason: 'x'.repeat(401) }]) {
      const r = call(p, args);
      assert.equal(r.paused_requested, false, JSON.stringify(args).slice(0, 80));
      assert.match(r.error, /Nothing was recorded\.$/);
    }
    assert.deepEqual(events(p.dir), []);
    assert.equal(call(p, { run: RUN, reason: 'x'.repeat(400) }).paused_requested, true, 'exactly 400 characters is accepted');
  } finally { done(p); }
});

test('PR-6 refusals write nothing: a run nobody is running, a member of a tree, a request already open, a bad id, a folder that is no run', () => {
  const idle = project({ live: false });
  const member = project({ meta: { chain: 'lad', task: 'tasks/t.md', tree: { root: 'x' } } });
  const open = project();
  const norun = project(); rmSync(join(norun.dir, 'run.json'));
  try {
    const a = call(idle, { run: RUN, reason: 'r' });
    assert.equal(a.paused_requested, false); assert.match(a.error, /the run is not running/); assert.deepEqual(events(idle.dir), []);
    const b = call(member, { run: RUN, reason: 'r' });
    assert.equal(b.paused_requested, false); assert.match(b.error, /member of a tree/); assert.deepEqual(events(member.dir), []);
    assert.equal(call(open, { run: RUN, reason: 'first' }).paused_requested, true);
    const c = call(open, { run: RUN, reason: 'second' });
    assert.equal(c.paused_requested, false); assert.match(c.error, /waits to be taken/); assert.equal(events(open.dir).length, 1);
    assert.deepEqual([call(open, { run: '../x', reason: 'r' }).error, call(open, { run: undefined, reason: 'r' }).error, call(open, { run: '2026-01-01T00-00-00-000Z', reason: 'r' }).paused_requested], ['no such run', 'no such run', false]);
    const d = call(norun, { run: RUN, reason: 'r' });
    assert.equal(d.paused_requested, false); assert.match(d.error, /is not a run folder\. Nothing was recorded\./); assert.deepEqual(events(norun.dir), []);
  } finally { [idle, member, open, norun].forEach(done); }
});

test('PR-7 over the real MCP server: pause_run is registered and records through the wire, and a refusal\'s error is named untrusted', async () => {
  const p = project();
  try {
    const res = await mcpCalls(p.cwd, [
      { name: 'pause_run', arguments: { run: RUN, reason: 'read the draft first' } },
      { name: 'pause_run', arguments: { run: RUN, reason: 'again' } },
      { name: 'pause_run', arguments: { run: RUN } },
    ]);
    const first = JSON.parse(res.get(2).result.content[0].text);
    assert.equal(first.paused_requested, true, JSON.stringify(first));
    const second = JSON.parse(res.get(3).result.content[0].text);
    assert.equal(second.paused_requested, false);
    assert.ok(Array.isArray(second.untrusted_fields) && second.untrusted_fields.includes('error'), `a refusal's error is named untrusted: ${JSON.stringify(second).slice(0, 300)}`);
    const third = JSON.parse(res.get(4).result.content[0].text);
    assert.match(third.error, /needs person_words/);
    assert.equal(events(p.dir).length, 1, 'only the first call recorded');
  } finally { done(p); }
});

test('PR-8 the state words of an owner pause: stopStateOf says paused-and-waiting-to-resume for owner_pause, the round-stop words for every other cause; run_status over the wire reads the marker', async () => {
  assert.equal(stopFiles.stopStateOf('owner_pause'), stopFiles.OWNER_PAUSED_STATE);
  for (const cause of ['overseer_cap', 'layer_bound', 'price_refused', 'conflict', 'user', undefined]) assert.equal(stopFiles.stopStateOf(cause), stopFiles.ROUND_STOPPED_STATE, String(cause));
  assert.doesNotMatch(stopFiles.OWNER_PAUSED_STATE, /choice/);
  const p = project({ live: false });
  try {
    stopFiles.writeStoppedMarker(p.dir, { stoppedBy: 'owner_pause', beforeFirstCall: false, spentUsd: 0, resumeAfterStop: true, requestSeq: 1 });
    const res = await mcpCalls(p.cwd, [{ name: 'run_status', arguments: { run: RUN } }, { name: 'list_runs', arguments: {} }]);
    const st = JSON.parse(res.get(2).result.content[0].text);
    assert.equal(st.status, 'owner_paused');
    assert.ok(String(st.state).includes(stopFiles.OWNER_PAUSED_STATE), `run_status state: ${st.state}`);   // (the field is named untrusted: its text may be wrapped, so it is matched, not compared)
    const row = JSON.parse(res.get(3).result.content[0].text);
    assert.match(JSON.stringify(row), new RegExp(stopFiles.OWNER_PAUSED_STATE.slice(0, 30)));
    assert.doesNotMatch(JSON.stringify(row), /waiting for the person's choice/);
  } finally { done(p); }
});

test('PR-9 the one mapping: pauseAskOf is what the verb and the tool both use; both given is refused, neither is the bare form the caller must check a terminal for, and the person\'s channel is never taken for a session', () => {
  assert.deepEqual(rc.pauseAskOf({ personWords: 'Yes', reason: undefined }), { ok: true, bare: false, ask: { by: 'person', channel: 'session', personWords: 'Yes', reason: RELAY } });
  assert.deepEqual(rc.pauseAskOf({ reason: 'mine' }), { ok: true, bare: false, ask: { by: 'handler', channel: 'session', reason: 'mine' } });
  assert.deepEqual(rc.pauseAskOf({}), { ok: true, bare: true, ask: { by: 'person', channel: 'cli' } });
  assert.deepEqual(rc.pauseAskOf({ personWords: 'a', reason: 'b' }), { ok: false, code: 'pause_both' });
  assert.deepEqual(rc.pauseAskOf({ personWords: 7, reason: null }), { ok: true, bare: true, ask: { by: 'person', channel: 'cli' } }, 'a non-string is not given');
});

test('PR-10 the stopped answers read their state words by the stop cause (R380 limit 2): server.js no longer names ROUND_STOPPED_STATE, imports stopStateOf and calls it at the run summary, start_run\'s stopped answer and the resume\'s stopped answer', () => {
  const src = readFileSync(join(root, 'src', 'mcp', 'server.js'), 'utf8');   // a source pin, like mcp-run-end-state\'s on childEndOf: the live second exit 23 is timing-dependent and is not driven here
  assert.equal(/ROUND_STOPPED_STATE/.test(src), false, 'the round-stop words are chosen by the cause (stopStateOf), not named at a site');
  assert.match(src, /import \{[^}]*\bstopStateOf\b[^}]*\} from '\.\.\/stop-files\.js';/);
  // FINDING (not on the owed list of the ladder unit; the first box run, 10 Nov 2026). OLD: 3. NEW: 4. WHY: resume() names a found-secret pause that sits beside a spending stop's files FIRST and answers with stopStateOf('secret_pause') before it spawns anything (src/mcp/server.js, the pre-check at the head of resumeOnce).
  assert.equal((src.match(/stopStateOf\(/g) ?? []).length, 4, 'four sites: the run summary, start_run\'s stopped answer, the resume\'s stopped answer, the resume\'s pre-check of a secret pause beside a spending stop');
});
