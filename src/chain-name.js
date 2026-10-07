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
    : `${where}: expected a chain name such as "mock" or "cheap-7-v2" (letters, digits, ".", "_", "-"; not starting with "." or "-"), got ${JSON.stringify(name)}`;
}

// 0.8.2: there is no default chain. Until 0.8.1 a run without --chain silently used `verify`, whose
// Gemini 2.5 seat is closed to new Google projects, so a first run could fail or spend on seats the
// person never chose. These are the chains the README recommends; the refusal names them.
// The 21 chains 0.8.2 moved from chains/ to archive/chains/ in the repository (not in the npm package). A run recorded on one of them can no longer
// find its file, so the "no such chain" errors add a hint (src/cli.js, src/council-replay.js). test/archived-chains.test.js keeps this list equal to the folder.
export const ARCHIVED_CHAINS = Object.freeze(['cheap', 'cheap-7', 'gp-judge-v1', 'idea-open-c2', 'plan-auto', 'plan-auto-mistral', 'plan-cheap', 'plan-debate', 'plan-debate-c2',
  'plan-debate-open-c2', 'plan-fast', 'plan-proposals', 'plan-proposals-best-of-5', 'plan-relay', 'plan-thorough', 'plan-two-strong', 'plan-unanimous', 'seven', 'seven-cheap',
  'smo', 'smo-v2-cheap']);
export const archivedChainHint = name => (ARCHIVED_CHAINS.includes(name)
  ? ` "${name}" was moved to archive/chains/ in 0.8.2 (in the repository, not in the npm package): copy archive/chains/${name}.json into this project's chains/ folder to use it again.` : '');

export const PROMOTED_CHAINS = ['cheap-7-v2', 'plan-daily-7', 'plan-premium-7', 'plan-highest-7', 'local-ollama'];

export function noChainRefusal(where = '--chain') {
  return `${where}: no chain named, and since 0.8.2 there is no default chain. Name one, for example --chain cheap-7-v2 (one OpenRouter key). `
    + `Recommended: ${PROMOTED_CHAINS.join(', ')}. Run \`council doctor\` to list every chain and its worst-case price. Nothing was run and nothing was spent.`;
}
