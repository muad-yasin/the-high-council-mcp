// A price-refused seat PAUSES the run and asks the person (0.8.3 A3a commit 2; Muad 18 Okt 2026: "pause the run and ask the user how to proceed with a recommendation"; gate note
// Review/Build_0.8.3/m7/A3a_Refusal_Pause_Gate_Note.md, C&C PASS ON CONDITIONS C1-C3). Every OpenRouter call carries a price pin (src/price-pin.js). When OpenRouter answers a PINNED call with HTTP 404,
// invoke() (src/chain.js) throws PriceRefused instead of letting the 404 become a provider error: a provider error is an abstention at the judge, debate and reply seats, which is a silent skip
// of a voice the person chose. PriceRefused is controlFlow (rethrowControlFlow passes it on), so it stops the run at exit 24 (STOPPED-price_refused.json, src/cli.js) and the person decides.
//
// Contract (pure, except the two module-level seat-skip choices, which follow chain.js's setBudget / setCache pattern):
//   PriceRefused({ seat, label, pin, row, status, said, recognised, lab, ownPin, ownFields })   controlFlow Error. `recognised`: the 404 body names the max price (the one probe's wording); anything else is the same stop with NO recommendation.
//   markSkippable(err, { voices, lab })     called by a catch that WOULD abstain (a debate post, a reply round; NOT a panel judge: the panel agrees only when every judge is heard): says "this stage can do without this seat" and how many OTHER voices of its group remain.
//   recommendationOf(err)                   -> { kind: 'skip' | 'row' | 'none' }: skip when the stage can do without the seat AND at least 2 other voices stay (Muad 15 Okt: no single-judge layer), else the user row.
//   priceRefusedWords(err, { runPath, command })     -> the sentence a person reads (A-DRAFT). `runPath` set = a resumable run (names --resume and --skip-seat); null = an advice call (not resumed). `command` = how the CLI is invoked.
//   priceRefusedAdviceFailureWords(err, { runPath, spent, callsPaid })   -> the sentence an ADVICE call that failed whole reads (A-DRAFT; Muad 18 Okt 2026: "judge refused for its price should fail the whole call and tell the user about it, instead of sending half a call"). It names the refused seat(s), what was spent, and the run folder where the paid answers sit (not delivered).
//   setSeatSkips(list) / seatSkipChoice(seat)   run.json `seatChoices` entries { seat, choice: 'skip', via: 'cli', at, label } (no actor is recorded: nothing checks that a person typed the flag, as for roundChoices): a recorded skip makes the seat abstain from the stage that was refused (`label`, the call label of the refusal) to the END of the run (the stage's own catch counts it as an unreachable seat); the stages before it replay from disk as they ran, so what they cost stays counted. An entry without a `label` (written before this field) skips from the start.
//   seatSkipActive(seat, labels)                 the skip choice when the seat is skipped AT THIS POINT of the run (the replay has reached the recorded label, one of `labels` being the labels of the call about to be made, and stays armed after), else null.
//   skipKeyOf(seat)                         the key a choice names: lab/provider/model.
import { SHIPPED_PRICES, isUserPriced } from './price-table.js';

export const PRICE_REFUSED_CAUSE = 'price_refused';
// The one probe (18 Okt 2026, m7/a3a/PROBE_RESULT.md): HTTP 404 "No endpoints found that satisfy the max price for this request".
const MAX_PRICE_WORDS = /max price/i;
const SAID_CHARS = 300;

export const skipKeyOf = seat => `${seat?.lab || seat?.provider}/${seat?.provider}/${seat?.model}`;
const money = n => (typeof n === 'number' ? `$${n}` : '?');
const pinWords = pin => (pin ? `${money(pin.prompt)} in / ${money(pin.completion)} out per million tokens` : 'its table price');

export class PriceRefused extends Error {
  constructor({ seat, label, pin, row = null, status = 404, said = '', recognised = false, lab = null, ownPin = false, ownFields = null }) {
    super('');
    this.controlFlow = true;
    this.seat = seat;                  // 'provider/model'
    this.lab = lab;
    this.label = label;
    this.pin = pin;                    // the max_price object the call carried
    this.row = row;                    // the table row at that moment ({ in, out }) or null
    this.status = status;
    this.said = String(said ?? '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, SAID_CHARS);   // the provider's text: control characters (an ESC sequence reaches a terminal) become spaces
    this.recognised = recognised === true;
    this.ownPin = ownPin === true;     // the seat's own provider.max_price set (a field of) the pin: the pin is then not the table price, and the words say so
    this.ownFields = Array.isArray(ownFields) ? ownFields.filter(f => f === 'prompt' || f === 'completion') : null;   // which of the two fields the seat set (ownPinOf's keys); null = not known (a record from before this field), and the words then allow that a field is left out
    this.skippable = false;
    this.voices = 0;
    this.noSkip = 'this stage has no seat to spare';   // why the stage cannot do without the seat (the panel site says it in its own words)
    this.message = priceRefusedWords(this, { runPath: null });
  }
}

/** True when the 404 body is the wording of the one probe. */
export const isMaxPriceRefusal = text => MAX_PRICE_WORDS.test(String(text ?? ''));

export function markSkippable(err, { voices = 0, lab = null } = {}) {
  if (!(err instanceof PriceRefused)) return err;
  err.skippable = true;
  err.voices = Number.isInteger(voices) && voices > 0 ? voices : 0;
  if (lab) err.lab = lab;
  err.message = priceRefusedWords(err, { runPath: null });
  return err;
}

/** Every seat of the stage the stop names: the first refusal and the ones that rode along (chain.js settleAll `also`). */
export const refusedSet = err => [err, ...(Array.isArray(err.also) ? err.also : [])];
/** Seats of the group that stay if every refused seat is skipped (`voices` counts the OTHER seats of the group, not yet skipped). */
export const leftAfterSkip = err => err.voices + 1 - refusedSet(err).length;
/** The stage can do without every refused seat AND at least one other seat of its group stays (the person may skip even where it is not recommended). */
export const canSkip = err => refusedSet(err).every(e => e.skippable === true) && leftAfterSkip(err) >= 1;

export function recommendationOf(err) {
  const set = refusedSet(err);
  if (!set.some(e => e.recognised)) return { kind: 'none' };
  // A-DRAFT (4.1, C&C thcmcp-cd ruling 23 Okt 2026): a MIXED set (some seats name the max price, some do not) is recommended a raise for the recognised seats only, never a skip: --skip-seat takes every seat of the stop, the unrecognised one too.
  if (!set.every(e => e.recognised)) return { kind: 'row' };
  return canSkip(err) && leftAfterSkip(err) >= 2 && refusedSet(err).every(e => e.recognised) ? { kind: 'skip' } : { kind: 'row' };
}

// The copyable example of the price row: ONE JSON object for every refused seat, with numbers that are NOT the table price (twice it; 1 and 1 where no row is known), so a person who copies it unchanged does not recreate the refused pin.
// A seat with NO table row gets no number at all (a copied number would become the price the cap projects with, and a guess could be far under the model's real price): it is named in a plain line instead.
const rowOf = e => (e.row && typeof e.row.in === 'number' && typeof e.row.out === 'number' ? e.row : null);
const exampleRows = set => `{ ${set.map(e => {
  const r = rowOf(e);
  const twice = v => Math.round(v * 2 * 1e6) / 1e6;
  return `${JSON.stringify(`openrouter/${String(e.seat).replace(/^openrouter\//, '')}`)}: { "in": ${twice(r.in)}, "out": ${twice(r.out)} }`;
}).join(', ')} }`;

// A-DRAFT (Builder A, 18 Okt 2026): every sentence below is new person-facing text for the later Fable pass.
export function priceRefusedWords(err, { runPath = null, command = 'council' } = {}) {
  const checked = SHIPPED_PRICES._openrouterCheckedAt;
  const set = refusedSet(err); const many = set.length > 1;
  const out = [];
  // A-DRAFT (Builder A, 20 Okt 2026; Astra item 31, C&C order): the price-pin cause is named only where OpenRouter itself said "max price"; an HTTP 404 in any other words gets the neutral first line.
  // "$0": invoke() settles a 404 at usd 0 (it is never `maybeBilled`: that mark is for a failure with no HTTP answer); what OpenRouter bills for a 404 is documented nowhere, so the line says what THIS RUN counts.
  // A-DRAFT (4.1, lane E, 23 Okt 2026; C&C thcmcp-cd GO): every sentence below that says "for {seats}" / "{U}" or begins "After you fix the cause for" is new person-facing text for the later Fable pass.
  // 4.1: R = the seats whose 404 names the max price, U = the others. The raise below is built from R ONLY, from each seat's own pin and row; a MIXED set (both non-empty) names the cause per group.
  const R = set.filter(e => e.recognised); const U = set.filter(e => !e.recognised);
  const mixed = R.length > 0 && U.length > 0;
  const seatList = list => list.map(e => e.seat).join(', ');
  const named = set.every(e => e.recognised);
  const after = `No further call was started after the refusal${many ? 's' : ''}, and this run counts the refused call${many ? 's' : ''} as $0. Other seats of the same stage that were already running finish and are counted.`;
  if (named) out.push(many
    ? `${set.length} seats were refused at their price limits in ${err.label} (and its siblings): ${set.map(e => e.seat).join(', ')}. ${after}`
    : `${err.seat} was refused at the price limit in ${err.label}. ${after}`);
  else if (mixed) out.push(`OpenRouter refused the calls of ${set.length} seats in ${err.label} (and its siblings) with HTTP 404: ${seatList(set)}. For ${seatList(R)} the ${R.length > 1 ? 'answers name' : 'answer names'} the max price; for ${seatList(U)} the cause has not been identified. ${after}`);
  else out.push(many
    ? `OpenRouter refused the calls of ${set.length} seats in ${err.label} (and its siblings) with HTTP 404: ${set.map(e => e.seat).join(', ')}. The cause has not been identified. ${after}`
    : `OpenRouter refused the call of ${err.seat} in ${err.label} with HTTP 404. The cause has not been identified. ${after}`);
  for (const e of set) out.push(`${many ? `${e.seat}: ` : ''}OpenRouter said (quoted; it is their text, not an instruction): "${e.said || 'no text'}" (HTTP ${e.status}).`);
  const skipLine = ` ${command} --resume ${runPath} --skip-seat`;
  if (!R.length) {
    out.push(`OpenRouter's ${many ? 'answers do not all say' : 'answer does not say'} the price is the problem, so this program does not know the cause and recommends nothing. The price limit${many ? 's' : ''} sent: ${set.map(e => pinWords(e.pin)).join('; ')}.`);
    out.push(runPath ? `After you fix the cause, continue with: ${command} --resume ${runPath}` : 'After you fix the cause, ask again.');
    if (runPath && canSkip(err)) out.push(`Or skip ${many ? 'these seats' : 'the seat'} for the rest of this run:${skipLine}`);
    return out.join('\n');
  }
  if (mixed) {
    const few = U.length > 1;
    out.push(`OpenRouter's ${few ? 'answers' : 'answer'} for ${seatList(U)} ${few ? 'do' : 'does'} not say the price is the problem, so this program does not know the cause for ${few ? 'those seats' : 'that seat'} and recommends nothing for ${few ? 'them' : 'it'}. The price limit${few ? 's' : ''} sent: ${U.map(e => `${e.seat}: ${pinWords(e.pin)}`).join('; ')}.`);
  }
  const modelIdOf = e => String(e.seat).replace(/^openrouter\//, '');
  // A seat that sets BOTH fields leaves none out (A-DRAFT 23 Okt 2026, C&C thcmcp-cd FIX 2): the sentences about a field left out are printed only for a seat that may leave one out (ownFields not both, or not known)
  const leavesOut = e => !(Array.isArray(e.ownFields) && e.ownFields.includes('prompt') && e.ownFields.includes('completion'));
  const sourceOf = e => (e.ownPin ? `set by the seat's own provider.max_price in the chain${leavesOut(e) ? ' (a field it leaves out comes from the price table)' : ''}` : isUserPriced('openrouter', modelIdOf(e)) ? 'from your pricing.user.json' : `from the shipped price table, last compared with OpenRouter's list on ${checked ?? 'an unknown date'}`);
  out.push(`Every OpenRouter call carries a price limit: the seat's own provider.max_price where the chain sets one, otherwise the model's price from the price table (${R.map(e => `${many ? `${e.seat}: ` : ''}${pinWords(e.pin)}, ${sourceOf(e)}`).join('; ')}). OpenRouter found no host for ${mixed ? seatList(R) : many ? 'those models' : 'the model'} at or under ${R.length > 1 ? 'those prices' : 'that price'} for this request.`);
  const rec = recommendationOf(err);
  const these = mixed ? seatList(R) : many ? 'these seats' : 'this seat';   // 4.1: a mixed set names the recognised seats (the sentence must not read as covering the unrecognised one)
  // A seat's own provider.max_price is sent exactly as typed (src/price-pin.js): a pricing.user.json row does not change a field it sets, so such a seat is kept out of the row example and named in its own line. A MIXED set (own-pin and table seats) gets one recommendation per source (A-DRAFT).
  const ownSeats = R.filter(e => e.ownPin); const tableSeats = R.filter(e => !e.ownPin);
  const ownHow = "the fields of the seat's own provider.max_price in your chain (the stages already finished are kept)";
  const how = !ownSeats.length ? (mixed ? `raise ${seatList(tableSeats)} in a pricing.user.json row${tableSeats.length > 1 ? ' for each' : ''}` : `raise it in a pricing.user.json row${many ? ' for each' : ''}`) : !tableSeats.length ? (mixed ? `raise ${seatList(ownSeats)} through ${ownHow}` : `raise ${ownHow}`) : `raise ${tableSeats.map(e => e.seat).join(', ')} in a pricing.user.json row${tableSeats.length > 1 ? ' for each' : ''}, and ${ownSeats.map(e => e.seat).join(', ')} through ${ownHow}`;
  if (rec.kind === 'skip') out.push(`Recommended: skip ${these} for the rest of this run. Skipping needs no price change and spends nothing more on the skipped seat${many ? 's' : ''}; earlier costs stay counted, and the other ${leftAfterSkip(err)} seats of the group stay.`);
  else out.push(`Recommended: if you accept the higher price, ${how}.${canSkip(err) ? (mixed ? ` (Skipping is not recommended here: a skip drops all ${set.length} refused seats, including ${seatList(U)}, whose cause is not known.)` : ` (Skipping ${these} is not recommended: it would leave fewer than 2 other seats in the group.)`) : ` (${err.noSkip}, so ${many ? 'they cannot' : 'it cannot'} be skipped.)`}`);
  const withRow = tableSeats.filter(rowOf); const noRow = tableSeats.filter(e => !rowOf(e));
  const tableWords = withRow.map(e => `${many ? `${e.seat}: ` : ''}$${rowOf(e).in} in / $${rowOf(e).out} out per million tokens`).join('; ');
  const noRowWords = noRow.length ? ` For ${noRow.map(e => e.seat).join(', ')} no table price is known: add a row with the model's listed input and output prices (no number is suggested here).` : '';
  const ownWords = ownSeats.length ? ` For ${ownSeats.map(e => e.seat).join(', ')}: the price limit comes from the seat's own provider.max_price in the chain, and a pricing.user.json row does not change a field it sets, so raise those fields in your chain.${ownSeats.some(leavesOut) ? ' A field the seat leaves out is priced from the price table: raise that one with a pricing.user.json row.' : ''} The stages already finished are kept.` : '';
  const rowPart = tableSeats.length ? `To raise the price: in your project folder add the model's current listed price, or a higher one, to pricing.user.json${withRow.length ? `, for example ${exampleRows(withRow)} (US dollars per million tokens; the number is on the model's page at openrouter.ai). Example only: copied unchanged it sets the limits to twice today's table values (shown below). Check them before use. Today's table price is ${tableWords}; only a higher number changes anything` : ' (US dollars per million tokens; the number is on the model\'s page at openrouter.ai)'}.${noRowWords}` : 'To raise the price:';
  out.push(`${rowPart}${ownWords} A higher price lets OpenRouter use dearer hosts. Every call is counted at that price against your spending limit, both as the worst case checked before the call and as the cost recorded after it. The recorded cost is the tokens used times the price you typed, so it can read higher than the bill if a cheaper host served the call; the limit you typed does not change, so a tight limit may stop the run sooner. Other routes: check whether a newer THC release has a newer price table, or copy the chain and give ${these} its own provider.max_price.`);
  if (runPath && ownSeats.length) out.push('To use the copy with --resume (only for a chain that came with the package; a chain of your own is changed where it is): --resume reads the chain by the name recorded in the run and looks first in the chains/ folder of the project the run was started in, so save the copy there under the same name. The resume then stops once at the spending-limit screen, because the chain file changed, and you type the limit again.');
  // A mixed set's continue and skip lines begin as a tree member's filter expects (tree-price-stop.js memberReasonLines drops "After you fix the cause" and "Or skip "): a tree member is resumed with `council tree resume`, not --resume.
  if (runPath && mixed) {
    out.push(`After you fix the cause for ${seatList(U)} and raise ${seatList(R)} if you accept the higher price, continue with: ${command} --resume ${runPath}`);
    if (canSkip(err)) out.push(`Or skip all ${set.length} refused seats for the rest of this run:${skipLine}`);
  } else if (runPath) {
    out.push(`Continue with: ${command} --resume ${runPath}${canSkip(err) ? '   (after the row)' : ''}`);
    if (canSkip(err)) out.push(`Or skip ${these} for the rest of this run:${skipLine}`);
  } else out.push(mixed ? `An advice call is not resumed: after the row is in and the cause for ${seatList(U)} is found, ask for a new quote.` : 'An advice call is not resumed: after the row is in, ask for a new quote.');
  return out.join('\n');
}

// A-DRAFT (Builder A, 18 Okt 2026): new person-facing text for the later Fable pass. An advice call cannot pause and is never delivered in part, so the sentence says what was paid for and where it sits.
// `spent` is the already formatted dollar figure; `callsPaid` counts paid CALLS (a retry, a debate reply and the synthesis each leave their own), not voices.
export function priceRefusedAdviceFailureWords(err, { runPath, spent, callsPaid }) {
  const paid = callsPaid > 0
    ? `${callsPaid} call${callsPaid === 1 ? ' was' : 's were'} already paid for (${spent} spent). ${callsPaid === 1 ? 'Its answer is' : 'Their answers are'} in the folder ${runPath}/ (the advise-*.md files) and ${callsPaid === 1 ? 'was' : 'were'} not delivered: an advice call is never delivered in part.`
    : 'Nothing was spent.';
  return `This advice call ended without a delivered answer, because a seat was refused at its price limit. ${paid}\n${priceRefusedWords(err, { runPath: null })}`;
}

let skips = [];
let armed = new Set();   // the skip keys whose recorded stage the replay has reached (module state like `skips`, reset by setSeatSkips: a test runs many runs in one process)
export function setSeatSkips(list) { skips = Array.isArray(list) ? list.filter(c => c && c.choice === 'skip' && typeof c.seat === 'string') : []; armed = new Set(); }
export function seatSkipChoice(seat) { const k = skipKeyOf(seat); return skips.find(c => c.seat === k) ?? null; }
export function seatSkipActive(seat, labels) {
  const c = seatSkipChoice(seat);
  if (!c) return null;
  if (!armed.has(c.seat)) {
    if (typeof c.label === 'string' && c.label !== '' && !(labels ?? []).includes(c.label)) return null;   // CR-1B-002: a stage BEFORE the refused one replays from disk, paid as it ran
    armed.add(c.seat);
  }
  return c;
}
