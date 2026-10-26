// Qualified ids (0.8.3 M5a; PLAN 10.1). Every milestone, agreement and obligation a tree command addresses is qualified by its owning node and generation: `R/M2@g1:M1`, `R@g1:A3`. Different nodes can each hold an M1
// or an A1, so a BARE id is accepted only when it resolves to exactly one in the tree; otherwise the command lists the matches and changes nothing. PURE: the index is built from the verified split blocks the caller reads.
import { isNodePath } from './tree-transitions.js';

const QUALIFIED = /^(R(?:\/[A-Za-z][A-Za-z0-9_-]*)*)@g([1-9]\d*):([A-Za-z][A-Za-z0-9_-]*)$/;
const BARE = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** The text form of a qualified id. */
export const qualify = ({ node, generation, id }) => `${node}@g${generation}:${id}`;

/** Parses one id as typed: { qualified: true, node, generation, id }, { qualified: false, id } for a bare one, or null when it is neither (`..`, a slash, a space, an empty string: nothing is guessed). */
export function parseQid(text) {
  const t = String(text ?? '');
  const m = QUALIFIED.exec(t);
  if (m && isNodePath(m[1])) return { qualified: true, node: m[1], generation: Number(m[2]), id: m[3] };
  return BARE.test(t) ? { qualified: false, id: t } : null;
}

/**
 * The index of every addressable id: [{ node, generation, kind: 'milestone' | 'agreement', id }] from `blocks` = [{ node, generation, block }] (each node's VERIFIED split block). Obligations are addressed by their
 * identity elsewhere; here the plan's milestone and agreement ids are indexed, which is what `decide --milestone` and the integration commands take.
 */
export function qidIndex(blocks) {
  const out = [];
  for (const { node, generation, block } of blocks) {
    for (const m of block?.milestones ?? []) out.push({ node, generation, kind: 'milestone', id: m.id });
    for (const a of block?.agreements ?? []) out.push({ node, generation, kind: 'agreement', id: a.id });
  }
  return out;
}

/**
 * Resolves an id as typed against the index. { ok: true, match } when it names exactly one thing; otherwise { ok: false, reason, matches } with every candidate as its qualified text, so the command can list them
 * and change nothing. `kind` restricts the search (`decide --milestone` looks only at milestones).
 */
export function resolveQid(text, index, { kind = null } = {}) {
  const p = parseQid(text);
  if (!p) return { ok: false, reason: `${JSON.stringify(String(text))} is not an id (write R/M2@g1:M1, or a bare id that only one node holds)`, matches: [] };
  const pool = kind ? index.filter(e => e.kind === kind) : index;
  const hits = p.qualified ? pool.filter(e => e.node === p.node && e.generation === p.generation && e.id === p.id) : pool.filter(e => e.id === p.id);
  if (hits.length === 1) return { ok: true, match: hits[0] };
  if (!hits.length) return { ok: false, reason: `no ${kind ?? 'id'} ${JSON.stringify(String(text))} in this tree`, matches: [] };
  return { ok: false, reason: `${JSON.stringify(String(text))} is held by ${hits.length} nodes: say which (nothing was changed)`, matches: hits.map(qualify) };
}

/** The qualified texts of a block's milestones (a convenience for the stop texts). */
export const milestoneQids = (node, generation, block) => (block?.milestones ?? []).map(m => qualify({ node, generation, id: m.id }));
