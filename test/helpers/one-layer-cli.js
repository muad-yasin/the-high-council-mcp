// The REAL-VERB twin of test/helpers/one-layer-stated-pass.js (0.8.4 apply, C&C ruling 12 Nov 2026, part 3; printed in job 136): a ONE-layer chain with `freedoms: { pass: true }`, seat-a a scripted mock judge that signs off, seat-b an EXTERNAL judge (so a session answers it by hand),
// the handler an external reviser. The CLI pauses at build, panel-1-seat-b, build-check-1, final-read-seat-b and handoff; each pause is answered by writing <label>.md in the run folder and resuming. The verdict envelope is ON in a real CLI run: an answer to a judge echoes the review_id and
// draft_id its NEEDS prompt shows. `kind` is what seat-b's final read says: 'OBJ' (a rated-5 failure) or 'CLR' (no objection). Returns { status, stdout, stderr, runDir, report } of the last spawn. Offline, $0. Not a test file.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { malformedProviderKeys } from './no-real-keys.js';
import { answer as buildAnswer } from './build-check.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cli = join(root, 'src', 'cli.js');
const CRITERIA = ['The deliverable is the artifact itself, not a plan for one.', 'It states the assumptions it was written under.', 'It adds no scope the request did not ask for.'];
const PLAN = 'The worker retries failed requests, at most three times.';
const IDS = /review_id "([^"]+)" and draft_id "([^"]+)"/;
const ext = model => ({ provider: 'external', model });

const chainFile = name => ({ name, description: 'one layer, a stated pass, an external seat-b', summary: 'one-layer stated pass', maxRounds: 3, signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2 }, freedoms: { pass: true }, handoff: true,
  estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: ext('claude-code-session'), reviser: ext('claude-code-session'), handoff: ext('claude-code-session'),
    critics: [{ provider: 'mock', model: 'mock-critic-script-o-clioneA', lab: 'seat-a', layer: 1, maxTokens: 3000 }, { provider: 'external', model: 'second-opinion-session', lab: 'seat-b', layer: 1, maxTokens: 3000 }] } });

function answerFor(label, needs, kind, runDir) {
  let ids = IDS.exec(needs);
  if (!ids && existsSync(join(runDir, `${label}.envelope.json`))) { const e = JSON.parse(readFileSync(join(runDir, `${label}.envelope.json`), 'utf8')); ids = [null, e.review_id, e.draft_id]; }
  const env = ids ? { review_id: ids[1], draft_id: ids[2] } : {};
  const shown = CRITERIA.filter(c => needs.includes(c)); const list = shown.length ? shown : CRITERIA;
  if (label === 'build') return PLAN + '\n';
  if (label === 'panel-1-seat-b') return JSON.stringify({ pass: true, pass_reason: 'Nothing to object to.', ...env });
  if (label === 'build-check-1') return buildAnswer('good_to_build', '');
  if (label === 'final-read-seat-b') {
    const rows = list.map(c => ({ criterion: c, verdict: kind === 'OBJ' && c === list[0] ? 'FAILED' : 'MET', evidence: 'Read in the plan.' }));
    const body = kind === 'OBJ' ? { meets: false, criteria: rows, failures: [{ criterion: list[0], problem: 'No retry limit is specified.', fix: 'Specify one.', quote: 'retries failed requests', severity: 5, relation: 'new' }], verdict_line: 'no limit' } : { meets: true, criteria: rows, failures: [], verdict_line: 'ok' };
    return JSON.stringify({ ...body, ...env });
  }
  if (label === 'handoff') return 'HANDOFF\n\nRead PLAN.md.\n';
  return null;
}

export function oneLayerCli(kind) {
  const dir = mkdtempSync(join(tmpdir(), `one-layer-cli-${kind}-`)); mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  const name = `one-layer-${kind.toLowerCase()}`;
  writeFileSync(join(dir, 'tasks', 'x.md'), 'Write a one-paragraph plan for a worker that retries failed requests.\n');
  writeFileSync(join(dir, 'chains', `${name}.json`), JSON.stringify(chainFile(name), null, 2));
  const run = args => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', timeout: 120_000, env: { PATH: process.env.PATH, HOME: dir, ...malformedProviderKeys() } });
  let r = run(['--chain', name, '--task', 'tasks/x.md', '--max-usd', '1']);
  let runDir = null;
  for (let i = 0; i < 14 && r.status === 3; i++) {
    runDir = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
    const pending = readdirSync(runDir).filter(f => /^NEEDS-.*\.md$/.test(f) && !existsSync(join(runDir, f.replace(/^NEEDS-/, ''))));
    let answered = 0;
    for (const f of pending) {
      const label = f.replace(/^NEEDS-/, '').replace(/\.md$/, ''); const text = answerFor(label, readFileSync(join(runDir, f), 'utf8'), kind, runDir);
      if (text !== null) { writeFileSync(join(runDir, `${label}.md`), text); answered++; }
    }
    if (!answered) break;
    r = run(['--resume', runDir]);
  }
  runDir = runDir ?? (existsSync(join(dir, 'runs')) ? join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]) : null);
  const reportPath = runDir ? join(runDir, 'report.json') : null;
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', runDir, report: reportPath && existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null };
}
