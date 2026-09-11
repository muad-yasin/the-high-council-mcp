// Turns a markdown plan into a section tree with sizes and a rough "build
// volume" estimate per section. Pure functions, no I/O, so the viewer's
// numbers can be checked from a script.
//
// Build volume is a heuristic and is labelled as one everywhere it is shown:
// a plan names files, scripts, code blocks and tables; a section that names
// many of them will cost more to build than one that names none. It is not
// a line count and never becomes one until a build session has run.

const FILE_RE = /`([A-Za-z0-9_./-]+\.(?:cs|js|ts|json|md|unity|prefab|asset|sh|py|css|html|yaml|yml|toml|cfg|txt))`/g;
const SCRIPT_RE = /\b([A-Z][A-Za-z0-9]+(?:Controller|Manager|Behaviour|Behavior|State|System|Config|Provider|Interaction|Visual|UI|Bootstrap|Assignment|Builder|Script))\b/g;

export function words(text) {
  return (text.match(/\S+/g) || []).length;
}

export function parseSections(markdown) {
  const lines = markdown.split('\n');
  const root = { title: '(document)', level: 0, path: '', lines: [], children: [] };
  const stack = [root];
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line)) inFence = !inFence;
    const h = !inFence && line.match(/^(#{1,4})\s+(.*?)\s*#*\s*$/);
    if (h) {
      const level = h[1].length;
      const node = { title: h[2].trim(), level, lines: [line], children: [] };
      while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
      const parent = stack[stack.length - 1];
      node.path = parent.path ? `${parent.path} > ${node.title}` : node.title;
      parent.children.push(node);
      stack.push(node);
    } else {
      stack[stack.length - 1].lines.push(line);
    }
  }
  return finish(root);
}

function finish(node) {
  node.ownText = node.lines.join('\n');
  node.children.forEach(finish);
  node.text = [node.ownText, ...node.children.map(c => c.text)].join('\n');
  node.ownWords = words(node.ownText);
  node.words = words(node.text);
  node.volume = volumeOf(node.text);
  delete node.lines;
  return node;
}

export function volumeOf(text) {
  const files = new Set([...text.matchAll(FILE_RE)].map(m => m[1]));
  const scripts = new Set([...text.matchAll(SCRIPT_RE)].map(m => m[1]));
  const fences = (text.match(/^```/gm) || []).length / 2 | 0;
  const tableRows = (text.match(/^\|[^\n]*\|\s*$/gm) || []).length;
  const numbers = (text.match(/\b\d+(?:\.\d+)?\s?(?:s|ms|m|m\/s|%|MB|KB|px|°|tokens?)\b/g) || []).length;
  const checklist = (text.match(/^\s*(?:\d+\.|[-*]\s*\[[ x]\])\s/gm) || []).length;
  return {
    files: [...files].sort(),
    scripts: [...scripts].sort(),
    codeBlocks: fences,
    tableRows,
    numbers,
    checklistItems: checklist,
    // One number so bars can be drawn. Weights are arbitrary and stated.
    score: files.size * 3 + scripts.size * 2 + fences * 4 + tableRows + checklist,
  };
}

export function flatten(node, out = []) {
  if (node.level > 0) out.push(node);
  node.children.forEach(c => flatten(c, out));
  return out;
}

// Section-by-section comparison across drafts, keyed by heading path.
export function compareDrafts(drafts) {
  // drafts: [{ label, tree }]
  const keys = new Map();
  drafts.forEach((d, i) => {
    for (const s of flatten(d.tree)) {
      const key = s.path;
      if (!keys.has(key)) keys.set(key, { path: key, title: s.title, level: s.level, first: i, per: {} });
      keys.get(key).per[d.label] = { words: s.words, ownWords: s.ownWords, volume: s.volume.score };
    }
  });
  return [...keys.values()];
}

// The plan's own scope ledger, if it wrote one.
export function parseLedger(markdown) {
  // \Z is not a JS anchor; the section runs to the next heading or the end.
  const m = markdown.match(/^#{1,4}\s+(?:\d+\.\s*)?Scope ledger\s*$([\s\S]*?)(?=^#{1,4}\s|$(?![\s\S]))/im);
  if (!m) return [];
  const rows = [];
  for (const line of m[1].split('\n')) {
    const r = line.match(/^[\s*_`-]*([A-Z0-9]+-\d+)[`*_]*\s*[-:–—]\s*\**(accepted|cut|withdrawn)\**\s*[-:–—]?\s*(.*)$/i);
    if (r) rows.push({ id: r[1], status: r[2].toLowerCase(), note: r[3].trim() });
  }
  return rows;
}
