// Belt and braces for the zero-spend rule (13 Oct 2026, C&C: "a present value is never filled from .env, and a malformed key is never sent"). A test that touches a REAL chain's folder (a marked
// `zero-spend-ok` fixture: the resume of an advice run is refused, nothing starts) gives its child process these keys. src/env-file.js fills a name only when keyPresent() is false, and a key with a control
// character is present but unusable (src/key-env.js keyMalformed), so neither the checkout's own .env nor a shell key can reach a provider from that child, even if the refusal the test asserts ever regressed.
// The names come from src/providers.js (every paid provider, the Anthropic key included), so a provider added later is covered without an edit here.
// TWO FORMS (C&C, 14 Oct 2026: an in-process fixture is exactly the class this exists for, since in-process code reads keys from process.env and an EMPTY value is filled from the .env): `malformedProviderKeys()` for a CHILD process's env, and
// `withMalformedKeysInProcess(fn)` for a fixture that runs the code in THIS process: every paid provider's env value is the same malformed string for the call's scope (sync or async, also when it throws), and each prior value (or its absence) is restored after.
import { providerNames, envKeyName, isFreeProvider } from '../../src/providers.js';

export const MALFORMED_KEY = 'not-a-key\nnever-sent';

/** { OPENAI_API_KEY: <malformed>, ... } for every provider that is paid; spread it into a child's env. */
export function malformedProviderKeys() {
  return Object.fromEntries(providerNames().filter(p => !isFreeProvider(p)).map(p => [envKeyName(p), MALFORMED_KEY]));
}

/** Run `fn` with every paid provider's key set to the malformed value in THIS process; restore the earlier values (a name that was unset is unset again) when it returns, resolves or throws. Returns what `fn` returns. */
export function withMalformedKeysInProcess(fn) {
  const keys = malformedProviderKeys(); const before = new Map(Object.keys(keys).map(k => [k, process.env[k]]));
  const restore = () => { for (const [k, v] of before) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
  for (const [k, v] of Object.entries(keys)) process.env[k] = v;
  let out;
  try { out = fn(); } catch (e) { restore(); throw e; }
  if (out && typeof out.then === 'function') return out.finally(restore);
  restore(); return out;
}
