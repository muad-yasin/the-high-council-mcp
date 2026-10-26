// The one reader of a project's .env file (the CLI's loader, src/cli.js).
//
// Rules (0.8.1 pre-release audit, A4-1 and A4-2):
//  - A value the real environment already has stays. "Has" is PRESENT (non-blank, not a placeholder), not usable: a malformed shell key is not replaced.
//  - A project's .env is part of the project, which an agent or a cloned repo can write, so it may not set what changes how the process or its children run
//    (NODE_OPTIONS=--require x.cjs ran code in every spawned child that holds the keys), nor the plugin dialog's own variables (COUNCIL_PLUGIN_*, read BEFORE
//    the operator's exported key), nor the loopback-key switch (the code says only the environment may set it), nor the operator-only advice settings (rule 5d), nor a path-valued mock test seam (COUNCIL_MOCK_HOLD_FILE),
//    nor where the machine's tools look for their own configuration (HOST_LEVEL below) or the persona file (COUNCIL_PERSONAS_FILE).
//    A refused name is reported once to `onIgnored`, never silently dropped.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { keyPresent, PLUGIN_ENV_PREFIX } from './key-env.js';
import { OPERATOR_ONLY_ENV } from './send-profiles.js';

// NODE_ENV is a common application setting that loads no code: it stays allowed. Every other NODE_* name (NODE_OPTIONS, NODE_EXTRA_CA_CERTS, NODE_USE_ENV_PROXY...) is refused.
// Also (re-audit 3): what changes how a child process starts or whom it trusts: OpenSSL's config and modules (a conf that names a provider without `default` makes every child node abort),
// the CA bundle variables, GIT_* (GIT_CONFIG_* runs a script through `git check-ignore`), BASH_ENV/ENV, PYTHON*, HOME and TMPDIR.
const PROCESS_LEVEL = /^(NODE_(?!ENV$).*|LD_.*|DYLD_.*|PATH|(?:ALL|HTTPS?|NO)_PROXY|OPENSSL_.*|SSL_CERT_.*|CURL_CA_BUNDLE|REQUESTS_CA_BUNDLE|GIT_.*|BASH_ENV|ENV|PYTHON.*|HOME|TMPDIR)$/;
// 13 Oct 2026 (audit items 8 + 11, C&C's rulings): names that point the machine's own tools at a project-chosen place, one reason per class. None is run on Windows or macOS by us (the Windows names are listed from their documented meaning).
//   XDG_*                                     where git (and most Unix tools) read their per-user config: `$XDG_CONFIG_HOME/git/config` can carry `core.fsmonitor`, a program that `git check-ignore` and `git status` then RUN (git 2.56.0, shown by a marker file).
//   USERPROFILE, HOMEDRIVE, HOMEPATH          Windows' HOME: the same reason HOME is refused above.
//   TEMP, TMP                                 where children and libraries put temporary files (Windows and many tools, the sibling of TMPDIR above), on every platform.
//   APPDATA, LOCALAPPDATA, PROGRAMDATA        Windows' per-user and machine-wide configuration roots.
//   PATHEXT                                   which file endings Windows runs as programs (the sibling of PATH above).
//   GCONV_PATH, LOCPATH, NLSPATH              the C library loads converters, locale data and message catalogues from these (the loader class, beside LD_*).
const HOST_LEVEL = /^(XDG_.*|USERPROFILE|HOMEDRIVE|HOMEPATH|TEMP|TMP|APPDATA|LOCALAPPDATA|PROGRAMDATA|PATHEXT|GCONV_PATH|LOCPATH|NLSPATH)$/;
// COUNCIL_MOCK_HOLD_FILE (13 Oct 2026, a test seam in src/providers.js): a path-valued setting from a project-writable file decides whether every mock run waits up to 60 s on a
// file the project names, so it is refused here like the loopback-key switch. Its sibling COUNCIL_MOCK_PRESTART_UNTIL_STOP is a bounded flag of the same class as
// COUNCIL_MOCK_PRESTART_MS and COUNCIL_MOCK_DELAY_MS, which are not refused either.
// COUNCIL_PERSONAS_FILE (13 Oct 2026, audit item 11): a path-valued setting that REPLACES the whole persona set every debate seat is given (src/personas.js), so a project-writable file would choose what the seats are told to be; it is the operator's choice.
// COUNCIL_TEST_SPAWN_HOLD_FILE (13 Oct 2026, a test seam in src/mcp/server.js, HOLD_FILE's twin): path-valued, and the server writes `<path>.entered` through any symlink the project put there, so a project-writable file may not name it.
// ALLOWED on purpose, so the next audit does not raise it again: COUNCIL_ADVISE_MOCK (and COUNCIL_MOCK_PRESTART_MS / _DELAY_MS / _UNTIL_STOP): a mode flag or a bounded number, not a path. A project that switches the advice chains
// to mock costs nothing and sends nothing real.
// COUNCIL_PII_GATE (19 Okt 2026, owner: a standing `warn` may only come from the USER): the default now STOPS at a finding, so a project-writable file setting `warn` would silently remove the stop. Refused here like the loopback-key
// switch; set it in the real environment or the Claude Desktop field. Refusing is the strict direction: the run still stops.
// COUNCIL_WORKDIR (14 Oct 2026, C&C's entry 12): the folder the MCP server writes tasks and runs in. src/mcp/server.js reads it when it is imported, which is BEFORE src/cli.js applies a .env (a static import), so a .env value
// never moved the work folder of this process; but it did reach every child the server starts and any later reader, and a project-writable file must not choose where the person's runs are written. Refused by name, so the notice says so.
const NEVER_FROM_ENV_FILE = Object.freeze(['COUNCIL_ALLOW_LOOPBACK_KEY_HOST', 'COUNCIL_MOCK_HOLD_FILE', 'COUNCIL_TEST_SPAWN_HOLD_FILE', 'COUNCIL_PERSONAS_FILE', 'COUNCIL_WORKDIR', 'COUNCIL_PII_GATE']);

/**
 * WHICH .env file is read for a folder (13 Oct 2026, Haiku job 8, C&C): the folder's own `.env`, else the package's (the clone's: `cp .env.example .env` in a cloned checkout), else the folder's (which does not exist). ONE function for
 * every entry that reads a .env, so two entries cannot pick different files by construction: the CLI passes its cwd (src/cli.js), the direct MCP server passes its WORK folder (src/mcp/server.js), the child run its own work folder.
 */
export function envFilePathFor(folder, pkg) {
  return [join(folder, '.env'), join(pkg, '.env')].find(existsSync) || join(folder, '.env');
}

/** True when a project .env may not set `name` (the caller tells the user to set it in the real environment). Operator-only advice settings are refused too. */
export const envFileRefuses = name => PROCESS_LEVEL.test(name) || HOST_LEVEL.test(name) || name.startsWith(PLUGIN_ENV_PREFIX) || NEVER_FROM_ENV_FILE.includes(name) || OPERATOR_ONLY_ENV.includes(name);

// The spend settings (13 Oct 2026, audit item 11, S02-2). A name written on two lines keeps its FIRST value and the second is dropped without a word: for these two that is a cap the person may have meant the other way
// round (`MAX_USD_PER_RUN=2` ... `MAX_USD_PER_RUN=20` runs at 2). Their repeat is reported to `onRepeatedMoney` and the caller refuses to start; any other name keeps the old, silent rule.
// The one sentence for a repeated spend setting, shared by every entry that reads a .env (src/cli.js, and the direct MCP entry in src/mcp/server.js), so the two never say different things. It names the FILE and BOTH
// (all) line numbers, because it is the diagnostic itself: it stops every command, `council doctor` included (13 Oct 2026, C&C's condition for the stop).
const listOf = nums => (nums.length <= 1 ? nums.join('') : `${nums.slice(0, -1).join(', ')} and ${nums[nums.length - 1]}`);
export const repeatedMoneySentence = (name, label = '.env', lines = []) => `${label}: ${name} is written on ${lines.length > 1 ? `lines ${listOf(lines)}` : 'more than one line'}, and it is a spend setting, so nothing started rather than guess which line you meant. Keep one line and run the command again.`;
// The same setting in TWO files that are both read (`council --mcp` applies the cwd .env; the server reads the work folder's too): different values, and the cwd file silently won. Named, with both paths.
export const conflictSentence = (name, pathA, pathB) => `${pathA} and ${pathB} both set ${name}, to different values, so nothing started rather than guess which file you meant. Keep it in one file and run the command again.`;
/** The settings a .env text holds, read by the same rules as applyEnvFile into a scratch object (never process.env). */
export function envFileValues(text) { const values = {}; applyEnvFile(text, values); return values; }
export const MONEY_NAMES = Object.freeze(['COUNCIL_MAX_USD_LIMIT', 'MAX_USD_PER_RUN']);
// A spend setting written in a form the line rule does not read (14 Oct 2026, C&C's entry 5): `"COUNCIL_MAX_USD_LIMIT"=5`, `COUNCIL_MAX_USD_LIMIT: 5`, `max_usd_per_run=2`. The reader skipped such a line without a word, so a cap the person
// believed they had set was not there. A line that starts (after an optional `export` and an optional quote) with one of the two names, in any case, and was not read as NAME=value, is reported to `onMalformedMoney` and the caller refuses to start.
// A comment line starts with `#` and never matches; `NAME=` with nothing after it is a line the rule reads (blank = absent) and is not reported.
const MONEY_ELSEWHERE = new RegExp(`^\\s*(?:export\\s+)?["']?(${MONEY_NAMES.join('|')})["']?(?![A-Za-z0-9_])`, 'i');
export const malformedMoneySentence = (name, label = '.env', lineNo = 0) => `${label}: line ${lineNo} names ${name} but is not written as ${name}=<value>, so it sets nothing. It is a spend setting, so nothing started rather than guess what you meant. Write it as ${name}=<value> on one line and run the command again.`;

/** Fill `env` from the text of a .env file; returns the names it set. `onIgnored(name)` is called once per refused name; `onRepeatedMoney(name, sentence)` once per MONEY_NAMES name written on more than one line (a line with an empty value is no setting and does not count); `onMalformedMoney(name, sentence)` once per line that names a MONEY_NAMES name in a form that is not NAME=value; `label` is the file's path, named in that sentence with the line numbers. */
export function applyEnvFile(text, env = process.env, { onIgnored, onRepeatedMoney, onMalformedMoney, label } = {}) {
  const set = []; const told = new Set(); const written = new Map();
  for (const [lineIndex, line] of text.split('\n').entries()) {
    // A leading `export ` is the standard dotenv form (`export NAME=value`); it was dropped without a word, so an operator's `export COUNCIL_MAX_USD_LIMIT=1` set no limit. Nothing beyond that word: no quoting rules, no interpolation.
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) { const bad = onMalformedMoney && line.match(MONEY_ELSEWHERE); if (bad) onMalformedMoney(bad[1].toUpperCase(), malformedMoneySentence(bad[1].toUpperCase(), label, lineIndex + 1)); continue; }
    if (!m[2]) continue;
    if (MONEY_NAMES.includes(m[1])) written.set(m[1], [...(written.get(m[1]) || []), lineIndex + 1]);
    if (envFileRefuses(m[1])) { if (onIgnored && !told.has(m[1])) { told.add(m[1]); onIgnored(m[1]); } continue; }
    if (!keyPresent(env[m[1]])) { env[m[1]] = m[2].replace(/^["']|["']$/g, ''); set.push(m[1]); }
  }
  if (onRepeatedMoney) for (const [name, lines] of written) if (lines.length > 1) onRepeatedMoney(name, repeatedMoneySentence(name, label, lines));
  return set;
}
