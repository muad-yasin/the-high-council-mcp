// 0.8.4 the OpenRouter switch (Builder B): the routed id of a Claude model. A shipped chain's DIRECT Claude seat (provider "anthropic", model "claude-<name>-<n>-<m>") can be called through OpenRouter (src/claude-route.js), where the
// model is "anthropic/claude-<name>-<n>.<m>" (OpenRouter writes the version with a dot). Pure and import-safe (no fetch, no file): scripts/refresh-context-windows.mjs lists these ids so its table keeps a window row for each routed Claude
// model, and test/routed-claude-rows.test.js checks the shipped chains give exactly the ids the tables hold rows for.
export const routedClaudeId = m => {
  const v = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(m);
  return v ? `anthropic/claude-${v[1]}-${v[2]}.${v[3]}` : /^claude-[a-z]+-\d+$/.test(m) ? `anthropic/${m}` : null;
};
/** The sorted, unique routed ids of every direct Anthropic seat found anywhere in a chain's `seats`. */
export const routedClaudeIdsOf = seats => {
  const out = new Set();
  const walk = x => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') {
      if (x.provider === 'anthropic' && typeof x.model === 'string' && routedClaudeId(x.model) !== null) out.add(routedClaudeId(x.model));
      Object.values(x).forEach(walk);
    }
  };
  walk(seats);
  return [...out].sort();
};
