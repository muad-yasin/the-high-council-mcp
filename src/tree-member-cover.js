// A tree MEMBER's own PII scan, for the one stretch a ROOT allowance covers inside a child's input (C&C ruling (c), 19 Okt 2026): the bytes the tree code copied verbatim from the pinned root task into context.md section 2.
// The member re-derives its bundle from the record (the same derivation registration and rebuild ran) and takes derive's `rootTaskSpans`; it covers nothing unless the derived context.md equals, byte for byte, the context
// file the run was handed. Provenance is the derivation's, never a look at the text: a model-written block that happens to hold the same words is not covered. Never throws; any problem reads as no coverage (the scan then stops).
import { dirname } from 'node:path';
import { readTreeRecord, stateOf } from './tree-record.js';
import { deriveChild } from './tree-derive.js';
import { loadDerivation, readPlanOf } from './tree-derive-load.js';
import { rootTaskPathOf } from './tree-frontier.js';
import { rootTaskCoverage } from './tree-bundle-input.js';

/** -> { types, spans } (spans = character offsets inside `contextText`). */
export function memberRootCover({ rootDir, lineage, work, contextText }) {
  const none = { types: [], spans: [] };
  try {
    if (lineage.node === 'R') return none;
    const record = readTreeRecord(rootDir);
    if (!record.exists || !record.tree || record.corrupt.length) return none;
    const state = stateOf(record);
    const n = state.nodes.get(`${lineage.node}@g${lineage.generation}`);
    if (!n) return none;
    const parent = state.nodes.get(`${n.parentNode}@g${state.frontiers.get(n.frontierKey)?.parentGeneration}`);
    if (!parent) return none;
    const childId = readPlanOf(dirname(rootDir), parent).block?.children?.find(c => c.milestone === lineage.node.split('/').at(-1))?.id;
    if (!childId) return none;
    const derived = deriveChild(loadDerivation({ rootDir, parentRef: { node: parent.node, generation: parent.generation }, childId, generation: lineage.generation, rootTaskPath: rootTaskPathOf(rootDir, work), work }));
    if (derived.files['context.md'] !== contextText) return none;
    return rootTaskCoverage(record.tree, derived);
  } catch { return none; }
}

/** The covered stretches as 1-based inclusive line ranges of `request`, where `docs` (the bundled --context text, whose single document starts after `prefix`) is the end of `request`. null = cannot be placed. */
export function coverRanges({ request, docs, prefix, spans }) {
  if (!spans.length || !request.endsWith(docs) || !docs.startsWith(prefix)) return null;
  const base = request.length - docs.length + prefix.length;
  const lineAt = pos => request.slice(0, pos).split('\n').length;
  return spans.map(s => [lineAt(base + s.from), lineAt(base + Math.max(s.from, s.to - 1))]);
}
