// The council advisor (config.advise; thc-research brief 27, 2026-09-30).
//
// An advice exchange is a different shape from a planning run: one question, a short brief, one
// short verdict. Advisors from different labs answer blind; optionally read each other once,
// anonymised and without a head-count; and the engine returns ONE verdict with every dissenting
// position recorded beside it, in the seats' own words. Nothing here is decided in advance:
// "proceed", "stop" and "need_information" are answers as welcome as "change", and one advisor
// (the `advise-single` control chain) is a valid council.
//
// Contract
//   config.advise = {
//     enabled: true,
//     usd: 0.5,                        REQUIRED: this call's own ceiling, inside the run's (chain-lint)
//     rounds: 0 | 1 | 2,               debate rounds after the blind opinions; default 0
//     skipDebateWhenUnanimous: true,   default true: nothing to argue when every blind verdict agrees
//     synthesis: "none" | "seat",      default "none": the verdict is rolled up by the engine, no call
//     samples: 1..5                    default 1: each seat is asked this many times, independently
//                                      (the "one model asked k times" control arm; lint: rounds 0)
//   }
//   config.seats.critics                the advisors (one per lab, distinct labs; chain-lint)
//   config.seats.builder                the synthesis seat when synthesis is "seat" - NOT on the panel
//   stage labels                        advise-<lab>[-s<k>], advise-<lab>-retry, advise-debate-<r>-<lab>,
//                                       advise-synthesis (stable, so resume replays them)
//   result (runChain's `advise`, report.json's `advise`): see finishAdvice() below.
//
// Money. Every call goes through invoke(), so the run cap projects it first and the denied-model
// backstop applies. This stage ALSO holds its own ceiling, `advise.usd`, checked on the same worst
// case (projectStage, shared with invoke()):
//   - the blind opinions are all-or-nothing: if their combined worst case is above `usd`, nothing is
//     called and the run is REFUSED (AdviceRefused, zero spend). A panel with some of its seats
//     silently left out would hand back a verdict that looks like the whole council's.
//   - the debate and the synthesis are optional: a stage whose worst case would take the call past
//     `usd` is skipped, and the record says so (`stopped: "own_cap"`).
//
// Guards, each pinned in test/advise.test.js:
//   - a seat's verdict is a fixed field, read from JSON; anything else is unreadable, retried once
//     (a reply cut off at its cap gets a bigger one), then the seat is recorded as a dropout;
//   - risk quotes are checked against the brief (`quote_status`); nothing a seat says is trusted;
//   - in the debate a seat changes its verdict only by quoting the argument that changed it
//     (`changed_because`, checked against the positions it was shown); an unquoted change is kept on
//     the record as `unargued` and the seat's FIRST verdict stands (the majority guard's rule,
//     src/chain.js guardWithdrawals);
//   - the dissent block is built by the engine from the seats' own fields, so a synthesis seat can
//     shorten the verdict but cannot drop a dissenter; a synthesis headline no seat holds is flagged
//     and replaced by the engine's roll-up;
//   - the debate stops when a round changes no verdict (the stall rule), or when there is nothing to
//     argue (every blind verdict agrees).
// Consensus is a process signal here, never a proof of correctness, and the deliverable says so.
import * as R from './roles.js';
import { projectStage, formatUsd, summarise } from './cost.js';

export const ADVISE_DEFAULTS = Object.freeze({ rounds: 0, skipDebateWhenUnanimous: true, synthesis: 'none', samples: 1 });
export const ADVISE_MAX_ROUNDS = 2;
export const ADVISE_MAX_SAMPLES = 5;

/**
 * A stop asked for from outside the run (0.8.1 decided rule 6, DR-10): a person (`user`), a client that cancelled or left
 * (`client_cancel`), or the chain's wall clock (`wall_clock`). Control flow like BudgetExceeded: no catch may turn it into an
 * abstention (rethrowControlFlow passes it on). Thrown before the first paid call (`beforeFirstCall`), or after a wave of calls
 * settled (every call in flight finished and was recorded first), carrying what was paid for as `out` ({ advise, deliverable,
 * dropouts }: the paid answers rolled up, advise.status 'stopped'), which the CLI writes as report-partial.json (exit 18).
 */
export class AdviceStopped extends Error {
  constructor(reason, { beforeFirstCall = true, out = null } = {}) {
    super(beforeFirstCall ? `advice stopped before any call was made (${reason}); nothing was spent.` : `advice stopped after paid calls (${reason}); what was paid for is kept.`);
    this.name = 'AdviceStopped';
    this.controlFlow = true;
    this.reason = reason;
    this.beforeFirstCall = beforeFirstCall;
    this.out = out;
  }
}

/** Thrown before any call is made when the panel's worst case is above the call's own ceiling. */
// The most a cut-off advice reply is retried at (tokens). Derived, not tuned: it is the 0.8.0 retry bound (src/chain.js CUT_OFF_RETRY_MAX_TOKENS), and the advice
// ceilings in chains/advise-*.json were derived with it (advise-single: first call plus one retry at 64,000 must fit its $1.32; 72,000, the model's own maximum
// for Sol, would not). test/advice-units.test.js reads this constant.
export const ADVICE_RETRY_MAX_TOKENS = 64_000;

export class AdviceRefused extends Error {
  constructor({ projected, cap, seats, tier }) {
    super(`advice refused, nothing was called: the ${tier || 'chosen'} panel (${seats} seat${seats === 1 ? '' : 's'}) could cost up to ${formatUsd(projected)} on this brief and the call's own ceiling is ${formatUsd(cap)}. `
      + `Shorten the brief, pick a cheaper tier, or raise "advise.usd" in the chain file.`);
    this.name = 'AdviceRefused';
    this.projected = projected;
    this.cap = cap;
  }
}

const norm = t => String(t || '').toLowerCase().replace(/[‘’“”"'`]/g, '').replace(/\s+/g, ' ').trim();

/** 'verified' when the quote's words (at least 8 characters) are in the brief, 'none' for no quote, else 'not found in the brief' or 'too short to check'. */
export function quoteStatus(quote, brief) {
  if (typeof quote !== 'string' || !quote.trim()) return 'none';
  if (norm(quote).length < 8) return 'too short to check';
  return norm(brief).includes(norm(quote)) ? 'verified' : 'not found in the brief';
}

const asList = v => (Array.isArray(v) ? v : []);

/** A blind opinion as the engine records it, or null when the reply is not a readable one. */
export function readOpinion(parsed, brief, cap = s => s) {
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return null;
  const verdict = String(parsed.verdict || '').toLowerCase().trim();
  if (!R.ADVISE_VERDICTS.includes(verdict)) return null;
  const str = v => (typeof v === 'string' ? cap(v) : v == null ? '' : cap(JSON.stringify(v)));
  const answer = str(parsed.answer);
  if (!answer.trim()) return null;
  const confidence = String(parsed.confidence || '').toLowerCase().trim();
  return {
    restated_question: str(parsed.restated_question),
    verdict,
    confidence: R.ADVISE_CONFIDENCE.includes(confidence) ? confidence : 'low',
    answer,
    risks: asList(parsed.risks).filter(r => r && typeof r === 'object' && str(r.risk).trim()).slice(0, 3)
      .map(r => ({ risk: str(r.risk), quote: str(r.quote), quote_status: quoteStatus(typeof r.quote === 'string' ? r.quote : '', brief) })),
    would_change_if: str(parsed.would_change_if),
    missing_from_brief: asList(parsed.missing_from_brief).filter(x => typeof x === 'string' && x.trim()).slice(0, 5).map(str),
  };
}

/** Merge one debate reply into a seat's standing position, applying the quote rule. */
export function applyDebateReply(op, parsed, others, cap = s => s, brief = '') {
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return { unreadable: true };
  const to = String(parsed.final_verdict || '').toLowerCase().trim();
  if (!R.ADVISE_VERDICTS.includes(to)) return { unreadable: true };
  const str = v => (typeof v === 'string' ? cap(v) : '');
  const confidence = String(parsed.confidence || '').toLowerCase().trim();
  const reply = {
    from: op.verdict, to,
    confidence: R.ADVISE_CONFIDENCE.includes(confidence) ? confidence : op.confidence,
    answer: str(parsed.answer) || op.answer,
    changed_because: str(parsed.changed_because),
    still_contested: str(parsed.still_contested),
    would_change_if: str(parsed.would_change_if) || op.would_change_if,
  };
  reply.changed = to !== op.verdict;
  if (reply.changed) {
    // The quote must come from an argument the seat was shown that supports the verdict it is moving
    // TO: the answer, a risk or the "would change if" of a peer already holding that verdict, matched
    // field by field (never across a join), at least 20 characters and four words once normalised,
    // and not text that is in the brief or in the advisor prompts (both are in every seat's context and
    // argue nothing: "not in the brief" is a phrase the prompt itself tells a seat to write). This is
    // the majority guard's rule (src/chain.js guardWithdrawals) made stricter for verdicts.
    const q = norm(reply.changed_because);
    const fields = o => [o.answer, ...o.risks.map(r => r.risk), o.would_change_if].filter(Boolean).flatMap(f => [norm(f), norm(R.advisorText(f))]);
    const fromPeer = others.filter(o => o.verdict === to).some(o => fields(o).some(f => f.includes(q)));
    const boilerplate = norm(`${brief} ${R.ADVISOR_SYSTEM} ${R.ADVISOR_DEBATE_SYSTEM} ${R.ADVISE_SYNTHESIS_SYSTEM}`).includes(q);
    reply.argued = q.length >= 20 && q.split(' ').length >= 4 && fromPeer && !boilerplate;
    if (!reply.argued) reply.unargued = true;
  }
  return reply;
}

/** The engine's roll-up of the seats' final verdicts: tally, leader, agreement. */
export function rollUp(opinions) {
  const tally = {};
  for (const o of opinions) tally[o.final.verdict] = (tally[o.final.verdict] || 0) + 1;
  const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1] || R.ADVISE_VERDICTS.indexOf(a[0]) - R.ADVISE_VERDICTS.indexOf(b[0]));
  const n = opinions.length;
  const lead = ranked[0];
  const tied = ranked.length > 1 && ranked[1][1] === lead[1];
  const agreement = ranked.length === 1 ? 'unanimous' : tied ? 'split' : 'plurality';
  return { tally, agreement, verdict: tied ? 'split' : lead[0], leaders: ranked.filter(r => r[1] === lead[1]).map(r => r[0]), n };
}

const rank = c => R.ADVISE_CONFIDENCE.indexOf(c);

/** Each seat as recorded for dissent: everything it held, in its own words. */
function heldBy(o) {
  const risk = o.final.risks?.find(r => r.quote_status === 'verified') || o.final.risks?.[0] || null;
  return {
    lab: o.lab, model: o.model,
    verdict: o.final.verdict, confidence: o.final.confidence, answer: o.final.answer,
    ...(risk ? { top_risk: risk } : {}),
    would_change_if: o.final.would_change_if,
    ...(o.first.verdict !== o.final.verdict ? { first_verdict: o.first.verdict } : {}),
  };
}

// Seat-written text in a file another agent reads: continuation lines are indented and a leading "#"
// escaped (roles.js boardText), so a seat can add words but never a heading, a second verdict block or
// a section of its own.
const esc = v => R.boardText(v);
const VERDICT_WORDS = { proceed: 'PROCEED', change: 'CHANGE', stop: 'STOP', need_information: 'NEED INFORMATION', split: 'SPLIT' };

/** The deliverable: the short leaning first, then the recorded dissent, then how the call ran. Public text says "leaning", never "verdict" (decided rule 2); JSON field names stay. */
export function renderAdvice(a) {
  const many = a.seats_answered > 1;
  const head = `# Council advice\n\n**Leaning: ${VERDICT_WORDS[a.verdict]}**${many ? ` (seats ${a.agreement}; tally: ${Object.entries(a.tally).map(([v, n]) => `${n} ${v.replace('_', ' ')}`).join(', ')} of ${a.seats_answered})` : ' (one seat)'}${a.confidence ? `, confidence ${a.confidence}` : ''}\n\n${esc(a.verdict_text)}${a.next_step ? `\n\nNext step: ${esc(a.next_step)}` : ''}`;
  // What the headline rests on differs by where it came from, and the file must not claim more.
  const note = !many ? '' : `\n\n> ${a.agreement === 'unanimous' ? 'Every seat that answered gave this answer. That is a sign the seats read the brief alike, not proof they are right.'
    : a.verdict === 'split' ? 'The seats did not converge and the harness picked nothing. How many seats hold a position is not evidence.'
    : a.headline_source === 'synthesis' ? 'The synthesis seat chose this headline from the arguments, not from the count; it may differ from what most seats said. How many seats hold a position is not evidence.'
    : 'This is the leaning most seats gave, rolled up by the harness. How many seats hold a position is not evidence: read the dissent.'}`;
  const pos = a.dissent.length
    ? `\n\n## ${a.verdict === 'split' ? 'Positions (the seats did not converge)' : 'Recorded dissent'}\n\n${a.dissent.map(d => `- **${esc(d.lab)}: ${VERDICT_WORDS[d.verdict]}** (${d.confidence})${d.first_verdict ? `, first said ${VERDICT_WORDS[d.first_verdict]}` : ''}. ${esc(d.answer)}${d.top_risk ? ` Risk: ${esc(d.top_risk.risk)}${d.top_risk.quote ? ` Quote: "${esc(d.top_risk.quote)}" (${d.top_risk.quote_status}).` : ''}` : ''}${d.would_change_if ? ` Would change if: ${esc(d.would_change_if)}` : ''}`).join('\n')}`
    : '';
  const moved = a.debate.rounds.flatMap(r => r.replies.filter(x => x.changed)).map(x => `- ${esc(x.lab)}: ${VERDICT_WORDS[x.from]} to ${x.argued ? VERDICT_WORDS[x.to] : `${VERDICT_WORDS[x.to]} offered but NOT recorded (no quoted argument), ${VERDICT_WORDS[x.from]} stands`}${x.argued ? `, after: "${esc(x.changed_because)}"` : ''}`);
  const changes = moved.length ? `\n\n## Changed answers in the debate\n\n${moved.join('\n')}` : '';
  const missing = a.missing_from_brief.length ? `\n\n## Missing from the brief\n\n${a.missing_from_brief.map(m => `- ${esc(m)}`).join('\n')}` : '';
  const ran = `\n\n## How this call ran\n\n${a.seats_answered} of ${a.seats_asked} seats answered${a.dropouts.length ? ` (${a.dropouts.map(d => `${esc(d.lab)}: ${esc(d.reason)}`).join('; ')})` : ''}. Debate rounds: ${a.debate.rounds_run} of ${a.debate.rounds_planned} planned${a.debate.stopped ? ` (stopped: ${a.debate.stopped})` : ''}. Synthesis: ${a.synthesis.seat ? `${esc(a.synthesis.seat)}${a.synthesis.flag ? `, flagged: ${a.synthesis.flag}` : ''}` : 'none, rolled up by the harness'}. Spent ${formatUsd(a.spent)} of this call's ${formatUsd(a.usd_cap)} ceiling.`;
  return `${head}${note}${pos}${changes}${missing}${ran}\n`;
}

/** BOARD.md's text for an advice run. `record` is the CLI's record (brief 29): where the brief went (`sent_to`), the brief's hash (`brief_sha256`), the dispositions. */
export function renderAdviseBoard(a, record = null) {
  const blind = a.opinions.map(o => `### ${esc(o.lab)} (${esc(o.model)})\n\nRestated question: ${esc(o.first.restated_question) || '(none)'}\n\nFirst (blind): **${o.first.verdict}** (${o.first.confidence}). ${esc(o.first.answer)}\n\n${o.first.risks.map(r => `- Risk: ${esc(r.risk)}${r.quote ? ` Quote: "${esc(r.quote)}" (${r.quote_status}).` : ''}`).join('\n') || '- (no risks listed)'}\n\nWould change if: ${esc(o.first.would_change_if) || '(not said)'}${o.first.verdict !== o.final.verdict ? `\n\nFinal: **${o.final.verdict}** (${o.final.confidence}).` : ''}`).join('\n\n');
  const rounds = a.debate.rounds.map(r => `### Debate round ${r.round}\n\n${r.replies.map(x => `- ${esc(x.lab)}: ${x.unreadable ? 'unreadable reply, position stands' : x.changed ? (x.argued ? `${x.from} to ${x.to} after "${esc(x.changed_because)}"` : `offered ${x.from} to ${x.to} without a quoted argument, ${x.from} stands`) : `kept ${x.from}`}${x.still_contested ? `. Still contested: ${esc(x.still_contested)}` : ''}`).join('\n')}`).join('\n\n');
  // Where the brief went (brief 29): the same facts as report.json's additive fields, for a person reading the board.
  const where = record ? `\n\n## Where the brief went\n\nThe exact text every seat was sent has sha256 ${record.brief_sha256}.\n\n${(record.sent_to || []).map(s => `- ${esc(s.lab)} (${esc(s.model)}): ${esc(s.retention)}${s.served_by?.length ? `; served by ${s.served_by.map(esc).join(', ')}` : ''}`).join('\n')}\n\n"ZDR-tagged by OpenRouter" is OpenRouter's routing tag for the endpoint, not a guarantee about what that host does with the text.${record.dispositions?.length ? `\n\n## Recorded before this call, about the previous call's objections\n\n${record.dispositions.map(d => `- ${esc(d.id)}: ${d.decision}. ${esc(d.reason)}`).join('\n')}` : ''}${a.stopped_by ? `\n\nThis call stopped short: ${a.stopped_by}.` : ''}` : '';
  return `${renderAdvice(a)}\n---\n\n## Every seat's blind answer\n\n${blind}${rounds ? `\n\n## The debate\n\n${rounds}` : ''}${where}\n`;
}

/** The plan of calls: one entry per seat per sample. A sample past the first gets its own lab suffix. */
export function planAdvice(config) {
  const opt = { ...ADVISE_DEFAULTS, ...(config.advise || {}) };
  const entries = [];
  for (const seat of config.seats.critics || []) {
    const base = seat.lab || seat.provider;
    for (let k = 1; k <= opt.samples; k++) entries.push({ base, lab: k === 1 ? base : `${base}-s${k}`, seat: k === 1 ? seat : { ...seat, lab: `${base}-s${k}` } });
  }
  return { opt, entries };
}

export async function runAdvise(config, deps) {
  const { request, invoke, record, parseJson, rethrowControlFlow, settleAll, capField, abstentionReasonCode, cutOffRetryCap, askedCapOf, BudgetExceeded, defaultMaxTokens, runSpent, runRemaining = () => Infinity, shouldStop = () => null, log = () => {}, snap = null, partialDefaults = () => ({}) } = deps;
  const { opt, entries } = planAdvice(config);
  // chain-lint refuses these configs; a library caller of runChain skips lint, so they are checked
  // here too, before any call is made.
  if (!(typeof opt.usd === 'number' && Number.isFinite(opt.usd) && opt.usd > 0)) throw new Error('advise.usd (the call\'s own dollar ceiling) must be a positive number.');
  if (!entries.length) throw new Error('an advise chain needs at least one seat in seats.critics.');
  if (opt.synthesis === 'seat' && !(config.seats.builder && typeof config.seats.builder === 'object' && !Array.isArray(config.seats.builder))) throw new Error('advise.synthesis is "seat" but seats.builder is not set.');
  const brief = request;
  const stages = deps.stages;
  const start = runSpent();
  const spentNow = () => Math.max(0, runSpent() - start);
  // The stage's own ceiling, kept as a ledger of dollars either spent or reserved at their worst
  // case, so it holds for calls in flight and for retries too (one synchronous step, no await,
  // between the check and the reservation). `settle` swaps a reservation for what the call cost.
  let committed = 0;
  // Returns null when it fits, else why it does not: 'own_cap' (advise.usd) or 'run_cap' (what is left of the
  // run's --max-usd, which invoke() would otherwise enforce by aborting the whole call).
  const reserve = amount => {
    const why = committed + amount > opt.usd ? 'own_cap' : amount > runRemaining() ? 'run_cap' : null;
    if (!why) committed += amount;
    return why;
  };
  // A call that throws is never settled: its reservation stays, which errs toward skipping an optional
  // stage rather than passing the ceiling (its real cost is not known to this stage).
  const settle = (reserved, actual) => { committed += actual - reserved; };
  // A stop asked for from outside (a client's cancel, the chain's wall-clock ceiling) is read through
  // shouldStop() before every PAID step and latched, so the first reason stays the reason. Calls already in
  // flight finish and are recorded (they are billed either way); nothing new is started. Brief 29.
  let stopReason = null;
  const halted = () => { if (!stopReason) stopReason = shouldStop() || null; return stopReason; };
  const opinions = [];
  const dropouts = [];
  const rounds = [];
  const state = { status: 'running', usd_cap: opt.usd, stopped: null };
  if (snap) snap.fn = () => ({ ...partialDefaults(), criteria: config.criteria || [], stages, totals: summarise(stages), dropouts, advise: { ...state, opinions, dropouts, rounds } });

  const blindSystem = R.ADVISOR_SYSTEM;
  const blindUser = R.advisorUser({ request: brief });
  const askCap = e => e.seat.maxTokens ?? defaultMaxTokens;

  // 1. Blind opinions: all-or-nothing against the call's own ceiling, checked before anything is called.
  const projected = entries.reduce((n, e) => n + projectStage(e.seat, { system: blindSystem, user: blindUser }), 0);
  if (halted()) throw new AdviceStopped(stopReason);
  if (projected > opt.usd) throw new AdviceRefused({ projected, cap: opt.usd, seats: entries.length, tier: config.name });
  // Audit A1-2 (0.8.1): the all-or-nothing rule holds against the RUN's own cap too (--max-usd): a blind wave that would pass what is left of it is stopped before any seat is
  // called, as a spend-cap stop (nothing spent), not paid in part and aborted with the answers thrown away.
  if (projected > runRemaining()) throw new BudgetExceeded({ label: 'advice (blind wave)', seat: `${entries.length} advice seat${entries.length === 1 ? '' : 's'}`, spent: runSpent(), cap: runSpent() + Math.max(0, runRemaining()), projected });
  reserve(projected);
  log(`\nStage: advice (${entries.length} call${entries.length === 1 ? '' : 's'} from ${new Set(entries.map(e => e.base)).size} lab${new Set(entries.map(e => e.base)).size === 1 ? '' : 's'}, blind; worst case ${formatUsd(projected)} of ${formatUsd(opt.usd)})`);
  const results = await settleAll(entries.map(async e => {
    const lines = []; const say = m => lines.push(m);
    const ask = (label, cap) => invoke({ ...e.seat, maxTokens: cap }, { system: blindSystem, user: blindUser, log: say, label });
    const worstAt = cap => projectStage({ ...e.seat, maxTokens: cap }, { system: blindSystem, user: blindUser });
    let cap = askCap(e);
    let op = null, st = null, failure = null, failureCode = 'PROVIDER_ERROR';
    try {
      st = record(await ask(`advise-${e.lab}`, cap));
      settle(worstAt(cap), st.usd || 0);
      op = readOpinion(parseJson(st.text), brief, capField);
      if (!op) {
        // Audit A1-3 (0.8.1): start from the cap the reply was really asked at (an Anthropic seat's invoke() may already have retried at a bigger one) and skip the retry
        // when there is no room, as the five other cut-off retries do: it would repeat the same paid call. The ceiling is ADVICE_RETRY_MAX_TOKENS, NOT the model's
        // own maximum: the advice prices (advise.usd) were derived with a 64,000-token retry, and 72,000 would put Sol's first call plus its retry above the $1.32 ceiling.
        const asked = askedCapOf(st, cap);
        const cut = abstentionReasonCode(st.usage || {}, asked) === 'REPLY_TRUNCATED';
        const retryCap = cut ? cutOffRetryCap(asked, ADVICE_RETRY_MAX_TOKENS) : cap;
        // The retry is a second paid call: it is reserved against the ceiling like any other, and
        // skipped (the seat becomes a dropout) when the ceiling has no room for it.
        const noRoom = halted() ? 'stopped' : (cut && retryCap <= asked) ? 'no_room' : reserve(worstAt(retryCap));
        if (noRoom) {
          failure = noRoom === 'no_room' ? `reply cut off at ${asked} tokens, already the largest retry cap (${ADVICE_RETRY_MAX_TOKENS})`
            : `${cut ? 'reply cut off at its cap' : 'unreadable reply'}, and the retry would ${noRoom === 'stopped' ? `not start (stopped: ${stopReason})` : `pass ${noRoom === 'run_cap' ? "the run's spend cap (--max-usd)" : "this call's own ceiling"}`}`;
          failureCode = noRoom === 'run_cap' ? 'RUN_CAP' : noRoom === 'stopped' ? 'STOPPED' : noRoom === 'no_room' ? 'REPLY_TRUNCATED' : 'OWN_CEILING';
          say(`  ${e.lab}: ${failure}; not retried.`);
        } else {
          cap = retryCap;
          st = record(await ask(`advise-${e.lab}-retry`, cap));
          settle(worstAt(cap), st.usd || 0);
          op = readOpinion(parseJson(st.text), brief, capField);
          say(`  ${e.lab}: ${cut ? 'reply cut off at its cap' : 'unreadable reply'}; retried once - ${op ? 'recovered' : 'still nothing'}.`);
        }
      }
    } catch (err) {
      rethrowControlFlow(err);
      failure = `no reply (${String(err.message).slice(0, 100)})`;
      say(`  ${e.lab}/${e.seat.model}: ${failure}.`);
    }
    if (op) say(`  ${e.lab}/${e.seat.model}: ${op.verdict} (${op.confidence})`);
    return { e, op, lines, failure, failureCode, reason: op ? null : failure || abstentionReasonCode(st?.usage || {}, askedCapOf(st, cap)) };
  }));
  for (const { e, op, lines, failure, failureCode, reason } of results) {
    lines.forEach(m => log(m));
    if (op) opinions.push({ lab: e.lab, model: e.seat.model, first: op, final: { ...op } });
    else dropouts.push({ lab: e.lab, model: e.seat.model, stage: 'advise', reason: failure || (reason === 'REPLY_TRUNCATED' ? 'reply cut off at the token cap, twice' : 'no readable opinion after a retry'), reason_code: failure ? failureCode : reason });
  }
  // A stop asked for while the wave ran wins over "no readable opinion" (M6 review D1): a seat whose retry the stop skipped, or a call
  // the wall clock cut off, is a dropout because of the stop, so the run ends stopped (exit 18), not failed (exit 16).
  if (!opinions.length && halted()) throw new AdviceStopped(stopReason, { beforeFirstCall: false, out: { advise: null, deliverable: null, dropouts } });
  if (!opinions.length) throw new Error(`advice failed: none of the ${entries.length} seat(s) returned a readable opinion (${dropouts.map(d => `${d.lab}: ${d.reason}`).join('; ')}). Nothing was decided; calls already made are recorded in the run folder. Ask again with a new quote.`);
  if (dropouts.length) log(`  !! ${dropouts.length} of ${entries.length} seat(s) gave no usable opinion: ${dropouts.map(d => d.lab).join(', ')}`);
  // A stop asked for during the blind wave (0.8.1 M6): the wave has settled and every paid answer is recorded above; nothing more
  // is started. Latched here so the debate and the synthesis below are skipped and the run ends as stopped (exit 18).
  if (halted()) log(`\nStopped after the blind answers (${stopReason}): no debate, no synthesis. The leaning is rolled up from what was paid for.`);

  // 2. The debate: each seat reads the others' positions once per round, anonymised and uncounted.
  let stopped = null;
  for (let r = 1; r <= opt.rounds; r++) {
    if (stopReason) { stopped = stopReason; break; } // stopped during the blind wave (logged there)
    if (opinions.length < 2) { stopped = 'too_few_seats'; break; }
    if (opt.skipDebateWhenUnanimous && new Set(opinions.map(o => o.final.verdict)).size === 1) { stopped = 'unanimous'; log(`\nDebate ${r === 1 ? 'skipped' : `stopped before round ${r}`}: every answer agrees, so there is nothing to argue.`); break; }
    if (halted()) { stopped = stopReason; log(`\nDebate ${r === 1 ? 'skipped' : `stopped before round ${r}`}: stopped (${stopReason}). The leaning is rolled up from what the seats have said.`); break; }
    const prompts = opinions.map(o => ({ o, system: R.ADVISOR_DEBATE_SYSTEM, user: R.advisorDebateUser({ request: brief, own: o.final, others: opinions.filter(x => x !== o).map(x => x.final) }) }));
    const seatOf = lab => entries.find(e => e.lab === lab).seat;
    const worst = prompts.reduce((n, p) => n + projectStage(seatOf(p.o.lab), p), 0);
    const noRoom = reserve(worst);
    if (noRoom) {
      stopped = noRoom;
      log(`\nDebate round ${r} skipped: the round could cost up to ${formatUsd(worst)} and ${noRoom === 'run_cap' ? "the run's spend cap has less left" : `${formatUsd(committed)} of this call's ${formatUsd(opt.usd)} ceiling is spent or reserved`}. The leaning is rolled up from what the seats have said.`);
      break;
    }
    log(`\nStage: advice debate, round ${r} (${prompts.length} seats read the others' positions, anonymised, no count)`);
    const got = await settleAll(prompts.map(async p => {
      const lines = []; const say = m => lines.push(m);
      try {
        const st = record(await invoke(seatOf(p.o.lab), { system: p.system, user: p.user, log: say, label: `advise-debate-${r}-${p.o.lab}` }));
        settle(projectStage(seatOf(p.o.lab), p), st.usd || 0);
        return { p, lines, reply: applyDebateReply(p.o.final, parseJson(st.text), opinions.filter(x => x !== p.o).map(x => x.final), capField, brief) };
      } catch (err) {
        rethrowControlFlow(err);
        say(`  ${p.o.lab}: no debate reply (${String(err.message).slice(0, 100)}); its position stands.`);
        return { p, lines, reply: { unreadable: true } };
      }
    }));
    // Replies were written blind to each other, so they are applied together after all are in.
    const round = { round: r, replies: [], changes: 0 };
    for (const { p, lines, reply } of got) {
      lines.forEach(m => log(m));
      round.replies.push({ lab: p.o.lab, ...reply });
      if (reply.unreadable) { log(`  ${p.o.lab}: unreadable debate reply; its position stands.`); continue; }
      // A change that quoted nothing is not recorded: the seat keeps its whole first position, its
      // words included (the offered text stays in the round's record, not in the seat's answer).
      const accepted = !reply.changed || reply.argued;
      log(`  ${p.o.lab}: ${reply.changed ? (reply.argued ? `${reply.from} -> ${reply.to} (quoted the argument)` : `offered ${reply.from} -> ${reply.to} with no quoted argument; ${reply.from} stands`) : `kept ${reply.from}`}`);
      p.o.next = accepted ? { verdict: reply.to, confidence: reply.confidence, answer: reply.answer, would_change_if: reply.would_change_if, risks: p.o.final.risks, missing_from_brief: p.o.final.missing_from_brief } : p.o.final;
      if (reply.changed && reply.argued) round.changes++;
    }
    for (const o of opinions) if (o.next) { o.final = o.next; delete o.next; }
    rounds.push(round);
    if (round.changes === 0) { stopped = 'stall'; log(`  round ${r} moved no answer: the debate stops here (the stall rule).`); break; }
  }
  if (!stopped && opt.rounds > 0 && rounds.length === opt.rounds) stopped = 'round_cap';

  // 3. Roll-up, then the optional synthesis. The dissent below is the engine's, from the seats' own fields.
  const roll = rollUp(opinions);
  let headline = roll.verdict, headlineSource = 'roll_up', verdictText = null, nextStep = '', synthesis = { seat: null, flag: null };
  if (opt.synthesis === 'seat') {
    const seat = config.seats.builder;
    const sys = R.ADVISE_SYNTHESIS_SYSTEM;
    const user = R.adviseSynthesisUser({ request: brief, opinions: opinions.map(o => o.final) });
    const worst = projectStage(seat, { system: sys, user });
    synthesis.seat = `${seat.lab || seat.provider}/${seat.model}`;
    const noRoom = halted() ? 'stopped' : reserve(worst);
    if (noRoom) {
      synthesis.flag = noRoom === 'stopped' ? `skipped_${stopReason}` : `skipped_${noRoom}`;
      log(`\nSynthesis skipped: ${noRoom === 'stopped' ? `stopped (${stopReason})` : `it could cost up to ${formatUsd(worst)} and ${noRoom === 'run_cap' ? "the run's spend cap has less left" : `only ${formatUsd(Math.max(0, opt.usd - committed))} of this call's ceiling is left`}`}. The verdict is rolled up by the harness.`);
    } else {
      log(`\nStage: advice synthesis (${synthesis.seat}, not on the panel)`);
      try {
        const st = record(await invoke(seat, { system: sys, user, log, label: 'advise-synthesis' }));
        settle(worst, st.usd || 0);
        const parsed = parseJson(st.text);
        const said = String(parsed?.headline_verdict || '').toLowerCase().trim();
        const held = new Set([...opinions.map(o => o.final.verdict), 'split']);
        if (!parsed || typeof parsed.verdict_text !== 'string' || !parsed.verdict_text.trim()) synthesis.flag = 'unreadable';
        else if (!held.has(said) || (said === 'split' && roll.agreement === 'unanimous')) synthesis.flag = 'verdict_not_held_by_any_seat';
        else { headline = said; headlineSource = 'synthesis'; verdictText = capField(parsed.verdict_text); nextStep = typeof parsed.next_step === 'string' ? capField(parsed.next_step) : ''; }
        if (synthesis.flag) log(`  !! synthesis ${synthesis.flag}: the harness's roll-up stands (${roll.verdict}).`);
      } catch (err) {
        rethrowControlFlow(err);
        synthesis.flag = 'no_reply';
        log(`  !! synthesis gave no reply (${String(err.message).slice(0, 100)}): the harness's roll-up stands (${roll.verdict}).`);
      }
    }
  }
  if (verdictText === null) {
    // No synthesis (or it failed): the verdict text is the answer of the most confident seat that
    // holds the headline, named as such. A split has no single answer; the positions carry it.
    const holders = opinions.filter(o => o.final.verdict === headline).sort((a, b) => rank(b.final.confidence) - rank(a.final.confidence));
    verdictText = headline === 'split'
      ? `The seats did not converge: ${Object.entries(roll.tally).map(([v, n]) => `${n} ${v.replace('_', ' ')}`).join(', ')}. Read the positions below before acting; the harness does not pick one.`
      : opinions.length === 1 ? holders[0].final.answer : `${holders[0].final.answer} (answer of ${holders[0].lab}, the most confident of the ${holders.length} seat${holders.length === 1 ? '' : 's'} holding this verdict)`;
  }
  const holdersOfHeadline = opinions.filter(o => o.final.verdict === headline);
  const confidence = headline === 'split' || !holdersOfHeadline.length ? null : holdersOfHeadline.map(o => o.final.confidence).sort((a, b) => rank(a) - rank(b))[0];
  const dissenters = opinions.filter(o => o.final.verdict !== headline);
  const missing = [...new Set(opinions.flatMap(o => o.first.missing_from_brief))];

  const advise = {
    status: 'answered',
    tier: config.name,
    verdict: headline, headline_source: headlineSource, agreement: roll.agreement, tally: roll.tally, confidence,
    verdict_text: verdictText, next_step: nextStep,
    synthesis,
    seats_asked: entries.length, seats_answered: opinions.length,
    opinions: opinions.map(o => ({ lab: o.lab, model: o.model, first: o.first, final: o.final })),
    debate: { rounds_planned: opt.rounds, rounds_run: rounds.length, stopped, rounds },
    dissent: (headline === 'split' ? opinions : dissenters).map(heldBy),
    missing_from_brief: missing,
    dropouts, usd_cap: opt.usd, spent: spentNow(),
    // Why the call stopped short of its plan, when it did: client_cancel, wall_clock (brief 29), own_cap or run_cap.
    ...(() => { const why = stopReason || (['own_cap', 'run_cap'].includes(stopped) ? stopped : /^skipped_(own_cap|run_cap)$/.test(synthesis.flag || '') ? synthesis.flag.slice(8) : null); return why ? { stopped_by: why } : {}; })(),
  };
  // A stop seen at any check after the first paid call, or asked for during the last wave (checked once more here, after it
  // settled), ends the run as stopped (0.8.1 M6): the roll-up above is what was paid for.
  if (halted()) {
    const stoppedAdvise = { ...advise, status: 'stopped' };
    throw new AdviceStopped(stopReason, { beforeFirstCall: false, out: { advise: stoppedAdvise, deliverable: renderAdvice(stoppedAdvise), dropouts } });
  }
  return { advise, deliverable: renderAdvice(advise), dropouts };
}
