// Test code, not shipped. One real run of the ladder chain through the real CLI, $0, that ends EARLY at the session's proposal (0.8.4 round 1: the held fixes for the early finish). The chain is the shipped chains/plan-mini-council.json
// under its own name (a zero-spend scanner reads a shipped chain's name as a chain with real seats), prompt_cache and `extra` removed, every seat a mock except the writer and the reviser (external: this helper answers their pauses).
// Departures from the shipped chain: proposers mock-proposer-a/b, criteria mock-criteria, skeleton mock-skeleton, handoff and decider mock-builder, every critic a mock whose model `critic(layer)` names.
// The path: the panel signs off or objects as the critics say; the FIRST build check is answered not_yet (the handling session says what is missing); the revise that follows ends with an EARLY-FINISH line; the overseer layer says yes; the run ends early.
// Returns what the readers read: the report, HANDOFF.md, BOARD.md, the early ask's section and the handoff prompt (from a prompt log the CLI child writes: test/helpers/prompt-log-preload.js).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerBuildChecks } from './build-check.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cli = join(repo, 'src', 'cli.js');
const PRELOAD = join(repo, 'test', 'helpers', 'prompt-log-preload.js');
const ASK_FIRST_LINE = '# The session proposes to finish now';   // the first line of the early ask's section (src/prompts/recorded-083.js)
const EARLY_LINE = 'EARLY-FINISH: only the owner of the rename log is open, the builder can do it';
const readOr = p => { try { return readFileSync(p, 'utf8'); } catch { return null; } };

/** `critic(layer)` names the mock model of each critic seat (a suffix is added so every seat has its own). `earlyAt: 'first-revise'` puts the EARLY-FINISH line in the first revise, with no build check before it. */
export function earlyLadderRun({ name, critic, earlyAt = 'after-not-yet', notYetAlways = false, finishNow = false }) {
  const c = JSON.parse(readFileSync(join(repo, 'chains', 'plan-mini-council.json'), 'utf8'));
  c.name = name; delete c.prompt_cache;
  const FIXED = { criteria: 'mock-criteria', skeleton: 'mock-skeleton', handoff: 'mock-builder', decider: 'mock-builder' };
  let q = 0;
  for (const [slot, v] of Object.entries(c.seats)) for (const s of (Array.isArray(v) ? v : [v])) {
    if (!s || typeof s !== 'object') continue;
    delete s.extra;
    if (slot === 'builder' || slot === 'reviser') continue;   // the writer stays external
    s.model = slot === 'critics' ? `${critic(s.layer)}-elr${q++}` : slot === 'proposers' ? ['mock-proposer-a', 'mock-proposer-b'][q++ % 2] : (FIXED[slot] ?? 'mock-builder');
    s.provider = 'mock'; if (!s.lab) s.lab = `${slot}-lab`;
  }
  const d = mkdtempSync(join(tmpdir(), 'thc-elr-'));
  mkdirSync(join(d, 'chains')); mkdirSync(join(d, 'tasks'));
  writeFileSync(join(d, 'chains', `${name}.json`), JSON.stringify(c, null, 1));
  writeFileSync(join(d, 'tasks', 'x.md'), 'Plan a small command-line tool that renames photos by the date they were taken.\n');
  const log = join(d, 'prompts.jsonl');
  const run = args => spawnSync(process.execPath, ['--import', PRELOAD, cli, ...args], { cwd: d, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: d, PROMPT_LOG: log }, timeout: 180000 });
  let RD = null;
  const R = () => RD ?? (RD = join(d, 'runs', readdirSync(join(d, 'runs')).sort()[0]));
  const files = () => { try { return readdirSync(R()); } catch { return []; } };
  const pending = () => files().filter(f => /^NEEDS-/.test(f) && !files().includes(f.replace(/^NEEDS-/, '')));
  let r = run(['--chain', name, '--task', 'tasks/x.md', '--max-usd', 'none']);
  const steps = [{ step: 'start', exit: r.status }];
  let notYet = false, earlySent = false, lastPlan = null;
  for (let i = 0; i < 24 && r.status === 3; i++) {
    const p = pending();
    const w = p.find(f => /^NEEDS-(build|revise-\d+|dispute)(-full)?\.md$/.test(f));
    const bc = p.find(f => /^NEEDS-build-check-\d+\.md$/.test(f));
    let what;
    if (bc) { const ans = notYet && !notYetAlways ? 'good_to_build' : 'not_yet'; answerBuildChecks(R(), { answer: ans, note: ans === 'good_to_build' ? 'The build can do it.' : 'Name the owner of the rename log.' }); what = `${bc} -> ${ans}`; notYet = true; }
    else if (w) {
      const dispute = /^NEEDS-dispute/.test(w);
      const early = earlyAt !== 'never' && (earlyAt === 'first-revise' || notYet) && !earlySent && /^NEEDS-revise-/.test(w);
      const plan = dispute && lastPlan !== null ? lastPlan : `# Plan v${i + 1}\n\nRename each photo by its EXIF date; keep a dry-run flag and a log of every rename.\n`;
      if (!dispute) lastPlan = plan;
      writeFileSync(join(R(), w.replace(/^NEEDS-/, '')), `${plan}${early ? `${EARLY_LINE}\n` : ''}`);
      if (early) earlySent = true;
      what = `${w}${early ? ' (with the EARLY-FINISH line)' : ''}`;
    } else break;
    r = run(['--resume', R(), '--max-usd', 'none']);
    steps.push({ step: what, exit: r.status });
  }
  const report = existsSync(join(R(), 'report.json')) ? JSON.parse(readFileSync(join(R(), 'report.json'), 'utf8')) : null;
  const prompts = (readOr(log) ?? '').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const asks = prompts.filter(p => (p.system + p.user).includes(ASK_FIRST_LINE)).map(p => ({ label: p.label, text: p.user.slice(p.user.indexOf(ASK_FIRST_LINE)), draftId: /draft_id "([0-9a-f]{12})"/.exec(p.user)?.[1] ?? null, round: Number(/^panel-(\d+)-/.exec(p.label)?.[1]) }));
  const hand = prompts.find(p => p.label === 'handoff');
  return { exit: r.status, steps, report, asks, handoffPrompt: hand ? hand.user : null, handoffMd: readOr(join(R(), 'HANDOFF.md')), boardMd: readOr(join(R(), 'BOARD.md')), stdout: r.stdout };
}
