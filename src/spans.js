// V6-2 (relay/runs/2026-09-15T15-13-25-950Z/deliverable.md): span-tree bookkeeping behind
// stage-log.jsonl's new span_id/parent_span_id fields and its `kind:"round"` records.
// Interface-agnostic and testable with no CLI or process running (backend-developer/SKILL.md
// rule 1): src/cli.js owns id generation and the Maps' lifetime (reconstructed from disk on
// resume, same pattern as its existing seatState rebuild); this module only computes the
// parent-resolution and round-close decision from data already in hand. Randomness is injected
// (rule 10) - every function that needs a fresh id takes a `generateId` callback rather than
// calling `crypto.randomUUID()` itself, so the round-close decision stays verifiable with a
// fake, deterministic id source in tests.
import { parseRoundFromLabel } from './run-state.js';

const ROUND_STAGE_RE = /^(panel|critique)-/;

// A round's span id is created lazily, the first time any of its stages needs to name it as a
// parent - before the round record itself is ever appended. The round record, once appended,
// reuses this same id as its own span_id, so a reader resolving parent_span_id -> span_id always
// finds a match regardless of write order (the round's own line always arrives after its
// children's, not before).
export function roundSpanIdFor(round, roundSpanIds, generateId) {
  if (!roundSpanIds.has(round)) roundSpanIds.set(round, generateId());
  return roundSpanIds.get(round);
}

// Which existing span a stage's line should declare as its parent: the enclosing round's span
// for a panel/critique stage (the only two stage families this chain ever nests one level deep
// under a round), the run root for everything else (criteria, skeleton, proposals-*, debate-*,
// reply-*, build, revise-N, handoff, final, allocator-*).
export function resolveParentSpanId(label, runRootSpanId, roundSpanIds, generateId) {
  const round = parseRoundFromLabel(label);
  if (round && ROUND_STAGE_RE.test(label || '')) return roundSpanIdFor(round, roundSpanIds, generateId);
  return runRootSpanId;
}

/**
 * Call once per completed panel/critique stage line. Returns the round number to close (emit a
 * `kind:"round"` record for) once every critic seat has posted for that round, or null otherwise.
 * `criticsCount` of 0 (a chain with no critics seat) never closes a round - there is nothing to
 * wait for and no round record would mean anything.
 */
export function recordRoundStageAndCheckClose(label, roundPanelCounts, criticsCount) {
  const round = parseRoundFromLabel(label);
  if (!round || !ROUND_STAGE_RE.test(label || '') || !criticsCount) return null;
  const count = (roundPanelCounts.get(round) || 0) + 1;
  roundPanelCounts.set(round, count);
  return count >= criticsCount ? round : null;
}

// Rebuilds roundSpanIds/roundPanelCounts from an existing stage-log.jsonl's text, the same
// "replay what's already on disk" pattern src/cli.js's own seatState rebuild already uses for
// resume - so a round partially completed before a pause closes correctly once its remaining
// critics report, instead of starting a second, disconnected round-1 span after resume.
export function replaySpanStateFromStageLogText(text) {
  const roundSpanIds = new Map();
  const roundPanelCounts = new Map();
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.kind === 'round') continue; // round records themselves carry no new bookkeeping
    const round = parseRoundFromLabel(entry.stage);
    if (round && ROUND_STAGE_RE.test(entry.stage || '')) {
      roundPanelCounts.set(round, (roundPanelCounts.get(round) || 0) + 1);
      if (entry.parent_span_id && !roundSpanIds.has(round)) roundSpanIds.set(round, entry.parent_span_id);
    }
  }
  return { roundSpanIds, roundPanelCounts };
}

// The cost of one round's panel/critique calls, read back from stage-log.jsonl's own text - the
// same "derive, never record twice" precedent src/spend.js's spendReport() already sets. Round
// records themselves (`kind:"round"`) are skipped so a resumed run summing across a log that
// already contains earlier round records never double-counts them.
export function sumRoundUsdFromStageLogText(text, round) {
  const stagePrefix = new RegExp(`^(panel|critique)-${round}-`);
  let usd = 0;
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.kind) continue;
    if (stagePrefix.test(entry.stage || '')) usd += entry.usd || 0;
  }
  return usd;
}
