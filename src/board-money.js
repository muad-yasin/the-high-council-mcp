// 0.8.4 unit 6 (D32; plan A T6.5, "Dollars on the board"): the money section of a FINISHED run's debate board (BOARD.md). It answers "what did this run cost, and how sure is that figure" without opening the report.
//
// It reads the run folder through the ONE counted-spend reader (src/counted-spend.js, D11), once, and sums its own lines, so the total it prints is the sum of the lines above it and equals report.json's `totals.counted.usd` for the same folder
// (nothing paid is written between the board and the report in src/cli.js). It is fs-reading on purpose: src/report-shape.js stays fs-free and only receives the finished text (`renderBoardMd({ ..., money })`).
// Shown nowhere else: a partial board (a stopped run), a replay's and a rematch's board do not pass it, so those boards and their goldens do not move.
//
// What it does NOT say: it never calls a figure a bill. OpenRouter's reported figure is recorded beside THC's count and counted nowhere (Mini-C&C R394: `provider_cost` is not a basis), so the plan's two DRAFT clauses about "your provider's own
// reported cost" are not used. All words below are A-DRAFT (Review/WORDING_0.8.4.md).
import { countedRecordsOf, summariseCounted, estimatedPartWords, baseLabelOf } from './counted-spend.js';
import { unreplayedOf } from './unreplayed.js';
import { BASES } from './counted-bases.js';
import { formatUsd } from './cost.js';

export const MONEY_HEADING = '## What the run cost';
// A-DRAFT: the opening label (plan A T6.5 DRAFT without its provider-cost clause) and the words for each basis; `worst_case` and "no basis" are not in the plan's list.
export const MONEY_LABEL = "Counted by THC from token counts and price rows; not your provider's bill. Amounts marked 'estimated' are typical, expected or worst-case figures, not recorded ones.";
export const BASIS_WORDS = Object.freeze({
  token_priced: 'token-priced',
  provider_usage: 'provider usage',
  typical_error: 'typical error cost, estimated',
  expected_retry: 'expected retry cost, estimated',
  reserved_unsettled: 'reserved at its worst case, never settled, estimated',
  worst_case: "one attempt's worst case, estimated",
});
export const NO_BASIS_WORDS = 'recorded before THC noted what a figure stands for';
// A-DRAFT: what happened to a file of a run that was resumed or that paid for something outside its stages.
export const STATE_WORDS = Object.freeze({
  counted: 'counted in the total',
  replayed: 'replayed from an earlier sitting, counted once',
  superseded: 'superseded, still counted',
  charge: 'the charge of a failed or discarded attempt, counted',
  call: 'a paid call outside the stages, counted',
  neverAsked: 'never asked again by the resumed sitting, still counted',
  unsettled: 'no settlement was written, counted',
  settledNoFile: 'settled, its usage file was never written, counted',
});

const one = s => String(s ?? '').replace(/\s+/g, ' ').trim();   // a label or a model id is one line on the board, whatever it holds
const basisWords = b => (b === null ? NO_BASIS_WORDS : BASIS_WORDS[b] ?? NO_BASIS_WORDS);

/**
 * The board's money section for the run folder `runDir`, or '' when the folder holds no paid record (a $0 run, a mock run: nothing to say, and the board is unchanged).
 * `stages` is the run's stage rows (result.stages): they name each stage's seat and which stages were replayed (`cached: true`).
 * The text starts with its own blank lines, so it follows the board's last section.
 */
export function moneySectionOf({ runDir, stages = [] }) {
  const records = countedRecordsOf(runDir);
  const summary = summariseCounted(records);
  if (!summary) return '';
  const rows = Array.isArray(stages) ? stages.filter(s => s && typeof s.label === 'string') : [];
  const rowOf = new Map(rows.map(s => [s.label, s]));
  const cached = new Set(rows.filter(s => s.cached === true).map(s => s.label));
  const neverAsked = new Set(unreplayedOf(runDir, rows).map(o => o.label));

  const baseOf = r => (r.source === 'stage' || r.source === 'unsettled' || r.source === 'settled' ? r.label : baseLabelOf(r.label));
  const stateOf = r => {
    if (r.source === 'unsettled') return STATE_WORDS.unsettled;
    if (r.source === 'settled') return STATE_WORDS.settledNoFile;
    if (r.source === 'superseded') return STATE_WORDS.superseded;
    if (r.source === 'charge') return STATE_WORDS.charge;
    if (r.source === 'call') return STATE_WORDS.call;
    if (cached.has(r.label)) return STATE_WORDS.replayed;
    if (neverAsked.has(r.label)) return STATE_WORDS.neverAsked;
    return STATE_WORDS.counted;
  };

  // per seat: the base label maps to a stage row; what maps to none is listed under its label, never dropped
  const seats = new Map();
  for (const r of records) {
    if (!(r.usd > 0)) continue;
    const row = rowOf.get(baseOf(r));
    const key = row ? `${one(row.seat ?? row.lab)} (${one(row.model)})` : `label ${one(baseOf(r))}`;
    const s = seats.get(key) ?? { usd: 0, bases: new Map() };
    s.usd += r.usd; s.bases.set(r.basis, (s.bases.get(r.basis) ?? 0) + r.usd);
    seats.set(key, s);
  }
  const order = key => (key.startsWith('label ') ? 1 : 0);
  const seatLines = [...seats.entries()].sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0])).map(([key, s]) => {
    const parts = [...BASES, null].filter(b => s.bases.has(b)).map(b => `${formatUsd(s.bases.get(b))} ${basisWords(b)}`);
    return `- ${key}: ${formatUsd(s.usd)} counted (${parts.join(', ')})`;
  });

  // one line per file, only for a run that was resumed or that paid for something that is not a plain stage record
  const listed = records.filter(r => r.usd > 0);
  const plain = r => stateOf(r) === STATE_WORDS.counted;
  const fileLines = listed.some(r => !plain(r))
    ? listed.map(r => ({ name: r.file ?? (r.reservationId ? `reservation ${r.reservationId}` : r.label), r })).sort((a, b) => a.name.localeCompare(b.name))
        .map(({ name, r }) => `- ${one(name)}: ${formatUsd(r.usd)}, ${basisWords(r.basis)}; ${stateOf(r)}.`)
    : [];

  const unknown = summary.unknownFigures ? `\n\n${summary.unknownFigures} record${summary.unknownFigures === 1 ? '' : 's'} with a figure that could not be read ${summary.unknownFigures === 1 ? 'is' : 'are'} not in this total.` : '';
  return `\n\n${MONEY_HEADING}\n\n${MONEY_LABEL}\n\nTotal: ${formatUsd(summary.usd)} counted${estimatedPartWords(summary.estimatedUsd, formatUsd)}.${unknown}\n\n${seatLines.join('\n')}${fileLines.length ? `\n\nEach file of the run folder:\n\n${fileLines.join('\n')}` : ''}`;
}
