// 0.8.3 (Muad 21 Okt 2026: "claude code may answer it, after asking the user for permission. A Claude Code session answering it without consulting the user shouldn't be done - spending money without approval"): the session's route
// for a run that a price refusal stopped (exit 24) and that nobody sits at. Two calls: `quote` (looks up the cheapest host, returns the text for the USER and a hash) and `confirm` (only with that hash and the user's words; writes the
// row into pricing.user.json). Nothing is spent by either: continuing is `resume_run`, which stops again at the spending-limit gate because a price row changed (src/start-cap.js amend_scope), and that gate is answered by the person.
// The tool cannot know that the session asked; the description says it must, and the limit gate behind it is the part that does not depend on the session. All sentences are A-DRAFT.
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { cheapestHost, needsOfSeat, offerWords, safeName } from '../price-raise.js';
import { blankHiddenChars } from '../hidden-chars.js';
import { effectiveRow, raiseUserPriceRow, UserPriceFileError, NOTE_MAX } from '../price-table.js';
import { SEAT_DEFAULT_MAX_TOKENS } from '../cost.js';
import { readStoppedMarker } from '../stop-files.js';
import { readRunJson } from '../run-files.js';
import { lockHolder } from '../run-lock.js';
import { isAdviceFolder } from '../advice-run.js';
import { textSecretFindings } from '../run-preflight.js';

export const PRICE_RAISE_DESCRIPTION = 'After a price refusal stopped a run (exit 24, run_status says so), the refused seat\'s model can be given a higher price here, in two calls. step "quote": looks up the cheapest OpenRouter host that can serve the refused seat and returns a text for the USER plus its hash `shown`; nothing is written. step "confirm": with `shown` and `reason` (the user\'s own yes, in their words), writes the price row into pricing.user.json of this project, which every later run here reads. SHOW THE USER THE QUOTED TEXT AND GET THEIR YES IN THE CHAT BEFORE YOU CALL CONFIRM. NEVER CONFIRM ON YOUR OWN: a higher price raises what every later call of that seat is counted at against the spending limit. Confirm spends nothing. Continue the run with resume_run; it stops at the spending-limit gate once more because a price changed, and the person answers that gate. Tree members, advice runs and seats whose price limit the chain itself sets are refused (a tree member goes through tree_decide).';

const sha = s => createHash('sha256').update(s).digest('hex');
const refuse = text => ({ refusal: text });

// The row's note is the only record of the person's yes, and parseUserPrices refuses a note over NOTE_MAX (a format bound on a file the user edits, not ours to raise): the user's words are cut
// to what fits after the fixed text and the host name, with an ellipsis, never dropped (A-DRAFT).
function raiseNote(reason, hostName) {
  const lead = 'raised by the session after the user\'s yes ("'; const tail = `"): cheapest host ${hostName} (openrouter.ai endpoints list)`;
  const room = NOTE_MAX - lead.length - tail.length;
  return `${lead}${reason.length <= room ? reason : `${reason.slice(0, room - 1).replace(/[\ud800-\udbff]$/, '').trimEnd()}…`}${tail}`;
}

/** The facts both steps need, or a refusal. `seatsOf(meta)` -> the chain's seats (resolved) or null; `fetchImpl` is injected for tests. */
async function facts({ runsDir, work, run, seatsOf, fetchImpl, sameFolder }) {
  const runDir = join(runsDir, run);
  const meta = readRunJson(runDir, 'run.json');
  if (!meta) return refuse('no such run, or its run.json cannot be read. Nothing was written.');
  if (meta.tree) return refuse('this run is a member of a recursive-councils tree: its price is answered through the tree (tree_decide with form "price", or `council tree decide`). Nothing was written.');
  if (isAdviceFolder(runDir)) return refuse('this is an advice run, which has no resume and no price to raise here. Nothing was written.');
  if (lockHolder(runDir)) return refuse('this run is still running; poll run_status(run) and ask again when it has stopped. Nothing was written.');
  if (typeof meta.cwd === 'string' && meta.cwd && !sameFolder(meta.cwd, work)) return refuse('this run was started in a different project folder from this server\'s working folder, so its price rows would be written to the wrong project. Nothing was written.');
  const marker = readStoppedMarker(runDir);
  if (marker?.stoppedBy !== 'price_refused') return refuse('this run is not stopped by a price refusal (run_status shows why it stopped). Nothing was written.');
  const stop = readRunJson(runDir, 'report-partial.json')?.stop;
  if (stop?.kind !== 'price_refused' || typeof stop.seat !== 'string') return refuse('the record of this price refusal cannot be read (report-partial.json). Nothing was written.');
  if (stop.recognised !== true) return refuse('OpenRouter\'s answer for at least one refused seat does not name the price, so this program does not know that a higher price is the cure for the whole stop. Nothing was written.');   // A-DRAFT (4.1, C&C thcmcp-cd ruling 23 Okt 2026): true for a mixed stop too; `recognised` in the stop record is "every seat", and the refusal stays
  if (stop.ownPin === true) return refuse('a price limit that the chain itself sets (the seat\'s own provider.max_price) is changed in the chain, not in pricing.user.json. Nothing was written.');
  const seats = stop.seat.split(', ').map(s => s.trim()).filter(Boolean);
  if (!seats.length || seats.some(s => !s.startsWith('openrouter/'))) return refuse('only OpenRouter seats can be raised here. Nothing was written.');
  const chainSeats = seatsOf(meta);
  if (!chainSeats) return refuse('the chain of this run cannot be read. Nothing was written.');
  const rows = [];
  for (const key of seats) {
    const seat = chainSeats.find(s => `${s.provider}/${s.model}` === key);
    if (!seat) return refuse(`${key} is not a seat of this run's chain. Nothing was written.`);
    const row = effectiveRow('openrouter', key.replace(/^openrouter\//, ''));
    if (!row) return refuse(`${key} has no price row to compare with. Nothing was written.`);
    const found = await cheapestHost(key.replace(/^openrouter\//, ''), { fetchImpl, needs: needsOfSeat(seat, SEAT_DEFAULT_MAX_TOKENS) });
    if (!found.ok) return refuse(`${key}: ${found.why}. Nothing was written.`);
    const pin = { prompt: row.in, completion: row.out };
    if (!(found.host.in > pin.prompt || found.host.out > pin.completion)) return refuse(`${key}: its cheapest host is at or under the price now in force for it, so OpenRouter's host list gives no higher price to offer. Nothing was written.`);
    rows.push({ seat: key, pin, host: found.host });
  }
  const capUsd = typeof meta.maxUsd === 'number' ? meta.maxUsd : null;
  const body = offerWords({ rows, capUsd });
  const quoted = `Run ${run} was stopped because OpenRouter refused ${rows.length === 1 ? 'a seat' : 'seats'} at the price limit.\n${body}\nRaising the price spends nothing by itself.`;
  return { rows, quoted, shown: sha(quoted) };
}

/** -> { refusal } | { step:'quote', ... } | { step:'confirm', raised, next }. */
export async function priceRaiseResult({ runsDir, work, args, seatsOf, fetchImpl, sameFolder }) {
  const f = await facts({ runsDir, work, run: args.run, seatsOf, fetchImpl, sameFolder });
  if (f.refusal) return f;
  if (args.step === 'quote') return { step: 'quote', run: args.run, text: f.quoted, shown: f.shown, instruction: 'Show the user this text and ask whether to raise the price. Call this tool again with step "confirm", `shown` and the user\'s own words as `reason` only after the user has said yes in the chat.' };
  if (args.step !== 'confirm') return refuse('step is "quote" or "confirm". Nothing was written.');
  if (typeof args.shown !== 'string' || args.shown !== f.shown) return refuse('what you quoted has changed (a host price, the run or the price now in force) or is not the text you hold. Nothing was written. Quote again and show the user the new text.');
  const reason = typeof args.reason === 'string' ? blankHiddenChars(args.reason).trim().slice(0, 200) : '';
  if (reason.length < 3) return refuse('confirm needs the user\'s own yes in their words (reason). Nothing was written.');
  // the note lands in pricing.user.json, a project file the user may commit: the same scan and sentence a tree's reasons get (tree-decide-session.js:159)
  { const keyed = textSecretFindings(reason, 'the reason'); if (keyed.length) return refuse(`the reason holds ${keyed.length} credential-shaped string(s): change the text. Nothing was written.`); }
  const raised = [];
  try {
    for (const r of f.rows) {
      const before = effectiveRow('openrouter', r.seat.replace(/^openrouter\//, ''));
      raiseUserPriceRow(work, r.seat, { in: Math.max(r.host.in, before?.in ?? 0), out: Math.max(r.host.out, before?.out ?? 0), note: raiseNote(reason, safeName(r.host.name)) });
      raised.push({ seat: r.seat, in: Math.max(r.host.in, before?.in ?? 0), out: Math.max(r.host.out, before?.out ?? 0) });
    }
  } catch (e) { if (e instanceof UserPriceFileError) return refuse(`${e.message}. ${raised.length ? 'Rows already written stay (a price is only ever raised).' : 'Nothing was written.'}`); throw e; }
  return { step: 'confirm', run: args.run, raised, next: 'Nothing was spent. Call resume_run(run): it stops at the spending-limit gate once more because a price changed, and the person answers that gate.' };
}
