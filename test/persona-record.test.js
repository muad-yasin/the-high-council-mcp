// 0.8.4, lane C, unit 1: the per-seat persona record (plan C's D5 on the built persona code). Per stage row `persona`, `persona_name`, `persona_set_sha256`, `model_source` (null where there is none); per run `personas_source`,
// `personas_sha256`, `personas_used`. STAMPED WHEN THE PROMPT IS BUILT (src/stage-system.js notes it on the seat), put on the row by src/cli.js's onStage, kept in the stage's usage.json and read back on a resume. All offline,
// mock seats, $0. The expected hashes are computed here with their own key-sorting, not by the code under test; the prompt a seat was sent is read with setPromptSpy, so a name in a row is checked against the prompt itself.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, setCache, setBudget, setPromptSpy } from '../src/chain.js';
import { reportJsonShape } from '../src/report-shape.js';
import { submitStageAnswer } from '../src/stage-submission.js';
import * as P from '../src/personas.js';
import * as SR from '../src/seat-role.js';
// the new exports are read off the module namespaces on purpose: a missing one fails each test that uses it by name, not the whole file at import
const PR = await import('../src/persona-record.js').catch(() => ({}));
const AB = await import('../src/answered-by.js').catch(() => ({}));
const { DEFAULT_PERSONAS } = P;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const chainFile = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));
const ENV = 'COUNCIL_PERSONAS_FILE';
const savedEnv = process.env[ENV];
afterEach(() => { setCache(null); setBudget(null); setPromptSpy(null); if (savedEnv === undefined) delete process.env[ENV]; else process.env[ENV] = savedEnv; });

const canon = v => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v));
const sha = v => createHash('sha256').update(canon(v), 'utf8').digest('hex');
const KEYS = ['persona', 'persona_name', 'persona_set_sha256', 'model_source'];
const RUN_KEYS = ['personas_source', 'personas_sha256', 'personas_used'];
const tmp = tag => mkdtempSync(join(tmpdir(), `persona-record-${tag}-`));

// mock-debate with a persona key on its proposers (null: none), run in-process the way src/cli.js's onStage handles every row (it stamps the row the moment the stage finishes)
const debateConfig = (keys = ['noah']) => { const cfg = chainFile('mock-debate'); keys.forEach((k, i) => { if (k !== null) cfg.seats.proposers[i].role = { persona: k }; }); return cfg; };
const stampOnStage = config => s => { if (PR.personaStampFor) Object.assign(s, PR.personaStampFor(s, config)); };   // guarded: on a tree without the module the run still completes and the assertions below fail one by one
async function runOf(cfg, extra = {}) {
  const prompts = [];
  setPromptSpy(p => prompts.push(p));
  const r = await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-persona-record', config: cfg, onStage: stampOnStage(cfg), ...extra });
  setPromptSpy(null);
  return { r, prompts, report: JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-persona-record', chain: cfg.name, task: 'task.md', result: r, config: cfg }))) };
}
const debateRows = report => report.stages.filter(s => /^debate-/.test(s.label));

test('a debating seat\'s rows: the persona key, the name its PROMPT carried (read off the prompt), the hash of the set it was built from, where the model comes from; the run says which set and where from', async () => {
  delete process.env[ENV];
  const { report, prompts } = await runOf(debateConfig(['noah']));
  const rows = debateRows(report);
  const named = rows.filter(s => s.persona !== null && s.persona !== undefined);
  assert.equal(named.length, 1, 'only the seat that carries a persona key is named');
  assert.deepEqual(KEYS.map(k => named[0]?.[k]), ['noah', 'Noah', sha(DEFAULT_PERSONAS), 'provider']);
  assert.match(prompts.find(p => p.label === named[0]?.label)?.system ?? '', /You are arguing as noah \(Noah\)\./, 'the prompt carried the name the row says');
  for (const s of rows.filter(r => r.persona === null)) {
    assert.deepEqual(KEYS.map(k => s[k]), [null, null, null, 'provider'], s.label);
    assert.doesNotMatch(prompts.find(p => p.label === s.label)?.system ?? '', /\[SEAT ROLE\]/, `${s.label} carried no persona text`);
  }
  assert.deepEqual(RUN_KEYS.map(k => report[k]), ['default', sha(DEFAULT_PERSONAS), ['noah']]);
  assert.equal('persona_set_source' in (report.stages[0] ?? {}), false, 'the stored-only source is not a report field');
});

test('THE SET IS THE ONE THE PROMPT WAS BUILT FROM: the persona file is rewritten right after the debate prompt is built; the row names the FIRST set, not the one on disk when the stage ended', async () => {
  const dir = tmp('mid');
  const file = join(dir, 'personas.json');
  const first = { noah: { name: 'Noah the First', voice: 'Plans for the flood first.' } };
  writeFileSync(file, JSON.stringify(first));
  process.env[ENV] = file;
  const cfg = debateConfig(['noah']);
  let rewrote = false;
  const prompts = [];
  setPromptSpy(p => { prompts.push(p); if (/^debate-/.test(p.label) && !rewrote) { rewrote = true; writeFileSync(file, JSON.stringify({ noah: { name: 'Noah the Second', voice: 'Another voice.' } })); } });
  const r = await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-mid', config: cfg, onStage: stampOnStage(cfg) });
  const report = JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-mid', chain: cfg.name, task: 'task.md', result: r, config: cfg })));
  assert.ok(rewrote, 'precondition: the file was rewritten after a debate prompt');
  const row = debateRows(report).find(s => s.persona) ?? {};
  assert.equal(row.persona_set_sha256, sha(first));
  assert.equal(row.persona_name, 'Noah the First');
  assert.match(prompts.find(p => p.label === row.label)?.system ?? '', /Noah the First/);
  assert.equal(report.personas_sha256, sha(first));
  assert.equal(report.personas_source, 'file');
});

test('persona_name is what the prompt carried, as src/seat-role.js sends it: an unknown key goes as the bare key, an incomplete entry of the operator\'s own file likewise, a complete one by its name; an unreadable file says "fallback"', async () => {
  const dir = tmp('names');
  const file = join(dir, 'personas.json');
  const set = { noah: { name: 'Noah the Ark-Builder', voice: 'Plans for the flood first.' }, half: { name: 'Half' } };
  writeFileSync(file, JSON.stringify(set));
  process.env[ENV] = file;
  const { report, prompts } = await runOf(debateConfig(['noah', 'half']));
  const byPersona = Object.fromEntries(debateRows(report).filter(s => s.persona).map(s => [s.persona, s]));
  assert.equal(byPersona.noah?.persona_name, 'Noah the Ark-Builder');
  assert.equal(byPersona.half?.persona_name, 'half', 'an entry without a voice is not written into a prompt: the bare key went out');
  assert.match(prompts.find(p => p.label === byPersona.half?.label)?.system ?? '', /You are arguing as half\. /);
  assert.equal(SR.personaEntryUsable(set.half), false); assert.equal(SR.personaEntryUsable(set.noah), true);
  assert.deepEqual(RUN_KEYS.map(k => report[k]), ['file', sha(set), ['noah', 'half']]);
  assert.equal(debateRows((await runOf(debateConfig(['nobody']))).report).find(s => s.persona)?.persona_name, 'nobody');
  process.env[ENV] = join(dir, 'no-such-file.json');
  const lost = (await runOf(debateConfig(['noah']))).report;
  assert.deepEqual(RUN_KEYS.map(k => lost[k]), ['fallback', sha(DEFAULT_PERSONAS), ['noah']]);
});

test('a chain with no persona anywhere: every row carries the fields as null (model_source provider), the report has no run-level set fields, and no prompt carries a [SEAT ROLE]', async () => {
  delete process.env[ENV];
  const { report, prompts } = await runOf(debateConfig([null]));
  assert.ok(report.stages.length > 5);
  for (const s of report.stages) assert.deepEqual(KEYS.map(k => s[k]), [null, null, null, 'provider'], s.label);
  for (const k of RUN_KEYS) assert.equal(k in report, false, k);
  assert.ok(prompts.every(p => !/\[SEAT ROLE\]/.test(p.system)));
});

// ---- judges: a layered run (the shape test/judge-persona.test.js drives), with the same model on two layers ----
const jseat = (model, lab, layer, persona) => ({ provider: 'mock', model, lab, layer, ...(persona !== undefined ? { persona } : {}) });
// CHANGED ACCEPTED (0.8.4, lane C rebased over M0). OLD: this config carried `layer_debate: { enabled: true }`. NEW: the key is gone. WHY: M0 removed `layer_debate` (the exchange between the judges of the lowest layer is part of every layered run) and chain-lint refuses the key as a removed setting, so a config that kept it would no longer load; and in this config no `lreply-1-*` stage runs any more: both layer-1 judges are `mock-exch-support-keep`, which post `support` on every objection they are shown (src/providers.js, the `mock-exch-<post>-<reply>` exchange branch); before M0 a raiser was asked to reply after any post other than no_view, so that support drew a reply, and since M0 a layer-1 raiser is asked only after a counted contest or insufficient-evidence post (`asks` in `exchangeRound`, src/chain.js); the `panel-` and `ldebate-` stages these tests assert on still run.
const judgeConfig = (extra = {}) => ({
  name: 'persona-record-judges', maxRounds: 1, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' },
    critics: [jseat('mock-exch-support-keep', 'e1', 1, 'Moses'), jseat('mock-exch-support-keep', 'e2', 1)] }, ...extra,
});
test('judge rows on a real layered run: the NAME IN EACH ROW IS THE NAME IN ITS PROMPT, both directions (every prompt of the run); the switch decides; a judge reads no set', async () => {
  for (const on of [true, false]) {
    const { report, prompts } = await runOf(judgeConfig(on ? { seat_personas: { enabled: true, form: 'voice' } } : {}));
    const judgeRows = report.stages.filter(s => /^(panel|ldebate|lreply)-/.test(s.label));
    const named = judgeRows.filter(s => s.persona !== null);
    assert.deepEqual([...new Set(named.map(s => s.persona))].sort(), ['Moses']);
    assert.ok(named.some(s => /^panel-/.test(s.label)) && named.some(s => /^ldebate-/.test(s.label)), 'the verdict and the exchange rows');
    for (const s of named) {
      assert.equal(s.persona_name, on ? s.persona : null, s.label);
      assert.equal(s.persona_set_sha256, null, `${s.label}: a judge's name is never looked up in the set`);
    }
    // both directions against the prompts the seats were sent: every prompt of the run, so a persona block in a family the row rules miss fails here
    for (const p of prompts) {
      const carried = /voice of ([A-Za-z]+)\./.exec(p.system ?? '');
      const row = report.stages.find(s => s.label === p.label);
      assert.ok(row, `${p.label}: a prompt with no stage row`);
      assert.equal(row.persona_name, carried ? carried[1] : null, `${p.label}: the row names what its prompt carried`);
    }
    for (const s of judgeRows.filter(x => x.lab === 'e2')) assert.equal(s.persona, null, `${s.label}: e2 carries no persona`);
    for (const k of RUN_KEYS) assert.equal(k in report, false, k);
  }
});

test('a model repeated on two layers keeps its two personas apart: the layer-2 seat (seat key la-l2) is named Melchizedek, the layer-1 seat Noah, each by the name in its own prompt', async () => {
  // the shape test/lab-identity-paths.test.js uses to reach a repeated top-layer seat: replies come from a cache, every seat states a pass
  const CRITERION = 'The plan defines a retry limit.';
  const DRAFT = 'The worker retries failed requests.';
  const meets = JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok' });
  setCache({ invalidate() {}, get(label) { return { text: label.startsWith('panel-') ? meets : DRAFT, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 }; } });
  const seat = (lab, layer, persona) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, ...(layer === undefined ? {} : { layer }), ...(persona ? { persona } : {}) });
  const cfg = { name: 'persona-record-repeat', criteria: [CRITERION], maxRounds: 2, signoff: 'unanimous', seat_personas: { enabled: true, form: 'voice' },
    seats: { builder: seat('writer'), reviser: seat('writer'), critics: [seat('la', 1, 'Noah'), seat('la', 2, 'Melchizedek')] } };
  const { report, prompts } = await runOf(cfg);
  const panelRows = report.stages.filter(s => /^panel-/.test(s.label));
  const l1 = panelRows.find(s => s.seat === undefined) ?? {};
  const l2 = panelRows.find(s => s.seat === 'la-l2') ?? {};
  assert.deepEqual([l1.persona, l1.persona_name, l2.persona, l2.persona_name], ['Noah', 'Noah', 'Melchizedek', 'Melchizedek'], panelRows.map(s => s.label).join(','));
  assert.match(prompts.find(p => p.label === l1.label)?.system ?? '', /voice of Noah\./);
  assert.match(prompts.find(p => p.label === l2.label)?.system ?? '', /voice of Melchizedek\./);
});

test('stage rows of a debating seat that are not its debate post (propose-, reply-) name the persona but carry no prompt name and no set', async () => {
  delete process.env[ENV];
  const { report } = await runOf(debateConfig(['noah']));
  const others = report.stages.filter(s => /^(propose|reply)-/.test(s.label) && s.persona !== null);
  assert.ok(others.length > 0, 'precondition: the seat has propose-/reply- rows');
  for (const s of others) assert.deepEqual(KEYS.map(k => s[k]), ['noah', null, null, 'provider'], s.label);
});

test('personaFieldsFromUsage: all five fields or none; anything malformed (a bad hash, a made-up source, an object where a name goes, a missing key) reads as no stamp; hidden characters are blanked', () => {
  const good = { persona: 'noah', persona_name: 'Noah', persona_set_sha256: 'a'.repeat(64), model_source: 'provider', persona_set_source: 'default' };
  assert.deepEqual(PR.personaFieldsFromUsage(good), good);
  assert.deepEqual(PR.personaFieldsFromUsage({ persona: null, persona_name: null, persona_set_sha256: null, model_source: 'declared', persona_set_source: null }), { persona: null, persona_name: null, persona_set_sha256: null, model_source: 'declared', persona_set_source: null });
  for (const bad of [{ ...good, persona_set_sha256: 'zz' }, { ...good, persona_set_source: 'guessed' }, { ...good, model_source: 'verified' }, { ...good, persona_name: { x: 1 } }, { ...good, persona: 7 }, (({ persona_name, ...r }) => r)(good), null, [], 'x']) {
    assert.equal(PR.personaFieldsFromUsage(bad), null, JSON.stringify(bad));
  }
  assert.equal(PR.personaFieldsFromUsage({ ...good, persona_name: 'No​ah\u0007' }).persona_name.includes('​'), false);
  assert.deepEqual(PR.personaUsageFields({ label: 'x' }), {}, 'a row with no stamp writes nothing');
});

test('model_source: provider unless the seat is a session seat; a session seat is "declared" when its answerer named a model and "undeclared" when it named none', () => {
  assert.equal(AB.modelSourceOf({ provider: 'anthropic', model: 'x' }), 'provider');
  assert.equal(AB.modelSourceOf({ provider: 'mock', model: 'x' }), 'provider');
  assert.equal(AB.modelSourceOf({ provider: 'external', model: 'session', answered_by: { client: null, model: 'opus-5.5', declared_by: 'caller' } }), 'declared');
  assert.equal(AB.modelSourceOf({ provider: 'external', model: 'session', answered_by: { client: { name: 'x', version: '1' }, model: null, declared_by: 'client' } }), 'undeclared');
  assert.equal(AB.modelSourceOf({ provider: 'external', model: 'session' }), 'undeclared');
  assert.equal(AB.modelSourceOf({ provider: 'external', model: 'session', answered_by: { model: '' } }), 'undeclared');
});

test('loadPersonasWithSource tells default / file / fallback; loadPersonas returns exactly its set (the shipped object itself when nothing was configured)', () => {
  const dir = tmp('src');
  const good = join(dir, 'good.json'); writeFileSync(good, JSON.stringify({ a: { name: 'A', voice: 'v' } }));
  const bad = join(dir, 'bad.json'); writeFileSync(bad, '{ not json');
  const scalar = join(dir, 'scalar.json'); writeFileSync(scalar, '42');
  delete process.env[ENV];
  assert.deepEqual(P.loadPersonasWithSource(), { set: DEFAULT_PERSONAS, source: 'default' });
  assert.equal(P.loadPersonas(), DEFAULT_PERSONAS);
  assert.equal(P.loadPersonasWithSource({ personasFile: good }).source, 'file');
  assert.deepEqual(P.loadPersonas({ personasFile: good }), { a: { name: 'A', voice: 'v' } });
  assert.deepEqual(P.loadPersonasWithSource({ personasFile: bad }), { set: DEFAULT_PERSONAS, source: 'fallback' });
  assert.deepEqual(P.loadPersonasWithSource({ personasFile: scalar }), { set: DEFAULT_PERSONAS, source: 'fallback' });
  assert.equal(P.loadPersonas({ personasFile: bad }), DEFAULT_PERSONAS);
});

// ---- the REAL path: src/cli.js, a run paused at session seats and resumed ----
test('THE CLI: stamped rows reach usage.json and report.json; a resume keeps the stamps; a session seat\'s answer is stamped when it is first consumed; a malformed stamp in a usage file reads as no stamp', () => {
  delete process.env[ENV];
  const dir = tmp('cli');
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 'smoke.md'), 'Plan a small offline tool that keeps a list of notes.');
  const cfg = chainFile('mock-external');   // the builder and reviser are session seats: the run pauses
  // CHANGED ACCEPTED TEST (unit 3, commit 3e2f71bc; recorded here in unit 4). OLD bar: the chain carries seat_personas { enabled: true, form: 'voice' } beside a proposer's role.persona, and the judge row says persona_name 'Moses'. NEW bar: the switch is off, the judge row says persona_name null. WHY: the lint now refuses a proposer's role.persona under the form voice (a second voice source for one seat), so the old chain no longer starts; the switch-on judge rows stay covered in-process by this file's other tests and by test/seat-title.test.js.
  cfg.name = 'probe-persona';   // the switch is OFF: a proposer's role.persona (the debate stage's own voice route) and the switch's persona cannot be on in one chain (the lint refuses it), so the judge's persona below is configured and never sent
  cfg.seats.proposers[0].role = { persona: 'noah' };
  cfg.seats.critics[0].persona = 'Moses';
  writeFileSync(join(dir, 'chains', 'probe-persona.json'), JSON.stringify(cfg, null, 2));
  const env = { PATH: process.env.PATH };
  const first = spawnSync('node', [cli, '--chain', 'probe-persona', '--task', 'tasks/smoke.md'], { encoding: 'utf8', cwd: dir, env });
  assert.equal(first.status, 3, `paused at the session seat\n${first.stdout}\n${first.stderr}`);
  const run = readdirSync(join(dir, 'runs'))[0];
  const runDir = join(dir, 'runs', run);
  const usageOf = label => JSON.parse(readFileSync(join(runDir, `${label}.usage.json`), 'utf8'));
  const debateLabel = readdirSync(runDir).find(f => /^debate-mock-a\.usage\.json$/.test(f))?.replace('.usage.json', '');
  assert.ok(debateLabel, 'the first sitting ran the debate stage');
  const u1 = usageOf(debateLabel);
  assert.deepEqual([u1.persona, u1.persona_name, u1.persona_set_sha256, u1.model_source, u1.persona_set_source], ['noah', 'Noah', sha(DEFAULT_PERSONAS), 'provider', 'default']);
  // a malformed stamp in another stage's usage file: that row reads as unstamped, the run goes on
  const other = readdirSync(runDir).find(f => /^debate-mock-b\.usage\.json$/.test(f));
  assert.ok(other);
  writeFileSync(join(runDir, other), JSON.stringify({ ...JSON.parse(readFileSync(join(runDir, other), 'utf8')), persona_set_sha256: 'not-a-hash' }));
  let sittings = 0;
  while (!existsSync(join(runDir, 'report.json'))) {
    assert.ok(++sittings <= 8, `never finished: ${readdirSync(runDir).join(', ')}`);
    for (const f of readdirSync(runDir).filter(n => /^NEEDS-.*\.md$/.test(n))) {
      const answer = join(runDir, f.slice('NEEDS-'.length));
      if (!existsSync(answer)) writeFileSync(answer, '# Plan\n\nOne JSON file of notes; add, list and delete from the command line.\n');
    }
    const r = spawnSync('node', [cli, '--resume', join('runs', run)], { encoding: 'utf8', cwd: dir, env });
    assert.ok([0, 3, 22].includes(r.status), `resume exit ${r.status}\n${r.stdout}\n${r.stderr}`);
  }
  const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
  const row = report.stages.find(s => s.label === debateLabel);
  assert.equal(row.cached, true, 'replayed on the resume');
  assert.deepEqual(KEYS.map(k => row[k]), ['noah', 'Noah', sha(DEFAULT_PERSONAS), 'provider'], 'the stamp of the sitting that made the call survived the resume');
  assert.deepEqual(RUN_KEYS.map(k => report[k]), ['default', sha(DEFAULT_PERSONAS), ['noah']]);
  const unstamped = report.stages.find(s => s.label === other.replace('.usage.json', ''));
  assert.equal(unstamped.persona, undefined, 'a malformed stamp reads as none');
  assert.ok(report.stages.some(s => /^panel-/.test(s.label) && s.persona === 'Moses' && s.persona_name === null), 'a judge persona with the switch off: configured, its prompt carried no name');
  // the session seats' rows (answers written by hand, as the NEEDS file says): stamped, model_source says nobody declared a model, and NO usage file was made for them (src/spend.js reads a usage file with no `usd` as an unknown figure)
  const sessionRows = report.stages.filter(s => s.provider === 'external');
  assert.ok(sessionRows.length > 0);
  for (const s of sessionRows) {
    assert.equal(s.model_source, 'undeclared', s.label);
    assert.equal(s.persona, null, `${s.label}: no persona on a session seat without one`);
    assert.equal(existsSync(join(runDir, `${s.label}.usage.json`)), false, `${s.label}: a stamp never creates a usage file`);
  }
});

// ---- the paused path: the set is the one the NEEDS prompt was built from, not the one on disk when the answer is consumed ----
function project(tag, chainName, cfg) {
  const dir = tmp(tag);
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 'smoke.md'), 'Plan a small offline tool that keeps a list of notes.');
  writeFileSync(join(dir, 'chains', `${chainName}.json`), JSON.stringify({ ...cfg, name: chainName }, null, 2));
  return dir;
}
const sh = (dir, args, env) => spawnSync('node', [cli, ...args], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH, ...env } });

function pauseScenario(route) {   // route: 'submit' (the MCP submit_stage path, which writes a usage file) or 'hand' (the file the NEEDS text tells a person to write, which makes none)
  const file = join(tmp('pausefile'), 'personas.json');
  const set1 = { noah: { name: 'Noah the Ark-Builder', voice: 'Plans for the flood first.' }, other: { name: 'Other', voice: 'An entry the seat does not use.' } };
  const set2 = { ...set1, other: { name: 'Other', voice: 'The same entry, edited while the run waited.' } };
  assert.notEqual(sha(set1), sha(set2));
  writeFileSync(file, JSON.stringify(set1));
  const env = { [ENV]: file };
  // the answers a session would give: the all-mock run of the same chain writes valid ones (the prompt text is what the resume checks, not who wrote the answer)
  const harvest = project('harvest', 'mock-debate', chainFile('mock-debate'));
  assert.ok([0, 22].includes(sh(harvest, ['--chain', 'mock-debate', '--task', 'tasks/smoke.md'], {}).status));
  const harvested = join(harvest, 'runs', readdirSync(join(harvest, 'runs'))[0]);
  const cfg = chainFile('mock-debate');
  cfg.seats.proposers[0] = { provider: 'external', model: 'claude-code-session', lab: 'mock-a', role: { persona: 'noah' } };
  const dir = project('pause', 'probe-pause-persona', cfg);
  assert.equal(sh(dir, ['--chain', 'probe-pause-persona', '--task', 'tasks/smoke.md'], env).status, 3);
  const runDir = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  let edited = false, sittings = 0;
  while (!existsSync(join(runDir, 'report.json'))) {
    assert.ok(++sittings <= 12, `never finished: ${readdirSync(runDir).join(', ')}`);
    for (const f of readdirSync(runDir).filter(n => /^NEEDS-.*\.md$/.test(n))) {
      const label = f.slice('NEEDS-'.length, -3);
      const answer = join(runDir, `${label}.md`);
      if (existsSync(answer)) continue;
      if (label === 'debate-mock-a' && !edited) {
        const note = JSON.parse(readFileSync(join(runDir, `${label}.prompt.json`), 'utf8')).persona_note;
        assert.equal(note?.persona_set_sha256, sha(set1), 'the pause wrote the note of the prompt it built');
        writeFileSync(file, JSON.stringify(set2));   // the file changes while the run waits for the answer (an entry the seat does not use, so its prompt, and the answer's check, are unchanged)
        edited = true;
      }
      const body = existsSync(join(harvested, `${label}.md`)) ? readFileSync(join(harvested, `${label}.md`), 'utf8') : '# Plan\n\nOne JSON file of notes.\n';
      if (label === 'debate-mock-a' && route === 'submit') submitStageAnswer(runDir, label, body, { chainConfig: cfg });
      else writeFileSync(answer, body);
    }
    const r = sh(dir, ['--resume', join('runs', readdirSync(join(dir, 'runs'))[0])], env);
    assert.ok([0, 3, 22].includes(r.status), `resume exit ${r.status}\n${r.stdout}\n${r.stderr}`);
  }
  assert.ok(edited, 'precondition: the debate stage paused at the session seat');
  const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
  return { report, runDir, set1 };
}
for (const route of ['hand', 'submit']) {
  test(`PAUSE, EDIT THE PERSONA FILE, ANSWER (${route}), RESUME: a session seat's debate row carries the hash of the set its NEEDS prompt was built from, not the edited file's`, () => {
    const { report, runDir, set1 } = pauseScenario(route);
    const row = report.stages.find(s => s.label === 'debate-mock-a') ?? {};
    assert.deepEqual(KEYS.map(k => row[k]), ['noah', 'Noah the Ark-Builder', sha(set1), 'undeclared'], 'the OLD set\'s hash, not the file\'s');
    assert.deepEqual(RUN_KEYS.map(k => report[k]), ['file', sha(set1), ['noah']]);
    const usage = join(runDir, 'debate-mock-a.usage.json');
    if (route === 'submit') assert.equal(JSON.parse(readFileSync(usage, 'utf8')).persona_set_sha256, sha(set1), 'kept in the usage file submit_stage wrote');
    else assert.equal(existsSync(usage), false, 'a hand-written answer gets no usage file (spend.js reads a usage file with no `usd` as an unknown figure)');
    const proposeRow = report.stages.find(s => s.label === 'propose-mock-a') ?? {};
    assert.deepEqual(KEYS.map(k => proposeRow[k]), ['noah', null, null, 'undeclared'], 'the proposal row is named, carries no prompt name and no set');
    assert.equal(existsSync(join(runDir, 'propose-mock-a.usage.json')), false);
  });
}

test('a side run (--rematch) stamps its rows too: every stage file it writes carries model_source and the persona fields', () => {
  delete process.env[ENV];
  const cfg = chainFile('mock-debate');
  cfg.seats.proposers[0].role = { persona: 'noah' };
  const dir = project('side', 'probe-side-persona', cfg);
  assert.ok([0, 22].includes(sh(dir, ['--chain', 'probe-side-persona', '--task', 'tasks/smoke.md'], {}).status));
  const id = readdirSync(join(dir, 'runs'))[0];
  const r = sh(dir, ['--rematch', join('runs', id), '--rematch-seed', '1'], {});
  assert.ok([0, 22].includes(r.status), `rematch exit ${r.status}\n${r.stdout}\n${r.stderr}`);
  const side = readdirSync(join(dir, 'runs')).find(n => n.startsWith(`${id}.rematch-`));
  assert.ok(side, 'the rematch folder exists');
  const usage = readdirSync(join(dir, 'runs', side)).filter(f => /\.usage\.json$/.test(f)).map(f => [f, JSON.parse(readFileSync(join(dir, 'runs', side, f), 'utf8'))]);
  assert.ok(usage.length > 5);
  for (const [f, u] of usage) assert.equal(u.model_source, 'provider', `${f} carries the stamp`);
  assert.ok(usage.some(([, u]) => u.persona === 'noah' && u.persona_set_sha256 === sha(DEFAULT_PERSONAS)), 'the debating seat\'s rows are named');
});
