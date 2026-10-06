// `council --dry-run --json`: the dry run as data, for a program that has to show a price and a
// missing-key list before anything is paid (the local web UI, an agent, a script). The human
// printout in cli.js stays as it was; this is the same numbers plus what that text never said:
// which seat lacks which key.
//
// Pure: it reads the environment only through providers.keyFor (presence, never the value) and
// prices with cost.js's estimateChainRows, the function the human printout and `council doctor`
// already use. No network call, no file written, nothing spent.
import { estimateChainRows, priceTableAge, expiredPriceRows, DEFAULT_ESTIMATE } from './cost.js';
import { everySeatSlotsOf, labOf } from './chain.js';
import { keyFor, envKeyName, isKeyOptional } from './providers.js';

export const DRY_RUN_SCHEMA_VERSION = 1;

/** What a seat's provider needs before it can be called. The key's value is never read out. */
export function seatKeyStatus(provider) {
  if (provider === 'mock' || provider === 'external') return { envVar: null, keyRequired: false, status: 'not_needed' };
  let envVar;
  try { envVar = envKeyName(provider); } catch { return { envVar: null, keyRequired: false, status: 'unknown_provider' }; }
  if (isKeyOptional(provider)) return { envVar, keyRequired: false, status: 'not_needed' };
  return { envVar, keyRequired: true, status: keyFor(provider) ? 'ok' : 'missing_key' };
}

const sum = rows => rows.reduce((t, r) => ({ input: t.input + r.input, output: t.output + r.output, usd: t.usd + r.usd }), { input: 0, output: 0, usd: 0 });

/**
 * `config` is the chain as the run would see it (after --rounds and single-vendor resolution).
 * `taskChars` is the task file's length, or null when no --task was given. `history` is
 * forecastCost()'s answer for this chain on this machine, or null.
 */
export function dryRunReport(config, { fromRun = false, taskChars = null, history = null, defaultCapUsd = null, now = Date.now() } = {}) {
  const rows = estimateChainRows(config, { fromRun });
  const worst = sum(rows);
  // An advice chain (config.advise, src/advise.js) has no review rounds: maxRounds is unused, and its
  // cheapest end is a panel whose blind answers agree, so no debate round runs (0.8.1 M1 S5; pricing it
  // as maxRounds: 1 gave floor == worst case for every advice chain).
  const advising = config.advise?.enabled === true;
  // The cheapest way a planning run can end: the first review round finishes it. Everything before the
  // rounds (criteria, alternatives, proposals, debate, build) is paid either way.
  const floor = sum(estimateChainRows(advising ? { ...config, advise: { ...config.advise, rounds: 0 } } : { ...config, maxRounds: 1 }, { fromRun }));

  const assumedPromptTokens = config.estimate?.promptTokens ?? DEFAULT_ESTIMATE.promptTokens;
  const taskTokens = taskChars === null ? null : Math.ceil(taskChars / 4);
  // An advice chain's whole prompt is the brief, so the task replaces the assumed prompt instead of
  // being added to it (the same rule as the printed dry run in src/cli.js).
  const withTask = taskTokens !== null && taskTokens > assumedPromptTokens
    ? sum(estimateChainRows({ ...config, estimate: { ...(config.estimate || DEFAULT_ESTIMATE), promptTokens: advising ? taskTokens : assumedPromptTokens + taskTokens } }, { fromRun })).usd
    : null;

  const seats = everySeatSlotsOf(config).map(({ role, seat }) => ({
    role, provider: seat.provider, model: seat.model, lab: labOf(seat), ...seatKeyStatus(seat.provider),
  }));
  const missingKeys = [];
  for (const s of seats) {
    if (s.status !== 'missing_key') continue;
    let entry = missingKeys.find(m => m.envVar === s.envVar);
    if (!entry) missingKeys.push(entry = { envVar: s.envVar, provider: s.provider, seats: [] });
    entry.seats.push(s.role);
  }

  const unpriced = [...new Set(rows.filter(r => !r.priced && !r.seat.startsWith('mock/') && !r.seat.startsWith('external/')).map(r => r.seat))];
  const table = priceTableAge();

  return {
    schemaVersion: DRY_RUN_SCHEMA_VERSION,
    kind: 'dry-run',
    chain: config.name ?? null,
    description: config.description ?? null,
    ...(typeof config.summary === 'string' ? { summary: config.summary } : {}),
    maxRounds: config.maxRounds ?? null,
    signoff: config.signoff || 'first',
    estimate: {
      // Every figure prices the chain's own assumed token sizes (config.estimate) at pricing.json's
      // list prices. They are estimates, not bounds: the per-run cap is the bound.
      basis: 'chain token assumptions, list prices',
      floorUsd: floor.usd,
      worstCaseUsd: worst.usd,
      worstCaseWithTaskUsd: withTask,
      inputTokens: worst.input,
      outputTokens: worst.output,
      history: history && history.runsUsed ? { runs: history.runsUsed, days: history.days, lowUsd: history.low, highUsd: history.high, meanUsd: history.mean, ...(history.partial ? { partial: true } : {}) } : null,
    },
    // Additive (0.8.1 M1 S5): an advice call's own ceiling inside the run's cap, and its debate rounds at most.
    ...(advising ? { advise: { usd: config.advise.usd ?? null, rounds: config.advise.rounds ?? 0, seats: (config.seats.critics || []).length } } : {}),
    task: taskTokens === null ? null : { tokens: taskTokens, assumedPromptTokens, largerThanAssumed: taskTokens > assumedPromptTokens },
    // Finite numbers only (FX-3): a NaN or null worst case must never read as "under the cap".
    cap: { defaultUsd: defaultCapUsd, worstCaseAboveDefault: defaultCapUsd !== null && (Number.isFinite(withTask) ? withTask : worst.usd) > defaultCapUsd },
    rows: rows.map(r => ({ label: r.label, seat: r.seat, inputTokens: r.input, outputTokens: r.output, usd: r.usd, priced: r.priced })),
    seats,
    missingKeys,
    canRun: missingKeys.length === 0,
    unpriced,
    // expired (0.8.1 M7, additive): price rows past their `expires` date or with an unreadable one; the text dry run warns on each.
    priceTable: { asOf: table.asOf, ageDays: table.days, stale: table.stale, expired: expiredPriceRows(now) },
  };
}
