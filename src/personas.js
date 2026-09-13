import { readFileSync } from 'node:fs';

// v6 §6: public naming. The shipped default persona set - five historical/
// public-domain figures, chosen so a public MIT repo carrying the author's
// real name and a German Impressum never ships a third-party trademark. An
// operator may replace the whole set (never edit this file to do it - see
// loadPersonas()).
//
// Persona names are referenced only through this module in every
// prompt-assembly path - never hard-coded elsewhere (src/roles.js included).
// Wording below is a first pass, pending author review, same as §1's LENSES
// instruction text.
export const DEFAULT_PERSONAS = Object.freeze({
  moses: Object.freeze({ name: 'Moses', voice: 'Speaks in plain, weighty directives. States the rule first, the reason second.' }),
  noah: Object.freeze({ name: 'Noah', voice: 'Methodical and provisioning-minded. Asks what happens if this is wrong before asking what happens if it is right.' }),
  matthew: Object.freeze({ name: 'Matthew', voice: 'A record-keeper\'s voice. Cites exactly what was said and by whom before drawing a conclusion.' }),
  'van-gogh': Object.freeze({ name: 'Van Gogh', voice: 'Sees the whole composition before the detail. Argues from what the piece is trying to be, not just what is wrong with one brushstroke.' }),
  parzival: Object.freeze({ name: 'Parzival', voice: 'Asks the question everyone else assumed was already answered.' }),
});

// Takes any path - .council/ (see .gitignore) is only a suggested location,
// not enforced. Putting your own persona file somewhere else is fine, but
// gitignore won't protect it there; that's on you to keep out of git add.
const ENV_PERSONAS_FILE = 'COUNCIL_PERSONAS_FILE';

/**
 * The persona set to use: an operator-supplied file (path argument, or the
 * COUNCIL_PERSONAS_FILE env var) REPLACES the whole default set, matching
 * §6 ("an operator may replace the whole set"). No file configured, or the
 * file can't be read, falls back to DEFAULT_PERSONAS - never throws.
 */
export function loadPersonas({ personasFile, readFile = defaultReadFile } = {}) {
  const path = personasFile ?? process.env[ENV_PERSONAS_FILE];
  if (!path) return DEFAULT_PERSONAS;
  try {
    const parsed = JSON.parse(readFile(path));
    return parsed && typeof parsed === 'object' ? parsed : DEFAULT_PERSONAS;
  } catch {
    return DEFAULT_PERSONAS;
  }
}

function defaultReadFile(path) {
  return readFileSync(path, 'utf8');
}

/**
 * Resolve a `role.persona` key (§1) against a persona set. Returns null for
 * an unknown key rather than throwing - validating that null and raising a
 * config error is §1's job (MISTRAL-2's validation rule), not this module's.
 */
export function resolvePersona(key, personas = DEFAULT_PERSONAS) {
  return personas?.[key] ?? null;
}
