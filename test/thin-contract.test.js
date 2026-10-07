// 0.8.2 item 6a (owner 6 Oct 2026: thin contract YES): report.json `thin_contract` and `council contract check <run>`. $0, offline. The CLI tests run the mock chain ONCE and copy the run folder
// for each tamper case (a spawn per case would weigh on the machine for nothing).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, cpSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { buildThinContract, canonicalJson, groundTruthSha256, recordHash, sha256Of } from '../src/thin-contract.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync(join(root, 'schemas/report-v1.json'), 'utf8')));
const h = c => c.repeat(64);

// ---- the record: defined once, recomputable by anyone ------------------------------------------------------------------------------------------------------------------------

test('canonicalJson: keys sorted at every depth, no whitespace, arrays keep their order, undefined reads as null', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [3, 1], c: null } }), '{"a":{"c":null,"d":[3,1]},"b":1}');
  // Review of 6a-6c (6 Oct 2026): this used to pin `{ a: undefined }` -> '{"a":null}', which made a tool result with an undefined field hash differently before and after report.json's JSON.stringify (a false DRIFT
  // on an untouched run). It now matches JSON.stringify: an undefined-valued key is absent, an undefined array element is null.
  assert.equal(canonicalJson({ a: undefined, b: 1 }), '{"b":1}');
  assert.equal(canonicalJson([undefined, 1]), '[null,1]');
});

test('a ground-truth entry hashes the same before and after a JSON round trip (undefined fields: check_versions returns version: undefined for a package.json with no version)', () => {
  const e = [{ tool: 'check_versions', args: {}, result: { ok: true, name: 'ws', version: undefined, exitCode: undefined } }];
  assert.equal(groundTruthSha256(e), groundTruthSha256(JSON.parse(JSON.stringify(e))));
});

test('golden, non-ASCII: strings are JSON-escaped as JSON.stringify does (not \\u-escaped), keys sort by UTF-16 code unit; equals python json.dumps(ensure_ascii=False, sort_keys) over BMP text', () => {
  const gt = [{ tool: 'read_file', args: { path: 'doc/Ünï.md' }, result: { ok: true, text: 'Größe – 日本語 "quote"\n' } }];
  assert.equal(groundTruthSha256(gt), 'e847077e1b36b8c79a6df2fdfe02ce8fdf421e3ac981ac24167066c2a87b88af');
});

test('golden: the record and the ground-truth hash equal values computed independently (python, same rule: sorted keys, no whitespace, utf8) so a reader can recompute them from the docs', () => {
  const gt = [{ tool: 'check_versions', args: {}, result: { ok: true, stdout: 'x' }, result_ref: 'check_versions:0' }];
  assert.equal(groundTruthSha256(gt), 'aa1af4281f0bcee38fa45f12a2d1912d3b3b8f1a1ff47cae498b286b4907ef9f', 'result_ref is not part of what the seats were shown');
  const full = buildThinContract({ taskSha256: h('a'), criteriaSha256: h('b'), checksSha256: h('c'), contextSha256: h('d'), groundTruth: gt, signedTextSha256: h('e') });
  assert.equal(full.sha256, '092148e70d215edc58d4adb68aa9b4a65be0d1d8af04f93ede7fcf53bd9a3155');
  const bare = buildThinContract({ taskSha256: h('a'), criteriaSha256: h('b'), signedTextSha256: h('e') });
  assert.equal(bare.sha256, '76b3551bb3147b4a71366a0e41e1dfe6ca3379df3e1c3c19642c8647245d1a9d', 'unknown components are the literal null, not absent keys');
  assert.deepEqual(bare.evidence, { context_sha256: null, ground_truth_sha256: null });
});

test('changing any one field changes the record hash; recordHash ignores only the record\'s own sha256; a malformed hash makes no record at all', () => {
  const base = { taskSha256: h('a'), criteriaSha256: h('b'), checksSha256: h('c'), contextSha256: h('d'), groundTruth: [{ tool: 't', args: {}, result: 1 }], signedTextSha256: h('e') };
  const r = buildThinContract(base);
  for (const [k, v] of [['taskSha256', h('0')], ['criteriaSha256', h('0')], ['checksSha256', h('0')], ['contextSha256', h('0')], ['signedTextSha256', h('0')], ['groundTruth', [{ tool: 't', args: {}, result: 2 }]]]) {
    assert.notEqual(buildThinContract({ ...base, [k]: v }).sha256, r.sha256, `${k} is inside the hash`);
  }
  assert.equal(recordHash(r), r.sha256);
  assert.notEqual(recordHash({ ...r, signed_text_sha256: h('0') }), r.sha256);
  assert.equal(buildThinContract({ ...base, taskSha256: 'abc123def456' }), null, 'a 12-character fingerprint is refused: every field is full width');
  assert.equal(buildThinContract({ ...base, signedTextSha256: undefined }), null);
  assert.equal(sha256Of('x').length, 64);
});

// ---- the run: report.json carries it, and `council contract check` reads it back ---------------------------------------------------------------------------------------------

let shared;
function runOnce() {
  if (shared) return shared;
  const dir = mkdtempSync(join(tmpdir(), 'thc-thin-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n');
  const cfg = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  writeFileSync(join(dir, 'chains', 'tc.json'), JSON.stringify({ ...cfg, name: 'tc' }));
  const r = spawnSync(process.execPath, [join(root, 'src/cli.js'), '--chain', 'tc', '--task', 'tasks/t.md'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 120_000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  shared = { dir, run: join('runs', readdirSync(join(dir, 'runs'))[0]) };
  return shared;
}
const check = (dir, run, extra = []) => spawnSync(process.execPath, [join(root, 'src/cli.js'), 'contract', 'check', run, ...extra], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 });
import { renameSync, mkdirSync as mkdirp } from 'node:fs';
/** moves files out of a copied run folder into a sibling holding folder (nothing is deleted) */
function rmFiles(w, names) {
  const hold = join(w.dir, 'hold'); mkdirp(hold, { recursive: true });
  for (const n of names) renameSync(w.file(n), join(hold, `${Math.random().toString(36).slice(2, 6)}-${n}`));
}
/** a copy of the run folder to tamper with (the original stays as the control) */
function copyRun() {
  const { dir, run } = runOnce();
  const name = `runs/copy-${Math.random().toString(36).slice(2, 8)}`;
  cpSync(join(dir, run), join(dir, name), { recursive: true });
  return { dir, run: name, file: f => join(dir, name, f), read: f => readFileSync(join(dir, name, f), 'utf8'), report: () => JSON.parse(readFileSync(join(dir, name, 'report.json'), 'utf8')) };
}

test('a finished run carries thin_contract, valid against the schema, and it repeats the hashes report.json already holds (item 4\'s signed_text hash is read, not redefined)', () => {
  const { dir, run } = runOnce();
  const report = JSON.parse(readFileSync(join(dir, run, 'report.json'), 'utf8'));
  const t = report.thin_contract;
  assert.ok(t, 'report.json has thin_contract');
  assert.equal(t.schema, 'thin-contract/1');
  assert.equal(t.task_sha256, report.task_sha256);
  assert.equal(t.criteria_sha256, report.criteria_sha256);
  assert.equal(t.checks_sha256, report.checks_sha256 ?? null);
  assert.equal(t.signed_text_sha256, report.signed_text.sha256);
  assert.equal(t.evidence.context_sha256, null, 'no --context in this run');
  assert.equal(t.sha256, recordHash(t));
  assert.equal(validate(report), true, JSON.stringify(validate.errors));
});

test('council contract check: an untouched run is sealed, exit 0, and says what it checked and what it could not', () => {
  const { dir, run } = runOnce();
  const r = check(dir, run);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /sealed/);
  assert.match(r.stdout, /ok: record/);
  assert.match(r.stdout, /ok: delivered text/);
  assert.match(r.stdout, /^ok: task: /m);
});

test('each tamper is found by its own check: deliverable.md, HANDOFF.md, the criteria in report.json, a field of the record, the task file', () => {
  const cases = [
    ['deliverable.md', w => writeFileSync(w.file('deliverable.md'), `${w.read('deliverable.md')}\nA later edit.\n`), /DRIFT: delivered text/],
    ['HANDOFF.md', w => writeFileSync(w.file('HANDOFF.md'), `${w.read('HANDOFF.md')}\nA later edit.\n`), /DRIFT: HANDOFF\.md/],
    ['criteria', w => { const r = w.report(); r.criteria = [...r.criteria, 'A criterion nobody graded.']; writeFileSync(w.file('report.json'), JSON.stringify(r)); }, /DRIFT: criteria/],
    ['record field', w => { const r = w.report(); r.thin_contract.task_sha256 = '0'.repeat(64); writeFileSync(w.file('report.json'), JSON.stringify(r)); }, /DRIFT: record/],
    ['signed text', w => { const r = w.report(); r.signed_text.sha256 = '0'.repeat(64); writeFileSync(w.file('report.json'), JSON.stringify(r)); }, /DRIFT: signed text/],
  ];
  for (const [name, tamper, expected] of cases) {
    const w = copyRun(); tamper(w);
    const r = check(w.dir, w.run);
    assert.equal(r.status, 1, `${name}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout + r.stderr, expected, name);
  }
  const { dir, run } = runOnce();
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan something else entirely.\n');
  try {
    const r = check(dir, run);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /DRIFT: task/);
  } finally { writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n'); }
});

test('what cannot be checked is said, never counted as a pass: a task file that is gone; a run with no thin_contract exits 2; a run folder that is not one exits 2', () => {
  const w = copyRun();
  const { dir } = runOnce();
  const run = JSON.parse(w.read('run.json')); run.task = join(dir, 'tasks', 'gone.md'); writeFileSync(w.file('run.json'), JSON.stringify(run));
  const r = check(dir, w.run);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /cannot check: task/);
  assert.doesNotMatch(r.stdout, /^ok: task: /m, 'the task itself is not counted as checked (only its fingerprint in report.json is)');
  const old = copyRun(); const rep = old.report(); delete rep.thin_contract; writeFileSync(old.file('report.json'), JSON.stringify(rep));
  const r2 = check(old.dir, old.run);
  assert.equal(r2.status, 2, r2.stdout + r2.stderr);
  assert.match(r2.stderr, /no thin_contract/);
  const r3 = check(dir, 'runs/does-not-exist');
  assert.equal(r3.status, 2, r3.stdout + r3.stderr);
});

test('an advice result and a result with nothing signed get no thin_contract; the same result without advise does', async () => {
  const { reportJsonShape } = await import('../src/report-shape.js');
  const base = { criteria: ['The plan names its assumptions.'], signedText: { sha256: h('e') }, stages: [], totals: { usd: 0 }, signoff: [], proposals: [], dropouts: [], passed: true };
  const shape = result => reportJsonShape({ runId: 'r', chain: 'c', task: 't.md', taskText: 'a task', result, config: { name: 'c' } });
  assert.ok(shape(base).thin_contract, 'control: a sealed-able result gets the record');
  assert.equal(shape({ ...base, advise: { status: 'answered', opinions: [], dissent: [] } }).thin_contract, undefined, 'an advice run has no sign-off to seal');
  assert.equal(shape({ ...base, signedText: undefined }).thin_contract, undefined, 'no signed text, no record');
  assert.equal(shape({ ...base, criteria: [] }).thin_contract, undefined, 'no criteria, no record');
});

// ---- review fixes (6 Oct 2026) -------------------------------------------------------------------------------------------------------------------------------------------

test('a tamper with how a criterion is checked is found: checks are recomputed from criteria_kinds, not only compared between two stored copies', () => {
  const w = copyRun(); const r = w.report();
  r.criteria_kinds = [{ kind: 'checkable', check: 'EVIL check', on: 'build' }, ...(r.criteria_kinds || []).slice(1)];
  writeFileSync(w.file('report.json'), JSON.stringify(r));
  const out = check(w.dir, w.run);
  assert.equal(out.status, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /DRIFT: checks/);
});

test('exit 2 is reachable: with only report.json readable (task, deliverable, HANDOFF.md gone) nothing outside it was checked, so it is not a pass', () => {
  const w = copyRun();
  const run = JSON.parse(w.read('run.json')); run.task = join(w.dir, 'tasks', 'gone.md'); writeFileSync(w.file('run.json'), JSON.stringify(run));
  for (const f of ['deliverable.md', 'HANDOFF.md']) writeFileSync(w.file(f), '');   // emptied below by moving: see the next line
  rmFiles(w, ['deliverable.md', 'HANDOFF.md']);
  const out = check(w.dir, w.run);
  assert.equal(out.status, 2, out.stdout + out.stderr);
  assert.match(out.stdout, /nothing outside report\.json could be checked/);
});

test('a harness note above the body is said, not silently skipped; the HANDOFF copy names the run as well as the record', () => {
  const { dir, run } = runOnce();
  const rep = JSON.parse(readFileSync(join(dir, run, 'report.json'), 'utf8'));
  writeFileSync(join(dir, 'copy-other-run.md'), readFileSync(join(dir, run, 'HANDOFF.md'), 'utf8').replace(/, run [^.\s]+\./, ', run some-other-run.'));
  const out = check(dir, run, ['--handoff', 'copy-other-run.md']);
  assert.equal(out.status, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /DRIFT: HANDOFF copy: .*another run/);
  assert.ok(rep.thin_contract);
});
