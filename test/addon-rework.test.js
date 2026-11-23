// test/addon-rework.test.js
//
// 0.8.1 M1: the research patches (27, 26, 25, 31, 29 and the retention wording fix) applied onto
// 0.8.0, and the silent breaks that merge left (S1-S5, found by the 2026-10-01 review of the patch
// series). S1 lives in test/mcp-tool-latency.test.js; the rest are here. Offline, mock chains, $0.
// 0.8.4 (the add-on removal, wave 2): the advice add-on is removed. The tests that drove its code (the wall-clock stop of an advice run, the dry run and the CLI run of an advise chain,
// the salt, the masking, the secret-shape refusal of a brief, the "leaning" wording of the answer and of the deliverable) are removed with it; the tests of code that stays are kept or repointed
// to a planning chain (S4, S5, N1-N4), and N5 (verdict_stats and metrics skip an old advice report) now reads the golden report fixture instead of a run that no longer can be made.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import { dryRunReport } from '../src/dry-run.js';
import { verdictStats } from '../src/verdict-stats.js';
import { metricsReport } from '../src/metrics.js';
import { readChainFile } from './helpers/chain-file.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const chain = name => readChainFile(root, name);
const workspace = () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-addon-rework-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), '# Advice\n\nShould the note list keep ticked items or remove them?\n');
  return dir;
};
const run = (dir, args, extra = {}) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir, ...extra }, timeout: 60_000 });
const readJson = p => JSON.parse(readFileSync(p, 'utf8'));
const onlyRun = dir => join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
const schema = JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
const validateReport = ajv.compile(schema);

// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD: a resume clears a leftover STOPPED-user.json (the marker a stopped advice call wrote) along with STOPPED-budget.json. NEW: it clears STOPPED-budget.json (and .md) of the earlier sitting; no STOPPED-user.json is made. WHY: the cause `user` left STOP_CAUSES with the add-on (only an advice call wrote STOPPED-user.json, and an old advice folder is never resumed), so clearStopRecords no longer lists it: see OPEN in the wave-2 result table.
test('S4: a resume clears the spending-stop markers of the earlier sitting', () => {
  const dir = workspace();
  const id = '2026-10-02T20-00-00-000Z';
  const first = run(dir, ['--chain', 'mock-budget', '--task', 'tasks/t.md', '--max-usd', '1', '--run-id', id]);
  assert.equal(first.status, 4, first.stdout + first.stderr);
  const runDir = join(dir, 'runs', id);
  assert.equal(existsSync(join(runDir, 'STOPPED-budget.json')), true, 'fixture: the first sitting stopped at its cap');
  const again = run(dir, ['--resume', `runs/${id}`, '--max-usd', '100']);
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.equal(existsSync(join(runDir, 'STOPPED-budget.json')), false, 'a stale stop marker outlived the resume');
});

// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD: "the dry-run JSON prices an advice chain from its own rounds, carries its ceiling, and reads the task as the brief" (advise-standard and mock-advise-standard: the `advise` object of the dry run, the floor, the task replacing the assumed prompt). NEW: the planning-chain half only, and the dry-run JSON carries no `advise` object even for a chain written for the removed add-on's neighbours. WHY: dryRunReport no longer prices an advise flow; the planning rules (floor = one review round; the task is added to the assumption) are unchanged.
test('S5: the dry-run JSON of a planning chain: floor = one review round, the task added to the assumed prompt, and no `advise` object', () => {
  // 0.8.2 (owner, 6 Oct 2026, archive the unused chains): plan-fast moved to archive/chains/; cheap-7-v2 stands in as the planning chain.
  const p = chain('cheap-7-v2');
  const pr = dryRunReport(p, { taskChars: 80_000 });
  assert.equal(pr.advise, undefined);
  assert.equal(pr.estimate.floorUsd, dryRunReport({ ...p, maxRounds: 1 }, {}).estimate.worstCaseUsd);
  const assumedP = p.estimate?.promptTokens ?? 4000;
  assert.equal(pr.estimate.worstCaseWithTaskUsd, dryRunReport({ ...p, estimate: { ...(p.estimate || {}), promptTokens: assumedP + 20_000 } }, {}).estimate.worstCaseUsd);
});

// One finished mock planning run from the CLI, the way a person at the terminal starts one.
// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD: answeredAdviceRun() ran the fixture chain mock-advise-standard (copied into the work folder's chains/). NEW: the planning chain `mock` from the package. WHY: the CLI refuses a chain with an `advise` block now, so no advice run can be made; the checks below are about report.json and the stage rows, which a planning run has too.
function answeredPlanRun() {
  const dir = workspace();
  const r = run(dir, ['--task', 'tasks/t.md', '--chain', 'mock']);
  return { dir, r, runDir: onlyRun(dir) };
}

// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD: the naming pass of an advice run (report.advise.sent_to and .dispositions nested under advise; audit.jsonl carries the full prompt hash). NEW: the same naming rules on a planning run: report.json validates, none of the patch's root copies, the brief (task) hash is task_sha256, stages[] carries no full prompt hash, size, endpoint or scan. The audit.jsonl half is dropped (the audit line's new fields are pinned in test/advice-units.test.js). WHY: nothing in THC writes an `advise` object any more.
test('N1-N4: the naming pass: no root copies of the patch fields, one hash per concept, no full prompt hash in stages[]', () => {
  const { dir, r, runDir } = answeredPlanRun();
  assert.ok(r.status === 0 || r.status === 22, r.stdout + r.stderr);
  const report = readJson(join(runDir, 'report.json'));
  assert.equal(validateReport(report), true, JSON.stringify(validateReport.errors));
  // N1, N2, N3: none of the patch's root copies; and no `advise` object.
  for (const k of ['stopped_by', 'brief_sha256', 'sent_to', 'dispositions', 'advise']) assert.equal(k in report, false, `root ${k}`);
  // N2: the brief is the task file, so its hash is task_sha256.
  const task = readFileSync(join(dir, 'tasks', 't.md'), 'utf8');
  assert.equal(report.task_sha256, createHash('sha256').update(task).digest('hex'));
  // N4: stages[] keeps the 16-hex promptHash; the full hash, size, endpoint and scan are in audit.jsonl only.
  for (const s of report.stages) for (const k of ['promptSha256', 'promptBytes', 'endpoint', 'scan']) assert.equal(k in s, false, `${s.label}.${k}`);
});

// Q3 row (stats): an old advice call's report.json is never counted as a passed plan.
// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD: a real mock advice run made through the CLI was skipped by verdict_stats and metrics. NEW: the golden advice report fixture (test/fixtures/report-advice-single.json) is put into a run folder by hand. WHY: no advice run can be made any more, and the skip (adviceRunsSkipped) stays for the old folders.
test('N5: verdict_stats and metrics skip a report that carries advise, and say how many they skipped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-addon-skip-'));
  const runDir = join(dir, 'runs', '2026-10-02T18-17-13-595Z');
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'report.json'), readFileSync(join(root, 'test', 'fixtures', 'report-advice-single.json'), 'utf8'));
  const v = verdictStats(join(dir, 'runs'), { days: 3650 });
  assert.equal(v.adviceRunsSkipped, 1);
  assert.equal(v.runsSeen, 0);
  assert.deepEqual(v.chains, []);
  const m = metricsReport(join(dir, 'runs'), { days: 3650 });
  assert.equal(m.adviceRunsSkipped, 1);
  assert.equal(m.runsSeen, 0);
});

// CHANGED ACCEPTED TEST (0.8.4 add-on removal): OLD the schema AND docs/report-format.md say passed and outcome are not a sign-off on an advice call. NEW the schema half only. WHY REM-w16 replaced the advice section of docs/report-format.md with one sentence (the package starts no advice call any more), so the doc no longer carries the old sentence; the schema still describes the `advise` property the kept adopt path writes.
test('N6: the schema says passed and outcome are not a sign-off on an advice call', () => {
  for (const k of ['passed', 'outcome']) assert.match(schema.properties[k].description, /carries `advise`[^.]*not a sign-off/, k);
});

// CHANGED ACCEPTED TEST (0.8.4 add-on removal): OLD 'Work 6: the shipped roster' (advise-standard is Sol, GLM-5.3 and Gemini 3.8 Flash, a chains/ listing of advise-* files that must be ['advise-standard']) NEW the package ships no chain that starts an advice call, and every advice chain left as a fixture says resumeAfterStop: false. WHY the four advice chains left chains/ for test/fixtures/advice-chains/ and the eight in chains/outdated/ were deleted with the add-on, so the roster of a removed shipped chain is no longer a claim of the package; the property that an advice call is never resumed still binds every advice chain.
test('Work 6: the package ships no chain that starts an advice call; every advice chain kept as a fixture says resumeAfterStop: false', () => {
  for (const dir of [join(root, 'chains'), join(root, 'chains', 'outdated')]) {
    const advice = readdirSync(dir).filter(f => f.endsWith('.json')).filter(f => JSON.parse(readFileSync(join(dir, f), 'utf8')).advise?.enabled === true);
    assert.deepEqual(advice, [], `${dir}: no shipped or outdated chain starts an advice call (0.8.4)`);
    assert.deepEqual(readdirSync(dir).filter(f => /^(mock-)?advise-/.test(f)), [], `${dir}: no advise-* file`);
  }
  const fixtures = join(root, 'test', 'fixtures', 'advice-chains');
  const names = readdirSync(fixtures).filter(f => f.endsWith('.json'));
  assert.ok(names.length >= 1);
  for (const f of names) {
    const c = JSON.parse(readFileSync(join(fixtures, f), 'utf8'));
    assert.equal(c.advise?.enabled, true, f);
    assert.equal(c.resumeAfterStop, false, f);
  }
});

// CHANGED ACCEPTED TEST (0.8.4 add-on removal): OLD two halves: no file names the operator allowance, and a council_quote + council_advise through a real MCP session with no way to ask a person starts nothing. NEW the first half only. WHY the two tools are removed, so the second half has no subject; the scan stays because a setting that was ruled out in 0.8.1 must not come back.
test('Work 9 (DR-3): the operator allowance is gone: no file names it', () => {
  const name = 'COUNCIL_ADVISE_' + 'AUTO_USD'; // built, so this file does not match its own check
  const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  const files = [...walk(join(root, 'src')), ...walk(join(root, 'docs')), ...walk(join(root, 'test')), join(root, 'README.md'), join(root, 'KNOWN-LIMITS.md'), join(root, 'AI-README.md')]
    .filter(f => /\.(js|mjs|json|md|html)$/.test(f));
  const hits = files.filter(f => readFileSync(f, 'utf8').includes(name));
  assert.deepEqual(hits, []);
});

// ---- the public contract after the patches -------------------------------------------------------------------------------
// The same walk that recorded test/fixtures/report-v1-080-keys.json from the 0.8.0 schema: every property path and its type.
function schemaKeys(s) {
  const out = {};
  const typeOf = n => (n.type !== undefined ? n.type : n.$ref ? { $ref: n.$ref } : ['anyOf', 'oneOf', 'allOf'].find(k => n[k]) ? { [['anyOf', 'oneOf', 'allOf'].find(k => n[k])]: n[['anyOf', 'oneOf', 'allOf'].find(k => n[k])].map(typeOf) } : n.const !== undefined || n.enum ? 'enum' : 'any');
  const walk = (n, p) => {
    if (!n || typeof n !== 'object') return;
    if (n.properties) for (const [k, v] of Object.entries(n.properties)) { out[`${p}/properties/${k}`] = typeOf(v); walk(v, `${p}/properties/${k}`); }
    if (n.items && typeof n.items === 'object') walk(n.items, `${p}/items`);
    for (const k of ['anyOf', 'oneOf', 'allOf']) if (n[k]) n[k].forEach((x, i) => walk(x, `${p}/${k}/${i}`));
    if (n.additionalProperties && typeof n.additionalProperties === 'object') walk(n.additionalProperties, `${p}/additionalProperties`);
  };
  walk(s, '');
  for (const [d, v] of Object.entries(s.$defs || {})) walk(v, `/$defs/${d}`);
  return out;
}

test('report.json stays additive (decided rule 11): every 0.8.0 property is still there with the same type', () => {
  const was = JSON.parse(readFileSync(join(root, 'test', 'fixtures', 'report-v1-080-keys.json'), 'utf8'));
  const now = schemaKeys(schema);
  assert.equal(Object.keys(was.keys).length, was.count);
  const lost = Object.keys(was.keys).filter(k => !(k in now));
  assert.deepEqual(lost, [], 'a 0.8.0 property disappeared');
  const retyped = Object.keys(was.keys).filter(k => JSON.stringify(now[k]) !== JSON.stringify(was.keys[k]));
  assert.deepEqual(retyped, [], 'a 0.8.0 property changed type');
});

test('the two advice golden reports (mock single, mock council) validate against the schema', () => {
  for (const f of ['report-advice-single.json', 'report-advice-council.json']) {
    const r = readJson(join(root, 'test', 'fixtures', f));
    assert.equal(validateReport(r), true, `${f}: ${JSON.stringify(validateReport.errors)}`);
    assert.ok(r.advise && Array.isArray(r.advise.sent_to) && Array.isArray(r.advise.dispositions), f);
    assert.match(r.task_sha256, /^[0-9a-f]{64}$/, f);
  }
});

test('stage labels are the 0.8.0 set for every mock planning chain (renaming one orphans paused runs)', () => {
  const was = JSON.parse(readFileSync(join(root, 'test', 'fixtures', 'stage-labels-080.json'), 'utf8')).chains;
  for (const [name, w] of Object.entries(was)) {
    const dir = workspace();
    writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small command-line tool that renames photos by the date they were taken.\n');
    const r = run(dir, ['--task', 'tasks/t.md', '--chain', name, '--max-usd', '100']);
    // 0.8.3 exit 22: the fixture records the 0.8.0 exit; a chain that exited 0 then exits 22 now when its mock panel does not agree (exit-not-agreed.test.js pins the rule). The labels below are this test's subject.
    assert.ok(r.status === w.exit || (w.exit === 0 && r.status === 22), `${name}: exit ${r.status}, 0.8.0 recorded ${w.exit}: ${r.stderr.slice(-400)}`);
    const rd = onlyRun(dir);
    const rep = existsSync(join(rd, 'report.json')) ? 'report.json' : existsSync(join(rd, 'report-partial.json')) ? 'report-partial.json' : null;
    const labels = rep ? readJson(join(rd, rep)).stages.map(s => s.label) : readdirSync(rd).filter(x => x.endsWith('.usage.json')).map(x => x.slice(0, -11));
    assert.deepEqual([...new Set(labels)].sort(), w.labels, name);
  }
});
