// The split contract (0.8.3 M3; PLAN 5.1-5.4, decision D4). Pure and $0: strings in, findings out. No file, no clock, no model.
//
// A plan that a recursive-councils tree may expand carries ONE fenced block marked `the-high-council:tree-split` holding JSON (PLAN 5.1): for every milestone of the plan a status (`ready`, `decompose` or
// `needs-decision`), the class of every locked criterion (`global`, `delegated`, `root-only`), one child per `decompose` milestone, and the agreements between siblings. This module reads that block and applies
// the eight mechanical checks of PLAN 5.3. It never judges whether a split is GOOD (the judges do, PLAN 5.2) and it never marks anything ready: a milestone's size or depth is not a field of the block.
//
// A finding is { check, rule, message, ... }: `check` is the number of PLAN 5.3, `rule` a stable name a test and a refusal can quote, `message` plain words naming the field. `valid` is "no finding". Two checks need
// what only the tree knows and are applied only when the caller passes it: `inheritedGlobal` (check 3, below the root: the criterion ids whose obligation says originClass global) and `ancestorQuestions`
// (check 8: the open questions of the ancestors). The report.json field (`split_contract`) is the block-local result; the tree applies the rest again at expansion.
import { canonicalJson, sha256Of } from './thin-contract.js';
import { maskFences } from './milestones.js';

export const SPLIT_MARKER = 'the-high-council:tree-split';
export const MILESTONE_STATUSES = Object.freeze(['ready', 'decompose', 'needs-decision']);
export const CRITERION_CLASSES = Object.freeze(['global', 'delegated', 'root-only']);

const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const plain = s => norm(String(s ?? '').replace(/[*_`]/g, '')).toLowerCase();
const isStr = v => typeof v === 'string';
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const strList = v => Array.isArray(v) && v.every(isStr);

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- finding the block

/**
 * The marked fences of a text: [{ line, text, closed }], `line` the 1-based line of the opening fence. A fence is marked when its info string is exactly the marker. A marked fence INSIDE another fence (an example in a
 * longer fence) is text, not a block. An unclosed marked fence is reported with closed:false (it holds the rest of the text).
 */
export function extractSplitBlocks(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const found = [];
  let open = null;                                   // { char, len, marked, line, start }
  lines.forEach((raw, i) => {
    if (!open) {
      const m = raw.match(/^ {0,3}(`{3,}|~{3,})\s*(.*?)\s*$/);
      if (m && !(m[1][0] === '`' && m[2].includes('`'))) open = { char: m[1][0], len: m[1].length, marked: m[2] === SPLIT_MARKER, line: i + 1, start: i + 1 };
      return;
    }
    const m = raw.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
    if (m && m[1][0] === open.char && m[1].length >= open.len) {
      if (open.marked) found.push({ line: open.line, text: lines.slice(open.start, i).join('\n'), closed: true });
      open = null;
    }
  });
  if (open?.marked) found.push({ line: open.line, text: lines.slice(open.start).join('\n'), closed: false });
  return found;
}

/** The headings of a text outside code fences: [{ level, text, line }] (1-based line of the masked text, which keeps every line). */
export function headingsOf(text) {
  const masked = maskFences(String(text ?? '').replace(/\r\n?/g, '\n'));
  const out = [];
  masked.split('\n').forEach((l, i) => { const m = l.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/); if (m) out.push({ level: m[1].length, text: m[2], line: i + 1 }); });
  return out;
}

/**
 * The plan's milestone sections, read the way src/milestones.js parseMilestones reads them (`### M<n> - title` under a `## Milestones` heading, fences masked): [{ id, title, heading, section }] where `heading` is the
 * heading line's text ("M2 - Web layer") and `section` the text under it up to the next `###`/`####` heading or the next `## `, whitespace normalised. `found` is whether the `## Milestones` heading exists.
 */
export function planMilestones(text) {
  const masked = maskFences(String(text ?? '').replace(/\r\n?/g, '\n')).replace(/\*\*|__/g, '');
  const h = /^##\s+Milestones\s*$/im.exec(masked);
  if (!h) return { found: false, milestones: [] };
  const after = masked.slice(h.index + h[0].length);
  const next = /^##\s+\S/m.exec(after);
  const section = next ? after.slice(0, next.index) : after;
  const parts = section.split(/^(#{3,4})\s+/m);          // [before, '###', 'M1 - x\n...', '###', ...]
  const milestones = [];
  for (let i = 1; i < parts.length; i += 2) {
    const [head, ...rest] = parts[i + 1].split('\n');
    const m = head.match(/^(M\d+)\s*[-:–—]?\s*(.*)$/);
    if (!m) continue;
    milestones.push({ id: m[1], title: norm(m[2]), heading: norm(head), section: norm(rest.join('\n')) });
  }
  return { found: true, milestones };
}

/** Does `basis` name a real section of the plan? C&C, 8 Oct (DECISIONS): it matches a heading line (`#`..`####` text, whitespace and emphasis normalised); a heading of fewer than 3 words must equal the WHOLE basis (a substring would let "Scope" or "Risks" pass anything). The milestone headings and the `Milestones` heading are not sections that settle a milestone. */
export function basisNamesHeading(basis, headings) {
  const b = plain(basis);
  const bare = b.replace(/^[#§\s"'`]+|[\s"'`.:;,]+$/g, '');
  if (!b) return false;
  for (const h of headings) {
    if (h.level > 4) continue;
    const t = plain(h.text);
    if (!t || /^m\d+\b/.test(t) || t === 'milestones') continue;
    if (t.split(' ').length >= 3 ? b.includes(t) : bare === t) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- the shape of the block

/** Shape errors of a parsed block, each naming its path: [] when the fields the checks read are all present and typed. */
function shapeErrors(b) {
  const errs = [];
  const bad = (path, want) => errs.push(`${path}: ${want}`);
  if (!isObj(b)) return ['the block is not a JSON object'];
  for (const k of ['milestones', 'classes', 'children', 'agreements']) if (!Array.isArray(b[k])) bad(k, 'must be a list');
  if (errs.length) return errs;
  b.milestones.forEach((m, i) => {
    if (!isObj(m)) return bad(`milestones[${i}]`, 'must be an object');
    for (const k of ['id', 'status', 'basis']) if (!isStr(m[k])) bad(`milestones[${i}].${k}`, 'must be a string');
    if (!(m.open_question === null || isStr(m.open_question))) bad(`milestones[${i}].open_question`, 'must be null or a string');
  });
  b.classes.forEach((c, i) => {
    if (!isObj(c)) return bad(`classes[${i}]`, 'must be an object');
    for (const k of ['id', 'class']) if (!isStr(c[k])) bad(`classes[${i}].${k}`, 'must be a string');
  });
  b.children.forEach((c, i) => {
    if (!isObj(c)) return bad(`children[${i}]`, 'must be an object');
    for (const k of ['id', 'milestone', 'scope']) if (!isStr(c[k])) bad(`children[${i}].${k}`, 'must be a string');
    for (const k of ['inherits', 'obligations', 'context_refs']) if (!strList(c[k])) bad(`children[${i}].${k}`, 'must be a list of strings');
    for (const k of ['provides', 'expects']) {
      if (!Array.isArray(c[k])) { bad(`children[${i}].${k}`, 'must be a list'); continue; }
      c[k].forEach((e, j) => { if (!isObj(e) || !isStr(e.sibling) || !strList(e.agreements)) bad(`children[${i}].${k}[${j}]`, 'must be { sibling, agreements: [ids] }'); });
    }
  });
  b.agreements.forEach((a, i) => {
    if (!isObj(a)) return bad(`agreements[${i}]`, 'must be an object');
    for (const k of ['id', 'from', 'to', 'what', 'integration_check']) if (!isStr(a[k])) bad(`agreements[${i}].${k}`, 'must be a string');
    if (!strList(a.provider_refs)) bad(`agreements[${i}].provider_refs`, 'must be a list of strings');
  });
  return errs;
}

/** The block as canonical JSON's sha256 (the one canonical form behind every hash here, src/thin-contract.js). */
export const splitSha256 = block => sha256Of(canonicalJson(block));

/** The first field at which two blocks differ, as a path (`children[1].scope`), or null when they are the same. Keys are compared as a set (canonical form), lists in order. */
export function firstDifference(a, b, path = '') {
  const show = v => { const s = JSON.stringify(v); return s === undefined ? 'missing' : s.length > 80 ? `${s.slice(0, 77)}...` : s; };
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (i >= a.length || i >= b.length) return { path: `${path}[${i}]`, expected: i < a.length ? show(a[i]) : 'missing', actual: i < b.length ? show(b[i]) : 'missing' };
      const d = firstDifference(a[i], b[i], `${path}[${i}]`); if (d) return d;
    }
    return null;
  }
  if (isObj(a) && isObj(b)) {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      if (!(k in a) || !(k in b)) return { path: path ? `${path}.${k}` : k, expected: k in a ? show(a[k]) : 'missing', actual: k in b ? show(b[k]) : 'missing' };
      const d = firstDifference(a[k], b[k], path ? `${path}.${k}` : k); if (d) return d;
    }
    return null;
  }
  return canonicalJson(a) === canonicalJson(b) ? null : { path: path || '(the block)', expected: show(a), actual: show(b) };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- the eight checks

/**
 * PLAN 5.3 on one plan text. { present, blockCount, sha256, valid, findings, block }.
 *   text              the plan (the model-written body of deliverable.md)
 *   criteriaIds       this run's locked criterion ids (`C1`, `C2`, ... positional)
 *   inheritedGlobal   at a node below the root: the criterion ids whose obligation identity has originClass global (check 3). Absent at the root.
 *   ancestorQuestions the ancestors' open questions (check 8: a decompose milestone may not repeat one)
 * `present` is false when the text holds no marked fence at all (the caller says "no split": that is not a finding about a block).
 */
export function checkSplit({ text, criteriaIds = [], inheritedGlobal = [], ancestorQuestions = [] } = {}) {
  const findings = [];
  const add = (check, rule, message, extra = {}) => findings.push({ check, rule, message, ...extra });
  const blocks = extractSplitBlocks(text);
  if (!blocks.length) return { present: false, blockCount: 0, sha256: null, valid: false, findings: [], block: null };
  // 1. exactly one block, and it parses
  if (blocks.length > 1) add(1, 'two_blocks', `the plan holds ${blocks.length} blocks marked ${SPLIT_MARKER} (lines ${blocks.map(b => b.line).join(', ')}); it must hold exactly one`);
  const first = blocks[0];
  if (!first.closed) add(1, 'block_unclosed', `the block at line ${first.line} is never closed`);
  let block = null;
  try { block = JSON.parse(first.text); } catch (e) { add(1, 'block_json', `the block at line ${first.line} does not parse as JSON (${String(e.message).slice(0, 80)})`); }
  if (block !== null) for (const e of shapeErrors(block)) add(1, 'shape', `the block's field ${e}`);
  if (block === null || findings.some(f => f.rule === 'shape')) return { present: true, blockCount: blocks.length, sha256: block === null ? null : splitSha256(block), valid: false, findings, block };

  const ms = block.milestones; const classes = block.classes; const kids = block.children; const agrs = block.agreements;
  const dup = (list, key) => { const seen = new Set(); const d = new Set(); for (const x of list) { if (seen.has(x[key])) d.add(x[key]); seen.add(x[key]); } return [...d]; };
  for (const id of dup(ms, 'id')) add(1, 'duplicate_milestone_id', `milestone id ${id} appears more than once in the block`, { id });
  for (const id of dup(kids, 'id')) add(1, 'duplicate_child_id', `child id ${id} appears more than once in the block`, { id });
  for (const id of dup(agrs, 'id')) add(1, 'duplicate_agreement_id', `agreement id ${id} appears more than once in the block`, { id });
  // exact coverage both ways: the plan's `### M<n> - title` headings under `## Milestones` and the block's milestone ids
  const plan = planMilestones(text);
  const planIds = plan.milestones.map(m => m.id);
  for (const id of dup(plan.milestones, 'id')) add(1, 'duplicate_plan_milestone', `the plan has the milestone heading ${id} more than once`, { id });
  for (const id of planIds) if (!ms.some(m => m.id === id)) add(1, 'milestone_missing_from_block', `the plan's milestone ${id} is not in the block (every milestone heading appears in the block exactly once)`, { id });
  for (const m of ms) if (!planIds.includes(m.id)) add(1, 'milestone_not_in_plan', `the block's milestone ${m.id} names no milestone heading of the plan`, { id: m.id });

  // 2. each milestone has exactly one status; ready has a basis naming a plan section and no open question; the others have an open question
  const headings = headingsOf(text);
  ms.forEach((m, i) => {
    if (!MILESTONE_STATUSES.includes(m.status)) return add(2, 'bad_status', `milestones[${i}] (${m.id}): status "${m.status}" is not one of ${MILESTONE_STATUSES.join(', ')}`, { id: m.id });
    if (!norm(m.basis)) add(2, 'missing_basis', `milestones[${i}] (${m.id}): basis is empty`, { id: m.id });
    if (m.status === 'ready') {
      if (m.open_question !== null) add(2, 'ready_with_question', `milestones[${i}] (${m.id}): a ready milestone has no open_question (it is null), found ${JSON.stringify(m.open_question).slice(0, 60)}`, { id: m.id });
      if (norm(m.basis) && !basisNamesHeading(m.basis, headings)) add(2, 'basis_names_no_section', `milestones[${i}] (${m.id}): the basis of a ready milestone names a section of the plan (a heading's text); "${norm(m.basis).slice(0, 60)}" matches none`, { id: m.id });
    } else if (!isStr(m.open_question) || !norm(m.open_question)) add(2, 'missing_open_question', `milestones[${i}] (${m.id}): a ${m.status} milestone has a non-empty open_question`, { id: m.id });
  });

  // 3. classes: every locked criterion id exactly one class; inherits exist and are delegated; every delegated id inherited by some child; below the root a global obligation stays global
  const classOf = new Map();
  classes.forEach((c, i) => {
    if (!CRITERION_CLASSES.includes(c.class)) add(3, 'bad_class', `classes[${i}] (${c.id}): class "${c.class}" is not one of ${CRITERION_CLASSES.join(', ')}`, { id: c.id });
    if (classOf.has(c.id)) add(3, 'duplicate_class', `criterion ${c.id} is classed more than once`, { id: c.id });
    if (!criteriaIds.includes(c.id)) add(3, 'unknown_criterion', `classes[${i}] names ${c.id}, which is not one of this run's locked criteria (${criteriaIds[0] ?? 'none'}..${criteriaIds[criteriaIds.length - 1] ?? 'none'})`, { id: c.id });
    classOf.set(c.id, c.class);
  });
  for (const id of criteriaIds) if (!classOf.has(id)) add(3, 'unclassed_criterion', `the locked criterion ${id} has no class (global, delegated or root-only)`, { id });
  kids.forEach((k, i) => k.inherits.forEach(id => { if (classOf.get(id) !== 'delegated') add(3, 'inherits_not_delegated', `children[${i}] (${k.id}) inherits ${id}, which is ${classOf.has(id) ? `classed ${classOf.get(id)}` : 'not a classed criterion'}; only delegated criteria are inherited`, { id }); }));
  for (const [id, cls] of classOf) if (cls === 'delegated' && !kids.some(k => k.inherits.includes(id))) add(3, 'delegated_not_inherited', `the criterion ${id} is classed delegated but no child inherits it`, { id });
  for (const id of inheritedGlobal) if (classOf.get(id) !== 'global') add(3, 'global_narrowed', `the criterion ${id} is an ancestor's global obligation: it must be classed global again, found ${classOf.has(id) ? classOf.get(id) : 'no class'} (a descendant cannot narrow it)`, { id });

  // 4. decompose milestones and children map one to one (the NUMBER of children is a limit applied at admission, not here)
  const msById = new Map(ms.map(m => [m.id, m]));
  for (const m of ms) if (m.status === 'decompose' && kids.filter(k => k.milestone === m.id).length === 0) add(4, 'decompose_without_child', `the decompose milestone ${m.id} has no child`, { id: m.id });
  for (const m of ms) { const n = kids.filter(k => k.milestone === m.id).length; if (n > 1) add(4, 'milestone_with_many_children', `the milestone ${m.id} has ${n} children; each decompose milestone has exactly one`, { id: m.id }); }
  kids.forEach((k, i) => {
    const m = msById.get(k.milestone);
    if (!m) add(4, 'child_milestone_missing', `children[${i}] (${k.id}): its milestone ${k.milestone} is not a milestone of the block`, { id: k.id });
    else if (m.status !== 'decompose') add(4, 'child_milestone_not_decompose', `children[${i}] (${k.id}): its milestone ${k.milestone} is ${m.status}, not decompose`, { id: k.id });
  });

  // 5. agreements complete and symmetric. An asymmetry is reported from FOUR places on purpose (a child's provides, a child's expects, and the agreement's own `from` and `to`): each looks at the same agreement from a
  // different record, and a block can be wrong in only one of them, so no single site is trusted to see every fault. The mutation script's Y2 turns one off (still red-free by design); Y2b turns all four off (red).
  const kidIds = new Set(kids.map(k => k.id));
  const agrById = new Map(agrs.map(a => [a.id, a]));
  const entryOf = (k, dir, sibling) => k[dir].find(e => e.sibling === sibling);
  for (const k of kids) {
    for (const dir of ['provides', 'expects']) {
      for (const e of k[dir]) if (!kidIds.has(e.sibling) || e.sibling === k.id) add(5, 'unknown_sibling', `${k.id}.${dir} names ${e.sibling}, which is not another child`, { id: k.id });
      for (const s of kids) if (s.id !== k.id && !entryOf(k, dir, s.id)) add(5, 'sibling_missing', `${k.id}.${dir} has no entry for the sibling ${s.id} (an explicit empty list counts, a missing sibling does not)`, { id: k.id, sibling: s.id });
    }
    for (const e of k.provides) for (const a of e.agreements) {
      const other = kids.find(s => s.id === e.sibling);
      if (other && !(entryOf(other, 'expects', k.id)?.agreements ?? []).includes(a)) add(5, 'asymmetric_agreement', `${k.id} provides ${a} to ${e.sibling}, but ${e.sibling} does not expect it from ${k.id}`, { id: a });
      const ag = agrById.get(a);
      if (!ag) add(5, 'unknown_agreement', `${k.id}.provides lists ${a}, which is not in agreements`, { id: a });
      else if (ag.from !== k.id || ag.to !== e.sibling) add(5, 'agreement_endpoints', `${a} is provided by ${k.id} to ${e.sibling} but the agreement says from ${ag.from} to ${ag.to}`, { id: a });
    }
    for (const e of k.expects) for (const a of e.agreements) {
      const other = kids.find(s => s.id === e.sibling);
      if (other && !(entryOf(other, 'provides', k.id)?.agreements ?? []).includes(a)) add(5, 'asymmetric_agreement', `${k.id} expects ${a} from ${e.sibling}, but ${e.sibling} does not provide it to ${k.id}`, { id: a });
      const ag = agrById.get(a);
      if (!ag) add(5, 'unknown_agreement', `${k.id}.expects lists ${a}, which is not in agreements`, { id: a });
      else if (ag.from !== e.sibling || ag.to !== k.id) add(5, 'agreement_endpoints', `${a} is expected by ${k.id} from ${e.sibling} but the agreement says from ${ag.from} to ${ag.to}`, { id: a });
    }
  }
  agrs.forEach((a, i) => {
    if (!kidIds.has(a.from)) add(5, 'agreement_endpoints', `agreements[${i}] (${a.id}): from ${a.from} names no child`, { id: a.id });
    if (!kidIds.has(a.to)) add(5, 'agreement_endpoints', `agreements[${i}] (${a.id}): to ${a.to} names no child`, { id: a.id });
    const from = kids.find(k => k.id === a.from); const to = kids.find(k => k.id === a.to);
    if (from && !(entryOf(from, 'provides', a.to)?.agreements ?? []).includes(a.id)) add(5, 'asymmetric_agreement', `${a.id} is not in ${a.from}'s provides for ${a.to}`, { id: a.id });
    if (to && !(entryOf(to, 'expects', a.from)?.agreements ?? []).includes(a.id)) add(5, 'asymmetric_agreement', `${a.id} is not in ${a.to}'s expects from ${a.from}`, { id: a.id });
    if (!norm(a.integration_check)) add(5, 'missing_integration_check', `agreements[${i}] (${a.id}) has no integration_check`, { id: a.id });
    if (!a.provider_refs.some(r => norm(r))) add(5, 'missing_provider_refs', `agreements[${i}] (${a.id}) has no provider_refs heading`, { id: a.id });
  });

  // 6. the provides/expects graph is acyclic (an edge runs from the provider to the child that waits for it)
  const edges = new Map(kids.map(k => [k.id, new Set()]));
  const edge = (from, to) => { if (edges.has(from) && edges.has(to) && from !== to) edges.get(from).add(to); };
  for (const a of agrs) edge(a.from, a.to);
  for (const k of kids) { for (const e of k.provides) if (e.agreements.length) edge(k.id, e.sibling); for (const e of k.expects) if (e.agreements.length) edge(e.sibling, k.id); }
  const color = new Map(); const stack = [];
  const visit = id => {
    color.set(id, 1); stack.push(id);
    for (const next of edges.get(id)) {
      if (color.get(next) === 1) return [...stack.slice(stack.indexOf(next)), next];
      if (!color.has(next)) { const c = visit(next); if (c) return c; }
    }
    stack.pop(); color.set(id, 2); return null;
  };
  for (const id of edges.keys()) if (!color.has(id)) { const c = visit(id); if (c) { add(6, 'cycle', `the provides/expects graph has a cycle: ${c.join(' -> ')}`, { path: c }); break; } }

  // 7. depth is not a validity check (applied at admission). 8. a child's scope is not its milestone's own text; a decompose milestone's question is not an ancestor's
  kids.forEach((k, i) => {
    const sec = plan.milestones.find(p => p.id === k.milestone);
    const scope = norm(k.scope);
    if (sec && scope && [sec.title, sec.heading, sec.section].some(t => t && t === scope)) add(8, 'scope_identical', `children[${i}] (${k.id}): its scope is identical to its milestone ${k.milestone}'s own text (a child narrows its parent's milestone)`, { id: k.id });
  });
  const asked = new Set(ancestorQuestions.map(norm).filter(Boolean));
  for (const m of ms) if (m.status === 'decompose' && isStr(m.open_question) && asked.has(norm(m.open_question))) add(8, 'repeated_question', `the decompose milestone ${m.id} asks the question an ancestor already asked: "${norm(m.open_question).slice(0, 80)}"`, { id: m.id });

  return { present: true, blockCount: blocks.length, sha256: splitSha256(block), valid: findings.length === 0, findings, block };
}

/** The additive report.json field `split_contract` ({ sha256, valid, findings[] }) for a plan, or null when the plan holds no marked block. Block-local: the tree applies the rest again at expansion. Never changes `passed`. */
export function splitContractOf({ text, criteriaIds = [] }) {
  const r = checkSplit({ text, criteriaIds });
  return r.present ? { sha256: r.sha256, valid: r.valid, findings: r.findings.map(({ check, rule, message }) => ({ check, rule, message })) } : null;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- the body of a delivered file

/**
 * The model-written body of deliverable.md: the file without the harness's notes, which go ABOVE it and each end with a `---` line (src/chain.js, the dissent block and the cold-read block). The body is the suffix
 * whose sha256 equals `delivered_text.body_sha256`. Returns { body } or { error }; with no match it is a refusal naming `delivered_text.body_sha256`, never a fallback to the whole file.
 */
export function bodyOfDelivered(deliverableText, delivered) {
  const text = String(deliverableText ?? '');
  const want = delivered?.body_sha256;
  if (!isStr(want)) return { error: 'report.json has no delivered_text.body_sha256' };
  const notes = Array.isArray(delivered?.harness_notes) ? delivered.harness_notes.length : 0;
  const starts = notes === 0 ? [0] : [...text.matchAll(/^---\n/gm)].map(m => m.index + m[0].length);
  for (const at of starts) { const body = text.slice(at); if (sha256Of(body) === want) return { body }; }
  return { error: `no part of deliverable.md hashes to delivered_text.body_sha256 (${want.slice(0, 12)}): the file is not the harness's notes followed by the body the run delivered` };
}
