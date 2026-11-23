// 0.8.4 D5a (plan A T4.3, T4.2; STEP3 F3, F10): the pure parts of the MCP tool `stop_decide`, which lets the handling session answer a run's round stop (exit 23: the overseer-round cap, a layer's revision bound, a silent seat)
// in the tree tool's shape: step `quote` returns the exact stop text and its sha256 and decides nothing; step `answer` sends the hash back with the choice and the written reason; step `defer` hands the stop to the person.
// This file holds what needs no file system: which stops the session may decide, the quote and its hash, the checks of what the session writes and the fields the session's answered gate adds to the choice entry (additive, T4.2).
// Reading the run folder and writing the quote's file are src/mcp/stop-decide.js's, through src/run-files.js; the gate is src/stop-gate.js's. Every sentence below that a model or a person reads is A-DRAFT (Review/WORDING_0.8.4.md).
import { sha256Of } from './thin-contract.js';
import { excerptAgentWords } from './excerpt-approval.js';
import { hiddenIn } from './hidden-chars.js';
import { terminalSafe } from './terminal-safe.js';

export const STOP_DECISION_SCHEMA = 'stop-decision/1';
/** The choices the session can give at a round stop. `reopen` is not offered (A-plan T4.3 as STEP3 F3(a) amends it: what a reopen does is lane B's D24; no code exists), a conflict's `prevail` is answered at the terminal. */
/** The record names of the session's route (the gate's vocabulary, F10): kept as names here so the modules that report them do not each spell the channel (test/run-controls.test.js RC-10 fences the callers of the session channel textually). */
export const STOP_ACTOR = 'handling_session';
export const STOP_CHANNEL = 'session';
export const SESSION_CHOICES = Object.freeze(['continue', 'finish']);
/** 0.8.4 (finish at once): the choice the session gives only on the person's own words (step answer with person_words). Not one of SESSION_CHOICES: it is never the session's own choice. */
export const RELAYED_CHOICE = 'finish_now';
/** 0.8.4 (typed = relayed): the three choices a person's words give through the session, at any stop. */
export const RELAYED_CHOICES = Object.freeze(['continue', 'finish', 'finish_now']);
export const ADVISOR_STATES = Object.freeze(['consulted', 'none', 'unavailable']);
export const REASON_MAX = 1200;           // code points; two or three sentences are asked for, this is a ceiling
export const ADVISOR_SAID_MAX = 900;      // "at most three sentences" (T4.2), as a ceiling
export const QUOTE_FILE = /^stop-quote-(\d{4})\.md$/;
export const quoteFileName = n => `stop-quote-${String(n).padStart(4, '0')}.md`;
/** The next free number given the names in the run folder (the quote of a stop is kept as a numbered file: the gate's text, never deleted). */
export const nextQuoteNumber = names => 1 + Math.max(0, ...names.map(n => Number(QUOTE_FILE.exec(n)?.[1] ?? 0)));

/** The actor and the channel the CLI route records for a choice typed at the terminal (T4.2: the CLI cannot tell a person from an agent with a shell). The channel names are the gate's (F10): cli | elicitation | session. */
export const cliChoiceFields = at => ({ actor: 'unknown', channel: 'cli', at });

/** The five chooser values (T4.2, A-DRAFT) every banner and dissent block prints; used by the quote's "choices already made" lines. */
export function chooserOf(entry) {
  if (entry?.relayed === true) return "the person's words, relayed by the handling session";   // 0.8.4 (finish at once, A-DRAFT LAD-F13): the line a person reads in the quote's "Choices already made" and the board; first, because a relayed entry's actor is the person
  if (entry?.actor === 'person') return 'the person';
  if (entry?.actor === 'handling_session') {
    if (entry.over_disagreement === true) return "the handling session, its advisor disagreeing on whether this was the person's";
    return entry.advisor === 'consulted' ? 'the handling session, with its advisor' : 'the handling session, without an advisor';
  }
  return 'a choice typed at the terminal';
}

/** The refusal of a stop that is the person's: the hard stop after seven overseer rounds or a scan hit (A-DRAFT; one source for classifyStop and for the hard-stop check of the tool). */
export const personStopRefusal = by => `This stop is the person's (${by === 'person_hard_stop' ? 'the hard stop at seven overseer rounds' : 'a scan hit'}). Tell the person it is waiting; they answer it in the dialog or at the terminal. Nothing was recorded.`;   // A-DRAFT

/**
 * Which stop is this, and is it one the session may decide? `status` is the run's derived state (src/run-status.js), `awaiting` the excerpt wait (awaitingExcerptApproval(dir)) or null, `marker` the stop marker
 * (readStoppedMarker) or null, `member` true for a member of a recursive-councils tree, `command` builds the terminal command of an excerpt gate.
 * -> { ok: true } | { ok: false, code, refusal }. The excerpt approval is checked FIRST: a run can carry an excerpt gate and a round stop, and the person's approval comes before anything else (C&C's obligation of 4 Nov 2026).
 */
export function classifyStop({ status, awaiting = null, marker = null, member = false, command = () => '', run = '<run folder>', secretMarker = true, secretRecord = false, secretBesideSpending = false } = {}) {
  if (awaiting) {
    const words = excerptAgentWords(awaiting.status, command(awaiting));
    return { ok: false, code: 'excerpt_approval', refusal: `This stop is the person's (an approval of excerpts of their project; the run is stopped at it). It ${words.phrase}. ${words.tail} Nothing was recorded.` };   // A-DRAFT
  }
  if (member) return { ok: false, code: 'tree_member', refusal: 'This run is a member of a recursive-councils tree: its stops are answered through the tree (the tree_decide tool, or council tree decide). Nothing was recorded.' };   // A-DRAFT
  // 0.8.4 (Q9, the person's yes of 10 Nov 2026): a found-secret pause is the person's alone, and the handling session may RELAY the person's own choice (continue, finish, finish_now or drop) with their words, as at a spending stop. Both files must be there, the record whole, and no spending stop's files beside them (fail closed).
  if (status === 'paused_secret' && secretMarker && secretRecord && !secretBesideSpending) return { ok: true, secret: true };
  if (status === 'paused_secret') return { ok: false, code: 'secret_pause', refusal: secretMarker
    ? `This pause is the person's (a credential-shaped string in the text about to be sent), and this tool cannot take their choice for it now: its pause record cannot be read, or a spending stop's files lie beside it. Tell the person it is waiting; the commands are in STOPPED-secret.md in runs/${run}, and \`council --resume runs/${run} --continue\` sends the text as it stands. Nothing was recorded.`   // A-DRAFT (LAD-Q9-3)
    : `This run holds the record of a pause at a credential-shaped string (secret-stop.json in runs/${run}) without the marker that goes with it, so it is probably a leftover and no pause waits. This tool answers nothing here. A resume of the run (resume_run, or at a terminal) treats the record as nothing and removes it with the run's other stop files once it goes on past the limit screen or ends the run on a recorded finish; a resume that stops at the limit screen leaves it in place. If the text still holds the string, the run pauses again, and the person answers that. Nothing was recorded.` };   // A-DRAFT (LAD-R17)   // A-DRAFT (LAD-F18; 0.8.4, C&C 10 Nov: the credential pause keeps its terminal path until Muad answers whether a relayed continue is his explicit choice there)
  const by = marker?.stoppedBy ?? null;
  if (status === 'owner_paused' && by === 'owner_pause') return { ok: true };   // 0.8.4 (ladder unit): the owner pause is a stop only the person decides; the session relays (src/mcp/stop-decide.js)
  if (status === 'awaiting_choice' && (by === 'overseer_cap' || by === 'layer_bound' || by === 'stall_stop')) return { ok: true };   // 0.8.4 26b: a stall the run could not pass up (src/overseer-rounds.js stall_stop, S5) is a choice stop like the other two
  // 0.8.4 (relay of --finish-now at a spending stop): a run stopped at its spending limit (STOPPED-budget.json) is a stop the person alone decides, and the session relays the person's own choice to END it here (finish_now, or finish inside the rounds) with their words; a raise stays the person's number (resume_run with their words). Quoted through the same person-only stop gate as the owner pause.
  if (status === 'budget_stopped' && by === null) return { ok: true, budget: true };
  if (by === 'budget' || status === 'budget_stopped' || status === 'awaiting_user_cap') return { ok: false, code: 'spending_limit', refusal: "This stop is the person's (the spending limit). Tell the person it is waiting: they raise the limit at the terminal or in the dialog, or end the run here (finish_now, with their words). To use a total they have said in this conversation, call resume_run with max_usd and their own words in person_words. Nothing was recorded." };   // A-DRAFT
  if (by === 'conflict') return { ok: false, code: 'conflict', refusal: "This stop is a conflict between objections, which stop_decide does not answer: the person answers it at the terminal with `council --resume <run folder> --prevail n=<objection id>|neither`. Nothing was recorded." };   // A-DRAFT
  if (by === 'person_hard_stop' || by === 'key_shape' || by === 'scan_hit') return { ok: false, code: 'person_stop', refusal: personStopRefusal(by) };
  return { ok: false, code: 'not_a_choice_stop', refusal: `This run is not stopped at a choice the handling session can give (its state is ${JSON.stringify(status ?? 'unknown')}). Nothing was recorded.` };   // A-DRAFT
}

const cut = (s, n) => { const chars = [...String(s ?? '').replace(/\s+/g, ' ').trim()]; return chars.length > n ? `${chars.slice(0, n - 1).join('')}…` : chars.join(''); };

const dollars = n => '$' + n.toFixed(2);
/**
 * The money figures of the stop (A-plan T4.2, T4.5): what the run has counted, what its limit leaves, and what ONE MORE CLIMB is expected to cost. Each is a number or null (not known). Pure.
 *  - `spent` is the run's own figure ({ usd, unknownFigures } from src/spend.js runSpendOf: the one `run_status` and `--spend` use, unsettled reservations at their worst case included); a figure with an unreadable part is not known.
 *  - `capUsd` is the limit on record in the gate ledger (src/stop-gate.js runLimitUsd) or null.
 *  - the expected cost is MEASURED, not the dry run's assumption (Muad's standing rule of 28 Oct), and only at a stop at the overseer-round cap (where a continue buys one more climb): what the last COMPLETED CLIMB of this run cost, that is every stage of the passes of the stopped overseer round (the partial
 *    report's `layers` say which passes belong to it; an unlayered run has one pass). A stage counts when its label names its pass (panel, revise, rule, critique, allocator, conflict, ldebate, lreply). It is known only when
 *    every such stage was priced and no stage of a layer exchange has a label that does not name its pass; otherwise null. `stop` is the stop as the partial report holds it.
 */
const CLIMB_STAGE = /^(panel|revise|rule|critique|allocator|conflict|ldebate|lreply)-(\d+)(?:-|$)/;
export function climbFigures({ partial, spent = null, capUsd = null, stop = null } = {}) {
  const round = n => Math.round(n * 1e6) / 1e6;   // money sums carry float noise; a microdollar is the ledger's own unit
  const counted = spent && Number.isFinite(spent.usd) && spent.unknownFigures === 0 ? round(spent.usd) : null;
  const left = counted !== null && Number.isFinite(capUsd) ? Math.max(0, round(capUsd - counted)) : null;
  const stages = Array.isArray(partial?.stages) ? partial.stages : [];
  const labelOf = st => (typeof st?.label === 'string' ? st.label : '');
  const roundOf = st => { const m = CLIMB_STAGE.exec(labelOf(st)); return m ? Number(m[2]) : null; };
  // at a stop at a layer's revision bound the round stopped partway up: a continue gives that layer its bound again in the same round, it does not run a climb (a restart from layer 1 is T4.4, not built), so no climb figure applies
  if (stop?.kind !== 'overseer_cap') return { counted, left, climb: null };
  if (stages.some(st => /^(ldebate|lreply)-/.test(labelOf(st)) && roundOf(st) === null)) return { counted, left, climb: null };
  let passes;
  if (Array.isArray(partial?.layers)) passes = partial.layers.filter(l => l && l.overseer_round === stop?.overseer_round && Number.isInteger(l.round)).map(l => l.round);
  else { const all = stages.filter(st => /^panel-/.test(labelOf(st))).map(roundOf).filter(n => n !== null); passes = all.length ? [Math.max(...all)] : []; }
  const own = stages.filter(st => roundOf(st) !== null && passes.includes(roundOf(st)));
  const priced = st => st && typeof st === 'object' && st.priced === true && Number.isFinite(st.usd);
  const climb = passes.length && own.length && own.every(priced) ? round(own.reduce((n, st) => n + st.usd, 0)) : null;
  return { counted, left, climb };
}
/** The quote's money line (A-plan T4 wording, A-DRAFT). */
export function climbLine({ counted, left, climb, kind = 'overseer_cap', hard = false }) {
  const f = n => (n === null ? 'not known' : dollars(n));
  const head = `Counted so far: ${f(counted)}. Your limit leaves: ${f(left)}.`;
  // 0.8.4 26b (R515, C&C: the line must be TRUE; keyed on the stop KIND, never on climb === null): at a stall or a layer's revision bound a continue is not a climb, so there is no climb clause and no reason is asked for a figure that is not there.
  if (kind === 'stall_stop' || kind === 'layer_bound' || kind === 'owner_pause') return head;   // A-DRAFT (a pause is continued by resuming it: no climb figure)
  const climbClause = ` One more climb is expected to cost: ${f(climb)}${climb === null ? ' (no climb of this run was measured with every seat priced)' : ' (what the last climb of this run cost)'}.`;
  // the hard stop (isHardStop): a continue there is a climb, so the figure stays; the closing sentence goes, because the session cannot answer there
  if (hard) return head + climbClause;   // A-DRAFT
  return `${head}${climbClause} In your reason, say whether the limit left covers it; if it does not, you may still continue, and the run stops at the limit for the person, with nothing lost.`;   // A-DRAFT
}

/**
 * The quote of a round stop, line by line (A-plan T4 wording, A-DRAFT), with the hash of the text above its last line. `stopId` is stopIdOf(stop); `stopSentence` is the sentence the run wrote
 * (STOPPED-*.json reason); `objections` the open objections of the run's last critique ([{ id, criterion, problem }]) or null when they cannot be read; `made` the choices already recorded in run.json (roundChoices);
 * `plan` { name, sha256 } of the draft as it stands, or null. Pure: the same inputs give the same text, so the hash an answer sends back is checked by rebuilding the quote from the run's state at that moment.
 */
export function buildStopQuote({ stopId, stopSentence, objections = null, made = [], money = null, plan = null, extraLines = [], choices = SESSION_CHOICES } = {}) {
  // `choices`: the choices this stop offers, from the stop (src/mcp/stop-decide.js: finish only at a stall with no pass left, else continue and finish). The hard stop after seven overseer rounds lists both for the person (Muad's word of 05 Nov 2026, "1: a", which replaced R396a's continue-only quote).
  const lines = [`Stop ${stopId}: ${cut(stopSentence, 1500)}`, `Choices: ${choices.length ? choices.join(' | ') : 'none'}.`];   // 'none': WORDING S16-w47 (a stop that leaves the session no choice of its own)
  if (Array.isArray(objections)) {
    lines.push(objections.length ? 'Open objections a finish would hand over (read from the last critique of the stopped run; the finish may count them differently):' : 'Open objections a finish would hand over: none in the last critique.');
    for (const o of objections) lines.push(`${cut(o.id, 40)}: ${cut(o.criterion, 80)}: ${cut(o.problem, 300)}`);
  } else lines.push('Open objections a finish would hand over: not read (the stopped run\'s last critique cannot be read).');
  lines.push(made.length ? 'Choices already made in this run:' : 'Choices already made in this run: none.');
  for (const c of made) lines.push(`${c.stop}: ${c.choice} by ${chooserOf(c)}, ${c.at ?? 'no time recorded'}.`);
  if (money) lines.push(climbLine(money));
  lines.push(plan ? `The plan: ${plan.name}, sha256 ${plan.sha256}.` : 'The plan: no draft file is in the run folder.');
  lines.push(...extraLines);
  const body = lines.join('\n');
  const sha256 = sha256Of(body);
  return { body, sha256, text: `${body}\nsha256 of the text above: ${sha256}. Pass this hash back with your answer in step 'answer'; an answer with another hash is refused.` };   // A-DRAFT
}

/** WORDING S16-w34b: the quote's count line at a stop for a seat that gave no usable reply, and, at the count, the line that sends a further continue to the person. */
export const noReplyCountLines = (bySession, cu) => [`Continues you have made at stops where a seat gave no usable reply: ${bySession} of ${cu}.`, ...(bySession >= cu ? ["That is as many as the handling session may decide on its own. A further continue is the person's decision: if you and your advisor both find that it is, hand this stop to the person with step defer, and say why."] : [])];
/** WORDING S16-w47: the line that follows `Choices: none.` */
export const NO_CHOICE_LEFT_LINE = 'You have no choice left at this stop on your own authority: hand it to the person with step defer.';
/** WORDING S16-w35 / w36d / w46: the session's refusals at a stop for a seat that gave no usable reply. */
export const thirdContinueRefusal = finishOpen => `You have already continued twice at stops where a seat gave no usable reply, which is as many as the handling session may decide on its own. A further continue is the person's: if you and your advisor both find that it is, hand this stop to the person with step defer and say why. ${finishOpen ? 'Finish stays open to you. ' : ''}Nothing was recorded.`;   // WORDING S16-w35b
export const FINISH_NEEDS_FINDING_REFUSAL = "You may not end this run on your own at this stop until you have made two continues at stops of this kind in this run. Before that, ending it is the person's decision when you and your advisor both find it so: hand this stop to the person with step defer and say why, or give continue. Nothing was recorded.";
/** 0.8.4 (C&C 10 Nov, A-DRAFT LAD-P4): the last line of the quote of a stop that is the person's alone, in place of the question the session answers elsewhere. */
export const PERSON_ONLY_QUOTE_LINE = "This stop is the person's alone: the session gives no answer of its own here. Ask the person what they want, and relay their own choice with their words in person_words.";
export const NO_CHOOSER_REFUSAL = 'This run is paused with no handling session, so nobody is named to choose here. Nothing was recorded.';
/** The question every stop is put to before the session answers (A-plan T4.1, A-DRAFT): the last line of the quote's body. */
export const PERSON_QUESTION_LINE = "Before you answer, write whether this choice is the person's: a trade-off in their project that the request, the criteria and the shown project text do not settle, and that turns on what they want rather than on what is true. Ask your advisor the same question, if you have one. If you both say yes, use step 'defer'.";   // A-DRAFT

/** The refusal of an answer that carries another hash than the stop's text has now (A-plan T4 wording, A-DRAFT). */
export const staleHashRefusal = (sent, now) => `This answer carries hash ${String(sent).slice(0, 64)}, but the stop's text now has hash ${now}: the stop changed after your quote. Call step 'quote' again, read the new text, and answer with its hash. Nothing was recorded.`;

const textLen = s => [...String(s)].length;
const looksNonPrintable = s => terminalSafe(s) !== String(s) || hiddenIn(s, { allowQuiet: true }) !== null;   // the two calls the tool's own text check makes (invisibleTextRefusal, src/tree-session-draft.js): controls and direction characters, then every hidden character except the quiet joiners. No list of its own (test/hidden-chars.test.js)

/**
 * What the session writes in step answer/defer: the reason (required, the session's own words), the advisor state and what the advisor said. -> { ok: true, fields } | { ok: false, refusal }. The text checks the tree
 * channel applies to a session's written text (invisible and direction characters, credential shapes) are the tool's, in src/mcp/stop-decide.js, which has the scanners; this file checks shape and size only.
 */
export function checkSessionFields({ reason, advisor, advisor_said: advisorSaid } = {}) {
  if (typeof reason !== 'string' || !reason.trim()) return { ok: false, refusal: "The session's written reason is missing: say in a sentence or two why you give this choice. Nothing was recorded." };   // A-DRAFT
  if (textLen(reason) > REASON_MAX) return { ok: false, refusal: `The reason is ${textLen(reason)} characters; at most ${REASON_MAX}. Say it in two or three sentences. Nothing was recorded.` };   // A-DRAFT
  if (!ADVISOR_STATES.includes(advisor)) return { ok: false, refusal: `advisor must be one of ${ADVISOR_STATES.join(', ')}: ${ADVISOR_STATES[0]} when you asked your advisor and it answered, ${ADVISOR_STATES[1]} when you have none, ${ADVISOR_STATES[2]} when it did not answer. Nothing was recorded.` };   // A-DRAFT
  const said = typeof advisorSaid === 'string' ? advisorSaid.trim() : '';
  if (advisor === 'consulted' && !said) return { ok: false, refusal: "advisor_said is missing: write what your advisor said, in its words, in at most three sentences. Nothing was recorded." };   // A-DRAFT
  if (advisor !== 'consulted' && said) return { ok: false, refusal: `advisor_said is only for an advisor that answered; with advisor ${advisor} leave it empty. Nothing was recorded.` };   // A-DRAFT
  if (textLen(said) > ADVISOR_SAID_MAX) return { ok: false, refusal: `advisor_said is ${textLen(said)} characters; at most ${ADVISOR_SAID_MAX}. Nothing was recorded.` };   // A-DRAFT
  if (looksNonPrintable(reason) || looksNonPrintable(said)) return { ok: false, refusal: 'The text holds control or direction characters. Write it as plain text. Nothing was recorded.' };   // A-DRAFT
  return { ok: true, fields: { reason: reason.trim(), advisor, advisor_said: said } };
}

/** The fields the choice entry in run.json gets from the session's answered gate (src/gate.js stopDecisionAnswerOf): additive (T4.2), the gate id names the ledger line that is the authority. */
export const entryFieldsOf = a => ({ actor: a.actor, channel: a.channel, at: a.at, reason: a.reason, advisor: a.advisor, advisor_said: a.advisor_said, person_test: a.person_test, over_disagreement: a.over_disagreement, gate: a.gate, ...(a.relayed === true ? { relayed: true, person_words: a.person_words } : {}) });   // 0.8.4 (finish at once): a relayed answer keeps the person's words on the entry
