// 0.8.1 FX-15 (owner Q2, 5 Oct 2026: a finding of a council run on a real task): the build stage did not parse DECLINED lines, so a builder's trailing
// "DECLINED: <reason>" lines stayed in the draft every critic graded and in the deliverable, and report.json's `disputes` stayed empty. Only the reviser
// stages ran parseDisputes. The same raw builder text is read back as a draft by `--from-run` (src/cli.js, twice) and by `council handoff --from-run`
// (src/handoff-from-run.js); all readers go through one function now (src/draft-disputes.js), and a source scan keeps a fourth from skipping it.
// The fixture keeps only the SHAPE of the run-2 leak (a plan body, then trailing DECLINED lines); none of that run's text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, setBudget, setCache } from '../src/chain.js';
import { pickDraft } from '../src/handoff-from-run.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = '# Plan\n\nDo the thing, in this order.\n\nDECLINED: the shape objection is a matter of taste, not a defect\nDECLINED: the added scope was not asked for\n';
const external = { provider: 'external', model: 'claude-code-session' };
const cfg = () => ({ name: 'fx15', maxRounds: 1, criteria: ['It exists.'], seats: { builder: external, reviser: { provider: 'mock', model: 'mock-builder' }, critics: [{ provider: 'mock', model: 'mock-critic-a' }] } });
const cacheOf = text => ({ get: l => (l === 'build' ? { text, provider: 'external', model: 'claude-code-session', usage: { input: 0, output: 0 }, usd: 0, ms: 0 } : null), warn() {}, invalidate() {} });

test('a builder reply that ends in DECLINED lines: the draft and the deliverable are clean, and the lines are recorded in report.json disputes with round "build"', async () => {
  setBudget(null);
  const run = async () => { setCache(cacheOf(BUILD)); return runChain({ request: 'Req.', config: cfg(), log: () => {} }); };
  const r = await run();
  assert.doesNotMatch(r.deliverable, /DECLINED/, 'the deliverable a critic graded and the file a person reads');
  assert.match(r.deliverable, /Do the thing, in this order\./);
  assert.deepEqual(r.disputes.filter(d => d.round === 'build').map(d => d.reason), ['the shape objection is a matter of taste, not a defect', 'the added scope was not asked for']);
  // A replayed build stage (a resume) parses identically: same deliverable, same disputes.
  const again = await run();
  assert.equal(again.deliverable, r.deliverable);
  assert.deepEqual(again.disputes, r.disputes);
  setCache(null);
});

test('a builder reply made only of DECLINED lines is no draft: the run stops loudly instead of panel-grading an empty page', async () => {
  setBudget(null);
  setCache(cacheOf('DECLINED: nothing here is a defect\nDECLINED: so I wrote nothing\n'));
  await assert.rejects(() => runChain({ request: 'Req.', config: cfg(), log: () => {} }), /DECLINED|no draft|nothing/i);
  setCache(null);
});

test('council handoff --from-run picks a draft with the DECLINED lines of a builder (or reviser) stage file removed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-fx15-'));
  writeFileSync(join(dir, 'build.md'), BUILD);
  const picked = pickDraft(dir);
  assert.equal(picked.name, 'build.md');
  assert.doesNotMatch(picked.text, /DECLINED/);
  assert.match(picked.text, /Do the thing, in this order\./);
  writeFileSync(join(dir, 'revise-1.md'), '# Plan v2\n\nBetter.\n\nDECLINED: taste\n');
  const second = pickDraft(dir);
  assert.equal(second.name, 'revise-1.md');
  assert.doesNotMatch(second.text, /DECLINED/);
});

test('pickDraft strips only the raw stage files: deliverable.md and final.md come back as they are (a plan that ends in a "Disputed points" section keeps it)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-fx15-keep-'));
  const finished = '# Plan\n\nBody.\n\n## Disputed points\n\nThe team disagrees about the order.\n\nDECLINED: this line is plan text, not a dispute\n';
  writeFileSync(join(dir, 'deliverable.md'), finished);
  assert.deepEqual(pickDraft(dir), { name: 'deliverable.md', text: finished });
  const dir2 = mkdtempSync(join(tmpdir(), 'thc-fx15-keep2-'));
  writeFileSync(join(dir2, 'final.md'), finished);
  assert.deepEqual(pickDraft(dir2), { name: 'final.md', text: finished });
});

// The scan: every CODE line (per occurrence, recursive over src/) that reads a builder's or reviser's stage file (build.md, revise-N.md) as a draft must call
// stripDeclined / readModelDraft in the same expression. `unguardedReads` is exported-by-copy here so a planted line can prove it fails.
export function unguardedReads(source) {
  return source.split('\n').map((line, i) => ({ line, n: i + 1 })).filter(({ line }) => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return false;
    const names = /build\.md|revise-(\d+|\$\{|`)|revise-N/.test(line);
    const reads = /readFileSync|readRequired|\bread\(/.test(line);
    return names && reads && !/stripDeclined|readModelDraft/.test(line);
  }).map(x => x.n);
}

test('source scan: every read of build.md / a revise-N.md in src/ (recursively, line by line) goes through the shared function; a planted unguarded read is caught', () => {
  assert.deepEqual(unguardedReads("const d = readFileSync(join(dir, 'build.md'), 'utf8');"), [1], 'the scan catches a planted unguarded read');
  assert.deepEqual(unguardedReads("const d = readFileSync(join(dir, `revise-${n}.md`), 'utf8');"), [1], 'and a revise-N read in a template string');
  assert.deepEqual(unguardedReads("const d = readModelDraft(join(dir, 'build.md'));"), []);
  assert.deepEqual(unguardedReads("// readFileSync(join(dir, 'build.md'))"), [], 'comments are not code');
  const offenders = [];
  for (const f of readdirSync(join(root, 'src'), { recursive: true }).filter(f => f.endsWith('.js'))) {
    for (const n of unguardedReads(readFileSync(join(root, 'src', f), 'utf8'))) offenders.push(`src/${f}:${n}`);
  }
  assert.deepEqual(offenders, []);
  // pickDraft reads its candidates through one `read(join(runDir, name))` line; that line has no name literal, so it is checked on its own.
  assert.match(readFileSync(join(root, 'src', 'handoff-from-run.js'), 'utf8'), /stripDeclined\(raw\)/);
  assert.ok(readFileSync(join(root, 'src', 'draft-disputes.js'), 'utf8').includes('export function parseDisputes'), 'parseDisputes lives in the shared module');
});

test('--from-run (the first reader in src/cli.js): the draft handed to a panel-only pass has no DECLINED lines (offline mock run, $0)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-fx15-cli-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a tiny thing.\n');
  writeFileSync(join(dir, 'chains', 'fx.json'), JSON.stringify({ name: 'fx', maxRounds: 1, seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' }, critics: [{ provider: 'mock', model: 'mock-critic-a' }] } }));
  const env = { ...process.env }; for (const k of Object.keys(env)) if (/API_KEY/.test(k)) delete env[k];
  const cli = join(root, 'src', 'cli.js');
  execFileSync('node', [cli, '--task', 'tasks/t.md', '--chain', 'fx'], { cwd: dir, env, encoding: 'utf8', stdio: 'pipe' });
  const first = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  appendFileSync(join(first, 'build.md'), '\nDECLINED: leaked one\nDECLINED: leaked two\n');
  execFileSync('node', [cli, '--task', 'tasks/t.md', '--from-run', first, '--rounds', '1', '--chain', 'fx'], { cwd: dir, env, encoding: 'utf8', stdio: 'pipe' });
  const second = join(dir, 'runs', readdirSync(join(dir, 'runs')).filter(d => join(dir, 'runs', d) !== first).sort().pop());
  const deliverable = readFileSync(join(second, 'deliverable.md'), 'utf8');
  assert.match(deliverable, /MOCK DELIVERABLE/, 'fixture: the handed draft is what the panel pass shipped');
  assert.doesNotMatch(deliverable, /DECLINED/);
});
