// A LEAF module: node imports only. The superseded/ folder's name and the next free number for a label there, shared by src/superseded.js (stage files) and src/verdict-envelope.js (reply-identity records) so the
// two never pick the same n. It exists as its own file because src/providers.js imports verdict-envelope.js, and anything verdict-envelope.js imports is in providers.js's closure: superseded.js reaches usd-figure -> cost ->
// roles, which would make src/dissent-digest.js (via denied-models -> providers) reach roles.js (test/no-digest-in-prompt-paths.test.js, the v6 item E read-only guarantee).
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export const SUPERSEDED_DIR = 'superseded';

/**
 * The next free number for a label in `superseded/`: the smallest n with NO file named `<label>.<n>.*` of any kind (a stage file or a verdict-envelope record, E3b), so an n is unique across file types. Pure
 * apart from reading the folder; a missing or unreadable folder gives 1.
 */
export function nextSupersededN(runDir, label) {
  let names = [];
  try { names = readdirSync(join(runDir, SUPERSEDED_DIR)); } catch { return 1; }
  const used = new Set();
  const prefix = `${label}.`;
  for (const f of names) { if (!f.startsWith(prefix)) continue; const m = /^(\d+)\./.exec(f.slice(prefix.length)); if (m) used.add(Number(m[1])); }
  let n = 1;
  while (used.has(n)) n++;
  return n;
}
