// report-partial.json when the spend cap stops a run at one of its first stages (bug audit
// 2026-09-26 #5). The partial snapshot read `kindsOn` directly, and `kindsOn` is declared with the
// criteria stage, so a stop at the ambiguity or questions stage hit its temporal dead zone; runChain
// swallowed that throw and the CLI wrote no report-partial.json. The cap is tripped here at each
// early stage in turn, with criteria kinds off and on. Offline: mock/mock-priced fixture prices, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, setBudget, setCache, BudgetExceeded } from '../src/chain.js';
import { PARTIAL_REPORT_FILE } from '../src/report-shape.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const PRICED = { provider: 'mock', model: 'mock-priced', maxTokens: 8000, lab: 'priced' };
const m = (model, lab) => ({ provider: 'mock', model, ...(lab ? { lab } : {}) });
const base = () => ({
  name: 'early-stop', maxRounds: 1, signoff: 'unanimous',
  seats: { criteria: m('mock-criteria'), builder: m('mock-builder'), reviser: m('mock-builder'), critics: [m('mock-critic-a', 'mock-a'), m('mock-critic-b', 'mock-b')] },
});
const STAGES = {
  ambiguity: c => ({ ...c, ambiguity_union: { enabled: true }, seats: { ...c.seats, ambiguity: [PRICED] } }),
  questions: c => ({ ...c, questions: { max: 3 }, seats: { ...c.seats, questions: PRICED } }),
  criteria: c => ({ ...c, seats: { ...c.seats, criteria: PRICED } }),
  proposals: c => ({ ...c, proposals: { parts: 2, maxTokens: 400 }, seats: { ...c.seats, proposers: [{ ...PRICED, lab: 'p-a' }, { ...PRICED, model: 'mock-priced', lab: 'p-b' }] } }),
};

for (const [stage, shape] of Object.entries(STAGES)) {
  for (const kinds of [false, true]) {
    test(`a cap stop at the ${stage} stage (criteria kinds ${kinds ? 'on' : 'off'}) carries the run so far`, async () => {
      let config = shape(base());
      if (kinds) config = { ...config, criteria_kinds: { enabled: true } };
      setCache(null); setBudget(0.001);
      try {
        const err = await runChain({ request: 'Plan a small offline notes tool.', config, log: () => {} }).catch(e => e);
        assert.ok(err instanceof BudgetExceeded, `expected the cap to stop the run, got ${err?.message ?? err}`);
        assert.ok(err.partial && typeof err.partial === 'object', 'err.partial is set, so the CLI writes report-partial.json');
        assert.ok(Array.isArray(err.partial.stages));
      } finally { setBudget(null); }
    });
  }
}

test('CLI: a run the cap stops at the questions stage writes report-partial.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-partial-early-'));
  try {
    mkdirSync(join(dir, 'tasks'));
    mkdirSync(join(dir, 'chains'));
    writeFileSync(join(dir, 'tasks', 'x.md'), 'Plan a small offline tool that keeps a list of notes.');
    writeFileSync(join(dir, 'chains', 'early-stop.json'), JSON.stringify({ ...STAGES.questions(base()), description: 'test', criteria_kinds: { enabled: true } }));
    const r = spawnSync(process.execPath, [cli, '--chain', 'early-stop', '--task', 'tasks/x.md', '--max-usd', '0.001'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 });
    assert.equal(r.status, 4, r.stderr);
    const runDir = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
    assert.ok(existsSync(join(runDir, PARTIAL_REPORT_FILE)), `no ${PARTIAL_REPORT_FILE}: ${readdirSync(runDir).join(', ')}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
