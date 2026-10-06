// What may be sent where (thc-research brief 25 section 4, built for brief 29): the sensitivity floor and the
// retention class of each seat, shown in the send preview.
//
// Rules (untuned, brief 25):
//   - the operator's floor (COUNCIL_ADVICE_SENSITIVITY_FLOOR, default "internal"; a project's policy.json
//     `advice_sensitivity_floor` may raise it, never lower it: 0.8.1 decided rule 5d) and the caller's own label
//     are combined; the LABEL CAN ONLY TIGHTEN: the stricter of the two wins, a missing or "unknown" label counts as
//     "confidential", and nothing a caller writes lowers the floor;
//   - `personal_data` and `secret_adjacent` are refused for every hosted seat (brief 25: local-only or not at all;
//     a local tier is not built here);
//   - `confidential` goes to ONE seat: a council adds one recipient per lab, so a council needs `internal` or below;
//   - from `internal` up, every hosted seat must have an endpoint OpenRouter tags zero-data-retention; a seat with
//     none (Fable 5.1, Muse Spark, Qwen3.8 Max) is reachable only for `public` material, which means the operator
//     set the floor to "public" on purpose.
// "ZDR" here is OpenRouter's routing tag, not a guarantee: see src/advice-retention.json.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const RETENTION = JSON.parse(readFileSync(join(here, 'advice-retention.json'), 'utf8'));

export const SENSITIVITY_RANK = Object.freeze({ public: 0, internal: 1, confidential: 2, personal_data: 3, secret_adjacent: 3 });
export const DEFAULT_FLOOR = 'internal';
// The snapshot is this many days old before the preview says it should be re-checked (untuned).
export const RETENTION_STALE_DAYS = 30;

const rankOf = s => (s in SENSITIVITY_RANK ? SENSITIVITY_RANK[s] : SENSITIVITY_RANK.confidential);

/**
 * { effective, label, floor, raised } for a caller's label and the operator's floor. A floor that is not one of the
 * three the operator may set is read as "confidential" (fail closed).
 */
export function effectiveSensitivity(label, floor = DEFAULT_FLOOR) {
  const f = ['public', 'internal', 'confidential'].includes(floor) ? floor : 'confidential';
  const l = label in SENSITIVITY_RANK ? label : 'confidential'; // missing or "unknown"
  const effective = rankOf(l) >= rankOf(f) ? l : f;
  return { effective, label: label ?? 'unknown', floor: f, raised: effective !== l };
}

// 0.8.1 decided rule 5d: the floor is the operator's (the server's environment, default "internal"); a project's policy.json may
// raise it, never lower it, because the project folder is what the agent can write. Before 0.8.1 policy.json alone set it.
export const SENSITIVITY_FLOOR_ENV = 'COUNCIL_ADVICE_SENSITIVITY_FLOOR';
const FLOOR_VALUES = ['public', 'internal', 'confidential'];
// A value that is not one of the three reads as "confidential" (fail closed), from either source.
const floorValue = v => (FLOOR_VALUES.includes(v) ? v : 'confidential');

/**
 * The floor and where each part came from: { floor, operator, operator_source, project, floor_source }.
 * operator_source is the variable's name or "default"; project is policy.json's value or null; floor_source names the part that won.
 */
export function sensitivityFloorOf({ env = process.env, policy = null } = {}) {
  const raw = env[SENSITIVITY_FLOOR_ENV];
  const set = raw !== undefined && raw !== '';
  const operator = set ? floorValue(raw) : DEFAULT_FLOOR;
  const p = policy?.advice_sensitivity_floor;
  const project = p === undefined || p === null ? null : floorValue(p);
  const projectWins = project !== null && rankOf(project) > rankOf(operator);
  return { floor: projectWins ? project : operator, operator, operator_source: set ? SENSITIVITY_FLOOR_ENV : 'default', project, floor_source: projectWins ? 'policy.json' : (set ? SENSITIVITY_FLOOR_ENV : 'default') };
}

/** effectiveSensitivity plus where the floor came from: what the quote, the gate and the approval text carry. */
export function sensitivityOf(label, { env = process.env, policy = null } = {}) {
  const f = sensitivityFloorOf({ env, policy });
  return { ...effectiveSensitivity(label, f.floor), operator_floor: f.operator, operator_source: f.operator_source, project_floor: f.project, floor_source: f.floor_source };
}

/**
 * One sentence for the person: the label the text is treated as and who set each part, so the person is the check on the agent's
 * label (decided rule 5d). Short enough for the gate's 300-character field.
 */
export function sensitivityWords(s) {
  const operator = `operator floor ${s.operator_floor}${s.operator_source === 'default' ? ' (default)' : ` (${s.operator_source})`}`;
  const project = s.project_floor ? `project policy.json ${s.project_floor}${rankOf(s.project_floor) < rankOf(s.operator_floor) ? ' (cannot lower it)' : ''}` : 'project policy.json: none';
  return `treated as ${s.effective}; ${operator}; ${project}; the agent labelled it ${s.label}${s.raised ? ', raised by the floor' : ''}`;
}

/** The retention row for a seat, or null: the seat is then "unknown". */
export const retentionRowOf = seat => RETENTION.seats[`${seat.provider}/${seat.model}`] || null;
export const retentionAsOf = () => RETENTION.asOf;

/**
 * What the send preview says about one seat's endpoint: { class, label, detail }.
 * label: "ZDR-tagged by OpenRouter" (A, B), "retains, <lab's page>" (C, D), or "unknown".
 */
export function retentionOf(seat) {
  if (seat.provider === 'mock') return { class: 'M', label: 'nowhere (mock seat, nothing is sent)', detail: 'mock provider' };
  if (seat.provider === 'external') return { class: 'E', label: 'a person or agent answers by file', detail: 'external seat' };
  const row = retentionRowOf(seat);
  if (!row) return { class: null, label: 'unknown', detail: 'this model is not in the retention table (src/advice-retention.json)' };
  if (row.class === 'A' || row.class === 'B') return { class: row.class, label: 'ZDR-tagged by OpenRouter', detail: row.wording };
  if (row.class === 'D') return { class: 'D', label: 'retains, at least 30 days (Anthropic Covered Model)', detail: row.wording };
  return { class: row.class, label: row.labRetention ? `retains, ${row.labRetention}` : 'unknown', detail: row.wording };
}

/** Days since the retention snapshot, for the "re-check" line in the preview. */
export function retentionAgeDays(now = Date.now()) {
  const t = Date.parse(`${RETENTION.asOf}T00:00:00Z`);
  return Number.isFinite(t) ? Math.floor((now - t) / 86_400_000) : null;
}

/**
 * The refusal for a tier and a set of seats, or null when the send is allowed.
 * `seats` are the hosted-or-mock seats the call would use (panel and synthesis).
 */
export function tierRefusal({ effective, mode, seats }) {
  const hosted = seats.filter(s => s.provider !== 'mock' && s.provider !== 'external');
  if (effective === 'personal_data' || effective === 'secret_adjacent') {
    return hosted.length
      ? `the brief is labelled ${effective}, and this tool sends to hosted seats only: it is never sent. Leave the personal data or the secret-adjacent material out of the brief, or ask a model that runs on the user's own machine.`
      : null;
  }
  if (effective === 'confidential' && mode === 'council' && hosted.length > 1) {
    return 'a confidential brief goes to one seat, not to a council: each lab in a council is one more recipient. Ask with mode "single", or ask the user whether the material is really internal (the label is the user\'s call, not the agent\'s).';
  }
  if (SENSITIVITY_RANK[effective] >= SENSITIVITY_RANK.internal) {
    for (const s of hosted) {
      const r = retentionOf(s);
      if (r.class !== 'A' && r.class !== 'B') {
        return `${s.model} has no endpoint OpenRouter tags zero-data-retention (${r.label}); a ${effective} brief is not sent to it. Pick a seat that has one, or ask the user to set ${SENSITIVITY_FLOOR_ENV}=public in the server's settings if this material really is public (a project's policy.json cannot lower the floor).`;
      }
    }
  }
  return null;
}

/**
 * The routing gap of a seat, or null. An OpenRouter seat whose model has a zero-retention-tagged endpoint (class A or B) must carry
 * extra.provider { zdr: true, data_collection: "deny" }, so a call can only be served by one; a seat with none (class C or D) goes to the
 * lab's own host and has no such tag to require.
 */
export function seatRoutingGap(seat) {
  if (seat.provider !== 'openrouter') return null;
  const r = retentionOf(seat);
  if (r.class !== 'A' && r.class !== 'B') return null;
  const p = seat.extra?.provider;
  if (!p || p.zdr !== true) return 'extra.provider.zdr must be true';
  if (p.data_collection !== 'deny') return 'extra.provider.data_collection must be "deny"';
  return null;
}
