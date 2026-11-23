// 0.8.4 D10 (plan A T5.5, the privacy switch), slices 1 and 2b: what asks for the switch (slice 1), and the screen a person reads for one pause and what each of the three answers means for the record's row (2b). Pure and offline; it imports no gate module (the gate scanner of test/gate-answer.test.js, R2, allows only listed importers), so it
// never reads or writes the ledger. The switch's STATE lives in the run's gate ledger (src/gate.js recordExcerptSwitchOn and excerptSwitchOf); this module only decides whether an invocation asks for it. The approval
// approval screen, the list its gate binds and the meaning of the person's three answers are the second half of this file (slice 2b); the gate that carries the answers is src/gate.js (slice 2a).

export const AWAITING_EXCERPT_APPROVAL = 'awaiting_excerpt_approval';

import { sha256Of, SCAN_RESULTS, PERSONAL_DATA_RESULTS } from './excerpt-record.js';
import { held } from './held-roles.js';

/**
 * Is the privacy switch asked for by this invocation? `flag` is whether `--approve-excerpts` was typed; `config` is the chain. The chain turns it on only with the boolean `true`. (A value that is present and not a
 * boolean never gets here: chain-lint's `approve-excerpts` finding is fatal at chain load, "has N problem(s) and will not run", exit 1.) A chain that sets `false`, or nothing, asks for nothing, and neither can turn a
 * switch OFF: this function has no way to say "off". The flag wins the `source` when both ask.
 * -> { on: boolean, source: 'flag' | 'chain' | null }
 */
export function excerptSwitchRequest({ flag, config }) {
  if (flag === true) return { on: true, source: 'flag' };
  if (config && config.approve_excerpts === true) return { on: true, source: 'chain' };
  return { on: false, source: null };
}

// The commands and options that are NOT a start or a resume of a council run. `--approve-excerpts` is on the one list of known options, so every command would accept it; on these it would be read and do nothing, which for a
// privacy switch is the wrong failure (the `--dry` lesson), so it is refused there. test/excerpt-approval.test.js derives the command words from the `argv[0] === '...'` dispatches of src/cli.js and the side options from its top-level `if (argv.includes('--...'))` exits, so a new command or option of those two forms cannot be missed; a side path written another way would have to be added here by hand.
export const SIDE_COMMAND_WORDS = Object.freeze(['accept', 'check-lock', 'contract', 'demo', 'digest', 'doctor', 'export-board', 'fence', 'gate', 'handoff', 'init', 'lint-criteria', 'pause', 'relay-answer', 'note-add', 'summary-add', 'replay', 'retag-add', 'refresh-zdr-list', 'route-decide', 'ruling-add', 'ruling-withdraw', 'tree', 'verify-handoff', 'version', '-v']);
export const SIDE_OPTIONS = Object.freeze(['--rematch', '--replay', '--advice-meta', '--mcp', '--spend', '--cost-today', '--stats', '--metrics', '--forecast-cost', '--help', '--version']);

/** The refusal (a sentence, A-DRAFT) when `--approve-excerpts` is typed on something that is not a start or a resume of a council run; null otherwise. `args` is the command line after the program name. */
export function excerptSwitchFlagRefusal(args) {
  if (!Array.isArray(args) || !args.includes('--approve-excerpts')) return null;
  const what = SIDE_COMMAND_WORDS.includes(args[0]) ? `\`${args[0]}\`` : SIDE_OPTIONS.find(o => args.includes(o));
  if (!what) return null;
  return `--approve-excerpts: it keeps every excerpt of project text for your approval, and it can only be asked of a council run you start or resume; ${what} is not one. Nothing was run and nothing was spent.`;
}

// ---- slice 2b: the screen, the list the gate binds, and what the person's answers mean for the row ------------------------------------------------------------------------------------------------------------------
// An excerpt waiting for the person is a record input without its `approval` (src/excerpt-record.js): its `text` is the exact text, its `lines` the file's lines it was cut from (or null), `scans` the result of the
// outbound scans that ran when it was added. The scan-hit stop (T5.4) comes FIRST: the screen only ever shows an excerpt whose scans are clear or continued by the person, and throws on a hit.
// The screen numbers the lines of each excerpt 1..n (POSITIONS in the shown text: the one numbering that exists for a task file, a context document or a draft as well as for a repository file); the person's edit
// names positions, and THC builds the new text from the text that was shown, so no new text can enter through an edit. Every sentence of the screen is A-DRAFT, in the person's words, with nothing internal on it
// (no record ids, source kinds, scan field names or stage labels): the caller passes `labels` for the seats and the stages it knows by a name the person knows.
const splitLines = text => String(text).split('\n');
export const shownLinesOf = text => splitLines(text).length;
const fenceOf = lines => '`'.repeat(Math.max(3, ...lines.map(l => (l.match(/`+/g) || []).reduce((m, r) => Math.max(m, r.length + 1), 0))));
const oneLine = v => String(v ?? '').replace(/\s+/g, ' ').trim();
// Every value put on the screen is folded onto ONE line first: a path comes from a seat's reply (model text), and the fence protects the excerpt's text but not these header lines.
const wherePhrase = e => {
  const path = oneLine(e.path); const range = oneLine(e.lines);
  if (e.source_kind === 'repository_file') return `${range ? `lines ${range} of ` : ''}${path}`;
  if (e.source_kind === 'task_file') return `your task file${path ? ` (${path})` : ''}${range ? `, lines ${range}` : ''}`;
  if (e.source_kind === 'context_document') return `a context document (${path}${range ? `, lines ${range}` : ''})`;
  return `your draft${path ? ` (${path})` : ''}${range ? `, lines ${range}` : ''}`;
};
const endSentence = t => (/[.!?]$/.test(t) ? t : `${t}.`);   // a reason that already ends a sentence does not get a second full stop

/**
 * The list a gate binds for these waiting excerpts, in the gate's own shape: [{ id, lines, text_sha256, shown_lines }]. `nextId` is the number the first one will be given by the record (it numbers in the order
 * recorded, so a refused excerpt takes its number too).
 */
export function boundExcerptsOf(pending, nextId = 1) {
  return pending.map((e, k) => ({ id: `E-${nextId + k}`, lines: e.lines ?? null, text_sha256: sha256Of(e.text), shown_lines: shownLinesOf(e.text) }));
}

/**
 * The approval screen: ONE text for the excerpts asked for in one pause, each in full with its lines numbered, who asked and why, and what the checks found; then what each choice does. A-DRAFT.
 * `labels`: { seats: { <seat key>: 'the Gemini judge' }, stages: { <stage label>: 'the revise step' } } - names the person knows. A seat or a stage the screen needs and `labels` does not name is REFUSED, loudly: the screen never
 * shows a seat key or a stage label of the harness, so a caller that forgets a name cannot ship one (the pause unit knows the chain's seats).
 */
export function approvalScreen({ pending, nextId = 1, labels = {} }) {
  if (!Array.isArray(pending) || !pending.length) throw new Error('approvalScreen: there is nothing waiting for approval');
  const blocks = pending.map((e, k) => {
    if (e.scans && (e.scans.key_shape === 'hit' || e.scans.personal_data === 'hit')) throw new Error(`approvalScreen: excerpt E-${nextId + k} still holds a scan hit: the scan-hit stop comes first, so the person never approves a hit here`);
    const name = (group, key, what) => { const v = oneLine(labels?.[group]?.[key]); if (!v) throw new Error(`approvalScreen: no name for ${what} ${JSON.stringify(key)} in labels.${group}: the screen shows names the person knows, never the harness's own`); return v; };
    const lines = splitLines(e.text);
    // The numbers on the left are POSITIONS in the shown text (what the person's edit names). When the excerpt is a range of a file, its own line numbers differ, so the header says so: a person who reads "lines 3-5" and
    // types 3 would otherwise hide the wrong line.
    const where = `${wherePhrase(e)}${e.lines ? ` (numbered 1-${lines.length} below)` : ''}`;
    const who = e.request_kind === 'session_read'
      ? `The handling session read ${where} for its answer to ${name('stages', e.answered_stage, 'the stage')}, and wants the Council to see it`
      : `${name('seats', e.requested_by, 'the seat')} asked to see ${where}, because: ${oneLine(e.why)}`;
    const width = String(lines.length).length;
    const fence = fenceOf(lines);
    const numbered = lines.map((l, i) => `${String(i + 1).padStart(width)}  ${l}`).join('\n');
    const found = e.scans && (e.scans.key_shape === 'continued_by_person' || e.scans.personal_data === 'continued_by_person');
    // A-DRAFT (WORDING U1-w1): when no personal-data check ran during the run, the line says so and never reads as a pass.
    const checked = e.scans && e.scans.personal_data === 'not_scanned'
      ? `Checked for keys: ${found ? 'something was found, and you chose to send it anyway' : 'nothing found'}. Personal data was not checked during the run; the check at the start applies.`
      : found ? 'Checked for keys and personal data: something was found, and you chose to send it anyway.' : 'Checked for keys and personal data: nothing found.';
    const emptyNote = e.text.trim() === '' ? '\nThis excerpt holds no text.' : '';   // A-DRAFT (WORDING D10-w14): after the closing fence only, so the screen still parses back
    return `Excerpt ${k + 1} of ${pending.length}\n${endSentence(who)}\n${fence}\n${numbered}\n${fence}${emptyNote}\n${checked}`;
  });
  return `${blocks.join('\n\n')}\n\nFor each excerpt you choose:\n  approve - send exactly this text to the Council\n  edit    - send less: give the numbers on the left of the lines to keep, or of the lines to hide\n  refuse  - send nothing; the reviewer is told it was refused, and why if you say\nNothing is sent until you answer.\n`;
}
export const screenSha256 = text => sha256Of(text);

/**
 * The text of every excerpt, read back from the screen text the gate stored (the bytes it hashed; no second copy is kept anywhere) so that an edit can be shown as it will be sent. The screen is parsed in the
 * order `approvalScreen` wrote it and checked against the list the gate bound: the same count, each excerpt's line count, and each text's sha256. A screen that is not exactly that returns null, never a guess.
 * -> [text, ...] in the bound order, or null.
 */
export function screenExcerptsOf(screenText, bound) {
  if (typeof screenText !== 'string' || !Array.isArray(bound) || !bound.length) return null;
  const rows = screenText.split('\n');
  const texts = [];
  let i = 0;
  for (const [k, b] of bound.entries()) {
    while (i < rows.length && rows[i] !== `Excerpt ${k + 1} of ${bound.length}`) i += 1;
    i += 2;   // the heading, then the sentence that says who asked
    const fence = rows[i];
    if (typeof fence !== 'string' || !/^`{3,}$/.test(fence)) return null;
    const width = String(b.shown_lines).length;
    const own = [];
    for (i += 1; i < rows.length && rows[i] !== fence; i += 1) {
      const prefix = `${String(own.length + 1).padStart(width)}  `;
      if (!rows[i].startsWith(prefix)) return null;
      own.push(rows[i].slice(prefix.length));
    }
    if (i >= rows.length || own.length !== b.shown_lines) return null;
    const text = own.join('\n');
    if (sha256Of(text) !== b.text_sha256) return null;
    texts.push(text);
  }
  return texts;
}

/** Can an edit hide lines now? Hiding replaces a run of lines by the held marker line (`excerptHiddenLinesMarker`), which is model-read wording and waits for the one wording review: until it is recorded, no edit may hide a line. */
export const hiddenLinesMarkerRecorded = () => { const m = held('excerptHiddenLinesMarker')?.(); return typeof m === 'string' && m !== ''; };

const PERSON_CHANNELS = ['cli', 'elicitation'];   // src/gate.js PERSON_CHANNELS, copied (R2); test/excerpt-approval.test.js pins it to the gate's own
const SCAN_VALUES = SCAN_RESULTS;   // the record's own lists: one list, not a copy that can drift (0.8.4 unit 1; this was a local copy of SCAN_RESULTS)
const PERSONAL_DATA_VALUES = PERSONAL_DATA_RESULTS;

/** The edited text: the kept positions of the shown text, each run of hidden positions replaced by ONE marker line (the held `excerptHiddenLinesMarker`; loud when it is not recorded). */
export function editedText(text, { lines, hide = [] }) {
  const all = splitLines(text);
  const [lo, hi] = lines ? lines.split('-').map(Number) : [1, all.length];
  if (!(Number.isInteger(lo) && Number.isInteger(hi) && lo >= 1 && lo <= hi && hi <= all.length)) throw new Error(`editedText: the range ${JSON.stringify(lines)} is not inside the ${all.length} line(s) of the shown text`);
  if (hide.some(n => !Number.isInteger(n) || n < lo || n > hi)) throw new Error('editedText: a hidden line is outside the kept lines');
  const marker = held('excerptHiddenLinesMarker')?.();
  if (hide.length && !(typeof marker === 'string' && marker)) throw new Error('editedText: the marker for hidden lines is not recorded (held word excerptHiddenLinesMarker), so lines cannot be hidden');
  const hidden = new Set(hide);
  const out = [];
  for (let n = lo; n <= hi; n += 1) {
    if (!hidden.has(n)) out.push(all[n - 1]);
    else if (!hidden.has(n - 1) || n === lo) out.push(marker);
  }
  return out.join('\n');
}

/**
 * What the person's answer to ONE waiting excerpt means for the record: the record input (src/excerpt-record.js buildExcerptEntry's input) with its `approval` row.
 *   pending  the excerpt input without an `approval`
 *   answer   the entry the gate stored: { id, decision: 'approve' } | { id, decision: 'edit', lines?, hide? } | { id, decision: 'refuse', reason? }
 *   facts    { channel, actor, at }: EXACTLY what the gate recorded for the answer; a channel that is not a person's is refused
 *   scan     for an edit: scan(newText) -> { key_shape, personal_data } (the outbound scans run again on the edited text; D20 provides them)
 *   bound    the gate's bound entry for this excerpt ({ id, lines, text_sha256, shown_lines }, from the gate the person answered). REQUIRED: the answer must be for THIS excerpt - same id, same text, same lines - or it is refused loudly,
 *            so an answer paired with the wrong excerpt (a list in another order) is never recorded.
 * An edit's text is built here from the shown text (`editedText`); its file lines move with the kept range; it is recorded edited: true. A refusal carries no text (the record's rule for a request not answered with text).
 */
export function applyApproval(pending, answer, facts, { scan, bound } = {}) {
  if (!pending || typeof pending !== 'object') throw new Error('applyApproval: no excerpt');
  if (!answer || !['approve', 'edit', 'refuse'].includes(answer.decision)) throw new Error('applyApproval: the decision must be one of approve, edit, refuse');
  if (!bound || typeof bound !== 'object') throw new Error('applyApproval: the gate\'s bound entry for this excerpt is required');
  if (answer.id !== bound.id) throw new Error(`applyApproval: the answer is for ${JSON.stringify(answer.id)}, the gate bound ${JSON.stringify(bound.id)} here`);
  if (typeof pending.text !== 'string' || sha256Of(pending.text) !== bound.text_sha256 || (pending.lines ?? null) !== bound.lines) throw new Error(`applyApproval: the excerpt is not the one the gate bound as ${bound.id} (its text or its lines differ)`);
  if (!facts || !PERSON_CHANNELS.includes(facts.channel)) throw new Error(`applyApproval: the answer's channel must be one a person uses (${PERSON_CHANNELS.join(', ')}), not ${JSON.stringify(facts?.channel ?? null)}`);
  if (typeof facts.at !== 'string' || Number.isNaN(Date.parse(facts.at))) throw new Error('applyApproval: the answer needs the time the gate recorded');
  const actor = typeof facts.actor === 'string' && facts.actor.trim() !== '' ? facts.actor : null;
  const row = (status, reason = null) => ({ status, actor, channel: facts.channel, at: facts.at, reason });
  if (answer.decision === 'approve') return { ...pending, edited: false, approval: row('approved') };
  if (answer.decision === 'refuse') {
    const reason = typeof answer.reason === 'string' && answer.reason !== '' ? answer.reason : null;
    return { ...pending, text: null, file_sha256: null, scans: null, edited: false, approval: row('refused', reason) };
  }
  if (typeof scan !== 'function') throw new Error('applyApproval: an edit is scanned again: the caller passes the scan');
  const text = editedText(pending.text, answer);
  const first = pending.lines ? Number(pending.lines.split('-')[0]) : 1;
  const [lo, hi] = answer.lines ? answer.lines.split('-').map(Number) : [1, shownLinesOf(pending.text)];
  const lines = answer.lines || pending.lines ? `${first + lo - 1}-${first + hi - 1}` : null;
  const scans = scan(text);
  if (!scans || !SCAN_VALUES.includes(scans.key_shape) || !PERSONAL_DATA_VALUES.includes(scans.personal_data)) throw new Error(`applyApproval: the scan of an edited text must be { key_shape, personal_data }, each ${SCAN_VALUES.join(', ')} (personal_data may also be not_scanned)`);
  return { ...pending, text, lines, scans, edited: true, approval: row('edited') };
}

/**
 * What a run stopped at an excerpt approval says about the gate that holds it, in words that are true NOW for each status (A-DRAFT): `phrase` finishes "it ...", `tail` says what lets the run go on. Only a gate that
 * waits can be answered at a terminal; an answered one waits for the answers to be applied, an expired one for a new request. The pause unit (with the excerpt extraction) does the applying and the reopening.
 * `command` is the terminal command that answers a pending gate (the caller builds it).
 */
/**
 * The same five states in words for an AGENT (the MCP tools and run_status; D10 slice 2c-3 fix-up, A-DRAFT): the third person, and "only a person answers it" (with the terminal command) ONLY for a gate that
 * waits for a person. An answered, declined or expired gate has nothing a person must do now, so those words say what the record holds and when a resume is allowed again. `excerptWaitWords` below is the
 * person's own version for the terminal.
 */
export function excerptAgentWords(status, command) {
  switch (status) {
    case 'pending': return { phrase: "waits for a person's answers", tail: `Only a person answers it, at a terminal with \`${command}\`; this tool cannot. A resume is refused until a person has answered, and the resume after that records the answers.` };
    case 'approved': return { phrase: "has the person's answers, which are not applied yet", tail: 'A resume is refused until they are applied.' };
    case 'declined': return { phrase: 'was declined, which is not applied yet', tail: 'A resume is refused until that is applied.' };
    case 'expired': return { phrase: 'ran out of time before it was answered', tail: 'A resume is refused until it is asked again.' };
    default: return { phrase: 'cannot be read', tail: 'A resume is refused until it can be read.' };
  }
}

export function excerptWaitWords(status, command) {
  switch (status) {
    case 'pending': return { phrase: 'waits for your answers', tail: `Answer at a terminal with \`${command}\`; a resume is refused until you have answered, and the resume after that records your answers.` };
    case 'approved': return { phrase: 'has your answers, which are not applied yet', tail: 'A resume is refused until they are applied.' };
    case 'declined': return { phrase: 'was declined, which is not applied yet', tail: 'A resume is refused until that is applied.' };
    case 'expired': return { phrase: 'ran out of time before it was answered', tail: 'A resume is refused until it is asked again.' };
    default: return { phrase: 'cannot be read', tail: 'A resume is refused until it can be read.' };
  }
}

