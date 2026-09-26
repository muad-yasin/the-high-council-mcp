import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isFreeProvider } from './providers.js';

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
  if (!asOf) return ['Prices: src/pricing.json carries no as-of date.', 'WARNING: the price table has no date, so its age is unknown. Check each lab\'s pricing page before trusting this estimate or the spend cap.'];
  const age = days < 0 ? 'dated in the future' : days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`;
  const lines = [`Prices: src/pricing.json as of ${asOf} (${age}). List prices change; treat every figure as an estimate.`];
  if (stale) lines.push(`WARNING: the price table is ${days} days old (more than ${PRICE_TABLE_STALE_DAYS}). Estimates and the spend cap project with these prices, so they may be off. Update the-high-council, or check each lab's pricing page.`);
  return lines;
}

export function priceOf(provider, model) {
  if (isFreeProvider(provider)) return { in: 0, out: 0 };
  return PRICES[`${provider}/${model}`] || null;
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
export function estimateChainRows(config, { fromRun = false } = {}) {
  const a = config.estimate || { promptTokens: 4000, draftTokens: 6000, critiqueTokens: 1200 };
  const rows = [];
  const push = (label, seat, input, output) => {
    if (!seat) return;
    const p = seat.provider === 'external' ? { in: 0, out: 0 } : priceOf(seat.provider, seat.model);
    const usd = p ? (input / 1e6) * p.in + (output / 1e6) * p.out : 0;
    rows.push({ label, seat: `${seat.provider}/${seat.model}`, input, output, usd, priced: !!p });
  };
  // Pre-release audit 2026-09-23 (lint #3): the optional stages below were paid at run time but
  // never priced here, so `--dry-run` and `council doctor` under-stated a chain that enabled them.
  // Seat choice and gating mirror chain.js exactly (same fallbacks), so the rows appear only when
  // the run would really make those calls. `descending` chains run a different stage shape and are
  // still priced as a normal chain - a known gap, not closed here.
  const lab = seat => seat.lab || seat.provider;
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
    const seats = config.seats.proposers || config.seats.critics || [];
    const capOf = seat => { const own = seat.maxTokens ?? SEAT_DEFAULT_MAX_TOKENS; return config.alternatives.maxTokens ? Math.min(own, config.alternatives.maxTokens) : own; };
    for (const seat of seats) push(`alternative-${seat.lab || seat.provider}`, seat, a.promptTokens + 400, capOf(seat));
    // What the NEXT stages read is the board, not the seat's whole output budget (which includes
    // thinking): runChain keeps four text fields per architecture, each capped at 2000 characters
    // (capField), so an architecture adds at most ~2000 tokens to the board however big its cap.
    const ALT_BOARD_TOKENS = 2000;
    alternativeTokens = seats.reduce((n, seat) => n + Math.min(capOf(seat), ALT_BOARD_TOKENS), 0);
    if (seats.length > 1) {
      for (const seat of seats) {
        push(`alt-debate-${seat.lab || seat.provider}`, seat, a.promptTokens + 1600 + alternativeTokens, 1500);
        push(`alt-reply-${seat.lab || seat.provider}`, seat, a.promptTokens + 3000, 800);
      }
      alternativeTokens += alternativeTokens; // the board roughly doubles what the next stages read
    }
  }
  let proposalTokens = 0;
  if (config.proposals && !fromRun) {
    const parts = config.proposals.parts ?? 3, per = config.proposals.maxTokens ?? 1500;
    push('skeleton', config.seats.skeleton || config.seats.builder, a.promptTokens + 400 + alternativeTokens, 1200);
    const samples = config.proposals.samples ?? 1, keep = config.proposals.keep ?? parts;
    for (const seat of config.seats.proposers || config.seats.critics) {
      for (let k = 0; k < samples; k++) push(`propose-${seat.lab || seat.provider}${samples > 1 ? `-${k + 1}` : ''}`, seat, a.promptTokens + 1600, parts * per);
      if (samples > 1) push(`judge-${seat.lab || seat.provider}`, config.seats.judge || seat, a.promptTokens + 1600 + samples * parts * per, 300);
      proposalTokens += (samples > 1 ? keep : parts) * per;
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
  const unanimous = config.signoff === 'unanimous';
  for (let r = 1; r <= config.maxRounds; r++) {
    if (unanimous) {
      for (const critic of config.seats.critics) {
        push(`panel-${r}-${critic.lab || critic.provider}`, critic, a.promptTokens + a.draftTokens, a.critiqueTokens);
      }
    } else {
      const critic = config.seats.critics[(r - 1) % config.seats.critics.length];
      push(`critique-${r}`, critic, a.promptTokens + a.draftTokens, a.critiqueTokens);
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
      for (const critic of critics) push(`dispute-review-${critic.lab || critic.provider}`, critic, a.promptTokens + 2 * a.draftTokens + a.critiqueTokens, a.critiqueTokens);
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
 * `retries` covers the thinking-disabled retry in chain.js invoke(), which
 * can pay for the same stage twice.
 */
export function worstCaseOf(provider, model, { promptChars = 0, maxTokens = 8000, retries = 1 } = {}) {
  const p = priceOf(provider, model);
  if (!p) return { usd: 0, priced: false };
  const input = Math.ceil(promptChars / CHARS_PER_TOKEN);
  const usd = ((input / 1e6) * p.in + (maxTokens / 1e6) * p.out) * retries;
  return { usd, priced: true };
}

/**
 * Would running this stage risk breaching the ceiling? Pure, so it is
 * testable without a provider.
 *
 * `cap` of null means no ceiling and always returns ok.
 */
export function wouldBreach({ spent, cap, projected }) {
  if (cap === null || cap === undefined) return { breach: false };
  const after = spent + projected;
  return { breach: after > cap, after, remaining: Math.max(0, cap - spent) };
}
