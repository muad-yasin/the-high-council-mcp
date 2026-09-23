// Stale cached stages, set aside rather than overwritten.
//
// Pre-release audit, money path #2 and audit 5 #1 (Review/PreRelease_Audit_moneypath_2026-09-23.md,
// Review/PreRelease_Audit_ResumeCache_2026-09-23.md): when a resume finds a cached stage that no
// longer matches what it would be asked now (the task or chain changed, or the stage's own prompt
// did), the stage re-runs. Before this, the re-run simply overwrote `<label>.usage.json`, so the
// earlier sitting's spend vanished from disk, from `--spend`, from MCP run_status and from the cap
// on the next resume. Now the old files move into `superseded/` inside the run folder, numbered,
// and every spend reader adds that folder in.
//
// A subfolder, not a renamed file next to the live ones: resume-brief.js, shape-rounds.js and
// verdict-stats.js all read the run folder's own `*.md` files as stages, and an old answer must
// never be read as a finished one.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export const SUPERSEDED_DIR = 'superseded';

/**
 * Move a stage's files (`<label>.md`, `<label>.usage.json`, `<label>.prompt.json`) into
 * `superseded/` as `<label>.<n>.*`, n counting up from 1 per label. Returns the n used, or null if
 * the stage had no files. Never overwrites and never deletes.
 */
export function archiveSuperseded(runDir, label) {
  const files = ['md', 'usage.json', 'prompt.json'].filter(ext => existsSync(join(runDir, `${label}.${ext}`)));
  if (!files.length) return null;
  const dir = join(runDir, SUPERSEDED_DIR);
  mkdirSync(dir, { recursive: true });
  let n = 1;
  while (['md', 'usage.json', 'prompt.json'].some(ext => existsSync(join(dir, `${label}.${n}.${ext}`)))) n++;
  // usage first and text last, the same order the CLI writes a stage in: a crash in between leaves
  // the text in place, so the stage still reads as cached and is judged again on the next resume.
  for (const ext of ['usage.json', 'prompt.json', 'md']) {
    if (files.includes(ext)) renameSync(join(runDir, `${label}.${ext}`), join(dir, `${label}.${n}.${ext}`));
  }
  return n;
}

/** Every superseded stage's cost record: [{ label, provider, model, usd }]. Never throws. */
export function supersededStagesOf(runDir) {
  const dir = join(runDir, SUPERSEDED_DIR);
  let names = [];
  try { names = existsSync(dir) ? readdirSync(dir) : []; } catch { return []; }
  const out = [];
  for (const f of names) {
    if (!f.endsWith('.usage.json')) continue;
    let u = null;
    try { u = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { continue; }
    out.push({ label: `${SUPERSEDED_DIR}/${f.replace(/\.usage\.json$/, '')}`, provider: u?.provider ?? null, model: u?.model ?? null, usd: Number(u?.usd) || 0 });
  }
  return out;
}

/** What the superseded stages cost in total. */
export function supersededSpendOf(runDir) {
  return supersededStagesOf(runDir).reduce((sum, s) => sum + s.usd, 0);
}
