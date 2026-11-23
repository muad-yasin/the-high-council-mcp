// The per-provider spend caps (0.8.4 DUALCAP): the contract the later units build to. Unit 1 lands this module, src/uncovered.js, the start scope's `caps`
// part, the reservation line's `capName`, BudgetExceeded's `capName` and chain-lint's `invalid-mock-bills`; everything else below is NAMED here and built in
// the units that follow. PURE: no file, no clock, no environment (the caller passes the setting's text).
// Owner, 31 Okt 2026 (binding text: FOCUS-detail heading "B3 PREP: THE TWO-CAP SYSTEM (OPENROUTER + ANTHROPIC) ..." and its amendments): "'two-cap system'
// we NEED it for B3"; a switch that lets certain caps be enabled (for him OpenRouter and Anthropic); never turned on = today's single cap; no third total and no
// cap he did not ask for; ONE CEILING PER CAP (OpenRouter strict, Anthropic generous); a cap is asked for only if a seat bills through it; a paid seat that no
// enabled cap covers is refused before anything is sent; each cap stops and is raised on its own, and the stop names its cap; a seat's cap follows
// seat.provider (the billing path); amounts are always typed by the person; nothing is paid outside a cap.
//
// THE SWITCH. COUNCIL_SPEND_CAPS = a list of billing provider ids, never a dollar figure ("openrouter,anthropic"; any order, case and spacing). Unset or blank
//   = OFF: today's ONE typed limit per run, byte for byte; every record below is then ABSENT (never `key: undefined`, never `key: null`). parseCapsSetting
//   refuses anything else (a figure, an unknown or free provider, an empty entry, an off word, a host placeholder, a value that is not text) with one
//   sentence, and the start refuses on it: an unreadable switch is never read as OFF. A WHOLE `${user_config.*}` placeholder (a Desktop field left empty)
//   never reaches the parser in the CLI: src/mcp/server.js drops such a value as unset, the rule for every setting but COUNCIL_MAX_USD_LIMIT, so it reads as
//   OFF, today's single typed limit with its ceiling (nothing fails open); a value that only looks like one (spaces around it) is refused by the parser.
//   OPERATOR-ONLY (C&C's ruling 2, 1 Nov 2026): the switch comes only
//   from the real environment or the Desktop field, never from a project .env (env-file NEVER_FROM_ENV_FILE: the notice names it and it is ignored), as for
//   the other operator-only settings; .env.example and the AI-README list name it.
// THE SWITCH AT THE START (unit 2; C&C's ruling 4: read at the start FIRST). src/cli.js reads it once, right after a project .env is applied and before any
//   command runs; every paid path passes there (the MCP server, the JS API, tree members and the http server all spawn src/cli.js). A
//   command that may spend (commandMaySpend below; FAIL CLOSED: what is not listed as spending nothing may spend) is refused, exit 2, before anything is
//   written, while the switch cannot be read, and, UNTIL THE CAPS ARE ARMED, while it is on (capsNotArmedSentence, A-DRAFT, temporary: the arming unit
//   removes it). A command that spends nothing runs as before. Over-refusal by design: a usage error on a spending path (`--chain x` with no task,
//   `--resume x --help`, an unknown first word) gets the switch's sentence instead of its own while the switch is on or unreadable.
// A DRY RUN IS NEVER REFUSED BY THE SWITCH (C&C's fix-up of unit 2, 1 Nov 2026: B3's re-pin is a dry run with the switch set): exactly the token `--dry-run`, on
//   a command that takes it, prices and calls nothing. Until the arming unit a dry run with the switch on prints today's single-cap figures; from unit 4 the
//   typed-limit and option-B start refusals skip a dry run too, and it prints the per-cap figures (C&C). RULED (C&C's Q1b, 1 Nov 2026): a dry run with the switch
//   on, of a command or chain a real start would refuse (a refused class, an uncovered seat), REPORTS that refusal the way it reports unpriced seats today and
//   calls nothing, never exit 2 for the refusal itself: the exception is "a dry run calls nothing", never "the switch ignores dry runs".
// A SEAT'S ACCOUNT. billingAccountOf(seat): seat.provider when the seat bills (isPaidSeat: not mock, not external, not a free local provider), read on the
//   roster AFTER single-vendor rerouting (resolveChainSeats: the billing path, so a Claude model reached through OpenRouter is OpenRouter's); never labOf, the
//   model's maker or originalProvider. A mock seat: the account its `mockBills` names; every other seat: null (free, counted in no cap).
// mockBills (C&C's pin, 1 Nov 2026). Honoured ONLY on provider mock, so one offline seat can count against the OpenRouter cap and another against the
//   Anthropic cap with no key. On any other seat it is refused whatever it names (otherwise one seat key would be a way around a cap): chain-lint
//   `invalid-mock-bills`, and again at run time (seatBillingRefusal, whatever the switch says; wired at the start by the refuse-uncovered unit). A mock value
//   that is not a billing provider id is refused too. Fixtures that carry it live under test/, never in chains/ (a chain's sha is in the start scope).
// CAPS IN FORCE (src/uncovered.js capsInForce): the enabled caps that at least one seat of the resolved roster bills through (everySeatSlotsOf: preflight
//   seats and the default security reviewer included), sorted. A cap no seat bills through is never asked for. With the switch ON a start needs typed limits
//   when capsInForce is not empty (NOT chainIsPaid, which is false for every mock chain); with none in force it keeps today's path (--max-usd is the cap of
//   a free chain). UNCOVERED (uncoveredSeats): a seat whose account no enabled cap covers; the run is refused before anything is sent, exit 5
//   (EXIT_DEGRADABLE, the unpriced-seat precedent), and invoke() refuses it again if a call reaches it some other way.
// CEILINGS. OFF: COUNCIL_MAX_USD_LIMIT and the Desktop max_usd as today. ON: each cap's ceiling is its own setting, capCeilingName(id) =
//   COUNCIL_MAX_USD_LIMIT_<ID> (each joins MONEY_NAMES with the unit that first reads them: the repeated- and malformed-line refusals, and
//   COUNCIL_MAX_USD_LIMIT's host-placeholder rule);
//   a cap with no ceiling setting has none, as a run has none today without COUNCIL_MAX_USD_LIMIT; COUNCIL_MAX_USD_LIMIT never bounds a cap (never today's
//   single ceiling applied to each). OPTION B (C&C's ruling 1, 1 Nov 2026, fail closed): when COUNCIL_MAX_USD_LIMIT is set and a cap in force has no
//   ceiling of its own, the start is REFUSED and the sentence names the missing COUNCIL_MAX_USD_LIMIT_<ID> (A-DRAFT); an operator's single ceiling never
//   silently stops holding. MAX_USD_PER_RUN and --max-usd: no suggestion on any cap of a chain with caps in force (the Desktop max_usd feeds MAX_USD_PER_RUN too,
//   so its suggestion half is moot with the switch ON); unchanged for a chain with none. policy.json max_usd_per_run / max_usd_per_month: unchanged (they
//   compare the dry run's whole-run expected figure; an operator policy, not a cap a person types).
// PATHS WITH THE SWITCH ON. Trees (council tree start, a member's --tree-node start, council tree resume): REFUSED before anything is sent (C&C, 1 Nov
//   2026; a README Known-limits line, A-DRAFT; "trees under per-cap mode" is an open 0.8.4 item). The paid side
//   commands (post-run handoff, contract draft, digest, rematch, replay) are REFUSED the same way (C&C's ruling 3, after the check that B3's handler path
//   uses none of them), one Known-limits line each, open 0.8.4 items. These refusals land behind the not-armed refusal, before the arming lifts it.
// IN-PROCESS (the shape pinned in unit 1, built in unit 4a; the CACHE lane rebases on it; the buckets live in chain.js `capBuckets`, beside `budget`, so budgetState()
//   with the switch off stays byte for byte today's: its `caps` key appears only when armed). src/chain.js `budget` keeps { cap, spent, reserved, reservedExpected, assumed } as the RUN
//   totals (budget.cap is null with the switch ON: there is no third total); beside it, `capBuckets` is null (OFF) | { <id>: { cap, spent, reserved,
//   reservedExpected, assumed: { stages, usd } } } for the caps in force. setBudget(cap) is unchanged; setCapBudgets({ <id>: capUsd }) arms the buckets
//   after setBudget(null). invoke(): the seat's cap = billingAccountOf(seat); BOTH gate points of the base (b8eb7839) run on that cap's bucket: the call's own
//   check (wouldBreach, once: a seat bills through one account) and the check before the thinking retry is sent (28 Okt 2026); every charge (a replayed
//   stage, a discarded attempt, a settled cost, a billed failure, an error reply charged at its own usage or a typical cost) goes to the run total AND the
//   bucket; a seat with an account and no bucket is refused before anything is sent. countEarlierSpend takes the cap of the figure it counts (stale,
//   superseded, unsettled and unreplayed paid files alike: src/unreplayed.js).
// RECORDS (field names: CAP_RECORD_FIELDS below; every one ABSENT when the switch is OFF).
//   run.json              caps = { <id>: { maxUsd } } for the caps in force, written once the limits are typed (as maxUsd is today); maxUsd is not written.
//   STOPPED-budget.json   beside the base's fields (b8eb7839: stoppedAt, seat, spentUsd, capUsd, projectedStageUsd, gateStageUsd, assumedAtWorstCase?, note):
//                         capName (the cap that stopped), capSpentUsd (that cap's RECORDED spend), capAssumedUsd (that cap's worst case for replayed stages
//                         with no figure; omitted when 0). capUsd = that cap's limit (finite, so cli.js historyOfRun still opens the raise screen); spentUsd
//                         = the run's recorded total, as before; projectedStageUsd and gateStageUsd keep their per-call meaning. The stopped cap's floor =
//                         capSpentUsd + capAssumedUsd, and its smallest total for the next call to a model to be sent = resumeCeilingUsd({ cap: capUsd, spent: that floor, projected:
//                         projectedStageUsd, gate: gateStageUsd }).
//   BudgetExceeded        capName, beside the base's gate and retryRefused; cap = that cap's limit; spent = that cap's COUNTED spend (assumed included), also
//                         after the settle-after-siblings fix-up (both stop writers read that cap's bucket, never the run total); its message names the cap
//                         (A-DRAFT), the refused-retry form included.
//   run_cap gate          cap.cap_name = the cap a typed limit is for (a sixth key of the bound `cap` object; absent when OFF, so a gate without it hashes as
//                         before). runCapAuthority is read per cap (consumptions filtered by cap_name; no cap_name matches only gates without one). A stop
//                         opens cap X's raise screen only when the stop file's capName is X AND its capUsd equals X's consumed limit (two caps with the
//                         same figure must never raise the wrong one).
//   start scope           caps = the sorted caps in force, OMITTED when empty (OFF hashes exactly as before); changedParts names it.
//   spend-reservations/1  a `reserved` line carries capName (schema: optional, reserved lines only). Callers OMIT the key for a call that counts in no cap and
//                         never pass null (a free mock-priced seat projects dollars and has no account). unsettledReservations passes a valid one through.
//   usage, charge files   <label>.usage.json and superseded/<label>.charge-N.usage.json carry capName, so a resume gives every earlier figure to its cap
//                         from the record itself (a mockBills seat's provider is "mock").
//   report.json           caps = { <id>: { maxUsd, spentUsd } }; maxUsd is null with the switch ON, and schemas/report-v1.json's maxUsd description says so in
//                         the same commit (A-DRAFT), so a null there is never read as "uncapped".
//   Exit codes            a stop at any cap is exit 4, as today; refuse-uncovered is exit 5.
import { providerNames, isFreeProvider } from './providers.js';
import { redactText } from './secret-patterns.js';
import { isLimitPlaceholder, readUsdLimit } from './mcp/usd-limit.js';

export const CAPS_SETTING = 'COUNCIL_SPEND_CAPS';
export const MOCK_BILLS_FIELD = 'mockBills';
// The providers a cap can be enabled for: every provider that bills (the free local provider bills nothing; mock and external are not providers here).
export const BILLING_CAP_IDS = Object.freeze(providerNames().filter(p => !isFreeProvider(p)));

/** The ceiling setting of one cap: COUNCIL_MAX_USD_LIMIT_<ID>. Throws for anything that is not a billing provider id. */
export function capCeilingName(id) {
  if (typeof id !== 'string' || !BILLING_CAP_IDS.includes(id)) throw new TypeError(`capCeilingName: ${JSON.stringify(id)} is not a provider that bills (${BILLING_CAP_IDS.join(', ')})`);
  return `COUNCIL_MAX_USD_LIMIT_${id.toUpperCase()}`;
}
export const CAP_CEILING_NAMES = Object.freeze(BILLING_CAP_IDS.map(capCeilingName));

// The one billing predicate (it lived in src/start-scope.js; chainIsPaid reads it from here): a seat bills when its provider is not mock, not external (a person or
// another session answers) and not a free local provider. A mock seat with mockBills is still not a paid seat: the declaration only places an offline seat in a cap.
export const isPaidSeat = seat => !!seat && seat.provider !== 'mock' && seat.provider !== 'external' && !isFreeProvider(seat.provider);

/**
 * The cap a RECORDED figure counts in: the one its own stage record names (`capName`, written with the caps armed) when it is a billing cap id, else none (the figure counts in the run total only). The ONE rule: invoke()'s replay
 * (src/chain.js replayCapOf) and the limit screen's per-limit figure (src/stale-stages.js) both read it. Where a record names none, two readers fall back differently and the screen counts it in no limit: replayCapOf counts it in the cap of the
 * CURRENT seat's account, and cli.js (superseded stages, countEarlierSpend) counts it in the run total only. That can only be a step that bills through no cap (a mock, external or free seat), or a record written with the switch off, which a resume
 * under armed caps refuses (capsResumeVerdict: an OFF-to-ON flip of a run that holds maxUsd, and a run whose limits are not on record, are refused), so the figures agree for every step that bills.
 */
export const recordedCapOf = record => (BILLING_CAP_IDS.includes(record?.capName) ? record.capName : null);

/** The account a seat's calls are billed through: seat.provider for a seat that bills, a mock seat's valid mockBills, else null (free). Read on the resolved roster. */
export function billingAccountOf(seat) {
  if (!seat || typeof seat !== 'object') return null;
  if (seat.provider === 'mock') return typeof seat[MOCK_BILLS_FIELD] === 'string' && BILLING_CAP_IDS.includes(seat[MOCK_BILLS_FIELD]) ? seat[MOCK_BILLS_FIELD] : null;
  if (!isPaidSeat(seat)) return null;
  return typeof seat.provider === 'string' && seat.provider ? seat.provider : null;
}

/** null, or { code, sentence } when a seat carries mockBills where it may not (any seat that is not mock) or names no billing provider with it (A-DRAFT sentences). */
export function seatBillingRefusal(seat) {
  if (!seat || typeof seat !== 'object' || !Object.hasOwn(seat, MOCK_BILLS_FIELD)) return null;
  const value = seat[MOCK_BILLS_FIELD];
  if (seat.provider !== 'mock') {
    return { code: 'mock_bills_on_real_seat', sentence: `A seat whose provider is "${seat.provider}"${seat.model ? ` (${seat.model})` : ''} carries "${MOCK_BILLS_FIELD}", which only an offline mock seat may carry. A real seat's spend always counts against the cap of its own provider; the field is refused, not ignored, so that it cannot look as if it had moved the spend. Remove "${MOCK_BILLS_FIELD}" from that seat.` };
  }
  if (typeof value !== 'string' || !BILLING_CAP_IDS.includes(value)) {
    return { code: 'mock_bills_not_a_billing_provider', sentence: `A mock seat's "${MOCK_BILLS_FIELD}" is ${shown(JSON.stringify(value) ?? String(value))}, which is not a provider that bills (one of ${BILLING_CAP_IDS.join(', ')}).` };
  }
  return null;
}

// A value echoed in a sentence is redacted (a key pasted into the wrong field) and cut at 40 characters, as src/cap-input.js does.
const shown = raw => { const t = redactText(String(raw)).text; return t.length > 40 ? `${t.slice(0, 40)}...` : t; };
const refuse = (code, sentence) => ({ ok: false, code, sentence: `${sentence} Nothing was started.` });
const OFF_WORDS = /^(none|off|false|no|disabled?)$/i;

/**
 * COUNCIL_SPEND_CAPS -> { ok: true, caps: [] } (OFF: unset or blank) | { ok: true, caps: ['anthropic', 'openrouter'] } (sorted, each once)
 *                     | { ok: false, code, sentence } (code: not_text | placeholder | empty_entry | amount | free_provider | off_word | unknown_provider; A-DRAFT sentences).
 */
export function parseCapsSetting(raw) {
  if (raw === undefined || raw === null) return { ok: true, caps: [] };
  if (typeof raw !== 'string') return refuse('not_text', `${CAPS_SETTING} is not text, so which spending caps are on cannot be read.`);
  if (!raw.trim()) return { ok: true, caps: [] };
  if (isLimitPlaceholder(raw.trim())) return refuse('placeholder', `${CAPS_SETTING} still holds a placeholder from a settings template that was never filled in. Name the providers whose spend gets its own cap (for example openrouter,anthropic), or leave it empty for one limit per run.`);
  const caps = new Set();
  for (const entry of raw.split(',').map(e => e.trim())) {
    if (!entry) return refuse('empty_entry', `${CAPS_SETTING} has an empty entry between its commas. Name the providers separated by commas, for example openrouter,anthropic.`);
    const id = entry.toLowerCase();
    if (BILLING_CAP_IDS.includes(id)) { caps.add(id); continue; }
    if (/[0-9$€£]/.test(entry)) return refuse('amount', `${CAPS_SETTING} names which providers get their own spending cap, never an amount ("${shown(entry)}"): the amount of each cap is typed when a run starts.`);
    if (id === 'mock' || id === 'external' || isFreeProvider(id)) return refuse('free_provider', `${CAPS_SETTING} names "${shown(entry)}", which bills nothing, so it needs no cap. Name providers that bill: ${BILLING_CAP_IDS.join(', ')}.`);
    if (OFF_WORDS.test(id)) return refuse('off_word', `${CAPS_SETTING} is "${shown(entry)}". For one limit per run, leave ${CAPS_SETTING} empty; for a cap per provider, name the providers, for example openrouter,anthropic.`);
    return refuse('unknown_provider', `${CAPS_SETTING} names "${shown(entry)}", which is not a provider that bills (one of ${BILLING_CAP_IDS.join(', ')}).`);
  }
  return { ok: true, caps: [...caps].sort() };
}

// WHICH COMMANDS MAY SPEND (unit 2: the switch's check at the start of src/cli.js). FAIL CLOSED: a command runs while the switch is unreadable or on but not
// armed only when it is listed here as spending nothing. Every subcommand of src/cli.js (its SUBCOMMANDS) is in exactly one list, and every verb of
// `council tree` is classified (test/caps-switch-commands.test.js reads both from the source, so a new one forces a decision).
export const NON_SPENDING_SUBCOMMANDS = Object.freeze(['--version', '-v', 'accept', 'check-lock', 'demo', 'doctor', 'export-board', 'fence', 'gate', 'init', 'lint-criteria', 'pause', 'relay-answer', 'replay', 'ruling-add', 'retag-add', 'note-add', 'summary-add', 'ruling-withdraw', 'route-decide', 'refresh-zdr-list', 'verify-handoff']);
export const SPENDING_SUBCOMMANDS = Object.freeze(['digest', 'handoff']);
// Subcommands decided by their verb: these verbs spend nothing (a gated record, a read, a stop); any other verb of the two, a new one included, may spend.
export const NON_SPENDING_VERBS = Object.freeze({ tree: Object.freeze(['approve', 'check', 'decide', 'status', 'stop']), contract: Object.freeze(['amend', 'check', 'lock', 'show']) });
// The main path (no subcommand): a run marker means a start, a resume, a rematch, or a replay, whatever else is on the line (the rematch and
// replay blocks run before the report blocks); without one, a report, the MCP server (each run it starts checks the switch itself) or the usage print spends nothing.
const RUN_MARKERS = Object.freeze(['--task', '--resume', '--rematch', '--replay']);
const NO_RUN_MODES = Object.freeze(['--spend', '--cost-today', '--stats', '--metrics', '--forecast-cost', '--mcp', '--help', '-h']);
const flagNameOf = a => (typeof a === 'string' && a.startsWith('--') ? a.split('=')[0] : a);   // `--task=x` is `--task` (the CLI reads both forms)
// A dry run spends nothing (C&C's fix-up, 1 Nov 2026). The token is EXACTLY `--dry-run` on the raw arguments, the CLI's own test (`argv.includes('--dry-run')`
// in src/cli.js, `flags['dry-run'] === true` in src/tree-cli.js), never a normalised name: `--dry` (refused there as an unknown option) and `--dry-run=x`
// (refused as a value on a bare option) are no dry run. Honoured by the main path (its dry run exits before any call; --rematch and --replay read it as
// sideDryRun), by handoff and digest (sideDryRun), and by these verbs; any other verb with the token keeps its rule (`tree resume` takes no --dry-run).
const DRY_RUN = '--dry-run';
const DRY_RUN_VERBS = Object.freeze({ contract: Object.freeze(['draft']), tree: Object.freeze(['start']) });

/** true when the command these arguments name may spend (or cannot be shown to spend nothing); false for the usage print, a dry run and the commands listed above. */
export function commandMaySpend(argv = []) {
  const first = argv[0];
  if (first === undefined) return false;
  if (NON_SPENDING_SUBCOMMANDS.includes(first)) return false;
  const dry = argv.includes(DRY_RUN);
  if (SPENDING_SUBCOMMANDS.includes(first)) return !dry;
  if (Object.hasOwn(NON_SPENDING_VERBS, first)) return !NON_SPENDING_VERBS[first].includes(argv[1]) && !(dry && DRY_RUN_VERBS[first].includes(argv[1]));
  const names = argv.map(flagNameOf);
  if (dry) return false;
  if (names.some(n => RUN_MARKERS.includes(n))) return true;
  return !names.some(n => NO_RUN_MODES.includes(n));
}

// THE REFUSED CLASSES with the switch on (unit 3a; C&C's ruling 3 and its answers Q1a / Q1b of 1 Nov 2026). A recursive-council tree and the paid side commands
// cannot run with a cap per provider (a known limit of this version; KNOWN-LIMITS.md, one bullet per class). Each prints its OWN sentence, BEFORE
// the not-armed refusal (Q1a: observable on its own, with its own red); a tree member exits 19 (src/tree-run.js reads that as `tree_refused` and keeps the member's
// sentence), every other class 2. A DRY RUN of such a command, one the command honours (commandMaySpend says it spends nothing), prints capsDryRunNote and goes on
// (Q1b: it reports the refusal and calls nothing); a class line that is not an honoured dry run (`tree resume x --dry-run`) is refused.
const SIDE_SUBCOMMANDS = Object.freeze({ handoff: 'council handoff', digest: 'council digest' });
const classOf = (kind, command, exit = 2) => Object.freeze({ kind, command, exit });
/** { kind: 'tree' | 'side', command, exit } for a command of a class the switch refuses, else null. */
export function capsRefusedClassOf(argv = []) {
  if (argv.includes('--tree-node')) return classOf('tree', 'a tree member', 19);
  if (argv[0] === 'tree' && (argv[1] === 'start' || argv[1] === 'resume')) return classOf('tree', `council tree ${argv[1]}`);
  if (Object.hasOwn(SIDE_SUBCOMMANDS, argv[0])) return classOf('side', SIDE_SUBCOMMANDS[argv[0]]);
  if (argv[0] === 'contract' && argv[1] === 'draft') return classOf('side', 'council contract draft');
  for (const f of ['--rematch', '--replay']) if (argv.includes(f)) return classOf('side', `council ${f}`);
  return null;
}
const classReasonOf = c => `${c.kind === 'tree' ? 'a recursive-council tree' : c.command} cannot run with a spending cap per provider (a known limit of this version)`;
/** The refusal of a refused class (A-DRAFT). */
export const capsClassRefusalSentence = (c, caps) => `${CAPS_SETTING} is set (${caps.join(', ')}), and ${classReasonOf(c)}. Leave ${CAPS_SETTING} empty to ${c.kind === 'tree' ? 'run the tree' : 'run it'} with one typed limit. Nothing was started.`;
/** What a dry run of a refused class says before it goes on (A-DRAFT): a real run would be refused; the dry run calls nothing. */
export const capsDryRunNote = (c, caps) => `With ${CAPS_SETTING} set (${caps.join(', ')}), a real run of this command would be refused: ${classReasonOf(c)}. This dry run goes on and calls nothing.`;

/** The refusal at the top for a command that may spend and is neither a main start or resume (they arm, 4b2 and 4c1) nor a refused class with its own sentence (A-DRAFT). `caps`: parseCapsSetting's sorted list. */
export const capsNotArmedSentence = caps => `${CAPS_SETTING} is set (${caps.join(', ')}), but this command is neither a run start (--task) nor a --resume, the two commands the caps hold to one typed limit per provider. To start or continue a run under the caps, use --task or --resume. To run this command, leave ${CAPS_SETTING} empty and it runs with one typed limit per run. Nothing was started.`;

// THE START REFUSALS (unit 3b; C&C's rulings of 1 Nov 2026). With the switch on, a main START or RESUME that is no refused class is not refused at the top
// (capsDeferredStart): it runs the main path's own checks (the run folder, the chain, the keys, unpriced seats) and then, before anything is written, meets in
// this order: a seat that is not mock carrying mockBills (refused WHATEVER the switch says: seatBillingRefusal; on every CLI line the chain lint answers that one
// first, src/cli.js exitOnLint on the rerouted roster, start, resume and dry run alike, so this is the backstop behind it), seats no enabled cap covers (exit 5), option B (a
// cap in force without a ceiling of its own while COUNCIL_MAX_USD_LIMIT is set, exit 2; an unreadable one too; since 4b2 also the unreadable limits and Q1: "THE ARMING"),
// and then a start arms (4b2) and a resume takes its folder's class (4c1, "THE RESUME"). Every other line
// that may spend keeps the not-armed refusal at the top (fail closed). The list is computed once (src/uncovered.js capsStartRefusals); a dry run reports it, as
// text lines and as the JSON field `startRefusals` (absent when empty), and calls nothing (Q1b). A RESUME TAKES THE CLASS OF ITS RUN FOLDER, never of the
// --resume flag (C&C): a tree member's run (run.json's tree lineage) is a tree, exit 19; a plain run's resume (B3 resumes after every external seat) is no class.
/** true for a main start or resume that is no refused class: with the switch on it meets the start refusals after its own checks, not the top refusal. */
export const capsDeferredStart = (argv = []) => !capsRefusedClassOf(argv) && (argv.includes('--task') || argv.includes('--resume'));
/** The class of a resumed run folder, from what the folder is: { tree: run.json's lineage }. Null for a plain run. */
export const capsResumeClassOf = ({ tree = null } = {}) => (tree ? classOf('tree', 'a tree member', 19) : null);
/** A refused class as a start refusal ({ code, exit, sentence }): what a dry run reports for it in `startRefusals`. */
export const capsClassRefusalEntry = (c, caps) => Object.freeze({ code: `${c.kind}_refused`, exit: c.exit, sentence: capsClassRefusalSentence(c, caps) });

/**
 * A cap's own ceiling, COUNCIL_MAX_USD_LIMIT_<ID> (capCeilingName), read like COUNCIL_MAX_USD_LIMIT (src/cli.js readUsdCeiling: plain decimal dollars above zero):
 * { usd: number | null, unreadable: sentence | null }. Unset or empty: both null. A placeholder from a settings template, or anything else that is not a plain
 * number of dollars, is unreadable, and the value is never echoed (a key pasted into the wrong field).
 */
export function readCapCeiling(id, env = process.env) {
  const name = capCeilingName(id);
  const raw = env[name];
  if (raw === undefined || raw === '') return { usd: null, unreadable: null };
  if (isLimitPlaceholder(raw)) return { usd: null, unreadable: `${name} still holds a placeholder from a settings template that was never filled in, so no limit can be checked against it.` };
  const limit = readUsdLimit(raw);
  if (limit.refusal || limit.value === null) return { usd: null, unreadable: `${name} is set but is not a positive number of dollars, so no limit can be checked against it.` };
  return { usd: limit.value, unreadable: null };
}

/** The uncovered-seats refusal (A-DRAFT): each seat no enabled cap covers, with its roles and the account it bills through, and the two ways out. */
export function capsUncoveredSentence(entries, caps) {
  const one = entries.length === 1;
  const accounts = [...new Set(entries.map(e => e.account))];
  const seats = entries.map(e => `${e.provider}/${e.model} (${e.roles}), billed through ${e.account}`).join('; ');
  return `${CAPS_SETTING} is set (${caps.join(', ')}), and no cap covers ${one ? 'this seat' : 'these seats'}: ${seats}. Add ${accounts.join(' and ')} to ${CAPS_SETTING} to cap ${one ? 'it' : 'them'} too, or leave ${CAPS_SETTING} empty to run with one typed limit. Nothing was started.`;
}
/** Option B's refusal (A-DRAFT): COUNCIL_MAX_USD_LIMIT is set, so each cap in force needs its own ceiling; `names` are the ones not set. */
export const capsCeilingMissingSentence = (names, caps) => `${CAPS_SETTING} is set (${caps.join(', ')}) and so is COUNCIL_MAX_USD_LIMIT, so each cap in force needs its own ceiling, and ${names.join(' and ')} ${names.length === 1 ? 'is' : 'are'} not set. Set ${names.length === 1 ? 'it' : 'them'} to a plain number of dollars (such as 5 or 2.50). Nothing was started.`;
/** One line of a dry run's report of a start refusal (A-DRAFT): what a real start would do, without the "Nothing was started." a dry run has no use for. */
export const capsStartRefusalLine = r => `A real start would be refused (exit ${r.exit}): ${r.sentence.replace(/ Nothing was (started|sent)\.$/, '')}`;

// THE ARMING (unit 4b2; C&C's rulings of 1 Nov 2026). With the switch on and at least one cap in force (src/uncovered.js capsInForce), a main start runs under one
// limit a person types per cap (one typed-limit gate per cap, src/start-cap.js authorizeStart with capName), armed in invoke() as one bucket per cap
// (src/chain.js setCapBudgets). A run-wide figure cannot act there and is refused, LAST among the start refusals (Q1: --max-usd, or MAX_USD_PER_RUN from the
// environment or the project .env; a blank value or a host placeholder counts as unset, with the switch on only: C&C, ON-ONLY). A chain with no cap in force
// keeps today's path. The wait at exit 21 lists every gate still open, and its next step is a plain --resume: a RESUME of a folder that holds only what that
// wait wrote (capsPendingStart) continues the start; every other resume under the switch meets the not-armed line until the resume unit (4c).
/** Q1's refusal (A-DRAFT): a run-wide figure under the switch, naming the setting and where it was set, never its value. `source`: 'flag' | 'environment' | 'project-env'. */
export function capsRunWideSentence(source, caps) {
  const what = source === 'flag' ? '--max-usd' : source === 'environment' ? 'MAX_USD_PER_RUN, set in the environment (where the Desktop plugin\'s max_usd setting also lands),' : 'MAX_USD_PER_RUN, set in the project .env,';
  const out = source === 'flag' ? 'Start again without --max-usd' : source === 'environment' ? 'Unset it' : 'Remove that line';
  return `${what} sets one spending limit for the whole run, but ${CAPS_SETTING} (${caps.join(', ')}) holds this run to a limit you type for each provider. Nothing was started. ${out}, and type one limit per provider when the run asks.`;
}
/** Whether a raw MAX_USD_PER_RUN counts as SET with the switch on: a blank value or a host placeholder (a Desktop field left empty) is unset (C&C, ON-ONLY: with the switch off the old reading stands). */
export const perRunIsSet = raw => typeof raw === 'string' && raw.trim() !== '' && !isLimitPlaceholder(raw);
// What a start waiting at exit 21 leaves in its run folder (src/cli.js before the typed-limit wait: run.json, the run lock; src/start-cap.js: each gate's screen and
// scope file; src/gate.js and gate-ledger.js: the ledger, its lock and gates/), which is also all that `council gate answer` adds. REQUIRED must be there; ALLOWED
// may be. Anything else (a stage file, a usage file, a reservation, a stop file, a log) is a run that started.
const PENDING_REQUIRED = Object.freeze(['run.json', 'gate-ledger.jsonl', 'gates']);
const PENDING_ALLOWED = /^(?:\.council\.lock|gate-ledger\.lock|cap-screen-\d+\.md|cap-scope-\d+\.json|gates[/\\]g\d+\.json|\.spawn\.json)$/;   // .spawn.json: the MCP server's own record of the child it spawned (src/mcp/server.js recordSpawn; 4c2)
/** true when a run folder is a start still waiting for its typed limits: `entries` = its recursive listing (relative paths), `meta` = its run.json, which records no limit (no caps, no maxUsd). */
export function capsPendingStart(entries, meta) {
  if (!meta || typeof meta !== 'object' || Object.hasOwn(meta, 'caps') || Object.hasOwn(meta, 'maxUsd')) return false;
  const list = (entries ?? []).map(String);
  return PENDING_REQUIRED.every(f => list.includes(f)) && list.every(f => PENDING_REQUIRED.includes(f) || PENDING_ALLOWED.test(f));
}
/** The wait at exit 21 under the switch (A-DRAFT): every gate still open, one line each, then the one command that continues. `pending`: [{ id, gate }] in cap order. */
export function capsWaitSentence(pending, caps, { dir, command, raiseId = null, relayed = false }) {
  // Unit 4c1: an early raise repeats its `--raise-cap <id>` on the resume; a RELAYED raise (W2) lists one relay-answer line per open gate and the handler's resume.
  const again = `${command} --resume ${dir}${raiseId || relayed ? ` --raise-cap${raiseId ? ` ${raiseId}` : ''}` : ''}${relayed ? ' --relayed' : ''}`;
  if (relayed) {
    const lines = pending.map((p, i) => (p.relayed ? `  ${i + 1}. ${command} relay-answer ${dir} ${p.gate} --total <the total, in dollars> --person-words "<the person's words as typed in this window, with the total in digits>"   (the ${p.id} cap: the session asked for this limit and relays what the person gives)` : `  ${i + 1}. ${command} gate answer ${dir} ${p.gate}   (the ${p.id} cap: the person asked for this limit and types it)`));
    return `This run waits for a raised spending limit for each cap below. No call was started and nothing more was spent.\n${lines.join('\n')}\n  ${pending.length + 1}. ${again}\nThe tool cannot verify the permission; the record shows who relayed it.`;
  }
  const lines = pending.map((p, i) => `  ${i + 1}. ${command} gate answer ${dir} ${p.gate}   (the ${p.id} cap)`);
  return `This run waits for a spending limit that you type for each provider still open (${CAPS_SETTING}: ${caps.join(', ')}). No call was started and nothing more was spent.\n${lines.join('\n')}\n  ${pending.length + 1}. ${again}`;
}
// THE RESUME (unit 4c1; C&C's rulings of 1 Nov 2026). A resume takes its class from its RUN FOLDER: a CAPS RUN is run.json `caps` AND one consumption per cap named
// there in the gate ledger (every armed run: arming consumes each gate before it writes `caps`; the ledger is the authority, run.json a copy). It resumes under
// the limits typed for it when the same caps are in force; a run started under one run-wide limit (run.json maxUsd) is refused when a cap is in force for it now,
// a caps run when the switch is now off (the MODE FLIP, both ways), a caps run whose set of caps in force changed (a cap added or dropped after it spent), and a
// folder that records no limit it can show and is no start still waiting for its typed limits (UNTOLD). A chain with no cap in force keeps today's path.
const listOrNone = ids => (ids.length ? ids.join(', ') : 'none');
/** The flip ON->OFF (A-DRAFT F1). `runCaps`: the caps the run was started under, sorted. */
export const capsFlipOffSentence = runCaps => `This run was started with ${CAPS_SETTING} set (${runCaps.join(', ')}), under a limit typed for each provider, and the setting is now empty, so it was not continued: its limits would no longer be the ones it ran under. Set ${CAPS_SETTING} to ${runCaps.join(',')} again to continue it. Nothing was started.`;
/** The flip OFF->ON (A-DRAFT F2). `caps`: the switch's ids. */
export const capsFlipOnSentence = caps => `This run was started under one typed limit for the whole run, and ${CAPS_SETTING} is now set (${caps.join(', ')}), so it was not continued: its limits would no longer be the ones it ran under. Leave ${CAPS_SETTING} empty to continue it. Nothing was started.`;
/** A changed set of caps in force (A-DRAFT F3). */
export const capsSetChangedSentence = (runCaps, nowCaps) => `This run was started under these caps: ${listOrNone(runCaps)}. The caps in force now: ${listOrNone(nowCaps)}. It was not continued: a run keeps the caps it was started under, and a cap added or dropped since would change its limits. Continue it with the same caps in force (${listOrNone(runCaps)}). Nothing was started.`;
/** A folder whose limits cannot be told (A-DRAFT U1). */
export const CAPS_UNTOLD_SENTENCE = 'This run folder records no spending limit (run.json has no maxUsd, and the gate ledger holds no cap backed by a typed limit), and it is not a start still waiting for its limits, so what it may spend cannot be known and it was not continued. Start a new run. Nothing was started.';
/**
 * The resume's class (pure): { ok: 'today' | 'caps' | 'pending' } or { refuse: sentence }. `switchCaps`: the switch's ids ([] = off); `armed`: the caps in force now
 * (capsInForce); `meta`: run.json; `entries`: the folder's recursive listing; `consumed`: the cap ids with a consumption in the ledger.
 */
export function capsResumeVerdict({ switchCaps = [], armed = [], meta = null, entries = [], consumed = [] } = {}) {
  const raw = meta && typeof meta === 'object' ? meta.caps : undefined;
  const runCaps = raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.keys(raw).sort() : null;
  if (!switchCaps.length) return runCaps ? { refuse: capsFlipOffSentence(runCaps) } : { ok: 'today' };
  if (!armed.length) return runCaps ? { refuse: capsSetChangedSentence(runCaps, armed) } : { ok: 'today' };
  if (meta && Object.hasOwn(meta, 'maxUsd')) return { refuse: capsFlipOnSentence(switchCaps) };
  if (runCaps) {
    if (!runCaps.length || !runCaps.every(id => consumed.includes(id))) return { refuse: CAPS_UNTOLD_SENTENCE };
    if (runCaps.join(',') !== [...armed].sort().join(',')) return { refuse: capsSetChangedSentence(runCaps, [...armed].sort()) };
    return { ok: 'caps' };
  }
  return capsPendingStart(entries, meta) ? { ok: 'pending' } : { refuse: CAPS_UNTOLD_SENTENCE };
}
/** --raise-cap under the caps with no cap named and no stop file naming one (A-DRAFT B1). */
export const capsRaiseNameSentence = caps => `--raise-cap: name the cap to raise, one of this run's caps (${caps.join(', ')}), for example --raise-cap ${caps[0]}. A run stopped at a cap raises that cap with a plain --resume.`;
/** --raise-cap <id> naming no cap of this run (A-DRAFT B2). The id is a word the person typed on the command line, shown as typed (cut at 40 characters). */
export const capsRaiseUnknownSentence = (id, caps) => { const shown = String(id).slice(0, 40); return `--raise-cap ${shown}: ${shown} is not one of this run's caps (${caps.join(', ')}). Name one of them.`; };
/** The run log's cap line under the switch (A-DRAFT). `limits`: { <id>: usd }; `money`: the formatter. */
export const capsLogLine = (limits, money) => `cap:   ${Object.keys(limits).sort().map(id => `${id} ${money(limits[id])}`).join(', ')} (one limit typed for each provider)`;

// The record fields the units write with the switch ON (every one ABSENT when it is OFF): one place, so a writer and a reader cannot spell them differently.
export const CAP_RECORD_FIELDS = Object.freeze({
  runJson: 'caps',
  scope: 'caps',
  report: 'caps',
  stop: Object.freeze({ name: 'capName', spentUsd: 'capSpentUsd', assumedUsd: 'capAssumedUsd' }),
  error: 'capName',
  gate: 'cap_name',
  reservation: 'capName',
  usage: 'capName',
});
