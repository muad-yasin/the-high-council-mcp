// v5 item 3: pure helpers behind state.json - interface-agnostic, testable with no CLI or
// process running (backend-developer/SKILL.md rule 1). src/cli.js is a thin wrapper: it owns
// the seat-status Map, installs chain.js's progressHook, and writes the file atomically: this
// module only computes values from data already in hand.
const ROUND_LABEL_RE = /^(?:critique|panel|revise|allocator)-(\d+)/;

// A stage label's round number, or null if the label carries none (e.g. "criteria", "build",
// or a descending-mode "descending-<stage>-critic-<lab>" label).
export function parseRoundFromLabel(label) {
  const m = ROUND_LABEL_RE.exec(label || '');
  return m ? Number(m[1]) : null;
}

// The generic completion classification for a finished stage: `posted` for the two prefixes
// that finish with no verdict of their own. `panel-`/`critique-`/`reply-` are deliberately
// absent here - those are classified from chain.js's own 'verdict' progressHook events instead
// (touch point 2), which carry the real parsed outcome this function has no way to know.
export function classifyStageCompletion(label) {
  return /^(propose|debate)-/.test(label || '') ? 'posted' : null;
}

// A 'verdict' progressHook event -> the wedge status it implies, or null if it implies none
// (there is currently no such case, but a hook payload chain.js hasn't started sending yet
// should not crash the writer - see the persistence-integrity rule against throwing on
// unexpected-but-harmless input).
export function classifyVerdictEvent(event, currentStatus) {
  if (event.dropped) return 'dropped';
  if (event.passStated) return 'posted';
  if (event.passed !== undefined) return event.passed ? 'signed' : 'objected';
  if (event.decisions) return event.decisions.keep > 0 ? 'held' : (currentStatus || 'posted');
  return null;
}

// Parses stage-log.jsonl's own line shape ({ stage, seat, lab, tokensIn, tokensOut, usd, ms,
// outcome }, one JSON object per line) into the cost block state.json needs. Tolerant of a
// truncated last line (a run killed mid-write) and of unparseable lines - skipped, not thrown.
// V6-2: a line carrying `kind` (currently only `kind:"round"`) is a derived summary of stage
// lines already counted above it, never a stage of its own - skipped here so a round record
// can never be double-counted into spentUsd.
export function sumCostFromStageLogText(text) {
  const perLab = new Map();
  let spentUsd = 0;
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.kind) continue;
    const usd = entry.usd || 0;
    spentUsd += usd;
    const lab = entry.lab || 'unknown';
    perLab.set(lab, (perLab.get(lab) || 0) + usd);
  }
  return { perLab: [...perLab.entries()].map(([lab, usd]) => ({ lab, usd })), spentUsd };
}
