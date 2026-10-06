// The checks every send passes before anyone is asked to approve it (0.8.1 plan DR-5), moved out of the
// council_quote handler with their order and wording unchanged. Twelve, in this order, the first that fails wins:
//
//    1 brief_invalid         the brief's own rules (size, invisible characters, what it may hold)
//    2 advisor_needs_single  `advisor` names a seat, which only single mode has
//    3 policy_unreadable     policy.json exists and cannot be read
//    4 seat_not_allowed      chain admission (an advise chain, lints clean, every seat priced, allowed, routed)
//    5 sensitivity           the effective label (operator floor, raised by policy.json, tightened by the caller) against where the seats keep text
//    6 secret_shaped         a key-shaped string anywhere in the text (never masked, never sent)
//    7 mask_collision        a token the masking would confuse with its own placeholders
//    8 pii_left              personal data still present after masking
//    9 over_ceiling          the blind round alone could cost more than the call's ceiling
//   10 over_server_limit     the ceiling is above the operator's COUNCIL_MAX_USD_LIMIT
//   11 policy                policy.json refuses the call
//   12 guards                the money and call-count guards (src/advice-guards.js decide(); several codes)
//
// Contract.
//   preSendRefusals(kind, input, ctx) -> { refusal: { code, reason, next, extra } } | { ok: true, ...what passed }
//     input: { brief, mode, advisor, max_usd }    ctx: { work, runsDir, env, loadChain, usdLimit, now }
//   admitChain(name, config), priceOfChain(config, briefText, {maxUsd}), seatsOf(config), previewSeats(config)
// Nothing here writes, sends or spends.
import { mask } from './advice-mask.js';
import { secretShapesIn } from './outbound-scan.js';
import { scanForPii } from './pii-gate.js';
import { sensitivityOf, retentionOf, tierRefusal, seatRoutingGap } from './advice-tier.js';
import { decide, readLedger } from './advice-guards.js';
import { estimateChainRows, critiqueTokensFor, estimateTokens, priceOf, isAnthropicSeat } from './cost.js';
import { lintChain } from './chain-lint.js';
import { deniedReasonsOf } from './denied-models.js';
import { loadPolicy, evaluatePolicy, monthToDateUsd } from './policy.js';
import { profileFor } from './send-profiles.js';

export const money = n => `$${(Math.round(n * 1e4) / 1e4).toFixed(n >= 1 ? 2 : 4)}`;

/** Admission: the chain exists, is an advise chain, lints clean, every seat is priced, allowed and routed as its class requires. */
export function admitChain(name, config) {
  if (!config || config.advise?.enabled !== true) return `"${name}" is not an advise chain`;
  // Before the lint (which also requires it since 0.8.1 P17), so the refusal says it in words.
  if (!Number.isFinite(config.advise.max_wall_ms)) return `chain ${name} has no advise.max_wall_ms: a call with no wall-clock ceiling is refused`;
  const findings = lintChain(config, name);
  if (findings.length) return `chain ${name} does not lint clean: ${findings.map(f => f.kind).join(', ')}`;
  const seats = [...(config.seats?.critics || []), ...(config.advise.synthesis === 'seat' && config.seats.builder ? [config.seats.builder] : [])];
  for (const s of seats) {
    if (s.provider === 'mock') continue;
    if (s.provider === 'external') return `chain ${name} has an external seat; an advice call never waits for a person`;
    if (deniedReasonsOf(s).length) return `chain ${name} seats a denied model (${s.model})`;
    if (!priceOf(s.provider, s.model)) return `seat ${s.model} has no price in pricing.json, so it cannot be capped: a seat with no price is refused`;
    const gap = seatRoutingGap(s);
    if (gap) return `seat ${s.model}: ${gap} (this class of seat must be routed to zero-retention-tagged endpoints only)`;
  }
  return null;
}

// Audit A3-5 (0.8.1): the most paid calls one advice call can make. Every blind seat can be asked again once (a cut-off or unreadable reply: advise.js `advise-<lab>-retry`),
// a debate reply and the synthesis are one call each; and a call to an Anthropic seat may itself be repeated once at a bigger cap when its thinking used the whole cap
// (invoke()). Network re-sends of one request (a 5xx) are not counted. It was the row count, which is wrong as soon as one seat is retried.
export function callsAtMost(rows, seatByKey) {
  return rows.reduce((n, r) => {
    const blind = !r.label.startsWith('advise-debate-') && r.label !== 'advise-synthesis';
    const seat = seatByKey.get(r.seat);
    return n + (blind ? 2 : 1) * (isAnthropicSeat(seat) ? 2 : 1);
  }, 0);
}

/** { worst, expected, floor, rows, ceiling } for a chain at a brief of `briefText`, with the product's own dry-run function. */
export function priceOfChain(config, briefText, { maxUsd = null } = {}) {
  // Four characters a token is the harness's rule for English. A brief that is mostly non-ASCII (CJK, say) is several times more tokens, so
  // the preview uses the larger of that and UTF-8 bytes over three. The run's own cap still projects at four characters a token; the
  // ceiling's margin absorbs the difference (brief 29 review, finding 13).
  const bytes = Buffer.byteLength(briefText);
  const promptTokens = bytes > 1.3 * briefText.length ? Math.max(estimateTokens(briefText), Math.ceil(bytes / 3)) : estimateTokens(briefText);
  const c = { ...config, estimate: { ...(config.estimate || {}), promptTokens } };
  const rows = estimateChainRows(c);
  const seatByKey = new Map([...(c.seats.critics || []), ...(c.seats.builder ? [c.seats.builder] : [])].map(s => [`${s.provider}/${s.model}`, s]));
  const expectedOut = seat => Math.min(critiqueTokensFor(seat, c.estimate.critiqueTokens ?? 0), seat.maxTokens ?? 36000);
  const sum = pick => rows.filter(pick).reduce((n, r) => {
    const seat = seatByKey.get(r.seat); const p = priceOf(seat.provider, seat.model);
    return n + (p ? (r.input / 1e6) * p.in + (expectedOut(seat) / 1e6) * p.out : 0);
  }, 0);
  const worst = rows.reduce((n, r) => n + r.usd, 0);
  const blindWorst = rows.filter(r => !r.label.startsWith('advise-debate-') && r.label !== 'advise-synthesis').reduce((n, r) => n + r.usd, 0);
  const ceiling = Math.min(config.advise.usd, maxUsd ?? Infinity);
  return { worst, expected: sum(() => true), floor: sum(r => !r.label.startsWith('advise-debate-')), blindWorst, calls: callsAtMost(rows, seatByKey), ceiling };
}

export const seatsOf = config => [...(config.seats.critics || []), ...(config.advise.synthesis === 'seat' && config.seats.builder ? [config.seats.builder] : [])];

export function previewSeats(config) {
  return seatsOf(config).map(s => { const r = retentionOf(s); return { lab: s.lab || s.provider, model: s.model, provider: s.provider, retention: r.label, retention_class: r.class, detail: r.detail }; });
}

/**
 * The seats a gate binds (its `seats`, hashed into meta_sha256): lab, model and retention wording of every seat, in order. One
 * definition for the gate the server writes and for the check `council --advice-adopt` makes against the chain it is about to
 * run, so a chain swapped, reordered, or with its routing changed after approval is refused (M4 review H1).
 */
export const gateSeatsOf = config => previewSeats(config).map(s => ({ lab: s.lab, model: s.model, retention: s.retention }));

const refuse = (code, reason, next, extra = {}) => ({ refusal: { code, reason, next, extra } });

/** The twelve checks, in order. Pure apart from reading policy.json, the chain and the run folders' advice records. */
export function preSendRefusals(kind, { brief, mode, advisor, max_usd }, { work, runsDir, env, loadChain, usdLimit = null, now = Date.now() }) {
  const profile = profileFor(kind);
  const limits = profile.limits(env);
  // 1. the brief: caps, tried, then the sensitivity floor
  const bad = profile.briefRefusal(brief);
  if (bad) return refuse('brief_invalid', bad, 'Fix the brief and ask for a new quote.');
  if (advisor && mode !== 'single') return refuse('advisor_needs_single', '`advisor` picks the model in single mode; a council has its own roster.', 'Drop `advisor`, or use mode "single".');
  const { policy, error: policyError } = loadPolicy(work);
  if (policyError) return refuse('policy_unreadable', `policy.json cannot be read (${policyError}), so the sensitivity floor and the provider limits cannot be checked.`, 'Ask the user to repair policy.json.');
  // The operator's floor, raised (never lowered) by the project's policy.json; the caller's label can only tighten it (rule 5d).
  const sens = sensitivityOf(brief.sensitivity, { env, policy });
  // 2. the chain behind the mode, and who would receive the text
  const chainName = profile.chainFor({ mode, seat: advisor, env });
  const config = loadChain(chainName);
  const gap = admitChain(chainName, config);
  if (gap) return refuse('seat_not_allowed', `${gap}.`, 'Use another seat or mode, or ask the user to fix the chain.');
  const tier = tierRefusal({ effective: sens.effective, mode, seats: seatsOf(config) });
  if (tier) return refuse('sensitivity', tier, 'Leave the sensitive material out, or ask the user what to do with it.');
  // 3. the text: rendered once, scanned whole (before any cut), masked, re-scanned
  const raw = profile.renderBrief(brief);
  // The scan runs on the text as written AND on a compatibility-normalised copy (full-width letters become ASCII), so a key cannot hide in a look-alike alphabet.
  // The whole brief is outgoing, so the context-only shapes (a bare Mistral or Together key) apply with no context word (audit A5).
  const keys = [...secretShapesIn(raw, { everyContext: true }), ...secretShapesIn(raw.normalize('NFKC'), { everyContext: true })];
  if (keys.length) return refuse('secret_shaped', `the brief contains ${keys.length} credential-shaped string(s) (${[...new Set(keys.map(k => k.name))].join(', ')}, first on line ${keys[0].line}); a key is never sent and is never masked.`, 'Remove the key from the excerpts (describe it instead) and ask for a new quote.');
  let masked;
  try { masked = mask(raw, { repoRoot: work }); } catch (e) { return refuse('mask_collision', e.message, 'Rename the token and ask for a new quote.'); }
  const pii = [...scanForPii(masked.text).findings, ...scanForPii(masked.text.normalize('NFKC')).findings].filter(f => f.type !== 'secret');
  if (pii.length) return refuse('pii_left', `after masking, ${pii.length} personal-data-shaped string(s) remain (${[...new Set(pii.map(f => f.type))].join(', ')}, first on line ${pii[0].line}).`, 'Remove them from the brief and ask for a new quote.');
  // 4. price, policy, guards
  const price = priceOfChain(config, masked.text, { maxUsd: max_usd ?? null });
  if (price.blindWorst > price.ceiling) return refuse('over_ceiling', `the blind round alone could cost ${money(price.blindWorst)}; the ceiling for this call is ${money(price.ceiling)}${max_usd ? ' (your max_usd)' : ''}.`, 'Shorten the brief, use single mode or a cheaper seat, or raise max_usd.', { worst_usd: price.blindWorst, ceiling_usd: price.ceiling });
  if (usdLimit !== null && price.ceiling > usdLimit) return refuse('over_server_limit', `this call's ceiling ${money(price.ceiling)} is above the $${usdLimit} limit the user set in COUNCIL_MAX_USD_LIMIT.`, 'Ask the user to raise that limit in the server settings.');
  if (policy) {
    const ev = evaluatePolicy(policy, { config, allSeats: seatsOf(config), worstCaseUsd: price.ceiling, monthToDateUsd: monthToDateUsd(runsDir, now) });
    if (!ev.ok) return refuse('policy', `policy.json refuses this call: ${ev.reasons.join(' ')}`, 'Ask the user; the policy is theirs.');
  }
  const fp = profile.fingerprint(brief);
  const ledgerNow = readLedger(runsDir);
  const verdict = decide({ fingerprint: fp, hasNewEvidence: !!brief.new_evidence, skipDispositions: true, worstUsd: price.worst, ceilingUsd: price.ceiling, ledger: ledgerNow, now, limits });
  if (!verdict.allow) return refuse(verdict.code, verdict.message.replace(/ Nothing was spent\.$/, ''), verdict.next, { ...(verdict.run ? { run: verdict.run } : {}), ...(verdict.ids ? { ids: verdict.ids } : {}) });
  return { ok: true, limits, sens, chainName, config, masked, price, fp, ledgerNow };
}
