// Prompt words: the scope rule, the quote, decision and kinds rules, and the criteria, critic, builder, reviser and proposer system prompts built from them. Moved out of src/roles.js in 0.8.4, words unchanged; src/roles.js re-exports every name the old file exported, and a name exported here beyond those is an internal shared between prompt files.

import { BUILDER_SYSTEM, CRITERIA_SYSTEM_TEMPLATE, CRITIC_SYSTEM_TEMPLATE, REVISER_SYSTEM } from './core.js';
import { PROPOSER_SYSTEM } from './proposals.js';
import { COUNCIL_INTRO, SEVERITY_FIELD, editIf, editOnce, severityRule } from './recorded-083.js';

// ---------------------------------------------------------------------------
// Scope rule (his call, 2026-09-07): "closed" is the default - nobody adds
// scope, the critic polices it. "open" lets every seat add scope freely, each
// addition recorded with its author and reason in a "Scope additions" section;
// the critic then judges additions for consistency, never for restraint, and
// a final human-side verdict pass cuts the result down to a phase. Explicit
// scope creep, then descope, with the creep on record.

const SCOPE = {
  closed: {
    critic: `- Do not propose additions the request did not ask for. Scope creep from a
  critic is worse than a weak draft, because the builder will obey it.`,
    criteria: `Include at least one criterion that forbids scope the request did not ask
for.`,
    builder: '',
    reviser: '',
    proposer: '',
  },
  open: {
    critic: `- Scope is OPEN in this run: additions beyond the request are allowed and are
  never a failure by themselves. Judge an addition only against the request's
  hard constraints and permanent exclusions, and for consistency with the rest
  of the draft. Do fail an addition that is missing from the "Scope additions"
  section, or that has no reason there.`,
    criteria: `Scope is OPEN in this run: do NOT write a criterion that forbids additional
scope. Instead include one criterion that every addition beyond the request is
recorded in a "Scope additions" section with its author and a one-line reason,
and one that the request's permanent exclusions are still absent.`,
    builder: `

# Scope rule for this run: OPEN
You may add features, systems, slices and sections the request did not ask for,
whenever you judge they serve the request's bar. Be generous: a later verdict
pass cuts, you do not have to. Every addition goes into a section titled
"Scope additions" at the end: one line each, "<what> - <why> - added by builder".
Proposals from other labs that you accept are not additions; they are already in
the scope ledger. The request's permanent exclusions stay out.`,
    reviser: `

# Scope rule for this run: OPEN
Beyond fixing the failures, you may add scope the critics did not ask for,
whenever you judge it serves the bar. Record every addition in the existing
"Scope additions" section as "<what> - <why> - added by reviser round N". Never
remove an earlier addition to make room; the verdict pass does the cutting.`,
    proposer: `

# Scope rule for this run: OPEN
Propose beyond the request's candidate themes if you see something the bar
needs. Volume is welcome up to your allowance; a later pass cuts.`,
  },
};

const scopeOf = open => SCOPE[open ? 'open' : 'closed'];
// v7 item 4 (debate freedoms, scoped, gated on chain config `freedoms`): two rights only, both
// opt-in per chain and both a no-op on the prompt when absent, so a chain that never sets
// `freedoms` gets the exact template it always got.
const FREEDOMS_RULE = {
  blocking_questions: '- If one fact would change your verdict and the draft does not state it, you may ask the proposer one blocking question instead of judging this round. Use it sparingly - it costs a round trip, and most ambiguity should be resolved by choosing the reading a careful reader would choose, same as anywhere else.',
  pass: '- If this draft is genuinely outside what you can usefully judge, you may pass instead of a verdict. State why in one sentence. A pass is not a sign-off and not an objection - use it only when a real verdict would not be honest.',
};
// Quote rule (2026-09-20). Added to the critic, criteria and reviser prompts only when the
// task actually carries fenced source - a rule about quoting source that is not there teaches
// a seat to fabricate a quote to satisfy it, which is worse than no rule. See src/fence.js for
// where fenced source comes from and src/quote-check.js for what is done with the quotes.
export const QUOTE_RULE_CRITIC = `
- Some of the task is real source code, fenced verbatim. That fenced text is the ONLY thing you
  know about the repository. It is a partial, hand-picked slice: a file that is not shown may
  still exist, and its absence is not evidence.
- When an objection claims something about the repository - a file, a function, a value, a
  behaviour - put the exact text it rests on in that failure's "quote" field, copied from the
  fenced source. If you cannot find text that supports the claim, you do not know it: either
  drop the claim or state it as a question rather than a defect.
- Never write a "quote" that is not in the fenced source. An invented quote is worse than an
  unsupported objection, because it looks like evidence.`;

export const QUOTE_RULE_CRITERIA = `
- Some of the task is real source code, fenced verbatim, and it is a partial slice. Write no
  criterion that asserts something about the repository unless the fenced source shows it. If a
  criterion depends on something not shown, say so in the criterion itself and mark it
  UNVERIFIED rather than assuming either way.`;

export const QUOTE_RULE_REVISER = `
- Some of the task is real source code, fenced verbatim, and it is the only source anyone in
  this chain has seen. An objection may carry a "quote" from it.
- An objection about the repository with no quote, or with a quote you cannot find in the fenced
  source, has not been checked by anyone. Do not act on its specifics as if they were fact. Fix
  what it points at if the fenced source supports it; otherwise weaken the claim to UNVERIFIED
  and name what would settle it. Do not silently delete the objection, and do not silently
  adopt it.
- When two inputs disagree about a fact about the repository and neither cites the fenced
  source, do not pick one. Keep both possibilities and state the check that decides between
  them.`;

// Decision records (2026-09-23, Muad: structured documents beat free-form chat for architecture -
// "sounds like another great idea"). Opt-in per chain via `decisions: { enabled: true }`, and
// implied by the `alternatives` stage, whose losing architectures have to be recorded somewhere.
// The shape is the familiar decision-record one (context, real options, trade-offs, choice, why
// the losers lost, consequences), written in this project's own words. Absent, every prompt below
// is byte-identical to what it was before decision records existed.
//
// The load-bearing words are "real" and "strawman". A decision record whose second option exists
// only to lose is worse than no record: it looks like deliberation and is not. The criteria rule
// asks reviewers to check exactly that, so the builder's instruction and the reviewers' bar are
// the same bar.
export const DECISIONS_RULE_BUILDER = `

# Decision records for this run
The plan must include a section titled "Decisions". Record every major
architecture decision there - a choice that shapes more than one part of the
plan, or that would be expensive to reverse once building starts. For each:
- Context: the problem the decision answers, in one or two sentences.
- Options considered: at least two real options, each one a design a competent
  team would actually choose in some situation. An option added only so the
  choice looks obvious is a strawman and does not count.
- Trade-offs: what each option costs and what it buys, for this request.
- Choice: the option taken, or the combination and which part came from where.
- Why the others lost: one line per rejected option, naming the specific reason.
- Consequences: what the choice commits the plan to, and what new fact would
  change the call.
Small, cheaply reversed choices need no record. Do not invent decisions to fill
the section.`;

export const DECISIONS_RULE_REVISER = `

# Decision records for this run
Keep the "Decisions" section true. If a fix changes a recorded decision, rewrite
that record - options, trade-offs, why the others lost - rather than leaving the
old reasoning under a new choice. A new major decision gets a new record with at
least two real options. Never delete a record to make an objection go away.`;

export const DECISIONS_RULE_CRITERIA = ` Decision records are required in this run:
include one criterion that every major architecture decision in the plan is
recorded in its "Decisions" section with its context, at least two real options
(designs a competent team might actually choose, not strawmen set up to lose),
the trade-offs, the choice, why each rejected option lost, and what would
change the call.`;

// Criterion kinds (2026-09-25, research brief 02). Opt-in per chain via
// `criteria_kinds: { enabled: true }`; absent, every prompt below is byte-identical to before.
// The criterion text itself stays a property a reader checks in the plan - the plan is what this
// chain grades - and `check` is what settles it once something exists to run it on. That split is
// what keeps a build-time number from being "met" on a plan's say-so: at plan time the reviewer
// can only confirm the plan names the check and designs to pass it, and the handoff carries the
// check to the build session, which runs it.
const CRITERIA_REPLY_SHAPE = `Reply with a single JSON object and nothing else:
{ "criteria": ["...", "..."] }`;

export const KINDS_RULE_CRITERIA = `Give every criterion a kind.
- "checkable": a named command, test or measurement settles it with no reader's
  opinion. Put it in "check" with its pass threshold (for example: "npm audit
  --audit-level=high exits 0"; "p95 latency under 200 ms at 100 concurrent
  requests, measured with the load tool the plan names"; "the plan is under 1500
  words"). Set "on" to "plan" when the check runs on the deliverable document
  itself, or "build" when it runs on what gets built from it. The criterion text
  stays a property a reader can confirm in the deliverable ("commits to p95 under
  200 ms at 100 concurrent requests and names how it is measured").
- "judgement": only a careful reader can settle it. Leave "check" out.
Make a criterion checkable wherever the request honestly allows one; never invent
a threshold the request gives no ground for - a made-up number is worse than a
judgement criterion. A property with no way to tell it holds ("scalable",
"secure", "user-friendly") is neither kind: restate it with a threshold and a
check, or as a judgement criterion that names exactly what the reader looks for.

Reply with a single JSON object and nothing else:
{ "criteria": [
  { "criterion": "...", "kind": "checkable", "check": "...", "on": "plan" | "build" },
  { "criterion": "...", "kind": "judgement" }
] }`;

export const KINDS_RULE_CRITIC = `
- Some criteria are checkable: the section "How the checkable criteria are settled" names the
  command or measurement for each. For those, MET needs evidence of the check, never trust:
  - If a "Ground truth" section carries that check's output, judge by the output alone.
  - A check that runs on the plan document itself and is mechanical (a count, a presence, a
    pointer that must resolve): do it, and put what you counted or found in "evidence".
  - A check that runs on the build cannot run yet. MET then means the draft names that check with
    its threshold and describes a design that could pass it; quote that passage as evidence.
  With no such passage or output, the criterion is FAILED - name the missing check.`;

// Item 28 (Astra's 0.8.2 review, F2; Muad's yes 7 Oct 2026 via C&C): a chain with "selfReview": "allowed" seats the plan's writer on its own panel, and the template's opening told
// that seat it did not write the draft. The writer's seat gets this opening instead (`freedoms.selfReview`, set in src/chain.js criticPromptFor); every other seat keeps the template's.
const CRITIC_OPENING = `You are an independent critic in a multi-model review chain.
You did not write the draft you are reviewing.`;
const CRITIC_OPENING_SELF_REVIEW = `You are a critic in a multi-model review chain.
You wrote the draft you are reviewing: this chain lets its writer judge too. Judge
it as if someone else had written it. The same rules of evidence apply to you
as to every other critic.`;
function criticTemplate(selfReview) {
  if (!selfReview) return CRITIC_SYSTEM_TEMPLATE;
  if (!CRITIC_SYSTEM_TEMPLATE.startsWith(CRITIC_OPENING)) throw new Error('the critic prompt no longer opens with the sentence the self-review opening replaces');
  return CRITIC_OPENING_SELF_REVIEW + CRITIC_SYSTEM_TEMPLATE.slice(CRITIC_OPENING.length);
}

const M2_CLEAN_PASS_OLD = '- Report violations only; no commentary either way, on the draft or on the\n  builder. A clean pass is a first-class result and a common one: if every\n  criterion is met, say so plainly, set meets to true, and stop.';
const M2_CLEAN_PASS_NEW = '- Report violations only in "criteria" and "failures"; no commentary either way,\n  on the draft or on the builder. Any optional proposals and ideas go only in the\n  fields the prompt names for them, if it names any, and stay within the request\'s\n  scope; a requirement the plan misses is an objection, not an idea. A clean pass\n  is a first-class result: if every criterion is met, say so plainly, set meets to\n  true, fill in anything else the prompt asks for, and stop.';
const M2_ANSWERS_ID_OLD = '"id": "<one entry per objection id listed in the prompt section Your objections from the last round, and what happened; leave the whole answers key out when the prompt has no such section>",';
const m2Critic = text => {
  let t = editOnce(text, M2_CLEAN_PASS_OLD, M2_CLEAN_PASS_NEW);
  t = editIf(t, 'Scope creep from a\n  critic is worse than a weak draft, because the builder will obey it.', 'Scope creep from a\n  critic is worse than a weak draft.');
  if (t.includes(M2_ANSWERS_ID_OLD)) t = editOnce(t, M2_ANSWERS_ID_OLD, '"id": "<objection id>",');
  return t;
};

export const COUNCIL_INTRO_ASTRA = COUNCIL_INTRO.replace('LLMs work together on plans', 'LLMs from different labs work together on software-engineering plans');
export function criticSystem(open, freedoms = null) {
  const out = criticSystemBase(open, freedoms);
  return freedoms?.severity === true ? m2Critic(out) : out;
}
function criticSystemBase(open, freedoms = null) {
  const rules = [];
  if (freedoms?.blocking_questions) rules.push(FREEDOMS_RULE.blocking_questions);
  if (freedoms?.pass) rules.push(FREEDOMS_RULE.pass);
  const fields = [];
  if (freedoms?.blocking_questions) fields.push(',\n  "blocking_question": "<optional - a single question that would change your verdict; omit this field entirely on a normal reply>"');
  if (freedoms?.pass) fields.push(',\n  "pass": true,\n  "pass_reason": "<why a verdict would not be honest here - only when \\"pass\\" is true>"');
  return `${COUNCIL_INTRO}\n\n${criticTemplate(freedoms?.selfReview === true)}`
    .replace('__CRITIC_SCOPE_RULE__', scopeOf(open).critic)
    .replace('__CRITIC_FREEDOMS_RULE__', rules.length ? `\n${rules.join('\n')}\n` : '')
    .replace('__CRITIC_SEVERITY_RULE__', () => (freedoms?.severity === true ? `${severityRule(freedoms.severityLedger === true, freedoms.severityHandler === true)}\n` : ''))
    .replace('__CRITIC_SEVERITY_FIELD__', () => (freedoms?.severity === true ? SEVERITY_FIELD : ''))
    .replace('__CRITIC_FREEDOMS_FIELDS__', fields.join(''))
    // The field is advertised only when there is fenced source to quote FROM. Offering a
    // "quote" field with no source present is an invitation to invent one to fill it.
    .replace('__CRITIC_QUOTE_FIELD__', freedoms?.fencedSource
      ? ',\n      "quote": "<required when this objection claims something about the repository: the exact text from the fenced source it rests on. Omit entirely otherwise.>"'
      : '')
    + (freedoms?.fencedSource ? QUOTE_RULE_CRITIC : '')
    + (freedoms?.criteriaKinds ? KINDS_RULE_CRITIC : '');
}
// `fenced` is opt-in per call: absent, every prompt is byte-identical to what it was before
// quote validation existed, so no chain without fenced source changes behaviour at all.
// `opts.decisions` (decision records, above) is opt-in the same way: absent or false, the prompt
// is byte-identical to the one without it.
// `opts.kinds` (criterion kinds, src/criteria-kinds.js) is opt-in the same way: absent, the prompt
// is byte-identical; present, the reply shape at the end of the prompt is swapped for the one
// that carries a kind per criterion.
export const criteriaSystem = (open, fenced = false, opts = {}) => {
  const base = CRITERIA_SYSTEM_TEMPLATE.replace('__CRITERIA_SCOPE_RULE__', scopeOf(open).criteria + (opts.decisions ? DECISIONS_RULE_CRITERIA : ''));
  return (opts.kinds ? base.replace(CRITERIA_REPLY_SHAPE, KINDS_RULE_CRITERIA) : base) + (fenced ? QUOTE_RULE_CRITERIA : '');
};
export const builderSystem = (open, opts = {}) => BUILDER_SYSTEM + scopeOf(open).builder + (opts.decisions ? DECISIONS_RULE_BUILDER : '');
export const reviserSystem = (open, fenced = false, opts = {}) => REVISER_SYSTEM + scopeOf(open).reviser + (fenced ? QUOTE_RULE_REVISER : '') + (opts.decisions ? DECISIONS_RULE_REVISER : '');
export const proposerSystem = open => PROPOSER_SYSTEM + scopeOf(open).proposer;
// Back-compat names for the closed variants.
export const CRITIC_SYSTEM = criticSystem(false);
export const CRITERIA_SYSTEM = criteriaSystem(false);
