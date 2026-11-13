// `council gate show|answer|verify` (0.8.1 plan DR-3, M3 Work 3): the terminal channel of the gate.
//
//   council gate show <run> [gate]          the gates of a run and their status; with a gate, its whole text
//   council gate answer <run> <gate> [--decline]
//                                           prints the whole text, then asks y/N. Needs a terminal on stdin AND stdout.
//   council gate verify <run>               recomputes the ledger's hash chain
//
// Exit codes (the 0/1/2 of check-lock): 0 done (show; verify: the chain holds; answer: the answer was
// recorded), 1 verify found a break, or answer was refused or not confirmed (nothing written), 2 usage, no
// such run or gate, or no terminal.
//
// The terminal check is friction, not enforcement: a shell-capable agent can open a pseudo-terminal, and
// the README says so (plan DR-3). It is still the only way this command answers: there is no flag, no
// environment variable and no "for tests" switch that answers a gate (decided rule 10; the source scan in
// test/gate-answer.test.js holds this file to it). The hash bound to the answer is the hash of the exact
// bytes this command read and printed, not the one in the gate file.
import { dashFence } from './text-fence.js';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { userInfo } from 'node:os';
import { createInterface } from 'node:readline';
import { answerGate, listGates, readGateAnswer, readGateText, textSha256, GATES_DIR, RUN_CAP_KIND, EXCERPT_APPROVAL_KIND, STOP_DECISION_KIND, ACCEPTANCE_KIND } from './gate.js';
import { answerControl, isRaiseGate, isRulingGate } from './run-controls.js';
import { verifyLedger, LEDGER_FILE } from './gate-ledger.js';
import { terminalSafe } from './terminal-safe.js';
import { screenExcerptsOf, hiddenLinesMarkerRecorded, editedText } from './excerpt-approval.js';
import { countHidden, stripLeadingBom } from './hidden-chars.js';

const USAGE = [
  'usage: council gate show <run folder> [gate]',
  '       council gate answer <run folder> <gate> [--decline]',
  '       council gate verify <run folder>',
];

// Every field shown before the y/N goes through terminalSafe: seats, labels and the file name come from
// the caller and could carry escape sequences that recolour or hide what follows (M3 review M3).
function describe(gate, { startsRun = false } = {}) {
  return describeLines(gate, startsRun).map(terminalSafe);
}

// A contract gate (0.8.2 item 6d) sends nothing to any model and spends nothing: approving records the text as the contract (or an amendment of it). Saying "price: up to unpriced" there would be false comfort.
const isContractGate = gate => typeof gate.kind === 'string' && gate.kind.startsWith('contract_');
// A recursive-councils tree gate (0.8.3 M5b): approving sends nothing by itself and carries no price of its own (the text shows the figures); it records the person's decision and lets the tree act on it.
/** The `council tree` verb that asks for each tree gate kind (test/tree-gate-check-kind.test.js pins that every TREE_GATE_KINDS value has an entry and that each verb is a `council tree` verb: no fallback, so a fourth kind cannot name the wrong one). */
export const TREE_VERB_OF = Object.freeze({ tree_frontier: 'approve', tree_decide: 'decide', tree_check: 'check' });
const isTreeGate = gate => typeof gate.kind === 'string' && gate.kind.startsWith('tree_');
// 0.8.3 M6 typed cap T3b: a run_cap gate asks for a TYPED limit in US dollars; answering sends nothing and spends nothing, and the answer is the number (no y/N after it). The prompt below is the only line this file adds for it.
const isCapGate = gate => gate.kind === RUN_CAP_KIND;
// 0.8.4 D10 slice 2c-4 (T5.5): an excerpt_approval gate sends nothing by itself; the person answers EACH excerpt of the screen (approve it, edit it, or refuse it), and declining the gate refuses all of them (A-DRAFT, WORDING_0.8.4.md).
const isExcerptGate = gate => gate.kind === EXCERPT_APPROVAL_KIND;
// 0.8.4 D5a: a stop_decision gate is the handling session's question about a round stop (src/stop-gate.js). A person answers the STOP (a resume with the continue or finish choice), not this gate: showing it is fine, approving it here is refused.
const isStopDecisionGate = gate => gate.kind === STOP_DECISION_KIND;
// 0.8.4 D2: an acceptance gate (src/acceptance.js) is answered by `council accept`, which carries the written reason; a bare `council gate answer` of it is refused (the reason would be missing from the record)
const isAcceptanceGate = gate => gate.kind === ACCEPTANCE_KIND;
export const CAP_PROMPT = 'Type your limit in US dollars, then Enter: ';
/** The prompt of a limit gate: under the per-provider caps it opens with the cap's name in capitals, so the two questions differ in their first word (DUALCAP milestone 2, A-DRAFT); a
 * limit gate with no cap keeps the reviewed CAP_PROMPT. */
export const capPromptOf = gate => (typeof gate?.cap?.cap_name === 'string' && gate.cap.cap_name ? `${gate.cap.cap_name.toUpperCase()} limit in US dollars, then Enter: ` : CAP_PROMPT);

/** What approving a tree gate DOES, for the kinds whose effect is not the frontier approval's (the other kinds keep the line below). */
const TREE_APPROVAL_LINE = Object.freeze({ tree_check: 'Approving records the result of an integration check; it starts no run and spends nothing.' });

function describeLines(gate, startsRun = false) {
  if (isAcceptanceGate(gate)) {
    return [
      `gate ${gate.id} (${gate.kind}): ${gate.text}, ${gate.bytes} bytes, sha256 ${gate.sha256}`,
      'nothing is sent to any model and nothing is spent: approving records that you accept this plan as it stands, with the reason you wrote; it agrees with no judge and changes no objection',   // WORDING U3-w16
      `expires: ${gate.expires_at}`,
    ];
  }
  // DUALCAP milestone 2 (C&C, 1 Nov: Muad found the limit screen cluttered): a limit gate shows no file/bytes/sha256 header and no expiry line; both stay in the gate record
  // and the ledger, switch on or off. Every other gate kind keeps them.
  if (isCapGate(gate)) {
    return [
      // E 154 says typing sends nothing and spends nothing; that is true of `council gate answer`. When the START of a run asks (startsRun, src/cli.js through src/start-cap.js), typing begins the run: the line says so instead (E 157 g).
      startsRun ? 'answering records the limit you type for this run; if the start\'s other checks pass, this run then starts and spends against it' : 'answering records the limit you type for this run; typing it sends nothing to any model and spends nothing',
    ];
  }
  if (isTreeGate(gate)) {
    return [
      `gate ${gate.id} (${gate.kind}): ${gate.text}, ${gate.bytes} bytes, sha256 ${gate.sha256}`,
      TREE_APPROVAL_LINE[gate.kind] ?? 'approving records your decision on exactly this text, once; the tree then acts on it (a frontier approval lets the runs it lists start, and spend, up to the figures shown)',
      `expires: ${gate.expires_at}`,
    ];
  }
  if (isStopDecisionGate(gate)) {
    return [
      `gate ${gate.id} (${gate.kind}): ${gate.text}, ${gate.bytes} bytes, sha256 ${gate.sha256}`,   // A-DRAFT
      'this is the handling session\'s question about a stop of the run; the stop itself is answered with council --resume and the continue or finish choice, and declining here only closes the session\'s question',   // A-DRAFT
      `expires: ${gate.expires_at}`,
    ];
  }
  if (isExcerptGate(gate)) {
    return [
      `gate ${gate.id} (${gate.kind}): ${gate.text}, ${gate.bytes} bytes, sha256 ${gate.sha256}`,   // A-DRAFT
      'your answers are recorded for exactly this text, once: you approve, edit or refuse each excerpt of your project shown below; nothing is sent to any model until the answers are applied',   // A-DRAFT
      `expires: ${gate.expires_at}`,
    ];
  }
  if (isContractGate(gate)) {
    return [
      `gate ${gate.id} (${gate.kind}): ${gate.text}, ${gate.bytes} bytes, sha256 ${gate.sha256}`,
      'nothing is sent to any model and nothing is spent: approving records exactly this text as the contract (or as an amendment of it)',
      `expires: ${gate.expires_at}`,
    ];
  }
  return [
    `gate ${gate.id} (${gate.kind}): ${gate.text}, ${gate.bytes} bytes, sha256 ${gate.sha256}`,
    `expires: ${gate.expires_at}`,
  ];
}

// The whole text, as it is on disk. Control and bidi characters are not printed (they could rewrite what
// the terminal shows). Invisible format characters (zero-width spaces and joiners, the byte-order mark, a
// soft hyphen, the Unicode tag characters U+E0000-U+E007F that can carry text a person cannot see but a
// model reads) are printed but show nothing. When the text holds any of either kind, a line says how many,
// so the person knows the bytes they approve are not all visible. They are counted, not removed: a joiner
// inside an emoji is legitimate, and the hash covers the bytes as they are.
// Audit item 7 (0.8.3): the count is src/hidden-chars.js's (everything that renders as nothing; the quiet joiners ZWNJ, ZWJ, soft hyphen, the emoji selector ... are counted unless an emoji sequence explains them; a leading byte-order mark is ordinary).
function printText(out, bytes, { limitScreen = false } = {}) {   // limitScreen (DUALCAP milestone 2): the fences of a limit gate carry a short label; they stay (audit A3-4)
  const text = bytes.toString('utf8');
  const safe = terminalSafe(text);
  const fence = dashFence(safe, 5);   // audit A3-4: longer than any dash run in the text, so the text cannot fake its own end
  out(limitScreen ? `${fence} screen ${fence}` : `${fence} the exact text (begin) ${fence}`);
  out(safe.endsWith('\n') ? safe.slice(0, -1) : safe);
  out(limitScreen ? `${fence} end of screen ${fence}` : `${fence} the exact text (end) ${fence}`);
  const removed = [...text].length - [...safe].length;
  const invisible = countHidden(stripLeadingBom(safe));
  if (removed > 0) out(`note: the text holds ${removed} control or direction character(s) that are not shown above; they are part of what would be sent.`);
  if (invisible > 0) out(`note: the text holds ${invisible} invisible character(s) (zero-width, formatting, filler or variation-selector characters) that show as nothing above; they are part of what would be sent.`);
}

function ask(question, { input, output }) {
  return new Promise(res => {
    const rl = createInterface({ input, output, terminal: true });
    let done = false;
    rl.question(question, a => { done = true; rl.close(); res(a); });
    rl.on('close', () => { if (!done) res(''); });
  });
}

// 0.8.4 D10 slice 2c-4 (A-DRAFT, WORDING_0.8.4.md): the questions of an excerpt approval, one excerpt at a time. Returns the answers in the gate's shape, or null after saying why nothing was written. An edit is
// shown as it will be sent BEFORE anything is recorded: its text is cut from the screen text the gate stored (screenExcerptsOf checks it against the excerpts the gate bound), never from a second copy.
const NUMBER_LIST = /^[1-9][0-9]{0,5}(-[1-9][0-9]{0,5})?(,[1-9][0-9]{0,5}(-[1-9][0-9]{0,5})?)*$/;
function numbersOf(typed) {   // "2" "2-4" "1,3-4" -> [2] [2,3,4] [1,3,4]; null when it is not that
  const t = String(typed).replace(/\s+/g, '');
  if (!NUMBER_LIST.test(t)) return null;
  const all = new Set();
  for (const part of t.split(',')) { const [a, b = a] = part.split('-').map(Number); if (a > b || b - a > 100000) return null; for (let n = a; n <= b; n += 1) all.add(n); }
  return [...all].sort((x, y) => x - y);
}
async function excerptAnswersAtTerminal(bound, screenText, { ask: say, out }) {
  const stop = sentence => { out(`${sentence} Nothing was written; the gate stays pending.`); return null; };
  const answers = [];
  let texts;   // read back from the screen only when an edit is chosen
  for (const [k, ex] of bound.entries()) {
    const choice = String(await say(`Excerpt ${k + 1} of ${bound.length} (${terminalSafe(ex.id)}): approve, edit or refuse? [a/e/r] `)).trim().toLowerCase();
    if (choice === 'a' || choice === 'approve') { answers.push({ id: ex.id, decision: 'approve' }); continue; }
    if (choice === 'r' || choice === 'refuse') {
      const reason = String(await say('Why do you refuse it? Press Enter to give no reason: ')).trim();
      answers.push(reason ? { id: ex.id, decision: 'refuse', reason } : { id: ex.id, decision: 'refuse' });
      continue;
    }
    if (choice !== 'e' && choice !== 'edit') return stop('That is not a choice.');
    const keepTyped = String(await say(`Which lines of ${terminalSafe(ex.id)} (1-${ex.shown_lines}) do you keep? For example 2-3. Press Enter to keep them all: `)).trim();
    const kept = keepTyped ? numbersOf(keepTyped) : [...Array(ex.shown_lines).keys()].map(n => n + 1);
    if (!kept || kept[0] < 1 || kept[kept.length - 1] > ex.shown_lines || kept.length !== kept[kept.length - 1] - kept[0] + 1) return stop(`Those are not lines of ${terminalSafe(ex.id)}: keep one run of its lines 1-${ex.shown_lines}.`);
    const hideTyped = String(await say('Which of the kept lines do you hide? For example 3 or 2,4. Press Enter to hide none: ')).trim();
    const hide = hideTyped ? numbersOf(hideTyped) : [];
    if (!hide || hide.some(n => n < kept[0] || n > kept[kept.length - 1])) return stop('Those are not among the lines you keep.');
    if (hide.length === kept.length) return stop('That hides every line: to send nothing, refuse the excerpt.');
    if (kept.length === ex.shown_lines && !hide.length) return stop('That keeps every line and hides none: to send everything, approve the excerpt.');
    if (hide.length && !hiddenLinesMarkerRecorded()) return stop('Hiding lines is not available yet: keep a narrower run of lines without hiding any, or approve or refuse the excerpt.');
    texts ??= screenExcerptsOf(screenText, bound);
    if (!texts) return stop('The text of this excerpt cannot be checked against the text the gate asked about, so it cannot be edited here.');
    const lines = kept.length === ex.shown_lines ? undefined : `${kept[0]}-${kept[kept.length - 1]}`;
    const sent = editedText(texts[k], { lines, hide });
    out(`This is exactly what would be sent for ${terminalSafe(ex.id)}:`);
    printText(out, Buffer.from(sent, 'utf8'));   // the same rendering as the screen above, its notes about hidden characters included
    answers.push({ id: ex.id, decision: 'edit', ...(lines ? { lines } : {}), ...(hide.length ? { hide } : {}) });
  }
  return answers;
}

/**
 * Runs one `gate` subcommand. `io` carries the streams so a test can drive it; the terminal check reads
 * `isTTY` off the streams it is given, never off a setting.
 */
export async function gateCommand(args, { work = process.cwd(), stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, now } = {}) {
  const out = s => stdout.write(`${s}\n`);
  const err = s => stderr.write(`${s}\n`);
  const [sub, runArg, gateArg, extra] = args.filter(a => !a.startsWith('--'));
  const opts = now ? { now } : {};
  const unknown = args.filter(a => a.startsWith('--') && !(a === '--decline' && sub === 'answer'));
  if (unknown.length) { err(`gate: unknown option ${unknown[0]}`); for (const l of USAGE) err(l); return 2; }
  if (!['show', 'answer', 'verify'].includes(sub) || !runArg || extra !== undefined || (sub === 'verify' && gateArg !== undefined)) { for (const l of USAGE) err(l); return 2; }
  const runDir = resolve(work, runArg);
  if (!existsSync(join(runDir, LEDGER_FILE)) && !existsSync(join(runDir, GATES_DIR))) { err(`gate: ${runArg} has no gates (no ${LEDGER_FILE})`); return 2; }

  if (sub === 'verify') {
    const v = verifyLedger(runDir);
    if (v.ok) { out(`${runArg}: gate ledger holds (${v.lines.length} line${v.lines.length === 1 ? '' : 's'}${v.torn ? '; a torn last line is ignored' : ''})`); return 0; }
    err(`${runArg}: gate ledger is broken at line ${v.failedAt}: ${v.reason}`);
    return 1;
  }

  if (sub === 'show' && !gateArg) {
    const gates = listGates(runDir, opts);
    if (!gates) { err(`${runArg}: gate ledger is broken (gate_ledger_corrupt); council gate verify ${runArg} says where`); return 1; }
    if (!gates.length) out(`${runArg}: no gates`);
    for (const g of gates) out(`${g.id}  ${g.status}${g.reason ? ` (${g.reason})` : ''}`);
    return 0;
  }
  if (!gateArg) { for (const l of USAGE) err(l); return 2; }

  const state = readGateAnswer(runDir, gateArg, opts);
  if (state.status === 'invalid' && !state.gate) { err(`gate ${gateArg}: ${state.reason}`); return state.reason === 'gate_not_found' ? 2 : 1; }

  if (sub === 'show') {
    const usable = state.status === 'approved' ? `; ${state.used ? (isContractGate(state.gate) || isCapGate(state.gate) ? 'already used' : 'already sent') : state.usable ? `usable until ${state.usable_until}` : 'no longer usable (expired)'}` : '';
    out(`status: ${state.status}${state.reason ? ` (${state.reason})` : ''}${usable}`);
    for (const l of describe(state.gate)) out(l);
    const bytes = readGateText(runDir, state.gate.text);
    if (bytes) printText(out, bytes, { limitScreen: isCapGate(state.gate) }); else out(terminalSafe(`(the text file ${state.gate.text} cannot be read inside the run folder)`));
    return 0;
  }

  // answer
  return answerAtTerminal(runDir, gateArg, { decline: args.includes('--decline'), stdin, stdout, stderr, now });
}

/**
 * The terminal answer to one gate: the whole text, then y/N, bound to the hash of the exact bytes printed. The one place a person's terminal answer is made (`council gate answer` calls it; so do
 * `council contract lock` and `council contract amend --decide`, 0.8.2 item 6d, which therefore have no prompt of their own). Returns an exit code: 0 the answer was recorded, 1 refused or not confirmed
 * (nothing written), 2 no terminal.
 */
export async function answerAtTerminal(runDir, gateArg, { decline = false, reason = null, typed = null, startsRun = false, stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, now, onNotApproved = null } = {}) {       // onNotApproved: called when the PERSON answered and did not approve (a wrong typed word, or no at the confirmation), never for an expired, unreadable or refused gate (GAP A: the draft screen goes on to ask what should change only then)
  const out = s => stdout.write(`${s}\n`);
  const err = s => stderr.write(`${s}\n`);
  const opts = now ? { now } : {};
  const state = readGateAnswer(runDir, gateArg, opts);
  if (state.status === 'invalid' && !state.gate) { err(`gate ${gateArg}: ${state.reason}`); return state.reason === 'gate_not_found' ? 2 : 1; }
  if (!stdin.isTTY || !stdout.isTTY) {
    err('gate answer needs a person at a terminal: stdin and stdout must both be a terminal. Nothing was written.');
    return 2;
  }
  if (state.status !== 'pending') { err(`gate ${gateArg} is ${state.status}${state.reason ? ` (${state.reason})` : ''}; only a pending gate can be answered`); return 1; }
  if (isAcceptanceGate(state.gate) && !decline && typeof reason !== 'string') { err(`gate ${gateArg}: this is the acceptance of a plan as it stands. Answer it with council accept ${terminalSafe(join('runs', basename(runDir)))} --reason "<why>", which records your reason. Nothing was written.`); return 2; }   // WORDING U3-w17
  const bytes = readGateText(runDir, state.gate.text);
  if (!bytes) { err(terminalSafe(`gate ${gateArg}: cannot read ${state.gate.text} inside the run folder`)); return 1; }
  const shownSha256 = textSha256(bytes);
  // 0.8.3 M5b1b (C&C): NO path approves a tree gate without the typed step (PLAN 8.2). `council gate answer` finds a tree gate like any other, and without this it would take a bare "y". A tree gate is approved only
  // by the caller that supplies what must be typed (src/tree-gate.js, through `council tree approve|decide`), and what must be typed has to be NAMED IN the text's last line, so the person was told what to type. Declining stays allowed.
  if (isTreeGate(state.gate) && !decline) {
    const last = bytes.toString('utf8').trimEnd().split('\n').pop();
    if (!typed || !typed.expect || !last.endsWith(String(typed.expect))) {
      err(terminalSafe(`gate ${gateArg} is a ${state.gate.kind} gate: it is approved only by \`council tree ${TREE_VERB_OF[state.gate.kind]} ${basename(runDir)}\`, which asks you to type what its text names${typed ? ' (this text does not name what was to be typed)' : ''}. Nothing was written; the gate stays pending. Declining is always allowed: add --decline.`));
      return 1;
    }
  }
  for (const l of describe(state.gate, { startsRun })) out(l);
  printText(out, bytes, { limitScreen: isCapGate(state.gate) });
  // A limit is answered by TYPING it (answerGate parses the text against the ceiling bound in the gate and writes the figure itself): no y/N after it, and a bare "y" is refused there. Declining keeps its y/N.
  if (isCapGate(state.gate) && !decline) {
    const got = await ask(capPromptOf(state.gate), { input: stdin, output: stdout });
    let actor = null;
    try { actor = userInfo().username; } catch { /* no user name on this system; recorded as null */ }
    // S20 slice 1: a RAISE is recorded through the one interface (src/run-controls.js); a first limit or an amendment keeps its writer
    const res = isRaiseGate(state.gate)
      ? answerControl(runDir, gateArg, { control: 'raise', channel: 'cli', shownSha256, decision: 'approved', actor, tty: true, typedCap: got }, opts)
      : answerGate(runDir, gateArg, { channel: 'cli', shownSha256, decision: 'approved', actor, tty: true, typedCap: got }, opts);
    if (!res.ok) { err(terminalSafe(`gate ${gateArg}: refused (${res.code}): ${res.message}`)); return 1; }
    const recorded = readGateAnswer(runDir, gateArg, opts);
    out(`Limit recorded: $${recorded.answer?.cap_usd ?? '?'}.`);   // DUALCAP milestone 2 (A-DRAFT): the ledger line stays in the record, not in the person's view
    if (res.warning) err(`gate ${gateArg}: note: ${res.warning}`);
    return 0;
  }
  // 0.8.4 D5a (A-DRAFT, WORDING_0.8.4.md): approving the session's question about a stop is not an answer to the stop; nothing is written. Declining it is allowed (it closes the question).
  if (isStopDecisionGate(state.gate) && !decline) { err(`gate ${gateArg}: this is the handling session's question about a stop. Answer the stop itself with council --resume ${terminalSafe(join('runs', basename(runDir)))} and the continue or finish choice. Nothing was written.`); return 1; }
  // 0.8.4 D10 slice 2c-4 (A-DRAFT words, WORDING_0.8.4.md): an excerpt approval asks for ONE answer per excerpt the gate binds: approve it, edit it (keep fewer lines, hide some) or refuse it. A choice that is not one of the three,
  // or an edit that cannot be made, writes nothing and leaves the gate pending (no second try inside the route, like a wrong typed step above). The answers go to answerGate, which checks them against the excerpts bound in the
  // gate AND the text shown against the sha256 its request line recorded; this route never builds a row (that is the pause's, through applyApproval).
  if (isExcerptGate(state.gate) && !decline) {
    const bound = Array.isArray(state.gate.excerpts) ? state.gate.excerpts : [];
    const picked = await excerptAnswersAtTerminal(bound, bytes.toString('utf8'), { ask: q => ask(q, { input: stdin, output: stdout }), out });
    if (!picked) { onNotApproved?.(); return 1; }
    const answers = picked;
    for (const [k, a] of answers.entries()) out(terminalSafe(`${a.id}: ${a.decision === 'approve' ? 'approved' : a.decision === 'edit' ? `edited, lines ${a.lines ?? `1-${bound[k].shown_lines}`} kept${a.hide ? `, ${a.hide.length} hidden` : ''}` : `refused${a.reason ? `: ${a.reason}` : ''}`}`));
    const okay = await ask('Record these answers? [y/N] ', { input: stdin, output: stdout });
    if (!/^\s*y(es)?\s*$/i.test(okay)) { out('Not confirmed. Nothing was written; the gate stays pending.'); onNotApproved?.(); return 1; }
    let who = null;
    try { who = userInfo().username; } catch { /* no user name on this system; recorded as null */ }
    const done = answerGate(runDir, gateArg, { channel: 'cli', shownSha256, decision: 'approved', actor: who, tty: true, excerptAnswers: answers }, opts);
    if (!done.ok) { err(terminalSafe(`gate ${gateArg}: refused (${done.code}): ${done.message}`)); return 1; }
    out(`gate ${gateArg}: ${done.status} (ledger line ${done.seq})`);
    if (done.warning) err(`gate ${gateArg}: note: ${done.warning}`);
    return 0;
  }
  const contract = isContractGate(state.gate);
  const tree = isTreeGate(state.gate);
  // 0.8.3 M5b (PLAN 8.2): a tree approval first asks the person to TYPE something the text shows (the first characters of the frontier key), so a stray "y" cannot approve what was not read. `typed` = { expect, prompt }.
  // Declining needs no typing: declining is always allowed. A wrong or empty answer writes nothing and leaves the gate pending.
  if (typed && !decline) {
    const got = await ask(typed.prompt, { input: stdin, output: stdout });
    if (String(got).trim() !== typed.expect) { out('That is not what the text asks you to type. Nothing was written; the gate stays pending.'); onNotApproved?.(); return 1; }
  }
  const reply = await ask(decline
    ? `Decline gate ${gateArg}: ${isCapGate(state.gate) ? 'no limit will be recorded and nothing will be started' : tree ? 'nothing will be done for this text' : isExcerptGate(state.gate) ? 'every excerpt is refused and none will be used' : `this text will not be ${contract ? 'recorded' : 'sent'}`}. Decline? [y/N] `
    : isAcceptanceGate(state.gate) ? 'Accept this plan as it stands, with the reason you wrote? [y/N] '   // WORDING U3-w18
    : `Approve ${tree ? 'acting on' : contract ? 'recording' : 'sending'} exactly this text? [y/N] `, { input: stdin, output: stdout });
  if (!/^\s*y(es)?\s*$/i.test(reply)) { out('Not confirmed. Nothing was written; the gate stays pending.'); onNotApproved?.(); return 1; }
  let actor = null;
  try { actor = userInfo().username; } catch { /* no user name on this system; recorded as null */ }
  // step 3.1 (S20 slice 2): a ruling and a withdrawal are answered through the interface, which refuses an approval whose pass already has a stage on disk (a decline is never refused)
  const res = isRulingGate(state.gate)
    ? answerControl(runDir, gateArg, { control: 'ruling', channel: 'cli', shownSha256, decision: decline ? 'declined' : 'approved', actor, tty: true }, opts)
    : answerGate(runDir, gateArg, { channel: 'cli', shownSha256, decision: decline ? 'declined' : 'approved', actor, tty: true, ...(typeof reason === 'string' ? { reason } : {}) }, opts);
  if (!res.ok) { err(`gate ${gateArg}: refused (${res.code}): ${res.message}`); return 1; }
  // DUALCAP milestone 2: a limit gate reaches this line only when declined (a typed limit returns above); its ledger line stays in the record (A-DRAFT words)
  out(isCapGate(state.gate) ? 'Declined: no limit was recorded.' : `gate ${gateArg}: ${res.status} (ledger line ${res.seq})`);
  if (res.warning) err(`gate ${gateArg}: note: ${res.warning}`);
  return 0;
}
