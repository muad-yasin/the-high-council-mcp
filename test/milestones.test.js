// 0.8.2 item 6c (owner 6 Oct 2026): the $0 traceability lint over seat-written milestones. The seat words are a held prompt (P10); this is the part that is real and testable now. $0, offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMilestones, lintMilestones, STATUS_VALUES } from '../src/milestones.js';
import { buildStageContract } from '../src/stage-contract.js';
import { lintChain } from '../src/chain-lint.js';
import Ajv2020 from 'ajv/dist/2020.js';
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'schemas/report-v1.json'), 'utf8')));

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GOOD = `# HANDOFF.md

Status: ready_for_build

## What this is
A small plan.

## Milestones
### M0 - walking skeleton
Entry: the repo exists.
Work: 1. create the entry point (plan section 2).
Exit:
- check: C1 | node src/main.js => prints "ok"
- discharges: C1

### M1 - the list view
Entry: M0 exit passes.
Work: 2. the list (plan section 3).
Exit:
- check: C2 | npm test => 0 failures
- check: C3 | open the list by hand => three items show
- discharges: C2, C3

## Final checklist
- [ ] every criterion is discharged
- [x] the progress file is current
`;

test('parse: status, milestones with entry/work/checks/discharges, the final checklist', () => {
  const p = parseMilestones(GOOD);
  assert.equal(p.status, 'ready_for_build');
  assert.deepEqual(p.milestones.map(m => m.id), ['M0', 'M1']);
  assert.equal(p.milestones[0].title, 'walking skeleton');
  assert.deepEqual(p.milestones[1].checks, [{ check: 'npm test', expected: '0 failures', criteria: ['C2'] }, { check: 'open the list by hand', expected: 'three items show', criteria: ['C3'] }]);
  assert.deepEqual(p.milestones[1].discharges, ['C2', 'C3']);
  assert.deepEqual(p.checklist, ['every criterion is discharged', 'the progress file is current']);
});

test('lint: a complete handoff has no findings; each defect is found under its own kind', () => {
  const ids = ['C1', 'C2', 'C3'];
  assert.deepEqual(lintMilestones({ text: GOOD, criteriaIds: ids }).findings, []);
  const kinds = (text, c = ids) => lintMilestones({ text, criteriaIds: c }).findings.map(f => f.kind);
  assert.deepEqual(kinds('# HANDOFF\n\nJust prose.\n'), ['no_milestones']);
  assert.ok(kinds(GOOD, ['C1', 'C2', 'C3', 'C4']).includes('criterion_not_discharged'), 'a criterion no milestone discharges');
  assert.ok(kinds(GOOD, ['C1', 'C2']).includes('unknown_criterion'), 'a milestone names C3 but the run has two criteria');
  assert.ok(kinds(GOOD.replace('- check: C1 | node src/main.js => prints "ok"\n', '')).includes('milestone_no_check'));
  assert.ok(kinds(GOOD.replace('=> prints "ok"', '')).includes('check_without_expected'));
  assert.ok(kinds(GOOD.replace('Status: ready_for_build\n', '')).includes('no_status'));
  assert.ok(kinds(GOOD.replace('ready_for_build', 'looks_good')).includes('bad_status'));
  assert.ok(kinds(GOOD.replace('### M1 - the list view', '### M0 - the list view')).includes('duplicate_milestone'));
  // a milestone with discharges but no check discharges nothing: a claim with no way to test it is not coverage
  assert.ok(kinds(GOOD.replace(/- check: C2 \| npm test => 0 failures\n- check: C3 \| open the list by hand => three items show\n/, '')).includes('criterion_not_discharged'));
  assert.deepEqual(STATUS_VALUES, ['ready_for_build', 'needs_evidence', 'needs_decision', 'blocked', 'partial']);
});

test('off by default: the stage contract and the lint accept the flag, and the contract gains the sections only when it is on', () => {
  const cfg = JSON.parse(readFileSync(join(root, 'chains', 'mock.json'), 'utf8'));
  assert.deepEqual(buildStageContract({ ...cfg, handoff: true }, 'handoff').deliverable_format.required_sections, ['tasks']);
  assert.deepEqual(buildStageContract({ ...cfg, handoff: true, handoff_contract: { milestones: true } }, 'handoff').deliverable_format.required_sections, ['tasks', 'milestones', 'final_checklist']);
  assert.deepEqual(lintChain({ ...cfg, handoff_contract: { milestones: true } }, 'x.json').filter(f => /handoff-contract/.test(f.kind)), []);
  assert.ok(lintChain({ ...cfg, handoff_contract: { milestones: 'yes' } }, 'x.json').some(f => /handoff-contract/.test(f.kind)));
});

// ---- through the CLI: a mock handoff seat that writes milestones ----------------------------------------------------------------------------------------------------------

function go(extra, handoffModel) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-ms-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n');
  const cfg = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  const seats = { ...cfg.seats, ...(handoffModel ? { handoff: { provider: 'mock', model: handoffModel } } : {}) };
  writeFileSync(join(dir, 'chains', 'ms.json'), JSON.stringify({ ...cfg, name: 'ms', seats, ...extra }));
  const r = spawnSync(process.execPath, [join(root, 'src/cli.js'), '--chain', 'ms', '--task', 'tasks/t.md'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 120_000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const run = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  const read = f => { try { return readFileSync(join(run, f), 'utf8'); } catch { return null; } };
  return { report: JSON.parse(read('report.json')), handoff: read('HANDOFF.md'), warnings: read('WARNINGS.md') };
}

test('flag off (every shipped chain): nothing is parsed, no field, no warning, the section carries no gaps', () => {
  const w = go({});
  assert.equal(w.report.handoff_milestones, undefined);
  assert.doesNotMatch(w.warnings || '', /handoff_milestones/);
  assert.doesNotMatch(w.handoff, /Gaps the harness found/);
});

test('flag on, a handoff with no milestones: one finding, in report.json, WARNINGS.md and the Before-you-build section; passed is untouched', () => {
  const off = go({});
  const w = go({ handoff_contract: { milestones: true } });
  assert.equal(w.report.passed, off.report.passed);
  assert.deepEqual(w.report.handoff_milestones.findings.map(f => f.kind), ['no_milestones']);
  assert.match(w.warnings, /handoff_milestones: no_milestones/);
  assert.match(w.handoff, /Gaps the harness found in this handoff's milestones/);
  assert.equal(validate(w.report), true, JSON.stringify(validate.errors));
});

test('flag on, a handoff that writes good milestones against the run\'s real criteria: clean', () => {
  const w = go({ handoff_contract: { milestones: true } }, 'mock-handoff-milestones');
  assert.deepEqual(w.report.handoff_milestones.findings, [], JSON.stringify(w.report.handoff_milestones));
  assert.equal(w.report.handoff_milestones.milestones, 1);
  assert.equal(w.report.handoff_milestones.status, 'ready_for_build');
  assert.equal(validate(w.report), true, JSON.stringify(validate.errors));
  assert.doesNotMatch(w.handoff, /Gaps the harness found/);
});

// ---- review fixes: realistic seat output that used to give false findings ------------------------------------------------------------------------------------------------

test('realistic seat formatting does not make false findings: bold labels, a C1-C3 range, C01, #### headings, a fenced example before the section, a Status line elsewhere, CRLF', () => {
  const ids = ['C1', 'C2', 'C3'];
  const f = text => lintMilestones({ text, criteriaIds: ids }).findings.map(x => x.kind);
  assert.deepEqual(f(GOOD.replace('- discharges: C2, C3', '- discharges: C2-C3')), [], 'a range C2-C3 discharges C2 and C3');
  assert.deepEqual(f(GOOD.replace('- discharges: C1', '- discharges: C01')), [], 'C01 reads as C1');
  assert.deepEqual(f(GOOD.replace('Status: ready_for_build', '**Status:** ready_for_build')), []);
  assert.deepEqual(f(GOOD.replace('- check: C1 | node src/main.js => prints "ok"', '- **check:** C1 | node src/main.js => prints "ok"')), []);
  assert.deepEqual(f(GOOD.replace('### M0 - walking skeleton', '#### **M0** - walking skeleton')), []);
  assert.deepEqual(f(GOOD.replace('## What this is', '## What this is\nStatus: draft of the idea, not final\n')), [], 'a Status line below the top block is prose, not the status');
  assert.deepEqual(f(`Example of the format:\n\n\`\`\`\n## Milestones\n### M9 - example\n\`\`\`\n\n${GOOD}`), [], 'a fenced example before the real section is ignored');
  assert.deepEqual(f(GOOD.replace('Work: 1. create the entry point (plan section 2).', 'Work:\n```\n## not a heading\n```')), [], 'a ## line inside a fence does not end the section');
  assert.deepEqual(f(GOOD.replace(/\n/g, '\r\n')), []);
});


// ---- the check-to-criterion link (owner "Yes", 7 Oct 2026): a criterion counts as discharged only by a check that names it ----
const ids3 = ['C1', 'C2', 'C3'];
const kinds3 = text => lintMilestones({ text, criteriaIds: ids3 }).findings.map(f => f.kind);

test('link: a check names its criteria before the "|" (commas, "&", "and", ranges); a "|" that is not a list of criterion ids is part of the check (a shell pipe)', () => {
  const t = id => parseMilestones(`## Milestones\n### M0 - a\nExit:\n- check: ${id} => ok\n`).milestones[0].checks[0];
  assert.deepEqual(t('C1, C3 | npm test'), { check: 'npm test', expected: 'ok', criteria: ['C1', 'C3'] });
  assert.deepEqual(t('C1 & C2 | x'), { check: 'x', expected: 'ok', criteria: ['C1', 'C2'] });
  assert.deepEqual(t('C1 and C3 | x').criteria, ['C1', 'C3']);
  assert.deepEqual(t('C2-C4 | x').criteria, ['C2', 'C3', 'C4']);
  assert.deepEqual(t('C01 | x').criteria, ['C1']);
  assert.deepEqual(t('npm test | grep ok'), { check: 'npm test | grep ok', expected: 'ok', criteria: [] }, 'a shell pipe is not a criterion list');
  assert.deepEqual(t('see C1 | x').criteria, [], 'prose before the bar is not a list of ids');
  assert.deepEqual(t('plain check'), { check: 'plain check', expected: 'ok', criteria: [] });
});

test('link: a milestone that lists criteria in "- discharges:" and has an unrelated check discharges nothing (the gap the link closes)', () => {
  const text = GOOD.replace('- check: C2 | npm test => 0 failures', '- check: npm test => 0 failures').replace('- check: C3 | open the list by hand => three items show', '- check: open the list by hand => three items show');
  assert.deepEqual(kinds3(text).filter((k, i, a) => a.indexOf(k) === i).sort(), ['criterion_not_discharged', 'discharge_not_checked']);
  const f = lintMilestones({ text, criteriaIds: ids3 }).findings;
  assert.ok(f.some(x => x.kind === 'criterion_not_discharged' && /C2 is not named by any check/.test(x.message)));
  assert.ok(f.some(x => x.kind === 'discharge_not_checked' && /M1 says it discharges C2, but none of its checks names C2/.test(x.message)));
});

test('link: no "- discharges:" line is needed; a check naming a criterion that does not exist is found; one check may settle several criteria; a criterion named only in another milestone is covered there', () => {
  const noDischarges = GOOD.replace(/- discharges: .*\n/g, '');
  assert.deepEqual(kinds3(noDischarges), []);
  assert.ok(kinds3(GOOD.replace('- check: C3 |', '- check: C9 |')).includes('unknown_criterion'));
  assert.deepEqual(kinds3(noDischarges.replace('- check: C2 | npm test', '- check: C2, C3 | npm test').replace('- check: C3 | open the list by hand => three items show\n', '- check: open the list by hand => three items show\n')), []);
});
