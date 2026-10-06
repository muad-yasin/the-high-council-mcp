// The one place that reads a provider key out of the environment (0.8.1 M9, plugin settings dialog).
//
// Contract: keyEnvValue(envName) -> the key, or null. envName is the provider's standard variable (OPENROUTER_API_KEY).
//   1. COUNCIL_PLUGIN_<envName>: where the Claude Code plugin's settings dialog puts a key (.claude-plugin/plugin.json `mcpServers.*.env`). It has its OWN
//      name on purpose: Claude Code starts the server from the user's shell, and an optional dialog field the user left empty must never replace a key
//      they exported themselves. Read first when usable.
//   2. the standard variable (shell, a client's own env block, or the .env loader in src/cli.js).
// A usable value is non-empty, not just whitespace, and not an unsubstituted `${user_config.` template literal (a host that leaves the placeholder
// behind for an unset optional field): anything else counts as unset, so it can neither pass as a key nor stop the .env loader from filling the
// standard variable. Never log, print or return the value from a diagnostic: callers report presence only.
export const PLUGIN_ENV_PREFIX = 'COUNCIL_PLUGIN_';

// PRESENT: something is set (non-blank, not an unsubstituted template). USABLE: present and well-formed (audit A2-1, 0.8.1: a control character inside a key, e.g.
// a two-line paste, makes it unusable: Headers.append rejects it and the error text used to print the key). The two are separate on purpose: the .env loader asks
// "present" (a malformed shell key is never silently replaced by a .env value, so `council doctor` can say "malformed" instead of "set").
export const keyPresent = v => typeof v === 'string' && v.trim() !== '' && !v.includes('${user_config.');
const CONTROL_CHAR = /[\u0000-\u001f\u007f]/;
export const keyMalformed = v => keyPresent(v) && CONTROL_CHAR.test(v.trim());
export const usableKeyValue = v => keyPresent(v) && !keyMalformed(v);

export function keyEnvValue(envName, env = process.env) {
  const dialog = env[PLUGIN_ENV_PREFIX + envName];
  if (usableKeyValue(dialog)) return dialog;
  const standard = env[envName];
  return usableKeyValue(standard) ? standard : null;
}

/** Where a usable key comes from: 'dialog' (the plugin settings dialog), 'environment' (the standard variable: shell, a client's env block or .env), or null. */
export function keySource(envName, env = process.env) {
  if (usableKeyValue(env[PLUGIN_ENV_PREFIX + envName])) return 'dialog';
  return usableKeyValue(env[envName]) ? 'environment' : null;
}

/** 'malformed' when a key is set but cannot be one (a control character inside it) and no usable key exists; otherwise null. Never returns or logs the value. */
export function keyProblem(envName, env = process.env) {
  if (keyEnvValue(envName, env)) return null;
  return keyMalformed(env[PLUGIN_ENV_PREFIX + envName]) || keyMalformed(env[envName]) ? 'malformed' : null;
}
export const MALFORMED_KEY_HINT = 'it contains a line break or another control character (a two-line paste?). Nothing was sent. Set the key again on one line.';
