// 0.8.4 the persona form for ONE run, WIRING: the command line and the MCP tools. Offline, $0: a dry run, a refusal before anything is sent, or a start on a temp MOCK chain (builder and reviser external: the run writes its first stages and pauses, exit 3); the keys are dummies; the working folders are the
// test's own (the pattern of test/zero-retention-entry-points.test.js: its spawn helpers and its MCP session are copied, no *.test.js file is imported). WRITTEN WITHOUT A RUN (no tests on the laptop): the box decides; each row's premise asserts say what it relies on.
// PE-1 the command line's dry run of a shipped title chain: without the flag nothing is said; `--persona-form title` is byte-identical to no flag; `--persona-form voice` prints the line and exits 0 (and a flag typed twice or bare is refused). PE-2 refusals before a run folder is made (a bad value, a bare flag, a chain
// without the switch, a start and a dry run alike; the flag on `doctor`, `tree` and `--rematch`, which are not a start or a resume). PE-3 a start on a temp chain with the voice form: run.json carries persona_form, the log says the form, a resume that types the other form is refused with the form the run uses, a resume that types the same form or nothing is not refused, run.json keeps the
// form. A run started without the flag has no persona_form key (what run.json always was). PE-3b a run that ends offline with the flag reports seat_personas.form "voice" (the form in force) and one without it "title". PE-6 the dry run's JSON input tokens follow the form (GO result 5). PE-7a/b a rematch and a replay of a run that saved persona_form report that form (GO result 2), PE-7c a run that saved none keeps the chain file's form in both. PE-4 the MCP tools list the argument, refuse a bad value and a chain without the switch before a run id is taken, and name the argument; dry_run with it prints the line. PE-5 `council --help` carries the flag's lines.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { malformedProviderKeys } from './helpers/no-real-keys.js';
import { PERSONA_FORM_HELP_LINES, personaFormSideSentence, personaFormLineSentence, personaFormNoSwitchSentence, personaFormNotAFormSentence, personaFormResumeSentence, PERSONA_FORM_ARGUMENT } from '../src/persona-form.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const WAIT_MS = 40000;
const NOTHING = 'Nothing was started and nothing was spent.';
const made = [];
process.on('exit', () => { for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch { /* a leftover is a nuisance */ } } });
const BASE = malformedProviderKeys();
const KEYS = { anthropic: { ...BASE, ANTHROPIC_API_KEY: 'sk-test-dummy-key', OPENROUTER_API_KEY: '' } };
const MINI = 'plan-mini-council';
const LINE_VOICE = personaFormLineSentence('voice', 'title');

/** A temp chain: the repo's mock-external chain (a builder and a reviser that are external seats, so a start pauses with exit 3 after the mock stages) with the persona switch on in the title form and a name on every proposer and judge. */
function personaExternal() {
  const c = JSON.parse(readFileSync(join(root, 'chains', 'mock-external.json'), 'utf8'));
  return { ...c, name: 'persona-ext', seat_personas: { enabled: true, form: 'title' }, seats: { ...c.seats,
    proposers: c.seats.proposers.map((p, i) => ({ ...p, persona: ['Husayn', 'Abraham'][i] })),
    critics: c.seats.critics.map((p, i) => ({ ...p, persona: ['Moses', 'Noah'][i] })) } };
}
/** A temp chain that runs to its end offline: the repo's mock-unanimous chain (two critics under unanimous sign-off) with the persona switch on in the title form and a name on each critic. */
function personaDone() {
  const c = JSON.parse(readFileSync(join(root, 'chains', 'mock-unanimous.json'), 'utf8'));
  return { ...c, name: 'persona-done', seat_personas: { enabled: true, form: 'title' }, seats: { ...c.seats, critics: c.seats.critics.map((p, i) => ({ ...p, persona: ['Moses', 'Noah'][i] })) } };
}
/** A temp chain with PRICED seats: the repo's mock-budget chain (every seat mock/mock-priced, a $1000-per-Mtok fixture price, so a dry run has dollar figures offline) with two critics under unanimous sign-off, the persona switch on in the given form and a name on each critic. */
function personaPriced(form) {
  const c = JSON.parse(readFileSync(join(root, 'chains', 'mock-budget.json'), 'utf8'));
  const critic = c.seats.critics[0];
  return { ...c, name: `persona-priced-${form}`, signoff: 'unanimous', seat_personas: { enabled: true, form }, seats: { ...c.seats, critics: [{ ...critic, persona: 'Moses' }, { ...critic, lab: 'mock-b', persona: 'Noah' }] } };
}
function work() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-pf-')); made.push(dir);
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains')); writeFileSync(join(dir, 'tasks', 'x.md'), 'Plan a tiny change.\n'); writeFileSync(join(dir, '.env'), '# no keys here\n');
  writeFileSync(join(dir, 'chains', 'plain-mock.json'), JSON.stringify({ name: 'plain-mock', description: 'a mock chain', seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' }, critics: [{ provider: 'mock', model: 'mock-critic-a' }] } }));
  writeFileSync(join(dir, 'chains', 'persona-ext.json'), JSON.stringify(personaExternal()));
  writeFileSync(join(dir, 'chains', 'persona-done.json'), JSON.stringify(personaDone()));
  for (const form of ['title', 'voice']) writeFileSync(join(dir, 'chains', `persona-priced-${form}.json`), JSON.stringify(personaPriced(form)));
  return dir;
}
const run = (dir, args, env = {}) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', timeout: 120_000, env: { PATH: process.env.PATH, HOME: dir, ...env } });
const runsOf = dir => (existsSync(join(dir, 'runs')) ? readdirSync(join(dir, 'runs')) : []);
const noRuns = dir => runsOf(dir).length === 0;
const base = (chain, ...more) => ['--chain', chain, '--task', 'tasks/x.md', ...more];

test('PE-1 the dry run of a shipped title chain: no flag says nothing; --persona-form title is byte-identical to no flag; --persona-form voice prints the line and exits 0', () => {
  const dir = work();
  const plain = run(dir, base(MINI, '--dry-run'), KEYS.anthropic);
  assert.equal(plain.status, 0, plain.stderr.slice(0, 300)); assert.doesNotMatch(plain.stdout, /Seat personas:/, 'premise: no flag, no line');
  const title = run(dir, base(MINI, '--dry-run', '--persona-form', 'title'), KEYS.anthropic);
  assert.equal(title.status, 0, title.stderr.slice(0, 300)); assert.equal(title.stdout, plain.stdout, 'the form the chain file already names changes nothing on the screen');
  const voice = run(dir, base(MINI, '--dry-run', '--persona-form', 'voice'), KEYS.anthropic);
  assert.equal(voice.status, 0, voice.stderr.slice(0, 300)); assert.ok(voice.stdout.includes(LINE_VOICE), `the dry run names the form: ${voice.stdout.slice(0, 400)}`);
  const eq = run(dir, base(MINI, '--dry-run', '--persona-form=voice'), KEYS.anthropic);
  assert.equal(eq.status, 0, '--persona-form=voice is read like --persona-form voice'); assert.ok(eq.stdout.includes(LINE_VOICE));
  assert.ok(noRuns(dir), 'a dry run made no run folder');
});

test('PE-2 refusals come before anything is started or any run folder is made: a bad value, the bare flag, a chain that switches nothing on (a dry run and a start alike)', () => {
  const dir = work();
  for (const dry of [['--dry-run'], []]) {
    const bad = run(dir, base('persona-ext', ...dry, '--persona-form', 'maybe'), KEYS.anthropic);
    assert.equal(bad.status, 2, `${dry.join('')}: ${bad.stderr.slice(0, 300)}`); assert.ok(bad.stderr.includes(personaFormNotAFormSentence('--persona-form', 'maybe')), bad.stderr.slice(0, 300));
    const bare = run(dir, base('persona-ext', ...dry, '--persona-form'), KEYS.anthropic);
    assert.equal(bare.status, 2); assert.ok(bare.stderr.includes(`--persona-form needs a value: title or voice. ${NOTHING}`), bare.stderr.slice(0, 300));
    for (const form of ['voice', 'title']) {
      const none = run(dir, base('plain-mock', ...dry, '--persona-form', form), KEYS.anthropic);
      assert.equal(none.status, 2, `${dry.join('')} ${form}: ${none.stderr.slice(0, 300)}`); assert.ok(none.stderr.includes(personaFormNoSwitchSentence('--persona-form')), none.stderr.slice(0, 300));
    }
  }
  assert.ok(noRuns(dir), 'no refusal made a run folder');
  // the flag is on the one list of known options: on a command that is not a start or a resume it is refused, never ignored (the `--dry` lesson)
  for (const [args, what] of [[['doctor', '--persona-form', 'voice'], '`doctor`'], [['tree', 'status', '--persona-form', 'voice'], '`tree`'], [['--rematch', 'runs/none', '--persona-form', 'voice'], '--rematch']]) {
    const side = run(dir, args, KEYS.anthropic);
    assert.equal(side.status, 2, `${args.join(' ')}: ${side.stderr.slice(0, 300)}`); assert.ok(side.stderr.includes(personaFormSideSentence(what)), `${args.join(' ')}: ${side.stderr.slice(0, 300)}`);
  }
  assert.ok(noRuns(dir));
});

test('PE-3 a start with the voice form: run.json records it and the log says it; the other form at a resume is refused naming the form the run uses; the same form or none is not refused; a start without the flag has no persona_form key', () => {
  const dir = work();
  const start = run(dir, base('persona-ext', '--persona-form', 'voice'), {});
  assert.equal(start.status, 3, `the run pauses at its external builder: ${start.stderr.slice(0, 400)} ${start.stdout.slice(-300)}`);
  assert.ok(`${start.stdout}${start.stderr}`.includes(LINE_VOICE), 'the start says the form');
  const [id] = runsOf(dir); assert.ok(id, 'premise: a run folder was made');
  const runJson = () => JSON.parse(readFileSync(join(dir, 'runs', id, 'run.json'), 'utf8'));
  assert.equal(runJson().persona_form, 'voice');
  const other = run(dir, ['--resume', join('runs', id), '--persona-form', 'title'], {});
  assert.equal(other.status, 2, `${other.stderr.slice(0, 300)}`); assert.ok(other.stderr.includes(personaFormResumeSentence('--persona-form', 'title', 'voice')), other.stderr.slice(0, 300));
  assert.equal(runJson().persona_form, 'voice', 'a refused resume leaves the record alone');
  // the plain resume first, whatever it does (the external builder is still unanswered), then the same form typed: the same exit, and neither says the form is kept from the start
  const plainResume = run(dir, ['--resume', join('runs', id)], {});
  assert.doesNotMatch(`${plainResume.stderr}${plainResume.stdout}`, /keeps the form it began with/, 'a plain resume is not refused');
  assert.equal(runJson().persona_form, 'voice', 'the run keeps its form');
  const sameForm = run(dir, ['--resume', join('runs', id), '--persona-form', 'voice'], {});
  assert.equal(sameForm.status, plainResume.status, `the same form typed ends as the plain resume does: ${sameForm.stderr.slice(0, 300)}`);
  assert.doesNotMatch(`${sameForm.stderr}${sameForm.stdout}`, /keeps the form it began with/, 'the same form is not refused');
  assert.equal(runJson().persona_form, 'voice', 'the run keeps its form');
  const dir2 = work();
  const plain = run(dir2, base('persona-ext'), {});
  assert.equal(plain.status, 3, plain.stderr.slice(0, 300));
  const [id2] = runsOf(dir2);
  assert.equal('persona_form' in JSON.parse(readFileSync(join(dir2, 'runs', id2, 'run.json'), 'utf8')), false, 'no flag, no key: run.json is what it always was');
  const wrong = run(dir2, ['--resume', join('runs', id2), '--persona-form', 'voice'], {});
  assert.equal(wrong.status, 2, 'a run that began with the chain file\'s title form does not change to voice at a resume'); assert.ok(wrong.stderr.includes(personaFormResumeSentence('--persona-form', 'voice', 'title')), wrong.stderr.slice(0, 300));
});

test('PE-3b the run\'s record: a run that ends with --persona-form voice reports seat_personas.form "voice" (the form in force), one without the flag reports the chain file\'s "title"', () => {
  const dir = work();
  const voice = run(dir, base('persona-done', '--persona-form', 'voice'), {});
  assert.ok([0, 22].includes(voice.status), `premise: the offline chain ran to its end (exit 0 or 22): exit ${voice.status} ${voice.stderr.slice(0, 300)}`);
  const [id] = runsOf(dir); assert.ok(id, 'premise: a run folder was made');
  const report = JSON.parse(readFileSync(join(dir, 'runs', id, 'report.json'), 'utf8'));
  assert.equal(report.seat_personas?.enabled, true, 'premise: the switch is in the report'); assert.equal(report.seat_personas.form, 'voice', 'the report says the form in force');
  assert.equal(JSON.parse(readFileSync(join(dir, 'runs', id, 'run.json'), 'utf8')).persona_form, 'voice');
  const dir2 = work();
  const plain = run(dir2, base('persona-done'), {});
  assert.equal(plain.status, voice.status, 'the same chain ends the same way without the flag');
  const [id2] = runsOf(dir2);
  assert.equal(JSON.parse(readFileSync(join(dir2, 'runs', id2, 'report.json'), 'utf8')).seat_personas.form, 'title', 'without the flag: the chain file\'s form');
});

test('PE-6 the dry run prices the form chosen (GO result 5), as a RELATION on a priced fixture: the flag\'s estimate equals the estimate of the same chain with that form in its file and differs from the other form\'s, in input tokens and in dollars, in both directions', () => {
  const dir = work();
  const estimate = (chain, ...more) => { const r = run(dir, base(chain, '--dry-run', '--json', ...more), {}); assert.equal(r.status, 0, `${chain} ${more.join(' ')}: ${r.stderr.slice(0, 300)}`); const e = JSON.parse(r.stdout).estimate; return { input: e.inputTokens, expected: e.expectedUsd, maximum: e.maximumUsd }; };
  const fileTitle = estimate('persona-priced-title'); const fileVoice = estimate('persona-priced-voice');
  assert.ok(fileTitle.expected > 0 && fileTitle.maximum > 0, `premise: the fixture is priced (${JSON.stringify(fileTitle)})`);
  assert.ok(fileVoice.input > fileTitle.input && fileVoice.expected > fileTitle.expected, `premise: a chain file that says voice prices more than one that says title (${JSON.stringify([fileTitle, fileVoice])})`);
  assert.deepEqual(estimate('persona-priced-title', '--persona-form', 'voice'), fileVoice, 'the flag prices as a chain file that says voice');
  assert.deepEqual(estimate('persona-priced-title', '--persona-form', 'title'), fileTitle, 'the form the file names prices as no flag');
  assert.deepEqual(estimate('persona-priced-voice', '--persona-form', 'title'), fileTitle, 'the other direction: titles on a chain whose file says voice price as a chain file that says title');
  assert.ok(noRuns(dir), 'a dry run made no run folder');
});

/** One finished offline run of the persona chain (started with the given extra flags) and a reader of the form each folder of runs/ reports. */
function finishedRun(...flags) {
  const dir = work();
  const start = run(dir, base('persona-done', ...flags), {});
  assert.equal(start.status, 0, `premise: the offline chain agrees and ends: ${start.stderr.slice(0, 300)} ${start.stdout.slice(-300)}`);
  const [id] = runsOf(dir); assert.ok(id, 'premise: a run folder was made');
  const formOf = folder => JSON.parse(readFileSync(join(dir, 'runs', folder, 'report.json'), 'utf8')).seat_personas?.form;
  return { dir, id, formOf, saved: JSON.parse(readFileSync(join(dir, 'runs', id, 'run.json'), 'utf8')).persona_form };
}

test('PE-7a a REMATCH of a run that saved persona_form keeps it (GO result 2: the chain is read by name there, as the route and zero retention are kept from run.json): the rematch reports the form the run used', () => {
  const { dir, id, formOf, saved } = finishedRun('--persona-form', 'voice');
  assert.equal(saved, 'voice', 'premise: the run saved its form'); assert.equal(formOf(id), 'voice', 'premise: it used the voice form');
  const rematch = run(dir, ['--rematch', join('runs', id), '--rematch-seed', '1'], {});
  assert.equal(rematch.status, 0, `the rematch ran: ${rematch.stderr.slice(0, 300)} ${rematch.stdout.slice(-300)}`);
  assert.equal(formOf(`${id}.rematch-1`), 'voice', 'the rematch sent its seats the form the run saved, not the chain file\'s');
});

test('PE-7b a REPLAY of a run that saved persona_form keeps it: the replay reports the form the run used', () => {
  const { dir, id, formOf, saved } = finishedRun('--persona-form', 'voice');
  assert.equal(saved, 'voice', 'premise: the run saved its form'); assert.equal(formOf(id), 'voice', 'premise: it used the voice form');
  const replay = run(dir, ['--replay', join('runs', id)], {});
  assert.equal(replay.status, 0, `the replay ran: ${replay.stderr.slice(0, 300)} ${replay.stdout.slice(-300)}`);
  const replayed = runsOf(dir).find(n => n.startsWith(`${id}.replay-`)); assert.ok(replayed, 'premise: a replay folder was made');
  assert.equal(formOf(replayed), 'voice', 'the replay sent its seats the form the run saved');
});

test('PE-7c a run started WITHOUT the flag rematches and replays in the chain file\'s form, as before this setting existed (no saved form, nothing applied)', () => {
  const { dir, id, formOf, saved } = finishedRun();
  assert.equal(saved, undefined, 'premise: this run saved no form'); assert.equal(formOf(id), 'title', 'premise: it used the chain file\'s form');
  assert.equal(run(dir, ['--rematch', join('runs', id), '--rematch-seed', '1'], {}).status, 0);
  assert.equal(formOf(`${id}.rematch-1`), 'title', 'no saved form: the rematch uses the chain file\'s form');
  assert.equal(run(dir, ['--replay', join('runs', id)], {}).status, 0);
  const replayed = runsOf(dir).find(n => n.startsWith(`${id}.replay-`)); assert.ok(replayed, 'premise: a replay folder was made');
  assert.equal(formOf(replayed), 'title', 'no saved form: the replay uses the chain file\'s form');
});

// one stdio session to the MCP server: copied verbatim from test/claude-route-entry-points.test.js (no *.test.js file is imported)
function session(dir, env) {
  const child = spawn(process.execPath, [cli, '--mcp'], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir, ...env } });
  const waiting = new Map(); let buf = ''; let n = 0;
  child.stdout.on('data', d => { buf += d; let nl; while ((nl = buf.indexOf('\n')) !== -1) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); let m; try { m = JSON.parse(line); } catch { continue; } if (m.id !== undefined && !m.method && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } } });
  const rpc = (method, params) => new Promise((ok, no) => { const id = ++n; const t = setTimeout(() => { waiting.delete(id); no(new Error(`no reply to ${method} in ${WAIT_MS} ms`)); }, WAIT_MS); waiting.set(id, m => { clearTimeout(t); ok(m); }); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  const ready = rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-route-test', version: '1.0' } }).then(() => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`));
  return {
    async tools() { await ready; return (await rpc('tools/list', {})).result.tools; },
    async call(name, args) { await ready; const m = await rpc('tools/call', { name, arguments: args }); try { return JSON.parse(m.result.content[0].text); } catch { return m.result ?? m; } },
    close: () => new Promise(done => { const t = setTimeout(() => { child.kill('SIGKILL'); done(); }, 5000); child.once('exit', () => { clearTimeout(t); done(); }); child.stdin.end(); child.kill(); }),
  };
}

test('PE-4 the MCP tools list persona_form, refuse a bad value and a chain without the switch before a run id is taken (naming the argument), and dry_run with it names the form; resume_run takes none', async () => {
  const dir = work(); const s = session(dir, KEYS.anthropic);
  try {
    const tools = await s.tools();
    for (const name of ['dry_run', 'start_run']) assert.ok(tools.find(t => t.name === name).inputSchema.properties.persona_form, `${name} lists persona_form`);
    assert.equal(tools.find(t => t.name === 'resume_run').inputSchema.properties.persona_form, undefined, 'resume_run takes none: the saved form is the one in force');
    const bad = await s.call('start_run', { chain: 'persona-ext', task: 'tasks/x.md', persona_form: 'maybe' });
    assert.equal(bad.started, false); assert.equal(bad.error, personaFormNotAFormSentence(PERSONA_FORM_ARGUMENT, 'maybe'));
    const none = await s.call('start_run', { chain: 'plain-mock', task: 'tasks/x.md', persona_form: 'voice' });
    assert.equal(none.started, false); assert.equal(none.error, personaFormNoSwitchSentence(PERSONA_FORM_ARGUMENT));
    const dryBad = await s.call('dry_run', { chain: 'plain-mock', persona_form: 'voice' });
    assert.equal(dryBad.error, personaFormNoSwitchSentence(PERSONA_FORM_ARGUMENT));
    assert.ok(noRuns(dir), 'no run id was taken');
    const dry = await s.call('dry_run', { chain: MINI, persona_form: 'voice' });
    assert.ok(typeof dry === 'string' ? dry.includes(LINE_VOICE) : JSON.stringify(dry).includes(LINE_VOICE), `the dry run names the form: ${JSON.stringify(dry).slice(0, 300)}`);
    const dryTitle = await s.call('dry_run', { chain: MINI });
    assert.ok(!(typeof dryTitle === 'string' ? dryTitle : JSON.stringify(dryTitle)).includes('Seat personas:'), 'without the argument nothing is said');
  } finally { await s.close(); }
});

test('PE-5 `council --help` carries the flag\'s lines, whole, between the start line\'s own entry and the resume line', () => {
  const dir = work();
  const help = run(dir, ['--help'], {});
  assert.equal(help.status, 0, help.stderr.slice(0, 300));
  const out = `${help.stdout}${help.stderr}`;
  assert.ok(out.includes(PERSONA_FORM_HELP_LINES.join('\n')), 'the four help lines are there, in order');
  const at = out.indexOf(PERSONA_FORM_HELP_LINES[0]);
  assert.ok(out.slice(0, at).includes('stops and asks you what next'), 'after the --rounds entry'); assert.ok(out.slice(at).includes('council --resume <run folder> --continue | --finish | --finish-now'), 'before the --resume entry');
});
