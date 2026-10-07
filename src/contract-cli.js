// `council contract lock | show | amend --decide` (0.8.2 item 6d, plan M8). `contract check` stays in src/cli.js beside the thin-contract check it extends.
//
//   council contract lock <run folder> [--draft <file>]
//       lints the draft (default: <run>/contract/draft.json), shows the person the exact text through the approval gate, and on approval writes contract/v1.json, contract/CONTRACT.md and the ledger line.
//       Exit 0 locked, 1 refused (the lint, a run that already has a contract, a declined or unconfirmed approval: nothing written), 2 usage, no such run, no draft, or no terminal for the answer,
//       3 the gate is waiting for a person (nothing written; answer it with `council gate answer`, then run this again).
//   council contract show <run folder> [--md]
//       the current version, its obligations and requests, derived from the ledger; --md prints the exact CONTRACT.md. Exit 0, 1 (the record does not read), 2 (no contract).
//   council contract amend --decide <run folder> [request] [--decline]
//       with no request: lists the open amendment requests. With one: prints the EXACT current and proposed words of the obligation through the gate, asks at the terminal, and records version n+1
//       naming version n (approve) or the person's refusal (--decline). Only a person at a terminal can do this: it goes through the gate's terminal answer (src/gate-cli.js), the same one `council gate
//       answer` uses, and nothing in the MCP server reaches it. Exit 0 recorded, 1 refused or not confirmed, 2 usage or no terminal.
//   council contract check <run folder>   (in src/cli.js; $0)
//
// This file has no prompt of its own and names no way to answer a gate: the answer is src/gate-cli.js's answerAtTerminal, which needs a terminal on stdin AND stdout (test/gate-answer.test.js scans for
// both, and for who may call it).
import { readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { answerAtTerminal } from './gate-cli.js';
import { trustedRunDir, readRunJson } from './run-files.js';
import { deriveRunStatus } from './run-status.js';
import { isAdviceFolder } from './stop-files.js';
import { readCriteria } from './handoff-from-run.js';
import { criterionIds } from './criteria-ledger.js';
import { terminalSafe } from './terminal-safe.js';
import {
  CONTRACT_DIR, GATE_KIND_LOCK, GATE_KIND_AMEND, prepareLock, ensureGate, approvalOf, commitLock, prepareAmendment, commitAmendment, declineAmendment, showContract, loadCurrent, renderContractMd, contractState,
} from './contract-record.js';

const USAGE = [
  'usage: council contract check <run folder> [--handoff <HANDOFF.md>]',
  '       council contract draft --from-run <run folder> [--chain <name>] [--max-usd N|none]',
  '       council contract lock <run folder> [--draft <file>]',
  '       council contract show <run folder> [--md]',
  '       council contract amend --decide <run folder> [request] [--decline]',
];
// A draft is a short list of obligations; 200 KB is far above forty obligations of 2,000 characters (the lint's own limits) and far below anything that is not a draft.
const DRAFT_MAX_BYTES = 200_000;

const oneLine = (t, n = 100) => { const s = terminalSafe(String(t ?? '')).replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

/** Parses the arguments of one subcommand: positionals, the flags it knows (a value flag takes the next token), and an unknown flag is a usage error. */
function parse(args, valueFlags, boolFlags) {
  const pos = [], flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const name = a.slice(2);
    if (valueFlags.includes(name)) { if (args[i + 1] === undefined || args[i + 1].startsWith('--')) return { error: `--${name} needs a value` }; flags[name] = args[++i]; } else if (boolFlags.includes(name)) flags[name] = true; else return { error: `unknown option ${a}` };
  }
  return { pos, flags };
}

function runOf(work, arg, err) {
  const abs = resolve(work, arg);
  const trusted = trustedRunDir(dirname(abs), basename(abs));
  if (trusted.refusal) { err(`contract: ${trusted.refusal}`); return null; }
  return trusted.dir;
}

/** Runs one `contract` subcommand (all but `check`). `io` carries the streams so a test can drive it; the terminal test reads `isTTY` off the streams it is given. */
export async function contractCommand(args, { work = process.cwd(), stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, now } = {}) {
  const out = s => stdout.write(`${s}\n`);
  const err = s => stderr.write(`${s}\n`);
  const usage = (why) => { if (why) err(`contract: ${why}`); for (const l of USAGE) err(l); return 2; };
  const opts = now ? { now } : {};
  const [sub, ...rest] = args;

  if (sub === 'lock') {
    const p = parse(rest, ['draft'], []);
    if (p.error) return usage(p.error);
    if (p.pos.length !== 1) return usage();
    const runDir = runOf(work, p.pos[0], err); if (!runDir) return 2;
    if (isAdviceFolder(runDir)) { err(`contract lock: ${p.pos[0]} is an advice call, not a plan: it has nothing to make a contract from`); return 2; }
    if (deriveRunStatus(runDir, readRunJson(runDir, 'run.json')) === 'running') { err(`contract lock: ${p.pos[0]} is still running; lock a contract from a run that has ended`); return 2; }
    const draftPath = p.flags.draft ? resolve(work, p.flags.draft) : join(runDir, CONTRACT_DIR, 'draft.json');
    let draft;
    try {
      if (statSync(draftPath).size > DRAFT_MAX_BYTES) { err(`contract lock: ${draftPath} is over ${DRAFT_MAX_BYTES} bytes; a draft is a short list`); return 2; }
      draft = JSON.parse(readFileSync(draftPath, 'utf8'));
    } catch (e) {
      err(e.code === 'ENOENT' ? `contract lock: no draft at ${draftPath} (write one with council contract draft --from-run ${p.pos[0]}, or pass --draft <file>)` : `contract lock: ${draftPath} is not readable JSON`);
      return 2;
    }
    const ids = criterionIds(readCriteria(runDir));
    // Audit fix cnc-contract F3: a run with no criteria passes the EMPTY list, like `contract draft` (the draft prompt's own rule: "With no # Criteria section, write no criterion"): an invented `Criterion: C7` is refused, not locked.
    const prep = prepareLock(runDir, draft, { criteriaIds: ids });
    if (!prep.ok) {
      err(`contract lock: ${prep.message}`);
      for (const l of prep.problems || []) err(`  ${terminalSafe(l)}`);
      return 1;
    }
    out(`contract lock: ${prep.content.obligations.length} obligation${prep.content.obligations.length === 1 ? '' : 's'}; the exact text a person approves is ${prep.rel} (sha256 ${prep.sha256.slice(0, 12)})`);
    // A listing for the person at the terminal, never a refusal (0.8.2, the review of the contract-draft prompt): what the draft leaves uncovered and what it marks as a gap.
    const named = new Set(prep.content.obligations.map(o => o.criterion).filter(Boolean));
    const uncovered = ids.filter(id => !named.has(id));
    if (uncovered.length) out(`contract lock: criteria no obligation names: ${uncovered.join(', ')} (the contract says nothing about them)`);
    const unresolved = prep.content.obligations.filter(o => /^\s*UNRESOLVED:/i.test(o.text));
    if (unresolved.length) out(`contract lock: ${unresolved.length} obligation${unresolved.length === 1 ? ' is' : 's are'} marked UNRESOLVED (a recorded gap, not a thing to build): ${unresolved.map(o => o.id).join(', ')}`);
    const gate = ensureGate(runDir, { kind: GATE_KIND_LOCK, rel: prep.rel, sha256: prep.sha256 }, opts);
    if (!gate.ok) { err(`contract lock: ${gate.message}`); return 1; }
    let state = approvalOf(runDir, gate.gate, opts);
    if (state.status === 'pending') {
      if (!(stdin.isTTY && stdout.isTTY)) {
        out(`contract lock: gate ${gate.gate} is waiting for a person. Read and answer it at a terminal: council gate answer ${p.pos[0]} ${gate.gate}`);
        out(`then run this command again. Nothing was written.`);
        return 3;
      }
      const code = await answerAtTerminal(runDir, gate.gate, { stdin, stdout, stderr, now });
      if (code !== 0) return code;
      state = approvalOf(runDir, gate.gate, opts);
    }
    if (state.status === 'declined') { err(`contract lock: gate ${gate.gate} was declined; nothing was written`); return 1; }
    if (state.status !== 'approved' || !state.usable) { err(`contract lock: gate ${gate.gate} is ${state.status}${state.status === 'approved' ? ' but no longer usable' : ''}; run this again to ask afresh. Nothing was written.`); return 1; }
    const res = commitLock(runDir, { content: prep.content, gate: gate.gate, sha256: prep.sha256, rel: prep.rel }, opts);
    if (!res.ok) { err(`contract lock: refused (${res.code}): ${res.message}`); return 1; }
    if (res.warning) err(`contract lock: note: ${res.warning}`);
    out(`contract lock: locked version 1 (${CONTRACT_DIR}/v1.json, record sha256 ${res.record.sha256}); the builder reads ${CONTRACT_DIR}/CONTRACT.md. Check it any time: council contract check ${p.pos[0]}`);
    return 0;
  }

  if (sub === 'show') {
    const p = parse(rest, [], ['md']);
    if (p.error) return usage(p.error);
    if (p.pos.length !== 1) return usage();
    const runDir = runOf(work, p.pos[0], err); if (!runDir) return 2;
    if (p.flags.md) {
      const cur = loadCurrent(runDir);
      if (cur.problem) { err(`contract show: ${cur.problem}`); return 1; }
      if (cur.none) { err('contract show: this run has no locked contract'); return 2; }
      stdout.write(renderContractMd(cur.record));
      return 0;
    }
    const s = showContract(runDir);
    for (const l of s.lines) (s.exit === 0 ? out : err)(terminalSafe(l));
    return s.exit;
  }

  if (sub === 'amend') {
    const p = parse(rest, [], ['decide', 'decline']);
    if (p.error) return usage(p.error);
    if (!p.flags.decide) return usage('amend needs --decide (a request is made with the contract_amend tool; only a person decides one)');
    if (p.pos.length < 1 || p.pos.length > 2) return usage();
    const runDir = runOf(work, p.pos[0], err); if (!runDir) return 2;
    const st = contractState(runDir);
    if (!st.ok) { err(`contract amend: ${st.problem}`); return 1; }
    if (!st.current) { err('contract amend: this run has no locked contract'); return 2; }
    if (p.pos.length === 1) {
      const open = st.requests.filter(r => r.status === 'open');
      if (!open.length) { out('contract amend: no open amendment requests'); return 0; }
      out(`${open.length} open amendment request${open.length === 1 ? '' : 's'} against version ${st.current}; decide one with: council contract amend --decide ${p.pos[0]} <request>`);
      for (const r of open) out(`  ${r.seq}  ${r.obligation_id}: ${oneLine(r.reason)}`);
      return 0;
    }
    if (!/^[1-9][0-9]*$/.test(p.pos[1])) return usage('the request is the ledger line number shown in the list');
    const seq = Number(p.pos[1]);
    const prep = prepareAmendment(runDir, seq);
    if (!prep.ok) { err(`contract amend: ${prep.message}`); return 1; }
    const gate = ensureGate(runDir, { kind: GATE_KIND_AMEND, rel: prep.rel, sha256: prep.sha256 }, opts);
    if (!gate.ok) { err(`contract amend: ${gate.message}`); return 1; }
    let state = approvalOf(runDir, gate.gate, opts);
    if (state.status === 'pending') {
      const code = await answerAtTerminal(runDir, gate.gate, { decline: Boolean(p.flags.decline), stdin, stdout, stderr, now });
      if (code !== 0) return code;
      state = approvalOf(runDir, gate.gate, opts);
    }
    if (state.status === 'declined') {
      const res = declineAmendment(runDir, { requestSeq: seq, gate: gate.gate }, opts);
      if (!res.ok) { err(`contract amend: refused (${res.code}): ${res.message}`); return 1; }
      out(`contract amend: request ${seq} declined; the contract stays at version ${prep.prior.version} (recorded at ledger line ${res.seq})`);
      return 0;
    }
    if (p.flags.decline && state.status === 'approved') { err(`contract amend: --decline was given, but gate ${gate.gate} was already approved by a person (council gate answer); nothing was recorded. Run this again without --decline to record the approval, or decline a new request.`); return 1; }
    if (state.status !== 'approved' || !state.usable) { err(`contract amend: gate ${gate.gate} is ${state.status}; nothing was recorded`); return 1; }
    const res = commitAmendment(runDir, { request: prep.request, prior: prep.prior, gate: gate.gate, sha256: prep.sha256, rel: prep.rel }, opts);
    if (!res.ok) { err(`contract amend: refused (${res.code}): ${res.message}`); return 1; }
    if (res.warning) err(`contract amend: note: ${res.warning}`);
    out(`contract amend: version ${res.record.version} recorded (amended after lock, v${res.record.version} from v${prep.prior.version}; obligation ${prep.request.obligation_id}; record sha256 ${res.record.sha256})`);
    return 0;
  }

  return usage(sub ? `unknown subcommand ${JSON.stringify(sub)}` : undefined);
}
