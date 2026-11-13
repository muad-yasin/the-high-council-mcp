// 0.8.4 D14 (plan A T7.3; WORDING U2-w1): THE PROBE of unit 2 - the real command, no hand-written record. A run pauses at an external judge (exit 3); the judge's verdict is written as its answer file: a failure with a quote taken
// from the draft the judge was shown, and a FAILED table row whose evidence quotes that passage and one invented sentence; the resume finishes the run, and report.json (read from disk, validated against the published schema) carries
// lastCritique.failures[].spans: the quote located in the draft, the invented sentence null. Offline, $0 (mock builder, an external judge answered by the test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const CRITERION = 'It names an owner for every step.';
const schema = JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
const validate = ajv.compile(schema);

test('PROBE: a real run, an external judge that quotes the draft and invents a sentence: report.json carries the spans, located in the draft and in none, and validates against the schema', t => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-spans-'));
  try {
    mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
    writeFileSync(join(dir, 'tasks', 'x.md'), 'Plan a tea service for twelve guests.\n');
    const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
    writeFileSync(join(dir, 'chains', 'probe-spans.json'), JSON.stringify({ ...base, name: 'probe-spans', maxRounds: 1, signoff: 'unanimous', criteria: [CRITERION], seats: { ...base.seats, critics: [{ provider: 'external', model: 'claude-code-session', lab: 'e1' }] } }));
    const run = args => spawnSync('node', [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 120_000 });
    const first = run(['--chain', 'probe-spans', '--task', 'tasks/x.md']);
    assert.equal(first.status, 3, `${first.stdout.slice(-300)}${first.stderr.slice(-300)}`);
    const runDir = join(dir, 'runs', readdirSync(join(dir, 'runs')).filter(d => !d.includes('.'))[0]);
    assert.ok(existsSync(join(runDir, 'NEEDS-panel-1-e1.md')), readdirSync(runDir).join(', '));
    // a passage of the draft the judge was shown: 30 characters of its first plain run of letters, digits, spaces, commas and full stops (a contiguous piece of the draft, no quote mark or emphasis character in it)
    const draft = readFileSync(join(runDir, 'build.md'), 'utf8');
    const run0 = /[A-Za-z][A-Za-z0-9 ,.]{29,}/.exec(draft)?.[0];
    assert.ok(run0, `a plain run of 30 characters in the draft: ${draft.slice(0, 200)}`);
    const frag = run0.slice(0, 30).trim();
    assert.ok(draft.includes(frag), 'the passage is in the draft as it is');
    const invented = 'an invented sentence that is not there';
    // the Reply identity of the prompt (recorded wording, 0.8.3): the reply must carry the pair the prompt issued, or it is unreadable and the judge is asked again
    const needs = readFileSync(join(runDir, 'NEEDS-panel-1-e1.md'), 'utf8');
    const ids = /review_id "([^"]+)" and draft_id "([^"]+)"/.exec(needs);
    assert.ok(ids, `the prompt names its reply identity: ${needs.slice(-300)}`);
    writeFileSync(join(runDir, 'panel-1-e1.md'), JSON.stringify({ review_id: ids[1], draft_id: ids[2], meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: `The plan says "${frag}" and also "${invented}".` }], failures: [{ criterion: CRITERION, problem: 'No step names an owner.', fix: 'Name one.', quote: frag }], verdict_line: 'no' }));
    const second = run(['--resume', runDir]);
    const logTail = existsSync(join(runDir, 'run.log')) ? readFileSync(join(runDir, 'run.log'), 'utf8').split('\n').filter(l => /no usable verdict|re-asking|identity|PAUSED/.test(l)).slice(-6).join(' | ') : '(no run.log)';
    assert.notEqual(second.status, 3, `the run goes on past the judge (run.log: ${logTail}): ${second.stdout.slice(-400)}${second.stderr.slice(-300)}`);
    const reportPath = join(runDir, 'report.json');
    assert.ok(existsSync(reportPath), `exit ${second.status}: ${readdirSync(runDir).join(', ')} ${second.stdout.slice(-300)}`);
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    assert.equal(validate(report), true, JSON.stringify(validate.errors?.slice(0, 3)));
    const f = (report.lastCritique?.failures ?? []).find(x => x.quote === frag);
    assert.ok(f, `the objection is on the record: ${JSON.stringify(report.lastCritique?.failures ?? []).slice(0, 300)}`);
    t.diagnostic(`PROBE OUTPUT: first run exit ${first.status}, resume exit ${second.status}, quote ${JSON.stringify(frag)}, spans ${JSON.stringify(f.spans ?? null)}, quote_status ${JSON.stringify(f.quote_status ?? null)}`);
    assert.deepEqual((f.spans ?? []).map(s => [s.text, s.located_in]), [[frag, 'draft'], [invented, null]]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
