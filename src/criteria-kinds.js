// Criterion kinds (0.7.7 candidate). An LLM writes the criteria, LLMs write the plan, and LLMs
// judge the plan against those criteria. A vague criterion ("is scalable") lets a vague plan pass,
// because no reply can be shown wrong. A criterion a command or a number settles ("npm audit
// --audit-level=high exits 0", "p95 under 200 ms at 100 concurrent requests") cannot be talked
// past - at build time. So every criterion carries a kind:
//
//   checkable  - a named command, test or measurement settles it. `check` says which, with its
//                pass threshold; `on` says whether it runs against the plan document itself
//                ("plan": a count, a presence, a link check) or against what gets built ("build").
//   judgement  - only a careful reader can settle it.
//
// The criterion TEXT stays a plain string everywhere it already is (prompts, critic replies,
// report.json's `criteria`): critics copy it verbatim and the stall, regression and allocator
// logic key on it. Kinds ride alongside as a parallel array, so report.json only gains fields.
//
// Opt-in per chain via `criteria_kinds: { enabled: true }`. Absent, nothing in this file runs and
// every prompt is byte-identical to what it was before kinds existed.

export const KINDS = Object.freeze(['checkable', 'judgement']);
export const CHECK_TARGETS = Object.freeze(['plan', 'build']);

// Words that name a property without saying how anyone would tell it holds. Flagged, never
// rejected: "fast" can be fine inside a criterion that also states a threshold, which is why a
// criterion with a number or a named check in it is never counted as vague.
const VAGUE = /\b(scalable|scalability|robust|user[- ]friendly|intuitive|performant|fast|efficient|secure|maintainable|clean|elegant|modern|flexible|seamless|high[- ]quality|well[- ](written|designed|structured)|appropriate(ly)?|reasonable|adequate(ly)?|best practices?)\b/i;
const HAS_MEASURE = /\d|`[^`]+`|\b(exits?|returns?|reports?|passes|fails|count|under|at most|at least|no more than|fewer than|within)\b/i;

const clip = (s, n = 500) => String(s ?? '').trim().slice(0, n);

/**
 * Split whatever a criteria seat (or a hand-written criteria list) returned into the plain texts
 * the rest of the chain uses and a parallel kinds array. Accepts plain strings (today's shape) and
 * objects `{ criterion | text, kind, check, on }`. `kinds` is null when every item was a plain
 * string, so a run that never asked for kinds records none.
 *
 * A "checkable" item with no `check` is downgraded to "judgement" and marked, because a check
 * nobody named is a check nobody can run - counting it as checkable would inflate the board.
 */
export function normaliseCriteria(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const texts = [];
  const kinds = [];
  let sawObject = false;
  for (const item of list) {
    if (typeof item === 'string') {
      if (!item.trim()) continue;
      texts.push(item);
      kinds.push({ kind: null });
      continue;
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const text = clip(item.criterion ?? item.text, 2000);
    if (!text) continue;
    sawObject = true;
    texts.push(text);
    const said = String(item.kind || '').toLowerCase().trim();
    const check = clip(item.check);
    const on = CHECK_TARGETS.includes(String(item.on || '').toLowerCase()) ? String(item.on).toLowerCase() : 'build';
    if (said === 'checkable' && check) kinds.push({ kind: 'checkable', check, on });
    else if (said === 'checkable') kinds.push({ kind: 'judgement', downgraded: 'marked checkable but named no check' });
    else if (said === 'judgement' || said === 'judgment') kinds.push({ kind: 'judgement' });
    else kinds.push({ kind: null });
  }
  return { texts, kinds: sawObject ? kinds : null };
}

/** True when a criterion names a property with no threshold or check to tell it by. */
export function isVague(text) {
  return VAGUE.test(text) && !HAS_MEASURE.test(text);
}

/**
 * The counts the board and report.json show. `unclassified` counts plain-string criteria in a run
 * that asked for kinds (a seat that ignored the shape, or a hand-written list without kinds).
 */
export function criteriaSummary(texts, kinds, { metWithoutEvidence = [] } = {}) {
  const k = kinds || texts.map(() => ({ kind: null }));
  const checkable = k.filter(x => x.kind === 'checkable');
  const judgement = k.filter(x => x.kind === 'judgement');
  return {
    total: texts.length,
    checkable: checkable.length,
    checkable_on_plan: checkable.filter(x => x.on === 'plan').length,
    checkable_on_build: checkable.filter(x => x.on === 'build').length,
    judgement: judgement.length,
    unclassified: k.filter(x => !x.kind).length,
    downgraded: k.filter(x => x.downgraded).length,
    vague: texts.filter((t, i) => k[i]?.kind !== 'checkable' && isVague(t)).length,
    met_without_evidence: metWithoutEvidence.length,
  };
}

/** The per-criterion record report.json carries, index-aligned with `criteria`. */
export function kindsRecord(texts, kinds) {
  return texts.map((criterion, i) => {
    const k = kinds?.[i] || { kind: null };
    return {
      criterion,
      kind: k.kind,
      ...(k.kind === 'checkable' ? { check: k.check, on: k.on } : {}),
      ...(k.downgraded ? { downgraded: k.downgraded } : {}),
      ...(k.kind !== 'checkable' && isVague(criterion) ? { vague: true } : {}),
    };
  });
}

/**
 * The block critic and handoff prompts get: which numbered criteria are checkable and how each
 * is settled. Numbering matches the "# Acceptance criteria" list those prompts already print.
 * Empty when nothing is checkable, so the prompt stays byte-identical in that case.
 */
export function checksSection(texts, kinds, heading = '# How the checkable criteria are settled') {
  if (!kinds) return '';
  const rows = texts
    .map((t, i) => ({ n: i + 1, k: kinds[i] }))
    .filter(r => r.k?.kind === 'checkable')
    .map(r => `${r.n}. Check: ${r.k.check} (runs on the ${r.k.on === 'plan' ? 'plan document itself' : 'build'})`);
  if (!rows.length) return '';
  return `\n\n${heading}\n\nEvery criterion not listed here is a judgement criterion.\n\n${rows.join('\n')}`;
}

/**
 * MET rows a critic gave a checkable criterion with no evidence text. Reported, never flipped to
 * FAILED: rewriting a verdict mechanically would turn a formatting slip into a paid revise round
 * and put the harness's words in a lab's mouth. The count goes on the board so a person sees it.
 */
export function unevidencedCheckableMets(critique, texts, kinds) {
  if (!kinds || !critique || !Array.isArray(critique.criteria)) return [];
  const checkable = new Set(texts.filter((_, i) => kinds[i]?.kind === 'checkable').map(t => t.trim()));
  if (!checkable.size) return [];
  return critique.criteria
    .filter(r => r && typeof r === 'object' && String(r.verdict || '').toUpperCase() === 'MET')
    .filter(r => checkable.has(String(r.criterion || '').trim()))
    .filter(r => String(r.evidence || '').trim().length < 8)
    .map(r => String(r.criterion).trim());
}

/** One line for BOARD.md and the run log. */
export function summaryLine(s) {
  const parts = [`${s.checkable} checkable (${s.checkable_on_plan} on the plan, ${s.checkable_on_build} at build)`, `${s.judgement} judgement`];
  if (s.unclassified) parts.push(`${s.unclassified} unclassified`);
  if (s.downgraded) parts.push(`${s.downgraded} marked checkable with no check, counted as judgement`);
  if (s.vague) parts.push(`${s.vague} vague`);
  if (s.met_without_evidence) parts.push(`${s.met_without_evidence} checkable MET with no evidence`);
  return `Acceptance criteria: ${s.total} - ${parts.join(', ')}.`;
}

/**
 * A hand-written criteria file for `--criteria <file>`: JSON (an array, or `{ "criteria": [...] }`,
 * items strings or kind objects) or plain text/markdown (one criterion per non-empty line; a
 * leading "- ", "* " or "1. " is stripped; lines starting with "#" are headings and skipped).
 */
export function parseCriteriaFile(text, name = 'criteria file') {
  const trimmed = String(text).trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let parsed;
    try { parsed = JSON.parse(trimmed); } catch (err) { throw new Error(`${name}: not valid JSON (${err.message})`); }
    const list = Array.isArray(parsed) ? parsed : parsed?.criteria;
    if (!Array.isArray(list) || !list.length) throw new Error(`${name}: expected a non-empty array or { "criteria": [...] }`);
    return list;
  }
  const list = trimmed.split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => l.replace(/^([-*]|\d+[.)])\s+/, ''))
    .filter(Boolean);
  if (!list.length) throw new Error(`${name}: no criteria found`);
  return list;
}
