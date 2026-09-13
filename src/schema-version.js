// v5 §1 candidate 13: chain schema versioning, warn-only. A stranger with an
// old cloned chain file should get a named warning naming what changed since,
// not a cryptic failure - the project's existing posture for wrong-party/
// wrong-shape peer dispatch (src/peer-claim.js) is the same: warn, never break.
//
// Bumping this constant is a decision about the *shape* of chains/*.json (a
// field's meaning changed or a new one exists that changes behaviour), not
// about any one chain file. See CHANGES below for what to say when it moves.
export const CURRENT_SCHEMA_VERSION = 1;

// One line per version bump, newest first: what a chain author gained or
// must account for. Read by schemaVersionWarning() to name what changed
// since a chain's own declared (or absent) version.
const CHANGES = [
  { version: 1, note: 'baseline - the schema as it exists before any versioned change' },
];

/**
 * Null if `chain` already declares the current version. Otherwise a
 * warn-only message naming the current expected version and, when the chain
 * declares an older (not absent) one, what changed since. Never throws -
 * schemaVersion is optional, and an absent or malformed value is just "no
 * version declared", not an error.
 */
export function schemaVersionWarning(chain) {
  const declared = Number.isInteger(chain?.schemaVersion) ? chain.schemaVersion : null;
  if (declared === CURRENT_SCHEMA_VERSION) return null;

  if (declared === null) {
    return `no schemaVersion declared - current is ${CURRENT_SCHEMA_VERSION}. This chain is read exactly as it always was; nothing breaks, but a newer schemaVersion may add fields it can't yet use.`;
  }

  if (declared > CURRENT_SCHEMA_VERSION) {
    return `schemaVersion ${declared} declares a newer schema than this build of council knows about (current is ${CURRENT_SCHEMA_VERSION}) - update council, or this chain may use fields this build can't read.`;
  }

  const since = CHANGES.filter(c => c.version > declared).map(c => `  v${c.version}: ${c.note}`);
  return `schemaVersion ${declared} is older than the current ${CURRENT_SCHEMA_VERSION}.${since.length ? `\n${since.join('\n')}` : ''}`;
}
