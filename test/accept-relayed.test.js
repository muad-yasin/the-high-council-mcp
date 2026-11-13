// 0.8.4 (the ladder unit, the relayed accept; C&C 10 Nov: typed = relayed): the PERSON's acceptance of a plan a run ended without agreement on, carried by the handling session with the person's own words (step accept of stop_decide with person_words). Recorded as the
// person's (actor person, channel session, relayed true, the words beside the relay sentence); the session's own accept stays refused where a stop was the person's. The envelope is test/accept-flow.test.js (a layered mock chain stopped at the overseer cap, then --finish,
// whose finish was typed at a terminal, so the session may not accept on its own). Offline, $0. WRITTEN WITHOUT A RUN (no tests on the laptop): the first run on the box decides.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { acceptancesOf, answerAcceptanceAsSession, answerGate, RELAY_REASON } from '../src/gate.js';
import { stopDecideResult } from '../src/mcp/stop-decide.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const judge = (pattern, id, lab, layer) => ({ provider: 'mock', model: `mock-critic-script-${pattern}-${id}`, lab, layer });
const made = [];
test.after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });
let seq = 0;
function finished() {
  seq += 1;
  const dir = mkdtempSync(join(tmpdir(), 'acc-rel-')); made.push(dir);
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'ovc.json'), JSON.stringify({ name: 'ovc', signoff: 'unanimous', maxOverseerRounds: 2, layerRevisions: { 1: 2, 2: 1 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 }, handoff: true, handoff_contract: { milestones: true }, dispute: { enabled: true, stall_rounds: 99 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, handoff: { provider: 'mock', model: 'mock-handoff-milestones' }, critics: [judge('o', `ra${seq}`, 'l1', 1), judge('o', `rb${seq}`, 'l2', 2), judge('x', `rc${seq}`, 'l3', 3)] } }));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const council = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 120_000 });
  const runId = () => readdirSync(join(dir, 'runs'))[0]; const runDir = () => join(dir, 'runs', runId());
  assert.equal(council(['--chain', 'ovc', '--task', 'tasks/t.md']).status, 23);
  assert.notEqual(council(['--resume', runDir(), '--finish']).status, 23);
  return { dir, runDir, runId, runsDir: join(dir, 'runs') };
}
const call = async (p, args) => JSON.parse((await stopDecideResult({ runsDir: p.runsDir, args: { run: p.runId(), ...args }, resumeWith: async () => ({}) })).content[0].text);
const report = p => JSON.parse(readFileSync(join(p.runDir(), 'report.json'), 'utf8'));
const WORDS = 'Yes, accept the plan as it stands.';
const NO_ADVISOR = { reason: 'Nothing here changes the plan.', advisor: 'none', advisor_said: '' };

test('RA-1: where the session may not accept on its own authority (the finish was typed at a terminal), the quote still gives the question and says both ways (the terminal command, or the person\'s words relayed); the relayed accept is recorded as the person\'s: actor person, channel session, relayed true, the words, the relay sentence as the reason; the HANDOFF line says whose words and relayed; the report validates', async () => {
  const p = finished();
  const q = await call(p, { step: 'quote' });
  assert.equal(q.requires_user, true, JSON.stringify(q).slice(0, 300));
  assert.equal(q.error, undefined, 'a note, not an error: the question is asked');
  assert.match(q.note, /answered at the terminal, so accepting this plan is the person's/); assert.match(q.note, /council accept runs\//); assert.match(q.note, /person_words/);
  assert.ok(q.gate && q.shown, 'the question is asked: a gate and the hash');
  const own = await call(p, { step: 'accept', gate: q.gate, shown: q.shown, ...NO_ADVISOR, objections: q.objections.map(id => ({ id, person_test: { session: { person: 'no', unsettled_by_record: false, preference: false, reason: 'A fact.' }, advisor: { person: 'no', unsettled_by_record: false, preference: false, reason: 'no advisor' } } })) });
  assert.equal(own.requires_user, true, 'the session\'s own accept is still refused here'); assert.deepEqual(acceptancesOf(p.runDir()).accepted, []);
  const r = await call(p, { step: 'accept', gate: q.gate, shown: q.shown, person_words: WORDS });
  assert.equal(r.error, undefined, JSON.stringify(r).slice(0, 400));
  assert.deepEqual([r.recorded.kind, r.recorded.actor, r.recorded.channel, r.recorded.relayed], ['accept', 'person', 'session', true]);
  const acc = report(p).acceptance;
  assert.deepEqual([acc.actor, acc.channel, acc.relayed, acc.person_words, acc.reason, acc.advisor], ['person', 'session', true, WORDS, RELAY_REASON, undefined]);
  const handoff = readFileSync(join(p.runDir(), 'HANDOFF.md'), 'utf8');
  assert.match(handoff, /by the person's words, relayed by the handling session on \d{4}-\d\d-\d\d: Yes, accept the plan as it stands\./);
  const ajv = new Ajv2020({ strict: false, allErrors: true }); ajv.addFormat('date-time', true);
  assert.ok(ajv.compile(JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8')))(report(p)), 'the report validates against the schema');
});

test('RA-2: a relayed accept without words, with the session\'s own fields, with words that hold a credential-shaped string, with the wrong hash, or a direct gate call that is not exactly { relayed: true } or lacks the words or the relay sentence, is refused with nothing recorded', async () => {
  const p = finished();
  const q = await call(p, { step: 'quote' });
  const before = JSON.stringify(acceptancesOf(p.runDir()));
  assert.match((await call(p, { step: 'accept', gate: q.gate, shown: q.shown, person_words: '  ' })).error, /needs their own words/);
  assert.match((await call(p, { step: 'accept', gate: q.gate, shown: q.shown, person_words: WORDS, reason: 'x' })).error, /carries the person's words only/);
  assert.match((await call(p, { step: 'accept', gate: q.gate, shown: q.shown, person_words: `accept it, key ${['sk', 'or', 'v1', 'a1b2c3d4'.repeat(8)].join('-')}` })).error, /credential-shaped/);
  assert.match((await call(p, { step: 'accept', gate: q.gate, shown: 'f'.repeat(64), person_words: WORDS })).error, /not the acceptance question as it stands now/);
  const direct = (fields) => answerAcceptanceAsSession(p.runDir(), q.gate, { shownSha256: q.shown, ...fields });
  assert.equal(direct({ reason: RELAY_REASON, acceptanceAnswer: { relayed: true } }).ok, false, 'no words');
  assert.equal(direct({ reason: 'my own reason', acceptanceAnswer: { relayed: true }, personWords: WORDS }).ok, false, 'not the relay sentence');
  assert.equal(direct({ reason: RELAY_REASON, acceptanceAnswer: { relayed: true, advisor: 'none' }, personWords: WORDS }).ok, false, 'not exactly { relayed: true }');
  assert.equal(JSON.stringify(acceptancesOf(p.runDir())), before, 'nothing was recorded');
  assert.deepEqual(acceptancesOf(p.runDir()).accepted, []);
});

test('RA-3 (channel parity): a relayed acceptance given on any channel but the session\'s (the terminal, an elicitation) is refused by the gate with nothing recorded; the same call on the session channel with the person\'s words and the relay sentence is accepted (the control)', async () => {
  const p = finished();
  const q = await call(p, { step: 'quote' });
  const before = JSON.stringify(acceptancesOf(p.runDir()));
  for (const channel of ['cli', 'elicitation']) {
    const bare = answerGate(p.runDir(), q.gate, { channel, shownSha256: q.shown, decision: 'approved', actor: 'maya', reason: RELAY_REASON, tty: channel === 'cli', acceptanceAnswer: { relayed: true } });
    assert.equal(bare.ok, false, channel); assert.equal(bare.code, 'relayed_session_only', `${channel}: ${bare.message}`);
    const withWords = answerGate(p.runDir(), q.gate, { channel, shownSha256: q.shown, decision: 'approved', actor: 'maya', reason: RELAY_REASON, tty: channel === 'cli', acceptanceAnswer: { relayed: true }, personWords: WORDS });
    assert.equal(withWords.ok, false, `${channel} with words: refused (by the words rule, which comes first)`);
  }
  assert.equal(JSON.stringify(acceptancesOf(p.runDir())), before, 'nothing was recorded');
  const ok = answerAcceptanceAsSession(p.runDir(), q.gate, { shownSha256: q.shown, reason: RELAY_REASON, acceptanceAnswer: { relayed: true }, personWords: WORDS });
  assert.equal(ok.ok, true, JSON.stringify(ok));
});

test('RA-5 (typed = relayed: the bar a typed reason meets): the person\'s words for a relayed acceptance become the line under the banner, so they are one line of at most 600 characters; a line break or more is refused by the tool and by the gate with nothing recorded; 600 characters is accepted (the control)', async () => {
  const p = finished();
  const q = await call(p, { step: 'quote' });
  const before = JSON.stringify(acceptancesOf(p.runDir()));
  assert.match((await call(p, { step: 'accept', gate: q.gate, shown: q.shown, person_words: 'Yes.\nAccept it.' })).error, /one line of plain text/);
  const longRefusal = (await call(p, { step: 'accept', gate: q.gate, shown: q.shown, person_words: 'x'.repeat(601) })).error;
  assert.match(longRefusal, /longer than 600 characters/);
  assert.match(longRefusal, /Ask the person to say it again in one line; do not shorten it yourself/, 'the refusal sends the session back to the person, never invites it to shorten the words');
  for (const bad of ['Yes.\nAccept it.', 'x'.repeat(601)]) {
    const r = answerAcceptanceAsSession(p.runDir(), q.gate, { shownSha256: q.shown, reason: RELAY_REASON, acceptanceAnswer: { relayed: true }, personWords: bad });
    assert.equal(r.ok, false); assert.equal(r.code, 'person_words_form');
  }
  assert.equal(JSON.stringify(acceptancesOf(p.runDir())), before, 'nothing was recorded');
  const ok = await call(p, { step: 'accept', gate: q.gate, shown: q.shown, person_words: `${'y'.repeat(599)}.` });
  assert.equal(ok.error, undefined, JSON.stringify(ok).slice(0, 300));
});

// ---- the note of the quote carries harness text only: every sentence the accept check can return is a fixed string (no interpolation), so no run-folder text can reach it
test('RA-6: the `note` of the quote of a plan the session may not accept holds only the accept check\'s fixed sentences and the validated run id: no message of sessionMayAccept interpolates anything, so the key stays unwrapped', async () => {
  const src = readFileSync(join(root, 'src', 'acceptance.js'), 'utf8');
  const body = src.slice(src.indexOf('export function sessionMayAccept'), src.indexOf('}\n', src.indexOf('text_changed')) + 2);
  const messages = [...body.matchAll(/message: ('(?:[^'\\]|\\.)*')/g)].map(m => m[1]);
  assert.ok(messages.length >= 6, `the premise: the check's messages were found (${messages.length})`);
  assert.equal((body.match(/message:/g) || []).length, messages.length, 'every message key of the check is a single-quoted literal found above (a template message would escape the scan)');
  for (const m of messages) assert.doesNotMatch(m, /\$\{/, 'a fixed sentence');
  const p = finished();
  const q = await call(p, { step: 'quote' });
  assert.match(q.note, /^The handling session may not accept this plan: [^`]*\. The person accepts it at a terminal with `council accept runs\/[0-9TZ-]+ --reason "<why>"`, or tells you to accept it: then pass the gate and the hash back with step accept and the person's own words as person_words\. No answer was recorded\.$/, 'the whole note is the fixed template around one fixed message and the run id');
});
