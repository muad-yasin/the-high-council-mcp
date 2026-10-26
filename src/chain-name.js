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
    : `${where}: expected a chain name such as "mock" or "plan-default-opro-council" (letters, digits, ".", "_", "-"; not starting with "." or "-"), got ${JSON.stringify(name)}`;
}

// 0.8.2: there was no default chain (0.8.3 E5c brought one back, below). Until 0.8.1 a run without --chain silently used `verify`, whose
// Gemini 2.5 seat is closed to new Google projects, so a first run could fail or spend on seats the
// person never chose. These are the chains the README recommends; the refusal names them.
// Retired chains live in the repository's chains/outdated/ and are NOT in the npm package (0.8.3, Muad 18 Okt 2026: "Your pick sounds good"). A run recorded on one of them,
// or a --chain that names one, can no longer find its file, so every "no such chain" message adds this hint (src/cli.js, src/council-replay.js, src/api.js, src/tree-start.js,
// src/tree-derive-load.js, src/mcp/server.js). OUTDATED_0_8_2 is what 0.8.2 moved out of chains/ (to archive/chains/ then); OUTDATED_0_8_3 is what 0.8.3 retired.
// test/outdated-chains.test.js keeps the two lists equal to the files in chains/outdated/.
export const OUTDATED_0_8_2 = Object.freeze(['cheap', 'cheap-7', 'gp-judge-v1', 'idea-open-c2', 'plan-auto', 'plan-auto-mistral', 'plan-cheap', 'plan-debate', 'plan-debate-c2',
  'plan-debate-open-c2', 'plan-fast', 'plan-proposals', 'plan-proposals-best-of-5', 'plan-relay', 'plan-thorough', 'plan-two-strong', 'plan-unanimous', 'seven', 'seven-cheap',
  'smo', 'smo-v2-cheap']);
export const OUTDATED_0_8_3 = Object.freeze(['advise-premium', 'cheap-7-v2', 'coder-gate-v1', 'coder-gate-v2', 'eu-only', 'plan-daily-7', 'plan-debate-roles-c1', 'plan-highest-7', 'plan-lanes-4',
  'plan-open-7', 'plan-premium-7', 'security-review-only', 'single-vendor-anthropic', 'single-vendor-openai', 'us-only']);
export const OUTDATED_CHAINS = Object.freeze([...OUTDATED_0_8_2, ...OUTDATED_0_8_3]);
// B-DRAFT (0.8.3 lane B, needs the owner's yes): the sentence a person reads when a retired chain is named.
// The same for an ADVICE chain: an advice call never reads a project's chains/ (src/send-profiles.js), so the copy goes to the folder the operator names.
export const outdatedAdviceChainHint = name => (OUTDATED_CHAINS.includes(name)
  ? ` "${name}" was retired from the package (${OUTDATED_0_8_2.includes(name) ? '0.8.2' : '0.8.3'}): it is in the repository as chains/outdated/${name}.json, not in the npm package. To use it again, copy that file from GitHub into the folder COUNCIL_ADVICE_CHAINS_DIR names.` : '');
export const outdatedChainHint = name => (OUTDATED_CHAINS.includes(name)
  ? ` "${name}" was retired from the package (${OUTDATED_0_8_2.includes(name) ? '0.8.2' : '0.8.3'}): it is in the repository as chains/outdated/${name}.json, not in the npm package. To use it again, copy that file from GitHub into this project's chains/ folder.` : '');

// 0.8.3 E5c (Muad 14 Oct 2026: "we can do daily7 as the default for 0.8.3, yes"), then the tiers (Muad 15 Okt 2026: "Default chain (CLI and MCP) = plan-mini-council"): a run with no --chain uses this chain and says so. It is not a silent spend:
// a paid run's limit is always a number a person types (src/start-cap.js), whatever the chain. The sentences below are E items (Muad's yes at M7).
export const DEFAULT_CHAIN = 'plan-mini-council';   // 0.8.3 tiers (Muad 15 Okt 2026): the three planning tiers are plan-mini-council (the default), plan-medium-council, plan-high-council
export const PROMOTED_CHAINS = [DEFAULT_CHAIN, 'plan-medium-council', 'plan-high-council'];   // the three tiers and no more (Muad, 24 Okt 2026: "We recommend mini, medium, High. These are our 3 main chains."; on local-ollama: "Maybe in 0.8.4 we could advertise it after building something proper for it")

export function defaultChainNotice(name = DEFAULT_CHAIN) {
  return `No --chain given: using the default chain ${name}. Its first stage needs a Claude Code session; without one the run pauses there with nothing spent. `
    + `Name another chain with --chain (\`council doctor\` lists every chain and its worst-case price).`;
}
