// COUNCIL_MAX_USD_LIMIT, read once by src/mcp/server.js at the start of runMcpServer, after a project .env was applied (13 Oct 2026, audit item 1, C&C's ruling): a ceiling the MCP client cannot lift through max_usd (README: "a cap the MCP client cannot raise or remove").
//   readUsdLimit(raw, { placeholder })  (a value is a plain decimal number of dollars: digits with an optional fraction, spaces around it tolerated) -> { value: number | null, refusal: string | null }
//     raw: limitSource's answer: the variable as the process was given it (read BEFORE server.js drops unexpanded `${user_config.*}` placeholders), or, when it was unset or empty, the value a project .env supplied.
//     value: null means "no server limit" (the tools then behave as they did before the limit existed); a positive finite number is the limit.
//     refusal: a sentence for the person, when the value is set but not a positive finite number. The caller prints it and does not start the server.
// Why a refusal and not null: a SET but unreadable limit used to become null, and null means unset, so a client's max_usd 25 (or "none") passed straight to the CLI and the send path skipped its
// over_server_limit check: a fail-open on money. An EMPTY value stays unset (a host that fills the variable from an optional empty setting).
// THE PLACEHOLDER BRANCH is Muad's call (his 13:00 talk, 13 Oct 2026): the bundle's unexpanded `${user_config.max_usd}`. 'refuse' (the default until he answers) stops a misconfigured bundle at start;
// 'unset' is the old reading (no server limit) and is fail-open. One named constant, one branch.
export const PLACEHOLDER_LIMIT_POLICY = 'refuse';
// COUNCIL_MAX_USD_LIMIT as the process was GIVEN it: this module is evaluated before src/mcp/server.js (which drops whole-placeholder values at import) and before cli.js applies a project .env, so it is the operator's own value. The CLI resolves its limit from this with `limitSource` (T9), as the MCP server does from its own early read.
export const USD_LIMIT_AS_GIVEN = process.env.COUNCIL_MAX_USD_LIMIT;
// The ONE rule for "a host placeholder is sitting in the variable" (the MCP sentence below and the CLI's own sentence both ask it).
export const isLimitPlaceholder = raw => typeof raw === 'string' && PLACEHOLDER.test(raw);
import { redactText } from '../secret-patterns.js';
const PLAIN_DECIMAL = /^\s*\d+(\.\d+)?\s*$/;
const PLACEHOLDER = /^\$\{user_config\.[^}]*\}$/;
// The value is echoed in the sentence (it reaches the host's log), so anything key-shaped in it is redacted first (src/secret-patterns.js): someone may have pasted a key into the wrong field.
export const shown = raw => { const t = redactText(String(raw)).text; return t.length > 40 ? `${t.slice(0, 40)}...` : t; };

// Which text is the limit once a project .env has been applied. src/env-file.js lets a .env fill any name whose real value is not PRESENT (src/key-env.js keyPresent: blank, whitespace-only or containing
// `${user_config.` counts as absent), and server.js drops whole-placeholder values at import. So "the real environment wins" holds only for a value this function keeps: ANY non-empty value the process was
// given stays the answer (readUsdLimit then reads it, or refuses it: a placeholder by the policy below, "   " or "abc" as not a number), and only an unset or empty one is replaced by what the .env supplied
// (a .env can add a limit where there was none, never lift or remove one). `atImport` is the variable as the process was given it, `now` is the variable after the .env was applied.
// NAMED EXCEPTION to env-file's "blank counts as absent" (C&C, 13 Oct 2026; do not "fix" it back): who can write each value decides. The real environment is the operator's, a project .env is the project's, so an
// operator's non-empty value, even a malformed one, is never overridden by a project file: it is refused instead (fail-closed on money). env-file's rule serves keys and settings, not caps. And limitSource, not env-file,
// decides this: the real value is kept even if a .env could replace it, so no change to env-file's present-wins rule can move the result (test/mcp-usd-limit-env.test.js row 3 guards the pair).
export const limitSource = (atImport, now) => (atImport !== undefined && atImport !== '' ? atImport : now);

export function readUsdLimit(raw, { placeholder = PLACEHOLDER_LIMIT_POLICY } = {}) {
  if (raw === undefined || raw === '') return { value: null, refusal: null };
  if (PLACEHOLDER.test(raw)) {
    if (placeholder === 'unset') return { value: null, refusal: null };
    return { value: null, refusal: `COUNCIL_MAX_USD_LIMIT still reads "${shown(raw)}": the extension's "Spend ceiling per run (USD)" setting was not filled in by the host, so the server did not start. Without a readable limit the client could raise or remove the spend ceiling. Enter a number of dollars in that setting and start the server again.` };
  }
  // Plain decimal dollars only (C&C, 13 Oct 2026): Number() would read "0x10" as $16 and "1e2" as $100, a money setting silently read as something nobody typed. A leading or trailing space is tolerated.
  const v = PLAIN_DECIMAL.test(raw) ? Number(raw) : NaN;
  if (Number.isFinite(v) && v > 0) return { value: v, refusal: null };
  return { value: null, refusal: `COUNCIL_MAX_USD_LIMIT is "${shown(raw)}", which is not a plain number of dollars above zero (digits with an optional fraction, such as 5 or 2.50), so the server did not start. A limit it cannot read would leave the client free to raise or remove the spend ceiling. Set such a number where it is set (the server's settings, or the COUNCIL_MAX_USD_LIMIT line in the project's .env), or clear it to run with no server limit.` };
}
