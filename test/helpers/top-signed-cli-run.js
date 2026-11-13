// Test code, not shipped. One real CLI run, $0, that ends NOT AGREED although the top layer signed off: every judge a mock that signs off, the writer external, ONE overseer round. The first build check is answered not_yet; the run stops at the overseer cap ("the handler still said not yet to the plan the top layer
// signed"); the person ends it at once (--finish-now). The report's ending is signed_off_at_top_not_agreed, the stop was finished at once, nothing is open, and HANDOFF.md is written by the run's own handoff path (src/cli.js), not read through a report: the printed shape of 0.8.4 round 1's A7 legs A and B.
// The chain is a copy under its own name (ts-top; a zero-spend scanner reads a shipped chain's name as real seats): all seats mock or external, the handoff seat a mock.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerBuildChecks } from './build-check.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PRELOAD = join(repo, 'test', 'helpers', 'prompt-log-preload.js');
const writer = { provider: 'external', model: 'claude-code-session' };

export function topSignedCliRun({ name = 'ts-top' } = {}) {
  const chain = { name, selfReview: 'allowed', description: 'A test chain: every judge is a mock, the writer is external; selfReview is allowed so chain-lint never refuses the start.', signoff: 'unanimous', maxOverseerRounds: 1, layerRevisions: { 1: 1, 2: 1 }, answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2 }, handoff: true, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: writer, reviser: writer, handoff: { provider: 'mock', model: 'mock-builder', lab: 'hand' }, critics: [
      { provider: 'mock', model: 'mock-exch-support-keep-clean-tsl1', lab: 'l1', layer: 1 }, { provider: 'mock', model: 'mock-exch-support-keep-clean-tsl2', lab: 'l2', layer: 2 }, { provider: 'mock', model: 'mock-exch-support-keep-clean-tsl3', lab: 'l3', layer: 3 }] } };
  const d = mkdtempSync(join(tmpdir(), 'thc-ts-')); mkdirSync(join(d, 'chains')); mkdirSync(join(d, 'tasks'));
  writeFileSync(join(d, 'tasks', 't.md'), '# A plan\n'); writeFileSync(join(d, 'chains', `${name}.json`), JSON.stringify(chain));
  const log = join(d, 'prompts.jsonl');
  const run = args => spawnSync(process.execPath, ['--import', PRELOAD, join(repo, 'src', 'cli.js'), ...args], { cwd: d, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: d, PROMPT_LOG: log }, timeout: 120000 });
  let r = run(['--chain', name, '--task', 'tasks/t.md']);
  const RD = join(d, 'runs', readdirSync(join(d, 'runs'))[0]);
  const steps = [{ step: 'start', exit: r.status }];
  for (let i = 0; i < 8 && r.status === 3; i++) {
    const p = readdirSync(RD).filter(f => /^NEEDS-/.test(f) && !existsSync(join(RD, f.replace(/^NEEDS-/, ''))));
    const bc = p.find(f => /^NEEDS-build-check/.test(f)); const w = p.find(f => /^NEEDS-(build|revise-\d+)/.test(f));
    if (bc) answerBuildChecks(RD, { answer: 'not_yet', note: 'Name the owner.' });
    else if (w) writeFileSync(join(RD, w.replace(/^NEEDS-/, '')), `# Plan v${i}\n\nAssumptions: tea.\n`);
    else break;
    r = run(['--resume', RD]); steps.push({ step: bc ?? w, exit: r.status });
  }
  if (!existsSync(join(RD, 'report.json')) && r.status !== 0) { r = run(['--resume', RD, '--finish-now']); steps.push({ step: '--finish-now', exit: r.status }); }
  const read = f => (existsSync(join(RD, f)) ? readFileSync(join(RD, f), 'utf8') : null);
  const prompts = (read('../prompts.jsonl') ?? readFileSync(log, 'utf8')).split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return { exit: r.status, steps, report: existsSync(join(RD, 'report.json')) ? JSON.parse(read('report.json')) : null, handoffMd: read('HANDOFF.md'), handoffPrompt: prompts.find(p => p.label === 'handoff')?.user ?? null };
}
