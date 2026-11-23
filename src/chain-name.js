// What a chain argument may be: a chain's name, looked up as chains/<name>.json. Letters, digits,
// ".", "_" and "-", and not starting with "." or "-". Never a path, and never something the CLI's
// own argument parser would read as a flag.
//
// Security scan 2026-09-26 (THC #5): the MCP tools passed `chain` to the CLI unchecked, so a
// path-shaped value loaded any JSON file as a chain config, and a value such as "--spend" became a
// flag of its own. One check for the MCP server, the CLI (--chain, and the chain a --resume,
// --rematch or --replay reads back from run.json) and the JS API.
export const CHAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

export function isChainName(name) {
  return typeof name === 'string' && name.length <= 200 && CHAIN_NAME.test(name);
}

export function chainNameRefusal(name, where = 'chain') {
  return isChainName(name) ? null
    : `${where}: expected a chain name such as "mock" or "plan-mini-council" (letters, digits, ".", "_", "-"; not starting with "." or "-"), got ${JSON.stringify(name)}`;
}

// 0.8.2: there was no default chain (0.8.3 E5c brought one back, below). Until 0.8.1 a run without --chain silently used `verify`, whose
// Gemini 2.5 seat is closed to new Google projects, so a first run could fail or spend on seats the
// person never chose. These are the chains the README recommends; the refusal names them.
// Retired chains live in the repository's chains/outdated/ and are NOT in the npm package (0.8.3, Muad 18 Okt 2026: "Your pick sounds good"). A run recorded on one of them,
// or a --chain that names one, can no longer find its file, so every "no such chain" message adds this hint (src/cli.js, src/council-replay.js, src/api.js, src/tree-start.js,
// src/tree-derive-load.js, src/mcp/server.js). OUTDATED_0_8_2 is what 0.8.2 moved out of chains/ (to archive/chains/ then); OUTDATED_0_8_3 is what 0.8.3 retired; OUTDATED_0_8_4 is what 0.8.4 retired.
// test/outdated-chains.test.js keeps the three lists equal to the files in chains/outdated/.
export const OUTDATED_0_8_2 = Object.freeze(['cheap', 'cheap-7', 'gp-judge-v1', 'idea-open-c2', 'plan-auto', 'plan-auto-mistral', 'plan-cheap', 'plan-debate', 'plan-debate-c2',
  'plan-debate-open-c2', 'plan-fast', 'plan-proposals', 'plan-proposals-best-of-5', 'plan-relay', 'plan-thorough', 'plan-two-strong', 'plan-unanimous', 'seven', 'seven-cheap',
  'smo', 'smo-v2-cheap']);
export const OUTDATED_0_8_3 = Object.freeze(['cheap-7-v2', 'coder-gate-v1', 'coder-gate-v2', 'eu-only', 'plan-daily-7', 'plan-debate-roles-c1', 'plan-highest-7', 'plan-lanes-4',
  'plan-open-7', 'plan-premium-7', 'security-review-only', 'single-vendor-anthropic', 'single-vendor-openai', 'us-only']);
// 0.8.4 (Muad, 05 Nov 2026: the tree's child runs use the parent's chain by default, and the old child chain leaves the package): daily7-sub-a. 0.8.4 (36a: the one-model advisor mode is removed; the eight advice chains left the repository with the add-on, see REMOVED_ADVICE_CHAINS).
export const OUTDATED_0_8_4 = Object.freeze(['daily7-sub-a',
  'plan-default-opro-council', 'plan-mini-council-sol-session', 'plan-china-mini-council', 'verify']);   // the last four: Muad, 10 Nov 2026 01:10 CET ("retire it, same for sol-session and one-key chain") and 01:56 CET (the Chinese mini)
export const OUTDATED_CHAINS = Object.freeze([...OUTDATED_0_8_2, ...OUTDATED_0_8_3, ...OUTDATED_0_8_4]);
const retiredIn = name => (OUTDATED_0_8_2.includes(name) ? '0.8.2' : OUTDATED_0_8_4.includes(name) ? '0.8.4' : '0.8.3');
// B-DRAFT (0.8.3 lane B, needs the owner's yes): the sentence a person reads when a retired chain is named.
// A-DRAFT (0.8.4, the add-on removal; row REM-w1): the eight advice chains that were in chains/outdated/ left the repository with the add-on. Their names stay typed here so a person who names one is told where it went (Muad's Q9 (a)); no file is named, because none exists.
export const REMOVED_ADVICE_CHAINS = Object.freeze(['advise-premium', 'advise-single', 'advise-single-astra', 'advise-single-deepseek', 'advise-single-gemini', 'advise-single-glm-flash', 'advise-single-opus', 'advise-single-qwen']);
const removedAdviceHint = name => ` "${name}" was removed in 0.8.4 with the advice add-on. Its file is no longer in the repository; the git history keeps it.`;
export const outdatedChainHint = name => (REMOVED_ADVICE_CHAINS.includes(name) ? removedAdviceHint(name) : OUTDATED_CHAINS.includes(name)
  ? ` "${name}" was retired from the package (${retiredIn(name)}): it is in the repository as chains/outdated/${name}.json, not in the npm package. To use it again, copy that file from GitHub into this project's chains/ folder.` : '');

// 0.8.3 E5c (Muad 14 Oct 2026: "we can do daily7 as the default for 0.8.3, yes"), then the tiers (Muad 15 Okt 2026: "Default chain (CLI and MCP) = plan-mini-council"): a run with no --chain uses this chain and says so. It is not a silent spend:
// a paid run's limit is always a number a person types (src/start-cap.js), whatever the chain. The sentences below are E items (Muad's yes at M7).
export const DEFAULT_CHAIN = 'plan-mini-council';   // 0.8.3 tiers (Muad 15 Okt 2026): the three planning tiers are plan-mini-council (the default), plan-medium-council, plan-high-council
export const QUICK_START_CHAIN = DEFAULT_CHAIN;   // 0.8.4 seats unit: the one-key chain retired (Muad, 10 Nov 2026 01:10 CET), so the README's quick start names the default chain; doctor's one-key line lists it first when it is in that list, so the sentence and the line cannot disagree
export const PROMOTED_CHAINS = [DEFAULT_CHAIN, 'plan-medium-council', 'plan-high-council'];   // the three tiers and no more (Muad, 24 Okt 2026: "We recommend mini, medium, High. These are our 3 main chains."; on local-ollama: "Maybe in 0.8.4 we could advertise it after building something proper for it")

export function defaultChainNotice(name = DEFAULT_CHAIN) {
  return `No --chain given: using the default chain ${name}. Its first stage needs a Claude Code session; without one the run pauses there with nothing spent. `
    + `Name another chain with --chain (\`council doctor\` lists every chain and its worst-case price).`;
}
