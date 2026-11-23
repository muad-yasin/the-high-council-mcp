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
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { usdFigure } from './usd-figure.js';
import { billedFieldsOf, discardedFieldOf } from './billed-facts.js';

import { SUPERSEDED_DIR, nextSupersededN } from './superseded-n.js';
import { basisField } from './counted-bases.js';
// The two live in a LEAF module (node imports only) so verdict-envelope.js, which providers.js imports, does not drag usd-figure -> cost -> roles into providers.js's closure (test/no-digest-in-prompt-paths.test.js).
export { SUPERSEDED_DIR, nextSupersededN };

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
  const n = nextSupersededN(runDir, label);
  // usage first and text last, the same order the CLI writes a stage in: a crash in between leaves
  // the text in place, so the stage still reads as cached and is judged again on the next resume.
  for (const ext of ['usage.json', 'prompt.json', 'md']) {
    if (files.includes(ext)) renameSync(join(runDir, `${label}.${ext}`), join(dir, `${label}.${n}.${ext}`));
  }
  return n;
}

/**
 * Money path #4: a charge that is not a stage (a call that failed after it was sent, or a discarded
 * thinking attempt whose retry failed) is written here too, as `<label>.charge-<n>.usage.json`, so
 * every spend reader that adds this folder in counts it - and the cap does on resume.
 */
export function recordLostCharge(runDir, label, { provider = null, model = null, usd = 0, reason = '', reservationId = null, kind = null, ms = null, cause = null, host = null, providerCode = null, endpoint = null, capName = null, resumed = null, reachedProvider = false, providerReportedCost = null, generationId = null, basis = null } = {}) {
  // A $0 charge is still no charge file (spend readers add this folder in; a file here would be a second kind of record for them to read). A resume that followed a $0 attempt (a seat that does not bill) is recorded in its own file instead.
  if (!(Number(usd) > 0)) return Number.isInteger(resumed) && resumed > 0 ? recordFreeResume(runDir, { label, provider, model, resumed, cause }) : null;
  const dir = join(runDir, SUPERSEDED_DIR);
  mkdirSync(dir, { recursive: true });
  let n = 1;
  while (existsSync(join(dir, `${label}.charge-${n}.usage.json`))) n++;
  const path = join(dir, `${label}.charge-${n}.usage.json`);
  // 0.8.3 M2 (D18): the reservation the charge belongs to, and whether it is the discarded attempt's waste or the billed, unreadable call itself. Both additive; absent when the call wrote no reservation.
  writeFileSync(path, JSON.stringify({ provider, model, usage: { input: 0, output: 0 }, usd: Number(usd), reason, ...(reservationId ? { reservationId } : {}), ...(kind ? { kind } : {}),
    // 0.8.4 S5-04 (additive): `ms`, measured as a stage's own usage file measures it (from the start of the invoke(), retries and waits included). Absent when the caller measured none (a waste charge).
    ...(Number.isFinite(ms) && ms >= 0 ? { ms } : {}),
    // 0.8.4 S6-01 (additive): what the failed call said about itself (providers.js failureFactsOf: tokens only, no message text): the cause chain, the request host, a 200 body's error code. Absent when the failure said none.
    ...(cause ? { cause } : {}), ...(host ? { host } : {}), ...(endpoint ? { endpoint } : {}), ...(providerCode !== null && providerCode !== undefined ? { providerCode } : {}),
    // 0.8.4 DUALCAP unit 4b2 (additive): the per-provider cap the charge counts in (chain.js charge payloads carry it with the caps armed). Absent with the switch off.
    ...(typeof capName === 'string' && capName ? { capName } : {}),
    // 0.8.4 network-error resume (additive): this failed attempt was followed by the run's n-th automatic resume (chain.js invoke()). The count of these files in a run folder is how many of the run's three resumes are used, so a resume a person starts does not refill them.
    ...(Number.isInteger(resumed) && resumed > 0 ? { resumed } : {}),
    // 0.8.4 unit 0b (additive): the request reached the provider (an HTTP 5xx answered) though no usage figure came back; the amount is THC's count, the bill is unknown. Absent otherwise.
    ...(reachedProvider === true ? { reachedProvider: true } : {}),
    // 0.8.4 unit 1 (D12 part 1, additive): what OpenRouter says it billed for the attempt, and the generation id to look it up by. UNVERIFIED against the activity export; THC's own `usd` above is the count. Absent when the reply carried none.
    ...billedFieldsOf({ providerReportedCost, generationId }),
    // 0.8.4 unit 6 (D11, additive): what the amount stands for (src/counted-bases.js): provider_usage, typical_error, expected_retry, worst_case, or token_priced for a discarded attempt's waste. Absent on a record written without one.
    ...basisField({ basis }) }));
  return path;
}

const FREE_RESUMES_FILE = 'network-resumes.jsonl';
/**
 * 0.8.4 network-error resume, a seat that does not bill: one line per automatic resume in `<run folder>/network-resumes.jsonl` ({ schema, label, provider, model, resumed, cause?, at }; never task text or a message). Append-only. NO spend reader
 * reads it (they read *.usage.json, superseded/ and spend-reservations.jsonl), and resumesUsedIn does not count it: a seat that bills is bounded by the run folder's charge files, a seat that does not by the sitting (chain.js invoke()).
 * It records EVENTS, not figures. Any reader of this file (none exists today) must read a missing, torn or corrupt file as none, as spend-reservations.js reads its own.
 */
export function recordFreeResume(runDir, { label, provider = null, model = null, resumed, cause = null }) {
  mkdirSync(runDir, { recursive: true });
  const path = join(runDir, FREE_RESUMES_FILE);
  appendFileSync(path, `${JSON.stringify({ schema: 'network-resumes/1', label, provider, model, resumed, ...(cause ? { cause } : {}), at: new Date().toISOString() })}\n`);
  return path;
}
/** How many of a run's automatic resumes after a network error are used, read from the run folder: the charge files that say a resume followed them (0.8.4). Never throws; a missing or torn folder reads as 0. */
export function resumesUsedIn(runDir) {
  const dir = join(runDir, SUPERSEDED_DIR);
  let names = [];
  try { names = existsSync(dir) ? readdirSync(dir) : []; } catch { return 0; }
  let n = 0;
  for (const f of names) {
    if (!/\.charge-\d+\.usage\.json$/.test(f)) continue;
    try { const u = JSON.parse(readFileSync(join(dir, f), 'utf8')); if (Number.isInteger(u?.resumed) && u.resumed > 0) n++; } catch { /* a torn file counts nothing */ }
  }
  return n;
}

/**
 * 0.8.1 FX-1 (P1): one paid call that is not a stage of the run (`council handoff --from-run`) is recorded as its own
 * file, `<label>.call-<n>.usage.json`, with the real usage object (recordLostCharge's sibling; that one writes zero
 * tokens by design). Every spend reader and a resume's cap already add this folder in, so no reader is new. Written
 * atomically (temp file, then rename); never overwrites.
 */
export function recordCall(runDir, label, { provider = null, model = null, usage = null, usd = 0, ms = null, promptHash = null, reservationId = null, providerReportedCost = null, generationId = null, discardedAttempt = null, basis = null } = {}) {
  const dir = join(runDir, SUPERSEDED_DIR);
  mkdirSync(dir, { recursive: true });
  let n = 1;
  while (existsSync(join(dir, `${label}.call-${n}.usage.json`))) n++;
  const path = join(dir, `${label}.call-${n}.usage.json`);
  writeFileSync(`${path}.tmp`, JSON.stringify({ provider, model, usage, usd: Number(usd) || 0, ms, promptHash, ...(reservationId ? { reservationId } : {}), ...basisField({ basis }), ...billedFieldsOf({ providerReportedCost, generationId }), ...discardedFieldOf({ discardedAttempt }) }));   // 0.8.4 units 1-2 (additive): the provider-reported figure + its unverified marker + the generation id, beside usd; and the split of a thinking retry that answered
  renameSync(`${path}.tmp`, path);
  return path;
}

/**
 * Every superseded stage's cost record: [{ label, provider, model, usd, ... }]. Never throws.
 * 0.8.3 (Builder D, Batch 1 audit item 10): `usd` goes through the one reader (src/usd-figure.js). A figure that is there and is not a number of dollars (a string, a negative, NaN, null)
 * and a file that does not parse are UNKNOWN: the row keeps `usd: 0` (the floor) and carries `unknown: true`, so a total can say so and name the file. Before, `Number(u?.usd) || 0`
 * read a bad figure as 0 (or a negative one as negative) and skipped a torn file without a word.
 */
export function supersededStagesOf(runDir) {
  const dir = join(runDir, SUPERSEDED_DIR);
  let names = [];
  try { names = existsSync(dir) ? readdirSync(dir) : []; } catch { return []; }
  const out = [];
  for (const f of names) {
    if (!f.endsWith('.usage.json')) continue;
    const label = `${SUPERSEDED_DIR}/${f.replace(/\.usage\.json$/, '')}`;
    let u = null;
    try { u = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { out.push({ label, provider: null, model: null, usd: 0, reservationId: null, kind: null, unknown: true }); continue; }
    const n = u !== null && typeof u === 'object' && !Array.isArray(u) ? usdFigure(u.usd) : null;
    out.push({ label, provider: u?.provider ?? null, model: u?.model ?? null, usd: n ?? 0, ...(typeof u?.capName === 'string' && u.capName ? { capName: u.capName } : {}),   /* unit 4c1: the cap the record names */ reservationId: typeof u?.reservationId === 'string' ? u.reservationId : null, kind: typeof u?.kind === 'string' ? u.kind : null, ...(n === null ? { unknown: true } : {}) });
  }
  return out;
}

/** What the superseded stages cost in total (the readable part: see supersededStagesOf). */
export function supersededSpendOf(runDir) {
  return supersededStagesOf(runDir).reduce((sum, s) => sum + s.usd, 0);
}

/** The superseded stage files whose figure could not be read, as `superseded/<name>.usage.json` relative to the run folder. */
export function supersededUnknownFilesOf(runDir) {
  return supersededStagesOf(runDir).filter(s => s.unknown).map(s => `${s.label}.usage.json`);
}
