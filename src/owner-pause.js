// The owner's "pause after this round" (0.8.4 S20 slice 2, #16c; Mini-C&C R358, R360): the person or the handler session asks the RUNNING run to stop between two passes (`council pause <run folder>`); the chain stops at the head of the next pass, before anything of it is
// logged, built, written or reserved, and the stop is the cause below (STOPPED-owner_pause.json, exit 23). Pure: the words only. A pause is not an overseer-limit stop (src/stop-files.js keeps it out of ROUND_STOP_CAUSES): a plain
// `council --resume <run folder>` continues it, and when is the person's call; since the ladder unit the person may also END it there, `--finish` or `--finish-now`, typed or relayed (0.8.4, his "all three options should be open"). All sentences are A-DRAFT (WORDING_0.8.4.md).
export const OWNER_PAUSE = 'owner_pause';
export const PAUSE_GENERAL_WORDS = 'the person or the handler session asked the run to pause between two passes';   // A-DRAFT

/** The sentence the CLI prints and the stop marker keeps when the run stopped for the owner's pause, before pass `pass`. Nothing of that pass was started or paid for. */
export function pauseSentence({ pass, spentUsd = null, draftFile = null, runDir = '<run folder>' } = {}) {
  const spent = spentUsd === null || spentUsd === undefined ? '' : ` Spent so far: $${Number(spentUsd).toFixed(2)}.`;
  const draft = draftFile ? ` The plan as it stands is in ${draftFile} in ${runDir}.` : '';
  const before = Number.isInteger(pass) ? `before pass ${pass}` : 'between two passes';
  return `PAUSED on request ${before}: nothing of the next pass was started, written or paid for.${spent}${draft} To go on: council --resume ${runDir} (no --continue is needed; the finished passes replay at no cost). To end it here instead: council --resume ${runDir} --finish (the run ends NOT agreed; a layered chain's final read runs first, then the closing steps) or --finish-now (the run ends NOT agreed, and no judge reads the plan again).`;   // A-DRAFT (LAD-O1)
}
