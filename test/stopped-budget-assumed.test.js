// Cost-unit U1 split (C&C ruling, 14 Oct 2026): when a resume replays a stage whose usage record has NO figure, the cap counts one attempt's worst case, but STOPPED-budget.json's spentUsd is the RECORDED spend (the folder's total, what
// --spend reads), and the worst-case part is its own additive value. A stage of the stopped run loses its recorded cost on disk (the usage file is trusted otherwise: fingerprint and prompt hash intact), so every resume replays it and charges the worst case again. FX-2 (test/regression-081-handoff-resume-cap.test.js, a hand-placed draft that replays as STALE) passes UNCHANGED. Offline: the mock-budget chain's priced mock seats.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSpentUsd } from '../src/spend.js';
import { runResumability } from '../src/run-status.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const RUN = '2026-10-14T12-00-00-000Z';
const run = (dir, args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 });

test('a resume that replays a stage whose usage record lost its cost stops on the cap, reports the recorded spend, and names the worst-case part as its own value', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-assumed-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n');
  assert.equal(run(dir, ['--chain', 'mock-budget', '--task', 'tasks/t.md', '--max-usd', '1', '--run-id', RUN]).status, 4);
  const rd = join(dir, 'runs', RUN);
  const usageFile = join(rd, 'criteria.usage.json');
  const record = JSON.parse(readFileSync(usageFile, 'utf8'));
  assert.ok(record.usd > 0, 'fixture: the stage the first run paid for recorded a cost');
  delete record.usd;                                                                   // the figure is lost; the rest of the record (fingerprint, prompt hash) is intact, so the replay is trusted
  writeFileSync(usageFile, JSON.stringify(record));
  const before = runSpentUsd(rd);
  const r = run(dir, ['--resume', join('runs', RUN), '--max-usd', String(before + 1e-6)]);
  assert.equal(r.status, 4, r.stdout + r.stderr);
  const stopped = JSON.parse(readFileSync(join(rd, 'STOPPED-budget.json'), 'utf8'));
  assert.ok(Math.abs(stopped.spentUsd - runSpentUsd(rd)) < 1e-6, `spentUsd is the folder's total: stop says ${stopped.spentUsd}, folder holds ${runSpentUsd(rd)}`);
  assert.equal(stopped.assumedAtWorstCase?.replayedStages, 1, 'one replayed stage was charged at its worst case');
  assert.ok(stopped.assumedAtWorstCase?.usd > 0, `the worst-case part is named separately (${stopped.assumedAtWorstCase?.usd})`);
  // The printed way out must not loop: STOPPED-budget.md's resume command carries a ceiling above the worst case the cap already counted, so following it gets past this stage (a later stage may stop it again; the same one must not).
  // The sentences that say "spent" carry the RECORDED figure, not a projection (C&C 14 Oct 2026): the stop's .md and its log line.
  const md = readFileSync(join(rd, 'STOPPED-budget.md'), 'utf8');
  const shown = s => Number((s.match(/(?:spent so far: \*\*|spent:\s+)\$([0-9.]+)/) || [])[1]);
  assert.ok(Math.abs(shown(md) - stopped.spentUsd) < 1e-4, `STOPPED-budget.md says spent ${shown(md)}, the record holds ${stopped.spentUsd}`);
  assert.ok(Math.abs(shown(r.stdout + r.stderr) - stopped.spentUsd) < 1e-4, `the stop's log line says spent ${shown(r.stdout + r.stderr)}, the record holds ${stopped.spentUsd}`);
  const chainLine = (r.stdout + r.stderr).match(/STOPPED - \$([0-9.]+) spent/);
  assert.ok(chainLine && Math.abs(Number(chainLine[1]) - stopped.spentUsd) < 1e-4, `the budget check's own line says spent ${chainLine?.[1]}, the record holds ${stopped.spentUsd}`);
  // run_status's guidance (the MCP twin of the printed command) carries the same ceiling.
  const status = runResumability(rd, JSON.parse(readFileSync(join(rd, 'run.json'), 'utf8')));
  assert.equal(status.needs, 'higher_cap');
  const printed = readFileSync(join(rd, 'STOPPED-budget.md'), 'utf8').match(/--resume runs\/\S+ --max-usd ([0-9.]+)/);
  assert.ok(printed, 'the stop prints a resume command');
  assert.ok(Number(printed[1]) > stopped.assumedAtWorstCase.usd, `the printed ceiling ${printed[1]} is above the worst case already counted (${stopped.assumedAtWorstCase.usd})`);
  assert.equal(status.suggestedMaxUsd, Number(printed[1]), 'run_status suggests the ceiling the printed command carries');
  const again = run(dir, ['--resume', join('runs', RUN), '--max-usd', printed[1]]);
  const stoppedAgain = (() => { try { return JSON.parse(readFileSync(join(rd, 'STOPPED-budget.json'), 'utf8')); } catch { return null; } })();
  assert.ok(again.status !== 4 || stoppedAgain?.stoppedAt !== stopped.stoppedAt, `following the printed command must get past stage ${stopped.stoppedAt}: exit ${again.status}, stopped at ${stoppedAgain?.stoppedAt}`);
});
