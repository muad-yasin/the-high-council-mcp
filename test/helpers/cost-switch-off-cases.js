// The inputs the switch-off pin of the cost functions runs (test/prompt-cache-money.test.js) and the capture script (Review/084/cache/capture-cost-switch-off.mjs) runs on the tree BEFORE the money commit.
// No import from src/: each case receives the cost module of the tree under test. Every case is a call WITHOUT a cache marker (no `cache` argument, no `cacheAsked` in the usage).
const seats = [
  { provider: 'anthropic', model: 'claude-sonnet-5', maxTokens: 4000 },
  { provider: 'anthropic', model: 'claude-opus-5', maxTokens: 128000 },
  { provider: 'openrouter', model: 'anthropic/claude-sonnet-5.5', maxTokens: 8000 },
  { provider: 'mock', model: 'mock-priced', maxTokens: 500 },
];
const usages = [{ input: 1000, output: 200 }, { input: 123456, output: 7890, thinking: 100, stop: 'end_turn' }, { input: 0, output: 0 }];
export const cases = [
  ...seats.flatMap(seat => usages.map((u, i) => ({ name: `costOf ${seat.provider}/${seat.model} #${i}`, run: C => C.costOf(seat.provider, seat.model, u) }))),
  ...seats.map(seat => ({ name: `worstCaseOf ${seat.provider}/${seat.model}`, run: C => C.worstCaseOf(seat.provider, seat.model, { promptChars: 400000, maxTokens: seat.maxTokens }) })),
  ...seats.map(seat => ({ name: `projectAttempts ${seat.provider}/${seat.model}`, run: C => C.projectAttempts(seat, { system: 'S'.repeat(3000), user: 'U'.repeat(300000) }) })),
  ...seats.map(seat => ({ name: `expectedCallUsd ${seat.provider}/${seat.model}`, run: C => C.expectedCallUsd(seat, { system: 'S'.repeat(3000), user: 'U'.repeat(300000), label: 'panel-1-x', estimate: { critiqueTokens: 3000 } }) })),
  ...[{ input: 1, output: 2, thinking: 3, cached: 4 }, { input: 'x', output: 2 }, { input: 5, output: 6, stop: 'length' }, null].map((u, i) => ({ name: `readUsage #${i}`, run: C => C.readUsage(u) })),
];
