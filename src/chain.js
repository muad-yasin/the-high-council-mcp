import { call, keyFor, resolveVendorSeat } from './providers.js';
import { held } from './held-roles.js';
import { handoffPrompt } from './handoff-prompt.js';
import { extraWithHighDefault, retryCapFor, retryCeilingOf } from './reasoning.js';
import { parseDisputes } from './draft-disputes.js';
export { parseDisputes };
import * as R from './roles.js';
import { withLane } from './lanes.js';
import { costOf, summarise, formatUsd, wouldBreach, projectStage, projectAttempts, isAnthropicSeat, needsPrice, SEAT_DEFAULT_MAX_TOKENS, readUsage, readUsd } from './cost.js';
import { requiredDeliverableSections } from './preflight.js';
import { withdrawalLedger } from './withdrawal-ledger.js';
import { applySeatRole } from './seat-role.js';
import { loadPersonas } from './personas.js';
import { NO_TIE_BREAK } from './tie-break.js';
import { runTool as defaultRunTool, ALLOWED_TOOLS, runSeatToolRequests } from './tools.js';
import { runLints } from './lints.js';
import { extractClaims, dropInvalidClaims } from './claims.js';
import { fencedSourceOf, markFailures, quoteWarnings } from './quote-check.js';
import { parsePatches, applyPatches, changedSince } from './patch-revise.js';
import { injectCanary, shouldSampleCanary, runIdUnit, pickCanaryTarget, pickCanaryTargetSeeded, CANARY_NOTE } from './canary.js';
import { readerView, viewRecord, translateRefs } from './debate-order.js';
import { markPostQuote } from './post-quotes.js';
import { buildAnswerBack, answerBackSummary, applyAnswers, stillOpen } from './answer-back.js';
import { runSecurityReviewStage, DEFAULT_SECURITY_REVIEWER_SEAT } from './security-review.js';
import { assertNoDeniedModels, deniedReasonsOf, DeniedModel } from './denied-models.js';
import { promptHashOf, promptSha256Of, cacheVerdict } from './cache-integrity.js';
import { stripLockBlock } from './criteria-lock.js';
import { buildArguedFacts, checkArguedRefs, ARGUED_SYSTEM, arguedUser, ARGUED_LABEL, ARGUED_FILE } from './argued.js';
import { normaliseCriteria, criteriaSummary, kindsRecord, checksSection, unevidencedCheckableMets, summaryLine, MET_VERDICT, FAILED_VERDICT, verdictWord } from './criteria-kinds.js';
import { missingCriteriaRows, signoffTableGap, describeTableGap, outsideCriteriaRows } from './criteria-ledger.js';
import { objectionId, objectionKey, stallSignature } from './objection-ids.js';
import { seededShuffle } from './seeded-shuffle.js';
import { buildTextLabels } from './text-labels.js';
import { lintCriteria } from './criteria-lints.js';
import { runDeepDive, deepDiveFailures } from './deep-dive.js';
import { runAdvise, AdviceStopped } from './advise.js';
import { assertOutboundClean, SecretShapedPrompt } from './outbound-scan.js';
export { DeniedModel };

// v3 §4: the criteria stage's own user prompt, exported so it's testable without running a
// full chain. Tells the criteria seat what the chain's own contract will require in the
// deliverable, so it never writes a criterion that conflicts with a section the builder is
// required to produce - the recurring contract-vs-criteria conflict v2's pre-flight check
// could only warn about after the fact. Reuses the same required-sections data the pre-flight
// check already computes - no new state, no second source of truth.
export function criteriaUserPrompt(request, config) {
  const required = requiredDeliverableSections(config);
  const requiredBlock = required.length
    ? `\n\n# Sections this chain always adds\nThe deliverable will also contain: ${required.join(', ')}.\nDo not write a criterion that forbids this section's presence or dictates an ordering it cannot satisfy.`
    : '';
  return `# Request\n\n${request}${requiredBlock}`;
}

// v7 item 1: tool-grounded verification (relay/runs/2026-09-14T00-20-44-997Z/
// deliverable.md §1). Gated on config.verify.enabled - absent or false keeps
// v6 behaviour byte-for-byte (no ground_truth key on the returned result, no
// tool invocation, this function never called). When enabled, each entry in
// config.verify.tools ({ tool, args? }) is run through the fixed allowlist in
// src/tools.js - never a generic shell executor - and the raw, unedited
// result is both kept for the run record and rendered into a block appended
// to `request`, which every later stage's prompt already threads through, so
// "re-presented unedited to later seats' context" costs no new plumbing.
export function renderGroundTruth(groundTruth, heading = 'Ground truth (tool output, verbatim)') {
  if (!groundTruth.length) return '';
  return `\n\n# ${heading}\n${groundTruth.map(g =>
    `\n## ${g.tool}${g.args && Object.keys(g.args).length ? ` ${JSON.stringify(g.args)}` : ''}\n${JSON.stringify(g.result)}`
  ).join('\n')}`;
}

// v7.3: resource allocator. The disagreement signal is a criterion split
// across the panel THIS round - some voting critics marked it FAILED,
// others didn't - derived from data the unanimous-signoff loop already
// computes (each critique's own `failures[]`), not a new field. Chosen over
// the other two candidates in the proposal (stance values in
// debate.posts[], amend/withdraw counts in debate.replies[]) because it is
// the only one of the three that exists on every unanimous-signoff run: the
// debate stage is itself optional (config.debate), so a chain with no
// debate has no posts/replies to derive disagreement from, but every
// unanimous-signoff run has per-critic failures by construction. A
// criterion unanimously failed (every voting critic) or unanimously passed
// (no voting critic) is not disagreement - it is consensus, agreeing or
// not - and is excluded. Among genuinely split criteria, the one closest to
// an even split (min(failedCount, votingCount - failedCount), maximized) is
// the single most contested, and gets the one extra round this stage
// spends - never the whole set, so the mechanism can't turn into a second
// uniform round depth by accident. Exported for direct, offline testing.
export function pickContestedCriterion(voting) {
  if (!Array.isArray(voting) || voting.length < 2) return null;
  const failedBy = new Map();
  for (const v of voting) {
    for (const f of v.critique?.failures || []) {
      if (!f?.criterion) continue;
      if (!failedBy.has(f.criterion)) failedBy.set(f.criterion, new Set());
      failedBy.get(f.criterion).add(labOf(v.seat));
    }
  }
  let best = null;
  for (const [criterion, labs] of failedBy) {
    const failCount = labs.size;
    if (failCount === 0 || failCount === voting.length) continue; // unanimous - not disagreement
    const score = Math.min(failCount, voting.length - failCount);
    if (!best || score > best.score) best = { criterion, failedBy: [...labs], votingCount: voting.length, score };
  }
  return best;
}

export function runVerification(config, { runTool = defaultRunTool, log = () => {} } = {}) {
  const specs = config?.verify?.tools || [];
  const cwd = config?.verify?.cwd || process.cwd();
  const groundTruth = [];
  for (const spec of specs) {
    if (!spec || !ALLOWED_TOOLS.includes(spec.tool)) {
      log(`  skipped: "${spec?.tool}" is not on the tool allowlist (${ALLOWED_TOOLS.join(', ')})`);
      continue;
    }
    const result = runTool(spec.tool, spec.args || {}, { cwd });
    log(`  ${spec.tool}${spec.args ? ` ${JSON.stringify(spec.args)}` : ''}: ${result.ok ? 'ok' : `error - ${result.error}`}`);
    const entry = { tool: spec.tool, args: spec.args || {}, result };
    // v3 §Item 2: an optional `expect.contains` marker on the spec, paired with a `fact`
    // name, turns a raw read_file result into an explicit ground-truth fact - additive,
    // specs without `expect` are untouched so every existing caller stays byte-identical.
    // `result.ok === false` (e.g. the target file is missing) can't distinguish "not
    // applied" from "can't tell", so it's surfaced as its own 'unknown' value rather than
    // folded into false.
    if (spec.expect?.contains !== undefined && spec.fact) {
      entry[spec.fact] = !result.ok
        ? 'unknown'
        : (typeof result.text === 'string' && result.text.includes(spec.expect.contains)) || 'not_applied';
    }
    groundTruth.push(entry);
  }
  return groundTruth;
}

// v4 item 2: the identity decision (relay/runs/2026-09-15T01-35-10-051Z/deliverable.md §2) -
// review the task DESCRIPTION only, never a diff, so no critic ever authors code. Gated on
// config.preflight being present - absent, this function is never called and behaviour is
// byte-for-byte v3's. Its own artifact, preflight-verdict.json, never touches `propose`.
//
// Correction to the plan's own "Research" line: the existing post-propose debate-aggregation
// code (the `config.debate` block later in this file) cannot run "unmodified" against
// task-description text - it is built around anonymising and cross-critiquing a POOL of
// distinct per-lab proposals, which has no equivalent when every seat is reviewing the same
// shared task text. Checked directly before writing this. What's built instead is a small,
// independent function in the same concurrent-Promise.all-over-labs shape as that block, sized
// to what a description-only review actually needs (no anonymisation, no cross-lab posts/
// replies - every seat reviews the same fixed text and returns one independent verdict).
export const PREFLIGHT_SYSTEM = `You review a task description before any code change is proposed against it. You never see, write, or evaluate a diff - only the text below. Your only job is to catch a task framing that would be unsafe or nonsensical to start building against: contradictory requirements, a missing or unnamed target, an acceptance test that cannot be satisfied as stated. Do not comment on style or completeness beyond that. Reply as JSON only: {"verdict": "pass" | "object", "objections": ["one sentence per real problem, empty if verdict is pass"]}`;

export function preflightUser(request) {
  return `# Task description under review (no diff or proposal exists yet)\n\n${request}`;
}

// seats: config.preflight.seats if given, else config.seats.critics (the existing critics
// seats, reused - never config.seats.proposers, which stays the only diff-authoring role).
export async function runPreflightStage(config, { request, invoke, record, log = () => {} }) {
  const seats = (config.preflight?.seats && config.preflight.seats.length) ? config.preflight.seats : (config.seats.critics || []);
  const verdicts = await settleAll(seats.map(async seat => {
    const lab = labOf(seat);
    try {
      const s = record(await invoke(seat, {
        system: PREFLIGHT_SYSTEM,
        user: preflightUser(request),
        log, label: `preflight-${lab}`,
      }));
      const parsed = parseJson(s.text);
      // Bug-audit fix, 2026-09-23 (Review/BugAudit_ChainParsers_2026-09-23.md #6): anything but the
      // exact "object" used to read as "pass" - a null parse, a cut-off reply, "Object" in another
      // case - so a garbled objection waved the task through. Only a stated "pass" passes now; an
      // unreadable reply is recorded as `unreadable` (like an unreachable seat, it does not block on
      // its own, and it is never a pass). A single string objection is still an objection.
      const stated = typeof parsed?.verdict === 'string' ? parsed.verdict.trim().toLowerCase() : null;
      const rawObjections = Array.isArray(parsed?.objections) ? parsed.objections : typeof parsed?.objections === 'string' ? [parsed.objections] : [];
      const objections = rawObjections.filter(o => typeof o === 'string' && o.trim());
      const verdict = stated === 'object' ? 'object' : stated === 'pass' ? 'pass' : 'unreadable';
      return { lab, verdict, objections };
    } catch (err) {
      rethrowControlFlow(err);
      // A seat that fails to answer at all does not get to silently count as a "pass" that
      // could tip a marginal call - it's recorded distinctly, and does not block on its own
      // (an unreachable seat is not evidence the task is malformed).
      return { lab, verdict: 'error', objections: [], error: String(err.message).slice(0, 200) };
    }
  }));
  const blocked = verdicts.some(v => v.verdict === 'object' && v.objections.length > 0);
  return { verdicts, blocked };
}

// A "seat" is one lab's model occupying one slot in the chain.
//   { provider, model, maxTokens?, temperature? }

// Qwen3.5-9B (2026-09-10, three real runs against the same task, 3/3 failed identically):
// when quoting a source phrase verbatim inside a JSON string value, it wraps the quote in
// markdown-style 'single quotes' but leaves any literal " inside that span unescaped (e.g.
// `"evidence": "...states: 'no mention of "The Council," no round count...'"` - the inner "
// terminates the JSON string early). Separately (same evening, a different run): a raw
// unescaped newline landed inside a string value instead of \n. Both are mechanical, safe to
// repair by scanning with real string-state tracking rather than a single regex (a regex can't
// tell "the real closing quote" from "a stray quote mid-sentence" without looking at what comes
// next). A quote is only treated as ending a string if the next non-whitespace character is a
// plausible JSON continuation (, : } ]) or end-of-text; otherwise it's escaped in place. This
// was verified against all three real broken runs (fixed the one that was otherwise-clean; the
// other two had additional, genuinely garbled model output - e.g. a stray `;` and leaked
// CSS-looking text - that no mechanical repair should paper over) and regression-checked against
// every other already-valid critique reply on disk at the time (26 files, zero broken).
function repairStrayQuotesAndControlChars(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\' && inString) {
      out += c;
      if (i + 1 < text.length) { out += text[i + 1]; i++; }
      continue;
    }
    if (inString && (c === '\n' || c === '\r' || c === '\t')) {
      out += c === '\n' ? '\\n' : c === '\r' ? '\\r' : '\\t';
      continue;
    }
    if (c === '"') {
      if (!inString) {
        inString = true;
        out += c;
        continue;
      }
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      const next = text[j];
      if (next === undefined || ',:}]'.includes(next)) {
        inString = false;
        out += c;
      } else {
        out += '\\"';
      }
      continue;
    }
    out += c;
  }
  return out;
}


// A seat with no `maxTokens` of its own gets this. Was 8000 until 2026-09-20, when the pilot showed
// reasoning seats spending the whole budget on thinking and losing their verdict (see the
// "unheard" comment in the critic loop). It is a ceiling, not a price: only tokens actually
// generated are billed. The spend cap still projects it as the worst case.
export const DEFAULT_MAX_TOKENS = SEAT_DEFAULT_MAX_TOKENS; // 36000, single source in cost.js
// One bigger-cap retry for a critic whose reply was cut off, never more than this.
export const CUT_OFF_RETRY_MAX_TOKENS = 64000;
// The retry cap for a reply cut off at `cap`: double it, bounded by `ceiling` (default CUT_OFF_RETRY_MAX_TOKENS; since 0.8.1 a call
// site passes the seat's own ceiling, retryCeilingOf in src/reasoning.js: the model's maximum, bounded by its transport), but
// never BELOW the seat's own cap. 2026-09-22: a seat given a 360k cap (above the 64k bound) would
// otherwise have been "retried with a bigger cap" of 64k - a smaller one, certain to cut off again.

// The sentence a criteria retry appends to the criteria prompt, by what the gate found ('infeasible': a criterion one document can never satisfy; 'meta': criteria about the criteria list). 0.8.2 wiring (6a, ticket 24):
// the held function `criteriaRetryNote(kind, quoted)` in src/roles.js (after the re-record) holds BOTH sentences (they leave this file) and adds, for 'meta', the sentence about a request's own list of requirements; until then these
// two are the sentences that have always been sent, byte for byte.
function criteriaRetryNote(kind, quoted) {
  const recorded = held('criteriaRetryNote');
  if (recorded) return recorded(kind, quoted);
  return kind === 'infeasible'
    ? `Your previous answer contained a criterion the draft can never satisfy: "${quoted}". The draft is ONE document. Any other file named in the request is produced by a later stage of this pipeline, not by the draft. Write criteria that one document can satisfy.`
    : `Your previous answer described the format of a criteria list ("${quoted}") instead of the deliverable the request asks for. Write criteria that a reader checks against that deliverable itself.`;
}

// 0.8.2 wiring (4a-4d, decision 2 third part, owner "Yes x3" 5 Oct): in a chain with debate_hygiene.noQuoteMarks (which is what records `quoted` on a post) the author's reply prompt shows the mark "[no quote]" before the
// colon of an objection or merge that quotes nothing, the reply prompts say what the mark means, and the debate prompts tell a poster to copy the phrase it talks about. The words are held (src/held-roles.js):
// `replyUserMarked` / `altReplyUserMarked` (the whole reply prompt, byte-identical to R.replyUser / R.altReplyUser when no post is unquoted), `noQuoteGloss`, `debatePostQuoteRule`. Until the re-record each falls back to the
// prompt that has always been sent.
const noQuoteMarksOn = config => config?.debate_hygiene?.noQuoteMarks === true;
const replyUserFor = config => (noQuoteMarksOn(config) ? (held('replyUserMarked') ?? R.replyUser) : R.replyUser);
const altReplyUserFor = config => (noQuoteMarksOn(config) ? (held('altReplyUserMarked') ?? R.altReplyUser) : R.altReplyUser);
const withHeldNote = (config, system, name) => { const text = noQuoteMarksOn(config) ? held(name)?.() : null; return text ? `${system}\n\n${text}` : system; };

// Criteria that describe the criteria list (its JSON shape, what each criterion must be) rather
// than the deliverable. Any one JSON-shape item flags it; otherwise a third or more of the items
// talking about "criterion/criteria" does. Returns the offending items.
export function metaCriteria(criteria, { shapeOnly = false } = {}) {
  const list = (criteria || []).filter(c => typeof c === 'string');
  // Bug-audit fix, 2026-09-23 (Review/BugAudit_ChainParsers_2026-09-23.md #7): "json object" or
  // "list of strings" alone flagged a legitimate criterion about the deliverable (an API that
  // returns a JSON object). The shape words now count only when the criterion is about criteria.
  const shape = list.filter(c => /["'`]criteria["'`]\s*key/i.test(c)
    || (/json object|list of strings/i.test(c) && /\bcriteri(on|a)\b/i.test(c)));
  if (shape.length || shapeOnly) return shape;
  const about = list.filter(c => /\bcriteri(on|a)\b/i.test(c));
  return about.length >= 2 && about.length / list.length >= 1 / 3 ? about : [];
}

// Criteria a single build stage cannot satisfy, whatever it writes: ones that require documents
// this harness produces in its own later stages (BOARD.md from the debate record, HANDOFF.md from
// the handoff stage), or that demand several named .md files at once. 2026-09-22: a Zofia run burned
// six paid rounds and ended in a dispute because every seat agreed the draft could not be three
// documents at once. Returns the offending criteria.
export function infeasibleCriteria(criteria, { handoff = false, debate = false } = {}) {
  const list = (criteria || []).filter(c => typeof c === 'string');
  return list.filter(c => {
    const files = [...new Set((c.match(/\b[A-Za-z0-9_-]+\.md\b/g) || []).map(f => f.toUpperCase()))];
    // Bug-audit fix, 2026-09-23 (BugAudit_ChainParsers #7): any two .md names flagged it, so "does
    // not contradict DECISIONS.md or CLAUDE.md" stopped the run. Naming documents to stay consistent
    // with is not demanding them; only a criterion that asks for several documents is infeasible.
    const refersOnly = /\b(contradict\w*|consistent|conflict\w*|cite[sd]?|citing|refer\w*|according to|per|in line with|align\w*|match(es|ing)?|agree\w*|respect\w*|follow\w*|honou?r\w*)\b/i.test(c);
    if (files.length > 1 && !refersOnly) return true;
    if (handoff && /\bHANDOFF\.md\b/i.test(c)) return true;
    if (debate && /\bBOARD\.md\b/i.test(c)) return true;
    return false;
  });
}

// The author's prompt for an injected canary post: the ordinary reply prompt, with the canary's
// poster shown under a normal anonymised lab label (R.canaryPosterLabel) instead of the raw
// `canary` id, which rendered as "undefined". Pre-release audit 2026-09-23
// (ProposalsDebateDispute #1); test/canary.test.js pins that no probe wording reaches it.
export function canaryReplyPrompt({ request, proposals, post, lab, maps, guard = false, render = R.replyUser }) {
  const shown = { ...maps, labTo: { ...maps.labTo, [post.by]: R.canaryPosterLabel(maps, lab) } };
  return render({ request, proposals, posts: [post], lab, maps: shown, guard });
}

// Tiered councils, the majority guard (config.majority_guard.enabled): a withdrawal counts only when
// it quotes the argument it concedes to. `conceded_to` must match the text of a post on that same
// proposal (normalised: case, whitespace and quote marks); otherwise the reply is kept on the record
// as a withdrawal with `unargued: true`, and the proposal stays for the builder to judge. Mutates
// the replies in place (the report keeps both the action and the flag).
//
// The quote is matched against the post as the author was shown it (R.boardText: a leading "#"
// escaped as "\#", the <critic-claim> tag defused) as well as the raw post, so an author that
// copies an objection containing "#" verbatim from its prompt is not marked unargued (verification
// of thc-research PR #13, finding 3).
export function guardWithdrawals(replies, posts, log = () => {}, textVariants = x => [x.text]) {
  const norm = t => String(t || '').toLowerCase().replace(/[\u2018\u2019\u201c\u201d"'`]/g, '').replace(/\s+/g, ' ').trim();
  for (const r of replies) {
    if (r.action !== 'withdraw') continue;
    const quote = norm(r.conceded_to);
    const on = posts.filter(x => x.on === r.id && x.stance !== 'support');
    const hit = quote.length >= 8 && on.some(x => textVariants(x).some(t => norm(t).includes(quote) || norm(R.boardText(t)).includes(quote)));
    r.conceded_to = typeof r.conceded_to === 'string' ? capField(r.conceded_to, { field: 'conceded_to' }) : undefined;
    if (!hit) {
      r.unargued = true;
      log(`  majority guard: ${r.id} - its author withdrew it without quoting the argument it concedes to; it stays for the builder to judge.`);
    }
  }
  return replies;
}

// A merge_with / replaced_by reference as recorded: a real id on this board or nothing. Pre-release
// audit 2026-09-23 (DecisionRecords #3): these were neither checked nor capped, so a 50k-char
// "id" reached the board uncut and a made-up one read like a real withdrawal target.
export function boardRef(raw, maps, ids) {
  if (raw == null || raw === '') return undefined;
  const id = maps.idFrom[raw] || raw;
  return typeof id === 'string' && ids.has(id) ? id : undefined;
}

// Debate posts and author replies the stage's filters reject (0.7.8, thc-research brief 10 W3).
// The filters are unchanged; what changed is that a rejected item is counted, per lab and per
// reason, into report.json's `debate.dropped` and BOARD.md, instead of vanishing. Silent drops were
// the most common defect across the 22 council/debate repos that brief read, and the raw reply on
// disk was the only trace of one here. Reasons:
//   debate  - unknown_target (no proposal has that id), own_proposal (a lab posting on its own),
//             bad_stance (not support/object/merge), unreadable (the whole reply did not parse;
//             how many posts it held is unknown, so it counts once).
//   replies - unknown_target, not_own_proposal (another lab's proposal), not_posted_on (its own
//             proposal, but nobody posted on it, so there was nothing to answer), bad_action (not
//             keep/amend/withdraw), unreadable.
export function debatePostDropReason(post, lab, proposals) {
  if (!proposals.some(p => p.id === post.on)) return 'unknown_target';
  if (!proposals.some(p => p.id === post.on && p.lab !== lab)) return 'own_proposal';
  if (!['support', 'object', 'merge'].includes(post.stance)) return 'bad_stance';
  return null;
}

export function debateReplyDropReason(reply, lab, proposals, mineWithPosts) {
  if (!proposals.some(p => p.id === reply.id)) return 'unknown_target';
  if (!proposals.some(p => p.id === reply.id && p.lab === lab)) return 'not_own_proposal';
  if (!mineWithPosts.some(p => p.id === reply.id)) return 'not_posted_on';
  if (!['keep', 'amend', 'withdraw'].includes(reply.action)) return 'bad_action';
  return null;
}

// [{ stage, by, reason }] -> [{ stage, by, reason, count }], one row per (stage, lab, reason), in
// the order first seen (labs settle in roster order, so this is stable across runs).
export function tallyDropped(items) {
  const rows = new Map();
  for (const { stage, by, reason } of items) {
    const key = `${stage}\u0000${by}\u0000${reason}`;
    if (rows.has(key)) rows.get(key).count += 1;
    else rows.set(key, { stage, by, reason, count: 1 });
  }
  return [...rows.values()];
}

function describeDropped(items) {
  const rows = tallyDropped(items);
  return `${rows.reduce((a, r) => a + r.count, 0)} dropped (${rows.map(r => `${r.count} ${r.reason}`).join(', ')})`;
}

// Audit A1-4 (0.8.1): the cap a reply in hand was really asked at. An Anthropic seat's invoke() may have retried at a bigger cap (`stage.cappedAt`); every
// judgement of that reply (cut off? all reasoning? truncated?) must use THAT cap, not the one the call site started from, or a normal long reply reads as
// truncated and gets a third paid call. Never below the cap the caller started from (a corrupt record cannot shrink it).
export const askedCapOf = (stage, fallback) => (Number.isFinite(stage?.cappedAt) && stage.cappedAt >= fallback ? stage.cappedAt : fallback);
// 0.8.2 item 7: the ONE door every critic system prompt goes through, so a lane paragraph (src/lanes.js) can never be applied at some call sites and missed at others (a source-scan test fails on a bare
// R.criticSystem( anywhere else in this file). A seat with no lane gets R.criticSystem's text unchanged.
// Item 28 (Muad's yes 7 Oct 2026 via C&C): in a chain with "selfReview": "allowed", the critic seat that wrote the draft gets the self-review opening (R.criticSystem's `selfReview`).
export function criticPromptFor(seat, open, opts, config) {
  const self = config?.selfReview === 'allowed' && isWriterSeat(seat, config.seats);
  const o = self ? { ...(opts || {}), selfReview: true } : opts;
  return withLane(seat, o === undefined ? R.criticSystem(open) : R.criticSystem(open, o));
}

// The model a seat actually runs, provider prefix and :variant dropped, so `anthropic/claude-sonnet-5` on OpenRouter and `claude-sonnet-5` direct are one model. Mock and external seats
// have no real model identity (mock chains reuse names on purpose), so they return null and never match. (Moved here from src/chain-lint.js, which re-exports it.)
export function modelIdentity(seat) {
  if (!seat?.model || seat.provider === 'mock' || seat.provider === 'external') return null;
  return String(seat.model).toLowerCase().split('/').pop().split(':')[0];
}
// Who a seat is, for "is this the same agent": its model identity, or for an external seat its model string (a writer and a critic that name the same session,
// "claude-code-session", are the same agent: audit fix cnc-chains-lint F1). One rule for chain-lint's self-review check and for the writer's critic prompt.
export const seatIdentity = seat => modelIdentity(seat) ?? (seat?.provider === 'external' && seat.model ? `external:${String(seat.model).toLowerCase()}` : null);
/** True when this critic seat is the plan's writer (the builder's or the reviser's lab, or the same model / session under another lab label). */
export function isWriterSeat(seat, seats) {
  return ['builder', 'reviser'].some(k => {
    const w = seats?.[k];
    if (!w || !seat) return false;
    if (labOf(w) === labOf(seat)) return true;
    const id = seatIdentity(w);
    return id !== null && id === seatIdentity(seat);
  });
}
export function cutOffRetryCap(cap, ceiling = CUT_OFF_RETRY_MAX_TOKENS) {
  return retryCapFor(cap, ceiling);
}

export function parseJson(text) {
  // Models wrap JSON in prose or fences no matter how firmly you ask them not to,
  // and the small ones leave a trailing comma before ] or } (GLM 5.3 Flash,
  // 2026-09-07: a real objection counted as an abstention over one comma).
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const openFence = text.match(/```(?:json)?\s*([\s\S]*)$/); // closing fence missing
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  const braces = first !== -1 && last > first ? text.slice(first, last + 1) : null;
  const candidates = [text, fenced?.[1], openFence?.[1], braces].filter(Boolean);
  // Repairs, mildest first. Each one targets a slip a real seat has made:
  //  - trailing comma before ] or } (GLM 5.3 Flash)
  //  - a key written as a bare string, "reason: text" instead of "reason": "text"
  //    (Mistral Large, six times in one reply, 2026-09-07)
  //  - a stray unescaped quote or raw control char inside a string value (Qwen3.5-9B, 2026-09-10)
  const repairs = [
    c => c,
    c => c.replace(/,\s*([\]}])/g, '$1'),
    c => c.replace(/"([A-Za-z_][A-Za-z0-9_ ]*):\s+([^"]*)"/g, (all, k, v) => `"${k}": "${v.replace(/"/g, '\\"')}"`).replace(/,\s*([\]}])/g, '$1'),
    c => repairStrayQuotesAndControlChars(c).replace(/,\s*([\]}])/g, '$1'),
  ];
  for (const repair of repairs) {
    for (const c of candidates) {
      try { return JSON.parse(repair(c.trim())); } catch { /* try the next shape */ }
    }
  }
  return null;
}

// Explains why a critic's reply couldn't be parsed, for the abstention log line. Found 2026-09-10
// (GP judging run 2026-09-10T20-01-59-545Z, panel-1-glm.md): the old two-way check (token cap vs.
// "malformed JSON") mislabelled a genuinely empty reply as "malformed JSON - read the saved reply,
// it may still be an objection" - there is nothing to read, and it is not an objection. The
// provider's own finish_reason ("stop" in usage, set by providers.js from finish_reason/
// stop_reason) already says this plainly when it's not a normal completion: OpenRouter/OpenAI-
// compatible providers return "error" when the upstream model errors out mid-generation (here,
// GLM 5.3 Flash burned its whole token budget on thinking - usage.thinking === usage.output - and
// returned no content at all), which is a distinct failure from either truncation or a formatting
// slip and needs its own label so a later session doesn't chase the wrong bug.
export function classifyUnreadable(usage, maxTokens) {
  if (usage.stop === 'error') return 'provider returned an error mid-generation (stop: error) - not a truncation or a JSON-formatting problem';
  const cap = maxTokens ?? DEFAULT_MAX_TOKENS;
  if (isReasoningExhausted(usage, cap)) return `REASONING_EXHAUSTED: all ${usage.output} tokens were reasoning, stopped far under the ${cap}-token cap - a provider-side reasoning ceiling, so no bigger-cap retry`;
  if (usage.output >= cap * 0.95 || usage.stop === 'length' || usage.stop === 'max_tokens') return 'hit the token cap, truncated';
  return 'malformed JSON - read the saved reply, it may still be an objection';
}

// v8 item (a) (deep-research-v8-directional-followup-2026-09-15.md §5.3 item 1): a reserved,
// closed set of machine-readable reason codes for report.json's signoff[] entries, named so an
// abstention's cause is a schema value rather than only a log line someone has to remember to
// read. Deliberately a SEPARATE function from classifyUnreadable rather than a change to its
// return shape - classifyUnreadable's plain-string return is pinned by test/chain.test.js
// (added 2026-09-10 after a real incident) and changing it would be a needless breaking edit to
// an already-correct, already-tested function. This function reads the same two inputs
// classifyUnreadable already reads and returns the code for the same three diagnoses, plus the
// one abstention path classifyUnreadable was never meant to cover (a thrown provider/transport
// exception - see the catch block above reviewSeat, "a lab that is down"). No new abstention
// category exists beyond these four; the set is closed on purpose.
export const RESERVED_ABSTENTION_REASONS = Object.freeze([
  'SEAT_UNREACHABLE',   // the catch block: 429/5xx/network - invoke() threw before any reply came back
  'PROVIDER_ERROR',     // classifyUnreadable's stop:"error" branch - a reply came back but the provider aborted mid-generation
  'REPLY_TRUNCATED',    // classifyUnreadable's near-cap-output branch - the reply hit maxTokens before finishing
  'REPLY_UNPARSEABLE',  // classifyUnreadable's fallback branch - a complete reply that still isn't valid JSON
  // Added 2026-09-23 (seeded-defect paid run): stopped at a length limit with every output token
  // spent on reasoning, far below the seat's own cap - a provider-side reasoning ceiling, not our
  // cap. deepseek-v4.1-flash via OpenRouter did this 6 times at 4,224-4,226 tokens against a 36k
  // cap, and all 3 bigger-cap (64k) retries stopped at the same place, so the retry is skipped.
  'REASONING_EXHAUSTED',
  // Added 0.8.2 (owner decision 1, 5 Oct 2026): a sign-off without a full per-criterion table, on a chain with `signoff_table.required`. Never consent.
  'INCOMPLETE_TABLE',
]);

// "Well under the cap": a reply that ran out at half its budget or less did not hit OUR cap.
const REASONING_CEILING_FRACTION = 0.5;
function isReasoningExhausted(usage, cap) {
  const cut = usage.stop === 'length' || usage.stop === 'max_tokens';
  return cut && usage.thinking > 0 && usage.output > 0 && usage.thinking >= usage.output && usage.output <= cap * REASONING_CEILING_FRACTION;
}

// The provider itself says the reply stopped at the token cap. Unlike abstentionReasonCode's
// REPLY_TRUNCATED, no 95%-of-cap guess: a reply that finished with stop:"stop" is complete.
export function providerCutOff(usage) {
  return usage?.stop === 'length' || usage?.stop === 'max_tokens';
}

// 0.8.1 milestone R (owner: "NO LOWER EFFORT!!!!"): a reply cut off at its cap that spent tokens on thinking and returned no text. The seat
// has no answer; it is recorded, never read as a pass. The wording is the one the board uses.
export const NO_ANSWER_THINKING = 'no answer: thinking used the whole cap';
export function isNoAnswerReply(res) {
  return providerCutOff(res?.usage) && res.usage.thinking > 0 && !String(res.text ?? '').trim();
}

export function abstentionReasonCode(usage, maxTokens) {
  if (usage.stop === 'error') return 'PROVIDER_ERROR';
  const cap = maxTokens ?? DEFAULT_MAX_TOKENS;
  if (isReasoningExhausted(usage, cap)) return 'REASONING_EXHAUSTED';
  if (usage.output >= cap * 0.95 || usage.stop === 'length' || usage.stop === 'max_tokens') return 'REPLY_TRUNCATED';
  return 'REPLY_UNPARSEABLE';
}

// Small critics fill the schema literally: every criterion MET, meets:false,
// and a placeholder failure {criterion:"None"} because the array "had to"
// hold something (Llama 3.3 70B did exactly this on 2026-09-07, and the
// harness counted it as an objection). The per-criterion table is the honest
// signal, so the summary fields are derived from it rather than trusted.

// A critic's own text (criterion/problem/fix/verdict_line) is entirely critic-controlled and
// flows, undelimited until roles.js's own prompt-construction fix, straight into the reviser's
// prompt and the run history handed to the finalist (docs/security-prompt-injection.md S3, found
// from cnc-harness's own security review of what a plan-N seat actually runs). A 20 000-token
// critic reply could otherwise become a 20 000-token "failure" in the next prompt; cap each
// field here, at parse time, once, rather than trusting every call site downstream to remember.
//
// 0.8.1 FX-11 (owner's amendment, 2026-10-02): one 2,000-character limit for every kind cut a 6,704-character
// architecture before the builder read it, silently. Each kind now has its own limit, and every cut is loud:
// - Text other seats read as the substance of the board (a whole architecture's fields, a debate post, an author's
//   reply): never less than what the seat was allowed to write, its maxTokens at CHARS_PER_TOKEN, and never under
//   BOARD_TEXT_MIN_CHARS. A cut there means the reply was longer than its own token cap allowed, which only a
//   runaway or a miscount produces.
// - A critic field: CRITIC_FIELD_MAX_CHARS, the runaway guard above. Four fields x 8,000 characters is about 8,000
//   tokens of one critic's objections in the reviser's prompt, under a quarter of a 36,000-token seat's own reply.
// Each cut is recorded (fieldCutsSoFar: stage, field, original and kept length); the CLI writes it to WARNINGS.md and
// report.json `field_cuts`.
const CHARS_PER_TOKEN = 4; // the harness's rule everywhere it estimates tokens (estimateTokens)
const BOARD_TEXT_MIN_CHARS = 40_000; // the amendment's floor: about 10,000 tokens, five times the old cut
const CRITIC_FIELD_MAX_CHARS = 8_000; // the amendment's floor for critic fields (was 2,000)
const boardTextLimit = maxTokens => Math.max(BOARD_TEXT_MIN_CHARS, (maxTokens ?? DEFAULT_MAX_TOKENS) * CHARS_PER_TOKEN);
let fieldCuts = [];
/** Start a new record of cut fields. The CLI calls it once per run (one run per process); a nested runChain (descending
 * mode's sub-runs) must not, or it would wipe the outer run's record. Tests call it between runs. */
export function resetFieldCuts() { fieldCuts = []; }
/** Every field cut so far in this run: [{ stage, field, original, kept }]. */
export function fieldCutsSoFar() { return fieldCuts.map(c => ({ ...c })); }
function capField(value, { limit = CRITIC_FIELD_MAX_CHARS, stage = null, field = null } = {}) {
  if (typeof value !== 'string' || value.length <= limit) return value;
  fieldCuts.push({ stage, field, original: value.length, kept: limit });
  return `${value.slice(0, limit)}… [truncated, ${value.length} chars total]`;
}

// Bug-audit fix, 2026-09-23 (Review/BugAudit_ChainParsers_2026-09-23.md #1, #2): `meets` used to be
// `failures.length === 0` and nothing else, so anything that failed to NAME a failure signed off -
// an explicit {"meets":false,"verdict_line":"Fails criterion 2"}, a failure with no `criterion`
// key, a table saying "FAIL" or "NOT MET" instead of the exact "FAILED", a question-only reply, a
// fenced snippet picked out of a prose objection, a truncated array's first element. That is the
// "garbled counts as consent" incident class again. A sign-off now needs no failures AND a stated
// pass: `meets: true`, or a non-empty table whose every row is MET (the table is still the honest
// signal for the 2026-09-07 Llama shape - all MET, meets:false, placeholder failure - which stays a
// sign-off). An explicit meets:false with nothing named becomes an objection; a reply that states
// no verdict at all comes back `unreadable: true`, which callers turn into an abstention (it blocks
// unanimity; it is never consent). A non-array `failures` or a non-object reply is unreadable too,
// rather than a throw - the reply is on disk before it is parsed, so a throw here used to crash
// every resume on the same replayed file (#2).
const NO_VERDICT_FAILURE_CRITERION = '(objection named no criterion)';

export function normaliseCritique(critique, log = () => {}, { stage = null } = {}) {
  const unreadable = why => {
    log(`    (no usable verdict: ${why} - counted as an abstention, not a sign-off)`);
    return { ...(critique && typeof critique === 'object' && !Array.isArray(critique) ? critique : {}), failures: [], meets: false, unreadable: true, unreadableWhy: why };
  };
  if (!critique || typeof critique !== 'object' || Array.isArray(critique)) return unreadable(`the reply is ${Array.isArray(critique) ? 'an array' : typeof critique}, not a verdict object`);
  if (critique.failures != null && !Array.isArray(critique.failures)) return unreadable(`"failures" is ${typeof critique.failures}, not a list`);
  const rawFailures = critique.failures || [];
  const rows = Array.isArray(critique.criteria) ? critique.criteria.filter(r => r && typeof r === 'object' && !Array.isArray(r)) : [];
  const verdictOf = row => verdictWord(row.verdict);

  // A placeholder names no criterion AND says nothing - an entry with a real problem but no
  // criterion key is still an objection, just an unlabelled one.
  const noneCriterion = f => /^(none|n\/?a|-|no failures?)\.?$/i.test(String(f.criterion).trim());
  const placeholder = f => !f || typeof f !== 'object' || (f.criterion ? noneCriterion(f) : !String(f.problem || '').trim());
  const failures = rawFailures.filter(f => !placeholder(f))
    .map(f => ({ ...f, criterion: capField(f.criterion ? String(f.criterion) : NO_VERDICT_FAILURE_CRITERION, { stage, field: 'criterion' }), problem: capField(f.problem, { stage, field: 'problem' }), fix: capField(f.fix, { stage, field: 'fix' }) }));
  const dropped = rawFailures.length - failures.length;
  if (dropped) log(`    (ignored ${dropped} placeholder failure entr${dropped === 1 ? 'y' : 'ies'} that named no criterion)`);
  for (const row of rows) {
    if (!FAILED_VERDICT.test(verdictOf(row))) continue;
    if (failures.some(f => f.criterion === row.criterion)) continue;
    failures.push({ criterion: capField(String(row.criterion ?? '(unnamed criterion)'), { stage, field: 'criterion' }), problem: capField(row.evidence, { stage, field: 'evidence' }) || `marked ${verdictOf(row)} in the criteria table`, fix: '' });
    log(`    (added a failure the critic marked ${verdictOf(row)} in its table but left out of its failures list)`);
  }
  const verdict_line = capField(critique.verdict_line, { stage, field: 'verdict_line' });
  if (failures.length) return { ...critique, failures, verdict_line, meets: false };

  const allMet = rows.length > 0 && rows.every(r => MET_VERDICT.test(verdictOf(r)));
  if (critique.meets === true || allMet) return { ...critique, failures, verdict_line, meets: true };
  if (critique.meets === false) {
    // A stated objection that named nothing. Kept as an objection (never consent), with whatever
    // the critic did say as its text, so the reviser has something to act on.
    const said = verdict_line || 'the critic answered meets:false but named no criterion and gave no reason';
    log(`    (the critic said meets:false but named no criterion - kept as an unlabelled objection)`);
    return { ...critique, verdict_line, meets: false, failures: [{ criterion: NO_VERDICT_FAILURE_CRITERION, problem: said, fix: '' }] };
  }
  return unreadable('the reply states no verdict (no meets:true, no all-MET table, no failure)');
}

// Reads the plan's own "Scope ledger" lines: `<id> - accepted|cut - <reason>`.
// An id the ledger does not mention is "unaccounted", which is itself a
// finding about the integrator, not the proposer.
export function scoreProposals(proposals, plan) {
  const rows = proposals.map(p => {
    // p.id is escaped: an id is a harness-made tag today, but an unescaped "P(1" threw a
    // SyntaxError here, after every paid stage had run (bug audit 2026-09-23, ChainParsers #8).
    const re = new RegExp(`^[\\s*_\`-]*${String(p.id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\`*_]*\\s*[-:\u2013\u2014]\\s*\\**(accepted|cut|withdrawn)\\**\\s*[-:\u2013\u2014]?\\s*(.*)$`, 'im');
    const m = plan.match(re);
    return { ...p, status: m ? m[1].toLowerCase() : 'unaccounted', note: m ? m[2].trim() : '' };
  });
  const labs = [...new Set(rows.map(r => r.lab))].map(lab => {
    const mine = rows.filter(r => r.lab === lab);
    const n = st => mine.filter(r => r.status === st).length;
    return { lab, model: mine[0].model, proposed: mine.length, accepted: n('accepted'), cut: n('cut'), withdrawn: n('withdrawn'), unaccounted: n('unaccounted'), built: null };
  });
  return { rows, labs };
}

// A lab's identity is its provider unless the seat names one: three seats on
// OpenRouter are three labs, and mock chains need two labs on one provider.
// Exported so chain-lint.js's self-review check keys on the SAME identity the
// blind-panel and debate logic key on. A second copy of this one-liner there
// could drift from this one, and the thing that would silently break is
// exactly what the harness exists to measure (lab independence).
export const labOf = seat => seat.lab || seat.provider;
// How many labs sit on a chain's panel: its critics, by labOf. What `council doctor` advertises.
export const panelLabCount = config => new Set((config?.seats?.critics || []).filter(Boolean).map(labOf)).size;

// Bug-audit fix, 2026-09-23 (Review/BugAudit_RunChainStages_2026-09-23.md #1): several stages
// label a call by lab alone (`panel-<round>-<lab>`, `propose-<lab>`, `debate-<lab>`, `reply-<lab>`,
// `ambiguity-<lab>`), and the stage cache is keyed by label. Two seats sharing a lab therefore
// shared one label: in a relay panel the second seat was never called and was handed the first
// seat's verdict; in an independent panel the second write overwrote the first, and on resume both
// seats replayed the survivor - a holdout's objection became a manufactured unanimous pass.
// Renaming labels would orphan every paused run, so a chain that would collide is refused instead.
// A "first"-mode panel labels by round (`critique-<n>`), so shared labs are fine there.
// The sign-off modes runChain implements. Anything else is refused, never quietly run as "first"
// (pre-release audit 2026-09-23, PanelSignoff #3).
export const SIGNOFF_MODES = Object.freeze(['first', 'unanimous']);

export function duplicateLabSlots(config) {
  const seats = config?.seats || {};
  const out = [];
  const check = (slot, list) => {
    if (!Array.isArray(list)) return;
    const labs = list.filter(Boolean).map(labOf);
    const dupes = [...new Set(labs.filter((l, i) => labs.indexOf(l) !== i))];
    if (dupes.length) out.push({ slot, labs: dupes });
  };
  // Every stage whose label is keyed by lab (test/prerelease-batch1b.test.js walks chain.js's
  // labels and fails if a new lab-keyed one is not listed here). Pre-release audit 2026-09-23:
  // the alternatives stage (Alternatives #2) and preflight.seats (GuardLayer, the class's second
  // recurrence) were missing, and descending critics label per lab too.
  if (config?.signoff === 'unanimous' || config?.descending || config?.advise?.enabled === true) check('critics', seats.critics);
  if (config?.proposals) check('proposers', seats.proposers || seats.critics);
  if (config?.alternatives?.enabled === true) check('alternatives', seats.alternatives || seats.proposers || seats.critics);
  if (config?.ambiguity_union?.enabled) check('ambiguity', seats.ambiguity || (seats.critics || []).slice(0, 3));
  if (config?.preflight) check('preflight', (config.preflight.seats && config.preflight.seats.length) ? config.preflight.seats : seats.critics);
  return out;
}

// Item 5/6 (relay/runs/2026-09-14T14-56-18-834Z/deliverable.md): a seat-role
// override lets a chain name, by lab/provider id, which already-configured
// seat fills a given stage - a selection change, never a new field on
// report.json. Searches every seat this chain declares, named and rostered,
// so an override can point at a critic or a proposer as well as a
// dedicated seat kind.
export function findSeatByLab(config, id) {
  const seats = config?.seats || {};
  const named = ['criteria', 'builder', 'reviser', 'finalist', 'skeleton', 'handoff', 'questions', 'judge', 'challenger']
    .map(k => seats[k]).filter(Boolean);
  const all = [...named, ...(seats.critics || []), ...(seats.proposers || []), ...(seats.alternatives || [])];
  return all.find(s => labOf(s) === id) || null;
}

// roster.criteria_seat (item 5): absent leaves the existing configured
// criteria seat exactly as today. Present, it must resolve to a real seat
// somewhere in this chain's config - chain-lint.js checks this ahead of any
// metered call, but resolveCriteriaSeat re-checks here too since a config
// can be handed to runChain() directly without going through the CLI's
// lint gate (the MCP path, tests).
export function resolveCriteriaSeat(config) {
  const id = config.roster?.criteria_seat;
  if (!id) return config.seats.criteria;
  const seat = findSeatByLab(config, id);
  if (!seat) throw new Error(`roster.criteria_seat "${id}" does not match any seat's lab/provider in this chain's seats.`);
  return seat;
}

// Ambiguity union (config.ambiguity_union, item 5): string/set-level dedup,
// deliberately with no dependency on any claim schema - confirmed in the
// debate for this item, since it operates on raw request text, not on a
// claims[] array from any other item. Normalises on trim + lowercase +
// collapsed whitespace so near-duplicate phrasing collapses to one entry;
// the FIRST seat's original casing/wording is what survives, so the union
// stays readable rather than becoming a bag of lowercase fragments.
export function unionAmbiguities(lists) {
  const seen = new Map();
  for (const list of lists || []) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      if (typeof raw !== 'string') continue;
      const text = raw.trim();
      if (!text) continue;
      const key = text.toLowerCase().replace(/\s+/g, ' ');
      if (!seen.has(key)) seen.set(key, text);
    }
  }
  return [...seen.values()];
}

// A run pauses at an external seat: the prompt is written for whoever plays
// that seat (a Claude Code session on the Max plan, a human), and the run
// resumes from disk once <label>.md exists. Thrown, not returned, so the
// chain's control flow stays linear.
export class ExternalPause extends Error {
  constructor(label, system, user) {
    super(`waiting for external stage ${label}`); this.controlFlow = true; this.label = label; this.system = system; this.user = user;
    // The prompt the external answer will be checked against on resume (pre-release audit 5 #1/#4).
    this.promptHash = promptHashOf(system, user);
  }
}

// v4 item 2: a run's preflight stage found at least one blocking objection to the task
// description itself, before any proposal exists. Thrown, not returned, for the same reason
// as ExternalPause/BudgetExceeded - the chain's control flow stays linear, and the preflight
// verdicts computed so far are handed to the caller to persist, the same shape BudgetExceeded
// already uses for its own already-completed stages.
// A draft-producing stage (build, a revise, the dispute pass, the final edit, the handoff) came back
// cut off at its token cap, and a retry with a bigger cap was cut off too - or the seat is external
// and cannot be retried. Pre-release audit 2026-09-23 (PreRelease_Audit_revise #1): these replies
// used to flow straight on, so a truncated final edit became the shipped deliverable with no review
// after it. Thrown, not returned, like BudgetExceeded: the CLI stops the run with STOPPED-truncated.md
// and never grades, reports or ships the fragment.
//
// Bug audit 2026-09-27 M4: also thrown for a draft the provider ended with `error`, `content_filter`
// or `refusal` (draftIncomplete), after one retry at the same cap. `stop` then names that reason, and
// the message says "did not complete" instead of "cut off".
export class DraftTruncated extends Error {
  constructor(label, detail, stop = null) {
    super(stop ? `stage "${label}" did not complete (stop: ${stop}): ${detail}` : `stage "${label}" was cut off at its token cap: ${detail}`);
    this.controlFlow = true;
    this.label = label;
    this.detail = detail;
    this.stop = stop;
  }
}

// Whether a free-text reply was cut off. Only the provider's own stop reason, or - when a provider
// reports none - a reply that used its whole cap, counts: a long reply that finished is not truncated,
// which is why this does not reuse the 95%-of-cap heuristic JSON seats use.
export function draftCutOff(usage, cap) {
  if (!usage) return false;
  if (usage.stop === 'length' || usage.stop === 'max_tokens') return true;
  return usage.stop == null && Number.isFinite(cap) && (usage.output || 0) >= cap;
}

// Bug audit 2026-09-27 M4: a draft the provider ended for a reason other than finishing or the cap
// (normaliseStop passes these through). Such a reply is not a finished draft either, and a bigger
// cap does not help a provider error, so draftStage retries it once at the same cap.
const INCOMPLETE_STOPS = new Set(['error', 'content_filter', 'refusal']);
export function draftIncomplete(usage) {
  return !!usage && INCOMPLETE_STOPS.has(usage.stop);
}

export class PreflightBlocked extends Error {
  constructor(preflight) {
    super('preflight stage found a blocking objection to the task description');
    this.preflight = preflight;
  }
}

// A run hits its spend ceiling: thrown from invoke() BEFORE the call goes
// out, so the breaching stage is never paid for. Like ExternalPause this is
// thrown rather than returned, and for the same reason - the chain's control
// flow stays linear, and every completed stage is already on disk, so the run
// is resumable under a higher ceiling.
export class BudgetExceeded extends Error {
  constructor({ label, seat, spent, cap, projected }) {
    super(`per-run spend cap reached before stage ${label}`);
    this.controlFlow = true; // see rethrowControlFlow; read by modules that cannot import this file
    this.label = label;
    this.seat = seat;
    this.spent = spent;
    this.cap = cap;
    this.projected = projected;
  }
}

// 0.8.2 item 8a: a seat with no price row, called under a spend cap. The cap would project it at $0 and could not stop what the call costs, so invoke() refuses it before anything is sent (the run's start refuses
// the same seats first, src/unpriced.js). controlFlow, like BudgetExceeded: no catch around an invoke() may turn it into an abstention.
export class UnpricedSeat extends Error {
  constructor({ label, seat, cap }) {
    super(`${seat} has no price, so the spend cap of ${formatUsd(cap)} cannot hold it (before stage ${label})`);
    this.controlFlow = true;
    this.label = label;
    this.seat = seat;
    this.cap = cap;
  }
}

// Bug-audit fix, 2026-09-23 (Review/BugAudit_MoneyPath_2026-09-23.md #2, confirmed independently by
// BugAudit_ChainParsers #4): every catch that wraps an invoke() call and degrades a failure into an
// abstention, a "no reply" or a default MUST call this first. BudgetExceeded and ExternalPause are
// control flow, not a seat being down - swallowed, a capped panel seat was logged SEAT_UNREACHABLE,
// the panel re-ran on the same draft up to maxRounds, runChain returned normally, and the CLI wrote
// report.json instead of STOPPED-budget.json, so the run could not be resumed under a higher cap.
// The panel's cut-off retry catch already did this; the six sibling catches did not.
export function rethrowControlFlow(err) {
  // `controlFlow` also covers DeniedModel (src/denied-models.js), which must never be turned into an
  // abstention either.
  if (err instanceof BudgetExceeded || err instanceof ExternalPause || err?.controlFlow) throw err;
}

// Bug-audit fix, 2026-09-23 (BugAudit_MoneyPath #5): a parallel stage waits for EVERY call to
// settle before it rethrows. Promise.all rejected on the first BudgetExceeded while sibling calls
// were still in flight - the CLI then exited, so those siblings were billed but never recorded,
// STOPPED-budget.json undercounted, and a resume paid for them again. Now every sibling finishes
// (and is recorded) first; the first rejection is then thrown, as Promise.all would have.
export async function settleAll(promises) {
  const results = await Promise.allSettled(promises);
  const failed = results.find(r => r.status === 'rejected');
  if (failed) {
    // Parallel external seats (2026-09-25, Muad's "yes" to a subscription-seat panel): when the
    // first rejection is an ExternalPause, every OTHER seat of the same stage that paused rides
    // along on it as `siblings`, so the CLI writes all their NEEDS files at once and the operator
    // can answer them in parallel. Before this, a panel of seven external seats surfaced one pause
    // per resume - seven resumes per round. Only pauses ride along: a BudgetExceeded or any other
    // rejection that settled first still wins exactly as before, and a pause that settled after
    // one is still thrown on the next resume, as it always was.
    if (failed.reason instanceof ExternalPause) {
      const siblings = results
        .filter(r => r.status === 'rejected' && r.reason !== failed.reason && r.reason instanceof ExternalPause)
        .map(r => r.reason);
      if (siblings.length) failed.reason.siblings = [...(failed.reason.siblings || []), ...siblings];
    }
    throw failed.reason;
  }
  return results.map(r => r.value);
}

/** Every pause an ExternalPause carries (itself first, then its siblings, nested ones flattened),
 *  one per label. */
export function pendingPauses(err) {
  const out = [];
  const seen = new Set();
  const walk = p => {
    if (!p || seen.has(p.label)) return;
    seen.add(p.label);
    out.push(p);
    for (const s of p.siblings || []) walk(s);
  };
  walk(err);
  return out;
}

// Dispute review (2026-09-23, opt-in `dispute: { enabled: true, review: true }`). Muad: "Reviewers
// should check disputes thoroughly, no?" The dispute stage gives the reviser the last word on
// every open objection; this asks each panel seat that held one, in ONE call per seat, whether
// the final draft handles each of its objections honestly. It is a check on the record, not a
// vote: its result can flag, never pass, and it never re-opens the review.
//
// A verdict counts only if it can be checked. A claimed "accepted" or "misrepresented" whose
// quote isn't in the final draft, an unreadable reply, a reply that skips an objection and an
// unreachable seat all become "unconfirmed": silence and unverifiable answers are never read
// as consent (the same rule the panel's own unheard votes follow).
export const DISPUTE_REVIEW_VERDICTS = ['accepted', 'misrepresented', 'silently_dropped'];

const squash = t => String(t ?? '').replace(/\s+/g, ' ').trim();

export async function runDisputeReview(config, { request, openFailures, draftBefore, draftAfter, invoke, record, log = () => {} }) {
  const critics = config.seats?.critics || [];
  const byLab = new Map();
  openFailures.forEach((f, index) => {
    const lab = f.lab || null;
    if (!byLab.has(lab)) byLab.set(lab, []);
    byLab.get(lab).push({ ...f, index });
  });
  const entries = new Array(openFailures.length);
  const entry = (o, fields) => ({ criterion: o.criterion, lab: o.lab || null, ...fields });
  const after = squash(draftAfter);

  const calls = [];
  for (const [lab, objs] of byLab) {
    const seat = lab ? critics.find(c => labOf(c) === lab) : null;
    if (!seat) {
      for (const o of objs) entries[o.index] = entry(o, { verdict: 'unconfirmed', reason: 'no panel seat for this lab' });
      continue;
    }
    calls.push((async () => {
      let parsed = null;
      let failure = null;
      try {
        const s = record(await invoke(seat, {
          system: R.DISPUTE_REVIEW_SYSTEM,
          user: R.disputeReviewUser({ request, objections: objs, draftBefore, draftAfter }),
          log, label: `dispute-review-${lab}`,
        }));
        parsed = parseJson(s.text);
        if (!Array.isArray(parsed?.reviews)) failure = 'unreadable reply';
      } catch (err) {
        rethrowControlFlow(err);
        failure = `seat unreachable: ${err.message}`;
      }
      objs.forEach((o, k) => {
        if (failure) return void (entries[o.index] = entry(o, { verdict: 'unconfirmed', reason: failure }));
        const r = parsed.reviews.find(x => x?.objection === k + 1) ?? null;
        const claimed = DISPUTE_REVIEW_VERDICTS.includes(r?.verdict) ? r.verdict : null;
        const quote = typeof r?.quote === 'string' ? r.quote : '';
        const quoteFound = quote.trim() !== '' && after.includes(squash(quote));
        const base = { claimed_verdict: claimed, quote, quote_found: quoteFound, note: typeof r?.note === 'string' ? r.note : null };
        if (!claimed) {
          entries[o.index] = entry(o, { verdict: 'unconfirmed', reason: r ? 'no valid verdict' : 'objection not answered', ...base });
        } else if (claimed !== 'silently_dropped' && !quoteFound) {
          entries[o.index] = entry(o, { verdict: 'unconfirmed', reason: 'quote not found in the final draft', ...base });
        } else {
          entries[o.index] = entry(o, { verdict: claimed, ...base });
        }
      });
    })());
  }
  await settleAll(calls);

  const count = v => entries.filter(e => e.verdict === v).length;
  const counts = { accepted: count('accepted'), misrepresented: count('misrepresented'), silently_dropped: count('silently_dropped'), unconfirmed: count('unconfirmed') };
  log(`  dispute review: ${counts.accepted} accepted, ${counts.misrepresented} misrepresented, ${counts.silently_dropped} silently dropped, ${counts.unconfirmed} unconfirmed.`);
  return { ran: true, entries, counts, flagged: entries.filter(e => e.verdict !== 'accepted') };
}

/** The top-of-deliverable lines for the review. Built from the record, never from a seat's prose alone. */
export function renderDisputeReviewFlags(review) {
  if (!review?.ran) return [];
  if (!review.flagged.length) {
    return [`*Dispute review: every seat that held an open objection confirmed the draft above handles it honestly (${review.counts.accepted} checked).*`, ''];
  }
  const what = { misrepresented: 'MISREPRESENTED', silently_dropped: 'SILENTLY DROPPED', unconfirmed: 'NOT CONFIRMED' };
  return [
    `### Dispute review: ${review.flagged.length} objection(s) not confirmed as honestly handled`,
    '',
    'Each seat that raised an open objection was asked whether the reviser\'s last pass dealt with it honestly.',
    '',
    ...review.flagged.map(e => `- **${what[e.verdict]}** - ${e.criterion} (raised by ${e.lab || 'an unnamed lab'})` +
      `${e.reason ? `: ${e.reason}` : ''}${e.note ? `. Seat's note: ${e.note}` : ''}${e.quote ? ` Quoted: "${e.quote}"` : ''}`),
    '',
  ];
}

/** BOARD.md's section for the dispute review: every objection, the seat's verdict and its quote. */
export function renderDisputeReviewBoard(dispute) {
  const entries = dispute?.review?.entries;
  if (!entries?.length) return '';
  const rows = entries.map(e => `- **${e.verdict}** - ${e.criterion} (${e.lab || 'unnamed lab'})` +
    `${e.claimed_verdict && e.claimed_verdict !== e.verdict ? `; seat said "${e.claimed_verdict}"` : ''}` +
    `${e.reason ? `; ${e.reason}` : ''}${e.quote ? `\n  - Quote: "${e.quote}"${e.quote_found ? '' : ' (not found in the final draft)'}` : ''}` +
    `${e.note ? `\n  - Note: ${e.note}` : ''}`);
  return `\n\n## Dispute review (each objection's own seat, after the reviser's last pass)\n\n${rows.join('\n')}`;
}

// Per-run cache, set by the CLI: get(label) -> { text, usage, usd, ... } or null.
let cache = { get: () => null };
export function setCache(c) { cache = c || { get: () => null }; }

// Per-run spend ceiling in USD, set by the CLI. null means no ceiling.
// `spent` accumulates every stage this run has paid for, including stages
// replayed from disk on a resume - the ceiling is on the run as a whole, not
// on one sitting at the terminal.
//
// `reserved` (bug-audit fix, 2026-09-23, BugAudit_MoneyPath #1): the worst case of every call that
// has passed the cap check and not yet settled. Parallel seats (panel, proposals, debate, replies,
// ambiguity, preflight) used to all check the same `spent` before any of them had added to it, so
// seven critics at $22.89 of a $25 cap all passed and could spend $27.93. Each call now reserves its
// projection synchronously when it passes the check, and the reservation is swapped for the actual
// cost when it settles - so the check a sibling sees already counts every call in flight.
let budget = { cap: null, spent: 0, reserved: 0 };
// Audit A1-5 (0.8.1): a cap that is not a finite number above zero (a hand-edited run.json, a corrupt value) used to pass through and make every projection
// "fit" (NaN comparisons are false). It fails closed now: the run does not start. null still means no ceiling (the owner's `--max-usd none`).
export function setBudget(cap) {
  if (cap !== null && cap !== undefined && !(typeof cap === 'number' && Number.isFinite(cap) && cap > 0)) throw new Error(`the spend cap must be a number above 0 (or none), not ${JSON.stringify(cap)}; nothing was run and nothing was spent. Fix --max-usd, or the maxUsd value in the run's run.json.`);
  budget = { cap: cap ?? null, spent: 0, reserved: 0 };
}
export function budgetState() { return { ...budget, remaining: budget.cap === null ? null : Math.max(0, budget.cap - budget.spent - budget.reserved) }; }
// Pre-release audit, money path #2 (Review/PreRelease_Audit_moneypath_2026-09-23.md): spend from an
// earlier sitting whose cached stage is no longer replayed - it went stale and was re-run - still
// happened. The CLI counts it in here (on resume, from the archived `<label>.stale-*.usage.json`
// files) so the cap sees it; otherwise every stale-cache resume got a fresh ceiling on top of what
// was already spent, and "resuming cannot lap the cap" was false.
export function countEarlierSpend(usd) { if (Number.isFinite(usd) && usd > 0) budget.spent += usd; }

// v5 item 3, touch point 1: an optional module-level progress callback, same setter style as
// setBudget/setCache. Unset (the default, and every caller other than the CLI, including every
// existing test), this is a no-op - invoke() behaves byte-identically. Called once per real
// paid call, right before the call actually goes out (a cache hit or an external pause never
// "starts working" - there is no provider call to be in flight), so state.json's `stage.label`
// only ever names a stage that is genuinely in flight.
let progressHook = () => {};
export function setProgressHook(fn) { progressHook = fn || (() => {}); }

// Money path #4 (Review/PreRelease_Audit_moneypath_2026-09-23.md): two charges were counted toward
// the cap in memory only - a call that failed after it was sent (`maybeBilled`), and an Anthropic
// attempt discarded for thinking when its retry then failed. Neither became a stage, so neither
// reached a usage file, --spend, report.totals or the cap on the next resume, which broke the
// "spend is derived from the run folder" rule. invoke() now reports each one here; the CLI writes it
// to the run folder (superseded/<label>.charge-N.usage.json). Unset, a no-op.
// 0.8.2 item 8b (src/spend-reservations.js): where a paid call's reservation is persisted before it is sent. Null (no file) for a caller that arms none, as the mock-only tests do.
let reservationSink = null;
export function setReservationSink(sink) { reservationSink = sink || null; }
let chargeHook = () => {};
export function setChargeHook(fn) { chargeHook = fn || (() => {}); }

// 0.7.9: the outbound key scan (src/outbound-scan.js), on unless the CLI waives it with
// --allow-secret-shaped. Checked in invoke() after the cache - a replay from disk sends nothing -
// and before the external pause, so a NEEDS file is scanned like a provider call.
let outboundScan = { allow: false };
export function setOutboundScan(opts) { outboundScan = { allow: !!opts?.allow }; }

/**
 * One free-text stage on a seat, outside runChain: the same invoke() every stage goes through, so the
 * spend cap, the denied-model backstop and the outbound key scan all apply. For a caller that needs a
 * single call (src/handoff-from-run.js), never as a way round any of them. Set the cap first
 * (setBudget) or it is uncapped, as for any caller.
 */
export async function runSingleStage(seat, { system, user, log = () => {}, label }) {
  return invoke(seat, { system, user, log, label });
}

// Brief 29: a stop asked for from outside the run (src/cli.js: a STOP file in the run folder, the chain's
// wall-clock ceiling). Returns a reason string once a stop is wanted, else null. Read only by an advice
// call (src/advise.js), before each paid step; calls already in flight finish and are recorded. Unset (every
// caller other than the CLI, including every existing test) it never stops anything.
let stopCheck = () => null;
export function setStopCheck(fn) { stopCheck = fn || (() => null); }

// Test seam, null in production (the same kind as setStopCheck): receives { label, provider, model, system, user } for every stage prompt before it is cached, sent or paused on.
// Door tests use it to prove a sentence reaches the seat. No code under src/ sets it (test/held-prompts.test.js scans for that).
let promptSpy = null;
export function setPromptSpy(fn) { promptSpy = typeof fn === 'function' ? fn : null; }

async function invoke(seat, { system, user, log, label }) {
  promptSpy?.({ label, provider: seat.provider, model: seat.model, system, user });
  const started = Date.now();
  // Backstop for the check at the top of runChain: every call, including a replay from disk.
  const denied = deniedReasonsOf(seat);
  if (denied.length) throw new DeniedModel([{ path: label, reasons: denied }]);
  // Resume: a stage that already ran in this run folder is replayed from
  // disk, so a paused-and-resumed run never pays twice.
  //
  // Pre-release audit 5 #1 (HIGH) and money path #2: only when it answered the SAME prompt. A cached
  // stage records the hash of the prompt it was asked (`promptHash`); a different prompt means an
  // earlier stage came out differently this sitting (a seat that failed before and answered now, an
  // operator's new revision), and replaying the old answer would put - for example - a round-2
  // sign-off of the old draft onto new text no critic read. That is a miss: the stage re-runs, and
  // what the old answer cost still counts toward the cap. `staleInputs` is the CLI's own
  // task/config fingerprint check (cache-integrity.js), decided here for the same two reasons.
  // An external stage is never re-run silently: its old answer is set aside by the cache and the
  // run pauses to ask the operator again with the current prompt. A cached stage from before
  // prompt hashes existed has none; it replays as it always did, with a warning.
  const promptHash = promptHashOf(system, user);
  // The cap's projection for this stage, worked out before the cache is read: a replayed stage whose
  // recorded cost is unreadable is charged one attempt of it (security scan 2026-09-26, THC #3).
  //
  // Bug-audit fix, 2026-09-16: checks `seat.originalProvider ?? seat.provider`, not
  // `seat.provider` alone - resolveVendorSeat() (single-vendor mode) rewrites `provider` to the
  // vendor's own name (e.g. "openrouter") but preserves the seat's real underlying identity in
  // `originalProvider`. Checking the plain `provider` field silently under-projected the budget
  // cap for any Anthropic seat routed through single-vendor mode (assuming 1 attempt when the
  // retry below can still cost 2), the same failure this comment already names for a direct
  // Anthropic seat.
  const anthropicSeat = isAnthropicSeat(seat);   // one predicate (src/cost.js), shared with projectAttempts and the add-on's calls_at_most
  // projectStage (cost.js) is this same worst case, shared with the deep-dive seat's own cap. Since 0.8.1 (milestone R) an Anthropic
  // seat's second attempt is the same-effort retry at a BIGGER cap, so the two attempts differ: the figures are kept apart, and a
  // call that fails after it was sent is charged the worst case of the attempt that failed, not half of the total.
  const attempts = projectAttempts(seat, { system, user });
  const projected = attempts.first + attempts.retry;
  const oneAttempt = attempts.first;
  let attemptWorstCase = attempts.first; // the worst case of the attempt now in flight (set to attempts.retry for the retry)
  const recordedUsd = h => {
    const usd = readUsd(h.usd);
    if (usd !== null) return usd;
    log(`  ${label}: the cost recorded on disk for this stage is not a valid amount - ${formatUsd(oneAttempt)} (one attempt's worst case) counted toward the cap instead.`);
    return oneAttempt;
  };
  let hit = cache.get(label);
  // 0.8.1 FX-9: the cached `handoff` stage may be the final HANDOFF.md on a case-insensitive disk (one file); its
  // lock block is the harness's, never the model's text, so it is cut before the text is used.
  if (hit && label === 'handoff' && typeof hit.text === 'string') hit = { ...hit, text: stripLockBlock(hit.text) };
  if (hit) {
    // Pre-release cache audit #1: the decision is cacheVerdict() (cache-integrity.js). An entry with
    // no record of its inputs is stale now; one from between the two fixes is trusted but recorded
    // through cache.warn (WARNINGS.md and report.json), and every trusted hit's prompt hash is
    // written back by the CLI (onStage), so the gap closes at the next resume.
    const verdict = cacheVerdict(hit, promptHash);
    if (verdict.status === 'stale') {
      const oldUsd = recordedUsd(hit);
      budget.spent += oldUsd;
      cache.invalidate?.(label, verdict.why);
      log(`  CACHE STALENESS WARNING: stage "${label}" - ${verdict.why}; ${seat.provider === 'external' ? 'the old answer was set aside and the operator is asked again' : 're-running it'}${oldUsd ? ` (the ${formatUsd(oldUsd)} the old answer cost still counts toward the cap)` : ''}.`);
      hit = null;
    } else if (verdict.status === 'unverified') {
      cache.warn?.(label, verdict.why);
      log(`  CACHE: stage "${label}" replayed UNVERIFIED - ${verdict.why}. Recorded in WARNINGS.md and report.json.`);
    }
  }
  if (hit) {
    const usd = recordedUsd(hit);
    const usage = hit.usage ? readUsage(hit.usage).usage : { input: 0, output: 0 };
    budget.spent += usd;
    log(`  ${label}: ${hit.provider || seat.provider}/${hit.model || seat.model} - from disk (${usage.input} in, ${usage.output} out, ${formatUsd(usd)} already spent)`);
    // 0.8.1 R: what the original attempt decided survives the replay (the cache file is data: only a positive number and the one known mark are taken).
    const replayed = { ...(Number.isFinite(hit.cappedAt) && hit.cappedAt >= (seat.maxTokens ?? DEFAULT_MAX_TOKENS) ? { cappedAt: hit.cappedAt } : {}), ...(hit.noAnswer === NO_ANSWER_THINKING ? { noAnswer: NO_ANSWER_THINKING } : {}) };
    return { label, provider: hit.provider || seat.provider, model: hit.model || seat.model, lab: labOf(seat), usage, usd, priced: true, ms: 0, text: hit.text, cached: true, promptHash, ...replayed };
  }
  assertOutboundClean(label, { system, user }, outboundScan);
  if (seat.provider === 'external') throw new ExternalPause(label, system, user);
  // 0.8.2 item 8a: under a cap, a seat with no price is refused here, before the only line that spends (see UnpricedSeat).
  if (budget.cap !== null && needsPrice(seat)) {
    log(`  ${label}: REFUSED - ${seat.provider}/${seat.model} has no price, so the spend cap of ${formatUsd(budget.cap)} cannot hold it.`);
    throw new UnpricedSeat({ label, seat: `${seat.provider}/${seat.model}`, cap: budget.cap });
  }

  // The cap is checked here, before the only line in this file that spends
  // money. Anthropic seats are projected at two attempts because invoke()
  // below may pay for the same stage twice (the thinking-disabled retry).
  // (anthropicSeat and `projected` are worked out above, before the cache is read.)
  const verdict = wouldBreach({ spent: budget.spent + budget.reserved, cap: budget.cap, projected });
  if (verdict.breach) {
    const inFlight = budget.reserved > 0 ? ` (plus up to ${formatUsd(budget.reserved)} reserved by calls still in flight)` : '';
    log(`  ${label}: STOPPED - ${formatUsd(budget.spent)} spent${inFlight}, this stage could cost up to ${formatUsd(projected)}, ceiling is ${formatUsd(budget.cap)}.`);
    throw new BudgetExceeded({ label, seat: `${seat.provider}/${seat.model}`, spent: budget.spent, cap: budget.cap, projected });
  }
  // Reserved synchronously - no await between the check above and this line - and released in the
  // finally below whether the call succeeds or throws. See `reserved` at the top of the budget block.
  budget.reserved += projected;
  let unrecordedWaste = 0; // a discarded attempt's cost, until a stage that includes it is returned
  let reservationId = null, settled = { outcome: 'failed', usd: 0 };
  try {
    // 0.8.2 item 8b: the reservation is on disk BEFORE the request is sent, so a process killed in flight leaves it (charged at its worst case on resume and in --spend). A call projected at $0 writes none. If the
    // line cannot be written the call is not sent: the finally below releases the in-memory reservation.
    if (reservationSink && projected > 0) {
      try { reservationId = reservationSink.reserve({ label, seat: `${seat.provider}/${seat.model}`, usd: projected }); } catch (e) {
        // controlFlow: no catch around a call stage may turn "the reservation could not be written" into an abstention and carry on; the run stops, nothing was sent.
        const err = new Error(`${label}: the spend reservation could not be written (${e?.code ?? e?.message}), so the call was not sent`);
        err.controlFlow = true;
        throw err;
      }
    }

    progressHook({ label, lab: labOf(seat), startedAt: new Date().toISOString() });

    const firstCap = seat.maxTokens ?? DEFAULT_MAX_TOKENS;
    // 0.8.1 milestone R (owner: "I want reasoning to always be 'High' for the 'High' Council"; "NO LOWER EFFORT"): the reasoning setting a
    // request carries is the seat's own, plus "high" where it is unset (src/reasoning.js; a seat the table has no field for gets nothing).
    // The retry below sends the SAME `sentExtra`: no path in this file lowers a seat's effort (test/reasoning-never-lower.test.js scans for it).
    const sentExtra = extraWithHighDefault(seat, firstCap);
    const ask = (extra, maxTokens = firstCap) => call(seat.provider, {
      model: seat.model,
      system,
      messages: [{ role: 'user', content: user }],
      maxTokens,
      temperature: seat.temperature,
      extra,
      // v7.1: a seat's own override of its provider's default base URL - e.g. LM Studio on
      // :1234 instead of Ollama's :11434, or a remote Ollama box. Ignored by every adapter except
      // callOpenAICompat, which is the only one that reads it.
      baseUrl: seat.baseUrl,
    });
    // Usage the cap cannot read (a NaN, a negative or non-numeric count, no usage at all) is
    // zeroed in the record and charged at one attempt's projection (cost.js readUsage).
    const readRes = r => { const { usage, unreadable } = readUsage(r.usage); return { ...r, usage, unreadable }; };
    // Bug audit 2026-09-27 H1: the provider names the model that actually answered (an OpenRouter
    // extra.models fallback, a dated alias), and an unpriced answering model cost $0, so the cap went
    // blind for that call. It is charged at the seat's own model's price instead, and says so.
    const priceAnswer = r => {
      const own = costOf(r.provider, r.model, r.usage);
      if (own.priced || r.model === seat.model) return own;
      const asSeat = costOf(r.provider, seat.model, r.usage);
      if (asSeat.priced) log(`  ${label}: answered by ${r.provider}/${r.model}, which has no price entry - charged at ${seat.model}'s price.`);
      return asSeat.priced ? asSeat : own;
    };
    const costOfRes = r => {
      const measured = priceAnswer(r);
      if (!r.unreadable) return measured;
      if (attemptWorstCase > 0) log(`  ${label}: ${r.provider}/${r.model} reported usage the spend cap cannot read (${r.unreadable}) - ${formatUsd(attemptWorstCase)} (one attempt's worst case) counted toward the cap.`);
      return { usd: attemptWorstCase, priced: measured.priced };
    };
    let finalCap = firstCap; // the cap the answer in hand was asked at: the retry's when this function retried (outer cut-off retries start from it)
    let res = readRes(await ask(sentExtra));
    let wasted = 0;
    // Claude's adaptive thinking counts against max_tokens and is not text. On
    // a hard prompt it can spend the whole budget before writing a word - the
    // netcode review on 2026-09-07 did exactly that three stages in a row, and
    // the panel reviewed an empty page twice. The same budget can also cut a
    // reply off mid-sentence (the v2 criteria stage, same day: 1534 thinking
    // tokens, JSON truncated), which is just as unusable. Either way: retry
    // once. Until 0.8.0 the retry switched thinking OFF; since 0.8.1 (owner: "NO LOWER EFFORT!!!!") it keeps the SAME effort and gives the
    // call a bigger cap (retryCapFor, bounded by the model's own maximum and its transport), and a reply that is still no text is recorded
    // as "no answer: thinking used the whole cap" (an unreadable non-pass, never a silent pass, never a downgrade).
    //
    // Bug-audit fix, 2026-09-16: also accepts `'length'`, not only the literal `'max_tokens'` -
    // an Anthropic seat routed through single-vendor mode answers via callOpenAICompat(), not
    // callAnthropic(), and OpenAI-compatible APIs (including OpenRouter) report a token-limit stop
    // as `finish_reason: "length"`, never the literal string `"max_tokens"` that is Anthropic's own
    // native API vocabulary. The `cut`/"[hit the cap]" log indicator a few lines below already
    // checked both spellings; this retry trigger only checked one, so it silently never fired for
    // any single-vendor-routed Anthropic seat even after the `anthropicSeat` fix above.
    if (anthropicSeat && res.usage.thinking > 0 && (res.usage.stop === 'max_tokens' || res.usage.stop === 'length')) {
      const retryCap = retryCapFor(firstCap, retryCeilingOf(seat));
      const how = res.text.trim() ? `text cut off - ${res.usage.thinking} of ${res.usage.output} tokens went to thinking` : `empty text - all ${res.usage.output} tokens went to thinking`;
      if (retryCap > firstCap) {
        wasted = costOfRes(res).usd;
        // Counted now, not with the final stage: if the retry below throws, this attempt was still
        // billed (bug-audit fix, 2026-09-23, BugAudit_MoneyPath #4a - it used to vanish from `spent`).
        budget.spent += wasted;
        unrecordedWaste = wasted;
        log(`  ${label}: ${how} (stop: max_tokens, ${formatUsd(wasted)} spent); retrying once at the same effort with a bigger cap (${firstCap} -> ${retryCap} tokens).`);
        attemptWorstCase = attempts.retry;
        finalCap = retryCap;
        res = readRes(await ask(sentExtra, retryCap));
      } else {
        log(`  ${label}: ${how} (stop: max_tokens); no retry: ${firstCap} tokens is already the most this model/transport can return.`);
      }
    }
    const cost = costOfRes(res);
    const stage = {
      label,
      provider: res.provider,
      model: res.model,
      lab: labOf(seat),
      usage: res.usage,
      usd: cost.usd + wasted,
      priced: cost.priced,
      ms: Date.now() - started,
      text: res.text,
      promptHash,
      // Brief 29 (25 section 6.2): what the audit line needs to show which text went where, without a second
      // copy of the text: the exact prompt's full sha256 and size, the endpoint the provider says served the
      // call (OpenRouter names it; null when the reply does not), and that the outbound key scan was on.
      promptSha256: promptSha256Of(system, user),
      promptBytes: Buffer.byteLength(system ?? '') + Buffer.byteLength(user ?? ''),
      endpoint: typeof res.endpoint === 'string' ? res.endpoint : null,
      scan: outboundScan.allow ? 'waived' : 'clean',
      // 0.8.1 milestone R: a reply cut off at its cap whose tokens were all thinking and which carries no text. The seat has NO answer; callers
      // record it as an unreadable non-pass (a panel seat is "unheard"). Additive: nothing reads this as consent.
      ...(isNoAnswerReply(res) ? { noAnswer: NO_ANSWER_THINKING } : {}),
      // 0.8.1 R review: the cap this answer was asked at. An Anthropic seat was already retried at the bigger cap here, so a caller's cut-off retry
      // starts from THIS cap and is skipped when it has no room (it used to repeat the same paid call).
      cappedAt: finalCap,
    };
    budget.spent += cost.usd; // `wasted` was already added when the first attempt was discarded
    unrecordedWaste = 0; // stage.usd carries it now
    const think = res.usage.thinking ? ` (${res.usage.thinking} thinking)` : '';
    const cut = res.usage.stop === 'max_tokens' || res.usage.stop === 'length' ? ' [hit the cap]' : '';
    log(`  ${label}: ${res.provider}/${res.model} - ${res.usage.input} in, ${res.usage.output} out${think}${cut}, ${formatUsd(stage.usd)}, ${(stage.ms / 1000).toFixed(1)}s`);
    settled = { outcome: 'recorded', usd: stage.usd };
    return stage;
  } catch (err) {
    settled = { outcome: err?.maybeBilled ? 'billed_unreadable' : 'failed', usd: err?.maybeBilled ? attemptWorstCase : 0 };
    if (unrecordedWaste > 0) chargeHook({ label, provider: seat.provider, model: seat.model, usd: unrecordedWaste, reason: 'an attempt discarded because thinking used the whole budget; its retry then failed' });
    // A call that failed after the request reached the provider (providers.js marks it
    // `maybeBilled`: a dropped 200 body, a non-JSON 200, a post-send timeout) was probably paid
    // for, and its usage is unreadable. Charge one attempt's projection so the cap still sees it
    // (bug-audit fix, 2026-09-23, BugAudit_Providers #1). Conservative by construction - the
    // projection is the worst case.
    if (err?.maybeBilled) {
      const charge = attemptWorstCase; // the worst case of the attempt that failed (the retry's is bigger than the first's since 0.8.1)
      budget.spent += charge;
      chargeHook({ label, provider: seat.provider, model: seat.model, usd: charge, reason: 'failed after it was sent and may have been billed (one attempt\'s worst case)' });
      log(`  ${label}: the call failed after it was sent and may have been billed - ${formatUsd(charge)} (one attempt's worst case) counted toward the cap.`);
    }
    throw err;
  } finally {
    budget.reserved -= projected;
    if (reservationId) reservationSink.settle(reservationId, settled);
  }
}

// 7.x single-vendor mode: the one composition point that rewrites a config's whole seat roster
// through resolveVendorSeat() - every seat-bearing slot, single or array, checked once here
// rather than at each of runChain()'s many invoke() call sites. A seat's own `transport`
// overrides the chain-level `config.transport`; neither present is a no-op (returns `config`
// unchanged, not even a shallow clone) so a chain that never sets either behaves exactly as it
// does today. Called once, up front, by both cli.js (before checkSeats/--dry-run, so both see
// the resolved vendor routing) and runChain() itself (so a caller that skips cli.js, e.g. the
// MCP path or a direct test, still gets the same resolution without remembering to call it).
// Bug-audit fix, 2026-09-16: both the singular-seat rewrite list below and allSeatsOf() used to
// name only the 8 original slots from when single-vendor mode first shipped, missing 5 real seat
// slots added by later items - challenger (§ bounded challenge stage), coldRead (post-signoff
// cold-reader), claims (claim extraction), ambiguity (an ARRAY, like critics/proposers), and
// descending (an OBJECT keyed by stage name, unlike every other slot). A chain naming a
// vendor-transport override only on one of these 5 slots (or naming `config.transport` while
// relying on one of these 5 for its own seat) had that seat silently skip vendor-rewrite -
// allSeatsOf()'s own "does anything need rewriting" early-exit check missed it just as
// completely as the rewrite loop itself did.
export function resolveChainSeats(config) {
  if (!config.transport && !allSeatsOf(config).some(s => s?.transport)) return config;
  // Bug-audit fix, 2026-09-23 (Review/BugAudit_GuardLayer_2026-09-23.md #8): a seat rerouted
  // through a vendor kept its own `region` ("EU") although its data now goes to that vendor, so an
  // EU-only policy and the compliance lint both passed a chain that set `transport`. The claim is
  // dropped - kept as `routedFromRegion` for the record - so allowed_regions fails closed on it.
  const rw = s => {
    if (!s) return s;
    const out = resolveVendorSeat(s, s.transport || config.transport);
    if (out !== s && out.provider !== s.provider && out.region !== undefined) {
      const { region, ...rest } = out;
      return { ...rest, routedFromRegion: region };
    }
    return out;
  };
  const seats = { ...config.seats };
  for (const key of ['criteria', 'builder', 'reviser', 'finalist', 'skeleton', 'handoff', 'questions', 'judge', 'challenger', 'coldRead', 'claims', 'security_reviewer', 'deep_dive']) {
    if (seats[key]) seats[key] = rw(seats[key]);
  }
  for (const key of ['critics', 'proposers', 'ambiguity', 'alternatives']) {
    if (Array.isArray(seats[key])) seats[key] = seats[key].map(rw);
  }
  // `descending` is a map of stageName -> seat (src/chain.js's own builderSeat lookup:
  // `config.seats.descending[stageName]`), not a single seat or a plain array - rewrite each
  // value in place rather than treating the object itself as one seat.
  if (seats.descending && typeof seats.descending === 'object') {
    const descending = {};
    for (const [stageName, seat] of Object.entries(seats.descending)) descending[stageName] = rw(seat);
    seats.descending = descending;
  }
  // Security-review fix (Fable 5.1 review of c915eba, MEDIUM 3): `security_reviewer` is the one
  // seat slot with a real, live fallback picked at STAGE-RUN time, not config-load time -
  // security-review.js's own `runSecurityReviewStage` does
  // `config.seats?.security_reviewer || DEFAULT_SECURITY_REVIEWER_SEAT`. Adding the key to the
  // rewrite loop above only helps when a chain names its own security_reviewer seat explicitly;
  // a chain-level `transport` with NO explicit security_reviewer would otherwise still fall
  // through to that raw default (a hardcoded direct-Anthropic seat) at stage-run time, bypassing
  // single-vendor mode for the one stage that runs last. Materialize the resolved default into
  // `seats.security_reviewer` here so the stage's own fallback lookup finds an already-routed
  // seat instead of the raw constant - gated on `security_review.enabled` (the same real
  // condition cost.js's own projection already checks), not merely on a transport being set:
  // DEFAULT_SECURITY_REVIEWER_SEAT's model (claude-fable-5-1) has no VENDOR_MODEL_MAPS route at
  // all, so resolving it unconditionally would throw "no route for..." for every single-vendor
  // chain that simply never enables the security-review stage - a real chain shape this fix must
  // not break.
  if (config.transport && config.security_review?.enabled === true && !seats.security_reviewer) {
    seats.security_reviewer = rw(DEFAULT_SECURITY_REVIEWER_SEAT);
  }
  return { ...config, seats };
}

// Every seat slot a chain can fill, with the name of the slot (`role`), in one place. `allSeatsOf`
// and `everySeatOf` below are this list with the names dropped, so a reader that wants the roles
// (the dry run's per-seat key report, src/dry-run.js) cannot drift from the guards that read the
// seats. The order is the one those functions always had.
const SINGLE_SEAT_KEYS = ['criteria', 'builder', 'reviser', 'finalist', 'skeleton', 'handoff', 'questions', 'judge', 'challenger', 'coldRead', 'claims', 'security_reviewer', 'deep_dive'];
const LIST_SEAT_KEYS = ['critics', 'proposers', 'ambiguity', 'alternatives'];
export function seatSlotsOf(config) {
  const s = config.seats || {};
  const out = [];
  for (const key of SINGLE_SEAT_KEYS) if (s[key]) out.push({ role: key, seat: s[key] });
  for (const key of LIST_SEAT_KEYS) (s[key] || []).forEach((seat, i) => { if (seat) out.push({ role: `${key}[${i}]`, seat }); });
  for (const [stage, seat] of Object.entries(s.descending || {})) if (seat) out.push({ role: `descending.${stage}`, seat });
  return out;
}

function allSeatsOf(config) {
  return seatSlotsOf(config).map(x => x.seat);
}

// Every seat a run can call, for the guards (policy.json, the missing-key check). Bug-audit fix,
// 2026-09-23 (Review/BugAudit_GuardLayer_2026-09-23.md #2): cli.js used a hand-kept list of 7
// slots plus proposers/critics, so policy.json never saw judge, challenger, coldRead, claims,
// ambiguity, descending, preflight or the default security reviewer - a Grok challenger passed an
// EU/Mistral-only policy. This adds the two seats allSeatsOf cannot see (preflight.seats and the
// security reviewer a run falls back to) and is the one list the CLI's guards read.
export function everySeatSlotsOf(config) {
  const slots = seatSlotsOf(config);
  if (Array.isArray(config?.preflight?.seats)) config.preflight.seats.forEach((seat, i) => { if (seat) slots.push({ role: `preflight.seats[${i}]`, seat }); });
  if (config?.security_review?.enabled === true && !config.seats?.security_reviewer) slots.push({ role: 'security_reviewer (default)', seat: DEFAULT_SECURITY_REVIEWER_SEAT });
  return slots;
}
export function everySeatOf(config) {
  return everySeatSlotsOf(config).map(x => x.seat);
}

export function checkSeats(seats) {
  const missing = [];
  for (const s of seats) {
    if (!s) continue;
    if (!keyFor(s.provider)) missing.push(`${s.provider} (seat ${s.model})`);
  }
  return [...new Set(missing)];
}

/**
 * Run the chain.
 *
 * Two termination modes, both against the same fixed, binary checklist - only
 * how many labs must agree changes, never what they're allowed to ask for:
 *
 *  - "first" (default): alternate one critic and a revision until any single
 *    critic passes the draft, or the round cap is reached.
 *  - "unanimous": every critic seat reviews the SAME draft each round; a round
 *    only counts as a pass if every one of them independently signs off with
 *    no failures. Otherwise the reviser fixes the union of everything any
 *    critic flagged, and the whole panel reviews again next round.
 *
 * Panel topology, unanimous mode only (config.panel):
 *  - "independent" (default): each critic sees only the draft. Verdicts are
 *    uncorrelated, so disagreement between labs means something.
 *  - "relay" (experimental): critics run one after another and each is handed
 *    the verdicts before it - the chain as originally sketched. On the one
 *    controlled comparison so far (Docs/Runs.md) it caught 0/3 of a real
 *    scope leak the blind panel caught 2/3: anchoring on the first seat.
 *    Kept for comparison runs. Seat order is randomised per round and earlier
 *    verdicts are anonymised, which is the best-evidenced mitigation short of
 *    not doing it.
 *
 * The round cap is the whole point either way - an uncapped refine loop
 * drifts, whether that's one critic asked again and again or a panel asked
 * to keep agreeing.
 */
// v7 §3, descending rounds (config.descending: true; absent key preserves runChain's
// existing behaviour exactly). Each round debates a NEW, frozen object in sequence -
// plan, then architecture, then edge cases, then code by default - rather than
// re-debating the same draft. A stage is built once, then reviewed by every critic
// seat; a critic's amendment is applied only if it targets the stage still open.
// An amendment naming any earlier, already-frozen stage is rejected here, at the
// executor level - not by the critic's own system prompt (src/roles.js's
// DESCENDING_CRITIC_SYSTEM asks nicely, but this is the line that actually enforces
// it, per this project's documented history of unenforced prompt rules).
const DEFAULT_DESCENDING_ORDER = ['plan', 'architecture', 'edge_cases', 'code'];

export async function runDescendingChain({ request, config, log = console.log, onStage = () => {}, snap = null }) {
  const stages = [];
  // Every stage this function runs - its own descending-build/critic calls, and every stage
  // invoke()'d inside the two runChain() sub-calls below via the shared onStage hook - lands in
  // this one array, so result.totals is priced across the whole descending run, not just the
  // stages this function invokes directly.
  const record = s => { stages.push(s); onStage(s); return s; };
  const subOnStage = s => { stages.push(s); onStage(s); };
  const opt = config.descending === true ? {} : config.descending;
  const order = Array.isArray(opt.stages) && opt.stages.length ? opt.stages : DEFAULT_DESCENDING_ORDER;
  const criticSeats = config.seats.critics || [];

  const frozen = {};
  const rejectedAmendments = [];
  let planResult = null;
  // report-partial.json (see partialDefaults): a cap hit inside either sub-run arrives with that
  // sub-run's own partial attached; the plan sub-run's debate record and every stage of the whole
  // descending run (this array) replace what the sub-run alone could see.
  if (snap) snap.fn = err => {
    const sub = err?.partial || {};
    return {
      ...partialDefaults(),
      ...sub,
      ...(planResult ? {
        proposals: planResult.proposals ?? [], proposalPool: planResult.proposalPool ?? [],
        dropouts: planResult.dropouts ?? [], board: planResult.board ?? null, debate: planResult.debate ?? null,
      } : {}),
      criteria: sub.criteria?.length ? sub.criteria : (planResult?.criteria ?? []),
      descending: true,
      stages,
      totals: summarise(stages),
    };
  };

  for (let i = 0; i < order.length; i++) {
    const stageName = order[i];
    log(`\nStage (descending): ${stageName}`);

    let content;
    if (i === 0) {
      // Round 1 (the first stage, "plan" by default) runs through the EXISTING pipeline once -
      // criteria, skeleton, proposals, debate, reply, build - rather than a bespoke descending
      // prompt, so criteria and proposals are established exactly the way every other chain
      // establishes them. Critique/revise, the final edit and handoff are deliberately skipped
      // here (maxRounds: 0, no finalist, no handoff seat) - those run once, after the loop, over
      // the whole descending stack, not per stage.
      const planConfig = {
        ...config,
        descending: undefined,
        maxRounds: 0,
        seats: { ...config.seats, finalist: undefined },
        handoff: false,
        // The security gate reviews the FINAL stack, once. Pre-release audit 2026-09-23
        // (GuardLayer #1): both sub-runs used to run it under the same `security-review` label,
        // so the final review was replayed from the plan-stage one and never read the final stack.
        security_review: undefined,
        // 0.8.2: the cold read runs once, over the final stack, not on the plan sub-run as well.
        coldRead: undefined,
        // "How this plan was argued" needs the plan sub-run's debate and the final sub-run's
        // verdicts in one record, which neither sub-run has. Not supported with descending yet:
        // chain-lint refuses the pair, and neither sub-run runs the stage.
        argued: undefined,
      };
      planResult = await runChain({ request, config: planConfig, log, onStage: subOnStage });
      content = planResult.deliverable;
    } else {
      const builderSeat = (config.seats.descending && config.seats.descending[stageName]) || config.seats.builder;
      const built = record(await invoke(builderSeat, {
        system: R.DESCENDING_BUILD_SYSTEM,
        user: R.descendingBuildUser({ request, stageName, frozen, order }),
        log, label: `descending-${stageName}`,
      }));
      content = built.text;
    }

    for (const critic of criticSeats) {
      const res = record(await invoke(critic, {
        system: R.DESCENDING_CRITIC_SYSTEM,
        user: R.descendingCriticUser({ request, stageName, content, frozen, order }),
        log, label: `descending-${stageName}-critic-${labOf(critic)}`,
      }));
      const parsed = parseJson(res.text);
      const amend = parsed?.amend;
      if (!amend || !amend.target) continue;

      // The lock: an amendment targeting anything other than the currently open
      // stage is rejected outright, regardless of which stage it names or whether
      // that stage even exists. Frozen means frozen.
      if (amend.target !== stageName) {
        const rejection = {
          stage: stageName,
          critic: labOf(critic),
          target: amend.target,
          text: amend.text || '',
          reason: frozen[amend.target] !== undefined
            ? `stage "${amend.target}" is frozen; amendments must target the current stage ("${stageName}")`
            : `"${amend.target}" is not the current stage ("${stageName}")`,
        };
        rejectedAmendments.push(rejection);
        log(`  rejected: ${labOf(critic)} tried to amend "${amend.target}" - ${rejection.reason}`);
        continue;
      }
      if (amend.text) {
        content += `\n\nAmendment (${labOf(critic)}): ${amend.text}`;
        log(`  amended ${stageName} per ${labOf(critic)}`);
      }
    }

    frozen[stageName] = content;
  }

  const stackDeliverable = order.map(s => `# ${s}\n\n${frozen[s]}`).join('\n\n');

  // Final round: signoff and handoff run once, over the whole descending stack together - never
  // per stage. Reuses the existing critic/revise, finalist and handoff machinery by handing the
  // stack in as `draft`, which is what already makes runChain skip questions/criteria/proposals
  // and go straight to critique.
  const finalConfig = {
    ...config,
    descending: undefined,
    argued: undefined,
    criteria: (planResult?.criteria && planResult.criteria.length) ? planResult.criteria : config.criteria,
  };
  const finalResult = await runChain({ request, config: finalConfig, draft: stackDeliverable, log, onStage: subOnStage });

  return {
    descending: true,
    order,
    frozen,
    stages,
    rejectedAmendments,
    deliverable: finalResult.deliverable,
    criteria: finalResult.criteria,
    proposals: planResult?.proposals ?? [],
    proposalPool: planResult?.proposalPool ?? [],
    dropouts: planResult?.dropouts ?? [],
    board: planResult?.board ?? null,
    debate: planResult?.debate ?? null,
    // 0.8.2: what each debate reader saw happened in the plan sub-run (the final stack has no debate), so it is forwarded from there.
    ...(planResult?.debateOrders?.length ? { debateOrders: planResult.debateOrders } : {}),
    handoff: finalResult.handoff,
    passed: finalResult.passed,
    lastCritique: finalResult.lastCritique,
    signoff: finalResult.signoff,
    // v7.3: forwarded from finalResult so allocator (and challenge, the same
    // pre-existing gap) work when stacked with descending - the final round
    // over the whole descending stack is a normal runChain() unanimous-panel
    // call and already computes both; this just stops dropping them here.
    challenge: finalResult.challenge,
    allocator: finalResult.allocator,
    disputes: finalResult.disputes,
    history: finalResult.history,
    // Pre-release audit 2026-09-23 (GuardLayer #1, and PanelSignoff's backlog): these were dropped
    // here, so a descending chain's security gate never reached the CLI (no exit 7/8, no gate in
    // report.json) and the panel/dispute record was lost. Forwarded only when the final run set them.
    ...Object.fromEntries(['security_review', 'panelVerdicts', 'missingCriteria', 'signoffTableGaps', 'outsideCriteriaRows', 'debateOrders', 'answerBack', 'answerBackReplies', 'coldRead', 'signedText', 'deliveredText', 'handoffText', 'criteriaLints', 'dispute', 'regressions', 'noHeardReviewer', 'notQuorate']
      .filter(k => finalResult[k] !== undefined).map(k => [k, finalResult[k]])),
    totals: summarise(stages),
  };
}

// A run the per-run spend cap stopped (0.7.7, report-partial.json). A stopped run writes no
// report.json - that file's existence means "finished" everywhere - so a run capped after 11
// rounds (premium-7, 2026-09-25, $33.33 of $36) left ~300 stage files and no machine-readable
// summary of its proposals, debate, per-round verdicts or costs. runChain now attaches what it has
// so far to the BudgetExceeded it throws, as `err.partial`: a result object of the same shape it
// returns on success, with every stage it never reached at the value meaning "did not run". The
// CLI writes it through reportJsonShape() as report-partial.json. Additive only: no stage, label or
// cache entry changes, and nothing is attached to any other error.
function partialDefaults() {
  return {
    criteria: [], questions: null, proposals: [], proposalPool: [], dropouts: [], board: null, debate: null,
    scoreboard: null, passed: false, lastCritique: null, signoff: null, challenge: null, allocator: null,
    disputes: [], regressions: [], panelVerdicts: [], history: [], orphanSections: [], withdrawalCycles: 0,
  };
}

export async function runChain(args) {
  // `snap.fn(err)` is set by the running chain (runChainStages, or runDescendingChain for a
  // descending chain) and returns its state so far. A nested runChain (descending mode's two
  // sub-runs) attaches its own first; the outer one then reads err.partial and replaces it.
  const snap = { fn: null };
  try {
    return await runChainStages(args, snap);
  } catch (err) {
    if (err instanceof BudgetExceeded && snap.fn) {
      try { err.partial = snap.fn(err); } catch { /* keep whatever an inner run attached */ }
    }
    throw err;
  }
}

async function runChainStages({ request: requestIn, config, draft: initialDraft = null, log = console.log, onStage = () => {}, runId = null }, snap) {
  // 7.x single-vendor mode: resolved once, before either chain shape runs, so descending mode
  // and the normal stage flow both see vendor-routed seats without duplicating the call.
  config = resolveChainSeats(config);
  // No denied model (xAI/Grok, or a router that could reach it) is ever seated -
  // checked on the resolved roster, before any stage runs. See src/denied-models.js.
  assertNoDeniedModels(config);
  if ('signoff' in config && config.signoff !== undefined && !SIGNOFF_MODES.includes(config.signoff)) {
    throw new Error(`unknown signoff ${JSON.stringify(config.signoff)}: this harness runs ${SIGNOFF_MODES.map(m => `"${m}"`).join(' or ')} only, and will not quietly run a different mode than the chain names.`);
  }
  const shared = duplicateLabSlots(config);
  if (shared.length) {
    throw new Error(`two seats share a lab, so they would share one stage label and one cached reply: ${shared.map(d => `seats.${d.slot} (${d.labs.join(', ')})`).join('; ')}. Give each seat its own "lab".`);
  }
  if (config.descending) return runDescendingChain({ request: requestIn, config, log, onStage, snap });

  // The council advisor (config.advise, src/advise.js): one question, one verdict, the dissent on the
  // record. It has its own short flow - blind opinions, an optional anonymised debate, a roll-up -
  // so it returns here, before the planning stages, like descending mode does. Absent or not `true`:
  // nothing below changes and the result carries no `advise` key. Every call goes through invoke().
  if (config.advise?.enabled === true) {
    if (initialDraft) throw new Error('an advise chain takes a question, not a draft: --from-run and --draft do not apply to it.');
    const adviseStages = [];
    const adviseRecord = s => { adviseStages.push(s); onStage(s); return s; };
    let out;
    try {
      out = await runAdvise(config, {
      // An advice opinion's fields use the critic limit (8,000 since 0.8.1 FX-11) and are recorded as the advice stage's.
      request: requestIn, stages: adviseStages, invoke, record: adviseRecord, parseJson, rethrowControlFlow, settleAll, capField: v => capField(v, { stage: 'advise', field: 'opinion' }),
      abstentionReasonCode, cutOffRetryCap, askedCapOf, BudgetExceeded, defaultMaxTokens: DEFAULT_MAX_TOKENS, runSpent: () => budget.spent, runRemaining: () => (budget.cap === null ? Infinity : budget.cap - budget.spent - budget.reserved), shouldStop: () => stopCheck(), log, snap, partialDefaults,
      });
    } catch (err) {
      // 0.8.1 M6: a stop carries the run so far in the result's shape, as a budget stop does (err.partial), for report-partial.json.
      if (err instanceof AdviceStopped) err.partial = { ...partialDefaults(), deliverable: err.out?.deliverable ?? null, criteria: config.criteria || [], dropouts: err.out?.dropouts ?? [], advise: err.out?.advise ?? null, stages: adviseStages, totals: summarise(adviseStages) };
      throw err;
    }
    return { ...partialDefaults(), deliverable: out.deliverable, criteria: config.criteria || [], passed: true, dropouts: out.dropouts, advise: out.advise, stages: adviseStages, totals: summarise(adviseStages) };
  }

  const stages = [];
  const record = s => { stages.push(s); onStage(s); return s; };
  // report-partial.json (see partialDefaults above): the run so far, read only when the spend cap
  // stops it. A local the run never reached is still in its temporal dead zone, so `peek` reads it
  // as the fallback that means "that stage did not run"; this is safe to call from any point.
  snap.fn = () => {
    const peek = (read, fallback) => { try { return read() ?? fallback; } catch { return fallback; } };
    const props = peek(() => proposals, []);
    const plan = peek(() => draft, null);
    const ledger = props.length ? peek(() => withdrawalLedger(props), null) : null;
    const optional = {
      noHeardReviewer: peek(() => noHeardReviewer, null) || undefined,
      notQuorate: peek(() => notQuorate, null) || undefined,
      ground_truth: peek(() => ground_truth, undefined),
      canary: peek(() => canary, undefined),
      lints: peek(() => lints, undefined),
      claims: peek(() => claims, undefined),
      security_review: peek(() => security_review, undefined),
      dispute: peek(() => dispute, undefined),
      coldRead: peek(() => coldRead, undefined),
      alternatives: peek(() => alternatives, undefined),
      deep_dive: peek(() => deepDive, undefined),
      quoteFindings: peek(() => fencedSource, null) ? peek(() => quoteFindings, undefined) : undefined,
      patchFallbacks: config.revise?.mode === 'patch' ? peek(() => patchFallbacks, undefined) : undefined,
    };
    const crit = peek(() => criteria, []);
    return {
      ...partialDefaults(),
      criteria: crit,
      questions: peek(() => questions, null),
      proposals: props,
      proposalPool: peek(() => proposalPool, []),
      dropouts: peek(() => dropouts, []),
      board: peek(() => board, null),
      debate: peek(() => debate, null),
      scoreboard: props.length && plan ? peek(() => scoreProposals(props, plan), null) : null,
      passed: peek(() => passed, false),
      lastCritique: peek(() => lastCritique, null),
      signoff: peek(() => signoff, null),
      challenge: peek(() => challenge, null),
      allocator: config.allocator?.enabled ? peek(() => ({
        targetedRounds: allocatorRounds,
        engagedCount: allocatorRounds.filter(r => r.engaged).length,
        rubberStampCount: allocatorRounds.filter(r => !r.engaged).length,
      }), null) : null,
      disputes: peek(() => disputes, []),
      regressions: peek(() => regressions, []),
      panelVerdicts: peek(() => panelVerdicts, []),
      missingCriteria: peek(() => missingCriteria, []),
      signoffTableGaps: peek(() => signoffTableGaps, []),
      debateOrders: peek(() => debateOrders, []),
      answerBack: peek(() => answerBackRecords, []),
      answerBackReplies: peek(() => answerBackReplies, []),
      outsideCriteriaRows: peek(() => outsideCriteriaRowList, []),
      criteriaLints: peek(() => criteriaLints, []),
      history: peek(() => history, []),
      stages,
      totals: summarise(stages),
      orphanSections: ledger?.orphanSections ?? [],
      withdrawalCycles: ledger?.withdrawalCycles ?? 0,
      ...Object.fromEntries(Object.entries(optional).filter(([, v]) => v !== undefined)),
      // Through peek like everything else: kindsOn is declared with the criteria stage, so a cap
      // stop at the ambiguity or questions stage read it in its temporal dead zone, the throw was
      // swallowed by runChain, and no report-partial.json was written (bug audit 2026-09-26 #5).
      ...(peek(() => kindsOn, false) ? peek(() => ({
        criteriaKinds: kindsRecord(crit, criteriaKinds),
        criteriaSummary: criteriaSummary(crit, criteriaKinds, { metWithoutEvidence }),
        metWithoutEvidence,
      }), {}) : {}),
    };
  };
  // Every stage whose reply becomes (part of) the deliverable goes through here: a reply cut off at
  // its cap is retried once with a bigger one (cutOffRetryCap, the panel's rule), under its own
  // stable `<label>-retry` label, and if that is cut off too - or the seat is external and cannot be
  // retried - the run stops (DraftTruncated) rather than carry the fragment forward.
  // Bug audit 2026-09-28 (area 2 #2): a debate post or reply round the provider ended with stop
  // "error" (or content_filter / refusal) was recorded as "did not parse" and not retried, so a
  // 2.5-second transient error cost a lab its whole reply round (plan-daily-7's first real run,
  // gemini). One retry at the same cap, under `<label>-retry`; the caller records `provider_error`
  // if that one is incomplete too.
  const onceMoreIfIncomplete = async (st, seat, opts, say) => {
    if (!draftIncomplete(st.usage)) return st;
    say(`  ${opts.label.replace(/-retry$/, '')}: the provider ended the reply with stop "${st.usage.stop}" - retrying once.`);
    return record(await invoke(seat, opts));
  };
  const draftStage = async (seat, opts) => {
    const cap = seat.maxTokens ?? DEFAULT_MAX_TOKENS;
    const first = record(await invoke(seat, opts));
    if (draftIncomplete(first.usage)) {
      if (seat.provider === 'external') {
        throw new DraftTruncated(opts.label, `the external reply reports stop "${first.usage.stop}" - write a complete reply to ${opts.label}.md and resume`, first.usage.stop);
      }
      log(`  ${opts.label}: the provider ended the reply with stop "${first.usage.stop}" - retrying once at the same ${cap}-token cap.`);
      const again = record(await invoke(seat, { ...opts, label: `${opts.label}-retry` }));
      if (draftIncomplete(again.usage)) {
        throw new DraftTruncated(opts.label, `stop "${first.usage.stop}", and "${again.usage.stop}" again on the retry`, again.usage.stop);
      }
      if (draftCutOff(again.usage, askedCapOf(again, cap))) throw new DraftTruncated(opts.label, `stop "${first.usage.stop}", then cut off at ${cap} tokens on the retry`);
      return again;
    }
    // `from`: the cap the reply in hand was asked at. An Anthropic seat's invoke() may already have retried at the bigger cap (0.8.1), so the
    // draft's own retry starts from there and is skipped when there is no room, instead of repeating the same paid call.
    const from = first.cappedAt ?? cap;
    if (!draftCutOff(first.usage, from)) return first;
    const bigger = cutOffRetryCap(from, retryCeilingOf(seat));
    if (seat.provider === 'external' || bigger <= from) {
      throw new DraftTruncated(opts.label, seat.provider === 'external'
        ? `the external reply reports stop "${first.usage?.stop}" - write a complete reply to ${opts.label}.md and resume`
        : `it already had the largest retry cap (${from} tokens)`);
    }
    log(`  ${opts.label}: cut off at ${from} tokens - retrying once with ${bigger}.`);
    const second = record(await invoke({ ...seat, maxTokens: bigger }, { ...opts, label: `${opts.label}-retry` }));
    if (draftCutOff(second.usage, bigger)) {
      throw new DraftTruncated(opts.label, `cut off at ${from} tokens, and again at ${bigger} on the retry`);
    }
    return second;
  };
  let request = requestIn;

  // The fenced source a human put in the task (src/fence.js), read once before any stage runs
  // because the criteria stage already needs to know whether the quote rule is honest to state.
  // Empty when the task carries none, which disables quote validation rather than faking it.
  const fencedSource = fencedSourceOf(request);
  const quoteFindings = [];
  // Patch-mode bookkeeping (src/patch-revise.js). `lastPatches` feeds the critics' "Changed
  // since your last review" section; `patchFallbacks` records every round the edits did not
  // apply, which is the only real-model evidence this feature can produce.
  let lastPatches = null;
  const patchFallbacks = [];

  // v7 item 1: tool-grounded verification, gated on config.verify.enabled.
  // Absent/false key: skip entirely, `ground_truth` stays undefined and is
  // therefore never added to the returned result - v6 behaviour unchanged.
  let ground_truth;
  if (config.verify?.enabled) {
    log('\nStage: verification (ground truth from sandboxed tools)');
    ground_truth = runVerification(config, { runTool: config.verify.runTool, log });
    request += renderGroundTruth(ground_truth);
  }

  // 0a. Ambiguity union (config.ambiguity_union.enabled, item 5). Absent or
  // false: skipped entirely, request is untouched, and the questions/criteria
  // stages' input is unchanged from today. Three cheap seats each list the
  // ambiguities they see in the raw request before any proposal exists; the
  // union is appended to `request`, which every later stage already reads,
  // so this costs no new plumbing beyond the stage itself.
  let ambiguities = null;
  if (config.ambiguity_union?.enabled && !initialDraft) {
    const seats = config.seats.ambiguity || (config.seats.critics || []).slice(0, 3);
    log(`\nStage: ambiguity union (${seats.length} seat(s) list ambiguities before any proposal exists)`);
    const results = await settleAll(seats.map(async seat => {
      const lines = []; const say = m => lines.push(m);
      let list = [];
      try {
        const res = record(await invoke(seat, {
          system: R.AMBIGUITY_SYSTEM,
          user: R.ambiguityUser({ request }),
          log: say, label: `ambiguity-${labOf(seat)}`,
        }));
        const parsed = parseJson(res.text);
        list = Array.isArray(parsed?.ambiguities) ? parsed.ambiguities.filter(a => typeof a === 'string' && a.trim()) : [];
        say(`  ${labOf(seat)}/${seat.model}: ${list.length} ambiguit${list.length === 1 ? 'y' : 'ies'}.`);
      } catch (err) {
        rethrowControlFlow(err);
        say(`  ${labOf(seat)}/${seat.model}: no ambiguity reply (${String(err.message).slice(0, 100)}).`);
      }
      return { lines, list };
    }));
    for (const r of results) r.lines.forEach(m => log(m));
    ambiguities = unionAmbiguities(results.map(r => r.list));
    log(`  union: ${ambiguities.length} unique ambiguit${ambiguities.length === 1 ? 'y' : 'ies'} after dedup.`);
    if (ambiguities.length) request += R.ambiguitiesSection(ambiguities);
  }

  // v7.x item 3: seat-requested bounded tool calls (src/tools.js). Gated on
  // config.tools.seat_requests.enabled PLUS config.verify.tools (the v7 item 1 allowlist itself,
  // unchanged) - a seat can only request a tool already on that allowlist, and only when
  // config-time tool grounding is itself configured. Absent either key: `toolRequestWarnings`
  // stays undefined and is never added to the returned result, and no seat can request a tool
  // mid-stage - v7's config-time-only tool behaviour is unchanged byte-for-byte.
  let toolRequestWarnings;
  if (config.tools?.seat_requests?.enabled && config.verify?.enabled && Array.isArray(config.verify?.tools)) {
    toolRequestWarnings = [];
  }

  // v7.x item 4: canary objections (src/canary.js). Stays `null` (not undefined) whenever
  // config.canary is absent/false so `'canary' in result` reads the same either way this run
  // went - absent-key and "gated but not sampled this run" are both "nothing to report", exactly
  // the always-present-field posture `challenge`/`allocator` already use above.
  let canary = config.canary?.enabled ? { injected: false } : undefined;

  // 0. Questions first (config.questions: { max, wait }). The answers become
  //    part of the request before criteria are written, so the checklist is
  //    written against the resolved request, not the ambiguous one.
  let questions = null;
  if (config.questions && !initialDraft) {
    const max = config.questions.max ?? 6;
    log('\nStage: questions (what would change the plan?)');
    const qs = record(await invoke(config.seats.questions || config.seats.criteria, {
      system: R.QUESTIONS_SYSTEM,
      user: R.questionsUser({ request, max }),
      log, label: 'questions',
    }));
    const parsed = parseJson(qs.text);
    questions = Array.isArray(parsed?.questions) ? parsed.questions.slice(0, max).filter(q => q && q.question) : [];
    if (!questions.length) log('  no usable questions returned; continuing without.');
    else {
      questions.forEach((q, i) => log(`  ${i + 1}. ${q.question}\n     default: ${q.default}`));
      const answersSystem = 'Answer the planner\'s questions. Write plain text: one numbered answer per question, in the same order. An answer may be "default" to take the planner\'s own default. Anything else you want the plan to know may follow the numbered answers.';
      const answersUser = `# The request\n\n${request}\n\n# The questions\n\n${R.renderQuestions(questions)}`;
      let answered = cache.get('answers');
      // Bug audit 2026-09-28 (external seats #3): the answers were replayed with no staleness check,
      // so after a task amendment the old answers were matched, by position, to the new questions.
      // Checked like every other external stage (invoke()): a different prompt, or a changed task or
      // chain, sets the old answers aside and asks again.
      if (answered) {
        const verdict = cacheVerdict(answered, promptHashOf(answersSystem, answersUser));
        if (verdict.status === 'stale') {
          cache.invalidate?.('answers', verdict.why);
          log(`  CACHE STALENESS WARNING: stage "answers" - ${verdict.why}; the old answers were set aside and the operator is asked again.`);
          answered = null;
        } else if (verdict.status === 'unverified') {
          cache.warn?.('answers', verdict.why);
          log(`  CACHE: stage "answers" replayed UNVERIFIED - ${verdict.why}. Recorded in WARNINGS.md and report.json.`);
        }
      }
      if (answered) {
        log(`  answers: from disk (${answered.text.split(/\s+/).length} words)`);
        request += R.answersSection(questions, answered.text);
      } else if (config.questions.wait === false) {
        log('  wait: false - defaults taken for every question.');
        request += R.answersSection(questions, '');
      } else {
        assertOutboundClean('answers', { system: answersSystem, user: answersUser }, outboundScan);
        throw new ExternalPause('answers', answersSystem, answersUser);
      }
    }
  }

  const maxRounds = config.maxRounds ?? 2;
  const stopOnPass = config.stopOnPass !== false;
  const open = config.scope === 'open';
  // Decision records (src/roles.js, DECISIONS_RULE_*): opt-in via `decisions.enabled`, and implied by
  // the `alternatives` stage, whose losing architectures are recorded in the same "Decisions"
  // section. Absent both, every prompt that takes these options is byte-identical to before.
  const promptOpts = { decisions: config.decisions?.enabled === true || config.alternatives?.enabled === true };
  // Tiered councils: the majority guard. Off (absent) in every chain written before it existed, so
  // those runs keep today's reply prompts byte for byte.
  const guard = config.majority_guard?.enabled === true;
  // Criterion kinds (src/criteria-kinds.js): opt-in via `criteria_kinds.enabled`. Absent, no prompt
  // changes, no kinds are recorded, and the result carries no criteria_kinds/criteria_summary key.
  const kindsOn = config.criteria_kinds?.enabled === true;
  if (kindsOn) promptOpts.kinds = true;
  let criteriaKinds = null;
  // Every criteria list this run takes - a seat's reply, a retry's, a hand-written one - goes
  // through here, so the guards below always see plain strings and kinds stay index-aligned.
  const takeCriteria = raw => {
    if (!Array.isArray(raw)) return raw;
    const n = normaliseCriteria(raw);
    criteriaKinds = kindsOn ? (n.kinds || n.texts.map(() => ({ kind: null }))) : null;
    return n.texts;
  };
  const metWithoutEvidence = [];
  // A sign-off whose criteria table left criteria out (src/criteria-ledger.js): recorded, never acted on.
  const missingCriteria = [];
  // 0.8.2 (owner decision 1, 5 Oct 2026): with `signoff_table.required` a sign-off without a full per-criterion table (a row for every criterion, each with evidence) is an abstention, never
  // consent. The seat is re-asked alone (the existing re-ask loop, at most twice a round), the heard clean verdicts are carried, and the round cap still ends it. Off by default.
  const tableRequired = config.signoff_table?.required === true;
  const signoffTableGaps = [];
  // 0.8.2 (owner decision 2): what each debate reader saw, when debate_hygiene.shuffle is on (src/debate-order.js); [] otherwise.
  const debateOrders = [];
  // 0.8.2 (owner decision 3, ticket 10): with `answer_back.enabled` the harness builds, after each revise, what each judge will be shown about its own earlier objections (src/answer-back.js).
  // Data only until the owner's prompt list is approved: the summary is recorded in report.json and the full data is held in `answerBackLatest` (written after each revise; read by the prompt that will
  // render it, which does not exist yet). It is built before the allocator's extra revise, so its changed passages do not include those edits.
  const answerBackOn = config.answer_back?.enabled === true;
  const answerBackRecords = [];
  const answerBackReplies = [];
  let answerBackLatest = {};
  let answerBackRound = 0; // the round the latest answer-back data is for (set at the revise, matched by the next round's reviews)
  // Table rows that name none of the criteria (ticket 16): recorded, never counted.
  const outsideCriteriaRowList = [];
  const noteMissingRows = (critique, round, lab) => {
    if (critique?.meets !== true) return;
    const m = missingCriteriaRows(critique, criteria);
    if (m) missingCriteria.push({ round, lab, ...m });
  };
  const noteUnevidenced = (critique, round, lab, say) => {
    for (const criterion of unevidencedCheckableMets(critique, criteria, criteriaKinds)) {
      metWithoutEvidence.push({ round, lab, criterion });
      say(`    !! MET with no evidence on a checkable criterion: ${criterion}`);
    }
  };
  if (open) log('scope: OPEN - every seat may add scope; additions are recorded, the verdict pass cuts');

  // 0. Preflight (config.preflight, v4 item 2). Absent config: never called, zero behaviour
  // change from v3. Reviews `request` text only - never a diff, never `propose` - so no critic
  // ever authors code. A blocking objection stops the run here, before criteria/proposals/build
  // ever run, the same "thrown, not returned" shape as BudgetExceeded/ExternalPause.
  let preflight;
  if (config.preflight && !initialDraft) {
    log('\nStage: preflight (task-description review only, never a diff)');
    preflight = await runPreflightStage(config, { request, invoke, record, log });
    const objected = preflight.verdicts.filter(v => v.verdict === 'object' && v.objections.length);
    for (const v of objected) log(`  ${v.lab}: OBJECT - ${v.objections.join(' / ')}`);
    if (preflight.blocked) {
      log(`  BLOCKED: ${objected.length} seat(s) objected to the task description before any proposal exists.`);
      throw new PreflightBlocked(preflight);
    }
    log(`  ${preflight.verdicts.length} seat(s), no blocking objection - proceeding to criteria.`);
  }

  // 1. Acceptance criteria. Written before the deliverable exists, so they
  //    describe the request rather than rationalising whatever got built.
  let criteria = takeCriteria(config.criteria);
  // Resume-cache audit #2: criteria handed in (a chain's fixed list, or --from-run's) skipped both
  // guards below, so a run could reuse criteria a guard had rejected. They hold here too; there is
  // no retry for a handed-in list, so a failing one stops before any paid review round.
  // Only the unambiguous signals stop the run: a handed-in list cannot be retried, and the looser
  // "several criteria mention criteria" signal, which is fine for asking a seat once more, would
  // block a legitimate list on a word. That one is reported instead.
  if (criteria && criteria.length) {
    const bad = metaCriteria(criteria, { shapeOnly: true }).length ? 'describe the criteria list itself, not the request'
      : infeasibleCriteria(criteria, { handoff: !!config.handoff, debate: !!config.debate }).length ? 'demand documents a single build stage cannot produce'
      : null;
    if (bad) throw new Error(`The criteria handed to this run ${bad}. Stopped before any paid review round.`);
    if (metaCriteria(criteria).length) log(`  !! some handed-in criteria read as being about the criteria list itself - check them (the run continues).`);
  }
  if (!criteria || criteria.length === 0) {
    log('\nStage: acceptance criteria');
    const s = record(await invoke(resolveCriteriaSeat(config), {
      system: R.criteriaSystem(open, !!fencedSource, promptOpts),
      user: criteriaUserPrompt(request, config),
      log, label: 'criteria',
    }));
    const parsed = parseJson(s.text);
    criteria = takeCriteria(parsed?.criteria);
    if (!Array.isArray(criteria) || criteria.length === 0) {
      throw new Error('The criteria stage returned no usable criteria. Raw output kept in the run log.');
    }
    // 2026-09-22, Zofia run 2026-09-22T12-07-08-270Z: the criteria seat returned criteria for a
    // *criteria list* ("Is a JSON object with a 'criteria' key...") instead of for the request, and
    // the whole panel then failed a correct plan against them for three paid rounds. Retry once,
    // saying what went wrong; if the retry is meta too, stop before any paid review round.
    const infeasible = infeasibleCriteria(criteria, { handoff: !!config.handoff, debate: !!config.debate });
    if (infeasible.length) {
      // Same shape as the meta-criteria guard: one retry naming the problem, then stop rather than
      // pay a panel to fail a draft for not being three files at once.
      log(`  !! ${infeasible.length} criterion/criteria demand documents this stage cannot produce - asking once more.`);
      const again = record(await invoke(resolveCriteriaSeat(config), {
        system: R.criteriaSystem(open, !!fencedSource, promptOpts),
        user: `${criteriaUserPrompt(request, config)}\n\n${criteriaRetryNote('infeasible', infeasible[0])}`,
        log, label: 'criteria-feasibility-retry',
      }));
      const retried = takeCriteria(parseJson(again.text)?.criteria);
      if (!Array.isArray(retried) || retried.length === 0 || infeasibleCriteria(retried, { handoff: !!config.handoff, debate: !!config.debate }).length) {
        throw new Error('The criteria stage twice demanded documents a single build stage cannot produce. Stopped before any paid review round; see the run log.');
      }
      criteria = retried;
    }
    if (metaCriteria(criteria).length) {
      log(`  !! criteria describe the criteria list itself, not the request (${metaCriteria(criteria).length} of ${criteria.length}) - asking once more.`);
      const again = record(await invoke(resolveCriteriaSeat(config), {
        system: R.criteriaSystem(open, !!fencedSource, promptOpts),
        user: `${criteriaUserPrompt(request, config)}\n\n${criteriaRetryNote('meta', metaCriteria(criteria)[0])}`,
        log, label: 'criteria-retry',
      }));
      const retried = takeCriteria(parseJson(again.text)?.criteria);
      if (!Array.isArray(retried) || retried.length === 0 || metaCriteria(retried).length) {
        throw new Error('The criteria stage twice returned criteria about the criteria list rather than the request. Stopped before any paid review round; see the run log.');
      }
      // Bug-audit fix, 2026-09-23 (Review/BugAudit_ChainParsers_2026-09-23.md #5): the retried
      // criteria skipped the feasibility guard, so a retry demanding HANDOFF.md was accepted - the
      // Zofia "criteria about files the panel doesn't grade" failure, reached in a different order.
      // Both guards now hold on whatever criteria the run finally keeps.
      const retriedInfeasible = infeasibleCriteria(retried, { handoff: !!config.handoff, debate: !!config.debate });
      if (retriedInfeasible.length) {
        throw new Error(`The retried criteria demand documents a single build stage cannot produce ("${retriedInfeasible[0]}"). Stopped before any paid review round; see the run log.`);
      }
      criteria = retried;
    }
  }
  log(`\nAcceptance criteria (${criteria.length}):`);
  criteria.forEach((c, i) => log(`  ${i + 1}. ${c}`));
  if (kindsOn) {
    criteriaKinds.forEach((k, i) => { if (k.kind === 'checkable') log(`     ${i + 1}: checkable on ${k.on} - ${k.check}`); });
    log(`  ${summaryLine(criteriaSummary(criteria, criteriaKinds))}`);
  }
  // $0 word-level lints over the list, before any paid review round (src/criteria-lints.js): recorded
  // and logged, never a stop.
  const criteriaLints = lintCriteria(criteria);
  for (const f of criteriaLints) log(`  criteria lint (${f.id}): ${f.message}`);
  // The "How the checkable criteria are settled" block for critic and handoff prompts; '' when
  // kinds are off or nothing is checkable, which keeps those prompts byte-identical.
  const checks = kindsOn ? checksSection(criteria, criteriaKinds) : '';

  // 1a. Whole alternative architectures (optional, config.alternatives.enabled; 2026-09-23, Muad:
  //     "have the models argue over whole alternative architectures: I think this is a great
  //     idea"). Before any skeleton exists, every proposer lab writes ONE whole architecture,
  //     blind and concurrently; then the same anonymised post/reply debate proposals use runs over
  //     the alternatives. The board goes to the skeleton and the builder, which choose one or
  //     combine them and record every loser in the plan's "Decisions" section (promptOpts above).
  //     Stage labels (alternative-<lab>, alt-debate-<lab>, alt-reply-<lab>) are stable so resume
  //     and the stage cache replay them; every call goes through invoke(), so the spend cap and
  //     the denied-model backstop apply; lab identity is labOf(), as everywhere else.
  let alternatives = null;
  let alternativesBoard = null;
  if (config.alternatives?.enabled === true && !initialDraft) {
    // Tiered councils (2026-09-26): seats.alternatives, when set, names who writes the whole
    // architectures (the anchors), separately from who proposes parts and debates them (the mass
    // seats in seats.proposers). Absent: today's list, unchanged.
    const altSeats = config.seats.alternatives || config.seats.proposers || config.seats.critics || [];
    // Cap: the seat's own maxTokens, as the proposal stage uses, unless the chain sets
    // alternatives.maxTokens. Pre-release audit 2026-09-23 (Alternatives #1, DecisionRecords #1):
    // a fixed 3000 sat below these rosters' thinking spend (qwen3.8-max 12300, glm5.3-flash 10612
    // on the propose stage), so 3-4 of 7 labs would come back cut off, be retried at the same cap,
    // and drop out mislabelled as "unreadable".
    const perAlt = config.alternatives.maxTokens;
    log(`\nStage: alternatives (${altSeats.length} labs each propose ONE whole architecture, blind)`);
    const altResults = await settleAll(altSeats.map(async seat => {
      const lines = []; const say = m => lines.push(m);
      const lab = labOf(seat);
      const seatCap = seat.maxTokens ?? DEFAULT_MAX_TOKENS;
      const capped = { ...seat, maxTokens: perAlt ? Math.min(seatCap, perAlt) : seatCap };
      const readAlt = text => {
        const j = parseJson(text);
        const one = j && !Array.isArray(j) ? j : null;
        // A model may hand back a list or an object where a string belongs; keep it, as text.
        // FX-11: a whole architecture keeps what its seat was allowed to write (boardTextLimit).
        const lim = { limit: boardTextLimit(capped.maxTokens), stage: `alternative-${lab}` };
        const str = (v, field) => typeof v === 'string' ? capField(v, { ...lim, field }) : v == null ? '' : capField(JSON.stringify(v), { ...lim, field });
        return one && typeof one.name === 'string' && one.name.trim() && typeof one.shape === 'string' && one.shape.trim()
          ? { name: str(one.name, 'name'), shape: str(one.shape, 'shape'), key_tradeoffs: str(one.key_tradeoffs, 'key_tradeoffs'), bad_at: str(one.bad_at, 'bad_at') }
          : null;
      };
      const ask = (label, cap) => invoke({ ...capped, maxTokens: cap }, {
        system: R.ALTERNATIVE_SYSTEM,
        user: R.alternativeUser({ request, criteria }),
        log: say, label,
      });
      let cap = capped.maxTokens;
      let st = record(await ask(`alternative-${lab}`, cap));
      let alt = readAlt(st.text);
      if (!alt) {
        // Same one-retry rule as the proposal stage: an unreadable reply costs one more call,
        // through invoke() like any other, then the lab drops out on the record. A reply cut off
        // at the cap is retried with a bigger one (cutOffRetryCap, the panel's rule), since the
        // same cap would only cut it off again.
        // 0.8.1 R review: the retry starts from the cap the reply was really asked at (st.cappedAt: an Anthropic seat's invoke() may already have
        // retried at the bigger cap) and is skipped when it has no room: it would repeat the same paid call.
        const from = st.cappedAt ?? cap;
        const cut = abstentionReasonCode(st.usage || {}, from) === 'REPLY_TRUNCATED';
        const room = cut ? cutOffRetryCap(from, retryCeilingOf(capped)) : from;
        if (cut && room <= from) {
          say(`  ${lab}/${seat.model}: alternative cut off at ${from} tokens, already the largest retry cap - not retried.`);
        } else {
          if (cut) cap = room;
          st = record(await ask(`alternative-${lab}-retry`, cap));
          alt = readAlt(st.text);
          say(`  ${lab}/${seat.model}: ${cut ? `alternative cut off at ${from} tokens; retried with a ${cap}-token cap` : 'unreadable alternative; retried once'} - ${alt ? 'recovered' : 'still nothing'}.`);
        }
      }
      if (alt) say(`  ${lab}/${seat.model}: "${alt.name}"`);
      const reasonCode = alt ? null : abstentionReasonCode(st.usage || {}, askedCapOf(st, cap));
      return { seat, lab, alt, lines, reasonCode, cap };
    }));
    const items = [];
    const altDropouts = [];
    const seenTag = {};
    for (const { seat, lab, alt, lines, reasonCode, cap } of altResults) {
      lines.forEach(m => log(m));
      if (!alt) {
        const reason = reasonCode === 'REPLY_TRUNCATED' ? `alternative cut off at the token cap (truncated), still cut off after a ${cap}-token retry`
          : reasonCode === 'REASONING_EXHAUSTED' ? 'every output token spent on reasoning, far under the cap (provider-side reasoning ceiling)'
          : reasonCode === 'PROVIDER_ERROR' ? 'provider returned an error mid-generation'
          : 'no readable alternative after a retry';
        // reason_code matches signoff[]/panelVerdicts[]; reasonCode is its deprecated alias (brief 03 fix 3).
        altDropouts.push({ lab, model: seat.model, stage: 'alternatives', reason, reason_code: reasonCode, reasonCode });
        continue;
      }
      let tag = lab.toUpperCase().replace(/[^A-Z0-9]/g, '');
      seenTag[tag] = (seenTag[tag] || 0) + 1;
      if (seenTag[tag] > 1) tag += String(seenTag[tag]);
      items.push({ id: `${tag}-ALT`, lab, model: seat.model, ...alt });
    }
    if (altDropouts.length) log(`  !! ${altDropouts.length} of ${altSeats.length} labs produced no alternative: ${altDropouts.map(d => d.lab).join(', ')}`);

    const posts = [];
    const replies = [];
    let altPostsRealFn = () => posts; // set inside the debate block below when there is one
    if (items.length > 1) {
      const maps = R.anonymise(items);
      const labs = items.map(a => a.lab);
      // Tiered councils: alternatives.debaters "all" lets the proposers (the mass seats) read and post
      // on the architectures too; only the authors reply. Each extra poster gets the next unused
      // "Lab X" letter. Absent or "authors": the posters are the authors, as before.
      const posterSeats = [...altSeats];
      if (config.alternatives.debaters === 'all') {
        for (const s of config.seats.proposers || []) if (!posterSeats.some(p => labOf(p) === labOf(s))) posterSeats.push(s);
      }
      const posterLabs = [...labs, ...posterSeats.map(labOf).filter(l => !labs.includes(l))];
      posterLabs.forEach(l => { if (!maps.labTo[l]) maps.labTo[l] = `Lab ${String.fromCharCode(65 + Object.keys(maps.labTo).length)}`; });
      // 0.8.2 (owner decision 2): per-reader seeded order and letters on the alternatives debate too, when debate_hygiene.shuffle is on (src/debate-order.js).
      const altViews = new Map();
      const altViewOf = lab => {
        if (!(config.debate_hygiene?.shuffle === true)) return { items, maps };
        if (!altViews.has(lab)) {
          const v = readerView(items, lab, { runId: runId ?? '', stage: 'alternatives', anonymise: R.anonymise });
          posterLabs.forEach(l => { if (!v.maps.labTo[l]) v.maps.labTo[l] = `Lab ${String.fromCharCode(65 + Object.keys(v.maps.labTo).length)}`; });
          altViews.set(lab, { items: v.items, maps: v.maps, raw: v });
          debateOrders.push(viewRecord('alternatives', lab, v));
        }
        return altViews.get(lab);
      };
      const altRefsFor = (p, toMaps) => (config.debate_hygiene?.shuffle === true && p.by !== 'canary' && !p.canary ? { ...p, text: translateRefs(p.text, altViewOf(p.by).maps, toMaps) } : p);
      const altPostsFor = author => (config.debate_hygiene?.shuffle === true ? posts.map(p => altRefsFor(p, altViewOf(author).maps)) : posts);
      altPostsRealFn = () => (config.debate_hygiene?.shuffle === true ? posts.map(p => altRefsFor(p, null)) : posts);
      const altTextVariants = x => (config.debate_hygiene?.shuffle === true && x.by !== 'canary' ? [...new Set([x.text, ...[...altViews.values()].map(v => translateRefs(x.text, altViewOf(x.by).maps, v.maps))])] : [x.text]);
      const seatOf = lab => posterSeats.find(s => labOf(s) === lab);
      log(`\nStage: alternatives debate (${posterLabs.length} labs read ${posterLabs.length > labs.length ? `the ${labs.length} authors'` : "each other's"} architectures, anonymised)`);
      const postResults = await settleAll(posterLabs.map(async lab => {
        const lines = []; const say = m => lines.push(m);
        try {
          const st = record(await invoke(seatOf(lab), {
            // No persona here: seat roles apply at exactly one call site, the proposal debate
            // (test/stage-isolation.test.js guards that boundary). Widening it to this stage is a
            // separate decision, not something to slip in with the stage.
            system: withHeldNote(config, R.ALT_DEBATE_SYSTEM, 'debatePostQuoteRule'),
            user: R.altDebateUser({ request, criteria, alternatives: altViewOf(lab).items, lab, maps: altViewOf(lab).maps }),
            log: say, label: `alt-debate-${lab}`,
          }));
          const parsed = parseJson(st.text);
          if (!parsed) { say(`  ${lab}: unreadable debate reply - no posts counted.`); return { lines, posts: [] }; }
          const mine = (parsed.posts || []).map(x => ({ by: lab, on: altViewOf(lab).maps.idFrom[x.on] || x.on, stance: String(x.stance || '').toLowerCase(), text: capField(x.text, { limit: boardTextLimit(seatOf(lab)?.maxTokens), stage: `alt-debate-${lab}`, field: 'text' }) || '', merge_with: boardRef(x.merge_with, altViewOf(lab).maps, new Set(items.map(a => a.id))) }))
            .filter(x => items.some(a => a.id === x.on && a.lab !== lab) && ['support', 'object', 'merge'].includes(x.stance));
          say(`  ${lab}: ${mine.length} post(s)`);
          return { lines, posts: mine };
        } catch (err) {
          rethrowControlFlow(err);
          say(`  ${lab}: no debate reply (${String(err.message).slice(0, 100)}).`);
          return { lines, posts: [] };
        }
      }));
      for (const r of postResults) { r.lines.forEach(m => log(m)); posts.push(...r.posts); }
      // 0.8.2 (decision 2): the same detection as for proposals (src/post-quotes.js), against the alternative the post is about; data only here, the mark is the held reply prompt's.
      if (noQuoteMarksOn(config)) posts.forEach((x, k) => { posts[k] = markPostQuote(x, items); });

      log(`\nStage: alternatives replies (each author answers the posts on its architecture)`);
      const replyResults = await settleAll(labs.map(async lab => {
        const lines = []; const say = m => lines.push(m);
        const mine = items.filter(a => a.lab === lab && posts.some(x => x.on === a.id));
        if (!mine.length) { say(`  ${lab}: nothing to answer.`); return { lines, replies: [] }; }
        try {
          const st = record(await invoke(seatOf(lab), {
            system: withHeldNote(config, R.altReplySystem(guard), 'noQuoteGloss'),
            user: altReplyUserFor(config)({ request, alternatives: altViewOf(lab).items, posts: altPostsFor(lab), lab, maps: altViewOf(lab).maps, guard }),
            log: say, label: `alt-reply-${lab}`,
          }));
          const parsed = parseJson(st.text);
          if (!parsed) { say(`  ${lab}: unreadable reply - its alternative stands as posted.`); return { lines, replies: [] }; }
          const got = (parsed.replies || []).map(r => ({ ...r, id: altViewOf(lab).maps.idFrom[r.id] || r.id, replaced_by: boardRef(r.replaced_by, altViewOf(lab).maps, new Set(items.map(a => a.id))), action: String(r.action || '').toLowerCase(), text: capField(r.text, { limit: boardTextLimit(seatOf(lab)?.maxTokens), stage: `alt-reply-${lab}`, field: 'text' }) || '' }))
            .filter(r => mine.some(a => a.id === r.id) && ['keep', 'amend', 'withdraw'].includes(r.action));
          say(`  ${lab}: ${got.map(r => r.action).join(', ') || 'no usable reply'}`);
          return { lines, replies: got };
        } catch (err) {
          rethrowControlFlow(err);
          say(`  ${lab}: no reply-round answer (${String(err.message).slice(0, 100)}).`);
          return { lines, replies: [] };
        }
      }));
      for (const r of replyResults) { r.lines.forEach(m => log(m)); replies.push(...r.replies); }
      if (guard) guardWithdrawals(replies, posts, log, altTextVariants);
      if (config.debate_hygiene?.shuffle === true) for (const r of replies) { // audit fix cnc-debate F3, alternatives stage: the stored reply is in real names like the stored posts (the guard has already read the author's own copy)
        const own = items.find(x => x.id === r.id);
        if (own) for (const f of ['text', 'conceded_to', 'shape', 'key_tradeoffs', 'bad_at']) if (typeof r[f] === 'string') r[f] = translateRefs(r[f], altViewOf(own.lab).maps, null);
      }
      for (const r of replies) {
        const a = items.find(x => x.id === r.id);
        if (r.action === 'amend') { for (const k of ['shape', 'key_tradeoffs', 'bad_at']) if (typeof r[k] === 'string' && r[k].trim()) a[k] = capField(r[k], { limit: boardTextLimit(seatOf(a.lab)?.maxTokens), stage: `alt-reply-${a.lab}`, field: k }); a.amended = true; }
        if (r.action === 'withdraw' && r.unargued) a.withdraw_unargued = true;
        else if (r.action === 'withdraw') { a.withdrawn = true; a.replaced_by = r.replaced_by; }
      }
    }
    if (items.length) {
      alternativesBoard = (guard ? `${R.GUARD_BOARD_NOTE}\n\n` : '') + R.renderAlternativesBoard(items, altPostsRealFn(), replies);
      alternatives = { items, posts: altPostsRealFn(), replies, dropouts: altDropouts, board: alternativesBoard };
      log(`  alternatives: ${items.length} architecture(s), ${posts.length} post(s), ${items.filter(a => a.withdrawn).length} withdrawn, ${items.filter(a => a.amended).length} amended.`);
    } else {
      alternatives = { items, posts, replies, dropouts: altDropouts, board: null };
      log('  alternatives: no lab produced one - the plan proceeds without an alternatives board.');
    }
  }

  // 1b. Proposal stage (optional, config.proposals). A skeleton first, then
  //     every proposer seat - blind, concurrently - offers up to N buildable
  //     parts against it. The builder integrates and keeps a scope ledger.
  //     Authorship stays with one model: the labs propose, they never
  //     co-write (Docs/Evidence.md: mixed-author merges lose to one strong
  //     author; distinct roles win).
  let proposals = [];
  let dropouts = [];
  const proposalPool = [];
  let skeleton = null;
  let board = null;
  let debate = null;
  if (config.proposals && !initialDraft) {
    const parts = config.proposals.parts ?? 3;
    // Per-part output allowance. Shipped chains set 12,000 since 0.8.1 (FX-12: Hy4 and Qwen were cut off at 12,300 and paid
    // twice): the call below asks min(seat cap, parts x perPart + 300), so 3 parts x 12,000 + 300 = 36,300 is clamped to
    // the seat's own 36,000 and a proposal gets the same output room as every other call of that seat. A cut-off reply is
    // retried once at cutOffRetryCap (64,000 at most), as a critic's is. 1,500 stays the default for a chain that sets none.
    const perPart = config.proposals.maxTokens ?? 1500;
    log('\nStage: skeleton');
    skeleton = record(await invoke(config.seats.skeleton || config.seats.builder, {
      system: R.SKELETON_SYSTEM,
      user: R.skeletonUser({ request, criteria, alternatives: alternativesBoard }),
      log, label: 'skeleton',
    })).text;
    const proposers = config.seats.proposers || config.seats.critics;
    // Context partitioning (v1, opt-in): config.proposals.partition.slices is an optional map
    // keyed by lab name (labOf(seat), the same identity blind-panel/debate logic already keys
    // off) to a per-seat instruction string. Absent field or absent/empty entry for a given seat
    // means that seat's prompt is unchanged from before this existed - partial partitioning
    // (some seats sliced, some not) is allowed by design, not a bug. This threads instruction
    // text only; it never subsets or rewrites the shared request/criteria/skeleton. Mechanism
    // only - no claim here or anywhere else that it changes proposal quality or diversity.
    const partitionSlices = config.proposals.partition?.slices || null;
    if (partitionSlices) {
      const knownLabs = new Set(proposers.map(labOf));
      for (const [lab, text] of Object.entries(partitionSlices)) {
        if (typeof text !== 'string' || !text.trim()) {
          throw new Error(`config.proposals.partition.slices["${lab}"] must be a non-empty string`);
        }
        if (!knownLabs.has(lab)) {
          throw new Error(`config.proposals.partition.slices names unknown lab "${lab}" (known: ${[...knownLabs].join(', ')})`);
        }
      }
    }
    // Best-of-N: `samples` independent attempts per lab, pooled, then a judge
    // keeps the strongest `keep` distinct ones. samples=1 means no judging.
    const samples = config.proposals.samples ?? 1;
    const keep = config.proposals.keep ?? parts;
    log(`\nStage: proposals (${proposers.length} labs, ${samples} attempt(s) of up to ${parts} parts each, blind${samples > 1 ? `; a judge keeps up to ${keep} per lab` : ''})`);
    const results = await settleAll(proposers.map(async seat => {
      const lines = [];
      const say = m => lines.push(m);
      const capped = { ...seat, maxTokens: Math.min(seat.maxTokens ?? DEFAULT_MAX_TOKENS, parts * perPart + 300) };
      const slice = (partitionSlices && partitionSlices[labOf(seat)]) || null;
      const pool = [];
      let unreadable = 0, lastSt = null;
      for (let k = 0; k < samples; k++) {
        const st = lastSt = record(await invoke(capped, {
          system: R.proposerSystem(open),
          user: R.proposerUser({ request, criteria, skeleton, parts, slice }),
          log: say, label: `propose-${labOf(seat)}${samples > 1 ? `-${k + 1}` : ''}`,
        }));
        const parsed = parseJson(st.text);
        const list = Array.isArray(parsed?.proposals) ? parsed.proposals.slice(0, parts) : null;
        if (!list) unreadable++; else pool.push(...list.filter(p => p && p.title).map(p => ({ ...p, attempt: k + 1 })));
      }
      if (unreadable) say(`  ${labOf(seat)}/${seat.model}: ${unreadable} of ${samples} attempt(s) unreadable.`);
      // A lab that returns nothing readable drops out of the panel entirely:
      // no proposals, no seat in the debate, no row anyone is likely to miss
      // it from. For a harness whose whole claim is that independent labs
      // disagree on the record, losing a lab to one malformed reply quietly
      // degrades the exact thing being measured - so buy one retry before
      // accepting it. The retry goes through invoke() like any other call, so
      // the spend cap still governs it.
      if (!pool.length) {
        // Bug audit 2026-09-28 (area 2 #1): a reply cut off at the cap was retried at the same cap,
        // which a reasoning seat fills again (plan-daily-7's first real run: hy4-preview thought through
        // all 12,300 tokens twice and dropped out). Same rule as the alternatives stage: a cut-off is
        // retried with cutOffRetryCap, anything else once at the same cap.
        // 0.8.1 R review: start from the cap the reply was really asked at (lastSt.cappedAt: an Anthropic seat's invoke() may already have
        // retried at the bigger cap) and skip the retry when there is no room: it would repeat the same paid call.
        const from = lastSt?.cappedAt ?? capped.maxTokens;
        const cut = !!lastSt && abstentionReasonCode(lastSt.usage || {}, from) === 'REPLY_TRUNCATED';
        const retryCap = cut ? cutOffRetryCap(from, retryCeilingOf(capped)) : capped.maxTokens;
        if (cut && retryCap <= from) {
          say(`  ${labOf(seat)}/${seat.model}: proposals cut off at ${from} tokens, already the largest retry cap - not retried.`);
        } else {
          const st = record(await invoke({ ...capped, maxTokens: retryCap }, {
            system: R.proposerSystem(open),
            user: R.proposerUser({ request, criteria, skeleton, parts, slice }),
            log: say, label: `propose-${labOf(seat)}-retry`,
          }));
          const parsed = parseJson(st.text);
          const list2 = Array.isArray(parsed?.proposals) ? parsed.proposals.slice(0, parts) : null;
          if (list2) pool.push(...list2.filter(p => p && p.title).map(p => ({ ...p, attempt: samples + 1 })));
          say(`  ${labOf(seat)}/${seat.model}: ${cut ? `proposals cut off at ${from} tokens; retried with a ${retryCap}-token cap` : 'nothing readable; retried once'} - ${pool.length ? `recovered ${pool.length} proposal(s)` : 'still nothing'}.`);
        }
      }
      let list = pool;
      let judged = null;
      if (samples > 1 && pool.length > 0) {
        const judgeSeat = config.seats.judge || seat;
        const js = record(await invoke(judgeSeat, {
          system: R.JUDGE_SYSTEM,
          user: R.judgeUser({ request, criteria, skeleton, pool, keep }),
          log: say, label: `judge-${labOf(seat)}`,
        }));
        const jp = parseJson(js.text);
        const picks = Array.isArray(jp?.picks) ? [...new Set(jp.picks.map(Number).filter(n => n >= 1 && n <= pool.length))].slice(0, keep) : null;
        if (picks && picks.length) {
          list = picks.map(n => pool[n - 1]);
          judged = jp.dropped_because || '';
        } else {
          list = pool.slice(0, keep);
          say(`  ${labOf(seat)}/${seat.model}: judge reply unreadable - keeping the first ${list.length} of the pool.`);
        }
      }
      if (!list.length) say(`  ${labOf(seat)}/${seat.model}: no proposals.`);
      else say(`  ${labOf(seat)}/${seat.model}: ${list.length} proposal(s)${samples > 1 ? ` kept from a pool of ${pool.length}` : ''}${list.map(p => `\n    - ${p.title}`).join('')}${judged ? `\n    judge: ${judged}` : ''}`);
      // v5 §1 candidate 10: opt-in only, no default (his call, 2026-09-13) -
      // a chain that never sets max_proposals_per_seat behaves exactly as it
      // did before this candidate existed. Only a chain that does set it, and
      // only a seat whose own list still exceeds that cap, pays for one more
      // prompt to fold its own proposals down before the board sees them.
      const cap = Number.isInteger(config.proposals.maxProposalsPerSeat) && config.proposals.maxProposalsPerSeat > 0
        ? config.proposals.maxProposalsPerSeat : null;
      if (cap && list.length > cap) {
        const ms = record(await invoke(capped, {
          system: R.PROPOSAL_MERGE_SYSTEM,
          user: R.proposalMergeUser({ request, criteria, skeleton, list, cap }),
          log: say, label: `propose-${labOf(seat)}-merge`,
        }));
        const parsed = parseJson(ms.text);
        const picks = Array.isArray(parsed?.kept) ? [...new Set(parsed.kept.map(Number).filter(n => n >= 1 && n <= list.length))].slice(0, cap) : null;
        const before = list.length;
        list = picks && picks.length ? picks.map(n => list[n - 1]) : list.slice(0, cap);
        say(`  ${labOf(seat)}/${seat.model}: folded ${before} proposal(s) down to ${list.length} (cap ${cap})${parsed?.merged_because ? ` - ${parsed.merged_because}` : ''}`);
      }
      return { seat, list, pool, lines, slice };
    }));
    // Labs that ended the stage with nothing, after the retry. Recorded so
    // the run report shows a shrunken roster instead of leaving it to be
    // inferred from a missing scoreboard row.
    dropouts = results.filter(r => !r.list.length).map(r => ({ lab: labOf(r.seat), model: r.seat.model, stage: 'proposals', reason: 'no readable proposals after a retry' }));

    const seen = {};
    for (const { seat, list, pool, lines, slice } of results) {
      lines.forEach(m => log(m));
      let tag = labOf(seat).toUpperCase().replace(/[^A-Z0-9]/g, '');
      seen[tag] = (seen[tag] || 0) + 1;
      if (seen[tag] > 1) tag += String(seen[tag]);
      // slice metadata only (v1): threads which per-seat instruction, if any, produced this
      // proposal through to whatever reads proposals downstream (debate/critic stages). No
      // debate/critic prompt text or scoring reads this field yet - deferred to a v2 that would
      // render slice-awareness into critic prompts (see chains/mock-partitioned.json's comment).
      // Bug-audit fix, 2026-09-23 (Review/BugAudit_ChainParsers_2026-09-23.md #8): the model's own
      // object was spread LAST, so a proposal carrying its own `id` or `lab` overrode the harness's -
      // duplicate ids were scored `unaccounted`, and a lab could be misattributed. The harness's
      // identity fields now win; the model's values are kept, renamed, for the record.
      const ownIdentity = p => ({
        ...p,
        ...(p.id !== undefined ? { proposer_id: p.id } : {}),
        ...(p.lab !== undefined ? { proposer_lab: p.lab } : {}),
      });
      list.forEach((p, i) => proposals.push({ ...ownIdentity(p), id: `${tag}-${i + 1}`, lab: labOf(seat), model: seat.model, slice: slice || null }));
      pool.forEach(p => proposalPool.push({ ...ownIdentity(p), lab: labOf(seat), model: seat.model, kept: list.includes(p) }));
    }
    log(`  ${proposals.length} proposal(s) go to the builder.`);
    if (dropouts.length) {
      log(`  !! ROSTER SHRANK: ${dropouts.length} of ${proposers.length} labs produced nothing and are not in this run's debate or scoreboard:`);
      for (const d of dropouts) log(`     - ${d.lab}/${d.model} (${d.reason})`);
      log(`     Independence is measured across the labs that actually spoke, not the ones the chain names.`);
    }

    // Debate (config.debate): every lab reads the others' proposals and posts;
    // every author replies. Labs are anonymised in the prompts. The board is
    // what the builder reads instead of bare proposals.
    if (config.debate && proposals.length > 1) {
      const maps = R.anonymise(proposals);
      // 0.8.2 (owner decision 2): with debate_hygiene.shuffle every reader gets its own seeded order and letters (src/debate-order.js); without it, one shared view, byte for byte as before.
      const shuffleOn = config.debate_hygiene?.shuffle === true;
      const views = new Map();
      const viewOf = lab => {
        if (!shuffleOn) return { proposals, maps };
        if (!views.has(lab)) { const v = readerView(proposals, lab, { runId: runId ?? '', stage: 'debate', anonymise: R.anonymise }); views.set(lab, { proposals: v.items, maps: v.maps, raw: v }); debateOrders.push(viewRecord('debate', lab, v)); }
        return views.get(lab);
      };
      // Free text in a post names proposals and labs in the poster's own lettering: re-letter it for each reader (src/debate-order.js translateRefs); null = real ids for the builder's board.
      const refsFor = (p, toMaps) => (shuffleOn && p.by !== 'canary' && !p.canary ? { ...p, text: translateRefs(p.text, viewOf(p.by).maps, toMaps) } : p);
      const postsFor = author => (shuffleOn ? posts.map(p => refsFor(p, viewOf(author).maps)) : posts);
      const postsReal = () => (shuffleOn ? posts.map(p => refsFor(p, null)) : posts);
      const textVariants = x => (shuffleOn && x.by !== 'canary' ? [...new Set([x.text, ...[...views.values()].map(v => translateRefs(x.text, viewOf(x.by).maps, v.maps))])] : [x.text]);
      const labs = [...new Set(proposals.map(p => p.lab))];
      const seatOf = lab => proposers.find(s => labOf(s) === lab);
      log(`\nStage: debate (${labs.length} labs read each other's proposals, anonymised)`);
      const postResults = await settleAll(labs.map(async lab => {
        const lines = []; const say = m => lines.push(m);
        let posts = [], revisions = [], toolResults = [], toolWarnings = [];
        const dropped = [];
        try {
          // v6 §1/§3: role augmentation applies only here, the debate-stage
          // system prompt - never to the panel/critique stage. A seat with
          // no role gets R.DEBATE_SYSTEM back unchanged (applySeatRole is a
          // no-op), which is what the golden-hash compatibility test in
          // test/seat-role.test.js checks.
          // 2026-09-22: loadPersonas() so an operator's COUNCIL_PERSONAS_FILE (PERSONAS.md)
          // actually reaches the prompt - it was documented but never read here, so a custom
          // persona key went out as a bare name with no voice.
          const debatePrompt = {
            system: withHeldNote(config, applySeatRole(R.DEBATE_SYSTEM, seatOf(lab)?.role, loadPersonas()), 'debatePostQuoteRule'),
            user: R.debateUser({ request, criteria, skeleton, proposals: viewOf(lab).proposals, lab, maps: viewOf(lab).maps }),
          };
          const st = record(await invoke(seatOf(lab), { ...debatePrompt, log: say, label: `debate-${lab}` }));
          const st2 = await onceMoreIfIncomplete(st, seatOf(lab), { ...debatePrompt, log: say, label: `debate-${lab}-retry` }, say);
          const parsed = parseJson(st2.text);
          if (!parsed) {
            const why = draftIncomplete(st2.usage) ? 'provider_error' : 'unreadable';
            say(why === 'provider_error' ? `  ${lab}: the provider ended the debate reply with stop "${st2.usage.stop}" (after a retry) - no posts counted.` : `  ${lab}: unreadable debate reply - no posts counted.`);
            dropped.push({ stage: 'debate', by: lab, reason: why });
          }
          else {
            // 0.7.8 (thc-research brief 10, W3): the same filter as before, but every post it
            // rejects is counted with its reason instead of vanishing (debate.dropped).
            posts = (parsed.posts || []).map(x => ({ by: lab, on: viewOf(lab).maps.idFrom[x.on] || x.on, stance: String(x.stance || '').toLowerCase(), text: x.text || '', merge_with: boardRef(x.merge_with, viewOf(lab).maps, new Set(proposals.map(p => p.id))) }))
              .filter(x => {
                const reason = debatePostDropReason(x, lab, proposals);
                if (reason) dropped.push({ stage: 'debate', by: lab, reason });
                return !reason;
              });
            // 0.8.2 (owner decision 2): with debate_hygiene.noQuoteMarks each objection or merge records whether it quotes the proposal it is about (src/post-quotes.js). Data only: the mark an author sees is a prompt change, held for the owner's list.
            if (config.debate_hygiene?.noQuoteMarks === true) posts = posts.map(x => markPostQuote(x, proposals));
            revisions = (parsed.revisions || []).map(r => ({ ...r, id: viewOf(lab).maps.idFrom[r.id] || r.id })).filter(r => proposals.some(p => p.id === r.id && p.lab === lab));
            const n = st => posts.filter(x => x.stance === st).length;
            say(`  ${lab}: ${posts.length} post(s) - ${n('support')} support, ${n('object')} object, ${n('merge')} merge${revisions.length ? `; revised ${revisions.length} of its own` : ''}${dropped.length ? `; ${describeDropped(dropped)}` : ''}`);

            // v7.x item 3: this lab's seat may have asked for bounded, allowlisted tool calls in
            // the same reply (`tool_requests: [{tool, args}]`). Gated (see the declaration of
            // `toolRequestWarnings` above) on config.tools.seat_requests.enabled +
            // config.verify.tools - a seat can only request a tool already on that allowlist.
            if (toolRequestWarnings) {
              const allowedTools = config.verify.tools.map(t => t.tool);
              const cap = config.tools.seat_requests.cap ?? 3;
              const outcome = runSeatToolRequests(parsed.tool_requests, {
                cap, allowedTools,
                runTool: config.verify?.runTool || defaultRunTool,
                cwd: config.verify?.cwd || process.cwd(),
                seat: lab,
              });
              toolResults = outcome.results;
              toolWarnings = outcome.warnings;
              toolWarnings.forEach(w => say(`  WARNING: ${w}`));
            }
          }
        } catch (err) {
          rethrowControlFlow(err);
          say(`  ${lab}: no debate reply (${String(err.message).slice(0, 100)}).`);
        }
        return { lines, posts, revisions, toolResults, toolWarnings, dropped };
      }));
      const posts = [];
      const droppedItems = [];
      const debateToolResults = [];
      for (const r of postResults) {
        r.lines.forEach(m => log(m));
        posts.push(...r.posts);
        droppedItems.push(...(r.dropped || []));
        for (const rev of r.revisions) { const p = proposals.find(x => x.id === rev.id); if (rev.how) p.how = rev.how; if (rev.acceptance_test) p.acceptance_test = rev.acceptance_test; p.amended = true; }
        // v7.x item 3: appended to the same ground_truth array v7 item 1's config-time tools use,
        // in the same { tool, args, result } shape, plus `result_ref` - re-presented verbatim to
        // later stages the same way config-time ground truth already is (renderGroundTruth reads
        // this same array; nothing new to thread through for that part).
        // 0.8.2 item 5 (F5): the id is given HERE, by the one place that sees every entry, as `<tool>:<position among that tool's entries in the whole array>`: the rule claims.js
        // already reads. runSeatToolRequests numbers per call, so two seats that both asked for check_versions both came back as `check_versions:0`. Entries are added in lab order,
        // so the ids are the same on a resume that replays the stage.
        if (ground_truth) for (const e of r.toolResults) { const entry = { ...e, result_ref: `${e.tool}:${ground_truth.filter(g => g.tool === e.tool).length}` }; ground_truth.push(entry); debateToolResults.push(entry); }
        if (toolRequestWarnings && r.toolWarnings.length) toolRequestWarnings.push(...r.toolWarnings);
      }
      // 0.8.2 item 5 (ChatGPT review 2, F3): the results pushed above reached the ground_truth array and nothing else: `request` was built once, before the debate, so no later prompt (the
      // replies, the build, the critics) ever showed them. They are appended to `request` now, as one block with its own heading, and only when a seat asked for a tool: a chain
      // without seat_requests is byte-identical (the default heading above is unchanged).
      if (debateToolResults.length) request += renderGroundTruth(debateToolResults, R.DEBATE_GROUND_TRUTH_HEADING);

      log(`\nStage: replies (each author answers the posts on its proposals)`);
      const replies = [];
      const replyResults = await settleAll(labs.map(async lab => {
        const lines = []; const say = m => lines.push(m);
        const mineWithPosts = proposals.filter(p => p.lab === lab && posts.some(x => x.on === p.id));
        if (!mineWithPosts.length) { say(`  ${lab}: nothing to answer.`); return { lines, replies: [] }; }
        try {
          const st = await onceMoreIfIncomplete(record(await invoke(seatOf(lab), {
            system: withHeldNote(config, R.replySystem(guard), 'noQuoteGloss'),
            user: replyUserFor(config)({ request, proposals: viewOf(lab).proposals, posts: postsFor(lab), lab, maps: viewOf(lab).maps, guard }),
            log: say, label: `reply-${lab}`,
          })), seatOf(lab), {
            system: withHeldNote(config, R.replySystem(guard), 'noQuoteGloss'),
            user: replyUserFor(config)({ request, proposals: viewOf(lab).proposals, posts: postsFor(lab), lab, maps: viewOf(lab).maps, guard }),
            log: say, label: `reply-${lab}-retry`,
          }, say);
          const parsed = parseJson(st.text);
          if (!parsed) {
            const why = draftIncomplete(st.usage) ? 'provider_error' : 'unreadable';
            say(why === 'provider_error' ? `  ${lab}: the provider ended the reply round with stop "${st.usage.stop}" (after a retry) - proposals stand as posted.` : `  ${lab}: unreadable reply round - proposals stand as posted.`);
            return { lines, replies: [], dropped: [{ stage: 'replies', by: lab, reason: why }] };
          }
          const dropped = [];
          const mine = (parsed.replies || []).map(r => ({ ...r, id: viewOf(lab).maps.idFrom[r.id] || r.id, replaced_by: boardRef(r.replaced_by, viewOf(lab).maps, new Set(proposals.map(p => p.id))), action: String(r.action || '').toLowerCase() }))
            .filter(r => {
              const reason = debateReplyDropReason(r, lab, proposals, mineWithPosts);
              if (reason) dropped.push({ stage: 'replies', by: lab, reason });
              return !reason;
            });
          const n = a => mine.filter(r => r.action === a).length;
          say(`  ${lab}: ${n('keep')} keep, ${n('amend')} amend, ${n('withdraw')} withdraw${dropped.length ? `; ${describeDropped(dropped)}` : ''}`);
          // v5 item 3, touch point 2: decisions already counted just above, no new parsing.
          // "held" (the design's council-seal wedge for "kept a proposal against an objection")
          // is a reply seat's own decision, not a provider outcome - kept distinct from
          // objected/signed, which belong to the critic side of a round (item 3's own
          // Assumptions note).
          progressHook({ kind: 'verdict', label: `reply-${lab}`, lab, decisions: { keep: n('keep'), amend: n('amend'), withdraw: n('withdraw') } });
          return { lines, replies: mine, dropped };
        } catch (err) {
          rethrowControlFlow(err);
          say(`  ${lab}: no reply-round answer (${String(err.message).slice(0, 100)}).`);
          return { lines, replies: [] };
        }
      }));
      for (const r of replyResults) { r.lines.forEach(m => log(m)); replies.push(...r.replies); droppedItems.push(...(r.dropped || [])); }
      if (guard) guardWithdrawals(replies, posts, log, textVariants);
      // Audit fix cnc-debate F3: with shuffle a reply was stored in its author's private lettering ("Lab B", "A-2") while the posts are stored in real ids and lab names, so one token meant different things in report.json and on the board.
      // The guard above has already read the author's own copy; the stored copy (and the fields an amend copies into the proposal) is re-lettered to the real names, like postsReal.
      if (shuffleOn) for (const r of replies) {
        const own = proposals.find(x => x.id === r.id);
        if (own) for (const f of ['text', 'conceded_to', 'how', 'acceptance_test']) if (typeof r[f] === 'string') r[f] = translateRefs(r[f], viewOf(own.lab).maps, null);
      }
      for (const r of replies) {
        const p = proposals.find(x => x.id === r.id);
        if (r.action === 'amend') { if (r.how) p.how = r.how; if (r.acceptance_test) p.acceptance_test = r.acceptance_test; p.amended = true; }
        if (r.action === 'withdraw' && r.unargued) p.withdraw_unargued = true;
        else if (r.action === 'withdraw') { p.withdrawn = true; p.replaced_by = r.replaced_by; }
      }
      board = (guard ? `${R.GUARD_BOARD_NOTE}\n\n` : '') + R.renderBoard(proposals, postsReal(), replies);
      // v6 §4: the field is always present once a debate stage has run, even
      // when no tie ever o     // happened" and as "the feature isn't wired up" identically, which is
      // exactly the silent-drop failure class this project was burned by
      // tonight. Phase 3 delivers the arithmetic and this always-present
      // field; no call site in this stage decides pass/fail by vote yet, so
      // debate runs record the no-op result until a future phase wires one.
      // `dropped` (0.7.8, experimental): always present once the debate ran, [] when nothing was.
      // With debate_hygiene.shuffle the stored post text is re-lettered to real ids and lab names (postsReal): report.json, BOARD.md and every later reader see one lettering, not each poster's own.
      debate = { posts: postsReal(), replies, tie_break: NO_TIE_BREAK, dropped: tallyDropped(droppedItems) };
      const w = proposals.filter(p => p.withdrawn).length;
      log(`  board: ${posts.length} post(s), ${replies.length} repl${replies.length === 1 ? 'y' : 'ies'}, ${w} proposal(s) withdrawn, ${proposals.filter(p => p.amended).length} amended.${droppedItems.length ? ` Dropped: ${describeDropped(droppedItems)}.` : ''}`);

      // v7.x item 4: canary objections (src/canary.js). Gated on config.canary.enabled +
      // config.canary.sampleRate. Runs after the board is already rendered (above), so a canary
      // never appears in the board/deliverable text - only in report.json's debate.posts/replies,
      // each entry carrying `canary: true`. Deliberately does not mutate the target proposal's
      // own amended/withdrawn flags - see src/canary.js's header for why.
      // The roll is one decision per run (pre-release audit 2026-09-23, ProposalsDebateDispute #3):
      // seeded from the run id when the CLI passes one, so every resume sitting draws the same
      // answer, and a canary already paid for in an earlier sitting (its reply on disk in the stage
      // cache) always counts as sampled - so it replays, and its cost stays in totals and --spend.
      const canaryRng = config.canary?.rng || (runId ? () => runIdUnit(runId) : undefined);
      // 0.8.2: with debate_hygiene.shuffle the target is picked by seed. The pick is a pure function of the run id (and the standing proposals), so every sitting of a run picks the same one:
      // no "preferred" target from the stage cache (the item 3 review showed that rule could MOVE the target when a lab had several proposals).
      const canaryTarget = !config.canary?.enabled ? null : shuffleOn
        ? pickCanaryTargetSeeded(proposals, runId ?? '')
        : pickCanaryTarget(proposals);
      const canaryPaid = !!(canaryTarget && cache.get(`canary-reply-${canaryTarget.lab}`));
      if (config.canary?.enabled && (canaryPaid || shouldSampleCanary(config, canaryRng))) {
        const decide = config.canary.decide || (async (target, post) => {
          const lab = target.lab;
          const seat = seatOf(lab);
          if (!seat) return 'keep';
          try {
            const cst = record(await invoke(seat, {
              system: withHeldNote(config, R.replySystem(guard), 'noQuoteGloss'),
              // 4c: the canary is shown through the same marker as every other post that quotes nothing (its text quotes nothing by design); the canary record says whether the mark was on.
              user: canaryReplyPrompt({ request, proposals: viewOf(lab).proposals, post: noQuoteMarksOn(config) ? { ...post, quoted: false } : post, lab, maps: viewOf(lab).maps, guard, render: replyUserFor(config) }),
              log, label: `canary-reply-${lab}`,
            }));
            const parsed = parseJson(cst.text);
            const mine = (parsed?.replies || []).find(r => (viewOf(lab).maps.idFrom[r.id] || r.id) === target.id);
            return mine ? String(mine.action || '').toLowerCase() : 'keep';
          } catch (err) {
            rethrowControlFlow(err);
            return 'keep';
          }
        });
        const result = await injectCanary(proposals, decide, shuffleOn ? { target: canaryTarget } : {});
        if (result) {
          debate.posts.push(result.post);
          debate.replies.push(result.reply);
          canary = { injected: true, on: result.post.on, capitulated: result.capitulated, note: CANARY_NOTE, ...(noQuoteMarksOn(config) ? { no_quote_mark: !!held('replyUserMarked') } : {}) };
          log(`  canary: injected an evidence-free objection against ${result.post.on} - author ${result.capitulated ? 'capitulated' : 'held'}.`);
        }
      }

      // v5 §1 candidate 3: a withdrawal chain that cycles or dead-ends
      // (e.g. two labs mutually withdrawing in each other's favour) leaves
      // a section with no surviving owner - silently, unless the next
      // stage is told. Told here rather than aborting the run: the
      // integration stage can still assign or explicitly drop it.
      const ledger = withdrawalLedger(proposals);
      if (ledger.orphanSections.length) {
        // Bug audit 2026-09-28 (area 4 MED-2): this read as an alarm in the $0 demo, whose plan then
        // handled the withdrawal exactly as asked. It is a note the builder acts on, and says so.
        log(`  note: ${ledger.orphanSections.length} withdrawn proposal(s) with no surviving owner${ledger.withdrawalCycles ? ` (${ledger.withdrawalCycles} withdrawal cycle(s))` : ''}: ${ledger.orphanSections.join(', ')} - the builder is told to reassign each or drop it, with a reason, in the Scope ledger.`);
        board += `\n\n# Orphaned withdrawals - no surviving owner\n\nThese proposal ids withdrew in a chain that never reaches a proposal still standing (a cycle, or a dead end): ${ledger.orphanSections.join(', ')}. For each one, either assign the section it covered to something else in the plan, or state explicitly in the Scope ledger that it is dropped and why - do not silently leave it uncovered.`;
      }
    }
  }

  // 2. First build - unless a draft was handed in. Re-running a panel on the
  //    exact draft an earlier run reviewed is the only fair way to compare
  //    panel topologies; a fresh build is a fresh coin toss.
  let draft = initialDraft;
  let buildDisputes = []; // DECLINED lines of the build stage (FX-15), carried into `disputes` below
  if (draft) {
    log('\nRound 1: build (skipped - reviewing a draft handed in)');
  } else {
    log('\nRound 1: build');
    const built = (await draftStage(config.seats.builder, {
      system: R.builderSystem(open, promptOpts),
      user: R.builderUser({ request, criteria, proposals, board, alternatives: alternativesBoard, skeleton }),
      log, label: 'build',
    })).text;
    // 0.8.1 FX-15: a builder (an external session above all) may end its reply with DECLINED lines too. They are not part of the draft every critic
    // grades; they go to report.json `disputes` with round 'build'. A reply that is nothing but DECLINED lines leaves no draft: stop, never grade an empty page.
    const parsedBuild = parseDisputes(built, { disputedBlock: false });
    if (!parsedBuild.draft.trim()) throw new DraftTruncated('build', 'its reply held nothing but DECLINED lines, so there is no draft to review', 'declined_only');
    draft = parsedBuild.draft;
    buildDisputes = parsedBuild.disputes;
    buildDisputes.forEach(reason => log(`  declined (build): ${reason}`));
  }

  // v4 item 3: wire the diff_applied fact-check for real. v3 built runVerification's
  // expect.contains/fact marker mechanism, but only ever called it before any diff existed, so
  // "diff_applied" could never be anything but absent. Gated on config.verify_post === true;
  // absent, this never runs and behaviour is byte-for-byte v3's. runVerification is reused
  // unmodified (confirmed by reading it above: it takes a config and re-reads the real
  // filesystem through the same allowlisted tools every time it's called - it has no
  // stage-order-dependent cache, so calling it a second time here, after the build stage's
  // external pause has ingested the operator's already-applied-for-real diff (coder-gate's own
  // documented contract: applying a diff to a real working tree is a human/external action that
  // happens before the builder pastes it back), reads the genuinely post-apply file state).
  // Written to its own field/artifact (ground_truth_post / verify-post.json), never mixed into
  // the pre-build `ground_truth` - so an existing chain's pre-build ground_truth/report.json
  // shape is untouched whether or not verify_post is set.
  let ground_truth_post;
  if (config.verify_post === true) {
    log('\nStage: verify (post-build, against the applied file state)');
    ground_truth_post = runVerification(config, { runTool: config.verify?.runTool, log });
  }

  // v7.x: deterministic plan lints (src/lints.js), gated on config.lints.enabled. Runs here -
  // right after the first build, before any critic sees the draft - so a $0 check catches what
  // it can before a paid critic round is spent on the same plan. Absent/false key: `lints` stays
  // undefined, never added to the returned result, v6 report.json shape unchanged.
  let lints;
  if (config.lints?.enabled) {
    log('\nStage: lints ($0 deterministic checks, before any critic sees the draft)');
    lints = runLints({ deliverable: draft, proposals, forks: config.lints.forks || [] });
    if (lints.length) lints.forEach(l => log(`  LINT [${l.id}]: ${l.message}`));
    else log('  clean - no lint failures.');
  }

  // 2c. Tiered councils: the deep-dive seat (config.deep_dive, src/deep-dive.js). One seat, one job,
  //     its own dollar cap inside the run's, every call through invoke(). It runs on the first
  //     draft, before any anchor reviews it; its findings are not votes (under all-roles its lab may also judge on the panel) and go to the reviser in
  //     one pass (label `deep-dive-revise`), fixed or DECLINED like a critic's, and the anchors
  //     then review that draft. Skipped when a draft was handed in (--from-run, a panel comparison
  //     on a fixed draft), like the proposal stages. Absent or not `true`: nothing here runs, no
  //     stage label appears, and the result carries no `deep_dive` key.
  let deepDive;
  if (config.deep_dive?.enabled === true && !initialDraft) {
    log(`\nStage: deep dive (${labOf(config.seats.deep_dive)}/${config.seats.deep_dive.model}, job: ${config.deep_dive.job || 'sources'}, its own cap ${formatUsd(config.deep_dive.usd)})`);
    deepDive = await runDeepDive(config, { request, criteria, draft, invoke, record, parseJson, rethrowControlFlow, log, runSpent: () => budget.spent });
    if (deepDive.findings.length) {
      log(`\nStage: revise (the deep dive's ${deepDive.findings.length} finding(s), before the panel's first review)`);
      const revised = (await draftStage(config.seats.reviser || config.seats.builder, {
        system: R.reviserSystem(open, !!fencedSource, promptOpts),
        user: R.reviserUser({ request, criteria, draft, critique: { failures: deepDiveFailures(deepDive), verdict_line: R.deepDiveVerdictLine({ job: deepDive.job, count: deepDive.findings.length }) }, proposals, board }),
        log, label: 'deep-dive-revise',
      })).text;
      const parsed = parseDisputes(revised);
      draft = parsed.draft;
      deepDive.revise = { declined: parsed.disputes };
      parsed.disputes.forEach(reason => log(`  declined: ${reason}`));
    }
  }

  // 3. Critic / revise rounds, hard-capped.
  const history = [];
  let passed = false;
  let lastCritique = null;
  let signoff = null;
  const disputes = [];
  buildDisputes.forEach(reason => disputes.push({ round: 'build', reason }));
  // Per-round set of failed criterion strings, and the regressions found from them (2026-09-22).
  const failedByRound = [];
  const regressions = [];
  let noHeardReviewer = null; // set when a panel round heard no reviewer at all - see the panel loop
  // Quorum floor (0.7.8, thc-research brief 11; chain flag `quorum: { minHeard: N }`, off unless a
  // chain sets it, and no shipped chain does). A unanimous sign-off counts only when at least N
  // reviewers gave a verdict (signed off or objected). Today a panel of seven where one seat signs
  // off and six only state a pass reads as unanimous; with a floor, that round is recorded as not
  // quorate and the loop stops the way a round with no heard reviewer does: not agreement.
  const minHeard = Number.isInteger(config.quorum?.minHeard) && config.quorum.minHeard > 0 ? config.quorum.minHeard : 0;
  let notQuorate = null;
  // Every verdict opportunity this run had, one row per seat per round, including seats that were
  // never heard (thrown call, cut off, unreadable, no verdict). Bug-audit fix, 2026-09-23
  // (Review/BugAudit_Metrics_2026-09-23.md #3): verdict-stats used to reconstruct this from stage
  // labels and the LAST round's signoff, so a vote lost in an earlier round - or a thrown call, which
  // leaves no stage - was invisible and usableVerdictRate read 1.0 on runs that lost votes.
  // { round, lab, model, verdict: 'signed_off'|'objected'|'passed'|'unheard', reason_code, reasked }
  const panelVerdicts = [];
  const allocatorRounds = [];

  // Dispute stage state (2026-09-20). `dispute` is opt-in, exactly like challenge/coldRead/
  // allocator: a chain that does not set it behaves as it did before this existed, which is
  // why the stall rule is gated on it too rather than silently changing every unanimous run.
  const disputeEnabled = config.dispute?.enabled === true;
  const disputeReviewEnabled = disputeEnabled && config.dispute?.review === true;
  const stallRounds = Number.isInteger(config.dispute?.stall_rounds) ? config.dispute.stall_rounds : 2;
  const objectionSignatures = [];
  const openByRound = [];
  let stalled = null;

  // R1 (the owner's yes, 2026-09-28): a round that ended with every heard reviewer clean and a seat
  // still unheard re-reviews an unchanged draft. The heard seats' verdicts on that exact text are
  // carried into the next round and only the unheard seat(s) are asked again - "this bounds what the
  // run pays to re-review a draft nobody asked to change; it is not an early stop, the debate and the
  // round cap are untouched, and silence is still never consent." Carried only when the text the
  // reviewers are shown is byte-identical; unanimity still needs every seat heard and clean on it.
  let carry = null;

  if (config.signoff === 'unanimous') {
    for (let round = 1; round <= maxRounds; round++) {
      const relay = config.panel === 'relay';
      log(`\nRound ${round}: panel review (${config.seats.critics.length} labs, ${relay ? 'relay - each sees the verdicts before it' : 'independent'})`);
      const verdicts = [];
      // fencedSource rides along on `freedoms` so criticSystem keeps one options argument
      // rather than growing a positional flag at three call sites. It is not a freedom; it is
      // a fact about the task that decides whether the quote rule is honest to state at all.
      const freedoms = { ...(config.freedoms || null), fencedSource: !!fencedSource, ...(checks ? { criteriaKinds: true } : {}) };
      // Bug audit 2026-09-28 (external seats #5): an API seat's re-ask is a fresh sample, but an
      // external seat's was a byte-identical prompt, so the person or session answering it had no
      // hint the last reply could not be read and tended to repeat it. External re-asks only; an API
      // seat's prompt is unchanged.
      const externalReaskNote = (seat, tag) => seat.provider === 'external' && /^-reask\d+$/.test(tag)
        ? `\n\n# Your previous reply could not be read\n\nThe last reply to this review (\`panel-${round}-${labOf(seat)}${tag === '-reask1' ? '' : `-reask${Number(tag.slice(6)) - 1}`}.md\`) was not a readable verdict. Answer with the JSON object the system prompt describes, and nothing else.`
        : '';
      // 0.8.2 wiring (2a): a seat re-asked because its sign-off table was refused is told what the table lacked, whatever its provider. The words are a held sentence (src/held-roles.js:
      // `criticReaskNote({ kind, ids })` in src/roles.js after the re-record, ids are criterion numbers as the judge's list shows them); until then an API seat's re-ask is the same prompt and an
      // external seat gets the note above.
      // Astra's 0.8.2 review (7 Oct 2026, F1): a seat re-asked because its clean sign-off left some of its own earlier objections without an answer is told which ids (held sentence
      // `criticUnansweredNote({ ids, also })`, drafted in test/held-prompts/held-next.js). With a table gap as well, ONE note: the table's words, then the answers' (`also`). API and external seats alike.
      const reaskNote = (seat, tag, gap, answersGap = null) => {
        const isReask = /^-reask\d+$/.test(tag);
        const table = gap && isReask ? held('criticReaskNote')?.({ kind: gap.kind, ids: gap.criterion_ids.map(id => Number(String(id).replace(/^C/, ''))) }) : null;
        const answers = answersGap?.length && isReask ? held('criticUnansweredNote')?.({ ids: answersGap.map(o => o.id), also: !!table }) : null;
        const text = [table, answers].filter(Boolean).join('\n\n');
        return text ? `\n\n${text}` : externalReaskNote(seat, tag);
      };
      // 0.8.2 wiring (3c, 3d): from round 2 a judge that had objections is shown them, the writer's reasons and the changed passages, and told how to answer (`answers`, parsed by applyAnswers below).
      // Held sentence: `answerBackSection` in src/roles.js after the re-record; until then the prompt is untouched. It stays on a re-ask of the same round (the answers are read on the re-ask too).
      // Order: the suffixes (this one, then the re-ask note) follow criticUser's last line. On the `-answered` attempt of a blocking question (freedoms.blocking_questions: in no shipped chain, a user's own
      // setting) that line is "Give your verdict now ..." and the section's reply format follows it; accepted, since the section's own last words ask for the reply the judge must give.
      const answerBackNote = seat => {
        const a = answerBackOn && answerBackRound === round ? answerBackLatest[labOf(seat)] : null;
        const text = a ? held('answerBackSection')?.({ objections: a.objections, declined: a.declined, changed: a.changed_passages }) : null;
        return text ? `\n\n${text}` : '';
      };
      const reviewSeat = async (criticSeat, prior, say, tag = '', tableGap = null, answersGap = null) => {
        let cs, parsed, answeredQuestion = null;
        // `panelMaxTokens` (2026-09-22): an optional per-seat output cap for the panel review only.
        // A seat that needs room to reason (GLM-5.3 Flash cut off at 36k on the Zofia run) can get it
        // here without raising its debate posts, proposals or replies - the text other labs read.
        if (criticSeat.panelMaxTokens) criticSeat = { ...criticSeat, maxTokens: criticSeat.panelMaxTokens };
        let cutOffRetried = false, effectiveCap = criticSeat.maxTokens ?? DEFAULT_MAX_TOKENS;
        // v7 item 4: at most one blocking-question round trip per seat per round - the critic is
        // told it may not ask a second one, and this loop does not offer it the chance to anyway.
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            cs = record(await invoke(criticSeat, {
              system: criticPromptFor(criticSeat, open, freedoms, config),
              // Patch mode shows the full draft plus the edits made since the last review, so a
              // reviewer can see what moved without re-reading the plan. Empty in full-rewrite
              // mode and on round 1, where there is no "since" to speak of.
              user: R.criticUser({ request, criteria, draft: draft + changedSince(lastPatches), prior, answeredQuestion, checks }) + answerBackNote(criticSeat) + reaskNote(criticSeat, tag, tableGap, answersGap),
              log: say, label: attempt === 0 ? `panel-${round}-${labOf(criticSeat)}${tag}` : `panel-${round}-${labOf(criticSeat)}${tag}-answered`,
            }));
          } catch (err) {
            rethrowControlFlow(err);
            // A lab that is down (429 after retries, 5xx, network) must not take
            // the panel down with it. It abstains, and the log says why.
            say(`  ${labOf(criticSeat)}/${criticSeat.model}: no reply (${String(err.message).slice(0, 120)}) - counted as an abstention.`);
            // v5 item 3, touch point 2: a verdict update for the live view, using a value
            // chain.js has already computed at this point - no new parsing. A provider exception
            // is infrastructure failure, not a stated position - the live wedge's `dropped`
            // state, kept separate from `objected` (item 1's report.json rule, item 3's own
            // scope addition kept true in the live view too).
            progressHook({ kind: 'verdict', label: `panel-${round}-${labOf(criticSeat)}${tag}`, lab: labOf(criticSeat), dropped: true });
            return { seat: criticSeat, critique: null, abstained: true, error: String(err.message), reasonCode: 'SEAT_UNREACHABLE' };
          }
          parsed = parseJson(cs.text);
          // Bug audit 2026-09-27 M3: a reply the provider cut off at the cap can still parse (an
          // early complete fence, a lucky brace span), and a parsed cut-off `meets:true` went
          // straight through as a sign-off. So "cut off" is decided from the provider's stop reason
          // whether or not the reply parsed - never the 95%-of-cap guess, which would retry a reply
          // that finished normally near its cap. A pasted external reply carries no stop: no-op.
          // 0.8.1 R review: `from` is the cap the reply was really asked at (an Anthropic seat's invoke() may already have retried at the bigger
          // cap); the retry is skipped when it has no room, instead of repeating the same paid call.
          const fromCap = cs.cappedAt ?? effectiveCap;
          if (!cutOffRetried && (parsed ? providerCutOff(cs.usage) : true) && abstentionReasonCode(cs.usage, askedCapOf(cs, effectiveCap)) === 'REPLY_TRUNCATED'
            && cutOffRetryCap(fromCap, retryCeilingOf(criticSeat)) > fromCap) {
            // A reply cut off at the cap is a lost vote, not a position (pilot 2026-09-17: 14 of
            // 58 lost votes, several already carrying `"meets": false`). Ask once more with a
            // bigger cap; if that fails too, the seat abstains as before and the round rule
            // below refuses to call the panel unanimous without it.
            cutOffRetried = true;
            const firstParsed = parsed, firstCs = cs, firstCap = effectiveCap;
            const biggerCap = cutOffRetryCap(fromCap, retryCeilingOf(criticSeat));
            say(`  ${labOf(criticSeat)}/${criticSeat.model}: reply cut off at ${fromCap} tokens - asking once more with a ${biggerCap}-token cap.`);
            try {
              cs = record(await invoke({ ...criticSeat, maxTokens: biggerCap }, {
                system: criticPromptFor(criticSeat, open, freedoms, config),
                user: R.criticUser({ request, criteria, draft, prior, answeredQuestion, checks }) + answerBackNote(criticSeat) + (tableGap || answersGap ? reaskNote(criticSeat, tag, tableGap, answersGap) : ''),
                log: say, label: `panel-${round}-${labOf(criticSeat)}${tag}-retry`,
              }));
              effectiveCap = biggerCap;
              parsed = parseJson(cs.text);
              // M3: when the cut-off first reply did parse, an unreadable retry must not throw away
              // what it said - back to the first reply (a cut objection still counts; a cut sign-off
              // is turned into an abstention below).
              if (!parsed && firstParsed) { parsed = firstParsed; cs = firstCs; effectiveCap = firstCap; }
            } catch (err) {
              rethrowControlFlow(err);
              say(`  ${labOf(criticSeat)}/${criticSeat.model}: the bigger-cap retry failed (${String(err.message).slice(0, 120)}) - keeping the first attempt's abstention.`);
            }
          }
          if (!parsed) {
            // An unreadable verdict is an abstention: it neither signs off nor
            // objects, and it cannot block the panel. It used to count as a
            // pass, which would have waved a truncated FAILED straight through.
            const why = classifyUnreadable(cs.usage, askedCapOf(cs, effectiveCap));
            const reasonCode = abstentionReasonCode(cs.usage, askedCapOf(cs, effectiveCap));
            // v5 §1 candidate 4: the code is prepended, the diagnosis itself
            // is untouched - classifyUnreadable's three distinct reasons are
            // load-bearing (each one traces to a real incident on disk) and
            // this candidate changes what's printed, never what's diagnosed.
            say(`  ${labOf(criticSeat)}/${criticSeat.model}: [COUNCIL-E004] unreadable reply (${cs.usage.output} tokens out; ${why})${cs.noAnswer ? ` - ${cs.noAnswer}` : ''} - counted as an abstention, not a sign-off.`);
            // Same live-wedge treatment as the provider-exception abstention above: a real
            // reply came back, but not a usable one - item 1's outcome logic already treats
            // this identically to a dropout (`signedOff === null && passed === false`), so the
            // live view stays consistent with what report.json will say at the end.
            progressHook({ kind: 'verdict', label: `panel-${round}-${labOf(criticSeat)}${tag}`, lab: labOf(criticSeat), dropped: true });
            // 0.8.1 milestone R: a seat whose thinking used the whole cap is recorded as such on the board (panelVerdicts[].no_answer), still an abstention.
            return { seat: criticSeat, critique: null, abstained: true, reasonCode, ...(cs.noAnswer ? { noAnswer: cs.noAnswer } : {}) };
          }
          if (freedoms?.blocking_questions && parsed.blocking_question && attempt === 0) {
            say(`  ${labOf(criticSeat)}/${criticSeat.model}: blocking question - ${parsed.blocking_question}`);
            const proposerSeat = config.seats.builder;
            const answer = record(await invoke(proposerSeat, {
              system: R.BLOCKING_ANSWER_SYSTEM,
              user: R.blockingAnswerUser({ request, draft, question: parsed.blocking_question }),
              log: say, label: `panel-${round}-${labOf(criticSeat)}${tag}-question`,
            }));
            say(`  ${labOf(proposerSeat)}/${proposerSeat.model}: answered - ${answer.text}`);
            answeredQuestion = { question: parsed.blocking_question, answer: answer.text };
            continue;
          }
          break;
        }
        if (freedoms?.pass && parsed.pass) {
          say(`  ${labOf(criticSeat)}/${criticSeat.model}: PASSED - ${parsed.pass_reason || '(no reason given)'}`);
          // A stated, recorded refusal to verdict - not a stated position either way, so the
          // live wedge treats it as "waiting" territory rather than objected/signed. Reported
          // as its own kind so the writer doesn't have to special-case `passed` on top of
          // `verdict`.
          progressHook({ kind: 'verdict', label: `panel-${round}-${labOf(criticSeat)}${tag}`, lab: labOf(criticSeat), passStated: true });
          return { seat: criticSeat, critique: null, passed: true, passReason: capField(parsed.pass_reason, { stage: `panel-${round}-${labOf(criticSeat)}${tag}`, field: 'pass_reason' }) || '' };
        }
        let critique = normaliseCritique(parsed, say, { stage: `panel-${round}-${labOf(criticSeat)}${tag}` });
        if (critique.unreadable) {
          // Parsed as JSON but stated no verdict - the same abstention as an unparseable reply.
          const reasonCode = abstentionReasonCode(cs.usage, askedCapOf(cs, effectiveCap));
          say(`  ${labOf(criticSeat)}/${criticSeat.model}: [COUNCIL-E004] reply states no verdict (${critique.unreadableWhy}) - counted as an abstention, not a sign-off.`);
          progressHook({ kind: 'verdict', label: `panel-${round}-${labOf(criticSeat)}${tag}`, lab: labOf(criticSeat), dropped: true });
          return { seat: criticSeat, critique: null, abstained: true, reasonCode };
        }
        if (critique.meets && draftIncomplete(cs.usage)) {
          // M4's panel side: the provider ended the reply with error/content_filter/refusal. Whatever
          // parsed is not a finished verdict, so a sign-off from it is not consent.
          say(`  ${labOf(criticSeat)}/${criticSeat.model}: [COUNCIL-E004] reply signs off but the provider ended it with stop "${cs.usage.stop}" - counted as an abstention, not a sign-off.`);
          progressHook({ kind: 'verdict', label: `panel-${round}-${labOf(criticSeat)}${tag}`, lab: labOf(criticSeat), dropped: true });
          return { seat: criticSeat, critique: null, abstained: true, reasonCode: abstentionReasonCode(cs.usage, askedCapOf(cs, effectiveCap)) };
        }
        if (critique.meets && providerCutOff(cs.usage)) {
          // M3, continued: still cut off (after the one bigger-cap retry, or a reasoning ceiling that
          // gets none). A cut-off sign-off is never consent: the seat is unheard. A cut-off objection
          // is kept - it already said no, and dropping it would lose a vote (pilot 2026-09-17).
          const reasonCode = abstentionReasonCode(cs.usage, askedCapOf(cs, effectiveCap)) === 'REASONING_EXHAUSTED' ? 'REASONING_EXHAUSTED' : 'REPLY_TRUNCATED';
          say(`  ${labOf(criticSeat)}/${criticSeat.model}: [COUNCIL-E004] reply signs off but was cut off at the cap (stop: ${cs.usage.stop}) - counted as an abstention, not a sign-off.`);
          progressHook({ kind: 'verdict', label: `panel-${round}-${labOf(criticSeat)}${tag}`, lab: labOf(criticSeat), dropped: true });
          return { seat: criticSeat, critique: null, abstained: true, reasonCode };
        }
        // 0.8.2 (owner ruling 6 Oct 2026): a judge's `answers` about its own earlier objections. A withdrawal with no quote found in the draft does not count: the objection stays open.
        let pendingAnswers = null; // this ask's own objections left unanswered under a clean sign-off (not the `answersGap` argument, which was the previous ask's, for the note)
        if (answerBackOn && answerBackRound === round && answerBackLatest[labOf(criticSeat)]) {
          const applied = applyAnswers({ lab: labOf(criticSeat), critique, own: answerBackLatest[labOf(criticSeat)].objections, shownDraft: draft, round }); // cnc-prompts F2: the draft alone (in patch mode the "Was:" blocks and the harness's sentences are not the draft)
          // A re-ask of the same round replaces what the seat's earlier reply of the round recorded (the latest ask is the one that counts; a refused table's reply is not counted twice).
          if (tag) for (let k = answerBackReplies.length - 1; k >= 0; k--) if (answerBackReplies[k].round === round && answerBackReplies[k].lab === labOf(criticSeat)) answerBackReplies.splice(k, 1);
          for (const r of applied.records) answerBackReplies.push({ round, lab: labOf(criticSeat), ...r });
          if (applied.carried.length) {
            say(`  ${labOf(criticSeat)}/${criticSeat.model}: ${applied.carried.length} earlier objection(s) stay open (a withdrawal needs a quote from the draft; a sustained answer, or one that says neither sustained nor withdrawn, leaves it open): ${applied.carried.map(c => c.id).join(', ')}`);
            critique = { ...critique, failures: [...critique.failures, ...applied.carried], meets: false };
          }
          // Astra's 0.8.2 review (7 Oct 2026, F1): a CLEAN sign-off that leaves some of the judge's own objections without any answer is not counted yet. The first ask of the round
          // turns into a re-ask (below, with the table check's one re-ask: a cost cap); on the re-ask, or when the round is not re-asked, what is still unanswered is carried as a
          // failure, so the non-pass follows from the objection itself. Off until `criticUnansweredNote` is recorded in src/roles.js (the judge must be told why it is asked again).
          // A verdict that already objects (its own failures, or a carried answer above) carries its unanswered ones at once with no re-ask: it is no pass either way, and an objection it
          // skipped would otherwise be missing from the next round's answer-back and could pass unanswered there (Sonnet review of item 27, 7 Oct 2026, finding 3).
          // A re-ask whose first ask was LOST (unreadable, cut off) is a re-ask too: the round's one re-ask is spent, so what it leaves unanswered is carried without the note (a cost cap).
          if (applied.unanswered.length && held('criticUnansweredNote')) {
            if (critique.meets !== true || /^-reask\d+$/.test(tag)) {
              say(`  ${labOf(criticSeat)}/${criticSeat.model}: no answer for ${applied.unanswered.length} earlier objection(s)${critique.meets === true ? ' after the re-ask' : ''} - they stay open: ${applied.unanswered.map(c => c.id).join(', ')}`);
              critique = { ...critique, failures: [...critique.failures, ...applied.unanswered], meets: false };
            } else pendingAnswers = applied.unanswered;
          }
        }
        // What this seat's verdict becomes if it is not re-asked about its unanswered objections (or the re-ask is lost): an objection carrying them.
        const unansweredFallback = pendingAnswers ? { seat: criticSeat, critique: { ...critique, failures: [...critique.failures, ...pendingAnswers], meets: false } } : null;
        {
          const outside = outsideCriteriaRows(critique, criteria);
          if (outside.length) outsideCriteriaRowList.push({ round, lab: labOf(criticSeat), rows: outside });
        }
        if (tableRequired && critique.meets === true) {
          const gap = signoffTableGap(critique, criteria);
          if (gap) {
            say(`  ${labOf(criticSeat)}/${criticSeat.model}: signs off without a full table (${describeTableGap(gap)}) - counted as an abstention, not a sign-off.`);
            noteMissingRows(critique, round, labOf(criticSeat));
            signoffTableGaps.push({ round, lab: labOf(criticSeat), ...(tag ? { stage: `panel-${round}-${labOf(criticSeat)}${tag}` } : {}), ...gap });
            progressHook({ kind: 'verdict', label: `panel-${round}-${labOf(criticSeat)}${tag}`, lab: labOf(criticSeat), dropped: true });
            return { seat: criticSeat, critique: null, abstained: true, reasonCode: 'INCOMPLETE_TABLE', tableGap: gap, ...(unansweredFallback ? { answersGap: pendingAnswers, unansweredFallback } : {}) };
          }
        }
        if (unansweredFallback) {
          say(`  ${labOf(criticSeat)}/${criticSeat.model}: signs off without answering ${pendingAnswers.length} of its own earlier objection(s) (${pendingAnswers.map(c => c.id).join(', ')}) - not counted as a sign-off yet.`);
          progressHook({ kind: 'verdict', label: `panel-${round}-${labOf(criticSeat)}${tag}`, lab: labOf(criticSeat), dropped: true });
          // Internal only: the round turns every such verdict into a re-ask or into `unansweredFallback` before anything is recorded, so this code never reaches report.json.
          return { seat: criticSeat, critique: null, abstained: true, reasonCode: 'UNANSWERED_OBJECTIONS', answersGap: pendingAnswers, unansweredFallback };
        }
        say(`  ${labOf(criticSeat)}/${criticSeat.model}: ${critique.meets ? 'SIGNED OFF' : `${critique.failures.length} failure(s)`} - ${critique.verdict_line || ''}`);
        noteMissingRows(critique, round, labOf(criticSeat));
        if (checks) noteUnevidenced(critique, round, labOf(criticSeat), say);
        // v5 item 3, touch point 2: the verdict update the live view needs - `passed` (chain.js's
        // own name for "meets every criterion") is already computed here, no new parsing.
        progressHook({ kind: 'verdict', label: `panel-${round}-${labOf(criticSeat)}${tag}`, lab: labOf(criticSeat), passed: critique.meets === true });
        critique.failures.forEach(f => say(`    FAILED: ${f.criterion} - ${f.problem}`));
        return { seat: criticSeat, critique };
      };

      // R1: the heard seats' clean verdicts from the last round, when the draft is unchanged.
      const shownDraft = draft + changedSince(lastPatches);
      const carried = carry && carry.shownDraft === shownDraft ? carry.byLab : null;
      carry = null;
      if (carried) {
        log(`  draft unchanged since round ${round - 1}: carrying over the verdicts of ${[...carried.keys()].join(', ')} on this same text; asking only ${config.seats.critics.filter(c => !carried.has(labOf(c))).map(c => `${labOf(c)}/${c.model}`).join(', ')}.`);
      }
      const carriedVerdict = criticSeat => {
        const v = carried?.get(labOf(criticSeat));
        if (!v) return null;
        progressHook({ kind: 'verdict', label: `panel-${round}-${labOf(criticSeat)}`, lab: labOf(criticSeat), carried: true, ...(v.passed ? { passStated: true } : { passed: true }) });
        return { ...v, carried: true };
      };

      if (relay) {
        // Relay seats run one after another, in a fresh order each round so
        // no lab is always the anchor (seeded, so a resume replays it), and
        // earlier verdicts are handed on anonymised so a seat can't defer to a name.
        for (const criticSeat of seededShuffle(config.seats.critics, `${runId ?? ''}:relay:${round}`)) {
          const kept = carriedVerdict(criticSeat);
          if (kept) { verdicts.push(kept); continue; }
          const prior = verdicts.filter(v => v.critique).map((v, i) => ({ lab: `Reviewer ${String.fromCharCode(65 + i)}`, verdict_line: v.critique.verdict_line, failures: v.critique.failures }));
          verdicts.push(await reviewSeat(criticSeat, prior, log));
        }
      } else {
        // Blind seats see nothing of each other, so they run at the same
        // time. Each seat's log lines are buffered and flushed in seat order,
        // so the run log reads exactly as it did when they ran in sequence.
        const results = await settleAll(config.seats.critics.map(async criticSeat => {
          const kept = carriedVerdict(criticSeat);
          if (kept) return { verdict: kept, lines: [] };
          const lines = [];
          const verdict = await reviewSeat(criticSeat, [], m => lines.push(m));
          return { verdict, lines };
        }));
        for (const { verdict, lines } of results) {
          lines.forEach(m => log(m));
          verdicts.push(verdict);
        }
      }

      // Re-ask only the seats that were not heard, and only when it matters: every heard reviewer
      // is clean (signed off or stated a pass), so the unheard seat alone decides the round. The
      // rest of the panel already answered this exact draft, so asking them again would only
      // spend money. Two extra attempts per round at most; a seat still unheard after that leaves
      // the round non-unanimous (below). If a heard reviewer objected there is nothing to
      // decide here - the reviser runs on the union of objections and the next round re-asks all.
      const unheardFirst = verdicts.map(v => !!v.abstained);
      const heardClean = () => verdicts.every(v => v.abstained || v.passed || v.critique?.meets === true);
      for (let reask = 1; reask <= 2 && heardClean() && verdicts.some(v => v.abstained); reask++) {
        for (let i = 0; i < verdicts.length; i++) {
          if (!verdicts[i].abstained) continue;
          // 0.8.2 (owner decision 1: "one re-ask, then abstention"): a seat refused for an incomplete table is re-asked once; an unreadable or lost reply keeps its two.
          // F1 (Astra, 7 Oct 2026): a seat re-asked about unanswered objections shares that one re-ask (a cost cap), even when the re-ask itself came back unreadable.
          if (reask > 1 && (verdicts[i].reasonCode === 'INCOMPLETE_TABLE' || verdicts[i].unansweredFallback)) continue;
          const seatToAsk = verdicts[i].seat;
          log(`  re-asking only ${labOf(seatToAsk)}/${seatToAsk.model} (${reask}/2) - it was not heard; the rest of the panel already answered this draft.`);
          const prior = relay ? verdicts.filter(v => v.critique).map((v, k) => ({ lab: `Reviewer ${String.fromCharCode(65 + k)}`, verdict_line: v.critique.verdict_line, failures: v.critique.failures })) : [];
          const before = verdicts[i];
          verdicts[i] = await reviewSeat(seatToAsk, prior, log, `-reask${reask}`, before.tableGap || null, before.answersGap || null);
          // A LOST re-ask (no verdict read at all) must not lose the objections it was asked about: the earlier fallback stays. A re-ask refused only for its table did read the
          // judge's answers (an answered objection is closed, a still unanswered one was carried), so the old fallback must not come back (Sonnet review of item 27, finding 1).
          if (verdicts[i].abstained && verdicts[i].reasonCode !== 'INCOMPLETE_TABLE' && !verdicts[i].unansweredFallback && before.unansweredFallback) verdicts[i] = { ...verdicts[i], answersGap: before.answersGap, unansweredFallback: before.unansweredFallback };
        }
      }
      // F1: a seat still waiting on its unanswered objections (not re-asked because another judge objected, or its re-ask was lost) is recorded as objecting with them, never as unheard.
      for (let i = 0; i < verdicts.length; i++) {
        if (!verdicts[i].abstained || !verdicts[i].unansweredFallback) continue;
        const v = verdicts[i];
        log(`  ${labOf(v.seat)}/${v.seat.model}: ${v.answersGap.length} earlier objection(s) still without an answer - they stay open: ${v.answersGap.map(c => c.id).join(', ')}`);
        verdicts[i] = v.unansweredFallback;
        progressHook({ kind: 'verdict', label: `panel-${round}-${labOf(v.seat)}`, lab: labOf(v.seat), passed: false }); // the live view showed it dropped; it is an objection now
      }

      // Each objection carries the lab that raised it, so the human review
      // step sees who said what rather than an anonymous merged list.
      const voting = verdicts.filter(v => v.critique);
      // `abstained` keeps its old meaning (everyone without a critique, including a stated pass).
      // `unheard` is the narrower set that matters for unanimity: seats whose reply was lost - cut
      // off, malformed, or the provider was down. A stated pass is a position; a lost reply is not.
      const abstained = verdicts.length - voting.length;
      const unheard = verdicts.filter(v => v.abstained).length;
      // Quote validation (2026-09-20, src/quote-check.js). Only runs when the task actually
      // carries fenced source - without it there is nothing to check a quote against, and
      // marking every claim "unquoted" would be noise that teaches seats to ignore the mark.
      // Nothing is ever dropped: an unquoted objection may still be right, and silently
      // discarding an objection is how a real defect disappears.
      const allFailures = voting.flatMap(v =>
        markFailures(v.critique.failures, fencedSource).map(f => ({ ...f, lab: labOf(v.seat), id: objectionId(labOf(v.seat), f) })));
      if (fencedSource) {
        for (const w of quoteWarnings(allFailures.filter(f => f.quote_status), 'panel')) {
          log(`    QUOTE: ${w}`);
          quoteFindings.push(w);
        }
      }
      // 2026-09-22 (council-method analysis): an objection that was raised, fixed, and then comes
      // back reads like ordinary progress in the log, so nobody notices the plan lost ground. Track
      // which criteria failed in each round and name a criterion that failed, passed, then failed
      // again. Recorded, never acted on: a regression is information for the human, not a veto.
      // Bug-audit fix, 2026-09-23 (Review/BugAudit_RunChainStages_2026-09-23.md #4): "passed in
      // the previous round" was inferred from the criterion's absence there - which is also what
      // happens when its only objector was simply not heard, so an unchanged draft got a false
      // REGRESSION. Now per (lab, criterion): the same lab failed it before, was HEARD in the
      // previous round without failing it, and fails it again.
      const failedNow = new Set(allFailures.filter(f => f.criterion).map(f => `${f.lab}\u0000${f.criterion}`));
      const heardNow = new Set(voting.map(v => labOf(v.seat)));
      const prevRound = failedByRound[failedByRound.length - 1];
      const regressedPairs = failedByRound.length >= 2 ? [...failedNow].filter(key =>
        prevRound.heard.has(key.split('\u0000')[0])
        && !prevRound.failed.has(key)
        && failedByRound.slice(0, -1).some(prev => prev.failed.has(key))) : [];
      for (const c of [...new Set(regressedPairs.map(k => k.split('\u0000')[1]))]) {
        const labs = regressedPairs.filter(k => k.split('\u0000')[1] === c).map(k => k.split('\u0000')[0]);
        log(`    REGRESSION: "${c}" failed in an earlier round, passed, and fails again (${labs.join(', ')}).`);
        regressions.push({ round, criterion: c, labs });
      }
      failedByRound.push({ failed: failedNow, heard: heardNow });
      const allVotersClean = voting.length > 0 && voting.every(v => v.critique.meets === true);
      // An unheard reviewer is an unknown, not consent. Found in the 2026-09-17 pilot: when every
      // reviewer that WAS heard signed off, the old check declared "every lab that answered signed
      // off" and passed, with a truncated or malformed dissent silently outside the vote. The
      // relay engine already carries this rule (run 2026-09-13T20-20-07-757Z); ported here.
      // With no quorum set (minHeard 0) every round is quorate and this is exactly the old rule.
      const quorate = voting.length >= minHeard;
      const allSignedOff = allVotersClean && unheard === 0 && quorate;
      lastCritique = { meets: allSignedOff, failures: allFailures };
      // `objections` is why a seat declined, co-located with the decision itself.
      // The same failures also appear flattened in lastCritique.failures, tagged
      // with `lab`, because the reviser and the CLI want the union across the
      // panel. Both are built here from the same `voting` array in one pass, so
      // they cannot drift. Added 2026-09-11: a four-lab panel reading a run
      // folder concluded a holdout's reason was not machine-readable, because
      // signoff carried the verdict and nothing else - the join through
      // lastCritique.failures[].lab existed but was undiscoverable.
      // `lab` (0.7.7, brief 03 fix 2) is the same value as `provider`, which has always held the
      // lab despite its name. `provider` stays for compatibility and is marked deprecated in
      // schemas/report-v1.json; it can go only with a schemaVersion 2.
      signoff = verdicts.map(v => ({
        provider: labOf(v.seat), lab: labOf(v.seat), model: v.seat.model,
        // 0.7.9, additive: the seat's index in config.seats.critics. A relay panel lists signoff[]
        // in its seeded review order, so array position is not the seat (verdict-diff reads this).
        seat_index: config.seats.critics.findIndex(c => labOf(c) === labOf(v.seat)),
        signedOff: v.abstained || v.passed ? null : v.critique.meets === true,
        objections: v.abstained || v.passed ? null : v.critique.failures.map(f => ({ ...f, id: objectionId(labOf(v.seat), f) })),
        // v7 item 4: a pass is a stated, recorded refusal to verdict - distinct from an
        // abstention (no usable reply at all), which is why it carries its own reason field
        // instead of overloading `objections`.
        passed: v.passed === true,
        passReason: v.passed ? v.passReason : null,
        // v8 item (a): additive field, report.json contract. null for a real sign-off/objection
        // or a stated pass; one of RESERVED_ABSTENTION_REASONS (src/chain.js) when v.abstained.
        reason_code: v.abstained ? (v.reasonCode || null) : null,
      }));

      verdicts.forEach((v, i) => panelVerdicts.push({
        round, lab: labOf(v.seat), model: v.seat.model,
        ...(v.seat.lane ? { lane: v.seat.lane } : {}),
        verdict: v.abstained ? 'unheard' : v.passed ? 'passed' : v.critique.meets === true ? 'signed_off' : 'objected',
        reason_code: v.abstained ? (v.reasonCode || null) : null,
        ...(v.abstained && v.tableGap ? { table_gap: v.tableGap } : {}),
        ...(v.abstained && v.noAnswer ? { no_answer: v.noAnswer } : {}),
        reasked: unheardFirst[i],
        // R1: additive. True when this seat was not asked this round: its verdict from the round
        // before, on the same unchanged draft, was carried over.
        ...(v.carried ? { carried: true } : {}),
      }));

      history.push(`## Round ${round} panel\n${verdicts.map(v =>
        `- ${labOf(v.seat)}/${v.seat.model}: ${v.abstained ? (v.reasonCode === 'INCOMPLETE_TABLE' ? 'abstained (sign-off without a full per-criterion table)' : 'abstained (unreadable reply)') : v.passed ? `passed - ${v.passReason || '(no reason given)'}` : v.critique.meets ? 'signed off' : `${v.critique.failures.length} failure(s)`}`
      ).join('\n')}`);

      if (allSignedOff) {
        passed = true;
        log(abstained
          ? `  every lab that answered signed off (${abstained} passed); stopping.`
          : `  every lab on the panel signed off; stopping.`);
        break;
      }

      // Bug-audit fix, 2026-09-23 (Review/BugAudit_RunChainStages_2026-09-23.md #3): a round in which
      // no reviewer was heard - every seat unreachable, unreadable, or only stating a pass - fell
      // through to the reviser with an empty objection list ("(none listed)"): each round paused
      // for, or paid for, a full rewrite with nothing to fix, up to the round cap. The stall rule
      // could not catch it (an empty signature). An OpenRouter outage takes out every critic in the
      // shipped seven-lab chains at once, so this is the outage path. Stop instead, and say why.
      if (allVotersClean && unheard === 0 && !quorate) {
        notQuorate = { round, heard: voting.length, minHeard, passedOnly: verdicts.length - voting.length };
        log(`\n  round ${round}: every reviewer that gave a verdict signed off, but only ${voting.length} did (${verdicts.length - voting.length} stated a pass), below this chain's quorum of ${minHeard}. Not quorate: stopping the loop; this is not agreement.`);
        passed = false;
        break;
      }

      if (voting.length === 0) {
        noHeardReviewer = { round, unheard, passedOnly: verdicts.length - unheard };
        log(`\n  round ${round}: no reviewer was heard (${unheard} unreadable or unreachable, ${verdicts.length - unheard} stated a pass) - there is nothing to revise against. Stopping the loop; this is not agreement.`);
        passed = false;
        break;
      }

      // Dispute stop rule (2026-09-20). The round cap moved 3 -> 7 so a real disagreement has
      // room to resolve, which only helps if a disagreement that ISN'T resolving stops early.
      // Otherwise raising the cap just buys four more rounds of the same objection, at the
      // reviser's price each time - the most expensive seat in the run, re-reading everything.
      //
      // "The same objection" is deliberately (criterion, lab), not the objection's prose: a
      // seat rewording the same complaint each round is the exact pattern this catches, and
      // matching on text would miss it. Sorted, so seat ordering never makes a stable
      // disagreement look like a changing one.
      // 0.8.2 (ticket 12): finer than (lab, criterion), so two different defects under one criterion no longer read as one stuck disagreement; see src/objection-ids.js.
      const roundSignature = stallSignature(allFailures);
      objectionSignatures.push(roundSignature);
      openByRound.push({ round, failures: allFailures });
      if (disputeEnabled && roundSignature && objectionSignatures.length >= stallRounds) {
        const recent = objectionSignatures.slice(-stallRounds);
        if (recent.every(s => s === recent[0])) {
          stalled = { rounds: stallRounds, round };
          log(`\n  the same ${allFailures.length} objection(s) from the same lab(s) for ${stallRounds} rounds running - this is not converging. Stopping the revise loop; the disagreement goes to the dispute stage rather than costing another ${maxRounds - round} round(s) of the same argument.`);
          break;
        }
      }

      if (round === maxRounds) {
        log(allVotersClean
          ? `  round cap (${maxRounds}) reached: every lab that answered signed off clean, but ${unheard} never returned a readable verdict - this is NOT agreement. Read their raw reply (see report.json signoff[]) before treating this as passed.`
          : `  round cap (${maxRounds}) reached without unanimous signoff; open objections go into the report.`);
        break;
      }

      if (allVotersClean && unheard > 0) {
        // Nothing to revise - no heard reviewer objected - so re-ask the same panel on the same
        // draft rather than treating silence as consent or revising what nobody objected to.
        log(`\nRound ${round}: every lab that answered signed off clean, but ${unheard} did not return a readable verdict - asking again on the unchanged draft rather than declaring agreement.`);
        passed = false;
        // R1: the heard seats' clean verdicts carry into the next round, on this exact text only.
        carry = { shownDraft, byLab: new Map(verdicts.filter(v => !v.abstained).map(v => [labOf(v.seat), v])) };
        // Roadmap item 30 (found building item 27, 7 Oct 2026; Muad's yes via C&C): the answer-back data was set only at a revise, so an unheard judge asked again in the next round was
        // no longer shown its open objections nor had its answers read, and a plain clean sign-off passed the run. The draft is unchanged and nothing was revised, so the same data
        // still holds: it moves on to the next round, for the seats that will be asked again (report.json's answerBack says what each round showed, and to whom).
        // Only what is still open moves on: an objection the judge withdrew with a quote in a reply that was then not counted (refused for its table) is settled (final review, finding 3).
        if (answerBackOn && answerBackRound === round) {
          const asked = {};
          for (const [lab, entry] of Object.entries(answerBackLatest)) {
            if (carry.byLab.has(lab)) continue; // heard and clean on this same text: not asked again
            const objections = stillOpen(entry, answerBackReplies, { round, lab });
            if (objections.length) asked[lab] = { ...entry, objections }; else delete answerBackLatest[lab];
          }
          Object.assign(answerBackLatest, asked);
          answerBackRound = round + 1;
          answerBackRecords.push(...answerBackSummary(round + 1, asked));
        }
        continue;
      }

      log(`\nRound ${round}: revise (union of everything any lab flagged)`);
      const reviserSeat = config.seats.reviser || config.seats.builder;
      const patchMode = config.revise?.mode === 'patch';
      // 0.8.2 wiring (P13, owner 7 Oct 2026): with answer_back.enabled the reviser is told each failure's objection id and the DECLINED form that carries it (ONE form: the held systems replace the sentence that gives it,
      // they do not add a second), so the judge that raised the objection is shown the reason next to it. Held (src/held-roles.js): `reviserSystemWithIds` / `patchReviserSystemWithIds` and `reviserIdsNote({ failures })`;
      // until the re-record each falls back to what has always been sent.
      const reviserSystemFor = patch => (answerBackOn ? held(patch ? 'patchReviserSystemWithIds' : 'reviserSystemWithIds') : undefined) ?? (patch ? R.patchReviserSystem : R.reviserSystem);
      const idsNote = answerBackOn ? (held('reviserIdsNote')?.({ failures: allFailures }) ?? '') : '';
      const revised = (await draftStage(reviserSeat, {
        system: reviserSystemFor(patchMode)(open, !!fencedSource, promptOpts),
        user: R.reviserUser({ request, criteria, draft, critique: { failures: allFailures }, proposals, board }) + (idsNote ? `\n\n${idsNote}` : ''),
        log, label: `revise-${round}`,
      })).text;
      const parsedRevise = parseDisputes(revised, { withIds: answerBackOn });

      // Patch mode: apply the edits locally so untouched text is byte-identical by
      // construction. Any block that does not apply cleanly falls back to one full rewrite -
      // the fallback is the feature, since whether real models produce verbatim anchors is
      // UNVERIFIED and cannot be tested offline.
      if (patchMode) {
        const patches = parsePatches(parsedRevise.draft);
        const applied = applyPatches(draft, patches);
        if (applied.ok) {
          log(`  patch mode: applied ${applied.applied} edit(s); the rest of the draft is unchanged, byte for byte.`);
          parsedRevise.draft = applied.text;
          lastPatches = patches;
        } else {
          log(`  patch mode: ${applied.reason} - falling back to one full rewrite for this round.`);
          patchFallbacks.push({ round, reason: applied.reason });
          const full = (await draftStage(reviserSeat, {
            system: reviserSystemFor(false)(open, !!fencedSource, promptOpts),
            user: R.reviserUser({ request, criteria, draft, critique: { failures: allFailures }, proposals, board }) + (idsNote ? `\n\n${idsNote}` : ''),
            log, label: `revise-${round}-full`,
          })).text;
          const reparsed = parseDisputes(full, { withIds: answerBackOn });
          parsedRevise.draft = reparsed.draft;
          reparsed.disputes.forEach((r, k) => { parsedRevise.disputes.push(r); parsedRevise.disputeIds.push(reparsed.disputeIds[k]); });
          lastPatches = null;
        }
      }
      if (answerBackOn) {
        // Final review of items 27/28/30 (7 Oct 2026), finding 1: a judge UNHEARD this round keeps its still-open objections (those it was shown this round, minus any it withdrew with a
        // quote in a reply that was not counted). They go to the judge again next round, not into the reviser's list above: nothing re-raised them this round, and the judge answers first.
        const keptOpen = answerBackRound === round
          ? verdicts.filter(v => v.abstained).flatMap(v => stillOpen(answerBackLatest[labOf(v.seat)], answerBackReplies, { round, lab: labOf(v.seat) }).map(o => ({ ...o, lab: labOf(v.seat) })))
          : [];
        answerBackLatest = buildAnswerBack({ failures: [...allFailures, ...keptOpen], declined: parsedRevise.disputes, declinedIds: parsedRevise.disputeIds, oldDraft: draft, newDraft: parsedRevise.draft });
        answerBackRecords.push(...answerBackSummary(round + 1, answerBackLatest)); // shown to the judge in the NEXT round
        answerBackRound = round + 1;
      }
      draft = parsedRevise.draft;
      parsedRevise.disputes.forEach((reason, k) => disputes.push({ round, reason, ...(parsedRevise.disputeIds[k] ? { objection_id: parsedRevise.disputeIds[k] } : {}) }));
      passed = false;

      // v7.3: resource allocator - one extra, targeted round on top of the
      // uniform revise above, spent only where the panel actually disagreed
      // this round. Gated on config.allocator.enabled (chain-lint.js fails
      // any config that sets it without signoff: 'unanimous', since the
      // disagreement signal below doesn't exist under round-robin signoff).
      if (config.allocator?.enabled) {
        const contested = pickContestedCriterion(voting);
        if (contested) {
          log(`\nRound ${round} allocator: targeting the panel's most contested criterion (${contested.failedBy.length}/${contested.votingCount} critics FAILED it) for one extra round.`);
          // v7.3 item 3: fire item 1's tool-grounded verification dynamically,
          // scoped to this specific contested claim, rather than only the
          // config-declared-up-front verify.tools set every run always runs
          // regardless of relevance. A tool fires only if one of
          // allocator.tools names a keyword that appears in the contested
          // criterion's own text.
          let toolFired = null;
          let groundTruthBlock = '';
          const spec = (config.allocator.tools || []).find(t =>
            (t.keywords || []).some(k => contested.criterion.toLowerCase().includes(String(k).toLowerCase())));
          if (spec) {
            const runTool = config.verify?.runTool || defaultRunTool;
            const cwd = config.allocator.cwd || config.verify?.cwd || process.cwd();
            const result = runTool(spec.tool, spec.args || {}, { cwd });
            log(`  allocator verification: ${spec.tool}${spec.args ? ` ${JSON.stringify(spec.args)}` : ''} -> ${result.ok ? 'ok' : `error - ${result.error}`}`);
            toolFired = { tool: spec.tool, args: spec.args || {}, result };
            groundTruthBlock = `\n\n# Ground truth for the contested claim (tool output, verbatim)\n## ${spec.tool}${spec.args ? ` ${JSON.stringify(spec.args)}` : ''}\n${JSON.stringify(result)}`;
          }
          const draftBefore = draft;
          const targeted = (await draftStage(reviserSeat, {
            system: R.reviserSystem(open, !!fencedSource, promptOpts),
            user: R.reviserUser({
              request, criteria, draft,
              critique: { failures: [{
                criterion: contested.criterion,
                problem: `The panel split on this criterion this round: ${contested.failedBy.length} of ${contested.votingCount} voting critics marked it FAILED, the rest did not.`,
                fix: '',
              }] },
            }) + groundTruthBlock,
            log, label: `allocator-${round}`,
          })).text;
          const parsedTargeted = parseDisputes(targeted);
          draft = parsedTargeted.draft;
          parsedTargeted.disputes.forEach(reason => disputes.push({ round: `allocator-${round}`, reason }));
          // v7.3 item 4: the falsification watch this stage's own proposal
          // flagged as required, not optional. A targeted round that leaves
          // the draft byte-for-byte unchanged is the same rubber-stamping
          // signature item 3's descending-rounds falsifier watches for -
          // recorded here, never hidden, and exposed across runs in
          // metrics.js's allocator rubber-stamp rate.
          const engaged = draft !== draftBefore;
          log(`  allocator round ${engaged ? 'changed the draft (engaged)' : 'left the draft byte-for-byte unchanged (rubber-stamp signature)'}.`);
          allocatorRounds.push({
            round,
            criterion: contested.criterion,
            failedBy: contested.failedBy,
            votingCount: contested.votingCount,
            tool: toolFired ? toolFired.tool : null,
            engaged,
          });
        }
      }
    }
  } else {
    for (let round = 1; round <= maxRounds; round++) {
      const criticSeat = config.seats.critics[(round - 1) % config.seats.critics.length];
      log(`\nRound ${round}: critique`);
      let cs;
      try {
        cs = record(await invoke(criticSeat, {
          system: criticPromptFor(criticSeat, open, checks ? { criteriaKinds: true } : undefined, config),
          user: R.criticUser({ request, criteria, draft, checks }),
          log, label: `critique-${round}`,
        }));
      } catch (err) {
        // v7 item 2: a provider failure here used to propagate straight out of runChain and
        // crash the whole run (a real paid run was lost to exactly this). Gated on
        // degrade_on_provider_error so a chain that doesn't opt in reproduces today's crash
        // exactly.
        rethrowControlFlow(err);
        if (!config.degrade_on_provider_error) throw err;
        // Bug audit 2026-09-28 (area 3 #2.6): this said [COUNCIL-E005], the catalog's "Policy refusal".
        log(`  ${criticSeat.provider}/${criticSeat.model}: provider failure (${String(err.message).slice(0, 120)}) - seat dropped, not counted as a pass or an objection.`);
        dropouts.push({ lab: labOf(criticSeat), model: criticSeat.model, stage: `critique-${round}`, reason: `provider failure: ${String(err.message).slice(0, 200)}` });
        panelVerdicts.push({ round, lab: labOf(criticSeat), model: criticSeat.model, ...(criticSeat.lane ? { lane: criticSeat.lane } : {}), verdict: 'unheard', reason_code: 'SEAT_UNREACHABLE', reasked: false });
        lastCritique = { meets: false, dropped: true, failures: [{
          criterion: '(critic seat dropped)',
          problem: `${criticSeat.provider}/${criticSeat.model}'s round ${round} call failed (provider error) and was degraded to a dropped seat rather than crashing the run.`,
        }] };
        break;
      }

      let parsed = parseJson(cs.text);
      // Verify pass 2026-09-28 F2: M3/M4 held only on the unanimous panel, so in `first` mode a
      // cut-off or provider-ended `meets:true` still passed the run. The same rules here: one
      // bigger-cap retry for a reply cut off at its cap (parsed or not), falling back to a parsed
      // first reply; then a sign-off still cut off, or ended with error/content_filter/refusal, is
      // no verdict (below). A pasted external reply carries no stop: no-op.
      let critCap = criticSeat.maxTokens ?? DEFAULT_MAX_TOKENS;
      // 0.8.1 R review: start from the cap the reply was really asked at (an Anthropic seat's invoke() may already have retried at the bigger
      // cap) and skip the retry when it has no room: it would repeat the same paid call.
      const fromCap = cs.cappedAt ?? critCap;
      if ((parsed ? providerCutOff(cs.usage) : true) && abstentionReasonCode(cs.usage, askedCapOf(cs, critCap)) === 'REPLY_TRUNCATED'
        && cutOffRetryCap(fromCap, retryCeilingOf(criticSeat)) > fromCap) {
        const firstParsed = parsed, firstCs = cs, firstCap = critCap;
        const biggerCap = cutOffRetryCap(fromCap, retryCeilingOf(criticSeat));
        log(`  critic reply cut off at ${fromCap} tokens - asking once more with a ${biggerCap}-token cap.`);
        try {
          cs = record(await invoke({ ...criticSeat, maxTokens: biggerCap }, {
            system: criticPromptFor(criticSeat, open, checks ? { criteriaKinds: true } : undefined, config),
            user: R.criticUser({ request, criteria, draft, checks }),
            log, label: `critique-${round}-retry`,
          }));
          critCap = biggerCap;
          parsed = parseJson(cs.text);
          if (!parsed && firstParsed) { parsed = firstParsed; cs = firstCs; critCap = firstCap; }
        } catch (err) {
          rethrowControlFlow(err);
          log(`  the bigger-cap retry failed (${String(err.message).slice(0, 120)}) - keeping the first reply.`);
        }
      }
      if (!parsed) {
        // Previously logged "treating the round as a pass and stopping" while leaving `passed`
        // at its prior value and `lastCritique` untouched - the log claimed a pass that never
        // happened, and the report came out as passed:false with no recorded reason at all
        // (found for real 2026-09-10: three separate Sophi-A runs stopped exactly here, silent).
        // Deliberately NOT treated as a real pass - a critic's reply we can't parse might be
        // hiding a genuine objection, and this chain's whole value is not letting that slip
        // through. `passed` keeps whatever it already was (false unless an earlier round already
        // passed); what changes is that the report now says why, instead of nothing.
        panelVerdicts.push({ round, lab: labOf(criticSeat), model: criticSeat.model, ...(criticSeat.lane ? { lane: criticSeat.lane } : {}), verdict: 'unheard', reason_code: abstentionReasonCode(cs.usage, askedCapOf(cs, critCap)), ...(cs.noAnswer ? { no_answer: cs.noAnswer } : {}), reasked: false });
        log(`  critic reply could not be parsed as JSON even after repair attempts; stopping ` +
          `without a verdict from this critic - not a pass, not counted as an objection either.`);
        lastCritique = { meets: false, failures: [{
          criterion: '(critic reply unparseable)',
          problem: `${criticSeat.provider}/${criticSeat.model}'s round ${round} reply could not ` +
            `be parsed as JSON even after repair attempts - no verdict was recovered from it.`,
        }] };
        break;
      }
      const critique = normaliseCritique(parsed, log, { stage: `critique-${round}` });
      if (critique.unreadable) {
        // Parsed, but no verdict in it - handled exactly like the unparseable reply above: not a
        // pass, not an objection, and the run stops saying why (bug audit 2026-09-23).
        panelVerdicts.push({ round, lab: labOf(criticSeat), model: criticSeat.model, ...(criticSeat.lane ? { lane: criticSeat.lane } : {}), verdict: 'unheard', reason_code: abstentionReasonCode(cs.usage, askedCapOf(cs, criticSeat.maxTokens)), ...(cs.noAnswer ? { no_answer: cs.noAnswer } : {}), reasked: false });
        log(`  critic reply states no verdict (${critique.unreadableWhy}); stopping without a verdict from this critic - not a pass, not counted as an objection either.`);
        lastCritique = { meets: false, failures: [{
          criterion: '(critic reply stated no verdict)',
          problem: `${criticSeat.provider}/${criticSeat.model}'s round ${round} reply parsed but stated no verdict: ${critique.unreadableWhy}.`,
        }] };
        break;
      }
      if (critique.meets && (draftIncomplete(cs.usage) || providerCutOff(cs.usage))) {
        // F2, continued: a sign-off the provider ended early is not a pass. Handled like the
        // unreadable reply above: no verdict from this critic, and the run stops saying why.
        const stopped = draftIncomplete(cs.usage);
        const reasonCode = stopped ? abstentionReasonCode(cs.usage, askedCapOf(cs, critCap))
          : (abstentionReasonCode(cs.usage, askedCapOf(cs, critCap)) === 'REASONING_EXHAUSTED' ? 'REASONING_EXHAUSTED' : 'REPLY_TRUNCATED');
        panelVerdicts.push({ round, lab: labOf(criticSeat), model: criticSeat.model, ...(criticSeat.lane ? { lane: criticSeat.lane } : {}), verdict: 'unheard', reason_code: reasonCode, ...(cs.noAnswer ? { no_answer: cs.noAnswer } : {}), reasked: false });
        log(`  [COUNCIL-E004] critic reply signs off but ${stopped ? `the provider ended it with stop "${cs.usage.stop}"` : `was cut off at the cap (stop: ${cs.usage.stop})`}; stopping without a verdict from this critic - not a pass.`);
        lastCritique = { meets: false, failures: [{
          criterion: '(critic sign-off incomplete)',
          problem: `${criticSeat.provider}/${criticSeat.model}'s round ${round} reply signed off, but ${stopped ? `the provider ended it with stop "${cs.usage.stop}"` : 'it was cut off at its token cap'}, so it is not a pass.`,
        }] };
        break;
      }
      lastCritique = critique;
      noteMissingRows(critique, round, labOf(criticSeat));
      if (checks) noteUnevidenced(critique, round, labOf(criticSeat), log);
      panelVerdicts.push({ round, lab: labOf(criticSeat), model: criticSeat.model, ...(criticSeat.lane ? { lane: criticSeat.lane } : {}), verdict: critique.meets === true ? 'signed_off' : 'objected', reason_code: null, reasked: false });
      const failures = critique.failures;
      log(`  verdict: ${critique.meets ? 'MEETS' : `${failures.length} failure(s)`} - ${critique.verdict_line || ''}`);
      failures.forEach(f => log(`    FAILED: ${f.criterion} - ${f.problem}`));

      history.push(`## Round ${round} critique (${criticSeat.provider}/${criticSeat.model})\n${critique.verdict_line || ''}\n${failures.map(f => `- FAILED: ${f.criterion} - ${f.problem}`).join('\n')}`);

      if (critique.meets === true) {
        passed = true;
        if (stopOnPass) {
          log(`  a critic from a different lab passed it; stopping early rather than inventing work.`);
          break;
        }
      }

      if (round === maxRounds) {
        log(`  round cap (${maxRounds}) reached; the remaining failures go into the report, not another round.`);
        break;
      }

      log(`\nRound ${round}: revise`);
      const reviserSeat = config.seats.reviser || config.seats.builder;
      const revised = (await draftStage(reviserSeat, {
        system: R.reviserSystem(open, !!fencedSource, promptOpts),
        user: R.reviserUser({ request, criteria, draft, critique }),
        log, label: `revise-${round}`,
      })).text;
      const parsedRevise = parseDisputes(revised);
      draft = parsedRevise.draft;
      parsedRevise.disputes.forEach(reason => disputes.push({ round, reason }));
      passed = false;
    }
  }

  // v7.x: claim schema with typed evidence (src/claims.js), gated on config.claims.enabled.
  // Runs once, after the critic/revise rounds are done, over the union of objections this run
  // actually raised (lastCritique.failures) - restates each one as a typed claim and validates
  // its evidence offline (a "quote" claim against `draft`, a "tool" claim against `ground_truth`
  // from config.verify.enabled). Absent/false key: `claims`/`claimWarnings` stay undefined, never
  // added to the returned result, v6 report.json shape and every existing chain's behavior
  // unchanged. A claim whose evidence doesn't check out is dropped, not crashed - one bad quote
  // must not lose every other claim in the same reply.
  let claims;
  let claimWarnings = [];
  if (config.claims?.enabled) {
    log('\nStage: claims (typed evidence over this run\'s objections)');
    const failuresForClaims = lastCritique?.failures || [];
    if (!failuresForClaims.length) {
      claims = [];
      log('  no objections this run; nothing to extract.');
    } else {
      const claimSeat = config.seats.claims || config.seats.reviser || config.seats.builder;
      const extracted = await extractClaims(claimSeat, { request, draft, failures: failuresForClaims }, {
        invoke: (seat, args) => invoke(seat, { ...args }).then(s => { record(s); return s; }),
        parseJson, roles: R, log, label: 'claims',
      });
      const validated = dropInvalidClaims(extracted.claims, { draft, groundTruth: ground_truth });
      claims = validated.claims;
      claimWarnings = validated.warnings;
      log(`  ${claims.length} claim(s) kept, ${claimWarnings.length} dropped.`);
      claimWarnings.forEach(w => log(`  WARNING: ${w}`));
    }
  }

  // 0.8.2 item 4 (signed vs delivered text, LABEL only): the draft the panel last reviewed, whether it signed it, and what is still open. Every model stage after this point that changes the
  // body is recorded in `bodyChanges`, every harness-written block in `harnessNotes` (src/text-labels.js). Nothing here changes `passed` or calls a model.
  const reviewedDraft = draft;
  const signedAtPanel = passed === true;
  // The number of open objections is NOT `lastCritique.failures`: that is overwritten by a round nobody was heard in (empty) and counts a first-mode "(critic reply unparseable)" stand-in.
  // It is `openFailures` below: the one list the dissent block and `dispute.open_objections` use, so the three always say the same number (item 4 review, 6 Oct 2026).
  const bodyChanges = [];
  const harnessNotes = [];

  // 3a-bis. Dispute stage (config.dispute: { enabled: true, stall_rounds: 2 }), 2026-09-20.
  //
  // Runs once, when a unanimous chain stops without agreement - by the round cap or by the
  // stall rule above - and never when the panel signed off. It is explicitly NOT another
  // debate round: the panel does not re-review afterwards, and it cannot turn a disagreement
  // into a signoff. `outcome` stays no_consensus, because that is what happened.
  //
  // What it is for: the cheap-7 run ended with open objections that were simply dropped into
  // report.json, where a reader had to go looking for them, and a false claim survived into
  // the deliverable because the round cap hit before anyone could act on the objection to it.
  // So this does two narrow things. It gives the reviser ONE pass whose only job is to mark
  // what could not be settled - not to defend the draft, not to rewrite it. And it puts the
  // unresolved dissent at the top of the deliverable, verbatim, with the lab and round that
  // raised it, so the human reading the plan sees the disagreement before the plan rather
  // than after it.
  //
  // Deliberately not here: a re-vote, a tie-break, a "winner". A panel that did not agree did
  // not agree, and manufacturing a verdict is precisely what this harness should never do.
  let dispute = null;
  let dissentBlock = null;
  // After a round in which NO reviewer was heard (noHeardReviewer), lastCritique is the round
  // before's, against an earlier draft: none of it is current. Pre-release audit 2026-09-23
  // (ProposalsDebateDispute #4): it was presented as open against the current draft, under
  // "round cap reached". Those objections are carried below instead, tagged as unheard.
  const heardOpenFailures = (!passed && !noHeardReviewer && lastCritique && lastCritique.meets !== true)
    ? (lastCritique.failures || []).filter(f => f.criterion)
    : [];
  // Bug-audit fix, 2026-09-23 (Review/BugAudit_RunChainStages_2026-09-23.md #2): open objections
  // came only from the final round's HEARD voters, so a holdout that objected in rounds 1-2 and was
  // garbled or unreachable in the last round vanished - no "Unresolved dissent" block, and the
  // deliverable a builder reads first carried no warning. Such a seat's most recent recorded
  // objections are carried, keeping `lab` (the dispute stage finds the seat by it) and marked as
  // unheard in the final round, so nobody reads them as a current position.
  const finalPanelRound = panelVerdicts.length ? Math.max(...panelVerdicts.map(v => v.round)) : null;
  // In a round nobody was heard in, a seat that only stated a pass cast no vote either.
  // The same for a round that was not quorate: its stated passes were not votes.
  const notHeard = v => v.verdict === 'unheard' || ((noHeardReviewer || notQuorate) && v.verdict === 'passed');
  const unheardAtEnd = (!passed && config.signoff === 'unanimous')
    ? panelVerdicts.filter(v => v.round === finalPanelRound && notHeard(v)).map(v => v.lab)
    : [];
  const carriedFailures = unheardAtEnd.flatMap(lab => {
    for (let i = openByRound.length - 1; i >= 0; i--) {
      const mine = openByRound[i].failures.filter(f => f.lab === lab && f.criterion);
      if (mine.length) return mine.map(f => ({ ...f, unheard_in_final_round: true, last_raised_round: openByRound[i].round }));
    }
    return [];
  });
  const openFailures = [...heardOpenFailures, ...carriedFailures];
  if (disputeEnabled && config.signoff === 'unanimous' && openFailures.length) {
    const stopWhy = noHeardReviewer ? `no reviewer heard in round ${noHeardReviewer.round}` : notQuorate ? `round ${notQuorate.round} not quorate` : stalled ? `stalled after ${stalled.rounds} identical rounds` : 'round cap reached';
    log(`\nStage: dispute (${stopWhy}, ${openFailures.length} open objection(s))`);
    log('  This does not re-open the vote. The panel is done; this records what it could not settle.');

    // Where each objection was first raised, for the dissent block. Read from the per-round
    // record rather than the last round alone, so "raised in round 2, never resolved" is
    // visible - that was true of the false claim in the cheap-7 run and nothing showed it.
    const firstSeen = new Map();
    for (const { round: r, failures } of openByRound) {
      for (const f of failures) {
        const key = objectionKey(f);
        if (!firstSeen.has(key)) firstSeen.set(key, r);
      }
    }

    const reviserSeat = config.seats.reviser || config.seats.builder;
    const revised = (await draftStage(reviserSeat, {
      system: R.DISPUTE_SYSTEM,
      user: R.disputeUser({ request, criteria, draft, failures: openFailures }),
      log, label: 'dispute',
    })).text;
    const parsedDispute = parseDisputes(revised);
    const draftBeforeDispute = draft;
    draft = parsedDispute.draft;
    if (draft !== draftBeforeDispute) bodyChanges.push('dispute');
    parsedDispute.disputes.forEach(reason => disputes.push({ round: 'dispute', reason }));

    // Dispute review (opt-in): the seats that raised the open objections check the reviser's
    // last pass. Runs before the block below is built, so a misrepresented or dropped objection
    // is flagged at the top of the deliverable, with the dissent itself.
    const review = disputeReviewEnabled
      ? await runDisputeReview(config, { request, openFailures, draftBefore: draftBeforeDispute, draftAfter: draft, invoke, record, log })
      : null;
    const reviewFlags = renderDisputeReviewFlags(review);

    // The dissent block is built here, from the recorded objections, and never from the
    // reviser's reply: a seat asked to summarise the objections against its own draft is the
    // last thing that should be authoring the record of them. Verbatim, or it is not a record.
    const lines = openFailures.map(f => {
      const r = firstSeen.get(objectionKey(f));
      // The carried tags (set above) are rendered, as that code's comment promises: an objection
      // whose author was not heard in the final round is shown as possibly out of date, never as a
      // current position against this draft.
      const status = f.unheard_in_final_round
        ? `last raised in round ${f.last_raised_round}; ${f.lab || 'that lab'} was not heard in the final round, so it may already be fixed in the draft below`
        : 'never resolved';
      return [
        `### ${f.criterion}`,
        `*Raised by ${f.lab || 'an unnamed lab'}${r ? `, round ${r}` : ''}, ${status}.*`,
        '',
        f.problem || '(no problem text recorded)',
        ...(f.fix ? ['', `Suggested fix: ${f.fix}`] : []),
      ].join('\n');
    });
    const block = [
      '## Unresolved dissent',
      '',
      `${openFailures.length} objection(s) were still open when this run stopped` +
        `${noHeardReviewer ? ` (no reviewer could be heard in round ${noHeardReviewer.round}, so the panel stopped there; nobody has reviewed the latest draft)` : notQuorate ? ` (in round ${notQuorate.round} only ${notQuorate.heard} reviewer(s) gave a verdict, below this chain's quorum of ${notQuorate.minHeard}, so the panel stopped there)` : stalled ? ` (the same objections for ${stalled.rounds} rounds running)` : ' (round cap reached)'}.`,
      'The panel did not agree. This plan is one draft with known, named disagreement against it,',
      'not a signed-off deliverable - read these before acting on anything below.',
      '',
      ...lines,
      '',
      ...reviewFlags,
      '---',
      '',
    ].join('\n');
    // Held, not applied here. The final-edit stage strips chain artifacts and never adds
    // material, so a block prepended now would be edited straight back out - caught by the
    // mock run, where the dissent never reached the deliverable at all. It goes on after that
    // stage instead, which also puts it in front of the handoff, where a build session reads
    // it first.
    dissentBlock = block;

    dispute = {
      ran: true,
      reason: noHeardReviewer ? 'no_heard_reviewer' : notQuorate ? 'not_quorate' : stalled ? 'stalled' : 'round_cap',
      stall_rounds: stalled ? stalled.rounds : null,
      stopped_at_round: noHeardReviewer ? noHeardReviewer.round : notQuorate ? notQuorate.round : stalled ? stalled.round : (finalPanelRound ?? maxRounds),
      open_objections: openFailures.map(f => ({
        criterion: f.criterion,
        lab: f.lab || null,
        problem: f.problem || null,
        ...(f.id ? { id: f.id } : {}),
        first_raised_round: firstSeen.get(objectionKey(f)) ?? null,
        ...(f.unheard_in_final_round ? { unheard_in_final_round: true, last_raised_round: f.last_raised_round } : {}),
      })),
      panel_rereviewed: false,
      // Additive: present only when the chain sets dispute.review.
      ...(review ? { review: { entries: review.entries, counts: review.counts } } : {}),
    };
    log(`  recorded ${openFailures.length} unresolved objection(s) at the top of the deliverable. Outcome stays "no consensus".`);
  } else if (disputeEnabled && config.signoff === 'unanimous') {
    dispute = { ran: false, reason: passed ? 'panel_signed_off' : noHeardReviewer ? 'no_heard_reviewer' : notQuorate ? 'not_quorate' : 'no_open_objections', ...(noHeardReviewer ? { stopped_at_round: noHeardReviewer.round } : notQuorate ? { stopped_at_round: notQuorate.round } : {}) };
  }

  // 3b. Post-signoff challenge (config.challenge: { enabled: true }), v7
  // item 5. `enabled` is the only key chain.js or chain-lint.js ever reads -
  // one challenge, re-opening one decision, for one extra round, hard-coded
  // right here rather than pulled from config. Runs once, after the
  // critic/revise rounds are done (passed or round-capped), never inside the
  // loop above - it is a distinct, narrower stage, not another review round.
  let challenge = null;
  if (config.challenge?.enabled === true) {
    log('\nStage: challenge (post-signoff, one decision, one round)');
    const challengerSeat = config.seats.challenger || config.seats.critics[0];
    const cs = record(await invoke(challengerSeat, {
      system: R.CHALLENGE_SYSTEM,
      user: R.challengeUser({ request, criteria, draft, signoff }),
      log, label: 'challenge',
    }));
    const parsed = parseJson(cs.text);
    if (parsed?.challenge === true && parsed.decision && parsed.evidence) {
      log(`  challenge raised against "${parsed.decision}" - evidence that would settle it: ${parsed.evidence}`);
      const reviserSeat = config.seats.reviser || config.seats.builder;
      const revised = (await draftStage(reviserSeat, {
        system: R.reviserSystem(open, !!fencedSource, promptOpts),
        user: R.reviserUser({
          request, criteria, draft,
          critique: { failures: [{ criterion: parsed.decision, problem: parsed.evidence, fix: '' }] },
        }),
        log, label: 'challenge-revise',
      })).text;
      const parsedRevise = parseDisputes(revised);
      if (parsedRevise.draft !== draft) bodyChanges.push('challenge');
      draft = parsedRevise.draft;
      parsedRevise.disputes.forEach(reason => disputes.push({ round: 'challenge', reason }));
      challenge = {
        raised: true,
        by: labOf(challengerSeat),
        decision: parsed.decision,
        evidence_needed: parsed.evidence,
        reopened_rounds: 1,
      };
    } else {
      log('  no challenge raised; the signed-off draft stands.');
      challenge = { raised: false };
    }
  }

  // 4. Optional final edit: strips chain artifacts. Never adds material.
  if (config.seats.finalist) {
    log('\nStage: final edit');
    const beforeFinal = draft;
    draft = (await draftStage(config.seats.finalist, {
      system: R.FINALIST_SYSTEM,
      user: R.finalistUser({ request, draft, history: history.join('\n\n') }),
      log, label: 'final',
    })).text;
    if (draft !== beforeFinal) bodyChanges.push('final_edit');
  }

  // Unresolved dissent goes on after the final edit, never before it: that stage strips
  // chain artifacts and would remove this as one. Placed ahead of the handoff on purpose -
  // the file a build session reads first should say what the panel could not settle.
  // 3c. Cold-reader coherence check (config.coldRead: { enabled: true }), harness features
  // v6 item A/6: catches a documented failure mode - internal contradictions merging can
  // leave behind - by having one fresh seat with zero debate context read only the
  // signed-off draft. No efficacy claim is made; this does not measure or assert that
  // output quality improves.
  // 0.8.2 (owner decision 4a, 5 Oct 2026): it runs AFTER the final edit, so the reader sees the text that is delivered (before 0.8.2 it ran before the final edit and read a draft the
  // delivered one could differ from); a reply that cannot be read, or a seat that cannot be reached, is `status: "not_judged"` (never a silent "no contradictions"); and its findings are
  // carried into the deliverable and WARNINGS.md (the CLI), not only report.json. The seat is a chain-file field and stays one: no seat is chosen for a chain here. A descending chain
  // runs it once, over the final stack (the plan sub-run is given none).
  let coldRead = null;
  let coldReadBlock = '';
  if (config.coldRead?.enabled === true) {
    log('\nStage: cold-reader coherence check (post-signoff, after any final edit, one fresh seat, draft only)');
    const coldReadSeat = config.seats.coldRead;
    if (!coldReadSeat) throw new Error('config.coldRead.enabled is true but config.seats.coldRead is not set - no fallback to another seat, since any seat that already saw debate context defeats the mechanism.');
    let cr = null;
    try {
      cr = record(await invoke(coldReadSeat, {
        system: R.COLD_READ_SYSTEM,
        user: R.coldReadUser(draft),
        log, label: 'cold-read',
      }));
    } catch (err) {
      rethrowControlFlow(err);
      log(`  cold-reader: no reply (${String(err.message).slice(0, 120)}) - NOT JUDGED.`);
      coldRead = { status: 'not_judged', reason_code: 'SEAT_UNREACHABLE', raised: false, contradictions: [] };
    }
    if (cr) {
      const parsed = parseJson(cr.text);
      if (!parsed || typeof parsed.raised !== 'boolean') {
        const code = abstentionReasonCode(cr.usage || {}, coldReadSeat.maxTokens ?? DEFAULT_MAX_TOKENS);
        log(`  cold-reader: the reply could not be read (${code || 'REPLY_UNPARSEABLE'}) - NOT JUDGED, which is not the same as "no contradictions".`);
        coldRead = { status: 'not_judged', reason_code: code || 'REPLY_UNPARSEABLE', raised: false, contradictions: [] };
      } else {
        const contradictions = Array.isArray(parsed.contradictions)
          ? parsed.contradictions
              .filter(c => c && typeof c.note === 'string')
              .map(c => ({ sections: Array.isArray(c.sections) ? c.sections : [], note: c.note }))
          : [];
        coldRead = { status: 'judged', raised: parsed.raised === true, contradictions };
        log(coldRead.raised ? `  cold-reader flagged ${contradictions.length} contradiction(s).` : '  cold-reader found no contradictions.');
      }
    }
    if (coldRead.status === 'not_judged') {
      coldReadBlock = `## Cold read: not done\n\nThe cold reader (a seat that never saw the debate) was asked to read this plan for contradictions between its own sections and gave no readable answer (${coldRead.reason_code}). Nobody has done that check.\n\n---\n`;
    } else if (coldRead.raised && coldRead.contradictions.length) {
      coldReadBlock = `## Cold-reader findings\n\nA reader who never saw the debate read this plan and found ${coldRead.contradictions.length} contradiction(s) between its own sections. ${passed === true ? 'The panel had already signed off' : 'The panel did not sign off on this plan'}; read these before acting on anything below.\n\n${coldRead.contradictions.map((c, i) => `${i + 1}. ${c.sections.length ? `(${c.sections.join(', ')}) ` : ''}${c.note}`).join('\n')}\n\n---\n`;
    }
  }

  // 0.8.2: the cold reader's findings go on after the dissent block (a build session reads what the panel could not settle first, then what the cold reader found).
  const bodyDelivered = draft; // the model-written text as delivered, before any harness block
  if (dissentBlock) harnessNotes.push('dissent_block');
  if (coldReadBlock) harnessNotes.push('cold_read_block');
  if (dissentBlock || coldReadBlock) draft = `${dissentBlock || ''}${coldReadBlock}${draft}`;

  // 5. Handoff (config.handoff): the file a build session reads first.
  let handoff = null;
  const draftForHandoff = draft; // what the handoff is made from (the delivered text at this point)
  if (config.handoff) {
    log('\nStage: handoff');
    handoff = (await draftStage(config.seats.handoff || config.seats.builder, {
      ...handoffPrompt({ config, request, draft, planFile: config.handoffPlanFile || 'PLAN.md', checks, criteria }),
      log, label: 'handoff',
    })).text;
  }

  // 5b. "How this plan was argued" (config.argued.enabled, src/argued.js). Opt-in, enabled in no
  // shipped chain. Runs once, on the handoff seat (the builder when there is no handoff seat) - an
  // external Claude Code session in the plan-7 chains, so no API call; a billed seat goes through
  // invoke() via draftStage like every other free-text stage, and --dry-run prices it. The writer
  // gets a fact pack built from this run's own record and nothing else, and its reply is checked
  // for ids and labs the pack does not contain. Written to ARGUED.md by the CLI, never into the
  // deliverable: the plan is what gets scored, reviewed and built, and a narrative citing proposal
  // ids inside it would be read as plan content. Absent or not `true`: nothing here runs, no stage
  // label appears, and the result carries no `argued` key.
  let argued;
  if (config.argued?.enabled === true) {
    log('\nStage: how this plan was argued');
    const facts = buildArguedFacts({
      proposals, scoreRows: proposals.length ? scoreProposals(proposals, draft).rows : [],
      debate, alternatives, disputes, dispute, signoff, panelVerdicts, plan: draft,
    });
    const text = (await draftStage(config.seats.handoff || config.seats.builder, {
      system: ARGUED_SYSTEM,
      user: arguedUser({ request, plan: draft, facts }),
      log, label: ARGUED_LABEL,
    })).text;
    const check = checkArguedRefs(text, facts);
    argued = { file: ARGUED_FILE, text, facts_counts: facts.counts, check };
    log(check.ok
      ? `  ${ARGUED_FILE}: ${check.refs_cited} distinct id(s) and lab(s) cited, every one in the run's record.`
      : `  !! ${ARGUED_FILE}: names things the run's record does not contain - ${[...check.unknown_refs, ...check.unknown_labs].join(', ') || 'none'}; missing labs: ${check.missing_labs.join(', ') || 'none'}; missing sections: ${check.missing_sections.join(', ') || 'none'}.`);
  }

  // 6. Final security review (config.security_review.enabled, src/security-review.js). The very
  // last stage - after build, verify_post, every critic/revise round, the challenge, the final
  // edit and the handoff - so it always reviews the finished deliverable, never a draft that can
  // still change. Read-only: its reply is recorded, never assigned to `draft`, and never handed to
  // a reviser. Pause and spend-cap errors propagate like any other stage's; a reviewer that simply
  // fails to answer becomes a "not_judged" result, which is never a pass. Absent or not `true`:
  // never called, and the result carries no security_review key.
  let security_review;
  if (config.security_review?.enabled === true) {
    log('\nStage: security review (final, read-only)');
    security_review = await runSecurityReviewStage(config, {
      request, deliverable: draft, groundTruthPost: ground_truth_post, invoke, record, parseJson,
      abstentionReasonCode, rethrow: [ExternalPause, BudgetExceeded, SecretShapedPrompt, DeniedModel], log,
    });
    log(`  gate: ${security_review.gate} - ${security_review.findings.length} finding(s), ${security_review.blocking_count} blocking${security_review.reason_code ? ` (${security_review.reason_code})` : ''}`);
  }

  // Scoreboard: what each lab proposed and what the plan did with it. The
  // "built" column can only be filled after a build session; it is left to
  // the human on purpose (a part that reads well may not build).
  const scoreboard = proposals.length ? scoreProposals(proposals, draft) : null;
  if (scoreboard) {
    log('\nProposal scoreboard (built column: fill in after the build session)');
    for (const row of scoreboard.labs) log(`  ${row.lab.padEnd(12)} proposed ${row.proposed}  accepted ${row.accepted}  cut ${row.cut}  withdrawn ${row.withdrawn}  unaccounted ${row.unaccounted}`);
  }

  const ledger = proposals.length ? withdrawalLedger(proposals) : null;

  return {
    // 0.8.2 item 4 (additive; `passed` untouched): which text the panel signed, which text is delivered, what the handoff was made from.
    ...(() => { const l = buildTextLabels({ reviewedDraft, signed: signedAtPanel, round: finalPanelRound, openObjections: signedAtPanel ? 0 : openFailures.length, bodyChanges, harnessNotes, body: bodyDelivered, deliverable: draft, handoffMadeFrom: config.handoff ? draftForHandoff : null }); return { signedText: l.signed_text, deliveredText: l.delivered_text, ...(l.handoff_text ? { handoffText: l.handoff_text } : {}) }; })(),
    deliverable: draft,
    criteria,
    ambiguities,
    questions,
    skeleton,
    proposals,
    proposalPool,
    dropouts,
    board,
    debate,
    handoff,
    scoreboard,
    passed,
    lastCritique,
    signoff,
    challenge,
    coldRead,
    allocator: config.allocator?.enabled ? {
      targetedRounds: allocatorRounds,
      engagedCount: allocatorRounds.filter(r => r.engaged).length,
      rubberStampCount: allocatorRounds.filter(r => !r.engaged).length,
    } : null,
    disputes,
    regressions,
    panelVerdicts,
    // Additive: present only when a panel round heard no reviewer and the loop stopped there.
    ...(noHeardReviewer ? { noHeardReviewer } : {}),
    // Additive (0.7.8): present only when the chain set a quorum and a round fell short of it.
    ...(notQuorate ? { notQuorate } : {}),
    history,
    stages,
    totals: summarise(stages),
    orphanSections: ledger?.orphanSections ?? [],
    withdrawalCycles: ledger?.withdrawalCycles ?? 0,
    ...(ground_truth !== undefined ? { ground_truth } : {}),
    ...(argued !== undefined ? { argued } : {}),
    ...(toolRequestWarnings !== undefined ? { toolRequestWarnings } : {}),
    ...(canary !== undefined ? { canary } : {}),
    ...(lints !== undefined ? { lints } : {}),
    ...(claims !== undefined ? { claims, claimWarnings } : {}),
    ...(preflight !== undefined ? { preflight } : {}),
    ...(ground_truth_post !== undefined ? { ground_truth_post } : {}),
    ...(security_review !== undefined ? { security_review } : {}),
    // Additive, per report.json's public contract: absent entirely on a chain that does not
    // enable the dispute stage, so nothing built on an existing run folder sees a new field.
    ...(dispute !== null ? { dispute } : {}),
    // Additive: absent unless the task carried fenced source for quotes to be checked against.
    ...(fencedSource ? { quoteFindings } : {}),
    ...(config.revise?.mode === 'patch' ? { patchFallbacks } : {}),
    // Additive, per report.json's public contract: absent on any chain without the alternatives stage.
    ...(alternatives !== null ? { alternatives } : {}),
    // Additive: absent on any chain without the deep-dive seat (tiered councils).
    ...(deepDive !== undefined ? { deep_dive: deepDive } : {}),
    // Additive (0.8.0): the sign-offs whose criteria table skipped criteria; [] when there were none.
    missingCriteria,
    // Additive (0.8.2): present only when something happened - sign-offs refused for an incomplete table (signoff_table.required) and table rows that named no criterion.
    ...(signoffTableGaps.length ? { signoffTableGaps } : {}),
    ...(answerBackRecords.length ? { answerBack: answerBackRecords } : {}),
    ...(answerBackReplies.length ? { answerBackReplies } : {}),
    ...(debateOrders.length ? { debateOrders: [...debateOrders].sort((a, b) => (a.stage + a.reader < b.stage + b.reader ? -1 : 1)) } : {}),
    ...(outsideCriteriaRowList.length ? { outsideCriteriaRows: outsideCriteriaRowList } : {}),
    criteriaLints,
    // Additive: absent unless the chain enabled criterion kinds (src/criteria-kinds.js).
    ...(kindsOn ? {
      criteriaKinds: kindsRecord(criteria, criteriaKinds),
      criteriaSummary: criteriaSummary(criteria, criteriaKinds, { metWithoutEvidence }),
      metWithoutEvidence,
    } : {}),
  };
}
