import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isFreeProvider } from './providers.js';
import * as R from './roles.js';
import { retryCapFor, retryCeilingOf } from './reasoning.js';

// A seat's default maxTokens when its config sets none. Defined here (not in chain.js, which
// re-exports it as DEFAULT_MAX_TOKENS) because chain.js imports this module, so the dry-run can
// price a stage at the same cap runChain uses without a circular import.
export const SEAT_DEFAULT_MAX_TOKENS = 36000;
import { DEFAULT_SECURITY_REVIEWER_SEAT, SECURITY_REVIEW_LABEL } from './security-review.js';

const here = dirname(fileURLToPath(import.meta.url));
const PRICES = JSON.parse(readFileSync(join(here, 'pricing.json'), 'utf8'));

// v7.1: a local-model provider (ollama) prices at exactly $0 for any model name - pricing.json
// is keyed by exact "provider/model" and cannot enumerate every locally-pulled model, so this is
// checked before the lookup rather than requiring one entry per local model. `priced: true` is
// what matters here: it is what keeps a local seat out of summarise()'s and dry_run's "unpriced"
// warning list, which otherwise reads identically to "uncapped" - a worse user experience for a
// seat that is genuinely, structurally free.
// The price table's as-of date (pricing.json `asOf`, 0.7.8): the oldest date every entry was last
// checked. `council doctor` and `--dry-run` print it, and warn once it is older than
// PRICE_TABLE_STALE_DAYS, because the spend cap is only as good as the table it projects with and
// the table is static between releases (thc-research briefs 09/11: the dry-run never said how old
// its prices were). `now` is injectable for tests. Returns null fields when the table has no date.
export const PRICE_TABLE_STALE_DAYS = 60;
export function priceTableAge(now = new Date(), table = PRICES) {
  const asOf = typeof table?.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(table.asOf) ? table.asOf : null;
  if (!asOf) return { asOf: null, days: null, stale: true };
  const days = Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Date.parse(`${asOf}T00:00:00Z`)) / 86_400_000);
  return { asOf, days, stale: days > PRICE_TABLE_STALE_DAYS };
}

// The lines doctor and --dry-run print: one always, a WARNING line too when the table is stale.
export function priceTableLines(now = new Date(), table = PRICES) {
  const { asOf, days, stale } = priceTableAge(now, table);
  // Computed first, so a table with no as-of date still warns about its expired rows (M7 review).
  const expired = expiredPriceRows(now.getTime(), table).map(r => (r.malformed ? `WARNING: price row ${r.key} has an expiry date that cannot be read (${JSON.stringify(r.expires)}); its price is used as written. Check it.` : `WARNING: price row ${r.key} expired on ${r.expires} (a promotional or announced price change); what it bills now may be higher than this projects, and the spend cap projects with the old price. Update the-high-council.`));
  if (!asOf) return ['Prices: src/pricing.json carries no as-of date.', 'WARNING: the price table has no date, so its age is unknown. Check each lab\'s pricing page before trusting this estimate or the spend cap.', ...expired];
  const age = days < 0 ? 'dated in the future' : days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`;
  const lines = [`Prices: src/pricing.json as of ${asOf} (${age}). List prices change; treat every figure as an estimate.`];
  if (stale) lines.push(`WARNING: the price table is ${days} days old (more than ${PRICE_TABLE_STALE_DAYS}). Estimates and the spend cap project with these prices, so they may be off. Update the-high-council, or check each lab's pricing page.`);
  return [...lines, ...expired];
}

/**
 * Price rows past their `expires` date (0.8.1 plan M7, P13): [{ key, expires, malformed? }]. A row may carry "expires": "YYYY-MM-DD"
 * when its price is known to change (a promotional price, an announced rise). priceOf keeps using the row's price after the date: a
 * silent switch would change quoted prices with no release, and "at least through" a date is not an end date. The release test
 * fails on an expired row (test/pricing-expiry.test.js) and the dry run and `council doctor` print a warning instead. An expiry that
 * is not a date is reported as malformed, never skipped.
 */
export function expiredPriceRows(now = Date.now(), table = PRICES) {
  const out = [];
  for (const [key, row] of Object.entries(table || {})) {
    if (!row || typeof row !== 'object' || !('expires' in row)) continue;
    // A real calendar date: "2026-02-30" parses (rolled over to March) but is not one, so it must round-trip (M7 review).
    const t = typeof row.expires === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.expires) ? Date.parse(`${row.expires}T00:00:00Z`) : NaN;
    const ok = Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === row.expires;
    if (!ok) out.push({ key, expires: row.expires, malformed: true });
    else if (now >= Date.parse(`${row.expires}T00:00:00Z`)) out.push({ key, expires: row.expires });
  }
  return out;
}

export function priceOf(provider, model) {
  if (isFreeProvider(provider)) return { in: 0, out: 0 };
  return PRICES[`${provider}/${model}`] || null;
}

/**
 * Does a call to this seat need a price row before a spend cap can hold it (0.8.2 item 8a; ChatGPT review 1 #4a; owner 7 Oct 2026)? An unpriced seat projects $0, so a cap cannot see it: under a cap the harness
 * refuses it. Exempt by construction: `mock` (the offline chains run free under any ceiling; mock-priced and mock-budget carry fixture prices), `external` (a person or another session answers; nothing is billed)
 * and a free local provider (ollama), which priceOf already prices at an explicit $0.
 */
export const needsPrice = seat => !!seat && seat.provider !== 'mock' && seat.provider !== 'external' && !priceOf(seat.provider, seat.model);

// Security scan 2026-09-26 (THC #3): a provider's usage numbers went straight into costOf() and
// the spend cap. A NaN, a negative count or a string there made the stage's cost NaN or negative,
// and `spent + NaN` is NaN, which no ceiling comparison ever breaches: one odd reply switched the cap
// off. readUsage() accepts a token count only as a finite number >= 0 (a plain digit string is read
// as its number). Anything else, or no usage at all, is reported as unreadable, with every count
// zeroed so the stage record and the log stay sane; invoke() then charges the stage's projected
// worst case instead of a measured cost.
function tokenCount(v) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(v) ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}
export function readUsage(usage) {
  if (!usage || typeof usage !== 'object') return { usage: { input: 0, output: 0, thinking: 0 }, unreadable: 'no usage reported' };
  const clean = { ...usage };
  delete clean.unreadable;
  const bad = [];
  for (const k of ['input', 'output', 'thinking', 'cached']) {
    const required = k === 'input' || k === 'output';
    if (!required && usage[k] == null) continue;
    const n = tokenCount(usage[k]);
    if (n === null) { bad.push(k); clean[k] = 0; } else clean[k] = n;
  }
  const why = [...(usage.unreadable ? [String(usage.unreadable)] : []), ...(bad.length ? [`unreadable ${bad.join(', ')}`] : [])];
  return { usage: clean, unreadable: why.length ? why.join('; ') : null };
}
// A dollar figure read back from disk (<label>.usage.json on replay). Absent is $0, as it always
// was (an external stage, a cache entry from before costs were recorded); present, it must be a
// finite number >= 0, else null, which the caller charges as the stage's worst case.
export function readUsd(v) {
  if (v === undefined || v === null) return 0;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

export function costOf(provider, model, usage) {
  const p = priceOf(provider, model);
  if (!p) return { usd: 0, priced: false };
  const usd = (usage.input / 1e6) * p.in + (usage.output / 1e6) * p.out;
  return { usd, priced: true };
}

export function summarise(stages) {
  let input = 0, output = 0, usd = 0;
  const unpriced = new Set();
  for (const s of stages) {
    if (!s.usage) continue;
    input += s.usage.input;
    output += s.usage.output;
    const c = costOf(s.provider, s.model, s.usage);
    // Money path #3 (Review/PreRelease_Audit_moneypath_2026-09-23.md): a stage's own `usd` is what it
    // really cost, including an Anthropic attempt thrown away when thinking ate the whole budget
    // (chain.js invoke(): usd = cost + wasted). Recomputing from the kept attempt's usage dropped
    // that attempt from report.totals.usd, the CLI's cost line, --spend and MCP.
    usd += Number.isFinite(s.usd) ? s.usd : c.usd;
    if (!c.priced) unpriced.add(`${s.provider}/${s.model}`);
  }
  return { input, output, total: input + output, usd, unpriced: [...unpriced] };
}

export function formatUsd(n) {
  return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}

// ---------------------------------------------------------------------------
// Per-chain worst-case estimate, from the config's own declared token
// assumptions. Calls nothing, so it costs nothing. This is the one place that
// walks a chain's stage shape (questions/criteria/skeleton/proposals/debate/
// panel rounds/handoff) to price it - `--dry-run` and `council doctor` both
// call this rather than each re-deriving the shape themselves.
// The typical output of one review by this seat, for the estimate only (0.7.8). The chain's flat
// estimate.critiqueTokens (5000 in plan-premium-7) was one number for every reviewer, but reasoning
// models spend most of a review thinking: premium-7's Fable seat was projected at ~$0.45 a round and
// really cost ~$1.04 (thc-research brief 08), and its GLM seat ran to its 36000 cap. Now, in order:
//   1. the seat's own `estimate.critiqueTokens`, when its chain sets one (configurable per seat);
//   2. otherwise the larger of the chain's figure and the model's measured typical review output
//      (pricing.json `critiqueTokens`, from real runs) - it can raise the chain's figure, never
//      lower it;
// and never more than the seat's review cap (panelMaxTokens, else maxTokens), which it cannot
// exceed. The spend cap does not use this: it projects the full maxTokens, as it always has.
export function critiqueTokensFor(seat, chainCritiqueTokens) {
  const cap = seat?.panelMaxTokens ?? seat?.maxTokens ?? SEAT_DEFAULT_MAX_TOKENS;
  const own = seat?.estimate?.critiqueTokens;
  if (Number.isInteger(own) && own >= 0) return Math.min(own, cap);
  const measured = seat && seat.provider !== 'external' ? priceOf(seat.provider, seat.model)?.critiqueTokens : null;
  return Math.min(Math.max(chainCritiqueTokens, Number.isInteger(measured) ? measured : 0), cap);
}

// One advisor's opinion as another seat reads it, in tokens: "answer" at most 120 words (~160
// tokens), at most 3 risks with a quote each (~3 x 60), "would_change_if" (~40) and the JSON
// around them come to about 380; rounded up to 500 so the debate and synthesis rows do not sit low.
export const ADVISE_OPINION_TOKENS = 500;

// Every call an advise chain can make, at its worst case: each seat asked (times `samples`), every
// planned debate round (skipDebateWhenUnanimous is a saving, not priced), and the synthesis. Output
// is the seat's whole maxTokens, as the run cap projects it. Labels match src/advise.js. A paid retry
// (a cut-off reply is retried once at twice the cap) is NOT a row: it is not certain to happen, and the
// advise ceiling reserves it when it does; a debate needs two seats or more, as at run time.
function adviseRows(config, a, push) {
  const opt = { rounds: 0, samples: 1, synthesis: 'none', ...config.advise };
  const lab = seat => seat.lab || seat.provider;
  const entries = (config.seats.critics || []).flatMap(seat => Array.from({ length: opt.samples }, (_, k) => ({ seat, label: k === 0 ? lab(seat) : `${lab(seat)}-s${k + 1}` })));
  const n = entries.length;
  const cap = seat => seat.maxTokens ?? SEAT_DEFAULT_MAX_TOKENS;
  for (const e of entries) push(`advise-${e.label}`, e.seat, a.promptTokens + estimateTokens(R.ADVISOR_SYSTEM), cap(e.seat));
  for (let r = 1; r <= (n >= 2 ? opt.rounds : 0); r++) {
    for (const e of entries) push(`advise-debate-${r}-${e.label}`, e.seat, a.promptTokens + estimateTokens(R.ADVISOR_DEBATE_SYSTEM) + n * ADVISE_OPINION_TOKENS, cap(e.seat));
  }
  if (opt.synthesis === 'seat') push('advise-synthesis', config.seats.builder, a.promptTokens + estimateTokens(R.ADVISE_SYNTHESIS_SYSTEM) + n * ADVISE_OPINION_TOKENS, cap(config.seats.builder));
}


// The token sizes a chain with no `estimate` block is priced at. One definition: the dry run's reprice with the task reads it too
// (0.8.1 FX-3: it spread an empty estimate instead and summed NaN).
export const DEFAULT_ESTIMATE = Object.freeze({ promptTokens: 4000, draftTokens: 6000, critiqueTokens: 1200 });

// `maximum: true` (0.8.2 item 8c; ChatGPT review 1 #5, owner 7 Oct 2026) prices the SAME planned calls at their whole output allowance instead of the typical output: each row's output is the call's own cap
// (the seat's maxTokens, its panelMaxTokens for a review, the stage's own smaller cap for proposals and architectures) and an Anthropic seat's one same-effort retry is added, as the spend cap's projection
// (projectAttempts) does. Calls the plan does not list are not in it either way: a re-ask of a refused table, the cut-off retry of a seat that is not Anthropic, an answer-back call. The cap stops those.
export function estimateChainRows(config, { fromRun = false, maximum = false } = {}) {
  // A partial estimate block is filled from the defaults (M2 review: { promptTokens } alone priced NaN).
  const a = { ...DEFAULT_ESTIMATE, ...(config.estimate || {}) };
  const reviewOut = seat => critiqueTokensFor(seat, a.critiqueTokens);
  const rows = [];
  const push = (label, seat, input, output, callCap) => {
    if (!seat) return;
    const external = seat.provider === 'external';
    const p = external ? { in: 0, out: 0 } : priceOf(seat.provider, seat.model);
    if (maximum && !external) {
      const out = callCap ?? seat.maxTokens ?? SEAT_DEFAULT_MAX_TOKENS;
      const att = p ? projectAttemptsTokens(seat, { inputTokens: input, maxTokens: out }) : { first: 0, retry: 0 };
      rows.push({ label, seat: `${seat.provider}/${seat.model}`, input, output: out, usd: att.first + att.retry, priced: !!p });
      return;
    }
    const usd = p ? (input / 1e6) * p.in + (output / 1e6) * p.out : 0;
    rows.push({ label, seat: `${seat.provider}/${seat.model}`, input, output, usd, priced: !!p });
  };
  // A review's own output cap in the UNANIMOUS panel: panelMaxTokens when the seat sets one, else its maxTokens (chain.js, the panel stage). First-mode critiques and dispute reviews call at maxTokens.
  const reviewCap = seat => seat?.panelMaxTokens ?? seat?.maxTokens ?? SEAT_DEFAULT_MAX_TOKENS;
  // Pre-release audit 2026-09-23 (lint #3): the optional stages below were paid at run time but
  // never priced here, so `--dry-run` and `council doctor` under-stated a chain that enabled them.
  // Seat choice and gating mirror chain.js exactly (same fallbacks), so the rows appear only when
  // the run would really make those calls. `descending` chains run a different stage shape and are
  // still priced as a normal chain - a known gap, not closed here.
  const lab = seat => seat.lab || seat.provider;
  // The council advisor (config.advise, src/advise.js) has its own short flow and returns before every
  // planning stage, so it is priced by itself and nothing below applies to it.
  if (config.advise?.enabled === true) { adviseRows(config, a, push); return rows; }
  if (config.ambiguity_union?.enabled && !fromRun) {
    for (const seat of config.seats.ambiguity || (config.seats.critics || []).slice(0, 3)) push(`ambiguity-${lab(seat)}`, seat, a.promptTokens, 800);
  }
  if (config.preflight && !fromRun) {
    const seats = (config.preflight.seats && config.preflight.seats.length) ? config.preflight.seats : (config.seats.critics || []);
    for (const seat of seats) push(`preflight-${lab(seat)}`, seat, a.promptTokens, 800);
  }
  if (config.questions && !fromRun) push('questions', config.seats.questions || config.seats.criteria, a.promptTokens, 800);
  // A chain with hand-written criteria skips that stage entirely.
  if (!config.criteria?.length) push('criteria', config.seats.criteria, a.promptTokens, 400);
  // Whole alternative architectures (config.alternatives.enabled): one architecture per proposer
  // lab, then the same debate + reply rounds proposals get. Its board is read by the skeleton and
  // the builder, so it is added to both inputs below. Output per alternative is the stage's own
  // token cap - the same number runChain caps each call at.
  let alternativeTokens = 0;
  if (config.alternatives?.enabled === true && !fromRun) {
    // Output per alternative is the cap runChain actually uses: the seat's own maxTokens unless
    // the chain sets alternatives.maxTokens (pre-release audit 2026-09-23, Alternatives #1).
    // Tiered councils: seats.alternatives (the anchors) write the architectures when set; with
    // alternatives.debaters "all", the proposers (the mass seats) also post on them. Same fallbacks
    // as chain.js.
    const seats = config.seats.alternatives || config.seats.proposers || config.seats.critics || [];
    const posters = [...seats];
    if (config.alternatives.debaters === 'all') for (const s of config.seats.proposers || []) if (!posters.some(p => (p.lab || p.provider) === (s.lab || s.provider))) posters.push(s);
    const capOf = seat => { const own = seat.maxTokens ?? SEAT_DEFAULT_MAX_TOKENS; return config.alternatives.maxTokens ? Math.min(own, config.alternatives.maxTokens) : own; };
    for (const seat of seats) push(`alternative-${seat.lab || seat.provider}`, seat, a.promptTokens + 400, capOf(seat), capOf(seat));
    // What the NEXT stages read is the board: since 0.8.1 (FX-11) every architecture reaches it whole, up to what its
    // seat was allowed to write, so the worst case is each seat's own output cap (it was ~2,000 tokens while the
    // fields were cut at 2,000 characters).
    alternativeTokens = seats.reduce((n, seat) => n + capOf(seat), 0);
    if (seats.length > 1) {
      for (const seat of posters) push(`alt-debate-${seat.lab || seat.provider}`, seat, a.promptTokens + 1600 + alternativeTokens, 1500);
      for (const seat of seats) push(`alt-reply-${seat.lab || seat.provider}`, seat, a.promptTokens + 3000, 800);
      alternativeTokens += alternativeTokens; // the board roughly doubles what the next stages read
    }
  }
  let proposalTokens = 0;
  if (config.proposals && !fromRun) {
    const parts = config.proposals.parts ?? 3, per = config.proposals.maxTokens ?? 1500;
    // What a proposal call can produce: chain.js asks min(seat cap, parts x per + 300) (0.8.1 FX-12; this priced
    // parts x per, unclamped, and without the 300).
    const propCap = seat => Math.min(seat.maxTokens ?? SEAT_DEFAULT_MAX_TOKENS, parts * per + 300);
    push('skeleton', config.seats.skeleton || config.seats.builder, a.promptTokens + 400 + alternativeTokens, 1200);
    const samples = config.proposals.samples ?? 1, keep = config.proposals.keep ?? parts;
    for (const seat of config.seats.proposers || config.seats.critics) {
      for (let k = 0; k < samples; k++) push(`propose-${seat.lab || seat.provider}${samples > 1 ? `-${k + 1}` : ''}`, seat, a.promptTokens + 1600, propCap(seat), propCap(seat));
      if (samples > 1) push(`judge-${seat.lab || seat.provider}`, config.seats.judge || seat, a.promptTokens + 1600 + samples * propCap(seat), 300);
      // On the board: a lab's whole proposal set (one call's output), or with samples the `keep` single proposals a judge
      // keeps (about one part each), never more than all its attempts produced.
      proposalTokens += samples > 1 ? Math.min(keep * per, samples * propCap(seat)) : propCap(seat);
    }
  }
  if (config.debate && !fromRun) {
    for (const seat of config.seats.proposers || config.seats.critics) {
      push(`debate-${seat.lab || seat.provider}`, seat, a.promptTokens + 1600 + proposalTokens, 1500);
      push(`reply-${seat.lab || seat.provider}`, seat, a.promptTokens + 3000, 800);
    }
    proposalTokens += proposalTokens; // the board roughly doubles what the builder reads
  }
  if (!fromRun) push('build', config.seats.builder, a.promptTokens + 400 + proposalTokens + alternativeTokens, a.draftTokens);
  // Tiered councils: the deep-dive seat. Each call reads the criteria, the draft and one chunk of
  // the source, and may write its whole maxTokens. The rows stop where the seat's own dollar cap
  // would stop the stage (the last row carries what is left of it), because runChain stops there
  // too; then one reviser pass over the findings. The source size is the chain's promptTokens
  // assumption (four characters a token), which --task raises for a large task.
  if (config.deep_dive?.enabled === true && config.seats.deep_dive && !fromRun) {
    const seat = config.seats.deep_dive;
    const dd = { job: 'sources', maxCalls: 24, chunkChars: 60000, ...config.deep_dive };
    const focus = Array.isArray(dd.focus) && dd.focus.length ? dd.focus.length : 1;
    const chunks = Math.max(1, Math.ceil((a.promptTokens * 4) / dd.chunkChars));
    const calls = Math.min(dd.maxCalls, focus * chunks);
    const out = seat.maxTokens ?? SEAT_DEFAULT_MAX_TOKENS;
    const inTok = Math.min(a.promptTokens, Math.ceil(dd.chunkChars / 4)) + a.draftTokens + 1000;
    const p = seat.provider === 'external' ? { in: 0, out: 0 } : priceOf(seat.provider, seat.model);
    let left = Number.isFinite(dd.usd) ? dd.usd : Infinity;
    for (let n = 1; n <= calls; n++) {
      // Audit fix cnc-money F2: BOTH passes stop where deep-dive.js stops the stage, on the projection of an attempt plus an Anthropic seat's one same-effort retry; the expected pass lists and spends
      // the first attempt only, the maximum pass lists the whole projection. (They used to stop on different figures, so the two passes planned different rows and the dry run joined them by index.)
      const att = p ? projectAttemptsTokens(seat, { inputTokens: inTok, maxTokens: out }) : null;
      const firstUsd = p ? (inTok / 1e6) * p.in + (out / 1e6) * p.out : 0;
      const projected = att ? att.first + att.retry : firstUsd;
      if (p && projected > left) break;
      const usd = maximum && att ? att.first + att.retry : firstUsd;
      rows.push({ label: `deep-dive-${seat.lab || seat.provider}-${n}`, seat: `${seat.provider}/${seat.model}`, input: inTok, output: out, usd, priced: !!p });
      left -= firstUsd;
    }
    push('deep-dive-revise', config.seats.reviser || config.seats.builder, a.promptTokens + a.draftTokens + a.critiqueTokens, a.draftTokens);
  }
  const unanimous = config.signoff === 'unanimous';
  for (let r = 1; r <= config.maxRounds; r++) {
    if (unanimous) {
      for (const critic of config.seats.critics) {
        push(`panel-${r}-${critic.lab || critic.provider}`, critic, a.promptTokens + a.draftTokens, reviewOut(critic), reviewCap(critic));
      }
    } else {
      const critic = config.seats.critics[(r - 1) % config.seats.critics.length];
      push(`critique-${r}`, critic, a.promptTokens + a.draftTokens, reviewOut(critic));
    }
    if (r < config.maxRounds) push(`revise-${r}`, config.seats.reviser || config.seats.builder, a.promptTokens + a.draftTokens + a.critiqueTokens + proposalTokens, a.draftTokens);
  }
  // Stages that can run after the panel, priced as worst cases too (pre-release audit 2026-09-23,
  // ProposalsDebateDispute #5): the figure a person approves before a paid run must not sit below
  // what the run can actually spend.
  //  - dispute: one reviser pass over the open objections (runs when the panel ends without
  //    agreement; needs unanimous sign-off, as runChain does);
  //  - dispute-review: each critic re-reads the draft before and after that pass;
  //  - canary-reply: one extra reply from the author of the probed proposal, when sampled.
  if (config.dispute?.enabled === true && unanimous) {
    const critics = config.seats.critics || [];
    push('dispute', config.seats.reviser || config.seats.builder, a.promptTokens + a.draftTokens + critics.length * a.critiqueTokens, a.draftTokens);
    if (config.dispute.review) {
      for (const critic of critics) push(`dispute-review-${critic.lab || critic.provider}`, critic, a.promptTokens + 2 * a.draftTokens + a.critiqueTokens, reviewOut(critic));
    }
  }
  if (config.canary?.enabled && config.debate && !fromRun) {
    const author = (config.seats.proposers || config.seats.critics || [])[0];
    push(`canary-reply-${author ? (author.lab || author.provider) : 'author'}`, author, a.promptTokens + 3000, 800);
  }
  if (config.claims?.enabled) push('claims', config.seats.claims || config.seats.reviser || config.seats.builder, a.promptTokens + a.draftTokens, a.critiqueTokens);
  if (config.challenge?.enabled === true) {
    push('challenge', config.seats.challenger || (config.seats.critics || [])[0], a.promptTokens + a.draftTokens, a.critiqueTokens);
    // Worst case: the challenge lands and the reviser answers it once.
    push('challenge-revise', config.seats.reviser || config.seats.builder, a.promptTokens + a.draftTokens + a.critiqueTokens, a.draftTokens);
  }
  if (config.coldRead?.enabled === true) push('cold-read', config.seats.coldRead, a.draftTokens, a.critiqueTokens);
  push('final', config.seats.finalist, a.promptTokens + a.draftTokens, a.draftTokens);
  if (config.handoff) push('handoff', config.seats.handoff || config.seats.builder, a.promptTokens + a.draftTokens, 1200);
  // "How this plan was argued" (src/argued.js): the request, the final plan and a fact pack about
  // the size of one critique round's worth of posts, out as a short section (under 700 words). $0 on
  // an external handoff seat, like the handoff row above; priced when that seat is billed.
  if (config.argued?.enabled === true && !config.descending) push('argued', config.seats.handoff || config.seats.builder, a.promptTokens + a.draftTokens + a.critiqueTokens, 1500);
  // The final security review reads the request plus the finished draft (promptTokens +
  // draftTokens, same input as a panel critique) and replies with a findings list, which is
  // critique-shaped output - so it uses the chain's own critiqueTokens assumption, not a new number.
  if (config.security_review?.enabled === true) push(SECURITY_REVIEW_LABEL, config.seats.security_reviewer || DEFAULT_SECURITY_REVIEWER_SEAT, a.promptTokens + a.draftTokens, a.critiqueTokens);
  return rows;
}

// ---------------------------------------------------------------------------
// Per-run spend cap.
//
// costOf() above is measurement: what a stage cost once it had already been
// paid for. A cap that only measures is not a cap, so enforcement needs a
// number BEFORE the call goes out - hence a worst case rather than an actual.
//
// Worst case for one stage is: every prompt character billed as input, plus
// the seat's entire maxTokens budget billed as output. A stage essentially
// never spends its whole output budget, so this over-estimates on purpose - a
// cap that occasionally stops a run slightly early is a working cap, and one
// that lets a run slip past the ceiling is not.

// Characters per token. Real tokenisers vary by model and language; 4 is the
// usual English rule of thumb and errs low (i.e. estimates MORE tokens) on
// the code and JSON these prompts are full of.
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text) {
  return Math.ceil((text || '').length / CHARS_PER_TOKEN);
}

/**
 * The most this stage could cost. Returns 0 for a seat with no price entry -
 * an unpriced model cannot be accounted for, so it cannot be capped either
 * (this is why the $0 mock chains run freely under any ceiling).
 *
 * `retries` multiplies the whole figure (kept for callers that project N identical attempts). `retryMaxTokens` adds ONE more attempt
 * with its own, larger output cap: the Anthropic thinking retry in chain.js invoke() (0.8.1 milestone R) retries at the SAME effort
 * with a bigger cap, so its worst case is the first attempt plus a bigger second one, not twice the first.
 */
export function worstCaseOf(provider, model, { promptChars = 0, maxTokens = 8000, retries = 1, retryMaxTokens = null } = {}) {
  const p = priceOf(provider, model);
  if (!p) return { usd: 0, priced: false };
  const input = Math.ceil(promptChars / CHARS_PER_TOKEN);
  const attempt = out => (input / 1e6) * p.in + (out / 1e6) * p.out;
  const usd = attempt(maxTokens) * retries + (retryMaxTokens ? attempt(retryMaxTokens) : 0);
  return { usd, priced: true };
}

/**
 * The worst case of each attempt of one call, exactly as invoke() projects it before sending: the whole prompt as input and the
 * seat's whole maxTokens as output; an Anthropic seat gets a second, bigger attempt when its cap has room to grow (the same-effort
 * retry after thinking used the whole cap: retryCapFor, the model's ceiling). { first, retry } in dollars; retry is 0 when there is none.
 */
// The one predicate for "this seat's call may be repeated once at a bigger cap" (invoke() and projectAttempts use it; so does the add-on's calls_at_most): the seat's real identity
// is Anthropic, whichever transport carries it.
export const isAnthropicSeat = seat => (seat?.originalProvider ?? seat?.provider) === 'anthropic';

export function projectAttempts(seat, { system = '', user = '' } = {}) {
  const promptChars = (system || '').length + (user || '').length;
  return projectAttemptsTokens(seat, { inputTokens: Math.ceil(promptChars / CHARS_PER_TOKEN), maxTokens: seat.maxTokens ?? SEAT_DEFAULT_MAX_TOKENS });
}

// The same two attempts from a token count instead of a prompt: the dry run's "maximum" (estimateChainRows, maximum: true) prices each planned call exactly as the cap would project it. `maxTokens` is the call's own output cap.
export function projectAttemptsTokens(seat, { inputTokens = 0, maxTokens = SEAT_DEFAULT_MAX_TOKENS } = {}) {
  const promptChars = inputTokens * CHARS_PER_TOKEN;
  const first = worstCaseOf(seat.provider, seat.model, { promptChars, maxTokens }).usd;
  if (!isAnthropicSeat(seat)) return { first, retry: 0 };
  const retryCap = retryCapFor(maxTokens, retryCeilingOf(seat));
  if (retryCap <= maxTokens) return { first, retry: 0 };
  return { first, retry: worstCaseOf(seat.provider, seat.model, { promptChars, maxTokens: retryCap }).usd };
}

/**
 * The worst case of one call, exactly as invoke() projects it before sending: both attempts of projectAttempts. Shared so a stage
 * with its own ceiling inside the run's (the deep-dive seat) projects the same number the run cap does.
 */
export function projectStage(seat, opts = {}) {
  const { first, retry } = projectAttempts(seat, opts);
  return first + retry;
}

/**
 * Would running this stage risk breaching the ceiling? Pure, so it is
 * testable without a provider.
 *
 * `cap` of null means no ceiling and always returns ok.
 */
export function wouldBreach({ spent, cap, projected }) {
  if (cap === null || cap === undefined) return { breach: false };
  // Audit A1-5: a cap that is not a finite number above zero fails closed (comparisons with NaN are all false, which used to read as "fits").
  if (!(typeof cap === 'number' && Number.isFinite(cap) && cap > 0)) return { breach: true, after: spent + projected, remaining: 0 };
  const after = spent + projected;
  return { breach: after > cap, after, remaining: Math.max(0, cap - spent) };
}
