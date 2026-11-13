// 0.8.4 D15 / D33 (second unit of the lane A wiring): the two information checks of the delivered plan's body, src/plan-checks.js, wired at the run's end in src/cli.js. Findings go to WARNINGS.md and to the additive report.json field
// `plan_checks`; per check a reader tells "not asked for" (no entry), "did not run" ({ ran: false, reason }) and "ran" ({ ran: true, findings }, an empty list = found nothing) apart. Each row injects ONLY the word that asks for its check
// (test/helpers/held-names-preload.js) and reads the real report.json and WARNINGS.md of a real run; the pure rows read planChecksOf and checkClaimMarkers directly. Offline, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { setHeldForTest } from '../src/held-roles.js';
import { planChecksOf, planCheckLines } from '../src/plan-checks.js';
import { checkClaimMarkers } from '../src/claim-markers.js';
import { excerptIdSetsOf } from '../src/excerpt-record.js';
import { milestoneLintOf } from '../src/tree-ready.js';
import * as H from './held-prompts/held-084-a.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const preload = join(root, 'test', 'helpers', 'held-names-preload.js');
afterEach(() => setHeldForTest(null));

const PLAN_UNMARKED = '# Plan\n\n## 1. Cache\n\nThe cache lives in src/cache.js and expires after version 2.4.\n';
const PLAN_CLEAN = '# Plan\n\n## 1. Cache\n\nA small cache keeps the recent items.\n';
const PLAN_NAMES_IT = '# Plan\n\n## 1. Cache\n\nA small cache keeps the recent items; the test calls widgetCount to count them.\n';
const TASK_PLAIN = 'Plan a small cache.\n';
const TASK_WITH_TEST = 'Plan a small cache. The test it must pass is fenced below.\n\n```js\n// test/items.test.js\nimport { widgetCount } from \'widgets\';\nwidgetCount();\n```\n';
const CLAIM = ['builderMarkersRule']; const IDENT = ['handoffNoTestsLine'];

const chain = {
  name: 'wire', description: 'test', maxRounds: 2, stopOnPass: true, handoff: true,
  estimate: { promptTokens: 100, draftTokens: 100, critiqueTokens: 100 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' }, handoff: { provider: 'mock', model: 'mock-builder' }, critics: [{ provider: 'mock', model: 'mock-critic-passer', lab: 'a' }] },
};
// A whole run with `--draft` (the draft is the plan under test); the mock passer states no verdict in this chain, so the run ends with exit 22 (the exit the fixture is known to give, see test/lane-a-wiring.test.js).
function wholeRun({ plan, task = TASK_PLAIN, names = [] }) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-plan-checks-'));
  try {
    mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'plans'));
    writeFileSync(join(dir, 'tasks', 't.md'), task); writeFileSync(join(dir, 'plans', 'plan.md'), plan); writeFileSync(join(dir, 'chains', 'wire.json'), JSON.stringify(chain));
    const r = spawnSync(process.execPath, ['--import', preload, cli, '--chain', 'wire', '--task', 'tasks/t.md', '--draft', 'plans/plan.md'], { cwd: dir, encoding: 'utf8', timeout: 120_000, env: { PATH: process.env.PATH, HOME: dir, THC_HELD_NAMES: names.join(',') } });
    assert.equal(r.status, 22, `exit ${r.status}: ${r.stdout}${r.stderr}`);
    const id = readdirSync(join(dir, 'runs'))[0];
    const at = name => (existsSync(join(dir, 'runs', id, name)) ? readFileSync(join(dir, 'runs', id, name), 'utf8') : '');
    return { report: JSON.parse(at('report.json')), warnings: at('WARNINGS.md'), brief: at('RESUME.md'), out: r.stdout + r.stderr };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: each row injected ONLY the word that asks for its check, so the other check was 'not asked for' (no entry), and a control row ran with no word recorded. NEW: both words are recorded, so both checks always run: the other check's entry reads `{ ran: true, findings: [] }` where it finds nothing (K6); the control row 'words unrecorded' is removed (K7, SIBLING: 'claim markers, ran and found nothing', which asserts the recorded report field); the three-states row loses its two held-state halves (K7, SIBLING: its own recorded `no_plan_body` and both-keys assertions). WHY: builderMarkersRule and handoffNoTestsLine are recorded (recorded-084-a.js).
test('claim markers, ran with findings: the report says ran and lists the unmarked claim, WARNINGS.md carries it as one line, and the identifier check ran and found nothing (no fenced test)', () => {
  const r = wholeRun({ plan: PLAN_UNMARKED });
  const c = r.report.plan_checks.claim_markers;
  assert.equal(c.ran, true);
  assert.equal(c.findings.length, 1);
  assert.equal(c.findings[0].id, 'claim_unmarked');
  assert.match(c.findings[0].message, /^section 1, line 5: 'The cache lives in src\/cache\.js and expires after version 2\.4\.' names .* and carries no CHECKED, UNVERIFIED, DISPUTED or ABSENT marker\.$/);
  assert.deepEqual(r.report.plan_checks.test_identifiers, { ran: true, findings: [] }, 'the identifier check ran: the task fences no test, so it found nothing');
  assert.match(r.warnings, /^- claim_unmarked: section 1, line 5: 'The cache lives in src\/cache\.js/m);
});

test('claim markers, ran and found nothing: ran true with an empty list, and WARNINGS.md has no claim line (an empty list is not an absent entry)', () => {
  const r = wholeRun({ plan: PLAN_CLEAN });
  assert.deepEqual(r.report.plan_checks, { claim_markers: { ran: true, findings: [] }, test_identifiers: { ran: true, findings: [] } });
  assert.doesNotMatch(r.warnings, /claim_/);
});

test('identifier check, ran with findings and ran and found nothing: a name the fenced test uses that the plan never mentions is listed; a plan that mentions it gives an empty list', () => {
  const found = wholeRun({ plan: PLAN_CLEAN, task: TASK_WITH_TEST });
  const t = found.report.plan_checks.test_identifiers;
  assert.equal(t.ran, true);
  assert.deepEqual(t.findings.map(f => f.id), ['test_identifier_unmentioned']);
  assert.equal(t.findings[0].message, 'the fenced test test/items.test.js uses widgetCount, which the plan never mentions; that test may judge the work.');
  assert.match(found.warnings, /^- test_identifier_unmentioned: the fenced test test\/items\.test\.js uses widgetCount, which the plan never mentions; that test may judge the work\.$/m);
  const none = wholeRun({ plan: PLAN_NAMES_IT, task: TASK_WITH_TEST });
  assert.deepEqual(none.report.plan_checks.test_identifiers, { ran: true, findings: [] });
});

test('the states, pure: did not run = ran false with a reason when the plan body could not be separated, ran = findings (both checks are asked for)', () => {
  assert.deepEqual(planChecksOf({ plan: undefined, task: TASK_PLAIN }), { claim_markers: { ran: false, reason: 'no_plan_body' }, test_identifiers: { ran: false, reason: 'no_plan_body' } });
  assert.deepEqual(Object.keys(planChecksOf({ plan: PLAN_CLEAN, task: TASK_PLAIN })), ['claim_markers', 'test_identifiers']);
  assert.deepEqual(planCheckLines({ claim_markers: { ran: true, findings: [{ id: 'claim_unmarked', message: 'm' }] }, test_identifiers: { ran: true, findings: [] } }), ['- claim_unmarked: m\n']);
});

test('only an excerpt that carries text supports a CHECKED excerpt marker: a withheld one is recorded, so it is not "never recorded" (the A-DRAFT sentence); one the run never recorded still says never recorded; one with text is no finding', () => {
  const entries = [{ id: 'E-1', approval: { status: 'approved' } }, { id: 'E-2', approval: { status: 'withheld' } }, { id: 'E-3', approval: { status: 'refused' } }, { id: 'E-4', approval: { status: 'edited' } }];
  const sets = excerptIdSetsOf(entries);
  assert.deepEqual(sets, { shown: ['E-1', 'E-4'], noText: ['E-2', 'E-3'] });
  const plan = '# Plan\n\n## 1. Queue\n\nThe queue is bounded [CHECKED: excerpt E-1].\nIt drops on restart [CHECKED: excerpt E-2].\nIt retries three times [CHECKED: excerpt E-3].\nIt logs each drop [CHECKED: excerpt E-9].\nIt uses a ring buffer [CHECKED: excerpt E-4].\n';
  const found = checkClaimMarkers({ plan, excerptIds: sets.shown, excerptNoText: sets.noText });
  assert.deepEqual(found.map(f => f.message), [
    'section 1, line 6 is marked [CHECKED: excerpt E-2], and that excerpt carries no text: it was withheld, refused, left unanswered or not cut, so no seat was shown it.',
    'section 1, line 7 is marked [CHECKED: excerpt E-3], and that excerpt carries no text: it was withheld, refused, left unanswered or not cut, so no seat was shown it.',
    'section 1, line 8 is marked [CHECKED: excerpt E-9], and the run never recorded that excerpt.',
  ]);
  assert.equal(excerptIdSetsOf(null).shown.length, 0);
});

test('tree readiness never reads plan_checks: the readiness lint of a report is the same with and without the field, and a finding there does not make a clean lint unclean', () => {
  const base = { handoff_milestones: { status: 'ready_for_build', milestones: 1, findings: [] } };
  const withChecks = { ...base, plan_checks: { claim_markers: { ran: true, findings: [{ id: 'claim_unmarked', message: 'm' }] } } };
  assert.deepEqual(milestoneLintOf(withChecks), milestoneLintOf(base));
  assert.deepEqual(milestoneLintOf(withChecks), { status: 'ready_for_build', findings: [] });
});

test('the schema declares plan_checks (stable or experimental, described) and a real report with findings validates against it; a shape the schema must reject is rejected', () => {
  const schema = JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'));
  assert.equal(schema.properties.plan_checks['x-stability'], 'experimental');
  assert.ok(schema.properties.plan_checks.description.length > 20);
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the description began `0.8.4 (D15, D33; A-DRAFT): present only when the lane A wording that asks for the checks is recorded` and ended `...so an absent entry is not an empty one. A finding never changes ...`. NEW: the description as applied: it begins `0.8.4: present only when the run delivered a plan.` (K5). WHY: the reviewed text of schemas/report-v1.json plan_checks.
  assert.match(schema.properties.plan_checks.description, /^0\.8\.4: present only when the run delivered a plan\..*a check that was not asked for has no entry, so an absent entry is not an empty one\. A finding never changes `passed`, the exit code or any text, and nothing reads this field to decide anything\.$/);
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true }); ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
  const validate = ajv.compile(schema);
  const r = wholeRun({ plan: PLAN_UNMARKED, task: TASK_WITH_TEST, names: [...CLAIM, ...IDENT] });
  assert.deepEqual(Object.keys(r.report.plan_checks), ['claim_markers', 'test_identifiers']);
  assert.ok(validate(r.report), JSON.stringify(validate.errors, null, 2));
  for (const bad of [{ claim_markers: { findings: [] } }, { claim_markers: { ran: false, reason: 'because' } }, { other_check: { ran: true, findings: [] } }, { claim_markers: { ran: true, findings: [{ id: 'x' }] } },
    // the three states are enforced, not only described: a check that ran carries `findings` and no `reason`; a check that did not run carries a `reason` and no `findings`
    { claim_markers: { ran: true } }, { claim_markers: { ran: false } }, { claim_markers: { ran: true, reason: 'no_plan_body' } }, { claim_markers: { ran: false, reason: 'no_plan_body', findings: [] } }]) {
    assert.equal(validate({ ...r.report, plan_checks: bad }), false, JSON.stringify(bad));
  }
  assert.ok(validate({ ...r.report, plan_checks: { claim_markers: { ran: false, reason: 'no_plan_body' }, test_identifiers: { ran: true, findings: [] } } }), 'the did-not-run shape and the ran-with-no-findings shape both validate');
  assert.match(readFileSync(join(root, 'src', 'cli.js'), 'utf8'), /log\(`  plan_checks: not recorded \(\$\{e\?\.message \|\| e\}\)`\)/, 'the A-DRAFT log line of the error path');
});

test('what a person sees after a run with findings: the lines in WARNINGS.md and nothing new on the console (no new console sentence); the run ends with the exit it had without the check', () => {
  const withFindings = wholeRun({ plan: PLAN_UNMARKED, names: CLAIM });
  assert.match(withFindings.warnings, /^- claim_unmarked: /m);
  assert.doesNotMatch(withFindings.out, /claim_unmarked|claim_range_unshown|test_identifier_unmentioned/, 'the console prints no finding');
});
