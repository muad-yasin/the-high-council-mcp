// A resume after the chain or the task changed (0.8.4, the ladder unit): the finished steps made under the earlier chain or task are asked again where the run reaches them, and the ones that bill are paid again, with what they cost before still counted. The
// limit screen says so before a person types a limit; a resume with no limit screen says it in one line in the run log. The numbers are a COUNT of what was made under the earlier chain or task, never a promise about the path. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapScreen } from '../src/cap-screen.js';
const { staleFinishedStages, staleNoticeLine } = await import('../src/stale-stages.js').catch(() => ({}));   // a dynamic import, so a tree without the module fails at the assertions below, not at load

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUN = { kind: 'amend', subject: { chain: 'plan-premium-7', task: 'tasks/x.md' }, estimate: { usd: 2.5, scope: 'this run' }, maximum: { usd: 6.2 }, ceilings: [] };
const hist = rerun => ({ previousCapUsd: 5, spentUsd: 3, floorUsd: 3, changed: ['the chain file'], ...(rerun ? { rerun } : {}) });
const R = (n, paid, usd = 0, unrecorded = 0, ladder = false) => ({ n, paid, usd, unrecorded, ladder });

test('RC-1: the amend screen says, before the limit is typed, how many finished steps were made under the earlier chain or task, that each one the run reaches again is asked again, and that only the ones that bill are paid again with their old cost still counted; no such step, no sentence', () => {
  const many = buildCapScreen({ ...RUN, history: hist(R(3, 2, 0.42)) }).text;
  assert.match(many, /3 finished steps of this run were made under the earlier chain or task: each one the run reaches again is asked again\. The 2 paid steps are paid again if asked again, and what they cost before \(\$0\.4200\) still counts toward the limit\./);
  const one = buildCapScreen({ ...RUN, history: hist(R(1, 1, 0.1)) }).text;
  assert.match(one, /1 finished step of this run was made under the earlier chain or task: if the run reaches it again, it is asked again\. The paid step is paid again if asked again, and what it cost before \(\$0\.1000\) still counts toward the limit\./);
  const free = buildCapScreen({ ...RUN, history: hist(R(4, 0)) }).text;
  assert.match(free, /4 finished steps of this run were made under the earlier chain or task: each one the run reaches again is asked again\./);
  assert.doesNotMatch(free, /paid again/, 'steps that cost nothing are not "paid again"');
  assert.doesNotMatch(buildCapScreen({ ...RUN, history: hist(R(0, 0)) }).text, /finished step/, 'the swapped input: no step made under the earlier chain, no sentence');
  assert.doesNotMatch(buildCapScreen({ ...RUN, history: hist(null) }).text, /finished step/, 'a screen built without the count is as it always was');
  const noCost = buildCapScreen({ ...RUN, history: hist(R(2, 2, 0.1, 1)) }).text;
  assert.match(noCost, /what they cost before \(\$0\.1000, plus one call's worst case for the 1 step with no cost on record\) still counts toward the limit\./, 'a paid step with no cost on record is named, not priced at 0');
  assert.match(buildCapScreen({ ...RUN, history: hist(R(2, 2, 0, 2)) }).text, /\(one call's worst case for each of the 2 steps with no cost on record\)/);
  const ladder = buildCapScreen({ ...RUN, history: hist(R(0, 0, 0, 0, true)) }).text;
  assert.match(ladder, /This chain now runs the ladder from its key: every finished step that answered a different prompt is asked again, the ones that bill are paid again, and what they cost before still counts toward the limit\./);
  const limited = buildCapScreen({ ...RUN, history: hist({ ...R(3, 2, 0.42), limit: 'openrouter' }) }).text;
  assert.match(limited, /3 finished steps of this run were made under the earlier chain or task: each one the run reaches again is asked again\. Of these, 2 bill through the openrouter limit and are paid again if asked again, and what they cost there before \(\$0\.4200\) still counts toward the openrouter limit\./);
  assert.match(buildCapScreen({ ...RUN, history: hist({ ...R(1, 1, 0.1), limit: 'anthropic' }) }).text, /Of these, 1 bills through the anthropic limit and is paid again if asked again, and what it cost there before \(\$0\.1000\) still counts toward the anthropic limit\./);
  assert.match(buildCapScreen({ ...RUN, history: hist({ ...R(2, 0), limit: 'anthropic' }) }).text, /None of these bills through the anthropic limit\./);
  assert.match(many, /Changed since the limit for this run was typed: the chain file\./, 'the lines that were there stay');
});

test('RC-2: staleFinishedStages counts the finished steps recorded under another fingerprint (an external answer\'s record is its prompt.json), those of them that bill, and their recorded cost; a paid step with no usable cost is counted apart; nothing else is counted', () => {
  assert.equal(typeof staleFinishedStages, 'function');
  const dir = mkdtempSync(join(tmpdir(), 'rc-stale-'));
  try {
    const stage = (label, fp, usd, provider, text = true) => { writeFileSync(join(dir, `${label}.usage.json`), JSON.stringify({ inputsFingerprint: fp, ...(usd === undefined ? {} : { usd }), provider })); if (text) writeFileSync(join(dir, `${label}.md`), 'x'); };
    stage('criteria', 'old', 0.1, 'openrouter'); stage('skeleton', 'old', 0.2, 'openrouter'); stage('draft', 'old', 0, 'mock');
    writeFileSync(join(dir, 'build.prompt.json'), JSON.stringify({ inputsFingerprint: 'old' })); writeFileSync(join(dir, 'build.md'), 'x');
    stage('handoff', 'now', 0.3, 'openrouter'); stage('orphan', 'old', 0.4, 'openrouter', false); writeFileSync(join(dir, 'revise-1.usage.json'), '{ not json'); writeFileSync(join(dir, 'revise-1.md'), 'x');
    const r = staleFinishedStages(dir, 'now');
    assert.deepEqual([r.n, r.paid, r.unrecorded], [4, 2, 0], 'criteria, skeleton, the mock draft and the external build answer; two of them bill');
    assert.ok(Math.abs(r.usd - 0.3) < 1e-9);
    assert.deepEqual(staleFinishedStages(join(dir, 'missing'), 'now'), { n: 0, paid: 0, usd: 0, unrecorded: 0 });
    stage('paid-no-cost', 'old', undefined, 'openrouter'); stage('free-no-cost', 'old', undefined, 'mock');
    const after = staleFinishedStages(dir, 'now');
    assert.deepEqual([after.n, after.paid, after.unrecorded], [6, 3, 1], 'a paid stage with no usable cost is counted apart; a free one with none is not');
    // two per-provider limits (the stage records name the limit they billed through: capName, else the provider): each limit's screen carries the steps billed through it; n counts them all
    const two = mkdtempSync(join(tmpdir(), 'rc-caps-'));
    try {
      const capped = (label, provider, capName, usd) => { writeFileSync(join(two, `${label}.usage.json`), JSON.stringify({ inputsFingerprint: 'old', provider, capName, usd })); writeFileSync(join(two, `${label}.md`), 'x'); };
      capped('a', 'anthropic', 'anthropic', 0.5); capped('b', 'openrouter', 'openrouter', 0.2); capped('c', 'openrouter', undefined, 0.1); capped('d', 'mock', undefined, 0);
      const anth = staleFinishedStages(two, 'now', { capName: 'anthropic' }); const orx = staleFinishedStages(two, 'now', { capName: 'openrouter' });
      assert.deepEqual([anth.n, anth.paid, anth.usd], [4, 1, 0.5]);
      assert.deepEqual([orx.n, orx.paid], [4, 1], 'a record that names no limit is in n and in no limit\'s figure (caps.js recordedCapOf; the other readers of such a record are named in its comment)'); assert.ok(Math.abs(orx.usd - 0.2) < 1e-9);
      assert.deepEqual([staleFinishedStages(two, 'now').paid], [3], 'with no limit named, all three paid steps');
    } finally { rmSync(two, { recursive: true, force: true }); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('RC-3: a chain with no limit screen (an external writer): after the chain file changed, the resume prints ONE line in the run log, before the first step is asked again, and its number is the number of steps the resume then asks again; with the chain unchanged it prints none', () => {
  const mk = id => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-gate-'));
    mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
    const writer = { provider: 'external', model: 'claude-code-session' };
    const chain = rounds => ({ name: 'lad', signoff: 'unanimous', maxRounds: rounds, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 }, seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: writer, reviser: writer, critics: [{ provider: 'mock', model: `mock-critic-script-x-${id}`, lab: 'l1' }] } });
    writeFileSync(join(dir, 'chains', 'lad.json'), JSON.stringify(chain(2)));
    const run = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
    return { dir, run, runDir: () => join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]), change: () => writeFileSync(join(dir, 'chains', 'lad.json'), JSON.stringify({ ...chain(2), estimate: { promptTokens: 600, draftTokens: 500, critiqueTokens: 200 } })) };   // FINDING (not on the owed list of the ladder unit; found by the box set, 10 Nov 2026). OLD bar: the edit was maxRounds 2 -> 3. NEW bar: an edit of the chain's `estimate` block. WHY: a resume restores the run's saved round limit before the fingerprint is taken (LAD-R4: the saved rounds win), so a maxRounds edit never changes the fingerprint and no step reads as stale; `estimate` is part of the fingerprint (src/cache-integrity.js strips only summary, ladder, seat price limits and the host-block entry).
  };
  const changed = mk('v'); const same = mk('w');
  try {
    for (const p of [changed, same]) assert.equal(p.run(['--chain', 'lad', '--task', 'tasks/t.md']).status, 3);
    changed.change();
    const r = changed.run(['--resume', changed.runDir()]);
    const lines = r.stdout.split('\n').filter(l => /^The chain or the task changed since this run's steps were made\. \d+ finished steps? of this run (was|were) made under the earlier chain or task: /.test(l));
    assert.equal(lines.length, 1, r.stdout + r.stderr);
    const said = Number(/\. (\d+) finished step/.exec(lines[0])[1]);
    const log = readFileSync(join(changed.runDir(), 'run.log'), 'utf8');
    assert.ok(log.indexOf(lines[0]) < log.indexOf('CACHE STALENESS WARNING'), 'said before the first step is asked again');
    assert.equal((log.match(/CACHE STALENESS WARNING: stage /g) ?? []).length, said, 'the number said is the number of steps the resume then asks again');
    assert.doesNotMatch(same.run(['--resume', same.runDir()]).stdout, /The chain or the task changed since/);
  } finally { rmSync(changed.dir, { recursive: true, force: true }); rmSync(same.dir, { recursive: true, force: true }); }
});

test('RC-4: the one line: free steps only say they are asked again; with paid steps it adds that they are paid again and that the old cost still counts, with the figure or the one-call worst case named', () => {
  assert.equal(typeof staleNoticeLine, 'function');
  assert.equal(staleNoticeLine(R(3, 0)), "The chain or the task changed since this run's steps were made. 3 finished steps of this run were made under the earlier chain or task: each one the run reaches again is asked again.");
  assert.equal(staleNoticeLine(R(1, 0)), "The chain or the task changed since this run's steps were made. 1 finished step of this run was made under the earlier chain or task: if the run reaches it again, it is asked again.");
  assert.match(staleNoticeLine(R(3, 2, 0.5)), /The 2 paid steps are paid again if asked again, and what they cost before \(\$0\.5000\) still counts toward the limit\.$/);
});
