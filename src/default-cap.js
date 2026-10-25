// The per-run spend ceiling a run has when nobody set one (MAX_USD_PER_RUN unset): ONE value for the CLI (src/cli.js) and the MCP server (src/mcp/server.js), so a sentence that names it is formatted
// from it and cannot drift from the number the run is capped at (M7 apply E102, C&C 18 Okt 2026: a count moves with the thing it counts). Dollars. README/docs/mcpb type the figure by hand; test/default-cap-figures.test.js pins them.
export const DEFAULT_MAX_USD = 7;

// The Claude Desktop bundle's own default for the same setting (A3b U1, 18 Okt 2026; Muad: "the Claude Desktop default spend ceiling goes from $7 to $10", pick 3, "3: yes"): mcpb/manifest.json `max_usd` default. A SEPARATE figure on purpose
// (backend rule 13, two tunables that could drift get two names and a decoupling test): in the bundle the same value also becomes COUNCIL_MAX_USD_LIMIT, the ceiling that bounds typed and tree amounts, so raising it raises that ceiling for a
// Desktop install; DEFAULT_MAX_USD above stays the command line's and the MCP server's default when MAX_USD_PER_RUN is unset (and server.json's, the registry listing of the npm package). Nothing in src/ reads this constant: the manifest (a JSON
// file) cannot import it, so test/default-cap-figures.test.js pins the manifest and the texts that name it against this one number.
export const DESKTOP_DEFAULT_MAX_USD = 10;
