// `council tree approve | decide | resume | stop <rootId>` (0.8.3 M5; PLAN 10.1). The person's verbs for a recursive-councils tree, one dispatch line in src/cli.js like `contract`.
// `start` (M6 S5) makes the root run itself, so it takes NO run id and is dispatched before any root is resolved; its options are its own `--child-chain` plus three it shares with a normal run (`shared`, below). `status` (M6 S6, B's src/tree-status.js) is read-only: one positional, no options, nothing written, no terminal needed. `check` (M6 S2) is parsed here: three positionals (the root, a qualified id, `pass` or `fail`)
// and no options (its handler is src/tree-check.js).
//
// What this file is for: argument discipline. A tree verb moves money, so it is stricter than the rest of the CLI:
//   - it takes exactly one positional, the root run (a bare id is runs/<id> under the working folder; a path to the run folder works too), and a positional that starts with a dash is refused; `check` alone takes three, the
//     root FIRST (only positional 1 is ever resolved as a run, so a qualified id, which has a `/`, is never taken for a path);
//   - each verb takes ONLY its own options; any other option is refused here, even one the global list knows (`--yes` is on that list for `council init`, so `council tree approve <id> --yes` would otherwise pass
//     the unknown-flag refusal and be ignored: the lesson of `--dry`). No option, environment value or MCP argument approves anything: approving is a person's answer at a terminal (src/tree-gate.js);
//   - an option given twice, or a value flag without its value, is refused.
// This file reads no environment variable. The handlers (src/tree-approve.js, ...) get the parsed flags and the streams; none of them parses argv.
import { existsSync } from 'node:fs';
import { basename, dirname, resolve, join } from 'node:path';
import { trustedRunDir } from './run-files.js';
import { TREE_DIR, TREE_FILE } from './tree-record.js';
import { approveHandler } from './tree-approve.js';
import { stopHandler } from './tree-run.js';
import { resumeHandler } from './tree-resume.js';
import { decideHandler } from './tree-decide.js';
import { checkHandler } from './tree-check.js';
import { statusHandler } from './tree-status.js';
import { startHandler } from './tree-start.js';

/** The options a tree verb takes. Spelled with their dashes on purpose: test/cli-unknown-flag.test.js scans this file for `--name` and fails if one is missing from the CLI's known list. */
export const TREE_VERBS = Object.freeze({
  approve: { value: [], bool: [] },
  decide: { value: ['--milestone', '--keep', '--accounting', '--top-up', '--amount', '--close', '--allow-pii-node', '--continue-node', '--finish-node', '--prevail-node', '--prevail', '--obligation', '--stop', '--max-runs', '--max-depth', '--max-children', '--amend-cap', '--accept-chain-limits', '--allow-size'], bool: ['--abandon', '--open-root-stop', '--accept-plan', '--fresh'] },       // ROADMAP 57 / S8-8: the BOOLEAN tree options (src/cli.js BOOLEAN_FLAGS lists both too)
  resume: { value: [], bool: [] },
  stop: { value: [], bool: [] },
  check: { value: [], bool: [], positionals: 3 },
  status: { value: [], bool: [] },
  // `shared`: options `start` takes that a NORMAL run takes too (the task, the root chain, the cap, the personal-data mode). They are not tree-only, so they are in neither derived list below; any other verb refuses them.
  // `sharedBool`: a FLAG `start` takes that a normal run takes too (`--dry-run`, ROADMAP 56). Not `shared` (every shared option takes a value) and not `bool` (that would make it tree-only, and a normal run's --dry-run would be refused): in neither derived list below.
  start: { value: ['--child-chain'], bool: [], positionals: 0, shared: ['--task', '--chain', '--max-usd', '--pii-gate', '--allow-pii'], sharedBool: ['--dry-run'] },
});
/** `--prevail` is the standalone run's flag too (`--resume <run> --prevail ...`, exit 25): `decide --prevail-node` takes it as a tree verb, and cli.js must not refuse it as a stray tree option. */
const SHARED_WITH_RUN = 'prevail';
/** Every option that only a tree verb takes: src/cli.js refuses them on any other command (they are on the global known list so a tree verb gets past it, and a normal run would otherwise ignore them). */
export const TREE_ONLY_FLAGS = Object.freeze([...new Set(Object.values(TREE_VERBS).flatMap(v => [...v.value, ...v.bool]))].map(f => f.slice(2)).filter(f => f !== SHARED_WITH_RUN));

/** The options of a tree verb that take a value, without their dashes: derived from TREE_VERBS (no second list). src/cli.js lists them in VALUE_FLAGS so `--max-runs=3` splits; test/regression-081-audit-money.test.js (A1-1) pins that. */
export const TREE_VALUE_FLAGS = Object.freeze([...new Set(Object.values(TREE_VERBS).flatMap(v => v.value))].map(f => f.slice(2)));

const USAGE = [
  'usage: council tree approve <rootId>',
  '       council tree decide <rootId> [--milestone <id> | --keep <node>@g<n> | --accounting <node> | --top-up <node> --amount <usd> | --close <node> | --allow-pii-node <node>@g<N> | --continue-node <node> | --finish-node <node> | --prevail-node <node> --prevail <n>=<objection id>|neither[,...] | --abandon | --open-root-stop | --accept-plan --stop <stopId> | --amend-cap <total> | --accept-chain-limits <chain> | --obligation <id> --stop <stopId> | --max-runs <n> | --max-depth <n> | --max-children <n>] [--fresh | --allow-size <bytes>]',
  '       council tree resume <rootId>',
  '       council tree stop <rootId>',
  '       council tree check <rootId> <id> pass|fail',
  '       council tree status <rootId>',
  '       council tree start --task <file> --chain <root chain> --child-chain <name> --max-usd <usd> [--pii-gate warn|hard-stop | --allow-pii <types found>]',
  '       council tree start --task <file> --chain <root chain> --child-chain <name> --dry-run [--max-usd <usd>]   (prices a tree; starts nothing)',
  'An approval is never an option: `approve`, `decide` and `check` show you the exact text and ask you at a terminal. `decide --continue-node`, `--finish-node` and `--prevail-node` record your choice for a stopped node: they open no approval gate, ask nothing and start no run; `council tree resume` applies the choice.',
];
// Options a reader might try in order to approve without reading; the refusal says so instead of "not an option".
// (names without their dashes: these are not options of the CLI, and the option scan must not list them as if they were)
// A tree takes no override of the outbound key scan (the scan IS on by default): a flag typed once at the root would flow into every child's context, across every seat and generation, a far wider send than the one run the flag was made for
// (C&C, 12 Oct; held for the owner). `--pii-gate` is not an override but a protection turned ON (S5b part A: a `shared` option of `start`), and `--allow-pii` is NOT here either (T-b, 19 Okt 2026: it is a shared option of `start` for the ROOT task, recorded in tree.json; a member takes none; its text is model-written, so one typed at the root would silently exempt every child), so it gets the ordinary "not an option" sentence
// (Muad answered that a tree may carry the gate, 12 Oct: `--pii-gate` is a `shared` option of `start`; the allow-list stays out because a tree's text is model-written, so there is nothing for it to override).
const NO_OVERRIDE = new Set(['allow-secret-shaped']);
const APPROVAL_LOOKALIKES = new Set(['yes', 'y', 'approve', 'approved', 'force', 'no-prompt', 'non-interactive', 'confirm', 'assume-yes']);

/** { verb, rootArg, flags } or { error }; `check` also carries `args: [id, result]` (the other verbs return exactly the old shape). Pure. */
export function parseTreeArgs(args) {
  const [verb, ...rest] = args;
  if (!verb || verb.startsWith('-')) return { error: verb ? `${verb}: a tree command starts with its verb` : 'a tree command needs a verb' };
  const spec = Object.hasOwn(TREE_VERBS, verb) ? TREE_VERBS[verb] : null;   // own names only: `toString`, `constructor` and `__proto__` are not verbs
  if (!spec) return { error: `${verb}: not a tree command` };
  const pos = []; const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('-')) { pos.push(a); continue; }
    if (!a.startsWith('--')) return { error: `${a}: a positional that starts with a dash is refused (the tree has no single-dash option)` };
    if (verb === 'start' && NO_OVERRIDE.has(a.slice(2))) return { error: `${a}: a tree takes no override of the key scan: change the task, or use a normal \`council --task\` run with the flag` };
    if (APPROVAL_LOOKALIKES.has(a.slice(2))) return { error: `${a}: no option approves anything. \`council tree ${verb}\` shows you the exact text and asks you at a terminal` };
    if (spec.value.includes(a) || (spec.shared ?? []).includes(a)) {
      if (rest[i + 1] === undefined || rest[i + 1].startsWith('--')) return { error: `${a} needs a value` };
      if (Object.hasOwn(flags, a.slice(2))) return { error: `${a} was given twice` };
      flags[a.slice(2)] = rest[++i];
    } else if (spec.bool.includes(a) || (spec.sharedBool ?? []).includes(a)) {
      if (Object.hasOwn(flags, a.slice(2))) return { error: `${a} was given twice` };
      flags[a.slice(2)] = true;
    } else {
      return { error: `${a}: not an option of \`council tree ${verb}\`${spec.value.length ? ` (it takes ${[...spec.value, ...(spec.shared ?? []), ...(spec.sharedBool ?? [])].join(', ')})` : ' (it takes no options)'}` };
    }
  }
  if (spec.positionals === 0) {
    if (pos.length) return { error: `council tree ${verb} takes no run id: it makes one` };
    return { verb, rootArg: null, flags };
  }
  if (spec.positionals === 3) {
    if (pos.length !== 3) return { error: `council tree ${verb} takes <rootId> <id> pass|fail` };
    if (pos[2] !== 'pass' && pos[2] !== 'fail') return { error: `${JSON.stringify(pos[2])}: the result is exactly pass or fail (lower case)` };
    return { verb, rootArg: pos[0], args: [pos[1], pos[2]], flags };
  }
  if (pos.length !== 1) return { error: pos.length ? `council tree ${verb} takes one run (the root), not ${pos.length}` : `council tree ${verb} needs the root run: council tree ${verb} <rootId>` };
  return { verb, rootArg: pos[0], flags };
}

/** The root run folder for an argument: { rootDir, rootId } or { error }. A bare id is runs/<id> under `work`; anything with a separator is a path. The folder must hold a tree. */
export function resolveRoot(work, arg) {
  const abs = /[\\/]/.test(arg) ? resolve(work, arg) : join(work, 'runs', arg);
  const trusted = trustedRunDir(dirname(abs), basename(abs));
  if (trusted.refusal) return { error: `${arg}: ${trusted.refusal}` };
  if (!existsSync(join(trusted.dir, TREE_DIR, TREE_FILE))) return { error: `${arg}: that run folder holds no tree (no ${TREE_DIR}/${TREE_FILE})` };
  return { rootDir: trusted.dir, rootId: basename(trusted.dir) };
}

export const DEFAULT_HANDLERS = { approve: approveHandler, decide: decideHandler, resume: resumeHandler, stop: stopHandler, check: checkHandler, status: statusHandler, start: startHandler };

/** Runs one `council tree` command. `io` carries the streams (a test drives them); `handlers` is the seam a test or a later commit fills. Returns the exit code: 0 done, 1 refused or not confirmed, 2 usage; `resume` also answers 3 (a child waits for an external answer), 4 (a child stopped at its cap), 19 (the tree refused a start) and 20 (the sitting stopped for a person and nothing broke: an open stop or a pending replacement holds children back, or the step belt ran out), the codes of the runs it reports plus the tree's own. */
export async function treeCommand(args, { work = process.cwd(), stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, now, handlers = DEFAULT_HANDLERS, ceiling, piiSetting } = {}) {
  const err = s => stderr.write(`${s}\n`);
  const p = parseTreeArgs(args);
  if (p.error) { err(`tree: ${p.error}`); for (const l of USAGE) err(l); return 2; }
  // a verb that parses but has no handler yet answers like a later verb: plainly, before the root is read, nothing run
  if (!Object.hasOwn(handlers, p.verb) || typeof handlers[p.verb] !== 'function') { err(`tree: council tree ${p.verb} is not part of this build (it arrives with the readiness milestone)`); for (const l of USAGE) err(l); return 2; }
  // `start` has no root folder yet: it makes one, so it is dispatched here, before resolveRoot
  if (p.verb === 'start') return handlers.start({ flags: p.flags, work, stdin, stdout, stderr, ...(now ? { now } : {}), ceiling, ...(piiSetting ? { piiSetting } : {}) });
  const root = resolveRoot(work, p.rootArg);
  if (root.error) { err(`tree ${p.verb}: ${root.error}`); return 2; }
  return handlers[p.verb]({ ...root, ...(p.args ? { args: p.args } : {}), flags: p.flags, work, stdin, stdout, stderr, ...(now ? { now } : {}), ceiling });
}
