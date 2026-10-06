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
import { join, resolve } from 'node:path';
import { userInfo } from 'node:os';
import { createInterface } from 'node:readline';
import { answerGate, listGates, readGateAnswer, readGateText, textSha256, GATES_DIR } from './gate.js';
import { verifyLedger, LEDGER_FILE } from './gate-ledger.js';
import { terminalSafe } from './terminal-safe.js';

const USAGE = [
  'usage: council gate show <run folder> [gate]',
  '       council gate answer <run folder> <gate> [--decline]',
  '       council gate verify <run folder>',
];

const money = v => (typeof v === 'number' && Number.isFinite(v) ? `$${v.toFixed(2)}` : 'unpriced');

// Every field shown before the y/N goes through terminalSafe: seats, labels and the file name come from
// the caller and could carry escape sequences that recolour or hide what follows (M3 review M3).
function describe(gate) {
  const p = gate.price && typeof gate.price === 'object' ? gate.price : {};
  const masks = gate.masks && typeof gate.masks === 'object' ? Object.entries(gate.masks).filter(([, n]) => Number(n) > 0) : [];
  const seats = Array.isArray(gate.seats) ? gate.seats : [];
  return describeLines(gate, p, masks, seats).map(terminalSafe);
}

function describeLines(gate, p, masks, seats) {
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
const INVISIBLE = /[\p{Cf}\u2028\u2029]/gu;
function printText(out, bytes) {
  const text = bytes.toString('utf8');
  const safe = terminalSafe(text);
  const fence = dashFence(safe, 5);   // audit A3-4: longer than any dash run in the text, so the text cannot fake its own end
  out(`${fence} the exact text (begin) ${fence}`);
  out(safe.endsWith('\n') ? safe.slice(0, -1) : safe);
  out(`${fence} the exact text (end) ${fence}`);
  const removed = [...text].length - [...safe].length;
  const invisible = (safe.match(INVISIBLE) || []).length;
  if (removed > 0) out(`note: the text holds ${removed} control or direction character(s) that are not shown above; they are part of what would be sent.`);
  if (invisible > 0) out(`note: the text holds ${invisible} invisible character(s) (zero-width, format or tag characters) that show as nothing above; they are part of what would be sent.`);
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
    const usable = state.status === 'approved' ? `; ${state.used ? 'already sent' : state.usable ? `usable until ${state.usable_until}` : 'no longer usable (expired)'}` : '';
    out(`status: ${state.status}${state.reason ? ` (${state.reason})` : ''}${usable}`);
    for (const l of describe(state.gate)) out(l);
    const bytes = readGateText(runDir, state.gate.text);
    if (bytes) printText(out, bytes); else out(terminalSafe(`(the text file ${state.gate.text} cannot be read inside the run folder)`));
    return 0;
  }

  // answer
  if (!stdin.isTTY || !stdout.isTTY) {
    err('gate answer needs a person at a terminal: stdin and stdout must both be a terminal. Nothing was written.');
    return 2;
  }
  if (state.status !== 'pending') { err(`gate ${gateArg} is ${state.status}${state.reason ? ` (${state.reason})` : ''}; only a pending gate can be answered`); return 1; }
  const bytes = readGateText(runDir, state.gate.text);
  if (!bytes) { err(terminalSafe(`gate ${gateArg}: cannot read ${state.gate.text} inside the run folder`)); return 1; }
  const shownSha256 = textSha256(bytes);
  for (const l of describe(state.gate)) out(l);
  printText(out, bytes);
  const decline = args.includes('--decline');
  const reply = await ask(decline ? `Decline gate ${gateArg}: this text will not be sent. Decline? [y/N] ` : `Approve sending exactly this text? [y/N] `, { input: stdin, output: stdout });
  if (!/^\s*y(es)?\s*$/i.test(reply)) { out('Not confirmed. Nothing was written; the gate stays pending.'); return 1; }
  let actor = null;
  try { actor = userInfo().username; } catch { /* no user name on this system; recorded as null */ }
  const res = answerGate(runDir, gateArg, { channel: 'cli', shownSha256, decision: decline ? 'declined' : 'approved', actor, tty: true }, opts);
  if (!res.ok) { err(`gate ${gateArg}: refused (${res.code}): ${res.message}`); return 1; }
  out(`gate ${gateArg}: ${res.status} (ledger line ${res.seq})`);
  if (res.warning) err(`gate ${gateArg}: note: ${res.warning}`);
  return 0;
}
