// The references of a child (context_refs) and the refusal a derivation gives, in a LEAF module: src/tree-derive.js (the derivation, part 2 and part 4 of context.md) and src/tree-expansion.js (the verification of a split, before
// split_verified) both import the ONE resolver from here, so the two can never disagree and no import cycle runs through the derivation's own imports. Pure: no file, no record.
import { canonicalJson, sha256Of } from './thin-contract.js';
import { headingsOf } from './tree-split.js';

/**
 * A derivation the plan refuses: `code` is `weakened_obligation` or `missing_context` (PLAN 6.2, 6.4); the record keeps it as `blocked` reason expansion_refused with the code as the check.
 * `owner` (D2 F2(a), IN MEMORY only, never recorded): { node, generation } of the plan whose OWN TEXT failed - the parent for its split's references and its acceptance list, the provider for a heading it was promised to hold,
 * the descendant for its ready milestone's basis - or null when the cause is a file or the record (no new plan can fix it). Readiness turns an owned refusal into a stop on that node (src/tree-ready.js).
 */
export class DeriveRefusal extends Error {
  constructor(code, detail, owner = null) { super(`${code}: ${detail}`); this.name = 'DeriveRefusal'; this.code = code; this.detail = detail; this.owner = owner; }
}

/** The headings whose section is a root task's exclusions (C&C, 8 Oct 2026, DECISIONS): whole and case-insensitive. */
export const EXCLUSION_HEADINGS = Object.freeze(['non-goals', 'non-goal', 'exclusions', 'out of scope', 'not in scope']);
const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const missing = (detail, owner = null) => new DeriveRefusal('missing_context', detail, owner);

/** "root-task: Goal" -> { source: 'root-task', heading: 'Goal' }; a reference without a known source document is BARE (source null). Leading Markdown `#` marks are dropped from the heading text. */
function parseRef(ref) {
  const m = String(ref).match(/^(root-task|parent-plan):\s*(\S[\s\S]*)$/);
  const strip = h => norm(String(h).replace(/^\s*#+\s*/, ''));
  return m ? { source: m[1], heading: strip(m[2]) } : { source: null, heading: strip(ref) };
}

/** Every heading of `text` as a section with its byte-for-byte range: [{ text, level, line, start, end }] in document order (`start`/`end` are character offsets; the same slice sectionOf returns). */
function sectionsOf(text) {
  const doc = String(text ?? '');
  const all = headingsOf(doc);
  const lines = doc.split(/(?<=\n)/);
  const at = []; let n = 0; for (const l of lines) { at.push(n); n += l.length; } at.push(n);
  return all.map(h => { const next = all.find(x => x.line > h.line && x.level <= h.level); return { text: norm(h.text), level: h.level, line: h.line, start: at[h.line - 1], end: next ? at[next.line - 1] : doc.length }; });
}
const isExclusion = s => EXCLUSION_HEADINGS.includes(s.text.toLowerCase());
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * resolveContextRefs({ refs, rootTask, parentPlan, owner }) -> { whole: null | { refs: [string] }, root: [piece], plan: [piece], sha256 }   piece = { start, end, heading, label, text }
 * The ONE resolver of a child's context_refs (the owner's decision, Muad 25 Okt 2026 14:45: "Yes to all" on Astra's Q1 = A + X + a restricted B; C&C's rulings of 25 Okt 2026). The verification of a split (src/tree-expansion.js
 * verifySplit) and the derivation of a child (deriveChild, part 2 and part 4 of context.md) ask it, so the two can never disagree. Pure. Throws DeriveRefusal('missing_context', ..., owner): the references are the text of the plan
 * that wrote the split, so `owner` is that plan's node.
 *   - "root-task: <heading>" / "parent-plan: <heading>": the heading must exist exactly once in that document.
 *   - a BARE heading (restricted B): read only when exactly one heading of that text exists across the root task and this plan (no root-first guess); else refused, naming both counts.
 *   - X: every section of the root task under an exclusions heading (EXCLUSION_HEADINGS) is supplied whether or not the split names it, by POSITION (a heading twice is two sections), verbatim; a reference to an exclusions heading
 *     of the root task is covered by that copy and is never looked up on its own (so a doubled "Out of scope" never refuses).
 *   - the goal (CR-AST-001): a root task WITH headings needs at least one named section that is not an exclusions section; the supplied exclusions never count. No parser can tell what a section means: this is mechanical.
 *   - a root task with NO headings (C&C ruling, 25 Okt 2026): the whole file is supplied; a "root-task:" reference resolves to it and is named in its label; a bare reference is looked up in the plan only.
 *   - a range already inside another copied range is not copied again (Astra (d): overlapping selections share one copy). Order: the named sections in reference order, then the supplied exclusions in document order, so a split
 *     that was valid before (prefixed, every exclusions heading named once) gives byte-identical pieces.
 * `sha256` hashes what each reference resolved to (document, range and the bytes), recorded per child at verification (split_verified resolvedRefs).
 */
export function resolveContextRefs({ refs, rootTask, parentPlan, owner = null }) {
  const rootSecs = sectionsOf(rootTask.text); const planSecs = sectionsOf(parentPlan.text);
  const headed = rootSecs.length > 0;
  const rootPicked = []; const planPicked = []; const wholeRefs = []; let exclusionNamed = false;
  for (const ref of refs) {
    const { source, heading } = parseRef(ref);
    const inRoot = headed ? rootSecs.filter(x => x.text === heading) : []; const inPlan = planSecs.filter(x => x.text === heading);
    if (source === 'root-task') {
      if (!headed) { wholeRefs.push(String(ref)); continue; }
      if (inRoot.length && inRoot.every(isExclusion)) { exclusionNamed = true; continue; }
      if (inRoot.length !== 1) throw missing(`root task ${rootTask.name}: the heading ${JSON.stringify(heading)} must exist exactly once, found ${inRoot.length}`, owner);
      rootPicked.push(inRoot[0]);
    } else if (source === 'parent-plan') {
      if (inPlan.length !== 1) throw missing(`parent plan ${parentPlan.name}: the heading ${JSON.stringify(heading)} must exist exactly once, found ${inPlan.length}`, owner);
      planPicked.push(inPlan[0]);
    } else {
      if (inRoot.length && !inPlan.length && inRoot.every(isExclusion)) { exclusionNamed = true; continue; }
      if (inRoot.length + inPlan.length !== 1) throw missing(`the reference ${JSON.stringify(String(ref).slice(0, 80))} is not addressable: the root task holds that heading ${plural(inRoot.length, 'time')} and this plan ${plural(inPlan.length, 'time')}; a reference without "root-task:" or "parent-plan:" is read only when exactly one heading of that text exists in the two`, owner);
      (inRoot.length ? rootPicked : planPicked).push(inRoot[0] ?? inPlan[0]);
    }
  }
  if (headed && !rootPicked.length) {
    if (exclusionNamed) throw missing('the child\'s context_refs name only exclusions sections of the root task, which the harness supplies anyway; name the section that states its goal: "root-task: <heading>"', owner);
    throw missing('the child\'s context_refs name no section of the root task (the goal must be named: "root-task: <heading>")', owner);
  }
  const once = list => list.filter((c, i) => !list.some((x, j) => j !== i && x.start <= c.start && c.end <= x.end && (x.end - x.start > c.end - c.start || j < i)));
  const occurrence = (secs, x) => { const same = secs.filter(y => y.text === x.text); return same.length > 1 ? ` (occurrence ${same.indexOf(x) + 1} of ${same.length})` : ''; };
  const pieceOf = (what, d, secs) => x => ({ start: x.start, end: x.end, heading: x.text, label: `${what} ${d.name} (sha256 ${d.sha256}), heading "${x.text}"${occurrence(secs, x)}`, text: String(d.text).slice(x.start, x.end) });
  const root = headed ? once([...rootPicked, ...rootSecs.filter(isExclusion)]).map(pieceOf('root task', rootTask, rootSecs)) : [];
  const plan = once(planPicked).map(pieceOf('parent plan', parentPlan, planSecs));
  const whole = headed ? null : { refs: wholeRefs };
  const sha256 = sha256Of(canonicalJson({ whole: whole ? sha256Of(String(rootTask.text)) : null, root: root.map(x => [x.start, x.end, sha256Of(x.text)]), plan: plan.map(x => [x.start, x.end, sha256Of(x.text)]) }));
  return { whole, root, plan, sha256 };
}

