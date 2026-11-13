// report.json as a published format: schemas/report-v1.json (JSON Schema 2020-12) checked against
// real run output, the same way test/chain-schema.test.js checks the chain schema against every
// real chain file - so drift between what the writers emit and what the schema documents fails a
// test here, not a stranger's parser later. All offline, mock seats only, $0.
//
// Three kinds of evidence:
//   1. Real CLI runs of the shipped mock chains that finish in one sitting: the report.json on
//      disk validates, carries schemaVersion, and has no top-level key the schema does not declare.
//   2. One in-process run with every optional stage switched on, so the optional fields are
//      checked too (a mock chain on disk turns on only a few of them).
//   3. Mutations the schema must reject, so a schema that accepts anything cannot pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { runChain, runDescendingChain } from '../src/chain.js';
import { reportJsonShape, reportTaskPath, REPORT_SCHEMA_VERSION } from '../src/report-shape.js';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const schema = JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
const validate = ajv.compile(schema);
const chain = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));

function assertValid(report, what) {
  assert.ok(validate(report), `${what}: ${JSON.stringify(validate.errors, null, 2)}`);
  // The published schema leaves additionalProperties open so an older reader never rejects a newer
  // report. The repo holds itself to more: every top-level key a writer emits must be documented.
  const undeclared = Object.keys(report).filter(k => !(k in schema.properties));
  assert.deepEqual(undeclared, [], `${what}: top-level key(s) missing from schemas/report-v1.json`);
}

test('report schema: every top-level field is marked stable or experimental and described', () => {
  for (const [key, prop] of Object.entries(schema.properties)) {
    assert.ok(['stable', 'experimental'].includes(prop['x-stability']), `${key}: x-stability`);
    assert.ok(typeof prop.description === 'string' && prop.description.length > 20, `${key}: description`);
  }
});

test('report schema: REPORT_SCHEMA_VERSION is the version the schema pins', () => {
  assert.equal(schema.properties.schemaVersion.const, REPORT_SCHEMA_VERSION);
  assert.match(schema.$id, new RegExp(`report-v${REPORT_SCHEMA_VERSION}\\.json$`));
});

// Every shipped mock chain that finishes in one sitting (mock-external and mock-questions-wait
// pause for a human; mock-budget stops at the cap and so writes no report.json by design).
const ONE_SITTING = ['mock', 'mock-criteria-kinds', 'mock-unanimous', 'mock-debate', 'mock-dispute', 'mock-open', 'mock-partitioned',
  'mock-patch', 'mock-patch-fallback', 'mock-proposals', 'mock-questions', 'mock-relay', 'mock-security-review', 'mock-tiered',
  'mock-layered'];   // CHANGED ACCEPTED TEST (0.8.4 add-on removal): OLD: the list also held mock-advise-quick, mock-advise-standard and mock-advise-deep (18 names). NEW: those three are not shipped chains any more (they are fixtures in test/fixtures/advice-chains/); they keep their own rows below (ADVICE_ONE_SITTING). WHY: the drift test below compares this list with chains/mock*.json, so it moves with the thing it counts.
// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD (wave 1): ADVICE_ONE_SITTING = mock-advise-quick, mock-advise-standard and mock-advise-deep, each run by name from a project folder holding a copy of its fixture, and its report.json validated (their reports carried the `advise` block). NEW: no such group. WHY: a chain file with an `advise` block is refused at the CLI start (exit 2) and by runChain, so no run folder or report exists to validate; the one thing that stays is the schema's side, asserted by the row 'an old advice report still validates' below.

test('report schema: the list above still names every mock chain that finishes in one sitting', () => {
  const shipped = readdirSync(join(root, 'chains')).filter(f => /^mock.*\.json$/.test(f)).map(f => f.slice(0, -5));
  const pausesOrStops = ['mock-external', 'mock-questions-wait', 'mock-budget'];
  assert.deepEqual(shipped.filter(n => !pausesOrStops.includes(n)).sort(), [...ONE_SITTING].sort());
});

for (const name of ONE_SITTING) {
  test(`report schema: a real ${name} run's report.json validates`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'thc-report-schema-'));
    mkdirSync(join(dir, 'tasks'));
    writeFileSync(join(dir, 'tasks', 'smoke.md'), 'Plan a small offline tool that keeps a list of notes.');
    const r = spawnSync('node', [cli, '--chain', name, '--task', 'tasks/smoke.md'], {
      encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH },
    });
    const runs = readdirSync(join(dir, 'runs'));
    assert.equal(runs.length, 1, `${name}: exit ${r.status}\n${r.stdout}\n${r.stderr}`);
    const report = JSON.parse(readFileSync(join(dir, 'runs', runs[0], 'report.json'), 'utf8'));
    assert.equal(report.schemaVersion, REPORT_SCHEMA_VERSION);
    assert.equal(report.chain, name);
    // Brief 03 fix 6: who wrote the file, and when the run began and ended.
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    // CHANGED ACCEPTED TEST (0.8.4, S1-06). OLD: assert.deepEqual(report.producer, { name: pkg.name, version: pkg.version }). NEW: name and version are asserted as before, and the producer also carries code_sha256 and sittings[].
    // WHY: the producer now says which code wrote the report and which sittings the run had; both are additive (schemas/report-v1.json has no additionalProperties:false on producer), so the old two-key equality could not hold.
    // 0.8.4: the producer also carries the code stamp (this tree can be read, so it is there) and one sitting entry per start or resume of the run.
    assert.deepEqual({ name: report.producer.name, version: report.producer.version }, { name: pkg.name, version: pkg.version });
    assert.match(report.producer.code_sha256, /^[0-9a-f]{64}$/);
    assert.ok(report.producer.sittings.length >= 1 && report.producer.sittings.every(x => x.version === pkg.version && x.code_sha256 === report.producer.code_sha256 && Number.isInteger(x.pid)), JSON.stringify(report.producer.sittings));
    assert.ok(Date.parse(report.started_at) <= Date.parse(report.finished_at), `${name}: started_at <= finished_at`);
    // Brief 03 fix 2: signoff[].lab next to the deprecated, misnamed signoff[].provider.
    for (const e of report.signoff || []) {
      assert.equal(typeof e.lab, 'string', `${name}: signoff[].lab`);
      assert.equal(e.provider, e.lab, `${name}: provider keeps holding the lab until a v2`);
    }
    assertValid(report, name);
  });
}

// The schema's side of the removal (WORDING REM-w12, REM-w16): `advise` is no longer a property of report-v1.json (nothing writes it), a report an earlier version wrote for an advice call still validates (the schema leaves
// additionalProperties open and schemaVersion is unchanged), and `stoppedBy` keeps its legacy values.
test('report schema: `advise` is no longer a property, an old advice report (test/fixtures/report-advice-*.json) still validates, and stoppedBy keeps user, client_cancel and wall_clock', () => {
  assert.equal('advise' in schema.properties, false, 'no `advise` property in schemas/report-v1.json');
  for (const f of ['report-advice-single.json', 'report-advice-council.json']) {
    const old = JSON.parse(readFileSync(join(root, 'test', 'fixtures', f), 'utf8'));
    assert.ok('advise' in old, `${f}: the fixture is an old advice report`);
    assert.equal(old.schemaVersion, REPORT_SCHEMA_VERSION, `${f}: schemaVersion unchanged`);
    assert.ok(validate(old), `${f}: ${JSON.stringify(validate.errors, null, 2)}`);
  }
  assert.ok(schema.properties.stoppedBy.enum.includes('user') && schema.properties.stoppedBy.enum.includes('client_cancel') && schema.properties.stoppedBy.enum.includes('wall_clock'), 'the legacy stoppedBy values stay in the enum');
});

test('report schema: answered_on_another_route (0.8.4 FIX 5) is experimental, an old report still validates with it added, a row needs stage, written_route and route, and answered_under_earlier_wording keeps its cause const', () => {
  const prop = schema.properties.answered_on_another_route;
  assert.equal(prop['x-stability'], 'experimental');
  const old = JSON.parse(readFileSync(join(root, 'test', 'fixtures', 'report-advice-single.json'), 'utf8'));
  const row = { stage: 'panel-1-l3', pass: 1, written_route: 'openrouter', route: 'anthropic' };
  assert.ok(validate({ ...old, answered_on_another_route: [row] }), `a report with the field: ${JSON.stringify(validate.errors)}`);
  for (const [what, bad] of Object.entries({ 'a row with no written_route': { stage: 'x', route: 'anthropic' }, 'a row with no route': { stage: 'x', written_route: 'session' }, 'a row with no stage': { written_route: 'session', route: 'anthropic' }, 'a pass of 0': { ...row, pass: 0 } })) {
    assert.equal(validate({ ...old, answered_on_another_route: [bad] }), false, `known-bad input: the schema accepted ${what}`);
  }
  assert.deepEqual(schema.properties.answered_under_earlier_wording.items.properties.cause, { const: 'prompt' }, 'the earlier-wording field keeps its cause const');
});

// Every optional stage at once, on mock seats. What each switch adds is pinned below, so a stage
// that stops reaching report.json fails here rather than silently leaving its schema unchecked.
function kitchenSink() {
  const base = chain('mock-debate');
  return {
    ...base,
    name: 'mock-kitchen-sink',
    questions: { max: 3, wait: false },
    alternatives: { enabled: true },
    argued: { enabled: true },
    coldRead: { enabled: true },
    challenge: { enabled: true },
    allocator: { enabled: true },
    canary: { enabled: true, sampleRate: 1 },
    lints: { enabled: true },
    claims: { enabled: true },
    dispute: { enabled: true, stall_rounds: 2 },
    security_review: { enabled: true },
    verify: {
      enabled: true,
      tools: [{ tool: 'run_tests', args: { file: 'test/fixture.test.js' } }],
      runTool: (tool, args) => ({ tool, args, ok: true, exitCode: 0, stdout: 'ok', stderr: '' }),
    },
    seats: {
      ...base.seats,
      questions: { provider: 'mock', model: 'mock-questions' },
      coldRead: { provider: 'mock', model: 'mock-cold-read-yes', lab: 'mock-cold-reader' },
      challenger: { provider: 'mock', model: 'mock-challenge-yes', lab: 'mock-challenger' },
      claims: { provider: 'mock', model: 'mock-claims-bad-quote' },
      security_reviewer: { provider: 'mock', model: 'mock-security-block', lab: 'mock-security' },
    },
  };
}

test('report schema: a run with every optional stage on validates, and each optional field is present', async () => {
  const config = kitchenSink();
  const result = await runChain({ config, request: 'Plan a small offline tool.\n\n```source\nNotes live in one JSON file.\n```', log: () => {} });
  const report = JSON.parse(JSON.stringify(reportJsonShape({
    runId: '2026-09-25T00-00-00-000Z', chain: config.name, task: 'tasks/smoke.md', taskText: 'Plan a small offline tool.', result, config, maxUsd: 7,
    policyChecks: [{ capability: 'max_usd_per_run', field: 'max_usd_per_run', ok: true }],
  })));
  for (const key of ['questions', 'alternatives', 'argued', 'coldRead', 'challenge', 'allocator', 'canary', 'lints',
    'claims', 'dispute', 'security_review', 'ground_truth', 'policy', 'quoteFindings', 'disagreement_groups', 'panelVerdicts', 'task_sha256']) {
    assert.ok(report[key] != null, `the kitchen-sink run should carry ${key}`);
  }
  assertValid(report, 'kitchen sink');
});

test('report schema: a descending-mode run validates and carries questions, scoreboard, orphanSections, withdrawalCycles', async () => {
  const config = {
    ...chain('mock'), name: 'mock-descending', descending: true, signoff: 'unanimous', handoff: true,
    proposals: { parts: 2 }, debate: true,
    seats: {
      ...chain('mock').seats,
      proposers: [{ provider: 'mock', model: 'mock-proposer-a', lab: 'mock-a' }, { provider: 'mock', model: 'mock-proposer-b', lab: 'mock-b' }],
      critics: [{ provider: 'mock', model: 'mock-critic-a', lab: 'mock-a' }, { provider: 'mock', model: 'mock-critic-b', lab: 'mock-b' }],
    },
  };
  const result = await runDescendingChain({ request: 'Plan a small offline tool.', config, log: () => {} });
  const report = JSON.parse(JSON.stringify(reportJsonShape({ runId: 'd', chain: config.name, task: 't', result, config })));
  assertValid(report, 'descending');
  // Brief 03 fix 1: runDescendingChain never set these, so the keys vanished from report.json.
  assert.equal(report.questions, null);
  assert.equal(report.scoreboard, null);
  assert.deepEqual(report.orphanSections, []);
  assert.equal(report.withdrawalCycles, 0);
});

test('report schema: a report written before 0.7.7 (no schemaVersion) still validates', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-report-schema-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 'smoke.md'), 'Plan a small offline tool that keeps a list of notes.');
  spawnSync('node', [cli, '--chain', 'mock-debate', '--task', 'tasks/smoke.md'], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH } });
  const run = readdirSync(join(dir, 'runs'))[0];
  const { schemaVersion, ...old } = JSON.parse(readFileSync(join(dir, 'runs', run, 'report.json'), 'utf8'));
  assert.equal(schemaVersion, REPORT_SCHEMA_VERSION);
  assertValid(old, 'pre-0.7.7 report');

  // ...and the schema is not vacuous: each of these breaks a documented rule and must be rejected.
  const report = { schemaVersion, ...old };
  const broken = {
    'a future breaking version': r => { r.schemaVersion = 2; },
    'an unknown outcome': r => { r.outcome = 'mostly'; },
    'a signoff entry with no model': r => { delete r.signoff[0].model; },
    'a post with an unknown stance': r => { r.debate.posts[0].stance = 'shrug'; },
    'a reply with an unknown action': r => { r.debate.replies[0].action = 'maybe'; },
    'a negative stage cost': r => { r.stages[0].usd = -1; },
    'a missing totals.unpriced': r => { delete r.totals.unpriced; },
    'a missing required top-level field': r => { delete r.dropouts; },
  };
  for (const [what, mutate] of Object.entries(broken)) {
    const copy = structuredClone(report);
    mutate(copy);
    assert.equal(validate(copy), false, `the schema accepted ${what}`);
  }
});

// Brief 03 fix 4: run.json keeps the task as an absolute path so a resume finds it, and every writer
// after the first sitting used to copy that into report.json (/home/<user>/...). Walked here as a
// person would: a mock-external run, paused, answered and resumed until it finishes.
test('report schema: a resumed run writes the task relative to where it started, plus task_sha256', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-report-task-'));
  mkdirSync(join(dir, 'tasks'));
  const text = 'Plan a small offline tool that keeps a list of notes.';
  writeFileSync(join(dir, 'tasks', 'smoke.md'), text);
  const env = { PATH: process.env.PATH };
  spawnSync('node', [cli, '--chain', 'mock-external', '--task', 'tasks/smoke.md'], { encoding: 'utf8', cwd: dir, env });
  const run = readdirSync(join(dir, 'runs'))[0];
  const runDir = join(dir, 'runs', run);
  const runMeta = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
  assert.equal(runMeta.task, join(dir, 'tasks', 'smoke.md'), 'run.json itself keeps the absolute path, for resume');
  let sittings = 0;
  while (!existsSync(join(runDir, 'report.json'))) {
    assert.ok(++sittings <= 6, `mock-external never finished: ${readdirSync(runDir).join(', ')}`);
    for (const f of readdirSync(runDir).filter(n => /^NEEDS-.*\.md$/.test(n))) {
      const answer = join(runDir, f.slice('NEEDS-'.length));
      if (!existsSync(answer)) writeFileSync(answer, '# Plan\n\nOne JSON file of notes; add, list and delete from the command line.\n');
    }
    const r = spawnSync('node', [cli, '--resume', join('runs', run)], { encoding: 'utf8', cwd: dir, env });
    assert.ok([0, 3, 22].includes(r.status), `resume exit ${r.status}\n${r.stdout}\n${r.stderr}`);   // 22: a finished run whose mock panel did not agree (0.8.3; exit-not-agreed.test.js pins the rule)
  }
  assert.ok(sittings >= 1, 'the run was resumed at least once');
  const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
  assert.equal(report.task, 'tasks/smoke.md');
  assert.equal(report.started_at, runMeta.startedAt, 'started_at is the first sitting\'s, carried in run.json across resumes');
  assert.ok(Date.parse(report.finished_at) > Date.parse(report.started_at));
  const sha = createHash('sha256').update(text, 'utf8').digest('hex');
  assert.equal(report.task_sha256, sha);
  assert.equal(sha.slice(0, runMeta.taskHash.length), runMeta.taskHash, 'task_sha256 extends run.json\'s taskHash');
  assert.ok(!JSON.stringify(report).includes(dir), 'no absolute path under the run\'s own directory anywhere in report.json');
  assertValid(report, 'resumed mock-external');
});

test('reportTaskPath: relative inside the start directory, the file name outside it, never absolute', () => {
  assert.equal(reportTaskPath('/home/u/proj/tasks/x.md', '/home/u/proj'), 'tasks/x.md');
  assert.equal(reportTaskPath('/home/u/elsewhere/x.md', '/home/u/proj'), 'x.md');
  assert.equal(reportTaskPath('/home/u/proj/tasks/x.md', null), 'x.md', 'no start directory known: the file name only');
  assert.equal(reportTaskPath('tasks/x.md', '/home/u/proj'), 'tasks/x.md', 'a relative path is kept as given');
  assert.equal(reportTaskPath(null, '/home/u/proj'), null);
  assert.equal(reportTaskPath('/home/u/other/runs/2026-09-25T00-00-00-000Z', '/home/u/proj'), '2026-09-25T00-00-00-000Z', 'a run folder outside: its name');
});

// fromRun had the same leak as task: run.json saves it absolute, and an absolute --from-run went
// straight into report.json. Checked on a fresh run and on a resumed one (the resume reads
// run.json's absolute copy).
test('report schema: fromRun is written relative to where the run started, fresh and resumed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-report-fromrun-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 'smoke.md'), 'Plan a small offline tool that keeps a list of notes.');
  const env = { PATH: process.env.PATH };
  const node = (args, what) => {
    const r = spawnSync('node', [cli, ...args], { encoding: 'utf8', cwd: dir, env });
    assert.ok([0, 3, 22].includes(r.status), `${what}: exit ${r.status}\n${r.stdout}\n${r.stderr}`);   // 22: a finished run whose mock panel did not agree (0.8.3)
  };
  node(['--chain', 'mock', '--task', 'tasks/smoke.md', '--run-id', '2026-01-01T00-00-00-000Z'], 'base run');
  const base = join(dir, 'runs', '2026-01-01T00-00-00-000Z');
  node(['--chain', 'mock', '--task', 'tasks/smoke.md', '--run-id', '2026-01-02T00-00-00-000Z', '--from-run', base], 'fresh from-run');
  const fresh = JSON.parse(readFileSync(join(dir, 'runs', '2026-01-02T00-00-00-000Z', 'report.json'), 'utf8'));
  assert.equal(fresh.fromRun, 'runs/2026-01-01T00-00-00-000Z');
  assertValid(fresh, 'fresh from-run');

  node(['--chain', 'mock-external', '--task', 'tasks/smoke.md', '--run-id', '2026-01-03T00-00-00-000Z', '--from-run', 'runs/2026-01-01T00-00-00-000Z'], 'external from-run');
  const runDir = join(dir, 'runs', '2026-01-03T00-00-00-000Z');
  assert.equal(JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')).fromRun, base, 'run.json keeps it absolute, for resume');
  let sittings = 0;
  while (!existsSync(join(runDir, 'report.json'))) {
    assert.ok(++sittings <= 6, `never finished: ${readdirSync(runDir).join(', ')}`);
    for (const f of readdirSync(runDir).filter(n => /^NEEDS-.*\.md$/.test(n))) {
      const answer = join(runDir, f.slice('NEEDS-'.length));
      if (!existsSync(answer)) writeFileSync(answer, '# Plan\n\nOne JSON file of notes; add, list and delete from the command line.\n');
    }
    node(['--resume', join('runs', '2026-01-03T00-00-00-000Z')], 'resume');
  }
  const resumed = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
  assert.equal(resumed.fromRun, 'runs/2026-01-01T00-00-00-000Z');
  assert.ok(!JSON.stringify(resumed).includes(dir), 'no absolute path under the run\'s own directory anywhere in report.json');
  assertValid(resumed, 'resumed from-run');
});

// Verify pass 2026-09-28 F3: `debate.dropped[].reason` gained 'provider_error' in 0.7.9, and the
// enum did not - a real report from a proposer the provider keeps failing was rejected.
test('report schema: a run with a provider_error debate drop validates', async () => {
  const base = chain('mock-debate');
  const config = { ...base, seats: { ...base.seats, proposers: ['mock-proposer-error', 'mock-proposer-b'].map((model, i) => ({ provider: 'mock', model, lab: `mock-${'ab'[i]}` })) } };
  const result = await runChain({ request: 'Do the thing.', config, log: () => {} });
  assert.ok((result.debate?.dropped || []).some(d => d.reason === 'provider_error'), 'precondition: a provider_error drop');
  assertValid(reportJsonShape({ runId: 'x', chain: 'mock-debate', task: 't', result }), 'provider_error drop');
});

// 0.8.4 S3: layer_debates rows are a record. A real exchange run (one judge's reply cannot be read, one raiser's answer cannot be read) validates and carries `omitted` and `flags`; the schema is not vacuous for either field.
async function exchangeReport() {
  const seat = (model, lab, layer) => ({ provider: 'mock', model, lab, layer });
  const config = { name: 'schema-exchange', maxRounds: 1, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' },
      critics: [seat('mock-exch-support-garbled', 'e1', 1), seat('mock-exch-contest-keep-clean', 'e2', 1), seat('mock-exch-garbled-keep-clean', 'e3', 1), seat('mock-critic-x', 'e9', 2)] } };
  const result = await runChain({ config, request: 'A mock task.', log: () => {} });
  return JSON.parse(JSON.stringify(reportJsonShape({ runId: 'schema-exchange', chain: config.name, task: 'tasks/t.md', result, config })));
}
test('report schema: a layer_debates row that carries omitted posts and a flagged raiser reply validates', async () => {
  const report = await exchangeReport();
  const row = report.layer_debates[0].objections[0];
  // CHANGED ACCEPTED (0.8.4 N9, ruling 4). OLD: one omitted entry and one flag. NEW: one of each per round, two rounds (the second round always runs and meets the same unreadable replies). WHY: the loop is N9's.
  assert.deepEqual([row.omitted.map(o => o.why), row.flags.map(f => f.kind)], [['unreadable', 'unreadable'], ['raiser_reply_unparsed', 'raiser_reply_unparsed']]);
  assertValid(report, 'exchange');
  assert.equal(validate(report), true, JSON.stringify((validate.errors || []).slice(0, 3)));
});
test('report schema: an omitted entry whose why is outside the enum is rejected (known-bad input)', async () => {
  const report = await exchangeReport();
  report.layer_debates[0].objections[0].omitted[0].why = 'shrugged';
  assert.equal(validate(report), false);
});
test('report schema: a flag whose kind is outside the enum is rejected (known-bad input)', async () => {
  const report = await exchangeReport();
  report.layer_debates[0].objections[0].flags[0].kind = 'raiser_shrugged';
  assert.equal(validate(report), false);
});
test('report schema: an exchange outcome outside the five words is rejected (known-bad input; holds since the first S1 slice)', async () => {
  const report = await exchangeReport();
  report.layer_debates[0].objections[0].outcome = 'upheld';
  assert.equal(validate(report), false);
});

// 0.8.4 S3 (chunk C3): `not_run` (the exchange could not run: fewer than two heard judges) and `carried_from` (an objection carried into a later pass's exchange) are record fields too.
async function exchangeReportOf(critics, extra = {}) {
  const config = { name: 'schema-exchange-2', maxRounds: 3, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' },
      critics: critics.map(([model, lab, layer]) => ({ provider: 'mock', model, lab, layer })) }, ...extra };
  const result = await runChain({ config, request: 'A mock task.', log: () => {} });
  return JSON.parse(JSON.stringify(reportJsonShape({ runId: 'schema-exchange-2', chain: config.name, task: 'tasks/t.md', result, config })));
}
test('report schema: a layer_debates row of a pass whose exchange could not run (a layer of one seat) carries not_run and validates; a not_run outside its enum is rejected (known-bad input)', async () => {
  const report = await exchangeReportOf([['mock-exch-support-keep', 'e1', 1], ['mock-critic-x', 'e9', 2]]);
  const row = report.layer_debates[0];
  assert.deepEqual([row.not_run, row.objections.map(o => o.outcome)], ['fewer_than_two_heard', ['not_debated']]);
  assertValid(report, 'not_run');
  report.layer_debates[0].not_run = 'because';
  assert.equal(validate(report), false);
});
test('report schema: an objection carried into a later pass\'s exchange carries carried_from (an integer) and validates; a carried_from that is not an integer is rejected (known-bad input)', async () => {
  // CHANGED ACCEPTED (0.8.4 N9, ruling 4). OLD: `contest-amend` amended in round 1, the only round, so the objection was carried. NEW: the seven-round fixture (e1 amends in round 7, the last round that runs; the `alt` poster flips every round). WHY: an objection is not debated only at the stop.
  const report = await exchangeReportOf([['mock-exch-support-keepamend2-id-sch', 'e1', 1], ['mock-exch-altp-keep-id-sch-clean', 'e2', 1], ['mock-critic-x', 'e9', 2]]);
  const carried = report.layer_debates.flatMap(d => d.objections).find(o => o.carried_from);
  assert.equal(carried?.carried_from, 1);
  assertValid(report, 'carried_from');
  carried.carried_from = 'first';
  assert.equal(validate(report), false);
});

// 0.8.4 S2 (C&C's ruling on the schema): the objection id pattern widens to ^O-[0-9a-f]{8}(#r?[0-9]+)?$, so every old id stays valid (additive under schemaVersion 1).
async function reportWithOneObjection() {
  const report = await exchangeReportOf([['mock-exch-support-keep', 'e1', 1], ['mock-critic-x', 'e9', 2]], { maxRounds: 1 });
  assert.ok(report.lastCritique.failures.length > 0, 'the run ended with an objection');
  return report;
}
test('report schema: an objection id of the old shape (O- and eight hex digits) is still valid', async () => {
  const report = await reportWithOneObjection();
  assert.match(report.lastCritique.failures[0].id, /^O-[0-9a-f]{8}$/);
  assert.equal(validate(report), true, JSON.stringify((validate.errors || []).slice(0, 3)));
});
test('report schema: a suffixed id (#2, #r2) is valid on an objection, on its reopens link and on its see_also pointer', async () => {
  const report = await reportWithOneObjection();
  const f = report.lastCritique.failures[0];
  Object.assign(f, { id: `${f.id}#2`, same_key: true, reopens: `${f.id}#r2`, see_also: `${f.id}` });
  assert.equal(validate(report), true, JSON.stringify((validate.errors || []).slice(0, 3)));
  f.id = f.id.replace('#2', '#r12');
  assert.equal(validate(report), true, JSON.stringify((validate.errors || []).slice(0, 3)));
});
test('report schema: a malformed suffix is rejected (known-bad input): #, #x, #2x, #r, and a suffix on the wrong place', async () => {
  for (const bad of ['#', '#x', '#2x', '#r', '#2#3', ' #2']) {
    const report = await reportWithOneObjection();
    const f = report.lastCritique.failures[0];
    f.id = `${f.id}${bad}`;
    assert.equal(validate(report), false, `the schema accepted an id ending ${JSON.stringify(bad)}`);
  }
});

// 0.8.4 lane C, unit 1: the per-seat persona record (src/persona-record.js) validates, and the schema refuses a value it should. The row is stamped the way src/cli.js's onStage stamps it.
test('report schema: a run with a persona on a debating seat and on a judge validates; model_source, the set hash and the run-level fields are checked', async () => {
  const { personaStampFor } = await import('../src/persona-record.js').catch(() => ({}));
  const base = chain('mock-debate');
  const config = { ...base, seats: { ...base.seats, proposers: base.seats.proposers.map((p, i) => (i === 0 ? { ...p, role: { persona: 'noah' } } : p)), critics: base.seats.critics.map((c, i) => (i === 0 ? { ...c, persona: 'Moses' } : c)) }, seat_personas: { enabled: true, form: 'voice' } };
  const result = await runChain({ request: 'Do the thing.', config, log: () => {}, onStage: s => { if (personaStampFor) Object.assign(s, personaStampFor(s, config)); } });
  const report = JSON.parse(JSON.stringify(reportJsonShape({ runId: 'x', chain: 'mock-debate', task: 't', result, config })));
  assertValid(report, 'persona record');
  const named = report.stages.filter(s => s.persona);
  assert.ok(named.some(s => /^debate-/.test(s.label)) && named.some(s => /^panel-/.test(s.label)), 'precondition: a debating row and a judge row are named');
  assert.ok(['personas_source', 'personas_sha256', 'personas_used'].every(k => k in report));
  const withRow = patch => ({ ...report, stages: report.stages.map(s => (s === named[0] ? { ...s, ...patch } : s)) });
  assert.ok(!validate(withRow({ model_source: 'verified' })), 'model_source is one of provider / declared / undeclared');
  assert.ok(!validate(withRow({ persona_set_sha256: 'not-a-hash' })), 'persona_set_sha256 is a sha256 or null');
  assert.ok(!validate(withRow({ persona_name: 7 })), 'persona_name is text or null');
  assert.ok(!validate({ ...report, personas_source: 'guessed' }), 'personas_source is default / file / fallback / null');
  assert.ok(!validate({ ...report, personas_sha256: 'abc' }), 'personas_sha256 is a sha256 or null');
  assert.ok(validate({ ...report, personas_source: null, personas_sha256: null }), 'null on both when the rows name different sets');
  // an older stage row (no stamp at all) still validates: the fields are never required
  assert.ok(validate({ ...report, stages: report.stages.map(({ persona, persona_name, persona_set_sha256, model_source, ...rest }) => rest) }), 'an older report validates');
});

// 0.8.4 session switch (SSW-w7): roster_answers.panel_session_seats. The object is open (additionalProperties is not closed), so "a report with it validates" would pass on a schema that never heard of it; what pins the property is its own type and text, and a value that is not an integer being refused.
test('report schema: roster_answers.panel_session_seats is an integer with the SSW-w7 text, and a report carrying it validates while a non-integer is rejected (known-bad input); a roster_answers without it still validates', async () => {
  const prop = schema.properties.roster_answers.properties.panel_session_seats;
  assert.ok(prop, 'the property is in the published schema');
  assert.equal(prop.type, 'integer');
  assert.equal(prop.description, 'Present only when a stage of the review panel was answered through a session seat: how many stages that was. Nothing checks that those stages were answered by separate sessions.');
  assert.equal((schema.properties.roster_answers.required ?? []).includes('panel_session_seats'), false, 'never required: an older report has none');
  const config = chain('mock-debate');
  const result = await runChain({ request: 'Do the thing.', config, log: () => {} });
  const base = JSON.parse(JSON.stringify(reportJsonShape({ runId: 'x', chain: 'mock-debate', task: 't', result, config })));
  const withRoster = extra => ({ ...base, roster_answers: { design_companies: 1, recorded_companies: 1, unverified_seats: 0, seats: [], note: 'As declared by the client and the session; never verified.', ...extra } });
  assertValid(withRoster({ panel_session_seats: 2 }), 'roster_answers with panel_session_seats');
  assertValid(withRoster({}), 'roster_answers without it');
  assert.equal(validate(withRoster({ panel_session_seats: 'two' })), false, 'a string is not a count');
  assert.equal(validate(withRoster({ panel_session_seats: 1.5 })), false, 'nor is a fraction');
});
