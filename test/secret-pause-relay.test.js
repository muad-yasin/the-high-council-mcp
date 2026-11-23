// 0.8.4 (Q9, the person's yes of 10 Nov 2026: the handling session may relay his continue, finish now or drop at a found-secret pause): through the MCP tool `stop_decide`, over the SAME person-only stop_decision gate a spending stop uses. The pause is read
// from its own record (secret-stop.json); its stop id is `secret_pause:` and the record's own 16-hex id. Only the person's own choice is carried, with their words: the gate refuses the session's own answer; the record says RELAYED (channel session, relayed true,
// the words, the gate) and the ledger is the only authority for that mark. Real stdio sessions on a run folder whose pause files are HAND-WRITTEN as the CLI writes them (NAMED LIMIT, as test/finish-now-secret.test.js). $0, offline. WRITTEN WITHOUT A RUN
// (no tests on the laptop): the first run on the box decides. Each row has its control or its known-bad input.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEDGER_FILE } from '../src/gate-ledger.js';
import { session } from './helpers/mcp-stdio-session.js';
import { untilRunIdle } from './helpers/round-stop-project.js';
import { classifyStop } from '../src/stop-decision.js';
import * as SP from '../src/secret-pause.js';   // namespace imports: on the old source each row fails on its own, the file still loads (the red rule: one red per test)
import * as GATE from '../src/gate.js';
import * as SG from '../src/stop-gate.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const dirs = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });

const STOP = 'a1b2c3d4e5f60718'; const VALUE_HASH = 'f'.repeat(32);
const WORDS = 'Yes, go on: I know that string is a test key and it may be sent.';
const metaOf = w => JSON.parse(readFileSync(join(w.runDir, 'run.json'), 'utf8'));
const ledgerOf = w => (existsSync(join(w.runDir, LEDGER_FILE)) ? readFileSync(join(w.runDir, LEDGER_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const call = (w, args) => session(w.dir, [{ name: 'stop_decide', arguments: { run: w.id, ...args } }]).then(a => a[0]);

/** SP-20's fixture (as test/finish-now-secret.test.js): a finished layered mock run rewound to a crashed one, the pause files written as the CLI writes them. `phase`: 'loop' (a pause inside the rounds) or 'after'. */
function paused({ phase = 'loop', label = null, markerOnly = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-spr-')); dirs.push(dir);
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small command-line tool that renames photos by the date they were taken.\n');
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-external.json'), 'utf8'));
  const critics = [
    { provider: 'mock', model: 'mock-critic-script-o-sfn', lab: 'l1', layer: 1 }, { provider: 'mock', model: 'mock-critic-script-o-sfn', lab: 'l2', layer: 2 },
    { provider: 'mock', model: 'mock-critic-script-o-sfn', lab: 'l3a', layer: 3 }, { provider: 'mock', model: 'mock-critic-script-o-sfn', lab: 'l3b', layer: 3 },
  ];
  writeFileSync(join(dir, 'chains', 'lay-finish.json'), JSON.stringify({ ...base, name: 'lay-finish', handoff: false, seats: { ...base.seats, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics } }));
  const sh = args => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 120_000 });
  const first = sh(['--chain', 'lay-finish', '--task', 'tasks/t.md']);
  const id = readdirSync(join(dir, 'runs'))[0]; const runDir = join(dir, 'runs', id);
  assert.ok(first.status === 0 || first.status === 22, first.stderr + first.stdout);
  const l2 = readdirSync(runDir).find(x => /^panel-1-.*l2.*\.md$/.test(x)); assert.ok(l2, `a layer-2 panel stage exists: ${readdirSync(runDir).join(' ')}`);
  const stage = label ?? l2.replace(/\.md$/, '');
  const AFTER = /^(panel|ldebate|lreply|rule|revise|critique|conflict|allocator|final|dispute|handoff|cold|challenge|ending|deep)/;
  for (const x of readdirSync(runDir)) if ((AFTER.test(x) && !/^panel-1-.*l1/.test(x)) || ['report.json', 'deliverable.md', 'BOARD.md', 'HANDOFF.md', 'state.json'].includes(x)) rmSync(join(runDir, x), { force: true });
  writeFileSync(join(runDir, 'STOPPED-secret.md'), '# Run paused: a credential-shaped string in a prompt\n');
  if (!markerOnly) writeFileSync(join(runDir, 'secret-stop.json'), JSON.stringify({ schema: 'secret-stop/1', stop: STOP, label: stage, phase, findings: [{ part: 'user', line: 1, name: 'anthropic' }], values: [VALUE_HASH], at: new Date().toISOString() }));
  return { dir, sh, id, runDir, label: stage };
}

test('SR-1 (pure): classifyStop takes a found-secret pause only with its marker AND a whole record and no spending stop beside it; the choices the terminal takes at each phase are the ones that may be relayed (a drop only at an excerpt, a plain finish only inside the rounds, a finish-now never before). Old bar (10 Nov): every found-secret pause was refused as the terminal\'s', () => {
  assert.deepEqual(classifyStop({ status: 'paused_secret', secretMarker: true, secretRecord: true }), { ok: true, secret: true });
  for (const o of [{ secretMarker: true, secretRecord: false }, { secretMarker: false, secretRecord: true }, { secretMarker: true, secretRecord: true, secretBesideSpending: true }]) {
    const k = classifyStop({ status: 'paused_secret', ...o }); assert.equal(k.ok, false, JSON.stringify(o)); assert.equal(k.code, 'secret_pause');
  }
  assert.deepEqual(SP.secretChoicesOf({ phase: 'before', label: 'panel-1-x' }), ['continue']);
  assert.deepEqual(SP.secretChoicesOf({ phase: 'before', label: 'excerpt-E-3' }), ['continue', 'drop']);
  assert.deepEqual(SP.secretChoicesOf({ phase: 'loop', label: 'panel-2-x' }), ['continue', 'finish', 'finish_now']);
  assert.deepEqual(SP.secretChoicesOf({ phase: 'after', label: 'handoff' }), ['continue', 'finish_now']);
  assert.equal(SP.secretGateStopId({ stop: STOP }), `secret_pause:${STOP}`);
});

test('SR-2 (the quote): a found-secret pause is quoted through the person-only gate: the stop id is the record\'s own, the text names the finding by part, line and name and the choices of this phase, and NEVER repeats a value; control: a pause with its marker but no record is refused with the terminal sentence and nothing is asked', async () => {
  const w = paused({ phase: 'loop' });
  const q = await call(w, { step: 'quote' });
  assert.equal(q.error, undefined, JSON.stringify(q).slice(0, 400));
  assert.equal(q.stop_id, `secret_pause:${STOP}`); assert.equal(q.person_only, true); assert.equal(q.requires_user, true);
  assert.match(q.text, /user prompt, line 1: anthropic/); assert.match(q.text, /Choices: continue \| finish \| finish_now\./);
  assert.ok(!q.text.includes(VALUE_HASH), 'no value hash in the text');
  assert.ok(ledgerOf(w).some(l => l.event === 'gate_requested' && l.kind === 'stop_decision'), 'the gate is asked for over the quote');
  const noRecord = paused({ markerOnly: true });
  const r = await call(noRecord, { step: 'quote' });
  assert.match(r.error, /cannot take their choice for it now/);
  assert.equal(ledgerOf(noRecord).length, 0, 'nothing asked, nothing recorded');
});

test('SR-2b (the finish_now line says what the record says): at a pause AFTER the review rounds the quote\'s finish_now line says the run keeps the verdict the rounds reached and the report says the top layer did not read the final plan, and it does not say NOT agreed; inside the rounds the line still says NOT agreed (control). Mini-C&C FIX 1, his 19:01 heading of 10 Nov 2026', async () => {
  const lineOf = text => text.split('\n').find(l => /^\s*finish_now:/.test(l)) ?? '';
  const after = await call(paused({ phase: 'after', label: 'handoff' }), { step: 'quote' });
  assert.equal(after.error, undefined, JSON.stringify(after).slice(0, 300));
  const a = lineOf(after.text);
  assert.match(a, /keeps the verdict the review rounds reached/); assert.match(a, /the report says it did not read the final plan, or that only part of it had read this version/); assert.doesNotMatch(a, /NOT agreed/);
  const loop = lineOf((await call(paused({ phase: 'loop' }), { step: 'quote' })).text);
  assert.match(loop, /ends the run here at once, NOT agreed/, 'the control: inside the rounds the run does end NOT agreed');
});

test('SR-2c (the same words everywhere a person reads them): the stop_decide tool description, README, AI-README and CHANGELOG say a finish-now ends NOT agreed inside the rounds and keeps the rounds\' verdict after them, and none keeps the old unconditional "not agreed". Mini-C&C FIX 1, his 19:01 heading of 10 Nov 2026', async () => {
  const { STOP_DECIDE_DESCRIPTION } = await import('../src/mcp/stop-decide.js');
  const tail = /inside the review rounds the run ends not agreed, and at a spending stop or a credential-shaped pause after them it keeps the verdict the rounds reached/;
  assert.match(STOP_DECIDE_DESCRIPTION, tail); assert.doesNotMatch(STOP_DECIDE_DESCRIPTION, /finish_now ends the run at once, not agreed/);
  const read = f => readFileSync(join(root, f), 'utf8').replace(/\s+/g, ' ');
  // CHANGED (0.8.4 apply, the README rework): these sentences are a Known limit, which moved word for word to KNOWN-LIMITS.md; the README entry reads the README and the limits file together (OLD: README.md alone), for the presence checks and the absence check alike.
  const readme = `${read('README.md')} ${read('KNOWN-LIMITS.md')}`;
  assert.match(readme, tail); assert.doesNotMatch(readme, /`finish_now` ends the run at once, not agreed/);
  assert.match(read('AI-README.md'), tail); assert.doesNotMatch(read('AI-README.md'), /A run ended at once is NOT agreed/);
  assert.match(read('AI-README.md'), /A run ended at once inside the review rounds, or at a round stop, is NOT agreed, except at the round stop where no seat of the top layer could read the final plan: a panel that had signed off before the read keeps that verdict there, and the report says the top layer did not read the final plan\. Ended at once at a spending stop or a credential-shaped pause after the review rounds, it keeps the verdict the rounds reached/);
  assert.match(read('CHANGELOG.md'), /Inside the review rounds and at a round stop the run ends NOT agreed \(except at the stop where no seat of the top layer could read the final plan: a panel that had signed off before the read keeps that verdict there\); at a spending stop or a credential-shaped pause after the review rounds it keeps the verdict the rounds reached/);
  // the stop where no seat of the top layer could read the final plan (the ruling of 10 Nov 2026, FIX 2): said in the places that name the round stops
  assert.match(STOP_DECIDE_DESCRIPTION, /a panel that had signed off before the read keeps that verdict too, and one that had not stays not agreed/);
  assert.match(readme, /a panel that had signed off at the stop where no seat of the top layer could read the final plan/);
  assert.match(read('AI-README.md'), /and so does a panel that had signed off at the stop where no seat of the top layer could read the final plan/);
  assert.match(read('AI-README.md'), /at once, NOT agreed \(a panel that had signed off keeps that verdict at the stop where no seat of the top layer could read the final plan\)/);
  assert.doesNotMatch(read('CHANGELOG.md'), /--finish-now` ends the run NOT agreed: no judge is asked again/);
});

test('SR-3 (refusals, nothing recorded): the session\'s OWN answer at a found-secret pause (no words) is refused by the gate as the person\'s alone; a relayed choice this phase does not take (a drop at a stage, a finish after the rounds) is refused with the terminal\'s list; person_words that hold a credential-shaped string are refused; rounds goes with no choice here', async () => {
  const w = paused({ phase: 'loop' });
  const q = await call(w, { step: 'quote' }); const before = ledgerOf(w).length;
  const own = await call(w, { step: 'answer', gate: q.gate, shown: q.shown, choice: 'continue', reason: 'I decide to send it', advisor: 'consulted', advisor_said: 'ok' });
  assert.match(own.error, /This stop is the person's alone/);
  const drop = await call(w, { step: 'answer', gate: q.gate, shown: q.shown, choice: 'drop', person_words: WORDS });
  assert.match(drop.error, /choice must be one of continue or finish or finish_now/);
  const key = ['sk', '-ant-api03-', 'aZ3kQ9xB'.repeat(6)].join('');
  const keyed = await call(w, { step: 'answer', gate: q.gate, shown: q.shown, choice: 'continue', person_words: `go on ${key}` });
  assert.match(keyed.error, /person_words holds 1 credential-shaped string/);
  const rounds = await call(w, { step: 'answer', gate: q.gate, shown: q.shown, choice: 'continue', person_words: WORDS, rounds: 3 });
  assert.match(rounds.error, /no review-round limit to change/);
  assert.equal(ledgerOf(w).length, before, 'nothing was recorded');
  const after = paused({ phase: 'after', label: 'handoff' });
  const qa = await call(after, { step: 'quote' });
  assert.match(qa.text, /Choices: continue \| finish_now\./);
  const plain = await call(after, { step: 'answer', gate: qa.gate, shown: qa.shown, choice: 'finish', person_words: WORDS });
  assert.match(plain.error, /choice must be one of continue or finish_now/);
});

test('SR-4 (the relayed finish-now, end to end): finish_now with the person\'s words ends the run in the resume the tool starts; the ledger records it as RELAYED (channel session, relayed true, the words, the gate); run.json names the gate and says via session; the report\'s stop and the verdict line say relayed; the value is NOT allowed. Control: the same command typed at a terminal carries no relayed mark', async () => {
  const w = paused({ phase: 'loop' });
  const q = await call(w, { step: 'quote' });
  const a = await call(w, { step: 'answer', gate: q.gate, shown: q.shown, choice: 'finish_now', person_words: WORDS });
  assert.equal(a.error, undefined, JSON.stringify(a).slice(0, 400));
  assert.deepEqual([a.recorded.choice, a.recorded.actor, a.recorded.channel, a.recorded.relayed], ['finish_now', 'person', 'session', true]);
  await untilRunIdle(w.runDir);
  const answered = ledgerOf(w).filter(l => l.event === 'gate_answered' && l.gate === q.gate).at(-1);
  assert.deepEqual([answered.channel, answered.person_words], ['session', WORDS]);
  const fin = metaOf(w).secretFinish;
  assert.deepEqual([fin.choice, fin.via, fin.relayed, fin.stop_gate], ['finish_now', 'session', true, q.gate]);
  assert.deepEqual(metaOf(w).secretAllow?.hashes ?? [], [], 'the value the pause found is NOT allowed');
  const rep = JSON.parse(readFileSync(join(w.runDir, 'report.json'), 'utf8'));
  assert.deepEqual([rep.passed, rep.stop.kind, rep.stop.finished_at_once, rep.stop.relayed], [false, 'secret_pause', true, true]);
  const typed = paused({ phase: 'loop' });
  const r = typed.sh(['--resume', join('runs', typed.id), '--finish-now']);
  assert.ok([0, 22].includes(r.status), `${r.stdout}${r.stderr}`);
  const trep = JSON.parse(readFileSync(join(typed.runDir, 'report.json'), 'utf8'));
  assert.equal(trep.stop.relayed, undefined, 'a typed finish-now is not relayed'); assert.equal(metaOf(typed).secretFinish.via, 'cli');
});

test('SR-5 (the relayed continue, end to end): continue with the person\'s words allows the value(s) the pause found and the run goes on; the allowance names the gate in run.json `relayedSecretChoices` and the ledger holds the words, so a reader sees it was the person\'s word relayed, not a typed command. Known-bad input: a --stop-gate naming a gate answered for ANOTHER choice (finish_now) is refused (exit 2) and records nothing', async () => {
  const k = paused({ phase: 'loop' });   // a gate answered for finish_now, written without starting the run: the tool always resumes, so the gate functions are called directly
  writeFileSync(join(k.runDir, 'stop-quote-0001.md'), `Stop secret_pause:${STOP}: a fixture quote.\n`);
  const asked = SG.requestStopQuote(k.runDir, { textPath: 'stop-quote-0001.md', stopId: `secret_pause:${STOP}` }, {});
  assert.equal(asked.ok, true, JSON.stringify(asked));
  const done = SG.answerStopRelayed(k.runDir, asked.gate.id, { shownSha256: asked.gate.sha256, personWords: WORDS, choice: 'finish_now' }, {});
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.ok(GATE.relayedSecretAnswerOf(k.runDir, asked.gate.id, `secret_pause:${STOP}`, 'finish_now', WORDS), 'premise: the gate holds the relayed finish_now');
  assert.equal(GATE.relayedSecretAnswerOf(k.runDir, asked.gate.id, `secret_pause:${STOP}`, 'continue', WORDS), null, 'it holds no continue');
  const wrong = k.sh(['--resume', join('runs', k.id), '--continue', '--stop-gate', asked.gate.id]);
  assert.equal(wrong.status, 2, `${wrong.stdout}${wrong.stderr}`); assert.match(wrong.stderr, /no answered, person-only stop_decision gate of this run by that name matches this credential-shaped pause/);
  assert.deepEqual(metaOf(k).secretAllow?.hashes ?? [], [], 'nothing was recorded'); assert.ok(existsSync(join(k.runDir, 'STOPPED-secret.md')), 'the run is still paused');
  const w = paused({ phase: 'loop' });
  const q = await call(w, { step: 'quote' });
  const c = await call(w, { step: 'answer', gate: q.gate, shown: q.shown, choice: 'continue', person_words: WORDS });
  assert.equal(c.error, undefined, JSON.stringify(c).slice(0, 400));
  await untilRunIdle(w.runDir);
  assert.ok(metaOf(w).secretAllow.hashes.includes(VALUE_HASH), 'the value the pause found is allowed');
  const rc = metaOf(w).relayedSecretChoices.at(-1);
  assert.deepEqual([rc.choice, rc.via, rc.relayed, rc.stop_gate], ['continue', 'session', true, q.gate]);
  assert.ok(ledgerOf(w).some(l => l.event === 'gate_answered' && l.gate === q.gate && l.person_words === WORDS), 'the person\'s words are on the ledger');
});

test('SR-6 (the relayed mark comes from the ledger, never from run.json): a recorded finish-now whose run.json says relayed:true but whose gate is not on the ledger is believed as a finish, not as the person\'s relayed word. Known-bad input: a hand-written relayed mark', () => {
  const w = paused({ phase: 'loop' });
  rmSync(join(w.runDir, 'STOPPED-secret.md')); rmSync(join(w.runDir, 'secret-stop.json'));
  const meta = metaOf(w);
  writeFileSync(join(w.runDir, 'run.json'), JSON.stringify({ ...meta, secretFinish: { choice: 'finish_now', label: w.label, stop: STOP, phase: 'loop', at: new Date().toISOString(), via: 'session', relayed: true, stop_gate: 'g-forged', person_words: WORDS } }, null, 2));
  const r = w.sh(['--resume', join('runs', w.id)]);
  assert.ok([0, 22].includes(r.status), `${r.stdout}${r.stderr}`);
  const rep = JSON.parse(readFileSync(join(w.runDir, 'report.json'), 'utf8'));
  assert.deepEqual([rep.stop.kind, rep.stop.finished_at_once], ['secret_pause', true]);
  assert.equal(rep.stop.relayed, undefined, 'the forged mark is not believed');
  assert.equal(GATE.relayedSecretAnswerOf(w.runDir, 'g-forged', `secret_pause:${STOP}`, 'finish_now', WORDS), null);
});

test('SR-7 (the relayed plain finish): finish with the person\'s words is RECORDED and the command ends at once with the run still paused (exit 11, by design): the tool says so and does NOT close the answer, run.json names the gate, the ledger holds no close line; the person\'s continue then ends the run NOT agreed and the report says relayed. Known-bad: closing the answer of a finish that was taken, or losing the relayed mark between the finish and the continue', async () => {
  const w = paused({ phase: 'loop' });
  const q = await call(w, { step: 'quote' });
  const a = await call(w, { step: 'answer', gate: q.gate, shown: q.shown, choice: 'finish', person_words: WORDS });
  assert.equal(a.error, undefined, JSON.stringify(a).slice(0, 400));
  await untilRunIdle(w.runDir);
  assert.match(a.note ?? '', /The person's finish is recorded and the command ended at once/);
  assert.ok(!ledgerOf(w).some(l => l.event === 'stop_answer_closed' && l.gate === q.gate), 'the answer of a finish that was taken is not closed');
  assert.deepEqual([metaOf(w).secretFinish.choice, metaOf(w).secretFinish.relayed, metaOf(w).secretFinish.stop_gate], ['finish', true, q.gate]);
  assert.ok(existsSync(join(w.runDir, 'STOPPED-secret.md')), 'still paused: nothing is sent until the continue');
  const c = w.sh(['--resume', join('runs', w.id), '--continue']);   // the person's typed continue
  assert.ok([0, 22].includes(c.status), `${c.stdout}${c.stderr}`);
  const rep = JSON.parse(readFileSync(join(w.runDir, 'report.json'), 'utf8'));
  assert.deepEqual([rep.passed, rep.stop.kind, rep.stop.chosen, rep.stop.finished_at_once, rep.stop.relayed], [false, 'secret_pause', 'finish', undefined, true]);
});
