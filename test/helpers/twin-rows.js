// 0.8.4 apply, the TWIN-ROW bar (C&C 12 Nov, restated after jobs 105, 112, 113; the bar is in the NEW comments of test/plan-claude-council.test.js PCC-6 and test/resolve-run.test.js RR-10): a twin seat (a second judge of one model on one layer, labelled `-2` in every row name) is priced
// exactly like its sibling except for its persona name. For every twin row family (`<kind>-L<layer>-<lab>-2` with whatever endings follow: `-reask`, `-reask3`, `-solo`, exchange `-x<n>`), in both modes: the times, the output and the PRICE ROW (priceOf(provider, model)) are EXACTLY equal; every system-text variant
// the row prices is the sibling's once each seat's persona name is replaced by one placeholder; and the per-call input gap is DERIVED from the two persona names (the sibling's variants with its name replaced by the twin's, the longest of each by the estimator's unit ceil(length / 4)), not read off the estimator's own figure.
// `rowsChecked` counts every twin row examined in both modes (a test compares it with its own, looser count of the `-2` rows, so a label the pattern missed shows). Returns the violations as strings (empty = the bar holds), so a test can assert the list is empty and a control can assert a SPECIFIC violation. Not a test file.
import { estimateChainRows, estimateTokens, priceOf } from '../../src/cost.js';
import { systemTextsFor } from '../../src/stage-system.js';

const labOf = k => k.lab || k.provider;
const ROW = /^(.*-L(\d+)-)(.+?)-(\d+)((?:-[a-z][a-z0-9]*)*)$/;   // `<kind>-L<layer>-<lab>-<ordinal>` and any lowercase endings after it (-reask, -reask3, -solo, -x2 ...)
const strip = (t, persona) => String(t).split(persona).join('<P>');
const longest = texts => Math.max(0, ...texts.map(t => estimateTokens(t)));

/** { violations: string[], rowsChecked: number } for one config (a chain as the dry run reads it, routed or direct). */
export function twinViolations(config) {
  const violations = []; let rowsChecked = 0;
  const critics = config.seats?.critics ?? [];
  for (const maximum of [false, true]) {
    const mode = maximum ? 'upper' : 'expected';
    const rows = estimateChainRows(config, { maximum }); const by = new Map(rows.map(r => [r.label, r]));
    for (const r of rows) {
      const m = ROW.exec(r.label); if (!m) continue;
      const layer = Number(m[2]); const ord = Number(m[4]);
      const seats = critics.filter(k => labOf(k) === m[3] && k.layer === layer); if (seats.length < ord || ord < 2) continue;
      const sib = seats[0]; const twin = seats[ord - 1]; const sibLabel = `${m[1]}${m[3]}${m[5]}`; const sibRow = by.get(sibLabel);
      rowsChecked++;
      const say = what => violations.push(`${mode}: ${r.label}: ${what}`);
      if (!sibRow) { say('no sibling row'); continue; }
      if (typeof sib.persona !== 'string' || !sib.persona || typeof twin.persona !== 'string' || !twin.persona) { say('a seat has no persona name'); continue; }
      if ((r.times ?? 1) !== (sibRow.times ?? 1)) say(`times ${r.times ?? 1} !== ${sibRow.times ?? 1}`);
      if (r.output !== sibRow.output) say(`output ${r.output} !== ${sibRow.output}`);
      if (JSON.stringify(priceOf(twin.provider, twin.model)) !== JSON.stringify(priceOf(sib.provider, sib.model))) say('price row differs');
      const tw = systemTextsFor(r.label, config, twin); const sb = systemTextsFor(sibLabel, config, sib);
      if (tw.length !== sb.length || tw.some((t, i) => strip(t, twin.persona) !== strip(sb[i], sib.persona))) { say('a system-text variant differs beyond the persona name'); continue; }
      const derived = longest(sb.map(t => t.split(sib.persona).join(twin.persona))) - longest(sb);
      const gap = (r.input / (r.times ?? 1)) - (sibRow.input / (sibRow.times ?? 1));
      if (gap !== derived) say(`input gap ${gap} !== ${derived} derived from the persona names ('${sib.persona}' -> '${twin.persona}')`);
    }
  }
  return { violations, rowsChecked };
}

/** A clone whose twin (the ordinal-th seat of `lab` on `layer`) has its maxTokens set to `maxTokens` (4000: the dry run's maximum prices a row's output at the seat's cap and this chain sets no panelMaxTokens, so the twin's output figures move): a known-bad TEST-SIDE INPUT that keeps the pair (a seat's identity is its model, not its maxTokens) and must fail on the output line. A clone has no seat keys: use it on a raw chain, never on a registered config. */
export function withTwinMaxTokens(config, lab, layer, maxTokens = 4000, ordinal = 2) {
  const c = structuredClone(config); const seats = c.seats.critics.filter(k => labOf(k) === lab && k.layer === layer); const twin = seats[ordinal - 1];
  twin.maxTokens = maxTokens; if (twin.panelMaxTokens !== undefined) twin.panelMaxTokens = Math.min(twin.panelMaxTokens, maxTokens); return c;
}
