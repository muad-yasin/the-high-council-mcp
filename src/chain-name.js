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
    : `${where}: expected a chain name such as "mock" or "plan-debate" (letters, digits, ".", "_", "-"; not starting with "." or "-"), got ${JSON.stringify(name)}`;
}
