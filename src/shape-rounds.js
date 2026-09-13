// v5 §1 candidate 1: which critique rounds in a run were spent entirely on
// document shape rather than substance. Reads each round's critique
// file(s) already written to disk (panel-N-<lab>.md for a panel chain,
// critique-N.md for a single-critic chain) - no new state, no ledger,
// derived from what a run already writes.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const readJson = p => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

// The project has no existing format/substance objection classifier to
// reuse - this is a fresh, deliberately conservative keyword heuristic
// over a failure's criterion+problem text. A substance objection that
// happens to mention one of these words could misclassify; the trade is
// toward not flagging a round shape_only unless it's clearly shape talk.
const FORMAT_PATTERN = /\b(format|formatting|structure|heading|header|section order|numbering|numbered|whitespace|indent(?:ation)?|markdown|bullet|list style|capitali[sz]ation|typo|wording|title case|json shape|schema shape)\b/i;

export function classifyFailure(failure) {
  const text = `${failure?.criterion || ''} ${failure?.problem || ''}`;
  return FORMAT_PATTERN.test(text) ? 'format' : 'substance';
}

// Round number from a stage filename, e.g. "panel-2-glm.md" -> 2,
// "critique-3.md" -> 3. Other stage files (criteria.md, build.md, ...)
// return null.
function roundOfFile(name) {
  const m = name.match(/^(?:panel|critique)-(\d+)(?:-[a-z0-9]+)?\.md$/);
  return m ? Number(m[1]) : null;
}

/**
 * Which critique rounds in run folder `dir` spent entirely on document
 * shape. A round counts as shape_only when it has at least one failure and
 * every failure in it classifies as format-class; a round with zero
 * failures (a clean pass) is not counted - nothing was spent on it.
 * Never throws - a missing or unreadable dir means no rounds, not an error.
 */
export function shapeRounds(dir) {
  let files = [];
  try { files = existsSync(dir) ? readdirSync(dir) : []; } catch { return { rounds: [], shapeOnlyRounds: 0 }; }

  const byRound = new Map();
  for (const f of files) {
    const round = roundOfFile(f);
    if (round === null) continue;
    const parsed = readJson(join(dir, f));
    const failures = Array.isArray(parsed?.failures) ? parsed.failures : [];
    if (!byRound.has(round)) byRound.set(round, []);
    byRound.get(round).push(...failures);
  }

  const rounds = [...byRound.entries()].sort((a, b) => a[0] - b[0]).map(([round, failures]) => {
    const shapeOnly = failures.length > 0 && failures.every(f => classifyFailure(f) === 'format');
    return { round, failureCount: failures.length, shapeOnly };
  });

  return { rounds, shapeOnlyRounds: rounds.filter(r => r.shapeOnly).length };
}
