// `council handoff --from-run <folder>` (0.8.0, roadmap "Debate, criteria, milestones" item 3): a
// HANDOFF.md for a run that never got to write one - it stopped at the spend cap, paused and was
// abandoned, or crashed - from the latest draft the run left on disk. Everything that decides WHAT to
// hand over lives here as pure functions over a run folder; src/cli.js does the one model call.
//
// What it will not do: pretend the plan was signed off. A run that has no report.json gets a banner,
// written by the harness at the top of the file, saying where the run stopped and that no panel signed
// off on the draft below it.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checksOf } from './criteria-lock.js';
import { readStoppedMarker, waitsForPerson, ROUND_STOPPED_STATE } from './stop-files.js';
import { DEGRADED_WORDS } from './verdict-headline.js';
import { waitingStages } from './run-status.js';
import { draftCutOff, draftIncomplete, parseJson } from './chain.js';
import { stripDeclinedWithNotes, parseDisputes } from './draft-disputes.js';
import { changedAfterReviewSentence } from './text-labels.js';
import { BUILD_DRAFT_FILES } from './from-run-files.js';

const read = p => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
const readJson = p => { const t = read(p); if (t == null) return null; try { return JSON.parse(t); } catch { return null; } };

// ------------------------------------------------------------------------------------------------------------------------------------ which draft (audit items 4, 5, 9 (-full), 15a; 13 Oct 2026)
// The name grammar of every draft-producing stage (src/chain.js): each `draftStage` call can retry once under `<label>-retry`, and patch mode adds `revise-N-full` (its own retry is `revise-N-full-retry`).
// RANK = stage order, and each ADOPTED attempt outranks the attempt it replaced: deliverable.md; final; revise-N from the highest N down; deep-dive-revise; build. Within one stage: first try < retry < full < full-retry.
// Only the names a stage can write: `-full` belongs to a revise round alone (a `build-full.md` is no draft, and a name the folder holds but no stage wrote is not read at all: the MCP jail check lists the files a from_run folder may be read for).
const DRAFT_NAME = /^(?:(build|deep-dive-revise|final)|revise-(\d+)(-full)?)(-retry)?\.md$/;
const rankOf = name => {
  const m = DRAFT_NAME.exec(name);
  if (!m) return null;
  const stage = m[1] === 'build' ? 0 : m[1] === 'deep-dive-revise' ? 1 : m[1] === 'final' ? 1e9 : 1 + Number(m[2]);
  return { stage, within: (m[3] ? 2 : 0) + (m[4] ? 1 : 0), kind: m[1] === 'build' ? 'build' : m[1] === 'final' ? 'final' : 'revise' };
};
/** The candidate file names of a folder listing, highest rank first. `only`: restrict to one stage kind (the build stage, for the first-draft readers). */
function candidatesOf(names, only = null) {
  const out = [];
  if (!only && names.includes('deliverable.md')) out.push({ name: 'deliverable.md', rank: { stage: Infinity, within: 0, kind: 'deliverable' } });
  // the build stage's picker opens only the files src/from-run-files.js lists: the MCP jail check covers exactly those
  for (const n of names) { const rank = rankOf(n); if (rank && (!only || (rank.kind === only && (only !== 'build' || BUILD_DRAFT_FILES.includes(n))))) out.push({ name: n, rank }); }
  return out.sort((a, b) => (b.rank.stage - a.rank.stage) || (b.rank.within - a.rank.within) || (a.name < b.name ? -1 : 1));
}
/**
 * Did this attempt fail? Read from the stage's own record, `<label>.usage.json` (written by cli.js's stage writer from chain.js's `record`): `usage.stop` and `cappedAt`. The tests are chain.js's OWN
 * (`draftIncomplete`: error / content_filter / refusal; `draftCutOff`: length / max_tokens, or no stop reason and the whole cap used), never a list typed here. A file with no usable record (an external seat's) counts as usable.
 * -> null, or the words for the banner and the console.
 */
function failureOf(runDir, name) {
  const rec = readJson(join(runDir, name.replace(/\.md$/, '.usage.json')));
  const usage = rec?.usage;
  if (!usage || typeof usage !== 'object') return null;
  const cap = rec.cappedAt;
  if (draftIncomplete(usage)) return `ended with stop "${usage.stop}"`;
  if (draftCutOff(usage, Number.isFinite(cap) ? cap : Infinity)) return usage.stop ? `was cut off at its output-token cap (stop "${usage.stop}")` : 'was cut off at its cap';
  return null;
}
/** A candidate's text the way the stage that wrote it reads it (FX-15: a builder's or reviser's RAW reply carries DECLINED lines, a reviser's also a trailing Disputed block; a finished text is returned as it is). */
// Notes lane unit 2 (addendum 1, R3): the text AND the count of review-note answer lines the strip removed (a NOTE line is never plan text), so `council handoff --from-run` can say so on stderr (pickNotesLine).
const textOf = (name, raw) => {
  if (name === 'deliverable.md' || rankOf(name)?.kind === 'final') return { text: raw, noteLines: [] };
  if (rankOf(name)?.kind === 'revise') { const r = parseDisputes(raw); return { text: r.draft, noteLines: r.noteLines }; }
  const r = stripDeclinedWithNotes(raw); return { text: r.draft, noteLines: r.noteLines };
};

function pickFrom(runDir, only) {
  const names = existsSync(runDir) ? readdirSync(runDir) : [];
  const skipped = []; let firstFailed = null;
  for (const c of candidatesOf(names, only)) {
    const raw = read(join(runDir, c.name));
    // an unreadable file (a directory, mode 000, a dangling link) is not parsed: it is passed over and NAMED (the banner and the console say which newer file was dropped)
    if (raw == null) { skipped.push({ name: c.name, why: 'could not be read' }); continue; }
    const { text, noteLines } = textOf(c.name, raw);
    if (!text || !text.trim()) continue;                                                      // an empty file does not count
    const failed = failureOf(runDir, c.name);
    if (failed) { skipped.push({ name: c.name, why: failed }); if (!firstFailed) firstFailed = { name: c.name, text, why: failed, at: skipped.length - 1, notesRemoved: noteLines.length }; continue; }
    return { name: c.name, text, ...(skipped.length ? { skipped } : {}), ...(noteLines.length ? { notesRemoved: noteLines.length } : {}) };
  }
  // every readable candidate failed: the highest-ranked one is handed on as it always was, but NOT silently: `failed` says why (the banner names it)
  if (firstFailed) { const higher = skipped.slice(0, firstFailed.at); return { name: firstFailed.name, text: firstFailed.text, ...(firstFailed.notesRemoved ? { notesRemoved: firstFailed.notesRemoved } : {}), ...(higher.length ? { skipped: higher } : {}), failed: firstFailed.why, failures: skipped }; }
  return null;
}

/**
 * The most finished draft the run folder holds, by STAGE ORDER with each adopted attempt outranking the one it replaced (see the grammar above): deliverable.md, else final, else the highest revise round, else the deep-dive
 * revision, else build. An attempt whose own record says it failed (cut off, refused, errored) is passed over for the next one down; an unreadable file is passed over and named; an empty file does not count.
 * -> { name, text } or null; plus `skipped: [{ name, why }]` (the higher-ranked files passed over) only when it passed something over, and, only when EVERY candidate failed (the highest-ranked is then handed on), `failed: why` and `failures: [{ name, why }]` (every file passed over, in rank order).
 */
export function pickDraft(runDir) { return pickFrom(runDir, null); }

/**
 * The run's FIRST draft, for the run-level `--from-run` (documented as "reuse that run's criteria and first draft"): the build stage only, `build-retry.md` over `build.md`, with the same rules as pickDraft. The latest draft
 * (a revise round) is NOT picked: that would change what the flag means.
 */
export function pickBuildDraft(runDir) { return pickFrom(runDir, 'build'); }

/** One stderr line when the picked draft had review-note answer lines removed (they are the writer's replies to a judge's notes, not part of the plan); '' when none. Printed by the CLI beside pickNoteLines, not in HANDOFF.md. */
export function pickNotesLine(pick) {
  return pick?.notesRemoved ? `note: ${pick.notesRemoved} answer line(s) to review notes were removed from \`${pick.name}\` (they are not part of the plan).` : '';
}

/** The lines that say what a pick passed over: for the HANDOFF.md banner (the durable record) and the console. [] when it passed over nothing. */
export function pickNoteLines(pick) {
  if (!pick) return [];
  const lines = [];
  if (pick.skipped?.length) lines.push(`${pick.skipped.map(s => `\`${s.name}\` ${s.why}`).join('; ')}; \`${pick.name}\` is handed on.`);
  if (pick.failed) lines.push(`\`${pick.name}\` ${pick.failed}, and no other draft in the run folder finished, so what follows is not a finished plan.`);
  return lines;
}

/**
 * Whether `name` exists in `dir` with exactly that case (0.8.1 FX-9). existsSync says yes for HANDOFF.md when only
 * handoff.md (a stage's cache file) exists on a case-insensitive disk. A missing folder is false.
 */
export function existsExactCase(dir, name) {
  try { return readdirSync(dir).includes(name); } catch { return false; }
}

/** The criteria the run settled: report.json, else report-partial.json, else the criteria stage's reply. [] when none. */
export function readCriteria(runDir) {
  for (const f of ['report.json', 'report-partial.json']) {
    const r = readJson(join(runDir, f));
    if (Array.isArray(r?.criteria) && r.criteria.length) return r.criteria.map(c => (typeof c === 'string' ? c : String(c?.criterion ?? c?.text ?? ''))).filter(Boolean);
  }
  const stage = read(join(runDir, 'criteria.md'));
  if (stage) {
    // The run's own repairing parser (0.8.1 FX-6): a reply the run read after repairing it (an unescaped quote, a raw
    // newline) is read the same way here; plain JSON.parse returned no criteria for it and the lock block was dropped.
    let j = null;
    try { j = parseJson(stage); } catch { /* genuinely garbled: no criteria from here; the CLI says so */ }
    if (Array.isArray(j?.criteria)) return j.criteria.map(c => (typeof c === 'string' ? c : String(c?.criterion ?? c?.text ?? ''))).filter(Boolean);
  }
  return [];
}

/**
 * How each of `criteria` is checked (0.8.1 FX-10), index-aligned for the lock block: from report.json or
 * report-partial.json's criteria_kinds when they list the same criteria in the same order, else none (a run without
 * kinds, or a stage file only). An empty list means the block's checks fingerprint covers "no checks".
 */
export function readChecks(runDir, criteria) {
  for (const f of ['report.json', 'report-partial.json']) {
    const r = readJson(join(runDir, f));
    const kinds = r?.criteria_kinds;
    if (Array.isArray(kinds) && kinds.length === criteria.length && kinds.every((k, i) => String(k?.criterion ?? '') === criteria[i])) return checksOf(criteria, kinds);
  }
  return criteria.map(() => null);
}

/**
 * The state of a run that FINISHED (it has a report), from its `passed`, `outcome` and `delivered_text` (0.8.2 item 4; F7 of the ChatGPT review). One definition, used for a run folder
 * (stopState) and for the run that has just ended (the CLI, when it writes HANDOFF.md). `signedOff` is true only for a clean sign-off: `passed` true AND an outcome that is not `degraded`
 * (one verdict plus six stated passes reads passed:true, outcome degraded: it used to get a clean handoff with no banner). `changedAfterReview` is the sentence naming the model stages
 * that changed the text after the panel's last review, '' when none did.
 */
export function finishedState({ passed, outcome, delivered_text }) {
  const signed = passed === true;
  const degraded = signed && outcome === 'degraded';
  return {
    finished: true,
    signedOff: signed && !degraded,
    degraded,
    changedAfterReview: changedAfterReviewSentence({ delivered_text }),
    reason: degraded ? `ended degraded: ${DEGRADED_WORDS}` : signed ? 'signed off' : 'finished with open objections',
  };
}

/**
 * Where the run stopped, from the marker files it left. { finished, signedOff, reason } where
 * `finished` means report.json exists (a full run: no banner needed unless the panel did not sign off).
 */
export function stopState(runDir) {
  const report = readJson(join(runDir, 'report.json'));
  if (report) return finishedState({ passed: report.passed, outcome: report.outcome, delivered_text: report.delivered_text });
  const has = f => existsSync(join(runDir, f));
  if (has('STOPPED-budget.json')) {
    const b = readJson(join(runDir, 'STOPPED-budget.json'));
    return { finished: false, signedOff: false, reason: `stopped at the spend cap${b?.stoppedAt ? ` before stage "${b.stoppedAt}"` : ''}` };
  }
  if (has('STOPPED-truncated.json') || has('STOPPED-truncated.md')) return { finished: false, signedOff: false, reason: 'stopped because a draft was cut off at its token cap' };
  if (has('STOPPED-error.md') || has('STOPPED-error.json')) return { finished: false, signedOff: false, reason: 'stopped at an error' };
  if (has('STOPPED-preflight.md')) return { finished: false, signedOff: false, reason: 'stopped because the task was refused before any stage' };
  if (has('STOPPED-secret.md')) return { finished: false, signedOff: false, reason: 'stopped because the prompt held a key-shaped string' };
  // 0.8.1 M6: an advice call stopped at exit 18 (handoff --from-run refuses advice runs, FX-14; the status still reads right).
  const stop = readStoppedMarker(runDir);
  if (stop && waitsForPerson(stop.stoppedBy)) return { finished: false, signedOff: false, reason: ROUND_STOPPED_STATE };
  if (stop) return { finished: false, signedOff: false, reason: `stopped by ${{ user: 'a person', client_cancel: 'its client', wall_clock: 'its wall-clock ceiling' }[stop.stoppedBy]}` };
  if (waitingStages(runDir).length) return { finished: false, signedOff: false, reason: 'paused at an external seat and never answered' };
  return { finished: false, signedOff: false, reason: 'ended without a report (crashed or killed)' };
}

/** The harness-written note that goes above a handoff whose plan no panel signed off. '' when it did. */
export function partialBanner({ state, draftName, runId, pick = null }) {
  // the durable record of what the pick passed over (13 Oct 2026): a newer file that could not be read or failed, and a fragment handed on because nothing better exists
  const passed = pickNoteLines(pick).map(l => `> ${l}`);
  const changed = state.changedAfterReview ? [`> **Not the signed text.** ${state.changedAfterReview} Written by the harness, not a model.`] : [];
  if (state.signedOff) return changed.length || passed.length ? [...changed, ...passed, '', ''].join('\n') : '';
  if (state.degraded) {
    return [
      `> **Not a clean sign-off.** Written by the harness, not a model, from the latest draft of run ${runId || '(unnamed)'} (\`${draftName}\`).`,
      `> The run ${state.reason}. Read the run's BOARD.md or report.json for who was not heard before you treat any part of the plan below as signed off.`,
      ...changed, ...passed, '', '',
    ].join('\n');
  }
  return [
    `> **Not a signed-off plan.** Written by the harness, not a model, from the latest draft of run ${runId || '(unnamed)'} (\`${draftName}\`).`,
    `> The run ${state.reason}. The panel did not sign off on the plan below: treat every part of it as a proposal, and read the run's BOARD.md or report.json for what was left open.`,
    ...passed, '', '', // no "Not the signed text" line here: nothing was signed, and this banner is the 0.8.1 one (item 4 review: the CHANGELOG says it is kept)
  ].join('\n');
}

/** The prompt file for an external handoff seat (a Claude Code session), to paste or hand over. */
export function externalPromptText({ system, user, runDir, target }) {
  return `# Handoff prompt (external seat)\n\nThe chain's handoff seat is a session you run yourself. Give it the system prompt and the user message below, and save what it returns as \`${target}\` (the harness adds no lock block or banner to a file you write yourself; \`council check-lock\` needs the block).\n\nRun folder: ${runDir}\n\n## System prompt\n\n${system}\n\n## User message\n\n${user}\n`;
}
