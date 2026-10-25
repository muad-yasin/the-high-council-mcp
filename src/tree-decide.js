// `council tree decide <rootId> <one form>` (0.8.3 M5d; PLAN 8.4, 8.6, 10.1, D16, D17; M5-DEFAULTS 12). The person's decisions, one form per invocation, each through its own gate on channel `cli` (src/tree-gate.js): the
// exact text is written first and hashed, the person answers at a terminal after TYPING the changed thing (the new value, the amount, the node path - never a bare "y"), and nothing is written to the record before the yes.
// Order, the same for every form (and why):
//   1. build: read the record, check every precondition, derive the text. A refusal here asks nobody and writes nothing;
//   2. request the gate with that text and ask at the terminal; a declined, unanswered or expired gate approves nothing and records nothing;
//   3. after the yes the form is built AGAIN: if its text (so the figures the person read) or a precondition changed meanwhile, the approval is NOT used and nothing is written;
//   4. only then the approval is spent (one use) and the event is appended, carrying the gate id and the hash of the text read.
// Forms (this file builds them in M5d's sub-commits; the others answer "not built in this commit"): --max-runs | --max-depth | --max-children <n> (a limit raise, raise-only); --top-up <node> --amount <usd>;
// --accounting <node>; --close <node>; --milestone <id> / no option (regenerate) with --obligation and --stop. The limit raises never touch tree.json or the root dollar cap.
// This file reads no environment variable and parses no argument (src/tree-cli.js hands it the parsed flags).
import { fanOutOf } from './tree-fan-out.js';
import { describeFrontier, findPendingFrontier } from './tree-frontier.js';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sha256Of } from './thin-contract.js';
import { TreeRefusal, appendTreeEvent, readTreeRecord, stateOf, treeDirOf, unreadableRecordRefusal } from './tree-record.js';
import { lockHolder } from './run-lock.js';
import { SITTING_LOCK_FILE } from './tree-run.js';
import { DEAD_REASON, candidatesOf, claimAlive, deadKeys, isSupersededGeneration, liveMembersOf } from './tree-transitions.js';
import { TREE_GATE_KINDS, askTreeGate, recordTreeUse, requestTreeGate } from './tree-gate.js';
import { askForRecommendation } from './tree-advice-route.js';
import { reconcileAdvice } from './tree-advice-record.js';
import { CHANGE_EMPTY, CHANGE_WORDS, changeRequestRefusal, draftTextRefusal } from './tree-session-draft.js';
import { MONEY_EPS, acceptAccounting, amendCap, capFactsOf, ceilCents, closeReturnOf, effectiveCapUsd, effectiveLimits, problemCover, startingCapUsd, budgetOf, bundleAllowanceBytesOf, chainFigures, gateTree, topUp, unreadableFloorOf } from './tree-budget.js';
import { chooseNode, choiceRefusal, readConflictStopOfRun, remainingGrantOf, waitingForChoice } from './tree-choice.js';
import { parsePrevail } from './conflict-decider.js';
import { memberResumeCommand } from './tree-redirect.js';
import { runEndOf } from './tree-member.js';
import { closeIncomplete, closeRefusal, closeUnstarted, describePhase, registeredChainOf, unstartedStopOf, waitingFor } from './tree-close.js';
import { loadChainConfig, readPlanOf } from './tree-derive-load.js';
import { renderLimitStop, money, unknownSpendLine } from './tree-stop.js';
import { terminalSafeMarked } from './terminal-safe.js';
import { abandonRefusal, abandonTree, finalSentenceOf, recordRefusalLine } from './tree-abandon.js';
import { openPersonStop, personStopPreflight } from './tree-person-stop.js';
import { rootTaskPinFrom } from './tree-task-pin.js';
import { parseCapInput } from './cap-input.js';
import { amendCeilingArgs, treeIsPaid, wayOutOfCeiling, CEILING_NAME } from './tree-ceiling.js';
import { redactText } from './secret-patterns.js';
import { stoppedReasonsOf } from './tree-resume.js';
import { recordReadinessAfter } from './tree-readiness.js';
import { piiGateReport, textSecretFindings } from './run-preflight.js';
import { treeInputScanModeFrom } from './tree-pii-mode.js';
import { secretRefusalLines } from './outbound-scan.js';
import { fileProblemLine, writeTreeFiles } from './tree-files.js';
import { buildAcceptPlan } from './tree-decide-accept.js';
import { allowBundleInput } from './tree-bundle-input.js';
import { buildAcceptChainLimits } from './tree-chain-limits.js';
import { askChangesProvides, buildStopDecision, readDecisionText, rootRemedies, stopPreflight, waitingDraft } from './tree-decide-stop.js';

/** --allow-size <bytes>: a whole number or null (absent); anything else is NaN, which buildRootReplan refuses in words. */
const allowSizeOf = raw => (raw === undefined ? null : /^[0-9]+$/.test(String(raw)) ? Number(raw) : NaN);
const PRIMARY = Object.freeze(['milestone', 'keep', 'accounting', 'top-up', 'close', 'allow-pii-node', 'continue-node', 'finish-node', 'prevail-node', 'abandon', 'open-root-stop', 'accept-plan', 'amend-cap', 'accept-chain-limits', 'max-runs', 'max-depth', 'max-children']);
const LIMIT_OF = Object.freeze({ 'max-runs': 'maxRuns', 'max-depth': 'maxDepth', 'max-children': 'maxChildrenPerSplit' });

/** Which form this invocation is, from the parsed flags: one primary form (or none = regenerate); --amount only with --top-up (and required by it); --obligation and --stop only with the stop forms. */
export function chooseForm(flags) {
  const given = PRIMARY.filter(f => flags[f] !== undefined);
  if (given.length > 1) return { error: `one form per invocation: ${given.map(f => `--${f}`).join(', ')} were all given` };
  const form = given[0] ?? null;
  if (flags.fresh !== undefined && form !== null) return { error: '--fresh belongs to a new plan for a stop (no other option) only' };       // A-DRAFT
  if (flags['allow-size'] !== undefined && (form !== null || flags.fresh !== undefined)) return { error: '--allow-size belongs to a new root plan for a stop (no other option, and not with --fresh) only' };       // B-DRAFT
  if (flags.prevail !== undefined && form !== 'prevail-node') return { error: '--prevail belongs to --prevail-node <node> only (the node whose conflict you answer)' };
  if (form === 'prevail-node' && flags.prevail === undefined) return { error: '--prevail-node needs --prevail <n>=<objection id>|neither[,...] (one pick for every conflict the decider asked about)' };
  if (flags.amount !== undefined && form !== 'top-up') return { error: '--amount belongs to --top-up only' };
  if (form === 'top-up' && flags.amount === undefined) return { error: '--top-up needs --amount <usd> (the amount is typed on the command line and again at the prompt)' };
  if ((flags.obligation !== undefined || flags.stop !== undefined) && form !== null && form !== 'milestone' && form !== 'keep' && !(form === 'accept-plan' && flags.obligation === undefined)) return { error: '--obligation and --stop belong to the stop forms (--milestone, --keep, or no option to regenerate)' };
  return { form: form ?? 'regenerate', value: form ? flags[form] : null };
}

/** The numbers a limit stop shows (src/tree-stop.js renderLimitStop), read from the record: every child not registered and refused for this limit in the latest preview of a frontier, with its scope verbatim. */
function limitStopView({ rootDir, work, record, limit, flag, to }) {
  const state = stateOf(record);
  const runsDir = dirname(rootDir);
  const limits = effectiveLimits(record.tree, record.events);
  const registered = new Set([...state.nodes.values()].map(n => `${n.node}@g${n.generation}`));
  const open = []; const unexpanded = new Set(); let siblings = 0;
  for (const [key, f] of state.frontiers) {
    const preview = record.events.filter(e => e.event === 'frontier_previewed' && e.frontierKey === key).at(-1);
    if (!f.previewed || !preview) continue;
    const parent = state.nodes.get(`${preview.parentNode}@g${preview.parentGeneration}`);
    const block = parent ? readPlanOf(runsDir, parent).block : null;
    siblings = Math.max(siblings, fanOutOf(state, key));
    for (const c of preview.children) {
      if (c.admitted === true || registered.has(`${c.node}@g${c.generation}`) || c.limit !== limit) continue;
      const entry = block?.children?.find(k => `${preview.parentNode}/${k.milestone}` === c.node);
      open.push({ node: c.node, scope: entry?.scope ?? '(the scope could not be read)', depth: c.node.split('/').length - 1 });
    }
    for (const m of block?.milestones ?? []) if (m.status === 'decompose' && !(block.children ?? []).some(k => k.milestone === m.id)) unexpanded.add(`${preview.parentNode}/${m.id}`);
  }
  // D2 F13b: the PENDING frontier's live preview too (findPendingFrontier + describeFrontier, read-only), so the hint its screen prints (src/tree-stop.js) is accepted before any preview is recorded. A throw is caught by the caller and
  // becomes a refusal (D3 F13 note); a frontier that cannot be described adds nothing.
  const pending = findPendingFrontier({ rootDir, record, state });
  if (pending && pending.kind !== 'root_replan') {
    const live = describeFrontier({ rootDir, work, pending });
    if (!live.refusal) {
      siblings = Math.max(siblings, live.view.limits?.find(l => l.limit === 'children per split')?.count ?? 0);
      for (const c of live.view.children ?? []) {     // the view's children carry the scope from the parent's verified block (describeFrontier read it), so no second plan read here
        if (c.admitted === true || c.registered || registered.has(`${c.node}@g${c.generation}`) || c.refusedLimit !== limit || open.some(o => o.node === c.node)) continue;
        open.push({ node: c.node, scope: c.scope, depth: c.node.split('/').length - 1 });
      }
    }
  }
  const effective = limits[limit];
  const count = limit === 'maxRuns' ? state.nodes.size : limit === 'maxDepth' ? Math.max(0, ...[...state.nodes.values()].map(n => n.depth ?? 0)) : siblings;
  const raises = record.events.filter(e => e.event === 'limit_raised' && e.limit === limit && e.to > (e.from ?? 0)).map(e => ({ from: e.from, to: e.to }));
  const wouldAdmit = limit === 'maxDepth' ? open.filter(o => o.depth <= to).length : Math.min(open.length, Math.max(0, to - effective));
  let perChild = null;
  try {
    const depth = open[0]?.depth ?? 1;
    const chain = loadChainConfig({ tree: record.tree, depth, work });
    const f = chainFigures(chain.config, { inputBytes: bundleAllowanceBytesOf(record.tree) });
    perChild = f ? { name: chain.name, atMostUsd: f.atMostUsd } : null;
  } catch { perChild = null; }
  const gate = gateTree(rootDir, { record });
  const budget = budgetOf(rootDir, { record, gate });
  return { limit, count, effective, initial: record.tree.limits[limit], raises, open: open.map(({ node, scope }) => ({ node, scope })), unexpanded: [...unexpanded], perChild, wouldAdmit, budget: { rootCapUsd: effectiveCapUsd(record), availableUsd: budget.availableUsd, unknownSpendHeldUsd: budget.unknownSpendHeldUsd, unknownSpendNodes: budget.unknownSpendNodes }, rootId: record.tree.treeId, flag };
}

/** The limit-raise form: -> { refusal } | { text, expect, formName, apply }. Nothing is written here. */
function buildLimitRaise({ rootDir, work, flag, raw }) {
  const record = readTreeRecord(rootDir);
  { const unreadable = unreadableRecordRefusal(record); if (unreadable) return { refusal: unreadable }; }
  const limit = LIMIT_OF[flag];
  if (!/^[1-9][0-9]{0,5}$/.test(String(raw))) return { refusal: `--${flag}: expected a whole number (the new value), got ${JSON.stringify(String(raw))}` };
  const to = Number(raw);
  const effective = effectiveLimits(record.tree, record.events)[limit];
  if (!(to > effective)) return { refusal: `--${flag} ${to} is not a raise: the effective value is ${effective}. A limit is only ever raised, never cut.` };
  let view;
  try { view = limitStopView({ rootDir, work, record, limit, flag, to }); } catch (e) { return { refusal: `the stop for this limit could not be put together (${e.message})` }; }
  // R17 (Opus 4-2; ruled by C&C): the raise is made AT a limit stop, after seeing the open work (PLAN 8.5: limit_raised only after a limit stop; D17). Nothing waiting for this limit = no stop to raise it at.
  if (!view.open.length) return { refusal: `--${flag} ${to}: no child is waiting for this limit, so there is no limit stop to raise it at (PLAN 8.5, D17: a limit is raised at the stop, after seeing the open work). It is ${effective} and stays so` };
  const text = `${renderLimitStop(view)}\nRaise ${limit} from ${effective} to ${to}. tree.json and the root dollar cap (${money(effectiveCapUsd(record))}) do not change. A raise invalidates the earlier approval of the frontiers it affects: you approve the newly admitted children separately with \`council tree approve ${view.rootId}\`.\n\nTo approve, type the new value: ${to}\n`;
  return {
    text: terminalSafeMarked(text), expect: String(to), formName: `raise ${limit}`, after: `tree.json and the root cap are unchanged. Run \`council tree approve ${view.rootId}\` to see the newly admitted children.`,
    apply: ({ gateId, shownSha256, actor, via }) => appendTreeEvent(rootDir, { event: 'limit_raised', limit, from: effective, to, shownSha256, gateId, actor, via }),
  };
}

/**
 * The typed top-up amount (0.8.3, the grammar unify after budget commit 2; C&C 14 Oct 2026). ONE grammar for every typed dollar amount: B's parseCapInput (src/cap-input.js), called with `paid: false` and NO ceiling (an increment is
 * bounded by the root cap's free dollars, which buildTopUp checks next; the ceiling bounds the CAP IN FORCE, not an increment: src/tree-ceiling.js). The parser says "the limit" and "Nothing was started."; those are the cap's words, so each refusal CODE gets the top-up's own sentence here.
 * -> { amount, text } | { refusal }. `text` is the amount AS GIVEN, trimmed (what the person retypes at the prompt is compared to it as text: 2.50 is not 2.5); `amount` is its number. Zero parses (paid: false) and is refused here.
 * Any other code (zero_paid, ceiling_*) cannot occur with these options; it still refuses (fail closed) rather than reading as an amount.
 */
export function parseTopUpAmount(raw) {
  const parsed = parseCapInput(raw, { paid: false });
  const shown = (() => { const t = redactText(String(raw)).text.trim(); return t.length > 40 ? `${t.slice(0, 40)}...` : t; })();     // a key pasted into the wrong field is not echoed (the parser's own rule)
  if (parsed.ok) {
    if (parsed.capMicroUsd === 0) return { refusal: `--amount: "${shown}" adds nothing. Type an amount above zero, for example 2.5` };
    return { amount: Number(parsed.capUsd), text: raw.trim() };
  }
  const words = {
    empty: '--amount: type the dollars to add, for example 2.5',
    comma: `--amount: "${shown}" has a comma. Use a dot for the decimals, for example 2.5`,
    precision: `--amount: "${shown}" has more than four decimals. Use at most four, for example 2.5025`,
    too_large: `--amount: "${shown}" has more than six digits before the dot. Type a smaller amount`,
    unlimited: `--amount: "${shown}" is not an amount of dollars. Type digits with an optional dot, for example 2.5`,
    format: `--amount: "${shown}" is not a plain amount of dollars. Type only digits and an optional dot, without a currency sign, letters, a plus or minus sign or an exponent, for example 2.5`,
  };
  return { refusal: words[parsed.code] ?? `--amount: "${shown}" was not accepted (${parsed.code})` };
}

/** `R/M1` or `R/M1@g2` -> the node of the record: a bare path is its newest generation. null when there is none. */
/** The label of a waiting path whose registration was replaced and has no node now (W1, already-false unit). */
const REPLACED_LABEL = `${DEAD_REASON}; nothing is registered for it now`;       // A-DRAFT

function nodeOf(state, arg) {
  const m = /^(.+?)(?:@g([1-9][0-9]*))?$/.exec(String(arg));
  const mine = [...state.nodes.values()].filter(n => n.node === m[1] && (m[2] === undefined || n.generation === Number(m[2]))).sort((a, b) => b.generation - a.generation);
  return mine[0] ?? null;
}

/** The top-up form (PLAN 7.5): only a node STOPPED at its cap, an amount the root cap still has free. -> { refusal } | { text, expect, formName, apply }. Nothing is written here. */
/** Money held for a paid recommendation request is not money held for children (ROADMAP 77): budget.advice carries it apart. B-DRAFT wording; with no request open the words are exactly what they always were. */
const adviceHeldOf = budget => (budget.advice ?? []).reduce((n, a) => n + a.heldUsd, 0);
export const heldWordsOf = budget => {
  const advice = adviceHeldOf(budget);
  return advice > MONEY_EPS ? `held for children ${money(Math.max(0, budget.heldUsd - advice))} and for a recommendation request ${money(advice)}` : `held for children ${money(budget.heldUsd)}`;
};
function buildTopUp({ rootDir, rootId, nodeArg, amountRaw, work, ceiling }) {
  const record = readTreeRecord(rootDir);
  { const unreadable = unreadableRecordRefusal(record); if (unreadable) return { refusal: unreadable }; }
  const typed = parseTopUpAmount(amountRaw);
  if (typed.refusal) return { refusal: typed.refusal };
  const { amount } = typed; const amountText = typed.text;
  // The approval screen shows the figure that will be RECORDED (C&C 14 Oct 2026): money() rounds to the cent from one cent up (below one cent it prints four decimals), so 0.0125 or 2.5025 read as $0.01 / $2.50 while the grant records the typed value; an amount two decimals cannot hold is shown AS TYPED. The derived figures (the grant total, what is left) stay on money(): they are sums, shown to the cent.
  const amountShown = Number(amount.toFixed(2)) === amount ? money(amount) : `$${amountText}`;
  const state = stateOf(record);
  const n = nodeOf(state, nodeArg);
  if (!n) return { refusal: `--top-up ${nodeArg}: no such node in this tree` };
  const key = `${n.node}@g${n.generation}`;
  if (n.phase !== 'stopped') return { refusal: `${key} is ${n.phase === 'running' || n.phase === 'registered' ? `${n.phase}${state.active === key ? ' (active)' : ''}` : n.phase}; only a node that stopped at its budget cap can be topped up` };
  // R10 (Opus 2-2): a stale or superseded node is never resumed (the tree refuses it, exit 19), so a top-up would promise a resume that cannot happen
  if (isSupersededGeneration(state, n.node, n.generation)) return { refusal: `${key} is superseded (a newer generation of ${n.node} is registered or opened): it is never resumed, so a top-up would do nothing` };
  if (state.stale.has(key)) return { refusal: `${key} is stale (${(state.staleWhy.get(key) ?? ['a stop put it in question']).join('; ')}): the tree would refuse to resume it (exit 19), so a top-up would promise a resume that cannot happen; answer the stop first` };
  const gate = gateTree(rootDir, { record });
  if (!gate.ok) return { refusal: `the accounting gate fails (${gate.problems.slice(0, 3).map(p => p.code).join(', ')}); no money is moved while it does` };
  const budget = budgetOf(rootDir, { record, gate });
  if (amount > budget.availableUsd + MONEY_EPS) return { refusal: `only ${money(budget.availableUsd)} of the root cap is free; ${money(amount)} was asked` };
  // TREE CEILING (15 Oct 2026, C&C; Q2 of the gate note): the increment is NOT compared to COUNCIL_MAX_USD_LIMIT (a top-up moves free dollars inside the cap in force, which bounds every grant); the screen names the ceiling only when the cap in force is ABOVE it,
  // because the node would then not start again. A paid tree whose ceiling cannot be read (or whose reader was not given) is refused: the resume would be refused anyway.
  const ceil = treeIsPaid(record.tree, work) ? (typeof ceiling === 'function' ? ceiling() : undefined) : null;
  if (ceil === undefined) return { refusal: `a paid tree cannot be topped up: the ${CEILING_NAME} reader was not given, so the ceiling cannot be checked` };
  if (ceil?.unreadable) return { refusal: `--top-up: ${ceil.unreadable.replace(/ Nothing was started\.$/, '')}` };
  const aboveCeiling = ceil && ceil.usd !== null && effectiveCapUsd(record) > Number(ceil.usd);
  const earlier = n.topUps.reduce((a, t) => a + t.amount, 0);
  const row = budget.nodes.find(x => x.key === key);
  const reasons = stoppedReasonsOf(join(dirname(rootDir), n.runId)).map(s => `  ${s.name}: ${s.text.split('\n').slice(0, 3).join(' ')}`);
  const text = `Give ${n.node} more money?   (generation ${n.generation}, run ${n.runId})
${n.node} stopped at its budget cap.${reasons.length ? `\n${reasons.join('\n')}` : ''}

Its grant now: ${money(n.grant.amount)} first${earlier ? ` + ${money(earlier)} in earlier top-ups` : ''} = ${money(n.grant.amount + earlier)}; spent so far ${money(row?.spentUsd ?? 0)}.
This top-up: ${amountShown}. Its grant would be ${money(n.grant.amount + earlier + amount)}.

The root cap is ${money(effectiveCapUsd(record))}: spent so far ${money(budget.treeSpentUsd)}, ${heldWordsOf(budget)},${unknownSpendLine(budget) ? ` ${unknownSpendLine(budget)},` : ''} still available ${money(budget.availableUsd)} now, ${money(budget.availableUsd - amount)} after this top-up. A top-up never raises the root cap.
${aboveCeiling ? `Ceiling in force: ${money(Number(ceil.usd))} (${CEILING_NAME}). The cap in force is above it, so ${n.node} will not start again, with or without this top-up, until the cap is lowered to ${money(Number(ceil.usd))} or less (\`council tree decide ${rootId} --amend-cap <total>\`; possible only while what the tree has committed is at or below that) or ${CEILING_NAME} is raised or unset.\n` : ''}Deciding this starts nothing: \`council tree resume ${rootId}\` resumes ${n.node} under the new total as the same attempt (it writes node_resumed first). Nothing else registers while it runs.

To approve, type the amount: ${amountText}
`;
  return {
    text: terminalSafeMarked(text), expect: amountText, formName: `top up ${key} by ${amountText}`, after: `Nothing was started. Run \`council tree resume ${rootId}\` to resume ${n.node} under its new total.`,
    apply: ({ gateId, shownSha256, actor, via }) => topUp(rootDir, { node: n.node, generation: n.generation, amountUsd: amount, gateId, shownSha256, actor, via }),
  };
}

/**
 * The cap amendment form (gate page 13, Astra #15): the person types a NEW TOTAL for the whole tree, on the command line and again at the prompt. -> { refusal } | { text, expect, typedLabel, formName, after, apply }. Nothing is written
 * here. Refused BEFORE anything is typed: a record that does not read, a total that is not a plain amount, a node that holds a live claim (its figures change while it runs, so the text read could never be the text recorded), a gate
 * problem other than `over_committed` (the cure is the raise), the cap already in force, a total below what is committed (the lowest accepted total, rounded up to the cent, is named). The revision the text shows is the one `amendCap` is
 * given: an amendment made while the person reads makes the rebuilt text differ and the approval is not used. A raise ADDS authorization: it starts nothing, resets nothing and clears no stop.
 */
function buildAmendCap({ rootDir, rootId, raw, facts, work, ceiling }) {
  const record = readTreeRecord(rootDir);
  { const unreadable = unreadableRecordRefusal(record); if (unreadable) return { refusal: unreadable }; }
  // ONE grammar for every typed dollar amount of a cap (C&C 14 Oct, Astra #10): B's parseCapInput, no second parser.
  // REVERSED (C&C, 14 Oct 2026 23:28; built 15 Oct 2026): the Astra #10 reading here was "No ceiling: a person at a terminal is the authority, and COUNCIL_MAX_USD_LIMIT is the MCP host's ceiling on an agent's start". COUNCIL_MAX_USD_LIMIT now bounds a tree's
  // typed totals too (tree start and this form; src/tree-ceiling.js). COST: a person who set the variable for their MCP agents only now finds it bounds their own tree totals; the refusal names the ceiling and how to lift it (the CLI's sentence plus the way out).
  // A paid tree whose ceiling cannot be read, or whose reader was not given, is refused (fail closed).
  const ceil = treeIsPaid(record.tree, work) ? (typeof ceiling === 'function' ? ceiling() : undefined) : null;
  if (ceil === undefined) return { refusal: `--amend-cap: a paid tree cannot be amended: the ${CEILING_NAME} reader was not given, so the ceiling cannot be checked` };
  if (ceil?.unreadable) return { refusal: `--amend-cap: ${ceil.unreadable.replace(/ Nothing was started\.$/, '')}` };
  const parsed = parseCapInput(raw, { paid: true, ...amendCeilingArgs(ceil) });
  if (!parsed.ok) return { refusal: `--amend-cap: ${parsed.sentence.replace(/ Nothing was started\.$/, '')}${parsed.code === 'above_ceiling' ? ` ${wayOutOfCeiling(ceil.source)}` : ''}` };
  const to = Number(parsed.capUsd);
  const state = stateOf(record);
  const live = liveMembersOf(state, facts);
  if (live.length) return { refusal: `${live[0].key} has a live ${live[0].kind === 'post_run' ? 'post-run call' : 'claim'} (pid ${live[0].pid} on ${live[0].host}): its figures change while it runs, so the figures you read could not be the ones recorded; amend the cap when it has ended or stopped (\`council tree stop ${rootId}\` starts nothing further but lets a running node finish)` };
  const gate = gateTree(rootDir, { record });
  const blocking = gate.problems.filter(p => p.code !== 'over_committed');       // over_committed is what a raise cures; every other gate problem stands
  if (blocking.length) return { refusal: `the accounting gate fails (${blocking.slice(0, 3).map(p => p.code).join(', ')}); the cap is not amended while it does` };
  const budget = budgetOf(rootDir, { record, gate });
  const capUsd = budget.rootCapUsd;
  const committedUsd = budget.treeSpentUsd + budget.unknownSpendHeldUsd + budget.heldUsd;
  const floorUsd = ceilCents(committedUsd);
  if (Math.abs(to - capUsd) <= MONEY_EPS) return { refusal: `${money(to)} is the cap already in force: nothing to amend` };
  if (to + MONEY_EPS < floorUsd) return { refusal: `${money(to)} is below the ${money(floorUsd)} already committed (spent or in flight, held for a spend that cannot be read, granted and not yet spent); the lowest total accepted now is ${money(floorUsd)}` };
  const revision = state.capAmendments.length + 1;
  const startedAt = startingCapUsd(record);
  const capLine = state.capAmendments.length ? `The cap in force: ${money(capUsd)} (the tree started at ${money(startedAt)}, as tree.json still says, and has been amended ${state.capAmendments.length} time${state.capAmendments.length === 1 ? '' : 's'}).` : `The cap in force: ${money(capUsd)} (the cap the tree started with, as tree.json says).`;
  const effect = to > capUsd ? `This ADDS ${money(to - capUsd)} to what the whole tree may spend. The total you type replaces the cap; it is not an increase on top of it.` : `This TAKES BACK ${money(capUsd - to)} of what the whole tree may spend. It may not go below what is already committed, ${money(floorUsd)}.`;
  const free = budget.availableUsd >= 0 ? `free ${money(budget.availableUsd)}` : `OVER the cap by ${money(-budget.availableUsd)} (the record commits more than the cap allows)`;
  // already-false unit (M3): a DEAD node that is not running, holds nothing and spent nothing neither holds money nor waits for it (its plan was replaced: it never starts); a dead node that spent stays listed (its figures are true), and a running one keeps its hold
  const dead = deadKeys(state);
  const open = budget.nodes.filter(n => n.phase !== 'closed' && !(dead.has(n.key) && n.phase !== 'running' && n.heldUsd === 0 && n.spentUsd === 0) && (n.heldUsd > 0 || n.spentUsd > 0 || ['registered', 'running', 'stopped'].includes(n.phase)));
  const closedCount = budget.nodes.filter(n => n.phase === 'closed').length;
  const cap = capFactsOf(record, budget);
  const waiting = cap.waiting.length ? cap.waiting.map(w => `${w.key} (${w.kind === 'stopped' ? 'stopped at its cap' : 'not admitted: budget'})`).join('; ') : 'nothing';
  const text = `Change the cap of this whole tree?   (tree ${rootId}, amendment ${revision})

${capLine}
You type a NEW TOTAL for the whole tree: ${money(to)}.
${effect}

Where the money stands now:
  spent, or in flight at its bound: ${money(budget.treeSpentUsd)}
  held for a spend that cannot be read: ${money(budget.unknownSpendHeldUsd)}
  granted and not yet spent: ${money(budget.heldUsd - adviceHeldOf(budget))}
${adviceHeldOf(budget) > MONEY_EPS ? `  held for a recommendation request: ${money(adviceHeldOf(budget))} (${budget.advice.filter(a => a.heldUsd > 0).map(a => `request ${a.adviceId}: set aside ${money(a.grantUsd)}, spent ${money(a.spentUsd)}`).join('; ')})\n` : ''}  ${free}
  committed in all: ${money(committedUsd)} (the lowest total this form accepts: ${money(floorUsd)})

The nodes that hold money or wait for it:${open.length ? '' : ' none'}
${open.map(n => `  ${n.key}: ${n.phase}; grant ${money(n.grantUsd)}, spent ${money(n.spentUsd)}, still held ${money(n.heldUsd)}`).join('\n')}${open.length ? '\n' : ''}  ${closedCount} finished node${closedCount === 1 ? '' : 's'} hold nothing (what they spent stays counted).
Waiting for money: ${waiting}.

This starts nothing and resets nothing. A raise gives a stopped node no money of its own; a stop that is not about money (a damaged record, a privacy finding, a rejected approval) stays exactly as it is.

To approve, type the new total: ${raw}
`;
  const steps = [];
  if (cap.waiting.some(w => w.kind === 'stopped')) steps.push(`A stopped node needs its own money: \`council tree decide ${rootId} --top-up <node> --amount <usd>\`, then \`council tree resume ${rootId}\`.`);
  if (cap.waiting.some(w => w.kind === 'refused')) steps.push(`A child that was not admitted for budget is offered again at \`council tree approve ${rootId}\`.`);
  return {
    text: terminalSafeMarked(text), expect: raw, typedLabel: 'the new total', formName: `amend the cap to ${raw}`,
    after: `Nothing was started and nothing was reset.${steps.length ? ` ${steps.join(' ')}` : ` \`council tree resume ${rootId}\` goes on under the new total.`}`,
    apply: ({ gateId, shownSha256, actor, via }) => amendCap(rootDir, { toCapUsd: to, expectedRevision: revision, gateId, shownSha256, actor, via }),
  };
}

/** PLAN 7.1 in a sentence per row, for the person (code-built text; the rows are the gate's own: src/tree-budget.js gateTree). */
const ROW_WORDS = Object.freeze({
  0: 'the tree adds nothing for it',
  1: 'settled and proven: the run\'s own record accounts for it',
  2: 'reserved and not settled: the run counts the worst case',
  3: 'reserved with evidence of the call: the run counts it twice, the tree removes the double count',
  4: 'known only to the mirror (the run\'s own file lacks it): the tree adds the worst case less any evidence',
  5: 'settled but not proven: the tree adds the worst case less any evidence',
});

/** The accounting form (PLAN 7.2): answers ONLY a failing gate for that node. -> { refusal } | { text, expect, formName, after, apply }. Nothing is written here. */
function buildAccounting({ rootDir, rootId, nodeArg }) {
  const record = readTreeRecord(rootDir);
  { const unreadable = unreadableRecordRefusal(record); if (unreadable) return { refusal: unreadable }; }
  const state = stateOf(record);
  const n = nodeOf(state, nodeArg);
  if (!n) return { refusal: `--accounting ${nodeArg}: no such node in this tree` };
  const key = `${n.node}@g${n.generation}`;
  const gate = gateTree(rootDir, { record });
  const mine = gate.problems.filter(p => p.node === key);
  if (!mine.length) return { refusal: `nothing to accept: the accounting gate has no problem about ${key}${gate.ok ? ' (it passes)' : ' (its problems are about other nodes)'}` };
  // answer 1 (ruling ii): the unreadable report of a node that is RUNNING is never covered (it may still write its own report.json); every other problem of a running node is accepted as before
  const runningReport = n.phase === 'running' ? mine.filter(p => p.code === 'report_unreadable') : [];
  const acceptable = mine.filter(p => p.keys.length && !runningReport.includes(p));
  const restore = mine.filter(p => !acceptable.includes(p));
  if (!acceptable.length && runningReport.length) return { refusal: `--accounting ${nodeArg}: ${key} is running; its own report.json is not final yet. Nothing is accepted for the unreadable report of a running node: wait for it to end.` };
  if (!acceptable.length) return { refusal: `nothing here can be accepted: every problem about ${key} needs its record restored (${restore.map(p => p.code).join(', ')}); acceptance covers charges the gate cannot prove, not missing records${restore.some(p => p.code === 'report_unreadable') ? '. For the unreadable report.json: no usage file beside it reads either, so there is no evidence to accept; restore the file' : ''}` };
  const rowOf = k => gate.reservations.find(r => r.key === k);
  const lines = [];
  acceptable.forEach((p, i) => {
    lines.push(`  ${i + 1}. ${p.code}: ${p.detail}`);
    if (p.figure) {
      lines.push(`     the tree counts at least ${money(p.figure.figureUsd)} for it, built from ${p.figure.files.length} file${p.figure.files.length === 1 ? '' : 's'} beside the report: ${p.figure.files.map(f => `${f.name} (sha256 ${f.sha256.slice(0, 12)})`).join(', ')}`);
      return;
    }
    for (const k of p.keys) { const r = rowOf(k); if (r) lines.push(`     reservation ${k}: PLAN 7.1 row ${r.row} (${ROW_WORDS[r.row] ?? 'see PLAN 7.1'}); worst case ${money(r.worstCaseUsd)}, evidence ${money(r.evidenceUsd)} (${r.evidenceCount} record${r.evidenceCount === 1 ? '' : 's'}), the tree adds ${money(r.addedUsd)} to its spend.`); }
  });
  const text = `Accept the charges the accounting gate cannot prove for ${n.node}?   (generation ${n.generation}, run ${n.runId})
The accounting gate stops every paid start and resume in this tree while it finds a problem. These are the problems it finds about ${key}, word for word:

${lines.join('\n')}${restore.length ? `\n\nThese need their record restored and are NOT covered by this decision:\n${restore.map((p, i) => `  ${i + 1}. ${p.code}: ${p.detail}`).join('\n')}` : ''}

${acceptable.some(p => p.figure) ? `Restoring the report.json is the better fix. Accepting instead records that YOU accept the figure above for the report that cannot be read: the tree counts at least that for the node from now on, and more if its report.json later reads higher. The cross-tree spend line (\`council --spend\`) reads the run folders alone and can show less for this one run.\n\n` : ''}Accepting changes no number: no cap, grant or reservation line is touched, and each charge above stays counted in the tree's spend at the figure shown (the tree's spend now: ${money(gate.treeSpentUsd)}). It covers exactly these problems as they read now. A different problem later, or the same one with other figures, is a new stop and needs its own decision.

To approve, type the node path: ${n.node}
`;
  const keys = [...new Set(acceptable.flatMap(p => p.keys))];
  return {
    text: terminalSafeMarked(text), expect: n.node, formName: `accept ${acceptable.length} accounting problem${acceptable.length === 1 ? '' : 's'} of ${key}`,
    after: `No number changed. The gate now passes for the problems you accepted; \`council tree resume ${rootId}\` goes on.`,
    apply: ({ gateId, shownSha256, actor, via }) => acceptAccounting(rootDir, { keys, gateId, shownSha256, actor, via, expectCovers: acceptable.map(problemCover), expectFigures: acceptable.filter(p => p.figure).map(p => p.figure) }),
  };
}

/** The close form for a child that was NEVER REGISTERED (c3b): no run, no grant, nothing spent, nothing returned. It answers the `bundle_input` stop `stop`. -> { text, expect, formName, after, apply }. */
function buildCloseUnstarted({ rootDir, rootId, record, state, runsDir, stop, child }) {
  const key = `${child.node}@g${child.generation}`;
  const { waiting, graphReadable } = waitingFor({ record, state, runsDir, node: child.node, generation: child.generation });
  const found = (stop.findings ?? []).map(f => `  - ${f.file}${f.line === null ? '' : ` line ${f.line}`}: ${String(f.name).startsWith('pii:') ? `personal data (${String(f.name).slice(4).replace(':', ', ')})` : f.name}`).join('\n');
  const text = `Close ${key} as incomplete, before it ever started?   (no run was made)
Stop ${stop.id} refused it: its input would be refused when it started, so it was never registered:
${found}
Nothing was registered, started or spent; no money was held for it, so none is returned.
Closing ends this generation of ${child.node} for good: it is never started, and this stop is answered by the close. The tree is incomplete without it; one more stop then asks how to replace it (a new generation of ${child.node}). Nothing else is changed or closed.
${graphReadable ? '' : 'A plan in this tree could not be read, so every sibling is treated as waiting (the list below may be longer than the real dependencies).\n'}${waiting.length ? `These wait for it and will not start (they are not closed or changed; the tree status names them):\n${waiting.map(w => `  - ${w.node}${w.phase ? ` (${w.phase})` : w.replaced ? ` (${REPLACED_LABEL})` : ' (not registered yet)'}`).join('\n')}\n` : ''}
To approve, type the node path: ${child.node}
`;
  return {
    text: terminalSafeMarked(text), expect: child.node, formName: `close ${key} before it started (answers stop ${stop.id})`,
    after: `${key} is closed incomplete before it started; stop ${stop.id} is answered. \`council tree status ${rootId}\` shows who waits. Next: run \`council tree resume ${rootId}\`; the sitting then opens the stop that asks how to replace it.`,
    apply: ({ gateId, shownSha256, actor, via }) => closeUnstarted(rootDir, { node: child.node, generation: child.generation, stopId: stop.id, gateId, shownSha256, actor, via }),
  };
}

/**
 * The allowance form (T-b, 19 Okt 2026; the owner's rule: the person chooses to continue AFTER SEEING): `--allow-pii-node <node>@gN` answers the open `bundle_input` stop of a child that was NEVER REGISTERED because its derived input holds personal data.
 * It shows where each finding sits (the stop's own findings: kind and place, never the value), asks for the typed node path like `--close`, and records ONE `bundle_input_allowed` for exactly the TYPES the stop found. -> { refusal } | { text, expect, formName, after, apply }.
 * Refused with a sentence: no such stop; a stop that also holds key-shaped text (a tree takes no override of the key scan). A stop recorded on the ROOT because a model-written root plan carries the finding is answered through the CHILD's key here too (C&C ruling (c)).
 */
function buildAllowPii({ rootDir, rootId, nodeArg }) {
  const record = readTreeRecord(rootDir);
  { const unreadable = unreadableRecordRefusal(record); if (unreadable) return { refusal: unreadable }; }
  const state = stateOf(record);
  const path = String(nodeArg).replace(/@g[1-9][0-9]*$/, '');
  if (state.nodes.has(String(nodeArg).includes('@g') ? String(nodeArg) : `${path}@g1`)) return { refusal: `--allow-pii-node ${nodeArg}: that node is already registered (its input was accepted); this answers a stop before registration` };
  const u = unstartedStopOf(record, state, path);
  if (!u) return { refusal: `--allow-pii-node ${nodeArg}: no open stop about a child of that name that was refused before it started` };
  const { stop, child } = u;
  const key = `${child.node}@g${child.generation}`;
  if (/@g[1-9][0-9]*$/.test(String(nodeArg)) && String(nodeArg) !== key) return { refusal: `--allow-pii-node ${nodeArg}: the open stop is about ${key}` };
  const meta = state.stopMeta.get(stop.id);
  if (meta?.oversize) return { refusal: `--allow-pii-node ${nodeArg}: stop ${stop.id} is about an input over the size its approval was priced for: an allowance cannot answer it. Close ${key} (\`--close ${key}\`) or re-plan its parent smaller (\`council tree decide ${rootId}\`)` };
  if (meta?.otherFindings) return { refusal: `--allow-pii-node ${nodeArg}: stop ${stop.id} also holds key-shaped text, and a tree takes no override of the key scan: change the plan (\`council tree decide ${rootId}\`) or close ${key} (\`--close ${key}\`)` };
  const types = (meta?.piiTypes ?? []).filter(t => ['email', 'iban', 'card'].includes(t));
  if (!types.length) return { refusal: `--allow-pii-node ${nodeArg}: stop ${stop.id} holds no personal-data finding` };
  const found = (stop.findings ?? []).map(f => `  - ${f.file} line ${f.line}: personal data (${String(f.name).slice(4).replace(':', ', ')})`).join('\n');
  const text = `Send ${key} anyway?   (it was never started: no run, no money yet)
Stop ${stop.id} refused it before it started: the input the models wrote for it holds personal data:
${found}
Allowing means this sub-plan's seats receive that text as it stands (nothing is masked or removed), for the types ${types.join(', ')} only. Another type, or a new generation of ${child.node}, stops again.
The key scan is not affected (a tree takes no override of it). Nothing is started or spent by this answer: the next sitting registers ${key} under its grant and starts it.
To approve, type the node path: ${child.node}
`;
  return {
    text: terminalSafeMarked(text), expect: child.node, formName: `allow ${types.join(', ')} for ${key} before it started (answers stop ${stop.id})`,
    after: `${key} may now be registered with that text (types: ${types.join(', ')}); stop ${stop.id} is answered. Next: run \`council tree resume ${rootId}\`.`,
    apply: ({ gateId, shownSha256, actor, via }) => allowBundleInput(rootDir, { node: child.node, generation: child.generation, stopId: stop.id, types, gateId, shownSha256, actor, via }),
  };
}

/** The close form (PLAN 7.5, 8.5, 10.1): the person ends a node that will not finish. -> { refusal } | { text, expect, formName, after, apply }. Nothing is written here; closeIncomplete re-checks under the lock. */
function buildClose({ rootDir, rootId, nodeArg, facts = {} }) {
  const record = readTreeRecord(rootDir);
  { const unreadable = unreadableRecordRefusal(record); if (unreadable) return { refusal: unreadable }; }
  const state = stateOf(record);
  const runsDir = dirname(rootDir);
  const n = nodeOf(state, nodeArg);
  if (!n) {
    // c3b: a child that was never registered, whose input a stop refused, can be closed without ever starting it
    const u = unstartedStopOf(record, state, String(nodeArg).replace(/@g[1-9][0-9]*$/, ''));
    if (u) return buildCloseUnstarted({ rootDir, rootId, record, state, runsDir, ...u });
    return { refusal: `--close ${nodeArg}: no such node in this tree` };
  }
  const refusal = closeRefusal({ state, runsDir, node: n.node, generation: n.generation, facts, rootId });
  if (refusal) return { refusal: `--close ${nodeArg}: ${refusal.reason}` };
  const key = `${n.node}@g${n.generation}`;
  const gate = gateTree(rootDir, { record });
  const budget = budgetOf(rootDir, { record, gate });
  const entry = budget.nodes.find(x => x.key === key);
  const runDir = join(runsDir, n.runId);
  const { returnedUsd: returned, spendUnknown } = closeReturnOf(n, runDir, unreadableFloorOf(record, n.runId));
  const topUps = n.topUps.reduce((a, t) => a + t.amount, 0);
  const { waiting, graphReadable } = waitingFor({ record, state, runsDir, node: n.node, generation: n.generation });
  const text = `Close ${key} as incomplete?   (run ${n.runId})
It is: ${describePhase(n, runsDir, { rootId, chain: registeredChainOf(record, n) })}.
It holds: a grant of ${money(entry.grantUsd)} (first grant ${money(n.grant.amount)}${topUps ? ` plus top-ups ${money(topUps)}` : ''}); it has spent ${spendUnknown ? 'unknown (its run folder is gone, so what it spent cannot be read: its whole grant stays charged and nothing is given back)' : `${money(entry.spentUsd)} (an unsettled reservation counts at its worst case, so this figure errs high)`}.
Closing gives ${money(returned)} back to the root's pool: available ${money(budget.availableUsd)} -> ${money(budget.availableUsd + returned)}. Everything it spent stays counted.${unknownSpendLine(budget) ? `\nThe pool also has ${unknownSpendLine(budget)}.` : ''}${gate.ok ? '' : `\nThe accounting gate currently reports problems (${gate.problems.map(p => p.code).join(', ')}); closing moves no paid money, it releases a hold, so the figures above come from the run's own spend records.`}
Closing ends this node for good: it is never resumed and can never be a provider another node waits for. Nothing else is changed or closed for it.
${graphReadable ? '' : 'A plan in this tree could not be read, so every sibling is treated as waiting (the list below may be longer than the real dependencies).\n'}${waiting.length ? `These wait for it and will not start (they are not closed or changed; the tree status names them):\n${waiting.map(w => `  - ${w.node} (${w.phase ?? (w.replaced ? REPLACED_LABEL : 'not registered yet')}): ${w.why}`).join('\n')}` : 'No other node waits for it.'}

To approve, type the node path: ${n.node}
`;
  return {
    text: terminalSafeMarked(text), expect: n.node, formName: `close ${key} as incomplete (returns ${money(returned)})`,
    after: `${key} is closed incomplete; ${money(returned)} went back to the pool. \`council tree status ${rootId}\` shows who waits.`,
    apply: ({ gateId, shownSha256, actor, via }) => closeIncomplete(rootDir, { node: n.node, generation: n.generation, gateId, shownSha256, actor, via }, { facts }),
  };
}

/** The words of the reason a person types when they open a stop on the root plan (S8-8; E list item 49). The defaults of `readDecisionText` are the decision's. */
const REASON_WORDS = Object.freeze({
  intro: maxBytes => `Type what you saw in the root plan that is wrong. It is recorded word for word (at most ${maxBytes} bytes). End it with a line holding only a dot (.).`,
  prompt: 'reason: ',
  empty: 'the reason is empty',
  tooLong: maxBytes => `the reason is longer than ${maxBytes} bytes`,
  hidden: code => `the reason holds an invisible character (${code}) that you cannot see on the screen; type it again without it`,   // audit item 7, commit 2b (E 180, held)
});

/**
 * The typing-time checks of the reason (S8-8, Muad 12 Oct: "the check should go everywhere"; the same scanner and reserved-host exemption as the decision text above, tree-decide.js:~306): the key scan, and the tree's personal-data mode when it has one.
 * The reason is written into events.jsonl and shown in TREE_HANDOFF.md, a file people share. Every line is built from the finding's fields (place, kind), never from the matched text or its masked prefix. -> { refusal } | { notes: [lines] } (a `warn` mode prints what it found and goes on).
 */
function scanReason(rootDir, text) {
  const keyed = textSecretFindings(text, 'the reason');
  if (keyed.length) return { refusal: `the reason holds ${keyed.length} credential-shaped string(s), which would be written into the tree's record and its shared files:\n${secretRefusalLines(keyed).join('\n')}\nA tree takes no override: change the words and run the command again. No gate was requested and nothing was written` };
  const mode = treeInputScanModeFrom(readTreeRecord(rootDir).tree);
  if (mode.status === 'unusable') return { refusal: `the tree's personal-data mode in tree.json is unusable (${mode.reason}): no text is accepted. No gate was requested and nothing was written` };
  if (mode.status !== 'on') return { notes: [] };
  const pii = piiGateReport({ mode: mode.mode, sources: [['the reason', text]], forTree: true });
  const lines = pii.findings.map(f => `  ${f.where}, line ${f.line}, col ${f.column}: ${f.type}${f.type === 'secret' && f.pattern ? ` (${f.pattern})` : ''}`);
  if (pii.blocked) return { refusal: `the reason holds personal data under --pii-gate ${mode.mode}, which would be written into the tree's record and its shared files:\n${lines.join('\n')}\nChange the words and run the command again. No gate was requested and nothing was written` };
  return { notes: lines.length ? [`tree decide: the reason holds personal data (the tree's mode is ${mode.mode}, so it goes on):`, ...lines] : [] };
}

/**
 * The open-a-stop form (S8-8): a person says the root plan is wrong although the tree reads ready. -> { refusal } | { text, expect, typedLabel, formName, after, apply }. Nothing is written here. The stop id the text NAMES is the id the writer
 * records (openPersonStop refuses if the record moved); the person's words are indented two spaces in the text so that no line of them can stand at the start of a line and look like the frame around them.
 */
function buildOpenRootStop({ rootDir, rootId, reason, facts = {} }) {
  const pre = personStopPreflight({ rootDir });
  if (pre.refusal) return { refusal: pre.refusal };
  const { record, state, root } = pre;
  const g = root.generation; const key = `R@g${g}`; const stopId = `e${state.lastId + 1}`;
  const remedies = rootRemedies(record, state, dirname(rootDir));
  const answer = remedies.length
    ? `The ways to answer it: a new root plan, \`council tree decide ${rootId} --stop ${stopId}\`, or, in place, a needs-decision milestone of the plan (${remedies.join(', ')}): \`council tree decide ${rootId} --milestone <id>\`.`
    : `The only typed answer to this stop is a new root plan: \`council tree decide ${rootId} --stop ${stopId}\`.`;
  const text = `Open a stop on the root plan ${key} (run ${root.runId})?
Your reason, word for word (${Buffer.byteLength(reason, 'utf8')} bytes):
----- reason -----
${reason.split('\n').map(l => `  ${l}`).join('\n')}
----- end -----
Recording it: the tree stops being ready (the readiness verdict becomes incomplete) until you answer the stop. Nothing is started, nothing is spent, and the plan is not changed. ${answer} Whether or not you give one, the plan's files stay as they are and stay usable.
To approve, type the generation of the root plan you are opening a stop on: ${key}
`;
  return {
    text: terminalSafeMarked(text), expect: key, typedLabel: 'the generation of the root plan', formName: `open a stop on the root plan ${key}`,
    after: `Stop ${stopId} is open on ${key}; the tree is not ready until you answer it: \`council tree decide ${rootId} --stop ${stopId}\`.`,
    apply: ({ gateId, shownSha256, actor, via }) => openPersonStop(rootDir, { reason, gateId, shownSha256, actor, via, expectedStopId: stopId }, { facts }),
  };
}

/**
 * The abandon form (ROADMAP 57; contract section 1 and 7): the person ends the WHOLE tree for good. -> { refusal } | { text, expect, formName, after, apply }. Nothing is written here; abandonTree re-checks under the lock.
 * The person types the tree id (the whole id; copy and paste work), never a bare "y".
 */
function buildAbandon({ rootDir, rootId, facts = {} }) {
  const record = readTreeRecord(rootDir);
  if (!record.tree || record.corrupt.length) return { refusal: `the record of this tree does not read (${record.corrupt.length} problem${record.corrupt.length === 1 ? '' : 's'}); nothing can be decided on it. Restore the damaged line from a backup, or start a new tree` };
  const state = stateOf(record);
  const refusal = abandonRefusal({ rootDir, record, state, facts });
  if (refusal) return { refusal: `--abandon: ${refusal.reason}` };
  const runsDir = dirname(rootDir);
  const budget = budgetOf(rootDir, { record, gate: gateTree(rootDir, { record }) });
  const pin = rootTaskPinFrom(record.tree);
  const taskLine = pin.status === 'ok' ? pin.pin.task : pin.status === 'unusable' ? '(damaged)' : '(the root task is not recorded in tree.json)';
  const phaseOf = n => (n.phase === 'closed' ? `closed ${n.outcome ?? 'without an outcome'}` : describePhase(n, runsDir, { rootId, chain: registeredChainOf(record, n) }));
  const nodes = [...state.nodes.values()].sort((a, b) => (a.node < b.node ? -1 : a.node > b.node ? 1 : a.generation - b.generation)).map(n => `${n.node}@g${n.generation} ${phaseOf(n)}`);
  const exists = nodes.length > 12 ? `${nodes.slice(0, 12).join('; ')}; and ${nodes.length - 12} more` : nodes.join('; ');
  const stops = state.openStops.map(id => ({ id, meta: state.stopMeta.get(id) }));
  const waitingFrontiers = [...state.frontiers].filter(([, f]) => f.previewed && !f.revisions.length).map(([k]) => k);
  const left = [
    ...(stops.length ? [`stop ${stops[0].id}${state.deferred?.has(stops[0].id) ? ' (handed to you by the session)' : ''}${stops[0].meta?.node ? ` on ${stops[0].meta.node}@g${stops[0].meta.generation}` : ''}${stops.length > 1 ? ` (and ${stops.length - 1} more)` : ''}`] : []),
    ...(waitingFrontiers.length ? [`${waitingFrontiers.length === 1 ? 'a frontier waits' : `${waitingFrontiers.length} frontiers wait`} for approval (${waitingFrontiers.map(k => k.slice(0, 12)).join(', ')})`] : []),
  ];
  const keptWork = candidatesOf(state).filter(c => c.state === 'held' || c.state === 'kept').map(c => c.key);       // C4a: the finished earlier work this abandon retires
  const text = `Abandon tree ${rootId}?   (this cannot be undone)
Root task: ${taskLine}   Root cap ${money(effectiveCapUsd(record))}
What exists: ${exists || '(no node is registered)'}.
${keptWork.length ? `Finished runs of an earlier plan that are held or kept as candidates; abandoning retires them: ${keptWork.join(', ')}.\n` : ''}Nothing is running: no member holds a claim and no sitting of this tree is running.
Money: spent ${money(budget.treeSpentUsd)} (it stays counted). Held for nodes that will never spend it: ${money(budget.heldUsd)}, released (it is not spent and not given to anything else: the tree is over).${unknownSpendLine(budget) ? `\nThe pool also has ${unknownSpendLine(budget)}.` : ''}${left.length ? `\nLeft unanswered: ${left.join('; ')}.` : ''}
Abandoning ends this tree for good. Nothing more is registered, started, resumed, approved, decided, checked or topped up in it, and it cannot be reopened. Its run folders stay as they are; the record gains this event, and TREE_HANDOFF.md and tree/report.json are rewritten to say so.
To try again, start a new tree: \`council tree start --task <task> --chain <root chain> --child-chain <name> --max-usd <usd>\`

To approve, type the tree id: ${rootId}
`;
  return {
    text: terminalSafeMarked(text), expect: rootId, typedLabel: 'the tree id', formName: `abandon tree ${rootId}`,
    after: `The tree is final; \`council tree status ${rootId}\` shows its history.`,
    apply: ({ gateId, shownSha256, actor, via }) => abandonTree(rootDir, { gateId, shownSha256, actor, via }, { facts }),
  };
}

/**
 * The member verb (`--continue-node <node>` / `--finish-node <node>`; C&C 15/16 Okt 2026): the person's choice for a member stopped at its overseer limit. `--prevail-node <node> --prevail <n>=<objection id>|neither[,...]` is the same verb for a member stopped at a conflict the decider asked about (exit 25). No gate and no typed text: it is not an approval and moves no money by itself (the member
 * spends under its own grant when the sitting resumes it); the MCP guard keeps agents out. It writes ONE event and starts nothing. Exit codes as the other forms: 0 recorded (or already recorded), 1 refused, 19 the tree refuses to record it.
 */
function choiceVerb({ rootDir, rootId, choice, nodeArg, prevailText = null, facts, now, out, err }) {
  const record = readTreeRecord(rootDir);
  if (!record.tree || record.corrupt.length) { err(`tree decide: the record of this tree does not read (${record.corrupt.length} problem${record.corrupt.length === 1 ? '' : 's'}); nothing can be decided until it does. Nothing was written.`); return 1; }
  const state = stateOf(record); const runsDir = dirname(rootDir);
  const flag = choice === 'continue' ? '--continue-node' : choice === 'finish' ? '--finish-node' : '--prevail-node';
  const want = choice === 'prevail' ? 'conflict' : 'round';
  const n = nodeOf(state, nodeArg);
  const waiting = waitingForChoice(state, runsDir, facts ?? {});
  if (!n) { err(`tree decide: ${flag} ${nodeArg}: no such node in this tree. ${waiting.length ? `Waiting for a choice: ${[...new Set(waiting)].join(', ')}.` : 'No node is waiting for a choice.'} Nothing was written.`); return 1; }
  const refusal = choiceRefusal({ state, runsDir, node: n.node, generation: n.generation, facts, rootId, want });
  if (refusal) { err(`tree decide: ${flag} ${nodeArg}: ${refusal.reason}. ${waiting.length ? `Waiting for a choice: ${[...new Set(waiting)].join(', ')}. ` : ''}Nothing was written.`); return 1; }
  let picks = null;
  if (choice === 'prevail') {
    // the picks are read against the member's OWN stop (report-partial.json), never guessed; a pick that is not an objection of its conflict, or a conflict left unanswered, writes nothing
    const at = readConflictStopOfRun(join(runsDir, n.runId));
    const parsed = parsePrevail(prevailText === true ? '' : prevailText, at.stop);
    if (!parsed.ok) { err(`tree decide: --prevail: ${parsed.why}. Nothing was written.`); return 1; }
    picks = parsed.picks;
  }
  let res;
  try { res = chooseNode(rootDir, { node: n.node, generation: n.generation, choice, rootId, picks }, { facts, now }); }
  catch (e) { if (e instanceof TreeRefusal) { err(`tree decide: ${e.message}. Nothing was written but the refusal.`); return 19; } throw e; }
  const key = `${n.node}@g${n.generation}`;
  const grant = remainingGrantOf(rootDir, { node: n.node, generation: n.generation });
  const word = choice === 'prevail' ? `go on with your pick (${picks.map(p => `${p.n}=${p.prevail}`).join(', ')})` : choice === 'continue' ? 'continue (it extends the limit that was reached)' : 'finish: the dispute stage and the handoff run, and the result stays "not agreed"';
  out(res.already ? `${key} already has your choice for stop ${res.stop}: ${word}. Nothing was written.` : `Recorded: ${key} will ${word} when it is resumed (stop ${res.stop}${res.replaced ? `; this replaces your earlier choice, ${res.replaced}` : ''}). Nothing was started and nothing was spent.`);
  out(`Money: it continues under its own grant, ${money(grant.remainingUsd)} left${grant.spendUnknown ? ' (what it spent could not be read in full, so this figure may be high)' : ''}. It may stop at its budget cap; \`council tree decide ${rootId} --top-up ${n.node} --amount <usd>\` is the way on. No new typed limit.`);
  out(`Next: \`${memberResumeCommand({ treeId: rootId })}\` applies it.`);
  return 0;
}

/** The handler src/tree-cli.js calls for `decide`. Exit codes as `approve`: 0 recorded, 1 not confirmed or refused, 2 usage / not built / no terminal, 19 the tree refuses to record it. */
export async function decideHandler({ rootDir, rootId, flags, work, stdin, stdout, stderr, now, facts, ceiling, env, adviceDeps = {}, recommend = askForRecommendation, skipDraft = false }) {
  const out = s => stdout.write(`${s}\n`); const err = s => stderr.write(`${s}\n`);
  const clock = now ? { now } : {};
  const chosen = chooseForm(flags);
  if (chosen.error) { err(`tree decide: ${chosen.error}`); return 2; }
  // ROADMAP 57: a final tree answers every form with its one sentence BEFORE anything is typed or asked (the stop forms would otherwise ask for a long decision text first)
  const finalFirst = finalSentenceOf(rootDir);
  if (finalFirst) { err(`tree decide: ${finalFirst} Nothing was asked and nothing was written.`); return 1; }
  // BUG-C-059 (bug audit 24 Okt 2026): a recommendation request whose process is gone (a closed terminal, SIGHUP, a throw out of the send) stays registered with its call and keeps its grant held, and only a new request's admission released stale ones. A person who then typed their own decision had the gate approval SPENT and `apply` refused ("a recommendation request is still open"), on every rerun. It is released here, first, by the SAME reconcile admission uses: a request ends only when its wait ran out or its claim is dead AND every call's folder shows an end, so a paid call that is still running keeps its hold.
  reconcileAdvice(rootDir, { facts });       // the real clock, not the injected one: the handler's clock reads are counted by tests (the apply's use is the 6th read), and in production they are the same clock
  if (chosen.form === 'continue-node' || chosen.form === 'finish-node' || chosen.form === 'prevail-node') return choiceVerb({ rootDir, rootId, choice: chosen.form === 'continue-node' ? 'continue' : chosen.form === 'finish-node' ? 'finish' : 'prevail', nodeArg: chosen.value, prevailText: flags.prevail, facts, now, out, err });
  let build; let draftUse = null;       // GAP A: the session's draft this run offers (set in the stop forms below)
  if (chosen.form === 'abandon') build = () => buildAbandon({ rootDir, rootId, facts });
  else if (LIMIT_OF[chosen.form] !== undefined) build = () => buildLimitRaise({ rootDir, work, flag: chosen.form, raw: chosen.value });
  else if (chosen.form === 'accounting') build = () => buildAccounting({ rootDir, rootId, nodeArg: chosen.value });
  else if (chosen.form === 'close') build = () => buildClose({ rootDir, rootId, nodeArg: chosen.value, facts });
  else if (chosen.form === 'allow-pii-node') build = () => buildAllowPii({ rootDir, rootId, nodeArg: chosen.value });
  else if (chosen.form === 'top-up') build = () => buildTopUp({ rootDir, rootId, nodeArg: chosen.value, amountRaw: flags.amount, work, ceiling });
  else if (chosen.form === 'accept-plan') build = () => buildAcceptPlan({ rootDir, rootId, stopArg: flags.stop, facts });
  else if (chosen.form === 'amend-cap') build = () => buildAmendCap({ rootDir, rootId, raw: chosen.value, facts, work, ceiling });
  else if (chosen.form === 'accept-chain-limits') build = () => buildAcceptChainLimits({ rootDir, rootId, nameArg: chosen.value, work, facts });
  else if (chosen.form === 'open-root-stop') {
    // S8-8: everything that needs no words is checked FIRST (a preflight sentence, nothing typed); the reason is typed at a terminal, never a flag; the key scan and the PII mode run on it BEFORE any gate text exists
    const pre = personStopPreflight({ rootDir });
    if (pre.refusal) { err(`tree decide: ${pre.refusal}. Nothing was asked and nothing was written.`); return 1; }
    if (!stdin.isTTY || !stdout.isTTY) { err('tree decide: a reason is typed at a terminal (stdin and stdout must both be a terminal); there is no flag or file for it. Nothing was written.'); return 2; }
    const typed = await readDecisionText({ stdin, stdout, words: REASON_WORDS });
    if (typed.error) { err(`tree decide: ${typed.error}. No gate was requested and nothing was written.`); return 1; }
    const scan = scanReason(rootDir, typed.text);
    if (scan.refusal) { err(`tree decide: ${scan.refusal}.`); return 1; }
    for (const l of scan.notes) err(l);
    build = () => buildOpenRootStop({ rootDir, rootId, reason: typed.text, facts });
  }
  else if (chosen.form === 'milestone' || chosen.form === 'regenerate' || chosen.form === 'keep') {
    // the stop forms (src/tree-decide-stop.js): everything that needs no text is checked FIRST; the text is typed at the terminal BEFORE the gate text is built; never a flag
    // the root re-plan form (S8-4) needs to know whether a sitting runs and where the working folder is: built HERE (tree-decide-stop must not import the sitting)
    const args = { rootDir, form: chosen.form, milestoneArg: chosen.value, stopArg: flags.stop, obligationArg: flags.obligation, fresh: flags.fresh === true, allowBytes: allowSizeOf(flags['allow-size']), offerRaise: true, work, sittingHeld: () => lockHolder(treeDirOf(rootDir), { file: SITTING_LOCK_FILE }) !== null };
    const pre = stopPreflight({ ...args, rootId });                  // the refusal's commands name the real root run, not a placeholder
    if (pre.refusal) { err(`tree decide: ${pre.refusal}. Nothing was asked and nothing was written.`); return 1; }
    if (!stdin.isTTY || !stdout.isTTY) { err('tree decide: a decision is typed at a terminal (stdin and stdout must both be one); there is no flag or file for it. Nothing was written.'); return 2; }
    // PLAN 8.4: a stopped CHILD's answer must say whether it changes anything the node provides to a sibling. Asked BEFORE the text is typed: a "yes" is the regenerate form and nobody types a long decision to be refused
    let changesProvides = null;
    if (pre.asksProvides) {
      const q = await askChangesProvides({ stdin, stdout, node: pre.node });
      if (q.error) { err(`tree decide: ${q.error}. No gate was requested and nothing was written.`); return 1; }
      if (q.answer) { err(`tree decide: this changes what ${pre.node} provides: use the regenerate form (council tree decide ${rootId}). No gate was requested and nothing was written.`); return 1; }
      changesProvides = false;
    }
    // ROADMAP 77: on a ROOT re-plan the person may first ask for a paid recommendation (src/tree-advice-route.js). The route has ended its request before it returns, so everything below is built on figures with no hold. It is dormant until the
    // brief wording has the owner's yes (the production brief builder is held). The chosen recommendation is the decision text VERBATIM and goes through the scans below like any typed text.
    let recommended = null;
    if (chosen.form === 'regenerate' && flags.obligation === undefined) {
      // GAP A (Muad 23 Okt 2026, option B): a draft the SESSION wrote for this root stop is shown in FULL in the gate below and approved by typing the stop id; a person who does not want it says no there and types their own (the same run). The same scans a typed text gets run first (the record is not trusted: a draft that fails them is not offered). With a draft waiting, the paid recommendation is not offered.
      const waiting = skipDraft ? null : waitingDraft({ rootDir, stopArg: flags.stop });
      if (waiting) {
        const refused = draftTextRefusal({ rootDir, text: waiting.text, reason: waiting.reason });
        if (refused) err(`tree decide: the session's draft ${waiting.draftId} was not used: ${refused}. You can type your own decision.`);
        else draftUse = waiting;
      } else if (!skipDraft) {       // a person who said no to the session's draft is not offered paid advice instead
        const rec = await recommend({ rootDir, rootId, stopId: flags.stop, work, stdin, stdout, stderr, env, ...clock, sittingHeld: args.sittingHeld, deps: adviceDeps });
        if (rec.interrupted) { err('tree decide: stopped; nothing was decided.'); return 130; }
        if (rec.kind === 'recommended') recommended = rec;
      }
    }
    const typedText = draftUse ? { text: draftUse.text } : recommended ? { text: recommended.text } : await readDecisionText({ stdin, stdout });
    if (typedText.error) { err(`tree decide: ${typedText.error}. No gate was requested and nothing was written.`); return 1; }
    // A chosen RECOMMENDATION is not scanned (C&C ruling B of 20 Okt, from Muad's 19 Okt: no screening of shown text; the return path marks it untrusted). Typed text is scanned exactly as before.
    if (!recommended && !draftUse) {
      // the typed text reaches every regenerated child's context.md (part 7) and nothing scanned it: the SAME all-shapes scan a run applies to its inputs, BEFORE the gate text is built or any event is appended; the pattern name and the line, never the value, and the text is not echoed
      const keyed = textSecretFindings(typedText.text, 'the decision text');
      if (keyed.length) { err(`tree decide: the decision text holds ${keyed.length} credential-shaped string(s), which a regenerated sub-plan would carry to every seat:\n${secretRefusalLines(keyed).join('\n')}\nA tree takes no override: change the text and run the command again. No gate was requested and nothing was written.`); return 1; }
      // the personal-data check too, when the tree carries a mode (Muad: "the check should go everywhere"; the typed text becomes member input, so a hard-stop tree would refuse it at the member's start): `unusable` fails CLOSED, `warn` never refuses
      // (each member writes its own WARNINGS.md); a refusal names the type and the position, never the value or its masked prefix
      const mode = treeInputScanModeFrom(readTreeRecord(rootDir).tree);
      if (mode.status === 'unusable') { err(`tree decide: the tree's personal-data mode in tree.json is unusable (${mode.reason}): no text is accepted for its members. No gate was requested and nothing was written.`); return 1; }
      if (mode.status === 'on') {
        const pii = piiGateReport({ mode: mode.mode, sources: [['the decision text', typedText.text]], forTree: true });
        if (pii.blocked) { err(`tree decide: the decision text holds personal data under --pii-gate ${mode.mode}, which a regenerated sub-plan would carry:\n${pii.findings.map(f => `  ${f.where}, line ${f.line}, col ${f.column}: ${f.type}${f.type === 'secret' && f.pattern ? ` (${f.pattern})` : ''}`).join('\n')}\nA tree takes no allow-list: change the text and run the command again. No gate was requested and nothing was written.`); return 1; }
      }
    }
    build = () => buildStopDecision({ ...args, rootId, decisionText: typedText.text, changesProvides, fromRecommendation: recommended?.fromRecommendation ?? null, fromSessionDraft: draftUse ? { draftId: draftUse.draftId } : null });
  }
  else { err(`council tree decide ${chosen.form}: not built`); return 2; }

  const first = build();
  if (first.refusal) { err(`tree decide: ${first.refusal}. Nothing was asked and nothing was written.`); return 1; }
  // the terminal is checked BEFORE the gate is requested, for every form in this one place: a gate request writes a text file and a pending ledger line, and a refused attempt used to leave both behind (S8-8; the words are the gate's own)
  if (!stdin.isTTY || !stdout.isTTY) { err('gate answer needs a person at a terminal: stdin and stdout must both be a terminal. Nothing was written.'); return 2; }
  const gate = requestTreeGate(rootDir, { kind: TREE_GATE_KINDS.decide, text: first.text }, clock);
  if (!gate.ok) { err(`tree decide: cannot ask for the decision (${gate.code}): ${gate.message}`); return 1; }
  const typedLabel = first.typedLabel ?? (chosen.form.startsWith('max-') ? 'the new value' : chosen.form === 'top-up' ? 'the amount' : chosen.form === 'accounting' || chosen.form === 'close' || chosen.form === 'allow-pii-node' ? 'the node path' : chosen.form === 'accept-plan' ? 'the stop id' : 'what the last line asks for');
  let notApproved = false;       // GAP A: set only when the PERSON answered and did not approve; an expired, unreadable or refused gate ends the command with its own sentence
  const code = await askTreeGate(rootDir, gate.gate.id, { expectPrefix: first.expect, typedLabel, stdin, stdout, stderr, onNotApproved: () => { notApproved = true; }, ...clock });
  if (code !== 0 && draftUse && notApproved) {
    // GAP A: not approving the session's draft is not the end of the command. The person says what the session should change (the request is recorded for the session; the draft stays approvable), or types only a dot and writes their own decision in this same run (the draft stays waiting; the declined gate is the only thing left behind)
    out('No draft was approved.');
    const ask = await readDecisionText({ stdin, stdout, words: CHANGE_WORDS });
    if (ask.error && ask.error !== CHANGE_EMPTY) { err(`tree decide: ${ask.error}. Nothing was recorded.`); return 1; }
    if (!ask.error) {
      const refused = changeRequestRefusal({ rootDir, text: ask.text });
      if (refused) { err(`tree decide: ${refused}. Nothing was recorded.`); return 1; }
      try { appendTreeEvent(rootDir, { event: 'stop_draft_change_asked', stopId: draftUse.stopId, draftId: draftUse.draftId, text: ask.text, actor: 'person', via: 'terminal' }, clock); }
      catch (e) { if (!(e instanceof TreeRefusal)) throw e; err(recordRefusalLine({ verb: 'tree decide', reason: e.reason, rootDir })); return 19; }
      out('Recorded your request for the session: nothing was decided. The session reads it in the tree status and writes a new draft. If no session is listening, it waits in the record: run this command again later (this draft can still be approved), or type your own decision.');
      return 0;
    }
    out('Type your own decision.');
    return decideHandler({ rootDir, rootId, flags, work, stdin, stdout, stderr, now, facts, ceiling, env, adviceDeps, recommend, skipDraft: true });
  }
  if (code !== 0) return code;

  // ROADMAP 57: a gate that was pending when the tree was abandoned (by another terminal) is NOT used: this runs before the form is rebuilt and before the approval is spent
  const finalAgain = finalSentenceOf(rootDir);
  if (finalAgain) { err(`tree decide: ${finalAgain} Your approval was NOT used and nothing was recorded.`); return 1; }
  // what the person read must still be what would be recorded: the form is built AGAIN, every precondition included, BEFORE the approval is spent
  const again = build();
  if (again.refusal || again.text !== first.text) {
    err('tree decide: what you were shown has changed while you were reading it (a figure, a limit or a precondition). Your approval was NOT used and nothing was recorded. Run the command again to see the new figures.');
    return 1;
  }
  const shownSha256 = sha256Of(first.text);
  try {
    const used = recordTreeUse(rootDir, gate.gate.id, 'tree_decide', { form: first.formName }, clock);
    if (!used.ok) { err(`tree decide: the approval could not be used (${used.code}): ${used.message}. Nothing was decided.`); return 1; }
    first.apply({ gateId: gate.gate.id, shownSha256, ...used.answeredBy });
  } catch (e) {
    if (!(e instanceof TreeRefusal)) throw e;
    err(recordRefusalLine({ verb: 'tree decide', reason: e.reason, rootDir }));
    // the record may have moved on the way (a form that writes more than one event, or another writer in the window): the two view files follow it here too, as after a recorded decision (src/tree-files.js; never fatal)
    for (const p of writeTreeFiles(rootDir, { work })) err(fileProblemLine(rootDir, p));
    return 19;
  }
  if (chosen.form === 'abandon') {
    // the abandon form writes NO readiness event (the table would refuse it and write a `blocked` line on a final tree); the two view files are still written, so they follow the record
    for (const p of writeTreeFiles(rootDir, { work })) err(fileProblemLine(rootDir, p));
  } else recordReadinessAfter(rootDir, { work, ...clock });                 // PLAN 9.2: a decision changes what the verdict rests on (stale marks, limits, a closed node): record it now, never failing the decision
  out(`Recorded: ${first.formName}. ${first.after}`);
  return 0;
}
