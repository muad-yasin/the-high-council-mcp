// 0.8.2 audit fixes, Tier 2 (RANKED-BRIEF.md): the smaller findings, each with the test the report asked for. Offline, $0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
const UNPRICED = { provider: 'openrouter', model: 'vendor/not-in-the-price-table', maxTokens: 500 };

test('cnc-money F3 / cnc-cli-resume F2: --rematch refuses an unpriced seat under a cap BEFORE it creates its folder (exit 5 leaves no <id>.rematch-* folder, so the same command can run after a price row is added)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-rematch-unpriced-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small thing.\n');
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  writeFileSync(join(dir, 'chains', 'side.json'), JSON.stringify({ ...base, name: 'side' }));
  const env = { PATH: process.env.PATH, HOME: dir };
  assert.equal(spawnSync(process.execPath, [cli, '--chain', 'side', '--task', 'tasks/t.md'], { cwd: dir, encoding: 'utf8', env, timeout: 120_000 }).status, 0);
  const id = readdirSync(join(dir, 'runs'))[0];
  writeFileSync(join(dir, 'chains', 'side.json'), JSON.stringify({ ...base, name: 'side', seats: { ...base.seats, critics: [...base.seats.critics.slice(0, -1), { ...UNPRICED, lab: 'zz' }] } }));
  const r = spawnSync(process.execPath, [cli, '--rematch', `runs/${id}`, '--rematch-seed', '7'], { cwd: dir, encoding: 'utf8', env: { ...env, OPENROUTER_API_KEY: 'sk-or-v1-' + 'f'.repeat(40) }, timeout: 120_000 });
  assert.equal(r.status, 5, `${r.stdout}${r.stderr}`);
  assert.deepEqual(readdirSync(join(dir, 'runs')).filter(f => /rematch/.test(f)), [], 'no rematch folder was left behind by the refusal');
});

import { stageKindOf } from '../src/stage-contract.js';

test('cnc-cli-resume F4: every criteria label chain.js can pause on (criteria, criteria-retry, criteria-feasibility-retry) has the stage kind "criteria"', () => {
  const src = readFileSync(join(root, 'src', 'chain.js'), 'utf8');
  const labels = [...new Set([...src.matchAll(/label:\s*'(criteria[^']*)'/g)].map(m => m[1]))];
  assert.ok(labels.includes('criteria-retry') && labels.includes('criteria-feasibility-retry'), `the scan found them: ${labels.join(', ')}`);
  for (const l of labels) assert.equal(stageKindOf(l), 'criteria', l);
});

import { parseDisputes } from '../src/draft-disputes.js';
import { lintMilestones, parseMilestones } from '../src/milestones.js';

test('cnc-prompts F3: the Status line is its first word: backticks, emphasis and anything after the word do not make it "no status"', () => {
  const body = '\n## Milestones\n\n### M1 - a\nExit: done\n- check: C1 | run => ok\n';
  for (const [line, want] of [['Status: ready_for_build', 'ready_for_build'], ['Status: `ready_for_build`', 'ready_for_build'], ['Status: **partial**', 'partial'], ['Status: partial (M0 can start now)', 'partial'], ['Status: ready_for_build.', 'ready_for_build'], ['**Status:** blocked - see below', 'blocked']]) {
    assert.equal(parseMilestones(line + body).status, want, line);
  }
  assert.ok(lintMilestones({ text: 'Status: partial (M0 can start now)' + body, criteriaIds: ['C1'] }).findings.some(f => f.kind === 'status_not_ready'));
  assert.equal(parseMilestones('no status here' + body).status, null);
});

test('cnc-prompts F5: a DECLINED id may be wrapped in backticks, emphasis or angle brackets, and one line may name several ids (each gets the reason)', () => {
  const read = line => { const p = parseDisputes(`Plan.\n\n${line}`, { withIds: true }); return [p.disputeIds, p.disputes]; };
  const A = 'O-1a2b3c4d'; const B = 'O-5e6f7a8b';
  assert.deepEqual(read(`DECLINED: ${A}: it is taste`), [[A], ['it is taste']], 'the plain form still works');
  assert.deepEqual(read(`DECLINED: \`${A}\`: it is taste`), [[A], ['it is taste']]);
  assert.deepEqual(read(`DECLINED: **${A}**: it is taste`), [[A], ['it is taste']]);
  assert.deepEqual(read(`DECLINED: <${A}>: it is taste`), [[A], ['it is taste']]);
  assert.deepEqual(read(`DECLINED: ${A}, ${B}: both are taste`), [[A, B], ['both are taste', 'both are taste']]);
  assert.deepEqual(read(`DECLINED: \`${A}\`, \`${B}\` - both are taste`), [[A, B], ['both are taste', 'both are taste']]);
  assert.deepEqual(read('DECLINED: it is taste, O-nothex12 is not an id'), [[null], ['it is taste, O-nothex12 is not an id']], 'a line with no id stays whole');
  assert.deepEqual(read(`DECLINED: ${A}`), [[null], [`${A}`]], 'an id and nothing after it stays whole');
});

import { signoffTableGap, missingCriteriaRows } from '../src/criteria-ledger.js';

test('cnc-prompts F4 / 73-verdicts 2: a table row belongs to at most one criterion (exact or id first; containment only when unambiguous), so an omitted row or a blank-evidence row cannot hide behind a longer or shorter criterion', () => {
  const CR = ['The plan names every file it changes.', 'The plan names every file it changes and the owner of each file.', 'The plan states the rollback step.'];
  const row = (criterion, evidence = 'quoted', verdict = 'MET') => ({ criterion, verdict, evidence });
  // rows only for the 2nd and 3rd criterion: the 1st has none (the longer row used to count as the shorter one's row)
  const omitted = { meets: true, criteria: [row(CR[1]), row(CR[2])] };
  assert.deepEqual(signoffTableGap(omitted, CR), { kind: 'missing_rows', criterion_ids: ['C1'], table_rows: 2, criteria_total: 3 });
  assert.deepEqual(missingCriteriaRows(omitted, CR)?.criterion_ids, ['C1']);
  // all three rows, the 2nd with blank evidence (the 1st row used to be found first for it and the blank was never read)
  const blank = { meets: true, criteria: [row(CR[0]), row(CR[1], '   '), row(CR[2])] };
  assert.deepEqual(signoffTableGap(blank, CR), { kind: 'no_evidence', criterion_ids: ['C2'], table_rows: 3, criteria_total: 3 });
  // controls: a full table passes; a trimmed or extended row (unambiguous containment) still names its criterion; an id row ("C2") still does
  assert.equal(signoffTableGap({ meets: true, criteria: CR.map(c => row(c)) }, CR), null);
  assert.equal(signoffTableGap({ meets: true, criteria: [row(CR[0]), row('The plan names every file it changes and the owner of each file'), row('C3')] }, CR), null);
  assert.equal(signoffTableGap({ meets: true, criteria: [row('the plan names every file it changes. (done)'), row('C2'), row('The plan states the rollback step. It does.')] }, ['The plan names every file it changes.', 'Another criterion that is long enough.', 'The plan states the rollback step.']), null);
  // an ambiguous trimmed row (contained in two criteria, equal to neither) names none: fail closed
  assert.equal(signoffTableGap({ meets: true, criteria: [row('The plan names every file it changes'), row(CR[2])] }, [CR[1], 'The plan names every file it changes and the owner too, in full.', CR[2]])?.kind, 'missing_rows');
});

import { runChain } from '../src/chain.js';

test('cnc-debate F2: the cold-reader block says the panel signed off only when it did', async () => {
  const dispute = JSON.parse(readFileSync(join(root, 'chains', 'mock-dispute.json'), 'utf8'));
  const unanimous = JSON.parse(readFileSync(join(root, 'chains', 'mock-unanimous.json'), 'utf8'));
  const withCold = c => ({ ...c, coldRead: { enabled: true }, seats: { ...c.seats, coldRead: { provider: 'mock', model: 'mock-cold-read-yes', lab: 'mock-cold-reader' } } });
  const unsigned = await runChain({ request: 'Write a short fixture deliverable.', config: withCold(dispute), log: () => {} });
  assert.equal(unsigned.passed, false, 'fixture: the dispute chain does not sign off');
  assert.match(unsigned.deliverable, /## Cold-reader findings/);
  assert.equal(/signed off/.test(unsigned.deliverable.split('## Cold-reader findings')[1].split('\n---')[0]), false, 'the block does not claim a sign-off the panel never gave');
  assert.match(unsigned.deliverable.split('## Cold-reader findings')[1].split('\n---')[0], /did not sign off/);
  const signed = await runChain({ request: 'Write a short fixture deliverable.', config: withCold(unanimous), log: () => {} });
  assert.equal(signed.passed, true);
  assert.match(signed.deliverable.split('## Cold-reader findings')[1].split('\n---')[0], /The panel had already signed off/);
});

import { translateRefs } from '../src/debate-order.js';
import { readerView } from '../src/debate-order.js';
import * as R from '../src/roles.js';

test('cnc-debate F4: translateRefs also re-letters "Labs B and C", "lab c", "Labs B, C and D", "Labs B/C" (the singular form still works, and null gives the real lab names)', () => {
  const items = ['x', 'y', 'z', 'w'].map((lab, i) => ({ id: `${lab}-${i + 1}`, lab, title: lab }));
  let differing = 0;
  for (const poster of ['x', 'y', 'z', 'w']) for (const reader of ['x', 'y', 'z', 'w']) {
    const pv = readerView(items, poster, { runId: 'r4', anonymise: R.anonymise }); const rv = readerView(items, reader, { runId: 'r4', anonymise: R.anonymise });
    const L = lab => pv.maps.labTo[lab]; const T = lab => rv.maps.labTo[lab]; const letter = s => s.replace('Lab ', '');
    const written = `${L('x')} is fine, but Labs ${letter(L('y'))} and ${letter(L('z'))} are not; lab ${letter(L('w')).toLowerCase()} agrees. Labs ${letter(L('x'))}, ${letter(L('y'))} and ${letter(L('z'))}; Labs ${letter(L('y'))}/${letter(L('z'))}.`;
    const want = `${T('x')} is fine, but Labs ${letter(T('y'))} and ${letter(T('z'))} are not; lab ${letter(T('w')).toLowerCase()} agrees. Labs ${letter(T('x'))}, ${letter(T('y'))} and ${letter(T('z'))}; Labs ${letter(T('y'))}/${letter(T('z'))}.`;
    assert.equal(translateRefs(written, pv.maps, rv.maps), want, `${poster} -> ${reader}`);
    if (written !== want) differing++;
    assert.equal(translateRefs(written, pv.maps, null), `x is fine, but y and z are not; w agrees. x, y and z; y/z.`, `${poster} -> real names`);
  }
  assert.ok(differing >= 4, 'the premise: some reader letters differently from its poster');
  // prose that only looks like a lab reference is left alone when the poster's maps do not contain it
  const pv = readerView(items, 'x', { runId: 'r4', anonymise: R.anonymise });
  assert.equal(translateRefs('the labs are busy; Lab Alpha is not a letter', pv.maps, null), 'the labs are busy; Lab Alpha is not a letter');
});

test('cnc-debate F3: with debate_hygiene.shuffle the STORED replies (report.json debate.replies and the builder\'s board) are in real ids and lab names, like the stored posts; the guard still reads the author\'s own lettering', async () => {
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  const cfg = { ...base, majority_guard: { enabled: true }, debate_hygiene: { shuffle: true }, seats: { ...base.seats, proposers: base.seats.proposers.map(s => ({ ...s, model: 'mock-proposer-xref' })) } };
  const result = await runChain({ request: 'Write a short fixture deliverable.', config: cfg, runId: '2026-10-06T23-00-00-000Z', log: () => {} });
  const withdrawals = result.debate.replies.filter(r => r.action === 'withdraw');
  assert.ok(withdrawals.length >= 1);
  assert.ok(withdrawals.some(r => typeof r.conceded_to === 'string' && r.conceded_to.length > 0), 'fixture: the mock quotes the objection it concedes to');
  assert.ok(withdrawals.every(r => !r.unargued), 'the guard still saw the author\'s own lettering: its withdrawal that quotes the objection is honoured, not marked unargued');
  for (const r of result.debate.replies) for (const f of ['text', 'conceded_to', 'how', 'acceptance_test']) {
    if (typeof r[f] === 'string') assert.equal(/\bLab [A-Z]\b|\b[A-Z]-\d+\b/.test(r[f]), false, `reply ${f} still holds the author's private lettering: ${r[f]}`);
  }
  assert.equal(/\bLab [A-Z]\b|\bA-\d+ \(/.test(result.board), false, 'the builder\'s board shows no private lettering');
});

import { renameSync } from 'node:fs';

test('73-handoff 1: `council handoff --from-run` on a milestone chain writes the milestone gaps to WARNINGS.md and the console even when the run has no report.json (no thin contract to carry them)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-from-run-gaps-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 'x.md'), 'A test task.\n');
  const c = JSON.parse(readFileSync(join(root, 'chains', 'mock-unanimous.json'), 'utf8'));
  writeFileSync(join(dir, 'chains', 'fr-ms.json'), JSON.stringify({ ...c, name: 'fr-ms', handoff: true, handoff_contract: { milestones: true }, seats: { ...c.seats, handoff: { provider: 'mock', model: 'mock-handoff' } } }));
  const env = { PATH: process.env.PATH, HOME: dir };
  assert.equal(spawnSync(process.execPath, [cli, '--chain', 'fr-ms', '--task', 'tasks/x.md', '--max-usd', 'none'], { cwd: dir, encoding: 'utf8', env }).status, 0);
  const id = readdirSync(join(dir, 'runs'))[0]; const run = join(dir, 'runs', id);
  renameSync(join(run, 'report.json'), join(run, 'report.json.moved'));
  const before = readFileSync(join(run, 'WARNINGS.md'), 'utf8');
  const r = spawnSync(process.execPath, [cli, 'handoff', '--from-run', `runs/${id}`], { cwd: dir, encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const added = readFileSync(join(run, 'WARNINGS.md'), 'utf8').slice(before.length);
  assert.match(added, /handoff_milestones: no_milestones/, 'the gap is recorded in WARNINGS.md');
  assert.match(r.stdout + r.stderr, /handoff milestones: .*no_milestones/, 'and said on the console');
});

import { dryRunReport } from '../src/dry-run.js';

test('cnc-cli-resume F3: a policy warning is written to WARNINGS.md once per run, not once per sitting (a resume re-evaluates the policy and used to append the same line again)', () => {
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-budget.json'), 'utf8'));
  const chain = { ...base, name: 'budget-ext', seats: { ...base.seats, builder: { provider: 'external', model: 'claude-code-session' }, reviser: { provider: 'external', model: 'claude-code-session' } } };
  const r = dryRunReport(chain, {}).estimate;
  assert.ok(r.maximumUsd > r.expectedUsd * 1.01, 'fixture: the maximum is above the expected cost');
  const dir = mkdtempSync(join(tmpdir(), 'thc-polonce-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains')); writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a habit tracker.\n');
  writeFileSync(join(dir, 'chains', 'budget-ext.json'), JSON.stringify(chain));
  writeFileSync(join(dir, 'policy.json'), JSON.stringify({ allowed_providers: ['mock', 'external'], max_usd_per_run: (r.expectedUsd + r.maximumUsd) / 2 }));
  const env = { PATH: process.env.PATH, HOME: dir };
  const first = spawnSync(process.execPath, [cli, '--chain', 'budget-ext', '--task', 'tasks/t.md', '--max-usd', '1000'], { cwd: dir, encoding: 'utf8', env, timeout: 120_000 });
  assert.equal(first.status, 3, `fixture: paused at the external builder: ${first.stdout}${first.stderr}`);
  const id = readdirSync(join(dir, 'runs'))[0];
  const policyLines = () => readFileSync(join(dir, 'runs', id, 'WARNINGS.md'), 'utf8').split('\n').filter(l => l.startsWith('- policy:')).length;
  assert.equal(policyLines(), 1, 'fixture: one warning after the first sitting');
  const again = spawnSync(process.execPath, [cli, '--resume', `runs/${id}`, '--max-usd', '1000'], { cwd: dir, encoding: 'utf8', env, timeout: 120_000 });
  assert.equal(again.status, 3, `${again.stdout}${again.stderr}`);
  assert.match(again.stdout, /policy warning - max_usd_per_run/, 'the second sitting still SAYS it on the console');
  assert.equal(policyLines(), 1, 'but WARNINGS.md has it once');
});

import { lintChain } from '../src/chain-lint.js';

test('cnc-chains-lint F1: rule 12 (self-review) sees an external writer on the panel: plan-daily-7 and plan-highest-7 pass only because of "selfReview": "allowed"; without the key the rule fires', () => {
  for (const name of ['plan-daily-7', 'plan-highest-7']) {
    const cfg = JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));
    assert.equal(cfg.selfReview, 'allowed', `${name} says so in writing`);
    assert.deepEqual(lintChain(cfg, `${name}.json`).filter(f => f.kind === 'self-review'), [], `${name}: the key is meaningful and keeps it passing`);
    const { selfReview, ...without } = cfg;
    const found = lintChain(without, `${name}.json`).filter(f => f.kind === 'self-review');
    assert.ok(found.length >= 1, `${name} without selfReview: the writer is on the panel and the rule must say so`);
  }
});

test('73-config F2: chain-lint names a flag that does nothing in the chain\'s mode: answer_back without unanimous sign-off, debate_hygiene with no debate or alternatives, handoff_contract.milestones with handoff off', () => {
  const unanimous = JSON.parse(readFileSync(join(root, 'chains', 'mock-unanimous.json'), 'utf8'));
  const debate = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  const kinds = (c, ...ks) => lintChain(c, 'x.json').map(f => f.kind).filter(k => ks.includes(k));
  // answer_back
  assert.deepEqual(kinds({ ...unanimous, answer_back: { enabled: true } }, 'answer-back-needs-unanimous'), []);
  assert.deepEqual(kinds({ ...unanimous, signoff: 'first', answer_back: { enabled: true } }, 'answer-back-needs-unanimous'), ['answer-back-needs-unanimous']);
  assert.deepEqual(kinds({ ...unanimous, signoff: 'first', answer_back: { enabled: false } }, 'answer-back-needs-unanimous'), [], 'off is not a finding');
  // debate_hygiene
  assert.deepEqual(kinds({ ...debate, debate_hygiene: { shuffle: true, noQuoteMarks: true } }, 'debate-hygiene-without-debate'), []);
  assert.deepEqual(kinds({ ...unanimous, debate_hygiene: { shuffle: true } }, 'debate-hygiene-without-debate'), ['debate-hygiene-without-debate']);
  assert.deepEqual(kinds({ ...unanimous, debate_hygiene: { noQuoteMarks: true } }, 'debate-hygiene-without-debate'), ['debate-hygiene-without-debate']);
  assert.deepEqual(kinds({ ...unanimous, debate_hygiene: {} }, 'debate-hygiene-without-debate'), []);
  // handoff_contract.milestones
  assert.deepEqual(kinds({ ...unanimous, handoff: true, seats: { ...unanimous.seats, handoff: { provider: 'mock', model: 'mock-handoff' } }, handoff_contract: { milestones: true } }, 'handoff-milestones-without-handoff'), []);
  assert.deepEqual(kinds({ ...unanimous, handoff: false, handoff_contract: { milestones: true } }, 'handoff-milestones-without-handoff'), ['handoff-milestones-without-handoff']);
  assert.deepEqual(kinds({ ...unanimous, handoff_contract: { milestones: false } }, 'handoff-milestones-without-handoff'), []);
});

import { estimateChainRows } from '../src/cost.js';

test('cnc-money F2: a deep-dive Anthropic seat whose dollar cap fits one attempt but not attempt + retry plans the SAME rows in the expected and the maximum dry run, joined by label; the maximum is never below the expected', () => {
  const anthropic = { provider: 'anthropic', model: 'claude-sonnet-5', maxTokens: 20000 };
  const mk = usd => ({ name: 't', maxRounds: 1, signoff: 'first', criteria: ['x'], estimate: { promptTokens: 1000, draftTokens: 2000, critiqueTokens: 500 }, deep_dive: { enabled: true, maxCalls: 3, ...(usd === undefined ? {} : { usd }) }, seats: { builder: { provider: 'mock', model: 'mock-priced', maxTokens: 8000 }, critics: [{ provider: 'mock', model: 'mock-priced' }], deep_dive: anthropic } });
  const open = estimateChainRows(mk(), { maximum: true }).find(r => r.label.startsWith('deep-dive-') && r.label !== 'deep-dive-revise');
  const first = estimateChainRows(mk(), {}).find(r => r.label.startsWith('deep-dive-') && r.label !== 'deep-dive-revise').usd;
  assert.ok(open.usd > first, 'fixture: the maximum adds the retry');
  const usd = first + (open.usd - first) / 2; // fits the first attempt, not first + retry
  const expected = estimateChainRows(mk(usd), {}).filter(r => r.label.startsWith('deep-dive-') && r.label !== 'deep-dive-revise').map(r => r.label);
  const maximum = estimateChainRows(mk(usd), { maximum: true }).filter(r => r.label.startsWith('deep-dive-') && r.label !== 'deep-dive-revise').map(r => r.label);
  assert.deepEqual(maximum, expected, 'both passes stop on the same projection (first attempt + retry, as the run projects it)');
  const report = dryRunReport(mk(usd), {});
  assert.ok(report.estimate.maximumUsd >= report.estimate.expectedUsd, `maximum ${report.estimate.maximumUsd} >= expected ${report.estimate.expectedUsd}`);
  for (const r of report.rows) assert.ok(r.maximumUsd !== null && r.maximumUsd >= r.usd - 1e-12, `${r.label}: maximumUsd ${r.maximumUsd} vs usd ${r.usd}`);
});

import { objectionId } from '../src/objection-ids.js';
import { applyAnswers } from '../src/answer-back.js';

test('73-verdicts 4: a criterion that drifts in trimming, case or a closing full stop is the same objection (one id), so a sustained objection the judge lists again is not carried a second time', () => {
  const base = objectionId('a', { criterion: 'States the rollback step.' });
  for (const c of ['States the rollback step', ' states the rollback step. ', 'STATES THE ROLLBACK STEP.', 'States  the rollback step.']) assert.equal(objectionId('a', { criterion: c }), base, JSON.stringify(c));
  assert.notEqual(objectionId('a', { criterion: 'States the rollback step and who runs it.' }), base, 'a different criterion is a different id');
  assert.notEqual(objectionId('b', { criterion: 'States the rollback step.' }), base, 'and a different lab');
  const own = [{ id: base, criterion: 'States the rollback step.', problem: 'p' }];
  const r = applyAnswers({ lab: 'a', critique: { failures: [{ criterion: 'States the rollback step', problem: 'again' }], answers: [{ id: base, status: 'sustained' }] }, own, shownDraft: 'x', round: 2 });
  assert.deepEqual(r.carried, [], 'listed again under a drifted criterion: not carried a second time');
});

import { evaluatePolicy } from '../src/policy.js';

test('cnc-money F1 (superseded by the owner\'s "Terminal rule only, no cap change", 7 Oct 2026; test/audit-advice-policy.test.js): the advice send path hands in the chain\'s expected cost and the call\'s ceiling and says so (figure "call"); the CLI wording is unchanged', () => {
  const config = JSON.parse(readFileSync(join(root, 'chains', 'mock-unanimous.json'), 'utf8'));
  const ctx = { config, allSeats: [], worstCaseUsd: 1.32 };
  const advice = evaluatePolicy({ max_usd_per_run: 1 }, { ...ctx, figure: 'call' });
  assert.equal(advice.ok, false);
  assert.match(advice.reasons.join(' '), /max_usd_per_run: the expected cost of this call's chain \(the first figure --dry-run prints\) is \$1\.3200, over the \$1\.0000 limit/);
  assert.match(evaluatePolicy({ max_usd_per_run: 1 }, ctx).reasons.join(' '), /this chain's expected cost \(the first figure --dry-run prints\) is \$1\.3200/, 'the CLI path keeps its words');
  // 0.8.2 (owner via C&C, 7 Oct 2026, "Put the fix in 0.8.2"): one shared rule, advicePolicyVerdict, called by the quote, the start and the terminal answer; the rule's body refuses on the CLI's expected figure and warns on the ceiling
  for (const f of ['send-path-refusals.js', 'send-path.js', 'gate-cli.js']) {
    const src = readFileSync(join(root, 'src', f), 'utf8');
    assert.match(src, /advicePolicyVerdict\(policy, config, /, `${f}: calls the one rule`);
    assert.equal(/evaluatePolicy\(policy, \{/.test(src.replace(/function advicePolicyVerdict[\s\S]*?\n\}\n/, '')), false, `${f}: no second inline policy evaluation`);
  }
  const rule = readFileSync(join(root, 'src', 'send-path-refusals.js'), 'utf8').match(/function advicePolicyVerdict[\s\S]*?\n\}\n/)[0];
  assert.match(rule, /\{ \.\.\.base, maximumUsd: Math\.max\(base\.maximumUsd, ceilingUsd\), figure: 'call' \}/, 'refuses on the CLI\'s expected figure, warns on the ceiling');
});
