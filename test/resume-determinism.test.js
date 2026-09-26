// A resumed run replays what it already paid for (bug audit 2026-09-26 #2 and its guard-gap list).
//
// The relay panel's order came from Math.random, and a relay reviewer's prompt holds the verdicts
// before it, so a resume that reshuffled changed those prompts: the stage cache read the finished
// panel stages as stale (`cache_stale` in WARNINGS.md) and paid for them again. The order is now
// seeded from the run id and the round.
//
// Two guards. (1) Every mock chain is run so that it pauses (its reviser made an external seat, and
// mock-external as shipped) or stops at the spend cap (mock-budget, and a relay variant with a
// priced reviser), then resumed to the end: no resume may write `cache_stale`. (2) Math.random may
// not be called in src/chain.js or src/roles.js at all; a stage's input must not depend on a coin
// toss the cache cannot replay. Offline, mock chains, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
const TASK = '# A plan\n\nPlan a small command-line tool that renames photos by the date they were taken.\n';
const EXT = { provider: 'external', model: 'claude-code-session' };

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-resume-det-'));
  mkdirSync(join(dir, 'tasks'));
  mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), TASK);
  return dir;
}
const cliRun = (dir, args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 120_000 });
const waiting = runDir => readdirSync(runDir).filter(f => /^NEEDS-.*\.md$/.test(f) && !existsSync(join(runDir, f.slice('NEEDS-'.length)))).map(f => f.slice('NEEDS-'.length, -'.md'.length));
const staleLines = runDir => {
  const p = join(runDir, 'WARNINGS.md');
  return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(l => l.includes('cache_stale')) : [];
};
// A plausible answer for an external draft stage; any other external stage gets a short note.
const answerFor = label => /^(build|revise|final)/.test(label)
  ? `# Plan\n\n## Decisions\n\nRename photos by EXIF date with a dry-run mode (${label}).\n\n## Assumptions\n\nNone.\n`
  : `Answer for ${label}.\n`;

// Runs a chain to its end, answering every external pause, and returns how many times it resumed
// and every cache_stale line any resume wrote. `first` holds extra arguments for the first sitting
// only (a low --max-usd), `resume` for every resume.
function runToEnd(dir, chainName, { first = [], resume = [] } = {}) {
  let r = cliRun(dir, ['--chain', chainName, '--task', 'tasks/t.md', ...first]);
  const runDir = join(dir, 'runs', readdirSync(join(dir, 'runs')).filter(d => !d.includes('.')).sort().pop());
  let resumes = 0;
  const log = [`start: exit ${r.status}`];
  for (let i = 0; i < 12 && (r.status === 3 || r.status === 4); i++) {
    if (r.status === 3) for (const label of waiting(runDir)) writeFileSync(join(runDir, `${label}.md`), answerFor(label));
    r = cliRun(dir, ['--resume', runDir, ...resume]);
    resumes++;
    log.push(`resume ${resumes}: exit ${r.status}`);
  }
  return { runDir, resumes, status: r.status, stale: staleLines(runDir), log, stderr: r.stderr };
}

const mockChains = readdirSync(join(root, 'chains')).filter(f => /^mock.*\.json$/.test(f)).map(f => f.slice(0, -5)).sort();

test('every mock chain, paused at an external reviser and resumed, replays its finished stages (no cache_stale)', () => {
  const dir = workspace();
  try {
    let relayResumed = 0;
    for (const name of mockChains) {
      const c = JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));
      if (!c.seats?.reviser) continue;
      const variant = `${name}-ext-reviser`;
      writeFileSync(join(dir, 'chains', `${variant}.json`), JSON.stringify({ ...c, name: variant, seats: { ...c.seats, reviser: EXT } }));
      const out = runToEnd(dir, variant, { first: ['--max-usd', '1000'] });
      assert.deepEqual(out.stale, [], `${variant}: ${out.log.join(', ')}\n${out.stale.join('\n')}`);
      assert.ok([0, 7].includes(out.status), `${variant} reaches its end: ${out.log.join(', ')}\n${out.stderr.slice(-800)}`);
      if (c.panel === 'relay') relayResumed += out.resumes;
    }
    assert.ok(relayResumed > 0, 'the relay chain paused and resumed at least once, so the relay order was replayed');
    // mock-relay has two reviewers, so a reshuffle keeps the old order half the time. Six make a
    // reshuffled resume all but certain to show up (1 in 720 to keep the order by chance).
    const relay = JSON.parse(readFileSync(join(root, 'chains', 'mock-relay.json'), 'utf8'));
    const six = [...'abcdef'].map(x => ({ provider: 'mock', model: `mock-critic-${x}`, lab: `mock-${x}` }));
    writeFileSync(join(dir, 'chains', 'relay-six.json'), JSON.stringify({ ...relay, name: 'relay-six', seats: { ...relay.seats, reviser: EXT, critics: six } }));
    const wide = runToEnd(dir, 'relay-six');
    assert.ok(wide.resumes > 0 && wide.status === 0, wide.log.join(', '));
    assert.deepEqual(wide.stale, [], wide.stale.join('\n'));
    const shipped = runToEnd(dir, 'mock-external');
    assert.ok(shipped.resumes > 0 && shipped.status === 0, shipped.log.join(', '));
    assert.deepEqual(shipped.stale, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('mock chains stopped by the spend cap and resumed with a higher one replay their finished stages (no cache_stale)', () => {
  const dir = workspace();
  try {
    const budget = runToEnd(dir, 'mock-budget', { first: ['--max-usd', '0.2'], resume: ['--max-usd', '1000'] });
    assert.ok(budget.resumes > 0 && budget.status === 0, budget.log.join(', '));
    assert.deepEqual(budget.stale, []);
    // The relay panel with a priced reviser: the cap stops the run after a relay round, before
    // its revision, and the resume replays that round.
    const relay = JSON.parse(readFileSync(join(root, 'chains', 'mock-relay.json'), 'utf8'));
    writeFileSync(join(dir, 'chains', 'relay-budget.json'), JSON.stringify({ ...relay, name: 'relay-budget', seats: { ...relay.seats, reviser: { provider: 'mock', model: 'mock-priced', maxTokens: 8000 } } }));
    const r = runToEnd(dir, 'relay-budget', { first: ['--max-usd', '1'], resume: ['--max-usd', '1000'] });
    assert.ok(r.resumes > 0 && r.status === 0, r.log.join(', '));
    assert.deepEqual(r.stale, [], r.stale.join('\n'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Math.random is not called in src/chain.js or src/roles.js', () => {
  for (const f of ['src/chain.js', 'src/roles.js']) {
    const hits = readFileSync(join(root, f), 'utf8').split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /Math\.random\s*\(/.test(l));
    assert.deepEqual(hits, [], `${f}: a stage's input must not depend on an unseeded coin toss (use a seeded helper such as seededShuffle)`);
  }
});
