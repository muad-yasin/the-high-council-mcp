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
import { unpricedSeats } from './unpriced.js';
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
  // 0.8.2 item 8c: the same planned calls at their whole output allowance (see estimateChainRows `maximum`). `worst` is what this report has always called worstCaseUsd: it prices the TYPICAL review output.
  const maxRows = estimateChainRows(config, { fromRun, maximum: true });
  const maximum = sum(maxRows);
  const maxByLabel = new Map(maxRows.map(r => [r.label, r])); // audit fix cnc-money F2: the two passes are joined by label, never by position
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
  const taskConfig = taskTokens !== null && taskTokens > assumedPromptTokens
    ? { ...config, estimate: { ...(config.estimate || DEFAULT_ESTIMATE), promptTokens: advising ? taskTokens : assumedPromptTokens + taskTokens } }
    : null;
  const withTask = taskConfig ? sum(estimateChainRows(taskConfig, { fromRun })).usd : null;
  const maximumWithTask = taskConfig ? sum(estimateChainRows(taskConfig, { fromRun, maximum: true })).usd : null;

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
      // worstCaseUsd keeps its name and value (readers depend on it) but is the EXPECTED figure: the chain's own assumed sizes with the typical output of a review. expectedUsd is the same number under an honest
      // name; maximumUsd is every planned call at its whole output allowance (an Anthropic seat's one retry included), the figure the spend cap can be compared with.
      worstCaseUsd: worst.usd,
      worstCaseWithTaskUsd: withTask,
      expectedUsd: worst.usd,
      expectedWithTaskUsd: withTask,
      maximumUsd: maximum.usd,
      maximumWithTaskUsd: maximumWithTask,
      inputTokens: worst.input,
      outputTokens: worst.output,
      history: history && history.runsUsed ? { runs: history.runsUsed, days: history.days, lowUsd: history.low, highUsd: history.high, meanUsd: history.mean, ...(history.partial ? { partial: true } : {}) } : null,
    },
    // Additive (0.8.1 M1 S5): an advice call's own ceiling inside the run's cap, and its debate rounds at most.
    ...(advising ? { advise: { usd: config.advise.usd ?? null, rounds: config.advise.rounds ?? 0, seats: (config.seats.critics || []).length } } : {}),
    task: taskTokens === null ? null : { tokens: taskTokens, assumedPromptTokens, largerThanAssumed: taskTokens > assumedPromptTokens },
    // Finite numbers only (FX-3): a NaN or null worst case must never read as "under the cap".
    cap: {
      defaultUsd: defaultCapUsd,
      worstCaseAboveDefault: defaultCapUsd !== null && (Number.isFinite(withTask) ? withTask : worst.usd) > defaultCapUsd,
      maximumAboveDefault: defaultCapUsd !== null && (Number.isFinite(maximumWithTask) ? maximumWithTask : maximum.usd) > defaultCapUsd,
      // 0.8.2 item 8a: under a cap, a run on a chain with an unpriced seat is refused at its start (exit 5); `unpriced` lists the seats. --max-usd none is the way out besides adding a price row.
      unpricedSeatsRefused: defaultCapUsd !== null && unpricedSeats(config).length > 0, // every seat slot, not only the planned rows: an unpriced seat of a stage that is switched off is refused too
    },
    rows: rows.map(r => ({ label: r.label, seat: r.seat, inputTokens: r.input, outputTokens: r.output, usd: r.usd, priced: r.priced, maximumOutputTokens: maxByLabel.get(r.label)?.output ?? null, maximumUsd: maxByLabel.get(r.label)?.usd ?? null })),
    seats,
    missingKeys,
    canRun: missingKeys.length === 0,
    unpriced,
    // expired (0.8.1 M7, additive): price rows past their `expires` date or with an unreadable one; the text dry run warns on each.
    priceTable: { asOf: table.asOf, ageDays: table.days, stale: table.stale, expired: expiredPriceRows(now) },
  };
}
