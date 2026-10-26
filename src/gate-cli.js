// `council gate show|answer|verify` (0.8.1 plan DR-3, M3 Work 3): the terminal channel of the gate.
//
//   council gate show <run> [gate]          the gates of a run and their status; with a gate, its whole text
//   council gate answer <run> <gate> [--decline]
//                                           prints the whole text, the mask counts, the price and the seats,
//                                           then asks y/N. Needs a terminal on stdin AND stdout.
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
import { answerGate, listGates, readGateAnswer, readGateText, textSha256, GATES_DIR, RUN_CAP_KIND } from './gate.js';
import { verifyLedger, LEDGER_FILE } from './gate-ledger.js';
import { terminalSafe } from './terminal-safe.js';
import { loadPolicy } from './policy.js';
import { advicePolicyVerdict } from './send-path-refusals.js';
import { loadAdviceChain } from './send-profiles.js';
import { readAdviceMeta, ADVICE_META_FILE } from './advice-run.js';
import { countHidden, stripLeadingBom } from './hidden-chars.js';

const USAGE = [
  'usage: council gate show <run folder> [gate]',
  '       council gate answer <run folder> <gate> [--decline]',
  '       council gate verify <run folder>',
];

const money = v => (typeof v === 'number' && Number.isFinite(v) ? `$${v.toFixed(2)}` : 'unpriced');

// Every field shown before the y/N goes through terminalSafe: seats, labels and the file name come from
// the caller and could carry escape sequences that recolour or hide what follows (M3 review M3).
function describe(gate, { startsRun = false } = {}) {
  const p = gate.price && typeof gate.price === 'object' ? gate.price : {};
  const masks = gate.masks && typeof gate.masks === 'object' ? Object.entries(gate.masks).filter(([, n]) => Number(n) > 0) : [];
  const seats = Array.isArray(gate.seats) ? gate.seats : [];
  return describeLines(gate, p, masks, seats, startsRun).map(terminalSafe);
}

// A contract gate (0.8.2 item 6d) sends nothing to any model and spends nothing: approving records the text as the contract (or an amendment of it). Saying "price: up to unpriced" there would be false comfort.
const isContractGate = gate => typeof gate.kind === 'string' && gate.kind.startsWith('contract_');
// A recursive-councils tree gate (0.8.3 M5b): approving sends nothing by itself and carries no price of its own (the text shows the figures); it records the person's decision and lets the tree act on it.
/** The `council tree` verb that asks for each tree gate kind (test/tree-gate-check-kind.test.js pins that every TREE_GATE_KINDS value has an entry and that each verb is a `council tree` verb: no fallback, so a fourth kind cannot name the wrong one). */
export const TREE_VERB_OF = Object.freeze({ tree_frontier: 'approve', tree_decide: 'decide', tree_check: 'check' });
const isTreeGate = gate => typeof gate.kind === 'string' && gate.kind.startsWith('tree_');
// 0.8.3 M6 typed cap T3b: a run_cap gate asks for a TYPED limit in US dollars; answering sends nothing and spends nothing, and the answer is the number (no y/N after it). The prompt below is the only line this file adds for it.
const isCapGate = gate => gate.kind === RUN_CAP_KIND;
export const CAP_PROMPT = 'Type your limit in US dollars, then Enter: ';

/** What approving a tree gate DOES, for the kinds whose effect is not the frontier approval's (the other kinds keep the line below). */
const TREE_APPROVAL_LINE = Object.freeze({ tree_check: 'Approving records the result of an integration check; it starts no run and spends nothing.' });

function describeLines(gate, p, masks, seats, startsRun = false) {
  if (isCapGate(gate)) {
    return [
      `gate ${gate.id} (${gate.kind}): ${gate.text}, ${gate.bytes} bytes, sha256 ${gate.sha256}`,
      // E 154 says typing sends nothing and spends nothing; that is true of `council gate answer`. When the START of a run asks (startsRun, src/cli.js through src/start-cap.js), typing begins the run: the line says so instead (E 157 g).
      startsRun ? 'answering records the limit you type for this run; if the start\'s other checks pass, this run then starts and spends against it' : 'answering records the limit you type for this run; typing it sends nothing to any model and spends nothing',
      `expires: ${gate.expires_at}`,
    ];
  }
  if (isTreeGate(gate)) {
    return [
      `gate ${gate.id} (${gate.kind}): ${gate.text}, ${gate.bytes} bytes, sha256 ${gate.sha256}`,
      TREE_APPROVAL_LINE[gate.kind] ?? 'approving records your decision on exactly this text, once; the tree then acts on it (a frontier approval lets the runs it lists start, and spend, up to the figures shown)',
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
    `price: up to ${money(p.ceiling_usd)}${typeof p.expected_usd === 'number' ? ` (expected ${money(p.expected_usd)})` : ''}`,
    `seats: ${seats.length ? seats.map(s => (typeof s === 'string' ? s : [s.lab ?? s.model, s.retention].filter(Boolean).join(': '))).join('; ') : 'none named'}`,
    `sensitivity: ${gate.sensitivity && typeof gate.sensitivity === 'object' ? `${gate.sensitivity.label ?? '?'} (set by ${gate.sensitivity.set_by ?? '?'})` : gate.sensitivity ?? 'not given'}`,
    `masked before sending: ${masks.length ? masks.map(([k, n]) => `${n} ${k}`).join(', ') : 'nothing'}`,
    ...(typeof gate.follow_up === 'string' ? [`follow-up: ${gate.follow_up}`] : []),
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
function printText(out, bytes) {
  const text = bytes.toString('utf8');
  const safe = terminalSafe(text);
  const fence = dashFence(safe, 5);   // audit A3-4: longer than any dash run in the text, so the text cannot fake its own end
  out(`${fence} the exact text (begin) ${fence}`);
  out(safe.endsWith('\n') ? safe.slice(0, -1) : safe);
  out(`${fence} the exact text (end) ${fence}`);
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
    if (bytes) printText(out, bytes); else out(terminalSafe(`(the text file ${state.gate.text} cannot be read inside the run folder)`));
    return 0;
  }

  // answer
  return answerAtTerminal(runDir, gateArg, { decline: args.includes('--decline'), stdin, stdout, stderr, now });
}

// 0.8.2 (owner via C&C, 7 Oct 2026): an ADVICE gate answered at the terminal gets the policy re-check the quote and the start already do (src/send-path-refusals.js advicePolicyVerdict: the one rule). The policy is the
// project's policy.json, in the folder that holds this run's `runs/` (the folder the adopted call will run in); the chain is the one the run's own advice.meta.json names, loaded the way the adopt path loads it
// (the package's chains or the operator's folder, never the project's); the ceiling is the gate's recorded one. null = no policy.json, nothing to check (output unchanged). A policy file or chain that
// cannot be read refuses an approval (fail closed).
function advicePolicyAtTerminal(runDir, gate) {
  // The project's folder is the one that holds `runs/`: a run folder copied somewhere else has no project whose policy.json can be located, so an approval is refused (a policy path fails closed); declining stays allowed.
  if (basename(dirname(resolve(runDir))) !== 'runs') return { refused: 'this advice run is not inside a runs/ folder, so its project\'s policy.json cannot be located', warnings: [] };
  const work = resolve(runDir, '..', '..');
  const { policy, error } = loadPolicy(work);
  if (error) return { refused: `policy.json cannot be read (${error})`, warnings: [] };
  if (!policy) return null;
  const meta = readAdviceMeta(join(runDir, ADVICE_META_FILE));
  const config = meta.error ? null : loadAdviceChain(meta.meta.chain, { work });
  const ceiling = gate.price && typeof gate.price === 'object' ? gate.price.ceiling_usd : undefined;
  if (!config || !(typeof ceiling === 'number' && ceiling > 0)) return { refused: 'policy.json is set but this advice call\'s chain or price cannot be read, so the policy cannot be checked', warnings: [] };
  const ev = advicePolicyVerdict(policy, config, ceiling, { runsDir: join(work, 'runs') });
  return { refused: ev.ok ? null : `policy.json refuses this call: ${ev.reasons.join(' ')}`, warnings: ev.warnings };
}

/**
 * The terminal answer to one gate: the whole text, then y/N, bound to the hash of the exact bytes printed. The one place a person's terminal answer is made (`council gate answer` calls it; so do
 * `council contract lock` and `council contract amend --decide`, 0.8.2 item 6d, which therefore have no prompt of their own). Returns an exit code: 0 the answer was recorded, 1 refused or not confirmed
 * (nothing written), 2 no terminal.
 */
export async function answerAtTerminal(runDir, gateArg, { decline = false, typed = null, startsRun = false, stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, now, onNotApproved = null } = {}) {       // onNotApproved: called when the PERSON answered and did not approve (a wrong typed word, or no at the confirmation), never for an expired, unreadable or refused gate (GAP A: the draft screen goes on to ask what should change only then)
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
  const policyCheck = state.gate.kind === 'advice' ? advicePolicyAtTerminal(runDir, state.gate) : null;
  for (const w of policyCheck?.warnings ?? []) out(terminalSafe(`Policy warning: ${w}`));
  if (policyCheck?.refused) {
    if (!decline) { err(terminalSafe(`${policyCheck.refused}. Nothing was written; the gate stays pending.`)); return 1; }
    out(terminalSafe(`Note: ${policyCheck.refused}. Declining is always allowed.`));
  }
  printText(out, bytes);
  // A limit is answered by TYPING it (answerGate parses the text against the ceiling bound in the gate and writes the figure itself): no y/N after it, and a bare "y" is refused there. Declining keeps its y/N.
  if (isCapGate(state.gate) && !decline) {
    const got = await ask(CAP_PROMPT, { input: stdin, output: stdout });
    let actor = null;
    try { actor = userInfo().username; } catch { /* no user name on this system; recorded as null */ }
    const res = answerGate(runDir, gateArg, { channel: 'cli', shownSha256, decision: 'approved', actor, tty: true, typedCap: got }, opts);
    if (!res.ok) { err(terminalSafe(`gate ${gateArg}: refused (${res.code}): ${res.message}`)); return 1; }
    const recorded = readGateAnswer(runDir, gateArg, opts);
    out(`gate ${gateArg}: ${res.status} (ledger line ${res.seq}); limit $${recorded.answer?.cap_usd ?? '?'}`);
    if (res.warning) err(`gate ${gateArg}: note: ${res.warning}`);
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
    ? `Decline gate ${gateArg}: ${isCapGate(state.gate) ? 'no limit will be recorded and nothing will be started' : tree ? 'nothing will be done for this text' : `this text will not be ${contract ? 'recorded' : 'sent'}`}. Decline? [y/N] `
    : `Approve ${tree ? 'acting on' : contract ? 'recording' : 'sending'} exactly this text? [y/N] `, { input: stdin, output: stdout });
  if (!/^\s*y(es)?\s*$/i.test(reply)) { out('Not confirmed. Nothing was written; the gate stays pending.'); onNotApproved?.(); return 1; }
  let actor = null;
  try { actor = userInfo().username; } catch { /* no user name on this system; recorded as null */ }
  const res = answerGate(runDir, gateArg, { channel: 'cli', shownSha256, decision: decline ? 'declined' : 'approved', actor, tty: true }, opts);
  if (!res.ok) { err(`gate ${gateArg}: refused (${res.code}): ${res.message}`); return 1; }
  out(`gate ${gateArg}: ${res.status} (ledger line ${res.seq})`);
  if (res.warning) err(`gate ${gateArg}: note: ${res.warning}`);
  return 0;
}
