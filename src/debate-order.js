// What each reader of the debate sees, in what order and under which lab letters (0.8.2 item 3; owner decision 2, 5 Oct 2026: "seeded per-reader shuffle of lab letters, listing order and
// canary target"). Until now every reader got the proposals in roster order and the letters A, B, C in that same order, so "Lab A" was always the first roster lab and the canary always
// hit it. With `debate_hygiene.shuffle` each reader gets its own seeded order (a pure function of the run id, the stage and the reader, so a resume replays it) and the letters follow
// that order. This is hygiene and canary fairness, NOT a fix for a position effect (the 5 Oct second read found the first-listed lab's wins were one lab's merge-heavy style, not list
// position). The order each reader saw is recorded, so position and lab can be told apart later.
import { seededShuffle } from './seeded-shuffle.js';

/**
 * The view one reader gets of `items` (proposals or alternatives, each { id, lab, ... }): the items in its own seeded order and the maps built from that order.
 * `anonymise` is roles.js's (it turns ids into A-1 and labs into "Lab A", first appearance first).
 */
export function readerView(items, reader, { runId = '', stage = 'debate', anonymise }) {
  const shuffled = seededShuffle(items, `${runId}:${stage}:${reader}`);
  return { items: shuffled, maps: anonymise(shuffled) };
}

/**
 * Free text in a post ("see A-2", "Lab B is wrong") names proposals and labs in the POSTER's own lettering. With a shuffle every reader has its own letters, so the same text
 * must be re-lettered for whoever reads it (found by the item 3 review: without this, "A-2" written by one lab pointed at a different proposal in another lab's prompt).
 * `fromMaps` are the poster's maps; `toMaps` the reader's, or null for the real ids and lab names (the builder's board shows those). Only tokens the poster's maps actually
 * contain are replaced; everything else is left alone.
 */
const LAB_REF = /\b(labs?)(\s+)([A-Z](?:(?:\s*[,/&]\s*|\s+and\s+)[A-Z])*)\b/gi;
export function translateRefs(text, fromMaps, toMaps) {
  if (typeof text !== 'string' || !fromMaps) return text;
  const labFrom = Object.fromEntries(Object.entries(fromMaps.labTo || {}).map(([real, anon]) => [anon, real]));
  return text
    .replace(LAB_REF, (m, word, sp, list) => { // "Lab B", and (audit fix cnc-debate F4) "Labs B and C", "lab c", "Labs B, C and D", "Labs B/C"
      let mapped = 0; let total = 0;
      const out = list.replace(/\b[A-Za-z]\b/g, letter => {
        total++;
        const real = labFrom[`Lab ${letter.toUpperCase()}`];
        if (real === undefined) return letter;
        const to = toMaps ? toMaps.labTo?.[real] : real;
        if (to === undefined) return letter;
        mapped++;
        if (!toMaps) return to;
        const t = String(to).replace(/^Lab /, '');
        return letter === letter.toLowerCase() ? t.toLowerCase() : t;
      });
      if (!mapped) return m;
      return !toMaps && mapped === total ? out : `${word}${sp}${out}`; // real names stand without the word "Lab" (as before) unless a letter of the list was not a lab of the poster's
    })
    .replace(/\b[A-Z]{1,3}-[A-Za-z0-9]+\b/g, m => { const real = fromMaps.idFrom?.[m]; return real === undefined ? m : (toMaps ? (toMaps.idTo?.[real] ?? m) : real); });
}

/** One record of what a reader saw, for report.json: the item ids in shown order and the letter each lab had. */
export const viewRecord = (stage, reader, view) => ({ stage, reader, order: view.items.map(i => i.id), letters: { ...view.maps.labTo } });
