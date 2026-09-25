// Criterion kinds (src/criteria-kinds.js): every criterion is checkable (with the command or
// measurement that settles it) or judgement, the board counts them, and a critic that calls a
// checkable criterion MET with no evidence is recorded. Opt-in per chain via
// `criteria_kinds: { enabled: true }`; absent, prompts and report.json must not change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normaliseCriteria, criteriaSummary, kindsRecord, checksSection, unevidencedCheckableMets,
  isVague, parseCriteriaFile, summaryLine,
} from '../src/criteria-kinds.js';
import * as R from '../src/roles.js';
import { runChain } from '../src/chain.js';
import { reportJsonShape, renderBoardMd } from '../src/report-shape.js';
import { lintChain } from '../src/chain-lint.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = resolve(root, 'src/cli.js');
const load = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));

test('normaliseCriteria: plain strings pass through with no kinds recorded', () => {
  const n = normaliseCriteria(['a', 'b']);
  assert.deepEqual(n.texts, ['a', 'b']);
  assert.equal(n.kinds, null);
});

test('normaliseCriteria: objects carry kind, check and target; a checkable with no check is downgraded', () => {
  const n = normaliseCriteria([
    { criterion: 'x', kind: 'checkable', check: 'npm audit --audit-level=high exits 0' },
    { criterion: 'y', kind: 'checkable', check: 'under 1500 words', on: 'plan' },
    { text: 'z', kind: 'judgment' },
    { criterion: 'w', kind: 'checkable' },
    'plain',
    { kind: 'judgement' },
    null,
  ]);
  assert.deepEqual(n.texts, ['x', 'y', 'z', 'w', 'plain']);
  assert.deepEqual(n.kinds[0], { kind: 'checkable', check: 'npm audit --audit-level=high exits 0', on: 'build' });
  assert.equal(n.kinds[1].on, 'plan');
  assert.equal(n.kinds[2].kind, 'judgement');
  assert.equal(n.kinds[3].kind, 'judgement');
  assert.match(n.kinds[3].downgraded, /no check/);
  assert.equal(n.kinds[4].kind, null);
});

test('isVague: a property with no threshold is vague; the same word with a number is not', () => {
  assert.equal(isVague('The design is scalable.'), true);
  assert.equal(isVague('It is user-friendly.'), true);
  assert.equal(isVague('Search stays fast: p95 under 200 ms at 100 concurrent requests.'), false);
  assert.equal(isVague('Names the patch version it was written against.'), false);
});

test('criteriaSummary and kindsRecord count kinds, targets, vague and unevidenced MET rows', () => {
  const { texts, kinds } = normaliseCriteria([
    { criterion: 'Commits to p95 under 200 ms at 100 concurrent requests.', kind: 'checkable', check: 'k6 run load.js reports p95 < 200 ms', on: 'build' },
    { criterion: 'It is scalable.', kind: 'judgement' },
    'Has a Decisions section.',
  ]);
  const s = criteriaSummary(texts, kinds, { metWithoutEvidence: [{ round: 1, lab: 'x', criterion: texts[0] }] });
  assert.deepEqual(s, { total: 3, checkable: 1, checkable_on_plan: 0, checkable_on_build: 1, judgement: 1, unclassified: 1, downgraded: 0, vague: 1, met_without_evidence: 1 });
  const rec = kindsRecord(texts, kinds);
  assert.equal(rec[0].check, 'k6 run load.js reports p95 < 200 ms');
  assert.equal(rec[1].vague, true);
  assert.equal(rec[2].kind, null);
  assert.match(summaryLine(s), /^Acceptance criteria: 3 - 1 checkable \(0 on the plan, 1 at build\), 1 judgement, 1 unclassified, 1 vague, 1 checkable MET with no evidence\.$/);
});

test('checksSection numbers match the criteria list and it is empty when nothing is checkable', () => {
  const { texts, kinds } = normaliseCriteria([
    { criterion: 'a', kind: 'judgement' },
    { criterion: 'b', kind: 'checkable', check: 'npm test exits 0' },
  ]);
  assert.match(checksSection(texts, kinds), /\n2\. Check: npm test exits 0 \(runs on the build\)/);
  assert.doesNotMatch(checksSection(texts, kinds), /\n1\. /);
  assert.equal(checksSection(['a'], [{ kind: 'judgement' }]), '');
  assert.equal(checksSection(['a'], null), '');
});

test('unevidencedCheckableMets: only MET rows on checkable criteria with no evidence', () => {
  const { texts, kinds } = normaliseCriteria([
    { criterion: 'c1', kind: 'checkable', check: 'npm test exits 0' },
    { criterion: 'c2', kind: 'judgement' },
    { criterion: 'c3', kind: 'checkable', check: 'wc -w under 1500' },
  ]);
  const critique = { criteria: [
    { criterion: 'c1', verdict: 'MET', evidence: '' },
    { criterion: 'c2', verdict: 'MET', evidence: '' },
    { criterion: 'c3', verdict: 'MET', evidence: 'Section 7: "npm test must exit 0 before merge".' },
    { criterion: 'c1', verdict: 'FAILED', evidence: '' },
  ] };
  assert.deepEqual(unevidencedCheckableMets(critique, texts, kinds), ['c1']);
  assert.deepEqual(unevidencedCheckableMets(critique, texts, null), []);
});

test('prompts are byte-identical with kinds off', () => {
  assert.equal(R.criteriaSystem(false, false, {}), R.CRITERIA_SYSTEM);
  assert.equal(R.criteriaSystem(false, false, { decisions: false, kinds: false }), R.CRITERIA_SYSTEM);
  assert.equal(R.criticSystem(false, { fencedSource: false }), R.criticSystem(false));
  const args = { request: 'r', criteria: ['a'], draft: 'd' };
  assert.equal(R.criticUser({ ...args, checks: '' }), R.criticUser(args));
  assert.equal(R.handoffUser({ request: 'r', draft: 'd', checks: '' }), R.handoffUser({ request: 'r', draft: 'd' }));
});

test('prompts with kinds on: criteria reply shape is swapped, critic and handoff carry the checks', () => {
  const sys = R.criteriaSystem(false, false, { kinds: true });
  assert.match(sys, /Give every criterion a kind\./);
  assert.match(sys, /"kind": "checkable", "check": "\.\.\.", "on": "plan" \| "build"/);
  assert.doesNotMatch(sys, /\{ "criteria": \["\.\.\.", "\.\.\."\] \}/, 'the old string-only reply shape must be gone');
  assert.ok(sys.startsWith(R.CRITERIA_SYSTEM.slice(0, R.CRITERIA_SYSTEM.indexOf('Reply with'))), 'everything before the reply shape is unchanged');
  assert.match(R.criticSystem(false, { criteriaKinds: true }), /MET needs evidence of the check, never trust/);
  const checks = checksSection(['a', 'b'], [{ kind: 'judgement' }, { kind: 'checkable', check: 'npm test exits 0', on: 'build' }]);
  const user = R.criticUser({ request: 'r', criteria: ['a', 'b'], draft: 'd', checks });
  assert.ok(user.indexOf('# How the checkable criteria are settled') > user.indexOf('# Acceptance criteria'));
  assert.ok(user.indexOf('# How the checkable criteria are settled') < user.indexOf('# Draft under review'));
  assert.match(R.handoffUser({ request: 'r', draft: 'd', checks }), /Carry every check above into the acceptance tests/);
});

test('runChain on chains/mock.json records no kinds (report.json shape unchanged)', async () => {
  const result = await runChain({ request: 'Write a short fixture deliverable.', config: load('mock'), log: () => {} });
  assert.equal(result.criteriaKinds, undefined);
  const report = reportJsonShape({ runId: 'r', chain: 'mock', task: 't', result });
  for (const k of ['criteria_kinds', 'criteria_summary', 'criteria_met_without_evidence']) assert.equal(k in report, false, k);
  assert.ok(report.criteria.every(c => typeof c === 'string'));
});

test('runChain on chains/mock-criteria-kinds.json: kinds, summary, downgrade and unevidenced MET recorded', async () => {
  const lines = [];
  const result = await runChain({ request: 'Write a short fixture deliverable.', config: load('mock-criteria-kinds'), log: m => lines.push(m) });
  assert.ok(result.criteria.every(c => typeof c === 'string'), 'criteria stays a list of strings');
  assert.equal(result.criteriaKinds.length, result.criteria.length);
  assert.deepEqual(result.criteriaSummary, {
    total: 5, checkable: 2, checkable_on_plan: 1, checkable_on_build: 1, judgement: 3,
    unclassified: 0, downgraded: 1, vague: 1, met_without_evidence: 2,
  });
  assert.deepEqual(result.metWithoutEvidence.map(m => m.round), [2, 2]);
  assert.ok(lines.some(l => /2 checkable \(1 on the plan, 1 at build\), 3 judgement/.test(l)));
  const report = reportJsonShape({ runId: 'r', chain: 'mock-criteria-kinds', task: 't', result });
  assert.equal(report.criteria_summary.checkable, 2);
  assert.equal(report.criteria_kinds[3].check, 'npm test exits 0');
  assert.equal(report.criteria_met_without_evidence.length, 2);
  assert.match(renderBoardMd({ runId: 'r', result }), /Acceptance criteria: 5 - 2 checkable/);
});

test('hand-written criteria objects on a chain are split into texts and kinds, and still pass the guards', async () => {
  const config = { ...load('mock'), criteria_kinds: { enabled: true }, criteria: [
    { criterion: 'The deliverable is the artifact itself, not a plan for one.', kind: 'judgement' },
    { criterion: 'It states the assumptions it was written under.', kind: 'checkable', check: 'has an "Assumptions" heading', on: 'plan' },
  ] };
  const result = await runChain({ request: 'Write a short fixture deliverable.', config, log: () => {} });
  assert.deepEqual(result.criteria, ['The deliverable is the artifact itself, not a plan for one.', 'It states the assumptions it was written under.']);
  assert.equal(result.criteriaSummary.checkable, 1);
  const bad = { ...load('mock'), criteria: [{ criterion: 'Is a JSON object with a "criteria" key.' }] };
  await assert.rejects(runChain({ request: 'x', config: bad, log: () => {} }), /describe the criteria list itself/);
});

test('parseCriteriaFile: markdown list, JSON array and JSON object; bad input is refused', () => {
  assert.deepEqual(parseCriteriaFile('# Criteria\n\n- one\n* two\n3. three\n\n'), ['one', 'two', 'three']);
  assert.deepEqual(parseCriteriaFile('["a", {"criterion": "b", "kind": "judgement"}]'), ['a', { criterion: 'b', kind: 'judgement' }]);
  assert.deepEqual(parseCriteriaFile('{"criteria": ["a"]}'), ['a']);
  assert.throws(() => parseCriteriaFile('{"criteria": []}'), /non-empty/);
  assert.throws(() => parseCriteriaFile('{oops'), /not valid JSON/);
  assert.throws(() => parseCriteriaFile('# only a heading\n'), /no criteria/);
});

test('chain lint: criteria_kinds is a known flag block with a closed key set', () => {
  assert.deepEqual(lintChain(load('mock-criteria-kinds')).filter(f => /criteria-kinds/.test(f.kind)), []);
  const typo = lintChain({ ...load('mock'), criteria_kinds: { enable: true } });
  assert.ok(typo.some(f => f.kind === 'invalid-criteria-kinds-config' && /did you mean "enabled"/.test(f.fix)));
});

test('CLI --criteria <file>: the file replaces the criteria stage and is recorded for resume', () => {
  const dir = mkdtempSync(join(tmpdir(), 'criteria-file-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 'x.md'), 'A test task.');
  writeFileSync(join(dir, 'criteria.json'), JSON.stringify({ criteria: [
    { criterion: 'It states the assumptions it was written under.', kind: 'checkable', check: 'has an "Assumptions" heading', on: 'plan' },
    'It adds no scope the request did not ask for.',
  ] }));
  execFileSync('node', [cli, '--task', 'tasks/x.md', '--chain', 'mock-criteria-kinds', '--criteria', 'criteria.json'], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH } });
  const runDir = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
  assert.deepEqual(report.criteria, ['It states the assumptions it was written under.', 'It adds no scope the request did not ask for.']);
  assert.equal(report.criteria_summary.checkable, 1);
  assert.equal(report.criteria_summary.unclassified, 1);
  assert.equal(JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')).criteriaFile, join(dir, 'criteria.json'));
  assert.deepEqual(readdirSync(runDir).filter(f => f.startsWith('criteria')), [], 'no criteria stage ran');
});

test('CLI --criteria with --from-run is refused before any call', () => {
  const dir = mkdtempSync(join(tmpdir(), 'criteria-file-'));
  writeFileSync(join(dir, 'x.md'), 'A test task.');
  writeFileSync(join(dir, 'c.md'), '- one\n');
  mkdirSync(join(dir, 'earlier'));
  writeFileSync(join(dir, 'earlier', 'report.json'), JSON.stringify({ criteria: ['a'] }));
  writeFileSync(join(dir, 'earlier', 'build.md'), 'a draft');
  let err;
  try { execFileSync('node', [cli, '--task', 'x.md', '--chain', 'mock', '--criteria', 'c.md', '--from-run', 'earlier'], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH }, stdio: 'pipe' }); } catch (e) { err = e; }
  assert.ok(err, 'expected a refusal');
  assert.equal(err.status, 2);
  assert.match(String(err.stderr), /--criteria: cannot be combined with --from-run/);
  assert.equal(readdirSync(dir).includes('runs'), false, 'no run folder was started');
});
