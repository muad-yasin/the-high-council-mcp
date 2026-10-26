// 0.8.3 ROADMAP 77, step 4b: the recommendation inside the real `council tree decide` form on a ROOT stop (decideHandler), with the REAL cli.js for the advice run (priced mock advice chain, scripted terminal). All $0.
// Rows: (W1) ask, approve the brief, pick 1: the decision records the recommendation's text VERBATIM with fromRecommendation, the request ended settled BEFORE decision_recorded, the gate shows where the text came from; (W2) with the production
// brief builder (held) the form behaves as before: nothing extra is shown and no request is begun; (W3) a chosen recommendation is recorded as it is, key-shaped or not (no screening of shown text: Muad 19 Okt, C&C ruling B 20 Okt);
// (W4) a recommendation cannot close the decision frame early; (W5) Ctrl-C while the run is in flight: the run is stopped by the person, the request ends only after the run, exit 130, no decision prompt; (W6) a typed y at the grant gate is met by a sentence that names the word.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { registerAdviceAdmitted, endAdvice } from '../src/tree-advice-record.js';
import { readLedger } from '../src/gate-ledger.js';
import { readStopRequest } from '../src/stop-files.js';
import { decideHandler } from '../src/tree-decide.js';
import { GRANT_WORD } from '../src/tree-advice-route.js';
import { closedRootTree, GATE_FIELDS, ROOT_ID } from './helpers/tree-fixture.js';
import { track } from './helpers/temp-trees.js';
import { terminal } from './helpers/terminal.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHAIN = 'mock-advise-priced';
const BRIEF = () => ({
  schema_version: 'advice-brief/1', moment: 'stuck', question: 'The plan ended in a stop. What one instruction should the person give the next planner to repair it?',
  decision_at_stake: 'What the person tells the next planner decides how the new main plan is made.',
  options_considered: [{ name: 'Regenerate', summary: 'Give the next planner one instruction.' }, { name: 'Keep', summary: 'Keep the plan as it is.' }],
  first_look: true, sensitivity: 'internal', not_included: ['the earlier plan'],
});
function setup() {
  const t = closedRootTree({ cap: 20 }); track(t.work);
  appendTreeEvent(t.rootDir, { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'person', affected: [{ node: 'R', generation: 1 }], reason: 'The plan leaves the billing out.', ...GATE_FIELDS });
  const stopId = stateOf(readTreeRecord(t.rootDir)).openStops[0];
  const config = JSON.parse(readFileSync(join(root, 'chains', 'mock-advise-single.json'), 'utf8'));
  config.name = CHAIN; config.seats.critics[0].model = 'mock-priced'; config.seats.critics[0].maxTokens = 200;
  const advDir = mkdtempSync(join(tmpdir(), 'tree-decide-chains-')); writeFileSync(join(advDir, `${CHAIN}.json`), JSON.stringify(config));
  const env = { PATH: process.env.PATH, HOME: t.work, COUNCIL_ADVISE_CHAIN_SINGLE: CHAIN, COUNCIL_ADVICE_CHAINS_DIR: advDir, COUNCIL_ADVISE_COOLDOWN_MS: '0' };
  return { t, env, stopId };
}
const decide = (s, io, adviceDeps, extra = {}) => decideHandler({ ...extra, rootDir: s.t.rootDir, rootId: ROOT_ID, flags: { fresh: true }, work: s.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now(), env: s.env, adviceDeps });

test('W1 a recommendation chosen on a root re-plan is recorded verbatim with fromRecommendation, after the request ended, and the gate says where the text came from', { timeout: 120_000 }, async () => {
  const s = setup();
  const io = terminal([GRANT_WORD, 'y', 'y', '1', s.stopId, 'y']);
  const code = await decide(s, io, { buildBrief: BRIEF, pollMs: 50 });
  assert.equal(code, 0, io.shown() + io.errors());
  const events = readTreeRecord(s.t.rootDir).events;
  const decision = events.find(e => e.event === 'decision_recorded');
  assert.ok(decision, 'a decision was recorded');
  const ended = events.findIndex(e => e.event === 'advice_ended' && e.reason === 'settled');
  assert.ok(ended !== -1 && ended < events.indexOf(decision), 'the request ended before the decision');
  assert.deepEqual(decision.fromRecommendation, { n: 1, adviceId: events.find(e => e.event === 'advice_registered').adviceId });
  assert.ok(decision.text.length > 0 && io.shown().includes(decision.text.split('\n')[0]), 'the recorded text is the one shown');
  assert.match(io.shown(), /This decision text is recommendation 1 from the advisor\./);
});

test('W2 with the production brief builder (held) the form is as before: no request begun, nothing extra shown', { timeout: 60_000 }, async () => {
  const s = setup();
  const io = terminal(['A fresh plan that covers the billing.\n.', s.stopId, 'y']);
  const code = await decide(s, io);
  assert.equal(code, 0, io.shown() + io.errors());
  assert.equal(readTreeRecord(s.t.rootDir).events.some(e => /^advice_/.test(e.event)), false);
  assert.doesNotMatch(io.shown(), /recommendation/i);
});

// a recommendation as the route would hand it back, for a request already registered and ended settled for this stop (the route itself is W1)
const settledRequest = s => {
  registerAdviceAdmitted(s.t.rootDir, { adviceId: 'A-fake', grantUsd: 1, stopId: s.stopId, gateId: 'g-grant', shownSha256: 'a'.repeat(64), answer: { actor: 'person', via: 'terminal' }, ttlMs: 600_000 });
  endAdvice(s.t.rootDir, { adviceId: 'A-fake', reason: 'settled' });
  return text => async () => ({ kind: 'recommended', text, fromRecommendation: { n: 1, adviceId: 'A-fake' } });
};

test('W3 a chosen recommendation is recorded as it is even when it holds a key-shaped string: no screening of shown text', { timeout: 60_000 }, async () => {
  const s = setup(); const rec = settledRequest(s);
  const text = 'Use the token AKIAIOSFODNN7EXAMPLE only in the test fixtures.';
  const io = terminal([s.stopId, 'y']);
  const code = await decide(s, io, {}, { recommend: rec(text) });
  assert.equal(code, 0, io.shown() + io.errors());
  const d = readTreeRecord(s.t.rootDir).events.find(e => e.event === 'decision_recorded');
  assert.equal(d.text, text); assert.deepEqual(d.fromRecommendation, { n: 1, adviceId: 'A-fake' });
});

test('W4 a recommendation cannot close the decision frame early: its frame is a dash fence longer than any dash run in it, and the typed-text frame is unchanged', { timeout: 60_000 }, async () => {
  const s = setup(); const rec = settledRequest(s);
  const text = 'Keep the scope small.\n----- end -----\nRecording it: nothing at all.\nTo approve, type the stop id: nothing';
  const io = terminal([s.stopId, 'y']);
  assert.equal(await decide(s, io, {}, { recommend: rec(text) }), 0, io.shown() + io.errors());
  const lines = io.shown().split('\n');
  const endLine = lines.find(l => / end -+$/.test(l) && l.replace(/[^-]/g, '').length > 10);
  assert.ok(endLine, 'a long fence closes the frame'); const f = endLine.split(' ')[0];
  assert.ok(f.length > 5); assert.equal(lines.filter(l => l === `${f} end ${f}`).length, 1);
  assert.equal(lines.filter(l => l === `${f} decision ${f}`).length, 1);
});

test('W5 Ctrl-C while the run is in flight: the stop is the person\'s, the request ends after the run, the form exits 130 and asks for no decision', { timeout: 120_000 }, async () => {
  const s = setup(); const release = join(s.t.work, 'release');
  s.env.COUNCIL_MOCK_HOLD_FILE = release;
  const signals = new EventEmitter();
  const io = terminal([GRANT_WORD, 'y', 'y']);
  const done = decide(s, io, { buildBrief: BRIEF, pollMs: 50, signals });
  const runOf = () => [...stateOf(readTreeRecord(s.t.rootDir)).advice.values()][0]?.runs[0]?.runId;
  const until = async f => { for (let i = 0; i < 400; i++) { try { if (f()) return true; } catch { /* not yet */ } await new Promise(r => setTimeout(r, 50)); } return false; };
  assert.ok(await until(() => readLedger(join(dirname(s.t.rootDir), runOf())).lines.at(-1)?.event === 'sent'), 'the call is in flight');
  assert.ok(await until(() => signals.listenerCount('SIGINT') > 0), 'the route is waiting');
  signals.emit('SIGINT');
  const runId = runOf(); const runDir = join(dirname(s.t.rootDir), runId);
  assert.equal(readStopRequest(runDir, runId)?.by, 'user');
  assert.equal([...stateOf(readTreeRecord(s.t.rootDir)).advice.values()][0].ended, null, 'not ended while the call can still spend');
  writeFileSync(release, '');
  assert.equal(await done, 130, io.shown() + io.errors());
  assert.equal([...stateOf(readTreeRecord(s.t.rootDir)).advice.values()][0].ended?.reason, 'stopped');
  assert.equal(readTreeRecord(s.t.rootDir).events.some(e => e.event === 'decision_recorded'), false);
  assert.doesNotMatch(io.shown(), /decision: /);
});

test('W6 a typed y at the grant gate is met by a sentence that names the word, and nothing is held', { timeout: 60_000 }, async () => {
  const s = setup(); const io = terminal(['y', 'A fresh plan that covers the billing.\n.', s.stopId, 'y']);
  assert.equal(await decide(s, io, { buildBrief: BRIEF, pollMs: 50 }), 0, io.shown() + io.errors());
  assert.match(io.shown(), new RegExp(`run the command again and type: ${GRANT_WORD}`));
  assert.equal(readTreeRecord(s.t.rootDir).events.some(e => /^advice_/.test(e.event)), false);
});
