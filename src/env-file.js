// The one reader of a project's .env file (the CLI's loader, src/cli.js).
//
// Rules (0.8.1 pre-release audit, A4-1 and A4-2):
//  - A value the real environment already has stays. "Has" is PRESENT (non-blank, not a placeholder), not usable: a malformed shell key is not replaced.
//  - A project's .env is part of the project, which an agent or a cloned repo can write, so it may not set what changes how the process or its children run
//    (NODE_OPTIONS=--require x.cjs ran code in every spawned child that holds the keys), nor the plugin dialog's own variables (COUNCIL_PLUGIN_*, read BEFORE
//    the operator's exported key), nor the loopback-key switch (the code says only the environment may set it), nor the operator-only advice settings (rule 5d).
//    A refused name is reported once to `onIgnored`, never silently dropped.
import { keyPresent, PLUGIN_ENV_PREFIX } from './key-env.js';
import { OPERATOR_ONLY_ENV } from './send-profiles.js';

// NODE_ENV is a common application setting that loads no code: it stays allowed. Every other NODE_* name (NODE_OPTIONS, NODE_EXTRA_CA_CERTS, NODE_USE_ENV_PROXY...) is refused.
// Also (re-audit 3): what changes how a child process starts or whom it trusts: OpenSSL's config and modules (a conf that names a provider without `default` makes every child node abort),
// the CA bundle variables, GIT_* (GIT_CONFIG_* runs a script through `git check-ignore`), BASH_ENV/ENV, PYTHON*, HOME and TMPDIR.
const PROCESS_LEVEL = /^(NODE_(?!ENV$).*|LD_.*|DYLD_.*|PATH|(?:ALL|HTTPS?|NO)_PROXY|OPENSSL_.*|SSL_CERT_.*|CURL_CA_BUNDLE|REQUESTS_CA_BUNDLE|GIT_.*|BASH_ENV|ENV|PYTHON.*|HOME|TMPDIR)$/;
const NEVER_FROM_ENV_FILE = Object.freeze(['COUNCIL_ALLOW_LOOPBACK_KEY_HOST']);

/** True when a project .env may not set `name` (the caller tells the user to set it in the real environment). Operator-only advice settings are refused too. */
export const envFileRefuses = name => PROCESS_LEVEL.test(name) || name.startsWith(PLUGIN_ENV_PREFIX) || NEVER_FROM_ENV_FILE.includes(name) || OPERATOR_ONLY_ENV.includes(name);

/** Fill `env` from the text of a .env file; returns the names it set. `onIgnored(name)` is called once per refused name. */
export function applyEnvFile(text, env = process.env, { onIgnored } = {}) {
  const set = []; const told = new Set();
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || !m[2]) continue;
    if (envFileRefuses(m[1])) { if (onIgnored && !told.has(m[1])) { told.add(m[1]); onIgnored(m[1]); } continue; }
    if (!keyPresent(env[m[1]])) { env[m[1]] = m[2].replace(/^["']|["']$/g, ''); set.push(m[1]); }
  }
  return set;
}
