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
  'mock-patch', 'mock-patch-fallback', 'mock-proposals', 'mock-questions', 'mock-relay', 'mock-security-review'];

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
    assert.deepEqual(report.producer, { name: pkg.name, version: pkg.version });
    assert.ok(Date.parse(report.started_at) <= Date.parse(report.finished_at), `${name}: started_at <= finished_at`);
    // Brief 03 fix 2: signoff[].lab next to the deprecated, misnamed signoff[].provider.
    for (const e of report.signoff || []) {
      assert.equal(typeof e.lab, 'string', `${name}: signoff[].lab`);
      assert.equal(e.provider, e.lab, `${name}: provider keeps holding the lab until a v2`);
    }
    assertValid(report, name);
  });
}

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
    assert.ok([0, 3].includes(r.status), `resume exit ${r.status}\n${r.stdout}\n${r.stderr}`);
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
});
