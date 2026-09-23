// src/argued.js
//
// "How this plan was argued" (opt-in, `argued: { enabled: true }`, off by default and enabled in no
// shipped chain). Muad, 2026-09-23 ("let's do #3"): the labs' arguments are part of the product,
// including for beginner developers. Research intake 2 (Review/ResearchIntake2_MeasuringPlans_
// 2026-09-23.md, item 7) files it as MIGHT-WANT and says plainly that its usefulness to beginners is
// an inference, not a measurement - so this module makes no quality claim, only a traceability one.
//
// The stage runs once, after the handoff, on the handoff seat (seats.argued || seats.handoff ||
// seats.builder). In the plan-7 chains that seat is an external Claude Code session, so it adds no
// API call; a billed seat goes through invoke() and --dry-run prices an `argued` row.
//
// The writer never sees raw run prose alone. It gets a FACT PACK built here from the run's own
// structured record - ids, edges, stances, counts - with short excerpts, and every fact the pack
// carries has an id. The prompt requires a cited id on every claim; checkArguedRefs() then flags any
// id or lab the section names that the pack does not contain. A flag is recorded (WARNINGS.md and
// report.json), never silently dropped and never silently fixed: the text is the writer's, the
// check is the harness's.
import { realDebate, isCanary } from './canary.js';

export const ARGUED_FILE = 'ARGUED.md';
export const ARGUED_LABEL = 'argued';
const EXCERPT = 600;
const TOP_OBJECTIONS = 5;

const clip = (s, n = EXCERPT) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// The plan's "Decisions" section (the decision records, src/roles.js DECISIONS_RULE_BUILDER), kept
// verbatim so the writer can quote "why the others lost" rather than retell it. Null when the plan
// has none. A heading of any level whose text is "Decisions" (optionally numbered), up to the next
// heading of the same or a higher level.
export function decisionsSection(plan) {
  const lines = String(plan || '').split('\n');
  const start = lines.findIndex(l => /^#{1,6}\s+(?:§?\d+(?:\.\d+)*[.)]?\s+)?Decisions\b/i.test(l.trim()));
  if (start < 0) return null;
  const level = lines[start].trim().match(/^#+/)[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].trim().match(/^(#+)\s/);
    if (m && m[1].length <= level) { end = i; break; }
  }
  const text = lines.slice(start, end).join('\n').trim();
  return text.length > 8000 ? `${text.slice(0, 7999)}…` : text;
}

const signoffWord = s => s.passed ? 'passed (declined to give a verdict)'
  : s.signedOff === true ? 'signed off'
  : s.signedOff === false ? 'objected'
  : 'not heard';

// Everything the writer may say, each item carrying an id it can cite. `scoreRows` is
// scoreProposals(proposals, plan).rows (the plan's own accepted/cut/withdrawn record per proposal).
export function buildArguedFacts({ proposals = [], scoreRows = [], debate = null, alternatives = null, disputes = [], dispute = null, signoff = null, panelVerdicts = [], plan = '' }) {
  const real = realDebate(debate) || { posts: [], replies: [] };
  const posts = (real.posts || []).map((p, i) => ({ ref: `P${i + 1}`, by: p.by, on: p.on, stance: p.stance, text: clip(p.text), ...(p.merge_with ? { merge_with: p.merge_with } : {}) }));
  const replies = (real.replies || []).map((r, i) => ({ ref: `R${i + 1}`, by: r.by || proposals.find(p => p.id === r.id)?.lab || null, on: r.id, action: r.action, text: clip(r.text), ...(r.replaced_by ? { replaced_by: r.replaced_by } : {}) }));
  const statusOf = id => scoreRows.find(r => r.id === id)?.status || 'unaccounted';

  const props = proposals.filter(p => !isCanary(p)).map(p => ({
    id: p.id, lab: p.lab, title: clip(p.title, 160),
    in_plan: statusOf(p.id),
    ...(p.amended ? { amended: true } : {}),
    ...(p.withdrawn ? { withdrawn: true, ...(p.replaced_by ? { replaced_by: p.replaced_by } : {}) } : {}),
  }));

  // The objections that moved something, most consequential first: a withdrawal it caused, then an
  // amendment, then a part the plan cut. A support post is never an objection.
  const weight = { withdraw: 3, amend: 2 };
  const objections = posts.filter(p => p.stance === 'object' || p.stance === 'merge').map(p => {
    const answer = replies.find(r => r.on === p.on);
    const target = props.find(x => x.id === p.on);
    const score = (answer ? weight[answer.action] || 0 : 0) + (target?.in_plan === 'cut' ? 1 : 0);
    return { post: p.ref, by: p.by, on: p.on, stance: p.stance, text: p.text, answer: answer ? { reply: answer.ref, action: answer.action, text: answer.text, ...(answer.replaced_by ? { replaced_by: answer.replaced_by } : {}) } : null, target_in_plan: target?.in_plan || null, score };
  }).sort((a, b) => b.score - a.score);
  const topObjections = objections.slice(0, TOP_OBJECTIONS).map(({ score, ...o }) => o);

  const alt = alternatives ? {
    items: (alternatives.items || []).map(a => ({ id: a.id, lab: a.lab, name: clip(a.name, 160), shape: clip(a.shape), bad_at: clip(a.bad_at, 300), status: a.withdrawn ? 'withdrawn' : a.amended ? 'amended' : 'stood', ...(a.replaced_by ? { replaced_by: a.replaced_by } : {}) })),
    posts: (alternatives.posts || []).map((p, i) => ({ ref: `AP${i + 1}`, by: p.by, on: p.on, stance: p.stance, text: clip(p.text), ...(p.merge_with ? { merge_with: p.merge_with } : {}) })),
    replies: (alternatives.replies || []).map((r, i) => ({ ref: `AR${i + 1}`, by: (alternatives.items || []).find(a => a.id === r.id)?.lab || null, on: r.id, action: r.action, text: clip(r.text) })),
    dropouts: (alternatives.dropouts || []).map(d => ({ lab: d.lab, reason: clip(d.reason, 200) })),
  } : null;

  const declined = (disputes || []).map((d, i) => ({ ref: `D${i + 1}`, round: d.round, reason: clip(d.reason) }));
  const unresolved = dispute?.ran ? {
    reason: dispute.reason,
    open_objections: (dispute.open_objections || []).map((o, i) => ({ ref: `U${i + 1}`, lab: o.lab, criterion: clip(o.criterion, 200), problem: clip(o.problem), first_raised_round: o.first_raised_round })),
    ...(dispute.review ? { review: (dispute.review.entries || []).map((e, i) => ({ ref: `RV${i + 1}`, ...Object.fromEntries(Object.entries(e).map(([k, v]) => [k, typeof v === 'string' ? clip(v) : v])) })) } : {}),
  } : null;

  const labs = [...new Set([
    ...props.map(p => p.lab), ...(alt?.items || []).map(a => a.lab), ...(alt?.dropouts || []).map(d => d.lab),
    ...posts.map(p => p.by), ...(signoff || []).map(s => s.provider), ...(panelVerdicts || []).map(v => v.lab),
  ].filter(l => l && l !== 'canary'))];
  const lastVerdict = new Map(); for (const v of panelVerdicts || []) lastVerdict.set(v.lab, v);
  const stances = labs.map(lab => {
    const mine = props.filter(p => p.lab === lab);
    const n = st => mine.filter(p => p.in_plan === st).length;
    const so = (signoff || []).find(s => s.provider === lab);
    const altMine = alt?.items.find(a => a.lab === lab);
    return {
      lab,
      proposed: mine.length, accepted: n('accepted'), cut: n('cut'), withdrawn: n('withdrawn'),
      objections_raised: posts.filter(p => p.by === lab && p.stance !== 'support').length,
      supports_raised: posts.filter(p => p.by === lab && p.stance === 'support').length,
      ...(altMine ? { alternative: { id: altMine.id, status: altMine.status } } : {}),
      final_verdict: so ? signoffWord(so) : lastVerdict.has(lab) ? lastVerdict.get(lab).verdict.replace(/_/g, ' ') : 'not on the panel',
    };
  });

  const decisions = decisionsSection(plan);
  return {
    labs: stances,
    alternatives: alt,
    decisions: decisions ? { ref: 'DECISIONS', text: decisions } : null,
    proposals: props,
    top_objections: topObjections,
    declined_objections: declined,
    unresolved,
    counts: {
      labs: labs.length,
      alternatives: alt?.items.length || 0,
      proposals: props.length,
      debate_posts: posts.length,
      objections: objections.length,
      withdrawn: props.filter(p => p.withdrawn).length,
      amended: props.filter(p => p.amended).length,
      declined_objections: declined.length,
      unresolved_objections: unresolved?.open_objections.length || 0,
    },
  };
}

// Every id and lab name the fact pack contains - the only things the section may cite.
export function knownRefsOf(facts) {
  const refs = new Set();
  const add = x => { if (x) refs.add(String(x)); };
  (facts.proposals || []).forEach(p => add(p.id));
  (facts.top_objections || []).forEach(o => { add(o.post); add(o.answer?.reply); });
  if (facts.alternatives) {
    facts.alternatives.items.forEach(a => add(a.id));
    facts.alternatives.posts.forEach(p => add(p.ref));
    facts.alternatives.replies.forEach(r => add(r.ref));
  }
  (facts.declined_objections || []).forEach(d => add(d.ref));
  if (facts.unresolved) { facts.unresolved.open_objections.forEach(o => add(o.ref)); (facts.unresolved.review || []).forEach(e => add(e.ref)); }
  if (facts.decisions) add(facts.decisions.ref);
  return { refs, labs: new Set((facts.labs || []).map(l => l.lab)) };
}

export const ARGUED_SECTIONS = ['The big options', 'The objections that changed the plan', 'What is still disputed', 'Where each lab stood'];

export const ARGUED_SYSTEM = `You write "How this plan was argued": a short companion to a finished plan, for a
developer who is new to building software and wants to know why the plan looks the
way it does.

Several AI labs argued over this plan. You are given the plan and a FACT PACK: a JSON
record of what actually happened - which whole architectures were proposed, which
objections were raised and how their authors answered, what the plan did with each
proposed part, what is still disputed, and how each lab voted. Every fact in it has an
id. You did not watch the debate; the fact pack is all you know about it.

Rules:
- Use only the fact pack. Never describe an argument, a lab, an option or a vote that
  is not in it. If a section has nothing in the pack, write "Nothing recorded." under it.
- End every claim about the debate with the ids it rests on, in backticks, e.g.
  (\`P3\`, \`R2\`) or (\`LAB-ALT\`). Write lab names and ids exactly as the pack
  spells them, always in backticks, and use backticks for nothing else.
- Plain language. The first time you use a technical term, gloss it in a few words in
  brackets, e.g. "a queue (a waiting line for jobs)".
- Say why the losing options lost, in the words of the record where you can - the
  "Decisions" text (\`DECISIONS\`) and the objections are the evidence.
- Do not judge which lab was right, and do not say the debate made the plan better.
- Under 700 words.

Write exactly these sections, in this order:

# How this plan was argued

One or two sentences: what this page is, and the counts (labs, options, objections).

## The big options

The whole architectures and major decisions that were on the table, which one the
plan took, and why each other one lost.

## The objections that changed the plan

The three to five most consequential objections: what was objected to, how the author
answered (kept, amended, withdrew), and what that changed in the plan.

## What is still disputed

Objections the labs never settled, and anything the plan's author declined to change.

## Where each lab stood

One line per lab in the pack, in the form:
- \`lab\`: its stance in one sentence.`;

export function arguedUser({ request, plan, facts }) {
  return `# Request\n\n${request}\n\n# Fact pack\n\n\`\`\`json\n${JSON.stringify(facts, null, 2)}\n\`\`\`\n\n# The final plan\n\n${plan}`;
}

const ID_SHAPE = /\b(?:[A-Z][A-Z0-9]*-(?:\d+|ALT)|(?:AP|AR|RV|P|R|D|U)\d+|DECISIONS)\b/g;

// The mechanical check: any id or lab the section names that the fact pack does not contain,
// any lab line naming a lab that was not in the run, labs missing from that list, and missing
// sections. Backticked tokens are the section's own citations (the prompt reserves backticks for
// them); id-shaped tokens outside backticks are checked too. File names (PLAN.md) are not refs.
export function checkArguedRefs(text, facts) {
  const { refs, labs } = knownRefsOf(facts);
  const src = String(text || '');
  const unknownRefs = new Set(); const unknownLabs = new Set(); const cited = new Set();
  const classify = tok => {
    const t = tok.trim();
    if (!t || /\.(md|json)$/i.test(t)) return;
    if (refs.has(t) || labs.has(t)) { cited.add(t); return; }
    if (/^(?:[A-Z][A-Z0-9]*-(?:\d+|ALT)|(?:AP|AR|RV|P|R|D|U)\d+|DECISIONS)$/.test(t)) unknownRefs.add(t);
    else unknownLabs.add(t);
  };
  for (const m of src.matchAll(/`([^`\n]+)`/g)) m[1].split(/\s*,\s*/).forEach(classify);
  // Outside backticks only a token that is plainly one of this run's id families counts: a fact-pack
  // ref shape, an -ALT id, or a proposal-id shape whose tag is a real proposer's. "UTF-8" is prose.
  const tags = new Set([...refs].filter(r => /-(?:\d+|ALT)$/.test(r)).map(r => r.replace(/-(?:\d+|ALT)$/, '')));
  const bare = src.replace(/`[^`\n]+`/g, ' ');
  for (const m of bare.matchAll(ID_SHAPE)) {
    const t = m[0];
    if (refs.has(t)) continue;
    const dash = t.match(/^([A-Z][A-Z0-9]*)-(\d+|ALT)$/);
    if (!dash || dash[2] === 'ALT' || tags.has(dash[1])) unknownRefs.add(t);
  }

  const stoodAt = src.search(/^##\s+Where each lab stood/im);
  const listed = new Set();
  if (stoodAt >= 0) {
    const tail = src.slice(stoodAt).split('\n').slice(1);
    for (const line of tail) {
      if (/^#{1,2}\s/.test(line)) break;
      const m = line.match(/^\s*[-*]\s+\**`?([^`*:]+?)`?\**\s*:/);
      if (m) { listed.add(m[1].trim()); if (!labs.has(m[1].trim())) unknownLabs.add(m[1].trim()); }
    }
  }
  const missingLabs = [...labs].filter(l => !listed.has(l));
  const missingSections = ARGUED_SECTIONS.filter(s => !new RegExp(`^##\\s+${s}`, 'im').test(src));
  return {
    unknown_refs: [...unknownRefs].sort(),
    unknown_labs: [...unknownLabs].sort(),
    missing_labs: missingLabs.sort(),
    missing_sections: missingSections,
    refs_cited: cited.size,
    ok: !unknownRefs.size && !unknownLabs.size && !missingLabs.length && !missingSections.length,
  };
}

// WARNINGS.md lines for a check result; empty when it is clean.
export function arguedWarnings(check) {
  if (!check || check.ok) return [];
  const out = [];
  if (check.unknown_refs.length) out.push(`argued_unknown_ref: ${ARGUED_FILE} cites id(s) the run never produced: ${check.unknown_refs.join(', ')}`);
  if (check.unknown_labs.length) out.push(`argued_unknown_lab: ${ARGUED_FILE} names lab(s) or token(s) not in the run: ${check.unknown_labs.join(', ')}`);
  if (check.missing_labs.length) out.push(`argued_missing_lab: ${ARGUED_FILE} has no stance line for: ${check.missing_labs.join(', ')}`);
  if (check.missing_sections.length) out.push(`argued_missing_section: ${ARGUED_FILE} lacks: ${check.missing_sections.join(', ')}`);
  return out;
}
