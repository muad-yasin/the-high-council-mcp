// The time budget the MCP server's typed-limit dialogs count with. These two constants lived in src/mcp/advice.js until 0.8.4 (the advice add-on's tools left); the figures are unchanged.
// The time budget (brief 26: the smallest documented client limit is 30 s; 0.8.1 DR-6). The hold covers the person's answer and the start together, counted from the start of the call.
export const DEFAULT_HOLD_S = 25;
// The part of the budget kept for starting the run after the person answers: a CLI start takes about a second on an idle machine
// and several under load (measured on the maintainer's 8-core laptop during the test suite), so five seconds.
export const START_MARGIN_S = 5;
