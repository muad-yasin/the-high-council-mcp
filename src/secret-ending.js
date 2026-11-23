// What a finish at a found-secret pause runs after the pass loop, read from the chain's own estimator rows (src/cost.js estimateChainRows, the MAXIMUM figure): a row exists exactly where the chain
// makes the call, so the words and the money cannot drift from what runs. The labels are the post-loop stages of chain.js: the ending exchange (`<kind>-end-L<n>-*`), the dispute stage and its reviews,
// the claims, challenge, cold-read and final stages, the layer-N final read, the handoff and its notes, the argued stage. (A-DRAFT words: WORDING_0.8.4.md, section "c2".)
import { estimateChainRows } from './cost.js';

const ENDING_LABEL = /^(dispute|canary-reply-|claims|challenge|cold-read|final$|final-read-L|handoff|notes-answer|argued)|-end-L\d/;

/** -> null when the estimator cannot be run; else { calls: [words], usd: number | null (null = a row is unpriced), makesCalls: boolean } */
export function secretEndingOf(config, { typedReads = null } = {}) {
  let rows;
  try { rows = estimateChainRows(config, { maximum: true, typedReads }); } catch { return null; }
  const ending = rows.filter(r => ENDING_LABEL.test(r.label));
  const has = re => ending.some(r => re.test(r.label));
  const readLayer = ending.map(r => /^final-read-L(\d+)/.exec(r.label)).find(Boolean);
  const calls = [
    ...(has(/^dispute/) ? ['the dispute stage runs'] : []),
    ...(has(/-end-L\d/) ? ['the ending exchange runs'] : []),
    ...(readLayer ? [`layer ${readLayer[1]} reads the final plan`] : []),
    ...(has(/^handoff|^notes-answer/) ? ['the handoff runs'] : []),
  ];
  const priced = ending.every(r => r.priced !== false && Number.isFinite(r.usd));
  return { calls, usd: priced ? ending.reduce((n, r) => n + r.usd, 0) : null, makesCalls: ending.length > 0 };
}

/** The sentence after "nothing is sent until you also give --continue." */
export function secretEndingSentence(ending) {
  if (!ending) return '';
  if (!ending.makesCalls) return ' Ending the run makes no further model call; the result stays "not agreed".';
  const list = ending.calls.length ? `${ending.calls.slice(0, -1).join(', ')}${ending.calls.length > 1 ? ' and ' : ''}${ending.calls.at(-1)}, ` : 'the closing stages run, ';
  const cost = ending.usd === null ? 'an amount that is not known, because a seat in it has no price' : `$${ending.usd.toFixed(2)}`;
  return ` Then ${list}the open objections are handed over, and the result stays "not agreed". Ending the run sends the plan: the only way to send nothing is to leave the run paused. The ending costs up to ${cost}.`;
}
