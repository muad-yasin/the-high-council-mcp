// test/parallel-external.test.js
//
// Parallel external seats (2026-09-25, Muad's "yes" to a panel answered on his own Claude Code
// subscription). A stage that calls several seats at once (panel, proposals, debate) used to
// surface only the FIRST external pause per resume, so seven external critics cost seven resumes
// per round. settleAll now attaches every sibling pause to the one it throws, and the CLI writes
// one NEEDS file per seat. Offline, mock and external seats only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, settleAll, pendingPauses, ExternalPause, BudgetExceeded, setCache, setBudget } from '../src/chain.js';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../src/cli.js');
const EXT = lab => ({ provider: 'external', model: 'claude-code-session', lab });
const PASS = JSON.stringify({ meets: true, criteria: [], failures: [], verdict_line: 'All criteria met.' });

const panelChain = () => ({
  name: 'mock-parallel-external', maxRounds: 1, signoff: 'unanimous',
  estimate: { promptTokens: 100, draftTokens: 100, critiqueTokens: 100 },
  seats: {
    criteria: { provider: 'mock', model: 'mock-criteria' },
    builder: { provider: 'mock', model: 'mock-builder' },
    reviser: { provider: 'mock', model: 'mock-builder' },
    critics: [EXT('ea'), { provider: 'mock', model: 'mock-critic-a', lab: 'mb' }, EXT('ec')],
  },
});

test('settleAll: every sibling pause rides along on the one it throws', async () => {
  const a = new ExternalPause('panel-1-a', 's', 'u');
  const b = new ExternalPause('panel-1-b', 's', 'u');
  const c = new ExternalPause('panel-1-c', 's', 'u');
  const err = await settleAll([Promise.reject(a), Promise.resolve('ok'), Promise.reject(b), Promise.reject(c)]).catch(e => e);
  assert.equal(err, a, 'the first rejection is still the one thrown');
  assert.deepEqual(pendingPauses(err).map(p => p.label), ['panel-1-a', 'panel-1-b', 'panel-1-c']);
});

test('settleAll: a BudgetExceeded that settled first still wins, untouched', async () => {
  const stop = new BudgetExceeded({ label: 'panel-1-x', seat: 'x', spent: 1, cap: 1, projected: 2 });
  const pause = new ExternalPause('panel-1-a', 's', 'u');
  const err = await settleAll([Promise.reject(stop), Promise.reject(pause)]).catch(e => e);
  assert.equal(err, stop);
  assert.equal(err.siblings, undefined, 'no pause is attached to a budget stop');
});

test('pendingPauses: nested siblings flatten, one entry per label, the thrown pause first', () => {
  const inner = new ExternalPause('reply-b', 's', 'u');
  const b = new ExternalPause('debate-b', 's', 'u'); b.siblings = [inner];
  const a = new ExternalPause('debate-a', 's', 'u'); a.siblings = [b, new ExternalPause('debate-a', 's', 'u')];
  assert.deepEqual(pendingPauses(a).map(p => p.label), ['debate-a', 'debate-b', 'reply-b']);
  assert.deepEqual(pendingPauses(new ExternalPause('solo', 's', 'u')).map(p => p.label), ['solo']);
});

test('panel: two external critics pause together; answering both moves the run past the panel', async () => {
  const disk = new Map();
  const onStage = s => { if (!s.cached) disk.set(s.label, { text: s.text, usage: s.usage, usd: s.usd, promptHash: s.promptHash }); };
  const sit = async () => {
    setBudget(null);
    setCache({ get: l => disk.get(l) || null, invalidate: l => disk.delete(l) });
    try { return await runChain({ config: panelChain(), request: 'A mock task.', draft: 'REVISED MOCK DELIVERABLE v0', log: () => {}, onStage }); }
    catch (e) { if (e instanceof ExternalPause) return e; throw e; }
  };
  try {
    const first = await sit();
    assert.ok(first instanceof ExternalPause, 'the run pauses');
    assert.deepEqual(pendingPauses(first).map(p => p.label).sort(), ['panel-1-ea', 'panel-1-ec']);
    assert.ok(disk.has('panel-1-mb'), 'the mock sibling finished and was recorded before the pause');
    for (const p of pendingPauses(first)) disk.set(p.label, { text: PASS, usage: { input: 0, output: 0 }, usd: 0, promptHash: p.promptHash });
    const second = await sit();
    assert.ok(!(second instanceof ExternalPause), `expected the run to finish, paused at ${second?.label}`);
    assert.equal(second.passed, true, 'three passes on the same draft sign it off');
  } finally {
    setCache(null);
  }
});

test('panel: answering only one of two pauses pauses again on the other alone', async () => {
  const disk = new Map();
  const onStage = s => { if (!s.cached) disk.set(s.label, { text: s.text, usage: s.usage, usd: s.usd, promptHash: s.promptHash }); };
  const sit = async () => {
    setBudget(null);
    setCache({ get: l => disk.get(l) || null, invalidate: l => disk.delete(l) });
    try { return await runChain({ config: panelChain(), request: 'A mock task.', draft: 'REVISED MOCK DELIVERABLE v0', log: () => {}, onStage }); }
    catch (e) { if (e instanceof ExternalPause) return e; throw e; }
  };
  try {
    const first = await sit();
    const ea = pendingPauses(first).find(p => p.label === 'panel-1-ea');
    disk.set('panel-1-ea', { text: PASS, usage: { input: 0, output: 0 }, usd: 0, promptHash: ea.promptHash });
    const second = await sit();
    assert.ok(second instanceof ExternalPause);
    assert.deepEqual(pendingPauses(second).map(p => p.label), ['panel-1-ec']);
  } finally {
    setCache(null);
  }
});

test('CLI: one NEEDS file per paused seat, all listed, exit 3', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parallel-ext-'));
  mkdirSync(join(dir, 'tasks'), { recursive: true });
  mkdirSync(join(dir, 'chains'), { recursive: true });
  writeFileSync(join(dir, 'tasks', 'x.md'), 'A test task.');
  writeFileSync(join(dir, 'chains', 'mock-parallel-external.json'), JSON.stringify(panelChain(), null, 2));
  let code = 0; let out = '';
  try { out = execFileSync('node', [cli, '--task', 'tasks/x.md', '--chain', 'mock-parallel-external'], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH } }); }
  catch (e) { code = e.status; out = (e.stdout || '') + (e.stderr || ''); }
  assert.equal(code, 3, `expected an external pause:\n${out}`);
  const rd = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  for (const l of ['panel-1-ea', 'panel-1-ec']) {
    assert.ok(existsSync(join(rd, `NEEDS-${l}.md`)), `missing NEEDS-${l}.md`);
    assert.ok(existsSync(join(rd, `${l}.prompt.json`)), `missing ${l}.prompt.json`);
  }
  assert.match(out, /2 external seats are waiting/);
});
