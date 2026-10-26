// The wording of the reasoning table's AUTO "unlisted" entries, in a module that reads no file: scripts/refresh-reasoning-table.mjs writes them and src/reasoning.js reads their prefix, so the two
// share one definition. (The script needs a parseable src/reasoning-table.json anyway: it keeps the existing rows, and its import of src/providers.js already loads src/reasoning.js, which parses the table.)
// Two kinds of entry live in the table's `unlisted` section. DELIBERATE: kept by hand in the script's UNLISTED map (a model that takes no reasoning setting, a local model). AUTO: one per
// OpenRouter id the script found missing from the router's public list; its reason begins NOT_ON_ROUTER_PREFIX, and the chain-lint rule `reasoning-not-high` does not accept it for a seat.
export const NOT_ON_ROUTER_PREFIX = "not in OpenRouter's public list on";
/** The auto entry's reason, said truthfully: `seated` is whether a chain in chains/ seats the id (the script checks; it used to claim "no shipped seat uses it" for every id). */
export const notOnRouterReason = (asOf, seated) => `${NOT_ON_ROUTER_PREFIX} ${asOf}; ${seated ? 'a shipped chain seats it, so the chain-lint rule reasoning-not-high does not accept this entry for it' : 'no shipped chain seats it'}`;
